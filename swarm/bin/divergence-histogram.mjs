#!/usr/bin/env node
// divergence-histogram.mjs — counts how many sessions first diverge at
// each unique C call-site. The headline diagnostic for prioritising
// porter work: a high-count site, when fixed, unlocks many sessions
// simultaneously.
//
// Usage:
//   node swarm/bin/divergence-histogram.mjs
//   node swarm/bin/divergence-histogram.mjs --json

import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';
import { REPO_ROOT } from '../lib/state.mjs';

function main() {
    const json = process.argv.includes('--json');
    const dir = join(REPO_ROOT, 'sessions');
    const sessions = readdirSync(dir).filter(f => f.endsWith('.session.json')).sort();
    const buckets = new Map(); // key → { count, sessions:[], caller }

    for (const s of sessions) {
        try {
            const out = execSync(`node swarm/bin/triage.mjs sessions/${s} --json`, {
                cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
            });
            const t = JSON.parse(out)[0];
            let key;
            if (t.jsError) key = `(runtime error: ${t.jsError.split('\n')[0]})`;
            else if (t.rngDivergence?.caller) {
                const c = t.rngDivergence.caller;
                key = `${c.fn} (${c.file}:${c.line})`;
            } else if (t.rngDivergence) key = '(rng diverges, no caller annotation)';
            else if (t.screenDivergence) key = `(rng matches; screen diverges at step ${t.screenDivergence.index})`;
            else key = '(fully matching)';
            if (!buckets.has(key)) buckets.set(key, { count: 0, sessions: [], caller: t.rngDivergence?.caller || null });
            const b = buckets.get(key);
            b.count++;
            b.sessions.push(s);
        } catch (e) {
            const key = `(triage threw: ${e.message.split('\n')[0]})`;
            if (!buckets.has(key)) buckets.set(key, { count: 0, sessions: [], caller: null });
            buckets.get(key).count++;
            buckets.get(key).sessions.push(s);
        }
    }

    const ranked = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);

    if (json) {
        console.log(JSON.stringify(ranked.map(([k, v]) => ({ site: k, count: v.count, sessions: v.sessions, caller: v.caller })), null, 2));
        return;
    }

    console.log(`Divergence-site histogram across ${sessions.length} public sessions:\n`);
    for (const [k, v] of ranked) {
        console.log(`  ${String(v.count).padStart(3)}  ${k}`);
    }
    console.log(`\nTop priorities (most sessions unlocked per fix):`);
    for (const [k, v] of ranked.slice(0, 5)) {
        if (v.caller) console.log(`  ${v.count} sessions: edit js/${v.caller.file.replace(/\.c$/, '.js')} → port ${v.caller.fn}()`);
    }
}

main();
