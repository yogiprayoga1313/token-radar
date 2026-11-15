// Checks that the farm plan dashboard/farm.js draws in the page is byte for byte the plan
// lib/model.ts wrote into board.json, for every row, and that every step is inside the gate's
// 3..12 steps of 20..600 characters.
//
//   node tools/verify-farm.mjs <board.json>
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FARM = require('../dashboard/farm.js');

const boardPath = process.argv[2];
if (!boardPath) {
  process.stderr.write('usage: node tools/verify-farm.mjs <board.json>\n');
  process.exit(2);
}
const rows = JSON.parse(readFileSync(boardPath, 'utf8')).rows;

let mismatched = 0;
let badShape = 0;
let longest = 0;
let shortest = Infinity;
let steps = 0;

for (const row of rows) {
  const drawn = FARM.plan(row);
  const stored = row.farm_steps;

  if (drawn.length !== stored.length || drawn.some((s, i) => s !== stored[i])) {
    if (mismatched < 3) {
      const at = drawn.findIndex((s, i) => s !== stored[i]);
      process.stderr.write(`MISMATCH ${row.slug} step ${at + 1}\n  page:  ${drawn[at]}\n  board: ${stored[at]}\n`);
    }
    mismatched++;
  }

  if (stored.length < 3 || stored.length > 12) {
    process.stderr.write(`SHAPE ${row.slug}: ${stored.length} steps\n`);
    badShape++;
  }
  for (const s of stored) {
    steps++;
    longest = Math.max(longest, s.length);
    shortest = Math.min(shortest, s.length);
    if (s.length < 20 || s.length > 600) {
      process.stderr.write(`SHAPE ${row.slug}: a step of ${s.length} characters\n`);
      badShape++;
    }
  }
}

process.stdout.write(`rows ${rows.length}, steps ${steps}, lengths ${shortest}..${longest} (gate: 20..600)\n`);
process.stdout.write(mismatched === 0 ? 'page and board agree on every row\n' : `${mismatched} rows disagree\n`);

// How much of the plan actually varies between protocols: the whole point of the exercise.
const uniq = new Set(rows.map((r) => r.farm_steps.join(' ')));
const perStep = rows[0].farm_steps.map((_, i) => new Set(rows.map((r) => r.farm_steps[i])).size);
process.stdout.write(`distinct whole plans: ${uniq.size}/${rows.length}\n`);
process.stdout.write(`distinct text per step: ${perStep.join(', ')}\n`);

process.exit(mismatched === 0 && badShape === 0 ? 0 : 1);
