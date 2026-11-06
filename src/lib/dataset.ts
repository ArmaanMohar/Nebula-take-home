import { clean } from './clean';
import { REQUIRED_COLUMNS, type CsvKind } from './config';
import { buildModels } from './kits';
import { detectKind, parseCsv } from './parse';
import type { DataQualityReport, OrderModel, ParseWarning, RawRow } from './types';

export interface Dataset {
  models: OrderModel[];
  report: DataQualityReport;
  asOf: number;
  /** Where the data came from, for the header. */
  label: string;
}

export type LoadResult = { ok: true; dataset: Dataset } | { ok: false; errors: string[] };

export interface InputFile {
  name: string;
  text: string;
}

const KIND_NAMES: Record<CsvKind, string> = { orders: 'orders', events: 'kit events' };

/** Picks the closest kind for a file that matches neither, so the error names the right missing columns. */
function explainUnknown(file: InputFile): string {
  const attempts = (Object.keys(REQUIRED_COLUMNS) as CsvKind[]).map((k) => parseCsv(file.text, k));
  const best = attempts
    .filter((a) => !a.ok)
    .sort((a, b) => (a.ok || b.ok ? 0 : a.missingColumns.length - b.missingColumns.length))[0];
  if (!best || best.ok) return `${file.name}: could not identify the file.`;
  return `${file.name}: ${best.error}`;
}

/**
 * Two CSV texts (in any order, matched by header) → a ready dataset, or a list
 * of human-readable errors. Never throws.
 */
export function buildDataset(files: InputFile[], label: string): LoadResult {
  try {
    if (files.length !== 2) {
      return { ok: false, errors: [`Select exactly two CSV files (orders and kit events); got ${files.length}.`] };
    }
    const byKind: Partial<Record<CsvKind, { rows: RawRow[]; warnings: ParseWarning[] }>> = {};
    const errors: string[] = [];
    for (const file of files) {
      const kind = detectKind(file.text);
      if (!kind) { errors.push(explainUnknown(file)); continue; }
      if (byKind[kind]) { errors.push(`Both files look like ${KIND_NAMES[kind]} files. Select one orders and one kit events file.`); continue; }
      const res = parseCsv(file.text, kind);
      if (!res.ok) { errors.push(`${file.name}: ${res.error}`); continue; }
      byKind[kind] = { rows: res.rows, warnings: res.warnings };
    }
    if (errors.length) return { ok: false, errors };
    const orders = byKind.orders!;
    const events = byKind.events!;

    const c = clean(orders.rows, events.rows, { orders: orders.warnings, events: events.warnings });
    if (c.asOf === null || c.orders.length === 0) {
      return { ok: false, errors: ['No valid orders found after cleaning. Check that the files have data rows with valid order_id and created_at.'] };
    }
    return { ok: true, dataset: { models: buildModels(c.orders, c.events, c.asOf, c.recorder), report: c.report, asOf: c.asOf, label } };
  } catch (e) {
    return { ok: false, errors: [`Unexpected error while loading data: ${String(e)}`] };
  }
}
