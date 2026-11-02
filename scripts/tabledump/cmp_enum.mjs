import { loadC } from './load.mjs';
import { readFileSync, readdirSync } from 'fs';
const R = process.env.REPO_ROOT || process.cwd();
const c = loadC().enums;
const want = new Map(); // JS identifier -> [value, set]
for (const [n, v] of Object.entries(c.e_obj)) want.set(n, [v, 'obj']);
for (const [n, v] of Object.entries(c.e_mons)) want.set(/^(NUMMONS|NON_PM|LOW_PM|HIGH_PM|SPECIAL_PM)$/.test(n) ? n : 'PM_' + n, [v, 'mons']);
for (const [n, v] of Object.entries(c.e_cmap)) want.set(n, [v, 'cmap']);
for (const [n, v] of Object.entries(c.e_monsym)) want.set(n, [v, 'monsym']);
for (const [n, v] of Object.entries(c.e_ocls)) want.set(n, [v, 'ocls']);
for (const [n, v] of Object.entries(c.e_arti)) want.set(n, [v, 'arti']);
console.log('sample cmap names', Object.keys(c.e_cmap).slice(0, 4), 'monsym', Object.keys(c.e_monsym).slice(0, 3), 'ocls', Object.keys(c.e_ocls).slice(0, 3));
let checked = 0, bad = 0; const out = [];
for (const f of readdirSync(R + '/js').filter(f => f.endsWith('.js'))) {
  const s = readFileSync(R + '/js/' + f, 'utf8');
  const decl = [...s.matchAll(/^(?:export )?const ([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(-?\d+|0x[0-9a-fA-F]+)\s*[;,]/gm)];
  // comma lists:  const A = 1, B = 2;
  for (const m of s.matchAll(/^(?:export )?const ((?:[A-Za-z_][A-Za-z_0-9]*\s*=\s*-?(?:0x[0-9a-fA-F]+|\d+)\s*,\s*)+[A-Za-z_][A-Za-z_0-9]*\s*=\s*-?(?:0x[0-9a-fA-F]+|\d+))\s*;/gm))
    for (const p of m[1].split(',')) { const [k, v] = p.split('='); decl.push([null, k.trim(), v.trim()]); }
  for (const d of decl) {
    const name = d[1], val = Number(d[2]); const w = want.get(name); if (!w) continue; checked++;
    if (w[0] !== val && !/^PM_(ARCHEOLOGIST|BARBARIAN|CAVE_DWELLER|HEALER|KNIGHT|MONK|CLERIC|RANGER|ROGUE|SAMURAI|TOURIST|VALKYRIE|WIZARD|HUMAN|ELF|DWARF|GNOME|ORC)$/.test(name)) { bad++; out.push(`${f}: ${name} = ${val}  (C ${w[1]} enum = ${w[0]})`); }
  }
}
console.log('JS numeric consts named like C enum members:', checked, 'mismatching:', bad);
out.forEach(l => console.log(' ', l));
// PM_<role>/PM_<race> in js/ are role/race INDICES (0..12 / 0..4), not mons[] indices: excluded on purpose.

console.log('RESULT enum constants mismatches=' + out.length); process.exitCode = out.length ? 1 : 0;
