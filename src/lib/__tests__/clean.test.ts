import { afterEach, describe, expect, it, vi } from 'vitest';
import { clean } from '../clean';
import { parseCsv } from '../parse';
import type { RawRow } from '../types';
import ordersCsv from './fixtures/clean_orders.csv?raw';
import eventsCsv from './fixtures/clean_events.csv?raw';

function rows(text: string, kind: 'orders' | 'events'): RawRow[] {
  const res = parseCsv(text, kind);
  if (!res.ok) throw new Error(res.error);
  return res.rows;
}

const run = () => clean(rows(ordersCsv, 'orders'), rows(eventsCsv, 'events'));
const excludedIds = (r: ReturnType<typeof run>, reason: keyof ReturnType<typeof run>['report']['excluded']) =>
  r.report.excluded[reason].examples.map((e) => e.row.fields.order_id || e.row.fields.event_id);

afterEach(() => vi.useRealTimers());

describe('clean: orders', () => {
  it('normalizes values and parses is_test variants', () => {
    const { orders } = run();
    const ok = orders.find((o) => o.orderId === 'ord_ok')!;
    expect(ok).toMatchObject({ product: 'wgs_30x', status: 'paid', country: 'US', isTest: false, customerId: 'cus_1' });
    expect(orders.find((o) => o.orderId === 'ord_naive')!.isTest).toBe(false); // blank
    expect(orders.find((o) => o.orderId === 'ord_test')!.isTest).toBe(true); // "Yes"
    expect(orders.find((o) => o.orderId === 'ord_up')!.isTest).toBe(false); // "0"
  });

  it('excludes each bad order with its reason; duplicate keeps the first', () => {
    const r = run();
    expect(r.orders.map((o) => o.orderId)).toEqual(['ord_ok', 'ord_naive', 'ord_test', 'ord_up', 'ord_late']);
    expect(r.orders[0]!.customerId).toBe('cus_1');
    expect(r.report.excluded.duplicate_order.count).toBe(1);
    expect(r.report.excluded.missing_required_field.examples.some((e) => e.kind === 'orders')).toBe(true);
    expect(excludedIds(r, 'unparseable_timestamp')).toContain('ord_badts');
    expect(excludedIds(r, 'unknown_product')).toEqual(['ord_badprod']);
    expect(excludedIds(r, 'unknown_status')).toEqual(['ord_badstatus']);
    expect(excludedIds(r, 'unknown_is_test')).toEqual(['ord_badtest']);
  });
});

describe('clean: events', () => {
  it('excludes each bad event with its reason', () => {
    const r = run();
    expect(r.events.map((e) => e.eventId)).toEqual(['e1', 'e4', 'e13', 'e14']);
    const byReason = (reason: Parameters<typeof excludedIds>[1]) =>
      r.report.excluded[reason].examples.filter((e) => e.kind === 'events').map((e) => e.row.fields.event_id);
    expect(byReason('duplicate_event')).toEqual(['e2', 'e3']); // same instant in -05:00, and exact copy
    expect(byReason('unknown_event_type')).toEqual(['e5']);
    expect(byReason('missing_required_field')).toEqual(['e6', 'e7']);
    expect(byReason('unparseable_timestamp')).toEqual(['e8']);
    expect(byReason('orphan_order_id')).toEqual(['e9']);
    expect(byReason('order_excluded')).toEqual(['e10']);
    expect(byReason('kit_order_conflict')).toEqual(['e11']);
    expect(byReason('upload_only_event')).toEqual(['e12']);
  });

  it('normalizes event_type/source case and whitespace', () => {
    const e4 = run().events.find((e) => e.eventId === 'e4')!;
    expect(e4).toMatchObject({ type: 'kit_delivered', source: 'carrier', at: Date.UTC(2026, 4, 4, 10) });
  });

  it('flags kept-but-suspicious rows', () => {
    const r = run();
    const ev = (id: string) => r.events.find((e) => e.eventId === id)!;
    const ord = (id: string) => r.orders.find((o) => o.orderId === id)!;
    expect(ev('e4').flags).toContain('naive_timestamp');
    expect(ev('e13').flags).toEqual(expect.arrayContaining(['unknown_source', 'before_order_created']));
    expect(ev('e13').source).toBeNull();
    expect(ord('ord_naive').flags).toContain('naive_timestamp');
    expect(ord('ord_up').flags).toContain('upload_only_has_events');
    expect(ord('ord_late').flags).toContain('after_asof');
    expect(r.report.flagged.naive_timestamp.count).toBe(2);
  });
});

describe('clean: invariants', () => {
  it('never silently drops a row: kept + excluded = input, per file', () => {
    const r = run();
    const excluded = (kind: 'orders' | 'events') =>
      Object.values(r.report.excluded).reduce((n, b) => n + b.examples.filter((e) => e.kind === kind).length, 0);
    expect(r.orders.length + excluded('orders')).toBe(r.report.inputRows.orders);
    expect(r.events.length + excluded('events')).toBe(r.report.inputRows.events);
  });

  it('asOf is the max valid event time, independent of the wall clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    expect(run().asOf).toBe(Date.UTC(2026, 4, 10));
  });

  it('asOf falls back to max created_at when there are no events, and is null for empty input', () => {
    expect(clean(rows(ordersCsv, 'orders'), []).asOf).toBe(Date.UTC(2026, 5, 1));
    expect(clean([], []).asOf).toBeNull();
  });
});
