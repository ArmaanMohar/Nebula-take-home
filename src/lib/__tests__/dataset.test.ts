import { describe, expect, it } from 'vitest';
import { buildDataset } from '../dataset';
import happyO from './fixtures/kits-happy/orders.csv?raw';
import happyE from './fixtures/kits-happy/kit_events.csv?raw';
import missingColumnEvents from './fixtures/parse_missing_column_events.csv?raw';

const o = { name: 'a.csv', text: happyO };
const e = { name: 'b.csv', text: happyE };

describe('buildDataset (upload)', () => {
  it('matches files by header regardless of order or name', () => {
    const res = buildDataset([e, o], 'upload');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.dataset.models).toHaveLength(1);
  });

  it('requires exactly two files', () => {
    const res = buildDataset([o], 'upload');
    expect(res).toEqual({ ok: false, errors: [expect.stringMatching(/exactly two/)] });
  });

  it('names the missing column of the closest file kind', () => {
    const res = buildDataset([o, { name: 'events.csv', text: missingColumnEvents }], 'upload');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toMatch(/events\.csv.*kit_id/);
  });

  it('rejects two files of the same kind', () => {
    const res = buildDataset([o, { ...o, name: 'c.csv' }], 'upload');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toMatch(/Both files look like orders/);
  });

  it('reports headers-only files as having no valid orders, without throwing', () => {
    const header = (t: string) => t.split('\n')[0]!;
    const res = buildDataset([{ name: 'o', text: header(happyO) }, { name: 'e', text: header(happyE) }], 'upload');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toMatch(/No valid orders/);
  });

  it('handles garbage input without throwing', () => {
    const res = buildDataset([{ name: 'x', text: '\u0000\u0001' }, { name: 'y', text: '' }], 'upload');
    expect(res.ok).toBe(false);
  });
});
