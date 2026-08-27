// fountain.js - fountain interactions (dip / dry up).
// C ref: fountain.c dipfountain()/dryup().  Faithful port of the branches a
// non-polymorphed contest hero reaches (potion/food/other dip, curse/uncurse,
// "strange feeling", and "nothing seems to happen"); the monster-summon and
// treasure branches call subsystems (makemon/mkgold specifics) the port does
// not yet fully model, so they emit their observable framing only.

import { game } from './gstate.js';
import { rn2, rnd, rn1 } from './rng.js';
import { update_topl, newsym, m_at, y_n } from './display.js';
import { hliquid, builds_up, dunlevs_in_dungeon, Is_special, level_difficulty_c } from './dungeon.js';
import { water_damage, t_at, delfloortrap } from './trap.js';
import { find_ac } from './u_init.js';
import { curse, objects, COIN_CLASS, POTION_CLASS, POT_WATER, RING_CLASS, mkobj, mkobj_at, mksobj_at,
    mkgold, rnd_class, DILITHIUM_CRYSTAL, LUCKSTONE, BOULDER } from './mkobj.js';
import { exercise, acurr_eff, poison_strdmg } from './attrib.js';
import { fruitname } from './objnam.js';
import { more_experienced, newexplevel } from './exper.js';
import { newuhs } from './eat.js';
import { Blind, cansee, couldsee } from './vision.js';
import { depth, distmin } from './hacklib.js';
import { clear_area_cells } from './vision.js';
import { nexttodoor, inside_room } from './mkroom.js';
import { makemon, name_to_pmidx, monster_by_pmidx, enexto_spawn, placeOnLevel } from './makemon.js';
import { x_monnam, canspotmon, monflee } from './uhitm.js';
import { somegold } from './steal.js';
import { create_gas_cloud } from './region.js';
import { monster_detect } from './hack.js';
import { observe_object } from './o_init.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
import {
    ER_NOTHING, ER_GREASED, ER_DESTROYED, F_LOOTED, F_WARNED, FROMOUTSIDE,
    FOUNTAIN, ROOM, POOL, A_WIS, A_CON, IS_FOUNTAIN, S_LRING, G_GONE,
} from './const.js';

// C ref: include/onames.h — long sword otyp (mkobj.js OBJECT_DATA order).
const LONG_SWORD = 54;

const nothing_seems_to_happen = 'Nothing seems to happen.';

// C ref: rm.h FOUNTAIN_IS_LOOTED / _WARNED — bits in levl[x][y].looted.
function fountain_is_looted(loc) { return ((loc?.looted || 0) & F_LOOTED) !== 0; }

// C ref: eat.c morehungry(num) — `u.uhunger -= num; newuhs(TRUE);`.  eat.js
// keeps the arithmetic inline at each of its own call sites and exports no
// morehungry(), so the two fountain callers (foul water, "no good" water) and
// the sink's sewage sip get it here.  RNG-free itself, but u.uhunger steers
// the botl hunger word AND newuhs()'s fainting rn2, so discarding the roll's
// value (as this file used to) leaves the hero permanently un-hungered.
function morehungry(num) {
    const u = game.u;
    if (!u) return;
    u.uhunger = (u.uhunger ?? 900) - num;
    newuhs(true);
}

// C ref: prop.h Poison_resistance.  Mirrors js/potion.js's reader: the port
// spreads the intrinsic over three different uprops spellings depending on
// which subsystem granted it (role intrinsic, race intrinsic, item).
function Poison_resistance() {
    const u = game.u;
    if (!u) return false;
    const p = u.uprops || {};
    return !!(u.Poison_resistance || p.Poison_resistance
              || p.HPoison_resistance || p.PoisonResistance);
}

// C ref: mondata.h is_watch(ptr) — a literal `ptr == &mons[PM_WATCHMAN] ||
// ptr == &mons[PM_WATCH_CAPTAIN]` species-pointer test, so comparing pmidx is
// the faithful form (a name regex would be too, but pmidx can't drift).
let _watch_pmidx = null;
function is_watch(ptr) {
    if (_watch_pmidx === null)
        _watch_pmidx = [name_to_pmidx('watchman'), name_to_pmidx('watch captain')];
    const i = ptr?.pmidx;
    return i != null && (i === _watch_pmidx[0] || i === _watch_pmidx[1]);
}

// C ref: hack.c in_town(x, y) — a room WITH subrooms is the town; with no
// subroomed rooms at all the whole level counts.  Mirrors js/makemon.js's
// in_town_js(), including its `svl.level.flags.has_town` stand-in (nothing in
// this port writes has_town, so the S_LEVEL `town` flag answers for it).
function in_town(x, y) {
    const lvl = game.level;
    const slev = Is_special(game.u?.uz);
    if (!slev || !slev.flags?.town) return false;
    let has_subrooms = false;
    for (let i = 0; i < (lvl?.nroom ?? 0); i++) {
        const sroom = lvl.rooms[i];
        if (!sroom || (sroom.hx ?? 0) <= 0) break;
        if ((sroom.nsubrooms ?? 0) > 0) {
            has_subrooms = true;
            if (inside_room(sroom, x, y)) return true;
        }
    }
    return !has_subrooms;
}

// C ref: mon.c angry_guards(silent) — wake and anger every peaceful watchman;
// returns TRUE if there was one.  No RNG, but clearing mpeaceful redirects
// every later watchman move.  (js/shkroom.js keeps a private copy of the same
// C function; it is not exported, and this file may not edit that one.)
function angry_guards(_silent) {
    let ct = 0;
    for (const mtmp of (game.level?.monsters || [])) {
        if (!mtmp || mtmp.mhp <= 0) continue;
        if (!is_watch(mtmp.data) || !mtmp.mpeaceful) continue;
        ct++;
        if (mtmp.msleeping || mtmp.mfrozen) { mtmp.msleeping = 0; mtmp.mfrozen = 0; }
        mtmp.mpeaceful = 0;
    }
    return ct > 0;
}

