// zap.js — wand/spell zapping helpers.
// C ref: zap.c.  Only the routines whose RNG side-effects are exercised by
// the gameplay sessions are ported here.

import { game } from './gstate.js';
import { s_suffix } from './hacklib.js';
import { rn2, rn1, rnd, rnl, d } from './rng.js';
import { pline, newsym, m_at, show_glyph_cell, update_topl, urgent_topl, topl_more, y_n,
         bot, flush_screen, canseemon_shared, map_invisible, unmap_object, shieldeff,
         impossible, display_nhwindow_message, useDECgraphics, You_hear, Deaf_hero,
         Hallucination_u as Hallucination } from './display.js';
import { getobj, makeknown, useupall, useup, delobj, GETOBJ_SUGGEST, GETOBJ_EXCLUDE,
         GETOBJ_NOFLAGS, xname, near_capacity, splitobj, delobj_core, obfree,
         obj_extract_self, sobj_at, encumber_msg, is_weptool, update_inventory,
         display_minventory, worn_extrinsic, yname, makeplural,
         Ring_gone, setnotworn, body_part, distant_name_pub, display_cinventory,
         set_cknown_lknown, newsym_force, display_binventory, stackobj } from './invent.js';
import { mon_mr } from './monmr_data.js';
import { monstseesu, monstunseesu } from './mondata.js';
import { mflags1_of, hides_under_flag, mflags2_of, M2_PNAME, is_animal, M1_MINDLESS, M1_NOEYES, M1_BREATHLESS, is_undead_flag, nohands,
         passes_walls_flag, is_swimmer_flag, is_demon_flag,
         is_were_flag } from './monflags_data.js';
// AD_MAGM is NOT imported: this file already declares the AD_* block locally
// (same values), and a duplicate binding is a module-load SyntaxError.
import { attacktype_fordmg, dmgtype, AT_EXPL, AT_GAZE, AD_BLND,
         AD_RBRE, attacktype, AT_ENGL, AT_HUGS, AD_DRLI, AD_SEDU, AD_SSEX,
         AD_DGST, AD_STCK, AD_WRAP, AD_SPEL } from './monattk_data.js';
import { observe_object } from './o_init.js';
// C ref: attrib.h ACURR(x) == acurr(x) (abon + atemp + acurr, clamped).
import { exercise, acurr_eff as ACURR } from './attrib.js';
import { more_experienced, has_innate } from './exper.js';
import { findit } from './detect.js';
import { find_ac } from './u_init.js';
import { cansee, vision_recalc, Blind, recalc_block_point, does_block } from './vision.js';
import { WAND_CLASS, GEM_CLASS, TOOL_CLASS, POTION_CLASS, SCROLL_CLASS, WEAPON_CLASS, ARMOR_CLASS,
         FOOD_CLASS, RING_CLASS, POT_OIL, POT_WATER, GLOB_OF_GREEN_SLIME,
         SPBOOK_CLASS, mkobj as _mkobj, place_object, objects,
         mkcorpstat, CORPSE, AMULET_OF_YENDOR, BELL_OF_OPENING, next_ident,
         CANDELABRUM_OF_INVOCATION, SPE_BOOK_OF_THE_DEAD,
         is_rider_pm, ROCK_CLASS, unbless, uncurse, container_weight,
         has_omonst, get_mtraits, has_omid, OMID, free_omid, free_omonst,
         obj_ice_effects, dealloc_obj } from './mkobj.js';
import { A_WIS, A_STR, A_INT, A_CON, A_DEX, A_CHA, ROWNO, COLNO, ZAP_POS, IS_DOOR, IS_ROOM, IS_WALL, isok, ROOM, STONE,
         D_CLOSED, D_LOCKED, CORPSTAT_INIT, EXT_ENCUMBER, HEADSTONE, ENGRAVE, TELEDS_TELEPORT,
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
         SHOCK_RES, ACID_RES, DISINT_RES, ANTIMAGIC, is_magical_trap, has_oname, ONAME,
         ESHK, engulfing_u, u_at, M_AP_TYPE, NHW_MENU, M_AP_NOTHING, M_AP_OBJECT,
         M_AP_FURNITURE, MCORPSENM, PIT, WEB, ICED_MOAT, IRONBARS, W_NONDIGGABLE, SHOP_BARS_COST,
         IS_WATERWALL, ERODE_CORRODE, M_SEEN_MAGR, M_SEEN_FIRE, M_SEEN_COLD,
         M_SEEN_SLEEP, M_SEEN_DISINT, M_SEEN_ELEC, M_SEEN_ACID, STATUE_TRAP, HOLE as HOLE_Z, TRAPDOOR as TRAPDOOR_Z,
         HEAD, FACE, FOOT, W_SADDLE, ICE, VIBRATING_SQUARE, IS_FURNITURE, MHID_PREFIX, MHID_ARTICLE, MHID_ALTMON, MHID_REGION,
         MINV_ALL, MINV_NOLET, PICK_NONE, MSLOW, MFAST, MIM_REVEAL, MIM_OMIT_WAIT, NC_SHOW_MSG,
         PICK_ONE, LEVITATION, FLYING, KILLED_BY, KILLED_BY_AN,
         NO_KILLER_PREFIX, ARM, EYE, LAVAWALL, DB_UNDER, DB_FLOOR, VWALL, HWALL,
         TT_LAVA, TT_INFLOOR, PASSES_WALLS, EXPL_FIERY, STRAT_WAITMASK,
         Is_airlevel, Is_rogue_level, SDOOR, DOOR, WM_MASK, D_NODOOR, D_BROKEN,
         SHOP_DOOR_COST, M_SEEN_REFL, OBJ_FREE, OBJ_FLOOR, OBJ_CONTAINED, OBJ_INVENT, OBJ_MINVENT, OBJ_BURIED } from './const.js';
import { is_pool, is_ice, is_lava, is_moat } from './dbridge.js';
import { in_rooms } from './shkroom.js';
import { create_gas_cloud } from './region.js';
import { CLR_ORANGE, CLR_BLACK, CLR_GREEN, CLR_YELLOW, CLR_WHITE, CLR_BRIGHT_BLUE } from './terminal.js';
// C ref: display.c:2661 zapcolors[NUM_ZAP], display.h:280 (HI_ZAP == CLR_BRIGHT_BLUE).
// Indexed by the HALLUCINATED damage type, so every beam used to draw orange.
const ZAPCOLORS = [CLR_BRIGHT_BLUE, CLR_ORANGE, CLR_WHITE, CLR_BRIGHT_BLUE,
                   CLR_BLACK, CLR_WHITE, CLR_GREEN, CLR_YELLOW];
// C ref: display.c zapdir_to_glyph() + mapglyph(): the beam symbol for a step
// of direction (dx,dy), drawn with the symset's S_hbeam/S_vbeam (DECgraphics
// line-drawing 'q'/'x', else ASCII '-'/'|') or S_lslant/S_rslant.
export function show_beam_cell(x, y, dx, dy, beamtype) {
    const ch = dx === dy ? '\\' : (dx && dy) ? '/' : dx ? '-' : '|';
    const dec = useDECgraphics() && (ch === '-' || ch === '|');
    show_glyph_cell(x, y, dec ? (ch === '-' ? 'q' : 'x') : ch,
                    ZAPCOLORS[beamtype] ?? CLR_ORANGE, dec);
}
import { DEADMONSTER, set_ustuck, dealloc_monst, replmon,
         restore_cham, unstuck } from './mon.js';
import { MON_WEP, is_vampshifter, monflee } from './monmove.js';
import { killed, canspotmon, mon_nam, Monnam, x_monnam,
         mon_pmname, disguised_as_mon } from './uhitm.js';
import { find_mac as worn_find_mac, which_armor } from './worn.js';
import { rnd_hallublast } from './mthrowu.js';
// C ref: makemon.c monhp_per_lvl(mon) — golem / level>49 / dragon / level-0 arms.
import { monhp_per_lvl } from './artifact.js';

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
// corpses always resist, unrolled; everything else rolls rn2(100) and resists
// below the per-object chance (achance for artifacts, ochance otherwise).
// otyps come from mkobj.js's object table rather than local literals: the four
// that used to live here (155/355/360/359) were 3.4-era indices naming an
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

// C ref: objects.h MUMMY_WRAPPING.
const MUMMY_WRAPPING_Z = 138;

// C ref: zap.c zap_ok — getobj callback: only wands are suggested.
function zap_ok(obj) {
    if (obj && obj.oclass === WAND_CLASS)
        return GETOBJ_SUGGEST;
    return GETOBJ_EXCLUDE;
}

