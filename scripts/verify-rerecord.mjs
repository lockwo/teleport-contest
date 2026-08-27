#!/usr/bin/env node
// verify-rerecord.mjs — Re-record each session in sessions/ and compare
// to the canonical version, ignoring the binary build-date string in
// screen output (a known artifact of rebuilding the recorder binary).
//
// Usage: node scripts/verify-rerecord.mjs [session-glob]

import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(SCRIPT_DIR, '..');
const SESSIONS_DIR = path.join(TEMPLATE_ROOT, 'sessions');
const RECORD = path.join(SCRIPT_DIR, 'record-session.mjs');

// Strip recording-environment artifacts from screen output so
// recordings made from different machines / build clocks can compare.
//
// 1. The build-date string baked into the binary banner and the
//    extended-version (`?v`) help screen.
// 2. The HOME-path string shown by the `?g` options-help screen
//    ("Set options as OPTIONS=<options> in /home/.../.nethackrc").
//    NetHack splits the path across one line, then the contestant's
//    home dir would never match the canonical home dir, so we elide
//    the line.
const BUILD_DATE_RE = /(built|last build) [A-Z][a-z]{2}\s+\d{1,2} \d{4} \d{2}:\d{2}:\d{2}/g;
const RC_PATH_RE = /Set options as OPTIONS=<options> in\n[^\n]*\n/g;

function normalize(session) {
    const out = JSON.parse(JSON.stringify(session));
    for (const seg of out.segments || []) {
        for (const step of seg.steps || []) {
            if (typeof step.screen === 'string') {
                step.screen = step.screen
                    .replace(BUILD_DATE_RE, '$1 <DATE>')
                    .replace(RC_PATH_RE, 'Set options as OPTIONS=<options> in\n<RCPATH>\n');
            }
        }
    }
    return out;
}

function diffSummary(a, b) {
    if (a.segments.length !== b.segments.length) {
        return `segments len ${a.segments.length} vs ${b.segments.length}`;
    }
    for (let si = 0; si < a.segments.length; si++) {
        const sa = a.segments[si];
        const sb = b.segments[si];
        const la = (sa.steps || []).length;
        const lb = (sb.steps || []).length;
        if (la !== lb) return `seg ${si} steps len ${la} vs ${lb}`;
        for (let i = 0; i < la; i++) {
            const x = sa.steps[i];
            const y = sb.steps[i];
            for (const f of ['key', 'screen', 'cursor']) {
                if (JSON.stringify(x[f]) !== JSON.stringify(y[f])) {
                    return `seg ${si} step ${i} ${f}`;
                }
            }
            const xr = x.rng || [];
            const yr = y.rng || [];
            if (xr.length !== yr.length) return `seg ${si} step ${i} rng len ${xr.length} vs ${yr.length}`;
            for (let j = 0; j < xr.length; j++) {
                // Compare the CALL AND RESULT ("rn2(5)=2"), not the trailing
                // " @ callsite(file.c:LINE)" annotation.  A rebuilt recorder
                // reports the same draw at a different source line whenever the
                // patched C has shifted by a line, which is a property of OUR
                // build rather than of the recording: seed0361 re-recorded with
                // all 366 screens byte-identical and failed only on
                // "distfleeck(monmove.c:538)" vs ":548".  Treating that as a
                // mismatch made the recorder look untrustworthy and blocked
                // using it to record a private held-out corpus.
                if (rngKey(xr[j]) !== rngKey(yr[j]))
                    return `seg ${si} step ${i} rng[${j}]: ${rngKey(xr[j])} vs ${rngKey(yr[j])}`;
            }
        }
    }
    return null;
}

// The recorded RNG entry is "<call>=<result> @ <callsite>(<file>:<line>)".
// Only the call and result are semantically part of the recording; the callsite
// is a debugging annotation whose line numbers move when the recorder is
// rebuilt.  (swarm/bin/rngstep.mjs already normalises the same way.)
function rngKey(entry) { return String(entry ?? '').split(' @ ')[0]; }

async function recordOne(input, output) {
    return await new Promise((resolve, reject) => {
        const c = spawn(process.execPath, [RECORD, input, output], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        c.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
        c.on('error', reject);
        c.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`recorder exit=${code}\n${stderr}`));
        });
    });
}

async function main() {
    const argv = process.argv.slice(2);
    const filter = argv[0];
    // Verify across the public contest sessions and (when available)
    // the held-out judge sessions. Held-out lives outside the contest
    // template inside the maud monorepo.
    const HELD_OUT_DIR = path.resolve(TEMPLATE_ROOT, '..', '..', 'judge', 'sessions', 'held-out');
    const dirs = [{ label: 'public', path: SESSIONS_DIR }];
    try {
        const st = await fs.stat(HELD_OUT_DIR);
        if (st.isDirectory()) dirs.push({ label: 'held-out', path: HELD_OUT_DIR });
    } catch {}
    const all = [];
    for (const d of dirs) {
        const names = (await fs.readdir(d.path))
            .filter((n) => n.endsWith('.session.json'))
            .filter((n) => !filter || n.includes(filter))
            .sort();
        for (const name of names) all.push({ label: d.label, name, full: path.join(d.path, name) });
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-rerecord-'));
    let pass = 0;
    let fail = 0;
    const failures = [];
    try {
        for (const entry of all) {
            const input = entry.full;
            const output = path.join(tmpDir, entry.label + '-' + entry.name);
            const display = `[${entry.label}] ${entry.name}`;
            process.stdout.write(`[..] ${display} `);
            // Skip jsGroundTruth sessions — those are recorded by the
            // JS port and not by the C recorder, so the recorder under
            // test here cannot reproduce them by design.
            try {
                const meta = JSON.parse(await fs.readFile(input, 'utf8'));
                if (meta.jsGroundTruth) {
                    process.stdout.write('SKIP (jsGroundTruth)\n');
                    continue;
                }
            } catch {}
            try {
                await recordOne(input, output);
                const a = normalize(JSON.parse(await fs.readFile(input, 'utf8')));
                const b = normalize(JSON.parse(await fs.readFile(output, 'utf8')));
                const d = diffSummary(a, b);
                if (d) {
                    process.stdout.write(`FAIL: ${d}\n`);
                    fail += 1;
                    failures.push({ name: display, reason: d });
                } else {
                    process.stdout.write('OK\n');
                    pass += 1;
                }
            } catch (err) {
                process.stdout.write(`ERROR: ${err.message.split('\n')[0]}\n`);
                fail += 1;
                failures.push({ name: display, reason: err.message });
            }
        }
        console.log(`\n=== ${pass}/${pass + fail} pass ===`);
        if (failures.length) {
            console.log('Failures:');
            for (const f of failures) console.log(`  ${f.name} — ${f.reason}`);
        }
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
