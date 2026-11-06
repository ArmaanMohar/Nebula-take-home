// Calls the APP's src/lib on the sample CSVs and dumps the same metrics as recompute.ts.
// Run: npx vitest run --config scripts/verify/vitest.config.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { buildDataset } from '../../src/lib/dataset';
import { applyFilters, DEFAULT_FILTERS, overview, stageDurations, stuckList, stuckBreakdown, qualitySummary } from '../../src/lib/metrics';

const ROOT = join(__dirname, '..', '..');
const TRACE = (process.env.TRACE ?? '').split(',').filter(Boolean);

test('dump app metrics', () => {
  const read = (f: string) => ({ name: f, text: readFileSync(join(ROOT, 'public/sample', f), 'utf8') });
  const res = buildDataset([read('orders.csv'), read('kit_events.csv')], 'sample');
  if (!res.ok) throw new Error(res.errors.join('\n'));
  const { models, report, asOf, kept } = res.dataset;
  const vis = applyFilters(models, DEFAULT_FILTERS);
  const ov = overview(vis);
  const dur = stageDurations(vis);
  const rows = stuckList(vis);
  const durations: Record<string, Record<string, unknown>> = {};
  for (const r of dur) durations[r.stageId] = { all: r.all, wgs_30x: r.byProduct.wgs_30x, wgs_100x: r.byProduct.wgs_100x, target: r.targetDays };
  const iso = (ms?: number) => (ms === undefined ? undefined : new Date(ms).toISOString());
  const out = {
    asOf: iso(asOf),
    kept,
    overview: { ...ov, current: Object.fromEntries(ov.current.filter((c) => c.count).map((c) => [c.bucket, c.count])) },
    durations,
    stuck: {
      total: rows.length, ...stuckBreakdown(rows),
      ids: rows.map((r) => `${r.orderId}|${r.kitId ?? ''}|${r.stageId}|${r.daysInStage.toFixed(6)}`).sort(),
    },
    dq: Object.fromEntries(qualitySummary(report).map((l) => [`${l.type === 'excluded' ? 'ex' : 'fl'}:${l.reason}`, l.bucket.count])),
    orderTrace: Object.fromEntries(TRACE.map((id) => {
      const m = models.find((x) => x.order.orderId === id)!;
      return [id, {
        state: m.state, stuck: m.stuck, inPipelineStats: m.inPipelineStats, turnaround: m.turnaroundDays,
        open: m.openStage && { ...m.openStage, start: iso(m.openStage.start), end: iso(m.openStage.end) },
        orderFlags: m.order.flags,
        kits: m.kits.map((k) => ({ id: k.kitId, state: k.state, replaces: k.replaces, replacedBy: k.replacedBy, lastEvent: k.lastEvent.type, flags: k.flags,
          events: k.events.map((e) => `${iso(e.at)} ${e.type} row ${e.raw.row} [${e.flags.join(',')}]`) })),
        stages: m.stages.map((s) => ({ stage: s.stageId, kit: s.kitId, start: iso(s.start), end: iso(s.end), days: s.days, status: s.status, excludedBy: s.excludedBy })),
      }];
    })),
  };
  mkdirSync(join(__dirname, 'out'), { recursive: true });
  writeFileSync(join(__dirname, 'out', 'app.json'), JSON.stringify(out, null, 2));
});
