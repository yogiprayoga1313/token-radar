// Runs the blind test and prints it, and sweeps the model's two peer-set knobs so the values in
// MODEL are the ones the test actually prefers rather than the ones that sounded right.
//
//   node --experimental-strip-types tools/backtest.mjs <snapshot.json>
import { readFileSync } from 'node:fs';
import { parseSnapshot, validate, MODEL } from '../lib/model.ts';

const snapshot = parseSnapshot(readFileSync(process.argv[2], 'utf8'));

const show = (label, h) => {
  console.log(
    `${label.padEnd(26)} typical miss ${String(h.model.median_ratio + 'x').padStart(6)}` +
      `   within 2x ${String(h.model.within_2x + '%').padStart(6)}` +
      `   within 3x ${String(h.model.within_3x + '%').padStart(6)}`,
  );
};

const base = validate(snapshot, MODEL);
console.log(`blind test on ${base.tested} live-token protocols\n`);
console.log(`${'one constant x TVL'.padEnd(26)} typical miss ${String(base.baseline.median_ratio + 'x').padStart(6)}   within 2x ${String(base.baseline.within_2x + '%').padStart(6)}   within 3x ${String(base.baseline.within_3x + '%').padStart(6)}`);
show('priced by category', base);
console.log(`\nthe category model cuts the typical error by ${base.error_cut_pct}%\n`);

console.log('--- sweep: shrinkage k (how hard a thin peer set is pulled to the global median) ---');
for (const k of [0, 1, 2, 3, 5, 8, 12, 20]) {
  const h = validate(snapshot, { ...MODEL, peer_shrinkage: k });
  console.log(`  k=${String(k).padStart(2)}  miss ${String(h.model.median_ratio + 'x').padStart(6)}  within2x ${String(h.model.within_2x + '%').padStart(6)}  cut ${String(h.error_cut_pct + '%').padStart(7)}${k === MODEL.peer_shrinkage ? '   <- in use' : ''}`);
}

console.log('\n--- sweep: peer_min (live peers a set needs before it is quoted) ---');
for (const n of [2, 3, 4, 5, 6, 8]) {
  const h = validate(snapshot, { ...MODEL, peer_min: n });
  console.log(`  n=${String(n).padStart(2)}  miss ${String(h.model.median_ratio + 'x').padStart(6)}  within2x ${String(h.model.within_2x + '%').padStart(6)}  cut ${String(h.error_cut_pct + '%').padStart(7)}${n === MODEL.peer_min ? '   <- in use' : ''}`);
}
