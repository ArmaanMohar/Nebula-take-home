import { useMemo } from 'react';
import type { Dataset } from '../lib/dataset';
import { findOrder, qualitySummary, qualityTotals } from '../lib/metrics';
import type { RawRow } from '../lib/types';
import { fmtInt } from '../components/format';

interface Props {
  dataset: Dataset;
  onOpenOrder: (orderId: string) => void;
}

const FILE_LABEL = { orders: 'orders.csv', events: 'kit_events.csv' } as const;

/** Raw CSV fields rendered as plain text, never HTML. */
function RawFields({ row }: { row: RawRow }) {
  return (
    <span className="font-mono text-[11px] text-slate-600">
      {Object.entries(row.fields).map(([k, v], i) => (
        <span key={k}>
          {i > 0 && <span className="text-slate-300"> · </span>}
          <span className="text-slate-400">{k}=</span>
          {v === '' ? <span className="text-slate-300">∅</span> : JSON.stringify(v)}
        </span>
      ))}
    </span>
  );
}

export function DataQuality({ dataset, onOpenOrder }: Props) {
  const lines = useMemo(() => qualitySummary(dataset.report), [dataset]);
  const totals = useMemo(() => qualityTotals(dataset.report), [dataset]);
  const { inputRows, parseWarnings } = dataset.report;
  const warnings = [...parseWarnings.orders.map((w) => ({ ...w, kind: 'orders' as const })), ...parseWarnings.events.map((w) => ({ ...w, kind: 'events' as const }))];

  return (
    <div className="space-y-4">
      <p className="rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
        Covers the whole loaded dataset. Global filters do not apply here, because excluded rows may have no valid order to filter on.
      </p>

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <table className="text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-1.5 text-left font-medium">File</th>
              <th className="px-4 py-1.5 text-right font-medium">Rows read</th>
              <th className="px-4 py-1.5 text-right font-medium">Kept</th>
              <th className="px-4 py-1.5 text-right font-medium">Excluded</th>
            </tr>
          </thead>
          <tbody>
            {(['orders', 'events'] as const).map((k) => (
              <tr key={k} className="border-t border-slate-100">
                <td className="px-4 py-1.5 font-mono text-xs">{FILE_LABEL[k]}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{fmtInt(inputRows[k])}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{fmtInt(dataset.kept[k])}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{fmtInt(inputRows[k] - dataset.kept[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="rounded-md border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-800">
          Exclusions ({fmtInt(totals.excluded)} rows) and flags ({fmtInt(totals.flagged)})
        </h2>
        {lines.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">No issues found.</p>
        ) : (
          <ul>
            {lines.map((l) => (
              <li key={`${l.type}-${l.reason}`} className="border-t border-slate-100 first:border-t-0">
                <details>
                  <summary className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50">
                    <span
                      className={`w-16 rounded px-1.5 text-center text-[11px] font-medium ${
                        l.type === 'excluded' ? 'bg-slate-700 text-white' : 'border border-amber-300 bg-amber-50 text-amber-900'
                      }`}
                    >
                      {l.type === 'excluded' ? 'excluded' : '⚑ flagged'}
                    </span>
                    <span className="w-16 text-right tabular-nums font-medium">{fmtInt(l.bucket.count)}</span>
                    <span className="text-slate-800">{l.label}</span>
                    <span className="font-mono text-xs text-slate-400">{l.reason}</span>
                  </summary>
                  <div className="space-y-1.5 bg-slate-50 px-4 py-2">
                    <p className="text-[11px] text-slate-500">
                      Showing {l.bucket.examples.length} of {fmtInt(l.bucket.count)} examples.
                    </p>
                    {l.bucket.examples.map((ex, i) => {
                      const orderId = ex.row.fields.order_id?.trim() ?? '';
                      const linkable = orderId !== '' && findOrder(dataset.models, orderId) !== undefined;
                      return (
                        <div key={i} className="text-xs">
                          <span className="font-mono text-slate-500">{FILE_LABEL[ex.kind]} row {ex.row.row}</span>
                          {ex.detail && <span className="ml-2 text-slate-700">{ex.detail}</span>}
                          {linkable && (
                            <button className="ml-2 text-slate-600 underline hover:text-slate-900" onClick={() => onOpenOrder(orderId)}>
                              open order
                            </button>
                          )}
                          <div><RawFields row={ex.row} /></div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      {warnings.length > 0 && (
        <section className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">CSV parse warnings ({fmtInt(warnings.length)})</h2>
          <p className="mb-1 text-xs text-slate-500">Rows with too few or too many fields. Short rows were kept with blank fields; extra fields were ignored.</p>
          <ul className="text-xs text-slate-700">
            {warnings.slice(0, 50).map((w, i) => (
              <li key={i}><span className="font-mono text-slate-500">{FILE_LABEL[w.kind]} row {w.row}</span>: {w.message}</li>
            ))}
          </ul>
          {warnings.length > 50 && <p className="text-xs text-slate-500">…and {fmtInt(warnings.length - 50)} more.</p>}
        </section>
      )}
    </div>
  );
}
