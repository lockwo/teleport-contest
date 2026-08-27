// zap.js — wand/spell zapping helpers.
// C ref: zap.c.  Only the routines whose RNG side-effects are exercised by
// the gameplay sessions are ported here.

import { game } from './gstate.js';
import { rn2, rn1, rnd, rnl, d } from './rng.js';
import { pline, newsym, m_at, show_glyph_cell, update_topl, topl_more, y_n,
         bot, flush_screen, canseemon_shared, map_invisible, unmap_object,
         impossible } from './display.js';
import { getobj, makeknown, useupall, useup, delobj, GETOBJ_SUGGEST, GETOBJ_EXCLUDE,
         GETOBJ_NOFLAGS, xname, near_capacity, splitobj, delobj_core, obfree,
         obj_extract_self, sobj_at, encumber_msg, is_weptool, update_inventory,
         display_minventory } from './invent.js';
import { mon_mr } from './monmr_data.js';
import { mflags1_of, M1_NOEYES, is_undead_flag, nohands } from './monflags_data.js';
// AD_MAGM is NOT imported: this file already declares the AD_* block locally
// (same values), and a duplicate binding is a module-load SyntaxError.
import { attacktype_fordmg, dmgtype, AT_EXPL, AT_GAZE, AD_BLND,
         AD_RBRE, attacktype, AT_ENGL, AT_HUGS, AD_DRLI, AD_SEDU, AD_SSEX,
         AD_DGST, AD_STCK, AD_WRAP } from './monattk_data.js';
import { observe_object } from './o_init.js';
// C ref: attrib.h ACURR(x) == acurr(x) (abon + atemp + acurr, clamped).
import { exercise, acurr_eff as ACURR } from './attrib.js';
import { more_experienced } from './exper.js';
import { findit } from './detect.js';
import { cansee, vision_recalc } from './vision.js';
import { WAND_CLASS, GEM_CLASS, TOOL_CLASS, POTION_CLASS, SCROLL_CLASS, WEAPON_CLASS, ARMOR_CLASS,
         FOOD_CLASS, RING_CLASS, POT_OIL, POT_WATER, GLOB_OF_GREEN_SLIME,
         SPBOOK_CLASS, mkobj as _mkobj, place_object, objects,
         mkcorpstat, CORPSE, AMULET_OF_YENDOR, BELL_OF_OPENING, next_ident,
         CANDELABRUM_OF_INVOCATION, SPE_BOOK_OF_THE_DEAD,
         is_rider_pm, ROCK_CLASS, unbless, uncurse, container_weight,
         has_omonst, get_mtraits, has_omid, OMID, free_omid, free_omonst,
         obj_ice_effects } from './mkobj.js';
import { A_WIS, A_STR, A_INT, A_CON, A_DEX, A_CHA, ROWNO, COLNO, ZAP_POS, IS_DOOR, IS_ROOM, IS_WALL, isok, ROOM, STONE,
         D_CLOSED, D_LOCKED, CORPSTAT_INIT, EXT_ENCUMBER, HEADSTONE, ENGRAVE,
         DUST, MM_NOMSG, In_mines, W_ARM, W_ARMC, W_ARMH, W_ARMS, W_ARMG,
         W_ARMF, W_ARMU, POOL, IS_FOUNTAIN, Is_waterlevel,
         POLY_NOFLAGS, CORR, GRAVE, MOAT, DRAWBRIDGE_UP, DRAWBRIDGE_DOWN,
         ICED_POOL, DB_ICE, BURIED_TOO, CONTAINED_TOO, CXN_NORMAL, CXN_NO_PFX,
         CXN_PFX_THE, NO_MINVENT, MM_NOWAIT, MM_NOCOUNTBIRTH, MM_NOTAIL,
         MM_ADJACENTOK, MM_MALE, MM_FEMALE, CORPSTAT_GENDER, CORPSTAT_MALE,
         CORPSTAT_FEMALE, NON_PM, ANIMATE_SPELL, NC_VIA_WAND_OR_SPELL,
         NO_NC_FLAGS, SHOPBASE, TIMER_OBJECT, TIMER_LEVEL, REVIVE_MON,
         ROT_CORPSE, SHRINK_GLOB, W_ARMOR, W_ACCESSORY, W_WEP, W_ART,
         W_AMUL, W_TOOL, W_RING, W_RINGL, FIRE_RES, COLD_RES,
         SHOCK_RES, ACID_RES, DISINT_RES, is_magical_trap, has_oname, ONAME,
         ESHK, engulfing_u, u_at, M_AP_TYPE, NHW_TEXT, NHW_MENU,
         PICK_ONE } from './const.js';
import { is_pool, is_ice } from './dbridge.js';
import { create_gas_cloud } from './region.js';
import { CLR_ORANGE, CLR_BLACK, CLR_GREEN, CLR_YELLOW, CLR_WHITE, CLR_BRIGHT_BLUE } from './terminal.js';
// C ref: display.c:2661 zapcolors[NUM_ZAP], display.h:280 (HI_ZAP == CLR_BRIGHT_BLUE).
// Indexed by the HALLUCINATED damage type, so every beam used to draw orange.
const ZAPCOLORS = [CLR_BRIGHT_BLUE, CLR_ORANGE, CLR_WHITE, CLR_BRIGHT_BLUE,
                   CLR_BLACK, CLR_WHITE, CLR_GREEN, CLR_YELLOW];
import { can_make_bones } from './bones.js';
import { DEADMONSTER, set_ustuck, dealloc_monst, replmon,
         restore_cham } from './mon.js';
import { MON_WEP } from './monmove.js';
import { killed, canspotmon, mon_nam, Monnam, x_monnam,
         mon_pmname } from './uhitm.js';
import { find_mac as worn_find_mac } from './worn.js';

// Object-type numbers for the directional wands/spells that zapyourself() gives
// a special self-inflicted effect.  C ref: include/objects.h (WAN_DEATH),
// generated onames.h.  Match the JS objects table (mkobj.js): SPE_FINGER_OF_DEATH
// = 371, WAN_DEATH = 433.
const SPE_FINGER_OF_DEATH = 371;
const WAN_DEATH = 433;
// C ref: objects.h — WAN_SLEEP / SPE_SLEEP fire a sleep ray; zapping at self
// puts the hero to sleep.  (JS objects table: WAN_SLEEP 432, SPE_SLEEP 370.)
const WAN_SLEEP = 432;
const SPE_SLEEP = 370;

// C ref: zap.c obj_resists(obj, ochance, achance) — chance an object resists
// (e.g. destruction / theft).  The Amulet, the invocation items and Rider
// corpses always resist and are NOT rolled for; everything else rolls rn2(100)
// and resists when the roll lands below the per-object chance (achance for
// artifacts, ochance otherwise).
//
// The otyps come from mkobj.js's object table rather than local literals: the
// four that used to live here (155/355/360/359) were 3.4-era indices naming an
// orcish shield and three unused scroll slots, so the early return never fired
// and every invocation item burned an extra rn2(100).
export function obj_resists(obj, ochance, achance) {
    const otyp = obj?.otyp;
    if (otyp === AMULET_OF_YENDOR
        || otyp === SPE_BOOK_OF_THE_DEAD
        || otyp === CANDELABRUM_OF_INVOCATION
        || otyp === BELL_OF_OPENING
        || (otyp === CORPSE && is_rider_pm(obj.corpsenm))) {
        return true;
    }
    const chance = rn2(100);
    return chance < (obj?.oartifact ? achance : ochance);
}

const ECMD_CANCEL = 0;
const ECMD_OK = 0;
const ECMD_TIME = 1;

// C ref: objclass.h oc_dir values.
const NODIR = 1;
const IMMEDIATE = 2;

// C ref: include/objects.h enum, mapped onto the JS objects table (mkobj.js).
const WAN_LIGHT = 410;
const WAN_SECRET_DOOR_DETECTION = 411;
const WAN_ENLIGHTENMENT = 412;
const WAN_CREATE_MONSTER = 413;
const WAN_WISHING = 414;
const WAN_STASIS = 415;
const WAN_NOTHING = 416;
const WAN_STRIKING = 417;
const WAN_MAKE_INVISIBLE = 418;
const WAN_SLOW_MONSTER = 419;
const WAN_SPEED_MONSTER = 420;
const WAN_UNDEAD_TURNING = 421;
const WAN_CANCELLATION = 423;
const WAN_TELEPORTATION = 424;
const WAN_OPENING = 425;
const WAN_LOCKING = 426;
const WAN_PROBING = 427;
const WAN_FIRE = 430;
const WAN_COLD = 431;
const WAN_LIGHTNING = 434;
const SPE_LIGHT = 372;
const SPE_DETECT_UNSEEN = 389;
const SPE_FORCE_BOLT = 376;
const SPE_MAGIC_MISSILE = 367;
const SPE_CONE_OF_COLD = 369;
const SPE_HEALING = 374;
const SPE_EXTRA_HEALING = 391;
const SPE_KNOCK = 375;
const SPE_WIZARD_LOCK = 381;
const SPE_DRAIN_LIFE = 379;
const SPE_SLOW_MONSTER = 380;
const SPE_TURN_UNDEAD = 398;
const SPE_TELEPORT_AWAY = 400;
const SPE_CANCELLATION = 402;
const SPE_STONE_TO_FLESH = 405;
const FROST_HORN = 250;
const FIRE_HORN = 251;
const EXPENSIVE_CAMERA = 229;
// C ref: monsters.h — hero polymorphed into a gremlin takes light damage.
const PM_GREMLIN = 40;
// C ref: objects.h ROCK.  poly_obj()'s GEM_CLASS arm used to write 481, which
// is past the end of the JS objects table (the last real otyp is 480), so a
// polymorphed mineral gem became an object with no type record at all.
const ROCK = 474;
// C ref: objects.h UNICORN_HORN — poly_obj()'s degraded_horn special case.
const UNICORN_HORN = 261;
// C ref: objects.h TIN — the one otyp probe_objchain() marks `known`.
const TIN = 296;
const WAND_WREST_CHANCE = 121;
const WAND_BACKFIRE_CHANCE = 100;

// otyps consulted by the IMMEDIATE wand path.  C ref: include/objects.h enum.
const WAN_POLYMORPH = 422;
const SPE_POLYMORPH = 399;
const POT_POLYMORPH = 316;
// objects.h order: ...RESTFUL_SLEEP(204) versus_poison(205) CHANGE(206)
// UNCHANGING(207) REFLECTION(208) MAGICAL_BREATHING(209) GUARDING(210)...
// This was 210 (the amulet of GUARDING), so unpolyable() let an amulet of
// unchanging be polymorphed and protected the wrong amulet instead.
const AMULET_OF_UNCHANGING = 207;

// C ref: zap.c zap_ok — getobj callback: only wands are suggested.
function zap_ok(obj) {
    if (obj && obj.oclass === WAND_CLASS)
        return GETOBJ_SUGGEST;
    return GETOBJ_EXCLUDE;
}

// C ref: zap.c zappable — can the wand be zapped?  spe<0 -> no; spe==0 wrests
// a final charge with WAND_WREST_CHANCE odds; otherwise consume one charge.
export function zappable(wand) {
    if (wand.spe < 0 || (wand.spe === 0 && rn2(WAND_WREST_CHANCE)))
        return false;
    if (wand.spe === 0)
        game._pending_message = 'You wrest one last charge from the worn-out wand.';
    wand.spe--;
    return true;
}

// C ref: zap.c backfire(otmp) — a cursed wand explodes in the hero's face.
// zappable() has already decremented spe, so d(spe + 2, 6) is rolled against
// the post-decrement charge count exactly as C does.
async function backfire(otmp) {
    otmp.in_use = true;            /* in case losehp() is fatal */
    await pline(`The ${xname(otmp)} suddenly explodes!`);
    const dmg = d((otmp.spe | 0) + 2, 6);
    await losehp(Maybe_Half_Phys(dmg), 'exploding wand');
    useupall(otmp);
}

// C ref: read.c wand_explode(obj, chg) — overcharging a wand, or zapping /
// engraving with a cursed one.  chg==0 is the zap/engrave case, which uses 2
// damage dice plus the wand's charges.
export async function wand_explode(obj, chg) {
    const expl = !chg ? 'suddenly' : 'vibrates violently and';
    if (!chg) chg = 2;
    let n = (obj.spe | 0) + chg;
    if (n < 2) n = 2;
    let k;
    switch (obj.otyp) {
    case WAN_WISHING: k = 12; break;
    case WAN_CANCELLATION: case WAN_DEATH: case WAN_POLYMORPH:
    case WAN_UNDEAD_TURNING: k = 10; break;
    case WAN_COLD: case WAN_FIRE: case WAN_LIGHTNING:
    case 429 /*WAN_MAGIC_MISSILE*/: k = 8; break;
    case WAN_NOTHING: k = 4; break;
    default: k = 6; break;
    }
    const dmg = d(n, k);
    obj.in_use = true;
    await pline(`Your ${xname(obj)} ${expl} explodes!`);
    await losehp(Maybe_Half_Phys(dmg), 'exploding wand');
    useup(obj);
    exercise(A_STR, false);
}

// C ref: youprop.h Maybe_Half_Phys(dmg) — halve physical damage when the hero
// has Half_physical_damage.  No covered hero carries it; kept so the callers
// read like C.
function Maybe_Half_Phys(dmg) {
    return (game.u?.uprops?.Half_physical_damage) ? Math.trunc((dmg + 1) / 2) : dmg;
}

// C ref: zap.c learnwand — discover a wand's type once its effect is observed.
// Three C guards were missing: spellbooks (the fake spellbook object a cast
// spell passes in) are skipped entirely, an already-discovered type only marks
// the individual item seen, and makeknown() only fires when obj->dknown — a
// wand picked up blind and zapped stays undiscovered.  Discovery is not
// cosmetic: it renames the object everywhere and gates zapnodir()'s
// more_experienced(0, 10).
export function learnwand(obj) {
    if (!obj || obj.oclass === SPBOOK_CLASS) return;
    if (objects[obj.otyp]?.oc_name_known) {
        observe_object(obj);
    } else {
        if (!Blind()) observe_object(obj);
        if (obj.dknown) makeknown(obj.otyp);
    }
}

// C ref: zap.c zapnodir — apply a directionless wand/spell.  Every NODIR otyp
// C handles is handled here: the five that used to fall through to the silent
// default each draw RNG (stasis rn1(21,10), create monster rn2(23) + makemon,
// wishing rn2(5), enlightenment's exercise(A_WIS) rn2(19)) or relight the
// level (wand of light), which steers every later cansee()-gated predicate.
export async function zapnodir(obj) {
    let known = false;
    switch (obj.otyp) {
    case WAN_LIGHT:
    case SPE_LIGHT:
        known = !!(obj.dknown && !Blind());
        await litroom_zap(true, obj);
        await lightdamage(obj, true, 5);
        break;
    case WAN_SECRET_DOOR_DETECTION:
    case SPE_DETECT_UNSEEN:
        known = !!obj.dknown;
        await findit();
        break;
    case WAN_STASIS: {
        // No message at all (deliberately indistinguishable from the other
        // silent NODIR wands), but the rn1(21,10) is drawn unconditionally and
        // the level flag gates monster movement for the duration.
        const tmp_until = (game.moves | 0) + rn1(21, 10);
        const lf = game.level?.flags;
        if (lf && tmp_until > (lf.stasis_until | 0)) lf.stasis_until = tmp_until;
        break;
    }
    case WAN_CREATE_MONSTER:
        if (await create_critters(rn2(23) ? 1 : rn1(7, 2), null, false))
            known = !!obj.dknown;
        break;
    case WAN_WISHING:
        if (Luck() + rn2(5) < 0) {
            await pline('Unfortunately, nothing happens.');
            known = false;
        } else {
            known = !!obj.dknown;
            await makewish();
        }
        break;
    case WAN_ENLIGHTENMENT:
        known = !!obj.dknown;
        await do_enlightenment_effect();
        break;
    default:
        break;
    }
    if (known) {
        if (!objects[obj.otyp]?.oc_name_known)
            more_experienced(0, 10);
        learnwand(obj);
    }
}

// C ref: zap.c do_enlightenment_effect — the trailing exercise(A_WIS, TRUE) is
// an rn2(19) draw; the enlightenment window itself is a menu (display_nhwindow
// + enlightenment), which this port renders through insight.js.
async function do_enlightenment_effect() {
    await pline('You feel self-knowledgeable...');
    const { show_attributes_disclosure } = await import('./insight.js');
    await show_attributes_disclosure(0 /* ENL_GAMEINPROGRESS */);
    await pline('The feeling subsides.');
    exercise(A_WIS, true);
}

// C ref: makemon.c create_critters(cnt, mptr, neverask).
// DEFERRED, and load-bearing: zapnodir() passes neverask = FALSE, so C's
// `ask = (wizard && !neverask)` is TRUE in the wizard-mode sessions this corpus
// records — C prompts "Create what kind of monster?" (read.c create_particular)
// once per critter and only falls through to makemon() after an ESC.  Wiring
// that up means exporting extcmd-handlers.js's already-ported create_particular
// and giving it C's boolean return; until then a wand of create monster reads
// one fewer line of input than C does.
async function create_critters(cnt, mptr, _neverask) {
    const { makemon } = await import('./makemon.js');
    const u = game.u;
    let known = false;
    while (cnt-- > 0) {
        // (u.uinwater enexto(GIANT_EEL) relocation isn't modelled: no covered
        // hero zaps while underwater.)
        const mon = makemon(mptr, u.ux, u.uy, 0);
        if (!mon) continue;
        if (canspotmon(mon)) known = true;
    }
    return known;
}

// C ref: zap.c lightdamage — pseudo-damage used for blindness duration.  The
// rnd() rolls only happen when the hero is polymorphed into a gremlin.
async function lightdamage(obj, ordinary, amt) {
    let dmg = amt;
    if (dmg && game.u?.umonnum === PM_GREMLIN) {
        dmg = rnd(dmg);
        if (dmg > 10) dmg = 10 + rnd(dmg - 10);
        if (dmg > 20) dmg = 20;
        await pline(`Ow, that light hurts${(dmg > 2 || (game.u?.mh ?? 0) <= 5) ? '!' : '.'}`);
        await losehp(Maybe_Half_Phys(dmg),
                     `${ordinary ? 'zapped' : 'blasted'} himself with ${xname(obj)}`);
    }
    return dmg;
}

// C ref: read.c litroom(on, obj) — reached from the wand/spell of light as well
// as the scroll.  read.js owns the implementation; import it lazily so zap.js
// keeps its current module-init order.
async function litroom_zap(on, obj) {
    const { litroom } = await import('./read.js');
    if (litroom) await litroom(on, obj);
}

// C ref: zap.c makewish() — the wand-of-wishing prompt.  The whole function is
// already ported for #wizwish (getlin -> readobjnam -> hold_another_object ->
// u.ublesscnt += rn1(100, 50)); the wand reaches the SAME C function, so a stub
// here both left the getlin unread and dropped every one of those draws.
// C prints "You may wish for an object." only when flags.verbose, and wiz_wish()
// clears verbose across its own call — hence the line lives here, not in
// makewish itself.
async function makewish() {
    if (game.flags?.verbose !== false)
        await pline('You may wish for an object.');
    const { makewish: makewish_impl } = await import('./extcmd-handlers.js');
    await makewish_impl();
}

// C ref: hack.h Luck — u.uluck + u.moreluck (plus the luck timeout, which this
// port folds into uluck).
function Luck() { return (game.u?.uluck | 0) + (game.u?.moreluck | 0); }
// C ref: youprop.h Blind — u.ucreamed or the Blinded timeout.
function Blind() {
    const u = game.u;
    return !!(u?.uprops?.Blinded || u?.Blind || u?.ucreamed);
}

// C ref: include/obj.h unpolyable(o) — object types that can't be polymorphed
// (the polymorph items themselves and the amulet of unchanging).
function unpolyable(obj) {
    return obj.otyp === WAN_POLYMORPH || obj.otyp === SPE_POLYMORPH
        || obj.otyp === POT_POLYMORPH || obj.otyp === AMULET_OF_UNCHANGING;
}

// C ref: zap.c obj_unpolyable — TRUE if the object resists polymorphing.
// (uball/uskin are never on the polymorph pile in the covered sessions.)
function obj_unpolyable(obj) {
    return unpolyable(obj) || obj_resists(obj, 5, 95);
}

// C ref: zap.c obj_shudders — chance an object metamorphoses (system shock)
// rather than polymorphing cleanly.  Returns !rn2(zap_odds).
function obj_shudders(obj) {
    // svc.context.bypasses path not reachable here (no monster inventory drops).
    let zap_odds;
    if (obj.oclass === WAND_CLASS) zap_odds = 3;      /* half-life = 2 zaps */
    else if (obj.cursed) zap_odds = 3;                /* half-life = 2 zaps */
    else if (obj.blessed) zap_odds = 12;              /* half-life = 8 zaps */
    else zap_odds = 8;                                /* half-life = 6 zaps */
    if ((obj.quan || 1) > 4) zap_odds = Math.trunc(zap_odds / 2);
    return !rn2(zap_odds);
}

// C ref: zap.c do_osshock — an object hit by polymorph suffers system shock and
// is (partly) destroyed.  Sets go.obj_zapped so zapwrapup() can announce the
// "shuddering vibrations".  poly_zapped tracking only matters for golem creation
// (create_polymon), which needs poly_zapped >= 0; with rn2(Luck+45) the loop
// almost always leaves it at -1.  splitobj() for quan>1 piles isn't exercised by
// the covered sessions, so the quan==1 delobj() case is modelled faithfully.
function do_osshock(obj) {
    game.obj_zapped = true;
    const Luck = (game.u?.uluck || 0) + (game.u?.moreluck || 0);
    if (game.poly_zapped < 0) {
        for (let i = obj.quan || 1; i; i--) {
            if (!rn2(Luck + 45)) {
                game.poly_zapped = objects[obj.otyp]?.material ?? 0;
                break;
            }
        }
    }
    // C: "if quan > 1 then some will survive intact" — splitobj() peels off
    // rnd(quan - 1) of the stack and only the split-off part is destroyed.  The
    // rnd() is drawn whenever quan > 1, so skipping it desynchronized every
    // polymorph zap that hit a stack (arrows, gems, potions...).
    let target = obj;
    const quan = obj.quan || 1;
    if (quan > 1) {
        // splitobj(obj, rnd(quan - 1)): the rnd() plus nextoid()'s trailing
        // next_ident() (an rnd(2) in this port) are both drawn here, and only
        // the split-off part is destroyed — the remainder survives on the floor.
        target = splitobj_z(obj, rnd(quan - 1));
    }
    delobj(target); /* obj_resists(obj,0,0) rn2(100) + newsym() */
}

// C ref: mkobj.c splitobj(obj, num) — peel `num` off a stack into a new object
// inserted immediately after it in the same chain.  o_id comes from nextoid(),
// whose trailing next_ident() is this port's only RNG in the function.
function splitobj_z(obj, num) {
    const otmp = { ...obj };
    otmp.o_id = next_ident();
    otmp.timed = 0;
    otmp.lamplit = 0;
    otmp.owornmask = 0;
    obj.quan = (obj.quan || 1) - num;
    obj.owt = weight_of(obj);
    otmp.quan = num;
    otmp.owt = weight_of(otmp);
    const arr = game.level?.objects;
    if (arr && obj.where === 'floor') {
        const i = arr.indexOf(obj);
        if (i >= 0) arr.splice(i + 1, 0, otmp); else arr.push(otmp);
    }
    return otmp;
}

// C ref: mkobj.c weight(obj) — quantity * per-item weight.  Only the stack
// arithmetic splitobj() needs is modelled here.
function weight_of(obj) {
    const w = objects[obj.otyp]?.oc_weight ?? 0;
    return w * (obj.quan || 1);
}

// C ref: zap.c poly_obj(obj, STRANGE_OBJECT) — replace a floor object with a
// random object of the same class while preserving the magic-or-not status.
// Only the STRANGE_OBJECT (standard polymorph) case is exercised here; the new
// object inherits quantity / bcu / charges and replaces the old on the floor.
function poly_obj(obj, can_merge = true /* id == STRANGE_OBJECT */) {
    const ox = obj.ox, oy = obj.oy;
    let magic_obj = objects[obj.otyp]?.oc_magic ? 1 : 0;
    // C: a degraded unicorn horn counts as non-magic, which changes which
    // candidate the retry loop below accepts (and therefore how many mkobj()
    // rolls it burns).
    if (obj.otyp === UNICORN_HORN && obj.degraded_horn) magic_obj = 0;
    let tryLimit = 3;
    let otmp = null;
    do {
        if (otmp) delobj(otmp); /* C delobj() -> obj_resists(otmp,0,0) rn2(100) */
        otmp = _mkobj(obj.oclass, false);
    } while (--tryLimit > 0 && (objects[otmp.otyp]?.oc_magic ? 1 : 0) !== magic_obj);

    // preserve quantity / shopkeeper interest
    otmp.quan = obj.quan;
    otmp.no_charge = obj.no_charge;

    // avoid abusing eggs laid by hero (generic-egg path); not exercised, but
    // keep the corpsenm carryover for CORPSE/STATUE/FIGURINE handled by mkobj.

    // keep special fields (charges on wands/weapons/armor)
    if (otmp.oclass === WAND_CLASS || otmp.oclass === 2 /*WEAPON*/
        || otmp.oclass === 3 /*ARMOR*/)
        otmp.spe = obj.spe;
    otmp.recharged = obj.recharged;
    otmp.cursed = obj.cursed;
    otmp.blessed = obj.blessed;

    // C: `!objects[otmp->otyp].oc_merge || (can_merge && quan > rn2(1000))`.
    // mkobj.js packs oc_merge as bit 5 (F_MERGE) of the row's `flags` word;
    // testing the whole word (the old `!objects[...].flags`) answered FALSE for
    // every object with ANY flag bit set, so the rn2(1000) was drawn for
    // non-mergeable stacks and skipped for mergeable ones.
    const F_MERGE = 32;
    if ((otmp.quan || 1) > 1
        && (!(objects[otmp.otyp]?.flags & F_MERGE)
            || (can_merge && otmp.quan > rn2(1000))))
        otmp.quan = 1;

    // class-specific degrade / anti-polymorph-loop handling
    switch (otmp.oclass) {
    case TOOL_CLASS:
        if (otmp.otyp === 228 /*MAGIC_LAMP*/) { otmp.otyp = 227 /*OIL_LAMP*/; otmp.age = 1500; }
        else if (otmp.otyp === 242 /*MAGIC_MARKER*/) otmp.recharged = 1;
        break;
    case WAND_CLASS:
        while (otmp.otyp === 414 /*WAN_WISHING*/ || otmp.otyp === WAN_POLYMORPH)
            otmp.otyp = rnd_class_wand();
        if ((otmp.recharged | 0) < rn2(7)) otmp.recharged = (otmp.recharged | 0) + 1;
        break;
    case POTION_CLASS:
        while (otmp.otyp === POT_POLYMORPH)
            otmp.otyp = rnd_class_potion();
        break;
    case SPBOOK_CLASS:
        while (otmp.otyp === SPE_POLYMORPH)
            otmp.otyp = rnd_class_spbook();
        if (otmp.otyp !== 407 /*SPE_BLANK_PAPER*/ && otmp.otyp !== 408 /*SPE_NOVEL*/) {
            otmp.spestudied = (obj.spestudied | 0) + 1;
            if (otmp.spestudied > 3 /*MAX_SPELL_STUDY (spell.h:12)*/) {
                otmp.spestudied = rn2(otmp.spestudied);
                otmp.otyp = 407 /*SPE_BLANK_PAPER*/;
            }
        }
        break;
    case GEM_CLASS:
        // C ref: objclass.h MINERAL == 21.  The `else if` GLASS arm that used to
        // sit here is not in 3.7's poly_obj at all; C's only extra step is
        // halving the stack when the transmutation backfires.
        if ((otmp.quan || 1) > rnd(4)
            && (objects[obj.otyp]?.material === 21 /*MINERAL (objclass.h:34); 7 is LEATHER*/)
            && (objects[otmp.otyp]?.material !== 21)) {
            // C ref: zap.c:1887-1888.  ROCK is otyp 474; 481 is off the end of
            // the 481-entry table, so every later objects[otyp] lookup returned
            // undefined.  C also halves the stack.
            otmp.otyp = ROCK;
            otmp.quan = Math.trunc((otmp.quan || 1) / 2);
        }
        break;
    default:
        break;
    }

    otmp.owt = weight_of(otmp);   /* C: otmp->owt = weight(otmp) */

    // replace old object with new in the same floor-chain position
    const floorObjects = game.level?.objects;
    const floorIndex = floorObjects?.indexOf(obj) ?? -1;
    delobj(obj);
    place_object(otmp, ox, oy);
    if (floorIndex >= 0) {
        floorObjects.pop();
        floorObjects.splice(floorIndex, 0, otmp);
    }
    return otmp;
}

