// steed.js — riding a steed.
//
// C ref: steed.c.  Ports the #ride command (doride) and mount_steed() for the
// case the recorded knight sessions exercise: a level-1 Knight repeatedly
// trying to mount the saddled pony makedog() created at game start.
//
// RNG (steed.c:341/354), per #ride attempt against a tame saddled pony:
//   rnd(MAXULEV/2 + 5) == rnd(20)   — the "slip" check (steed.c:341).  The
//       hero slips when  u.ulevel + mtmp->mtame < rnd(20).  A level-1 Knight
//       with a domestic (mtame == 10) pony slips when rnd(20) >= 12.
//   On a slip: losehp(rn1(5, 10), ...) where rn1(5,10) == rn2(5) + 10
//       (steed.c:354).  Maybe_Half_Phys is the identity here (no intrinsic
//       half-physical-damage for a starting Knight), so it consumes no RNG.
//   On success: no further RNG; "You mount <steed>." and u.usteed is set.
//
// All the early sanity-check branches (already-riding, Hallucination,
// Wounded_legs, Upolyd, encumbrance, blindness, swallow/stuck/trapped,
// unsaddled, petrifying, untame, mtrapped, levitation, stiff armor, the
// other slip conditions) are false for the recorded pony, so they fall
// through to the slip roll.  They are kept as guards (matching C order) but
// consume no RNG, so leaving them un-modelled in detail is RNG-faithful.

import { game, hooks } from './gstate.js';
import { Fumbling_hero } from './youprop.js';
import { rnd, rn1, rn2 } from './rng.js';
import { nhgetch } from './input.js';
import { pline, flush_screen, newsym, update_topl, urgent_topl, unmap_object,
         canseemon_shared, y_n } from './display.js';
import { m_at, Hallucination_u } from './display.js';
import { DEADMONSTER, mvitals_died, m_detach } from './mon.js';
import { killed, corpse_chance, make_corpse } from './uhitm.js';
import { is_pool, is_lava } from './dbridge.js';
import { enexto_gpflags, rloc_to, rloc, teleds } from './teleport.js';
import { sokoban_guilt, set_wounded_legs, heal_legs, trapname, Flying_fu, Levitation_fu, float_down } from './trap.js';
import { monster_by_pmidx, name_to_pmidx } from './makemon.js';
import { surface } from './dungeon.js';
import { hliquid, mon_nam, mon_pmname } from './do_name.js';
import { sobj_at, is_pole, near_capacity, youmonst_data } from './invent.js';
import { t_at } from './mkroom.js';
import { mon_mintrap } from './monmove.js';
import { vision_recalc, Blind } from './vision.js';
import { Stealth } from './shkroom.js';
import { steed_vs_stealth } from './polyself.js';
import { x_monnam } from './uhitm.js';
import { isok, MAXULEV, W_SADDLE, ACCESSIBLE, IS_DOOR, D_CLOSED, D_LOCKED,
         D_NODOOR, D_BROKEN, Is_rogue_level, SUPPRESS_IT, SUPPRESS_INVISIBLE,
         SUPPRESS_HALLUCINATION, NO_KILLER_PREFIX, KILLED_BY_AN,
         M_AP_FURNITURE, M_AP_OBJECT, LEG, I_SPECIAL, has_mgivenname } from './const.js';
import { greatest_erosion } from './weapon.js';

import { Maybe_Half_Phys } from './zap.js';
import { losehp_do } from './do.js';
import { getdir, test_move_quiet } from './cmd.js';

// C ref: steed.c doride()/kick_steed() call the SHARED cmd.c getdir(); this
// file used to carry a cut-down copy that ignored the command queue, the
// number_pad keymap, '\r'/'\n' quitchars and the cmdassist "Invalid direction
// key!" window.  Use the real one.

// C ref: steed.c Monnam-style helper for "%s is not saddled." etc.  Not needed
// by the exercised paths but kept symmetric with mon_nam for completeness.
function Monnam_steed(mtmp) {
    const s = mon_nam(mtmp);
    return s.charAt(0).toUpperCase() + s.slice(1);
}