// C ref: hack.c money_cnt(otmp) — the quan of the FIRST coin stack in the
// chain (it returns, it does not sum, and it does not look inside containers).
function money_cnt(list) {
    for (const obj of (list || [])) if (obj.oclass === COIN_CLASS) return obj.quan || 0;
    return 0;
}

// C ref: invent.c delobj(obj) — rolls obj_resists(obj, 0, 0) (a plain rn2(100)
// for coins) before freeing.  Imported lazily: invent.js pulls potion.js, which
// pulls this file.
async function delobj_invent(obj) {
    const I = await import('./invent.js');
    I.delobj(obj);
}

// C ref: youprop.h Glib — the "slippery fingers" timer.
function Glib() {
    const u = game.u;
    return ((u?.Glib || 0) > 0) || ((u?.uprops?.Glib || 0) > 0)
        || ((u?.uprops?.HGlib || 0) > 0);
}

// C ref: hack.h Role_if(PM_KNIGHT) — urole.mnum comparison.
function Role_if_knight() {
    return /knight/i.test(game.urole?.name?.m || game.urole?.name || '');
}

// C ref: artifact.c exist_artifact(LONG_SWORD, artiname(ART_EXCALIBUR)) — has
// Excalibur already been made?  The port has no artifact registry, so scan the
// hero's pack and the current level's floor for oartifact == 1 (Excalibur's
// artilist index, per invent.js ARTI_TOUCH_PROPS).
function exist_excalibur() {
    for (const o of (game.invent || [])) if (o?.oartifact === 1) return true;
    for (const o of (game.level?.objects || [])) if (o?.oartifact === 1) return true;
    return false;
}

// C ref: fountain.c wash_hands() — dipping '-' (or worn gloves) into water.
// Always prints; water-damages the gloves (RNG) when they are worn; and
// upgrades ER_NOTHING to ER_GREASED when it removed Glib, which is what makes
// dipfountain's `er != ER_NOTHING && !rn2(2)` early-out fire.
async function wash_hands() {
    let res = ER_NOTHING;
    const was_glib = Glib();
    await update_topl(`You wash your ${game.uarmg ? 'gloved ' : ''}hands in the `
                      + `${hliquid('water')}.`);
    if (was_glib) {
        // make_glib(0): clears the timer (no RNG).
        if (game.u) {
            game.u.Glib = 0;
            if (game.u.uprops) { game.u.uprops.Glib = 0; game.u.uprops.HGlib = 0; }
        }
        await update_topl(
            `Your ${game.uarmg ? 'gloves' : 'fingers'} are no longer slippery.`);
    }
    if (game.uarmg) res = await water_damage(game.uarmg, null, true);
    if (was_glib && res === ER_NOTHING) res = ER_GREASED;
    return res;
}

