import { useEffect, useState } from 'react';
import { STAGE_BY_ID } from '../lib/config';
import { findOrder, orderFlags } from '../lib/metrics';
import { REASON_LABELS, type FlagReason, type Kit, type OrderModel, type OrderState, type StageInstance } from '../lib/types';
import { fmtCountry, fmtDateTime, fmtDays } from '../components/format';

interface Props {
  allModels: OrderModel[];
  /** Models after global filters, to tell the user when the order is outside them. */
  filtered: OrderModel[];
  orderId: string | null;
  onOpenOrder: (orderId: string) => void;
}

const STATE_LABELS: Record<OrderState, string> = {
  not_in_pipeline: 'Upload only (no kit)',
  awaiting_shipment: 'Awaiting shipment',
  awaiting_replacement: 'Awaiting replacement shipment',
  in_progress: 'In progress',
  complete: 'Report ready',
};

const EXCLUDED_LABELS: Record<NonNullable<StageInstance['excludedBy']>, string> = {
  missing_scan: 'missing scan',
  out_of_order: 'out of order',
  negative_duration: 'negative duration',
  kit_closed: 'kit replaced first',
};

/** Color + text label for a stage; color never carries meaning alone. */
function chipStyle(s: StageInstance, orderClosed: boolean): { cls: string; text: string } {
  const open = s.status === 'open_ok' || s.status === 'open_over';
  if (open && orderClosed) return { cls: 'border-slate-200 bg-slate-100 text-slate-500', text: 'closed (cancelled/refunded)' };
  switch (s.status) {
    case 'done_ok': return { cls: 'border-green-200 bg-green-50 text-green-800', text: 'within target' };
    case 'open_ok': return { cls: 'border-green-200 bg-white text-green-800', text: 'open, within target' };
    case 'done_over': return { cls: 'border-amber-300 bg-amber-50 text-amber-900', text: 'completed over target' };
    case 'open_over': return { cls: 'border-red-300 bg-red-50 text-red-800', text: 'open, over target (stuck)' };
    case 'excluded': return { cls: 'border-slate-200 bg-slate-50 text-slate-500', text: `not measured: ${EXCLUDED_LABELS[s.excludedBy!]}` };
  }
}

function StageChip({ s, orderClosed }: { s: StageInstance; orderClosed: boolean }) {
  const def = STAGE_BY_ID[s.stageId];
  const { cls, text } = chipStyle(s, orderClosed);
  return (
    <div className={`rounded border px-2 py-1 text-xs ${cls}`}>
      <div className="font-medium">{def.label}</div>
      <div>
        {s.days !== undefined ? fmtDays(s.days) : '–'} <span className="opacity-70">/ {fmtDays(def.targetDays)} target</span>
      </div>
      <div className="opacity-80">{text}</div>
    </div>
  );
}

function FlagBadges({ flags }: { flags: FlagReason[] }) {
  if (!flags.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map((f) => (
        <span key={f} className="rounded border border-amber-300 bg-amber-50 px-1.5 text-[11px] text-amber-900" title={f}>
          ⚑ {REASON_LABELS[f]}
        </span>
      ))}
    </span>
  );
}

