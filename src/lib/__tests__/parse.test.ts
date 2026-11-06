import { describe, expect, it } from 'vitest';
import { detectKind, normalizeHeader, parseCsv, parseTimestamp } from '../parse';
import messyOrders from './fixtures/parse_messy_orders.csv?raw';
import missingColumnEvents from './fixtures/parse_missing_column_events.csv?raw';
import raggedEvents from './fixtures/parse_ragged_events.csv?raw';

describe('parseCsv', () => {
  it('handles BOM, CRLF, blank lines, quotes, reordered/extra columns and header case', () => {
    expect(messyOrders.startsWith('\uFEFF')).toBe(true);
    expect(messyOrders).toContain('\r\n');

    const res = parseCsv(messyOrders, 'orders');
    if (!res.ok) throw new Error(res.error);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]?.fields).toMatchObject({
      order_id: 'ord_1',
      created_at: '2026-05-01T10:00:00Z',
      status: ' paid ', // values are not altered at parse time
      product: 'WGS_30x',
      notes: 'rush, VIP',
    });
    expect(res.rows[1]?.fields.is_test).toBe('');
    expect(res.rows.map((r) => r.row)).toEqual([1, 2]);
  });

  it('reports a missing required column without throwing', () => {
    const res = parseCsv(missingColumnEvents, 'events');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.missingColumns).toEqual(['kit_id']);
    expect(res.error).toMatch(/kit_id/);
  });

  it('reports empty input as a clear error', () => {
    const res = parseCsv('', 'orders');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/empty/);
  });

  it('keeps ragged rows (short rows get blank fields) and warns', () => {
    const res = parseCsv(raggedEvents, 'events');
    if (!res.ok) throw new Error(res.error);
    expect(res.rows).toHaveLength(3);
    expect(res.rows[1]?.fields).toMatchObject({ kit_id: 'kit_1', event_type: '', occurred_at: '' });
    expect(res.rows[2]?.fields.event_type).toBe('kit_delivered');
    expect(res.warnings.map((w) => w.row)).toEqual([2, 3]);
  });

  it('does not throw on binary-ish garbage', () => {
    expect(() => parseCsv('\u0000\u0001\u0002,,,\n"unterminated', 'events')).not.toThrow();
  });
});

describe('detectKind', () => {
  it('identifies files by header, not filename', () => {
    expect(detectKind(messyOrders)).toBe('orders');
    expect(detectKind(raggedEvents)).toBe('events');
    expect(detectKind(missingColumnEvents)).toBeNull();
    expect(detectKind('')).toBeNull();
  });

  it('normalizes header spacing, case, hyphens and BOM', () => {
    expect(normalizeHeader('\uFEFF  Order ID ')).toBe('order_id');
    expect(normalizeHeader('EVENT-TYPE')).toBe('event_type');
  });
});

describe('parseTimestamp', () => {
  const instant = Date.UTC(2026, 4, 1, 15, 0, 0);

  it('resolves Z, offsets and naive strings to the same UTC instant', () => {
    expect(parseTimestamp('2026-05-01T15:00:00Z')).toEqual({ ms: instant, naive: false });
    expect(parseTimestamp('2026-05-01T10:00:00-05:00')).toEqual({ ms: instant, naive: false });
    expect(parseTimestamp('2026-05-01T20:30:00+05:30')).toEqual({ ms: instant, naive: false });
    expect(parseTimestamp('2026-05-01T20:30:00+0530')).toEqual({ ms: instant, naive: false });
    expect(parseTimestamp('2026-05-01 15:00:00')).toEqual({ ms: instant, naive: true });
    expect(parseTimestamp(' 2026-05-01t15:00:00z ')).toEqual({ ms: instant, naive: false });
  });

  it('keeps milliseconds', () => {
    expect(parseTimestamp('2026-05-01T15:00:00.250Z')?.ms).toBe(instant + 250);
  });

  it('rejects garbage and impossible dates', () => {
    for (const bad of ['', 'not a date', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z',
      '2026-05-01T24:00:00Z', '05/01/2026 10:00', '2026-05-01T10:00:00+25:00', '1714575600']) {
      expect(parseTimestamp(bad), bad).toBeNull();
    }
  });
});