// C ref: steed.c mount_steed() — start riding the given monster.  Returns true
// (the mount succeeded) or false.  Only the RNG-bearing slip path and the
// success path are modelled in detail; every earlier guard is false for the
// recorded pony and consumes no RNG.
export async function mount_steed(mtmp, force) {
    const u = game.u;

    // Sanity: already riding.
    if (u.usteed) {
        await pline(`You are already riding ${mon_nam(u.usteed)}.`);
        return false;
    }

    // C ref: steed.c:214 — Is the player in the right form?
    if (u.uhallu && !force) {
        await pline('Maybe you should find a designated driver.');
        return false;
    }

    // C ref: steed.c:229-239 — a wounded hero cannot mount, and this guard
    // runs before checking whether a monster is at the requested location.
    if ((u.HWounded_legs || 0) || (u.EWounded_legs || 0)
        || (u.uprops?.Wounded_legs || 0)) {
        const { legs_in_no_shape } = await import('./do.js');
        await legs_in_no_shape('riding', false);
        // C ref: steed.c:233 reads (HWounded_legs & BOTH_SIDES) -- the intrinsic/timeout word's low bits, not EWounded_legs' side mask.
        const sides = ((u.HWounded_legs || 0) & BOTH_SIDES);
        if (force && is_wizard_steed()
            && await y_n(`Heal your leg${sides === BOTH_SIDES ? 's' : ''}?`) === 'y') {
            await heal_legs(0);
        } else {
            return false;
        }
    }

    // C ref: steed.c:242 — polymorphed into something that can't sit a saddle.
    if (u.Upolyd) {
        const { youmonst_data } = await import('./invent.js');
        const ym = youmonst_data();
        if (!humanoid_std(ym) || verysmall_std(ym) || bigmonst_std(ym) || slithy_std(ym)) {
            await pline("You won't fit on a saddle.");
            return false;
        }
    }
    // C ref: steed.c:248 — `near_capacity() > SLT_ENCUMBER`.
    if (!force && near_capacity() > 1 /* SLT_ENCUMBER */) {
        await pline("You can't do that while carrying so much stuff.");
        return false;
    }

    // "Can the player reach and see the monster?"
    const ap = mtmp?.m_ap_type;
    const mimicking = ap === 'furniture' || ap === 'obj' || ap === M_AP_FURNITURE || ap === M_AP_OBJECT;
    const blind_telepat = Blind_telepat();
    if (!mtmp || (!force && ((Blind() && !blind_telepat) || mtmp.mundetected || mimicking))) {
        await pline('I see nobody there.');
        return false;
    }
    if (mtmp.data?.name === 'long worm'
        && (u.ux + u.dx !== mtmp.mx || u.uy + u.dy !== mtmp.my)) {
        const { a_monnam } = await import('./do_name.js');
        await pline(`You couldn't ride ${a_monnam(mtmp)}, let alone its tail.`);
        return false;
    }
    if (u.uswallow || u.ustuck || u.utrap || game.uball
        || !steed_test_move(u.ux, u.uy, mtmp.mx - u.ux, mtmp.my - u.uy)) {
        const { body_part } = await import('./polyself.js');
        if (game.uball || !(u.uswallow || u.ustuck || u.utrap))
            await pline(`You are unable to swing your ${body_part(LEG)} over.`);
        else
            await pline('You are stuck here for now.');
        return false;
    }

    // Is the monster saddled?  The recorded pony always is.
    const saddle = which_armor(mtmp, W_SADDLE);
    const saddled = saddle || ((mtmp.misc_worn_check || 0) & W_SADDLE) !== 0;
    if (!saddled) {
        await pline(`${Monnam_steed(mtmp)} is not saddled.`);
        return false;
    }

    const ptr = mtmp.data;
    if (touch_petrifies_std(ptr) && !Stone_resistance_std()) {
        await pline(`You touch ${mon_nam(mtmp)}.`);
        const { an } = await import('./objnam.js');
        const { instapetrify } = await import('./polyself.js');
        await instapetrify(`attempting to ride ${an(ptr.name)}`);
    }
    if (!mtmp.mtame || mtmp.isminion) {
        await pline(`I think ${mon_nam(mtmp)} would mind.`);
        return false;
    }
    if (mtmp.mtrapped) {
        const t = t_at(mtmp.mx, mtmp.my);
        const { an } = await import('./objnam.js');
        await pline(`You can't mount ${mon_nam(mtmp)} while ${mhe_std(mtmp)}'s trapped in ${
            an(trapname(t?.ttyp, false))}.`);
        return false;
    }

    if (!force && !Role_if_knight_std() && !(--mtmp.mtame)) {
        /* no longer tame */
        newsym(mtmp.mx, mtmp.my);
        await pline(`${Monnam_steed(mtmp)} resists${mtmp.mleashed ? ' and its leash comes off' : ''}!`);
        if (mtmp.mleashed) {
            const { m_unleash } = await import('./apply.js');
            await m_unleash(mtmp, false);
        }
        return false;
    }
    if (!force && Underwater_std() && !is_swimmer_std(ptr)) {
        await pline(`You can't ride that creature while under ${hliquid('water')}.`);
        return false;
    }
    if (!can_saddle(mtmp) || !can_ride(mtmp)) {
        await pline("You can't ride such a creature.");
        return false;
    }

    // Is the player impaired?
    const lev = !!u.uprops?.Levitation;
    const lev_at_will = ((u.uprops?.HLevitation | 0) & I_SPECIAL) !== 0 && !(u.uprops?.ELevitation | 0);
    if (!force && !is_floater_std(ptr) && !is_flyer_std(ptr) && lev && !lev_at_will) {
        await pline(`You cannot reach ${mon_nam(mtmp)}.`);
        return false;
    }
    const uarm = game.uarm;
    if (!force && uarm && is_metallic_steed(uarm) && greatest_erosion(uarm)) {
        await pline(`Your ${uarm.oeroded ? 'rusty' : 'corroded'} armor is too stiff to be able to mount ${mon_nam(mtmp)}.`);
        return false;
    }

    // C ref: steed.c:338-356 — the impaired/slip check.  Confusion, Fumbling,
    // Glib, Wounded_legs, a cursed or greased saddle, or a failed
    // level/tameness roll all make the hero slip.  Short-circuit order matters:
    // rnd() is only drawn when every earlier term is false.
    if (!force
        && (Confusion_std() || Fumbling_std() || Glib_std()
            || (u.HWounded_legs || 0) || (u.EWounded_legs || 0)
            || (u.uprops?.Wounded_legs || 0)
            || saddle?.cursed || saddle?.greased
            || (u.ulevel + (mtmp.mtame || 0) < rnd(MAXULEV / 2 + 5)))) {
        if (lev) {
            await pline(`${Monnam_steed(mtmp)} slips away from you.`);
            return false;
        }
        await pline(`You slip while trying to get on ${mon_nam(mtmp)}.`);
        // C: x_monnam(mtmp, ARTICLE_A, NULL, SUPPRESS_IT | SUPPRESS_INVISIBLE
        // | SUPPRESS_HALLUCINATION, TRUE) -> "a saddled pony".
        const buf = `slipped while mounting ${x_monnam(mtmp, /*ARTICLE_A*/ 2, null,
            SUPPRESS_IT | SUPPRESS_INVISIBLE | SUPPRESS_HALLUCINATION, true)}`;
        // losehp(Maybe_Half_Phys(rn1(5, 10)), buf, NO_KILLER_PREFIX).

        await losehp_do(Maybe_Half_Phys(rn1(5, 10)), buf, NO_KILLER_PREFIX);
        return false;
    }

    // Success.
    await maybewakesteed(mtmp);
    if (!force) {
        if (lev && !is_floater_std(ptr) && !is_flyer_std(ptr))
            /* Must have Lev_at_will at this point */
            await pline(`${Monnam_steed(mtmp)} magically floats up!`);
        await pline(`You mount ${mon_nam(mtmp)}.`);
        if (Flying_fu())
            await pline(`You and ${mon_nam(mtmp)} take flight together.`);
    }
    // C ref: steed.c:369-370 — a polearm is a proper mounted weapon.
    if (game.uwep && is_pole(game.uwep)) game.unweapon = false;
    {
        /* C ref: steed.c:372-377 — riding blocks stealth unless hero+steed fly */
        const was_stealthy = !!Stealth();
        u.usteed = mtmp;
        steed_vs_stealth();
        if (was_stealthy && !Stealth())
            await pline("You aren't stealthy anymore.");
    }
    game.botl = true;

    // C ref: steed.c:379-381 — remove_monster(steed) then
    // teleds(steed->mx, steed->my, TELEDS_ALLOW_DRAG).  teleds -> u_on_newpos
    // moves the hero onto the steed's square and sets usteed->mx/my to match;
    // the steed is taken off the level map (it now rides with the hero and is
    // drawn at the hero's position by the renderer's mounted-hero handling).
    const nux = mtmp.mx, nuy = mtmp.my;

    // remove_monster(x,y) (rm.h) only NULLs the map grid pointer
    // (svl.level.monsters[x][y]); it does NOT unlink the steed from the `fmon`
    // chain.  So the steed stays a live level monster: it keeps receiving its
    // per-turn mcalcmove() ration (rn2(NORMAL_SPEED) rounding roll) and is
    // still driven by movemon()/dochug()/dog_move() each turn — those RNG rolls
    // MUST keep firing for parity (removing the steed from fmon, as we used to,
    // dropped a whole monster's mcalcmove + distfleeck + is_wanderer/dog_move
    // stream after mount and desynced every post-mount turn).  We therefore KEEP
    // it in game.level.monsters (our fmon) and instead flag it ridden; m_at()
    // and the renderer treat a ridden steed as "off the map grid" — it is
    // colocated with, and drawn as, the hero.
    mtmp.mridden = true;

    // C ref: steed.c:379-381 teleds(steed->mx, steed->my, TELEDS_ALLOW_DRAG): u_on_newpos
    // (moves the steed with the hero), newsym + see_monsters + vision, then
    // spoteffects(TRUE) -- the "You see here ..." look_here/pickup of whatever
    // lies on the steed's square.
    await teleds(nux, nuy, TELEDS_ALLOW_DRAG);
    return true;
}