// rnd_class helpers for the (rare) wand/potion/spellbook anti-loop above.
// C ref: zap.c rnd_class(first,last) over the real object range of the class.
function rnd_class_range(first, last) {
    let sum = 0;
    for (let i = first; i <= last; i++) sum += objects[i]?.oc_prob || 0;
    if (!sum) return rn1(last - first + 1, first);
    let x = rnd(sum);
    for (let i = first; i <= last; i++) { x -= objects[i]?.oc_prob || 0; if (x <= 0) return i; }
    return first;
}
function rnd_class_wand()   { return rnd_class_range(410 /*WAN_LIGHT*/, 434 /*WAN_LIGHTNING*/); }
function rnd_class_potion() { return rnd_class_range(297 /*POT_GAIN_ABILITY*/, 322 /*POT_WATER*/); }
function rnd_class_spbook() { return rnd_class_range(366, 407 /*SPE_BLANK_PAPER*/); }

// Like delobj() but without the obj_resists() RNG / newsym (used to discard a
// freshly mkobj'd candidate during poly_obj's magic-matching retry loop.
function delobj_freeonly(obj) {
    if (!obj) return;
    const arr = game.level?.objects;
    if (arr) { const i = arr.indexOf(obj); if (i >= 0) arr.splice(i, 1); }
    obj.where = 0 /*OBJ_FREE*/;
}

// C ref: zap.c bhito — a wand effect (here WAN_POLYMORPH) hitting one floor
// object.  Returns 1 if the object was affected (drives bhit range decrement),
// 0 otherwise.
function bhito(obj, otmp) {
    let res = 1;
    if (obj === otmp) return 0;
    // uball/uchain not on covered piles.
    switch (otmp.otyp) {
    case WAN_POLYMORPH:
    case SPE_POLYMORPH:
        if (obj_unpolyable(obj)) { res = 0; break; }
        if (!game.u) game.u = {};
        if (!game.u.uconduct) game.u.uconduct = {};
        game.u.uconduct.polypiles = (game.u.uconduct.polypiles | 0) + 1;
        // Is_box boxlock not on covered piles.
        if (obj_shudders(obj)) {
            const learnIt = cansee(obj.ox, obj.oy);
            do_osshock(obj);
            if (learnIt && otmp.dknown) makeknown(otmp.otyp);
            break;
        }
        obj = poly_obj(obj);
        newsym(obj.ox, obj.oy);
        break;
    case WAN_PROBING:
        // res = !obj->dknown BEFORE observe_object() marks it seen; a container
        // or statue forces res = 1.  No RNG, but res drives bhit()'s range--,
        // which decides how far the beam travels — the old `default: res = 0`
        // made every probing beam one square too long.
        res = obj.dknown ? 0 : 1;
        observe_object(obj);
        break;
    case WAN_MAKE_INVISIBLE:
        break;                       /* res stays 1 */
    case WAN_SLOW_MONSTER:
    case SPE_SLOW_MONSTER:
    case WAN_SPEED_MONSTER:
    case WAN_NOTHING:
    case SPE_HEALING:
    case SPE_EXTRA_HEALING:
        res = 0;                     /* no effect on objects */
        break;
    case WAN_OPENING:
    case SPE_KNOCK:
    case WAN_LOCKING:
    case SPE_WIZARD_LOCK:
        // boxlock() only applies to boxes/chests, which this port does not put
        // on floor piles; res = 0 for everything else, exactly as C.
        res = 0;
        break;
    case WAN_STRIKING:
    case SPE_FORCE_BOLT:
        // C: fracture_rock / break_statue / hero_breaks.  DEFERRED — the object
        // breakage subsystem (potion vapours, shop billing) is not ported.  C
        // sets res = 0 for the ordinary (non-boulder, non-statue) case, which is
        // what every floor pile this port builds contains.
        res = 0;
        break;
    case WAN_CANCELLATION:
    case SPE_CANCELLATION:
        // cancel_item(obj) — DEFERRED (rn2-bearing for spellbooks/eggs).
        break;
    case SPE_DRAIN_LIFE:
        // drain_item(obj, TRUE) — DEFERRED.
        break;
    case WAN_TELEPORTATION:
    case SPE_TELEPORT_AWAY:
        // rloco(obj) — DEFERRED (needs the floor-object relocation roll).
        break;
    case WAN_UNDEAD_TURNING:
    case SPE_TURN_UNDEAD:
        // revive_egg / revive(corpse) — DEFERRED (revive() is not ported).  C
        // leaves res = 1 only when a corpse actually revived; with revival
        // unmodelled the corpse stays intact, which is C's res = 0 path.
        res = 0;
        break;
    case SPE_STONE_TO_FLESH:
        // stone_to_flesh_obj(obj) — DEFERRED.
        res = 0;
        break;
    default:
        res = 0;
        break;
    }
    return res;
}



// C ref: zap.c bhitpile — apply fhito to every object stacked at (tx,ty).
// C's level.objects[tx][ty] is a nexthere chain ordered newest-first (place_object
// prepends).  Our flat game.level.objects is append-ordered (oldest-first), so we
// iterate the square's objects in reverse to reproduce C's traversal order — the
// order determines the obj_resists / obj_shudders / mkobj RNG sequence.
async function bhitpile(obj, tx, ty) {
    const arr = game.level?.objects || [];
    const here = [];
    for (let i = arr.length - 1; i >= 0; i--) {
        const o = arr[i];
        if (o.where === 'floor' && o.ox === tx && o.oy === ty) here.push(o);
    }
    if (!here.length) return 0;
    game.poly_zapped = -1;
    let hitanything = 0;
    for (const otmp of here) {
        // object may already have been freed/replaced; re-validate on the floor.
        if (otmp.where !== 'floor' || otmp.ox !== tx || otmp.oy !== ty) continue;
        hitanything += bhito(otmp, obj);
    }
    // C: `if (gp.poly_zapped >= 0) create_polymon(svl.level.objects[tx][ty],
    // gp.poly_zapped)`.  do_osshock() sets poly_zapped to the shocked object's
    // material with probability 1/(Luck+45) PER ITEM, so a pile of any size
    // reaches this regularly — it was never "unreachable", just unlikely for one
    // item.  create_polymon() draws makemon() plus polyuse()'s per-object
    // obj_resists()/rn2(minwt+1) rolls.
    // C passes svl.level.objects[tx][ty] — the pile AS IT IS NOW, which includes
    // the replacement objects poly_obj() spliced in; re-read it rather than
    // reusing the pre-loop snapshot, or polyuse() walks the wrong set and draws
    // the wrong number of rn2(minwt + 1).
    if (game.poly_zapped >= 0)
        await create_polymon(pile_at(tx, ty), game.poly_zapped);
    return hitanything;
}

// C's nexthere chain, newest-first; our flat array is oldest-first.
function pile_at(tx, ty) {
    const arr = game.level?.objects || [];
    const out = [];
    for (let i = arr.length - 1; i >= 0; i--) {
        const o = arr[i];
        if (o.where === 'floor' && o.ox === tx && o.oy === ty) out.push(o);
    }
    return out;
}

// C ref: zap.c create_polymon(obj, okind) — the golem that arises from a
// polymorphed pile.  Material enum from objclass.h; golem pmidx values verified
// against makemon.js's MONS table.
const MAT_FLESH = 4, MAT_PAPER = 5, MAT_CLOTH = 6, MAT_LEATHER = 7,
      MAT_WOOD = 8, MAT_BONE = 9, MAT_IRON = 11, MAT_METAL = 12,
      MAT_COPPER = 13, MAT_SILVER = 14, MAT_GOLD = 15, MAT_PLATINUM = 16,
      MAT_MITHRIL = 17, MAT_GLASS = 19, MAT_GEMSTONE = 20, MAT_MINERAL = 21;
const PM_SKELETON = 248, PM_STRAW_GOLEM = 249, PM_PAPER_GOLEM = 250,
      PM_ROPE_GOLEM = 251, PM_GOLD_GOLEM = 252, PM_LEATHER_GOLEM = 253,
      PM_WOOD_GOLEM = 254, PM_FLESH_GOLEM = 255, PM_CLAY_GOLEM = 256,
      PM_STONE_GOLEM = 257, PM_GLASS_GOLEM = 258, PM_IRON_GOLEM = 259;
async function create_polymon(pile, okind) {
    // "no golems if you zap only one object -- not enough stuff"
    const obj = pile && pile[0];
    if (!obj || (pile.length === 1 && (obj.quan || 1) === 1)) return;

    let pm_index, material;
    switch (okind) {
    case MAT_IRON: case MAT_METAL: case MAT_MITHRIL:
        pm_index = PM_IRON_GOLEM; material = 'metal '; break;
    case MAT_COPPER: case MAT_SILVER: case MAT_PLATINUM:
    case MAT_GEMSTONE: case MAT_MINERAL:
        pm_index = rn2(2) ? PM_STONE_GOLEM : PM_CLAY_GOLEM; material = 'lithic '; break;
    case 0: case MAT_FLESH:
        pm_index = PM_FLESH_GOLEM; material = 'organic '; break;
    case MAT_WOOD:    pm_index = PM_WOOD_GOLEM;    material = 'wood '; break;
    case MAT_LEATHER: pm_index = PM_LEATHER_GOLEM; material = 'leather '; break;
    case MAT_CLOTH:   pm_index = PM_ROPE_GOLEM;    material = 'cloth '; break;
    case MAT_BONE:    pm_index = PM_SKELETON;      material = 'bony '; break;
    case MAT_GOLD:    pm_index = PM_GOLD_GOLEM;    material = 'gold '; break;
    case MAT_GLASS:   pm_index = PM_GLASS_GOLEM;   material = 'glassy '; break;
    case MAT_PAPER:   pm_index = PM_PAPER_GOLEM;   material = 'paper '; break;
    default:          pm_index = PM_STRAW_GOLEM;   material = ''; break;
    }
    const { makemon, monster_by_pmidx } = await import('./makemon.js');
    const mdat = monster_by_pmidx(pm_index);
    const mtmp = makemon(mdat, obj.ox, obj.oy, MM_NOMSG);
    // C: polyuse(obj, okind, mons[pm_index].cwt) — the golem's corpse weight is
    // the material budget, drawn even when makemon() failed.
    polyuse(pile, okind, mdat?.cwt | 0);
    if (mtmp && cansee(mtmp.mx, mtmp.my))
        await pline(`Some ${material}objects meld, and ${x_monnam(mtmp, 2)} arises from the pile!`);
}

// C ref: zap.c polyuse(objhdr, mat, minwt) — consume pile members to build the
// golem.  Each survivor still pays obj_resists()'s rn2(100) and the
// rn2(minwt + 1) material test.
function polyuse(pile, mat, minwt) {
    for (const otmp of pile) {
        if (minwt <= 0) break;
        if (otmp.where !== 'floor') continue;
        if (obj_resists(otmp, 0, 0)) continue; /* preserve unique objects */
        if (((objects[otmp.otyp]?.material | 0) === mat) === (rn2(minwt + 1) !== 0)) {
            minwt -= (otmp.quan || 1);
            delobj(otmp);
        }
    }
}

// C ref: zap.c bhit — walk the wand beam from the hero in (ddx,ddy) up to range
// squares, applying bhitm to monsters and bhitpile to floor objects.  Only the
// ZAPPED_WAND, IMMEDIATE flavour (no ricochet) reached by the covered sessions is
// implemented; ray/thrown/kicked/flash variants are out of scope here.
async function bhit(ddx, ddy, range, obj) {
    let bx = game.u.ux, by = game.u.uy;
    while (range-- > 0) {
        bx += ddx; by += ddy;
        if (bx < 0 || bx >= COLNO || by < 0 || by >= ROWNO) { bx -= ddx; by -= ddy; break; }
        const loc = game.level?.at?.(bx, by);
        const typ = loc?.typ;

        // ZAPPED_WAND: cancellation/opening/locking/striking/probing zap_map()
        // effects are not exercised here for WAN_POLYMORPH (no-op).

        const mtmp = m_at(bx, by);
        if (mtmp) {
            if (await bhitm(mtmp, obj)) break;
            range -= 3;
        }
        if (await bhitpile(obj, bx, by)) range--;

        if (!ZAP_POS(typ) || closed_door_at(bx, by)) { bx -= ddx; by -= ddy; break; }
    }
}

// C ref: monmove.c closed_door() (local copy; hack.js's isn't exported).
function closed_door_at(x, y) {
    const loc = game.level?.at?.(x, y);
    if (!loc) return false;
    return IS_DOOR(loc.typ) && !!(loc.doormask & (D_CLOSED | D_LOCKED));
}

// C ref: zap.c bhitm — a wand/spell effect hitting one monster.  This used to
// be an unconditional `return 0`, i.e. an IMMEDIATE beam crossing a monster drew
// NO RNG at all — every wand of striking/slow/speed/undead-turning/polymorph/
// sleep zap desynchronized from C on its first target.  The per-otyp effects
// below draw C's rolls in C's order; effects that need subsystems this port
// lacks (cancel_monst, u_teleport_mon, probe_monster, stone_to_flesh) fall
// through to the shared wakeup() tail rather than skipping it.
async function bhitm(mtmp, otmp) {
    if (!mtmp || !otmp) return 0;
    let ret = 0;
    let wake = true;            /* most 'zaps' should wake monster */
    let learn_it = false, helpful_gesture = false;
    let dmg;
    const otyp = otmp.otyp;
    // C: dbldam = Role_if(PM_KNIGHT) && u.uhave.questart.
    const dbldam = false;
    let zap_type_text = 'spell';

    switch (otyp) {
    case WAN_STRIKING:
        zap_type_text = 'wand';
        /* FALLTHRU */
    case SPE_FORCE_BOLT:
        learn_it = cansee(mtmp.mx, mtmp.my);
        if (resists_magm(mtmp)) {
            await pline('Boing!');
        } else if (game.u?.uswallow || rnd(20) < 10 + find_mac(mtmp)) {
            dmg = d(2, 12);
            if (dbldam) dmg *= 2;
            if (otyp === SPE_FORCE_BOLT) dmg = spell_damage_bonus(dmg);
            await hit(zap_type_text, mtmp, exclam(dmg));
            resist(mtmp, otmp.oclass, dmg, true);
        } else {
            await miss(zap_type_text, mtmp);
            learn_it = false;
        }
        break;

    case WAN_SLOW_MONSTER:
    case SPE_SLOW_MONSTER:
        if (!resist(mtmp, otmp.oclass, 0, false)) {
            const { mon_adjust_speed } = await import('./muse.js');
            await mon_adjust_speed(mtmp, -1, otmp);
        }
        break;

    case WAN_SPEED_MONSTER:
        if (!resist(mtmp, otmp.oclass, 0, false)) {
            const { mon_adjust_speed } = await import('./muse.js');
            await mon_adjust_speed(mtmp, 1, otmp);
        }
        helpful_gesture = true;  /* wake but don't anger a peaceful target */
        break;

    case WAN_UNDEAD_TURNING:
    case SPE_TURN_UNDEAD:
        wake = false;
        // unturn_dead(mtmp): revives carried corpses.  DEFERRED — revive() is
        // not ported; a target carrying corpses would draw extra rolls here.
        if (is_undead_mdat(mtmp.data)) {
            wake = true;
            dmg = rnd(8);
            if (dbldam) dmg *= 2;
            if (otyp === SPE_TURN_UNDEAD) dmg = spell_damage_bonus(dmg);
            resist(mtmp, otmp.oclass, dmg, false);
        }
        break;

    case WAN_POLYMORPH:
    case SPE_POLYMORPH:
    case POT_POLYMORPH:
        if (resists_magm(mtmp)) {
            /* shieldeff_mon: display-only */
        } else if (!resist(mtmp, otmp.oclass, 0, false)) {
            // Natural shapechangers are immune to system shock; mtmp.cham is
            // NON_PM (-1) for everything else, so the rn2(25) is drawn for an
            // ordinary target.
            if ((mtmp.cham ?? -1) === -1 && !rn2(25)) {
                if (canseemon_z(mtmp)) {
                    await update_topl(`${Monnam(mtmp)} shudders!`);
                    learn_it = true;
                }
                await killed(mtmp, { nocorpse: true });
            } else {
                const { newcham } = await import('./makemon.js');
                if (newcham(mtmp, null) !== 0) {
                    if (canspotmon(mtmp)) learn_it = true;
                }
            }
        }
        break;

    case WAN_CANCELLATION:
    case SPE_CANCELLATION:
        // cancel_monst(mtmp, otmp, TRUE, TRUE, FALSE) — DEFERRED: the per-item
        // cancel_item() rolls and the mcan/mspec_used state aren't ported.
        break;

    case WAN_TELEPORTATION:
    case SPE_TELEPORT_AWAY: {
        const { rloc, RLOC_MSG } = await import('./teleport.js');
        await rloc(mtmp, RLOC_MSG);   /* u_teleport_mon(mtmp, TRUE) */
        learn_it = canspotmon(mtmp);
        break;
    }

    case WAN_MAKE_INVISIBLE: {
        const oldinvis = mtmp.minvis;
        const couldsee = canseemon_z(mtmp);
        const nambuf = Monnam(mtmp);
        mtmp.minvis = 1;              /* mon_set_minvis(mtmp, FALSE) */
        if (!oldinvis && game.u?.uprops?.See_invisible) {
            await update_topl(`${nambuf} turns transparent!`);
            learn_it = true;
        } else if (couldsee && !canseemon_z(mtmp)) {
            await update_topl(`${nambuf} vanishes!`);
        }
        break;
    }

    case WAN_LOCKING:
    case SPE_WIZARD_LOCK:
        // closeholdingtrap(mtmp, &learn_it): no trap subsystem hookup here.
        wake = false;
        break;

    case WAN_PROBING:
        wake = false;
        // probe_monster(mtmp): a status readout; no RNG.
        learn_it = true;
        break;

    case WAN_OPENING:
    case SPE_KNOCK:
        wake = false; /* don't want immediate counterattack */
        break;

    case SPE_HEALING:
    case SPE_EXTRA_HEALING: {
        const healamt = d(6, otyp === SPE_EXTRA_HEALING ? 8 : 4);
        wake = false;                 /* wakeup() makes the target angry */
        const { healmon } = await import('./mon.js');
        healmon(mtmp, healamt, 0);
        if (canseemon_z(mtmp))
            await update_topl(`${Monnam(mtmp)} looks${otyp === SPE_EXTRA_HEALING ? ' much' : ''} better.`);
        break;
    }

    case WAN_LIGHT:  /* (broken wand) */
        // flash_hits_mon(mtmp, otmp): blinding flash.  DEFERRED.
        break;

    case WAN_SLEEP:  /* (broken wand) */
        if (await sleep_monst(mtmp, d(1 + (otmp.spe | 0), 12), WAND_CLASS))
            await slept_monst(mtmp);
        if (!Blind()) learn_it = true;
        break;

    case SPE_DRAIN_LIFE:
        dmg = monhp_per_lvl(mtmp);
        if (dbldam) dmg *= 2;
        dmg = spell_damage_bonus(dmg);
        if (!resist(mtmp, otmp.oclass, dmg, false) && !DEADMONSTER(mtmp)) {
            mtmp.mhp = (mtmp.mhp || 0) - dmg;
            mtmp.mhpmax = (mtmp.mhpmax || 0) - dmg;
            if (DEADMONSTER(mtmp) || mtmp.mhpmax <= 0 || (mtmp.m_lev | 0) < 1) {
                await killed(mtmp);
            } else {
                mtmp.m_lev--;
                if (canseemon_z(mtmp))
                    await update_topl(`${Monnam(mtmp)} suddenly seems weaker!`);
            }
        }
        break;

    case SPE_STONE_TO_FLESH:
        wake = false;
        break;

    case WAN_NOTHING:
        wake = false;
        break;

    default:
        break;
    }

    if (wake && !DEADMONSTER(mtmp))
        await wakeup(mtmp, !helpful_gesture);
    if (learn_it) learnwand(otmp);
    return ret;
}

// C ref: zap.c spell_damage_bonus(dmg) — Intelligence/experience-level scaling
// for attack spells.  No RNG.
function spell_damage_bonus(dmg) {
    // C ref: attrib.h ACURR(x) — u.acurr.a[] is in [Str,Int,Wis,Dex,Con,Cha]
    // order (attrib.js keeps its own private copy of this accessor).
    const intell = game.u?.acurr?.a?.[A_INT] ?? 10;
    const ulevel = game.u?.ulevel | 0;
    if (intell <= 9) {
        if (dmg > 1) dmg = (dmg <= 3) ? 1 : dmg - 3;
    } else if (intell <= 13 || ulevel < 5) {
        /* no bonus or penalty */
    } else if (intell <= 18) {
        dmg += 1;
    } else if (intell <= 24 || ulevel < 14) {
        dmg += 2;
    } else {
        dmg += 3;
    }
    return dmg;
}

// C ref: makemon.c monhp_per_lvl(mon) — rnd(8) by default; golems and level>49
// monsters take fixed values that no drain-life target in this port reaches.
function monhp_per_lvl(_mon) { return rnd(8); }

// C ref: mondata.h is_undead(ptr) — S_ZOMBIE / S_MUMMY / S_VAMPIRE / S_WRAITH /
// S_LICH / S_GHOST classes.  Matches nonliving_mdat()'s name heuristic style
// used elsewhere in this file.
function is_undead_mdat(mdat) {
    const name = mdat?.name || '';
    return /\bzombie\b|\bmummy\b|\bvampire\b|\bwraith\b|\bghost\b|\blich\b|\bshade\b/.test(name);
}

// C ref: display.h canseemon(mon).  display.js exports the shared predicate
// under a different name.
function canseemon_z(mon) { return canseemon_shared(mon); }

// C ref: zap.c zapwrapup — after an IMMEDIATE zap, announce system shock once.
async function zapwrapup() {
    if (game.obj_zapped)
        await pline('You feel shuddering vibrations.');
    game.obj_zapped = false;
}

// C ref: zap.c weffects — dispatch a wand/spell effect.  Always exercises
// Wisdom (rn2(19) via exercise) first.  NODIR -> zapnodir; IMMEDIATE -> bhit beam
// (the WAN_POLYMORPH-on-a-pile case the wizard sessions exercise).
export async function weffects(obj) {
    const otyp = obj.otyp;
    // C ref: zap.c weffects — was_unkn snapshots whether the type is still
    // undiscovered; `disclose` gates the post-effect learnwand()/experience.
    let disclose = false;
    const was_unkn = !objects[otyp]?.oc_name_known;
    exercise(A_WIS, true);
    // u.usteed zap_steed: DEFERRED — needs the saddle/steed hit rolls; this
    // port never mounts the hero on the covered or proxy sessions.
    if (objects[otyp]?.dir === IMMEDIATE) {
        game.obj_zapped = false; /* zapsetup() */
        const u = game.u;
        if (u.uswallow) {
            await bhitm(u.ustuck, obj);
        } else if (u.dz) {
            disclose = await zap_updown(obj);
        } else {
            await bhit(u.dx, u.dy, rn1(8, 6), obj);
        }
        await zapwrapup();
    } else if (objects[otyp]?.dir === NODIR) {
        await zapnodir(obj);
    } else {
        // RAY (oc_dir == RAY).  C ref: zap.c weffects() else-branch.
        if (otyp === WAN_DIGGING || otyp === SPE_DIG) {
            // WAN_DIGGING / SPE_DIG carve terrain instead of firing a bolt.
            const { zap_dig } = await import('./dig.js');
            await zap_dig();
        } else {
            // magic missile / fire / cold / sleep / death / lightning ->
            // ubuzz(BZ_U_WAND(BZ_OFS_WAN(otyp)), nd).
            const off = BZ_OFS_WAN(otyp);        // 0..5 (MM..LIGHTNING order)
            await ubuzz(off, (otyp === WAN_MAGIC_MISSILE) ? 2 : 6);
        }
        disclose = true;
    }
    // C ref: zap.c weffects — a RAY (or steed) effect is always disclosed:
    // learnwand() discovers the wand type (which, when the type first becomes
    // name-known and credit_hero is set, exercises Wisdom -> rn2(19)); a wand
    // whose type was previously unknown also grants a little score/experience.
    if (disclose) {
        learnwand(obj);
        if (was_unkn) more_experienced(0, 10);
    }
}

// C ref: zap.c zap_updown(obj) — an IMMEDIATE wand zapped at '<' or '>'.  This
// whole function used to be a comment: a down-zap ran NO bhitpile, so an entire
// floor pile under the hero went unhit (every obj_resists/obj_shudders/mkobj
// roll missing), and a striking up-zap skipped its rn2(3) ceiling-rock check.
// Returns C's `disclose`.
async function zap_updown(obj) {
    const u = game.u;
    const x = u.ux, y = u.uy;
    let striking = false, disclose = false;
    const { t_at } = await import('./trap.js');
    const ttmp = t_at(x, y);

    switch (obj.otyp) {
    case WAN_PROBING: {
        let ptmp = 0;
        if (u.dz < 0) {
            await pline('You probe towards the ceiling.');
        } else {
            ptmp += await bhitpile(obj, x, y);
            await zap_map(x, y, obj);
            await pline('You probe beneath the floor.');
            // display_binventory(): buried objects aren't modelled.
        }
        if (!ptmp) await pline('Your probe reveals nothing.');
        return true; /* we've done our own bhitpile */
    }
    case WAN_OPENING:
    case SPE_KNOCK:
        // Drawbridge / quest-stairs / holding-and-falling-trap releases are
        // RNG-free state changes this port does not model.
        break;
    case WAN_STRIKING:
    case SPE_FORCE_BOLT:
        striking = true;
        /* FALLTHRU */
    case WAN_LOCKING:
    case SPE_WIZARD_LOCK:
        // (drawbridge close/destroy omitted — no drawbridge under the hero.)
        // C also guards on !Is_airlevel && !Is_waterlevel && !Underwater &&
        // !Is_qstart; the rn2(3) precedes them so the draw is right either way,
        // but on those four the rock (and mksobj_at's rn1(6,6)) is skipped.
        // Is_qstart/Underwater aren't ported, so all four are omitted rather
        // than porting a subset that answers wrong for the missing ones.
        if (striking && u.dz < 0 && rn2(3)) {
            await pline('A rock is dislodged from the ceiling and falls on your head.');
            const dmg = rnd(hard_helmet(game.uarmh) ? 2 : 6);
            await losehp(Maybe_Half_Phys(dmg), 'falling rock');
            const { mksobj_at } = await import('./mkobj.js');
            const otmp = mksobj_at(ROCK, x, y, false, false);
            if (otmp) xname(otmp);   /* sets dknown, maybe bknown */
            newsym(x, y);
        } else if (u.dz > 0 && ttmp) {
            // trapdoor <-> hole transformation: no RNG (dotrap's fall is a
            // separate subsystem).  DEFERRED.
        }
        break;
    case SPE_STONE_TO_FLESH:
        break;
    default:
        break;
    }

    if (u.dz > 0) {
        await bhitpile(obj, x, y);
        await zap_map(x, y, obj);
    } else if (u.dz < 0) {
        // hides_under() zap-upward-hits-your-cover: the hero never hides under
        // an object in this port.
    }
    return disclose;
}

// C ref: zap.c zap_map(x, y, obj) — the non-elemental terrain/engraving half of
// a wand effect.  maybe_explode_trap() only fires for cancellation (which needs
// explode()), and the drawbridge arms need a drawbridge; what IS reachable is
// the down-zap engraving handling, whose STRIKING / STONE_TO_FLESH arms draw
// d(2, 4) through wipe_engr_at().
async function zap_map(x, y, obj) {
    const u = game.u;
    if ((u.dz | 0) <= 0) return;   /* lateral/up: drawbridge-only, not modelled */
    const { engr_at, wipe_engr_at, make_engr_at, random_engraving } =
        await import('./engrave.js');
    const e = engr_at(x, y);
    if (!e || e.engr_type === HEADSTONE) return;
    switch (obj.otyp) {
    case WAN_POLYMORPH:
    case SPE_POLYMORPH: {
        // del_engr(e) then a fresh random_engraving(): getrumor/get_rnd_text
        // plus wipeout_text — several draws, all previously skipped.
        del_engr_z(x, y);
        const r = random_engraving();
        if (r) make_engr_at(x, y, r.text, r.pristine, game.moves | 0, DUST);
        break;
    }
    case WAN_CANCELLATION:
    case SPE_CANCELLATION:
    case WAN_MAKE_INVISIBLE:
        del_engr_z(x, y);
        break;
    case WAN_TELEPORTATION:
    case SPE_TELEPORT_AWAY:
        // rloc_engr(e): DEFERRED (needs the engraving relocation roll).
        break;
    case SPE_STONE_TO_FLESH:
        if (e.engr_type === ENGRAVE) {
            await pline('The edges on the floor get smoother.');
            wipe_engr_at(x, y, d(2, 4), true);
        }
        break;
    case WAN_STRIKING:
    case SPE_FORCE_BOLT:
        wipe_engr_at(x, y, d(2, 4), true);
        break;
    default:
        break;
    }
}

// C ref: engrave.c del_engr(ep) — drop an engraving from the level list.
function del_engr_z(x, y) {
    const arr = game.level?.engravings;
    if (!arr) return;
    game.level.engravings = arr.filter(ep => ep.engr_x !== x || ep.engr_y !== y);
}

