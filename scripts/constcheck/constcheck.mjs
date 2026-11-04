#!/usr/bin/env node
// constcheck.mjs: every module-level UPPER_CASE numeric constant in js/ is asserted against the real C value by
// the C compiler (_Static_assert against nethack-c/recorder/include, the recorder build's headers).
//   node scripts/constcheck/constcheck.mjs [--keep]   (needs clang and acorn)
// Two asserts per constant: NAME == <JS value>, and (when the JS initializer names other constants)
// NAME == <JS initializer text compiled as C>, which checks bit-flag combinations.
// Names that are not C identifiers fail with "undeclared identifier" and are counted as skipped.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
let acorn;
for (const p of ['acorn', '/Users/owenlockwood/Documents/aidangervc/node_modules/acorn/dist/acorn.js',
  '/Users/owenlockwood/Documents/aidangervc/node_modules/acorn/dist/acorn.js']) {
  try { acorn = createRequire(import.meta.url)(p); break; } catch {}
}
const R = process.env.REPO_ROOT || process.cwd();
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : /\.js$/.test(e.name) ? [join(d, e.name)] : []);
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const lines = [`#include "hack.h"`];
const meta = [];
const globalEnv = new Map();
const files = walk(join(R, 'js')).filter((f) => !/_data\.js$/.test(f));
// pass 1: collect pure constant expressions
const items = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true }); } catch { continue; }
  const env = new Map();
  const ok = (n) => {
    switch (n.type) {
      case 'Literal': return typeof n.value === 'number';
      case 'Identifier': return NAME.test(n.name);
      case 'UnaryExpression': return '-~+'.includes(n.operator) && ok(n.argument);
      case 'BinaryExpression': return ['|', '&', '^', '<<', '>>', '+', '-', '*'].includes(n.operator) && ok(n.left) && ok(n.right);
      case 'ParenthesizedExpression': return ok(n.expression);
      default: return false;
    }
  };
  const ev = (n) => {
    switch (n.type) {
      case 'Literal': return n.value;
      case 'Identifier': return env.has(n.name) ? env.get(n.name) : globalEnv.get(n.name);
      case 'UnaryExpression': { const a = ev(n.argument); return a === undefined ? undefined : n.operator === '-' ? -a : n.operator === '~' ? ~a : +a; }
      case 'BinaryExpression': {
        const a = ev(n.left), b = ev(n.right); if (a === undefined || b === undefined) return undefined;
        return { '|': a | b, '&': a & b, '^': a ^ b, '<<': a << b, '>>': a >> b, '+': a + b, '-': a - b, '*': a * b }[n.operator];
      }
      default: return undefined;
    }
  };
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && NAME.test(n.id.name) && n.init && ok(n.init)) {
      const d = n, v = ev(d.init);
      if (v !== undefined) { env.set(d.id.name, v); if (!globalEnv.has(d.id.name)) globalEnv.set(d.id.name, v); }
      items.push({ f: f.slice(R.length + 1), line: d.loc.start.line, name: d.id.name, v,
        text: src.slice(d.init.start, d.init.end), complex: d.init.type !== 'Literal' && !(d.init.type === 'UnaryExpression' && d.init.argument.type === 'Literal') });
    }
    for (const k in n) {
      const c = n[k];
      if (Array.isArray(c)) c.forEach(visit); else if (c && typeof c.type === 'string') visit(c);
    }
  };
  visit(ast);
}
const seen = new Set();
for (const it of items) {
  const emit = (kind, rhs) => { meta.push({ ...it, kind }); lines.push(`_Static_assert((long)(${it.name}) == (long)(${rhs}), "${meta.length - 1}");`); };
  if (it.v !== undefined && Number.isFinite(it.v) && !seen.has(it.f + it.name + it.v)) { seen.add(it.f + it.name + it.v); emit('value', it.v); }
  if (it.complex && /[A-Z]/.test(it.text)) emit('expr', it.text.replace(/\n/g, ' '));
}
const cfile = '/tmp/constcheck.c';
writeFileSync(cfile, lines.join('\n') + '\n');
const r = spawnSync('nice', ['-n', '15', 'clang', '-fsyntax-only', '-ferror-limit=0', '-fno-spell-checking', '-w', '-DNOTPARMDECL', `-I${join(R, 'nethack-c/recorder/include')}`, cfile], { encoding: 'utf8', maxBuffer: 1 << 28 });
const out = (r.stderr || '').split('\n');
let bad = 0, undecl = new Set();
for (let i = 0; i < out.length; i++) {
  const m = out[i].match(/constcheck\.c:(\d+):\d+: error: (.*)/);
  if (!m) continue;
  const m2 = lines[+m[1] - 2] ?? '';
  const idx = +((lines[+m[1] - 1] || '').match(/"(\d+)"\);$/) || [])[1];
  const it = meta[idx]; if (!it) continue;
  if (/undeclared identifier|use of undeclared/.test(m[2])) { undecl.add(it.name); continue; }
  if (/static assertion failed/.test(m[2])) {
    const ev = (out.slice(i + 1, i + 8).find((l) => /expression evaluates/.test(l)) || '').replace(/.*evaluates to /, '');
    console.log(`MISMATCH ${it.f}:${it.line} ${it.name} (${it.kind}) js=${it.kind === 'value' ? it.v : it.text}  clang: ${ev || m[2]}`); bad++;
  } else if (!/expected|note/.test(m[2])) console.log('ERR', it.f + ':' + it.line, it.name, m[2]);
}
// pass 2: names that are not C identifiers but are C names with a JS decoration (_OTYP, _PM, _CLS, P_ for otyps).
const alias = (n) => [n.replace(/_(OTYP|PM|CLS|CLASS_)$/, ''), n.replace(/^P_/, '')].filter((a) => a !== n);
const l2 = [`#include "hack.h"`], m2 = [];
for (const it of items) {
  if (!undecl.has(it.name) || it.v === undefined || !Number.isFinite(it.v)) continue;
  for (const a of alias(it.name)) { m2.push({ it, a }); l2.push(`_Static_assert((long)(${a}) == (long)(${it.v}), "${m2.length - 1}");`); }
}
writeFileSync('/tmp/constcheck2.c', l2.join('\n') + '\n');
const r2 = spawnSync('nice', ['-n', '15', 'clang', '-fsyntax-only', '-ferror-limit=0', '-fno-spell-checking', '-w', '-DNOTPARMDECL', `-I${join(R, 'nethack-c/recorder/include')}`, '/tmp/constcheck2.c'], { encoding: 'utf8', maxBuffer: 1 << 28 });
const o2 = (r2.stderr || '').split('\n');
for (let i = 0; i < o2.length; i++) {
  const m = o2[i].match(/constcheck2\.c:(\d+):\d+: error: static assertion failed/);
  if (!m) continue;
  const x = m2[+((l2[+m[1] - 1].match(/"(\d+)"\);$/) || [])[1])]; if (!x) continue;
  const ev = (o2.slice(i + 1, i + 8).find((l) => /expression evaluates/.test(l)) || '').replace(/.*evaluates to /, '');
  console.log(`ALIAS-MISMATCH ${x.it.f}:${x.it.line} ${x.it.name} ~ C ${x.a}  clang: ${ev}`); bad++;
}
console.log(`${items.length} constants, ${meta.length} asserts, ${undecl.size} names not in C, ${bad} mismatches`);
