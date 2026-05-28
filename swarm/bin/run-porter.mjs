#!/usr/bin/env node
// run-porter.mjs — spawn ONE porter agent in an isolated git worktree.
// Provider-agnostic: --provider=claude  or  --provider=codex.
//
// Reads the porter task from stdin (JSON, as emitted by pick-target.mjs
// --json) or from --task-file=<path>. Writes the result to
// swarm/state/porter-runs/<run-id>.json so the loop can pick it up.
//
// On success returns 0 and prints the worktree path on the last line of
// stdout. On agent failure returns the CLI's exit code.
//
// Usage:
//   node swarm/bin/pick-target.mjs --json | node swarm/bin/run-porter.mjs --provider=claude
//   node swarm/bin/run-porter.mjs --provider=codex --task-file=task.json
//   node swarm/bin/run-porter.mjs --provider=claude --task-file=task.json --label=A

import { spawn, execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { REPO_ROOT, SWARM_ROOT } from '../lib/state.mjs';
import { renderPorterPrompt } from '../lib/porter-task.mjs';
import { emit } from '../lib/journal.mjs';

const WORKTREES_DIR = join(SWARM_ROOT, 'worktrees');
const RUNS_DIR      = join(SWARM_ROOT, 'state/porter-runs');

function sh(cmd, opts = {}) {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', ...opts }).trim();
}

function readTask(args) {
    const tf = args.find(a => a.startsWith('--task-file='));
    if (tf) return JSON.parse(readFileSync(tf.split('=')[1], 'utf8'));
    // Read stdin
    const raw = readFileSync(0, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed[0] : parsed;
}

function buildPrompt(task) {
    const body = renderPorterPrompt(task);
    return `You are a **Porter** agent in a parallel agent swarm working on the
Teleport Coding Challenge (NetHack 5.0 → JavaScript port). You are
running inside an **isolated git worktree** — files you create or modify
here do NOT affect the main repo until a separate "merge gate" reviews
your score deltas. Be bold but verify.

Repository orientation:
- \`js/\` is the JS port. Mostly skeleton; lots to fill in.
- \`js/isaac64.js\`, \`js/terminal.js\`, \`js/storage.js\` are FROZEN — never modify.
- \`js/fastforward.js\` is a hardcoded RNG-replay scaffold for seed8000. Editable.
- \`nethack-c/upstream/src/\` has the C reference (read-only).
- \`frozen/ps_test_runner.mjs\` is the official scorer.
- \`swarm/bin/triage.mjs\` shows the first PRNG divergence for any session.
- \`bash frozen/score.sh\` runs the full 44-session regression.

${body}

**Acceptance is mechanical:** A merge gate runs \`bash frozen/score.sh\` in
your worktree after you finish. To be ACCEPTED you must:
- Strictly increase the target session's matched RNG count (currently it
  diverges at call ${task.rng_index ?? '(see above)'}).
- Cause zero regressions on any other session.
- Stay inside the constraints above (frozen files untouched, no
  modification of \`swarm/\` or \`frozen/\`).

Verify your work with:
\`\`\`
node frozen/ps_test_runner.mjs sessions/${task.session}
node swarm/bin/triage.mjs sessions/${task.session}
bash frozen/score.sh    # full regression
\`\`\`

When you finish, end your reply with a one-paragraph summary stating:
1. The minimal fix you applied (which files, what change).
2. Before/after RNG and screen counts for the target session.
3. Whether the full regression run showed any session regressing.

Do not commit — the merge gate does that.`;
}

function createWorktree(label) {
    mkdirSync(WORKTREES_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `${label}-${stamp}`;
    const wtPath = join(WORKTREES_DIR, name);
    const branch = `porter/${name}`;
    // Use current HEAD as the worktree base.
    sh(`git worktree add -b "${branch}" "${wtPath}" HEAD`);
    return { wtPath, branch, name };
}

function removeWorktreeIfClean(wtPath) {
    try {
        const status = sh(`git -C "${wtPath}" status --porcelain`);
        if (!status) sh(`git worktree remove "${wtPath}"`);
    } catch (_) {}
}

async function runProvider(provider, wtPath, promptText, runRecordPath, timeoutMs) {
    return new Promise((resolve, reject) => {
        let cmd, args, env = { ...process.env };

        if (provider === 'claude') {
            // Headless Claude Code. -p / --print emits assistant output
            // to stdout. The worktree is the cwd, so file edits land
            // there. --dangerously-skip-permissions matches our
            // "minimal human in the loop" contract — the worktree
            // itself is the sandbox.
            cmd = 'claude';
            args = [
                '-p', promptText,
                '--add-dir', wtPath,
                '--dangerously-skip-permissions',
                '--model', 'sonnet',
            ];
        } else if (provider === 'codex') {
            // Codex non-interactive. Sandbox bypass matches the
            // "unlimited tokens, minimal human in the loop" contract.
            cmd = 'codex';
            args = [
                'exec',
                '--dangerously-bypass-approvals-and-sandbox',
                '-C', wtPath,
                promptText,
            ];
        } else {
            return reject(new Error(`unknown provider: ${provider}`));
        }

        const logPath = runRecordPath.replace(/\.json$/, '.log');
        const proc = spawn(cmd, args, { cwd: wtPath, env, stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks = [];
        const errChunks = [];
        let timedOut = false;
        proc.stdout.on('data', (b) => { chunks.push(b); process.stdout.write(b); });
        proc.stderr.on('data', (b) => { errChunks.push(b); process.stderr.write(b); });

        const timer = setTimeout(() => {
            timedOut = true;
            console.error(`[run-porter] timeout after ${timeoutMs / 1000}s — killing ${provider}`);
            try { proc.kill('SIGTERM'); } catch {}
            setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 5000);
        }, timeoutMs);

        proc.on('close', (code) => {
            clearTimeout(timer);
            const out = Buffer.concat(chunks).toString('utf8');
            const err = Buffer.concat(errChunks).toString('utf8');
            const note = timedOut ? `[killed by run-porter after ${timeoutMs / 1000}s timeout]\n` : '';
            writeFileSync(logPath, `--- STDOUT ---\n${out}\n--- STDERR ---\n${err}\n--- EXIT ---\n${code}\n${note}`);
            resolve({ exitCode: timedOut ? 124 : code, stdout: out, stderr: err, timedOut });
        });
        proc.on('error', reject);
    });
}

async function main() {
    const args = process.argv.slice(2);
    const provider = (args.find(a => a.startsWith('--provider=')) || '--provider=claude').split('=')[1];
    const label    = (args.find(a => a.startsWith('--label=')) || `--label=${provider}`).split('=')[1];
    const timeoutMin = Number((args.find(a => a.startsWith('--timeout-min=')) || '--timeout-min=25').split('=')[1]);
    const timeoutMs = timeoutMin * 60 * 1000;

    const task = readTask(args);
    mkdirSync(RUNS_DIR, { recursive: true });

    const { wtPath, branch, name } = createWorktree(label);
    const runRecordPath = join(RUNS_DIR, `${name}.json`);

    const prompt = buildPrompt(task);
    const t0 = Date.now();
    console.error(`[run-porter] provider=${provider} label=${label} wt=${wtPath} branch=${branch} timeout=${timeoutMin}min`);

    emit('porter_spawn', { label, provider, wt_path: wtPath, branch, target_session: task.session, c_caller: task.c_caller || null, timeout_min: timeoutMin });

    let result;
    try {
        result = await runProvider(provider, wtPath, prompt, runRecordPath, timeoutMs);
    } catch (e) {
        console.error('[run-porter] launch error:', e.message);
        emit('porter_complete', { label, provider, wt_path: wtPath, target_session: task.session, exit_code: -1, error: e.message, files_touched: [], diff_lines: 0 });
        removeWorktreeIfClean(wtPath);
        process.exit(2);
    }

    const dt = ((Date.now() - t0) / 1000).toFixed(1);

    // Capture full diff for learning even if the worktree is later discarded.
    let diff = '';
    let filesTouched = [];
    let shortstat = '';
    try {
        filesTouched = (sh(`git -C "${wtPath}" status --porcelain`) || '')
            .split('\n').map(l => l.slice(3).trim()).filter(Boolean);
        // Stage everything so `git diff --cached` captures new files too.
        if (filesTouched.length) {
            sh(`git -C "${wtPath}" add -A`);
            diff = sh(`git -C "${wtPath}" diff --cached`, { maxBuffer: 64 * 1024 * 1024 });
            shortstat = sh(`git -C "${wtPath}" diff --cached --shortstat`) || '';
        }
    } catch (_) {}

    const diffPath = runRecordPath.replace(/\.json$/, '.diff');
    if (diff) writeFileSync(diffPath, diff);

    // Extract the agent's final summary heuristically: last ~30 lines of stdout
    // before any tool-invocation markers. Good enough for learning.
    const summaryLines = result.stdout.split('\n').slice(-50).join('\n');
    const diffLines = (diff.match(/^[+-]/gm) || []).length;

    writeFileSync(runRecordPath, JSON.stringify({
        provider, label, name, wtPath, branch,
        target_session: task.session,
        c_caller: task.c_caller || null,
        task,
        exitCode: result.exitCode,
        elapsedSec: Number(dt),
        finishedAt: new Date().toISOString(),
        filesTouched,
        diffShortStat: shortstat,
        diffLines,
        agentSummary: summaryLines,
    }, null, 2));

    emit('porter_complete', {
        label, provider, wt_path: wtPath,
        target_session: task.session,
        c_caller: task.c_caller || null,
        exit_code: result.exitCode,
        elapsed_sec: Number(dt),
        files_touched: filesTouched,
        diff_lines: diffLines,
        diff_shortstat: shortstat,
        agent_summary_tail: summaryLines,
    });

    // If the worktree saw no edits, auto-clean. Otherwise leave for the
    // merge gate to inspect.
    if (filesTouched.length === 0) {
        console.error(`[run-porter] no edits, cleaning worktree ${wtPath}`);
        removeWorktreeIfClean(wtPath);
        console.log(`(no edits in ${wtPath})`);
        process.exit(result.exitCode || 0);
    }

    // Commit inside the worktree so the merge gate has a clean diff to
    // inspect. (verify-and-merge does the actual main-branch commit.)
    try {
        sh(`git -C "${wtPath}" commit -m "porter ${label}: ${task.session || task.c_caller?.fn || 'edits'}" --no-verify`);
        console.error(`[run-porter] committed in worktree: ${shortstat || '(no diff)'}`);
    } catch (e) {
        console.error(`[run-porter] commit failed: ${e.message.split('\n')[0]}`);
    }

    console.log(wtPath);
    process.exit(result.exitCode || 0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