// C ref: decl.c xdir/ydir — the 8 compass directions, j == 0..7 == W, NW, N,
// NE, E, SE, S, SW (the order landing_spot scans).
const XDIR = [-1, -1, 0, 1, 1, 1, 0, -1];
const YDIR = [0, -1, -1, -1, 0, 1, 1, 1];

// C ref: monmove.c accessible(x,y) = ACCESSIBLE(SURFACE_AT) && !closed_door.
function steed_accessible(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    if (!ACCESSIBLE(loc.typ)) return false;
    if (IS_DOOR(loc.typ) && (loc.doormask & (D_CLOSED | D_LOCKED))) return false;
    return true;
}

// C ref: hack.c test_move(ux,uy,dx,dy,TEST_MOVE), as used by mount_steed() (the
// target is the steed's square) and landing_spot() (the candidate square): the
// full silent TEST_MOVE query, so an obstructed/iron-barred/closed-door target,
// a diagonal into or out of an intact doorway and a tight diagonal squeeze all
// refuse ("You are unable to swing your leg over.").
function steed_test_move(ux, uy, dx, dy) {
    return test_move_quiet(ux + dx, uy + dy, dx, dy);
}

// MON_AT excluding the ridden steed itself (which is colocated with the hero
// and flagged mridden, i.e. off the map grid in C terms).
function steed_mon_at(x, y) {
    const mons = game.level?.monsters;
    if (!mons) return null;
    for (const m of mons) {
        if (m.mridden || DEADMONSTER(m)) continue;   /* dead monsters are off the grid */
        if (m.mx === x && m.my === y) return m;
    }
    return null;
}

// C ref: steed.c:459 landing_spot(spot, reason, forceit) — pick the square
// the dismounting hero lands on.  Full port: DISMOUNT_KNOCKED's preferred-
// direction bias (u.dx,u.dy, set by the caller just before dismount_steed(
// DISMOUNT_KNOCKED)), the three trap/boulder-avoidance passes keyed by
// reason+impairment, and (forceit) the enexto() fallback when no adjacent
// square qualifies.  Returns {x,y} or null.
function xytodir_std(dx, dy) {
    for (let k = 0; k < 8; k++) if (XDIR[k] === dx && YDIR[k] === dy) return k;
    return -1; // DIR_ERR
}
function landing_spot(reason, forceit) {
    const u = game.u;
    const tryArr = new Array(8);
    let n = 0;
    let best_j = -1, clockwise_j = -1, counterclk_j = -1;

    const j0 = xytodir_std(u.dx, u.dy);
    if (reason === DISMOUNT_KNOCKED && j0 !== -1) {
        // we'll check the preferred location first; if viable it'll be picked
        best_j = j0;
        tryArr[0] = { x: u.dx, y: u.dy };
        const i0 = rn2(2);
        clockwise_j = (j0 + 1) % 8;
        tryArr[1 + i0] = { x: XDIR[clockwise_j], y: YDIR[clockwise_j] };
        counterclk_j = (j0 + 8 - 1) % 8;
        tryArr[2 - i0] = { x: XDIR[counterclk_j], y: YDIR[counterclk_j] };
        n = 3;
    }
    for (let j = 0; j < 8; j++) {
        if (j === best_j || j === clockwise_j || j === counterclk_j) continue;
        // C ref: steed.c:501 `(j % 1) != 0` is unconditionally false for any
        // integer j — this arm never fires in upstream C either; ported
        // literally (bug-compatible) rather than "fixed".
        if (reason === DISMOUNT_POLY && (j % 1) !== 0) continue;
        tryArr[n++] = { x: XDIR[j], y: YDIR[j] };
    }

    // Up to three passes: i==0 (voluntary, unimpaired) avoids known traps and
    // boulders; i==1 (voluntary+impaired, or knocked) avoids boulders but
    // allows known traps; i==2 (other) allows both.  Falls back i==0->1->2.
    const impaird = !!(Stunned_std() || Confusion_std() || Fumbling_std());
    const iStart = (reason === DISMOUNT_BYCHOICE && !impaird) ? 0
        : ((reason === DISMOUNT_BYCHOICE && impaird) || reason === DISMOUNT_KNOCKED) ? 1
        : 2;
    let viable = 0, min_distance = -1, found = false;
    const spot = { x: 0, y: 0 };
    for (let i = iStart; i <= 2 && !found; i++) {
        for (let j = 0; j < n; j++) {
            const x = u.ux + tryArr[j].x, y = u.uy + tryArr[j].y;
            if (!isok(x, y) || (x === u.ux && y === u.uy)) continue;
            if (steed_accessible(x, y) && !steed_mon_at(x, y)
                && steed_test_move(u.ux, u.uy, x - u.ux, y - u.uy)) {
                ++viable;
                const distance = (x - u.ux) * (x - u.ux) + (y - u.uy) * (y - u.uy);
                if (min_distance < 0
                    || ((best_j === -1) ? (distance < min_distance) : (j < 3))
                    || (distance === min_distance && !rn2(viable))) {
                    const trap = t_at(x, y);
                    const kn_trap = i === 0 && !!trap && !!trap.tseen
                        && trap.ttyp !== VIBRATING_SQUARE;
                    const boulder = i <= 1 && !!sobj_at(BOULDER, x, y)
                        && !throws_rocks_std(game.youmonst?.data);
                    if (!kn_trap && !boulder) {
                        spot.x = x; spot.y = y;
                        min_distance = distance;
                        found = true;
                        if (best_j !== -1 && j < 3) break;
                    }
                }
            }
        }
    }

    if (forceit && !found) {
        const sp = enexto_gpflags(u.ux, u.uy, game.youmonst?.data, 0);
        if (sp) { spot.x = sp.x; spot.y = sp.y; found = true; }
    }
    return found ? spot : null;
}

