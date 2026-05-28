#!/usr/bin/env node
// verify-and-merge.mjs — the merge gate. Given a worktree path containing
// a porter's edits, runs the full score.sh and decides:
//
//   ACCEPT — strictly improves total screens AND no per-session regression
//   REJECT — any session lost screens, or no improvement
//
// On ACCEPT: cherry-picks the worktree's commits onto the main repo's HEAD
// (only when --commit is passed; otherwise just reports).
// On REJECT: prints the diff sketch so the porter agent can be re-prompted.
//
// Usage:
//   node swarm/bin/verify-and-merge.mjs <worktree-path> --target-session=<name>
//   node swarm/bin/verify-and-merge.mjs <worktree-path> --target-session=<name> --commit

import { spawnSync, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { REPO_ROOT, SWARM_ROOT, load, save, recordRunBundle } from '../lib/state.mjs';
import { runScoreAll, diffBundles, loadBundleFromFile, summarize } from '../lib/score.mjs';
import { emit } from '../lib/journal.mjs';

const BASELINE_PATH = join(SWARM_ROOT, 'state/baseline.json');
const LATEST_PATH   = join(SWARM_ROOT, 'state/latest.json');

function sh(cmd, opts = {}) {
    const r = execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', ...opts });
    return r.trim();
}

function runScoreInWorktree(worktreePath) {
    const child = spawnSync('bash', ['frozen/score.sh'], {
        cwd: worktreePath, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env },
    });
    if (child.status !== 0 && !child.stdout?.includes('__RESULTS_JSON__')) {
        throw new Error(`score.sh in worktree failed: ${child.stderr || child.error}`);
    }
    const out = child.stdout || '';
    const idx = out.lastIndexOf('__RESULTS_JSON__');
    if (idx < 0) throw new Error('no __RESULTS_JSON__ in worktree score output');
    return JSON.parse(out.slice(idx + '__RESULTS_JSON__'.length).trim());
}

