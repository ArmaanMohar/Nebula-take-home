import {
  EVENT_TYPES,
  KIT_PRODUCTS,
  STAGES,
  STAGE_BY_ID,
  type EventType,
  type Owner,
  type Product,
  type StageId,
} from './config';
import {
  EXCLUSION_REASONS,
  FLAG_REASONS,
  REASON_LABELS,
  type DataQualityReport,
  type ExclusionReason,
  type FlagReason,
  type OrderModel,
  type OrderState,
  type ReasonBucket,
  type StageInstance,
} from './types';

// ---------- Filters ----------

export interface Filters {
  /** Inclusive UTC calendar days on order created_at, "YYYY-MM-DD". */
  from: string | null;
  to: string | null;
  /** Empty = all. */
  products: Product[];
  /** Empty = all. Blank country is the empty string. */
  countries: string[];
  includeTest: boolean;
}

export const DEFAULT_FILTERS: Filters = { from: null, to: null, products: [], countries: [], includeTest: false };

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function applyFilters(models: OrderModel[], f: Filters): OrderModel[] {
  return models.filter(({ order }) => {
    if (!f.includeTest && order.isTest) return false;
    if (f.products.length && !f.products.includes(order.product)) return false;
    if (f.countries.length && !f.countries.includes(order.country)) return false;
    if (f.from || f.to) {
      const day = utcDay(order.createdAt);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
    }
    return true;
  });
}

export function filterOptions(models: OrderModel[]) {
  const countries = [...new Set(models.map((m) => m.order.country))].sort();
  const products = [...new Set(models.map((m) => m.order.product))].sort();
  const days = models.map((m) => utcDay(m.order.createdAt)).sort();
  return { countries, products, minDay: days[0] ?? null, maxDay: days[days.length - 1] ?? null };
}

// ---------- Stats ----------

export interface Stat {
  n: number;
  median: number | null;
  p90: number | null;
}

/** Linear interpolation between closest ranks (numpy default). */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
}

const MEDIAN = 0.5;
const P90 = 0.9;

export function stat(values: number[]): Stat {
  return { n: values.length, median: percentile(values, MEDIAN), p90: percentile(values, P90) };
}

// ---------- Overview ----------

/** Where an order is right now: its active kit's latest pipeline event, or an order-level state. */
export type CurrentBucket =
  | 'awaiting_shipment'
  | Exclude<EventType, 'report_ready' | 'kit_replaced'>
  | 'awaiting_replacement'
  | 'complete'
  | 'refunded_cancelled';

export const CURRENT_BUCKETS: readonly CurrentBucket[] = [
  'awaiting_shipment',
  ...EVENT_TYPES.filter((t): t is Exclude<EventType, 'report_ready' | 'kit_replaced'> => t !== 'report_ready' && t !== 'kit_replaced'),
  'awaiting_replacement',
  'complete',
  'refunded_cancelled',
];

export const BUCKET_LABELS: Record<CurrentBucket, string> = {
  awaiting_shipment: 'Awaiting shipment',
  kit_shipped: 'Shipped',
  kit_delivered: 'Delivered',
  sample_mailed: 'Sample mailed',
  sample_received: 'Received at lab',
  qc_passed: 'QC passed',
  qc_failed: 'QC failed',
  sequencing_complete: 'Sequenced',
  awaiting_replacement: 'Awaiting replacement',
  complete: 'Report ready',
  refunded_cancelled: 'Refunded / cancelled (not finished)',
};

export function currentBucket(m: OrderModel): CurrentBucket | null {
  if (m.state === 'not_in_pipeline') return null;
  if (m.state === 'complete') return 'complete';
  if (m.order.status !== 'paid') return 'refunded_cancelled';
  if (m.state === 'awaiting_shipment' || m.state === 'awaiting_replacement') return m.state;
  return m.activeKit!.lastEvent.type as CurrentBucket;
}

export interface Overview {
  orders: number;
  byProduct: Record<Product, number>;
  byStatus: Record<OrderModel['order']['status'], number>;
  kitOrders: number;
  /** Paid kit orders not yet complete. */
  inProgress: number;
  /** Orders whose final kit reached report_ready. */
  finished: number;
  /** finished / kitOrders, 0–1. Null when there are no kit orders. */
  finishedShare: number | null;
  stuck: number;
  /** Share = count / all kit orders in a bucket, 0–1. */
  current: { bucket: CurrentBucket; label: string; count: number; share: number }[];
  /** created_at → report_ready, paid kit orders. */
  turnaround: Stat;
}

