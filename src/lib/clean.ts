import {
  EVENT_TYPES,
  EXAMPLES_PER_REASON,
  IS_TEST_FALSE,
  IS_TEST_TRUE,
  KIT_PRODUCTS,
  PRODUCTS,
  SOURCES,
  STATUSES,
  type CsvKind,
  type EventSource,
  type EventType,
  type OrderStatus,
  type Product,
} from './config';
import { parseTimestamp } from './parse';
import {
  EXCLUSION_REASONS,
  FLAG_REASONS,
  type DataQualityReport,
  type ExclusionReason,
  type FlagReason,
  type KitEvent,
  type Order,
  type ParseWarning,
  type RawRow,
  type ReasonBucket,
} from './types';

export interface Flaggable {
  raw: RawRow;
  flags: FlagReason[];
}

/** The only way rows are removed or annotated. Every call lands in the report. */
export interface QualityRecorder {
  report: DataQualityReport;
  exclude(kind: CsvKind, row: RawRow, reason: ExclusionReason, detail?: string): void;
  /** Idempotent per (item, reason): flagging the same item twice counts once. */
  flag(kind: CsvKind, item: Flaggable, reason: FlagReason, detail?: string): void;
}

function emptyBuckets<R extends string>(reasons: readonly R[]): Record<R, ReasonBucket> {
  const buckets = {} as Record<R, ReasonBucket>;
  for (const r of reasons) buckets[r] = { count: 0, examples: [] };
  return buckets;
}

export function createRecorder(
  inputRows: Record<CsvKind, number>,
  parseWarnings: Record<CsvKind, ParseWarning[]> = { orders: [], events: [] },
): QualityRecorder {
  const report: DataQualityReport = {
    inputRows,
    parseWarnings,
    excluded: emptyBuckets(EXCLUSION_REASONS),
    flagged: emptyBuckets(FLAG_REASONS),
  };
  const record = (bucket: ReasonBucket, kind: CsvKind, row: RawRow, detail?: string) => {
    bucket.count++;
    if (bucket.examples.length < EXAMPLES_PER_REASON) bucket.examples.push({ kind, row, detail });
  };
  return {
    report,
    exclude: (kind, row, reason, detail) => record(report.excluded[reason], kind, row, detail),
    flag: (kind, item, reason, detail) => {
      if (item.flags.includes(reason)) return;
      item.flags.push(reason);
      record(report.flagged[reason], kind, item.raw, detail);
    },
  };
}

export interface CleanResult {
  orders: Order[];
  events: KitEvent[];
  report: DataQualityReport;
  recorder: QualityRecorder;
  /** Max valid event time (fallback: max order created_at). Null if no usable rows. */
  asOf: number | null;
}

const lower = (v: string | undefined) => (v ?? '').trim().toLowerCase();
const trimmed = (v: string | undefined) => (v ?? '').trim();
const oneOf = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v);

function parseIsTest(v: string): boolean | null {
  if (oneOf(IS_TEST_TRUE, v)) return true;
  if (oneOf(IS_TEST_FALSE, v)) return false;
  return null;
}

