import { readFileSync } from 'fs';
import { grab } from './grab.mjs';
const REC = process.env.RECORDER || (process.env.REPO_ROOT || process.cwd()) + '/nethack-c/recorder';
const R = process.env.REPO_ROOT || process.cwd();
const lua = readFileSync(REC + '/dat/dungeon.lua', 'utf8')
  .replace(/--[^\n]*/g, '');
// lua table -> JS literal
const js = lua.replace(/^\s*dungeon\s*=\s*/, '').replace(/([A-Za-z_]+)\s*=\s*/g, '$1: ').replace(/,\s*([}\]])/g, '$1');
const conv = (src) => { let out = '', st = []; for (let i = 0; i < src.length; i++) { const ch = src[i];
  if (ch === '"') { let j = i + 1; while (src[j] !== '"') { if (src[j] === '\\') j++; j++; } out += src.slice(i, j + 1); i = j; continue; }
  if (ch === '{') { let k = i + 1; while (/\s/.test(src[k])) k++; const arr = src[k] === '{' || src[k] === '"'; st.push(arr); out += arr ? '[' : '{'; continue; }
  if (ch === '}') { out += st.pop() ? ']' : '}'; continue; } out += ch; } return out; };
const C = (0, eval)('(' + conv(js.trim()).replace(/,(\s*[}\]])/g, '$1') + ')');
const J = grab(R + '/js/dungeon.js', 'DUNGEON_FILE');
const strip = (o) => JSON.parse(JSON.stringify(o));
const a = strip(C), b = strip(J);
console.log('C dungeons', a.length, 'JS', b.length);
const diffs = [];
const walk = (x, y, path) => {
  if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) { if (x !== y) diffs.push(`${path}: C=${JSON.stringify(x)} JS=${JSON.stringify(y)}`); return; }
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) walk(x[k], y[k], path + '.' + k);
};
walk(a, b, '');
console.log('dungeon.lua vs DUNGEON_FILE diffs', diffs.length); diffs.slice(0, 40).forEach(d => console.log(' ', d));

console.log('RESULT dungeon.lua mismatches=' + (diffs.length)); process.exitCode = (diffs.length) ? 1 : 0;
