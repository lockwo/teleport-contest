// rng.js — PRNG wrappers around ISAAC64.
// C ref: rng.c — three RNG contexts: core, display, lua.
// Contest: only core context is used for parity.

import { isaac64_init, isaac64_next_uint64 } from './isaac64.js';
import { game } from './gstate.js';

let _rngLog = [];
let _rngLogEnabled = false;

export function initRng(seed) {
    game.currentSeed = seed;
    // Convert seed to 8 little-endian bytes
    let s = BigInt(seed) & 0xFFFFFFFFFFFFFFFFn;
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
        bytes[i] = Number(s & 0xFFn);
        s >>= 8n;
    }
    game.coreCtx = isaac64_init(bytes);
    _rngLog = [];
}

export function enableRngLog() { _rngLogEnabled = true; _rngLog = []; }
export function getRngLog() { return _rngLog; }
export function pushRngLogEntry(entry) { if (_rngLogEnabled) _rngLog.push(entry); }

function RND(x) {
    const val = isaac64_next_uint64(game.coreCtx);
    return Number(val % BigInt(x));
}

// C ref: rn2(x) — random number 0..x-1
export function rn2(x) {
    if (x <= 0) return 0;
    const val = RND(x);
    if (_rngLogEnabled) _rngLog.push(`rn2(${x})=${val}`);
    return val;
}

// C ref: rnd(x) — random number 1..x
export function rnd(x) {
    if (x <= 0) return 0;
    const val = RND(x) + 1;
    if (_rngLogEnabled) _rngLog.push(`rnd(${x})=${val}`);
    return val;
}

// C ref: rn1(x, y) — random number y..y+x-1
export function rn1(x, y) { return rn2(x) + y; }

// C ref: rnd.c rnl(x) — luck-adjusted random number 0..x-1.  With Luck==0
// (the contest's starter state) this is a single RND(x) with no adjustment
// roll; non-zero Luck adds the secondary rn2(37+|adj|) bias roll.
export function rnl(x) {
    if (x <= 0) return 0;
    let adjustment = game.u?.uluck || 0;
    if (x <= 15)
        adjustment = Math.trunc((Math.abs(adjustment) + 1) / 3) * Math.sign(adjustment);
    let i = RND(x);
    if (_rngLogEnabled) _rngLog.push(`rnl(${x})=${i}`);
    if (adjustment && rn2(37 + Math.abs(adjustment))) {
        i -= adjustment;
        if (i < 0) i = 0;
        else if (i >= x) i = x - 1;
    }
    return i;
}

// C ref: rnd.c d(n, x) — roll n dice of x sides.  C's d() calls RND(x)
// directly and the PRNG instrumentation logs the whole roll as a single
// "d(n,x)=sum" entry, so do the same here (the inner RND draws still advance
// the stream identically) instead of emitting n separate rnd() entries.
export function d(n, x) {
    if (x < 0 || n < 0 || (x === 0 && n !== 0)) return 1;
    let tmp = n;
    for (let i = 0; i < n; i++) tmp += RND(x);
    if (_rngLogEnabled) _rngLog.push(`d(${n},${x})=${tmp}`);
    return tmp;
}

// C ref: rne(x) — exponentially distributed
// Internal rn2 calls are logged (matching C's PRNG log format).
export function rne(x) {
    const ulevel = game.u?.ulevel || 1;
    const utmp = ulevel < 15 ? 5 : Math.trunc(ulevel / 3);
    let tmp = 1;
    while (tmp < utmp && !rn2(x)) tmp++;
    if (_rngLogEnabled) _rngLog.push(`rne(${x})=${tmp}`);
    return tmp;
}

// C ref: rnz(i) — fuzzy random around i
// Internal rn2/rne calls are logged (matching C's PRNG log format).
export function rnz(i) {
    let x = i;
    let tmp = 1000;
    tmp += rn2(1000);
    tmp *= rne(4);
    if (rn2(2)) { x *= tmp; x = Math.trunc(x / 1000); }
    else { x *= 1000; x = Math.trunc(x / tmp); }
    if (_rngLogEnabled) _rngLog.push(`rnz(${i})=${x}`);
    return x;
}

export const c_d = d;
export const lua_d = d;
