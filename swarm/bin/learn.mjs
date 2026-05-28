#!/usr/bin/env node
// learn.mjs — read swarm/state/journal.jsonl and surface patterns the
// orchestrator can act on. Designed for two consumers:
//
//   1. Humans  — `node swarm/bin/learn.mjs` prints aggregates.
//   2. Porter prompts — `node swarm/bin/learn.mjs --prior=<session>`
//      emits a short "previously tried on this target" block that
//      porter-task.mjs splices into new prompts.
//
// Future-friendly: an "analyst" agent can be run nightly to read
// journal.jsonl + per-porter diffs and write a distilled
// swarm/state/learnings.md. This file is the data layer it feeds on.

import { readAll, filter } from '../lib/journal.mjs';

function fmtMS(ms) {
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
}

function aggregate() {
    const events = readAll();
    if (!events.length) {
        console.log('(no journal events yet — run swarm/bin/run-loop.mjs to populate)');
        return;
    }

    // Pair porter_complete + verify_decision by worktree path.
    const completes = events.filter(e => e.event === 'porter_complete');
    const decisions = events.filter(e => e.event === 'verify_decision');
    const decisionByWt = new Map(decisions.map(d => [d.worktree, d]));

    const rows = completes.map(c => ({
        provider: c.provider,
        target: c.target_session,
        c_caller: c.c_caller ? `${c.c_caller.fn}(${c.c_caller.file}:${c.c_caller.line})` : '(no caller)',
        exit: c.exit_code,
        elapsed: c.elapsed_sec,
        diff_lines: c.diff_lines,
        files: c.files_touched?.length || 0,
        decision: decisionByWt.get(c.wt_path) || null,
    }));

    const providers = [...new Set(rows.map(r => r.provider))];
    const provStats = providers.map(p => {
        const sub = rows.filter(r => r.provider === p);
        const verified = sub.filter(r => r.decision);
        const accepts = verified.filter(r => r.decision.accept);
        const elapsed = sub.map(r => r.elapsed).filter(Boolean);
        const median = elapsed.length ? elapsed.sort((a, b) => a - b)[Math.floor(elapsed.length / 2)] : 0;
        return {
            provider: p,
            runs: sub.length,
            verified: verified.length,
            accepts: accepts.length,
            accept_rate: verified.length ? (accepts.length / verified.length) : null,
            median_elapsed_sec: median,
            avg_diff_lines: sub.length ? Math.round(sub.reduce((a, r) => a + (r.diff_lines || 0), 0) / sub.length) : 0,
        };
    });

    // Reject reason histogram
    const rejects = decisions.filter(d => !d.accept);
    const rejReasons = {};
    for (const r of rejects) rejReasons[r.reject_reason || 'unknown'] = (rejReasons[r.reject_reason || 'unknown'] || 0) + 1;

    // Per-caller history (which C divergences are recurring problems?)
    const callerStats = {};
    for (const r of rows) {
        const k = r.c_caller;
        if (!callerStats[k]) callerStats[k] = { attempts: 0, accepts: 0 };
        callerStats[k].attempts++;
        if (r.decision?.accept) callerStats[k].accepts++;
    }

    const iters = events.filter(e => e.event === 'iteration_start');
    const winners = events.filter(e => e.event === 'iteration_winner');
    const noWinners = events.filter(e => e.event === 'iteration_no_winner');
    const pushes = events.filter(e => e.event === 'merge_push' && e.ok);

    console.log('# Swarm learnings\n');
    console.log(`iterations: ${iters.length}  |  winners: ${winners.length}  |  no-winners: ${noWinners.length}  |  pushes: ${pushes.length}`);
    console.log(`porter runs: ${rows.length}  |  verified: ${rows.filter(r => r.decision).length}  |  accepts: ${rows.filter(r => r.decision?.accept).length}\n`);

    console.log('## Provider stats');
    console.log('provider'.padEnd(10) + 'runs  verified  accepts  rate    median   avg_diff');
    for (const s of provStats) {
        const rate = s.accept_rate == null ? '   -  ' : `${(100 * s.accept_rate).toFixed(0)}%`.padStart(5);
        console.log(`${s.provider.padEnd(10)}${String(s.runs).padStart(4)}  ${String(s.verified).padStart(8)}  ${String(s.accepts).padStart(7)}  ${rate}   ${String(Math.round(s.median_elapsed_sec)).padStart(5)}s   ${s.avg_diff_lines}`);
    }

    if (rejects.length) {
        console.log('\n## Reject reasons');
        for (const [k, v] of Object.entries(rejReasons).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${String(v).padStart(3)}  ${k}`);
        }
    }

    const recurringCallers = Object.entries(callerStats).filter(([_, s]) => s.attempts > 1).sort((a, b) => b[1].attempts - a[1].attempts);
    if (recurringCallers.length) {
        console.log('\n## Per-caller history (attempts > 1)');
        for (const [k, s] of recurringCallers) {
            console.log(`  ${k}: ${s.attempts} attempts, ${s.accepts} accept(s)`);
        }
    }

    // Recent activity tail
    const tail = events.slice(-12);
    console.log('\n## Recent events');
    for (const e of tail) {
        const time = e.ts?.slice(11, 19) || '';
        if (e.event === 'iteration_start') console.log(`  ${time}  iter ${e.iter}: ${e.target_session} (${e.providers?.join(',') || '?'})`);
        else if (e.event === 'porter_spawn') console.log(`  ${time}  spawn ${e.provider} → ${e.target_session}`);
        else if (e.event === 'porter_complete') console.log(`  ${time}  complete ${e.provider} (${e.elapsed_sec}s, ${e.diff_lines}L)`);
        else if (e.event === 'verify_decision') console.log(`  ${time}  verify ${e.accept ? 'ACCEPT' : 'REJECT'} (${e.reject_reason || ''}; screens ${e.screens_delta >= 0 ? '+' : ''}${e.screens_delta})`);
        else if (e.event === 'iteration_winner') console.log(`  ${time}  WINNER ${e.provider} (screens +${e.screens_delta})`);
        else if (e.event === 'merge_commit') console.log(`  ${time}  commit ${e.commit_sha}`);
        else if (e.event === 'merge_push') console.log(`  ${time}  push ${e.ok ? 'ok' : 'FAILED'}`);
        else console.log(`  ${time}  ${e.event}`);
    }
}

// Emit a short "prior attempts on this target" markdown block. This is
// what porter-task.mjs splices into a new prompt so the porter knows
// what's already been tried (and didn't work).
function priorAttempts(targetSession, limit = 5) {
    const events = readAll();
    const completes = events
        .filter(e => e.event === 'porter_complete' && e.target_session === targetSession)
        .slice(-limit);
    const decisions = events.filter(e => e.event === 'verify_decision');
    const decisionByWt = new Map(decisions.map(d => [d.worktree, d]));

    if (!completes.length) {
        console.log('(no prior attempts on this target — first try)');
        return;
    }

    console.log(`## Prior attempts on \`${targetSession}\` (most recent ${completes.length})\n`);
    for (const c of completes) {
        const d = decisionByWt.get(c.wt_path);
        const decisionStr = d
            ? (d.accept ? `ACCEPT (screens +${d.screens_delta}, rng +${d.rng_delta})`
                        : `REJECT (${d.reject_reason}; target_rng=${d.target_rng_delta}, target_screen=${d.target_screen_delta})`)
            : 'no verify';
        const filesStr = (c.files_touched || []).slice(0, 5).join(', ') || '(none)';
        const summary = (c.agent_summary_tail || '').split('\n').filter(l => l.trim()).slice(-3).join(' ').replace(/\s+/g, ' ').slice(0, 220);
        console.log(`- **${c.provider}** (${c.elapsed_sec}s, ${c.diff_lines} diff lines, touched: \`${filesStr}\`) → **${decisionStr}**`);
        if (summary) console.log(`  agent: "${summary}${summary.length === 220 ? '…' : ''}"`);
    }
    console.log('\n**Don\'t repeat any of these approaches** unless you have a specific reason they\'ll behave differently this time.');
}

function main() {
    const args = process.argv.slice(2);
    const priorArg = args.find(a => a.startsWith('--prior='));
    if (priorArg) return priorAttempts(priorArg.split('=')[1]);
    aggregate();
}

main();
