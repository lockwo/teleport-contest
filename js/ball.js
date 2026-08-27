// ball.js — the punished hero's ball and chain.
// C ref: src/ball.c — placebc, move_bc, drag_ball, bc_order.
//
// A hero who reads a scroll of punishment (read.js punish()) is chained to a
// heavy iron ball.  Moving then costs TWO turns rather than one, because
// hack.c domove_core() ends with
//
//     if (cause_delay) { nomul(-2); gm.multi_reason = "dragging an iron ball"; }
//
// and drag_ball() sets cause_delay whenever the ball itself has to be dragged.
// That extra turn is a full moveloop iteration — monsters move, the hunger and
// sounds rolls fire — so omitting it desynchronised every later PRNG draw on
// seed4500 from step 514 on (C ran T:87 -> 89 for one movement key; we ran one
// turn).  The ball and chain also occupy map squares that trail the hero, so
// their placement is load-bearing for the rendered map.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { newsym, object_glyph } from './display.js';
import { Blind } from './vision.js';
import { place_object } from './mkobj.js';
import { t_at } from './trap.js';
import { IS_OBSTRUCTED, IS_DOOR, D_CLOSED, D_LOCKED, is_pit, is_hole, POOL,
         DRAWBRIDGE_UP, SLT_ENCUMBER } from './const.js';

// C ref: you.h — bit masks for u.bc_felt and the bc_control argument.
export const BC_BALL = 0x01;
export const BC_CHAIN = 0x02;
// C ref: you.h — which of the pair is drawn on top when they share a square.
const BCPOS_BALL = 0, BCPOS_CHAIN = 1, BCPOS_DIFFER = 2;

// C ref: hacklib.c dist2 / distmin.
const dist2 = (x0, y0, x1, y1) => (x0 - x1) * (x0 - x1) + (y0 - y1) * (y0 - y1);
const distmin = (x0, y0, x1, y1) => Math.max(Math.abs(x0 - x1), Math.abs(y0 - y1));

// C ref: mkobj.c remove_object(obj) — unlink a floor object from the level pile
// (the JS engine keeps one flat array; last placed is topmost, matching C).
function remove_object(obj) {
    const arr = game.level?.objects;
    if (!arr) return;
    const ix = arr.indexOf(obj);
    if (ix >= 0) arr.splice(ix, 1);
    obj.where = 'free';
}

const at = (x, y) => game.level?.at(x, y) || null;
// C ref: rm.h IS_POOL(typ) — POOL <= typ <= DRAWBRIDGE_UP (pool, moat, water,
// raised drawbridge), which is what ball.c's is_pool() tests.
function IS_POOL_AT(x, y) {
    const typ = at(x, y)?.typ;
    return typ != null && typ >= POOL && typ <= DRAWBRIDGE_UP;
}
// C ref: ball.c IS_CHAIN_ROCK(x,y) — the chain may never be moved into solid
// rock or a closed/locked door.
function IS_CHAIN_ROCK(x, y) {
    const loc = at(x, y);
    if (!loc) return true;
    const typ = loc.typ ?? 0;
    if (IS_OBSTRUCTED(typ)) return true;
    return IS_DOOR(typ) && ((loc.doormask ?? 0) & (D_CLOSED | D_LOCKED)) !== 0;
}
// C ref: obj.h carried(obj) — in the hero's inventory rather than on the floor.
const carried = (obj) => obj?.where === 'invent';

// C ref: ball.c bc_order() — which object is nearer the top of the pile when
// the ball and chain share a square.
function bc_order() {
    const u = game.u, uball = u?.uball, uchain = u?.uchain;
    if (!uball || !uchain || uball.ox !== uchain.ox || uball.oy !== uchain.oy
        || carried(uball))
        return BCPOS_DIFFER;
    // C walks svl.level.objects[x][y] via ->nexthere, which is TOPMOST-FIRST, and
    // returns whichever of the pair it meets first.  The JS engine keeps one flat
    // array in which the LAST entry at a square is the topmost (display.js
    // vobj_at() returns the last match), so the equivalent walk is in reverse.
    // Iterating forwards answered BCPOS_BALL for a pile whose top is the chain,
    // which flipped move_bc()'s "nothing moved" branch and drew the ball over the
    // chain on the hero's trailing square (seed4500 step 512 shows '_', not '0').
    const objs = game.level?.objects || [];
    for (let i = objs.length - 1; i >= 0; i--) {
        const o = objs[i];
        if (o.where !== 'floor' || o.ox !== uball.ox || o.oy !== uball.oy) continue;
        if (o === uchain) return BCPOS_CHAIN;
        if (o === uball) return BCPOS_BALL;
    }
    return BCPOS_DIFFER;
}

// C ref: ball.c placebc() — put the pair down on the hero's square.  Ball
// first so the chain lands on top (u.bc_order = BCPOS_CHAIN).
// NOT ported: the two flooreffects() calls (chain/ball "might rust").  They can
// only bite over water/lava/a pit, and every recorded placebc() lands on room
// floor; flooreffects() itself is not modelled.
export function placebc() {
    const u = game.u;
    if (!u?.uball || !u?.uchain) return;
    // C ref: ball.c placebc() — `if (uchain && uchain->where != OBJ_FREE)
    // { impossible("bc already placed?"); return; }`.  Without the guard a
    // second placebc() puts a SECOND chain+ball on the pile, and look_here()
    // then lists each of them twice.
    if (u.uchain.where !== 'free') return;
    if (carried(u.uball)) {
        u.bc_order = BCPOS_DIFFER;
    } else {
        place_object(u.uball, u.ux, u.uy);
        u.bc_order = BCPOS_CHAIN;
    }
    place_object(u.uchain, u.ux, u.uy);
    newsym(u.ux, u.uy);
}

