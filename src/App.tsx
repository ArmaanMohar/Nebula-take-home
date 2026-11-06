import { useMemo, useRef } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FilterBar } from './components/FilterBar';
import { fmtDateTime, fmtInt } from './components/format';
import { applyFilters, filterOptions, overview, qualityTotals } from './lib/metrics';
import { useDataset } from './state/dataset';
import { useUrlState, type View } from './state/filters';
import { Durations } from './views/Durations';
import { Overview } from './views/Overview';

const TABS: { view: View; label: string }[] = [
  { view: 'overview', label: 'Overview' },
  { view: 'durations', label: 'Stage durations' },
  { view: 'stuck', label: 'Stuck kits' },
  { view: 'order', label: 'Order detail' },
  { view: 'quality', label: 'Data quality' },
];

export default function App() {
  const { dataset, loading, errors, upload, dismissErrors } = useDataset();
  const { view, filters, setFilters, resetFilters, navigate } = useUrlState();
  const fileInput = useRef<HTMLInputElement>(null);

  const models = dataset?.models;
  const options = useMemo(() => filterOptions(models ?? []), [models]);
  const filtered = useMemo(() => applyFilters(models ?? [], filters), [models, filters]);
  const stuckCount = useMemo(() => overview(filtered).stuck, [filtered]);
  const quality = useMemo(() => (dataset ? qualityTotals(dataset.report) : null), [dataset]);

  const badge = (v: View) => {
    if (v === 'stuck') return fmtInt(stuckCount);
    if (v === 'quality' && quality) return fmtInt(quality.excluded);
    return null;
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div>
            <h1 className="text-base font-semibold">Kit Lifecycle Dashboard</h1>
            <p className="text-xs text-slate-500">
              {dataset ? (
                <>
                  Data as of <span className="font-medium text-slate-700">{fmtDateTime(dataset.asOf)}</span> · {dataset.label} ·{' '}
                  {fmtInt(dataset.models.length)} orders
                </>
              ) : loading ? 'Loading…' : 'No data loaded'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              multiple
              className="hidden"
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              disabled={loading}
              onClick={() => fileInput.current?.click()}
              title="Select orders.csv and kit_events.csv together"
            >
              {loading ? 'Loading…' : 'Upload CSVs'}
            </button>
          </div>
        </div>

        {errors.length > 0 && (
          <div role="alert" className="mx-6 mb-3 flex items-start justify-between gap-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            <div>
              <p className="font-semibold">
                Could not load files.{dataset ? ' Still showing the previous data.' : ''}
              </p>
              <ul className="mt-1 list-disc pl-4">
                {errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
            <button className="text-red-700 underline" onClick={dismissErrors}>Dismiss</button>
          </div>
        )}

        {dataset && (
          <div className="border-t border-slate-100 px-6 py-2">
            <FilterBar filters={filters} options={options} onChange={setFilters} onReset={resetFilters} />
          </div>
        )}

        <nav className="flex gap-1 px-6">
          {TABS.map((t) => (
            <button
              key={t.view}
              onClick={() => navigate(t.view)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                view === t.view ? 'border-slate-800 font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
              {badge(t.view) && <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-xs text-slate-600">{badge(t.view)}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main className="p-6">
        <ErrorBoundary resetKey={`${view}|${dataset?.label}`}>
          {!dataset ? (
            <p className="text-sm text-slate-500">{loading ? 'Loading data…' : 'Upload orders.csv and kit_events.csv to begin.'}</p>
          ) : view === 'overview' ? (
            <Overview models={filtered} onOpenStuck={() => navigate('stuck')} />
          ) : view === 'durations' ? (
            <Durations models={filtered} productFilter={filters.products} />
          ) : (
            <p className="text-sm text-slate-500">This view is not built yet.</p>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}