// C ref: steed.c:576 dismount_steed(reason) — the general port: every
// DISMOUNT_* reason, its own message/fall-damage/wounded-legs handling,
// landing-spot selection (including the forceit enexto() retry), steed
// relocation (including a water/lava death check) or repositioning around an
// engulfer, the Sokoban boulder-squeeze guilt check, re-trapping the steed in
// the hero's former trap, and the tail float_down(0,W_SADDLE) bookkeeping.
export async function dismount_steed(reason) {
    const u = game.u;
    const save_utrap = u.utrap;
    let repair_leg_damage = !!((u.HWounded_legs || 0) || (u.EWounded_legs || 0));
    // C evaluates `have_spot = landing_spot(&cc, reason, 0)` in the declarations,
    // BEFORE the `if (!mtmp) return` sanity check: a second dismount after the
    // steed already left (steedintrap's trapkilled dismount_steed(DISMOUNT_POLY)
    // after monkilled()->m_detach()'s generic one) still draws landing_spot's rn2().
    let cc = landing_spot(reason, 0);
    let have_spot = !!cc;

    const mtmp = u.usteed;
    if (!mtmp) return; // C: sanity check; caller lost the steed already

    // ufly/ulev/verb: C brackets u_locomotion() with u.usteed transiently
    // cleared (it affects the Fly test) then restored.
    u.usteed = null;
    // youprop.h Flying/Levitation: intrinsic | extrinsic (worn boots/ring) && !blocked, not just the intrinsic word.
    const ufly = Flying_fu();
    const ulev = Levitation_fu();
    let verb = u_locomotion_std('fall');
    u.usteed = mtmp;

    /* Check the reason for dismounting */
    const otmp = which_armor(mtmp, W_SADDLE);
    switch (reason) {
    case DISMOUNT_THROWN:
        verb = 'are thrown';
        // FALLTHROUGH
    case DISMOUNT_KNOCKED:
    case DISMOUNT_FELL:
        await pline(`You ${verb} off of ${mon_nam(mtmp)}!`);
        if (!have_spot) { cc = landing_spot(reason, 1); have_spot = !!cc; }
        if (!ulev && !ufly) {
            await losehp_do(Maybe_Half_Phys(rn1(10, 10)), 'riding accident', KILLED_BY_AN);
            if (game.program_state?.gameover) return; /* C: losehp()->done() never returns */
            await set_wounded_legs(BOTH_SIDES, (u.HWounded_legs || 0) + rn1(5, 5));
            repair_leg_damage = false;
        }
        break;
    case DISMOUNT_POLY:
        await pline(`You can no longer ride ${mon_nam(u.usteed)}.`);
        if (!have_spot) { cc = landing_spot(reason, 1); have_spot = !!cc; }
        break;
    case DISMOUNT_ENGULFED:
        /* caller displays message */
        break;
    case DISMOUNT_BONES:
        /* hero has just died... */
        break;
    case DISMOUNT_GENERIC:
        /* no messages, just make it so */
        break;
    case DISMOUNT_BYCHOICE:
    default:
        if (otmp && otmp.cursed) {
            await pline(`You can't.  The saddle ${otmp.bknown ? 'is' : 'seems to be'} cursed.`);
            otmp.bknown = 1;
            return;
        }
        if (!have_spot) {
            await pline("You can't.  There isn't anywhere for you to stand.");
            return;
        }
        if (!has_mgivenname(mtmp)) {
            const { an } = await import('./objnam.js');
            await pline(`You've been through the dungeon on ${an(mon_pmname(mtmp))} with no name.`);
            if (Hallucination_u())
                await pline('It felt good to get out of the rain.');
        } else
            await pline(`You dismount ${mon_nam(mtmp)}.`);
    }

    // While riding, Wounded_legs refers to the steed's legs; heal_legs() must
    // run BEFORE u.usteed is released below (heal_legs() itself gates its
    // "Your leg(s) feel(s) better." message on !u.usteed).
    if (repair_leg_damage) await heal_legs(1);

    /* Release the steed */
    {
        /* C ref: steed.c:659-665 — dismounting lifts the riding stealth block */
        const was_stealthy = !!Stealth();
        u.usteed = null;
        u.ugallop = 0;
        steed_vs_stealth();
        if (Stealth() && !was_stealthy)
            await pline('You seem less noisy now.');
    }

    if (u.utraptype === TT_BEARTRAP || u.utraptype === TT_PIT || u.utraptype === TT_WEB)
        mtmp.mtrapped = 1;

    let steedcc = { x: u.ux, y: u.uy };
    if (m_at(u.ux, u.uy)) {
        const sp = enexto_gpflags(u.ux, u.uy, mtmp.data, 0)
            || enexto_gpflags(u.ux, u.uy, monster_by_pmidx(name_to_pmidx('bat')), 0)
            || enexto_gpflags(u.ux, u.uy, monster_by_pmidx(name_to_pmidx('ghost')), 0);
        if (sp) steedcc = sp;
    }

    if (!DEADMONSTER(mtmp)) {
        steed_place_monster(mtmp, steedcc.x, steedcc.y);

        if (reason === DISMOUNT_BONES) {
            const sp = enexto_gpflags(u.ux, u.uy, mtmp.data, 0);
            if (sp) await rloc_to(mtmp, sp.x, sp.y);
            else await rloc(mtmp, RLOC_ERR | RLOC_NOMSG);
            return;
        }

        if (!u.uswallow && !u.ustuck && have_spot) {
            const mdat = mtmp.data;
            if (steed_grounded(mdat)) {
                if (is_pool(u.ux, u.uy)) {
                    if (!Underwater_std())
                        await pline(`${Monnam_uhitm(mtmp)} falls into the ${surface(u.ux, u.uy)}!`);
                    if (!cant_drown_std(mdat)) { await killed(mtmp); adjalign(-1); }
                } else if (is_lava(u.ux, u.uy)) {
                    await pline(`${Monnam_uhitm(mtmp)} is pulled into the ${hliquid('lava')}!`);
                    if (!likes_lava_std(mdat)) { await killed(mtmp); adjalign(-1); }
                }
            }
            if (!DEADMONSTER(mtmp)) {
                game.in_steed_dismounting = true;
                await teleds(cc.x, cc.y, TELEDS_ALLOW_DRAG);
                if (sobj_at(BOULDER, cc.x, cc.y)) sokoban_guilt();
                game.in_steed_dismounting = false;
                if (save_utrap) await mon_mintrap(mtmp, NO_TRAP_FLAGS);
            }
        } else {
            const sp = enexto_gpflags(u.ux, u.uy, mtmp.data, 0);
            if (sp) await rloc_to(mtmp, sp.x, sp.y);
            else await steed_monkilled(mtmp);
        }
    }

    if (reason !== DISMOUNT_ENGULFED && reason !== DISMOUNT_BONES) {
        game.in_steed_dismounting = true;
        await float_down(0, W_SADDLE);
        game.in_steed_dismounting = false;
        game.botl = true;
        const { encumber_msg } = await import('./invent.js');
        await encumber_msg();
        game.vision_full_recalc = 1;
    } else {
        game.botl = true;
    }

    if (game.uwep && is_pole(game.uwep)) game.unweapon = true;
}

