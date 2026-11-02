import { readFileSync, readdirSync } from 'fs';
const R = process.env.REPO_ROOT || process.cwd();
// numeric top-level consts from all js files (name -> value); first definition wins, own-file wins
const poolCache = {};
function numericConsts(file) {
  if (poolCache[file]) return poolCache[file];
  const m = {}; const s = readFileSync(file, 'utf8');
  for (const mm of s.matchAll(/^(?:export )?const ([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(-?(?:0x[0-9a-fA-F]+|\d+))\s*;/gm)) m[mm[1]] = Number(mm[2]);
  for (const mm of s.matchAll(/^(?:export )?const ([A-Za-z_][A-Za-z_0-9]*)\s*=\s*'([^'\n]*)'\s*;/gm)) m[mm[1]] = mm[2];
  // comma-separated: const A = 1, B = 2, ...
  for (const mm of s.matchAll(/^(?:export )?const ((?:[A-Za-z_][A-Za-z_0-9]*\s*=\s*-?(?:0x[0-9a-fA-F]+|\d+)\s*,\s*)+[A-Za-z_][A-Za-z_0-9]*\s*=\s*-?(?:0x[0-9a-fA-F]+|\d+))\s*;/gm))
    for (const p of mm[1].split(',')) { const [k, v] = p.split('='); m[k.trim()] = Number(v.trim()); }
  return (poolCache[file] = m);
}
let global_pool = null;
function pool() {
  if (global_pool) return global_pool; global_pool = {};
  for (const f of readdirSync(R + '/js').filter(f => f.endsWith('.js')).sort((a, b) => (a === 'const.js' ? -1 : b === 'const.js' ? 1 : 0)))
    for (const [k, v] of Object.entries(numericConsts(R + '/js/' + f))) if (!(k in global_pool)) global_pool[k] = v;
  return global_pool;
}
export function grab(file, name) {
  const s = readFileSync(file, 'utf8');
  const re = new RegExp('(?:^|\\n)(?:export )?(?:const|let) ' + name + '\\s*=\\s*');
  const m = re.exec(s); if (!m) throw new Error('no ' + name + ' in ' + file);
  let i = m.index + m[0].length, depth = 0, inS = null, j = i;
  for (; j < s.length; j++) {
    const ch = s[j];
    if (inS) { if (ch === '\\') j++; else if (ch === inS) inS = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inS = ch; continue; }
    if (ch === '/' && s[j + 1] === '/') { while (s[j] !== '\n') j++; continue; }
    if (ch === '/' && s[j + 1] === '*') { j = s.indexOf('*/', j) + 1; continue; }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ';' && depth === 0) break;
  }
  const own = numericConsts(file), gp = pool();
  const env = new Proxy({}, {
    has: (t, k) => typeof k === 'string' && (k in own || k in gp || /^[A-Z][A-Z0-9_]*$/.test(k)) ,
    get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in own) return own[k]; if (k in gp) return gp[k]; throw new Error('grab: unresolved ' + String(k) + ' in ' + name); },
  });
  return new Function('env', 'with (env) { return (' + s.slice(i, j) + '); }')(env);
}
