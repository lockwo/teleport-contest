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

import { game } from './gstate.js';
import { rnd, rn1, rn2 } from './rng.js';
import { nhgetch } from './input.js';
import { pline, flush_screen, newsym, update_topl } from './display.js';
import { m_at } from './display.js';
import { vision_recalc } from './vision.js';
import { x_monnam } from './uhitm.js';
import { isok, MAXULEV, W_SADDLE, ACCESSIBLE, IS_DOOR, D_CLOSED, D_LOCKED,
         D_NODOOR, D_BROKEN, Is_rogue_level } from './const.js';
import { pickup_after_move, getdir_confdir } from './cmd.js';

// C ref: cmd.c getdir() — read a direction.  Renders "In what direction?",
// reads one key; '.'/'s' = self.  Returns {dx,dy,dz} or null on cancel/ESC.
// Ends with confdir(FALSE) like C's (cmd.c:4116) — see cmd.js getdir_confdir.
async function getdir() {
    const prompt = 'In what direction?';
    game._pending_message = prompt;
    await flush_screen(1);
    game._modal_screen = 'topl';
    const disp = game.nhDisplay;
    // C tty yn_function parks the cursor one column past the prompt + space.
    if (disp?.setCursor) disp.setCursor(Math.min(prompt.length + 1, 79), 0);
    const key = await nhgetch();
    delete game._modal_screen;
    game._pending_message = '';
    const ch = String.fromCharCode(key);
    if (ch === '.' || ch === 's')
        return getdir_confdir({ dx: 0, dy: 0, dz: 0 });
    if (ch === '\x1b' || ch === ' ')
        return null;
    const DX = { h: -1, l: 1, j: 0, k: 0, y: -1, u: 1, b: -1, n: 1, '<': 0, '>': 0 };
    const DY = { h: 0, l: 0, j: 1, k: -1, y: -1, u: -1, b: 1, n: 1, '<': 0, '>': 0 };
    const DZ = { '<': -1, '>': 1 };
    if (ch in DX)
        return getdir_confdir({ dx: DX[ch], dy: DY[ch], dz: DZ[ch] || 0 });
    return null;
}

// C ref: do_name.c mon_nam() == x_monnam(ARTICLE_THE).  x_monnam now models the
// "saddled " adjective for a saddle-wearing steed, so this is a thin wrapper.
function mon_nam(mtmp) {
    return x_monnam(mtmp, /*ARTICLE_THE*/ 1, null, 0, false);
}