// C ref: zap.c zappable — can the wand be zapped?  spe<0 -> no; spe==0 wrests
// a final charge with WAND_WREST_CHANCE odds; otherwise consume one charge.
// C: You("wrest one last charge...") is a real pline — routed through
// update_topl() (both callers are already async) so a still-pending prior
// message pages with --More-- first instead of getting silently overwritten
// by dozap()'s/doengrave()'s very next message (backfire, "glows and fades",
// "too worn out to engrave", ...).
export async function zappable(wand) {
    if (wand.spe < 0 || (wand.spe === 0 && rn2(WAND_WREST_CHANCE)))
        return false;
    if (wand.spe === 0)
        await update_topl('You wrest one last charge from the worn-out wand.');
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
export function Maybe_Half_Phys(dmg) {
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
// + enlightenment), which this port renders through insight.js.  The explicit
// display_nhwindow_message() between the two calls mirrors C's
// `display_nhwindow(WIN_MESSAGE, FALSE)`: it forces the "You feel
// self-knowledgeable..." line to page with its OWN --More-- before the menu
// opens, rather than being silently wiped by the menu's clearScreen() (pline()
// alone only pages a message that word-wraps onto a second row).
export async function do_enlightenment_effect() {
    await update_topl('You feel self-knowledgeable...');
    await display_nhwindow_message();
    const { show_attributes_disclosure } = await import('./insight.js');
    // C ref: mode is MAGICENLIGHTENMENT alone (no BASICENLIGHTENMENT bit), so
    // the Background/Basics/Characteristics section is skipped — basic=false.
    await show_attributes_disclosure(0 /* ENL_GAMEINPROGRESS */, false);
    await update_topl('The feeling subsides.');
    exercise(A_WIS, true);
}

// C ref: makemon.c create_critters(cnt, mptr, neverask).
// zapnodir() passes neverask = FALSE, so C's `ask = (wizard && !neverask)` is
// TRUE in wizard mode: C prompts "Create what kind of monster?" (read.c
// create_particular) once per critter and only falls through to makemon()
// after an ESC.
async function create_critters(cnt, mptr, neverask) {
    const { makemon, makemon_appears_msg } = await import('./makemon.js');
    const { create_particular } = await import('./read.js');
    const u = game.u;
    let known = false;
    let ask = (!!game.flags?.debug && !neverask);
    while (cnt-- > 0) {
        if (ask) {
            if (await create_particular()) { known = true; continue; }
            else ask = false;          /* ESC will shut off prompting */
        }
        // (u.uinwater enexto(GIANT_EEL) relocation isn't modelled: no covered
        // hero zaps while underwater.)
        const mon = makemon(mptr, u.ux, u.uy, 0);
        if (!mon) continue;
        await makemon_appears_msg(mon, mon.mx, mon.my, 0); // makemon.c:1474
        if (canspotmon(mon)) known = true;
    }
    return known;
}

// C ref: zap.c lightdamage — pseudo-damage used for blindness duration.  The
// rnd() rolls only happen when the hero is polymorphed into a gremlin.
async function lightdamage(obj, ordinary, amt) {
    let dmg = amt;
    // u.umonnum names a monster form only while Upolyd in this port.
    if (dmg && game.u?.Upolyd && game.u?.umonnum === PM_GREMLIN) {
        /* reduce high values (from destruction of wand with many charges) */
        dmg = rnd(dmg);
        if (dmg > 10) dmg = 10 + rnd(dmg - 10);
        if (dmg > 20) dmg = 20;
        await pline(`Ow, that light hurts${(dmg > 2 || (game.u?.mh ?? 0) <= 5) ? '!' : '.'}`);
        /* [composing killer/reason is superfluous here; if fatal, cause
           of death will always be "killed while stuck in creature form"] */
        if (obj.oclass === SCROLL_CLASS || obj.oclass === SPBOOK_CLASS)
            ordinary = false; /* say blasted rather than zapped */
        const { ansimpleoname } = await import('./objnam.js');
        let how;
        if (obj.oclass === SPBOOK_CLASS) how = 'spell of light';
        else if (!obj.oartifact) how = ansimpleoname(obj);
        else how = (await import('./artifact.js')).bare_artifactname(obj);
        const him = game.u.mfemale ? 'her' : 'him';
        /* might rehumanize(); could be fatal, but only for Unchanging */
        await losehp(Maybe_Half_Phys(dmg),
                     `${ordinary ? 'zapped' : 'blasted'} ${him}self with ${how}`,
                     NO_KILLER_PREFIX);
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

// C ref: zap.c makewish() — the wand-of-wishing prompt; same C function as
// #wizwish, so it lives with the other callers in extcmd-handlers.js
// (including makewish()'s own verbose "You may wish for an object.").
async function makewish() {
    const { makewish: makewish_impl } = await import('./extcmd-handlers.js');
    await makewish_impl();
}

// C ref: hack.h Luck — u.uluck + u.moreluck (plus the luck timeout, which this
// port folds into uluck).
function Luck() { return (game.u?.uluck | 0) + (game.u?.moreluck | 0); }

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
    if (game.context?.bypasses && obj.bypass)
        return false;
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
async function do_osshock(obj) {
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
    /* appropriately add damage to bill */
    const shk = await import('./shk.js');
    if (shk.costly_spot(target.ox, target.oy)) {
        if (game.u?.ushops && game.u.ushops[0])
            await (await import('./shkroom.js')).addtobill(target, false, false, false);
        else
            await shk.stolen_value(target, target.ox, target.oy, false, false);
    }
    /* zap the object */
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
    if (arr && obj.where === OBJ_FLOOR) {
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

// C ref: zap.c poly_obj(obj, id) — replace `obj` with a new object.  If `id` is
// STRANGE_OBJECT (0) pick a random object of the source's class, preserving its
// magic-or-not status (the standard "polymorph" case, which may also fuse a
// stack); otherwise literally replace it with an object of type `id`.  The new
// object replaces obj in its link chain; returns it.  Hero-inventory worn-slot
// re-wearing (wearslot()/setworn()/set_wear()) is not modelled.
export async function poly_obj(obj, id = 0 /* STRANGE_OBJECT */) {
    const mk = await import('./mkobj.js');
    const { NUMMONS } = await import('./disprng.js');
    const obj_location = obj.where;
    const can_merge = (id === 0);
    let otmp = null;
    let ox = 0, oy = 0;

    if (obj.otyp === BOULDER) {
        // C ref: trap.c sokoban_guilt() — polymorphing a boulder away counts as
        // a Sokoban cheat, checked BEFORE the object's otyp changes below.
        (await import('./trap.js')).sokoban_guilt();
    }
    if (id === 0) { /* preserve symbol */
        let try_limit = 3;
        let magic_obj = objects[obj.otyp]?.oc_magic ? 1 : 0;

        // C: a degraded unicorn horn counts as non-magic, which changes which
        // candidate the retry loop below accepts.
        if (obj.otyp === UNICORN_HORN && obj.degraded_horn) magic_obj = 0;
        /* Try up to 3 times to make the magic-or-not status of
           the new item the same as the old item. */
        do {
            if (otmp) delobj(otmp); /* C delobj() -> obj_resists(otmp,0,0) rn2(100) */
            otmp = _mkobj(obj.oclass, false);
        } while (--try_limit > 0 && (objects[otmp.otyp]?.oc_magic ? 1 : 0) !== magic_obj);
    } else {
        /* literally replace obj with this new thing */
        otmp = mk.mksobj(id, false, false);
        /* USES_CORPSENM(typ) == (CORPSE || STATUE || FIGURINE) */
        const uses_corpsenm = (t) => (t === CORPSE || t === STATUE || t === FIGURINE);
        if (uses_corpsenm(obj.otyp) && uses_corpsenm(id))
            mk.set_corpsenm(otmp, obj.corpsenm);
    }

    /* preserve quantity */
    otmp.quan = obj.quan;
    /* preserve the shopkeeper's (lack of) interest */
    otmp.no_charge = obj.no_charge;
    /* preserve inventory letter if in inventory */
    if (obj_location === OBJ_INVENT)
        otmp.invlet = obj.invlet;

    /* avoid abusing eggs laid by you */
    if (obj.otyp === EGG && obj.spe) {
        let tryct = 100;

        /* first, turn into a generic egg */
        if (otmp.otyp === EGG) {
            const { kill_egg } = await import('./timeout.js');
            await kill_egg(otmp);
        } else {
            otmp.otyp = EGG;
            otmp.owt = mk.weight(otmp);
        }
        otmp.corpsenm = NON_PM;
        otmp.spe = 0;

        /* now change it into something laid by the hero */
        const { can_be_hatched, dead_species } = await import('./makemon.js');
        while (tryct--) {
            const mnum = can_be_hatched(rn2(NUMMONS)); /* random_monster(rn2) */
            if (mnum !== NON_PM && !dead_species(mnum, true)) {
                otmp.spe = 1;            /* laid by hero */
                mk.set_corpsenm(otmp, mnum); /* also sets hatch timer */
                break;
            }
        }
    }

    /* keep special fields (including charges on wands) */
    /* C: charged_objs[] == { WAND_CLASS, WEAPON_CLASS, ARMOR_CLASS } */
    if (otmp.oclass === WAND_CLASS || otmp.oclass === WEAPON_CLASS
        || otmp.oclass === ARMOR_CLASS)
        otmp.spe = obj.spe;
    otmp.recharged = obj.recharged;

    otmp.cursed = obj.cursed;
    otmp.blessed = obj.blessed;

    if (mk.erosion_matters(otmp)) {
        if (mk.is_flammable(otmp) || mk.is_rustprone(otmp) || mk.is_crackable(otmp))
            otmp.oeroded = obj.oeroded;
        if (mk.is_corrodeable(otmp) || mk.is_rottable(otmp))
            otmp.oeroded2 = obj.oeroded2;
        if (mk.is_damageable(otmp))
            otmp.oerodeproof = obj.oerodeproof;
    }

    /* Keep chest/box traps and poisoned ammo if we may */
    if (obj.otrapped && Is_box_z(otmp))
        otmp.otrapped = 1;
    if (obj.opoisoned && (await import('./objnam.js')).is_poisonable(otmp))
        otmp.opoisoned = 1;

    if (id === 0 && obj.otyp === CORPSE) {
        /* turn crocodile corpses into shoes */
        if (obj.corpsenm === await PM_('crocodile')) {
            otmp.otyp = otyp_by_name('low boots', ARMOR_CLASS);
            otmp.oclass = ARMOR_CLASS;
            otmp.spe = 0;
            otmp.oeroded = 0;
            otmp.oerodeproof = 1;
            otmp.quan = 1;
            otmp.cursed = 0;
        }
    }
    const LEASH_Z = otyp_by_name('leash', TOOL_CLASS);
    if (obj.otyp === LEASH_Z && obj.leashmon) {
        if (otmp.otyp === LEASH_Z) {
            otmp.leashmon = obj.leashmon;
            /* clear m_id before delobj(), to avoid o_unleash() by obfree() */
            obj.leashmon = 0;
        } else {
            /* obfree() would do this if we didn't do it here */
            await (await import('./apply.js')).o_unleash(obj);
        }
    }

    /* no box contents --KAA */
    if (otmp.cobj && otmp.cobj.length)
        (await import('./shk.js')).delete_contents(otmp);

    /* 'n' merged objects may be fused into 1 object */
    const F_MERGE = 32; /* mkobj.js packs oc_merge as bit 5 of the row's flags */
    if ((otmp.quan || 1) > 1
        && (!(objects[otmp.otyp]?.flags & F_MERGE)
            || (can_merge && otmp.quan > rn2(1000))))
        otmp.quan = 1;

    switch (otmp.oclass) {
    case TOOL_CLASS:
        if (otmp.otyp === 228 /*MAGIC_LAMP*/) { otmp.otyp = 227 /*OIL_LAMP*/; otmp.age = 1500; /* "best" oil lamp possible */ }
        else if (otmp.otyp === 242 /*MAGIC_MARKER*/) otmp.recharged = 1; /* degraded quality */
        /* don't care about the recharge count of other tools */
        break;
    case WAND_CLASS:
        while (otmp.otyp === 414 /*WAN_WISHING*/ || otmp.otyp === WAN_POLYMORPH)
            otmp.otyp = rnd_class_wand();
        /* altering the object tends to degrade its quality
           (analogous to spellbook `read count' handling) */
        if ((otmp.recharged | 0) < rn2(7)) /* recharge_limit */
            otmp.recharged = (otmp.recharged | 0) + 1;
        break;
    case POTION_CLASS:
        while (otmp.otyp === POT_POLYMORPH)
            otmp.otyp = rnd_class_potion();
        /* potions of oil use obj->age field differently from other potions */
        if (otmp.otyp === POT_OIL || obj.otyp === POT_OIL)
            mk.fixup_oil(otmp, obj);
        break;
    case SPBOOK_CLASS:
        while (otmp.otyp === SPE_POLYMORPH)
            otmp.otyp = rnd_class_spbook();
        /* reduce spellbook abuse; non-blank books degrade;
           novels don't use spestudied so shouldn't degrade to blank */
        if (otmp.otyp !== 407 /*SPE_BLANK_PAPER*/ && otmp.otyp !== 408 /*SPE_NOVEL*/) {
            otmp.spestudied = (obj.spestudied | 0) + 1;
            if (otmp.spestudied > 3 /*MAX_SPELL_STUDY (spell.h:12)*/) {
                otmp.otyp = 407 /*SPE_BLANK_PAPER*/;
                /* writing a new book over it will yield an unstudied
                   one; re-polymorphing this one as-is may or may not
                   get something non-blank */
                otmp.spestudied = rn2(otmp.spestudied);
            }
        }
        break;
    case GEM_CLASS:
        // C ref: objclass.h MINERAL == 21.  C's only extra step is halving the
        // stack when the transmutation backfires.
        if ((otmp.quan || 1) > rnd(4)
            && (objects[obj.otyp]?.material === 21 /*MINERAL*/)
            && (objects[otmp.otyp]?.material !== 21)) {
            otmp.otyp = ROCK; /* transmutation backfired */
            otmp.quan = Math.trunc((otmp.quan || 1) / 2); /* some material has been lost */
        }
        break;
    default:
        break;
    }

    /* update the weight */
    otmp.owt = mk.weight(otmp);

    /*
     * ** we are now done adjusting the object (except possibly wearing it) **
     */
    {
        const { get_obj_location } = await import('./light.js');
        const loc = get_obj_location(obj, BURIED_TOO | CONTAINED_TOO);
        if (loc) { ox = loc.x; oy = loc.y; }
    }
    /* note: if otmp is gone, billing for it was handled by useup() */
    const shk = await import('./shk.js');
    if (((otmp && obj_location !== OBJ_INVENT) || obj.unpaid) && ox && shk.costly_spot(ox, oy)) {
        const shkroom = await import('./shkroom.js');
        const shkp = shkroom.shop_keeper(in_rooms(ox, oy, SHOPBASE)[0]);

        if (shkp && (!obj.no_charge
                     || (obj.cobj && obj.cobj.length
                         && shk.contained_cost(obj, shkp, 0, false, false) !== 0))
            && shk.inhishop(shkp)) {
            if (shkp.mpeaceful) {
                const u = game.u;
                if (u.ushops && u.ushops[0]
                    && in_rooms(u.ux, u.uy, 0)[0] === in_rooms(shkp.mx, shkp.my, 0)[0]
                    && !shk.costly_spot(u.ux, u.uy)) {
                    await shk.make_angry_shk(shkp, ox, oy);
                } else {
                    await pline(`${shk.Shknam(shkp)} gets angry!`);
                    await shk.hot_pursuit(shkp);
                }
            } else
                await Norep_zap(`${shk.Shknam(shkp)} is furious!`);
        }
    }
    if (obj.timed) {
        const { obj_stop_timers } = await import('./timeout.js');
        await obj_stop_timers(obj);
    }
    /* swap otmp for obj (C: replace_object() earlier, delobj(obj) last; the
       floor array here has no replace-in-place, so delobj() runs first and the
       new object is slotted into the old one's chain position) */
    if (obj_location === OBJ_FLOOR) {
        const floorObjects = game.level?.objects;
        const floorIndex = floorObjects?.indexOf(obj) ?? -1;
        ox = obj.ox; oy = obj.oy;
        delobj(obj); /* obj_resists(obj,0,0) rn2(100) + newsym() */
        place_object(otmp, ox, oy);
        if (floorIndex >= 0) {
            floorObjects.pop();
            floorObjects.splice(floorIndex, 0, otmp);
        }
        const vis = await import('./vision.js');
        if (obj.otyp === BOULDER && otmp.otyp !== BOULDER) {
            if (!vis.does_block(ox, oy))
                vis.unblock_point(ox, oy);
        } else if (obj.otyp !== BOULDER && otmp.otyp === BOULDER) {
            /* leaving boulder in liquid would trigger sanity_check warning */
            if (is_pool(ox, oy) || is_lava(ox, oy))
                await fracture_rock(otmp);
            if (vis.does_block(ox, oy))
                vis.block_point(ox, oy);
        }
    } else {
        mk.replace_object(obj, otmp);
        delobj(obj);
    }
    return otmp;
}
// C ref: zap.c poly_obj(obj, id) with an explicit type (kept as a named export
// for the callers that pass one).
export async function poly_obj_id(obj, id) {
    return poly_obj(obj, id);
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
    obj.where = OBJ_FREE;
}

// C ref: lock.c boxlock(obj, otmp) with C's own "Klunk!"/"Klick!" plines (lock.js
// returns the text so each caller keeps its topline ordering).
async function boxlock_pline(obj, otmp) {
    const { boxlock } = await import('./lock.js');
    const r = boxlock(obj, otmp);
    if (r.msg) await pline(r.msg);
    return r.res ? 1 : 0;
}
// C ref: objnam.c Tobjnam(otmp, verb) — "The <obj> <verb-conjugated>".
async function Tobjnam_z(obj, verb) {
    const { The } = await import('./objnam.js');
    const { otense } = await import('./invent.js');
    return `${The(xname(obj))} ${otense(obj, verb)}`;
}

// C ref: zap.c bhito — a wand/spell effect hitting one object (a floor pile
// item, or for stone to flesh a carried one).  Returns 1 if the object was
// affected (drives bhit range decrement), 0 otherwise.
export async function bhito(obj, otmp) {
    let res = 1; /* affected object by default */
    let learn_it = false, maybelearnit;

    /* fundamental: a wand effect hitting itself doesn't do anything */
    if (obj === otmp)
        return 0;

    if (obj.bypass) {
        /* The bypass bit is currently only used by POLYMORPH, UNDEAD_TURNING,
           STONE_TO_FLESH and a few inventory walks; see zap.c bhito(). */
        if (game.context?.bypasses)
            return 0;
        obj.bypass = 0;
    }

    /* Some parts of this function expect the object to be on the floor
       obj->{ox,oy} to be valid.  The exception to this (so far) is
       for the STONE_TO_FLESH spell. */
    if (!(obj.where === OBJ_FLOOR || otmp.otyp === SPE_STONE_TO_FLESH))
        await impossible('bhito: obj is not floor or Stone To Flesh spell');

    if (obj === game.uball) {
        res = 0;
    } else if (obj === game.uchain) {
        if (otmp.otyp === WAN_OPENING || otmp.otyp === SPE_KNOCK) {
            learn_it = true;
            const { unpunish } = await import('./read.js');
            unpunish();
        } else
            res = 0;
    } else
        switch (otmp.otyp) {
        case WAN_POLYMORPH:
        case SPE_POLYMORPH:
            if (obj_unpolyable(obj)) {
                res = 0;
                break;
            }
            /* KMH, conduct */
            if (!game.u) game.u = {};
            if (!game.u.uconduct) game.u.uconduct = {};
            game.u.uconduct.polypiles = (game.u.uconduct.polypiles | 0) + 1;

            /* any saved lock context will be dangerously obsolete */
            if (Is_box_z(obj))
                await boxlock_pline(obj, otmp);

            if (obj_shudders(obj)) {
                if (cansee(obj.ox, obj.oy))
                    learn_it = true;
                await do_osshock(obj);
                break;
            }
            obj = await poly_obj(obj);
            newsym(obj.ox, obj.oy);
            break;
        case WAN_PROBING:
            res = !obj.dknown ? 1 : 0;
            /* target object has now been "seen (up close)" */
            observe_object(obj);
            if (Is_container_z(obj) || obj.otyp === STATUE) {
                obj.cknown = obj.lknown = 1;
                if (Is_box_z(obj) && !obj.tknown) {
                    /* obj->tknown applies to boxes and chests, not bags or
                       statues; plural handling here and the "empty" case
                       below are superfluous because containers don't stack */
                    if (obj.otrapped)
                        await pline(`${await Tobjnam_z(obj, 'are')} trapped!`);
                    obj.tknown = 1;
                }

                if (!obj.cobj || !obj.cobj.length) {
                    await pline(`${await Tobjnam_z(obj, 'are')} empty.`);
                } else if (SchroedingersBox_z(obj)) {
                    /* we don't want to force alive vs dead
                       determination for Schroedinger's Cat here,
                       so just make probing be inconclusive for it */
                    const { the } = await import('./objnam.js');
                    const { rndmonnam } = await import('./do_name.js');
                    await pline(`You aren't sure whether ${the(xname(obj))} has ${
                        an_z(Hallucination() ? rndmonnam() : 'cat')} or its corpse inside.`);
                    obj.cknown = 0;
                } else {
                    /* view contents (not recursively) */
                    for (const o of obj.cobj)
                        observe_object(o); /* "seen", even if blind */
                    display_cinventory(obj);
                }
                res = 1;
            } else if (obj.otyp === TIN) {
                /* don't learn wand if tin is already known */
                if (!obj.known || !obj.cknown)
                    res = 1;
                obj.known = 1;
                set_cknown_lknown(obj); /* if TIN obj->cknown = 1 */
            } else if (obj.otyp === EGG) {
                /* if egg is unhatchable, probing it won't learn wand
                   because even when flagged as known, it's just "an egg" */
                if (!obj.known && obj.corpsenm !== NON_PM)
                    res = 1;
                obj.known = 1;
                /* [should this call learn_egg_type()?] */
            }
            if (res)
                learn_it = true;
            break;
        case WAN_STRIKING:
        case SPE_FORCE_BOLT:
            /* learn the type if you see or hear something break
               (the sound could be implicit) */
            maybelearnit = cansee(obj.ox, obj.oy) || !(await import('./display.js')).Deaf_hero();
            if (obj.otyp === BOULDER) {
                if (cansee(obj.ox, obj.oy)) await pline('The boulder falls apart.');
                else await You_hear('a crumbling sound.');
                await fracture_rock(obj);
            } else if (obj.otyp === STATUE) {
                if (await break_statue(obj)) {
                    if (cansee(obj.ox, obj.oy)) {
                        if (Hallucination()) {
                            const { rndmonnam } = await import('./do_name.js');
                            await pline(`The ${rndmonnam()} shatters.`);
                        } else
                            await pline('The statue shatters.');
                    } else
                        await You_hear('a crumbling sound.');
                }
            } else {
                const oox = obj.ox, ooy = obj.oy;
                const DT = await import('./dothrow.js');
                const broke = game.context?.mon_moving
                    ? await DT.breaks(obj, oox, ooy)
                    : await DT.hero_breaks(obj, oox, ooy, 0);
                if (!broke)
                    maybelearnit = false; /* nothing broke */
                else
                    /* obj broke; force redisplay in case it was the only--
                       or last--item under non-breaking pile-top; top item
                       here might now be a lone object rather than a pile */
                    newsym_force(oox, ooy);
                res = 0;
            }
            if (maybelearnit)
                learn_it = true;
            break;
        case WAN_CANCELLATION:
        case SPE_CANCELLATION:
            await cancel_item(obj);
            newsym(obj.ox, obj.oy); /* might change color */
            break;
        case SPE_DRAIN_LIFE:
            await drain_item(obj, true);
            break;
        case WAN_TELEPORTATION:
        case SPE_TELEPORT_AWAY: {
            // C ref: zap.c:2321-2328 — rloco(obj) then maybe_unhide_at(ox, oy).
            const ox = obj.ox, oy = obj.oy;
            const { rloco } = await import('./teleport.js');
            await rloco(obj);
            const { maybe_unhide_at } = await import('./monmove.js');
            await maybe_unhide_at(ox, oy);
            break;
        }
        case WAN_MAKE_INVISIBLE:
            break;
        case WAN_UNDEAD_TURNING:
        case SPE_TURN_UNDEAD:
            if (obj.otyp === EGG) {
                await revive_egg(obj);
            } else if (obj.otyp === CORPSE) {
                const by_u = !game.context?.mon_moving;
                const { corpse_revive_type } = await import('./mkobj.js');
                const { cxname_singular, The } = await import('./objnam.js');
                const corpsenm = corpse_revive_type(obj);
                let corpsname = cxname_singular(obj);
                let ox, oy;

                /* get corpse's location before revive() uses it up */
                const { get_obj_location } = await import('./light.js');
                const loc = get_obj_location(obj, 0);
                if (loc) { ox = loc.x; oy = loc.y; }
                else { ox = obj.ox; oy = obj.oy; } /* won't happen */

                /* explicit revival magic overrides timer-based no-revive */
                const save_norevive = obj.norevive;
                obj.norevive = 0;

                const mtmp = await revive(obj, true);
                if (!mtmp) {
                    obj.norevive = save_norevive;
                    res = 0; /* no monster implies corpse was left intact */
                } else {
                    const cptr = await mons_(corpsenm);
                    const pname = !!cptr && (mflags2_of(cptr) & M2_PNAME) !== 0;
                    if (cansee(ox, oy)) {
                        if (canspotmon(mtmp)) {
                            const { noname_monnam } = await import('./do_name.js');
                            await pline(`${upstart(noname_monnam(mtmp, 1 /* ARTICLE_THE */))} is resurrected!`);
                            learn_it = by_u ? true : !!game.zap_oseen;
                        } else {
                            /* saw corpse but don't see monster: maybe
                               mtmp is invisible, or has been placed at
                               a different spot than <ox,oy> */
                            if (!pname)
                                corpsname = The(corpsname);
                            await pline(`${corpsname} disappears.`);
                        }
                    } else {
                        /* couldn't see corpse's location */
                        if (Role_if_z(PM_HEALER_ROLE)
                            && !(await import('./display.js')).Deaf_hero()
                            && !nonliving_ptr(cptr)) {
                            if (!pname)
                                corpsname = an_z(corpsname);
                            if (!Hallucination())
                                await You_hear(`${corpsname} reviving.`);
                            else
                                await You_hear('a defibrillator.');
                            learn_it = by_u ? true : !!game.zap_oseen;
                        }
                        if (canspotmon(mtmp))
                            /* didn't see corpse but do see monster: it
                               has been placed somewhere other than <ox,oy>
                               or blind hero spots it with ESP */
                            await pline(`${Monnam(mtmp)} appears.`);
                    }
                    if (learn_it)
                        exercise(A_WIS, true);
                }
            }
            break;
        case WAN_OPENING:
        case SPE_KNOCK:
        case WAN_LOCKING:
        case SPE_WIZARD_LOCK:
            if (Is_box_z(obj))
                res = await boxlock_pline(obj, otmp);
            else
                res = 0;
            if (res)
                learn_it = true;
            break;
        case WAN_SLOW_MONSTER: /* no effect on objects */
        case SPE_SLOW_MONSTER:
        case WAN_SPEED_MONSTER:
        case WAN_NOTHING:
        case SPE_HEALING:
        case SPE_EXTRA_HEALING:
            res = 0;
            break;
        case SPE_STONE_TO_FLESH:
            res = await stone_to_flesh_obj(obj);
            break;
        default:
            await impossible(`What an interesting effect (${otmp.otyp})`);
            break;
        }
    /* if effect was observable then discover the wand type provided
       that the wand itself has been seen */
    if (learn_it)
        learnwand(otmp);
    return res;
}

// C ref: zap.c:5537 — preserve the object while fracturing it into rocks.
export async function fracture_rock(obj) {
    const by_you = !game.context?.mon_moving;
    if (by_you) {
        const { get_obj_location } = await import('./light.js');
        const { costly_spot, billable, shkname } = await import('./shk.js');
        const loc = get_obj_location(obj, 0);
        if (loc && costly_spot(loc.x, loc.y)) {
            const shkp = billable(null, obj, in_rooms(loc.x, loc.y, SHOPBASE)[0], false);
            if (shkp) {
                const { s_suffix } = await import('./hacklib.js');
                await pline(`You fracture ${s_suffix(shkname(shkp))} ${xname(obj)}.`);
                const { breakobj } = await import('./dothrow.js');
                await breakobj(obj, loc.x, loc.y, true, false);
            }
        }
        if (obj.otyp === BOULDER) {
            const { sokoban_guilt } = await import('./trap.js');
            sokoban_guilt();
        }
    }
    obj.otyp = ROCK;
    obj.oclass = GEM_CLASS;
    obj.quan = rn1(60, 7);
    obj.owt = weight_of(obj);
    obj.dknown = obj.bknown = obj.rknown = 0;
    obj.known = objects[ROCK]?.oc_uses_known ? 0 : 1;
    const { dealloc_oextra } = await import('./mkobj.js');
    dealloc_oextra(obj);
    if (obj.where === OBJ_FLOOR) {
        const x = obj.ox, y = obj.oy;
        obj_extract_self(obj);
        place_object(obj, x, y);
        recalc_block_point(x, y);
        if (!does_block(x, y)) vision_recalc(0);
        if (cansee(x, y)) newsym(x, y);
    }
}

// C ref: zap.c:5582 — statues release their contents before fracturing.
export async function break_statue(obj) {
    const { t_at, activate_statue_trap } = await import('./trap.js');
    const { STATUE_TRAP } = await import('./const.js');
    const trap = t_at(obj.ox, obj.oy);
    if (trap?.ttyp === STATUE_TRAP
        && await activate_statue_trap(trap, obj.ox, obj.oy, true)) return false;
    for (const item of [...(obj.cobj || [])]) {
        obj_extract_self(item);
        place_object(item, obj.ox, obj.oy);
    }
    const { CORPSTAT_HISTORIC } = await import('./const.js');
    if (!game.context?.mon_moving && game.urole?.mnum === 0 /* Archeologist */
        && (obj.spe & CORPSTAT_HISTORIC)) {
        await pline('You feel guilty about damaging such a historic statue.');
        const { adjalign } = await import('./attrib.js');
        adjalign(-1);
    }
    obj.spe = 0;
    await fracture_rock(obj);
    return true;
}



// C ref: zap.c bhitpile — apply fhito to every object stacked at (tx,ty).  C's
// level.objects[tx][ty] chain is newest-first (place_object prepends); our flat
// game.level.objects is oldest-first, so iterate in reverse to match C's
// traversal order — order determines the obj_resists/obj_shudders/mkobj RNG sequence.
// `zz` is the up/down direction for a hero hiding under the top item.
export async function bhitpile(obj, tx, ty, zz = 0) {
    const u = game.u;
    const here = pile_at(tx, ty);
    if (!here.length) return 0;

    /* if hiding underneath an object and zapping up or down, the top item
       is either the only thing hit (up) or is skipped (down) */
    const hidingunder = (zz !== 0 && !!u?.uundetected
                         && hides_under_flag(await youmonst_data_z()));
    let first = true;
    let hitanything = 0;

    if (obj.otyp === SPE_FORCE_BOLT || obj.otyp === WAN_STRIKING) {
        const { t_at, activate_statue_trap } = await import('./trap.js');
        const t = t_at(tx, ty);
        const topofpile = here[0];

        /* We can't settle for the default calling sequence of
           bhito(otmp) -> break_statue(otmp) -> activate_statue_trap(ox,oy)
           because that last call might end up operating on our `next_obj'
           (below), rather than on the current object, if it happens to
           encounter a statue which mustn't become animated. */
        if (t && t.ttyp === STATUE_TRAP
            && await activate_statue_trap(t, tx, ty, true))
            learnwand(obj);
        /* assume zapping up or down while hiding under the top item can
           still activate the trap even if it's below (when zapping up)
           or above (when zapping down) */
        if (pile_at(tx, ty)[0] !== topofpile)
            first = false; /* top item was statue which activated */
    }

    game.poly_zapped = -1;
    // C captures next_obj before each hit; the snapshot of the (possibly
    // statue-trap-altered) pile gives the same traversal.
    for (const otmp of pile_at(tx, ty)) {
        if (hidingunder) {
            if (first) {
                first = false; /* reset for next item */
                if (zz > 0) /* down when hiding-under skips first item */
                    continue;
            } else {
                /* !first */
                if (zz < 0) /* up when hiding-under skips rest of pile */
                    continue;
            }
        }
        // object may already have been freed/replaced; re-validate on the floor.
        if (otmp.where !== OBJ_FLOOR || otmp.ox !== tx || otmp.oy !== ty) continue;
        hitanything += await bhito(otmp, obj);
    }

    // C: `if (gp.poly_zapped >= 0) create_polymon(svl.level.objects[tx][ty],
    // gp.poly_zapped)`.  do_osshock() sets poly_zapped to the shocked object's
    // material with probability 1/(Luck+45) PER ITEM, so a pile of any size
    // reaches this regularly.  create_polymon() draws makemon() plus polyuse()'s
    // per-object obj_resists()/rn2(minwt+1) rolls.  C passes the pile AS IT IS
    // NOW, which includes the replacement objects poly_obj() spliced in.
    if (game.poly_zapped >= 0)
        await create_polymon(pile_at(tx, ty), game.poly_zapped);

    /* when boulders are present they're expected to be on top; with
       multiple boulders it's possible for some to have been changed into
       non-boulders (polymorph, stone-to-flesh) while ones beneath resist,
       so re-stack pile if there are any non-boulders above boulders */
    let prevotyp = BOULDER;
    for (const otmp of pile_at(tx, ty)) {
        if (otmp.otyp === BOULDER && prevotyp !== BOULDER) {
            (await import('./mkobj.js')).recreate_pile_at(tx, ty);
            break;
        }
        prevotyp = otmp.otyp;
    }

    if (hidingunder) /* pile might have been destroyed or dispersed */
        await (await import('./monmove.js')).maybe_unhide_at(tx, ty);

    (await import('./trap.js')).fill_pit(tx, ty);

    return hitanything;
}

// C's nexthere chain, newest-first; our flat array is oldest-first.
function pile_at(tx, ty) {
    const arr = game.level?.objects || [];
    const out = [];
    for (let i = arr.length - 1; i >= 0; i--) {
        const o = arr[i];
        if (o.where === OBJ_FLOOR && o.ox === tx && o.oy === ty) out.push(o);
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
    let idx = 0;
    if (game.context?.bypasses) {
        /* this is approximate because the "no golems" !obj->nexthere
           check below doesn't understand bypassed objects; but it
           should suffice since bypassed objects always end up as a
           consecutive group at the top of their pile */
        while (pile && idx < pile.length && pile[idx].bypass) idx++;
    }
    const obj = pile && pile[idx];
    /* no golems if you zap only one object -- not enough stuff */
    if (!obj || (idx === pile.length - 1 && (obj.quan || 1) === 1)) return;

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
    await polyuse(pile.slice(idx), okind, mdat?.cwt | 0);
    if (mtmp && cansee(mtmp.mx, mtmp.my))
        await pline(`Some ${material}objects meld, and ${x_monnam(mtmp, 2)} arises from the pile!`);
}

// C ref: zap.c polyuse(objhdr, mat, minwt) — consume pile members to build the
// golem.  Each survivor still pays obj_resists()'s rn2(100) and the
// rn2(minwt + 1) material test.
async function polyuse(pile, mat, minwt) {
    for (const otmp of pile) {
        if (minwt <= 0) break;
        if (game.context?.bypasses && otmp.bypass) continue;
        if (otmp === game.uball || otmp === game.uchain) continue;
        if (otmp.where !== OBJ_FLOOR) continue;
        if (obj_resists(otmp, 0, 0)) continue; /* preserve unique objects */
        if (((objects[otmp.otyp]?.material | 0) === mat) === (rn2(minwt + 1) !== 0)) {
            /* appropriately add damage to bill */
            const shk = await import('./shk.js');
            if (shk.costly_spot(otmp.ox, otmp.oy)) {
                if (game.u?.ushops && game.u.ushops[0])
                    await (await import('./shkroom.js')).addtobill(otmp, false, false, false);
                else
                    await shk.stolen_value(otmp, otmp.ox, otmp.oy, false, false);
            }
            minwt -= (otmp.quan || 1);
            delobj(otmp);
        }
    }
}

// C ref: zap.c bhit(...) restricted to its ZAPPED_WAND flavour — walk the wand
// beam from the hero in (ddx,ddy) up to range squares, applying bhitm to
// monsters and bhitpile to floor objects.  The thrown/kicked/flash/mirror
// flavours live with their callers (invent.js, dokick.js, apply.js), which
// carry their own tmp_at(DISP_FLASH/DISP_TETHER, obj_to_glyph()) animation; a
// zapped wand draws none (C: `weapon != ZAPPED_WAND` guards every tmp_at).
// Sets gb.bhitpos like C, which bhitm()/hit()/miss() read.
async function bhit(ddx, ddy, range, obj) {
    const u = game.u;
    let result = null;
    let shopdoor = false;
    game.bhitpos = { x: u.ux, y: u.uy };
    while (range-- > 0) {
        game.bhitpos.x += ddx;
        game.bhitpos.y += ddy;
        const x = game.bhitpos.x, y = game.bhitpos.y;

        if (!isok(x, y)) {
            game.bhitpos.x -= ddx;
            game.bhitpos.y -= ddy;
            break;
        }

        const loc = game.level?.at?.(x, y);
        /* cancellation/opening/locking/striking/probing */
        await zap_map(x, y, obj);
        /* terrain might have changed (exposed secret door|corridor) */
        const typ = loc?.typ;

        const mtmp = m_at(x, y);
        if (mtmp) {
            game.notonhead = (x !== mtmp.mx || y !== mtmp.my);
            if (await bhitm(mtmp, obj)) {
                result = mtmp;
                return result; /* bhit_done: skips the shopdoor payment */
            }
            range -= 3;
        } else if (obj.otyp === WAN_PROBING && loc?.invisMon) {
            unmap_object(x, y);
            newsym(x, y);
        }
        if (await bhitpile(obj, x, y)) range--;

        if (IS_DOOR(typ) || typ === SDOOR) {
            switch (obj.otyp) {
            case WAN_OPENING:
            case WAN_LOCKING:
            case WAN_STRIKING:
            case SPE_KNOCK:
            case SPE_WIZARD_LOCK:
            case SPE_FORCE_BOLT: {
                const { doorlock } = await import('./lock.js');
                if (await doorlock(obj, x, y)) {
                    if (cansee(x, y) || (obj.otyp === WAN_STRIKING
                                         && !(await import('./display.js')).Deaf_hero()))
                        learnwand(obj);
                    if (loc.doormask === D_BROKEN && in_rooms(x, y, SHOPBASE)[0]) {
                        shopdoor = true;
                        const { add_damage } = await import('./shk.js');
                        await add_damage(x, y, SHOP_DOOR_COST);
                    }
                }
                break;
            }
            default:
                break;
            }
        }

        if (!ZAP_POS(typ) || closed_door_at(x, y)) {
            game.bhitpos.x -= ddx;
            game.bhitpos.y -= ddy;
            break;
        }
    }
    if (shopdoor) {
        const { pay_for_damage } = await import('./shk.js');
        await pay_for_damage('destroy', false);
    }
    return result;
}

// C ref: monmove.c closed_door() (local copy; hack.js's isn't exported).
function closed_door_at(x, y) {
    const loc = game.level?.at?.(x, y);
    if (!loc) return false;
    return IS_DOOR(loc.typ) && !!(loc.doormask & (D_CLOSED | D_LOCKED));
}

// C ref: zap.c bhitm — a wand/spell effect hitting one monster.  Every per-otyp
// branch below follows C's order of RNG draws and messages, including the
// disguised-mimic reveals, reveal_invis' trailing map_invisible(), and the
// wake tail's m_respond()/hot_pursuit().
const S_MIMIC_Z = 13;   // defsym.h class index (S_VORTEX_Z/S_GOLEM_Z: below)
const PM_HEALER_ROLE = 3;                               // roles[] index
const S_vodoor_Z = 13, S_hcdoor_Z = 16;                  // is_cmap_door() span
function is_whirly_z(ptr) {
    return !!ptr && (ptr.mcls === S_VORTEX_Z || ptr.name === 'air elemental');
}
export async function bhitm(mtmp, otmp) {
    if (!mtmp || !otmp) return 0;
    const u = game.u;
    let ret = 0;
    let wake = true;            /* most 'zaps' should wake monster */
    let reveal_invis = false, learn_it = false, helpful_gesture = false;
    let dmg, obj;
    const otyp = otmp.otyp;
    const dbldam = Role_if_z(PM_KNIGHT_ROLE) && !!u?.uhave?.questart;
    const skilled_spell = (otmp.oclass === SPBOOK_CLASS && !!otmp.blessed);
    let zap_type_text = 'spell';
    const disguised_mimic = (mtmp.data?.mcls === S_MIMIC_Z
                             && M_AP_TYPE(mtmp) !== M_AP_NOTHING);
    /* box_or_door(): mimic appearances that have locks */
    const box_or_door = (m) =>
        (M_AP_TYPE(m) === M_AP_OBJECT
         && (m.mappearance === CHEST || m.mappearance === LARGE_BOX))
        || (M_AP_TYPE(m) === M_AP_FURNITURE
            && m.mappearance >= S_vodoor_Z && m.mappearance <= S_hcdoor_Z);
    const seemimic_mon = async () => {
        const { seemimicLocal } = await import('./uhitm.js');
        seemimicLocal(mtmp);
    };

    if (engulfing_u(mtmp))
        reveal_invis = false;

    // C: gb.bhitpos is the beam's current square; swallowed/steed/broken-wand
    // callers fall back to the monster's own square.
    const bp = game.bhitpos || { x: mtmp.mx, y: mtmp.my };
    game.notonhead = (mtmp.mx !== bp.x || mtmp.my !== bp.y);

    switch (otyp) {
    case WAN_STRIKING:
        zap_type_text = 'wand';
        /* FALLTHRU */
    case SPE_FORCE_BOLT:
        reveal_invis = true;
        learn_it = cansee(bp.x, bp.y);
        if (resists_magm(mtmp)) { /* match effect on player */
            if (disguised_mimic && !disguised_as_mon(mtmp))
                await seemimic_mon();
            await shieldeff(mtmp.mx, mtmp.my);
            await pline('Boing!');
            /* 5.0: used to 'break' to avoid setting learn_it here */
        } else if (u?.uswallow || rnd(20) < 10 + find_mac(mtmp)) {
            if (disguised_mimic)
                await seemimic_mon();
            dmg = d(2, 12);
            if (dbldam) dmg *= 2;
            if (otyp === SPE_FORCE_BOLT) dmg = spell_damage_bonus(dmg);
            await hit(zap_type_text, mtmp, exclam(dmg));
            await resist_damage(mtmp, otmp.oclass, dmg, true);
        } else {
            if (!disguised_mimic)
                await miss(zap_type_text, mtmp);
            learn_it = false;
        }
        break;

    case WAN_SLOW_MONSTER:
    case SPE_SLOW_MONSTER:
        if (!resist(mtmp, otmp.oclass, 0, false)) {
            if (disguised_mimic)
                await seemimic_mon();
            const { mon_adjust_speed } = await import('./muse.js');
            await mon_adjust_speed(mtmp, -1, otmp);
            (await import('./mon.js')).check_gear_next_turn(mtmp); /* might want speed boots */

            if (engulfing_u(mtmp) && is_whirly_z(mtmp.data)) {
                await pline(`You disrupt ${mon_nam(mtmp)}!`);
                await pline('A huge hole opens up...');
                const { expels } = await import('./mhitu.js');
                await expels(mtmp, mtmp.data, true);
            }
        }
        break;

    case WAN_SPEED_MONSTER:
        if (!resist(mtmp, otmp.oclass, 0, false)) {
            if (disguised_mimic)
                await seemimic_mon();
            const { mon_adjust_speed } = await import('./muse.js');
            await mon_adjust_speed(mtmp, 1, otmp);
            (await import('./mon.js')).check_gear_next_turn(mtmp); /* might want speed boots */
        }
        helpful_gesture = true;  /* wake but don't anger a peaceful target */
        break;

    case WAN_UNDEAD_TURNING:
    case SPE_TURN_UNDEAD:
        wake = false;
        if (await unturn_dead(mtmp))
            wake = true;
        if (is_undead_flag(mtmp.data) || is_vampshifter(mtmp)) {
            reveal_invis = true;
            wake = true;
            dmg = rnd(8);
            if (dbldam) dmg *= 2;
            if (otyp === SPE_TURN_UNDEAD) dmg = spell_damage_bonus(dmg);
            if (game.context) game.context.bypasses = true; /* for make_corpse() */
            if (!(await resist_damage(mtmp, otmp.oclass, dmg, false))) {
                if (!DEADMONSTER(mtmp))
                    await monflee(mtmp, 0, false, true);
            }
        }
        break;

    case WAN_POLYMORPH:
    case SPE_POLYMORPH:
    case POT_POLYMORPH: {
        const mk = await import('./makemon.js');
        const PM_LONG_WORM_Z = await PM_('long worm');
        const has_mcorpsenm_z = (m) => !!m?.mextra && MCORPSENM(m) !== NON_PM;
        if (mtmp.data?.pmidx === PM_LONG_WORM_Z && has_mcorpsenm_z(mtmp)) {
            /* if a long worm has mcorpsenm set, it was polymorphed by
               the current zap and shouldn't be affected if hit again */
        } else if (resists_magm(mtmp)) {
            /* magic resistance protects from polymorph traps, so make
               it guard against involuntary polymorph attacks too... */
            await shieldeff(mtmp.mx, mtmp.my);
        } else if (!resist(mtmp, otmp.oclass, 0, false)) {
            const polyspot = (otyp !== POT_POLYMORPH),
                  give_msg = (!Hallucination()
                              && (canseemon_z(mtmp) || engulfing_u(mtmp)));

            /* dropped inventory (due to death by system shock,
               or loss of wielded weapon and/or worn armor due to
               limitations of new shape) won't be hit by this zap */
            if (polyspot) {
                const { bypass_obj } = await import('./worn.js');
                for (const o of (mtmp.minvent || [])) bypass_obj(o);
            }

            /* natural shapechangers aren't affected by system shock
               (unless protection from shapechangers is interfering
               with their metabolism...) */
            if ((mtmp.cham ?? NON_PM) === NON_PM && !rn2(25)) {
                if (canseemon_z(mtmp)) {
                    await pline(`${Monnam(mtmp)} shudders!`);
                    learn_it = true;
                }
                /* no corpse after system shock */
                await killed(mtmp, { nocorpse: true });
            } else {
                let ncflags = NO_NC_FLAGS;
                if (polyspot) ncflags |= NC_VIA_WAND_OR_SPELL;
                if (give_msg) ncflags |= NC_SHOW_MSG;
                // newcham_wizard_aware (not plain newcham): a wand/spell/potion
                // of polymorph on a monster is wizard mode's own natural way to
                // test 'monpolycontrol' (mon.c's post-switch override).
                let changed = (await mk.newcham_wizard_aware(mtmp, null, ncflags)) !== 0;
                /* if shapechange failed because there aren't enough eligible
                   candidates (most likely for vampshifter), try reverting to
                   original form */
                if (!changed && (mtmp.cham ?? NON_PM) >= 0)
                    changed = (await mk.newcham_wizard_aware(
                        mtmp, await mons_(mtmp.cham), ncflags)) !== 0;
                if (changed && give_msg
                    && (canspotmon(mtmp) || engulfing_u(mtmp)))
                    learn_it = true;
            }

            /* do this even if polymorphed failed (otherwise using
               flags.mon_polycontrol prompting to force mtmp to remain
               'long worm' would prompt again if zap hit another segment) */
            if (!DEADMONSTER(mtmp) && mtmp.data?.pmidx === PM_LONG_WORM_Z) {
                if (!has_mcorpsenm_z(mtmp))
                    mk.newmcorpsenm(mtmp);
                /* flag to indicate that mtmp became a long worm
                   on current zap, so further hits (on mtmp's new
                   tail) don't do further transforms */
                mtmp.mextra.mcorpsenm = PM_LONG_WORM_Z;
                /* flag to indicate that cleanup is needed; object
                   bypass cleanup also clears mon->mextra->mcorpsenm
                   for all long worms on the level */
                if (game.context) game.context.bypasses = true;
            }
        }
        break;
    }

    case WAN_CANCELLATION:
    case SPE_CANCELLATION:
        if (disguised_mimic)
            await seemimic_mon();
        await cancel_monst(mtmp, otmp, true, true, false);
        break;

    case WAN_TELEPORTATION:
    case SPE_TELEPORT_AWAY: {
        if (disguised_mimic)
            await seemimic_mon();
        const { u_teleport_mon } = await import('./teleport.js');
        reveal_invis = !(await u_teleport_mon(mtmp, true));
        learn_it = canspotmon(mtmp);
        break;
    }

    case WAN_MAKE_INVISIBLE: {
        const oldinvis = mtmp.minvis;
        const couldsee = canseemon_z(mtmp);

        if (disguised_mimic)
            await seemimic_mon();
        /* format monster's name before altering its visibility */
        const nambuf = Monnam(mtmp);
        await (await import('./worn.js')).mon_set_minvis(mtmp, false);
        const { knowninvisible } = await import('./display.js');
        if (!oldinvis && knowninvisible(mtmp)) {
            await pline(`${nambuf} turns transparent!`);
            reveal_invis = true;
            learn_it = true;
        } else if (couldsee && !canseemon_z(mtmp)) {
            /* keep the immediate effects of make invisible and teleportation
               ambiguous by using the same message that's used if we
               teleported mtmp (and it ended up somewhere you can't see) */
            await pline(`${nambuf} vanishes!`);
        }
        break;
    }

    case WAN_LOCKING:
    case SPE_WIZARD_LOCK: {
        if (disguised_mimic && box_or_door(mtmp)) {
            const { that_is_a_mimic } = await import('./uhitm.js');
            await that_is_a_mimic(mtmp, MIM_REVEAL); /*seemimic()*/
        }
        const noticed = { value: learn_it };
        const { closeholdingtrap } = await import('./trap.js');
        wake = await closeholdingtrap(mtmp, noticed);
        learn_it = noticed.value;
        break;
    }

    case WAN_PROBING:
        wake = false;
        reveal_invis = true;
        await probe_monster(mtmp);
        learn_it = true;
        break;

    case WAN_OPENING:
    case SPE_KNOCK: {
        if (disguised_mimic && box_or_door(mtmp)) {
            const { that_is_a_mimic } = await import('./uhitm.js');
            await that_is_a_mimic(mtmp, MIM_REVEAL); /*seemimic()*/
        }
        wake = false; /* don't want immediate counterattack */
        const { openholdingtrap, openfallingtrap } = await import('./trap.js');
        if (mtmp === u?.ustuck) {
            /* zapping either holder/holdee or self [zapyourself()] will
               release hero from holder's grasp or holdee from hero's grasp */
            await release_hold();
            learn_it = true;

        /* zap which hits steed will only release saddle if it
           doesn't hit a holding or falling trap; playability
           here overrides the more logical target ordering */
        } else {
            const noticed = { value: learn_it };
            if (await openholdingtrap(mtmp, noticed)) {
                learn_it = noticed.value;
                break;
            }
            if (await openfallingtrap(mtmp, true, noticed)) {
                learn_it = noticed.value;
                /* mtmp might now be on the migrating monsters list */
                break;
            }
            learn_it = noticed.value;
            if (otyp === SPE_KNOCK) {
                wake = true;
                ret = 1;
                const { m_is_steadfast } = await import('./uhitm.js');
                if ((mtmp.data?.msize | 0) < 2 /* MZ_HUMAN */ && !(await m_is_steadfast(mtmp))) {
                    if (canseemon_z(mtmp))
                        await pline(`${Monnam(mtmp)} is knocked back!`);
                    const { mhurtle } = await import('./dothrow.js');
                    await mhurtle(mtmp, mtmp.mx - u.ux, mtmp.my - u.uy, rnd(2));
                } else {
                    if (canseemon_z(mtmp))
                        await pline(`${Monnam(mtmp)} doesn't budge.`);
                }
                if (!DEADMONSTER(mtmp)) {
                    await wakeup(mtmp, !(mflags1_of(mtmp.data) & M1_MINDLESS));
                    const { abuse_dog } = await import('./uhitm.js');
                    await abuse_dog(mtmp);
                }
            } else if ((obj = which_armor(mtmp, W_SADDLE)) != null) {
                let buf = `${s_suffix(Monnam(mtmp))} ${distant_name_pub(obj, xname)}`;
                if (cansee(mtmp.mx, mtmp.my)) {
                    if (!canspotmon(mtmp))
                        buf = An_z(distant_name_pub(obj, xname));
                    const { surface } = await import('./dungeon.js');
                    await pline(`${buf} falls to the ${surface(mtmp.mx, mtmp.my)}.`);
                } else if (canspotmon(mtmp)) {
                    await pline(`${buf} falls off.`);
                }
                const { mdrop_obj } = await import('./dogmove.js');
                await mdrop_obj(mtmp, obj, false);
            }
        }
        break;
    }

    case SPE_HEALING:
    case SPE_EXTRA_HEALING: {
        const healamt = d(6, otyp === SPE_EXTRA_HEALING ? 8 : 4);

        reveal_invis = true;
        if (mtmp.data?.pmidx !== await PM_('Pestilence')) {
            const delta = mtmp.mhpmax - mtmp.mhp;
            const { healmon } = await import('./mon.js');

            wake = false; /* wakeup() makes the target angry */
            healmon(mtmp, healamt, 0);
            /* plain healing must be blessed to cure blindness; extra
               healing only needs to not be cursed, so spell always cures
               [potions quaffed by monsters behave slightly differently;
               we use the rules for the hero here...] */
            if (skilled_spell || otyp === SPE_EXTRA_HEALING) {
                const { mcureblindness } = await import('./muse.js');
                await mcureblindness(mtmp, canseemon_z(mtmp));
            }
            if (canseemon_z(mtmp)) {
                if (disguised_mimic) {
                    if (M_AP_TYPE(mtmp) === M_AP_OBJECT
                        && mtmp.mappearance === 0 /* STRANGE_OBJECT */) {
                        /* it can do better now */
                        (await import('./makemon.js')).set_mimic_sym(mtmp);
                        newsym(mtmp.mx, mtmp.my);
                    } else {
                        await (await import('./mon.js')).mimic_hit_msg(mtmp, otyp);
                    }
                } else {
                    await pline(`${Monnam(mtmp)} looks${
                        otyp === SPE_EXTRA_HEALING ? ' much' : ''} better.`);
                }
            }
            if (mtmp.mtame && Role_if_z(PM_HEALER_ROLE) && delta > 0) {
                more_experienced(Math.min(delta, healamt), 0);
                await (await import('./exper.js')).newexplevel();
            }
            if (mtmp.mtame || mtmp.mpeaceful) {
                const { adjalign } = await import('./attrib.js');
                adjalign(Role_if_z(PM_HEALER_ROLE) ? 1
                         : Math.sign(u.ualign?.type | 0));
            }
        } else { /* Pestilence */
            /* Pestilence will always resist; damage is half of (healamt/2) */
            await resist_damage(mtmp, otmp.oclass, Math.trunc(healamt / 2), true);
        }
        break;
    }

    case WAN_LIGHT:  /* (broken wand) */
        if (await (await import('./uhitm.js')).flash_hits_mon(mtmp, otmp)) {
            learn_it = true;
            reveal_invis = true;
        }
        break;

    case WAN_SLEEP:  /* (broken wand) */
        /* [wakeup() doesn't rouse victims of temporary sleep,
           so it's okay to leave `wake' set to TRUE here;
           revealing concealed mimic is handled by sleep_monst()] */
        reveal_invis = true;
        if (await sleep_monst(mtmp, d(1 + (otmp.spe | 0), 12), WAND_CLASS))
            await slept_monst(mtmp);
        if (!Blind()) learn_it = true;
        break;

    case SPE_STONE_TO_FLESH:
        if (mtmp.data?.mcls === S_GOLEM_Z) {
            let mesg;
            const name = Monnam(mtmp); /* before possible polymorph */

            /* turn stone golem into flesh golem */
            if (mtmp.data.pmidx === await PM_('stone golem')
                && (await (await import('./makemon.js')).newcham_wizard_aware(
                    mtmp, await mons_(await PM_('flesh golem')), NO_NC_FLAGS)))
                mesg = 'turns to flesh!';
            else if (mtmp.data.pmidx === await PM_('flesh golem'))
                mesg = 'seems fleshier...';
            else
                mesg = 'looks rather fleshy for a moment.';

            if (canseemon_z(mtmp))
                await pline(`${name} ${mesg}`);
        } else if (mtmp.data?.mcls === S_MIMIC_Z
                   && ((M_AP_TYPE(mtmp) === M_AP_FURNITURE
                        && (await import('./mkobj.js')).stone_furniture_type(mtmp.mappearance))
                       || (M_AP_TYPE(mtmp) === M_AP_OBJECT
                           && (await import('./mkobj.js')).stone_object_type(mtmp.mappearance)))) {
            /* note: if that_is_a_mimic() doesn't get called to reveal the
               mimic, wakeup() below will call seemimic() */
            if (cansee(mtmp.mx, mtmp.my)) {
                const { that_is_a_mimic } = await import('./uhitm.js');
                await that_is_a_mimic(mtmp, MIM_REVEAL | MIM_OMIT_WAIT);
            }
        } else {
            wake = false;
        }
        break;

    case SPE_DRAIN_LIFE:
        if (disguised_mimic)
            await seemimic_mon();
        dmg = monhp_per_lvl(mtmp);
        if (dbldam) dmg *= 2;
        if (otyp === SPE_DRAIN_LIFE)
            dmg = spell_damage_bonus(dmg);
        if (await resists_drli_z(mtmp)) {
            await shieldeff(mtmp.mx, mtmp.my);
        } else if (!(await resist_damage(mtmp, otmp.oclass, dmg, false))
                   && !DEADMONSTER(mtmp)) {
            mtmp.mhp = (mtmp.mhp || 0) - dmg;
            mtmp.mhpmax = (mtmp.mhpmax || 0) - dmg;
            /* die if already level 0, regardless of hit points */
            if (DEADMONSTER(mtmp) || mtmp.mhpmax <= 0 || (mtmp.m_lev | 0) < 1) {
                await killed(mtmp);
            } else {
                mtmp.m_lev--;
                if (canseemon_z(mtmp))
                    await pline(`${Monnam(mtmp)} suddenly seems weaker!`);
            }
        }
        break;

    case WAN_NOTHING:
        wake = false;
        break;

    default:
        await impossible(`What an interesting effect (${otyp})`);
        break;
    }
    if (wake && !DEADMONSTER(mtmp)) {
        /* seemimic() is done by wakeup() and might unblock vision */
        await wakeup(mtmp, helpful_gesture ? false : true);
        const { m_respond } = await import('./monmove.js');
        await m_respond(mtmp);
        if (mtmp.isshk && !(u?.ushops && u.ushops[0])) {
            const { hot_pursuit } = await import('./shk.js');
            await hot_pursuit(mtmp);
        }
    }
    /* note: gb.bhitpos won't be set if swallowed, but that's okay since
     * reveal_invis will be false.  We can't use mtmp->mx, my since it
     * might be an invisible worm hit on the tail.
     */
    if (reveal_invis && !DEADMONSTER(mtmp)) {
        if (cansee(bp.x, bp.y) && !canspotmon(mtmp))
            map_invisible(bp.x, bp.y);
    }
    /* if effect was observable then discover the wand type provided
       that the wand itself has been seen */
    if (learn_it)
        learnwand(otmp);
    return ret;
}

// C ref: zap.c:6148-6155 resist()'s damaging tail.  Zero-damage callers
// use the synchronous saving throw; damaging callers must finish death first.
export async function resist_damage(mtmp, oclass, damage, tell, monster_using = false) {
    const resisted = resist(mtmp, oclass, damage, tell);
    if (damage && DEADMONSTER(mtmp)) {
        if (monster_using)
            await (await import('./mhitm.js')).monkilled_mm(mtmp, AD_RBRE, '');
        else
            await killed(mtmp);
    }
    return resisted;
}

// C ref: mondata.c resists_drli(mon) for a monster target: undead, demons,
// lycanthropes, Death and shapeshifted vampires shrug off level drain, as
// does a monster defended() against AD_DRLI.
async function resists_drli_z(mon) {
    const ptr = mon?.data;
    if (!ptr) return false;
    if (is_undead_flag(ptr) || is_demon_flag(ptr) || is_were_flag(ptr)
        || ptr.pmidx === await PM_('Death') || is_vampshifter(mon))
        return true;
    return defended(mon, AD_DRLI);
}

// C ref: zap.c spell_damage_bonus(dmg) — Intelligence/experience-level scaling
// for attack spells.  No RNG.
export function spell_damage_bonus(dmg) {
    // C: int intell = ACURR(A_INT), which includes attribute bonuses and
    // temporary changes on top of the base value.
    const intell = ACURR(A_INT);
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

// C ref: display.h canseemon(mon).  display.js exports the shared predicate
// under a different name.
function canseemon_z(mon) { return canseemon_shared(mon); }

// C ref: zap.c zapwrapup — after an IMMEDIATE zap, announce system shock once.
export async function zapwrapup() {
    if (game.obj_zapped)
        await pline('You feel shuddering vibrations.');
    game.obj_zapped = false;
}

// C ref: zap.c:3150 cancel_monst — resistance precedes cancellation and
// restoration of the target's natural shape; only self-zaps cancel inventory.
export async function cancel_monst(mdef, obj, youattack, allow_cancel_kill, self_cancel) {
    const u = game.u;
    const youdefend = mdef === u || mdef === game.youmonst;
    if (youdefend ? (!youattack && Antimagic())
                  : resist(mdef, obj.oclass, 0, false))
        return false;
    if (self_cancel) {
        for (const item of obj_chain(mdef)) await cancel_item(item);
        if (youdefend) find_ac();
    }
    if (youdefend) {
        if (u.Upolyd) {
            if (u.umonnum === PM_CLAY_GOLEM) {
                if (!Blind()) await pline('Some writing vanishes from your head!');
                else await pline(`You feel ${Hallucination() ? 'dark' : 'light'} headed.`);
                u.mh = 0;
            }
            if (Unchanging() && u.mh > 0) {
                await pline('Your amulet grows hot for a moment, then cools.');
            } else {
                const { rehumanize } = await import('./polyself.js');
                await rehumanize();
            }
        }
    } else {
        mdef.mcan = 1;
        const { normal_shape } = await import('./mon.js');
        await normal_shape(mdef);
        if (mdef.data?.pmidx === PM_CLAY_GOLEM) {
            if (canseemon_z(mdef))
                await pline(`Some writing vanishes from ${s_suffix(mon_nam(mdef))} head!`);
            if (allow_cancel_kill) {
                if (youattack) await killed(mdef);
                else await (await import('./mhitm.js')).monkilled_mm(mdef, AD_SPEL, '');
            }
        }
    }
    return true;
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
    const u = game.u;
    if (u.usteed && objects[otyp]?.dir !== NODIR && !u.dx && !u.dy
        && (u.dz | 0) > 0 && await zap_steed(obj)) {
        disclose = true;
    } else if (objects[otyp]?.dir === IMMEDIATE) {
        game.obj_zapped = false; /* zapsetup() */
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
        } else if (otyp >= SPE_MAGIC_MISSILE && otyp <= SPE_FINGER_OF_DEATH) {
            // C: ubuzz(BZ_U_SPELL(BZ_OFS_SPE(otyp)), u.ulevel / 2 + 1).  The
            // spell band (10..19) has its own flash names, to-hit bonus,
            // damage bonus and fireball explosion.  Its dice scale with
            // experience level instead of the wand's fixed 2 or 6.
            await ubuzz(BZ_U_SPELL(BZ_OFS_SPE(otyp)),
                        Math.trunc((game.u?.ulevel | 0) / 2) + 1);
        } else if (otyp >= WAN_MAGIC_MISSILE && otyp <= WAN_LIGHTNING) {
            await ubuzz(BZ_U_WAND(BZ_OFS_WAN(otyp)),
                        (otyp === WAN_MAGIC_MISSILE) ? 2 : 6);
        } else {
            await impossible('weffects: unexpected spell or wand');
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

// C ref: zap.c zap_updown(obj) — an IMMEDIATE wand zapped at '<' or '>'.
// Returns C's `disclose`.
function Is_qstart_z() {
    const uz = game.u?.uz, q = game.qstart_level;
    return !!(uz && q && uz.dnum === q.dnum && uz.dlevel === q.dlevel);
}
function Levitation_z() {
    const p = game.u?.uprops;
    return !!(p?.Levitation || p?.HLevitation || p?.ELevitation);
}
async function zap_updown(obj) {
    const u = game.u;
    let striking = false, disclose = false;
    const map_zapped = false;
    const x = u.ux, y = u.uy;      /* <x,y> is zap location */
    const { t_at, openholdingtrap, openfallingtrap, closeholdingtrap, dotrap } =
        await import('./trap.js');
    const dungeon = await import('./dungeon.js');
    const db = await import('./dbridge.js');
    const ttmp = t_at(x, y);       /* trap if there is one */
    const lev = game.level?.at(x, y);

    /* some wands have special effects other than normal bhitpile */
    switch (obj.otyp) {
    case WAN_PROBING: {
        let ptmp = 0;
        if (u.dz < 0) {
            await pline(`You probe towards the ${dungeon.ceiling(x, y)}.`);
        } else { /* down */
            let surf;
            const rememberedltyp = await dungeon.update_mapseen_for(x, y);

            ptmp += await bhitpile(obj, x, y, u.dz);
            /* sequencing: zap_map() calls force_decor() for ice or furniture;
               we need to call it before probing for buried objects */
            const ltyp = (lev.typ === DRAWBRIDGE_UP)
                ? db.db_under_typ(lev.drawbridgemask) : lev.typ;
            await zap_map(x, y, obj);
            if (ltyp === ICE || IS_FURNITURE(ltyp)) {
                surf = 'it';
                if (game.lastseentyp?.[x]?.[y] !== rememberedltyp)
                    ptmp += 1;
            } else {
                const { the } = await import('./objnam.js');
                surf = the(dungeon.surface(x, y));
            }
            await pline(`You probe beneath ${surf}.`);
            ptmp += display_binventory(x, y, true);
        }
        if (!ptmp)
            await pline('Your probe reveals nothing.');
        return true; /* we've done our own bhitpile */
    }
    case WAN_OPENING:
    case SPE_KNOCK: {
        let stway = game.stairs;
        while (stway) {
            if (!stway.isladder && !stway.up
                && stway.tolev?.dnum === u.uz?.dnum)
                break;
            stway = stway.next;
        }
        /* up or down, but at closed portcullis only */
        const fd = db.find_drawbridge(x, y);
        if (db.is_db_wall(x, y) && fd.ok) {
            await db.open_drawbridge(fd.x, fd.y);
            disclose = true;
        } else if (u.dz > 0 && stway && stway.sx === x && stway.sy === y
                   /* can't use the stairs down to quest level 2 until
                      leader "unlocks" them; give feedback if you try */
                   && Is_qstart_z() && !game._quest_got_quest) {
            await pline('The stairs seem to ripple momentarily.');
            disclose = true;
        }
        /* down will release you from bear trap or web */
        const noticed = { value: disclose };
        if (u.dz > 0 && u.utrap) {
            await openholdingtrap(u, noticed);
            /* down will trigger trapdoor, hole, or [spiked-] pit */
        } else if (u.dz > 0 && !u.utrap) {
            await openfallingtrap(u, false, noticed);
        }
        disclose = noticed.value;
        break;
    }
    case WAN_STRIKING:
    case SPE_FORCE_BOLT:
        striking = true;
        /* FALLTHRU */
    case WAN_LOCKING:
    case SPE_WIZARD_LOCK: {
        /* down at open bridge or up or down at open portcullis */
        const fd = db.find_drawbridge(x, y);
        if (((lev.typ === DRAWBRIDGE_DOWN)
                 ? (u.dz > 0)
                 : (db.is_drawbridge_wall(x, y) >= 0 && !db.is_db_wall(x, y)))
            && fd.ok) {
            if (!striking)
                await db.close_drawbridge(fd.x, fd.y);
            else
                await db.destroy_drawbridge(fd.x, fd.y);
            disclose = true;
        } else if (striking && u.dz < 0 && rn2(3) && !Is_airlevel(u.uz)
                   && !Is_waterlevel(u.uz) && !Underwater_z()
                   && !Is_qstart_z()) {
            /* similar to zap_dig() */
            await pline(`A rock is dislodged from the ${dungeon.ceiling(x, y)} and falls on your ${body_part(HEAD)}.`);
            const dmg = rnd(hard_helmet(game.uarmh) ? 2 : 6);
            await losehp(Maybe_Half_Phys(dmg), 'falling rock');
            const { mksobj_at } = await import('./mkobj.js');
            const otmp = mksobj_at(ROCK, x, y, false, false);
            if (otmp) {
                xname(otmp); /* set dknown, maybe bknown */
                stackobj(otmp);
            }
            newsym(x, y);
        } else if (u.dz > 0 && ttmp) {
            const noticed = { value: disclose };
            if (!striking && await closeholdingtrap(u, noticed)) {
                disclose = noticed.value; /* now stuck in web or bear trap */
            } else if (striking && ttmp.ttyp === TRAPDOOR_Z) {
                disclose = noticed.value;
                /* striking transforms trapdoor into hole */
                if (Blind() && !ttmp.tseen) {
                    await pline('Something beneath you shatters.');
                } else if (!ttmp.tseen) { /* => !Blind */
                    await pline("There's a trapdoor beneath you; it shatters.");
                } else {
                    await pline('The trapdoor beneath you shatters.');
                    disclose = true;
                }
                ttmp.ttyp = HOLE_Z;
                ttmp.tseen = 1;
                newsym(x, y);
                /* might fall down hole */
                await dotrap(ttmp, 0 /* NO_TRAP_FLAGS */);
            } else if (!striking && ttmp.ttyp === HOLE_Z) {
                disclose = noticed.value;
                /* locking transforms hole into trapdoor */
                ttmp.ttyp = TRAPDOOR_Z;
                if (Blind() || !ttmp.tseen) {
                    await pline(`Some ${is_ice(x, y) ? 'frost' : 'dust'} swirls beneath you.`);
                } else {
                    ttmp.tseen = 1;
                    newsym(x, y);
                    await pline('A trapdoor appears beneath you.');
                    disclose = true;
                }
                /* hadn't fallen down hole; won't fall now */
            } else {
                disclose = noticed.value;
            }
        }
        break;
    }
    case SPE_STONE_TO_FLESH:
        if (Is_airlevel(u.uz) || Is_waterlevel(u.uz) || Underwater_z()
            || (Is_qstart_z() && u.dz < 0)) {
            await pline('Nothing happens.');
        } else if (u.dz < 0) { /* we should do more... */
            await pline(`Blood drips on your ${body_part(FACE)}.`);
        } else if (u.dz > 0 && !pile_at(u.ux, u.uy).length) {
            /*
            Print this message only if there wasn't an engraving
            affected here.  If water or ice, act like waterlevel case.
            */
            const { engr_at } = await import('./engrave.js');
            const e = engr_at(u.ux, u.uy);
            if (!(e && e.engr_type === ENGRAVE)) {
                if (is_pool(u.ux, u.uy) || is_ice(u.ux, u.uy))
                    await pline('Nothing happens.');
                else
                    await pline(`Blood ${is_lava(u.ux, u.uy) ? 'boil' : 'pool'}s ${
                        Levitation_z() ? 'beneath' : 'at'} your ${makeplural(body_part(FOOT))}.`);
            }
        }
        break;
    default:
        break;
    }

    if (u.dz > 0) {
        /* zapping downward */
        await bhitpile(obj, x, y, u.dz);

        /* note: engraving handling that used to be here has been moved
           to zap_map() */
        if (!map_zapped)
            await zap_map(x, y, obj);

    } else if (u.dz < 0) {
        /* zapping upward */

        /* game flavor: if you're hiding under "something"
         * a zap upward should hit that "something".
         */
        if (u.uundetected && hides_under_flag(await youmonst_data_z())) {
            let hitit = 0;
            const otmp = pile_at(u.ux, u.uy)[0];

            if (otmp)
                hitit = await bhito(otmp, obj);
            if (hitit) {
                await (await import('./monmove.js')).hideunder(game.u);
                disclose = true;
            }
        }
    }

    return disclose;
}

// C ref: zap.c zap_map(x, y, obj) — the non-elemental terrain/engraving half of
// a wand effect: cancellation exploding magic traps, down-zap engraving
// effects, lateral drawbridge effects, and wand of probing's map/trap reveal
// (including the hallucinatory trap name's !rn2(4) article pick).
async function zap_map(x, y, obj) {
    const u = game.u;
    const { t_at } = await import('./trap.js');
    let ttmp = t_at(x, y);
    let learn_it = false;
    const learn = { value: false };
    await maybe_explode_trap(ttmp, obj, learn);
    learn_it = learn.value;
    ttmp = t_at(x, y); /* refresh in case trap was altered or is gone */

    if ((u.dz | 0) > 0) { /* zapping down */
        const { engr_at, wipe_engr_at, make_engr_at, random_engraving, rloc_engr } =
            await import('./engrave.js');
        const e = engr_at(x, y);

        /* subset of engraving effects; none sets `disclose' */
        if (e && e.engr_type !== HEADSTONE) {
            switch (obj.otyp) {
            case WAN_POLYMORPH:
            case SPE_POLYMORPH: {
                // del_engr(e) then a fresh random_engraving(): getrumor/get_rnd_text
                // plus wipeout_text — several draws.
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
                await rloc_engr(e);
                break;
            case SPE_STONE_TO_FLESH:
                if (e.engr_type === ENGRAVE) {
                    /* only affects things in stone */
                    await pline(Hallucination() ? 'The floor runs like butter!'
                                                : 'The edges on the floor get smoother.');
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

    } else if (!(u.dz | 0)) {
        const ltyp = game.level?.at(x, y)?.typ;
        const db = await import('./dbridge.js');
        const fd = db.find_drawbridge(x, y);

        if (fd.ok) {
            const dbx = fd.x, dby = fd.y;
            switch (obj.otyp) {
            case WAN_OPENING:
            case SPE_KNOCK:
                /* dbwall: 'closed door' of raised drawbridge */
                if (db.is_db_wall(x, y)) {
                    if (cansee(dbx, dby) || cansee(x, y))
                        learn_it = true;
                    await db.open_drawbridge(dbx, dby);
                }
                break;
            case WAN_LOCKING:
            case SPE_WIZARD_LOCK:
                /* drawbridge_down: span of lowered drawbridge */
                if ((cansee(dbx, dby) || cansee(x, y))
                    && game.level?.at(dbx, dby)?.typ === DRAWBRIDGE_DOWN)
                    learn_it = true;
                await db.close_drawbridge(dbx, dby);
                break;
            case WAN_STRIKING:
            case SPE_FORCE_BOLT:
                /* !drawbridge_up: not spot in front of raised bridge,
                   so either span of lowered bridge or portcullis */
                if (ltyp !== DRAWBRIDGE_UP) {
                    learn_it = true;
                    await db.destroy_drawbridge(dbx, dby);
                }
                break;
            default:
                break;
            }
        } /* find_drawbridge */
    } /* !u.dz */

    if (obj.otyp === WAN_PROBING) {
        /*
         * Probing, either up/down or lateral.
         */
        const lev = game.level?.at(x, y);
        /* map terrain; might reveal a special room which is already within
           view that hasn't been entered yet */
        const oldtyp = game.lastseentyp?.[x]?.[y];
        const cellsig = () => JSON.stringify([lev?.disp_ch, lev?.disp_color,
                                              lev?.remembered_glyph ?? null, !!lev?.invisMon]);
        const oldglyph = cellsig();
        const { show_map_spot } = await import('./detect.js');
        await show_map_spot(x, y, false);
        if (oldtyp !== game.lastseentyp?.[x]?.[y] || oldglyph !== cellsig()) {
            /* TODO: ought to give some message */
            learn_it = true;
        }
        const { db_under_typ } = await import('./dbridge.js');
        const ltyp = (lev.typ === DRAWBRIDGE_UP) ? db_under_typ(lev.drawbridgemask) : lev.typ;
        /* secret door gets revealed, converted into regular door */
        if (ltyp === SDOOR) {
            let newmask = (lev.doormask | 0) & ~WM_MASK;
            if (Is_rogue_level(game.u?.uz)) newmask = D_NODOOR;
            else if (!(newmask & D_LOCKED)) newmask |= D_CLOSED;
            lev.typ = DOOR; /* cvt_sdoor_to_door() */
            lev.doormask = newmask;
            lev.arboreal_sdoor = 0;
            recalc_block_point(x, y);
            newsym(x, y);
            if (cansee(x, y)) {
                await pline('Probing reveals a secret door.');
                learn_it = true;
            } else if (Is_rogue_level(game.u?.uz)) { /* from zap_over_floor() */
                const { draft_message } = await import('./dig.js');
                await draft_message(false); /* "You feel a draft." (open doorway) */
            }

        /* secret corridor likewise, although only ones within view will
           still be secret; for the !cansee(x,y) case, show_map_spot()
           above has already converted the spot to regular corridor */
        } else if (ltyp === SCORR) {
            lev.typ = CORR;
            (await import('./vision.js')).unblock_point(x, y);
            newsym(x, y);
            await pline('Probing exposes a secret corridor.');
            learn_it = true;

        /* if on or over ice, describe it ("solid ice", "thin ice", &c);
           likewise for furniture in case hero is levitating while blind */
        } else if (ltyp === ICE || IS_FURNITURE(ltyp)) {
            if ((u.dz | 0) > 0) { /* down, which also means x,y == u.ux,u.uy */
                await (await import('./pickup.js')).force_decor(true);
                learn_it = true;
            }
        }
        /*
         * Probing reveals undiscovered traps.
         *
         * FIXME?  This finds floor traps even when zapping up and
         * ceiling traps even when zapping down.
         */
        if (ttmp) {
            const t_already_seen = ttmp.tseen;
            const hallu = !!Hallucination();

            /* should probably be changed to use sense_trap(detect.c)
               so that trap can temporarily be forced to be shown and
               map browsing can take place before it reverts to being
               covered by monster or object(s) */
            ttmp.tseen = 1;
            newsym(x, y);

            if (!t_already_seen || hallu) {
                const { trapname, Invocation_lev } = await import('./trap.js');
                const ttmpname = trapname(ttmp.ttyp, false);
                const use_the = !hallu
                    ? (ttmp.ttyp === VIBRATING_SQUARE && Invocation_lev(game.u?.uz))
                    : !rn2(4);
                await pline(`You find ${use_the ? 'the ' + ttmpname : an_z(ttmpname)}${
                    use_the ? '!' : '.'}`);
                learn_it = !hallu;
            }
        } /* t_at() */
    } /* probing */

    if (learn_it)
        learnwand(obj);
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
// C ref: include/hack.h BZ_OFS_SPE(otyp) = abs(otyp - SPE_MAGIC_MISSILE) % 10,
// BZ_U_WAND(bzt) = bzt and BZ_U_SPELL(bzt) = 10 + bzt.  zap.c is_hero_spell()
// covers exactly the BZ_U_SPELL band.  The spell order in objects.h matches
// the wand order: MAGIC_MISSILE FIREBALL CONE_OF_COLD SLEEP FINGER_OF_DEATH.
function BZ_OFS_SPE(otyp) { return Math.abs(otyp - SPE_MAGIC_MISSILE) % 10; }
function BZ_U_WAND(bzt) { return bzt; }
function BZ_U_SPELL(bzt) { return 10 + bzt; }
function is_hero_spell(type) { return type >= 10 && type < 20; }
// C ref: zap.c ZT_BREATH(x) = 20 + x, the hero/monster breath band.
function ZT_BREATH(x) { return 20 + x; }

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

// C ref: zap.c dobuzz().  The beam walks the level, striking a monster
// (zap_hit/zhitm/xkilled) or the hero (zap_hit/zhitu) it crosses, and reflects
// off obstructions (bounce_dir) until range runs out.
//
// `type` is NEGATIVE when a monster fires the ray (BZ_M_BREATH == -20-adtyp).
// That changes the death path (monkilled, corpse-leaving, no hero kill credit),
// the "your/the blast" wording and zap_over_floor's u_caused flag.  A hero
// spell (10..19) adds spell_hit_bonus() to every monster to-hit roll, and the
// spell fireball (11) travels without hitting anything until it reaches a
// monster or an obstacle, then explodes there for d(12,6).
export async function dobuzz(type, nd, sx, sy, dx, dy,
                             sayhit = false, saymiss = false, forcemiss = false) {
    const u = game.u;
    const fltyp = zaptype(type);
    const damgtype = fltyp % 10;
    const fireball = (type === BZ_U_SPELL(ZT_FIRE)); /* set once */
    let gas_hit = false;
    const shopdamage = { value: false };
    // C: `int hdmgtype = Hallucination ? rn2(6) : damgtype;` is evaluated in
    // the declarations, before the engulfed early return.  It only picks the
    // beam colour, but a hallucinating hero still pays the rn2(6).
    const hdmgtype = Hallucination() ? rn2(6) : damgtype;
    /* if it's a hero spell then get its SPE_TYPE */
    const spell_type = is_hero_spell(type) ? SPE_MAGIC_MISSILE + damgtype : 0;
    const { mon_reflects, m_useup } = await import('./muse.js');

    if (u.uswallow) {
        if (type < 0)
            return;
        const { tmp } = await zhitm(u.ustuck, type, nd);
        if (!u.ustuck) {
            u.uswallow = 0;
        } else {
            await update_topl(`${flash_The(fltyp)} rips into ${mon_nam(u.ustuck)}${exclam(tmp)}`);
            /* Using disintegration from the inside only makes a hole... */
            if (tmp === MAGIC_COOKIE)
                u.ustuck.mhp = 0;
            if (DEADMONSTER(u.ustuck))
                await killed(u.ustuck);
        }
        return;
    }
    if (type < 0) newsym(u.ux, u.uy);
    let range = rn1(7, 7);
    if (dx === 0 && dy === 0) range = 1;
    const save_bhitpos = game.bhitpos;
    let lsx, lsy;
    // C ref: tmp_at(DISP_BEAM,...)/tmp_at(DISP_END,0).  The beam glyph is a
    // temporary overlay.  Once the zap finishes every cell it touched is
    // restored to its real glyph, so track visited cells and newsym() them.
    const visited = new Map();
    const drawBeam = (x, y) => {
        // C: zapdir_to_glyph(), updated by DISP_CHANGE after each bounce.
        show_beam_cell(x, y, dx, dy, hdmgtype);
        visited.set(`${x},${y}`, [x, y]);
    };

    // C's `buzzmonst:` label, shared by a monster in the beam's path and by a
    // steed that takes the bolt aimed at its rider.  Returns true where C
    // breaks out of the beam loop (a Rider or Death absorbing the ray).
    const buzzmonst = async (mon) => {
        game.notonhead = (mon.mx !== sx || mon.my !== sy);
        if (!forcemiss && await zap_hit(find_mac(mon), spell_type)) {
            if (await mon_reflects(mon, null)) {
                if (cansee(mon.mx, mon.my)) {
                    await hit(flash_str(fltyp), mon, exclam(0));
                    await shieldeff(mon.mx, mon.my);
                    await mon_reflects(mon, 'But it reflects from %s %s!');
                    gas_hit = false;
                }
                dx = -dx;
                dy = -dy;
            } else {
                const mon_could_move = mon.mcanmove;
                const { tmp, otmp } = await zhitm(mon, type, nd);

                if (is_rider_pm(mon.data?.pmidx)
                    && Math.abs(type) === ZT_BREATH(ZT_DEATH)) {
                    if (canseemon_shared(mon)) {
                        const { eyecount } = await import('./polyself.js');
                        const eye = body_part(EYE);
                        await hit(flash_str(fltyp), mon, '.');
                        await update_topl(`${Monnam(mon)} disintegrates.`);
                        await update_topl(`${s_suffix(Monnam(mon))} body reintegrates before your ${
                            eyecount(await youmonst_data_z()) === 1 ? eye : makeplural(eye)}!`);
                        await update_topl(`${Monnam(mon)} resurrects!`);
                    }
                    mon.mhp = mon.mhpmax;
                    return true;
                }
                if (mon.data?.pmidx === await PM_('Death') && damgtype === ZT_DEATH) {
                    if (canseemon_shared(mon)) {
                        await hit(flash_str(fltyp), mon, '.');
                        await update_topl(`${Monnam(mon)} absorbs the deadly ${
                            type === ZT_BREATH(ZT_DEATH) ? 'blast' : 'ray'}!`);
                        await update_topl('It seems even stronger than before.');
                    }
                    return true;
                }

                if (tmp === MAGIC_COOKIE) { /* disintegration */
                    await disintegrate_mon(mon, type, flash_str(fltyp));
                } else if (DEADMONSTER(mon)) {
                    if (type < 0) {
                        /* mon has just been killed by another monster */
                        await monkilled_zap(mon, flash_str(fltyp));
                    } else {
                        // C: xkilled(mon, XKILL_GIVEMSG), plus XKILL_NOCORPSE
                        // when fire kills a paper or straw golem.
                        const { completelyburns } = await import('./mondata.js');
                        await killed(mon, {
                            nocorpse: damgtype === ZT_FIRE && completelyburns(mon.data),
                        });
                    }
                } else {
                    if (!otmp) {
                        /* normal non-fatal hit */
                        if (sayhit || canseemon_shared(mon))
                            await hit(flash_str(fltyp), mon, exclam(tmp));
                    } else {
                        /* some armor was destroyed; no damage done */
                        if (canseemon_shared(mon))
                            await update_topl(`${s_suffix(Monnam(mon))} ${
                                distant_name_pub(otmp, xname)} is disintegrated!`);
                        m_useup(mon, otmp);
                    }
                    if (mon_could_move && !mon.mcanmove) /* ZT_SLEEP */
                        await slept_monst(mon);
                    if (damgtype !== ZT_SLEEP)
                        await wakeup(mon, type >= 0);
                }
            }
            range -= 2;
        } else if (saymiss || (canseemon_shared(mon) && !disguised_as_non_mon(mon))) {
            await miss(flash_str(fltyp), mon);
        }
        return false;
    };

    while (range-- > 0) {
        lsx = sx; sx += dx;
        lsy = sy; sy += dy;
        // C: `goto make_bounce` for an off-map or solid-rock square skips the
        // monster, hero and gas handling for that step.
        let bounce = !isok(sx, sy) || (game.level?.at(sx, sy)?.typ ?? STONE) === STONE;
        if (!bounce) {
            const typ = game.level?.at(sx, sy)?.typ ?? STONE;
            let mon = m_at(sx, sy);
            // C ref: zap.c:4838.  The whole marker and beam block sits inside
            // `if (cansee(sx, sy))`, so a blind hero sees no ray at all.
            if (cansee(sx, sy)) {
                if (mon && !canspotmon(mon)) map_invisible(sx, sy);
                else if (!mon) unmap_invisible_zap(sx, sy);
                if (ZAP_POS(typ) || (isok(lsx, lsy) && cansee(lsx, lsy)))
                    drawBeam(sx, sy);
            }

            /* hit() and miss() need bhitpos to match the target */
            game.bhitpos = { x: sx, y: sy };
            gas_hit = (damgtype === ZT_POISON_GAS);
            // C: fireballs only damage when they explode.  Poison gas leaves a
            // trail of 1x1 clouds via zap_over_floor(), deferred until we know
            // whether a reflection happens.
            if (!fireball && !gas_hit) {
                range += await zap_over_floor(sx, sy, type, shopdamage, true, 0);
                /* fire can melt ice and drown the monster found above */
                mon = m_at(sx, sy);
            }

            if (mon) {
                if (fireball)
                    break;
                if (type >= 0)
                    mon.mstrategy = (mon.mstrategy | 0) & ~STRAT_WAITMASK;
                if (await buzzmonst(mon))
                    break; /* Out of while loop */
            } else if (sx === u.ux && sy === u.uy && range >= 0) {
                // C ref zap.c:4958 nomul(0) breaks a multi-turn occupation
                // before the to-hit roll, so a missed bolt still interrupts.
                await nomul_zap(0);
                if (u.usteed && !rn2(3) && !(await mon_reflects(u.usteed, null))) {
                    // C: `mon = u.usteed; goto buzzmonst;` jumps into the
                    // monster branch, which skips this arm's tail below.
                    if (await buzzmonst(u.usteed))
                        break;
                } else {
                    if (!forcemiss && await zap_hit(u.uac | 0, 0)) {
                        range -= 2;
                        await update_topl(`${flash_The(fltyp)} hits you!`);
                        if (await ureflects(null, null)) {
                            if (!Blind())
                                await ureflects('But %s reflects from your %s!', 'it');
                            else
                                await update_topl('For some reason you are not affected.');
                            monstseesu(M_SEEN_REFL);
                            dx = -dx;
                            dy = -dy;
                            await shieldeff(sx, sy);
                            gas_hit = false;
                        } else {
                            /* flash_str here only used for killer; suppress
                             * hallucination */
                            await zhitu(type, nd, flash_killer(type), sx, sy);
                            monstunseesu(M_SEEN_REFL);
                            if (game.program_state?.gameover) return;
                        }
                    } else if (!Blind()) {
                        await update_topl(`${flash_The(fltyp)} whizzes by you!`);
                    } else if (damgtype === ZT_LIGHTNING) {
                        await update_topl(`Your ${body_part(ARM)} tingles.`);
                    }
                    // C: every lightning bolt crossing the hero's square draws
                    // d(nd, 50) for the blinding duration, hit or miss.
                    if (damgtype === ZT_LIGHTNING)
                        await flashburn(d(nd, 50), true);
                    await stop_occupation_zap();
                    await nomul_zap(0);
                }
            }
            /* gas that missed or that hit without being reflected will leave
               a 1x1 cloud here; the earlier zap_over_floor() was deferred */
            if (gas_hit)
                await zap_over_floor(sx, sy, type, shopdamage, true, 0);

            bounce = !ZAP_POS(game.level?.at(sx, sy)?.typ ?? STONE)
                || (closed_door_at(sx, sy) && range >= 0);
        }

        if (bounce) {
            /* make_bounce: */
            const typNow = isok(sx, sy) ? (game.level?.at(sx, sy)?.typ ?? STONE) : STONE;
            // C: off-level or STONE bounces back with chance 10, a Mines WALL
            // with 20, everything else with 75.  bchance is the modulus of
            // bounce_dir()'s rn2(bounceback).
            const bchance = (!isok(sx, sy) || typNow === STONE) ? 10
                          : (In_mines(game.u?.uz) && IS_WALL(typNow)) ? 20
                          : 75;
            if ((--range > 0 && isok(lsx, lsy) && cansee(lsx, lsy)) || fireball) {
                if (Is_airlevel()) { /* nothing to bounce off of */
                    await update_topl(`The ${flash_str(fltyp)} vanishes into the aether!`);
                    if (fireball)
                        type = BZ_U_WAND(ZT_FIRE); /* skip pending fireball */
                    break;
                } else if (fireball) {
                    sx = lsx;
                    sy = lsy;
                    break; /* fireballs explode before the obstacle */
                } else {
                    await update_topl(`${flash_The(fltyp)} bounces!`);
                }
            }
            const nd2 = bounce_dir(sx, sy, dx, dy, bchance);
            dx = nd2.dx; dy = nd2.dy;
        }
    }

    // C: tmp_at(DISP_END, 0) erases the temporary beam overlay before the
    // fireball explodes.
    for (const [vx, vy] of visited.values()) newsym(vx, vy);
    if (fireball) {
        const { explode } = await import('./explode.js');
        await explode(sx, sy, type, d(12, 6), 0, EXPL_FIERY);
    }
    if (shopdamage.value) {
        const { pay_for_damage } = await import('./shk.js');
        await pay_for_damage(damgtype === ZT_FIRE ? 'burn away'
                            : damgtype === ZT_COLD ? 'shatter'
                            : damgtype === ZT_ACID ? 'damage'
                            : damgtype === ZT_DEATH ? 'disintegrate' : 'destroy', false);
    }
    game.bhitpos = save_bhitpos;
}

// C ref: zap.c zap_over_floor() — terrain and floor-object effects, with
// range consumed by the terrain change.
export async function zap_over_floor(x, y, type, shopdamage = null,
                                     ignoremon = true, exploding_wand_typ = 0) {
    // C ref: zap.c:5157 — a PHYS_EXPL_TYPE blast (gas spore) has no effect on
    // the floor and returns before anything else.  Without this guard the
    // zaptype(-1)%10 == ZT_FIRE coincidence made a physical explosion burn the
    // scrolls under it.
    if (type === -1 /* PHYS_EXPL_TYPE */) return -1000;
    const damgtype = zaptype(type) % 10;
    let rangemod = 0;
    const lev = game.level?.at(x, y);
    const see_it = cansee(x, y);
    const lavawall = !!lev && lev.typ === LAVAWALL;
    const u = game.u;
    let mon;

    switch (damgtype) {
    case ZT_FIRE: {
        if (!lev) break;
        const trapmod = await import('./trap.js');
        let t = trapmod.t_at(x, y);
        if (t && t.ttyp === WEB) {
            /* a burning web is too flimsy to notice if you can't see it */
            if (see_it)
                await Norep_zap('A web bursts into flames!');
            trapmod.delfloortrap(t); t = null;
            if (see_it)
                newsym(x, y);
        }
        if (is_ice(x, y)) {
            await melt_ice(x, y, null);
        } else if (is_pool(x, y)) {
            // A fire ray over open water boils it: one 1..5 steam cloud per square.
            const on_water_level = !!Is_waterlevel(u?.uz);
            let msggiven = false;
            let msgtxt = !Deaf_hero() ? 'You hear hissing gas.' /* Deaf-aware */
                       : (type >= 0) ? 'That seemed remarkably uneventful.' : null;

            /* don't create steam clouds on Plane of Water; air bubble
               movement and gas regions don't understand each other */
            if (!on_water_level) {
                await create_gas_cloud(x, y, rnd(5), 0); /* 1..5, no damg */
                if (game.iflags?.last_msg === 'PLNMSG_ENVELOPED_IN_GAS')
                    msggiven = true;
            }

            if (lev.typ !== POOL) {          /* MOAT or DRAWBRIDGE_UP or WATER */
                t = null;
                if (on_water_level)
                    msgtxt = (see_it || !Deaf_hero()) ? 'Some water boils.' : null;
                else if (see_it)
                    msgtxt = 'Some water evaporates.';
            } else {
                rangemod -= 3;
                lev.typ = ROOM; lev.flags = 0;
                t = trapmod.maketrap(x, y, PIT);
                if (see_it)
                    msgtxt = 'The water evaporates.';
            }
            if (msgtxt && !msggiven)
                await Norep_zap(msgtxt);

            if (lev.typ === ROOM) { /* POOL changed to ROOM above */
                mon = m_at(x, y);
                if (mon) {
                    /* probably ought to do some hefty damage to any
                       creature caught in boiling water;
                       at a minimum, eels are forced out of hiding */
                    if (is_swimmer_flag(mon.data) && mon.mundetected)
                        mon.mundetected = 0;
                }
                newsym(x, y);
                if (t) {
                    /* if water walking/swimming/magical breathing, maybe fall
                       into the new pit (after the water evaporation message);
                       if flying or levitating, nothing will happen */
                    if (u_at(x, y))
                        await trapmod.dotrap(t, 0 /* NO_TRAP_FLAGS */);
                    else if (mon)
                        await (await import('./monmove.js')).mon_mintrap(mon, 0);
                }
            }
        } else if (IS_FOUNTAIN(lev.typ)) {
            await create_gas_cloud(x, y, rnd(3), 0); /* 1..3, no damage */
            if (see_it)
                await pline('Steam billows from the fountain.');
            rangemod -= 1;
            await (await import('./fountain.js')).dryup(x, y, type > 0);
        }
        break; /* ZT_FIRE */
    }

    case ZT_COLD: {
        if (!lev) break;
        if (is_pool(x, y) || is_lava(x, y) || lavawall) {
            const lava = (is_lava(x, y) || lavawall), moat = is_moat(x, y);
            const { hliquid } = await import('./do_name.js');
            const chance = Math.max(2, 5 + (game.level.flags?.temperature ?? 0) * 10);

            if (IS_WATERWALL(lev.typ) || (lavawall && rn2(chance))) {
                /* For now, don't let WATER freeze. */
                if (see_it)
                    await pline(`The ${hliquid(lavawall ? 'lava' : 'water')} freezes for a moment.`);
                else
                    await You_hear('a soft crackling.');
                rangemod -= 1000; /* stop */
            } else {
                // C computes this before changing terrain, including its display RNG.
                const { waterbody_name } = await import('./cmd.js');
                const buf = waterbody_name(x, y); /* for MOAT */
                rangemod -= 3;
                if (lev.typ === DRAWBRIDGE_UP) {
                    lev.drawbridgemask &= ~DB_UNDER; /* clear lava */
                    lev.drawbridgemask |= (lava ? DB_FLOOR : DB_ICE);
                } else {
                    lev.icedpool = lava ? 0
                                        : (lev.typ === POOL) ? ICED_POOL : ICED_MOAT;
                    if (lavawall) {
                        lev.typ = ((isok(x, y - 1) && IS_WALL(game.level.at(x, y - 1).typ))
                                   || (isok(x, y + 1) && IS_WALL(game.level.at(x, y + 1).typ)))
                            ? VWALL : HWALL;
                        const { fix_wall_spines } = await import('./mklev.js');
                        fix_wall_spines(Math.max(0, x - 1), Math.max(0, y - 1),
                                        Math.min(COLNO - 1, x + 1), Math.min(ROWNO - 1, y + 1));
                    } else {
                        lev.typ = lava ? ROOM : ICE;
                    }
                }
                const { bury_objs } = await import('./dig.js');
                await bury_objs(x, y);
                if (see_it) {
                    if (lava)
                        await Norep_zap(`The ${hliquid('lava')} cools and solidifies.`);
                    else if (moat)
                        await Norep_zap(`The ${buf} is bridged with ice!`);
                    else
                        await Norep_zap(`The ${hliquid('water')} freezes.`);
                    newsym(x, y);
                } else if (!lava) {
                    await You_hear('a crackling sound.');
                }
                if (u_at(x, y)) {
                    if (u.uinwater) { /* not just `if (Underwater)' */
                        /* leave the no longer existent water */
                        (await import('./do.js')).set_uinwater(0); /* u.uinwater = 0 */
                        u.uundetected = 0;
                        const { docrt } = await import('./display.js');
                        await docrt();
                        game.vision_full_recalc = 1;
                    } else if (u.utrap && u.utraptype === TT_LAVA) {
                        const phasing = u.uprops?.Passes_walls || u.uprops?.HPasses_walls
                            || u.uprops?.EPasses_walls || worn_extrinsic(PASSES_WALLS)
                            || (u.Upolyd && passes_walls_flag(u.data));
                        const { float_vs_flight } = await import('./polyself.js');
                        if (phasing) {
                            await update_topl('You pass through the now-solid rock.');
                            const blockedLev = !!u.uprops?.BLevitation;
                            const blockedFly = !!u.uprops?.BFlying;
                            u.utrap = 0;
                            u.utraptype = 0;
                            float_vs_flight();
                            if (blockedLev && !u.uprops?.BLevitation
                                && (u.uprops?.Levitation || u.uprops?.HLevitation
                                    || u.uprops?.ELevitation || worn_extrinsic(LEVITATION))) {
                                const { float_up } = await import('./trap.js');
                                await float_up();
                            }
                            if (blockedFly && !u.uprops?.BFlying
                                && (u.uprops?.Flying || u.uprops?.HFlying
                                    || u.uprops?.EFlying || worn_extrinsic(FLYING)))
                                await update_topl('You can fly.');
                        } else {
                            u.utrap = rn1(50, 20);
                            u.utraptype = TT_INFLOOR;
                            float_vs_flight();
                            await update_topl('You are firmly stuck in the cooling rock.');
                        }
                    }
                } else {
                    mon = m_at(x, y);
                    if (mon) {
                        /* probably ought to do some hefty damage to any
                           non-ice creature caught in freezing water;
                           at a minimum, eels are forced out of hiding */
                        if (is_swimmer_flag(mon.data) && mon.mundetected) {
                            mon.mundetected = 0;
                            newsym(x, y);
                        }
                    }
                }
                if (!lava) {
                    await start_melt_ice_timeout(x, y, 0);
                    obj_ice_effects(x, y, true);
                }
            } /* ?WATER */

        } else if (is_ice(x, y)) {
            /* Already ice here, so just firm it up. */
            /* Now ensure that only ice that is already timed is affected */
            const tmo = await import('./timeout.js');
            const melt_time = tmo.spot_time_left(x, y, MELT_ICE_AWAY_Z);
            if (melt_time) {
                await tmo.spot_stop_timers(x, y, MELT_ICE_AWAY_Z);
                await start_melt_ice_timeout(x, y, melt_time);
            }
        }
        break; /* ZT_COLD */
    }

    case ZT_POISON_GAS:
        /* poison gas with range 1: green dragon/iron golem breath (AD_DRST);
           caller is placing a series of 1x1 clouds along the zap's path;
           <x,y> for wall locations might be included--reject those */
        if (lev && ZAP_POS(lev.typ))
            await create_gas_cloud(x, y, 1, 8);
        break;

    case ZT_LIGHTNING:
        /* FALLTHRU */
    case ZT_ACID:
        if (lev && lev.typ === IRONBARS) {
            if (damgtype === ZT_LIGHTNING && rn2(10))
                break;
            const bars = 'iron bars'; /* defsyms[S_bars].explanation */
            if (((lev.wall_info | 0) & W_NONDIGGABLE) !== 0) {
                if (see_it)
                    await Norep_zap(`The ${bars} ${(damgtype === ZT_ACID) ? 'corrode' : 'melt'} somewhat but remain intact.`);
                /* but nothing actually happens... */
            } else {
                rangemod -= 3;
                if (see_it)
                    await Norep_zap(`The ${bars} ${(damgtype === ZT_ACID) ? 'corrode away' : 'melt'}.`);
                const { dissolve_bars } = await import('./monmove.js');
                await dissolve_bars(x, y);
                if (in_rooms(x, y, SHOPBASE)[0]) {
                    const { add_damage } = await import('./shk.js');
                    await add_damage(x, y, (type >= 0) ? SHOP_BARS_COST : 0);
                    if (type >= 0 && shopdamage)
                        shopdamage.value = true;
                }
            }
        }
        break; /* ZT_ACID */

    default:
        break;
    }

    // C ref: zap.c:5397-5487.  Doors absorb a ray; destructive rays update
    // vision before the feedback message, which can pause with --More--.
    if (lev && (lev.typ === SDOOR || closed_door_at(x, y))) {
        const yourzap = type >= 0 && !exploding_wand_typ;
        const fltyp = zaptype(type);
        const zapverb = exploding_wand_typ || fltyp >= 20 ? 'blast'
                      : fltyp >= 10 ? 'spell' : 'bolt';
        if (exploding_wand_typ === POT_OIL || exploding_wand_typ === SCR_FIRE)
            exploding_wand_typ = 0;
        if (lev.typ === SDOOR) {
            lev.doormask = Is_rogue_level(game.u?.uz) ? D_NODOOR
                : (lev.doormask & ~WM_MASK) | ((lev.doormask & D_LOCKED) ? 0 : D_CLOSED);
            lev.typ = DOOR;
            recalc_block_point(x, y);
            newsym(x, y);
            if (see_it)
                await update_topl(`${yourzap ? 'Your' : 'The'} ${zapverb} reveals a secret door.`);
            else if (Is_rogue_level(game.u?.uz)) {
                const { draft_message } = await import('./dig.js');
                await draft_message(false);
            }
        }
        if (closed_door_at(x, y)) {
            rangemod = -1000;
            let newmask = -1, see_txt, sense_txt, hear_txt;
            switch (damgtype) {
            case ZT_FIRE:
                newmask = D_NODOOR; see_txt = 'The door is consumed in flames!';
                sense_txt = 'You smell smoke.'; break;
            case ZT_COLD:
                newmask = D_NODOOR; see_txt = 'The door freezes and shatters!';
                hear_txt = 'a deep cracking sound.'; break;
            case ZT_DEATH:
                if (Math.abs(type) === ZT_BREATH(ZT_DEATH)) {
                    newmask = D_NODOOR; see_txt = 'The door disintegrates!';
                    hear_txt = 'crashing wood.';
                }
                break;
            case ZT_LIGHTNING:
                newmask = D_BROKEN; see_txt = 'The door splinters!';
                hear_txt = 'crackling.'; break;
            }
            if (newmask < 0 && exploding_wand_typ === WAN_STRIKING) {
                newmask = D_BROKEN; see_txt = 'The door crashes open!';
                sense_txt = 'You feel a burst of cool air.';
            }
            if (newmask >= 0) {
                if (in_rooms(x, y, SHOPBASE)[0]) {
                    const { add_damage } = await import('./shk.js');
                    await add_damage(x, y, type >= 0 ? SHOP_DOOR_COST : 0);
                    if (type >= 0 && shopdamage) shopdamage.value = true;
                }
                lev.doormask = newmask;
                recalc_block_point(x, y);
                if (see_it) {
                    await update_topl(see_txt);
                    newsym(x, y);
                } else if (sense_txt) await update_topl(sense_txt);
                else if (hear_txt) await You_hear(hear_txt);
                const { picking_at, reset_pick } = await import('./lock.js');
                if (picking_at(x, y)) {
                    await stop_occupation_zap();
                    reset_pick();
                }
            } else if (see_it) {
                await update_topl(exploding_wand_typ ? 'The door remains intact.'
                    : `The door absorbs ${yourzap ? 'your' : 'the'} ${zapverb}!`);
            } else await update_topl('You feel vibrations.');
        }
    }
    if (pile_at(x, y).length && damgtype === ZT_FIRE) {
        if ((await burn_floor_objects(x, y, false, type > 0))
            && await couldsee_z(x, y)) {
            newsym(x, y);
            await pline(`You ${!Blind() ? 'see a puff' : 'smell a whiff'} of smoke.`);
        }
    }
    if (!ignoremon) {
        mon = m_at(x, y);
        if (mon) await wakeup(mon, type >= 0);
    }
    return rangemod;
}

// C ref: mon.c:3395 monkilled(mon, fltxt, how) — a monster killed by ANOTHER
// monster's ray.  It is NOT xkilled(): no hero kill credit, no experience and
// none of xkilled()'s extra treasure-drop roll.  Delegates to the one
// monkilled port (death line, deferred pet "sad feeling", mondied()).
async function monkilled_zap(mon, fltxt) {
    const { monkilled_mm } = await import('./mhitm.js');
    await monkilled_mm(mon, AD_RBRE, fltxt);
}
// C ref: mondata.h:219 nonliving(ptr) = is_undead(ptr) || PM_MANES ||
// weirdnonliving(ptr) [golem or S_VORTEX].  Derived from the generated M2_UNDEAD
// flag and the monster class, NOT from a species-name regex.
const S_VORTEX_Z = 22, S_GOLEM_Z = 55;   // defsym.h
function nonliving_zap(mon) { return nonliving_ptr(mon?.data); }
function nonliving_ptr(p) {
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

// C ref: invent.c useupf(obj, numused) — use up part of a floor stack, charging
// the hero for it when it lay on shop ground.  (invent.js's useupf omits the
// billing arm.)
async function useupf_z(obj, numused) {
    const at_u = u_at(obj.ox, obj.oy);
    const otmp = ((obj.quan || 1) > numused) ? splitobj(obj, numused) : obj;
    const shk = await import('./shk.js');
    if (!game.context?.mon_moving && shk.costly_spot(otmp.ox, otmp.oy)) {
        const shkroom = await import('./shkroom.js');
        if ((game.u?.urooms || []).includes(in_rooms(otmp.ox, otmp.oy, 0)[0]))
            await shkroom.addtobill(otmp, false, false, false);
        else
            await shk.stolen_value(otmp, otmp.ox, otmp.oy, false, false);
    }
    delobj(otmp);
    if (at_u && game.u?.uundetected && hides_under_flag(await youmonst_data_z()))
        await (await import('./monmove.js')).hideunder(game.u);
}

// C ref: zap.c burn_floor_objects(x, y, give_feedback, u_caused) — burn objects
// (such as scrolls and spellbooks) on the floor at x,y; returns the number of
// objects burned.
export async function burn_floor_objects(x, y, give_feedback, u_caused) {
    const here = pile_at(x, y);
    let cnt = 0;
    for (const obj of here) {
        if (obj.oclass !== SCROLL_CLASS && obj.oclass !== SPBOOK_CLASS
            && !(obj.oclass === FOOD_CLASS && obj.otyp === GLOB_OF_GREEN_SLIME))
            continue;
        if (obj.otyp === SCR_FIRE || obj.otyp === SPE_FIREBALL
            || obj_resists(obj, 2, 100))
            continue;
        const scrquan = obj.quan || 1; /* number present */
        let delquan = 0;               /* number to destroy */
        for (let i = scrquan; i > 0; i--) if (!rn2(3)) delquan++;
        if (!delquan) continue;
        /* save name before potential delobj() */
        let buf1 = '', buf2 = '';
        if (give_feedback) {
            const nm = () => (u_at(x, y) ? xname(obj) : distant_name_pub(obj, xname));
            obj.quan = 1; buf1 = nm();
            obj.quan = 2; buf2 = nm();
            obj.quan = scrquan;
        }
        /* useupf(), which charges, only if hero caused damage */
        if (u_caused) {
            await useupf_z(obj, delquan);
        } else if (delquan < scrquan) {
            obj.quan = scrquan - delquan;
            obj.owt = weight_of(obj);
        } else {
            delobj(obj);
        }
        cnt += delquan;
        if (give_feedback) {
            if (delquan > 1)
                await pline(`${delquan} ${buf2} burn.`);
            else
                await pline(`${An_z(buf1)} burns.`);
        }
    }
    /* This also ignites floor items, but does not change cnt
       because they weren't consumed. */
    await ignite_items(pile_at(x, y));
    return cnt;
}

// C ref: youprop.h Hallucination.
// C ref: muse.c ureflects(fmt, str) — outermost reflection source first.
// Draws no RNG; the reflection message and the makeknown are the observable.
const SHIELD_OF_REFLECTION_OTYP = 158, AMULET_OF_REFLECTION_OTYP = 208;
export async function ureflects(fmt, str) {
    const { makeknown } = await import('./invent.js');
    if (game.uarms && game.uarms.otyp === SHIELD_OF_REFLECTION_OTYP) {
        if (fmt && str) {
            await update_topl(fmt.replace('%s', str).replace('%s', 'shield'));
            makeknown(SHIELD_OF_REFLECTION_OTYP);
        }
        return true;
    }
    const { REFLECTING } = await import('./const.js');
    const reflecting = worn_extrinsic(REFLECTING);
    if (reflecting & W_WEP) {
        if (fmt && str)
            await update_topl(fmt.replace('%s', str).replace('%s', 'weapon'));
        return true;
    }
    if (game.uamul && game.uamul.otyp === AMULET_OF_REFLECTION_OTYP) {
        if (fmt && str) {
            await update_topl(fmt.replace('%s', str).replace('%s', 'medallion'));
            makeknown(AMULET_OF_REFLECTION_OTYP);
        }
        return true;
    }
    if ((reflecting & W_ARM) || game.u?.formprops?.Reflecting) {
        if (fmt && str)
            await update_topl(fmt.replace('%s', str).replace('%s',
                (reflecting & W_ARM) ? (game.uskin ? 'luster' : 'armor') : 'scales'));
        return true;
    }
    return false;
}


// C ref: zap.c zap_hit(ac, type).  Does the ray hit a target of armor class
// ac?  `type` is the hero spell's SPE_ otyp, or 0 for wands, breath and
// monster rays.  A spell adds spell_hit_bonus() from the caster's school
// skill and Dexterity.
async function zap_hit(ac, type) {
    const chance = rn2(20);
    const spell_bonus = type ? await spell_hit_bonus(type) : 0;
    /* small chance for naked target to avoid being hit */
    if (!chance) return rnd(10) < ac + spell_bonus;
    /* very high armor protection does not achieve invulnerability */
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
// C ref: objects.h — the object types whose oc_oprop is DISINT_RES.
// Resolved by name off the shared objects table so they cannot drift.
const ANTIMAGIC_PROP = 12; // prop.h ANTIMAGIC
const DISINT_RES_OTYPS = new Set(
    ['black dragon scale mail', 'black dragon scales']
        .map(n => objects.findIndex(o => o && o.name === n)).filter(i => i > 0));
export function resists_magm(mon) {
    const ptr = mon?.data;
    if (!ptr) return false;
    if (dmgtype(ptr, AD_MAGM) || ptr.pmidx === PM_BABY_GRAY_DRAGON
        || dmgtype(ptr, AD_RBRE))
        return true;
    // C ref: mondata.c resists_magm() — any WORN item whose
    // objects[].oc_oprop is ANTIMAGIC.  mkobj.js carries that column (it holds
    // exactly C's three rows: gray dragon scale mail, gray dragon scales, cloak
    // of magic resistance), so read it instead of keeping a second copy of the
    // same list as an otyp set.
    const mwflags = mon.misc_worn_check | 0;
    for (const o of (Array.isArray(mon.minvent) ? mon.minvent : []))
        if (((o.owornmask | 0) & mwflags)
            && objects[o.otyp]?.oc_oprop === ANTIMAGIC_PROP)
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
// <mon>."  The verb goes through vtense() like C, and the visibility tests read
// gb.bhitpos (the beam's current square), not the monster's own square.
export async function hit(str, mon, force) {
    const { vtense } = await import('./dothrow.js');
    const { The } = await import('./objnam.js');
    const bp = game.bhitpos || { x: mon?.mx, y: mon?.my };
    const verbosely = (mon === game.youmonst || mon === game.u)
        || (game.flags?.verbose !== false
            && (cansee(bp.x, bp.y) || cansee(mon?.mx, mon?.my) || canspotmon(mon) || engulfing_u(mon)));
    await update_topl(`${The(str)} ${vtense(str, 'hit')} ${verbosely ? mon_nam(mon) : 'it'}${force}`);
}
export async function miss(str, mon) {
    const { vtense } = await import('./dothrow.js');
    const { The } = await import('./objnam.js');
    const bp = game.bhitpos || { x: mon?.mx, y: mon?.my };
    const named = (cansee(bp.x, bp.y) || cansee(mon?.mx, mon?.my) || canspotmon(mon)) && game.flags?.verbose !== false;
    await update_topl(`${The(str)} ${vtense(str, 'miss')} ${named ? mon_nam(mon) : 'it'}.`);
}
// C ref: mondata.c disguised_as_non_mon — a hiding mimic/mimicking object.  No
// covered zap target is a mimic.
function disguised_as_non_mon(_mon) { return false; }
// C ref: mon.c wakeup(mon, via_attack) — wake_msg(), clear msleeping, then
// (via_attack) setmangry(), which flips a peaceful monster hostile — steering
// every later m_move()/mattacku() decision and drawing rnd(5) on Elbereth — so
// the old msleeping-only version silently missed all of that.  (growl()
// intentionally omitted: RNG-free in C, and uhitm.js already places its
// topline differently.)
export async function wakeup(mon, viaAttack) {
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
// C ref: mhitm.c:1250 slept_monst(): sleeping holders release, engulfers do not.
export async function slept_monst(mon) {
    const u = game.u;
    if ((mon.msleeping || !(mon.mcanmove ?? 1)) && u.ustuck === mon
        && !u.uswallow && !sticks(game.youmonst?.data || await youmonst_data_z())) {
        await pline(`${s_suffix(Monnam(mon))} grip relaxes.`);
        await unstuck(mon);
    }
}

// C ref: mhitm.c sleep_monst(mon, amt, how) — how=WAND_CLASS for a wand of
// sleep zap.  seemimic() mimic-reveal is not modelled (no covered zap target
// is a hiding mimic).
export async function sleep_monst(mon, amt, how) {
    if (resists_sleep(mon) || defended(mon, 4 /*AD_SLEE*/) || (how >= 0 && resist(mon, how, 0, false))) {
        await shieldeff(mon.mx, mon.my);
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

// C ref: zap.c disintegrate_mon — the ZT_BREATH(ZT_DEATH) instakill path.  A
// worn amulet of life saving is preserved (it must stay to operate), and a
// monster-fired breath (type < 0) kills through monkilled(), which gives the
// hero no kill credit and no alignment adjustment; only a hero/hero-zapped
// ray goes through xkilled().
async function disintegrate_mon(mon, type, fltxt) {
    const { mlifesaver } = await import('./mon.js');
    const { is_quest_artifact } = await import('./questpgr.js');
    const m_amulet = mlifesaver(mon);

    if (canseemon_shared(mon)) {
        if (!m_amulet) await update_topl(`${Monnam(mon)} is disintegrated!`);
        else await hit(fltxt, mon, '!');
    }

    // C: `oresist_disintegration(obj)` is
    //   oc_oprop == DISINT_RES || obj_resists(obj, 5, 50) || quest artifact
    //   || obj == m_amulet
    // and obj_resists() DRAWS rn2(100) for every carried item that isn't one of
    // the always-resists types.
    if (Array.isArray(mon.minvent) && mon.minvent.length) {
        const keep = [];
        for (const o of mon.minvent) {
            if (DISINT_RES_OTYPS.has(o.otyp)
                || obj_resists(o, 5, 50) || is_quest_artifact(o)
                || o === m_amulet)
                keep.push(o);
        }
        mon.minvent = keep;
    }

    if (type < 0) {
        const { monkilled_mm } = await import('./mhitm.js');
        await monkilled_mm(mon, -AD_RBRE, null);
    } else {
        await killed(mon, { nomsg: true, nocorpse: true });
    }
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
function flash_str(type, nohallu = false) {
    return Hallucination() && !nohallu
        ? `blast of ${rnd_hallublast()}`
        : FLASH_NAME[zaptype(type)] || 'bolt';
}
function flash_The(type) { return 'The ' + flash_str(type); }
function flash_killer(type) { return flash_str(type, true); }

// C ref: do_name.c hliquid(liquidpref) — hallucination-aware liquid word.
async function hliquid_z(l) { return (await import('./do_name.js')).hliquid(l); }

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
            await shieldeff(sx, sy);
            await update_topl('The missiles bounce off!');
            monstseesu(M_SEEN_MAGR);
        } else {
            dam = d(nd, 6);
            exercise(A_STR, false);
            monstunseesu(M_SEEN_MAGR);
        }
        break;
    case ZT_FIRE:
        orig_dam = d(nd, 6);
        if (Fire_resistance()) {
            await shieldeff(sx, sy);
            await update_topl("You don't feel hot!");
            monstseesu(M_SEEN_FIRE);
            // ugolemeffects(AD_FIRE, orig_dam): only a polymorphed golem hero.
        } else {
            dam = orig_dam;
            monstunseesu(M_SEEN_FIRE);
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
            await shieldeff(sx, sy);
            await update_topl("You don't feel cold.");
            monstseesu(M_SEEN_COLD);
        } else {
            dam = orig_dam;
            monstunseesu(M_SEEN_COLD);
        }
        if (!rn2(3))
            await destroy_items(u, AD_COLD, orig_dam);
        break;
    case ZT_SLEEP:
        // C draws d(nd, 25) here — NOT d(nd, 6) — and the hero loses no HP at
        // all; the old `default:` arm rolled the wrong modulus and then applied
        // the roll as damage.
        if (Sleep_resistance()) {
            await shieldeff(u.ux, u.uy);
            await update_topl("You don't feel sleepy.");
            monstseesu(M_SEEN_SLEEP);
        } else {
            monstunseesu(M_SEEN_SLEEP);
            await fall_asleep(-d(nd, 25), true); /* sleep ray */
        }
        break;
    case ZT_DEATH:
        // Death and disintegration enter done(DIED) without HP damage.
        if (abstyp === 20 + ZT_DEATH) {
            // inventory_resistance_check(AD_DISN) (trap.c) is a constant false here.
            if (Disint_resistance()) {
                await update_topl('You are not disintegrated.');
                monstseesu(M_SEEN_DISINT);
                break;
            }
            monstunseesu(M_SEEN_DISINT);
            const { disintegrate_arm } = await import('./do_wear.js');
            if (game.uarms) {
                /* destroy shield; other possessions are safe */
                await disintegrate_arm(game.uarms);
                break;
            } else if (game.uarm) {
                /* destroy suit; if present, cloak goes too */
                if (game.uarmc)
                    await disintegrate_arm(game.uarmc);
                await disintegrate_arm(game.uarm);
                break;
            }
            /* no shield or suit, you're dead; wipe out cloak
               and/or shirt in case of life-saving or bones */
            if (game.uarmc)
                await disintegrate_arm(game.uarmc);
            if (game.uarmu)
                await disintegrate_arm(game.uarmu);
        } else if (nonliving_ptr(await youmonst_data_z())
                   || is_demon_flag(await youmonst_data_z())) {
            await shieldeff(sx, sy);
            await update_topl('You seem unaffected.');
            break;
        } else if (Antimagic()) {
            await shieldeff(sx, sy);
            monstseesu(M_SEEN_MAGR);
            await update_topl("You aren't affected.");
            break;
        }
        monstunseesu(M_SEEN_MAGR);
        {
            // C: killer.format = KILLED_BY_AN, killer.name = fltxt.  This
            // port keeps the formatted phrase in game._killer_name.
            const { an } = await import('./objnam.js');
            game._killer_name = fltxt ? `killed by ${an(fltxt)}` : '';
        }
        /* when killed by disintegration breath, don't leave corpse */
        u.ugrave_arise = type === -ZT_BREATH(ZT_DEATH) ? -3 : NON_PM;
        {
            const { done, DIED } = await import('./end.js');
            await done(DIED);
        }
        return;
    case ZT_LIGHTNING:
        orig_dam = d(nd, 6);
        if (Shock_resistance()) {
            await shieldeff(sx, sy);
            await update_topl("You aren't affected.");
            monstseesu(M_SEEN_ELEC);
            // ugolemeffects(AD_ELEC, orig_dam): only a polymorphed golem hero.
        } else {
            dam = orig_dam;
            monstunseesu(M_SEEN_ELEC);
            // C: exercise(A_CON, FALSE).  Both attributes draw rn2(2), but they
            // credit DIFFERENT aexe[] slots, and exerchk() later rolls off those
            // slots — so charging A_STR here silently steers a later modulus.
            exercise(A_CON, false);
        }
        if (!rn2(3))
            await destroy_items(u, AD_ELEC, orig_dam);
        break;
    case ZT_POISON_GAS:
        {
            const { poisoned } = await import('./attrib.js');
            await poisoned('blast', A_DEX, 'poisoned blast', 15, false);
        }
        break;
    case ZT_ACID:
        if (Acid_resistance()) {
            await update_topl(`The ${await hliquid_z('acid')} doesn't hurt.`);
            monstseesu(M_SEEN_ACID);
            dam = 0;
        } else {
            await update_topl(`The ${await hliquid_z('acid')} burns!`);
            dam = d(nd, 6);
            exercise(A_STR, false);
            monstunseesu(M_SEEN_ACID);
        }
        /* two weapons at once makes both more vulnerable */
        if (!rn2(u.twoweap ? 3 : 6)) {
            const { acid_damage } = await import('./trap.js');
            await acid_damage(game.uwep);
        }
        if (u.twoweap && !rn2(3)) {
            const { acid_damage } = await import('./trap.js');
            await acid_damage(game.uswapwep);
        }
        if (!rn2(6)) {
            const { erode_armor } = await import('./mhitm_ad.js');
            await erode_armor(u, ERODE_CORRODE);
        }
        break;
    default:
        break;
    }
    const verb = abstyp < 10
        ? (game.current_wand?.oclass === TOOL_CLASS ? 'played' : 'zapped')
        : abstyp < 20 ? 'cast' : abstyp < 30 ? 'exhaled' : 'imagined';
    let kbuf;
    if (type < 0 || (type === 0 && game.buzzer)) {
        const { death_inflicted_by } = await import('./mcastu.js');
        kbuf = death_inflicted_by('', fltxt, game.buzzer);
        if (game.buzzer) kbuf = kbuf.replace('inflicted', verb);
    } else {
        kbuf = `${fltxt} ${verb} by ${game.flags?.female ? 'her' : 'him'}self`;
    }
    // C: Half_spell_damage halves wand/spell damage (abstyp < 20), not breath.
    if (dam && Half_spell_damage() && abstyp < 20)
        dam = Math.trunc((dam + 1) / 2);
    await losehp(dam, kbuf);
}

// C ref: monattk.h AD_* (used by destroy_items dispatch and zhitm's switch).
const AD_MAGM = 1, AD_FIRE = 2, AD_COLD = 3, AD_SLEE = 4, AD_DISN = 5,
      AD_ELEC = 6, AD_DRST = 7, AD_ACID = 8;

// C ref: zap.c zhitm(mon, type, nd, &ootmp).  Apply a ray's damage to a
// monster.  Returns { tmp, otmp }: tmp is the damage dealt (or MAGIC_COOKIE
// for a disintegration instakill), otmp is worn armor that disintegration
// destroyed instead of killing.  The caller kills mon if the damage is fatal.
export async function zhitm(mon, type, nd) {
    const fltyp = zaptype(type);
    const damgtype = fltyp % 10;
    const spellcaster = is_hero_spell(type); /* maybe get a bonus! */
    let tmp = 0, orig_dmg = 0, otmp = null, sho_shieldeff = false;
    switch (damgtype) {
    case ZT_MAGIC_MISSILE:
        if (resists_magm(mon) || defended(mon, AD_MAGM)) {
            sho_shieldeff = true;
            break;
        }
        tmp = d(nd, 6);
        if (spellcaster)
            tmp = spell_damage_bonus(tmp);
        break;
    case ZT_FIRE:
        if (resists_fire(mon) || defended(mon, AD_FIRE)) {
            sho_shieldeff = true;
            break;
        }
        tmp = d(nd, 6);
        if (spellcaster)
            tmp = spell_damage_bonus(tmp);
        orig_dmg = tmp; /* includes spell bonus but not monster vuln to fire */
        if (resists_cold(mon))
            tmp += 7;
        if (await burnarmor(mon)) {
            if (!rn2(3)) {
                tmp += await destroy_items(mon, AD_FIRE, orig_dmg);
                await ignite_items(mon.minvent || []);
            }
        }
        break;
    case ZT_COLD:
        if (resists_cold(mon) || defended(mon, AD_COLD)) {
            sho_shieldeff = true;
            break;
        }
        tmp = d(nd, 6);
        if (spellcaster)
            tmp = spell_damage_bonus(tmp);
        orig_dmg = tmp; /* includes spell bonus but not monster vuln to cold */
        if (resists_fire(mon))
            tmp += d(nd, 3);
        if (!rn2(3))
            tmp += await destroy_items(mon, AD_COLD, orig_dmg);
        break;
    case ZT_SLEEP:
        /* resistance and shield effect are handled by sleep_monst() */
        tmp = 0;
        await sleep_monst(mon, d(nd, 25),
                          type === BZ_U_WAND(ZT_SLEEP) ? WAND_CLASS : 0);
        break;
    case ZT_DEATH: /* death/disintegration */
        if (Math.abs(type) !== ZT_BREATH(ZT_DEATH)) { /* death */
            if (mon.data?.pmidx === await PM_('Death')) {
                const { healmon } = await import('./mon.js');
                const mhpmax = mon.mhpmax | 0;
                healmon(mon, Math.trunc(mhpmax * 3 / 2), Math.trunc(mhpmax / 2));
                if ((mon.mhpmax | 0) >= MAGIC_COOKIE)
                    mon.mhpmax = MAGIC_COOKIE - 1;
                tmp = 0;
                break;
            }
            if (nonliving_zap(mon) || is_demon_flag(mon.data)
                || is_vampshifter(mon) || resists_magm(mon)) {
                /* similar to player */
                sho_shieldeff = true;
                break;
            }
            type = -1; /* so they don't get saving throws */
        } else {
            if (resists_disint(mon) || defended(mon, AD_DISN)) {
                sho_shieldeff = true;
            } else if ((mon.misc_worn_check | 0) & W_ARMS) {
                /* destroy shield; victim survives */
                otmp = which_armor(mon, W_ARMS);
            } else if ((mon.misc_worn_check | 0) & W_ARM) {
                /* destroy suit, also cloak if present */
                const { m_useup } = await import('./muse.js');
                otmp = which_armor(mon, W_ARM);
                const otmp2 = which_armor(mon, W_ARMC);
                if (otmp2) m_useup(mon, otmp2);
            } else {
                /* no suit, victim dies; destroy cloak
                   and shirt now in case target gets life-saved */
                const { m_useup } = await import('./muse.js');
                tmp = MAGIC_COOKIE;
                let otmp2 = which_armor(mon, W_ARMC);
                if (otmp2) m_useup(mon, otmp2);
                otmp2 = which_armor(mon, W_ARMU);
                if (otmp2) m_useup(mon, otmp2);
            }
            type = -1; /* no saving throw wanted */
            break;     /* not ordinary damage */
        }
        tmp = (mon.mhp | 0) + 1;
        break;
    case ZT_LIGHTNING:
        tmp = d(nd, 6);
        if (spellcaster)
            tmp = spell_damage_bonus(tmp);
        orig_dmg = tmp;
        if (resists_elec(mon) || defended(mon, AD_ELEC)) {
            sho_shieldeff = true;
            tmp = 0;
            /* can still blind the monster */
        }
        if (!resists_blnd_mon(mon)
            && !(type > 0 && engulfing_u(mon))
            && nd > 2) {
            /* sufficiently powerful lightning blinds monsters */
            const rnd_tmp = rnd(50);
            mon.mcansee = 0;
            mon.mblinded = Math.min(127, (mon.mblinded || 0) + rnd_tmp);
        }
        if (!rn2(3))
            tmp += await destroy_items(mon, AD_ELEC, orig_dmg);
        break;
    case ZT_POISON_GAS:
        if (resists_poison(mon) || defended(mon, AD_DRST)) {
            sho_shieldeff = true;
            break;
        }
        tmp = d(nd, 6);
        break;
    case ZT_ACID:
        if (resists_acid(mon) || defended(mon, AD_ACID)) {
            sho_shieldeff = true;
            break;
        }
        tmp = d(nd, 6);
        if (!rn2(6)) {
            const { acid_damage } = await import('./trap.js');
            await acid_damage(MON_WEP(mon));
        }
        if (!rn2(6)) await erode_armor_mon(mon);
        break;
    }
    if (sho_shieldeff)
        await shieldeff(mon.mx, mon.my);
    if (is_hero_spell(type) && Role_if_z(PM_KNIGHT_ROLE) && game.u?.uhave?.questart)
        tmp *= 2;
    if (tmp > 0 && type >= 0
        && resist(mon, type < BZ_U_SPELL(0) ? WAND_CLASS : 0, 0, false))
        tmp = Math.trunc(tmp / 2);
    if (tmp < 0)
        tmp = 0; /* don't allow negative damage */
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
// C ref: zap.c destroy_items / maybe_destroy_item / destroyable.
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
    return (carrier === game.u || carrier === game.youmonst)
        ? invent_list() : (Array.isArray(carrier?.minvent) ? carrier.minvent : []);
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
        if (obj.otyp !== 191 /*RIN_SHOCK_RESISTANCE*/ && obj.otyp !== WAN_LIGHTNING)
            return true;
    }
    return false;
}

// destroy_strings[dindx][0 singular, 1 plural].  C ref: zap.c.
const DESTROY_STRINGS = [
    ['freezes and shatters', 'freeze and shatter', 'shattered potion'],
    ['boils and explodes', 'boil and explode', 'boiling potion'],
    ['ignites and explodes', 'ignite and explode', 'exploding potion'],
    ['catches fire and burns', 'catch fire and burn', 'burning scroll'],
    ['catches fire and burns', '', 'burning book'],
    ['turns to dust and vanishes', '', ''],
    ['breaks apart and explodes', '', 'exploding wand'],
];


export async function destroy_items(mon, dmgtyp, dmg_in) {
    const objchn = obj_chain(mon);
    let limit = Math.floor(dmg_in / DMG_DESTROY_SCALE);
    if (dmg_in % DMG_DESTROY_SCALE > rn2(DMG_DESTROY_SCALE)) limit++;
    if (limit > MAX_ITEMS_DESTROYED) limit = MAX_ITEMS_DESTROYED;
    if (limit < 1) return 0;

    const items = new Array(limit);
    const u_carry = mon === game.u || mon === game.youmonst;
    let elig = 0;
    for (const obj of objchn) {
        if (!destroyable(obj, dmgtyp)) continue;
        const i = (elig < limit) ? elig : rn2(elig);
        elig++;
        if (i < 0 || i >= limit) continue;
        const prop = objects[obj.otyp]?.oc_oprop;
        const deferred = u_carry
            && ((obj.owornmask && (prop === LEVITATION || prop === FLYING))
                || (obj.otyp === POT_WATER && (game.u?.ulycn ?? NON_PM) >= 0
                    && (game.u?.Upolyd ? obj.blessed : obj.cursed)));
        items[i] = { obj, deferred: !!deferred };
    }
    if (elig > limit) elig = limit;
    let dmg_out = 0;
    for (let defer = 0; defer <= 1; defer++) {
        for (let i = 0; i < elig; i++) {
            const obj = items[i].obj;
            if (obj && obj_chain(mon).includes(obj)
                && items[i].deferred === (defer === 1)) {
                dmg_out += await maybe_destroy_item(mon, obj, dmgtyp);
                items[i].obj = null;
            }
        }
    }
    return dmg_out;
}

async function maybe_destroy_item(carrier, obj, dmgtyp) {
    const u_carry = carrier === game.u || carrier === game.youmonst;
    const visible = u_carry || canseemon_shared(carrier);
    const protection = u_carry ? u_adtyp_resistance_obj(dmgtyp) : 0;
    if (protection && rn2(100) < protection) return 0;
    let dindx = 0, dmg = 0, quan = 0, skip = 0, xresist = 0, chargeit = false;
    switch (dmgtyp) {
    case AD_COLD:
        quan = obj.quan; dindx = 0; dmg = rnd(4); break;
    case AD_FIRE:
        xresist = (obj.oclass !== POTION_CLASS && obj.otyp !== GLOB_OF_GREEN_SLIME
                   && (u_carry ? Fire_resistance() : resists_fire(carrier)));
        if (obj.otyp === SPE_BOOK_OF_THE_DEAD) {
            if (u_carry ? !Blind() : visible) {
                const { hcolor } = await import('./do_name.js');
                await update_topl(`The ${xname(obj)} glows a strange ${
                    hcolor('dark red')}, but remains intact.`);
            }
            return 0;
        }
        quan = obj.quan;
        switch (obj.oclass) {
        case POTION_CLASS: dindx = (obj.otyp !== POT_OIL) ? 1 : 2; dmg = rnd(6); break;
        case SCROLL_CLASS: dindx = 3; dmg = 1; break;
        case SPBOOK_CLASS: dindx = 4; dmg = 1; break;
        case FOOD_CLASS: dindx = 1; dmg = Math.floor((obj.owt + 19) / 20); break;
        }
        break;
    case AD_ELEC:
        xresist = obj.oclass !== RING_CLASS
            && (u_carry ? Shock_resistance() : resists_elec(carrier));
        quan = obj.quan;
        if (obj.oclass === WAND_CLASS) { dindx = 6; dmg = rnd(10); }
        else if (obj.oclass === RING_CLASS) {
            // C ref: zap.c:5863 — a worn ring under non-metallic gloves is
            // shielded outright; RIN_SHOCK_RESISTANCE is already excluded by
            // destroyable()'s pre-filter, so it's not re-checked here.
            const MAT_IRON = 11, MAT_MITHRIL = 17;
            const gloves = game.uarmg;
            const glovesMetallic = gloves
                && (objects[gloves.otyp]?.material | 0) >= MAT_IRON
                && (objects[gloves.otyp]?.material | 0) <= MAT_MITHRIL;
            if (((obj.owornmask & W_RING) !== 0) && gloves && !glovesMetallic) {
                skip = 1;
            } else if ((objects[obj.otyp]?.flags & 1 /* F_CHARGED */) && rn2(3)) {
                // C: chargeit -> recharge(obj, 0).  recharge() is NOT ported
                // anywhere in this codebase (read.js:2733's SCR_CHARGING
                // blocker); the rn2(3) gate above is faithful, the ring's
                // enchant-adjust/explode effect inside recharge() is not.
                chargeit = true;
            } else {
                dindx = 5;
            }
        }
        break;
    default: skip = 1; break;
    }
    if (chargeit) return dmg;
    if (skip) return dmg;

    let cnt = 0;
    if (obj.in_use) quan--;
    for (let i = 0; i < quan; i++) if (!rn2(3)) cnt++;
    if (!cnt) return 0;

    if (visible) {
        const mult = (cnt === 1) ? ((quan === 1) ? '' : 'One of ')
                   : ((cnt < quan) ? 'Some of ' : (quan === 2) ? 'Both of ' : 'All of ');
        const name = yname(obj);
        const nm = mult ? name : name[0].toUpperCase() + name.slice(1);
        await update_topl(`${mult}${nm} ${DESTROY_STRINGS[dindx][cnt > 1 ? 1 : 0]}!`);
    }
    if (u_carry) {
        const ptr = await youmonst_data_z();
        const flags = mflags1_of(ptr);
        if (obj.oclass === POTION_CLASS && dmgtyp !== AD_COLD
            && (!(flags & M1_BREATHLESS) || !(flags & M1_NOEYES))) {
            const { potionbreathe_hero } = await import('./potion.js');
            await potionbreathe_hero(obj);
        }
        if (obj.owornmask & W_RING) await Ring_gone(obj);
        else if (obj.owornmask) setnotworn(obj);
        if (obj === game.current_wand) game.current_wand = null;
    }
    const osym = obj.oclass;
    for (let i = 0; i < cnt; i++) {
        const last = obj.quan === 1;
        if (u_carry) useup(obj);
        else {
            const { m_useup } = await import('./muse.js');
            m_useup(carrier, obj);
        }
        if (last) {
            if (obj.timed) {
                const { obj_stop_timers } = await import('./timeout.js');
                await obj_stop_timers(obj);
            }
            obj.where = OBJ_FREE; /* as required by dealloc_obj */
            obj.ocarry = null;
            dealloc_obj(obj);
        }
    }
    if (dmg) {
        if (!u_carry) return xresist ? 0 : dmg;
        if (xresist) {
            await update_topl("You aren't hurt!");
        } else {
            const how = dmgtyp === AD_FIRE && osym === FOOD_CLASS
                ? 'exploding glob of slime' : DESTROY_STRINGS[dindx][2];
            const { losehp_do } = await import('./do.js');
            await losehp_do(dmg, cnt === 1 ? how : makeplural(how),
                cnt === 1 ? KILLED_BY_AN : KILLED_BY);
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
export async function catch_lit(obj) {
    if (obj.lamplit || !ignitable(obj)) return false;
    const loc = get_obj_location_z(obj, 0);
    if (!loc) return false;
    if (((obj.otyp === MAGIC_LAMP || obj.otyp === CANDELABRUM_OF_INVOCATION)
         && (obj.spe | 0) === 0)
        || (age_is_relative(obj) && (obj.age | 0) === 0)
        || obj.otyp === BRASS_LANTERN)
        return false;
    if (obj.otyp === CANDELABRUM_OF_INVOCATION && obj.cursed) return false;
    if ((obj.otyp === OIL_LAMP || obj.otyp === MAGIC_LAMP)
        && obj.cursed && !rn2(2))
        return false;
    if (obj.where === OBJ_INVENT || cansee(loc.x, loc.y)) {
        const plural = (obj.quan || 1) > 1;
        const verb = Blind() ? (plural ? 'feel' : 'feels') : (plural ? 'catch' : 'catches');
        const name = yname(obj);
        await update_topl(`${name[0].toUpperCase() + name.slice(1)} ${verb} ${
            Blind() ? 'warm.' : 'light!'}`);
    }
    if (obj.otyp === POT_OIL) makeknown(obj.otyp);
    const { begin_burn } = await import('./timeout.js');
    await begin_burn(obj, false);
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
// C ref: hack.c losehp(n, knam, k_format).  Every call marks the status line
// dirty and ends running/travel.  The HP bookkeeping, the polymorphed hero's
// rehumanize() arm, maybe_wail() and the "You die..." death path are do.js
// losehp_do(), the complete port of the same function.
export async function losehp(n, knam, k_format = KILLED_BY_AN) {
    if (game.program_state?.gameover) return;
    game.botl = true; /* u.uhp or u.mh is changing */
    const { end_running } = await import('./hack.js');
    end_running(true);
    const { losehp_do } = await import('./do.js');
    await losehp_do(n, knam, k_format);
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
            await shieldeff(u.ux, u.uy);
            await pline('Boing!');
            monstseesu(M_SEEN_MAGR);
        } else {
            if (ordinary) {
                await update_topl('You bash yourself!');
                damage = d(2, 12);
            } else {
                damage = d(1 + (obj.spe | 0), 6);
            }
            exercise(A_STR, false);
            monstunseesu(M_SEEN_MAGR);
        }
        break;

    case WAN_LIGHTNING:
        learn_it = true;
        orig_dmg = d(12, 6);
        if (!Shock_resistance()) {
            await update_topl('You shock yourself!');
            damage = orig_dmg;
            exercise(A_CON, false);
            monstunseesu(M_SEEN_ELEC);
        } else {
            await shieldeff(u.ux, u.uy);
            await update_topl('You zap yourself, but seem unharmed.');
            monstseesu(M_SEEN_ELEC);
            // ugolemeffects(AD_ELEC, orig_dmg): only a polymorphed golem hero.
        }
        await destroy_items(u, AD_ELEC, orig_dmg);
        await flashburn(rnd(100), true);
        break;

    case WAN_FIRE:
    case FIRE_HORN:
        learn_it = true;
        orig_dmg = d(12, 6);
        if (Fire_resistance()) {
            await shieldeff(u.ux, u.uy);
            await update_topl('You feel rather warm.');
            monstseesu(M_SEEN_FIRE);
        } else {
            await update_topl("You've set yourself afire!");
            damage = orig_dmg;
            monstunseesu(M_SEEN_FIRE);
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
            await shieldeff(u.ux, u.uy);
            await update_topl('You feel a little chill.');
            monstseesu(M_SEEN_COLD);
        } else {
            await update_topl('You imitate a popsicle!');
            damage = orig_dmg;
            monstunseesu(M_SEEN_COLD);
        }
        await destroy_items(u, AD_COLD, orig_dmg);
        break;

    case WAN_MAGIC_MISSILE:
    case SPE_MAGIC_MISSILE:
        learn_it = true;
        if (Antimagic()) {
            await shieldeff(u.ux, u.uy);
            await update_topl('The missiles bounce!');
            monstseesu(M_SEEN_MAGR);
        } else {
            damage = d(4, 6);
            await pline("Idiot!  You've shot yourself!");
            monstunseesu(M_SEEN_MAGR);
        }
        break;

    case SPE_FIREBALL: {
        // C ref: zap.c:2748 — reuses explode()'s WAND_CLASS "retributive
        // strike" path, so a Cleric/Monk/Wizard hero takes 1/5 damage and a
        // Healer/Knight takes 1/2 (explode.js:277 already has that table).
        await update_topl('You explode a fireball on top of yourself!');
        const { explode } = await import('./explode.js');
        const { EXPL_FIERY } = await import('./const.js');
        await explode(u.ux, u.uy, 11, d(6, 6), WAND_CLASS, EXPL_FIERY);
        break;
    }

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
        await cancel_monst(u, obj, true, true, true);
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
        const msg = !Invis() && !Blind() && !(u.uprops?.BInvis || u.BInvis);
        if (!u.uprops) u.uprops = {};
        if ((u.uprops.BInvis || u.BInvis) && game.uarmc
            && game.uarmc.otyp === MUMMY_WRAPPING_Z) {
            /* A mummy wrapping absorbs it and protects you */
            await pline(`You feel rather itchy under ${yname(game.uarmc)}.`);
            break;
        }
        u.uprops.HInvis = (u.uprops.HInvis | 0) + rn1(15, 31);
        if (msg) {
            learn_it = true;
            newsym(u.ux, u.uy);
            const { self_invis_message } = await import('./potion.js');
            await self_invis_message();
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
            await shieldeff(u.ux, u.uy);
            await update_topl("You don't feel sleepy!");
            monstseesu(M_SEEN_SLEEP);
        } else {
            if (ordinary)
                await update_topl('The sleep ray hits you!');
            else
                await update_topl('You fall asleep!');
            monstunseesu(M_SEEN_SLEEP);
            await fall_asleep(-rnd(50), true);
        }
        break;
    case WAN_DEATH:
    case SPE_FINGER_OF_DEATH:
        {
            const ymd = await youmonst_data_z();
            if (nonliving_ptr(ymd) || is_demon_flag(ymd)) {
                await pline((obj.otyp === WAN_DEATH)
                    ? 'The wand shoots an apparently harmless beam at you.'
                    : 'You seem no deader than before.');
                break;
            }
        }
        // C ref: zap.c zapyourself() — identify a seen wand after done(DIED)
        // returns from life saving or a declined wizard death.
        learn_it = true;
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
        await urgent_topl('You irradiate yourself with pure energy!');
        await urgent_topl('You die.');
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
        await tele();
        /* same criteria as when mounted (zap_steed) */
        if ((Teleport_control() && !Stunned())
            || !(await couldsee_z(u.ux0, u.uy0))
            || distu_z(u.ux0, u.uy0) >= 16)
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
        const { healup } = await import('./spell.js');
        await healup(d(6, extra ? 8 : 4), 0, false, !!obj.blessed || extra);
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
    case SPE_KNOCK: {
        if (u.ustuck) {
            await release_hold();
            learn_it = true;
        }
        if (game.uball) { /* Punished */
            learn_it = true;
            const { unpunish } = await import('./read.js');
            unpunish();
        }
        /* invent is hit iff hero doesn't escape from a trap */
        const noticed = { value: learn_it };
        const { openholdingtrap, openfallingtrap } = await import('./trap.js');
        if (!u.utrap || !(await openholdingtrap(u, noticed))) {
            await boxlock_invent(obj);
            /* trigger previously escaped trapdoor */
            await openfallingtrap(u, true, noticed);
        }
        learn_it = noticed.value;
        break;
    }
    case WAN_LOCKING:
    case SPE_WIZARD_LOCK: {
        const noticed = { value: learn_it };
        const { closeholdingtrap } = await import('./trap.js');
        /* similar logic to opening; invent is hit iff no trap triggered */
        if (u.utrap || !(await closeholdingtrap(u, noticed))) {
            await boxlock_invent(obj);
        }
        learn_it = noticed.value;
        break;
    }
    case WAN_DIGGING:
    case SPE_DIG:
    case SPE_DETECT_UNSEEN:
    case WAN_NOTHING:
        break;
    case WAN_PROBING:
        probe_objchain(invent_list());
        update_inventory();
        learn_it = true;
        await ustatusline();
        break;
    case SPE_STONE_TO_FLESH: {
        // C ref: zap.c:2966-3003.  u.umonnum only names a monster form while
        // Upolyd in this port (it holds the role index otherwise).
        if (u.Upolyd && u.umonnum === await PM_('stone golem')) {
            learn_it = true;
            const { polymon } = await import('./polyself.js');
            await polymon(await PM_('flesh golem'));
        }
        if ((u.uprops?.Stoned | 0) > 0) {
            learn_it = true;
            const { fix_petrification } = await import('./eat.js');
            await fix_petrification(); /* saved! */
        }
        /* but at a cost.. */
        for (const otmp of [...invent_list()]) {
            if (await bhito(otmp, obj))
                learn_it = true;
        }
        /* It is possible that we can now merge some inventory.  Do a highly
           paranoid merge: restart from the beginning until no merges.  Don't
           merge worn items (in case of stone-to-flesh of rocks wielded in
           differing weapon/alt-wep/quiver slot). */
        const { merged } = await import('./invent.js');
        let didmerge;
        do {
            didmerge = false;
            const inv = invent_list();
            for (let i = 0; !didmerge && i < inv.length; i++) {
                const otmp = inv[i];
                if (otmp.owornmask)
                    continue;
                for (let j = i + 1; j < inv.length; j++) {
                    if (merged(otmp, inv[j])) {
                        didmerge = true;
                        break;
                    }
                }
            }
        } while (didmerge);
        break;
    }

    default:
        break;
    }
    // C ref: zap.c zapyourself() tail — discover the wand type if its effect
    // was observable and the wand itself has been seen.
    if (learn_it) learnwand(obj);
    return damage;
}

// C ref: teleport.c tele() == scrolltele((struct obj *) 0).  scrolltele() (read.js)
// owns the noteleport-level refusal, the Amulet / Wizard's-tower rn2(3), the
// controlled-teleport getpos() prompt and the uncontrolled safe_teleds().  This
// used to route a controlled teleport through hack.js dotele_wizard(), which is
// the ^T COMMAND: it also charges dotele()'s morehungry(100), so a monster's
// teleport-hit or a teleport wand cost the hero 100 nutrition C never charges.
export async function tele() {
    const { scrolltele } = await import('./read.js');
    await scrolltele(null);
}

// C ref: zap.c:1225 unturn_you — unturn_dead() over carried corpses/eggs, then
// the undead-hero stun.
async function unturn_you() {
    const u = game.u;
    await unturn_dead(u); /* hit carried corpses and eggs */

    if (is_undead_flag(await youmonst_data_z())) {
        await pline(`You feel frightened and ${Stunned() ? 'even more ' : ''}stunned.`);
        const { make_stunned_u } = await import('./mhitu.js');
        await make_stunned_u((u.uprops?.Stun | 0) + rnd(30), false);
    } else {
        await pline('You shudder in dread.');
    }
}

// C ref: zap.c flashburn(duration, via_lightning) — blind the hero unless
// blindness is resisted.  resists_blnd(&youmonst) for the hero is
// (Blind || Unaware); the Sunsword arm needs artifact state this port lacks.
// make_blinded() draws no RNG but toggle_blindness() recalculates vision and
// redraws the map, so a seen monster must vanish from the display at once.
export async function flashburn(duration, _via_lightning) {
    const u = game.u;
    if (Blind() || u?.uprops?.Unaware || u?.usleep) return false;
    await pline('You are blinded by the flash!');
    const { make_blinded_hero } = await import('./potion.js');
    await make_blinded_hero(duration, false);
    if (!Blind()) await pline('Your vision clears.');
    return true;
}

// C ref: youprop.h hero property predicates.  This port stores intrinsics under
// game.u.uprops (potion.js/cmd.js convention); an unmodelled property reads
// false, which is what the covered heroes actually have.
export function Fire_resistance() {
    if (game.u?.formprops?.Fire_resistance) return true; /* FROMFORM: polyself.js set_uasmon() */
    const u = game.u;
    return !!(u?.uprops?.Fire_resistance || u?.uprops?.HFire_resistance
        || u?.uprops?.EFire_resistance || u?.Fire_resistance
        || worn_extrinsic(FIRE_RES) || has_innate('HFire_resistance')
        || (u?.Upolyd && resists_fire(u)));
}
export function Cold_resistance() {
    if (game.u?.formprops?.Cold_resistance) return true; /* FROMFORM: polyself.js set_uasmon() */
    const u = game.u;
    return !!(u?.uprops?.Cold_resistance || u?.uprops?.HCold_resistance
        || u?.uprops?.ECold_resistance || u?.Cold_resistance
        || worn_extrinsic(COLD_RES) || has_innate('HCold_resistance')
        || (u?.Upolyd && resists_cold(u)));
}
function Shock_resistance() {
    if (game.u?.formprops?.Shock_resistance) return true; /* FROMFORM: polyself.js set_uasmon() */
    const u = game.u;
    return !!(u?.uprops?.Shock_resistance || u?.uprops?.HShock_resistance
        || u?.uprops?.EShock_resistance || u?.Shock_resistance
        || worn_extrinsic(SHOCK_RES) || has_innate('HShock_resistance')
        || (u?.Upolyd && resists_elec(u)));
}
function Acid_resistance()  { return !!game.u?.formprops?.Acid_resistance || (game.u?.uprops?.AcidResistance    || 0) > 0; }
function Disint_resistance(){ return !!game.u?.formprops?.Disint_resistance || (game.u?.uprops?.HDisint_resistance|| 0) > 0; }
function Drain_resistance() { return !!game.u?.formprops?.Drain_resistance || (game.u?.uprops?.HDrain_resistance || 0) > 0; }
export function Antimagic() { return !!(game.u?.formprops?.Antimagic || game.u?.HAntimagic || game.u?.Antimagic
                                        || game.u?.uprops?.HAntimagic
                                        || worn_extrinsic(ANTIMAGIC)); }
function Half_spell_damage(){ return (game.u?.uprops?.HHalf_spell_damage|| 0) > 0; }
function Unchanging()       { return (game.u?.uprops?.HUnchanging       || 0) > 0; }
function Invis()            { return !!(game.u?.uprops?.HInvis); }
function Teleport_control() { return !!game.u?.formprops?.Teleport_control || (game.u?.uprops?.HTeleport_control || 0) > 0; }
function Stunned()          { return !!game.u?.formprops?.Stunned || !!(game.u?.uprops?.Stun || game.u?.Stunned); }
// C ref: hack.h dist2(x0,y0,x1,y1).
function dist2(x0, y0, x1, y1) { return (x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0); }

// C ref: youprop.h Sleep_resistance — intrinsic/extrinsic sleep immunity.
// HSleep_resistance's innate source (elf from level 4, monk from level 1) is
// never persisted as a stored uprops flag — adjabil() only prints the "You
// feel drowsy/awake!" message — so OR in the pure has_innate() derivation,
// the same pattern potion.js/artifact.js/fountain.js/explode.js already use
// for their own H<Prop> reads.
export function Sleep_resistance() {
    if (game.u?.formprops?.Sleep_resistance) return true; /* FROMFORM: polyself.js set_uasmon() */
    return (game.u?.uprops?.SleepResistance || 0) > 0
        || has_innate('HSleep_resistance');
}

// C ref: timeout.c fall_asleep(how_long, wakeup_msg) — the hero collapses
// helpless for |how_long| turns (how_long < 0).  nomul(how_long) sets the
// negative multi the moveloop counts back up; u.usleep marks the hero Unaware
// (gethungry then burns nutrition at 1/10 via rn2(10)); nomovemsg is announced
// by unmul() when the countdown reaches 0.
export async function fall_asleep(how_long, wakeup_msg) {
    const { stop_occupation, nomul } = await import('./hack.js');
    await stop_occupation();
    nomul(how_long);
    game.multi_reason = 'sleeping';
    if (game.u) game.u.usleep = game.moves ?? 1;
    game.nomovemsg = wakeup_msg ? 'You wake up.' : 'You can move again.';
}

// C ref: zap.c zapyourself() -> end.c done(DIED).  There is one death
// lifecycle for every cause: inventory identification and disclosure run
// before the corpse, bones, score, and terminal teardown.  Keep the import
// lazy because end.js and zap.js refer to each other during module setup.
async function done_selfzap(how) {
    const { done } = await import('./end.js');
    await done(how);
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

    await (await import('./shk.js')).check_unpaid_usage(obj, false);

    const need_dir = objects[obj.otyp]?.dir !== NODIR;
    const u = game.u;
    let dir = null;
    if (need_dir) {
        // C ref: dozap() — preserve C's evaluation order below: zappable()
        // (charge) before cursed-backfire before getdir().
    }
    if (!(await zappable(obj))) {
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
            const { killer_xname } = await import('./objnam.js');
            const him = game.u.Upolyd ? (game.u.mfemale ? 'her' : 'him')
                                      : (game.flags?.female ? 'her' : 'him');
            await losehp(Maybe_Half_Phys(damage),
                         `zapped ${him}self with ${killer_xname(obj)}`,
                         NO_KILLER_PREFIX);
        }
    } else {
        game.current_wand = obj;
        await weffects(obj);
        game.current_wand = 0;
    }
    if (obj && obj.spe < 0) {
        await pline(`${await Tobjnam_z(obj, 'turn')} to dust.`);
        useupall(obj);
    }
    return ECMD_TIME;
}

// ===========================================================================
// zap.c completeness ports — INERT: nothing above this banner calls into this
// block.  Covers zap.c routines whose call sites (undead turning, cancellation,
// corpse revival, ice melting, riding, wish assistance) aren't wired up yet.
//
// Cross-module helpers use `await import()` (this file's existing convention,
// e.g. create_critters/create_polymon/zap_updown/zap_map/done_selfzap) to avoid
// a new top-level edge that would reorder module evaluation — hence several
// C-void/C-boolean routines below are `async`.
// ===========================================================================


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
// C ref: shk.c stolen_value(obj, x, y, peaceful, silent).  Returns the billed
// amount; the port lives in js/shk.js (dynamic import, shk.js imports zap.js).
async function stolen_value_z(obj, x, y, peaceful, silent) {
    return (await import('./shk.js')).stolen_value(obj, x, y, peaceful, silent);
}
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
// C ref: PM_KNIGHT as Role_if() sees it, i.e. the roles[] index this port
// stores in game.urole.mnum (enhance.js and u_init.js use the same 4).
const PM_KNIGHT_ROLE = 4;
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
// C ref: mon.c minliquid(mtmp) — js/mon.js:591 owns the real one but does not
// export it (js/dig.js:882 keeps a NOT-PORTED stub under the same name).
async function minliquid_z(mtmp) { return (await import('./mon.js')).minliquid(mtmp); }
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
        await unstuck(u.ustuck);
        const relbuf = !nohands(mtmp.data)
            ? `from ${s_suffix(mon_nam(mtmp))} grasp`
            : `by ${mon_nam(mtmp)}`;
        await pline(`You are released ${relbuf}.`);
    }
}


// C ref: insight.c size_str(msize) / ordin(n) — small helpers for mstatusline().
function size_str_z(msize) {
    switch (msize) {
    case 0: return 'tiny';
    case 1: return 'small';
    case 2: return 'medium';
    case 3: return 'large';
    case 4: return 'huge';
    case 7: return 'gigantic';
    default: return `unknown size (${msize})`;
    }
}
function ordin_z(n) {
    const dd = n % 10;
    return (dd === 0 || dd > 3 || Math.trunc(n / 10) === 1) ? 'th'
         : (dd === 1) ? 'st' : (dd === 2) ? 'nd' : 'rd';
}

// C ref: insight.c:3275 mstatusline(mtmp) — the one-line "Status of ..." report
// used by wand of probing (and the stethoscope).  Exported so apply.js's
// stethoscope can share this complete version.
export async function mstatusline(mtmp) {
    const u = game.u;
    const { mon_aligntyp } = await import('./minion.js');
    const { align_str } = await import('./insight.js');
    const alignment = mon_aligntyp(mtmp);
    const bp = game.bhitpos || { x: mtmp.mx, y: mtmp.my };
    let info = '';

    if (mtmp.mtame) {
        info += ', tame';
        if (game.flags?.debug || game.wizard) {
            info += ` (${mtmp.mtame}`;
            if (!mtmp.isminion)
                info += `; hungry ${mtmp.edog?.hungrytime}; apport ${mtmp.edog?.apport}`;
            info += ')';
        }
    } else if (mtmp.mpeaceful) info += ', peaceful';

    if (mtmp.data?.pmidx === await PM_('long worm')) {
        const { count_wsegs, wseg_at } = await import('./worm.js');
        let nsegs = count_wsegs(mtmp);

        /* the worm code internals don't consider the head to be one of
           the worm's segments, but we count it as such when presenting
           worm feedback to the player */
        if (!nsegs) {
            info += ', single segment';
        } else {
            ++nsegs; /* include head in the segment count */
            const segndx = wseg_at(mtmp, bp.x, bp.y);
            info += `, ${segndx}${ordin_z(segndx)} of ${nsegs} segments`;
        }
    }
    if ((mtmp.cham ?? NON_PM) >= 0 && mtmp.data?.pmidx !== mtmp.cham)
        /* don't reveal the innate form (chameleon, vampire, &c),
           just expose the fact that this current form isn't it */
        info += ', shapechanger';
    /* pets eating mimic corpses mimic while eating, so this comes first */
    if (mtmp.meating)
        info += ', eating';
    /* a stethoscope exposes mimic before getting here so this
       won't be relevant for it, but wand of probing doesn't */
    const { visible_region_at } = await import('./region.js');
    if (mtmp.mundetected || mtmp.m_ap_type || visible_region_at(bp.x, bp.y)) {
        const { mhidden_description } = await import('./pager.js');
        info += mhidden_description(mtmp, MHID_PREFIX | MHID_ARTICLE
                                          | MHID_ALTMON | MHID_REGION);
    }
    if (mtmp.mcan)
        info += ', cancelled';
    if (mtmp.mconf)
        info += ', confused';
    if (mtmp.mblinded || !mtmp.mcansee)
        info += ', blind';
    if (mtmp.mstun)
        info += ', stunned';
    if (mtmp.msleeping)
        info += ', asleep';
    else if (mtmp.mfrozen || !mtmp.mcanmove)
        info += ", can't move";
    /* [arbitrary reason why it isn't moving] */
    else if (((mtmp.mstrategy | 0) & STRAT_WAITMASK) !== 0)
        info += ', meditating';
    if (mtmp.mflee)
        info += ', scared';
    if (mtmp.mtrapped)
        info += ', trapped';
    if (mtmp.mspeed)
        info += (mtmp.mspeed === MFAST) ? ', fast'
              : (mtmp.mspeed === MSLOW) ? ', slow'
              : ', [? speed]';
    if (mtmp.minvis)
        info += ', invisible';
    if (mtmp === u.ustuck) {
        const pm = u.ustuck.data;

        /* being swallowed/engulfed takes priority over sticks(youmonst) */
        info += u.uswallow
            ? (digests(pm) ? ', digesting you'
               : (is_animal(pm) && !attacktype_fordmg(pm, AT_ENGL, AD_WRAP))
                   ? ', swallowing you'
                   : ', engulfing you')
            : (!sticks(await youmonst_data_z()) ? ', holding you'
                                                : ', held by you');
    }
    if (mtmp === u.usteed)
        info += ', carrying you';
    if (mtmp.mleashed)
        info += ', leashed';

    /* avoid "Status of the invisible newt ..., invisible" */
    /* and unlike a normal mon_nam, use "saddled" even if it has a name */
    const monnambuf = x_monnam(mtmp, 3 /* ARTICLE_YOUR */, null,
                               0x01 /* SUPPRESS_IT */ | 0x02 /* SUPPRESS_INVISIBLE */, false);

    await pline(`Status of ${monnambuf} (${align_str(alignment)}, ${
        size_str_z(mtmp.data?.msize | 0)}):  Level ${mtmp.m_lev | 0}  HP ${
        mtmp.mhp | 0}(${mtmp.mhpmax | 0})  AC ${find_mac(mtmp)}${info}.`);
}

// C ref: insight.c:3400 ustatusline() — the one-line "Status of <you> (...)"
// report a wand of probing gives when zapped at yourself.
export async function ustatusline() {
    const u = game.u;
    const up = u?.uprops || {};
    let info = '';

    if (up.Sick) {
        info += ', dying from';
        const st = u.usick_type | 0;
        if (st & 1 /* SICK_VOMITABLE */) info += ' food poisoning';
        if (st & 2 /* SICK_NONVOMITABLE */) {
            if (st & 1) info += ' and';
            info += ' illness';
        }
    }
    if (up.Stoned) info += ', solidifying';
    if (up.Slimed) info += ', becoming slimy';
    if (up.Strangled) info += ', being strangled';
    if (up.Vomiting) info += ', nauseated'; /* !"nauseous" */
    if (up.Confusion) info += ', confused';
    if (Blind()) {
        info += ', blind';
        if (u.ucreamed) {
            if ((u.ucreamed | 0) < (u.blinded | 0) || game.ublindf
                || !!(mflags1_of(await youmonst_data_z()) & M1_NOEYES))
                info += ', cover';
            info += 'ed by sticky goop';
        } /* note: "goop" == "glop"; variation is intentional */
    }
    if (Stunned()) info += ', stunned';
    if (up.Glib) info += ', slippery fingers';
    if (u.utrap) info += ', trapped';
    if (up.Fast || up.HFast) info += up.Very_fast ? ', very fast' : ', fast';
    if (u.uundetected) info += ', concealed';
    else if (M_AP_TYPE(u) !== M_AP_NOTHING) info += ', disguised';
    if (Invis()) info += ', invisible';
    if (u.ustuck) {
        if (u.uswallow)
            info += digests(u.ustuck.data) ? ', being digested by ' : ', engulfed by ';
        else if (!sticks(await youmonst_data_z()))
            info += ', held by ';
        else
            info += ', holding ';
        const { a_monnam } = await import('./do_name.js');
        info += a_monnam(u.ustuck);
    }
    if (!u.uswallow) {
        const { visible_region_at } = await import('./region.js');
        const reg = visible_region_at(u.ux, u.uy);
        if (reg)
            info += `, in a cloud of ${reg.damg ? 'poison gas' : 'vapor'}`;
    }

    const record = u.ualign?.record | 0;
    let pio;
    if (record >= 20) pio = 'piously';
    else if (record > 13) pio = 'devoutly';
    else if (record > 8) pio = 'fervently';
    else if (record > 3) pio = 'stridently';
    else if (record === 3) pio = '';
    else if (record > 0) pio = 'haltingly';
    else if (record === 0) pio = 'nominally';
    else if (record >= -3) pio = 'strayed';
    else if (record >= -8) pio = 'sinned';
    else pio = 'transgressed';
    const { align_str } = await import('./insight.js');
    const al = align_str(u.ualign?.type ?? 0);
    let piobuf = pio;
    if (record >= 0) {
        if (record !== 3) piobuf += ' ';
        piobuf += al;
    }
    await pline(`Status of ${game.plname || 'Hero'} (${piobuf}):  Level ${
        u.Upolyd ? (u.data?.mlevel | 0) : (u.ulevel | 0)}  HP ${
        u.Upolyd ? u.mh : u.uhp}(${u.Upolyd ? u.mhmax : u.uhpmax})  AC ${u.uac | 0}${info}.`);
}

// C ref: zap.c:626 probe_monster(mtmp).
export async function probe_monster(mtmp) {
    await mstatusline(mtmp);
    if (game.notonhead)
        return; /* don't show minvent for long worm tail */

    if (Array.isArray(mtmp.minvent) && mtmp.minvent.length) {
        probe_objchain(mtmp.minvent);
        await display_minventory(mtmp, MINV_ALL | MINV_NOLET | PICK_NONE, null);
    } else {
        const { noit_Monnam } = await import('./do_name.js');
        await pline(`${noit_Monnam(mtmp)} is not carrying anything${
            engulfing_u(mtmp) ? ' besides you' : ''}.`);
    }
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

    const { makemon, makemon_appears_msg, newcham } = await import('./makemon.js');
    const mt = { mtype: montype };
    if (await cant_revive_z(mt, true, corpse)) {
        /* make a zombie or doppelganger instead; note: montype has changed,
           mptr keeps its old value for newcham() */
        montype = mt.mtype;
        mtmp = makemon(await mons_(montype), x, y, mmflags);
        await makemon_appears_msg(mtmp, x, y, mmflags);
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
        await makemon_appears_msg(mtmp, x, y, mmflags | MM_NOCOUNTBIRTH);
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
            await stolen_value_z(corpse, x, y, !!shkp.mpeaceful, false);

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
                add_to_minv(mtmp, otmp);
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
            obj = await poly_obj_id(obj, ENORMOUS_MEATBALL);
            smell = true;
        } else if (obj.otyp === STATUE || obj.otyp === FIGURINE) {
            ptr = await mons_(obj.corpsenm);
            if (is_golem_z(ptr)) {
                golem_xform = (ptr.pmidx !== PM_FLESH_GOLEM_Z);
            } else if (vegetarian(ptr)) {
                /* Don't animate monsters that aren't flesh */
                obj = await poly_obj_id(obj, MEATBALL);
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
                        await stolen_value_z(obj, oox, ooy,
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
                    await (await import('./makemon.js')).newcham_wizard_aware(
                        mon, await mons_(PM_FLESH_GOLEM_Z), NC_VIA_WAND_OR_SPELL);
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
                obj = await poly_obj_id(obj, CORPSE);
            }
        } else { /* miscellaneous tool or unexpected rock... */
            res = 0;
        }
        break;
    /* maybe add weird things to become? */
    case RING_CLASS: /* some of the rings are stone */
        obj = await poly_obj_id(obj, MEAT_RING);
        smell = true;
        break;
    case WAND_CLASS: /* marble wand */
        obj = await poly_obj_id(obj, MEAT_STICK);
        smell = true;
        break;
    case GEM_CLASS: /* stones & gems */
        obj = await poly_obj_id(obj, MEATBALL);
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

    /* (un)lock carried boxes */
    for (const otmp of [...invent_list()]) {
        if (Is_box_z(otmp)) {
            await boxlock_pline(otmp, obj);
            boxing = true;
        }
    }
    if (boxing)
        update_inventory(); /* in case any box->lknown has changed */
}

// C ref: zap.c:3017 ubreatheu(mattk) — a poly'd hero breathes at herself.
export async function ubreatheu(mattk) {
    const dtyp = 20 + mattk.adtyp - 1;      /* breath by hero */

    await zhitu(dtyp, mattk.damn, flash_str(dtyp, true), game.u.ux, game.u.uy);
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
        await probe_monster(u.usteed);
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
            await shieldeff(x, y);
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
// Floor effects and spoteffects() may draw RNG.
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
    const { t_at, spoteffects, trap_ice_effects } = await import('./trap.js');
    if (t_at(x, y))
        trap_ice_effects(x, y, true); /* TRUE because ice_is_melting */
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
        const { boulder_hits_pool } = await import('./do.js');
        if (cansee(x, y))
            await pline(`${An_z(xname(otmp))} settles...`);
        do {
            obj_extract_self(otmp); /* boulder isn't being pushed */
            if (!(await boulder_hits_pool(otmp, x, y, false)))
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

        // C ref: zap.c:5528 — the spell caster already handles its target.
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

    const lines = [...wishinfo];
    if (!game.u?.uconduct?.wishes)
        lines.push(preserve_wishless);
    lines.push('');
    /* C: retry_info[] = "If you specify an unrecognized object name %s%s time%s," */
    const cardinal = (triesleft >= 0 && triesleft < cardinals.length)
        ? cardinals[triesleft] : too_many;
    lines.push(`If you specify an unrecognized object name ${cardinal}${
        (triesleft < MAXWISHTRY_Z) ? ' more' : ''} time${plur_z(triesleft)},`);
    lines.push(retry_too);
    lines.push('');
    if (game.iflags?.cmdassist !== false)
        lines.push(suppress_cmdassist);
    /* NHW_TEXT window: these lines are too wide for a corner overlay, so it
       is full-screen (offx 0), paged by dmore() on the bottom row and torn
       down with docrt() by erase_menu_or_text(). */
    const { renderWindowScreen, dismiss_invent_screen } = await import('./invent.js');
    const { nhgetch, xwaitforspace_quit } = await import('./input.js');
    renderWindowScreen(lines, { footer: '--More--', footerRow: 23, footerCol: 0,
                                modal: 'textwin' });
    /* xwaitforspace(quitchars) */
    for (;;) {
        const c = await nhgetch();
        if (xwaitforspace_quit(c)) break;
    }
    await dismiss_invent_screen();
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
