import Papa from 'papaparse';
import { REQUIRED_COLUMNS, type CsvKind } from './config';
import type { ParsedTimestamp, ParseResult, ParseWarning, RawRow } from './types';

const BOM = '\uFEFF';

/** "  Order ID " / "ORDER-ID" / "<BOM>order_id" → "order_id". */
export function normalizeHeader(h: string): string {
  return h.replace(BOM, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Which file is this, judged by its header row? Null if it matches neither. */
export function detectKind(text: string): CsvKind | null {
  const firstLine = text.replace(BOM, '').split(/\r\n|\n|\r/).find((l) => l.trim() !== '') ?? '';
  const headers = new Set(
    (Papa.parse<string[]>(firstLine, { header: false }).data[0] ?? []).map(normalizeHeader),
  );
  const kinds = Object.keys(REQUIRED_COLUMNS) as CsvKind[];
  return kinds.find((k) => REQUIRED_COLUMNS[k].every((c) => headers.has(c))) ?? null;
}

/**
 * CSV text → raw rows keyed by normalized header. Never throws.
 * Values are not trimmed or altered here; that is clean.ts's job.
 */
export function parseCsv(text: string, kind: CsvKind): ParseResult {
  const required: readonly string[] = REQUIRED_COLUMNS[kind];
  let result: Papa.ParseResult<Record<string, unknown>>;
  try {
    result = Papa.parse<Record<string, unknown>>(text.replace(BOM, ''), {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: normalizeHeader,
    });
  } catch (e) {
    return { ok: false, kind, error: `Could not read ${kind} CSV: ${String(e)}`, missingColumns: [] };
  }

  const headers = result.meta.fields ?? [];
  const missingColumns = required.filter((c) => !headers.includes(c));
  if (missingColumns.length > 0) {
    return {
      ok: false,
      kind,
      error:
        headers.length === 0
          ? `The ${kind} file is empty or has no header row.`
          : `The ${kind} file is missing required column(s): ${missingColumns.join(', ')}. ` +
            `Found: ${headers.join(', ')}.`,
      missingColumns,
    };
  }

  const warnings: ParseWarning[] = [];
  for (const err of result.errors) {
    // Delimiter guessing is noise for single-column or tiny files.
    if (err.code === 'UndetectableDelimiter') continue;
    warnings.push({ row: (err.row ?? -1) + 1, message: err.message });
  }

  const rows: RawRow[] = result.data.map((rec, i) => {
    const fields: Record<string, string> = {};
    for (const h of headers) {
      const v = rec[h];
      fields[h] = typeof v === 'string' ? v : '';
    }
    return { row: i + 1, fields };
  });

  return { ok: true, kind, rows, warnings };
}

// YYYY-MM-DD[T ]HH:MM[:SS[.fff]][Z|±HH[:MM]]
const TS_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

const MAX_OFFSET_HOURS = 14;
const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60_000;

/**
 * Strict timestamp parser. Accepts ISO-8601 with Z or a numeric offset, or a
 * zone-less "YYYY-MM-DD HH:MM[:SS]" which is read as UTC and marked naive.
 * Returns null for anything else (including impossible dates like Feb 30).
 * Never uses `new Date(string)`, whose handling of ambiguous input varies.
 */
export function parseTimestamp(input: string): ParsedTimestamp | null {
  const m = TS_RE.exec(input.trim());
  if (!m) return null;
  const [, ys, mos, ds, hs, mis, ss = '0', frac = '', tz] = m;
  const y = Number(ys), mo = Number(mos), d = Number(ds);
  const h = Number(hs), mi = Number(mis), s = Number(ss);
  const ms = Number(frac.padEnd(3, '0').slice(0, 3));

  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59) return null;
  const local = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  if (new Date(local).getUTCDate() !== d) return null; // e.g. 2026-02-30

  if (!tz) return { ms: local, naive: true };
  if (tz.toUpperCase() === 'Z') return { ms: local, naive: false };

  const sign = tz.startsWith('-') ? -1 : 1;
  const digits = tz.slice(1).replace(':', '');
  const oh = Number(digits.slice(0, 2));
  const om = Number(digits.slice(2) || '0');
  if (oh > MAX_OFFSET_HOURS || om >= MINUTES_PER_HOUR) return null;
  const offsetMs = sign * (oh * MINUTES_PER_HOUR + om) * MS_PER_MINUTE;
  return { ms: local - offsetMs, naive: false };
}
