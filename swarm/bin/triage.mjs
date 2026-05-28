#!/usr/bin/env node
// triage.mjs — first-divergence analyzer for a single session.
//
// Loads the recorded session, runs our runSegment, finds the first
// divergent PRNG call (or first divergent screen if PRNG fully matches),
// extracts the C caller annotation, and emits a porter-ready task.
//
// Usage:
//   node swarm/bin/triage.mjs sessions/seed8000-tourist-starter.session.json
//   node swarm/bin/triage.mjs --all                # triage every public session
//   node swarm/bin/triage.mjs <path> --json        # machine-readable output

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { REPO_ROOT } from '../lib/state.mjs';

const PROJECT_ROOT = REPO_ROOT;

// Reuse the runner's normalization so triage agrees with the scorer.
function isRngCall(e) {
    return typeof e === 'string' && /^(?:rn2|rnd|rn1|rnl|rne|rnz|d)\(/.test(e);
}
function stripCaller(e) {
    return e.replace(/\s*@\s.*$/, '').replace(/^\d+\s+/, '').trim();
}
function extractCaller(e) {
    // "rn2(2)=0 @ randomize_gem_colors(o_init.c:89)" → {fn,file,line}
    const m = e.match(/@\s+([A-Za-z_][\w]*)\(([^:]+):(\d+)\)/);
    if (!m) return null;
    return { fn: m[1], file: m[2], line: Number(m[3]) };
}

async function runOneSession(sessionPath) {
    const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
    const { normalizeSession } = await import(join(PROJECT_ROOT, 'frozen/session_loader.mjs'));
    const { runSegment } = await import(join(PROJECT_ROOT, 'js/jsmain.js'));

    const { segments } = normalizeSession(session);

    // C-side flat RNG (with caller annotations preserved for triage) and
    // screens, indexed across all segments — same flattening as scorer.
    const cRngFull = [];
    const cScreens = [];
    for (const seg of segments) {
        for (const step of seg.steps || []) {
            for (const e of step.rng || []) if (isRngCall(e)) cRngFull.push(e);
            if (step.screen != null) cScreens.push(step.screen);
        }
    }

    // Shared storage Map (matches scorer; harmless for single-segment).
    const storage = new Map();
    const storageHandle = {
        getItem(k) { return storage.has(k) ? storage.get(k) : null; },
        setItem(k, v) { storage.set(k, String(v)); },
        removeItem(k) { storage.delete(k); },
        get length() { return storage.size; },
        key(i) { let n = 0; for (const k of storage.keys()) { if (n === i) return k; n++; } return null; },
    };

    let jsRng = [];
    let jsScreens = [];
    let jsError = null;
    try {
        for (const seg of segments) {
            const input = {
                seed: seg.seed,
                datetime: seg.datetime,
                nethackrc: seg.nethackrc,
                moves: seg.moves,
                storage: storageHandle,
            };
            const g = await runSegment(input);
            const segRng = (g.getRngLog?.() || [])
                .map(e => typeof e === 'string' ? e.replace(/^\d+\s+/, '') : String(e))
                .filter(isRngCall);
            jsRng.push(...segRng);
            jsScreens.push(...(g.getScreens?.() || []));
        }
    } catch (e) {
        jsError = e.message + '\n' + (e.stack || '');
    }

    return { cRngFull, cScreens, jsRng, jsScreens, jsError, segments };
}

function findFirstRngDivergence(cRngFull, jsRng) {
    const n = Math.max(cRngFull.length, jsRng.length);
    for (let i = 0; i < n; i++) {
        const c = stripCaller(cRngFull[i] || '');
        const j = stripCaller(jsRng[i] || '');
        if (c !== j) {
            return {
                index: i,
                cEntry: cRngFull[i] || null,
                jsEntry: jsRng[i] || null,
                caller: extractCaller(cRngFull[i] || ''),
                contextC: cRngFull.slice(Math.max(0, i - 3), i + 3),
                contextJs: jsRng.slice(Math.max(0, i - 3), i + 3),
            };
        }
    }
    return null;
}

function findFirstScreenDivergence(cScreens, jsScreens) {
    const n = Math.max(cScreens.length, jsScreens.length);
    for (let i = 0; i < n; i++) {
        if ((cScreens[i] || '') !== (jsScreens[i] || '')) {
            return { index: i, cScreen: cScreens[i] || null, jsScreen: jsScreens[i] || null };
        }
    }
    return null;
}

async function triageSession(sessionPath) {
    const name = basename(sessionPath);
    const { cRngFull, cScreens, jsRng, jsScreens, jsError } = await runOneSession(sessionPath);

    const rngDiv = findFirstRngDivergence(cRngFull, jsRng);
    const screenDiv = rngDiv ? null : findFirstScreenDivergence(cScreens, jsScreens);

    let summary;
    if (jsError) summary = `runtime error: ${jsError.split('\n')[0]}`;
    else if (rngDiv) {
        const cl = rngDiv.caller;
        const where = cl ? `${cl.fn} (${cl.file}:${cl.line})` : 'unknown caller';
        summary = `RNG diverges at call ${rngDiv.index}: C=${rngDiv.cEntry} vs JS=${rngDiv.jsEntry} — ${where}`;
    } else if (screenDiv) summary = `RNG fully matches; first screen divergence at step ${screenDiv.index}`;
    else summary = `session fully matches (RNG ${jsRng.length}/${cRngFull.length}, screens ${jsScreens.length}/${cScreens.length})`;

    return {
        session: name,
        cRngTotal: cRngFull.length,
        jsRngTotal: jsRng.length,
        cScreenTotal: cScreens.length,
        jsScreenTotal: jsScreens.length,
        rngDivergence: rngDiv,
        screenDivergence: screenDiv,
        jsError,
        summary,
    };
}

async function main() {
    const args = process.argv.slice(2);
    const json = args.includes('--json');
    const targets = args.filter(a => !a.startsWith('--'));
    const all = args.includes('--all');

    let files;
    if (all || targets.length === 0) {
        const dir = join(PROJECT_ROOT, 'sessions');
        files = readdirSync(dir).filter(f => f.endsWith('.session.json')).sort().map(f => join(dir, f));
    } else {
        files = targets.map(t => t.startsWith('/') ? t : join(PROJECT_ROOT, t));
        for (const f of files) if (!existsSync(f)) throw new Error(`not found: ${f}`);
    }

    const results = [];
    for (const f of files) {
        const r = await triageSession(f);
        results.push(r);
        if (!json) {
            console.log(`${r.session}: ${r.summary}`);
            if (r.rngDivergence) {
                console.log(`  C  context: ${r.rngDivergence.contextC.join(' | ')}`);
                console.log(`  JS context: ${r.rngDivergence.contextJs.join(' | ')}`);
            }
        }
    }
    if (json) console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