// C ref: ball.c unplacebc_core() — lift the pair OFF the map (they stay owned by
// the hero; where becomes OBJ_FREE).  Used by goto_level(): the ball and chain
// must leave the departing level's object list before it is saved, or they stay
// behind at the old coordinates and placebc() on arrival has nothing to undo.
// The u.uswallow arm is waterlevel-only in C and is not reachable here.
// (Blind's bc_felt glyph bookkeeping is not ported — see move_bc.)
export function unplacebc() {
    const u = game.u;
    if (!u?.uball || !u?.uchain) return;
    if (u.uswallow) return; /* ball&chain not unplaced while swallowed */
    if (!carried(u.uball)) {
        remove_object(u.uball);
        newsym(u.uball.ox, u.uball.oy);
    }
    remove_object(u.uchain);
    newsym(u.uchain.ox, u.uchain.oy);
    u.bc_felt = 0; /* feel nothing */
}

// C ref: ball.c movobj(obj, ox, oy) — relocate a floor object in place, with a
// newsym at both ends.  Only the Blind arm of move_bc() uses it.
function movobj(obj, ox, oy) {
    remove_object(obj);
    newsym(obj.ox, obj.oy);
    place_object(obj, ox, oy);
    newsym(ox, oy);
}

// This port stores C's `levl[x][y].glyph` map memory as loc.remembered_glyph.
const memGlyph = (x, y) => at(x, y)?.remembered_glyph ?? null;
function setMemGlyph(x, y, g) { const loc = at(x, y); if (loc) loc.remembered_glyph = g; }

// C ref: ball.c move_bc(before, control, ballx, bally, chainx, chainy).
// Non-blind: "we need to pick up the ball and chain before the hero moves, then
// put them in their new positions after the hero moves."
// Blind: the pair is NOT lifted first — it is moved in place (movobj) after the
// step, and the hero's stale memory of whichever piece it last felt is only
// rewritten when u.bc_felt says it was actually being felt.  That difference is
// visible: a blind punished hero who steps off the square holding the chain
// keeps seeing '_' there (seed4500 step 1098), where the lift-then-drop arm
// erases the memory while the objects are off the map.  No RNG in either arm.
export function move_bc(before, control, ballx, bally, chainx, chainy) {
    const u = game.u;
    const uball = u?.uball, uchain = u?.uchain;
    if (!uball || !uchain) return;

    if (Blind()) {
        if (before) return;             // C: the whole Blind arm is `if (!before)`
        if ((control & BC_CHAIN) && (control & BC_BALL)) {
            /* both moved: drop the felt glyphs, then pick up the new ones */
            if (u.bc_felt & BC_BALL) setMemGlyph(uball.ox, uball.oy, u.bglyph);
            if (u.bc_felt & BC_CHAIN) setMemGlyph(uchain.ox, uchain.oy, u.cglyph);
            u.bc_felt = 0;
            u.bglyph = memGlyph(ballx, bally);
            u.cglyph = memGlyph(chainx, chainy);
            movobj(uball, ballx, bally);
            movobj(uchain, chainx, chainy);
        } else if (control & BC_BALL) {
            if (u.bc_felt & BC_BALL) {
                if (u.bc_order === BCPOS_DIFFER) {
                    setMemGlyph(uball.ox, uball.oy, u.bglyph);
                } else if (u.bc_order === BCPOS_BALL) {
                    // C: map_object(uchain, 0) — the chain is now the top of
                    // the pile the hero is still feeling.
                    if (u.bc_felt & BC_CHAIN)
                        setMemGlyph(uchain.ox, uchain.oy, object_glyph(uchain));
                    else setMemGlyph(uball.ox, uball.oy, u.bglyph);
                }
                u.bc_felt &= ~BC_BALL;
            }
            u.bglyph = (ballx !== chainx || bally !== chainy)
                ? memGlyph(ballx, bally) : u.cglyph;
            movobj(uball, ballx, bally);
        } else if (control & BC_CHAIN) {
            if (u.bc_felt & BC_CHAIN) {
                if (u.bc_order === BCPOS_DIFFER) {
                    setMemGlyph(uchain.ox, uchain.oy, u.cglyph);
                } else if (u.bc_order === BCPOS_CHAIN) {
                    if (u.bc_felt & BC_BALL)
                        setMemGlyph(uball.ox, uball.oy, object_glyph(uball));
                    else setMemGlyph(uchain.ox, uchain.oy, u.cglyph);
                }
                u.bc_felt &= ~BC_CHAIN;
            }
            u.cglyph = (ballx !== chainx || bally !== chainy)
                ? memGlyph(chainx, chainy) : u.bglyph;
            movobj(uchain, chainx, chainy);
        }
        u.bc_order = bc_order();
        return;
    }

    if (before) {
        if (!control) {
            // Neither is moving: remember which was on top until !before.
            u.bc_order = bc_order();
        }
        remove_object(uchain);
        newsym(uchain.ox, uchain.oy);
        if (!carried(uball)) {
            remove_object(uball);
            newsym(uball.ox, uball.oy);
        }
    } else {
        const on_floor = !carried(uball);
        if ((control & BC_CHAIN) || (!control && u.bc_order === BCPOS_CHAIN)) {
            // The chain moved, or nothing moved and the chain was on top.
            if (on_floor) place_object(uball, ballx, bally);
            place_object(uchain, chainx, chainy);   /* chain on top */
        } else {
            place_object(uchain, chainx, chainy);
            if (on_floor) place_object(uball, ballx, bally);
                                                     /* ball on top */
        }
        newsym(chainx, chainy);
        if (on_floor) newsym(ballx, bally);
    }
}