export function overview(models: OrderModel[]): Overview {
  const byProduct = { wgs_30x: 0, wgs_100x: 0, upload_only: 0 };
  const byStatus = { paid: 0, refunded: 0, cancelled: 0 };
  const current = new Map<CurrentBucket, number>();
  const inProgressStates: OrderState[] = ['awaiting_shipment', 'awaiting_replacement', 'in_progress'];
  let inProgress = 0;
  const kitOrders = models.filter((m) => KIT_PRODUCTS.includes(m.order.product)).length;
  const finished = models.filter((m) => m.state === 'complete').length;
  let bucketed = 0;
  for (const m of models) {
    byProduct[m.order.product]++;
    byStatus[m.order.status]++;
    const b = currentBucket(m);
    if (b) {
      current.set(b, (current.get(b) ?? 0) + 1);
      bucketed++;
    }
    if (m.inPipelineStats && inProgressStates.includes(m.state)) inProgress++;
  }
  return {
    orders: models.length,
    byProduct,
    byStatus,
    kitOrders,
    inProgress,
    finished,
    finishedShare: kitOrders ? finished / kitOrders : null,
    stuck: models.filter((m) => m.stuck).length,
    current: CURRENT_BUCKETS.map((bucket) => {
      const count = current.get(bucket) ?? 0;
      return { bucket, label: BUCKET_LABELS[bucket], count, share: bucketed ? count / bucketed : 0 };
    }),
    turnaround: stat(
      models.filter((m) => m.inPipelineStats && m.turnaroundDays !== undefined).map((m) => m.turnaroundDays!),
    ),
  };
}

// ---------- Stage durations ----------

export type KitProduct = Exclude<Product, 'upload_only'>;

export interface DurationCell extends Stat {
  /** Share of completed instances over target, 0–1. Null when n = 0. */
  pctOver: number | null;
  openNow: number;
  openOver: number;
}

export interface DurationRow {
  stageId: StageId;
  label: string;
  targetDays: number;
  owner: Owner;
  all: DurationCell;
  byProduct: Record<KitProduct, DurationCell>;
}

function durationCell(instances: StageInstance[]): DurationCell {
  const done = instances.filter((s) => s.status === 'done_ok' || s.status === 'done_over');
  const over = done.filter((s) => s.status === 'done_over').length;
  return {
    ...stat(done.map((s) => s.days!)),
    pctOver: done.length ? over / done.length : null,
    openNow: instances.filter((s) => s.status === 'open_ok' || s.status === 'open_over').length,
    openOver: instances.filter((s) => s.status === 'open_over').length,
  };
}

/** Completed-instance stats per stage × product. Paid kit orders only. */
export function stageDurations(models: OrderModel[]): DurationRow[] {
  const eligible = models.filter((m) => m.inPipelineStats);
  return STAGES.map((stage) => {
    const of = (ms: OrderModel[]) => ms.flatMap((m) => m.stages.filter((s) => s.stageId === stage.id));
    return {
      stageId: stage.id,
      label: stage.label,
      targetDays: stage.targetDays,
      owner: stage.owner,
      all: durationCell(of(eligible)),
      byProduct: {
        wgs_30x: durationCell(of(eligible.filter((m) => m.order.product === 'wgs_30x'))),
        wgs_100x: durationCell(of(eligible.filter((m) => m.order.product === 'wgs_100x'))),
      },
    };
  });
}

// ---------- Stuck ----------

export interface StuckRow {
  orderId: string;
  kitId: string | null;
  customerId: string;
  product: Product;
  country: string;
  stageId: StageId;
  stageLabel: string;
  owner: Owner;
  state: OrderState;
  /** Stage start: last relevant event, or order created_at / kit_replaced. */
  since: number;
  daysInStage: number;
  targetDays: number;
  daysOver: number;
  lastEventAt: number | null;
}

