#!/usr/bin/env node
// pick-target.mjs — selects the next session to attack and emits a porter
// task for it. Strategy: "closest to fully passing first", i.e. minimise
// the size of the unmatched-screens gap. This concentrates effort where
// one fix unlocks the most points per unit of work.
//
// Tiebreaker: smaller session (fewer RNG calls) first — shorter feedback
// loop for the porter.
//
// Usage:
//   node swarm/bin/pick-target.mjs                # next target as markdown
//   node swarm/bin/pick-target.mjs --json         # JSON for orchestrator
//   node swarm/bin/pick-target.mjs --top=5        # show top 5 candidates

import { join, basename } from 'path';
import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { REPO_ROOT, SWARM_ROOT } from '../lib/state.mjs';
import { buildPorterTask, renderPorterPrompt } from '../lib/porter-task.mjs';

const LATEST = join(SWARM_ROOT, 'state/latest.json');

function loadLatest() {
    if (!existsSync(LATEST)) throw new Error('no swarm/state/latest.json — run swarm/bin/baseline.mjs first');
    return JSON.parse(readFileSync(LATEST, 'utf8'));
}

// "Score gap" = matched / total, smaller is further from passing.
// We rank by: (1) score gap (higher is more promising), tiebreak by
// (2) total RNG calls (smaller = faster porter iteration).
function rankCandidates(bundle) {
    return bundle.results
        .filter(r => !r.passed)
        .map(r => ({
            session: r.session,
            screenMatched: r.metrics.screens.matched,
            screenTotal: r.metrics.screens.total,
            rngMatched: r.metrics.rngCalls.matched,
            rngTotal: r.metrics.rngCalls.total,
            screenFrac: r.metrics.screens.matched / Math.max(1, r.metrics.screens.total),
            rngFrac: r.metrics.rngCalls.matched / Math.max(1, r.metrics.rngCalls.total),
            error: r.error,
        }))
        .sort((a, b) => {
            // Prefer sessions where we already match a lot of RNG (close
            // to unlocking screens) and have small RNG totals.
            const fa = a.rngFrac, fb = b.rngFrac;
            if (Math.abs(fa - fb) > 0.01) return fb - fa;
            return a.rngTotal - b.rngTotal;
        });
}

function triageJSON(sessionPath) {
    const child = spawnSync('node', ['swarm/bin/triage.mjs', sessionPath, '--json'], {
        cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (child.status !== 0) throw new Error(`triage failed for ${sessionPath}: ${child.stderr}`);
    return JSON.parse(child.stdout)[0];
}

async function main() {
    const args = process.argv.slice(2);
    const json = args.includes('--json');
    const topArg = args.find(a => a.startsWith('--top='));
    const top = topArg ? parseInt(topArg.split('=')[1], 10) : 1;

    const bundle = loadLatest();
    const ranked = rankCandidates(bundle);

    if (ranked.length === 0) {
        console.log('All sessions passing!');
        return;
    }

    const picks = ranked.slice(0, top);
    const tasks = [];
    for (const p of picks) {
        const sessionPath = join(REPO_ROOT, 'sessions', p.session);
        const triage = triageJSON(sessionPath);
        const task = buildPorterTask(triage);
        task._candidate_rank = {
            screenMatched: p.screenMatched,
            screenTotal: p.screenTotal,
            rngFrac: p.rngFrac,
            rngTotal: p.rngTotal,
        };
        tasks.push(task);
    }

    if (json) { console.log(JSON.stringify(tasks, null, 2)); return; }

    console.log(`Top ${top} candidate(s) by "closest to passing":\n`);
    for (const p of picks) {
        console.log(`  ${p.session}`);
        console.log(`    RNG: ${p.rngMatched}/${p.rngTotal} (${(100 * p.rngFrac).toFixed(2)}%)`);
        console.log(`    Screens: ${p.screenMatched}/${p.screenTotal}`);
        console.log('');
    }
    console.log('— Next task —\n');
    console.log(renderPorterPrompt(tasks[0]));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
