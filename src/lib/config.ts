// Single source of truth for the pipeline: stage order, targets, owners, and
// the vocabularies used to validate CSV values. No day counts anywhere else.

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Medians/p90s with fewer samples than this are visually de-emphasized. */
export const SMALL_N = 5;

/** Example rows kept per exclusion/flag reason in the Data Quality report. */
export const EXAMPLES_PER_REASON = 5;

export const REQUIRED_COLUMNS = {
  orders: ['order_id', 'created_at', 'customer_id', 'product', 'country', 'status', 'is_test'],
  events: ['event_id', 'order_id', 'kit_id', 'event_type', 'occurred_at', 'source'],
} as const;

export type CsvKind = keyof typeof REQUIRED_COLUMNS;
export type OrderColumn = (typeof REQUIRED_COLUMNS.orders)[number];
export type EventColumn = (typeof REQUIRED_COLUMNS.events)[number];

export const EVENT_TYPES = [
  'kit_shipped',
  'kit_delivered',
  'sample_mailed',
  'sample_received',
  'qc_passed',
  'qc_failed',
  'sequencing_complete',
  'report_ready',
  'kit_replaced',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Pipeline position, used for out-of-order checks. QC outcomes share a rank. */
export const EVENT_RANK: Record<EventType, number> = {
  kit_shipped: 1,
  kit_delivered: 2,
  sample_mailed: 3,
  sample_received: 4,
  qc_passed: 5,
  qc_failed: 5,
  sequencing_complete: 6,
  report_ready: 7,
  kit_replaced: 8,
};

export const PRODUCTS = ['wgs_30x', 'wgs_100x', 'upload_only'] as const;
export type Product = (typeof PRODUCTS)[number];
/** Products that ship a physical kit and enter the pipeline. */
export const KIT_PRODUCTS: readonly Product[] = ['wgs_30x', 'wgs_100x'];

export const STATUSES = ['paid', 'refunded', 'cancelled'] as const;
export type OrderStatus = (typeof STATUSES)[number];

export const SOURCES = ['carrier', 'lab', 'system'] as const;
export type EventSource = (typeof SOURCES)[number];

export const IS_TEST_TRUE = ['true', '1', 'yes', 'y', 't'] as const;
export const IS_TEST_FALSE = ['false', '0', 'no', 'n', 'f', ''] as const;

export type Owner = 'fulfillment' | 'carrier' | 'customer' | 'lab' | 'support';

export type StageId = 'ship' | 'deliver' | 'mail' | 'receive' | 'qc' | 'sequence' | 'report' | 'replace';

export interface StageDef {
  id: StageId;
  label: string;
  /** Event that starts the stage; null = order created_at (or predecessor's kit_replaced). */
  start: EventType | null;
  /** Any of these events ends the stage. */
  end: readonly EventType[];
  targetDays: number;
  /** Who the kit is waiting on while this stage is open. */
  owner: Owner;
}

const QC_TARGET_DAYS = 7;

export const STAGES: readonly StageDef[] = [
  { id: 'ship', label: 'Order → Shipped', start: null, end: ['kit_shipped'], targetDays: 3, owner: 'fulfillment' },
  { id: 'deliver', label: 'Shipped → Delivered', start: 'kit_shipped', end: ['kit_delivered'], targetDays: 7, owner: 'carrier' },
  { id: 'mail', label: 'Delivered → Sample mailed', start: 'kit_delivered', end: ['sample_mailed'], targetDays: 45, owner: 'customer' },
  { id: 'receive', label: 'Mailed → Received', start: 'sample_mailed', end: ['sample_received'], targetDays: 14, owner: 'carrier' },
  { id: 'qc', label: 'Received → QC result', start: 'sample_received', end: ['qc_passed', 'qc_failed'], targetDays: QC_TARGET_DAYS, owner: 'lab' },
  { id: 'sequence', label: 'QC passed → Sequenced', start: 'qc_passed', end: ['sequencing_complete'], targetDays: 28, owner: 'lab' },
  { id: 'report', label: 'Sequenced → Report ready', start: 'sequencing_complete', end: ['report_ready'], targetDays: 5, owner: 'lab' },
  { id: 'replace', label: 'QC failed → Replacement', start: 'qc_failed', end: ['kit_replaced'], targetDays: QC_TARGET_DAYS, owner: 'support' },
];

export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<StageId, StageDef>;
