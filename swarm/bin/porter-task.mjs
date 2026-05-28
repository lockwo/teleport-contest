#!/usr/bin/env node
// porter-task.mjs — CLI wrapper. Given a session, triages it and emits a
// porter task spec (JSON or rendered markdown prompt).
//
// Usage:
//   node swarm/bin/porter-task.mjs sessions/seed8000-tourist-starter.session.json
//   node swarm/bin/porter-task.mjs <path> --json
//
// Pipes cleanly into Agent calls: the JSON form is what the orchestrator
// hands to each parallel porter; the markdown form is human-readable.

import { join, basename } from 'path';
import { existsSync, readFileSync } from 'fs';
import { REPO_ROOT } from '../lib/state.mjs';
import { buildPorterTask, renderPorterPrompt } from '../lib/porter-task.mjs';

async function triageOne(sessionPath) {
    // Import triage logic in-process by re-using the helpers via triage.mjs.
    // Simplest: shell out to triage.mjs --json so we re-use exactly the
    // analysis the orchestrator's triager uses, no duplication.
    const { spawnSync } = await import('child_process');
    const child = spawnSync('node', ['swarm/bin/triage.mjs', sessionPath, '--json'], {
        cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (child.status !== 0) throw new Error(`triage failed: ${child.stderr}`);
    // triage.mjs outputs `[{...}]`. Take first.
    const arr = JSON.parse(child.stdout);
    return arr[0];
}

async function main() {
    const args = process.argv.slice(2);
    const json = args.includes('--json');
    const target = args.find(a => !a.startsWith('--'));
    if (!target) {
        console.error('usage: porter-task.mjs <session.json> [--json]');
        process.exit(1);
    }
    const path = target.startsWith('/') ? target : join(REPO_ROOT, target);
    if (!existsSync(path)) { console.error(`not found: ${target}`); process.exit(1); }
    const triage = await triageOne(path);
    const task = buildPorterTask(triage);
    if (json) console.log(JSON.stringify(task, null, 2));
    else console.log(renderPorterPrompt(task));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