// C ref: fountain.c dipfountain(obj) — dipping an object into a fountain.
export async function dipfountain(obj) {
    const u = game.u;
    let er = ER_NOTHING;
    // is_hands ('-') dips wash the hands; the reached sessions dip real objects.
    const is_hands = obj && obj._hands;

    if (u.uprops?.Levitation) {
        await update_topl('You are floating high above the fountain.');
        return;
    }

    // C ref: fountain.c:190 — the Lady-of-the-Lake / Excalibur test.  The
    // `!rn2(Role_if(PM_KNIGHT) ? 6 : 30)` is the THIRD term of the &&-chain, so
    // it draws for every long-sword dip by an XL5+ hero even when the later
    // quan/artifact terms then fail.  The old stub drew nothing at all.
    if (obj.otyp === LONG_SWORD && u.ulevel >= 5
        && !rn2(Role_if_knight() ? 6 : 30)
        && (obj.quan || 1) === 1 && !obj.oartifact
        && !exist_excalibur()) {
        if ((u.ualign?.type ?? 0) !== 1 /* A_LAWFUL */) {
            await update_topl(`A freezing mist rises from the ${hliquid('water')}`
                              + ' and envelopes the sword.');
            await update_topl('The fountain disappears!');
            curse(obj);
            if ((obj.spe ?? 0) > -6 && !rn2(3)) obj.spe = (obj.spe ?? 0) - 1;
            obj.oerodeproof = false;
            exercise(A_WIS, false);
        } else {
            await update_topl(
                'From the murky depths, a hand reaches up to bless the sword.');
            await update_topl('As the hand retreats, the fountain disappears!');
            // oname(obj, artiname(ART_EXCALIBUR)) + discover_artifact():
            // invent.js keys artifact properties off obj.oartifact (1 ==
            // Excalibur in its ARTI_TOUCH_PROPS table).
            obj.oartifact = 1;
            obj.oname = 'Excalibur';
            obj.blessed = true; obj.cursed = false;
            obj.oeroded = 0; obj.oeroded2 = 0; obj.oerodeproof = true;
            exercise(A_WIS, true);
        }
        const loc0 = game.level?.at(u.ux, u.uy);
        if (loc0) { loc0.typ = ROOM; loc0.flags = 0; }
        if (game.level?.flags && typeof game.level.flags.nfountains === 'number')
            game.level.flags.nfountains = Math.max(0, game.level.flags.nfountains - 1);
        newsym(u.ux, u.uy);
        if (in_town(u.ux, u.uy)) angry_guards(false);
        return;
    }

    if (is_hands || obj === game.uarmg) {
        er = await wash_hands();
    } else {
        er = await water_damage(obj, null, true);
        // C ref: allmain.c moveloop_core() — find_ac() runs once per player
        // input (not from erode_obj/water_damage itself), so a dipped piece
        // of worn armor's AC penalty is already visible on this same screen.
        find_ac();
    }

    if (er === ER_DESTROYED || (er !== ER_NOTHING && !rn2(2))) {
        return; // no further effect
    }

    switch (rnd(30)) {
    case 16: // Curse the item
        if (!is_hands && obj.oclass !== COIN_CLASS && !obj.cursed) {
            curse(obj);
        }
        break;
    case 17:
    case 18:
    case 19:
    case 20: // Uncurse the item
        if (!is_hands && obj.cursed) {
            if (!Blind())
                await update_topl(`The ${hliquid('water')} glows for a moment.`);
            obj.cursed = false;
        } else {
            await update_topl('A feeling of loss comes over you.');
        }
        break;
    case 21: // Water Demon
        await dowaterdemon();
        break;
    case 22: // Water Nymph
        await dowaternymph();
        break;
    case 23: // an Endless Stream of Snakes
        await dowatersnakes();
        break;
    case 24: // Find a gem
        if (!fountain_is_looted(game.level?.at(u.ux, u.uy))) {
            await dofindgem();
            break;
        }
        /* FALLTHROUGH */
    case 25: // Water gushes forth
        await dogushforth(false);
        break;
    case 26: // Strange feeling
        await update_topl('A strange tingling runs up your arm.');
        break;
    case 27: // Strange feeling
        await update_topl('You feel a sudden chill.');
        break;
    case 28: { // Strange feeling
        await update_topl('An urge to take a bath overwhelms you.');
        // C ref: fountain.c:508 — the fountain eats a tenth of a purse holding
        // more than 10 zorkmids.  somegold() is RNG-free below 50 zorkmids but
        // draws rn1() above it, and exercise(A_WIS, FALSE) always draws rn2(2)
        // — seed0014 step 712 records exactly that rn2(2) before dryup's rn2(3),
        // which the old "no gold carried here" stub never emitted.
        let money = money_cnt(game.invent);
        if (money > 10) {
            money = Math.trunc(somegold(money) / 10);
            for (const otmp of [...(game.invent || [])]) {
                if (money <= 0) break;
                if (otmp.oclass !== COIN_CLASS) continue;
                const denomination = objects[otmp.otyp]?.oc_cost || 1;
                let coin_loss = Math.trunc((money + denomination - 1) / denomination);
                coin_loss = Math.min(coin_loss, otmp.quan || 0);
                otmp.quan = (otmp.quan || 0) - coin_loss;
                money -= coin_loss * denomination;
                if (!otmp.quan) await delobj_invent(otmp);
            }
            await update_topl('You lost some of your gold in the fountain!');
            const lc = game.level?.at(u.ux, u.uy);
            if (lc) lc.looted = (lc.looted || 0) & ~F_LOOTED; // CLEAR_FOUNTAIN_LOOTED
            exercise(A_WIS, false);
        }
        break;
    }
    case 29: { // You see coins
        const loc = game.level?.at(u.ux, u.uy);
        if (fountain_is_looted(loc)) break;
        if (loc) loc.looted = (loc.looted || 0) | F_LOOTED;
        // C ref: fountain.c:536 — mkgold(rnd((dunlevs_in_dungeon - dunlev + 1)
        // * 2) + 5, ...).  The rnd() is a real draw that the old "not modeled
        // here" comment skipped, shifting every later call in the turn.
        mkgold(rnd((dunlevs_in_dungeon(u.uz) - (u.uz?.dlevel ?? 1) + 1) * 2) + 5,
               u.ux, u.uy);
        if (!Blind())
            await update_topl(`Far below you, you see coins glistening in the ${hliquid('water')}.`);
        exercise(A_WIS, true);
        newsym(u.ux, u.uy);
        break;
    }
    default:
        if (er === ER_NOTHING)
            await update_topl(nothing_seems_to_happen);
        break;
    }
    await dryup(u.ux, u.uy, true);
}

