import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Overview } from '../lib/metrics';
import { fmtInt, fmtPct } from './format';

const SERIES_1 = '#2a78d6';
const DEEMPHASIS = '#b8b7b1';
const TEXT_SECONDARY = '#52514e';
const BAR_SIZE = 18;
const ROW_HEIGHT = 28;
const AXIS_WIDTH = 200;

type Row = Overview['current'][number];

function TooltipBody({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="rounded border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm">
      <div className="font-medium text-slate-800">{row.label}</div>
      <div className="text-slate-600">
        {fmtInt(row.count)} orders · {fmtPct(row.share)} of kit orders
      </div>
    </div>
  );
}

/** Where kit orders are right now: one bar per current-stage bucket, pipeline order. */
export function CurrentStageChart({ rows }: { rows: Row[] }) {
  return (
    <ResponsiveContainer width="100%" height={rows.length * ROW_HEIGHT + 8}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={2}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={AXIS_WIDTH}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12, fill: TEXT_SECONDARY }}
        />
        <Tooltip content={<TooltipBody />} cursor={{ fill: '#f1f1ef' }} isAnimationActive={false} />
        <Bar dataKey="count" barSize={BAR_SIZE} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={r.bucket} fill={r.bucket === 'refunded_cancelled' ? DEEMPHASIS : SERIES_1} />
          ))}
          <LabelList
            dataKey="count"
            position="right"
            formatter={(v: unknown) => fmtInt(Number(v))}
            style={{ fontSize: 12, fill: TEXT_SECONDARY }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
