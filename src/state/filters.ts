import { useCallback, useEffect, useRef, useState } from 'react';
import { PRODUCTS, type Product } from '../lib/config';
import { DEFAULT_FILTERS, type Filters } from '../lib/metrics';

export const VIEWS = ['overview', 'durations', 'stuck', 'order', 'quality'] as const;
export type View = (typeof VIEWS)[number];

export interface UrlState {
  view: View;
  filters: Filters;
  /** Order shown in the Order detail view. */
  orderId: string | null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const list = (v: string | null) => (v ? v.split(',').map((s) => s.trim()) : []);

/** Unknown or malformed params fall back to defaults; never throws. */
export function parseUrl(search: string): UrlState {
  const p = new URLSearchParams(search);
  const view = p.get('view');
  const from = p.get('from');
  const to = p.get('to');
  return {
    view: (VIEWS as readonly string[]).includes(view ?? '') ? (view as View) : 'overview',
    orderId: p.get('id')?.trim() || null,
    filters: {
      from: from && DAY_RE.test(from) ? from : null,
      to: to && DAY_RE.test(to) ? to : null,
      products: list(p.get('product')).filter((x): x is Product => (PRODUCTS as readonly string[]).includes(x)),
      // Blank country is encoded as "-" so it survives the comma list.
      countries: list(p.get('country')).map((c) => (c === '-' ? '' : c.toUpperCase())),
      includeTest: p.get('test') === '1',
    },
  };
}

export function toSearch(s: UrlState): string {
  const p = new URLSearchParams();
  if (s.view !== 'overview') p.set('view', s.view);
  if (s.orderId) p.set('id', s.orderId);
  const f = s.filters;
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.products.length) p.set('product', f.products.join(','));
  if (f.countries.length) p.set('country', f.countries.map((c) => c || '-').join(','));
  if (f.includeTest) p.set('test', '1');
  const q = p.toString();
  return q ? `?${q}` : '';
}

/**
 * Global UI state synced to the URL. Navigation (view / order) pushes a
 * history entry so Back works; filter changes replace the current one.
 */
export function useUrlState() {
  const [state, setState] = useState<UrlState>(() => parseUrl(window.location.search));
  const ref = useRef(state);

  useEffect(() => {
    const onPop = () => {
      ref.current = parseUrl(window.location.search);
      setState(ref.current);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const write = useCallback((next: UrlState, push: boolean) => {
    const url = `${window.location.pathname}${toSearch(next)}`;
    if (push) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
    ref.current = next;
    setState(next);
  }, []);

  const setFilters = useCallback(
    (patch: Partial<Filters>) => write({ ...ref.current, filters: { ...ref.current.filters, ...patch } }, false),
    [write],
  );

  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [setFilters]);

  const navigate = useCallback(
    (view: View, orderId?: string | null) =>
      write({ ...ref.current, view, orderId: orderId === undefined ? ref.current.orderId : orderId }, true),
    [write],
  );

  return { ...state, setFilters, resetFilters, navigate };
}
