// oracle.mjs — Differential STATE ORACLE for the JS NetHack port.
//
// Pinpoints the FIRST input-boundary where our JS game state diverges from
// the recorded C game state, with full provenance: step#, rng-call#, which
// entity (m_id / species), which field (mx/my/mhp/mflee/uhp/...), the C
// value vs the JS value, and the C rng-callsite(s) around that boundary
// (from the canonical session's rng trace) next to our JS rng-log entries.
//
// Usage:
//   node scripts/oracle.mjs <session.json>          # one-session fix-this report
//   node scripts/oracle.mjs <session.json> --json    # machine-readable JSON
//   node scripts/oracle.mjs --summary                # campaign map (all sessions)
//   node scripts/oracle.mjs --summary --json
//
// Inputs:
//   * sessions/<name>.session.json   — canonical C recording (byte-exact;
//                                       authoritative for rng# + callsites).
//   * /private/tmp/gt/seed<N>.state.jsonl — C per-boundary STATE dump from
//                                       the NHGT recorder (full fmon chain +
//                                       hero hp/multi).  One file per segment
//                                       seed.  Falls back to .monsters.jsonl.
//   * our JS port (runSegment with NHJSDUMP=1) — getStateDumps().
//
// Alignment: the C state dump, the canonical session steps, and our JS
// getStateDumps() all fire at the SAME input boundaries, so they align 1:1
// by step index.  We additionally cross-check the C-recorder's rng# against
// the canonical session's cumulative rng (the C recorder is not yet
// byte-exact in chargen — see MEMORY rng[303]); the first step where they
// disagree is reported as the "C-recorder rng-validity horizon" so a fixer
// knows how far the state.jsonl can be trusted as ground truth.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.REPO_ROOT || process.cwd();
const GT_DIR = process.env.NHGT_DIR || '/private/tmp/gt';

const { normalizeSession } = await import(join(ROOT, 'frozen/session_loader.mjs'));

// ── small helpers ──────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);

const slugOf = (name) => String(name).split('/').pop().replace(/\.session\.json$/, '');

// seed -> set of session slugs that use it (any segment). Two sessions can
// share a seed (e.g. seed0013), which makes the flat seed-named GT ambiguous.
let _seedIndex = null;
function seedIndex() {
    if (_seedIndex) return _seedIndex;
    _seedIndex = new Map();
    const dir = join(ROOT, 'sessions');
    let files = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.session.json')); } catch { return _seedIndex; }
    for (const f of files) {
        let segs;
        try { segs = normalizeSession(JSON.parse(readFileSync(join(dir, f), 'utf8'))).segments; } catch { continue; }
        const slug = slugOf(f);
        for (const seg of segs) {
            if (!_seedIndex.has(seg.seed)) _seedIndex.set(seg.seed, new Set());
            _seedIndex.get(seg.seed).add(slug);
        }
    }
    return _seedIndex;
}

function readJsonl(p, kind, scoped) {
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    return { path: p, kind, scoped, rows: lines.map((l) => JSON.parse(l)) };
}

// Load the C ground truth for one session segment.  Keyed by SESSION (slug),
// not by seed: prefer GT_DIR/<slug>/seed<N>.* so two sessions that share a seed
// never silently compare against each other's recording.  The legacy flat
// GT_DIR/seed<N>.* is used only when that seed belongs to exactly ONE session;
// when it is shared we REFUSE the flat file and return {ambiguous} so the
// caller reports "record session-scoped GT" instead of trusting the wrong one.
function loadStateJsonl(slug, seed) {
    for (const ext of ['state', 'monsters']) {
        const p = join(GT_DIR, slug, `seed${seed}.${ext}.jsonl`);
        if (existsSync(p)) return readJsonl(p, ext, true);
    }
    const sharers = seedIndex().get(seed);
    const ambiguous = sharers && sharers.size > 1;
    for (const ext of ['state', 'monsters']) {
        const p = join(GT_DIR, `seed${seed}.${ext}.jsonl`);
        if (existsSync(p)) {
            if (ambiguous) return { ambiguous: true, sharedWith: [...sharers], flatPath: p };
            return readJsonl(p, ext, false);
        }
    }
    return null;
}