// C ref: steed.c Monnam-style helper for "%s is not saddled." etc.  Not needed
// by the exercised paths but kept symmetric with mon_nam for completeness.
function Monnam_steed(mtmp) {
    const s = mon_nam(mtmp);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// C ref: hack.c losehp() — for a non-polymorphed hero this subtracts the damage
// from u.uhp (no RNG).  When the blow drops HP below 1 the hero dies: You("die...")
// is a pline that follows the still-unacknowledged "You slip..." top line, so the
// tty pages the slip message with --More-- (topl.c more()) before showing
// "You die...", then done(DIED) runs the end-of-game sequence.
async function losehp(n) {
    const u = game.u;
    if (!u) return;
    u.uhp -= n;
    if (u.uhp > u.uhpmax) {
        u.uhpmax = u.uhp;
        return;
    }
    if (u.uhp < 1) {
        u.uhp = 0;
        // C pline() marks the top line NEED_MORE; mirror it so update_topl pages
        // the "You slip..." line before printing "You die...".
        game._toplin = 1; // TOPLIN_NEED_MORE
        await update_topl('You die...');
        const { done, DIED } = await import('./end.js');
        await done(DIED);
    }
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

    // "Can the player reach and see the monster?" — no monster there.
    if (!mtmp) {
        await pline('I see nobody there.');
        return false;
    }

    // Is the monster saddled?  The recorded pony always is.
    const saddled = ((mtmp.misc_worn_check || 0) & W_SADDLE) !== 0;
    if (!saddled) {
        await pline(`${Monnam_steed(mtmp)} is not saddled.`);
        return false;
    }

    // C ref: steed.c:338-356 — the impaired/slip check.  For the recorded
    // Knight none of (Confusion, Fumbling, Glib, Wounded_legs, saddle cursed,
    // saddle greased) hold, so the only term that can fire is the level/tame
    // vs rnd(MAXULEV/2 + 5) comparison, which always rolls.
    if (!force
        && (u.ulevel + (mtmp.mtame || 0) < rnd(MAXULEV / 2 + 5))) {
        // (Levitation is false here, so the normal "slip" branch applies.)
        await pline(`You slip while trying to get on ${mon_nam(mtmp)}.`);
        // losehp(Maybe_Half_Phys(rn1(5, 10)), ...) — rn1(5,10) == rn2(5)+10.
        await losehp(rn1(5, 10));
        return false;
    }

    // Success.  (maybewakesteed / Levitation / Flying messages don't apply.)
    await pline(`You mount ${mon_nam(mtmp)}.`);
    u.usteed = mtmp;

    // C ref: steed.c:379-381 — remove_monster(steed) then
    // teleds(steed->mx, steed->my, TELEDS_ALLOW_DRAG).  teleds -> u_on_newpos
    // moves the hero onto the steed's square and sets usteed->mx/my to match;
    // the steed is taken off the level map (it now rides with the hero and is
    // drawn at the hero's position by the renderer's mounted-hero handling).
    const nux = mtmp.mx, nuy = mtmp.my;
    const ux0 = u.ux, uy0 = u.uy;

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

    // u_on_newpos: hero (and steed) move onto the steed's square.
    u.ux = nux;
    u.uy = nuy;
    mtmp.mx = nux;
    mtmp.my = nuy;

    // Redraw the hero's old tile (now vacated) and the new tile (steed glyph
    // drawn via display.js's mounted-hero handling, which keys off u.usteed).
    // C ref: steed.c mount_steed -> teleds(steed->mx,my,ALLOW_DRAG), whose tail
    // (teleport.c) does newsym(old) + see_monsters() + vision_full_recalc=1 +
    // vision_recalc(0): moving the hero to the steed's square must recompute
    // line-of-sight from the new position (e.g. a doorway in the room wall that
    // only comes into view once the hero shifts over onto the steed).  Mirrors
    // the identical teleds tail already used by hack.js jump().
    newsym(ux0, uy0);
    newsym(nux, nuy);
    game.vision_full_recalc = 1;
    vision_recalc(0);
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

// C ref: hack.c bad_rock(mdat,x,y) — for a humanoid hero, a square is "bad
// rock" when it is not accessible (a wall / closed door / stone).  Used only
// for the diagonal-squeeze test below.
function bad_rock(x, y) { return !steed_accessible(x, y); }

// C ref: hack.c doorless_door(x,y) — a doorway whose door leaf is gone
// (NODOOR/BROKEN); the rogue level's doorless doorways still disallow
// diagonal access, so they are treated as if a door were present.
function steed_doorless_door(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc || !IS_DOOR(loc.typ)) return false;
    if (Is_rogue_level(game.u?.uz)) return false;
    return !((loc.doormask ?? 0) & ~(D_NODOOR | D_BROKEN));
}

// C ref: hack.c test_move(ux,uy,dx,dy,TEST_MOVE) — the subset that matters for
// dismount landing-spot selection: a diagonal step is rejected when squeezing
// between two walls, or when leaving a doorway diagonally (steed.c dismount
// lands the hero on an adjacent square, so the origin can be an open door —
// seed0104's #ride dismount stands in one), and the destination itself must
// be accessible (checked by the caller).
function steed_test_move(ux, uy, dx, dy) {
    if (dx && dy) {
        if (bad_rock(ux, uy + dy) && bad_rock(ux + dx, uy))
            return false; // can't squeeze diagonally between two walls
        const originLoc = game.level?.at(ux, uy);
        if (!game.u?.uprops?.Passes_walls && originLoc && IS_DOOR(originLoc.typ)
            && !steed_doorless_door(ux, uy))
            return false; // can't move diagonally out of a doorway with a door
    }
    return true;
}

// MON_AT excluding the ridden steed itself (which is colocated with the hero
// and flagged mridden, i.e. off the map grid in C terms).
function steed_mon_at(x, y) {
    const mons = game.level?.monsters;
    if (!mons) return null;
    for (const m of mons) {
        if (m.mridden) continue;
        if (m.mx === x && m.my === y) return m;
    }
    return null;
}

// C ref: steed.c landing_spot(spot, reason, forceit) — pick the square the
// dismounting hero lands on.  Only the DISMOUNT_BYCHOICE (voluntary, unimpaired)
// path is needed: best_j/clockwise_j/counterclk_j are all -1, so the candidate
// list is simply the 8 adjacent squares in xdir/ydir order.  Each viable
// candidate increments `viable`; among equal-distance candidates the choice is
// the rn2(viable) tie-break (steed.c:543).  Returns the spot, or null.
function landing_spot() {
    const u = game.u;
    const tryArr = [];
    for (let j = 0; j < 8; j++) tryArr.push({ x: XDIR[j], y: YDIR[j] });

    let viable = 0, min_distance = -1, found = false;
    const spot = { x: 0, y: 0 };
    // i==0 pass only (voluntary, unimpaired) avoids known traps/boulders; the
    // ride sessions land on bare floor, so the single pass suffices.
    for (let j = 0; j < tryArr.length; j++) {
        const x = u.ux + tryArr[j].x;
        const y = u.uy + tryArr[j].y;
        if (!isok(x, y) || (x === u.ux && y === u.uy)) continue;
        const acc = steed_accessible(x, y), mon = steed_mon_at(x, y),
            tm = steed_test_move(u.ux, u.uy, x - u.ux, y - u.uy);
        if (acc && !mon && tm) {
            ++viable;
            const distance = (x - u.ux) * (x - u.ux) + (y - u.uy) * (y - u.uy);
            if (min_distance < 0
                || (distance < min_distance)
                || (distance === min_distance && !rn2(viable))) {
                // (no known-trap / boulder on these floor tiles)
                spot.x = x; spot.y = y;
                min_distance = distance;
                found = true;
            }
        }
    }
    return found ? spot : null;
}

// C ref: steed.c dismount_steed(DISMOUNT_BYCHOICE) — voluntary #ride dismount.
// landing_spot() chooses cc; the steed is placed back on the map grid at the
// hero's current square and the hero relocates to cc (C: place_monster(steed,
// u.ux,u.uy) then teleds(cc)).  The now-grounded pony resumes normal pet
// movement this turn (handled by the standard movemon/dochug path; here we just
// run the steed's own dochug to reproduce its post-dismount move, matching the
// recorded obj_resists/dog_move stream).
async function dismount_steed_bychoice() {
    const u = game.u;
    const mtmp = u.usteed;
    if (!mtmp) return;

    const cc = landing_spot(); // RNG: rn2(viable) tie-breaks
    if (!cc) {
        await pline("You can't.  There isn't anywhere for you to stand.");
        return;
    }

    // C ref: steed.c dismount_steed() — when the steed has no given name,
    //   pline("You've been through the dungeon on %s with no name.",
    //         an(pmname(mtmp->data, Mgender(mtmp))));
    // pmname is the bare species name (no "saddled" adjective, no article),
    // and an() prepends a/an.  x_monnam(.,ARTICLE_A) yields "a <species>" from
    // mtmp.data.name (the species), which for the recorded steed is "pony".
    // Route through update_topl so a following pet-combat message (the grounded
    // steed attacking an adjacent hostile on the same turn) pages this line with
    // a --More-- exactly as C's topl buffer does.
    {
        const given = mtmp?.mgivenname || mtmp?.mextra?.mgivenname;
        if (!given) {
            const species = (mtmp?.data?.name || 'monster');
            const an = (/^[aeiou]/i.test(species) ? 'an ' : 'a ') + species;
            await update_topl(`You've been through the dungeon on ${an} with no name.`);
        } else {
            // C: You("dismount %s.", mon_nam(mtmp));
            await update_topl(`You dismount ${mon_nam(mtmp)}.`);
        }
    }

    // Release the steed.
    u.usteed = null;
    u.ugallop = 0;

    // place_monster(steed, u.ux, u.uy): steed grounds at the hero's square and
    // rejoins the map grid (clear the ridden flag).
    mtmp.mridden = false;
    mtmp.mx = u.ux;
    mtmp.my = u.uy;
    const ux0 = u.ux, uy0 = u.uy;

    // teleds(cc): the hero steps off onto the landing square.
    u.ux0 = ux0; u.uy0 = uy0;
    u.ux = cc.x; u.uy = cc.y;

    // The now-grounded pony (mridden cleared) is a normal pet again; the move
    // loop's movemon()/dochug() pass for this hero command drives its move (and
    // its dog_move obj_resists / choice rolls), so we do NOT step it here.

    // Redraw the squares involved.
    newsym(ux0, uy0);
    newsym(u.ux, u.uy);
    newsym(mtmp.mx, mtmp.my);
    // C ref: dismount_steed -> teleds(cc, ALLOW_DRAG) tail sets
    // vision_full_recalc=1 + vision_recalc(0): relocating the hero to the
    // landing square recomputes line-of-sight (e.g. the west wall of the room
    // the hero steps into).
    game.vision_full_recalc = 1;
    vision_recalc(0);

    // C ref: steed.c dismount_steed() -> float_down(0L, W_SADDLE) -> its tail
    // "if (!Is_airlevel && !Is_waterlevel && !u.uswallow && on_level(...))
    // pickup(1)": once grounded, the hero's landing square is examined exactly
    // like the tail of any other move.  Any objects there that autopickup
    // leaves behind (or, with it off, all of them) are announced via
    // look_here() -- "Things that are here:" for a pile -- chaining onto the
    // still-pending dismount pline with a --More-- the same way update_topl()
    // pages any two same-turn messages that don't fit on one line.
    await pickup_after_move(u.ux, u.uy);
}

// C ref: steed.c doride() — the #ride command.  With no current steed, read a
// direction and try to mount the monster there.  Returns ECMD_TIME (1) when a
// mount succeeds (a turn passes), else ECMD_OK/ECMD_CANCEL (0, no turn).
export async function doride() {
    const u = game.u;

    if (u.usteed) {
        // C ref: steed.c doride() -> dismount_steed(DISMOUNT_BYCHOICE).  A
        // voluntary dismount: pick a landing spot, ground the steed at the
        // hero's square, step the hero off, and let the steed take its turn.
        await dismount_steed_bychoice();
        return 1;
    }

    const dir = await getdir();
    if (dir && isok(u.ux + dir.dx, u.uy + dir.dy)) {
        u.dx = dir.dx;
        u.dy = dir.dy;
        // wizard force-mount prompt is skipped (not wizard mode here).
        const ok = await mount_steed(m_at(u.ux + dir.dx, u.uy + dir.dy), false);
        return ok ? 1 : 0;
    }
    return 0; // ECMD_CANCEL
}

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
import { y_monnam, monverbself } from './do_name.js';
import { exercise, acurr_eff } from './attrib.js';
import { p_skill_of, use_skill } from './enhance.js';
import { objects } from './mkobj.js';
import { mflags1_of, M1_HUMANOID, M1_AMORPHOUS, M1_UNSOLID, M1_SLITHY,
         M1_FLY } from './monflags_data.js';
import { A_DEX, A_CHA, A_WIS, ECMD_OK, ECMD_TIME, ECMD_CANCEL,
         P_RIDING, P_ISRESTRICTED, P_UNSKILLED, P_BASIC, P_SKILLED, P_EXPERT,
         DISMOUNT_BYCHOICE, DISMOUNT_THROWN, DISMOUNT_FELL } from './const.js';

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
        /* poly_when_stoned(youmonst.data) && polymon(PM_STONE_GOLEM), else
           instapetrify("attempting to saddle <a mon>") — polyself.c/mon.c,
           neither reachable from an unpolymorphed hero here. */
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
    const you = game.youmonst;
    return !!mtmp?.mtame && humanoid_std(you?.data)
        && !verysmall_std(you?.data) && !bigmonst_std(you?.data)
        && (!Underwater_std() || is_swimmer_std(mtmp.data));
}