// C ref: do_wear.c hard_helmet(o) = is_helmet(o) && (is_metallic(o) ||
// is_crackable(o)) — a metal or glass helm halves the falling-rock die.
// is_helmet tests oc_armcat == ARM_HELM, which the JS objects table doesn't
// carry; objects.h's HELM() block is the contiguous run 89..100 (elven leather
// helm .. helm of telepathy), verified name-by-name against mkobj.js.
// A name regex here would answer FALSE for the dented pot (IRON).
const FIRST_HELM = 89, LAST_HELM = 100;
function hard_helmet(otmp) {
    if (!otmp || otmp.otyp < FIRST_HELM || otmp.otyp > LAST_HELM) return false;
    const mat = objects[otmp.otyp]?.material | 0;
    return (mat >= MAT_IRON && mat <= MAT_MITHRIL) || mat === MAT_GLASS;
}

// C ref: include/hack.h BZ_OFS_WAN(otyp) = abs(otyp - WAN_MAGIC_MISSILE) % 10.
// Wand order in objects.h: MAGIC_MISSILE(0) FIRE(1) COLD(2) SLEEP(3) DEATH(4)
// LIGHTNING(5); the resulting offset is the abstract zap type (ZT_FIRE etc.).
const WAN_MAGIC_MISSILE = 429;
// C ref: objects.h — the two RAY-class dig items dispatched to zap_dig().
const WAN_DIGGING = 428;
const SPE_DIG = 366;
function BZ_OFS_WAN(otyp) { return Math.abs(otyp - WAN_MAGIC_MISSILE) % 10; }

// Abstract damage types (zaptype % 10), C ref: monattk.h AD_* minus 1.
// C ref: zap.c:45-52 — ZT_<x> == AD_<x> - 1, so POISON_GAS is 6 and ACID is 7.
// zhitm() used to spell these 7 and 8, one past their real values: a poison-gas
// ray fell through to ZT_ACID's rn2(6)/erode_armor pair and an acid ray hit no
// case at all.
const ZT_MAGIC_MISSILE = 0, ZT_FIRE = 1, ZT_COLD = 2, ZT_SLEEP = 3,
      ZT_DEATH = 4, ZT_LIGHTNING = 5, ZT_POISON_GAS = 6, ZT_ACID = 7;

// otyps consulted by destroy path naming.  C ref: objects.h.
const SCR_FIRE = 339, SPE_FIREBALL = 368, POT_INVISIBILITY = 305;

// C ref: display.c:388 unmap_invisible(x, y) — drop a remembered 'I' when the
// hero learns nothing is there; unmap_object() then newsym() to repaint.
function unmap_invisible_zap(x, y) {
    if (!isok(x, y) || !game.level?.at(x, y)?.invisMon) return false;
    unmap_object(x, y);
    newsym(x, y);
    return true;
}

// C ref: zap.c ubuzz(type, nd) -> dobuzz(type, nd, u.ux, u.uy, u.dx, u.dy,
// TRUE, FALSE, FALSE).
export async function ubuzz(type, nd) {
    const u = game.u;
    await dobuzz(type, nd, u.ux, u.uy, u.dx | 0, u.dy | 0, true, false, false);
}

// C ref: zap.c dobuzz — fire a bouncing ray.  The beam walks the level,
// striking a monster (zap_hit/zhitm/killed) or the hero (zap_hit/zhitu) it
// crosses, and reflects off obstructions (bounce_dir) until range runs out.
// u.uswallow / fireball(spell-only, unreachable via a 0-9 wand type) / gas
// trailing clouds are not modelled (not exercised by any covered wand zap).
//
// `type` is NEGATIVE when a monster fires the ray (BZ_M_BREATH == -20-adtyp);
// that changes the death path (monkilled, corpse-leaving, no hero kill credit),
// the "your/the blast" wording and zap_over_floor's u_caused flag.
export async function dobuzz(type, nd, sx, sy, dx, dy,
                             sayhit = false, saymiss = false, forcemiss = false) {
    const u = game.u;
    const fltyp = zaptype(type);
    const damgtype = fltyp % 10;
    // C: `int hdmgtype = Hallucination ? rn2(6) : damgtype;` — evaluated before
    // anything else in dobuzz, so a hallucinating hero's zap draws one extra
    // rn2(6) that this port used to skip.  hdmgtype only picks the beam colour.
    const hdmgtype = Hallucination() ? rn2(6) : damgtype;
    // C: `if (type < 0) newsym(u.ux, u.uy);` — a monster-fired ray redraws the
    // hero's square first (the hero may have been standing under a remembered
    // glyph the beam is about to overwrite).
    if (type < 0) newsym(u.ux, u.uy);
    let range = rn1(7, 7);              // C: range = rn1(7, 7)
    if (dx === 0 && dy === 0) range = 1;
    let lsx, lsy;
    const beamGlyph = (dx !== 0 && dy === 0) ? 'q' /*S_hbeam ─*/
                    : (dx === 0 && dy !== 0) ? 'f' /*S_vbeam │*/
                    : (dx === dy) ? 'n' /*S_lslant ╲*/ : 'm' /*S_rslant ╱*/;
    // C ref: tmp_at(DISP_BEAM,...)/tmp_at(DISP_END,0) — the beam glyph is a
    // temporary overlay; once the zap finishes every cell it touched is
    // restored to its real glyph (corpse, monster, floor, ...).  Track visited
    // cells here and newsym() them back at the bottom of the function.
    const visited = new Map();
    const drawBeam = (x, y) => { show_glyph_cell(x, y, beamGlyph, ZAPCOLORS[hdmgtype] ?? CLR_ORANGE, true); visited.set(`${x},${y}`, [x, y]); };

    while (range-- > 0) {
        lsx = sx; sx += dx;
        lsy = sy; sy += dy;
        if (!isok(sx, sy) || (game.level?.at(sx, sy)?.typ ?? STONE) === STONE) {
            await make_bounce();
            continue;
        }

        const typ = game.level?.at(sx, sy)?.typ ?? STONE;
        let mon = m_at(sx, sy);
        // C ref: zap.c:4838 — the WHOLE marker+beam block sits inside
        // `if (cansee(sx, sy))`, so a blind hero sees no ray at all (cansee()
        // is false everywhere while Blind: vision.c:548 skips the IN_SIGHT
        // pass).  Without the gate a monster's breath left a permanent beam
        // painted across the map of a blinded hero.
        if (cansee(sx, sy)) {
            if (mon && !canspotmon(mon)) map_invisible(sx, sy);
            else if (!mon) unmap_invisible_zap(sx, sy);
            if (ZAP_POS(typ) || (isok(lsx, lsy) && cansee(lsx, lsy)))
                drawBeam(sx, sy);
        }

        // C: `range += zap_over_floor(sx, sy, type, &shopdamage, TRUE, 0)`,
        // then mon is re-fetched (fire can melt ice and drown the monster).
        range += await zap_over_floor(sx, sy, type);
        mon = m_at(sx, sy);

        if (mon) {
            if (!forcemiss && zap_hit(find_mac(mon), 0)) {
                if (await mon_reflects(mon)) {
                    // C: on a visible reflection the beam first "hits", then
                    // prints the reflection line; only then does it reverse.
                    if (cansee(mon.mx, mon.my)) {
                        await hit(flash_str(fltyp), mon, exclam(0));
                        await mon_reflects(mon, 'But it reflects from %s %s!');
                    }
                    dx = -dx; dy = -dy;
                } else {
                    const mon_could_move = mon.mcanmove;
                    const { tmp, otmp } = await zhitm(mon, type, nd);
                    if (tmp === MAGIC_COOKIE) {
                        await disintegrate_mon(mon, type, flash_str(fltyp));
                    } else if (DEADMONSTER(mon)) {
                        // C: `type < 0` -> the ray came from another monster, so
                        // the hero gets no kill credit and mon.c monkilled()
                        // (not xkilled()) runs.
                        if (type >= 0) await killed(mon);
                        else await monkilled_zap(mon, flash_str(fltyp));
                    } else {
                        if (!otmp) {
                            if (sayhit || canspotmon(mon))
                                await hit(flash_str(fltyp), mon, exclam(tmp));
                        } else if (canspotmon(mon)) {
                            await update_topl(`${Monnam(mon)}'s item is disintegrated!`);
                        }
                        if (mon_could_move && !mon.mcanmove) await slept_monst(mon);
                        if (damgtype !== ZT_SLEEP) await wakeup(mon, type >= 0);
                    }
                }
                range -= 2;
            } else {
                if (saymiss || (canspotmon(mon) && !disguised_as_non_mon(mon)))
                    await miss(flash_str(fltyp), mon);
            }
        } else if (sx === u.ux && sy === u.uy && range >= 0) {
            // C: u_at(sx,sy) && range >= 0 -> the bolt strikes the hero.
            // C ref zap.c:4954 `nomul(0)` — the hero's multi-turn occupation is
            // broken the moment a ray reaches their square, BEFORE the to-hit
            // roll (a missed bolt still interrupts).
            await nomul_zap(0);
            if (!forcemiss && zap_hit(u.uac | 0, 0)) {
                range -= 2;
                // C ref: zap.c:4963 has NO tmp_at here — the hero's own square
                // was already beamed (or not, when Blind) by the loop-top
                // cansee() block above.
                await update_topl(`${flash_The(type)} hits you!`);
                // C ref: zap.c dobuzz() — `if (ureflects("But %s reflects from
                // your %s!", "it")) { dx = -dx; dy = -dy; } else zhitu(...)`.
                // Skipping it let a reflected bolt damage the hero AND lose the
                // reversed second leg of the beam.
                if (await ureflects('But %s reflects from your %s!', 'it')) {
                    dx = -dx; dy = -dy;
                } else {
                    await zhitu(type, nd, flash_killer(type), sx, sy);
                    if (game.program_state?.gameover) return;
                }
            } else {
                await update_topl(`${flash_The(type)} whizzes by you!`);
            }
            // C: this runs for BOTH the hit and the miss arm — every lightning
            // bolt crossing the hero's square draws d(nd, 50) for the blinding
            // duration, whether or not it connected.  The draw was missing.
            if (damgtype === ZT_LIGHTNING)
                await flashburn(d(nd, 50), true);
            await stop_occupation_zap();
            await nomul_zap(0);
        }

        // C: `!ZAP_POS(typ) || (closed_door(sx, sy) && range >= 0)` — the
        // closed-door half was missing, so a bolt passed straight through a
        // shut door instead of bouncing.
        if (!ZAP_POS(game.level?.at(sx, sy)?.typ ?? STONE)
            || (closed_door_at(sx, sy) && range >= 0)) {
            await make_bounce();
        }
    }

    async function make_bounce() {
        const typNow = game.level?.at(sx, sy)?.typ ?? STONE;
        // C: off-level/STONE bounces near-certainly (10); a Mines WALL is 20;
        // everything else 75.  In_mines() IS available (const.js), so the Mines
        // arm was an unnecessary omission — and bchance is the modulus of
        // bounce_dir()'s rn2(bounceback), so getting it wrong changes the draw.
        const bchance = (!isok(sx, sy) || typNow === STONE) ? 10
                      : (In_mines(game.u?.uz) && IS_WALL(typNow)) ? 20
                      : 75;
        // C: --range > 0 && cansee(lsx,lsy) -> "The <flash> bounces!"
        if (--range > 0 && isok(lsx, lsy) && cansee(lsx, lsy)) {
            await update_topl(`${flash_The(fltyp)} bounces!`);
        }
        const nd2 = bounce_dir(sx, sy, dx, dy, bchance);
        dx = nd2.dx; dy = nd2.dy;
    }

    // C: tmp_at(DISP_END, 0) — erase the temporary beam overlay, revealing
    // whatever is really at each visited cell (corpse, monster, floor, ...).
    for (const [vx, vy] of visited.values()) newsym(vx, vy);
}

// C ref: zap.c zap_over_floor(x, y, type, ...) — terrain/floor-object effects
// along a ray's path.  Returns C's `rangemod`.  The ZT_COLD / lava / iron-bars /
// door arms still need terrain subsystems this port does not carry (freeze
// timers, drawbridges) and are DEFERRED; ported here are the two a fire ray
// actually crosses — the water/fountain steam clouds (each pool square draws
// rnd(5) plus a whole create_gas_cloud) and the scroll/spellbook burn.
export async function zap_over_floor(x, y, type, _exploding_wand_typ) {
    // C ref: zap.c:5157 — a PHYS_EXPL_TYPE blast (gas spore) has no effect on
    // the floor and returns before anything else.  Without this guard the
    // zaptype(-1)%10 == ZT_FIRE coincidence made a physical explosion burn the
    // scrolls under it.
    if (type === -1 /* PHYS_EXPL_TYPE */) return -1000;
    const damgtype = zaptype(type) % 10;
    let rangemod = 0;
    const lev = game.level?.at(x, y);
    if (damgtype === ZT_FIRE && lev) {
        const see_it = cansee(x, y);
        // A fire ray over open water boils it: one 1..5 steam cloud per square.
        // Skipped entirely, a dragon breathing across Medusa's moat lost the
        // rnd(5) + create_gas_cloud shuffle for EVERY water square it crossed.
        if (is_ice(x, y)) {
            /* melt_ice(x, y): needs the melt-away timer subsystem; no RNG. */
        } else if (is_pool(x, y)) {
            const on_water_level = !!Is_waterlevel(game.u?.uz);
            let msgtxt = !game.u?.Deaf ? 'You hear hissing gas.'
                       : (type >= 0) ? 'That seemed remarkably uneventful.' : null;
            if (!on_water_level)
                await create_gas_cloud(x, y, rnd(5), 0);
            if (lev.typ !== POOL) {          /* MOAT / DRAWBRIDGE_UP / WATER */
                if (on_water_level) msgtxt = (see_it || !game.u?.Deaf) ? 'Some water boils.' : null;
                else if (see_it) msgtxt = 'Some water evaporates.';
            } else {
                rangemod -= 3;
                lev.typ = ROOM; lev.flags = 0;
                /* maketrap(x, y, PIT) draws no RNG; the trap subsystem's
                   dotrap/mintrap follow-up is not wired here. */
                if (see_it) msgtxt = 'The water evaporates.';
            }
            if (msgtxt) await Norep_zap(msgtxt);
            if (lev.typ === ROOM) newsym(x, y);
        } else if (IS_FOUNTAIN(lev.typ)) {
            await create_gas_cloud(x, y, rnd(3), 0);
            if (see_it) await update_topl('Steam billows from the fountain.');
            rangemod -= 1;
            /* dryup(x, y, type > 0): fountain bookkeeping, no RNG on this path */
        }
    }
    if (damgtype === ZT_FIRE)
        burn_floor_objects(x, y, false, type > 0);
    return rangemod;
}

// C ref: mon.c:3395 monkilled(mon, fltxt, how) — a monster killed by ANOTHER
// monster's attack.  It is NOT xkilled(): there is no hero kill credit, no
// experience and, critically, none of xkilled()'s extra rolls (the rn2(6)
// "illogical but traditional" treasure drop).  The whole RNG cost is
// mondied() -> corpse_chance()'s rn2(2).
async function monkilled_zap(mon, fltxt) {
    if (cansee(mon.mx, mon.my) && fltxt)
        await update_topl(`${Monnam(mon)} is ${nonliving_zap(mon) ? 'destroyed' : 'killed'}`
                          + ` by the ${fltxt}!`);
    const { mondied_mm } = await import('./mhitm.js');
    await mondied_mm(mon);
}
// C ref: mondata.h:219 nonliving(ptr) = is_undead(ptr) || PM_MANES ||
// weirdnonliving(ptr) [golem or S_VORTEX].  Derived from the generated M2_UNDEAD
// flag and the monster class, NOT from a species-name regex.
const S_VORTEX_Z = 22, S_GOLEM_Z = 55;   // defsym.h
function nonliving_zap(mon) {
    const p = mon?.data;
    if (!p) return false;
    if (is_undead_flag(p)) return true;
    if (p.name === 'manes') return true;
    return p.mcls === S_GOLEM_Z || p.mcls === S_VORTEX_Z;
}

// C ref: pline.c vpline() — Norep()'s dedup is `msgtyp == MSGTYP_NOREP &&
// !strcmp(line, gp.prevmsg)`: it compares against the PREVIOUS INDIVIDUAL
// message, not the concatenated top row.  A fire ray crossing two water squares
// therefore prints ONE "You hear hissing gas." even though the first was merged
// into "You kill it!  You hear hissing gas.".
async function Norep_zap(msg) {
    if (game._prevmsg === msg) return;
    await update_topl(msg);
}

// hack.c nomul(0) / allmain.c stop_occupation(): imported lazily because
// hack.js pulls zap.js back in (wand-zap command wiring).
async function nomul_zap(nval) {
    const { nomul } = await import('./hack.js');
    nomul(nval);
}
async function stop_occupation_zap() {
    const { stop_occupation } = await import('./hack.js');
    await stop_occupation();
}

// C ref: zap.c burn_floor_objects(x, y, give_feedback, u_caused).
export function burn_floor_objects(x, y, _give_feedback, u_caused) {
    const arr = game.level?.objects || [];
    // C walks the nexthere chain (newest first); place_object prepends, and
    // this port's flat list appends, so iterate in reverse (same convention
    // bhitpile uses).
    const here = [];
    for (let i = arr.length - 1; i >= 0; i--) {
        const o = arr[i];
        if (o.where === 'floor' && o.ox === x && o.oy === y) here.push(o);
    }
    let cnt = 0;
    for (const obj of here) {
        if (obj.oclass !== SCROLL_CLASS && obj.oclass !== SPBOOK_CLASS
            && !(obj.oclass === FOOD_CLASS && obj.otyp === GLOB_OF_GREEN_SLIME))
            continue;
        if (obj.otyp === SCR_FIRE || obj.otyp === SPE_FIREBALL
            || obj_resists(obj, 2, 100))
            continue;
        const scrquan = obj.quan || 1;
        let delquan = 0;
        for (let i = scrquan; i > 0; i--) if (!rn2(3)) delquan++;
        if (!delquan) continue;
        if (u_caused || delquan >= scrquan) {
            if (delquan < scrquan) {
                obj.quan = scrquan - delquan;
                obj.owt = weight_of(obj);
            } else {
                delobj(obj);
            }
        } else {
            obj.quan = scrquan - delquan;
            obj.owt = weight_of(obj);
        }
        cnt += delquan;
    }
    // C: ignite_items(level.objects[x][y]) — does not change cnt.
    void ignite_items(here.filter(o => o.where === 'floor'));
    return cnt;
}

// C ref: youprop.h Hallucination.
// C ref: muse.c ureflects(fmt, str) — outermost reflection source first.
// Draws no RNG; the reflection message and the makeknown are the observable.
const SHIELD_OF_REFLECTION_OTYP = 158, AMULET_OF_REFLECTION_OTYP = 162;
async function ureflects(fmt, str) {
    const { makeknown } = await import('./invent.js');
    if (game.uarms && game.uarms.otyp === SHIELD_OF_REFLECTION_OTYP) {
        if (fmt && str) {
            await update_topl(fmt.replace('%s', str).replace('%s', 'shield'));
            makeknown(SHIELD_OF_REFLECTION_OTYP);
        }
        return true;
    }
    if (game.uamul && game.uamul.otyp === AMULET_OF_REFLECTION_OTYP) {
        if (fmt && str) {
            await update_topl(fmt.replace('%s', str).replace('%s', 'medallion'));
            makeknown(AMULET_OF_REFLECTION_OTYP);
        }
        return true;
    }
    return false;
}

function Hallucination() {
    const u = game.u;
    return !!(u?.uprops?.Hallucination || u?.Hallu || u?.uhallu);
}

// C ref: zap.c zap_hit(ac, type) — does the ray hit a target of armor class ac?
function zap_hit(ac, type) {
    const chance = rn2(20);
    const spell_bonus = 0; // type 0 (wand) -> no spell hit bonus
    if (!chance) return rnd(10) < ac + spell_bonus;
    const acv = AC_VALUE(ac);
    return (3 - chance < acv + spell_bonus);
}
function AC_VALUE(ac) { return ac >= 0 ? ac : -rnd(-ac); }

// C ref: include/hack.h zaptype() — normalize a monster-wand offset (-39..-30)
// back to the 0-9 hero-wand range, then abs().  Every dobuzz() call in the
// covered sessions is a hero wand zap (type 0-9) already, so this is a no-op
// there; kept for structural fidelity.
function zaptype(type) {
    if (type <= -30 && type >= -39) type += 30;
    return Math.abs(type);
}

// C ref: zap.c zhitm()'s MAGIC_COOKIE sentinel (disintegration instakill).
const MAGIC_COOKIE = 1000;

// ── monster resistance/defense predicates (mondata.c) ───────────────────────
// C ref: monflag.h MR_* bits, mons[].mresists (already ported per-species in
// makemon.js's MONS table).  Only the *innate* half of Resists_Elem() is
// modelled: none of the covered sessions' zap targets wear or wield gear that
// grants elemental resistance, so the worn/wielded-item scan is not needed.
const MR_FIRE = 0x01, MR_COLD = 0x02, MR_SLEEP = 0x04, MR_DISINT = 0x08,
      MR_ELEC = 0x10, MR_POISON = 0x20, MR_ACID = 0x40;
function mresists_of(mon) { return mon?.data?.mresists || 0; }
function resists_fire(mon) { return !!(mresists_of(mon) & MR_FIRE); }
function resists_cold(mon) { return !!(mresists_of(mon) & MR_COLD); }
export function resists_sleep(mon) { return !!(mresists_of(mon) & MR_SLEEP); }
function resists_disint(mon) { return !!(mresists_of(mon) & MR_DISINT); }
function resists_elec(mon) { return !!(mresists_of(mon) & MR_ELEC); }
function resists_poison(mon) { return !!(mresists_of(mon) & MR_POISON); }
function resists_acid(mon) { return !!(mresists_of(mon) & MR_ACID); }
// C ref: mondata.c resists_magm — the innate test is generic, NOT a species
// list: dmgtype(ptr, AD_MAGM) || ptr == baby gray dragon || dmgtype(ptr,
// AD_RBRE).  C's "gray dragons, Angels, Oracle, Yeenoghu" comment describes the
// 3.2.0 result, not the rule — an mcls == S_ANGEL test would wrongly cover the
// couatl (no AD_MAGM attack) and miss the Chromatic Dragon.  The old
// unconditional FALSE let a wand of striking or polymorph hit a gray dragon,
// taking the damage/newcham branch C never takes.
const PM_BABY_GRAY_DRAGON = 133;
// C ref: objects.h — the object types whose oc_oprop is ANTIMAGIC / DISINT_RES.
// Resolved by name off the shared objects table so they cannot drift.
const ANTIMAGIC_OTYPS = new Set(
    ['gray dragon scale mail', 'gray dragon scales', 'cloak of magic resistance']
        .map(n => objects.findIndex(o => o && o.name === n)).filter(i => i > 0));
const DISINT_RES_OTYPS = new Set(
    ['black dragon scale mail', 'black dragon scales']
        .map(n => objects.findIndex(o => o && o.name === n)).filter(i => i > 0));
function resists_magm(mon) {
    const ptr = mon?.data;
    if (!ptr) return false;
    if (dmgtype(ptr, AD_MAGM) || ptr.pmidx === PM_BABY_GRAY_DRAGON
        || dmgtype(ptr, AD_RBRE))
        return true;
    // C: any WORN item whose objects[].oc_oprop is ANTIMAGIC.  mkobj.js's object
    // rows carry no oc_oprop column, so the property is spelled out as the otyp
    // set objects.h gives it: gray dragon scale mail / gray dragon scales /
    // cloak of magic resistance.  (A silently-undefined `.oc_oprop` test would
    // answer FALSE for every monster forever.)
    const mwflags = mon.misc_worn_check | 0;
    for (const o of (Array.isArray(mon.minvent) ? mon.minvent : []))
        if (((o.owornmask | 0) & mwflags) && ANTIMAGIC_OTYPS.has(o.otyp))
            return true;
    return false;
}
// C ref: mondata.c resists_blnd(mon) — the monster half.  The old version
// tested only mblinded/msleeping; C also short-circuits on !mcansee and on an
// EYELESS species (M1_NOEYES), and on a blinding EXPL/GAZE attack of its own.
// zhitm()'s ZT_LIGHTNING arm gates rnd(50) on this, so a wrong answer adds or
// drops a draw.  (resists_blnd_by_arti/Sunsword needs monster artifact gear,
// which this port does not model.)
function resists_blnd_mon(mon) {
    const ptr = mon?.data;
    if (mon?.mblinded || !mon?.mcansee || mon?.msleeping) return true;
    if (ptr && (mflags1_of(ptr) & M1_NOEYES)) return true;      /* !haseyes */
    if (ptr && (attacktype_fordmg(ptr, AT_EXPL, AD_BLND)
                || attacktype_fordmg(ptr, AT_GAZE, AD_BLND)))
        return true;
    return false;
}
// C ref: uhitm.c defended(mon, ad) — worn artifact/item granting `ad` defense.
// No covered zap target wears such gear.
function defended(_mon, _ad) { return false; }
// C ref: muse.c mon_reflects(mon, str) — shield of reflection / reflecting
// artifact / amulet of reflection / silver dragon scales, then the innate arm.
// Only the innate arm is decidable here (this port does not model monster
// worn-armor slots), but it is the half that matters: a reflected beam reverses
// direction, changing every later square the ray visits.  C's comment is
// explicit that "silver dragons only reflect when mature; babies do not", so
// PM_BABY_SILVER_DRAGON must NOT be here; the Chromatic Dragon must.
const PM_SILVER_DRAGON = 145, PM_CHROMATIC_DRAGON = 359;
async function mon_reflects(mon, str) {
    const px = mon?.data?.pmidx;
    if (px !== PM_SILVER_DRAGON && px !== PM_CHROMATIC_DRAGON) return false;
    /* C: pline(str, s_suffix(mon_nam(mon)), "scales") */
    if (str) await update_topl(str.replace('%s %s', `${s_suffix(mon_nam(mon))} scales`));
    return true;
}
// C ref: hacklib.c s_suffix().
function s_suffix(s) { return /s$/.test(s) ? `${s}'` : `${s}'s`; }
// C ref: mondata.c is_demon(ptr) — mlet == S_DEMON (defsym.h index 56).
function is_demon_mdat(mdat) { return !!mdat && mdat.mcls === 56; }
// C ref: mondata.h nonliving(ptr) — undead/golem/vortex/elemental "destroyed"
// rather than "killed".  Matches uhitm.js's own nonliving() name heuristic.
function nonliving_mdat(mdat) {
    const name = mdat?.name || '';
    return /\bzombie\b|\bmummy\b|\bskeleton\b|\bwraith\b|\bghost\b|\blich\b|golem\b|\bvortex\b|\belemental\b/.test(name);
}
// C ref: worn.c find_mac(mon).
function find_mac(mon) { return worn_find_mac(mon); }

// C ref: zap.c resist(mtmp, oclass, damage, tell) — the generic saving throw
// against a wand/tool/weapon/scroll/potion/ring/spell effect.  `tell`'s
// shieldeff() flash is display-only (no RNG); not modelled.
export function resist(mtmp, oclass, damage, _tell) {
    let alev;
    switch (oclass) {
    case WAND_CLASS: alev = 12; break;
    case TOOL_CLASS: alev = 10; break; // instrument (WEAPON_CLASS artifact
                                        // case is also alev 10, never reached here)
    case SCROLL_CLASS: alev = 9; break;
    case POTION_CLASS: alev = 6; break;
    case RING_CLASS: alev = 5; break;
    default: alev = game.u?.ulevel || 1; break;
    }
    let dlev = mtmp?.m_lev ?? mtmp?.data?.mlevel ?? 0;
    if (dlev > 50) dlev = 50;
    else if (dlev < 1) dlev = 1; // (is_mplayer fake-player special-case omitted)
    // permonst.mr — the LVL() magic-resistance PERCENTAGE, not MONS[].mresists
    // (the MR_* bitmask).  `mtmp.data.mr` is undefined on every ported permonst,
    // so the old `|| 0` made resist() ALWAYS fail: no monster ever saved against
    // a wand, and the branches resist() gates (slow/speed/polymorph/sleep/
    // turn-undead) all took the unresisted path.
    const resisted = rn2(100 + alev - dlev) < mon_mr(mtmp?.data);
    if (resisted) damage = Math.trunc((damage + 1) / 2);
    if (damage && mtmp) mtmp.mhp = (mtmp.mhp || 0) - damage;
    return resisted;
}

