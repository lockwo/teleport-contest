// sounds.js — Ambient level sounds emitted once per turn.
// C ref: sounds.c dosounds().
//
// Only the RNG side-effects matter for parity.  Each gated probe is driven
// by the current level's flags (data-driven, no per-seed special casing),
// matching the C order exactly; the first probe that "fires" returns.

import { game } from './gstate.js';
import { rn2 } from './rng.js';

// C ref: sounds.c dosounds().  Deaf/acoustics/swallow/underwater short-circuit
// before any roll.  Each `level.flags.*` clause rolls rn2(N) when the feature
// is present and returns after producing a (suppressed) message.
export function dosounds() {
    const g = game;
    if (g.flags?.acoustics === false || g.u?.uswallow || g.u?.uunderwater)
        return;

    const lf = g.level?.flags || {};
    const hallu = 0; // Hallucination not modeled in the move loop

    if (lf.nfountains && !rn2(400)) { rn2(3); return; }
    if (lf.nsinks && !rn2(300)) { rn2(2); return; }
    if (lf.has_court && !rn2(200)) { return; }
    if (lf.has_swamp && !rn2(200)) { rn2(2); return; }
    if (lf.has_vault && !rn2(200)) { return; }
    if (lf.has_beehive && !rn2(200)) { return; }
    if (lf.has_morgue && !rn2(200)) { return; }
    if (lf.has_barracks && !rn2(200)) { rn2(3); return; }
    if (lf.has_zoo && !rn2(200)) { return; }
    if (lf.has_shop && !rn2(200)) { rn2(2); return; }
    if (lf.has_temple && !rn2(200)) { return; }
    // oracle-level chant: rn2(400) — only on the oracle level (not modeled).
}