// C ref: ball.c drag_ball(x, y, ...) — decide how the pair follows the hero to
// <x,y>.  Called BEFORE the move, since the chain often wants the hero's old
// square.  Returns null when the caller must abort the move (C's FALSE), else
// { bc_control, ballx, bally, chainx, chainy, cause_delay }.
//
// `allow_drag` is TRUE from domove and FALSE from teleport; it only guards the
// two pathological-geometry escapes in the dist2 == 5 arm.
export async function drag_ball(x, y, allow_drag = true) {
    const u = game.u;
    const uball = u.uball, uchain = u.uchain;
    let ballx = uball.ox, bally = uball.oy;
    let chainx = uchain.ox, chainy = uchain.oy;
    let bc_control = 0;
    let cause_delay = false;

    if (dist2(x, y, uchain.ox, uchain.oy) <= 2) {   /* nothing moved */
        move_bc(1, bc_control, ballx, bally, chainx, chainy);
        return { bc_control, ballx, bally, chainx, chainy, cause_delay };
    }

    // ── only the chain needs to move? ────────────────────────────────────────
    let goto_drag = false;
    if (carried(uball) || distmin(x, y, uball.ox, uball.oy) <= 2) {
        const oldchainx = uchain.ox, oldchainy = uchain.oy;
        bc_control = BC_CHAIN;
        move_bc(1, bc_control, ballx, bally, chainx, chainy);
        if (carried(uball)) {
            /* move chain only if necessary */
            if (distmin(x, y, uchain.ox, uchain.oy) > 1) {
                chainx = u.ux; chainy = u.uy;
            }
            return { bc_control, ballx, bally, chainx, chainy, cause_delay };
        }

        const CHAIN_IN_MIDDLE = (chx, chy) =>
            distmin(x, y, chx, chy) <= 1
            && distmin(chx, chy, uball.ox, uball.oy) <= 1;
        // C's SKIP_TO_DRAG: undo the move_bc() and fall through to the drag code.
        const skip_to_drag = () => {
            chainx = oldchainx; chainy = oldchainy;
            move_bc(0, bc_control, ballx, bally, chainx, chainy);
            goto_drag = true;
        };
        const already_in_rock = IS_CHAIN_ROCK(u.ux, u.uy)
            || IS_CHAIN_ROCK(chainx, chainy)
            || IS_CHAIN_ROCK(uball.ox, uball.oy);

        switch (dist2(x, y, uball.ox, uball.oy)) {
        case 8:
            /* two spaces diagonal from ball: chain goes in between */
            chainx = Math.trunc((uball.ox + x) / 2);
            chainy = Math.trunc((uball.oy + y) / 2);
            if (IS_CHAIN_ROCK(chainx, chainy) && !already_in_rock) skip_to_drag();
            break;
        case 5: {
            /* distance 2/1 from the ball: chain goes to one of the two squares
             * between, whichever is closest to where it already is */
            let tempx, tempy, tempx2, tempy2;
            if (Math.abs(x - uball.ox) === 1) {
                tempx = x; tempx2 = uball.ox;
                tempy = tempy2 = Math.trunc((uball.oy + y) / 2);
            } else {
                tempx = tempx2 = Math.trunc((uball.ox + x) / 2);
                tempy = y; tempy2 = uball.oy;
            }
            const rock1 = IS_CHAIN_ROCK(tempx, tempy);
            const rock2 = IS_CHAIN_ROCK(tempx2, tempy2);
            if (rock1 && !rock2 && !already_in_rock) {
                if (allow_drag) {
                    if (dist2(u.ux, u.uy, uball.ox, uball.oy) === 5
                        && dist2(x, y, tempx, tempy) === 1) { skip_to_drag(); break; }
                    if (dist2(u.ux, u.uy, uball.ox, uball.oy) === 4
                        && dist2(x, y, tempx, tempy) === 2) { skip_to_drag(); break; }
                }
                chainx = tempx2; chainy = tempy2;
            } else if (!rock1 && rock2 && !already_in_rock) {
                if (allow_drag) {
                    if (dist2(u.ux, u.uy, uball.ox, uball.oy) === 5
                        && dist2(x, y, tempx2, tempy2) === 1) { skip_to_drag(); break; }
                    if (dist2(u.ux, u.uy, uball.ox, uball.oy) === 4
                        && dist2(x, y, tempx2, tempy2) === 2) { skip_to_drag(); break; }
                }
                chainx = tempx; chainy = tempy;
            } else if (rock1 && rock2 && !already_in_rock) {
                skip_to_drag();
            } else {
                // Tie-break between the two candidate squares.  The rn2(2) is
                // only drawn when both are equidistant from the chain's current
                // square — C's `||` short-circuits on the strict-less case.
                const d1 = dist2(tempx, tempy, uchain.ox, uchain.oy);
                const d2 = dist2(tempx2, tempy2, uchain.ox, uchain.oy);
                if (d1 < d2 || (d1 === d2 && rn2(2))) {
                    chainx = tempx; chainy = tempy;
                } else {
                    chainx = tempx2; chainy = tempy2;
                }
            }
            break;
        }
        case 4:
            /* ball two spaces orthogonal: chain in between unless already OK */
            if (CHAIN_IN_MIDDLE(uchain.ox, uchain.oy)) break;
            chainx = Math.trunc((x + uball.ox) / 2);
            chainy = Math.trunc((y + uball.oy) / 2);
            if (IS_CHAIN_ROCK(chainx, chainy) && !already_in_rock) skip_to_drag();
            break;
        case 2:
            if (dist2(x, y, uball.ox, uball.oy) === 2
                && dist2(x, y, uchain.ox, uchain.oy) === 4) {
                if (uchain.oy === y) chainx = uball.ox;
                else chainy = uball.oy;
                if (IS_CHAIN_ROCK(chainx, chainy) && !already_in_rock) skip_to_drag();
                break;
            }
            /* FALLTHROUGH */
        case 1:
        case 0:
            if (CHAIN_IN_MIDDLE(uchain.ox, uchain.oy)) break;
            if (CHAIN_IN_MIDDLE(u.ux, u.uy)) { chainx = u.ux; chainy = u.uy; break; }
            /* they must have teleported for this to happen */
            chainx = x; chainy = y;
            break;
        default:
            /* C: impossible("bad chain movement") */
            break;
        }
        if (!goto_drag)
            return { bc_control, ballx, bally, chainx, chainy, cause_delay };
    }

    // ── drag: ────────────────────────────────────────────────────────────────
    const { near_capacity, inventoryArray } = await import('./invent.js');
    if (near_capacity() > SLT_ENCUMBER && dist2(x, y, u.ux, u.uy) <= 2) {
        const { update_topl } = await import('./display.js');
        // C: `gi.invent ? "carry all that and also " : ""`.  The hero's pack is
        // game.invent / game.gi.invent (invent.js inventoryArray()), never
        // game.u.invent — reading the latter made this read "You cannot drag
        // the heavy iron ball." for a hero who is by definition carrying enough
        // to be over SLT_ENCUMBER.
        const has_invent = inventoryArray().length > 0;
        await update_topl(`You cannot ${has_invent ? 'carry all that and also ' : ''}drag the heavy iron ball.`);
        nomul0();
        return null;
    }

    // Being jerked back by the ball when the chain is over water or a pit.  The
    // recorded punished movement is all on dry room floor, so this branch has
    // never fired; it is ported for the geometry, minus the hmon() attack on a
    // monster standing where the hero gets yanked (which needs the full
    // hero-melee damage path).
    // C ref: ball.c — is_pool() is IS_POOL(typ), i.e. POOL..DRAWBRIDGE_UP, not
    // just POOL; the extra `typ == POOL || !is_pool(ball) || ball typ == POOL`
    // clause exempts a chain that merely continues the water the ball is in.
    const chain_is_pool = IS_POOL_AT(uchain.ox, uchain.oy);
    const chainTrap = t_at(uchain.ox, uchain.oy);
    if ((chain_is_pool
         && (at(uchain.ox, uchain.oy)?.typ === POOL
             || !IS_POOL_AT(uball.ox, uball.oy)
             || at(uball.ox, uball.oy)?.typ === POOL))
        || (chainTrap && (is_pit(chainTrap.ttyp) || is_hole(chainTrap.ttyp)))) {
        const { update_topl } = await import('./display.js');
        // C ref: ball.c — a levitating hero is not yanked: it only feels a tug
        // (and the pit becomes seen), then FALLS THROUGH to the drag code below.
        if (game.u?.uprops?.Levitation) {
            await update_topl('You feel a tug from the iron ball.');
            if (chainTrap) chainTrap.tseen = 1;
        } else {
            await update_topl('You are jerked back by the iron ball!');
            u.ux = uchain.ox; u.uy = uchain.oy;
            newsym(u.ux0 ?? u.ux, u.uy0 ?? u.uy);
            nomul0();
            bc_control = BC_BALL;
            move_bc(1, bc_control, ballx, bally, chainx, chainy);
            ballx = uchain.ox; bally = uchain.oy;
            move_bc(0, bc_control, ballx, bally, chainx, chainy);
            return null;
        }
    }

    bc_control = BC_BALL | BC_CHAIN;
    move_bc(1, bc_control, ballx, bally, chainx, chainy);
    if (dist2(x, y, u.ux, u.uy) > 2) {
        /* teleported out of drag range after all — behave like a teleport */
        ballx = chainx = x;
        bally = chainy = y;
    } else {
        // "chain moves to hero's previous location and ball moves to chain's
        // previous location, except that we try to keep the chain directly
        // between the hero and the ball."
        let newchainx = u.ux, newchainy = u.uy;
        if (dist2(x, y, uchain.ox, uchain.oy) === 4
            && !IS_CHAIN_ROCK(newchainx, newchainy)) {
            newchainx = Math.trunc((x + uchain.ox) / 2);
            newchainy = Math.trunc((y + uchain.oy) / 2);
            if (IS_CHAIN_ROCK(newchainx, newchainy)) {
                newchainx = u.ux; newchainy = u.uy;
            }
        }
        ballx = uchain.ox; bally = uchain.oy;
        chainx = newchainx; chainy = newchainy;
    }
    cause_delay = true;
    return { bc_control, ballx, bally, chainx, chainy, cause_delay };
}