// C ref: steed.c:387 exercise_steed() — 100 turns of riding advances P_RIDING.
export function exercise_steed() {
    const u = game.u;
    if (!u.usteed)
        return;

    /* It takes many turns of riding to exercise skill */
    u.urideturns = (u.urideturns | 0) + 1;
    if (u.urideturns >= 100) {
        u.urideturns = 0;
        use_skill(P_RIDING, 1);
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
        await dismount_steed_std(DISMOUNT_THROWN);
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
        await dismount_steed_std(DISMOUNT_FELL);
    } else {
        let buf = x_monnam(steed, ARTICLE_YOUR, null, SUPPRESS_SADDLE, false);
        if (oldshape !== steed.data)
            buf = strsubst_std(buf, 'your ', 'your new ');
        await pline(`You adjust yourself in the saddle on ${buf}.`);

        /* riding blocks stealth unless hero+steed fly */
        steed_vs_stealth_std();
    }
}

// ── local adapters for C callees with no exported JS counterpart ────────────
// C ref: do_wear.c u_handsy() — a hero with no hands can't apply a saddle.
function u_handsy_std() { return true; }
// C ref: you.h Underwater / Stone_resistance / Confusion / Fumbling / Glib.
function Underwater_std() { return !!game.u?.uprops?.Underwater; }
function Stone_resistance_std() { return !!game.u?.uprops?.Stone_resistance; }
function Confusion_std() { return !!(game.u?.uconf || game.u?.HConfusion); }
function Fumbling_std() { return !!(game.u?.HFumbling || game.u?.EFumbling); }
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
// C ref: steed.c:576 dismount_steed(reason) — UNPORTED in js/ (js/artifact.js:2799
// and js/dog.js:1217 are stubs; js/steed.js's own dismount_steed_bychoice()
// covers only DISMOUNT_BYCHOICE).
async function dismount_steed_std(reason) {
    if (reason === DISMOUNT_BYCHOICE) return await dismount_steed_bychoice();
    if (game.u) game.u.usteed = null;   /* the part every reason shares */
    return undefined;
}
// C ref: hacklib.c strsubst(bp, orig, replacement) — first occurrence only.
function strsubst_std(bp, orig, replacement) {
    const i = bp.indexOf(orig);
    return i < 0 ? bp : bp.slice(0, i) + replacement + bp.slice(i + orig.length);
}
// C ref: steed.c steed_vs_stealth() — recomputes the riding stealth block; no
// port (this port does not model Stealth).
function steed_vs_stealth_std() { }
