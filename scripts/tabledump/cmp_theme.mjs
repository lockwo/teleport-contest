import { readFileSync } from 'fs';
import { grab } from './grab.mjs';
const REC = process.env.RECORDER || (process.env.REPO_ROOT || process.cwd()) + '/nethack-c/recorder';
const R = process.env.REPO_ROOT || process.cwd();
const lua = readFileSync(REC + '/dat/themerms.lua', 'utf8');
const sect = (a, b) => lua.slice(lua.indexOf(a), b ? lua.indexOf(b) : undefined);
const parse = (txt) => { const out = [];
  // top-level entries start with "   {\n      name ="
  const parts = txt.split(/\n   \{\n(?=\s+name = )/).slice(1);
  for (const p of parts) { const g = (k) => { const m = new RegExp('\\n\\s{6}' + k + ' = (\\d+)').exec('\n' + p); return m ? +m[1] : undefined; };
    const nm = /name = ["']([^"']*)["']/.exec(p)[1];
    out.push({ name: nm, frequency: g('frequency') ?? 1, mindiff: g('mindiff'), maxdiff: g('maxdiff'), eligible: /\n\s{6}eligible = /.test(p) }); }
  return out; };
const fills = parse(sect('themeroom_fills = {', 'themerooms = {'));
const rooms = parse(sect('themerooms = {', 'function is_eligible'));
console.log('lua fills', fills.length, 'lua rooms', rooms.length);
const jsm = readFileSync(R + '/js/mklev.js', 'utf8');
const META = grab(R + '/js/mklev.js', 'THEMEROOM_META');
console.log('JS rooms', META.length);
let bad = 0;
rooms.forEach((r, i) => { const j = META[i]; const jn = j?.name;
  // JS shortens one name; compare by prefix
  const same = jn === r.name || (jn && r.name.startsWith(jn));
  if (!same || r.frequency !== j.frequency || (r.mindiff ?? undefined) !== (j.mindiff ?? undefined) || (r.maxdiff ?? undefined) !== (j.maxdiff ?? undefined)) { bad++; console.log('ROOM MISMATCH', i, JSON.stringify(r), JSON.stringify(j)); } });
const sp = readFileSync(R + '/js/sp_lev.js', 'utf8');
const a = sp.indexOf('const fills = ['); const b = sp.indexOf('];', a);
const jf = [...sp.slice(a, b).matchAll(/\{ name: '([^']*)'(?:, mindiff: (\d+))?(?:, maxdiff: (\d+))?(, eligible)?/g)].map(m => ({ name: m[1], mindiff: m[2] ? +m[2] : undefined, maxdiff: m[3] ? +m[3] : undefined, eligible: !!m[4] }));
console.log('JS fills', jf.length);
fills.forEach((r, i) => { const j = jf[i]; if (!j || r.name !== j.name || (r.mindiff) !== j.mindiff || (r.maxdiff) !== j.maxdiff || r.eligible !== j.eligible || r.frequency !== 1) { bad++; console.log('FILL MISMATCH', i, JSON.stringify(r), JSON.stringify(j)); } });
console.log('theme mismatches', bad);
// map bodies
const lm = [...lua.matchAll(/\[\[\n?([\s\S]*?)\]\]/g)].map(m => m[1].replace(/\n$/, ''));
const jm = [...jsm.matchAll(/map: `([\s\S]*?)`/g)].map(m => m[1].replace(/\n$/, ''));
const norm = (s) => s.split('\n').map(l => l.replace(/\s+$/, '')).join('\n');
const ls = new Set(lm.map(norm)), js_ = new Set(jm.map(norm));
let onlyL = 0; for (const m of ls) if (!js_.has(m)) { onlyL++; console.log('lua map not in JS:\n' + m); }
let onlyJ = 0; for (const m of js_) if (!ls.has(m)) { onlyJ++; console.log('JS map not in lua:\n' + m); }
console.log('lua maps', lm.length, 'JS maps', jm.length, 'only lua', onlyL, 'only JS', onlyJ);

console.log('RESULT themerms.lua mismatches=' + (bad + onlyL + onlyJ)); process.exitCode = (bad + onlyL + onlyJ) ? 1 : 0;