function KitCard({ kit, stages, orderClosed, isActive }: { kit: Kit; stages: StageInstance[]; orderClosed: boolean; isActive: boolean }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-2 text-sm">
        <span className="font-mono font-medium">{kit.kitId}</span>
        <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">
          {kit.state === 'replaced' ? 'replaced' : kit.state === 'complete' ? 'report ready' : 'open'}
          {isActive ? ' · active kit' : ''}
        </span>
        {kit.replaces && <span className="text-xs text-slate-500">replaces {kit.replaces}</span>}
        {kit.replacedBy && <span className="text-xs text-slate-500">→ replaced by {kit.replacedBy}</span>}
      </header>
      <div className="flex flex-wrap gap-2 px-4 py-3">
        {stages.map((s) => <StageChip key={s.stageId} s={s} orderClosed={orderClosed} />)}
      </div>
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-4 py-1 text-left font-medium">Occurred (UTC)</th>
            <th className="px-2 py-1 text-left font-medium">Event</th>
            <th className="px-2 py-1 text-left font-medium">Source</th>
            <th className="px-2 py-1 text-left font-medium">CSV row</th>
            <th className="px-2 py-1 text-left font-medium">Flags</th>
          </tr>
        </thead>
        <tbody>
          {kit.events.map((e) => (
            <tr key={`${e.raw.row}`} className="border-t border-slate-100">
              <td className="whitespace-nowrap px-4 py-1 tabular-nums text-slate-700">{fmtDateTime(e.at)}</td>
              <td className="px-2 py-1 font-mono text-slate-800">{e.type}</td>
              <td className="px-2 py-1 text-slate-600">{e.source ?? e.raw.fields.source}</td>
              <td className="px-2 py-1 tabular-nums text-slate-400">{e.raw.row}</td>
              <td className="px-2 py-1"><FlagBadges flags={e.flags} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function OrderDetail({ allModels, filtered, orderId, onOpenOrder }: Props) {
  const [query, setQuery] = useState(orderId ?? '');
  useEffect(() => setQuery(orderId ?? ''), [orderId]);
  const m = orderId ? findOrder(allModels, orderId) : undefined;

  const search = (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (query.trim()) onOpenOrder(query.trim());
      }}
    >
      <input
        className="w-64 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
        placeholder="order_id, e.g. ord_9w0yp"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">Open</button>
    </form>
  );

  if (!orderId) return <div className="space-y-3">{search}<p className="text-sm text-slate-500">Enter an order id, or click a row in Stuck kits.</p></div>;
  if (!m) {
    return (
      <div className="space-y-3">
        {search}
        <p className="text-sm text-slate-600">
          Order <span className="font-mono">{orderId}</span> is not in the loaded data. It may have been excluded during cleaning (see Data quality).
        </p>
      </div>
    );
  }

  const o = m.order;
  const orderClosed = o.status !== 'paid';
  const open = m.openStage;
  const flags = orderFlags(m);
  const pending = m.stages.filter((s) => s.kitId === null);

  return (
    <div className="space-y-4">
      {search}
      {!filtered.includes(m) && (
        <p className="rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">This order is outside the current filters; showing it anyway.</p>
      )}

      <section className="rounded-md border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="font-mono text-base font-semibold">{o.orderId}</h2>
          <span className="text-sm text-slate-700">{STATE_LABELS[m.state]}</span>
          {m.stuck && <span className="rounded bg-red-50 px-1.5 text-xs font-medium text-red-800">● stuck</span>}
          {o.isTest && <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">test order</span>}
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          <div><dt className="text-slate-500">Customer</dt><dd className="font-mono">{o.customerId || '— missing —'}</dd></div>
          <div><dt className="text-slate-500">Product</dt><dd>{o.product}</dd></div>
          <div><dt className="text-slate-500">Country</dt><dd>{fmtCountry(o.country)}</dd></div>
          <div><dt className="text-slate-500">Status</dt><dd>{o.status}</dd></div>
          <div><dt className="text-slate-500">Created</dt><dd className="tabular-nums">{fmtDateTime(o.createdAt)}</dd></div>
          <div><dt className="text-slate-500">Last event</dt><dd className="tabular-nums">{fmtDateTime(m.lastEventAt)}</dd></div>
          <div>
            <dt className="text-slate-500">Waiting on</dt>
            <dd>{open && !orderClosed ? `${STAGE_BY_ID[open.stageId].label} · ${STAGE_BY_ID[open.stageId].owner} · ${fmtDays(open.days)}` : '–'}</dd>
          </div>
          <div><dt className="text-slate-500">Turnaround</dt><dd>{m.turnaroundDays !== undefined ? `${fmtDays(m.turnaroundDays)} (order → report)` : '–'}</dd></div>
        </dl>
        {flags.length > 0 && <div className="mt-2"><FlagBadges flags={flags} /></div>}
        {m.state === 'not_in_pipeline' && <p className="mt-2 text-xs text-slate-500">Upload-only orders never ship a kit.</p>}
      </section>

      {m.kits.map((k, i) => (
        <div key={k.kitId}>
          {i > 0 && <div className="py-1 pl-4 text-xs text-slate-400">{k.replaces ? `↓ replacement for ${k.replaces}` : '↓ next kit (no kit_replaced link)'}</div>}
          <KitCard kit={k} stages={m.stages.filter((s) => s.kitId === k.kitId)} orderClosed={orderClosed} isActive={k === m.activeKit} />
        </div>
      ))}

      {pending.length > 0 && (
        <section className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-3">
          <div className="mb-2 text-sm text-slate-700">
            {m.state === 'awaiting_replacement' ? 'Replacement kit not shipped yet' : 'No kit shipped yet'}
          </div>
          <div className="flex flex-wrap gap-2">
            {pending.map((s) => <StageChip key={`${s.stageId}-${s.start}`} s={s} orderClosed={orderClosed} />)}
          </div>
        </section>
      )}
    </div>
  );
}
