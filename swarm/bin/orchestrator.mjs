#!/usr/bin/env node
// orchestrator.mjs — the swarm's outer loop, as CLI subcommands.
//
// Subcommands:
//   pick                 — emit next porter task as markdown (and update state)
//   pick --json          — emit next porter task as machine-readable JSON
//   verify <worktree>    — score a worktree, report ACCEPT/REJECT
//   merge <worktree>     — verify and, if ACCEPT, fast-forward changes to main
//   status               — print swarm state (open tasks, last run, deltas)
//
// Drive the loop in-conversation (via Agent tool) or via headless `claude -p`:
//
//   1. `node swarm/bin/orchestrator.mjs pick --json`
//      → porter task spec
//   2. Spawn N porter agents in isolated worktrees with that task.
//   3. `node swarm/bin/orchestrator.mjs merge <best-worktree>`
//      → ACCEPT/REJECT, commits on ACCEPT.
//   4. Repeat.

import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { REPO_ROOT, SWARM_ROOT, load } from '../lib/state.mjs';

const LATEST = join(SWARM_ROOT, 'state/latest.json');
const BASELINE = join(SWARM_ROOT, 'state/baseline.json');

function delegate(args) {
    const child = spawnSync('node', args, { cwd: REPO_ROOT, stdio: 'inherit' });
    process.exit(child.status || 0);
}

function status() {
    const state = load();
    const latest = existsSync(LATEST) ? JSON.parse(readFileSync(LATEST, 'utf8')) : null;
    const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;

    const sum = (b) => {
        if (!b) return null;
        const m = b.results.reduce((a, r) => a + r.metrics.screens.matched, 0);
        const t = b.results.reduce((a, r) => a + r.metrics.screens.total, 0);
        const rm = b.results.reduce((a, r) => a + r.metrics.rngCalls.matched, 0);
        const rt = b.results.reduce((a, r) => a + r.metrics.rngCalls.total, 0);
        const p = b.results.filter(r => r.passed).length;
        return { commit: b.commit, screens: `${m}/${t}`, rng: `${rm}/${rt}`, passing: `${p}/${b.results.length}` };
    };

    const lat = sum(latest), bas = sum(baseline);
    console.log('# Swarm state\n');
    if (bas) console.log(`baseline  @ ${bas.commit}: screens ${bas.screens}, rng ${bas.rng}, passing ${bas.passing}`);
    if (lat) console.log(`latest    @ ${lat.commit}: screens ${lat.screens}, rng ${lat.rng}, passing ${lat.passing}`);

    const tasks = Object.values(state.tasks || {});
    const open = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
    const done = tasks.filter(t => t.status === 'completed');
    console.log(`\ntasks: ${tasks.length} total, ${open.length} open, ${done.length} completed`);
    for (const t of open.slice(0, 10)) {
        console.log(`  [${t.id}] ${t.kind || '?'} ${t.target_c || ''} → ${t.target_js || ''} (${t.status})`);
    }
    console.log(`\nruns recorded: ${(state.runs || []).length}`);
    const r = (state.runs || []).slice(-3);
    for (const rr of r) console.log(`  ${rr.timestamp}  ${rr.commit}  screens ${rr.screensMatched}/${rr.screensTotal}  rng ${rr.rngMatched}/${rr.rngTotal}  pass ${rr.sessionsPassing}`);
}

function main() {
    const [cmd, ...rest] = process.argv.slice(2);
    switch (cmd) {
        case 'pick':
            delegate([join(SWARM_ROOT, 'bin/pick-target.mjs'), ...rest]);
            break;
        case 'verify':
        case 'merge': {
            const args = [join(SWARM_ROOT, 'bin/verify-and-merge.mjs'), ...rest];
            if (cmd === 'merge' && !rest.includes('--commit')) args.push('--commit');
            delegate(args);
            break;
        }
        case 'triage':
            delegate([join(SWARM_ROOT, 'bin/triage.mjs'), ...rest]);
            break;
        case 'baseline':
            delegate([join(SWARM_ROOT, 'bin/baseline.mjs'), ...rest]);
            break;
        case 'manifest':
            delegate([join(SWARM_ROOT, 'bin/manifest.mjs'), ...rest]);
            break;
        case 'learn':
            delegate([join(SWARM_ROOT, 'bin/learn.mjs'), ...rest]);
            break;
        case 'status':
        case undefined:
            status();
            break;
        default:
            console.error(`unknown subcommand: ${cmd}`);
            console.error(`subcommands: pick | verify <wt> | merge <wt> | triage | baseline | manifest | status`);
            process.exit(1);
    }
}

main();
