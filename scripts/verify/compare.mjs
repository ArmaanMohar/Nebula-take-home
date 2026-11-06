// Diff independent.json vs app.json (durations + stuck ids).
import { readFileSync } from 'node:fs';
const ind = JSON.parse(readFileSync(new URL('./out/independent.json', import.meta.url)));
const app = JSON.parse(readFileSync(new URL('./out/app.json', import.meta.url)));
const eq = (a, b) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-9);
let bad = 0;
for (const st of Object.keys(ind.durations)) for (const p of ['all', 'wgs_30x', 'wgs_100x']) {
  const i = ind.durations[st][p], a = app.durations[st][p];
  const ok = i.n === a.n && eq(i.median, a.median) && eq(i.p90, a.p90) && eq(i.pctOver, a.pctOver);
  if (!ok) bad++;
  console.log(`${st}\t${p}\tn ${i.n}/${a.n}\tmed ${i.median?.toFixed(2)}/${a.median?.toFixed(2)}\tp90 ${i.p90?.toFixed(2)}/${a.p90?.toFixed(2)}\tover ${(i.pctOver*100).toFixed(1)}%/${(a.pctOver*100).toFixed(1)}%\topen ${a.openNow}/${a.openOver}\t${ok ? 'MATCH' : 'MISMATCH'}`);
}
const si = new Set(ind.stuck.ids), sa = new Set(app.stuck.ids);
console.log('stuck only independent:', [...si].filter((x) => !sa.has(x)));
console.log('stuck only app:', [...sa].filter((x) => !si.has(x)));
console.log('duration mismatches:', bad);