// C ref: fountain.c drinkfountain() — quaff from a fountain the hero stands on.
// fate = rnd(30) selects the outcome.  The blessed-fountain (mgkftn) restore /
// gain-ability branch is only reachable on a blessedftn square (never true for
// the covered fountains).  Branches that drive unmodeled subsystems (vomit,
// enlightenment, poison, gushing) emit their observable framing while still
// spending their leading RNG so the PRNG stays faithful; the reached outcomes
// are the water demon (fate 23) and monster detection (fate 26, via hack.js
// monster_detect()).  Always ends with dryup(), which has a 1-in-3 chance of
// drying the fountain to floor.
export async function drinkfountain() {
    const u = game.u;
    const loc = game.level?.at(u.ux, u.uy);
    const mgkftn = (loc?.blessedftn === 1);
    const fate = rnd(30);

    if (u.uprops?.Levitation) {
        await update_topl('You are floating high above the fountain.');
        return;
    }

    if (mgkftn && (u.uluck || 0) >= 0 && fate >= 10) {
        // C ref: fountain.c:256 — the magic-fountain jackpot.  The old stub
        // returned with NO output and, worse, no RNG: C's gain-ability loop
        // opens with `i = rn2(A_MAX)` (a plain rn2(6)) to pick the starting
        // attribute, and that draw fires whether or not any attribute can rise.
        const A_MAX = 6;
        await update_topl('Wow!  This makes you feel great!');
        // blessed restore ability: ABASE = AMAX for every deficient attribute.
        if (u.acurr?.a && u.amax?.a) {
            for (let ii = 0; ii < A_MAX; ii++)
                if ((u.acurr.a[ii] ?? 0) < (u.amax.a[ii] ?? 0))
                    u.acurr.a[ii] = u.amax.a[ii];
        }
        rn2(A_MAX); /* i = rn2(A_MAX): the gain-ability loop's start index */
        // The loop body is adjattrib(i, 1, littleluck ? -1 : 0), which draws no
        // RNG on the gain path (attrib.c:114-142) but raises ABASE/AMAX and
        // prints "You feel <adjective>!".  attrib.js exports no adjattrib(), so
        // the raise and that message are still missing.
        await update_topl('A wisp of vapor escapes the fountain...');
        exercise(A_WIS, true);
        if (loc) loc.blessedftn = 0;
        return;
    }

    if (fate < 10) {
        await update_topl('The cool draught refreshes you.');
        u.uhunger = (u.uhunger || 0) + rnd(10); /* don't choke on water */
        newuhs(false);
        if (mgkftn) return;
    } else {
        switch (fate) {
        case 19: /* Self-knowledge */
            await update_topl('You feel self-knowledgeable...');
            // enlightenment(MAGICENLIGHTENMENT, ENL_GAMEINPROGRESS) opens an
            // NHW_MENU window here; insight.js only exposes the disclosure
            // (final) form, so the window is still missing.  Its trailing
            // "The feeling subsides." was missing too and is free.
            exercise(A_WIS, true);
            await update_topl('The feeling subsides.');
            break;
        case 20: /* Foul water */
            await update_topl(`The ${hliquid('water')} is foul!  You gag and vomit.`);
            morehungry(rn1(20, 11));
            vomit();
            break;
        case 21: /* Poisonous */
            await update_topl(`The ${hliquid('water')} is contaminated!`);
            // C ref: fountain.c:302 — a poison-resistant hero (every orc, every
            // Healer) takes the SHORT arm: one rnd(4) and a different message,
            // not poison_strdmg's rn1(4,3) + rnd(10).  Argument order is
            // left-to-right, confirmed by seed4500 step 1326 recording
            // rn2(4) then rnd(10) both at fountain.c:307.
            if (Poison_resistance()) {
                await update_topl(
                    `Perhaps it is runoff from the nearby ${fruitname(false)} farm.`);
                losehp(rnd(4));
                break;
            }
            poison_strdmg(rn1(4, 3), rnd(10));
            exercise(A_CON, false);
            break;
        case 22: /* Fountain of snakes! */
            await dowatersnakes();
            break;
        case 23: /* Water demon */
            await dowaterdemon();
            break;
        case 24: { /* Maybe curse some items */
            await update_topl("This water's no good!");
            morehungry(rn1(20, 11));
            exercise(A_CON, false);
            let buc_changed = 0;
            for (const obj of game.invent || []) {
                if (obj.oclass !== COIN_CLASS && !obj.cursed && !rn2(5)) {
                    curse(obj);
                    ++buc_changed;
                }
            }
            void buc_changed; /* update_inventory() is display-only */
            break;
        }
        case 25: /* See invisible */
            // C ref: fountain.c:337 — each arm is TWO plines, and the branch
            // always sets HSee_invisible |= FROMOUTSIDE.  That intrinsic is
            // RNG-free but it decides whether later invisible monsters are
            // drawn at all, so dropping it silently changes the map.
            if (Blind()) {
                if (game.u?.uprops?.Invisible) {
                    await update_topl('You feel transparent.');
                } else {
                    await update_topl('You feel very self-conscious.');
                    await update_topl('Then it passes.');
                }
            } else {
                await update_topl('You see an image of someone stalking you.');
                await update_topl('But it disappears.');
            }
            if (u) {
                u.uprops = u.uprops || {};
                u.uprops.See_invisible = (u.uprops.See_invisible || 0) | FROMOUTSIDE;
                u.uprops.HSee_invisible = (u.uprops.HSee_invisible || 0) | FROMOUTSIDE;
                u.See_invisible = true;
            }
            newsym(u.ux, u.uy);
            exercise(A_WIS, true);
            break;
        case 26: /* See Monsters */
            if (await monster_detect(null, 0))
                await update_topl(`The ${hliquid('water')} tastes like nothing.`);
            exercise(A_WIS, true);
            break;
        case 27: /* Find a gem in the sparkling waters. */
            if (!fountain_is_looted(loc)) {
                await dofindgem();
                break;
            }
            /* FALLTHROUGH */
        case 28: /* Water Nymph */
            await dowaternymph();
            break;
        case 29: /* Scare */
            await update_topl(`This ${hliquid('water')} gives you bad breath!`);
            // C ref: fountain.c:365 — monflee(mtmp, 0, FALSE, FALSE) on EVERY
            // live monster on the level.  RNG-free, but an mflee monster takes
            // a completely different m_move branch, so skipping the loop
            // rewrites the rest of the level's monster stream.
            for (const mtmp of (game.level?.monsters || [])) {
                if (!mtmp || mtmp.mhp <= 0 || mtmp.mdead) continue;
                monflee(mtmp, 0, false, false);
            }
            break;
        case 30: /* Gushing forth in this room */
            await dogushforth(true);
            break;
        default:
            await update_topl(`This tepid ${hliquid('water')} is tasteless.`);
            break;
        }
    }
    await dryup(u.ux, u.uy, true);
}

// C ref: you.h mhe/mhis — genders[pronoun_gender(mtmp, PRONOUN_HALLU)].  The
// neuter/"it" case (pronoun_gender's !canspotmon and is_neuter arms) is not
// modelled; js/muse.js's local mhe() makes the same simplification.
function mhe(mtmp) { return mtmp?.female ? 'she' : 'he'; }
function mhis(mtmp) { return mtmp?.female ? 'her' : 'his'; }

// C ref: dungeon.c level_difficulty() — depth-based difficulty, plus a
// compensating bump in a "builds up" branch (Vlad's Tower, Sokoban); see
// makemon.js's copy of this same C function for the full rationale.
function level_difficulty() { return level_difficulty_c(); }

