import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SMALL_N } from '../lib/config';
import type { DurationRow, KitProduct } from '../lib/metrics';
import { fmtDays, fmtInt } from './format';

/** Fixed categorical order: color follows the product, never its position. */
const PRODUCT_COLOR: Record<KitProduct, string> = { wgs_30x: '#2a78d6', wgs_100x: '#eb6834' };
const TEXT_SECONDARY = '#52514e';
const GRID = '#ebebea';
const BAR_SIZE = 10;
const ROW_HEIGHT = 40;
const AXIS_WIDTH = 250;
const SMALL_N_OPACITY = 0.35;

interface Datum {
  label: string;
  row: DurationRow;
  /** Median per product; null when n = 0 (no bar). */
  wgs_30x: number | null;
  wgs_100x: number | null;
}

function TooltipBody({ active, payload, products }: { active?: boolean; payload?: { payload: Datum }[]; products: KitProduct[] }) {
  const d = active ? payload?.[0]?.payload : undefined;
  if (!d) return null;
  return (
    <div className="rounded border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm">
      <div className="font-medium text-slate-800">{d.row.label}</div>
      <div className="text-slate-500">Target {fmtDays(d.row.targetDays)}</div>
      {products.map((p) => {
        const c = d.row.byProduct[p];
        return (
          <div key={p} className="text-slate-700">
            <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: PRODUCT_COLOR[p] }} />
            {p}: median {fmtDays(c.median)} · p90 {fmtDays(c.p90)} · n={fmtInt(c.n)}
            {c.n > 0 && c.n < SMALL_N ? ' (small sample)' : ''}
          </div>
        );
      })}
    </div>
  );
}

/** Median days per stage, one bar per product. Target is in the stage label. */
export function MedianDurationsChart({ rows, products }: { rows: DurationRow[]; products: KitProduct[] }) {
  const data: Datum[] = rows.map((r) => ({
    label: `${r.label} (target ${r.targetDays} d)`,
    row: r,
    wgs_30x: r.byProduct.wgs_30x.median,
    wgs_100x: r.byProduct.wgs_100x.median,
  }));

  return (
    <ResponsiveContainer width="100%" height={rows.length * ROW_HEIGHT + 40}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tick={{ fontSize: 11, fill: TEXT_SECONDARY }} tickLine={false} axisLine={false} unit=" d" />
        <YAxis type="category" dataKey="label" width={AXIS_WIDTH} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: TEXT_SECONDARY }} />
        <Tooltip content={<TooltipBody products={products} />} cursor={{ fill: '#f1f1ef' }} isAnimationActive={false} />
        <Legend verticalAlign="top" align="left" iconType="square" wrapperStyle={{ fontSize: 12, color: TEXT_SECONDARY, paddingBottom: 4 }} />
        {products.map((p) => (
          <Bar key={p} dataKey={p} name={p} fill={PRODUCT_COLOR[p]} barSize={BAR_SIZE} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.row.stageId} fillOpacity={d.row.byProduct[p].n < SMALL_N ? SMALL_N_OPACITY : 1} />
            ))}
            <LabelList
              dataKey={p}
              position="right"
              formatter={(v: unknown) => (v === null || v === undefined ? '' : Number(v).toFixed(1))}
              style={{ fontSize: 11, fill: TEXT_SECONDARY }}
            />
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