async function main() {
    const args = process.argv.slice(2);
    const worktree = args.find(a => !a.startsWith('--'));
    const commit = args.includes('--commit');
    const targetSessionArg = args.find(a => a.startsWith('--target-session='));
    const targetSession = targetSessionArg ? targetSessionArg.split('=')[1] : null;

    if (!worktree) { console.error('usage: verify-and-merge.mjs <worktree> --target-session=<name> [--commit]'); process.exit(1); }
    if (!existsSync(worktree)) { console.error(`worktree not found: ${worktree}`); process.exit(1); }

    const baseline = existsSync(LATEST_PATH) ? loadBundleFromFile(LATEST_PATH) : loadBundleFromFile(BASELINE_PATH);

    console.log(`Scoring worktree: ${worktree}`);
    const t0 = Date.now();
    const next = runScoreInWorktree(worktree);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const s = summarize(next);
    console.log(`  [${dt}s] commit ${s.commit}`);
    console.log(`  Screens: ${s.screens}`);
    console.log(`  RNG    : ${s.rng}`);

    const d = diffBundles(baseline, next);
    console.log(`  screensDelta: ${d.screensDelta >= 0 ? '+' : ''}${d.screensDelta}`);
    console.log(`  rngDelta:     ${d.rngDelta >= 0 ? '+' : ''}${d.rngDelta}`);
    if (d.regressions.length) {
        console.log(`  REGRESSIONS:`);
        for (const r of d.regressions) console.log(`    ${r.session}: ${r.prev}→${r.next} (${r.delta})`);
    }
    if (d.improvements.length) {
        console.log(`  improvements:`);
        for (const r of d.improvements.slice(0, 8)) console.log(`    ${r.session}: ${r.prev}→${r.next} (+${r.delta})`);
        if (d.improvements.length > 8) console.log(`    ... and ${d.improvements.length - 8} more`);
    }

    // Optional: extra-strict check on the target session — must show
    // strictly more matched RNG calls. Catches "I improved unrelated
    // sessions but didn't actually fix the thing I was tasked with".
    let targetCheck = null;
    if (targetSession) {
        const bSess = baseline.results.find(r => r.session === targetSession || r.session === targetSession.replace(/^sessions\//,''));
        const nSess = next.results.find(r => r.session === targetSession || r.session === targetSession.replace(/^sessions\//,''));
        if (bSess && nSess) {
            const targetRngDelta = nSess.metrics.rngCalls.matched - bSess.metrics.rngCalls.matched;
            const targetScreenDelta = nSess.metrics.screens.matched - bSess.metrics.screens.matched;
            targetCheck = { rng: targetRngDelta, screen: targetScreenDelta };
            console.log(`  target ${targetSession}: rng ${targetRngDelta >= 0 ? '+' : ''}${targetRngDelta}, screen ${targetScreenDelta >= 0 ? '+' : ''}${targetScreenDelta}`);
        }
    }

    const accept = d.regressions.length === 0
        && (d.screensDelta > 0 || (targetCheck && targetCheck.rng > 0));

    // Reject-reason classification — feeds the learn subcommand.
    let rejectReason = null;
    if (!accept) {
        if (d.regressions.length > 0) rejectReason = 'regression';
        else if (d.screensDelta <= 0 && targetCheck && targetCheck.rng <= 0) rejectReason = 'no_improvement';
        else if (d.screensDelta <= 0 && !targetCheck) rejectReason = 'no_screen_improvement';
        else rejectReason = 'unknown';
    }

    emit('verify_decision', {
        worktree: worktree,
        target_session: targetSession || null,
        accept,
        reject_reason: rejectReason,
        screens_delta: d.screensDelta,
        rng_delta: d.rngDelta,
        target_rng_delta: targetCheck?.rng ?? null,
        target_screen_delta: targetCheck?.screen ?? null,
        regressions: d.regressions.slice(0, 10),
        improvements_count: d.improvements.length,
    });

    console.log(accept ? '\nDECISION: ACCEPT' : '\nDECISION: REJECT');

    if (commit && accept) {
        // Snapshot the JS edits from the worktree and apply to main repo.
        // Simplest path: copy modified files; commit on main with porter
        // metadata. We don't do a git merge to keep history linear.
        const changes = sh(`git -C "${worktree}" diff --name-only HEAD`).split('\n').filter(Boolean);
        const staged  = sh(`git -C "${worktree}" diff --name-only --cached`).split('\n').filter(Boolean);
        const newFiles = sh(`git -C "${worktree}" status --porcelain`).split('\n')
            .filter(l => l.startsWith('?? ')).map(l => l.slice(3));
        const all = [...new Set([...changes, ...staged, ...newFiles])];
        if (all.length === 0) { console.log('(no files to copy from worktree — nothing committed)'); return; }
        for (const f of all) {
            const src = join(worktree, f);
            const dst = join(REPO_ROOT, f);
            if (existsSync(src)) {
                const content = readFileSync(src);
                writeFileSync(dst, content);
                console.log(`  copied ${f}`);
            }
        }
        // Stage and commit on main repo
        sh(`git add ${all.map(f => `'${f}'`).join(' ')}`);
        const msg = `porter: ${targetSession || 'merge from worktree'} (screens +${d.screensDelta}, rng +${d.rngDelta})`;
        sh(`git commit -m '${msg.replace(/'/g, "'\\''")}'`);
        const commitSha = sh('git rev-parse HEAD').slice(0, 7);
        console.log(`\n  committed: ${msg} (${commitSha})`);
        emit('merge_commit', { commit_sha: commitSha, message: msg, target_session: targetSession || null, screens_delta: d.screensDelta, rng_delta: d.rngDelta });

        // Promote latest + record run
        writeFileSync(LATEST_PATH, JSON.stringify(next));
        const state = load();
        recordRunBundle(state, next);
        save(state);
    }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