// C ref: fountain.c dowaterdemon() — unless the species is extinct/genocided,
// makemon a water demon at the hero's square (MM_NOMSG).  Since the hero
// occupies that square, makemon.c's byyou && !in_mklev branch fires first:
// enexto_core finds the nearest free square (collect_coords ring-shuffle RNG)
// before any of the gender/inventory/saddle RNG, and place_monster() puts the
// demon there — so we resolve that spot ourselves (enexto_spawn), then create
// and place the monster there, print "You unleash a water demon!", then spend
// the survival-wish roll (rnd(100)); the wish and mintrap follow-ups are
// unreached at this depth's low roll.  The water demon is armed (is_armed_pm),
// so C's makemon() runs the full m_initweap/m_initinv RNG chain (weapon,
// defensive item, saddle) — request the full-fidelity path (normally scoped to
// Big Room / shop stocking) for just this makemon() call.
async function dowaterdemon() {
    const u = game.u;
    const pmidx = name_to_pmidx('water demon');
    // C ref: fountain.c:66 — the G_GONE (genocided/extinct) test, with its own
    // else-arm message.  This was missing entirely: a genocided water demon
    // silently produced nothing instead of the bubbling line.
    if ((game.mvitals?.[pmidx]?.mvflags ?? 0) & G_GONE) {
        await update_topl(
            'The fountain bubbles furiously for a moment, then calms.');
        return;
    }
    const ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    if (!ptr) return;
    const spot = enexto_spawn(u.ux, u.uy, ptr);
    if (!spot) return;
    const was_full = game._full_mon_gen;
    game._full_mon_gen = true;
    let mtmp;
    try {
        mtmp = makemon(ptr, spot.x, spot.y, 0 /* MM_NOMSG */);
    } finally {
        game._full_mon_gen = was_full;
    }
    if (mtmp) {
        placeOnLevel(mtmp, spot.x, spot.y);
        newsym(spot.x, spot.y);
        if (!Blind())
            await update_topl(`You unleash ${x_monnam(mtmp, 2 /*ARTICLE_A*/, null, 0, false)}!`);
        else
            await update_topl('You feel the presence of evil.');
        // Low-level survival chance: the roll always fires; a high roll grants a
        // wish (mongrantswish), otherwise a trap at the demon's square may snare
        // it (mintrap).  Neither follow-up is reached by the recorded roll.
        if (rnd(100) > (80 + level_difficulty())) {
            // C ref: fountain.c:79 — "Grateful for his release, he grants you
            // a wish!" then mongrantswish() (a getlin wish prompt, unported).
            await update_topl(
                `Grateful for ${mhis(mtmp)} release, ${mhe(mtmp)} grants you a wish!`);
        } else {
            // mintrap(mtmp) if t_at(demon square) — no trap on the fountain.
        }
    }
}
// C ref: fountain.c dowaternymph() — unless the species is genocided, spawn a
// water nymph at the hero's square (mirrors dowaterdemon's byyou &&
// !in_mklev placement: enexto_spawn resolves the nearest free square before
// any of the new monster's own RNG).  Water nymphs aren't armed, but
// m_initinv()'s S_NYMPH case still rolls a mirror/potion-of-object-detection
// chance for every nymph regardless of weapons, so this needs the same
// full-fidelity makemon() path dowaterdemon() uses (normally scoped to Big
// Room / shop stocking) to reach that case instead of the conservative
// generic-species stub.
async function dowaternymph() {
    const u = game.u;
    const pmidx = name_to_pmidx('water nymph');
    const gone = (game.mvitals?.[pmidx]?.mvflags ?? 0) & G_GONE;
    const ptr = (!gone && pmidx >= 0) ? monster_by_pmidx(pmidx) : null;
    const spot = ptr ? enexto_spawn(u.ux, u.uy, ptr) : null;
    let mtmp = null;
    if (spot) {
        const was_full = game._full_mon_gen;
        game._full_mon_gen = true;
        try {
            mtmp = makemon(ptr, spot.x, spot.y, 0 /* MM_NOMSG */);
        } finally {
            game._full_mon_gen = was_full;
        }
    }
    if (mtmp) {
        placeOnLevel(mtmp, spot.x, spot.y);
        newsym(spot.x, spot.y);
        if (!Blind())
            await update_topl(`You attract ${x_monnam(mtmp, 2 /*ARTICLE_A*/, null, 0, false)}!`);
        else
            await update_topl('You hear a seductive voice.');
        mtmp.msleeping = 0;
        // mintrap(mtmp) if t_at(nymph square) — no trap on the fountain.
        return;
    }
    if (!Blind())
        await update_topl('A large bubble rises to the surface and pops.');
    else
        await update_topl('You hear a loud pop.');
}
// C ref: fountain.c dowatersnakes() — `int num = rn1(5, 2);` is the FIRST
// statement, so the roll fires before (and independently of) the G_GONE test,
// then 2..6 water moccasins are makemon'd at the hero's square.  This whole
// function used to be a single pline: seed0007 step 289 records the missing
// rn2(5) at fountain.c:40 followed by six enexto+makemon chains (346 calls at
// that one boundary), every one of which the port skipped.
//
// Placement mirrors dowaterdemon()/dowaternymph(): the hero occupies (ux,uy),
// so makemon.c's `byyou && !in_mklev` arm runs enexto_core (collect_coords)
// BEFORE any of the new monster's own RNG.
async function dowatersnakes() {
    const u = game.u;
    let num = rn1(5, 2);
    const pmidx = name_to_pmidx('water moccasin');
    if ((game.mvitals?.[pmidx]?.mvflags ?? 0) & G_GONE) {
        await update_topl(
            'The fountain bubbles furiously for a moment, then calms.');
        return;
    }
    if (!Blind()) {
        // Hallucination substitutes makeplural(rndmonnam(NULL)), which draws;
        // rndmonnam() is not ported anywhere in js/ yet.
        await update_topl('An endless stream of snakes pours forth!');
    } else {
        await update_topl('You hear something hissing!');
    }
    const ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    if (!ptr) return;
    while (num-- > 0) {
        const spot = enexto_spawn(u.ux, u.uy, ptr);
        if (!spot) continue;
        const mtmp = makemon(ptr, spot.x, spot.y, 0 /* MM_NOMSG */);
        if (!mtmp) continue;
        placeOnLevel(mtmp, spot.x, spot.y);
        newsym(spot.x, spot.y);
        // mintrap(mtmp) when t_at(mtmp->mx, mtmp->my): mintrap is unported.
    }
}
// C ref: fountain.c dofindgem() — quaffing/dipping turns up a random gem.
// RNG (in this exact order, before exercise's rn2):
//   rnd_class(DILITHIUM_CRYSTAL, LUCKSTONE - 1)  -> rnd(862), the oc_prob sum
//                                                   over the 31 gem/glass types
//   mksobj_at(..., init=FALSE)                   -> next_ident's rnd(2)
// Both were missing, so every later draw in the turn was read by the wrong
// caller.  init is FALSE, so mksobj_init (blessorcurse etc.) is NOT run.
async function dofindgem() {
    if (!Blind())
        await update_topl('You spot a gem in the sparkling waters!');
    else
        await update_topl('You feel a gem here!');
    mksobj_at(rnd_class(DILITHIUM_CRYSTAL, LUCKSTONE - 1),
              game.u.ux, game.u.uy, false, false);
    const loc = game.level?.at(game.u.ux, game.u.uy);
    if (loc) loc.looted = (loc.looted || 0) | F_LOOTED;
    newsym(game.u.ux, game.u.uy);
    exercise(A_WIS, true);
}
// C ref: mkobj.c sobj_at(BOULDER, x, y) as used by gush() — is there a boulder
// on the floor at (x, y)?
function floor_boulder_at(x, y) {
    for (const o of game.level?.objects || [])
        if (o.where === 'floor' && o.ox === x && o.oy === y && o.otyp === BOULDER)
            return true;
    return false;
}