// ── dismount_steed() helper adapters ─────────────────────────────────────
// C ref: hack.c u_locomotion(def) — the current hero's own way of moving.
function u_locomotion_std(def) {
    const u = game.u;
    if (u?.uprops?.Levitation) return 'float';
    if (u?.uprops?.Flying) return 'fly';
    return def;
}
// C ref: youprop.h Stunned.
function Stunned_std() {
    if (game.u?.formprops?.Stunned) return true; /* FROMFORM: polyself.js set_uasmon() */
    const u = game.u;
    return (u?.uprops?.Stun || u?.ustun || 0) > 0;
}
// C ref: mondata.h grounded(ptr) — none of the steeds() classes (quadruped/
// unicorn/angel/centaur/dragon/jabberwock) carry M1_CLING, so the is_clinger
// term (and has_ceiling(), which only gates it) is always true and need not
// be modelled here.
function steed_grounded(ptr) { return !is_flyer_std(ptr) && !is_floater_std(ptr); }
// C ref: mondata.h cant_drown(ptr) = is_swimmer || amphibious || breathless.
function cant_drown_std(ptr) {
    return is_swimmer_std(ptr) || !!(mflags1_of(ptr) & (M1_AMPHIBIOUS | M1_BREATHLESS));
}
// C ref: mondata.h likes_lava(ptr) — fire elementals and salamanders only; no
// steeds() class ever matches, kept for parity with the C branch.
function likes_lava_std(ptr) {
    const pmidx = ptr?.pmidx;
    return pmidx === name_to_pmidx('fire elemental') || pmidx === name_to_pmidx('salamander');
}
// C ref: mondata.h nonliving(ptr) — undead / manes / golem / vortex.  No
// steeds() class ever matches; kept for monkilled()'s message parity.
function nonliving_steed(ptr) {
    return !!(mflags2_of(ptr) & M2_UNDEAD) || ptr?.name === 'manes'
        || ptr?.mcls === 55 /* S_GOLEM */ || ptr?.mcls === 22 /* S_VORTEX */;
}
// C ref: muse.c throws_rocks(ptr) — a rock-throwing giant/troll can stand on
// a boulder square without triggering landing_spot's boulder-avoidance.
function throws_rocks_std(ptr) { return !!ptr?.throws_rocks; }
// C ref: mon.c place_monster(mon,x,y) — dog.js/vault.js keep private copies;
// this is steed.c's own call site, so it gets one here too.  Also clears the
// port-local `mridden` flag: this port renders/looks up a ridden steed as
// colocated with, and hidden behind, the hero (see mount_steed()'s own
// comment on mridden); putting it back on the map grid must undo that or
// the square keeps rendering as bare terrain instead of the steed's glyph.
function steed_place_monster(mon, x, y) {
    mon.mridden = false;
    mon.mx = x; mon.my = y;
    mon.mstate = 0; /* MON_FLOOR (steed.c:931) */
    const list = game.level?.monsters;
    if (list && !list.includes(mon)) list.push(mon);
}
// C ref: mon.c mondead(mtmp) — for a steed species none of the lifesaving/
// vampshifter/vault-guard special cases apply, so this reduces to the
// death-bookkeeping tail: bump the species' death counter, clear an
// invisible glyph, then m_detach() (drops minvent — including the saddle —
// removes any light source, purges mtmp from the level).
async function steed_mondead(mtmp) {
    mtmp.mhp = 0;
    await mvitals_died(mtmp);
    if (game.level?.at(mtmp.mx, mtmp.my)?.invisMon) unmap_object(mtmp.mx, mtmp.my);
    await m_detach(mtmp, mtmp.data, true);
}
// C ref: mon.c mondied(mdef) — mondead() then, unless life-saved (not
// modelled anywhere in this codebase), maybe drop a corpse.
async function steed_mondied(mtmp) {
    const x = mtmp.mx, y = mtmp.my;
    await steed_mondead(mtmp);
    if (await corpse_chance(mtmp) && (steed_accessible(x, y) || is_pool(x, y)))
        await make_corpse(mtmp, x, y);
}
// C ref: mon.c monkilled(mdef, "", -AD_PHYS) — steed died from an impersonal
// cause (no adjacent square to flee to).  fltxt="" so the message never gets
// a "by the ..." suffix; how=-AD_PHYS is neither AD_DGST/-AD_RBRE/AD_FIRE, so
// corpse dropping applies normally with no exp/luck/treasure change (unlike
// killed(), which is what DISMOUNT_BYCHOICE / the water-lava death arm use).
async function steed_monkilled(mtmp) {
    if (canseemon_shared(mtmp))
        await pline(`${Monnam_uhitm(mtmp)} is ${nonliving_steed(mtmp.data) ? 'destroyed' : 'killed'}!`);
    await steed_mondied(mtmp);
}

// C ref: steed.c doride() — the #ride command.  With no current steed, read a
// direction and try to mount the monster there.  Returns ECMD_TIME (1) when a
// mount succeeds (a turn passes), else ECMD_OK/ECMD_CANCEL (0, no turn).
export async function doride() {
    const u = game.u;

    if (u.usteed) {
        await dismount_steed(DISMOUNT_BYCHOICE);
        return 1;
    }

    const dir = await getdir();
    if (dir && isok(u.ux + dir.dx, u.uy + dir.dy)) {
        u.dx = dir.dx;
        u.dy = dir.dy;
        // C ref: steed.c doride():185 — `if (wizard && y_n("Force the mount to
        // succeed?") == 'y') forcemount = TRUE;`.  The prompt fires for EVERY
        // wizard-mode #ride, so skipping it swallowed a keystroke and shifted
        // the rest of the session.
        let forcemount = false;
        if (is_wizard_steed()
            && await y_n('Force the mount to succeed?', 'yn\x1b', 'n') === 'y')
            forcemount = true;
        const ok = await mount_steed(m_at(u.ux + dir.dx, u.uy + dir.dy), forcemount);
        return ok ? 1 : 0;
    }
    return 0; // ECMD_CANCEL
}

