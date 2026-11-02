import { readFileSync } from 'fs';
const REC = process.env.RECORDER || (process.env.REPO_ROOT || process.cwd()) + '/nethack-c/recorder';
const R = process.env.REPO_ROOT || process.cwd();
const txt = readFileSync(REC + '/dat/symbols', 'utf8').split('\n');
const sets = {}; let cur = null;
const val = (v) => { v = v.trim(); if (!v.startsWith("'#'")) v = v.replace(/\s*#.*$/, ''); let m;
  if ((m = /^\\x([0-9a-fA-F]+)$/.exec(v))) return parseInt(m[1], 16);
  if ((m = /^\\0?(\d+)$/.exec(v))) return parseInt(m[1], 10);
  if ((m = /^'(.)'$/.exec(v))) return m[1].charCodeAt(0);
  if (v.startsWith("'#'")) return 35;
  if (v === "'\\\\'") return 92; if (v === "'\\''") return 39;
  if ((m = /^\\(.)$/.exec(v))) return m[1].charCodeAt(0);
  return v; };
for (const l of txt) { let m;
  if ((m = /^start:\s*(\S+)/.exec(l))) { cur = { name: m[1], syms: {}, other: {} }; sets[m[1].toLowerCase()] = cur; continue; }
  if (/^finish/.test(l)) { cur = null; continue; }
  if (!cur) continue;
  if ((m = /^\s+(S_\w+|G_\w+)\s*:\s*(.*)$/.exec(l))) cur.syms[m[1]] = val(m[2]);
  else if ((m = /^\s+(\w+)\s*:\s*(.*)$/.exec(l))) cur.other[m[1]] = m[2];
}
const { SYMBOL_BYTES, SYMSET_META } = await import(R + '/js/symset-data.js');
let bad = 0;
console.log('C sets', Object.keys(sets).join(','), '\nJS sets', Object.keys(SYMBOL_BYTES).join(','));
for (const [k, s] of Object.entries(sets)) {
  const js = SYMBOL_BYTES[k]; if (!js) { console.log('JS has no byte table for', k, '(', Object.keys(s.syms).length, 'C syms)'); continue; }
  const keys = new Set([...Object.keys(s.syms).filter(x => x.startsWith('S_')), ...Object.keys(js)]);
  for (const x of keys) if (s.syms[x] !== js[x]) { bad++; if (bad < 25) console.log('MISMATCH', k, x, 'C', s.syms[x], 'JS', js[x]); }
}
console.log('symset mismatches', bad);

console.log('RESULT symset byte tables (rogue/ibm/amiga; DEC/curses are code) mismatches=' + bad); process.exitCode = bad ? 1 : 0;