// Build a m_id -> monster map for one state row.
function byMid(row) {
    const m = new Map();
    for (const mon of row.mons || []) m.set(mon.m_id, mon);
    return m;
}

// Fields compared per monster.  Order matters: first listed field that
// differs is reported.  We compare SPECIES by name (the human-meaningful
// identity) first — a true species mismatch makes every other field noise.
// The numeric pmidx is compared LAST: when names match but pm differs it is
// a pmidx-enumeration offset (e.g. a missing/extra PM_ entry), reported with
// a hint rather than as a species change.  Position, hp, then flag bits in
// between.
const MON_FIELDS = ['name', 'mx', 'my', 'mhp', 'mhpmax', 'mtame', 'mpeaceful',
                    'mflee', 'mfleetim', 'mfrozen', 'msleeping', 'mcanmove', 'pm'];
const HERO_FIELDS_FULL = ['ux', 'uy', 'uhp', 'uhpmax', 'multi'];
const HERO_FIELDS_MIN = ['ux', 'uy']; // .monsters.jsonl lacks uhp/uhpmax/multi

// Compare one C state row to one JS dump row.  Returns the first divergence
// {scope, entity, field, c, js} or null if they match on all compared fields.
function diffRow(cRow, jRow, heroFields, ignore = EMPTY_SET) {
    // Hero first.
    for (const f of heroFields) {
        if (ignore.has(f)) continue;
        const cv = cRow[f] ?? 0, jv = jRow[f] ?? 0;
        if (cv !== jv) return { scope: 'hero', entity: 'hero', field: f, c: cv, js: jv };
    }
    // Monsters keyed by m_id (chain order can differ without being a bug;
    // identity is m_id).  Report (a) a monster C has that JS lacks, (b) a
    // monster JS has that C lacks, (c) a field mismatch on a shared m_id.
    const cMap = byMid(cRow), jMap = byMid(jRow);
    // Walk C's chain order for deterministic "which monster" reporting.
    for (const cm of cRow.mons || []) {
        const jm = jMap.get(cm.m_id);
        if (!jm) {
            if (ignore.has('PRESENT')) continue;
            return { scope: 'mon', entity: monLabel(cm), m_id: cm.m_id, field: 'PRESENT',
                     c: `present @${cm.mx},${cm.my}`, js: 'ABSENT (not in JS fmon)' };
        }
        for (const f of MON_FIELDS) {
            if (ignore.has(f)) continue;
            const cv = cm[f] ?? 0, jv = jm[f] ?? 0;
            if (cv !== jv) {
                return { scope: 'mon', entity: monLabel(cm), m_id: cm.m_id, field: f, c: cv, js: jv };
            }
        }
    }
    for (const jm of jRow.mons || []) {
        if (!cMap.has(jm.m_id)) {
            if (ignore.has('PRESENT')) continue;
            return { scope: 'mon', entity: monLabel(jm), m_id: jm.m_id, field: 'PRESENT',
                     c: 'ABSENT (not in C fmon)', js: `present @${jm.mx},${jm.my}` };
        }
    }
    // monster count sanity (e.g. duplicate m_id, ordering-only difference)
    if (!ignore.has('nmon') &&
        (cRow.nmon ?? (cRow.mons || []).length) !== (jRow.nmon ?? (jRow.mons || []).length)) {
        return { scope: 'mon', entity: 'fmon', m_id: null, field: 'nmon',
                 c: cRow.nmon, js: jRow.nmon };
    }
    return null;
}

const EMPTY_SET = new Set();

function monLabel(m) {
    return `${m.name || `pm${m.pm}`}#${m.m_id}`;
}

