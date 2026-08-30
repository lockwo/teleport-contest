// hack.js — multi-turn movement: run (capital HJKL / 'G' prefix), rush ('g'
// prefix) and travel ('_' / #travel).  Mirrors the run/travel machinery that
// is spread across hack.c (domove_core, lookaround, end_running,
// findtravelpath) and the moveloop_core() run continuation in allmain.c.
//
// In the C engine a run command sets svc.context.run and gm.multi, performs
// the first domove() in rhack(), and then allmain.c moveloop_core() keeps
// calling lookaround()+domove() while gm.multi stays positive.  The recorded
// tty session only captures a screen at each tty_nhgetch(); during a run no
// nhgetch() happens, so the whole run renders as a *single* recorded screen
// (the state after the run stops).  We therefore execute the entire run inline
// here — first move plus every continuation move, with the once-per-turn
// machinery (moveloop_turn) run between moves — so that the next nhgetch()
// capture sees the final post-run state with the exact cumulative RNG.

import { game } from './gstate.js';
import { t_at as t_at_hk, trap_explanation as trap_explanation_hk } from './trap.js';
import { domove, blocksMove, test_move_quiet } from './cmd.js';
import { moveloop_turn } from './allmain.js';
import { m_at, vobj_at, covers_objects, object_glyph, flush_screen, newsym, pline, update_topl, topl_more, wrap_topl, y_n, docrt, show_glyph_cell, terrain_background_glyph, getpos_is_feature_sym, getpos_find_feature } from './display.js';
import { obj_doname, whatis_pick_inventory, carried_weight, inventoryArray, is_pick, ansimpleoname,
         floor_object_name, doname_vague_quan, distant_name_pub } from './invent.js';
import { rnd } from './rng.js';
import { vision_recalc, Blind, couldsee, cansee } from './vision.js';
import { nhgetch } from './input.js';
import { is_safemon, canspotmon } from './uhitm.js';
import { distant_monnam, ARTICLE_NONE } from './do_name.js';
import { dist2, distmin } from './hacklib.js';
import { worm_seg_at } from './worm.js';
import { monster_by_pmidx } from './makemon.js';
import { amorphous_flag, throws_rocks_flag } from './monflags_data.js';
import { roles, races } from './role.js';
import { DATABASE_ENTRIES } from './data_base_data.js';
import { NO_COLOR, ATR_INVERSE, DEC_TO_UNICODE, CLR_WHITE } from './terminal.js';
import { teleok_hero, teleds_hero, safe_teleds_hero } from './read.js';
import { COLNO, ROWNO, STONE, ROOM, CORR, DOOR, ICE, STAIRS, FOUNTAIN,
         POOL, MOAT, WATER, LAVAPOOL, LAVAWALL,
         D_CLOSED, D_LOCKED, D_ISOPEN, D_BROKEN, D_NODOOR, IRONBARS,
         TREE, SDOOR, SCORR, THRONE, SINK, GRAVE, ALTAR,
         DRAWBRIDGE_UP, DRAWBRIDGE_DOWN,
         AM_MASK, AM_SANCTUM, Amask2align, A_LAWFUL, A_NEUTRAL, A_CHAOTIC, A_NONE,
         IS_WALL, IS_DOOR, IS_OBSTRUCTED, IS_FURNITURE, IS_AIR, IS_POOL, IS_LAVA,
         IS_WATERWALL, In_sokoban, Is_rogue_level, CLOUD, Is_airlevel,
         Is_waterlevel, isok, VIBRATING_SQUARE, STRAT_WAITMASK, I_SPECIAL } from './const.js';

// Imports used only by the hack.c completeness block at the bottom of this file.
import { ROOMOFFSET, MOD_ENCUMBER, SLT_ENCUMBER, FOOT,
         RUN_TPORT, RUN_LEAP, RUN_CRAWL,
         TIP_ENHANCE, TIP_SWIM, TIP_UNTRAP_MON, TIP_GETPOS, NUM_TIPS,
         NHCORE_GETPOS_TIP, M_AP_TYPE, M_AP_FURNITURE, M_AP_OBJECT,
         has_mgivenname } from './const.js';
import { in_rooms } from './shkroom.js';
import { inside_room } from './mkroom.js';
import { DEADMONSTER } from './mon.js';
import { is_pool } from './dbridge.js';
import { water_friction } from './mkmaze.js';
import { xname, carrying, makeplural, near_capacity } from './invent.js';
import { body_part } from './polyself.js';
import { y_monnam, ARTICLE_A, ARTICLE_YOUR, SUPPRESS_SADDLE } from './do_name.js';
import { x_monnam } from './uhitm.js';
import { canseemon_shared } from './display.js';
import { mflags2_of, M2_PNAME, is_hider_flag } from './monflags_data.js';
import { l_nhcore_call } from './nhlua.js';

// Run direction deltas for the capital-letter run commands (and the
// 'G'/'g' prefix followed by a movement key).  C: xdir[]/ydir[].
//   y u    \ | /
//   h l  =  - . -
//   b n    / | \
const RUN_DX = { H: -1, L: 1, J: 0, K: 0, Y: -1, U: 1, B: -1, N: 1 };
const RUN_DY = { H: 0, L: 0, J: 1, K: -1, Y: -1, U: -1, B: 1, N: 1 };

export function isRunKey(ch) {
    return 'HJKLYUBN'.includes(ch);
}

// C ref: monmove.c closed_door() — a door that is shut or locked.
function closed_door(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    return IS_DOOR(loc.typ) && (loc.doormask & (D_CLOSED | D_LOCKED));
}

// C ref: rm.h is_pool_or_lava — water/lava terrain.
function is_pool_or_lava(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    return IS_POOL(loc.typ) || IS_LAVA(loc.typ);
}

// C ref: mondata.h NODIAG(mnum) == (mnum == PM_GRID_BUG).
const PM_GRID_BUG = 116;

// C ref: display.h mon_visible(mon) — (!minvis || See_invisible) && !mundetected
// — PLUS lookaround()'s own M_AP_TYPE guard for a mimic posing as furniture or
// an object.  Deliberately NOT canspotmon(): mon_visible assumes the location
// is seen and ignores telepathy.
function mon_visible(mtmp) {
    if (!mtmp) return false;
    if (mtmp.m_ap_type === 'furniture' || mtmp.m_ap_type === 'obj') return false;
    // See_invisible is spelled three ways across this port (display.js/dogmove.js
    // write u.see_invis, makemon.js u.uprops.See_invisible, mcastu.js
    // u.See_invisible); reading only one would answer FALSE for a hero granted
    // it through either of the others.
    if (mtmp.minvis && !game.u?.see_invis && !game.u?.See_invisible
        && !game.u?.uprops?.See_invisible)
        return false;
    return !mtmp.mundetected;
}

// C ref: monst.h is_door_mappear(mon) — M_AP_FURNITURE showing a CLOSED door
// glyph.  defsym.h indices: S_vcdoor = 15, S_hcdoor = 16.
const S_vcdoor = 15, S_hcdoor = 16;
function is_door_mappear(mtmp) {
    if (mtmp?.m_ap_type !== 'furniture') return false;
    return mtmp.mappearance === S_vcdoor || mtmp.mappearance === S_hcdoor;
}

// C ref: hack.c avoid_moving_on_liquid(x, y, msg) — TRUE when the runner should
// stop rather than step into visible water/lava.  Known_lwalking /
// Known_wwalking are FALSE for a hero without the boots (nothing in this port
// grants either), so the "liquid is safe to traverse" escape reduces to the
// airborne case.  A local copy of cmd.js's identical helper: that one is
// file-private there and cmd.js is a different owner's file.
function avoid_moving_on_liquid(x, y) {
    const u = game.u;
    const loc = game.level?.at(x, y);
    const typ = loc ? loc.typ : STONE;
    const hereTyp = game.level?.at(u.ux, u.uy)?.typ ?? STONE;
    const in_air = !!(u.uprops?.Levitation || u.uprops?.Flying);
    const run = game.context?.run || 0;
    if ((typ === hereTyp
         || (run < 2 && (!IS_LAVA(typ) || in_air))
         || game.context?.travel)
        && in_air /* || Known_lwalking || (is_pool && Known_wwalking) */
        && !(typ === WATER || typ === LAVAWALL))
        return false; // liquid is safe to traverse
    if ((IS_POOL(typ) || IS_LAVA(typ)) && (loc?.seenv || 0))
        return true;
    return false;
}

// C ref: hack.c:2443-2460 avoid_moving_on_trap() — true when <x,y> holds a seen
// trap (other than the vibrating square, which is a trap only in implementation
// and is treated as terrain).  The old `t.ttyp !== undefined` guard was a no-op
// that let a seen vibrating square stop a run.
// C's `msg` parameter prints "You stop in front of <a trap>." when
// flags.mention_walls; that is emitted at cmd.js's avoid_running_into_trap()
// call site instead, since lookaround() here is synchronous and already omits
// every mention_walls message (cf. its closed-door arm, hack.c:3968).
export function avoid_moving_on_trap(x, y) {
    const traps = game.level?.traps || [];
    for (const t of traps) {
        if (t.tx === x && t.ty === y && t.tseen && t.ttyp !== VIBRATING_SQUARE)
            return true;
    }
    return false;
}

// C ref: hack.c end_running() — stop a run/travel: clear context.run and
// (for travel) context.travel / context.mv; cancel gm.multi.
export function end_running(and_travel) {
    const c = game.context;
    if (c.run) c.run = 0;
    if (and_travel) {
        c.travel = c.travel1 = c.mv = 0;
    }
    // C ref: hack.c:4151 `selection_free(gt.travelmap)` — the set of squares
    // this travel session has already stepped through is per-session; a stale
    // one makes the next travel stop with "You stop, unsure which way to go."
    // on its very first step.  Freed unconditionally, NOT under `and_travel`.
    game.travelmap = null;
    if (game.multi > 0) game.multi = 0;
}

// C ref: hack.c nomul() — interrupt a multi-turn action, or (nval < 0) make the
// hero helpless/busy for |nval| turns.  C: `if (multi < nval) return; multi =
// nval;`.  The negative-multi path is needed for #jump (nomul(-1)): the hero is
// "busy jumping" for one turn, so the moveloop runs that turn fully WITHOUT the
// hero acting again — which prevents a Fast hero's leftover movement from being
// spent as a free action right after the jump (the seed4500 jump turns).
export function nomul(nval = 0) {
    if ((game.multi ?? 0) < nval) return;
    game.multi = nval;
    game.context.travel = game.context.travel1 = game.context.mv = 0;
}

// C ref: allmain.c:684 stop_occupation().  This port splits C's single
// go.occupation into one flag per activity, so the table supplies each one's
// set_occupation() txt.
const OCC_SLOTS = [
    ['_search_occupation', 'searching'],           // cmd.c:1847
    ['_wait_occupation', 'waiting'],               // cmd.c:1931
    ['_study_occupation', 'studying'],             // spell.c:639
    ['_wipe_occupation', 'wiping off your face'],  // do.c:2394
];

// C ref: eat.c food_xname(food, the_pfx) — reimplemented here (eat.js keeps its
// copy file-private) so the interrupted-meal line names the food exactly the
// way eat.js's own "You finish eating <X>." does.
async function occ_food_xname(otmp, the_pfx) {
    const mk = await import('./mkobj.js');
    let result;
    if (otmp.otyp === mk.CORPSE) {
        const { monster_by_pmidx } = await import('./makemon.js');
        result = `${monster_by_pmidx(otmp.corpsenm)?.name || 'monster'} corpse`;
    } else {
        result = mk.objects?.[otmp.otyp]?.name || 'food';
    }
    return the_pfx && !/^[A-Z]/.test(result) ? `the ${result}` : result;
}

// C ref: allmain.c moveloop_core():485 `if (gm.multi >= 0 && go.occupation)` —
// is go.occupation set?  Only the slots stop_occupation() can actually clear are
// listed: a wider list would let dochugw() call stop_occupation() on an
// engraving/lock-forcing hero and have it silently do nothing.
export function occupation_active() {
    for (const [slot] of OCC_SLOTS) if (game[slot]) return true;
    return !!game._eat_occupation;
}

export async function stop_occupation(append = false) {
    for (const [slot, txt] of OCC_SLOTS) {
        if (!game[slot]) continue;
        game[slot] = null;
        // update_topl, not pline: C's You("stop %s.") lands on a topline that
        // already holds this turn's messages ("It hits!  You stop waiting."),
        // and only update_topl appends instead of replacing.
        await update_topl(`You stop ${txt}.`);
        nomul(0);
        return;
    }
    // C ref: allmain.c:687 `if (!maybe_finished_meal(TRUE)) You("stop %s.",
    // go.occtxt)` with eat.c:2072's occtxt "eating <food_xname(otmp, TRUE)>".
    // This used to end a meal SILENTLY, so every monster that interrupted the
    // hero mid-meal (monmove.js's two stop_occupation() calls) lost the
    // "You stop eating the food ration." topline C prints.
    if (game._eat_occupation) {
        const v = game.context?.victual;
        // maybe_finished_meal(TRUE): a meal whose bites are already used up is
        // FINISHED here instead (done_eating prints "You finish eating X."),
        // and no "You stop" line is emitted.
        if (v?.piece && (v.usedtime | 0) >= (v.reqtime | 0)) {
            game._eat_occupation = null;   /* C: occupation = 0 for do_reset_eat */
            const { eatfood_step } = await import('./eat.js');
            await eatfood_step();
        } else {
            game._eat_occupation = null;
            const msg = `You stop eating ${
                v?.piece ? await occ_food_xname(v.piece, true) : 'your meal'}.`;
            if (append) await update_topl(msg);
            else await pline(msg);
        }
        nomul(0);
        return;
    }
    if ((game.multi ?? 0) >= 0) nomul(0);
}

// C ref: hack.c lookaround() — examine the 8 cells around the hero after a
// run/travel step and decide whether to stop (nomul) or keep going, possibly
// turning to follow a corridor.
//
// C's flags.mention_walls messages are all omitted (the option is off in every
// recorded config); every control-flow effect they sit next to is kept.
function lookaround() {
    const u = game.u;
    const c = game.context;
    let x0 = 0, y0 = 0, m0 = 1, i0 = 9;
    let corrct = 0, noturn = 0;
    let i;
    let stop = false;

    // C ref: hack.c:3906 — a grid bug that polymorphed mid-run stops dead
    // rather than continuing on a diagonal.  NODIAG(mnum) == (mnum ==
    // PM_GRID_BUG).
    if (u.umonnum === PM_GRID_BUG && u.dx && u.dy) {
        // C's "You cannot move diagonally." pline needs an async topline write
        // that this synchronous scan cannot make; the nomul(0) is the part that
        // steers later RNG.
        nomul(0);
        return;
    }

    // C ref: hack.c:3912 `if (Blind || svc.context.run == 0) return;` — a BLIND
    // runner does no scanning at all: no corridor turn, no stop-for-monster,
    // no stop-for-object.  Dropping the Blind half made a blinded hero follow
    // corridor corners and halt on things it cannot see, putting it on a
    // different square from C for the rest of the session.
    if (Blind() || c.run === 0) return;

    // Mirror C's `goto stop` / `goto bcorr` with labelled loops: STOP breaks
    // the whole scan and ends the run; bcorr is the corridor-accounting block
    // entered by several terrain cases.
    outer:
    for (let x = u.ux - 1; x <= u.ux + 1; x++) {
        for (let y = u.uy - 1; y <= u.uy + 1; y++) {
            const infront = (x === u.ux + u.dx && y === u.uy + u.dy);

            if (!isok(x, y) || (x === u.ux && y === u.uy)) continue;
            // C ref: hack.c:3923 — a grid bug ignores its diagonals entirely.
            if (u.umonnum === PM_GRID_BUG && x !== u.ux && y !== u.uy) continue;

            const loc = game.level?.at(x, y);
            const typ = loc ? loc.typ : STONE;
            const mtmp = m_at(x, y);

            // can we see a monster there?
            // C ref: hack.c:3927 — the test is M_AP_TYPE != FURNITURE/OBJECT
            // && mon_visible(), NOT canspotmon(): a concealed mimic drawn as a
            // wall or an object never stops the run, and a monster sensed only
            // by telepathy/monster-detection (canspotmon's sensemon half) does
            // not either.
            if (mtmp && mon_visible(mtmp)) {
                if ((c.run !== 1 && !is_safemon(mtmp))
                    || (infront && !c.travel)) {
                    stop = true; break outer;
                }
            }

            // stone is never interesting
            if (typ === STONE) continue;
            // ignore the square we're moving away from
            if (x === u.ux - u.dx && y === u.uy - u.dy) continue;

            // bcorr flag: whether this cell should be handled as a corridor
            let bcorr = false;

            // stop for seen traps, sometimes
            if (avoid_moving_on_trap(x, y)) {
                if (c.run === 1) {
                    bcorr = true; // "if you must"
                } else if (infront) {
                    stop = true; break outer;
                }
            }

            if (!bcorr) {
                if (IS_OBSTRUCTED(typ) || typ === ROOM || IS_AIR(typ) || typ === ICE) {
                    continue;
                } else if (closed_door(x, y) || (mtmp && is_door_mappear(mtmp))) {
                    // C ref: hack.c:3963 — a mimic posing as a door counts as
                    // a closed door here.
                    if (x !== u.ux && y !== u.uy) continue; // ignore if diagonal
                    if (c.run !== 1 && !c.travel) { stop = true; break outer; }
                    bcorr = true; // orthogonal to a closed door -> corridor
                } else if (typ === CORR) {
                    bcorr = true;
                } else if (is_pool_or_lava(x, y)) {
                    // C ref: hack.c:4004 — a runner stops at the edge of water
                    // or lava it can see, instead of wading in.  Dropping this
                    // arm let every run walk straight into a known moat.
                    if (infront && avoid_moving_on_liquid(x, y)) {
                        stop = true; break outer;
                    }
                    continue;
                } else {
                    // e.g. objects or trap or stairs
                    if (c.run === 1) {
                        bcorr = true;
                    } else if (c.run === 8) {
                        continue;
                    } else {
                        if (mtmp) continue;
                        if (((x === u.ux - u.dx) && (y !== u.uy + u.dy))
                            || ((y === u.uy - u.dy) && (x !== u.ux + u.dx)))
                            continue;
                        stop = true; break outer;
                    }
                }
            }

            // ---- bcorr: corridor accounting ----
            const here = game.level?.at(u.ux, u.uy);
            if (here && here.typ !== ROOM) {
                if (c.run === 1 || c.run === 3 || c.run === 8) {
                    i = dist2(x, y, u.ux + u.dx, u.uy + u.dy);
                    if (i > 2) continue; // not on/adjacent to where we're going
                    if (corrct === 1 && dist2(x, y, x0, y0) !== 1) noturn = 1;
                    if (i < i0) {
                        i0 = i;
                        x0 = x;
                        y0 = y;
                        m0 = mtmp ? 1 : 0;
                    }
                }
                corrct++;
            }
        }
    }

    if (stop) { nomul(0); return; }

    if (corrct > 1 && c.run === 2) {
        nomul(0); return;
    }
    if ((c.run === 1 || c.run === 3 || c.run === 8)
        && !noturn && !m0 && i0
        && (corrct === 1 || (corrct === 2 && i0 === 1))) {
        // make sure that we do not turn too far
        if (i0 === 2) {
            if (u.dx === y0 - u.uy && u.dy === u.ux - x0) i = 2;       // turn right
            else i = -2;                                              // turn left
        } else if (u.dx && u.dy) {
            if ((u.dx === u.dy && y0 === u.uy) || (u.dx !== u.dy && y0 !== u.uy)) i = -1;
            else i = 1;
        } else {
            if ((x0 - u.ux === y0 - u.uy && !u.dy) || (x0 - u.ux !== y0 - u.uy && u.dy)) i = 1;
            else i = -1;
        }

        i += (u.last_str_turn || 0);
        if (i <= 2 && i >= -2) {
            u.last_str_turn = i;
            u.dx = x0 - u.ux;
            u.dy = y0 - u.uy;
        }
    }
}

// C ref: hack.c:2765-2777 domove_core() — "Don't attack if you're running, and
// can see it; it's fine to displace pets, though".  Called from cmd.js domove()
// at C's position: AFTER impaired_movement() has redirected a confused hero, so
// the square tested is the one actually being entered.  (Testing it before the
// redirect is what made a confused rush swing at its own pet — is_safemon() is
// FALSE for every monster while Confusion is set, so a pet counts as "hostile"
// here and stops the rush without spending the turn.)
export function run_stop_for_monster_at(x, y) {
    if (!game.context?.run) return false;
    const mtmp = m_at(x, y);
    if (mtmp && !is_safemon(mtmp) && canspotmon(mtmp)) {
        nomul(0);
        game.context.move = 0;
        return true;
    }
    return false;
}

// C ref: pickup.c pickup() — "if there's anything here, stop running":
//   if (OBJ_AT(u.ux,u.uy) && svc.context.run && svc.context.run != 8
//       && !svc.context.nopick) nomul(0);
// pickup() runs from spoteffects(TRUE) at the tail of domove_core, i.e. right
// after the hero steps onto the new square.  Without this a run sails straight
// over floor objects instead of halting on them, leaving the hero (and every
// downstream monster-move / pet object scan) on the wrong square.  Only floor
// objects count (a picked-up / contained object keeps stale ox/oy but its
// `where` is no longer OBJ_FLOOR).
function floorObjAt(x, y) {
    const objs = game.level?.objects;
    if (!Array.isArray(objs)) return false;
    for (const o of objs) {
        if (o.ox === x && o.oy === y && (o.where === 'floor' || o.where === 1))
            return true;
    }
    return false;
}
function runStopOnObject() {
    const u = game.u;
    const c = game.context;
    if (!c.run || c.run === 8 || c.nopick) return false;
    if (floorObjAt(u.ux, u.uy)) { nomul(0); return true; }
    return false;
}

// C ref: hack.c domove_core() tail — after a run move onto a door /
// obstruction / furniture (when run < 8), nomul(0) so the run ends after this
// step (its once-per-turn work still runs, then the loop stops).
function runOntoStopTerrain() {
    const u = game.u;
    const c = game.context;
    if (!c.run || c.run >= 8) return false;
    const loc = game.level?.at(u.ux, u.uy);
    if (!loc) return false;
    if (IS_DOOR(loc.typ) || IS_OBSTRUCTED(loc.typ) || IS_FURNITURE(loc.typ)) {
        nomul(0);
        return true;
    }
    return false;
}

// Run the per-turn machinery for the step that just elapsed.  C: the top of
// allmain.c moveloop_core() runs this when svc.context.move is set.
async function takeTurn() {
    await moveloop_turn();
}

