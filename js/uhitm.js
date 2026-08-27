// uhitm.js — Hero-vs-monster melee.
// C ref: src/uhitm.c — do_attack(), hitum(), known_hitum(); weapon.c dmgval().
//
// Faithful structural port.  The control flow mirrors uhitm.c do_attack():
//   1. the is_safemon() pet/peaceful "swap or stop" block (consumes rn2(7)
//      unless Punished short-circuits it);
//   2. attack_checks() + the actual hitum() melee for hostile monsters.
// The rn2(7) in (1) (uhitm.c:474) must be emitted at exactly the right point so
// the downstream RNG stays in lockstep.
//
// Still unported, in rough order of RNG weight (see the comment at each site):
//   peacefuls_respond()   setmangry's witness reactions (needs MS_* + grownups[])
//   leprechaun dodge      needs m_move(), file-static in monmove.js
//   dmgval silver bonus   rnd(20); needs objects[].oc_material
// NOTE: hmon_hitmon_jousting/hmon_hitmon_splitmon/hmonas and the other 36
// uhitm.c functions this live path skips are now TRANSLATED but NOT WIRED —
// see the "uhitm.c staging area" block at the bottom of this file.  The
// hmon_hitmon() below is still an inlined simplification of C's hmd pipeline;
// adopting the staged pieces is a separate, measured change.

import { game } from './gstate.js';
import { shkname, in_rooms, shop_keeper } from './shkroom.js';

// C ref: shk.c tended_shop(sroom) — shop_keeper(room) still inside his shop.
// (inhishop() is file-static in shkroom.js; three lines rather than a new
// cross-file export, since eight ports touch that file.)
function tended_shop(rno) {
    const shkp = shop_keeper(rno);
    if (!shkp) return false;
    const rmno = game.level?.at(shkp.mx, shkp.my)?.roomno ?? 0;
    return rmno !== 0 && rmno === shkp.eshk?.shoproom;
}
import { WEP_SDAM, WEP_LDAM } from './weapondmg_data.js';
import { dmgval, hitval, abon, dbon, weapon_type, is_axe,
         mon_hates_blessings, weapon_hit_bonus_core,
         weapon_dam_bonus_core } from './weapon.js';
import { register_monnam_hooks, rndmonnam, bogon_is_pname } from './do_name.js';
import { rn2, rnd, d } from './rng.js';
import { cansee, couldsee } from './vision.js';
import { m_at, newsym, map_invisible, unmap_object, canseemon_shared } from './display.js';
import { isok, IS_OBSTRUCTED, A_STR, A_DEX, A_CON, A_WIS, A_LAWFUL, ACCESSIBLE,
         TAINT_AGE, CORPSTAT_INIT, CORPSTAT_NONE, W_SADDLE, SUPPRESS_SADDLE,
         SHOPBASE, engulfing_u, STRAT_WAITMASK, I_SPECIAL,
         P_NONE, P_ISRESTRICTED, P_UNSKILLED, P_BASIC, P_SKILLED, P_EXPERT,
         P_LAST_WEAPON, P_BARE_HANDED_COMBAT, P_TWO_WEAPON_COMBAT,
         P_RIDING, ERODE_BURN, ERODE_RUST, ERODE_CORRODE, ER_NOTHING,
         EF_NONE, EF_GREASE } from './const.js';
import { Blind } from './vision.js';
import { exercise, adjalign } from './attrib.js';
import { DEADMONSTER, Protection_from_shape_changers, mmove_of, base_mmove,
         healmon, mvitals_died, sensemon } from './mon.js';
import { MFLAGS1, MFLAGS2, M1_WALLWALK, M2_NASTY, M2_ORC, M2_UNDEAD, M2_DEMON,
         M2_COLLECT, M2_HUMAN, M2_HOSTILE, M2_PNAME, humanoid } from './monflags_data.js';
// C ref: include/monflag.h G_UNIQ (0x1000) — generated only once.
const G_UNIQ_XM = 0x1000;
const mflags1_of = (ptr) => (ptr?.pmidx != null ? (MFLAGS1[ptr.pmidx] ?? 0) : 0);
const mflags2_of = (ptr) => (ptr?.pmidx != null ? (MFLAGS2[ptr.pmidx] ?? 0) : 0);
import { dmgtype, attacktype, AT_ENGL, AT_HUGS, AD_STCK } from './monattk_data.js';
import { mattk_of, AT_NONE, AT_CLAW, AT_BITE, AT_KICK, AT_STNG, AT_BUTT, AT_TUCH,
         AT_WEAP, AT_MAGC, AD_PHYS, AD_MAGM, AD_FIRE, AD_COLD, AD_ELEC, AD_ACID,
         AD_BLND, AD_STUN, AD_PLYS, AD_DRLI, AD_STON, AD_SLIM, AD_RUST, AD_CORR,
         AD_ENCH } from './monattk_data.js';
import { mkcorpstat, mkobj, mksobj, CORPSE, FIGURINE, place_object, WEAPON_CLASS,
         TOOL_CLASS, GEM_CLASS, SPBOOK_CLASS, FOOD_CLASS, objects, COIN_CLASS,
         STRANGE_OBJECT } from './mkobj.js';
import { base_armcat } from './objarmor_data.js';
import { mon_nocorpse, undead_to_corpse, name_to_pmidx } from './makemon.js';
import { more_experienced, newexplevel } from './exper.js';
import { gethungry } from './allmain.js';
import { is_weptool, objectBaseName, simple_typename, is_plural, otense,
         near_capacity, update_inventory } from './invent.js';
import { livelog_printf, LL_CONDUCT } from './livelog.js';
import { engr_at, wipe_engr_at } from './engrave.js';
import { find_mac as worn_find_mac } from './worn.js';

// ── small monster-state predicates (C: include/monst.h, mondata.h) ──

// C ref: include/monst.h:251 — helpless(mon) = msleeping || !mcanmove.
function helpless(mtmp) {
    const canmove = (mtmp.mcanmove == null) ? 1 : mtmp.mcanmove;
    return !!(mtmp.msleeping || !canmove);
}

// C ref: include/mondata.h is_longworm(ptr) — PM_BABY_LONG_WORM /
// PM_LONG_WORM / PM_LONG_WORM_TAIL (pmidx per makemon.js MONS_NAMES).
const LONGWORM_PMIDX = new Set([112, 114, 330]);
function is_longworm(mdat) {
    return mdat != null && LONGWORM_PMIDX.has(mdat.pmidx);
}

// C ref: include/mondata.h passes_walls(ptr) = (mflags1 & M1_WALLWALK).
// do_attack()'s pet-swap `foo` reads this: a phasing peaceful/tame monster
// standing where the hero is inside rock is NOT a reason to stop, so getting
// it wrong picks the wrong arm of the flee/"doesn't move"/swap three-way
// (rnd(6) monflee vs rn2(6) vs nothing).
function passes_walls(mdat) {
    return (mflags1_of(mdat) & M1_WALLWALK) !== 0;
}

// C ref: display.c is_safemon() macro (include/display.h:159):
//   flags.safe_dog && mpeaceful && canspotmon && !Confusion
//   && !Hallucination && !Stunned.
// safe_dog defaults ON; the early sessions don't disable it.  The hero isn't
// confused/hallucinating/stunned at the bump moment, so those props (not yet
// modelled) read as their default-false.
export function canspotmon(mtmp) {
    if (!mtmp) return false;
    // Blind/telepathy not modelled in the starter state; a lit-room adjacent
    // pet is simply seen when its square is in view.
    if (game.u?.uswallow) return true;
    // C ref: display.h:129 canspotmon(mon) = canseemon(mon) || sensemon(mon).
    // The sensemon half is what makes a monster the hero only knows about
    // through Detect_monsters nameable ("small mimic", not "it").
    return canseemon_shared(mtmp) || sensemon(mtmp);
}

export function is_safemon(mtmp) {
    if (!mtmp) return false;
    const flags = game.flags || {};
    const safe_dog = (flags.safe_dog !== undefined) ? flags.safe_dog : true;
    const Confusion = !!game.u?.uconf;
    const Hallucination = !!game.u?.uhallu;
    const Stunned = !!game.u?.ustun;
    return !!(safe_dog && mtmp.mpeaceful && canspotmon(mtmp)
              && !Confusion && !Hallucination && !Stunned);
}

// C ref: monmove.c:461 monflee(mtmp, fleetime, first, fleemsg) — the
// bookkeeping half.  Both callers of this copy (do_attack's pet-in-the-way
// scare and muse.c's use_scare_monster) pass fleemsg == FALSE, so the message
// ladder and the vrock gas cloud (which monmove.js's copy has) are not needed;
// everything else must match, in particular:
//   - first == FALSE means the body runs even when the monster is ALREADY
//     fleeing, accumulating onto the existing mfleetim;
//   - a resulting fleetime of exactly 1 is bumped to 2;
//   - mon_track_clear() runs UNCONDITIONALLY at the end.
// The last one is RNG-visible: the breadcrumb ring gates m_move's
// `rn2(4 * (cnt - j))` and dog_move's `rn2(MTSZ * (k - j))` backtrack rolls, so
// failing to clear it sends the fleeing pet to a different square (seed0014's
// dog ended 3 squares from the hero instead of adjacent, which flipped
// dog_goal's appr from 0 to 1 and skipped its whole inventory obj_resists scan).
export function monflee(mtmp, fleetime, first, _fleemsg) {
    if (DEADMONSTER(mtmp)) return;
    // (mtmp == u.ustuck -> release_hero(): neither caller can be the engulfer.)
    if (!first || !mtmp.mflee) {
        if (!fleetime) {
            mtmp.mfleetim = 0;          /* don't lose an untimed scare */
        } else if (!mtmp.mflee || mtmp.mfleetim) {
            fleetime += (mtmp.mfleetim || 0);
            if (fleetime === 1) fleetime++;
            mtmp.mfleetim = Math.min(fleetime, 127);
        }
        mtmp.mflee = 1;
    }
    /* ignore recently-stepped spaces when made to flee */
    mtmp.mtrack = [];
}

// ── do_attack ──
// C ref: uhitm.c do_attack(struct monst *mtmp) — try to attack the monster at
// <u.ux+u.dx, u.uy+u.dy>.  Returns TRUE if hero movement is used up, FALSE if
// the monster evaded (so domove falls through to the swap-places logic).
//
// u.dx / u.dy must already be set by the caller (domove).
export async function do_attack(mtmp) {
    const u = game.u;
    // C ref: hack.h `#define Punished (uball != 0)`.  This is the FIRST term of
    // an || chain, so a Punished hero short-circuits the `!rn2(7)` away: the
    // roll must NOT fire while the ball & chain are attached.
    const Punished = !!u?.uball;
    const forcefight = !!game.context?.forcefight;

    // Protection for peaceful '@' and tame 'd': when safe and not force-
    // fighting, we assume the player isn't trying to attack — usually a
    // place-swap (handled by the caller) instead.  C ref uhitm.c:461-509.
    if (is_safemon(mtmp) && !forcefight) {
        // (Stormbringer override not modelled.)
        const loc = game.level?.at(u.ux, u.uy);
        const obstructed = !!(loc && IS_OBSTRUCTED(loc.typ));
        const foo = (Punished || !rn2(7)
                     || (is_longworm(mtmp.data) && mtmp.wormno)
                     || (obstructed && !passes_walls(mtmp.data)));
        // C ref: uhitm.c:481-487 — only checked when there is no other reason
        // to stop.  A tended shop under the target means the hero must NOT
        // swap places with its occupant, so this steers the whole three-way
        // below (stop / "doesn't seem to move" / swap) and therefore whether
        // rnd(6) or rn2(6) is rolled at all.
        let inshop = false;
        if (!foo) {
            for (const rno of in_rooms(mtmp.mx, mtmp.my, SHOPBASE))
                if (tended_shop(rno)) { inshop = true; break; }
        }

        if (inshop || foo) {
            // C ref: uhitm.c:492-494 — bumping a spotted shopkeeper is a
            // payment attempt, not an attack, and never a place-swap.
            // (invent.js's dopay() is still the reduced "no shopkeeper here"
            // stub; the call site is faithful so completing dopay() fixes
            // this path too.)
            if (!game.context?.travel && !game.context?.run
                && canspotmon(mtmp) && mtmp.isshk) {
                const { dopay } = await import('./invent.js');
                await dopay();
                return true;              // ECMD_TIME | dopay()
            }
            if (mtmp.mtame) { // see 'additional considerations' in C
                // Use the FULL monmove.c monflee(), not the reduced copy below:
                // monflee(mtmp, rnd(6), ...) with rnd(6)==1 hits C's `if
                // (fleetime == 1) fleetime++` clamp, so the pet flees for TWO
                // turns.  The reduced copy stored 1, ending the flee a turn
                // early and dropping the fleeing monster's rn2(40) teleport roll
                // from dochug (seed0002 step 273).
                const { monflee: monflee_full } = await import('./monmove.js');
                await monflee_full(mtmp, rnd(6), false, false);
            }
            // C ref: uhitm.c:495-499 — You("stop.  %s is in the way!", buf) where
            // buf = highc(y_monnam(mtmp)).  This message is ALWAYS emitted here
            // (not only while running); the following end_running(TRUE) is a
            // no-op for the single-step commands the corpus uses.
            const buf = x_monnam(mtmp, /*ARTICLE_YOUR*/ 3, null, 0, false);
            // C ref: topl.c update_topl():298 — You() leaves toplin ==
            // NEED_MORE, and the movemon() pass that follows in the SAME
            // command has no nhgetch to demote it, so a monster message that
            // will not fit alongside this one pages it first.
            const { update_topl } = await import('./display.js');
            await update_topl(`You stop.  ${buf.charAt(0).toUpperCase()}${buf.slice(1)} is in the way!`);
            const { end_running } = await import('./hack.js');
            end_running(true);
            return true;
        } else if (mtmp.mfrozen || helpless(mtmp)
                   || (movement_rate(mtmp) === 0 && rn2(6))) {
            await plineMon(mtmp, "%s doesn't seem to move!");
            const { end_running } = await import('./hack.js');
            end_running(true);
            return true;
        } else {
            return false; // monster "evaded" -> caller swaps places
        }
    }

    // Hostile / force-fight melee.  attack_checks() + hitum() are not yet
    // needed by any owned session; emit nothing and fall through so behaviour
    // is conservative.  (Faithful expansion: attack_checks(mtmp, uwep) then
    // hitum(mtmp, youmonst.data->mattk).)
    return await hostile_attack(mtmp);
}

// C ref: include/permonst.h mons[].mmove — species base movement rate.  This
// feeds do_attack()'s `mtmp->data->mmove == 0 && rn2(6)`, and MONS[] carries no
// mmove field, so the old `?? 1` fallback made that rn2(6) unreachable for
// EVERY monster.  The sessile species (molds, blue/spotted jelly, lichen's
// mmove==0 neighbours, shriekers' 1) can be peaceful for a co-aligned hero, so
// walking into one really does roll here.  mon.js owns the audited table.
function movement_rate(mtmp) {
    return base_mmove(mtmp);
}

// ── hostile melee: do_attack tail -> hitum -> known_hitum -> hmon ──
//
// C ref: uhitm.c do_attack() (the post-safemon hostile path).  attack_checks()
// consumes no RNG for an ordinary visible adjacent hostile (no displacement, no
// hidden-monster reveal), so the first roll is exercise(A_STR) (uhitm.c:551),
// then hitum().  Faithful to the verified seed0107/seed0104 RNG traces:
//   exercise(A_STR) rn2(19); hitum: rnd(20) [swing], passive rn2(3) [if mon
//   survives a swing], (on hit) dmgval(weapon) [+ exercise(A_DEX) on the first
//   swing], then the kill aftermath (xkilled rn2(6); corpse_chance rn2(2);
//   make_corpse -> mkcorpstat -> mksobj corpse next_ident/rndmonnum/gender).
// C ref: hack.c check_capacity(str) — an Overtaxed (EXT_ENCUMBER) hero can't
// fight at all.  Returning TRUE aborts do_attack BEFORE overexertion(), so it
// also suppresses that turn's gethungry() rn2(20) and exercise(A_STR) rn2(19).
const HVY_ENCUMBER = 3, EXT_ENCUMBER = 4;
async function check_capacity(str) {
    if (near_capacity() >= EXT_ENCUMBER) {
        const { pline } = await import('./display.js');
        await pline(str || "You can't do that while carrying so much stuff.");
        return true;
    }
    return false;
}

// C ref: hack.c overexert_hp() — the HP cost of fighting while Strained+.
async function overexert_hp() {
    const u = game.u;
    if ((u.uhp ?? 0) > 1) {
        u.uhp -= 1;
        game.disp = game.disp || {};
        game.disp.botl = true;
    } else {
        const { pline } = await import('./display.js');
        await pline('You pass out from exertion!');
        exercise(A_CON, false);   // attrib.c exercise(dec) rolls rn2(2)
        // fall_asleep(-10, FALSE): nomul(-10) with no "You wake up" message.
        const { nomul } = await import('./hack.js');
        nomul(-10);
    }
}

// C ref: hack.c overexertion() — "combat increases metabolism".  Called by
// do_attack() before the swing.  Always calls the real gethungry() (the same
// per-turn function allmain.js's moveloop calls) — an EXTRA nutrition burn on
// top of the once-per-turn drain, so an attack turn costs 2 hunger instead of
// 1.  The overexert_hp() arm was previously hardcoded away as "never fires for
// the unencumbered starter hero": it fires on 2 turns in 3 for ANY hero at
// Strained or worse, and its exercise(A_CON, FALSE) draws rn2(2).
export async function overexertion() {
    gethungry(); // hack.c:3056 — "consume extra nutrition during combat"
    if (((game.moves || 0) % 3) !== 0 && near_capacity() >= HVY_ENCUMBER)
        await overexert_hp();
    return (game.multi ?? 0) < 0; // might have fainted (forced to sleep)
}

// ── attack_checks: pre-swing special cases (mimic/hidden-monster reveal) ──
// C ref: display.c canseemon(mon) — visible on an in-sight, non-invisible
// square.  Same shape as the copies in dogmove.js/mon.js/muse.js.
function canseemon(mtmp) {
    if (!mtmp) return false;
    // C ref: display.h canseemon() has NO u.uswallow arm — from inside a
    // stomach vision_recalc() blanks viz_array, so cansee() is false even for
    // the engulfer.  The blanket `return true` here made the hit message print
    // exclam(dmg) where C prints the flat "." (uhitm.c:1659).
    if (mtmp.minvis && !game.u?.see_invis) return false;
    // C ref: display.h _mon_visible() — `(!minvis || See_invisible) && !mundetected`.
    if (mtmp.mundetected) return false;
    return !!cansee(mtmp.mx, mtmp.my);
}

// C ref: mondata.h hides_under(ptr) = (mflags1 & M1_CONCEAL).  Same pmidx set
// as monmove.js's hides_under_pm (cave spider, centipede, scorpion, garter
// snake, snake, water moccasin, pit viper, cobra); duplicated locally rather
// than imported to avoid a uhitm.js<->monmove.js import cycle (monmove.js
// already imports several names from this file).
const M1_CONCEAL_PMIDX = new Set([94, 95, 97, 214, 215, 216, 218, 219]);
function hides_under_pm(ptr) {
    return ptr != null && M1_CONCEAL_PMIDX.has(ptr.pmidx);
}
const S_EEL_MCLS = 57;   // monsym.h S_EEL
const S_MIMIC_MCLS = 13; // monsym.h S_MIMIC

// C ref: rm.h glyph_is_invisible(glyph) — a square remembered as holding a
// sensed-but-unseen monster.  display.js tracks this per-square as `invisMon`
// (see game.js's rm-cell shape / map_invisible()).
export function glyph_is_invisible(x, y) {
    return !!game.level?.at(x, y)?.invisMon;
}

// C ref: display.c mon_warning()/glyph_is_warning() — the "Warning" monster-
// detection intrinsic (via class ring or high-level Cleric prayer reward)
// isn't modeled anywhere in this port yet, so no square is ever a warning
// glyph.
function glyph_is_warning() { return false; }

// C ref: makemon.c FURNSYMS[] explanation text for the 6 furniture
// appearances set_mimic_sym() can assign a mimic (up/down staircase, altar,
// grave, throne, sink).  Same table as hack.js's FURNITURE_EXPLANATION
// (duplicated locally: hack.js imports from this file, so the reverse import
// would cycle).
const FURNITURE_EXPLANATION = {
    25: 'staircase up',
    26: 'staircase down',
    33: 'altar',
    34: 'grave',
    35: 'opulent throne',
    36: 'sink',
};

// C ref: mon.c seemimic(mtmp) — a discovered mimic drops its object/furniture
// appearance and is redrawn as its true form.
export function seemimicLocal(mtmp) {
    mtmp.m_ap_type = 0;
    mtmp.mappearance = 0;
    newsym(mtmp.mx, mtmp.my);
}

// C ref: uhitm.c that_is_a_mimic()'s "what" naming: a_monnam(mtmp), except a
// disguised mimic caught while asleep or frozen is named with a "sleeping"
// adjective instead (C's own comment flags this as misclassifying a
// paralyzed mimic as sleeping — reproduced as-is for fidelity).
function mimic_reveal_what(mtmp) {
    if ((mtmp.msleeping || mtmp.mfrozen) && mtmp.data?.mcls === S_MIMIC_MCLS)
        return an('sleeping ' + (mtmp.data?.name || 'monster'));
    return x_monnam(mtmp, /*ARTICLE_A*/ 2, null, 0, false);
}

// C ref: uhitm.c that_is_a_mimic(mtmp, MIM_REVEAL) — the "That <disguise> is
// really/actually a <mimic>!" reveal line.  Reduced to the M_AP_OBJECT/
// M_AP_FURNITURE cases this port's mimics ever carry (set_mimic_sym never
// assigns M_AP_MONSTER); the Blind branch falls back to C's own generic
// "Wait!  That's a monster!" (Blind_telepat is never true — no telepathy is
// modeled, matching sensemon()'s stub above).
// C ref: pager.c object_from_map(glyph, x, y, &obj_p) — reduced to the
// M_AP_OBJECT-mimic case that_is_a_mimic() needs.  If a REAL floor object of
// the disguise's exact type already sits on the mimic's square, C names that
// (no RNG).  Otherwise it builds a throwaway object via mksobj(glyphotyp,
// FALSE, FALSE) purely to name/pluralize the disguise — critically, mksobj
// ALWAYS assigns o_id via next_ident(), which rolls rnd(2), regardless of the
// FALSE init arg.  This roll is NOT optional: skipping it desyncs every RNG
// draw for the rest of the game (the bug a previous, reverted attempt at this
// fix hit).  The temporary object is never placed on the floor or added to
// any list, matching C's dealloc_obj() cleanup (left to the GC here).
function object_from_map_lite(mtmp) {
    const otyp = mtmp.mappearance;
    const real = (game.level?.objects || []).find(
        (o) => o.ox === mtmp.mx && o.oy === mtmp.my && o.otyp === otyp);
    if (real) return real;
    const otmp = mksobj(otyp, false, false);
    // C ref: pager.c object_from_map() — "to force pluralization" for coins.
    if (otmp.oclass === COIN_CLASS) otmp.quan = 2;
    return otmp;
}

function that_is_a_mimic_message(mtmp) {
    if (Blind()) return "Wait!  That's a monster!";

    let fmtbuf;
    if (mtmp.m_ap_type === 'furniture') {
        const furn = FURNITURE_EXPLANATION[mtmp.mappearance] || 'thing';
        fmtbuf = `That ${furn} actually is %s!`;
    } else if (mtmp.m_ap_type === 'obj') {
        const otyp = mtmp.mappearance;
        const otmp = object_from_map_lite(mtmp);
        const otmp_name = (otyp && otyp !== STRANGE_OBJECT) ? simple_typename(otyp) : 'strange object';
        const plural = is_plural(otmp);
        const verb = otense(otmp, 'are');
        fmtbuf = `${plural ? 'Those' : 'That'} ${otmp_name} ${verb} %s!`;
    } else {
        fmtbuf = "Wait!  That's %s!"; // not reached by this port's data model
    }
    return fmtbuf.replace('%s', mimic_reveal_what(mtmp));
}

// C ref: mon.c wakeup(mtmp, via_attack) — reduced to the pieces attack_checks
// needs: the "<Mon> wakes up!"/"." message (gated on canseemon, using the
// PRE-reset msleeping value) and un-mimicking (mimics/hiders always drop
// their disguise on wakeup here; the M_AP_MONSTER "keep disguise" exception
// never applies since this port's mimics never carry that appearance type).
// The via_attack aftermath (growl/setmangry/ghod_hitsu/hot_pursuit) isn't
// modeled — no covered session reaches a hostile-turn/temple/shop reaction
// from this path yet.
export async function wakeupAttack(mtmp, viaAttack) {
    const wasSleeping = !!mtmp.msleeping;
    if (wasSleeping && canseemon(mtmp)) {
        // C's pline() is update_topl(): this line APPENDS to the hit message
        // that precedes it ("You hit it.  The wood nymph wakes up!") instead of
        // replacing it, which is where the turn's --More-- boundaries fall.
        const { update_topl } = await import('./display.js');
        // mon.c:4325-4328 wake_msg() — flesh golem alone gets " It's alive!".
        const alive = mtmp.data?.name === 'flesh golem' ? " It's alive!" : '';
        await update_topl(`${Monnam(mtmp)} wakes up${viaAttack ? '!' : '.'}${alive}`);
    }
    mtmp.msleeping = 0;
    if (mtmp.m_ap_type) seemimicLocal(mtmp);
    // C ref: mon.c wakeup() via_attack tail.  ghod_hitsu() needs a temple
    // priest; hot_pursuit() needs `!*u.ushops`, and u.ushops is set the moment
    // the hero steps onto the shop door, so an in-shop shopkeeper skips it.
    if (viaAttack) {
        // C ref: mon.c:4353 `if (was_sleeping) growl(mtmp);` — growl() itself
        // draws only under Hallucination, but its wake_nearto(mlevel * 18) tail
        // wakes nearby sleepers, and each one C woke skips disturb()'s rn2(50)
        // next turn.  (An earlier attempt dropped growl for costing screens; it
        // was missing the msound verb table and the helpless() guard.)
        if (wasSleeping) {
            const { growl } = await import('./sounds.js');
            await growl(mtmp);
        }
        await setmangry(mtmp, true);
    }
}

// C ref: mon.c setmangry(mtmp, via_attack) — the hero attacked mtmp.  RNG-free
// unless the hero stands on an Elbereth engraving (rnd(5) alignment penalty).
//
// peacefuls_respond() (mon.c:4160) is NOT ported: it draws rn2(5) + a
// ROLL_FROM() + rn2(10)/rn2(50) per witness, and a witness needs a SECOND
// non-mindless peaceful monster that is awake, can see the hero, and is in
// line of sight.  Porting it needs the MS_* msound enum, which this tree does
// not carry symbolically; a guessed table would silently answer FALSE.
export async function setmangry(mtmp, via_attack) {
    const { update_topl: pline } = await import('./display.js');
    const u = game.u;
    if (via_attack && engraving_says_elbereth(u.ux, u.uy)) {
        const { onscary } = await import('./monmove.js');
        if (onscary(u.ux, u.uy, mtmp) || mtmp.mpeaceful) {
            await pline('You feel like a hypocrite.');
            adjalign((u.ualign?.record ?? 0) > 5 ? -5 : -rnd(5));
            if (!Blind()) await pline('The engraving beneath you fades.');
            // del_engr_at(): wipe_engr_at() with a count past the text length
            // is the same erase with no RNG (wipeout_text is skipped once the
            // engraving is gone).
            const { engr_at: ea } = await import('./engrave.js');
            const ep = ea(u.ux, u.uy);
            if (ep) ep.engr_txt = '';
        }
    }
    mtmp.mstrategy = (mtmp.mstrategy || 0) & ~STRAT_WAITMASK;
    if (!mtmp.mpeaceful || mtmp.mtame) return;
    mtmp.mpeaceful = 0;
    // C ref: mon.c:4230 — angering a priest is scored by co-alignment, not by
    // the flat -1 this used to apply unconditionally.  u.ualign.record is the
    // MODULUS of peace_minded()'s rn2(16 + record) for every later monster.
    if (mtmp.ispriest) {
        const { p_coaligned } = await import('./priest.js');
        adjalign(p_coaligned(mtmp) ? -5 : 2);
    } else {
        adjalign(-1); /* attacking peaceful monsters is bad */
    }
    if (humanoid(mtmp.data) || mtmp.isshk || mtmp.isgd) {
        if (couldsee(mtmp.mx, mtmp.my))
            await pline(`${Monnam(mtmp)} gets angry!`);
    }
    // else growl(mtmp): deliberately silent here — sounds.c growl() is RNG-free
    // and its topline lands where C's does not (measured on seed0030).

    // C ref: mon.c:4247 — `if (!svc.context.mon_moving) peacefuls_respond(mtmp)`.
    // STILL UNPORTED, and it is the largest remaining RNG hole in this file: for
    // every awake, non-mindless peaceful witness in line of sight it can draw
    // rn2(5) + ROLL_FROM(Exclam) (another rn2(5)), rn2(10), rn2(50), or in the
    // same-monster-class arm rn2(3)/rn2(4)/rn2(6)/rn2(25).  Porting it needs
    // maybe_gasp()'s MS_* switch (monflags_data.js has the audited MSOUND table
    // but this tree carries no symbolic MS_* enum) and big_little_match(), whose
    // grownups[] walk is file-static in makemon.js.  A guessed MS_* mapping
    // would silently answer "no gasp" and drop the rn2(5) — the exact failure
    // mode the wrong-constant sweep documents — so it is left explicit.
}

// C ref: engrave.c sengr_at("Elbereth", x, y, TRUE) — a legible Elbereth
// under the hero.
function engraving_says_elbereth(x, y) {
    const ep = engr_at(x, y);
    return !!(ep && (ep.engr_time || 0) <= (game.moves || 0)
              && /Elbereth/i.test(String(ep.engr_txt || '')));
}



