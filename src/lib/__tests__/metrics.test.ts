import { describe, expect, it } from 'vitest';
import { clean } from '../clean';
import type { CsvKind } from '../config';
import { buildModels } from '../kits';
import {
  DEFAULT_FILTERS,
  applyFilters,
  overview,
  percentile,
  qualitySummary,
  stageDurations,
  stuckCsv,
  stuckBreakdown,
  stuckList,
  toCsv,
  type Filters,
} from '../metrics';
import { parseCsv } from '../parse';
import ordersCsv from './fixtures/metrics/orders.csv?raw';
import eventsCsv from './fixtures/metrics/kit_events.csv?raw';

function load() {
  const rows = (text: string, kind: CsvKind) => {
    const r = parseCsv(text, kind);
    if (!r.ok) throw new Error(r.error);
    return r.rows;
  };
  const c = clean(rows(ordersCsv, 'orders'), rows(eventsCsv, 'events'));
  return { ...c, models: buildModels(c.orders, c.events, c.asOf!, c.recorder) };
}

const ids = (ms: { order: { orderId: string } }[]) => ms.map((m) => m.order.orderId);
const filtered = (f: Partial<Filters>) => applyFilters(load().models, { ...DEFAULT_FILTERS, ...f });

describe('percentile', () => {
  it('uses linear interpolation (numpy default)', () => {
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 0.9)).toBeCloseTo(3.7);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1);
    expect(percentile([5], 0.9)).toBe(5);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('applyFilters', () => {
  it('excludes test orders by default, includes them with the toggle', () => {
    expect(ids(filtered({}))).not.toContain('m5');
    expect(ids(filtered({ includeTest: true }))).toContain('m5');
  });

  it('filters on the UTC calendar day of created_at (inclusive)', () => {
    // m3 is 2026-01-31 23:30 at -05:00 = 2026-02-01 04:30 UTC.
    expect(ids(filtered({ from: '2026-02-01' }))).toEqual(['m3']);
    expect(ids(filtered({ to: '2026-01-31' }))).not.toContain('m3');
    expect(ids(filtered({ from: '2026-01-01', to: '2026-01-01' }))).toHaveLength(7);
  });

  it('filters by product and country', () => {
    expect(ids(filtered({ products: ['wgs_100x'] }))).toEqual(['m3', 'm8', 'm9']);
    expect(ids(filtered({ countries: ['CA', 'GB'] }))).toEqual(['m2', 'm3']);
  });
});

describe('overview', () => {
  it('counts volume, current stage, finished and stuck', () => {
    const o = overview(filtered({}));
    expect(o).toMatchObject({ orders: 8, kitOrders: 7, finished: 1, stuck: 2, inProgress: 4 });
    expect(o.byStatus).toEqual({ paid: 6, refunded: 1, cancelled: 1 });
    const cur = Object.fromEntries(o.current.filter((c) => c.count).map((c) => [c.bucket, c.count]));
    expect(cur).toEqual({ awaiting_shipment: 1, kit_shipped: 2, kit_delivered: 1, complete: 1, refunded_cancelled: 2 });
    expect(o.turnaround).toEqual({ n: 1, median: 7, p90: 7 });
  });
});

describe('stageDurations', () => {
  it('uses completed paid instances only, with open counts and target', () => {
    const ship = stageDurations(filtered({})).find((r) => r.stageId === 'ship')!;
    expect(ship.targetDays).toBe(3);
    // wgs_30x: m1 = 1d, m2 = 5d (m4 refunded, m5 test excluded); m6 open & over.
    expect(ship.byProduct.wgs_30x).toMatchObject({ n: 2, median: 3, pctOver: 0.5, openNow: 1, openOver: 1 });
    expect(ship.byProduct.wgs_30x.p90).toBeCloseTo(4.6);
    // wgs_100x: m3 = 2d, m9 = 9d (m8 cancelled excluded).
    expect(ship.byProduct.wgs_100x).toMatchObject({ n: 2, median: 5.5, pctOver: 0.5, openNow: 0 });
    expect(ship.all.n).toBe(4);
  });

  it('includes test orders only when the toggle is on', () => {
    const ship = stageDurations(filtered({ includeTest: true })).find((r) => r.stageId === 'ship')!;
    expect(ship.byProduct.wgs_30x).toMatchObject({ n: 3, median: 1 });
  });

  it('reports n = 0 with null stats rather than NaN', () => {
    const report = stageDurations(filtered({ products: ['wgs_100x'] })).find((r) => r.stageId === 'report')!;
    expect(report.byProduct.wgs_100x).toEqual({ n: 0, median: null, p90: null, pctOver: null, openNow: 0, openOver: 0 });
  });
});

describe('stuckList', () => {
  it('lists stuck orders worst first with owner and days over target', () => {
    const rows = stuckList(filtered({ includeTest: true }));
    expect(rows.map((r) => [r.orderId, r.stageId, r.owner])).toEqual([
      ['m6', 'ship', 'fulfillment'],
      ['m9', 'deliver', 'carrier'],
    ]);
    expect(rows[0]!.daysOver).toBeCloseTo(33.1875 - 3);
    expect(rows[1]).toMatchObject({ kitId: 'k9', targetDays: 7 });
    expect(stuckBreakdown(rows)).toEqual({ byOwner: { fulfillment: 1, carrier: 1 }, byStage: { ship: 1, deliver: 1 } });
  });
});

describe('CSV export', () => {
  it('escapes quotes/commas/newlines and neutralizes formulas', () => {
    const csv = toCsv([{ a: 'x,"y"\nz', b: '=1+1', c: -2.5 }], [
      { header: 'a', value: (r) => r.a },
      { header: 'b', value: (r) => r.b },
      { header: 'c', value: (r) => r.c },
    ]);
    expect(csv).toBe('a,b,c\r\n"x,""y""\nz",\'=1+1,-2.5\r\n');
  });

  it('stuck export rounds days to 1 decimal and guards customer ids', () => {
    const csv = stuckCsv(stuckList(filtered({})));
    const m9 = csv.split('\r\n').find((l) => l.startsWith('m9'))!;
    expect(m9).toContain(`"'=HYPERLINK(""x"")"`);
    expect(m9).toContain(',24.2,7,17.2,');
  });
});

describe('qualitySummary', () => {
  it('lists only non-zero reasons with labels', () => {
    const lines = qualitySummary(load().report);
    expect(lines.every((l) => l.bucket.count > 0 && l.label.length > 0)).toBe(true);
  });
});
