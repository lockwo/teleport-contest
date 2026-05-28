#!/usr/bin/env node
// baseline.mjs — runs score.sh, saves the bundle, prints a delta vs. the
// previous baseline (if any). The orchestrator uses this on every merge.

import { writeFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { SWARM_ROOT, REPO_ROOT, load, save, recordRunBundle } from '../lib/state.mjs';
import { runScoreAll, summarize, diffBundles, loadBundleFromFile } from '../lib/score.mjs';

const STATE_DIR = join(SWARM_ROOT, 'state');
const BASELINE = join(STATE_DIR, 'baseline.json');
const LATEST   = join(STATE_DIR, 'latest.json');

async function main() {
    mkdirSync(STATE_DIR, { recursive: true });
    const args = process.argv.slice(2);
    const promote = args.includes('--promote');   // overwrite baseline with this run

    const prev = existsSync(BASELINE) ? loadBundleFromFile(BASELINE) : null;
    console.log('Running score.sh ...');
    const t0 = Date.now();
    const bundle = runScoreAll();
    const dt = ((Date.now() - t0) / 1000).toFixed(1);

    writeFileSync(LATEST + '.tmp', JSON.stringify(bundle));
    renameSync(LATEST + '.tmp', LATEST);

    const s = summarize(bundle);
    console.log(`[${dt}s] commit ${s.commit}`);
    console.log(`  Screens: ${s.screens}`);
    console.log(`  RNG    : ${s.rng}`);
    console.log(`  Passing: ${s.passing}`);

    if (prev) {
        const d = diffBundles(prev, bundle);
        console.log(`  vs baseline: screens ${d.screensDelta >= 0 ? '+' : ''}${d.screensDelta}, rng ${d.rngDelta >= 0 ? '+' : ''}${d.rngDelta}`);
        if (d.regressions.length) {
            console.log(`  REGRESSIONS (${d.regressions.length}):`);
            for (const r of d.regressions) console.log(`    ${r.session}: ${r.prev}→${r.next} (${r.delta})`);
        }
        if (d.improvements.length) {
            console.log(`  improvements (${d.improvements.length}):`);
            for (const r of d.improvements.slice(0, 10)) console.log(`    ${r.session}: ${r.prev}→${r.next} (+${r.delta})`);
            if (d.improvements.length > 10) console.log(`    ... and ${d.improvements.length - 10} more`);
        }
    }

    if (promote || !prev) {
        writeFileSync(BASELINE + '.tmp', JSON.stringify(bundle));
        renameSync(BASELINE + '.tmp', BASELINE);
        console.log(`  baseline ${prev ? 'promoted' : 'initialized'}`);
    }

    const state = load();
    recordRunBundle(state, bundle);
    save(state);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