// C ref: decl.h `wizard` — debug (wizard) mode, which is what gates #ride's
// force-mount query.
function is_wizard_steed() { return !!game.flags?.debug; }

// ===========================================================================
// steed.c: the remaining top-level functions, translated.  APPEND-ONLY —
// nothing above this line calls anything below it.
//
// can_saddle() and put_saddle_on_mon() are steed.c functions whose only live
// copies are PRIVATE in other files (js/makemon.js:2150 and js/cmd.js:4353 for
// can_saddle, js/dog.js:288 for put_saddle_on_mon).  use_saddle()/poly_steed()
// need them, so they are translated here — in their C home — and the three
// private copies should import these instead of drifting further.
// ===========================================================================

import { canspotmon, Monnam as Monnam_uhitm } from './uhitm.js';
import { roles } from './role.js';
import { which_armor } from './worn.js';
import { y_monnam, YMonnam, monverbself } from './do_name.js';
import { exercise, acurr_eff, adjalign } from './attrib.js';
import { p_skill_of, use_skill } from './enhance.js';
import { objects, BOULDER } from './mkobj.js';
import { Blind_telepat } from './youprop.js';
import { mflags1_of, M1_HUMANOID, M1_AMORPHOUS, M1_UNSOLID, M1_SLITHY,
         M1_FLY, M1_AMPHIBIOUS, M1_BREATHLESS, mflags2_of,
         M2_UNDEAD } from './monflags_data.js';
import { A_DEX, A_CHA, A_WIS, ECMD_OK, ECMD_TIME, ECMD_CANCEL,
         P_RIDING, P_ISRESTRICTED, P_UNSKILLED, P_BASIC, P_SKILLED, P_EXPERT,
         DISMOUNT_BYCHOICE, DISMOUNT_THROWN, DISMOUNT_FELL, DISMOUNT_KNOCKED,
         DISMOUNT_POLY, DISMOUNT_ENGULFED, DISMOUNT_BONES, DISMOUNT_GENERIC,
         BOTH_SIDES, TT_BEARTRAP, TT_PIT, TT_WEB, NO_TRAP_FLAGS, RLOC_ERR,
         RLOC_NOMSG, TELEDS_ALLOW_DRAG, VIBRATING_SQUARE } from './const.js';

// C ref: steed.c:8 steeds[] — the monster CLASSES that can be ridden, as
// defsym.h MONSYM indices: S_QUADRUPED 17, S_UNICORN 21, S_ANGEL 27,
// S_CENTAUR 29, S_DRAGON 30, S_JABBERWOCK 36.
const STEED_CLASSES = new Set([17, 21, 27, 29, 30, 36]);
const S_CENTAUR = 29, S_GHOST = 54, S_VORTEX = 22;
// C ref: monflag.h MZ_MEDIUM / MZ_LARGE.
const MZ_MEDIUM = 2, MZ_LARGE = 3;
// C ref: hack.h:1013/1019 ARTICLE_YOUR / SUPPRESS_SADDLE.
const ARTICLE_YOUR = 3, SUPPRESS_SADDLE = 0x08;

// C ref: steed.c:17 rider_cant_reach() — the mounted hero is too unskilled to
// reach whatever the caller wanted.
export async function rider_cant_reach() {
    await pline(`You aren't skilled enough to reach from ${
        y_monnam(game.u.usteed)}.`);
}

// C ref: the `u.usteed && P_SKILL(P_RIDING) < P_BASIC` test that precedes rider_cant_reach() at hack.c pickup_checks, pickup.c able_to_loot, potion.c dodip, trap.c untrap.
export function steed_unskilled() {
    return !!game.u.usteed && p_skill_of(P_RIDING) < P_BASIC;
}

// C ref: mondata.h is_whirly / amorphous / noncorporeal / unsolid / humanoid,
// keyed off the same masks js/monflags_data.js exports.
function is_whirly_std(ptr) {
    return ptr?.mcls === S_VORTEX || ptr?.name === 'air elemental';
}
function humanoid_std(ptr) { return (mflags1_of(ptr) & M1_HUMANOID) !== 0; }
function amorphous_std(ptr) { return (mflags1_of(ptr) & M1_AMORPHOUS) !== 0; }
function unsolid_std(ptr) { return (mflags1_of(ptr) & M1_UNSOLID) !== 0; }
function noncorporeal_std(ptr) { return ptr?.mcls === S_GHOST; }
function slithy_std(ptr) { return (mflags1_of(ptr) & M1_SLITHY) !== 0; }
function verysmall_std(ptr) { return (ptr?.msize ?? MZ_MEDIUM) < 1 /*MZ_SMALL*/; }
function bigmonst_std(ptr) { return (ptr?.msize ?? MZ_MEDIUM) >= MZ_LARGE; }
function is_swimmer_std(ptr) { return (mflags1_of(ptr) & 0x2 /*M1_SWIM*/) !== 0; }
function is_flyer_std(ptr) { return (mflags1_of(ptr) & M1_FLY) !== 0; }
// C ref: mondata.h is_floater(ptr) — mlet == S_EYE || mlet == S_LIGHT.
function is_floater_std(ptr) { return ptr?.mcls === 11 || ptr?.mcls === 12; }

// C ref: steed.c:26 can_saddle(mtmp) — a saddleable class, at least
// medium-sized, non-humanoid (centaurs excepted) and made of solid flesh.
export function can_saddle(mtmp) {
    const ptr = mtmp?.data;
    if (!ptr) return false;
    return STEED_CLASSES.has(ptr.mcls) && (ptr.msize ?? MZ_MEDIUM) >= MZ_MEDIUM
        && (!humanoid_std(ptr) || ptr.mcls === S_CENTAUR) && !amorphous_std(ptr)
        && !noncorporeal_std(ptr) && !is_whirly_std(ptr) && !unsolid_std(ptr);
}

