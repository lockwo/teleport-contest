// State for the swarm orchestrator. JSON-backed, atomic writes.
// One orchestrator process is the sole writer; workers read fresh on demand
// and report results via task IDs (no shared writes).

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SWARM_ROOT = join(HERE, '..');
export const REPO_ROOT = join(SWARM_ROOT, '..');
const STATE_DIR = join(SWARM_ROOT, 'state');
const STATE_PATH = join(STATE_DIR, 'state.json');

const EMPTY = {
    version: 1,
    sessions: {},   // name → { lastScore, lastRngMatched, lastRngTotal, lastScreensMatched, lastScreensTotal, lastRunAt, public: true }
    tasks: {},      // id → { kind, target_c, target_js, session, firstDivCall, status, owner, created_at, completed_at, result }
    ports: {},      // c_file → { js_file, status: unported|partial|complete, last_touched_at }
    runs: [],       // history of full score.sh runs
    nextTaskId: 1,
};

function ensureDir() { mkdirSync(STATE_DIR, { recursive: true }); }

export function load() {
    ensureDir();
    if (!existsSync(STATE_PATH)) {
        writeAtomic(EMPTY);
        return structuredClone(EMPTY);
    }
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}

export function save(state) {
    ensureDir();
    writeAtomic(state);
}

function writeAtomic(state) {
    const tmp = STATE_PATH + '.tmp';
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, STATE_PATH);
}

export function createTask(state, fields) {
    const id = String(state.nextTaskId++);
    state.tasks[id] = {
        id,
        status: 'pending',
        created_at: new Date().toISOString(),
        completed_at: null,
        owner: null,
        result: null,
        ...fields,
    };
    return id;
}

export function updateTask(state, id, patch) {
    if (!state.tasks[id]) throw new Error(`no task ${id}`);
    Object.assign(state.tasks[id], patch);
    if (patch.status === 'completed' || patch.status === 'failed') {
        state.tasks[id].completed_at = new Date().toISOString();
    }
}

export function recordRunBundle(state, bundle) {
    const entry = {
        commit: bundle.commit,
        timestamp: bundle.timestamp,
        screensMatched: bundle.results.reduce((a, r) => a + r.metrics.screens.matched, 0),
        screensTotal: bundle.results.reduce((a, r) => a + r.metrics.screens.total, 0),
        rngMatched: bundle.results.reduce((a, r) => a + r.metrics.rngCalls.matched, 0),
        rngTotal: bundle.results.reduce((a, r) => a + r.metrics.rngCalls.total, 0),
        sessionsPassing: bundle.results.filter(r => r.passed).length,
    };
    state.runs.push(entry);
    for (const r of bundle.results) {
        state.sessions[r.session] = state.sessions[r.session] || { public: true };
        Object.assign(state.sessions[r.session], {
            lastRngMatched: r.metrics.rngCalls.matched,
            lastRngTotal: r.metrics.rngCalls.total,
            lastScreensMatched: r.metrics.screens.matched,
            lastScreensTotal: r.metrics.screens.total,
            lastError: r.error || null,
            lastRunAt: bundle.timestamp,
        });
    }
    return entry;
}
