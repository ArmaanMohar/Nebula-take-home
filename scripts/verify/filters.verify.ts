// Sanity checks on filters/test handling using the app's lib.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from 'vitest';
import { buildDataset } from '../../src/lib/dataset';
import { applyFilters, DEFAULT_FILTERS, overview, stageDurations, stuckList } from '../../src/lib/metrics';

test('filters + test handling', () => {
  const read = (f: string) => ({ name: f, text: readFileSync(join(__dirname, '../../public/sample', f), 'utf8') });
  const res = buildDataset([read('orders.csv'), read('kit_events.csv')], 's');
  if (!res.ok) throw new Error();
  const { models } = res.dataset;
  const def = applyFilters(models, DEFAULT_FILTERS);
  const withTest = applyFilters(models, { ...DEFAULT_FILTERS, includeTest: true });
  const s1 = stuckList(def), s2 = stuckList(withTest);
  const testWithOpenOver = withTest.filter((m) => m.order.isTest && m.inPipelineStats && m.openStage?.status === 'open_over').length;
  const p100 = applyFilters(models, { ...DEFAULT_FILTERS, products: ['wgs_100x'] });
  const d100 = stageDurations(p100), dAll = stageDurations(def);
  const gb = applyFilters(models, { ...DEFAULT_FILTERS, countries: ['GB'] });
  const aug = applyFilters(models, { ...DEFAULT_FILTERS, from: '2026-08-01', to: '2026-08-31' });
  console.log(JSON.stringify({
    stuckDefault: s1.length, stuckWithTest: s2.length, testOrdersOpenOverTarget: testWithOpenOver,
    stuckHasUploadOnly: s2.some((r) => r.product === 'upload_only'),
    stuckHasNonPaid: withTest.filter((m) => m.stuck && m.order.status !== 'paid').length,
    stuckReplacedKit: s1.filter((r) => r.kitId && models.find((m) => m.order.orderId === r.orderId)!.kits.find((k) => k.kitId === r.kitId)!.state !== 'open').length,
    product100_matches_byProduct: d100.every((r, i) => r.all.n === dAll[i]!.byProduct.wgs_100x.n && r.all.median === dAll[i]!.byProduct.wgs_100x.median),
    gb: { orders: gb.length, allGB: gb.every((m) => m.order.country === 'GB'), stuck: overview(gb).stuck },
    aug: { orders: aug.length, ok: aug.every((m) => new Date(m.order.createdAt).toISOString().slice(0, 7) === '2026-08') },
    durationsWithTest_n_ship: stageDurations(withTest)[0]!.all.n,
  }, null, 1));
  expect(s1.length).toBe(s2.length);
});
