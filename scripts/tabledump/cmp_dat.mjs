import { readFileSync, existsSync } from 'fs';
const REC = process.env.RECORDER || (process.env.REPO_ROOT || process.cwd()) + '/nethack-c/recorder';
const R = process.env.REPO_ROOT || process.cwd();
const INST = REC + '/install/games/lib/nethackdir/';
const DAT = REC + '/dat/';
let bad = 0;
const chk = async (mod, exp, file) => {
  const m = await import(R + '/js/' + mod); const jb = Buffer.from(m[exp], 'base64');
  for (const base of [INST, DAT]) { const p = base + file; if (!existsSync(p)) { console.log(mod, exp, 'no', p); continue; }
    const cb = readFileSync(p); console.log(mod, exp, base === INST ? 'install/' : 'dat/', file, 'C', cb.length, 'JS', jb.length, cb.equals(jb) ? 'IDENTICAL' : 'DIFFERENT'); if (!cb.equals(jb)) bad++; }
};
await chk('rumors_data.js', 'RUMORS_B64', 'rumors'); await chk('rumors_data.js', 'ENGRAVE_B64', 'engrave');
await chk('epitaph_data.js', 'EPITAPH_B64', 'epitaph'); await chk('bogusmon_data.js', 'BOGUSMON_B64', 'bogusmon');
await chk('oracles_data.js', 'ORACLES_B64', 'oracles'); await chk('tribute_data.js', 'TRIBUTE_B64', 'tribute');

console.log('RESULT dlb data files (rumors engrave epitaph bogusmon oracles tribute) mismatches=' + bad); process.exitCode = bad ? 1 : 0;
