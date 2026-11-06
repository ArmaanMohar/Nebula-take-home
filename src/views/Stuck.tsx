import { useMemo, useState } from 'react';
import { OWNERS, STAGES, type Owner, type StageId } from '../lib/config';
import { stuckBreakdown, stuckCsv, stuckList, utcDay, type StuckRow } from '../lib/metrics';
import type { OrderModel } from '../lib/types';
import { fmtCountry, fmtDate, fmtDays, fmtInt } from '../components/format';

interface Props {
  models: OrderModel[];
  asOf: number;
  onOpenOrder: (orderId: string) => void;
}

type SortKey = 'orderId' | 'product' | 'country' | 'stageLabel' | 'owner' | 'since' | 'daysInStage' | 'daysOver' | 'lastEventAt';

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'orderId', label: 'Order' },
  { key: 'product', label: 'Product' },
  { key: 'country', label: 'Country' },
  { key: 'stageLabel', label: 'Waiting on stage' },
  { key: 'owner', label: 'Owner' },
  { key: 'since', label: 'In stage since', numeric: true },
  { key: 'daysInStage', label: 'Days in stage', numeric: true },
  { key: 'daysOver', label: 'Days over target', numeric: true },
  { key: 'lastEventAt', label: 'Last event', numeric: true },
];

function compare(a: StuckRow, b: StuckRow, key: SortKey): number {
  const x = a[key];
  const y = b[key];
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
  return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
}

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const pill = (active: boolean) =>
  `rounded border px-2 py-1 text-xs ${active ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`;

export function Stuck({ models, asOf, onOpenOrder }: Props) {
  const all = useMemo(() => stuckList(models), [models]);
  const counts = useMemo(() => stuckBreakdown(all), [all]);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [stage, setStage] = useState<StageId | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'daysOver', desc: true });

  const rows = useMemo(() => {
    const visible = all.filter((r) => (!owner || r.owner === owner) && (!stage || r.stageId === stage));
    // Ties keep the selector's worst-first order (stable sort).
    return [...visible].sort((a, b) => (sort.desc ? -1 : 1) * compare(a, b, sort.key));
  }, [all, owner, stage, sort]);

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: COLUMNS.find((c) => c.key === key)?.numeric ?? false }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Owner</span>
          <button className={pill(owner === null)} onClick={() => setOwner(null)}>All {fmtInt(all.length)}</button>
          {OWNERS.filter((o) => counts.byOwner[o]).map((o) => (
            <button key={o} className={pill(owner === o)} onClick={() => setOwner(owner === o ? null : o)}>
              {o} {fmtInt(counts.byOwner[o]!)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          Stage
          <select
            className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700"
            value={stage ?? ''}
            onChange={(e) => setStage((e.target.value || null) as StageId | null)}
          >
            <option value="">All stages</option>
            {STAGES.filter((s) => counts.byStage[s.id]).map((s) => (
              <option key={s.id} value={s.id}>{s.label} ({fmtInt(counts.byStage[s.id]!)})</option>
            ))}
          </select>
        </label>
        <button
          className="ml-auto rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          disabled={rows.length === 0}
          onClick={() => download(stuckCsv(rows), `stuck-kits-asof-${utcDay(asOf)}.csv`)}
        >
          Export CSV ({fmtInt(rows.length)})
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500">No stuck kits match the current filters.</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-md border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} className={`px-3 py-1.5 font-medium ${c.numeric ? 'text-right' : 'text-left'}`}>
                    <button className="hover:text-slate-800" onClick={() => onSort(c.key)}>
                      {c.label}
                      {sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.orderId}|${r.kitId ?? ''}`}
                  tabIndex={0}
                  onClick={() => onOpenOrder(r.orderId)}
                  onKeyDown={(e) => e.key === 'Enter' && onOpenOrder(r.orderId)}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 focus:bg-slate-100 focus:outline-none"
                >
                  <td className="px-3 py-1.5 font-mono text-xs text-slate-800">
                    {r.orderId}
                    {r.kitId && <div className="text-[11px] text-slate-400">{r.kitId}</div>}
                  </td>
                  <td className="px-3 py-1.5 text-slate-700">{r.product}</td>
                  <td className="px-3 py-1.5 text-slate-700">{fmtCountry(r.country)}</td>
                  <td className="px-3 py-1.5 text-slate-700">{r.stageLabel}</td>
                  <td className="px-3 py-1.5 text-slate-700">{r.owner}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{fmtDate(r.since)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                    {fmtDays(r.daysInStage)} <span className="text-xs text-slate-400">/ {fmtDays(r.targetDays)}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium text-[#b42f2f]">+{fmtDays(r.daysOver)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{fmtDate(r.lastEventAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Stuck = paid, non-test kit order whose current stage has been open longer than its target, as of the data date. Click a row
        for the order timeline.
      </p>
    </div>
  );
}
