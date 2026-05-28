// Score runner — wraps `bash frozen/score.sh`, parses the __RESULTS_JSON__
// bundle, computes regressions/improvements between two bundles.

import { spawnSync, execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { REPO_ROOT } from './state.mjs';

export function runScoreAll(env = {}) {
    const child = spawnSync('bash', ['frozen/score.sh'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, ...env },
        maxBuffer: 256 * 1024 * 1024,
    });
    if (child.status !== 0 && !child.stdout?.includes('__RESULTS_JSON__')) {
        throw new Error(`score.sh failed: ${child.stderr || child.error}`);
    }
    return parseBundle(child.stdout || '');
}

export function runScoreSessions(sessionPaths) {
    const child = spawnSync('node', ['frozen/ps_test_runner.mjs', ...sessionPaths], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    if (child.status !== 0 && !child.stdout?.includes('__RESULTS_JSON__')) {
        throw new Error(`runner failed: ${child.stderr || child.error}`);
    }
    return parseBundle(child.stdout || '');
}

function parseBundle(stdout) {
    const idx = stdout.lastIndexOf('__RESULTS_JSON__');
    if (idx < 0) throw new Error('no __RESULTS_JSON__ marker in stdout');
    const json = stdout.slice(idx + '__RESULTS_JSON__'.length).trim();
    return JSON.parse(json);
}

// Diff two run bundles. The merge gate uses this — `regressions` MUST be
// empty for a merge to be allowed.
export function diffBundles(prev, next) {
    const prevBy = Object.fromEntries(prev.results.map(r => [r.session, r]));
    const nextBy = Object.fromEntries(next.results.map(r => [r.session, r]));
    const all = new Set([...Object.keys(prevBy), ...Object.keys(nextBy)]);
    const regressions = [];
    const improvements = [];
    let prevScreens = 0, nextScreens = 0;
    let prevRng = 0, nextRng = 0;
    for (const sess of all) {
        const p = prevBy[sess]?.metrics?.screens?.matched ?? 0;
        const n = nextBy[sess]?.metrics?.screens?.matched ?? 0;
        const pR = prevBy[sess]?.metrics?.rngCalls?.matched ?? 0;
        const nR = nextBy[sess]?.metrics?.rngCalls?.matched ?? 0;
        prevScreens += p; nextScreens += n;
        prevRng += pR; nextRng += nR;
        if (n < p) regressions.push({ session: sess, prev: p, next: n, delta: n - p });
        else if (n > p) improvements.push({ session: sess, prev: p, next: n, delta: n - p });
    }
    return {
        screensDelta: nextScreens - prevScreens,
        rngDelta: nextRng - prevRng,
        prevScreens, nextScreens,
        prevRng, nextRng,
        regressions,
        improvements,
    };
}

export function loadBundleFromFile(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

export function summarize(bundle) {
    const m = bundle.results.reduce((a, r) => a + r.metrics.screens.matched, 0);
    const t = bundle.results.reduce((a, r) => a + r.metrics.screens.total, 0);
    const rm = bundle.results.reduce((a, r) => a + r.metrics.rngCalls.matched, 0);
    const rt = bundle.results.reduce((a, r) => a + r.metrics.rngCalls.total, 0);
    const pass = bundle.results.filter(r => r.passed).length;
    return {
        commit: bundle.commit,
        timestamp: bundle.timestamp,
        screens: `${m}/${t} (${(100 * m / t).toFixed(2)}%)`,
        rng: `${rm}/${rt} (${(100 * rm / rt).toFixed(2)}%)`,
        passing: `${pass}/${bundle.results.length}`,
        screensMatched: m, screensTotal: t,
        rngMatched: rm, rngTotal: rt,
        sessionsPassing: pass,
    };
}
