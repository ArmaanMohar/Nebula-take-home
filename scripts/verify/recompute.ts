// Independent recompute of dashboard metrics from the raw sample CSVs.
// Applies the spec in CLAUDE.md directly. Imports NOTHING from src/lib.
// Run: node --experimental-strip-types scripts/verify/recompute.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DAY = 86_400_000;

// ---- spec constants (copied from CLAUDE.md / task brief, not from config.ts) ----
const TARGET = { ship: 3, deliver: 7, mail: 45, receive: 14, qc: 7, sequence: 28, report: 5, replace: 7 } as const;
type Stage = keyof typeof TARGET;
const OWNER: Record<Stage, string> = {
  ship: 'fulfillment', deliver: 'carrier', mail: 'customer', receive: 'carrier',
  qc: 'lab', sequence: 'lab', report: 'lab', replace: 'support',
};
const TYPES = ['kit_shipped', 'kit_delivered', 'sample_mailed', 'sample_received', 'qc_passed', 'qc_failed', 'sequencing_complete', 'report_ready', 'kit_replaced'];
const NEXT: Record<string, Stage | null> = {
  kit_shipped: 'deliver', kit_delivered: 'mail', sample_mailed: 'receive', sample_received: 'qc',
  qc_passed: 'sequence', qc_failed: 'replace', sequencing_complete: 'report', report_ready: null, kit_replaced: null,
};
// stage -> [start event (null = order created / predecessor kit_replaced), end events]
const STAGE_DEF: [Stage, string | null, string[]][] = [
  ['ship', null, ['kit_shipped']],
  ['deliver', 'kit_shipped', ['kit_delivered']],
  ['mail', 'kit_delivered', ['sample_mailed']],
  ['receive', 'sample_mailed', ['sample_received']],
  ['qc', 'sample_received', ['qc_passed', 'qc_failed']],
  ['sequence', 'qc_passed', ['sequencing_complete']],
  ['report', 'sequencing_complete', ['report_ready']],
  ['replace', 'qc_failed', ['kit_replaced']],
];

