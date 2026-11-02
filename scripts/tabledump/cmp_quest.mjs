import { readFileSync } from 'fs';
import { grab } from './grab.mjs';
const REC = process.env.RECORDER || (process.env.REPO_ROOT || process.cwd()) + '/nethack-c/recorder';
const R = process.env.REPO_ROOT || process.cwd();
let lua = readFileSync(REC + '/dat/quest.lua', 'utf8');
lua = lua.replace(/^--[^\n]*/gm, '');
const lines = new Map();
const add = (m, s) => { for (const l of s.split('\n')) { const t = l.replace(/\s+$/, ''); if (t.trim()) m.set(t, (m.get(t) || 0) + 1); } };
// long brackets
let rest = lua;
for (const m of lua.matchAll(/\[\[([\s\S]*?)\]\]/g)) add(lines, m[1]);
rest = lua.replace(/\[\[[\s\S]*?\]\]/g, '');
for (const m of rest.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) add(lines, m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\'));
const jl = new Map();
const QT = grab(R + '/js/questpgr.js', 'QUEST_TEXT');
const walk = (x) => { if (typeof x === 'string') add(jl, x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') Object.values(x).forEach(walk); };
walk(QT);
let onlyC = [], onlyJ = [];
for (const k of lines.keys()) if (!jl.has(k)) onlyC.push(k);
for (const k of jl.keys()) if (!lines.has(k)) onlyJ.push(k);
console.log('lua distinct lines', lines.size, 'JS distinct lines', jl.size, 'only in lua', onlyC.length, 'only in JS', onlyJ.length);
onlyC.slice(0, 15).forEach(l => console.log(' C only:', JSON.stringify(l.slice(0, 90))));
onlyJ.slice(0, 15).forEach(l => console.log(' JS only:', JSON.stringify(l.slice(0, 90))));
const syn = (await import(R + '/js/quest_synopsis_data.js')).QUEST_SYNOPSIS; walk(syn);
const still = []; for (const k of lines.keys()) if (!jl.has(k)) still.push(k);
console.log('after adding synopsis: only in lua', still.length);
still.slice(0, 40).forEach(l => console.log(' C only:', JSON.stringify(l.slice(0, 110))));
try { walk(grab(R + '/js/questpgr.js', 'LEGACY_TEXT')); walk(grab(R + '/js/questpgr.js', 'LEGACY_PAUPER_TAIL')); } catch (e) { console.log('no LEGACY_TEXT', e.message); }
const s3 = []; for (const k of lines.keys()) if (!jl.has(k)) s3.push(k);
console.log('after LEGACY_TEXT: only in lua', s3.length);
s3.filter(l => !/return/.test(l)).slice(0, 20).forEach(l => console.log(' C only:', JSON.stringify(l.slice(0, 110))));

const realq = s3.filter(l => !/return|^(goal_next|text|menu|pline)$/.test(l));
console.log('RESULT quest.lua text lines mismatches=' + realq.length); process.exitCode = realq.length ? 1 : 0;