// Drive an entire run/travel.  `run` is the C svc.context.run value (1 = run
// via capital-letter / shift-dir, 2 = rush 'g', 3 = run 'G', 8 = travel).
// On entry u.dx/u.dy already hold the initial direction.  Returns nothing;
// game.context.move is left at 0 (all elapsed turns were taken inline, so the
// moveloop must NOT schedule another).
async function run_movement(run) {
    const u = game.u;
    const c = game.context;
    c.run = run;
    c.mv = true;
    u.last_str_turn = 0;
    if (!game.multi) game.multi = Math.max(COLNO, ROWNO);

    // First move (C: performed in rhack()).  The "monster in the way stops the
    // run" test lives inside domove(), after impaired_movement() — see
    // run_stop_for_monster_at().
    await domove(u.dx, u.dy);

    // Continuation loop (C: allmain.c moveloop_core while gm.multi > 0).
    for (;;) {
        if (!c.move) break;            // blocked move: no turn, stop running

        // The move happened: run its once-per-turn machinery.
        runOntoStopTerrain();          // may set game.multi = 0 (door etc.)
        runStopOnObject();             // C pickup(): halt the run on a floor object
        await takeTurn();

        if (game.multi <= 0) break;    // nomul triggered -> stop after this turn

        lookaround();                  // may stop (multi=0) or turn the path
        if (game.multi <= 0) break;

        // C: `if (gm.multi < COLNO && !--gm.multi) end_running(TRUE);` — the
        // `--gm.multi` sits INSIDE the short-circuit, so a run started with
        // gm.multi == max(COLNO,ROWNO) == COLNO never counts down at all; it
        // ends only when lookaround()/domove() stop it.  The old `else`
        // decrement capped every run at COLNO continuation steps.
        if (game.multi < COLNO) {
            game.multi -= 1;
            if (game.multi === 0) { end_running(true); break; }
        }

        await domove(u.dx, u.dy);
    }

    // C ref: allmain.c:380 — a NEGATIVE gm.multi (nh_timeout()'s FUMBLING
    // `slip_or_trip(); nomul(-2)` fired mid-run) is the helpless countdown, and
    // moveloop_core still owes those turns.  Zeroing it here skipped the
    // paralysis turn and returned to the prompt a monster-turn early.
    // travel_walk() (js/hack.js:983) already had this guard.
    const helpless = (game.multi ?? 0) < 0;
    end_running(true);
    // Every elapsed turn was processed inline above; tell the moveloop no
    // further per-turn work is owed for this command.
    if (!helpless) { c.move = 0; game.multi = 0; } else { c.move = 1; }
}

// ─────────────────────────────────────────────────────────────────────────
// findtravelpath() — the travel ('_' / #travel) shortest-path search.
// C ref: hack.c:1266 findtravelpath(), hack.c:991 test_move()'s TEST_TRAV and
// TEST_TRAP modes, hack.c:1531 is_valid_travelpt().
// ─────────────────────────────────────────────────────────────────────────

// C ref: hack.c:67-69 — findtravelpath() modes.
const TRAVP_TRAVEL = 0, TRAVP_GUESS = 1, TRAVP_VALID = 2;
// C ref: hack.h:1316-1319 — test_move() modes.
const DO_MOVE = 0, TEST_TRAV = 2, TEST_TRAP = 3;
// C ref: objects.h — BOULDER's otyp (mkobj.js's value; imported by value so
// hack.js does not pull the object-creation module into its import cycle).
const BOULDER = 475;
// C ref: monst.h MZ_LARGE (MZ_TINY 0, MZ_SMALL 1, MZ_MEDIUM/MZ_HUMAN 2).
const MZ_LARGE = 3;
// C ref: include/weight.h:22 WT_TOOMUCH_DIAGONAL — carried weight above which
// the hero cannot squeeze through a tight diagonal gap.
const WT_TOOMUCH_DIAGONAL = 600;
// C ref: objects.h — WAN_DIGGING's otyp (mkobj.js's value, see BOULDER above).
const WAN_DIGGING = 428;

// C ref: decl.c:77-82 — xdir[]/ydir[] read through dirs_ord[], i.e. the four
// cardinals (W, N, E, S) before the four diagonals (NW, NE, SE, SW).  The BFS
// explores neighbours in exactly this order and the FIRST direction that
// reaches the hero wins, so this order decides which of several equally-short
// paths the hero actually walks — get it wrong and every subsequent square
// differs from C.
const TRAVEL_DIRS = [
    [-1, 0], [0, -1], [1, 0], [0, 1],    // DIR_W, DIR_N, DIR_E, DIR_S
    [-1, -1], [1, -1], [1, 1], [-1, 1],  // DIR_NW, DIR_NE, DIR_SE, DIR_SW
];

function u_at(x, y) { const u = game.u; return !!u && u.ux === x && u.uy === y; }

// C ref: trap.h t_at(x,y).
function t_at(x, y) {
    for (const t of (game.level?.traps || []))
        if (t.tx === x && t.ty === y) return t;
    return null;
}

// C ref: mkobj.c sobj_at(BOULDER, x, y).  This port keeps level.objects as one
// flat list rather than the per-cell chain invent.js's sobj_at() indexes, so
// scan it the way teleport.js's own copy does.
function boulder_at(x, y) {
    for (const o of (game.level?.objects || []))
        if (o.otyp === BOULDER && o.ox === x && o.oy === y
            && (o.where === 'floor' || o.where === 1)) return true;
    return false;
}

// C ref: hack.c doorless_door(x,y) — a doorway that lacks its door.  Every
// rogue-level doorway counts as having one so diagonal access is barred there.
function doorless_door(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc || !IS_DOOR(loc.typ)) return false;
    if (Is_rogue_level(game.u?.uz)) return false;
    return !((loc.doormask || 0) & ~(D_NODOOR | D_BROKEN));
}

// C ref: hack.h Passes_walls.  No polyform in this port sets it, and cmd.js's
// blocksMove()/domove() ignore phasing too, so the BFS and the actual walk
// agree; kept as a named predicate so the guards below read like C.
function Passes_walls() { return !!game.u?.uprops?.Passes_walls; }

// C ref: monst.h gy.youmonst.data == &mons[u.umonnum], where u_init.c:991 sets
// umonnum = urole.mnum — a real mons[] index.  THIS port stores the 0-based ROLE
// index there (js/u_init.js:1324), so a raw monster_by_pmidx() answered
// "gelatinous cube" (MZ_LARGE) for a Rogue, which made
// cant_squeeze_thru_hero() return 1 for EVERY hero and killed every diagonal
// corridor jog in findtravelpath().  PM_ARCHEOLOGIST is 331 (js/monmove.js:6018).
function youmonst_data() {
    const u = game.u;
    if (u?.Upolyd) return monster_by_pmidx(u.umonnum) || u?.data || null;
    return monster_by_pmidx(331 + (u?.umonnum ?? 0)) || u?.data || null;
}

// C ref: hack.c:937 bad_rock(mdat,x,y).  tunnels(mdat) && may_dig() only
// relaxes this for a rock-eating polyform, which no covered hero takes.
function bad_rock(x, y) {
    const loc = game.level?.at(x, y);
    const typ = loc ? loc.typ : STONE;
    if (In_sokoban(game.u?.uz) && boulder_at(x, y)) return true;
    return IS_OBSTRUCTED(typ) && !Passes_walls();
}

// C ref: hack.c:952 cant_squeeze_thru(&youmonst) — 0 can squeeze, 1 too big,
// 2 possessions won't fit, 3 Sokoban.  is_whirly/noncorporeal/slithy/can_fog
// only matter for a bigmonst polyform (they let a large gaseous form through);
// amorphous covers the ones this port can actually produce.
function cant_squeeze_thru_hero() {
    if (Passes_walls()) return 0;
    const ptr = youmonst_data();
    if (ptr && (ptr.msize ?? 0) >= MZ_LARGE && !amorphous_flag(ptr)) return 1;
    if (carried_weight() > WT_TOOMUCH_DIAGONAL) return 2;
    if (In_sokoban(game.u?.uz)) return 3;
    return 0;
}

// C ref: hack.c:145 could_move_onto_boulder(sx,sy) — used by travel and the
// m<dir> prefix.  squeezeablylightinvent() is `!gi.invent || inv_weight() <=
// -WT_SQUEEZABLE_INV`; with a capacity of a few hundred, only a hero carrying
// literally nothing clears it, which is the `!inventoryArray().length` case.
export function could_move_onto_boulder(sx, sy) {
    const u = game.u;
    if (Passes_walls()) return true;
    if (u?.usteed) return false;
    const ptr = youmonst_data();
    if (ptr && throws_rocks_flag(ptr)) {
        const lev = game.level;
        return !u.dx || !u.dy
            || !(IS_OBSTRUCTED(lev?.at(u.ux, sy)?.typ ?? STONE)
                 && IS_OBSTRUCTED(lev?.at(sx, u.uy)?.typ ?? STONE));
    }
    if (ptr && (ptr.msize ?? MZ_LARGE) < 1 /* MZ_SMALL */) return true; // verysmall
    return !inventoryArray().length;
}

// C ref: worm.c:898 worm_cross(x1,y1,x2,y2) — a diagonal step is blocked when
// two CONSECUTIVE segments of one long worm sit on the two orthogonal corners.
function worm_cross(x1, y1, x2, y2) {
    if (x1 === x2 || y1 === y2) return false;
    const a = m_at(x1, y2) || worm_seg_at(x1, y2);
    if (!a || !a.wormno) return false;
    if ((m_at(x2, y1) || worm_seg_at(x2, y1)) !== a) return false;
    for (let curr = game.level?.wtails?.[a.wormno]; curr; curr = curr.nseg) {
        const wnxt = curr.nseg;
        if (!wnxt) break;
        if (curr.wx === x1 && curr.wy === y2)
            return wnxt.wx === x2 && wnxt.wy === y1;
        if (curr.wx === x2 && curr.wy === y1)
            return wnxt.wx === x1 && wnxt.wy === y2;
    }
    return false;
}

// C ref: hack.c:991 test_move(ux,uy,dx,dy,mode), restricted to the two modes
// findtravelpath() asks about: TEST_TRAV ("could the hero ever walk this step")
// and TEST_TRAP ("would this step cross a known trap or liquid").  The DO_MOVE
// and TEST_MOVE arms live in cmd.js (domove / test_move_quiet); this copy
// prints nothing, opens nothing and pushes nothing.
//
// Note the two mode-specific control-flow quirks that matter:
//   * a CLOSED door is not rejected here — C `goto testdiag`s past the
//     `return FALSE`, so travel may route through doors it will open;
//   * `if (mode == TEST_TRAP) return FALSE` sits BEFORE the boulder block, so
//     TEST_TRAP never reaches it.
function test_move_trav(ux, uy, dx, dy, mode) {
    const x = ux + dx, y = uy + dy;
    if (!isok(x, y)) return false;
    const lev = game.level;
    const tmpr = lev?.at(x, y);
    const typ = tmpr ? tmpr.typ : STONE;

    if (IS_OBSTRUCTED(typ) || typ === IRONBARS) {
        // Passes_walls+may_passwall, Underwater, passes_bars, a rock-eating
        // tunneller and flags.autodig are the only escapes; none is reachable
        // without an intrinsic/polyform this port never grants, and each of the
        // remaining arms returns FALSE for a non-DO_MOVE mode anyway.
        if (!Passes_walls()) return false;
    } else if (IS_DOOR(typ)) {
        // C: Passes_walls / can_ooze / a rock-eating tunneller walk straight
        // through and fall into the testdiag block; everyone else `goto
        // testdiag`s for TEST_TRAV/TEST_TRAP (so travel may route through a
        // door it will have to open) and returns FALSE for the other modes.
        if (closed_door(x, y) && !Passes_walls()
            && mode !== TEST_TRAV && mode !== TEST_TRAP)
            return false;
        /* testdiag: */
        // block_door() (a shopkeeper on their post while the hero owes money)
        // needs ESHK state this port does not keep.
        if (dx && dy && !Passes_walls() && !doorless_door(x, y))
            return false;
    }

    if (dx && dy && bad_rock(ux, y) && bad_rock(x, uy)) {
        if (cant_squeeze_thru_hero() !== 0) return false;
    } else if (dx && dy && worm_cross(ux, uy, x, y)) {
        return false;
    }

    // C ref: hack.c:1180 — "Pick travel path that does not require crossing a
    // trap.  Avoid water and lava using the usual running rules (but not
    // u.ux/u.uy because findtravelpath walks toward u.ux/u.uy)."
    if ((game.context?.run || 0) === 8 && mode !== DO_MOVE && !u_at(x, y)) {
        const t = t_at(x, y);
        if (t && t.tseen && t.ttyp !== VIBRATING_SQUARE)
            return (mode === TEST_TRAP);
        // Known_wwalking / Known_lwalking are FALSE for a hero without the
        // boots, so the "liquid is safe" escape reduces to being airborne.
        if ((tmpr?.seenv || 0) && is_pool_or_lava(x, y)) {
            const airborne = !!(game.u?.uprops?.Levitation || game.u?.uprops?.Flying);
            if (IS_WATERWALL(typ) || typ === LAVAWALL || !airborne)
                return (mode === TEST_TRAP);
        }
    }

    if (mode === TEST_TRAP)
        return false; /* do not move through traps */

    const ust = lev?.at(ux, uy);
    // No diagonal move OUT of a doorway that still has its door.  (block_entry()
    // is the shopkeeper case again.)
    if (dx && dy && !Passes_walls() && ust && IS_DOOR(ust.typ)
        && !doorless_door(ux, uy))
        return false;

    if (boulder_at(x, y) && (In_sokoban(game.u?.uz) || !Passes_walls())) {
        // (the `mode != TEST_TRAV && run >= 2` arm above this one in C is
        // unreachable from here: TEST_TRAP already returned.)
        if (In_sokoban(game.u?.uz))
            return false; /* never travel through boulders in Sokoban */
        // don't pick two boulders in a row, unless there's a way thru
        if (boulder_at(ux, uy)) {
            if (!Passes_walls() && !could_move_onto_boulder(ux, uy)
                && !carrying_digging_tool())
                return false;
        }
    }
    return true;
}

// C ref: hack.c:1247 — `carrying(PICK_AXE) || carrying(DWARVISH_MATTOCK)
// || (carrying(WAN_DIGGING) && !oc_name_known)`; is_pick() covers both digging
// weapons, and an unidentified wand of digging is the third way through.
function carrying_digging_tool() {
    for (const o of inventoryArray()) {
        if (is_pick(o)) return true;
        if (o.otyp === WAN_DIGGING && !o.known) return true;
    }
    return false;
}

// gt.travelmap — the squares this travel session has already stepped through.
// C uses a selection bitmap freed by end_running(); a Set of y*COLNO+x here.
function travelmap_get(x, y) { return !!game.travelmap?.has(y * COLNO + x); }
function travelmap_set(x, y) {
    if (!game.travelmap) game.travelmap = new Set();
    game.travelmap.add(y * COLNO + x);
}

// C ref: hack.c:1266 findtravelpath(mode).  Finds a shortest path from the
// destination (u.tx,u.ty) back to (u.ux,u.uy) and leaves the FIRST step in
// u.dx/u.dy.  Returns TRUE when a path (or, for TRAVP_GUESS, a usable
// approximation) was found.  Consumes no RNG.
function findtravelpath(mode) {
    const u = game.u, c = game.context;
    if (!game.travelmap) game.travelmap = new Set();

    // "if travel to adjacent, reachable location, use normal movement rules" —
    // handled by travel_adjacent_step() below (it is the whole of the covered
    // corpus's adjacent-travel behaviour and is load-bearing), so the BFS is
    // only ever entered for a farther destination or from is_valid_travelpt().

    if (u.tx !== u.ux || u.ty !== u.uy) {
        const travel = new Int16Array(COLNO * ROWNO);
        const stepx = [new Int16Array(COLNO * ROWNO), new Int16Array(COLNO * ROWNO)];
        const stepy = [new Int16Array(COLNO * ROWNO), new Int16Array(COLNO * ROWNO)];
        let tx, ty, ux, uy;
        let n = 1, set = 0, radius = 1;

        // When guessing, the BFS runs FROM the hero and looks for the target;
        // for a real travel step it runs from the target and looks for the hero.
        if (mode === TRAVP_GUESS || mode === TRAVP_VALID) {
            tx = u.ux; ty = u.uy; ux = u.tx; uy = u.ty;
        } else {
            tx = u.tx; ty = u.ty; ux = u.ux; uy = u.uy;
        }

        for (;;) { /* C's `noguess:` label */
            travel.fill(0);
            stepx[0][0] = tx; stepy[0][0] = ty;
            n = 1; set = 0; radius = 1;

            while (n !== 0) {
                let nn = 0;
                for (let i = 0; i < n; i++) {
                    const x = stepx[set][i], y = stepy[set][i];
                    // no diagonal movement for grid bugs
                    const dirmax = (u.umonnum === PM_GRID_BUG) ? 4 : TRAVEL_DIRS.length;
                    let alreadyrepeated = false;

                    for (let dir = 0; dir < dirmax; ++dir) {
                        const nx = x + TRAVEL_DIRS[dir][0];
                        const ny = y + TRAVEL_DIRS[dir][1];

                        // While guessing, only spaces the hero could see are
                        // eligible; without this the hero ping-pongs between two
                        // guesses in sight-blocked geometry (hack.c:1338 note).
                        if (!isok(nx, ny)
                            || (mode === TRAVP_GUESS && !couldsee(nx, ny)))
                            continue;
                        if ((!Passes_walls() && closed_door(x, y))
                            || (boulder_at(x, y) && !could_move_onto_boulder(x, y))
                            || test_move_trav(x, y, nx - x, ny - y, TEST_TRAP)) {
                            // Closed doors and boulders usually cost a turn, so
                            // prefer another path — but keep this square in the
                            // frontier (once) so it stays usable as a last
                            // resort.  C deliberately does NOT stamp travel[][]
                            // for the repeat.
                            if (travel[y * COLNO + x] > radius - 3) {
                                if (!alreadyrepeated) {
                                    stepx[1 - set][nn] = x;
                                    stepy[1 - set][nn] = y;
                                    nn++;
                                    alreadyrepeated = true;
                                }
                                continue;
                            }
                        }
                        if (test_move_trav(x, y, nx - x, ny - y, TEST_TRAV)
                            && ((game.level?.at(nx, ny)?.seenv || 0)
                                || (!Blind() && couldsee(nx, ny)))) {
                            if (nx === ux && ny === uy) {
                                if (mode === TRAVP_TRAVEL || mode === TRAVP_VALID) {
                                    const visited = travelmap_get(x, y);
                                    u.dx = x - ux;
                                    u.dy = y - uy;
                                    if (mode === TRAVP_TRAVEL
                                        && ((x === u.tx && y === u.ty) || visited)) {
                                        nomul(0);
                                        c.run = 8; /* so domove's run checks work */
                                        if (visited)
                                            game._travel_unsure = true;
                                        else
                                            (game.iflags = game.iflags || {}).travelcc = { x: 0, y: 0 };
                                    }
                                    travelmap_set(u.ux, u.uy);
                                    return true;
                                }
                            } else if (!travel[ny * COLNO + nx]) {
                                stepx[1 - set][nn] = nx;
                                stepy[1 - set][nn] = ny;
                                travel[ny * COLNO + nx] = radius;
                                nn++;
                            }
                        }
                    }
                }
                n = nn;
                set = 1 - set;
                radius++;
            }

            if (mode !== TRAVP_GUESS)
                return false;

            // Guessing: walk toward the reachable square closest to the target.
            let px = tx, py = ty;
            let dist = distmin(ux, uy, tx, ty);
            let d2 = dist2(ux, uy, tx, ty);
            let ptrav = COLNO * ROWNO;
            for (let gx = 1; gx < COLNO; ++gx) {
                for (let gy = 0; gy < ROWNO; ++gy) {
                    const ctrav = travel[gy * COLNO + gx];
                    if (!(couldsee(gx, gy) && ctrav > 0)) continue;
                    const nxtdist = distmin(ux, uy, gx, gy);
                    if (nxtdist === dist && ctrav < ptrav) {
                        const nd2 = dist2(ux, uy, gx, gy);
                        if (nd2 < d2) { /* prefer non-zigzag path */
                            px = gx; py = gy; d2 = nd2; ptrav = ctrav;
                        }
                    } else if (nxtdist < dist) {
                        px = gx; py = gy;
                        dist = nxtdist;
                        d2 = dist2(ux, uy, gx, gy);
                        ptrav = ctrav;
                    }
                }
            }

            if (u_at(px, py)) {
                // no guesses, just go in the general direction
                u.dx = Math.sign(u.tx - u.ux);
                u.dy = Math.sign(u.ty - u.uy);
                if (test_move_quiet(u.ux + u.dx, u.uy + u.dy)) {
                    travelmap_set(u.ux, u.uy);
                    return true;
                }
                break; /* goto found */
            }
            tx = px; ty = py;
            ux = u.ux; uy = u.uy;
            mode = TRAVP_TRAVEL;
            /* loop back to `noguess:` */
        }
    }

    /* found: */
    u.dx = 0;
    u.dy = 0;
    nomul(0);
    return false;
}

// C ref: cmd.c dotravel_target() feeding hack.c:1268 findtravelpath()'s
// TRAVP_TRAVEL "if travel to adjacent, reachable location, use normal movement
// rules" fast path.  There end_running(FALSE) clears context.run and nomul(0)
// clears multi BEFORE the step, so the command is a single ORDINARY move (run
// stays 0 for the whole of domove) with context.travel/mv/nopick still set.
// A farther destination falls through to travel_walk() below.  Returns TRUE
// when travel happened (the caller then owes ECMD_TIME).
export async function travel_adjacent_step(tx, ty) {
    const u = game.u, c = game.context;
    u.tx = tx; u.ty = ty;
    const dx = tx - u.ux, dy = ty - u.uy;
    if (!dx && !dy) return false;
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
        u.dx = dx; u.dy = dy; u.dz = 0;
        // C ref: hack.c findtravelpath():1276 — when the fast path's test_move()
        // refuses the step C does NOT abandon the command: it sets
        // context.run = 8 and falls through to the same call's BFS, so an
        // adjacent unreachable destination still spends the turn.
        if (!test_move_quiet(tx, ty)) return await travel_walk();
        c.travel = 1; c.nopick = 1; c.mv = true;
        c.travel1 = 0;                  // domove_core() clears it past findtravelpath
        c.run = 0;                      // end_running(FALSE)
        u.last_str_turn = 0;
        game.multi = 0;                 // end_running(FALSE) + nomul(0)
        // hack.c:1279 — the fast path zeroes travelcc before taking the step.
        (game.iflags = game.iflags || {}).travelcc = { x: 0, y: 0 };
        await domove(dx, dy);
        if (c.move) await moveloop_turn();  // the elapsed turn, taken inline
        // C: reset_cmd_vars() at the top of the next rhack().
        c.run = 0; c.travel = c.travel1 = c.mv = 0; c.nopick = 0;
        c.move = 0;
        game.multi = 0;
        game.travelmap = null;
        return true;
    }
    return await travel_walk();
}

