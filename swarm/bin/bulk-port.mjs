#!/usr/bin/env node
// bulk-port.mjs — whole-file transpilation in parallel.
//
// Spawns one porter per chosen C file (the porter's task is "transpile
// the entire file"), runs them concurrently, verifies each worktree,
// and merges every worktree that improves the score without regressing
// any session. Designed to run alongside the divergence-driven loop,
// not replace it.
//
// Why this exists:
//   The divergence-driven loop fixes one function per iteration. NetHack
//   has so many functions that call other unported functions that
//   single-function fixes often hit the *next* unported caller within a
//   few RNG calls. Whole-file ports plug those holes coherently and
//   tend to produce 10–100× more matched RNG per round.
//
// Usage:
//   node swarm/bin/bulk-port.mjs                       # top 8 by leverage, claude+codex split
//   node swarm/bin/bulk-port.mjs --top=4               # smaller batch
//   node swarm/bin/bulk-port.mjs --files=mklev.c,role.c,sp_lev.c
//   node swarm/bin/bulk-port.mjs --providers=codex,codex,claude  # bias provider distribution
//   node swarm/bin/bulk-port.mjs --no-push             # local-only test
//   node swarm/bin/bulk-port.mjs --dry-run             # print plan, don't spawn

import { spawn, spawnSync, execSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { REPO_ROOT, SWARM_ROOT } from '../lib/state.mjs';
import { buildFilePortTask } from '../lib/porter-task.mjs';
import { emit } from '../lib/journal.mjs';

const WORKTREES_DIR = join(SWARM_ROOT, 'worktrees');
const RUNS_DIR      = join(SWARM_ROOT, 'state/porter-runs');

function sh(cmd, opts = {}) {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', ...opts }).trim();
}
function shOk(cmd, opts = {}) {
    try { return sh(cmd, opts); } catch { return null; }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const v = (k, dflt) => {
        const a = args.find(x => x.startsWith(`--${k}=`));
        return a ? a.split('=').slice(1).join('=') : dflt;
    };
    return {
        top:        parseInt(v('top', '8'), 10),
        files:      v('files', '').split(',').map(s => s.trim()).filter(Boolean),
        providers:  v('providers', 'claude,codex').split(',').map(s => s.trim()).filter(Boolean),
        push:       !args.includes('--no-push'),
        dryRun:     args.includes('--dry-run'),
        timeoutMin: parseInt(v('timeout-min', '30'), 10),
    };
}

// Choose target C files by current-blocking leverage: each file's score
// is the sum of blocked sessions across all its currently-divergent
// call-sites. Already-fully-ported files (those with no blocked sessions)
// are skipped.
function pickFilesByLeverage(topN) {
    const out = shOk('node swarm/bin/divergence-histogram.mjs --json');
    if (!out) return [];
    const buckets = JSON.parse(out);
    const totalsByFile = new Map();
    for (const b of buckets) {
        if (!b.caller) continue;
        const f = b.caller.file;
        totalsByFile.set(f, (totalsByFile.get(f) || 0) + b.count);
    }
    return [...totalsByFile.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([file, leverage]) => ({ file, leverage }));
}

function createWorktree(label) {
    mkdirSync(WORKTREES_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `bulk-${label}-${stamp}`;
    const wtPath = join(WORKTREES_DIR, name);
    const branch = `porter/${name}`;
    sh(`git worktree add -b "${branch}" "${wtPath}" HEAD`);
    return { wtPath, branch, name };
}

function cleanupWorktree(wtPath) {
    try { sh(`git worktree remove --force "${wtPath}"`); } catch { try { rmSync(wtPath, { recursive: true, force: true }); } catch {} }
    const wtName = wtPath.split('/').pop();
    if (wtName) shOk(`git branch -D "porter/${wtName}"`);
}

async function spawnFilePorter({ cFile, provider, label, timeoutMs }) {
    const task = buildFilePortTask(cFile);
    const { wtPath, branch, name } = createWorktree(label);
    mkdirSync(RUNS_DIR, { recursive: true });

    // Use the prompt builder via run-porter's internal contract. We
    // bypass run-porter.mjs CLI entirely and spawn the provider CLI
    // directly so we can pass the file-port prompt — run-porter is
    // tuned for the divergence-style task spec.
    const { renderPorterPrompt } = await import('../lib/porter-task.mjs');
    const promptBody = renderPorterPrompt(task);
    const prompt = `You are a **Porter** agent for the NetHack 5.0 → JavaScript port (Teleport Coding Challenge). This is a whole-file transpilation round; you run inside an isolated git worktree at ${wtPath}.

${promptBody}

When done, commit nothing — the merge gate handles it. Output a short summary of the file you ported, count of functions translated, and the before/after numbers from \`bash frozen/score.sh\` you observed.`;

    emit('porter_spawn', { label, provider, wt_path: wtPath, branch, kind: 'file-port', c_file: cFile, timeout_min: timeoutMs / 60_000 });

    const runRecordPath = join(RUNS_DIR, `${name}.json`);
    const logPath       = runRecordPath.replace(/\.json$/, '.log');
    const promptPath    = runRecordPath.replace(/\.json$/, '.prompt.md');
    writeFileSync(promptPath, prompt);

    const t0 = Date.now();
    const result = await runProvider(provider, wtPath, prompt, timeoutMs);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    writeFileSync(logPath, `--- STDOUT ---\n${result.stdout}\n--- STDERR ---\n${result.stderr}\n--- EXIT ---\n${result.exitCode}\n${result.timedOut ? `[killed: timeout]\n` : ''}`);

    // Capture diff for learning even if discarded.
    let diff = '';
    let filesTouched = [];
    let shortstat = '';
    try {
        filesTouched = sh(`git -C "${wtPath}" status --porcelain`).split('\n').map(l => l.slice(3).trim()).filter(Boolean);
        if (filesTouched.length) {
            sh(`git -C "${wtPath}" add -A`);
            diff = sh(`git -C "${wtPath}" diff --cached`, { maxBuffer: 64 * 1024 * 1024 });
            shortstat = sh(`git -C "${wtPath}" diff --cached --shortstat`);
        }
    } catch {}
    if (diff) writeFileSync(runRecordPath.replace(/\.json$/, '.diff'), diff);

    const diffLines = (diff.match(/^[+-]/gm) || []).length;
    const summary = result.stdout.split('\n').slice(-50).join('\n');

    writeFileSync(runRecordPath, JSON.stringify({
        provider, label, name, wtPath, branch,
        kind: 'file-port', c_file: cFile,
        exitCode: result.exitCode,
        elapsedSec: Number(dt),
        filesTouched, diffShortStat: shortstat, diffLines,
        agentSummary: summary,
        finishedAt: new Date().toISOString(),
    }, null, 2));

    emit('porter_complete', {
        label, provider, wt_path: wtPath,
        kind: 'file-port', c_file: cFile,
        exit_code: result.exitCode, elapsed_sec: Number(dt),
        files_touched: filesTouched, diff_lines: diffLines,
        diff_shortstat: shortstat, agent_summary_tail: summary,
    });

    if (filesTouched.length === 0) {
        cleanupWorktree(wtPath);
        return { ...task, label, provider, wtPath, empty: true };
    }
    try { sh(`git -C "${wtPath}" commit -m "porter ${label}: file port ${cFile}" --no-verify`); } catch {}
    return { ...task, label, provider, wtPath, empty: false };
}

function runProvider(provider, wtPath, promptText, timeoutMs) {
    return new Promise((resolve) => {
        let cmd, args;
        if (provider === 'claude') {
            cmd = 'claude';
            args = ['-p', promptText, '--add-dir', wtPath, '--dangerously-skip-permissions', '--model', 'sonnet'];
        } else if (provider === 'codex') {
            cmd = 'codex';
            args = ['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', wtPath, promptText];
        } else {
            return resolve({ exitCode: -1, stdout: '', stderr: `unknown provider: ${provider}`, timedOut: false });
        }
        const proc = spawn(cmd, args, { cwd: wtPath, stdio: ['ignore', 'pipe', 'pipe'] });
        const out = [];
        const err = [];
        let timedOut = false;
        proc.stdout.on('data', b => { out.push(b); process.stdout.write(`[${provider}] ` + b.toString()); });
        proc.stderr.on('data', b => { err.push(b); process.stderr.write(`[${provider}] ` + b.toString()); });
        const t = setTimeout(() => {
            timedOut = true;
            try { proc.kill('SIGTERM'); } catch {}
            setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 5000);
        }, timeoutMs);
        proc.on('close', code => { clearTimeout(t); resolve({ exitCode: timedOut ? 124 : code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut }); });
    });
}

function verifyAndMerge(wtPath) {
    // Re-use the existing verify-and-merge.mjs in commit mode. It handles
    // the score diff, regression check, and main-branch commit.
    const r = spawnSync('node', [join(SWARM_ROOT, 'bin/verify-and-merge.mjs'), wtPath, '--commit'], {
        cwd: REPO_ROOT, encoding: 'utf8', stdio: 'inherit', maxBuffer: 256 * 1024 * 1024,
    });
    return r.status === 0;
}

async function main() {
    const opts = parseArgs();

    // Pick files
    let plan;
    if (opts.files.length) {
        plan = opts.files.map(f => ({ file: f, leverage: 0 }));
    } else {
        plan = pickFilesByLeverage(opts.top);
    }
    if (!plan.length) { console.log('No target files found.'); return; }

    // Distribute providers round-robin across files
    const assignments = plan.map((p, i) => ({
        cFile: p.file,
        leverage: p.leverage,
        provider: opts.providers[i % opts.providers.length],
        label: `bulk-${p.file.replace(/\W+/g, '_')}-${opts.providers[i % opts.providers.length]}`,
    }));

    console.log(`Bulk-port plan (${assignments.length} files):`);
    for (const a of assignments) {
        console.log(`  [${a.provider}] ${a.cFile}  (leverage=${a.leverage})`);
    }
    if (opts.dryRun) return;

    console.log(`\nSpawning ${assignments.length} parallel porters (timeout ${opts.timeoutMin}min each)…`);
    const t0 = Date.now();
    // allSettled so one bad file (e.g. C source missing) doesn't crash the batch.
    const settled = await Promise.allSettled(assignments.map(a => spawnFilePorter({
        cFile: a.cFile, provider: a.provider, label: a.label,
        timeoutMs: opts.timeoutMin * 60_000,
    })));
    const results = [];
    for (const s of settled) {
        if (s.status === 'fulfilled') results.push(s.value);
        else console.error(`[bulk-port] porter failed: ${s.reason?.message || s.reason}`);
    }
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nAll porters finished in ${dt}s (${results.length}/${assignments.length} succeeded). Verifying and merging winners…`);

    const live = results.filter(r => !r.empty && existsSync(r.wtPath));
    if (!live.length) {
        console.log('No worktrees with edits — nothing to verify.');
        return;
    }

    // Sequentially verify+merge each worktree. Sequential is important
    // because each merge advances main HEAD, which is the baseline the
    // next verify uses. If we ran them concurrently, the verify's
    // "current main score" would be stale.
    let mergedCount = 0;
    for (const r of live) {
        console.log(`\n— verify ${r.label} (${r.c_file}) —`);
        const ok = verifyAndMerge(r.wtPath);
        if (ok) {
            mergedCount++;
            console.log(`  merged ${r.c_file}`);
            if (opts.push) {
                try { sh('git push origin HEAD'); console.log('  pushed'); emit('merge_push', { kind: 'bulk-port', c_file: r.c_file, ok: true }); }
                catch (e) { console.log(`  push failed: ${e.message.split('\n')[0]}`); emit('merge_push', { kind: 'bulk-port', c_file: r.c_file, ok: false, error: e.message }); }
            }
        }
        cleanupWorktree(r.wtPath);
    }

    console.log(`\n=== bulk-port complete: ${mergedCount}/${live.length} merged in ${dt}s ===`);
    spawnSync('node', [join(SWARM_ROOT, 'bin/orchestrator.mjs'), 'status'], { stdio: 'inherit', cwd: REPO_ROOT });
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