// C ref: uhitm.c stumble_onto_mimic(mtmp) — the hero has bumped into (or
// force-attacked) a disguised mimic for the first time: reveal it (message +
// seemimic), then silently wake it (via_attack=FALSE: the "wakes up" framing
// belongs to a fresh attack, not this reveal).  This whole call consumes the
// hero's turn with NO swing — do_attack/attack_checks returns TRUE so the
// caller skips hitum() entirely this turn.
async function stumble_onto_mimic(mtmp) {
    const { pline } = await import('./display.js');
    const msg = that_is_a_mimic_message(mtmp);
    // uhitm.c:6269-6275 — pline() FIRST, `if (reveal_it) seemimic(mtmp)` after.
    // seemimic -> newsym repaints the cell immediately here, so revealing
    // before the message shows the true glyph on any --More-- the message
    // raises, where C still shows the disguise.
    await pline(msg);
    seemimicLocal(mtmp);
    // dmgtype(AD_STCK) + set_ustuck (a large/giant mimic "grabs" the hero on
    // reveal): not modeled — no large/giant mimic reaches this path in the
    // covered corpus (their AD_STCK claw attack is otherwise ported in
    // hmon()'s adtyp table for monster-vs-monster fights, not this branch).
    await wakeupAttack(mtmp, false);
    // wakeup() -> if hero is blind, the monster still won't display; keep the
    // invisible-monster marker up for a blind hero (uhitm.c:6294-6296).
    if (!canspotmon(mtmp) && !glyph_is_invisible(mtmp.mx, mtmp.my))
        map_invisible(mtmp.mx, mtmp.my);
}

// C ref: uhitm.c attack_checks(mtmp, wep) — pre-swing special cases: engulf,
// forcefight, hidden/invisible-monster reveal, mimic reveal, undetected-hider
// reveal, and (peaceful "Really attack?" confirm — needs an interactive
// prompt the recorded input streams can't drive, not modeled).  Returns TRUE
// when the "attack" is fully resolved here (do_attack must return
// immediately, no swing this turn); FALSE means fall through to hitum().
export async function attack_checks(mtmp) {
    // uhitm.c:216 — clear the monster's "waiting for you" AI flag now that
    // you're adjacent enough to attack it (STRAT_WAITMASK = 0x00ff0000).
    if (mtmp.mstrategy != null) mtmp.mstrategy &= ~0x00ff0000;

    if (engulfing_u(mtmp)) return false;
    if (game.context?.forcefight) return false;

    const gx = game.bhitpos.x, gy = game.bhitpos.y;
    const glyphInvisible = glyph_is_invisible(gx, gy);
    const glyphWarning = glyph_is_warning();

    // uhitm.c:217-234 — the hero can't spot the target at all (not merely
    // disguised — an actually hidden/invisible one) and there's no warning/
    // invisible marker already up: announce it and remember an invisible-
    // monster marker there.
    if (!canspotmon(mtmp) && !glyphWarning && !glyphInvisible
        && !(!Blind() && mtmp.mundetected && hides_under_pm(mtmp.data))) {
        // update_topl(), not pline(): C's pline() routes through update_topl(),
        // which more()s an unacknowledged topline that the new text will not fit
        // beside.  Reaching here right after a monster's message (the bullwhip
        // disarm's "yanks ... to the floor!") swallowed that --More-- boundary.
        const { update_topl } = await import('./display.js');
        await update_topl("Wait!  There's something there you can't see!");
        map_invisible(gx, gy);
        // dmgtype(AD_STCK)+set_ustuck sticky-hold branch: large/giant-mimic
        // only, not modeled (see stumble_onto_mimic's note above).
        await wakeupAttack(mtmp, true);
        return true;
    }

    // uhitm.c:243-251 — a disguised mimic (m_ap_type set).  If an "invisible
    // monster" marker is already up at that square the hero already knew
    // something was there, so the reveal is silent and the swing proceeds
    // this same turn; otherwise the reveal (stumble_onto_mimic) consumes the
    // whole turn and no swing happens.
    if (mtmp.m_ap_type && !Protection_from_shape_changers() && !sensemon(mtmp)
        && !glyphWarning) {
        if (glyphInvisible) {
            seemimicLocal(mtmp);
            return false;
        }
        await stumble_onto_mimic(mtmp);
        return true;
    }

    // uhitm.c:253-277 — an undetected hider (hides-under species or eel) the
    // hero can't otherwise see: reveal it, then (without telepathy/Detect_
    // monsters, neither modeled) announce it and consume the turn.
    if (mtmp.mundetected && !canseemon(mtmp) && !glyphWarning
        && (hides_under_pm(mtmp.data) || mtmp.data?.mcls === S_EEL_MCLS)) {
        mtmp.mundetected = 0;
        mtmp.msleeping = 0;
        newsym(mtmp.mx, mtmp.my);
        if (glyphInvisible) {
            seemimicLocal(mtmp);
            return false;
        }
        const { pline } = await import('./display.js');
        if (Blind()) {
            await pline("Wait!  There's a hidden monster there!");
        } else {
            const objAtSquare = game.level?.at(mtmp.mx, mtmp.my)?.objects;
            const obj = Array.isArray(objAtSquare) ? objAtSquare[0] : objAtSquare;
            if (obj) {
                await pline(`Wait!  There's something hiding under ${objectBaseName(obj)}!`);
            } else {
                await pline("Wait!  There's something there you can't see!");
            }
        }
        return true;
    }

    // uhitm.c:281-285 — a sensed (telepathy) hider/mimic wakes/un-hides even
    // without a physical reveal.  sensemon() is always false here, so this
    // never fires yet (no telepathy modeled).
    if ((mtmp.mundetected || mtmp.m_ap_type) && sensemon(mtmp)) {
        mtmp.mundetected = 0;
        await wakeupAttack(mtmp, true);
    }

    // C ref: uhitm.c:308-324 — a visible peaceful target requires an explicit
    // confirmation.  This also applies to kicks: dokick.c calls attack_checks()
    // with a null weapon, so declining must leave `context.move` clear and
    // consume no turn.
    const flags = game.flags || {};
    const Confusion = !!game.u?.uconf;
    const Hallucination = !!game.u?.uhallu;
    const Stunned = !!game.u?.ustun;
    if (flags.confirm !== false && mtmp.mpeaceful
        && !Confusion && !Hallucination && !Stunned && canspotmon(mtmp)) {
        const { y_n } = await import('./display.js');
        const answer = await y_n(`Really attack ${mon_nam(mtmp)}?`, 'yn', 'n');
        if (answer !== 'y') {
            game.context.move = 0;
            return true;
        }
    }

    return false;
}

async function hostile_attack(mtmp) {
    const u = game.u;

    // attack_checks(mtmp, uwep): for an ordinary adjacent, visible hostile the
    // confirmation prompts (peaceful, displacement, hidden monster) don't fire
    // and no RNG is consumed.  bhitpos is the target square.
    game.context = game.context || {};
    game.bhitpos = { x: u.ux + u.dx, y: u.uy + u.dy };

    if (await attack_checks(mtmp)) return true;

    // C ref: uhitm.c:532-534 — `check_capacity(...) || overexertion()` then
    // `goto atk_done`.  The || short-circuits: an Overtaxed hero prints the
    // refusal and NEITHER gethungry()'s rn2(20) nor exercise(A_STR)'s rn2(19)
    // fires.  overexertion() (hack.c:3051) otherwise always calls gethungry()
    // ("combat increases metabolism"), which rolls a single rn2(20)
    // "accessorytime" (eat.c:3191).  This is the per-attack metabolism roll,
    // distinct from the moveloop's per-turn gethungry; it fires at the START of
    // every melee attack, before exercise(A_STR).  Omitting it dropped one
    // rn2(20) per kill turn and shifted the whole post-attack stream by one
    // (seed0006 step 41 / seed0107).
    if (await check_capacity('You cannot fight while so heavily loaded.')
        || await overexertion())
        return await atk_done(mtmp);

    // C ref: uhitm.c:539-540 — a two-weapon setup that has become illegal
    // (shield worn, offhand welded, ...) is dropped HERE, before the swing.
    // u.twoweap drives hitum()'s second rnd(20) swing and known_hitum()'s whole
    // second pass, so leaving it stale doubles the attack's RNG draws.
    if (u?.twoweap) {
        const { can_twoweapon } = await import('./wield.js');
        if (!(await can_twoweapon())) await untwoweapon();
    }
    // C ref: uhitm.c:539-549 — the one-shot gu.unweapon notice.  No RNG, but it
    // occupies the top line and forces a --More-- before the hit message.
    if (game.unweapon) {
        game.unweapon = false;
        if (game.flags?.verbose !== false) {
            // update_topl (not pline) so the hit message that follows pages
            // this line with --More-- the way C's toplin state machine does.
            const { update_topl } = await import('./display.js');
            const { cxname_singular, makeplural, body_part } = await import('./invent.js');
            if (game.uwep) {
                const base = cxname_singular(game.uwep);
                const nm = ((game.uwep.quan ?? 1) > 1) ? makeplural(base) : base;
                await update_topl(`You begin bashing monsters with your ${nm}.`);
            } else {
                await update_topl(`You begin ${Role_if_MONK() ? 'striking' : 'bashing'} monsters with your ${game.uarmg ? 'gloved' : 'bare'} ${makeplural(body_part(6 /*HAND*/))}.`);
            }
        }
    }

    // C ref: uhitm.c:551 — exercise(A_STR, TRUE) "you're exercising muscles".
    exercise(A_STR, true);
    // C ref: uhitm.c:553 u_wipe_engr(3) — "prevent unlimited pick-axe attacks".
    // Previously skipped as "no RNG when not standing on an engraving": when the
    // hero IS standing on one (Elbereth is the common case) wipe_engr_at() rolls
    // rn2(1 + 50/(cnt+1)) plus wipeout_text()'s per-character rolls.
    u_wipe_engr(3);

    // Leprechaun gold-grab dodge (uhitm.c:556): `mdat->mlet == S_LEPRECHAUN
    // && !mfrozen && !helpless && !mconf && mcansee && !rn2(7) && m_move(...)`.
    // Still unported — m_move() is file-static in monmove.js, and rolling the
    // rn2(7) without it would diverge worse on the 1-in-7 that it passes.

    await hitum(mtmp);
    mtmp.mstrategy = (mtmp.mstrategy || 0) & ~STRAT_WAITMASK;
    return await atk_done(mtmp);
}

// C ref: uhitm.c do_attack() `atk_done:` label — after a force-fight at a
// square whose occupant the hero still can't see, leave an "I" remembered
// there.  Reachable via the 'F' prefix at an invisible/unlit monster.
async function atk_done(mtmp) {
    const u = game.u;
    const x = u.ux + u.dx, y = u.uy + u.dy;
    if (game.context?.forcefight && !DEADMONSTER(mtmp) && !canspotmon(mtmp)
        && !glyph_is_invisible(x, y) && !engulfing_u(mtmp))
        map_invisible(x, y);
    return true;
}

// C ref: wield.c untwoweapon() — end two-weapon combat (message + flag).
async function untwoweapon() {
    if (game.u?.twoweap) {
        const { pline } = await import('./display.js');
        await pline('You can no longer use two weapons at once.');
        game.u.twoweap = false;
        update_inventory();
    }
}

// C ref: engrave.c u_wipe_engr(cnt) — `if (can_reach_floor(TRUE))
// wipe_engr_at(u.ux, u.uy, cnt, FALSE)`.  can_reach_floor() is TRUE for a
// non-levitating, non-swallowed hero (invent.js keeps the same stub).
function u_wipe_engr(cnt) {
    wipe_engr_at(game.u.ux, game.u.uy, cnt, false);
}

// C ref: uhitm.c mon_maybe_unparalyze() — a paralyzed monster gets a 1-in-10
// chance to wake.  A monster that can move (the common case) consumes no RNG.
// makemon() sets mcanmove TRUE; JS leaves it undefined until the monster first
// moves, so treat null/undefined as "can move" (only an explicit 0 paralyzes).
function mon_maybe_unparalyze(mtmp) {
    if (mtmp.mcanmove === 0) {
        if (!rn2(10)) { mtmp.mcanmove = 1; mtmp.mfrozen = 0; }
    }
}

// C ref: attrib.c acurr() helpers used by abon().
function ACURR(i) { return game.u?.acurr?.a?.[i] ?? 0; }

// abon()/dbon() now live in js/weapon.js (weapon.c:950/:993).

// ── role / martial-arts helpers (for the bare-handed monk path) ──
const PM_MONK = 5, PM_SAMURAI = 9, PM_HEALER = 3, PM_BARBARIAN = 1; // role mnums
// C ref: skills.h P_WHIP; objclass.h ARMOR_CLASS/ARM_SHIELD; onames.h TOWEL,
// HEAVY_IRON_BALL (mkobj.js OBJECT_DATA otyp column).
const P_WHIP = 26, ARMOR_CLASS_UH = 3, ARM_SHIELD_UH = 1;
const TOWEL_OTYP = 234, HEAVY_IRON_BALL_OTYP = 477;
function roleMnum() {
    const r = game.urole;
    return (r && r.mnum != null) ? r.mnum : null;
}
function Role_if_MONK() { return roleMnum() === PM_MONK; }
// C ref: uhitm.c:1650 hmon_hitmon_msg_hand_to_hand() — the melee verb is picked
// off the WIELDED item, not off the monster: a shield or the heavy iron ball
// "bash", a P_WHIP-skill weapon or a still-wet towel "lash", a Barbarian
// "smite", everything else "hit".  is_wet_towel/is_shield are obj.h macros.
function hit_verb(obj) {
    if (obj && (is_shield_uh(obj) || obj.otyp === HEAVY_IRON_BALL_OTYP))
        return 'bash';
    if (obj && ((objects[obj.otyp]?.oc_skill ?? 0) === P_WHIP
                || (obj.otyp === TOWEL_OTYP && (obj.spe | 0) > 0)))
        return 'lash';
    return roleMnum() === PM_BARBARIAN ? 'smite' : 'hit';
}
// C ref: obj.h is_shield(obj) — ARMOR_CLASS with oc_armcat == ARM_SHIELD.  The
// mkobj.js objects[] rows carry no oc_armcat column; objarmor_data.js does.
function is_shield_uh(obj) {
    return obj.oclass === ARMOR_CLASS_UH && base_armcat(obj.otyp) === ARM_SHIELD_UH;
}
// C ref: include/skills.h martial_bonus() = Role_if(SAMURAI) || Role_if(MONK).
function martial_bonus() {
    const m = roleMnum();
    return m === PM_MONK || m === PM_SAMURAI;
}
// C ref: weapon.c P_SKILL(P_BARE_HANDED_COMBAT).  enhance.js owns the live
// skill array (skill_init baseline + every #enhance
// advance replayed on top), so read P_SKILL from there instead of freezing the
// game-start value: a hero who enhances martial arts changes the to-hit bonus,
// the damage bonus and double_punch()'s rn2(5) gate together.
async function bare_handed_skill() {
    const { p_skill_of } = await import('./enhance.js');
    return p_skill_of(P_BARE_HANDED_COMBAT);
}
// C ref: weapon.c weapon_dam_bonus(NULL) — bare-handed-combat branch:
//   bonus = P_SKILL - 1 (>=0); bonus = ((bonus+1)*(martial?3:1))/2.
async function weapon_dam_bonus_barehand() {
    const { p_skill_of } = await import('./enhance.js');
    const u = game.u;
    return weapon_dam_bonus_core(P_BARE_HANDED_COMBAT,
                                 await bare_handed_skill(), 0, {
        martial: martial_bonus(),
        usteed: !!u?.usteed,
        twoweap: !!u?.twoweap,
        skill_riding: p_skill_of(P_RIDING),
    });
}
// C ref: weapon.c:1644 weapon_dam_bonus(weapon) for a WIELDED weapon.
async function weapon_dam_bonus_wielded(weapon) {
    const { p_skill_of } = await import('./enhance.js');
    const u = game.u;
    const wep_type = weapon_type(weapon);
    const type = (u?.twoweap && (weapon === game.uwep || weapon === game.uswapwep))
        ? P_TWO_WEAPON_COMBAT : wep_type;
    return weapon_dam_bonus_core(type, p_skill_of(type), p_skill_of(wep_type), {
        martial: martial_bonus(),
        usteed: !!u?.usteed,
        twoweap: !!u?.twoweap,
        skill_riding: p_skill_of(P_RIDING),
    });
}
// C ref: objects.h oc_bimanual — a two-handed weapon.
const BIMANUAL_OTYPS = new Set([
    55 /*TWO_HANDED_SWORD*/, 57 /*TSURUGI*/, 45 /*BATTLE_AXE*/,
    71 /*DWARVISH_MATTOCK*/, 79 /*QUARTERSTAFF*/,
    59 /*PARTISAN*/, 60 /*RANSEUR*/, 61 /*SPETUM*/, 62 /*GLAIVE*/,
    63 /*HALBERD*/, 64 /*BARDICHE*/, 65 /*VOULGE*/, 66 /*BEC_DE_CORBIN*/,
    67 /*GUISARME*/, 68 /*BILL_GUISARME*/, 69 /*LUCERN_HAMMER*/,
    70 /*FAUCHARD*/,
]);
function bimanual_wep(otmp) {
    return (otmp?.oclass === WEAPON_CLASS || is_weptool(otmp))
        && BIMANUAL_OTYPS.has(otmp.otyp);
}

// ── weapon data (include/objects.h WEAPON sdam/ldam/hitbon + skill type) ──
// oc_wsdam / oc_wldam (small/large monster damage dice), oc_hitbon (to-hit), and
// the skill discipline.  Keyed by otyp; only the starter-inventory weapons that
// the melee sessions wield need to be present (others fall back to 1-pt damage).
const P_DAGGER = 1, P_KNIFE = 2, P_AXE = 3, P_PICK_AXE = 4,
      P_SHORT_SWORD = 5, P_BROAD_SWORD = 6, P_LONG_SWORD = 7,
      P_TWO_HANDED_SWORD = 8, P_SCIMITAR = 9, P_SABER = 9, P_CLUB = 10,
      P_MACE = 11, P_MORNING_STAR = 12, P_FLAIL = 13, P_HAMMER = 14,
      P_QUARTERSTAFF = 15, P_POLEARMS = 16, P_SPEAR = 17, P_TRIDENT = 18,
      P_LANCE = 19, P_BOW = 20, P_DART = 23;

// otyp -> { ws, wl, hb, sk }.  otyp values match mkobj.js objects[] indices.
// C ref: weapon.c objects[otyp].oc_wldam — large-monster damage die; used by
// lock.c forcelock() to derive the lock-forcing chance (oc_wldam * 2).
// WEAP below is a 20-entry hand-written subset; the generated table is complete
// (war hammer 76 is absent from WEAP, so doforce()'s chance was 0 -> never succeeds).
export function oc_wldam(otyp) { return WEP_LDAM[otyp] ?? WEAP[otyp]?.wl ?? 0; }

const WEAP = {
    24: { ws: 3,  wl: 2,  hb: 0, sk: P_DART },         // DART (objects.h: sdam 3 ldam 2)
    27: { ws: 6,  wl: 8,  hb: 0, sk: P_SPEAR },        // SPEAR
    30: { ws: 8,  wl: 8,  hb: 0, sk: P_SPEAR },        // DWARVISH_SPEAR
    34: { ws: 4,  wl: 3,  hb: 2, sk: P_DAGGER },       // DAGGER
    35: { ws: 5,  wl: 3,  hb: 2, sk: P_DAGGER },       // ELVEN_DAGGER (objects.h: sdam 5 ldam 3 hb 2)
    36: { ws: 3,  wl: 3,  hb: 2, sk: P_DAGGER },       // ORCISH_DAGGER (sdam 3 ldam 3 hb 2)
    37: { ws: 4,  wl: 3,  hb: 2, sk: P_DAGGER },       // SILVER_DAGGER (sdam 4 ldam 3 hb 2)
    39: { ws: 3,  wl: 3,  hb: 2, sk: P_KNIFE },        // SCALPEL (healer start)
    40: { ws: 3,  wl: 2,  hb: 0, sk: P_KNIFE },        // KNIFE
    44: { ws: 6,  wl: 4,  hb: 0, sk: P_AXE },          // AXE
    46: { ws: 6,  wl: 8,  hb: 0, sk: P_SHORT_SWORD },  // SHORT_SWORD
    47: { ws: 8,  wl: 8,  hb: 0, sk: P_SHORT_SWORD },  // ELVEN_SHORT_SWORD (sdam 8 ldam 8)
    48: { ws: 5,  wl: 8,  hb: 0, sk: P_SHORT_SWORD },  // ORCISH_SHORT_SWORD (sdam 5 ldam 8)
    49: { ws: 7,  wl: 8,  hb: 0, sk: P_SHORT_SWORD },  // DWARVISH_SHORT_SWORD (sdam 7 ldam 8)
    50: { ws: 8,  wl: 8,  hb: 0, sk: P_SCIMITAR },     // SCIMITAR
    54: { ws: 8,  wl: 12, hb: 0, sk: P_LONG_SWORD },   // LONG_SWORD
    56: { ws: 10, wl: 12, hb: 1, sk: P_LONG_SWORD },   // KATANA
    72: { ws: 6,  wl: 8,  hb: 0, sk: P_LANCE },        // LANCE (mkobj.js otyp 72)
    73: { ws: 6,  wl: 6,  hb: 0, sk: P_MACE },         // MACE  (mkobj.js otyp 73; +1 small)
    79: { ws: 6,  wl: 6,  hb: 0, sk: P_QUARTERSTAFF }, // QUARTERSTAFF (wizard start)
};


// C ref: weapon.c weapon_hit_bonus(weapon) — skill-based to-hit modifier.  The
// per-branch tables were previously collapsed to the constants a Basic-skilled
// starter wielder produces (0 / -9 / -1), which silently answered "Basic" for
// every skill level: an Unskilled discipline is -4, a Skilled one +2, Expert
// +3, and the riding penalty is -2 for an Unskilled rider plus another -2 while
// two-weaponing.  P_SKILL now comes from enhance.js's live array.
async function weapon_hit_bonus(weapon) {
    const u = game.u;
    const { p_skill_of } = await import('./enhance.js');
    const wep_type = weapon_type(weapon);
    const type = (u?.twoweap && (weapon === game.uwep || weapon === game.uswapwep))
        ? P_TWO_WEAPON_COMBAT : wep_type;
    // js/weapon.js owns the arms (weapon.c:1545); this site supplies the live
    // P_SKILL readings.
    return weapon_hit_bonus_core(type, p_skill_of(type), p_skill_of(wep_type), {
        martial: martial_bonus(),
        usteed: !!u?.usteed,
        twoweap: !!u?.twoweap,
        skill_riding: p_skill_of(P_RIDING),
    });
}

// hitval() now lives in js/weapon.js (weapon.c:149) — complete, including
// the kebabable/trident/pick arms and the FULL oc_hitbon table (uhitm's local
// WEAP subset silently read 0 for every weapon outside its 21 entries).

// C ref: worn.c find_mac(mtmp).  Keep the C call site's local name while
// sharing the one authoritative worn-mask calculation.
function find_mac(mtmp) { return worn_find_mac(mtmp); }

// C ref: uhitm.c find_roll_to_hit(mtmp, aatyp, weapon, ...) — the "to hit"
// number; the swing connects when this exceeds the d20 dieroll.  Models the
// AT_WEAP path components present in the starter sessions (base, abon, AC,
// low-level/ vs-state adjustments, weapon hitval + skill bonus).  uhitinc and
// the Luck/encumbrance/utrap/polyd/orc terms are 0 for these heroes.
// C ref: mondata.h is_orc(ptr) / is_undead(ptr).
function is_orc(mdat) { return (mflags2_of(mdat) & M2_ORC) !== 0; }
function is_undead(mdat) { return (mflags2_of(mdat) & M2_UNDEAD) !== 0; }
// C ref: role.c Race_if(PM_ELF) — gu.urace is race index 1 in role.js races[].
function Race_if_ELF() {
    return game.initrace === 1 || game.urace?.adj === 'elven';
}
const PM_KNIGHT = 4;
function Role_if_KNIGHT() { return roleMnum() === PM_KNIGHT; }
function Role_if_SAMURAI() { return roleMnum() === PM_SAMURAI; }

// C ref: uhitm.c check_caitiff(mtmp) — a lawful Knight who strikes a helpless
// or fleeing foe, or a Samurai who strikes a peaceful one, loses an alignment
// point.  Called from find_roll_to_hit on the FIRST swing only.  Was entirely
// unported: adjalign() moves u.ualign.record, which is the MODULUS of
// peace_minded()'s rn2(16 + u.ualign.record) for every monster generated
// afterwards (the same mechanism killed() documents below).
export async function check_caitiff(mtmp) {
    const u = game.u;
    if ((u.ualign?.record ?? 0) <= -10) return;
    // C's pline() is update_topl(): the caitiff line OPENS the swing's topline
    // and the hit message appends to it ("You caitiff!  You hit it.").
    const { update_topl } = await import('./display.js');
    if (Role_if_KNIGHT() && (u.ualign?.type ?? 0) === A_LAWFUL
        && !is_undead(mtmp.data)
        && (helpless(mtmp) || (mtmp.mflee && !mtmp.mavenge))) {
        await update_topl('You caitiff!');
        adjalign(-1);
    } else if (Role_if_SAMURAI() && mtmp.mpeaceful) {
        await update_topl('You dishonorably attack the innocent!');
        adjalign(-1);
    }
}

async function find_roll_to_hit(mtmp, weapon, first_swing) {
    const u = game.u;
    // C: 1 + abon() + find_mac(mtmp) + u.uhitinc + Luck-term
    //    + maybe_polyd(youmonst.data->mlevel, u.ulevel).  A non-polymorphed hero
    //    contributes maybe_polyd == u.ulevel; the starter heroes are never polyd
    //    here.  The Luck adjustment sgn(Luck)*((|Luck|+2)/3) is 0 at Luck 0.
    const luck = u.uluck || 0;
    const luckTerm = Math.sign(luck) * Math.trunc((Math.abs(luck) + 2) / 3);
    let tmp = 1 + abon() + find_mac(mtmp) + (u.uhitinc || 0)
              + luckTerm + (u.ulevel || 1);

    // C ref: uhitm.c:379 — `if (!(*attk_count)++) check_caitiff(mtmp)`, i.e.
    // once per do_attack, on the first swing only.
    if (first_swing) await check_caitiff(mtmp);

    // vs. monster state.  C tests !mtmp->mcanmove, which is FALSE for a freshly
    // generated (awake, mobile) monster — makemon sets mcanmove TRUE.  JS leaves
    // it undefined until a monster first acts, so only an explicit 0 (paralyzed/
    // sleeping) should add the +4; undefined means "can move" (no bonus).
    if (mtmp.mstun) tmp += 2;
    if (mtmp.mflee) tmp += 2;
    if (mtmp.msleeping) tmp += 2;
    if (mtmp.mcanmove === 0) tmp += 4;
    // C ref: uhitm.c:396-401 — Monk role/race adjustments.  The armour penalty
    // arm (uarm -> -urole.spelarmr, 20 for the Monk) was omitted as "the starter
    // monk has no body armour"; a Monk who puts a suit on takes it, and the
    // bare-handed bonus additionally requires an empty SHIELD hand.
    if (Role_if_MONK()) {
        if (game.uarm) tmp -= MONK_SPELARMR;
        else if (!weapon && !game.uarms)
            tmp += Math.trunc((u.ulevel || 1) / 3) + 2;
    }
    // C ref: uhitm.c:402-404 — elves hit orcs more easily.  Elf heroes and orc
    // monsters are both common; the term was simply missing.
    if (is_orc(mtmp.data) && Race_if_ELF()) tmp++;

    // C ref: uhitm.c:406-410 — "with a lot of luggage, your agility diminishes"
    // and being stuck in a trap costs 3.  Both were omitted as unencumbered/
    // untrapped starter state.
    const wtcap = near_capacity();
    if (wtcap !== 0) tmp -= (wtcap * 2) - 1;
    if (u.utrap) tmp -= 3;

    // C ref: uhitm.c:417-421 — AT_WEAP/AT_CLAW: hitval only when a weapon is
    // actually wielded, but weapon_hit_bonus() always (it maps NULL to the
    // bare-handed/martial-arts discipline itself).
    if (weapon) tmp += hitval(weapon, mtmp);
    tmp += await weapon_hit_bonus(weapon);
    return tmp;
}
// C ref: role.c roles[PM_MONK].spelarmr — the Monk's body-armour spell/hit
// penalty.
const MONK_SPELARMR = 20;

// C ref: uhitm.c hitum(mon, uattk) — deliver a melee swing (and, when two-
// weaponing, a second swing with uswapwep).  Returns whether mon still lives.
async function hitum(mon) {
    const u = game.u;
    const x = u.ux + u.dx, y = u.uy + u.dy;
    const secondwep = u.twoweap ? game.uswapwep : null;
    // C ref: uhitm.c:775 — `gt.twohits = (uwep ? u.twoweap : double_punch())`.
    // The bare-handed arm was hardcoded FALSE; double_punch() rolls rn2(5) for
    // any hero whose bare-handed/martial-arts skill is above Basic, and on
    // success delivers a whole second swing (rnd(20) + hmon + passive).
    const twohits = (game.uwep ? !!u.twoweap : await double_punch());

    // ── first swing (uwep) ──
    let tmp = await find_roll_to_hit(mon, game.uwep, true);
    mon_maybe_unparalyze(mon);
    let dieroll = rnd(20);                     // uhitm.c:780
    let mhit = (tmp > dieroll);
    if (mhit) exercise(A_DEX, true);           // uhitm.c:783 (on hit only)
    let kh = await known_hitum(mon, game.uwep, mhit, dieroll);
    let malive = kh.malive;
    mhit = kh.mhit;
    // passive(mon, uwep, mhit, malive, AT_WEAP): the defender's passive counter
    // fires after every swing (even a miss) while the monster is alive.
    await passive(mon, game.uwep, mhit, malive, AT_WEAP);

    // ── second swing (uswapwep) for two-weapon combat ──
    if (twohits && malive && m_at(x, y) === mon) {
        tmp = await find_roll_to_hit(mon, game.uswapwep, false);
        mon_maybe_unparalyze(mon);
        dieroll = rnd(20);                     // uhitm.c:804
        mhit = (tmp > dieroll);
        // note: the second swing does NOT roll exercise(A_DEX) (uhitm.c).
        kh = await known_hitum(mon, secondwep, mhit, dieroll);
        malive = kh.malive;
        mhit = kh.mhit;
        // second passive counter-attack only occurs if the second swing hit.
        if (mhit) await passive(mon, secondwep, mhit, malive, AT_WEAP);
    }
    return malive;
}

