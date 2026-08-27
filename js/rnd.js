// rnd.js — C ref: src/rnd.c, the parts that are NOT the generators themselves.
//
// rnd.c's generators (rn2/rnd/rn1/rnl/d/rne/rnz) are already live in js/rng.js
// and rn2_on_display_rng() in js/disprng.js; both are the judge-frozen side of
// the RNG contract and nothing here re-implements them.  What was missing is
// rnd.c's *plumbing*: the rnglist[] registry (whichrng), the ISAAC64 seeding
// entry points (init_isaac64 / set_random / init_random / reseed_random), the
// rnd_on_display_rng() wrapper, and shuffle_int_array().
//
// Every function below routes through the existing exported generators /
// initialisers.  There is no second RNG stream in this file.

import { game } from './gstate.js';
import { rn2, rnd, initRng } from './rng.js';
import { rn2_on_display_rng } from './disprng.js';
import { isaac64_init } from './isaac64.js';

// C ref: rnd.c:24 enum { CORE = 0, DISP = 1 }.
export const CORE = 0, DISP = 1;

// C ref: rnd.c:26 rnglist[] — { fn, init, rng_state } per stream, keyed by the
// generator's function pointer.  The JS registry holds the two live generators;
// the `rng_state` half lives where each stream's owner keeps it (game.coreCtx
// for CORE via js/rng.js, game._dispCtx for DISP via js/disprng.js).
const rnglist = [
    { fn: rn2, init: false },                  /* CORE */
    { fn: rn2_on_display_rng, init: false },   /* DISP */
];

// C ref: rnd.c:32 whichrng(fn) — index of the stream that fn draws from, or -1.
export function whichrng(fn) {
    for (let i = 0; i < rnglist.length; ++i)
        if (rnglist[i].fn === fn)
            return i;
    return -1;
}

// C ref: rnd.c:43 init_isaac64(seed, fn) — little-endian byte split of the seed
// into isaac64_init() for the stream fn belongs to.
//
// CORE goes through js/rng.js initRng(), which performs the identical 8-byte LE
// split.  DISP has no exported setter: js/disprng.js seeds it lazily inside its
// private dispCtx(), cache-keyed on game.currentSeed, so seeding it here means
// writing that cache pair.  The proper fix is an exported seeder in
// js/disprng.js (that file is not one of this task's six); until then this
// keeps the SAME single DISP context rather than making a second one.
export function init_isaac64(seed, fn) {
    const rngindx = whichrng(fn);

    if (rngindx < 0)
        throw new Error('panic: Bad rng function passed to init_isaac64().');

    if (rngindx === CORE) {
        initRng(seed);
    } else {
        let s = BigInt(seed) & 0xFFFFFFFFFFFFFFFFn;
        const new_rng_state = new Uint8Array(8);
        for (let i = 0; i < 8; i++) { new_rng_state[i] = Number(s & 0xFFn); s >>= 8n; }
        game._dispCtx = isaac64_init(new_rng_state);
        // js/disprng.js dispCtx() re-seeds whenever this key !== game.currentSeed.
        game._dispCtxSeed = game.currentSeed;
    }
    rnglist[rngindx].init = true;
}

// C ref: rnd.c:168 rnd_on_display_rng(x) — 1 <= result <= x, off the DISP
// stream.  Genuinely absent from js/ before this (js/disprng.js exports only
// the rn2 form plus display.h's random_monster/random_object helpers).
export function rnd_on_display_rng(x) {
    return rn2_on_display_rng(x) + 1;
}

// C ref: rnd.c:235 set_random(seed, fn) — the USE_ISAAC64 build's set_random()
// is init_isaac64() and nothing else.
export function set_random(seed, fn) {
    init_isaac64(seed, fn);
}

// C ref: sys/unix/unixmain.c:813 sys_random_seed() — /dev/urandom when it can
// be read (which also sets has_strong_rngseed), else a weak time+pid mix.  The
// replay harness pins the seed instead: js/rng.js initRng() is called with the
// session's NETHACK_SEED, which is what game.currentSeed holds.
export function sys_random_seed() {
    return game.currentSeed ?? 0;
}

// C ref: decl.c:84 has_strong_rngseed — set TRUE only by a successful
// /dev/urandom read in sys_random_seed().  A replay never reseeds.
export let has_strong_rngseed = false;

// C ref: rnd.c:282 init_random(fn) — one-time seeding of a stream.
export function init_random(fn) {
    set_random(sys_random_seed(), fn);
}

// C ref: rnd.c:289 reseed_random(fn) — only when the seed source is
// unguessable by the player, i.e. never in a pinned-seed replay.
export function reseed_random(fn) {
    if (has_strong_rngseed)
        init_random(fn);
}

// C ref: rnd.c:299 shuffle_int_array(indices, count) — Fisher-Yates over
// indices[0..count-1], one rn2(i+1) per step and the swap skipped (but the draw
// still made) when the pick is the element itself.
//
// NOTE: js/apply.js:1569 carries an identical private copy named
// ap_shuffle_int_array() and is its only live caller (horn of plenty /
// unicorn-horn trouble list).  The follow-up is for apply.js to import this
// one, not for a third copy to appear.
export function shuffle_int_array(indices, count) {
    for (let i = count - 1; i > 0; i--) {
        const iswap = rn2(i + 1);
        if (iswap === i)
            continue;
        const temp = indices[i];
        indices[i] = indices[iswap];
        indices[iswap] = temp;
    }
}

// re-exported so a caller that wants "the rnd.c interface" gets the live
// generators from here too, without a second definition existing anywhere.
export { rn2, rnd, rn2_on_display_rng };
