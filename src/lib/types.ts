import type { CsvKind, EventSource, EventType, OrderStatus, Product } from './config';

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
] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

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