export function clean(
  rawOrders: RawRow[],
  rawEvents: RawRow[],
  parseWarnings?: Record<CsvKind, ParseWarning[]>,
): CleanResult {
  const q = createRecorder({ orders: rawOrders.length, events: rawEvents.length }, parseWarnings);

  // ---- Orders: required fields → timestamp → product/status/is_test → duplicate.
  const orders: Order[] = [];
  const orderById = new Map<string, Order>();
  /** order_id → why it was excluded, so its events are attributed correctly. */
  const excludedOrderIds = new Map<string, ExclusionReason>();
  const excludeOrder = (row: RawRow, id: string, reason: ExclusionReason, detail?: string) => {
    q.exclude('orders', row, reason, detail);
    if (id && !orderById.has(id) && !excludedOrderIds.has(id)) excludedOrderIds.set(id, reason);
  };

  for (const row of rawOrders) {
    const f = row.fields;
    const orderId = trimmed(f.order_id);
    if (!orderId) { q.exclude('orders', row, 'missing_required_field', 'order_id is blank'); continue; }
    const ts = parseTimestamp(f.created_at ?? '');
    if (!ts) { excludeOrder(row, orderId, 'unparseable_timestamp', `created_at = "${f.created_at ?? ''}"`); continue; }
    const product = lower(f.product);
    if (!oneOf(PRODUCTS, product)) { excludeOrder(row, orderId, 'unknown_product', `product = "${f.product ?? ''}"`); continue; }
    const status = lower(f.status);
    if (!oneOf(STATUSES, status)) { excludeOrder(row, orderId, 'unknown_status', `status = "${f.status ?? ''}"`); continue; }
    const isTest = parseIsTest(lower(f.is_test));
    if (isTest === null) { excludeOrder(row, orderId, 'unknown_is_test', `is_test = "${f.is_test ?? ''}"`); continue; }
    if (orderById.has(orderId)) { q.exclude('orders', row, 'duplicate_order', `order_id ${orderId} seen earlier`); continue; }

    const order: Order = {
      orderId,
      createdAt: ts.ms,
      customerId: trimmed(f.customer_id),
      product: product as Product,
      country: trimmed(f.country).toUpperCase(),
      status: status as OrderStatus,
      isTest,
      raw: row,
      flags: [],
    };
    if (ts.naive) q.flag('orders', order, 'naive_timestamp');
    if (!order.customerId) q.flag('orders', order, 'missing_customer_id');
    // A valid later row wins over an earlier invalid one for event attribution.
    excludedOrderIds.delete(orderId);
    orders.push(order);
    orderById.set(orderId, order);
  }

  // ---- Events: required → timestamp → event_type → order exists → kit/order conflict → upload_only → dedupe.
  const candidates: KitEvent[] = [];
  const naiveEvents = new Set<KitEvent>();
  for (const row of rawEvents) {
    const f = row.fields;
    const orderId = trimmed(f.order_id);
    const kitId = trimmed(f.kit_id);
    if (!orderId || !kitId) {
      q.exclude('events', row, 'missing_required_field', !orderId ? 'order_id is blank' : 'kit_id is blank');
      continue;
    }
    const ts = parseTimestamp(f.occurred_at ?? '');
    if (!ts) { q.exclude('events', row, 'unparseable_timestamp', `occurred_at = "${f.occurred_at ?? ''}"`); continue; }
    const type = lower(f.event_type);
    if (!oneOf(EVENT_TYPES, type)) { q.exclude('events', row, 'unknown_event_type', `event_type = "${f.event_type ?? ''}"`); continue; }
    if (!orderById.has(orderId)) {
      const why = excludedOrderIds.get(orderId);
      if (why) q.exclude('events', row, 'order_excluded', `order ${orderId} excluded: ${why}`);
      else q.exclude('events', row, 'orphan_order_id', `order ${orderId} not in orders file`);
      continue;
    }
    const source = lower(f.source);
    const ev: KitEvent = {
      eventId: trimmed(f.event_id),
      orderId,
      kitId,
      type: type as EventType,
      at: ts.ms,
      source: oneOf(SOURCES, source) ? (source as EventSource) : null,
      raw: row,
      flags: [],
    };
    if (ts.naive) naiveEvents.add(ev);
    candidates.push(ev);
  }

  // A kit belongs to the order of its earliest event (ties: file order), independent of row order.
  const kitOwner = new Map<string, KitEvent>();
  for (const ev of candidates) {
    const cur = kitOwner.get(ev.kitId);
    if (!cur || ev.at < cur.at) kitOwner.set(ev.kitId, ev);
  }

  const events: KitEvent[] = [];
  const seen = new Set<string>();
  for (const ev of candidates) {
    const owner = kitOwner.get(ev.kitId)!;
    if (owner.orderId !== ev.orderId) {
      q.exclude('events', ev.raw, 'kit_order_conflict', `kit ${ev.kitId} belongs to ${owner.orderId}, not ${ev.orderId}`);
      continue;
    }
    const order = orderById.get(ev.orderId)!;
    if (!KIT_PRODUCTS.includes(order.product)) {
      q.exclude('events', ev.raw, 'upload_only_event', `order ${order.orderId} is ${order.product}`);
      q.flag('orders', order, 'upload_only_has_events');
      continue;
    }
    const key = `${ev.kitId}|${ev.type}|${ev.at}`;
    if (seen.has(key)) {
      q.exclude('events', ev.raw, 'duplicate_event', `same kit, event_type and instant as an earlier row`);
      continue;
    }
    seen.add(key);
    if (naiveEvents.has(ev)) q.flag('events', ev, 'naive_timestamp');
    if (ev.source === null) q.flag('events', ev, 'unknown_source', `source = "${ev.raw.fields.source ?? ''}"`);
    events.push(ev);
  }

  // ---- asOf comes from the data only, never the wall clock.
  let asOf: number | null = null;
  for (const ev of events) if (asOf === null || ev.at > asOf) asOf = ev.at;
  if (asOf === null) for (const o of orders) if (asOf === null || o.createdAt > asOf) asOf = o.createdAt;

  if (asOf !== null) {
    for (const o of orders) if (o.createdAt > asOf) q.flag('orders', o, 'after_asof');
  }
  for (const ev of events) {
    const order = orderById.get(ev.orderId)!;
    if (ev.at < order.createdAt) q.flag('events', ev, 'before_order_created');
  }

  return { orders, events, report: q.report, recorder: q, asOf };
}
