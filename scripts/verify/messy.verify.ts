// Throwaway QA harness: load each test-data pair through the real upload path,
// print the numbers, and server-render every view to catch crashes / blank output.
// Run: npx vitest run --config scripts/verify/vitest.config.ts scripts/verify/messy.verify.ts
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { buildDataset } from '../../src/lib/dataset';
import {
  DEFAULT_FILTERS, applyFilters, overview, qualitySummary, stageDurations, stuckList,
} from '../../src/lib/metrics';
import { Overview } from '../../src/views/Overview';
import { Durations } from '../../src/views/Durations';
import { Stuck } from '../../src/views/Stuck';
import { OrderDetail } from '../../src/views/OrderDetail';
import { DataQuality } from '../../src/views/DataQuality';

const pair = (dir: string) => ['orders.csv', 'kit_events.csv'].map((n) => ({ name: n, text: readFileSync(`test-data/${dir}/${n}`, 'utf-8') }));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const noop = () => {};

for (const dir of ['messy', 'no-events', 'empty', 'zero-bytes']) {
  it(dir, () => {
    const res = buildDataset(pair(dir), dir);
    console.log(`\n===== ${dir} =====`);
    if (!res.ok) { console.log('LOAD ERROR:', JSON.stringify(res.errors)); return; }
    const d = res.dataset;
    const ms = applyFilters(d.models, DEFAULT_FILTERS);
    console.log('asOf', new Date(d.asOf).toISOString(), 'kept', JSON.stringify(d.kept), 'read', JSON.stringify(d.report.inputRows));
    console.log('warnings', JSON.stringify(d.report.parseWarnings));
    const o = overview(ms);
    console.log('overview', JSON.stringify({ ...o, current: o.current.filter((c) => c.count).map((c) => `${c.bucket}:${c.count}`) }));
    console.log('states', d.models.map((m) => `${m.order.orderId}:${m.state}${m.stuck ? '*STUCK' : ''}`).join(' '));
    console.log('stuck', stuckList(ms).map((s) => `${s.orderId}/${s.kitId}/${s.stageId}/${s.owner}/${s.daysOver.toFixed(1)}`).join(' '));
    for (const r of stageDurations(ms)) if (r.all.n || r.all.openNow) console.log('dur', r.stageId, JSON.stringify(r.byProduct));
    for (const l of qualitySummary(d.report)) console.log('dq', l.type, l.reason, l.bucket.count, '|', l.bucket.examples.map((e) => `${e.kind}#${e.row.row}:${e.detail ?? ''}`).join(' ; '));

    // Render every view; any throw fails the test.
    const views: Record<string, string> = {
      overview: renderToStaticMarkup(h(Overview, { models: ms, onOpenStuck: noop })),
      durations: renderToStaticMarkup(h(Durations, { models: ms, productFilter: [] })),
      stuck: renderToStaticMarkup(h(Stuck, { models: ms, asOf: d.asOf, onOpenOrder: noop })),
      quality: renderToStaticMarkup(h(DataQuality, { dataset: d, onOpenOrder: noop })),
      orderNone: renderToStaticMarkup(h(OrderDetail, { allModels: d.models, filtered: ms, orderId: null, onOpenOrder: noop })),
      orderMissing: renderToStaticMarkup(h(OrderDetail, { allModels: d.models, filtered: ms, orderId: 'does_not_exist', onOpenOrder: noop })),
    };
    for (const m of d.models) views[`order:${m.order.orderId}`] = renderToStaticMarkup(h(OrderDetail, { allModels: d.models, filtered: ms, orderId: m.order.orderId, onOpenOrder: noop }));
    // Filtered to nothing: every view must still render.
    const none = applyFilters(d.models, { ...DEFAULT_FILTERS, from: '1999-01-01', to: '1999-01-02' });
    views.overviewEmpty = renderToStaticMarkup(h(Overview, { models: none, onOpenStuck: noop }));
    views.durationsEmpty = renderToStaticMarkup(h(Durations, { models: none, productFilter: [] }));
    views.stuckEmpty = renderToStaticMarkup(h(Stuck, { models: none, asOf: d.asOf, onOpenOrder: noop }));
    views.durationsUploadOnly = renderToStaticMarkup(h(Durations, { models: ms, productFilter: ['upload_only'] }));

    for (const k of ['overview', 'durations', 'stuck', 'overviewEmpty', 'durationsEmpty', 'stuckEmpty', 'durationsUploadOnly', 'orderMissing']) {
      console.log(`VIEW ${k}:`, text(views[k]!).slice(0, 600));
    }
    if (dir === 'messy') for (const id of ['m14', 'm21', 'm10']) console.log(`VIEW order:${id}:`, text(views[`order:${id}`]!).slice(0, 900));
    const raw = Object.entries(views).filter(([, v]) => /<script>alert/.test(v)).map(([k]) => k);
    console.log('UNESCAPED <script> in views:', raw.length ? raw : 'none');
    console.log('NaN/undefined/Infinity in views:', Object.entries(views).filter(([, v]) => /NaN|undefined|Infinity/.test(text(v))).map(([k]) => k));
  });
}