// C ref: cmd.c dotravel_target():5364 plus the allmain.c moveloop_core()
// continuation that keeps calling domove() while gm.multi stays positive.
// Like run_movement() above, the whole walk runs inline here: no nhgetch fires
// between travel steps, so the recorded session sees one screen for the lot.
async function travel_walk() {
    const u = game.u, c = game.context;
    c.travel = 1;
    c.travel1 = 1;
    c.run = 8;
    c.nopick = 1;
    if (!game.multi) game.multi = Math.max(COLNO, ROWNO);
    u.last_str_turn = 0;
    u.dz = 0;
    c.mv = true;
    game._travel_unsure = false;

    let first = true;
    for (;;) {
        // C ref: hack.c domove_core():2724 — findtravelpath() runs at the top
        // of every travel domove(), which is what turns the destination into
        // this step's u.dx/u.dy.
        if (!findtravelpath(TRAVP_TRAVEL))
            findtravelpath(TRAVP_GUESS);
        c.travel1 = 0;
        // C prints this from inside findtravelpath(), i.e. BEFORE the step it
        // just chose is taken; the BFS is synchronous here so it only sets a
        // flag and the topline write happens at C's position.
        if (game._travel_unsure) {
            game._travel_unsure = false;
            await pline('You stop, unsure which way to go.');
        }
        // C ref: cmd.c rhack():3819 — dotravel_target() returns ECMD_TIME and
        // rhack() then forces svc.context.move back to TRUE, so the FIRST
        // domove() of a travel always costs a turn even when it moved nobody:
        // findtravelpath() failing both modes leaves u.dx/u.dy 0 (a move onto
        // one's own square), and test_move(DO_MOVE) refusing a boulder while
        // run == 8 zeroes context.move.  Later steps come from moveloop_core()'s
        // context.mv continuation, which has no such override.
        if (!u.dx && !u.dy) {
            // C ref: hack.c domove() — findtravelpath() failing BOTH modes still
            // leaves a domove() that moves onto the hero's own square, and
            // moveloop_core() spends the turn for it because context.move is
            // still set.  Charging it only on the FIRST iteration left travel
            // one turn short of C whenever a guess-step ran before the path
            // gave out: lp-priest-dwarf key 121 travels (70,7)->(70,6) then
            // fails, so C reads T:25 where we read T:24 -- and row 23 is on
            // every screen, so the whole rest of the session mismatched on that
            // one cell.
            first = false;
            c.move = 1;
            await moveloop_turn();
            break;
        }

        await domove(u.dx, u.dy);
        if (first) { first = false; c.move = 1; }
        if (!c.move) break;          // blocked move: no turn, travel stops
        await moveloop_turn();       // the elapsed turn, taken inline
        if ((game.multi ?? 0) <= 0) break;

        lookaround();
        if ((game.multi ?? 0) <= 0) break;

        // C: `if (gm.multi < COLNO && !--gm.multi) end_running(TRUE);` — travel
        // starts at max(COLNO,ROWNO) == COLNO so this never counts down.
        if (game.multi < COLNO) {
            game.multi -= 1;
            if (game.multi === 0) { end_running(true); break; }
        }
    }

    // A ball-drag (or any other nomul(-n)) leaves the hero helpless: C's
    // moveloop keeps running turns with no command read, so hand those back to
    // moveloop_core() by leaving context.move set instead of zeroing it.
    const helpless = (game.multi ?? 0) < 0;
    end_running(true);
    c.nopick = 0;
    if (!helpless) {
        c.move = 0;
        game.multi = 0;
    } else {
        c.move = 1;
    }
    return true;
}

// C ref: cmd.c do_run_*()/set_move_cmd(dir, 1) reached via the capital-letter
// run keys (and via the 'G' run prefix).  Run until something interesting.
export async function do_run(dx, dy) {
    const u = game.u;
    u.dx = dx;
    u.dy = dy;
    u.dz = 0;
    await run_movement(1);
}

// C ref: cmd.c do_rush_*()/set_move_cmd(dir, 3) — the 'G' run prefix uses
// run==3; the 'g' rush prefix uses run==2.
export async function do_run_prefixed(dx, dy, runval) {
    const u = game.u;
    u.dx = dx;
    u.dy = dy;
    u.dz = 0;
    await run_movement(runval);
}

export { RUN_DX, RUN_DY };

// ─────────────────────────────────────────────────────────────────────────
// getpos() — the cursor-positioning loop shared by ';' farlook, travel ('_')
// and any command that selects a map location (e.g. #jump).
// C ref: getpos.c getpos(); the first-use farlook tip is hack.c handle_tip()
// -> dat/nhcore.lua show_getpos_tip() -> a tty NHW_TEXT window.
// ─────────────────────────────────────────────────────────────────────────

// dat/nhcore.lua show_getpos_tip() text, verbatim (the leading/trailing blank
// lines from the [[...]] block are stripped by the tty text-window code).
const GETPOS_TIP = [
    'Tip: Farlooking or selecting a map location',
    '',
    'You are now in a "farlook" mode - the movement keys move the cursor,',
    'not your character.  Game time does not advance.  This mode is used',
    'to look around the map, or to select a location on it.',
    '',
    'When in this mode, you can press ESC to return to normal game mode,',
    'and pressing ? will show the key help.',
];

// Render the farlook tip as an overlay corner window (the map/status drawn by
// the previous flush_screen show through outside the window's column band).
// C ref: nhlua.c nhl_text() builds the tip as a *NHW_MENU* (create_nhwindow
// NHW_MENU + add_menu_str per line + select_menu(PICK_NONE)), NOT a NHW_TEXT
// window.  wintty.c tty_display_nhwindow uses the H2344_BROKEN corner-menu form
//   offx = min(min(82, cols/2), cols - maxcol - 1), maxcol = max(len)+2
// and process_menu_window draws a leading blank at column offx (via the
// "(void) putchar(' ')" corner branch after cl_end) then the item text at
// offx+1.  The "(end)" morestr sits on the row after the content at offx+1 and
// dmore parks the cursor one past it (offx+1 + len("(end)") + 1).  The message
// window (row 0) is cleared full-width first (tty_clear_nhwindow(WIN_MESSAGE)).
function render_getpos_tip() {
    const disp = game.nhDisplay;
    if (!disp?.putstr) return;

    const lines = GETPOS_TIP;
    // add_menu_str reserves 2 columns (H2344_BROKEN menu item width = len+2).
    let maxcol = 0;
    for (const l of lines) if (l.length + 2 > maxcol) maxcol = l.length + 2;

    const cols = 80;
    let offx = Math.min(Math.min(82, Math.floor(cols / 2)), cols - maxcol - 1);
    if (offx < 0) offx = 0;
    const textCol = offx + 1; // leading blank at offx, item text at offx+1

    const blankCols = (row) => {
        for (let c = offx; c < cols; c++) disp.setCell(c, row, ' ', NO_COLOR, 0);
    };
    for (let c = 0; c < cols; c++) disp.setCell(c, 0, ' ', NO_COLOR, 0); // WIN_MESSAGE

    for (let i = 0; i < lines.length; i++) {
        blankCols(i);
        if (lines[i]) disp.putstr(textCol, i, lines[i], NO_COLOR, 0);
    }
    const endRow = lines.length;
    blankCols(endRow);
    disp.putstr(textCol, endRow, '(end)', NO_COLOR, 0);
    disp.setCursor(textCol + '(end)'.length + 1, endRow);
}

// C ref: hack.c handle_tip(TIP_GETPOS): show the farlook tip the first time
// getpos() is used.  A tty NHW_TEXT window blocks until a window-dismiss key
// (space/return/escape); other keys redraw and wait again.  Each redraw is a
// recorded screen because every readchar fires the capture hook.  Returns
// TRUE if the tip was shown (so the caller forces the goal message).
async function getpos_tip() {
    const c = game.context;
    c.tips = c.tips || 0;
    const TIP_GETPOS = 1 << 4;
    if (c.tips & TIP_GETPOS) return false;
    c.tips |= TIP_GETPOS;

    for (;;) {
        render_getpos_tip();
        const k = await nhgetch();
        if (k === 32 || k === 13 || k === 10 || k === 27) break;
    }
    return true;
}

// C ref: getpos.c:167 getpos_help() — the '?' response inside getpos().  The
// window is create_nhwindow(NHW_MENU) but filled with putstr(), so
// wintty.c:1991 tty_display_nhwindow takes the `if (cw->data || !cw->maxrow)`
// branch and runs process_text_window(), NOT process_menu_window(): morestr is
// "--More--", item width is strlen+1 (wintty.c:2459 n0), and dmore()'s NHW_MENU
// offset of 2 puts the "--More--" at offx+1 with the cursor immediately past
// its last character.
const GETPOS_MORESTR = '--More--';
const GP_VIEW_FILTERS = ['Not limiting targets',
                         'Limiting targets to those in sight',
                         'Limiting targets to those in same area'];

// The getpos option toggles live in iflags, so they persist across getpos()
// calls for the rest of the game.  autodescribe defaults On.
function gp_iflags() {
    const ifl = (game.iflags = game.iflags || {});
    if (ifl.autodescribe === undefined) ifl.autodescribe = true;
    return ifl;
}

// A getpos toggle's pline(): unlike the autodescribe line it leaves the topline
// NEED_MORE, so the goal message that follows has to --More-- past it.
async function gp_pline(msg, cx, cy) {
    await update_topl(msg);
    await flush_screen(1);
    const disp = game.nhDisplay;
    if (disp?.setCursor) disp.setCursor(cx - 1, cy + 1);
}

// C ref: pager.c:1670 what_is_a_location[] — getpos_help() compares the goal
// POINTER against it, so only do_look()'s getpos gets the ',' / ';' / ':' arm.
const WHAT_IS_A_LOCATION = 'a monster, object or location';

function getpos_help_lines(force, goal, doingWhatIs, hasValid, hasHilite) {
    const ifl = gp_iflags();
    const fastmove = ['8 units at a time', 'skipping same glyphs'];
    const skip = ifl.getloc_moveskip ? 1 : 0;
    const menu = !!ifl.getloc_usemenu;
    // getpos.c:129 gloc_filtertxt[] / gloc_descr[gloc][2 + getloc_usemenu].
    const filt = ['', ' in view', ' in this area'][ifl.getloc_filter || 0];
    const kx = (k1, k2, descr, menuDescr, explore) => {
        const to = explore ? 'move the cursor next to an ' : 'move the cursor to ';
        const ftxt = (explore && menu) ? filt.replace('this area', 'area') : filt;
        return `Use '${k1}'/'${k2}' to ${menu ? 'get a menu of ' : to}`
             + `${menu ? menuDescr : descr}${ftxt}.`;
    };
    const lines = [];
    lines.push(`Use 'h', 'j', 'k', 'l' to move the cursor to ${goal}.`);
    lines.push(`Use 'H', 'J', 'K', 'L' to fast-move the cursor, ${fastmove[skip]}.`);
    lines.push(`(or prefix normal move with 'G' or 'g' to fast-move)`);
    lines.push(`Or enter a background symbol (ex. '<').`);
    lines.push(`Use '@' to move the cursor on yourself.`);
    lines.push(kx('m', 'M', 'next/previous monster', 'monsters'));
    // getpos.c:203 `goto skip_non_mons` jumps past everything below down to the
    // "Type a '.'" line, so a "a monster" goal loses the '*'/'!'/'"'/'#' lines.
    if (goal !== 'a monster') {
        lines.push(kx('o', 'O', 'next/previous object', 'objects'));
        lines.push(kx('d', 'D', 'next/previous door or doorway', 'doors or doorways'));
        lines.push(kx('x', 'X', 'unexplored location',
                      'locations next to unexplored locations', true));
        lines.push(kx('a', 'A', 'anything interesting', 'anything interesting'));
        lines.push(`Use '*' to change fast-move mode to ${fastmove[1 - skip]}.`);
        lines.push(`Use '!' to toggle menu listing for possible targets.`);
        lines.push(`Use '"' to change the mode of limiting possible targets.`);
        if (hasValid) lines.push(`Use 'z' or 'Z' to move to valid locations.`);
        if (hasHilite) lines.push(`Use '$' to toggle marking of valid locations.`);
        lines.push(`Use '#' to toggle automatic description.`);
    }
    lines.push(doingWhatIs
        ? `Type a '.' or ',' or ';' or ':' when you are at the right place.`
        : `Type a '.' when you are at the right place.`);
    if (doingWhatIs) {
        lines.push(`  ':' describe current spot, show 'more info', move to another spot.`);
        lines.push(`  '.' describe current spot,${!force ? " prompt if 'more info'," : ''} move to another spot;`);
        lines.push(`  ',' describe current spot, move to another spot;`);
        lines.push(`  ';' describe current spot, stop looking at things;`);
    }
    if (!force) lines.push(`Type Space or Escape when you're done.`);
    lines.push('');
    return lines;
}

// Paint a wintty.c:1810 process_text_window() overlay: cl_end() from offx on
// every row, a leading blank at offx, the text at offx+1, then the morestr row.
function render_text_window(lines) {
    const disp = game.nhDisplay;
    if (!disp?.putstr) return;
    const cols = 80;
    let maxcol = 0;
    for (const l of lines) if (l.length + 1 > maxcol) maxcol = l.length + 1;
    let offx = Math.min(Math.min(82, Math.floor(cols / 2)), cols - maxcol - 1);
    if (offx < 0) offx = 0;
    // wintty.c:1974 — a window as tall as the terminal drops the overlay form.
    if (lines.length >= 24) offx = 0;
    const textCol = offx + 1;

    const blankCols = (row) => {
        for (let c = offx; c < cols; c++) disp.setCell(c, row, ' ', NO_COLOR, 0);
    };
    for (let c = 0; c < cols; c++) disp.setCell(c, 0, ' ', NO_COLOR, 0); // WIN_MESSAGE

    for (let i = 0; i < lines.length; i++) {
        blankCols(i);
        if (lines[i]) disp.putstr(textCol, i, lines[i], NO_COLOR, 0);
    }
    const endRow = lines.length;
    blankCols(endRow);
    disp.putstr(textCol, endRow, GETPOS_MORESTR, NO_COLOR, 0);
    disp.setCursor(textCol + GETPOS_MORESTR.length, endRow);
}

async function getpos_help(force, goal, doingWhatIs, hasValid, hasHilite) {
    // wintty.c:1969 — a pending NEED_MORE topline is acknowledged before the
    // window is raised.
    if (game._toplin === 1) {
        await topl_more();
        game._toplin = 0;
        game._pending_message = '';
    }
    const lines = getpos_help_lines(force, goal, doingWhatIs, hasValid, hasHilite);
    for (;;) {
        render_text_window(lines);
        const k = await nhgetch();               // getline.c xwaitforspace(quitchars)
        if (k === 32 || k === 13 || k === 10 || k === 27) break;
    }
}

// getpos movement keys: hjkl + diagonals (lower and upper case both move the
// cursor here; rush/run prefixes handled separately).  C: movecmd().
const GP_DX = { h: -1, l: 1, j: 0, k: 0, y: -1, u: 1, b: -1, n: 1 };
const GP_DY = { h: 0, l: 0, j: 1, k: -1, y: -1, u: -1, b: 1, n: 1 };

// C ref: cmd.c reset_commands() — dirchars "hykulnjb><"; for each direction
// the rush mode binds Ctrl-<dirchar> (C(di)) and the run mode binds the capital
// (highc(di)).  getpos's movecmd(MV_RUSH)/movecmd(MV_RUN) therefore accept the
// control-char rush keys too — notably Ctrl-J ('\n', 0x0A) which rushes south.
// Map the control byte -> lowercase movement letter so getpos() can fast-move.
const GP_CTRL_RUSH = {
    8: 'h',  // ^H west
    25: 'y', // ^Y northwest
    11: 'k', // ^K north
    21: 'u', // ^U northeast
    12: 'l', // ^L east  (note: ^L is doredraw at top level, but in getpos the
             //           rush binding wins via movecmd() before redraw_cmd())
    14: 'n', // ^N southeast
    10: 'j', // ^J south  (Return / '\n')
    // C ref: sys/share/unixtty.c setftty() — cbreak mode only clears ICANON,
    // leaving ICRNL enabled, so the tty driver maps a raw CR (Enter, 0x0D)
    // to NL (0x0A) before NetHack's readchar() ever sees it.  A recorded
    // '\r' keystroke therefore reaches getpos() as Ctrl-J, i.e. rush south,
    // same as literal '\n'.
    13: 'j', // '\r' (Enter) — tty ICRNL maps it to ^J before the app sees it
    2: 'b',  // ^B southwest
};

// C ref: getpos.c truncate_to_map(cx, cy, dx, dy) — add <dx,dy> to the cursor,
// clamping at the map edges.  A DIAGONAL move that hits one edge shortens the
// OTHER axis by the same amount (it slides back along the diagonal); clamping
// the two axes independently, as this port used to, parks the cursor on a
// different cell for every fast-move that runs off an edge.
function truncate_to_map(cx, cy, dx, dy) {
    const sgn = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
    if (cx + dx < 1) {
        dy -= sgn(dy) * (1 - (cx + dx));
        dx = 1 - cx;
    } else if (cx + dx > COLNO - 1) {
        dy += sgn(dy) * ((COLNO - 1) - (cx + dx));
        dx = (COLNO - 1) - cx;
    }
    if (cy + dy < 0) {
        dx -= sgn(dx) * (0 - (cy + dy));
        dy = 0 - cy;
    } else if (cy + dy > ROWNO - 1) {
        dx += sgn(dx) * ((ROWNO - 1) - (cy + dy));
        dy = (ROWNO - 1) - cy;
    }
    return [cx + dx, cy + dy];
}

// C ref: display.h glyph_at(x, y) — used by getpos()'s moveskip fast-move only
// to compare two cells for equality.  This port has no numeric glyph ids, so
// the DISPLAYED cell identity (char + colour + DEC-graphics flag) stands in.
function gp_glyph_at(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return ' ';
    return `${loc.disp_ch ?? ' '}|${loc.disp_color ?? -1}|${loc.disp_decgfx ? 1 : 0}`;
}

// C ref: pager.c self_lookat() — "<race-adj> <pmname> called <plname>" for the
// hero's own square (Sprintf "%s%s%s called %s").  Not Upolyd here, so the race
// adjective (gu.urace.adj) prefixes the role player-monster name (pmname of
// mons[u.umonnum]); the player name in wizard mode displays as "wizard".  The
// role player-monster name is the role title lowercased (knight, wizard, ...).
function self_lookat() {
    const u = game.u || {};
    // C ref: pager.c:112 — "include race with role unless polymorphed".  While
    // Upolyd, u.umonnum is a real mons[] index and pmname() names the FORM,
    // so a poly'd hero farlooks as e.g. "brown mold called wizard".
    if (u.Upolyd) {
        const ptr = monster_by_pmidx(u.umonnum);
        const plnameP = game.flags?.debug ? 'wizard' : (game.plname || 'Player');
        let bufP = `${ptr?.name || 'creature'} called ${plnameP}`;
        if (u.uball) bufP += `, chained to ${ansimpleoname(u.uball)}`;
        return bufP;
    }
    const rolemnum = u.umonnum ?? game.urole?.mnum;
    const roleDef = roles.find((r) => r.mnum === rolemnum) || {};
    const female = !!game.flags?.female;
    const roleName = (female && roleDef.name?.f) ? roleDef.name.f
                     : (roleDef.name?.m || 'adventurer');
    const pm = String(roleName).toLowerCase();

    // game.initrace is an INDEX into races[] (jsmain.js/role.js set it from the
    // selection), not a name — the name lookup here matched nothing for every
    // non-human race and silently fell back to races[0], so a gnome/elf/dwarf
    // hero farlooked as "human".
    const raceDef = (Number.isInteger(game.initrace)
        ? races[game.initrace]
        : races.find((r) => (r.name || '').toLowerCase()
                            === String(game.initrace || '').toLowerCase()))
        || races[0] || {};
    const raceAdj = raceDef.adj || raceDef.noun || 'human';

    const plname = game.flags?.debug ? 'wizard' : (game.plname || 'Player');
    let buf = `${raceAdj} ${pm} called ${plname}`;
    // C ref: pager.c:127 — `if (Punished) ", chained to <ansimpleoname(uball)>"`.
    // ansimpleoname() names a BARE ball, so a ball made heavier by a second
    // scroll of punishment still reads "a heavy iron ball", not "a very heavy".
    if (game.u?.uball) buf += `, chained to ${ansimpleoname(game.u.uball)}`;
    return buf;
}

// C ref: getpos.c getpos() else-branch — terrain symbol matching (see
// display.js getpos_is_feature_sym/getpos_find_feature for the shared table
// and map scan; factored out there so invent.js's dotravel() getpos() can
// use the same logic without an import cycle through hack.js).

// C ref: include/hack.h distu(x,y) = dist2(x,y,u.ux,u.uy).
function distu(x, y) { return dist2(x, y, game.u.ux, game.u.uy); }