// C ref: zap.c bounce_dir(sx, sy, ddx, ddy, bounceback) — reflect the beam's
// direction off a wall/edge.  sx,sy is the post-move position where the bounce
// is happening (the same argument the two C call sites pass).
function bounce_dir(sx, sy, ddx, ddy, bounceback) {
    if (!ddx || !ddy || (bounceback > 0 && !rn2(bounceback)))
        return { dx: -ddx, dy: -ddy };
    const lsy = sy - ddy, lsx = sx - ddx;
    let bounce = 0;
    const t1 = game.level?.at(sx, lsy)?.typ;
    if (isok(sx, lsy) && ZAP_POS(t1) && !closed_door_at(sx, lsy)
        && (IS_ROOM(t1) || (isok(sx + ddx, lsy) && ZAP_POS(game.level?.at(sx + ddx, lsy)?.typ))))
        bounce = 1;
    const t2 = game.level?.at(lsx, sy)?.typ;
    if (isok(lsx, sy) && ZAP_POS(t2) && !closed_door_at(lsx, sy)
        && (IS_ROOM(t2) || (isok(lsx, sy + ddy) && ZAP_POS(game.level?.at(lsx, sy + ddy)?.typ))))
        if (!bounce || rn2(2)) bounce = 2;
    switch (bounce) {
    case 0: ddx = -ddx; ddy = -ddy; break; // (C: case 0 falls through to case 1)
    case 1: ddy = -ddy; break;
    case 2: ddx = -ddx; break;
    }
    return { dx: ddx, dy: ddy };
}

// C ref: zap.c exclam(force) — "!" for a solid hit, "." for a light one, "?"
// for force<0 (e.g. a sleep ray, which deals 0 damage).
function exclam(force) { return force < 0 ? '?' : (force <= 4 ? '.' : '!'); }
// C ref: zap.c hit(str, mtmp, force)/miss(str, mtmp) — "The <str> hits/misses
// <mon>."  vtense() pluralization is skipped: every flash_str() here is a
// singular noun ("bolt of cold", "sleep ray", ...), so the verb is always
// "hits"/"misses".
async function hit(str, mon, force) {
    // C: verbosely = (mtmp == &youmonst) || (flags.verbose && (cansee(bhitpos)
    // || canspotmon(mtmp) || engulfing_u(mtmp))).  The cansee() disjunct was
    // missing, so a hit on an unseen monster standing on a lit square printed
    // "it" where C names the monster.
    const verbose = game.flags?.verbose !== false;
    const named = verbose && (cansee(mon?.mx, mon?.my) || canspotmon(mon));
    await update_topl(`The ${str} hits ${named ? mon_nam(mon) : 'it'}${force}`);
}
async function miss(str, mon) {
    const verbose = game.flags?.verbose !== false;
    const named = (cansee(mon?.mx, mon?.my) || canspotmon(mon)) && verbose;
    await update_topl(`The ${str} misses ${named ? mon_nam(mon) : 'it'}.`);
}
// C ref: mondata.c disguised_as_non_mon — a hiding mimic/mimicking object.  No
// covered zap target is a mimic.
function disguised_as_non_mon(_mon) { return false; }
// C ref: mon.c wakeup(mon, via_attack) — wake_msg() then clear msleeping, then
// (via_attack) setmangry().  setmangry() is NOT message-only: it flips a
// peaceful monster hostile, which changes every later m_move()/mattacku()
// decision for it, and on an Elbereth square it draws rnd(5).  The old
// msleeping-only version silently skipped all of that.
// (growl() is deliberately not called: uhitm.js measured its topline landing
// where C's does not, and C's growl() is RNG-free so omitting it cannot desync.)
async function wakeup(mon, viaAttack) {
    if (!mon) return;
    const wasSleeping = !!mon.msleeping;
    if (wasSleeping && canseemon_shared(mon)) {
        const alive = mon.data?.name === 'flesh golem' ? " It's alive!" : '';
        await pline(`${Monnam(mon)} wakes up${viaAttack ? '!' : '.'}${alive}`);
    }
    mon.msleeping = 0;
    if (viaAttack) {
        const { setmangry } = await import('./uhitm.js');
        await setmangry(mon, true);
    }
}
// C ref: zap.c slept_monst — releases a grappled hero when their engulfer/
// holder falls asleep.  No covered zap target is grappling the hero.
async function slept_monst(_mon) {}

// C ref: mhitm.c sleep_monst(mon, amt, how) — how=WAND_CLASS for a wand of
// sleep zap.  seemimic() mimic-reveal is not modelled (no covered zap target
// is a hiding mimic).
export async function sleep_monst(mon, amt, how) {
    if (resists_sleep(mon) || defended(mon, 4 /*AD_SLEE*/) || (how >= 0 && resist(mon, how, 0, false))) {
        // shieldeff(mon.mx, mon.my): display-only, no RNG.
        return false;
    }
    if (mon.mcanmove) {
        amt += (mon.mfrozen || 0);
        if (amt > 0) { mon.mcanmove = 0; mon.mfrozen = Math.min(amt, 127); }
        else mon.msleeping = 1;
        return true;
    }
    return false;
}

// C ref: zap.c disintegrate_mon — the ZT_BREATH(ZT_DEATH) instakill path.  Not
// reachable via a hero wand zap (dobuzz's type is always >= 0 there), but kept
// for structural completeness; mlifesaver()'s amulet-of-life-saving check
// isn't modelled (no covered target wears one).
async function disintegrate_mon(mon, type, fltxt) {
    if (canseemon_shared(mon)) await update_topl(`${Monnam(mon)} is disintegrated!`);
    // C: `oresist_disintegration(obj)` is
    //   oc_oprop == DISINT_RES || obj_resists(obj, 5, 50) || quest artifact
    // and obj_resists() DRAWS rn2(100) for every carried item that isn't one of
    // the always-resists types.  Filtering on oartifact alone skipped all of
    // them, so a target with any inventory desynchronized here.
    if (Array.isArray(mon.minvent) && mon.minvent.length) {
        const keep = [];
        for (const o of mon.minvent) {
            if (DISINT_RES_OTYPS.has(o.otyp)
                || obj_resists(o, 5, 50) || o.oartifact)
                keep.push(o);
        }
        mon.minvent = keep;
    }
    await killed(mon, { nomsg: true, nocorpse: true });
}

// C ref: zap.c flash_types[] — indexed by zaptype(type), NOT by type % 10: the
// wand (0-9), spell (10-19) and BREATH (20-29) bands have different names, so a
// dragon's AD_FIRE breath is "blast of fire", not "bolt of fire".
const FLASH_NAME = [
    'magic missile',
    'bolt of fire', 'bolt of cold', 'sleep ray', 'death ray',
    'bolt of lightning', '', '', '', '',

    'magic missile',
    'fireball', 'cone of cold', 'sleep ray', 'finger of death',
    'bolt of lightning', '', '', '', '',

    'blast of missiles',
    'blast of fire', 'blast of frost', 'blast of sleep gas',
    'blast of disintegration', 'blast of lightning',
    'blast of poison gas', 'blast of acid', '', '',
];
function flash_str(type) { return FLASH_NAME[zaptype(type)] || 'bolt'; }
function flash_The(type) { return 'The ' + flash_str(type); }
function flash_killer(type) { return flash_str(type); }

// C ref: zap.c zhitu — apply a ray's effect to the hero.  All eight abstract
// damage types are handled: ZT_SLEEP (which draws d(nd,25) and calls
// fall_asleep instead of losing HP), ZT_DEATH (instant done(DIED)),
// ZT_POISON_GAS and ZT_ACID used to fall into a `default: dam = d(nd,6)` that
// matched none of them.
async function zhitu(type, nd, fltxt, sx, sy) {
    const u = game.u;
    let dam = 0, orig_dam = 0;
    const abstyp = zaptype(type);
    switch (abstyp % 10) {
    case ZT_MAGIC_MISSILE:
        if (Antimagic()) {
            await update_topl('The missiles bounce off!');
        } else {
            dam = d(nd, 6);
            exercise(A_STR, false);
        }
        break;
    case ZT_FIRE:
        orig_dam = d(nd, 6);
        if (Fire_resistance()) {
            await update_topl("You don't feel hot!");
        } else {
            dam = orig_dam;
        }
        // burn_away_slime(): hero not sliming (no RNG).
        if (await burnarmor(u)) {      // "body hit"
            if (!rn2(3))
                await destroy_items(u, AD_FIRE, orig_dam);
            if (!rn2(3))
                await ignite_items(invent_list());
        }
        break;
    case ZT_COLD:
        orig_dam = d(nd, 6);
        if (Cold_resistance()) {
            await update_topl("You don't feel cold.");
        } else {
            dam = orig_dam;
        }
        if (!rn2(3))
            await destroy_items(u, AD_COLD, orig_dam);
        break;
    case ZT_SLEEP:
        // C draws d(nd, 25) here — NOT d(nd, 6) — and the hero loses no HP at
        // all; the old `default:` arm rolled the wrong modulus and then applied
        // the roll as damage.
        if (Sleep_resistance()) {
            await update_topl("You don't feel sleepy.");
        } else {
            fall_asleep(-d(nd, 25), true); /* sleep ray */
        }
        break;
    case ZT_DEATH:
        // ZT_BREATH(ZT_DEATH) disintegration is unreachable from a hero wand
        // zap (dobuzz's type is 0-9 here); the ordinary death ray kills outright
        // with no damage roll.
        if (abstyp === 20 + ZT_DEATH) {
            if (Disint_resistance()) {
                await update_topl('You are not disintegrated.');
                break;
            }
            // (uarms/uarm disintegrate_arm sacrifices aren't modelled.)
        } else if (Antimagic()) {
            await update_topl("You aren't affected.");
            break;
        }
        game._killer_name = fltxt || '';
        await losehp((u.uhp | 0) + 1, fltxt);
        return;
    case ZT_LIGHTNING:
        orig_dam = d(nd, 6);
        if (Shock_resistance()) {
            await update_topl("You aren't affected.");
        } else {
            dam = orig_dam;
            // C: exercise(A_CON, FALSE).  Both attributes draw rn2(2), but they
            // credit DIFFERENT aexe[] slots, and exerchk() later rolls off those
            // slots — so charging A_STR here silently steers a later modulus.
            exercise(A_CON, false);
        }
        if (!rn2(3))
            await destroy_items(u, AD_ELEC, orig_dam);
        break;
    case ZT_POISON_GAS:
        // C: poisoned("blast", A_DEX, "poisoned blast", 15, FALSE) — the poison
        // subsystem (Poison_resistance / rn2(fatal) instadeath / attribute loss)
        // is not ported.  DEFERRED: C draws poisoned()'s rolls here.
        break;
    case ZT_ACID:
        if (Acid_resistance()) {
            await update_topl("The acid doesn't hurt.");
            dam = 0;
        } else {
            await update_topl('The acid burns!');
            dam = d(nd, 6);
            exercise(A_STR, false);
        }
        /* two weapons at once makes both more vulnerable */
        if (!rn2(u.twoweap ? 3 : 6)) { /* acid_damage(uwep) */ }
        if (u.twoweap && !rn2(3)) { /* acid_damage(uswapwep) */ }
        if (!rn2(6)) { /* erode_armor(&youmonst, ERODE_CORRODE) */ }
        break;
    default:
        break;
    }
    // C: Half_spell_damage halves wand/spell damage (abstyp < 20), not breath.
    if (dam && Half_spell_damage() && abstyp < 20)
        dam = Math.trunc((dam + 1) / 2);
    await losehp(dam, fltxt);
}

// C ref: monattk.h AD_* (used by destroy_items dispatch and zhitm's switch).
const AD_MAGM = 1, AD_FIRE = 2, AD_COLD = 3, AD_SLEE = 4, AD_DISN = 5,
      AD_ELEC = 6, AD_DRST = 7, AD_ACID = 8;

// C ref: zap.c zhitm(mon, type, nd, &ootmp) — apply a ray's damage to a
// monster.  Returns { tmp, otmp }: tmp is the damage dealt (or MAGIC_COOKIE
// for a disintegration instakill), otmp is worn armor disintegration
// destroyed instead of killing (only reachable via the monster-breath branch,
// which dobuzz never invokes for a hero wand zap).
async function zhitm(mon, type, nd) {
    const fltyp = zaptype(type);
    const damgtype = fltyp % 10;
    let tmp = 0, orig_dmg = 0, otmp = null, shieldeffFlag = false;
    switch (damgtype) {
    case ZT_MAGIC_MISSILE:
        if (resists_magm(mon) || defended(mon, AD_MAGM)) { shieldeffFlag = true; break; }
        tmp = d(nd, 6);
        break;
    case ZT_FIRE:
        if (resists_fire(mon) || defended(mon, AD_FIRE)) { shieldeffFlag = true; break; }
        tmp = d(nd, 6);
        orig_dmg = tmp;
        if (resists_cold(mon)) tmp += 7;
        if (await burnarmor(mon)) {
            if (!rn2(3)) {
                tmp += await destroy_items(mon, AD_FIRE, orig_dmg);
                // ignite_items(mon.minvent): no RNG; no covered target carries
                // burnable items.
            }
        }
        break;
    case ZT_COLD:
        if (resists_cold(mon) || defended(mon, AD_COLD)) { shieldeffFlag = true; break; }
        tmp = d(nd, 6);
        orig_dmg = tmp;
        if (resists_fire(mon)) tmp += d(nd, 3);
        if (!rn2(3)) tmp += await destroy_items(mon, AD_COLD, orig_dmg);
        break;
    case ZT_SLEEP:
        tmp = 0;
        await sleep_monst(mon, d(nd, 25), WAND_CLASS);
        break;
    case ZT_DEATH:
        if (Math.abs(type) !== 20 + ZT_DEATH /* ZT_BREATH(ZT_DEATH); unreachable
                                                 via a hero wand zap (type 0-9) */) {
            // "death"/disintegration wand or spell.  The PM_DEATH self-heal
            // and is_rider resurrection special cases aren't reachable by any
            // covered zap target and are skipped in favor of the ordinary
            // path straight below.
            if (nonliving_mdat(mon.data) || is_demon_mdat(mon.data) || resists_magm(mon)) {
                shieldeffFlag = true;
                break;
            }
            type = -1; // no saving throw
            tmp = (mon.mhp || 0) + 1;
            break;
        }
        // Disintegration breath: not reachable via a hero wand zap.
        if (resists_disint(mon) || defended(mon, AD_DISN)) shieldeffFlag = true;
        else tmp = MAGIC_COOKIE;
        return { tmp, otmp };
    case ZT_LIGHTNING:
        tmp = d(nd, 6);
        orig_dmg = tmp;
        if (resists_elec(mon) || defended(mon, AD_ELEC)) { shieldeffFlag = true; tmp = 0; }
        if (!resists_blnd_mon(mon) && nd > 2) {
            const rnd_tmp = rnd(50);
            mon.mcansee = 0;
            mon.mblinded = Math.min(127, (mon.mblinded || 0) + rnd_tmp);
        }
        if (!rn2(3)) tmp += await destroy_items(mon, AD_ELEC, orig_dmg);
        break;
    case ZT_POISON_GAS:
        if (resists_poison(mon)) { shieldeffFlag = true; break; }
        tmp = d(nd, 6);
        break;
    case ZT_ACID:
        if (resists_acid(mon)) { shieldeffFlag = true; break; }
        tmp = d(nd, 6);
        if (!rn2(6)) { /* acid_damage(MON_WEP(mon)): scrolls only, null-safe;
                           no covered target wields a destructible scroll. */ }
        if (!rn2(6)) await erode_armor_mon(mon);
        break;
    }
    // shieldeff(mon.mx, mon.my): display-only shimmer flash, no RNG.  Not
    // modelled (no covered target reaches a resisted branch that needs it).
    void shieldeffFlag;
    if (tmp > 0 && type >= 0 && resist(mon, fltyp < 10 ? WAND_CLASS : 0, 0, false))
        tmp = Math.trunc(tmp / 2);
    if (tmp < 0) tmp = 0;
    mon.mhp = (mon.mhp || 0) - tmp;
    return { tmp, otmp };
}

// C ref: uhitm.c erode_armor(mdef, hurt) — the ACID case's armor-corrosion
// pass.  Same reroll-until-torso-slot RNG shape as burnarmor(); no monster in
// the covered sessions wears armor, so this only pays the reroll cost.
async function erode_armor_mon(mon) {
    for (;;) {
        switch (rn2(5)) {
        case 0: if (worn_slot(mon, 'uarmh')) return; continue;
        case 1: return; // torso: always terminates (worn or bare)
        case 2: if (worn_slot(mon, 'uarms')) return; continue;
        case 3: if (worn_slot(mon, 'uarmg')) return; continue;
        case 4: if (worn_slot(mon, 'uarmf')) return; continue;
        }
    }
}

// C ref: trap.c burnarmor(victim) — burn worn armor; returns TRUE on a torso
// (body) hit.  The wet-towel pre-loop is skipped (no towel on the covered
// hero); no monster in the covered sessions wears armor, so worn_slot() always
// reports empty for a monster victim.
export async function burnarmor(victim) {
    if (!victim) return false;
    // C: `if (!burn_dmg(item, descr)) continue;` — the loop re-rolls whenever
    // erode_obj returns ER_NOTHING, which is NOT the same as "the slot is
    // empty": a NON-FLAMMABLE worn item (an iron helmet, iron boots) also
    // returns 0 and makes C roll again.  Breaking on slot occupancy alone cut
    // the rn2(5) chain short for every armoured hero hit by a fire ray.
    for (;;) {
        switch (rn2(5)) {
        case 0:
            if (await erode_burn(victim, 'uarmh', 'helmet')) break;
            continue;
        case 1: {
            if (worn_slot(victim, 'uarmc')) {
                await erode_burn(victim, 'uarmc', cloak_simple_name(worn_slot(victim, 'uarmc')));
                return true;
            }
            if (worn_slot(victim, 'uarm')) { await erode_burn(victim, 'uarm', 'suit'); return true; }
            if (worn_slot(victim, 'uarmu')) await erode_burn(victim, 'uarmu', 'shirt');
            return true;
        }
        case 2:
            if (await erode_burn(victim, 'uarms', 'wooden shield')) break;
            continue;
        case 3:
            if (await erode_burn(victim, 'uarmg', 'gloves')) break;
            continue;
        case 4:
            if (await erode_burn(victim, 'uarmf', 'boots')) break;
            continue;
        }
        break;
    }
    return false;
}

// Worn-armor slot accessor.  C uses uarm*/uarmc for the hero and
// which_armor(mon, W_ARM*) for a monster.  Returning null for EVERY monster was
// not harmless: burnarmor()/erode_armor() only `continue` (re-rolling rn2(5))
// when the rolled slot is EMPTY, so a monster wearing a helmet made C break out
// of the loop where this port kept re-rolling — a different number of draws.
// This port does track monster owornmask/misc_worn_check (muse.js which_armor).
const WORN_SLOT_BIT = {
    uarm: W_ARM, uarmc: W_ARMC, uarmh: W_ARMH, uarms: W_ARMS,
    uarmg: W_ARMG, uarmf: W_ARMF, uarmu: W_ARMU,
};
function worn_slot(victim, slot) {
    if (victim === game.u) return game[slot] || null;
    const bit = WORN_SLOT_BIT[slot] | 0;
    const mwflags = victim?.misc_worn_check | 0;
    for (const o of (Array.isArray(victim?.minvent) ? victim.minvent : []))
        if (((o.owornmask | 0) & bit) && ((o.owornmask | 0) & mwflags)) return o;
    return null;
}
function cloak_simple_name(obj) {
    // C ref: do_name.c cloak_simple_name — MR cloak / robe / etc. -> "cloak".
    return 'cloak';
}
// C ref: trap.c erode_obj(otmp, ostr, ERODE_BURN, EF_GREASE) — the burn_dmg()
// macro burnarmor() uses.  Returns an ER_* value; burnarmor only cares whether
// it is non-zero.  RNG: exactly one rnl(4) when the item is BLESSED and not
// erodeproof (that roll decides whether the blessing saves it) — missing it
// shifted every later draw of a fire ray that touched blessed armour.
const ER_NOTHING = 0, ER_DAMAGED = 2, MAX_ERODE = 3;
const MAT_LIQUID = 1, MAT_WOOD_Z = 8, MAT_PLASTIC = 18;
// C ref: mkobj.c is_flammable — material <= WOOD (but not LIQUID), or PLASTIC;
// candles and FIRE_RES-conferring items are exempt.  The material numbers are
// objclass.h's enum, NOT the 14/22/23 an older copy of this predicate used.
function is_flammable_obj(obj) {
    const m = objects[obj?.otyp]?.material | 0;
    return (m <= MAT_WOOD_Z && m !== MAT_LIQUID) || m === MAT_PLASTIC;
}
// C ref: objnam.c erosion_matters — weapons, armour, ball/chain, weptools.
function erosion_matters_obj(obj) {
    return obj?.oclass === WEAPON_CLASS || obj?.oclass === ARMOR_CLASS;
}
// C ref: pline.c vtense(subj, verb) — "gloves smoulder" but "helmet smoulders".
function vtense_burn(ostr, verb) {
    return /s$/.test(ostr || '') ? verb : verb + 's';
}
async function erode_burn(victim, slot, ostr) {
    const obj = worn_slot(victim, slot);
    if (!obj) return ER_NOTHING;
    // inventory_resistance_check(AD_FIRE): rn2(100) only when the hero carries
    // an item conferring partial fire resistance — none in the covered sessions.
    const erosion = obj.oeroded | 0;
    if (!erosion_matters_obj(obj)) return ER_NOTHING;
    if (!is_flammable_obj(obj) || (obj.oerodeproof && obj.rknown)) return ER_NOTHING;
    if (obj.oerodeproof || (obj.blessed && !rnl(4))) {
        if (obj.oerodeproof) obj.rknown = true;
        return ER_NOTHING;
    }
    if (erosion < MAX_ERODE) {
        const adverb = (erosion + 1 === MAX_ERODE) ? ' completely'
                     : erosion ? ' further' : '';
        const verb = vtense_burn(ostr, 'smoulder');
        if (victim === game.u) await update_topl(`Your ${ostr} ${verb}${adverb}!`);
        else if (canspotmon(victim))
            await update_topl(`${Monnam(victim)}'s ${ostr} ${verb}${adverb}!`);
        obj.oeroded = erosion + 1;
        return ER_DAMAGED;
    }
    // burn_dmg() passes no EF_DESTROY, so a fully-eroded item just survives.
    return ER_NOTHING;
}

// ── destroy_items (zap.c) ────────────────────────────────────────────────
// C ref: zap.c destroy_items / maybe_destroy_item / destroyable.  Iterate the
// hero's inventory and probabilistically destroy fire/cold/elec-vulnerable
// stacks.  Faithful to the RNG sequence the seed5002 fire zap exercises.
const DMG_DESTROY_SCALE = 5, MAX_ITEMS_DESTROYED = 20;

function invent_list() {
    if (Array.isArray(game.invent)) return game.invent;
    const out = [];
    for (let o = game.gi?.invent; o; o = o.nobj) out.push(o);
    return out;
}
// C ref: zap.c destroy_items's `objchn` (&gi.invent for the hero, &mon->minvent
// otherwise).
function obj_chain(carrier) {
    return (carrier === game.u) ? invent_list() : (Array.isArray(carrier?.minvent) ? carrier.minvent : []);
}
// C ref: mon.c m_useup — decrement/remove one item from a monster's minvent.
function mon_useup(carrier, obj) {
    const inv = carrier?.minvent;
    if (!inv) return;
    obj.quan = (obj.quan || 1) - 1;
    if (obj.quan <= 0) {
        const idx = inv.indexOf(obj);
        if (idx >= 0) inv.splice(idx, 1);
    }
}

// C ref: zap.c destroyable(obj, adtyp).
function destroyable(obj, adtyp) {
    if (obj.oartifact) return false;
    if (obj.in_use && obj.quan === 1) return false;
    if (adtyp === AD_FIRE) {
        if (obj.otyp === SCR_FIRE || obj.otyp === SPE_FIREBALL) return false;
        if (obj.otyp === GLOB_OF_GREEN_SLIME || obj.oclass === POTION_CLASS
            || obj.oclass === SCROLL_CLASS || obj.oclass === SPBOOK_CLASS)
            return true;
    } else if (adtyp === AD_COLD) {
        if (obj.oclass === POTION_CLASS && obj.otyp !== POT_OIL) return true;
    } else if (adtyp === AD_ELEC) {
        if (obj.oclass !== RING_CLASS && obj.oclass !== WAND_CLASS) return false;
        // RIN_SHOCK_RESISTANCE / WAN_LIGHTNING immune
        if (obj.otyp !== 207 /*RIN_SHOCK_RESISTANCE*/ && obj.otyp !== WAN_LIGHTNING)
            return true;
    }
    return false;
}

// destroy_strings[dindx][0 singular, 1 plural].  C ref: zap.c.
const DESTROY_STRINGS = [
    ['freezes and shatters', 'freeze and shatter'],
    ['boils and explodes', 'boil and explode'],
    ['ignites and explodes', 'ignite and explode'],
    ['catches fire and burns', 'catch fire and burn'],
    ['catches fire and burns', ''],
    ['turns to dust and vanishes', ''],
    ['breaks apart and explodes', ''],
];

// C ref: objnam.c yname(obj) — "Your <xname>" for a carried item.  The old
// version hardcoded six otyp->string pairs (the ones the seed5002 fire zap
// happens to destroy) and fell back to objects[].name, which is the BARE name
// ("invisibility", not "potion of invisibility") for every class whose prefix
// comes from the object class — so every unlisted potion/scroll/spellbook
// printed the wrong line.  invent.js's xname() builds the real name.
function yname_for(obj) {
    return 'Your ' + xname(obj);
}

export async function destroy_items(mon, dmgtyp, dmg_in) {
    const objchn = obj_chain(mon);
    let limit = Math.floor(dmg_in / DMG_DESTROY_SCALE);
    if (dmg_in % DMG_DESTROY_SCALE > rn2(DMG_DESTROY_SCALE)) limit++;
    if (limit > MAX_ITEMS_DESTROYED) limit = MAX_ITEMS_DESTROYED;
    if (limit < 1) return 0;

    const items = new Array(MAX_ITEMS_DESTROYED).fill(null).map(() => ({ obj: null, deferred: false }));
    let elig = 0, where = null;
    for (const obj of objchn) {
        if (!destroyable(obj, dmgtyp)) continue;
        const i = (elig < limit) ? elig : rn2(elig);
        elig++;
        if (i < 0 || i >= limit) continue;
        items[i].obj = obj;
        items[i].deferred = false; // levitation/flying deferral not on covered hero
        if (where == null) where = 'invent';
    }
    if (elig > limit) elig = limit;
    let dmg_out = 0;
    for (let defer = 0; defer <= 1; defer++) {
        for (let i = 0; i < elig; i++) {
            const obj = items[i].obj;
            if (obj && items[i].deferred === (defer === 1)) {
                dmg_out += await maybe_destroy_item(mon, obj, dmgtyp);
                items[i].obj = null;
            }
        }
    }
    return dmg_out;
}

async function maybe_destroy_item(carrier, obj, dmgtyp) {
    const u_carry = (carrier === game.u);
    let dindx = 0, dmg = 0, quan = 0, skip = 0, xresist = 0, chargeit = false;
    switch (dmgtyp) {
    case AD_COLD:
        quan = obj.quan; dindx = 0; dmg = rnd(4); break;
    case AD_FIRE:
        xresist = (obj.oclass !== POTION_CLASS && obj.otyp !== GLOB_OF_GREEN_SLIME
                   && (u_carry ? false /* hero not fire-resistant on covered level */
                               : resists_fire(carrier)));
        quan = obj.quan;
        switch (obj.oclass) {
        case POTION_CLASS: dindx = (obj.otyp !== POT_OIL) ? 1 : 2; dmg = rnd(6); break;
        case SCROLL_CLASS: dindx = 3; dmg = 1; break;
        case SPBOOK_CLASS: dindx = 4; dmg = 1; break;
        case FOOD_CLASS: dindx = 1; dmg = Math.floor((obj.owt + 19) / 20); break;
        }
        break;
    case AD_ELEC:
        quan = obj.quan;
        if (obj.oclass === WAND_CLASS) { dindx = 6; dmg = rnd(10); }
        break;
    default: skip = 1; break;
    }
    if (skip) return dmg;

    let cnt = 0;
    if (obj.in_use) quan--;
    for (let i = 0; i < quan; i++) if (!rn2(3)) cnt++;
    if (!cnt) return 0;

    const visible = u_carry || canspotmon(carrier);
    if (visible) {
        const mult = (cnt === 1) ? ((quan === 1) ? '' : 'One of ')
                   : ((cnt < quan) ? 'Some of ' : (quan === 2) ? 'Both of ' : 'All of ');
        // yname capitalises with "Your"; when prefixed by a mult word the leading
        // "Your" lowercases to "your".  For the covered single-stack potions cnt
        // and quan are both 1 so mult is empty -> "Your <name> <how>!".
        const base = u_carry ? yname_for(obj) : `${carrier?.name || 'The monster'}'s ${objects[obj.otyp]?.name || 'item'}`;
        const nm = (u_carry && mult) ? base.replace(/^Your/, 'your') : base;
        await update_topl(`${mult}${nm} ${DESTROY_STRINGS[dindx][cnt > 1 ? 1 : 0]}!`);
    }
    if (u_carry) {
        if (obj.oclass === POTION_CLASS && dmgtyp !== AD_COLD)
            await potionbreathe(obj);
    }
    for (let i = 0; i < cnt; i++) {
        if (u_carry) useup(obj);
        else mon_useup(carrier, obj);
    }
    if (dmg) {
        if (!u_carry) return xresist ? 0 : dmg;
        if (xresist) {
            await update_topl("You aren't hurt!");
        } else {
            await losehp(dmg, DESTROY_STRINGS[dindx][1] || DESTROY_STRINGS[dindx][0]);
            exercise(A_STR, false);
        }
    }
    return dmg;
}

