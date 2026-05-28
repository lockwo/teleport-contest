#!/usr/bin/env node
// analyst-daemon.mjs — polls journal.jsonl and re-runs the analyst whenever
// the swarm has accumulated meaningful new activity since the last refresh.
// Useful for long --iterations=N runs where the auto-trigger inside
// run-loop.mjs isn't enough on its own.
//
// Strategy:
//   - On startup, snapshot the current journal size.
//   - Every POLL_INTERVAL_SEC seconds, check journal.jsonl.
//   - If at least MIN_NEW_EVENTS new lines have appeared, fire analyst.mjs.
//   - On SIGINT/SIGTERM, exit cleanly.
//
// Usage:
//   node swarm/bin/analyst-daemon.mjs                                 # default settings
//   node swarm/bin/analyst-daemon.mjs --interval=600 --min-events=5   # tune
//   node swarm/bin/analyst-daemon.mjs --provider=codex                # use codex for distillation
//
// Designed to run alongside run-loop.mjs:
//   nohup node swarm/bin/analyst-daemon.mjs > swarm/state/analyst-daemon.log 2>&1 &
//   nohup node swarm/bin/run-loop.mjs --iterations=200 > swarm/state/loop.log 2>&1 &

import { spawnSync } from 'child_process';
import { statSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { REPO_ROOT, SWARM_ROOT } from '../lib/state.mjs';
import { JOURNAL_PATH, emit } from '../lib/journal.mjs';

function parseArgs() {
    const args = process.argv.slice(2);
    const v = (k, dflt) => {
        const a = args.find(x => x.startsWith(`--${k}=`));
        return a ? a.split('=').slice(1).join('=') : dflt;
    };
    return {
        intervalSec:  parseInt(v('interval',   '300'), 10),
        minEvents:    parseInt(v('min-events', '4'),   10),
        provider:     v('provider', 'claude'),
    };
}

function countLines(path) {
    if (!existsSync(path)) return 0;
    try { return readFileSync(path, 'utf8').split('\n').length; }
    catch { return 0; }
}

function runAnalyst(provider) {
    console.log(`[analyst-daemon] firing analyst (${provider}) at ${new Date().toISOString()}`);
    emit('analyst_daemon_fire', { provider });
    const r = spawnSync('node', [
        join(SWARM_ROOT, 'bin/analyst.mjs'),
        `--provider=${provider}`,
        '--min-events=1',
    ], { cwd: REPO_ROOT, stdio: 'inherit' });
    console.log(`[analyst-daemon] analyst exited ${r.status}`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    const opts = parseArgs();
    console.log(`[analyst-daemon] starting; interval=${opts.intervalSec}s min-events=${opts.minEvents} provider=${opts.provider}`);
    let lastLines = countLines(JOURNAL_PATH);
    console.log(`[analyst-daemon] journal start: ${lastLines} lines`);

    let stopped = false;
    const stop = () => { stopped = true; console.log('[analyst-daemon] stopping'); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    while (!stopped) {
        await sleep(opts.intervalSec * 1000);
        const now = countLines(JOURNAL_PATH);
        const delta = now - lastLines;
        if (delta >= opts.minEvents) {
            console.log(`[analyst-daemon] +${delta} events since last refresh (${lastLines}→${now}) — firing analyst`);
            runAnalyst(opts.provider);
            lastLines = now;
        } else {
            console.log(`[analyst-daemon] +${delta} events — below threshold ${opts.minEvents}, sleeping`);
        }
    }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