// C ref: pager.c lookat() / do_screen_description() — the (firstmatch)
// description of the terrain shown at <x,y>.  C dispatches on the *displayed*
// glyph (glyph_at(x,y) from gbuf), NOT the underlying levl[x][y].typ, so a cell
// whose true terrain is e.g. a wall but which has never been drawn still reads
// as "unexplored area" (glyph_is_unexplored).  Our display model stores the
// drawn glyph in loc.disp_ch: a cell that was never drawn has disp_ch unset,
// which is C's GLYPH_UNEXPLORED.
function terrain_description(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return 'solid stone';
    // C ref: lookat() glyph_is_unexplored -> "unexplored area".  C dispatches on
    // the displayed glyph (glyph_at, from gbuf), not levl[][].typ.  A cell that
    // the hero has never actually revealed still holds GLYPH_UNEXPLORED in gbuf —
    // even if our display model has painted its (blank/stone) background — so it
    // reads as "unexplored area" regardless of the terrain underneath.  In our
    // model "never revealed" is seenv == 0 with no remembered background glyph;
    // such cells are only ever painted as blank S_stone.
    if (!loc.seenv && loc.remembered_glyph == null) return 'unexplored area';
    // C ref: pager.c:779 — do_screen_description dispatches on the DISPLAYED
    // glyph.  A square drawn BLANK is S_stone (S_darkroom's symbol is '.', not
    // ' '), and every arm of case S_stone answers "stone" once seenv is set:
    // the typ==STONE||SCORR arm directly, and the fallthrough via
    // defsyms[S_stone].explanation, which defsym.h's PCHAR2 row makes "stone"
    // ("dark part of a room" in that row is the TILE name, not the
    // explanation).  Reading levl[][].typ instead made an unfelt corridor
    // under a blind hero read "corridor".
    if (loc.disp_ch === ' ') return loc.seenv ? 'stone' : 'unexplored';
    const typ = loc.typ;
    // C ref: pager.c:779 do_screen_description() case S_stone —
    //     if (!levl[x][y].seenv)                       "unexplored"
    //     else if (Underwater && !Is_waterlevel)       "land"/"unknown"
    //     else if (typ == STONE || typ == SCORR)       "stone"
    //     else FALLTHROUGH to defsyms[S_stone].explanation ("dark part of a
    //         room" -- i.e. a remembered ROOM square drawn as blank, which the
    //         ROOM arm below handles on its own).
    // So real rock is "stone", never "dark part of a room" and never the
    // "solid stone" wording (that string is hack.c's movement message).
    // Underwater is not modelled (no covered hero is submerged).
    if (typ === STONE) return loc.seenv ? 'stone' : 'unexplored';
    { const _t = t_at_hk(x, y); if (_t && _t.tseen) return trap_explanation_hk(_t.ttyp); }
    if (IS_WALL(typ)) return 'wall';
    if (typ === DOOR) {
        if (loc.doormask & (D_CLOSED | D_LOCKED)) return 'closed door';
        if (loc.doormask & D_ISOPEN) return 'open door';
        return loc.doormask & D_BROKEN ? 'broken door' : 'doorway';
    }
    if (typ === CORR) return loc.lit ? 'lit corridor' : 'corridor';
    if (typ === ROOM) {
        // C ref: display.c back_to_glyph() gives every ROOM square S_room, and
        // newsym():1086 rewrites it to S_darkroom on the OUT-OF-SIGHT path when
        // `!lev->waslit || (flags.dark_room && iflags.use_color)` — both of
        // those options default on.  do_screen_description() then dispatches on
        // that DISPLAYED glyph, so what decides the wording is whether the hero
        // can see the square right now, not whether the room is lit: an unlit
        // square seen by night vision still reads "floor of a room", and every
        // remembered square outside the hero's sight reads "dark part of a
        // room" even in a permanently lit room.
        if (cansee(x, y)) return 'floor of a room';
        const dark_opt = (game.flags?.dark_room !== false)
                         && (game.flags?.color !== false);
        return (!loc.waslit || dark_opt) ? 'dark part of a room'
                                         : 'floor of a room';
    }
    if (typ === ICE) return 'ice';
    // C ref: pager.c do_screen_description S_pool/S_water/S_lava/S_lavawall
    // glyph branch -> waterbody_name(x, y), which dispatches on SURFACE_AT (==
    // levl[][].typ for a non-drawbridge cell).  Non-hallucinating names below;
    // the special-level moat variants (medusa "shallow sea", juiblex "swamp",
    // samurai-quest-home "pond") and hallucinated liquids are not modelled.
    if (typ === LAVAPOOL) return 'molten lava';
    if (typ === LAVAWALL) return 'wall of lava';
    if (typ === POOL) return 'pool of water';
    if (typ === MOAT) return 'moat';
    if (typ === WATER)
        return Is_waterlevel(game.u?.uz) ? 'limitless water' : 'wall of water';
    if (typ === STAIRS) {
        const sd = stair_descr(x, y);
        // C ref: pager.c do_screen_description():1604 — lookat()'s "staircase
        // down" is rewritten on the quest start level for a hero the leader has
        // not yet sent on the quest, matching goto_level()'s own refusal.
        return (sd === 'staircase down' && on_qstart_level_hk() && !ok_to_quest_hk())
               ? 'blocked staircase down' : sd;
    }
    if (typ === FOUNTAIN) return 'fountain';
    // C ref: defsym.h PCHAR desc field (defsyms[].explanation), the string
    // do_screen_description() hands back as *firstmatch for a single cmap
    // match.  Without these the catch-all below described a tree as "floor of
    // a room" (seed0367 step 155, autodescribe over the Priest quest home).
    if (typ === TREE) return 'tree';
    // C ref: pager.c lookat():765 case S_cloud — CLOUD gets its own wording
    // rather than defsyms[S_cloud].explanation ("cloud"); '#' shares its symbol
    // with corridor/bars/tree so found>1 always sends S_cloud through lookat().
    if (typ === CLOUD)
        return Is_airlevel(game.u?.uz) ? 'cloudy area' : 'fog/vapor cloud';
    if (typ === IRONBARS) return 'iron bars';
    if (typ === THRONE) return 'opulent throne';
    if (typ === SINK) return 'sink';
    if (typ === GRAVE) return 'grave';
    if (typ === ALTAR) {
        // C ref: pager.c lookat():744 — S_altar sets need_to_look, so firstmatch
        // becomes lookat()'s "%s %saltar" rather than the bare defsyms text.
        const amsk = (loc.altarmask ?? loc.flags ?? 0);
        const algn = Amask2align(amsk & AM_MASK);
        const an_ = algn === A_CHAOTIC ? 'chaotic' : algn === A_NEUTRAL ? 'neutral'
                  : algn === A_LAWFUL ? 'lawful' : algn === A_NONE ? 'unaligned' : 'unknown';
        return `${an_} ${(amsk & AM_SANCTUM) ? 'high ' : ''}altar`;
    }
    // Secret doors/corridors are DISPLAYED as their concealing terrain, and C
    // dispatches on the displayed glyph.
    if (typ === SDOOR) return 'wall';
    // pager.c:788 groups SCORR with STONE in the same "stone" arm.
    if (typ === SCORR) return loc.seenv ? 'stone' : 'unexplored';
    if (typ === DRAWBRIDGE_UP) return 'raised drawbridge';
    if (typ === DRAWBRIDGE_DOWN) return 'lowered drawbridge';
    return 'floor of a room';
}

// C ref: hack.c:1531 is_valid_travelpt() — the hero's own spot is always valid;
// a cell whose remembered glyph is still unlit solid stone has no travel path.
// Everything else is decided by findtravelpath(TRAVP_VALID), a BFS from the
// hero out to <x,y> over test_move(TEST_TRAV); it consumes no RNG but does
// answer FALSE for an explored-yet-unreachable square (a walled-off room),
// which the old "explored means reachable" shortcut got wrong.
function is_valid_travelpt(x, y) {
    const u = game.u;
    if (u && x === u.ux && y === u.uy) return true;
    const loc = game.level?.at(x, y);
    if (loc && !loc.seenv && loc.remembered_glyph == null) return false;
    const tx = u.tx, ty = u.ty;
    u.tx = x; u.ty = y;
    const ret = findtravelpath(TRAVP_VALID);
    u.tx = tx; u.ty = ty;
    return ret;
}

// C ref: pager.c lookat() glyph_is_object branch -> look_at_object().  When the
// displayed glyph at <x,y> is a floor object (e.g. a STATUE drawn as the
// petrified monster's class letter), lookat names that object via
// distant_name(otmp, doname) rather than the terrain underneath — so a statue
// of a plains centaur reads "a statue of a plains centaur", not "floor of a
// room".  We mirror C's _map_location object priority: an object is the drawn
// background glyph only when present and not hidden by deep water/lava
// (covers_objects).  A spotted monster on the cell is drawn on top (handled by
// the caller before this, matching lookat's glyph_is_monster precedence), so
// this is only consulted when no monster occupies the displayed glyph.  Returns
// the object's name, or null when no floor object is shown.  look_at_object's
// terrain suffixes (" in water", " embedded in ...") do not apply to a statue
// on ordinary room floor and are omitted.
function look_at_object_here(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return null;
    // C: object only shown (and thus only named) when the cell has been
    // revealed; an unexplored cell reads as "unexplored area" via terrain.
    if (!loc.seenv && loc.remembered_glyph == null) return null;
    if (covers_objects(loc)) return null;
    const obj = vobj_at(x, y);
    if (!obj) return null;
    // C ref: pager.c look_at_object() — distant_name(otmp, otmp->dknown ?
    // doname_with_price : doname_vague_quan).  A floor stack the hero has not
    // examined up close reads "some gold pieces", not the exact count.
    return distant_name_pub(obj, obj.dknown ? floor_object_name : doname_vague_quan);
}

// C ref: stairs.c known_branch_stairs() + defsym.h S_upstair/S_dnstair vs
// S_brupstair/S_brdnstair.  A staircase that leads to a different dungeon
// branch and has been traversed by the hero is reported as a "branch
// staircase up/down"; an ordinary staircase is "staircase up/down".  Mirrors
// display.js terrain_glyph(STAIRS) / known_branch_stairs.
function stairway_at_local(x, y) {
    for (let s = game.stairs; s; s = s.next)
        if (s.sx === x && s.sy === y) return s;
    return null;
}
function known_branch_stairs_local(sway) {
    return !!(sway && sway.tolev
        && sway.tolev.dnum !== (game.u?.uz?.dnum ?? 0)
        && sway.u_traversed);
}
// C ref: dungeon.c on_level(&u.uz, &qstart_level) — game.qstart_level is filled
// in by dungeon.js's branch table.
function on_qstart_level_hk() {
    const uz = game.u?.uz, q = game.qstart_level;
    return !!(uz && q && uz.dnum === q.dnum && uz.dlevel === q.dlevel);
}

// C ref: quest.c ok_to_quest() — `((got_quest || got_thanks) && is_pure() > 0)
// || killed_leader`.  questpgr.js tracks got_quest; the other two flags have no
// counterpart here, and neither can be true before got_quest is.
function ok_to_quest_hk() { return !!game._quest_got_quest; }

function stair_descr(x, y) {
    const up = (game.level?.upstair?.x === x && game.level?.upstair?.y === y);
    const sway = stairway_at_local(x, y);
    const branch = known_branch_stairs_local(sway);
    if (branch) return up ? 'branch staircase up' : 'branch staircase down';
    return up ? 'staircase up' : 'staircase down';
}

// C ref: dothrow.c walk_path() — Bresenham line from src to dest, calling
// check() at each intermediate cell; returns false (blocked) at the first
// cell where check() fails.  Used by the jump validity test.
function walk_path(sx, sy, dx0, dy0, check) {
    let dx = dx0 - sx, dy = dy0 - sy;
    let x = sx, y = sy;
    let xchg = dx < 0 ? -1 : 1; if (dx < 0) dx = -dx;
    let ychg = dy < 0 ? -1 : 1; if (dy < 0) dy = -dy;
    let i = 0, err = 0;
    let keep = true;
    if (dx < dy) {
        while (i++ < dy) {
            y += ychg; err += dx << 1;
            if (err > dy) { x += xchg; err -= dy << 1; }
            if (!(keep = check(x, y))) break;
        }
    } else {
        while (i++ < dx) {
            x += xchg; err += dy << 1;
            if (err > dx) { y += ychg; err -= dx << 1; }
            if (!(keep = check(x, y))) break;
        }
    }
    return keep;
}

// C ref: apply.c check_jump() callback — a non-passable cell (wall / closed
// door / boulder) blocks the jump trajectory.  Open-door trajectory rules are
// omitted (no open doors on the owned jump path).
function check_jump(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    const typ = loc.typ;
    if (IS_OBSTRUCTED(typ)) return false; // includes walls / stone
    if (typ === DOOR && (loc.doormask & (D_CLOSED | D_LOCKED))) return false;
    return true;
}

// C ref: apply.c is_valid_jump_pos(x, y, magic=0, showmsg).  Knight (innate
// Jumping only) may jump exactly distu==5, within range, to a visible cell,
// with a clear Bresenham path.  Emits the failure message when showmsg.
async function is_valid_jump_pos(x, y, showmsg) {
    const u = game.u;
    if (distu(x, y) !== 5) {
        if (showmsg) { game._pending_message = 'Illegal move!'; }
        return false;
    }
    if (distu(x, y) > 9) {
        if (showmsg) { game._pending_message = 'Too far!'; }
        return false;
    }
    if (!isok(x, y)) {
        if (showmsg) { game._pending_message = 'You cannot jump there!'; }
        return false;
    }
    // cansee check omitted (targets on the recorded path are all seen)
    if (!walk_path(u.ux, u.uy, x, y, check_jump)) {
        if (showmsg) { game._pending_message = 'There is an obstacle preventing that jump.'; }
        return false;
    }
    return true;
}

// C ref: apply.c get_valid_jump_position() — used by getpos autodescribe to
// flag "(invalid target)".
function get_valid_jump_position(x, y) {
    const loc = game.level?.at(x, y);
    if (!isok(x, y) || !loc) return false;
    if (!(loc.typ >= DOOR)) return false; // ACCESSIBLE(typ) == typ >= DOOR
    return distu(x, y) === 5 && distu(x, y) <= 9 && walk_path(game.u.ux, game.u.uy, x, y, check_jump);
}

// C ref: getpos.c getpos() — the first targeting frame's terminal cursor.
// jump() calls getpos_sethilite(display_jump_positions, get_valid_jump_position)
// before getpos().  getpos_sethilite -> selection_force_newsyms(sel) calls
// newsym_force(x,y) on every valid jump position, marking those gbuf cells
// gnew.  getpos()'s opening "curs(WIN_MAP, u.ux,u.uy); flush_screen(0)" then
// REDRAWS each gnew cell in flush_screen's row-major order (y ascending, then
// x ascending), and because flush_screen(0) does not re-home the cursor on the
// hero, the tty cursor is left one past the LAST redrawn glyph — i.e. on the
// highest-row, then highest-column valid jump position.  A drawn glyph at map
// (gx,gy) leaves the tty cursor at column gx, row gy+1 (curx is incremented
// past the glyph; map row gy maps to screen row gy+1).  This affects only the
// first frame; once a key is read, the gnew flags are cleared and the cursor
// tracks the logical targeting position normally.
// Returns the recorded terminal cursor [col,row] for that first frame, or null
// when there are no valid jump positions (then the cursor stays on the hero).
function jump_hilite_first_cursor() {
    const u = game.u;
    let gx = -1, gy = -1;
    // display_jump_positions scans dx,dy in -4..4; the valid set is identical
    // to the cells selection_force_newsyms marks gnew.  We want flush_screen's
    // draw order (row-major: greatest y wins, then greatest x).
    for (let y = u.uy - 4; y <= u.uy + 4; y++) {
        for (let x = u.ux - 4; x <= u.ux + 4; x++) {
            if (!isok(x, y)) continue;
            if (x === u.ux && y === u.uy) continue;
            if (!get_valid_jump_position(x, y)) continue;
            // row-major last: y is the dominant key (>=), x the tiebreak (>=)
            if (y > gy || (y === gy && x > gx)) { gx = x; gy = y; }
        }
    }
    if (gx < 0) return null;
    // glyph-drawn cursor convention: column = map x, row = map y + 1.
    return [gx, gy + 1];
}

// C ref: apply.c jump() tail -> dothrow.c walk_path(hurtle_jump) + teleport.c
// teleds(cc, TELEDS_NO_FLAGS) + nomul(-1) + morehungry(rnd(25)).
// For the recorded knight (unpunished, not swallowed/trapped, jumping over open
// floor) hurtle_step / teleds consume no RNG: the only RNG draw is the trailing
// morehungry(rnd(25)).  teleds for this hero reduces to relocating <u.ux,u.uy>,
// redrawing the vacated and new cells, and forcing a full vision recalc so the
// landing room is revealed.  The monster turn (mcalcmove &c.) is driven by the
// move loop after dojump() returns ECMD_TIME.
function jump_landing(nux, nuy) {
    const u = game.u;
    const ux0 = u.ux, uy0 = u.uy;

    // u_on_newpos(nux, nuy): set the hero's new position.
    u.ux = nux;
    u.uy = nuy;
    u.ux0 = ux0;
    u.uy0 = uy0;
    u.umoved = true; // the hero relocated this command

    // teleds: newsym(u.ux0,u.uy0) clears the vacated tile; newsym(new) draws the
    // hero; vision_full_recalc forces the move loop's vision_recalc to reveal
    // the landing room (see_monsters runs as part of the recalc/redraw).
    newsym(ux0, uy0);
    newsym(nux, nuy);
    game.vision_full_recalc = 1;
    vision_recalc(0);

    // C ref: apply.c jump() tail — nomul(-1) makes the hero helpless ("jumping
    // around") for one turn; the moveloop then runs that turn fully without the
    // hero acting, so a Fast hero's leftover movement is not spent as a free
    // action immediately after the jump.
    nomul(-1);

    // morehungry(rnd(25)) — roll first (argument evaluation), then apply.
    // newuhs() is RNG-inert while the hero stays NOT_HUNGRY/SATIATED (uhunger
    // far above the WEAK/FAINTING thresholds), and prints no status message.
    const num = rnd(25);
    u.uhunger = (u.uhunger ?? 900) - num;
}

// C ref: getpos.c IS_UNEXPLORED_LOC() — a never-drawn cell.  Same test
// terrain_description() uses for its "unexplored area" answer.
function gloc_unexplored(x, y) {
    if (!isok(x, y)) return false;
    const loc = game.level?.at(x, y);
    return !loc || (!loc.seenv && loc.remembered_glyph == null);
}

// C ref: getpos.c gather_locs_interesting(x, y, gloc) — does the DISPLAYED
// glyph at <x,y> belong to this jump class?  C dispatches on glyph_at(); our
// display model keeps the same information as seenv/remembered_glyph plus the
// cell's terrain, so the cmap categories are read off loc.typ once the cell has
// actually been drawn.  getloc_filter defaults to GFILTER_NONE (no view/area
// restriction) and getloc_usemenu defaults Off, so neither is modelled.
const GLOC_MONS = 0, GLOC_OBJS = 1, GLOC_DOOR = 2, GLOC_EXPLORE = 3,
      GLOC_INTERESTING = 4, GLOC_VALID = 5;
// C ref: cmd.c spkeys[] defaults for mMoOdDxX_def[] — next/prev pairs, so the
// index >> 1 is the GLOC_* class.
const GLOC_KEYS = 'mMoOdDxXaAzZ';
function gather_locs_interesting(x, y, gloc, validfn) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    const explored = !gloc_unexplored(x, y);
    const isDoorSym = explored && (loc.typ === DOOR || loc.typ === 19 /*DRAWBRIDGE_UP*/
                                   || loc.typ === 34 /*DRAWBRIDGE_DOWN*/);
    const mtmp = m_at(x, y);
    switch (gloc) {
    case GLOC_MONS:
        return !!(mtmp && canspotmon(mtmp));
    case GLOC_OBJS:
        // C excludes BOULDER and ROCK; look_at_object_here() reports the object
        // that is actually DRAWN on the cell.
        if (mtmp && canspotmon(mtmp)) return false;
        return !!look_at_object_here(x, y) && !covers_objects(x, y);
    case GLOC_DOOR:
        return isDoorSym;
    case GLOC_EXPLORE:
        return explored
            && (isDoorSym || loc.typ === ROOM || loc.typ === CORR)
            && (gloc_unexplored(x + 1, y) || gloc_unexplored(x - 1, y)
                || gloc_unexplored(x, y + 1) || gloc_unexplored(x, y - 1));
    case GLOC_VALID:
        if (validfn) return !!validfn(x, y);
        /* fallthrough */
    case GLOC_INTERESTING:
    default:
        if (isDoorSym) return true;
        if (mtmp && canspotmon(mtmp)) return true;
        if (!explored) return false;
        if (look_at_object_here(x, y)) return true;
        // "not interesting": walls, trees, bars, ice, air, cloud, lava, water,
        // plain room floor and corridor.
        return !(IS_WALL(loc.typ) || loc.typ === ICE || loc.typ === ROOM
                 || loc.typ === CORR || loc.typ === STONE
                 || IS_POOL(loc.typ) || IS_LAVA(loc.typ) || IS_AIR(loc.typ));
    }
}

// C ref: getpos.c gather_locs() — every matching spot plus the hero's own,
// sorted by cmp_coord_distu (chebyshev distance from the hero, ties by y then
// x).  The hero's spot always sorts to index 0.
function gather_locs(gloc, validfn) {
    const u = game.u;
    const arr = [];
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++)
            if ((u && x === u.ux && y === u.uy)
                || gather_locs_interesting(x, y, gloc, validfn))
                arr.push({ x, y });
    const distu_cheb = (c) => Math.max(Math.abs((u?.ux ?? 0) - c.x), Math.abs((u?.uy ?? 0) - c.y));
    arr.sort((a, b) => {
        const d = distu_cheb(a) - distu_cheb(b);
        if (d) return d;
        return (a.y !== b.y) ? (a.y - b.y) : (a.x - b.x);
    });
    return arr;
}

// Render the farlook/getpos frame: base map + status (already on the grid via
// flush_screen) with the message line set and the cursor on the map at the
// targeting location <cx,cy> (display column cx-1, row cy+1).
async function getpos_render(message, cx, cy) {
    game._pending_message = message || '';
    await flush_screen(1);
    const disp = game.nhDisplay;
    if (disp?.setCursor) disp.setCursor(cx - 1, cy + 1);
    // C ref: topl.c redotoplin():139 — auto_describe()'s custompline() goes
    // through update_topl like any other message, so a description long enough
    // to word-wrap onto a second row blocks on --More-- right away (the long
    // "a doorway or the floor of a room or ..." cmap list does).
    if (message && wrap_topl(message).length > 1) {
        await topl_more();
        game._toplin = 0;
        game._pending_message = '';
    }
}

