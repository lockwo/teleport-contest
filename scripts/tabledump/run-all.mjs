#!/usr/bin/env node
// Table-equality gate: C (recorder build) vs JS.  Builds the C dumper against nethack-c/recorder
// (compiled objects[], mons[], artilist[], roles[], races[], shtypes[], defsyms, u_init.c tables, enums),
// then runs every cmp_*.mjs and prints one RESULT line per table family.
//   node scripts/tabledump/run-all.mjs            # build + compare everything
//   node scripts/tabledump/run-all.mjs --no-build # reuse /tmp/ctables.json
//   TD_SEEDS=1,2,3 ...                             # init_objects() shuffle seeds (default 1..6)
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = dirname(fileURLToPath(import.meta.url));
const root = process.env.REPO_ROOT || join(dir, '..', '..');
const env = { ...process.env, REPO_ROOT: root, TD_SEEDS: process.env.TD_SEEDS || '1,2,3,4,5,6' };
if (!process.argv.includes('--no-build')) execFileSync('sh', [join(dir, 'build.sh')], { env, stdio: 'inherit' });
const scripts = ['cmp_obj', 'cmp_obj2', 'cmp_shuffle', 'cmp_mons', 'cmp_art', 'cmp_roles', 'cmp_uinit', 'cmp_abil', 'cmp_shk', 'cmp_sym', 'cmp_symset', 'cmp_enum', 'cmp_dungeon', 'cmp_theme', 'cmp_maps', 'cmp_dat', 'cmp_dat2', 'cmp_quest', 'cmp_strtab'];
let failed = 0;
for (const s of scripts) {
  const r = spawnSync('node', [join(dir, s + '.mjs')], { env, encoding: 'utf8', maxBuffer: 1 << 26 });
  const lines = (r.stdout || '').split('\n');
  const res = lines.filter(l => l.startsWith('RESULT')).pop() || `RESULT ${s} no result line (exit ${r.status}) ${(r.stderr || '').split('\n').slice(0, 3).join(' | ')}`;
  console.log((r.status ? 'FAIL ' : 'ok   ') + res.replace(/^RESULT /, ''));
  if (r.status) { failed++; if (process.argv.includes('-v')) console.log(r.stdout, r.stderr); }
}
console.log(failed ? `${failed} table families differ (rerun with -v, or run the cmp_*.mjs alone)` : 'all table families equal');
process.exitCode = failed ? 1 : 0;