/** Stuck orders, worst (most days over target) first. */
export function stuckList(models: OrderModel[]): StuckRow[] {
  return models
    .filter((m) => m.stuck && m.openStage)
    .map((m) => {
      const s = m.openStage!;
      const def = STAGE_BY_ID[s.stageId];
      return {
        orderId: m.order.orderId,
        kitId: s.kitId,
        customerId: m.order.customerId,
        product: m.order.product,
        country: m.order.country,
        stageId: s.stageId,
        stageLabel: def.label,
        owner: def.owner,
        state: m.state,
        since: s.start!,
        daysInStage: s.days!,
        targetDays: def.targetDays,
        daysOver: s.days! - def.targetDays,
        lastEventAt: m.lastEventAt ?? null,
      };
    })
    .sort((a, b) => b.daysOver - a.daysOver || a.orderId.localeCompare(b.orderId));
}

/** Stuck row counts per owner and per stage, for the Stuck view's filters. */
export function stuckBreakdown(rows: StuckRow[]) {
  const byOwner: Partial<Record<Owner, number>> = {};
  const byStage: Partial<Record<StageId, number>> = {};
  for (const r of rows) {
    byOwner[r.owner] = (byOwner[r.owner] ?? 0) + 1;
    byStage[r.stageId] = (byStage[r.stageId] ?? 0) + 1;
  }
  return { byOwner, byStage };
}

// ---------- Order detail ----------

export function findOrder(models: OrderModel[], orderId: string): OrderModel | undefined {
  const id = orderId.trim();
  return models.find((m) => m.order.orderId === id);
}

/** All flags on the order and its kits' events. */
export function orderFlags(m: OrderModel): FlagReason[] {
  return [...new Set([...m.order.flags, ...m.kits.flatMap((k) => k.flags)])];
}

// ---------- Data quality ----------

export interface QualityLine {
  type: 'excluded' | 'flagged';
  reason: ExclusionReason | FlagReason;
  label: string;
  bucket: ReasonBucket;
}

/** Non-zero reasons, exclusions first, each sorted by count. Dataset-level (not filtered). */
export function qualitySummary(report: DataQualityReport): QualityLine[] {
  const lines = (type: QualityLine['type'], reasons: readonly (ExclusionReason | FlagReason)[], buckets: Record<string, ReasonBucket>) =>
    reasons
      .map((reason) => ({ type, reason, label: REASON_LABELS[reason], bucket: buckets[reason]! }))
      .filter((l) => l.bucket.count > 0)
      .sort((a, b) => b.bucket.count - a.bucket.count);
  return [...lines('excluded', EXCLUSION_REASONS, report.excluded), ...lines('flagged', FLAG_REASONS, report.flagged)];
}

export function qualityTotals(report: DataQualityReport) {
  const sum = (b: Record<string, ReasonBucket>) => Object.values(b).reduce((n, x) => n + x.count, 0);
  return { excluded: sum(report.excluded), flagged: sum(report.flagged) };
}

// ---------- CSV export ----------

/** Escapes quotes/commas/newlines and neutralizes spreadsheet formulas. */
export function toCsv<T>(rows: T[], columns: { header: string; value: (row: T) => string | number | null }[]): string {
  const cell = (v: string | number | null) => {
    if (v === null) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(','));
  return lines.join('\r\n') + '\r\n';
}

const round1 = (d: number) => Math.round(d * 10) / 10;
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export function stuckCsv(rows: StuckRow[]): string {
  return toCsv(rows, [
    { header: 'order_id', value: (r) => r.orderId },
    { header: 'kit_id', value: (r) => r.kitId },
    { header: 'customer_id', value: (r) => r.customerId },
    { header: 'product', value: (r) => r.product },
    { header: 'country', value: (r) => r.country },
    { header: 'stage', value: (r) => r.stageLabel },
    { header: 'owner', value: (r) => r.owner },
    { header: 'in_stage_since', value: (r) => iso(r.since) },
    { header: 'days_in_stage', value: (r) => round1(r.daysInStage) },
    { header: 'target_days', value: (r) => r.targetDays },
    { header: 'days_over', value: (r) => round1(r.daysOver) },
    { header: 'last_event_at', value: (r) => iso(r.lastEventAt) },
  ]);
}