// C ref: getpos.c getpos(ccp, force, goal) — cursor-positioning loop.  The loop
// structure mirrors C: at the top of each iteration auto_describe() refreshes
// the message line for the current cursor cell whenever a message hasn't just
// been "given"; then a key is read and dispatched.
//   - lowercase hjkl/diagonals move the cursor one step (MV_WALK);
//   - capital HJKL.. / a 'G'/'g' prefix / a Ctrl-<dir> key fast-move (×8);
//   - '.'/','/';'/':' pick the spot and return it;
//   - '@' (NHKF_GETPOS_SELF) snaps the cursor back to the hero;
//   - ESC cancels (returns null);
//   - a key that matches a never-present cmap feature symbol => "Can't find
//     dungeon feature '%c'."; any other key => "Unknown direction: ..." (when
//     `force`) or "Done." + return null (when !force).
// `validfn(x,y)` flags invalid targets with a "(invalid target)" suffix.
// `force` selects the wizard-teleport / #jump behavior (unknown keys keep the
// loop alive) vs the ';' farlook behavior (unknown keys finish).
async function getpos(goalText, startx, starty, validfn, force = false, verbose = false, travelMode = false, detectMode = false, terrainMode = false) {
    const u = game.u;
    let cx = startx, cy = starty;

    // C getpos.c:838 handle_tip(TIP_GETPOS): in verbose mode a "Please move the
    // cursor to ..." topline is still pending (NEED_MORE) when getpos starts.
    // Raising the first-use tip text window forces that line to be acknowledged
    // with --More-- before the tip is drawn; fire it here so the order is
    // "Please move...--More--" (step) then the tip (step).  When the tip was
    // already shown, the pending line is instead flushed by the following
    // update_topl("(For instructions...)") call.
    const TIP_GETPOS_BIT = 1 << 4;
    const willShowTip = !((game.context.tips || 0) & TIP_GETPOS_BIT);
    // The pending line is paged whether it came from the verbose "Please move
    // the cursor to ..." or the quick "Pick a monster, object or location."
    // (pager.c:1908): what forces the --More-- is the tip WINDOW going up over
    // an unacknowledged message window, not flags.verbose.
    const softPending = !!game._pending_message
        && game._toplinSoft === game._pending_message;
    if (willShowTip) {
        // C ref: wintty.c tty_display_nhwindow() NHW_MENU — `if (toplin ==
        // TOPLINE_NEED_MORE) tty_display_nhwindow(WIN_MESSAGE, TRUE)`, and that
        // nested call opens with `if (cw->flags & WIN_CANCELLED) return;`.
        // WIN_CANCELLED and WIN_STOP are THE SAME BIT (wintty.h:99-100), so a
        // --More-- dismissed with ESC suppresses this page too, not just the
        // messages update_topl() skips.
        if (!game._winStop && (game._toplin === 1 || softPending))
            await topl_more();
        // Both overlay branches end with the message window empty
        // (tty_clear_nhwindow(WIN_MESSAGE) / toplin = TOPLINE_EMPTY), so the
        // pending line is dropped whether or not it got paged.
        game._toplin = 0;
        game._toplinSoft = null;
        game._pending_message = '';
    }

    const tipShown = await getpos_tip();
    let showGoal = tipShown;
    // C ref: getpos.c garr[NUM_GLOCS]/gidx[NUM_GLOCS] — each jump class's spot
    // list is gathered lazily on first use and its cursor index persists for
    // the rest of this getpos() call.
    const garr = {};
    const gidx = {};
    let msgGiven = true; // C: msg_given defaults TRUE (clear message window)

    // C getpos.c:840 — flags.verbose => pline("(For instructions type a '?')").
    // This message overwrites whatever is on the top line; if the tip was NOT
    // shown (so a verbose "Please move..." is still pending) it fires that
    // line's --More-- first.  When the tip WAS shown, show_goal_msg is set and
    // the loop's "Move cursor to ...:" pline (also routed through update_topl)
    // is what acknowledges this "(For instructions...)" line.
    if (verbose) {
        await update_topl(`(For instructions type a '?')`);
        msgGiven = true;
        if (!showGoal) {
            // No goal message will be drawn; render the verbose line now so the
            // first readchar's capture shows it (cursor parked on the hero).
            await flush_screen(1);
            const disp = game.nhDisplay;
            if (disp?.setCursor) disp.setCursor(cx - 1, cy + 1);
        }
    }

    // C: auto_describe(cx,cy) — message for the current cell (self or terrain),
    // with the optional "(invalid target)" suffix from getpos_getvalid.
    const describe = (x, y) => {
        let desc;
        if (u && x === u.ux && y === u.uy) {
            desc = self_lookat();
        } else if (detectMode) {
            // C ref: pager.c do_screen_description(), reached via 'need_to_look'
            // once a monster's class symbol matches: falls through to lookat()'s
            // look_at_monster() for the full tame/peaceful-prefixed identity
            // (matches auto_describe's actual observed output — a named/peaceful
            // shopkeeper reads "peaceful Adjama", not a generic class string).
            // A non-monster cell always reads as the freshly-cls()'d blank glyph
            // (GLYPH_UNEXPLORED — monster_detect's repaint doesn't touch the
            // hero's remembered terrain, only the live display buffer), i.e.
            // "unexplored area" regardless of what's actually there.
            const mtmp = m_at(x, y);
            desc = mtmp ? look_at_monster_desc(mtmp) : 'unexplored area';
        } else {
            // C ref: pager.c lookat() dispatch — when the cell's displayed glyph
            // is a floor object (e.g. a STATUE drawn as the petrified monster's
            // class letter) and no spotted monster is drawn on top, lookat names
            // the object via look_at_object() instead of the terrain underneath.
            const mtmp = m_at(x, y);
            // C ref: pager.c lookat() — a SPOTTED monster on the square is
            // named first; falling through to the object/terrain name described
            // the floor under a visible monster.
            const objname = (mtmp && canspotmon(mtmp)) ? null : look_at_object_here(x, y);
            desc = (mtmp && canspotmon(mtmp)) ? look_at_monster_desc(mtmp)
                 : (objname || terrain_description(x, y));
            // C ref: detect.c reveal_terrain_getglyph() — while browsing a
            // revealed map, S_darkroom is rewritten to S_room and S_litcorr to
            // S_corr, and do_screen_description() dispatches on that DISPLAYED
            // glyph.  So an unlit room square reads "floor of a room" here, not
            // "dark part of a room".
            if (terrainMode) {
                if (desc === 'dark part of a room') desc = 'floor of a room';
                else if (desc === 'lit corridor') desc = 'corridor';
            }
        }
        if (validfn && !validfn(x, y)) desc += ' (invalid target)';
        if (travelMode && !is_valid_travelpt(x, y)) desc += ' (no travel path)';
        return desc;
    };

    let firstPass = true;
    let unknownMsg = null;
    for (;;) {
        if (showGoal) {
            // C getpos.c:863 pline("Move cursor to %s:", goal).  In verbose mode
            // route through update_topl so the pending "(For instructions...)"
            // line is acknowledged with its --More-- frame first.
            if (verbose) {
                await update_topl(`Move cursor to ${goalText}:`);
                await flush_screen(1);
                const disp = game.nhDisplay;
                if (disp?.setCursor) disp.setCursor(cx - 1, cy + 1);
            } else {
                await getpos_render(`Move cursor to ${goalText}:`, cx, cy);
            }
            showGoal = false;
        } else if (gp_iflags().autodescribe && !msgGiven) {
            // C getpos.c:865 auto_describe(cx, cy) at top of loop.
            await getpos_render(describe(cx, cy), cx, cy);
        } else if (!firstPass) {
            // C getpos.c `nxtc:` — curs(WIN_MAP, cx, cy) + flush_screen(0)
            // after EVERY key, so the cursor keeps tracking the cell even when
            // no message is drawn (autodescribe toggled off with '#').  Only
            // the loop iterations are emulated: C's identical PRE-loop pair
            // runs while the caller's command still has map updates pending,
            // and flush_screen() leaves the tty cursor on the last glyph it
            // drew rather than at (cx,cy) — which is what our caller-side
            // render already reproduces.
            await flush_screen(1);
            const disp = game.nhDisplay;
            if (disp?.setCursor) disp.setCursor(cx - 1, cy + 1);
        }
        firstPass = false;
        let k = await nhgetch();
        let ch = String.fromCharCode(k);
        // C topl.c — reading a key acknowledges any pending NEED_MORE topline,
        // so subsequent autodescribe plines overwrite without a new --More--.
        game._toplin = 0;
        // C getpos.c:888 — only autodescribe mode clears msg_given, so with
        // '#' turned off the last message stays up across keystrokes.
        if (gp_iflags().autodescribe) msgGiven = false;

        if (k === 27) { // ESC: cancel
            // C getpos.c:894 sets msg_given=TRUE on ESC, so exitgetpos clears
            // WIN_MESSAGE (clear_nhwindow).  Blank the top line accordingly.
            game._pending_message = '';
            return null;
        }
        // C getpos.c:897 — the 'G'/'g' fast-move prefix reads its second key
        // INSIDE the same loop pass (no nxtc, so no cursor flush and no
        // auto_describe between them), and `rushrun` is a per-pass local: a
        // prefix followed by a NON-direction key is simply forgotten.  The old
        // `mult` carried the prefix across iterations, so 'G' then '#' then 'h'
        // fast-moved where C steps one cell.
        let rushrun = false;
        if (ch === 'G' || ch === 'g') {
            k = await nhgetch();
            ch = String.fromCharCode(k);
            game._toplin = 0;
            rushrun = true;
        }
        const ldir = GP_CTRL_RUSH[k] || ch.toLowerCase();
        const isRush = rushrun || 'HJKLYUBN'.includes(ch)
                       || GP_CTRL_RUSH[k] !== undefined;
        if (GP_DX[ldir] !== undefined) {
            let dx = GP_DX[ldir], dy = GP_DY[ldir];
            if (isRush) {
                if (gp_iflags().getloc_moveskip) {
                    // C getpos.c:922 — "skip same glyphs": walk while the NEXT
                    // TWO cells both show the cursor cell's glyph.
                    const g0 = gp_glyph_at(cx, cy);
                    while (isok(cx + dx, cy + dy)
                           && g0 === gp_glyph_at(cx + dx, cy + dy)
                           && isok(cx + dx + GP_DX[ldir], cy + dy + GP_DY[ldir])
                           && g0 === gp_glyph_at(cx + dx + GP_DX[ldir],
                                                 cy + dy + GP_DY[ldir])) {
                        dx += GP_DX[ldir];
                        dy += GP_DY[ldir];
                    }
                } else {
                    dx *= 8; dy *= 8;
                }
            }
            [cx, cy] = truncate_to_map(cx, cy, dx, dy);
            continue; // C: goto nxtc; auto_describe runs at top of next loop
        }
        if (ch === '.' || ch === ',' || ch === ';' || ch === ':') {
            // C getpos.c:1155 exitgetpos — a pending message is wiped
            // (clear_nhwindow(WIN_MESSAGE)) on the way out.
            if (msgGiven) game._pending_message = '';
            return { x: cx, y: cy }; // pick_chars
        }
        if (ch === '@') { // NHKF_GETPOS_SELF: snap cursor to hero
            // C getpos.c:999 resets every gidx[] so 'm'/'o'/'d'/'x' restart
            // their cycle; the gathered garr[] arrays are deliberately kept.
            for (const key of Object.keys(gidx)) gidx[key] = 0;
            if (u) { cx = u.ux; cy = u.uy; }
            continue; // auto_describe self at top of next loop
        }
        // C getpos.c:944 — NHKF_GETPOS_HELP ('?') or redraw_cmd (^R): show the
        // help window (a blocking --More--), refresh, then re-show the goal
        // message.  ^L is claimed by the rush binding above, as in C.
        // redraw_cmd(c) is (c == C('r') || c == C('l')); ^L is claimed by the
        // rush binding above, as in C.  getpos_refresh() is
        // docrt_flags(docrtRefresh) == redraw_map(FALSE), a RE-SEND of the
        // existing glyph buffer that flush_screen already does, so the only
        // observable half is the goal message it re-shows.
        if (k === 0x12 /* C('r') */) {
            showGoal = true;
            continue;
        }
        if (ch === '?') {
            // C's two help-line gates are getpos_getvalid ("Use 'z' or 'Z'...")
            // and getpos_hilitefunc ("Use '$' to toggle marking..."), and every
            // getpos_sethilite() caller (apply.c jump/polearm/grapple, read.c
            // stinking cloud, spell.c spell target) sets BOTH — so they are the
            // same predicate.  `game._getpos_hilite` was never assigned, which
            // dropped the '$' line from every #jump help window.
            await getpos_help(force, goalText, goalText === WHAT_IS_A_LOCATION,
                              !!validfn, !!validfn);
            showGoal = true;
            continue;
        }
        // C getpos.c:955 NHKF_GETPOS_SHOWVALID ('$') — toggles the marking of
        // valid target spots.  This port draws no marking, but the branch still
        // has to swallow the key and re-show the goal message; otherwise '$'
        // reached the terrain-symbol fallback and printed "Unknown direction".
        if (ch === '$') {
            showGoal = true;
            continue;
        }
        // C getpos.c:954-1006 — the getpos option toggles.  Each one plines
        // (leaving a NEED_MORE topline that the *next* pline has to --More--
        // past) and sets msg_given, which with autodescribe off is what keeps
        // the message on screen while later keys are swallowed by that --More--.
        if (ch === '#') { // NHKF_GETPOS_AUTODESC
            const ifl = gp_iflags();
            ifl.autodescribe = !ifl.autodescribe;
            await gp_pline(`Automatic description of features under cursor is `
                           + `${ifl.autodescribe ? 'on' : 'off'}.`, cx, cy);
            if (!ifl.autodescribe) showGoal = true;
            msgGiven = true;
            continue;
        }
        if (ch === '"') { // NHKF_GETPOS_LIMITVIEW
            const ifl = gp_iflags();
            ifl.getloc_filter = ((ifl.getloc_filter || 0) + 1) % 3;
            // C getpos.c:977 frees every gathered garr[] and zeroes gidx[]
            // so the next 'm'/'o'/'d'/'x' re-gathers under the new filter.
            for (const key of Object.keys(garr)) delete garr[key];
            for (const key of Object.keys(gidx)) gidx[key] = 0;
            await gp_pline(`${GP_VIEW_FILTERS[ifl.getloc_filter]}.`, cx, cy);
            msgGiven = true;
            continue;
        }
        if (ch === '!') { // NHKF_GETPOS_MENU
            const ifl = gp_iflags();
            ifl.getloc_usemenu = !ifl.getloc_usemenu;
            await gp_pline(`${ifl.getloc_usemenu ? 'Using' : 'Not using'} a menu `
                           + `to show possible targets`
                           + `${ifl.getloc_usemenu ? " for 'm|M', 'o|O', 'd|D', and 'x|X'" : ''}.`,
                           cx, cy);
            msgGiven = true;
            continue;
        }
        if (ch === '*') { // NHKF_GETPOS_MOVESKIP
            const ifl = gp_iflags();
            ifl.getloc_moveskip = !ifl.getloc_moveskip;
            await gp_pline(`${ifl.getloc_moveskip ? 'S' : 'Not s'}kipping over `
                           + `similar terrain when fastmoving the cursor.`, cx, cy);
            msgGiven = true;
            continue;
        }
        // C ref: getpos.c mMoOdDxX[] — jump the cursor to the next/previous
        // nearest monster / object / door / unexplored-frontier / interesting /
        // valid spot.  These are checked BEFORE the terrain-symbol fallback, so
        // without them 'd' (a door jump) fell through to "Unknown direction".
        {
            const gtmp = GLOC_KEYS.indexOf(ch);
            if (gtmp >= 0) {
                const gloc = gtmp >> 1;
                if (!garr[gloc]) { garr[gloc] = gather_locs(gloc, validfn); gidx[gloc] = 0; }
                const n = garr[gloc].length;
                if (n > 0) {
                    if (!(gtmp & 1)) gidx[gloc] = ((gidx[gloc] || 0) + 1) % n;
                    else if (--gidx[gloc] < 0) gidx[gloc] = n - 1;
                    cx = garr[gloc][gidx[gloc]].x;
                    cy = garr[gloc][gidx[gloc]].y;
                }
                continue;
            }
        }
        // C getpos.c:1039 else-branch: not move/pick/special.
        const isQuit = (ch === ' ' || ch === '\r' || ch === '\n' || k === 27);
        if (!isQuit) {
            if (getpos_is_feature_sym(ch)) {
                // matched a cmap feature symbol: scan the map for it first.
                const found = getpos_find_feature(ch, cx, cy);
                if (found) {
                    cx = found.x; cy = found.y;
                    continue; // silent jump; auto_describe fires next loop
                }
                await getpos_render(`Can't find dungeon feature '${ch}'.`, cx, cy);
                msgGiven = true;
                continue;
            }
            // k == 0 (no symbol match): "Unknown direction".
            const note = force
                ? "use 'h', 'j', 'k', 'l' or '.'"
                : 'aborted';
            unknownMsg = `Unknown direction: '${visctrl_key(k)}' (${note}).`;
            await getpos_render(unknownMsg, cx, cy);
            msgGiven = true;
        }
        if (force) { unknownMsg = null; continue; } // C: stay in the loop
        if (isQuit) {
            // space / return at top level in !force getpos => "Done.", finish.
            await getpos_render('Done.', cx, cy);
            return null;
        }
        // !force after "Unknown direction": C's pline("Done.") APPENDS to the
        // still-unflushed topline after two spaces rather than replacing it.
        await getpos_render(unknownMsg ? `${unknownMsg}  Done.` : 'Done.', cx, cy);
        return null;
    }
}

// C ref: cmd.c visctrl() — printable rendering of a control character for the
// "Unknown direction: '%s'" message (^X form).  Plain printables pass through.
function visctrl_key(k) {
    if (k < 32) return '^' + String.fromCharCode(k + 64);
    if (k === 127) return '^?';
    return String.fromCharCode(k);
}

// C ref: pager.c do_look(mode=1) reached by the ';' "glance" command.  A quick
// farlook: prompt, getpos() to choose a cell, then describe what is there on
// the top line.  Read-only — no game time passes (context.move stays 0).
export async function do_farlook() {
    const u = game.u;
    // C: flags.verbose is off in our rc-less default, and quick suppresses the
    // verbose form, so the prompt is "Pick <what>." (custompline NHKF path).
    const WHAT = 'a monster, object or location';
    // C ref: pager.c:1908 `pline("Pick %s.", what_is_a_location)` — a real
    // pline, so the line is left unacknowledged; the tip window getpos() raises
    // next has to page it with --More-- before it can draw.
    await pline(`Pick ${WHAT}.`);
    await flush_screen(1);

    // C ref: pager.c do_look() `ans = getpos(&cc, quick, what_is_a_location)`
    // — the force argument IS `quick`, so the ';' glance runs getpos in FORCED
    // mode: a quit char (space/return) is swallowed and the loop keeps going,
    // where the unforced '/' whatis getpos prints "Done." and gives up.
    const cc = await getpos(WHAT, u.ux, u.uy, null, /*force=*/true);
    if (!cc) { game.context.move = 0; return; }

    // do_screen_description: describe the chosen cell.  Monster/object naming
    // is not modelled here; the terrain description covers the recorded cases.
    const mtmp = m_at(cc.x, cc.y);
    let desc;
    if (mtmp && canspotmon(mtmp)) {
        desc = mtmp.data?.mname || mtmp.data?.pmname || 'a monster';
    } else {
        desc = look_pick_description(cc.x, cc.y).text;
    }
    // C ref: pager.c:1919 `putmixed(WIN_MESSAGE, 0, out_str)` — tty routes that
    // through update_topl(), so a description too wide for one row wraps and
    // blocks on --More-- before do_look returns.
    await update_topl(desc);
    await flush_screen(1);
    const disp = game.nhDisplay;
    if (disp?.setCursor) disp.setCursor(cc.x - 1, cc.y + 1);
    game.context.move = 0;
}

// ── #terrain command — cmd.c doterrain() / detect.c reveal_terrain() ───────
//
// The #terrain command (default-bound to <del> / '\177') shows the known map
// with monsters, objects and traps stripped so the underlying terrain is
// visible, then lets the player browse it with getpos()'s autodescribe cursor.
// In normal play (not explore/wizard mode) it first offers a three-entry
// "View which?" PICK_ONE menu whose first item (bare terrain) is preselected.

// TER_* subset bits (detect.c / include/hack.h).
const TER_MAP = 0x01, TER_TRP = 0x02, TER_OBJ = 0x04;

// The three normal-play "View which?" entries; 'a' is the preselected default
// (rendered with a '*' marker instead of the '-' of the unselected entries).
const TERRAIN_MENU_ITEMS = [
    { ch: 'a', sel: true,  desc: 'known map without monsters, objects, and traps' },
    { ch: 'b', sel: false, desc: 'known map without monsters and objects' },
    { ch: 'c', sel: false, desc: 'known map without monsters' },
];

// Render the "View which?" PICK_ONE menu as a tty corner overlay (the map
// shows through the columns left of offx).  Mirrors render_whatis_menu /
// process_menu_window: title (inverse) on row 0, a blank separator, the item
// lines, then the "(end)" morestr with the cursor parked after it.  A selected
// PICK_ONE default renders its marker column as '*' (tty tty_print_glyph:
// n==2 && selected => '*').
function render_terrain_menu() {
    const disp = game.nhDisplay;
    if (!disp?.setCell) return;
    const cols = disp.cols || 80;

    const lines = [];
    lines.push({ text: 'View which?', attr: ATR_INVERSE });
    lines.push({ text: '' });
    for (const it of TERRAIN_MENU_ITEMS)
        lines.push({ text: `${it.ch} ${it.sel ? '*' : '-'} ${it.desc}` });

    let maxcols = 0;
    for (const l of lines) maxcols = Math.max(maxcols, l.text.length + 2);

    let offx = Math.min(Math.min(82, Math.floor(cols / 2)), cols - maxcols - 1);
    if (offx < 0) offx = 0;
    const textCol = offx + 1;

    const blankCols = (row) => {
        for (let c = offx; c < cols; c++) disp.setCell(c, row, ' ', NO_COLOR, 0);
    };
    for (let c = 0; c < cols; c++) disp.setCell(c, 0, ' ', NO_COLOR, 0);

    for (let i = 0; i < lines.length; i++) {
        blankCols(i);
        if (lines[i].text) disp.putstr(textCol, i, lines[i].text, NO_COLOR, lines[i].attr || 0);
    }
    const moreRow = lines.length;
    blankCols(moreRow);
    disp.putstr(textCol, moreRow, '(end)', NO_COLOR, 0);
    disp.setCursor(textCol + 6, moreRow);
}

// Display the "View which?" menu and read a PICK_ONE selection.  Returns the
// chosen a_int (1..3), or -1 if cancelled.  C select_menu(PICK_ONE): a
// <space>/<return> confirms the preselected entry (n==1 => which==1); a direct
// accelerator picks that entry; ESC cancels.
async function terrain_menu() {
    render_terrain_menu();
    for (;;) {
        const k = await nhgetch();
        if (k === 27) return -1;                        // ESC: cancel
        if (k === 32 || k === 13 || k === 10) return 1; // confirm preselected
        const ch = String.fromCharCode(k);
        if (ch === 'a') return 1;
        if (ch === 'b') return 2;
        if (ch === 'c') return 3;
        // invalid key: PICK_ONE stays open (the menu is still on the grid).
    }
}

// C ref: cmd.c doterrain().  recalc_mapseen() has no display effect for our
// model, so it is skipped; the normal-play menu selects a TER_* subset and
// hands off to reveal_terrain().  Returns ECMD_OK (no game time).
export async function doterrain() {
    const which = await terrain_menu();
    if (which < 0) return 0; // ESC-cancelled: no display change
    let subset = TER_MAP;
    if (which === 2) subset = TER_MAP | TER_TRP;
    else if (which === 3) subset = TER_MAP | TER_TRP | TER_OBJ;
    await reveal_terrain(subset);
    return 0;
}

