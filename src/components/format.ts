// Display-only formatting. Rounding happens here and nowhere in src/lib.

const intFmt = new Intl.NumberFormat('en-US');

export const fmtInt = (n: number) => intFmt.format(n);

/** Fractional days → "12.3 d"; null → "–". */
export const fmtDays = (d: number | null | undefined) => (d === null || d === undefined ? '–' : `${d.toFixed(1)} d`);

export const fmtPct = (p: number | null) => (p === null ? '–' : `${Math.round(p * 100)}%`);

/** UTC "YYYY-MM-DD HH:MM UTC". */
export const fmtDateTime = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? '–' : `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export const fmtDate = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? '–' : new Date(ms).toISOString().slice(0, 10);

export const fmtCountry = (c: string) => c || 'Unknown';