// ── run our JS port for one session, concatenating per-segment dumps ────────
async function runJs(session) {
    process.env.NHJSDUMP = '1'; // enable the jsmain.js state dumper
    const { runSegment } = await import(join(ROOT, 'js/jsmain.js'));
    const segs = normalizeSession(session).segments;
    const out = [];
    for (const seg of segs) {
        const storage = new Map();
        const sh = {
            getItem: (k) => (storage.has(k) ? storage.get(k) : null),
            setItem: (k, v) => storage.set(k, String(v)),
            removeItem: (k) => storage.delete(k),
            get length() { return storage.size; },
            key(i) { let n = 0; for (const k of storage.keys()) { if (n === i) return k; n++; } return null; },
        };
        let g;
        try {
            g = await runSegment({ seed: seg.seed, datetime: seg.datetime,
                                   nethackrc: seg.nethackrc, moves: seg.moves, storage: sh });
        } catch (e) {
            out.push({ seg, dumps: [], rngLog: [], error: String(e?.message || e) });
            continue;
        }
        out.push({ seg, dumps: g.getStateDumps?.() || [], rngLog: g.getRngLog?.() || [],
                   rngSlices: g.getRngSlices?.() || [] });
    }
    return out;
}

// First boundary index where the hero is on the map (ux>0) — the start of
// the game proper, AFTER all chargen sub-prompts.  The C recorder dumps one
// row per tty_nhgetch, which INCLUDES chargen menu prompts (role/race/gender/
// align, "Shall I pick…", --More--), so the C state.jsonl has a variable
// number of leading rows the canonical session + JS dumps don't.  Anchoring
// on first-hero-placed trims that front offset without relying on a
// byte-exact rng count (the C recorder is not yet byte-exact; MEMORY rng[303]).
function firstHeroPlaced(rows, getUx) {
    for (let i = 0; i < rows.length; i++) if ((getUx(rows[i]) | 0) > 0) return i;
    return 0;
}

// ── core diff for one segment ───────────────────────────────────────────────
// Aligns C state.jsonl rows to JS dumps (and canonical steps) by a detected
// front anchor (first-hero-placed), then walks boundaries in lockstep.
// Returns { firstDiff, rngHorizon, nC, nJS, cKind, cAnchor, jAnchor }.
function diffSegment(seg, jsSeg, cState, opts = {}) {
    const ignore = opts.ignore || EMPTY_SET;
    const fromStep = opts.fromStep || 0;
    const cKind = cState?.kind || null;
    const heroFields = cKind === 'state' ? HERO_FIELDS_FULL : HERO_FIELDS_MIN;
    const cRows = cState?.rows || [];
    const jDumps = jsSeg?.dumps || [];

    // Canonical cumulative rng AFTER step i.  The C state dump (and our JS
    // dump) fire at the input boundary that ENDS step i — i.e. after step i's
    // RNG draws — so C state row i.rng == canonical cum-after-step[i] when the
    // recorder is byte-exact.  (Verified 1814/1814 on seed4500.)
    const steps = seg.steps || [];
    const canonCum = [];
    { let cum = 0; for (const s of steps) { cum += (s.rng || []).length; canonCum.push(cum); } }

    // Front-anchor alignment.  JS dump k (and canonical step k) ↔ C row
    // (cAnchor + (k - jAnchor)).  jAnchor is normally 0 (JS starts capturing
    // post-chargen); cAnchor trims C's leading chargen-prompt rows.
    const jAnchor = firstHeroPlaced(jDumps, (r) => r.ux);
    const cAnchor = firstHeroPlaced(cRows, (r) => r.ux);
    const cOff = cAnchor - jAnchor; // add to a JS/canonical index to get C index

    // C-recorder rng-validity horizon: first aligned boundary where the C
    // state dump's rng# disagrees with the canonical cumulative rng.  This is
    // the trust boundary for state.jsonl (beyond it the C recorder has drifted).
    let rngHorizon = -1;
    for (let k = jAnchor; k < jDumps.length; k++) {
        const ci = k + cOff;
        const cr = cRows[ci]?.rng;
        const cc = canonCum[k];
        if (cr != null && cc != null && cr !== cc) { rngHorizon = k; break; }
    }

    // Walk aligned boundaries from the anchor (or --from step) forward.
    let firstDiff = null;
    const kMax = Math.min(jDumps.length, cRows.length - cOff);
    for (let k = Math.max(jAnchor, fromStep); k < kMax; k++) {
        const ci = k + cOff;
        const d = diffRow(cRows[ci], jDumps[k], heroFields, ignore);
        if (d) {
            firstDiff = {
                step: k,
                cRow: ci,
                cRngCount: cRows[ci].rng,
                jsRngCount: jDumps[k].rng,
                canonCumRng: canonCum[k] ?? null,
                ...d,
            };
            break;
        }
    }
    // If state matched through the overlap but the aligned lengths differ,
    // that's a truncation/over-run divergence.
    const cAligned = cRows.length - cOff;
    if (!firstDiff && cAligned !== jDumps.length) {
        const k = Math.min(cAligned, jDumps.length);
        firstDiff = {
            step: k, cRow: k + cOff,
            cRngCount: cRows[k + cOff]?.rng ?? null,
            jsRngCount: jDumps[k]?.rng ?? null,
            canonCumRng: canonCum[k] ?? null,
            scope: 'length', entity: 'sequence', field: 'nsteps',
            c: cAligned, js: jDumps.length,
        };
    }
    return { firstDiff, rngHorizon, nC: cRows.length, nJS: jDumps.length, cKind,
             cAnchor, jAnchor, cAligned };
}