// C ref: detect.c reveal_terrain(which_subset).  Redraw the known map with
// monsters (and, per subset, objects/traps) stripped so the underlying terrain
// shows through, pline the "Showing ... only..." banner, then browse the result
// with getpos()'s autodescribe.  Afterwards map_redisplay() restores the real
// map; docrt()'s internal cls() flushes WIN_MESSAGE (firing --More-- for any
// still-pending topline such as getpos's "Done.").
export async function reveal_terrain(which_subset) {
    const u = game.u;
    // C: (Hallucination || Stunned || Confusion) && !full => "You are too
    // disoriented for this."  None of the recorded uses are impaired, so the
    // normal branch is the only one modelled.
    const keep_traps = (which_subset & TER_TRP) !== 0;
    const keep_objs = (which_subset & TER_OBJ) !== 0;

    // Paint the terrain-only glyph for every cell into the display buffer.
    // C reveal_terrain_getglyph strips monsters/objects from the remembered
    // glyph and normalizes S_darkroom->S_room and S_litcorr->S_corr; for the
    // exercised TER_MAP subset this reduces to the bare remembered terrain
    // background of each seen cell (unseen cells show default_glyph = S_stone).
    for (let x = 1; x < COLNO; x++) {
        for (let y = 0; y < ROWNO; y++) {
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            const isHero = u && x === u.ux && y === u.uy;
            if (!loc.remembered_glyph && !isHero) {
                show_glyph_cell(x, y, ' ', NO_COLOR, false); // never-seen: blank
                continue;
            }
            const bg = terrain_background_glyph(loc, x, y);
            let color = bg.color;
            // S_litcorr -> S_corr: a lit corridor ('#', CLR_WHITE) drops to the
            // plain corridor color in the terrain view.
            if (bg.ch === '#' && color === CLR_WHITE) color = NO_COLOR;
            show_glyph_cell(x, y, bg.ch, color, bg.dec);
        }
    }
    await flush_screen(1);

    // C: Strcpy(buf, "known terrain"); + keep_* suffixes.  Only "known terrain"
    // is exercised, but build the suffixes faithfully for generalization.
    let buf = 'known terrain';
    if (keep_traps) buf += keep_objs ? ', traps' : ' and traps';
    if (keep_objs) buf += keep_traps ? ', and objects' : ' and objects';
    // pline("Showing %s only...", buf) — leaves the topline NEED_MORE; getpos's
    // first-use tip flushes it with --More-- before drawing the tip window.
    await getpos_render(`Showing ${buf} only...`, u.ux, u.uy);
    game._toplin = 1;
    game._toplines = `Showing ${buf} only...`;

    // browse_map(which_subset, "anything of interest") = getpos autodescribe,
    // force=FALSE, flags.verbose (default on) => the verbose cursor prompt.
    const verbose = game.flags?.verbose !== false;
    await getpos('anything of interest', u.ux, u.uy, null, /*force=*/false, verbose,
                 /*travelMode=*/false, /*detectMode=*/false, /*terrainMode=*/true);

    // map_redisplay(): docrt() redraws the real map.  cls() inside docrt calls
    // display_nhwindow(WIN_MESSAGE,...) which fires more() when the topline is
    // still NEED_MORE (getpos left "Done." pending after a <space> quit).
    if (game._pending_message) {
        await topl_more();
        game._pending_message = '';
        game._toplin = 0;
    }
    await docrt();
    await flush_screen(1);
}

// C ref: getpos.c browse_map(ter_typ, goal) — the read-only cursor loop the
// detection effects hand control to after painting their map.  detectMode makes
// auto_describe report the freshly-cls()'d cells as "unexplored area".
export async function browse_map_getpos(goal, detectMode = true) {
    const u = game.u;
    const verbose = game.flags?.verbose !== false;
    await getpos(goal, u.ux, u.uy, null, /*force=*/false, verbose,
                 /*travelMode=*/false, detectMode);
    // map_redisplay()'s docrt -> cls -> display_nhwindow(WIN_MESSAGE) fires
    // more() when getpos left "Done." pending.
    if (game._pending_message) {
        await topl_more();
        game._pending_message = '';
        game._toplin = 0;
    }
}

// C ref: detect.c monster_detect(otmp, mclass) — crystal ball / fountain /
// potion "sense the presence of monsters" effect.  Only the otmp==null,
// mclass==0 case (the fountain's "See Monsters" quaff outcome) is reached;
// the crystal-ball class filter and the cursed-item wake-helpless branch are
// not modelled.  cls()+unconstrain_map() reduce, for our display model, to
// blanking every map cell before drawing just the detected monsters (their
// ordinary class glyph/color — mon_to_glyph/pet_to_glyph render identically
// on a plain terminal) plus the hero's own glyph (display_self(), hero is
// never swallowed here).  Since otmp is always null, the blessed "persistent
// detection" branch never applies; browse_map(TER_DETECT|TER_MON, "monster of
// interest") always runs, then map_redisplay() (docrt) restores the real map.
export async function monster_detect(otmp, mclass) {
    const u = game.u;
    const mons = (game.level?.monsters || []).filter(
        (m) => !(m.mhp != null && m.mhp <= 0));
    if (!mons.length) {
        await update_topl('You feel threatened.');
        return true;
    }

    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++)
            show_glyph_cell(x, y, ' ', NO_COLOR, false);
    for (const m of mons) {
        // C ref: mon_to_glyph/pet_to_glyph(mon) = what_mon(monsndx(mon->data)) —
        // detection dispatches on the monster's own species, NOT its display
        // glyph (unlike a normal map draw, which shows a mimic's disguise via
        // monster_glyph()'s m_ap_type check): detecting a mimic reveals its
        // true class letter.
        const d = m.data || {};
        if (mclass && d.mlet !== mclass) continue;
        show_glyph_cell(m.mx, m.my, d.mlet || '?',
            (d.mcolor != null) ? d.mcolor : NO_COLOR, false);
    }
    if (u?.ux > 0) show_glyph_cell(u.ux, u.uy, '@', CLR_WHITE, false);
    await flush_screen(1);

    await update_topl('You sense the presence of monsters.');

    const verbose = game.flags?.verbose !== false;
    // C ref: detect.c:854 — `EDetect_monsters |= I_SPECIAL` for the duration of
    // the browse, so canspotmon() (== canseemon || sensemon) is TRUE for every
    // detected monster and autodescribe can NAME them ("small mimic") instead
    // of falling back to x_monnam's unseen "it".
    const props = (game.u.uprops = game.u.uprops || {});
    const saveE = props.EDetect_monsters;
    props.EDetect_monsters = (saveE | 0) | I_SPECIAL;
    try {
        await getpos('monster of interest', u.ux, u.uy, null, /*force=*/false,
                     verbose, /*travelMode=*/false, /*detectMode=*/true);
    } finally {
        props.EDetect_monsters = saveE;
    }

    if (game._pending_message) {
        await topl_more();
        game._pending_message = '';
        game._toplin = 0;
    }
    await docrt();
    await flush_screen(1);
    return false;
}

// ── '/' whatis command — pager.c do_look(mode=0) ──────────────────────────
//
// The full "whatis" command first presents the "What do you want to look at:"
// PICK_ONE menu, then dispatches the chosen sub-mode.  The recorded wizard
// session exercises the '/' (something on the map) branch, which runs the
// verbose-prompt farlook cursor loop (getpos with verbose=true) and, after
// LOOK_TRADITIONAL ('.') picks a square, prints the full screen description
// and offers the data-file "More info about ..." query before looping back.
//
// C ref: pager.c do_look() + win/tty/wintty.c process_menu_window.

// Render the whatis PICK_ONE menu as a tty corner overlay (the map shows
// through on the left of offx).  Mirrors render_corner_menu in
// extcmd-handlers.js / process_menu_window: title (inverse) on row 0, a blank
// separator, the "<accel> - <text>" item lines (and the mid-list blank), then
// the "(end)" morestr with the cursor parked after it.
function render_whatis_menu(items) {
    const disp = game.nhDisplay;
    if (!disp?.setCell) return;
    const cols = disp.cols || 80;

    const lines = [];
    lines.push({ text: 'What do you want to look at:', attr: ATR_INVERSE });
    lines.push({ text: '' });
    for (const it of items) {
        lines.push({ text: it.blank ? '' : `${it.ch} - ${it.desc}` });
    }

    let maxcols = 0;
    for (const l of lines) maxcols = Math.max(maxcols, l.text.length + 2);

    let offx = Math.min(Math.min(82, Math.floor(cols / 2)), cols - maxcols - 1);
    if (offx < 0) offx = 0;
    const textCol = offx + 1;

    const blankCols = (row) => {
        for (let c = offx; c < cols; c++) disp.setCell(c, row, ' ', NO_COLOR, 0);
    };
    for (let c = 0; c < cols; c++) disp.setCell(c, 0, ' ', NO_COLOR, 0);

    for (let i = 0; i < lines.length; i++) {
        blankCols(i);
        if (lines[i].text) disp.putstr(textCol, i, lines[i].text, NO_COLOR, lines[i].attr || 0);
    }
    const moreRow = lines.length;
    blankCols(moreRow);
    disp.putstr(textCol, moreRow, '(end)', NO_COLOR, 0);
    disp.setCursor(textCol + 6, moreRow);
}

// C ref: pager.c do_screen_description() (the looked==TRUE path).  Build the
// "<glyph><8 spaces><an(explain)>[ or ...] (<lookat firstmatch>)" string that
// the '.'/',' pick reports on the top line, and the count of cmap/monster
// matches (found).  Returns { text, firstmatch, found }.
//   - hero '@'  => found 1, "a human or elf (<self>)"
//   - upstairs  => found 2, "a staircase up or a branch staircase up (...)"
// Other squares reduce to the single terrain_description noun.
// The displayed glyph char at <x,y> (DEC-mapped to the Unicode form the
// recorder/decoder compares against), for the do_screen_description prefix.
function look_prefix_char(loc) {
    if (!loc || !loc.disp_ch) return '.';
    return loc.disp_decgfx ? (DEC_TO_UNICODE[loc.disp_ch] || loc.disp_ch)
                           : loc.disp_ch;
}

function look_pick_description(x, y) {
    const u = game.u;
    if (u && x === u.ux && y === u.uy) {
        // '@' matches S_HUMAN ("human or elf"); need_to_look => lookat() appends
        // " (<self_lookat>)".  firstmatch becomes the self_lookat string.
        const self = self_lookat();
        return {
            text: `@        a human or elf (${self})`,
            firstmatch: self,
            found: 1,
        };
    }
    const loc = game.level?.at(x, y);
    const typ = loc ? loc.typ : STONE;
    const prefix = `${look_prefix_char(loc)}        `;

    if (typ === STAIRS) {
        // '<'/'>': the cmap loop matches BOTH the ordinary stair and the branch
        // stair (same symbol).  lookat() then appends the actual glyph's
        // description (the branch form when known).  C: do_screen_description.
        const up = (game.level?.upstair?.x === x && game.level?.upstair?.y === y);
        const ordinary = up ? 'staircase up' : 'staircase down';
        const branch = up ? 'branch staircase up' : 'branch staircase down';
        const isBranch = known_branch_stairs_local(stairway_at_local(x, y));
        const look = isBranch ? branch : ordinary;
        return {
            text: `${prefix}${an(ordinary)} or ${an(branch)} (${look})`,
            firstmatch: look,
            found: 1, // 2 cmap matches -> lookat sets found=1
        };
    }

    // C ref: do_screen_description cmap loop — squares whose display symbol is
    // shared by several cmap entries enumerate them all with " or ".  The DEC
    // floor symbol '~' ('.' in ASCII) is shared by S_ndoor/S_room/S_darkroom/
    // S_ice; the corridor '#' is shared by enough entries to read "can be many
    // things" (found>4).  lookat() then appends the actual terrain noun.
    if (typ === ROOM || typ === ICE
        || (typ === DOOR && !(loc.doormask & (D_CLOSED | D_LOCKED | D_ISOPEN)))) {
        // doorway / floor / dark room / ice all share the '.'/'~' symbol.
        const look = terrain_description(x, y);
        return {
            text: `${prefix}a doorway or the floor of a room or the dark part of a room or ice (${look})`,
            firstmatch: look,
            found: 1,
        };
    }
    if (typ === CORR) {
        // '#' matches many cmap entries (>4) -> "can be many things".
        const look = terrain_description(x, y);
        return {
            text: `${prefix}can be many things (${look})`,
            firstmatch: look,
            found: 1,
        };
    }

    // C ref: pager.c do_screen_description() is_swallow_sym() branch — the
    // swallow-stomach middle-left/right symbol is the SAME char as S_vwall
    // ('|' in ASCII, meta-x in DECgraphics), so every vertical wall enumerates
    // "the interior of a monster" first (no article: C uses x_str verbatim).
    if (IS_WALL(typ)) {
        const look = terrain_description(x, y);
        return {
            text: `${prefix}the interior of a monster or ${an(look)} (${look})`,
            firstmatch: look,
            found: 2,
        };
    }

    // C ref: do_screen_description() — a square drawn BLANK is S_stone, whose
    // symbol ' ' is shared by more than four cmap entries (every unlit/undrawn
    // cmap row), so found > 4 and the line reads "can be many things".
    if (look_prefix_char(loc) === ' ') {
        const look = terrain_description(x, y);
        return {
            text: `${prefix}can be many things (${look})`,
            firstmatch: look,
            found: 1,
        };
    }

    // Fallback: single terrain description with the cmap symbol prefix.
    const desc = terrain_description(x, y);
    return { text: `${prefix}${an(desc)}`, firstmatch: desc, found: 1 };
}

// C ref: hacklib.c an() — prepend the indefinite article to a noun.
function an(s) {
    if (!s) return s;
    const c = s[0].toLowerCase();
    // a few words take no/"the" article in NetHack's an(); the recorded cases
    // ("human or elf", terrain nouns) all use simple a/an rules.
    if ('aeiou'.includes(c)) return `an ${s}`;
    return `a ${s}`;
}

// C ref: pager.c checkfile() — derive the data-file lookup key from the lookat
// firstmatch: strip a leading article and truncate at " called "/" named "/", "
// (the " (...)" charge/quantity stripping is not needed for these keys).
function dbase_key(firstmatch) {
    let key = String(firstmatch || '').toLowerCase();
    key = key.replace(/^(a |an |the |some )/, '');
    const cut = key.search(/ called | named |, /);
    if (cut >= 0) key = key.slice(0, cut);
    return key;
}

// C ref: pager.c checkfile() data.base scan — the "More info about ..." query
// is only offered when the lookup key matches an entry in dat/data.base.  The
// data file is not shipped with the port, so the terrain/feature/self keys the
// whatis ('/') picks can produce are matched against the relevant data.base
// entry patterns here (globs taken verbatim from dat/data.base):
//   "* wizard"/"wizard" (human wizard), "branch stair*", "stair*",
//   "doorway", "fountain", "ice" — present;
//   "floor of a room", "dark part of a room", "corridor", "wall",
//   "staircase"-without-direction — absent.
function dbase_has_entry(key) {
    if (!key) return false;
    if (/ wizard$/.test(key) || key === 'wizard') return true;
    if (key.startsWith('branch stair')) return true;
    if (key.startsWith('stair')) return true;       // "stair*"
    if (key === 'doorway') return true;
    if (key === 'fountain') return true;
    if (key === 'ice') return true;
    return false;
}

// C ref: pager.c checkfile() — offer "More info about \"<key>\"?" (y_n) when the
// key exists in data.base.  The recorded session always answers 'n', so no data
// is displayed.  Returns true if the prompt was shown (a key was read).
async function checkfile_moreinfo(firstmatch) {
    const key = dbase_key(firstmatch);
    if (!key || !dbase_has_entry(key)) return false;
    // y_n shows the description's --More-- first (set before this call).
    await y_n(`More info about "${key}"?`, 'yn\x1b', 'n');
    return true;
}

// ── data.base lookup (pager.c checkfile) ──────────────────────────────────
//
// The typed ('?') and carried-item ('i') whatis picks look their target up in
// dat/data.base and, when found, display the entry in a window.  Both pass
// chkfilUsrTyped|chkfilDontAsk, so checkfile shows the entry directly (no
// "More info about ...?" y/n gate).  The compiled 'data' index/text is bundled
// in data_base_data.js.  (The '/' map-pick path keeps its own light-weight
// checkfile_moreinfo above, which only offers the y/n query.)

// C ref: strutil.c pmatch() — case-sensitive wildcard match: '*' matches zero
// or more characters, '?' matches exactly one (non-empty) character.  data.base
// keys are lowercase and checkfile lowercases the lookup string, so the
// case-sensitive form suffices.
function db_pmatch(patrn, strng) {
    let pi = 0, si = 0, star = -1, ss = 0;
    const pl = patrn.length, sl = strng.length;
    while (si < sl) {
        if (pi < pl && (patrn[pi] === '?' || patrn[pi] === strng[si])) {
            pi++; si++;
        } else if (pi < pl && patrn[pi] === '*') {
            star = pi++; ss = si;
        } else if (star !== -1) {
            pi = star + 1; si = ++ss;
        } else {
            return false;
        }
    }
    while (pi < pl && patrn[pi] === '*') pi++;
    return pi === pl;
}

// C ref: hacklib.c tabexpand() — expand tabs to spaces on 8-column stops.
function db_tabexpand(sbuf) {
    let out = '', idx = 0;
    for (let k = 0; k < sbuf.length; k++) {
        const c = sbuf[k];
        if (c === '\t') {
            do { out += ' '; } while (++idx % 8);
        } else {
            out += c; ++idx;
        }
    }
    return out;
}

// C ref: objnam.c makesingular() — de-pluralize a noun for the data.base
// lookup's alternate key.  Partial faithful port: handles compound phrases
// ("<foo> of <bar>" -> singularize <foo>), the -s/-es/-ies/-ves trailing rules
// and -men -> -man; other words (incl. anything that isn't a recognizable
// plural) are returned unchanged.  Used only by the new checkfile path.
const DB_VOWELS = 'aeiou';
function db_makesingular(oldstr) {
    let s = String(oldstr || '');
    s = s.replace(/^ +/, '');
    if (!s) return '';
    // compound "foo of bar": operate on the head, restore the tail afterwards.
    const compounds = [' of ', ' labeled ', ' called ', ' named ', ' above',
        ' versus ', ' from ', ' in ', ' on ', ' a la ', ' with', ' de ',
        " d'", ' du ', ' au ', '-in-', '-at-'];
    let head = s, excess = '';
    {
        const low = s.toLowerCase();
        let cut = -1;
        for (let p = 0; p < s.length; p++) {
            if (s[p] !== ' ' && s[p] !== '-') continue;
            for (const cmpd of compounds) {
                if (low.startsWith(cmpd, p)) { cut = p; break; }
            }
            if (cut >= 0) break;
        }
        if (cut >= 0) { head = s.slice(0, cut); excess = s.slice(cut); }
    }
    const bp = head;
    const low = bp.toLowerCase();
    const n = bp.length;
    const ends = (suf) => low.endsWith(suf);
    let res = bp;
    if (n >= 1 && low[n - 1] === 's') {
        if (n >= 2 && low[n - 2] === 'e') {
            if (n >= 3 && low[n - 3] === 'i') { /* "ies" */
                if (ends('cookies') || (ends('pies') && (n === 4 || low[n - 5] === ' '))
                    || (ends('genies') && (n === 6 || low[n - 7] === ' '))
                    || ends('mbies') || ends('yries')) {
                    res = bp.slice(0, n - 1); /* drop s */
                } else {
                    res = bp.slice(0, n - 3) + 'y'; /* ies -> y */
                }
            } else if (n >= 4 && (('lr'.includes(low[n - 4]) || DB_VOWELS.includes(low[n - 4]))
                       && ends('ves'))) {
                if (ends('cloves') || ends('nerves')) res = bp.slice(0, n - 1);
                else res = bp.slice(0, n - 3) + 'f'; /* ves -> f */
            } else if (ends('eses') || ends('oxes') || ends('nxes') || ends('ches')
                       || ends('uses') || ends('shes') || ends('sses')
                       || ends('atoes') || ends('dingoes') || ends('aleaxes')) {
                res = bp.slice(0, n - 2); /* drop es */
            } else {
                res = bp.slice(0, n - 1); /* drop s */
            }
        } else if (ends('us')) { /* lotus, fungus... */
            if (!ends('tengus') && !ends('hezrous')) res = bp.slice(0, n - 1);
            /* else keep (tengus/hezrous) */
            else res = bp;
        } else if (ends('ss') || ends(' lens') || low === 'lens') {
            res = bp; /* keep */
        } else {
            res = bp.slice(0, n - 1); /* drop s */
        }
    } else { /* doesn't end in 's' */
        if (ends('men')) res = bp.slice(0, n - 2) + 'an';
        else res = bp;
    }
    return res + excess;
}

// C ref: pager.c checkfile() index scan — walk the data.base entries in file
// order.  Within an entry's key group a positive pmatch wins immediately; a
// '~'-prefixed key that matches excludes the whole entry (skip to the next).
// Returns { off, lines } of the first matching entry, or null.
function db_find_entry(target) {
    for (const [keys, off, lines] of DATABASE_ENTRIES) {
        let matched = false, skip = false;
        for (const key of keys) {
            const chkSkip = key[0] === '~';
            const k = chkSkip ? key.slice(1) : key;
            if (db_pmatch(k, target)) {
                if (chkSkip) { skip = true; break; }
                matched = true; break;
            }
        }
        if (skip) continue;
        if (matched) return { off, lines };
    }
    return null;
}

// C ref: pager.c checkfile() — process an entry's raw lines for display: strip
// one leading tab (or up to 8 leading spaces), then tabexpand any remaining
// tabs (e.g. the "\t\t[ ... ]" attribution).
function db_process_lines(rawLines) {
    const out = [];
    for (const raw of rawLines) {
        let tp = raw;
        if (tp[0] === '\t') {
            tp = tp.slice(1);
        } else if (tp[0] === ' ') {
            let j = 0;
            while (j < 8 && j < tp.length && tp[j] === ' ') j++;
            tp = tp.slice(j);
        }
        if (tp.indexOf('\t') >= 0) tp = db_tabexpand(tp);
        out.push(tp);
    }
    return out;
}

