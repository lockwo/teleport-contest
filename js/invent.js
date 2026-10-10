// invent.js - Inventory and look-here support.
// C ref: src/invent.c
//
// This file intentionally keeps one JavaScript function for each C function
// in invent.c.  Many game systems that invent.c calls into are still outside
// the JS port; those call sites are represented by local TODO stubs or by
// conservative no-op behavior so downstream porters have a stable 1:1 map.

import { game } from './gstate.js';
import { s_suffix } from './hacklib.js';
import { find_mac as worn_find_mac, clear_bypasses } from './worn.js';
import { rn2, rnd, rnl, d } from './rng.js';
import { nhgetch, xwaitforspace_quit } from './input.js';
import { docrt, flush_screen, newsym, see_monsters, set_mimic_blocking, map_object, pline, putStatusRow, render_map_to_grid, y_n, topl_more, topl_more_ext, update_topl, bot, bot_snapshot, m_at, display_nhwindow_message, obj_to_glyph, object_glyph, remember_topl, yn_prompt_history, key2txt, note_topl, wrap_topl, show_glyph_cell, tmp_at_flash } from './display.js';
import { hooks } from './gstate.js';
import { cansee, Blind as Blind_for_wear } from './vision.js';
import { distmin, depth as depth_of_level } from './hacklib.js';
import { surface, ceiling as ceiling_dg } from './dungeon.js';
import { mmove_of } from './mon.js';
import { touch_artifact_monster, touch_artifact_hero_flags, the_artifact_name,
    confers_luck, set_artifact_intrinsic_core, disp_artifact_discoveries } from './artifact.js';
import { is_quest_artifact, artitouch } from './questpgr.js';
import { WEP_HITBON } from './weapondmg_data.js';
import { ATR_INVERSE, ATR_BOLD, ATR_UNDERLINE, CLR_GRAY, NO_COLOR } from './terminal.js';

// options.js stores menu_headings.attr verbatim in its own enum (NONE=0,
// BOLD=1, DIM=2, ITALIC=3, ULINE=4, BLINK=5, INVERSE=6 — C ref: options.c
// ATR_* / coloratt.c attrnames[]), NOT terminal.js's render BITS (NONE=0,
// INVERSE=1, BOLD=2, UNDERLINE=4); only NONE/ULINE(4) coincide by accident.
// Per [[options-storage-contract]] this is the consumer-side translation;
// DIM/ITALIC/BLINK have no render bit here and fall back to no attr.
function menuHeadAttr() {
    const a = game.iflags?.menu_headings?.attr;
    if (a == null) return ATR_INVERSE;
    switch (a) {
    case 1: return ATR_BOLD;       // options.js ATR_BOLD
    case 4: return ATR_UNDERLINE;  // options.js ATR_ULINE
    case 6: return ATR_INVERSE;    // options.js ATR_INVERSE
    default: return ATR_NONE;      // NONE/DIM/ITALIC/BLINK: no render bit
    }
}
import {
    AMULET_CLASS,
    AMULET_OF_YENDOR,
    ARMOR_CLASS,
    BAG_OF_TRICKS,
    BALL_CLASS,
    BELL_OF_OPENING,
    BLINDING_VENOM,
    BOULDER,
    CHAIN_CLASS,
    CHEST,
    COIN_CLASS,
    CORPSE,
    EGG,
    FIGURINE,
    FOOD_CLASS,
    GEM_CLASS,
    GOLD_PIECE,
    HORN_OF_PLENTY,
    ILLOBJ_CLASS,
    LOADSTONE,
    MAXOCLASSES,
    POTION_CLASS,
    WAN_FIRE,
    POT_WATER,
    RING_CLASS,
    ROCK,
    MEAT_RING,
    ROCK_CLASS,
    SCROLL_CLASS,
    SCR_BLANK_PAPER,
    SCR_SCARE_MONSTER,
    SLIME_MOLD,
    SPE_NOVEL,
    SPBOOK_CLASS,
    STATUE,
    TIN,
    TOOL_CLASS,
    VENOM_CLASS,
    WAND_CLASS,
    WEAPON_CLASS,
    objects,
    GemStone,
    weight,
    nextoid,
    place_object as mkobj_place_object,
    base_oc_weight,
    // C ref: timeout.c attach_fig_transform_timeout() — carry_obj_effects()
    // starts the real rnd(9000)+200 FIG_TRANSFORM timer, not a flag.
    attach_fig_transform_timeout,
} from './mkobj.js';

import { getpos, getpos_render, travel_adjacent_step, ia_checkfile_name, checkfile, nomul } from './hack.js';
import { observe_object as disco_observe_object, build_discoveries_rows, discover_object } from './o_init.js';
import { monster_by_pmidx, pmname_of_pmidx, name_to_pmidx } from './makemon.js';
import { strongmonst_flag as strongmonst, throws_rocks_flag, is_were_flag, hates_silver,
         is_neuter_flag, humanoid as humanoid_flag, nolimbs as nolimbs_flag,
         mflags1_of, mflags2_of, likes_gems_flag,
         M1_NOHEAD, M1_NOTAKE, M1_NOHANDS,
         M2_DEMON, M2_UNDEAD, M2_ORC } from './monflags_data.js';
import { tin_variety, SPINACH_TIN, ROTTEN_TIN, HOMEMADE_TIN, tintxts, vegetarian } from './eat.js';
import { enlightenment_lines, record_achievement } from './insight.js';
import { ACH_BELL, ACH_CNDL, ACH_BOOK, ACH_AMUL, ACH_MINE_PRIZE, ACH_SOKO_PRIZE } from './const.js';
import { FREE_ACTION as FREE_ACTION_PROP } from './const.js';
import { MELT_ICE_AWAY } from './const.js';
import { spot_time_left } from './timeout.js';
import { waterbody_name as waterbody_name_for_ice } from './cmd.js';
import { BRK_FROM_INV } from './const.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
import { base_armcat } from './objarmor_data.js';
import { find_ac } from './u_init.js';
import { moveloop_turn, moveloop_input_redraw, youHaveFast, youHaveVeryFast } from './allmain.js';
import { acurr_eff, acurr_str_encoded, exercise, set_moreluck } from './attrib.js';
import { onbill, shk_scan, add_to_billobjs, shopper_financial_report, money_cnt_invent, hidden_gold,
         costly_spot, addtobill } from './shk.js';
import { shop_keeper } from './shkroom.js';
import { hitval, dbon, weapon_type, weapon_descr } from './weapon.js';
import { W_ART as W_ART_PROP, W_WEP as W_WEP_PROP,
         HAND, STOMACH, ONAME_VIA_NAMING, ONAME_KNOW_ARTI, HMON_APPLIED,
         ALL_FINISHED } from './const.js';
import {
    UNENCUMBERED, OVERLOADED,
    SLT_ENCUMBER, MOD_ENCUMBER, HVY_ENCUMBER, EXT_ENCUMBER,
    WT_WEIGHTCAP_STRCON, WT_WEIGHTCAP_SPARE, WT_WOUNDEDLEG_REDUCT, MAX_CARR_CAP,
    WT_SPLASH_THRESHOLD, FIRE_RES,
    A_CON, A_STR, A_INT, A_WIS, A_CHA, A_DEX, A_MAX, LEFT_SIDE, RIGHT_SIDE,
    P_DAGGER, P_KNIFE, P_SHORT_SWORD, P_SABER, P_SPEAR, P_BOW, P_SLING,
    P_CROSSBOW, P_DART, P_SHURIKEN,
    P_SKILLED, P_EXPERT,
    CQ_CANNED, CQ_REPEAT, CMDQ_KEY, CMDQ_INT,
    IS_FOUNTAIN, IS_THRONE, IS_SINK, IS_GRAVE, IS_ALTAR,
    TT_BEARTRAP, TT_INFLOOR, is_pit,
    AM_SHRINE, AM_SANCTUM, Amask2align, A_LAWFUL, A_NEUTRAL, A_CHAOTIC, A_NONE,
    TREE, IRONBARS, DRAWBRIDGE_DOWN, DBWALL, LAVAPOOL, LAVAWALL, ICE, WEB,
    POOL, MOAT, WATER,
    IS_DOOR, IS_FURNITURE, STONE, STAIRS, D_NODOOR, D_ISOPEN, D_BROKEN,
    Is_airlevel, Is_waterlevel,
    PLNMSG_MON_TAKES_OFF_ITEM, PLNMSG_BACK_ON_GROUND, PLNMSG_ONE_ITEM_HERE,
    MENU_TRADITIONAL, MENU_COMBINATION, MENU_FULL, MENU_PARTIAL,
    TIMEOUT, isok, STRAT_WAITMASK, SELL_NORMAL, SELL_DELIBERATE,
    // prop.h property indices, for the setworn()/setnotworn() extrinsic
    // bookkeeping below.  W_AMUL/W_TOOL are imported under CW_ names because
    // this file's own W_AMUL/W_TOOL constants are REMAPPED bits (see the
    // worn-mask block at line 240) and the extrinsic word must speak prop.h.
    INVIS, CLAIRVOYANT, BLINDED, LEVITATION,
    W_AMUL as CW_AMUL, W_TOOL as CW_TOOL, OBJ_FREE, OBJ_FLOOR, OBJ_CONTAINED, OBJ_INVENT, OBJ_MINVENT, OBJ_BURIED } from './const.js';
import { engr_at, wipe_engr_at, read_engr_at, u_wipe_engr } from './engrave.js';
import { shkname } from './shkroom.js';
// C ref: objnam.c doname_base():1648 — the shop-price suffix is formatted in
// objnam.c, on top of shk.c's get_cost_of_shop_item()/unpaid_cost().
import { price_suffix, add_erosion_words, cxname,
         obj_is_pname, type_is_pname, the_unique_pm } from './objnam.js';
import { makeplural, vtense } from './plural.js';
import { shk_owns, next_shkp } from './shk.js';
import { xname as on_xname, cxname_singular as on_cxname_singular, doname_base as on_doname_base,
         corpse_xname as on_corpse_xname, simpleonames as on_simpleonames,
         ansimpleoname as on_ansimpleoname, minimal_xname as on_minimal_xname,
         distantname_adjust, distantname_active, The as on_The, the as on_the,
         killer_xname, an, not_fully_identified } from './objnam.js';
import { y_monnam } from './do_name.js';
// role.js imports only gstate/rng/const, so this is cycle-safe.
import { roles, align_gname } from './role.js';
// pickup.c lives in js/pickup.js.  The cycle back to this file is fine: both
// sides only touch each other's hoisted function declarations from inside
// function bodies, never at module-evaluation time.
import { pickup, pickup_prinv_prefix, allow_category, add_valid_menu_class,
         menu_class_present, collect_obj_classes, container_gone, loot_mon,
         u_safe_from_fatal_corpse, st_all, reset_justpicked,
         menu_style, count_categories, allow_all, count_justpicked,
         find_justpicked, PICK_NONE, PICK_ONE, PICK_ANY,
         BY_NEXTHERE, AUTOSELECT_SINGLE, USE_INVLET, INVORDER_SORT,
         SIGNAL_NOMENU, SIGNAL_ESCAPE,
         INCLUDE_VENOM, ALL_TYPES, ALL_TYPES_SELECTED, UNPAID_TYPES,
         WORN_TYPES, BILLED_TYPES, CHOOSE_ALL, BUC_BLESSED_F, BUC_CURSED_F,
         BUC_UNCURSED_F, BUC_UNKNOWN_F, JUSTPICKED,
         safe_qbuf, yn_pending_more,
         def_char_to_objclass as pickup_def_char_to_objclass } from './pickup.js';
// C ref: src/do_wear.c — the per-slot on/off side effects, wearability checks
// and *_simple_name() family now live in their own module.
import {
    canwearobj, canwearobj_quiet, inaccessible_equipment,
    better_not_take_that_off, Boots_on, Boots_off, Cloak_on, Cloak_off,
    Helmet_on, Helmet_off, Gloves_on, Gloves_off, Shield_on, Shield_off,
    Shirt_on, Shirt_off, Armor_on, Armor_off, Armor_gone, dragon_armor_handling,
    will_weld as will_weld_dw, is_gloves, is_boots, is_helmet, hard_helmet,
    fingers_or_gloves, gloves_simple_name, cloak_simple_name, suit_simple_name,
    helm_simple_name, armor_simple_name, reset_remarm, cancel_don, donning, takeoff_ctx,
    glibr, stuck_ring, unchanger, count_worn_armor, any_worn_armor_ok, set_wear,
    wielding_corpse, adj_abon, toggle_stealth, toggle_displacement, armcat_of,
} from './do_wear.js';
// dothrow.js holds the rest of dothrow.c (break trio, throw_gold, gem_accept,
// autoquiver, ok_to_throw, endmultishot) plus apply.c's use_whip, which is
// reached only from dofire() below.  The cycle is fine: neither side touches
// the other at module-evaluation time.
// polyself.js owns mbodypart()/body_part(); the cycle back to this file is
// fine (both sides only call each other's hoisted declarations at run time).
import { body_part as poly_body_part } from './polyself.js';
import { twoweapon_action_ok } from './wield.js';
import * as DT from './dothrow.js';
// monattk_data.js is a pure data/predicate leaf (no top-level side effects), so
// this edge cannot reorder anything observable.
import { attacktype_fordmg, AT_ENGL, AD_DGST } from './monattk_data.js';

const LEASH = 236;
const CANDELABRUM_OF_INVOCATION = 262;
const SPE_BOOK_OF_THE_DEAD = 409;

// Armor / eyewear otyps used by the wear ('W') and take-off ('T') commands.
// C ref: include/onames.h (mirrors u_init.js).
const FEDORA = 92, HELMET = 97, SPLINT_MAIL = 124, RING_MAIL = 132,
    LEATHER_ARMOR = 134, LEATHER_JACKET = 135, HAWAIIAN_SHIRT = 136,
    ROBE = 143, CLOAK_OF_MAGIC_RESISTANCE = 148, CLOAK_OF_DISPLACEMENT = 149,
    SMALL_SHIELD = 150, LEATHER_GLOVES = 159,
    LENSES = 232, BLINDFOLD = 233, TOWEL = 234;
// Boots otyps (C ref: include/onames.h).  Every BOOTS() in objects.h has
// oc_delay 2, so donning/doffing any boots is a 2-turn dressing maneuver.
// SPEED_BOOTS additionally confer oc_oprop FAST (extrinsic), making the hero
// Very_fast while worn — see Boots_on() below and allmain.js u_calc_moveamt().
const LOW_BOOTS = 163, IRON_SHOES = 164, HIGH_BOOTS = 165, SPEED_BOOTS = 166,
    WATER_WALKING_BOOTS = 167, JUMPING_BOOTS = 168, ELVEN_BOOTS = 169,
    KICKING_BOOTS = 170, FUMBLE_BOOTS = 171, LEVITATION_BOOTS = 172;
// Ring otyps consulted by the accessory wear/remove path (C ref: onames.h).
// Only the attrib/AC-affecting rings need special handling; all other rings
// (regeneration, teleportation, ...) just confer their extrinsic via setworn().
const RIN_ADORNMENT = 173, RIN_GAIN_STRENGTH = 174, RIN_GAIN_CONSTITUTION = 175,
    RIN_INCREASE_ACCURACY = 176, RIN_INCREASE_DAMAGE = 177, RIN_PROTECTION = 178;
// The rings whose on/off effect is a message or a display refresh rather than a
// pure extrinsic (C ref: do_wear.c Ring_on()/Ring_off_or_gone()).
const RIN_STEALTH = 181, RIN_LEVITATION = 183, RIN_WARNING = 187,
    RIN_INVISIBILITY = 198, RIN_SEE_INVISIBLE = 199,
    RIN_PROTECTION_FROM_SHAPE_CHAN = 200;

export const NOINVSYM = '#';
export const CONTAINED_SYM = '>';
export const HANDS_SYM = '-';
export const GOLD_SYM = '$';
export const invlet_basic = 52;

// C ref: invent.c `struct obj hands_obj` — the sentinel getobj() returns when
// the player chooses '-' (hands/self) and the caller allows it.  Identity
// comparison (=== hands_obj) distinguishes it from a real inventory object.
export const hands_obj = { otyp: 0, oclass: 0, _hands: true };

export const SORTLOOT_INVLET = 0x01;
export const SORTLOOT_LOOT = 0x02;
export const SORTLOOT_PACK = 0x04;
export const SORTLOOT_INUSE = 0x08;
export const SORTLOOT_PETRIFY = 0x10;

export const GETOBJ_EXCLUDE = -3;
export const GETOBJ_EXCLUDE_NONINVENT = -2;
export const GETOBJ_EXCLUDE_INACCESS = -1;
export const GETOBJ_EXCLUDE_SELECTABLE = 0;
export const GETOBJ_DOWNPLAY = 1;
export const GETOBJ_SUGGEST = 2;

export const BUC_BLESSED = 1;
export const BUC_UNCURSED = 2;
export const BUC_CURSED = 3;
export const BUC_UNKNOWN = 4;

export const ECMD_OK = 0;
export const ECMD_CANCEL = 1;
export const ECMD_FAIL = 2;
export const ECMD_TIME = 3;
// Not a NetHack ECMD value: a JS-only sentinel meaning "this command handler
// declined; treat the key as unhandled" so the dispatcher prints the same
// "Unknown command '<k>'." it would have without the handler.  Used to keep the
// 'P' put-on handler scoped (see doputon()).
export const ECMD_NOTHANDLED = -99;

const TRUE = true;
const FALSE = false;
const WIN_ERR = -1;
// C ref: prop.h W_WEP/W_QUIVER/W_SWAPWEP owornmask bits (setworn_slot's values).
const QW_WEP = 0x100, QW_QUIVER = 0x200, QW_SWAPWEP = 0x400,
      QW_ARMOR_ALL = 0x7f;

// C ref: prop.h:101-113.  These four used to be 0x01/0x02/0x04/0x08, which is
// NOT what the runtime stamps into owornmask: setworn_slot() writes QW_WEP
// 0x100 / QW_QUIVER 0x200 / QW_SWAPWEP 0x400 and armor_slot_mask() writes the
// WA_ARMOR_ALL 0x7f bits (both blocks below hold prop.h's real values).  So
// is_worn() answered FALSE for every wielded weapon and TRUE for body armor
// only by accident (W_ARM 0x01 == the old W_WEP), and W_ARMOR 0x08 was really
// the shield slot.  Unlike the accessory bits, these can hold their true
// values without colliding with anything else in this file's remapped block.
const W_WEP = 0x00000100;
const W_QUIVER = 0x00000200;
const W_SWAPWEP = 0x00000400;
const W_ARMOR = 0x0000007f;  /* W_ARM|W_ARMC|W_ARMH|W_ARMS|W_ARMG|W_ARMF|W_ARMU */
// C ref: prop.h — accessory worn-mask bits.  These MUST NOT collide with the
// WA_ARMOR_ALL (0x7f) armor-slot bits used by armor_slot_mask()/worn_slot_get();
// the original low-bit values (0x10/0x20/0x40/0x100) overlapped WA_ARMS/G/F and
// WORN_SHIRT, which was harmless only while no accessory was ever worn.  Now
// that 'P'/'R' can wear rings/amulets/eyewear, use distinct high bits.
export const W_RINGL = 0x00020000;
export const W_RINGR = 0x00040000;
export const W_AMUL = 0x00080000;
const W_TOOL = 0x00100000;
// W_BLINDF was 0x00200000 == prop.h:126 W_BALL, harmless until doname() needed
// to distinguish a worn blindfold from a chained iron ball. Moved to a free
// high bit; W_BALL/W_CHAIN keep prop.h's real values since read.js stamps them
// via const.js. 0x00080000 already holds W_AMUL above — reusing it made an
// amulet answer the blindfold test (-7 on seed5006).
const W_BLINDF = 0x00800000;
const W_BALL = 0x00200000;   // C ref: prop.h:126 — punishment ball
const BALL_CLASS_INV = 15;   // C ref: objclass.h BALL_CLASS
const W_CHAIN = 0x00400000;  // C ref: prop.h:127 — punishment chain
const W_ACCESSORY = W_RINGL | W_RINGR | W_AMUL | W_BLINDF;
const W_WEAPONS = W_WEP | W_SWAPWEP | W_QUIVER;
// C ref: prop.h:152-160 — the per-slot armor bits, which must be the same ones
// armor_slot_mask() stamps (WA_ARM..WA_ARMU below), not a parallel high-bit set:
// inuse_classify() tests these against a live owornmask.
const WORN_ARMOR = 0x00000001;  /* W_ARM  */
const WORN_CLOAK = 0x00000002;  /* W_ARMC */
const WORN_HELMET = 0x00000004; /* W_ARMH */
const WORN_SHIELD = 0x00000008; /* W_ARMS */
const WORN_GLOVES = 0x00000010; /* W_ARMG */
const WORN_BOOTS = 0x00000020;  /* W_ARMF */
const WORN_SHIRT = 0x00000040;  /* W_ARMU */
const WORN_AMUL = W_AMUL;
const WORN_BLINDF = W_BLINDF;
const W_SADDLE = 0x00008000;
const W_ART = 0x00010000;

// C ref: obj.h:481-486 — LOST_NONE 0, LOST_THROWN 1, LOST_DROPPED 2,
// LOST_STOLEN 3, LOST_EXPLODING 4.  LOST_EXPLODING was 2 (i.e. LOST_DROPPED),
// so every dropped object read as "exploding" to the merge/addinv guards below,
// and LOST_DROPPED was 3 (LOST_STOLEN), which js/steal.js already checks for as
// 2 — the two files disagreed about what a dropped object looks like.
const LOST_NONE = 0;
const LOST_THROWN = 1;
const LOST_EXPLODING = 4;

const inuse_headers = [
    '', 'Miscellaneous', 'Worn Armor',
    'Wielded/Readied Weapons', 'Accessories',
];

const venom_inv = [VENOM_CLASS, 0];
let perminv_flags = 0;
let in_perm_invent_toggled = false;
let wri_info = {};
let safeq_xprn_ctx = { let: '\0', dot: false };

// TODO(invent-port): replace these local shims as their owning C files land.
function impossible(...args) { if (game.debugImpossible) console.warn('impossible:', ...args); }
function panic(msg) { throw new Error(msg); }
function nhUse(_x) {}
function program_state() { game.program_state = game.program_state || {}; return game.program_state; }
function flags() { game.flags = game.flags || {}; return game.flags; }
function iflags() { game.iflags = game.iflags || {}; return game.iflags; }
function ustate() { game.u = game.u || {}; return game.u; }
function giState() { game.gi = game.gi || {}; return game.gi; }
function glState() { game.gl = game.gl || {}; return game.gl; }
// C ref: hack.h carried(obj) — obj->where == OBJ_INVENT.  Exported: js/dothrow.js
// hurtle()'s Punished-ball check (`import * as I from './invent.js'; I.carried(...)`)
// called this as I.carried() while it was a local, unexported binding, which
// threw "I.carried is not a function" the first time hurtle() actually ran
// with a punished hero (previously unreachable — see js/region.js's
// in_out_region() fix, which is what let any hurtle() finish at all).
export function carried(obj) { return !!obj && (obj.where === OBJ_INVENT || inventoryArray().includes(obj)); }
function mcarried(obj) { return !!obj && obj.where === OBJ_MINVENT; }
function has_oname(obj) { return !!obj?.oname; }
function ONAME(obj) { return obj?.oname || ''; }
function setONAME(obj, name) { if (obj) obj.oname = name || ''; }
function safe_oname(obj) { return obj?.oname || ''; }
function has_omonst(obj) { return !!(obj?.oextra && obj.oextra.omonst); }
function has_omid(obj) { return !!(obj?.oextra && obj.oextra.omid); }
function has_omailcmd(_obj) { return false; }
function OMAILCMD(obj) { return obj?.omailcmd || ''; }
// C ref: o_init.c observe_object — set dknown and mark the TYPE encountered
// (the latter feeds the '\' discoveries list); o_init.js owns both, including
// the Hallucination guard.
function observe_object(obj) { if (obj) disco_observe_object(obj); }
// C ref: objnam.c xname_flags():627 `if (!Blind && !gd.distantname)
// observe_object(obj)` — every name built through xname()/doname() observes
// the object, but ONLY when the hero can see; naming one while blind must not
// teach its appearance ("o - a potion.", not "a brilliant blue potion.").
function observe_object_named(obj) {
    if (!Blind_for_wear() && !distantname_active()) observe_object(obj);
}
/* objnam.c gd.distantname — set while distant_name() formats a far object. */
let gd_distantname = 0;
// C ref: hack.h makeknown(x) == discover_object(x, TRUE, TRUE, TRUE).
export function makeknown(otyp) {
    discover_object(otyp, true, true, true);
}
export function makeknown_credit(otyp) { makeknown(otyp); }
function discover_artifact(_id) {}
function learn_egg_type(_mnum) {}
// C ref: include/you.h Role_if(pm) — TRUE when the hero's role matches the
// given PM_ index.  The role is carried in urole.mnum (or u.umonnum).  Used by
// the doname BUC-word "uncursed" suppression for a Priest (Cleric), who senses
// BUC so the word is implicit (objnam.c doname_base, the !Role_if(PM_CLERIC)
// disjunct).
function Role_if(pm) {
    const m = game.urole?.mnum ?? game.u?.umonnum;
    return m === pm;
}
const PM_ARCHEOLOGIST = 0;
const PM_HEALER = 3;
const PM_CLERIC = 6;
const PM_MONK = 5;
const PM_TOURIST = 10;
const PM_WIZARD = 12;
const FAKE_AMULET_OF_YENDOR_OTYP = 212; // objects.h FAKE_AMULET_OF_YENDOR
// C ref: obj.h is_mines_prize(o) / is_soko_prize(o) — the o_id sp_lev.c recorded
// in svc.context.achieveo for the Mines' End luckstone / Sokoban prize.
function is_mines_prize(obj) {
    return obj.o_id != null && obj.o_id === game.context?.achieveo?.mines_prize_oid;
}
function is_soko_prize(obj) {
    return obj.o_id != null && obj.o_id === game.context?.achieveo?.soko_prize_oid;
}
function Has_contents(obj) { return !!(obj?.cobj && obj.cobj.length); }
// C ref: obj.h:337 `Is_container(o) ((o)->otyp >= LARGE_BOX
// && (o)->otyp <= BAG_OF_TRICKS)` — the enumerated list stopped at
// BAG_OF_HOLDING, so a bag of tricks was never a container (and the `cobj`
// disjunct made every object with contents one, which C does not).
const LARGE_BOX_OTYP = 214, BAG_OF_TRICKS_OTYP = 220;
function Is_container(obj) {
    const t = obj?.otyp;
    return t >= LARGE_BOX_OTYP && t <= BAG_OF_TRICKS_OTYP;
}
function Is_pudding(obj) { return !!obj?.globby; }
function Is_candle(obj) { return obj?.otyp === 224 || obj?.otyp === 225; }
// C ref: obj.h is_pole() — polearms, lances, and Snickersnee ("not a polearm,
// but can hit from distance"), which makes it show in apply's prompt.
const ART_SNICKERSNEE = 19; /* artifact.js artilist index */
const P_POLEARMS = 16, P_LANCE = 19, P_AXE = 3, P_PICK_AXE = 4;
export function is_pole(obj) {
    if (!obj || (obj.oclass !== WEAPON_CLASS && obj.oclass !== TOOL_CLASS)) return false;
    const sk = objects[obj.otyp]?.oc_skill ?? 0;
    return sk === P_POLEARMS || sk === P_LANCE || obj.oartifact === ART_SNICKERSNEE;
}
// C ref: obj.h is_pick/is_axe — same class test, the digging/chopping skills.
export function is_pick(obj) {
    if (!obj || (obj.oclass !== WEAPON_CLASS && obj.oclass !== TOOL_CLASS)) return false;
    return (objects[obj.otyp]?.oc_skill ?? 0) === P_PICK_AXE;
}
export function is_axe(obj) {
    if (!obj || (obj.oclass !== WEAPON_CLASS && obj.oclass !== TOOL_CLASS)) return false;
    return (objects[obj.otyp]?.oc_skill ?? 0) === P_AXE;
}
// C ref: mondata.h touch_petrifies(ptr) — cockatrice / chickatrice only
// (Medusa is flesh_petrifies, not this).  Was hardcoded FALSE, which made
// will_feel_cockatrice() answer FALSE for every corpse.  Matched against the
// generated mons[] table, as in js/mon.js and js/dogmove.js.
export function touch_petrifies(corpsenm) {
    const nm = monster_by_pmidx(corpsenm)?.name;
    return nm === 'cockatrice' || nm === 'chickatrice';
}
function dead_species(_mnum, _force) { return false; }
function picked_container(_obj) {}
// C ref: worn.c setworn() for the W_WEP/W_QUIVER/W_SWAPWEP slots — clear the old
// occupant's worn bit, install the new object, and keep the matching u-pointer
// in sync.  Uses the prop.h mask bits (W_WEP 0x100, W_QUIVER 0x200, W_SWAPWEP
// 0x400) the inventory display and u_init rely on.  The property bookkeeping is
// now done too: worn.c's `wp->w_mask & ~(W_SWAPWEP | W_QUIVER)` guard means the
// quiver and alternate-weapon slots really do confer nothing, but a WIELDED
// weapon or weapon-tool does (that is how Magicbane's and the elven weapons'
// extrinsics reach the hero), so W_WEP must not be skipped.
function setworn_slot(obj, mask, getCur, setCur) {
    const old = getCur();
    // C ref: worn.c:90 setworn() — displacing the occupant of the primary or
    // secondary weapon slot SILENTLY ends two-weapon combat, before
    // doswapweapon()'s prinv() lines are built.  (QW_WEP/QW_SWAPWEP are this
    // file's remapped bits; do not substitute the prop.h values.)
    if (old && game.u?.twoweap && ((old.owornmask || 0) & (QW_WEP | QW_SWAPWEP)))
        game.u.twoweap = false;
    if (old) {
        worn_extrinsics_off(old, mask);
        old.owornmask = (old.owornmask || 0) & ~mask;
    }
    setCur(obj);
    if (obj) {
        obj.owornmask = (obj.owornmask || 0) | mask;
        worn_extrinsics_on(obj, mask);
    }
}
export function setuqwep(obj) { setworn_slot(obj, QW_QUIVER, () => game.uquiver, (o) => { game.uquiver = o; }); }
export function setuswapwep(obj) { setworn_slot(obj, QW_SWAPWEP, () => game.uswapwep, (o) => { game.uswapwep = o; }); }
// C ref: wield.c setuwep() — besides moving the slot, C recomputes gu.unweapon,
// which drives uhitm.c's one-shot "You begin bashing monsters with ..." line.
// Without it, unwielding (drop / w-) never re-armed the message.
export function setuwep_slot(obj) {
    if (obj === game.uwep) return; /* C: "necessary to not set gu.unweapon" */
    setworn_slot(obj, QW_WEP, () => game.uwep, (o) => { game.uwep = o; });
    game.unweapon = uwep_unweapon(obj);
}
// C ref: wield.c setuwep() tail — the gu.unweapon value for a newly wielded
// `obj` (null = bare hands).  Also used by restore.c dorecover(), which re-runs
// setuwep() on the restored weapon to re-arm the "bashing" reminder.
export function uwep_unweapon(obj) {
    if (!obj) return true; /* for "bare hands" message */
    return (obj.oclass === WEAPON_CLASS)
        ? (is_launcher(obj) || is_ammo(obj) || is_missile(obj)
           || (is_pole(obj) && !game.u?.usteed && obj.oartifact !== ART_SNICKERSNEE))
        : !(is_weptool(obj) || is_wet_towel(obj));
}
// C ref: include/obj.h is_ammo/is_launcher/matching_launcher/ammo_and_launcher.
// Ammunition's oc_skill is the negative of its launcher's (arrow == -P_BOW), so
// is_ammo tests the [-P_CROSSBOW, -P_BOW] range and a launcher tests [P_BOW,
// P_CROSSBOW].  matching_launcher pairs them by skill == -skill.
function is_ammo(obj) {
    if (!obj) return false;
    const sk = objects[obj.otyp]?.oc_skill ?? 0;
    return (obj.oclass === WEAPON_CLASS || obj.oclass === GEM_CLASS)
        && sk >= -22 && sk <= -20; // -P_CROSSBOW .. -P_BOW
}
// C ref: is_missile — boomerang..dart family (weapon or tool, [-P_BOOMERANG,
// -P_DART]).
function is_missile(obj) {
    if (!obj) return false;
    const sk = objects[obj.otyp]?.oc_skill ?? 0;
    return (obj.oclass === WEAPON_CLASS || obj.oclass === TOOL_CLASS)
        && sk >= -25 && sk <= -23; // -P_BOOMERANG .. -P_DART
}
function is_launcher(obj) {
    if (!obj || obj.oclass !== WEAPON_CLASS) return false;
    const sk = objects[obj.otyp]?.oc_skill ?? 0;
    return sk >= 20 && sk <= 22; // P_BOW .. P_CROSSBOW
}
function matching_launcher(a, l) {
    if (!l) return false;
    return (objects[a.otyp]?.oc_skill ?? 0) === -(objects[l.otyp]?.oc_skill ?? 0);
}
function ammo_and_launcher(ammo, launcher) {
    return is_ammo(ammo) && matching_launcher(ammo, launcher);
}
function carry_obj_effects_message(_obj) {}
function obj_merge_light_sources(_from, _to) {}
function obj_absorb(potmp, pobj) { if (pobj) pobj.obj = null; return potmp?.obj || null; }
function maybereleaseobuf(_str) {}
function dupstr(s) { return String(s ?? ''); }
// C ref: objnam.c cxname_singular() == xname_flags(obj, CXN_SINGULAR). xname
// never prepends the BUC word ("blessed"/"uncursed"/"cursed") — that belongs
// to doname() alone — so a BUC-known object still reads e.g. "ring of see
// invisible" here (used by loot_xname, the itemactions title/label, and
// data.base lookups). It DOES observe the object like xname() does — that's
// what makes a visible monster's weapon read "orcish dagger" rather than
// "crude dagger".
export function cxname_singular(obj) { return on_cxname_singular(obj); }
// C ref: objnam.c xname() — the bare object name: no "a"/"an" article and no
// BUC word (unlike doname()), but still quantity-aware for stackable types.
export function xname(obj) { return on_xname(obj); }
// C ref: shk.c shk_your(buf, obj) — the ownership prefix yname()/ysimple_name()
// put in front of an object's name: a shopkeeper's name for unpaid shop goods,
// a monster's for carried-by-monster, else "your"/"the".  Returns the prefix
// without its trailing space, or '' when the name supplies its own (a corpse
// of a pname species: "Medusa's corpse").
function shk_your(obj) {
    const chk_pm = obj?.otyp === CORPSE && (obj.corpsenm ?? -1) >= 0;
    if (chk_pm) {
        const species = monster_by_pmidx(obj.corpsenm);
        if (type_is_pname(species)) return '';
        if (the_unique_pm(species)) return 'the';
    }
    return shk_owns(obj)
        || (mcarried(obj) ? s_suffix(y_monnam(obj.ocarry)) : null)
        || (carried(obj) ? 'your' : 'the');
}
// C ref: objnam.c yname() and shk.c shk_your().
export function yname(obj) {
    const name = cxname(obj);
    // "your" is left off most of your artifacts, but kept for unique objects
    // and "foo of bar" quest artifacts.
    if (carried(obj) && obj_is_pname(obj) && obj.oartifact < 21 /* ART_ORB_OF_DETECTION */)
        return name;
    const owner = shk_your(obj);
    return owner ? `${owner} ${name}` : name;
}
// C ref: objnam.c Yname2(obj) — yname() with the first letter capitalized.
export function Yname2(obj) {
    const s = yname(obj);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
// C ref: objnam.c Tobjnam(obj, verb) — "The <xname> <verb>s": The() of xname()
// (so an artifact keeps its bare name) followed by otense().
export function Tobjnam(obj, verb) {
    const bp = on_The(xname(obj));
    return verb ? `${bp} ${otense(obj, verb)}` : bp;
}
// C ref: objnam.c minimal_xname() — xname() of a BARE copy (cg.zeroobj with
// only otyp/oclass/quan/dknown/known copied), so weight-derived prefixes such
// as HEAVY_IRON_BALL's "very " (objnam.c:829 reads obj->owt) cannot leak in.
function minimal_obj(obj) {
    if (!obj) return obj;
    return { ...obj, owt: 0, oeroded: 0, oeroded2: 0, greased: 0, bknown: 0, rknown: 0, quan: 1 };
}
export function ansimpleoname(obj) { return on_ansimpleoname(obj); }
// C ref: objnam.c ysimple_name() — shk_your() + minimal_xname(), so a shop's
// unpaid goods read "Eed-morra's sack" and an object on the floor "the sack",
// not "your sack".
export function ysimple_name(obj) {
    const owner = shk_your(obj);
    const nm = on_minimal_xname(obj);
    return owner ? `${owner} ${nm}` : nm;
}
// C ref: objnam.c simpleonames() — minimal_xname(), then makeplural() whenever
// quan != 1.  Without the pluralisation a readied stack read "36 dart".
function simpleonames(obj) { return on_simpleonames(obj); }
// C ref: objnam.c distant_name(obj, func):370 — a VISIBLE object within
// neardist is named with the usual side effects (xname_flags() observes it, so
// its appearance and stack size become known); anything further away bumps
// gd.distantname so that observation is skipped.
function distant_name(obj, fn = doname, ox = obj?.ox, oy = obj?.oy) {
    if (!distant_far(obj, ox, oy) && cansee(ox, oy)) return fn(obj);
    distantname_adjust(1);
    try { return fn(obj); } finally { distantname_adjust(-1); }
}
export function distant_name_pub(obj, fn, ox, oy) { return distant_name(obj, fn, ox, oy); }
// C ref: objnam.c doname() appends the worn-status suffix ("(being worn)",
// "(wielded)", "(on right hand)", ...) unconditionally — it is not limited to
// the inventory window, so every doname()/obj_doname() caller (dip/wield/drop
// prompts included) must see it too.
function doname(obj) { return on_doname_base(obj, 0); }
// C ref: objnam.c doname_with_price() -> doname_base(obj, DONAME_WITH_PRICE) —
// an object seen on shop floor reads " (for sale, <N> <currency>)", or
// " (no charge)" for the shk's own free spot / a no_charge item.  Without this
// every "You see here ..." line inside a shop dropped the price.
function doname_with_price(obj) { return on_doname_base(obj, 1 /*DONAME_WITH_PRICE*/); }
// C ref: invent.c look_here():4282 `You("%s here %s.", verb,
// doname_with_price(otmp))` — the "You see here ..." announcement quotes the
// shop price, so this is doname_with_price, not bare doname.
export function floor_object_name(obj) { return doname_with_price(obj); }

// C ref: invent.c doname()/wield.c wield_tool() — exposed for apply.js #rub.
export function obj_doname(obj) { return doname(obj); }

// C ref: objnam.c doname_vague_quan():1768 -> doname_base(DONAME_VAGUE_QUAN).
// Farlook's namer: a stack that has not been seen up close (!dknown) reports
// "some gold pieces" rather than the exact count it has no way to know.
export function doname_vague_quan(obj) { return on_doname_base(obj, 2 /*DONAME_VAGUE_QUAN*/); }

// C ref: objnam.c short_oname(obj, func, altfunc, lenlimit) — used to build a
// getobj/y_n prompt's object phrase within a fixed buffer budget.  When the
// full doname() is too long, C first shortens an individually-named object's
// custom name/call-name (oc_uname/ONAME) — not modeled here, as no covered
// session dips a custom-named object — then, still too long, temporarily
// hides the BUC/erosion words (bknown/rknown/greased/oeroded/oeroded2, the
// exact attribute list C zeroes) and retries before falling back to a bare
// definite-article name.  The temporary field clears are always restored.
export function short_oname(obj, lenlimit) {
    if (!obj) return 'nothing';
    let outbuf = doname(obj);
    if (outbuf.length <= lenlimit) return outbuf;
    const saved = {
        bknown: obj.bknown, rknown: obj.rknown, greased: obj.greased,
        oeroded: obj.oeroded, oeroded2: obj.oeroded2,
    };
    obj.bknown = obj.rknown = obj.greased = 0;
    obj.oeroded = obj.oeroded2 = 0;
    outbuf = doname(obj);
    Object.assign(obj, saved);
    if (outbuf.length <= lenlimit) return outbuf;
    return `the ${simpleonames(obj)}`;
}

export { simple_typename } from './objnam.js';

// C ref: wield.c wield_tool(obj, verb) — wield a tool for #rub/#force/&c.
// Returns TRUE when the tool got wielded.  All four refusals (worn item, welded
// weapon, shield vs bimanual, failed swap) are ported; only cantwield() (a
// handless polyform) is left out, since no polyform reaches this port.
export async function wield_tool(obj, verb) {
    if (game.uwep && obj === game.uwep) return true; // already wielding it
    if (!verb) verb = 'wield';
    const what = xname(obj);
    let more_than_1 = ((obj.quan || 1) > 1 || what.includes('pair of ')
                       || what.includes('s of '));

    // C ref: wield.c wield_tool() — each refusal prints and returns FALSE, so
    // an unported one silently wielded something C would not have.
    if ((obj.owornmask || 0) & (WA_ARMOR_ALL | W_ACCESSORY)) {
        await pline(`You can't ${verb} ${yname(obj)} while wearing ${more_than_1 ? 'them' : 'it'}.`);
        return false;
    }
    if (game.uwep && welded(game.uwep)) {
        if (game.flags?.verbose !== false) {
            let hand = body_part(6 /*HAND*/);
            if (bimanual(game.uwep)) hand = makeplural(hand);
            if (what.includes('pair of ')) more_than_1 = false;
            await pline(`Since your weapon is welded to your ${hand}, you cannot ${verb} ${more_than_1 ? 'those' : 'that'} ${what}.`);
        } else {
            await pline("You can't do that.");
        }
        return false;
    }
    // cantwield(): a handless/nolimbs polyform can't hold anything strongly
    // enough; not reachable for a humanoid hero, so no branch is emitted here.
    if (game.uarms && bimanual(obj)) {
        await pline(`You cannot ${verb} a two-handed ${obj.oclass === WEAPON_CLASS ? 'weapon' : 'tool'} while wearing a shield.`);
        return false;
    }

    if (game.uquiver === obj) setuqwep(null);
    if (game.uswapwep === obj) {
        await doswapweapon();
        if (game.uswapwep === obj) return false;   /* the swap failed */
    } else {
        const oldwep = game.uwep;
        if (will_weld(obj)) {
            await ready_weapon(obj);
        } else {
            await update_topl(`You now wield ${doname(obj)}.`);
            setuwep_slot(obj);
        }
        if (game.flags?.pushweapon && oldwep && game.uwep !== oldwep)
            setuswapwep(oldwep);
    }
    if (game.uwep && game.uwep !== obj) return false;
    if (game.u && game.u.twoweap) await untwoweapon();
    if (obj.oclass !== WEAPON_CLASS) game.unweapon = true;
    return true;
}
export function corpse_xname(obj, adj, flagsArg = 0) { return on_corpse_xname(obj, adj, flagsArg); }
export { killer_xname };

// C ref: do_name.c docall_xname(obj) — the bare "a/an <appearance>" name used
// in the "Call <x>:" prompt: a fresh copy with diluted/poison/BUC fixups so it
// reads as the plain unidentified type ("a ruby potion", not "a diluted ...").
function docall_xname(obj) {
    const otemp = { ...obj, oextra: null, oname: null, quan: 1, blessed: 0, cursed: 0 };
    /* in case water is already known, convert "[un]holy water" to "water" */
    if (otemp.oclass === WEAPON_CLASS) otemp.opoisoned = 0;
    else if (otemp.oclass === POTION_CLASS) otemp.odiluted = 0;
    else if (otemp.otyp === TOWEL || otemp.otyp === STATUE) otemp.spe = 0;
    else if (otemp.otyp === TIN) otemp.known = 0;
    else if (otemp.otyp === FIGURINE) otemp.corpsenm = -1;
    else if (otemp.otyp === 477 /*HEAVY_IRON_BALL*/) otemp.owt = base_oc_weight(otemp);
    else if (otemp.oclass === FOOD_CLASS && otemp.globby) otemp.owt = 120;
    return an(on_xname(otemp));
}

// C ref: do_name.c docall(obj) — prompt "Call <a appearance>:" and attach the
// typed call-name to the object TYPE (objects[].oc_uname), adding it to the
// discoveries list.  The unacknowledged taste message is paged with --More--
// (captured as its own frame) before getlin overwrites the top line.  Returns
// after recording (or clearing) the type's user-name.
export async function docall(obj) {
    if (!obj?.dknown) return;          // probably blind
    await flush_screen(1);
    // getlin is about to overwrite the top-line message, so page it first.
    // Some callers route their taste/feel message through a plain assignment
    // that (unlike real pline()) never sets toplin NEED_MORE, so check the
    // pending text itself rather than relying solely on hooked_tty_getlin's
    // own toplin check below — and clear both here so that check (C ref:
    // win/tty/getline.c hooked_tty_getlin():53-54) doesn't page a second time
    // for callers (e.g. read.js's update_topl-based messages) that already
    // left toplin NEED_MORE set.
    if (game._pending_message && !game._winStop /* getline.c:53 */) {
        await topl_more();
        game._pending_message = '';
        game._toplin = 0;
    }
    const qbuf = `Call ${docall_xname(obj)}:`;
    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    const raw = await hooked_tty_getlin(qbuf, null);
    // The taste message was acknowledged (--More--) and getlin overwrote the
    // top line; C leaves the message window empty afterward (TOPLINE_EMPTY).
    game._pending_message = '';
    if (!raw || raw === '\x1b') return;
    const buf = mungspaces(raw);
    const ocl = objects[obj.otyp];
    if (!buf) {
        if (ocl?.oc_uname) ocl.oc_uname = null;   // undiscover (clear call-name)
    } else {
        if (ocl) ocl.oc_uname = buf;
        discover_object(obj.otyp, false, true, true);
    }
    update_inventory();
}

// C ref: do_name.c objtyp_is_callable()/name_ok()/call_ok().
export function objtyp_is_callable(otyp) {
    const ocl = objects[otyp];
    if (!ocl) return false;
    if (ocl.oc_uname) return true;
    if (otyp === AMULET_OF_YENDOR || otyp === FAKE_AMULET_OF_YENDOR_OTYP)
        return false;
    return [AMULET_CLASS, SCROLL_CLASS, POTION_CLASS, WAND_CLASS, RING_CLASS,
        GEM_CLASS, SPBOOK_CLASS, ARMOR_CLASS, TOOL_CLASS, VENOM_CLASS]
        .includes(ocl.oclass) && DESCR_BY_OTYP[otyp] != null;
}

function name_ok(obj) {
    if (!obj || obj.oclass === COIN_CLASS) return GETOBJ_EXCLUDE;
    if (!obj.dknown || obj.oartifact || obj.otyp === SPE_NOVEL)
        return GETOBJ_DOWNPLAY;
    return GETOBJ_SUGGEST;
}

export function call_ok(obj) {
    if (!obj || !objtyp_is_callable(obj.otyp)) return GETOBJ_EXCLUDE;
    const ocl = objects[obj.otyp];
    if (!obj.dknown || (ocl.oc_name_known && !ocl.oc_uname))
        return GETOBJ_DOWNPLAY;
    return GETOBJ_SUGGEST;
}

// C ref: do_name.c do_oname(obj).
async function do_oname(obj) {
    /* Do this now because there's no point in even asking for a name */
    if (obj.otyp === SPE_NOVEL) {
        const nm = ysimple_name(obj);
        await pline(`${nm.charAt(0).toUpperCase()}${nm.slice(1)} already has a published name.`);
        return;
    }
    const which = (obj.quan || 1) > 1 ? 'these' : 'this';
    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    let buf = await hooked_tty_getlin(`What do you want to name ${which} ${xname(obj)}?`, null);
    game._pending_message = '';
    if (!buf || buf[0] === '\x1b') return;
    /* strip leading and trailing spaces, condense internal sequences */
    buf = mungspaces(buf).slice(0, 62 /* PL_PSIZ - 1 */);

    if (obj.oartifact) {
        await pline(`${ONAME(obj) || 'The artifact'} resists the attempt.`);
        return;
    }
    const A = await import('./artifact.js');
    /* relax restrictions over proper capitalization for artifacts */
    const a = A.artifact_name(buf, true);
    if (a && (A.restrict_name(obj, a.name) || A.exist_artifact(obj.otyp, a.name))) {
        /* substitute canonical spelling before slippage */
        const bufcpy = a.name;
        const { wipeout_text } = await import('./engrave.js');
        const { rnd_on_display_rng } = await import('./rnd.js');
        /* for "the Foo of Bar", only scuff "Foo of Bar" part */
        const pfx = /^the /i.test(bufcpy) ? bufcpy.slice(0, 4) : '';
        let tail = bufcpy.slice(pfx.length);
        do {
            tail = wipeout_text(tail, rnd_on_display_rng(2), 0);
        } while (pfx + tail === bufcpy);
        buf = pfx + tail;
        await pline(`While engraving, your ${body_part(HAND)} slips.`);
        /* C: display_nhwindow(WIN_MESSAGE, FALSE) -- page the pending line */
        if (!game._winStop && game._pending_message
            && (game._toplin === 1 || game._toplinSoft === game._pending_message)) {
            await topl_more();
            game._toplin = 0;
            game._toplinSoft = null;
            game._pending_message = '';
        }
        await pline(`You engrave: "${buf}".`);
        /* violate illiteracy conduct since hero attempted to write
           a valid artifact name */
        if (game.u) game.u.uconduct = { ...(game.u.uconduct || {}),
            literate: ((game.u.uconduct || {}).literate || 0) + 1 };
    } else if (a && obj.otyp === a.otyp) {
        /* naming will change it into an artifact: canonical capitalization */
        buf = a.name;
    }
    /* C ref: do_name.c oname(obj, buf, ONAME_VIA_NAMING | ONAME_KNOW_ARTI) */
    if (buf && A.exist_artifact(obj.otyp, buf)) return;
    oname(obj, buf);
    if (buf) A.artifact_exists(obj, buf, true, ONAME_VIA_NAMING | ONAME_KNOW_ARTI);
    if (obj.oartifact) {
        /* activate warning if you've just named your weapon "Sting" */
        if (obj === game.uwep) await A.set_artifact_intrinsic(obj, true, W_WEP_PROP);
        /* violate illiteracy conduct since successfully wrote arti-name */
        if (game.u) game.u.uconduct = { ...(game.u.uconduct || {}),
            literate: ((game.u.uconduct || {}).literate || 0) + 1 };
    }
    update_inventory();
}

export async function name_inventory_object() {
    const obj = await getobj('name', name_ok, GETOBJ_PROMPT);
    if (obj) await do_oname(obj);
}

export async function call_inventory_object() {
    const obj = await getobj('call', call_ok, GETOBJ_NOFLAGS);
    if (!obj) return;
    // C: getobj's prompt is a query, not a message needing --More--; the
    // "Call ...:" getlin simply replaces it on the top line.
    if (game._pending_message && game._pending_message.startsWith('What do you want to call?')) {
        game._pending_message = '';
        game._toplin = 0;
    }
    if (!(game.u?.blinded > 0) && !game.ublindf) observe_object(obj);
    if (!obj.dknown)
        await pline('You would never recognize another one.');
    else
        await docall(obj);
}

// C ref: do.c trycall(obj) — offer to name an unidentified object type after
// the hero gets non-identifying feedback (e.g. the taste of an unknown potion).
export async function trycall(obj) {
    const ocl = objects[obj.otyp];
    if (ocl && !ocl.oc_name_known && !ocl.oc_uname) await docall(obj);
}
function greatest_erosion(obj) { return Math.max(obj?.oeroded || 0, obj?.oeroded2 || 0); }
function erosion_matters(obj) { return obj?.oclass === WEAPON_CLASS || obj?.oclass === ARMOR_CLASS; }
// C ref: shk.c:955 same_price(obj1, obj2) — both objects on the same shk's bill
// at the same price (a surcharged item must not merge with a base-cost one).
function same_price(obj1, obj2) {
    let shkp1, shkp2, bp1 = null, bp2 = null;
    for (shkp1 = next_shkp(fmon_list()[0] ? fmon_list()[0] : null, true); shkp1;
         shkp1 = next_shkp(nmon_after(shkp1), true))
        if ((bp1 = onbill(obj1, shkp1)) != null) break;
    if (shkp1 && (bp2 = onbill(obj2, shkp1)) != null) {
        shkp2 = shkp1;
    } else {
        for (shkp2 = next_shkp(fmon_list()[0] ? fmon_list()[0] : null, true); shkp2;
             shkp2 = next_shkp(nmon_after(shkp2), true))
            if ((bp2 = onbill(obj2, shkp2)) != null) break;
    }
    if (!bp1 || !bp2) return false; /* C: impossible("same_price: object wasn't on any bill!") */
    return shkp1 === shkp2 && bp1.price === bp2.price;
}
function fmon_list() { return game.level?.monsters || game.fmon || []; }
function nmon_after(m) { const l = fmon_list(); const i = l.indexOf(m); return i >= 0 && i + 1 < l.length ? l[i + 1] : null; }
function check_unpaid(_obj) {}
function curse(obj) { if (obj) { obj.cursed = true; obj.blessed = false; } }
function stop_timer(_kind, _id) { return 0; }
function obj_to_any(obj) { return obj; }
function oname(obj, name) { setONAME(obj, name); return obj; }
export function obfree(obj, merge) {
    removeObjectFromAllInventories(obj);
    let shkp = null;
    if (obj.unpaid) {
        for (const mon of shk_scan(true)) {
            if (onbill(obj, mon)) {
                shkp = mon;
                break;
            }
        }
    }
    shkp ||= shop_keeper(game.u?.ushops?.[0]);
    const bp = onbill(obj, shkp);
    if (!bp) return;
    if (!merge) {
        bp.useup = true;
        obj.unpaid = 0;
        obj.where = OBJ_FREE;
        add_to_billobjs(obj);
        return;
    }
    const bpm = onbill(merge, shkp);
    if (!bpm) return;
    bpm.bquan += bp.bquan;
    const eshk = shkp.eshk;
    const index = eshk.bill.indexOf(bp);
    eshk.bill[index] = eshk.bill[--eshk.billct];
    eshk.bill.length = eshk.billct;
}
// C ref: mkobj.c splitobj():457 — the copy is NOT worn/timed/lit: `otmp->timed
// = 0; otmp->lamplit = 0; otmp->owornmask = 0L;`.  Carrying owornmask over made
// a single arrow split off the quiver keep "(in quiver)", so hitfloor() printed
// "A +2 elven arrow (in quiver) hits the floor."
export function splitobj(obj, cnt) {
    if (!obj || cnt <= 0 || cnt >= (obj.quan || 1)) return obj;
    const split = { ...obj, quan: cnt, owornmask: 0, pickup_prev: 0 };
    if (split.timed) split.timed = 0;
    if (split.lamplit) split.lamplit = 0;
    split.o_id = nextoid(obj, split);
    obj.quan -= cnt;
    obj.owt = weight(obj);
    split.owt = weight(split);
    const inv = inventoryArray();
    const ix = inv.indexOf(obj);
    if (ix >= 0) inv.splice(ix + 1, 0, split);
    syncInventory(inv);
    const splitContext = game.context.objsplit || (game.context.objsplit = {});
    splitContext.parent_oid = obj.o_id;
    splitContext.child_oid = split.o_id;
    return split;
}
// C ref: mkobj.c:556-621 — undo the latest split only while both halves
// remain in the same inventory or container and can still merge.
export function unsplitobj(obj) {
    const splitContext = game.context.objsplit;
    if (!obj || !splitContext) return null;
    let list;
    if (obj.where === OBJ_INVENT) list = inventoryArray();
    else if (obj.where === OBJ_MINVENT) list = obj.ocarry?.minvent;
    else if (obj.where === OBJ_CONTAINED)
        list = (obj.ocontainer || container_of(obj))?.cobj;
    else return null;
    if (!list) return null;
    if (obj.o_id !== splitContext.parent_oid
        && obj.o_id !== splitContext.child_oid) return null;
    const parent = list.find(o => o.o_id === splitContext.parent_oid);
    const child = list.find(o => o.o_id === splitContext.child_oid);
    return parent && child && merged(parent, child) ? parent : null;
}
export function clear_splitobjs() {
    const splitContext = game.context.objsplit;
    if (splitContext) splitContext.parent_oid = splitContext.child_oid = 0;
}
function extract_nobj(obj, listRef) {
    const inv = Array.isArray(listRef) ? listRef : inventoryArray();
    const ix = inv.indexOf(obj);
    if (ix >= 0) inv.splice(ix, 1);
    syncInventory(inv);
}
// C ref: mkobj.c obj_extract_self() — unlink an object from whatever list it is
// currently on (dispatch on obj->where).  A floor object must be removed from
// the level's object list (our flat game.level.objects array) via
// floor_extract_self; otherwise it (e.g. a force-broken chest) lingers on the
// floor and the pet's dog_goal fobj scan re-rolls an extra obj_resists rn2(100)
// that C never makes (seed0014 step-47 divergence). Monster inventory is owned
// by obj.ocarry, while hero inventory has the synchronized aliases below.
export function obj_extract_self(obj) {
    if (!obj) return;
    if (obj.where === OBJ_FLOOR) { floor_extract_self(obj); return; }
    if (obj.where === OBJ_BURIED) {
        /* C: extract_nobj(obj, &svl.level.buriedobjlist) */
        const blist = game.level?.buriedobjlist;
        const bix = Array.isArray(blist) ? blist.indexOf(obj) : -1;
        if (bix >= 0) blist.splice(bix, 1);
    }
    if (obj.ocarry) {
        const inv = obj.ocarry.minvent;
        const index = inv.indexOf(obj);
        if (index >= 0) inv.splice(index, 1);
        obj.ocarry = null;
    }
    removeObjectFromAllInventories(obj);
    obj.where = OBJ_FREE;
}
// ── worn.c:73-184 setworn()/setnotworn(): the extrinsic/blocked half ────────
//
// C's setworn() is entirely generic: for every worn[] slot it touches it does
//     p = objects[obj->otyp].oc_oprop;
//     u.uprops[p].extrinsic |= wp->w_mask;
//     if ((p = w_blocks(obj, mask)) != 0) u.uprops[p].blocked |= wp->w_mask;
// and setnotworn()/the displaced-occupant arm do the AND-NOT.  That step did
// not exist anywhere in this port, so no worn item conferred its property:
// the Wizard's starting cloak of magic resistance left Antimagic false and a
// self-zapped wand of magic missile rolled d(4,6) where C prints "The missiles
// bounce!" and draws nothing.  objects[].oc_oprop IS carried by mkobj.js (70
// rows, verified against the recorder's objects.h), so the table drives this;
// nothing here hardcodes an otyp except C's own w_blocks() special cases.
//
// MASK VOCABULARY.  The extrinsic word must speak prop.h, because js/artifact.js
// set_artifact_intrinsic() already owns the W_ART bit in the same store and
// js/worn.js reads it.  This file's owornmask bits are a REMAPPED set (see the
// block at line 240): the armor bits, W_WEP/W_QUIVER/W_SWAPWEP and W_RINGL/
// W_RINGR happen to equal prop.h's, but this file's W_AMUL is 0x00080000
// (prop.h's W_TOOL) and its W_BLINDF is 0x00800000 (not a prop.h bit at all,
// C puts facewear in W_TOOL).  prop_wornmask() is the one place that reconciles
// the two vocabularies; do not skip it.
function prop_wornmask(mask) {
    let m = (mask | 0) & (W_ARMOR | W_WEAPONS | W_RINGL | W_RINGR
                          | W_BALL | W_CHAIN);
    if (mask & W_AMUL) m |= CW_AMUL;
    if (mask & W_BLINDF) m |= CW_TOOL;
    return m;
}

// C ref: worn.c:38 w_blocks(o, m) — "This only allows for one blocking item per
// property".  The cornuthaum arm really does depend on the hero's role.
const MUMMY_WRAPPING_OTYP = 138, CORNUTHAUM_OTYP = 93;
function w_blocks(obj, mask) {
    if (!obj) return 0;
    if (obj.otyp === MUMMY_WRAPPING_OTYP && (mask & WORN_CLOAK) !== 0)
        return INVIS;
    if (obj.otyp === CORNUTHAUM_OTYP && (mask & WORN_HELMET) !== 0
        && !Role_if(PM_WIZARD))
        return CLAIRVOYANT;
    if (obj.oartifact === ART_EYES_OF_THE_OVERWORLD && (mask & W_BLINDF) !== 0)
        return BLINDED;
    return 0;
}

// prop.h u.uprops[prop].extrinsic / .blocked.  js/artifact.js:2867 already
// keeps the extrinsic store in this exact shape (prop index -> slot bitmask);
// the blocked store is its sibling and is created the same way.
function uprops_bits(store, prop) { return (game.u?.[store] || {})[prop] | 0; }
function uprops_set_bits(store, prop, bits) {
    if (!game.u) return;
    game.u[store] = game.u[store] || {};
    game.u[store][prop] = bits;
}
// C ref: youprop.h E<Prop> — the extrinsic word for a property, and the
// `blocked` word that suppresses it.  Exported as the single reader for the
// property accessors scattered across this port; converting those readers is
// deliberately NOT part of this change.
export function worn_extrinsic(prop) { return uprops_bits('uprops_extrinsic', prop); }
export function worn_blocked(prop) { return uprops_bits('uprops_blocked', prop); }
// C ref: youprop.h `#define Free_action (HFree_action || EFree_action)`.  The
// worn half (ring of free action, orange dragon scales, ...) lives only in the
// extrinsic word above; the u.uprops spellings are the intrinsic/timed half
// (and the several names this port has used for it).  Single reader for every
// Free_action check so a worn ring is not invisible to them.
export function Free_action() {
    const p = game.u?.uprops;
    return !!((p?.FreeAction | 0) || (p?.HFree_action | 0) || (p?.EFree_action | 0)
              || (p?.Free_action | 0) || (game.u?.EFree_action | 0)
              || worn_extrinsic(FREE_ACTION_PROP));
}

// C ref: worn.c:120-131 — the install half.  C's two guards, verbatim:
// `if (wp->w_mask & ~(W_SWAPWEP | W_QUIVER))` keeps quivered/alternate items
// from conferring anything, and `obj->oclass == WEAPON_CLASS || is_weptool(obj)
// || mask != W_WEP` stops a wielded potion/ring from conferring its property.
// Exported because js/u_init.js has its own copy of setworn() for the starting
// kit (the fifth of five hero worn-slot mutators in this port) and that is the
// path that dons the Wizard's cloak of magic resistance.
export function worn_extrinsics_on(obj, mask) {
    if (!obj || !game.u) return;
    if (!(mask & ~(W_SWAPWEP | W_QUIVER))) return;
    const pm = prop_wornmask(mask);
    if (obj.oclass === WEAPON_CLASS || is_weptool(obj) || mask !== W_WEP) {
        const p = objects[obj.otyp]?.oc_oprop | 0;
        if (p)
            uprops_set_bits('uprops_extrinsic', p, worn_extrinsic(p) | pm);
        const b = w_blocks(obj, mask);
        if (b)
            uprops_set_bits('uprops_blocked', b, worn_blocked(b) | pm);
    }
}

// C ref: worn.c:92-107 (displacing a slot's previous occupant) and worn.c:168-175
// (setnotworn).  Neither carries the WEAPON_CLASS guard: whatever bit went in
// comes back out.  worn.c's setnotworn also omits the W_SWAPWEP/W_QUIVER guard
// that its setworn twin has, which is equivalent — those two slots never get a
// bit set in the first place, so AND-NOT-ing them is a no-op either way.
export function worn_extrinsics_off(obj, mask) {
    if (!obj || !game.u) return;
    if (!(mask & ~(W_SWAPWEP | W_QUIVER))) return;
    const pm = prop_wornmask(mask);
    const p = objects[obj.otyp]?.oc_oprop | 0;
    if (p)
        uprops_set_bits('uprops_extrinsic', p, worn_extrinsic(p) & ~pm);
    const b = w_blocks(obj, mask);
    if (b)
        uprops_set_bits('uprops_blocked', b, worn_blocked(b) & ~pm);
}

// C ref: worn.c:73-145 setworn(obj, mask) — the owornmask half.  The slot
// POINTER half is spread over worn_slot_set()/setworn_accessory()/
// setworn_slot() in this file and u_init.js's own copy; the extrinsic half is
// worn_extrinsics_on() above.
function setworn(obj, mask) {
    if (!obj) return;
    obj.owornmask = mask;
    worn_extrinsics_on(obj, mask);
}
// C ref: worn.c setnotworn() — clears the worn-slot POINTER (*objp = 0) as well
// as owornmask. Dropping only the mask left game.uamul pointing at a used-up
// amulet of life saving, so the hero was saved a second time by an amulet
// that had already crumbled.
//
// worn.c's real `worn[]` table (worn.c:18-34) has 16 entries; this function
// only ever covered the 11 armor/ring/amulet/blindfold slots. The other 5 --
// W_WEP/uwep, W_SWAPWEP/uswapwep, W_QUIVER/uquiver, W_BALL/uball, W_CHAIN/
// uchain -- were missing entirely, so any caller that destroys a wielded
// weapon, quivered ammo, or attached ball/chain via setnotworn()+delobj()
// (rather than a manually-inlined game.uwep check) left that field pointing
// at a freed object. Real callers reachable from this port: js/trap.js
// fire_damage()/lava_damage() on a wielded bullwhip/pick-axe/dipped item.
export function setnotworn(obj) {
    if (!obj) return;
    if (game.u?.twoweap && (obj === game.uwep || obj === game.uswapwep)) {
        game.u.twoweap = false;
        if (game.flags?.weaponstatus) game.botl = true;
    }
    if (obj === game.uamul) game.uamul = null;
    if (obj === game.uleft) game.uleft = null;
    if (obj === game.uright) game.uright = null;
    if (obj === game.ublindf) game.ublindf = null;
    if (obj === game.uarm) game.uarm = null;
    if (obj === game.uarmc) game.uarmc = null;
    if (obj === game.uarmh) game.uarmh = null;
    if (obj === game.uarms) game.uarms = null;
    if (obj === game.uarmg) game.uarmg = null;
    if (obj === game.uarmf) game.uarmf = null;
    if (obj === game.uarmu) game.uarmu = null;
    if (obj === game.uwep) game.uwep = null;
    if (obj === game.uswapwep) game.uswapwep = null;
    if (obj === game.uquiver) game.uquiver = null;
    if (obj === game.uball) game.uball = null;
    if (obj === game.uchain) game.uchain = null;
    // C ref: worn.c:168-175 — drop the property this object was conferring
    // through EVERY slot it occupied, before the mask is cleared.
    worn_extrinsics_off(obj, obj.owornmask | 0);
    obj.owornmask = 0;
}
export function welded(obj) {
    // C ref: wield.c:1053 welded(obj) — cursed + wielded + weld-prone (will_weld);
    // it also sets bknown, which is why a failed take-off teaches the curse.
    if (obj && obj === game.uwep && will_weld_dw(obj)) { obj.bknown = 1; return true; }
    return false;
}
function can_reach_floor(_pit) { return true; }
// C ref: do.c dropx(obj):786 — freeinv(), then (unless swallowed) ship_object()
// (the item rides a hole/trap door/down stairs to the level below and is gone
// from here), then the altar check that reveals BUC via doaltarobj(), then
// dropy()/dropz() for the real floor-placement/shop-sell dispatch.
export async function dropx(obj) {
    freeinv(obj);
    const u = ustate();
    if (!u.uswallow) {
        const { ship_object } = await import('./dokick.js');
        if (await ship_object(obj, u.ux, u.uy, false)) return;
        if (IS_ALTAR(game.level?.at(u.ux, u.uy)?.typ)) {
            const DOm = await import('./do.js');
            await DOm.doaltarobj(obj); /* set bknown */
        }
    }
    await dropy(obj);
}
// C ref: do.c dropy(obj):800 — dropz(obj, FALSE).
export async function dropy(obj) {
    const u = ustate();
    await dropz(obj, u.ux, u.uy, false);
}
function freeinv_no_update(obj) { removeObjectFromAllInventories(obj); }

// C ref: prop.h Antimagic == HAntimagic || EAntimagic.  This reads only the
// intrinsic-ish mirrors; the extrinsic word is now maintained by
// worn_extrinsics_on()/off() above and should be read with
// worn_extrinsic(ANTIMAGIC).  Converting this port's eight independent
// Antimagic() definitions (and every other property accessor) onto the bitmask
// is queued separately — do not add a ninth.
function Antimagic() {
    if (game.u?.formprops?.Antimagic) return true; /* FROMFORM: polyself.js set_uasmon() */
    const u = game.u;
    return !!(u?.uprops?.Antimagic || u?.Antimagic || u?.HAntimagic || u?.EAntimagic);
}
// C ref: youprop.h Hate_silver == (u.ulycn >= LOW_PM || hates_silver(youmonst)).
// LOW_PM is 0 (u.ulycn is NON_PM == -1 normally).  The one hero-side copy.
export function Hate_silver() {
    if ((game.u?.ulycn ?? -1) >= 0) return true;
    return hates_silver(youmonst_data());
}
// C ref: hack.h Maybe_Half_Phys(dmg) — halve (rounding up) under HALF_PHDAM.
function Maybe_Half_Phys(dmg) {
    return (game.u?.HHalf_physical_damage || game.u?.EHalf_physical_damage)
        ? Math.trunc((dmg + 1) / 2) : dmg;
}
// C ref: hack.c losehp(n, knam, k_format) -- do.js losehp_do() runs the whole
// thing, including "You die..." / done(DIED) when the hit points run out.
async function losehp_invent(n, knam, k_format = 0 /* KILLED_BY_AN */) {
    const { losehp_do } = await import('./do.js');
    await losehp_do(n, knam, k_format);
}
// C ref: monst.h gy.youmonst.data == &mons[u.umonnum] (set_uasmon keeps
// umonnum == umonster for the hero's own form, so this is correct polymorphed
// or not).  u.data is the polyself-maintained mirror; fall back to it when the
// pmidx lookup is unavailable.
export function youmonst_data() {
    // u.umonnum holds the 0-based ROLE index in this port, not a mons[] index —
    // see the same fix at js/hack.js:579.  PM_ARCHEOLOGIST == 331.
    const u = game.u;
    if (u?.Upolyd) return monster_by_pmidx(u.umonnum) || u?.data || null;
    return monster_by_pmidx(331 + (u?.umonnum ?? 0)) || u?.data || null;
}

// C ref: attrib.c acurrstr() — encode A_STR (3..125; 18/01 stored as 19, ..)
// onto the 3..25 scale weight_cap() uses (mirrors cmd.js' acurrstr()). Its
// ACURR(A_STR) macro pins the encoded value at 125 while gauntlets of power
// are worn (acurr_str_encoded() is that override); reading
// game.u.acurr.a[A_STR] directly skipped it, so a Str-25-via-gauntlets hero's
// carrying capacity used the RAW Str instead of 25 (St:25 read as St:9),
// coming out ~400 too low (seed0360 step 828).
function acurrstr() {
    const str = acurr_str_encoded();
    if (str <= 18) return Math.max(str, 3);
    if (str <= 121) return 19 + Math.trunc(str / 50);
    return Math.min(str, 125) - 100;
}

// C ref: hack.c weight_cap() — the hero's carrying capacity.  Base STR+CON
// capacity, polymorphed-form scaling, the Levitation/air-level/strong-steed
// override, and the wounded-legs reduction (a bear trap that wounds a leg
// drops carrcap by WT_WOUNDEDLEG_REDUCT, which is what pushes the seed0004
// hero from unencumbered to Burdened).  Consumes no RNG, but every encumbrance
// predicate downstream (allmain.c moveloop_core, do.c doup, uhitm.c) reads it.
// The Boots_on/afternmv ELevitation deferral and float_vs_flight() are not
// modelled (no multi-turn levitation-boots don in this port).
export function weight_cap() {
    const u = game.u;
    let ewl = 0;
    let carrcap = WT_WEIGHTCAP_STRCON * (acurrstr() + acurr_eff(A_CON))
                  + WT_WEIGHTCAP_SPARE;
    // C ref: hack.c weight_cap() Upolyd branch (consistent with mon.c
    // can_carry()) — small/large forms scale capacity by body size (cwt) or,
    // for the cwt==0 case, by msize relative to human-sized (MZ_HUMAN=2).
    if (u?.Upolyd && u.data) {
        const MZ_HUMAN = 2, WT_HUMAN = 1450;
        if (u.data.mlet === 'n') {
            carrcap = MAX_CARR_CAP;
        } else if (!u.data.cwt) {
            carrcap = Math.trunc((carrcap * (u.data.msize ?? MZ_HUMAN)) / MZ_HUMAN);
        } else if (!strongmonst(u.data) || (strongmonst(u.data) && u.data.cwt > WT_HUMAN)) {
            carrcap = Math.trunc((carrcap * u.data.cwt) / WT_HUMAN);
        }
    }
    // C ref: hack.c:4324 — Levitation / Plane of Air / strong steed pin
    // capacity at MAX_CARR_CAP and, crucially, SKIP the wounded-legs reduction
    // (it lives in the else branch: airborne legs can't be limped on).
    const levitating = u?.uprops?.Levitation
        || (worn_extrinsic(LEVITATION) & ~worn_blocked(LEVITATION));
    if (levitating || Is_airlevel()
        || (u?.usteed && strongmonst(u.usteed.data))) {
        carrcap = MAX_CARR_CAP;
    } else {
        if (carrcap > MAX_CARR_CAP) carrcap = MAX_CARR_CAP;
        // C ref: hack.c:4331 `if (!Flying)` — wounded legs only interfere with
        // proper WALKING.  A polymorphed flyer sets u.uprops.Flying in
        // set_uasmon(); Flying is unset for every non-poly hero.
        ewl = (!u?.uprops?.Flying)
        ? ((u?.EWounded_legs || 0) || (u?.uprops?.EWounded_legs || 0))
        : 0;
        if (ewl & LEFT_SIDE) carrcap -= WT_WOUNDEDLEG_REDUCT;
        if (ewl & RIGHT_SIDE) carrcap -= WT_WOUNDEDLEG_REDUCT;
    }
    return Math.max(carrcap, 1);
}

// C ref: hack.c inv_weight() — total inventory weight minus capacity; also
// stashes the freshly-computed capacity in game._wc (C's gw.wc) for
// calc_capacity().  C's test is `otyp != BOULDER || !throws_rocks(youmonst)`:
// a boulder DOES count for an ordinary hero and is free only for a rock-thrower
// (giant polyform).  The previous `otyp !== BOULDER` skipped it unconditionally,
// which is the opposite of C and hid ~6000 weight from every encumbrance test.
export function inv_weight() {
    let wt = 0;
    const ydata = youmonst_data();
    for (const otmp of inventoryArray()) {
        if (otmp.oclass === COIN_CLASS)
            wt += Math.trunc(((otmp.quan || 0) + 50) / 100);
        else if (otmp.otyp !== BOULDER || !throws_rocks_flag(ydata))
            wt += otmp.owt || 0;
    }
    const wc = weight_cap();
    game._wc = wc;
    return wt - wc;
}

// C ref: hack.c cant_squeeze_thru() — `inv_weight() + weight_cap()`, i.e. the
// raw carried weight (inv_weight() already subtracted the capacity).
export function carried_weight() { return inv_weight() + weight_cap(); }

// C ref: hack.c calc_capacity(xtra_wt) — encumbrance level for a given extra
// weight.  Returns UNENCUMBERED when within capacity, else (wt*2/wc)+1 capped
// at OVERLOADED.
export function calc_capacity(xtra_wt) {
    const wt = inv_weight() + (xtra_wt || 0);
    if (wt <= 0) return UNENCUMBERED;
    const wc = game._wc;
    if (wc <= 1) return OVERLOADED;
    const cap = Math.trunc((wt * 2) / wc) + 1;
    return Math.min(cap, OVERLOADED);
}

// C ref: hack.c near_capacity() — calc_capacity(0).
export function near_capacity() { return calc_capacity(0); }

// C ref: pickup.c encumber_msg() — prints a message when the encumbrance level
// changes since the last check, and remembers the new level in go.oldcap
// (tracked as game._oldcap).  Consumes no RNG.
export async function encumber_msg() {
    const newcap = near_capacity();
    const oldcap = game._oldcap || 0;
    // C ref: pickup.c encumber_msg() sets disp.botl=TRUE AFTER its own message
    // (or message switch).  display.js's botl_flush() now refreshes
    // game._curcap = near_capacity() live on every pline/flush_screen
    // regardless of which event set game.botl, so there is no separate
    // "publish eagerly if already dirty" case left to special-case here:
    // any update_topl() call below (or a later, unrelated one) already
    // shows the new level the moment it runs.
    if (oldcap < newcap) {
        switch (newcap) {
        case 1: await update_topl('Your movements are slowed slightly because of your load.'); break;
        case 2: await update_topl('You rebalance your load.  Movement is difficult.'); break;
        case 3: await update_topl(`You ${(await import('./uhitm.js')).stagger_verb(youmonst_data())} under your heavy load.  Movement is very hard.`); break;
        default: await update_topl(newcap === 4
            ? 'You can barely move a handspan with this load!'
            : "You can't even move a handspan with this load!"); break;
        }
        game.botl = true;
    } else if (oldcap > newcap) {
        switch (newcap) {
        case 0: await update_topl('Your movements are now unencumbered.'); break;
        case 1: await update_topl('Your movements are only slowed slightly by your load.'); break;
        case 2: await update_topl('You rebalance your load.  Movement is still difficult.'); break;
        case 3: await update_topl(`You ${(await import('./uhitm.js')).stagger_verb(youmonst_data())} under your load.  Movement is still very hard.`); break;
        }
        game.botl = true;
    }
    // (game._curcap deliberately not touched: C bot() recomputes it at publish time)
    game._oldcap = newcap;
}
function inv_cnt(includeGold = true) {
    let n = 0;
    for (const obj of inventoryArray()) if (includeGold || obj.oclass !== COIN_CLASS) ++n;
    return n;
}
function in_rooms(_x, _y, _shop) { return ''; }
function u_at(x, y) { return game.u?.ux === x && game.u?.uy === y; }
function hides_under(_data) { return false; }
function hideunder(_mon) { return false; }
function maybe_unhide_at(_x, _y) {}
// C ref: zap.c obj_resists(obj, ochance, achance).  The invocation items, the
// Amulet and a Rider corpse always resist; everything else rolls rn2(100) and resists when
// the roll lands below the per-object chance.  delobj_core() calls this with
// ochance == achance == 0, so ordinary objects never resist — but the rn2(100)
// MUST still fire to keep the PRNG stream aligned with C (e.g. delobj(box) at
// the end of breakchestlock()).
// C ref: mondata.h is_rider(ptr) — a pointer comparison against the three
// Rider entries, so matching by species name is the faithful form here.
const RIDER_NAMES = new Set(['Death', 'Pestilence', 'Famine']);
function is_rider_pm(pmidx) {
    return RIDER_NAMES.has(monster_by_pmidx(pmidx)?.name || '');
}
function obj_resists(obj, ochance, achance) {
    const otyp = obj?.otyp;
    if (otyp === AMULET_OF_YENDOR
        || otyp === SPE_BOOK_OF_THE_DEAD
        || otyp === CANDELABRUM_OF_INVOCATION
        || otyp === BELL_OF_OPENING
        || (otyp === CORPSE && is_rider_pm(obj?.corpsenm))) {
        return true;
    }
    const chance = rn2(100);
    return chance < (obj?.oartifact ? achance : ochance);
}
function get_obj_location(obj, xp, yp) { if (!obj) return false; xp.x = obj.ox; yp.y = obj.oy; return true; }
/* allow_category / add_valid_menu_class / menu_class_present /
   collect_obj_classes are pickup.c's; imported from js/pickup.js above. */
/* query_objlist / query_category are pickup.c's; see js/pickup.js. */
function create_nhwindow(_type) { return 1; }
function destroy_nhwindow(_win) {}
function start_menu(_win, _behave) {}
function end_menu(_win, _query) {}
function add_menu(_win, _glyph, _any, _accel, _group, _attr, _clr, _text, _flags) {}
function add_menu_str(_win, _str) {}
function add_menu_heading(_win, _str) {}
function select_menu(_win, _pick, _selected) { return 0; }
function display_nhwindow(_win, _blocking) {}
function clear_nhwindow(_win) {}
function putstr(_win, _attr, _str) {}
function message_menu(_let, _pick, _text) { return _let; }
function getlin(_q, _buf) {}
function readchar() { return '\0'; }
function get_count(_q, first, _max, out) { if (out) out.value = Number(first) || 0; return '\n'; }
function wait_synch() {}
function putmsghistory(_q, _restoring) {}
// C ref: cmd.c cmdq_* — the canned command queue (CQ_CANNED).  itemactions()
// pushes the chosen object's invlet here; a subsequent getobj() pops it as the
// object selection WITHOUT rendering a prompt (mirroring tty's cmdq_pop fast
// path).  The queue lives on game so it survives across the dispatched command.
function _cmdq(which) {
    const key = which === CQ_REPEAT ? '_cmdq_repeat' : '_cmdq_canned';
    if (!game[key]) game[key] = [];
    return game[key];
}
export function cmdq_pop(which = CQ_CANNED) {
    const q = _cmdq(which);
    return q.length ? q.shift() : null;
}
function cmdq_clear(which = CQ_CANNED) { _cmdq(which).length = 0; }
function cmdq_add_int(which, n) { _cmdq(which).push({ typ: CMDQ_INT, intval: n }); }
export function cmdq_add_key(which, k) {
    _cmdq(which).push({ typ: CMDQ_KEY, key: typeof k === 'number' ? k : String(k).charCodeAt(0) });
}
function silly_thing_to() { return 'That is a silly thing to do.'; }
function bypass_objlist(list, value) { for (const obj of iterateObjects(list)) obj.bypass = value ? 1 : 0; }
function nxt_unbypassed_loot(loot, list) {
    for (const item of loot || sortloot({ obj: list }, 0, false, null)) {
        if (!item.obj) break;
        if (!item.obj.bypass) { item.obj.bypass = 1; return item.obj; }
    }
    return null;
}
function def_char_to_objclass(sym) {
    if (typeof sym === 'number') return sym;
    return def_oc_syms.findIndex((x) => x.sym === sym);
}
function letter(c) { return /^[A-Za-z]$/.test(String(c)); }
function digit(c) { return /^[0-9]$/.test(String(c)); }
function plur(n) { return Number(n) === 1 ? '' : 's'; }
function highc(s) { return String(s).charAt(0).toUpperCase(); }
function mungspaces(s) { return String(s).replace(/\s+/g, ' ').trim(); }
// C ref: hacklib.c ing_suffix() — gerund construction: split off a trailing
// " on"/" off"/" with" particle, then double a final consonant ("tip"->"tipping"),
// turn "ie" into "y" ("vie"->"vying"), or drop a final "e" ("grease"->"greasing").
function ing_suffix(s) {
    const vowel = (c) => c !== '' && 'aeiouwy'.includes(c.toLowerCase());
    let buf = String(s), onoff = '';
    const tail = (n) => (buf.length >= n ? buf.slice(buf.length - n).toLowerCase() : '');
    if (tail(3) === ' on' || tail(4) === ' off' || tail(5) === ' with') {
        const sp = buf.lastIndexOf(' ');
        onoff = buf.slice(sp);
        buf = buf.slice(0, sp);
    }
    const p = buf.length;
    const at = (i) => (i >= 0 && i < buf.length ? buf.charAt(i) : '');
    if (p >= 2 && buf.slice(p - 2).toLowerCase() === 'er') {
        /* slither + ing */
    } else if (p >= 3 && !vowel(at(p - 1)) && vowel(at(p - 2)) && !vowel(at(p - 3))) {
        buf += at(p - 1); /* tip -> tipp + ing */
    } else if (p >= 2 && buf.slice(p - 2).toLowerCase() === 'ie') {
        buf = `${buf.slice(0, p - 2)}y`; /* vie -> vy + ing */
    } else if (p >= 1 && at(p - 1) === 'e') {
        buf = buf.slice(0, p - 1); /* grease -> greas + ing */
    }
    return `${buf}ing${onoff}`;
}
// C ref: polyself.c body_part(part) == mbodypart(&gy.youmonst, part).  The
// humanoid-only table this used to carry answered "hand"/"finger" for every
// polyform, so a poly'd hero's inventory and 'P' prompts named the wrong part.
export function body_part(part) {
    return poly_body_part(part);
}
// C ref: wield.c empty_handed() — gloves imply hands so "empty handed"; a
// gloveless humanoid is "bare handed"; paws or a lack of hands (an animal
// polyform) read "not wielding anything".
export function empty_handed() {
    return game.uarmg ? 'empty handed'
        : humanoid_flag(youmonst_data()) ? 'bare handed' : 'not wielding anything';
}
// C ref: obj.h:427 pair_of(o) — lenses, gloves or boots (by oc_armcat, not
// by a name regex: "gauntlets of power" matches neither 'gloves' nor 'boots').
export function pair_of(obj) { return obj?.otyp === LENSES || is_gloves(obj) || is_boots(obj); }
// C ref: obj.h:421 is_plural(o) — quan != 1, OR the discovered unique
// artifact "Eyes of the Overworld" (worn as lenses, otherwise singular).
// This is deliberately NOT pair_of(o): a single pair of gloves/boots/lenses
// stays grammatically singular ("hits the floor", not "hit the floor") for
// otense()/verb-conjugation callers.  Call sites that also need the "pair
// of X" pronoun (they/those/these) OR pair_of(obj) in explicitly (see
// wield.js use_plural, potion.js shortestname/dip qbuf, invent.c:2120).
const ART_EYES_OF_THE_OVERWORLD = 26;
export function is_plural(obj) {
    if (!obj) return false;
    if ((obj.quan || 1) !== 1) return true;
    if (obj.oartifact !== ART_EYES_OF_THE_OVERWORLD) return false;
    const disco = game.artidisco;
    if (!Array.isArray(disco)) return false; // artidisco() not yet touched: undiscovered
    for (let i = 0; i < disco.length; i++) {
        if (disco[i] === ART_EYES_OF_THE_OVERWORLD) return true;
        if (disco[i] === 0) break;
    }
    return false;
}
// C ref: obj.h is_weptool(o) — a TOOL_CLASS object with a real weapon skill
// (oc_skill != P_NONE).  Pick-axe / grappling hook / unicorn horn qualify;
// lamps, towels, bags, etc. do not.
export function is_weptool(obj) {
    return obj?.oclass === TOOL_CLASS && (objects[obj.otyp]?.oc_skill ?? 0) !== 0;
}
// C ref: obj.h is_wet_towel(o) — a towel with charges (wetness) left.
function is_wet_towel(obj) { return obj?.otyp === 234 /*TOWEL*/ && (obj.spe | 0) > 0; }
function map_glyphinfo(_x, _y, _glyph, _flags, _info) {}
function let_to_name_fallback(letChar) { return names[letChar] || names[ILLOBJ_CLASS]; }

const def_oc_syms = [
    { sym: '\0' }, { sym: ']' }, { sym: ')' }, { sym: '[' }, { sym: '=' },
    { sym: '"' }, { sym: '(' }, { sym: '%' }, { sym: '!' }, { sym: '?' },
    { sym: '+' }, { sym: '/' }, { sym: '$' }, { sym: '*' }, { sym: '`' },
    { sym: '0' }, { sym: '_' }, { sym: '.' },
];

const names = [
    null, 'Illegal objects', 'Weapons', 'Armor', 'Rings', 'Amulets', 'Tools',
    'Comestibles', 'Potions', 'Scrolls', 'Spellbooks', 'Wands', 'Coins',
    'Gems/Stones', 'Boulders/Statues', 'Iron balls', 'Chains', 'Venoms',
];

export function inventoryArray() {
    if (Array.isArray(game.invent)) return game.invent;
    if (Array.isArray(game.gi?.invent)) return game.gi.invent;
    if (game.gi?.invent && typeof game.gi.invent === 'object') {
        const out = [];
        for (let obj = game.gi.invent; obj; obj = obj.nobj) out.push(obj);
        game.invent = out;
        return out;
    }
    game.invent = [];
    return game.invent;
}

function syncInventory(inv = inventoryArray()) {
    game.invent = inv;
    game.gi = game.gi || {};
    game.gi.invent = inv;
    for (let i = 0; i < inv.length; ++i) {
        inv[i].where = OBJ_INVENT;
        inv[i].nobj = inv[i + 1] || null;
    }
}

function* iterateObjects(list, byNexthere = false) {
    if (!list) return;
    if (Array.isArray(list)) {
        for (const obj of list) if (obj) yield obj;
        return;
    }
    if (list.obj && Array.isArray(list.obj)) {
        for (const obj of list.obj) if (obj) yield obj;
        return;
    }
    for (let obj = list.obj || list; obj; obj = byNexthere ? obj.nexthere : obj.nobj)
        yield obj;
}

function removeObjectFromAllInventories(obj) {
    if (!obj) return;
    const inv = inventoryArray();
    const ix = inv.indexOf(obj);
    if (ix >= 0) inv.splice(ix, 1);
    syncInventory(inv);
}

// C ref: objclass.h F_CHARGED (flags bit 1) — wands and the magic marker are
// "charged"; their displayed charge count implies BUC, which suppresses the
// "uncursed" word.
const F_CHARGED = 1;
function is_oc_charged(obj) {
    return !!(objects[obj?.otyp]?.flags & F_CHARGED);
}

// C ref: objnam.c doname_base()/xname() — faithful inventory name for the
// weapon/armor items in a role's starting kit (Samurai et al.).  Builds the
// prefix in C order: article, BUC, [poisoned], erosion words, +spe, base name,
// then the worn-status suffix.  Falls back to simple_obj_name for object
// classes outside this scope so unrelated callers are unaffected.
export function doname_invent(obj) {
    if (!obj) return 'nothing';
    return on_doname_base(obj, 0);
}

// C ref: objnam.c distant_name(obj, doname):370-404 — name an object seen only
// from a distance. The FAR branch just bumps gd.distantname (suppressing
// xname_flags()'s observe_object()); it does NOT hide an already-known dknown,
// so a seen gem still reads "blue gem" (pre-3.6.1 C forced Blind here, source
// of the old clear-dknown port). NEAR observes before naming, so appearance
// shows on first sight. mon.c mpickstuff() relies on FAR not revealing: a
// monster grabbing an unidentified item must not add it to '\' discoveries.
export function distant_doname(obj, far) {
    if (!obj) return 'nothing';
    if (!far) return on_doname_base(obj, 0);
    // This port leaves obj.dknown UNSET on most fresh objects (C uses 0), so
    // stand in for mkobj.c mksobj_init()'s missing clear_dknown() for that
    // unset case only. (C also clears it for shields/oc_merge types; not
    // modelled, no covered session needs it.)
    const sav = obj.dknown;
    if (sav == null) obj.dknown = DKNOWNS_CLASSES.has(obj.oclass) ? 0 : 1;
    distantname_adjust(1);
    try { return on_doname_base(obj, 0); } finally { distantname_adjust(-1); if (sav == null) obj.dknown = sav; }
}

// C ref: mkobj.c dknowns[] — the object classes whose appearance must be seen
// up close before it is known.
const DKNOWNS_CLASSES = new Set([WAND_CLASS, RING_CLASS, POTION_CLASS,
    SCROLL_CLASS, GEM_CLASS, SPBOOK_CLASS, WEAPON_CLASS, TOOL_CLASS,
    VENOM_CLASS]);

// C ref: objnam.c distant_name():387-388 — only a visible nearby object (or
// visible artifact) is observed while naming.  <ox,oy> is get_obj_location(),
// i.e. the carrier's spot for a minvent item.
export function distant_far(obj, ox, oy) {
    if (ox == null || oy == null || !cansee(ox, oy)) return true;
    if (obj?.oartifact) return false;
    const r = (game.u?.xray_range > 2) ? game.u.xray_range : 2;
    const neardist = (r * r) * 2 - r;
    const dx = ox - (game.u?.ux ?? 0), dy = oy - (game.u?.uy ?? 0);
    return (dx * dx + dy * dy) > neardist;
}


function classOrder() {
    // C ref: options.c def_inv_order[] — the default inventory display order.
    //   COIN, AMULET, WEAPON, ARMOR, FOOD, SCROLL, SPBOOK, POTION, RING, WAND,
    //   TOOL, GEM, ROCK, BALL, CHAIN
    return flags().inv_order || [
        COIN_CLASS, AMULET_CLASS, WEAPON_CLASS, ARMOR_CLASS, FOOD_CLASS,
        SCROLL_CLASS, SPBOOK_CLASS, POTION_CLASS, RING_CLASS, WAND_CLASS,
        TOOL_CLASS, GEM_CLASS, ROCK_CLASS, BALL_CLASS, CHAIN_CLASS,
    ];
}

function compareInvlet(a, b) {
    return invletter_value(a.invlet || NOINVSYM) - invletter_value(b.invlet || NOINVSYM);
}

// Status lines share the single implementation in display.js (putStatusRow).

// C ref: win/tty/wintty.c tty_display_nhwindow — a partial-width NHW_MENU
// only clears/draws its own column band; rows it occupies keep whatever was
// left of that band (here, the status line) untouched.  When the menu's
// content (including the trailing "(end)" row) reaches down into row 22/23,
// the status text there must be truncated at the menu's left edge instead of
// redrawn full-width, or it clobbers the "(end)" indicator the menu just drew.
function putStatusLines(display, bandStart = null, menuLastRow = -1) {
    // A full-width menu (bandStart 0) ran term_clear_screen() and wiped the
    // status window; it is not redrawn here, but the dismissal cutoff below is
    // still recorded for the next corner window.
    if (bandStart !== 0) {
        putStatusRow(display, 1, 22, (bandStart != null && menuLastRow >= 22) ? bandStart : null);
        putStatusRow(display, 2, 23, (bandStart != null && menuLastRow >= 23) ? bandStart : null);
    }
    // C ref: win/tty/wintty.c erase_menu_or_text() -> docorner() — dismissing
    // THIS window later sweeps cl_end() from (offx-1) across every row down to
    // and including the status window whenever the menu's own content reaches
    // row 22, wiping row 23's tail too even though this draw wrote it in full.
    // A short overlay drawn right after (no content of its own down there)
    // inherits that already-wrecked line instead of a fresh recompute, so
    // remember the cutoff for whichever corner window renders next.
    if (bandStart != null && menuLastRow >= 22) game._statusTruncCol = Math.max(0, bandStart - 1);
    // C ref: erase_menu_or_text() -> docorner(offx, cw->maxrow + 1) with
    // maxrow == nitems + 1: the cl_end() sweep runs over rows 0..nitems, so a
    // menu with 21 entries (footer on row 21) already wrecks row 22's tail even
    // though its own content stops above the status window.  Row 23 survives
    // until the menu is one line taller (the case above).
    else if (bandStart != null && menuLastRow >= 21) game._statusTrunc22 = Math.max(0, bandStart - 1);
}

// C ref: invent.c display_pickinv():3146 `if (!flags.invlet_constant)
// reassign();` — with 'nofixinv' every inventory listing re-letters the pack
// in list order before it is shown.
function reassign_if_nofixinv() {
    if (flags().invlet_constant === false && inventoryArray().length) reassign();
}

function inventoryRows(lets = null, ofilter = null) {
    reassign_if_nofixinv();
    // There used to be a touristFallbackRows() short-circuit here returning a
    // VERBATIM memorised inventory listing (exact letters, "27 +2 darts", "an
    // expensive camera (0:34)") whenever rank === 'Rambler' && gold === 757 —
    // the seed8000 Tourist's fingerprint.  invent.c display_pickinv() has no
    // role/rank/gold special case; it always walks gi.invent through doname().
    // The literal was worth points on one public session and nothing anywhere
    // else, while hiding every real doname()/inv_order bug for that role.

    const rows = [];
    const sortflags = (flags().sortloot === 'f' ? SORTLOOT_LOOT : SORTLOOT_INVLET)
        | (flags().sortpack !== false ? SORTLOOT_PACK : 0);
    // C sorts the whole pack before filtering displayed inventory letters.
    const inv = sortloot(inventoryArray(), sortflags).map((entry) => entry.obj)
        .filter((obj) => obj && (!lets || String(lets).includes(obj.invlet))
            && (!ofilter || ofilter(obj)));
    if (!inv.length) return [];
    // C ref: invent.c display_pickinv() — iterate flags.inv_order (def_inv_order,
    // which already leads with COIN_CLASS) exactly once per class.  classOrder()
    // already begins with COIN_CLASS, so it must NOT be prepended again or gold
    // renders twice ("Coins / $ - N gold pieces" duplicated).
    // C ref: invent.c:3273/3290 — without flags.sortpack there is no class
    // heading and the items stay in plain invlet order.
    if (flags().sortpack === false) {
        const group = [null];
        group.syms = [null];
        for (const obj of inv) {
            obj_to_glyph(obj);
            group.push(`${obj.invlet || obj_to_let(obj)} - ${doname_invent(obj)}`);
            const og = object_glyph(obj);
            group.syms.push(og ? { ch: og.ch, color: og.color } : null);
        }
        rows.push(group);
        return rows;
    }
    const order = classOrder();
    for (const oclass of order) {
        const items = inv.filter((obj) => obj.oclass === oclass);
        if (!items.length) continue;
        rows.push([let_to_name(oclass, false, false), ...items.map((obj) => {
            // C's display_pickinv() always generates the menu glyph before
            // formatting an item.  The tty window does not render it, but the
            // hallucination arm advances the independent display RNG.
            obj_to_glyph(obj);
            const letter = obj.invlet || obj_to_let(obj);
            return `${letter} - ${doname_invent(obj)}`;
        })]);
    }
    return rows;
}

// C ref: invent.c:62 inuse_headers[] — "menu heading lines used instead of
// object classes when sorting by in-use"; indexed by Loot.orderclass, which
// inuse_classify() numbers 4 (accessories) first down to 1 (miscellaneous).
// Entry [4] is what dispinv_with_action()'s alt_label temporarily replaces.
const INUSE_HEADERS = ['', 'Miscellaneous', 'Worn Armor',
                       'Wielded/Readied Weapons', 'Accessories'];

// C ref: invent.c display_pickinv() with flags.sortloot == 'i' (set by
// dispinv_with_action's use_inuse_ordering): sortpack off, SORTLOOT_INUSE,
// filter is_inuse, an "Inventory in use" heading before the first surviving
// item, then a heading whenever orderclass changes.  sortloot() only classifies
// during the qsort, so a single in-use item keeps orderclass 0 and gets NO
// class heading — that C quirk is reproduced by reading sli.orderclass as-is.
function inuseRows(lets = null, altLabel = null) {
    reassign_if_nofixinv();
    const headers = INUSE_HEADERS.slice();
    if (altLabel) headers[4] = altLabel;
    // C invent.c:3195 — nothing wielded: a fake STRANGE_OBJECT carrying W_WEP
    // is spliced to the HEAD of invent so it sorts into the primary weapon
    // slot, formatted "bare|gloved hands (no weapon)" (:3307), and dropped
    // again if it would be sortedinvent's only entry (:3216).
    const list = [...inventoryArray()];
    let fake = null;
    if (!game.uwep) {
        fake = { otyp: 0, oclass: ILLOBJ_CLASS, invlet: HANDS_SYM,
                 owornmask: W_WEP, where: OBJ_INVENT, quan: 1 };
        list.unshift(fake);
    }
    const sorted = sortloot(list, SORTLOOT_INUSE, false, is_inuse);
    if (fake && sorted[0]?.obj === fake && !sorted[1]?.obj) return [];
    const rows = [];
    let cur = null, prevorderclass = 0, inusecount = 0;
    for (const sli of sorted) {
        const obj = sli.obj;
        if (!obj) continue;
        if (lets && !String(lets).includes(obj.invlet)) continue;
        if (!inusecount++) { cur = ['Inventory in use']; rows.push(cur); }
        if (sli.orderclass !== prevorderclass) {
            cur = [headers[sli.orderclass] || ''];
            rows.push(cur);
            prevorderclass = sli.orderclass;
        }
        const text = (obj === fake)
            ? `${game.uarmg ? 'gloved' : 'bare'} ${makeplural(body_part(6 /*HAND*/))} (no weapon)`
            : doname_invent(obj);
        cur.push(`${obj.invlet || obj_to_let(obj)} - ${text}`);
    }
    return rows;
}

// C ref: wintty.c:1383 process_menu_window() — show_obj_syms = use_menu_glyphs
// (menuobjsyms defaults to 4, "conditional": only when the menu has no
// non-selectable line, i.e. no headings); the glyph's tty char replaces the
// '-' (index 2) of "x - name" (wintty.c:1470).
function objSymsShown(rows) {
    const osyms = game.iflags?.menuobjsyms ?? 4;
    const use = game.iflags?.use_menu_glyphs ?? true;
    if (!use) return false;
    return !(osyms & 4) || rows.every((g) => g[0] == null);
}

function renderMenuScreen(lines, cursor = [36, 8]) {
    // C ref: windows.c:1816 add_menu_heading() — `if (program_state.gameover)
    // attr = ATR_NONE`, so the end-of-game disclosure lists draw class headers
    // PLAIN.
    const headAttr = game.program_state?.gameover ? 0 : (menuHeadAttr());
    const flat = [];
    const syms = objSymsShown(lines);
    for (const group of lines) {
        const [heading, ...items] = group;
        if (heading != null) flat.push({ text: heading, attr: headAttr });
        items.forEach((item, i) => {
            const sym = syms && group.syms?.[i + 1];
            flat.push({ text: sym ? item.slice(0, 2) + sym.ch + item.slice(3) : item, attr: 0,
                        symColor: sym ? sym.color : undefined });
        });
    }
    renderMenuLines(flat, cursor);
}

// C ref: windows.c add_menu()/get_menu_coloring() — when the `menucolors`
// option is on, every non-heading menu item's text (without tty's "x - "
// selector prefix) is matched against the MENUCOLOR= patterns, newest first,
// and the first hit recolors the whole item.  Returns a bodyStyle or null.
function menuColorStyle(line) {
    if (line.attr || !game.flags?.menucolors || !game.menucolors?.length)
        return null;
    const m = /^(\S) [-+#] /.exec(line.text);
    const str = m ? line.text.slice(4) : line.text;
    const rule = game.menucolors.find((r) => r.regex.test(str));
    if (!rule) return null;
    const attr = rule.attr === 1 ? ATR_BOLD : rule.attr === 4 ? ATR_UNDERLINE
        : rule.attr === 6 ? ATR_INVERSE : 0;
    return { color: rule.color === CLR_GRAY ? NO_COLOR : rule.color, attr, whole: !m };
}

// C ref: wintty.c:1478 — the object glyph char replacing the '-' is drawn in
// the glyph's own color (CLR_GRAY is suppressed to the default by has_color()).
function paintMenuLine(display, x, y, line, isMenu = false) {
    paintMenuLineBody(display, x, y, line, isMenu);
    if (line.symColor !== undefined)
        display.setCell(x + 2, y, line.text[2],
                        (line.symColor === CLR_GRAY || line.symColor === 0) ? NO_COLOR : line.symColor, 0);
}

function paintMenuLineBody(display, x, y, line, isMenu = false) {
    const mc = isMenu && !line.bodyStyle ? menuColorStyle(line) : null;
    if (mc) {
        if (mc.whole) {
            display.putstr(x, y, line.text, mc.color, mc.attr);
        } else {
            display.putstr(x, y, line.text.slice(0, 4), NO_COLOR, 0);
            display.putstr(x + 4, y, line.text.slice(4), mc.color, mc.attr);
        }
        return;
    }
    if (!line.bodyStyle) {
        display.putstr(x, y, line.text, NO_COLOR, line.attr || 0);
        if (line.attr) {
            // Tty screen serialization skips long blank runs without attributes.
            for (const run of line.text.matchAll(/ {5,}/g))
                for (let i = run.index; i < run.index + run[0].length; i++)
                    display.setCell(x + i, y, ' ', NO_COLOR, 0);
        }
        return;
    }
    display.putstr(x, y, line.text.slice(0, 4), NO_COLOR, 0);
    display.putstr(x + 4, y, line.text.slice(4),
        line.bodyStyle.color, line.bodyStyle.attr);
    if (line.text[2] === '+' || line.text[2] === '#')
        display.putstr(x + 2, y, line.text[2],
            line.bodyStyle.color, line.bodyStyle.attr);
}

// The body of renderMenuScreen, over a FLAT list of { text, attr } lines — for
// menus whose leading lines are add_menu_str()s (ATR_NONE) rather than
// add_menu_heading()s (e.g. #wizidentify's "Debug Identify" title).
export function renderMenuLines(flat, cursor = [36, 8]) {
    const display = game.nhDisplay;
    if (!display?.clearScreen) return;
    // C ref: win/tty/wintty.c tty_display_nhwindow(): an automatic
    // end-of-game inventory menu is drawn over the existing tty display.
    // Repainting its map would replace surviving DEC glyphs and erase the
    // prior quit/death message in columns left of the menu window.
    if (!game._disclose_inventory_auto) {
        display.clearScreen();
        render_map_to_grid();
    }
    const cols = display.cols ?? 80;
    const rows = display.rows ?? 24;
    // C ref: wintty.c:2729-2733 tty_end_menu() — "cut off any lines that are too
    // long": len = strlen(str) + 2; if (len > cols) str[cols - 2] = 0.
    flat = flat.map((ln) => (ln.text.length > cols - 2
        ? { ...ln, text: ln.text.slice(0, cols - 2) } : ln));
    let widest = 0;
    for (const ln of flat) if (ln.text.length > widest) widest = ln.text.length;
    // C ref: win/tty/wintty.c tty_end_menu() cw->cols (wintty.c:2762):
    // maxcol = max(widest+2, strlen("(end) ")==6). tty_display_nhwindow()'s
    // H2344_BROKEN branch (wintty.c:13, defined in the recorder's build):
    // offx = min(min(82, cols/2), cols-maxcol-1), floored at 0, text drawn at
    // offx+1 (tty_curs adds cw->offx). This CAPS offx at cols/2 rather than
    // flooring at 10 — the old max(10,...) #else form pushed narrow menus too
    // far right (a 20-wide pickup menu landed at column 58, not 41).
    const maxcol = Math.max(6, widest + 2);
    let col = Math.max(0, Math.min(Math.min(82, Math.floor(cols / 2)),
                                   cols - maxcol - 1)) + 1;
    // C ref: win/tty/wintty.c tty_display_nhwindow — offx is forced back to 0
    // (full-screen) when cw->maxrow (== nitems+1: one entry per heading/item,
    // plus the "(end)" line) reaches the screen height; a menu that tall can't
    // float as a partial overlay, so it takes over the whole screen (offx=0,
    // text at offx+1 == col 1) instead of the computed floating position.
    const nitems = flat.length;
    const maxrow = nitems + 1;
    if (maxrow >= rows) col = 1;
    // C ref: the menu window is a rectangle [col-1..cols) x [0..endRow]; it is
    // cleared (the map shows only OUTSIDE it), so blank that column band for
    // every menu row before drawing the (possibly short) menu lines on top.
    // The window's left edge is the C offx (== col-1): process_menu_window
    // draws a leading space there and the text at offx+1 (== col), so col-1 must
    // be blanked too or a map glyph beneath it shows through the leading space.
    const bandStart = Math.max(0, col - 1);
    // C ref: wintty.c:1409 process_menu_window(): `if (!cw->offx) term_clear_screen()`
    // -- a full-width menu wipes the whole screen even over the end-of-game
    // overlay, which the skipped clearScreen() above would otherwise leave.
    if (bandStart === 0) display.clearScreen();
    // C ref: win/tty/wintty.c erase_menu_or_text(): tearing this window down
    // runs docorner() (a pure row_refresh replay of the glyph buffer) when
    // offx != 0 and the far heavier docrt() only when offx == 0.  Remember
    // which one applies -- docrt() re-runs vision_recalc()+see_monsters(),
    // which re-rolls every hallucinated glyph off the display RNG.
    game._menuOffx = bandStart;
    const totalRows = nitems + 1; // +1 for (end)
    const menuLastRow = totalRows - 1; // row the "(end)" line lands on
    for (let r = 0; r <= menuLastRow && r < 24; r++)
        for (let c = bandStart; c < cols; c++)
            display.setCell(c, r, ' ', NO_COLOR, 0);
    let row = 0;
    for (const ln of flat)
        paintMenuLine(display, col, row++, ln, true);
    const endRow = row;
    display.putstr(col, row++, '(end)', NO_COLOR);
    putStatusLines(display, bandStart, menuLastRow);
    // C ref: wintty.c erase_menu_or_text() -> docorner(offx, maxrow + 1): the
    // dismissal cl_end() reaches one row past "(end)".  A window opened before
    // the next full redraw sees the status row cut from this menu's left edge.
    game._menuDismissSweep = (menuLastRow + 1 >= 22)
        ? { col: Math.max(0, bandStart - 1), lastRow: menuLastRow + 1 } : null;
    // C ref: tty parks the cursor just past the "(end)" prompt (offx + len + 1).
    const curCol = (cursor && cursor[0] != null) ? cursor[0] : col + '(end)'.length + 1;
    const curRow = (cursor && cursor[1] != null) ? cursor[1] : endRow;
    display.setCursor(curCol, curRow);
    game._modal_screen = 'invent';
}

// C ref: win/tty/wintty.c tty_display_nhwindow() + process_text_window() for a
// NHW_MENU window filled with putstr() (no menu items), e.g. ^P's "Message
// History".  tty_putstr() records maxcol = widest line + 1; the
// H2344_BROKEN offx (defined in the recorder build) is
// min(min(82, cols/2), cols - maxcol - 1), and a window as tall as the screen
// (maxrow >= rows) is full-screen (offx 0).  An overlay draws a blank at offx
// and each line at offx+1 after cl_end() from offx, then the "--More--"
// prompt (dmore offset 2 for NHW_MENU) on the row after the last line.  Only
// space/return/ESC leave the window; ESC cancels all remaining pages.
export async function tty_text_window(lines) {
    const display = game.nhDisplay;
    if (!display?.clearScreen) return;
    const cols = display.cols ?? 80;
    const rows = display.rows ?? 24;
    let widest = 0;
    for (const t of lines) if (t.length > widest) widest = t.length;
    let offx = Math.max(0, Math.min(Math.min(82, Math.floor(cols / 2)),
                                    cols - (widest + 1) - 1));
    if (lines.length >= rows) offx = 0;
    game._pending_message = '';
    const waitquit = async () => {
        for (;;) {
            const c = await nhgetch();
            if (c === 27) return false;
            if (c === 32 || c === 13 || c === 10) return true;
            /* xwaitforspace(): anything else rings the bell and waits on */
        }
    };
    // C ref: wintty.c:1924 — a short menu overlays even when its offx is zero.
    if (lines.length < rows && game.iflags?.menu_overlay !== false) {
        const carriedTrunc = game._statusTruncCol;
        display.clearScreen();
        render_map_to_grid();
        game._menuOffx = offx;
        const lastRow = lines.length;          /* the --More-- row */
        for (let r = 0; r <= lastRow && r < rows; r++)
            for (let c = offx; c < cols; c++)
                display.setCell(c, r, ' ', NO_COLOR, 0);
        let row = 0;
        for (const t of lines)
            display.putstr(offx ? offx + 1 : 0, row++,
                t.slice(0, cols - 1 - (offx ? offx + 1 : 0)), NO_COLOR, 0);
        putStatusLines(display, offx, lastRow);
        if (carriedTrunc != null) {
            for (let row = 22; row < rows; row++)
                for (let col = carriedTrunc; col < offx; col++)
                    display.setCell(col, row, ' ', NO_COLOR, 0);
            game._statusTruncCol = Math.min(carriedTrunc,
                game._statusTruncCol ?? carriedTrunc);
        }
        display.putstr(offx + 1, lastRow, '--More--', NO_COLOR, 0);
        display.setCursor(offx + 1 + '--More--'.length, lastRow);
        game._modal_screen = 'invent';
        await waitquit();
        await dismiss_invent_screen();
        return;
    }
    game._menuOffx = 0;
    const perPage = rows - 1;
    for (let i = 0; i < lines.length; i += perPage) {
        const page = lines.slice(i, i + perPage);
        const last = i + perPage >= lines.length;
        renderWindowScreen(page.map((text) => ({ text })), {
            menu: false, footer: '--More--', footerCol: 1,
            footerRow: last ? page.length : rows - 1, modal: 'textwin',
        });
        if (!(await waitquit())) break;
    }
    // Full-width history dismissal uses docrt(), leaving WIN_STATUS cleared.
    game._statusTruncCol = 0;
    await dismiss_invent_screen();
}

// C ref: win/tty/wintty.c process_menu_window(). Used by command and spell
// menus, with page-local automatic selectors and counted PICK_ANY selections.
export async function select_command_menu(entries, { how = PICK_ANY, blankStatus = false } = {}) {
    const rows = game.nhDisplay?.rows ?? 24;
    const lmax = Math.min(52, rows - 1);
    const npages = Math.ceil(entries.length / lmax) || 1;
    for (let i = 0; i < entries.length; i++) {
        if (i % lmax === 0) var acc = 97;                              // 'a'
        if (entries[i].item) {
            // C tty_add_menu() initializes every item's count to -1.
            entries[i].item.count ??= -1;
            if (!entries[i].item.sel) {
                entries[i].item.sel = String.fromCharCode(acc);
                acc = (acc === 122) ? 65 : acc + 1;
            }
        }
    }
    // C ref: wintty.c:1352-1377 — PICK_ONE accepts only unambiguous
    // group accelerators; PICK_ANY can toggle a whole group across pages.
    const groupCounts = new Map();
    for (const { item } of entries) {
        if (item?.gsel && item.gsel !== item.sel)
            groupCounts.set(item.gsel, (groupCounts.get(item.gsel) || 0) + 1);
    }
    const groupAccels = new Set();
    if (how !== PICK_NONE) {
        for (const { item } of entries) {
            if (item?.gsel && (item.gsel !== item.sel || item.gsel === GOLD_SYM)
                && (how === PICK_ANY || groupCounts.get(item.gsel) === 1))
                groupAccels.add(item.gsel);
        }
    }
    let page = 0;
    let count = 0;
    let counting = false;
    let searchBlankTop = false;
    let paintedPage = -1;
    for (;;) {
        const pageEntries = entries.slice(page * lmax, (page + 1) * lmax);
        if (paintedPage !== page) {
            searchBlankTop = false;
            for (const e of pageEntries) if (e.item) e.item._state = undefined;
        }
        paintedPage = page;
        const lines = pageEntries.map((e) => {
            if (e.item) menu_note_paint(e.item);
            return {
                text: e.item ? `${e.item.sel} ${e.item._shown} ${e.text}` : e.text,
                attr: e.attr,
                bodyStyle: e.bodyStyle,
            };
        });
        if (npages > 1) {
            game._menuOffx = 0;
            renderWindowScreen(lines, {
                menu: true,
                footer: `(${page + 1} of ${npages})`,
                footerRow: pageEntries.length,
                footerCol: 1,
                modal: 'commandmenu',
            });
        } else {
            renderMenuLines(lines, null);
        }
        if (blankStatus) {
            // Status suppression must not erase menu rows or its footer.
            for (let y = Math.max(22, pageEntries.length + 1); y < 24; y++)
                for (let x = 0; x < game.nhDisplay.cols; x++)
                    game.nhDisplay.setCell(x, y, ' ', NO_COLOR, 0);
        }
        if (searchBlankTop) {
            for (let x = 0; x < game.nhDisplay.cols; x++)
                game.nhDisplay.setCell(x, 0, ' ', NO_COLOR, 0);
        }
        const c = await nhgetch();
        const ch = String.fromCharCode(c);
        const hit = pageEntries.find((e) => e.item && e.item.sel === ch);
        // Numeric groups take precedence over starting a count (wintty.c:1577).
        if (groupAccels.has(ch) && (!counting || ch < '0' || ch > '9')) {
            for (const { item } of entries) {
                if (item?.gsel !== ch) continue;
                item.selected = !item.selected;
                item.count = item.selected && counting ? count : -1;
            }
            count = 0;
            counting = false;
            if (how === PICK_ONE) return true;
            continue;
        }
        if (ch >= '0' && ch <= '9') {
            count = count * 10 + (c - 48);
            counting = count > 0;
            continue;
        }
        if (hit) {
            if (how === PICK_NONE) continue;
            hit.item.selected = counting ? count > 0 : !hit.item.selected;
            hit.item.count = counting ? count : -1;
            count = 0;
            counting = false;
            if (how === PICK_ONE) return true;
            continue;
        }
        if (c === 27 && counting) {
            count = 0;
            counting = false;
            continue;
        }
        if (c === 27) return false;                                    // cancel
        // xwaitforspace rejects unknown keys without ending a numeric count.
        if (c !== 13 && c !== 10 && !' ><^|:,.\\~-@'.includes(ch)) continue;
        count = 0;
        counting = false;
        if (c === 13 || c === 10) return true;                         // commit
        if (ch === ' ' || ch === '>') {
            if (page < npages - 1) page++;
            else if (ch === ' ') return true;   // ' ' finishes, '>' does not
            continue;
        }
        if (ch === '<') { if (page > 0) page--; continue; }
        if (ch === '^') { page = 0; continue; }
        if (ch === '|') { page = npages - 1; continue; }
        if (ch === ':' && how !== PICK_NONE) {
            const { hooked_tty_getlin, pmatchi } = await import('./extcmd-handlers.js');
            const reply = await hooked_tty_getlin('Search for:', null);
            // tty_getlin erases its query row. Item toggles do not repaint
            // the menu heading until navigation actually changes the page.
            searchBlankTop = true;
            if (!reply || reply[0] === '\x1b') continue;
            for (const e of entries) {
                if (!e.item || !pmatchi(`*${reply}*`, `${e.item.sel} - ${e.text}`)) continue;
                e.item.selected = !e.item.selected;
                e.item.count = -1;
                if (how === PICK_ONE) return true;
            }
            continue;
        }
        if (how !== PICK_NONE && [',', '\\', '~', '.', '-', '@'].includes(ch)) {
            if (how === PICK_ONE && [',', '~', '.', '@'].includes(ch)) continue;
            const scope = [',', '\\', '~'].includes(ch) ? pageEntries : entries;
            for (const e of scope) {
                if (!e.item) continue;
                e.item.selected = ch === ',' || ch === '.' ? true
                    : ch === '\\' || ch === '-' ? false : !e.item.selected;
                if (!e.item.selected) e.item.count = -1;
            }
            continue;
        }
        // Any other key rings the bell and leaves the page up.
    }
}

// C ref: win/tty/wintty.c process_menu_window() — a menu whose entries don't
// fit on one page is a FULL-SCREEN window (tty_end_menu sets maxrow = lmax+1 ==
// ttyDisplay->rows, which forces offx back to 0), drawn one page at a time with
// a "(N of M)" morestr on the row right after the page's own content.
//   lines : every menu line, { text, attr }; this picks out `page`'s slice
//   lmax  : entries per page (min(52, rows-1))
export function renderPagedMenu(lines, page, npages, lmax) {
    const display = game.nhDisplay;
    if (!display?.clearScreen) return;
    const curPage = Math.max(0, Math.min(page, npages - 1));
    const pageLines = lines.slice(curPage * lmax, curPage * lmax + lmax);
    // A full-screen menu's dismissal runs docrt(), which blanks the status
    // window; a floating overlay's docorner() leaves it intact.
    game._botl_blanked = true;
    game._menuDismissSweep = null;
    display.clearScreen();
    let row = 0;
    for (const ln of pageLines) {
        // The leading pad column is an unconditional plain putchar(' '), so a
        // heading's ATR_INVERSE never covers it.
        display.putstr(0, row, ' ', NO_COLOR, 0);
        display.putstr(1, row, ln.text, NO_COLOR, ln.attr || 0);
        row++;
    }
    const footer = `(${curPage + 1} of ${npages})`;
    display.putstr(1, pageLines.length, footer, NO_COLOR, 0);
    display.setCursor(1 + footer.length, pageLines.length);
    game._modal_screen = 'invent';
}

// Render a full-screen tty window (NHW_TEXT / multi-page NHW_MENU) directly
// to the 24x80 grid.  C ref: win/tty/wintty.c process_text_window() /
// process_menu_window().  Full-screen windows (offx == 0) clear the whole
// screen (status lines are NOT kept underneath, unlike the centered menu in
// renderMenuScreen).
//
//   lines    : array of { text, attr } (attr defaults to ATR_NONE; headers
//              use ATR_INVERSE).  Already include their own leading spaces.
//   opts.menu: true -> menu layout (prepend a space at col 0, text at col 1);
//              false -> text layout (text at col 0).
//   opts.footer    : the morestr ("--More--", "(1 of 2)", "(end)", ...).
//   opts.footerRow : grid row for the footer.  For a text window the C code
//              parks the final "--More--" at rows-1 (row 23); for a paged
//              menu it sits on the row right after the page's content.
//   opts.footerCol : starting column of the footer (0 for text "--More--",
//              1 for the menu "(N of M)" which dmore indents by one).
const ATR_NONE = 0;

export function renderWindowScreen(lines, opts = {}) {
    const display = game.nhDisplay;
    if (!display?.clearScreen) return;
    const menu = !!opts.menu;
    const textCol = menu ? 1 : 0;
    // C ref: win/tty/wintty.c process_menu_window()/process_text_window() — the
    // per-line output loop advances with `++ttyDisplay->curx < ttyDisplay->cols`,
    // so it stops before the final terminal column: a menu/text window never
    // writes the last column (cols-1), truncating any line that would reach it.
    const cols = display.cols ?? 80;
    const maxLen = (cols - 1) - textCol;
    // A full-screen window has offx == 0, so erase_menu_or_text() tears it
    // down with docrt() rather than docorner() (see renderMenuLines above).
    game._menuOffx = 0;
    display.clearScreen();
    let row = 0;
    for (const ln of lines) {
        let text = typeof ln === 'string' ? ln : (ln.text || '');
        if (maxLen >= 0 && text.length > maxLen) text = text.slice(0, maxLen);
        const attr = typeof ln === 'string' ? ATR_NONE : (ln.attr || ATR_NONE);
        paintMenuLine(display, textCol, row++, { ...ln, text, attr }, menu);
    }
    const footer = opts.footer || '--More--';
    const footerRow = opts.footerRow != null ? opts.footerRow
        : (display.rows ?? 24) - 1;
    const footerCol = opts.footerCol != null ? opts.footerCol : 0;
    // C dmore() only highlights the morestr when flags.standout is set, which
    // is off by default, so "--More--"/"(N of M)"/"(end)" render plain.
    display.putstr(footerCol, footerRow, footer, NO_COLOR, ATR_NONE);
    display.setCursor(footerCol + footer.length, footerRow);
    game._modal_screen = opts.modal || 'textwin';
}

// C ref: o_init.c dodiscovered() — list discovered objects by class, in a
// full-screen NHW_TEXT window with a "--More--" footer.  The discovery state
// (objects[].oc_name_known / oc_encountered, plus the Samurai's pre-discovered
// Japanese items) is built in o_init.js::build_discoveries_rows.
function discoveriesRows() {
    const classRows = build_discoveries_rows(disp_artifact_discoveries().rows);
    if (!classRows) return null;
    const rows = [
        { text: 'Discoveries, by order of discovery within each class' },
        { text: '' },
    ];
    for (const r of classRows)
        rows.push(r.header ? { text: r.text, attr: menuHeadAttr() }
                           : { text: r.text });
    return rows;
}

export async function dodiscovered() {
    const rows = discoveriesRows();
    if (!rows) {
        game._pending_message = note_topl('You haven\'t discovered anything yet.');
        return ECMD_OK;
    }
    // C ref: tty process_text_window() paging — a full-screen text window fits
    // (rows-1) content lines per page (row 23 holds the morestr); when more
    // content remains the footer is "--More--", else "(end)".
    const totalRows = (game.nhDisplay?.rows ?? 24);
    const perPage = totalRows - 1; // 23 content lines, footer on the last row
    const pages = [];
    for (let i = 0; i < rows.length; i += perPage)
        pages.push(rows.slice(i, i + perPage));
    game._disco_pages = pages;
    game._disco_page = 0;
    renderDiscoveriesPage();
    // `display_nhwindow(tmpwin, TRUE)` owns the text-window input in C.
    // Returning to the command loop here runs its once-per-input hallucination
    // redraw while the window is still open, advancing the display RNG too
    // early.  Keep the command blocked until the window is dismissed.
    for (;;) {
        const c = await nhgetch();
        if (c === 27) {
            await dismiss_invent_screen();
            return ECMD_OK;
        }
        if (c === 32 || c === 13 || c === 10) {
            await disco_window_advance();
            if (game._modal_screen !== 'textwin') return ECMD_OK;
        }
    }
}

function renderDiscoveriesPage() {
    const pages = game._disco_pages || [];
    const idx = game._disco_page || 0;
    const page = pages[idx] || [];
    renderWindowScreen(page, {
        menu: false,
        footer: '--More--',
        footerRow: (game.nhDisplay?.rows ?? 24) - 1,
        footerCol: 0,
        modal: 'textwin',
    });
}

// Advance the paged discoveries window.  Returns true if a window was active
// and consumed the key.  C ref: process_text_window() page navigation.
export async function disco_window_advance() {
    if (game._modal_screen !== 'textwin' || !game._disco_pages) return false;
    const pages = game._disco_pages || [];
    const idx = (game._disco_page || 0) + 1;
    if (idx < pages.length) {
        game._disco_page = idx;
        renderDiscoveriesPage();
        return true;
    }
    delete game._disco_pages;
    delete game._disco_page;
    await dismiss_invent_screen();
    return true;
}

// C ref: insight.c enlightenment()/doattributes() — the ^X attributes display.
// In-game (final==0) it is a paged NHW_MENU; each page clears the screen and
// shows "(N of M)" at the bottom.
//
// A memorised seed8000 Tourist ^X screen (38 literal lines, keyed on the same
// rank==='Rambler' && gold===757 fingerprint as the inventory listing) lived
// here; removed since C builds every line from live u.*/flags state (no
// per-role literal block) — handedness from game.u.uleft_handed (chargen's
// rn2(10)), bare-handed phrasing from js/uhitm.js's per-role table. Fix wrong
// lines in enlightenment_lines(), which transfers to every role/session,
// unlike a literal.
function attributesPages() {
    const lines = enlightenment_lines();
    if (!lines || !lines.length) return null;
    const lmax = (game.nhDisplay?.rows ?? 24) - 1; // 23 lines/page (menu paging)
    const pages = [];
    for (let i = 0; i < lines.length; i += lmax)
        pages.push(lines.slice(i, i + lmax));
    return pages;
}

function renderAttributesPage() {
    const pages = game._attr_pages;
    if (!pages) return;
    const idx = game._attr_page || 0;
    const page = pages[idx];
    const footer = `(${idx + 1} of ${pages.length})`;
    renderWindowScreen(page.map((t) => ({ text: t })), {
        menu: true,
        footer,
        footerRow: page.length,
        footerCol: 1,
        modal: 'attrwin',
    });
}

export async function doattributes() {
    const pages = attributesPages();
    if (!pages) {
        game._pending_message = note_topl('You feel very knowledgeable.');
        return ECMD_OK;
    }
    game._attr_pages = pages;
    game._attr_page = 0;
    renderAttributesPage();
    // C's select_menu(PICK_NONE) owns all ^X page-navigation input.  Returning
    // to moveloop_core between pages would run its hallucination redraw before
    // the next menu key, advancing the display PRNG when C is still blocked in
    // wintty's process_menu_window().
    // C ref: wintty.c:1393-1399 / 1563-1615 — digits build a count, ESC while
    // counting only stops it; xwaitforspace() swallows keys outside resp.
    const ATTR_RESP = ' 0123456789\x1b\n\r^|><.-@,\\~:';
    let counting = false, count = 0, reset_count = true;
    for (;;) {
        if (reset_count) { counting = false; count = 0; } else reset_count = true;
        let key;
        do key = String.fromCharCode(await nhgetch());
        while (!ATTR_RESP.includes(key));
        if (key >= '0' && key <= '9') {
            count = count * 10 + (key.charCodeAt(0) - 48);
            if (count !== 0) { counting = true; reset_count = false; }
            continue;
        }
        if (key === '\x1b' && counting) continue;
        await attr_window_advance(key);
        if (game._modal_screen !== 'attrwin') return ECMD_OK;
    }
}

// Advance the paged attributes window.  Returns true if a window was active
// and consumed the key (advanced a page or dismissed); false otherwise.
// C ref: process_menu_window() page navigation (space/'>' -> next page).
export async function attr_window_advance(key) {
    if (game._modal_screen !== 'attrwin') return false;
    const pages = game._attr_pages || [];
    const cur = game._attr_page || 0;
    const onLast = cur >= pages.length - 1;
    // C ref: wintty.c process_menu_window(), PICK_NONE (insight.c builds this
    // as an NHW_MENU).  Only the page/finish keys act; every other key is
    // tty_nhbell() with the window left up unchanged.
    if (key === '<') {                              // MENU_PREVIOUS_PAGE
        if (cur > 0) game._attr_page = cur - 1;
        renderAttributesPage();
        return true;
    }
    if (key === '^' || key === '|') {               // MENU_FIRST_PAGE / MENU_LAST_PAGE
        game._attr_page = key === '^' ? 0 : Math.max(0, pages.length - 1);
        renderAttributesPage();
        return true;
    }
    if (key === '>' || key === ' ') {               // MENU_NEXT_PAGE / space
        if (!onLast) { game._attr_page = cur + 1; renderAttributesPage(); return true; }
        // '>' on the last page redisplays; only space and return finish.
        if (key === '>') { renderAttributesPage(); return true; }
    } else if (key !== undefined && key !== '\n' && key !== '\r' && key !== '\x1b') {
        renderAttributesPage();                     // bell; window unchanged
        return true;
    }
    delete game._attr_pages;
    delete game._attr_page;
    await dismiss_invent_screen();
    return true;
}

export async function dovspell() {
    // C ref: spell.c dovspell() — view the known-spell list (the '+' command).
    const display = game.nhDisplay;
    const spell = await import('./spell.js');
    const nspells = spell.num_spells();
    if (!nspells || !display?.setCell) {
        // C ref: spell.c dovspell() — with no known spells it just prints the
        // topline message (an ordinary pline, NOT a blocking/modal window) and
        // returns ECMD_OK; the following keypress is handled as a normal
        // command (so a trailing <space> yields "Unknown command ' '.").
        await pline('You don\'t know any spells right now.');
        return ECMD_OK;
    }
    let swapIndex = -1;
    for (;;) {
    // C ref: wintty.c erase_menu_or_text() — remove the previous (possibly
    // wider) sort menu before painting the view menu on the map.
    display.clearScreen();
    render_map_to_grid();

    // C ref: spell.c dospellmenu(SPELLMENU_VIEW) — build the menu lines.  In
    // wizard mode an extra "turns" column shows raw sp_know (spellknow).
    const book = game.spl_book;
    const wiz = !!game.flags?.debug;
    const meta = {
        name: (i) => objects[spell.spellid_at(i)]?.name || '',
        category: (i) => spell.spelltypemnemonic(spell.spellid_at(i)),
        fail: (i) => 100 - spell.percent_success_at(i),
        retention: (i) => spell.spellretention_at(i),
        know: (i) => spell.spellknow_at(i),
    };
    // Header: "    %-20s Level %-12s Fail Retention" (+ " %6s" "turns" in wizmode).
    let header = '    ' + padEnd('Name', 20) + ' Level ' + padEnd('Category', 12)
        + ' Fail Retention';
    if (wiz) header += ' ' + padStart('turns', 6);
    // Row fmt: "%-20s  %2d   %-12s %3d%% %9s" (+ " %6d" sp_know in wizmode).
    const rows = [];
    const order = game.spl_orderindx;
    for (let i = 0; i < nspells; i++) {
        const slot = order ? order[i] : i;
        let buf = padEnd(meta.name(slot), 20) + '  ' + padStart(String(book[slot].sp_lev), 2)
            + '   ' + padEnd(meta.category(slot), 12) + ' ' + padStart(`${meta.fail(slot)}%`, 4)
            + ' ' + padStart(meta.retention(slot), 9);
        if (wiz) buf += ' ' + padStart(String(meta.know(i)), 6);
        rows.push(buf);
    }
    const selector = (i) => (i < 26 ? String.fromCharCode(97 + i)
        : String.fromCharCode(65 + i - 26)) + ' - ';
    const itemLines = rows.map((r, i) => {
        const slot = order ? order[i] : i;
        return (slot === swapIndex ? selector(slot).replace(' - ', ' * ') : selector(slot)) + r;
    });
    // C ref: spell.c dospellmenu — only SPELLMENU_VIEW offers sorting.
    const multi = nspells > 1 && swapIndex < 0;
    if (multi) itemLines.push('+ - [sort spells]');
    const prompt = swapIndex < 0 ? 'Currently known spells'
        : `Reordering spells; swap '${String.fromCharCode(swapIndex < 26 ? 97 + swapIndex : 65 + swapIndex - 26)}' with`;

    // C ref: win/tty/wintty.c — offx = max(10, cols - maxcol - 1), maxcol =
    // widest (strlen + 2), cols == 81 (matches recorded placement).
    const allLines = [header, ...itemLines, prompt];
    let maxcol = 0;
    for (const ln of allLines) maxcol = Math.max(maxcol, ln.length + 2);
    if (maxcol > 80) maxcol = 80;
    let offx = Math.max(10, 81 - maxcol - 1);
    if (offx === 10) offx = 0;

    const draw = (text, row, attr) => {
        for (let c = 0; c < text.length && offx + c < 80; c++)
            display.setCell(offx + c, row, text[c], NO_COLOR, attr);
    };
    // C ref: win/tty/wintty.c — a menu heading is shown with ATR_INVERSE.  The
    // recorder serializes space-runs longer than 4 columns as cursor-forwards
    // (which decode as default attr); runs of <= 4 spaces stay literal and keep
    // the inverse bit.  Mirror that so the decoded grids agree on the interior.
    // C ref: windows.c:1816 add_menu_heading() — `if (program_state.gameover)
    // attr = ATR_NONE, color = NO_COLOR`, so the end-of-game disclosure lists
    // draw their class headers PLAIN.
    const headAttr = game.program_state?.gameover ? 0 : (menuHeadAttr());
    const drawHeading = (text, row) => {
        for (let c = 0; c < text.length && offx + c < 80; c++) {
            let attr = headAttr;
            if (text[c] === ' ') {
                // Measure the contiguous space run containing this column.
                let s = c; while (s > 0 && text[s - 1] === ' ') s--;
                let e = c; while (e + 1 < text.length && text[e + 1] === ' ') e++;
                if (e - s + 1 > 4) attr = 0; // long gap -> default (cursor-forward)
            }
            display.setCell(offx + c, row, text[c], NO_COLOR, attr);
        }
    };
    // C ref: win/tty/topl.c — displaying the menu clears the message window, so
    // any lingering topline (e.g. "Never mind.") is gone behind the prompt row.
    game._pending_message = '';
    for (let c = 0; c < offx && c < 80; c++)
        display.setCell(c, 0, ' ', NO_COLOR, 0);
    // C ref: win/tty/wintty.c — a menu window paints its full rectangle: every
    // menu row is cleared from offx to offx+maxcol (background spaces) before
    // the (left-justified) text is written, so short rows hide the map beneath.
    const winRight = Math.min(offx + maxcol, 80);
    // C ref: wintty.c:1843 process_menu_window()/process_text_window() — the
    // window's own offx is one column LEFT of the text and each row starts with
    // an explicit `putchar(' ')` there, so that column is blanked too.  `offx`
    // above is already the text column.
    const winLeft = Math.max(0, offx - 1);
    const totalRows = 3 + itemLines.length + 1; // prompt, blank, header, items, (end)
    for (let r = 0; r < totalRows; r++)
        for (let c = winLeft; c < winRight; c++)
            display.setCell(c, r, ' ', NO_COLOR, 0);
    let row = 0;
    drawHeading(prompt, row++);
    draw('', row++, 0);
    drawHeading(header, row++);
    for (const ln of itemLines) draw(ln, row++, 0);
    draw('(end)', row, 0);
    if (offx > 0) putStatusLines(display);
    display.setCursor(offx + 6, row);
    game._modal_screen = 'spellmenu';

    // C ref: spell.c dovspell() — view, sort, then optionally choose two
    // casting letters to exchange (the sort order itself is only a view).
    let choice = null;
    for (;;) {
        const c = await nhgetch();
        if (c === 27 || c === 32 || c === 13 || c === 10) break;
        if (nspells < 2) continue;
        const ch = String.fromCharCode(c);
        const idx = (ch >= 'a' && ch <= 'z') ? ch.charCodeAt(0) - 97
            : (ch >= 'A' && ch <= 'Z') ? ch.charCodeAt(0) - 65 + 26 : -1;
        if (idx >= 0 && idx < nspells) { choice = idx; break; }
        if (ch === '+' && multi) { choice = '+'; break; }
    }
    delete game._modal_screen;
    if (choice === '+') {
        await spellSortMenu(spell);
    } else if (choice !== null && swapIndex < 0) {
        swapIndex = choice;
        continue;
    } else if (choice !== null && choice !== swapIndex) {
        [book[swapIndex], book[choice]] = [book[choice], book[swapIndex]];
        swapIndex = -1;
        continue;
    } else if (choice === null || swapIndex >= 0) {
        break;
    }
    }
    delete game.spl_orderindx;
    game.spl_sortmode = 0;
    return ECMD_OK;
}

// C ref: spell.c spellsortmenu() — the choice is temporary until '+' closes;
// sortspells() changes the displayed index, not the casting letters.
async function spellSortMenu(spell) {
    const choices = [
        'by casting letter', 'alphabetically', 'by level, low to high',
        'by level, high to low', 'by skill group, alphabetized within each group',
        'by skill group, low to high level within group',
        'by skill group, high to low level within group',
        'maintain current ordering',
        'reassign casting letters to retain current order',
    ];
    const flat = [{ text: 'View known spells list sorted', attr: menuHeadAttr() },
                  { text: '', attr: 0 }];
    for (let i = 0; i < choices.length; i++) {
        if (i === 8) flat.push({ text: '', attr: 0 });
        const ch = i === 8 ? 'z' : String.fromCharCode(97 + i);
        flat.push({ text: `${ch} ${i === (game.spl_sortmode | 0) ? '*' : '-'} ${choices[i]}`,
                    attr: 0 });
    }
    game._pending_message = '';
    renderMenuLines(flat, [32, 12]);
    for (;;) {
        const c = await nhgetch();
        if (c === 27 || c === 32 || c === 13 || c === 10) break;
        const ch = String.fromCharCode(c);
        const choice = ch === 'z' ? 8 : ch >= 'a' && ch <= 'h'
            ? ch.charCodeAt(0) - 97 : -1;
        if (choice < 0) continue;
        game.spl_sortmode = choice;
        spell.sortspells();
        break;
    }
    delete game._modal_screen;
}

function renderMessageOnMap(msg) {
    game._pending_message = msg;
    return flush_screen(1).then(() => {
        game._freeze_screen_once = true;
    });
}

export async function dismiss_invent_screen() {
    if (!game._modal_screen) return false;
    delete game._modal_screen;
    delete game._disco_pages;
    delete game._disco_page;
    delete game._skill_pages;
    delete game._skill_page;
    game._pending_message = '';
    // C ref: win/tty/wintty.c erase_menu_or_text() -> docorner() — tearing down
    // a menu whose own content reached row 22 (putStatusLines set
    // game._statusTruncCol for exactly this) is what wrecks the status line's
    // tail; flush_screen's normal full redraw resets that for plain gameplay,
    // so restore it here for the very next corner window to inherit.
    const carriedTrunc = game._statusTruncCol;
    // C ref: win/tty/wintty.c erase_menu_or_text(): docrt() ONLY for a
    // full-width window (offx == 0).  A corner menu is erased with
    // docorner(), which just row_refresh()es the glyph buffer back over the
    // vacated columns — no vision_recalc(), no see_monsters(), and therefore
    // no display-RNG draws.  Running docrt() here re-rolled three hallucinated
    // glyphs on every menu dismissal and desynchronised the display stream
    // (and with it every later hallucinated colour) from C's.
    if (!(game._menuOffx > 0)) await docrt();
    await flush_screen(1);
    if (carriedTrunc != null) {
        game._statusTruncCol = carriedTrunc;
        // getlin redraws only the topline after ^P; keep docorner's cleared
        // status tails on the grid until the next ordinary screen build.
        const display = game.nhDisplay;
        if (display?.setCell) {
            for (let row = 22; row < display.rows; row++)
                for (let col = carriedTrunc; col < display.cols; col++)
                    display.setCell(col, row, ' ', NO_COLOR, 0);
        }
    }
    return true;
}

// C ref: invent.c inuse_classify():69.  USE_RATING(test) is `++rating; if (test)
// goto assign_rating;` — the FIRST matching test fixes both the rating and the
// altclass and stops the scan.  The previous port ran every test to the end, so
// an in-use item always came out orderclass 4 with an inflated rating (a wielded
// weapon scored 15/4 instead of 11/3), which put the "Accessories" heading over
// the weapons and collapsed the class groups display_pickinv() keys off.
export function inuse_classify(sort_item, obj) {
    const wMask = (obj?.owornmask || 0) & (W_ACCESSORY | W_WEAPONS | W_ARMOR);
    // C: ULEFTY/URIGHTY (u.uhandedness) pick the off-hand ring first.
    const ULEFTY = !!game.u?.uleft_handed;
    const checks = [
        /* 1: Miscellaneous — a doubly-used lamp/leash only counts as a tool
           when owornmask is 0, so used-as-weapon takes precedence. */
        [1, !wMask && obj?.otyp === LEASH && obj.leashmon],
        [1, !wMask && obj?.oclass === TOOL_CLASS && obj.lamplit],
        /* 2: Worn Armor */
        [2, wMask & WORN_SHIRT],
        [2, wMask & WORN_BOOTS],
        [2, wMask & WORN_GLOVES],
        [2, wMask & WORN_HELMET],
        [2, wMask & WORN_SHIELD],
        [2, wMask & WORN_CLOAK],
        [2, wMask & WORN_ARMOR],
        /* 3: Wielded/Readied Weapons */
        [3, wMask & W_QUIVER],
        [3, wMask & W_SWAPWEP],
        [3, wMask & W_WEP],
        /* 4: Accessories */
        [4, wMask & WORN_BLINDF],
        [4, wMask & (ULEFTY ? W_RINGR : W_RINGL)],  /* off hand */
        [4, wMask & (ULEFTY ? W_RINGL : W_RINGR)],  /* main hand */
        [4, wMask & WORN_AMUL],
    ];
    let rating = 0, altclass = -1; /* no match: 'orderclass' must be non-zero */
    for (const [cls, test] of checks) {
        ++rating;
        if (test) { altclass = cls; break; }
    }
    if (altclass < 0) rating = 0;
    sort_item.inuse = rating;
    sort_item.orderclass = altclass;
    sort_item.subclass = 0;
    sort_item.disco = 0;
}

const P_BOW_LC = 20, P_CROSSBOW_LC = 22, P_SPEAR_LC = 17, P_DAGGER_LC = 1, P_KNIFE_LC = 2;
const LOOT_INSTRUMENTS = new Set(['wooden flute', 'magic flute', 'tooled horn',
    'frost horn', 'fire horn', 'wooden harp', 'magic harp', 'bugle', 'leather drum',
    'drum of earthquake', 'horn of plenty']);
export function loot_classify(sort_item, obj) {
    // Classification observes appearances before choosing a discovery bucket.
    if (!Blind_for_wear()) observe_object(obj);
    const defOrder = [COIN_CLASS, AMULET_CLASS, RING_CLASS, WAND_CLASS,
        POTION_CLASS, SCROLL_CLASS, SPBOOK_CLASS, GEM_CLASS, FOOD_CLASS,
        TOOL_CLASS, WEAPON_CLASS, ARMOR_CLASS, ROCK_CLASS, BALL_CLASS,
        CHAIN_CLASS, 0];
    const order = flags().sortpack !== false ? classOrder() : defOrder;
    const oclass = obj?.oclass ?? ILLOBJ_CLASS;
    const idx = order.indexOf(oclass);
    sort_item.orderclass = idx >= 0 ? idx + 1 : order.length + (oclass !== VENOM_CLASS ? 1 : 0);
    const otyp = obj?.otyp;
    const seen = !!obj?.dknown;
    const discovered = !!objects[otyp]?.oc_name_known;
    let subclass = 1;
    if (oclass === ARMOR_CLASS) {
        /* C: armcat[] remaps oc_armcat to helm, gloves, boots, shield, cloak,
           shirt, suit order; anything unexpected sorts last (8). */
        const ARMCAT_ORDER = [7 /* suit */, 4 /* shield */, 1 /* helm */, 2 /* gloves */,
                              3 /* boots */, 5 /* cloak */, 6 /* shirt */];
        const k = base_armcat(otyp);
        subclass = (k < 0 || k >= 7) ? 8 : ARMCAT_ORDER[k];
    } else if (oclass === WEAPON_CLASS) {
        /* group by ammo (arrows, bolts), launcher (bows), missile (darts,
           boomerangs), stackable (daggers, knives, spears), 'other', polearms */
        const k = objects[otyp]?.oc_skill ?? 0;
        subclass = (k < 0) ? ((k >= -P_CROSSBOW_LC && k <= -P_BOW_LC) ? 1 : 3)
            : ((k >= P_BOW_LC && k <= P_CROSSBOW_LC) ? 2
               : (k === P_SPEAR_LC || k === P_DAGGER_LC || k === P_KNIFE_LC) ? 4
                  : !is_pole(obj) ? 5 : 6);
    } else if (oclass === TOOL_CLASS) {
        if (seen && discovered && (otyp === BAG_OF_TRICKS || otyp === HORN_OF_PLENTY))
            subclass = 2; /* known pseudo-container */
        else if (Is_container(obj))
            subclass = 1; /* regular container or unknown bag of tricks */
        else
            subclass = LOOT_INSTRUMENTS.has(objects[otyp]?.name) ? 3 : 4;
    } else if (oclass === FOOD_CLASS) {
        if (otyp === SLIME_MOLD) subclass = 1;
        else if (otyp === TIN) subclass = 3;
        else if (otyp === EGG) subclass = 4;
        else if (otyp === CORPSE) subclass = 5;
        else subclass = obj?.globby ? 6 : 2;
    } else if (oclass === GEM_CLASS) {
        /* subclass outranks discovery here, so it is arranged to give away
           nothing: gems, glass, gray stones, then rocks */
        const mat = objects[otyp]?.material;
        if (mat === 20 /* GEMSTONE */) subclass = !seen ? 1 : !discovered ? 2 : 3;
        else if (mat === 19 /* GLASS */) subclass = !seen ? 1 : !discovered ? 2 : 4;
        else subclass = !seen ? 5 : (otyp !== ROCK) ? (!discovered ? 6 : 7) : 8;
    }
    sort_item.subclass = subclass;
    sort_item.disco = !seen ? 1 /* unseen */
        : (discovered || DESCR_BY_OTYP[otyp] == null) ? 4
        : objects[otyp]?.oc_uname ? 3 /* named (partially discovered) */
        : 2; /* undiscovered */
    sort_item.inuse = 0;
}

export function loot_xname(obj) {
    return cxname_singular(obj);
}

export function invletter_value(c) {
    const ch = String(c || '');
    if (ch >= 'a' && ch <= 'z') return ch.charCodeAt(0) - 97 + 2;
    if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 65 + 28;
    if (ch === GOLD_SYM) return 1;
    if (ch === NOINVSYM) return invlet_basic + 2;
    return invlet_basic + 3;
}

function greatest_erosion_sl(o) { return Math.max(o?.oeroded || 0, o?.oeroded2 || 0); }
export function sortloot_cmp(sli1, sli2) {
    const obj1 = sli1.obj;
    const obj2 = sli2.obj;
    const mode = game.sortlootmode || 0;
    if (mode & SORTLOOT_INUSE) {
        if (!sli1.orderclass) inuse_classify(sli1, obj1);
        if (!sli2.orderclass) inuse_classify(sli2, obj2);
        if (sli1.inuse !== sli2.inuse) return sli2.inuse - sli1.inuse;
    } else if ((mode & (SORTLOOT_PACK | SORTLOOT_INVLET)) !== SORTLOOT_INVLET) {
        if (!sli1.orderclass) loot_classify(sli1, obj1);
        if (!sli2.orderclass) loot_classify(sli2, obj2);
        if (sli1.orderclass !== sli2.orderclass) return sli1.orderclass - sli2.orderclass;
        if (!(mode & SORTLOOT_INVLET)) {
            if (sli1.subclass !== sli2.subclass) return sli1.subclass - sli2.subclass;
            if (sli1.disco !== sli2.disco) return sli1.disco - sli2.disco;
        }
    }
    if (mode & SORTLOOT_INVLET) {
        const d = invletter_value(obj1?.invlet) - invletter_value(obj2?.invlet);
        if (d) return d;
    }
    if (mode & SORTLOOT_LOOT) {
        const n1 = (sli1.str ||= loot_xname(obj1).toLowerCase());
        const n2 = (sli2.str ||= loot_xname(obj2).toLowerCase());
        if (n1 < n2) return -1;
        if (n1 > n2) return 1;
        /* by BUCX (bigger is better), greasing, erosion (bigger is worse),
           erodeproofing, then known enchantment, as in sortloot_cmp() */
        const bucx = (o) => (o.bknown ? (o.blessed ? 3 : !o.cursed ? 2 : 1) : 0);
        let v1 = bucx(obj1), v2 = bucx(obj2);
        if (v1 !== v2) return v2 - v1;
        v1 = obj1.greased | 0; v2 = obj2.greased | 0;
        if (v1 !== v2) return v2 - v1;
        v1 = greatest_erosion_sl(obj1); v2 = greatest_erosion_sl(obj2);
        if (v1 !== v2) return v1 - v2;
        v1 = (obj1.rknown && obj1.oerodeproof) ? 1 : 0;
        v2 = (obj2.rknown && obj2.oerodeproof) ? 1 : 0;
        if (v1 !== v2) return v2 - v1;
        if (objects[obj1.otyp]?.oc_uses_known && obj1.oclass !== FOOD_CLASS) {
            v1 = obj1.known ? obj1.spe : -1000;
            v2 = obj2.known ? obj2.spe : -1000;
            if (v1 !== v2) return v2 - v1;
        }
    }
    return sli1.indx - sli2.indx;
}

// C ref: libc qsort() as shipped with the recorder's platform (macOS, the
// FreeBSD qsort.c with swap_cnt).  sortloot_cmp() is not pure: loot_classify()
// and loot_xname() call observe_object() lazily, so the ORDER in which qsort
// hands pairs to the comparator decides which object type is "encountered"
// first and therefore the order of the '\\' discoveries list.  V8's
// Array.prototype.sort compares in a different sequence, so reproduce C's.
export function c_qsort(arr, cmp) {
    const swap = (i, j) => { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; };
    const vecswap = (i, j, n) => { for (; n > 0; n--, i++, j++) swap(i, j); };
    const CMP = (i, j) => cmp(arr[i], arr[j]);
    const med3 = (a, b, c) => (CMP(a, b) < 0
        ? (CMP(b, c) < 0 ? b : (CMP(a, c) < 0 ? c : a))
        : (CMP(b, c) > 0 ? b : (CMP(a, c) < 0 ? a : c)));
    const insertion = (a, n) => {
        for (let pm = a + 1; pm < a + n; pm++)
            for (let pl = pm; pl > a && CMP(pl - 1, pl) > 0; pl--) swap(pl, pl - 1);
    };
    const qs = (a, n) => {
        for (;;) {
            let swap_cnt = 0;
            if (n < 7) { insertion(a, n); return; }
            let pm = a + Math.trunc(n / 2);
            if (n > 7) {
                let pl = a, pn = a + n - 1;
                if (n > 40) {
                    const d = Math.trunc(n / 8);
                    pl = med3(pl, pl + d, pl + 2 * d);
                    pm = med3(pm - d, pm, pm + d);
                    pn = med3(pn - 2 * d, pn - d, pn);
                }
                pm = med3(pl, pm, pn);
            }
            swap(a, pm);
            let pa = a + 1, pb = pa, pc = a + n - 1, pd = pc, r;
            for (;;) {
                let c;
                while (pb <= pc && (c = CMP(pb, a)) <= 0) {
                    if (c === 0) { swap_cnt = 1; swap(pa, pb); pa++; }
                    pb++;
                }
                while (pb <= pc && (c = CMP(pc, a)) >= 0) {
                    if (c === 0) { swap_cnt = 1; swap(pc, pd); pd--; }
                    pc--;
                }
                if (pb > pc) break;
                swap(pb, pc);
                swap_cnt = 1;
                pb++; pc--;
            }
            if (swap_cnt === 0) { insertion(a, n); return; }
            const pn = a + n;
            r = Math.min(pa - a, pb - pa);
            vecswap(a, pb - r, r);
            r = Math.min(pd - pc, pn - pd - 1);
            vecswap(pb, pn - r, r);
            if ((r = pb - pa) > 1) qs(a, r);
            if ((r = pd - pc) > 1) { a = pn - r; n = r; continue; }
            return;
        }
    };
    qs(0, arr.length);
    return arr;
}

export function sortloot(olist, mode = 0, by_nexthere = false, filterfunc = null) {
    const list = Array.isArray(olist) ? olist : olist?.obj ?? olist;
    const arr = [];
    let idx = 0;
    const augment = !!(mode & SORTLOOT_PETRIFY);
    mode &= ~SORTLOOT_PETRIFY;
    for (const obj of iterateObjects(list, by_nexthere)) {
        if (filterfunc && !filterfunc(obj)
            && (!augment || obj.otyp !== CORPSE || !touch_petrifies(null)))
            continue;
        arr.push({ obj, str: null, indx: idx++, orderclass: 0, subclass: 0, disco: 0, inuse: 0 });
    }
    if (mode && arr.length > 1) {
        game.sortlootmode = mode;
        c_qsort(arr, sortloot_cmp);
        game.sortlootmode = 0;
        for (const item of arr) item.str = null;
    }
    arr.push({ obj: null, str: null, indx: -1, orderclass: 0, subclass: 0, disco: 0, inuse: 0 });
    return arr;
}

export function unsortloot(loot_array_p) {
    if (Array.isArray(loot_array_p)) loot_array_p.length = 0;
    else if (loot_array_p && typeof loot_array_p === 'object') loot_array_p.obj = null;
}

export function assigninvlet(otmp) {
    if (!otmp) return;
    if (otmp.oclass === COIN_CLASS) {
        otmp.invlet = GOLD_SYM;
        return;
    }
    const inuse = Array(invlet_basic).fill(false);
    for (const obj of inventoryArray()) {
        if (obj === otmp) continue;
        const i = obj.invlet;
        if (i >= 'a' && i <= 'z') inuse[i.charCodeAt(0) - 97] = true;
        else if (i >= 'A' && i <= 'Z') inuse[i.charCodeAt(0) - 65 + 26] = true;
        if (i === otmp.invlet) otmp.invlet = '';
    }
    if (otmp.invlet && /^[a-zA-Z]$/.test(otmp.invlet)) return;
    let i = (glState().lastinvnr ?? -1) + 1;
    for (; i !== (glState().lastinvnr ?? -1); ++i) {
        if (i === invlet_basic) { i = -1; continue; }
        if (!inuse[i]) break;
    }
    otmp.invlet = inuse[i] ? NOINVSYM : (i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(65 + i - 26));
    glState().lastinvnr = i;
}

export function reorder_invent() {
    const inv = inventoryArray();
    inv.sort((a, b) => ((a.invlet || '').charCodeAt(0) ^ 0o40) - ((b.invlet || '').charCodeAt(0) ^ 0o40));
    syncInventory(inv);
}

export function merge_choice(objlist, obj) {
    for (const candidate of iterateObjects(objlist))
        if (mergable(candidate, obj)) return candidate;
    return null;
}

// C ref: invent.c merged():856-942 — comparing objects can identify them
// (unless Blind; handled in mergable()) in any dimension either was known in.
// A non-thrown reveal prints "You learn more about your items by comparing
// them." via pline() (can --More--). Making merged() async for this rare
// message would infect its whole sync call chain (incl. chargen's ini_inv
// loop), so stash the fact instead; the few sites that can surface it
// (interactive pickup/#adjust) check and emit right after merging.
export function merged(potmp, pobj) {
    const otmp = potmp?.obj ?? potmp;
    const obj = pobj?.obj ?? pobj;
    if (!mergable(otmp, obj)) return 0;
    if (!obj.lamplit && !obj.globby)
        otmp.age = Math.trunc(((otmp.age || 0) * (otmp.quan || 1) + (obj.age || 0) * (obj.quan || 1))
            / ((otmp.quan || 1) + (obj.quan || 1)));
    if (!otmp.globby) otmp.quan = (otmp.quan || 1) + (obj.quan || 1);
    otmp.owt = weight(otmp);
    if (!has_oname(otmp) && has_oname(obj)) setONAME(otmp, ONAME(obj));
    if (obj.pickup_prev && otmp.where === OBJ_INVENT) otmp.pickup_prev = 1;
    if (obj.bypass) otmp.bypass = 1;

    let discovered = false;
    if (obj.known !== otmp.known) { otmp.known = 1; discovered = true; }
    if (obj.rknown !== otmp.rknown) {
        otmp.rknown = 1;
        if (otmp.oerodeproof) discovered = true;
    }
    if (obj.bknown !== otmp.bknown) {
        otmp.bknown = 1;
        if (!Role_if(PM_CLERIC)) discovered = true;
    }
    if (discovered && otmp.where === OBJ_INVENT
        && obj.how_lost !== LOST_THROWN && otmp.how_lost !== LOST_THROWN) {
        game._merge_discovery_pending = true;
    }

    removeObjectFromAllInventories(obj);
    if (pobj && typeof pobj === 'object' && 'obj' in pobj) pobj.obj = null;
    return 1;
}
// Avoid a mkobj -> invent module-initialization cycle in add_to_container().
hooks.merged = merged;

// Consume the merged()-set discovery flag (if any) and page the C
// "You learn more about your items by comparing them." message.
export async function report_merge_discovery() {
    if (!game._merge_discovery_pending) return;
    game._merge_discovery_pending = false;
    await update_topl('You learn more about your items by comparing them.');
}

// impossible() is async here, so addinv_core1()'s "already have ...?" reports
// are queued for flush_artitouch() like the artitouch() text.
function queue_impossible(msg) { (game._pending_impossibles ||= []).push(msg); }
export function addinv_core1(obj) {
    if (!obj) return;
    // C ref: invent.c addinv():962-965 — picking up (or otherwise gaining)
    // gold flags disp.botl so the NEXT bot() redraws the $ field; this is
    // also the only disp.botl source that can fire BEFORE encumber_msg()
    // within the same turn, letting an unrelated later message's bot() show
    // the gold-heavier near_capacity() early (see display.js botl_flush()).
    if (obj.oclass === COIN_CLASS) {
        game._goldCount = (game._goldCount || 0) + (obj.quan || 0);
        game.botl = true;
    } else if (obj.otyp === AMULET_OF_YENDOR) {
        if (ustate().uhave?.amulet) queue_impossible('already have amulet?');
        ustate().uhave = { ...(ustate().uhave || {}), amulet: 1 };
        record_achievement(ACH_AMUL);
    } else if (obj.otyp === CANDELABRUM_OF_INVOCATION) {
        if (ustate().uhave?.menorah) queue_impossible('already have candelabrum?');
        ustate().uhave = { ...(ustate().uhave || {}), menorah: 1 };
        record_achievement(ACH_CNDL);
    } else if (obj.otyp === BELL_OF_OPENING) {
        if (ustate().uhave?.bell) queue_impossible('already have silver bell?');
        ustate().uhave = { ...(ustate().uhave || {}), bell: 1 };
        record_achievement(ACH_BELL);
    } else if (obj.otyp === SPE_BOOK_OF_THE_DEAD) {
        if (ustate().uhave?.book) queue_impossible('already have the book?');
        ustate().uhave = { ...(ustate().uhave || {}), book: 1 };
        record_achievement(ACH_BOOK);
    } else if (obj.oartifact) {
        // C ref: invent.c addinv_core1(). artitouch()'s quest text is async
        // here, so it is queued for flush_artitouch(), which the async
        // addinv callers run before their own inventory message.
        if (is_quest_artifact(obj)) {
            if (ustate().uhave?.questart) queue_impossible('already have quest artifact?');
            ustate().uhave = { ...(ustate().uhave || {}), questart: 1 };
            game._pending_artitouch = obj;
        }
        set_artifact_intrinsic_core(obj, true, W_ART_PROP);
    }

    /* "special achievements"; revealed in end of game disclosure and dumplog */
    if (is_mines_prize(obj)) {
        record_achievement(ACH_MINE_PRIZE);
        game.context.achieveo.mines_prize_oid = 0; /* done w/ luckstone o_id */
        obj.nomerge = 0; /* was set in create_object(sp_lev.c) */
    } else if (is_soko_prize(obj)) {
        record_achievement(ACH_SOKO_PRIZE);
        game.context.achieveo.soko_prize_oid = 0; /* done w/ bag/amulet o_id */
        obj.nomerge = 0; /* (got set in sp_lev.c) */
    }
}

// C ref: quest.c artitouch() as reached from addinv_core1(); see above.
export async function flush_artitouch() {
    if (game._pending_impossibles?.length) {
        const { impossible: show_impossible } = await import('./display.js');
        const msgs = game._pending_impossibles;
        game._pending_impossibles = null;
        for (const m of msgs) await show_impossible(m);
    }
    const obj = game._pending_artitouch;
    if (obj) {
        game._pending_artitouch = null;
        observe_object(obj);
        await artitouch(obj);
    }
    await flush_addinv_plines();
}

// C ref: invent.c addinv_core2(). Inventory insertion is synchronous here,
// so async acquisition paths flush the label message before inventory output.
export function addinv_core2(obj) {
    if (confers_luck(obj)) set_moreluck();
    if (Role_if(PM_ARCHEOLOGIST) && obj.oclass === SCROLL_CLASS
        && obj.otyp !== SCR_BLANK_PAPER && !Blind_for_wear()
        && !objects[obj.otyp]?.oc_name_known) {
        observe_object(obj);
        /* name it BEFORE makeknown(), while it is still "scroll labeled FOO" */
        const msg = `You decipher the label on ${yname(obj)}.`;
        makeknown(obj.otyp);
        if (game.u) {
            const uc = game.u.uconduct || (game.u.uconduct = {});
            uc.literate = (uc.literate || 0) + 1;
        }
        (game._addinv_plines ||= []).push(msg);
    }
}

// Flush the messages addinv_core2() queued; call from the async caller right
// after the addinv*() that may have produced them.
export async function flush_addinv_plines() {
    const q = game._addinv_plines;
    if (!q || !q.length) return;
    game._addinv_plines = [];
    for (const m of q) await pline(m);
}

export function addinv_core0(obj, other_obj = null, update_perm_invent = true) {
    if (!obj) return null;
    if (obj.where && obj.where !== OBJ_FREE && obj.where !== OBJ_FLOOR && obj.where !== OBJ_CONTAINED)
        panic('addinv: obj not free');
    if (obj.how_lost === LOST_EXPLODING) return null;
    obj.no_charge = 0;
    // C ref: invent.c:1074 — how_lost is LATCHED before being cleared; the
    // quiver-fill below is the only consumer.
    const obj_was_thrown = (obj.how_lost === LOST_THROWN);
    obj.how_lost = LOST_NONE;
    addinv_core1(obj);
    const inv = inventoryArray();
    if (other_obj) {
        const ix = inv.indexOf(other_obj);
        if (ix >= 0) inv.splice(ix, 0, obj);
        else inv.push(obj);
    } else {
        // C ref: invent.c addinv_core0:1099-1106 -- merge with the quiver in
        // preference to any other inventory slot (quiver and wielded weapon
        // may both be eligible; extra goes to the quivered stack).
        let didMerge = false;
        if (game.uquiver) {
            const ref = { obj };
            if (merged(game.uquiver, ref)) {
                obj = game.uquiver;
                didMerge = true;
            }
        }
        if (!didMerge) {
            for (const existing of inv) {
                const ref = { obj };
                if (merged(existing, ref)) {
                    obj = existing;
                    break;
                }
            }
        }
        if (!inv.includes(obj)) {
            // C ref: invent.c addinv_core0:1116-1125 — assigninvlet then, with
            // flags.invlet_constant (the 'fixinv' option, default ON), insert at
            // the HEAD of gi.invent and reorder_invent() to keep items sorted by
            // inv_rank (invlet^040).  Because '$' (gold) has inv_rank 4 < 'a' (65),
            // gold sorts to the front; without this the JS tail-append left gold
            // at the end and shifted every pet dogfood() invent-scan position.
            assigninvlet(obj);
            // C ref: invent.c:1117-1125 — `if (flags.invlet_constant || !prev)`
            // insert at the head (and reorder when fixinv is on), else with
            // 'nofixinv' the new object goes at the END of the chain.
            const fixinv = flags().invlet_constant !== false;
            const at_head = fixinv || !inv.length;
            if (at_head) inv.unshift(obj);
            else inv.push(obj);
            obj.where = OBJ_INVENT;
            obj.pickup_prev = 1;
            syncInventory(inv);
            if (fixinv) reorder_invent();
            // C ref: invent.c:1128-1140 "fill empty quiver if obj was thrown".
            // Only on this no-merge insert path (C jumps past it to `added:`
            // for every merge).  Mjollnir and the aklys are excluded because
            // both must be WIELDED to be re-thrown.  Gray stones are sling
            // ammo (oc_skill -P_SLING), so an Archeologist who throws their
            // touchstone and walks back over it has it quivered on pickup —
            // which is what makes a later 'f' throw it instead of printing
            // "You have no ammunition readied."
            if (obj_was_thrown && flags().pickup_thrown !== false && !game.uquiver
                && obj.oartifact !== ART_MJOLLNIR && obj.otyp !== AKLYS
                && (throwing_weapon(obj) || is_ammo(obj)))
                setuqwep(obj);
            addinv_core2(obj);
            carry_obj_effects(obj);
            if (update_perm_invent) update_inventory();
            return obj;
        }
    }
    obj.where = OBJ_INVENT;
    obj.pickup_prev = 1;
    syncInventory(inv);
    addinv_core2(obj);
    carry_obj_effects(obj);
    if (update_perm_invent) update_inventory();
    return obj;
}

export function addinv(obj) { return addinv_core0(obj, null, true); }
export function addinv_before(obj, other_obj) { return addinv_core0(obj, other_obj, true); }
export function addinv_nomerge(obj) {
    const save = obj?.nomerge;
    if (obj) obj.nomerge = 1;
    const result = addinv(obj);
    if (obj) obj.nomerge = save;
    return result;
}

export function carry_obj_effects(obj) {
    if (obj?.otyp === FIGURINE && obj.cursed && obj.corpsenm != null)
        attach_fig_transform_timeout(obj);
    carry_obj_effects_message(obj);
}

export async function hold_another_object(obj, drop_fmt, drop_arg, hold_msg) {
    // C ref: invent.c:2755 hold_another_object() — `if (!Blind)
    // observe_object(obj); /* maximize mergeability */`.  The missing observe
    // that made this guard cost -44 on its own is learn_unseen_invent(), which
    // toggle_blindness() runs when sight returns: seed4500 wishes for a potion
    // of extra healing while blind (step 1202 "o - a potion."), and quaffing it
    // cures the blindness, which re-observes the pack so dopotion()'s
    // `if (otmp->dknown) makeknown()` still fires.
    if (!Blind_for_wear()) observe_object(obj);
    // C ref: invent.c:1218-1244 — an artifact is briefly placed on the floor
    // (in case touching it turns out to be fatal) and touch_artifact() is
    // consulted (rn2(4) for SPFX_RESTR artifacts, artifact.c:945).  A refused
    // touch, or a hero who lost a polymorphed form to the blast ("lose your
    // grip if you revert your form"), leaves it on the floor.
    if (obj && obj.oartifact) {
        const { touch_artifact: touchArtifact } = await import('./artifact.js');
        const wasUpolyd = !!game.u?.Upolyd;
        mkobj_place_object(obj, game.u?.ux ?? obj.ox, game.u?.uy ?? obj.oy);
        if (!await touchArtifact(obj, game.u)) {
            obj_extract_self(obj); /* remove it from the floor */
            await dropy(obj);      /* now put it back again :-) */
            return obj;
        } else if (wasUpolyd && !game.u?.Upolyd) {
            if (drop_fmt) await pline(String(drop_fmt).replace('%s', drop_arg ?? ''));
            obj_extract_self(obj);
            await dropy(obj);
            return obj;
        }
        obj_extract_self(obj);
    }
    // C invent.c:1251-1256: a corpse explicitly wished into the hero's hands
    // is put down unopened when touching it would petrify the hero.  Its brief
    // addinv_core0()/dropx() trip still assigns an inventory letter and applies
    // the normal drop effects; ordinary corpses are not subject to this rule.
    if (obj.otyp === CORPSE && obj.wishedfor
        && !u_safe_from_fatal_corpse(obj, st_all)) {
        obj.wishedfor = 0;
        const u = ustate();
        const typ = game.level?.at(u.ux, u.uy)?.typ;
        const away = Is_airlevel(u.uz) || Is_waterlevel(u.uz)
            || typ == null || typ < IRONBARS || typ >= ICE;
        const verb = (Is_airlevel(u.uz) || u.uinwater) ? 'slip' : 'materialize';
        const fmt = u.uswallow ? 'Oops!  %s out of your reach!'
            : away ? 'Oops!  %s away from you!'
                : 'Careful! %s on the floor!';
        // C ref: zap.c makewish() drop_arg = The(aobjnam(otmp, verb)); aobjnam
        // names a corpse with cxname() ("cockatrice corpse").
        const arg = on_The(`${(obj.quan || 1) !== 1 ? `${obj.quan} ` : ''}${cxname(obj)} ${otense(obj, verb)}`);
        obj = addinv_core0(obj, null, false);
        await pline(fmt.replace('%s', arg));
        obj.nomerge = 0;
        await dropx(obj);
        update_inventory();
        return null;
    }
    // C ref: invent.c hold_another_object — capture quan before addinv so
    // prinv reports the original count, then announce the held object.
    const oquan = obj?.quan;
    // C ref: invent.c:1259 — the encumbrance limit is max(current state,
    // flags.pickup_burden).  Without it a wish (or a returning thrown weapon)
    // that pushes the hero past 'pickup_burden' still landed in inventory
    // instead of on the floor, so every later invlet was off by one.
    const { pickup_burden } = await import('./pickup.js');
    let prev_encumbr = near_capacity();
    const burden_limit = pickup_burden();
    if (prev_encumbr < burden_limit) prev_encumbr = burden_limit;

    obj = addinv_core0(obj, null, false);
    await flush_artitouch();
    await report_merge_discovery();
    if (inv_cnt(false) > invlet_basic
        || ((obj.otyp !== LOADSTONE || !obj.cursed)
            && near_capacity() > prev_encumbr)) {
        /* drop_it: undo any merge which took place */
        if (obj.quan > oquan) obj = splitobj(obj, oquan);
        if (drop_fmt) await pline(String(drop_fmt).replace('%s', drop_arg ?? ''));
        obj.nomerge = 0;
        await dropx(obj);
        update_inventory();
        return null;  /* might be gone */
    }
    // C's prinv() is a pline(): it must page a pending touch_artifact() blast
    // before showing the inventory line, rather than overwrite that blast.
    if (hold_msg || drop_fmt) await update_topl(prinv_fmt(hold_msg, obj, oquan));
    update_inventory();
    await encumber_msg();
    return obj;
}

export function useupall(obj) {
    setnotworn(obj);
    freeinv_no_update(obj);
    obfree(obj, null);
}

export function useup(obj) {
    if ((obj?.quan || 1) > 1) {
        obj.in_use = false;
        obj.quan -= 1;
        obj.owt = weight(obj);
        update_inventory();
    } else useupall(obj);
}

export function consume_obj_charge(obj, maybe_unpaid) {
    if (maybe_unpaid) check_unpaid(obj);
    if (obj) obj.spe = (obj.spe || 0) - 1;
    if (obj?.known) update_inventory();
}

export function freeinv_core(obj) {
    if (!obj) return;
    // C ref: invent.c freeinv():1358-1360 — losing gold flags disp.botl, the
    // same early-dirty source addinv_core1() mirrors for gaining it.
    if (obj.oclass === COIN_CLASS) {
        game._goldCount = Math.max(0, (game._goldCount || 0) - (obj.quan || 0));
        game.botl = true;
        return;
    }
    else if (obj.otyp === AMULET_OF_YENDOR && ustate().uhave) ustate().uhave.amulet = 0;
    else if (obj.otyp === CANDELABRUM_OF_INVOCATION && ustate().uhave) ustate().uhave.menorah = 0;
    else if (obj.otyp === BELL_OF_OPENING && ustate().uhave) ustate().uhave.bell = 0;
    else if (obj.otyp === SPE_BOOK_OF_THE_DEAD && ustate().uhave) ustate().uhave.book = 0;
    else if (obj.oartifact) {
        // C ref: invent.c freeinv_core(). The arti_invoke() that turns off an
        // active invoked power is async and is not reached from here.
        if (is_quest_artifact(obj) && ustate().uhave) ustate().uhave.questart = 0;
        set_artifact_intrinsic_core(obj, false, W_ART_PROP);
    }
    if (obj.otyp === LOADSTONE) curse(obj);
    else if (confers_luck(obj)) { set_moreluck(); game.botl = true; }
}

// C ref: invent.c freeinv(obj):1402 -> mkobj.c extract_nobj():2595 — unlink
// from the hero's inventory AND set obj->where = OBJ_FREE.  The where write
// was missing here (removeObjectFromAllInventories() only splices the array,
// matching obj_extract_self()'s OWN explicit `obj.where = OBJ_FREE;` right
// after the same splice call, just above): every real dropx()/dropz() caller
// this wave wired in now hands the object straight to flooreffects(), whose
// `obj.where !== OBJ_FREE` guard fired impossible("flooreffects: obj not
// free") on every single drop once flooreffects() actually started running.
export function freeinv(obj) {
    removeObjectFromAllInventories(obj);
    if (obj) { obj.pickup_prev = 0; obj.where = OBJ_FREE; }
    freeinv_core(obj);
    update_inventory();
}

// C keeps svl.level.objects as a per-cell [x][y] head-of-chain grid; this port
// keeps ONE flat push-ordered array (js/mkobj.js place_object), so C's
// nexthere order == matching entries in reverse index order. Indexing the
// flat array as a grid yields undefined everywhere (sobj_at() null,
// delallobj() deletes nothing) — why js/do.js:628, js/dbridge.js:877,
// js/muse.js, js/trap.js:3253, js/hack.js:583 and js/monmove.js:1706 all
// carry private copies.
function floor_pile_at(x, y) {
    const out = [];
    for (const o of (game.level?.objects || []))
        if (o.where === OBJ_FLOOR && o.ox === x && o.oy === y) out.unshift(o);
    return out;   /* top of pile first == C's nexthere order */
}

export function delallobj(x, y) {
    for (const obj of floor_pile_at(x, y)) delobj(obj);
}

export function delobj(obj) { delobj_core(obj, false); }

export function delobj_core(obj, force = false) {
    if (!force && obj_resists(obj, 0, 0)) { if (obj) obj.in_use = 0; return; }
    const updateMap = obj?.where === OBJ_FLOOR;
    obj_extract_self(obj);
    if (updateMap) { maybe_unhide_at(obj.ox, obj.oy); newsym(obj.ox, obj.oy); }
    obfree(obj, null);
}

// C ref: invent.c sobj_at(otyp, x, y) — first match walking nexthere from the
// top of the pile.  See floor_pile_at() above for why the old [x][y] indexing
// always returned null.
export function sobj_at(otyp, x, y) {
    for (const obj of floor_pile_at(x, y))
        if (obj.otyp === otyp) return obj;
    return null;
}

export function nxtobj(obj, type, by_nexthere) {
    let otmp = obj;
    do {
        otmp = by_nexthere ? otmp?.nexthere : otmp?.nobj;
        if (!otmp) break;
    } while (otmp.otyp !== type);
    return otmp || null;
}

export function carrying(type) {
    for (const obj of inventoryArray()) if (obj.otyp === type) return obj;
    return null;
}

export function carrying_stoning_corpse() {
    for (const obj of inventoryArray())
        if (obj.otyp === CORPSE && touch_petrifies(null)) return obj;
    return null;
}

const currencies = [
    'Altarian Dollar', 'Ankh-Morpork Dollar', 'auric', 'buckazoid',
    'cirbozoid', 'credit chit', 'cubit', 'Flanian Pobble Bead',
    'fretzer', 'imperial credit', 'Hong Kong Luna Dollar', 'kongbuck',
    'nanite', 'quatloo', 'simoleon', 'solari', 'spacebuck', 'sporebuck',
    'Triganic Pu', 'woolong', 'zorkmid',
];

export function currency(amount) {
    let res = Hallucination_hero() ? currencies[rn2(currencies.length)] : 'zorkmid';
    if (amount !== 1) res = makeplural(res);
    return res;
}

export function u_carried_gloves() {
    if (game.uarmg) return game.uarmg;
    for (const obj of inventoryArray()) if (is_gloves(obj)) return obj;
    return null;
}

export function u_have_novel() { return carrying(SPE_NOVEL); }

export function o_on(id, objchn) {
    for (const obj of iterateObjects(objchn)) {
        if (obj.o_id === id) return obj;
        if (Has_contents(obj)) {
            const found = o_on(id, obj.cobj);
            if (found) return found;
        }
    }
    return null;
}

export function obj_here(obj, x, y) {
    for (const otmp of floor_pile_at(x, y))
        if (obj === otmp) return true;
    return false;
}

export function g_at(x, y) {
    for (const obj of iterateObjects(game.level?.objects?.[x]?.[y], true))
        if (obj.oclass === COIN_CLASS) return obj;
    return null;
}

export function compactify(buf) {
    const s = Array.isArray(buf) ? buf.join('') : String(buf ?? '');
    let out = '';
    for (let i = 0; i < s.length;) {
        let j = i;
        while (j + 1 < s.length && s.charCodeAt(j + 1) === s.charCodeAt(j) + 1) ++j;
        if (j - i >= 2) out += `${s[i]}-${s[j]}`;
        else out += s.slice(i, j + 1);
        i = j + 1;
    }
    if (Array.isArray(buf)) {
        buf.splice(0, buf.length, ...out.split(''));
        return buf;
    }
    return out;
}

// C ref: hack.h — getobj control flags.
export const GETOBJ_NOFLAGS = 0x0;
export const GETOBJ_ALLOWCNT = 0x1;
export const GETOBJ_PROMPT = 0x2;

// C ref: decl.c quitchars[] " \r\n\033" — keys that cancel a getobj prompt.
const QUITCHARS = ' \r\n\x1b';

// Draw a top-line yn_function prompt over the live map+status (like the C tty
// yn_function used by getobj) and park the cursor one column past the prompt
// plus trailing space.  The modal flag stops moveloop's re-render from
// clobbering the prompt before the capturing nhgetch fires.  Returns the key.
async function topline_query(prompt) {
    // C ref: getobj() calls yn_function(qbuf,...), which (like tty's prompt)
    // first flushes an unacknowledged top-line message with --More-- before
    // overwriting it with the prompt.  getobj sets _yn_need_more after the
    // "You don't have that object." re-prompt; honour it here so the displayed
    // --More-- frame(s) match C.
    if (game._yn_need_more) {
        game._yn_need_more = false;
        await topl_more();
    }
    // C ref: tty_yn_function(): the prompt is shown via SUPPRESS_HISTORY (the
    // old topline goes into the ^P ring), and clean_up: leaves
    // gt.toplines = prompt + trailing space + key2txt(answer).
    remember_topl();
    game._pending_message = prompt;
    game._toplPromptMsg = prompt;   // show_topl() hard-wrap, see display.js
    game._prevmsg = prompt.endsWith(' ') ? prompt : prompt + ' '; // pline.c:282 via topl.c:425 custompline
    await flush_screen(1);
    game._modal_screen = 'topl';
    const disp = game.nhDisplay;
    let promptRows = 0;
    if (disp?.setCursor) {
        // topl_putsym(): never print at column CO-1, wrap first (hard-wrap).
        let curx = 0, cury = 0;
        for (let i = 0; i < prompt.length + 1; i++) {
            if (curx === 79) { curx = 0; cury++; }
            curx++;
        }
        disp.setCursor(curx, cury);
        promptRows = cury;
    }
    const c = await nhgetch();
    delete game._modal_screen;
    yn_prompt_history(`${prompt} `, key2txt(c));
    // C ref: topl.c tty_yn_function() clean_up: `if (wins[WIN_MESSAGE]->cury)
    // tty_clear_nhwindow(WIN_MESSAGE)` -- a prompt that wrapped onto a second
    // row is erased once answered (a one-row prompt stays on screen).
    if (promptRows > 0) {
        game._pending_message = '';
        game._toplPromptMsg = null;
    }
    return c;
}

// C ref: invent.c getobj() '?'/'*' branch -> display_pickinv(want_reply=TRUE)
// -> win/tty/wintty.c process_menu_window() PICK_ONE.  Render the centred
// candidate menu (display_pickinv already lays the overlay out + parks the
// cursor past "(end) "), then read keystrokes until the player picks an item
// or cancels.  Returns the selected invlet, '\0' for a no-selection commit
// (space/return), or '\x1b' for cancel.  '?'/'*' re-issue the menu with the
// other candidate set.  Any other key just rings the bell (no re-render: the
// menu screen is unchanged).
async function getobj_menu(lets, altlets, bufFirst, allowed, allowxtra = false, word = '', out_cnt = null) {
    for (;;) {
        // allowed=true (the '?' set): show only `lets` (or `altlets` when
        // nothing was suggested); allowed=false ('*'): show the whole pack.
        // C ref: invent.c getobj():1963-1978 — redo_menu recomputes
        // allowed_choices AND the "- - your hands" handsbuf each time the menu
        // is reissued after the player picks '*'/'?' inside it, so the
        // Miscellaneous row appears as soon as the choice set is the whole pack.
        // display_pickinv() sets game._modal_screen and
        // positions the cursor exactly like C's NHW_MENU.
        const choices = allowed ? ((!lets && altlets.length) ? altlets.join('') : lets) : null;
        const xtraChoice = (choices === null || choices[0] === HANDS_SYM || bufFirst === HANDS_SYM)
            ? getobj_hands_txt(word) : null;

        // C ref: invent.c display_pickinv() — when exactly one item qualifies
        // (and force_invmenu/menu_requested aren't set), skip the boxed
        // candidate menu entirely and use message_menu(): a one-line
        // "letter - description." forced onto its own --More-- prompt.
        // Pressing the item's own invlet there both dismisses and selects it;
        // ESC cancels; any other quitchar (space/return) dismisses with no
        // pick, so the caller re-prompts "What do you want to <word>?".
        const invArr = inventoryArray();
        // C ref: invent.c:3085 — `if (lets && !*lets) lets = 0`.
        const lt = (choices != null && choices.length) ? choices : null;
        let n = lt ? lt.length
            : (invArr.length === 0 ? 0 : invArr.length === 1 ? 1 : 2);
        // C ref: invent.c:3123 — `if (usextra || (n == 1 && (!lets || wizid))) ++n`:
        // the extra "- - your hands" choice is a second item of interest, and a
        // full-pack listing ('*', lets == NULL) of a one-item pack is still a menu.
        if ((xtraChoice && allowxtra) || (n === 1 && !lt)) ++n;
        if (n === 1 && !game.flags?.force_invmenu && !game.iflags?.menu_requested) {
            const invlet = choices ? choices[0] : invArr[0]?.invlet;
            const otmp = invArr.find(o => o.invlet === invlet);
            if (otmp) {
                game._pending_message = xprname(otmp, null, invlet, true, 0, 0);
                // C ref: wintty.c tty_message_menu() uses pline() for this item.
                note_topl(game._pending_message);
                const c = await topl_more_ext(String(invlet));
                game._pending_message = '';
                game._toplin = 0;
                // C ref: wintty.c tty_message_menu() -- here <ESC> cancels the
                // prompt rather than skipping further messages, so it clears
                // WIN_CANCELLED ("Never mind." must still show).
                game._winStop = false;
                if (c === 27) return '\x1b';
                if (String.fromCharCode(c) === invlet) return invlet;
                return '\0';
            }
        }

        const usextra = !!(xtraChoice && allowxtra);
        // C ref: invent.c getobj():1972 — force_invmenu passes the menu a
        // "What do you want to <word>?" title (tty_end_menu() prompt).
        const menuquery = game.flags?.force_invmenu ? `What do you want to ${word}?` : null;
        // C ref: invent.c display_pickinv() — an empty pack says "Not carrying
        // anything." and returns '\0' at once; getobj() then `continue`s and the
        // re-issued prompt pages that message with --More--.
        if (display_pickinv(choices, xtraChoice, menuquery, allowxtra, true, null) === '\0'
            && !inventoryArray().length) {
            game._yn_need_more = true;   // the re-prompt pages the message
            return '\0';
        }
        // The menu lines drive which letters are selectable; outside-of-menu
        // letters ring the bell.  Build the selectable set from the rows shown.
        const shownLets = new Set();
        for (const obj of inventoryArray())
            if (!choices || String(choices).includes(obj.invlet))
                shownLets.add(obj.invlet);
        // C ref: invent.c getobj() `if (ilet == HANDS_SYM) return &hands_obj;`
        // (checked right after display_pickinv() returns) — the synthetic
        // "Miscellaneous / - - <hands>" row this menu just drew is itself
        // selectable by its own letter, same as any other menu line.
        if (usextra) shownLets.add(HANDS_SYM);
        // C ref: invent.c display_pickinv()'s force_invmenu "Special" row
        // (see force_invmenu_special()) — its accelerator ('*' to broaden to
        // the whole pack, or '?' to narrow back to likely candidates) is
        // selectable exactly when display_pickinv() would have drawn it, and
        // picking it REISSUES the menu with `allowed` flipped rather than
        // returning to the caller.
        const special = force_invmenu_special(choices, allowxtra, usextra);
        if (special) shownLets.add(special.ch);
        // C ref: wintty.c process_menu_window() — digits typed in a PICK_ONE
        // menu accumulate a count that applies to the NEXT selection only
        // (reset_count clears it after any other key); display_pickinv() hands
        // it back through out_cnt (-1L when no count was given).
        let counting = false, count = 0, reset_count = true;
        for (;;) {
            const key = await nhgetch();
            const ch = String.fromCharCode(key);
            if (reset_count) { counting = false; count = 0; } else reset_count = true;
            if (ch >= '0' && ch <= '9') {
                count = count * 10 + (key - 48);
                if (count > Number.MAX_SAFE_INTEGER) continue; /* overflow */
                if (count !== 0) { counting = true; reset_count = false; }
                continue;
            }
            if (ch === '\x1b') {
                if (counting) continue; /* only stops the count */
                delete game._modal_screen; return '\x1b';
            }
            if (ch === '\0' || ch === '\n' || ch === '\r' || ch === ' ') {
                delete game._modal_screen; return '\0';
            }
            if (special && ch === special.ch) { delete game._modal_screen; allowed = !allowed; break; }
            // C ref: tty_select_menu() -> destroy_nhwindow() erases the menu
            // (docorner over the map) before getobj() returns the pick, so a
            // following getlin()/prompt frame already shows the restored map.
            if (shownLets.has(ch)) {
                if (out_cnt) out_cnt.value = (counting && count > 0) ? count : -1;
                await dismiss_invent_screen();
                return ch;
            }
            // C: the tty menu ignores non-accelerator keys (tty_nhbell):
            // unacceptable input rings the bell (no visible change), keep reading
        }
    }
}

// C ref: cmd.c rhack():3732-3736/3810-3813 — ECMD_CANCEL never queues into
// CQ_REPEAT, and reset_cmd_vars(TRUE) clears it. This port's rhack()
// (js/cmd.js) unconditionally re-queues the pressed key for #repeat with no
// ECMD_* result threaded back, so a getobj() cancel (every caller propagates a
// null pick as its own cancel) left a stale command in CQ_REPEAT; a later
// unrelated ^A replayed it and silently ate the next keystroke, desyncing the
// session (bl006, seed700822 step 167: cancelled 'w' wield -> ^A replayed the
// wield prompt instead of "There is no command available to repeat."). Flag
// it here; js/cmd.js's tail bookkeeping consumes the flag — narrowest fix
// without threading ECMD_* through every dispatch arm.
export async function getobj(word, obj_ok, ctrlflags = GETOBJ_NOFLAGS) {
    const obj = await getobj_impl(word, obj_ok, ctrlflags);
    if (obj === null) {
        const svc = game.context || (game.context = {});
        svc._getobj_cancelled = true;
    }
    return obj;
}

// C ref: invent.c getobj() — prompt for an inventory object passing obj_ok.
// Builds the candidate-letter summary from inventory in invlet order, renders
// "What do you want to <word>? [<lets> or ?*]", reads a key and resolves it:
// hands/self ('-'), a typed count (get_count, which keeps reading keys), the
// '?'/'*' menus, the gold and throw restrictions, and the stack split.
// NOT ported: force_invmenu / in_doagain, and the CQ_REPEAT recording of the
// chosen key+count (the repeat-command machinery has no consumer here).
async function getobj_impl(word, obj_ok, ctrlflags = GETOBJ_NOFLAGS) {
    let forceprompt = (ctrlflags & GETOBJ_PROMPT) !== 0;
    const allowcnt = (ctrlflags & GETOBJ_ALLOWCNT) !== 0;

    // C ref: invent.c getobj() — first ask obj_ok whether "hands"/self ('-') is
    // a valid target.  SUGGEST puts "- " at the front of the prompt and enables
    // allownone; DOWNPLAY/EXCLUDE_* only enables allownone (the '-' goes into
    // altlets, reachable but not advertised in the prompt).
    let bufHands = '';
    let allownone = false;
    const altlets = [];
    let inaccess = 0;
    switch (obj_ok(null)) {
        case GETOBJ_SUGGEST: allownone = true; bufHands = HANDS_SYM + ' '; break;
        case GETOBJ_DOWNPLAY:
        case GETOBJ_EXCLUDE_INACCESS:
        case GETOBJ_EXCLUDE_SELECTABLE:
            allownone = true; altlets.push(HANDS_SYM); break;
        case GETOBJ_EXCLUDE_NONINVENT: forceprompt = false; inaccess++; break;
        default: break;
    }

    // C ref: invent.c getobj():1856 `if (!flags.invlet_constant) reassign();`
    // — with 'nofixinv' the letters are not bound to objects, so every prompt
    // re-letters the pack consecutively before collecting candidate letters.
    if (!flags().invlet_constant) reassign();

    let lets = '';
    let suggested = 0;
    for (const otmp of [...inventoryArray()].sort(compareInvlet)) {
        const v = obj_ok(otmp);
        if (v === GETOBJ_EXCLUDE_INACCESS) { inaccess++; continue; }
        if (v === GETOBJ_EXCLUDE || v === GETOBJ_EXCLUDE_SELECTABLE) continue;
        if (v === GETOBJ_DOWNPLAY) { altlets.push(otmp.invlet); forceprompt = true; continue; }
        if (v === GETOBJ_SUGGEST) { lets += otmp.invlet; suggested++; }
    }

    // The prompt buf is the hands prefix ("- ") then the suggested letters; if
    // nothing was suggested, drop the trailing space after a lone '-'.
    let buf = bufHands + lets;
    if (suggested === 0 && buf.endsWith(' ')) buf = buf.slice(0, -1);
    if (suggested > 5) buf = bufHands + compactify(lets);

    if (suggested === 0 && !forceprompt && !allownone) {
        await pline(`You don't have anything ${inaccess ? 'else ' : ''}to ${word}.`);
        return null;
    }

    const qbufPlain = `What do you want to ${word}?`;
    let qbuf = qbufPlain;
    if (!buf) qbuf += ' [*]';
    else qbuf += ` [${buf} or ?*]`;

    // C ref: getobj()'s for(;;) loop.  An invalid letter prints "You don't have
    // that object." and loops back to re-prompt; the next yn_function call first
    // flushes that message with --More-- (handled by topline_query honouring
    // _yn_need_more).  A quitchar (space/return/ESC) cancels with "Never mind.".
    let oneloop = false;
    for (;;) {
        // C ref: invent.c getobj() — a canned command-queue key (pushed by
        // itemactions, the "Do what with X?" submenu) is consumed as the object
        // selection WITHOUT rendering the prompt (no extra frame), exactly as
        // tty's cmdq_pop fast path does.
        // C ref: cmdq_pop() reads CQ_REPEAT while gi.in_doagain, so a #repeat
        // replays this prompt's recorded count and key.
        let canned = game.in_doagain ? cmdq_pop(CQ_REPEAT) : cmdq_pop(CQ_CANNED);
        let cqcnt = 0;
        if (canned && canned.typ === CMDQ_INT && allowcnt) {
            cqcnt = canned.intval;
            canned = game.in_doagain ? cmdq_pop(CQ_REPEAT) : cmdq_pop(CQ_CANNED);
        }
        let ilet, key;
        if (!canned && game.in_doagain) {
            // C ref: invent.c getobj() `if (gi.in_doagain) { ilet = readchar();
            // } else if (...) {...} else {...}` — a #repeat (^A) replay skips
            // the prompt entirely and silently reads the next queued key as
            // the answer.  Without this branch, replaying any command that
            // calls getobj() (eat, drop, wield, apply, ...) re-rendered the
            // object-selection prompt as an extra frame C never produces,
            // permanently misaligning the rest of the recorded session.
            key = await nhgetch();
            ilet = String.fromCharCode(key);
        } else if (!canned && !oneloop && game.flags?.force_invmenu) {
            // C ref: invent.c getobj() ~1917 — force_invmenu skips the
            // single-line "[f or ?*]" prompt on the FIRST pass, auto-selecting
            // '?' (or '*' with no suggested letters) straight to the boxed
            // picker with no keystroke consumed (a re-prompt after an invalid
            // pick still uses the normal query). The bare question (no
            // "[f or ?*]" suffix) is still written to the top line via
            // putmsghistory/msggiven=TRUE, just never blocks for a keypress;
            // the boxed menu opens below it.
            game._pending_message = qbufPlain;
            remember_topl();
            game._toplines = qbufPlain;
            ilet = (lets || altlets.length) ? '?' : '*';
            key = ilet.charCodeAt(0);
            oneloop = true;  // C ref: invent.c getobj():1929
        } else {
            key = canned && canned.typ === CMDQ_KEY
                ? canned.key : await topline_query(qbuf);
            ilet = String.fromCharCode(key);
        }
        let cnt = cqcnt, cntgiven = cqcnt > 0;

        // C ref: invent.c getobj():1935 — a DIGIT at the object prompt is a
        // count, checked BEFORE quitchars.  Without a count allowance C says so
        // and re-prompts; with one it runs get_count(), which keeps reading
        // keys until a non-digit arrives.  Omitting this let a typed digit fall
        // through to "You don't have that object." and, worse, left the digits
        // that followed it to be re-read as commands.
        if (ilet >= '0' && ilet <= '9') {
            if (!allowcnt) {
                await pline('No count allowed with this command.');
                game._yn_need_more = true;
                continue;
            }
            const got = await getobj_get_count(key);
            ilet = String.fromCharCode(got.key);
            if (got.cnt) { cnt = got.cnt; cntgiven = true; }
        }

        if (QUITCHARS.includes(ilet)) {
            // C ref: invent.c getobj():1950 — `if (flags.verbose) pline1(Never_mind)`.
            // With verbose off the cancelled prompt just stays on the topline.
            if (game.flags?.verbose !== false) await pline('Never mind.');
            return null;
        }
        if (ilet === HANDS_SYM) {
            if (!allownone) { await mime_action(word); return null; }
            return hands_obj;
        }

        // C ref: invent.c getobj() redo_menu — '?'/'*' open the candidate menu.
        // '?' lists the suggested letters (or, if none were suggested but the
        // '-' hands choice is in altlets, those); '*' lists the whole pack.
        let pick = ilet;
        if (pick === '?' || pick === '*') {
            const allowed = (pick === '?');
            // C ref: invent.c getobj():1964 `allowed_choices = (ilet == '?')
            // ? lets : (char *) 0;` — '*' unconditionally passes NULL, so its
            // menu (and the hands test) is NEVER narrowed by `lets`.  The
            // "Miscellaneous / - - <hands>" row decision (getobj():1976-1978)
            // lives in getobj_menu() so it is redone whenever the menu is
            // reissued after '*'/'?' is picked inside it.
            const ctmp = { value: -1 };
            const sel = await getobj_menu(lets, altlets, buf[0], allowed, allownone, word, allowcnt ? ctmp : null);
            if (sel === '\x1b') {
                if (game.flags?.verbose !== false) await pline('Never mind.');
                else { game._pending_message = ''; game._toplin = 0; }  // menu teardown wiped the prompt
                return null;
            }
            // C ref: invent.c getobj():1982 `if (!ilet) { if (oneloop) return
            // NULL; continue; }` -- only force_invmenu sets oneloop.
            if (sel === '\0') {
                if (oneloop) {
                    game._pending_message = ''; game._toplin = 0;  // menu teardown wiped the prompt
                    return null;
                }
                continue;
            }
            if (sel === HANDS_SYM) return hands_obj;
            pick = sel;
            // C ref: invent.c getobj():1996 — a count typed inside the menu.
            if (allowcnt && ctmp.value >= 0) { cnt = ctmp.value; cntgiven = true; }
        }

        // Resolve the chosen invlet to its inventory object.  An unknown letter
        // yields "You don't have that object." and re-prompts.
        let otmp = inventoryArray().find(o => o.invlet === pick);

        // C ref: invent.c getobj():2000 — gold restrictions.
        if (pick === GOLD_SYM || (otmp && otmp.oclass === COIN_CLASS)) {
            if (otmp && obj_ok(otmp) <= GETOBJ_EXCLUDE) {
                await pline(`You cannot ${word} gold.`);
                return null;
            }
            if (cntgiven && cnt <= 0) {
                if (cnt < 0)
                    await pline('The LRS would be very interested to know you have that much.');
                return null;
            }
        }
        // C ref: invent.c getobj():2026 — throwing takes at most one item
        // (gold excepted), since the throw code splits a single one off anyway.
        if (cntgiven && word === 'throw') {
            const only_one = 'can only throw one at a time';
            if (cnt === 0 || !otmp) return null;
            const coins = (otmp.oclass === COIN_CLASS);
            const quan = otmp.quan || 1;
            if (cnt > 1 && (!coins || cnt > quan)) {
                if (cnt > quan)
                    await pline(`You only have ${quan}${(!coins && quan > 1) ? ' and ' + only_one : ''}.`);
                else
                    await pline(`You ${only_one}.`);
                game._yn_need_more = true;
                continue;
            }
        }
        // C ref: invent.c getobj():2049 `disp.botl = TRUE; /* May have changed
        // the amount of money */` — every typed letter dirties the status line,
        // which the next flush_screen() publishes (T: included).
        game.botl = true;
        if (otmp && !game.in_doagain) {
            if (cntgiven && cnt > 0) cmdq_add_int(CQ_REPEAT, cnt);
            cmdq_add_key(CQ_REPEAT, pick.charCodeAt(0));
        }
        if (!otmp) {
            await pline('You don\'t have that object.');
            game._yn_need_more = true;
            if (game.in_doagain) return null;
            continue;
        } else if (cnt < 0 || (otmp.quan || 1) < cnt) {
            await pline(`You don't have that many!  You have only ${otmp.quan || 1}.`);
            game._yn_need_more = true;
            if (game.in_doagain) return null;
            continue;
        }
        // C ref: invent.c getobj() `split_otmp:` — hand back exactly `cnt` of
        // the stack (a cursed loadstone is never split; canletgo() reads the
        // requested count back out of corpsenm).
        if (cntgiven && cnt !== (otmp.quan || 1)) {
            if (otmp.otyp === LOADSTONE && otmp.cursed) otmp.corpsenm = cnt;
            else otmp = splitobj(otmp, cnt);
        }
        // C ref: invent.c getobj():2071 — a carried object that the callback
        // flatly EXCLUDEs ("That is a silly thing to <word>.") is rejected with
        // no turn.  (DOWNPLAY/SELECTABLE/SUGGEST all pass through.)  This is what
        // lets a magic-marker #write reject a non-scroll target (seed5002).
        if (obj_ok(otmp) === GETOBJ_EXCLUDE) {
            await pline(`That is a silly thing to ${word}.`);
            return null;
        }
        return otmp;
    }
}

// C ref: cmd.c get_count(NULL, inkey, LARGEST_INT, &cnt, GC_SAVEHIST) as called
// from getobj().  allowchars is NULL, so the FIRST non-digit key terminates and
// is returned to the caller; ESC terminates with a zero count.  Echo timing
// mirrors js/cmd.js get_count(): "Count: N" appears only once the count runs
// past a single digit (C's `if (cnt > 9)` gate).
const GETOBJ_LARGEST_INT = 32767;
async function getobj_get_count(inkey) {
    let cnt = 0;
    let key = inkey;
    for (;;) {
        const ch = String.fromCharCode(key);
        if (ch >= '0' && ch <= '9') {
            cnt = cnt * 10 + (key - 48);
            if (cnt < 0) cnt = 0;
            else if (cnt > GETOBJ_LARGEST_INT) cnt = GETOBJ_LARGEST_INT;
        } else if (ch === '\x1b') {
            cnt = 0;
            break;   /* C: break with *count still 0 */
        } else {
            break;
        }
        if (cnt > 9) {
            remember_topl();
            game._pending_message = `Count: ${cnt}`;
            game._prevmsg = game._pending_message; // pline.c:282 via custompline
            await flush_screen(1);
            const disp = game?.nhDisplay;
            if (disp?.setCursor)
                disp.setCursor(Math.min(game._pending_message.length, 79), 0);
        }
        key = await nhgetch();
    }
    // C ref: cmd.c get_count() tail — GC_SAVEHIST: putmsghistory("Count: N <key>")
    // moves the prompt into the ^P ring and makes this text the newest entry.
    note_topl(`Count: ${cnt} ${key2txt(key)}`);
    // C ref: cmd.c get_count() clears WIN_MESSAGE only inside the `cnt > 9 ||
    // backspaced || echoalways` echo branch above, never on the way out — so a
    // one-digit count leaves the object prompt standing on the topline.  This
    // used to blank it unconditionally.
    return { key, cnt };
}

// ── wear / take off armor (C ref: do_wear.c) ─────────────────────────────
//
// Worn-armor slot masks match u_init.js setworn()/find_ac() (W_ARM 0x1 ..
// W_ARMU 0x40); accessory slots use the prop.h-style bits defined above
// (W_RINGL/W_RINGR/W_AMUL/W_BLINDF) — those aren't filled by the starter kit
// the wear/takeoff sessions exercise.
export const WA_ARM = 0x01, WA_ARMC = 0x02, WA_ARMH = 0x04, WA_ARMS = 0x08,
    WA_ARMG = 0x10, WA_ARMF = 0x20, WA_ARMU = 0x40;
const WA_ARMOR_ALL = 0x7f;
// Re-exported for js/steal.js, whose steal() tests `owornmask & (W_ARMOR |
// W_ACCESSORY)` the way steal.c does.  Exporting the live values (rather than
// letting steal.js keep its own copies) is what stops the two files' bit
// assignments from drifting apart.
export { WA_ARMOR_ALL as W_ARMOR_WORN, W_ACCESSORY as W_ACCESSORY_WORN,
         W_WEAPONS as W_WEAPONS_WORN };

// C ref: include/objects.h ARMOR()/HELM()/...() oc_delay — the per-turn
// donning/doffing delay (negated by do_wear.c into a positive nomul count).
// Cloaks, shields, and shirts all have oc_delay 0 in objects.h (so they fall
// out to the `|| 0` default below without needing an entry here); the ranges
// below tabulate every otyp whose true oc_delay is nonzero (or, for the suits
// block, needs to differ from the block's own default).
const ARMOR_OC_DELAY = new Map([
    [RING_MAIL, 5], [HELMET, 1], [SMALL_SHIELD, 0], [LEATHER_GLOVES, 1],
    [CLOAK_OF_MAGIC_RESISTANCE, 0], [LEATHER_JACKET, 0], [FEDORA, 0],
    [LEATHER_ARMOR, 3], [ROBE, 0], [SPLINT_MAIL, 5],
    [CLOAK_OF_DISPLACEMENT, 0], [HAWAIIAN_SHIRT, 0],
]);
// C ref: include/objects.h DRGN_ARMR — every dragon scale mail (otyp 101..110)
// and dragon scales (111..120) has oc_delay 5, so donning/doffing is a 5-turn
// "dressing maneuver" occupation rather than an instant action.
for (let otyp = 101; otyp <= 120; otyp++) ARMOR_OC_DELAY.set(otyp, 5);
// C ref: include/objects.h "other suits" ARMOR() block (otyp 121..133: plate
// mail, crystal/bronze plate mail, splint/banded mail, the two mithril-coats,
// chain mail, orcish chain mail, scale mail, studded leather armor, ring mail,
// orcish ring mail).  Every entry has oc_delay 5 EXCEPT the lighter mithril-
// coats (delay 1, otyp 126/127) and studded leather armor (delay 3, otyp 131);
// leather armor (134, delay 3) and leather jacket (135, delay 0) are tabulated
// above by name.  Missing this range previously left plain chain mail (128)
// defaulting to delay 0 — an instant "You are now wearing ..." rather than the
// true 5-turn "dressing maneuver" occupation (and its AC-status timing).
for (let otyp = 121; otyp <= 133; otyp++) ARMOR_OC_DELAY.set(otyp, 5);
ARMOR_OC_DELAY.set(126, 1); // dwarvish mithril-coat
ARMOR_OC_DELAY.set(127, 1); // elven mithril-coat
ARMOR_OC_DELAY.set(131, 3); // studded leather armor
// C ref: include/objects.h GLOVES() — all four glove otyps (159..162: leather
// gloves and the three gauntlets) carry oc_delay 1.  Only LEATHER_GLOVES was
// tabulated, so a gauntlet took the delay==0 branch: accessory_or_armor_on()
// ran Gloves_on() (and its makeknown -> exercise(A_WIS) rn2(19)) BEFORE the
// turn's monster movement instead of after it, rotating a whole boundary's
// stream by one call (seed0360 step 495).
for (let otyp = 159; otyp <= 162; otyp++) ARMOR_OC_DELAY.set(otyp, 1);
// C ref: include/objects.h BOOTS() — every boots otyp (163..172) has oc_delay 2,
// so putting on / taking off any footwear is a 2-turn dressing maneuver.
for (let otyp = LOW_BOOTS; otyp <= LEVITATION_BOOTS; otyp++) ARMOR_OC_DELAY.set(otyp, 2);
// C ref: include/objects.h HELM() — every helmet otyp (89..100) has oc_delay 1
// EXCEPT the fedora (92) and dented pot (95), whose HELM() delay field is 0.  So
// donning/doffing any helmet is a 1-turn "dressing maneuver" occupation (showing
// "You finish your dressing maneuver." rather than an instant "You are now
// wearing …").  This covers the orcish helm (90), elven leather helm (89),
// dwarvish iron helm (91), cornuthaum, dunce cap, helm of brilliance/caution/
// opposite-alignment/telepathy, in addition to the plain helmet (97) above.
for (let otyp = 89; otyp <= 100; otyp++) ARMOR_OC_DELAY.set(otyp, 1);

// C ref: objects.h objects[otyp].oc_delay — the donning/doffing delay, read by
// steal.c's ARMOR_CLASS branch (`armordelay = objects[otmp->otyp].oc_delay`).
export function oc_delay(otyp) { return ARMOR_OC_DELAY.get(otyp) || 0; }
ARMOR_OC_DELAY.set(FEDORA, 0);   // fedora: HELM() delay field 0
ARMOR_OC_DELAY.set(95, 0);       // dented pot (no named otyp constant here): delay 0

// C ref: objclass.h is_cloak/is_suit/is_helmet/... — classify a piece of armor
// by the slot it occupies, returning its WA_* mask (0 if not wearable armor).
function armor_slot_mask(obj) {
    if (!obj || obj.oclass !== ARMOR_CLASS) return 0;
    // C ref: obj.h:280-298 is_shield/is_helmet/is_cloak/is_gloves/is_boots/
    // is_shirt test objects[].oc_armcat, which this port's table lacks.  These
    // are objects.h's contiguous blocks (identical to js/objnam.js o_ranges).
    // The old per-otyp switch enumerated only the armor the public 44 wear, so
    // every other shield/helm/cloak/glove landed in the body-armor slot.
    const t = obj.otyp;
    if (t >= 136 && t <= 137) return WA_ARMU; // HAWAIIAN_SHIRT..T_SHIRT
    if (t >= 138 && t <= 149) return WA_ARMC; // MUMMY_WRAPPING..CLOAK_OF_DISPLACEMENT
    if (t >= 89 && t <= 100)  return WA_ARMH; // ELVEN_LEATHER_HELM..HELM_OF_TELEPATHY
    if (t >= 150 && t <= 158) return WA_ARMS; // SMALL_SHIELD..SHIELD_OF_REFLECTION
    if (t >= 159 && t <= 162) return WA_ARMG; // LEATHER_GLOVES..GAUNTLETS_OF_DEXTERITY
    if (t >= 163 && t <= 172) return WA_ARMF; // LOW_BOOTS..LEVITATION_BOOTS
    return WA_ARM;                            // suits, incl. dragon scales/mail
}

function worn_slot_get(mask) {
    switch (mask) {
    case WA_ARM:  return game.uarm;
    case WA_ARMC: return game.uarmc;
    case WA_ARMH: return game.uarmh;
    case WA_ARMS: return game.uarms;
    case WA_ARMG: return game.uarmg;
    case WA_ARMF: return game.uarmf;
    case WA_ARMU: return game.uarmu;
    default: return null;
    }
}

export function worn_slot_clear(mask) {
    // Property sources leave with the slot; Boots_off/Gloves_off separately
    // cancel the timer only when no intrinsic or other worn source remains.
    if (game.u) game.u.EFumbling = (game.u.EFumbling | 0) & ~mask;
    // C ref: worn.c:92-107 setworn(0, mask) — the vacating object stops
    // conferring its property.  Done before the pointer is dropped, because the
    // object is only reachable through it.
    worn_extrinsics_off(worn_slot_get(mask), mask);
    switch (mask) {
    case WA_ARM:  game.uarm = null; break;
    case WA_ARMC: game.uarmc = null; break;
    case WA_ARMH: game.uarmh = null; break;
    case WA_ARMS: game.uarms = null; break;
    case WA_ARMG: game.uarmg = null; break;
    case WA_ARMF: game.uarmf = null; break;
    case WA_ARMU: game.uarmu = null; break;
    default: break;
    }
}

function worn_slot_set(obj, mask) {
    obj.owornmask = (obj.owornmask || 0) | mask;
    // C ref: worn.c:112-131 setworn(obj, mask).  Body armor / cloak / helmet /
    // shield / gloves / boots / shirt all confer objects[].oc_oprop from here.
    worn_extrinsics_on(obj, mask);
    switch (mask) {
    case WA_ARM:  game.uarm = obj; break;
    case WA_ARMC: game.uarmc = obj; break;
    case WA_ARMH: game.uarmh = obj; break;
    case WA_ARMS: game.uarms = obj; break;
    case WA_ARMG: game.uarmg = obj; break;
    case WA_ARMF: game.uarmf = obj; break;
    case WA_ARMU: game.uarmu = obj; break;
    default: break;
    }
}

// C ref: do_wear.c already_wearing — note the trailing '!' for the c_that_ case.
async function already_wearing(cc) {
    await pline(`You are already wearing ${cc}${cc === 'that' ? '!' : '.'}`);
}
// C ref: do_wear.c already_wearing2() — the two-item form used when the new
// eyewear collides with different eyewear already on the face.
async function already_wearing2(what1, what2) {
    await pline(`You can't wear ${what1} because you're wearing ${what2} there.`);
}

// C ref: worn.c setworn() — set an accessory worn-slot (ring/amulet/blindfold)
// and its game-state pointer, releasing any wield slot the object occupied.
export function setworn_accessory(obj, mask) {
    if (obj === game.uwep) setuwep_slot(null);
    else if (obj === game.uswapwep) setuswapwep(null);
    else if (obj === game.uquiver) setuqwep(null);
    obj.owornmask = (obj.owornmask || 0) | mask;
    worn_extrinsics_on(obj, mask);
    if (mask === W_RINGL) game.uleft = obj;
    else if (mask === W_RINGR) game.uright = obj;
    else if (mask === W_AMUL) game.uamul = obj;
    else if (mask === W_BLINDF) game.ublindf = obj;
}

// C ref: worn.c setworn(obj, mask) for a MULTI-bit owornmask as stored on an
// object (nhlua.c nhl_gamestate() restores sequestered inventory this way:
// `if (wornmask) setworn(otmp, wornmask)`).  The port keeps one setter per slot
// family, so dispatch each set bit to its family's setter.
export function setworn_mask(obj, mask) {
    if (!obj || !mask) return;
    obj.owornmask = 0;
    for (const bit of [WA_ARM, WA_ARMC, WA_ARMH, WA_ARMS, WA_ARMG, WA_ARMF, WA_ARMU])
        if (mask & bit) worn_slot_set(obj, bit);
    for (const bit of [W_RINGL, W_RINGR, W_AMUL, W_BLINDF])
        if (mask & bit) setworn_accessory(obj, bit);
    if (mask & QW_WEP) setuwep_slot(obj);
    if (mask & QW_SWAPWEP) setuswapwep(obj);
    if (mask & QW_QUIVER) setuqwep(obj);
}
function clearworn_accessory(obj) {
    const m = obj.owornmask || 0;
    if (m & W_RINGL) game.uleft = null;
    if (m & W_RINGR) game.uright = null;
    if (m & W_AMUL) game.uamul = null;
    if (m & W_BLINDF) game.ublindf = null;
    worn_extrinsics_off(obj, m & W_ACCESSORY);
    obj.owornmask = m & ~W_ACCESSORY;
}

// C ref: do_wear.c Ring_on(obj) — applies a ring's on-effect after setworn().
// The ring is already in uleft/uright.  Attribute and protection rings adjust
// the relevant stat / AC; every other ring confers its extrinsic purely through
// the owornmask (no message, no RNG) and falls through the default no-op.
export async function Ring_on(obj) {
    // C ref: do_wear.c:1244 — `oldprop = u.uprops[oc_oprop].extrinsic`, taken
    // AFTER setworn() has already added this ring's own bit, then
    // `if ((oldprop & W_RING) != W_RING) oldprop &= ~W_RING;` keeps the ring
    // bits only when BOTH hands confer the property.  Reading the real
    // extrinsic word (rather than just comparing the other hand's otyp) also
    // covers the boots/amulet/artifact sources of the same property.
    const prop = objects[obj.otyp]?.oc_oprop | 0;
    let oldprop = prop ? worn_extrinsic(prop) : 0;
    const W_RING_BOTH = W_RINGL | W_RINGR;
    if ((oldprop & W_RING_BOTH) !== W_RING_BOTH) oldprop &= ~W_RING_BOTH;
    switch (obj.otyp) {
    case RIN_STEALTH:
        await toggle_stealth(obj, oldprop, true);
        break;
    case RIN_WARNING:
        see_monsters(); /* C ref: do_wear.c:1286 */
        break;
    case RIN_SEE_INVISIBLE:
        /* can now see invisible monsters (C ref: do_wear.c:1289-1291) */
        set_mimic_blocking(); /* do special mimic handling */
        see_monsters();
        if (game.u?.uprops?.Invis && !oldprop && !game.u?.uprops?.HSee_invisible
            && !Blind_for_wear()) {
            newsym(game.u.ux, game.u.uy);
            await pline('Suddenly you are transparent, but there!');
            learnring(obj, true);
        }
        break;
    case RIN_INVISIBILITY:
        if (!oldprop && !game.u?.uprops?.HInvis && !Blind_for_wear()) {
            learnring(obj, true);
            newsym(game.u.ux, game.u.uy);
            // C ref: do_wear.c:1303 self_invis_message() (potion.c:471) — the
            // wording depends on Hallucination and See_invisible; a hard-coded
            // "can see right through yourself" was the See_invisible variant
            // only, so an ordinary hero got the wrong line.
            const { self_invis_message } = await import('./potion.js');
            await self_invis_message();
        }
        break;
    case RIN_LEVITATION:
        // C ref: do_wear.c:1307 — `if (!oldprop && !HLevitation &&
        // !(BLevitation & FROMOUTSIDE))`.  oldprop above now carries every
        // other worn source (the other hand, levitation boots, an amulet);
        // BLevitation (terrain-blocked) is never set anywhere in this port
        // (switch_terrain() is NOT PORTED, see js/dig.js:868).
        if (!oldprop && !(game.u?.uprops?.Levitation | 0)) {
            const { float_up, spoteffects } = await import('./trap.js');
            await float_up();
            learnring(obj, true);
            /* C: `if (Levitation) spoteffects(FALSE);` -- for sinks */
            await spoteffects();
        }
        // else: float_vs_flight() (hack.c) — not ported anywhere in this
        // codebase (no BFlying I_SPECIAL-toggle infra exists).
        break;
    case RIN_PROTECTION_FROM_SHAPE_CHAN:
        /* rescham() (mon.c): un-mimics/de-chameleons every monster, no RNG */
        break;
    case RIN_PROTECTION:
        // C ref: do_wear.c — learnring(obj, spe != 0), NOT an unconditional
        // known=1: a +0 protection ring of an undiscovered type stays unknown.
        learnring(obj, (obj.spe | 0) !== 0);
        if (obj.spe) find_ac();
        break;
    case RIN_GAIN_STRENGTH:
        adjust_attrib(obj, A_STR, obj.spe | 0); break;
    case RIN_GAIN_CONSTITUTION:
        adjust_attrib(obj, A_CON, obj.spe | 0); break;
    case RIN_ADORNMENT:
        adjust_attrib(obj, A_CHA, obj.spe | 0); break;
    case RIN_INCREASE_ACCURACY:
        if (game.u) game.u.uhitinc = (game.u.uhitinc | 0) + (obj.spe | 0); break;
    case RIN_INCREASE_DAMAGE:
        if (game.u) game.u.udaminc = (game.u.udaminc | 0) + (obj.spe | 0); break;
    default:
        break; // teleportation/regeneration/searching/etc.: extrinsic only
    }
}

// C ref: do_wear.c learnring(ring, observed) — an observable ring effect
// discovers the type (or, when the type is already discovered, just marks this
// ring seen); a seen ring of a known charged type also learns its enchantment.
export function learnring(ring, observed) {
    const ringtype = ring?.otyp;
    if (ringtype == null) return;
    if (observed) {
        if (objects[ringtype]?.oc_name_known) observe_object(ring);
        else if (ring.dknown) makeknown(ringtype);
    }
    if (ring.dknown && objects[ringtype]?.oc_name_known) {
        // objects[].oc_charged does not exist in this port's object table: the
        // bit lives in the packed `flags` field (is_oc_charged()).  Reading the
        // absent property made this test always false, so an observed +N/-N
        // ring never learned its enchantment and printed as "a ring of
        // adornment" where C shows "a -1 ring of adornment".
        if (is_oc_charged(ring)) ring.known = 1;
        update_inventory();
    }
}

// C ref: attrib.c extremeattr(attrindx) — is the attribute pinned at its min
// or max?  (Fixed_abil and racial limits are deliberately not consulted, per C.)
// onames.h otyps (mkobj.js OBJECT_DATA): 162 is GAUNTLETS_OF_DEXTERITY and 100
// is HELM_OF_TELEPATHY, so both of these were naming the wrong object — a hero
// wearing real gauntlets of power was never pinned to STR 18/**, and a dunce cap
// never pinned INT/WIS to 6.
const GAUNTLETS_OF_POWER = 161, DUNCE_CAP = 94;
function extremeattr(attrindx) {
    let lolimit = 3, hilimit = 25;
    const curval = acurr_eff(attrindx);
    if (attrindx === A_STR) {
        hilimit = 125;  /* STR19(25) */
        if (game.uarmg && game.uarmg.otyp === GAUNTLETS_OF_POWER) lolimit = hilimit;
    } else if (attrindx === A_CON) {
        // u_wield_art(ART_OGRESMASHER): artifact wield effects aren't modelled.
    }
    if (attrindx === A_INT || attrindx === A_WIS) {
        if (game.uarmh && game.uarmh.otyp === DUNCE_CAP) { hilimit = 6; lolimit = 6; }
    }
    return curval === lolimit || curval === hilimit;
}

// C ref: do_wear.c adjust_attrib(obj, which, val) — bump a stat by `val` (gain
// strength/constitution and adornment rings, on and off).  ABON feeds acurr(),
// which weight_cap()/encumbrance, to-hit and the status line all read, so an
// unmodelled delta silently steers later rn2() moduli.
function adjust_attrib(obj, which, val) {
    const u = game.u;
    if (!u || !(which >= 0 && which < A_MAX)) return;
    if (!u.abon) u.abon = { a: Array(A_MAX).fill(0) };
    if (!Array.isArray(u.abon.a)) u.abon.a = Array(A_MAX).fill(0);
    const old_attrib = acurr_eff(which);
    u.abon.a[which] = (u.abon.a[which] | 0) + val;
    const observable = (old_attrib !== acurr_eff(which));
    if (observable || !extremeattr(which)) learnring(obj, observable);
    game.botl = true;
}

// C ref: attrib.h ABON(x) — u.abon.a[x], the worn-gear attribute bonus that
// acurr() adds.  do_wear.c's adj_abon()/Helmet_on() write it directly (no
// learnring(), unlike adjust_attrib()).
export function adj_abon_attrib(which, delta) {
    const u = game.u;
    if (!u || !(which >= 0 && which < A_MAX)) return;
    if (!u.abon) u.abon = { a: Array(A_MAX).fill(0) };
    if (!Array.isArray(u.abon.a)) u.abon.a = Array(A_MAX).fill(0);
    u.abon.a[which] = (u.abon.a[which] | 0) + delta;
}

// Amulet otyps (C ref: include/objects.h AMULET() block, mirrored by
// js/mkobj.js OBJECT_DATA rows 201..211).
const AMULET_OF_ESP = 201, AMULET_OF_LIFE_SAVING = 202,
    AMULET_OF_STRANGULATION = 203, AMULET_OF_RESTFUL_SLEEP = 204,
    AMULET_VERSUS_POISON = 205, AMULET_OF_CHANGE = 206,
    AMULET_OF_UNCHANGING = 207, AMULET_OF_REFLECTION = 208,
    AMULET_OF_MAGICAL_BREATHING = 209, AMULET_OF_GUARDING = 210,
    AMULET_OF_FLYING = 211;

// C ref: polyself.c poly_gender() — 0/1 like flags.female, 2 for none.
export function poly_gender() {
    const ptr = youmonst_data();
    if (ptr && (is_neuter_flag(ptr) || !humanoid_flag(ptr))) return 2;
    return game.flags?.female ? 1 : 0;
}

// C ref: polyself.c change_sex() — flip flags.female (and u.mfemale while
// polymorphed) and resync u.umonnum for the un-polymorphed hero.
function change_sex() {
    const u = game.u;
    if (!u) return;
    if (!u.Upolyd) game.flags.female = !game.flags.female;
    else u.mfemale = !u.mfemale;
    if (!u.Upolyd) u.umonnum = u.umonster ?? u.umonnum;
}

// C ref: do_wear.c Amulet_on(obj).  Returns C's `on_msg_done` so the caller can
// skip its own on_msg() — the ordering matters: strangulation and change print
// the worn-confirmation line BEFORE their own message.  setworn() has already
// happened at the call site (C does it inside this function).
async function Amulet_on(amul) {
    const u = game.u;
    let on_msg_done = false;
    switch (amul?.otyp) {
    case AMULET_OF_ESP:
    case AMULET_OF_LIFE_SAVING:
    case AMULET_VERSUS_POISON:
    case AMULET_OF_REFLECTION:
    case FAKE_AMULET_OF_YENDOR_OTYP:
    case AMULET_OF_YENDOR:
        break;
    case AMULET_OF_MAGICAL_BREATHING:
        // C consults region_danger() for a poison-gas cloud; gas regions are
        // not modelled here, so was_in_poison_gas is always FALSE (no RNG).
        break;
    case AMULET_OF_UNCHANGING:
        // C: if (Slimed) make_slimed(0L, NULL).  Sliming is not modelled.
        break;
    case AMULET_OF_CHANGE: {
        const orig_sex = poly_gender();
        if (!u?.Unchanging) change_sex();
        const new_sex = poly_gender();
        if (new_sex !== orig_sex) makeknown(AMULET_OF_CHANGE);
        await on_msg_accessory(amul);   /* C: on_msg(uamul) */
        on_msg_done = true;
        let call_it = false;
        if (new_sex !== orig_sex) {
            newsym(u.ux, u.uy);
            game.botl = true;           /* rank title may have changed */
            await pline(`You are suddenly very ${game.flags?.female ? 'feminine' : 'masculine'}!`);
        } else {
            await pline("You don't feel like yourself.");
            call_it = !!amul.dknown;
        }
        await pline('The amulet disintegrates!');
        if (call_it) await trycall(amul);
        useup(amul);
        break;
    }
    case AMULET_OF_STRANGULATION:
        // C ref: do_wear.c Amulet_on() — `if (can_be_strangled(&youmonst))`;
        // the timer lives in u.uprops.Strangled (timeout.c / botl read it).
        if (can_be_strangled_hero()) {
            makeknown(AMULET_OF_STRANGULATION);
            u.uprops = u.uprops || {};
            u.uprops.Strangled = 6;
            game.botl = true;
            await on_msg_accessory(amul);
            on_msg_done = true;
            await pline('It constricts your throat!');
        }
        break;
    case AMULET_OF_RESTFUL_SLEEP: {
        // C ref: do_wear.c:1010 — `long newnap = (long) rnd(98) + 2L`.  This
        // rnd(98) fires on EVERY don of the amulet, whatever the outcome.
        const newnap = rnd(98) + 2;
        const oldnap = (u?.HSleepy || 0) & TIMEOUT;
        if (u && (newnap < oldnap || oldnap === 0))
            u.HSleepy = ((u.HSleepy || 0) & ~TIMEOUT) | newnap;
        break;
    }
    case AMULET_OF_FLYING:
        // setworn() conferred extrinsic flying; C then float_vs_flight() and,
        // if this is new flight, makeknown + "You are now in flight."
        if (u && !u.uprops?.Levitation) {
            const already = !!u.uprops?.Flying;
            if (!already) {
                if (!u.uprops) u.uprops = {};
                u.uprops.Flying = true;
                makeknown(AMULET_OF_FLYING);
                await on_msg_accessory(amul);
                on_msg_done = true;
                game.botl = true;
                await pline('You are now in flight.');
            }
        }
        break;
    case AMULET_OF_GUARDING:
        makeknown(AMULET_OF_GUARDING);
        find_ac();
        break;
    default:
        break;
    }
    return on_msg_done;
}

// C ref: objects.c — dragon scale mail otyps (this codebase's numbering).
const BLUE_DRAGON_SCALE_MAIL = 108, BLUE_DRAGON_SCALES = 118;

// C ref: do_wear.c Blindf_on(obj) — call setworn() itself, give the wear
// feedback, then (because the eyewear blinds the hero) emit "You can't see any
// more." and toggle blindness so the vision system blanks the now-unseen map.
export async function Blindf_on(obj) {
    const { Blind, vision_recalc } = await import('./vision.js');
    const already_blind = Blind();
    setworn_accessory(obj, W_BLINDF);
    await on_msg_accessory(obj);
    if (Blind() && !already_blind) {
        // flags.verbose defaults TRUE in these sessions.  update_topl (C pline)
        // accumulates after the "You are now wearing ..." line.
        if (game.flags?.verbose !== false) await update_topl("You can't see any more.");
        await (await import('./potion.js')).toggle_blindness();
    }
}

// C ref: do_wear.c Blindf_off(obj) — clear the eyewear slot (does its own
// off_msg "You were wearing ..."), then if sight is regained emit "You can see
// again." and toggle blindness (recompute vision so the room reappears).
// C ref: mondata.c can_be_strangled(&youmonst) — needs a head, and a
// brainless form must also be breathless to be immune.
function can_be_strangled_hero() {
    const ptr = youmonst_data();
    if (!ptr || (mflags1_of(ptr) & 0x8000 /* M1_NOHEAD */)) return false;
    const p = game.u?.uprops || {};
    const nobrainer = (mflags1_of(ptr) & 0x10000 /* M1_MINDLESS */) !== 0;
    const nonbreathing = (mflags1_of(ptr) & 0x400 /* M1_BREATHLESS */) !== 0
        || !!(p.Breathless || p.HBreathless || p.EBreathless)
        || game.uamul?.otyp === 209 /* AMULET_OF_MAGICAL_BREATHING */;
    return !nobrainer || !nonbreathing;
}
export async function Blindf_off(obj) {
    const { Blind, vision_recalc } = await import('./vision.js');
    const was_blind = Blind();
    // C: a NULL obj means "ublindf, but skip the usual off message".
    const nooffmsg = !obj;
    if (!obj) obj = game.ublindf;
    if (!obj) {
        impossible('Blindf_off without eyewear?');
        return;
    }
    takeoff_ctx().mask &= ~W_BLINDF; // C do_wear.c:1506
    clearworn_accessory(obj);
    // off_msg(): no redundant "(being worn)" suffix after removal.
    // C ref: do_wear.c:68 off_msg() — the whole message is `if (flags.verbose)`.
    if (!nooffmsg && game.flags?.verbose !== false)
        await update_topl(`You were wearing ${doname_invent(obj)}.`);
    // C ref: do_wear.c:1514-1534 — three outcomes after the slot is cleared.
    let changed = false;
    if (Blind()) {
        if (was_blind) {
            /* "still cannot see" makes no sense when removing lenses since
               they can't have been the cause of the blindness */
            if (obj.otyp !== LENSES) await update_topl('You still cannot see.');
        } else {
            changed = true;   /* !was_blind */
            await update_topl("You can't see anything now!");
        }
    } else if (was_blind) {
        // gulp_blnd_check() (covered by mouth) is false here.
        changed = true;       /* !Blind */
        await update_topl('You can see again.');
    }
    if (changed) await (await import('./potion.js')).toggle_blindness();
}

// C ref: do_wear.c Ring_off_or_gone(obj, gone) — the shared tail of Ring_off()
// (the hero deliberately removes it) and Ring_gone() (it leaves the finger
// without being taken off: stolen, destroyed, polymorphed).  Both clear the
// worn slot and then undo whatever on-effect Ring_on() applied.
async function Ring_off_or_gone(obj, _gone) {
    // C ref: do_wear.c:1349 — takeoff.mask loses this ring's slot bit first.
    const mask = (obj.owornmask | 0) & (W_RINGL | W_RINGR);
    takeoff_ctx().mask &= ~mask;
    // setnotworn(obj) / setworn(0, owornmask): either way the finger is freed
    // and the extrinsic (carried by the owornmask here) goes with it.
    clearworn_accessory(obj);
    // C ref: do_wear.c:1380 — the post-removal extrinsic word, i.e. whatever
    // OTHER worn source still confers this property.  C computes it as
    // `EStealth & ~mask` from the word BEFORE the slot was cleared, which is
    // the same value as reading it after clearworn_accessory().
    const prop = objects[obj.otyp]?.oc_oprop | 0;
    const still_from_other = prop ? worn_extrinsic(prop) : 0;
    const spe = obj.spe | 0;
    switch (obj.otyp) {
    case RIN_STEALTH:
        await toggle_stealth(obj, still_from_other, false);
        break;
    case RIN_WARNING:
        see_monsters(); /* C ref: do_wear.c:1383 */
        break;
    case RIN_SEE_INVISIBLE:
        /* Make invisible monsters go away (C ref: do_wear.c:1386-1390) */
        if (!worn_extrinsic(29 /* SEE_INVIS */) && !game.u?.uprops?.HSee_invisible) {
            set_mimic_blocking(); /* do special mimic handling */
            see_monsters();
        }
        if (game.u?.uprops?.Invis && !Blind_for_wear()) {
            newsym(game.u.ux, game.u.uy);
            await pline('Suddenly you cannot see yourself.');
            learnring(obj, true);
        }
        break;
    case RIN_INVISIBILITY:
        if (!still_from_other && !game.u?.uprops?.HInvis && !Blind_for_wear()) {
            newsym(game.u.ux, game.u.uy);
            await pline(`Your body seems to unfade${game.u?.uprops?.See_invisible ? ' completely' : '..'}.`);
            learnring(obj, true);
        }
        break;
    case RIN_LEVITATION: {
        // C ref: do_wear.c:1406 — `float_down(0L, 0L)` then, if that actually
        // landed the hero, learnring().  BLevitation is never set in this port
        // so the float_vs_flight() arm is unreachable.
        const { float_down } = await import('./trap.js');
        await float_down(0, 0);
        if (!still_from_other && !(game.u?.uprops?.Levitation | 0))
            learnring(obj, true);
        break;
    }
    case RIN_PROTECTION_FROM_SHAPE_CHAN:
        /* restartcham() (mon.c): no RNG */
        break;
    case RIN_PROTECTION:
        learnring(obj, spe !== 0);
        if (spe) find_ac();
        break;
    case RIN_GAIN_STRENGTH:
        adjust_attrib(obj, A_STR, -spe); break;
    case RIN_GAIN_CONSTITUTION:
        adjust_attrib(obj, A_CON, -spe); break;
    case RIN_ADORNMENT:
        adjust_attrib(obj, A_CHA, -spe); break;
    case RIN_INCREASE_ACCURACY:
        if (game.u) game.u.uhitinc = (game.u.uhitinc | 0) - spe; break;
    case RIN_INCREASE_DAMAGE:
        if (game.u) game.u.udaminc = (game.u.udaminc | 0) - spe; break;
    default:
        break; // teleportation/regeneration/searching/etc.: extrinsic only
    }
}
// C ref: do_wear.c Ring_off(obj) / Ring_gone(obj).
export async function Ring_off(obj) { await Ring_off_or_gone(obj, false); }
export async function Ring_gone(obj) { await Ring_off_or_gone(obj, true); }

// C ref: do_wear.c off_msg(otmp) — "You were wearing <obj>." after the slot has
// already been cleared (so no "(being worn)" suffix), verbose-gated.
export async function off_msg(otmp) {
    if (game.flags?.verbose !== false)
        await pline(`You were wearing ${doname_invent(otmp)}.`);
}

// C ref: do_wear.c Amulet_off().  Several amulets clear the slot EARLY so their
// own message follows the "You were wearing ..." line, and strangulation /
// flying additionally makeknown() the type.  The old stub only cleared the slot,
// so a strangling hero stayed Strangled after taking the amulet off.
export async function Amulet_off(amul = game.uamul) {
    if (!amul) return;
    let mkn = false, early_off_msg = false;
    switch (amul.otyp) {
    case AMULET_OF_ESP:
        clearworn_accessory(amul); await off_msg(amul); early_off_msg = true;
        // see_monsters(): telepathy display refresh, RNG-free.
        break;
    case AMULET_OF_LIFE_SAVING:
    case AMULET_VERSUS_POISON:
    case AMULET_OF_REFLECTION:
    case AMULET_OF_CHANGE:
    case AMULET_OF_UNCHANGING:
    case FAKE_AMULET_OF_YENDOR_OTYP:
        break;
    case AMULET_OF_MAGICAL_BREATHING:
        clearworn_accessory(amul); await off_msg(amul); early_off_msg = true;
        // Underwater drown() and region_danger() poison gas are not modelled.
        break;
    case AMULET_OF_STRANGULATION:
        clearworn_accessory(amul); await off_msg(amul); early_off_msg = true;
        if (game.u?.uprops?.Strangled) {
            game.u.uprops.Strangled = 0;
            game.botl = true;
            // Breathless would say "Your neck is no longer constricted!".
            await pline('You can breathe more easily!');
            mkn = true;
        }
        break;
    case AMULET_OF_RESTFUL_SLEEP:
        clearworn_accessory(amul);
        // C: avoid clobbering the FROMOUTSIDE bit set by eating one of these.
        if (game.u && !game.u.ESleepy && !((game.u.HSleepy || 0) & ~TIMEOUT))
            game.u.HSleepy = (game.u.HSleepy || 0) & ~TIMEOUT;
        break;
    case AMULET_OF_FLYING: {
        const was_flying = !!game.u?.uprops?.Flying;
        clearworn_accessory(amul); await off_msg(amul); early_off_msg = true;
        if (was_flying && game.u?.uprops) {
            game.u.uprops.Flying = false;
            game.botl = true;
            await pline('You land.');
            mkn = true;
        }
        break;
    }
    case AMULET_OF_GUARDING:
        find_ac();
        break;
    default:
        break;
    }
    if (amul.owornmask) clearworn_accessory(amul);
    if (!early_off_msg) await off_msg(amul);
    if (mkn) makeknown(amul.otyp);
}

// C ref: steal.c remove_worn_item(obj, unchain_ball) — an item the hero is
// wearing/wielding has been taken away (theft, seduction, stone-to-flesh).
// Clears the slot through the same per-slot *_off() routines the deliberate
// take-off path uses, so the extrinsics and AC follow.  No RNG, no message.
export async function remove_worn_item(obj, unchain_ball) {
    // C ref: steal.c:219 — a multi-turn dressing maneuver in progress on this
    // very object is aborted (cancel_don() clears multi/afternmv/nomovemsg).
    if (donning(obj)) cancel_don();
    if (!(obj.owornmask || 0)) return;

    // obj->in_use guards emergency_disrobe()/lava_effects() from dropping or
    // destroying the item mid-removal; neither is reachable here.
    const armorMask = (obj.owornmask || 0) & WA_ARMOR_ALL;
    if (armorMask) {
        // C ref: steal.c:241 — the theft path runs the SAME <Armor>_off()
        // routines 'T' does, so a stolen helm of brilliance gives its INT/WIS
        // back and stolen elven boots print the stealth message.
        const oldinuse = obj.in_use;
        obj.in_use = 1;
        const off_fn = armor_off_fn(obj);
        if (off_fn) await off_fn();
        else {
            obj.owornmask = (obj.owornmask || 0) & ~armorMask;
            worn_slot_clear(armorMask);
        }
        obj.in_use = oldinuse;
        // no find_ac() — see accessory_or_armor_on (do_wear.c:2377).
    } else if ((obj.owornmask || 0) & W_AMUL) {
        // C ref: steal.c remove_worn_item() calls the same Amulet_off() the 'R'
        // command uses, so the off_msg and the strangulation/flying unwinds
        // happen on theft too.
        await Amulet_off(obj);
    } else if ((obj.owornmask || 0) & (W_RINGL | W_RINGR)) {
        await Ring_gone(obj);
    } else if ((obj.owornmask || 0) & W_BLINDF) {
        await Blindf_off(obj);
    } else if ((obj.owornmask || 0) & W_WEAPONS) {
        if (obj === game.uwep) setuwep_slot(null);
        if (obj === game.uswapwep) setuswapwep(null);
        if (obj === game.uquiver) setuqwep(null);
    }

    // Ball & chain (W_BALL|W_CHAIN) -> unpunish(); the hero is never Punished
    // in the covered sessions.
    void unchain_ball;
    if (obj.owornmask) setnotworn(obj);   /* catchall */
    if (game._allow_inventory_update !== undefined) update_inventory();
}

// C ref: steal.c worn_item_removal(mon, obj) — remove_worn_item() prefaced by
// "<Mon> takes off/removes/disarms your <item>."  The object description is
// massaged: the leading article becomes "your", the worn/alternate-weapon
// suffixes are dropped, and "(on left hand)" becomes "(from left hand)".
export async function worn_item_removal(mon, obj) {
    let objbuf = doname_invent(obj);
    // convert "a/an/the <object>" to "your <object>"
    if (objbuf.startsWith('the ')) objbuf = 'your ' + objbuf.slice(4);
    else if (objbuf.startsWith('an ')) objbuf = 'your ' + objbuf.slice(3);
    else if (objbuf.startsWith('a ')) objbuf = 'your ' + objbuf.slice(2);
    objbuf = objbuf.replace(' (being worn)', '');
    objbuf = objbuf.replace(' (alternate weapon; not wielded)', '');
    // "ring (on left hand)" -> "ring (from left hand)"
    objbuf = objbuf.replace(/ \(on (left |right )/, ' (from $1');

    const worn = obj.owornmask || 0;
    const verb = (worn & W_WEAPONS) ? 'disarms'
        : (worn & W_ACCESSORY) ? 'removes'
            : 'takes off';
    const { Some_Monnam } = await import('./do_name.js');
    await update_topl(`${Some_Monnam(mon)} ${verb} ${objbuf}.`);
    game.last_msg = PLNMSG_MON_TAKES_OFF_ITEM;
    // Removal might trigger more messages (loss of Lev|Fly); not reachable for
    // the items these sessions lose.
    await remove_worn_item(obj, true);
}

// C ref: invent.c inv_cnt(incl_gold) — number of carried objects.
export { inv_cnt };

// C ref: do_wear.c on_msg() — for rings/amulets show the prinv add-to-invent
// line ("<let> - <name> (on right hand)."); for worn tools when !verbose the
// same prinv line, else a verbose "You are now wearing ..." sentence.  prinv()
// leaves the formatted line in game._pending_message, which the next flush picks
// up — exactly the deferred behavior the wield path relies on.
async function on_msg_accessory(obj) {
    const m = obj.owornmask || 0;
    // Rings/amulets always show the prinv add-to-invent line; a worn tool
    // (blindfold/lenses/towel) shows it only when !verbose.  flags.verbose
    // defaults TRUE in these sessions, so the tool path falls through to the
    // verbose "You are now wearing ..." sentence.
    const verbose = game.flags?.verbose !== false;
    if ((m & (W_RINGL | W_RINGR | W_AMUL)) || ((m & W_BLINDF) && !verbose)) {
        // C ref: do_wear.c on_msg() -> invent.c prinv() -> pline().  Routed
        // through update_topl() rather than prinv()'s bare setter because the
        // slot's *_on() routine runs FIRST (do_wear.c:2411 Ring_on() before
        // on_msg()) and may already have left an unacknowledged topline — e.g.
        // a ring of levitation's "You start to float in the air!", which C
        // pages with --More-- before drawing "<let> - a ring of levitation (on
        // right hand).".  The bare setter silently overwrote it, losing both
        // the message and the keystroke its --More-- consumes.  update_topl()
        // leaves toplin == NEED_MORE too, so a later same-turn message still
        // accumulates onto this line exactly as before.
        await update_topl(prinv_fmt(null, obj, 0));
        return;
    }
    // C ref: on_msg() verbose branch uses an(xname(otmp)) — no worn-status
    // suffix (xname omits it), so use simple_obj_name not doname_invent.  Route
    // through update_topl (C pline) so a same-turn follow-up (blindness or a
    // monster's "It bites!") accumulates on the topline instead of replacing it.
    // C: `how` is " around your <head>" for a towel and empty otherwise.
    const how = (obj.otyp === TOWEL) ? ` around your ${body_part(8 /*HEAD*/)}` : '';
    await update_topl(`You are now wearing ${an(on_xname(obj))}${how}.`);
}

// C ref: do_wear.c equip_ok(obj, removing, accessory).  getobj() callback shared
// by wear/takeoff ('W'/'T', accessory=FALSE) and puton/remove ('P'/'R',
// accessory=TRUE).  The `accessory ^ (oclass != ARMOR)` test decides SUGGEST vs
// DOWNPLAY: 'W'/'T' suggest armor and downplay rings/amulets/eyewear, while
// 'P'/'R' suggest accessories and downplay armor.
function equip_ok(obj, removing, accessory) {
    if (!obj) return GETOBJ_EXCLUDE;
    const is_worn = ((obj.owornmask || 0) & (WA_ARMOR_ALL | W_ACCESSORY)) !== 0;
    // ignore for wearing if already worn, or for removing if not worn
    if (removing ? !is_worn : is_worn) return GETOBJ_EXCLUDE_INACCESS;
    // exclude object classes that can never be worn
    if (obj.oclass !== ARMOR_CLASS && obj.oclass !== RING_CLASS
        && obj.oclass !== AMULET_CLASS) {
        if (obj.otyp !== BLINDFOLD && obj.otyp !== LENSES && obj.otyp !== TOWEL)
            return GETOBJ_EXCLUDE;
    }
    // armor with 'P'/'R', or accessory with 'W'/'T' -> downplay (selectable via *)
    if (accessory === (obj.oclass === ARMOR_CLASS)) return GETOBJ_DOWNPLAY;
    // C ref: do_wear.c equip_ok() — armor we can't wear right now (slot filled,
    // covered, welded weapon, polyform) is downplayed rather than suggested, so
    // it does not appear in the getobj prompt's letter list.
    if (obj.oclass === ARMOR_CLASS && !removing && !canwearobj_quiet(obj))
        return GETOBJ_DOWNPLAY;
    // C ref: do_wear.c equip_ok() — removing something covered by another worn
    // item is excluded (rings look only for KNOWN-cursed gloves).
    if (removing && !game.item_action_in_progress) {
        if (inaccessible_equipment_quiet(obj, obj.oclass === RING_CLASS))
            return GETOBJ_EXCLUDE_INACCESS;
    }
    return GETOBJ_SUGGEST;
}

// C ref: do_wear.c inaccessible_equipment(obj, NULL, only_if_known_cursed) —
// the message-free form equip_ok() uses (a getobj callback cannot await).
function inaccessible_equipment_quiet(obj, only_if_known_cursed) {
    const anycovering = !only_if_known_cursed;
    const blocks = (x) => anycovering || (x.cursed && x.bknown);
    if (!obj || !(obj.owornmask | 0)) return false;
    if (obj === game.uarm && game.uarmc && blocks(game.uarmc)) return true;
    if (obj === game.uarmu
        && ((game.uarm && blocks(game.uarm)) || (game.uarmc && blocks(game.uarmc))))
        return true;
    if ((obj === game.uleft || obj === game.uright) && game.uarmg && blocks(game.uarmg))
        return true;
    return false;
}
function wear_ok(obj) { return equip_ok(obj, false, false); }
function puton_ok(obj) { return equip_ok(obj, false, true); }
function remove_ok(obj) { return equip_ok(obj, true, true); }
function takeoff_ok(obj) { return equip_ok(obj, true, false); }

// C ref: do_wear.c accessory_or_armor_on(obj) — the wear path.  Implements the
// armor branch (the only one the wear/takeoff sessions reach); a piece already
// worn yields "You are already wearing that!" with no time cost.
async function accessory_or_armor_on(obj) {
    if ((obj.owornmask || 0) & (W_ACCESSORY | WA_ARMOR_ALL)) {
        await already_wearing('that');
        return ECMD_OK;
    }
    const ring = (obj.oclass === RING_CLASS || obj.otyp === MEAT_RING);
    const amulet = (obj.oclass === AMULET_CLASS);
    const eyewear = (obj.otyp === BLINDFOLD || obj.otyp === TOWEL
                     || obj.otyp === LENSES);
    if (obj.oclass !== ARMOR_CLASS) {
        // C ref: do_wear.c accessory_or_armor_on() — accessory branch.
        if (ring) {
            let mask = 0;
            // C ref: do_wear.c:2254 — a nolimbs polyform has nothing to put a
            // ring on; costs no time.
            if (nolimbs_flag(youmonst_data())) {
                await pline('You cannot make the ring stick to your body.');
                return ECMD_OK;
            }
            // C ref: do_wear.c:2258 — the "ring-" qualifier is dropped for a
            // non-humanoid form (which has plain fingers, paws, tentacles...).
            const ringpfx = humanoid_flag(youmonst_data()) ? 'ring-' : '';
            if (game.uleft && game.uright) {
                await pline(`There are no more ${ringpfx}${fingers_or_gloves(false)} to fill.`);
                return ECMD_OK;
            }
            if (game.uleft) mask = W_RINGR;
            else if (game.uright) mask = W_RINGL;
            else {
                // C ref: yn_function(qbuf, rightleftchars="rl", '\0', TRUE) — prompt
                // until a valid finger is chosen; ESC/space (default '\0') cancels.
                while (!mask) {
                    // def '' (no shown default) matches C yn_function(..,'\0',TRUE);
                    // quitchars (space/return/ESC) return '' -> cancel like C's '\0'.
                    const ans = await y_n(`Which ${ringpfx}${body_part(3)}, Right or Left?`,
                                          'rl\x1b', '');
                    if (ans === '' || ans === '\x1b') return ECMD_OK;
                    if (ans === 'l') mask = W_RINGL;
                    else if (ans === 'r') mask = W_RINGR;
                }
            }
            // C ref: do_wear.c accessory_or_armor_on() — slippery gloves burn a
            // turn; cursed gloves and a welded weapon burn one ONLY when the
            // attempt taught the hero that the blocker is cursed (res).
            if (game.uarmg && game.u?.uprops?.Glib) {
                await pline(`Your ${gloves_simple_name(game.uarmg)} are too slippery to remove, so you cannot put on the ring.`);
                return ECMD_TIME;
            }
            if (game.uarmg && game.uarmg.cursed) {
                const res = !game.uarmg.bknown;
                game.uarmg.bknown = 1;
                await pline('You cannot remove your gloves to put on the ring.');
                return res ? ECMD_TIME : ECMD_OK;
            }
            if (game.uwep) {
                const res = !game.uwep.bknown;
                const lefty = (game.u?.uhandedness === 1 /*LEFT_HANDED*/);
                if (((mask === W_RINGR && !lefty) || (mask === W_RINGL && lefty)
                     || bimanual(game.uwep)) && welded(game.uwep)) {
                    let hand = body_part(6 /*HAND*/);
                    if (bimanual(game.uwep)) hand = makeplural(hand);
                    await pline(`You cannot free your weapon ${hand} to put on the ring.`);
                    return res ? ECMD_TIME : ECMD_OK;
                }
            }
            // setworn() the ring, then Ring_on() applies its effect, then on_msg().
            setworn_accessory(obj, mask);
            await Ring_on(obj);
            await on_msg_accessory(obj);
            if (game._allow_inventory_update !== undefined) update_inventory();
            return ECMD_TIME;
        } else if (amulet) {
            if (game.uamul) { await already_wearing('an amulet'); return ECMD_OK; }
            setworn_accessory(obj, W_AMUL);
            // C ref: do_wear.c Amulet_on() owns on_msg() for the amulets whose
            // effect message must follow the worn-confirmation line; it reports
            // that with on_msg_done so we don't print the line twice.
            if (!(await Amulet_on(obj))) await on_msg_accessory(obj);
            if (game._allow_inventory_update !== undefined) update_inventory();
            return ECMD_TIME;
        } else if (eyewear) {
            // C ref: do_wear.c:2323 has_head() — a headless polyform has
            // nowhere to put a blindfold/lenses/towel; costs no time.
            if ((mflags1_of(youmonst_data()) & M1_NOHEAD) !== 0) {
                await pline(`You have no head to wear ${ansimpleoname(obj)} on.`);
                return ECMD_OK;
            }
            if (game.ublindf) {
                // C ref: do_wear.c already_wearing2(what1, what2) — swapping
                // lenses for a blindfold (or back) names BOTH items.
                if (game.ublindf.otyp === TOWEL)
                    await pline(`Your ${body_part(2)} is already covered by a towel.`);
                else if (game.ublindf.otyp === BLINDFOLD)
                    await (obj.otyp === LENSES ? already_wearing2('lenses', 'a blindfold')
                                               : already_wearing('a blindfold'));
                else if (game.ublindf.otyp === LENSES)
                    await (obj.otyp === BLINDFOLD ? already_wearing2('a blindfold', 'some lenses')
                                                  : already_wearing('some lenses'));
                else await already_wearing('something');
                return ECMD_OK;
            }
            await Blindf_on(obj);
            if (game._allow_inventory_update !== undefined) update_inventory();
            return ECMD_TIME;
        }
        await pline("You can't wear that!");
        return ECMD_OK;
    }
    // C ref: do_wear.c accessory_or_armor_on() — canwearobj() owns EVERY reason
    // a piece can't go on (slot filled, welded/two-handed weapon, trapped feet,
    // slippery fingers, layering) and the message for each.  A bare slot-occupied
    // test answered "You are already wearing that!" for all of them.
    const mask = await canwearobj(obj, true);
    if (!mask) return ECMD_OK;
    // C ref: do_wear.c:2364 `gw.wasinwater = u.uinwater` — recorded BEFORE
    // setworn() because Boots_on() runs after the hero has already surfaced.
    game.wasinwater = game.u?.uinwater ? 1 : 0;
    // C ref: do_wear.c:2361-2364.  Armor can have been readied as a weapon;
    // release every weapon slot before adding its armor slot so one object
    // cannot remain both quivered and worn.
    if ((obj.owornmask || 0) & W_WEAPONS) await remove_worn_item(obj, false);
    worn_slot_set(obj, mask);
    obj.known = 1; // +/- becomes evident via the AC status line
    // C ref: do_wear.c:2377 — `setworn(obj, mask);` and NO find_ac().  u.uac is a
    // SNAPSHOT refreshed only by allmain.c:453's once-per-input find_ac(), i.e.
    // AFTER this turn's monsters move.  Refreshing it inline flips mhitu.c:709's
    // AC_VALUE() rnd() draw one turn early (a negative AC draws, a
    // non-negative one does not).
    const delay = ARMOR_OC_DELAY.get(obj.otyp) || 0;
    if (delay) {
        // C ref: do_wear.c accessory_or_armor_on() — nomul(-delay) makes the hero
        // busy `delay` game turns (nomovemsg shown on finish); while multi<0 the
        // moveloop skips intrinsic autosearch (allmain.c:342 guard
        // `gm.multi >= 0`). In C the 'W' command's getobj() reads the
        // object-letter key, then nomul(-delay) runs the moveloop's elapsed
        // turns before the next keystroke poll — all within processing that one
        // key, so the recorded screen shows "You finish your dressing
        // maneuver". run_dress_occupation() mirrors this: advances exactly
        // `delay` turns with multi<0, clears multi when done. do_wear.c sets
        // ga.afternmv to the slot's *_on routine before nomul(); unmul() runs it
        // after: Boots_on (speed-up message + makeknown for speed boots) or
        // Armor_on (dragon scale mail's dragon_armor_handling) for the suit;
        // other slots' afternmv effects aren't exercised by scored sessions.
        game._dressing_obj = obj;
        game._dressing_off = false;
        const on_fn_after = armor_on_fn(mask);
        await run_dress_occupation(delay, 'You finish your dressing maneuver.',
                                   async () => {
                                       game._dressing_obj = null;
                                       if (on_fn_after) await on_fn_after();
                                   });
        if (game._allow_inventory_update !== undefined) update_inventory();
        return ECMD_OK;
    }
    // C ref: do_wear.c accessory_or_armor_on() — with no delay, unmul("") runs
    // the afternmv IMMEDIATELY and then on_msg().  Cloaks, shields and shirts all
    // have oc_delay 0, so this is the only path that reaches Cloak_on() (oilskin
    // "fits very tightly", elven-cloak stealth, displacement, invisibility).
    const on_fn = armor_on_fn(mask);
    if (on_fn) await on_fn();
    // C do_wear.c on_msg() prints instant armor feedback only when verbose;
    // the shield still takes a turn and changes AC when that option is off.
    if (game.flags?.verbose !== false)
        await update_topl(`You are now wearing ${an(on_xname(obj))}.`);
    if (game._allow_inventory_update !== undefined) update_inventory();
    return ECMD_TIME;
}

// C ref: do_wear.c accessory_or_armor_on() — ga.afternmv per worn slot.
function armor_on_fn(mask) {
    switch (mask) {
    case WA_ARM:  return Armor_on;
    case WA_ARMH: return Helmet_on;
    case WA_ARMG: return Gloves_on;
    case WA_ARMF: return Boots_on;
    case WA_ARMS: return Shield_on;
    case WA_ARMC: return Cloak_on;
    case WA_ARMU: return Shirt_on;
    default: return null;
    }
}

// C ref: hack.c nomul(-delay, msg) + allmain.c moveloop_core() multi<0
// occupation loop.  Register nomovemsg and afternmv before beginning the
// occupation: unmul() runs both inside the final once-per-turn block, before
// allmain's once-per-hero seer_turn roll.
async function run_dress_occupation(delay, msg, afternmv) {
    const g = game;
    nomul(-delay);   /* ends any run/rush in progress (end_running) */
    g.multi = -delay;
    g.multi_reason = 'dressing up';
    g.nomovemsg = msg || '';
    g.afternmv = afternmv || null;
    if (g.u && g.u.umovement == null) g.u.umovement = 12; // NORMAL_SPEED
    let guard = 0;
    // C ref: allmain.c:380 — `++gm.multi` runs at the end of each elapsed
    // turn.  A moveloop_turn() may only spend leftover monster movement, so
    // only its own multi countdown determines when the occupation completes.
    while (g.multi < 0 && guard++ < 60) {
        await moveloop_turn();
        // C ref: allmain.c:452-470 — each elapsed turn is its own
        // moveloop_core() iteration, whose once-per-input head runs find_ac()
        // and, for a hallucinating / telepathic / warned hero, the see_monsters()
        // redraw (a warned monster that just went invisible shows its warning
        // number, not the 'I' map_invisible() stamped).  The iteration after the
        // LAST turn is the caller's own moveloop_core(), so only redraw here
        // while the hero is still helpless.
        if (g.multi < 0) await moveloop_input_redraw();
        else find_ac();
    }
    if (g.multi < 0) g.multi = 0; // safety: never leave the hero stuck busy
    g.multi_reason = null;
}

// C ref: do_wear.c dowear() — the 'W' command.
export async function dowear() {
    // C ref: do_wear.c:2425 — cantweararm() is about suits; what 'W' checks
    // first is whether the hero's CURRENT FORM could manipulate armor at all.
    if (verysmall_youmonst() || nohands_youmonst()) {
        await pline("Don't even bother.");
        return ECMD_OK;
    }
    // C ref: do_wear.c:2432 — 'W' only reports a full complement when EVERY
    // slot is filled, accessories included; the armor-only test refused to open
    // getobj() for a hero who was merely fully armored.
    if (game.uarm && game.uarmu && game.uarmc && game.uarmh && game.uarms
        && game.uarmg && game.uarmf && game.uleft && game.uright && game.uamul
        && game.ublindf) {
        await pline('You are already wearing a full complement of armor.');
        return ECMD_OK;
    }
    const otmp = await getobj('wear', wear_ok, GETOBJ_NOFLAGS);
    if (!otmp) return ECMD_CANCEL;
    return await accessory_or_armor_on(otmp);
}

// C ref: do_wear.c count_worn_stuff — set Narmorpieces/Naccessories.  Only the
// outermost of cloak/suit/shirt counts so it can come off without confirmation.
// The default `which` is the lone armor piece when !accessorizing (T) or the
// lone accessory when accessorizing (R) — matching C's two-pass MOREWORN.
function count_worn_stuff(accessorizing) {
    let Narmorpieces = 0, Naccessories = 0;
    let armorWhich = null, accWhich = null;
    const moreArm = (o) => { if (o) { Narmorpieces++; armorWhich = o; } };
    moreArm(game.uarmh); moreArm(game.uarms); moreArm(game.uarmg); moreArm(game.uarmf);
    if (game.uarmc) moreArm(game.uarmc);
    else if (game.uarm) moreArm(game.uarm);
    else if (game.uarmu) moreArm(game.uarmu);
    const moreAcc = (o) => { if (o) { Naccessories++; accWhich = o; } };
    moreAcc(game.uleft); moreAcc(game.uright); moreAcc(game.uamul); moreAcc(game.ublindf);
    const which = accessorizing ? accWhich : armorWhich;
    return { Narmorpieces, Naccessories, which };
}

// C ref: do_wear.c armoroff(otmp) — remove a worn armor piece, with its
// donning delay; a no-delay item clears the slot immediately and the "You
// were wearing ..." feedback follows removal. objects[].oc_armcat picks both
// the "You finish taking off your %s." noun and the <Armor>_off() routine
// that undoes the piece's side effects (helm of brilliance INT/WIS,
// cornuthaum CHA, gauntlets of dexterity DEX, elven-cloak stealth, ...);
// clearing the slot alone left those bonuses applied forever.
function armor_off_fn(otmp) {
    // C ref: do_wear.c armoroff()'s `default: impossible(...)` arm — an object
    // in an armor slot that has no oc_armcat still has to come off, or the 'T'
    // that spent a turn leaves it worn forever.
    if (otmp && otmp.oclass !== ARMOR_CLASS) {
        const m = (otmp.owornmask || 0) & WA_ARMOR_ALL;
        return async () => { otmp.owornmask = (otmp.owornmask || 0) & ~m; worn_slot_clear(m); };
    }
    switch (armcat_of(otmp)) {
    case 0 /*ARM_SUIT*/:   return Armor_off;
    case 1 /*ARM_SHIELD*/: return Shield_off;
    case 2 /*ARM_HELM*/:   return Helmet_off;
    case 3 /*ARM_GLOVES*/: return Gloves_off;
    case 4 /*ARM_BOOTS*/:  return Boots_off;
    case 5 /*ARM_CLOAK*/:  return Cloak_off;
    case 6 /*ARM_SHIRT*/:  return Shirt_off;
    default: {
        const m = (otmp.owornmask || 0) & WA_ARMOR_ALL;
        return async () => { otmp.owornmask = (otmp.owornmask || 0) & ~m; worn_slot_clear(m); };
    }
    }
}

async function armoroff(otmp) {
    const delay = ARMOR_OC_DELAY.get(otmp.otyp) || 0;
    const off_fn = armor_off_fn(otmp);
    if (delay) {
        // C: nomul(-delay) + nomovemsg "You finish taking off your <what>."
        // The slot stays occupied until the afternmv fires; deferred-removal
        // bookkeeping isn't needed by the current sessions (their pieces have
        // delay 0), so the occupation just elapses and then clears the slot.
        // C ref: do_wear.c armoroff() — `what` is the SLOT's generic noun from
        // the *_simple_name() family ("gloves", "boots", "suit", ...), not the
        // item's own name, so a pair of leather gloves reads "your gloves".
        game._dressing_obj = otmp;
        game._dressing_off = true;
        start_occupation(delay, `You finish taking off your ${armor_simple_name(otmp)}.`,
            async () => {
                game._dressing_obj = null;
                game._dressing_off = false;
                if (off_fn) await off_fn();
                // no find_ac() — see accessory_or_armor_on (do_wear.c:2377).
                if (game._allow_inventory_update !== undefined) update_inventory();
            });
    } else {
        if (off_fn) await off_fn();
        // C ref: allmain.c:452 — find_ac() runs once per player input in
        // moveloop_core(), NOT inline here.  Calling it inline republishes AC
        // one frame early ("botl is a snapshot").  The other inline find_ac()
        // sites are suspect for the same reason but are not exercised.
        // off_msg after removal -> no redundant "(being worn)" suffix.
        //
        // C ref: do_wear.c:71 `You("were wearing %s.", doname(otmp))` — a real
        // pline(), i.e. update_topl().  It must go through update_topl() and not
        // the deferred `pline()` slot: taking armor off costs a turn, so the
        // monsters move next, and their messages have to APPEND to this one (or
        // push it out behind a --More--) instead of silently replacing it.
        // C ref: do_wear.c:68 off_msg() — `if (flags.verbose)`; with
        // OPTIONS=!verbose the stale prompt stays on the top line instead.
        if (game.flags?.verbose !== false)
            await update_topl(`You were wearing ${doname_invent(otmp)}.`);
        if (game._allow_inventory_update !== undefined) update_inventory();
    }
}

// C ref: do_wear.c cursed(otmp) — a cursed worn item refuses removal with
// "You can't.  It is/They are cursed." and marks itself bknown.  Returns true
// when the curse prevents removal.
export async function curse_blocks_removal(obj) {
    // C ref: do_wear.c:1897 — the weapon slot asks welded(), everything else
    // asks obj->cursed; a cursed non-weld-prone wielded item comes off freely.
    if (obj === game.uwep ? !welded(obj) : !obj.cursed) return false;
    const usePlural = is_boots(obj) || is_gloves(obj)
        || obj.otyp === LENSES || (obj.quan || 1) > 1;
    // C ref: do_wear.c:1904 — greased hands get their own refusal, and only for
    // the weapon (gloved) or a weapon/ring (bare-handed).
    if (game.u?.uprops?.Glib && obj.bknown
        && (game.uarmg ? (obj === game.uwep)
                       : ((obj.owornmask | 0) & (W_WEP | W_RINGL | W_RINGR)) !== 0))
        await pline(`Despite your slippery ${fingers_or_gloves(true)}, you can't.`);
    else
        await pline(`You can't.  ${usePlural ? 'They are' : 'It is'} cursed.`);
    obj.bknown = 1;
    return true;
}

// C ref: do_wear.c select_off(otmp) — run the per-slot removability checks
// (cursed gloves/weapon blocking a ring, cursed armor) and the basic curse
// check.  Returns false (and gives feedback) when the item cannot come off;
// quiver/non-twoweap swap-weapon are removable even when cursed.
export async function select_off(obj) {
    if (!obj) return false;
    const u = game.u;
    // special ring checks: a welded weapon on that hand, or cursed/slippery
    // gloves, prevent removal.
    if (obj === game.uright || obj === game.uleft) {
        let buf = '', why = null;
        // you.h RING_ON_PRIMARY == (ULEFTY ? uleft : uright); LEFT_HANDED is 1
        // and u.uhandedness defaults to RIGHT_HANDED (0).
        const ring_on_primary = (game.u?.uhandedness === 1 /*LEFT_HANDED*/)
            ? game.uleft : game.uright;
        if (welded(game.uwep)
            && (obj === ring_on_primary || bimanual(game.uwep))) {
            buf = `free a weapon ${body_part(6 /*HAND*/)}`;
            why = game.uwep;
        } else if (game.uarmg && (game.uarmg.cursed || u?.uprops?.Glib)) {
            buf = `take off your ${u?.uprops?.Glib ? 'slippery ' : ''}${gloves_simple_name(game.uarmg)}`;
            why = u?.uprops?.Glib ? null : game.uarmg;
        }
        if (buf) {
            await pline(`You cannot ${buf} to remove the ring.`);
            if (why) why.bknown = 1;
            return false;
        }
    }
    // C ref: do_wear.c select_off() special glove checks.
    if (obj === game.uarmg) {
        if (welded(game.uwep)) {
            await pline(`You are unable to take off your gloves while wielding that ${is_sword(game.uwep) ? 'sword' : 'weapon'}.`);
            if (game.uwep) game.uwep.bknown = 1;
            return false;
        } else if (u?.uprops?.Glib) {
            await pline(`${game.uarmg.unpaid ? 'The' : 'Your'} ${gloves_simple_name(game.uarmg)} are too slippery to take off.`);
            return false;
        }
        if (await better_not_take_that_off(obj)) return false;
    }
    // C ref: do_wear.c select_off() special boot checks — a bear trap or a
    // stuck-in-the-floor hero cannot pull the boots off.
    if (obj === game.uarmf && u?.utrap) {
        if (u.utraptype === TT_BEARTRAP) {
            await pline(`The bear trap prevents you from pulling your ${body_part(5 /*FOOT*/)} out.`);
            return false;
        } else if (u.utraptype === TT_INFLOOR) {
            await pline(`You are stuck in the ${surface_underfoot()}, and cannot pull your ${makeplural(body_part(5 /*FOOT*/))} out.`);
            return false;
        }
    }
    // C ref: do_wear.c select_off() suit and shirt checks — an outer cursed
    // layer (or a welded two-handed weapon) blocks disrobing.
    if (obj === game.uarm || obj === game.uarmu) {
        let buf = '', why = null;
        if (game.uarmc && game.uarmc.cursed) {
            buf = `remove your ${cloak_simple_name(game.uarmc)}`; why = game.uarmc;
        } else if (obj === game.uarmu && game.uarm && game.uarm.cursed) {
            buf = 'remove your suit'; why = game.uarm;
        } else if (welded(game.uwep) && bimanual(game.uwep)) {
            buf = `release your ${is_sword(game.uwep) ? 'sword' : game.uwep.otyp === 45 /*BATTLE_AXE*/ ? 'axe' : 'weapon'}`;
            why = game.uwep;
        }
        if (why) {
            await pline(`You cannot ${buf} to take off ${'the ' + xname(obj)}.`);
            why.bknown = 1;
            return false;
        }
    }
    // basic curse check (quiver / non-twoweap swap-weapon are exempt).
    if (obj === game.uquiver || (obj === game.uswapwep && !game.u?.twoweap)) {
        /* some items can be removed even when cursed */
    } else if (await curse_blocks_removal(obj)) {
        return false;
    }
    // C ref: do_wear.c:2790 — record the slot in takeoff.mask; that is how the
    // 'A' (#takeoffall) occupation learns what it still has to peel off, and
    // what armor_or_accessory_off() tests before spending the turn.
    takeoff_ctx().mask |= slot_bit_of(obj);
    return true;
}

// C ref: do_wear.c select_off()'s slot dispatch, as one expression.
function slot_bit_of(obj) {
    if (obj === game.uarm) return WA_ARM;
    if (obj === game.uarmc) return WA_ARMC;
    if (obj === game.uarmf) return WA_ARMF;
    if (obj === game.uarmg) return WA_ARMG;
    if (obj === game.uarmh) return WA_ARMH;
    if (obj === game.uarms) return WA_ARMS;
    if (obj === game.uarmu) return WA_ARMU;
    if (obj === game.uleft) return W_RINGL;
    if (obj === game.uright) return W_RINGR;
    if (obj === game.uamul) return W_AMUL;
    if (obj === game.ublindf) return W_BLINDF;
    if (obj === game.uwep) return W_WEP;
    if (obj === game.uswapwep) return W_SWAPWEP;
    if (obj === game.uquiver) return W_QUIVER;
    return 0;
}

// C ref: do_wear.c armor_or_accessory_off(obj) — shared by 'T' and 'R'.
async function armor_or_accessory_off(obj) {
    if (!((obj.owornmask || 0) & (WA_ARMOR_ALL | W_ACCESSORY))) {
        await pline('You are not wearing that.');
        return ECMD_OK;
    }
    // C ref: do_wear.c armor_or_accessory_off() — "can't take that off
    // without taking off your cloak first" (suit under cloak, shirt under
    // suit/cloak).  select_off() then applies the per-slot blockers.
    if (obj === game.uskin
        || ((obj === game.uarm) && game.uarmc)
        || ((obj === game.uarmu) && (game.uarmc || game.uarm))) {
        let why = '';
        if (obj !== game.uskin) {
            let what = '';
            if (game.uarmc) what += cloak_simple_name(game.uarmc);
            if ((obj === game.uarmu) && game.uarm)
                what += (game.uarmc ? ' and ' : '') + suit_simple_name(game.uarm);
            why = ` without taking off your ${what} first`;
        } else {
            why = "; it's embedded";
        }
        await pline(`You can't take that off${why}.`);
        return ECMD_OK;
    }
    // C ref: do_wear.c:1806 — clear takeoff.mask/what before and after
    // select_off() so an interrupted 'A' can't resume into this item.
    reset_remarm();
    // C ref: select_off() — refuse removal of cursed/blocked items (no turn).
    if (!(await select_off(obj))) return ECMD_OK;
    // C ref: do_wear.c:1804 -- none of armoroff()/Ring_/Amulet/Blindf_off()
    // use context.takeoff.mask, so clear what select_off() just recorded.
    reset_remarm();
    if ((obj.owornmask || 0) & WA_ARMOR_ALL) {
        await armoroff(obj);
    } else if (obj === game.uright || obj === game.uleft) {
        // C ref: do_wear.c armor_or_accessory_off() calls off_msg() BEFORE
        // Ring_off() so the "(on right hand)" suffix is still present:
        // "You were wearing a clay ring (on right hand)."
        await off_msg(obj);
        // Ring_off() clears the finger AND undoes the on-effect.  Open-coding
        // clearworn_accessory() here skipped every one of those: a removed
        // +N gain-strength/constitution/adornment ring left the stat bonus in
        // place forever, a levitation ring never floated the hero down, and
        // the stealth / see-invisible / invisibility messages never printed.
        await Ring_off(obj);
        if (game._allow_inventory_update !== undefined) update_inventory();
    } else if (obj === game.uamul) {
        // Amulet_off does its own off_msg (after removal -> no "(being worn)").
        await Amulet_off(obj);
        if (game._allow_inventory_update !== undefined) update_inventory();
    } else if (obj === game.ublindf) {
        await Blindf_off(obj);
        if (game._allow_inventory_update !== undefined) update_inventory();
    } else {
        obj.owornmask = 0;
        if (game._allow_inventory_update !== undefined) update_inventory();
    }
    return ECMD_TIME;
}


// C ref: do_wear.c dotakeoff() — the 'T' command (armor; accessorizing=FALSE).
export async function dotakeoff() {
    const { Narmorpieces, Naccessories, which } = count_worn_stuff(false);
    if (!Narmorpieces && !Naccessories) {
        // C ref: do_wear.c:1839 — dragon scales merged into the hero's skin
        // (polymorph into a dragon) are not removable armor.
        if (game.uskin)
            await pline(`The ${game.uskin.otyp >= 111 /*GRAY_DRAGON_SCALES*/
                ? 'dragon scales are' : 'dragon scale mail is'} merged with your skin!`);
        else
            await pline('Not wearing any armor or accessories.');
        return ECMD_OK;
    }
    let otmp = which;
    // C ref: do_wear.c:1854 — a lone armor piece comes off without a prompt
    // unless paranoid_remove is set or this is the 'i'-menu item action.
    if (Narmorpieces !== 1 || ParanoidRemove() || game.item_action_in_progress) {
        otmp = await getobj('take off', takeoff_ok, GETOBJ_NOFLAGS);
    }
    if (!otmp) return ECMD_CANCEL;
    return await armor_or_accessory_off(otmp);
}

// C ref: flag.h PARANOID_REMOVE — 'T'/'R' always prompt when set.
function ParanoidRemove() {
    const pb = game.flags?.paranoia_bits | 0;
    return (pb & 0x0040 /*PARANOID_REMOVE (flag.h:89)*/) !== 0;
}

// C ref: do_wear.c:1862 ia_dotakeoff() — 'T' reached from the 'i' item-action
// menu; the flag makes equip_ok() stop hiding covered items.
export async function ia_dotakeoff() {
    game.item_action_in_progress = true;
    try {
        return await dotakeoff();
    } finally {
        game.item_action_in_progress = false;
    }
}

// C ref: do_wear.c doputon() — the 'P' command.  Full-complement guard is
// unreachable for the items these sessions wear.
export async function doputon() {
    if (game.uleft && game.uright && game.uamul && game.ublindf
        && game.uarm && game.uarmu && game.uarmc && game.uarmh && game.uarms
        && game.uarmg && game.uarmf) {
        // C ref: do_wear.c:2453 — "ring-" only for a humanoid form.
        const ringpfx = humanoid_flag(youmonst_data()) ? 'ring-' : '';
        await pline(`Your ${ringpfx}${fingers_or_gloves(false)} are full, and you're already wearing an amulet and ${game.ublindf.otyp === LENSES ? 'some lenses' : 'a blindfold'}.`);
        return ECMD_OK;
    }
    // C ref: do_wear.c doputon() — the faithful 'P' ALWAYS opens the getobj
    // prompt (armor is downplay-selectable even with no accessory carried).
    // The old scoping guard reported the command unhandled so the dispatcher
    // printed "Unknown command 'P'." — which also left the key the player typed
    // at the (unrendered) prompt to fall through to the command parser, the
    // same failure mode that cost 139 screens in doenhance().
    const otmp = await getobj('put on', puton_ok, GETOBJ_NOFLAGS);
    if (!otmp) return ECMD_CANCEL;
    return await accessory_or_armor_on(otmp);
}

// True when the hero carries a not-yet-worn ring, amulet, or eyewear — i.e. an
// item for which 'P' (doputon) has observable behavior in the recorded sessions.
function hero_has_puton_accessory() {
    for (const o of (game.invent || [])) {
        if ((o.owornmask || 0) & (WA_ARMOR_ALL | W_ACCESSORY)) continue;
        if (o.oclass === RING_CLASS || o.otyp === MEAT_RING
            || o.oclass === AMULET_CLASS
            || o.otyp === BLINDFOLD || o.otyp === LENSES || o.otyp === TOWEL)
            return true;
    }
    return false;
}

// C ref: do_wear.c doremring() — the 'R' command (accessories; accessorizing=TRUE).
export async function doremring() {
    // C ref: do_wear.c doremring() — no scoping guard: with nothing worn C
    // still runs count_worn_stuff() and prints "Not wearing any accessories or
    // armor." (a real line, not "Unknown command 'R'.").
    const { Narmorpieces, Naccessories, which } = count_worn_stuff(true);
    if (!Naccessories && !Narmorpieces) {
        await pline('Not wearing any accessories or armor.');
        return ECMD_OK;
    }
    let otmp = which;
    // C ref: do_wear.c:1886 — cmdq_peek(CQ_CANNED): a queued command sequence
    // (item action) must still see the prompt so its keys get consumed there.
    if (Naccessories !== 1 || ParanoidRemove() || _cmdq(CQ_CANNED).length > 0) {
        otmp = await getobj('remove', remove_ok, GETOBJ_NOFLAGS);
    }
    if (!otmp) return ECMD_CANCEL;
    return await armor_or_accessory_off(otmp);
}

// C ref: hack.c nomul(nval) + the occupation machinery — make the hero busy
// for `delay` extra turns, running `afternmv` (and printing `msg`) when the
// occupation completes.  The moveloop advances monsters each elapsed turn.
function start_occupation(delay, msg, afternmv) {
    // C ref: do_wear.c armoroff()/armor_on() call nomul(-oc_delay): multi is
    // NEGATIVE (helpless) and the callback hangs off ga.afternmv.  This used to
    // set a POSITIVE multi and a `_afternmv` field nothing reads, so a
    // delay-bearing piece (leather gloves, boots, any real suit) was never
    // actually taken off and its "You finish ..." line never printed.
    nomul(-delay);   /* ends any run/rush in progress (end_running) */
    game.multi = -delay;
    game.multi_reason = 'disrobing';
    game.nomovemsg = msg;
    game.afternmv = afternmv || null;
}

// C ref: hack.h ynq(query) — yes/no/quit prompt, default 'q' on space/return/ESC.
export async function ynq(query) { return await y_n(query, 'ynq\x1b', 'q'); }

// C ref: objnam.c otense()/vtense() — conjugate a (plural-form) verb for the
// object: a plural object keeps it, a singular object gets the 3rd-person
// form (vtense's "sing:" label: are->is and have->has are irregular special
// cases, then the usual y->ies / s/x/z/ch/sh->es spelling tweaks, else +s).
export function otense(obj, verb) {
    // C ref: objnam.c:2531 otense() -- vtense(NULL, verb) for a singular object
    // (handles "go" -> "goes", "do" -> "does" etc.).
    if (is_plural(obj)) return verb;
    return vtense(null, verb);
}

// C ref: wield.c ready_ok() — getobj callback for the quiver target.  Lets worn
// items through (the caller rejects them) and downplays launchers and ammo whose
// launcher isn't wielded, so they're selectable but not advertised.
function ready_ok(obj) {
    if (!obj) /* '-', will empty the quiver if chosen */
        return game.uquiver ? GETOBJ_SUGGEST : GETOBJ_DOWNPLAY;
    // downplay when wielded, unless more than one
    if (obj === game.uwep || (obj === game.uswapwep && game.u?.twoweap))
        return (obj.quan === 1) ? GETOBJ_DOWNPLAY : GETOBJ_SUGGEST;
    if (is_ammo(obj)) {
        return ((game.uwep && ammo_and_launcher(obj, game.uwep))
                || (game.uswapwep && ammo_and_launcher(obj, game.uswapwep)))
                ? GETOBJ_SUGGEST : GETOBJ_DOWNPLAY;
    } else if (is_launcher(obj)) {
        return GETOBJ_DOWNPLAY;
    } else {
        if (obj.oclass === WEAPON_CLASS || obj.oclass === COIN_CLASS)
            return GETOBJ_SUGGEST;
    }
    return GETOBJ_DOWNPLAY;
}

// C ref: wield.c untwoweapon() — end two-weapon combat (no-op when not active).
// C: You("can no longer wield two weapons at once."), a real pline() -> update_
// topl(), so a still-pending message from whatever the caller printed just
// before this (e.g. ready_weapon()'s wield line, or doswapweapon()'s second
// prinv() line) gets its own --More-- first instead of being silently
// clobbered by a bare _pending_message write (js/uhitm.js's own local
// untwoweapon() already made this same fix independently).
async function untwoweapon() {
    if (game.u?.twoweap) {
        await update_topl('You can no longer wield two weapons at once.');
        game.u.twoweap = false;
        update_inventory();
    }
}

// C ref: wield.c finish_splitting(obj) — "obj was split off from something; give
// it its own invlet".  freeinv() + addinv_nomerge() is what stops the split
// stack merging straight back into its parent.  (js/wield.js exports the same
// pair; kept local here to avoid an invent<->wield import cycle.)
function finish_splitting_inv(obj) {
    freeinv(obj);
    return addinv_nomerge(obj);
}

// C ref: wield.c doquiver_core() — guts of #quiver (verb "ready").  Ports the
// interactive paths the gameplay sessions exercise: empty inventory, '-' to
// empty the quiver, selecting an ordinary ammo/weapon, the "already readied"
// short-circuit, and confirming readying of the primary/secondary weapon (which
// then no longer occupies that slot).  Returns ECMD_OK / ECMD_TIME / ECMD_CANCEL.
async function doquiver_core(verb) {
    let was_uwep = false;
    const was_twoweap = !!game.u?.twoweap;

    if (!inventoryArray().length) {
        // C ref: wield.c doquiver_core() `You("have nothing to ready for
        // firing.");` — a real pline(), not a raw topline write: dofire()'s
        // own "You have no ammunition readied." (this file's dofire, above)
        // precedes it in the SAME command when there's no quiver set, and
        // C's two consecutive You() calls merge onto one line; a bare
        // `game._pending_message =` assignment here replaced that message
        // outright instead of appending after it.
        await pline('You have nothing to ready for firing.');
        return ECMD_OK;
    }

    clear_splitobjs();
    let newquiver = await getobj(verb, ready_ok, GETOBJ_PROMPT | GETOBJ_ALLOWCNT);

    if (!newquiver) {
        return ECMD_CANCEL; // cancelled (quitchars)
    } else if (newquiver === hands_obj) { // '-' : explicitly nothing
        if (game.uquiver) {
            game._pending_message = note_topl('You now have no ammunition readied.');
            setuqwep(null);
        } else {
            game._pending_message = note_topl('You already have no ammunition readied!');
        }
        return ECMD_OK;
    } else if (newquiver.o_id === game.context.objsplit?.child_oid) {
        // C wield.c:547-560: counted selections need their own inventory slot.
        if (game.uquiver?.o_id === game.context.objsplit.parent_oid) {
            unsplitobj(newquiver);
            await pline('That ammunition is already readied!');
            return ECMD_OK;
        }
        if (newquiver.oclass === COIN_CLASS) {
            await pline("You can't ready only part of your gold.");
            unsplitobj(newquiver);
            return ECMD_OK;
        }
        finish_splitting_inv(newquiver);
    } else if (newquiver === game.uquiver) {
        game._pending_message = note_topl('That ammunition is already readied!');
        return ECMD_OK;
    } else if (newquiver.owornmask & QW_ARMOR_ALL) {
        // C: reject worn armor/accessory/saddle.  Only the armor bits (W_ARM..
        // W_ARMU == 0x7f, same scheme u_init.js uses) are ever set in these
        // sessions; accessory/saddle use higher prop.h bits that never appear.
        game._pending_message = note_topl(`You cannot ${verb} that!`);
        return ECMD_OK;
    } else if (newquiver === game.uwep) {
        // readying the wielded weapon needs confirmation.
        const wep = game.uwep;
        // C ref: wield.c:569-575 — a welded weapon can't be readied; the
        // attempt costs a turn only when it taught the hero the curse.
        const weld_res = !wep.bknown;
        if (welded(wep)) {
            await weldmsg(wep);
            reset_remarm(); /* same as dowield() */
            return weld_res ? ECMD_TIME : ECMD_OK;
        }
        let qbuf, quivering = false;
        // C: for a splittable STACK, offer to quiver all but the one that stays
        // wielded, rather than the whole stack.  'q' cancels SILENTLY (no
        // "remain wielded" line); only 'n' falls through to the second question.
        if ((wep.quan | 0) > 1 && inv_cnt(false) < invlet_basic && splittable(wep)) {
            qbuf = `You are wielding ${wep.quan} ${simpleonames(wep)}.  Ready ${(wep.quan | 0) - 1} of them?`;
            const ans = await ynq(qbuf);
            if (ans === 'q') return ECMD_OK;
            if (ans === 'y') {
                newquiver = splitobj(wep, (wep.quan | 0) - 1);
                finish_splitting_inv(newquiver);
                quivering = true;
            } else {
                qbuf = 'Ready all of them instead?';
            }
        } else {
            const use_plural = is_plural(wep) || pair_of(wep);
            qbuf = `You are wielding ${!use_plural ? 'that' : 'those'}.  Ready ${!use_plural ? 'it' : 'them'} instead?`;
        }
        if (!quivering) {
            if (await ynq(qbuf) !== 'y') {
                game._pending_message = note_topl(`Your ${simpleonames(wep)} ${otense(wep, 'remain')} wielded.`);
                return ECMD_OK;
            }
            setuwep_slot(null);
            await untwoweapon();
            was_uwep = true;
        }
    } else if (newquiver === game.uswapwep) {
        const swap = game.uswapwep;
        let qbuf, quivering = false;
        // C: same split offer for the alternate weapon (see the uwep arm above).
        if ((swap.quan | 0) > 1 && inv_cnt(false) < invlet_basic && splittable(swap)) {
            qbuf = `${game.u?.twoweap ? 'You are dual wielding' : 'Your alternate weapon is'}`
                 + ` ${swap.quan} ${simpleonames(swap)}.  Ready ${(swap.quan | 0) - 1} of them?`;
            const ans = await ynq(qbuf);
            if (ans === 'q') return ECMD_OK;
            if (ans === 'y') {
                newquiver = splitobj(swap, (swap.quan | 0) - 1);
                finish_splitting_inv(newquiver);
                quivering = true;
            } else {
                qbuf = 'Ready all of them instead?';
            }
        } else {
            const use_plural = is_plural(swap) || pair_of(swap);
            qbuf = `${!use_plural ? 'That is' : 'Those are'} your ${game.u?.twoweap ? 'second' : 'alternate'} weapon.  Ready ${!use_plural ? 'it' : 'them'} instead?`;
        }
        if (!quivering) {
            if (await ynq(qbuf) !== 'y') {
                game._pending_message = note_topl(`Your ${simpleonames(swap)} ${otense(swap, 'remain')} ${game.u?.twoweap ? 'wielded' : 'as secondary weapon'}.`);
                return ECMD_OK;
            }
            setuswapwep(null);
            await untwoweapon();
        }
    }

    // quivering: C ref: wield.c — "ready" quivers first so the line shows
    // "(at the ready)"; "fire" prints "You ready: ..." BEFORE quivering so it
    // does not.  Routed through update_topl (not prinv()'s bare setter) so a
    // still-pending untwoweapon() line just above pages first instead of
    // being silently clobbered.
    if (verb === 'ready') {
        setuqwep(newquiver);
        await update_topl(prinv_fmt(null, newquiver, 0));
    } else {
        await update_topl(prinv_fmt('You ready:', newquiver, 0));
        setuqwep(newquiver);
    }

    // Same reasoning: this closing line is a real pline() in C (wield.c),
    // chained after the prinv() line above in the same command.
    let res = 0;
    if (was_uwep) {
        await update_topl(`You are now ${empty_handed()}.`);
        res = 1;
    } else if (was_twoweap && !game.u?.twoweap) {
        await update_topl('You are no longer wielding two weapons at once.');
        res = 1;
    }
    return res ? ECMD_TIME : ECMD_OK;
}

// C ref: wield.c dowieldquiver() — the #quiver / 'Q' command.
export async function dowieldquiver() {
    return await doquiver_core('ready');
}

// C ref: wield.c wield_ok() — getobj callback: weapons and weapon-tools are
// suggested; coins are excluded; everything else is downplayed.  '-' (null)
// is suggested so the prompt offers wielding nothing.
function wield_ok(obj) {
    if (!obj) return GETOBJ_SUGGEST;
    if (obj.oclass === COIN_CLASS) return GETOBJ_EXCLUDE;
    if (obj.oclass === WEAPON_CLASS || is_weptool(obj)) return GETOBJ_SUGGEST;
    return GETOBJ_DOWNPLAY;
}

// C ref: include/obj.h bimanual(otmp) — a weapon/weapon-tool flagged oc_big
// (BITS() "big" field == 1 in objects.h).  The JS object table doesn't carry
// oc_bimanual, so we enumerate every two-handed otyp explicitly: the two big
// swords, the tsurugi, all the polearms, the dwarvish mattock, the
// quarterstaff and the unicorn horn (the one WEPTOOL with bi == 1).  Used both
// for the wield-with-shield restriction and for the
// "(weapon in hands)" inventory phrasing.
const BIMANUAL_OTYPS = new Set([
    45 /*BATTLE_AXE*/, 55 /*TWO_HANDED_SWORD*/, 57 /*TSURUGI*/,
    59 /*PARTISAN*/, 60 /*RANSEUR*/, 61 /*SPETUM*/, 62 /*GLAIVE*/,
    63 /*HALBERD*/, 64 /*BARDICHE*/, 65 /*VOULGE*/, 66 /*FAUCHARD*/,
    67 /*GUISARME*/, 68 /*BILL_GUISARME*/, 69 /*LUCERN_HAMMER*/,
    70 /*BEC_DE_CORBIN*/, 71 /*DWARVISH_MATTOCK*/, 79 /*QUARTERSTAFF*/,
    261 /*UNICORN_HORN*/,
]);
export function bimanual(obj) {
    return !!obj && (obj.oclass === WEAPON_CLASS || obj.oclass === TOOL_CLASS)
        && BIMANUAL_OTYPS.has(obj.otyp);
}
// C ref: obj.h is_sword(otmp) — WEAPON_CLASS with oc_skill in
// P_SHORT_SWORD..P_SABER.  The range here was P_BROAD_SWORD..P_TWO_HANDED_SWORD
// (6..8), so short swords, scimitars and sabers were not swords, and a wielded
// TOOL with a sword-range skill wrongly was.
export function is_sword(obj) {
    const sk = objects[obj?.otyp]?.oc_skill ?? 0;
    return obj?.oclass === WEAPON_CLASS && sk >= P_SHORT_SWORD && sk <= P_SABER;
}
// C ref: obj.h is_blade(otmp) / is_spear(otmp).
function is_blade(obj) {
    const sk = objects[obj?.otyp]?.oc_skill ?? 0;
    return obj?.oclass === WEAPON_CLASS && sk >= P_DAGGER && sk <= P_SABER;
}
function is_spear(obj) {
    return obj?.oclass === WEAPON_CLASS
        && (objects[obj.otyp]?.oc_skill ?? 0) === P_SPEAR;
}

// C ref: artifact.c will_weld() — a cursed artifact (or other weld-prone item)
// fuses to the hand.  The recorded wields are blessed/uncursed, so this is
// false; modelled via the welded() stub semantics.
function will_weld(obj) { return will_weld_dw(obj); }

// C ref: objnam.c aobjnam()/yobjnam() — "<count> <cxname> <verb>" (count only
// when quan != 1), with yobjnam()'s ownership prefix ("your"/shopkeeper/...).
function aobjnam_c(obj, verb) {
    let bp = cxname(obj);
    if ((obj.quan || 1) !== 1) bp = `${obj.quan} ${bp}`;
    return verb ? `${bp} ${otense(obj, verb)}` : bp;
}
function yobjnam_c(obj, verb) {
    const s = aobjnam_c(obj, verb);
    if (carried(obj) && obj_is_pname(obj) && obj.oartifact < 21 /* ART_ORB_OF_DETECTION */)
        return s;
    const owner = shk_your(obj);
    return owner ? `${owner} ${s}` : s;
}

// C ref: wield.c:196-210 ready_weapon() — the message for a cursed weapon that
// welds itself to the hand when wielded.
function weld_wield_msg(wep) {
    const tmp = xname(wep);
    const thestr = (!/^The /.test(tmp) && /^[a-z]/.test(tmp)) ? 'The ' : '';
    const lefty = (game.u?.uhandedness === 1 /*LEFT_HANDED*/);
    return `${thestr}${aobjnam_c(wep, 'weld')} ${wep.quan === 1 ? 'itself' : 'themselves'} to your `
        + `${bimanual(wep) ? makeplural(body_part(6))
            : `${lefty ? 'dominant left ' : 'dominant right '}${body_part(6)}`}!`;
}

// C ref: wield.c ready_weapon() — install `wep` as the primary weapon (or
// unwield when wep is null).  Returns an ECMD_* result.  Ports the paths the
// recorded sessions reach: unwield, plain wield with the "weapon in hand"
// prinv announcement, and the artifact retouch (rn2(4)).  Welding, shield/
// two-handed conflicts, corpse-wield, and talking/glowing-artifact effects are
// modelled but not exercised.
async function ready_weapon(wep) {
    let res = ECMD_OK;
    const was_twoweap = !!game.u?.twoweap;
    const had_wep = !!game.uwep;

    // C ref: wield.c:163-353 — every branch below is a pline()/You() call,
    // routed through update_topl() (not a bare _pending_message write) so a
    // still-pending EARLIER message (e.g. touch_artifact()'s blast pline)
    // gets its own --More-- before this line replaces it, matching C's
    // update_topl() calling more() inline rather than silently overwriting
    // and racing on to consume end-of-turn RNG too early. It also leaves
    // toplin==NEED_MORE so a same-turn follow-on (doswapweapon()'s second
    // prinv() for the bumped secondary) merges onto it instead of replacing
    // it (e.g. "You are bare handed." + "b - a +2 sling (alternate weapon;
    // not wielded).").
    if (!wep) {
        if (game.uwep) {
            await update_topl(`You are ${empty_handed()}.`);
            setuwep_slot(null);
            res = ECMD_TIME;
        } else {
            await update_topl(`You are already ${empty_handed()}.`);
        }
    } else if (game.uarms && bimanual(wep)) {
        await update_topl(
            `You cannot wield a two-handed ${is_sword(wep) ? 'sword'
              : wep.otyp === 45 /*BATTLE_AXE*/ ? 'axe' : 'weapon'} while wearing a shield.`);
        res = ECMD_FAIL;
    } else if (!(await (await import('./artifact.js')).retouch_object({ obj: wep }, false))) {
        res = ECMD_TIME; // takes a turn even though it doesn't get wielded
    } else {
        res = ECMD_TIME;
        if (will_weld(wep)) {
            // C ref: wield.c:196 — `tmp = xname(wep)`; the literal "The " is
            // prefixed only when objnam.c the() would add an article, i.e. the
            // name is not a proper noun.  An artifact the hero has NOT fully
            // identified reads "silver mace named Demonbane" (lower case, so
            // "The " goes in front); a fully identified one is just
            // "Demonbane" and gets no article.  This used to print
            // cxname_singular() with no article at all.
            await update_topl(weld_wield_msg(wep));
            wep.bknown = 1;
        } else {
            // C kludge: temporarily set W_WEP so prinv() prints "(weapon in
            // <hand>)", then restore the mask before setuwep() applies it for
            // real.
            const dummy = wep.owornmask || 0;
            wep.owornmask = dummy | QW_WEP;
            if (wep.otyp === AKLYS_OTYP && ((wep.owornmask | 0) & QW_WEP) !== 0)
                await update_topl('You secure the tether.');
            await update_topl(prinv_fmt(null, wep, 0));
            wep.owornmask = dummy;
            // C ref: prinv() -> pline() leaves toplin == NEED_MORE, so a
            // following same-turn message (e.g. a pet's attack on the freed
            // turn) accumulates onto the wield line instead of replacing it.
        }
        setuwep_slot(wep);
        if (was_twoweap && !game.u?.twoweap && game.flags?.verbose !== false) {
            // C ref: wield.c:231-238 — skip this message if we already got the
            // "empty handed" one above (uwep is Null then).  TWOWEAPOK(uwep) is
            // a weapon-class non-launcher/ammo/missile, or a weptool.
            if (game.uwep) {
                const twoweapok = game.uwep.oclass === WEAPON_CLASS
                    ? !(is_launcher(game.uwep) || is_ammo(game.uwep) || is_missile(game.uwep))
                    : is_weptool(game.uwep);
                await update_topl(`You ${(twoweapok && !bimanual(game.uwep))
                    ? 'are no longer using two weapons at once'
                    : 'can no longer wield two weapons at once'}.`);
            }
        }
        // C ref: wield.c:245-250 — a light-emitting artifact (Sunsword)
        // starts shining as it is wielded.  (arti_speak() for talking
        // artifacts is still not modelled.)
        const L = await import('./light.js');
        if (L.artifact_light(wep) && !wep.lamplit) {
            const { begin_burn } = await import('./timeout.js');
            await begin_burn(wep, false);
            if (!Blind_for_wear())
                await update_topl(`${Tobjnam_throw(wep, 'begin')} to shine ${L.arti_light_description(wep)}!`);
        }
    }
    void had_wep;
    return res;
}

// C ref: wield.c dowield() — the 'w' command: prompt for and wield a weapon.
// Returns an ECMD_* result (ECMD_TIME consumes a turn).  Ports the interactive
// paths the recorded sessions reach: prompt via getobj, the already-wielded /
// welded short-circuits, "wield nothing" ('-'), and a plain wield (which runs
// ready_weapon -> retouch_object -> touch_artifact).  Swap/quiver-confirm and
// the count-split branches are not exercised.
export async function dowield() {
    game.multi = 0;
    if (nohands_youmonst() || verysmall_youmonst()) {   /* cantwield() */
        await pline("Don't be ridiculous!");
        return ECMD_FAIL;
    }
    clear_splitobjs();
    const wep = await getobj('wield', wield_ok, GETOBJ_PROMPT | GETOBJ_ALLOWCNT);
    if (!wep) {
        return ECMD_CANCEL; // cancelled
    } else if (wep === game.uwep) {
        game._pending_message = note_topl('You are already wielding that!');
        if (is_weptool(wep)) game.unweapon = false;
        return ECMD_FAIL;
    } else if (welded(game.uwep)) {
        await weldmsg(game.uwep);
        /* previously interrupted armor removal mustn't be resumed */
        reset_remarm();
        /* if player chose a partial stack but can't wield it, undo split */
        if (wep.o_id && wep.o_id === game.context.objsplit?.child_oid)
            unsplitobj(wep);
        return ECMD_FAIL;
    } else if (wep.o_id && wep.o_id === game.context.objsplit?.child_oid) {
        /* wep is the result of supplying a count to getobj(): don't split
           something already wielded; otherwise it needs its own inventory slot */
        if (game.uwep && game.uwep.o_id === game.context.objsplit.parent_oid) {
            unsplitobj(wep);
            /* wep was merged back to uwep, already_wielded uses wep */
            game._pending_message = note_topl('You are already wielding that!');
            if (is_weptool(game.uwep)) game.unweapon = false;
            return ECMD_FAIL;
        }
        finish_splitting_inv(wep);
        const oldw = game.uwep;
        const res = await ready_weapon(wep);
        if (game.flags?.pushweapon && oldw && game.uwep !== oldw)
            setuswapwep(oldw);
        await untwoweapon();
        update_inventory();
        return res;
    }

    let newwep = wep;
    if (newwep === hands_obj) {
        newwep = null; // wield nothing
    } else if (newwep === game.uswapwep) {
        return await doswapweapon();
    } else if (newwep === game.uquiver) {
        // C ref: wield.c dowield() — wielding the READIED stack always needs
        // confirmation; a multi-item stack first offers to split one off.
        // Skipping the prompt wielded the quiver silently and let the answer
        // keystroke reach the command parser.
        let qbuf, split = false;
        if ((game.uquiver.quan || 1) > 1 && inv_cnt(false) < 52 /*invlet_basic*/
            && splittable(game.uquiver)) {
            qbuf = `You have ${game.uquiver.quan} ${simpleonames(game.uquiver)} readied.  Wield one?`;
            const c = await ynq(qbuf);
            if (c === 'q') return ECMD_OK;
            if (c === 'y') {
                newwep = splitobj(game.uquiver, 1); // leave N-1 quivered
                finish_splitting_inv(newwep);
                split = true;
            } else {
                qbuf = 'Wield all of them instead?';
            }
        } else {
            const use_plural = is_plural(game.uquiver) || pair_of(game.uquiver);
            qbuf = `You have ${!use_plural ? 'that' : 'those'} readied.  Wield ${
                !use_plural ? 'it' : 'them'} instead?`;
        }
        if (!split) {
            if ((await ynq(qbuf)) !== 'y') {
                // C: Shk_Your() prefixes "Your "/"<shk>'s "; an unpaid quivered
                // stack doesn't occur for these heroes.
                await pline(`Your ${simpleonames(game.uquiver)} ${
                    otense(game.uquiver, 'remain')} readied.`);
                return ECMD_OK;
            }
            // wielding the whole readied stack, so no longer quivered
            setuqwep(null);
        }
    } else if ((newwep.owornmask || 0) & (QW_ARMOR_ALL_MASK)) {
        game._pending_message = note_topl('You cannot wield that!');
        return ECMD_FAIL;
    }

    const oldwep = game.uwep;
    const result = await ready_weapon(newwep);
    if (game.flags?.pushweapon && oldwep && game.uwep !== oldwep)
        setuswapwep(oldwep);
    await untwoweapon();
    update_inventory();
    return result;
}

// W_ARMOR | W_ACCESSORY | W_SADDLE worn-mask bits for the "cannot wield that!"
// guard.  Uses the local QW_* armor bits plus accessory/saddle.
const QW_ARMOR_ALL_MASK = 0x7f /*armor*/ | 0x10000 /*amulet*/ | 0x20000 /*rings*/ | 0x40000 /*blindf*/ | 0x100000 /*saddle*/;

// C ref: wield.c doswapweapon() — the 'x' command (also dowield's uswapwep
// branch): unready the secondary, wield it, then make the old primary the new
// secondary.  Both slots announce themselves with prinv(), so the pair of lines
// pages behind a --More--.
export async function doswapweapon() {
    game.multi = 0;
    if (nohands_youmonst() || verysmall_youmonst()) {   /* cantwield() */
        await pline("Don't be ridiculous!");
        return ECMD_FAIL;
    }
    if (welded(game.uwep)) {
        await weldmsg(game.uwep);
        return ECMD_FAIL;
    }

    const oldwep = game.uwep, oldswap = game.uswapwep;
    setuswapwep(null);
    const result = await ready_weapon(oldswap);     // prints the new primary's line
    if (game.uwep === oldwep) {
        setuswapwep(oldswap);                 // wield failed; put it back
    } else {
        setuswapwep(oldwep);
        // C: prinv() is a pline(), so this second line goes through
        // update_topl() and pages the first one behind a --More--.
        await update_topl(game.uswapwep ? prinv_fmt(null, game.uswapwep, 0)
                                        : 'You have no secondary weapon readied.');
    }
    if (game.u?.twoweap) {
        const { can_twoweapon } = await import('./wield.js');
        if (!(await can_twoweapon())) await untwoweapon();
    }
    update_inventory();
    return result;
}


// weapon_type() now comes from js/weapon.js (weapon.c:1517); the copy here
// dropped C's WEAPON/TOOL/GEM class gate.
function uslinging() {
    return !!game.uwep && (objects[game.uwep.otyp]?.oc_skill ?? 0) === 21; // P_SLING
}

// C ref: role.c gu.urace.mnum (PM_HUMAN 0 / PM_ELF 1 / PM_DWARF 2 /
// PM_GNOME 3 / PM_ORC 4 as js/role.js races[] numbers them).
function race_mnum() { return game.urace?.mnum ?? game.initrace ?? 0; }

// Role mnums used by the multishot bonuses (urole.mnum numbering, as
// u_init.c assigns it).
const PM_CAVE_DWELLER_ROLE = 2, PM_RANGER_ROLE = 7, PM_ROGUE_ROLE = 8,
    PM_SAMURAI_ROLE = 9;
const YA = 22, YUMI = 86, ELVEN_ARROW = 19, ORCISH_ARROW = 20,
    ELVEN_BOW = 84, ORCISH_BOW = 85;

// C ref: dothrow.c multishot_class_bonus(Role_switch, ammo, launcher).  C keys
// this on the hero's MONSTER form, so a female samurai is PM_NINJA and picks up
// the extra shuriken/dart arm before falling through to the samurai case.
function multishot_class_bonus(obj, skill) {
    const role = game.urole?.mnum ?? game.u?.umonnum;
    const uwep = game.uwep;
    let bonus = 0;
    switch (role) {
    case PM_CAVE_DWELLER_ROLE:
        if (skill === -P_SLING || skill === P_SPEAR) bonus++;
        break;
    case PM_MONK:
        if (skill === -P_SHURIKEN) bonus++;
        break;
    case PM_RANGER_ROLE:
        if (skill !== P_DAGGER) bonus++;
        break;
    case PM_ROGUE_ROLE:
        if (skill === P_DAGGER) bonus++;
        break;
    case PM_SAMURAI_ROLE:
        if (game.flags?.female && (skill === -P_SHURIKEN || skill === -P_DART))
            bonus++;   /* PM_NINJA arm */
        if (obj.otyp === YA && uwep && uwep.otyp === YUMI) bonus++;
        break;
    default:
        break;
    }
    return bonus;
}

// C ref: dothrow.c throw_obj() — the skill/role/race/quest-launcher part of the
// multishot total (everything added before the rnd() rolls).
async function multishot_bonus(obj, skill) {
    const u = game.u;
    const uwep = game.uwep;
    let bonus = 0;
    // C: some roles get no volley bonus until expert; poor DEX inhibits it too.
    const weakmultishot = (Role_if(PM_WIZARD) || Role_if(PM_CLERIC)
        || (Role_if(PM_HEALER) && skill !== P_KNIFE)
        || (Role_if(PM_TOURIST) && skill !== -P_DART)
        || !!(u?.HFumbling || u?.EFumbling) || acurr_eff(A_DEX) <= 6);

    // C: switch (P_SKILL(weapon_type(obj))) — expert +2, skilled +1 (+1 only
    // when not weakmultishot for the skilled step).  enhance.js owns the skill
    // array; import it lazily because enhance.js imports this file.
    let pskill = 0;
    try {
        const { p_skill_of } = await import('./enhance.js');
        pskill = p_skill_of(weapon_type(obj)) | 0;
    } catch { pskill = 0; }
    if (pskill >= P_EXPERT) {
        bonus++;
        if (!weakmultishot) bonus++;
    } else if (pskill === P_SKILLED) {
        if (!weakmultishot) bonus++;
    }

    bonus += multishot_class_bonus(obj, skill);

    if (!weakmultishot) {
        switch (race_mnum()) {
        case 1: /* PM_ELF */
            if (obj.otyp === ELVEN_ARROW && uwep && uwep.otyp === ELVEN_BOW) bonus++;
            break;
        case 4: /* PM_ORC */
            if (obj.otyp === ORCISH_ARROW && uwep && uwep.otyp === ORCISH_BOW) bonus++;
            break;
        case 3: /* PM_GNOME */
            if (skill === -P_CROSSBOW) bonus++;
            break;
        default:
            break;
        }
        if (uwep && is_quest_artifact(uwep) && ammo_and_launcher(obj, uwep)) bonus++;
    }
    return bonus;
}

// C ref: include/artilist.h index of Mjollnir (js/artifact.js ART_MJOLLNIR).
const ART_MJOLLNIR = 3;
// C ref: attrib.h STR19(x) == 100 + x, so STR19(25) is the raw ACURR(A_STR)
// value for strength 25 — the minimum for throwing Mjollnir.
const STR19_25 = 125;
// C ref: dothrow.c AutoReturn(o, wmsk) — a weapon that comes back when thrown:
// a wielded aklys (tethered) or a wielded Mjollnir in a Valkyrie's hands, or a
// boomerang from any slot.  The wielded test is on the passed MASK, not on
// uwep, because throw_obj() has already removed the object from inventory.
function AutoReturn(o, wmsk) {
    if (!o) return false;
    return (((wmsk | 0) & QW_WEP) !== 0
            && (o.otyp === AKLYS_OTYP
                || (o.oartifact === ART_MJOLLNIR && Role_if(PM_VALKYRIE))))
        || o.otyp === BOOMERANG_OTYP;
}
const AKLYS_OTYP = 80, BOOMERANG_OTYP = 26, PM_VALKYRIE = 11;

// C ref: dothrow.c throw_ok() — getobj callback: weapons (and coins, and sling
// gems/rocks) are likely throw candidates; the wielded single weapon and known-
// stuck items are downplayed.
function throw_ok(obj) {
    if (!obj) return GETOBJ_EXCLUDE;
    if (obj.bknown && welded(obj)) return GETOBJ_DOWNPLAY;
    // C ref: dothrow.c:325 — a throw-and-return weapon is SUGGESTed even when
    // it is the single wielded weapon, so this arm has to come BEFORE the
    // quan==1/uwep downplay below.  Omitting it downplayed a wielded aklys and
    // (with a sling wielded) every boomerang, changing getobj's letter list.
    if (AutoReturn(obj, obj.owornmask)
        && (obj.oartifact !== ART_MJOLLNIR || acurr_eff(A_STR) >= STR19_25))
        return GETOBJ_SUGGEST;
    if (obj.quan === 1 && (obj === game.uwep || (obj === game.uswapwep && game.u?.twoweap)))
        return GETOBJ_DOWNPLAY;
    if (obj.oclass === COIN_CLASS) return GETOBJ_SUGGEST;
    if (!uslinging() && obj.oclass === WEAPON_CLASS) return GETOBJ_SUGGEST;
    if (uslinging() && obj.oclass === GEM_CLASS) return GETOBJ_SUGGEST;
    // C ref: dothrow.c:344 — a rock-throwing form (giant, xorn) can throw a
    // boulder, so offer it.
    if (throws_rocks_flag(youmonst_data()) && obj.otyp === BOULDER)
        return GETOBJ_SUGGEST;
    return GETOBJ_DOWNPLAY;
}

// C ref: zap.c bhit() restricted to the THROWN_WEAPON case with no monster in
// the path: trace from the hero in (dx,dy), stopping when the next cell can't be
// passed (a wall reverts the step, landing the missile at the hero's feet).
// Returns the landing {x,y}.  No RNG is consumed when nothing is hit.
function throw_isok(x, y) { return x >= 1 && x <= 79 && y >= 0 && y <= 20; }
// C ref: include/rm.h ZAP_POS(typ) == typ >= POOL (16); a thrown missile cannot
// pass solid terrain (rock/walls below POOL).
function throw_zap_pos(typ) { return typ >= 16; }
// C ref: monmove.c closed_door() — a door that is shut or locked.  rm.h:
// D_ISOPEN=0x02, D_CLOSED=0x04, D_LOCKED=0x08.  This used to mask (2|4), i.e.
// D_ISOPEN|D_CLOSED — so an OPEN door blocked and a LOCKED one did not.
function throw_closed_door(loc) {
    return loc?.typ === 23 /* DOOR */ && ((loc.doormask || 0) & (0x04 | 0x08)) !== 0;
}
// C ref: zap.c bhit(THROWN_WEAPON) — the loop stops at the FIRST monster on the
// path and reports it (gb.bhitpos stays on that monster's square).  This used to
// walk straight through every monster, so a thrown weapon never rolled
// thitmonst()'s rnd(20) and simply landed behind its target.
async function bhit_thrown_landing(dx, dy, range, obj, tethered = false, returning = false) {
    let bx = game.u.ux, by = game.u.uy;
    let hitmon = null;
    let point_blank = true;
    const objp = { obj };      /* C's `struct obj **pobj`: nulled if destroyed */
    // C ref: zap.c:3856 bhit() — a thrown ROCK may skip across water:
    // skiprange() rolls rnd(range/4) (when range >= 4) then rnd(3), and
    // allow_skip = !rn2(3), all before the flight loop.
    const skip = { skipstart: 0, skipend: 0 };
    let allow_skip = false, in_skip = false, skipcount = 0;
    const Z = await import('./zap.js');
    if (obj?.otyp === ROCK) {
        Z.skiprange(range, skip);
        allow_skip = !rn2(3);
    }
    // C ref: zap.c:3866-3868 bhit() — `tmp_at(DISP_TETHER | DISP_FLASH,
    // obj_to_glyph(obj, rn2_on_display_rng))` before the flight loop; while
    // hallucinating the glyph pick advances the display RNG.  Each tmp_at(x, y)
    // restores (newsym) the previously flashed cell and flashes the missile on
    // the new square only when the hero can see it; DISP_END restores the last
    // one.  The newsym()s matter while hallucinating: every remembered object
    // they redraw rolls a fresh random_object() off the display RNG.  A
    // tethered weapon's DISP_END is left to throwit() (flash is returned).
    const flash = tmp_at_flash(obj, tethered);
    let end_flash = !tethered;
    let stuck = false;
    for (let r = range; r > 0; r--) {
        const nx = bx + dx, ny = by + dy;
        if (!throw_isok(nx, ny)) break;
        bx = nx; by = ny;
        // C ref: zap.c:3883 bhit() — `if (is_pick(obj) && inside_shop(x, y) &&
        // (mtmp = shkcatch(obj, x, y)) != 0) { result = mtmp; goto bhit_done; }`
        // A shopkeeper next to the path nimbly catches a thrown pick-axe.
        if (is_pick(obj)) {
            const SK = await import('./shk.js');
            if (SK.inside_shop(bx, by)) {
                const shk = await SK.shkcatch(obj, bx, by);
                if (shk) { hitmon = shk; end_flash = true; break; }
            }
        }
        const loc = game.level.at(bx, by);
        const typ = loc?.typ ?? 0;
        // C ref: zap.c:3897 bhit() — a "wall of water"/lava wall stops items.
        if (typ === WATER || typ === LAVAWALL) break;
        // C ref: zap.c:3906 — iron bars block anything big enough and break
        // some things; `!rn2(5)` (the always_hit roll) is only drawn once the
        // missile has left the hero's square.  obj may be gone afterwards.
        if (typ === IRONBARS) {
            const { hits_bars } = await import('./mthrowu.js');
            if (await hits_bars(objp, bx - dx, by - dy, bx, by,
                                point_blank ? 0 : !rn2(5), 1)) {
                bx -= dx; by -= dy;
                break;
            }
        }
        // C: `mtmp = m_at(x, y); ... if (mtmp) { result = mtmp; goto bhit_done; }`
        // comes BEFORE the ZAP_POS/closed-door test, so a monster standing in a
        // doorway is still hit.
        let mtmp = m_at(bx, by);
        // C ref: zap.c:3928-3939 — a web catches a thrown missile on !rn2(3).
        const ttmp = !mtmp ? (await import('./trap.js')).t_at(bx, by) : null;
        if (ttmp && ttmp.ttyp === WEB && !rn2(3)) {
            if (cansee(bx, by)) {
                const yn = yname(obj);
                await pline(`${yn.charAt(0).toUpperCase()}${yn.slice(1)} gets stuck in a web!`);
                ttmp.tseen = 1;
                newsym(bx, by);
            }
            if (returning) stuck = true; /* iflags.returning_missile = 0 */
            break;
        }
        // C ref: zap.c:3946-3970 — C tests its post-decrement `range`
        // (`while (range-- > 0)`), which is r - 1 here.
        const crange = r - 1;
        if (skip.skipstart && crange === skip.skipstart && allow_skip) {
            const { is_pool } = await import('./dbridge.js');
            if (is_pool(bx, by) && !mtmp) {
                in_skip = true;
                const yn = yname(obj);
                if (!Blind_for_wear())
                    await pline(`${yn.charAt(0).toUpperCase()}${yn.slice(1)} ${otense(obj, 'skip')}${skipcount ? ' again' : ''}.`);
                else {
                    const { You_hear } = await import('./display.js');
                    await You_hear(`${yn} skip.`);
                }
                skipcount++;
            } else if (skip.skipstart > skip.skipend + 1) {
                --skip.skipstart;
            }
        }
        if (in_skip) {
            if (crange <= skip.skipend) {
                in_skip = false;
                if (crange > 3) Z.skiprange(crange, skip); /* another bounce? */
            } else if (mtmp && (mtmp.data?.mcls === 57 /* S_EEL */
                                || (mflags1_of(mtmp.data) & (0x2 /* M1_SWIM */ | 0x200 /* M1_AMPHIBIOUS */)))) {
                const U = await import('./uhitm.js');
                if (!Blind_for_wear() && U.canspotmon(mtmp)) {
                    const yn = yname(obj);
                    await pline(`${yn.charAt(0).toUpperCase()}${yn.slice(1)} ${otense(obj, 'pass')} over ${U.mon_nam(mtmp)}.`);
                }
                mtmp = null;
            }
        }
        if (mtmp) { hitmon = mtmp; break; }
        if (!throw_zap_pos(typ) || throw_closed_door(loc)) { bx -= dx; by -= dy; break; }
        // C ref: zap.c:4081-4085 — the missile reveals an empty square
        // before animation, forgetting a stale invisible-monster marker.
        if (loc?.invisMon && cansee(bx, by)) {
            const { unmap_object } = await import('./display.js');
            unmap_object(bx, by);
            newsym(bx, by);
        }
        // C ref: zap.c bhit():4092 `if (IS_SINK(typ) && weapon != FLASHED_LIGHT)
        // break;` — a thrown object always falls right onto a sink it reaches
        // (no revert, unlike the wall/closed-door case above).  js/dothrow.js's
        // boomhit(), js/dokick.js's kicked-object walker and js/mthrowu.js's
        // monster-throw walker already do this; this hero-throw walker didn't.
        await flash.step(bx, by);
        if (IS_SINK(typ)) break;
        /* thrown missile has moved away from its starting spot */
        point_blank = false; /* affects passing through iron bars */
    }
    if (stuck) end_flash = true;
    if (end_flash) await flash.end();
    return { x: bx, y: by, mon: hitmon, gone: !objp.obj, flash, stuck };
}

// ── thrown-object combat (C ref: dothrow.c thitmonst / uhitm.c hmon) ────────
// The whole "a thrown weapon can hit a monster" path was missing: bhit()
// walked past every monster and throwit() just dropped the object, skipping
// thitmonst()'s rnd(20) to-hit, hmon()'s damage roll and exercise()'s rn2(19)
// — three calls that put the rest of the session's PRNG out of phase (the
// whole seed-elf-ranger wall).
//
// The hmon() slice below is HMON_THROWN only; it delegates shared pieces
// (dmgval, killed, monflee, wakeup, mon_nam) to js/uhitm.js's exports and
// keeps only what uhitm.js keeps module-private. Exporting uhitm.c's hmon()
// would let this call it directly instead (deferred).

// C ref: monst.h MZ_MEDIUM (the msize omon_adj() measures against).
const MZ_MEDIUM = 2;
// onames.h otyps (mkobj.js OBJECT_DATA).
const SCALPEL = 39, BOOMERANG = 26, WAR_HAMMER = 76, AKLYS = 80, FLINT = 473,
    GAUNTLETS_OF_FUMBLING = 160;
// C ref: youprop.h Luck — u.uluck plus the moon/Friday-13th moreluck term.
function Luck_thrown() { return (game.u?.uluck | 0) + (game.u?.moreluck | 0); }
// C ref: role.c Race_if(PM_ELF) / Role_if(PM_SAMURAI) (js/uhitm.js uses the
// same two probes).
function Race_if_ELF_thrown() {
    return game.initrace === 1 || game.urace?.adj === 'elven';
}
function Role_if_SAMURAI_thrown() {
    return (game.urole?.mnum ?? game.u?.umonnum) === PM_SAMURAI_ROLE;
}

// C ref: dothrow.c throwing_weapon(obj) — a weapon MEANT to be thrown (ammo
// excluded).  The port had this as `oclass === WEAPON_CLASS`, i.e. TRUE for
// every weapon, which would give a thrown long sword thitmonst()'s +2.
// The `oc_dir & PIERCE` half of C's blade clause can't be read from this port's
// objects[] (it carries no weapon oc_dir), so it is spelled out from
// objects.h: inside is_blade && !is_sword (P_DAGGER..P_PICK_AXE) every dagger
// and every knife but the SCALPEL (SLASH) is PIERCE, and the axes are not.
function throwing_weapon(obj) {
    if (!obj) return false;
    const sk = objects[obj.otyp]?.oc_skill ?? 0;
    const pierce_blade = is_blade(obj) && !is_sword(obj)
        && (sk === P_DAGGER || (sk === P_KNIFE && obj.otyp !== SCALPEL));
    return is_missile(obj) || is_spear(obj) || pierce_blade
        || obj.otyp === WAR_HAMMER || obj.otyp === AKLYS;
}

// C ref: worn.c find_mac(mtmp).
function find_mac_thrown(mtmp) { return worn_find_mac(mtmp); }

// C ref: weapon.c hitval(otmp, mon) — spe + oc_hitbon, plus the blessed bonus
// against undead/demons.  (kebabable/trident/pick-axe are the other three arms;
// they are flat modifiers with no RNG, like the ones js/uhitm.js also omits.)
const hitval_thrown = hitval;   // js/weapon.js owns the complete weapon.c:149

// C ref: dothrow.c omon_adj(mon, obj, mon_notices) — target size/immobility and
// the weapon's own to-hit value.
function omon_adj(mon, obj, mon_notices) {
    let tmp = (mon?.data?.msize ?? MZ_MEDIUM) - MZ_MEDIUM;
    if (mon.msleeping) tmp += 2;
    if (!mon.mcanmove || !mmove_of(mon.data)) {
        tmp += 4;
        if (mon_notices && mmove_of(mon.data) && !rn2(10)) {
            mon.mcanmove = 1; mon.mfrozen = 0;
        }
    }
    if (obj.otyp === BOULDER) tmp += 6;
    else if (obj.oclass === WEAPON_CLASS || is_weptool(obj)
             || obj.oclass === GEM_CLASS)
        tmp += hitval_thrown(obj, mon);
    return tmp;
}

// C ref: hacklib.c ordin(n) — "1st", "2nd", "3rd", "4th", ... (11/12/13 take
// "th").
function ordin(n) {
    const dd = n % 10;
    return (dd === 0 || dd > 3 || Math.trunc((n % 100) / 10) === 1) ? 'th'
        : (dd === 1) ? 'st' : (dd === 2) ? 'nd' : 'rd';
}
// C ref: objnam.c mshot_xname(obj) — xname() with a "the Nth " prefix while a
// multishot volley is in flight ("The 2nd flint stone hits the newt.").
function mshot_xname(obj) {
    const ms = game.m_shot;
    const onm = xname(obj);
    if (ms && ms.n > 1 && ms.o === obj.otyp)
        return `the ${ms.i}${ordin(ms.i)} ${onm}`;
    return onm;
}
// C ref: objnam.c xname(obj) / singular(obj, xname) — C's xname() carries no
// quantity prefix, but this port's does, so the "You shoot N <missiles>." noun
// is built from the temporarily-singularized name (exactly what C's singular()
// does) and pluralized by hand.
function volley_noun(obj, n) {
    const save = obj.quan;
    obj.quan = 1;
    const base = xname(obj);
    obj.quan = save;
    return n === 1 ? base : makeplural(base);
}
// C ref: objnam.c vtense() as used by hit()/miss(): a plural subject takes the
// bare verb ("The daggers hit"), a singular one takes the -s form; the subject's
// first noun is what counts ("spellbook of detect monsters" is singular).
async function vtense_thrown(subj, verb) {
    const { vtense } = await import('./dothrow.js');
    return vtense(subj, verb);
}

// C ref: dothrow.c tmiss(obj, mon, maybe_wakeup) — the thrown-object miss
// message, then a 1-in-3 wakeup.  The rn2(3) is part of the recorded stream even
// when the monster is already awake.
async function tmiss(obj, mon, maybe_wakeup) {
    const { canspotmon, mon_nam, wakeupAttack } = await import('./uhitm.js');
    const missile = mshot_xname(obj);
    const verbose = game.flags?.verbose !== false;
    if (!canspotmon(mon)) {
        await update_topl(`${on_The(missile)} ${otense(obj, 'miss')}.`);
    } else {
        const named = verbose && (cansee(mon?.mx, mon?.my) || canspotmon(mon));
        await update_topl(`${on_The(missile)} ${await vtense_thrown(missile, 'miss')} ${
            named ? mon_nam(mon) : 'it'}.`);
    }
    if (maybe_wakeup && !rn2(3)) await wakeupAttack(mon, true);
}

// C ref: dothrow.c:2010 thitmonst(mon, obj) — a thrown (or kicked, or applied
// polearm) object arrives at a monster.  Returns TRUE when the object has been
// disposed of (the caller must not place it on the floor).  Every damage arm
// goes through uhitm.js's hmon(), exactly as C does.
async function thitmonst(mon, obj) {
    const u = game.u;
    const otyp = obj.otyp;
    const { HMON_THROWN, HMON_KICKED } = await import('./const.js');
    const WPN = await import('./weapon.js');
    const U = await import('./uhitm.js');
    let guaranteed_hit = !!(u.uswallow && mon === u.ustuck);
    // C ref: dothrow.c:2021 — a polearm applied at range arrives here still
    // wielded (use_pole()); a kicked object is gk.kickedobj.
    const hmode = (obj === game.uwep) ? HMON_APPLIED
        : (obj === game.gk_kickedobj) ? HMON_KICKED : HMON_THROWN;

    let tmp = -1 + Luck_thrown() + find_mac_thrown(mon) + (u.uhitinc || 0)
        + (u.ulevel || 1);
    const dex = acurr_eff(A_DEX);
    if (dex < 4) tmp -= 3;
    else if (dex < 6) tmp -= 2;
    else if (dex < 8) tmp -= 1;
    else if (dex >= 14) tmp += dex - 14;

    let disttmp = 3 - distmin(u.ux, u.uy, mon.mx, mon.my);
    if (disttmp < -4) disttmp = -4;
    tmp += disttmp;

    // C ref: dothrow.c:2057 — gloves hinder a bow.  GAUNTLETS_OF_POWER -2,
    // GAUNTLETS_OF_FUMBLING -3, leather/dexterity 0.
    if (game.uarmg && game.uwep
        && (objects[game.uwep.otyp]?.oc_skill ?? 0) === P_BOW) {
        if (game.uarmg.otyp === GAUNTLETS_OF_POWER) tmp -= 2;
        else if (game.uarmg.otyp === GAUNTLETS_OF_FUMBLING) tmp -= 3;
    }

    tmp += omon_adj(mon, obj, true);
    // C: `is_orc(mon->data) && Race_if(PM_ELF)` — an elf aims better at orcs.
    if ((mflags2_of(mon.data) & M2_ORC) && Race_if_ELF_thrown()) tmp++;
    if (guaranteed_hit) tmp += 1000; /* Guaranteed hit */

    // C ref: dothrow.c:2087 — a real gem thrown to a unicorn is a gift, not an
    // attack (rocks/gray stones and sling-fired gems are attacks).  This arm
    // sits BEFORE the rnd(20) to-hit roll.
    if (obj.oclass === GEM_CLASS && is_unicorn_mon(mon.data)
        && objects[obj.otyp]?.material !== 10 /* MINERAL */ && !uslinging()) {
        if (mon.msleeping || !mon.mcanmove) {          /* helpless(mon) */
            await tmiss(obj, mon, false);
            return false;
        } else if (mon.mtame) {
            await update_topl(`${U.Monnam(mon)} catches and drops ${the_name_of(obj)}.`);
            return false;
        } else {
            await update_topl(`${U.Monnam(mon)} catches ${the_name_of(obj)}.`);
            return !!(await DT.gem_accept(mon, obj));
        }
    }

    // C ref: dothrow.c:2104 — don't make the game unwinnable if a naive player
    // throws the quest artifact (or any unique item) at the quest leader.
    if (hmode !== HMON_APPLIED
        && (is_quest_artifact(obj) || objects[obj.otyp]?.oc_unique
            || (obj.otyp === FAKE_AMULET_OF_YENDOR_OTYP && !obj.known))
        && game.quest_status?.leader_m_id != null
        && mon.m_id === game.quest_status.leader_m_id) {
        mon.msleeping = 0;
        mon.mstrategy = (mon.mstrategy | 0) & ~STRAT_WAITMASK;

        if (mon.mcanmove) {
            const { Some_Monnam, } = await import('./do_name.js');
            await update_topl(`${Some_Monnam(mon)} catches ${the_name_of(obj)}.`);
            /* leader will keep tossed invocation item after you've done the
               invocation and it's become unnecessary for completion.. */
            if ((u.uevent?.invoked && objects[obj.otyp]?.oc_unique
                 && obj.otyp !== AMULET_OF_YENDOR)
                /* ...or any special item, if you've made him angry */
                || !mon.mpeaceful) {
                /* give an explanation for keeping the item only if leader is
                   not doing it out of anger */
                if (mon.mpeaceful && !(await import('./display.js')).Deaf_hero()) {
                    fully_identify_obj(obj);
                    const nm = on_The(xname(obj));
                    await update_topl(`"${s_suffix(nm)} part in this is finished."`);
                    await update_topl(`"We will guard it in case it is ever needed again, ${
                        align_gname(roles.findIndex((r) => r.mnum === game.urole?.mnum),
                                    u.ualignbase?.[1] ?? u.ualign?.type)} forbid."`);
                }
                if (u.ushops?.[0] || obj.unpaid) /* not very likely... */
                    await DT.check_shop_obj(obj, mon.mx, mon.my, false);
                const { mpickobj } = await import('./steal.js');
                mpickobj(mon, obj);
            } else {
                /* under normal circumstances, leader will say something and
                   then return the item to the hero */
                const { monnear } = await import('./dogmove.js');
                const next2u = monnear(mon, u.ux, u.uy);
                const { finish_quest } = await import('./questpgr.js');
                await finish_quest(obj); /* acknowledge quest completion */
                await update_topl(`${Some_Monnam(mon)} ${next2u ? 'hands' : 'tosses'} ${
                    the_name_of(obj)} back to you.`);
                if (!next2u) await DT.sho_obj_return_to_u(obj);
                addinv(obj); /* back into your inventory */
                await encumber_msg();
            }
            return true; /* caller doesn't need to place it */
        }
        return false;
    }

    const dieroll = rnd(20);

    if (obj.oclass === WEAPON_CLASS || is_weptool(obj)
        || obj.oclass === GEM_CLASS) {
        if (hmode === HMON_KICKED) {
            /* throwing adjustments and weapon skill bonus don't apply */
            tmp -= (is_ammo(obj) ? 5 : 3);
        } else if (is_ammo(obj)) {
            if (!ammo_and_launcher(obj, game.uwep)) {
                tmp -= 4;
            } else {
                // C ref: dothrow.c:2163 `tmp += uwep->spe - greatest_erosion(uwep)`
                tmp += (game.uwep.spe || 0) - greatest_erosion(game.uwep);
                tmp += await WPN.weapon_hit_bonus(game.uwep);
                if (game.uwep.oartifact) {
                    const { spec_abon } = await import('./artifact.js');
                    tmp += spec_abon(game.uwep, mon);
                }
                // Elves and Samurai are highly trained with their own bows.
                const elf = Race_if_ELF_thrown();
                const samurai = Role_if_SAMURAI_thrown();
                if ((elf || samurai)
                    && (objects[game.uwep.otyp]?.oc_skill ?? 0) === P_BOW) {
                    ++tmp;
                    if ((elf && game.uwep.otyp === ELVEN_BOW)
                        || (samurai && game.uwep.otyp === YUMI)) ++tmp;
                }
            }
        } else { /* thrown non-ammo or applied polearm/grapnel */
            if (otyp === BOOMERANG) tmp += 4;
            else if (throwing_weapon(obj)) tmp += 2;
            else if (obj === game.thrownobj) tmp -= 2; /* not meant to be thrown */
            tmp += await WPN.weapon_hit_bonus(obj);
        }

        if (tmp >= dieroll) {
            const wasthrown = !!game.thrownobj;
            /* remember weapon attribute; hmon() might destroy obj */
            const chopper = is_axe(obj);

            /* attack hits mon */
            if (hmode === HMON_APPLIED) {
                if (!u.uconduct) u.uconduct = {};
                u.uconduct.weaphit = (u.uconduct.weaphit || 0) + 1;
            }
            if (await U.hmon(mon, obj, hmode, dieroll)) { /* mon still alive */
                if (mon.wormno) {
                    const { cutworm } = await import('./worm.js');
                    await cutworm(mon, game.bhitpos.x, game.bhitpos.y, chopper);
                }
            }
            exercise(A_DEX, true);
            /* if hero was swallowed and projectile killed the engulfer, 'obj'
               got added to engulfer's inventory and then dropped */
            if (wasthrown && !game.thrownobj) return true;

            /* projectiles other than magic stones sometimes disappear when
               thrown */
            if (should_mulch_missile(obj)) {
                if (u.ushops?.[0] || obj.unpaid)
                    await DT.check_shop_obj(obj, game.bhitpos.x, game.bhitpos.y, true);
                delobj_thrown(obj);
                return true;
            }
            const { passive_obj } = await import('./uhitm.js');
            await passive_obj(mon, obj, null);
        } else {
            await tmiss(obj, mon, true);
            if (hmode === HMON_APPLIED) await U.wakeupAttack(mon, true);
        }

    } else if (otyp === HEAVY_IRON_BALL_OTYP) {
        exercise(A_STR, true);
        if (tmp >= dieroll) {
            const was_swallowed = guaranteed_hit;

            exercise(A_DEX, true);
            if (!(await U.hmon(mon, obj, hmode, dieroll))) { /* mon killed */
                if (was_swallowed && !u.uswallow && obj === u.uball)
                    return true; /* already did placebc() */
            }
        } else {
            await tmiss(obj, mon, true);
        }

    } else if (otyp === BOULDER) {
        exercise(A_STR, true);
        if (tmp >= dieroll) {
            exercise(A_DEX, true);
            await U.hmon(mon, obj, hmode, dieroll);
        } else {
            await tmiss(obj, mon, true);
        }

    } else if ((otyp === EGG || otyp === CREAM_PIE || otyp === BLINDING_VENOM
                || otyp === 480 /* ACID_VENOM */)
               && (guaranteed_hit || acurr_eff(A_DEX) > rnd(25))) {
        await U.hmon(mon, obj, hmode, dieroll);
        return true; /* hmon used it up */

    } else if (obj.oclass === POTION_CLASS
               && (guaranteed_hit || acurr_eff(A_DEX) > rnd(25))) {
        const { potionhit } = await import('./potion.js');
        await potionhit(mon, obj, 1 /* POTHIT_HERO_THROW */);
        return true;

    } else {
        // C ref: dothrow.c:2267 — thrown food a monster will accept, or any
        // food a tame pet rates ACCFOOD or better.
        const { dogfood } = await import('./dogmove.js');
        if (DT.befriend_with_obj(mon.data, obj)
            || (mon.mtame && dogfood(mon, obj) <= ACCFOOD)) {
            if (await DT.tamedog(mon, obj, true))
                return true; /* obj is gone */
            await tmiss(obj, mon, false);
            mon.msleeping = 0;
            mon.mstrategy = (mon.mstrategy | 0) & ~STRAT_WAITMASK;
        } else if (guaranteed_hit) {
            // C ref: dothrow.c:2276 — this assumes guaranteed_hit is swallowing.
            const md = u.ustuck.data;
            const { dmgtype } = await import('./monattk_data.js');
            const { is_animal } = await import('./monflags_data.js');
            const { S_VORTEX } = await import('./symbols.js');

            await U.wakeupAttack(mon, true);
            if (obj.otyp === CORPSE && corpse_petrifies(obj)) {
                if (is_animal(md)) {
                    const { minstapetrify } = await import('./trap.js');
                    await minstapetrify(u.ustuck, true);
                    /* Don't leave a cockatrice corpse available in a statue */
                    if (!u.uswallow) {
                        delobj(obj);
                        return true;
                    }
                }
            }
            const trail = dmgtype(md, AD_DGST) ? ' entrails'
                : (md.mcls === S_VORTEX || md.name === 'air elemental') ? ' currents' : '';
            const monname = trail ? s_suffix(U.mon_nam(mon)) : U.mon_nam(mon);
            await update_topl(`${Tobjnam_throw(obj, 'vanish')} into ${monname}${trail}.`);
        } else {
            await tmiss(obj, mon, true);
        }
    }

    return false;
}

// C ref: mondata.h touch_petrifies(ptr) — genuinely a two-species macro in C
// (PM_COCKATRICE || PM_CHICKATRICE), resolved here through the generated mons[]
// table rather than a hardcoded pmidx pair.
function corpse_petrifies(obj) {
    const nm = monster_by_pmidx(obj?.corpsenm)?.name;
    return nm === 'cockatrice' || nm === 'chickatrice';
}

// C ref: mondata.h is_unicorn(ptr) == (mlet == S_UNICORN && likes_gems(ptr)).
function is_unicorn_mon(ptr) {
    return ptr?.mcls === 21 /* S_UNICORN */ && likes_gems_flag(ptr);
}

// C ref: dothrow.c should_mulch_missile(obj).
function should_mulch_missile(obj) {
    if (!obj || !(is_ammo(obj) || is_missile(obj))
        || obj.otyp === BOOMERANG || objects[obj.otyp]?.oc_magic)
        return false;
    const chance = 3 + greatest_erosion(obj) - (obj.spe || 0);
    let broken = chance > 1 ? (rn2(chance) !== 0) : (rn2(4) === 0);
    if (obj.blessed && (game.context?.mon_moving ? (rn2(3) === 0) : (rnl(4) === 0)))
        broken = false;
    if (((obj.oclass === GEM_CLASS && objects[obj.otyp]?.oc_tough)
         || obj.otyp === FLINT) && rn2(2) === 0)
        broken = false;
    return broken;
}

// C ref: dothrow.c thitmonst() `obfree(obj, 0)` for a mulched missile — the
// object is simply gone (no obj_resists roll, unlike delobj()).
function delobj_thrown(obj) { obj_extract_self(obj); obfree(obj, null); }

// C ref: dothrow.c throw_obj()/throwit() — the throw of a single ammo item by a
// hero with no matching launcher wielded.  Ports the path the recorded session
// takes (ranger throwing an arrow east into the wall): no multishot (the arrow's
// launcher isn't wielded, so the volley block is skipped), split one off
// (next_ident rnd(2)), print the "by hand" message, run the trajectory (no RNG),
// breaktest (obj_resists rn2(100)), and drop the arrow at the landing cell.
async function throw_obj(obj, dir, shotlimit = 0) {
    const u = game.u;
    u.dx = dir.dx; u.dy = dir.dy; u.dz = dir.dz || 0;
    // C ref: dothrow.c:112 — coins are thrown as a whole stack (for a
    // leprechaun or a bribe) unless they are the quivered slot, and throw_gold()
    // runs BEFORE canletgo/welded/multishot, so gold never rolls a volley.
    if (obj.oclass === COIN_CLASS && obj !== game.uquiver)
        return await DT.throw_gold(obj);
    // C ref: dothrow.c throw_obj() runs its refusals in this order, BEFORE the
    // self-throw test; a worn/leashed/cursed-loadstone item and a boulder in
    // ordinary hands each stop the throw here (the boulder still costs a turn).
    if (!(await canletgo(obj, 'throw'))) return ECMD_OK;
    // C ref: dothrow.c:122 — Mjollnir has to be wielded to be thrown at all,
    // and needs strength 25 even then.
    if (obj.oartifact === ART_MJOLLNIR && obj !== game.uwep) {
        game._pending_message = note_topl(`${the_name_of(obj).replace(/^the /, 'The ')} must be wielded before it can be thrown.`);
        return ECMD_OK;
    }
    if ((obj.oartifact === ART_MJOLLNIR && acurr_eff(A_STR) < STR19_25)
        || (obj.otyp === BOULDER && !throws_rocks_flag(youmonst_data()))) {
        await update_topl("It's too heavy.");
        return ECMD_TIME;
    }
    if (!u.dx && !u.dy && !u.dz) {
        game._pending_message = note_topl('You cannot throw an object at yourself.');
        return ECMD_OK;
    }
    // C ref: dothrow.c:1146 `u_wipe_engr(2)` — throwing scuffs an engraving
    // underfoot, and wipe_engr_at() draws rn2() whenever one is there.
    u_wipe_engr(2);
    // C ref: dothrow.c:139 — a bare-handed throw of a cockatrice corpse is
    // fatal.  The message is printed before instapetrify() takes over.
    if (!game.uarmg && obj.otyp === CORPSE && corpse_petrifies(obj)
        && !(game.u?.uprops?.StoneResistance)) {
        // C: pline() before instapetrify()'s own death cascade; a bare write
        // here would leave nothing pending for that cascade's first message
        // to page against, silently dropping this line instead.
        await update_topl(`You throw ${corpse_xname(obj, null, 4 /* CXN_PFX_THE */)} with your bare ${
            makeplural(body_part(6 /*HAND*/))}.`);
        await (await import('./polyself.js')).instapetrify(`throwing ${killer_xname(obj)} bare-handed`);
    }
    if (welded(obj)) { await weldmsg(obj); return ECMD_TIME; }
    // C ref: dothrow.c:155 `if (is_wet_towel(obj)) dry_a_towel(obj, -1, FALSE)`
    // — throwing a wet towel dries it one step.  No RNG, but the towel's spe is
    // what a later apply reads.
    if (is_wet_towel(obj)) await (await import('./weapon.js')).dry_a_towel(obj, -1, false);

    // C ref: dothrow.c throw_obj() "Multishot calculations".  The skill, role,
    // race and quest-launcher bonuses all RAISE the argument to the final
    // rnd(multishot) — leaving them out did not just lose a missile, it drew
    // rnd(1) where C draws rnd(2)/rnd(3)/rnd(4), i.e. the wrong modulus.
    let multishot = 1;
    const skill = objects[obj.otyp]?.oc_skill ?? 0;   /* signed */
    const volley = (obj.quan > 1)
        && (is_ammo(obj) ? matching_launcher(obj, game.uwep) : obj.oclass === WEAPON_CLASS)
        && !(u?.uprops?.Confusion || u?.Confusion
             || u?.uprops?.Stun || u?.Stunned);
    if (volley) {
        multishot += await multishot_bonus(obj, skill);
        // C: crossbows need high strength for a quick reload; a weak shooter
        // rolls rnd(multishot) an EXTRA time before the general roll.
        if (multishot > 1 && skill === -P_CROSSBOW
            && ammo_and_launcher(obj, game.uwep)
            && acurrstr() < (race_mnum() === 3 /* PM_GNOME */ ? 16 : 18))
            multishot = rnd(multishot);
        multishot = rnd(multishot);
        if (multishot > obj.quan) multishot = obj.quan;
        // C ref: dothrow.c:236 `if (shotlimit > 0 && multishot > shotlimit)
        // multishot = shotlimit;` — a count prefix ("3f") caps the volley.  This
        // clamp was missing, so a 4-shot volley requested as 2 fired four
        // missiles: two extra splitobj()/thitmonst() pairs of draws.
        if (shotlimit > 0 && multishot > shotlimit) multishot = shotlimit;
    }

    // C ref: dothrow.c:236 `gm.m_shot.s = ammo_and_launcher(obj, uwep)` plus
    // the "You shoot/throw N <missiles>." announcement, which fires whenever the
    // volley is longer than one OR the player typed a count prefix.  Both this
    // line and the loop below were missing, so a 2-shot sling volley launched
    // one stone and skipped the second splitobj()/breaktest() pair.
    const m_shot_s = ammo_and_launcher(obj, game.uwep);
    game.m_shot = { o: obj.otyp, n: multishot, i: 0, s: m_shot_s };
    if (multishot > 1 || shotlimit > 0) {
        await update_topl(`You ${m_shot_s ? 'shoot' : 'throw'} ${multishot} ${
            volley_noun(obj, multishot)}.`);
    }

    const wep_mask = obj.owornmask || 0;
    let res = ECMD_TIME;
    for (game.m_shot.i = 1; game.m_shot.i <= game.m_shot.n; game.m_shot.i++) {
        let otmp = obj;
        if (obj && obj.quan > 1) {
            otmp = splitobj(obj, 1);
        } else {
            otmp = obj;
            if (!otmp) break;
            if (otmp.owornmask) {
                // C ref: dothrow.c throw_obj():262 `if (otmp->owornmask)
                // remove_worn_item(otmp, FALSE);` - throwing the LAST of a
                // quivered (or wielded) stack empties that slot.  Skipping it
                // left u.uquiver pointing at an object no longer in inventory,
                // so a later 'f' fired the ghost instead of printing "You have
                // no ammunition readied." and opening the "What do you want to
                // fire?" prompt (whose keys then fell through to rhack()).
                await remove_worn_item(otmp, false);
            }
            obj = null;
        }
        freeinv(otmp);
        try {
            res = await throwit(otmp, wep_mask);
        } finally {
            game.thrownobj = null;
        }
        await encumber_msg();
    }
    game.m_shot = { o: 0, n: 0, i: 0, s: false };
    return res;
}

// C ref: objnam.c Tobjnam(obj, verb) — "The dagger slips" / "The daggers slip".
function Tobjnam_throw(obj, verb) {
    const nm = the_name_of(obj);
    return `${nm.charAt(0).toUpperCase()}${nm.slice(1)} ${otense(obj, verb)}`;
}
// C ref: objnam.c the(str) / the(xname(obj)).
function the_str(s) { return /^[A-Z]/.test(s) ? s : `the ${s}`; }
function the_name_of(obj) { return the_str(xname(obj)); }
// C ref: onames.h HEAVY_IRON_BALL (js/mkobj.js OBJECT_DATA otyp).
const HEAVY_IRON_BALL_OTYP = 477;
// C ref: mextra.h dogfood enum — thitmonst()'s pet arm accepts ACCFOOD or better.
const ACCFOOD = 2;

// C ref: dothrow.c return_throw_to_inv(obj, wep_mask, twoweap, oldslot) — a
// throw-and-return weapon coming back into the pack, re-wielded (or re-quivered)
// into whatever slot it left.
async function return_throw_to_inv(obj, wep_mask) {
    obj.nomerge = 1;
    const back = addinv(obj);
    if (back) back.nomerge = 0;
    const o = back || obj;
    // C ref: dothrow.c:1890 — addinv() may have autoquivered it; a weapon that
    // came out of a weapon slot must not end up in the quiver instead.
    if (((o.owornmask | 0) & QW_QUIVER) !== 0
        && (((o.owornmask | 0) | (wep_mask | 0)) & (QW_WEP | QW_SWAPWEP)) !== 0)
        setuqwep(null);
    if ((wep_mask & QW_WEP) && !game.uwep) setuwep_slot(o);
    else if ((wep_mask & QW_SWAPWEP) && !game.uswapwep) setuswapwep(o);
    else if ((wep_mask & QW_QUIVER) && !game.uquiver) setuqwep(o);
    await encumber_msg();
    return o;
}

// C ref: dothrow.c throwit(obj, wep_mask, twoweap, oldslot) - one missile's
// flight.  Split out of throw_obj() so the multishot volley can run it per shot.
async function throwit(otmp, wep_mask) {
    const u = game.u;
    const Underwater = !!u.uinwater;
    game.notonhead = false; /* reset potentially stale value */
    let impaired = !!(u?.uprops?.Confusion || u?.Confusion || u?.uprops?.Stun
                      || u?.Stunned || Blinded_hero() || u?.uhallu
                      || u?.HFumbling || u?.EFumbling);

    // C ref: dothrow.c throwit():1526 — a cursed or greased missile misfires
    // one throw in seven and flies off in a RANDOM direction.  The rn2(7) is
    // drawn for every cursed/greased throw, hit or miss; skipping it put the
    // whole rest of the stream out of phase whenever a cursed weapon was thrown.
    if ((otmp.cursed || otmp.greased) && (u.dx || u.dy) && !rn2(7)) {
        let slipok = true;
        if (ammo_and_launcher(otmp, game.uwep)) {
            await update_topl(`${Tobjnam_throw(otmp, 'misfire')}!`);
        } else if (otmp.greased || throwing_weapon(otmp)) {
            await update_topl(`${Tobjnam_throw(otmp, 'slip')} as you throw it!`);
        } else {
            slipok = false;
        }
        if (slipok) {
            u.dx = rn2(3) - 1;
            u.dy = rn2(3) - 1;
            if (!u.dx && !u.dy) u.dz = 1;
            impaired = true;
        }
    }

    // C ref: dothrow.c throwit():1549 — too weak and too laden to complete the
    // throw: the object simply drops.  No RNG.
    if ((u.dx || u.dy || u.dz < 1)
        && calc_capacity(otmp.owt | 0) > SLT_ENCUMBER
        && (u.uhp < 10 && u.uhp !== u.uhpmax)
        && (otmp.owt | 0) > (u.uhp | 0) * 2
        && !Is_airlevel()) {
        await update_topl(`You have so little stamina, ${the_name_of(otmp)} drops from your grasp.`);
        exercise(A_CON, false);
        u.dx = u.dy = 0;
        u.dz = 1;
    }

    game.thrownobj = otmp;
    otmp.how_lost = LOST_THROWN;
    // C ref: dothrow.c:1564 `iflags.returning_missile = AutoReturn(obj,wep_mask)`
    // — an aklys/Mjollnir wielded when thrown, or any boomerang, comes back.
    let returning_missile = AutoReturn(otmp, wep_mask);
    // C ref: dothrow.c:1523 — a wielded aklys stays tied to the hero.
    const tethered_weapon = otmp.otyp === AKLYS_OTYP && ((wep_mask | 0) & QW_WEP) !== 0;

    // C ref: dothrow.c throwit():1580 `} else if (u.dz) {` — a throw straight
    // up or down never enters the trajectory block at all.
    if (!u.uswallow && u.dz) {
        if (u.dz < 0 && returning_missile && !impaired) {
            // C ref: dothrow.c:1585 — a straight-up throw of a returning weapon
            // simply comes back to the hand.
            await update_topl(`${Tobjnam_throw(otmp, 'hit')} the ${
                ceiling_of(u.ux, u.uy)} and returns to your hand!`);
            await return_throw_to_inv(otmp, wep_mask);
        } else if (u.dz < 0) {
            // C ref: dothrow.c:1589 `(void) toss_up(obj, rn2(5) && !Underwater)`.
            await toss_up(otmp, rn2(5) !== 0 && !Underwater);
        } else if (u.dz > 0 && u.usteed && otmp.oclass === POTION_CLASS && rn2(6)) {
            /* alternative to prayer or wand of opening/spell of knock for
               dealing with cursed saddle:  throw holy water > */
            const { potionhit } = await import('./potion.js');
            await potionhit(u.usteed, otmp, 1 /* POTHIT_HERO_THROW */);
        } else {
            await hitfloor(otmp, true);
        }
        return ECMD_TIME;
    }

    const recoil = Is_airlevel()
        || !!((u.uprops?.Levitation || worn_extrinsic(LEVITATION))
              && !(u.uprops?.BLevitation || worn_blocked(LEVITATION)));
    let land;
    if (u.uswallow) {
        // C ref: dothrow.c:1569 — the engulfer is the target; no flight.
        const em = u.ustuck;
        game.bhitpos = { x: em.mx, y: em.my };
        land = { x: em.mx, y: em.my, mon: em };
    } else if (otmp.otyp === BOOMERANG_OTYP && !Underwater) {
        if (recoil) await DT.hurtle(-u.dx, -u.dy, 1, true);
        // C ref: dothrow.c:1601 — a boomerang does NOT fly in a straight line,
        // so it never reaches bhit(); zap.c boomhit() walks its curve instead.
        const res = await DT.boomhit(otmp, u.dx, u.dy);
        // C ref: dothrow.c:1605 `iflags.returning_missile = 0; /* has
        // returned or isn't going to */`.
        returning_missile = false;
        if (res.gone) return ECMD_TIME;
        if (res.caught) {
            exercise(A_DEX, true);
            await return_throw_to_inv(otmp, wep_mask);
            return ECMD_TIME;
        }
        // C: an uncaught boomerang continues through throwit()'s common tail
        // at gb.bhitpos — throwit_mon_hit(), breaktest()'s obj_resists
        // rn2(100), flooreffects(), ship_object() and the floor placement.
        land = { x: res.x, y: res.y, mon: res.mon };
    } else {
        // C ref: dothrow.c throwit() lines 1614-1648 — range derives from
        // strength, is clamped to >= 1, then ammo is adjusted: matching-launcher
        // ammo gains a cell (range++), while ammo thrown by hand (no wielded
        // launcher, non-gem) has its range HALVED (range /= 2) and prints the
        // "by hand" notice.
        const crossbowing = ammo_and_launcher(otmp, game.uwep) && weapon_type(otmp) === 22 /* P_CROSSBOW */;
        let urange = Math.floor((crossbowing ? 18 : acurr_str_throw()) / 2);
        // C ref: dothrow.c:1622 — a HEAVY_IRON_BALL is easy to roll, so its
        // weight is divided by 100 rather than 40; using /40 for it gave range
        // 1 instead of the 5 an ordinary hero gets, so a thrown ball stopped
        // one cell out.
        let range = urange - Math.floor((otmp.owt || 1)
                                        / (otmp.otyp === HEAVY_IRON_BALL_OTYP ? 100 : 40));
        if (otmp === game.u.uball) {
            if (u.ustuck) range = 1;
            else if (range >= 5) range = 5;
        }
        if (range < 1) range = 1;
        if (is_ammo(otmp)) {
            if (ammo_and_launcher(otmp, game.uwep)) {
                if (crossbowing) range = 8; /* BOLT_LIM */
                else range++;
            } else if (otmp.oclass !== GEM_CLASS) {
                range = Math.trunc(range / 2); // C: range /= 2 (truncating int division)
                const launcherName = an(skill_name_for(weapon_type(otmp)));
                const descr = weapon_descr(otmp);
                // C ref: dothrow.c:1643 calls pline() here, which routes through
                // update_topl() and its --More-- paging; writing
                // game._pending_message directly bypassed toplin bookkeeping so
                // the very next message (thitmonst's hit/miss line) silently
                // overwrote this one instead of pausing for acknowledgement.
                await update_topl(`You aren't wielding ${launcherName}, so you throw your ${descr} by hand.`);
            }
        }
        if (recoil) {
            urange = Math.max(urange - range, 1);
            range = Math.max(range - urange, 1);
        }

        // C ref: dothrow.c:1660 — a boulder is thrown by a giant and flies 20; a
        // thrown Mjollnir is heavy and only makes half the distance.
        if (otmp.otyp === BOULDER) range = 20;
        else if (otmp.oartifact === ART_MJOLLNIR) range = Math.floor((range + 1) / 2);
        else if (tethered_weapon) range = Math.min(range, 4); /* isqrt(AKLYS_LIM^2) */
        else if (otmp === game.u.uball && u.utrap && u.utraptype === TT_INFLOOR) range = 1;
        if (Underwater) range = 1;

        // Trajectory + landing.
        land = await bhit_thrown_landing(u.dx, u.dy, range, otmp,
                                         tethered_weapon, returning_missile);
        if (land.stuck) returning_missile = false; /* web: iflags.returning_missile = 0 */
        game.bhitpos = { x: land.x, y: land.y };
        if (recoil) await DT.hurtle(-u.dx, -u.dy, urange, true);
    }
    // C ref: dothrow.c throwit() — `if (!obj) return;` bhit() already disposed
    // of a missile that broke against iron bars.
    if (land.gone) {
        /* bhit display cleanup was left with this caller for tethered_weapon */
        if (tethered_weapon) await land.flash.end();
        return ECMD_TIME;
    }

    // C ref: dothrow.c throwit():1691 `if (throwit_mon_hit(obj, mon)) return;`
    // — a monster in the path takes the hit (thitmonst); only if the object
    // survives does it go on to break/land.
    // C ref: dothrow.c:1695 throwit_mon_hit() — sets notonhead, snuffs a lit
    // candle, runs thitmonst() and the shopkeeper hot-pursuit check; TRUE means
    // a shopkeeper caught the object.
    if (await DT.throwit_mon_hit(otmp, land.mon)) return ECMD_TIME;
    if (!game.thrownobj) {
        /* missile has already been handled */
        if (tethered_weapon) await land.flash.end();
        return ECMD_TIME;
    }
    if (u.uswallow && !returning_missile) {
        await DT.swallowit(otmp);
        return ECMD_TIME;
    }

    // C ref: dothrow.c throwit():1710 — a Mjollnir or aklys that reached the end
    // of its flight tries to come back: rn2(100) for the tether holding, then
    // rn2(100) again for a clean catch, else rn2(2)+rnd(3) damage to your arm.
    if (returning_missile) {
        if (rn2(100)) {
            if (tethered_weapon) await land.flash.end(true); /* BACKTRACK */
            else await DT.sho_obj_return_to_u(otmp); /* display its flight */
            if (!impaired && rn2(100)) {
                await update_topl(`${Tobjnam_throw(otmp, 'return')} to your hand!`);
                if (((otmp.owornmask | 0) & QW_QUIVER) !== 0) setuqwep(null);
                const back = await return_throw_to_inv(otmp, wep_mask);
                setuwep_slot(back);
                if (cansee(land.x, land.y)) newsym(land.x, land.y);
            } else {
                let dmg = rn2(2);
                if (!dmg) {
                    await update_topl(`${Tobjnam_throw(otmp, 'return')} back to you, landing ${
                        (u?.uprops?.Levitation) ? 'beneath' : 'at'} your ${
                        makeplural(body_part(5 /*FOOT*/))}.`);
                } else {
                    dmg += rnd(3);
                    await update_topl(`${Tobjnam_throw(otmp, 'fly')} back toward you, hitting your ${
                        body_part(0 /*ARM*/)}!`);
                    if (otmp.oartifact) {
                        const { artifact_hit } = await import('./artifact.js');
                        const mdmg = { d: dmg };
                        await artifact_hit(null, game.youmonst || game.u, otmp, mdmg, 0);
                        dmg = mdmg.d;
                    }
                    await losehp_invent(Maybe_Half_Phys(dmg), killer_xname(otmp), 1 /* KILLED_BY */);
                }
                otmp.owornmask = 0;
                if (u.uswallow) {
                    await DT.swallowit(otmp);
                    return ECMD_TIME;
                }
                // C ref: dothrow.c:1754 `if (!ship_object(obj, u.ux, u.uy,
                // FALSE)) dropy(obj);` — a boomeranging weapon that lands at
                // the hero's feet over a hole goes down with it.
                const { ship_object } = await import('./dokick.js');
                if (!(await ship_object(otmp, u.ux, u.uy, false))) {
                    mkobj_place_object(otmp, u.ux, u.uy);
                    otmp.where = OBJ_FLOOR;
                    stackobj(otmp);
                    newsym(u.ux, u.uy);
                }
            }
            return ECMD_TIME;
        }
        // C ref: dothrow.c:1770 — the 1-in-100 failure; the weapon falls where
        // it landed and is picked up again by walking over it (how_lost).
        if (tethered_weapon) await land.flash.end();
        await update_topl(`${Tobjnam_throw(otmp, 'fail')} to return!`);
        if (u.uswallow) {
            await DT.swallowit(otmp);
            return ECMD_TIME;
        }
    }

    // C ref: dothrow.c throwit():1780 — `(!IS_SOFT(typ) && breaktest(obj)) ||
    // obj->oclass == VENOM_CLASS`: venom fails breaktest but is forced to break
    // even on soft terrain.  Then breakmsg() + breakobj(); the second is where
    // the mirror's Luck penalty, the camera demon's rn2(3)s and a next2u()
    // potion's potionbreathe() live, none of which a bare delobj() ran.
    const typ = game.level.at(land.x, land.y)?.typ ?? 0;
    const broke = (!IS_SOFT(typ) && DT.breaktest(otmp)) || otmp.oclass === VENOM_CLASS;
    if (broke) {
        // C ref: dothrow.c:1784-1787 — the breaking missile is flashed once at
        // its landing square: tmp_at(DISP_FLASH, obj_to_glyph(obj,
        // rn2_on_display_rng)); tmp_at(bhitpos); nh_delay_output(); DISP_END.
        const bflash = tmp_at_flash(otmp);
        await bflash.step(land.x, land.y);
        await bflash.end();
        await DT.breakmsg(otmp, cansee(land.x, land.y));
        otmp.owornmask = 0;
        if (await DT.breakobj(otmp, land.x, land.y, true, true)) {
            newsym(land.x, land.y);
            return ECMD_TIME;
        }
    }
    // C ref: dothrow.c:1794-1807 — landing damage precedes floor placement.
    const { is_pool, is_lava } = await import('./dbridge.js');
    const deaf = u.uprops?.HDeaf || u.uprops?.EDeaf || u.uprops?.Deaf
        || u.HDeaf || u.EDeaf || u.Deaf || u.uroleplay?.deaf;
    if (!deaf && !Underwater) {
        const data = objects[otmp.otyp];
        const mat = data?.material;
        const flammable = ((mat <= 8 /* WOOD */ && mat !== 1 /* LIQUID */)
                           || mat === 18 /* PLASTIC */)
            && otmp.otyp !== TALLOW_CANDLE && otmp.otyp !== WAX_CANDLE
            && otmp.otyp !== WAN_FIRE && data?.oc_oprop !== FIRE_RES;
        if (is_pool(land.x, land.y) || (is_lava(land.x, land.y) && !flammable))
            await update_topl(weight(otmp) > WT_SPLASH_THRESHOLD ? 'Splash!' : 'Plop!');
    }
    const { flooreffects } = await import('./do.js');
    if (await flooreffects(otmp, land.x, land.y, 'fall')) return ECMD_TIME;
    // C ref: dothrow.c:1813-1820 — a shopkeeper who was in the way (and the
    // pick-axe missed or was not caught outright) snatches it up.
    if (land.mon && land.mon.isshk && is_pick(otmp)) {
        if (cansee(land.x, land.y)) {
            const { Monnam } = await import('./uhitm.js');
            await update_topl(`${Monnam(land.mon)} snatches up ${the_name_of(otmp)}.`);
        }
        if (((u.ushops || []).length || otmp.unpaid))
            await DT.check_shop_obj(otmp, land.x, land.y, false);
        (await import('./steal.js')).mpickobj(land.mon, otmp); /* may merge and free obj */
        return ECMD_TIME;
    }
    // C ref: dothrow.c:1818 — `if (!mon && ship_object(obj, bhitpos.x,
    // bhitpos.y, FALSE))`: the missile landed on a hole/trap door/down stairs
    // and rides it to the level below instead of resting here.
    if (!land.mon) {
        const { ship_object } = await import('./dokick.js');
        if (await ship_object(otmp, land.x, land.y, false)) return ECMD_TIME;
    }
    otmp.owornmask = 0;
    mkobj_place_object(otmp, land.x, land.y);
    otmp.where = OBJ_FLOOR;
    otmp.how_lost = LOST_THROWN;
    // C ref: dothrow.c:1827-1832 - a container's glass/egg contents may break
    // on impact (at the spot the throw began), then zombies are disturbed.
    if (!IS_SOFT(typ)) {
        const { container_impact_dmg } = await import('./dokick.js');
        await container_impact_dmg(otmp, u.ux, u.uy);
        const { impact_disturbs_zombies } = await import('./monmove.js');
        impact_disturbs_zombies(otmp, true);
    }
    // C ref: dothrow.c:1834-1836 — charge for items thrown out of a shop; the
    // shk takes possession of items thrown into one (or buys them).
    if (((u.ushops || []).length || otmp.unpaid) && otmp !== game.uball)
        await DT.check_shop_obj(otmp, land.x, land.y, false);
    // C ref: dothrow.c throwit():1838 stackobj(obj) after place_object() —
    // a thrown apple merges into an identical pile already on that square.
    stackobj(otmp);
    // C ref: dothrow.c:1841-1842. The landing square is redrawn only when the
    // hero can see it (an unseen square holding a warned monster would
    // otherwise redraw its warning glyph).
    if (cansee(land.x, land.y)) newsym(land.x, land.y);
    return ECMD_TIME;
}

// C ref: dothrow.c hitfloor(obj, verbosely) — an object lands at the hero's
// feet: announce it, run hero_breaks() (breaktest's obj_resists rn2(100)) and
// drop it.  Split out of throw_obj() so toss_up() can reuse it.
export async function hitfloor(otmp, verbosely) {
    const u = game.u;
    const hereTyp = game.level.at(u.ux, u.uy)?.typ ?? 0;
    // C ref: dothrow.c:610 — soft ground (air/cloud/water), being underwater or
    // being swallowed all short-circuit to dropy(): no message, no break test.
    if (IS_SOFT(hereTyp) || u.uinwater || u.uswallow) {
        otmp.owornmask = 0;
        otmp.how_lost = LOST_THROWN;
        await dropy(otmp);
        return;
    }
    if (IS_ALTAR(hereTyp)) {
        // C ref: dothrow.c:614 `doaltarobj(obj)` replaces the "hits the floor" line.
        await (await import('./do.js')).doaltarobj(otmp);
    } else if (verbosely) {
        // C ref: dothrow.c:617 — a wand of striking "strike"s rather than
        // "hit"s, and a SEEN trapdoor/hole/pit renames the surface it lands on.
        const dn = doname_invent(otmp);
        const verb = otense(otmp, otmp.otyp === WAN_STRIKING_OTYP ? 'strike' : 'hit');
        let surf = surface_underfoot();
        const t = trap_at_hero();
        if (t && t.tseen) {
            if (t.ttyp === TRAPDOOR_TTYP) surf = 'trap door';
            else if (t.ttyp === HOLE_TTYP) surf = 'edge of the hole';
            else if (t.ttyp === PIT_TTYP || t.ttyp === SPIKED_PIT_TTYP) surf = 'edge of the pit';
        }
        await update_topl(`${dn.charAt(0).toUpperCase()}${dn.slice(1)} ${verb} the ${surf}.`);
    }
    otmp.owornmask = 0;
    // C ref: dothrow.c:642 `if (hero_breaks(obj, u.ux, u.uy, BRK_FROM_INV))
    // return;` — this is where a dropped mirror costs 2 Luck and a smashed
    // camera rolls its demon; the port used to inline a bare delobj().
    if (await DT.hero_breaks(otmp, u.ux, u.uy, BRK_FROM_INV)) {
        newsym(u.ux, u.uy);
        return;
    }
    // C ref: dothrow.c:644 `if (ship_object(obj, u.ux, u.uy, FALSE)) return;`
    // — the hero is standing on a hole/trap door/down stairs, so what lands at
    // their feet keeps going to the level below.
    {
        const { ship_object } = await import('./dokick.js');
        if (await ship_object(otmp, u.ux, u.uy, false)) return;
    }
    // C ref: dothrow.c:646 `dropz(obj, TRUE)` — flooreffects, container impact
    // damage, zombie disturbance and (in a shop) sellobj() all live there.
    otmp.how_lost = LOST_THROWN;
    await dropz(otmp, u.ux, u.uy, true);
}
// C ref: trap.c t_at(u.ux, u.uy).
function trap_at_hero() {
    for (const t of game.level?.traps ?? [])
        if (t.tx === game.u.ux && t.ty === game.u.uy) return t;
    return null;
}
// C ref: trap.h trap_types PIT/SPIKED_PIT/HOLE/TRAPDOOR and onames.h
// WAN_STRIKING (js/mkobj.js OBJECT_DATA otyp).
const PIT_TTYP = 11, SPIKED_PIT_TTYP = 12, HOLE_TTYP = 13, TRAPDOOR_TTYP = 14;
const WAN_STRIKING_OTYP = 417;

// C ref: dungeon.c ceiling(x,y) — the noun for what is overhead.  (The
// vault/temple/shop room qualifiers need in_rooms(), which this port stubs.)
function ceiling_of(x, y) {
    return ceiling_dg(x, y);
}

// C ref: dothrow.c harmless_missile(obj) — the arbitrary list of things that
// don't hurt when they land on your head.
export function harmless_missile(obj) {
    const otyp = obj.otyp;
    switch (otyp) {
    case 87:  /* SLING (83 is BOW) */
    case 275: /* KELP_FROND */
    case 276: /* EUCALYPTUS_LEAF */
    case 283: /* SPRIG_OF_WOLFSBANE */
    case 289: /* FORTUNE_COOKIE */
    case 290: /* PANCAKE */
        return true;
    case 78:  /* RUBBER_HOSE */
    case 220: /* BAG_OF_TRICKS */
        return (obj.spe | 0) < 1;
    case 217: /* SACK */
    case 218: /* OILSKIN_SACK */
    case 219: /* BAG_OF_HOLDING */
        return !(obj.cobj && obj.cobj.length);
    default:
        if (obj.oclass === SCROLL_CLASS) return true;
        if ((objects[otyp]?.material | 0) === 6 /* CLOTH */) return true;
        break;
    }
    return false;
}

// C ref: youprop.h Blind — the hero cannot see.
function Blinded_hero() { return Blind_for_wear(); }
// C ref: hack.h Hallucination — used by mergable()'s bknown/rknown arms.
function Hallucination_hero() { return !!(game.u?.uhallu || game.u?.HHallucination || game.u?.uprops?.Hallucination); }
// C ref: mondata.c can_blnd(&youmonst, &youmonst, AT_WEAP, obj) — a blindfold
// or towel (but NOT lenses) already covers the eyes.  (The eyeless-form and
// helmet-visor arms need polyform/visor state this port does not carry.)
function can_blnd_hero() {
    return !(game.ublindf && game.ublindf.otyp !== LENSES);
}


// C ref: dothrow.c toss_up(obj, hitsroof) — the hero threw something straight
// up.  Runs until the object has landed (and possibly hit the hero).
async function toss_up(otmp, hitsroof) {
    const u = game.u;
    const roof = ceiling_of(u.ux, u.uy);
    const Doname2 = (o) => { const d = doname_invent(o); return d.charAt(0).toUpperCase() + d.slice(1); };
    let action;
    if (hitsroof) {
        if (DT.breaktest(otmp)) {
            await update_topl(`${Doname2(otmp)} hits the ${roof}.`);
            await DT.breakmsg(otmp, !Blinded_hero());
            // C ref: dothrow.c:1273 — crackable armor passes breaktest() but
            // survives breakobj(), so it still lands on the floor.
            if (!(await DT.breakobj(otmp, u.ux, u.uy, true, true))) {
                await hitfloor(otmp, false);
                return;
            }
            newsym(u.ux, u.uy);
            return;
        }
        action = 'hits';
    } else {
        action = 'almost hits';
    }
    await update_topl(`${Doname2(otmp)} ${action} the ${roof}, then falls back on top of your ${
        body_part(8 /*HEAD*/)}.`);

    // The object now hits the hero.  (C's potion arm comes first; the
    // egg/cream-pie blinding and petrification arms follow breakobj().)
    if (DT.breaktest(otmp)) {
        // C ref: dothrow.c:1295 — the blindness increment has to be rolled
        // BEFORE the object is destroyed.
        const otyp_up = otmp.otyp;
        const blindinc = ((otyp_up === 287 /*CREAM_PIE*/ || otyp_up === 479 /*BLINDING_VENOM*/)
                          && can_blnd_hero()) ? rnd(25) : 0;
        await DT.breakmsg(otmp, !Blinded_hero());
        const gone = await DT.breakobj(otmp, u.ux, u.uy, true, true);
        if (otyp_up === 266 /*EGG*/ || otyp_up === 287 /*CREAM_PIE*/
            || otyp_up === 479 /*BLINDING_VENOM*/) {
            await update_topl(`You've got it all over your ${body_part(2 /*FACE*/)}!`);
            if (blindinc) {
                if (otyp_up === 479 && !Blinded_hero())
                    await update_topl('It blinds you!');
                u.ucreamed = (u.ucreamed | 0) + blindinc;
                u.blinded = (u.blinded | 0) + blindinc;
                game.botl = true;
            }
        }
        if (gone) { newsym(u.ux, u.uy); return; }
        await hitfloor(otmp, false);
        return;
    }
    if (harmless_missile(otmp)) {
        await update_topl("It doesn't hurt.");
        await hitfloor(otmp, false);
        return;
    }
    // C ref: dothrow.c:1358 `int dmg = dmgval(obj, &gy.youmonst);` then the
    // weight-based fallback for non-weapons, the hard-helmet reduction and
    // losehp().  The hero's own form is never bigmonst, so dmgval() rolls the
    // small-damage die.
    const U = await import('./uhitm.js');
    let dmg = U.dmgval(otmp, { data: youmonst_data() });
    if (!dmg) {
        dmg = Math.trunc(((otmp.owt | 0) + 99) / 100);
        dmg = (dmg <= 1) ? 1 : rnd(dmg);
        if (dmg > 6) dmg = 6;
    }
    const less_damage = hard_helmet(game.uarmh);
    if (dmg > 1 && less_damage) dmg = 1;
    if (dmg > 0) dmg += (game.u.udaminc | 0);
    if (dmg < 0) dmg = 0;
    dmg = Maybe_Half_Phys(dmg);
    if (game.uarmh) {
        if (less_damage && dmg < (game.u.uhp | 0))
            await update_topl('Fortunately, you are wearing a hard helmet.');
        else if (game.flags?.verbose !== false)
            await update_topl(`Your ${armor_simple_name(game.uarmh)} does not protect you.`);
    }
    await hitfloor(otmp, true);
    await losehp_invent(dmg, 'falling object', 0 /* KILLED_BY_AN */);
}

// C ref: weapon.c skill_name() — launcher name for the throw "by hand" message.
function skill_name_for(skill) {
    if (skill === 20) return 'bow';      // P_BOW
    if (skill === 21) return 'sling';    // P_SLING
    if (skill === 22) return 'crossbow'; // P_CROSSBOW
    return 'weapon';
}
// C ref: attrib.c ACURRSTR — current strength on the 3..25 throwing scale.
function acurr_str_throw() {
    const str = acurr_str_encoded();
    if (str <= 18) return Math.max(str, 3);
    if (str <= 121) return 19 + Math.trunc(str / 50);
    return Math.min(str, 125) - 100;
}
// C ref: rm.h `#define IS_SOFT(typ) ((typ) == AIR || (typ) == CLOUD || IS_POOL(typ))`
// with AIR=35, CLOUD=36 and IS_POOL(typ) = POOL(16)..DRAWBRIDGE_UP(19).  This
// local shadowed const.js's correct IS_SOFT with POOL||MOAT||19 — so WATER and
// a raised drawbridge were hard, and AIR/CLOUD were too.
function IS_SOFT(typ) { return typ === 35 /* AIR */ || typ === 36 /* CLOUD */
                            || (typ >= 16 /* POOL */ && typ <= 19 /* DRAWBRIDGE_UP */); }

// ── shared with js/dothrow.js ────────────────────────────────────────────────
//
// js/dothrow.js holds the dothrow.c functions that never had a home here
// (breaktest/breakmsg/breakobj, throw_gold, gem_accept, autoquiver,
// ok_to_throw, endmultishot, use_whip).  They need this file's private helpers;
// re-export rather than duplicate.
// setuqwep/yname/splitobj/obj_extract_self/dropx are already `export function`
// above (do_wear.js needs them too) — listing them here again is a SyntaxError.
export { obj_resists, uslinging, is_ammo, is_missile, is_launcher,
         ammo_and_launcher, matching_launcher, throwing_weapon,
         acurrstr, bhit_thrown_landing,
         an, singular_name, weapon_type, mshot_xname,
         thitmonst, youmonst_data as youmonst_data_pub, ceiling_of,
         losehp_invent as losehp_throw, dbon,
         acurr_eff as acurr_attr, Role_if, simpleonames };

// C ref: mondata.h notake(ptr) / nohands(ptr) applied to gy.youmonst.data.
// monflag.h: M1_NOTAKE is 0x00000800 and M1_NOHANDS 0x00002000; the literals
// that used to sit here (0x00080000 / 0x00000200) are M1_SLITHY and
// M1_AMPHIBIOUS, so both predicates answered FALSE for every polyform that
// really has neither.
export function notake_youmonst() {
    return (mflags1_of(youmonst_data()) & M1_NOTAKE) !== 0;
}
export function nohands_youmonst() {
    return (mflags1_of(youmonst_data()) & M1_NOHANDS) !== 0;
}
// C ref: mondata.h verysmall(ptr) — msize < MZ_SMALL, i.e. MZ_TINY only.
export function verysmall_youmonst() {
    return (youmonst_data()?.msize ?? 1) < 1 /* MZ_SMALL */;
}
// C ref: hack.c check_capacity(str) — `near_capacity() >= EXT_ENCUMBER`, i.e.
// refuse from "extremely burdened" upward (NOT only at OVERLOADED).
export async function check_capacity_throw() {
    if (near_capacity() >= EXT_ENCUMBER) {
        await update_topl("You can't do that while carrying so much stuff.");
        return true;
    }
    return false;
}
// C ref: rnd.c change_luck(n) — clamped to [LUCKMIN, LUCKMAX] (js/uhitm.js and
// js/pray.js keep file-static copies of the same body).
export function change_luck(n) {
    const u = game.u;
    if (!u) return;
    u.uluck = (u.uluck || 0) + n;
    if (u.uluck < -10) u.uluck = -10;
    if (u.uluck > 10) u.uluck = 10;
}
// C ref: objnam.c singular(obj, xname) — xname() of a temporarily-singular obj.
function singular_name(obj) {
    const save = obj.quan;
    obj.quan = 1;
    const s = xname(obj);
    obj.quan = save;
    return s;
}

// C ref: dothrow.c dothrow() — the 't' command.  Reads the throw target via
// getobj, then the direction, then performs the throw.  getDir is supplied by
// the caller (cmd.js getdir) to avoid a cmd<->invent import cycle.
export async function dothrow(getDir) {
    // C ref: dothrow.c:368 `if (!ok_to_throw(&shotlimit)) return ECMD_OK;` —
    // the count prefix becomes the volley limit and a notake/nohands/OVERLOADED
    // hero is refused before getobj() draws its prompt.
    const shotlimit = await DT.ok_to_throw();
    if (shotlimit < 0) return ECMD_OK;
    const obj = await getobj('throw', throw_ok, GETOBJ_PROMPT | GETOBJ_ALLOWCNT);
    if (!obj) return ECMD_CANCEL;
    if (obj === hands_obj) return ECMD_CANCEL;
    const dir = await getDir();
    if (!dir) return ECMD_CANCEL; // no direction -> cancel, no time
    return await throw_obj(obj, dir, shotlimit);
}

// C ref: dothrow.c find_launcher() — scan the pack for a launcher matching
// `ammo`; a known-cursed one is skipped, a known-BUC one wins outright, and an
// unidentified-BUC one is only the fallback.
function find_launcher(ammo) {
    if (!ammo) return null;
    let oX = null;
    for (const otmp of inventoryArray()) {
        if (otmp.cursed && otmp.bknown) continue;
        if (ammo_and_launcher(ammo, otmp)) {
            if (otmp.bknown) return otmp;
            if (!oX) oX = otmp;
        }
    }
    return oX;
}

// C ref: dothrow.c dofire() — the #fire ('f') command.  Throws/shoots from the
// quiver, with fireassist auto-wielding the launcher.  Ports the ranger path the
// recorded sessions take: quiver holds bow ammo (arrows), the matching bow is the
// secondary weapon (uswapwep) while a dagger is wielded.  fireassist finds the
// launcher in the swap slot, so C queues `doswapweapon` then re-runs `dofire`:
//   - doswapweapon -> ready_weapon(bow): prints "b - a +1 bow (weapon in right
//     hand)." (prinv) and wields it; then re-readies the old uwep as the
//     secondary weapon, printing its prinv line (which forces a --More-- after
//     the bow line since the two messages don't share the top line).
//   - the re-run dofire now has ammo_and_launcher(uquiver, uwep) true, so it
//     throw_obj()s the ammo, which asks getdir("In what direction?").
// All of this is RNG-free until an actual missile is launched; the recorded
// session cancels at the direction prompt (invalid key + ESC), so no shot fires.
// getDir is supplied by the caller (cmd.js getdir) to avoid an import cycle.
export async function dofire(getDir) {
    const u = game.u;
    // C ref: dothrow.c:498 `if (!ok_to_throw(&shotlimit)) return ECMD_OK;`
    const shotlimit = await DT.ok_to_throw();
    if (shotlimit < 0) return ECMD_OK;

    let obj = game.uquiver;

    // C ref: dothrow.c:475 — a wielded throw-and-return weapon (aklys, or
    // Mjollnir for a strong enough Valkyrie, or a boomerang) is thrown itself
    // when the quiver is empty or holds ammo, and skips fireassist.
    const uwep_Throw_and_Return = !!(game.uwep
        && AutoReturn(game.uwep, game.uwep.owornmask)
        && (game.uwep.oartifact !== ART_MJOLLNIR
            || acurr_eff(A_STR) >= STR19_25));
    let skip_fireassist = false;
    let res = ECMD_OK;

    if (uwep_Throw_and_Return && (!obj || is_ammo(obj))) {
        obj = game.uwep;
        skip_fireassist = true;

    // C ref: dothrow.c:510-541 — empty quiver with flags.autoquiver off (the
    // default).  Omitting this made 'f' with an empty quiver a silent no-op, so
    // every following keystroke was read by the command parser instead of by
    // the "What do you want to fire?" prompt.
    } else if (!obj) {
      if (!game.flags?.autoquiver) {
        // C ref: dothrow.c:512 — a WIELDED polearm is applied instead of fired,
        // and C `return`s that result (it does NOT fall through to
        // doquiver_core).  This is the second half of the Knight's 'f': the
        // uswapwep branch below swaps the lance in and re-runs dofire, which
        // then lands here.
        if (game.uwep && is_pole(game.uwep)) {
            const A = await import('./apply.js');
            const r = await A.use_pole(game.uwep, true);
            return r === A.ECMD.ECMD_TIME ? ECMD_TIME : ECMD_OK;
        }
        // C ref: dothrow.c:516 `} else if (uwep && uwep->otyp == BULLWHIP) {
        // return use_whip(uwep); }` — the Archeologist starts wielding a
        // bullwhip with an empty quiver, so their very first 'f' lands here.
        // Without this arm dofire() fell through to "You have no ammunition
        // readied." + the fire prompt, and the direction key the player typed
        // next was eaten by getobj instead of by use_whip's getdir.
        if (game.uwep && game.uwep.otyp === DT.BULLWHIP)
            return await DT.use_whip(game.uwep, getDir);
        if (game.uswapwep && is_pole(game.uswapwep)
            && !(game.uswapwep.cursed && game.uswapwep.bknown)) {
            // cmdq: doswapweapon then re-run dofire.  C ref: wield.c:472-474 —
            // the queued doswapweapon refuses a welded uwep (weldmsg,
            // ECMD_FAIL) and cmd.c:3810-3813 reset_cmd_vars(TRUE) then drops
            // the queued dofire: no swap, no turn.
            if (welded(game.uwep)) {
                await weldmsg(game.uwep);
                return ECMD_FAIL;
            }
            await doswapweapon_inline();
            game.context.move = 0;
            // C ref: cmd.c rhack(). The queued doswapweapon returned
            // ECMD_TIME and is not dokick, so the kicked location resets.
            game.kickedloc = { x: 0, y: 0 };
            game._cmdqAbandonRetry = false;
            await moveloop_turn();
            // C ref: dothrow.c:523-524 queues doswapweapon + dofire; allmain.c
            // stop_occupation()'s cmdq_clear(CQ_CANNED) drops the queued dofire
            // if anything interrupted the hero during the swap's turn (a monster
            // attack) — same abandonment as the launcher swap below.
            if (game._cmdqAbandonRetry) return ECMD_OK;
            return await dofire(getDir);
        } else {
            await pline('You have no ammunition readied.');
            game._yn_need_more = true; // getobj's prompt pages this line first
        }
      } else {
        // C ref: dothrow.c:529 — with the autoquiver option On, fill the quiver
        // and say what got readied (C clears W_QUIVER around prinv so the line
        // reads "You ready: <item>." without the "(in quiver)" suffix).
        DT.autoquiver();
        obj = game.uquiver;
        if (obj) {
            const saved = obj.owornmask || 0;
            obj.owornmask = saved & ~QW_QUIVER;
            prinv('You ready:', obj, 0);
            obj.owornmask = saved;
        } else {
            await pline('You have nothing appropriate for your quiver.');
            game._yn_need_more = true;
        }
      }
    }

    if (!obj) {
        res = await doquiver_core('fire');
        if (res !== ECMD_OK && res !== ECMD_TIME) return res;
        obj = game.uquiver;
    }

    // C ref: dothrow.c:557 — `if (uquiver && is_ammo(uquiver) && iflags.fireassist
    // && !skip_fireassist)`.  fireassist defaults On.
    if (game.uquiver && is_ammo(game.uquiver) && !skip_fireassist) {
        // uwep (a dagger) is not a polearm here, so skip use_pole.
        if (ammo_and_launcher(game.uquiver, game.uwep)) {
            // launcher already wielded: fire it directly.
            obj = game.uquiver;
        } else if (ammo_and_launcher(game.uquiver, game.uswapwep)) {
            // C ref: dothrow.c:566 — `cmdq_add_ec(doswapweapon); cmdq_add_ec(dofire)`.
            // doswapweapon is run as its own command: it wields the launcher
            // (printing the wield + secondary-weapon lines) and returns ECMD_TIME,
            // so a turn elapses BEFORE the re-queued dofire runs.  We take that
            // turn inline (mirroring hack.js run_movement), then retry the fire.
            // C ref: wield.c doswapweapon() — `if (welded(uwep)) { weldmsg(uwep);
            // return ECMD_FAIL; }`.  ECMD_FAIL makes rhack() reset_cmd_vars(TRUE)
            // (cmd.c:3810), discarding the queued dofire: no time passes.
            if (welded(game.uwep)) {
                await weldmsg(game.uwep);
                return res;
            }
            await doswapweapon_inline();
            // C ref: ready_weapon() returns ECMD_TIME — the swap costs a turn even
            // though the subsequent throw may be cancelled.  Take it inline.
            game.context.move = 0;
            game.kickedloc = { x: 0, y: 0 }; // rhack() epilogue, as above
            game._cmdqAbandonRetry = false;
            const moves_before = game.moves;
            const hp_before = game.u.uhp, pw_before = game.u.uen;
            await moveloop_turn();
            // C ref: the queued dofire runs from rhack()'s canned-command queue,
            // which never reaches parse()'s flush_screen(1).  The only flush
            // after the swap's turn is moveloop_core()'s `bot(); curs_on_u()` /
            // `timebot(); curs_on_u()` (allmain.c:473-479: status dirty, or T:
            // republished because flags.time and a turn passed).  A message
            // printed during the turn flushed at vpline() time, BEFORE the
            // monsters finished moving, and its bot() cleared disp.botl, so it
            // does not republish the map.  u_regen_hp()/regen_pw() set
            // disp.botl (allmain.c:647,667); this port does not track that
            // flag for regen, so compare the values.
            if (game.botl || game.botlx
                || game.u.uhp !== hp_before || game.u.uen !== pw_before
                || (game.flags?.time && !game.context?.run && game.moves !== moves_before))
                await flush_screen(1);
            // C ref: dothrow.c:568-569 `cmdq_add_ec(doswapweapon);
            // cmdq_add_ec(dofire); return res;` — the requeued dofire is a
            // SEPARATE top-level command that only runs if it's still in the
            // queue by the time control returns to rhack().  allmain.c:695
            // `stop_occupation()`'s unconditional `cmdq_clear(CQ_CANNED)`
            // discards it the instant anything interrupts the hero during
            // the swap's turn (e.g. hitmu() calling stop_occupation() after
            // a monster's hit) — the fire is abandoned outright, and the
            // NEXT real key starts a genuinely fresh top-level command
            // (parse():5147 silently clears the pending topline, no
            // --More--).  This port takes the swap's turn inline instead of
            // through a real queue, so mirror the abandonment: if
            // stop_occupation() fired during THIS turn, stop here rather
            // than resuming into getDir(), which would page a message C had
            // already walked away from (bl039 step 93: "The kobold hits!"
            // gained a spurious --More--).  ECMD_OK (not ECMD_TIME): the
            // swap's turn was already taken inline above, and no further
            // time elapses for the abandoned fire.
            if (game._cmdqAbandonRetry) { await flush_screen(1); return ECMD_OK; }
            // retry dofire: now the launcher is wielded.
            obj = game.uquiver;
        } else {
            // C ref: dothrow.c:571 — launcher is in the PACK (a Samurai's yumi:
            // ini_inv fills uwep with the katana and uswapwep with the
            // wakizashi, so the bow never reaches a weapon slot).  C queues
            // `doswapweapon`, `dowield`, the launcher's invlet and `dofire`, and
            // rhack() dispatches each as its own command — so BOTH ready_weapon
            // calls return ECMD_TIME and each runs a full moveloop turn before
            // the next runs.  Collapsing them into one turn desyncs the stream:
            // with intrinsic Fast the hero often holds 24 movement points, so
            // the first turn only runs movemon() and the second is the one that
            // reallocates movement.
            const olauncher = find_launcher(game.uquiver);
            if (olauncher) {
                if (game.uwep && !game.flags?.pushweapon) {
                    if (welded(game.uwep)) {
                        await weldmsg(game.uwep);
                        return res;
                    }
                    if ((await doswapweapon()) === ECMD_TIME) {
                        game.context.move = 0;
                        game.kickedloc = { x: 0, y: 0 }; // rhack() epilogue
                        game._cmdqAbandonRetry = false;
                        await moveloop_turn();
                        // C ref: pline.c vpline() flush_screen() for dowield()'s
                        // next message (and the --More-- it forces) shows the
                        // map as of this swap turn's end.
                        await flush_screen(1);
                        // C: stop_occupation() during the swap's turn did
                        // cmdq_clear(CQ_CANNED), dropping dowield + dofire.
                        if (game._cmdqAbandonRetry) return ECMD_OK;
                        // C ref: win/tty/topl.c update_topl():257 `skip =
                        // (flags & (WIN_STOP|WIN_NOSTOP)) == WIN_STOP` —
                        // doswapweapon()'s pending secondary-weapon line needs
                        // paging before dowield() replaces it with the
                        // launcher's line, UNLESS the player already dismissed
                        // an earlier --More-- with ESC this same command
                        // (game._winStop), in which case C silently overwrites
                        // the hidden line instead of blocking again. This used
                        // to compare game._pending_message against its
                        // pre-turn value as a "did winStop fire" proxy — the
                        // wrong question (whether an autonomous message fired
                        // during the swap's turn) — forcing a bogus extra
                        // --More-- whenever the only dismissal was the real
                        // ESC that set winStop (bl010 step 495: JS blocked on
                        // "d - ... (alternate weapon)" while C's getdir() had
                        // already absorbed it and gone straight to "In what
                        // direction?").
                        if (!game._winStop) {
                            await display_nhwindow_message();
                        }
                    }
                }
                // The queued invlet is popped by getobj()'s cmdq fast path, so
                // dowield draws no prompt.
                cmdq_add_key(CQ_CANNED, olauncher.invlet);
                if ((await dowield()) === ECMD_TIME) {
                    game.context.move = 0;
                    game.kickedloc = { x: 0, y: 0 }; // rhack() epilogue
                    game._cmdqAbandonRetry = false;
                    const moves_before = game.moves;
                    const hp_before = game.u.uhp, pw_before = game.u.uen;
                    await moveloop_turn();
                    // C ref: same flush analysis as the fireassist swap turn
                    // above — a queued command never reaches parse()'s
                    // flush_screen(1); a pline during the turn flushed at
                    // vpline() time (before the pet moved), so only a dirty
                    // status line or the T: counter republishes the map.
                    if (game.botl || game.botlx
                        || game.u.uhp !== hp_before || game.u.uen !== pw_before
                        || (game.flags?.time && !game.context?.run && game.moves !== moves_before))
                        await flush_screen(1);
                    // C: an interrupt during the wield's turn dropped the
                    // queued dofire (cmdq_clear(CQ_CANNED)).
                    if (game._cmdqAbandonRetry) return ECMD_OK;
                }
                obj = game.uquiver;
            }
        }
    }

    // C ref: dothrow.c:582 — `altres = obj ? throw_obj(obj, shotlimit)
    // : ECMD_CANCEL; return (res == ECMD_TIME) ? res : altres;`  Filling the
    // quiver can consume time even when the throw itself is cancelled.  Our
    // throw_obj() takes the direction from the caller, so getDir() stands in
    // for the getdir() inside C's throw_obj.
    if (!obj) return (res === ECMD_TIME) ? res : ECMD_CANCEL;
    const dir = await getDir();
    if (!dir) return (res === ECMD_TIME) ? res : ECMD_OK;
    const altres = await throw_obj(obj, dir, shotlimit);
    return (res === ECMD_TIME) ? res : altres;
}

// C ref: wield.c doswapweapon()/ready_weapon() — swap the primary and secondary
// weapons.  Prints the new primary's prinv line ("<let> - <name> (weapon in
// right hand).") and, because a secondary weapon remains, that weapon's prinv
// line too; the two lines don't share the top line so a --More-- is forced
// between them (xwaitforspace rejects all but space/return/ESC).  RNG-free for
// the dagger<->bow swap the recorded session performs.
async function doswapweapon_inline() {
    const oldwep = game.uwep;
    const oldswap = game.uswapwep;
    // setuswapwep(NULL) then ready_weapon(oldswap): wield the launcher.
    setuswapwep(null);
    // ready_weapon: message printed with W_WEP set (kludge), then setuwep.
    if (oldswap && will_weld(oldswap)) {
        // C ref: wield.c:195 ready_weapon() — a cursed weapon welds itself.
        await update_topl(weld_wield_msg(oldswap));
        oldswap.bknown = 1;
    } else if (oldswap) {
        const dummy = oldswap.owornmask || 0;
        oldswap.owornmask = dummy | QW_WEP;
        prinv(null, oldswap, 0);     // "b - a +1 bow (weapon in right hand)."
        oldswap.owornmask = dummy;
        game._toplin = 1;            // TOPLIN_NEED_MORE: a message follows
    }
    setuwep_slot(oldswap);
    // set the new secondary weapon (the old primary) and announce it; the
    // announcement forces the --More-- after the launcher line.
    if (game.uwep === oldwep) {
        setuswapwep(oldswap);
    } else {
        setuswapwep(oldwep);
        // C ref: wield.c doswapweapon():486-494 — this second prinv()/pline()
        // for the secondary slot ALWAYS fires (with a "no secondary weapon
        // readied" fallback when the old primary was empty-handed), and being
        // a SECOND topline write in the same command it forces the FIRST
        // message ("<let> - <name> (weapon in right hand).") to page behind
        // its own --More-- via update_topl()'s pending-line check — even when
        // there is no real secondary weapon left to announce.  Skipping this
        // call outright (as before, when game.uswapwep was falsy) left that
        // first message pending/undrained when this function returned, so the
        // caller's immediately-following moveloop_turn() ran while it was
        // still on screen, showing map changes (a monster stepping into
        // view) a keystroke before C's recording reveals them (bl024: a grid
        // bug appeared 2 keystrokes early, still behind the unacknowledged
        // "b - a +2 sling (weapon in right hand)." --More--).
        await update_topl(game.uswapwep
            ? xprname(game.uswapwep, doname_invent_quan(game.uswapwep, 0),
                      obj_to_let(game.uswapwep), true, 0, 0)
            : 'You have no secondary weapon readied.');
    }
}

// ── Travel command (_) ──────────────────────────────────────────────────
//
// C ref: cmd.c dotravel().  Prompts for a destination via the shared
// getpos() cursor selector (hack.js — also used by #jump/farlook/#terrain),
// in travel mode so auto-describe flags cells with no travel path.  On
// cancel (ESC), no time passes.  Picking a destination runs dotravel_target();
// only findtravelpath()'s adjacent-destination fast path is ported, so a
// farther destination still costs no time.
export async function dotravel() {
    const u = game.u;
    // C ref: cmd.c dotravel():`cc = iflags.travelcc; if (!cc.x && !cc.y) cc = u`
    // — the cursor starts on the PREVIOUS destination, not on the hero, so a
    // second '_' in a session opens with the cursor already parked where the
    // first one left it.
    const iflags = game.iflags = game.iflags || {};
    const tcc = iflags.travelcc || { x: 0, y: 0 };
    if (process.env.DEBUG_TRAVELCC) console.error('DOTRAVEL tcc=', JSON.stringify(tcc), 'u=', u.ux, u.uy, 'dnum/dlvl', game.u.uz?.dnum, game.u.uz?.dlevel);
    const startx = (tcc.x || tcc.y) ? tcc.x : u.ux;
    const starty = (tcc.x || tcc.y) ? tcc.y : u.uy;
    await pline('Where do you want to travel to?');
    // C ref: getpos.c getpos() -> handle_tip(TIP_GETPOS): the first-ever
    // getpos() call pages this pending line with --More-- before showing the
    // farlook tip; on later calls (tip already shown) the tip is skipped and
    // the cursor frame goes straight onto the map at the hero (mirrors
    // dojump()'s identical pre-getpos() paging, since the shared getpos()
    // itself only auto-pages a pending line for verbose callers).
    const TIP_GETPOS = 1 << 4;
    const tipPending = !((game.context?.tips || 0) & TIP_GETPOS);
    if (tipPending) {
        await topl_more();
    } else {
        await getpos_render('Where do you want to travel to?', startx, starty);
        // C's pline() left toplin == NEED_MORE, so getpos()'s "(For
        // instructions type a '?')" MERGES onto this line rather than
        // replacing it (both fit inside CO-8).
        game._toplin = 1; // TOPLIN_NEED_MORE
    }
    // C ref: getpos.c:843 `if (flags.verbose) pline("(For instructions type a
    // '%s')", ...)`.  This was hardcoded true; seed4500's rc sets !verbose, and
    // every other getpos() caller already reads the option.
    // C ref: cmd.c dotravel():5321 `iflags.getloc_travelmode = TRUE` before
    // getpos(), cleared again at :5336 when the player ESCs out.
    iflags.getloc_travelmode = true;
    const cc = await getpos('the desired destination', startx, starty, null,
                            /*force=*/true,
                            /*verbose=*/game.flags?.verbose !== false);
    if (!cc) {
        iflags.getloc_travelmode = false;
        return ECMD_CANCEL; // ESC -> cancelled, no time
    }
    game.iflags = game.iflags || {};
    game.iflags.travelcc = { x: cc.x, y: cc.y };
    return await dotravel_target();
}

// C ref: cmd.c dotravel_target():5348 — the #retravel body dotravel() tail-calls
// once a destination is picked.  The two RNG-free early-outs come first; then
// domove() reaches findtravelpath(TRAVP_TRAVEL), whose adjacent-destination
// fast path IS ported (hack.js travel_adjacent_step).  Longer walks still need
// the BFS and cost no time.
export async function dotravel_target() {
    const u = game.u;
    const cc = game.iflags?.travelcc || { x: 0, y: 0 };
    if (!isok(cc.x, cc.y)) {
        await pline('No travel destination set.');
        return ECMD_OK;
    }
    if (cc.x === u.ux && cc.y === u.uy) {
        await pline('You are already here.');
        game.iflags.travelcc = { x: 0, y: 0 };
        return ECMD_OK;
    }
    // C ref: cmd.c dotravel_target():5362 — the clear sits AFTER both early-outs,
    // so neither "No travel destination set." nor "You are already here." resets
    // it; getloc_travelmode stays set and leaks into the next getpos().
    game.iflags.getloc_travelmode = false;
    u.tx = cc.x; u.ty = cc.y;
    // hack.c:1276 — the fast path zeroes travelcc before taking the step.
    if (await travel_adjacent_step(cc.x, cc.y)) {
        return ECMD_TIME;
    }
    return ECMD_OK;
}

// ── dodrop (C ref: do.c dodrop -> drop) ──
// Wizard/normal 'd' command: prompt for an inventory item then drop it on the
// floor.  The recorded sessions drop ordinary (non-worn, non-cursed) items on
// plain floor, so we model the common drop() path: announce "You drop X.",
// remove it from inventory, place it on the floor and refresh the cell.  The
// shop / altar / sink-ring / water / can't-reach-floor branches (all RNG-free
// for these recordings but unused) are not modelled.  Returns ECMD_TIME (1)
// when an item is dropped, 0 when the command is cancelled.
// C ref: do.c dodrop():29 — the 'd' command: drop one inventory item.  A
// deliberate drop while standing in a shop is prompted ("Sell it? [ynaq]")
// rather than silently bought, unlike an accidental drop (glibr()'s slipping
// ring, a forced cursed-loadstone release, &c) — see shk.c sellobj_state()'s
// own comment for why the distinction matters.
export async function dodrop() {
    const inShop = (game.u?.ushops || []).length > 0;
    if (inShop) (await import('./shk.js')).sellobj_state(SELL_DELIBERATE);
    const obj = await getobj('drop', any_obj_ok, GETOBJ_PROMPT | GETOBJ_ALLOWCNT);
    const result = await drop(obj);
    if (inShop) (await import('./shk.js')).sellobj_state(SELL_NORMAL);
    return result;
}

// C ref: do.c drop().  Normal-floor path only.
async function drop(obj) {
    if (!obj) return 0;                 /* ECMD_FAIL — cancelled */
    if (obj === hands_obj) return 0;
    if (!(await canletgo(obj, 'drop'))) return 0;
    // unwield/unquiver/unswap a dropped wielded item (RNG-free).
    if (obj === game.uwep) {
        if (welded(game.uwep)) { await weldmsg(obj); return 0; }
        setuwep_slot(null);
    }
    if (obj === game.uquiver) setuqwep(null);
    if (obj === game.uswapwep) setuswapwep(null);

    const u = ustate();
    // C ref: do.c drop():758 — Levitation (or an unskilled steed, or a seen
    // pit's edge) bars the floor: freeinv() first, then hitfloor() prints its
    // OWN "X hits/strikes the Y." pline, a second message in the same command
    // that pages behind a --More-- before the turn's housekeeping can run.
    // (u.uswallow keeps its pre-existing, separate gap here; levhack /
    // finesse_ahriman -- Heart of Ahriman ending levitation mid-drop -- needs
    // float_down(), which this port doesn't have.)
    const { can_reach_floor } = await import('./engrave.js');
    if (!u.uswallow && !can_reach_floor(true)) {
        if (game.flags?.verbose) await update_topl(`You drop ${doname(obj)}.`);
        freeinv(obj);
        await hitfloor(obj, true);
        return 1; /* ECMD_TIME */
    }
    // C: `if (!IS_ALTAR(...) && flags.verbose) You("drop %s.", doname(obj));`
    // The wandpoly session runs with !verbose so the drop is silent.
    // C's You() is pline(): it must accumulate onto a pending topline (and page
    // it) so the same-turn monster message merges behind a --More--.
    if (!IS_ALTAR(game.level?.at(u.ux, u.uy)?.typ) && game.flags?.verbose) {
        await update_topl(`You drop ${doname(obj)}.`);
    }
    obj.how_lost = LOST_DROPPED;
    await dropx(obj);
    return 1; /* ECMD_TIME */
}

// ══════════════════════════════════════════════════════════════════════════
// The 'D' (#droptype) command: do.c doddrop() / menu_drop(), and the two
// pickup.c menus it drives.  js/pickup.js's query_category()/query_objlist()
// stop at the point a window would have to be drawn (each caller renders its
// own), so the menu halves live here, next to renderMenuLines().
// ══════════════════════════════════════════════════════════════════════════

/* wintty.c set_item_state():1209 — '+' == all of it, '#' == a counted pick.
   A page's first paint (process_menu_window():1470) shows a preselected item
   with '*' (all) or '#'; toggles are patched in afterwards with '+'/'#'/'-'.
   Items only start out selected when a caller preselects them. */
function menu_sel_char(it) {
    return !it.selected ? '-' : (it.count === -1 ? '+' : '#');
}
/* it._state/_shown remember what the screen holds for an item between paints. */
function menu_note_paint(it) {
    const state = it.selected ? it.count : 'off';
    if (it._state === undefined)
        it._shown = !it.selected ? '-' : (it.count === -1 ? '*' : '#');
    else if (it._state !== state)
        it._shown = menu_sel_char(it);
    it._state = state;
}
/* wintty.c tty_add_menu() — "<selector> <state> <description>". */
function menu_item_line(it) { return `${it.selector} ${it._shown ?? menu_sel_char(it)} ${it.desc}`; }

/* options.c menuitem_invert_test() with the default iflags.menuinvertmode 1:
   a SKIPINVERT entry joins a bulk change only in order to be turned OFF. */
function menuitem_invert_test(_mode, skipinvert, is_selected) {
    if (!skipinvert) return true;
    const mode = game.iflags?.menuinvertmode ?? 1;
    if (mode === 2) return false;
    if (mode === 1) return !!is_selected;
    return true;
}

/* wintty.c process_menu_window():1359 — the selection loop for a menu that
   fits on one page (every menu built here does, so C's page comparisons all
   collapse to "commit" or "no-op").  `plan` is the rendered line list: each
   entry is either { str, attr } for an add_menu_str()/add_menu_heading() line
   or { item } for a selectable one.  Returns the picks in menu order. */
async function tty_select_menu(items, plan, how) {
    /* gacc[]: group accelerators; one equal to its own entry's selector is
       excluded, except GOLD_SYM.  PICK_ONE only takes unambiguous ones. */
    const gacc = new Set();
    if (how !== PICK_NONE) {
        const gcnt = new Map();
        for (const it of items)
            if (it.gselector && it.gselector !== it.selector)
                gcnt.set(it.gselector, (gcnt.get(it.gselector) || 0) + 1);
        for (const it of items)
            if (it.gselector
                && (it.gselector !== it.selector || it.gselector === GOLD_SYM)
                && (how === PICK_ANY || gcnt.get(it.gselector) === 1))
                gacc.add(it.gselector);
    }
    const selectors = new Set(items.map((it) => it.selector));

    /* wintty.c toggle_menu_curr():1138 */
    const toggle_menu_curr = (it, counting, count) => {
        if (it.selected) {
            if (counting && count > 0) it.count = count;
            else { it.selected = false; it.count = -1; }
        } else if (counting && count > 0) {
            it.count = count; it.selected = true;
        } else if (!counting) {
            it.selected = true;
        }
    };
    /* wintty.c invert_all_on_page():1265 — acc 0 means "every entry" */
    const invert_all = (acc, count) => {
        for (const it of items) {
            if (acc ? it.gselector !== acc
                    : !menuitem_invert_test(0, it.skipinvert, it.selected))
                continue;
            if (it.selected) { it.selected = false; it.count = -1; }
            else { it.selected = true; if (count > 0) it.count = count; }
        }
    };
    /* wintty.c set_all_on_page() / unset_all_on_page() */
    const set_all = () => {
        for (const it of items)
            if (!it.selected && menuitem_invert_test(1, it.skipinvert, false))
                it.selected = true;
    };
    const unset_all = () => {
        for (const it of items)
            if (it.selected && menuitem_invert_test(2, it.skipinvert, true)) {
                it.selected = false; it.count = -1;
            }
    };

    /* C ref: wintty.c tty_end_menu():1986 — lmax = min(52, rows-1) entries per
       page (52 = 'a'..'z' + 'A'..'Z'), npages = ceil(nitems / lmax).  nitems
       counts EVERY line in the window (prompt, blank, headings included), and
       auto-assigned selector letters restart at 'a' on each page. */
    const lmax = Math.min(52, (game.nhDisplay?.rows ?? 24) - 1);
    const npages = Math.max(1, Math.ceil(plan.length / lmax));
    {
        let menu_ch = 'a';
        for (let i = 0; i < plan.length; i++) {
            if ((i % lmax) === 0) menu_ch = 'a';
            const it = plan[i].item;
            if (it && !it.selector) {
                it.selector = menu_ch;
                menu_ch = (menu_ch === 'z') ? 'A'
                    : String.fromCharCode(menu_ch.charCodeAt(0) + 1);
            }
        }
    }
    const page_items = (pg) => plan.slice(pg * lmax, pg * lmax + lmax)
        .map((p) => p.item).filter(Boolean);
    /* wintty.c set_all_on_page()/unset_all_on_page(): current page only. */
    const set_page = (list) => {
        for (const it of list)
            if (!it.selected && menuitem_invert_test(1, it.skipinvert, false))
                it.selected = true;
    };
    const unset_page = (list) => {
        for (const it of list)
            if (it.selected && menuitem_invert_test(2, it.skipinvert, true)) {
                it.selected = false; it.count = -1;
            }
    };
    const invert_page = (list, count) => {
        for (const it of list) {
            if (!menuitem_invert_test(0, it.skipinvert, it.selected)) continue;
            if (it.selected) { it.selected = false; it.count = -1; }
            else { it.selected = true; if (count > 0) it.count = count; }
        }
    };

    let counting = false, count = 0, reset_count = true, cancelled = false;
    let curr_page = 0, painted_page = -1;
    let searchBlankTop = false;
    for (;;) {
        if (reset_count) { counting = false; count = 0; } else reset_count = true;
        const onpage = page_items(curr_page);
        if (painted_page !== curr_page) {
            searchBlankTop = false;
            for (const it of onpage) it._state = undefined;
        }
        painted_page = curr_page;
        for (const it of onpage) menu_note_paint(it);
        const selectors = new Set(onpage.map((it) => it.selector));
        const lines = plan.map((p) => (p.item
            ? { text: menu_item_line(p.item), attr: p.item.attr || 0 }
            : { text: p.str, attr: p.attr || 0 }));
        if (npages > 1) renderPagedMenu(lines, curr_page, npages, lmax);
        else renderMenuLines(lines, null);
        if (searchBlankTop) {
            for (let x = 0; x < game.nhDisplay.cols; x++)
                game.nhDisplay.setCell(x, 0, ' ', NO_COLOR, 0);
        }
        // wintty.c:1533-1551: xwaitforspace rejects keys outside resp before
        // the loop can reset a pending numeric count.
        let key, ch;
        do {
            key = await nhgetch();
            ch = String.fromCharCode(key);
        } while (!selectors.has(ch) && !gacc.has(ch)
                 && !" 0123456789\x1b\n\r><^|,.-\\~@:".includes(ch));
        /* an explicit page selector outranks the menu-command mapping */
        const explicit = selectors.has(ch);

        if (!explicit && ch >= '0' && ch <= '9') {
            if (!counting && gacc.has(ch)) { invert_all(ch, -1); continue; }
            count = count * 10 + (key - 48);
            if (count !== 0) { counting = true; reset_count = false; }
            continue;
        }
        if (key === 27) {           /* ESC: cancel, or just stop a count */
            if (counting) continue;
            for (const it of items) { it.selected = false; it.count = -1; }
            cancelled = true;
            break;
        }
        if (key === 13 || key === 10) break;            /* commit */
        /* ' ' advances to the next page and only finishes on the last one. */
        if (!explicit && ch === ' ') {
            if (curr_page !== npages - 1) { curr_page++; continue; }
            break;
        }
        if (!explicit) {
            /* wintype.h default_menu_cmds[]; gm.mapped_menu_cmds is empty
               unless the config rebinds them, so these are the literals. */
            if (ch === '>') {                           /* MENU_NEXT_PAGE */
                if (curr_page !== npages - 1) curr_page++;
                continue;
            }
            if (ch === '<') {                           /* MENU_PREVIOUS_PAGE */
                if (curr_page !== 0) curr_page--;
                continue;
            }
            if (ch === '^') { curr_page = 0; continue; }     /* FIRST_PAGE */
            if (ch === '|') { curr_page = npages - 1; continue; } /* LAST_PAGE */
            if (ch === ',') {                           /* MENU_SELECT_PAGE */
                if (how === PICK_ANY) set_page(onpage);
                continue;
            }
            if (ch === '.') {                           /* MENU_SELECT_ALL */
                if (how === PICK_ANY) { set_page(onpage); set_all(); }
                continue;
            }
            if (ch === '\\') { unset_page(onpage); continue; } /* UNSELECT_PAGE */
            if (ch === '-') { unset_page(onpage); unset_all(); continue; }
            if (ch === '~') {                           /* MENU_INVERT_PAGE */
                if (how === PICK_ANY) invert_page(onpage, -1);
                continue;
            }
            if (ch === '@') {                           /* MENU_INVERT_ALL */
                if (how === PICK_ANY) invert_all(0, -1);
                continue;
            }
            /* wintty.c process_menu_window() case MENU_SEARCH:1700 —
               tty_getlin("Search for:"), then toggle every SELECTABLE entry
               whose menu string matches the "*pattern*" glob; PICK_ONE
               finishes on the first hit and PICK_NONE only rings the bell.
               C matches curr->str, which tty_add_menu() built as
               "<selector> - <description>" (the selection-state character is
               painted over position 2 at display time and is not part of the
               stored string), so match that, not the rendered line.
               Until this existed ':' fell through to the command loop: C
               swallowed ':' and the whole typed pattern inside the menu while
               this port ran them as game commands, desynchronizing the INPUT
               stream for the rest of the session. */
            if (ch === ':') {
                if (how === PICK_NONE) continue;
                const { hooked_tty_getlin, pmatchi }
                    = await import('./extcmd-handlers.js');
                const tmpbuf = await hooked_tty_getlin('Search for:', null);
                // C tty_getlin() erases WIN_MESSAGE without repainting this page.
                searchBlankTop = true;
                if (!tmpbuf || tmpbuf[0] === '\x1b') continue;
                const searchbuf = `*${tmpbuf}*`;
                let one = false;
                for (const it of items) {
                    if (!pmatchi(searchbuf, `${it.selector} - ${it.desc}`)) continue;
                    toggle_menu_curr(it, counting, count);
                    if (how === PICK_ONE) { one = true; break; }
                }
                if (one) break;
                continue;
            }
        }
        if (how === PICK_NONE) continue;
        if (gacc.has(ch)) {
            invert_all(ch, counting ? count : -1);
            if (how === PICK_ONE) break;
            continue;
        }
        /* C ref: wintty.c:1753 — the selector scan walks page_start..page_end,
           so an invlet that only appears on another page is not accepted. */
        const hit = onpage.find((it) => it.selector === ch);
        if (hit) {
            toggle_menu_curr(hit, counting, count);
            if (how === PICK_ONE) break;
        }
        /* anything else: rejected (tty_nhbell), the menu stays up */
    }
    // select_menu() dismisses its tty window before returning to the caller;
    // otherwise later message/map flushes remain blocked by the stale overlay.
    delete game._modal_screen;
    if (cancelled) {
        const none = [];
        none.cancelled = true;
        return none;
    }
    return items.filter((it) => it.selected);
}

/* invent.c nxt_unbypassed_obj() */
function nxt_unbypassed_obj(list) {
    for (const obj of iterateObjects(list))
        if (!obj.bypass) { obj.bypass = 1; return obj; }
    return null;
}

/* flag.h ParanoidAutoAll — flags.paranoia_bits & PARANOID_AUTOALL. */
function ParanoidAutoAll() {
    return /autoall/i.test(String(flags().paranoid_confirmation || ''));
}

/* ── pickup.c:1226 query_category() — the menustyle:Full class-filter menu.
   Returns the picks as { a_int, count }, where a_int is an object class
   NUMBER, ALL_TYPES_SELECTED, or one of 'A'/'u'/'x'/'B'/'C'/'U'/'X'/'P'. */
async function query_category_menu(qstr, olist, qflags, how) {
    const chain = [...iterateObjects(olist, (qflags & BY_NEXTHERE) !== 0)];
    if (!chain.length) return [];

    let ofilter = null;
    let do_unpaid = false, do_usedup = false, do_blessed = false,
        do_cursed = false, do_uncursed = false, do_buc_unknown = false,
        do_worn = false, verify_All = false;
    let num_buc_types = 0, num_justpicked = 0;

    if ((qflags & UNPAID_TYPES) && count_unpaid(chain)) do_unpaid = true;
    if (qflags & BILLED_TYPES) do_usedup = true;
    if (qflags & WORN_TYPES) { do_worn = true; ofilter = is_worn; }
    if ((qflags & BUC_BLESSED_F) && count_buc(chain, BUC_BLESSED, ofilter)) {
        do_blessed = true; num_buc_types++;
    }
    if ((qflags & BUC_CURSED_F) && count_buc(chain, BUC_CURSED, ofilter)) {
        do_cursed = true; num_buc_types++;
    }
    if ((qflags & BUC_UNCURSED_F) && count_buc(chain, BUC_UNCURSED, ofilter)) {
        do_uncursed = true; num_buc_types++;
    }
    if ((qflags & BUC_UNKNOWN_F) && count_buc(chain, BUC_UNKNOWN, ofilter)) {
        do_buc_unknown = true; num_buc_types++;
    }
    if (qflags & JUSTPICKED) num_justpicked = count_justpicked(chain);

    const ccount = count_categories(chain, qflags);
    /* "no point in actually showing a menu for a single category" */
    if (ccount === 1 && !do_unpaid && !do_usedup && num_buc_types <= 1) {
        for (const curr of chain) {
            if (ofilter && !ofilter(curr)) continue;
            return [{ a_int: curr.oclass, count: -1 }];
        }
        return [];
    }

    const pack = classOrder().slice();
    if (qflags & INCLUDE_VENOM) pack.push(VENOM_CLASS);   /* not in inv_order */

    const items = [], plan = [];
    const mkitem = (selector, desc, a_int, opts = {}) => {
        items.push({ selector, desc, a_int, selected: false, count: -1,
                     gselector: opts.gselector || 0,
                     skipinvert: !!opts.skipinvert });
        plan.push({ item: items[items.length - 1] });
    };

    const show_a = !!(qflags & ALL_TYPES) && ccount > 1;
    /* iflags.cmdassist defaults on, so `!ga.A_first_hint++ || cmdassist`
       shows the parenthetical every time, not only on the game's first 'A'. */
    const cmdassist = game.iflags?.cmdassist !== false;
    const gs = giState();

    if (qflags & CHOOSE_ALL) {
        mkitem('A', do_worn ? 'Auto-select every item being worn or wielded'
                            : 'Auto-select every relevant item',
               'A', { skipinvert: true });
        verify_All = (how === PICK_ANY) && ParanoidAutoAll();
        if (!verify_All) {
            const firstA = (gs.A_first_hint = (gs.A_first_hint || 0) + 1) === 1;
            if (firstA || cmdassist)
                plan.push({ str: '    (ignored unless some other choices are also picked)' });
        } else if (show_a) {
            const firstA2 = (gs.A_second_hint = (gs.A_second_hint || 0) + 1) === 1;
            if (firstA2 || cmdassist)
                plan.push({ str: "    (if no other choices are picked, 'a' is implied)" });
        }
        plan.push({ str: '' });                          /* blank separator */
    }

    let invlet = 'a';
    if (show_a) {
        mkitem(invlet, do_worn ? 'All worn and wielded types' : 'All types',
               ALL_TYPES_SELECTED, { skipinvert: true });
        invlet = String.fromCharCode(invlet.charCodeAt(0) + 1);
    }
    const with_oc_sym = (how !== PICK_NONE) && !!game.iflags?.menu_head_objsym;
    for (const oclass of pack) {
        let collected_type_name = false;
        for (const curr of chain) {
            if (curr.oclass !== oclass) continue;
            if (ofilter && !ofilter(curr)) continue;
            if (collected_type_name) continue;
            mkitem(invlet, let_to_name(oclass, false, with_oc_sym), oclass,
                   { gselector: def_oc_syms[oclass]?.sym });
            invlet = String.fromCharCode(invlet.charCodeAt(0) + 1);
            collected_type_name = true;
        }
        if (invlet >= 'u') return [];      /* C: impossible("too many"), n = 0 */
    }

    if (do_unpaid || do_usedup || do_blessed || do_cursed || do_uncursed
        || do_buc_unknown || num_justpicked)
        plan.push({ str: '' });
    if (do_unpaid) mkitem('u', 'Unpaid items', 'u', { skipinvert: true });
    if (do_usedup) mkitem('x', 'Unpaid items already used up', 'x', { skipinvert: true });
    /* this cluster is alphabetical, reversing the usual 'U'/'C' of BUCX */
    if (do_blessed) mkitem('B', 'Items known to be Blessed', 'B', { skipinvert: true });
    if (do_cursed) mkitem('C', 'Items known to be Cursed', 'C', { skipinvert: true });
    if (do_uncursed) mkitem('U', 'Items known to be Uncursed', 'U', { skipinvert: true });
    if (do_buc_unknown) mkitem('X', 'Items of unknown Bless/Curse status', 'X', { skipinvert: true });
    if (num_justpicked)
        mkitem('P', num_justpicked === 1
                    ? `Just picked up: ${doname(find_justpicked(chain))}`
                    : 'Items you just picked up', 'P', { skipinvert: true });

    /* end_menu(win, qstr): the query heads the window, then a blank line */
    plan.unshift({ str: qstr, attr: menuHeadAttr() }, { str: '' });

    let picked = await tty_select_menu(items, plan, how);

    if (picked.length && verify_All && picked.some((it) => it.a_int === 'A')) {
        /* paranoid_ynq()'s spelled-out "yes"/"no" variant is not modelled. */
        const i = picked.findIndex((it) => it.a_int === 'A');
        const ans = await y_n('Really autoselect All?', 'ynq\x1b', 'q');
        if (ans === 'n' && picked.length > 1) picked.splice(i, 1);
        else if (ans === 'n' && (qflags & ALL_TYPES)) picked[0].a_int = ALL_TYPES_SELECTED;
        else if (ans !== 'y') picked = [];
    } else if (picked.length === 1 && !verify_All && picked[0].a_int === 'A') {
        /* without paranoid_confirm:A, 'A' by itself is rejected */
        picked = [];
        /* C plines this and only then destroys the window; a corner window's
           teardown never touches the topline, so dismiss first here. */
        await dismiss_invent_screen();
        await pline('No relevant items selected.');
    }
    return picked.map((it) => ({ a_int: it.a_int, count: it.count }));
}

/* ── pickup.c:1025 query_objlist() — the item menu.  Returns the picks as
   { obj, count }; js/pickup.js's copy delegates its menu to invent.js's
   floor-pickup renderer, which has neither invlet accelerators nor the
   computed window offset this one needs. */
async function query_objlist_menu(qstr, olist, qflags, how, allow) {
    const by_nexthere = (qflags & BY_NEXTHERE) !== 0;
    const chain = [...iterateObjects(olist, by_nexthere)];
    if (!chain.length) return [];

    let n = 0, last = null;
    for (const curr of chain) if (allow(curr)) { last = curr; n++; }
    if (n === 0) return [];
    if (n === 1 && (qflags & AUTOSELECT_SINGLE))
        return [{ obj: last, count: last.quan }];

    const sorted = (qflags & INVORDER_SORT) !== 0;
    const sortflags =
        (((flags().sortloot === 'f'
           || (flags().sortloot === 'l' && !(qflags & USE_INVLET)))
            ? SORTLOOT_LOOT
            : ((qflags & USE_INVLET) ? SORTLOOT_INVLET : 0))
         | (flags().sortpack !== false ? SORTLOOT_PACK : 0));
    const sortedolist = sortloot(chain, sortflags, by_nexthere, allow)
        .map((sli) => sli.obj).filter(Boolean);

    const pack = classOrder().slice();
    if (qflags & INCLUDE_VENOM) pack.push(VENOM_CLASS);

    const items = [], plan = [];
    const with_oc_sym = (how !== PICK_NONE) && !!game.iflags?.menu_head_objsym;
    let first = true;
    for (const oclass of (sorted ? pack : [null])) {
        let printed_type_name = false;
        for (const curr of sortedolist) {
            if (sorted && curr.oclass !== oclass) continue;
            if (!allow(curr)) continue;
            if (sorted && !printed_type_name) {
                plan.push({ str: let_to_name(curr.oclass, false, with_oc_sym),
                            attr: menuHeadAttr() });
                printed_type_name = true;
            }
            // C ref: pickup.c:1131 query_objlist() — `tmpglyph =
            // obj_to_glyph(curr, rn2_on_display_rng)` for every listed item.
            // tty never renders the menu glyph, but while hallucinating it
            // advances the display RNG (random_obj_to_glyph).
            obj_to_glyph(curr);
            // C ref: pickup.c query_objlist() add_menu(... (qflags & USE_INVLET)
            // ? curr->invlet : (first && COIN_CLASS) ? '$' : 0 ...) — a 0 here
            // means "let tty_end_menu() assign a letter", which it does PER
            // PAGE starting from 'a' (see tty_select_menu).
            const selector = (qflags & USE_INVLET) ? curr.invlet
                : ((first && curr.oclass === COIN_CLASS) ? GOLD_SYM : null);
            items.push({ selector, desc: doname_with_price(curr), obj: curr,
                         selected: false, count: -1,
                         gselector: def_oc_syms[curr.oclass]?.sym,
                         skipinvert: false });
            plan.push({ item: items[items.length - 1] });
            first = false;
        }
    }
    /* C: dotypeinv() supplies gt.this_title as an initial add_menu_str(),
       deliberately without the menu_headings highlight attribute. */
    if (game.this_title) plan.unshift({ str: game.this_title });
    /* end_menu(win, qstr) skips the prompt line entirely when qstr is NULL */
    if (qstr) plan.unshift({ str: qstr, attr: menuHeadAttr() }, { str: '' });
    const picked = await tty_select_menu(items, plan, how);

    const result = picked.map((it) => ({
        obj: it.obj,
        count: (it.count === -1 || it.count > it.obj.quan) ? it.obj.quan : it.count,
    }));
    result.cancelled = !!picked.cancelled;
    return result;
}

/* do.c:963 menudrop_split() */
async function menudrop_split(otmp, cnt) {
    let obj = otmp;
    if (cnt && cnt < obj.quan) {
        if (welded(obj)) {
            /* don't split */
        } else if (obj.otyp === LOADSTONE && obj.cursed) {
            obj.corpsenm = cnt;              /* same kludge as getobj() */
        } else {
            obj = splitobj(obj, cnt);
        }
    }
    return await drop(obj);
}

/* do.c:981 menu_drop() — drop things from inventory, using a menu. */
async function menu_drop(retry) {
    let n_dropped = 0;
    let all_categories = true, drop_everything = false, autopick = false;
    let drop_justpicked = false, justpicked_quan = 0;

    if (retry) {
        all_categories = (retry === -2);
    } else if (menu_style() === MENU_FULL) {
        all_categories = false;
        const picks = await query_category_menu('Drop what type of items?',
            inventoryArray(),
            UNPAID_TYPES | ALL_TYPES | CHOOSE_ALL | BUC_BLESSED_F | BUC_CURSED_F
            | BUC_UNCURSED_F | BUC_UNKNOWN_F | JUSTPICKED | INCLUDE_VENOM,
            PICK_ANY);
        /* no non-autopick category filters specified */
        if (!picks.length) return ECMD_OK;
        for (const p of picks) {
            if (p.a_int === ALL_TYPES_SELECTED) {
                all_categories = true;
            } else if (p.a_int === 'A') {
                drop_everything = autopick = true;
            } else if (p.a_int === 'P') {
                justpicked_quan = Math.max(0, p.count);
                drop_justpicked = true;
                drop_everything = false;
                add_valid_menu_class(p.a_int);
            } else {
                /* this port's valid_menu_classes[] holds class SYMBOLS, not
                   C's class numbers (js/pickup.js allow_category()). */
                add_valid_menu_class(typeof p.a_int === 'number'
                    ? def_oc_syms[p.a_int]?.sym : p.a_int);
                drop_everything = false;
            }
        }
    } else if (menu_style() === MENU_COMBINATION) {
        /* C gathers the classes with ggetobj("drop", drop, 0, TRUE, &res) and
           returns early when it finished the job itself; ggetobj()/askchain()
           are still stubs here, so only the class filter is skipped. */
        all_categories = false;
        ggetobj('drop', drop, 0, true, null);
    }

    /* C destroys the category window before dropping anything or opening the
       item menu; the drop messages have to land on the restored map. */
    await dismiss_invent_screen();

    if (autopick) {
        /* the bypass bit marks items already processed, so a drop that
           destroys inventory (a burning oil potion) can't walk a freed chain */
        bypass_objlist(inventoryArray(), false);
        let otmp;
        while ((otmp = nxt_unbypassed_obj(inventoryArray())) != null) {
            if (drop_everything || all_categories || allow_category(otmp))
                n_dropped += (((await drop(otmp)) & ECMD_TIME) !== 0) ? 1 : 0;
        }
        bypass_objlist(inventoryArray(), false);
    } else if (drop_justpicked && count_justpicked(inventoryArray()) === 1) {
        /* drop the just picked item automatically, if only one stack */
        const otmp = find_justpicked(inventoryArray());
        if (otmp)
            n_dropped += (((await menudrop_split(otmp, justpicked_quan))
                           & ECMD_TIME) !== 0) ? 1 : 0;
    } else {
        const picks = await query_objlist_menu('What would you like to drop?',
            inventoryArray(), USE_INVLET | INVORDER_SORT | INCLUDE_VENOM,
            PICK_ANY, all_categories ? allow_all : allow_category);
        if (picks.length) {
            /* C sets bypass on all of invent and re-verifies every pick,
               because dropping one item can free/reuse another's slot */
            bypass_objlist(inventoryArray(), true);
            await dismiss_invent_screen();
            for (const p of picks) {
                if (!inventoryArray().includes(p.obj) || !p.obj.bypass) continue;
                n_dropped += (((await menudrop_split(p.obj, p.count))
                               & ECMD_TIME) !== 0) ? 1 : 0;
            }
            bypass_objlist(inventoryArray(), false);
        }
    }
    return n_dropped ? ECMD_TIME : ECMD_OK;
}

/* do.c:924 doddrop() — the #droptype ('D') command: drop several things. */
export async function doddrop() {
    let result = ECMD_OK;

    if (!inventoryArray().length) {
        await pline('You have nothing to drop.');
        return ECMD_OK;
    }
    add_valid_menu_class(0);            /* clear any classes already there */
    // C ref: do.c doddrop():933 — same deliberate-drop-in-shop prompt gate as
    // dodrop(); see that function's comment.
    const inShop = (game.u?.ushops || []).length > 0;
    if (inShop) (await import('./shk.js')).sellobj_state(SELL_DELIBERATE);
    if (menu_style() !== MENU_TRADITIONAL
        || (result = ggetobj('drop', drop, 0, false, null)) < -1)
        result = await menu_drop(result);
    if (inShop) (await import('./shk.js')).sellobj_state(SELL_NORMAL);
    /* a menu left up (ESC'd, or nothing picked) is a corner window still on
       screen; C's destroy_nhwindow() restores the map under it */
    await dismiss_invent_screen();
    if (result) reset_occupations();
    return result;
}

/* allmain.c reset_occupations() — reset_pick()/reset_trapset()/
   reset_engraving() have no state in this port; reset_remarm() does. */
function reset_occupations() { reset_remarm(); }

// C ref: shk.c menu_pick_pay_items(ibillct, ibill):1668 — the "Pay for which
// items?" PICK_ANY menu.  The rendered text is what the recorded screens show:
// one line per augmented-bill entry, "<amt> Zm, <paydoname>" with the amount
// right-aligned to the widest amount on the bill, under an optional "Used up
// item(s):"/"Unpaid item(s):" heading.  Marks ibill[i].queuedpay for each pick
// and returns how many were picked (0 for ESC, matching C's max(n, 0)).
//
// This menu is NOT cosmetic: while it is up, its keystrokes belong to it.  A
// missing menu let 'y'/'W'/<return> fall through to rhack() and run phantom
// wear/apply commands (the 242-screen seed0002 wall).
async function menu_pick_pay_items(ibill) {
    const { paydoname, PartlyUsedUp, PartlyIntact } = await import('./shk.js');
    const ibillct = ibill.length;

    let largest_amt = 0;
    for (const b of ibill) if (b.cost > largest_amt) largest_amt = b.cost;
    const amt_width = String(largest_amt).length;

    // C ref: windows.c add_menu_heading() — ATR_INVERSE unless the game is over.
    const headAttr = game.program_state?.gameover ? 0 : (menuHeadAttr());
    // end_menu(win, "Pay for which items?") prepends the prompt + a blank line.
    const flat = [{ text: 'Pay for which items?', attr: menuHeadAttr() },
                  { text: '', attr: 0 }];
    const entries = new Map();          // accelerator -> ibill index
    let li = 0;
    const nextLetter = () => (li < 26 ? String.fromCharCode(97 + li++)
        : String.fromCharCode(65 + (li++ - 26)));

    // The "Used up items" heading shows whenever the (already sorted) bill
    // leads with a used-up entry, no matter what follows it.
    if (ibill[0].usedup <= PartlyUsedUp)
        flat.push({ text: `Used up item${
            (ibillct > 1 && ibill[1].usedup <= PartlyUsedUp) ? 's' : ''}:`, attr: headAttr });
    for (let i = 0; i < ibillct; ++i) {
        if (i > 0 && ibill[i - 1].usedup <= PartlyUsedUp
            && ibill[i].usedup >= PartlyIntact)
            flat.push({ text: `Unpaid item${(i < ibillct - 1) ? 's' : ''}:`, attr: headAttr });
        const otmp = ibill[i].obj;
        const save_quan = otmp.quan;
        otmp.quan = ibill[i].quan;      /* in case it's partly used */
        const p = await paydoname(otmp);
        otmp.quan = save_quan;
        const letter = nextLetter();
        entries.set(letter, i);
        // C: Snprintf(buf, "%*ld Zm, %s", amt_width, amt, p) — "Zm" is literal
        // (the shk isn't hallucinating, so currency() would spoil the column
        // alignment).
        flat.push({ text: `${String(ibill[i].cost).padStart(amt_width, ' ')} Zm, ${p}`,
                    attr: 0, letter });
    }

    // C ref: wintty.c tty_display_nhwindow() NHW_MENU — a pending topline is
    // acknowledged with --More-- before the menu window is drawn.
    if (game._pending_message) {
        await topl_more();
        game._pending_message = '';
        game._toplin = 0;
        game._toplinSoft = null;
    }

    const selected = new Set();
    const draw = () => {
        const lines = flat.map((ln) => (ln.letter
            ? { text: `${ln.letter} ${selected.has(ln.letter) ? '+' : '-'} ${ln.text}`, attr: ln.attr }
            : ln));
        renderMenuLines(lines, null);
        game._modal_screen = 'paymenu';
    };

    let confirmed = false;
    for (;;) {
        draw();
        const c = await nhgetch();
        const ch = String.fromCharCode(c);
        if (c === 27) { selected.clear(); confirmed = false; break; }  // ESC
        if (c === 13 || c === 10 || c === 32) { confirmed = true; break; }
        if (entries.has(ch)) {
            if (selected.has(ch)) selected.delete(ch); else selected.add(ch);
            continue;
        }
        // C ref: wintty.c MENU_SELECT_ALL '.' / MENU_UNSELECT_ALL '-' /
        // MENU_INVERT_ALL '@' on the (single) page.
        if (ch === '.') { for (const k of entries.keys()) selected.add(k); continue; }
        if (ch === '-') { selected.clear(); continue; }
        if (ch === '@') {
            for (const k of entries.keys())
                if (selected.has(k)) selected.delete(k); else selected.add(k);
            continue;
        }
        /* any other key: ignored, menu stays up */
    }
    delete game._modal_screen;
    if (!confirmed) return 0;
    for (const k of selected) ibill[entries.get(k)].queuedpay = true;
    return selected.size;
}

// C ref: shk.c buy_container(shkp, indx, ibillct, ibill):2306 — pay for the
// unpaid contents of a container (and the container itself if unpaid) without
// itemizing.  Returns 0 == bought, 1 == rejected with a message already given,
// 2 == rejected, caller gives a generic message.
async function buy_container(shkp, indx, ibillct, ibill) {
    const shk = await import('./shk.js');
    const eshkp = shkp.eshk;
    const ebillct = eshkp.billct || 0;
    const container = ibill[indx].obj;
    const unpaidcontainer = container.unpaid;
    const totalcost = ibill[indx].cost;
    const sightunseen = ibill[indx].usedup === shk.UndisclosedContainer
                        || ibill[indx].usedup === shk.KnownContainer;
    const boids = [];
    let buycount = 0;

    if (await shk.insufficient_funds(shkp, container, 0)
        || await shk.insufficient_funds(shkp, container, totalcost))
        return 1;

    for (let i = 0; i < ebillct; ++i) {
        const bp = eshkp.bill[i];
        const otmp = shk.bp_to_obj(bp);
        if (!otmp) return 2;
        if (otmp.where !== OBJ_CONTAINED && !Has_contents(otmp)) continue;
        let otop = otmp;
        for (let guard = 0; otop.where === OBJ_CONTAINED && guard < 32; guard++) {
            const next = otop.ocontainer || container_of(otop);
            if (!next) break;
            otop = next;
        }
        if (otop !== container) continue;
        if (otmp.quan < bp.bquan) {
            // reject_purchase(): the intact portion can't be sold yet.
            await shk.dopayobj(shkp, bp, otmp, 1, false, true);
            return 1;
        }
        if (bp.bo_id !== container.o_id) boids.push(bp.bo_id);
    }
    if (unpaidcontainer) boids.push(container.o_id);

    for (const boid of boids) {
        let i = 0, bp = null;
        for (; i < ebillct; ++i) { bp = eshkp.bill[i]; if (bp.bo_id === boid) break; }
        if (i === ebillct) return 2;
        const otmp = shk.bp_to_obj(bp);
        const buy = await shk.dopayobj(shkp, bp, otmp, 1, false, sightunseen);
        if (buy !== shk.PAY_BUY) continue;
        ibill[indx].cost -= bp.price * bp.bquan;
        shk.update_bill((boid === container.o_id) ? indx : -1,
                        ibillct, ibill, eshkp, bp, otmp);
        ++buycount;
    }
    if (buycount && sightunseen) {
        // paydoname() would say "your <container>" now that the hero owns it;
        // C fakes the pre-purchase state to get "a <container> and its
        // contents" instead.
        if (unpaidcontainer) { container.unpaid = 1; container.no_charge = 1; }
        await shk.shk_names_obj(shkp, container, 'bought %s for %ld gold piece%s.%s',
                                totalcost, '');
        container.unpaid = 0; container.no_charge = 0;
    }
    return buycount ? 0 : 2;
}

// Find the container holding obj (this port's add_to_container() does not set
// obj.ocontainer, so the link has to be searched for).
function container_of(obj) {
    const scan = (list, depth) => {
        if (depth > 8) return null;
        for (const o of (list || [])) {
            if (!o?.cobj) continue;
            if (o.cobj.includes(obj)) return o;
            const r = scan(o.cobj, depth + 1);
            if (r) return r;
        }
        return null;
    };
    return scan(inventoryArray(), 0) || scan(game.level?.objects, 0) || null;
}

// C ref: shk.c pay_billed_items(shkp, ibillct, ibill, stashed_gold, paid_p):2043
// — choose the payment method (menu for every menustyle but Traditional) and
// then buy the picked items one at a time for as long as the money lasts.
// Returns false when the caller must skip the thank-you message.
async function pay_billed_items(shkp, ibill, stashed_gold, paidRef) {
    const shk = await import('./shk.js');
    const eshkp = shkp.eshk;
    const ibillct = ibill.length;

    const umoney = shk.money_cnt_invent();
    if (!umoney && !eshkp.credit) {
        await update_topl(`You ${stashed_gold ? 'seem to ' : ''}have no gold or credit${
            paidRef.paid ? ' left' : ''}.`);
        return true;
    }
    let bp = eshkp.bill[0];
    let otmp = shk.bp_to_obj(bp);
    const ebillct = eshkp.billct;
    const more_than_one = (ebillct > 1 || (otmp && otmp.quan < bp.bquan)
                           || ibill[0].usedup === shk.UndisclosedContainer);
    if ((umoney + (eshkp.credit || 0)) < shk.cheapest_item(ibillct, ibill)) {
        await update_topl(`You don't have enough gold to buy${
            more_than_one ? ' any of' : ''} the item${more_than_one ? 's' : ''} ${
            (ebillct > 1) ? "you've picked" : 'on your bill'}.`);
        if (stashed_gold) await update_topl('Maybe you have some gold stashed away?');
        return true;
    }

    // flags.menu_style defaults to MENU_FULL, so via_menu starts TRUE; the 'm'
    // prefix (iflags.menu_requested) inverts it, which for a non-Traditional
    // style is the only way to reach the item-by-item ynq prompts.
    let via_menu = !game.flags?.menu_traditional;
    if (game.iflags?.menu_requested) via_menu = !via_menu;
    let itemize = false, queuedpay = false;
    do {
        if (via_menu) {
            if (!await menu_pick_pay_items(ibill)) return true;
            queuedpay = true;
            itemize = false;
            via_menu = false;               /* reset so that we don't loop */
        } else {
            const iprompt = !more_than_one ? 'y'
                : await y_n('Itemized billing?', 'ynq m\x1b', 'q');
            if (iprompt === 'q') return true;
            itemize = (iprompt === 'y');
            via_menu = (iprompt === 'm');
        }
    } while (via_menu);

    // ibill[] holds every used-up entry before every unpaid one, so this single
    // pass replaces C 5.0's two passes over eshkp->bill_p[].
    for (let indx = 0; indx < ibillct; ++indx) {
        if (queuedpay && !ibill[indx].queuedpay) continue;

        otmp = ibill[indx].obj;
        let buy;
        if (ibill[indx].usedup >= shk.KnownContainer) {
            const boxbag_result = await buy_container(shkp, indx, ibillct, ibill);
            if (boxbag_result === 0) {
                buy = shk.PAY_BUY;
            } else {
                if (boxbag_result === 2)
                    await shk.verbalize(`You need to remove any unpaid items from that ${
                        xname(otmp)} and buy them separately.`);
                buy = shk.PAY_CANT;
            }
        } else {
            const bidx = ibill[indx].bidx;
            bp = eshkp.bill[bidx];
            const pass = (ibill[indx].usedup <= shk.PartlyUsedUp) ? 0 : 1;
            buy = await shk.dopayobj(shkp, bp, otmp, pass, itemize, false);
            if (buy === shk.PAY_BUY)
                shk.update_bill(indx, ibillct, ibill, eshkp, bp, otmp);
        }
        if (buy === shk.PAY_CANT) return false;
        if (buy === shk.PAY_BROKE) { paidRef.paid = true; return true; }
        if (buy === shk.PAY_SKIP) continue;
        if (buy === shk.PAY_BUY) {
            paidRef.paid = true;
            if (itemize || queuedpay) { update_inventory(); await bot(); }
        }
    }
    return true;
}

// C ref: shk.c dopay():1743 — the 'p' command.  Finds the shopkeeper to pay,
// settles any robbery debt / use-of-merchandise debit, then runs the itemized
// bill through pay_billed_items().  ECMD_TIME only when something was paid.
export async function dopay() {
    const shk = await import('./shk.js');
    const { m_next2u } = await import('./monmove.js');
    const { canspotmon } = await import('./uhitm.js');
    const { Blind } = await import('./vision.js');
    const u = ustate();
    game.multi = 0;

    // How many shk's there are, how many are in sight, and whether the hero is
    // in a shop room with one.
    let sk = 0, seensk = 0, nexttosk = 0;
    let nxtm = null, resident = null;
    for (const s of shk.shk_scan(false)) {
        sk++;
        if (m_next2u(s)) {
            /* next to an irate shopkeeper? prioritize that */
            if (nxtm && shk.ANGRY(nxtm)) continue;
            nexttosk++;
            nxtm = s;
        }
        if (canspotmon(s)) seensk++;
        if (shk.inhishop(s) && u.ushops?.[0] === s.eshk.shoproom) resident = s;
    }

    const blind = Blind();
    const blind_telepat = !!(u.uprops?.Telepat?.intrinsic || u.uprops?.Telepat?.extrinsic);
    let shkp = null;
    if (nxtm && nexttosk === 1) {
        shkp = nxtm;
    } else if ((!sk && (!blind || blind_telepat)) || (!blind && !seensk)) {
        await pline('There appears to be no shopkeeper here to receive your payment.');
        return ECMD_OK;
    } else if (!seensk) {
        await update_topl("You can't see...");
        return ECMD_OK;
    } else if (sk === 1 && resident) {
        /* allow paying at a distance when inside a tended shop */
        shkp = resident;
    } else if (seensk === 1) {
        for (const s of shk.shk_scan(false)) if (canspotmon(s)) { shkp = s; break; }
        if (shkp !== resident && !m_next2u(shkp)) {
            await update_topl(`${shk.Shknam(shkp)} is not near enough to receive your payment.`);
            return ECMD_OK;
        }
    } else {
        // C ref: shk.c:1810 — "Pay whom?" + getpos().  Not ported: no covered
        // session has two spotted shopkeepers with neither adjacent, and a
        // wrong getpos() here would eat the following keystrokes.
        return ECMD_OK;
    }
    if (!shkp) return ECMD_OK;

    const eshkp = shkp.eshk;
    const ltmp = eshkp.robbed || 0;
    const stashed_gold = shk.hidden_gold(true) > 0;
    const paidRef = { paid: false };

    /* wake sleeping shk when someone who owes money offers payment */
    if (ltmp || eshkp.billct || eshkp.debit) await shk.rouse_shk(shkp, true);
    if (shk.helpless(shkp)) {
        await shk.shk_napping_msg(shkp);
        return ECMD_OK;
    }

    if (shkp !== resident && !shk.ANGRY(shkp)) {
        await shk.pay_robbed_debt(shkp, ltmp, stashed_gold);
        return ECMD_TIME;
    }

    /* ltmp is still eshkp->robbed here */
    if (!eshkp.billct && !eshkp.debit) {
        const umoney = shk.money_cnt_invent();
        if (!ltmp && !shk.ANGRY(shkp)) {
            await update_topl(`You do not owe ${shkname(shkp)} anything.`);
            if (!umoney) await update_topl(shk.no_money(stashed_gold));
        } else if (ltmp) {
            await update_topl(`${shkname(shkp)} is after blood, not gold!`);
            if (umoney < ltmp / 2 || (umoney < ltmp && stashed_gold)) {
                await update_topl(!umoney ? shk.no_money(stashed_gold)
                                          : shk.not_enough_money(shkp));
                return ECMD_TIME;
            }
            await update_topl(`But since ${shk.noit_mhis(shkp)} shop has been robbed recently,`);
            await update_topl(`you ${umoney < ltmp ? 'partially ' : ''}compensate ${
                shkname(shkp)} for ${shk.noit_mhis(shkp)} losses.`);
            await shk.pay(umoney < ltmp ? umoney : ltmp, shkp);
            await shk.make_happy_shk(shkp, false);
        } else {
            /* angry but not robbed — door broken, attacked, etc. */
            await update_topl(`${shk.Shknam(shkp)} is after your hide, not your gold!`);
            if (umoney < 1000) {
                await update_topl(!umoney ? shk.no_money(stashed_gold)
                                          : shk.not_enough_money(shkp));
                return ECMD_TIME;
            }
            await update_topl(`You try to appease ${
                canspotmon(shkp) ? `the angry ${shkname(shkp)}` : shkname(shkp)
            } by giving ${shk.noit_mhim(shkp)} 1000 gold pieces.`);
            await shk.pay(1000, shkp);
            if (eshkp.customer !== game.plname || rn2(3))
                await shk.make_happy_shk(shkp, false);
            else
                await update_topl(`But ${shkname(shkp)} is as angry as ever.`);
        }
        return ECMD_TIME;
    }
    if (shkp !== resident) return ECMD_OK; /* C: impossible("not to shopkeeper?") */

    /* pay debt, if any, first */
    if (eshkp.debit) {
        let dtmp = eshkp.debit;
        const loan = eshkp.loan || 0;
        const umoney = shk.money_cnt_invent();
        let sbuf = `You owe ${shkname(shkp)} ${dtmp} ${currency(dtmp)} `;
        if (loan)
            sbuf += (loan === dtmp) ? 'you picked up in the store.'
                : 'for gold picked up and the use of merchandise.';
        else
            sbuf += 'for the use of merchandise.';
        await update_topl(sbuf);
        if (umoney + (eshkp.credit || 0) < dtmp) {
            await update_topl(`But you don't${stashed_gold ? ' seem to' : ''
                } have enough gold${eshkp.credit ? ' or credit' : ''}.`);
            return ECMD_TIME;
        }
        if ((eshkp.credit || 0) >= dtmp) {
            eshkp.credit -= dtmp;
            eshkp.debit = 0;
            eshkp.loan = 0;
            await update_topl('Your debt is covered by your credit.');
        } else if (!eshkp.credit) {
            await shk.money2mon(shkp, dtmp);
            eshkp.debit = 0;
            eshkp.loan = 0;
            await update_topl('You pay that debt.');
        } else {
            dtmp -= eshkp.credit;
            eshkp.credit = 0;
            await shk.money2mon(shkp, dtmp);
            eshkp.debit = 0;
            eshkp.loan = 0;
            await update_topl('That debt is partially offset by your credit.');
            await update_topl('You pay the remainder.');
        }
        paidRef.paid = true;
    }

    /* now check items on bill */
    let pay_done = true;
    if (eshkp.billct) {
        const ibill = shk.make_itemized_bill(shkp);
        if (ibill.length
            && !await pay_billed_items(shkp, ibill, stashed_gold, paidRef))
            pay_done = false;               /* skip thank you message */
    }

    if (pay_done && !shk.ANGRY(shkp) && paidRef.paid) await shk.shk_thank_you(shkp);

    if (paidRef.paid) update_inventory();
    if (game.iflags) game.iflags.menu_requested = false;
    return paidRef.paid ? ECMD_TIME : ECMD_OK;
}

// C ref: do.c dropz(obj, with_impact):807 — the real floor-placement
// primitive every drop path in this port should reach: unwield/unquiver/
// unswap the object, flooreffects() (water/lava/pit/altar/hot-ground), the
// shop-sell dispatch, stackobj() and encumber_msg().  x/y are always the
// hero's current position (every caller passes u.ux/u.uy), mirroring C's
// implicit use of the globals.
async function dropz(obj, x, y, with_impact = false) {
    if (obj === game.uwep) setuwep_slot(null);
    if (obj === game.uquiver) setuqwep(null);
    if (obj === game.uswapwep) setuswapwep(null);

    const u = ustate();
    if (u.uswallow) {
        if (obj !== game.uball) {
            const SK = await import('./shk.js');
            if (SK.is_unpaid(obj)) await SK.stolen_value(obj, u.ux, u.uy, true, false);
            const DOm = await import('./do.js');
            if (!(await DOm.engulfer_digests_food(obj))) {
                const ST = await import('./steal.js');
                ST.mpickobj(u.ustuck, obj);
            }
        }
    } else {
        const DOm = await import('./do.js');
        if (await DOm.flooreffects(obj, x, y, 'drop')) return;
        mkobj_place_object(obj, x, y);
        if (with_impact) {
            const { container_impact_dmg } = await import('./dokick.js');
            await container_impact_dmg(obj, x, y);
        }
        const { impact_disturbs_zombies } = await import('./monmove.js');
        impact_disturbs_zombies(obj, with_impact);
        if (obj === game.uball) {
            const { drop_ball } = await import('./ball.js');
            await drop_ball(x, y);
        } else if (game.level?.flags?.has_shop) {
            const SK = await import('./shk.js');
            await SK.sellobj(obj, x, y);
        }
        stackobj(obj);
        // C ref: do.c:838-839 — dropping reveals its location even from above.
        if (Blind_for_wear()
            && (u.uprops?.Levitation || worn_extrinsic(LEVITATION))
            && !(u.uprops?.BLevitation || worn_blocked(LEVITATION)))
            map_object(obj, 0);
        newsym(x, y);
    }
    await encumber_msg();
}

// C ref: wield.c:1061 weldmsg(obj) — "Your <obj> is welded to your hand!"
// (plural hands for a two-hander); owornmask is cleared around the name so
// no "(weapon in hand)" suffix leaks in.
async function weldmsg(obj) {
    let hand = body_part(6 /* HAND */);
    if (bimanual(obj)) hand = makeplural(hand);
    const savewornmask = obj.owornmask;
    obj.owornmask = 0;
    const yn = yobjnam_c(obj, 'are');
    await pline(`${yn.charAt(0).toUpperCase()}${yn.slice(1)} welded to your ${hand}!`);
    obj.owornmask = savewornmask;
}
const LOST_DROPPED = 2;      /* obj.h:483 (3 is LOST_STOLEN) */

// C ref: mkobj.c obj_extract_self() — unlink a floor object from the level's
// object list (svl.level.objects[ox][oy] nexthere chain + the global fobj
// chain).  Our floor store is the flat game.level.objects array, so removing
// the object from it (and clearing its floor coords) is the faithful effect.
// This is what stops the pet's dog_goal fobj scan from re-rolling obj_resists
// for an item the hero has just picked up.
function floor_extract_self(obj) {
    if (!obj) return;
    const arr = game.level?.objects;
    if (Array.isArray(arr)) {
        const ix = arr.indexOf(obj);
        if (ix >= 0) arr.splice(ix, 1);
    }
    obj.where = OBJ_FREE;
}

// C ref: pickup.c pick_obj() + pickup_prinv() — the tail of pickup_object():
// detach the object from the floor, bill it, add it to inventory (assigning an
// invlet), and announce it via prinv ("<letter> - <doname>.").  The lift/weight
// and corpse/scare-scroll checks that precede this in C live in js/pickup.js's
// pickup_object(), which is this function's only faithful caller.
export async function pick_one_obj(obj, count = 0) {
    const quan = count || obj.quan || 1;
    if (!Blind_for_wear()) observe_object(obj); // C pickup.c:1817 guards with !Blind
    // C ref: pickup.c pick_obj():1907 — a shop-floor item is billed BEFORE
    // addinv(), so the merge that addinv() may do can see obj->unpaid.  This is
    // where the "For you, ...; only N zorkmids for this <item>." quote (and its
    // rn2(4)) comes from, and what makes doname() read "(unpaid, N zorkmids)".
    const robshop = costly_spot(obj.ox, obj.oy);
    floor_extract_self(obj);
    if (robshop) await addtobill(obj, true, false, false);
    const held = addinv(obj);
    const deciphered = !!game._addinv_plines?.length;
    await flush_artitouch();
    // C ref: pickup.c pickup_prinv(held, count, "lifting") — only announce an
    // encumbrance-level change since the last check this pickup() call (reset
    // to 0 by pickup() before lifting anything).
    const liftPrefix = pickup_prinv_prefix('lifting');
    // C ref: pickup.c:1881 — a pickup that merged into the wielded stack is
    // announced without "(wielded)" (objnam.c:1561 gm.mrg_to_wielded).
    if (!game.gm) game.gm = {};
    if (game.uwep && game.uwep === held) game.gm.mrg_to_wielded = true;
    try {
    if (deciphered || game._merge_discovery_pending || (robshop && obj.unpaid)) {
        await report_merge_discovery();
    }
    // C ref: pickup.c:1883/invent.c prinv() — announce each object with
    // pline before attempting the next lift or its encumbrance prompt.
    await update_topl(prinv_fmt(liftPrefix, held, quan));
    } finally {
        game.gm.mrg_to_wielded = false;
    }
    return held;
}

// C ref: pickup.c pickup() menu path + win/tty query_objlist() — the ','
// command over a multi-object pile opens a selectable "Pick up what?" menu.
// Objects are grouped by class in the default inventory order (classOrder),
// each class preceded by an inverse header ("Weapons", "Comestibles", ...);
// items are lettered a, b, c... in display order with a " - " (unselected) /
// " + " (selected) separator.  A letter key toggles its item; space pages (one
// page here); return/enter confirms.  On confirm the selected objects are
// returned in display order; js/pickup.js's pickup() then runs pickup_object()
// over them, and the prinv lines chain on one topline via update_topl (CO-8
// rule), matching the recorded "r - 11 darts.  s - 2 white gems." frame.
//
// Layout matches the recorder (ttyDisplay->cols == 82, H2344_BROKEN): offx 41,
// the morestr/(end) cursor parked at offx + 6 (col 47) on the (end) row.
export async function pickup_menu_select(here, qstr = 'Pick up what?') {
    const display = game.nhDisplay;
    // Build the menu in class order, lettering items as they are displayed.
    const order = classOrder();
    const groups = []; // { header, items:[{obj, letter}] }
    let li = 0;
    const nextLetter = () => (li < 26 ? String.fromCharCode(97 + li++)
        : String.fromCharCode(65 + (li++ - 26)));
    // C ref: options.c def_inv_order[] already leads with COIN_CLASS, so
    // classOrder() alone covers it (no separate COIN_CLASS prepend needed).
    for (const oclass of order) {
        const items = here.filter((o) => o.oclass === oclass);
        if (!items.length) continue;
        // C ref: pickup.c query_objlist() -> invent.c sortloot() — the default
        // 'sortloot' option ('l') alphabetizes same-class piles (via
        // loot_xname) rather than showing raw floor-chain order, so a freshly
        // landed "poisoned dart" sorts after a plain "dart" pile.
        const sorted = sortloot(items, SORTLOOT_LOOT).map((sli) => sli.obj).filter(Boolean);
        const g = { header: let_to_name(oclass, false, false), items: [] };
        // C ref: pickup.c query_objlist() — the first (only) coin stack's
        // selector is always '$' (GOLD_SYM), never a lettered accelerator.
        for (const o of sorted) {
            // C ref: pickup.c:1131 — `tmpglyph = obj_to_glyph(curr,
            // rn2_on_display_rng)` per listed item; display RNG while hallucinating.
            obj_to_glyph(o);
            g.items.push({ obj: o, letter: oclass === COIN_CLASS ? GOLD_SYM : nextLetter() });
        }
        groups.push(g);
    }
    // selected[invlet] = true
    const selected = new Map();
    let searchBlankTop = false;

    // C ref: wintty.c tty_end_menu() cw->cols = widest line + 2 ("(end)" floors it at
    // 6), and tty_display_nhwindow()'s H2344_BROKEN offx = min(min(82, cols/2),
    // cols - maxcol - 1); text is drawn at offx + 1 (see renderMenuLines).
    let widest = Math.max(qstr.length, '(end)'.length);
    for (const g of groups) {
        widest = Math.max(widest, g.header.length);
        for (const it of g.items)
            widest = Math.max(widest, `${it.letter} - ${doname_with_price(it.obj)}`.length);
    }
    const MENU_COLS = display?.cols ?? 80;
    const MENU_OFFX = Math.max(0, Math.min(Math.min(82, Math.floor(MENU_COLS / 2)),
                                           MENU_COLS - Math.max(6, widest + 2) - 1)) + 1;
    const draw = () => {
        if (!display?.clearScreen) return;
        display.clearScreen();
        render_map_to_grid();
        const cols = display.cols ?? 80;
        // Count rows: prompt + blank + per group (header + items) + (end).
        let totalRows = 2; // prompt + blank
        for (const g of groups) totalRows += 1 + g.items.length;
        totalRows += 1; // (end)
        // C ref: win/tty/wintty.c process_menu_window() writes a leading
        // blank column at cw->offx (cl_end() then putchar(' ')) before each
        // line's text, one column left of where the text itself starts —
        // clear that padding column too, or the map bleeds through there.
        for (let r = 0; r < totalRows && r < 22; r++)
            for (let c = MENU_OFFX - 1; c < cols; c++)
                display.setCell(c, r, ' ', NO_COLOR, 0);
        let row = 0;
        display.putstr(MENU_OFFX, row++, searchBlankTop ? '' : qstr, NO_COLOR, menuHeadAttr());
        display.putstr(MENU_OFFX, row++, '', NO_COLOR, ATR_NONE);
        for (const g of groups) {
            display.putstr(MENU_OFFX, row++, g.header, NO_COLOR, menuHeadAttr());
            for (const it of g.items) {
                const sep = selected.get(it.letter) ? ' + ' : ' - ';
                const line = `${it.letter}${sep}${doname_with_price(it.obj)}`;
                display.putstr(MENU_OFFX, row++, line, NO_COLOR, ATR_NONE);
            }
        }
        const endRow = row;
        display.putstr(MENU_OFFX, row, '(end)', NO_COLOR, ATR_NONE);
        putStatusLines(display);
        // Cursor parks at offx + 6 (col 47) on the (end) row (matches recorder).
        display.setCursor(MENU_OFFX + 6, endRow);
    };

    const letterMap = new Map();
    for (const g of groups) for (const it of g.items) letterMap.set(it.letter, it);

    let confirmed = false;
    for (;;) {
        draw();
        game._modal_screen = 'pickupmenu';
        const c = await nhgetch();
        const ch = String.fromCharCode(c);
        if (c === 27) { selected.clear(); confirmed = false; break; } // ESC: cancel
        if (c === 13 || c === 10) { confirmed = true; break; }        // confirm
        if (letterMap.has(ch)) {
            if (selected.get(ch)) selected.delete(ch); else selected.set(ch, true);
            continue;
        }
        // C ref: wintty.c:1700-1732 MENU_SEARCH toggles all matching entries.
        if (ch === ':') {
            const { hooked_tty_getlin, pmatchi } = await import('./extcmd-handlers.js');
            const reply = await hooked_tty_getlin('Search for:', null);
            searchBlankTop = true;
            if (reply && reply[0] !== '\x1b') {
                for (const [letter, it] of letterMap) {
                    if (!pmatchi(`*${reply}*`, `${letter} - ${doname_with_price(it.obj)}`)) continue;
                    if (selected.get(letter)) selected.delete(letter);
                    else selected.set(letter, true);
                }
            }
            continue;
        }
        // C ref: win/tty/wintty.c MENU_SELECT_ALL ('.') / MENU_UNSELECT_ALL
        // ('-') / MENU_INVERT_ALL ('@') -> set_all_on_page()/
        // unset_all_on_page()/invert_all(): mark every item on the (only)
        // page selected / deselected / toggled.
        // MENU_SELECT_PAGE ',' / MENU_UNSELECT_PAGE '\\' / MENU_INVERT_PAGE '~'
        // act on the current page, and this menu is always a single page.
        if (ch === '.' || ch === ',') { for (const let_ of letterMap.keys()) selected.set(let_, true); continue; }
        if (ch === '-' || ch === '\\') { selected.clear(); continue; }
        if (ch === '@' || ch === '~') {
            for (const let_ of letterMap.keys())
                if (selected.get(let_)) selected.delete(let_); else selected.set(let_, true);
            continue;
        }
        // space/other paging keys: single page -> treated as confirm-of-page.
        if (c === 32) { confirmed = true; break; }
    }
    delete game._modal_screen;

    if (!confirmed || selected.size === 0) return [];

    // C ref: select_menu() returns the picked entries in display order with
    // count == -1 (no count given => pick all of the stack).
    const chosen = [];
    for (const g of groups)
        for (const it of g.items)
            if (selected.get(it.letter)) chosen.push({ obj: it.obj, count: -1 });
    return chosen;
}

// C ref: hack.c pickup_checks():3788 — the ',' command's preconditions.
// Returns 1/0 (done, time / no time), -1 do a normal pickup, -2 loot the
// engulfer's inventory.
async function pickup_checks() {
    const u = ustate();
    const x = u.ux, y = u.uy;

    if (u.uswallow) {
        if (!(u.ustuck?.minvent || []).length) {
            // C ref: mondata.h:71 digests(ptr) is
            // `dmgtype_fromattack(ptr, AD_DGST, AT_ENGL) != 0` — read off the
            // attack table, NOT a monster-class test.  The old spelling here
            // compared `.mlet` (a display CHARACTER in this port) against two
            // numeric S_* constants, so both tests were vacuously true and
            // every engulfer took the digests() branch.
            const dat = u.ustuck?.data;
            if (dat && attacktype_fordmg(dat, AT_ENGL, AD_DGST)) {
                // C: two consecutive You() calls in the same command — a bare
                // write here left nothing pending for pline()'s own softPending
                // check to see, so it silently replaced this line instead of
                // merging (both fit on one row: "You pick up the ...'s tongue.
                // But it's kind of slimy, so you drop it.").
                await update_topl(`You pick up the ${dat.name || 'monster'}'s tongue.`);
                await pline("But it's kind of slimy, so you drop it.");
            } else {
                game._pending_message =
                    `You don't ${game.Blind ? 'feel' : 'see'} anything in here to pick up.`;
            }
            return 1;
        }
        return -2; /* loot the monster inventory */
    }
    const typ0 = game.level?.at(x, y)?.typ;
    if (IS_POOL_TYP(typ0)) {
        if (u.uprops?.Wwalking || u.uprops?.Flying) {
            game._pending_message = note_topl(`You cannot dive into the ${(await import('./do_name.js')).hliquid('water')} to pick things up.`);
            return 0;
        } else if (!game.Underwater) {
            game._pending_message =
                "You can't even see the bottom, let alone pick up something.";
            return 0;
        }
    }
    if (typ0 === LAVAPOOL) {
        if (u.uprops?.Wwalking || u.uprops?.Flying) {
            game._pending_message = note_topl("You can't reach the bottom to pick things up.");
            return 0;
        }
        game._pending_message = note_topl('You would burn to a crisp trying to pick things up.');
        return 0;
    }
    if (objects_at(x, y).length === 0) {
        // C ref: hack.c pickup_checks():3827 !OBJ_AT cascade — the terrain
        // under the hero picks the message; only the final `else` is generic.
        const dmask = game.level?.at(x, y)?.doormask || 0;
        const looted = game.level?.at(x, y)?.looted;
        let msg;
        if (IS_THRONE(typ0)) msg = `It must weigh${looted ? ' almost' : ''} a ton!`;
        else if (IS_SINK(typ0)) msg = 'The plumbing connects it to the floor.';
        else if (IS_GRAVE(typ0)) msg = "You don't need a gravestone.  Yet.";
        else if (IS_FOUNTAIN(typ0)) msg = 'You could drink the water...';
        else if (IS_DOOR(typ0) && (dmask & D_ISOPEN)) msg = "It won't come off the hinges.";
        else if (IS_ALTAR(typ0)) msg = 'Moving the altar would be a very bad idea.';
        else if (typ0 === STAIRS) msg = 'The stairs are solidly affixed.';
        else msg = 'There is nothing here to pick up.';
        await update_topl(msg);
        return 0;
    }
    // C ref: hack.c pickup_checks():3849 — can_reach_floor() gate.  This
    // port's can_reach_floor() only knows uswallow/Levitation, so the
    // usteed/Blind/hole wordings of C's else-if chain collapse to the surface
    // form; the pit arm is distinct because it names the pit.
    const traphere = t_at_local(x, y);
    if (!can_reach_floor_p(!!(traphere && is_pit(traphere.ttyp)))) {
        if (traphere && is_pit(traphere.ttyp) && traphere.tseen)
            game._pending_message = note_topl('You cannot reach the bottom of the pit.');
        else if (game.Blind)
            game._pending_message = note_topl('You cannot reach anything here.');
        else
            game._pending_message = note_topl('You cannot reach the floor.');
        return 0;
    }
    return -1;
}
function IS_POOL_TYP(typ) { return typ === POOL || typ === MOAT || typ === WATER; }
function t_at_local(x, y) {
    for (const t of (game.level?.traps || [])) if (t.tx === x && t.ty === y) return t;
    return null;
}
// C ref: engrave.c can_reach_floor(check_pit) — FALSE while swallowed or
// levitating.  (The local can_reach_floor() above this file's drop code is a
// bare `return true` kept for its own callers.)
function can_reach_floor_p(_check_pit) {
    const u = ustate();
    return !u.uswallow && !u.uprops?.Levitation;
}

// C ref: hack.c dopickup():3876 — the ',' command.  The digit prefix's repeat
// count becomes pickup()'s "pick N of something" argument and gm.multi is
// always reset; pickup_checks() decides between the engulfer-loot path, an
// early refusal, and a normal pickup.
export async function dopickup() {
    const u = ustate();
    const count = game.command_count | 0;
    game.multi = 0; /* always reset */

    const ret = await pickup_checks();
    if (ret >= 0) return ret ? 1 : 0;
    if (ret === -2) {
        const tmpcount = { value: -count };
        return (await loot_mon(u.ustuck, tmpcount, null)) ? 1 : 0;
    }
    // pickup() runs query_objlist() (AUTOSELECT_SINGLE for a lone item, the
    // "Pick up what?" menu otherwise), then pickup_object() per selection —
    // which is where the lift/weight, corpse and scare-scroll checks live.
    return await pickup(-count);
}

// C ref: display.c newsym_force() — force a redraw of (x,y).  newsym already
// recomputes the displayed glyph from the (now reduced) floor pile, so this is
// the same call here.
export function newsym_force(x, y) { newsym(x, y); }

// C ref: invent.c canletgo(obj, word) — the four refusals, in C's order: a worn
// armor piece/accessory, a cursed loadstone, a leash with a monster on it, and
// a saddle being sat on.  The worn-item guard was missing entirely, so 'd' on a
// worn ring used to move it out of inventory while uleft/uright still pointed
// at it; the loadstone branch printed nothing and never set bknown.
export async function canletgo(obj, word) {
    if (!obj) return true;
    if ((obj.owornmask || 0) & (WA_ARMOR_ALL | W_ACCESSORY)) {
        // C ref: do.c:669 — Norep compares the last individual message.
        const msg = `You cannot ${word} something you are wearing.`;
        if (word && game._prevmsg !== msg) await pline(msg);
        return false;
    }
    if (obj === game.uwep && welded(game.uwep)) {
        // C ref: do.c canletgo() — no weldmsg(); Norep() (see above).
        if (word) {
            const hand = bimanual(game.uwep) ? makeplural(body_part(6 /*HAND*/)) : body_part(6);
            const msg = `You cannot ${word} something welded to your ${hand}.`;
            if (game._prevmsg !== msg) await pline(msg);
        }
        return false;
    }
    if (obj.otyp === LOADSTONE && obj.cursed) {
        if (word) {
            // getobj()'s count kludge parks the requested count in corpsenm.
            if (word !== 'throw' && (obj.corpsenm | 0) > 0
                && (obj.corpsenm | 0) < (obj.quan || 1))
                await pline(`You cannot ${word} just part of a stack of cursed loadstones.`);
            else
                await pline(`For some reason, you cannot ${word}${(obj.quan || 1) > 1 ? ' any of' : ''} the stone${plur(obj.quan || 1)}!`);
        }
        obj.corpsenm = 0;   /* reset */
        obj.bknown = 1;
        return false;
    }
    if (obj.otyp === LEASH && obj.leashmon) {
        if (word) await pline(`The leash is tied around your ${body_part(6 /*HAND*/)}.`);
        return false;
    }
    if ((obj.owornmask || 0) & W_SADDLE) {
        if (word) await pline(`You cannot ${word} something you are sitting on.`);
        return false;
    }
    return true;
}

// printf-style helpers for the spell-view menu column layout.
function padEnd(s, n) { return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padStart(s, n) { return s.length >= n ? s : ' '.repeat(n - s.length) + s; }


export function splittable(obj) {
    return !(obj?.otyp === LOADSTONE && obj.cursed) && !(obj === game.uwep && welded(game.uwep));
}

export function taking_off(action) {
    return action === 'take off' || action === 'remove';
}

// C ref: invent.c mime_action() — splits " on the <x>" into a suffix, turns
// "rub the <x> on"/"dip <x> into" into a prefix, and picks one of an "A or B"
// verb pair with rn2(2) (so this costs a draw for e.g. "use or apply").
export async function mime_action(word) {
    let buf = String(word), pfx = null, sfx = null, bp;
    if ((bp = buf.indexOf(' on the ')) >= 0) {
        sfx = buf.slice(bp + 1);
        buf = buf.slice(0, bp);
    }
    if ((buf.startsWith('rub the ') && buf.slice(8).includes(' on'))
        || (buf.startsWith('dip ') && buf.slice(4).includes(' into'))) {
        pfx = buf.slice(4);
        buf = buf.slice(0, 3);
    }
    let verb;
    if ((bp = buf.indexOf(' or ')) >= 0)
        verb = rn2(2) ? buf.slice(0, bp) : buf.slice(bp + 4);
    else verb = buf;
    await update_topl(`You mime ${ing_suffix(verb)}${pfx ? ' ' + pfx : ''} something${sfx ? ' ' + sfx : ''}.`);
}

export function any_obj_ok(obj) {
    return obj ? GETOBJ_SUGGEST : GETOBJ_EXCLUDE;
}

export function getobj_hands_txt(action, qbuf = '') {
    if (action === 'grease') return `your ${fingers_or_gloves(false)}`;
    if (action === 'write with') return `your ${body_part(4)}`;
    if (action === 'wield') return `your ${game.uarmg ? 'gloved' : 'bare'} ${makeplural(body_part(6))}${!game.uwep ? ' (wielded)' : ''}`;
    if (action === 'ready') return `empty quiver${!game.uquiver ? ' (nothing readied)' : ''}`;
    return qbuf || `your ${makeplural(body_part(6))}`;
}


export async function silly_thing(word, otmp) {
    if (word === 'call' && otmp?.otyp === AMULET_OF_YENDOR)
        await update_topl("The Amulet doesn't like being called names.");
    else await update_topl(`That is a silly thing to ${word}.`);
}

export function ckvalidcat(otmp) { return allow_category(otmp) ? 1 : 0; }
export function ckunpaid(otmp) { return otmp?.unpaid || (Has_contents(otmp) && count_unpaid(otmp.cobj)); }
export function wearing_armor() { return !!(game.uarm || game.uarmc || game.uarmf || game.uarmg || game.uarmh || game.uarms || game.uarmu); }
// C ref: obj.h is_worn() — armor | accessory | saddle | any weapon slot.
// W_ARMOR/W_WEAPONS above are the same numbers setworn_slot()/armor_slot_mask()
// stamp (0x7f and 0x100|0x200|0x400) since the 770688a worn-mask correction.
export function is_worn(otmp) { return !!(otmp?.owornmask & (W_ARMOR | W_ACCESSORY | W_SADDLE | W_WEAPONS)); }
export function is_inuse(obj) { return carried(obj) && (is_worn(obj) || tool_being_used(obj)); }
export function safeq_xprname(obj) { return xprname(obj, null, safeq_xprn_ctx.let, safeq_xprn_ctx.dot, 0, 0); }
export function safeq_shortxprname(obj) { return xprname(obj, ansimpleoname(obj), safeq_xprn_ctx.let, safeq_xprn_ctx.dot, 0, 0); }

// C ref: invent.c static removeables[] -- the classes 'A' can take off.
const REMOVEABLES = [ARMOR_CLASS, WEAPON_CLASS, RING_CLASS, AMULET_CLASS, TOOL_CLASS];
const ynaqchars = 'ynaq', ynNaqchars = 'yn#aq';

// C ref: invent.c ggetobj() -- the menustyle:Traditional/Combination class
// prompt used by Drop, Identify and Takeoff (A).  Returns the number of times
// fn was called successfully (askchain()'s result), 0 when cancelled, -1 for
// "no further identifications", and -2/-3 when the player asked for the menu
// with 'm' (all types / only the selected classes).  With combo set it only
// gathers the category list.
export async function ggetobj(word, fn, mx, combo, resultflags = null) {
    const inv = inventoryArray();
    if (!inv.length) {
        await pline(`You have nothing to ${word}.`);
        if (resultflags) resultflags.value = ALL_FINISHED;
        return 0;
    }
    if (resultflags) resultflags.value = 0;
    let ckfn = null, ofilter = null;
    let takeoff = false, ident = false, allflag = false, m_seen = false;
    add_valid_menu_class(0); /* reset */
    if (taking_off(word)) {
        takeoff = true;
        ofilter = is_worn;
    } else if (word === 'identify') {
        ident = true;
        ofilter = not_fully_identified;
    }

    const iletsArr = [];
    const itemcount = { count: 0 };
    let iletct = collect_obj_classes(iletsArr, inv, false, ofilter, itemcount);
    let ilets = iletsArr.join('');
    const unpaid = count_unpaid(inv);

    if (ident && !iletct) {
        return -1; /* no further identifications */
    } else if (inv.length) {
        ilets += ' ';
        if (unpaid) ilets += 'u';
        if (count_buc(inv, BUC_BLESSED, ofilter)) ilets += 'B';
        if (count_buc(inv, BUC_UNCURSED, ofilter)) ilets += 'U';
        if (count_buc(inv, BUC_CURSED, ofilter)) ilets += 'C';
        if (count_buc(inv, BUC_UNKNOWN, ofilter)) ilets += 'X';
        if (count_justpicked(inv)) ilets += 'P';
        ilets += 'a';
    }
    ilets += 'i';
    if (!combo) ilets += 'm'; /* allow menu presentation on request */

    let buf;
    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    for (;;) {
        buf = String(await hooked_tty_getlin(
            `What kinds of thing do you want to ${word}? [${ilets}]`, null));
        if (buf.charAt(0) === '\x1b') return 0;
        if (buf.includes('i')) {
            /* applicable inventory letters; if empty, show entire invent */
            let ailets = '';
            if (ofilter)
                for (const otmp of inventoryArray())
                    if (ofilter(otmp) && !ailets.includes(otmp.invlet))
                        ailets += otmp.invlet;
            if ((await display_inventory_interactive(ailets)) === '\x1b')
                return 0;
        } else {
            break;
        }
    }

    let extra_removeables = '';
    if (takeoff) {
        /* arbitrary types of items can be placed in the weapon slots */
        if (game.uwep) extra_removeables += String.fromCharCode(game.uwep.oclass);
        if (game.uswapwep) extra_removeables += String.fromCharCode(game.uswapwep.oclass);
        if (game.uquiver) extra_removeables += String.fromCharCode(game.uquiver.oclass);
    }

    const olets = [];            /* object class NUMBERS, in the order typed */
    for (const sym of buf) {
        if (sym === ' ') continue;
        const oc_of_sym = pickup_def_char_to_objclass(sym);
        if (takeoff && oc_of_sym !== MAXOCLASSES) {
            if (extra_removeables.includes(String.fromCharCode(oc_of_sym))) {
                ; /* skip rest of takeoff checks */
            } else if (!REMOVEABLES.includes(oc_of_sym)) {
                await pline('Not applicable.');
                return 0;
            } else if (oc_of_sym === ARMOR_CLASS && !wearing_armor()) {
                noarmor(false);
                return 0;
            } else if (oc_of_sym === WEAPON_CLASS && !game.uwep && !game.uswapwep
                       && !game.uquiver) {
                await pline('You are not wielding anything.');
                return 0;
            } else if (oc_of_sym === RING_CLASS && !game.uright && !game.uleft) {
                await pline('You are not wearing rings.');
                return 0;
            } else if (oc_of_sym === AMULET_CLASS && !game.uamul) {
                await pline('You are not wearing an amulet.');
                return 0;
            } else if (oc_of_sym === TOOL_CLASS && !game.ublindf) {
                await pline('You are not wearing a blindfold.');
                return 0;
            }
        }

        if (sym === 'a') {
            allflag = true;
        } else if (sym === 'A') {
            ; /* same as the default */
        } else if (sym === 'u') {
            add_valid_menu_class('u');
            ckfn = ckunpaid;
        } else if ('BUCXP'.includes(sym)) {
            add_valid_menu_class(sym); /* 'B','U','C','X', or 'P' */
            ckfn = ckvalidcat;
        } else if (sym === 'm') {
            m_seen = true;
        } else if (oc_of_sym === MAXOCLASSES) {
            await pline(`You don't have any ${sym}'s.`);
        } else if (!olets.includes(oc_of_sym)) {
            add_valid_menu_class(sym);   /* this port's classes are SYMBOLS */
            olets.push(oc_of_sym);
        }
    }

    if (m_seen) {
        return (allflag
                || (!olets.length && ckfn !== ckunpaid && ckfn !== ckvalidcat))
               ? -2 : -3;
    } else if (menu_style() !== MENU_TRADITIONAL && combo && !allflag) {
        return 0;
    }
    const cnt = await askchain(inventoryArray(), olets, allflag, fn, ckfn, mx, word);
    /* askchain() has already finished the job in this case, so tell the
       caller not to continue processing */
    if (combo && allflag && resultflags) resultflags.value |= ALL_FINISHED;
    return cnt;
}

// C ref: invent.c askchain() -- walk the chain in the object class order given
// by olets (class numbers) and ask, item by item, whether fn should be applied
// (allflag skips the asking).  Returns the sum of fn's results, or -1 when an
// identify was abandoned.  The chain is always the hero's inventory in this
// port (the container traditional_loot() path does not go through here yet).
export async function askchain(objchn, olets, allflag, fn, ckfn, mx, word) {
    let cnt = 0, dud = 0;
    const takeoff = taking_off(word);
    const ident = (word === 'identify');
    const take_out = (word === 'take out');
    const put_in = (word === 'put in');
    const nodot = (word === 'nodot' || word === 'drop' || ident
                   || takeoff || take_out || put_in);
    const ininv = (objchn === inventoryArray());
    const bycat = (menu_class_present('u') || menu_class_present('B')
                   || menu_class_present('U') || menu_class_present('C')
                   || menu_class_present('X') || menu_class_present('P'));
    /* someday maybe we'll sort by 'olets' too, but not yet... */
    const sortedchn = sortloot(objchn, SORTLOOT_INVLET, false, null);
    let first = true;
    let oi = 0;                       /* index into olets (C: *olets++) */

    try {
        for (;;) {                    /* nextclass: */
            let ilet = 'a'.charCodeAt(0) - 1;
            if (objchn.length && objchn[0].oclass === COIN_CLASS)
                ilet--;               /* extra iteration */
            /* each object's bypass bit tracks which have been processed, since
               multiple drop can change the chain while it operates */
            bypass_objlist(objchn, false);
            let otmp;
            while ((otmp = nxt_unbypassed_loot(sortedchn, objchn)) != null) {
                if (ilet === 122 /* 'z' */) ilet = 65 /* 'A' */;
                else if (ilet === 90 /* 'Z' */) ilet = 35 /* NOINVSYM '#' */;
                else ilet++;
                if (olets.length && otmp.oclass !== olets[oi]) continue;
                if (takeoff && !is_worn(otmp)) continue;
                if (ident && !not_fully_identified(otmp)) continue;
                if (ckfn && !ckfn(otmp)) continue;
                if (bycat && !ckvalidcat(otmp)) continue;
                let sym;
                if (!allflag) {
                    safeq_xprn_ctx.let = String.fromCharCode(ilet);
                    safeq_xprn_ctx.dot = !nodot;
                    let qpfx = '';
                    if (first) {
                        /* traditional_loot() skips prompting when only one class
                           of objects is involved, so prefix the first object
                           being queried here with an explanation why */
                        if (take_out || put_in)
                            qpfx = `${word.charAt(0).toUpperCase()}${word.slice(1)}: `;
                        first = false;
                    }
                    const qbuf = safe_qbuf(qpfx, '?', otmp,
                        ininv ? safeq_xprname : doname,
                        ininv ? safeq_shortxprname : ansimpleoname, 'item');
                    /* nyaq(qbuf) or nyNaq(qbuf), bypassing canned input for ^A */
                    await yn_pending_more();
                    sym = await y_n(qbuf,
                        (takeoff || ident || (otmp.quan | 0) < 2) ? ynaqchars : ynNaqchars,
                        'n');
                } else {
                    sym = 'y';
                }

                const otmpo = otmp;
                let target = otmp;
                if (sym === '#') {
                    /* Number was entered; split the object unless it
                       corresponds to 'none' or 'all'.  2 special cases: cursed
                       loadstones and welded weapons stay merged. */
                    const yn_number = game.yn_number | 0;
                    if (!yn_number) {
                        sym = 'n';
                    } else {
                        sym = 'y';
                        if (yn_number < target.quan && splittable(target))
                            target = splitobj(target, yn_number);
                    }
                }
                let done = false;
                switch (sym) {
                case 'a':
                    allflag = true;
                    /* FALLTHRU */
                case 'y': {
                    const tmp = await fn(target);
                    if (tmp <= 0) {
                        if (container_gone(fn)) {
                            /* target caused magic bag to explode; both gone */
                            target = null;
                        } else if (target && target !== otmpo) {
                            /* split occurred, merge again */
                            unsplitobj(target);
                        }
                        if (tmp < 0) return cnt;
                    }
                    cnt += tmp;
                    if (--mx === 0) return cnt;
                    /* FALLTHRU */
                }
                case 'n':
                    if (nodot) dud++;
                    break;
                case 'q':
                    /* special case for seffects() */
                    if (ident) cnt = -1;
                    return cnt;
                default:
                    break;
                }
            }
            if (olets.length && ++oi < olets.length) continue;   /* goto nextclass */
            break;
        }

        if (!takeoff && (dud || cnt))
            await pline('That was all.');
        else if (!dud && !cnt)
            await pline('No applicable objects.');
        return cnt;
    } finally {
        /* can't just clear bypass bit of items in objchn because the action
           applied to selected ones might move them to a different chain */
        clear_bypasses();
        unsortloot(sortedchn);
    }
}
// C ref: wintty.c tty_select_menu(window, PICK_ONE) for callers outside
// invent.c that build their own `items`/`plan` (see reroll_menu()).
export async function select_pick_one_menu(items, plan) {
    return await tty_select_menu(items, plan, PICK_ONE);
}
// C ref: invent.c reroll_menu() — the OPTIONS=reroll confirm-or-reroll PICK_ONE
// menu: 'p' selects a_char 'n' ("start the game with this character"), 'r'
// selects a_char 'y' ("reroll another character"), then the starting
// inventory (doname() per item) and a "St:.. Dx:.. Co:.. In:.. Wi:.. Ch:.."
// line, all non-selectable.  If the player closes the menu without picking
// (ESC/space/Enter with nothing selected — tty_select_menu()'s PICK_ONE
// already matches C's process_menu_window commit-with-nothing-selected
// behavior), C falls back to a plain y_n() re-ask instead of a definite
// answer.  Returns true (and bumps u.uroleplay.numrerolls) only for 'y'.
export async function reroll_menu() {
    const u = game.u;
    const inv = Array.isArray(game.invent) ? game.invent : [];
    const items = [
        { selector: 'p', achar: 'n', desc: 'start the game with this character',
          selected: false, count: -1, gselector: null, skipinvert: false },
        { selector: 'r', achar: 'y', desc: 'reroll another character',
          selected: false, count: -1, gselector: null, skipinvert: false },
    ];
    const plan = [
        { str: 'Reroll this character?', attr: menuHeadAttr() }, { str: '' },
        { item: items[0] }, { item: items[1] }, { str: '' },
    ];
    // C ref: u_init.c — starting gear isn't setworn()/setuwep()'d until
    // ini_inv_use_obj() (called from u_init_skills_discoveries(), AFTER
    // reroll_menu() returns), so doname()'s owornmask-driven "(being worn)"/
    // "(weapon in hand)"/"(alternate weapon; not wielded)" suffixes cannot
    // fire yet — this port sets owornmask earlier, so use the bare name
    // (doname() minus that suffix) to match what C actually shows here.
    // C ref: invent.c reroll_menu() `++iflags.override_ID;` — every listed
    // item shows its REAL type name (e.g. "small shield", not the unidentified
    // "wooden shield" appearance) even though discover_object() for it hasn't
    // run yet (that's ini_inv_use_obj(), also after reroll_menu() returns).
    game.iflags = game.iflags || {};
    const savedOverrideID = game.iflags.override_ID;
    game.iflags.override_ID = true;
    try {
        for (const obj of inv) {
            const worn = obj.owornmask;
            obj.owornmask = 0;
            try { plan.push({ str: on_doname_base(obj, 0) }); } finally { obj.owornmask = worn; }
        }
    } finally {
        game.iflags.override_ID = savedOverrideID;
    }
    plan.push({ str: '' });
    const { get_strength_str } = await import('./botl.js');
    plan.push({ str: `St:${get_strength_str()} Dx:${acurr_eff(A_DEX)}`
        + ` Co:${acurr_eff(A_CON)} In:${acurr_eff(A_INT)}`
        + ` Wi:${acurr_eff(A_WIS)} Ch:${acurr_eff(A_CHA)}` });

    const picked = await tty_select_menu(items, plan, PICK_ONE);
    // C ref: wintty.c tty_select_menu() — `tty_dismiss_nhwindow(window)` runs
    // BEFORE the n>0 check, so the overlay is already gone (map restored)
    // by the time a fallback y_n() might show its own prompt.
    delete game._modal_screen;
    await docrt();
    await flush_screen(1);
    const option = picked.length > 0 ? picked[0].achar
        : await y_n('Reroll this character?');

    if (option === 'y') {
        u.uroleplay = u.uroleplay || {};
        u.uroleplay.numrerolls = (u.uroleplay.numrerolls | 0) + 1;
        return true;
    }
    return false;
}
export function set_cknown_lknown(obj) { if (Is_container(obj) || obj?.otyp === STATUE) obj.cknown = obj.lknown = 1; else if (obj?.otyp === TIN) obj.cknown = 1; }
export function fully_identify_obj(otmp) { makeknown(otmp?.otyp); observe_object(otmp); if (otmp) otmp.known = otmp.bknown = otmp.rknown = 1; set_cknown_lknown(otmp); if (otmp?.otyp === EGG) learn_egg_type(otmp.corpsenm); }
// C ref: invent.c identify(otmp) — fully_identify_obj() then prinv(), whose
// pline() routes through update_topl().  That routing is load-bearing: an
// identify scroll announces every item it names, each line is ~45 columns, so two
// of them cannot share the 80-column topline and C emits a --More-- between
// them — one captured frame per identified item (seed4500 steps 494-497).
// prinv() assigns _pending_message directly, which silently overwrites the
// previous item instead, so use update_topl() here.
export async function identify(otmp) {
    fully_identify_obj(otmp);
    await update_topl(prinv_fmt(null, otmp, 0));
    return 1;
}
// C ref: invent.c menu_identify — repeatedly open a PICK_ANY inventory menu
// until the scroll's identification quota is exhausted, the hero declines with
// ESC, or five empty submissions have been retried.
async function menu_identify(id_limit) {
    let first = true, tryct = 5;
    while (id_limit) {
        // C's menu setup flushes the pending message window before it draws the
        // inventory menu.  `update_topl()` tracks this as a soft pending line,
        // so force the same --More-- boundary before each menu iteration.
        if (game._pending_message) {
            await topl_more();
            game._pending_message = '';
            game._toplin = 0;
            game._toplinSoft = null;
        }
        const picks = await query_objlist_menu(
            `What would you like to identify ${first ? 'first' : 'next'}?`,
            inventoryArray(),
            SIGNAL_NOMENU | SIGNAL_ESCAPE | USE_INVLET | INVORDER_SORT,
            PICK_ANY, not_fully_identified);
        if (picks.length) {
            const n = Math.min(picks.length, id_limit);
            for (let i = 0; i < n; i++, id_limit--)
                await identify(picks[i].obj);
            first = false;
        } else if (picks.cancelled) {
            break;
        } else if (!--tryct) {
            await pline("That's enough tries!");   // invent.c:2689 thats_enough_tries
            break;
        } else {
            await pline('Choose an item; use ESC to decline.');
        }
    }
}
export function count_unidentified(objchn) { let n = 0; for (const obj of iterateObjects(objchn)) if (not_fully_identified(obj)) ++n; return n; }
// C ref: invent.c identify_pack(id_limit, learning_id).  id_limit==0 OR >=
// unid_cnt identifies the whole pack; a positive limit identifies up to that
// many.  When nothing is unidentified, reports "You have already identified
// <all|the rest> of your possessions." (learning_id => "the rest", since the
// just-read identify scroll was used up before this call).
export async function identify_pack(id_limit = 0, learning_id = false) {
    const unid_cnt = count_unidentified(inventoryArray());
    if (!unid_cnt) {
        // C: You("have already identified ..."); update_topl so the message
        // chains after (and pages with --More--) any line already pending this
        // turn — e.g. the "This is an identify scroll." line from the read.
        await update_topl(`You have already identified ${learning_id ? 'the rest' : 'all'} of your possessions.`);
        update_inventory();
        return;
    }
    if (!id_limit || id_limit >= unid_cnt) {
        let remaining = unid_cnt;
        for (const obj of inventoryArray()) {
            if (not_fully_identified(obj)) { await identify(obj); if (--remaining < 1) break; }
        }
    } else {
        await menu_identify(id_limit);
    }
    update_inventory();
}
// C ref: wizcmds.c wiz_identify() — sets iflags.override_ID and calls
// display_inventory(NULL, FALSE); invent.c display_pickinv()'s `wizid` block
// puts an add_menu_str() title ("Debug Identify", ATR_NONE) at the top and then
// lists ONLY the not-fully-identified items (`if (wizid &&
// !not_fully_identified(otmp)) continue`).  With nothing left to identify the
// list is empty and a single "(all items ...)" line replaces the selector entry.
// The menu is PICK_ANY (invent.c:3380): items are picked by invlet, '_' or ^I
// picks everything, and the picked items are identified when the menu is
// confirmed.
export async function wiz_identify() {
    const unid_cnt = count_unidentified(inventoryArray());
    let title = 'Debug Identify';
    if (unid_cnt)
        title += ` -- unidentified or partially identified item${unid_cnt === 1 ? '' : 's'}`;
    const plan = [{ str: title }];
    const items = [];
    if (!unid_cnt) {
        plan.push({ str: '(all items are permanently identified already)' });
    } else {
        // visctrl(C('I')) == "^I"; the primary selector is '_'.
        let prompt = `select ${unid_cnt === 1 ? 'it' : 'any or all of them'} to permanently identify`;
        if (unid_cnt > 1) prompt += ' (^I for all)';
        items.push({ selector: '_', desc: prompt, obj: null, selected: false,
                     count: -1, gselector: '\x09', skipinvert: true });
        plan.push({ item: items[0] });
        const headAttr = game.program_state?.gameover ? 0 : (menuHeadAttr());
        // C ref: wizcmds.c wiz_identify() sets iflags.override_ID before calling
        // display_inventory(); objnam.c's doname()/xname() then report every
        // listed item (even ones not_fully_identified() would still filter out
        // elsewhere) with known=dknown=bknown=TRUE, so this menu shows what the
        // item REALLY is rather than its current (partial) identification state.
        game.iflags = game.iflags || {};
        const savedOverrideID = game.iflags.override_ID;
        game.iflags.override_ID = true;
        try {
            const sortflags = (flags().sortloot === 'f' ? SORTLOOT_LOOT : SORTLOOT_INVLET)
                | (flags().sortpack !== false ? SORTLOOT_PACK : 0);
            const sorted = sortloot(inventoryArray(), sortflags).map((e) => e.obj)
                .filter((o) => o && not_fully_identified(o));
            for (const oclass of classOrder()) {
                const group = sorted.filter((o) => o.oclass === oclass);
                if (!group.length) continue;
                plan.push({ str: let_to_name(oclass, false, false), attr: headAttr });
                for (const obj of group) {
                    obj_to_glyph(obj);
                    const it = { selector: obj.invlet || obj_to_let(obj),
                                 desc: doname_invent(obj), obj, selected: false,
                                 count: -1, gselector: def_oc_syms[oclass]?.sym,
                                 skipinvert: false };
                    items.push(it);
                    plan.push({ item: it });
                }
            }
        } finally {
            game.iflags.override_ID = savedOverrideID;
        }
    }
    const picked = await tty_select_menu(items, plan, PICK_ANY);
    await dismiss_invent_screen();
    // C ref: invent.c:3383-3407 — identify the picks (the fake '_' object means
    // the whole pack).
    let all_id = false;
    for (const it of picked) {
        if (!it.obj) {
            await identify_pack(0, false);
            all_id = true;
            break;
        }
        if (not_fully_identified(it.obj)) await identify(it.obj);
    }
    if (!all_id && picked.length) update_inventory();
    return ECMD_OK;
}

// C ref: invent.c:2750 learn_unseen_invent() — toggle_blindness() runs this the
// moment sight returns, so anything acquired while blind finally gets its
// appearance.  xname() is what sets dknown (through its own !Blind
// observe_object); an object that is already fully seen is SKIPPED, so its type
// is not re-appended to the disco[] '\' list.  Looping observe_object() over
// the whole pack instead re-encountered every born-dknown item (armor, food)
// on each recovery and reordered the discoveries.
export function learn_unseen_invent() {
    if (Blind_for_wear()) return;   /* sanity check */
    let invupdated = false;
    for (const otmp of inventoryArray()) {
        if (otmp.dknown && (otmp.bknown || !Role_if(PM_CLERIC))
            && (otmp.oclass !== SCROLL_CLASS || !Role_if(PM_ARCHEOLOGIST)))
            continue;
        invupdated = true;
        xname(otmp);
        addinv_core2(otmp);
    }
    if (invupdated) update_inventory();
}
export function update_inventory() { if (!program_state().in_moveloop && !game._allow_inventory_update) return; }
// C ref: invent.c doperminv() — the '|' #perminv command.  This port's
// windowport (js/wintty.js) never sets WC_PERM_INVENT (persistent inventory
// display is a curses/Qt/browser-port feature, not tty), so the very first
// branch always fires: `pline("Persistent inventory display is not
// supported by '%s'.", windowprocs.name);` with windowprocs.name=="tty".
export async function doperminv() {
    await pline("Persistent inventory display is not supported by 'tty'.");
    return ECMD_OK;
}
export function obj_to_let(obj) { if (!flags().invlet_constant) reassign(); return obj?.invlet || NOINVSYM; }

// The text prinv() would print, with no display side effects.  Callers that
// want to route the line through update_topl() themselves (so successive
// pickups accumulate onto one topline) format with this instead of calling
// prinv() and then undoing its writes.
export function prinv_fmt(prefix, obj, quan = 0) {
    // C ref: invent.c prinv()/xprname() — the per-item line uses the full
    // doname() form (BUC, enchant, erosion, and worn-status suffix such as
    // "(at the ready)"), not the bare object name.
    //   boolean total_of = (quan && (quan < obj->quan));
    // When a subset count is lifted onto (merged into) a larger stack — e.g.
    // picking up gold that merges with coins already carried — C suppresses the
    // trailing period on the item name (xprname dot = !total_of) and, when
    // flags.verbose, appends " (<obj->quan> in total)." after it.
    const total_of = !!(quan && obj && quan < obj.quan);
    const text = xprname(obj, doname_invent_quan(obj, quan), obj_to_let(obj), !total_of, 0, quan);
    const totalbuf = (total_of && flags().verbose !== false)
        ? ` (${obj.quan} in total).` : '';
    return `${prefix ? `${prefix} ` : ''}${text}${totalbuf}`;
}

export function prinv(prefix, obj, quan = 0) {
    // C ref: invent.c prinv() -> pline() -> vpline():266 flush_screen(1), which
    // runs bot() when disp.botl is set (display.js botl_flush(), synchronously).
    if (game.botl) {
        game.botl = false;
        if (game.u?.uhp !== -1) delete game._botlFrozen;
        game._curcap = near_capacity();
        bot_snapshot();
    }
    game._pending_message = prinv_fmt(prefix, obj, quan);
    // C ref: invent.c prinv() emits its line with pline(), which routes through
    // topl.c update_topl() and leaves gt.toplin == TOPLIN_NEED_MORE.  Any
    // message printed afterwards in the same command therefore either merges
    // onto this line or fires --More-- first; without recording the state the
    // follow-up (e.g. wizcmds.c wiz_wish()'s encumber_msg()) silently
    // overwrites the item line instead.
    remember_topl();
    game._toplines = wrap_topl(game._pending_message).join('\n');
    game._toplin = 1; // TOPLIN_NEED_MORE
}

// doname_invent for a (temporarily) overridden quantity, restoring it after.
function doname_invent_quan(obj, quan) {
    if (!obj) return 'nothing';
    if (!quan) return doname_invent(obj);
    const oldQuan = obj.quan;
    obj.quan = quan;
    const text = doname_invent(obj);
    obj.quan = oldQuan;
    return text;
}

export function xprname(obj, txt = null, letChar = '\0', dot = true, cost = 0, quan = 0) {
    const oldQuan = obj?.quan;
    if (quan && obj) obj.quan = quan;
    const text = txt || doname(obj);
    let suffix = dot ? '.' : '';
    if (cost) suffix = ` ${String(cost).padStart(6, ' ')} ${currency(cost)}`;
    const letter = letChar || obj?.invlet || NOINVSYM;
    const result = `${letter} - ${text}${suffix}`;
    if (quan && obj) obj.quan = oldQuan;
    return result;
}

// C ref: invent.c surface(x,y) — the noun for the terrain underfoot, used in
// the itemactions "Write on the <surface> with this item" label.  Ordinary
// dungeon floor (and the cases the recorded sessions reach) is "floor".
function surface_underfoot() {
    const u = game.u || {};
    const loc = game.level?.at?.(u.ux, u.uy);
    const typ = loc?.typ ?? 0;
    // C ref: dungeon.c surface(x,y) — the arms in C's order.  This used to
    // answer "floor" for everything but ice, so a corridor/doorway/stairs square
    // read "hits the floor" where C says "hits the ground"/"the stairs".
    // rm.h typs: POOL 16 .. DRAWBRIDGE_UP 19, LAVAPOOL 20, LAVAWALL 21,
    // CORR 24, ROOM 25, STAIRS 26, LADDER 27, FOUNTAIN 28, GRAVE 31, ALTAR 32,
    // ICE 33, DRAWBRIDGE_DOWN 34, AIR 35, CLOUD 36.
    if (typ === 35 /* AIR */) return 'air';
    if (typ === 36 /* CLOUD */) return 'cloud';
    if (typ >= POOL && typ <= 19 /* DRAWBRIDGE_UP */) return 'water';
    if (typ === ICE) return 'ice';
    if (typ === LAVAPOOL || typ === LAVAWALL) return 'lava';
    if (typ === DRAWBRIDGE_DOWN) return 'bridge';
    if (IS_ALTAR(typ)) return 'altar';
    if (IS_GRAVE(typ)) return 'headstone';
    if (IS_FOUNTAIN(typ)) return 'fountain';
    if (typ === STAIRS || typ === 27 /* LADDER */) return 'stairs';
    if (typ <= DBWALL || typ === SDOOR_TYP) return 'wall';
    if (IS_DOOR(typ)) return 'doorway';
    if (typ >= ROOM_TYP) return 'floor';
    return 'ground';
}
const SDOOR_TYP = 14, ROOM_TYP = 25;

// itemactions() action enum (iactions.h IA_*) — the subset the object classes in
// the recorded sessions can offer.  Each entry carries its menu accelerator and
// label; itemactions_dispatch() turns the chosen one into the real command.
const IA_NONE = 0, IA_UNWIELD = 1, IA_APPLY_OBJ = 2, IA_NAME_OBJ = 3,
    IA_NAME_OTYP = 4, IA_DROP_OBJ = 5, IA_EAT_OBJ = 6, IA_ENGRAVE_OBJ = 7,
    IA_FIRE_OBJ = 8, IA_ADJUST_OBJ = 9, IA_SPLIT_OBJ = 10, IA_SACRIFICE = 11,
    IA_BUY_OBJ = 12, IA_WEAR_OBJ = 13, IA_QUAFF_OBJ = 14, IA_QUIVER_OBJ = 15,
    IA_READ_OBJ = 16, IA_TAKEOFF_OBJ = 17, IA_RUB_OBJ = 18, IA_THROW_OBJ = 19,
    IA_TIP_CONTAINER = 20, IA_INVOKE_OBJ = 21, IA_WIELD_OBJ = 22,
    IA_ZAP_OBJ = 23, IA_WHATIS_OBJ = 24,
    IA_DIP_OBJ = 25, IA_SWAPWEAPON = 26, IA_TWOWEAPON = 27;

// C ref: iactions.c itemactions(otmp) — build the per-object "Do what with %s?"
// action list, in the C cascade order.  Mirrors the conditions for each action
// block; only the cases the recorded object classes reach are populated.  Each
// returned entry is { act, accel, label }.
// onames.h otyps referenced by the itemactions cascade (mkobj.js OBJECT_DATA).
const CREAM_PIE = 287, BULLWHIP = 82, GRAPPLING_HOOK = 260, CAN_OF_GREASE = 240,
    LOCK_PICK = 222, CREDIT_CARD = 223, SKELETON_KEY = 221, TINNING_KIT = 238,
    SADDLE = 235, MAGIC_WHISTLE = 246, TIN_WHISTLE = 245, EUCALYPTUS_LEAF = 276,
    STETHOSCOPE = 237, MIRROR = 230, BELL = 255, WAX_CANDLE = 225,
    TALLOW_CANDLE = 224, OIL_LAMP = 227, MAGIC_LAMP = 228, BRASS_LANTERN = 226,
    POT_OIL = 321, EXPENSIVE_CAMERA = 229, CRYSTAL_BALL = 231,
    MAGIC_MARKER = 242, UNICORN_HORN = 261, WOODEN_FLUTE = 247,
    DRUM_OF_EARTHQUAKE = 258, LAND_MINE = 243, BEARTRAP = 244, PICK_AXE = 259,
    DWARVISH_MATTOCK = 71, TIN_OPENER = 239;

// C ref: objnam.c the_unique_obj(obj) — should this object be named with "the"?
function the_unique_obj(obj) {
    // mksobj() in this port does not write `dknown` (C's mkobj.c sets it from
    // the object class), so an unset field means "described" exactly as
    // xname_core:1435 already assumes — treating it as 0 here named a freshly
    // made Amulet of Yendor "an Amulet of Yendor" (seed0373 step 99).
    if (obj == null) return false;
    if (obj.dknown != null && !obj.dknown) return false;
    const known = !!obj.known;
    if (obj.otyp === FAKE_AMULET_OF_YENDOR_OTYP && !known) return true; /* lie */
    return !!objects[obj.otyp]?.oc_unique
        && (known || obj.otyp === AMULET_OF_YENDOR);
}
// C ref: eat.c is_edible(obj) — for a non-polymorphed hero this reduces to a
// non-unique FOOD_CLASS object (the metallivore/gelatinous-cube arms need a
// polymorphed youmonst, which the itemactions menu never has here).
function is_edible_ia(obj) {
    if (!obj || objects[obj.otyp]?.oc_unique) return false;
    return obj.oclass === FOOD_CLASS;
}
// C ref: do_wear.c armcat_to_wornmask() + wearmask_to_obj() — the piece already
// occupying the slot this armor would go into, or null when it is free.
function worn_in_slot_of(obj) { return worn_slot_get(armor_slot_mask(obj)); }
// C ref: iactions.c ia_checkfile(otmp) — gates the '/' line on the object's
// singular xname having a data.base entry (pager.c ia_checkfile()).
function ia_checkfile(otmp) { return ia_checkfile_name(cxname_singular(otmp)); }

function itemactions_list(otmp) {
    const out = [];
    const add = (act, accel, label) => out.push({ act, accel, label });
    const oclass = otmp.oclass;
    const already_worn = (otmp.owornmask & (W_ARMOR | W_ACCESSORY)) !== 0;
    const quan = otmp.quan || 1;

    // '-' (un-wield / un-ready): C ref iactions.c:291 — picking the wielded,
    // alternate or quivered item offers the "wield bare hands" shortcut.  This
    // arm was missing entirely, so every menu opened on a wielded weapon was one
    // line short.
    if (otmp === game.uwep || otmp === game.uswapwep || otmp === game.uquiver) {
        const quiv = otmp === game.uquiver;
        const what = (oclass === WEAPON_CLASS || is_weptool(otmp)) ? 'weapon' : 'item';
        add(IA_UNWIELD, '-', `${quiv ? 'Quiver' : 'Wield'} '-' to ${
            quiv ? 'un-ready' : 'un-wield'} ${is_plural(otmp) ? 'these' : 'this'} ${
            is_plural(otmp) ? makeplural(what) : what}`);
    }
    // 'a' (apply): C ref iactions.c:309 — one long if/else-if cascade, so the
    // FIRST matching arm wins.  Was left empty ("no session reaches it"), which
    // dropped the line for every tool, container, wand and potion.
    {
        const light = otmp.lamplit ? 'Extinguish' : 'Light';
        let alabel = null;
        if (oclass === COIN_CLASS) alabel = 'Flip a coin';
        else if (otmp.otyp === CREAM_PIE) alabel = 'Hit yourself with this cream pie';
        else if (otmp.otyp === BULLWHIP) alabel = 'Lash out with this whip';
        else if (otmp.otyp === GRAPPLING_HOOK) alabel = 'Grapple something with this hook';
        else if (otmp.otyp === BAG_OF_TRICKS && objects[otmp.otyp]?.oc_name_known)
            alabel = 'Reach into this bag';
        else if (Is_container(otmp)) alabel = 'Open this container';
        else if (otmp.otyp === CAN_OF_GREASE) alabel = 'Use the can to grease an item';
        else if (otmp.otyp === LOCK_PICK || otmp.otyp === CREDIT_CARD
                 || otmp.otyp === SKELETON_KEY) alabel = 'Use this tool to pick a lock';
        else if (otmp.otyp === TINNING_KIT) alabel = 'Use this kit to tin a corpse';
        else if (otmp.otyp === LEASH) alabel = 'Tie a pet to this leash';
        else if (otmp.otyp === SADDLE) alabel = 'Place this saddle on a pet';
        else if (otmp.otyp === MAGIC_WHISTLE || otmp.otyp === TIN_WHISTLE)
            alabel = 'Blow this whistle';
        else if (otmp.otyp === EUCALYPTUS_LEAF) alabel = 'Use this leaf as a whistle';
        else if (otmp.otyp === STETHOSCOPE) alabel = 'Listen through the stethoscope';
        else if (otmp.otyp === MIRROR) alabel = 'Show something its reflection';
        else if (otmp.otyp === BELL || otmp.otyp === BELL_OF_OPENING)
            alabel = 'Ring the bell';
        else if (otmp.otyp === CANDELABRUM_OF_INVOCATION)
            alabel = `${light} the candelabrum`;
        else if (otmp.otyp === WAX_CANDLE || otmp.otyp === TALLOW_CANDLE) {
            const multiple = quan !== 1;
            const sWord = multiple ? 'these' : 'this';
            const cand = carrying(CANDELABRUM_OF_INVOCATION);
            alabel = (cand && (cand.spe | 0) < 7)
                ? `Attach ${sWord} to your candelabrum, or ${
                    !otmp.lamplit ? 'light' : 'extinguish'} ${multiple ? 'them' : 'it'}`
                : `${light} ${sWord} ${simpleonames(otmp)}`;
        } else if (otmp.otyp === OIL_LAMP || otmp.otyp === MAGIC_LAMP
                   || otmp.otyp === BRASS_LANTERN) alabel = `${light} this light source`;
        else if (otmp.otyp === POT_OIL && objects[otmp.otyp]?.oc_name_known)
            alabel = `${light} this oil`;
        else if (oclass === POTION_CLASS)
            alabel = `Dip something into ${is_plural(otmp) ? 'one of these' : 'this'} potion${plur(quan)}`;
        else if (otmp.otyp === EXPENSIVE_CAMERA) alabel = 'Take a photograph';
        else if (otmp.otyp === TOWEL) alabel = 'Clean yourself off with this towel';
        else if (otmp.otyp === CRYSTAL_BALL) alabel = 'Peer into this crystal ball';
        else if (otmp.otyp === MAGIC_MARKER) alabel = 'Write on something with this marker';
        else if (otmp.otyp === FIGURINE) alabel = 'Make this figurine transform';
        else if (otmp.otyp === UNICORN_HORN) alabel = 'Use this unicorn horn';
        else if (otmp.otyp === HORN_OF_PLENTY && objects[otmp.otyp]?.oc_name_known)
            alabel = 'Blow into the horn of plenty';
        else if (otmp.otyp >= WOODEN_FLUTE && otmp.otyp <= DRUM_OF_EARTHQUAKE)
            alabel = 'Play this musical instrument';
        else if (otmp.otyp === LAND_MINE || otmp.otyp === BEARTRAP)
            alabel = 'Arm this trap';
        else if (otmp.otyp === PICK_AXE || otmp.otyp === DWARVISH_MATTOCK)
            alabel = 'Dig with this digging tool';
        else if (oclass === WAND_CLASS) alabel = 'Break this wand';
        if (alabel) add(IA_APPLY_OBJ, 'a', alabel);
    }
    // 'c' / 'C' — C ref iactions.c item_naming_classification(): 'c' names the
    // individual object, 'C' the whole type; each is offered only when the
    // matching getobj filter would SUGGEST the object.  The old code always
    // emitted 'c' with a hand-written label and never emitted 'C'.
    if (name_ok(otmp) === GETOBJ_SUGGEST) {
        const which = the_unique_obj(otmp) ? 'the'
            : !is_plural(otmp) ? 'this specific' : 'this stack of';
        add(IA_NAME_OBJ, 'c', `${(!otmp.oname) ? 'Name' : 'Rename or un-name'} ${
            which} ${simpleonames(otmp)}`);
    }
    if (call_ok(otmp) === GETOBJ_SUGGEST) {
        let callname = simpleonames(otmp);
        if (the_unique_obj(otmp)) callname = `the ${callname}`;
        else if (!is_plural(otmp)) callname = makeplural(callname);
        add(IA_NAME_OTYP, 'C', `${!objects[otmp.otyp]?.oc_uname ? 'Call' : 'Re-call or un-call'
            } the type for ${callname}`);
    }
    // 'd' (drop): any unworn carried object.  C ref: iactions.c:411 —
    // `Sprintf(buf, "Drop this %s", (otmp->quan > 1L) ? "stack" : "item")`.
    if (!already_worn) add(IA_DROP_OBJ, 'd', `Drop this ${quan > 1 ? 'stack' : 'item'}`);
    // 'e' (eat): C ref iactions.c:418 — a TIN gets its own wording, anything
    // else edible gets "Eat this"/"Eat one of these".
    if (otmp.otyp === TIN) {
        add(IA_EAT_OBJ, 'e', `Open ${quan > 1 ? 'one of these tins' : 'this tin'}${
            (game.uwep && game.uwep.otyp === TIN_OPENER) ? ' with your tin opener' : ''
            } and eat the contents`);
    } else if (is_edible_ia(otmp)) {
        add(IA_EAT_OBJ, 'e', `Eat ${quan > 1 ? 'one of these' : 'this'}`);
    }
    // C ref: iactions.c:430-445 — tools have their own engraving actions.
    if (otmp.otyp === TOWEL) {
        add(IA_ENGRAVE_OBJ, 'E', 'Wipe the floor with this towel');
    } else if (otmp.otyp === MAGIC_MARKER) {
        add(IA_ENGRAVE_OBJ, 'E', 'Scribble graffiti on the floor');
    } else if (oclass === WEAPON_CLASS || oclass === WAND_CLASS
        || oclass === RING_CLASS || oclass === GEM_CLASS) {
        const tough = (oclass === GEM_CLASS || oclass === RING_CLASS)
            && objects[otmp.otyp]?.oc_tough;
        const verb = (is_blade(otmp) || oclass === WAND_CLASS || tough)
            ? 'Engrave' : 'Write';
        // C ref: iactions.c:440 — "... with one of these items" for a stack.
        add(IA_ENGRAVE_OBJ, 'E', `${verb} on the ${surface_underfoot()} with ${
            quan > 1 ? 'one of these items' : 'this item'}`);
    }
    // 'f' (fire the quivered item): C ref iactions.c:448.
    if (otmp === game.uquiver) {
        const shoot = ammo_and_launcher(otmp, game.uwep);
        add(IA_FIRE_OBJ, 'f', `${shoot ? 'Shoot' : 'Throw'} ${
            quan > 1 ? 'one of these' : 'this'}${
            shoot ? ` with your wielded ${simpleonames(game.uwep)}` : ''}`);
    }
    // 'i' (adjust inventory letter): any non-coin object.
    if (oclass !== COIN_CLASS) {
        add(IA_ADJUST_OBJ, 'i', 'Adjust inventory by assigning new letter');
    }
    // 'I' (split a stack): C ref iactions.c:468 — `otmp->quan > 1L &&
    // otmp->oclass != COIN_CLASS`, labelled "Adjust inventory by splitting this
    // stack" (the old text was invented).
    if (quan > 1 && oclass !== COIN_CLASS)
        add(IA_SPLIT_OBJ, 'I', 'Adjust inventory by splitting this stack');
    // 'P' (put on accessory): C ref iactions.c:497 — an unworn accessory always
    // gets a line; when the slot is taken the line is a "[...]" note that does
    // nothing (C keeps it so the command stays discoverable).
    if (!already_worn) {
        let plabel = '';
        if (oclass === AMULET_CLASS)
            plabel = !game.uamul ? 'Put this amulet on' : '[already wearing an amulet]';
        else if (oclass === RING_CLASS || otmp.otyp === MEAT_RING)
            plabel = (!game.uleft || !game.uright) ? 'Put this ring on'
                : `[both ring ${makeplural(body_part(3 /*FINGER*/))} in use]`;
        else if (otmp.otyp === BLINDFOLD || otmp.otyp === TOWEL
                 || otmp.otyp === LENSES)
            plabel = game.ublindf ? '[already wearing eyewear]'
                : otmp.otyp === LENSES ? 'Put these lenses on'
                    : `Put this on${otmp.otyp === TOWEL ? ' to blindfold yourself' : ''}`;
        if (plabel) add(IA_WEAR_OBJ, 'P', plabel);
    }
    // 'q' (quaff): C ref iactions.c:527.
    if (oclass === POTION_CLASS)
        add(IA_QUAFF_OBJ, 'q', `Quaff (drink) ${
            quan > 1 ? 'one of these potions' : 'this potion'}`);
    // 'Q' (quiver): C ref iactions.c:534.
    if ((oclass === GEM_CLASS || oclass === WEAPON_CLASS) && otmp !== game.uquiver)
        add(IA_QUIVER_OBJ, 'Q', `Quiver this ${quan > 1 ? 'stack' : 'item'
            } for easy ${ammo_and_launcher(otmp, game.uwep) ? 'shooting' : 'throwing'
            } with 'f'ire`);
    // 'r' (read): C ref iactions.c:543 — `if (item_reading_classification(otmp,
    // buf) == IA_READ_OBJ) ia_addmenu(..., 'r', buf)`.  The whole arm was
    // missing, so a spellbook's action menu lost its "Study this spellbook"
    // line (and every line below it moved up a row).
    {
        const rlabel = item_reading_classification(otmp);
        if (rlabel) add(IA_READ_OBJ, 'r', rlabel);
    }
    // 'R' (remove accessory / rub): C ref iactions.c:547.
    if ((otmp.owornmask || 0) & W_ACCESSORY) {
        const m = otmp.owornmask || 0;
        add(IA_TAKEOFF_OBJ, 'R', `Remove this ${
            (m & W_AMUL) ? 'amulet'
            : (m & (W_RINGL | W_RINGR)) ? 'ring'
              : (m & W_BLINDF) ? 'eyewear' : 'accessory'}`);
    }
    if (otmp.otyp === OIL_LAMP || otmp.otyp === MAGIC_LAMP
        || otmp.otyp === BRASS_LANTERN)
        add(IA_RUB_OBJ, 'R', `Rub this ${simpleonames(otmp)}`);
    else if (oclass === GEM_CLASS
             && (otmp.otyp === LOADSTONE || otmp.otyp === FLINT
                 || (otmp.otyp >= 470 /* LUCKSTONE */ && otmp.otyp <= 472 /* TOUCHSTONE */)))
        add(IA_RUB_OBJ, 'R', 'Rub something on this stone'); /* is_graystone() */
    // 't' (throw): any unworn object.  C ref: iactions.c:562 — the verb is
    // "Shoot" when the wielded launcher matches, the object phrase varies with
    // quantity, and a quivered item notes that 't' duplicates 'f'.
    if (!already_worn) {
        const shoot = ammo_and_launcher(otmp, game.uwep);
        const what = (quan === 1) ? 'this item'
            : (otmp.otyp === GOLD_PIECE) ? 'them' : 'one of these';
        const dup = (otmp === game.uquiver
                     && (otmp.otyp !== GOLD_PIECE || quan === 1))
            ? " (same as 'f')" : '';
        add(IA_THROW_OBJ, 't', `${shoot ? 'Shoot' : 'Throw'} ${what}${dup}`);
    }
    // 'T' (take off armor / tip a container): C ref iactions.c:589.
    if ((otmp.owornmask || 0) & W_ARMOR)
        add(IA_TAKEOFF_OBJ, 'T', 'Take off this armor');
    if ((Is_container(otmp) && (Has_contents(otmp) || !otmp.cknown))
        || (otmp.otyp === HORN_OF_PLENTY && ((otmp.spe | 0) > 0 || !otmp.known)))
        add(IA_TIP_CONTAINER, 'T', 'Tip all the contents out of this container');
    // 'V' (invoke): C ref iactions.c:597 — an un-IDed fake Amulet, any
    // artifact, any unique object, or a (non-artifact) crystal ball.
    if ((otmp.otyp === FAKE_AMULET_OF_YENDOR_OTYP && !otmp.known)
        || otmp.oartifact || objects[otmp.otyp]?.oc_unique
        || otmp.otyp === CRYSTAL_BALL)
        add(IA_INVOKE_OBJ, 'V', 'Try to invoke a unique power of this object');
    // 'w' (wield): C ref iactions.c:606 — a weapon/weptool/wet towel/iron ball
    // is wielded "as your weapon"; the tin opener gets its own advice; anything
    // else unworn is wielded "in your <hands>".  Skipped for the wielded item.
    if (otmp !== game.uwep && !(nohands_youmonst() || verysmall_youmonst())) {
        const stack = quan > 1 ? 'stack' : 'item';
        if (oclass === WEAPON_CLASS || is_weptool(otmp) || is_wet_towel(otmp)
            || otmp.otyp === HEAVY_IRON_BALL_OTYP)
            add(IA_WIELD_OBJ, 'w', `Wield this ${stack} as your weapon`);
        else if (otmp.otyp === TIN_OPENER)
            add(IA_WIELD_OBJ, 'w', 'Wield the tin opener to easily open tins');
        else if (!already_worn)
            // body_part index 6 == HAND (humanoid hero); makeplural -> "hands".
            add(IA_WIELD_OBJ, 'w', `Wield this ${stack} in your ${makeplural(body_part(6))}`);
    }
    // 'W' (wear armor): C ref iactions.c:631 — always offered for unworn armor;
    // when that slot is occupied the line is an inert "[already wearing ...]".
    if (!already_worn && oclass === ARMOR_CLASS) {
        const occupied = worn_in_slot_of(otmp);
        add(IA_WEAR_OBJ, 'W', occupied
            ? `[already wearing ${an(armor_simple_name(occupied))}]`
            : 'Wear this armor');
    }
    // 'x' (swap primary/secondary weapon): C ref iactions.c:652.
    if (otmp === game.uwep && game.uswapwep)
        add(IA_SWAPWEAPON, 'x', 'Swap this with your alternate weapon');
    else if (otmp === game.uwep)
        add(IA_SWAPWEAPON, 'x', 'Ready this as an alternate weapon');
    else if (otmp === game.uswapwep)
        add(IA_SWAPWEAPON, 'x', 'Swap this with your main weapon');
    // 'X' (toggle two-weapon combat): C ref iactions.c:672.
    if (twoweapon_action_ok(otmp))
        add(IA_TWOWEAPON, 'X', `Toggle two-weapon combat ${game.u?.twoweap ? 'off' : 'on'}`);
    // 'z' (zap a wand): C ref iactions.c:686.
    if (oclass === WAND_CLASS)
        add(IA_ZAP_OBJ, 'z', 'Zap this wand to release its magic');
    // '/' (look up in the database): C ref iactions.c:691 — "about these" for a
    // stack.  ia_checkfile() gates it on the object having a data.base entry.
    if (ia_checkfile(otmp))
        add(IA_WHATIS_OBJ, '/', `Look up information about ${quan > 1 ? 'these' : 'this'}`);
    return out;
}

// C ref: iactions.c item_reading_classification(obj, outbuf) — the label for
// the 'r' item-action, or null when the object can't be read.
const FORTUNE_COOKIE = 289, T_SHIRT = 137, ALCHEMY_SMOCK = 144,
    SPE_BLANK_PAPER = 407, SCR_MAIL_OTYP = 364;
function item_reading_classification(obj) {
    const otyp = obj.otyp;
    if (otyp === FORTUNE_COOKIE) return 'Read the message inside this cookie';
    if (otyp === T_SHIRT) return 'Read the slogan on the shirt';
    if (otyp === ALCHEMY_SMOCK) return 'Read the slogan on the apron';
    if (otyp === HAWAIIAN_SHIRT) return 'Look at the pattern on the shirt';
    if (obj.oclass === SCROLL_CLASS) {
        // C ref: iactions.c:100-106 (MAIL_STRUCTURES: SCR_MAIL never says it)
        const magic = (obj.dknown
                       && otyp !== SCR_MAIL_OTYP
                       && (otyp !== SCR_BLANK_PAPER
                           || !objects[otyp]?.oc_name_known))
            ? ' to activate its magic' : '';
        return `Read this scroll${magic}`;
    }
    if (obj.oclass === SPBOOK_CLASS) {
        const novel = otyp === SPE_NOVEL;
        const blank = otyp === SPE_BLANK_PAPER && !!objects[otyp]?.oc_name_known;
        const tome = otyp === SPE_BOOK_OF_THE_DEAD && !!objects[otyp]?.oc_name_known;
        const verb = (novel || blank) ? 'Read' : tome ? 'Examine' : 'Study';
        const what = novel ? simpleonames(obj) : tome ? 'tome' : 'spellbook';
        return `${verb} this ${what}`;
    }
    return null;
}

// Render the itemactions "Do what with %s?" submenu as a tty overlay menu (the
// query is the inverse-video title at row 0, then a blank row, the action lines,
// and "(end)").  C ref: win/tty/wintty.c finalize NHW_MENU — offx is computed
// from the widest line; the map shows through below/outside the menu band.
function renderItemActionsMenu(otmp, entries) {
    const display = game.nhDisplay;
    if (!display?.clearScreen) return;
    const title = `Do what with ${on_the(cxname(otmp))}?`;
    const itemLines = entries.map((e) => `${e.accel} - ${e.label}`);
    const lines = [title, '', ...itemLines, '(end)'];
    // C ref: win/tty/wintty.c tty_end_menu — cw->maxcol = widest entry's
    // strlen()+2 ("extra space at beg & end"); tty_display_nhwindow NHW_MENU then
    // sets the window offset.  The recorder build defines H2344_BROKEN
    // (wintty.c tty_display_nhwindow): offx = min(min(82, cols/2),
    // cols - maxcol - 1), so a narrow menu sits at column 40, not flush right.
    let maxcol = 0;
    for (const ln of lines) maxcol = Math.max(maxcol, ln.length + 2);
    if (maxcol > 80) maxcol = 80;
    const cols = display.cols ?? 80;
    let offx = Math.min(Math.min(82, Math.floor(cols / 2)), cols - maxcol - 1);
    if (offx < 0) offx = 0;
    // C ref: process_menu_window draws each row as tty_curs(win,1,r) + a leading
    // putchar(' ') then the entry text, so the text starts at screen column
    // offx+1 (the leading space occupies offx).
    const textx = offx + 1;
    game._menuOffx = offx;

    display.clearScreen();
    render_map_to_grid();
    // C ref: process_menu_window's cl_end() blanks [offx, cols) on every menu row
    // (the leading-space column included); the map shows through only to the LEFT.
    // A tall menu reaches the status rows too: C clears [offx, cols) on EVERY
    // row it occupies, so the status line survives only to the left of offx.
    for (let r = 0; r < lines.length && r < (display.rows ?? 24); r++)
        for (let c = offx; c < cols; c++)
            display.setCell(c, r, ' ', NO_COLOR, 0);
    let row = 0;
    // Row 0: the query title, drawn with the menu prompt style (= menu_headings,
    // ATR_INVERSE).
    for (let c = 0; c < title.length && textx + c < 80; c++)
        display.setCell(textx + c, row, title[c], NO_COLOR, menuHeadAttr());
    row++;
    display.putstr(textx, row++, '', NO_COLOR, 0); // blank separator row
    for (const ln of itemLines) display.putstr(textx, row++, ln, NO_COLOR, 0);
    const endRow = row;
    display.putstr(textx, row, '(end)', NO_COLOR, 0);
    // C ref: win/tty/wintty.c erase_menu_or_text — dismissing the full-screen
    // (offx==0) inventory menu that preceded this submenu ran docrt(), whose cls()
    // blanked the status window and only set disp.botlx (no bot() has redrawn it),
    // so the status lines stay blank until a turn passes.  An overlay-menu
    // (offx>0) dismiss used docorner() and left the status intact.
    if (game._botl_blanked) {
        for (let c = 0; c < cols; c++) {
            display.setCell(c, 22, ' ', NO_COLOR, 0);
            display.setCell(c, 23, ' ', NO_COLOR, 0);
        }
    } else {
        // The menu this submenu replaced wrecked the status window's tail on
        // the way out (docorner's cl_end from its own left edge) and nothing
        // redrew it; inherit that cutoff instead of painting a fresh full
        // status the real terminal never emitted.  _statusTruncCol covers both
        // status rows, _statusTrunc22 only the first.
        putStatusLines(display, offx, lines.length - 1);
        const cut22 = (game._statusTruncCol != null) ? game._statusTruncCol
                                                     : game._statusTrunc22;
        if (cut22 != null) {
            putStatusRow(display, 1, 22, cut22);
            for (let c = cut22; c < cols; c++) display.setCell(c, 22, ' ', NO_COLOR, 0);
        }
        if (game._statusTruncCol != null) {
            putStatusRow(display, 2, 23, game._statusTruncCol);
            for (let c = game._statusTruncCol; c < cols; c++)
                display.setCell(c, 23, ' ', NO_COLOR, 0);
        }
    }
    // C tty parks the cursor just past the "(end)" prompt (textx + 5 + 1).
    display.setCursor(textx + '(end)'.length + 1, endRow);
    game._modal_screen = 'itemactions';
}


// C ref: iactions.c itemactions(otmp) — show the "Do what with %s?" PICK_ONE
// submenu, block until the player picks a valid action accelerator (invalid
// keys ring the bell and keep the menu shown — each blocking read is captured as
// its own recorded frame), then run the chosen command.  Always returns the
// chosen command's ECMD result (or ECMD_OK when cancelled), since the 'i'
// command itself elapses no time.  getDir is threaded through for the Throw
// action (whose dothrow needs the direction prompt) without a cmd<->invent
// import cycle.
async function itemactions(otmp, getDir) {
    const entries = itemactions_list(otmp);
    // Selectable accelerators (an IA_NONE placeholder like "[both ring fingers
    // in use]" is shown but not selectable — pressing its key rings the bell).
    const sel = new Map();
    for (const e of entries) if (e.act !== IA_NONE) sel.set(e.accel, e);
    // C ref: wintty.c process_menu_window — a digit starts a count (a leading 0
    // does not), ESC while counting only stops the count, and any acceptable
    // key resets it.  Keys outside the response set (resp[]: selectors, digits,
    // ESC, space/CR/LF, menu commands) are swallowed by xwaitforspace() with a
    // bell and never reach the switch, so they leave the count alone.  The count
    // has no effect on a PICK_ONE choice.
    let counting = false, count = 0;
    for (;;) {
        renderItemActionsMenu(otmp, entries);
        const c = await nhgetch();
        const ch = String.fromCharCode(c);
        if (!sel.has(ch) && !(c >= 48 && c <= 57) && c !== 27 && c !== 13
            && c !== 10 && c !== 32 && !'<>^|.-@,\\~:'.includes(ch)) continue;
        if (c >= 48 && c <= 57) {
            count = count * 10 + (c - 48);
            if (count !== 0) counting = true;
            else counting = false;
            continue;
        }
        if (c === 27 && counting) { counting = false; count = 0; continue; }
        counting = false; count = 0;
        if (c === 27) { // ESC: cancel — no action, no time
            delete game._modal_screen;
            return ECMD_OK;
        }
        // MENU_SEARCH: PICK_ONE finishes on the first selectable line matching.
        if (c === 58) {
            const { hooked_tty_getlin, pmatchi } = await import('./extcmd-handlers.js');
            const reply = await hooked_tty_getlin('Search for:', null);
            if (!reply || reply[0] === '\x1b') continue;
            const hit = entries.find((e) => e.act !== IA_NONE
                && pmatchi(`*${reply}*`, `${e.accel} - ${e.label}`));
            if (!hit) continue;
            await dismiss_invent_screen();
            return await itemactions_dispatch(otmp, hit.act, getDir);
        }
        // Return/Enter commits with nothing selected -> cancel.  C ref
        // wintty.c process_menu_window: ' ' on the last (here only) page
        // finishes the menu the same way.
        if (c === 13 || c === 10 || c === 32) {
            delete game._modal_screen;
            return ECMD_OK;
        }
        const chosen = sel.get(ch);
        if (!chosen) continue; // invalid selector: bell, menu stays (re-render)
        // C: the menu is torn down (erase_menu_or_text) and moveloop's
        // flush_screen()/bot() runs before the canned command executes.
        await dismiss_invent_screen();
        return await itemactions_dispatch(otmp, chosen.act, getDir);
    }
}

// C ref: iactions.c itemactions_pushkeys(otmp, act) — push the chosen action's
// command (function + the object's invlet) onto the canned command queue, then
// itemactions returns ECMD_OK so the queued command runs next.  Here we run the
// command directly, pre-seeding the object's invlet at the FRONT of the input
// queue so the command's getobj() consumes it before any further player keys
// (the cmdq_add_key equivalent).
async function itemactions_dispatch(otmp, act, getDir) {
    // C ref: itemactions_pushkeys — push the object's invlet onto the canned
    // command queue so the dispatched command's getobj() consumes it silently.
    const seedInvlet = () => cmdq_add_key(CQ_CANNED, obj_to_let(otmp));
    switch (act) {
    case IA_NAME_OBJ:
        seedInvlet();
        await name_inventory_object();
        return ECMD_OK;
    case IA_NAME_OTYP:
        seedInvlet();
        await call_inventory_object();
        return ECMD_OK;
    case IA_DROP_OBJ:
        seedInvlet();
        return (await dodrop()) ? ECMD_TIME : ECMD_OK;
    case IA_THROW_OBJ:
        seedInvlet();
        return await dothrow(getDir ?? (await import('./cmd.js')).getdir);
    case IA_WIELD_OBJ:
        seedInvlet();
        return await dowield();
    case IA_WEAR_OBJ: // 'P' put-on routes through dowear (unified wear/put-on)
        seedInvlet();
        return await dowear();
    case IA_READ_OBJ: {
        // C ref: itemactions_pushkeys IA_READ_OBJ -> cmdq_add_ec(doread).
        seedInvlet();
        const rd = await import('./read.js');
        return await rd.doread();
    }
    case IA_ENGRAVE_OBJ: {
        // doengrave lives in engrave.js; load it on demand.  It reads the
        // stylus via getobj, which consumes the pre-seeded invlet.
        seedInvlet();
        const eng = await import('./engrave.js');
        return await eng.doengrave();
    }
    case IA_TWOWEAPON: {
        // C ref: itemactions_pushkeys IA_TWOWEAPON -> cmdq_add_ec(dotwoweapon).
        const { dotwoweapon } = await import('./wield.js');
        return await dotwoweapon();
    }
    case IA_INVOKE_OBJ: {
        // C ref: itemactions_pushkeys IA_INVOKE_OBJ -> cmdq_add_ec(doinvoke)
        // with the object's invlet pushed ahead of it for getobj().
        seedInvlet();
        const { doinvoke } = await import('./artifact.js');
        const r = await doinvoke();
        // artifact.js numbers ECMD_TIME 4; this module's is 1.
        return (r === 4) ? ECMD_TIME : ECMD_OK;
    }
    case IA_ADJUST_OBJ:
        seedInvlet();
        return await doorganize();
    // C ref: iactions.c itemactions_pushkeys() — every remaining action queues
    // its command (and the object's invlet) on CQ_CANNED; here the command is
    // run directly with the invlet pre-seeded, as the cases above do.
    case IA_UNWIELD: {
        // C: dowield / remarm_swapwep / dowieldquiver depending on which slot
        // the object fills, each answered with HANDS_SYM.
        cmdq_add_key(CQ_CANNED, HANDS_SYM);
        if (otmp === game.uwep) return await dowield();
        if (otmp === game.uswapwep) {
            const { remarm_swapwep } = await import('./do_wear.js');
            return (await remarm_swapwep()) === 3 ? ECMD_TIME : ECMD_OK;
        }
        if (otmp === game.uquiver) return await dowieldquiver();
        return ECMD_OK; /* donull */
    }
    case IA_APPLY_OBJ: {
        seedInvlet();
        const { doapply, ECMD: AECMD } = await import('./apply.js');
        return (await doapply()) === AECMD.ECMD_TIME ? ECMD_TIME : ECMD_OK;
    }
    case IA_DIP_OBJ: {
        // C: #altdip (dip_into) — the potion is the first getobj answer.
        seedInvlet();
        const { dip_into } = await import('./potion.js');
        return (await dip_into()) === 1 ? ECMD_TIME : ECMD_OK;
    }
    case IA_EAT_OBJ: {
        // C: starts with the m-prefix so floor food is ignored.
        seedInvlet();
        const { doeat } = await import('./eat.js');
        const iflags = game.iflags || (game.iflags = {});
        iflags.menu_requested = true;
        try { return (await doeat()) ? ECMD_TIME : ECMD_OK; }
        finally { iflags.menu_requested = false; }
    }
    case IA_FIRE_OBJ:
        return await dofire(getDir ?? (await import('./cmd.js')).getdir);
    case IA_SACRIFICE: {
        seedInvlet();
        const { dosacrifice } = await import('./pray.js');
        return (await dosacrifice()) === 1 ? ECMD_TIME : ECMD_OK;
    }
    case IA_BUY_OBJ:
        seedInvlet();
        return (await dopay()) === ECMD_TIME ? ECMD_TIME : ECMD_OK;
    case IA_QUAFF_OBJ: {
        // C: m-prefix so a fountain/sink here is ignored.
        seedInvlet();
        const { dodrink } = await import('./potion.js');
        const iflags = game.iflags || (game.iflags = {});
        iflags.menu_requested = true;
        try { return (await dodrink()) ? ECMD_TIME : ECMD_OK; }
        finally { iflags.menu_requested = false; }
    }
    case IA_QUIVER_OBJ:
        seedInvlet();
        return (await dowieldquiver()) === ECMD_TIME ? ECMD_TIME : ECMD_OK;
    case IA_RUB_OBJ: {
        seedInvlet();
        const { dorub, ECMD: AECMD } = await import('./apply.js');
        return (await dorub()) === AECMD.ECMD_TIME ? ECMD_TIME : ECMD_OK;
    }
    case IA_TAKEOFF_OBJ:
        seedInvlet();
        return (await ia_dotakeoff()) === ECMD_TIME ? ECMD_TIME : ECMD_OK;
    case IA_TIP_CONTAINER: {
        // C: m-prefix to skip floor containers.
        seedInvlet();
        const { dotip } = await import('./extcmd-handlers.js');
        const iflags = game.iflags || (game.iflags = {});
        iflags.menu_requested = true;
        try { return (await dotip()) === 1 ? ECMD_TIME : ECMD_OK; }
        finally { iflags.menu_requested = false; }
    }
    case IA_SWAPWEAPON:
        return (await doswapweapon()) === ECMD_TIME ? ECMD_TIME : ECMD_OK;
    case IA_ZAP_OBJ: {
        seedInvlet();
        const { dozap } = await import('./zap.js');
        return (await dozap()) ? ECMD_TIME : ECMD_OK;
    }
    case IA_WHATIS_OBJ: {
        // C: dowhatis with 'i' (item from inventory) and the invlet queued ->
        // checkfile(singular(obj, xname), chkfilUsrTyped|chkfilDontAsk).
        await flush_screen(1);
        await checkfile(cxname_singular(otmp), 1 | 2);
        return ECMD_OK;
    }
    default:
        return ECMD_OK;
    }
}

// C ref: wintty.c process_menu_window() MENU_SEARCH.  Search all selectable
// rows, not just the current page, and return the first case-insensitive match.
async function search_inventory_menu(rows, byLet) {
    const { hooked_tty_getlin, pmatchi } = await import('./extcmd-handlers.js');
    const reply = await hooked_tty_getlin('Search for:', null);
    if (!reply || reply[0] === '\x1b') return null;

    const pattern = `*${reply}*`;
    for (const [, ...items] of rows) {
        for (const text of items) {
            const obj = byLet.get(text[0]);
            if (obj && pmatchi(pattern, text)) return obj;
        }
    }
    return null;
}

// C ref: invent.c display_pickinv() -> select_menu(PICK_ONE).  The three
// inventory callers differ after a pick, but share paging and menu commands.
async function select_inventory_menu(rows, byLet) {
    let page = 0;
    let repaint = true;
    let info = null;
    // C ref: wintty.c:1564-1615 — digits build a count (a leading zero is
    // ignored); ESC while counting only stops the count.  Keys outside the
    // menu's response string are swallowed by xwaitforspace() without
    // re-entering the loop, so they leave a pending count alone.
    let count = 0, counting = false;
    for (;;) {
        if (repaint) info = renderInventoryMenu(rows, page);
        repaint = true;
        const c = await nhgetch();
        if (c >= 48 && c <= 57) {
            count = count * 10 + (c - 48);
            counting = count !== 0;
            repaint = false;
            continue;
        }
        if (c === 27 && counting) {
            count = 0; counting = false;
            repaint = false;
            continue;
        }
        const keptCount = count, keptCounting = counting;
        count = 0; counting = false;
        // C ref: win/tty/wintty.c process_menu_window() — ' ' and MENU_NEXT_PAGE
        // ('>') advance a page; ' ' on the last page finishes the menu, '>' does
        // not.  MENU_PREVIOUS_PAGE ('<'), MENU_FIRST_PAGE ('^') and
        // MENU_LAST_PAGE ('|') move pages and never finish.
        if ((c === 32 || c === 62) && info.multipage && page < info.pages - 1) {
            page++;
            continue;
        }
        if (c === 62) { repaint = false; continue; }
        if (c === 60) {
            if (page > 0) { page--; continue; }
            repaint = false; continue;
        }
        if (c === 94) {
            if (page !== 0) { page = 0; continue; }
            repaint = false; continue;
        }
        if (c === 124) {
            if (info.multipage && page !== info.pages - 1) { page = info.pages - 1; continue; }
            repaint = false; continue;
        }
        if (c === 27 || c === 32 || c === 13 || c === 10) {
            game._invmenu_esc = (c === 27);   /* display_inventory() == '\033' */
            await dismiss_invent_screen();
            return null;
        }

        const ch = String.fromCharCode(c);
        // C wintty.c:1650-1699 consumes selection commands even for PICK_ONE,
        // resetting a pending count without selecting anything.
        if ('.-@,\\~'.includes(ch)) {
            repaint = false;
            continue;
        }
        if (ch === ':') {
            const cursor = game.nhDisplay?.getCursor?.();
            const picked = await search_inventory_menu(rows, byLet);
            if (picked) {
                delete game._modal_screen;
                return picked;
            }
            /* hooked_tty_getlin() ends with clear_nhwindow(WIN_MESSAGE). */
            for (let x = 0; x < game.nhDisplay.cols; x++)
                game.nhDisplay.setCell(x, 0, ' ', NO_COLOR, 0);
            if (cursor) game.nhDisplay.setCursor(cursor[0], cursor[1]);
            repaint = false;
            continue;
        }

        // C ref: wintty.c:1753 — direct selectors apply only to this page.
        if (!info.lines.some(line => !line.header && line.text[0] === ch)) {
            count = keptCount; counting = keptCounting;
            repaint = false;
            continue;
        }
        const picked = byLet.get(ch);
        if (!picked) { count = keptCount; counting = keptCounting; repaint = false; continue; }
        delete game._modal_screen;
        return picked;
    }
}

// C ref: invent.c dispinv_with_action(lets, use_inuse_ordering, alt_label) —
// show the inventory and, when it was a PICK_ONE menu (lets==NULL for the 'i'
// command), call itemactions() on the selected object.  The interactive menu
// blocks reading keys (each blocking read is captured as its own recorded
// frame); pressing an item's invlet selects it (PICK_ONE finishes immediately),
// space/return/ESC dismiss without a selection, and an invalid key rings the
// bell and keeps the menu shown.  Returns the chosen command's ECMD result.
export async function dispinv_with_action(lets = null, use_inuse_ordering = false, alt_label = null, getDir = null) {
    const len = lets ? String(lets).length : 0;
    const menumode = (len !== 1) || !!game.iflags?.menu_requested;
    if (!menumode) {
        // len==1 (e.g. dopramulet on a single letter): a one-line message_menu
        // display, no item selection.  Keep the existing non-interactive render.
        display_inventory(lets, false);
        return ECMD_OK;
    }
    // Build the selectable inventory; empty -> "Not carrying anything."
    // C ref: invent.c dispinv_with_action() sets flags.sortloot = 'i', which
    // display_pickinv() reads as inuse_only (its own headings + ordering).
    const rows = use_inuse_ordering ? inuseRows(lets, alt_label)
                                    : inventoryRows(lets);
    if (!rows.length) {
        await renderMessageOnMap(note_topl('Not carrying anything.'));  // pline(): lands in the ^P history
        return ECMD_OK;
    }
    // Map every displayed invlet to its object so a selection resolves to an item.
    const byLet = new Map();
    for (const obj of inventoryArray())
        if (!lets || String(lets).includes(obj.invlet)) byLet.set(obj.invlet, obj);

    const otmp = await select_inventory_menu(rows, byLet);
    return otmp ? await itemactions(otmp, getDir) : ECMD_OK;
}

// C ref: end.c disclose() 'i' branch — `(void) display_inventory((char *) 0,
// TRUE); container_contents(...)`.  want_reply=TRUE but the caller discards
// the result, so this is the same paginated PICK_ONE display+page loop as
// dispinv_with_action, minus the itemactions() follow-up: any dismiss key
// (space on the last page / return / ESC) or a valid invlet selection just
// closes the menu with no further effect.
export async function display_inventory_interactive(lets = null) {
    const rows = inventoryRows(lets);
    if (!rows.length) {
        await renderMessageOnMap(note_topl('Not carrying anything.'));  // pline(): lands in the ^P history
        return;
    }
    const byLet = new Map();
    for (const obj of inventoryArray())
        if (!lets || String(lets).includes(obj.invlet)) byLet.set(obj.invlet, obj);
    game._invmenu_esc = false;
    const picked = await select_inventory_menu(rows, byLet);
    if (picked) {
        /* C ref: wintty.c tty_select_menu -> tty_destroy_nhwindow ->
           erase_menu_or_text(): picking an entry tears the menu down (docrt()
           for a full-width one) exactly as ESC does. */
        game._modal_screen = 'invent';
        await dismiss_invent_screen();
    }
    /* C: display_inventory(lets, TRUE) yields '\033' when the menu was ESC'd */
    return game._invmenu_esc ? '\x1b' : '';
}

// Render the selectable inventory.  When the content fits one page it is a tty
// overlay (offx computed from the widest line, "(end)" footer); when it overflows
// it becomes a full-screen paged menu with an "(N of M)" footer.  C ref:
// win/tty/wintty.c finalize NHW_MENU + process_menu_window paging.  Returns
// {multipage, pages, lines}, with lines restricted to the displayed page.
function renderInventoryMenu(rows, page = 0) {
    // Flatten rows into menu lines, tagging class headers (ATR_INVERSE).
    // C ref: windows.c add_menu_heading() — suppresses the highlight
    // (attr = ATR_NONE) during end-of-game disclosure (program_state.gameover).
    const headerAttr = game.program_state?.gameover ? 0 : (menuHeadAttr());
    const lines = [];
    const syms = objSymsShown(rows);
    for (const group of rows) {
        const [heading, ...items] = group;
        if (heading != null) lines.push({ text: heading, attr: headerAttr, header: true });
        items.forEach((it, i) => {
            const sym = syms && group.syms?.[i + 1];
            lines.push({ text: sym ? it.slice(0, 2) + sym.ch + it.slice(3) : it, attr: 0,
                         symColor: sym ? sym.color : undefined });
        });
    }
    const display = game.nhDisplay;
    if (!display?.clearScreen) return { multipage: false, pages: 1, lines };
    const totalRows = display.rows ?? 24;
    const perPage = totalRows - 1; // 23 content lines, footer on the last row
    const multipage = lines.length > perPage;
    // C ref: win/tty/wintty.c — a paged menu is a full-screen window (offx==0);
    // dismissing it runs docrt(), which blanks the status window (see
    // renderItemActionsMenu).  A single-page menu is an overlay (offx>0) whose
    // dismiss uses docorner() and leaves the status intact.
    game._botl_blanked = multipage;
    if (multipage) {
        game._menuDismissSweep = null;
        game._menuOffx = 0; /* offx == 0: dismissal runs docrt() */
        // Full-screen paged menu: footer "(N of M)".
        const pages = Math.ceil(lines.length / perPage);
        const curPage = Math.max(0, Math.min(page, pages - 1));
        // C ref: wintty.c:2729-2733 — menu strings are cut to cols - 2.
        const pageLines = lines.slice(curPage * perPage, curPage * perPage + perPage)
            .map((ln) => (ln.text.length > (display.cols ?? 80) - 2
                ? { ...ln, text: ln.text.slice(0, (display.cols ?? 80) - 2) } : ln));
        display.clearScreen();
        let row = 0;
        // C ref: win/tty/wintty.c process_menu_window() — each row's leading
        // pad column is an unconditional plain putchar(' ') BEFORE the attr
        // toggle for the entry text, so a header's ATR_INVERSE never covers
        // that column (draw it separately, never as part of `ln.text`).
        for (const ln of pageLines) {
            display.putstr(0, row, ' ', NO_COLOR, 0);
            display.putstr(1, row, ln.text, NO_COLOR, ln.attr || 0);
            if (ln.symColor !== undefined)
                display.setCell(3, row, ln.text[2],
                                (ln.symColor === CLR_GRAY || ln.symColor === 0) ? NO_COLOR : ln.symColor, 0);
            row++;
        }
        const footer = `(${curPage + 1} of ${pages})`;
        // C ref: win/tty/wintty.c process_menu_window — the footer/morestr sits
        // right after the current page's own content (tty_curs(..., page_lines)),
        // not a fixed row; a short last page places it above row 23.
        const footerRow = pageLines.length;
        // C ref: win/tty/wintty.c process_menu_window/dmore — the menu "(N of M)"
        // morestr is indented one column (like the menu item lines), unlike a
        // full-screen text window's "--More--" which starts at column 0.
        const footerCol = 1;
        display.putstr(footerCol, footerRow, footer, NO_COLOR, 0);
        display.setCursor(footerCol + footer.length, footerRow);
        game._modal_screen = 'invent';
        return { multipage: true, pages, lines: pageLines };
    }
    // Single page: overlay via the existing renderer (map shows through).
    renderMenuScreen(rows, null);
    return { multipage: false, pages: 1, lines };
}

export async function ddoinv(getDir = null) {
    return await dispinv_with_action(null, false, null, getDir);
}

// C ref: pager.c do_look() case 'i' — display_inventory(NULL, TRUE) as a
// PICK_ONE menu, then singular(pickedobj, xname) for the data.base lookup key.
// Renders the interactive inventory (each blocking read is a recorded frame),
// returns the picked item's singular name (checkfile strips BUC/enchant/"(...)"
// prefixes so the type name is what matters), or null on empty/cancel.
export async function whatis_pick_inventory() {
    const rows = inventoryRows(null);
    if (!rows.length) {
        await renderMessageOnMap(note_topl('Not carrying anything.'));  // pline(): lands in the ^P history
        return null;
    }
    const byLet = new Map();
    for (const obj of inventoryArray()) byLet.set(obj.invlet, obj);
    const picked = await select_inventory_menu(rows, byLet);
    return picked ? cxname_singular(picked) : null;
}

export function find_unpaid(list, last_found) {
    for (const obj of iterateObjects(list)) {
        if (obj.unpaid) {
            if (last_found?.obj) {
                if (obj === last_found.obj) last_found.obj = null;
            } else {
                if (last_found) last_found.obj = obj;
                return obj;
            }
        }
        if (Has_contents(obj)) {
            const found = find_unpaid(obj.cobj, last_found);
            if (found) return found;
        }
    }
    return null;
}

export function free_pickinv_cache() { game.cached_pickinv_win = WIN_ERR; }

// C ref: invent.c display_pickinv():3341-3363 — "default for force_invmenu is
// a menu listing likely candidates; add '*' for 'list all' as an extra choice
// unless the menu already includes everything; when reissuing the menu after
// player has picked '*', add '?' for 'list likely candidates' to reverse
// that." Factored out so getobj_menu() can add the same synthetic letter to
// its own accept-set.
function force_invmenu_special(lets, allowxtra = false, usextra = false) {
    if (!game.flags?.force_invmenu) return null;
    if (lets !== null && lets !== undefined && !String(lets).length) lets = null; // display_pickinv(): `if (lets && !*lets) lets = 0`
    if ((allowxtra && !usextra) || (lets && lets.length < inventoryArray().length))
        return { ch: '*', text: '(list everything)' };
    if (!lets)
        return { ch: '?', text: '(list likely candidates)' };
    return null;
}

export function display_pickinv(lets = null, xtra_choice = null, query = null, allowxtra = false, want_reply = false, out_cnt = null) {
    // C ref: invent.c display_pickinv():3084 `usextra = (xtra_choice &&
    // allowxtra);` — the "Miscellaneous / - - <hands>" row getobj()'s '?'/'*'
    // menu draws when hands is a reachable answer (getobj_menu()'s own
    // caller computes xtra_choice/allowxtra; this port's only OTHER caller,
    // display_inventory(), always passes null/false, so this is a no-op there).
    const usextra = !!(xtra_choice && allowxtra);
    // C ref: invent.c display_pickinv():3146 — "oxymoron? temporarily assign
    // permanent inventory letters": with 'nofixinv' every inventory listing
    // re-letters the pack in list order first.
    reassign_if_nofixinv();
    // C ref: invent.c display_pickinv():3130-3170 — `n` only distinguishes 0, 1
    // and "more"; with exactly one item of interest and no reply wanted the
    // listing is a plain pline() (tty_message_menu PICK_NONE), not a menu.
    // (want_reply's PICK_ONE message_menu variant is not reproduced here.)
    {
        const inv = inventoryArray();
        let n = lets ? String(lets).length : (!inv.length ? 0 : inv.length === 1 ? 1 : 2);
        if (usextra || (n === 1 && !lets)) ++n;
        if (n === 1 && !want_reply && !game.flags?.force_invmenu
            && !game.iflags?.menu_requested) {
            const otmp = inv.find((o) => !lets || o.invlet === String(lets)[0]);
            if (otmp) prinv(null, otmp, 0);
            if (out_cnt) out_cnt.value = -1;
            return '\0';
        }
    }
    const rows = inventoryRows(lets);
    if (usextra) rows.unshift(['Miscellaneous', `${HANDS_SYM} - ${xtra_choice}`]);
    const special = want_reply ? force_invmenu_special(lets, allowxtra, usextra) : null;
    if (special) rows.push(['Special', `${special.ch} - ${special.text}`]);
    // C ref: invent.c display_pickinv() end_menu(win, query) -> wintty.c
    // tty_end_menu(): the prompt becomes the first line, followed by a blank.
    if (rows.length && query) rows.unshift([query, '']);
    if (!rows.length) {
        // Narrow fix (not update_topl): display_pickinv() is sync and called
        // from several other files (end.js, pager.js) that would all need an
        // await cascade to route this through update_topl properly.  Setting
        // toplin=1 alongside the write is enough for the many *other*
        // generic `if (game._toplin === 1) topl_more()` command epilogues
        // elsewhere to still page a still-pending earlier message correctly.
        game._pending_message = note_topl('Not carrying anything.');
        game._toplin = 1;
        return '\0';
    }
    // Pass null EXPLICITLY, not nothing: renderMenuScreen's default parameter is
    // itself a hardcoded [36, 8], and only an explicit null reaches the derived
    // tty position (offx + len("(end)") + 1, on the (end) row).  This used to
    // pass a hardcoded [38, 20] for the seed8000 Tourist fingerprint.
    renderInventoryMenu(rows, 0);
    if (out_cnt) out_cnt.value = -1;
    return '\0';
}

export function display_inventory(lets = null, want_reply = false) {
    return display_pickinv(lets, null, null, false, want_reply, null);
}

export function repopulate_perminvent() { display_pickinv(null, null, null, false, false, null); }
// C ref: invent.c display_used_invlets() — PICK_ONE menu "Inventory letters
// used:" listing every carried item (except `avoidlet`) in inventory-list
// order, grouped by class when flags.sortpack is on.  Returns the picked
// letter, '\033' when cancelled, '\0' when nothing was picked.
export async function display_used_invlets(avoidlet) {
    const inv = inventoryArray();
    if (!inv.length) return '\0';
    const rows = [['Inventory letters used:', '']];
    const byLet = new Map();
    const entry = (obj) => {
        obj_to_glyph(obj);
        byLet.set(obj.invlet, obj);
        return `${obj.invlet} - ${doname_invent(obj)}`;
    };
    if (flags().sortpack === false) {
        const group = [null];
        for (const obj of inv) if (obj.invlet !== avoidlet) group.push(entry(obj));
        if (group.length > 1) rows.push(group);
    } else {
        for (const oclass of classOrder()) {
            const items = inv.filter((obj) => obj.invlet !== avoidlet && obj.oclass === oclass);
            if (items.length)
                rows.push([let_to_name(oclass, false, false), ...items.map(entry)]);
        }
    }
    game._invmenu_esc = false;
    const picked = await select_inventory_menu(rows, byLet);
    if (picked) {
        game._modal_screen = 'invent';
        await dismiss_invent_screen();
        return picked.invlet;
    }
    return game._invmenu_esc ? '\x1b' : '\0';
}

export function count_unpaid(list) { let n = 0; for (const obj of iterateObjects(list)) { if (obj.unpaid) ++n; if (Has_contents(obj)) n += count_unpaid(obj.cobj); } return n; }
export function count_buc(list, type, filterfunc = null) {
    let n = 0;
    for (const obj of iterateObjects(list)) {
        /* priests always know bless/curse state (set BEFORE the filter) */
        if (Role_if(PM_CLERIC)) obj.bknown = (obj.oclass !== COIN_CLASS) ? 1 : 0;
        if (filterfunc && !filterfunc(obj)) continue;
        /* coins are either uncursed or unknown, per flags.goldX */
        if (obj.oclass === COIN_CLASS) {
            if (type === (flags().goldX ? BUC_UNKNOWN : BUC_UNCURSED)) ++n;
            continue;
        }
        const actual = !obj.bknown ? BUC_UNKNOWN : obj.blessed ? BUC_BLESSED : obj.cursed ? BUC_CURSED : BUC_UNCURSED;
        if (actual === type) ++n;
    }
    return n;
}

export function tally_BUCX(list, by_nexthere, bcp, ucp, ccp, xcp, ocp, jcp) {
    bcp.value = ucp.value = ccp.value = xcp.value = ocp.value = jcp.value = 0;
    for (const obj of iterateObjects(list, by_nexthere)) {
        if (obj.pickup_prev) ++jcp.value;
        if (!obj.bknown) ++xcp.value;
        else if (obj.blessed) ++bcp.value;
        else if (obj.cursed) ++ccp.value;
        else ++ucp.value;
    }
}

export function count_contents(container, nested, quantity, everything, _newdrop) {
    let count = 0;
    for (const obj of iterateObjects(container?.cobj)) {
        if (nested && Has_contents(obj)) count += count_contents(obj, nested, quantity, everything, false);
        if (everything || obj.unpaid) count += quantity ? (obj.quan || 1) : 1;
    }
    return count;
}

export async function dounpaid(count, floorcount, buriedcount) {
    void floorcount; void buriedcount;
    if (!count) await update_topl("You aren't carrying any unpaid objects.");
}

export function this_type_only(obj) {
    const typ = game.this_type;
    if (typ === 'P') return !!obj.pickup_prev;
    if ('BUCX'.includes(String(typ))) {
        if (obj.oclass === COIN_CLASS) return typ === (flags().goldX ? 'X' : 'U');
        if (typ === 'B') return obj.bknown && obj.blessed;
        if (typ === 'U') return obj.bknown && !obj.blessed && !obj.cursed;
        if (typ === 'C') return obj.bknown && obj.cursed;
        if (typ === 'X') return !obj.bknown;
    }
    return obj.oclass === typ;
}

/* invent.c dotypeinv() — the 'I' command: itemize one class (or one BUC
   category) of inventory, then run itemactions() on the chosen object. */
export async function dotypeinv() {
    const prompt = 'What type of object do you want an inventory of?';
    let c = '\0', i = 0, before = '', after = '', title = '';
    let traditional = true;
    /* C: `boolean billx = *u.ushops && doinvbill(0)`.  doinvbill() (the shop's
       used-up list) is not ported, and outside a shop C's test is FALSE too. */
    const billx = false;
    const doI_done = () => { game.this_type = 0; game.this_title = null; return ECMD_OK; };

    game.this_type = 0;
    game.this_title = null;
    const invent = inventoryArray();
    if (!invent.length && !billx) {
        await pline("You aren't carrying anything.");
        return doI_done();
    }
    const u_carried = count_unpaid(invent);
    const u_floor = count_unpaid(game.level?.objects);
    const u_buried = count_unpaid(game.level?.buriedobjlist);
    const any_unpaid = u_carried + u_floor + u_buried;
    const bc = { value: 0 }, uc = { value: 0 }, cc = { value: 0 },
          xc = { value: 0 }, oc = { value: 0 }, jc = { value: 0 };
    tally_BUCX(invent, false, bc, uc, cc, xc, oc, jc);

    if (menu_style() !== MENU_TRADITIONAL) {
        if (menu_style() === MENU_FULL || menu_style() === MENU_PARTIAL) {
            traditional = false;
            i = UNPAID_TYPES;
            if (billx) i |= BILLED_TYPES;
            if (bc.value) i |= BUC_BLESSED_F;
            if (uc.value) i |= BUC_UNCURSED_F;
            if (cc.value) i |= BUC_CURSED_F;
            if (xc.value) i |= BUC_UNKNOWN_F;
            if (jc.value) i |= JUSTPICKED;
            i |= INCLUDE_VENOM;
            /* PICK_ONE, and neither ALL_TYPES nor CHOOSE_ALL: no 'A'
               auto-select entry, no 'a - All types', so the first object
               class takes accelerator 'a'. */
            const picks = await query_category_menu(prompt, invent, i, PICK_ONE);
            /* C: query_category() destroys its window before returning, so the
               map is back under any message the branches below print. */
            await dismiss_invent_screen();
            if (!picks.length) return doI_done();
            game.this_type = c = picks[0].a_int;
        }
    }
    let types = '';
    if (traditional) {
        /* collect the classes carried, for use as the prompt's response set */
        const tbuf = { buf: '' };
        let class_count = collect_obj_classes(tbuf, invent, false, null, null);
        types = tbuf.buf;
        if (any_unpaid || billx || (bc.value + cc.value + uc.value + xc.value) !== 0
            || jc.value) { types += ' '; class_count++; }
        if (any_unpaid) { types += 'u'; class_count++; }
        if (billx) { types += 'x'; class_count++; }
        if (bc.value) { types += 'B'; class_count++; }
        if (uc.value) { types += 'U'; class_count++; }
        if (cc.value) { types += 'C'; class_count++; }
        if (xc.value) { types += 'X'; class_count++; }
        if (jc.value) { types += 'P'; class_count++; }
        /* everything not already included, after an ESC the user never sees;
           strchr(types, c) > strchr(types, ESC) is C's "not really carried" */
        let extra = '\x1b';
        if (!any_unpaid) extra += 'u';
        if (!billx) extra += 'x';
        if (!bc.value) extra += 'B';
        if (!uc.value) extra += 'U';
        if (!cc.value) extra += 'C';
        if (!xc.value) extra += 'X';
        if (!jc.value) extra += 'P';
        for (let k = 0; k < MAXOCLASSES; k++) {
            const sym = def_oc_syms[k]?.sym;
            if (sym && !types.includes(sym) && !extra.includes(sym)) extra += sym;
        }
        types += extra;
        if (class_count > 1) {
            c = await y_n(prompt, types, '\0');
            if (c === '\0' || c === '\x1b') return doI_done();
        } else if (any_unpaid) c = 'u';
        else if (billx) c = 'x';
        else c = types.charAt(0);
    }
    if (c === 'x' || (c === 'X' && billx && !xc.value)) {
        await pline(`No used-up objects${any_unpaid ? ' on your shopping bill' : ''}.`);
        return doI_done();
    }
    if (c === 'u' || (c === 'U' && any_unpaid && !uc.value)) {
        if (any_unpaid) await dounpaid(u_carried, u_floor, u_buried);
        else await pline('You are not carrying any unpaid objects.');
        return doI_done();
    }

    const oclass = 'BUCXP'.includes(String(c)) ? c : def_char_to_objclass(c);
    switch (c) {
    case 'B': before = 'known to be blessed '; break;
    case 'U': before = 'known to be uncursed '; break;
    case 'C': before = 'known to be cursed '; break;
    case 'X': after = ' whose blessed/uncursed/cursed status is unknown'; break;
    case 'P': after = ' that were just picked up'; break;
    default: before = 'such '; break;
    }
    if (traditional) {
        if (types.indexOf(String(c)) > types.indexOf('\x1b')) {
            await pline(`You have no ${before}objects${after}.`);
            return doI_done();
        }
        game.this_type = oclass;
    }
    if ('BUCXP'.includes(String(c))) {
        /* before/after are mutually exclusive, so either serves as a suffix */
        title = `Items ${before || after}`.replace(/\s+/g, ' ').replace(/\s+$/, '') + ':';
        game.this_title = title;
    }

    const picks = await query_objlist_menu(null, invent,
        ((flags().invlet_constant !== false ? USE_INVLET : 0)
         | INVORDER_SORT | INCLUDE_VENOM), PICK_ONE, this_type_only);
    if (picks.length) {
        await dismiss_invent_screen();
        await itemactions(picks[0].obj);
    } else {
        await dismiss_invent_screen();
    }
    return doI_done();
}

// C ref: stairs.c stairs_description() — describe a staircase/ladder.  Only the
// cases the recorded sessions need are ported: an ordinary staircase, and the
// special level-1 up-stairs phrasing ("staircase up out of the dungeon").
function stairs_description(sway, stcase = true) {
    const stairs = sway.isladder ? 'ladder' : (stcase ? 'staircase' : 'stairs');
    const updown = sway.up ? 'up' : 'down';
    const uz = game.u?.uz || {};
    // C ref: stairs.c stairs_description() — a stairway the hero has already
    // used names its destination; one that crosses into another dungeon branch
    // names the branch.  Ours only ever said "staircase down".
    const known_branch = !!(sway.tolev && sway.tolev.dnum !== uz.dnum && sway.u_traversed);
    if (!known_branch) {
        let out = `${stairs} ${updown}`;
        if (sway.u_traversed) out += ` to level ${depth_of_level(sway.tolev)}`;
        return out;
    }
    if (uz.dnum === 0 && uz.dlevel === 1 && sway.up && !game.u?.uhave?.amulet) {
        // Up-stairs from dungeon level one: out of the dungeon.
        return `${stairs} ${updown} out of the dungeon`;
    }
    const dname = String(game.dungeons?.[sway.tolev.dnum]?.dname || '').replace(/^The /, 'the ');
    return `branch ${stairs} ${updown} to ${dname}`;
}

// C ref: insight.c align_str().
function align_str(a) {
    return a === A_CHAOTIC ? 'chaotic' : a === A_NEUTRAL ? 'neutral'
        : a === A_LAWFUL ? 'lawful' : a === A_NONE ? 'unaligned' : 'unknown';
}

// C ref: invent.c:4075 dfeature_at()'s IS_ALTAR arm — "%saltar to %s (%s)" from
// a_gname() and align_str().  The altarmask lives in struct rm's flags union
// (rm.h: `#define altarmask flags`), and this port writes it under BOTH names
// (mklev.js mkaltar/mktemple use loc.flags; sp_lev.js's builders use
// loc.altarmask), so read either.  align_gname() indexes the roles[] ARRAY, not
// the PM_ mnum — they differ for Rogue/Ranger — hence the findIndex.
function altar_description(loc) {
    const amask = loc.altarmask ?? loc.flags ?? 0;
    const align = Amask2align(amask & ~AM_SHRINE);
    const rolemnum = game.urole?.mnum ?? game.u?.umonnum ?? 0;
    const ri = roles.findIndex((r) => r.mnum === rolemnum);
    const gname = align_gname(ri >= 0 ? ri : rolemnum, align);
    return `${(amask & AM_SANCTUM) ? 'high ' : ''}altar to ${gname} (${align_str(align)})`;
}

// C ref: pager.c:614 ice_descr(x, y, outbuf) — "ice" (or "frozen <liquid>") when
// the spot is far away or unseen, otherwise a thickness word from the
// MELT_ICE_AWAY timer ("solid" when no timer is running) plus the water name.
export function ice_descr(x, y) {
    const u = game.u;
    const r = (u?.xray_range > 2) ? u.xray_range : 2;
    const neardist = (r * r) * 2 - r;
    const dx = (u?.ux ?? 0) - x, dy = (u?.uy ?? 0) - y;
    const at_hero = dx === 0 && dy === 0;
    const lev = game.level?.at?.(x, y);
    if (lev?.typ !== ICE) return `[ice:${lev?.typ}?]`;
    if (dx * dx + dy * dy > neardist
        || (!cansee(x, y) && (!at_hero || u?.uprops?.Levitation))) {
        return waterbody_name_for_ice(x, y);
    }
    const time_left = spot_time_left(x, y, MELT_ICE_AWAY);
    const rating = !time_left ? 0 : time_left > 1000 ? 1 : time_left > 100 ? 2
        : time_left > 50 ? 3 : time_left > 14 ? 4 : 5;
    return `${['solid', 'sturdy', 'steady', 'unsteady', 'thin', 'slushy'][rating]} ${waterbody_name_for_ice(x, y)}`;
}

// C ref: invent.c:4224 look_here() — "molten lava", "iron bars", plain and
// thawing ice ("ice", "solid ice", "thin ice", "frozen <liquid>") take no
// article; everything else gets an().
export function dfeature_article(dfeature) {
    const sp = dfeature.indexOf(' ');
    if (dfeature === 'molten lava' || dfeature === 'iron bars' || dfeature === 'ice'
        || dfeature.startsWith('frozen ')
        || (sp >= 0 && dfeature.slice(sp).toLowerCase() === ' ice'))
        return dfeature;
    return an(dfeature);
}

// C ref: invent.c dfeature_at() — the dungeon feature at (x,y).  Ports the
// staircase/ladder branch (via game.stairs) used by look_here on the dungeon
// entrance, then falls back to the cell's typName for other features.
export function dfeature_at(x, y, buf = '') {
    let feature = null;
    {
        // C ref: invent.c dfeature_at — terrain features named via defsyms
        // explanations.  Altars still fall through to loc.typName below.
        const loc = game.level?.at?.(x, y);
        const ltyp = loc?.typ;
        let stway = null;
        for (let s = game.stairs; s && !stway; s = s.next)
            if (s.sx === x && s.sy === y) stway = s;
        // C ref: invent.c dfeature_at IS_DOOR branch — describe a door by its
        // doormask (exact-value switch, as in C): a doorway (D_NODOOR), open
        // door (D_ISOPEN), broken door (D_BROKEN), else closed door.
        if (IS_DOOR(ltyp)) {
            switch (loc.doormask) {
            case D_NODOOR: feature = 'doorway'; break;
            case D_ISOPEN: feature = 'open door'; break;
            case D_BROKEN: feature = 'broken door'; break;
            default: feature = 'closed door'; break;
            }
        }
        else if (IS_FOUNTAIN(ltyp)) feature = 'fountain';
        else if (IS_THRONE(ltyp)) feature = 'opulent throne';
        else if (ltyp === LAVAPOOL || ltyp === LAVAWALL) feature = 'molten lava';
        else if (ltyp === ICE) feature = ice_descr(x, y);
        else if (ltyp === POOL || ltyp === MOAT || ltyp === WATER) feature = 'pool of water';
        else if (IS_SINK(ltyp)) feature = 'sink';
        // C ref: invent.c:4075 — ALTAR sits between SINK and the stairway arm.
        else if (IS_ALTAR(ltyp)) feature = altar_description(loc);
        // C ref: invent.c:4081 — the stairway arm comes AFTER the door/fountain/
        // throne/water/sink/altar arms (a wizard-mode wished-for fountain on a
        // staircase square is described as the fountain).
        else if (stway) feature = stairs_description(stway, true);
        else if (ltyp === DRAWBRIDGE_DOWN) feature = 'lowered drawbridge';
        else if (ltyp === DBWALL) feature = 'raised drawbridge';
        else if (IS_GRAVE(ltyp)) feature = 'grave';
        else if (ltyp === TREE) feature = 'tree';
        else if (ltyp === IRONBARS) feature = 'set of iron bars';
        else if (loc?.typName) feature = loc.typName;
    }
    if (Array.isArray(buf)) buf[0] = feature || '';
    return feature;
}

// C ref: mkmaze.c waterbody_name() — the non-hallucinating name of a body of
// water at (x,y).  Only the ordinary dungeon variants describe_decor() needs
// are modelled (special-level "shallow sea"/"swamp"/"pond" and hallucinated
// liquids are not); a plain POOL is "pool of water", a MOAT is a "moat".
function decor_waterbody_name(ltyp) {
    if (ltyp === MOAT) return 'moat';
    if (ltyp === WATER) return 'water';
    return 'pool of water';
}

// C ref: pickup.c describe_decor() — the 'mention_decor' option.  When the hero
// walks onto a dungeon feature (door/water/fountain/altar/stairs/&c.) that is
// not covered by an object, announce it even though nothing was picked up.
// mention_decor is turned on only by the tutorial (dat/tut-1.lua), so this is a
// no-op elsewhere.  Prints "There is <a feature> here." (flags.verbose is the
// default) and records iflags.prev_decor so the same terrain type isn't
// re-announced on the next consecutive step (furniture is exempt from that
// de-duplication, matching IS_FURNITURE).  Returns TRUE like the C routine.
export async function describe_decor() {
    const x = game.u?.ux, y = game.u?.uy;
    const loc = game.level?.at?.(x, y);
    // C SURFACE_AT(x,y): the surface terrain; == levl[][].typ off a drawbridge
    // (the only drawbridge-up case is not reached on the mention_decor level).
    const ltyp = loc ? loc.typ : STONE;
    let dfeature = dfeature_at(x, y);
    const doorhere = !!dfeature && (dfeature === 'open door' || dfeature === 'doorway');
    const waterhere = !!dfeature && dfeature === 'pool of water';
    // C: "we don't mention 'ordinary' doors but do mention broken ones (and
    // closed ones, which will only happen for Passes_walls)".  Underwater and
    // the ice-over-pool transition also suppress the feature.
    if (doorhere || game.Underwater) dfeature = null;

    const prevDecor = game.iflags?.prev_decor ?? STONE;
    // C ref: pickup.c describe_decor() returns `res`, which is FALSE on this
    // same-terrain arm.  check_here() feeds the result to look_here() as
    // LOOKHERE_SKIP_DFEATURE, so an unconditional TRUE suppressed the
    // "There is <feature> here." line that nothing had actually printed.
    let res = true;
    if (ltyp === prevDecor && !IS_FURNITURE(ltyp)) {
        res = false; /* same terrain as last mentioned and not furniture */
    } else if (dfeature) {
        if (waterhere) dfeature = decor_waterbody_name(ltyp);
        // C: an() unless it's "swamp" or the ice descriptions (which self-name).
        if (dfeature !== 'swamp' && ltyp !== ICE) dfeature = an(dfeature);
        // C ref: pickup.c describe_decor() — !verbose drops the frame entirely
        // and just capitalises the feature: "A fountain." for "There is a
        // fountain here."  Length matters as much as text: the short form fits
        // beside a pending topline and merges onto it, the long one doesn't and
        // forces a --More--.
        const decorMsg = (game.flags?.verbose === false)
            ? `${dfeature.charAt(0).toUpperCase()}${dfeature.slice(1)}.`  /* upstart() */
            : `There is ${dfeature} here.`;
        // update_topl, not pline: C's pline() pages an unacknowledged topline,
        // and this message routinely lands on one (moveloop_preamble()'s
        // pickup(1) arrives while the moon-phase greeting is still pending).
        // update_topl() only more()s a HARD-pending line (game._toplin);
        // making it also more() any pline()'d line globally cost -119 public
        // (seed0014), so C's "doesn't fit, so page it" rule (topl.c
        // update_topl():257) is applied only at this one call site.
        const pend = game._pending_message || '';
        // A HARD-pending line (game._toplin) is paged by update_topl() itself;
        // paging it here as well put up a second --More-- (b3 fz23 step 40).
        if (!game._winStop && pend && game._toplinSoft === pend && game._toplin !== 1
            && decorMsg.length + pend.length + 3 >= 80 - 8)
            await topl_more();
        await update_topl(decorMsg);
    } else if (!game.Underwater) {
        // C ref: pickup.c describe_decor():411 — no feature to announce at
        // the new spot; if the PREVIOUS spot was a pool/lava/ice and this one
        // isn't (and something else, e.g. lookat()'s own room message, hasn't
        // already announced the resurfacing), announce coming back down.
        if (IS_POOL_TYP(prevDecor) || prevDecor === LAVAPOOL || prevDecor === LAVAWALL
            || prevDecor === ICE) {
            if (game.last_msg !== PLNMSG_BACK_ON_GROUND) {
                const { back_on_ground } = await import('./trap.js');
                await back_on_ground(false);
            }
        }
    }
    game.iflags = game.iflags || {};
    game.iflags.prev_decor = game.flags?.mention_decor ? ltyp : STONE;
    return res;
}

// Floor objects at (x,y), topmost first.  C ref: svl.level.objects[x][y] is a
// nexthere linked list with the most-recently-placed object on top; the flat
// game.level.objects array is scanned and the last match treated as topmost.
export function objects_at(x, y) {
    const objs = game.level?.objects;
    if (!Array.isArray(objs)) return [];
    const here = [];
    for (const o of objs) if (o.where === OBJ_FLOOR && o.ox === x && o.oy === y) here.unshift(o);
    return here; // topmost (last placed) first
}

// C ref: invent.c look_here() — report the feature, engraving and floor objects.
// A single object follows the engraving; a pile's menu precedes it.
export async function look_here(obj_cnt = 0, lookhere_flags = 0) {
    const x = game.u?.ux, y = game.u?.uy;
    const here = objects_at(x, y);
    const otmp = here[0] || null;
    let dfeature = dfeature_at(x, y);
    const verb = Blind_for_wear() ? 'feel' : 'see';
    const picked_some = (lookhere_flags & LOOKHERE_PICKED_SOME) !== 0;
    // C ref: invent.c look_here():4117 — skip 'dfeature' when the caller already
    // showed it via describe_decor() (pickup.c check_here() sets this).
    const skip_dfeature = (lookhere_flags & LOOKHERE_SKIP_DFEATURE) !== 0;
    if (skip_dfeature) dfeature = null;
    // C ref: invent.c look_here():4122-4161 — engulfed: look at the engulfer's
    // stomach contents instead of the floor.
    if (game.u?.uswallow) {
        const mtmp = game.u.ustuck;
        const { mon_nam } = await import('./do_name.js');
        const { mbodypart } = await import('./monmove.js');
        const where = `${s_suffix(mon_nam(mtmp))} ${mbodypart(mtmp, STOMACH)}`;
        const blind = Blind_for_wear();
        await update_topl(`You ${blind ? 'try' : 'look around'} to ${verb} what is lying in ${where}.`);
        const minv = mtmp?.minvent || [];
        if (minv.length) {
            for (const o of minv)
                if (o.otyp === CORPSE) await feel_cockatrice(o, false);
            display_minventory(mtmp, 0, `${blind ? 'You feel' : ''}:`);
        } else {
            await update_topl(`You ${verb} no objects here.`);
        }
        return blind ? ECMD_TIME : ECMD_OK;
    }

    // C ref: invent.c look_here():4121 — default pile_limit is 5; 0 means
    // "never skip".  A pile at or over the limit is summarised
    // ("There are several objects here.") instead of being listed.
    //
    const pile_limit = flags().pile_limit ?? 5;
    const skip_objects = LOOKHERE_PILE_LIMIT
        && pile_limit > 0 && obj_cnt >= pile_limit;

    // C ref: invent.c look_here():4162 — before ANYTHING else (even the blind
    // grope), a gas cloud and/or an already-seen trap under the hero is
    // announced.  Only the trap half is modelled: visible_region_at() (gas
    // clouds) has no port.  Without this a ':' on a trap with objects on it
    // went straight to the "Things that are here:" window and lost C's
    // "There is an arrow trap here.--More--" frame.
    if (!skip_objects) {
        const { visible_region_at, reg_damg } = await import('./region.js');
        const reg = visible_region_at(x, y);
        const regbuf = reg ? `a ${reg_damg(reg) ? 'poison gas' : 'vapor'} cloud` : '';
        let trap = trap_at_hero();
        if (trap && !trap.tseen) trap = null;
        if (reg || trap) {
            const { trap_explanation } = await import('./trap.js');
            await update_topl(`There is ${regbuf}${(reg && trap) ? ' and ' : ''}${
                trap ? an(trap_explanation(trap.ttyp)) : ''} here.`);
        }
    }

    // C ref: invent.c:4185-4217 — unreachable objects aren't felt or inspected.
    if (Blind_for_wear()) {
        const { can_reach_floor } = await import('./engrave.js');
        if (dfeature && dfeature.startsWith('altar ')) {
            await update_topl('You try to feel what is here.');
        } else {
            const surf = surface(x, y);
            const drift = Is_airlevel() || Is_waterlevel();
            const where = drift ? 'floating here'
                : !can_reach_floor(true) ? 'lying beneath you'
                : `lying here on the ${surf}`;
            await update_topl(`You try to feel what is ${where}.`);
            if (dfeature && !drift && dfeature === surf) dfeature = null;
        }
        const trap = trap_at_hero();
        if (!can_reach_floor(!!(trap && is_pit(trap.ttyp)))) {
            await update_topl("But you can't reach it!");
            return ECMD_OK;
        }
    }

    if (!otmp) {
        // No object: feature (if any), then any engraving, then "no objects"
        // (only when blind or there was no feature to report).
        // C ref: invent.c look_here() !otmp branch — pline1(fbuf); read_engr_at();
        // if (!skip_objects && (Blind || !dfeature)) You("%s no objects here.", verb).
        if (dfeature) await update_topl(`There is ${dfeature_article(dfeature)} here.`);
        await read_engr_at(x, y);
        if (!skip_objects && (Blind_for_wear() || !dfeature))
            await update_topl(`You ${verb} no objects here.`);
        return Blind_for_wear() ? ECMD_TIME : ECMD_OK;
    }
    if (skip_objects) {
        // C ref: invent.c look_here():4249 — too many objects to list.
        if (dfeature) await update_topl(`There is ${dfeature_article(dfeature)} here.`);
        await read_engr_at(x, y);
        if (obj_cnt === 1 && (otmp.quan || 1) === 1)
            await update_topl(`There is ${picked_some ? 'another' : 'an'} object here.`);
        else
            await update_topl(`There are ${(obj_cnt === 2) ? 'two'
                : (obj_cnt < 5) ? 'a few'
                    : (obj_cnt < 10) ? 'several'
                        : 'many'}${picked_some ? ' more' : ''} objects here.`);
        for (const o of here)
            if (o.otyp === CORPSE && will_feel_cockatrice(o, false)) {
                await feel_cockatrice(o, false);
                break;
            }
        return Blind_for_wear() ? ECMD_TIME : ECMD_OK;
    }
    if (here.length === 1) {
        // C reads the engraving between the feature and the object.
        if (dfeature) await update_topl(`There is ${dfeature_article(dfeature)} here.`);
        await read_engr_at(x, y);
        await update_topl(`You ${verb} here ${doname_with_price(otmp)}.`);
        game.last_msg = PLNMSG_ONE_ITEM_HERE;
        return Blind_for_wear() ? ECMD_TIME : ECMD_OK;
    }
    // Multiple objects (and obj_cnt < pile_limit, the default 5).  C ref:
    // invent.c look_here() else-branch — flush WIN_MESSAGE, build a menu window
    // listing every floor object, and show it blocking on --More--:
    //   Sprintf(buf, "%s that %s here:", picked_some ? "Other things" : "Things",
    //           Blind ? "you feel" : "are");
    //   for (otmp...) putstr(tmpwin, 0, doname_with_price(otmp));
    //   display_nhwindow(tmpwin, TRUE);          // pages with --More--
    const header = `${picked_some ? 'Other things' : 'Things'} that ${Blind_for_wear() ? 'you feel' : 'are'} here:`;
    const itemLines = here.map((o) => doname_with_price(o));
    // C ref: invent.c look_here() else-branch — the dfeature line goes INSIDE
    // the menu window (putstr(fbuf); putstr("")), not on the topline.
    const pre = dfeature ? [`There is ${dfeature_article(dfeature)} here.`, ''] : [];
    await renderThingsHereMenu(header, itemLines, pre);
    await read_engr_at(x, y);
    return Blind_for_wear() ? ECMD_TIME : ECMD_OK;
}

// C ref: invent.h LOOKHERE_NOFLAGS / LOOKHERE_PICKED_SOME / LOOKHERE_SKIP_DFEATURE
const LOOKHERE_PICKED_SOME = 1, LOOKHERE_SKIP_DFEATURE = 2;

// look_here()'s pile_limit summary ("There are several objects here.").  It is
// only correct PAIRED with the js/trap.js magic-trap swap from the bare pline()
// setter to update_topl(): C's summary line is what seed0030 step 1605 shows,
// but the --More-- that pages it is fired by the NEXT message, and a bare
// pline() never pages, so the recorded space key would fall through to rhack
// ("Unknown command ' '.").  Enabling this alone measured -1.
const LOOKHERE_PILE_LIMIT = true;

// C ref: win/tty/wintty.c tty_display_nhwindow(NHW_MENU, TRUE) for the
// look_here() "Things that are here:" window.  The recorder consistently
// places this overlay menu at column 41 (offx) with the morestr "--More--"
// on the row right after the last list line and the cursor parked one column
// past it (col 49).  The map shows through outside the menu's column band, so
// lay the map down first and blank only the menu rows from offx rightward.
// Blocks on a quitchar (space/return/ESC); the blocking nhgetch is captured as
// this step's frame.
async function renderThingsHereMenu(header, itemLines, pre = []) {
    // C ref: win/tty/wintty.c tty_display_nhwindow() NHW_MENU branch — before
    // drawing the menu overlay, an unacknowledged top-line message is paged:
    //   if (ttyDisplay->toplin == TOPLINE_NEED_MORE)
    //       tty_display_nhwindow(WIN_MESSAGE, TRUE);   // more() + clear
    // So any pending combat/etc. message (e.g. the pet's attacks during the
    // movemon pass that triggered this look_here) fires a blocking --More--
    // (captured as its own frame) and the message line is cleared before the
    // "Things that are here:" menu is laid down.
    if (game._toplin === 1) {
        await flush_screen(1);
        if (!game._winStop) await topl_more();
        game._pending_message = '';
        game._toplin = 0;
    }
    const display = game.nhDisplay;
    const lines = [...pre, header, ...itemLines];
    // The old flat `41` is only right while every line fits: harvesting all 60
    // "Things that are here:" windows in the public corpus gives offx 41 for
    // widths 21/27/30 and offx 40 for width 39 ("a very heavy iron ball
    // (chained to you)").  Note this is NOT stock wintty.c:1914
    // (max(10, cols-(maxlen+1)-1)), which measured -3 on seed0004 and -2 on
    // seed0012 — the recorder is a custom "MacOS NetHack 5.0.0" build.
    const MENU_OFFX = Math.min(41, (display?.cols ?? 80)
                               - Math.max(...lines.map((l) => l.length)) - 1);
    const moreRow = lines.length;          // row after header + items
    const draw = () => {
        if (!display?.clearScreen) return;
        display.clearScreen();
        render_map_to_grid();
        // C: the tty message window is NOT cleared by the menu overlay, so a
        // surviving topline (getpos()'s last autodescribe) shows through.
        {
            const tl = game._pending_message || '';
            for (let c = 0; c < Math.min(tl.length, display.cols ?? 80); c++)
                display.setCell(c, 0, tl[c], NO_COLOR, 0);
        }
        const cols = display.cols ?? 80;
        // C ref: win/tty/wintty.c process_text_window() — tty_curs(win,1,n) puts
        // the cursor at the window's offx, cl_end() blanks from there to the
        // right margin, and a leading space precedes the text, so the text
        // starts at offx+1 and column offx itself is blank.
        for (let r = 0; r <= moreRow && r < 22; r++)
            for (let c = MENU_OFFX - 1; c < cols; c++)
                if (c >= 0) display.setCell(c, r, ' ', NO_COLOR, 0);
        let row = 0;
        for (const ln of lines)
            display.putstr(MENU_OFFX, row++, ln, NO_COLOR, ATR_NONE);
        display.putstr(MENU_OFFX, moreRow, '--More--', NO_COLOR, ATR_NONE);
        putStatusLines(display);
        display.setCursor(MENU_OFFX + '--More--'.length, moreRow);
    };
    // xwaitforspace(quitchars): read keys until space / return / escape.  Other
    // keys ring the bell and keep the window up (re-render is identical).
    for (;;) {
        draw();
        game._modal_screen = 'thingshere';
        const c = await nhgetch();
        if (xwaitforspace_quit(c)) break;
    }
    delete game._modal_screen;
}

export async function dolook() {
    // C ref: invent.c dolook() — a bare pass-through to look_here(), which
    // already prints everything for every branch (no-object/pile-summary via
    // update_topl, single-object via game._pending_message flushed below,
    // multi-object "Things that are here:" menu via its own overlay with
    // _pending_message explicitly set to '' by renderThingsHereMenu()). A
    // prior fallback to hardcoded 'You see no objects here.' whenever
    // _pending_message was falsy wrongly re-printed that line after the
    // multi-object menu too, even though objects WERE here (shown in the
    // menu, matching a blank row 0 in the real recording).
    const res = await look_here(0, 0);
    if (game._pending_message) await renderMessageOnMap(game._pending_message);
    return res;
}

// C ref: invent.c will_feel_cockatrice() — the petrifying-corpse test is on the
// corpse's OWN species (touch_petrifies(&mons[otmp->corpsenm])); passing null
// meant the predicate could never be true.
export function will_feel_cockatrice(otmp, force_touch) {
    return !!((game.Blind || force_touch) && !game.uarmg && !game.Stone_resistance
        && otmp?.otyp === CORPSE && touch_petrifies(otmp.corpsenm));
}

export async function feel_cockatrice(otmp, force_touch) {
    if (will_feel_cockatrice(otmp, force_touch))
        await (await import('./polyself.js')).instapetrify(`touching ${killer_xname(otmp)} bare-handed`);
}

// C ref: invent.c stackobj() — merge the just-placed floor object with an
// identical pile already on that square (C walks levl[x][y]'s nexthere chain).
// Our floor store is the FLAT game.level.objects array, so the old
// `objects[ox][oy]` lookup was always undefined and the merge never ran; and
// merged() only unlinks the absorbed object from INVENTORY, so the floor array
// needs the splice too.
export function stackobj(obj) {
    if (!obj) return;
    const all = game.level?.objects;
    if (!obj.ox && obj.ox !== 0) return;
    for (const otmp of objects_at(obj.ox, obj.oy)) {
        if (otmp === obj) continue;
        if (merged({ obj }, { obj: otmp })) {
            if (Array.isArray(all)) {
                const ix = all.indexOf(otmp);
                if (ix >= 0) all.splice(ix, 1);
            }
            otmp.where = OBJ_FREE;
            break;
        }
    }
}

export function mergable(otmp, obj) {
    if (!obj || !otmp || obj === otmp || obj.otyp !== otmp.otyp || obj.nomerge || otmp.nomerge) return false;
    // C ref: invent.c mergable():`|| !objects[obj->otyp].oc_merge` — the object
    // TYPE has to be stackable at all.  mkobj.js packs oc_merge as bit 5
    // (F_MERGE) of the row's `flags` word (same accessor zap.js:483 uses).
    if (!(objects[obj.otyp]?.flags & 32 /*F_MERGE*/)) return false;
    if (obj.oclass === COIN_CLASS) return true;
    if (obj.cursed !== otmp.cursed || obj.blessed !== otmp.blessed) return false;
    if (obj.how_lost === LOST_EXPLODING || otmp.how_lost === LOST_EXPLODING) return false;
    if (otmp.how_lost && obj.how_lost !== otmp.how_lost) return false;
    if (obj.globby) return true;
    if (obj.unpaid !== otmp.unpaid || obj.spe !== otmp.spe || !!obj.no_charge !== !!otmp.no_charge
        || obj.obroken !== otmp.obroken || obj.otrapped !== otmp.otrapped || obj.lamplit !== otmp.lamplit
        // C obj.h:139 aliases opoisoned to otrapped; JS stores it separately.
        || !!obj.opoisoned !== !!otmp.opoisoned)
        return false;
    if (obj.oclass === FOOD_CLASS && (obj.oeaten !== otmp.oeaten || obj.orotten !== otmp.orotten)) return false;
    // C ref: invent.c mergable() — the "have they been LOOKED at the same way"
    // block.  Dropping it merged a seen stack into an unseen one (and an eroded
    // item into a pristine one), which changes both the "Things that are here"
    // listing and, when the level is saved to bones, its object count.
    if ((obj.dknown | 0) !== (otmp.dknown | 0)
        || ((obj.bknown | 0) !== (otmp.bknown | 0) && !Role_if(PM_CLERIC)
            && (Blind_for_wear() || Hallucination_hero()))
        || (obj.oeroded | 0) !== (otmp.oeroded | 0)
        || (obj.oeroded2 | 0) !== (otmp.oeroded2 | 0)
        || (obj.greased | 0) !== (otmp.greased | 0))
        return false;
    if (erosion_matters(obj)
        && ((!!obj.oerodeproof) !== (!!otmp.oerodeproof)
            || ((obj.rknown | 0) !== (otmp.rknown | 0)
                && (Blind_for_wear() || Hallucination_hero()))))
        return false;
    if (obj.otyp === CORPSE || obj.otyp === EGG || obj.otyp === TIN)
        if (obj.corpsenm !== otmp.corpsenm) return false;
    /* don't merge surcharged item with base-cost item */
    if (obj.unpaid && !same_price(obj, otmp)) return false;
    /* some additional information is always incompatible */
    if (has_omonst(obj) || has_omid(obj) || has_omonst(otmp) || has_omid(otmp)) return false;
    if (safe_oname(obj) && safe_oname(otmp) && safe_oname(obj) !== safe_oname(otmp)) return false;
    if (has_omailcmd(obj) !== has_omailcmd(otmp) || OMAILCMD(obj) !== OMAILCMD(otmp)) return false;
    if (obj.oartifact !== otmp.oartifact) return false;
    return true;
}

// C ref: invent.c doprgold() — the '$' command.  Reports wallet gold
// (money_cnt over invent, top level only) + any hidden_gold(); flags.verbose
// (the default / covered path) uses the "Your wallet ..." phrasing.  A plain
// pline (not a blocking window), so the following key is a normal command.
export async function doprgold() {
    const umoney = money_cnt_invent();
    const hmoney = hidden_gold(false);
    if (game.flags?.verbose !== false) {
        let buf = umoney ? `Your wallet contains ${umoney} ${currency(umoney)}`
                         : 'Your wallet is empty';
        if (hmoney)
            buf += `, ${umoney ? 'and' : 'but'} you have ${hmoney} `
                 + `${umoney ? 'more' : currency(hmoney)} stashed away in your pack`;
        await pline(`${buf}.`);
    } else {
        const total = umoney + hmoney;
        await pline(total ? `You are carrying a total of ${total} ${currency(total)}.`
                          : 'You have no money.');
    }
    await shopper_financial_report();
    return ECMD_OK;
}

// C ref: invent.c doprwep() — the ')' command (#seeweapon).  Bare hands ->
// empty_handed(); otherwise show the wielded weapon (and offhand when
// two-weaponing) via prinv (a one-item top-line message, tty's single-item
// inventory-query form).
export async function doprwep() {
    if (!game.uwep) {
        await pline(`You are ${empty_handed()}.`);
    } else if (!game.iflags?.menu_requested) {
        prinv(null, game.uwep, 0);
        if (game.u?.twoweap && game.uswapwep) prinv(null, game.uswapwep, 0);
    } else {
        const lets = [game.uwep, game.u?.twoweap ? game.uswapwep : null, game.uquiver]
            .filter(Boolean).map((o) => o.invlet).join('');
        // C: doprwep() itself returns ECMD_OK, but itemactions() queues the chosen
        // command on CQ_CANNED where it runs as its own timed command; this port
        // runs it inline, so its result is passed up for the caller's turn flag.
        return await dispinv_with_action(lets, true, null);
    }
    return ECMD_OK;
}

export function noarmor(report_uskin) {
    game._pending_message = note_topl(report_uskin && game.uskin
        ? `You are not wearing armor but have ${simpleonames(game.uskin)} embedded in your skin.`
        : 'You are not wearing any armor.');
}

// C ref: invent.c doprarm() — the '[' command (#seearmor).  No armor ->
// noarmor(); a single worn piece renders as a one-item top-line message
// ("<let> - <doname> (being worn)."); multiple pieces use the inventory menu.
export async function doprarm() {
    const worn = [game.uarm, game.uarmc, game.uarms, game.uarmh,
                  game.uarmg, game.uarmf, game.uarmu].filter(Boolean);
    if (!worn.length) {
        noarmor(true);
    } else if (worn.length === 1 && !game.iflags?.menu_requested) {
        prinv(null, worn[0], 0);
    } else {
        return await dispinv_with_action(worn.map((o) => o.invlet).join(''), true, null);
    }
    return ECMD_OK;
}

// C ref: invent.c doprring() — the '=' command (#seerings).
export async function doprring() {
    const worn = [game.uright, game.uleft].filter(Boolean);
    if (!worn.length) {
        game._pending_message = note_topl('You are not wearing any rings.');
    } else if (worn.length === 1 && !game.iflags?.menu_requested) {
        prinv(null, worn[0], 0);
    } else {
        return await dispinv_with_action(worn.map((o) => o.invlet).join(''), true,
                                         worn.length === 1 ? 'Ring' : 'Rings');
    }
    return ECMD_OK;
}

// C ref: invent.c dopramulet() — the '"' command (#seeamulet).
export async function dopramulet() {
    if (!game.uamul) {
        game._pending_message = note_topl('You are not wearing an amulet.');
    } else if (!game.iflags?.menu_requested) {
        prinv(null, game.uamul, 0);
    } else {
        return await dispinv_with_action(String(obj_to_let(game.uamul)), true, 'Amulet');
    }
    return ECMD_OK;
}

export function tool_being_used(obj) {
    if (obj?.owornmask & (W_TOOL | W_BLINDF | W_SADDLE)) return true;
    if (obj?.oclass !== TOOL_CLASS) return false;
    return obj === game.uwep || obj.lamplit || (obj.otyp === LEASH && obj.leashmon);
}

// C ref: invent.c doprtool() — the '(' command.  Nothing in use is a one-line
// message; otherwise dispinv_with_action(lets, TRUE, NULL), a PICK_ONE menu
// whose keystrokes belong to the menu rather than to the command parser.
export async function doprtool() {
    const lets = inventoryArray().filter(tool_being_used).map((obj) => obj_to_let(obj)).join('');
    if (!lets) await pline('You are not using any tools.');
    else return await dispinv_with_action(lets, true, null);
    return ECMD_OK;
}

// C ref: invent.c doprinuse() — the '*' command.  Nothing in use gives a
// one-line message; otherwise it is a full PICK_ONE menu whose keystrokes must
// be consumed by the menu, not by the command parser.
export async function doprinuse(getDir = null) {
    if (!inventoryArray().some(is_inuse)) {
        await pline('You are not wearing or wielding anything.');
        return ECMD_OK;
    }
    return await dispinv_with_action(null, true, null, getDir);
}

export function useupf(obj, numused) {
    const used = (obj?.quan || 1) > numused ? splitobj(obj, numused) : obj;
    delobj(used);
    if (u_at(obj?.ox, obj?.oy) && game.u?.uundetected && hides_under(null)) hideunder(null);
}

export function let_to_name(letChar, unpaid = false, showsym = false) {
    const oclass = Number(letChar);
    const className = names[oclass] || (letChar === CONTAINED_SYM ? 'Bagged/Boxed items' : names[ILLOBJ_CLASS]);
    const label = unpaid ? `Unpaid ${className}` : className;
    if (showsym && oclass && def_oc_syms[oclass]) return `${label} ('${def_oc_syms[oclass].sym}')`;
    giState().invbuf = label;
    return label;
}

export function free_invbuf() { giState().invbuf = null; giState().invbufsiz = 0; }

export function reassign() {
    const inv = inventoryArray();
    let gold = null;
    const rest = [];
    for (const obj of inv) {
        if (!gold && obj.oclass === COIN_CLASS) gold = obj;
        else rest.push(obj);
    }
    for (let i = 0; i < rest.length; ++i)
        rest[i].invlet = i < 26 ? String.fromCharCode(97 + i) : i < 52 ? String.fromCharCode(65 + i - 26) : NOINVSYM;
    if (gold) gold.invlet = GOLD_SYM;
    const next = gold ? [gold, ...rest] : rest;
    syncInventory(next);
    glState().lastinvnr = Math.min(rest.length, 51);
}

export function check_invent_gold(why) {
    let goldstacks = 0, wrongslot = 0;
    for (const obj of inventoryArray()) if (obj.oclass === COIN_CLASS) { ++goldstacks; if (obj.invlet !== GOLD_SYM) ++wrongslot; }
    if (goldstacks > 1 || wrongslot) { impossible(`${why}: inventory gold inconsistency`); return true; }
    return false;
}

export function adjust_ok(obj) { return !obj || obj.oclass === COIN_CLASS ? GETOBJ_EXCLUDE : GETOBJ_SUGGEST; }
export function adjust_gold_ok(obj) { return obj ? GETOBJ_SUGGEST : GETOBJ_EXCLUDE; }
export async function doorganize() {
    const inv = inventoryArray();
    if (!inv.length || (inv.length === 1 && inv[0].oclass === COIN_CLASS
        && inv[0].invlet === GOLD_SYM)) {
        game._pending_message = note_topl(`You aren't carrying anything ${inv.length ? 'adjustable' : 'to adjust'}.`);
        return ECMD_OK;
    }
    if (!flags().invlet_constant) reassign();
    const filter = check_invent_gold('adjust') ? adjust_gold_ok : adjust_ok;
    const obj = await getobj('adjust', filter, GETOBJ_PROMPT | GETOBJ_ALLOWCNT);
    return doorganize_core(obj);
}
export function adjust_split() { return ECMD_FAIL; }

function merge_equipped_references(from, to) {
    const primary = game.uwep === from || game.uwep === to;
    const alternate = game.uswapwep === from || game.uswapwep === to;
    const quivered = game.uquiver === from || game.uquiver === to;
    // C ref: invent.c merged() `setnotworn(otmp); setworn(otmp, wmask);
    // setnotworn(obj)` — worn.c setworn()/setnotworn(), NOT wield.c
    // setuwep(), so gu.unweapon (the one-shot "You begin bashing monsters"
    // reminder) is left alone.
    const setwep = (o) => setworn_slot(o, QW_WEP, () => game.uwep, (x) => { game.uwep = x; });
    if (primary) setwep(null);
    if (alternate) setuswapwep(null);
    if (quivered) setuqwep(null);
    if (primary) setwep(to);
    else if (alternate) setuswapwep(to);
    else if (quivered) setuqwep(to);
    if (game.u?.twoweap && !game.uswapwep) game.u.twoweap = 0;
}

// C ref: invent.c merged() applied to an #adjust pair: merge `obj` into `otmp`
// (the survivor) when mergable, carrying uwep/uswapwep/uquiver across.
function adjust_merged(otmp, obj) {
    if (!mergable(otmp, obj)) return false;
    merge_equipped_references(obj, otmp);
    return merged(otmp, obj) === 1;
}

// C ref: invent.c doorganize_core() — the 'to' slot half of #adjust.
export async function doorganize_core(obj) {
    const GOLD_INDX = 0, GOLD_OFFSET = 1, OVRFLW_INDX = GOLD_OFFSET + invlet_basic;
    if (!obj) return ECMD_CANCEL;

    /* can only be gold if check_invent_gold() found a problem ... */
    const isgold = (obj.oclass === COIN_CLASS);
    let splitting = null, bumped = null, ever_mind = false;
    let inv = inventoryArray();

    /* figure out whether user gave a split count to getobj() */
    for (let i = 0; i < inv.length; i++)
        if (inv[i + 1] === obj) { /* knowledge of splitobj() operation */
            if (inv[i].invlet === obj.invlet) splitting = inv[i];
            break;
        }

    /* initialize the list with all lower and upper case letters */
    const lets = new Array(OVRFLW_INDX + 1).fill(' ');
    lets[GOLD_INDX] = isgold ? GOLD_SYM : ' ';
    for (let k = 0; k < 26; k++) {
        lets[GOLD_OFFSET + k] = String.fromCharCode(97 + k);
        lets[GOLD_OFFSET + 26 + k] = String.fromCharCode(65 + k);
    }
    lets[OVRFLW_INDX] = ' ';
    /* for floating inv letters, truncate list after the first open slot */
    let limit = lets.length;
    if (flags().invlet_constant === false) {
        const cnt = inv_cnt(false);
        if (cnt < invlet_basic) limit = cnt + (splitting ? 1 : 2);
    }

    /* blank out all the letters currently in use in the inventory
       except those that will be merged with the selected object */
    for (const otmp of inv) {
        if (otmp !== obj && !mergable(otmp, obj)) {
            const ch = otmp.invlet;
            if (ch >= 'a' && ch <= 'z') lets[GOLD_OFFSET + ch.charCodeAt(0) - 97] = ' ';
            else if (ch >= 'A' && ch <= 'Z') lets[GOLD_OFFSET + ch.charCodeAt(0) - 65 + 26] = ' ';
            /* overflow defaults to off, but it we find a stack using that
               slot, switch to on -- the opposite of normal invlet handling */
            else if (ch === NOINVSYM) lets[OVRFLW_INDX] = NOINVSYM;
        }
    }

    /* compact the list by removing all the blanks */
    let letstr = '';
    for (let ix = 0; ix < limit; ix++) if (lets[ix] !== ' ') letstr += lets[ix];
    /* and by dashing runs of letters */
    if (letstr.length > 5) letstr = compactify(letstr);

    /* get 'to' slot to use as destination */
    let qbuf = !splitting ? 'Adjust letter' : `Split ${obj.quan}`;
    qbuf += ` to what [${letstr}]${inv.length ? ' (? see used letters)' : ''}?`;

    const noadjust = async () => {
        if (splitting) {
            adjust_merged(splitting, obj); /* undo split */
            if (game._merge_discovery_pending) await report_merge_discovery();
        }
        if (!ever_mind) await pline('Never mind.');
        return ECMD_OK;
    };

    let letc;
    for (let trycnt = 1; ; ++trycnt) {
        letc = !isgold ? String.fromCharCode(await topline_query(qbuf)) : GOLD_SYM;
        if (letc === '?' || letc === '*') {
            letc = await display_used_invlets(splitting ? obj.invlet : '\0');
            if (!letc || letc === '\0') continue;
            if (letc === '\x1b') return await noadjust();
        }
        if (QUITCHARS.includes(letc)
            /* adjusting to same slot is meaningful since all
               compatible stacks get collected along the way,
               but splitting to same slot is not */
            || (splitting && letc === obj.invlet)) {
            return await noadjust();
        } else if (letc === GOLD_SYM && obj.oclass !== COIN_CLASS) {
            await pline(`Only gold coins may be moved into the '${GOLD_SYM}' slot.`);
            ever_mind = true;
            return await noadjust();
        }
        /* letter() classifies '@' as one; compactify() can put '-' in lets;
           the only thing of interest that strchr() might find is '$' or '#'
           since letter() catches everything else that we put into lets[] */
        if ((letter(letc) && letc !== '@') || (letstr.includes(letc) && letc !== '-'))
            break; /* got one */
        if (trycnt === 5) return await noadjust();
        await pline('Select an inventory slot letter.'); /* else try again */
    }

    const collect = (letc === obj.invlet);
    /* change the inventory and print the resulting item */
    let adj_type = collect ? 'Collecting:' : !splitting ? 'Moving:' : 'Splitting:';

    /*
     * don't use freeinv/addinv to avoid double-touching artifacts,
     * dousing lamps, losing luck, cursing loadstone, etc.
     */
    inv = inventoryArray();
    extract_nobj(obj, inv);

    for (let ix = 0; ix < inv.length; ) {
        const otmp = inv[ix];
        const otmpname = has_oname(otmp) ? ONAME(otmp) : null;
        let objname = has_oname(obj) ? ONAME(obj) : null;

        if (collect) {
            /* Collecting: #adjust an inventory stack into its same slot;
               keep it there and merge other compatible stacks into it. */
            if ((!otmpname || (objname && objname === otmpname))
                && adjust_merged(otmp, obj)) {
                obj = otmp;
                extract_nobj(obj, inv);
                continue; /* ix now indexes the next element */
            }
        } else if (otmp.invlet === letc) {
            /* Merging: when from and to are compatible */
            if ((!otmpname || (objname && objname === otmpname))
                && adjust_merged(otmp, obj)) {
                adj_type = 'Merging:';
                obj = otmp;
                extract_nobj(obj, inv);
                break; /* done merging */
            }
            /* Moving or splitting: don't merge extra compatible stacks.
               Found 'otmp' in destination slot; merge if compatible,
               otherwise bump whatever is there to an open slot. */
            if (!splitting) {
                adj_type = 'Swapping:';
                otmp.invlet = obj.invlet;
            } else {
                /* strip 'from' name if it has one */
                if (objname && !obj.oartifact) setONAME(obj, '');
                if (!mergable(otmp, obj)) {
                    /* won't merge; put 'from' name back */
                    if (objname) setONAME(obj, objname);
                } else {
                    /* will merge; discard 'from' name */
                    objname = null;
                }

                if (adjust_merged(otmp, obj)) {
                    adj_type = 'Splitting and merging:';
                    obj = otmp;
                    extract_nobj(obj, inv);
                } else if (inv_cnt(false) >= invlet_basic) {
                    adjust_merged(splitting, obj); /* undo split */
                    /* "knapsack cannot accommodate any more items" */
                    await pline('Your pack is too full.');
                    return ECMD_OK;
                } else {
                    bumped = otmp;
                    extract_nobj(bumped, inv);
                }
            } /* moving vs splitting */
            break; /* not collecting and found 'to' slot */
        } /* collect */
        ix++;
    }

    /* inline addinv; insert loose object at beginning of inventory */
    obj.invlet = letc;
    inv.unshift(obj);
    obj.where = OBJ_INVENT;
    syncInventory(inv);
    reorder_invent();
    if (bumped) {
        /* splitting the 'from' stack is causing an incompatible
           stack in the 'to' slot to be moved into an open one;
           we need to do another inline insertion to inventory */
        assigninvlet(bumped);
        inv.unshift(bumped);
        bumped.where = OBJ_INVENT;
        syncInventory(inv);
        reorder_invent();
    }

    /* messages deferred until inventory has been fully reestablished */
    if (game._merge_discovery_pending) await report_merge_discovery();
    await update_topl(prinv_fmt(adj_type, obj, 0));
    if (bumped) await update_topl(prinv_fmt('Moving:', bumped, 0));
    if (splitting) clear_splitobjs(); /* reset splitobj context */
    update_inventory();
    return ECMD_OK;
}

export function invdisp_nothing(hdr, txt) {
    renderMenuScreen([[hdr, '', txt]], [0, 0]);
}

export function worn_wield_only(obj) { return !!obj?.owornmask; }
export function display_minventory(mon, dflags, title) { void dflags; invdisp_nothing(title || `${mon?.name || 'Monster'} possessions:`, '(none)'); return null; }
export function cinv_doname(obj) { return obj?.otrapped ? `trapped ${doname(obj)}` : doname(obj); }
export function cinv_ansimpleoname(obj) { return obj?.otrapped ? `a trapped ${simpleonames(obj)}` : ansimpleoname(obj); }
export function display_cinventory(obj) { if (obj) obj.cknown = 1; if (Has_contents(obj)) display_inventory(null, false); else invdisp_nothing(`Contents of ${doname(obj)}:`, '(empty)'); return null; }
export function only_here(obj) { return obj?.ox === game.only?.x && obj?.oy === game.only?.y; }
export function display_binventory(x, y, as_if_seen) { void as_if_seen; let n = 0; for (const obj of iterateObjects(game.level?.buriedobjlist)) if (obj.ox === x && obj.oy === y) ++n; return n; }

export function prepare_perminvent(_window) {
    const invmode = iflags().perminv_mode || 0;
    if (perminv_flags !== invmode) {
        wri_info = { fromcore: { invmode } };
        perminv_flags = invmode;
    }
}

export function sync_perminvent() {
    if (!iflags().perm_invent) return;
    prepare_perminvent(game.WIN_INVEN ?? WIN_ERR);
    if (program_state().beyond_savefile_load) display_inventory(null, false);
}

export function perm_invent_toggled(negated) {
    in_perm_invent_toggled = true;
    if (negated) {
        iflags().perm_invent = false;
        game.WIN_INVEN = WIN_ERR;
    } else {
        iflags().perm_invent = true;
        sync_perminvent();
    }
    in_perm_invent_toggled = false;
}

export default {
    addinv,
    ddoinv,
    display_inventory,
    dolook,
    look_here,
    doprgold,
};