// C ref: uhitm.c double_punch() — chance of a second bare-handed/martial-arts
// blow: 20% per skill level above Basic.  `skl_lvl > P_BASIC` short-circuits
// the rn2(5) away for every hero who has not enhanced the discipline, which is
// why the starter corpus never showed the roll.
async function double_punch() {
    const skl_lvl = await bare_handed_skill();
    if (!game.uwep && !game.uarms && skl_lvl > P_BASIC)
        return (skl_lvl - P_BASIC) > rn2(5);
    return false;
}

// C ref: uhitm.c known_hitum() — apply a swing's outcome.  Miss -> missum();
// hit -> hmon() (damage + possible kill).  C takes `int *mhit` and can turn a
// hit back into a miss, so this returns { malive, mhit } rather than a bare
// boolean.
async function known_hitum(mon, weapon, mhit, dieroll) {
    if (!mhit) {
        await missum(mon);
        return { malive: true, mhit };
    }
    // C ref: uhitm.c known_hitum():613-616 — KMH conduct: count a weapon-class
    // (or weapon-skilled tool) hit before the damage is applied.
    const u0 = game.u;
    if (!u0.uconduct) u0.uconduct = {};
    const oldweaphit = u0.uconduct.weaphit || 0;
    if (weapon && (weapon.oclass === WEAPON_CLASS || is_weptool(weapon)))
        u0.uconduct.weaphit = oldweaphit + 1;
    const oldhp = mon.mhp;
    const malive = await hmon(mon, weapon, dieroll);
    // C ref: uhitm.c known_hitum():624 — a monster that SURVIVES the hit has a
    // 1/25 chance to flee if reduced below half HP.  The rn2(25) gate fires for
    // every surviving hit; only on a 0 (and mhp < mhpmax/2) does monflee roll
    // its own rn2(3) duration (seed5002 step-242: rn2(25) after hitting the
    // small mimic).  The inline `mon.mflee = 1` this replaces skipped monflee's
    // mfleetim bookkeeping AND its unconditional mon_track_clear(), and the
    // breadcrumb ring gates m_move's rn2(4*(cnt-j)) backtrack roll — the same
    // mechanism documented on the local monflee() copy above.  fleemsg is TRUE
    // here, so the message ladder needs monmove.js's full copy.
    if (malive) {
        if (!rn2(25) && (mon.mhp < Math.trunc((mon.mhpmax ?? 0) / 2))
            && !engulfing_u(mon)) {
            const { monflee: monflee_full } = await import('./monmove.js');
            await monflee_full(mon, !rn2(3) ? rnd(100) : 0, false, true);
            // set_ustuck(0) needs sticks(youmonst.data)/u.ustuck == mon, which
            // no hero form in this port reaches.
        }
        // C ref: uhitm.c:634-639 — a hit that did NO damage (shade, worm tail,
        // Vorpal decapitation miss) is retroactively demoted to a miss, which
        // un-counts the weaphit conduct and suppresses the second swing's
        // passive() call in hitum().
        if (mon.mhp === oldhp) {
            mhit = false;
            game.u.uconduct.weaphit = oldweaphit;
        }
    }
    return { malive, mhit };
}

// C ref: uhitm.c missum() — the "You miss the <mon>." top-line message.
async function missum(mon) {
    const { update_topl } = await import('./display.js');
    if (canspotmon(mon))
        await update_topl(`You miss ${mon_nam(mon)}.`);
    else
        await update_topl('You miss it.');
    // C ref: uhitm.c:5212 missum() — `if (!helpless(mdef)) wakeup(mdef, TRUE);`,
    // and helpless(mon) is (msleeping || !mcanmove).  The via_attack half
    // (setmangry) was omitted, so a missed swing at a peaceful monster never
    // angered it.  The unconditional `msleeping = 0` that used to follow undid
    // the guard: a MISS does not wake a sleeper, which is why the bones ghost
    // is still "asleep" when the farlook that follows names it.
    if (!mon.msleeping && mon.mcanmove) await wakeupAttack(mon, true);
}

// C ref: uhitm.c hmon(mon, obj, thrown, dieroll) — the thin wrapper around
// hmon_hitmon().  Was collapsed into hmon_hitmon, which dropped an RNG call:
// hitting a priest rolls rn2(2) whether or not the ghod_hitsu() aftermath does
// anything.  (ghod_hitsu() itself needs in_rooms(TEMPLE), globally stubbed
// empty in this port, so it returns immediately; angry_guards() is RNG-free.)
async function hmon(mon, weapon, dieroll) {
    const result = await hmon_hitmon(mon, weapon, dieroll);
    if (mon.ispriest && !rn2(2)) {
        /* ghod_hitsu(mon): no-op without a TEMPLE room number */
    }
    return result;
}

// C ref: uhitm.c hmon_hitmon() — the weapon-melee damage path (the only
// branch the starter sessions reach: a wielded WEAPON_CLASS blade vs an
// ordinary monster).  Rolls dmgval(weapon, mon), applies STR/skill bonuses,
// subtracts from mon->mhp, and on a kill runs the xkilled() aftermath.
async function hmon_hitmon(mon, weapon, dieroll) {
    const unarmed = !weapon;
    let dmg;
    let potion_attack = false;
    // C ref: uhitm.c:1768 `hmd.use_weapon_skill = FALSE;` — set TRUE by the
    // ordinary-weapon and bare-handed arms only.
    let use_weapon_skill = false;
    if (weapon?.oclass === POTION_CLASS) {
        /* C's hmon_hitmon_do_hit() dispatches potion attacks through
           hmon_hitmon_potion(), which in turn calls potionhit() before the
           common damage/kill tail.  The live path below is an inlined version
           of that tail, so preserve the same hmd fields here. */
        const hmd = { hand_to_hand: true, thrown: HMON_MELEE,
                      doreturn: false, retval: true, hittxt: false,
                      mdat: mon.data, dmg: 1 };
        await hmon_hitmon_potion(hmd, mon, weapon);
        if (hmd.doreturn) return false;
        dmg = hmd.dmg ?? 1;
        potion_attack = true;
    } else if (unarmed) {
        // hmon_hitmon_barehands (uhitm.c:847): dmg = rnd(martial ? 4 : 2).
        dmg = rnd(martial_bonus() ? 4 : 2);
    } else if (weapon.oclass === WEAPON_CLASS || is_weptool(weapon)) {
        // hmon_hitmon_weapon_melee: dmg = dmgval(weapon, mon).
        dmg = dmgval(weapon, mon);
        use_weapon_skill = true;               // C ref: uhitm.c:943
        // C ref: uhitm.c:947-951 — a Healer's anatomy knowledge: a knife-skill
        // WEAPON_CLASS item in hand adds min(3, mvitals[species].died / 6).
        // The Healer starts with a scalpel, so this fires as soon as the same
        // species has been killed six times.
        if (roleMnum() === PM_HEALER && weapon.oclass === WEAPON_CLASS
            && (objects[weapon.otyp]?.oc_skill ?? 0) === P_KNIFE) {
            const died = game.mvitals?.[mon?.data?.pmidx]?.died ?? 0;
            dmg += Math.min(3, Math.trunc(died / 6));
        }
    } else {
        // C ref: uhitm.c hmon_hitmon_misc_obj() `default:` — wielding an
        // ordinary object still hurts, by its weight.  dmgval() returns 0 for
        // a non-weapon, so this path used to deal NO damage at all (a wielded
        // stethoscope could never kill anything).  The per-otyp special cases
        // (boulder, iron ball, potions, cream pie, corpses, ...) are not
        // reached by the covered sessions and are left to the default arm.
        dmg = hmon_misc_obj_dmg(weapon);
    }
    const train_weapon_skill = dmg > 1;   // uhitm.c:849 / :946

    // C ref: uhitm.c:1015 hmon_hitmon_do_hit() — `if (obj->oartifact
    // && artifact_hit(&youmonst, mon, obj, &hmd->dmg, hmd->dieroll))`.  Runs
    // AFTER the train_weapon_skill snapshot and BEFORE dmg_recalc's STR/skill
    // bonuses.  js/artifact.js was imported by nothing, so spec_dbon() never
    // ran: a PHYS(n,0) artifact (Grayswandir, Dragonbane, …) doubles the blow
    // and every artifact hit was landing for half of C's damage.
    if (weapon?.oartifact) {
        const { artifact_hit } = await import('./artifact.js');
        const mdmg = { d: dmg };
        const prevmsg = game._pending_message;
        const special = await artifact_hit(game.youmonst || game.u, mon,
                                           weapon, mdmg, dieroll);
        dmg = mdmg.d;
        if (game._pending_message && game._pending_message !== prevmsg) {
            const { update_topl } = await import('./display.js');
            const line = game._pending_message;
            game._pending_message = prevmsg;
            await update_topl(line);
        }
        if (special) {
            /* C: artifact killed the monster / beheading missed a headless one */
            if (DEADMONSTER(mon)) return false;
            if (dmg === 0) return true;
        }
    }


    // hmon_hitmon_dmg_recalc: strength + skill bonuses (get_dmg_bonus).  For a
    // two-weapon swing the STR bonus is scaled to 3/4; udaminc is 0 for the
    // starter hero.  weapon_dam_bonus is 0 at P_BASIC for a wielded weapon, and
    // the martial barehand branch for an unarmed monk/samurai.
    if (dmg > 0) {
        let strbonus = dbon();
        const absb = Math.abs(strbonus);
        if (game.u?.twoweap) {
            strbonus = Math.trunc((3 * absb + 2) / 4) * Math.sign(strbonus || 1);
            if (strbonus === 0 && dbon() !== 0) strbonus = 0;
        } else if (game.uwep && bimanual_wep(game.uwep)) {
            // C ref: uhitm.c:1467 — a melee hit with a TWO-HANDED weapon uses a
            // 3/2 strength bonus (to approximate a two-weapon double hit).
            // This arm was missing, so every two-handed-sword / battle-axe /
            // mattock wielder hit for less than C.
            strbonus = Math.trunc((3 * absb + 1) / 2) * Math.sign(strbonus || 1);
        }
        dmg += strbonus;
        // C ref: uhitm.c:1484-1489 — `if (use_weapon_skill) dmgbonus +=
        // weapon_dam_bonus(skillwep)`.  Only the bare-handed arm used to be
        // applied here, so a WIELDED weapon got no skill modifier at all: a
        // hero swinging something outside their role's skill table should take
        // -2, and a Skilled/Expert one +1/+2.
        if (unarmed) {
            dmg += await weapon_dam_bonus_barehand();
        } else if (use_weapon_skill) {
            dmg += await weapon_dam_bonus_wielded(weapon);
        }
        if (dmg < 1) dmg = 1;
    }

    // C ref: uhitm.c:1494 — a hit for more than minimal damage (measured BEFORE
    // the STR/skill bonuses above) trains the wielded weapon's skill; that
    // counter is what the wizard-mode #enhance menu prints.  train_weapon_skill
    // is set from the raw dmgval()/rnd() roll (uhitm.c:849, :946).
    if (train_weapon_skill) {
        const { use_skill, uwep_skill_type } = await import('./enhance.js');
        use_skill(uwep_skill_type(), 1);
    }

    // C ref uhitm.c:1825-1831 — the stagger/knockback gate, an if/else-if:
    //   unarmed && dmg>1 && !thrown && !obj && !Upolyd      -> hmon_hitmon_stagger
    //   !unarmed && dmg>1 && !thrown && !Upolyd && !twoweap && uwep -> maybe_knockback
    // (jousting omitted — no lance/steed here).  This is evaluated BEFORE the
    // mhp subtraction; stagger rolls rnd(100) immediately, knockback is deferred
    // until after a surviving hit (below).
    let maybe_knockback = false;
    if (unarmed && dmg > 1) {
        rnd(100);                              // hmon_hitmon_stagger (uhitm.c:1576)
    } else if (!unarmed && dmg > 1 && !game.u?.twoweap && game.uwep) {
        maybe_knockback = true;                // uhitm.c:1831
    }

    // C ref: uhitm.c:1841-1844 first_weapon_hit() — logged BEFORE the mhp
    // subtraction so a same-turn kill's "killed for the first time" gamelog
    // line always follows this one, never precedes it.  minimal_xname()-style
    // bare name (cursed prefix only; no BUC/erosion/enchant/call-name) mirrors
    // first_weapon_hit()'s own avoidance of xname()'s player-supplied name.
    // C ref: uhitm.c:1835-1843 — the conduct line only fires for a real weapon
    // or weptool (the same test that gates the weaphit++ in known_hitum); a
    // wielded stethoscope/tool must not log it.
    if (!unarmed && (weapon.oclass === WEAPON_CLASS || is_weptool(weapon))
        && dmg > 0 && (game.u?.uconduct?.weaphit ?? 0) <= 1) {
        const buf = (weapon.cursed && weapon.bknown ? 'cursed ' : '')
            + objectBaseName(weapon);
        livelog_printf(LL_CONDUCT,
            `hit with a wielded weapon (${buf}) for the first time`);
    }

    mon.mhp = (mon.mhp || 0) - dmg;
    if (mon.mhpmax != null && mon.mhp > mon.mhpmax) mon.mhp = mon.mhpmax;
    const destroyed = (mon.mhp <= 0 || DEADMONSTER(mon));

    // C ref: uhitm.c:1866 hmon_hitmon_pet() — runs BEFORE killed(), so abusing
    // a pet counts even on the blow that kills it.  Both halves draw: abuse_dog
    // rolls rn2(mtame) to pick yelp vs growl, and a surviving pet's monflee
    // rolls rnd(dmg).  (hmon_hitmon_splitmon() next needs clone_mon() for the
    // black/brown pudding iron-weapon split; still unported.)
    await hmon_hitmon_pet(mon, dmg, destroyed);

    if (destroyed) {
        // hmon_hitmon_msg_hit is suppressed once destroyed; killed() gives the
        // "You kill the <mon>!" message and runs the corpse/treasure aftermath.
        await killed(mon);
        return false;
    }

    // C ref: uhitm.c:1644 hmon_hitmon_msg_hit() — the surviving hand-to-hand
    // hit message.  When flags.verbose is OFF the terse "You hit it." is used
    // UNCONDITIONALLY (regardless of whether the monster is spotted); only in
    // verbose mode does it name the monster.  (seed4500 sets `!verbose` in its
    // nethackrc, so an adjacent, fully-visible earth elemental still prints
    // "You hit it.")
    if (!potion_attack) {
        const { update_topl } = await import('./display.js');
        const verbose = game.flags?.verbose !== false;
        const exclamU = (f) => (f < 0 ? '?' : (f <= 4 ? '.' : '!'));
        if (!verbose)
            await update_topl('You hit it.');
        else if (canspotmon(mon))
            await update_topl(`You ${hit_verb(weapon)} ${mon_nam(mon)}${canseemon(mon) ? exclamU(dmg) : '.'}`);
        else
            await update_topl('You hit it.');
    }
    // C ref: uhitm.c:1925 — `wakeup(mon, TRUE)` for a surviving, on-map hit.
    // This was reduced to a bare `msleeping = 0`, which dropped the via_attack
    // half: landing a HIT on a peaceful monster never angered it (only a miss
    // did, through missum()), so it kept its mpeaceful AI and its peaceful
    // dochug branch for the rest of the fight.
    await wakeupAttack(mon, true);

    // C ref uhitm.c:1922-1931 — wakeup(mon) then, for a surviving armed hit,
    // mhitm_knockback(&youmonst, mon, ...).  Its leading rolls always fire:
    //   knockdistance = rn2(3)        (uhitm.c:5258)
    //   if (rn2(chance)) return FALSE  (uhitm.c:5269, chance==6, no ogresmasher)
    // The contest hits all take the 5/6 "no knockback" branch, so the later
    // size/solidity gates draw nothing.  (seed5002 step-242: hero hits the
    // small mimic — the rn2(6) chance roll must follow the rn2(3) knockdistance.)
    if (maybe_knockback) {
        rn2(3);                                // knockdistance (uhitm.c:5258)
        rn2(6);                                // chance         (uhitm.c:5269)
    }
    return true;
}

// C ref: uhitm.c hmon_hitmon_pet() — the hero struck a pet.
async function hmon_hitmon_pet(mon, dmg, destroyed) {
    if (!mon.mtame || dmg <= 0) return;
    await abuse_dog(mon);
    if (mon.mtame && !destroyed) {
        const { monflee: monflee_full } = await import('./monmove.js');
        await monflee_full(mon, 10 * rnd(dmg), false, false);
    }
}

// C ref: dog.c abuse_dog(mtmp) — reduce tameness.  The yelp/growl choice draws
// rn2(mtame) (short-circuited away once mtame reaches 0); both sounds are
// RNG-free, and growl() is deliberately silent in this port (see wakeupAttack).
export async function abuse_dog(mtmp) {
    if (!mtmp.mtame) return;
    // Aggravate_monster/Conflict (the mtame/=2 arm) aren't modelled here.
    mtmp.mtame--;
    if (mtmp.mtame && !mtmp.isminion && mtmp.edog)
        mtmp.edog.abuse = (mtmp.edog.abuse || 0) + 1;
    // m_unleash() needs a leash, which this port never creates.
    if (mtmp.mx !== 0) {
        // Both sounds DRAW while hallucinating (ROLL_FROM(h_sounds) == rn2(35)),
        // and both wake_nearto(), which suppresses the woken sleepers' disturb()
        // rolls next turn — so neither can be stubbed out.
        const { yelp, growl } = await import('./sounds.js');
        if (mtmp.mtame && rn2(mtmp.mtame)) await yelp(mtmp);
        else await growl(mtmp);
        if (!mtmp.mtame) newsym(mtmp.mx, mtmp.my);
    }
}

// C ref: uhitm.c passive(mon, weapon, mhit, malive, aatyp, wep_was_destroyed) —
// the defender's passive counter-attack.  Walks mattk[] to the AT_NONE slot,
// then rolls its damage dice UNCONDITIONALLY (before either switch, and even if
// the monster just died).
//
// The old body only kept the trailing `rn2(3)` on the grounds that the starter
// victims' passive slot is damn==damd==0.  Every acid blob (1d8), jelly, mold
// and floating eye (d(m_lev+1, damd)) has a real one, and those are among the
// first monsters any hero meets: each swing at a blue jelly draws five rolls
// here that this port was not making.
export async function passive(mon, weapon, mhit, malive, aatyp) {
    const ptr = mon.data;
    const attacks = mattk_of(ptr);
    const NATTK = 6;
    // C: mattk[] is a zero-filled fixed array, so a species whose table is
    // shorter than NATTK has {AT_NONE, AD_PHYS, 0, 0} in the missing slots.
    let slot = null;
    for (let i = 0; i < NATTK; i++) {
        const a = attacks[i];
        if (!a) { slot = { aatyp: AT_NONE, adtyp: AD_PHYS, damn: 0, damd: 0 }; break; }
        if (a.aatyp === AT_NONE) { slot = a; break; }
    }
    if (!slot) return;                         // no passive attacks

    let tmp;
    if (slot.damn) tmp = d(slot.damn, slot.damd);
    else if (slot.damd) tmp = d((mon.m_lev ?? ptr?.mlevel ?? 0) + 1, slot.damd);
    else tmp = 0;

    // ── these affect you even if the monster just died (uhitm.c:5900) ──
    const obj_attack = (aatyp === AT_WEAP || aatyp === AT_CLAW
                        || aatyp === AT_MAGC || aatyp === AT_TUCH);
    switch (slot.adtyp) {
    case AD_FIRE:
        if (mhit && !mon.mcan && weapon && obj_attack)
            await passive_obj(mon, weapon, slot);
        break;
    case AD_ACID:
        if (mhit && rn2(2)) {
            const { pline } = await import('./display.js');
            if (Blind() || game.flags?.verbose === false)
                await pline('You are splashed!');
            else
                await pline(`You are splashed by ${s_suffix(mon_nam(mon))} acid!`);
            if (!Acid_resistance()) await mdamageu(mon, tmp);
            if (!rn2(30)) await erode_armor(ERODE_CORRODE);
        }
        if (mhit && weapon && obj_attack) await passive_obj(mon, weapon, slot);
        exercise(A_STR, false);                // rolls rn2(2)
        break;
    case AD_RUST:
    case AD_CORR:
        if (mhit && !mon.mcan && weapon && obj_attack)
            await passive_obj(mon, weapon, slot);
        break;
    case AD_MAGM:
        // "wrath of gods for attacking Oracle"; no Antimagic hero here.
        {
            const { pline } = await import('./display.js');
            await pline('You are hit by magic missiles appearing from thin air!');
            await mdamageu(mon, tmp);
        }
        break;
    case AD_ENCH:
        if (mhit) {
            // C skips object-less attack types; AT_WEAP/AT_CLAW/AT_TUCH/AT_MAGC
            // all fall through to passive_obj.
            if (aatyp === AT_KICK && !weapon) break;
            if (aatyp === AT_BITE || aatyp === AT_BUTT
                || (aatyp >= AT_STNG && aatyp < AT_WEAP)) break;
            await passive_obj(mon, weapon, slot);
        }
        break;
    default:
        break;
    }

    // ── these only affect you if the monster still lives (uhitm.c:6019) ──
    if (malive && !mon.mcan && rn2(3)) {
        switch (slot.adtyp) {
        case AD_COLD:                          // brown mold or blue jelly
            if (monnear(mon, game.u.ux, game.u.uy)) {
                const { pline } = await import('./display.js');
                if (Cold_resistance()) {
                    await pline('You feel a mild chill.');
                    break;
                }
                await pline('You are suddenly very cold!');
                await mdamageu(mon, tmp);
                /* monster gets stronger with your heat! */
                healmon(mon, Math.trunc((tmp + rn2(2)) / 2), Math.trunc((tmp + 1) / 2));
                // split_mon() past 8*(m_lev+1) max HP is not modelled.
            }
            break;
        case AD_STUN:                          // specifically yellow mold
            // C ref: uhitm.c:6085 `if (!Stunned) make_stunned((long) tmp, TRUE)`.
            // The timer IS materialised — u.uprops.Stun is timeout.js's STUNNED
            // entry, and cmd.js b_trapped() already writes it the same way.
            // Draws no RNG itself, but it makes u_maybe_impaired() true, so
            // every later move runs impaired_movement()'s confdir() rn2(8)
            // redirect (elf-wiz step 282) and the botl gains " Stun".
            {
                const u = game.u;
                if (u && !((u.uprops?.Stun || 0) > 0)) {
                    u.uprops = u.uprops || {};
                    u.uprops.Stun = tmp;
                    // update_topl, not pline: C's You() lands on the SAME
                    // topline as the "You miss the yellow mold." that the same
                    // command already printed ("... mold.  You stagger...").
                    const { update_topl } = await import('./display.js');
                    await update_topl('You stagger...');
                    game.botl = true;
                }
            }
            break;
        case AD_FIRE:
            if (monnear(mon, game.u.ux, game.u.uy)) {
                const { pline } = await import('./display.js');
                await pline('You are suddenly very hot!');
                await mdamageu(mon, tmp);
            }
            break;
        case AD_ELEC:
            {
                const { pline } = await import('./display.js');
                await pline('You are jolted with electricity!');
                await mdamageu(mon, tmp);
            }
            break;
        case AD_PLYS: {
            // C ref: uhitm.c:6023-6098.  ureflects()/Hallucination/Free_action
            // are all FALSE for the heroes this port models, so the floating
            // eye takes the "frozen by its gaze" arm — including the
            // short-circuiting `(ACURR(A_WIS) > 12 || rn2(4))`, which only
            // draws when Wisdom is 12 or less.
            const { pline } = await import('./display.js');
            const { nomul } = await import('./hack.js');
            if (ptr?.pmidx === PM_FLOATING_EYE) {
                if (!canseemon(mon)) break;
                if (mon.mcansee !== 0) {
                    await pline(`You are frozen by ${s_suffix(mon_nam(mon))} gaze!`);
                    nomul((ACURR(A_WIS) > 12 || rn2(4)) ? -tmp : -127);
                    game.nomovemsg = 0;
                } else {
                    await pline(`The blind ${mon.data?.name || 'monster'} cannot defend itself.`);
                    if (!rn2(500)) change_luck(-1);
                }
            } else {                            /* gelatinous cube */
                await pline(`You are frozen by ${mon_nam(mon)}!`);
                game.nomovemsg = 'You can move again.';
                nomul(-tmp);
                exercise(A_DEX, false);         // rolls rn2(2)
            }
            break;
        }
        default:
            break;
        }
    }
}

// C ref: uhitm.c passive_obj(mon, obj, mattk) — the passive attack's effect on
// the striking object.
async function passive_obj(mon, obj, mattk) {
    if (!obj) return;
    switch (mattk.adtyp) {
    case AD_FIRE:
        if (!rn2(6) && !mon.mcan) await erode_obj_local(obj, ERODE_BURN);
        break;
    case AD_ACID:
        if (!rn2(6)) await erode_obj_local(obj, ERODE_CORRODE);
        break;
    case AD_RUST:
        if (!mon.mcan) await erode_obj_local(obj, ERODE_RUST);
        break;
    case AD_CORR:
        if (!mon.mcan) await erode_obj_local(obj, ERODE_CORRODE);
        break;
    default:
        break;
    }
}

async function erode_obj_local(obj, type) {
    const { erode_obj } = await import('./trap.js');
    return await erode_obj(obj, null, type, EF_NONE);
}

// C ref: uhitm.c erode_armor(&youmonst, hurt) — pick a random armour slot to
// erode, RETRYING (another rn2(5)) whenever the chosen slot is empty or
// un-erodable.  Only case 1 (cloak/suit/shirt) always terminates the loop, so
// an unarmoured hero burns a variable number of rn2(5) draws here.
async function erode_armor(hurt) {
    for (let guard = 0; guard < 1000; guard++) {
        const roll = rn2(5);
        if (roll === 1) {
            const target = game.uarmc || game.uarm || game.uarmu;
            if (target) await erode_obj_local2(target, hurt);
            return;
        }
        const target = roll === 0 ? game.uarmh
            : roll === 2 ? game.uarms
            : roll === 3 ? game.uarmg
            : game.uarmf;
        if (!target) continue;
        const { erode_obj } = await import('./trap.js');
        const res = await erode_obj(target, null, hurt, EF_GREASE);
        if (res === 0 /* ER_NOTHING */) continue;
        return;
    }
}
async function erode_obj_local2(obj, hurt) {
    const { erode_obj } = await import('./trap.js');
    return await erode_obj(obj, null, hurt, EF_GREASE);
}

// C ref: potion.c Acid_resistance / Cold_resistance intrinsic tests.
function Acid_resistance() { return (game.u?.uprops?.AcidResistance || 0) > 0; }
function Cold_resistance() { return (game.u?.uprops?.ColdResistance || 0) > 0; }

// C ref: makemon.js MONS_NAMES index of the floating eye.
const PM_FLOATING_EYE = 28;

// C ref: rnd.c change_luck(n) — clamped to [LUCKMIN, LUCKMAX].  pray.js keeps
// a file-static copy; Luck feeds find_roll_to_hit's sgn(Luck) term above.
function change_luck(n) {
    const u = game.u;
    u.uluck = (u.uluck || 0) + n;
    if (u.uluck < -10) u.uluck = -10;
    if (u.uluck > 10) u.uluck = 10;
}

// C ref: mon.c monnear(mon, x, y) — dist2 < 3 (orthogonally/diagonally next to).
function monnear(mon, x, y) {
    const dx = mon.mx - x, dy = mon.my - y;
    return (dx * dx + dy * dy) < 3;
}

// C ref: objnam.c s_suffix(s).
function s_suffix(s) { return /s$/.test(s) ? `${s}'` : `${s}'s`; }

// C ref: mhitu.c mdamageu(mtmp, n) — subtract n HP from the hero (monmove.js
// keeps the same body for the monster-hits-hero path; it is file-static there).
async function mdamageu(mtmp, n) {
    const u = game.u;
    if (n < 0) n = 0;
    u.uhp -= n;
    if (u.uhp > u.uhpmax) u.uhp = u.uhpmax;
    game.disp = game.disp || {};
    game.disp.botl = true;
    if (u.uhp < 1) {
        const { done_in_by } = await import('./end.js');
        await done_in_by(mtmp, 0 /* DIED */);
    }
}

// C ref: mon.c:3438 unstuck(mtmp) — the monster is no longer holding the hero.
// The rnd(2) fires only for a species that can hold (AD_STCK / AT_ENGL /
// AT_HUGS) and only if mspec_used is still 0.
function unstuck_mon(mtmp) {
    const u = game.u;
    if (u.ustuck !== mtmp) return;
    u.ustuck = null;
    u.uswallow = 0;
    // The swallowed branch (repositioning the hero + docrt) needs an engulfer.
    unstuck_mspec_used(mtmp);
}
// C ref: mon.c:3462-3466 — the tail of unstuck(); split out so mhitu.c's
// expels() (which does its own set_ustuck/docrt) can draw the same rnd(2).
export function unstuck_mspec_used(mtmp) {
    if (!mtmp.mspec_used
        && (dmgtype(mtmp.data, AD_STCK) || attacktype(mtmp.data, AT_ENGL)
            || attacktype(mtmp.data, AT_HUGS)))
        mtmp.mspec_used = rnd(2);                            // mon.c:3465
}

