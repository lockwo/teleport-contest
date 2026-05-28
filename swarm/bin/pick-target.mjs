#!/usr/bin/env node
// pick-target.mjs — selects the next session to attack and emits a porter
// task for it.
//
// Strategy: leverage-weighted, cooldown-aware.
//
//   leverage(session) =
//     (# sessions sharing this session's first-divergence call-site)
//       × max(0.01, 1 - rngFrac(session))     // weight by how broken
//       × cooldown(session)                    // 0..1, drops to 0 if recently failed
//
// "Closest to passing" (rngFrac descending) was the old default. It got
// stuck on seed8000 (1 session, 99.87% matched) because the picker re-
// selected it every iteration. Leverage-weighted picking favors sites
// blocking many sessions (place_level: 20, role_init: 10, …) over
// outliers, and the cooldown ensures the swarm rotates between targets
// when a fix isn't landing.
//
// Cooldown rule: a session that has been attempted ≥ COOLDOWN_THRESHOLD
// times in the last COOLDOWN_WINDOW iterations *without a winning merge*
// gets its score multiplied by 0.1 (heavily deprioritised) so other
// targets get a turn.
//
// Usage:
//   node swarm/bin/pick-target.mjs                # next target as markdown
//   node swarm/bin/pick-target.mjs --json         # JSON array for orchestrator
//   node swarm/bin/pick-target.mjs --top=5        # show top 5 candidates
//   node swarm/bin/pick-target.mjs --strategy=closest-to-passing   # opt back into the old heuristic

import { join, basename } from 'path';
import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { REPO_ROOT, SWARM_ROOT } from '../lib/state.mjs';
import { buildPorterTask, renderPorterPrompt } from '../lib/porter-task.mjs';
import { readAll } from '../lib/journal.mjs';

const LATEST = join(SWARM_ROOT, 'state/latest.json');

const COOLDOWN_THRESHOLD = 2;   // attempted N+ times…
const COOLDOWN_WINDOW    = 8;   // …in the last M iterations…
const COOLDOWN_PENALTY   = 0.1; // …score gets multiplied by this.

function loadLatest() {
    if (!existsSync(LATEST)) throw new Error('no swarm/state/latest.json — run swarm/bin/baseline.mjs first');
    return JSON.parse(readFileSync(LATEST, 'utf8'));
}