// C ref: steed.c:142 put_saddle_on_mon(saddle, mtmp) — the saddle enters the
// monster's inventory with the W_SADDLE worn mask set.  Passing a null saddle
// makes one (makedog()'s starting pony path, which js/dog.js:288 already runs
// for its single rnd(2) o_id draw).
export async function put_saddle_on_mon(saddle, mtmp) {
    if (!can_saddle(mtmp) || which_armor(mtmp, W_SADDLE)) {
        /* impossible("put_saddle_on_mon: saddle obj could get orphaned") */
        return;
    }
    if (!saddle) {
        const { mksobj } = await import('./mkobj.js');
        saddle = mksobj(SADDLE_OTYP(), true, false);
        if (!saddle) return;
        /* fully_identify_obj(saddle) */
        saddle.known = saddle.bknown = saddle.rknown = 1;
        saddle.dknown = 1;
    }
    {   /* mpickobj(mtmp, saddle) — panic("merged saddle?") if it merged */
        const { mpickobj } = await import('./steal.js');
        mpickobj(mtmp, saddle);
    }
    mtmp.misc_worn_check = (mtmp.misc_worn_check | 0) | W_SADDLE;
    saddle.owornmask = W_SADDLE;
    saddle.leashmon = mtmp.m_id;
    /* C: update_mon_extrinsics(mtmp, saddle, TRUE, FALSE) — no port. */
}
// C ref: onames.h SADDLE, resolved by name so an objects[] shift can't
// re-point it.
let _saddle_otyp = -1;
function SADDLE_OTYP() {
    if (_saddle_otyp < 0) {
        _saddle_otyp = 0;
        for (let i = 0; i < objects.length; i++)
            if (objects[i]?.name === 'saddle') { _saddle_otyp = i; break; }
    }
    return _saddle_otyp;
}

// C ref: steed.c:36 use_saddle(otmp) — the #apply-a-saddle command.
export async function use_saddle(otmp) {
    const u = game.u;

    if (!u_handsy_std())
        return ECMD_OK;

    /* Select an animal */
    const dir = (u.uswallow || Underwater_std()) ? null : await getdir();
    if (!dir) {
        await pline('Never mind.');
        return ECMD_CANCEL;
    }
    u.dx = dir.dx; u.dy = dir.dy;
    if (!u.dx && !u.dy) {
        await pline('Saddle yourself?  Very funny...');
        return ECMD_OK;
    }
    let mtmp;
    if (!isok(u.ux + u.dx, u.uy + u.dy)
        || !(mtmp = m_at(u.ux + u.dx, u.uy + u.dy)) || !canspotmon(mtmp)) {
        await pline('I see nobody there.');
        return ECMD_TIME;
    }

    /* Is this a valid monster? */
    if (((mtmp.misc_worn_check | 0) & W_SADDLE) !== 0
        || which_armor(mtmp, W_SADDLE)) {
        await pline(`${Monnam_uhitm(mtmp)} doesn't need another one.`);
        return ECMD_TIME;
    }
    const ptr = mtmp.data;
    if (touch_petrifies_std(ptr) && !game.uarmg && !Stone_resistance_std()) {
        await pline(`You touch ${mon_nam(mtmp)}.`);
        const { poly_when_stoned } = await import('./mondata.js');
        const { polymon, instapetrify } = await import('./polyself.js');
        if (!(poly_when_stoned(youmonst_data())
              && await polymon(name_to_pmidx('stone golem')))) {
            const { an } = await import('./objnam.js');
            await instapetrify(`attempting to saddle ${an(mon_pmname(mtmp))}`);
        }
    }
    if (ptr?.name === 'amorous demon') {
        await pline('Shame on you!');
        exercise(A_WIS, false);
        return ECMD_TIME;
    }
    if (mtmp.isminion || mtmp.isshk || mtmp.ispriest || mtmp.isgd
        || mtmp.iswiz) {
        await pline(`I think ${mon_nam(mtmp)} would mind.`);
        return ECMD_TIME;
    }
    if (!can_saddle(mtmp)) {
        await pline("You can't saddle such a creature.");
        return ECMD_TIME;
    }

    /* Calculate your chance */
    let chance = acurr_eff(A_DEX) + Math.trunc(acurr_eff(A_CHA) / 2)
                 + 2 * (mtmp.mtame | 0);
    chance += (u.ulevel | 0) * (mtmp.mtame ? 20 : 5);
    if (!mtmp.mtame)
        chance -= 10 * (mtmp.m_lev | 0);
    if (Role_if_knight_std())
        chance += 20;
    switch (p_skill_of(P_RIDING)) {
    case P_SKILLED:
        chance += 15;
        break;
    case P_EXPERT:
        chance += 30;
        break;
    case P_BASIC:
        break;
    case P_ISRESTRICTED:
    case P_UNSKILLED:
    default:
        chance -= 20;
        break;
    }
    if (Confusion_std() || Fumbling_std() || Glib_std())
        chance -= 20;
    else if (game.uarmg && objdescr_is_std(game.uarmg, 'riding gloves'))
        /* Bonus for wearing "riding" (but not fumbling) gloves */
        chance += 10;
    else if (game.uarmf && objdescr_is_std(game.uarmf, 'riding boots'))
        /* ... or for "riding boots" */
        chance += 10;
    if (otmp.cursed)
        chance -= 50;

    /* [intended] steed becomes alert if possible */
    await maybewakesteed(mtmp);

    /* Make the attempt */
    if (rn2(100) < chance) {
        await pline(`You put the saddle on ${mon_nam(mtmp)}.`);
        if (otmp.owornmask) {
            const { remove_worn_item } = await import('./invent.js');
            await remove_worn_item(otmp, false);
        }
        {
            const { freeinv } = await import('./invent.js');
            freeinv(otmp);
        }
        /* !can_saddle(mtmp) already eliminated above */
        await put_saddle_on_mon(otmp, mtmp);
    } else {
        await pline(`${Monnam_uhitm(mtmp)} resists!`);
    }
    return ECMD_TIME;
}

// C ref: steed.c:169 can_ride(mtmp) — the hero's own form has to fit.
export function can_ride(mtmp) {
    // youmonst_data() is the hero's CURRENT permonst (role player-monster
    // when unpolymorphed, which is humanoid and medium-sized).
    const you = { data: youmonst_data() };
    return !!mtmp?.mtame && humanoid_std(you.data)
        && !verysmall_std(you.data) && !bigmonst_std(you.data)
        && (!Underwater_std() || is_swimmer_std(mtmp.data));
}

// C ref: steed.c:878 stucksteed(checkfeeding) — a helpless steed (or, with
// checkfeeding, one still eating) refuses to move.  TRUE: the caller aborts.
export async function stucksteed(checkfeeding) {
    const steed = game.u?.usteed;
    if (steed) {
        if (steed.msleeping || !steed.mcanmove) {
            await pline(`${YMonnam(steed)} won't move!`);
            return true;
        }
        if (checkfeeding && steed.meating) {
            await pline(`${YMonnam(steed)} is still eating.`);
            return true;
        }
    }
    return false;
}

// C ref: steed.c:387 exercise_steed() — 100 turns of riding advances P_RIDING.
export async function exercise_steed() {
    const u = game.u;
    if (!u.usteed)
        return;

    /* It takes many turns of riding to exercise skill */
    u.urideturns = (u.urideturns | 0) + 1;
    if (u.urideturns >= 100) {
        u.urideturns = 0;
        await use_skill(P_RIDING, 1);
    }
}

