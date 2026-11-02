import { readFileSync } from 'fs';
// the C dumper emits trailing commas; strip those outside strings
export function loadC(p = '/tmp/ctables.json') {
  const s = readFileSync(p, 'utf8'); let out = '', inS = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inS) { out += c; if (c === '\\') out += s[++i]; else if (c === '"') inS = false; continue; }
    if (c === '"') { inS = true; out += c; continue; }
    if ((c === ']' || c === '}')) { out = out.replace(/,(\s*)$/, '$1'); }
    out += c;
  }
  return JSON.parse(out);
}