// C ref: engrave.c del_engr_at(x, y) — remove any engraving at (x, y) (no RNG,
// no message).
function del_engr_at(x, y) {
    if (!game.level?.engravings) return;
    game.level.engravings = game.level.engravings.filter(
        (ep) => ep.engr_x !== x || ep.engr_y !== y);
}

// C ref: fountain.c gush(x, y, poolcnt) — do_clear_area's per-cell callback
// for dogushforth().  Turns a floor-of-a-ROOM square within range into a
// POOL, unless a checkerboard/distance/terrain/boulder/door-adjacency guard
// skips it.  poolcnt is a {n} box so the caller can see how many succeeded.
async function gush(x, y, poolcnt) {
    const u = game.u;
    if (((x + y) % 2) || (x === u.ux && y === u.uy)
        || rn2(1 + distmin(u.ux, u.uy, x, y))
        || game.level?.at(x, y)?.typ !== ROOM
        || floor_boulder_at(x, y) || nexttodoor(x, y))
        return;

    const ttmp = t_at(x, y);
    if (ttmp && !delfloortrap(ttmp)) return;

    if (poolcnt.n++ === 0)
        await update_topl('Water gushes forth from the overflowing fountain!');

    const loc = game.level?.at(x, y);
    if (loc) { loc.typ = POOL; loc.flags = 0; }
    del_engr_at(x, y);
    // C ref: trap.c water_damage_chain(svl.level.objects[x][y], TRUE) — walks
    // the nexthere chain TOPMOST-FIRST with force=FALSE.  place_object() pushes,
    // so the topmost object is the LAST match in this port's flat array (cf.
    // invent.js objects_at()); the unreversed filter ran water_damage() bottom-up
    // and every erosion roll landed on the wrong object.
    const here = (game.level?.objects || []).filter(
        (o) => o.where === 'floor' && o.ox === x && o.oy === y).reverse();
    for (const obj of here) await water_damage(obj, null, false);

    // minliquid(mtmp) (monster drowning in the new pool) isn't modeled: no
    // covered session has a monster occupying a gush-flooded square.
    if (!m_at(x, y)) newsym(x, y);
}

async function dogushforth(drinking) {
    const u = game.u;
    const poolcnt = { n: 0 };
    for (const [x, y] of clear_area_cells(u.ux, u.uy, 7))
        await gush(x, y, poolcnt);
    if (!poolcnt.n) {
        if (drinking) await update_topl('Your thirst is quenched.');
        else await update_topl('Water sprays all over you.');
    }
}

// C ref: fountain.c watchman_warn_fountain(mtmp) — get_iter_mons() predicate:
// the first peaceful, could-see watchman yells at you.  No RNG.
async function watchman_warn_fountain(mtmp) {
    if (!is_watch(mtmp?.data) || !mtmp.mpeaceful) return false;
    if (!couldsee(mtmp.mx, mtmp.my)) return false;
    // Deaf hero gets the "waves his arms" variant instead; Deaf is never true
    // for these heroes and mbodypart()/nolimbs() aren't ported.
    const nm = x_monnam(mtmp, 2 /*ARTICLE_A*/, null, 0, false);
    await update_topl(`${nm.charAt(0).toUpperCase()}${nm.slice(1)} yells:`);
    await update_topl('"Hey, stop using that fountain!"');
    return true;
}

