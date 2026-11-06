import { useCallback, useEffect, useState } from 'react';
import { buildDataset, type Dataset } from '../lib/dataset';

const SAMPLE_FILES = ['orders.csv', 'kit_events.csv'];

interface DatasetState {
  dataset: Dataset | null;
  loading: boolean;
  /** Errors from the last load attempt. The previous dataset stays active. */
  errors: string[];
}

export function useDataset() {
  const [state, setState] = useState<DatasetState>({ dataset: null, loading: true, errors: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const files = await Promise.all(
          SAMPLE_FILES.map(async (name) => {
            const res = await fetch(`${import.meta.env.BASE_URL}sample/${name}`);
            if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
            return { name, text: await res.text() };
          }),
        );
        const result = buildDataset(files, 'Sample data');
        if (cancelled) return;
        setState(result.ok
          ? { dataset: result.dataset, loading: false, errors: [] }
          : { dataset: null, loading: false, errors: result.errors });
      } catch (e) {
        if (!cancelled) setState({ dataset: null, loading: false, errors: [`Could not load sample data: ${String(e)}`] });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const upload = useCallback(async (fileList: FileList | null) => {
    const list = fileList ? [...fileList] : [];
    setState((s) => ({ ...s, loading: true }));
    try {
      const files = await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.text() })));
      const result = buildDataset(files, list.map((f) => f.name).join(' + '));
      setState((s) => result.ok
        ? { dataset: result.dataset, loading: false, errors: [] }
        : { ...s, loading: false, errors: result.errors });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, errors: [`Could not read files: ${String(e)}`] }));
    }
  }, []);

  const dismissErrors = useCallback(() => setState((s) => ({ ...s, errors: [] })), []);

  return { ...state, upload, dismissErrors };
}
