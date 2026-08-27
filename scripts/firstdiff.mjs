// Diagnostic: for a session, run THIS checkout's JS port and report the first
// step whose 80x24 screen (cells+cursor) diverges from the recorded C screen,
// rendering both sides + the differing rows.  Repo root = cwd (so it works
// inside a git worktree).  Usage:  node scripts/firstdiff.mjs <session.json> [step]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.env.REPO_ROOT || process.cwd();
const { decodeScreen, diffCell } = await import(join(ROOT, 'frozen/screen-decode.mjs'));
const { normalizeSession } = await import(join(ROOT, 'frozen/session_loader.mjs'));
const { runSegment } = await import(join(ROOT, 'js/jsmain.js'));

const sessionName = process.argv[2];
const forceStep = process.argv[3] != null ? +process.argv[3] : -1;
const sessionData = JSON.parse(readFileSync(join(ROOT, 'sessions', sessionName), 'utf8'));
const segments = normalizeSession(sessionData).segments;
const gridOf = (s) => decodeScreen(s || '');

const cScreens = [], cCursors = [];
for (const seg of segments) for (const step of seg.steps || []) {
  if (step.screen) { cScreens.push(step.screen); cCursors.push(Array.isArray(step.cursor) ? step.cursor : null); }
}
const storage = new Map();
const sh = { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k), get length() { return storage.size; }, key(i) { let n = 0; for (const k of storage.keys()) { if (n === i) return k; n++; } return null; } };
let jsScreens = [], jsCursors = [];
for (const seg of segments) {
  const g = await runSegment({ seed: seg.seed, datetime: seg.datetime, nethackrc: seg.nethackrc, moves: seg.moves, storage: sh });
  jsScreens.push(...(g.getScreens?.() || []));
  jsCursors.push(...(g.getCursors?.() || []));
}
const gEq = (a, b) => { const ga = gridOf(a), gb = gridOf(b); for (let r = 0; r < 24; r++) for (let c = 0; c < 80; c++) if (diffCell(ga[r][c], gb[r][c])) return false; return true; };
const cEq = (a, b) => (!a && !b) ? true : (!a || !b) ? false : (a[0] === b[0] && a[1] === b[1]);
const N = Math.min(cScreens.length, jsScreens.length);
let firstCell = -1, firstCur = -1, matched = 0;
for (let i = 0; i < cScreens.length; i++) {
  const ck = i < N && gEq(jsScreens[i], cScreens[i]);
  const ur = i < N && cEq(jsCursors[i], cCursors[i]);
  if (ck && ur) matched++;
  if (!ck && firstCell < 0) firstCell = i;
  if (ck && !ur && firstCur < 0) firstCur = i;
}
console.log(`session=${sessionName}`);
console.log(`cScreens=${cScreens.length} jsScreens=${jsScreens.length} matched=${matched}`);
console.log(`first CELL mismatch step = ${firstCell}`);
console.log(`first CURSOR-only mismatch step = ${firstCur}`);
const target = forceStep >= 0 ? forceStep : (firstCell >= 0 ? firstCell : firstCur);
if (target >= 0 && target < N) {
  const show = (g) => g.map(r => r.map(c => c.ch || ' ').join('')).join('\n');
  console.log(`\n===== STEP ${target}: C cursor=${JSON.stringify(cCursors[target])} JS cursor=${JSON.stringify(jsCursors[target])} =====`);
  console.log('----- C (expected) -----'); console.log(show(gridOf(cScreens[target])));
  console.log('----- JS (ours) -----'); console.log(show(gridOf(jsScreens[target])));
  const gc = gridOf(cScreens[target]), gj = gridOf(jsScreens[target]);
  console.log('----- differing rows -----');
  for (let r = 0; r < 24; r++) { let d = false; for (let c = 0; c < 80; c++) if (diffCell(gj[r][c], gc[r][c])) { d = true; break; } if (d) { console.log(`row ${r}:`); console.log(`  C : "${gc[r].map(x => x.ch || ' ').join('')}"`); console.log(`  JS: "${gj[r].map(x => x.ch || ' ').join('')}"`); } }
}