// C ref: potion.c speed_up(duration) — the wand-of-speed self-zap effect.  The
// exercise(A_DEX, TRUE) is an rn2(19) draw and must follow the message.
// Very_fast is the timed half of HFast (allmain.js youHaveVeryFast); the "much "
// qualifier keys on plain Fast, which at this point can only be the intrinsic.
async function speed_up(duration) {
    const { youHaveFast, youHaveVeryFast } = await import('./allmain.js');
    if (!youHaveVeryFast())
        await update_topl(`You are suddenly moving ${youHaveFast() ? '' : 'much '}faster.`);
    else
        await update_topl('Your legs get new energy.');
    exercise(A_DEX, true);
    const u = game.u;
    if (!u.uprops) u.uprops = {};
    u.uprops.HFast = (u.uprops.HFast | 0) + duration; /* incr_itimeout(&HFast, ...) */
}

// C ref: potion.c potionbreathe — only the POT_INVISIBILITY case (no RNG) is
// reached by the seed5002 fire zap.
async function potionbreathe(obj) {
    switch (obj.otyp) {
    case POT_INVISIBILITY:
        // !Blind && !Invis on the covered hero.
        await update_topl("For an instant you couldn't see yourself!");
        break;
    default:
        break;
    }
}

// C ref: trap.c ignite_items(objchn) — every ignitable, not-already-lit item in
// the chain catches fire.  catch_lit() draws rn2(2) for a CURSED oil/magic lamp,
// so this is not RNG-free: the old empty stub silently swallowed that draw.
export async function ignite_items(objchn) {
    for (const obj of (objchn || [])) {
        if (!obj.lamplit && !obj.in_use)
            await catch_lit(obj);
    }
}

// C ref: objects.h oc_class/otyp — the ignitable() set: lamps, candles,
// candelabrum, potion of oil.  (Lantern is ignitable() but not by fire.)
const OIL_LAMP = 227, MAGIC_LAMP = 228, BRASS_LANTERN = 226,
      TALLOW_CANDLE = 224, WAX_CANDLE = 225;
function ignitable(obj) {
    switch (obj.otyp) {
    case OIL_LAMP: case MAGIC_LAMP: case BRASS_LANTERN:
    case TALLOW_CANDLE: case WAX_CANDLE:
    case CANDELABRUM_OF_INVOCATION: case POT_OIL:
        return true;
    default:
        return false;
    }
}

// C ref: apply.c catch_lit(obj).
async function catch_lit(obj) {
    if (obj.lamplit || !ignitable(obj)) return false;
    if (((obj.otyp === MAGIC_LAMP || obj.otyp === CANDELABRUM_OF_INVOCATION)
         && (obj.spe | 0) === 0)
        || (age_is_relative(obj) && (obj.age | 0) === 0)
        || obj.otyp === BRASS_LANTERN)
        return false;
    if (obj.otyp === CANDELABRUM_OF_INVOCATION && obj.cursed) return false;
    if ((obj.otyp === OIL_LAMP || obj.otyp === MAGIC_LAMP)
        && obj.cursed && !rn2(2))
        return false;
    // C: pline("%s %s %s", Yname2(obj), otense(obj, Blind ? "feel" : "catch"),
    // Blind ? "warm." : "light!").  objects[].name is the BARE name ("oil", not
    // "potion of oil") for class-prefixed types, so route through xname().
    if (obj.where === 'invent' || cansee(obj.ox, obj.oy)) {
        const plural = (obj.quan || 1) > 1;
        const verb = Blind() ? (plural ? 'feel' : 'feels') : (plural ? 'catch' : 'catches');
        await update_topl(`${yname_for(obj)} ${verb} ${Blind() ? 'warm.' : 'light!'}`);
    }
    if (obj.otyp === POT_OIL) makeknown(obj.otyp);
    obj.lamplit = 1;
    return true;
}
// C ref: obj.h age_is_relative(o) — lamps/candles burn down from obj->age.
function age_is_relative(obj) {
    switch (obj.otyp) {
    case BRASS_LANTERN: case OIL_LAMP: case MAGIC_LAMP:
    case CANDELABRUM_OF_INVOCATION: case TALLOW_CANDLE: case WAX_CANDLE:
        return true;
    default:
        return false;
    }
}

// ── losehp / death (hack.c losehp + end.c done) ──────────────────────────
// C ref: hack.c losehp — subtract HP; on death announce "You die..." and run
// done(DIED).  showdamage is off in the covered rc so no per-hit damage line.
async function losehp(n, knam) {
    const u = game.u;
    if (game.program_state?.gameover) return;
    u.uhp -= n;
    if (u.uhp > u.uhpmax) u.uhpmax = u.uhp;
    if (u.uhp < 1) {
        game._killer_name = knam || '';
        await update_topl('You die...');   // urgent_pline -> NEED_MORE topline
        await done_died();
    }
}

// C ref: end.c done(DIED) — wizard/explore mode offers "Die?" before really
// dying.  bot() forces the status to HP 0; the paranoid "Die?" query pages the
// pending "You die..." line (the recorded session ends at this prompt).
async function done_died() {
    const u = game.u;
    // force HP to 0 (done(): how < PANICKED resets positive/negative uhp)
    u.uhp = 0;
    if (u.mh != null) u.mh = 0;
    await bot();
    await flush_screen(1);
    // paranoid_query(ParanoidDie, "Die?"): yn_function shows the deferred
    // "You die...--More--" first (game._yn_need_more), then "Die? [yn] (n)".
    game._yn_need_more = true;
    const ans = await y_n('Die?', 'yn\x1b', 'n');
    if (ans === 'y') {
        game.program_state = game.program_state || {};
        game.program_state.gameover = true;
    } else {
        // C ref: end.c done():1113-1116 — pline("OK, so you don't die.") then
        // savelife(how), which restores uhp to min(uhpmax, 50+10*Con/2).  The
        // old stub only queued the message: the hero stayed at uhp 0, so
        // regen_hp() rolled an extra rn2(100) on EVERY later turn
        // (w3-elf-wiz-debug step 353).  update_topl so the caller's following
        // message ("You are blinded by the flash!") shares the topline.
        await update_topl('OK, so you don\'t die.');
        const { savelife } = await import('./end.js');
        savelife(0 /* DIED */);
    }
}

// C ref: cmd.c getdir() invoked from dozap() — prompt "In what direction?" and
// stash the result in u.dx/u.dy/u.dz.  Returns false on cancel (ESC / invalid).
async function zap_getdir() {
    const { getdir } = await import('./cmd.js');
    const d = await getdir();
    const u = game.u;
    if (!d) { u.dx = 0; u.dy = 0; u.dz = 0; return false; }
    u.dx = d.dx | 0; u.dy = d.dy | 0; u.dz = d.dz | 0;
    return true;
}

// C ref: zap.c zapyourself(obj, ordinary) — a directional wand/spell aimed at
// self (getdir() returned dx=dy=dz=0).  Returns the physical damage for the
// caller to feed to losehp(); WAN_DEATH runs done(DIED) directly and returns 0.
// Every IMMEDIATE/RAY otyp C handles now draws its own RNG here: the file used
// to fall through to a silent `default:` for all of them, so a self-zap of
// striking/fire/cold/lightning/magic-missile/invisibility/speed drew NOTHING
// and desynchronized the rest of the session.
export async function zapyourself(obj, ordinary) {
    let learn_it = false;
    let damage = 0;
    let orig_dmg = 0;   /* for passing to destroy_items() */
    const u = game.u;
    switch (obj.otyp) {
    case WAN_STRIKING:
    case SPE_FORCE_BOLT:
        learn_it = true;
        if (Antimagic()) {
            await pline('Boing!');
        } else {
            if (ordinary) {
                await update_topl('You bash yourself!');
                damage = d(2, 12);
            } else {
                damage = d(1 + (obj.spe | 0), 6);
            }
            exercise(A_STR, false);
        }
        break;

    case WAN_LIGHTNING:
        learn_it = true;
        orig_dmg = d(12, 6);
        if (!Shock_resistance()) {
            await update_topl('You shock yourself!');
            damage = orig_dmg;
            exercise(A_CON, false);
        } else {
            await update_topl('You zap yourself, but seem unharmed.');
        }
        await destroy_items(u, AD_ELEC, orig_dmg);
        await flashburn(rnd(100), true);
        break;

    case WAN_FIRE:
    case FIRE_HORN:
        learn_it = true;
        orig_dmg = d(12, 6);
        if (Fire_resistance()) {
            await update_topl('You feel rather warm.');
        } else {
            await update_topl("You've set yourself afire!");
            damage = orig_dmg;
        }
        // burn_away_slime(): hero not sliming (no RNG).
        await burnarmor(u);
        await destroy_items(u, AD_FIRE, orig_dmg);
        await ignite_items(invent_list());
        break;

    case WAN_COLD:
    case SPE_CONE_OF_COLD:
    case FROST_HORN:
        learn_it = true;
        orig_dmg = d(12, 6);
        if (Cold_resistance()) {
            await update_topl('You feel a little chill.');
        } else {
            await update_topl('You imitate a popsicle!');
            damage = orig_dmg;
        }
        await destroy_items(u, AD_COLD, orig_dmg);
        break;

    case WAN_MAGIC_MISSILE:
    case SPE_MAGIC_MISSILE:
        learn_it = true;
        if (Antimagic()) {
            await update_topl('The missiles bounce!');
        } else {
            damage = d(4, 6);
            await pline("Idiot!  You've shot yourself!");
        }
        break;

    case WAN_POLYMORPH:
    case SPE_POLYMORPH:
        // C ref: zap.c:2804-2810 — polyself(POLY_NOFLAGS) is now ported
        // (js/polyself.js), so the self-zap runs the real system-shock roll,
        // the random-form pick and polymon()/newman() instead of just
        // learning the wand.
        if (!Unchanging()) {
            learn_it = true;
            const { polyself } = await import('./polyself.js');
            await polyself(POLY_NOFLAGS);
        }
        break;

    case WAN_CANCELLATION:
    case SPE_CANCELLATION:
        // cancel_monst(&youmonst, obj, TRUE, TRUE, TRUE) — cancels the hero's
        // own inventory.  DEFERRED: needs cancel_item()'s per-object rolls.
        break;

    case SPE_DRAIN_LIFE:
        if (!Drain_resistance()) {
            learn_it = true;
            // losexp("life drainage") — experience-level loss (no RNG for the
            // level itself; the HP loss is rnd(10)-shaped inside losexp).
            const { losexp } = await import('./exper.js');
            if (losexp) await losexp('life drainage');
        }
        damage = 0;
        break;

    case WAN_MAKE_INVISIBLE: {
        // msg is computed BEFORE HInvis changes (C comment); newsym() then has
        // to run after, because the hero's glyph depends on the new state.
        const msg = !Invis() && !Blind();
        if (!u.uprops) u.uprops = {};
        u.uprops.HInvis = (u.uprops.HInvis | 0) + rn1(15, 31);
        if (msg) {
            learn_it = true;
            newsym(u.ux, u.uy);
            await update_topl('Gee!  All of a sudden, you can see right through yourself.');
        }
        break;
    }

    case WAN_SPEED_MONSTER:
        // speed_up(rn1(25, 50)) — the duration roll, then exercise(A_DEX, TRUE)
        // (an rn2(19) draw) inside speed_up().
        await speed_up(rn1(25, 50));
        learn_it = true;
        break;


    case WAN_SLEEP:
    case SPE_SLEEP:
        // C ref: zap.c zapyourself() WAN_SLEEP/SPE_SLEEP.  learn_it discovers the
        // wand type at the tail (learnwand -> makeknown, credit_hero rn2(19) when
        // first known).  monstseesu/monstunseesu only toggle a monster-memory flag
        // (no RNG).  With no sleep resistance the ordinary self-zap prints
        // pline_The("sleep ray hits you!") and collapses the hero via
        // fall_asleep(-rnd(50), TRUE) — the rnd(50) is the RNG-relevant draw.
        // pline_The/You route through vpline -> update_topl, which arms the
        // topline NEED_MORE state so the message combines with (and later pages
        // via --More--) the pet-move messages produced during the sleep turns.
        learn_it = true;
        if (Sleep_resistance()) {
            await update_topl("You don't feel sleepy!");
        } else {
            if (ordinary)
                await update_topl('The sleep ray hits you!');
            else
                await update_topl('You fall asleep!');
            fall_asleep(-rnd(50), true);
        }
        break;
    case WAN_DEATH:
    case SPE_FINGER_OF_DEATH:
        // nonliving()/is_demon(): the human hero is living and not a demon, so
        // the "apparently harmless beam" / "no deader than before" branch that
        // spares such heroes is skipped.  learn_it (makeknown) would run only if
        // done() returned to zapyourself(), but the contest player accepts death,
        // so identification is never touched on this path.
        // C ref: zap.c:2894 — Sprintf(killer.name, "shot %sself with a death ray",
        // uhim()); killer.format = NO_KILLER_PREFIX.  uhim() is her/him/it by
        // gender; used verbatim by outrip()'s tombstone + the score summary.
        {
            const him = game.flags?.female ? 'her' : 'him';
            game._killer_name = `shot ${him}self with a death ray`;
        }
        // Two urgent_pline()s then done(DIED).  urgent_pline() -> putmesg() ->
        // update_topl() (pline.c:315, topl.c:251).  getdir()'s
        // clear_nhwindow(WIN_MESSAGE) left the topline empty, so the first message
        // just arms NEED_MORE (no --More-- yet) and the second (a "You die"-prefixed
        // line, which update_topl never combines) fires more() to page the first.
        game._toplin = 0;
        game._pending_message = '';
        await update_topl('You irradiate yourself with pure energy!');
        await update_topl('You die.');
        await done_selfzap(0 /* DIED */);
        break;

    case WAN_SLOW_MONSTER:
    case SPE_SLOW_MONSTER:
        // C: HFast & (TIMEOUT | INTRINSIC) — only an already-hasted hero is
        // affected; u_slow_down()'s exercise(A_DEX, FALSE) is an rn2(2) draw.
        if (u.uprops?.HFast) {
            learn_it = true;
            u.uprops.HFast = 0;
            await update_topl('You slow down.');
            exercise(A_DEX, false);
        }
        break;

    case WAN_TELEPORTATION:
    case SPE_TELEPORT_AWAY: {
        const ox = u.ux, oy = u.uy;
        await tele();
        // C: learn_it when the destination is out of sight or far away.
        if (!cansee(ox, oy) || dist2(ox, oy, u.ux, u.uy) >= 16)
            learn_it = true;
        break;
    }

    case WAN_UNDEAD_TURNING:
    case SPE_TURN_UNDEAD:
        learn_it = true;
        await unturn_you();
        break;

    case SPE_HEALING:
    case SPE_EXTRA_HEALING: {
        learn_it = true; /* (no effect for spells...) */
        const extra = (obj.otyp === SPE_EXTRA_HEALING);
        const nhp = d(6, extra ? 8 : 4);
        // healup(nhp, 0, FALSE, blessed||extra): no RNG of its own.
        u.uhp = (u.uhp | 0) + nhp;
        if (u.uhp > u.uhpmax) u.uhp = u.uhpmax;
        if (obj.blessed || extra) {
            u.ucreamed = 0;
            if (u.uprops) { u.uprops.Blinded = 0; u.uprops.HDeaf = 0; }
        }
        await update_topl(`You feel ${extra ? 'much ' : ''}better.`);
        break;
    }

    case WAN_LIGHT:        /* (broken wand) */
        // assert(!ordinary)
        damage = d(obj.spe | 0, 25);
        /* FALLTHRU */
    case EXPENSIVE_CAMERA:
        if (!damage) damage = 5;
        damage = await lightdamage(obj, ordinary, damage);
        damage += rnd(25);
        if (await flashburn(damage, false)) learn_it = true;
        damage = 0; /* reset */
        break;

    case WAN_OPENING:
    case SPE_KNOCK:
        // release_hold()/unpunish()/openholdingtrap()/openfallingtrap() and
        // boxlock_invent() are all RNG-free state changes this port does not
        // model (no ustuck, no punishment, no carried boxes on the covered
        // heroes).  Left as a no-op rather than falling into `default:` so the
        // otyp is accounted for.
        break;
    case WAN_LOCKING:
    case SPE_WIZARD_LOCK:
        break;
    case WAN_DIGGING:
    case SPE_DIG:
    case SPE_DETECT_UNSEEN:
    case WAN_NOTHING:
        break;
    case WAN_PROBING:
        // C: probe_objchain(invent) -> observe_object() per item, which sets
        // dknown and discovers the type; only a TIN also gets known.  It does
        // NOT set bknown or known generally — an inventory line's BUC and
        // enchantment stay hidden, so setting them here would rewrite every
        // doname() in the 'i' menu.  Hallucination suppresses the whole thing
        // (o_init.c observe_object); o_init.js's copy omits both that guard and
        // the dknown assignment, so both are applied here.
        if (!Hallucination()) {
            for (const o of invent_list()) {
                observe_object(o);
                o.dknown = 1;
                if (o.otyp === TIN) o.known = 1;
            }
        }
        learn_it = true;
        break;
    case SPE_STONE_TO_FLESH:
        // bhito(otmp, obj) over the whole inventory (stone_to_flesh_obj rolls
        // for statues/figurines).  DEFERRED: bhito's STONE_TO_FLESH case is
        // not ported.
        break;

    default:
        break;
    }
    // C ref: zap.c zapyourself() tail — discover the wand type if its effect
    // was observable and the wand itself has been seen.
    if (learn_it) learnwand(obj);
    return damage;
}

// C ref: teleport.c tele() -> scrolltele(NULL).  The Amulet / Wizard's-tower
// `&& !rn2(3)` short-circuits before the roll for a hero carrying neither, so
// the uncontrolled path draws only safe_teleds()'s placement rolls.
async function tele() {
    const wizard = !!game.flags?.debug;
    const { noteleport_level } = await import('./teleport.js');
    if (noteleport_level(null) && !wizard) {
        await pline('A mysterious force prevents you from teleporting!');
        return;
    }
    if (wizard || (Teleport_control() && !Stunned())) {
        // Same C code path as the ^T command, already ported (getpos prompt,
        // teleok/teleds, "Sorry..." + safe_teleds fallback).
        const { dotele_wizard } = await import('./hack.js');
        await dotele_wizard();
        return;
    }
    const { safe_teleds_hero } = await import('./read.js');
    await safe_teleds_hero();
}

// C ref: zap.c unturn_you — unturn_dead() over carried corpses/eggs, then the
// undead-hero stun.  revive() is not ported (it needs the corpse-timer and
// makemon-from-corpse machinery), so only the non-undead branch is faithful;
// a hero carrying corpses would additionally draw revive()'s rolls.
async function unturn_you() {
    await pline('You shudder in dread.');
}

// C ref: zap.c flashburn(duration, via_lightning) — blind the hero unless
// blindness is resisted.  make_blinded() draws no RNG but Blind gates a large
// number of later predicates (and the whole map render), so the state change is
// the point.  resists_blnd() for the hero reduces to already-being-blind here.
async function flashburn(duration, _via_lightning) {
    const u = game.u;
    if (Blind()) return false;
    await update_topl('You are blinded by the flash!');
    // C ref: potion.c make_blinded(Blinded + duration, FALSE) — the timer is
    // u.ublindf-free HBlinded, which this port keeps in u.blinded (Blind(),
    // botl.c's " Blind" and timeout.js's BLINDED entry all read that field).
    // Writing u.uprops.Blinded instead left the hero seeing normally.
    u.blinded = (u.blinded | 0) + (duration | 0);
    game.botl = true;
    return true;
}

// C ref: youprop.h hero property predicates.  This port stores intrinsics under
// game.u.uprops (potion.js/cmd.js convention); an unmodelled property reads
// false, which is what the covered heroes actually have.
function Fire_resistance()  { return (game.u?.uprops?.HFire_resistance  || 0) > 0; }
function Cold_resistance()  { return (game.u?.uprops?.HCold_resistance  || 0) > 0; }
function Shock_resistance() { return (game.u?.uprops?.HShock_resistance || 0) > 0; }
function Acid_resistance()  { return (game.u?.uprops?.AcidResistance    || 0) > 0; }
function Disint_resistance(){ return (game.u?.uprops?.HDisint_resistance|| 0) > 0; }
function Drain_resistance() { return (game.u?.uprops?.HDrain_resistance || 0) > 0; }
function Antimagic()        { return !!(game.u?.HAntimagic || game.u?.Antimagic
                                        || game.u?.uprops?.HAntimagic); }
function Half_spell_damage(){ return (game.u?.uprops?.HHalf_spell_damage|| 0) > 0; }
function Unchanging()       { return (game.u?.uprops?.HUnchanging       || 0) > 0; }
function Invis()            { return !!(game.u?.uprops?.HInvis); }
function Teleport_control() { return (game.u?.uprops?.HTeleport_control || 0) > 0; }
function Stunned()          { return !!(game.u?.uprops?.Stun || game.u?.Stunned); }
// C ref: hack.h dist2(x0,y0,x1,y1).
function dist2(x0, y0, x1, y1) { return (x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0); }

// C ref: youprop.h Sleep_resistance — intrinsic/extrinsic sleep immunity.  The
// contest Healer has none; kept as a helper so the WAN_SLEEP branch mirrors C.
export function Sleep_resistance() { return (game.u?.uprops?.SleepResistance || 0) > 0; }

// C ref: timeout.c fall_asleep(how_long, wakeup_msg) — the hero collapses
// helpless for |how_long| turns (how_long < 0).  nomul(how_long) sets the
// negative multi the moveloop counts back up; u.usleep marks the hero Unaware
// (gethungry then burns nutrition at 1/10 via rn2(10)); nomovemsg is announced
// by unmul() when the countdown reaches 0.  The disabled Hear_again block and
// stop_occupation() draw no RNG (no occupation is active on the zap path).
export function fall_asleep(how_long, wakeup_msg) {
    if ((game.multi ?? 0) < how_long) return;   // nomul(how_long)
    game.multi = how_long;
    if (game.context)
        game.context.travel = game.context.travel1 = game.context.mv = 0;
    game.multi_reason = 'sleeping';
    if (game.u) game.u.usleep = game.moves ?? 1;
    game.nomovemsg = wakeup_msg ? 'You wake up.' : 'You can move again.';
}

// C ref: end.c done(DIED) / really_done(DIED), reached from zapyourself()'s
// urgent_pline("You die.").  At entry the "You die." topline is pending
// (NEED_MORE) and the hero's HP is still positive.  C's done() forces a status
// update (bot(), end.c:1046) BEFORE zeroing HP (end.c:1077, with only a deferred
// disp.botl refresh), so the "You die." --More-- frame keeps the old HP and only
// the "Die?" prompt shows HP 0.  Our status line is rebuilt live from u.uhp each
// frame, so we reproduce the same three frames by paging "You die." while HP is
// still positive, THEN zeroing HP, THEN showing the "Die?" query.
async function done_selfzap(how) {
    const DIED_HOW = 0, GENOCIDED = 10; // end.h death codes
    const u = game.u;

    // Page the pending "You die." line (--More--) with HP still positive.
    await topl_more();

    // done(): how < PANICKED forces HP to zero (deferred status refresh).
    u.uhp = 0;
    if (u.mh != null) u.mh = 0;

    // explore/wizard modes offer "keep playing?" — paranoid_query(ParanoidDie).
    const wizard = !!game.flags?.debug;
    const discover = !!(game.flags?.explore || game.flags?.discover
                        || game.flags?.playmode === 'explore');
    if (wizard || discover) {
        const ans = await y_n('Die?', 'yn\x1b', 'n');
        if (ans !== 'y') {
            // C ref: end.c done():1113-1116 — pline("OK, so you don't die.")
            // then savelife(how).  Declining the query used to leave the
            // message pending and RETURN WITHOUT savelife(), so the hero kept
            // uhp 0 (which then rolled regen_hp's rn2(100) every later turn)
            // and never got nomovemsg/multi = -1.  update_topl so the caller's
            // next message ("You are blinded by the flash!") lands on the same
            // topline, exactly as C's two consecutive plines do.
            await update_topl("OK, so you don't die.");
            const { savelife } = await import('./end.js');
            savelife(how);
            return;
        }
    }

    // really_done(how): bones_ok = (how < GENOCIDED) && can_make_bones()
    // (end.c:1201).  can_make_bones() draws rn2(1 + (depth>>2)) and, in wizard
    // mode, returns TRUE (bones.c:355).  really_done then, in wizard mode,
    //   if (!wizard || paranoid_query(ParanoidBones, "Save bones?"))
    //       savebones(how, endtime, corpse);                          (end.c:1362)
    // savebones() rewrites the death level into a legacy/bones level (drop the
    // hero's inventory onto the floor, raise a ghost, wipe remembered display)
    // and stashes it in the shared storage handle for a later segment's
    // getbones() to reload — this is exactly seed5006 seg0's Dlvl:3 death whose
    // bones seg1's ^V-to-3 loads.
    if (how < GENOCIDED && can_make_bones()) {
        const bones_wiz = !!game.flags?.debug;
        const bones_ans = bones_wiz ? await y_n('Save bones?', 'yn\x1b', 'n') : 'y';
        if (!bones_wiz || bones_ans === 'y') {
            // C ref: end.c really_done() — "grave creation should be after
            // disclosure" block, gated on the same bones_ok as savebones():
            // u.ugrave_arise == NON_PM (the ordinary case; an "arise as a
            // monster"/statue death is not modelled here) leaves a named
            // corpse of the hero's race at the death spot via
            // mk_named_object(CORPSE, ...) before savebones() runs.  Its own
            // mksobj() rolls (next_ident/gender/timer) never reach a scored
            // screen (each session segment reseeds independently — see the
            // savebones() call below); what *is* observable is that the
            // corpse joins the level's floor object list and is carried into
            // the bones file, so the next segment's getbones()/restobjchn()
            // re-stamps it too.
            if (!game._death_corpse) {
                const x = game.u?.ux ?? 0, y = game.u?.uy ?? 0;
                game._death_corpse =
                    mkcorpstat(CORPSE, null, game.u?.umonnum, x, y, CORPSTAT_INIT);
            }
            const { savebones } = await import('./bones.js');
            await savebones(how, game._death_corpse || null);
        }
    }

    // C ref: end.c really_done() — the endgame disclosure/tombstone/topten
    // teardown.  outrip_and_score() renders the tombstone, the tty window
    // --More-- acknowledgements, and the wizard-mode topten line, driving
    // nhgetch() at each boundary (the last read ends the segment).
    const { outrip_and_score } = await import('./end.js');
    await outrip_and_score(how);
}

// C ref: zap.c dozap — the 'z' command.  Pick a wand, then apply it.  Directionless
// wands go straight to weffects(); directional (IMMEDIATE) wands prompt getdir()
// first, then weffects() runs bhit() along the chosen direction.
export async function dozap() {
    // C ref: zap.c dozap():6 — nohands(gy.youmonst.data).  This read
    // `game.u.nohands`, a field nothing ever sets, so the check was dead: a
    // hero polymorphed into a handless form could still zap wands.
    // The Upolyd guard is load-bearing: this port stores the ROLE INDEX in
    // u.umonnum (u_init.js:1334), not C's gu.urole.mnum, so set_uasmon()
    // leaves u.data pointing at an unrelated mons[] row while unpolymorphed
    // (a Wizard reads as mons[12], the jackal).  Every player monster is
    // M1_HUMANOID, so C's answer for an unpolymorphed hero is always FALSE.
    if (game.u?.Upolyd && nohands(game.u?.data)) {
        await pline("You aren't able to zap anything in your current form.");
        return ECMD_OK;
    }
    // C ref: hack.c check_capacity(NULL) — Overtaxed (>= EXT_ENCUMBER) aborts
    // the command before getobj(), so no wand is picked, no charge is spent and
    // no turn is consumed.  Omitting it let an overloaded hero zap.
    if (near_capacity() >= EXT_ENCUMBER) {
        await pline("You can't do that while carrying so much stuff.");
        return ECMD_OK;
    }

    const obj = await getobj('zap', zap_ok, GETOBJ_NOFLAGS);
    if (!obj)
        return ECMD_CANCEL;

    const need_dir = objects[obj.otyp]?.dir !== NODIR;
    const u = game.u;
    let dir = null;
    if (need_dir) {
        // C ref: dozap() — getdir() is evaluated as part of the if-chain BEFORE
        // zappable()'s charge is checked only in the !need_dir branch order; but
        // C evaluates !zappable(obj) first.  Match C's short-circuit ordering:
        // zappable (charge), then cursed-backfire, then getdir.
    }
    if (!zappable(obj)) {
        await pline('Nothing happens.');
    } else if (obj.cursed && !rn2(WAND_BACKFIRE_CHANCE)) {
        await backfire(obj); /* the wand blows up in your face! */
        exercise(A_STR, false);
        // 'obj' is gone (useupall); skip the trailing spe<0 check.
        return ECMD_TIME;
    } else if (need_dir && !(dir = await zap_getdir())) {
        // getdir() returned cancel (no valid direction).  C prints the line
        // unless the hero is blind; the message was omitted entirely, so the
        // frame after a cancelled direction prompt was blank where C's is not.
        if (!Blind()) await pline(`The ${xname(obj)} glows and fades.`);
        /* make him pay for knowing !NODIR */
    } else if (need_dir && !u.dx && !u.dy && !u.dz) {
        // C ref: dozap() — getdir() returned self (dx=dy=dz=0), so the wand's
        // effect lands on the hero.  zapyourself() returns the physical damage to
        // charge via losehp(); WAN_DEATH runs done(DIED) itself and returns 0.
        const damage = await zapyourself(obj, true);
        if (damage) {
            // C: losehp(Maybe_Half_Phys(damage), "zapped ...self with ...") — not
            // reached for the ported WAN_DEATH case (done() ended the game first).
            await losehp(damage, 'zapped himself with a wand');
        }
    } else {
        game.current_wand = obj;
        await weffects(obj);
        game.current_wand = 0;
    }
    if (obj && obj.spe < 0) {
        await pline('It turns to dust.');
        useupall(obj);
    }
    return ECMD_TIME;
}