// Extract the C rng-callsite lines for a given step from the canonical
// session, and the JS rng-log slice for the same step (when available).
function callsiteContext(seg, jsSeg, step, want = 5) {
    const steps = seg.steps || [];
    const cRng = (steps[step]?.rng || []).map((s) => s.replace(/^\d+\s+/, ''));
    // JS slice for this step: prefer getRngSlices (per-step), else derive.
    const jsSlice = (jsSeg?.rngSlices && jsSeg.rngSlices[step]) || [];
    return {
        cCallsites: cRng.slice(0, want),
        cCount: cRng.length,
        jsRng: jsSlice.slice(0, want),
        jsCount: jsSlice.length,
    };
}

// ── one-session report ──────────────────────────────────────────────────────
async function reportOne(sessionFile, asJson, opts = {}) {
    const session = JSON.parse(readFileSync(resolveSession(sessionFile), 'utf8'));
    const segs = normalizeSession(session).segments;
    const jsSegs = await runJs(session);

    const results = [];
    for (let si = 0; si < segs.length; si++) {
        const seg = segs[si];
        const cState = loadStateJsonl(slugOf(sessionFile), seg.seed);
        const jsSeg = jsSegs[si];
        if (!cState || cState.ambiguous) {
            results.push({ seed: seg.seed, missingC: !cState, ambiguous: cState?.ambiguous,
                           sharedWith: cState?.sharedWith, jsError: jsSeg?.error || null });
            continue;
        }
        const d = diffSegment(seg, jsSeg, cState, opts);
        const ctx = d.firstDiff ? callsiteContext(seg, jsSeg, d.firstDiff.step) : null;
        results.push({ seed: seg.seed, cPath: cState.path, cKind: cState.kind,
                       jsError: jsSeg?.error || null, ...d, ctx });
    }

    if (asJson) {
        console.log(JSON.stringify({ session: sessionFile, results }, null, 2));
        return;
    }

    for (const r of results) {
        printFixThis(sessionFile, r);
    }
}