// ── kill aftermath: killed -> xkilled -> mondead + make_corpse ──
// C ref: mon.c killed()/xkilled().  Emits "You kill the <mon>!", rolls the
// treasure-drop gate rn2(6), removes the monster, and (corpse_chance rn2(2))
// drops a corpse via make_corpse() -> mkcorpstat() -> mksobj() (which rolls the
// corpse's next_ident, rndmonnum reservoir scan, and gender rn2(2)).
// `opts` mirrors C's xkill_flags: { nomsg } suppresses the "You kill/destroy"
// line, { nocorpse } skips the WHOLE treasure-drop+corpse_chance block (C:
// xkilled() goto's straight to cleanup on XKILL_NOCORPSE, before the rn2(6)
// treasure roll).  Both default off, matching every existing melee call site.
export async function killed(mon, opts) {
    const nomsg = !!opts?.nomsg;
    const skipCorpseBlock = !!opts?.nocorpse;
    const { update_topl } = await import('./display.js');
    const x = mon.mx, y = mon.my;
    mon.mhp = 0;

    // C ref: mon.c xkilled() — "if (!u.uconduct.killer++) livelog_printf(...)".
    // No RNG.
    {
        const u = game.u;
        if (!u.uconduct) u.uconduct = {};
        if (!u.uconduct.killer)
            livelog_printf(LL_CONDUCT, 'killed for the first time');
        u.uconduct.killer = (u.uconduct.killer || 0) + 1;
    }
    if (!nomsg) {
        // C ref: mon.c xkilled():3506 — a TAME victim is named through
        // x_monnam(..., "poor", ...) ("You kill the poor kitten!"), and a pet
        // with a given name drops the article instead.  Hallucination hides the
        // given name, so namedpet is gated on it.  The extra five characters
        // are load-bearing: they push the topline over 80 columns and move the
        // --More-- boundary (seed0383 step 178).
        const namedpet = !!(mon?.mgivenname || mon?.mextra?.mgivenname)
            && !game.u?.uhallu;
        const wasinside = !!(game.u?.uswallow && game.u?.ustuck === mon);
        const who = !(wasinside || canspotmon(mon)) ? 'it'
            : !mon.mtame ? mon_nam(mon)
              : x_monnam(mon, namedpet ? 0 /*ARTICLE_NONE*/ : 1 /*ARTICLE_THE*/,
                         'poor', namedpet ? SUPPRESS_SADDLE : 0, false);
        await update_topl(`You ${nonliving(mon) ? 'destroy' : 'kill'} ${who}!`);
    }

    // C ref: mon.c:3438 unstuck(mtmp), reached via mondead -> m_detach ->
    // mon_leaving_level (mon.c:2703).  A holder the hero kills gets
    // mspec_used = rnd(2) so it can't immediately re-grab; that rnd(2) is a
    // real draw in the kill turn.
    unstuck_mon(mon);

    // C ref: mon.c:3170 mondead() — `if (glyph_is_invisible(levl[mx][my].glyph))
    // unmap_object(mx, my)` runs just before m_detach.  Killing a monster the
    // hero can only sense (blind / invisible) must drop the remembered 'I';
    // m_detach -> mon_leaving_level's newsym() then repaints the real square.
    if (game.level?.at(x, y)?.invisMon) unmap_object(x, y);

    // mondead(): detach the monster from the level BEFORE the once-per-turn
    // mcalcmove realloc (allmain.js) so that loop iterates the post-kill set,
    // matching C (fmon has the dead monster purged by the next round).
    mvitals_died(mon);                 // mon.c:3135
    const list = game.level?.monsters;
    if (list) {
        const idx = list.indexOf(mon);
        if (idx >= 0) list.splice(idx, 1);
    }

    // C ref: mon.c m_detach() -> relobj(mtmp, 1, FALSE) — when a monster dies it
    // drops everything in mtmp->minvent onto the map at mx,my (consumes no RNG).
    // A killed kobold/orc/gnome leaves its starting darts/weapon on the floor,
    // which then renders as a ')' object glyph at the kill location.
    relobj(mon, x, y);

    if (!skipCorpseBlock) {
        // illogical-but-traditional treasure drop gate (mon.c:3587).  C also
        // gates on !(mvitals[mndx].mvflags & G_NOCORPSE): a G_NOCORPSE species
        // (grid bug, gas spore, …) never drops the extra item.  The rn2(6)
        // still rolls first.
        const mndx0 = mon.data?.pmidx;
        const gNoCorpse = (mndx0 != null) ? mon_nocorpse(mndx0) : false;
        let dropTreasure = false;
        if (!rn2(6) && !gNoCorpse && (x !== game.u.ux || y !== game.u.uy)) {
            dropTreasure = true;          // mdat->mlet S_KOP / mcloned excluded
        }

        // corpse_chance(mon): mon.c:3248 rn2(2 + (G_FREQ<2) + verysmall).
        // C ref: mon.c:3583 `if (accessible(x, y) || is_pool(x, y))` — a kill
        // over WATER still leaves a corpse (it floats); only the pool half was
        // missing, so a monster killed on the Medusa level's water dropped
        // nothing and skipped make_corpse's mkobj/next_ident draws.
        const { is_pool } = await import('./dbridge.js');
        const accessible = (() => {
            const t = game.level?.at(x, y)?.typ;
            return (t != null && ACCESSIBLE(t)) || is_pool(x, y);
        })();
        if (dropTreasure) {
            // mkobj(RANDOM_CLASS, TRUE): the item's own rolls (class, type,
            // enchant, erosion, …) always fire before its fate is decided.
            const otmp = mkobj(0 /*RANDOM_CLASS*/, true);
            const otyp = otmp.otyp;
            // C ref: mon.c:3600 xkilled() — "don't create large objects from
            // small monsters": mdat->msize < MZ_HUMAN && otyp != FIGURINE &&
            // (owt>30 || oc_big) routes to delobj() instead of placing it.
            // (The objects[] table here doesn't carry oc_big, so only the
            // weight leg of that OR is checked — every otyp big enough to
            // matter is also over the 30-unit threshold.)  delobj_core()
            // always rolls obj_resists(obj,0,0)'s rn2(100) (the Amulet/
            // invocation-tool guard) even though an ordinary item never
            // resists — skipping that roll (as a bare place always would)
            // desyncs every RNG draw after it, including corpse_chance() below.
            // C ref: mon.c:3597 — the FOOD_CLASS arm comes FIRST: newly created
            // permafood is destroyed unless the killed monster collects food
            // (M2_COLLECT).  Omitting it left the food on the floor AND skipped
            // delobj()'s obj_resists() rn2(100), desyncing everything after.
            const isFoodDrop = otmp.oclass === FOOD_CLASS
                && !(mflags2_of(mon.data) & M2_COLLECT) && !otmp.oartifact;
            if (isFoodDrop) {
                const { delobj } = await import('./invent.js');
                delobj(otmp);
            } else if ((mon.data?.msize ?? 2 /* MZ_HUMAN */) < 2 && otyp !== FIGURINE
                && (otmp.owt || 0) > 30) {
                const { delobj } = await import('./invent.js');
                delobj(otmp);
            } else {
                place_object(otmp, x, y);
            }
        }
        // C ref: mon.c:3199-3236 corpse_chance() — the AT_BOOM arm comes BEFORE
        // the ordinary rn2: a gas spore rolls its blast damage d(damn,damd),
        // detonates (mon_explodes -> explode(), another d() plus the per-target
        // destroy_items/resist draws) and leaves no corpse.  It sits in this
        // caller rather than corpse_chance() itself because mon_explodes is
        // async and corpse_chance's other callers are not.
        let leaves_corpse;
        {
            const { mattk_list } = await import('./mhitm.js');
            const { AT_BOOM } = await import('./monattk_data.js');
            const boom = mattk_list(mon).find((a) => a[0] === AT_BOOM);
            if (boom) {
                // C ref: mon.c:3203 — corpse_chance() rolls the blast damage
                // into a local `tmp` that only the swallowed-exploder arm uses,
                // and mon_explodes() then rolls its OWN d(damn,damd).  Two
                // separate draws off the same dice; dropping either desyncs.
                if (boom[2]) d(boom[2], boom[3]);
                else if (boom[3]) d((mon.data?.mlevel | 0) + 1, boom[3]);
                const { mon_explodes } = await import('./explode.js');
                await mon_explodes(mon, boom);
                leaves_corpse = false;
            } else {
                leaves_corpse = corpse_chance(mon);
            }
        }
        if (leaves_corpse && accessible) {
            make_corpse(mon, x, y);
        }
    }

    // C ref: mon.c:3638 xkilled() "Punish bad behavior", between the corpse
    // block and the experience award.  The `(mpeaceful && !rn2(2)) || mtame`
    // luck penalty DRAWS whenever the victim was peaceful — a pet is peaceful
    // too, so killing your own dog rolls it (seed0383 step 178).
    {
        const mdat0 = mon.data;
        const alignType = game.u?.ualign?.type ?? 0;
        const A_CHAOTIC = -1;
        // mondata.h is_human(ptr) == (mflags2 & M2_HUMAN);
        // always_hostile(ptr) == (mflags2 & M2_HOSTILE).
        const f2_0 = mflags2_of(mdat0);
        if ((f2_0 & M2_HUMAN) && !(f2_0 & M2_HOSTILE) && (mon.malign | 0) <= 0
            && alignType !== A_CHAOTIC) {
            change_luck(-2);
            await update_topl('You murderer!');
        }
        if ((mon.mpeaceful && !rn2(2)) || mon.mtame)      // mon.c:3664
            change_luck(-1);
        const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
        const S_UNICORN = 21;   // monsym.h (mons[].mcls for the unicorn class)
        if (mdat0?.mcls === S_UNICORN
            && sgn(alignType) === sgn(mdat0?.maligntyp | 0))
            change_luck(-5);
    }

    // C ref: mon.c xkilled() — give experience points (no RNG).  experience()
    // bumps u.uexp via more_experienced(); newexplevel() may level the hero up.
    // Without this the status line's Xp:lvl/exp field stayed at the pre-kill
    // value, so every post-kill screen mismatched on that one stat cell.
    more_experienced(experience(mon), 0);
    await newexplevel();

    // C ref: mon.c xkilled() "adjust alignment points" — runs right after the
    // experience award, consumes no RNG.  The quest-leader / MS_NEMESIS /
    // MS_GUARDIAN arms need a quest monster and aren't reachable from a melee
    // kill in this corpus; the peaceful/tame/priest ones and the unconditional
    // adjalign(mtmp->malign) are.  Skipping this left u.ualign.record frozen at
    // gu.urole.initrecord, which chooses the wrong MODULUS in peace_minded()'s
    // rn2(16 + u.ualign.record) for every monster generated afterwards.
    {
        const { adjalign, ALIGNLIM } = await import('./attrib.js');
        const { p_coaligned } = await import('./priest.js');
        if (mon.ispriest) {
            const co = p_coaligned(mon);
            adjalign(co ? -2 : 2);
            if (co) game.u.ublessed = 0;
            if ((mon.data?.maligntyp ?? 0) === -128 /* A_NONE */)
                adjalign(Math.trunc(ALIGNLIM() / 4));
        } else if (mon.mtame) {
            adjalign(-15);
            // C ref: mon.c xkilled():3705 — "your god is mighty displeased".
            // Killing a pet always sounds off, and the hallucinatory variant is
            // the longer of the two, which is what pushes the topline past 80
            // columns and forces the --More-- (seed0383 step 178).
            await update_topl(game.u?.uhallu
                ? 'You hear the studio audience applaud!'
                : 'You hear the rumble of distant thunder...');
        } else if (mon.mpeaceful) {
            adjalign(-5);
        }
        adjalign(mon.malign | 0);
    }

    if (x > 0 && y > 0) newsym(x, y);
}

// C ref: steal.c relobj(mtmp, 1, FALSE) via mdrop_obj() — drop every object in
// the dead monster's minvent onto the map at (x,y).  No RNG.  flooreffects()
// (water/trap interactions) is not reachable for the modelled corridor/room
// kills, so each object is simply placed and stacked with any matching floor
// stack at the same cell (NetHack merges same-type drops via stackobj()).
export function relobj(mon, x, y) {
    const inv = mon?.minvent;
    // C ref: steal.c relobj() tail — `if (show && cansee(omx, omy)) newsym(omx, omy);`
    // fires even for an EMPTY minvent (m_detach always passes show=1), which is
    // what erases the dead monster's glyph.  Returning early on an empty
    // inventory left a killed gas spore (no corpse, no gear) drawn on the map.
    const repaint = () => { if (x > 0 && y >= 0) newsym(x, y); };
    if (!inv || !inv.length) { repaint(); return; }
    const objs = (game.level && (game.level.objects || (game.level.objects = []))) || null;
    if (!objs) { repaint(); return; }
    // C ref: steal.c relobj() walks mon->minvent front-to-back but each
    // mdrop_obj() pushes onto the head of the floor pile, so the resulting
    // nexthere order is REVERSED relative to minvent.
    for (const otmp of [...inv].reverse()) {
        // C ref: worn.c extract_from_minvent().  An object stops being worn
        // before it reaches the floor; otherwise a pet which later picks it
        // up incorrectly treats it as undroppable armour.
        const unwornmask = otmp.owornmask | 0;
        otmp.owornmask = 0;
        if (unwornmask) {
            mon.misc_worn_check = ((mon.misc_worn_check | 0) & ~unwornmask) | I_SPECIAL;
            if (otmp === mon.mw) mon.mw = null;
        }
        // mdrop_obj -> place_object + stackobj.  Merge into an existing floor
        // stack of the same otyp/spe so quantities combine like C stackobj().
        let merged = false;
        for (const f of objs) {
            if (f.where === 'floor' && f.ox === x && f.oy === y
                && f.otyp === otmp.otyp && (f.spe || 0) === (otmp.spe || 0)
                && f.otyp !== CORPSE) {
                f.quan = (f.quan || 1) + (otmp.quan || 1);
                merged = true;
                break;
            }
        }
        if (!merged) place_object(otmp, x, y);
    }
    mon.minvent = [];
    repaint();
}

// C ref: monsters.h LVL() mmove, keyed by pmidx.  mon.js owns the audited copy
// (MMOVE_BY_PMIDX); re-exported there rather than duplicated here.
function species_mmove(data) { return mmove_of(data); }

// C ref: exper.c experience(mtmp, nk) — the XP value of a slain monster.  No
// RNG.  Iterates the monster's actual mattk[] list for the special attack-type
// and damage-type experience bonuses.
function experience(mtmp) {
    const NORMAL_SPEED_C = 12;
    const data = mtmp.data || {};
    const m_lev = mtmp.m_lev ?? data.mlevel ?? 0;
    let tmp = 1 + m_lev * m_lev;

    // higher-AC bonus: tmp += (7 - ac) * (ac<0 ? 2 : 1) when ac < 3.
    const i = find_mac(mtmp);
    if (i < 3) tmp += (7 - i) * ((i < 0) ? 2 : 1);

    // ptr->mmove — the SPECIES speed, not the monster's adjusted movement.
    // MONS[] carries no mmove field, so `data.mmove ?? 0` silently dropped this
    // bonus for every fast monster (a fox is 1 XP instead of 4).
    const mmove = species_mmove(data);
    if (mmove > NORMAL_SPEED_C)
        tmp += (mmove > (3 * NORMAL_SPEED_C / 2)) ? 5 : 3;

    const attacks = mattk_of(data);

    // special attack-type bonus (exper.c:101).  AT_WEAP -> +5; AT_MAGC -> +10;
    // other types > AT_BUTT -> +3.  Ordinary AT_BITE/AT_CLAW add nothing.
    for (const a of attacks) {
        const t = a.aatyp;
        if (t > AT_BUTT) {
            if (t === AT_WEAP) tmp += 5;
            else if (t === AT_MAGC) tmp += 10;
            else tmp += 3;
        }
    }

    // special damage-type bonus (exper.c:113).
    for (const a of attacks) {
        const t2 = a.adtyp;
        if (t2 > AD_PHYS && t2 < AD_BLND) tmp += 2 * m_lev;
        else if (t2 === AD_DRLI || t2 === AD_STON || t2 === AD_SLIM) tmp += 50;
        else if (t2 !== AD_PHYS) tmp += m_lev;
        if (a.damd * a.damn > 23) tmp += m_lev; // extra heavy-damage bonus
        // AD_WRAP/S_EEL term not reachable for these monsters.
    }

    // extra_nasty(ptr) == (mflags2 & M2_NASTY) (mondata.h:120) — was missing
    // entirely, so every M2_NASTY kill was short 7*m_lev XP.
    if ((mflags2_of(data) & M2_NASTY) !== 0) tmp += 7 * m_lev;

    if (m_lev > 8) tmp += 50;
    // mrevived/mcloned halving and the PM_MAIL_DAEMON tmp=1 override are below
    // this in C; neither state is reachable for a hero kill in these sessions.
    return tmp;
}

// C ref: mon.c corpse_chance(mon).  bigmonst/lizard (uncloned), golem, mplayer,
// rider, shk all GUARANTEE a corpse and return TRUE with NO rn2 roll (mon.c:
// 3246); only the ordinary case rolls rn2(2 + (G_FREQ<2) + verysmall).  Missing
// the guaranteed-corpse short-circuit made JS roll an extra rn2 when killing a
// big monster (seed4500 step-269: the MZ_HUGE earth elemental).  (The lich/Vlad
// crumble, gas-spore AT_BOOM explosion, and LEVEL_SPECIFIC_NOCORPSE special
// cases that precede this in C are not exercised by the corpse_chance kills in
// the sessions and are intentionally not modeled here.)
export function corpse_chance(mon) {
    const mdat = mon.data || {};
    const bigOrLizard = (largemonst(mdat) || mdat.name === 'lizard') && !mon.mcloned;
    const golem = /\bgolem$/.test(mdat.name || '');
    if (bigOrLizard || golem || mon.isshk) return true; // guaranteed, no roll
    const geno = mdat.geno || 0;
    const G_FREQ = geno & 7;
    const verysmall = mdat.verysmall ? 1 : 0;
    const tmp = 2 + (G_FREQ < 2 ? 1 : 0) + verysmall;
    return !rn2(tmp);                          // mon.c:3248
}

// C ref: mon.c make_corpse() default path -> mkcorpstat(CORPSE, KEEPTRAITS?mon
// :0, mdat, x, y, CORPSTAT_INIT).  mksobj() builds the corpse object: rolls the
// next_ident o_id, the rndmonnum() reservoir scan (overwritten with mdat after),
// the gender rn2(2), and start_corpse_timeout().  Reuses mkobj.js verbatim.
export function make_corpse(mon, x, y) {
    const mndx = mon.data?.pmidx;
    if (mndx == null) return;
    // C ref: mon.c make_corpse() — zombies, mummies and vampires are handled by
    // their own switch cases BEFORE the default G_NOCORPSE guard: they always
    // leave a corpse of their base living species (undead_to_corpse), and it is
    // an *old* corpse (age -= TAINT_AGE+1).  Their undead form carries G_NOCORPSE
    // (that flag only blocks *random* corpse generation), so without this branch
    // the corpse — and its next_ident/rndmonnum/gender/timeout RNG — was skipped.
    const base = undead_to_corpse(mndx);
    if (base !== mndx) {
        const obj = mkcorpstat(CORPSE, mon, base, x, y, CORPSTAT_INIT | CORPSTAT_NONE);
        if (obj != null)
            obj.age = (obj.age ?? Math.max(game.moves ?? 1, 1)) - (TAINT_AGE + 1);
        return obj;
    }
    // C ref: mon.c:893 make_corpse default path — a G_NOCORPSE species (grid
    // bug, gas spore, …) returns NULL with NO mksobj rolls.  corpse_chance()
    // still rolled its rn2 in the caller; only the corpse object is suppressed.
    if (mon_nocorpse(mndx)) return;
    // mkcorpstat(CORPSE, KEEPTRAITS(mon)?mon:0, mdat, x, y, CORPSTAT_INIT):
    // mksobj() rolls next_ident, the rndmonnum() reservoir scan, gender rn2(2),
    // and start_corpse_timeout().  pm (mndx) overrides the rolled corpsenm after.
    mkcorpstat(CORPSE, mon, mndx, x, y, CORPSTAT_INIT | CORPSTAT_NONE);
}

// ── dmgval ──
// C ref: weapon.c dmgval(struct obj *otmp, struct monst *mon) — base weapon
// damage roll (oc_wsdam / oc_wldam dice) plus the per-weapon "extra" additions
// for weapons whose damage isn't an even die, plus enchantment.  The
// strength/skill bonuses are applied separately by hmon_hitmon_dmg_recalc().
// C: weapon.c dmgval() bonus-group otyps (our numbering; see mkobj.js).
const W = {
    CROSSBOW_BOLT: 23, TRIDENT: 33, BATTLE_AXE: 45, BROADSWORD: 52,
    ELVEN_BROADSWORD: 53, TWO_HANDED_SWORD: 55, TSURUGI: 57, RUNESWORD: 58,
    PARTISAN: 59, RANSEUR: 60, SPETUM: 61, HALBERD: 63, BARDICHE: 64,
    VOULGE: 65, GUISARME: 67, BILL_GUISARME: 68, LUCERN_HAMMER: 69,
    DWARVISH_MATTOCK: 71, MACE: 73, SILVER_MACE: 74, MORNING_STAR: 75,
    WAR_HAMMER: 76, FLAIL: 81, IRON_CHAIN: 478,
    ACID_VENOM: 480,   // mkobj.js ACID_VENOM
};

// C ref: uhitm.c hmon_hitmon_misc_obj() `default:` arm — VEGGY/PAPER objects
// (except spellbooks) are too floppy to hurt; everything else does weight-based
// damage capped at 6, plus the wet-towel wetness bonus.
const MAT_VEGGY = 3, MAT_PAPER = 5;
function hmon_misc_obj_dmg(obj) {
    const mat = objects[obj.otyp]?.material;
    if ((mat === MAT_VEGGY || mat === MAT_PAPER) && obj.oclass !== SPBOOK_CLASS)
        return 0;
    let dmg = Math.trunc(((obj.owt || 0) + 99) / 100);
    dmg = (dmg <= 1) ? 1 : rnd(dmg);
    if (dmg > 6) dmg = 6;
    // is_wet_towel(obj): a towel with wetness left adds obj->spe, then rerolls.
    if (obj.otyp === 234 /*TOWEL*/ && (obj.spe | 0) > 0) {
        dmg += (obj.spe | 0);
        dmg = rnd(dmg);
    }
    return dmg;
}

// dmgval() now lives in js/weapon.js (weapon.c:216).  The copy that used to
// sit here dropped the large-monster IRON_CHAIN case, the thick-skinned /
// PM_SHADE zeroing, the HEAVY_IRON_BALL weight bonus and the silver rnd(20),
// and gated the vs-monster bonus block on COIN_CLASS where C tests
// GEM/BALL/CHAIN.
export { dmgval } from './weapon.js';

// C ref: include/mondata.h bigmonst() / mons[].msize >= MZ_LARGE.
function largemonst(mdat) {
    return !!(mdat && mdat.msize != null && mdat.msize >= 3 /* MZ_LARGE (monflag.h); 4 is MZ_HUGE */);
}

// ── messaging helpers ──
// Lazy import of pline to avoid a static import cycle (display <- uhitm).
async function plineMon(mtmp, fmt) {
    const { pline } = await import('./display.js');
    await pline(fmt.replace('%s', Monnam(mtmp)));
}

// C ref: do_name.c mon_nam(mtmp) — "the <mon>" (lower case article).
export function mon_nam(mtmp) {
    return x_monnam(mtmp, /*ARTICLE_THE*/ 1, null, 0, false);
}

// C ref: mondata.h nonliving(ptr) = is_undead || PM_MANES || weirdnonliving
// (golem or S_VORTEX).  These are "destroyed" rather than "killed".  NOTE:
// elementals are LIVING in C (S_ELEMENTAL is not golem/vortex/undead), so an
// earth elemental is "killed", not "destroyed" (seed4500 step-269).
const S_VORTEX_U = 22, S_GOLEM_U = 55;   // defsym.h
function nonliving(mtmp) {
    // Derived from the generated M2_UNDEAD flag + monster class, NOT a species
    // name regex: a regex answers FALSE for every undead whose name it forgot
    // and TRUE for lookalikes (a "vampire bat" is not M2_UNDEAD).
    const p = mtmp?.data;
    if (!p) return false;
    if (mflags2_of(p) & M2_UNDEAD) return true;
    if (p.name === 'manes') return true;
    return p.mcls === S_GOLEM_U || p.mcls === S_VORTEX_U;
}

