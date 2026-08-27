// disprng.js — the DISPLAY PRNG context (C ref: rnd.c rn2_on_display_rng).
//
// C keeps two independent ISAAC64 streams (rnglist[CORE] and rnglist[DISP]) and
// options.c:7161 seeds BOTH from sys_random_seed(), i.e. from the same pinned
// NETHACK_SEED.  So DISP replays the very same byte sequence as CORE but is
// advanced only by display-only picks — every one of which is gated on
// Hallucination (display.h what_mon/what_obj, do_name.c rndmonnam/hcolor).
// That means the stream sits at offset 0 until the hero first hallucinates,
// and from then on the picks are exactly reproducible.
//
// This lives outside the frozen js/rng.js on purpose: nothing here may touch
// the core stream.
import { isaac64_init, isaac64_next_uint64 } from './isaac64.js';
import { game } from './gstate.js';

function dispCtx() {
    if (game._dispCtx && game._dispCtxSeed === game.currentSeed) return game._dispCtx;
    let s = BigInt(game.currentSeed ?? 0) & 0xFFFFFFFFFFFFFFFFn;
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) { bytes[i] = Number(s & 0xFFn); s >>= 8n; }
    game._dispCtxSeed = game.currentSeed;
    game._dispCtx = isaac64_init(bytes);
    return game._dispCtx;
}

// C ref: rnd.c:70 rn2_on_display_rng(x).
//
// The recorded sessions carry only rnglist[CORE], so scripts/rngdiff.mjs and
// swarm/bin/rngstep.mjs are BLIND to this stream.  The optional trace below is
// the substitute oracle: set globalThis.__DISPLOG to an array (and
// __DISPLOG_SITES for JS call sites) and compare against a recording made with
// NETHACK_RNGLOG_DISP=1.  swarm/bin/dispdiff.mjs drives it.
export function rn2_on_display_rng(x) {
    if (x <= 0) return 0;
    const v = Number(isaac64_next_uint64(dispCtx()) % BigInt(x));
    if (globalThis.__DISPLOG) {
        const site = globalThis.__DISPLOG_SITES
            ? ' @ ' + (new Error()).stack.split('\n').slice(2, 8)
                .map(l => l.trim().replace(/^at /, '').replace(/\(.*\/js\//, '(')).join(' <- ')
            : '';
        globalThis.__DISPLOG.push(`~drn2(${x})=${v}${site}`);
    }
    return v;
}

// C ref: display.h:186 random_monster(rng) == rng(NUMMONS).  NUMMONS is the
// full mons[] length (383 with the recorder's MAIL_STRUCTURES daemon).
export const NUMMONS = 383;
export function random_monster() { return rn2_on_display_rng(NUMMONS); }

// C ref: display.h:187 random_object(rng) == rng(NUM_OBJECTS - FIRST_OBJECT)
// + FIRST_OBJECT — skips STRANGE_OBJECT and the MAXOCLASSES generic-class
// placeholders (objects.h MARKER(FIRST_OBJECT, LAST_GENERIC + 1)).
const FIRST_OBJECT = 18;   // objclass.h MAXOCLASSES
export function random_object(num_objects) {
    return rn2_on_display_rng(num_objects - FIRST_OBJECT) + FIRST_OBJECT;
}
