import { readFileSync } from 'fs';
const REC = process.env.RECORDER || (process.env.REPO_ROOT || process.cwd()) + '/nethack-c/recorder';
const R = process.env.REPO_ROOT || process.cwd();
const D = REC + '/dat/';
const pd = await import(R + '/js/pager_data.js');
const tabexp = (s) => { let o = ''; for (const ch of s) { if (ch === '\t') o += ' '.repeat(8 - (o.length % 8)); else o += ch; } return o; };
let bad = 0;
const files = { DEBUGHELP: 'wizhelp', HELP: 'help', SHELP: 'hh', HISTORY: 'history', OPTIONFILE: 'opthelp', OPTMENUHELP: 'optmenu', USAGEHELP: 'usagehlp', LICENSE: 'license', KEYHELP: 'keyhelp' };
for (const [k, f] of Object.entries(files)) {
  const txt = readFileSync(D + f, 'utf8'); const lines = txt.split('\n'); if (lines[lines.length - 1] === '') lines.pop();
  const cl = lines.map(tabexp), jl = pd[k].map(tabexp);
  let first = -1; for (let i = 0; i < Math.max(cl.length, jl.length); i++) if (cl[i] !== jl[i]) { first = i; break; }
  if (first >= 0) bad++;
  console.log(k, f, 'C lines', cl.length, 'JS lines', jl.length, first < 0 ? 'IDENTICAL' : 'DIFF at line ' + first + '\n  C: ' + JSON.stringify(cl[first]) + '\n  JS: ' + JSON.stringify(jl[first]));
}
// data.base vs DATABASE_ENTRIES
const db = await import(R + '/js/data_base_data.js');
const raw = readFileSync(D + 'data', 'utf8');
console.log('data file bytes', raw.length, 'DATABASE_TXT_OFFSET', db.DATABASE_TXT_OFFSET);
const idx = raw.slice(0, db.DATABASE_TXT_OFFSET).split('\n'); const txt = raw.slice(db.DATABASE_TXT_OFFSET);
const ents = []; let keys = [];
for (let k = 1; k < idx.length; k++) { const l = idx[k]; if (l === '' || (k === 1 && /^[0-9a-f]{8}$/.test(l))) continue; const m = /^(\d+),(\d+)$/.exec(l); if (m) { ents.push([keys, +m[1], +m[2]]); keys = []; } else keys.push(l); }
const tl = txt.split('\n');
console.log('C entries', ents.length, 'JS entries', db.DATABASE_ENTRIES.length);
let diffs = 0;
for (let k = 0; k < Math.max(ents.length, db.DATABASE_ENTRIES.length); k++) { const a = ents[k], b = db.DATABASE_ENTRIES[k]; if (!a || !b) { diffs++; console.log('entry', k, 'missing', !!a, !!b); break; }
  const rawtxt = txt.slice(0); // offsets are byte offsets into txt region
  const body = Buffer.from(txt, 'utf8').subarray(a[1]).toString('utf8').split('\n').slice(0, a[2]);
  if (JSON.stringify(a[0]) !== JSON.stringify(b[0]) || a[1] !== b[1] || JSON.stringify(body) !== JSON.stringify(b[2])) { diffs++; if (diffs < 4) console.log('entry', k, 'differs', JSON.stringify(a[0]), a[1], JSON.stringify(b[0]), b[1], JSON.stringify(body).slice(0,100), JSON.stringify(b[2]).slice(0,100)); } }
console.log('database diffs', diffs);
// the terminating '.' entry (273429,0) is C-only by design
bad += Math.max(0, diffs - 1);
console.log('RESULT help files + data.base mismatches=' + bad); process.exitCode = bad ? 1 : 0;