// C ref: do_name.c Monnam()/x_monnam() — capitalized monster name.  Minimal
// port sufficient for the starter monsters (no shopkeepers/priests/hallu).
export function Monnam(mtmp) {
    const s = x_monnam(mtmp, /*ARTICLE_THE*/ 1, null, 0, false);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// C ref: do_name.c x_monnam().  Reduced to the cases the starter sessions
// need: a tame monster with (ARTICLE_YOUR) and an optional given name.
//   article: 0 NONE, 1 THE, 2 A, 3 YOUR.
// C ref: mondata.c pmname(pm, mgender), monst.h Mgender(mon) = female ? FEMALE
// : MALE.  A NAMS() species carries three names and C NEVER shows the neutral
// one for a live monster, so `mons[].name` alone renders "dwarf leader" where C
// prints "dwarf lord".
const _PMNAMES_GENDERED = new Map([
    ['dwarf leader', ['dwarf lord', 'dwarf lady']],
    ['dwarf ruler', ['dwarf king', 'dwarf queen']],
    ['kobold leader', ['kobold lord', 'kobold lady']],
    ['gnome leader', ['gnome lord', 'gnome lady']],
    ['gnome ruler', ['gnome king', 'gnome queen']],
    ['ogre leader', ['ogre lord', 'ogre lady']],
    ['ogre tyrant', ['ogre king', 'ogre queen']],
    ['vampire leader', ['vampire lord', 'vampire lady']],
    ['elf-noble', ['elf-lord', 'elf-lady']],
    ['elven monarch', ['Elvenking', 'Elvenqueen']],
    ['aligned cleric', ['priest', 'priestess']],
    ['high cleric', ['high priest', 'high priestess']],
    ['amorous demon', ['incubus', 'succubus']],
    ['cave dweller', ['caveman', 'cavewoman']],
    ['cleric', ['priest', 'priestess']],
]);
export function mon_pmname(mtmp) {
    const n = mtmp?.data?.name;
    const pair = n != null ? _PMNAMES_GENDERED.get(n) : null;
    if (!pair) return n || 'monster';
    return pair[mtmp.female ? 1 : 0] || n;
}
// C ref: monsym.h PM_GHOST — resolved once off mons[] rather than transcribed,
// so the mons[] table can grow without silently re-pointing this test.
let _pm_ghost = -1;
function PM_GHOST() {
    if (_pm_ghost < 0) _pm_ghost = name_to_pmidx('ghost') ?? -2;
    return _pm_ghost;
}
export function x_monnam(mtmp, article, _adjective, _suppress, _called) {
    const base = mon_pmname(mtmp);
    const given = mtmp?.mgivenname || mtmp?.mextra?.mgivenname;

    // C ref: do_name.c:919 — a shopkeeper IS his personal name ("Maganasipi"),
    // with " the <species>" appended only when he isn't a plain shopkeeper or is
    // invisible.  No article, ever.
    if (mtmp?.isshk && !game.u?.uhallu && mtmp.m_ap_type !== 'mon') {
        let buf = shkname(mtmp);
        if (base !== 'shopkeeper' || mtmp.minvis)
            buf += ' the ' + (mtmp.minvis ? 'invisible ' : '') + base;
        return buf;
    }

    // C ref: do_name.c x_monnam do_it — any monster the hero cannot spot is
    // just "it".  Blindness is only ONE way to fail canspotmon(): a monster in
    // an unlit square a few steps away is equally unseen, and C prints "It
    // hits!" / "You kick it." for it.  AUGMENT_IT upgrades that to
    // "someone"/"something" (and rolls rn2(2) while hallucinating).
    const do_it = !canspotmon(mtmp) && article !== 3
        && !game.program_state?.gameover && mtmp && mtmp !== game.u?.usteed
        && !(game.u?.uswallow && game.u?.ustuck === mtmp)
        && !(_suppress & SUPPRESS_IT);
    if (do_it) {
        if (!(_suppress & AUGMENT_IT)) return 'it';
        // C: !is_animal excludes all Y; !mindless excludes Z, M, '
        const md = mtmp.data;
        const s_one = humanoid(md) && !is_animal_xm(md) && !mindless_xm(md);
        const hallu = !!game.u?.uhallu && !(_suppress & SUPPRESS_HALLUCINATION);
        return ((!hallu ? s_one : !rn2(2)) ? 'someone' : 'something');
    }

    // ARTICLE_YOUR only applies to tame monsters; otherwise downgrade to THE.
    if (article === 3 && !mtmp.mtame) article = 1;

    // C ref: do_name.c x_monnam "Put the adjectives in the buffer" — the
    // caller-supplied adjective ("peaceful") comes first, then "saddled "
    // (unless SUPPRESS_SADDLE, Blind, or Hallucinating).  Both sit between the
    // article and the name ("the peaceful gnome", "your saddled pony").
    let adj = '';
    if (_adjective) adj += _adjective + ' ';
    if (!(_suppress & SUPPRESS_SADDLE) && (mtmp?.misc_worn_check & W_SADDLE)
        && !Blind() && !game.u?.uhallu)
        adj += 'saddled ';
    const has_adjectives = adj !== '';

    if (given) {
        // A personal name is name_at_start: C drops the article for
        // ARTICLE_YOUR or when there are no adjectives, but keeps it otherwise
        // ("the peaceful Slasher").
        if (article === 3 || !has_adjectives) article = 0;
        // C ref: do_name.c:1006 — a named GHOST is "<name>'s ghost", never the
        // bare name: christen_monst() puts the dead hero's name on the bones
        // ghost, so "You miss Elara." must read "You miss Elara's ghost."
        // (hacklib.c s_suffix: a name already ending in 's' takes a bare "'").
        const gnamed = (mtmp?.data?.pmidx === PM_GHOST())
            ? adj + (/s$/i.test(given) ? `${given}'` : `${given}'s`) + ' ghost'
            : adj + given;
        return article === 1 ? 'the ' + gnamed
             : article === 2 ? an(gnamed)
             : gnamed;
    }

    // C ref: do_name.c:127 — `if (do_hallu) { rname = rndmonnam(&code); ... }`.
    // A hallucinating hero sees a RANDOM species (or a bogusmon line) in place
    // of every monster name, and both picks come off the DISPLAY rng, so
    // skipping them left that stream at the wrong offset for the next draw.
    // SUPPRESS_HALLUCINATION (0x04) is how disclosure asks for the true name.
    const do_hallu = !!game.u?.uhallu && !(_suppress & SUPPRESS_HALLUCINATION);
    if (do_hallu) {
        const { rndmonnam, bogon_is_pname } = halluc_naming();
        const r = rndmonnam();
        let art = article;
        if (bogon_is_pname(r.code) && (art === 3 || !has_adjectives))
            art = 0;
        const hnamed = adj + r.name;
        return art === 3 ? 'your ' + hnamed
             : art === 1 ? 'the ' + hnamed
             : art === 2 ? an(hnamed) : hnamed;
    }

    const named = adj + base;

    // C ref: do_name.c:1000 — name_at_start is type_is_pname(mdat) for a plain
    // species name.  A proper-noun species ("Medusa", a quest leader) drops its
    // article entirely; the Wizard of Yendor takes "the" instead.  Any G_UNIQ
    // monster asked for with ARTICLE_A is upgraded to "the" as well.
    let art = article;
    const mdat = mtmp?.data;
    if ((mflags2_of(mdat) & M2_PNAME) && (art === 3 || !has_adjectives))
        art = (mdat?.name === 'Wizard of Yendor') ? 1 : 0;
    else if (((mdat?.geno ?? 0) & G_UNIQ_XM) !== 0 && art === 2)
        art = 1;

    switch (art) {
    case 3: return 'your ' + named; // ARTICLE_YOUR
    case 1: return 'the ' + named;  // ARTICLE_THE
    case 2: return an(named);       // ARTICLE_A
    default: return named;          // ARTICLE_NONE
    }
}

// do_name.js is registered from this file's tail, so it is always evaluated by
// the time x_monnam() can run; the indirection keeps the import one-directional.
const SUPPRESS_HALLUCINATION = 0x04;   // C ref: do_name.h
const SUPPRESS_IT = 0x01, AUGMENT_IT = 0x40;  // C ref: do_name.h
// C ref: mondata.h is_animal(ptr) / mindless(ptr) — x_monnam's "someone" test.
const M1_MINDLESS_XM = 0x10000, M1_ANIMAL_XM = 0x40000;  // monflag.h
const is_animal_xm = (ptr) => (mflags1_of(ptr) & M1_ANIMAL_XM) !== 0;
const mindless_xm = (ptr) => (mflags1_of(ptr) & M1_MINDLESS_XM) !== 0;
let _halluc_naming = null;
function halluc_naming() {
    return _halluc_naming || { rndmonnam: () => ({ name: 'bogon', code: '' }),
                               bogon_is_pname: () => false };
}
export function register_halluc_naming(m) { _halluc_naming = m; }

// C ref: hacklib.c an() — prepend "a"/"an".
function an(s) {
    return (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s;
}

// do_name.c's wrapper family (js/do_name.js) drives x_monnam(); register the
// implementation here rather than importing uhitm.js from there, so do_name.js
// stays below uhitm.js in the module graph.
register_monnam_hooks({ x_monnam, mon_pmname });
register_halluc_naming({ rndmonnam, bogon_is_pname });

// ═══════════════════════════════════════════════════════════════════════════
// uhitm.c staging area — the remainder of the file.
//
// Everything past this line is a faithful port of the uhitm.c functions the
// live melee path above (do_attack -> hitum -> known_hitum -> hmon ->
// hmon_hitmon) does not call yet.  It is deliberately unreachable: the
// hmon_hitmon() above is an inlined simplification of C's `struct
// _hitmon_data` pipeline, and replacing it with these pieces is a separate,
// measured change.  Translating them now pins each piece's RNG order to the C
// source so that swap becomes a wiring job.
//
// Conventions in this block:
//   * cross-module calls use dynamic import(), like the live code above, so
//     nothing here can introduce a module-load cycle;
//   * where the C callee has no port at all, the call site names it and names
//     the RNG it would consume — those comments are the wiring blockers.
// ═══════════════════════════════════════════════════════════════════════════

import { ARTICLE_A, ARTICLE_YOUR, SUPPRESS_INVISIBLE, SUPPRESS_NAME,
         HMON_MELEE, HMON_THROWN, HMON_KICKED,
         M_ATTK_MISS, M_ATTK_HIT, M_ATTK_DEF_DIED, NATTK,
         M_AP_NOTHING, M_AP_FURNITURE, M_AP_OBJECT, M_AP_MONSTER,
         MIM_REVEAL, MIM_OMIT_WAIT, W_ARM, W_ARMC, W_ARMU, W_ARMH, W_ARMG,
         W_ARMF, W_RINGL, W_RINGR, W_WEP, STRAT_WAITFORU,
         POTHIT_HERO_BASH, POTHIT_HERO_THROW, MON_EXPLODE, EXPL_FIERY,
         NO_TRAP_FLAGS, M_AP_TYPE, ismnum, FACE, HAND, STOMACH,
         xdir, ydir } from './const.js';
import { M1_AMORPHOUS, M1_UNSOLID, M1_NOEYES, M1_NOHEAD, M1_NOHANDS, M1_FLY,
         M1_BREATHLESS, M1_AMPHIBIOUS, M1_THICK_HIDE, M1_ANIMAL,
         mindless } from './monflags_data.js';
import { attacktype_fordmg, AD_DRIN, AD_WRAP, AD_DGST, AD_HALU, AD_DREN,
         AD_SPEL, AT_SPIT, AT_TENT, AT_EXPL, AT_BREA, AT_GAZE,
         AT_BOOM } from './monattk_data.js';
import { EGG, BOULDER, HEAVY_IRON_BALL, IRON_CHAIN, EXPENSIVE_CAMERA,
         LOADSTONE, ROCK, WAN_LIGHT, POTION_CLASS, BLINDING_VENOM, ACID_VENOM,
         weight } from './mkobj.js';
import { rnl, rn1 } from './rng.js';
import { monster_by_pmidx } from './makemon.js';
import { Mgender } from './do_name.js';

// C ref: include/objects.h oc_material enum (MAT_VEGGY/MAT_PAPER are declared
// with hmon_misc_obj_dmg above).
const NO_MATERIAL = 0, MAT_LEATHER = 7, MAT_IRON = 11, MAT_METAL = 12,
      MAT_SILVER = 14;

// C ref: include/objects.h otyp ordinals, verified against js/mkobj.js
// OBJECT_DATA by name; the ones mkobj.js exports are imported above.
const MIRROR = 230, CLOVE_OF_GARLIC = 284, CREAM_PIE = 287, RUBBER_HOSE = 78,
      OILSKIN_CLOAK = 142, KATANA = 56, YA = 22, YUMI = 86, ELVEN_ARROW = 19,
      ELVEN_BOW = 84, BOOMERANG = 26;

// C ref: include/defsym.h MONSYM ordinals (C's mons[].mlet == our data.mcls).
const S_BLOB = 2, S_EYE = 5, S_KOBOLD = 11, S_ORC_CLS = 15, S_LIGHT = 25,
      S_FUNGUS = 32, S_GNOME = 33, S_LICH = 38, S_MUMMY = 39, S_GHOST = 54,
      S_ZOMBIE = 52;

// C ref: include/artilist.h ordinals (same table js/artifact.js uses).
const ART_CLEAVER = 4, ART_GIANTSLAYER = 15, ART_SNICKERSNEE = 19;

// C ref: src/role.c roles[] order (PM_MONK/PM_SAMURAI/... are declared above).
const PM_ROGUE = 8;

// C ref: include/monflag.h MZ_SMALL / MR_POISON.
const MZ_SMALL = 1, MR_POISON = 0x20;

// C ref: include/hack.h DIR_* and src/cmd.c:3847 xytodir().  js/dothrow.js and
// js/cmd.js each keep a file-static copy; a third is cheaper than an import
// cycle, since both of those modules import from this one.
const N_DIRS = 8, DIR_ERR = -1;
const DIR_LEFT = (dir) => (dir + 7) % N_DIRS;
const DIR_RIGHT = (dir) => (dir + 1) % N_DIRS;
const DIR_LEFT2 = (dir) => (dir + 6) % N_DIRS;
const DIR_RIGHT2 = (dir) => (dir + 2) % N_DIRS;
function xytodir_uh(x, y) {
    for (let dd = 0; dd < N_DIRS; dd++)
        if (x === xdir[dd] && y === ydir[dd]) return dd;
    return DIR_ERR;
}

// ── mondata.h / monst.h / obj.h predicates used only by this block ─────────
// mflags1_of/mflags2_of, helpless(), is_orc(), is_undead(), largemonst() and
// nonliving() are declared earlier in this file and reused here.

function amorphous(ptr) { return (mflags1_of(ptr) & M1_AMORPHOUS) !== 0; }
function unsolid(ptr) { return (mflags1_of(ptr) & M1_UNSOLID) !== 0; }
function haseyes(ptr) { return (mflags1_of(ptr) & M1_NOEYES) === 0; }
function has_head(ptr) { return (mflags1_of(ptr) & M1_NOHEAD) === 0; }
function nohands_uh(ptr) { return (mflags1_of(ptr) & M1_NOHANDS) !== 0; }
function thick_skinned(ptr) { return (mflags1_of(ptr) & M1_THICK_HIDE) !== 0; }
function breathless(ptr) { return (mflags1_of(ptr) & M1_BREATHLESS) !== 0; }
function amphibious(ptr) { return (mflags1_of(ptr) & M1_AMPHIBIOUS) !== 0; }
function is_animal_uh(ptr) { return (mflags1_of(ptr) & M1_ANIMAL) !== 0; }
function is_flyer(ptr) { return (mflags1_of(ptr) & M1_FLY) !== 0; }
// C ref: mondata.h is_demon(ptr) — M2_DEMON.  (This file's is_orc()/is_undead()
// are the same shape; _uh distinguishes it from js/mon.js's exported copy.)
function is_demon_uh(ptr) { return (mflags2_of(ptr) & M2_DEMON) !== 0; }
// C ref: mondata.h verysmall(ptr) / cantwield(ptr).
function verysmall(ptr) { return (ptr?.msize ?? 2) < MZ_SMALL; }
function cantwield(ptr) { return nohands_uh(ptr) || verysmall(ptr); }
// C ref: mondata.h bigmonst(ptr) — msize >= MZ_LARGE; same predicate as this
// file's largemonst(), kept under the C name for the ports below.
function bigmonst(ptr) { return largemonst(ptr); }
// C ref: mondata.h is_whirly(ptr) — S_VORTEX class or the air elemental.
function is_whirly(ptr) {
    return ptr?.mcls === S_VORTEX_U || ptr?.name === 'air elemental';
}
// C ref: mondata.h noncorporeal(ptr) — mlet == S_GHOST (this is NOT unsolid();
// shades are S_GHOST too, which is what the silver/light messages below key on).
function noncorporeal(ptr) { return ptr?.mcls === S_GHOST; }
// C ref: mondata.h is_floater(ptr) — mlet == S_EYE || mlet == S_LIGHT.
function is_floater(ptr) {
    return ptr?.mcls === S_EYE || ptr?.mcls === S_LIGHT;
}
// C ref: mondata.h is_rider(ptr) — Death, Famine, Pestilence.
const RIDER_NAMES = new Set(['Death', 'Famine', 'Pestilence']);
function is_rider(ptr) { return RIDER_NAMES.has(ptr?.name); }
// C ref: mondata.h digests(ptr)/enfolds(ptr) — dmgtype_fromattack(ptr, AD_x,
// AT_ENGL); js/monattk_data.js spells that attacktype_fordmg(ptr, atyp, adtyp).
function digests(ptr) { return attacktype_fordmg(ptr, AT_ENGL, AD_DGST); }
function enfolds(ptr) { return attacktype_fordmg(ptr, AT_ENGL, AD_WRAP); }
// C ref: mondata.h flaming(ptr).
const FLAMING_NAMES = new Set(['fire vortex', 'flaming sphere',
                               'fire elemental', 'salamander']);
function flaming(ptr) { return FLAMING_NAMES.has(ptr?.name); }
// C ref: monst.h is_vampshifter(mon) — cham is one of the three vampire forms.
const VAMPSHIFTER_CHAM_NAMES = new Set(['vampire', 'vampire leader',
                                        'Vlad the Impaler']);
function is_vampshifter(mon) {
    const ch = mon?.cham;
    if (ch == null || ch < 0) return false;
    return VAMPSHIFTER_CHAM_NAMES.has(monster_by_pmidx(ch)?.name);
}
// C ref: mondata.c:654 sticks(ptr) — a holder; grabbing one would be ambiguous.
// Note the AT_ENGL exclusion on the AD_WRAP arm (an engulfer isn't a holder).
function sticks(ptr) {
    return dmgtype(ptr, AD_STCK)
        || (dmgtype(ptr, AD_WRAP) && !attacktype(ptr, AT_ENGL))
        || attacktype(ptr, AT_HUGS);
}
// C ref: mondata.h hug_throttles(ptr) — the rope golem's strangling hug.
function hug_throttles(ptr) { return ptr?.name === 'rope golem'; }
// C ref: mondata.c:591 can_be_strangled(mon) — strangulation is loss of blood
// flow to the brain, so headless creatures are immune (no neck) and so are
// mindless ones that don't breathe.  The AMULET_OF_MAGICAL_BREATHING arm is
// dropped: monsters never wear one (C says so at that line).
function can_be_strangled(mon) {
    const ptr = mon?.data;
    if (!has_head(ptr)) return false;
    const nobrainer = mindless(ptr);
    const nonbreathing = breathless(ptr);
    return !nobrainer || !nonbreathing;
}
// C ref: monst.h resists_poison(mon) — Resists_Elem(mon, POISON_RES); this
// port tracks the species bit only (see js/mondata.js resists_bit).
function resists_poison(mon) {
    return ((mon?.data?.mresists ?? 0) & MR_POISON) !== 0;
}
// C ref: mondata.c:248 resists_blnd(mon) — monster half only (the hero can't be
// the defender of a hero attack).  resists_blnd_by_arti() needs artifact
// defends(); js/artifact.js has no such export, so the Sunsword arm is absent.
function resists_blnd(mon) {
    const ptr = mon?.data;
    if (mon?.mblinded || !mon?.mcansee || !haseyes(ptr) || mon?.msleeping)
        return true;
    return attacktype_fordmg(ptr, AT_EXPL, AD_BLND)
        || attacktype_fordmg(ptr, AT_GAZE, AD_BLND);
}
// C ref: mondata.h touch_petrifies(ptr) — cockatrice and chickatrice only
// (Medusa petrifies when eaten, via flesh_petrifies(), not when touched).
function touch_petrifies(ptr) {
    return ptr?.name === 'cockatrice' || ptr?.name === 'chickatrice';
}
// C ref: mondata.h passes_rocks(ptr) — passes_walls && !unsolid; xorn and
// earth elemental, but not ghosts/shades.  passes_walls() is declared above.
function passes_rocks(ptr) { return passes_walls(ptr) && !unsolid(ptr); }
// C ref: mondata.h hates_light(ptr) — the gremlin.
function mon_hates_light(mon) { return mon?.data?.name === 'gremlin'; }
// C ref: obj.h:418 is_flimsy(otmp) — oc_material <= LEATHER, or a rubber hose.
function is_flimsy(otmp) {
    return (objects[otmp?.otyp]?.material ?? NO_MATERIAL) <= MAT_LEATHER
        || otmp?.otyp === RUBBER_HOSE;
}
// C ref: obj.h:316 stale_egg(egg) — (moves - age) > 2 * MAX_EGG_HATCH_TIME.
// Same constant as js/dogmove.js's copy.
function stale_egg(egg) { return ((game.moves || 1) - (egg?.age ?? 0)) > 400; }

// ── do_name.c / hacklib.c string helpers ───────────────────────────────────
// (an(), s_suffix(), mon_nam(), Monnam(), x_monnam() are declared above.)

// C ref: hacklib.c highc()/upstart() — capitalise the leading character.
function highc_uh(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function upstart(s) { return highc_uh(s); }
// C ref: hacklib.c exclam(force) — the punctuation that grades a hit.
function exclam(force) { return force < 0 ? '?' : (force <= 4 ? '.' : '!'); }
// C ref: hacklib.c plur(n).
function plur(n) { return (Number(n) === 1) ? '' : 's'; }
// C ref: hacklib.c vtense(subj, verb) — third-person agreement.  Reduced to the
// fixed verbs this block passes ("pass", "sear", "are", "splash", "shatter");
// C's full copy also handles "have"/"be" and the -y/-o/-ch suffix rules.
function vtense_uh(subj, verb) {
    const plural_subj = !!subj && /s$/.test(subj) && !/ss$/.test(subj);
    if (plural_subj) return verb;
    switch (verb) {
    case 'are': return 'is';
    case 'pass': return 'passes';
    case 'splash': return 'splashes';
    default: return `${verb}s`;
    }
}
// C ref: hacklib.c the()/The().
function the_uh(s) { return `the ${s}`; }
function The_uh(s) { return `The ${s}`; }
// C ref: do_name.c mhe(mtmp)/mhis(mtmp) — pronouns from Mgender().
const MALE_G = 0, FEMALE_G = 1;
function mhe(mtmp) { return Mgender(mtmp) === FEMALE_G ? 'she' : 'he'; }
function mhis(mtmp) { return Mgender(mtmp) === FEMALE_G ? 'her' : 'his'; }
// C ref: do_name.c a_monnam(mtmp) — "a <mon>".
function a_monnam_uh(mtmp) { return x_monnam(mtmp, ARTICLE_A, null, 0, false); }

// ── hero-state accessors (the ones this block needs) ───────────────────────
function u_of() { return game.u || {}; }
// C ref: youprop.h Fumbling/Stunned/Blind_telepat/See_invisible/Invisible.
function Fumbling() { return (u_of().uprops?.Fumbling || 0) > 0; }
function Stunned_uh() {
    return (u_of().uprops?.Stun || 0) > 0 || !!u_of().Stunned
        || (u_of().ustun | 0) > 0;
}
function Blind_telepat() { return (u_of().uprops?.Telepat || 0) > 0; }
function See_invisible() { return !!u_of().see_invis; }
function Invisible_uh() { return !!u_of().uinvis && !See_invisible(); }
function Stone_resistance() { return (u_of().uprops?.StoneResistance || 0) > 0; }
function Slow_digestion() { return (u_of().uprops?.SlowDigestion || 0) > 0; }
function Deaf_uh() { return (u_of().uprops?.Deaf || 0) > 0; }
function Upolyd() { return !!u_of().Upolyd; }
// C ref: hack.h Hate_silver — a poly'd hero who hates silver.
function Hate_silver() { return false; }
// C ref: display.h m_next2u(mon) — adjacent to the hero.
function m_next2u(mon) {
    const u = u_of();
    return !!mon && Math.abs((mon.mx | 0) - (u.ux | 0)) <= 1
        && Math.abs((mon.my | 0) - (u.uy | 0)) <= 1;
}
// C ref: hack.h mdistu(mon) — dist2(mon->mx, mon->my, u.ux, u.uy).
function mdistu(mon) {
    const u = u_of();
    const dx = (mon.mx | 0) - (u.ux | 0), dy = (mon.my | 0) - (u.uy | 0);
    return dx * dx + dy * dy;
}

// C ref: uhitm.c:104 dynamic_multi_reason(mon, verb, by_gaze) — multi_reason is
// usually a literal; here it names the monster that caused the paralysis, with
// mon->m_id prefixed for done_in_by().  No RNG.
export function dynamic_multi_reason(mon, verb, by_gaze) {
    const who = x_monnam(mon, ARTICLE_A, null,
                         (SUPPRESS_IT | SUPPRESS_INVISIBLE
                          | SUPPRESS_HALLUCINATION | SUPPRESS_SADDLE
                          | SUPPRESS_NAME), false);
    /* C writes "<m_id>:" then the reason into one buffer and points
       gm.multi_reason PAST the prefix, so done_in_by() can recover the id. */
    const tail = `${verb} by ${!by_gaze ? who : s_suffix(who)}`
        + `${!by_gaze ? '' : ' gaze'}`;
    game.multireasonbuf = `${mon.m_id}:${tail}`;
    game.multi_reason = tail;
    return game.multi_reason;
}

// C ref: uhitm.c:651 hitum_cleave(target, uattk) — Cleaver hits the primary
// target plus the monsters to either side of it; returns False if the primary
// target died.  Swing direction alternates between calls (C's file-static
// `clockwise`).
//
// Per iteration the RNG order is: find_roll_to_hit (hitval/weapon_hit_bonus,
// RNG-free) -> rnd(20) -> known_hitum -> passive.  A square with no monster
// consumes nothing.
let _cleave_clockwise = false;
export async function hitum_cleave(target, uattk) {
    const u = game.u;
    const x = u.ux, y = u.uy;
    let i = xytodir_uh(u.dx, u.dy);
    if (i === DIR_ERR)
        return true; /* C: impossible(); target hasn't been killed */
    /* step back two so the loop's first increment lands beside the primary */
    i = _cleave_clockwise ? DIR_LEFT2(i) : DIR_RIGHT2(i);
    const umort = u.umortality | 0;
    const save_bhitpos = game.bhitpos;
    const save_notonhead = game.notonhead;

    for (let count = 3; count > 0; --count) {
        i = _cleave_clockwise ? DIR_RIGHT(i) : DIR_LEFT(i);
        const tx = x + xdir[i], ty = y + ydir[i];
        if (!isok(tx, ty)) continue;
        const mtmp = m_at(tx, ty);
        if (!mtmp) {
            /* display.c unmap_invisible(x, y): js/display.js spells it
                   unmap_object() */
                if (glyph_is_invisible(tx, ty)) unmap_object(tx, ty);
            continue;
        }
        // find_roll_to_hit's local signature is (mtmp, weapon, first_swing);
        // C passes uattk->aatyp and returns attknum/armorpenalty by reference.
        // C's `attknum = 0` is declared INSIDE this loop body, so
        // find_roll_to_hit's `if (!(*attk_count)++)` fires check_caitiff on
        // every one of the three swings -- hence first_swing = true here.
        const tmp = await find_roll_to_hit(mtmp, game.uwep, true);
        mon_maybe_unparalyze(mtmp);
        const dieroll = rnd(20);
        const mhit = (tmp > dieroll);
        game.bhitpos = { x: tx, y: ty };   /* normally set by do_attack() */
        game.notonhead = (mtmp.mx !== tx || mtmp.my !== ty);
        await known_hitum(mtmp, game.uwep, mhit, dieroll);
        await passive(mtmp, game.uwep, mhit, !DEADMONSTER(mtmp), AT_WEAP);

        /* stop if the weapon is gone or a passive counter-attack paralysed or
           killed (then life-saved) the hero */
        if (!game.uwep || (game.multi ?? 0) < 0 || (u.umortality | 0) > umort)
            break;
    }
    _cleave_clockwise = !_cleave_clockwise;
    game.bhitpos = save_bhitpos;
    game.notonhead = save_notonhead;
    return (target && DEADMONSTER(target)) ? false : true;
}

// C ref: uhitm.c:838 hmon_hitmon_barehands(hmd, mon) — bare-handed damage.
// RNG: rnd(2)/rnd(4), then special_dmgval()'s blessed rnd(4) / silver rnd(20).
export async function hmon_hitmon_barehands(hmd, mon) {
    if (hmd.mdat?.name === 'shade') {
        hmd.dmg = 0;
    } else {
        /* 1..2 or 1..4, then substantially raised by strength+skill bonuses */
        hmd.dmg = rnd(!martial_bonus() ? 2 : 4);
        hmd.use_weapon_skill = true;
        hmd.train_weapon_skill = (hmd.dmg > 1);
    }

    /* Blessed gloves and silver rings both count as "bare-handed" bonuses;
       rings sit under gloves so only one applies.  With a single hit both
       rings are checked; with two hits only the ring on the acting hand. */
    const spcdmgflg = game.uarmg ? W_ARMG
        : ((((hmd.twohits === 0 || hmd.twohits === 1) ? W_RINGR : 0)
            | ((hmd.twohits === 0 || hmd.twohits === 2) ? W_RINGL : 0)));
    const { special_dmgval } = await import('./weapon.js');
    const sd = special_dmgval(game.youmonst || game.u, mon, spcdmgflg);
    hmd.dmg += sd.bonus;
    const silverhit = sd.silverhit;

    switch (hmd.twohits) {
    case 0: /* one hit: either ring applies, wearing both is the same as one */
        hmd.barehand_silver_rings = (silverhit & (W_RINGR | W_RINGL)) ? 1 : 0;
        break;
    case 1: /* first of two or more: right ring */
        hmd.barehand_silver_rings = (silverhit & W_RINGR) ? 1 : 0;
        break;
    case 2: /* second of two or more: left ring */
        hmd.barehand_silver_rings = (silverhit & W_RINGL) ? 1 : 0;
        break;
    default: /* third or later (poly'd hero); rings already applied */
        hmd.barehand_silver_rings = 0;
        break;
    }
    if (hmd.barehand_silver_rings > 0) hmd.silvermsg = true;
}

// C ref: uhitm.c:885 hmon_hitmon_weapon_ranged(hmd, mon, obj) — a launcher, or
// ammo/missile used out of role: only 1-2 points and no weapon skill.
// RNG: rnd(2), then the silver rnd(20)/rnd(10), then the boomerang rnl(4).
export async function hmon_hitmon_weapon_ranged(hmd, mon, obj) {
    const { shade_glare } = await import('./artifact.js');
    const { mon_hates_silver } = await import('./mon.js');
    if (hmd.mdat?.name === 'shade' && !shade_glare(obj))
        hmd.dmg = 0;
    else
        hmd.dmg = rnd(2);
    if (hmd.material === MAT_SILVER && mon_hates_silver(mon)) {
        hmd.silvermsg = hmd.silverobj = true;
        /* if it will already inflict damage, make it worse */
        hmd.dmg += rnd(hmd.dmg ? 20 : 10);
    }
    if (!hmd.thrown && obj === game.uwep && obj.otyp === BOOMERANG
        && rnl(4) === 4 - 1) {
        const more_than_1 = ((obj.quan ?? 1) > 1);
        const I = await import('./invent.js');
        const { update_topl } = await import('./display.js');
        await update_topl(`As you hit ${mon_nam(mon)}, `
            + `${more_than_1 ? 'one of ' : ''}${I.yname(obj)}`
            + ` breaks into splinters.`);
        /* wield.c uwepgone() sets gu.unweapon; no port, so set it directly */
        if (!more_than_1) game.unweapon = true;
        I.useup(obj);
        hmd.hittxt = true;
        if (hmd.mdat?.name !== 'shade') hmd.dmg++;
    }
}

// C ref: uhitm.c:921 backstabbable(mon) — can the target be stabbed in the
// back?  No RNG.
export function backstabbable(mon) {
    const d = mon?.data;
    return !amorphous(d)
        && !is_whirly(d)
        && !noncorporeal(d)
        && d?.mcls !== S_BLOB
        && d?.mcls !== S_EYE
        && d?.mcls !== S_FUNGUS
        && canseemon(mon)
        && !!(mon.mflee || helpless(mon));
}

// C ref: uhitm.c:934 hmon_hitmon_weapon_melee(hmd, mon, obj) — the ordinary
// wielded-weapon path.  RNG order: dmgval() (silver rnd(20) inside), the Rogue
// backstab rnd(u.ulevel), the weapon-shatter obj_resists() + rn2(4) + monflee's
// d(2,3), artifact_hit(), then joust()'s rn2(5)/rnl(50).
export async function hmon_hitmon_weapon_melee(hmd, mon, obj) {
    const I = await import('./invent.js');
    const WPN = await import('./weapon.js');
    const A = await import('./artifact.js');
    const { update_topl } = await import('./display.js');
    const u = game.u;

    /* "normal" weapon usage */
    hmd.use_weapon_skill = true;
    hmd.dmg = dmgval(obj, mon);
    /* a minimal hit doesn't exercise proficiency */
    hmd.train_weapon_skill = (hmd.dmg > 1);

    /* Healer with anatomy knowledge */
    if (roleMnum() === PM_HEALER && hmd.hand_to_hand
        && obj.oclass === WEAPON_CLASS
        && (objects[obj.otyp]?.oc_skill ?? 0) === P_KNIFE)
        hmd.dmg += Math.min(3,
            Math.trunc((game.mvitals?.[mon.data?.pmidx]?.died ?? 0) / 6));

    const { uwep_skill_type, p_skill_of } = await import('./enhance.js');
    let monwep;
    if (!hmd.train_weapon_skill || mon === u.ustuck || u.twoweap
        /* Cleaver hits up to three targets, so it doesn't also backstab or
           shatter foes' weapons */
        || (hmd.hand_to_hand && A.is_art(obj, ART_CLEAVER))) {
        /* no special bonuses */
    } else if (roleMnum() === PM_ROGUE && backstabbable(mon) && !Upolyd()
               /* multi-shot throwing would be too powerful here */
               && hmd.hand_to_hand) {
        await update_topl(`You strike ${mon_nam(mon)} from behind!`);
        hmd.dmg += rnd(u.ulevel || 1);
        hmd.hittxt = true;
    } else if (hmd.dieroll === 2 && obj === game.uwep
               && obj.oclass === WEAPON_CLASS
               && (I.bimanual(obj)
                   || (roleMnum() === PM_SAMURAI && obj.otyp === KATANA
                       && !game.uarms))
               && (uwep_skill_type() !== P_NONE
                   && p_skill_of(uwep_skill_type()) >= P_SKILLED)
               && ((monwep = MON_WEP_uh(mon)) != null
                   && !is_flimsy(monwep)
                   && !I.obj_resists(monwep,
                                     50 + 15 * (WPN.greatest_erosion(obj)
                                                - WPN.greatest_erosion(monwep)),
                                     100))) {
        /*
         * 2.5% chance of shattering the defender's weapon when using a
         * two-handed weapon; less if uwep is rusted.  dieroll == 2 is the most
         * successful non-beheading hit, so artifact damage gets first refusal;
         * the percentage is (1/20)*(50/100).  A rustier attacker weapon raises
         * obj_resists' chance, i.e. lowers the shatter chance, and vice versa.
         */
        WPN.setmnotwielded(mon, monwep);
        mon.weapon_check = 1 /* NEED_WEAPON */;
        /* C uses Yobjnam2(monwep, "shatter") when the monster is seen ("Shk's
           X shatters") and s_suffix(Monnam)+"weapon" when it isn't; this port
           has no Yobjnam2(), so the seen case uses the same possessive form. */
        const wepname = canseemon(mon) ? I.xname(monwep) : 'weapon';
        const buf = `${s_suffix(Monnam(mon))} ${wepname}`
            + `${plur(monwep.quan ?? 1)} ${I.otense(monwep, 'shatter')}`;
        await update_topl(`${buf} from the force of your blow!`);
        const { m_useupall } = await import('./mthrowu.js');
        m_useupall(mon, monwep);
        /* if someone just shattered MY weapon, I'd flee! */
        if (rn2(4)) {
            const { monflee: monflee_full } = await import('./monmove.js');
            await monflee_full(mon, d(2, 3), true, true);
        }
        hmd.hittxt = true;
    }

    if (obj.oartifact) {
        const mdmg = { d: hmd.dmg };
        const special = await A.artifact_hit(game.youmonst || game.u, mon, obj,
                                            mdmg, hmd.dieroll);
        hmd.dmg = mdmg.d;
        if (special) {
            /* artifact_hit updated dmg but inflicted none itself; it may have
               destroyed carried items, and those might kill the monster */
            if (DEADMONSTER(mon)) {         /* artifact killed monster */
                hmd.doreturn = true;
                hmd.retval = false;
                return;
            }
            if (hmd.dmg === 0) {            /* beheaded a headless monster */
                hmd.doreturn = true;
                hmd.retval = true;
                return;
            }
            hmd.hittxt = true;
        }
    }
    const { mon_hates_silver } = await import('./mon.js');
    if (hmd.material === MAT_SILVER && mon_hates_silver(mon))
        hmd.silvermsg = hmd.silverobj = true;
    if (A.artifact_light(obj) && obj.lamplit && mon_hates_light(mon))
        hmd.lightobj = true;
    if (u.usteed && !hmd.thrown && hmd.dmg > 0
        && weapon_type(obj) === P_LANCE && mon !== u.ustuck) {
        hmd.jousting = await joust(mon, obj);
        /* exercise skill even for minimal-damage hits */
        if (hmd.jousting) hmd.train_weapon_skill = true;
    }
    if (hmd.thrown === HMON_THROWN && (I.is_ammo(obj) || I.is_missile(obj))) {
        if (I.ammo_and_launcher(obj, game.uwep)) {
            /* elves and samurai are highly trained with their own bows */
            if (roleMnum() === PM_SAMURAI && obj.otyp === YA
                && game.uwep.otyp === YUMI)
                hmd.dmg++;
            else if (Race_if_ELF() && obj.otyp === ELVEN_ARROW
                     && game.uwep.otyp === ELVEN_BOW)
                hmd.dmg++;
            hmd.train_weapon_skill = (hmd.dmg > 0);
        }
        if (obj.opoisoned && (is_poisonable_uh(obj) || A.permapoisoned(obj)))
            hmd.ispoisoned = true;
    }
    /* permapoisoned (Grimtooth) is non-ammo/missile, so limit the poison */
    if (A.permapoisoned(obj) && hmd.dieroll <= 5) hmd.ispoisoned = true;
}
// C ref: monst.h MON_WEP(mon) — js/monmove.js exports the same one-liner; a
// local copy keeps hmon_hitmon_weapon_melee() synchronous-looking.
function MON_WEP_uh(mon) { return mon?.mw || null; }
// C ref: obj.h:264 is_poisonable(otmp) — a WEAPON_CLASS item whose oc_skill is
// in [-P_SHURIKEN, -P_BOW] (arrows/bolts/darts/shuriken), or permapoisoned.
function is_poisonable_uh(obj) {
    const sk = objects[obj?.otyp]?.oc_skill ?? 0;
    return (obj?.oclass === WEAPON_CLASS && sk >= -24 && sk <= -20);
}

// C ref: uhitm.c:1070 hmon_hitmon_weapon(hmd, mon, obj) — the ranged/melee fork
// for a WEAPON_CLASS, weptool or GEM_CLASS object.  No RNG of its own.
export async function hmon_hitmon_weapon(hmd, mon, obj) {
    const I = await import('./invent.js');
    const A = await import('./artifact.js');
    if (/* strike with a bow... */
        I.is_launcher(obj)
        /* or with a missile in your hand... */
        || (!hmd.thrown && (I.is_missile(obj) || I.is_ammo(obj)))
        /* or use a pole at short range and not mounted... */
        || (!hmd.thrown && !game.u?.usteed && I.is_pole(obj)
            && !A.is_art(obj, ART_SNICKERSNEE))
        /* or throw a missile without the proper bow */
        || (I.is_ammo(obj) && (hmd.thrown !== HMON_THROWN
                               || !I.ammo_and_launcher(obj, game.uwep)))) {
        await hmon_hitmon_weapon_ranged(hmd, mon, obj);
    } else {
        await hmon_hitmon_weapon_melee(hmd, mon, obj);
        if (hmd.doreturn) return;
    }
}

// C ref: uhitm.c:1095 hmon_hitmon_potion(hmd, mon, obj) — bash with a potion.
// potion.c potionhit() owns the impact message, breakage roll, and potion
// effect.  Keep the split/freeinv order here, then call the full shared
// routine so a hero striking a monster follows the same RNG path as C.
export async function hmon_hitmon_potion(hmd, mon, obj) {
    const I = await import('./invent.js');
    if ((obj.quan ?? 1) > 1) {
        /* C splitobj() allocates a fresh object id through next_ident(),
           whose rnd(2) draw precedes potionhit()'s bottlename() roll. */
        const { next_ident } = await import('./mkobj.js');
        next_ident();
        obj = I.splitobj(obj, 1);
    } else
        game.uwep = null;      /* wield.c setuwep(0); no port */
    I.freeinv(obj);
    const { potionhit } = await import('./potion.js');
    await potionhit(mon, obj,
                    hmd.hand_to_hand ? POTHIT_HERO_BASH : POTHIT_HERO_THROW);
    if (DEADMONSTER(mon)) {
        hmd.doreturn = true;
        hmd.retval = false;    /* killed */
        return;
    }
    hmd.hittxt = true;
    /* in case the potion's effect transformed the target */
    hmd.mdat = mon.data;
    hmd.dmg = (hmd.mdat?.name === 'shade') ? 0 : 1;
}

// C ref: uhitm.c:1119 hmon_hitmon_misc_obj(hmd, mon, obj) — bashing with a
// non-weapon.  The per-otyp arms come first; the `default:` arm (weight-based
// damage) is the one js/invent.js's hmon_misc_obj_dmg() above already covers.
//
// RNG order per arm: BOULDER/BALL/CHAIN -> dmgval(); MIRROR -> breaktest();
// CORPSE -> munstone()'s rolls; EGG -> explode()'s d(3,6) for a pyrolisk egg;
// CLOVE_OF_GARLIC -> d(2,4) inside monflee; CREAM_PIE/BLINDING_VENOM ->
// rn1(25,21); default -> rnd(weight), the wet-towel rnd()/rn2(spe+1), the
// silver rnd(20), the blessed rnd(4).
export async function hmon_hitmon_misc_obj(hmd, mon, obj) {
    const I = await import('./invent.js');
    const WPN = await import('./weapon.js');
    const M = await import('./mon.js');
    const { update_topl } = await import('./display.js');
    const u = game.u;

    /* C's useup_eggs(o) macro: obfree() when thrown, useupall() otherwise */
    const useup_eggs = (o) => { if (hmd.thrown) I.obfree(o, null); else I.useupall(o); };

    switch (obj.otyp) {
    case BOULDER:         /* 1d20 */
    case HEAVY_IRON_BALL: /* 1d25 */
    case IRON_CHAIN:      /* 1d4+1 */
        hmd.dmg = dmgval(obj, mon);
        break;
    case MIRROR: {
        const { breaktest } = await import('./dothrow.js');
        if (breaktest(obj)) {
            await update_topl(`You break ${I.ysimple_name(obj)}.`
                + `  That's bad luck!`);
            change_luck(-2);
            I.useup(obj);
            obj = null;
            hmd.unarmed = false;      /* avoid obj==0 confusion */
            hmd.get_dmg_bonus = false;
            hmd.hittxt = true;
        }
        hmd.dmg = 1;
        break;
    }
    case EXPENSIVE_CAMERA: {
        await update_topl(`You succeed in destroying ${I.ysimple_name(obj)}.`
            + `  Congratulations!`);
        const { release_camera_demon } = await import('./dothrow.js');
        await release_camera_demon(obj, u.ux, u.uy);
        I.useup(obj);
        hmd.doreturn = true;
        hmd.retval = true;
        return;
    }
    case CORPSE:          /* fixed by polder@cs.vu.nl */
        if (touch_petrifies(monster_by_pmidx(obj.corpsenm))) {
            hmd.dmg = 1;
            hmd.hittxt = true;
            /* objnam.c corpse_xname(obj, 0, dknown ? CXN_PFX_THE
               : CXN_ARTICLE); this port has no corpse_xname() */
            await update_topl(`You hit ${mon_nam(mon)} with `
                + `${obj.dknown ? 'the' : 'a'} `
                + `${monster_by_pmidx(obj.corpsenm)?.name} corpse.`);
            const { observe_object } = await import('./o_init.js');
            observe_object(obj);
            const { munstone } = await import('./muse.js');
            if (!await munstone(mon, true)) {
                /* mon.c minstapetrify(mon, TRUE) — unported; it turns 'mon'
                   into a statue, consuming no RNG of its own. */
            }
            if (M.resists_ston(mon)) break;
            /* note: hp may be <= 0 even if munstone() returned TRUE */
            hmd.doreturn = true;
            hmd.retval = !DEADMONSTER(mon);
            return;
        }
        hmd.dmg = (ismnum(obj.corpsenm)
                   ? (monster_by_pmidx(obj.corpsenm)?.msize ?? 0) : 0) + 1;
        break;
    case EGG: {
        const cnt = obj.quan ?? 1;

        hmd.dmg = 1;                /* nominal physical damage */
        hmd.get_dmg_bonus = false;
        hmd.hittxt = true;          /* message always given */
        /* the egg is always used up or transformed, so the next hand-to-hand
           attack should give a "bashing" message */
        if (obj === game.uwep) game.unweapon = true;
        if (obj.spe && ismnum(obj.corpsenm))
            change_luck(cnt < 5 ? -cnt : -5);

        if (ismnum(obj.corpsenm)
            && touch_petrifies(monster_by_pmidx(obj.corpsenm))) {
            await update_topl(`Splat!  You hit ${mon_nam(mon)} with `
                + `${obj.known ? 'the' : cnt > 1 ? 'some' : 'a'} `
                + `${obj.known ? monster_by_pmidx(obj.corpsenm)?.name
                               : 'petrifying'} egg${plur(cnt)}!`);
            obj.known = 1;          /* (not much point...) */
            useup_eggs(obj);
            const { munstone } = await import('./muse.js');
            if (!await munstone(mon, true)) {
                /* mon.c minstapetrify(mon, TRUE) — unported (RNG-free) */
            }
            if (M.resists_ston(mon)) break;
            hmd.doreturn = true;
            hmd.retval = !DEADMONSTER(mon);
            return;
        } else {                    /* ordinary egg(s) */
            const mnum = obj.corpsenm;
            const eggp = (ismnum(mnum) && obj.known)
                ? the_uh(monster_by_pmidx(mnum)?.name)
                : (cnt > 1 ? 'some' : 'an');

            await update_topl(`You hit ${mon_nam(mon)} with ${eggp}`
                + ` egg${plur(cnt)}.`);
            if (touch_petrifies(hmd.mdat) && !stale_egg(obj)) {
                await update_topl(`The egg${plur(cnt)} `
                    + `${cnt === 1 ? "isn't" : "aren't"} alive any more...`);
                if (obj.timed) obj.timed = false;  /* obj_stop_timers(obj) */
                obj.otyp = ROCK;
                obj.oclass = GEM_CLASS;
                obj.oartifact = 0;
                obj.spe = 0;
                obj.known = obj.dknown = obj.bknown = 0;
                obj.owt = weight(obj);
                if (hmd.thrown) place_object(obj, mon.mx, mon.my);
            } else if (monster_by_pmidx(obj.corpsenm)?.name === 'pyrolisk') {
                useup_eggs(obj);
                const { explode } = await import('./explode.js');
                await explode(mon.mx, mon.my, -11, d(3, 6), 0, EXPL_FIERY);
                hmd.doreturn = true;
                hmd.retval = !DEADMONSTER(mon);
                return;
            } else {
                await update_topl('Splat!');
                useup_eggs(obj);
                exercise(A_WIS, false);
            }
        }
        break;
    }
    case CLOVE_OF_GARLIC:  /* no effect against demons */
        if (is_undead(hmd.mdat) || is_vampshifter(mon)) {
            const { monflee: monflee_full } = await import('./monmove.js');
            await monflee_full(mon, d(2, 4), false, true);
        }
        hmd.dmg = 1;
        break;
    case CREAM_PIE:
    case BLINDING_VENOM: {
        mon.msleeping = 0;
        const { can_blnd } = await import('./mhitm_ad.js');
        if (can_blnd(game.youmonst || game.u, mon,
                     (obj.otyp === BLINDING_VENOM) ? AT_SPIT : AT_WEAP, obj)) {
            if (Blind()) {
                await update_topl(obj.otyp === CREAM_PIE ? 'Splat!' : 'Splash!');
            } else if (obj.otyp === BLINDING_VENOM) {
                await update_topl(`The venom blinds ${mon_nam(mon)}`
                    + `${mon.mcansee ? '' : ' further'}!`);
            } else {
                let whom = mon_nam(mon);
                let what = The_uh(I.xname(obj));
                if (!hmd.thrown && (obj.quan ?? 1) > 1)
                    what = an(I.xname(obj));
                if (haseyes(hmd.mdat) && hmd.mdat?.pmidx !== PM_FLOATING_EYE) {
                    const { mbodypart } = await import('./monmove.js');
                    whom = `${s_suffix(whom)} ${mbodypart(mon, FACE)}`;
                }
                await update_topl(`${what} ${vtense_uh(what, 'splash')}`
                    + ` over ${whom}!`);
            }
            await setmangry(mon, true);
            mon.mcansee = 0;
            hmd.dmg = rn1(25, 21);
            if (((mon.mblinded | 0) + hmd.dmg) > 127) mon.mblinded = 127;
            else mon.mblinded = (mon.mblinded | 0) + hmd.dmg;
        } else {
            await update_topl(obj.otyp === CREAM_PIE ? 'Splat!' : 'Splash!');
            await setmangry(mon, true);
        }
        if (hmd.thrown) I.obfree(obj, null); else I.useup(obj);
        hmd.hittxt = true;
        hmd.get_dmg_bonus = false;
        hmd.dmg = 0;
        break;
    }
    case ACID_VENOM: {     /* thrown (or spit) */
        const { resists_acid } = await import('./mondata.js');
        if (resists_acid(mon)) {
            await update_topl(`Your venom hits ${mon_nam(mon)} harmlessly.`);
            hmd.dmg = 0;
        } else {
            await update_topl(`Your venom burns ${mon_nam(mon)}!`);
            hmd.dmg = dmgval(obj, mon);
        }
        if (hmd.thrown) I.obfree(obj, null); else I.useup(obj);
        hmd.hittxt = true;
        hmd.get_dmg_bonus = false;
        break;
    }
    default: {
        const mat = objects[obj.otyp]?.material ?? NO_MATERIAL;
        if ((mat === MAT_VEGGY || mat === MAT_PAPER)
            && obj.oclass !== SPBOOK_CLASS) {
            /* vegetables (and similar) aren't rigid enough to do damage; paper
               objects likewise, except for books */
            hmd.dmg = 0;
            hmd.get_dmg_bonus = false;
            break;
        }
        /* non-weapons damage by their weight (but not too much) */
        hmd.dmg = Math.trunc(((obj.owt | 0) + 99) / 100);
        hmd.dmg = (hmd.dmg <= 1) ? 1 : rnd(hmd.dmg);
        if (hmd.dmg > 6) hmd.dmg = 6;
        /* a wet towel gets a modest bonus beyond its weight, from its wetness;
           due to its low weight dmg is always 1 here, and spe is 1..7 */
        if (WPN.is_wet_towel(obj)) {
            const doubld = (mon.data?.name === 'iron golem');
            hmd.dmg += (obj.spe | 0) * (doubld ? 2 : 1);
            hmd.dmg = rnd(hmd.dmg);   /* wet towel damage is not capped at 6 */
            /* usually lose some wetness, but defer that until after the hit
               message */
            hmd.dryit = (rn2((obj.spe | 0) + 1) > 0);
        }
        /* things like silver wands reach here, so silver (and blessed) need
           another check */
        if (hmd.material === MAT_SILVER && M.mon_hates_silver(mon)) {
            hmd.dmg += rnd(20);
            hmd.silvermsg = hmd.silverobj = true;
        }
        if (obj.blessed && mon_hates_blessings(mon)) hmd.dmg += rnd(4);
    }
    }
}

// C ref: uhitm.c:1387 hmon_hitmon_do_hit(hmd, mon, obj) — dispatch to the
// bare-handed / weapon / potion / misc-object damage arm.  No RNG of its own.
export async function hmon_hitmon_do_hit(hmd, mon, obj) {
    if (!obj) {                       /* attack with bare hands */
        await hmon_hitmon_barehands(hmd, mon);
    } else {
        const I = await import('./invent.js');
        const A = await import('./artifact.js');
        /* a stone missile doesn't hurt a xorn or earth elemental, but also
           doesn't pass through and continue to a further target */
        if ((hmd.thrown === HMON_THROWN || hmd.thrown === HMON_KICKED)
            && stone_missile_uh(obj) && passes_rocks(hmd.mdat)) {
            const { update_topl } = await import('./display.js');
            /* mthrowu.c hit(mshot_xname(obj), mon, " but does no harm.") */
            await update_topl(`${The_uh(I.xname(obj))} `
                + `${vtense_uh(I.xname(obj), 'hit')} ${mon_nam(mon)}`
                + ` but does no harm.`);
            await wakeupAttack(mon, true);
            hmd.doreturn = true;
            hmd.retval = true;
            return;
        }
        /* remember obj's name: it might be destroyed and still be needed */
        if (!(A.artifact_light(obj) && obj.lamplit))
            hmd.saved_oname = I.xname(obj);   /* C: cxname(obj) */
        else
            hmd.saved_oname = A.bare_artifactname(obj);

        if (obj.oclass === WEAPON_CLASS || is_weptool(obj)
            || obj.oclass === GEM_CLASS) {
            await hmon_hitmon_weapon(hmd, mon, obj);
            if (hmd.doreturn) return;
        /* attacking with non-weapons */
        } else if (obj.oclass === POTION_CLASS) {
            await hmon_hitmon_potion(hmd, mon, obj);
            if (hmd.doreturn) return;
        } else {
            if (hmd.mdat?.name === 'shade' && !shade_aware(obj))
                hmd.dmg = 0;
            else
                await hmon_hitmon_misc_obj(hmd, mon, obj);
        }
    }
}
// C ref: obj.h stone_missile(o) — GEMSTONE or MINERAL material and not a ring
// (rings can be launched as missiles by an explosion).
const MAT_GEMSTONE = 20, MAT_MINERAL = 21, RING_CLASS_UH = 4;
function stone_missile_uh(o) {
    const mat = objects[o?.otyp]?.material ?? NO_MATERIAL;
    return (mat === MAT_GEMSTONE || mat === MAT_MINERAL)
        && o?.oclass !== RING_CLASS_UH;
}

// C ref: uhitm.c:1436 hmon_hitmon_dmg_recalc(hmd, obj) — the increase-damage /
// strength / weapon-skill bonuses.  No RNG (dbon() and weapon_dam_bonus() are
// table lookups); use_skill() only bumps a counter.
export async function hmon_hitmon_dmg_recalc(hmd, obj) {
    const I = await import('./invent.js');
    const WPN = await import('./weapon.js');
    const u = game.u;
    let dmgbonus = 0;

    /*
     * Potential bonus (or penalty) from a worn ring of increase damage (or the
     * intrinsic from eating one) and from strength.  The strength bonus rises
     * for melee with a two-handed weapon and falls for dual attacks (but when
     * both land, their total exceeds a single regular hit's bonus).
     */
    if (hmd.get_dmg_bonus) {
        /* for dual attacks udaminc applies to both; two-handed weapons use it
           as-is */
        dmgbonus = u.udaminc | 0;
        /* throwing with a propellor gets the increase-damage bonus but not the
           strength one; other attacks get both.  Dual attacks use 3/4 of the
           strength bonus (3/2 overall when both hit); a melee hit with a
           two-handed weapon uses 3/2 to approximately match two-weaponing.
           The 3/2 factor does not apply to polearms unless the hero is simply
           bashing with one, nor to jousting (lances are one-handed). */
        if (hmd.thrown !== HMON_THROWN
            || !obj || !game.uwep || !I.ammo_and_launcher(obj, game.uwep)) {
            let strbonus = dbon();
            const absbonus = Math.abs(strbonus);
            if (hmd.twohits)
                strbonus = Math.trunc((3 * absbonus + 2) / 4) * Math.sign(strbonus);
            else if (hmd.thrown === HMON_MELEE && game.uwep
                     && I.bimanual(game.uwep))
                strbonus = Math.trunc((3 * absbonus + 1) / 2) * Math.sign(strbonus);
            dmgbonus += strbonus;
        }
    }

    /*
     * Potential bonus (or penalty) from weapon skill.  use_weapon_skill is TRUE
     * for a hand-to-hand ordinary weapon, an applied or jousting polearm/lance,
     * a thrown missile (dart, shuriken, boomerang) or shot ammo; FALSE for a
     * hand-to-hand or thrown non-weapon, an unmounted polearm/lance, a
     * hand-to-hand missile/ammo/launcher, a thrown non-missile, or thrown ammo
     * without its launcher wielded.
     */
    if (hmd.use_weapon_skill) {
        let skillwep = obj;
        /* C ref: uhitm.c:72 `#define PROJECTILE(obj) ((obj) && is_ammo(obj))`
           — a file-local macro; is_missile() is NOT part of it. */
        if (obj && I.is_ammo(obj) && I.ammo_and_launcher(obj, game.uwep))
            skillwep = game.uwep;
        dmgbonus += (skillwep
            ? await weapon_dam_bonus_wielded(skillwep)
            : await weapon_dam_bonus_barehand());

        /* a hit for more than minimal damage (measured before the damage and
           skill bonuses) trains the skill toward future enhancement */
        if (hmd.train_weapon_skill) {
            const { use_skill, uwep_skill_type } = await import('./enhance.js');
            /* [this assumes that !thrown implies wielded...] */
            const wtype = hmd.thrown ? weapon_type(skillwep) : uwep_skill_type();
            use_skill(wtype, 1);
        }
    }

    /* apply the combined damage+strength and skill bonuses */
    hmd.dmg += dmgbonus;
    /* don't let a negative bonus turn a hit into a miss */
    if (hmd.dmg < 1) hmd.dmg = 1;
}

// C ref: uhitm.c:1510 hmon_hitmon_poison(hmd, mon, obj) — a poisoned weapon
// landed.  RNG order: rn2(nopoison) to wear the poison off, then (unless the
// target resists) rn2(10) and rnd(6).
export async function hmon_hitmon_poison(hmd, mon, obj) {
    const A = await import('./artifact.js');
    const { update_topl } = await import('./display.js');
    const u = game.u;
    let nopoison = 10 - Math.trunc((obj.owt | 0) / 10);

    if (nopoison < 2) nopoison = 2;
    if (roleMnum() === PM_SAMURAI) {
        await update_topl('You dishonorably use a poisoned weapon!');
        adjalign(-Math.sign(u.ualign?.type ?? 0));
    } else if ((u.ualign?.type ?? 0) === A_LAWFUL
               && (u.ualign?.record ?? 0) > -10) {
        await update_topl('You feel like an evil coward for using a poisoned'
            + ' weapon.');
        adjalign(-1);
    }
    if (!A.permapoisoned(obj) && !rn2(nopoison)) {
        /* remove the poison now, in case obj ends up in a bones file */
        obj.opoisoned = false;
        /* defer "obj is no longer poisoned" until after the hit message */
        hmd.unpoisonmsg = true;
    }
    if (resists_poison(mon)) hmd.needpoismsg = true;
    else if (rn2(10)) hmd.dmg += rnd(6);
    else hmd.poiskilled = true;
}

// C ref: uhitm.c:1541 hmon_hitmon_jousting(hmd, mon, obj) — a successful lance
// joust.  RNG: d(2, 10) (or d(2,2) for the off-hand lance) then, on
// hmd.jousting < 0, obj_resists() has already fired inside joust().
export async function hmon_hitmon_jousting(hmd, mon, obj) {
    const I = await import('./invent.js');
    const { update_topl } = await import('./display.js');
    hmd.dmg += d(2, (obj === game.uwep) ? 10 : 2);  /* [was in dmgval()] */
    await update_topl(`You joust ${mon_nam(mon)}`
        + `${canseemon(mon) ? exclam(hmd.dmg) : '.'}`);
    /* if this hit just broke the never-hit-with-wielded-weapon conduct
       (the caller bumped the counter), log that now */
    if ((game.u?.uconduct?.weaphit ?? 0) <= 1) first_weapon_hit(obj);

    if (hmd.jousting < 0) {
        /* (must be either primary or secondary weapon to get here) */
        game.u.twoweap = false;   /* wield.c set_twoweap(FALSE); untwoweapon()
                                   * is too verbose here */
        if (obj === game.uwep) game.unweapon = true;  /* uwepgone() */
        await update_topl(`${highc_uh(I.yname(obj))} shatters on impact!`);
        /* minor side-effect: a broken lance won't split puddings */
        I.useup(obj);
        obj = null;
    }
    if (await mhurtle_to_doom(mon, hmd.dmg, hmd)) hmd.already_killed = true;
    hmd.hittxt = true;
}

// C ref: uhitm.c:1570 hmon_hitmon_stagger(hmd, mon, obj) — a martial-arts punch
// may knock the target back.  RNG: rnd(100), unconditionally.
export async function hmon_hitmon_stagger(hmd, mon, _obj) {
    const { p_skill_of } = await import('./enhance.js');
    /* VERY small chance of stunning the opponent if unarmed */
    if (rnd(100) < p_skill_of(P_BARE_HANDED_COMBAT) && !bigmonst(hmd.mdat)
        && !thick_skinned(hmd.mdat)) {
        if (canspotmon(mon)) {
            const { update_topl } = await import('./display.js');
            /* mondata.c stagger(ptr, "stagger") picks the body-appropriate
               verb; makeplural() then agrees it with Monnam() */
            const I = await import('./invent.js');
            await update_topl(`${Monnam(mon)} ${I.makeplural('stagger')}`
                + ` from your powerful strike!`);
        }
        if (await mhurtle_to_doom(mon, hmd.dmg, hmd)) hmd.already_killed = true;
        hmd.hittxt = true;
    }
}

// C ref: uhitm.c:1604 hmon_hitmon_splitmon(hmd, mon, obj) — an iron or metal
// melee hit splits a black/brown pudding.  mon.c clone_mon() has no port, so
// the split (and the mintrap() that follows it) is a wiring blocker.
export async function hmon_hitmon_splitmon(hmd, mon, obj) {
    const I = await import('./invent.js');
    if ((hmd.mdat?.name === 'black pudding' || hmd.mdat?.name === 'brown pudding')
        /* pudding is alive and healthy enough to split */
        && mon.mhp > 1 && !mon.mcan && !hmd.offmap
        /* iron (3.6.1: or metal) weapon, melee or polearm; when two-weaponing
           either weapon can cause the split */
        && obj && (obj === game.uwep
                   || (game.u?.twoweap && obj === game.uswapwep))
        && ((hmd.material === MAT_IRON
             /* allow scalpel and tsurugi to split puddings */
             || hmd.material === MAT_METAL)
            /* but not bashing with darts, arrows or ya */
            && !(I.is_ammo(obj) || I.is_missile(obj)))
        && hmd.hand_to_hand) {
        /* mon.c clone_mon(mon, 0, 0) — unported; it draws for the clone's
           placement and hit points, and the
           mintrap(mclone, NO_TRAP_FLAGS) that follows draws for whatever trap
           the clone lands on.  Both are wiring blockers. */
        void NO_TRAP_FLAGS;
    }
}

// C ref: uhitm.c:1637 hmon_hitmon_msg_hit(hmd, mon, obj) — the "You hit <mon>!"
// line, suppressed once hittxt was set or the target was destroyed.  No RNG.
export async function hmon_hitmon_msg_hit(hmd, mon, obj) {
    if (!hmd.hittxt
        && (!hmd.destroyed
            || (hmd.thrown && (game.m_shot?.n ?? 0) > 1
                && game.m_shot?.o === obj.otyp))) {
        const { update_topl } = await import('./display.js');
        const I = await import('./invent.js');
        const WPN = await import('./weapon.js');
        const verbose = game.flags?.verbose !== false;
        if (hmd.thrown) {
            /* mthrowu.c hit(mshot_xname(obj), mon, exclam(dmg)) */
            const nm = I.xname(obj);
            if ((!cansee(game.bhitpos?.x, game.bhitpos?.y) && !canspotmon(mon))
                || !verbose)
                await update_topl(`${The_uh(nm)} ${vtense_uh(nm, 'hit')} it.`);
            else
                await update_topl(`${The_uh(nm)} ${vtense_uh(nm, 'hit')}`
                    + ` ${mon_nam(mon)}${exclam(hmd.dmg)}`);
        } else if (!verbose) {
            await update_topl('You hit it.');
        } else {   /* hand_to_hand */
            const verb =
                (obj && (is_shield_uh(obj) || obj.otyp === HEAVY_IRON_BALL))
                    ? 'bash'
                : (obj && ((objects[obj.otyp]?.oc_skill ?? 0) === P_WHIP
                           || WPN.is_wet_towel(obj))) ? 'lash'
                : (roleMnum() === PM_BARBARIAN) ? 'smite'
                : 'hit';
            await update_topl(`You ${verb} ${mon_nam(mon)}`
                + `${canseemon(mon) ? exclam(hmd.dmg) : '.'}`);
        }
    }
}

// C ref: uhitm.c:1663 hmon_hitmon_msg_silver(hmd, mon, obj) — the silver-sear
// message.  No RNG.
export async function hmon_hitmon_msg_silver(hmd, mon, _obj) {
    const { update_topl } = await import('./display.js');
    let whom = mon_nam(mon);
    let fmt;

    if (canspotmon(mon)) {
        if (hmd.barehand_silver_rings === 1)
            fmt = 'Your silver ring sears %s!';
        else if (hmd.barehand_silver_rings === 2)
            fmt = 'Your silver rings sear %s!';
        else if (hmd.silverobj && hmd.saved_oname)
            fmt = `Your ${/silver/.test(hmd.saved_oname) ? '' : 'silver '}`
                + `${hmd.saved_oname} `
                + `${vtense_uh(hmd.saved_oname, 'sear')} %s!`;
        else
            fmt = 'The silver sears %s!';
    } else {
        whom = highc_uh(whom);     /* "it" -> "It" */
        fmt = '%s is seared!';
    }
    if (!noncorporeal(hmd.mdat) && !amorphous(hmd.mdat))
        whom = `${s_suffix(whom)} flesh`;
    await update_topl(fmt.replace('%s', whom));
}

// C ref: uhitm.c:1702 hmon_hitmon_msg_lightobj(hmd, mon, obj) — the
// light-emitting-artifact sear message.  No RNG.
export async function hmon_hitmon_msg_lightobj(hmd, mon, _obj) {
    const { update_topl } = await import('./display.js');
    let whom = mon_nam(mon);
    let fmt;

    if (canspotmon(mon)) {
        if (hmd.saved_oname)
            fmt = `${s_suffix(hmd.saved_oname)} radiance penetrates deep into %s!`;
        else
            fmt = 'The light sears %s!';
    } else {
        whom = highc_uh(whom);     /* "it" -> "It" */
        fmt = '%s is seared!';
    }
    if (!noncorporeal(hmd.mdat) && !amorphous(hmd.mdat))
        whom = `${s_suffix(whom)} flesh`;
    await update_topl(fmt.replace('%s', whom));
}

// C ref: uhitm.c:1942 mhurtle_to_doom(mon, tmp, mptr) — a joust or martial-arts
// punch knocks the target back, which may kill it (via a trap) before
// known_hitum() gets the chance.  Returns TRUE if 'mon' died.
//
// The third C argument is `struct permonst **mptr`, the caller's cached
// mon->data; this port passes the hmd record instead and writes hmd.mdat.
// dothrow.c mhurtle() has no port (js/apply.js keeps an empty ap_hurtle()), so
// the knockback itself — and the mintrap() at the landing square, which is
// where the RNG is — is a wiring blocker.
export async function mhurtle_to_doom(mon, tmp, hmd) {
    /* only hurtle if the pending physical damage isn't going to kill mon */
    if (tmp < mon.mhp) {
        /* dothrow.c mhurtle(mon, u.dx, u.dy, 1) — unported */
        /* update the caller's cached mon->data: mon might have been pushed onto
           a polymorph trap, or be a vampshifter whose current form was killed
           by a trap and reverted */
        if (hmd) hmd.mdat = mon.data;
        if (DEADMONSTER(mon)) return true;
    }
    return false;   /* mon isn't dead yet */
}

// C ref: uhitm.c:1963 first_weapon_hit(weapon) — the gamelog line for breaking
// never-hit-with-a-wielded-weapon conduct.  The conduct itself is counted in
// known_hitum(); this is called from hmon_hitmon().  No RNG.
export function first_weapon_hit(weapon) {
    let buf = '';
    /* avoid xname(), which would include a player-supplied "named <foo>" */
    if (weapon.cursed && weapon.bknown) buf += 'cursed ';
    /* objnam.c obj_is_pname(weapon) — a fully identified artifact keeps its own
       name; this port has no ONAME(), so simpleonames() covers both arms and
       the artifact suffix is appended as C does for the non-pname case. */
    buf += objectBaseName(weapon);
    livelog_printf(LL_CONDUCT,
        `hit with a wielded weapon (${buf}) for the first time`);
}

// C ref: uhitm.c:1992 shade_aware(obj) — objects that either affect shades or
// are handled correctly for shades elsewhere.  No RNG.
export function shade_aware(obj) {
    if (!obj) return false;
    return obj.otyp === BOULDER
        || obj.otyp === HEAVY_IRON_BALL
        || obj.otyp === IRON_CHAIN         /* dmgval handles those three */
        || obj.otyp === MIRROR             /* silver in the reflective surface */
        || obj.otyp === CLOVE_OF_GARLIC    /* causes shades to flee */
        || (objects[obj.otyp]?.material ?? NO_MATERIAL) === MAT_SILVER;
}

// C ref: uhitm.c:2016 shade_miss(magr, mdef, obj, thrown, verbose) — a
// non-silver, non-blessed blow passes harmlessly through a shade.  dmgval() is
// used here for zero/non-zero only, so its internal silver rnd(20) can fire.
export async function shade_miss(magr, mdef, obj, thrown, verbose) {
    const youagr = (magr === game.youmonst || magr === game.u);
    const youdef = (mdef === game.youmonst || mdef === game.u);

    if (mdef.data?.name !== 'shade' || (obj && dmgval(obj, mdef)))
        return false;

    if (verbose
        && ((youdef || cansee(mdef.mx, mdef.my) || sensemon(mdef))
            || (youagr && m_next2u(mdef)))) {
        const I = await import('./invent.js');
        const { update_topl } = await import('./display.js');
        const harmlessly_thru = ' harmlessly through ';
        const what = (!obj || shade_aware(obj)) ? 'attack' : I.xname(obj);
        const target = youdef ? 'you' : mon_nam(mdef);
        if (!thrown) {
            const whose = youagr ? 'Your' : s_suffix(Monnam(magr));
            await update_topl(`${whose} ${what} ${vtense_uh(what, 'pass')}`
                + `${harmlessly_thru}${target}.`);
        } else {
            /* note: The(), not pline_The() */
            await update_topl(`${The_uh(what)} ${vtense_uh(what, 'pass')}`
                + `${harmlessly_thru}${target}.`);
        }
        if (!youdef && !canspotmon(mdef)) map_invisible(mdef.mx, mdef.my);
    }
    if (!youdef) mdef.msleeping = 0;
    return true;
}

// C ref: uhitm.c:2056 m_slips_free(mdef, mattk) — greased or oilskin armour
// makes the hero's grab slip off.  RNG: rn2(3) only when the armour is cursed,
// then rn2(2) for the grease wearing off.
export async function m_slips_free(mdef, mattk) {
    const { which_armor } = await import('./worn.js');
    let obj;

    if (mattk.adtyp === AD_DRIN) {
        /* intelligence drain attacks the head */
        obj = which_armor(mdef, W_ARMH);
    } else {
        /* grabbing attacks the body */
        obj = which_armor(mdef, W_ARMC);            /* cloak */
        if (!obj) obj = which_armor(mdef, W_ARM);   /* suit */
        if (!obj) obj = which_armor(mdef, W_ARMU);  /* shirt */
    }

    /* if the monster's cloak/armour is greased the grab slips off; this
       protection can fail (33%) when the armour is cursed */
    if (obj && (obj.greased || obj.otyp === OILSKIN_CLOAK)
        && (!obj.cursed || rn2(3))) {
        const I = await import('./invent.js');
        const { update_topl } = await import('./display.js');
        /* avoid "slippery slippery cloak" for an undiscovered oilskin cloak */
        const what = (obj.greased || objects[obj.otyp]?.oc_name_known)
            ? I.xname(obj) : 'cloak';
        await update_topl(`You `
            + `${(mattk.adtyp === AD_WRAP) ? 'slip off of'
                                           : 'grab, but cannot hold onto'} `
            + `${s_suffix(mon_nam(mdef))} `
            + `${obj.greased ? 'greased' : 'slippery'} ${what}!`);

        if (obj.greased && !rn2(2)) {
            await update_topl('The grease wears off.');
            obj.greased = 0;
        }
        return true;
    }
    return false;
}

// C ref: uhitm.c:2098 joust(mon, obj) — 1: joust hit, 0: ordinary hit,
// -1: joust that breaks the lance.  RNG: rn2(5), then on a 0 roll rnl(50) and
// obj_resists(obj, 0, 100).
export async function joust(mon, obj) {
    const u = game.u;
    if (Fumbling() || Stunned_uh()) return 0;
    /* sanity check: the lance must be wielded in order to joust */
    if (obj !== game.uwep && (obj !== game.uswapwep || !u.twoweap)) return 0;
    /* can't joust while trapped -- not enough room to maneuver */
    if (u.utrap) return 0;

    const { p_skill_of } = await import('./enhance.js');
    /* if using two weapons, use the worse of the lance and two-weapon skills */
    let skill_rating = p_skill_of(weapon_type(obj));
    if (u.twoweap && p_skill_of(P_TWO_WEAPON_COMBAT) < skill_rating)
        skill_rating = p_skill_of(P_TWO_WEAPON_COMBAT);
    if (skill_rating === P_ISRESTRICTED)
        skill_rating = P_UNSKILLED;   /* 0 => 1 */

    /* odds to joust: expert 80%, skilled 60%, basic 40%, unskilled 20% */
    const joust_dieroll = rn2(5);
    if (joust_dieroll < skill_rating) {
        const I = await import('./invent.js');
        if (joust_dieroll === 0 && rnl(50) === (50 - 1)
            && !unsolid(mon.data) && !I.obj_resists(obj, 0, 100))
            return -1;   /* hit that breaks the lance */
        return 1;        /* successful joust */
    }
    return 0;            /* no joust bonus; revert to an ordinary attack */
}

// C ref: uhitm.c:2133 demonpet() — a poly'd demon hero summons help.
// RNG: rn2(6), then ndemon()'s own rolls, then makemon() and tamedog().
export async function demonpet() {
    const u = game.u;
    const { update_topl } = await import('./display.js');
    await update_topl('Some hell-p has arrived!');
    /* makemon.c ndemon(alignment) — unported; it does its own rn2() scan over
       the demon class, so the !rn2(6) below is only the gate. */
    const i = !rn2(6) ? -1 /* ndemon(u.ualign.type) */ : -1 /* NON_PM */;
    const pm = (i !== -1) ? monster_by_pmidx(i) : (game.youmonst?.data ?? null);
    const { makemon } = await import('./makemon.js');
    const dtmp = makemon(pm, u.ux, u.uy, 0 /* NO_MM_FLAGS */);
    if (dtmp) {
        const { tamedog } = await import('./dothrow.js');
        await tamedog(dtmp, null, false);
    }
    exercise(A_WIS, true);
}

// C ref: uhitm.c:2148 theft_petrifies(otmp) — stealing a cockatrice corpse
// bare-handed is fatal.  No RNG (instapetrify -> done()).
export function theft_petrifies(otmp) {
    if (game.uarmg || otmp.otyp !== CORPSE
        || !touch_petrifies(monster_by_pmidx(otmp.corpsenm))
        || Stone_resistance())
        return false;

    /* stealing this corpse is fatal...  polyself.c instapetrify(kbuf) has no
       port; the poly_when_stoned()/PM_STONE_GOLEM arm is #if 0 in C too. */
    return true;
}

// C ref: uhitm.c:2174 steal_it(mdef, mattk) — the hero's (poly'd) theft attack.
// If the target wears body armour, take everything; otherwise take one object.
// No RNG of its own; hold_another_object() and possibly_unwield() draw.
export async function steal_it(mdef, mattk) {
    const I = await import('./invent.js');
    const { update_topl } = await import('./display.js');
    const { could_seduce } = await import('./mhitu.js');
    const { findgold } = await import('./steal.js');
    const { mpickobj } = await import('./makemon.js');
    const A = await import('./artifact.js');
    const WPN = await import('./weapon.js');

    let otmp = (mdef.minvent || [])[0];
    if (!otmp || (otmp.oclass === COIN_CLASS && (mdef.minvent || []).length === 1))
        return;    /* nothing to take */

    /* look for worn body armour, moving it to the end of minvent as we go */
    let ustealo = null;
    if (could_seduce(game.youmonst || game.u, mdef, mattk) && mdef.mcanmove) {
        const rest = [];
        for (const o of (mdef.minvent || [])) {
            if (o.owornmask & W_ARM) ustealo = o; else rest.push(o);
        }
        mdef.minvent = ustealo ? rest.concat([ustealo]) : rest;
    }
    let gold = findgold(mdef.minvent);

    if (ustealo) {   /* we will be taking everything */
        if (Mgender(mdef) === (game.u?.mfemale ? FEMALE_G : MALE_G)
            && (game.youmonst?.data?.mcls === S_NYMPH))
            await update_topl(`You charm ${mon_nam(mdef)}.  `
                + `${upstart(mhe(mdef))} gladly hands over `
                + `${!gold ? '' : 'most of '}${mhis(mdef)} possessions.`);
        else
            await update_topl(`You seduce ${mon_nam(mdef)} and ${mhe(mdef)}`
                + ` starts to take off ${mhis(mdef)} clothes.`);
    }

    /* keep gold out of the selection so steal-item isn't a superset of
       steal-gold; it goes back in if either side dies */
    if (gold) I.obj_extract_self(gold);

    while ((otmp = (mdef.minvent || [])[0]) != null) {
        if (gold) { mpickobj(mdef, gold); gold = null; }
        if (!Upolyd()) break;      /* no longer have the ability to steal */
        const unwornmask = otmp.owornmask | 0;
        /* doname() would do this when formatting for hold_another_object(), but
           we want it done while otmp is still in mdef's inventory */
        if (otmp.oartifact && !Blind()) A.find_artifact(otmp);
        /* take the object away from the monster (muse.c
           extract_from_minvent(mdef, otmp, TRUE, FALSE) is file-static there) */
        mdef.minvent = (mdef.minvent || []).filter((o) => o !== otmp);
        otmp.owornmask = 0;
        /* special message for the final item; ustealo is only ever set on an
           object with (owornmask & W_ARM) */
        if (otmp === ustealo)
            await update_topl(`${Monnam(mdef)} finishes taking off`
                + ` ${mhis(mdef)} suit.`);
        /* give the object to the character */
        otmp = await I.hold_another_object(otmp, 'You snatched but dropped %s.',
                                          I.xname(otmp), 'You steal: ');
        /* might have dropped otmp, and it might have broken or left the level */
        if (!otmp || otmp.where !== 3 /* OBJ_INVENT */) continue;
        if (theft_petrifies(otmp))
            break;   /* stop thieving even though the hero survived */
        /* more take-away handling, after the theft message */
        if (unwornmask & W_WEP) {
            WPN.possibly_unwield(mdef, false);
        } else if (unwornmask & W_ARMG) {
            /* mon.c mselftouch(mdef, 0, TRUE) — unported; a monster whose
               gloves were stolen while wielding a c'trice corpse petrifies. */
            if (DEADMONSTER(mdef)) break;
        }

        if (!ustealo) break;   /* only taking one item */

        /* take gold out of minvent before the next selection; if it is the only
           thing left the loop terminates and it is put back below */
        if ((gold = findgold(mdef.minvent)) != null) I.obj_extract_self(gold);
    }

    /* put the gold back; this won't happen if either the hero or 'mdef' died,
       because then the gold is already back in the monster's inventory */
    if (gold) mpickobj(mdef, gold);
}

// C ref: uhitm.c:4835 damageum(mdef, mattk, specialdmg) — a poly'd hero's
// non-weapon attack lands.  RNG order: d(damn, damd) FIRST, then the demon-pet
// rn2(13) (only reached when the hero's form is a demon), then
// mhitm_adtyping().
export async function damageum(mdef, mattk, specialdmg) {
    const mhm = {
        damage: d(mattk.damn | 0, mattk.damd | 0),
        hitflags: M_ATTK_MISS,
        permdmg: 0,
        specialdmg,
        done: false,
    };

    const ydata = game.youmonst?.data;
    if (is_demon_uh(ydata) && !rn2(13) && !game.uwep
        && ydata?.name !== 'amorous demon' && ydata?.name !== 'balrog') {
        await demonpet();
        return M_ATTK_MISS;
    }

    const { mhitm_adtyping } = await import('./mhitm_ad.js');
    await mhitm_adtyping(game.youmonst || game.u, mattk, mdef, mhm);

    if (mhm.done) return mhm.hitflags;

    mdef.mstrategy = (mdef.mstrategy | 0) & ~STRAT_WAITFORU;   /* in case the player is very fast */
    mdef.mhp -= mhm.damage;
    if (DEADMONSTER(mdef)) {
        /* a troll killed by Trollsbane won't auto-revive */
        if (mattk.aatyp === AT_WEAP || mattk.aatyp === AT_CLAW) {
            /* mondata.c troll_baned(mdef, uwep) — unported */
            game.mkcorpstat_norevive = false;
        }
        /* (DEADMONSTER(mdef) and !mhm.damage => already killed) */
        if (mdef.mtame && !cansee(mdef.mx, mdef.my)) {
            const { update_topl } = await import('./display.js');
            await update_topl('You feel embarrassed for a moment.');
            if (mhm.damage) await killed(mdef, { nomsg: true });
        } else if (game.flags?.verbose === false) {
            const { update_topl } = await import('./display.js');
            await update_topl('You destroy it!');
            if (mhm.damage) await killed(mdef, { nomsg: true });
        } else if (mhm.damage) {
            await killed(mdef);   /* regular "you kill <mdef>" message */
        }
        game.mkcorpstat_norevive = false;
        return M_ATTK_DEF_DIED;
    }
    return M_ATTK_HIT;
}

// C ref: uhitm.c:4891 explum(mdef, mattk) — a poly'd hero with an exploding
// attack goes off.  RNG: d(damn, damd) first, then explode()'s own rolls.
export async function explum(mdef, mattk) {
    const u = game.u;
    const { update_topl } = await import('./display.js');
    const tmp = d(mattk.damn | 0, mattk.damd | 0);

    switch (mattk.adtyp) {
    case AD_BLND:
        if (mdef && !resists_blnd(mdef)) {
            await update_topl(`${Monnam(mdef)} is blinded by your flash of`
                + ` light!`);
            mdef.mblinded = Math.min((mdef.mblinded | 0) + tmp, 127);
            mdef.mcansee = 0;
        }
        break;
    case AD_HALU:
        if (mdef && haseyes(mdef.data) && mdef.mcansee) {
            await update_topl(`${Monnam(mdef)} is affected by your flash of`
                + ` light!`);
            mdef.mconf = 1;
        }
        break;
    case AD_COLD:
    case AD_FIRE:
    case AD_ELEC: {
        /* see mon_explodes() and zap.c for this math: the player is causing the
           explosion, so the type is +20..+29 rather than negative */
        const { explode, adtyp_to_expltype } = await import('./explode.js');
        await explode(u.ux, u.uy, (mattk.adtyp - 1) + 20, tmp, MON_EXPLODE,
                      adtyp_to_expltype(mattk.adtyp));
        if (mdef && DEADMONSTER(mdef)) {
            /* other monsters may have died too, but only report the target */
            return M_ATTK_DEF_DIED;
        }
        break;
    }
    default:
        break;
    }
    const { wake_nearto } = await import('./cmd.js');
    await wake_nearto(u.ux, u.uy, 7 * 7);   /* same radius as an exploding mon */
    return M_ATTK_HIT;
}

// C ref: uhitm.c:4931 start_engulf(mdef) — the swallow animation.  No RNG in
// the C path this port can reach: rn2_on_display_rng() draws from the display
// RNG, which is a separate stream.
export async function start_engulf(mdef) {
    const u = game.u;
    const u_digest = digests(game.youmonst?.data);
    const u_enfold = enfolds(game.youmonst?.data);
    /* display.c map_location()/tmp_at()/mon_to_glyph() have no port: the
       swallow animation is display-only. */
    const { update_topl } = await import('./display.js');
    await update_topl(`You `
        + `${u_digest ? 'swallow' : u_enfold ? 'enclose' : 'engulf'} `
        + `${mon_nam(mdef)}${u_digest ? ' whole' : ''}!`);
    /* nh_delay_output() twice */
}

// C ref: uhitm.c:4949 end_engulf() — tear down the swallow animation.  No RNG.
export function end_engulf() {
    if (!Invisible_uh()) {
        /* display.c tmp_at(DISP_END, 0) — no port */
        newsym(game.u?.ux, game.u?.uy);
    }
}

// C ref: uhitm.c:4958 gulpum(mdef, mattk) — a poly'd hero engulfs/swallows.
//
// RNG order: `dam = d(damn, damd)` is an initialiser, so it fires BEFORE the
// engulf_target() gate — even a target that can't be engulfed consumes it.
// After that, per adtyp: AD_ELEC/AD_COLD/AD_FIRE each roll rn2(2) first,
// AD_DREN rolls rn2(4), and the AD_DGST kill path runs corpse_chance().
export async function gulpum(mdef, mattk) {
    const u = game.u;
    const { update_topl } = await import('./display.js');
    let dam = d(mattk.damn | 0, mattk.damd | 0);
    let tmp;
    const ydata = game.youmonst?.data;
    const u_digest = digests(ydata), u_enfold = enfolds(ydata);
    const pd = mdef.data;
    const expel_verb = u_digest ? 'regurgitate' : u_enfold ? 'release' : 'expel';

    /*
     * Not totally the same as for real monsters.  These don't take multiple
     * moves: we arbitrarily kill the monster immediately for AD_DGST and
     * regurgitate it after exactly one round of attack otherwise.  -KAA
     */

    if (!engulf_target_uh(game.youmonst || game.u, mdef)) return M_ATTK_MISS;

    if (!(u_digest && (u.uhunger | 0) >= 1500) && !u.uswallow) {
        if (!flaming(ydata)) {
            const { snuff_lit } = await import('./apply.js');
            for (const otmp of (mdef.minvent || [])) snuff_lit(otmp);
        }

        /* force a vampire in bat, cloud or wolf form back to vampire form now,
           rather than dealing with it when it dies */
        const { newcham } = await import('./makemon.js');
        if (is_vampshifter(mdef) && newcham(mdef, monster_by_pmidx(mdef.cham))) {
            await update_topl(`You `
                + `${u_digest ? 'swallow' : u_enfold ? 'enclose' : 'engulf'}`
                + ` it, then ${expel_verb} it.`);
            if (canspotmon(mdef)) {
                /* avoiding a_monnam here: a named target would give "You bite
                   Dracula.  You swallow it, then regurgitate it.  It turns into
                   Dracula." */
                await update_topl(`It turns into `
                    + `${x_monnam(mdef, ARTICLE_A, null,
                                  (SUPPRESS_NAME | SUPPRESS_IT
                                   | SUPPRESS_INVISIBLE), false)}.`);
            } else {
                map_invisible(mdef.mx, mdef.my);
            }
            return M_ATTK_HIT;
        }

        /* engulfing a cockatrice, or digesting a Rider or Medusa */
        const fatal_gulp = (touch_petrifies(pd) && !Stone_resistance())
            || (mattk.adtyp === AD_DGST
                && (is_rider(pd) || (pd?.name === 'Medusa'
                                     && !Stone_resistance())));

        if (mattk.adtyp === AD_DGST && (!Slow_digestion() || fatal_gulp)) {
            /* eat.c eating_conducts(pd) — conduct bookkeeping, no RNG */
        }

        if (fatal_gulp && !is_rider(pd)) {   /* petrification */
            await update_topl(`You ${u_digest ? 'englut' : 'engulf'}`
                + ` ${mon_nam(mdef)}.`);
            /* polyself.c instapetrify(kbuf) — unported (ends the game) */
        } else {
            await start_engulf(mdef);
            switch (mattk.adtyp) {
            case AD_DGST: {
                /* eating a Rider or its corpse is fatal */
                if (is_rider(pd)) {
                    await update_topl('Unfortunately, digesting any of it is'
                        + ' fatal.');
                    end_engulf();
                    /* done(DIED) — no port; returns M_ATTK_MISS if lifesaved */
                    return M_ATTK_MISS;
                }

                if (Slow_digestion()) { dam = 0; break; }

                /* use up an amulet of life saving */
                const { mlifesaver } = await import('./mon.js');
                const saver = mlifesaver(mdef);
                if (saver) {
                    const { m_useup } = await import('./muse.js');
                    m_useup(mdef, saver);
                }

                const { newuhs } = await import('./eat.js');
                await newuhs(false);
                /* start_engulf() gave "you engulf <mdef>"; C wants the explicit
                   "you kill <mdef>" here so a "welcome to level N+1" isn't
                   printed out of order */
                game.mswallower = game.youmonst || game.u;
                await killed(mdef, { nocorpse: true });
                if (!DEADMONSTER(mdef)) {   /* monster lifesaved */
                    const { body_part } = await import('./invent.js');
                    await update_topl(`You hurriedly regurgitate the sizzling`
                        + ` in your ${body_part(STOMACH)}.`);
                } else {
                    tmp = 1 + ((pd?.cwt | 0) >> 8);
                    if (corpse_chance(mdef) && !mon_nocorpse(pd)) {
                        /* nutrition only if there can be a corpse */
                        u.uhunger = (u.uhunger | 0)
                            + Math.trunc(((pd?.cnutrit | 0) + 1) / 2);
                    } else {
                        tmp = 0;
                    }
                    const msgbuf = `You totally digest ${mon_nam(mdef)}.`;
                    if (tmp !== 0) {
                        await update_topl(`You digest ${mon_nam(mdef)}.`);
                        if (Slow_digestion()) tmp *= 2;
                        const { nomul } = await import('./hack.js');
                        await nomul(-tmp);
                        game.multi_reason = 'digesting something';
                        game.nomovemsg = msgbuf;
                        /* possible intrinsic once totally digested */
                        game.corpsenm_digested = pd?.pmidx;
                        /* ga.afternmv = Finish_digestion — no port */
                    } else {
                        await update_topl(msgbuf);
                    }
                    if (pd?.name === 'green slime') {
                        /* make_slimed(5L, 0) — no port */
                    } else {
                        exercise(A_CON, true);
                    }
                }
                game.mswallower = null;
                end_engulf();
                return M_ATTK_DEF_DIED;
            }
            case AD_PHYS:
                if (ydata?.name === 'fog cloud') {
                    await update_topl(`${Monnam(mdef)} is laden with your`
                        + ` moisture.`);
                    if ((breathless(pd) || amphibious(pd)) && !flaming(pd)) {
                        dam = 0;
                        await update_topl(`${Monnam(mdef)} seems unharmed.`);
                    }
                } else {
                    await update_topl(`${Monnam(mdef)} is `
                        + `${enfolds(ydata) ? 'being squashed'
                                            : 'pummeled with your debris'}!`);
                }
                break;
            case AD_ACID: {
                const { resists_acid } = await import('./mondata.js');
                await update_topl(`${Monnam(mdef)} is covered with your goo!`);
                if (resists_acid(mdef)) {
                    await update_topl(`It seems harmless to`
                        + ` ${mon_nam(mdef)}.`);
                    dam = 0;
                }
                break;
            }
            case AD_BLND: {
                const { can_blnd } = await import('./mhitm_ad.js');
                if (can_blnd(game.youmonst || game.u, mdef, mattk.aatyp, null)) {
                    if (mdef.mcansee)
                        await update_topl(`${Monnam(mdef)} can't see in there!`);
                    mdef.mcansee = 0;
                    dam += (mdef.mblinded | 0);
                    if (dam > 127) dam = 127;
                    mdef.mblinded = dam;
                }
                dam = 0;
                break;
            }
            case AD_ELEC: {
                if (rn2(2)) {
                    const { resists_elec } = await import('./mondata.js');
                    await update_topl(`The air around ${mon_nam(mdef)} crackles`
                        + ` with electricity.`);
                    if (resists_elec(mdef)) {
                        await update_topl(`${Monnam(mdef)} seems unhurt.`);
                        dam = 0;
                    }
                    /* mhitm_ad.c golemeffects(mdef, adtyp, dam) is file-static
                       in js/mhitm_ad.js; RNG-free for elec/cold/fire golems */
                } else {
                    dam = 0;
                }
                break;
            }
            case AD_COLD: {
                if (rn2(2)) {
                    const { resists_cold } = await import('./mondata.js');
                    if (resists_cold(mdef)) {
                        await update_topl(`${Monnam(mdef)} seems mildly`
                            + ` chilly.`);
                        dam = 0;
                    } else {
                        await update_topl(`${Monnam(mdef)} is freezing to`
                            + ` death!`);
                    }
                } else {
                    dam = 0;
                }
                break;
            }
            case AD_FIRE: {
                if (rn2(2)) {
                    const { resists_fire } = await import('./mondata.js');
                    if (resists_fire(mdef)) {
                        await update_topl(`${Monnam(mdef)} seems mildly hot.`);
                        dam = 0;
                    } else {
                        await update_topl(`${Monnam(mdef)} is burning to a`
                            + ` crisp!`);
                    }
                } else {
                    dam = 0;
                }
                break;
            }
            case AD_DREN:
                if (!rn2(4)) {
                    /* mhitm_ad.c xdrainenergym(mdef, TRUE) — no port */
                }
                dam = 0;
                break;
            default:
                break;
            }
            end_engulf();
            mdef.mhp -= dam;
            if (DEADMONSTER(mdef)) {
                await killed(mdef);
                if (DEADMONSTER(mdef))   /* not lifesaved */
                    return M_ATTK_DEF_DIED;
            }
            await update_topl(`You ${expel_verb} ${mon_nam(mdef)}!`);
            if ((Slow_digestion() || is_animal_uh(ydata)) && u_digest) {
                await update_topl(`Obviously, you didn't like`
                    + ` ${s_suffix(mon_nam(mdef))} taste.`);
            }
        }
    }
    return M_ATTK_MISS;
}

// C ref: uhitm.c:5218 m_is_steadfast(mtmp) — equipment that protects against
// knockback.  No RNG.
export async function m_is_steadfast(mtmp) {
    const is_u = (mtmp === game.youmonst || mtmp === game.u);
    const u = game.u;
    const otmp = is_u ? game.uwep : MON_WEP_uh(mtmp);
    const A = await import('./artifact.js');
    const { Is_airlevel, Is_waterlevel } = await import('./const.js');
    const { is_pool } = await import('./dbridge.js');

    /* must be on the ground (or in water) */
    if ((is_u ? (Flying_uh() || Levitation_uh())
              : (is_flyer(mtmp.data) || is_floater(mtmp.data)))
        || Is_airlevel(u?.uz)                          /* air or cloud */
        || (Is_waterlevel(u?.uz) && !is_pool(u.ux, u.uy)))  /* air bubble */
        return false;

    if (A.is_art(otmp, ART_GIANTSLAYER)) return true;

    /* steadfast if carrying any loadstone (and not floating or flying);
       m_carrying() is 'youmonst' aware in C, so 'is_u' isn't tested */
    const { m_carrying } = await import('./monmove.js');
    const I = await import('./invent.js');
    if (is_u ? I.carrying(LOADSTONE) : m_carrying(mtmp, LOADSTONE)) return true;
    /* when mounted and the steed is the knockback target, check the rider for a
       loadstone too (Giantslayer's protection doesn't extend to the steed) */
    if (u?.usteed && mtmp === u.usteed && I.carrying(LOADSTONE)) return true;

    return false;
}
// C ref: youprop.h Flying/Levitation.
function Flying_uh() { return (u_of().uprops?.Flying || 0) > 0; }
function Levitation_uh() { return (u_of().uprops?.Levitation || 0) > 0; }

// C ref: mhitm.c:807 engulf_target(magr, mdef) — can magr swallow mdef?  No
// RNG.  js/mhitm.js references it only in a comment, so this is a local copy;
// the hero-as-defender arms are dropped (the hero can't be gulpum()'s target).
function engulf_target_uh(magr, mdef) {
    const uatk = (magr === game.youmonst || magr === game.u);
    const adata = uatk ? game.youmonst?.data : magr?.data;
    /* can't swallow something that's too big */
    if ((mdef.data?.msize ?? 2) >= 4 /*MZ_HUGE*/
        || ((adata?.msize ?? 2) < (mdef.data?.msize ?? 2) && !is_whirly(adata)))
        return false;
    /* can't (move to) swallow if trapped */
    if (mdef.mtrapped || magr?.mtrapped) return false;
    /* both squares must be enterable by the other party, or expelling could
       fail to place them back on the map */
    const dx = mdef.mx, dy = mdef.my;
    if (!passes_walls(mdef.data)
        && IS_OBSTRUCTED(game.level?.at(dx, dy)?.typ ?? 0))
        return false;
    const ax = uatk ? game.u?.ux : magr.mx, ay = uatk ? game.u?.uy : magr.my;
    if (!passes_walls(adata)
        && IS_OBSTRUCTED(game.level?.at(ax, ay)?.typ ?? 0))
        return false;
    return true;
}

// C ref: uhitm.c:5424 hmonas(mon) — the poly'd hero's full attack sequence:
// every mattk[] slot of the hero's current form, in order.  Returns whether
// 'mon' survives.
//
// RNG order per slot: find_roll_to_hit (RNG-free) -> rnd(20) (rnd(20+i) for
// AT_ENGL) -> known_hitum()/damageum()/gulpum()/explum() -> passive() ->
// mhitm_knockback().  C's `goto use_weapon` / `goto passivedone` are modelled
// with a per-iteration flag and a labelled block.
export async function hmonas(mon) {
    const u = game.u;
    const I = await import('./invent.js');
    const A = await import('./artifact.js');
    const WPN = await import('./weapon.js');
    const { getmattk, could_seduce, mtrapped_in_pit } = await import('./mhitu.js');
    const { update_topl } = await import('./display.js');
    const ydata = game.youmonst?.data;

    let altwep = false, weapon_used = false, odd_claw = true;
    let weapon = null, originalweapon = null;
    let tmp, dieroll, dhit = 0, multi_claw = 0, multi_weap = 0;
    /* C's `attknum = 0` is function-scoped here (unlike hitum_cleave's), so
       find_roll_to_hit's check_caitiff() fires on the first call only. */
    let attknum = 0;
    let alt_attk = null;
    const sum = new Array(NATTK).fill(M_ATTK_MISS);

    /* not used here but umpteen mhitm_ad_xxxx() need this */
    game.vis = (canseemon(mon) || m_next2u(mon));

    /* with just one touch/claw/weapon attack both rings matter; with more than
       one, alternate right and left when checking the silver ring hit */
    for (let i = 0; i < NATTK; i++) {
        const mattk0 = getmattk(game.youmonst || game.u, mon, i, sum);
        if (!mattk0) continue;
        if (mattk0.aatyp === AT_WEAP) ++multi_weap;
        if (mattk0.aatyp === AT_WEAP || mattk0.aatyp === AT_CLAW
            || mattk0.aatyp === AT_TUCH) ++multi_claw;
    }
    multi_claw = (multi_claw > 1) ? 1 : 0;   /* count -> yes/no */
    game.twohits = 0;
    game.skipdrin = false;                   /* [see mattackm(mhitm.c)] */

    let broke_out = false;
    for (let i = 0; i < NATTK && !broke_out; i++) {
        /* the target might have been knocked out of range, or an engulfing
           vampshifted fog cloud died and reverted at another spot */
        if (i > 0 && (m_at(game.bhitpos?.x, game.bhitpos?.y) !== mon
                      || DEADMONSTER(mon)))
            continue;

        let mattk = getmattk(game.youmonst || game.u, mon, i, sum);
        if (!mattk) continue;
        if (game.skipdrin && mattk.aatyp === AT_TENT
            && mattk.adtyp === AD_DRIN)
            continue;
        weapon = null;
        let goto_passivedone = false;
        /* C reaches the AT_WEAP body by falling through from AT_CLAW/AT_TUCH/
           AT_MAGC via `goto use_weapon`; this flag stands in for the label. */
        let use_weapon = (mattk.aatyp === AT_WEAP);
        if (!use_weapon) {
            if (mattk.aatyp === AT_CLAW
                && game.uwep && !cantwield(ydata) && !weapon_used)
                use_weapon = true;
            else if (mattk.aatyp === AT_TUCH
                     && game.uwep && ydata?.mcls === S_LICH && !weapon_used)
                use_weapon = true;
            else if (mattk.aatyp === AT_MAGC
                     && (ydata?.mcls === S_KOBOLD || ydata?.mcls === S_ORC_CLS
                         || ydata?.mcls === S_GNOME) && !weapon_used)
                use_weapon = true;
        }

        if (use_weapon) {
            odd_claw = !odd_claw;   /* see AT_CLAW/AT_TUCH below */
            /* if we've already hit with a two-handed weapon we don't get
               another weapon attack (monsters that use weapons have no such
               restriction, but they never get to use two weapons either) */
            if (weapon_used && (sum[i - 1] > M_ATTK_MISS)
                && game.uwep && I.bimanual(game.uwep))
                continue;
            /* some monsters don't use weapons as enemies, but a player poly'd
               into them has hands or claws and should be able to.  If the form
               has multiple claw attacks, only one can use a weapon. */
            weapon_used = true;
            /* approximate two-weapon mode; known_hitum() -> hmon() -> &c might
               destroy the weapon, and it might already be Null, so track which
               equipment SLOT it came from for passive() */
            originalweapon = (altwep && game.uswapwep) ? 'uswapwep' : 'uwep';
            if (game.uswapwep   /* set up 'altwep' for the next iteration */
                /* only consider the secondary with a one-handed primary */
                && game.uwep
                && (game.uwep.oclass === WEAPON_CLASS || is_weptool(game.uwep))
                && !I.bimanual(game.uwep)
                /* only switch with no shield, and never to an artifact */
                && !game.uarms && !game.uswapwep.oartifact
                /* only switch to uswapwep if it's a weapon */
                && (game.uswapwep.oclass === WEAPON_CLASS
                    || is_weptool(game.uswapwep))
                /* not a bow, arrows or darts */
                && !(I.is_launcher(game.uswapwep) || I.is_ammo(game.uswapwep)
                     || I.is_missile(game.uswapwep))
                /* and not two-handed or impossible to wield */
                && !I.bimanual(game.uswapwep)
                && !((objects[game.uswapwep.otyp]?.material === MAT_SILVER)
                     && Hate_silver()))
                altwep = !altwep;
            weapon = game[originalweapon];
            /* no need to go past no-gloves to rings; rings aren't subject to
               erosion damage */
            if (!weapon) originalweapon = 'uarmg';

            tmp = await find_roll_to_hit(mon, weapon, attknum++ === 0);
            mon_maybe_unparalyze(mon);
            dieroll = rnd(20);
            dhit = (tmp > dieroll || u.uswallow) ? 1 : 0;
            if (multi_weap > 1) ++game.twohits;
            /* the caller must set game.bhitpos */
            const kh = await known_hitum(mon, weapon, !!dhit, dieroll);
            dhit = kh.mhit ? 1 : 0;
            /* originalweapon names an equipment slot that might now be empty
               if the weapon was destroyed during the hit; passive() then skips
               passive_obj() */
            weapon = game[originalweapon];
            if (!kh.malive) {
                sum[i] = M_ATTK_DEF_DIED;   /* enemy dead before any special */
            } else {
                sum[i] = dhit ? M_ATTK_HIT : M_ATTK_MISS;
                /* might be a worm cut in half; if so, early exit */
                if (m_at(u.ux + u.dx, u.uy + u.dy) !== mon) {
                    i = NATTK;              /* skip additional attacks */
                    goto_passivedone = true;
                } else if (dhit && mattk.adtyp !== AD_SPEL
                           && mattk.adtyp !== AD_PHYS) {
                    /* don't print "You hit"; known_hitum already did */
                    sum[i] = await damageum(mon, mattk, 0);
                }
            }
        } else switch (mattk.aatyp) {
        case AT_KICK:
            if (mtrapped_in_pit(game.youmonst || game.u))
                continue;
            /* FALLTHRU */
        case AT_TUCH:
        case AT_CLAW:
        case AT_BITE:
        case AT_STNG:
        case AT_BUTT:
        case AT_TENT: {
            tmp = await find_roll_to_hit(mon, null, attknum++ === 0);
            mon_maybe_unparalyze(mon);
            dieroll = rnd(20);
            dhit = (tmp > dieroll || u.uswallow) ? 1 : 0;
            if (dhit) {
                let compat = 0, specialdmg = 0, silverhit = 0;
                let verb = null;   /* verb or body part */

                if (!u.uswallow
                    && (compat = could_seduce(game.youmonst || game.u, mon,
                                              mattk)) !== 0) {
                    await update_topl(`You `
                        + `${(mon.mcansee && haseyes(mon.data)) ? 'smile at'
                                                                : 'talk to'} `
                        + `${mon_nam(mon)} `
                        + `${(compat === 2) ? 'engagingly' : 'seductively'}.`);
                    /* doesn't anger it; no wakeup() */
                    sum[i] = await damageum(mon, mattk, 0);
                    break;
                }
                await wakeupAttack(mon, true);

                specialdmg = 0;   /* blessed and/or silver bonus */
                switch (mattk.aatyp) {
                case AT_CLAW:
                case AT_TUCH: {
                    /* verb=="claws" may be overridden below */
                    verb = (mattk.aatyp === AT_TUCH) ? 'touch' : 'claws';
                    /* decide whether a silver-hater is hit by the ring(s); with
                       'multi_claw' the attacks alternate, and 'even' claw/touch
                       attacks use the dominant hand.  Even vs odd counts actual
                       attacks, not the mattk[] index, so {bite,claw,claw} does
                       not make a poly'd hero switch handedness. */
                    odd_claw = !odd_claw;
                    const sd = WPN.special_dmgval(game.youmonst || game.u, mon,
                        W_ARMG
                        | ((odd_claw || !multi_claw) ? W_RINGL : 0)
                        | ((!odd_claw || !multi_claw) ? W_RINGR : 0));
                    specialdmg = sd.bonus; silverhit = sd.silverhit;
                    break;
                }
                case AT_TENT:
                    /* assumes a mind flayer's tentacles-on-head rather than a
                       sea monster's tentacle-as-arm */
                    verb = 'tentacles';
                    break;
                case AT_KICK: {
                    verb = 'kick';
                    const sd = WPN.special_dmgval(game.youmonst || game.u, mon,
                                                W_ARMF);
                    specialdmg = sd.bonus; silverhit = sd.silverhit;
                    break;
                }
                case AT_BUTT: {
                    verb = 'head butt';   /* mbodypart(mon,HEAD)=="head" */
                    /* hypothetical: if any head-butting form could wear a
                       helmet, a blessed (or silver) one would hit shades */
                    const sd = WPN.special_dmgval(game.youmonst || game.u, mon,
                                                W_ARMH);
                    specialdmg = sd.bonus; silverhit = sd.silverhit;
                    break;
                }
                case AT_BITE: verb = 'bite'; break;
                case AT_STNG: verb = 'sting'; break;
                default: verb = 'hit'; break;
                }
                if (mon.data?.name === 'shade' && !specialdmg) {
                    if (verb === 'hit'
                        || (mattk.aatyp === AT_CLAW && humanoid(mon.data)))
                        verb = 'attack';
                    await update_topl(`Your ${verb} ${vtense_uh(verb, 'pass')}`
                        + ` harmlessly through ${mon_nam(mon)}.`);
                } else {
                    /* either not a shade, or no special silver/blessed damage;
                       other unsolid monsters are immune to AT_TUCH+AD_WRAP */
                    if (await failed_grab_uh(game.youmonst || game.u, mon,
                                             mattk))
                        break;   /* miss; message already given */

                    if (mattk.aatyp === AT_TENT) {
                        await update_topl(`Your tentacles suck`
                            + ` ${mon_nam(mon)}.`);
                    } else {
                        if (mattk.aatyp === AT_CLAW)
                            verb = 'hit';   /* not "claws" */
                        await update_topl(`You ${verb} ${mon_nam(mon)}.`);
                        if (silverhit && game.flags?.verbose !== false)
                            await WPN.silver_sears(game.youmonst || game.u, mon,
                                                 silverhit);
                    }
                    sum[i] = await damageum(mon, mattk, specialdmg);
                }
            } else {   /* !dhit */
                await missum(mon);   /* C: missum(mon, mattk, wouldhavehit) */
            }
            break;
        }

        case AT_HUGS: {
            let specialdmg = 0, silverhit = 0;
            const byhand = hug_throttles(monster_by_pmidx(u.umonnum));
            let unconcerned = (byhand && !can_be_strangled(mon));

            if (sticks(mon.data) || u.uswallow || game.notonhead
                || (byhand && (game.uwep || !has_head(mon.data)))) {
                /* can't hold a holder (ambiguous who holds whom); can't hug an
                   engulfer from inside; can't hug a worm tail (it would
                   immobilise the whole worm); byhand: can't choke something
                   with no head, and can't choke while wielding a weapon */
                if (byhand && game.uwep && u.ustuck
                    && !(sticks(u.ustuck.data) || u.uswallow))
                    unstuck_mon(u.ustuck);   /* C: uunstick() */
                continue;   /* not 'break'; bypass the passive counter-attack */
            }
            /* automatic if the previous two attacks succeeded, or if already
               grabbed in an earlier attack */
            dhit = 1;
            await wakeupAttack(mon, true);
            /* a choking hug uses hands (gloves or rings); a normal hug uses the
               outermost of cloak/suit/shirt */
            {
                const sd = WPN.special_dmgval(game.youmonst || game.u, mon,
                    byhand ? (W_ARMG | W_RINGL | W_RINGR)
                           : (W_ARMC | W_ARM | W_ARMU));
                specialdmg = sd.bonus; silverhit = sd.silverhit;
            }
            if (unconcerned) {
                /* strangling something that can't be strangled */
                if (mattk !== alt_attk) {
                    alt_attk = { ...mattk };
                    mattk = alt_attk;
                }
                /* change the damage to 1d1: not strangling, but still doing
                   minimal physical damage to the victim's body */
                mattk.damn = mattk.damd = 1;
                /* no 'unconcerned' feedback if there's extra damage, or the
                   victim is nearly destroyed, or it lacks the mental ability to
                   be concerned in the first place */
                if (specialdmg || mindless(mon.data)
                    || mon.mhp <= 1 + Math.max(u.udaminc | 0, 1))
                    unconcerned = false;
            }
            if (mon.data?.name === 'shade') {
                const verb = byhand ? 'grasp' : 'hug';
                /* hugging a shade: successful with blessed outermost armour for
                   a normal hug, or blessed gloves / silver ring(s) for a
                   choking one; deals damage but never grabs hold */
                if (specialdmg) {
                    await update_topl(`You ${verb} ${mon_nam(mon)}`
                        + `${exclam(specialdmg)}`);
                    if (silverhit && game.flags?.verbose !== false)
                        await WPN.silver_sears(game.youmonst || game.u, mon,
                                             silverhit);
                    sum[i] = await damageum(mon, mattk, specialdmg);
                } else {
                    await update_topl(`Your ${verb} passes harmlessly through`
                        + ` ${mon_nam(mon)}.`);
                }
                break;
            }
            /* can't grab unsolid creatures (checked after shade handling) */
            if (await failed_grab_uh(game.youmonst || game.u, mon, mattk))
                break;
            /* hug attack against an ordinary foe */
            if (mon === u.ustuck) {
                await update_topl(`${Monnam(mon)} is `
                    + `${byhand ? 'throttled' : 'crushed'}`
                    + `${unconcerned ? " but doesn't seem concerned" : ''}.`);
                if (silverhit && game.flags?.verbose !== false)
                    await WPN.silver_sears(game.youmonst || game.u, mon,
                                         silverhit);
                sum[i] = await damageum(mon, mattk, specialdmg);
            } else if (i >= 2 && (sum[i - 1] > M_ATTK_MISS)
                       && (sum[i - 2] > M_ATTK_MISS)) {
                /* in case we're hugging a new target while already holding
                   something else: "<u.ustuck> is no longer in your clutches" */
                if (u.ustuck && u.ustuck !== mon) unstuck_mon(u.ustuck);
                await update_topl(`You grab ${mon_nam(mon)}!`);
                const { set_ustuck } = await import('./mon.js');
                set_ustuck(mon);
                if (silverhit && game.flags?.verbose !== false)
                    await WPN.silver_sears(game.youmonst || game.u, mon,
                                         silverhit);
                sum[i] = await damageum(mon, mattk, specialdmg);
            }
            break;   /* AT_HUGS */
        }

        case AT_EXPL:   /* automatic hit if next to */
            dhit = -1;
            await wakeupAttack(mon, true);
            await update_topl('You explode!');
            sum[i] = await explum(mon, mattk);
            break;

        case AT_ENGL:
            tmp = await find_roll_to_hit(mon, null, attknum++ === 0);
            mon_maybe_unparalyze(mon);
            dhit = (tmp > rnd(20 + i)) ? 1 : 0;
            if (dhit) {
                await wakeupAttack(mon, true);
                /* can't engulf unsolid creatures */
                if (mon.data?.name === 'shade') {
                    /* no specialdmg check needed */
                    await update_topl(`Your attempt to surround`
                        + ` ${mon_nam(mon)} is harmless.`);
                } else if (await failed_grab_uh(game.youmonst || game.u, mon,
                                                mattk)) {
                    /* non-shade miss; message already given */
                } else {
                    sum[i] = await gulpum(mon, mattk);
                    if (sum[i] === M_ATTK_DEF_DIED
                        && (mon.data?.mcls === S_ZOMBIE
                            || mon.data?.mcls === S_MUMMY)
                        && rn2(5) && !Sick_resistance_uh()) {
                        await update_topl(`You feel `
                            + `${Sick_uh() ? 'very ' : ''}sick.`);
                        await mdamageu(mon, rnd(8));
                    }
                }
            } else {
                await missum(mon);
            }
            break;

        case AT_MAGC:   /* only reached when the form couldn't use a weapon */
        case AT_NONE:
        case AT_BOOM:
            continue;   /* not break: avoid passive attacks from the enemy */

        case AT_BREA:
        case AT_SPIT:
        case AT_GAZE:   /* all done using the #monster command */
            dhit = 0;
            break;

        default:        /* Strange... */
            break;      /* C: impossible("strange attack of yours (%d)") */
        }

        if (!goto_passivedone) {
            if (dhit === -1) {
                u.mh = -1;   /* dead in the current form */
                const { rehumanize } = await import('./polyself.js');
                await rehumanize();
            }
            if (sum[i] === M_ATTK_DEF_DIED) {
                await passive(mon, weapon, 1, 0, mattk.aatyp);
            } else {
                await passive(mon, weapon, (sum[i] !== M_ATTK_MISS) ? 1 : 0, 1,
                              mattk.aatyp);
            }
            /* uhitm.c:5247 mhitm_knockback(&youmonst, mon, mattk, &sum[i],
               weapon_used) is file-static in js/mhitm.js and js/monmove.js.
               Its leading rolls always fire: rn2(3) knockdistance, then
               rn2(chance) with chance==6 for a non-Ogresmasher hit. */
            rn2(3);
            if (rn2(6)) {
                /* no knockback */
            } else {
                /* the size/solidity/steadfast gates would follow */
            }
        }

        /* don't use sum[i] beyond this point: 'i' is out of bounds when we
           arrive here via C's `goto passivedone` */
        /* when using dual weapons, a cursed secondary doesn't weld, it gets
           dropped; likewise when multiple AT_WEAP attacks simulate twoweap */
        if (game.uswapwep && weapon === game.uswapwep && weapon.cursed) {
            const { drop_uswapwep } = await import('./wield.js');
            await drop_uswapwep();
            break;   /* don't proceed with additional attacks */
        }
        /* stop attacking if the defender has died; deferred until after the
           uswapwep->cursed check */
        if (DEADMONSTER(mon)) break;
        if (!Upolyd()) break;              /* no extra attacks if human again */
        if ((game.multi ?? 0) < 0) break;  /* paralysed mid-attack (floating eye) */
    }

    game.vis = false;   /* reset */
    game.twohits = 0;
    /* the return value isn't used, but make it match hitum()'s */
    return !DEADMONSTER(mon);
}
// C ref: mhitm.c:597 failed_grab(magr, mdef, mattk) — an unsolid target (or a
// worm tail) can't be held.  RNG-free, but it CANCELS the strike.  js/mhitm.js
// keeps a file-static copy; this one is the hero-as-attacker slice.
async function failed_grab_uh(magr, mdef, mattk) {
    if ((unsolid(mdef.data) || game.notonhead)
        && (mattk.aatyp === AT_HUGS || mattk.adtyp === AD_WRAP
            || mattk.adtyp === AD_STCK || mattk.adtyp === AD_DGST)) {
        const { update_topl } = await import('./display.js');
        const tailmiss = !!game.notonhead;
        const verb = (mattk.adtyp === AD_DGST) ? 'gulp'
            : (mattk.adtyp === AD_STCK) ? 'adhere' : 'grab';
        const target = tailmiss ? `${s_suffix(mon_nam(mdef))} tail`
                                : mon_nam(mdef);
        await update_topl(`Your ${verb} attempt `
            + `${!tailmiss ? 'passes right through' : 'fails to hold'}`
            + ` ${target}!`);
        return true;
    }
    return false;
}
// C ref: youprop.h Sick/Sick_resistance.
function Sick_uh() { return (u_of().uprops?.Sick || 0) > 0; }
function Sick_resistance_uh() {
    return (u_of().uprops?.SickResistance || 0) > 0;
}

// C ref: uhitm.c:6201 that_is_a_mimic(mtmp, mimic_flags) — the "Wait!  That's a
// <mimic>!" reveal, shared by stumble_onto_mimic() and bhitm()'s
// WAN_LOCKING/WAN_OPENING cases.  No RNG of its own; the M_AP_OBJECT arm's
// object_from_map() rolls next_ident() when it fabricates the disguise object
// (see object_from_map_lite() above).
export async function that_is_a_mimic(mtmp, mimic_flags) {
    const reveal_it = (mimic_flags & MIM_REVEAL) !== 0;
    const omit_wait = (mimic_flags & MIM_OMIT_WAIT) !== 0;
    /* that_is_a_mimic_message() above builds the whole line: it picks the same
       three fmtbuf variants C does ("That <furniture> actually is %s!",
       "That/Those <object> is/are %s!", "Wait!  That's %s!") and substitutes
       'what'.  C's Blind_telepat/M_AP_MONSTER branch is absent because
       set_mimic_sym() never assigns M_AP_MONSTER in this port. */
    let line = that_is_a_mimic_message(mtmp);
    if (omit_wait && line.startsWith('Wait!  '))
        line = line.slice(7);
    const { update_topl } = await import('./display.js');
    await update_topl(line);
    if (reveal_it) seemimicLocal(mtmp);
}

// C ref: uhitm.c:6308 disguised_as_mon(mtmp) — mimicking another monster.
export function disguised_as_mon(mtmp) {
    return M_AP_TYPE(mtmp) !== 0 && M_AP_TYPE(mtmp) === M_AP_MONSTER;
}

// C ref: uhitm.c:6315 nohandglow(mon) — the confuse-monster charge is spent.
// No RNG.
export async function nohandglow(mon) {
    const u = game.u;
    if (!u.umconf || mon.mconf) return;

    const I = await import('./invent.js');
    const { hcolor } = await import('./do_name.js');
    const { update_topl } = await import('./display.js');
    const hands = I.makeplural(I.body_part(HAND));
    const altfeedback = (Blind() || Invisible_uh());
    if (u.umconf === 1) {
        if (altfeedback) await update_topl(`Your ${hands} stop tingling.`);
        else await update_topl(`Your ${hands} stop glowing`
            + ` ${hcolor('red')}.`);
    } else {
        if (altfeedback)
            await update_topl(`The tingling in your ${hands} lessens.`);
        else await update_topl(`Your ${hands} no longer glow so brightly`
            + ` ${hcolor('red')}.`);
    }
    u.umconf--;
}

// C ref: uhitm.c:6341 flash_hits_mon(mtmp, otmp) — a light flash hits a
// monster; returns 1 if it had a noticeable effect.
//
// RNG order: the gremlin's d(1+spe,4) or rnd(min(mhp,4)), then rn2(4) for the
// flee gate, then (only inside it) rn2(4) and rnd(100) for the duration, then
// rnd(1 + 50/tmp) for the blindness.
export async function flash_hits_mon(mtmp, otmp) {
    const mx = mtmp.mx, my = mtmp.my;
    let tmp, amt, res = 0;
    const { update_topl } = await import('./display.js');

    if (game.notonhead) return 0;
    const lev = game.level?.at(mx, my);
    const useeit = canseemon(mtmp);

    if (M_AP_TYPE(mtmp) !== M_AP_NOTHING) {
        /* hack.c mhidden_description(mtmp, MHID_ALTMON, buf) has no port; the
           mimic's disguise name comes from the same helper that_is_a_mimic()
           uses.  wakeup() -> seemimic() -> newsym() is what changes the glyph. */
        const whatbuf = mhidden_description_uh(mtmp);
        const was_disguised = M_AP_TYPE(mtmp) !== M_AP_NOTHING;
        await wakeupAttack(mtmp, false);
        /* if the glyph changed then the hero saw something happen */
        if (was_disguised && M_AP_TYPE(mtmp) === M_AP_NOTHING) {
            await update_topl(`That ${whatbuf} is really `
                + `${x_monnam(mtmp, mtmp.mtame ? ARTICLE_YOUR : ARTICLE_A,
                              null, 0, false)}`
                + `${mtmp.mtame ? '.' : '!'}`);
            res = 1;
        }
    }

    if (mtmp.msleeping && haseyes(mtmp.data)) {
        mtmp.msleeping = 0;
        if (useeit) {
            await update_topl(`The flash awakens ${mon_nam(mtmp)}.`);
            res = 1;
        }
    } else if (mtmp.data?.mcls !== S_LIGHT) {
        if (!resists_blnd(mtmp)) {
            tmp = dist2_uh(otmp.ox, otmp.oy, mx, my);
            if (useeit) {
                await update_topl(`${Monnam(mtmp)} is blinded by the flash!`);
                res = 1;
            }
            if (mtmp.data?.name === 'gremlin') {
                /* Rule #1: Keep them out of the light. */
                amt = (otmp.otyp === WAN_LIGHT)
                    ? d(1 + (otmp.spe | 0), 4)
                    : rnd(Math.min(mtmp.mhp, 4));
                await light_hits_gremlin(mtmp, amt);
            }
            if (!DEADMONSTER(mtmp)) {
                if (!game.context?.mon_moving) await setmangry(mtmp, true);
                if (tmp < 9 && !mtmp.isshk && rn2(4)) {
                    const { monflee: monflee_full } = await import('./monmove.js');
                    await monflee_full(mtmp, rn2(4) ? rnd(100) : 0, false, true);
                }
                mtmp.mcansee = 0;
                mtmp.mblinded = (tmp < 3) ? 0 : rnd(1 + Math.trunc(50 / tmp));
            }
        } else if (useeit) {
            /* resists_blnd_by_arti() -> shieldeff(): no artifact defends()
               port, so the sparkle is absent */
            if (game.flags?.verbose !== false) {
                if (lev?.lit)
                    await update_topl(`The flash of light shines on`
                        + ` ${mon_nam(mtmp)}.`);
                else
                    await update_topl(`${Monnam(mtmp)} is illuminated.`);
                res = 2;   /* 'message has been given' temporary value */
            }
        }
    }
    if (res) {
        /* display_nhwindow(WIN_MESSAGE, TRUE) — the --More-- when the square is
           unlit; no port for a forced flush here */
        res &= 1;          /* change the temporary 2 back to 0 */
    }
    return res;
}
// C ref: hacklib.c dist2(x0, y0, x1, y1).
function dist2_uh(x0, y0, x1, y1) {
    const dx = x0 - x1, dy = y0 - y1;
    return dx * dx + dy * dy;
}

// C ref: uhitm.c:6425 light_hits_gremlin(mon, dmg) — a gremlin takes light
// damage.  No RNG.
export async function light_hits_gremlin(mon, dmg) {
    const { update_topl } = await import('./display.js');
    if (!Deaf_uh() && mdistu(mon) <= 90) {
        /* the cry of pain carries somewhat farther than the waking radius */
        await update_topl(`${Monnam(mon)} `
            + `${(dmg > Math.trunc(mon.mhp / 2)) ? 'wails in agony'
                                                 : 'cries out in pain'}!`);
    } else if (canseemon(mon)) {
        await update_topl(`${Monnam(mon)} recoils from the light!`);
    }
    mon.mhp -= dmg;
    const { wake_nearto } = await import('./cmd.js');
    await wake_nearto(mon.mx, mon.my, 30);
    if (DEADMONSTER(mon)) {
        if (game.context?.mon_moving) {
            /* mon.c monkilled(mon, 0, AD_BLND) — unported for this path */
            await killed(mon);
        } else {
            await killed(mon);
        }
    } else if (cansee(mon.mx, mon.my) && !canspotmon(mon)) {
        map_invisible(mon.mx, mon.my);
    }
}

// C ref: hack.c mhidden_description(mtmp, MHID_ALTMON, buf) — names the shape a
// concealed monster is wearing ("chest", "boulder", "staircase down"), which is
// what flash_hits_mon() prints before the reveal.  js/hack.js keeps a copy that
// isn't exported; this slice covers the two appearance types set_mimic_sym()
// assigns in this port.
function mhidden_description_uh(mtmp) {
    if (M_AP_TYPE(mtmp) === M_AP_FURNITURE)
        return FURNITURE_EXPLANATION[mtmp.mappearance] || 'thing';
    if (M_AP_TYPE(mtmp) === M_AP_OBJECT)
        return (mtmp.mappearance && mtmp.mappearance !== STRANGE_OBJECT)
            ? simple_typename(mtmp.mappearance) : 'strange object';
    return 'monster';
}