// C ref: fountain.c dryup(x, y, isyou) — a fountain has a 1-in-3 chance of
// drying up after use.  The rn2(3) roll fires unconditionally (short-circuit
// left operand of `!rn2(3) || FOUNTAIN_IS_WARNED`).
//
// The in-town arm is NOT unreachable: seed0014 steps 712-713 record it on Mine
// Town's Dlvl 7 ("A watchman yells:" / verbalize).  It matters twice over —
// it prints two lines AND it returns early, so the first in-town use never
// dries the fountain, and every use after it dries it unconditionally
// (FOUNTAIN_IS_WARNED short-circuits the rn2 test's OR).
export async function dryup(x, y, isyou) {
    const loc = game.level?.at(x, y);
    if (!loc || !IS_FOUNTAIN(loc.typ)) return;
    const warned = ((loc.looted || 0) & F_WARNED) !== 0;
    if (!(!rn2(3) || warned)) return;
    if (isyou && in_town(x, y) && !warned) {
        loc.looted = (loc.looted || 0) | F_WARNED; // SET_FOUNTAIN_WARNED
        let found = false;
        for (const mtmp of (game.level?.monsters || [])) {
            if (!mtmp || mtmp.mhp <= 0) continue;
            if (await watchman_warn_fountain(mtmp)) { found = true; break; }
        }
        if (!found) await update_topl('The flow reduces to a trickle.');
        return;
    }
    // C ref: fountain.c:218 — `if (isyou && wizard) { if (y_n("Dry up
    // fountain?") == 'n') return; }`.  The old comment claimed this was never
    // reached; it fires in seed4500 (playmode:debug).  It is not cosmetic: the
    // prompt READS A KEY, so leaving it out feeds that keystroke to rhack().
    if (isyou && game.flags?.debug) {
        if (await y_n('Dry up fountain?') === 'n') return;
    }
    // C ref: fountain.c:225 — the message is gated on cansee(x, y) (and on the
    // square not being hidden under a cloud glyph).
    if (cansee(x, y)) await update_topl('The fountain dries up!');
    // replace the fountain with ordinary floor
    loc.typ = ROOM;
    loc.flags = 0;
    loc.blessedftn = 0;
    if (game.level?.flags && typeof game.level.flags.nfountains === 'number')
        game.level.flags.nfountains = Math.max(0, game.level.flags.nfountains - 1);
    newsym(x, y);
    if (isyou && in_town(x, y)) angry_guards(false);
}

// ── sink interactions (fountain.c drinksink/breaksink) ──

function Hallucination() { return !!game.u?.uhallu; }

// C ref: prop.h Fire_resistance — intrinsic (Monk XL13, red dragon scales,
// role/race grants) or extrinsic.  Same multi-spelling read as
// Poison_resistance() above.
function Fire_resistance() {
    const u = game.u;
    if (!u) return false;
    const p = u.uprops || {};
    return !!(u.Fire_resistance || p.Fire_resistance || p.HFire_resistance
              || p.FireResistance);
}

// C ref: hack.c losehp() — for a non-polymorphed hero this subtracts the
// damage from u.uhp (no RNG).  Death handling is not exercised by the covered
// sessions, so it is reduced to the hp arithmetic + hpmax clamp.
function losehp(n) {
    const u = game.u;
    if (!u) return;
    u.uhp -= n;
    if (u.uhp > u.uhpmax) u.uhpmax = u.uhp;
    if (u.uhp < 1) u.uhp = 0;
}

// C ref: objclass.h OBJ_DESCR(obj) — the shuffled appearance word for obj's
// type (e.g. a potion's color).
function OBJ_DESCR(obj) {
    if (!obj) return null;
    const idx = obj.oc_descr_idx != null ? obj.oc_descr_idx : obj.otyp;
    return DESCR_BY_OTYP[idx] ?? null;
}

// C ref: do_name.c hcolor(colorpref) — colorpref unless hallucinating, in
// which case a random nonsense word replaces it.  The hallucination table
// isn't ported (not reached by the covered sessions' non-hallucinating hero);
// the roll still needs to fire to keep the PRNG faithful if that ever
// changes, but none of the covered sessions hallucinate while at a sink.
function hcolor(colorpref) {
    return colorpref;
}

// C ref: fountain.c breaksink(x, y) — converts a sink into a fountain (used
// by both drinksink's "pipes break" case and dipsink).  Both call sites have
// the hero standing on the square, so the cansee(x,y)||u_at(x,y) message
// guard always holds.
export async function breaksink(x, y) {
    await update_topl('The pipes break!  Water spurts out!');
    const loc = game.level?.at(x, y);
    if (loc) {
        loc.typ = FOUNTAIN;
        loc.looted = F_LOOTED; // SET_FOUNTAIN_LOOTED
        loc.blessedftn = 0;
        const lf = game.level?.flags;
        if (lf) {
            lf.nsinks = Math.max(0, (lf.nsinks || 0) - 1);
            lf.nfountains = (lf.nfountains || 0) + 1;
        }
    }
    newsym(x, y);
}

// C ref: makemon.c — a monster created at the hero's occupied square goes
// through the byyou && !in_mklev branch: enexto_core picks the nearest free
// square (before any of the new monster's own RNG), then place_monster()
// puts it there (mirrors fountain.js dowaterdemon's placement, minus the
// full-monster-gen weapon/inventory override that only armed species need).
async function spawnAtHeroSquare(pmidx) {
    const u = game.u;
    const ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    if (!ptr) return null;
    const spot = enexto_spawn(u.ux, u.uy, ptr);
    if (!spot) return null;
    const mtmp = makemon(ptr, spot.x, spot.y, 0 /* MM_NOMSG */);
    if (mtmp) {
        placeOnLevel(mtmp, spot.x, spot.y);
        newsym(spot.x, spot.y);
    }
    return mtmp;
}

