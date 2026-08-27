// Minimal differential STATE ORACLE (single-segment).  Runs our JS with
// NHJSDUMP=1 (env-gated per-boundary state snapshot in jsmain), then diffs the
// monster/hero state against the C ground-truth dump
// (/private/tmp/gt/seed<N>.monsters.jsonl) to pinpoint the FIRST boundary where
// our state diverges from C.  Usage:
//   NHJSDUMP=1 node scripts/oracle-mini.mjs <session.json> <gtSeed>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.env.REPO_ROOT || process.cwd();
process.env.NHJSDUMP = process.env.NHJSDUMP || '1';
const { normalizeSession } = await import(join(ROOT, 'frozen/session_loader.mjs'));
const { runSegment } = await import(join(ROOT, 'js/jsmain.js'));

const sessionName = process.argv[2];
const gtSeed = process.argv[3];
const gtLines = readFileSync(`/private/tmp/gt/seed${gtSeed}.monsters.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const sessionData = JSON.parse(readFileSync(join(ROOT, 'sessions', sessionName), 'utf8'));
const segments = normalizeSession(sessionData).segments;
if (segments.length !== 1) console.log(`(note: ${segments.length} segments; minimal oracle aligns the first segment only)`);
const seg = segments[0];
const storage = new Map();
const sh = { getItem: (k) => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k), get length() { return storage.size; }, key(i) { let n = 0; for (const k of storage.keys()) { if (n === i) return k; n++; } return null; } };
const g = await runSegment({ seed: seg.seed, datetime: seg.datetime, nethackrc: seg.nethackrc, moves: seg.moves, storage: sh });
const snaps = g.getStateDumps ? g.getStateDumps() : [];

const N = Math.min(snaps.length, gtLines.length);
console.log(`session=${sessionName} gtSeed=${gtSeed}  JS boundaries=${snaps.length}  C boundaries=${gtLines.length}`);
const fmtMon = (m) => `${m.name}#${m.m_id}@(${m.mx},${m.my}) hp${m.mhp} flee${m.mflee} tame${m.mtame} peac${m.mpeaceful}`;
for (let i = 0; i < N; i++) {
  const js = snaps[i], c = gtLines[i];
  const cById = new Map(c.mons.filter((m) => !m.dead).map((m) => [m.m_id, m]));
  const jById = new Map(js.mons.map((m) => [m.m_id, m]));
  const diffs = [];
  if (js.rng !== c.rng) diffs.push(`RNG count: C=${c.rng} JS=${js.rng} (drift ${js.rng - c.rng})`);
  if (js.ux !== c.ux || js.uy !== c.uy) diffs.push(`hero pos: C=(${c.ux},${c.uy}) JS=(${js.ux},${js.uy})`);
  for (const [id, cm] of cById) {
    const jm = jById.get(id);
    if (!jm) { diffs.push(`MISSING in JS: ${fmtMon(cm)}`); continue; }
    const fd = [];
    for (const f of ['mx', 'my', 'mhp', 'mflee', 'mtame', 'mpeaceful']) if (jm[f] !== cm[f]) fd.push(`${f}: C=${cm[f]} JS=${jm[f]}`);
    if (fd.length) diffs.push(`${cm.name}#${id}: ${fd.join(', ')}`);
  }
  for (const [id, jm] of jById) if (!cById.has(id)) diffs.push(`EXTRA in JS: ${fmtMon(jm)}`);
  if (diffs.length) {
    console.log(`\n>>> FIRST STATE DIVERGENCE at boundary seq=${i + 1} (C moves=${c.moves}, dlevel=${c.dlevel}, rng~${c.rng}) <<<`);
    for (const d of diffs.slice(0, 12)) console.log('   ' + d);
    console.log(`   C  (${c.mons.length}): ${c.mons.filter((m) => !m.dead).map(fmtMon).join(' | ')}`);
    console.log(`   JS (${js.mons.length}): ${js.mons.map(fmtMon).join(' | ')}`);
    process.exit(0);
  }
}
console.log(`\nNo monster/hero divergence in the first ${N} aligned boundaries (JS captured ${snaps.length}).`);