// C ref: steed.c:402 kick_steed() — the hero kicks or whips the steed.  RNG:
// rn2(2) for a helpless steed's chance of rousing, else rnd(MAXULEV/2 + 5) for
// the "does it throw you" check and rn1(20, 30) for the gallop duration.
export async function kick_steed() {
    const u = game.u;
    if (!u.usteed)
        return;

    /* [ALI] Various effects of kicking sleeping/paralyzed steeds */
    if (helpless_std(u.usteed)) {
        /* We assume a message has just been output of the form
         * "You kick <steed>."
         */
        let He = mhe_std(u.usteed);
        He = He.charAt(0).toUpperCase() + He.slice(1);
        if ((u.usteed.mcanmove || u.usteed.mfrozen) && !rn2(2)) {
            if (u.usteed.mcanmove)
                u.usteed.msleeping = 0;
            else if ((u.usteed.mfrozen | 0) > 2)
                u.usteed.mfrozen -= 2;
            else {
                u.usteed.mfrozen = 0;
                u.usteed.mcanmove = 1;
            }
            if (helpless_std(u.usteed))
                await pline(`${He} stirs.`);
            else
                /* if hallucinating, might yield "He rouses herself" or
                   "She rouses himself" */
                await pline(`${monverbself(u.usteed, He, 'rouse', null)}!`);
        } else {
            await pline(`${He} does not respond.`);
        }
        return;
    }

    /* Make the steed less tame and check if it resists */
    if (u.usteed.mtame)
        u.usteed.mtame--;
    if (!u.usteed.mtame && u.usteed.mleashed) {
        const { m_unleash } = await import('./apply.js');
        await m_unleash(u.usteed, true);
    }
    if (!u.usteed.mtame
        || ((u.ulevel | 0) + (u.usteed.mtame | 0)
            < rnd(Math.trunc(MAXULEV / 2) + 5))) {
        newsym(u.usteed.mx, u.usteed.my);
        await dismount_steed(DISMOUNT_THROWN);
        return;
    }

    await pline(`${Monnam_uhitm(u.usteed)} gallops!`);
    u.ugallop = (u.ugallop | 0) + rn1(20, 30);
}

// C ref: steed.c:827 maybewakesteed(steed) — saddling or mounting a sleeping
// steed tries to wake it: timed sleep/paralysis is HALVED and there is a
// 1-in-that chance of ending outright.
export async function maybewakesteed(steed) {
    let frozen = steed.mfrozen | 0;
    const wasimmobile = helpless_std(steed);

    steed.msleeping = 0;
    if (frozen) {
        frozen = Math.trunc((frozen + 1) / 2); /* half */
        /* might break out of timed sleep or paralysis */
        if (!rn2(frozen)) {
            steed.mfrozen = 0;
            steed.mcanmove = 1;
        } else {
            /* didn't awake, but remaining duration is halved */
            steed.mfrozen = frozen;
        }
    }
    if (wasimmobile && !helpless_std(steed))
        await pline(`${Monnam_uhitm(steed)} wakes up.`);
    /* regardless of waking, terminate any meal in progress */
    finish_meating_std(steed);
}

// C ref: steed.c:852 poly_steed(steed, oldshape) — the steed changed form.
export async function poly_steed(steed, oldshape) {
    if (!can_saddle(steed) || !can_ride(steed)) {
        /* can't get here; newcham() -> mon_break_armor() -> m_lose_armor()
           removes the saddle and/or forces a dismount first */
        await dismount_steed(DISMOUNT_FELL);
    } else {
        let buf = x_monnam(steed, ARTICLE_YOUR, null, SUPPRESS_SADDLE, false);
        if (oldshape !== steed.data)
            buf = strsubst_std(buf, 'your ', 'your new ');
        await pline(`You adjust yourself in the saddle on ${buf}.`);

        /* riding blocks stealth unless hero+steed fly */
        steed_vs_stealth();
    }
}

// ── local adapters for C callees with no exported JS counterpart ────────────
// C ref: do_wear.c u_handsy() — a hero with no hands can't apply a saddle.
function u_handsy_std() { return true; }
// C ref: you.h Underwater / Stone_resistance / Confusion / Fumbling / Glib.
function Underwater_std() { return !!game.u?.uinwater; }
function Stone_resistance_std() { return !!game.u?.formprops?.Stone_resistance || !!game.u?.uprops?.Stone_resistance; }
function Confusion_std() { return !!(game.u?.uconf || game.u?.HConfusion); }
function Fumbling_std() { return Fumbling_hero(); }
function Glib_std() { return !!game.u?.uprops?.Glib; }
// C ref: mondata.h touch_petrifies(ptr) — cockatrice and chickatrice only.
function touch_petrifies_std(ptr) {
    return ptr?.name === 'cockatrice' || ptr?.name === 'chickatrice';
}
// C ref: role.h Role_if(PM_KNIGHT).
function Role_if_knight_std() {
    const r = roles?.[game.initrole];
    return (r?.name?.m || '').toLowerCase() === 'knight';
}
// C ref: objnam.c objdescr_is(obj, descr) — compares the SHUFFLED appearance
// string, not the true name (js/eat.js:3206 keeps a private copy).
function objdescr_is_std(obj, descr) {
    const o = objects[obj?.otyp];
    return (o?.descr || o?.oc_descr || '') === descr;
}
// C ref: mon.h helpless(mon) — asleep, frozen or otherwise unable to act.
function helpless_std(mon) {
    return !mon?.mcanmove || !!mon.msleeping || (mon.mfrozen | 0) > 0;
}
// C ref: do_name.c mhe(mon) — "he"/"she"/"it".
function mhe_std(mon) {
    if (mon?.female) return 'she';
    return mon?.data?.gender === 'neuter' ? 'it' : 'he';
}
// C ref: eat.c finish_meating(mon) — js/dogmove.js:2300 holds the private port.
function finish_meating_std(mon) { mon.meating = 0; }
// (dismount_steed_std removed — kick_steed()/poly_steed() above now call the
// real, exported dismount_steed(reason) directly.)
// C ref: hacklib.c strsubst(bp, orig, replacement) — first occurrence only.
function strsubst_std(bp, orig, replacement) {
    const i = bp.indexOf(orig);
    return i < 0 ? bp : bp.slice(0, i) + replacement + bp.slice(i + orig.length);
}
// C ref: objclass.h is_metallic(otmp) — material IRON..MITHRIL.
function is_metallic_steed(obj) {
    const m = objects[obj?.otyp]?.material;
    return m >= 11 /* IRON */ && m <= 17 /* MITHRIL */;
}