function triageJSON(sessionPath) {
    const child = spawnSync('node', ['swarm/bin/triage.mjs', sessionPath, '--json'], {
        cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (child.status !== 0) throw new Error(`triage failed for ${sessionPath}: ${child.stderr}`);
    return JSON.parse(child.stdout)[0];
}

function divergenceHistogramJSON() {
    const child = spawnSync('node', ['swarm/bin/divergence-histogram.mjs', '--json'], {
        cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (child.status !== 0) return [];
    try { return JSON.parse(child.stdout); } catch { return []; }
}

// Map session → number of sessions sharing its divergence site.
function buildLeverageMap() {
    const buckets = divergenceHistogramJSON(); // [{site, count, sessions: [...]}]
    const m = new Map();
    for (const b of buckets) {
        for (const s of b.sessions || []) m.set(s, b.count);
    }
    return m;
}

// Build a cooldown multiplier per session from the journal. Cooldown
// applies at the **divergence-site** level, not the session level:
// place_level (dungeon.c:687) blocks 20 sessions, but they're all
// blocked by the *same* underlying bug — one failed attempt on
// seed0012 should deprioritise ALL place_level victims, forcing the
// swarm to rotate to a different divergence site (role_init etc.) on
// the next iteration.
//
// Returns a Map<session, multiplier>.
function siteKey(c) { return c ? `${c.file}:${c.line}` : null; }

function buildCooldownMap() {
    const events = readAll();
    const iters = events.filter(e => e.event === 'iteration_start');
    const winners = new Set(events.filter(e => e.event === 'iteration_winner').map(e => `${e.iter}::${e.target_session}`));

    const recent = iters.slice(-COOLDOWN_WINDOW);
    const attemptsBySite = new Map();
    const winsBySite = new Map();
    for (const e of recent) {
        const k = siteKey(e.c_caller);
        if (!k) continue;
        attemptsBySite.set(k, (attemptsBySite.get(k) || 0) + 1);
        if (winners.has(`${e.iter}::${e.target_session}`)) {
            winsBySite.set(k, (winsBySite.get(k) || 0) + 1);
        }
    }

    // Map each session to its site's multiplier. Sessions whose
    // divergence site is in cooldown get penalised.
    const sessionToSite = new Map();
    for (const e of iters) sessionToSite.set(e.target_session, siteKey(e.c_caller));

    const m = new Map();
    for (const [session, site] of sessionToSite) {
        if (!site) { m.set(session, 1.0); continue; }
        const att = attemptsBySite.get(site) || 0;
        const won = winsBySite.get(site) || 0;
        if (att >= COOLDOWN_THRESHOLD && won === 0) m.set(session, COOLDOWN_PENALTY);
        else m.set(session, 1.0);
    }
    return m;
}

function rankByLeverage(bundle) {
    const leverage = buildLeverageMap();
    const cooldown = buildCooldownMap();
    return bundle.results
        .filter(r => !r.passed)
        .map(r => {
            const rngFrac = r.metrics.rngCalls.matched / Math.max(1, r.metrics.rngCalls.total);
            const lever = leverage.get(r.session) ?? 1;
            const cool = cooldown.get(r.session) ?? 1;
            const brokenness = Math.max(0.01, 1 - rngFrac);
            const score = lever * brokenness * cool;
            return {
                session: r.session,
                screenMatched: r.metrics.screens.matched,
                screenTotal: r.metrics.screens.total,
                rngMatched: r.metrics.rngCalls.matched,
                rngTotal: r.metrics.rngCalls.total,
                rngFrac,
                leverage: lever,
                cooldown: cool,
                score,
            };
        })
        .sort((a, b) => b.score - a.score || a.rngTotal - b.rngTotal);
}

function rankByClosest(bundle) {
    return bundle.results
        .filter(r => !r.passed)
        .map(r => ({
            session: r.session,
            screenMatched: r.metrics.screens.matched,
            screenTotal: r.metrics.screens.total,
            rngMatched: r.metrics.rngCalls.matched,
            rngTotal: r.metrics.rngCalls.total,
            rngFrac: r.metrics.rngCalls.matched / Math.max(1, r.metrics.rngCalls.total),
        }))
        .sort((a, b) => {
            const fa = a.rngFrac, fb = b.rngFrac;
            if (Math.abs(fa - fb) > 0.01) return fb - fa;
            return a.rngTotal - b.rngTotal;
        });
}

async function main() {
    const args = process.argv.slice(2);
    const json = args.includes('--json');
    const topArg = args.find(a => a.startsWith('--top='));
    const top = topArg ? parseInt(topArg.split('=')[1], 10) : 1;
    const strategyArg = (args.find(a => a.startsWith('--strategy=')) || '--strategy=leverage').split('=')[1];

    const bundle = loadLatest();
    const ranked = strategyArg === 'closest-to-passing' ? rankByClosest(bundle) : rankByLeverage(bundle);

    if (ranked.length === 0) { console.log('All sessions passing!'); return; }

    const picks = ranked.slice(0, top);
    const tasks = [];
    for (const p of picks) {
        const sessionPath = join(REPO_ROOT, 'sessions', p.session);
        const triage = triageJSON(sessionPath);
        const task = buildPorterTask(triage);
        task._candidate_rank = {
            strategy: strategyArg,
            score: p.score ?? null,
            leverage: p.leverage ?? null,
            cooldown: p.cooldown ?? null,
            screenMatched: p.screenMatched,
            screenTotal: p.screenTotal,
            rngFrac: p.rngFrac,
            rngTotal: p.rngTotal,
        };
        tasks.push(task);
    }

    if (json) { console.log(JSON.stringify(tasks, null, 2)); return; }

    console.log(`Top ${top} candidate(s) [strategy=${strategyArg}]:\n`);
    for (const p of picks) {
        const detail = strategyArg === 'leverage'
            ? `lever ${p.leverage}× cool ${p.cooldown}× = score ${p.score.toFixed(2)}`
            : `RNG ${(100 * p.rngFrac).toFixed(2)}%`;
        console.log(`  ${p.session}`);
        console.log(`    ${detail}`);
        console.log(`    RNG ${p.rngMatched}/${p.rngTotal}, Screens ${p.screenMatched}/${p.screenTotal}`);
        console.log('');
    }
    console.log('— Next task —\n');
    console.log(renderPorterPrompt(tasks[0]));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