// C ref: win/tty/wintty.c tty_display_nhwindow + process_text_window for the
// NHW_MENU data window (recorder build: H2344_BROKEN).  A menu window whose
// line count fits (< rows) is an overlay: offx = min(min(82, cols/2),
// cols - maxcol - 1) with maxcol = max(len)+1, each line drawn at offx+1 (a
// leading space occupies offx), and a single "--More--" at offx+1 on the row
// after the content.  A window with >= rows lines is forced full-screen
// (offx 0) and paged every rows-1 lines.  Reads the dismiss key(s) via nhgetch
// (each drawn state is a recorded frame), then redraws the map underneath.
async function display_dbase_window(lines, forceFull = false) {
    const disp = game.nhDisplay;
    const cols = disp?.cols || 80;
    const rows = disp?.rows || 24;

    let maxcol = 0;
    for (const l of lines) maxcol = Math.max(maxcol, l.length + 1);

    const fullscreen = forceFull || lines.length >= rows;
    let offx = fullscreen ? 0
        : Math.min(Math.min(82, Math.floor(cols / 2)), cols - maxcol - 1);
    if (offx < 0) offx = 0;
    const textCol = offx === 0 ? 0 : offx + 1;

    const perPage = rows - 1; // content rows; the morestr sits on the last row
    // Split into pages (only ever >1 in the forced full-screen case).
    const pages = [];
    for (let p = 0; p < lines.length; p += perPage) pages.push(lines.slice(p, p + perPage));

    for (let pi = 0; pi < pages.length; pi++) {
        const page = pages[pi];
        if (offx === 0) {
            // Full-screen: clear the whole grid, then the content at col 0.
            for (let r = 0; r < rows; r++)
                for (let c = 0; c < cols; c++) disp.setCell(c, r, ' ', NO_COLOR, 0);
        } else {
            // Overlay: only blank the window's column band on the content rows
            // and the morestr row (the map shows through to the left of offx).
            for (let c = 0; c < cols; c++) disp.setCell(c, 0, ' ', NO_COLOR, 0); // topl
        }
        for (let r = 0; r < page.length; r++) {
            if (offx !== 0) for (let c = offx; c < cols; c++) disp.setCell(c, r, ' ', NO_COLOR, 0);
            if (page[r]) disp.putstr(textCol, r, page[r], NO_COLOR, 0);
        }
        const moreRow = offx === 0 ? rows - 1 : page.length;
        if (offx !== 0) for (let c = offx; c < cols; c++) disp.setCell(c, moreRow, ' ', NO_COLOR, 0);
        disp.putstr(textCol, moreRow, '--More--', NO_COLOR, 0);
        disp.setCursor(textCol + '--More--'.length, moreRow);
        // xwaitforspace(quitchars): any of space/return/ESC dismisses the page;
        // ESC cancels the rest (breaks out).  Each redraw is a recorded frame.
        let dismissed = false;
        while (!dismissed) {
            const k = await nhgetch();
            if (k === 27) { pi = pages.length; dismissed = true; } // ESC: cancel all
            else if (k === 32 || k === 13 || k === 10) dismissed = true;
            // other keys ring the bell in C; reloop without redraw.
        }
    }
    // Restore the map/status underneath the dismissed window.
    game._pending_message = '';
    game._toplin = 0;
    await flush_screen(1);
}

// C ref: pager.c checkfile() — look 'inp' up in data.base and, for the typed
// ('?')/carried-item ('i') paths (chkfilUsrTyped|chkfilDontAsk), display the
// matching entry directly.  Ports the input normalization (article/prefix
// stripping, "named"/"called"/", " truncation, makesingular alternate key) and
// the two-pass scan with the pass1offset dedup.  Returns TRUE if an entry was
// found.  user_typed_name && no first-pass match -> the "no information"
// message.
async function checkfile(inp, chkflags) {
    const user_typed_name = (chkflags & 1) !== 0;   // chkfilUsrTyped
    // without_asking (chkfilDontAsk, bit 2) is always set on these paths.

    if (inp == null) return false;
    let dbase_str = String(inp).toLowerCase();

    // strip a leading "interior of "
    if (dbase_str.startsWith('interior of ')) dbase_str = dbase_str.slice(12);
    // article / count prefix
    if (dbase_str.startsWith('a ')) dbase_str = dbase_str.slice(2);
    else if (dbase_str.startsWith('an ')) dbase_str = dbase_str.slice(3);
    else if (dbase_str.startsWith('the ')) dbase_str = dbase_str.slice(4);
    else if (dbase_str.startsWith('some ')) dbase_str = dbase_str.slice(5);
    else if (/^\d/.test(dbase_str)) {
        dbase_str = dbase_str.replace(/^\d+/, '');
        if (dbase_str[0] === ' ') dbase_str = dbase_str.slice(1);
    }
    if (dbase_str.startsWith('pair of ')) dbase_str = dbase_str.slice(8);
    if (dbase_str.startsWith('tame ')) dbase_str = dbase_str.slice(5);
    else if (dbase_str.startsWith('peaceful ')) dbase_str = dbase_str.slice(9);
    if (dbase_str.startsWith('invisible ')) dbase_str = dbase_str.slice(10);
    if (dbase_str.startsWith('saddled ')) dbase_str = dbase_str.slice(8);
    if (dbase_str.startsWith('blessed ')) dbase_str = dbase_str.slice(8);
    else if (dbase_str.startsWith('uncursed ')) dbase_str = dbase_str.slice(9);
    else if (dbase_str.startsWith('cursed ')) dbase_str = dbase_str.slice(7);
    if (dbase_str.startsWith('empty ')) dbase_str = dbase_str.slice(6);
    if (dbase_str.startsWith('partly used ')) dbase_str = dbase_str.slice(12);
    else if (dbase_str.startsWith('partly eaten ')) dbase_str = dbase_str.slice(13);
    if (dbase_str.startsWith('statue of ')) dbase_str = dbase_str.slice(0, 6);
    else if (dbase_str.startsWith('figurine of ')) dbase_str = dbase_str.slice(0, 8);
    // enchantment prefix "+0 "/"-1 "
    if (dbase_str && '+-'.includes(dbase_str[0]) && /\d/.test(dbase_str[1] || '')) {
        dbase_str = dbase_str.slice(1).replace(/^\d+/, '');
        if (dbase_str[0] === ' ') dbase_str = dbase_str.slice(1);
    }
    if (dbase_str.startsWith('moist towel')) dbase_str = 'wet' + dbase_str.slice(5);

    if (!dbase_str) return false;

    // "named"/"called"/", " -> truncate to base name; the tail becomes 'alt'.
    let alt = null;
    let ep = dbase_str.indexOf(' named ');
    if (ep >= 0) {
        alt = dbase_str.slice(ep + 7);
        const ap = dbase_str.indexOf(' called ');
        if (ap >= 0 && ap < ep) ep = ap;
        dbase_str = dbase_str.slice(0, ep);
    } else if ((ep = dbase_str.indexOf(' called ')) >= 0) {
        alt = dbase_str.slice(ep + 8);
        dbase_str = dbase_str.slice(0, ep);
    } else if ((ep = dbase_str.indexOf(', ')) >= 0) {
        dbase_str = dbase_str.slice(0, ep);
    }
    // strip article from alt
    if (alt) {
        if (alt.startsWith('a ')) alt = alt.slice(2);
        else if (alt.startsWith('an ')) alt = alt.slice(3);
        else if (alt.startsWith('the ')) alt = alt.slice(4);
    }
    // remove " (...)" charge/quantity from base and alt
    let par = dbase_str.indexOf(' (');
    if (par > 0) dbase_str = dbase_str.slice(0, par);
    if (alt) { par = alt.indexOf(' ('); if (par > 0) alt = alt.slice(0, par); }

    if (!alt) alt = db_makesingular(dbase_str);
    if (!dbase_str) return false;

    let res = false;
    let pass1offset = null;
    let pass1found = false;
    const startPass = (alt === dbase_str) ? 0 : 1;
    for (let pass = startPass; pass >= 0; pass--) {
        const target = (pass === 1) ? alt : dbase_str;
        const hit = target ? db_find_entry(target) : null;
        if (hit) {
            const fseekoffset = hit.off;
            if (pass === 1) { pass1offset = fseekoffset; pass1found = true; }
            else if (fseekoffset === pass1offset) break; // same entry as pass 1
            res = true;
            const shown = db_process_lines(hit.lines);
            await display_dbase_window(shown);
        } else if (user_typed_name && pass === 0 && !pass1found) {
            game._pending_message = 'You don\'t have any information on those things.';
            game._toplin = 1;
        }
    }
    return res;
}

// C ref: pager.c look_region_nearby() + look_traps() — count seen/remembered
// traps inside the look region.  nearby => a BOLT_LIM (8) box clamped to the
// map around the hero; otherwise the whole level.  Only the count is needed to
// decide the "No traps seen or remembered[ nearby]." message.
function count_seen_traps(nearby) {
    const u = game.u;
    const BOLT_LIM = 8;
    const lo_y = nearby ? Math.max(u.uy - BOLT_LIM, 0) : 0;
    const lo_x = nearby ? Math.max(u.ux - BOLT_LIM, 1) : 1;
    const hi_y = nearby ? Math.min(u.uy + BOLT_LIM, ROWNO - 1) : ROWNO - 1;
    const hi_x = nearby ? Math.min(u.ux + BOLT_LIM, COLNO - 1) : COLNO - 1;
    let count = 0;
    for (const t of (game.level?.traps || [])) {
        if (!t.tseen) continue;
        if (t.tx >= lo_x && t.tx <= hi_x && t.ty >= lo_y && t.ty <= hi_y) count++;
    }
    return count;
}

// C ref: pager.c look_engrs() — list seen/remembered engravings in the look
// region as a full-screen NHW_TEXT window (or the "No engravings..." message
// when none).  Each line is: "%8s  <sym> <text>" where <sym> is the engraving
// glyph ('`') and <text> comes from add_quoted_engraving() + the strsubst
// cleanup.  When the engraving cell is covered (hero/monster/object on top) the
// engraving isn't "shown", so ", obscured by <coverglyph>" is appended.
async function do_look_engrs(nearby) {
    const { engr_at } = await import('./engrave.js');
    const u = game.u;
    const BOLT_LIM = 8;
    const lo_y = nearby ? Math.max(u.uy - BOLT_LIM, 0) : 0;
    const lo_x = nearby ? Math.max(u.ux - BOLT_LIM, 1) : 1;
    const hi_y = nearby ? Math.min(u.uy + BOLT_LIM, ROWNO - 1) : ROWNO - 1;
    const hi_x = nearby ? Math.min(u.ux + BOLT_LIM, COLNO - 1) : COLNO - 1;

    const lines = [];
    let count = 0;
    const ENGR_SYM = '`'; // S_engroom cmap symbol
    for (let y = lo_y; y <= hi_y; y++) {
        for (let x = lo_x; x <= hi_x; x++) {
            const loc = game.level?.at(x, y);
            if (!loc || !loc.seenv) continue;
            const e = engr_at(x, y);
            if (!e) continue;
            // C builds " (engraving" + add_quoted_engraving(), then strsubst.
            // Headstone/grave variants are not distinguished here (starter
            // levels have no graves).
            let full = ' (engraving';
            if (e.eread)
                full += ` with remembered text: "${e.rememberedText}"`;
            else
                full += ' that you haven\'t read';
            full = full.replace('(engraving with ', '');
            full = full.replace('(engraving ', 'engraving ');
            // Determine whether the engraving glyph is what is actually shown,
            // or something covers it.  The hero (drawn as an overlay, not in the
            // map memory) covers when standing on the cell; otherwise the map
            // memory's display char is the top glyph.
            let coverChar;
            if (x === u.ux && y === u.uy) {
                coverChar = '@'; // player-monster symbol (non-polymorphed hero)
            } else {
                const dch = loc.disp_decgfx ? (DEC_TO_UNICODE[loc.disp_ch] || loc.disp_ch)
                                            : loc.disp_ch;
                coverChar = dch;
            }
            const shown = (coverChar === ENGR_SYM);
            if (!shown) full += `, obscured by ${coverChar}`;
            count++;
            if (count === 1) {
                lines.push(nearby ? 'Nearby seen or remembered engravings:'
                                  : 'Seen or remembered engravings on this level:');
                lines.push('    '); // Qt fixed-width separator (renders blank)
            }
            const coord = `<${x},${y}>`;
            lines.push(`${coord.padStart(8)}  ${ENGR_SYM} ${full}`);
        }
    }
    if (count)
        await display_dbase_window(lines, /*forceFull=*/true);
    else
        await pline(`No engravings seen or remembered${nearby ? ' nearby' : ''}.`);
}

