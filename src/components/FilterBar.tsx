import type { Product } from '../lib/config';
import type { Filters } from '../lib/metrics';
import { fmtCountry } from './format';

interface Props {
  filters: Filters;
  options: { products: Product[]; countries: string[]; minDay: string | null; maxDay: string | null };
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

const pill = (active: boolean) =>
  `rounded border px-2 py-1 text-xs ${active ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'}`;

export function FilterBar({ filters, options, onChange, onReset }: Props) {
  const isDefault =
    !filters.from && !filters.to && !filters.products.length && !filters.countries.length && !filters.includeTest;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <label className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500">Created (UTC)</span>
        <input
          type="date"
          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
          value={filters.from ?? ''}
          min={options.minDay ?? undefined}
          max={filters.to ?? options.maxDay ?? undefined}
          onChange={(e) => onChange({ from: e.target.value || null })}
        />
        <span className="text-xs text-slate-400">to</span>
        <input
          type="date"
          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
          value={filters.to ?? ''}
          min={filters.from ?? options.minDay ?? undefined}
          max={options.maxDay ?? undefined}
          onChange={(e) => onChange({ to: e.target.value || null })}
        />
      </label>

      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500">Product</span>
        {options.products.map((p) => (
          <button key={p} className={pill(filters.products.includes(p))} onClick={() => onChange({ products: toggle(filters.products, p) })}>
            {p}
          </button>
        ))}
      </div>

      <details className="relative">
        <summary className="cursor-pointer list-none rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">
          Country: {filters.countries.length ? filters.countries.map(fmtCountry).join(', ') : 'All'} ▾
        </summary>
        <div className="absolute z-10 mt-1 max-h-64 w-44 overflow-auto rounded border border-slate-200 bg-white p-2 shadow">
          {options.countries.map((c) => (
            <label key={c || '-'} className="flex items-center gap-2 py-0.5 text-xs">
              <input type="checkbox" checked={filters.countries.includes(c)} onChange={() => onChange({ countries: toggle(filters.countries, c) })} />
              {fmtCountry(c)}
            </label>
          ))}
          {filters.countries.length > 0 && (
            <button className="mt-1 text-xs text-slate-500 underline" onClick={() => onChange({ countries: [] })}>
              Clear
            </button>
          )}
        </div>
      </details>

      <label className="flex items-center gap-1.5 text-xs text-slate-700">
        <input type="checkbox" checked={filters.includeTest} onChange={(e) => onChange({ includeTest: e.target.checked })} />
        Include test orders
      </label>

      {!isDefault && (
        <button className="text-xs text-slate-500 underline hover:text-slate-800" onClick={onReset}>
          Reset filters
        </button>
      )}
    </div>
  );
}