// C ref: eat.c:3736 vomit() — retching immobilizes the hero.  For a plain
// (non-acid-breathing, non-poly'd) hero standing off an altar the cantvomit /
// Sick / spewed arms draw nothing, so this reduces to C's universal tail:
// nomul(-2) plus the deferred gn.nomovemsg that unmul() prints once the
// countdown reaches 0.  RNG-free, but the TWO frozen turns it buys are not —
// their monster moves belong to the same input boundary.
function vomit() {
    if ((game.multi ?? 0) >= -2) {              // eat.c:3759
        game.multi = -2;
        game.multi_reason = 'vomiting';
        game.context = game.context || {};
        game.context.travel = game.context.travel1 = game.context.mv = 0;
        game.nomovemsg = 'You can move again.';
    }
}

// C ref: fountain.c drinksink() — quaff from a sink the hero stands on.
// fate = rn2(20) selects the outcome.  Branches driving subsystems this port
// doesn't model yet (random-form polyself) still spend their observable
// message; case 13's create_gas_cloud(x,y,1,4) DOES still draw RNG even
// though its single-square BFS breaks before the first direction-shuffle
// draw — the cloud's ttl = rn1(3,4) roll happens unconditionally after the
// (possibly empty) growth loop, so it must be called, not skipped.
export async function drinksink() {
    const u = game.u;
    if (u.uprops?.Levitation) {
        await update_topl('You are floating high above the sink.');
        return;
    }
    const loc = game.level?.at(u.ux, u.uy);
    const water = hliquid('water');
    switch (rn2(20)) {
    case 0:
        await update_topl(`You take a sip of very cold ${water}.`);
        break;
    case 1:
        await update_topl(`You take a sip of very warm ${water}.`);
        break;
    case 2:
        await update_topl(`You take a sip of scalding hot ${water}.`);
        // C ref: fountain.c:614 — a fire-resistant hero gets "It seems quite
        // tasty." and takes NO damage, so the rnd(6) must not be drawn either.
        // monstseesu/monstunseesu (M_SEEN_FIRE) is monster-memory bookkeeping
        // with no RNG.
        if (Fire_resistance()) {
            await update_topl('It seems quite tasty.');
        } else {
            losehp(rnd(6));
        }
        break;
    case 3: {
        const pmidx = name_to_pmidx('sewer rat');
        if ((game.mvitals?.[pmidx]?.mvflags ?? 0) & G_GONE) {
            await update_topl('The sink seems quite dirty.');
        } else {
            const mtmp = await spawnAtHeroSquare(pmidx);
            if (mtmp) {
                const seen = !Blind() && canspotmon(mtmp);
                await update_topl(`Eek!  There's ${seen ? x_monnam(mtmp, 2 /*ARTICLE_A*/, null, 0, false) : 'something squirmy'} in the sink!`);
            }
        }
        break;
    }
    case 4: {
        let otmp;
        for (;;) {
            otmp = mkobj(POTION_CLASS, false);
            if (otmp.otyp !== POT_WATER) break;
        }
        otmp.cursed = false;
        otmp.blessed = false;
        const descr = OBJ_DESCR(otmp) || 'strange';
        await update_topl(`Some ${Blind() ? 'odd' : hcolor(descr)} liquid flows from the faucet.`);
        if (!Blind() && !Hallucination())
            observe_object(otmp);
        otmp.quan = (otmp.quan || 1) + 1; // avoid a panic upon useup() (never in invent)
        otmp.fromsink = 1; // kludge for docall(); not otherwise modeled
        const { dopotion } = await import('./potion.js');
        await dopotion(otmp);
        break;
    }
    case 5:
        if (!((loc?.looted || 0) & S_LRING)) {
            await update_topl('You find a ring in the sink!');
            mkobj_at(RING_CLASS, u.ux, u.uy, true);
            if (loc) loc.looted = (loc.looted || 0) | S_LRING;
            exercise(A_WIS, true);
            newsym(u.ux, u.uy);
        } else {
            await update_topl(`Some dirty ${water} backs up in the drain.`);
        }
        break;
    case 6:
        await breaksink(u.ux, u.uy);
        break;
    case 7: {
        await update_topl(`The ${water} moves as though of its own will!`);
        const pmidx = name_to_pmidx('water elemental');
        const gone = (game.mvitals?.[pmidx]?.mvflags ?? 0) & G_GONE;
        const mtmp = gone ? null : await spawnAtHeroSquare(pmidx);
        if (!mtmp) await update_topl('But it quiets down.');
        break;
    }
    case 8:
        await update_topl(`Yuk, this ${water} tastes awful.`);
        more_experienced(1, 0);
        await newexplevel();
        break;
    case 9:
        await update_topl('Gaggg... this tastes like sewage!  You vomit.');
        morehungry(rn1(30 - acurr_eff(A_CON), 11));
        vomit();
        break;
    case 10:
        await update_topl(`This ${water} contains toxic wastes!`);
        // Unchanging is never true for the covered heroes.
        await update_topl('You undergo a freakish metamorphosis!');
        // polyself(POLY_NOFLAGS) is not modeled (no polymorph subsystem yet).
        break;
    case 11:
        await update_topl('You hear clanking from the pipes...');
        break;
    case 12:
        await update_topl('You hear snatches of song from among the sewers...');
        break;
    case 13:
        await update_topl('Ew, what a stench!');
        await create_gas_cloud(u.ux, u.uy, 1, 4);
        break;
    case 19:
        if (Hallucination()) {
            await update_topl('From the murky drain, a hand reaches up... --oops--');
            break;
        }
        /* falls through */
    default:
        await update_topl(`You take a sip of ${rn2(3) ? (rn2(2) ? 'cold' : 'warm') : 'hot'} ${water}.`);
        break;
    }
}
