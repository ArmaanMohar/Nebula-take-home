import { useMemo } from 'react';
import { KIT_PRODUCTS, SMALL_N, type Product } from '../lib/config';
import { stageDurations, type DurationCell, type KitProduct } from '../lib/metrics';
import type { OrderModel } from '../lib/types';
import { fmtDays, fmtInt, fmtPct } from '../components/format';

interface Props {
  models: OrderModel[];
  /** Product filter; empty = all. Decides which product columns are shown. */
  productFilter: Product[];
}

const CELL_HEADERS = ['Median', 'p90', '% over', 'n', 'Open now'] as const;

function Cells({ c }: { c: DurationCell }) {
  const small = c.n < SMALL_N;
  const tone = small ? 'text-slate-400' : 'text-slate-900';
  return (
    <>
      <td className={`border-l border-slate-100 px-2 py-1.5 text-right tabular-nums ${tone}`} title={small ? `Small sample (n < ${SMALL_N})` : undefined}>
        {fmtDays(c.median)}
      </td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${tone}`}>{fmtDays(c.p90)}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${tone}`}>{fmtPct(c.pctOver)}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${small ? 'text-slate-400' : 'text-slate-500'}`}>{fmtInt(c.n)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">
        {fmtInt(c.openNow)}
        {c.openOver > 0 && <span className="ml-1 text-xs font-medium text-[#b42f2f]">({fmtInt(c.openOver)} over)</span>}
      </td>
    </>
  );
}

export function Durations({ models, productFilter }: Props) {
  const rows = useMemo(() => stageDurations(models), [models]);
  const products = KIT_PRODUCTS.filter((p) => !productFilter.length || productFilter.includes(p)) as KitProduct[];

  if (products.length === 0) {
    return <p className="text-sm text-slate-500">Upload-only orders have no kit stages. Select a kit product to see durations.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium" rowSpan={2}>Stage</th>
              <th className="px-2 py-1.5 text-right font-medium" rowSpan={2}>Target</th>
              <th className="px-2 py-1.5 text-left font-medium" rowSpan={2}>Owner</th>
              {products.map((p) => (
                <th key={p} colSpan={CELL_HEADERS.length} className="border-l border-slate-200 px-2 py-1.5 text-center font-semibold text-slate-700">
                  {p}
                </th>
              ))}
            </tr>
            <tr>
              {products.map((p) =>
                CELL_HEADERS.map((h, i) => (
                  <th key={`${p}-${h}`} className={`px-2 py-1 text-right font-medium ${i === 0 ? 'border-l border-slate-200' : ''}`}>
                    {h}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stageId} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-800">{r.label}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{fmtDays(r.targetDays)}</td>
                <td className="px-2 py-1.5 text-slate-600">{r.owner}</td>
                {products.map((p) => <Cells key={p} c={r.byProduct[p]} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-0.5 text-xs text-slate-500">
        <li>Calendar days. Median, p90 (linear interpolation) and % over target use completed stages only, on paid orders.</li>
        <li>Open now = kits currently in that stage as of the data date; "over" = already past target.</li>
        <li>Stages with a missing or out-of-order scan are left out. Grey values: fewer than {SMALL_N} samples.</li>
        <li>A replacement kit&apos;s Order → Shipped is measured from the kit_replaced event.</li>
      </ul>
    </div>
  );
}
