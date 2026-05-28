#!/usr/bin/env node
// manifest.mjs — generates swarm/state/manifest.json mapping each C file
// to its target JS file, plus extracted function symbols and (best-effort)
// triage hints.
//
// Used by:
//   - triager: maps "rn2(N) @ fn(file.c:line)" → swarm/manifest → js/file.js
//   - orchestrator: assigns porter tasks, tracks port coverage
//   - refactor agent: knows the canonical js-file layout to keep
//
// One JS file per C file, named identically (foo.c → js/foo.js). This is
// the cheapest mapping for the Phase 2 diff penalty — when upstream 5.1
// modifies foo.c, our porter knows exactly where to look.

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { REPO_ROOT, SWARM_ROOT } from '../lib/state.mjs';

const UPSTREAM = join(REPO_ROOT, 'nethack-c/upstream');
const SRC = join(UPSTREAM, 'src');
const INC = join(UPSTREAM, 'include');
const JS = join(REPO_ROOT, 'js');
const OUT = join(SWARM_ROOT, 'state/manifest.json');

// Lightweight C function-definition matcher: lines starting at column 0
// that look like a function header. Catches K&R-style `void foo(...)` and
// modern `static int bar(int x)`. Doesn't try to be a real parser.
const FN_RE = /^(?!#)(?:static\s+|extern\s+|inline\s+|const\s+|struct\s+\w+\s*\*?\s*|[\w*\s]+?)?([A-Za-z_][\w]*)\s*\([^)]*\)\s*(\{|$)/;

function scanCFile(path) {
    const text = readFileSync(path, 'utf8');
    const lines = text.split('\n');
    const fns = [];
    const includes = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('#include')) {
            const m = line.match(/#include\s+[<"]([^>"]+)[>"]/);
            if (m) includes.push(m[1]);
            continue;
        }
        // function definition: identifier( ... ) and either { at end of
        // this line or next non-blank line
        if (/^[A-Za-z_]/.test(line) && line.includes('(')) {
            // skip prototypes that end with ;
            if (/;\s*$/.test(line)) continue;
            const m = line.match(/^[\w\s*]*?\b([A-Za-z_][\w]*)\s*\(/);
            if (m && !/^(if|while|for|switch|return|sizeof)$/.test(m[1])) {
                // look at next non-blank line for opening brace
                let j = i + 1;
                while (j < lines.length && lines[j].trim() === '') j++;
                if (j < lines.length && (lines[j].startsWith('{') || line.includes('{'))) {
                    fns.push({ name: m[1], line: i + 1 });
                }
            }
        }
    }
    return { fns, includes, totalLines: lines.length };
}

function buildManifest() {
    const cFiles = readdirSync(SRC).filter(f => f.endsWith('.c')).sort();
    const hFiles = readdirSync(INC).filter(f => f.endsWith('.h')).sort();

    const ports = {};
    for (const cf of cFiles) {
        const path = join(SRC, cf);
        const { fns, includes, totalLines } = scanCFile(path);
        const jsName = cf.replace(/\.c$/, '.js');
        const jsPath = join(JS, jsName);
        const exists = existsSync(jsPath);
        const jsLines = exists ? readFileSync(jsPath, 'utf8').split('\n').length : 0;
        // Coverage heuristic: if JS file is missing → unported. If present
        // but tiny relative to C → partial. Refined by manual porting.
        let status;
        if (!exists) status = 'unported';
        else if (jsLines < totalLines * 0.25) status = 'partial';
        else status = 'in-progress';
        ports[cf] = {
            c_file: `nethack-c/upstream/src/${cf}`,
            js_file: `js/${jsName}`,
            js_exists: exists,
            c_lines: totalLines,
            js_lines: jsLines,
            status,
            n_functions: fns.length,
            functions: fns,
            includes,
        };
    }

    return {
        generated_at: new Date().toISOString(),
        c_files: cFiles.length,
        h_files: hFiles.length,
        ports,
    };
}

function main() {
    const m = buildManifest();
    writeFileSync(OUT, JSON.stringify(m, null, 2));
    const unported = Object.values(m.ports).filter(p => p.status === 'unported').length;
    const partial = Object.values(m.ports).filter(p => p.status === 'partial').length;
    const inProgress = Object.values(m.ports).filter(p => p.status === 'in-progress').length;
    const cLines = Object.values(m.ports).reduce((a, p) => a + p.c_lines, 0);
    const jsLines = Object.values(m.ports).reduce((a, p) => a + p.js_lines, 0);
    console.log(`Wrote ${OUT}`);
    console.log(`  C files: ${m.c_files} (${cLines.toLocaleString()} lines)`);
    console.log(`  H files: ${m.h_files}`);
    console.log(`  JS coverage by file: ${inProgress} in-progress, ${partial} partial, ${unported} unported`);
    console.log(`  JS lines / C lines: ${jsLines.toLocaleString()} / ${cLines.toLocaleString()} (${(100 * jsLines / cLines).toFixed(1)}%)`);
}

main();
