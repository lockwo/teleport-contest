#!/usr/bin/env node
// analyst.mjs — periodically reads the journal, sample diffs, score
// history, and divergence histogram, and uses an LLM to write a
// distilled swarm/state/learnings.md. That file is then spliced into
// every porter prompt (alongside prior-attempts), closing the
// recursive-improvement loop.
//
// Usage:
//   node swarm/bin/analyst.mjs                              # claude, default
//   node swarm/bin/analyst.mjs --provider=codex
//   node swarm/bin/analyst.mjs --dry-run                    # build the prompt, don't call
//   node swarm/bin/analyst.mjs --min-events=10              # skip if journal is sparse
//
// Runs in-place (no worktree) since it only writes one file —
// swarm/state/learnings.md — and the porter prompt reads it directly.

import { spawn, execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { REPO_ROOT, SWARM_ROOT } from '../lib/state.mjs';
import { readAll } from '../lib/journal.mjs';

const LEARNINGS = join(SWARM_ROOT, 'state/learnings.md');
const RUNS_DIR  = join(SWARM_ROOT, 'state/porter-runs');
const LATEST    = join(SWARM_ROOT, 'state/latest.json');
const BASELINE  = join(SWARM_ROOT, 'state/baseline.json');

function sh(cmd, opts = {}) {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', ...opts }).trim();
}

// Pick up to N most recent diffs (most informative for the analyst).
function recentDiffs(limit = 8) {
    if (!existsSync(RUNS_DIR)) return [];
    const files = readdirSync(RUNS_DIR)
        .filter(f => f.endsWith('.diff'))
        .map(f => ({ f, path: join(RUNS_DIR, f), mtime: statSync(join(RUNS_DIR, f)).mtime }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);
    return files.map(({ f, path }) => {
        const meta = path.replace(/\.diff$/, '.json');
        let metaObj = {};
        try { metaObj = JSON.parse(readFileSync(meta, 'utf8')); } catch {}
        let diff = '';
        try { diff = readFileSync(path, 'utf8'); } catch {}
        // Trim huge diffs so we don't blow the context window.
        if (diff.length > 20_000) diff = diff.slice(0, 20_000) + '\n... [truncated]';
        return {
            id: f.replace(/\.diff$/, ''),
            provider: metaObj.provider,
            target_session: metaObj.target_session,
            c_caller: metaObj.c_caller,
            elapsed_sec: metaObj.elapsedSec,
            exit_code: metaObj.exitCode,
            files_touched: metaObj.filesTouched,
            agent_summary: metaObj.agentSummary?.slice(-2000),
            diff,
        };
    });
}

function scoreContext() {
    const out = { baseline: null, latest: null };
    try { out.baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch {}
    try { out.latest   = JSON.parse(readFileSync(LATEST,   'utf8')); } catch {}
    function summarize(b) {
        if (!b) return null;
        const m = b.results.reduce((a, r) => a + r.metrics.screens.matched, 0);
        const t = b.results.reduce((a, r) => a + r.metrics.screens.total, 0);
        const rm = b.results.reduce((a, r) => a + r.metrics.rngCalls.matched, 0);
        const rt = b.results.reduce((a, r) => a + r.metrics.rngCalls.total, 0);
        return {
            commit: b.commit, timestamp: b.timestamp,
            screensMatched: m, screensTotal: t,
            rngMatched: rm, rngTotal: rt,
            sessionsPassing: b.results.filter(r => r.passed).length,
        };
    }
    return { baseline: summarize(out.baseline), latest: summarize(out.latest) };
}

function divergenceHistogram() {
    try {
        const out = sh('node swarm/bin/divergence-histogram.mjs --json');
        return JSON.parse(out);
    } catch (e) {
        return null;
    }
}

function aggregateLearnStats() {
    try {
        const out = sh('node swarm/bin/learn.mjs');
        return out;
    } catch { return ''; }
}

function buildPrompt() {
    const events = readAll();
    const recent = recentDiffs(8);
    const score = scoreContext();
    const histogram = divergenceHistogram();
    const aggregate = aggregateLearnStats();

    const eventTail = events.slice(-60).map(e => JSON.stringify(e)).join('\n');
    const diffBlock = recent.map(r => `
=== ${r.id} (${r.provider}, ${r.target_session}, ${r.c_caller ? r.c_caller.fn : '?'}) ===
Files touched: ${(r.files_touched || []).join(', ') || '(none)'}
Elapsed: ${r.elapsed_sec}s  Exit: ${r.exit_code}
Agent summary tail:
${(r.agent_summary || '(none)').split('\n').slice(-12).join('\n')}

Diff:
${r.diff || '(no diff captured)'}
`).join('\n');

    const histogramText = (histogram || [])
        .filter(b => b.caller)
        .slice(0, 10)
        .map(b => `  ${String(b.count).padStart(3)} sessions diverge at ${b.caller.fn}(${b.caller.file}:${b.caller.line}) — example: ${b.sessions[0]}`)
        .join('\n');

    return `You are the **Analyst** for an agent swarm porting NetHack 5.0 (C) to JavaScript for the Teleport Coding Challenge. The swarm uses parallel Claude and Codex "porter" agents in isolated git worktrees; a merge gate accepts only score-improving, regression-free changes. You don't write code — you read the swarm's history and write a single file (\`swarm/state/learnings.md\`) that future porters will see in their prompts.

Your job: extract **actionable patterns** the next porter would benefit from knowing. Be concrete, not philosophical.

# Current score

${score.latest ? `Latest:    commit ${score.latest.commit}  screens ${score.latest.screensMatched}/${score.latest.screensTotal} (${(100*score.latest.screensMatched/score.latest.screensTotal).toFixed(2)}%)  rng ${score.latest.rngMatched}/${score.latest.rngTotal}  passing ${score.latest.sessionsPassing}/44` : '(no latest score)'}
${score.baseline ? `Baseline:  commit ${score.baseline.commit}  screens ${score.baseline.screensMatched}/${score.baseline.screensTotal} (${(100*score.baseline.screensMatched/score.baseline.screensTotal).toFixed(2)}%)` : '(no baseline)'}

# Divergence histogram (where the 44 sessions currently fail)

${histogramText || '(no histogram available)'}

# Aggregate swarm stats

${aggregate || '(no aggregate)'}

# Recent journal events (most recent 60)

\`\`\`
${eventTail || '(empty)'}
\`\`\`

# Recent porter diffs (with each agent's summary tail)

${diffBlock || '(no porter diffs yet)'}

# What to write

Output a markdown document, ~150–500 lines, that will be saved to \`swarm/state/learnings.md\` and spliced into future porter prompts. Use the following sections (omit a section if you genuinely have nothing to say):

\`\`\`markdown
# Swarm learnings (auto-distilled by analyst)

_Last refresh: <ISO timestamp>_

## Headline insights
- 1–3 most important takeaways. Each one a single sentence. Skip if nothing surprising yet.

## What works
- Specific approaches porters have used that **passed the merge gate** (or got close). Cite porter-run IDs.

## What doesn't work
- Specific approaches that were **rejected**, and *why*. Cite porter-run IDs and the reject reason. This is the most valuable section — future porters need to know what to avoid.

## Per-provider patterns
- Differences between claude and codex porters: speed, diff size, common failure modes, strengths. Use the aggregate stats above plus the diff samples.

## Per-target patterns
- For divergence sites with multiple attempts, what's the pattern of failure? Is the right fix a fastforward patch, a structural port, or something else?

## Recommended next targets (in order)
- Based on the histogram + recent activity, what should the swarm attack next? Be concrete: "fix \`place_level\` in dungeon.c — 20 sessions blocked, no porter has attempted it yet."

## Open questions
- Things the analyst can't determine from the data — facts a human or follow-up investigation should resolve.
\`\`\`

Important constraints:
- Write directly to \`${LEARNINGS}\` using your file tools.
- Do not include speculation; if the journal doesn't support a claim, don't make it.
- Keep individual bullet points to one sentence each.
- If the journal is mostly empty (fewer than ~5 porter completions), write a short placeholder noting the swarm is still bootstrapping — don't manufacture insights.
- Do not modify any other file.
- Output a brief one-paragraph confirmation at the end of your reply summarizing what you wrote.

Write the file now.`;
}

function parseArgs() {
    const args = process.argv.slice(2);
    return {
        provider: (args.find(a => a.startsWith('--provider=')) || '--provider=claude').split('=')[1],
        dryRun: args.includes('--dry-run'),
        minEvents: Number((args.find(a => a.startsWith('--min-events=')) || '--min-events=0').split('=')[1]),
    };
}

async function runAgent(provider, promptText) {
    return new Promise((resolve, reject) => {
        let cmd, agentArgs;
        if (provider === 'claude') {
            cmd = 'claude';
            agentArgs = [
                '-p', promptText,
                '--add-dir', REPO_ROOT,
                '--dangerously-skip-permissions',
                '--model', 'sonnet',
            ];
        } else if (provider === 'codex') {
            cmd = 'codex';
            agentArgs = [
                'exec',
                '--dangerously-bypass-approvals-and-sandbox',
                '-C', REPO_ROOT,
                promptText,
            ];
        } else return reject(new Error(`unknown provider: ${provider}`));

        const proc = spawn(cmd, agentArgs, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        const out = [];
        const err = [];
        proc.stdout.on('data', b => { out.push(b); process.stdout.write(b); });
        proc.stderr.on('data', b => { err.push(b); process.stderr.write(b); });
        proc.on('close', code => resolve({ exitCode: code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
        proc.on('error', reject);
    });
}

async function main() {
    const opts = parseArgs();
    const events = readAll();
    const completions = events.filter(e => e.event === 'porter_complete').length;
    if (completions < opts.minEvents) {
        console.error(`[analyst] only ${completions} porter completions in journal (--min-events=${opts.minEvents}); skipping.`);
        return;
    }

    const prompt = buildPrompt();
    if (opts.dryRun) {
        console.log(prompt);
        return;
    }
    mkdirSync(join(SWARM_ROOT, 'state'), { recursive: true });
    console.error(`[analyst] running ${opts.provider} on ${events.length} events, ${completions} completions`);
    const t0 = Date.now();
    const result = await runAgent(opts.provider, prompt);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[analyst] ${opts.provider} finished in ${dt}s (exit ${result.exitCode})`);
    if (existsSync(LEARNINGS)) {
        const size = statSync(LEARNINGS).size;
        console.error(`[analyst] learnings.md updated (${size} bytes)`);
    } else {
        console.error(`[analyst] WARNING: analyst did not write ${LEARNINGS}`);
    }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