// ===========================================================================
// zap.c completeness ports.  INERT: nothing above this banner calls into this
// block.  These are the zap.c routines whose call sites (undead turning,
// cancellation, corpse revival, ice melting, riding, wish assistance) are not
// wired up in this port yet.
//
// Cross-module helpers arrive through `await import()`, the convention the rest
// of this file already uses (create_critters, create_polymon, zap_updown,
// zap_map, done_selfzap): zap.js is imported by artifact.js/cmd.js/monmove.js
// and a new top-level edge would reorder module evaluation.  That is why
// several C-void / C-boolean routines below are `async`.
// ===========================================================================

// C ref: obj.h enum obj_where.  NOT imported from js/const.js: that file's
// OBJ_* are the C integers, but this port stores obj.where as a STRING
// (js/invent.js:273-276), so the numeric enum never compares equal.
const OBJ_FREE = 'free', OBJ_FLOOR = 'floor', OBJ_CONTAINED = 'contained',
      OBJ_INVENT = 'invent', OBJ_MINVENT = 'minvent', OBJ_BURIED = 'buried';

// C ref: hack.h:283 enum cost_alteration_types.
const COST_CANCEL = 0, COST_DRAIN = 1, COST_UNBLSS = 3, COST_UNCURS = 4;

// C ref: artifact.c:154 otyp_by_name() — resolve an objects.h otyp against
// mkobj.js's objects[] instead of hardcoding a table index.  The table stores
// C's bare oc_name, so "cancellation" is both SPE_ and WAN_ and "blank paper"
// both SCR_ and SPE_; oclass disambiguates.  (mkobj.js does not import zap.js,
// so `objects` is fully built before this module body runs.)
function otyp_by_name(nm, oclass) {
    return objects.findIndex((o) => o && o.name === nm
                                    && (oclass === undefined || o.oclass === oclass));
}
// Only the otyps the block below needs that are NOT already declared near the
// top of this file (WAN_*/SPE_*/ROCK/UNICORN_HORN/TIN/MAGIC_LAMP live there).
const RIN_ADORNMENT = otyp_by_name('adornment', RING_CLASS),
      RIN_GAIN_STRENGTH = otyp_by_name('gain strength', RING_CLASS),
      RIN_GAIN_CONSTITUTION = otyp_by_name('gain constitution', RING_CLASS),
      RIN_INCREASE_ACCURACY = otyp_by_name('increase accuracy', RING_CLASS),
      RIN_INCREASE_DAMAGE = otyp_by_name('increase damage', RING_CLASS),
      RIN_PROTECTION = otyp_by_name('protection', RING_CLASS),
      GAUNTLETS_OF_DEXTERITY = otyp_by_name('gauntlets of dexterity', ARMOR_CLASS),
      HELM_OF_BRILLIANCE = otyp_by_name('helm of brilliance', ARMOR_CLASS),
      DWARVISH_CLOAK = otyp_by_name('dwarvish cloak', ARMOR_CLASS),
      CRYSTAL_BALL = otyp_by_name('crystal ball', TOOL_CLASS),
      BAG_OF_HOLDING = otyp_by_name('bag of holding', TOOL_CLASS),
      LARGE_BOX = otyp_by_name('large box', TOOL_CLASS),
      CHEST = otyp_by_name('chest', TOOL_CLASS),
      ICE_BOX = otyp_by_name('ice box', TOOL_CLASS),
      FIGURINE = otyp_by_name('figurine', TOOL_CLASS),
      SCR_BLANK_PAPER = otyp_by_name('blank paper', SCROLL_CLASS),
      SPE_BLANK_PAPER = otyp_by_name('blank paper', SPBOOK_CLASS),
      SPE_NOVEL = otyp_by_name('novel', SPBOOK_CLASS),
      SPE_CURE_SICKNESS = otyp_by_name('cure sickness', SPBOOK_CLASS),
      POT_ACID = otyp_by_name('acid', POTION_CLASS),
      POT_SICKNESS = otyp_by_name('sickness', POTION_CLASS),
      POT_SEE_INVISIBLE = otyp_by_name('see invisible', POTION_CLASS),
      POT_FRUIT_JUICE = otyp_by_name('fruit juice', POTION_CLASS),
      EGG = otyp_by_name('egg', FOOD_CLASS),
      BOULDER = otyp_by_name('boulder', ROCK_CLASS),
      STATUE = otyp_by_name('statue', ROCK_CLASS),
      MEATBALL = otyp_by_name('meatball', FOOD_CLASS),
      MEAT_RING = otyp_by_name('meat ring', FOOD_CLASS),
      MEAT_STICK = otyp_by_name('meat stick', FOOD_CLASS),
      ENORMOUS_MEATBALL = otyp_by_name('enormous meatball', FOOD_CLASS);

// C ref: monsym.h MONSYM indices (js/symbols.js).  This port stores
// permonst.mlet as the DISPLAY CHARACTER, so C's `ptr->mlet == S_foo` tests
// have to read .mcls (the convention find_mac()/is_demon_mdat() already use).
// (S_GOLEM_Z is already declared above, for nonliving_zap().)
const S_TROLL_Z = 46, S_ZOMBIE_Z = 52, S_EEL_Z = 57;
// C ref: monflag.h G_UNIQ / G_NOCORPSE (js/const.js exports neither).
const G_NOCORPSE_Z = 0x0010, G_UNIQ_Z = 0x1000;
// C ref: objects.h BITS() cont/chg fields, packed into mkobj.js's `flags` word
// (mkobj.js:167 F_CHARGED, :170 F_CONTAINER).
const OC_CHARGED_Z = 1, F_CONTAINER_Z = 8;
// (objclass.h MINERAL / GEMSTONE come from the MAT_* block above.)

// C ref: generated pm.h PM_* — resolved by name through makemon.js's
// name_to_pmidx(), memoized the way mkobj.js:209 PM() does.
const _pmidx_by_name = new Map();
async function PM_(name) {
    if (!_pmidx_by_name.has(name)) {
        const { name_to_pmidx } = await import('./makemon.js');
        _pmidx_by_name.set(name, name_to_pmidx(name));
    }
    return _pmidx_by_name.get(name);
}
// C ref: mons[idx] — makemon.js's MONS table.
async function mons_(idx) {
    const { monster_by_pmidx } = await import('./makemon.js');
    return monster_by_pmidx(idx);
}
// C ref: youmonst.data — mons[u.umonster] (the hero's RACE monster) while
// unpolymorphed, mons[u.umonnum] while Upolyd.  Load-bearing: this port keeps
// the ROLE INDEX in u.umonnum, so u.data points at an unrelated mons[] row and
// every u.data predicate lies unless Upolyd (a Wizard reads as the jackal).
async function youmonst_data_z() {
    const u = game.u;
    if (u?.Upolyd) return u.data;
    const mnum = game.urace?.mnum;
    return (mnum != null) ? await mons_(mnum) : null;
}

// C ref: mondata.h:170 is_reviver(ptr) = is_rider(ptr) || mlet == S_TROLL.
function is_reviver(ptr) {
    return !!ptr && (is_rider_pm(ptr.pmidx) || ptr.mcls === S_TROLL_Z);
}
// C ref: mondata.h:108 is_golem(ptr) = (mlet == S_GOLEM).
function is_golem_z(ptr) { return !!ptr && ptr.mcls === S_GOLEM_Z; }
// C ref: mondata.h:174 unique_corpstat(ptr) = (geno & G_UNIQ).
function unique_corpstat(ptr) { return ((ptr?.geno ?? 0) & G_UNIQ_Z) !== 0; }
// C ref: mondata.h:90 carnivorous(ptr) = (mflags1 & M1_CARNIVORE).  makemon.js
// pre-decodes that bit into the MONS row's `carnivore` field.
function carnivorous_z(ptr) { return !!ptr?.carnivore; }
// C ref: mondata.c:654 sticks(ptr).
function sticks(ptr) {
    return !!(dmgtype(ptr, AD_STCK)
              || (dmgtype(ptr, AD_WRAP) && !attacktype(ptr, AT_ENGL))
              || attacktype(ptr, AT_HUGS));
}
// C ref: mondata.h:71 digests(ptr) = dmgtype_fromattack(ptr, AD_DGST, AT_ENGL).
// attacktype_fordmg() is this port's spelling of the same (atyp, adtyp) scan
// (js/uhitm.js:2376 makes the identical substitution).
function digests(ptr) { return !!attacktype_fordmg(ptr, AT_ENGL, AD_DGST); }