// C ref: hacklib.c upstart() — capitalize the first letter of a string.
function upstart(s) {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// C ref: defsym.h FURNSYMS explanation text (PCHAR2's 4th/"desc" field) for
// the 6 furniture appearances makemon.js's FURNSYMS table can assign a mimic
// (S_upstair/S_dnstair/S_altar/S_grave/S_throne/S_sink).
const FURNITURE_EXPLANATION = {
    25: 'staircase up',
    26: 'staircase down',
    33: 'altar',
    34: 'grave',
    35: 'opulent throne',
    36: 'sink',
};

// C ref: pager.c mhidden_description() — the ", mimicking X" suffix
// look_at_monster() appends whenever M_AP_TYPE(mtmp) is set (mundetected
// hiders' ", hiding"/etc suffix isn't reached by the sessions modelled here).
// For M_AP_FURNITURE it's always defsyms[mappearance].explanation.  For
// M_AP_OBJECT, C's object_from_map() only names a REAL floor object standing
// under the disguised mimic — _map_location maps what's actually there (the
// mimic's fake appearance is display-only, never written to the remembered
// glyph) — same object look_at_object_here's vobj_at/covers_objects check
// finds; a mimic on otherwise bare/unseen floor falls back to "something".
function mon_hidden_suffix(mtmp) {
    if (mtmp.m_ap_type === 'furniture') {
        const what = FURNITURE_EXPLANATION[mtmp.mappearance] || 'something';
        return `, mimicking ${an(what)}`;
    }
    if (mtmp.m_ap_type === 'obj') {
        const objname = look_at_object_here(mtmp.mx, mtmp.my);
        return `, mimicking ${objname || 'something'}`;
    }
    return '';
}

// C ref: pager.c:422 look_at_monster() — the health/tame/peaceful-prefixed
// monster name.  monhealthdescr is disabled in C (#if 0), so the adjective plus
// distant_monnam() is the whole name; the "isn't able to move" suffixes below
// are what turn the bones ghost into "Elara's ghost, asleep".
function look_at_monster_desc(mtmp) {
    // C: distant_monnam(mtmp, ARTICLE_NONE, buf) — which is x_monnam(called),
    // so the shopkeeper / given-name / "<name>'s ghost" spellings all come from
    // the one place that already models them, instead of a local subset.
    let buf = distant_monnam(mtmp, ARTICLE_NONE);
    const adj = mtmp.mtame ? 'tame ' : (mtmp.mpeaceful ? 'peaceful ' : '');
    buf = `${adj}${buf}`;
    // C ref: pager.c:455-464 — "if mtmp isn't able to move ... say so".
    if (mtmp.mfrozen) buf += ', can\'t move (paralyzed or sleeping or busy)';
    else if (mtmp.msleeping) buf += ', asleep';
    else if ((mtmp.mstrategy & STRAT_WAITMASK) !== 0) buf += ', meditating';
    return `${buf}${mon_hidden_suffix(mtmp)}`;
}

// C ref: pager.c look_all() — list monsters (do_mons) or objects (!do_mons) in
// the look region as a full-screen NHW_TEXT window.  The per-line prefix is
// "%8s  <sym>  " where the coord is the look_all form (a trailing space is
// appended for y<10 so the commas of <x,y> line up) and <sym> is the displayed
// glyph symbol (the hero is '@'; other monsters/objects use the map's shown
// character).  Empty region -> the "No monsters/objects..." message.
async function do_look_all(nearby, do_mons) {
    const u = game.u;
    const BOLT_LIM = 8;
    const lo_y = nearby ? Math.max(u.uy - BOLT_LIM, 0) : 0;
    const lo_x = nearby ? Math.max(u.ux - BOLT_LIM, 1) : 1;
    const hi_y = nearby ? Math.min(u.uy + BOLT_LIM, ROWNO - 1) : ROWNO - 1;
    const hi_x = nearby ? Math.min(u.ux + BOLT_LIM, COLNO - 1) : COLNO - 1;

    const lines = [];
    let count = 0;
    const cellSym = (loc) => (loc && loc.disp_ch)
        ? (loc.disp_decgfx ? (DEC_TO_UNICODE[loc.disp_ch] || loc.disp_ch) : loc.disp_ch)
        : ' ';
    for (let y = lo_y; y <= hi_y; y++) {
        for (let x = lo_x; x <= hi_x; x++) {
            const loc = game.level?.at(x, y);
            let lookbuf = '', sym = '';
            if (do_mons) {
                if (x === u.ux && y === u.uy) {
                    // canspotself: hero visible on their own square.
                    lookbuf = self_lookat();
                    sym = '@';
                } else {
                    const mtmp = m_at(x, y);
                    if (mtmp && canspotmon(mtmp)) {
                        lookbuf = look_at_monster_desc(mtmp);
                        sym = cellSym(loc);
                    }
                }
            } else {
                // objects: count only cells whose DISPLAYED glyph is an object
                // (C: glyph_is_object(glyph_at)).  vobj_at finds any object on
                // the cell, but an out-of-sight/unremembered one isn't shown, so
                // require the cell's current symbol to equal the object glyph.
                if (!(x === u.ux && y === u.uy) && !m_at(x, y)) {
                    const otmp = vobj_at(x, y);
                    if (otmp && !covers_objects(loc)) {
                        const og = object_glyph(otmp);
                        const ogch = og.dec ? (DEC_TO_UNICODE[og.ch] || og.ch) : og.ch;
                        if (cellSym(loc) === ogch) {
                            lookbuf = obj_doname(otmp);
                            sym = cellSym(loc);
                        }
                    }
                }
            }
            if (lookbuf) {
                count++;
                if (count === 1) {
                    const which = do_mons ? 'monsters' : 'objects';
                    lines.push(nearby
                        ? `${upstart(which)} currently shown near <${u.ux},${u.uy}>:`
                        : `All ${which} currently shown on the map:`);
                    lines.push('    '); // Qt fixed-width separator (renders blank)
                }
                let coordbuf = `<${x},${y}>`;
                if (y < 10) coordbuf += ' '; // look_all coordinate-alignment kitten
                lines.push(`${coordbuf.padStart(8)}  ${sym}  ${lookbuf}`);
            }
        }
    }
    if (count)
        await display_dbase_window(lines, /*forceFull=*/true);
    else
        await pline(`No ${do_mons ? 'monsters' : 'objects'} are currently shown ${nearby ? 'nearby' : 'on the map'}.`);
}

// C ref: pager.c do_look(mode=0) — the '/' whatis command.
export async function do_look_full() {
    const u = game.u;
    const WHAT = 'a monster, object or location';

    // 1. Present the whatis menu and read the PICK_ONE selection.  The tty
    //    PICK_ONE loop (wintty.c process_menu_window + xwaitforspace) lives in
    //    pager.js: a key that is neither a selector nor a menu command rings
    //    the bell and is re-read with the menu still displayed.
    const { whatis_menu_pick } = await import('./pager.js');
    const i = await whatis_menu_pick(render_whatis_menu);
    // Redraw the map under the dismissed menu before any prompt is shown.
    game._pending_message = '';
    game._toplin = 0;
    await flush_screen(1);

    if (i === '?') {
        // C do_look case '?': getlin("Specify what? (type the word)"), then
        // mungspaces; an empty/ESC reply cancels.  A multi-character reply is a
        // "complete string" -> checkfile(out_str, chkfilUsrTyped|chkfilDontAsk)
        // which shows the data.base entry directly (no y/n gate).  A single
        // character would fall through to the by-symbol farlook, which the
        // recorded session never does; treat it as a cancel for now.
        const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
        let out_str = await hooked_tty_getlin('Specify what? (type the word)', null);
        if (out_str !== ' ') out_str = out_str.replace(/\s+/g, ' ').replace(/^ | $/g, '');
        if (out_str === '' || out_str[0] === '\x1b') { game.context.move = 0; return; }
        if (out_str.length > 1) {
            await checkfile(out_str, 1 | 2 /* chkfilUsrTyped|chkfilDontAsk */);
            game.context.move = 0;
            return;
        }
        // single-char symbol path not modelled; cancel.
        game.context.move = 0;
        return;
    }

    if (i === 'i') {
        // C do_look case 'i': invlet = display_inventory(NULL, TRUE); if a real
        // item was picked, checkfile(singular(obj, xname), UsrTyped|DontAsk).
        const nm = await whatis_pick_inventory();
        if (nm) {
            // The picked-item menu is dismissed; redraw the map before the
            // data.base overlay so it shows through to the left of the window.
            await flush_screen(1);
            await checkfile(nm, 1 | 2);
        }
        game.context.move = 0;
        return;
    }

    if (i === 't' || i === 'T') {
        // C do_look case 't'/'T' -> look_traps(nearby).  Scan the look region
        // (nearby => BOLT_LIM=8 box around the hero, else the whole map) for
        // seen/remembered traps.  When none are found the command just prints
        // "No traps seen or remembered[ nearby]." (no window).  The trap-listing
        // window for count>0 is not modelled; that case falls through to the
        // same no-time-passing cancel as before (no message), which is what the
        // unimplemented sub-modes already did.
        const nearby = (i === 't');
        if (count_seen_traps(nearby) === 0)
            await pline(`No traps seen or remembered${nearby ? ' nearby' : ''}.`);
        game.context.move = 0;
        return;
    }

    if (i === 'm' || i === 'M') {
        // C do_look case 'm'/'M' -> look_all(nearby, do_mons=TRUE).
        await do_look_all(i === 'm', true);
        game.context.move = 0;
        return;
    }

    if (i === 'o' || i === 'O') {
        // C do_look case 'o'/'O' -> look_all(nearby, do_mons=FALSE).
        await do_look_all(i === 'o', false);
        game.context.move = 0;
        return;
    }

    if (i === 'e' || i === 'E') {
        // C do_look case 'e'/'E' -> look_engrs(nearby).
        await do_look_engrs(i === 'e');
        game.context.move = 0;
        return;
    }

    if (i !== '/') {
        // Other sub-modes (inventory/symbol/monster/object listings) are not
        // modelled yet; cancel cleanly with no time passing.
        game.context.move = 0;
        return;
    }

    // 2. '/' => from_screen; cc starts on the hero and persists across the
    //    do-while loop (C passes &cc to getpos by reference, so each pass
    //    resumes where the previous one left off).  flags.verbose (default on)
    //    => "Please move the cursor to <what>." then the verbose getpos loop.
    //    The do-while loops for LOOK_TRADITIONAL ('.') until ESC.
    let cx = u.ux, cy = u.uy;
    // C ref: pager.c:1892/1961 — do_look snapshots flags.verbose and restores
    // it on the way out, so the "only print long question once" clear at :1911
    // lasts for this command's repeat loop only.  Modelled as a local.
    let verbose = game.flags?.verbose !== false;
    for (;;) {
        if (verbose) {
            // C do_look:1903 pline("Please move the cursor to %s.") — NEED_MORE;
            // getpos's tip/verbose handling fires its --More-- frame.
            await update_topl(`Please move the cursor to ${WHAT}.`);
        } else {
            // Route through update_topl so any pending description (NEED_MORE
            // from a found>1 pick) gets its --More-- frame before this prompt
            // replaces it.
            await update_topl(`Pick ${WHAT}.`);
            await flush_screen(1);
            const disp = game.nhDisplay;
            if (disp?.setCursor) disp.setCursor(cx - 1, cy + 1);
        }

        const cc = await getpos(WHAT, cx, cy, null, /*force=*/false,
                                /*verbose=*/verbose);
        if (!cc) break; // ESC -> exit the do-while loop
        verbose = false;              // pager.c:1911 flags.verbose = FALSE
        cx = cc.x; cy = cc.y;

        // do_screen_description on the picked square.  putmixed leaves the
        // top line NEED_MORE; the data-file query (when the key exists in
        // data.base) fires its own --More-- via y_n.  Otherwise the NEED_MORE
        // line is flushed with --More-- by the next loop's "Pick..." or exit.
        const { text, firstmatch } = look_pick_description(cc.x, cc.y);
        game._pending_message = text;
        game._toplin = 1;        // NEED_MORE
        game._yn_need_more = true;
        const prompted = await checkfile_moreinfo(firstmatch);
        game._yn_need_more = false;
        if (prompted) {
            game._pending_message = '';
            game._toplin = 0;
        }
        // found>1: leave NEED_MORE pending for the next "Pick..."/exit to flush.
        // C do-while continues for LOOK_TRADITIONAL; the loop top reprompts.
    }

    game._pending_message = '';
    game._toplin = 0;
    game.context.move = 0;
}

// C ref: teleport.c dotelecmd() -> dotele(break_the_rules=TRUE) -> tele().  In
// wizard mode (playmode:debug) the ^T command with no 'm' prefix sets
// ignore_restrictions and calls dotele(TRUE); with no trap under the hero it
// skips the spell/energy block, and because wizard is set tele() shows
// "Where do %s want to be teleported?" ("you") and enters getpos(&cc, TRUE,
// "the desired position").  When getpos is cancelled (ESC -> result < 0) tele()
// returns without teleporting, but dotele() still returns 1 (ECMD_TIME): the
// command consumes a game turn (the moveloop then runs the monster moves).
// When a spot IS picked, C's tele()/scrolltele(0) does:
//   if (teleok(cc.x, cc.y, FALSE)) { teleds(cc.x, cc.y, TELEDS_TELEPORT); return; }
//   pline("Sorry...");
//   (void) safe_teleds(TELEDS_TELEPORT);   /* scroll==NULL, so no learnscroll() */
// teleok_hero/teleds_hero/safe_teleds_hero (read.js) already port these
// hero-only subsets faithfully for the scroll-of-teleportation controlled/
// uncontrolled cases, and this is the exact same underlying C code path, so
// they're reused here rather than reimplemented.
export async function dotele_wizard() {
    const u = game.u;
    // tele() -> scrolltele(0): with the wizard override taken, C prints
    //   pline("Where do %s want to be teleported?", "you")   [no steed]
    // then getpos(&cc, force=TRUE, "the desired position").  The pline leaves the
    // message line pending (NEED_MORE); getpos()'s first-use farlook tip window
    // (handle_tip -> l_nhcore_call) then forces that pending line to be
    // acknowledged with --More-- before the tip is drawn.  So the recorded frames
    // are: "Where do you want to be teleported?--More--" (topl_more), then the
    // tip text window, then flags.verbose's "(For instructions type a '?')"
    // appended ahead of "Move cursor to the desired position:".  Model the pline
    // as a NEED_MORE topline and let getpos(verbose) fire the topl_more() frame.
    await getpos_render('Where do you want to be teleported?', u.ux, u.uy);
    game._toplin = 1; // TOPLIN_NEED_MORE — pending "Where..." pline
    game._toplines = 'Where do you want to be teleported?';
    const verbose = game.flags?.verbose !== false;
    const cc = await getpos('the desired position', u.ux, u.uy, null, /*force=*/true, verbose);
    if (!cc) {
        // ESC: getpos() returned < 0 -> tele() returns; dotele() still ECMD_TIME.
        return 1;
    }
    if (teleok_hero(cc.x, cc.y, false)) {
        await teleds_hero(cc.x, cc.y);
    } else {
        await pline('Sorry...');
        // C ref: topl.c update_topl() leaves toplin == TOPLINE_NEED_MORE, and
        // wintty.c:1902 tty_display_nhwindow()'s NHW_MENU arm pages an
        // unacknowledged topline with more() BEFORE laying down the overlay.
        // safe_teleds() lands the hero on the chained ball/chain pile, whose
        // look_here() menu must therefore be preceded by a "Sorry...--More--"
        // frame.  Set per call site: js/display.js pline() deliberately does not
        // raise _toplin globally (measured -191 public).
        game._toplin = 1;
        await safe_teleds_hero();
    }
    return 1;
}

export { getpos_tip, getpos, getpos_render, jump_landing, is_valid_jump_pos, get_valid_jump_position, jump_hilite_first_cursor, distu };

// ═════════════════════════════════════════════════════════════════════════════
// hack.c completeness block — INERT.
//
// Nothing above this line calls anything below it.  These are hack.c functions
// the port had no JS home for, added with C's names, control flow and RNG order
// so a future caller can wire them up without re-deriving them.  Wiring is
// deliberately left undone: js/cmd.js owns domove()/moverock() and js/allmain.js
// owns the moveloop, and both already have their own inline equivalents of the
// hack.c functions that were NOT added here.
// ═════════════════════════════════════════════════════════════════════════════

// ── shared local helpers ────────────────────────────────────────────────────

// C ref: objnam.c the(str) / The(str).  js/eat.js:378 and js/do_name.js:460 each
// carry the same private one-liner; the real fix is one shared export.
function the_(s) { return /^[A-Z]/.test(s) ? s : `the ${s}`; }
function The_(s) { return upstart(the_(s)); }
// C ref: do_name.h YMonnam(mtmp) — upstart(y_monnam(mtmp)).
function YMonnam(mtmp) { return upstart(y_monnam(mtmp)); }
// C ref: mondata.h type_is_pname(ptr).  Private at js/do_name.js:57.
function type_is_pname(ptr) { return (mflags2_of(ptr) & M2_PNAME) !== 0; }

// ── hack.c:73-95  the `anything` union constructors ─────────────────────────

// C ref: hack.c:71 gt.tmp_anything — all four *_to_any() builders return a
// pointer to ONE static, so two results ALIAS: f(long_to_any(1), long_to_any(2))
// passes the same pointer twice, both reading 2.  Modelled as one shared object.
// obj_to_any() is not repeated here: js/timeout.js:563 _obj_to_any() already has
// the faithful union form.  (js/invent.js:780 also defines one, but as the
// identity function, in that file's block of private no-op stubs; it has no
// callers, so it is not a live menu-identifier producer.)
const tmp_anything = {
    a_void: null, a_obj: null, a_monst: null, a_char: 0, a_schar: 0,
    a_uchar: 0, a_ushort: 0, a_int: 0, a_uint: 0, a_long: 0, a_ulong: 0,
    a_iflags: 0,
};

// C ref: decl.c cg.zeroany.
function zeroany_tmp() {
    for (const k of Object.keys(tmp_anything)) tmp_anything[k] = 0;
    tmp_anything.a_void = null;
    tmp_anything.a_obj = null;
    tmp_anything.a_monst = null;
    return tmp_anything;
}

// C's `anything` is a UNION, so writing a_uint/a_long/a_monst also makes a_void
// read non-NULL — and non-NULL a_void is wintty.c tty_add_menu()'s
// selectability marker (cf. js/coloratt.js:79-83, which models the same thing).
// C ref: hack.c:73 uint_to_any(ui).
export function uint_to_any(ui) {
    const any = zeroany_tmp();
    any.a_uint = ui;
    any.a_void = ui;
    return any;
}

// C ref: hack.c:81 long_to_any(lng).
export function long_to_any(lng) {
    const any = zeroany_tmp();
    any.a_long = lng;
    any.a_void = lng;
    return any;
}

// C ref: hack.c:89 monst_to_any(mtmp).
export function monst_to_any(mtmp) {
    const any = zeroany_tmp();
    any.a_monst = mtmp;
    any.a_void = mtmp;
    return any;
}

// ── hack.c:247-333  moverock() message + teardown helpers ───────────────────
// (moverock_core() itself is already implemented inline as moverock() in
//  js/cmd.js:3789ff, so it is not duplicated here.)

// C ref: hack.c:247 cannot_push_msg(otmp, sx, sy) — the boulder-won't-budge
// line, after cannot_push() has decided the hero can't get past it either.
export async function cannot_push_msg(otmp, sx, sy) {
    const u = game.u;
    const what = the_(xname(otmp));

    if (u.usteed)
        await pline(`${YMonnam(u.usteed)} tries to move ${what}, but cannot.`);
    else
        await pline(`You try to move ${what}, but in vain.`);
    if (Blind())
        feel_location(sx, sy);
}

// C ref: hack.c:315 rock_disappear_msg(otmp) — a pushed boulder that the
// destination square swallows (pit, hole, water, trapdoor).
export async function rock_disappear_msg(otmp) {
    const u = game.u;
    const what = the_(xname(otmp));

    if (u.usteed)
        await pline(`${YMonnam(u.usteed)} pushes ${what} and suddenly it disappears!`);
    else
        await pline(`You push ${what} and suddenly it disappears!`);
}

// C ref: hack.c:327 moverock_done(sx, sy) — undo the next_boulder chaining that
// moverock_core() set up for its "boulder behind a boulder" xname(), so the pile
// reads as plain "boulder" again.  C walks svl.level.objects[sx][sy]'s nexthere
// chain; the port keeps one flat object list keyed by ox/oy/where.
export function moverock_done(sx, sy) {
    for (const otmp of game.level?.objects || []) {
        if (otmp.ox === sx && otmp.oy === sy
            && (otmp.where === 'floor' || otmp.where === 1)
            && otmp.otyp === BOULDER)
            otmp.next_boulder = 0;
    }
}

// ── hack.c:1708-1783  the a11y "you notice a monster" announcements ──────────

// C ref: hack.c:1735 notice_mons_cmp() — qsort comparator putting the nearest
// monster first.  C's qsort is unstable; Array.prototype.sort has been stable
// since ES2019, so equal distances keep list order here.
export function notice_mons_cmp(m1, m2) {
    return distu(m1.mx, m1.my) - distu(m2.mx, m2.my);
}

// C ref: display.c set_msg_xy(x, y) — remembers which square the next message
// is about (msg_xy / #terrain highlighting).  Not ported.
function set_msg_xy(_x, _y) { /* no-op */ }

// C ref: hack.c:1708 notice_mon(mtmp) — announce a newly spotted monster once,
// and forget it again when it stops being spottable.  Gated on
// ACCESSIBILITY=mon_notices, which no recorded session sets, so this is inert
// in the corpus but it is real state (mtmp->mspotted) when enabled.
export async function notice_mon(mtmp) {
    const a11y = game.a11y || {};

    if (a11y.mon_notices && !a11y.mon_notices_blocked) {
        const spot = canspotmon(mtmp)
            && !(is_hider_flag(mtmp.data)
                 && (mtmp.mundetected
                     || M_AP_TYPE(mtmp) === M_AP_FURNITURE
                     || M_AP_TYPE(mtmp) === M_AP_OBJECT));

        if (spot && !mtmp.mspotted && !DEADMONSTER(mtmp)) {
            mtmp.mspotted = true;
            set_msg_xy(mtmp.mx, mtmp.my);
            const nam = x_monnam(mtmp,
                                 mtmp.mtame ? ARTICLE_YOUR
                                 : (!has_mgivenname(mtmp)
                                    && !type_is_pname(mtmp.data)) ? ARTICLE_A
                                 : ARTICLE_NONE,
                                 (mtmp.mpeaceful && !mtmp.mtame) ? 'peaceful' : null,
                                 has_mgivenname(mtmp) ? SUPPRESS_SADDLE : 0, false);
            await pline(`You ${canseemon_shared(mtmp) ? 'see' : 'notice'} ${nam}.`);
        } else if (!spot) {
            mtmp.mspotted = false;
        }
    }
}

// C ref: hack.c:1744 notice_all_mons(reset) — announce every spottable monster,
// nearest first.  The two passes are C's and differ: pass 1 only clears
// mspotted when `reset`, pass 2 clears it unconditionally.  Keeping both
// matters because pass 1's count caps how many pass 2 collects.
export async function notice_all_mons(reset) {
    const a11y = game.a11y || {};
    if (!(a11y.mon_notices && !a11y.mon_notices_blocked))
        return;

    const fmon = game.level?.monsters || [];
    let cnt = 0;

    for (const mtmp of fmon) {
        if (DEADMONSTER(mtmp)) continue;
        if (canspotmon(mtmp)) cnt++;
        else if (reset) mtmp.mspotted = false;
    }
    if (!cnt)
        return;

    const arr = [];
    for (const mtmp of fmon) {
        if (DEADMONSTER(mtmp)) continue;
        if (!canspotmon(mtmp)) mtmp.mspotted = false;
        else if (arr.length < cnt) arr.push(mtmp);
    }

    if (arr.length) {
        arr.sort(notice_mons_cmp);
        for (const mtmp of arr)
            await notice_mon(mtmp);
    }
}

// ── hack.c:1852  one-shot gameplay tips ─────────────────────────────────────

// C ref: hack.c:1852 handle_tip(tip) — show a tip once per game, tracked in
// svc.context.tips as bit `1 << tip`.
//
// DIVERGENCE (not fixed here — the three call sites are in other owners' files
// and in a function body above): the port's three existing per-tip inlines all
// disagree with C and with each other about the bit.
//   js/cmd.js:630            game._tips_shown, bit `1 << TIP_SWIM`   (correct form,
//                            but a different field from everyone else)
//   getpos_tip() above       game.context.tips, bit `1 << 4`         (should be 1 << 3)
//   js/extcmd-handlers.js:889, js/invent.js:6753
//                            game.context.tips & TIP_GETPOS          (missing the
//                            `1 <<`: tests bits 0|1, i.e. value 3)
// So the setter writes bit 16 and the two readers test bits 0|1 — the tip's
// "already shown" state is invisible across the sites.
export async function handle_tip(tip) {
    if (!game.flags?.tips)
        return false;

    const c = game.context;
    if (tip >= 0 && tip < NUM_TIPS && !((c.tips || 0) & (1 << tip))) {
        c.tips = (c.tips || 0) | (1 << tip);
        /* the "Tip:" prefix is a hint to use of OPTIONS=!tips to suppress */
        switch (tip) {
        case TIP_ENHANCE:
            await pline('(Tip: use the #enhance command to advance them.)');
            break;
        case TIP_SWIM:
            /* C: visctrl(cmd_from_func(do_reqmenu)).  'm' is do_reqmenu's
               binding and the port has no key rebinding (cf. js/cmd.js:633). */
            await pline("(Tip: use 'm' prefix to step in if you really want to.)");
            break;
        case TIP_UNTRAP_MON:
            await pline('(Tip: perhaps #untrap would help?)');
            break;
        case TIP_GETPOS:
            l_nhcore_call(NHCORE_GETPOS_TIP);
            break;
        default:
            /* C: impossible("Unknown tip in handle_tip(%i)", tip) */
            break;
        }
        return true;
    }
    return false;
}

// ── hack.c:2365-2509  movement-blocking checks ──────────────────────────────

// C ref: hack.c:2365 water_turbulence(&x, &y) — a submerged hero's step is first
// deflected by water_friction() (which draws rn2), and only then is the
// destination re-derived from the possibly-rewritten u.dx/u.dy.  `pos` stands in
// for C's two `coordxy *` out-params and is mutated in place.
// RNG: water_friction() only — near_capacity() draws nothing.
export async function water_turbulence(pos) {
    const u = game.u;

    if (u?.uinwater) {
        const wtmod = u.uprops?.Swimming ? MOD_ENCUMBER : SLT_ENCUMBER;

        await water_friction();
        if (!u.dx && !u.dy) {
            nomul(0);
            return true;
        }
        pos.x = u.ux + u.dx;
        pos.y = u.uy + u.dy;

        /* are we trying to move out of water while carrying too much?
           aquatic form (Swimming) may be stressed; otherwise only burdened */
        if (isok(pos.x, pos.y) && !is_pool(pos.x, pos.y)
            && !Is_waterlevel(u.uz) && near_capacity() > wtmod) {
            await pline('You are carrying too much to climb out of the water.');
            nomul(0);
            return true;
        }
    }
    return false;
}

// C ref: hack.c:2495 avoid_running_into_trap_or_liquid(x, y) — while
// running/rushing, refuse to step onto a known trap (or, when blind, into
// liquid).  Note the asymmetry: for run == 1 it still nomul(0)s but reports
// FALSE, so the step happens and only the run ends; run >= 2 also zeroes
// context.move so no turn elapses.
// C passes `would_stop` as avoid_moving_on_{trap,liquid}()'s `msg` argument;
// both local helpers above drop that parameter because their
// flags.mention_walls line is emitted at the js/cmd.js call site (see :128-131).
export function avoid_running_into_trap_or_liquid(x, y) {
    const c = game.context;
    const would_stop = (c?.run || 0) >= 2;

    if (!c?.run)
        return false;

    if (avoid_moving_on_trap(x, y)
        || (Blind() && avoid_moving_on_liquid(x, y))) {
        nomul(0);
        if (would_stop)
            c.move = 0;
        return would_stop;
    }
    return false;
}

// ── hack.c:2996  the per-step run delay ─────────────────────────────────────

// C ref: options.c:217 runmodes[] — this port stores flags.runmode as its option
// NAME rather than the RUN_* enum, so map back.
//
// DIVERGENCE (not fixed here — js/options.js is another owner's file):
// js/options.js:6846 initialises `flags.runmode = 'teleport'` with the comment
// "RUN_LEAP".  C's default is RUN_LEAP (options.c:7176), whose runmodes[] name
// is "run", not "teleport" (that is RUN_TPORT, index 0).  js/doset.js:292
// already displays "[run]", so the O-menu and the flag disagree.  The effect is
// that runmode_delay_output() below short-circuits on every call and never
// performs its `disp.time_botl = flags.time` write.
const RUNMODES = ['teleport', 'run', 'walk', 'crawl'];
function runmode_value() {
    const i = RUNMODES.indexOf(game.flags?.runmode);
    return i < 0 ? RUN_LEAP : i;
}

// C ref: windows nh_delay_output() — a pure output pause.  js/light.js:1005 has
// the identical no-op (private there).
async function nh_delay_output() { await Promise.resolve(); }
// C ref: windows curs_on_u() — park the cursor on the hero.  The recorded cursor
// is placed by js/display.js flush_screen() instead.
function curs_on_u() { /* no-op */ }

// C ref: hack.c:2996 runmode_delay_output() — the per-step display pause while
// running or in a multi-turn action.  The load-bearing part for a recorder is
// `disp.time_botl = flags.time`: moveloop() suppresses time_botl while running,
// and this is the only thing that puts it back, so without it T: never
// refreshes during a run.
export async function runmode_delay_output() {
    const runmode = runmode_value();

    if ((game.context?.run || game.multi) && runmode !== RUN_TPORT) {
        /* tport: show nothing until we stop.  leap: every 7th move (relative to
           the turn counter, not to the start of running).  walk and crawl
           (visual debugging): every step. */
        if (runmode !== RUN_LEAP || !((game.moves == null ? 0 : (game.moves | 0)) % 7)) {
            /* moveloop() suppresses time_botl when running */
            const time_botl = !!game.flags?.time;
            game.time_botl = time_botl;
            if (game.disp) game.disp.time_botl = time_botl;
            curs_on_u();
            await nh_delay_output();
            if (runmode === RUN_CRAWL) {
                await nh_delay_output();
                await nh_delay_output();
                await nh_delay_output();
                await nh_delay_output();
            }
        }
    }
}

// ── hack.c:3064  the vibrating-square clue ──────────────────────────────────

// C ref: dungeon.c invocation_pos(x, y) / On_stairs(x, y).  Both are private at
// js/artifact.js:2801 and :2805 (and On_stairs again at js/dogmove.js:521); the
// real fix is to export those, not to keep copies.
function invocation_pos(x, y) {
    const inv = game.level?.invocation_pos;
    return !!inv && inv.x === x && inv.y === y;
}
function On_stairs(x, y) {
    return (game.level?.stairs || []).some((s) => s.sx === x && s.sy === y);
}
// C ref: objects[] CANDELABRUM_OF_INVOCATION; js/apply.js:1470 holds the same
// private literal.
const CANDELABRUM_OF_INVOCATION = 262;

// C ref: hack.c:3064 invocation_message() — the "strange vibration" clue printed
// on the vibrating square.  Consumes no RNG.  Note that it nomul(0)s BEFORE the
// message, so a run stops on the square it lands on.
export async function invocation_message() {
    const u = game.u;

    if (invocation_pos(u.ux, u.uy) && !On_stairs(u.ux, u.uy)) {
        let buf;
        const otmp = carrying(CANDELABRUM_OF_INVOCATION);

        nomul(0); /* stop running or travelling */
        if (u.usteed)
            buf = `beneath ${y_monnam(u.usteed)}`;
        else if (u.uprops?.Levitation || u.uprops?.Flying)
            buf = 'beneath you';
        else
            buf = `under your ${makeplural(body_part(FOOT))}`;

        await pline(`You feel a strange vibration ${buf}.`);
        (u.uevent = u.uevent || {}).uvibrated = 1;
        if (otmp && otmp.spe === 7 && otmp.lamplit)
            await pline(`${The_(xname(otmp))} ${
                Blind() ? 'throbs palpably' : 'glows with a strange light'}!`);
    }
}

// ── hack.c:3466-3495  room contents queries ─────────────────────────────────

// C ref: hack.c:3466 monstinroom(mdat, roomno) — the first live monster of
// species `mdat` inside room `roomno`.  C's
// `strchr(in_rooms(mx, my, 0), roomno + ROOMOFFSET)` becomes includes():
// js/shkroom.js in_rooms() returns the room numbers as an array, already
// ROOMOFFSET-based to match levl[][].roomno.
export function monstinroom(mdat, roomno) {
    for (const mtmp of game.level?.monsters || []) {
        if (DEADMONSTER(mtmp))
            continue;
        if (mtmp.data === mdat
            && in_rooms(mtmp.mx, mtmp.my, 0).includes(roomno + ROOMOFFSET))
            return mtmp;
    }
    return null;
}

// C ref: hack.c:3482 furniture_present(furniture, roomno) — does room `roomno`
// contain a square of terrain type `furniture`?  The inside_room() test is what
// handles irregularly shaped rooms, whose bounding box covers other squares.
export function furniture_present(furniture, roomno) {
    const sroom = game.level?.rooms?.[roomno];
    if (!sroom)
        return false;

    const ly = sroom.ly, hy = sroom.hy, lx = sroom.lx, hx = sroom.hx;
    for (let y = ly; y <= hy; ++y)
        for (let x = lx; x <= hx; ++x)
            if (game.level?.at(x, y)?.typ === furniture && inside_room(sroom, x, y))
                return true;
    return false;
}

// ── hack.c:4247  the showdamage option's per-hit line ───────────────────────

// C ref: hack.c:4247 showdamage(dmg) — losehp()'s "[HP -3, 12 left]" trailer.
// iflags.showdamage is off in every recorded rc (js/options.js:1227).
export async function showdamage(dmg) {
    const iflags = game.iflags, u = game.u;

    if (!iflags?.showdamage || !dmg)
        return;

    await pline(`[HP ${-dmg}, ${u?.Upolyd ? u.mh : u.uhp} left]`);
}
