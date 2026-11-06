import type { CsvKind, EventSource, EventType, OrderStatus, Product, StageId } from './config';

/** One CSV data row exactly as read: normalized header → untouched string value. */
export interface RawRow {
  /** 1-based data row number (header excluded, blank lines skipped). */
  row: number;
  fields: Record<string, string>;
}

export interface ParseWarning {
  row: number;
  message: string;
}

export type ParseResult =
  | { ok: true; kind: CsvKind; rows: RawRow[]; warnings: ParseWarning[] }
  | { ok: false; kind: CsvKind; error: string; missingColumns: string[] };

export interface ParsedTimestamp {
  /** UTC epoch milliseconds. */
  ms: number;
  /** True when the source string had no timezone and was read as UTC. */
  naive: boolean;
}

export const EXCLUSION_REASONS = [
  'missing_required_field',
  'unparseable_timestamp',
  'unknown_event_type',
  'unknown_product',
  'unknown_status',
  'unknown_is_test',
  'orphan_order_id',
  'order_excluded',
  'duplicate_event',
  'duplicate_order',
  'kit_order_conflict',
  'upload_only_event',
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const FLAG_REASONS = [
  'naive_timestamp',
  'repeated_stage',
  'out_of_order',
  'missing_scan',
  'after_asof',
  'before_order_created',
  'event_after_replaced',
  'unknown_source',
  'upload_only_has_events',
  'missing_customer_id',
  'unlinked_kit',
] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

/** Short human-readable labels for the Data Quality view. */
export const REASON_LABELS: Record<ExclusionReason | FlagReason, string> = {
  missing_required_field: 'Required field is blank',
  unparseable_timestamp: 'Timestamp could not be parsed',
  unknown_event_type: 'Unknown event type',
  unknown_product: 'Unknown product',
  unknown_status: 'Unknown order status',
  unknown_is_test: 'Unrecognized is_test value',
  orphan_order_id: 'Event for an order not in orders file',
  order_excluded: 'Event for an order that was excluded',
  duplicate_event: 'Duplicate event (same kit, type, instant)',
  duplicate_order: 'Duplicate order_id (first kept)',
  kit_order_conflict: 'Kit appears on more than one order',
  upload_only_event: 'Event on an upload-only order',
  naive_timestamp: 'Timestamp had no timezone (read as UTC)',
  repeated_stage: 'Stage event repeated (first used)',
  out_of_order: 'Events out of pipeline order',
  missing_scan: 'Missing intermediate scan',
  after_asof: 'Timestamp after data as-of',
  before_order_created: 'Event before order was created',
  event_after_replaced: 'Event on kit after it was replaced',
  unknown_source: 'Unknown event source',
  upload_only_has_events: 'Upload-only order has kit events',
  missing_customer_id: 'Order has no customer_id',
  unlinked_kit: 'Extra kit on order without a kit_replaced link',
};

export interface Order {
  orderId: string;
  createdAt: number;
  customerId: string;
  product: Product;
  country: string;
  status: OrderStatus;
  isTest: boolean;
  raw: RawRow;
  flags: FlagReason[];
}

export interface KitEvent {
  eventId: string;
  orderId: string;
  kitId: string;
  type: EventType;
  at: number;
  /** Null when the source value is not a known source (flagged, event kept). */
  source: EventSource | null;
  raw: RawRow;
  flags: FlagReason[];
}

export interface ReasonBucket {
  count: number;
  examples: { kind: CsvKind; row: RawRow; detail?: string }[];
}

export interface DataQualityReport {
  inputRows: Record<CsvKind, number>;
  parseWarnings: Record<CsvKind, ParseWarning[]>;
  excluded: Record<ExclusionReason, ReasonBucket>;
  flagged: Record<FlagReason, ReasonBucket>;
}

export type KitState = 'open' | 'complete' | 'replaced';

export interface Kit {
  kitId: string;
  orderId: string;
  /** All kept events, sorted by instant (ties: pipeline rank, then file row). */
  events: KitEvent[];
  /** First occurrence of each event type, up to and including kit_replaced. */
  firstAt: Partial<Record<EventType, number>>;
  state: KitState;
  /** Latest pipeline event that defines current stage (highest rank; ties: latest instant). */
  lastEvent: KitEvent;
  replaces?: string;
  replacedBy?: string;
  /** Union of its events' flags, for display. */
  flags: FlagReason[];
}

export type StageStatus = 'done_ok' | 'done_over' | 'open_ok' | 'open_over' | 'excluded';
export type StageExclusion = 'missing_scan' | 'out_of_order' | 'negative_duration' | 'kit_closed';

export interface StageInstance {
  stageId: StageId;
  /** Null for the ship stage of a kit that doesn't exist yet. */
  kitId: string | null;
  start?: number;
  end?: number;
  /** Fractional calendar days; for open stages, asOf − start. */
  days?: number;
  status: StageStatus;
  excludedBy?: StageExclusion;
}

export type OrderState =
  | 'not_in_pipeline' // upload_only
  | 'awaiting_shipment'
  | 'awaiting_replacement'
  | 'in_progress'
  | 'complete';

export interface OrderModel {
  order: Order;
  /** Chain order: by first event instant. */
  kits: Kit[];
  activeKit?: Kit;
  state: OrderState;
  /** All stage instances across kits, chain order then pipeline order. */
  stages: StageInstance[];
  /** The stage currently being waited on, if any. */
  openStage?: StageInstance;
  lastEventAt?: number;
  /** created_at → report_ready on the final kit. */
  turnaroundDays?: number;
  /** Paid, kit product: counts toward durations/SLA. */
  inPipelineStats: boolean;
  /** inPipelineStats, non-test, open stage over target. */
  stuck: boolean;
}
