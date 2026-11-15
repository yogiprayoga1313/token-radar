// Token Radar's entrypoint: one sealed snapshot in, one graded /output out.
//
// The grader runs this file on Node 22 with no network and no dependencies. It reads the protocol
// universe from /input/snapshot.json, scores every pre-token protocol with the model in lib/model.ts,
// and writes the seven things the gate reads:
//
//   /output/board.json        the ranked board, every watchlist slug covered
//   /output/data.js           the same board as one script the dashboard loads, no fetch, no network
//   /output/dashboard/        the page itself, copied from this repository
//   /output/screenshots/      3 or 4 images of that page, copied from this repository
//   /output/dossier.json      written last, from everything above, with the kit's own library
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR (or --output) stands in for /output:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// Every failure here exits non-zero with one line saying what to fix, because a silent half-written
// /output is worse than no output: the scorer would grade the half.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, SnapshotError } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps, from the sealed reference/gate.json. Kept here so a breach fails loudly. */
const CAPS = {
  textMaxBytes: 65_536,
  screenshots: { min: 3, max: 4, maxBytes: 524_288 },
  dashboard: { maxFiles: 400, maxBytes: 4_194_304 },
};

/** A screenshot's name: letters, digits and . _ -, 1 to 128 characters, not starting with a dot. */
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Stop with one line on stderr and a non-zero status. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** `--name value` or `--name=value` from the command line, else `fallback`. */
function arg(name: string, fallback: string): string {
  const flag = `--${name}`;
  const at = process.argv.indexOf(flag);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`${flag}=`));
  return joined === undefined ? fallback : joined.slice(flag.length + 1);
}

/** Copy one directory's plain files into `to`, skipping dot files; the names copied, sorted. */
function copyPlainFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** The total size of the named files in a directory. */
function bytesOf(dir: string, names: string[]): number {
  return names.reduce((sum, name) => sum + statSync(join(dir, name)).size, 0);
}

// ---------------------------------------------------------------------------------------------
// 1. The snapshot.
// ---------------------------------------------------------------------------------------------

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (error) {
  if (error instanceof SnapshotError) fail(`${inputFile}: ${error.message}`);
  throw error;
}

// ---------------------------------------------------------------------------------------------
// 2. The board. Refused here rather than written half-scored.
// ---------------------------------------------------------------------------------------------

const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

// ---------------------------------------------------------------------------------------------
// 3. The output tree.
// ---------------------------------------------------------------------------------------------

const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
mkdirSync(out, { recursive: true });

writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

const dashboardDir = join(out, 'dashboard');
const dashboard = copyPlainFiles(join(here, 'dashboard'), dashboardDir);
if (dashboard.length === 0) fail('dashboard/ is empty: the gate reads the page from this repository');
if (!dashboard.includes('index.html')) fail(`dashboard/ has no index.html (found: ${dashboard.join(', ')})`);
if (dashboard.length > CAPS.dashboard.maxFiles) {
  fail(`dashboard/ holds ${dashboard.length} files, past the gate's ${CAPS.dashboard.maxFiles}`);
}
const dashboardBytes = bytesOf(dashboardDir, dashboard);
if (dashboardBytes > CAPS.dashboard.maxBytes) {
  fail(`dashboard/ is ${dashboardBytes} bytes, past the gate's ${CAPS.dashboard.maxBytes}`);
}

const shotsDir = join(out, 'screenshots');
const shots = copyPlainFiles(join(here, 'screenshots'), shotsDir);
if (shots.length < CAPS.screenshots.min || shots.length > CAPS.screenshots.max) {
  fail(
    `screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in ${CAPS.screenshots.min} or ${CAPS.screenshots.max}, ` +
      'the board, a protocol detail view and a filtered view',
  );
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  const size = statSync(join(shotsDir, name)).size;
  if (size > CAPS.screenshots.maxBytes) {
    fail(`screenshots/${name} is ${size} bytes, past the gate's ${CAPS.screenshots.maxBytes}: render it smaller`);
  }
}

// ---------------------------------------------------------------------------------------------
// 4. The dossier, written last: the scorer rebuilds it from this /output and compares bytes.
// ---------------------------------------------------------------------------------------------

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: CAPS.textMaxBytes,
    screenshots: { max: CAPS.screenshots.max, max_bytes: CAPS.screenshots.maxBytes },
    dashboard: { max_files: CAPS.dashboard.maxFiles, max_bytes: CAPS.dashboard.maxBytes },
  }),
);

// ---------------------------------------------------------------------------------------------
// 5. Say what was written, so a run that passes is as legible as one that fails.
// ---------------------------------------------------------------------------------------------

const quoted = radar.categories.length;
const global = radar.global_multiple;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols read, ${snapshot.watchlist.length} on the watchlist, ` +
    `${radar.peer_protocols} with a live token priced from\n` +
    `token radar: ${board.length} rows scored (${radar.early_size} below the floor), ` +
    `${quoted} peer multiples around a ${global}x global median, ${radar.live_size} live-token protocols set aside\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashboard.length} files, ${dashboardBytes} bytes), ` +
    `screenshots/ (${shots.length}) and dossier.json under ${out}\n`,
);
