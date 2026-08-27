// Diagnostic: diff THIS checkout's per-step PRNG call stream against the
// recorded C stream for one session step.  The recorded stream carries the C
// callsite for every draw, so the first mismatching index names the exact C
// function we are getting wrong.  Repo root = cwd (works inside a worktree).
//
// Usage: node scripts/rngdiff.mjs <session.json> <step> [context] [--from N]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.env.REPO_ROOT || process.cwd();
const { normalizeSession } = await import(join(ROOT, 'frozen/session_loader.mjs'));
const { runSegment } = await import(join(ROOT, 'js/jsmain.js'));

const sessionName = process.argv[2];
const step = +process.argv[3];
const ctx = process.argv[4] != null && !String(process.argv[4]).startsWith('--')
    ? +process.argv[4] : 25;
const fromArg = process.argv.find(a => String(a).startsWith('--from='));
const from = fromArg ? +fromArg.split('=')[1] : 0;

const sessionData = JSON.parse(readFileSync(join(ROOT, 'sessions', sessionName), 'utf8'));
const segments = normalizeSession(sessionData).segments;

const cSlices = [];
for (const seg of segments) for (const s of seg.steps || []) cSlices.push(s.rng || []);

const storage = new Map();
const sh = {
    getItem: k => storage.has(k) ? storage.get(k) : null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
    get length() { return storage.size; },
    key(i) { let n = 0; for (const k of storage.keys()) { if (n === i) return k; n++; } return null; },
};
const jsSlices = [];
for (const seg of segments) {
    const g = await runSegment({ seed: seg.seed, datetime: seg.datetime,
                                 nethackrc: seg.nethackrc, moves: seg.moves, storage: sh });
    jsSlices.push(...(g.getRngSlices?.() || []));
}

const c = cSlices[step] || [], j = jsSlices[step] || [];
// The recorded entries are "rn2(3)=2 @ <callsite>"; ours are bare "rn2(3)=2".
const bare = (s) => String(s).split(' @ ')[0];
const site = (s) => { const i = String(s).indexOf(' @ '); return i < 0 ? '' : String(s).slice(i + 3); };

let first = -1;
for (let i = from; i < Math.max(c.length, j.length); i++) {
    if (bare(c[i] ?? '<none>') !== bare(j[i] ?? '<none>')) { first = i; break; }
}
console.log(`session=${sessionName} step=${step}`);
console.log(`C draws=${c.length}  JS draws=${j.length}  first mismatch idx=${first}`
            + (first < 0 ? '  (streams agree over the compared prefix)' : ''));
if (first < 0) process.exit(0);

const lo = Math.max(from, first - ctx), hi = Math.min(Math.max(c.length, j.length), first + ctx);
console.log(`\n idx | C draw            | C callsite                          | JS draw`);
for (let i = lo; i < hi; i++) {
    const mark = i === first ? '>>' : '  ';
    console.log(`${mark}${String(i).padStart(5)} | ${bare(c[i] ?? '-').padEnd(17)} | `
                + `${site(c[i] ?? '').slice(0, 35).padEnd(35)} | ${bare(j[i] ?? '-')}`);
}
