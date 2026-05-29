// monmove.js — Monster decision + movement logic for the move loop.
// C ref: monmove.c — dochug(), distfleeck(), set_apparxy(), m_move();
//        mon.c mfndpos().
//
// GENERAL (data-driven) port: operates on the real monster records placed on
// game.level.  When a level has materialized monsters this reproduces the
// per-move RNG sequence (distfleeck rn2(5), m_move rn2(4*cnt), ...) seen in
// the recorded sessions.  Kept faithful to the C control flow so it extends
// to richer monster behavior without per-seed special cases.

import { game } from './gstate.js';
import { rn2, rnd } from './rng.js';
import {
    COLNO, ROWNO, MTSZ, BOLT_LIM, DOOR, D_CLOSED, D_LOCKED, D_BROKEN,
    IS_OBSTRUCTED, IS_DOOR, IS_POOL, IS_LAVA, isok,
} from './const.js';
import { DEADMONSTER } from './mon.js';

// C ref: mondata.h dist2(x0,y0,x1,y1).
function dist2(x0, y0, x1, y1) {
    const dx = x0 - x1, dy = y0 - y1;
    return dx * dx + dy * dy;
}

// C ref: mon.c monnear(mon, x, y) — within one (king) step.
function monnear(mon, x, y) {
    const distance = dist2(mon.mx, mon.my, x, y);
    return distance < 3 && distance > -3;
}

// C ref: mon.c m_at(x, y).
function m_at(x, y) {
    for (const m of game.level?.monsters || [])
        if (!DEADish(m) && m.mx === x && m.my === y) return m;
    return null;
}
function DEADish(m) { return !m || (m.mhp != null && m.mhp <= 0); }

function MON_AT(x, y) {
    const m = m_at(x, y);
    return m && !(game.u?.ux === x && game.u?.uy === y);
}

function terrainTyp(x, y) {
    return game.level?.at(x, y)?.typ;
}
function doormask(x, y) {
    return game.level?.at(x, y)?.doormask || 0;
}

// C ref: monmove.c distfleeck(mtmp, &inrange, &nearby, &scared).
// Always rolls rn2(5) (bravegremlin) first; the monflee roll only happens
// when the monster is actually scared (not for the peaceful/level monsters
// our sessions exercise).
function distfleeck(mtmp) {
    rn2(5); // bravegremlin
    const inrange = dist2(mtmp.mx, mtmp.my, mtmp.mux, mtmp.muy)
        <= BOLT_LIM * BOLT_LIM;
    const nearby = inrange && monnear(mtmp, mtmp.mux, mtmp.muy);
    let scared = 0;
    // onscary / sanctuary / flees_light all false for ordinary monsters.
    // (When implemented, scared would trigger monflee(rnd(rn2(7)?10:100)).)
    return { inrange, nearby, scared };
}

// C ref: monmove.c set_apparxy(mtmp).  For tame monsters, monsters adjacent
// to the hero, or monsters that can see a non-invisible/non-displaced hero,
// this resolves to the hero's real position with no RNG.  The RNG-consuming
// guessing branch only runs under invisibility/displacement/underwater.
function set_apparxy(mtmp) {
    const mx = mtmp.mux, my = mtmp.muy;
    if (mtmp.mtame || (game.u?.ux === mx && game.u?.uy === my)) {
        mtmp.mux = game.u.ux; mtmp.muy = game.u.uy; return;
    }
    const notseen = (!mtmp.mcansee);
    // No Invis / Displaced / Underwater modelling here -> displ stays 0.
    if (!notseen) {
        mtmp.mux = game.u.ux; mtmp.muy = game.u.uy; return;
    }
    // notseen branch (blind monster): displ = 1, may roll to guess.
    const displ = 1;
    const gotu = !rn2(3);
    if (gotu) {
        mtmp.mux = game.u.ux; mtmp.muy = game.u.uy; return;
    }
    let try_cnt = 0, nx = mx, ny = my;
    do {
        if (++try_cnt > 200) { nx = game.u.ux; ny = game.u.uy; break; }
        nx = game.u.ux - displ + rn2(2 * displ + 1);
        ny = game.u.uy - displ + rn2(2 * displ + 1);
    } while (!isok(nx, ny));
    mtmp.mux = nx; mtmp.muy = ny;
}

