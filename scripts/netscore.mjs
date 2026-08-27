// Net-score gate: runs frozen/score.sh against THIS checkout (cwd) and prints
// the total public screen count + per-session counts.  Pass a baseline JSON
// (produced by `--save <file>`) to print deltas, flag regressions, and gate.
//
// This is a MERGE GATE, not just a report:
//   exit 0 = ACCEPT   (strictly gained screens, no session regressed)
//   exit 1 = REJECT   (a session lost screens, or no net gain)
//   exit 2 = GATE ERROR (stale/missing baseline, bad args) — never a silent green
//
// Usage:
//   node scripts/netscore.mjs --save baseline.json          # snapshot current (records HEAD sha)
//   node scripts/netscore.mjs --base baseline.json          # gate current vs snapshot
//   node scripts/netscore.mjs --base baseline.json --base-ref origin/main
//   node scripts/netscore.mjs --base baseline.json --allow-stale   # skip the sha-freshness check
//   node scripts/netscore.mjs --base baseline.json --allow-flat    # ACCEPT a flat total
//                                        (for a held-out-only fix; regressions still fail)
//
// Dynamic base (item 2): a baseline records the git SHA it was scored at.
// On --base we assert that sha equals the current base ref (default
// origin/main) — the accepted integration tip that candidates branch from —
// and REFUSE (exit 2) if they differ, so a stale baseline can never produce a
// false ACCEPT.  The freshness check runs BEFORE scoring, so a stale baseline
// fails fast.  Save the baseline from a clean checkout of the accepted tip.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ROOT = process.env.REPO_ROOT || process.cwd();
const args = process.argv.slice(2);
const flagVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const saveTo = flagVal('--save');
const baseFrom = flagVal('--base');
const baseRef = flagVal('--base-ref') || 'origin/main';
const allowStale = args.includes('--allow-stale');
const allowFlat = args.includes('--allow-flat');

function git(cmd) {
  try { return execSync(`git ${cmd}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return null; }
}

// ── --base: validate the baseline BEFORE spending a full score run ───────────
let base = null, baseSha = null;
if (baseFrom) {
  if (!existsSync(baseFrom)) { console.error(`GATE ERROR: baseline not found: ${baseFrom}`); process.exit(2); }
  const raw = JSON.parse(readFileSync(baseFrom, 'utf8'));
  // Accept both the new { sha, screens } shape and the legacy flat { session: count } map.
  const isNew = raw && typeof raw === 'object' && raw.screens && typeof raw.screens === 'object';
  base = isNew ? raw.screens : raw;
  baseSha = isNew ? raw.sha : null;
  // A stepgate baseline is a DIFFERENT shape (per-step index sets, no `screens`
  // map).  Handed one, the legacy-flat branch above used to treat `sha`/`total`
  // as session names and print `BASELINE total: 0<sha>7315[object Object]` with
  // DELTA NaN — a garbage REJECT that looks like a real regression.  Refuse it.
  if (!isNew) {
    const bad = Object.entries(base).filter(([, v]) => typeof v !== 'number');
    if (bad.length || !Object.keys(base).length) {
      console.error(`GATE ERROR: ${baseFrom} is not a netscore baseline`
                    + ` (found non-numeric key(s): ${bad.slice(0, 3).map(([k]) => k).join(', ') || 'none'}).`);
      console.error('  netscore and stepgate baselines are NOT interchangeable — keep them in separate files.');
      console.error('  Re-create both with: node swarm/bin/mkbase.mjs');
      process.exit(2);
    }
  }

  if (baseSha && !allowStale) {
    const expected = git(`rev-parse ${baseRef}`);
    if (expected == null) {
      console.error(`GATE ERROR: cannot resolve base ref '${baseRef}' to verify baseline freshness (use --allow-stale to override).`);
      process.exit(2);
    }
    if (baseSha !== expected) {
      console.error(`GATE ERROR: stale baseline. Baseline was scored at ${baseSha} but ${baseRef} is now ${expected}.`);
      console.error(`  Re-run: node scripts/netscore.mjs --save ${baseFrom}  from a clean checkout of ${baseRef}. (or --allow-stale)`);
      process.exit(2);
    }
  } else if (!baseSha) {
    console.error('WARNING: legacy baseline without a recorded sha — freshness unchecked. Re-save to enable the dynamic-base guard.');
  }
}

// ── score the current checkout ───────────────────────────────────────────────
const out = execSync('bash frozen/score.sh', { cwd: ROOT, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const jsonStr = out.slice(out.indexOf('__RESULTS_JSON__') + '__RESULTS_JSON__'.length).trim();
const j = JSON.parse(jsonStr);
const map = {}; let tot = 0;
for (const r of j.results) { const m = r.metrics.screens.matched; map[r.session] = m; tot += m; }
console.log('TOTAL public screens:', tot);

// ── --save: snapshot with provenance ────────────────────────────────────────
if (saveTo) {
  const sha = git('rev-parse HEAD');
  writeFileSync(saveTo, JSON.stringify({ sha, ref: git('rev-parse --abbrev-ref HEAD'), total: tot, screens: map }, null, 0));
  console.log(`saved baseline -> ${saveTo}  (sha ${sha || '?'})`);
}

// ── --base: gate ─────────────────────────────────────────────────────────────
if (baseFrom) {
  let bt = 0, regressions = [], gains = [];
  for (const k of Object.keys(base)) {
    bt += base[k];
    const d = (map[k] ?? 0) - base[k];
    if (d < 0) regressions.push(`${k}: ${base[k]}->${map[k] ?? 0} (${d})`);
    else if (d > 0) gains.push(`${k}: ${base[k]}->${map[k]} (+${d})`);
  }
  console.log('BASELINE total:', bt, ' DELTA:', tot - bt);
  if (gains.length) { console.log('GAINS:'); gains.forEach(g => console.log('  +', g)); }
  if (regressions.length) { console.log('REGRESSIONS (merge gate FAIL):'); regressions.forEach(g => console.log('  !', g)); }
  else console.log('no regressions');

  // --allow-flat: a GENERALIZATION-only fix (one that targets the held-out proxy)
  // legitimately leaves public unchanged.  Requiring a net public gain rejects
  // it, which is the wrong verdict — proxyscore.mjs has always used exactly this
  // rule for the same reason.  Regressions still fail either way.
  const accept = regressions.length === 0 && (allowFlat || tot - bt > 0);
  console.log(accept ? 'VERDICT: ACCEPT' : 'VERDICT: REJECT');
  // item 1: a REJECT must be observable by exit code, not just stdout.
  process.exit(accept ? 0 : 1);
}