function printFixThis(sessionFile, r) {
    const L = [];
    L.push(`════════ ORACLE: ${sessionFile}  seed=${r.seed} ════════`);
    if (r.missingC || r.ambiguous) {
        const slug = slugOf(sessionFile);
        if (r.ambiguous) {
            L.push(`  AMBIGUOUS GT: flat seed${r.seed}.state.jsonl is shared by ${r.sharedWith.length} sessions ` +
                   `[${r.sharedWith.join(', ')}] — refusing it. Record session-scoped GT at ` +
                   `${GT_DIR}/${slug}/ (NHGT=1 via scripts/record-session.mjs).`);
        } else {
            L.push(`  NO C ground truth at ${GT_DIR}/${slug}/seed${r.seed}.state.jsonl ` +
                   `(or flat ${GT_DIR}/seed${r.seed}.state.jsonl) — re-record with NHGT=1.`);
        }
        if (r.jsError) L.push(`  JS error: ${r.jsError}`);
        console.log(L.join('\n') + '\n');
        return;
    }
    L.push(`  C-source: ${r.cPath} (${r.cKind})   boundaries C=${r.nC} JS=${r.nJS}` +
           (r.cKind === 'monsters' ? '   [hero hp/multi unavailable: .monsters.jsonl]' : ''));
    L.push(`  align: C row ${r.cAnchor} ↔ JS dump ${r.jAnchor} (first hero-placed); ` +
           `${r.cAligned} aligned C boundaries`);
    if (r.rngHorizon >= 0) {
        L.push(`  ⚠ C-recorder rng-validity horizon: step ${r.rngHorizon} ` +
               `(beyond here the C state.jsonl rng# drifts from canonical — see MEMORY rng[303])`);
    } else {
        L.push(`  ✓ C-recorder rng# matches canonical session across the aligned range`);
    }
    if (r.jsError) L.push(`  JS runSegment error: ${r.jsError}`);
    const fd = r.firstDiff;
    if (!fd) {
        L.push(`  ✅ NO STATE DIVERGENCE across ${Math.min(r.nC, r.nJS)} boundaries.`);
        console.log(L.join('\n') + '\n');
        return;
    }
    L.push(`  ── FIRST DIVERGENCE ──`);
    L.push(`  step ${fd.step}   C-rng#=${fd.cRngCount}  JS-rng#=${fd.jsRngCount}  canon-cum-rng#=${fd.canonCumRng}`);
    const ent = fd.m_id != null ? `${fd.entity} (m_id ${fd.m_id})` : fd.entity;
    L.push(`  ${fd.scope.toUpperCase()} ${ent} . ${fd.field} :   C=${fmtVal(fd.c)}   JS=${fmtVal(fd.js)}`);
    if (r.ctx) {
        const c = r.ctx;
        L.push(`  C rng-callsites at step ${fd.step} (${c.cCount} calls):`);
        for (const cs of c.cCallsites) L.push(`     C> ${cs}`);
        if (!c.cCallsites.length) L.push(`     C> (no rng this step)`);
        L.push(`  JS rng-log at step ${fd.step} (${c.jsCount} calls):`);
        for (const js of c.jsRng) L.push(`     JS> ${js}`);
        if (!c.jsRng.length) L.push(`     JS> (no rng this step)`);
    }
    L.push(`  ➜ FIX: ${fixHint(fd, r.ctx)}`);
    console.log(L.join('\n') + '\n');
}

function fmtVal(v) { return typeof v === 'string' ? v : String(v); }

function fixHint(fd, ctx) {
    // Point the fixer at the C function that's drawing rng at the diverging
    // boundary — that's where the behaviour to port lives.
    const firstSite = ctx?.cCallsites?.[0] || '';
    const m = firstSite.match(/@\s*([A-Za-z0-9_]+)\(([^)]+)\)/);
    const fn = m ? `${m[1]} (${m[2]})` : (firstSite ? firstSite.replace(/.*@\s*/, '') : 'n/a');
    if (fd.scope === 'hero')
        return `hero.${fd.field} wrong — replay step ${fd.step}; C draws at ${fn}`;
    if (fd.field === 'PRESENT')
        return `monster ${fd.entity} chain membership differs — check makemon/mongone/migration at ${fn}`;
    if (fd.field === 'name')
        return `species mismatch for m_id ${fd.m_id} (C='${fd.c}' JS='${fd.js}') — makemon RNG/selection diverged at ${fn}`;
    if (fd.field === 'pm')
        return `pmidx enum offset for m_id ${fd.m_id} (same species, index C=${fd.c} JS=${fd.js}) — fix the PM_ table ordering in JS (a missing/extra permonst entry); affects any rn2(pmidx)-style draw`;
    if (fd.field === 'mx' || fd.field === 'my')
        return `m_id ${fd.m_id} moved to wrong cell — m_move/mfndpos at ${fn}`;
    if (fd.field === 'mhp' || fd.field === 'mhpmax')
        return `m_id ${fd.m_id} hp wrong — combat/heal/newmonhp at ${fn}`;
    if (['mflee', 'mfleetim', 'mfrozen', 'msleeping', 'mcanmove'].includes(fd.field))
        return `m_id ${fd.m_id} status bit ${fd.field} wrong — monster AI flag update at ${fn}`;
    if (fd.field === 'mtame' || fd.field === 'mpeaceful')
        return `m_id ${fd.m_id} disposition ${fd.field} wrong — tame/peaceful logic at ${fn}`;
    if (fd.scope === 'length')
        return `sequence length differs (C=${fd.c} JS=${fd.js}) — JS truncated/over-ran; check moveloop/death at step ${fd.step}`;
    return `field ${fd.field} differs — C draws at ${fn}`;
}