// C ref: hacklib.c upstart/an/An/plur.
function upstart(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function an_z(s) { return /^[aeiouAEIOU]/.test(s || '') ? `an ${s}` : `a ${s}`; }
function An_z(s) { return upstart(an_z(s)); }
function plur_z(n) { return Number(n) === 1 ? '' : 's'; }

// C ref: invent.c carried(obj) = (obj->where == OBJ_INVENT).
function carried_z(obj) { return obj?.where === OBJ_INVENT; }
// C ref: shk.c shk_your(buf, obj) / Shk_Your(buf, obj) — "your "/"the "/
// "<mon>'s "/"<Shk>'s ", always with a trailing space.  js/wield.js:109 keeps
// the same two-case reduction privately; the shop/monster ownership arms need
// shk.c's in_rooms + shop_keeper and are left to that file's owner.
function shk_your_z(obj) { return carried_z(obj) ? 'your ' : 'the '; }
function Shk_Your_z(obj) { return upstart(shk_your_z(obj)); }

// C ref: objnam.c corpse_xname(obj, adjective, cxn_flags).  js/invent.js:654
// keeps a private reduction of the same routine; this covers the
// CXN_NO_PFX / CXN_PFX_THE distinctions the revive()/unturn_dead() messages make.
function corpse_xname_z(obj, adjective, cxn_flags) {
    let nm = xname(obj) || 'corpse';
    if (adjective) nm = `${adjective} ${nm}`;
    if (cxn_flags & CXN_PFX_THE) nm = `the ${nm}`;
    return nm;
}
// C ref: objnam.c simpleonames(obj) — no quantity, no bless/curse, no
// enchantment.  js/invent.js:513 owns the full version privately.
function simpleonames_z(obj) { return obj ? xname(obj) : ''; }

// C ref: mkobj.c:752 costly_alteration(obj, alter_type) — bills the shopkeeper
// for a modification.  Draws NO RNG (checked against mkobj.c); js/trap.js:829
// keeps the identical no-op under this name.  The "You damage it, you pay for
// it!" pline and the bknown side effect belong to shk.c's owner.
function costly_alteration_z(_obj, _alter_type) { /* no RNG */ }
// C ref: shk.c stolen_value(obj, x, y, peaceful, silent) — unported
// (js/invent.js:1161 is the same private stub).  Returns the billed amount.
function stolen_value_z(_obj, _x, _y, _peaceful, _silent) { return 0; }
// C ref: display.c shieldeff(x, y) — the resistance sparkle.  No RNG.
function shieldeff_z(_x, _y) { /* display only */ }
// C ref: worn.c:1119 bypass_obj(obj).
function bypass_obj_z(obj) {
    if (!obj) return;
    obj.bypass = 1;
    if (game.context) game.context.bypasses = true;
}
// C ref: attrib.h ABON(x) = u.abon.a[x]; cancel_item()/drain_item() are the
// only reason this file needs a writer for it.
function ABON_add_z(i, delta) {
    const u = game.u;
    if (!u) return;
    u.abon = u.abon || { a: [0, 0, 0, 0, 0, 0] };
    u.abon.a[i] = (u.abon.a[i] | 0) + delta;
}
// C ref: disp.botl = TRUE — request a status-line refresh.
function disp_botl_z() {
    if (game.disp) game.disp.botl = true;
    if (game.context) game.context.botl = true;
}
// C ref: hack.h obj_to_any(obj) — the `anything` union timeout.c keys timers on
// (js/timeout.js:554 keeps the same two-field shape privately).
function obj_to_any_z(obj) { return { a_void: obj, a_obj: obj }; }
// C ref: youprop.h Underwater.
function Underwater_z() { return !!game.u?.uinwater; }
// C ref: hack.h distu(x, y) = dist2(x, y, u.ux, u.uy).
function distu_z(x, y) { return dist2(x, y, game.u?.ux ?? 0, game.u?.uy ?? 0); }
// C ref: youprop.h Role_if(pm) = (gu.urole.mnum == pm).  This port keeps the
// role's mons index on game.urole.mnum (js/do_wear.js:222 does the same).
function Role_if_z(pm) { return (game.urole?.mnum ?? -1) === pm; }
// C ref: obj.h Is_container(o) — the four bags plus box/chest/ice box.
// js/invent.js:378 owns the private port; reading mkobj.js's F_CONTAINER flag
// (objects.h BITS() cont field) keeps this from drifting out of sync.
function Is_container_z(o) { return !!(objects[o?.otyp]?.flags & F_CONTAINER_Z); }
// C ref: obj.h Is_box(o) = (otyp == LARGE_BOX || otyp == CHEST || otyp == ICE_BOX).
function Is_box_z(o) {
    return o?.otyp === LARGE_BOX || o?.otyp === CHEST || o?.otyp === ICE_BOX;
}
// C ref: obj.h SchroedingersBox(o) = (otyp == LARGE_BOX && spe == 1).
function SchroedingersBox_z(o) { return o?.otyp === LARGE_BOX && o?.spe === 1; }
// Walk a C nobj chain; accepts an already-flat array unchanged.
function chain_of_z(head) {
    if (Array.isArray(head)) return head;
    const out = [];
    for (let o = head; o; o = o.nobj) out.push(o);
    return out;
}

// C ref: zap.c:654 get_obj_location(obj, &x, &y, locflags).  js/light.js:170
// holds a byte-for-byte twin of this switch but does not export it; when it
// does, this copy should go away.
function get_obj_location_z(obj, locflags) {
    if (!obj) return null;
    switch (obj.where) {
    case OBJ_INVENT:
        return { x: game.u?.ux, y: game.u?.uy };
    case OBJ_FLOOR:
        return { x: obj.ox, y: obj.oy };
    case OBJ_MINVENT:
        if (obj.ocarry?.mx)
            return { x: obj.ocarry.mx, y: obj.ocarry.my };
        break; /* !mx => migrating monster */
    case OBJ_BURIED:
        if (locflags & BURIED_TOO) return { x: obj.ox, y: obj.oy };
        break;
    case OBJ_CONTAINED:
        if (locflags & CONTAINED_TOO)
            return get_obj_location_z(obj.ocontainer, locflags);
        break;
    default:
        break;
    }
    return null;
}

// C ref: rm.h MON_AT(x, y) — a monster here that is not buried.
function MON_AT_z(x, y) {
    const m = m_at(x, y);
    return !!m && !m.mburied && !DEADMONSTER(m);
}

// C ref: teleport.c collect_coords(candy, cx, cy, maxradius, ...) — candidates
// in expanding rings, each ring shuffled with rn2 in the C engine's order.
// js/do.js:279 and js/dog.js:  both keep private copies; the shuffle is the
// RNG-visible part, so this mirrors do.js exactly rather than approximating it.
function collect_coords_z(cx, cy, maxradius) {
    const out = [];
    const rowrange = (cy < ROWNO / 2) ? (ROWNO - 1 - cy) : cy;
    const colrange = (cx < COLNO / 2) ? (COLNO - 1 - cx) : cx;
    const kmax = Math.max(rowrange, colrange);
    maxradius = maxradius ? Math.min(maxradius, kmax) : kmax;

    for (let radius = 1; radius <= maxradius; radius++) {
        const ringStart = out.length;
        const lox = cx - radius, hix = cx + radius;
        const loy = cy - radius, hiy = cy + radius;
        for (let y = Math.max(loy, 0); y <= hiy; y++) {
            if (y > ROWNO - 1) break;
            for (let x = Math.max(lox, 1); x <= hix; x++) {
                if (x > COLNO - 1) break;
                if (x !== lox && x !== hix && y !== loy && y !== hiy) continue;
                out.push({ x, y });
            }
        }
        let n = out.length - ringStart;
        let base = ringStart;
        while (n > 1) {
            const kk = rn2(n);
            if (kk) {
                const tmp = out[base];
                out[base] = out[base + kk];
                out[base + kk] = tmp;
            }
            base++;
            n--;
        }
    }
    return out;
}
// C ref: teleport.c:219 enexto_core(cc, xx, yy, mdat, entflags) — near-ring
// candidates first, then the whole map minus the already-rejected prefix.
// enexto() never passes GP_ALLOW_XY, so C's trailing <xx,yy> retry is dead here.
async function enexto_core_z(xx, yy, mdat, entflags) {
    const { goodpos } = await import('./teleport.js');
    const fakemon = { data: mdat };          /* cg.zeromonst + set_mon_data */
    const near = collect_coords_z(xx, yy, 3);
    for (const c of near)
        if (goodpos(c.x, c.y, fakemon, entflags)) return c;
    const all = collect_coords_z(xx, yy, 0);
    for (let i = near.length; i < all.length; i++)
        if (goodpos(all[i].x, all[i].y, fakemon, entflags)) return all[i];
    return null;
}
// C ref: teleport.c:196 enexto(cc, xx, yy, mdat).
async function enexto_z(xx, yy, mdat) {
    const { GP_CHECKSCARY } = await import('./teleport.js');
    return (await enexto_core_z(xx, yy, mdat, GP_CHECKSCARY))
        || (await enexto_core_z(xx, yy, mdat, 0 /* NO_MM_FLAGS */));
}

// C ref: mon.c add_to_minv(mon, obj) — js/vault.js:184 keeps a private copy.
function add_to_minv_z(mon, obj) {
    if (!mon || !obj) return;
    if (!Array.isArray(mon.minvent)) mon.minvent = [];
    mon.minvent.push(obj);
    obj.where = OBJ_MINVENT;
    obj.ocarry = mon;
    obj.ocontainer = null;
}
// C ref: mon.c mongone(mdef) — the monster is gone without dying (no corpse,
// no experience, no bones).  js/muse.js:672 and js/vault.js:228 both keep
// private copies; neither is exported.
function mongone_z(mdef) {
    if (!mdef) return;
    mdef.mhp = 0;
    mdef.mgone = true;
    const list = game.level?.monsters;
    if (Array.isArray(list)) {
        const i = list.indexOf(mdef);
        if (i >= 0) list.splice(i, 1);
    }
    newsym(mdef.mx, mdef.my);
}
// C ref: eat.c eaten_stat(base, obj) — scale `base` by the fraction of the
// item's nutrition still left, never below 1.  js/mkobj.js:987 owns the full
// version (it needs mon_cnutrit/food_nutrit, both private there); without
// those tables the ratio cannot be formed, so the reduction is SKIPPED rather
// than guessed.  No RNG either way.
function eaten_stat_z(base, obj) {
    if (!(obj?.oeaten | 0)) return base;
    return base;
}
// C ref: dog.c:1292 wary_dog(mtmp, was_dead) — a revived pet becomes wary and
// its edog timers reset.  Unported (dog.c's edog allocation).  No RNG.
function wary_dog_z(_mtmp, _was_dead) { /* no RNG */ }
// C ref: mon.c seemimic(mtmp) — stop mimicking; display only, no RNG.
// js/apply.js:533 keeps a private async copy.
function seemimic_z(mtmp) {
    if (!mtmp) return;
    mtmp.m_ap_type = 0;
    mtmp.mappearance = 0;
    newsym(mtmp.mx, mtmp.my);
}
// C ref: trap.c trap_ice_effects(x, y, ice_is_melting) — unported anywhere.
async function trap_ice_effects_z(_x, _y, _ice_is_melting) { /* not ported */ }
// C ref: dbridge.c boulder_hits_pool(otmp, rx, ry, newspot) — unported
// anywhere.  Fills the pool / prints "You hear a splash"; draws no RNG.
async function boulder_hits_pool_z(_otmp, _rx, _ry, _newspot) { return false; }
// C ref: mon.c minliquid(mtmp) — js/mon.js:591 owns the real one but does not
// export it (js/dig.js:882 keeps a NOT-PORTED stub under the same name).
async function minliquid_z(_mtmp) { return false; }
// C ref: vision.h couldsee(x, y).
async function couldsee_z(x, y) {
    const { couldsee } = await import('./vision.js');
    return couldsee(x, y);
}
// C ref: zap.c:44 ZT_SPELL(x) == 10 + (x).
function ZT_SPELL_Z(x) { return 10 + x; }
// C ref: prop.h u.uprops[prop].extrinsic — this port keeps the mask map on
// u.uprops_extrinsic (js/artifact.js:2843 has the same private accessor).
function extrinsic_of_z(prop) {
    return (game.u?.uprops_extrinsic || {})[prop] || 0;
}
// C ref: hack.h PLNMSG_OBJ_GLOWS — the iflags.last_msg tag revive() sets and
// unturn_dead() reads back.  js/ has no plnmsg_types enum, so the tag is a
// string (its value is never compared against another module's).
const PLNMSG_OBJ_GLOWS_Z = 'PLNMSG_OBJ_GLOWS';
// C ref: timeout.h enum timeout_types — MELT_ICE_AWAY is one past SHRINK_GLOB.
// js/const.js exports the name as the STRING 'MELT_ICE_AWAY' (const.js:1998),
// which is the wrong vocabulary for timeout.js's numeric func_index; that file
// re-derives the number the same way at timeout.js:62.
const MELT_ICE_AWAY_Z = SHRINK_GLOB + 1;

// C ref: zap.c:1702 poly_obj(obj, id) for `id != STRANGE_OBJECT` — "literally
// replace obj with this new thing": mksobj(id, FALSE, FALSE) plus the
// set_corpsenm carryover, then the shared quantity/BUC/erosion tail.  This
// file's poly_obj() (js/zap.js:471) implements ONLY the STRANGE_OBJECT half and
// takes `can_merge` as its second parameter, so handing it an otyp would run
// the RANDOM-object path with can_merge set — a silent RNG fork.  Note that
// can_merge is FALSE on this branch, so the tail's rn2(1000) merge roll and the
// whole class-specific anti-polymorph-loop switch (TOOL/WAND/POTION/SPBOOK/GEM)
// are unreachable for stone_to_flesh's food/corpse targets.
async function poly_obj_id_z(obj, id) {
    const ox = obj.ox, oy = obj.oy;
    const obj_location = obj.where;
    const mk = await import('./mkobj.js');

    const otmp = mk.mksobj(id, false, false);
    /* USES_CORPSENM(typ) == (CORPSE || STATUE || FIGURINE) */
    const uses_corpsenm = (t) => (t === CORPSE || t === STATUE || t === FIGURINE);
    if (uses_corpsenm(obj.otyp) && uses_corpsenm(id))
        mk.set_corpsenm(otmp, obj.corpsenm);

    otmp.quan = obj.quan;                    /* preserve quantity */
    otmp.no_charge = obj.no_charge;          /* shopkeeper's (lack of) interest */
    if (obj_location === OBJ_INVENT)
        otmp.invlet = obj.invlet;
    /* C: charged_objs[] == { WAND_CLASS, WEAPON_CLASS, ARMOR_CLASS } */
    if (otmp.oclass === WAND_CLASS || otmp.oclass === WEAPON_CLASS
        || otmp.oclass === ARMOR_CLASS)
        otmp.spe = obj.spe;
    otmp.recharged = obj.recharged;
    otmp.cursed = obj.cursed;
    otmp.blessed = obj.blessed;
    /* C guards each field with is_flammable/is_rustprone/is_crackable (oeroded),
       is_corrodeable/is_rottable (oeroded2) and is_damageable (oerodeproof);
       only is_flammable_obj() of those is ported in this file, and
       erosion_matters_obj() is FALSE for every otyp stone_to_flesh_obj() passes
       here (food and corpses), so the sub-guards are unreachable today. */
    if (erosion_matters_obj(otmp)) {
        otmp.oeroded = obj.oeroded;
        otmp.oeroded2 = obj.oeroded2;
        otmp.oerodeproof = obj.oerodeproof;
    }
    /* Keep chest/box traps and poisoned ammo if we may */
    if (obj.otrapped && Is_box_z(otmp))
        otmp.otrapped = 1;
    otmp.owt = weight_of(otmp);              /* C: otmp->owt = weight(otmp) */

    /* replace old object with new in the same floor-chain position */
    const floorObjects = game.level?.objects;
    const floorIndex = floorObjects?.indexOf(obj) ?? -1;
    delobj(obj);
    place_object(otmp, ox, oy);
    if (floorIndex >= 0) {
        floorObjects.pop();
        floorObjects.splice(floorIndex, 0, otmp);
    }
    return otmp;
}

// ---------------------------------------------------------------------------

// C ref: zap.c:578 release_hold() — the hero is held/engulfed (or is holding a
// monster) and opening/unlocking magic has hit the holder.  The only RNG is
// unstuck()'s trailing mspec_used rnd(2).
export async function release_hold() {
    const u = game.u;
    const mtmp = u?.ustuck;

    if (!mtmp) {
        await impossible('release_hold when not held?');
    } else if (u.uswallow) { /* possible for sticky hero to be swallowed */
        if (digests(mtmp.data)) {
            if (!Blind())
                await pline(`${Monnam(mtmp)} opens its mouth!`);
            else
                await pline('You feel a sudden rush of air!');
        }
        /* gives "you get regurgitated" or "you get expelled from <mon>" */
        const { expels } = await import('./mhitu.js');
        await expels(mtmp, mtmp.data, true);
    } else if (sticks(await youmonst_data_z())) {
        /* order matters if 'holding' status condition is enabled;
           set_ustuck() will set flag for botl update, You() pline will
           trigger a status update with "UHold" removed */
        set_ustuck(null);
        await pline(`You release ${mon_nam(mtmp)}.`);
    } else { /* held but not swallowed */
        await unstuck_z(u.ustuck);
        const relbuf = !nohands(mtmp.data)
            ? `from ${s_suffix(mon_nam(mtmp))} grasp`
            : `by ${mon_nam(mtmp)}`;
        await pline(`You are released ${relbuf}.`);
    }
}

// C ref: mon.c:3438 unstuck(mtmp).  Not a zap.c routine, but release_hold()'s
// last arm is nothing but this call plus a message, and its trailing
// mspec_used rnd(2) is the only draw the whole path makes.
async function unstuck_z(mtmp) {
    const u = game.u;
    if (u?.ustuck !== mtmp) return;
    const ptr = mtmp.data;
    const swallowed = u.uswallow;

    /* do this first so that docrt()'s botl update is accurate; clears
       u.uswallow as well as setting u.ustuck to Null */
    set_ustuck(null);

    if (swallowed) {
        game.mswallower = null;
        u.ux = mtmp.mx;
        u.uy = mtmp.my;
        /* C: if (Punished && uchain->where != OBJ_FLOOR) placebc(); */
        game.vision_full_recalc = 1;
        await flush_screen();   /* C: docrt() */
    }

    /* prevent holder/engulfer from immediately re-holding/re-engulfing */
    if (!mtmp.mspec_used && (dmgtype(ptr, AD_STCK)
                             || attacktype(ptr, AT_ENGL)
                             || attacktype(ptr, AT_HUGS)))
        mtmp.mspec_used = rnd(2);
}

// C ref: zap.c:612 probe_objchain(otmp) — the wand of probing marks a whole
// inventory chain "seen".  No RNG.
export function probe_objchain(otmp) {
    for (const o of chain_of_z(otmp)) {
        observe_object(o); /* treat as "seen" */
        if (Is_container_z(o) || o.otyp === STATUE) {
            o.lknown = 1;
            if (!SchroedingersBox_z(o))
                o.cknown = 1;
        } else if (o.otyp === TIN) {
            o.known = 1;
        }
    }
}

// C ref: zap.c:713 montraits(obj, cc, adjacentok) — rebuild the monster whose
// traits were saved on `obj` (a corpse or statue).  RNG, in order: makemon(),
// then the level-restore loop's rnd(mlevel + 1) plus one monhp_per_lvl() rnd(8)
// per level regained.
export async function montraits(obj, cc, adjacentok) {
    let mtmp = null;
    const mtmp2 = has_omonst(obj) ? get_mtraits(obj, true) : null;

    if (mtmp2) {
        const { makemon } = await import('./makemon.js');
        /* save_mtraits() validated mtmp2->mnum */
        mtmp2.data = await mons_(mtmp2.mnum);

        if (mtmp2.mhpmax > 0 || is_rider_pm(mtmp2.data?.pmidx)) {
            mtmp = makemon(mtmp2.data, cc.x, cc.y,
                           (NO_MINVENT | MM_NOWAIT | MM_NOCOUNTBIRTH
                            /* in case mtmp2 is a long worm; saved traits don't
                               include tail segments so don't give mtmp any */
                            | MM_NOTAIL | MM_NOMSG
                            | (adjacentok ? MM_ADJACENTOK : 0)));
        }
        if (!mtmp) {
            /* mtmp2 is a copy of obj's oextra->omonst extension and is not on
               the map or on any monst lists */
            dealloc_monst(mtmp2);
            return null;
        }

        /* heal the monster; give a chance to restore some levels so that
           trolls and Riders can't be drained to level 0 and then trivially
           killed repeatedly */
        if ((mtmp.m_lev | 0) < mtmp.data.mlevel) {
            const ltmp = rnd(mtmp.data.mlevel + 1);

            if (ltmp > (mtmp.m_lev | 0)) {
                while ((mtmp.m_lev | 0) < ltmp) {
                    mtmp.m_lev++;
                    mtmp.mhpmax += monhp_per_lvl(mtmp);
                }
                mtmp2.m_lev = mtmp.m_lev;
            }
        }
        if (mtmp.mhpmax > mtmp2.mhpmax) /* &&is_rider(mtmp2->data)*/
            mtmp2.mhpmax = mtmp.mhpmax;
        mtmp2.mhp = mtmp2.mhpmax;
        /* Get these ones from mtmp */
        mtmp2.minvent = mtmp.minvent; /*redundant*/
        /* monster ID is zero if the corpse came from a bones level */
        if (mtmp.m_id) {
            mtmp2.m_id = mtmp.m_id;
            /* might be bringing quest leader back to life */
            const qs = game.quest_status;
            if (qs?.leader_is_dead && mtmp2.m_id === qs.leader_m_id)
                qs.leader_is_dead = false;
        }
        mtmp2.mx = mtmp.mx;
        mtmp2.my = mtmp.my;
        mtmp2.mux = mtmp.mux;
        mtmp2.muy = mtmp.muy;
        mtmp2.mw = mtmp.mw;
        mtmp2.wormno = mtmp.wormno;
        mtmp2.misc_worn_check = mtmp.misc_worn_check;
        mtmp2.weapon_check = mtmp.weapon_check;
        mtmp2.mtrapseen = mtmp.mtrapseen;
        mtmp2.mflee = mtmp.mflee;
        mtmp2.mburied = mtmp.mburied;
        mtmp2.mundetected = mtmp.mundetected;
        mtmp2.mfleetim = mtmp.mfleetim;
        mtmp2.mlstmv = mtmp.mlstmv;
        mtmp2.m_ap_type = mtmp.m_ap_type;
        /* set these ones explicitly */
        mtmp2.mrevived = 1;
        mtmp2.mavenge = 0;
        mtmp2.meating = 0;
        mtmp2.mleashed = 0;
        mtmp2.mtrapped = 0;
        mtmp2.msleeping = 0;
        mtmp2.mfrozen = 0;
        mtmp2.mcanmove = 1;
        /* most cancelled monsters return to normal, but some stay cancelled.
           C ref: SYSOPT_SEDUCE == sysopt.seduce, a sysconf setting; this port
           has no sysopt struct, so an absent game.sysopt reads as "off", which
           is dat/sysconf's own default. */
        if (!dmgtype(mtmp2.data, AD_SEDU)
            && (!game.sysopt?.seduce || !dmgtype(mtmp2.data, AD_SSEX)))
            mtmp2.mcan = 0;
        mtmp2.mcansee = 1; /* set like in makemon */
        mtmp2.mblinded = 0;
        mtmp2.mstun = 0;
        mtmp2.mconf = 0;
        /* when traits are for a shopkeeper, dummy monster 'mtmp' won't have
           the eshk data replmon() -> replshk() needs.  C: neweshk(mtmp) then
           *ESHK(mtmp) = *ESHK(mtmp2); shknam.c:557 neweshk() is the mextra
           allocator, unported under that name. */
        if (mtmp2.isshk) {
            mtmp.mextra = mtmp.mextra || {};
            mtmp.mextra.eshk = { ...(ESHK(mtmp2) || {}) };
            mtmp.isshk = 1;
        }
        await replmon(mtmp, mtmp2);
        newsym(mtmp2.mx, mtmp2.my); /* Might now be invisible */

        /* in case Protection_from_shape_changers is different now than it was
           when the traits were stored */
        await restore_cham(mtmp2);
    }
    return mtmp2;
}

// C ref: zap.c:841 get_container_location(obj, &loc, &container_nesting) —
// walk out to the OUTERMOST container and report where that one is.  `out`
// carries C's two out-params; the return value is the carrying monster (or
// null).  No RNG.
export function get_container_location(obj, out) {
    if (out && out.container_nesting !== undefined)
        out.container_nesting = 0;
    while (obj && obj.where === OBJ_CONTAINED) {
        if (out && out.container_nesting !== undefined)
            out.container_nesting += 1;
        obj = obj.ocontainer;
    }
    if (obj) {
        if (out) out.loc = obj.where; /* outermost container's location */
        if (obj.where === OBJ_MINVENT)
            return obj.ocarry;
    }
    return null;
}

// C ref: zap.c:863 zombie_can_dig(x, y) — can a zombie dig its way out here?
// No RNG; async only because t_at() lives in trap.js.
export async function zombie_can_dig(x, y) {
    if (isok(x, y)) {
        const typ = game.level?.at(x, y)?.typ;
        const { t_at } = await import('./trap.js');

        if (t_at(x, y))
            return false;
        if (typ === ROOM || typ === CORR || typ === GRAVE)
            return true;
    }
    return false;
}

// C ref: read.c:3112 cant_revive(&mtype, revival, from_obj) — creatures whose
// mextra only makes sense in place come back as something else.  No RNG.
// `mt` is C's int* out-param: { mtype }.
async function cant_revive_z(mt, revival, from_obj) {
    /* C's PM_HIGH_CLERIC / PM_ALIGNED_CLERIC are mons[] rows named
       "high cleric" / "aligned cleric" (monsters.h), not "priest". */
    const guard = await PM_('guard'), shk = await PM_('shopkeeper'),
          highcleric = await PM_('high cleric'),
          alignedcleric = await PM_('aligned cleric'),
          angel = await PM_('Angel'), humanzombie = await PM_('human zombie'),
          longwormtail = await PM_('long worm tail'),
          longworm = await PM_('long worm'),
          doppelganger = await PM_('doppelganger');

    /* SHOPKEEPERS can be revived now */
    if (mt.mtype === guard || (mt.mtype === shk && !revival)
        || mt.mtype === highcleric || mt.mtype === alignedcleric
        || mt.mtype === angel) {
        mt.mtype = humanzombie;
        return true;
    } else if (mt.mtype === longwormtail) { /* for create_particular() */
        mt.mtype = longworm;
        return true;
    } else if (unique_corpstat(await mons_(mt.mtype))
               && (!from_obj || !has_omonst(from_obj))) {
        /* unique corpses (from bones or wizard mode wish) or statues (bones or
           any wish) end up as shapechangers */
        mt.mtype = doppelganger;
        return true;
    }
    return false;
}

// C ref: zap.c:884 revive(corpse, by_hero) — revive ONE corpse out of a
// (possibly stacked) pile; returns the revived monster or null.  Does NOT use
// up the corpse when it fails.  RNG, in order: the BAG_OF_HOLDING rn2(40) gate,
// enexto() when the spot is occupied, makemon()/montraits(), splitobj(), and
// tamedog() for a tame ghost.
export async function revive(corpse, by_hero) {
    let mtmp = null;
    let container = null;
    let x = 0, y = 0;
    let mmflags = NO_MINVENT | MM_NOWAIT | MM_NOMSG;
    const nesting = { loc: OBJ_FREE, container_nesting: 0 };

    if (corpse.otyp !== CORPSE) {
        await impossible(`Attempting to revive ${xname(corpse)}?`);
        return null;
    }
    let montype = corpse.corpsenm;
    let mptr = await mons_(montype);
    /* treat buried auto-reviver (troll, Rider?) like a zombie so that it can
       dig itself out of the ground if it revives */
    const is_zomb = mptr?.mcls === S_ZOMBIE_Z
                    || (corpse.where === OBJ_BURIED && is_reviver(mptr));

    /* if this corpse is being eaten, stop doing that; C does this before
       knowing whether makemon() will succeed, on purpose */
    const { cant_finish_meal } = await import('./eat.js');
    await cant_finish_meal(corpse);

    if (corpse.where !== OBJ_CONTAINED) {
        const locflags = is_zomb ? BURIED_TOO : 0;

        /* only for invent, minvent, or floor, or if zombie, buried */
        container = null;
        const loc = get_obj_location_z(corpse, locflags);
        if (loc) { x = loc.x; y = loc.y; }
    } else {
        /* deal with corpses in [possibly nested] containers */
        container = corpse.ocontainer;
        const carrier = get_container_location(container, nesting);
        switch (nesting.loc) {
        case OBJ_MINVENT:
            x = carrier.mx; y = carrier.my;
            break;
        case OBJ_INVENT:
            x = game.u.ux; y = game.u.uy;
            break;
        case OBJ_FLOOR: {
            const loc = get_obj_location_z(corpse, CONTAINED_TOO);
            if (loc) { x = loc.x; y = loc.y; }
            break;
        }
        default:
            break; /* x,y are 0 */
        }
    }
    if (x) { /* update corpse's location now that we're sure where it is */
        corpse.ox = x;
        corpse.oy = y;
    }

    if (!x
        /* Rules for revival from containers:
         *  - the container cannot be locked
         *  - the container cannot be heavily nested (>2 is arbitrary)
         *  - the container cannot be a statue or bag of holding
         *    (except in very rare cases for the latter)
         */
        || (container && (container.olocked || nesting.container_nesting > 2
                          || container.otyp === STATUE
                          || (container.otyp === BAG_OF_HOLDING && rn2(40))))
        /* if buried zombie cannot dig itself out, do not revive */
        || (is_zomb && corpse.where === OBJ_BURIED
            && !(await zombie_can_dig(x, y))))
        return null;

    /* prepare for the monster */
    mptr = await mons_(montype);
    if (MON_AT_z(x, y)) {
        const xy = await enexto_z(x, y, mptr);
        if (xy) { x = xy.x; y = xy.y; }
    }

    if (corpse.norevive || (mptr?.mcls === S_EEL_Z && !is_pool(x, y))) {
        if (cansee(x, y))
            await pline(`${upstart(corpse_xname_z(corpse, null, CXN_PFX_THE))
                          } twitches feebly.`);
        return null;
    }

    /* applicable when montraits/corpse->oextra->omonst aren't used */
    const cgend = (corpse.spe & CORPSTAT_GENDER);
    if (cgend === CORPSTAT_MALE)
        mmflags |= MM_MALE;
    else if (cgend === CORPSTAT_FEMALE)
        mmflags |= MM_FEMALE;

    const { makemon, newcham } = await import('./makemon.js');
    const mt = { mtype: montype };
    if (await cant_revive_z(mt, true, corpse)) {
        /* make a zombie or doppelganger instead; note: montype has changed,
           mptr keeps its old value for newcham() */
        montype = mt.mtype;
        mtmp = makemon(await mons_(montype), x, y, mmflags);
        if (mtmp) {
            /* skip ghost handling */
            if (has_omid(corpse))
                free_omid(corpse);
            if (has_omonst(corpse))
                free_omonst(corpse);
            if (mtmp.cham === (await PM_('doppelganger'))) {
                /* change shape to match the corpse.  C: newcham(mtmp, mptr,
                   NO_NC_FLAGS) — makemon.js's newcham takes no ncflags. */
                void NO_NC_FLAGS;
                newcham(mtmp, mptr);
            } else if (mtmp.data?.mcls === S_ZOMBIE_Z) {
                mtmp.mhp = mtmp.mhpmax = 100;
                const { mon_adjust_speed } = await import('./muse.js');
                await mon_adjust_speed(mtmp, 2, null); /* MFAST */
            }
        }
    } else if (has_omonst(corpse)) {
        /* use saved traits */
        mtmp = await montraits(corpse, { x, y }, false);
        if (mtmp && mtmp.mtame && !mtmp.isminion)
            wary_dog_z(mtmp, true);
    } else {
        /* make a new monster */
        mtmp = makemon(mptr, x, y, mmflags | MM_NOCOUNTBIRTH);
    }
    if (!mtmp)
        return null;

    /* hiders shouldn't already be re-hidden when they revive */
    if (mtmp.mundetected) {
        mtmp.mundetected = 0;
        newsym(mtmp.mx, mtmp.my);
    }
    if (M_AP_TYPE(mtmp))
        seemimic_z(mtmp);

    const one_of = (corpse.quan > 1);
    if (one_of)
        corpse = splitobj(corpse, 1);

    /* if this is caused by the hero there might be a shop charge */
    if (by_hero) {
        let shkp = null;

        x = corpse.ox; y = corpse.oy;
        const { costly_spot, shop_keeper, in_rooms } = await import('./shkroom.js');
        if (costly_spot(x, y)
            && (carried_z(corpse) ? corpse.unpaid : !corpse.no_charge))
            shkp = shop_keeper(in_rooms(x, y, SHOPBASE)?.[0]);

        if (cansee(x, y)) {
            let buf = one_of ? 'one of ' : '';
            /* shk_your: "the " or "your " or "<mon>'s " or "<Shk>'s " */
            buf += shk_your_z(corpse);
            if (one_of)
                corpse.quan++; /* force plural */
            buf += corpse_xname_z(corpse, null, CXN_NO_PFX);
            if (one_of) /* could be simplified to ''corpse->quan = 1L;'' */
                corpse.quan--;
            await pline(`${upstart(buf)} glows iridescently.`);
            game.iflags = game.iflags || {};
            game.iflags.last_msg = PLNMSG_OBJ_GLOWS_Z; /* usually for BUC change */
        } else if (shkp) {
            /* need some prior description of the corpse since stolen_value()
               will refer to the object as "it" */
            await pline('A corpse is resuscitated.');
        }
        /* don't charge for shopkeeper's own corpse if we just revived him */
        if (shkp && mtmp !== shkp)
            stolen_value_z(corpse, x, y, !!shkp.mpeaceful, false);

        /* [we don't give any comparable message about the corpse for the
           !by_hero case because caller might have already done so] */
    }

    /* handle recorporealization of an active ghost */
    if (has_omid(corpse)) {
        const m_id = OMID(corpse);
        const { find_mid } = await import('./light.js');
        const FM_FMON = 0x2;   /* mon.h find_mid() flags */
        const ghost = find_mid(m_id, FM_FMON);
        if (ghost && ghost.data?.pmidx === (await PM_('ghost'))) {
            if (canseemon_z(ghost))
                await pline(
                    `${Monnam(ghost)} is suddenly drawn into its former body!`);
            /* transfer the ghost's inventory along with it */
            for (;;) {
                const otmp = Array.isArray(ghost.minvent) ? ghost.minvent[0] : null;
                if (!otmp) break;
                obj_extract_self(otmp);
                add_to_minv_z(mtmp, otmp);
            }
            /* tame the revived monster if its ghost was tame */
            if (ghost.mtame && !mtmp.mtame) {
                const { tamedog } = await import('./dothrow.js');
                if (await tamedog(mtmp, null, false)) {
                    /* ghost's edog data is ignored */
                    mtmp.mtame = ghost.mtame;
                }
            }
            /* was ghost, now alive, it's all very confusing */
            mtmp.mconf = 1;
            /* separate ghost monster no longer exists */
            mongone_z(ghost);
        }
        free_omid(corpse);
    }

    /* monster retains its name */
    if (has_oname(corpse) && !unique_corpstat(mtmp.data)) {
        const { christen_monst } = await import('./do_name.js');
        mtmp = christen_monst(mtmp, ONAME(corpse));
    }
    /* partially eaten corpse yields wounded monster */
    if (corpse.oeaten)
        mtmp.mhp = eaten_stat_z(mtmp.mhp, corpse);
    /* track that this monster was revived at least once */
    mtmp.mrevived = 1;

    /* finally, get rid of the corpse--it's gone now */
    switch (corpse.where) {
    case OBJ_INVENT:
        useup(corpse);
        break;
    case OBJ_FLOOR:
        /* not useupf(), which charges; delobj() won't use up a Rider's corpse,
           delobj_core(,TRUE) will */
        delobj_core(corpse, true); /* for floor, also calls newsym() */
        break;
    case OBJ_MINVENT: {
        const { m_useup } = await import('./muse.js');
        m_useup(corpse.ocarry, corpse);
        break;
    }
    case OBJ_CONTAINED:
        /* obj_extract_self() will update corpse->ocontainer->owt */
        obj_extract_self(corpse);
        obfree(corpse, null);
        break;
    case OBJ_BURIED:
        if (is_zomb) {
            obj_extract_self(corpse);
            obfree(corpse, null);
            break;
        }
        /*FALLTHRU*/
    default:
        await impossible(`revive default case ${corpse.where}`);
        break;
    }

    return mtmp;
}

// C ref: zap.c:1143 revive_egg(obj) — undead turning restarts a dead egg's
// hatch timer.  attach_egg_hatch_timeout() draws inside timeout.c.
export async function revive_egg(obj) {
    /*
     * Note: generic eggs with corpsenm set to NON_PM will never hatch.
     */
    if (obj.otyp !== EGG)
        return;
    const { dead_species } = await import('./makemon.js');
    if (obj.corpsenm !== NON_PM && !dead_species(obj.corpsenm, true)) {
        /* C: attach_egg_hatch_timeout(obj, 0L) — timeout.c's helper, which
           js/ keeps private in mkobj.js:1473. */
        const mk = await import('./mkobj.js');
        if (typeof mk.attach_egg_hatch_timeout === 'function')
            await mk.attach_egg_hatch_timeout(obj, 0);
    }
}

// C ref: zap.c:1156 unturn_dead(mon) — try to revive every corpse and egg
// carried by `mon`; returns the number revived.  All RNG is inside
// revive_egg()/revive().
export async function unturn_dead(mon) {
    let owner = '', corpse = '';
    const is_u = (mon === game.u || mon === game.youmonst);
    let res = 0;

    const youseeit = is_u ? true : canseemon_z(mon);
    /* C walks the nobj chain, capturing ->nobj BEFORE revive() frees the
       object; a snapshot copy of this port's array does the same job. */
    const chain = is_u ? invent_list()
                       : (Array.isArray(mon?.minvent) ? mon.minvent : []);

    for (const otmp of [...chain]) {
        if (otmp.otyp === EGG)
            await revive_egg(otmp);
        if (otmp.otyp !== CORPSE)
            continue;
        /* save the name; the object is liable to go away */
        if (youseeit) {
            corpse = corpse_xname_z(otmp, null, CXN_NORMAL);
            /* shk_your/Shk_Your produces a value with a trailing space */
            if (otmp.quan > 1)
                owner = `One of ${shk_your_z(otmp)}`;
            else
                owner = Shk_Your_z(otmp);
        }
        /* for a stack, only one is revived; if is_u, revive() calls useup()
           which calls update_inventory() but not encumber_msg() */
        const corpsenm = otmp.corpsenm;
        /* norevive applies to revive timer, not to explicit unturn_dead() */
        const save_norevive = otmp.norevive;
        otmp.norevive = 0;

        const mtmp2 = await revive(otmp, !game.context?.mon_moving);
        if (mtmp2) {
            ++res;
            /* might get revived as a zombie rather than corpse's monster */
            const different_type = (mtmp2.data?.pmidx !== corpsenm);
            if (game.iflags?.last_msg === PLNMSG_OBJ_GLOWS_Z) {
                /* revive() already reported "[one of] your <mon> corpse[s]
                   glows iridescently"; override the saved corpse and owner
                   names to say "It comes alive" */
                corpse = 'It';
                owner = '';
            }
            if (youseeit)
                /* C: nonliving(mtmp2->data) — nonliving_zap() above is the
                   flag-based port of that macro (nonliving_mdat() is the older
                   species-name regex, which answers FALSE for anything not in
                   its list). */
                await pline(`${owner}${corpse} suddenly ${
                    nonliving_zap(mtmp2) ? 'reanimates' : 'comes alive'}${
                    different_type ? ` as ${an_z(mon_pmname(mtmp2))}` : ''}!`);
            else if (canseemon_z(mtmp2)) {
                const { Amonnam } = await import('./do_name.js');
                await pline(`${Amonnam(mtmp2)} suddenly appears!`);
            }
        } else {
            /* revival failed; corpse 'otmp' is intact */
            otmp.norevive = save_norevive ? 1 : 0;
        }
    }
    if (is_u && res)
        await encumber_msg();

    return res;
}

// C ref: zap.c:1239 cancel_item(obj) — strip an object's magic.  No RNG; the
// corpse arm swaps a REVIVE_MON timer for a ROT_CORPSE one of the same length.
export async function cancel_item(obj) {
    const otyp = obj.otyp;
    const u = game.u;

    if (carried_z(obj)) {
        /* handle items being worn by hero */
        switch (otyp) {
        case RIN_GAIN_STRENGTH:
            if ((obj.owornmask & W_RING) !== 0) {
                ABON_add_z(A_STR, -obj.spe);
                disp_botl_z();
            }
            break;
        case RIN_GAIN_CONSTITUTION:
            if ((obj.owornmask & W_RING) !== 0) {
                ABON_add_z(A_CON, -obj.spe);
                disp_botl_z();
            }
            break;
        case RIN_ADORNMENT:
            if ((obj.owornmask & W_RING) !== 0) {
                ABON_add_z(A_CHA, -obj.spe);
                disp_botl_z();
            }
            break;
        case RIN_INCREASE_ACCURACY:
            if ((obj.owornmask & W_RING) !== 0)
                u.uhitinc = (u.uhitinc | 0) - obj.spe;
            break;
        case RIN_INCREASE_DAMAGE:
            if ((obj.owornmask & W_RING) !== 0)
                u.udaminc = (u.udaminc | 0) - obj.spe;
            break;
        case RIN_PROTECTION:
            if ((obj.owornmask & W_RING) !== 0)
                disp_botl_z();
            break;
        case GAUNTLETS_OF_DEXTERITY:
            if ((obj.owornmask & W_ARMG) !== 0) {
                ABON_add_z(A_DEX, -obj.spe);
                disp_botl_z();
            }
            break;
        case HELM_OF_BRILLIANCE:
            if ((obj.owornmask & W_ARMH) !== 0) {
                ABON_add_z(A_INT, -obj.spe);
                ABON_add_z(A_WIS, -obj.spe);
                disp_botl_z();
            }
            break;
        default:
            if ((obj.owornmask & W_ARMOR) !== 0) /* AC */
                disp_botl_z();
            break;
        }
    }
    /* cancelled item might not be in hero's possession but cancellation is
       presumed to be instigated by hero */
    if (objects[otyp]?.oc_magic
        || (obj.spe && (obj.oclass === ARMOR_CLASS
                        || obj.oclass === WEAPON_CLASS || is_weptool(obj)))
        || otyp === POT_ACID
        || otyp === POT_SICKNESS
        || (otyp === POT_WATER && (obj.blessed || obj.cursed))
        /* not magic; cancels to blank spellbook */
        || otyp === SPE_NOVEL) {
        const cancelled_spe = (obj.oclass === WAND_CLASS
                               || otyp === CRYSTAL_BALL) ? -1 : 0;

        if (obj.spe !== cancelled_spe
            && otyp !== WAN_CANCELLATION /* can't cancel cancellation */
            && otyp !== MAGIC_LAMP /* cancelling doesn't remove djinni */
            && otyp !== CANDELABRUM_OF_INVOCATION) {
            costly_alteration_z(obj, COST_CANCEL);
            obj.spe = cancelled_spe;
        }
        switch (obj.oclass) {
        case SCROLL_CLASS:
            costly_alteration_z(obj, COST_CANCEL);
            obj.otyp = SCR_BLANK_PAPER;
            obj.spe = 0;
            break;
        case SPBOOK_CLASS:
            if (otyp !== SPE_CANCELLATION && otyp !== SPE_BOOK_OF_THE_DEAD) {
                costly_alteration_z(obj, COST_CANCEL);
                obj.otyp = SPE_BLANK_PAPER;
                /* cancelling a novel is more involved than a spellbook */
                if (otyp === SPE_NOVEL) /* old type */
                    await blank_novel(obj);
            }
            break;
        case POTION_CLASS:
            costly_alteration_z(obj, (otyp !== POT_WATER) ? COST_CANCEL
                                     : obj.cursed ? COST_UNCURS : COST_UNBLSS);
            if (otyp === POT_SICKNESS || otyp === POT_SEE_INVISIBLE) {
                /* sickness is "biologically contaminated" fruit juice; cancel
                   it and it just becomes fruit juice... whereas see invisible
                   tastes like "enchanted" fruit juice, it similarly cancels */
                obj.otyp = POT_FRUIT_JUICE;
            } else {
                obj.otyp = POT_WATER;
                obj.odiluted = 0; /* same as any other water */
            }
            break;
        default:
            break;
        }
    }
    /* cancelling a troll's corpse prevents it from reviving (on its own; does
       not affect undead turning induced revival) */
    if (obj.otyp === CORPSE && obj.timed && !is_rider_pm(obj.corpsenm)) {
        const { peek_timer, stop_timer, start_timer } = await import('./timeout.js');
        const a = obj_to_any_z(obj);
        const timout = peek_timer(REVIVE_MON, a);

        if (timout) {
            await stop_timer(REVIVE_MON, a);
            await start_timer(timout, TIMER_OBJECT, ROT_CORPSE, a);
        }
    }

    unbless(obj);
    uncurse(obj);
}

// C ref: zap.c:1367 blank_novel(obj) — soaking or cancelling a novel turns it
// into a blank spellbook, which needs more than the caller's otyp change.
export async function blank_novel(obj) {
    /* C: assert(obj->otyp == SPE_BLANK_PAPER) */
    /* novelidx overloads corpsenm, not used for spellbooks */
    obj.novelidx = 0;
    const { free_oname } = await import('./do_name.js');
    free_oname(obj); /* get rid of [former] novel's title */
    /* a blank spellbook weighs more than a novel; update obj's weight and
       recursively the weight of any container holding it */
    container_weight(obj);
}

// C ref: zap.c:1382 drain_item(obj, by_you) — remove one point of enchantment
// or one charge.  RNG: obj_resists(obj, 10, 90)'s rn2(100).
export async function drain_item(obj, by_you) {
    const u = game.u;

    /* Is this a charged/enchanted object? */
    if (!obj
        || (!(objects[obj.otyp]?.flags & OC_CHARGED_Z)
            && obj.oclass !== WEAPON_CLASS
            && obj.oclass !== ARMOR_CLASS && !is_weptool(obj))
        || obj.spe <= 0)
        return false;
    const { defends, defends_when_carried } = await import('./artifact.js');
    if (defends(AD_DRLI, obj) || defends_when_carried(AD_DRLI, obj)
        || obj_resists(obj, 10, 90))
        return false;

    /* Charge for the cost of the object */
    if (by_you)
        costly_alteration_z(obj, COST_DRAIN);

    /* Drain the object and any implied effects */
    obj.spe--;
    const u_ring = (obj === game.uleft) || (obj === game.uright);
    switch (obj.otyp) {
    case RIN_GAIN_STRENGTH:
        if ((obj.owornmask & W_RING) && u_ring) {
            ABON_add_z(A_STR, -1);
            disp_botl_z();
        }
        break;
    case RIN_GAIN_CONSTITUTION:
        if ((obj.owornmask & W_RING) && u_ring) {
            ABON_add_z(A_CON, -1);
            disp_botl_z();
        }
        break;
    case RIN_ADORNMENT:
        if ((obj.owornmask & W_RING) && u_ring) {
            ABON_add_z(A_CHA, -1);
            disp_botl_z();
        }
        break;
    case RIN_INCREASE_ACCURACY:
        if ((obj.owornmask & W_RING) && u_ring)
            u.uhitinc = (u.uhitinc | 0) - 1;
        break;
    case RIN_INCREASE_DAMAGE:
        if ((obj.owornmask & W_RING) && u_ring)
            u.udaminc = (u.udaminc | 0) - 1;
        break;
    case RIN_PROTECTION:
        if (u_ring)
            disp_botl_z(); /* bot() will recalc u.uac */
        break;
    case HELM_OF_BRILLIANCE:
        if ((obj.owornmask & W_ARMH) && (obj === game.uarmh)) {
            ABON_add_z(A_INT, -1);
            ABON_add_z(A_WIS, -1);
            disp_botl_z();
        }
        break;
    case GAUNTLETS_OF_DEXTERITY:
        if ((obj.owornmask & W_ARMG) && (obj === game.uarmg)) {
            ABON_add_z(A_DEX, -1);
            disp_botl_z();
        }
        break;
    default:
        break;
    }
    if (game.disp?.botl || game.context?.botl)
        await bot();
    if (carried_z(obj))
        update_inventory();
    return true;
}

// C ref: zap.c:1993 stone_to_flesh_obj(obj) — the stone-to-flesh spell hits one
// object.  RNG: obj_resists(obj, 2, 98), then poly_obj()/makemon()/
// animate_statue() per branch.  Returns non-zero if obj was affected.
export async function stone_to_flesh_obj(obj) {
    let ptr, mon = null;
    let smell = false, golem_xform = false;
    let res = 1; /* affected object by default */

    if (objects[obj.otyp]?.material !== MAT_MINERAL
        && objects[obj.otyp]?.material !== MAT_GEMSTONE)
        return 0;
    /* Heart of Ahriman usually resists; ordinary items rarely do */
    if (obj_resists(obj, 2, 98))
        return 0;

    const loc = get_obj_location_z(obj, 0) || { x: 0, y: 0 };
    const oox = loc.x, ooy = loc.y;
    const { makemon, newcham } = await import('./makemon.js');
    const { vegetarian } = await import('./eat.js');
    const PM_FLESH_GOLEM_Z = await PM_('flesh golem');
    /* add more if stone objects are added... */
    switch (objects[obj.otyp]?.oclass) {
    case ROCK_CLASS: /* boulders and statues */
    case TOOL_CLASS: /* figurines */
        if (obj.otyp === BOULDER) {
            obj = await poly_obj_id_z(obj, ENORMOUS_MEATBALL);
            smell = true;
        } else if (obj.otyp === STATUE || obj.otyp === FIGURINE) {
            ptr = await mons_(obj.corpsenm);
            if (is_golem_z(ptr)) {
                golem_xform = (ptr.pmidx !== PM_FLESH_GOLEM_Z);
            } else if (vegetarian(ptr)) {
                /* Don't animate monsters that aren't flesh */
                obj = await poly_obj_id_z(obj, MEATBALL);
                smell = true;
                break;
            }
            if (obj.otyp === STATUE) {
                /* animate_statue() forces all golems to become flesh golems */
                const { animate_statue } = await import('./trap.js');
                mon = await animate_statue(obj, oox, ooy, ANIMATE_SPELL, null);
            } else { /* (obj->otyp == FIGURINE) */
                if (golem_xform)
                    ptr = await mons_(PM_FLESH_GOLEM_Z);
                mon = makemon(ptr, oox, ooy, NO_MINVENT | MM_NOMSG);
                if (mon) {
                    const { costly_spot, shop_keeper, in_rooms } =
                        await import('./shkroom.js');
                    if (costly_spot(oox, ooy)
                        && (carried_z(obj) ? obj.unpaid : !obj.no_charge)) {
                        const shkp = shop_keeper(in_rooms(oox, ooy, SHOPBASE)?.[0]);
                        stolen_value_z(obj, oox, ooy,
                                       !!(shkp && shkp.mpeaceful), false);
                    }
                    if (obj.timed) {
                        const { obj_stop_timers } = await import('./timeout.js');
                        await obj_stop_timers(obj);
                    }
                    if (carried_z(obj))
                        useup(obj);
                    else
                        delobj(obj);
                    if (cansee(mon.mx, mon.my))
                        await pline(`The figurine ${
                            golem_xform ? 'turns to flesh and ' : ''}animates!`);
                }
            }
            if (mon) {
                ptr = mon.data;
                /* this golem handling is redundant... */
                if (is_golem_z(ptr) && ptr.pmidx !== PM_FLESH_GOLEM_Z) {
                    /* C: newcham(mon, &mons[PM_FLESH_GOLEM],
                       NC_VIA_WAND_OR_SPELL) — makemon.js's newcham takes no
                       ncflags argument. */
                    void NC_VIA_WAND_OR_SPELL;
                    newcham(mon, await mons_(PM_FLESH_GOLEM_Z));
                }
            } else if (((ptr?.geno | 0) & (G_NOCORPSE_Z | G_UNIQ_Z)) !== 0) {
                /* didn't revive but can't leave corpse either */
                res = 0;
            } else {
                /* unlikely to get here since genociding monsters also sets the
                   G_NOCORPSE flag; drop statue's contents */
                for (;;) {
                    const item = Array.isArray(obj.cobj) ? obj.cobj[0] : null;
                    if (!item) break;
                    bypass_obj_z(item); /* make stone-to-flesh miss it */
                    obj_extract_self(item);
                    place_object(item, oox, ooy);
                }
                obj = await poly_obj_id_z(obj, CORPSE);
            }
        } else { /* miscellaneous tool or unexpected rock... */
            res = 0;
        }
        break;
    /* maybe add weird things to become? */
    case RING_CLASS: /* some of the rings are stone */
        obj = await poly_obj_id_z(obj, MEAT_RING);
        smell = true;
        break;
    case WAND_CLASS: /* marble wand */
        obj = await poly_obj_id_z(obj, MEAT_STICK);
        smell = true;
        break;
    case GEM_CLASS: /* stones & gems */
        obj = await poly_obj_id_z(obj, MEATBALL);
        smell = true;
        break;
    case WEAPON_CLASS: /* crysknife */
        /*FALLTHRU*/
    default:
        res = 0;
        break;
    }
    void obj; /* C's nhUse(obj) for the poly_obj() assignments */

    if (smell) {
        /* non-meat eaters smell meat, meat eaters smell its flavor; monks are
           considered non-meat eaters regardless of behavior; other roles are
           non-meat eaters if they haven't broken vegetarian conduct yet (or if
           poly'd into non-carnivorous form) */
        if (Role_if_z(await PM_('monk')) || !game.u?.uconduct?.unvegetarian
            || !carnivorous_z(await youmonst_data_z()))
            await Norep_zap('You smell the odor of meat.');
        else
            await Norep_zap('You smell a delicious smell.');
    }
    newsym(oox, ooy);
    return res;
}

// C ref: zap.c:2687 boxlock_invent(obj) — lock or unlock every box carried.
// RNG is inside lock.c boxlock().
export async function boxlock_invent(obj) {
    let boxing = false;
    const { boxlock } = await import('./lock.js');

    /* (un)lock carried boxes */
    for (const otmp of [...invent_list()]) {
        if (Is_box_z(otmp)) {
            boxlock(otmp, obj);
            boxing = true;
        }
    }
    if (boxing)
        update_inventory(); /* in case any box->lknown has changed */
}

// C ref: zap.c:3017 ubreatheu(mattk) — a poly'd hero breathes at herself.
export async function ubreatheu(mattk) {
    const dtyp = 20 + mattk.adtyp - 1;      /* breath by hero */

    await zhitu(dtyp, mattk.damn, flash_str(dtyp), game.u.ux, game.u.uy);
}

// C ref: zap.c:3087 zap_steed(obj) — a wand zapped downwards while riding.
// Returns TRUE if the steed was hit.  All RNG is in the per-wand handlers.
export async function zap_steed(obj) {
    let steedhit = false;
    const u = game.u;

    game.bhitpos = { x: u.usteed.mx, y: u.usteed.my };
    game.notonhead = false;
    switch (obj.otyp) {
    /*
     * Wands that are allowed to hit the steed.  Carefully test the results of
     * any that are moved here from the bottom section.
     */
    case WAN_PROBING:
        /* C: probe_monster(u.usteed).  zap.c:626 probe_monster() is
           mstatusline() + probe_objchain(minvent) + display_minventory(); the
           only JS definition of that name (artifact.js:1688) is an unbound hook
           stub and mstatusline() is private to apply.js:248, so the two halves
           this file owns are driven directly, in C's order. */
        if (Array.isArray(u.usteed.minvent) && u.usteed.minvent.length) {
            probe_objchain(u.usteed.minvent);
            display_minventory(u.usteed, 0, null);
        } else {
            await pline(`${Monnam(u.usteed)} is not carrying anything${
                engulfing_u(u.usteed) ? ' besides you' : ''}.`);
        }
        learnwand(obj);
        steedhit = true;
        break;
    case WAN_TELEPORTATION:
    case SPE_TELEPORT_AWAY:
        /* you go together */
        await tele();
        /* same criteria as when unmounted (zapyourself) */
        if ((Teleport_control() && !Stunned())
            || !(await couldsee_z(u.ux0, u.uy0))
            || distu_z(u.ux0, u.uy0) >= 16)
            learnwand(obj);
        steedhit = true;
        break;

    /* Default processing via bhitm() for these */
    case SPE_CURE_SICKNESS:
    case WAN_MAKE_INVISIBLE:
    case WAN_CANCELLATION:
    case SPE_CANCELLATION:
    case WAN_POLYMORPH:
    case SPE_POLYMORPH:
    case WAN_STRIKING:
    case SPE_FORCE_BOLT:
    case WAN_SLOW_MONSTER:
    case SPE_SLOW_MONSTER:
    case WAN_SPEED_MONSTER:
    case SPE_HEALING:
    case SPE_EXTRA_HEALING:
    case SPE_DRAIN_LIFE:
    case WAN_OPENING:
    case SPE_KNOCK:
        await bhitm(u.usteed, obj);
        steedhit = true;
        break;

    default:
        steedhit = false;
        break;
    }
    return steedhit;
}

// C ref: zap.c:3415 zapsetup() — clear the "an object was polymorphed" flag
// that zapwrapup() reports on.  Used by do_break_wand() as well as weffects().
export function zapsetup() {
    game.obj_zapped = false;
}

// C ref: zap.c:3509 spell_hit_bonus(skill) — to-hit bonus for an attack spell,
// from the hero's skill in that spell's school plus Dexterity.  No RNG; async
// only because spell_skilltype()/P_SKILL() live in other modules.
export async function spell_hit_bonus(skill) {
    let hit_bon = 0;
    const dex = ACURR(A_DEX);
    const { spell_skilltype } = await import('./spell.js');
    const { p_skill_of } = await import('./enhance.js');
    /* skills.h P_ISRESTRICTED..P_EXPERT */
    const P_ISRESTRICTED = 0, P_UNSKILLED = 1, P_BASIC = 2, P_SKILLED = 3,
          P_EXPERT = 4;

    switch (p_skill_of(spell_skilltype(skill))) {
    case P_ISRESTRICTED:
    case P_UNSKILLED:
        hit_bon = -4;
        break;
    case P_BASIC:
        hit_bon = 0;
        break;
    case P_SKILLED:
        hit_bon = 2;
        break;
    case P_EXPERT:
        hit_bon = 3;
        break;
    default:
        break;
    }

    if (dex < 4)
        hit_bon -= 3;
    else if (dex < 6)
        hit_bon -= 2;
    else if (dex < 8)
        hit_bon -= 1;
    else if (dex < 14)
        /* Will change when print stuff below removed */
        hit_bon -= 0;
    else
        /* Even increment for dexterous heroes (see weapon.c abon) */
        hit_bon += dex - 14;

    return hit_bon;
}

// C ref: zap.c:3579 skiprange(range, &skipstart, &skipend) — the invisible
// stretch in the middle of a bhit() path.  RNG: rnd(range/4), then rnd(3).
// `out` carries C's two int* out-params.
export function skiprange(range, out) {
    const tr = Math.trunc(range / 4);
    const tmp = range - ((tr > 0) ? rnd(tr) : 0);

    out.skipstart = tmp;
    out.skipend = tmp - (Math.trunc(tmp / 4) * rnd(3));
    if (out.skipend >= tmp)
        out.skipend = tmp - 1;
}

// C ref: zap.c:3594 maybe_explode_trap(ttmp, otmp, &learn_it) — a cancellation
// beam that hits a magical trap blows it up.  RNG: d(3, 6) for the blast.
// `learn_it` is C's boolean* out-param: { value }.
export async function maybe_explode_trap(ttmp, otmp, learn_it) {
    if (!ttmp || !otmp)
        return;
    if (otmp.otyp === WAN_CANCELLATION || otmp.otyp === SPE_CANCELLATION) {
        const x = ttmp.tx, y = ttmp.ty;
        const { undestroyable_trap, deltrap } = await import('./trap.js');

        if (undestroyable_trap(ttmp.ttyp)) {
            shieldeff_z(x, y);
            if (cansee(x, y)) {
                ttmp.tseen = 1;
                newsym(x, y);
                learn_it.value = true;
            }
        } else if (is_magical_trap(ttmp.ttyp)) {
            const seeit = cansee(x, y);
            const { explode } = await import('./explode.js');
            const { TRAP_EXPLODE, EXPL_MAGICAL } = await import('./const.js');

            /* note: this explosion mustn't destroy otmp */
            await explode(x, y, -WAN_CANCELLATION,
                          20 + d(3, 6), TRAP_EXPLODE, EXPL_MAGICAL);
            deltrap(ttmp);
            newsym(x, y);
            if (seeit)
                learn_it.value = true;
        }
    }
}

// C ref: zap.c:4765 buzz(type, nd, sx, sy, dx, dy) — a ray fired by a monster
// or from a trap; ubuzz() above is the hero's entry point.
export async function buzz(type, nd, sx, sy, dx, dy) {
    await dobuzz(type, nd, sx, sy, dx, dy, true, false, false);
}

// C ref: zap.c:5040 melt_ice(x, y, msg) — the ice at <x,y> reverts to water.
// No RNG of its own; minliquid()/spoteffects() may draw.
export async function melt_ice(x, y, msg) {
    const lev = game.level?.at(x, y);

    if (!msg)
        msg = 'The ice crackles and melts.';
    if (lev.typ === DRAWBRIDGE_UP || lev.typ === DRAWBRIDGE_DOWN) {
        lev.drawbridgemask &= ~DB_ICE; /* revert to DB_MOAT */
    } else { /* lev->typ == ICE */
        lev.typ = (lev.icedpool === ICED_POOL ? POOL : MOAT);
        lev.icedpool = 0;
    }
    const tmo = await import('./timeout.js');
    /* no more ice to melt away */
    await tmo.spot_stop_timers(x, y, MELT_ICE_AWAY_Z);
    const { t_at, spoteffects } = await import('./trap.js');
    if (t_at(x, y))
        await trap_ice_effects_z(x, y, true); /* TRUE because ice_is_melting */
    obj_ice_effects(x, y, false);
    const { unearth_objs } = await import('./dig.js');
    await unearth_objs(x, y);
    if (Underwater_z())
        vision_recalc(1);
    newsym(x, y);
    if (cansee(x, y) || u_at(x, y))
        await Norep_zap(msg);
    let otmp = sobj_at(BOULDER, x, y);
    if (otmp) {
        if (cansee(x, y))
            await pline(`${An_z(xname(otmp))} settles...`);
        do {
            obj_extract_self(otmp); /* boulder isn't being pushed */
            if (!(await boulder_hits_pool_z(otmp, x, y, false)))
                await impossible('melt_ice: no pool?');
            /* try again if there's another boulder and pool didn't fill */
            otmp = is_pool(x, y) ? sobj_at(BOULDER, x, y) : null;
        } while (otmp);
        newsym(x, y);
    }
    if (u_at(x, y)) {
        await spoteffects(true); /* possibly drown, notice objects */
    } else if (is_pool(x, y)) {
        const mtmp = m_at(x, y);
        if (mtmp) await minliquid_z(mtmp);
    }
}

// C ref: zap.c:5088 start_melt_ice_timeout(x, y, min_time) — usually arm a
// melt_ice_away timer; sometimes the ice becomes permanent instead.  RNG: the
// rn2((MAX_ICE_TIME - when) + MIN_ICE_TIME) loop, one draw per candidate turn.
const MIN_ICE_TIME_Z = 50, MAX_ICE_TIME_Z = 2000;
export async function start_melt_ice_timeout(x, y, min_time) {
    let when = min_time | 0;
    if (when < MIN_ICE_TIME_Z - 1)
        when = MIN_ICE_TIME_Z - 1;

    /* random timeout; surrounding ice locations ought to be a factor... */
    while (++when <= MAX_ICE_TIME_Z)
        if (!rn2((MAX_ICE_TIME_Z - when) + MIN_ICE_TIME_Z))
            break;

    /* if we're within MAX_ICE_TIME, install a melt timer; otherwise, omit it
       to leave this ice permanent */
    if (when <= MAX_ICE_TIME_Z) {
        const where = ((x << 16) | y);
        const { start_timer } = await import('./timeout.js');
        const { long_to_any } = await import('./hack.js');
        await start_timer(when, TIMER_LEVEL, MELT_ICE_AWAY_Z, long_to_any(where));
    }
}

// C ref: zap.c:5119 melt_ice_away(arg, timeout) — the MELT_ICE_AWAY timer
// callback.  js/timeout.js:1916 currently routes this func_index to a
// NOT-PORTED stub attributed to do.c; the routine actually lives here in zap.c,
// so that table entry can point at this export.
export async function melt_ice_away(arg, _timeout) {
    const where = arg.a_long;
    const save_mon_moving = game.context?.mon_moving; /* will be False */

    /* melt_ice -> minliquid -> mondead|xkilled shouldn't credit/blame hero */
    if (game.context) game.context.mon_moving = true;
    const y = (where & 0xFFFF);
    const x = ((where >> 16) & 0xFFFF);
    /* melt_ice does newsym when appropriate */
    await melt_ice(x, y, 'Some ice melts away.');
    if (game.context) game.context.mon_moving = save_mon_moving;
}

// C ref: zap.c:5501 mon_spell_hits_spot(caster, adtyp, x, y) — a monster's
// flame/frost/missile spell landing on a square.  RNG: d(6, 6) for the
// engraving wipe, then whatever zap_over_floor() draws.
export async function mon_spell_hits_spot(_caster, adtyp, x, y) {
    /* "shower of missiles" or [hypothetical] "acid rain" attack: thoroughly
       clobber an engraving (unless its type makes it be scuff-protected);
       zap_over_floor() doesn't handle this */
    if (adtyp === AD_MAGM || adtyp === AD_ACID) {
        const { engr_at, wipe_engr_at } = await import('./engrave.js');
        const ep = engr_at(x, y);
        /* C: ep->engr_txt[actual_text]; engrave.js:536 names it actualText */
        const etext = ep ? ep.actualText : null;

        if (etext)
            wipe_engr_at(x, y, String(etext).length + d(6, 6), true);
        /* hero and player will still remember prior text until the spot is
           re-examined (lookhere or move off and back on) */
    }

    /* hit items and/or terrain; only matters for AD_FIRE and AD_COLD but
       accept any basic damage type that zap_over_floor() might handle */
    if (adtyp >= AD_MAGM && adtyp <= AD_ACID) {
        /* zap_over_floor() requires this even though it's only used when
           zapdmgtyp is non-negative (hero's fault) */
        const shopdummy = { value: false };
        const zt_typ = adtyp - 1;              /* convert AD_xxxx to ZT_xxxx */
        const zapdmgtyp = -ZT_SPELL_Z(zt_typ); /* damage is from monster spell */

        /* C's signature is zap_over_floor(x, y, type, *shopdamage, ignoremon,
           exploding_wand_typ); this file's port (js/zap.js:1449) takes only
           (x, y, type, exploding_wand_typ), so the shopdamage/ignoremon pair
           lands on an unused parameter.  Called with C's list so the call site
           stays right when that signature is completed. */
        await zap_over_floor(x, y, zapdmgtyp, shopdummy, true, 0);
    } else {
        await impossible(
            `Unsupported damage type (${adtyp}) for mon_spell_hits_spot.`);
    }
}

// C ref: zap.c:5654 adtyp_to_prop(dmgtyp) — AD_foo to the prop.h resistance.
// prop_types start at 1, so 0 means "no matching property".  No RNG.
export function adtyp_to_prop(dmgtyp) {
    switch (dmgtyp) {
    case AD_COLD:
        return COLD_RES;
    case AD_FIRE:
        return FIRE_RES;
    case AD_ELEC:
        return SHOCK_RES;
    case AD_ACID:
        return ACID_RES;
    case AD_DISN:
        return DISINT_RES;
    default:
        break;
    }
    return 0; /* prop_types start at 1 */
}

// C ref: zap.c:5676 u_adtyp_resistance_obj(dmgtyp) — percent protection the
// hero's WORN/WIELDED gear gives her carried items against dmgtyp.  No RNG
// (inventory_resistance_check() is the caller that rolls rn2(100) on it).
export function u_adtyp_resistance_obj(dmgtyp) {
    const prop = adtyp_to_prop(dmgtyp);

    if (!prop)
        return 0;

    /* FIXME? these percentages (99 and 90) seem too high... */

    /* items that give an extrinsic resistance when worn or wielded or carried
       give 99% protection to your items */
    if ((extrinsic_of_z(prop) & (W_ARMOR | W_ACCESSORY | W_WEP | W_ART)) !== 0)
        return 99;

    /* worn dwarvish cloaks give 90% protection against heat and cold to
       carried items */
    if (game.uarmc && game.uarmc.otyp === DWARVISH_CLOAK
        && (dmgtyp === AD_COLD || dmgtyp === AD_FIRE))
        return 90;

    return 0;
}

// C ref: zap.c:5722 item_what(dmgtyp) — the " by your <item>" tail
// enlightenment appends to "Your items are protected against <type>".
// Wizard-mode only; no RNG.  async only for do_wear.js's *_simple_name().
export async function item_what(dmgtyp) {
    let what = null;
    const prop = adtyp_to_prop(dmgtyp);
    const xtrinsic = extrinsic_of_z(prop);
    let whatbuf = '';

    if (game.flags?.debug /* C: wizard */) {
        const dw = await import('./do_wear.js');
        if (!prop || !xtrinsic) {
            /* 'what' stays Null */
        } else if (xtrinsic & W_ARMC) {
            /* this file's own cloak_simple_name() (js/zap.js:2164) */
            what = cloak_simple_name(game.uarmc);
        } else if (xtrinsic & W_ARM) {
            what = dw.suit_simple_name(game.uarm); /* "dragon {scales,mail}" */
        } else if (xtrinsic & W_ARMU) {
            what = dw.shirt_simple_name(game.uarmu);
        } else if (xtrinsic & W_ARMH) {
            what = dw.helm_simple_name(game.uarmh);
        } else if (xtrinsic & W_ARMG) {
            what = dw.gloves_simple_name(game.uarmg);
        } else if (xtrinsic & W_ARMF) {
            what = dw.boots_simple_name(game.uarmf);
        } else if (xtrinsic & W_ARMS) {
            what = dw.shield_simple_name(game.uarms);
        } else if (xtrinsic & (W_AMUL | W_TOOL)) {
            what = simpleonames_z((xtrinsic & W_AMUL) ? game.uamul : game.ublindf);
        } else if (xtrinsic & W_RING) {
            if ((xtrinsic & W_RING) === W_RING) /* both */
                what = 'rings';
            else
                what = simpleonames_z((xtrinsic & W_RINGL) ? game.uleft
                                                           : game.uright);
        } else if (xtrinsic & W_WEP) {
            what = simpleonames_z(game.uwep);
        }
        /* format the output to be ready for enl_msg() to append it to
           "Your items {are,were} protected against <damage-type>" */
        if (what) /* strlen(what) will be less than 30 */
            whatbuf = ` by your ${String(what).slice(0, 40)}`;
    }
    return whatbuf;
}

// C ref: zap.c:6165 wishcmdassist(triesleft) — the cmdassist text window shown
// after an unrecognized wish.  No RNG.
const MAXWISHTRY_Z = 5;
export async function wishcmdassist(triesleft) {
    /* C's wishinfo[] ends in a NULL sentinel that its `i < SIZE - 1` loop
       skips; the array below simply omits it. */
    const wishinfo = [
  'Wish details:',
  '',
  'Enter the name of an object, such as "potion of monster detection",',
  '"scroll labeled README", "elven mithril-coat", or "Grimtooth"',
  '(without the quotes).',
  '',
  'For object types which come in stacks, you may specify a plural name',
  'such as "potions of healing", or specify a count, such as "1000 gold',
  'pieces", although that aspect of your wish might not be granted.',
  '',
  'You may also specify various prefix values which might be used to',
  'modify the item, such as "uncursed" or "rustproof" or "+1".',
  'Most modifiers shown when viewing your inventory can be specified.',
  '',
  "You may specify 'nothing' to explicitly decline this wish.",
    ];
    const preserve_wishless = "Doing so will preserve 'wishless' conduct.";
    const retry_too = 'a randomly chosen item will be granted.';
    const suppress_cmdassist =
        '(Suppress this assistance with !cmdassist in your config file.)';
    const cardinals = ['zero', 'one', 'two', 'three', 'four', 'five'];
    const too_many = 'too many';

    const wt = await import('./wintty.js');
    const win = wt.tty_create_nhwindow(NHW_TEXT);
    if (!win)
        return;
    for (const line of wishinfo)
        wt.tty_putstr(win, 0, line);
    if (!game.u?.uconduct?.wishes)
        wt.tty_putstr(win, 0, preserve_wishless);
    wt.tty_putstr(win, 0, '');
    /* C: retry_info[] = "If you specify an unrecognized object name %s%s time%s," */
    const cardinal = (triesleft >= 0 && triesleft < cardinals.length)
        ? cardinals[triesleft] : too_many;
    wt.tty_putstr(win, 0, `If you specify an unrecognized object name ${cardinal}${
        (triesleft < MAXWISHTRY_Z) ? ' more' : ''} time${plur_z(triesleft)},`);
    wt.tty_putstr(win, 0, retry_too);
    wt.tty_putstr(win, 0, '');
    if (game.iflags?.cmdassist)
        wt.tty_putstr(win, 0, suppress_cmdassist);
    wt.tty_display_nhwindow(win, true);
    /* wintty.js requires an explicit dismiss before destroying an active
       TEXT/MENU window (see its tty_destroy_nhwindow note). */
    await wt.tty_dismiss_nhwindow(win);
    wt.tty_destroy_nhwindow(win);
}

// C ref: zap.c:6227 wish_history_add(buf) / :6259 wish_history_flush() /
// :6275 wish_history_menu(buf).  The whole trio is inside `#ifdef DEBUG` and
// wish_history_add() is additionally wizard-gated, so a release build's
// makewish() calls compile to nothing.  The DEBUG flag is modelled explicitly
// rather than assumed off.
const MAX_WISH_HISTORY_Z = 20;
const DEBUG_BUILD_Z = false; /* config.h DEBUG; the recorder build is release */
const wish_history = new Array(MAX_WISH_HISTORY_Z).fill(null);
let wish_history_idx = 0;

export function wish_history_add(buf) {
    if (!DEBUG_BUILD_Z)
        return;
    if (!game.flags?.debug /* C: wizard */)
        return;

    let i;
    for (i = 0; i < MAX_WISH_HISTORY_Z; i++) {
        const idx = (wish_history_idx + i) % MAX_WISH_HISTORY_Z;

        if (!wish_history[idx])
            continue;
        /* C: !strncmpi(wish_history[idx], buf, strlen(wish_history[idx])) */
        if (String(buf).toLowerCase()
                .startsWith(String(wish_history[idx]).toLowerCase()))
            break;
    }

    if (i === MAX_WISH_HISTORY_Z) {
        const idx = (wish_history_idx + i) % MAX_WISH_HISTORY_Z;

        wish_history[idx] = String(buf);
        wish_history_idx = (wish_history_idx + 1) % MAX_WISH_HISTORY_Z;
    }
}

// C ref: called from freedynamicdata(save.c) — release any old wish text.
export function wish_history_flush() {
    if (!DEBUG_BUILD_Z)
        return;
    for (let idx = 0; idx < MAX_WISH_HISTORY_Z; ++idx)
        wish_history[idx] = null;
    wish_history_idx = 0;
}

// Shows a menu of previous wishes and copies the selection into `buf`, C's
// char* out-param: { value }.  Not modified if nothing was selected.
export async function wish_history_menu(buf) {
    if (!DEBUG_BUILD_Z)
        return;
    const wt = await import('./wintty.js');
    const { MENU_BEHAVE_STANDARD, MENU_ITEMFLAGS_NONE } = await import('./const.js');
    const { ATR_NONE, NO_COLOR } = await import('./terminal.js');
    let i, idx;

    const win = wt.tty_create_nhwindow(NHW_MENU);
    wt.tty_start_menu(win, MENU_BEHAVE_STANDARD);

    for (i = MAX_WISH_HISTORY_Z - 1; i >= 0; i--) {
        idx = (wish_history_idx + i) % MAX_WISH_HISTORY_Z;
        if (wish_history[idx]) {
            wt.tty_add_menu(win, null, { a_int: i + 1 }, '\0', 0, ATR_NONE,
                            NO_COLOR, wish_history[idx], MENU_ITEMFLAGS_NONE);
        }
    }

    wt.tty_end_menu(win, 'Wish what?');
    const picks = [];
    const npick = await wt.tty_select_menu(win, PICK_ONE, picks);
    wt.tty_destroy_nhwindow(win);
    if (npick > 0) {
        i = picks[0]?.item?.a_int;
        i--;
        idx = (wish_history_idx + i) % MAX_WISH_HISTORY_Z;

        if (wish_history[idx])
            buf.value = wish_history[idx];
    }
}
