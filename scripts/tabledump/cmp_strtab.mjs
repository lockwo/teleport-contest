// Cross-check every C static string table (>=3 string literals) against the JS tree.
import { readFileSync, readdirSync } from 'fs';
const REC = process.env.RECORDER || (process.env.REPO_ROOT || process.cwd()) + '/nethack-c/recorder';
const R = process.env.REPO_ROOT || process.cwd();
const CS = REC + '';
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
const unesc = (s) => s.replace(/\\(n|t|"|'|\\|0)/g, (m, c) => ({ n: '\n', t: '\t', '"': '"', "'": "'", '\\': '\\', 0: '\0' }[c]));
// JS string token streams
const jsStreams = {}; const jsFiles = readdirSync(R + '/js').filter(f => f.endsWith('.js') && !/_data\.js$/.test(f));
function jsTokens(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2 || src.length; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1, buf = '';
      while (j < src.length && src[j] !== ch) { if (src[j] === '\\') { const n = src[j + 1]; buf += ({ n: '\n', t: '\t', '"': '"', "'": "'", '\\': '\\', 0: '\0' })[n] ?? n; j += 2; } else buf += src[j++]; }
      out.push(buf); i = j + 1; continue;
    }
    i++;
  }
  return out;
}
const all = [];
for (const f of jsFiles) { const t = jsTokens(readFileSync(R + '/js/' + f, 'utf8')); jsStreams[f] = t; }
const index = new Map(); // first string -> [[file, idx]]
for (const [f, t] of Object.entries(jsStreams)) t.forEach((s, i) => { if (!index.has(s)) index.set(s, []); index.get(s).push([f, i]); });
const missing = [];
let total = 0, found = 0;
const csrc = [...readdirSync(CS + '/src').filter(f => f.endsWith('.c')).map(f => 'src/' + f), ...readdirSync(CS + '/include').filter(f => f.endsWith('.h')).map(f => 'include/' + f)];
for (const f of csrc) {
  const src = strip(readFileSync(CS + '/' + f, 'utf8'));
  for (const m of src.matchAll(/\b([A-Za-z_][A-Za-z_0-9]*)\s*\[[^\]\n;]*\]\s*(?:\[[^\]\n;]*\]\s*)?=\s*\{/g)) {
    let i = m.index + m[0].length, depth = 1, j = i;
    while (j < src.length && depth) { const ch = src[j]; if (ch === '"') { j++; while (j < src.length && src[j] !== '"') { if (src[j] === '\\') j++; j++; } } else if (ch === "'") { j++; while (j < src.length && src[j] !== "'") { if (src[j] === '\\') j++; j++; } } else if (ch === '{') depth++; else if (ch === '}') depth--; j++; }
    const body = src.slice(i, j - 1);
    // concatenate adjacent literals
    const strs = []; let cur = null;
    for (const t of body.matchAll(/"((?:[^"\\\n]|\\.)*)"|('(?:[^'\\]|\\.)*')|([^\s"']+)/g)) {
      if (t[1] !== undefined) cur = (cur ?? '') + unesc(t[1]);
      else if (t[3] !== undefined || t[2] !== undefined) { if (cur !== null) { strs.push(cur); cur = null; } }
    }
    if (cur !== null) strs.push(cur);
    if (strs.length < 3) continue;
    total++;
    // look for a contiguous run of >= min(strs.length, all) in JS tokens
    const first = strs[0]; let ok = false; const cands = index.get(first) || [];
    for (const [jf, ji] of cands) { const t = jsStreams[jf]; let k = 0; while (k < strs.length && t[ji + k] === strs[k]) k++; if (k === strs.length) { ok = true; break; } }
    if (ok) found++; else {
      // partial: longest prefix match anywhere
      let best = 0, where = ''; for (const [jf, ji] of cands) { const t = jsStreams[jf]; let k = 0; while (k < strs.length && t[ji + k] === strs[k]) k++; if (k > best) { best = k; where = jf; } }
      missing.push({ file: f, name: m[1], n: strs.length, prefix: best, where, first: first.slice(0, 40) });
    }
  }
}
console.log('C string tables (>=3 strings):', total, 'fully present in JS:', found, 'not found:', missing.length);
for (const x of missing) console.log(`${x.file} ${x.name}[${x.n}] best-prefix ${x.prefix}${x.where ? ' in ' + x.where : ''} first=${JSON.stringify(x.first)}`);

console.log('RESULT (informational) C string tables not found verbatim in js=' + missing.length + '; most are struct/pair tables js stores differently');