// C ref: hack.c nomul(0) — stop any multi-turn action without setting a delay.
// Kept local so ball.js doesn't have to import the whole command module; the
// occupation must stay armed (see LESSONS: nomul(0) leaves go.occupation set).
function nomul0() {
    const g = game;
    if ((g.multi ?? 0) < 0) return;
    g.multi = 0;
    g.multi_reason = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// The rest of src/ball.c — INERT.
//
// Nothing above this banner calls anything below it and no other module
// imports these names yet.
//
// OVERLAP WITH THE LIVE COPIES ABOVE.  placebc() at ball.js:94 and unplacebc()
// at ball.js:118 are REDUCED inlinings of placebc_core()/unplacebc_core():
// they skip the bcrestriction gate, both flooreffects() calls, the Blind
// bc_felt glyph drop, maybe_unhide_at() and the u.uswallow/waterlevel arm, and
// placebc() there does not pick up levl[u.ux][u.uy].glyph into u.bglyph/cglyph.
// The full versions are translated here.  A wiring pass must REPLACE the two
// reduced ones, never add a second caller
// ([[duplicate-reimplementation-shadows-faithful-port]]).
//
// New top-level imports are avoided on purpose: ball.js IS imported by other
// modules, so an added import edge can flip ESM evaluation order and take the
// whole program down ([[_mktrap_victim TDZ is real]]).  Everything below pulls
// its helpers in with a dynamic import at the call site.
// ═══════════════════════════════════════════════════════════════════════════

// C ref: include/hack.h:110 `enum bcargs {override_restriction = -1}`.
export const override_restriction = -1;

// C ref: ball.c:17 `static int bcrestriction = 0`.  BREADCRUMBS is off in this
// build, so the Placebc()/Unplacebc() macro variants and the two
// struct breadcrumbs are absent.
let bcrestriction = 0;

// C ref: include/onames.h HEAVY_IRON_BALL / IRON_CHAIN (js/apply.js:290).
const HEAVY_IRON_BALL = 477, IRON_CHAIN = 478;
// C ref: include/hack.h KILLED_BY_AN / KILLED_BY / NO_KILLER_PREFIX
// (js/const.js:330-332).
const KILLED_BY_AN = 0, KILLED_BY = 1, NO_KILLER_PREFIX = 2;
// C ref: include/obj.h body_part indices (js/const.js:378-379).
const HEAD = 8, LEG = 9;
// C ref: include/attrib.h A_STR (js/const.js:237).
const A_STR = 0;
// W_BALL / W_CHAIN / W_WEAPONS and LEFT_SIDE / RIGHT_SIDE are pulled from
// js/const.js at the call site rather than duplicated: this port DELIBERATELY
// remaps prop.h's W_* bits ([[worn-mask-remap-collision]]), so a transcribed
// literal here would silently disagree with invent.js.
// C ref: include/trap.h u.utraptype values.
const TT_BEARTRAP = 1, TT_PIT = 2, TT_WEB = 3, TT_LAVA = 4, TT_INFLOOR = 5,
      TT_BURIEDBALL = 6;

// C ref: include/youprop.h Punished — u.uball is set only while punished.
function Punished() { return !!game.u?.uball; }
// C ref: include/youprop.h Levitation.
function Levitation() { return !!game.u?.uprops?.Levitation; }

// C ref: mkobj.c flooreffects(obj, x, y, verb) — "the chain/ball might rust".
// UNPORTED in js/ (no flooreffects anywhere); it can only bite over water, lava
// or a pit and every recorded placebc() lands on room floor.  Named rather than
// silently dropped so a wiring pass knows what is missing.
function flooreffects(_obj, _x, _y, _verb) { return false; }

// C ref: mon.c maybe_unhide_at(x, y) — the faithful port is module-private at
// js/monmove.js:1910 (js/invent.js:1170 is a stub); export that one when wiring.
async function maybe_unhide_at_bc(x, y) {
    const MM = await import('./monmove.js');
    if (typeof MM.maybe_unhide_at === 'function')
        return MM.maybe_unhide_at(x, y);
    return undefined;   /* GAP: monmove.js does not export it */
}

// C ref: hack.c losehp(n, knam, k_format) — HP subtraction plus the death
// path.  There is no exported losehp() in js/: private copies live at
// js/zap.js:2490, js/attrib.js:75, js/dig.js:161, js/artifact.js:1507,
// js/music.js:71, js/fountain.js:795 and js/do.js:503.  Subtract here and name
// the gap; wiring this up means exporting one of those, not adding an eighth.
async function losehp_bc(n, _knam, _kformat) {
    const u = game.u;
    if (!u) return;
    u.uhp = (u.uhp ?? 0) - n;
    if (game.disp) game.disp.botl = 1;
}

// C ref: attrib.c Maybe_Half_Phys(dmg) — halved by Half_physical_damage.
// Module-private at js/zap.js:226 and js/spell.js:544.
function Maybe_Half_Phys(dmg) {
    if (!game.u?.uprops?.Half_physical_damage) return dmg;
    return Math.trunc((dmg + 1) / 2);
}

// C ref: ball.c:22 ballrelease(showmsg) — drop the carried ball out of
// inventory without placing it on the floor.  No RNG.
export async function ballrelease(showmsg) {
    const u = game.u;
    const { welded, freeinv, encumber_msg, setuwep_slot, setuswapwep, setuqwep }
        = await import('./invent.js');
    const { pline } = await import('./display.js');

    if (carried(u.uball) && !welded(u.uball)) {
        if (showmsg)
            await pline('Startled, you drop the iron ball.');
        if (game.uwep === u.uball)
            setuwep_slot(null);            /* setuwep((struct obj *) 0) */
        if (game.uswapwep === u.uball)
            setuswapwep(null);
        if (game.uquiver === u.uball)
            setuqwep(null);
        /* [this used to test 'if (uwep != uball)' but that always passes
           after the setuwep() above] */
        freeinv(u.uball); /* remove from inventory but don't place on floor */
        await encumber_msg();
    }
}

// C ref: ball.c:42 ballfall() — ball&chain might hit hero when falling through
// a trap door.  RNG: rn2(5) for the hit, then rn1(7, 25) for the damage.
export async function ballfall() {
    const u = game.u;
    let gets_hit;
    const { welded, yname, body_part } = await import('./invent.js');
    const { pline } = await import('./display.js');
    const { rn1 } = await import('./rng.js');

    if (!u.uball || (u.uball && carried(u.uball) && welded(u.uball)))
        return;

    gets_hit = (((u.uball.ox !== u.ux) || (u.uball.oy !== u.uy))
                && ((game.uwep === u.uball) ? false : !!rn2(5)));
    await ballrelease(true);
    if (gets_hit) {
        let dmg = rn1(7, 25);

        await pline(`The iron ball falls on your ${body_part(HEAD)}.`);
        if (game.uarmh) {
            const { hard_helmet } = await import('./do_wear.js');
            if (hard_helmet(game.uarmh)) {
                await pline('Fortunately, you are wearing a hard helmet.');
                dmg = 3;
            } else if (game.flags?.verbose) {
                /* C ref: objnam.c Yname2(obj) — "Your <xname>" capitalised, or
                   "<Monster>'s <xname>"; not ported, and a worn helmet is
                   always the hero's. */
                const yn = yname(game.uarmh);
                await pline(`${yn.charAt(0).toUpperCase()}${yn.slice(1)}`
                            + ' does not protect you.');
            }
        }
        await losehp_bc(Maybe_Half_Phys(dmg),
                        'crunched in the head by an iron ball',
                        NO_KILLER_PREFIX);
    }
}

// C ref: ball.c:119 placebc_core() — put the ball & chain under the hero and
// set the ball&chain variables (only needed when blind, "but what the heck").
// Assumes the pair is NOT attached to the object list.  Should not be called
// while swallowed except on the water level.  No RNG.
export async function placebc_core() {
    const u = game.u;

    if (!u.uchain || !u.uball) {
        const { impossible } = await import('./display.js');
        await impossible('Where are your ball and chain?');
        return;
    }

    flooreffects(u.uchain, u.ux, u.uy, ''); /* chain might rust */

    if (carried(u.uball)) { /* the ball is carried */
        u.bc_order = BCPOS_DIFFER;
    } else {
        /* ball might rust -- already checked when carried */
        flooreffects(u.uball, u.ux, u.uy, '');
        place_object(u.uball, u.ux, u.uy);
        u.bc_order = BCPOS_CHAIN;
    }

    place_object(u.uchain, u.ux, u.uy);

    u.bglyph = u.cglyph = memGlyph(u.ux, u.uy); /* pick up glyph */

    newsym(u.ux, u.uy);
    bcrestriction = 0;
}

// C ref: ball.c:146 unplacebc_core() — lift the pair off the map.  No RNG.
export async function unplacebc_core() {
    const u = game.u;
    const { obj_extract_self } = await import('./invent.js');
    const { Is_waterlevel } = await import('./const.js');

    if (u.uswallow) {
        if (Is_waterlevel(u.uz)) {
            /* proceed with the removal from the floor so that movebubbles()
               processing will disregard it as intended; ignore vision */
            if (!carried(u.uball))
                obj_extract_self(u.uball);
            obj_extract_self(u.uchain);
        }
        /* ball&chain not unplaced while swallowed */
        return;
    }

    if (!carried(u.uball)) {
        obj_extract_self(u.uball);
        if (Blind() && (u.bc_felt & BC_BALL)) /* drop glyph */
            setMemGlyph(u.uball.ox, u.uball.oy, u.bglyph);
        await maybe_unhide_at_bc(u.uball.ox, u.uball.oy);
        newsym(u.uball.ox, u.uball.oy);
    }
    obj_extract_self(u.uchain);
    if (Blind() && (u.bc_felt & BC_CHAIN)) /* drop glyph */
        setMemGlyph(u.uchain.ox, u.uchain.oy, u.cglyph);
    await maybe_unhide_at_bc(u.uchain.ox, u.uchain.oy);

    newsym(u.uchain.ox, u.uchain.oy);
    u.bc_felt = 0; /* feel nothing */
}

// C ref: ball.c:179 check_restriction(restriction).
export function check_restriction(restriction) {
    let ret = false;

    if (!bcrestriction || (restriction === override_restriction))
        ret = true;
    else
        ret = (bcrestriction === restriction) ? true : false;
    return ret;
}

// C ref: ball.c:221 unplacebc_and_covet_placebc() — lift the pair and hand the
// caller a pin that the matching lift_covet_and_placebc() must present.
// RNG: rnd(400) for the pin, drawn whenever no restriction is already in place
// (js/mkmaze.js:671 already accounts for this draw).
export async function unplacebc_and_covet_placebc() {
    let restriction = 0;

    if (bcrestriction) {
        const { impossible } = await import('./display.js');
        await impossible('unplacebc_and_covet_placebc denied, already restricted');
    } else {
        const { rnd } = await import('./rng.js');
        restriction = bcrestriction = rnd(400);
        await unplacebc_core();
    }
    return restriction;
}

// C ref: ball.c:235 lift_covet_and_placebc(pin) — the matching put-back.  The
// NH_DEVEL_STATUS paniclog() calls are debug-build only.  No RNG.
export async function lift_covet_and_placebc(pin) {
    const u = game.u;

    if (!check_restriction(pin)) {
        /* paniclog("placebc", "lift_covet_and_placebc denied, <pin mismatch |
           restriction in effect>") */
        return;
    }
    if (u.uchain && u.uchain.where !== 'free') {
        const { impossible } = await import('./display.js');
        await impossible('bc already placed?');
        return;
    }
    await placebc_core();
}

// C ref: ball.c:379 set_bc(already_blind) — the hero is either about to go
// blind or already blind and just punished; set up the ball and chain variables
// so that the pair is "felt".  No RNG.
export function set_bc(already_blind) {
    const u = game.u;
    const ball_on_floor = !carried(u.uball);

    u.bc_order = bc_order(); /* get the order */
    u.bc_felt = ball_on_floor ? (BC_BALL | BC_CHAIN) : BC_CHAIN; /* felt */

    if (already_blind || u.uswallow) {
        u.cglyph = u.bglyph = memGlyph(u.ux, u.uy);
        return;
    }

    /*
     *  Since we can still see, remove the ball&chain and get the glyph that
     *  would be beneath them.  Then put the ball&chain back.  This is pretty
     *  disgusting, but it will work.
     */
    remove_object(u.uchain);
    if (ball_on_floor)
        remove_object(u.uball);

    newsym(u.uchain.ox, u.uchain.oy);
    u.cglyph = memGlyph(u.uchain.ox, u.uchain.oy);

    if (u.bc_order === BCPOS_DIFFER) { /* different locations */
        place_object(u.uchain, u.uchain.ox, u.uchain.oy);
        newsym(u.uchain.ox, u.uchain.oy);
        if (ball_on_floor) {
            newsym(u.uball.ox, u.uball.oy); /* see under ball */
            u.bglyph = memGlyph(u.uball.ox, u.uball.oy);
            place_object(u.uball, u.uball.ox, u.uball.oy);
            newsym(u.uball.ox, u.uball.oy); /* restore ball */
        }
    } else {
        u.bglyph = u.cglyph;
        if (u.bc_order === BCPOS_CHAIN) {
            place_object(u.uball, u.uball.ox, u.uball.oy);
            place_object(u.uchain, u.uchain.ox, u.uchain.oy);
        } else {
            place_object(u.uchain, u.uchain.ox, u.uchain.oy);
            place_object(u.uball, u.uball.ox, u.uball.oy);
        }
        newsym(u.uball.ox, u.uball.oy);
    }
}

// C ref: ball.c:881 drop_ball(x, y) — the punished hero drops or throws the
// iron ball.  Expects the ball to be already placed; should not be called while
// swallowed.  RNG: only the bear-trap arm's rn2(3) and rn1(1000, 500).
export async function drop_ball(x, y) {
    const u = game.u;
    const { pline } = await import('./display.js');
    const { m_at } = await import('./display.js');
    const { rn1 } = await import('./rng.js');

    if (Blind()) {
        /* get the order */
        u.bc_order = bc_order();
        /* pick up glyph */
        u.bglyph = (u.bc_order) ? u.cglyph : memGlyph(x, y);
    }

    if (x !== u.ux || y !== u.uy) {
        const pullmsg = 'The ball pulls you out of the ';
        let t;
        let side;

        if (u.utrap
            && u.utraptype !== TT_INFLOOR && u.utraptype !== TT_BURIEDBALL) {
            const { deltrap, fill_pit, set_wounded_legs }
                = await import('./trap.js');
            switch (u.utraptype) {
            case TT_PIT:
                await pline(`${pullmsg}pit!`);
                break;
            case TT_WEB:
                await pline(`${pullmsg}web!`);
                /* Soundeffect(se_destroy_web, 30) — sound.c is not ported */
                await pline('The web is destroyed!');
                deltrap(t_at(u.ux, u.uy));
                break;
            case TT_LAVA:
                /* C: hliquid("lava") — Hallucination renames it */
                await pline(`${pullmsg}lava!`);
                break;
            case TT_BEARTRAP: {
                const { LEFT_SIDE, RIGHT_SIDE } = await import('./const.js');
                side = rn2(3) ? LEFT_SIDE : RIGHT_SIDE;
                await pline(`${pullmsg}bear trap!`);
                await set_wounded_legs(side, rn1(1000, 500));
                if (!u.usteed) {
                    const { body_part } = await import('./invent.js');
                    await pline(`Your ${(side === LEFT_SIDE) ? 'left' : 'right'}`
                                + ` ${body_part(LEG)} is severely damaged.`);
                    await losehp_bc(Maybe_Half_Phys(2),
                        'leg damage from being pulled out of a bear trap',
                        KILLED_BY);
                }
                break;
            }
            default:
                break;
            }
            /* C ref: trap.c reset_utrap(TRUE) — module-private at
               js/dothrow.js:166 and js/read.js:1074; clear the fields here. */
            u.utrap = 0;
            u.utraptype = 0;
            fill_pit(u.ux, u.uy);
        }

        u.ux0 = u.ux;
        u.uy0 = u.uy;
        if (!Levitation() && !m_at(x, y) && !u.utrap
            && (IS_POOL_AT(x, y)
                || ((t = t_at(x, y))
                    && (is_pit(t.ttyp)
                        || is_hole(t.ttyp))))) {
            u.ux = x;
            u.uy = y;
        } else {
            u.ux = x - u.dx;
            u.uy = y - u.dy;
        }
        game.vision_full_recalc = 1; /* hero has moved, recalc vision later */

        if (Blind()) {
            /* drop glyph under the chain */
            if (u.bc_felt & BC_CHAIN)
                setMemGlyph(u.uchain.ox, u.uchain.oy, u.cglyph);
            u.bc_felt = 0; /* feel nothing */
            /* pick up new glyph */
            u.cglyph = (u.bc_order) ? u.bglyph : memGlyph(u.ux, u.uy);
        }
        movobj(u.uchain, u.ux, u.uy); /* has a newsym */
        if (Blind()) {
            u.bc_order = bc_order();
        }
        newsym(u.ux0, u.uy0); /* clean up old position */
        if (u.ux0 !== u.ux || u.uy0 !== u.uy) {
            const { spoteffects } = await import('./trap.js');
            await spoteffects(true);
        }
    }
}

// C ref: ball.c:964 litter() — ball&chain cause hero to randomly lose stuff
// from inventory on the way downstairs.  RNG: one rnd(capacity) per carried
// item that isn't the ball.
export async function litter() {
    const { weight_cap, canletgo, setnotworn, hitfloor, yname, otense,
            freeinv, inventoryArray } = await import('./invent.js');
    const { pline } = await import('./display.js');
    const { rnd } = await import('./rng.js');
    const capacity = weight_cap();
    const u = game.u;

    /* C walks gi.invent through ->nobj, capturing nextobj first because the
       body can unlink otmp; a copy of the array is the same thing here. */
    for (const otmp of inventoryArray().slice()) {
        if (otmp !== u.uball && rnd(capacity) <= (otmp.owt | 0)) {
            if (await canletgo(otmp, '')) {
                await pline(`You drop ${yname(otmp)} and`
                    + ` ${(otmp.quan === 1) ? 'it' : 'they'}`
                    + ` ${otense(otmp, 'fall')} down the stairs with you.`);
                if (typeof setnotworn === 'function') setnotworn(otmp);
                freeinv(otmp);
                if (typeof hitfloor === 'function') await hitfloor(otmp, false);
            }
        }
    }
}

// C ref: ball.c:985 drag_down() — the punished hero goes downstairs.
// RNG order: rn2(3) only when uwep is neither the ball nor NULL, then either
// rn2(6) (forward) or rn2(2) followed by rnd(6) (backward), with each surviving
// branch drawing its own damage roll and then litter()'s per-item rnd().
export async function drag_down() {
    const u = game.u;
    let forward;
    let dragchance = 3;
    const { pline } = await import('./display.js');
    const { rnd } = await import('./rng.js');
    const { welded } = await import('./invent.js');

    /*
     *  Assume that the ball falls forward if:
     *  a) the character is wielding it, or
     *  b) the character has both hands available to hold it (i.e. is not
     *     wielding any weapon), or
     *  c) (perhaps) it falls forward out of his non-weapon hand
     */
    forward = carried(u.uball)
        && (game.uwep === u.uball || !game.uwep || !rn2(3));

    if (carried(u.uball) && !welded(u.uball))
        await pline('You lose your grip on the iron ball.');

    {   /* previous level is still displayed although you went down the
           stairs.  Avoids bug C343-20 */
        const { cls } = await import('./display.js');
        await cls();
    }

    if (forward) {
        if (rn2(6)) {
            await pline('The iron ball drags you downstairs!');
            await losehp_bc(Maybe_Half_Phys(rnd(6)),
                            'dragged downstairs by an iron ball',
                            NO_KILLER_PREFIX);
            await litter();
        }
    } else {
        if (rn2(2)) {
            /* Soundeffect(se_iron_ball_hits_you, 25) */
            await pline('The iron ball smacks into you!');
            await losehp_bc(Maybe_Half_Phys(rnd(20)), 'iron ball collision',
                            KILLED_BY_AN);
            const { exercise } = await import('./attrib.js');
            exercise(A_STR, false);
            dragchance -= 2;
        }
        if (dragchance >= rnd(6)) {
            await pline('The iron ball drags you downstairs!');
            await losehp_bc(Maybe_Half_Phys(rnd(3)),
                            'dragged downstairs by an iron ball',
                            NO_KILLER_PREFIX);
            const { exercise } = await import('./attrib.js');
            exercise(A_STR, false);
            await litter();
        }
    }
}

// C ref: ball.c:1033 bc_sanity_check() — #sanity's ball&chain audit.  No RNG.
export async function bc_sanity_check() {
    const u = game.u;
    const { impossible } = await import('./display.js');
    const { W_BALL, W_CHAIN, W_WEAPONS } = await import('./const.js');
    let otyp, freeball, freechain;
    let onam;

    if (Punished() && (!u.uball || !u.uchain)) {
        await impossible(`Punished without ${!u.uball ? 'iron ball' : ''}`
            + `${(!u.uball && !u.uchain) ? ' and ' : ''}`
            + `${!u.uchain ? 'attached chain' : ''}?`);
    } else if (!Punished() && (u.uball || u.uchain)) {
        await impossible(`Attached ${u.uchain ? 'chain' : ''}`
            + `${(u.uchain && u.uball) ? ' and ' : ''}`
            + `${u.uball ? 'iron ball' : ''} without being Punished?`);
    }
    /* ball is free when swallowed, when changing levels or during air bubble
       management on Plane of Water, other times? */
    freechain = (!u.uchain || u.uchain.where === 'free');
    freeball = (!u.uball || u.uball.where === 'free'
                /* lie to simplify the testing logic */
                || (freechain && u.uball.where === 'invent'));
    if (u.uball && (u.uball.otyp !== HEAVY_IRON_BALL
                    || (u.uball.where !== 'floor'
                        && u.uball.where !== 'invent'
                        && u.uball.where !== 'free')
                    || (!!freeball !== !!freechain)      /* freeball ^ freechain */
                    || ((u.uball.owornmask & W_BALL) === 0)
                    || ((u.uball.owornmask & ~(W_BALL | W_WEAPONS)) !== 0))) {
        otyp = u.uball.otyp;
        /* C ref: objnam.c safe_typename(otyp) — UNPORTED; the otyp alone is
           enough to identify the row. */
        onam = `otyp ${otyp}`;
        await impossible(`uball: type ${otyp} (${onam}), where`
            + ` ${u.uball.where}, wornmask=0x`
            + `${(u.uball.owornmask >>> 0).toString(16).padStart(8, '0')}`);
    }
    /* similar check to ball except can't be in inventory */
    if (u.uchain && (u.uchain.otyp !== IRON_CHAIN
                     || (u.uchain.where !== 'floor'
                         && u.uchain.where !== 'free')
                     || (!!freechain !== !!freeball)
                     /* [could simplify this to owornmask != W_CHAIN] */
                     || ((u.uchain.owornmask & W_CHAIN) === 0)
                     || ((u.uchain.owornmask & ~W_CHAIN) !== 0))) {
        otyp = u.uchain.otyp;
        onam = `otyp ${otyp}`;
        await impossible(`uchain: type ${otyp} (${onam}), where`
            + ` ${u.uchain.where}, wornmask=0x`
            + `${(u.uchain.owornmask >>> 0).toString(16).padStart(8, '0')}`);
    }
    if (u.uball && u.uchain && !(freeball && freechain)) {
        let bx, by, cx, cy, bdx, bdy, cdx, cdy;

        /* non-free chain should be under or next to the hero; non-free ball
           should be on or next to the chain or else carried */
        cx = u.uchain.ox; cy = u.uchain.oy;
        cdx = cx - u.ux; cdy = cy - u.uy;
        cdx = Math.abs(cdx); cdy = Math.abs(cdy);
        if (u.uball.where === 'invent') /* carried(uball) */
            { bx = u.ux; by = u.uy; }   /* get_obj_location() */
        else
            { bx = u.uball.ox; by = u.uball.oy; }
        bdx = bx - cx; bdy = by - cy;
        bdx = Math.abs(bdx); bdy = Math.abs(bdy);
        if (cdx > 1 || cdy > 1 || bdx > 1 || bdy > 1)
            await impossible(`b&c distance: you@<${u.ux},${u.uy}>,`
                + ` chain@<${cx},${cy}>, ball@<${bx},${by}>`);
    }
    /* [check bc_order too?] */
}