// ── --summary: campaign map across all sessions ─────────────────────────────
async function reportSummary(asJson, opts = {}) {
    const sessDir = join(ROOT, 'sessions');
    const files = readdirSync(sessDir).filter((f) => f.endsWith('.session.json')).sort();
    const rows = [];
    for (const f of files) {
        let session;
        try { session = JSON.parse(readFileSync(join(sessDir, f), 'utf8')); }
        catch (e) { rows.push({ file: f, error: `parse: ${e.message}` }); continue; }
        let jsSegs;
        try { jsSegs = await runJs(session); }
        catch (e) { rows.push({ file: f, error: `js: ${e.message}` }); continue; }
        const segs = normalizeSession(session).segments;
        for (let si = 0; si < segs.length; si++) {
            const seg = segs[si];
            const cState = loadStateJsonl(slugOf(f), seg.seed);
            if (!cState || cState.ambiguous) { rows.push({ file: f, seed: seg.seed, noC: true, ambiguous: cState?.ambiguous }); continue; }
            const d = diffSegment(seg, jsSegs[si], cState, opts);
            const fd = d.firstDiff;
            let cfn = '';
            let rngMatch = null;
            if (fd) {
                const ctx = callsiteContext(seg, jsSegs[si], fd.step);
                const m = (ctx.cCallsites[0] || '').match(/@\s*([A-Za-z0-9_]+)\(([^:)]+)/);
                cfn = m ? `${m[1]}(${m[2]})` : '';
                rngMatch = (fd.cRngCount != null && fd.jsRngCount != null)
                    ? (fd.cRngCount === fd.jsRngCount) : null;
            }
            rows.push({
                file: f, seed: seg.seed, cKind: d.cKind,
                step: fd ? fd.step : null,
                rng: fd ? fd.cRngCount : null,
                jsRng: fd ? fd.jsRngCount : null,
                entity: fd ? (fd.m_id != null ? `${fd.entity}` : fd.entity) : null,
                field: fd ? fd.field : null,
                cval: fd ? fd.c : null, jsval: fd ? fd.js : null,
                cfn, rngMatch,
                rngHorizon: d.rngHorizon,
                jsErr: jsSegs[si]?.error || null,
            });
        }
    }
    if (asJson) { console.log(JSON.stringify(rows, null, 2)); return; }

    // table
    console.log(`════════ ORACLE CAMPAIGN MAP — first state divergence per segment ════════`);
    console.log(`${pad('session', 42)} ${padl('seed', 6)} ${padl('step', 6)} ${padl('Crng#', 7)} ${pad('cause', 8)} ${pad('entity', 18)} ${pad('field', 9)} ${pad('C→JS', 16)} ${pad('where', 22)}`);
    console.log('─'.repeat(150));
    let nMatch = 0, nRng = 0, nState = 0;
    for (const r of rows) {
        if (r.error) { console.log(`${pad(r.file, 42)}  ERROR: ${r.error}`); continue; }
        if (r.noC) { console.log(`${pad(r.file, 42)} ${padl(r.seed, 6)}  ${r.ambiguous ? '(shared-seed — record session-scoped GT)' : '(no C state.jsonl — re-record)'}`); continue; }
        if (r.step == null) {
            const tag = r.jsErr ? `JS-ERR ${r.jsErr.slice(0, 40)}` : 'MATCH ✅';
            if (!r.jsErr) nMatch++;
            console.log(`${pad(r.file, 42)} ${padl(r.seed, 6)}  ${tag}`);
            continue;
        }
        // cause: rng# match => state-tracking (non-RNG) bug; mismatch => the
        // RNG stream itself diverged (over/under-draw) at this boundary.
        const cause = r.rngMatch === false ? 'RNG' : (r.rngMatch === true ? 'state' : '?');
        if (cause === 'RNG') nRng++; else if (cause === 'state') nState++;
        // for state-only divergences the step's rng callsite isn't the bug
        // site; show a structural hint instead.
        const where = cause === 'state'
            ? (r.field === 'PRESENT' ? 'makemon/mongone' : (r.field === 'pm' ? 'PM_ table' : r.cfn.slice(0, 22)))
            : r.cfn.slice(0, 22);
        const cj = `${fmtVal(r.cval)}→${fmtVal(r.jsval)}`.slice(0, 16);
        console.log(`${pad(r.file, 42)} ${padl(r.seed, 6)} ${padl(r.step, 6)} ${padl(r.rng ?? '?', 7)} ${pad(cause, 8)} ` +
                    `${pad((r.entity || '').slice(0, 18), 18)} ${pad(r.field, 9)} ${pad(cj, 16)} ${pad(where, 22)}`);
    }
    console.log('─'.repeat(150));
    console.log(`totals: ${nMatch} match · ${nState} state-tracking (rng aligned) · ${nRng} RNG-stream divergence`);
    console.log(`(step = input boundary; Crng# = C rng_call_count there; cause: "state"=rng aligned but state field differs ` +
                `(state-tracking bug), "RNG"=rng stream itself diverged. "where" = C fn / structural site to fix.)`);
}

