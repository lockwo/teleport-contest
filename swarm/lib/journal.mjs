// journal.mjs — append-only event log for the swarm.
//
// Every significant action emits one JSON line to swarm/state/journal.jsonl.
// Format: {ts, event, ...fields}.  Append-only so concurrent porters can
// safely write without coordination (POSIX append + O_APPEND is atomic
// for small writes).
//
// Event types (current):
//   iteration_start    {iter, target_session, providers, divergence}
//   porter_spawn       {iter, label, provider, wt_path, target_session}
//   porter_complete    {iter, label, provider, wt_path, exit_code, elapsed_sec,
//                       files_touched, diff_lines, agent_summary}
//   verify_decision    {iter, label, provider, accept, screens_delta, rng_delta,
//                       target_session_rng_delta, target_session_screen_delta,
//                       regressions: [{session, prev, next}]}
//   iteration_winner   {iter, label, provider, screens_delta, rng_delta}
//   iteration_no_winner {iter, reason}
//   merge_commit       {iter, commit_sha, message}
//   merge_push         {iter, ref, ok, error?}
//
// Reads:
//   readAll() → array of events (full replay)
//   tail(n)   → last n events
//   filter(predicate) → filtered events
//
// This file is intentionally small + dependency-free.  All callers
// can import { emit } and write one event with a single line.

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SWARM_ROOT = join(HERE, '..');
const JOURNAL = join(SWARM_ROOT, 'state/journal.jsonl');

export function emit(event, fields = {}) {
    mkdirSync(dirname(JOURNAL), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...fields }) + '\n';
    appendFileSync(JOURNAL, line);
}

export function readAll() {
    if (!existsSync(JOURNAL)) return [];
    return readFileSync(JOURNAL, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
}

export function tail(n) {
    const all = readAll();
    return all.slice(-n);
}

export function filter(predicate) {
    return readAll().filter(predicate);
}

export const JOURNAL_PATH = JOURNAL;
