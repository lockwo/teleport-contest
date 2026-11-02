// every multi-row des.map / long-bracket map in dat/*.lua must appear as consecutive row strings (or one multi-line string) in js/
import { readFileSync, readdirSync } from 'fs';
const REC = process.env.RECORDER || (process.env.REPO_ROOT || process.cwd()) + '/nethack-c/recorder';
const R = process.env.REPO_ROOT || process.cwd();
const DAT = REC + '/dat/';
function tokens(src) { const out = []; let i = 0;
  while (i < src.length) { const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { let j = i + 1, buf = ''; while (j < src.length && src[j] !== ch) { if (src[j] === '\\') { const n = src[j + 1]; buf += ({ n: '\n', t: '\t', '"': '"', "'": "'", '\\': '\\' })[n] ?? n; j += 2; } else buf += src[j++]; } out.push(buf); i = j + 1; continue; }
    i++; }
  return out; }
const all = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(d + '/' + e.name); else if (e.name.endsWith('.js') && !/_data\.js$/.test(e.name)) all.push(d + '/' + e.name); } };
walk(R + '/js');
const rowSeqs = new Set(); const joined = [];
for (const f of all) { const t = tokens(readFileSync(f, 'utf8')); joined.push(t.flatMap(x => x.split('\n')).map(x => x.replace(/\s+$/, '')).filter(x => x !== '').join('\u0001'));
  // multi-line strings
  for (const s of t) if (s.includes('\n')) rowSeqs.add(s.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').trim()); }
const jsRows = joined.join('\u0002');
let total = 0, missing = [];
for (const f of readdirSync(DAT).filter(f => f.endsWith('.lua'))) {
  const txt = readFileSync(DAT + f, 'utf8');
  for (const m of txt.matchAll(/\[\[\n?([\s\S]*?)\]\]/g)) {
    const rows = m[1].split('\n').map(l => l.replace(/\s+$/, '')); while (rows.length && !rows[rows.length - 1]) rows.pop(); while (rows.length && !rows[0]) rows.shift();
    if (rows.length < 3 || !rows.every(r => /^[-|+.#}{ \\SKTLPCAWwIB0-9xXbdfstuzDHoOlLnN_:;,"'=<>^~`@*&%$!?()/]*$/.test(r))) continue;
    total++;
    const ml = rows.join('\n');
    if (rowSeqs.has(ml)) continue;
    const needle = rows.map(r => r.replace(/\s+$/, '')).filter(x => x !== '').join('\u0001');
    if (jsRows.includes('\u0001' + needle + '\u0001') || jsRows.includes(needle)) continue;
    // tolerate JS rows trimmed of trailing spaces / full-width padded: compare trimmed
    const trimmed = rows.map(r => r.replace(/\s+$/, ''));
    if (jsRows.includes(trimmed.join('\u0001'))) continue;
    missing.push(`${f} (${rows.length} rows) first: ${JSON.stringify(rows[0].slice(0, 50))}`);
  }
}
console.log('lua map-like blocks', total, 'not found in js', missing.length);
missing.forEach(m => console.log('  ' + m));

const known = /^(air|water|hellfill|bigrm-13)\.lua/;
const real = missing.filter(m => !known.test(m));
console.log('(air/water/hellfill/bigrm-13 maps are constructed in code, not stored as rows)');
console.log('RESULT special-level maps mismatches=' + real.length); process.exitCode = real.length ? 1 : 0;