function resolveSession(name) {
    if (existsSync(name)) return name;
    const p = join(ROOT, 'sessions', name);
    if (existsSync(p)) return p;
    const p2 = join(ROOT, 'sessions', name.endsWith('.session.json') ? name : `${name}.session.json`);
    if (existsSync(p2)) return p2;
    throw new Error(`session not found: ${name}`);
}

// ── main ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const summary = args.includes('--summary');

// --from N  : skip boundaries before step N (report the NEXT divergence once
//             everything up to N is being worked on / known-fixed).
// --ignore f1,f2 : suppress these fields (e.g. --ignore pm to skip the known
//             permonst-enum offset, or --ignore PRESENT to skip pet-chain
//             gaps) so the oracle surfaces the next *different* divergence.
function flagValue(name) {
    const i = args.indexOf(name);
    if (i >= 0 && i + 1 < args.length) return args[i + 1];
    const inline = args.find((a) => a.startsWith(name + '='));
    return inline ? inline.slice(name.length + 1) : null;
}
const fromStep = flagValue('--from') != null ? (+flagValue('--from') | 0) : 0;
const ignoreRaw = flagValue('--ignore');
const ignore = ignoreRaw ? new Set(ignoreRaw.split(',').map((s) => s.trim()).filter(Boolean)) : EMPTY_SET;
const opts = { fromStep, ignore };

// positional = non-flag args, excluding values consumed by --from / --ignore
const consumed = new Set();
for (const fl of ['--from', '--ignore']) {
    const i = args.indexOf(fl);
    if (i >= 0 && i + 1 < args.length) consumed.add(i + 1);
}
const positional = args.filter((a, i) => !a.startsWith('--') && !consumed.has(i));

if (summary) {
    await reportSummary(asJson, opts);
} else if (positional.length >= 1) {
    await reportOne(positional[0], asJson, opts);
} else {
    console.error('Usage:\n' +
        '  node scripts/oracle.mjs <session.json> [--json] [--from N] [--ignore f1,f2]\n' +
        '  node scripts/oracle.mjs --summary [--json] [--from N] [--ignore f1,f2]\n' +
        '\nExamples:\n' +
        '  node scripts/oracle.mjs seed4500-knight-coverage\n' +
        '  node scripts/oracle.mjs seed4500-knight-coverage --ignore pm,PRESENT  # skip enum-offset + pet-chain gaps\n' +
        '  node scripts/oracle.mjs seed4500-knight-coverage --from 263           # next divergence at/after step 263\n' +
        '  node scripts/oracle.mjs --summary --ignore pm,PRESENT                 # campaign map of the next divergences');
    process.exit(2);
}