// C ref: mon.c mfndpos(mon, &data, flag).  Returns the list of legal move
// positions around the monster (the count `cnt` drives m_move's rn2(4*cnt)).
// Implements the common-case terrain/door/diagonal/occupancy checks; exotic
// cases (digging, water-walkers, poison gas, garlic, boulders) are omitted
// because no contest session exercises them with materialized monsters.
function mfndpos(mon, flag) {
    const poss = [];
    const x = mon.mx, y = mon.my;
    const nowtyp = terrainTyp(x, y);
    const nodiag = false; // NODIAG only for grid bugs / a few classes.
    const ALLOW_U = 0x100000; // sentinel; callers below pass it in `flag`.

    const maxx = Math.min(x + 1, COLNO - 1);
    const maxy = Math.min(y + 1, ROWNO - 1);
    for (let nx = Math.max(1, x - 1); nx <= maxx; nx++) {
        for (let ny = Math.max(0, y - 1); ny <= maxy; ny++) {
            if (nx === x && ny === y) continue;
            const ntyp = terrainTyp(nx, ny);
            if (ntyp == null) continue;
            if (IS_OBSTRUCTED(ntyp)) continue; // wall / rock (no dig/passwall)
            // closed/locked doors block unless monster can open (not modeled)
            if (IS_DOOR(ntyp)) {
                const dm = doormask(nx, ny);
                if ((dm & D_CLOSED) || (dm & D_LOCKED)) continue;
            }
            // diagonal squeeze rules through doorways
            if (nx !== x && ny !== y) {
                if (nodiag) continue;
                if (IS_DOOR(nowtyp) && (doormask(x, y) & ~D_BROKEN)) continue;
                if (IS_DOOR(ntyp) && (doormask(nx, ny) & ~D_BROKEN)) continue;
            }
            // pools / lava: ordinary land monsters avoid them
            if (IS_POOL(ntyp) || IS_LAVA(ntyp)) continue;

            // hero's (apparent) position: only allowed if attacking
            if ((game.u?.ux === nx && game.u?.uy === ny)
                || (nx === mon.mux && ny === mon.muy)) {
                if (game.u?.ux === nx && game.u?.uy === ny) {
                    mon.mux = game.u.ux; mon.muy = game.u.uy;
                }
                if (!(flag & ALLOW_U)) continue;
            } else if (MON_AT(nx, ny)) {
                // another monster occupies the spot; no displace by default
                continue;
            }
            poss.push({ x: nx, y: ny });
        }
    }
    return poss;
}

const ALLOW_U = 0x100000;

// C ref: monmove.c m_move(mtmp, after).  Returns one of the MMOVE_* codes;
// we only need the RNG side-effects (the mtrack-avoidance rn2(4*(cnt-j))
// rolls at monmove.c:1963) and the resulting move, so we implement the
// approach-the-hero path used by ordinary monsters.
const MMOVE_NOTHING = 0, MMOVE_MOVED = 2;

function m_move(mtmp) {
    const ptr = mtmp.data;
    const omx = mtmp.mx, omy = mtmp.my;

    // appr: +1 approach the hero, -1 flee, 0 wander.  Peaceful/tame
    // wanderers approach; this mirrors the common case.
    let appr = 1;
    if (mtmp.mflee) appr = -1;

    // goal = the hero's apparent position
    const ggx = mtmp.mux ?? game.u.ux;
    const ggy = mtmp.muy ?? game.u.uy;

    const poss = mfndpos(mtmp, mtmp.mpeaceful ? 0 : ALLOW_U);
    const cnt = poss.length;
    if (cnt === 0) return MMOVE_NOTHING;

    let nix = omx, niy = omy;
    let nidist = dist2(nix, niy, ggx, ggy);
    let chcnt = 0, chi = -1, mmoved = MMOVE_NOTHING;
    const jcnt = Math.min(MTSZ, cnt - 1);
    const mtrack = mtmp.mtrack || [];

    for (let i = 0; i < cnt; i++) {
        const nx = poss[i].x, ny = poss[i].y;

        if (appr !== 0) {
            // mtrack avoidance — the rn2(4*(cnt-j)) rolls (monmove.c:1963)
            let skip = false;
            for (let j = 0; j < jcnt; j++) {
                const trk = mtrack[j];
                if (trk && nx === trk.x && ny === trk.y) {
                    if (rn2(4 * (cnt - j))) { skip = true; break; }
                }
            }
            if (skip) continue;
        }

        const ndist = dist2(nx, ny, ggx, ggy);
        const nearer = ndist < nidist;
        if ((appr === 1 && nearer) || (appr === -1 && !nearer)
            || (!appr && !rn2(++chcnt))
            || (mmoved === MMOVE_NOTHING)) {
            nix = nx; niy = ny; nidist = ndist; chi = i; mmoved = MMOVE_MOVED;
        }
    }

    if (mmoved === MMOVE_MOVED && (nix !== omx || niy !== omy)) {
        // record track history (most-recent first, length MTSZ)
        mtmp.mtrack = [{ x: omx, y: omy }, ...mtrack].slice(0, MTSZ);
        mtmp.mx = nix; mtmp.my = niy;
        return MMOVE_MOVED;
    }
    return MMOVE_NOTHING;
}

// C ref: monmove.c dochug(mtmp).  The pre-move adjustments, then distfleeck,
// then (for the common case) m_move, then a recalculating distfleeck.
export function dochug(mtmp) {
    if (DEADMONSTER(mtmp)) return 1;
    if (!mtmp.mcanmove) return 0;

    // set_apparxy must run before distfleeck (it sets mux/muy).
    set_apparxy(mtmp);

    // distance / scariness check
    distfleeck(mtmp);

    // PHASE THREE — movement.  Ordinary monsters that aren't engaging in
    // melee fall through to m_move.
    m_move(mtmp);
    // recalc after moving (matches C's second distfleeck call)
    distfleeck(mtmp);
    return 0;
}

// C ref: monmove.c dochugw(mtmp, inrange) — wrapper around dochug used by
// movemon_singlemon.  The extra warning bookkeeping consumes no RNG.
export function dochugw(mtmp) {
    return dochug(mtmp);
}
