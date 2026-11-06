import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Critical tiles get a red rule + label; color never carries meaning alone. */
  tone?: 'default' | 'critical';
  /** Visually de-emphasize (e.g. small sample size). */
  muted?: boolean;
  onClick?: () => void;
}

export function StatTile({ label, value, sub, tone = 'default', muted, onClick }: Props) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`rounded-md border bg-white px-4 py-3 text-left ${
        tone === 'critical' ? 'border-l-4 border-slate-200 border-l-[#d03b3b]' : 'border-slate-200'
      } ${onClick ? 'cursor-pointer hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400' : ''}`}
    >
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${muted ? 'text-slate-400' : 'text-slate-900'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Tag>
  );
}
