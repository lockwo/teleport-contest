#!/usr/bin/env node
// run-loop.mjs — the autonomous porter loop.
//
// One iteration =
//   1. pick-target → porter task
//   2. spawn N porters in parallel worktrees (mix providers)
//   3. wait for all to return
//   4. verify each worktree; pick the best ACCEPT (or skip if none)
//   5. merge winner onto main
//   6. push to origin (unless --no-push)
//   7. delete losing worktrees
//
// Usage:
//   node swarm/bin/run-loop.mjs                                 # default: 2 porters (1 claude, 1 codex), 1 iteration
//   node swarm/bin/run-loop.mjs --iterations=5
//   node swarm/bin/run-loop.mjs --providers=claude,claude,codex
//   node swarm/bin/run-loop.mjs --no-push                       # local-only run
//   node swarm/bin/run-loop.mjs --target=sessions/<name>        # force a specific target

import { spawn, execSync, spawnSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { REPO_ROOT, SWARM_ROOT } from '../lib/state.mjs';
import { emit } from '../lib/journal.mjs';

const WORKTREES_DIR = join(SWARM_ROOT, 'worktrees');
const RUNS_DIR      = join(SWARM_ROOT, 'state/porter-runs');
const LATEST        = join(SWARM_ROOT, 'state/latest.json');

function sh(cmd, opts = {}) {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', ...opts }).trim();
}
function shOk(cmd, opts = {}) {
    try { return sh(cmd, opts); } catch (_) { return null; }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const v = (k, dflt) => {
        const a = args.find(x => x.startsWith(`--${k}=`));
        return a ? a.split('=').slice(1).join('=') : dflt;
    };
    return {
        iterations: parseInt(v('iterations', '1'), 10),
        providers:  v('providers', 'claude,codex').split(',').map(s => s.trim()).filter(Boolean),
        push:       !args.includes('--no-push'),
        target:     v('target', null),
        promoteBaseline: args.includes('--promote-baseline'),
        analystEvery: parseInt(v('analyst-every', '5'), 10),
        analystProvider: v('analyst-provider', 'claude'),
        noAnalyst: args.includes('--no-analyst'),
    };
}

function pickTask(forcedTargetPath) {
    if (forcedTargetPath) {
        const out = sh(`node swarm/bin/porter-task.mjs ${forcedTargetPath} --json`);
        return JSON.parse(out);
    }
    const out = sh('node swarm/bin/pick-target.mjs --json');
    const arr = JSON.parse(out);
    return arr[0];
}

function spawnPorter(provider, label, taskJSON) {
    const taskFile = join(SWARM_ROOT, `state/porter-runs/.task-${label}-${Date.now()}.json`);
    mkdirSync(join(SWARM_ROOT, 'state/porter-runs'), { recursive: true });
    writeFileSync(taskFile, taskJSON);

    return new Promise((resolve) => {
        const proc = spawn('node', [
            join(SWARM_ROOT, 'bin/run-porter.mjs'),
            `--provider=${provider}`,
            `--label=${label}`,
            `--task-file=${taskFile}`,
        ], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

        const out = [];
        const err = [];
        proc.stdout.on('data', b => { out.push(b); process.stdout.write(`[${label}] ` + b.toString()); });
        proc.stderr.on('data', b => { err.push(b); process.stderr.write(`[${label}] ` + b.toString()); });
        proc.on('close', code => {
            const stdout = Buffer.concat(out).toString('utf8');
            const stderr = Buffer.concat(err).toString('utf8');
            const lastLine = stdout.trim().split('\n').pop() || '';
            const wtPath = lastLine.startsWith('/') ? lastLine : null;
            resolve({ provider, label, exitCode: code, stdout, stderr, wtPath });
        });
    });
}

function verifyWorktree(wtPath, targetSession) {
    const child = spawnSync('node', [
        join(SWARM_ROOT, 'bin/verify-and-merge.mjs'), wtPath,
        `--target-session=${targetSession}`,
    ], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return { exitCode: child.status, stdout: child.stdout || '', stderr: child.stderr || '' };
}

function parseVerifyDecision(stdout) {
    const accept = /DECISION:\s*ACCEPT/m.test(stdout);
    const screensDelta = Number((stdout.match(/screensDelta:\s*([+-]?\d+)/) || [])[1] || 0);
    const rngDelta = Number((stdout.match(/rngDelta:\s*([+-]?\d+)/) || [])[1] || 0);
    return { accept, screensDelta, rngDelta };
}

function mergeWinner(wtPath, targetSession) {
    const child = spawnSync('node', [
        join(SWARM_ROOT, 'bin/verify-and-merge.mjs'), wtPath,
        `--target-session=${targetSession}`, '--commit',
    ], { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'inherit' });
    return child.status === 0;
}

function pushOrigin() {
    try {
        const out = sh('git push origin HEAD');
        console.log('[loop] pushed:', out || '(silent)');
        return true;
    } catch (e) {
        console.error('[loop] push failed:', e.message.split('\n')[0]);
        return false;
    }
}

function cleanupWorktree(wtPath) {
    try { sh(`git worktree remove --force "${wtPath}"`); }
    catch (_) {
        try { rmSync(wtPath, { recursive: true, force: true }); } catch (_) {}
    }
    // Also delete porter branch if it exists.
    const wtName = wtPath.split('/').pop();
    if (wtName) shOk(`git branch -D "porter/${wtName}"`);
}

async function oneIteration(iIdx, opts) {
    console.log(`\n=== iteration ${iIdx + 1}/${opts.iterations} ===`);

    const task = pickTask(opts.target);
    if (!task) { console.log('No candidate; stopping.'); return false; }

    console.log(`Target session: ${task.session || task._candidate_rank?.session}`);
    if (task.c_caller) {
        console.log(`Divergence: ${task.c_caller.fn} (${task.c_caller.file}:${task.c_caller.line})`);
    }

    emit('iteration_start', {
        iter: iIdx + 1, of: opts.iterations,
        target_session: task.session,
        c_caller: task.c_caller || null,
        providers: opts.providers,
    });

    const taskJSON = JSON.stringify(task);

    console.log(`Spawning ${opts.providers.length} porter(s): ${opts.providers.join(', ')}`);
    const labels = opts.providers.map((p, i) => `${p}-${i}-iter${iIdx + 1}`);
    const results = await Promise.all(opts.providers.map((p, i) => spawnPorter(p, labels[i], taskJSON)));

    const live = results.filter(r => r.wtPath && existsSync(r.wtPath));
    if (live.length === 0) {
        console.log('No porter produced a worktree; skipping iteration.');
        return false;
    }

    // Verify each, rank by screensDelta (need ACCEPT + max screensDelta).
    const verifications = live.map(r => {
        console.log(`\n— verify ${r.label} (${r.wtPath}) —`);
        const v = verifyWorktree(r.wtPath, task.session);
        process.stdout.write(v.stdout);
        const decision = parseVerifyDecision(v.stdout);
        return { ...r, ...decision };
    });

    const accepted = verifications.filter(v => v.accept);
    accepted.sort((a, b) => (b.screensDelta - a.screensDelta) || (b.rngDelta - a.rngDelta));

    if (accepted.length === 0) {
        console.log('\nNo porter passed the merge gate this iteration. Cleaning worktrees.');
        emit('iteration_no_winner', { iter: iIdx + 1, target_session: task.session, attempted: verifications.length });
        for (const v of verifications) cleanupWorktree(v.wtPath);
        return false;
    }

    const winner = accepted[0];
    console.log(`\nWINNER: ${winner.label} (screens +${winner.screensDelta}, rng +${winner.rngDelta})`);
    emit('iteration_winner', {
        iter: iIdx + 1, target_session: task.session,
        label: winner.label, provider: winner.provider,
        screens_delta: winner.screensDelta, rng_delta: winner.rngDelta,
    });
    const merged = mergeWinner(winner.wtPath, task.session);
    if (!merged) {
        console.log('Merge failed; aborting iteration.');
        emit('merge_failed', { iter: iIdx + 1, target_session: task.session, label: winner.label });
        return false;
    }

    // Push.
    if (opts.push) {
        const ok = pushOrigin();
        emit('merge_push', { iter: iIdx + 1, ok });
    }

    // Cleanup all worktrees including the winner (changes are now on main).
    for (const v of verifications) cleanupWorktree(v.wtPath);
    return true;
}

function runAnalyst(provider) {
    console.log(`\n[analyst] refreshing swarm/state/learnings.md via ${provider} …`);
    const child = spawnSync('node', [
        join(SWARM_ROOT, 'bin/analyst.mjs'),
        `--provider=${provider}`,
        '--min-events=1',
    ], { cwd: REPO_ROOT, stdio: 'inherit' });
    if (child.status !== 0) console.log(`[analyst] exited with ${child.status} — continuing.`);
    emit('analyst_run', { provider, exit_code: child.status });
}

async function main() {
    const opts = parseArgs();
    console.log(`run-loop: iterations=${opts.iterations} providers=${opts.providers.join(',')} push=${opts.push} analyst-every=${opts.analystEvery}`);
    let winnersSinceAnalyst = 0;
    for (let i = 0; i < opts.iterations; i++) {
        const ok = await oneIteration(i, opts);
        if (ok) winnersSinceAnalyst++;
        // Run the analyst after every N winners (or at iteration boundary
        // if --analyst-every=1). Skip if --no-analyst.
        if (!opts.noAnalyst && winnersSinceAnalyst >= opts.analystEvery) {
            runAnalyst(opts.analystProvider);
            winnersSinceAnalyst = 0;
        }
        if (!ok && i === 0 && !opts.target) {
            console.log('Stopping early — first iteration produced no merge.');
            break;
        }
    }
    // Always run the analyst at the end of a multi-iteration session so
    // the learnings.md reflects the final state.
    if (!opts.noAnalyst && opts.iterations > 1 && winnersSinceAnalyst > 0) {
        runAnalyst(opts.analystProvider);
    }
    console.log('\n— final status —');
    spawnSync('node', [join(SWARM_ROOT, 'bin/orchestrator.mjs'), 'status'], { stdio: 'inherit', cwd: REPO_ROOT });
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