// ---- CSV (sample has no quoted fields; verified with grep -c '"') ----
function readCsv(file: string): Record<string, string>[] {
  const text = readFileSync(join(ROOT, 'public/sample', file), 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((l) => {
    const cells = l.split(',');
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

function parseTs(s: string): { ms: number; naive: boolean } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se, frac, tz] = m;
  let ms = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +se!, frac ? Math.round(+('0.' + frac) * 1000) : 0);
  if (tz && tz !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1;
    const digits = tz.slice(1).replace(':', '');
    ms -= sign * (+digits.slice(0, 2) * 60 + +digits.slice(2)) * 60_000;
  }
  return { ms, naive: !tz };
}

function pct(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
}

const dq: Record<string, number> = {};
const bump = (k: string, n = 1) => { dq[k] = (dq[k] ?? 0) + n; };

// ---- orders ----
interface O { id: string; created: number; product: string; country: string; status: string; isTest: boolean }
const orders = new Map<string, O>();
for (const r of readCsv('orders.csv')) {
  const id = r.order_id!;
  if (!id) { bump('ex:missing_required_field'); continue; }
  if (orders.has(id)) { bump('ex:duplicate_order'); continue; }
  const ts = parseTs(r.created_at!);
  if (!ts) { bump('ex:unparseable_timestamp'); continue; }
  if (ts.naive) bump('fl:naive_timestamp');
  const it = r.is_test!.toLowerCase();
  const isTest = ['true', '1', 'yes', 'y', 't'].includes(it);
  if (!isTest && !['false', '0', 'no', 'n', 'f', ''].includes(it)) bump('fl:unknown_is_test');
  orders.set(id, { id, created: ts.ms, product: r.product!.toLowerCase(), country: r.country!, status: r.status!.toLowerCase(), isTest });
}

// ---- events ----
interface E { id: string; order: string; kit: string; type: string; at: number; row: number }
const rawEvents = readCsv('kit_events.csv');
const kept: E[] = [];
const seen = new Set<string>();
let dupExactText = 0, dupTzOnly = 0;
const seenText = new Set<string>();
const kitOwner = new Map<string, string>();
rawEvents.forEach((r, i) => {
  const type = r.event_type!.toLowerCase();
  if (!r.kit_id || !r.order_id) return bump('ex:missing_required_field');
  const ts = parseTs(r.occurred_at!);
  if (!ts) return bump('ex:unparseable_timestamp');
  if (!TYPES.includes(type)) return bump('ex:unknown_event_type');
  if (!orders.has(r.order_id)) return bump('ex:orphan_order_id');
  const o = orders.get(r.order_id)!;
  const prevOrder = kitOwner.get(r.kit_id);
  if (prevOrder && prevOrder !== r.order_id) return bump('ex:kit_order_conflict');
  kitOwner.set(r.kit_id, r.order_id);
  const key = `${r.kit_id}|${type}|${ts.ms}`;
  if (seen.has(key)) {
    bump('ex:duplicate_event');
    const tkey = `${r.kit_id}|${type}|${r.occurred_at}`;
    if (seenText.has(tkey)) dupExactText++; else dupTzOnly++;
    return;
  }
  seen.add(key); seenText.add(`${r.kit_id}|${type}|${r.occurred_at}`);
  if (o.product === 'upload_only') { bump('ex:upload_only_event'); return; }
  if (ts.naive) bump('fl:naive_timestamp');
  kept.push({ id: r.event_id!, order: r.order_id, kit: r.kit_id, type, at: ts.ms, row: i + 1 });
});
// Note: naive_timestamp is counted here only for events that survive exclusion.
const naiveAll = rawEvents.filter((r) => parseTs(r.occurred_at!)?.naive).length;

const asOf = Math.max(...kept.map((e) => e.at));
const asOfAllEvents = Math.max(...rawEvents.map((r) => parseTs(r.occurred_at!)!.ms));
for (const e of kept) {
  if (e.at > asOf) bump('fl:after_asof');
  if (e.at < orders.get(e.order)!.created) bump('fl:before_order_created');
}

// ---- kits ----
interface K { id: string; order: string; events: E[]; first: Record<string, number>; firstEventAt: number; replacedAt?: number; replaces?: string; replacedBy?: string }
const kitsByOrder = new Map<string, K[]>();
const byKit = new Map<string, E[]>();
for (const e of kept) { if (!byKit.has(e.kit)) byKit.set(e.kit, []); byKit.get(e.kit)!.push(e); }
for (const [kid, evs] of byKit) {
  evs.sort((a, b) => a.at - b.at || TYPES.indexOf(a.type) - TYPES.indexOf(b.type));
  const first: Record<string, number> = {};
  const typeSeen = new Set<string>();
  for (const e of evs) {
    if (typeSeen.has(e.type)) bump('fl:repeated_stage'); else { typeSeen.add(e.type); first[e.type] = e.at; }
  }
  const k: K = { id: kid, order: evs[0]!.order, events: evs, first, firstEventAt: evs[0]!.at, replacedAt: first.kit_replaced };
  if (k.replacedAt !== undefined) {
    const after = evs.filter((e) => e.at > k.replacedAt!).length;
    if (after) bump('fl:event_after_replaced', after);
  }
  // out-of-order: a first-occurrence of a later-ranked type before an earlier-ranked type
  const rank = (t: string) => (t === 'qc_failed' ? 4 : TYPES.indexOf(t));
  const firsts = Object.entries(first).filter(([t]) => t !== 'kit_replaced').sort((a, b) => a[1] - b[1]);
  for (let i = 1; i < firsts.length; i++) if (rank(firsts[i]![0]) < rank(firsts[i - 1]![0])) { bump('fl:out_of_order_kits'); break; }
  if (!kitsByOrder.has(k.order)) kitsByOrder.set(k.order, []);
  kitsByOrder.get(k.order)!.push(k);
}
// missing scans (kit level): later event present but intermediate absent
let noMailed = 0, noDelivered = 0, noShipped = 0, noReceived = 0;
for (const evs of byKit.values()) {
  const has = new Set(evs.map((e) => e.type));
  const laterThan = (t: string) => evs.some((e) => e.type !== 'kit_replaced' && TYPES.indexOf(e.type) > TYPES.indexOf(t) && !(t === 'qc_passed'));
  if (!has.has('sample_mailed') && laterThan('sample_mailed')) noMailed++;
  if (!has.has('kit_delivered') && laterThan('kit_delivered')) noDelivered++;
  if (!has.has('kit_shipped') && laterThan('kit_shipped')) noShipped++;
  if (!has.has('sample_received') && laterThan('sample_received')) noReceived++;
}

// ---- models ----
interface SI { stage: Stage; kit: string | null; start?: number; end?: number; days?: number; done: boolean; open: boolean }
interface M {
  o: O; kits: K[]; state: string; active?: K; stages: SI[]; open?: SI; stuck: boolean; bucket: string | null;
  turnaround?: number; unlinked: number;
}
const models: M[] = [];
let unlinkedKits = 0;
for (const o of orders.values()) {
  const kits = (kitsByOrder.get(o.id) ?? []).sort((a, b) => a.firstEventAt - b.firstEventAt);
  // replacement links
  for (const k of kits) {
    if (k.replacedAt === undefined) continue;
    const succ = kits.find((c) => c !== k && !c.replaces && c.firstEventAt > k.replacedAt!);
    if (succ) { k.replacedBy = succ.id; succ.replaces = k.id; }
  }
  let unlinked = 0;
  kits.forEach((k, i) => { if (i > 0 && !k.replaces) unlinked++; });
  unlinkedKits += unlinked;
  const stages: SI[] = [];
  for (const k of kits) {
    const pred = k.replaces ? kits.find((x) => x.id === k.replaces) : undefined;
    for (const [st, startEv, endEvs] of STAGE_DEF) {
      let start: number | undefined;
      if (startEv === null) start = pred ? pred.replacedAt : (k === kits[0] ? o.created : undefined);
      else start = k.first[startEv];
      const ends = endEvs.map((t) => k.first[t]).filter((x): x is number => x !== undefined);
      const end = ends.length ? Math.min(...ends) : undefined;
      if (start === undefined && end === undefined) continue;
      if (start !== undefined && end !== undefined) {
        const days = (end - start) / DAY;
        if (days >= 0) stages.push({ stage: st, kit: k.id, start, end, days, done: true, open: false });
        continue;
      }
      if (start !== undefined && end === undefined) {
        // open only if kit still open and this is the stage after the latest event
        stages.push({ stage: st, kit: k.id, start, done: false, open: false });
      }
    }
  }
  let state: string; let active: K | undefined; let open: SI | undefined;
  if (o.product === 'upload_only') state = 'not_in_pipeline';
  else if (!kits.length) {
    state = 'awaiting_shipment';
    open = { stage: 'ship', kit: null, start: o.created, days: (asOf - o.created) / DAY, done: false, open: true };
  } else {
    active = kits[kits.length - 1]!;
    if (active.first.report_ready !== undefined) state = 'complete';
    else if (active.replacedAt !== undefined) {
      state = 'awaiting_replacement';
      open = { stage: 'ship', kit: null, start: active.replacedAt, days: (asOf - active.replacedAt) / DAY, done: false, open: true };
    } else {
      state = 'in_progress';
      const last = active.events.filter((e) => e.type !== 'kit_replaced').at(-1)!; // latest by instant
      const nx = NEXT[last.type]!;
      open = { stage: nx, kit: active.id, start: last.at, days: (asOf - last.at) / DAY, done: false, open: true };
    }
  }
  const paidKit = o.status === 'paid' && o.product !== 'upload_only';
  const stuck = paidKit && !o.isTest && !!open && open.days! > TARGET[open.stage];
  let bucket: string | null = null;
  if (state === 'not_in_pipeline') bucket = null;
  else if (state === 'complete') bucket = 'complete';
  else if (o.status !== 'paid') bucket = 'refunded_cancelled';
  else if (state === 'awaiting_shipment' || state === 'awaiting_replacement') bucket = state;
  else bucket = active!.events.filter((e) => e.type !== 'kit_replaced').at(-1)!.type;
  const turnaround = state === 'complete' ? (active!.first.report_ready! - o.created) / DAY : undefined;
  models.push({ o, kits, state, active, stages, open, stuck, bucket, turnaround, unlinked });
}

// ---- metrics with default filters (exclude test) ----
const visible = models.filter((m) => !m.o.isTest);
const elig = visible.filter((m) => m.o.status === 'paid' && m.o.product !== 'upload_only');
const durations: Record<string, Record<string, { n: number; median: number | null; p90: number | null; pctOver: number | null }>> = {};
for (const [st] of STAGE_DEF) {
  durations[st] = {};
  for (const prod of ['all', 'wgs_30x', 'wgs_100x']) {
    const ms = elig.filter((m) => prod === 'all' || m.o.product === prod);
    const vals = ms.flatMap((m) => m.stages.filter((s) => s.stage === st && s.done).map((s) => s.days!));
    durations[st]![prod] = {
      n: vals.length, median: pct(vals, 0.5), p90: pct(vals, 0.9),
      pctOver: vals.length ? vals.filter((v) => v > TARGET[st]).length / vals.length : null,
    };
  }
}
const stuck = visible.filter((m) => m.stuck);
const byOwner: Record<string, number> = {};
const byStage: Record<string, number> = {};
for (const m of stuck) { byOwner[OWNER[m.open!.stage]] = (byOwner[OWNER[m.open!.stage]] ?? 0) + 1; byStage[m.open!.stage] = (byStage[m.open!.stage] ?? 0) + 1; }
const buckets: Record<string, number> = {};
for (const m of visible) if (m.bucket) buckets[m.bucket] = (buckets[m.bucket] ?? 0) + 1;
const turn = elig.filter((m) => m.turnaround !== undefined).map((m) => m.turnaround!);

const out = {
  asOf: new Date(asOf).toISOString(),
  asOfIncludingOrphans: new Date(asOfAllEvents).toISOString(),
  totals: {
    ordersAll: orders.size,
    ordersVisible: visible.length,
    testExcluded: models.filter((m) => m.o.isTest).length,
    kitOrders: visible.filter((m) => m.o.product !== 'upload_only').length,
    uploadOnly: visible.filter((m) => m.o.product === 'upload_only').length,
    wgs_30x: visible.filter((m) => m.o.product === 'wgs_30x').length,
    wgs_100x: visible.filter((m) => m.o.product === 'wgs_100x').length,
    finished: visible.filter((m) => m.state === 'complete').length,
    inProgress: elig.filter((m) => ['awaiting_shipment', 'awaiting_replacement', 'in_progress'].includes(m.state)).length,
    keptEvents: kept.length,
  },
  buckets,
  turnaround: { n: turn.length, median: pct(turn, 0.5), p90: pct(turn, 0.9) },
  durations,
  stuck: { total: stuck.length, byOwner, byStage, ids: stuck.map((m) => `${m.o.id}|${m.open!.kit ?? ''}|${m.open!.stage}|${m.open!.days!.toFixed(6)}`).sort() },
  dq: { ...dq, dupExactText, dupTzOnly, naiveAllRaw: naiveAll, missingScanKits_noMailed: noMailed, missingScanKits_noDelivered: noDelivered, missingScanKits_noShipped: noShipped, missingScanKits_noReceived: noReceived, unlinkedKits },
  orderTrace: Object.fromEntries(
    (process.argv.slice(2)).map((id) => {
      const m = models.find((x) => x.o.id === id)!;
      return [id, {
        order: { ...m.o, created: new Date(m.o.created).toISOString() },
        state: m.state, bucket: m.bucket, stuck: m.stuck,
        open: m.open && { ...m.open, start: new Date(m.open.start!).toISOString() },
        turnaround: m.turnaround,
        kits: m.kits.map((k) => ({ id: k.id, replaces: k.replaces, replacedBy: k.replacedBy, events: k.events.map((e) => `${new Date(e.at).toISOString()} ${e.type} (row ${e.row})`) })),
        stages: m.stages.map((s) => ({ stage: s.stage, kit: s.kit, days: s.days, done: s.done })),
      }];
    }),
  ),
};
mkdirSync(join(HERE, 'out'), { recursive: true });
writeFileSync(join(HERE, 'out', 'independent.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, stuck: { ...out.stuck, ids: `${out.stuck.ids.length} ids` } }, null, 2));
