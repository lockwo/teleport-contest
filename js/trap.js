// trap.js — Trap creation and trap-destination logic.
// C ref: trap.c — maketrap, hole_destination, dng_bottom, choose_trapnote.
// Stripped-down version for contest: emits the same rn2/rnd/rne PRNG call
// sequence as C during level generation so RNG parity is preserved.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { HOLE, TRAPDOOR, SQKY_BOARD, is_hole, In_quest } from './const.js';

// C ref: dungeon.c dunlev() — level number for lev within its dungeon.
function dunlev(lev) {
    return lev?.dlevel ?? 1;
}

// C ref: dungeon.c dunlevs_in_dungeon() — lowest level number in this dungeon.
function dunlevs_in_dungeon(lev) {
    const dnum = lev?.dnum ?? 0;
    return game.dungeons?.[dnum]?.num_dunlevs ?? 1;
}

// C ref: dungeon.c — deepest level reached in this dungeon so far.
function dunlev_reached(lev) {
    const dnum = lev?.dnum ?? 0;
    return game.dungeons?.[dnum]?.dunlev_ureached ?? (lev?.dlevel ?? 1);
}

function In_hell(lev) {
    const dnum = lev?.dnum ?? 0;
    return dnum === (game.gehennom_dnum ?? -1);
}

// C ref: trap.c dng_bottom() — find "bottom" level of the dungeon, stopping
// at the quest locate level (and accounting for the unperformed invocation
// in Gehennom).
function dng_bottom(lev) {
    let bottom = dunlevs_in_dungeon(lev);

    /* when in the upper half of the quest, don't fall past the
       middle "quest locate" level if hero hasn't been there yet */
    if (In_quest(lev)) {
        const qlocate_depth = game.qlocate_level?.dlevel ?? bottom;
        if (dunlev_reached(lev) < qlocate_depth)
            bottom = qlocate_depth; /* early cut-off */
    } else if (In_hell(lev)) {
        if (!game.u?.uevent?.invoked)
            bottom -= 1;
    }
    return bottom;
}

// C ref: trap.c hole_destination() — destination dlevel for holes/trapdoors.
export function hole_destination(dst) {
    const uz = game.u?.uz;
    const bottom = dng_bottom(uz);

    dst.dnum = uz?.dnum ?? 0;
    dst.dlevel = dunlev(uz);
    while (dst.dlevel < bottom) {
        dst.dlevel++;
        if (rn2(4))
            break;
    }
}

// C ref: trap.c choose_trapnote() — pick an unused squeaky-board note.
export function choose_trapnote(ttmp) {
    const used = new Set();
    for (const trap of game.level?.traps ?? []) {
        if (trap !== ttmp && trap.ttyp === SQKY_BOARD && Number.isInteger(trap.tnote))
            used.add(trap.tnote);
    }
    const picks = [];
    for (let k = 0; k < 12; k++)
        if (!used.has(k)) picks.push(k);
    return picks.length ? picks[rn2(picks.length)] : rn2(12);
}

// C ref: trap.c maketrap() — create a trap at (x,y) of the given type.
// Contest port: keeps the lightweight trap record used by mklev/display but
// faithfully emits the PRNG calls C makes in maketrap's type switch (notably
// hole_destination's rn2(4) for holes/trapdoors).
export async function maketrap(x, y, typ) {
    const trap = {
        ttyp: typ, tx: x, ty: y, tseen: false, once: false,
        launch: { x: 0, y: 0 },
        dst: { dnum: -1, dlevel: -1 },
    };
    if (!game.level) return trap;
    if (!game.level.traps) game.level.traps = [];

    switch (typ) {
    case SQKY_BOARD:
        trap.tnote = choose_trapnote(trap);
        break;
    case HOLE:
    case TRAPDOOR:
        if (is_hole(typ))
            hole_destination(trap.dst);
        break;
    default:
        break;
    }

    game.level.traps.push(trap);
    return trap;
}
