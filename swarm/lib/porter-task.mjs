// porter-task.mjs — builds a self-contained task spec for a porter agent.
//
// Given a triage result (session + first-divergence pointer), assembles:
//   - the C source slice around the diverging call (function body + a
//     window of surrounding lines)
//   - the current JS file content (or a "create new" note)
//   - the failing session id + a short hint about what to verify
//   - acceptance criteria (improve target session, no regressions)
//
// The output is a plain JSON object the orchestrator hands to N parallel
// porter agents. Each porter writes JS in its own worktree and reports a
// score delta; the orchestrator picks the winner.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { REPO_ROOT, SWARM_ROOT } from './state.mjs';

const UPSTREAM_SRC = join(REPO_ROOT, 'nethack-c/upstream/src');
const JS_DIR = join(REPO_ROOT, 'js');
const MANIFEST_PATH = join(SWARM_ROOT, 'state/manifest.json');

function loadManifest() {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

// Extract a window of C source: the diverging function's full body (best
// effort via manifest line numbers), plus N lines of leading context.
function extractCSlice(cFile, lineNum, contextBefore = 50, contextAfter = 200) {
    const path = join(UPSTREAM_SRC, cFile);
    if (!existsSync(path)) return null;
    const text = readFileSync(path, 'utf8');
    const lines = text.split('\n');
    const startIdx = Math.max(0, lineNum - 1 - contextBefore);
    const endIdx = Math.min(lines.length, lineNum - 1 + contextAfter);
    const slice = lines.slice(startIdx, endIdx);
    return {
        path: `nethack-c/upstream/src/${cFile}`,
        startLine: startIdx + 1,
        endLine: endIdx,
        pivotLine: lineNum,
        text: slice.map((l, i) => `${String(startIdx + i + 1).padStart(5)}  ${l}`).join('\n'),
    };
}

// Find the enclosing function (highest fn.line ≤ lineNum) so the porter
// has the full function name to grep for, not just file:line.
function enclosingFunction(manifest, cFile, lineNum) {
    const port = manifest.ports[cFile];
    if (!port) return null;
    let best = null;
    for (const fn of port.functions) {
        if (fn.line <= lineNum && (!best || fn.line > best.line)) best = fn;
    }
    return best;
}

// Build a "file-port" task: port the entire C file to JS, function by
// function. Used by bulk-port.mjs for whole-file transpilation in
// parallel — cheaper per-line than divergence-driven fixes once a file
// is on the critical path.
//
// `cFile` is interpreted relative to nethack-c/upstream/src/ by default,
// but can also be a path like `win/tty/topl.c` for files outside src/.
export function buildFilePortTask(cFile, { includeHeaders = true } = {}) {
    const m = loadManifest();
    // Find the C file: try src/, then upstream root for explicit paths.
    let cPath = join(UPSTREAM_SRC, cFile);
    if (!existsSync(cPath)) {
        const altPath = join(REPO_ROOT, 'nethack-c/upstream', cFile);
        if (existsSync(altPath)) cPath = altPath;
        else throw new Error(`C source missing: ${cFile} (tried ${UPSTREAM_SRC}/${cFile} and nethack-c/upstream/${cFile})`);
    }
    // Manifest only covers src/*.c. For files outside src/ we build a
    // minimal port record on the fly.
    const port = m.ports[cFile] || {
        c_file: `nethack-c/upstream/${cFile.startsWith('src/') || !cFile.includes('/') ? `src/${cFile.replace(/^src\//, '')}` : cFile}`,
        js_file: `js/${cFile.split('/').pop().replace(/\.c$/, '.js')}`,
        status: 'unported',
        n_functions: 0,
        functions: [],
        includes: [],
    };
    const cText = readFileSync(cPath, 'utf8');
    const jsFile = port.js_file;
    const js = loadJsFile(jsFile);

    // Pull in headers the C file #includes (limited to the ones in
    // nethack-c/upstream/include/ — system headers are not useful).
    const headerTexts = {};
    if (includeHeaders) {
        const includeDir = join(REPO_ROOT, 'nethack-c/upstream/include');
        for (const inc of port.includes || []) {
            const hPath = join(includeDir, inc);
            if (existsSync(hPath)) {
                const t = readFileSync(hPath, 'utf8');
                if (t.length < 200_000) headerTexts[inc] = t;
            }
        }
    }

    return {
        kind: 'file-port',
        c_file: cFile,
        c_path: `nethack-c/upstream/src/${cFile}`,
        c_lines: cText.split('\n').length,
        c_text: cText,
        headers: headerTexts,
        target_js_file: jsFile,
        target_js_exists: js.exists,
        target_js_text: js.text,
        target_js_size_bytes: js.text ? js.text.length : 0,
        manifest_port_status: port.status,
        n_functions: port.n_functions,
        functions: port.functions,
    };
}

function loadJsFile(jsFile) {
    const path = join(REPO_ROOT, jsFile);
    if (!existsSync(path)) return { path, exists: false, text: null };
    return { path, exists: true, text: readFileSync(path, 'utf8') };
}

export function buildPorterTask(triageResult, { contextBefore = 50, contextAfter = 200 } = {}) {
    const m = loadManifest();
    const div = triageResult.rngDivergence;
    if (!div || !div.caller) {
        return {
            kind: 'unmappable',
            session: triageResult.session,
            reason: triageResult.summary,
            triage: triageResult,
        };
    }

    const { fn: cFn, file: cFile, line: cLine } = div.caller;
    const port = m.ports[cFile];
    const jsFile = port?.js_file || `js/${cFile.replace(/\.c$/, '.js')}`;

    const cSlice = extractCSlice(cFile, cLine, contextBefore, contextAfter);
    const enclosing = enclosingFunction(m, cFile, cLine);
    const js = loadJsFile(jsFile);

    return {
        kind: 'rng-divergence',
        session: triageResult.session,
        rng_index: div.index,
        c_expected: div.cEntry,
        js_actual: div.jsEntry,
        c_caller: { fn: cFn, file: cFile, line: cLine },
        c_enclosing_function: enclosing,
        c_slice: cSlice,
        target_js_file: jsFile,
        target_js_exists: js.exists,
        target_js_size_bytes: js.text ? js.text.length : 0,
        manifest_port_status: port?.status || 'unknown',
        context_rng_c: div.contextC,
        context_rng_js: div.contextJs,
    };
}

// Render a porter task into a markdown prompt body suitable for handing
// to a Claude subagent. The orchestrator wraps this with system-prompt
// boilerplate (the porter contract — see swarm/bin/orchestrator.mjs).
export function renderPorterPrompt(task) {
    if (task.kind === 'unmappable') {
        return `Triage produced no actionable C location for session ${task.session}.\nReason: ${task.reason}\n\nThis task should be re-triaged manually.`;
    }
    if (task.kind === 'file-port') return renderFilePortPrompt(task);

    const parts = [];
    parts.push(`# Porter Task: ${task.c_caller.fn} (${task.c_caller.file}:${task.c_caller.line})\n`);
    parts.push(`## What's failing\n`);
    parts.push(`Session: \`${task.session}\``);
    parts.push(`At PRNG call #${task.rng_index}:`);
    parts.push(`  C produced:  \`${task.c_expected}\``);
    parts.push(`  JS produced: \`${task.js_actual}\``);
    parts.push(`\nThis means the JS port of \`${task.c_caller.fn}\` is either missing or computes different arguments to the PRNG call at \`${task.c_caller.file}:${task.c_caller.line}\`.\n`);

    parts.push(`## PRNG context (last few calls before divergence)`);
    parts.push('```');
    parts.push(`C:  ${task.context_rng_c.join('\n    ')}`);
    parts.push(`JS: ${task.context_rng_js.join('\n    ')}`);
    parts.push('```\n');

    if (task.c_enclosing_function) {
        parts.push(`## Enclosing C function`);
        parts.push(`\`${task.c_enclosing_function.name}()\` starts at \`${task.c_caller.file}:${task.c_enclosing_function.line}\`\n`);
    }

    parts.push(`## C source slice (\`${task.c_caller.file}\` lines ${task.c_slice.startLine}–${task.c_slice.endLine}, pivot=${task.c_slice.pivotLine})`);
    parts.push('```c');
    parts.push(task.c_slice.text);
    parts.push('```\n');

    parts.push(`## Target JS file`);
    parts.push(`\`${task.target_js_file}\` — ${task.target_js_exists ? `exists (${task.target_js_size_bytes} bytes)` : 'DOES NOT EXIST — create it'}`);
    parts.push(`Port status per manifest: ${task.manifest_port_status}\n`);

    parts.push(`## Acceptance criteria`);
    parts.push(`1. After your edit, \`node frozen/ps_test_runner.mjs sessions/${task.session}\` must show strictly more matched RNG calls than before (currently divergent at call ${task.rng_index}).`);
    parts.push(`2. \`bash frozen/score.sh\` must show NO REGRESSION on any other session. Even one screen lost on another session blocks the merge.`);
    parts.push(`3. Keep JS structure parallel to C: same file name (\`${task.target_js_file}\`), same function names, same call order. This protects the Phase 2 diff budget.`);
    parts.push(`4. Do not modify frozen files (\`js/isaac64.js\`, \`js/terminal.js\`, \`js/storage.js\`).\n`);

    parts.push(`## How to verify locally`);
    parts.push('```bash');
    parts.push(`node frozen/ps_test_runner.mjs sessions/${task.session}`);
    parts.push(`node swarm/bin/triage.mjs sessions/${task.session}`);
    parts.push(`bash frozen/score.sh    # full regression check before declaring done`);
    parts.push('```');

    // Prior attempts: splice in what the swarm has already tried on this
    // target. If learn.mjs has nothing, this is a single "(first try)" line.
    try {
        const prior = execSync(`node ${join(SWARM_ROOT, 'bin/learn.mjs')} --prior=${task.session}`, {
            cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
        }).trim();
        if (prior) {
            parts.push('');
            parts.push(prior);
        }
    } catch (_) { /* learn.mjs missing or journal empty — skip */ }

    // Learnings: the analyst-distilled patterns across all prior swarm
    // activity. Splices in when swarm/state/learnings.md exists.
    try {
        const learningsPath = join(SWARM_ROOT, 'state/learnings.md');
        if (existsSync(learningsPath)) {
            const text = readFileSync(learningsPath, 'utf8').trim();
            if (text) {
                parts.push('');
                parts.push('## Cross-swarm learnings (auto-distilled, refreshed periodically)');
                parts.push(text);
                parts.push('');
                parts.push('**Use these patterns to inform your approach. If a section recommends a specific tactic, default to it unless you have a concrete reason to deviate.**');
            }
        }
    } catch (_) { /* missing or empty — skip */ }

    return parts.join('\n');
}

// Render a file-port task — the porter's job is to transpile the entire
// C file to JS, preserving function-by-function correspondence. Score
// gate is the same as the divergence-driven porter: improve some
// session, regress none.
function renderFilePortPrompt(task) {
    const parts = [];
    parts.push(`# Porter Task: full-file port of \`${task.c_file}\`\n`);
    parts.push(`## What this is`);
    parts.push(`This is a **whole-file transpilation** task, not a divergence fix. Your job is to produce a JavaScript port of the entire C file \`${task.c_path}\` (${task.c_lines.toLocaleString()} lines, ${task.n_functions} functions) by translating it function-by-function into \`${task.target_js_file}\`.`);
    parts.push('');
    parts.push(`The point of doing this at file granularity rather than per-divergence: NetHack's call graph has many functions that *call* unported code. If only one function lands in JS at a time, callers fall straight off the cliff. A coherent whole-file port keeps internal calls inside the JS world and unblocks downstream RNG and screen progress all at once.`);
    parts.push('');
    parts.push(`## Acceptance criteria (mechanical — a merge gate runs after you finish)`);
    parts.push(`1. \`bash frozen/score.sh\` must show **strictly more matched RNG calls or screens** than before. Even one extra RNG call is acceptance-worthy.`);
    parts.push(`2. **Zero regressions on any session.** If even one session loses a single screen or RNG match, the merge gate rejects. Verify locally.`);
    parts.push(`3. Write the JS to **\`${task.target_js_file}\`** (overwriting if it exists). Keep one JS function per C function, with the same name. This is load-bearing for the Phase 2 diff penalty — when upstream changes a C function, our porter has a 1:1 mapping to find the JS counterpart.`);
    parts.push(`4. Do not modify any frozen file (\`js/isaac64.js\`, \`js/terminal.js\`, \`js/storage.js\`).`);
    parts.push(`5. Do not modify \`swarm/\` or \`frozen/\` directories.`);
    parts.push(`6. If your port needs symbols from other unported C files, **stub them inline at the top of \`${task.target_js_file}\`** with TODO comments — do NOT create or modify other JS files. The next porter will fill those in.`);
    parts.push(`7. Strongly prefer to import shared infrastructure from existing JS rather than reinvent it: \`./rng.js\` for PRNG (rn2/rnd/d/rne/rnz), \`./gstate.js\` for the global game state, \`./hacklib.js\` for hacklib helpers.`);
    parts.push('');
    parts.push(`## C source (${task.c_path}, ${task.c_lines.toLocaleString()} lines)`);
    parts.push('```c');
    parts.push(task.c_text);
    parts.push('```');
    parts.push('');

    if (Object.keys(task.headers || {}).length) {
        parts.push(`## Headers this file #includes (for reference)`);
        for (const [name, text] of Object.entries(task.headers)) {
            if (!/extern\.h|decl\.h|hack\.h|monst\.h|obj\.h|rm\.h|you\.h|dungeon\.h|context\.h|trap\.h|color\.h/.test(name) && text.length > 30_000) continue;
            parts.push(`\n### \`include/${name}\` (${text.split('\n').length} lines)`);
            parts.push('```c');
            parts.push(text.slice(0, 30_000));
            if (text.length > 30_000) parts.push('... [truncated]');
            parts.push('```');
        }
        parts.push('');
    }

    parts.push(`## Existing \`${task.target_js_file}\``);
    if (task.target_js_exists) {
        parts.push(`Existing file is ${task.target_js_size_bytes} bytes. **Read it before overwriting** — your port must preserve whatever the existing file does correctly (it may be from a prior partial port or from the skeleton).`);
        parts.push('');
        parts.push('```js');
        parts.push(task.target_js_text);
        parts.push('```');
    } else {
        parts.push(`Does not exist — create it.`);
    }
    parts.push('');

    parts.push(`## How to verify`);
    parts.push('```bash');
    parts.push(`bash frozen/score.sh    # full 44-session regression check`);
    parts.push(`node swarm/bin/orchestrator.mjs learn  # see swarm-wide stats`);
    parts.push('```');
    parts.push('');
    parts.push(`When you finish, end your reply with a one-paragraph summary stating which C functions you ported, before/after RNG and screen totals (from \`bash frozen/score.sh\`), and any sessions that regressed.`);

    // Splice in cross-swarm learnings just like the divergence porter prompt.
    try {
        const learningsPath = join(SWARM_ROOT, 'state/learnings.md');
        if (existsSync(learningsPath)) {
            const text = readFileSync(learningsPath, 'utf8').trim();
            if (text) {
                parts.push('');
                parts.push('## Cross-swarm learnings (auto-distilled, refreshed periodically)');
                parts.push(text);
                parts.push('');
                parts.push('**Use these patterns to inform your approach.**');
            }
        }
    } catch (_) {}

    return parts.join('\n');
}
