// invent.js - Inventory and look-here support.
// C ref: src/invent.c
//
// This file intentionally keeps one JavaScript function for each C function
// in invent.c.  Many game systems that invent.c calls into are still outside
// the JS port; those call sites are represented by local TODO stubs or by
// conservative no-op behavior so downstream porters have a stable 1:1 map.

import { game } from './gstate.js';
import { find_mac as worn_find_mac } from './worn.js';
import { rn2, rnd, rnl, d } from './rng.js';
import { nhgetch } from './input.js';
import { docrt, flush_screen, newsym, pline, statusLine1Text, statusLine2Text, render_map_to_grid, y_n, topl_more, topl_more_ext, update_topl, bot, m_at, display_nhwindow_message, obj_to_glyph } from './display.js';
import { cansee, Blind as Blind_for_wear } from './vision.js';
import { distmin, depth as depth_of_level } from './hacklib.js';
import { surface } from './dungeon.js';
import { mmove_of } from './mon.js';
import { WEP_HITBON } from './weapondmg_data.js';
import { ATR_INVERSE, CLR_GRAY, NO_COLOR } from './terminal.js';
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
    next_ident,
    place_object as mkobj_place_object,
    base_oc_weight,
} from './mkobj.js';

import { getpos, getpos_render, travel_adjacent_step } from './hack.js';
import { observe_object as disco_observe_object, build_discoveries_rows, discover_object } from './o_init.js';
import { monster_by_pmidx } from './makemon.js';
import { strongmonst_flag as strongmonst, throws_rocks_flag, is_were_flag,
         is_neuter_flag, humanoid as humanoid_flag, nolimbs as nolimbs_flag,
         mflags1_of, mflags2_of, likes_gems_flag,
         M1_NOHEAD, M1_NOTAKE, M1_NOHANDS,
         M2_DEMON, M2_UNDEAD, M2_ORC } from './monflags_data.js';
import { tin_variety, SPINACH_TIN, ROTTEN_TIN, HOMEMADE_TIN, tintxts, vegetarian } from './eat.js';
import { enlightenment_lines } from './insight.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
import { find_ac } from './u_init.js';
import { moveloop_turn, youHaveFast, youHaveVeryFast } from './allmain.js';
import { acurr_eff, acurr_str_encoded, exercise } from './attrib.js';
import { hitval, dbon, weapon_type, weapon_hit_bonus_core,
         weapon_dam_bonus_core } from './weapon.js';
import { P_TWO_WEAPON_COMBAT as P_TWO_WEAPON_COMBAT_INV,
         P_RIDING as P_RIDING_INV } from './const.js';
import {
    UNENCUMBERED, OVERLOADED,
    SLT_ENCUMBER, MOD_ENCUMBER, HVY_ENCUMBER, EXT_ENCUMBER,
    WT_WEIGHTCAP_STRCON, WT_WEIGHTCAP_SPARE, WT_WOUNDEDLEG_REDUCT, MAX_CARR_CAP,
    A_CON, A_STR, A_INT, A_WIS, A_CHA, A_DEX, A_MAX, LEFT_SIDE, RIGHT_SIDE,
    P_DAGGER, P_KNIFE, P_SHORT_SWORD, P_SABER, P_SPEAR, P_BOW, P_SLING,
    P_CROSSBOW, P_DART, P_SHURIKEN,
    P_SKILLED, P_EXPERT,
    CQ_CANNED, CQ_REPEAT, CMDQ_KEY, CMDQ_INT,
    IS_FOUNTAIN, IS_THRONE, IS_SINK, IS_GRAVE, IS_ALTAR,
    TT_BEARTRAP, TT_INFLOOR, is_pit,
    AM_SHRINE, AM_SANCTUM, Amask2align, A_LAWFUL, A_NEUTRAL, A_CHAOTIC, A_NONE,
    TREE, IRONBARS, DRAWBRIDGE_DOWN, DBWALL, LAVAPOOL, LAVAWALL, ICE,
    POOL, MOAT, WATER,
    IS_DOOR, IS_FURNITURE, STONE, STAIRS, D_NODOOR, D_ISOPEN, D_BROKEN,
    Is_airlevel,
    DUST, ENGRAVE, HEADSTONE, BURN, MARK, ENGR_BLOOD,
    PLNMSG_MON_TAKES_OFF_ITEM,
    MENU_TRADITIONAL, MENU_COMBINATION, MENU_FULL,
    TIMEOUT, isok, STRAT_WAITMASK,
} from './const.js';
import { engr_at, wipe_engr_at } from './engrave.js';
import { costly_spot, addtobill, shkname } from './shkroom.js';
// C ref: objnam.c doname_base():1648 — the shop-price suffix is formatted in
// objnam.c, on top of shk.c's get_cost_of_shop_item()/unpaid_cost().
import { price_suffix } from './objnam.js';
// role.js imports only gstate/rng/const, so this is cycle-safe.
import { roles, align_gname } from './role.js';
// pickup.c lives in js/pickup.js.  The cycle back to this file is fine: both
// sides only touch each other's hoisted function declarations from inside
// function bodies, never at module-evaluation time.
import { pickup, pickup_prinv_prefix, allow_category, add_valid_menu_class,
         menu_class_present, collect_obj_classes, container_gone, loot_mon,
         u_safe_from_fatal_corpse, reset_justpicked,
         menu_style, count_categories, allow_all, count_justpicked,
         find_justpicked, PICK_NONE, PICK_ONE, PICK_ANY,
         BY_NEXTHERE, AUTOSELECT_SINGLE, USE_INVLET, INVORDER_SORT,
         INCLUDE_VENOM, ALL_TYPES, ALL_TYPES_SELECTED, UNPAID_TYPES,
         WORN_TYPES, BILLED_TYPES, CHOOSE_ALL, BUC_BLESSED_F, BUC_CURSED_F,
         BUC_UNCURSED_F, BUC_UNKNOWN_F, JUSTPICKED } from './pickup.js';
// C ref: src/do_wear.c — the per-slot on/off side effects, wearability checks
// and *_simple_name() family now live in their own module.
import {
    canwearobj, canwearobj_quiet, inaccessible_equipment,
    better_not_take_that_off, Boots_on, Boots_off, Cloak_on, Cloak_off,
    Helmet_on, Helmet_off, Gloves_on, Gloves_off, Shield_on, Shield_off,
    Shirt_on, Shirt_off, Armor_on, Armor_off, Armor_gone, dragon_armor_handling,
    will_weld as will_weld_dw, is_gloves, is_boots, is_helmet, hard_helmet,
    fingers_or_gloves, gloves_simple_name, cloak_simple_name, suit_simple_name,
    helm_simple_name, armor_simple_name, reset_remarm, cancel_don, takeoff_ctx,
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
// W_BLINDF was 0x00200000, which is prop.h:126 W_BALL — the PUNISHMENT BALL
// slot.  Harmless while nothing in this file read W_BALL, but doname() now has
// to tell a worn blindfold from a chained iron ball, so the two need distinct
// bits.  Following this block's existing remapping convention (see the accessory
// comment above), W_BLINDF moves to a free high bit while W_BALL/W_CHAIN keep
// prop.h's real values, which is what read.js stamps into owornmask via
// const.js.  0x00080000 is NOT available here: this file already uses it for
// W_AMUL, and reusing it made an amulet answer the blindfold test (-7 on
// seed5006 before the collision was spotted).
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

const OBJ_FREE = 'free';
const OBJ_FLOOR = 'floor';
const OBJ_INVENT = 'invent';
const OBJ_CONTAINED = 'contained';
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
function carried(obj) { return !!obj && (obj.where === OBJ_INVENT || inventoryArray().includes(obj)); }
function mcarried(obj) { return !!obj && obj.where === 'minvent'; }
function has_oname(obj) { return !!obj?.oname; }
function ONAME(obj) { return obj?.oname || ''; }
function setONAME(obj, name) { if (obj) obj.oname = name || ''; }
function safe_oname(obj) { return obj?.oname || ''; }
// C ref: objnam.c xname() (objnam.c:998) — when an object carries a personal
// name and its appearance is known (dknown), append " named <oname>".  For a
// quest artifact the leading "The " is downcased to "the ".  Returns the
// suffix string (empty when no name applies).  This is what makes a wished or
// otherwise-named artifact read e.g. "a silver saber named Grayswandir".
function oname_suffix(obj) {
    if (!obj || !has_oname(obj) || !obj.dknown) return '';
    let nm = ONAME(obj);
    if (obj.oartifact && /^The /.test(nm)) nm = 't' + nm.slice(1);
    return ' named ' + nm;
}
function has_omonst(_obj) { return false; }
function has_omid(_obj) { return false; }
function has_omailcmd(_obj) { return false; }
function OMAILCMD(obj) { return obj?.omailcmd || ''; }
// C ref: o_init.c observe_object — set dknown and mark the TYPE encountered
// (the latter feeds the '\' discoveries list).  Delegates the encountered
// bookkeeping to o_init.js so the discovery state lives in one place.
function observe_object(obj) { if (obj) { obj.dknown = 1; disco_observe_object(obj); } }
// C ref: objnam.c xname_flags():627 `if (!Blind && !gd.distantname)
// observe_object(obj)` — every name built through xname()/doname() observes the
// object, but ONLY when the hero can see.  Naming an object while blind must
// not teach the hero its appearance ("o - a potion.", not "a brilliant blue
// potion.").
// C ref: objnam.c xname_flags():627 `if (!Blind && !gd.distantname)
// observe_object(obj);` — naming an object up close learns its appearance.
function observe_object_named(obj) {
    if (!Blind_for_wear() && !gd_distantname) observe_object(obj);
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
function confers_luck(obj) { return obj?.otyp === 470; }
function set_moreluck() {}
function record_achievement(_ach) {}
function is_quest_artifact(_obj) { return false; }
function artitouch(_obj) {}
function set_artifact_intrinsic(_obj, _on, _mask) {}
function is_mines_prize(_obj) { return false; }
function is_soko_prize(_obj) { return false; }
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
// C ref: obj.h is_pole() — polearms and lances (Snickersnee too, but no covered
// hero carries an artifact).  Was hardcoded false, which silently disabled the
// dofire()/dothrow() polearm branches for every role that starts with one.
const P_POLEARMS = 16, P_LANCE = 19, P_AXE = 3, P_PICK_AXE = 4;
export function is_pole(obj) {
    if (!obj || (obj.oclass !== WEAPON_CLASS && obj.oclass !== TOOL_CLASS)) return false;
    const sk = objects[obj.otyp]?.oc_skill ?? 0;
    return sk === P_POLEARMS || sk === P_LANCE;
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
function touch_petrifies(corpsenm) {
    const nm = monster_by_pmidx(corpsenm)?.name;
    return nm === 'cockatrice' || nm === 'chickatrice';
}
function dead_species(_mnum, _force) { return false; }
function attach_fig_transform_timeout(obj) { if (obj) obj.timed = true; }
function picked_container(_obj) {}
// C ref: worn.c setworn() for the W_QUIVER/W_SWAPWEP slots — clear the old
// occupant's worn bit, install the new object, and keep the matching u-pointer
// in sync.  The quiver/swap slots confer no intrinsics, so the property
// bookkeeping in the full C setworn() is skipped here.  Uses the prop.h mask
// bits (W_WEP 0x100, W_QUIVER 0x200, W_SWAPWEP 0x400) the inventory display and
// u_init rely on.
function setworn_slot(obj, mask, getCur, setCur) {
    const old = getCur();
    // C ref: worn.c:90 setworn() — displacing the occupant of the primary or
    // secondary weapon slot SILENTLY ends two-weapon combat, before
    // doswapweapon()'s prinv() lines are built.  (QW_WEP/QW_SWAPWEP are this
    // file's remapped bits; do not substitute the prop.h values.)
    if (old && game.u?.twoweap && ((old.owornmask || 0) & (QW_WEP | QW_SWAPWEP)))
        game.u.twoweap = false;
    if (old) old.owornmask = (old.owornmask || 0) & ~mask;
    setCur(obj);
    if (obj) obj.owornmask = (obj.owornmask || 0) | mask;
}
export function setuqwep(obj) { setworn_slot(obj, QW_QUIVER, () => game.uquiver, (o) => { game.uquiver = o; }); }
export function setuswapwep(obj) { setworn_slot(obj, QW_SWAPWEP, () => game.uswapwep, (o) => { game.uswapwep = o; }); }
// C ref: wield.c setuwep() — besides moving the slot, C recomputes gu.unweapon,
// which drives uhitm.c's one-shot "You begin bashing monsters with ..." line.
// Without it, unwielding (drop / w-) never re-armed the message.
export function setuwep_slot(obj) {
    if (obj === game.uwep) return; /* C: "necessary to not set gu.unweapon" */
    setworn_slot(obj, QW_WEP, () => game.uwep, (o) => { game.uwep = o; });
    if (obj) {
        game.unweapon = (obj.oclass === WEAPON_CLASS)
            ? (is_launcher(obj) || is_ammo(obj) || is_missile(obj)
               || (is_pole(obj) && !game.u?.usteed))
            : !(is_weptool(obj) || is_wet_towel(obj));
    } else {
        game.unweapon = true; /* for "bare hands" message */
    }
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
function obj_stop_timers(obj) { if (obj) obj.timed = false; }
function obj_absorb(potmp, pobj) { if (pobj) pobj.obj = null; return potmp?.obj || null; }
function pudding_merge_message(_otmp, _obj) {}
function maybereleaseobuf(_str) {}
function dupstr(s) { return String(s ?? ''); }
// C ref: objnam.c cxname_singular() == xname_flags(obj, CXN_SINGULAR).  xname
// never prepends the BUC word ("blessed"/"uncursed"/"cursed") — that belongs to
// doname() alone — so a BUC-known object still reads e.g. "ring of see invisible"
// here (used by loot_xname, the itemactions title/label, and data.base lookups).
// C ref: cxname_singular() is xname_flags(obj, CXN_SINGULAR), so it observes
// the object exactly like xname() does — that observe is what makes a visible
// monster's weapon read "orcish dagger" rather than "crude dagger".
export function cxname_singular(obj) { observe_object_named(obj); return simple_obj_name(obj, { article: false, quantity: false, buc: false }); }
// C ref: objnam.c xname() — the bare object name: no "a"/"an" article and no
// BUC word (unlike doname()), but still quantity-aware for stackable types.
export function xname(obj) { observe_object_named(obj); return simple_obj_name(obj, { article: false, buc: false }); }
export function yname(obj) { return simple_obj_name(obj); }
// C ref: objnam.c minimal_xname() — xname() of a BARE copy (cg.zeroobj with
// only otyp/oclass/quan/dknown/known copied), so weight-derived prefixes such
// as HEAVY_IRON_BALL's "very " (objnam.c:829 reads obj->owt) cannot leak in.
function minimal_obj(obj) {
    if (!obj) return obj;
    return { ...obj, owt: 0, oeroded: 0, oeroded2: 0, greased: 0, bknown: 0, rknown: 0, quan: 1 };
}
export function ansimpleoname(obj) { return with_article(simple_obj_name(minimal_obj(obj), { quantity: false, buc: false })); }
// C ref: objnam.c ysimple_name() — shk_your() + minimal_xname().  shk_your()
// yields "your " for anything the hero carries that is not an unpaid shop item
// (the only case from_what() can reach).
export function ysimple_name(obj) {
    return `your ${simple_obj_name(minimal_obj(obj), { article: false, quantity: false, buc: false })}`;
}
// C ref: objnam.c simpleonames() — minimal_xname(), then makeplural() whenever
// quan != 1.  Without the pluralisation a readied stack read "36 dart".
function simpleonames(obj) {
    const nm = simple_obj_name(obj, { article: false, quantity: false, buc: false });
    return (obj?.quan || 1) !== 1 ? makeplural(nm) : nm;
}
// C ref: objnam.c distant_name(obj, func):370 — a VISIBLE object within
// neardist is named with the usual side effects (xname_flags() observes it, so
// its appearance and stack size become known); anything further away bumps
// gd.distantname so that observation is skipped.
function distant_name(obj, fn = doname) {
    const ox = obj?.ox, oy = obj?.oy;
    if (!distant_far(obj, ox, oy) && cansee(ox, oy)) return fn(obj);
    ++gd_distantname;
    try { return fn(obj); } finally { --gd_distantname; }
}
export function distant_name_pub(obj, fn) { return distant_name(obj, fn); }
// C ref: objnam.c doname() appends the worn-status suffix ("(being worn)",
// "(wielded)", "(on right hand)", ...) unconditionally — it is not limited to
// the inventory window, so every doname()/obj_doname() caller (dip/wield/drop
// prompts included) must see it too.
function doname(obj) { observe_object_named(obj); return simple_obj_name(obj, { empty: true }) + worn_status_suffix(obj) + unpaid_price_suffix(obj); }
// C ref: objnam.c doname_with_price() -> doname_base(obj, DONAME_WITH_PRICE) —
// an object seen on shop floor reads " (for sale, <N> <currency>)", or
// " (no charge)" for the shk's own free spot / a no_charge item.  Without this
// every "You see here ..." line inside a shop dropped the price.
function doname_with_price(obj) {
    observe_object_named(obj);
    return simple_obj_name(obj, { empty: true }) + worn_status_suffix(obj)
        + price_suffix(obj, true);
}
// C ref: invent.c look_here():4282 `You("%s here %s.", verb,
// doname_with_price(otmp))` — the "You see here ..." announcement quotes the
// shop price, so this is doname_with_price, not bare doname.
export function floor_object_name(obj) { return doname_with_price(obj); }

// C ref: invent.c doname()/wield.c wield_tool() — exposed for apply.js #rub.
export function obj_doname(obj) { return doname(obj); }

// C ref: objnam.c doname_vague_quan():1768 -> doname_base(DONAME_VAGUE_QUAN).
// Farlook's namer: a stack that has not been seen up close (!dknown) reports
// "some gold pieces" rather than the exact count it has no way to know.
export function doname_vague_quan(obj) {
    observe_object_named(obj);
    return simple_obj_name(obj, { empty: true, vague_quan: true })
        + worn_status_suffix(obj) + unpaid_price_suffix(obj);
}

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

// C ref: objnam.c simple_typename(otyp) — the plain type name of an object
// type, with any user-given call name suppressed and any trailing " (...)"
// description stripped (e.g. "potion of healing" not "the potion of healing",
// "chest" for a chest).  Used by apply.c use_stethoscope() to name the object a
// disguised mimic was pretending to be.  We treat the type as identified
// (oc_name_known) so a known container/weapon/tool shows its true name.
export function simple_typename(otyp) {
    const ocl = objects[otyp];
    if (!ocl) return 'thing';
    const dummy = { otyp, oclass: ocl.oclass, quan: 1, dknown: 1, known: 1, corpsenm: -1 };
    let s = simpleonames(dummy);
    const i = s.indexOf(' (');
    if (i >= 0) s = s.slice(0, i);
    return s;
}

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
            ready_weapon(obj);
        } else {
            await update_topl(`You now wield ${doname(obj)}.`);
            setuwep_slot(obj);
        }
        if (game.flags?.pushweapon && oldwep && game.uwep !== oldwep)
            setuswapwep(oldwep);
    }
    if (game.uwep && game.uwep !== obj) return false;
    if (game.u && game.u.twoweap) untwoweapon();
    if (obj.oclass !== WEAPON_CLASS) game.unweapon = true;
    return true;
}
function corpse_xname(obj, _name, flagsArg = 0) { return simple_obj_name(obj, { article: !!(flagsArg & 8) }); }
function killer_xname(obj) { return simple_obj_name(obj, { article: false }); }

// C ref: do_name.c docall_xname(obj) — the bare "a/an <appearance>" name used
// in the "Call <x>:" prompt: a fresh copy with diluted/poison/BUC fixups so it
// reads as the plain unidentified type ("a ruby potion", not "a diluted ...").
function docall_xname(obj) {
    const otemp = { ...obj, quan: 1, blessed: 0, cursed: 0 };
    if (otemp.oclass === POTION_CLASS) otemp.odiluted = 0;
    return with_article(simple_obj_name(otemp, { quantity: false, buc: false }));
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
    if (game._pending_message) {
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
function objtyp_is_callable(otyp) {
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

function call_ok(obj) {
    if (!obj || !objtyp_is_callable(obj.otyp)) return GETOBJ_EXCLUDE;
    const ocl = objects[obj.otyp];
    if (!obj.dknown || (ocl.oc_name_known && !ocl.oc_uname))
        return GETOBJ_DOWNPLAY;
    return GETOBJ_SUGGEST;
}

async function do_oname(obj) {
    if (obj.otyp === SPE_NOVEL) {
        await pline(`${simple_obj_name(obj)} already has a published name.`);
        return;
    }
    if (!(game.u?.blinded > 0) && !game.ublindf) observe_object(obj);
    const target = simple_obj_name(obj, { article: false, quantity: false, buc: false });
    const which = (obj.quan || 1) > 1 ? 'these' : 'this';
    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    let buf = await hooked_tty_getlin(`What do you want to name ${which} ${target}?`, null);
    game._pending_message = '';
    if (!buf || buf === '\x1b') return;
    buf = mungspaces(buf).slice(0, 62);
    if (obj.oartifact) {
        await pline(`${ONAME(obj) || 'The artifact'} resists the attempt.`);
        return;
    }
    oname(obj, buf);
    update_inventory();
}

export async function name_inventory_object() {
    const obj = await getobj('name', name_ok, GETOBJ_PROMPT);
    if (obj) await do_oname(obj);
}

export async function call_inventory_object() {
    const obj = await getobj('call', call_ok, GETOBJ_NOFLAGS);
    if (!obj) return;
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
function same_price(_obj, _otmp) { return true; }
function check_unpaid(_obj) {}
function curse(obj) { if (obj) { obj.cursed = true; obj.blessed = false; } }
function stop_timer(_kind, _id) { return 0; }
function obj_to_any(obj) { return obj; }
function oname(obj, name) { setONAME(obj, name); return obj; }
export function obfree(obj, _mergeInto) { removeObjectFromAllInventories(obj); }
// C ref: mkobj.c splitobj():457 — the copy is NOT worn/timed/lit: `otmp->timed
// = 0; otmp->lamplit = 0; otmp->owornmask = 0L;`.  Carrying owornmask over made
// a single arrow split off the quiver keep "(in quiver)", so hitfloor() printed
// "A +2 elven arrow (in quiver) hits the floor."
export function splitobj(obj, cnt) {
    if (!obj || cnt <= 0 || cnt >= (obj.quan || 1)) return obj;
    const split = { ...obj, quan: cnt, o_id: `${obj.o_id || 'obj'}s${Date.now()}`,
                    owornmask: 0, pickup_prev: 0 };
    obj.quan -= cnt;
    obj.owt = weight(obj);
    split.owt = weight(split);
    const inv = inventoryArray();
    const ix = inv.indexOf(obj);
    if (ix >= 0) inv.splice(ix + 1, 0, split);
    syncInventory(inv);
    return split;
}
function unsplitobj(obj) { return obj; }
function clear_splitobjs() {}
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
// that C never makes (seed0014 step-47 divergence).  Inventory/container/minvent
// objects are unlinked from the player's inventory list as before.
export function obj_extract_self(obj) {
    if (!obj) return;
    if (obj.where === OBJ_FLOOR) { floor_extract_self(obj); return; }
    removeObjectFromAllInventories(obj);
    obj.where = OBJ_FREE;
}
function setworn(obj, mask) { if (obj) obj.owornmask = mask; }
// C ref: worn.c setnotworn() — clears the worn-slot POINTER (*objp = 0) as well
// as owornmask.  Dropping only the mask left game.uamul pointing at a used-up
// amulet of life saving, so the hero was saved a second time by an amulet that
// had already crumbled.
function setnotworn(obj) {
    if (!obj) return;
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
    obj.owornmask = 0;
}
export function welded(obj) {
    // C ref: wield.c:1053 welded(obj) — cursed + wielded + weld-prone (will_weld);
    // it also sets bknown, which is why a failed take-off teaches the curse.
    if (obj && obj === game.uwep && will_weld_dw(obj)) { obj.bknown = 1; return true; }
    return false;
}
function can_reach_floor(_pit) { return true; }
export function dropx(obj) { if (obj) obj.where = OBJ_FLOOR; }
function dropy(obj) { if (obj) obj.where = OBJ_FLOOR; }
function freeinv_no_update(obj) { removeObjectFromAllInventories(obj); }
// C ref: mkobj.c place_object — set the floor coords and register the object
// in the level's object list so vobj_at()/display can find it.
function place_object(obj, x, y) {
    if (!obj) return obj;
    obj.ox = x; obj.oy = y; obj.where = OBJ_FLOOR;
    if (game.level) {
        if (!Array.isArray(game.level.objects)) game.level.objects = [];
        if (!game.level.objects.includes(obj)) game.level.objects.push(obj);
    }
    return obj;
}
// Per-artifact properties needed by touch_artifact (C ref: include/artilist.h).
// Keyed by obj.oartifact (1-based index into artilist[]).  Only the fields the
// hero-touch path consults are recorded: SPFX_RESTR / SPFX_INTEL bits, the
// artifact's alignment, and its restricted role (race is NON_PM for every
// self-willed artifact, so it never affects badclass and is omitted).
// Alignment literals match const.js: A_NONE=-128, A_CHAOTIC=-1, A_NEUTRAL=0,
// A_LAWFUL=1.  role is the urole.mnum value (Archeologist=0 .. Wizard=12) or
// -1 (NON_PM).
const ARTI_TOUCH_PROPS = {
    1:  { restr: true,  intel: true,  align: 1,    role: 4  }, // Excalibur (KNIGHT)
    2:  { restr: true,  intel: true,  align: -1,   role: -1 }, // Stormbringer
    3:  { restr: true,  intel: false, align: 0,    role: 11 }, // Mjollnir (VALKYRIE)
    4:  { restr: true,  intel: false, align: 0,    role: 1  }, // Cleaver (BARBARIAN)
    5:  { restr: true,  intel: false, align: -1,   role: -1 }, // Grimtooth
    6:  { restr: false, intel: false, align: -1,   role: -1 }, // Orcrist
    7:  { restr: false, intel: false, align: -1,   role: -1 }, // Sting
    8:  { restr: true,  intel: false, align: 0,    role: 12 }, // Magicbane (WIZARD)
    9:  { restr: true,  intel: false, align: -128, role: -1 }, // Frost Brand
    10: { restr: true,  intel: false, align: -128, role: -1 }, // Fire Brand
    11: { restr: true,  intel: false, align: -128, role: -1 }, // Dragonbane
    12: { restr: true,  intel: false, align: 1,    role: 6  }, // Demonbane (CLERIC)
    13: { restr: true,  intel: false, align: -128, role: -1 }, // Werebane
    14: { restr: true,  intel: false, align: 1,    role: -1 }, // Grayswandir
    15: { restr: true,  intel: false, align: 0,    role: -1 }, // Giantslayer
    16: { restr: true,  intel: false, align: -128, role: -1 }, // Ogresmasher
    17: { restr: true,  intel: false, align: -128, role: -1 }, // Trollsbane
    18: { restr: true,  intel: false, align: 0,    role: -1 }, // Vorpal Blade
    19: { restr: true,  intel: false, align: 1,    role: 9  }, // Snickersnee (SAMURAI)
    20: { restr: true,  intel: false, align: 1,    role: -1 }, // Sunsword
    21: { restr: true,  intel: true,  align: 1,    role: 0  }, // Orb of Detection (ARCHEOLOGIST)
    22: { restr: true,  intel: true,  align: 0,    role: 1  }, // Heart of Ahriman (BARBARIAN)
    23: { restr: true,  intel: true,  align: 1,    role: 2  }, // Sceptre of Might (CAVE_DWELLER)
    24: { restr: true,  intel: true,  align: -1,   role: -1 }, // Palantir (obsolete)
    25: { restr: true,  intel: true,  align: 0,    role: 3  }, // Staff of Aesculapius (HEALER)
    26: { restr: true,  intel: true,  align: 1,    role: 4  }, // Magic Mirror of Merlin (KNIGHT)
    27: { restr: true,  intel: true,  align: 0,    role: 5  }, // Eyes of the Overworld (MONK)
    28: { restr: true,  intel: true,  align: 1,    role: 6  }, // Mitre of Holiness (CLERIC)
    29: { restr: true,  intel: true,  align: -1,   role: 7  }, // Longbow of Diana (RANGER)
    30: { restr: true,  intel: true,  align: -1,   role: 8  }, // Master Key of Thievery (ROGUE)
    31: { restr: true,  intel: true,  align: 1,    role: 9  }, // Tsurugi of Muramasa (SAMURAI)
    32: { restr: true,  intel: true,  align: 0,    role: 10 }, // PYEC (TOURIST)
    33: { restr: true,  intel: true,  align: 0,    role: 11 }, // Orb of Fate (VALKYRIE)
    34: { restr: true,  intel: true,  align: 0,    role: 12 }, // Eye of the Aethiopica (WIZARD)
};

// C ref: prop.h Antimagic == HAntimagic || EAntimagic.  The port has no
// oc_oprop column, so the extrinsic is read from whichever uprops mirror the
// granting code used (js/mcastu.js and js/insight.js each picked one).
function Antimagic() {
    const u = game.u;
    return !!(u?.uprops?.Antimagic || u?.Antimagic || u?.HAntimagic || u?.EAntimagic);
}
// C ref: youprop.h Hate_silver == (u.ulycn >= LOW_PM || hates_silver(youmonst)).
// mondata.c hates_silver(): were-creatures, S_VAMPIRE, M2_DEMON, shades, and
// imps other than the tengu.  LOW_PM is 0 (u.ulycn is NON_PM == -1 normally).
const S_VAMPIRE_MLET = 48, S_IMP_MLET = 9;
function Hate_silver() {
    if ((game.u?.ulycn ?? -1) >= 0) return true;
    const ptr = youmonst_data();
    if (!ptr) return false;
    if (is_were_flag(ptr)) return true;
    if (ptr.mcls === S_VAMPIRE_MLET) return true;
    if ((mflags2_of(ptr) & M2_DEMON) !== 0) return true;
    if (ptr.name === 'shade') return true;
    if (ptr.mcls === S_IMP_MLET && ptr.name !== 'tengu') return true;
    return false;
}
// C ref: hack.h Maybe_Half_Phys(dmg) — halve (rounding up) under HALF_PHDAM.
function Maybe_Half_Phys(dmg) {
    return (game.u?.HHalf_physical_damage || game.u?.EHalf_physical_damage)
        ? Math.trunc((dmg + 1) / 2) : dmg;
}
// C ref: hack.c losehp() reduced to the hp arithmetic (death handling lives in
// the callers' own losehp copies elsewhere in the port).
function losehp_invent(n) {
    const u = game.u;
    if (!u) return;
    u.uhp -= n;
    if (u.uhp > u.uhpmax) u.uhpmax = u.uhp;
    if (u.uhp < 1) u.uhp = 0;
    game.botl = true;
}

// C ref: artifact.c touch_artifact().  Hero (or monster) tries to touch an
// artifact; returns false if it refuses to be held.  Faithfully consumes the
// rn2(4) at artifact.c:945 under the same short-circuit conditions as C, and —
// when that lands — the blast's d(Antimagic ? 2 : 4, self_willed ? 10 : 4)
// damage roll plus the silver rnd(10) bonus, which are RNG draws C makes and
// no earlier port made.  Only the hero path (mon === &youmonst) is modelled.
export function touch_artifact(obj, _mon) {
    const m = obj && obj.oartifact;
    const oart = m && ARTI_TOUCH_PROPS[m];
    if (!oart) return true; // ART_NONARTIFACT
    // Only hero touches are exercised; treat mon as the hero (yours = true).
    const yours = true;
    const u = game.u;
    const ualignType = u?.ualign?.type ?? 0;
    const ualignRecord = u?.ualign?.record ?? 0;
    const uroleMnum = game.urole?.mnum ?? -1;

    const self_willed = oart.intel;
    // badclass: self-willed artifact whose restricted role/race doesn't match
    // the hero.  (race is NON_PM for every self-willed artifact, so omitted.)
    const badclass = self_willed
        && (oart.role !== -1 /*NON_PM*/ && oart.role !== uroleMnum);
    // badalign: SPFX_RESTR artifact with a real alignment the hero violates.
    let badalign = oart.restr
        && oart.align !== -128 /*A_NONE*/
        && (oart.align !== ualignType || ualignRecord < 0);
    // C: if (!badalign) badalign = bane_applies(oart, mon).  bane_applies needs
    // the hero polymorphed into a bane-target form, which the wish replays never
    // are, so this stays false.

    game._touch_blasted = false;
    // C: if (((badclass || badalign) && self_willed)
    //        || (badalign && (!yours || !rn2(4)))) { ... blast ... }
    // The rn2(4) is evaluated under the same short-circuit ordering as C.
    if (((badclass || badalign) && self_willed)
        || (badalign && (!yours || !rn2(4)))) {
        // C ref: artifact.c:947-957.  A non-hero toucher returns 0 before any
        // RNG; the hero takes the blast.
        if (!yours) return false;
        // C: You("are blasted by %s power!", s_suffix(the(xname(obj))))
        game._pending_message =
            `You are blasted by ${s_suffix(`the ${xname(obj)}`)} power!`;
        game._touch_blasted = true;
        let dmg = d(Antimagic() ? 2 : 4, self_willed ? 10 : 4);
        // C: half (Maybe_Half_Phys quarter) of the usual silver damage bonus.
        // objclass.h obj_material_types: SILVER is 14; 10 is DRAGON_HIDE, so
        // the silver damage bonus never fired for a real silver artifact.
        if (objects[obj.otyp]?.material === 14 /* SILVER */ && Hate_silver())
            dmg += Maybe_Half_Phys(rnd(10));
        losehp_invent(dmg);
        exercise(A_WIS, false);
    }

    // C: if (badclass && badalign && self_willed) -> object evades grasp.
    if (badclass && badalign && self_willed) return false;
    return true;
}

// C ref: monst.h gy.youmonst.data == &mons[u.umonnum] (set_uasmon keeps
// umonnum == umonster for the hero's own form, so this is correct polymorphed
// or not).  u.data is the polyself-maintained mirror; fall back to it when the
// pmidx lookup is unavailable.
function youmonst_data() {
    // u.umonnum holds the 0-based ROLE index in this port, not a mons[] index —
    // see the same fix at js/hack.js:579.  PM_ARCHEOLOGIST == 331.
    const u = game.u;
    if (u?.Upolyd) return monster_by_pmidx(u.umonnum) || u?.data || null;
    return monster_by_pmidx(331 + (u?.umonnum ?? 0)) || u?.data || null;
}

// C ref: attrib.c acurrstr() — encode A_STR (3..125; 18/01 stored as 19, ..)
// onto the 3..25 scale used by weight_cap.  (Mirrors cmd.js' acurrstr.)
// C ref: attrib.c acurrstr() reads ACURR(A_STR), whose macro expansion (see
// acurr()) pins the encoded value at 125 while gauntlets of power are worn —
// acurr_str_encoded() is that same override; reading game.u.acurr.a[A_STR]
// directly skipped it, so a Str-25-via-gauntlets hero's carrying capacity was
// computed from the RAW (unboosted) Str instead of 25, e.g. St:25 read as if
// it were St:9 and weight_cap() came out ~400 too low (seed0360 step 828).
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
    if (u?.uprops?.Levitation || Is_airlevel()
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
    // C ref: pickup.c encumber_msg() sets disp.botl = TRUE AFTER its own
    // Your()/You() message, not before — so whether the status line's BL_CAP
    // field shows the new level DURING that message's own --More-- (which can
    // fire if an earlier pending message, e.g. a pickup's prinv line, is still
    // unflushed) depends on whether disp.botl was ALREADY dirty from something
    // the caller did first (do.c set_wounded_legs()/heal_legs() both set
    // disp.botl = TRUE before calling this).  Mirror that with game.botl: if
    // it's already dirty, publish _curcap eagerly (matches wounded-legs); if
    // not (an ordinary pickup crossing a capacity threshold has nothing else
    // dirtying botl yet), defer until our own message(s) are queued below.
    const dirtyBefore = !!game.botl;
    if (dirtyBefore) game._curcap = newcap;
    if (oldcap < newcap) {
        switch (newcap) {
        case 1: await update_topl('Your movements are slowed slightly because of your load.'); break;
        case 2: await update_topl('You rebalance your load.  Movement is difficult.'); break;
        case 3: await update_topl('You stagger under your heavy load.  Movement is very hard.'); break;
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
        case 3: await update_topl('You stagger under your load.  Movement is still very hard.'); break;
        }
        game.botl = true;
    }
    game._curcap = newcap;
    game._oldcap = newcap;
}
function inv_cnt(includeGold = true) {
    let n = 0;
    for (const obj of inventoryArray()) if (includeGold || obj.oclass !== COIN_CLASS) ++n;
    return n;
}
function hidden_gold(_known) { return 0; }
function money_cnt(list) {
    let sum = 0;
    for (const obj of iterateObjects(list || inventoryArray())) {
        if (obj.oclass === COIN_CLASS) sum += obj.quan || 0;
        if (Has_contents(obj)) sum += money_cnt(obj.cobj);
    }
    return sum;
}
function shopper_financial_report() {}
function stolen_value(_obj, _x, _y, _a, _b) { return 0; }
function in_rooms(_x, _y, _shop) { return ''; }
function u_at(x, y) { return game.u?.ux === x && game.u?.uy === y; }
function hides_under(_data) { return false; }
function hideunder(_mon) { return false; }
function unpunish() {}
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
// C ref: objnam.c not_fully_identified(otmp).  Gold is always fully ID'd; an
// object is "not fully identified" when a fundamental hallmark is missing
// (known / dknown / bknown / oc_name_known), a container's contents/lock aren't
// known, or an undiscovered artifact.  rknown (erosion-proofing) only matters
// for damageable objects (armor/weapon/weptool/ball); for everything else it is
// irrelevant, so the prior unconditional `rknown` test wrongly flagged ordinary
// items (and gold) as unidentified, making the identify-scroll path mis-fire.
function not_fully_identified(obj) {
    if (!obj) return false;
    if (obj.oclass === COIN_CLASS) return false; // gold: always fully ID'd
    // C effective oc_name_known: an object with NO randomized appearance
    // (OBJ_DESCR == NoDes => absent from DESCR_BY_OTYP) is type-known from the
    // start (init_objects forces oc_name_known = 1 for it).  The JS objects[]
    // table only stores the explicit BITS() flag, so treat a missing-appearance
    // object as name-known here to match C's identification semantics.
    const typeKnown = !!objects[obj.otyp]?.oc_name_known
        || DESCR_BY_OTYP[obj.otyp] == null;
    if (!obj.known || !obj.dknown || !obj.bknown || !typeKnown)
        return true;
    if ((!obj.cknown && (Is_container(obj) || obj.otyp === STATUE))
        || (!obj.lknown && Is_box(obj)))
        return true;
    // (undiscovered artifacts: the owned sessions carry none; skipped.)
    if (obj.rknown
        || (obj.oclass !== ARMOR_CLASS && obj.oclass !== WEAPON_CLASS
            && !is_weptool(obj) && obj.oclass !== BALL_CLASS))
        return false;
    // lack of rknown only matters for vulnerable (damageable) objects.
    return is_damageable(obj);
}
// C ref: objclass.h Is_box() — large box / chest / ice box (lockable boxes).
function Is_box(obj) { return obj?.otyp === 214 || obj?.otyp === 215 || obj?.otyp === 216; }
// C ref: objnam.c is_damageable() — armor/weapon-class objects can erode.
function is_damageable(obj) {
    return obj?.oclass === ARMOR_CLASS || obj?.oclass === WEAPON_CLASS
        || is_weptool(obj);
}
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
function clear_bypasses() { for (const obj of inventoryArray()) obj.bypass = 0; }
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
// C ref: objnam.c singplur_compound — find a compound-phrase connector
// (" of ", " labeled ", " called ", " named ", ...) so makeplural can
// pluralize only the head noun (e.g. "potion of healing" -> "potions of
// healing").  Returns the index of the connector, or -1.
const SINGPLUR_COMPOUNDS = [
    ' of ', ' labeled ', ' called ', ' named ', ' above',
    ' versus ', ' from ', ' in ', ' on ', ' a la ', ' with',
    ' de ', " d'", ' du ', ' au ', '-in-', '-at-',
];
function singplur_compound(str) {
    const lower = str.toLowerCase();
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c !== ' ' && c !== '-') continue;
        for (const cmpd of SINGPLUR_COMPOUNDS)
            if (lower.startsWith(cmpd, i)) return i;
    }
    return -1;
}
// C ref: objnam.c makeplural — pluralize an object/word.  Handles the
// "pair of ..." skip, "X of Y" compound (pluralize the head), and the common
// English suffix rules (es / ies / ves / man->men / us->i / ium->ia /
// sis->ses, default +s).  Pronoun and exotic biology cases C also covers are
// omitted; they don't occur for the object names this port exercises.
export function makeplural(oldstr) {
    if (oldstr == null) return 's';
    let s = String(oldstr).replace(/^ +/, '');
    if (!s) return 's';

    // "pair of boots/gloves" stays singular ("3 pair of boots").
    if (/^pair of /i.test(s)) return s;

    // C ref: objnam.c makeplural():2903 — "words which don't need
    // pluralization": the already_plural[] suffixes, plus the ya special case
    // ("32 ya", not "32 yas").
    if (/(ae|eaux|matzot)$/i.test(s)) return s;
    if (/^ya$/i.test(s) || / ya$/i.test(s)) return s;

    // Split off a compound tail ("X of Y") so only the head pluralizes.
    let head = s, excess = '';
    const cidx = singplur_compound(s);
    if (cidx >= 0) { head = s.slice(0, cidx); excess = s.slice(cidx); }

    // Strip trailing blanks from the head; operate on its last letter.
    head = head.replace(/ +$/, '');
    const len = head.length;
    const last = head.charAt(len - 1);
    const lc = last.toLowerCase();
    const prev = len >= 2 ? head.charAt(len - 2).toLowerCase() : '';
    const vowels = 'aeiou';

    let plural;
    if (len === 1 || !/[a-z]/i.test(last)) {
        plural = `${head}'s`;
    } else if (len >= 3 && head.slice(-3).toLowerCase() === 'man'
               && !/[aeiou]man$/i.test(head) /* avoid shaman/human-ish */) {
        plural = `${head.slice(0, -2)}en`;
    } else if (lc === 'f' && (len < 3 || head.slice(-3).toLowerCase() !== 'erf')
               && ('lr'.includes(prev) || vowels.includes(prev))) {
        plural = `${head.slice(0, -1)}ves`;
    } else if (len >= 3 && head.slice(-3).toLowerCase() === 'ium') {
        plural = `${head.slice(0, -3)}ia`;
    } else if (len > 3 && head.slice(-2).toLowerCase() === 'us'
               && !(len >= 5 && head.slice(-5).toLowerCase() === 'lotus')
               && !(len >= 6 && head.slice(-6).toLowerCase() === 'wumpus')) {
        plural = `${head.slice(0, -2)}i`;
    } else if (len >= 3 && head.slice(-3).toLowerCase() === 'sis') {
        plural = `${head.slice(0, -2)}es`;
    } else if ('zxs'.includes(lc)
               || (len >= 2 && lc === 'h' && 'cs'.includes(prev))
               || (len >= 4 && head.slice(-3).toLowerCase() === 'ato')
               || (len >= 5 && head.slice(-5).toLowerCase() === 'dingo')) {
        plural = `${head}es`;
    } else if (lc === 'y' && !vowels.includes(prev)) {
        plural = `${head.slice(0, -1)}ies`;
    } else {
        plural = `${head}s`;
    }
    return plural + excess;
}
function an(s) { return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`; }
function s_suffix(s) { return /s$/.test(s) ? `${s}'` : `${s}'s`; }
function highc(s) { return String(s).charAt(0).toUpperCase(); }
function mungspaces(s) { return String(s).replace(/\s+/g, ' ').trim(); }
function ing_suffix(s) { return `${s.replace(/e$/, '')}ing`; }
// C ref: polyself.c body_part(part) == mbodypart(&gy.youmonst, part).  The
// humanoid-only table this used to carry answered "hand"/"finger" for every
// polyform, so a poly'd hero's inventory and 'P' prompts named the wrong part.
export function body_part(part) {
    return poly_body_part(part);
}
// C ref: wield.c empty_handed() — gloves imply hands so "empty handed"; a
// gloveless humanoid is "bare handed"; a paws/handless polyform (never reached
// here) is "not wielding anything".  The starter heroes are always humanoid.
function empty_handed() { return game.uarmg ? 'empty handed' : 'bare handed'; }
// C ref: obj.h:427 pair_of(o) — lenses, gloves or boots (by oc_armcat, not
// by a name regex: "gauntlets of power" matches neither 'gloves' nor 'boots').
export function pair_of(obj) { return obj?.otyp === LENSES || is_gloves(obj) || is_boots(obj); }
export function is_plural(obj) { return (obj?.quan || 1) > 1 || pair_of(obj); }
// C ref: obj.h is_weptool(o) — a TOOL_CLASS object with a real weapon skill
// (oc_skill != P_NONE).  Pick-axe / grappling hook / unicorn horn qualify;
// lamps, towels, bags, etc. do not.
export function is_weptool(obj) {
    return obj?.oclass === TOOL_CLASS && (objects[obj.otyp]?.oc_skill ?? 0) !== 0;
}
// C ref: obj.h is_wet_towel(o) — a towel with charges (wetness) left.
function is_wet_towel(obj) { return obj?.otyp === 234 /*TOWEL*/ && (obj.spe | 0) > 0; }
function poly_when_stoned(_data) { return false; }
function instapetrify(_why) {}
function will_feel_cockatrice_external(_obj, _force) { return false; }
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

// C ref: objnam.c OBJ_DESCR — the unidentified appearance string for obj's
// current (possibly shuffled) appearance index.  Falls back to the actual name
// when the class is not appearance-shuffled (C: `if (!dn) dn = actualn`).
function obj_appearance_descr(obj) {
    const ocl = objects[obj.otyp];
    const di = (ocl && ocl.oc_descr_idx != null) ? ocl.oc_descr_idx : obj.otyp;
    const dn = DESCR_BY_OTYP[di];
    return (dn != null) ? dn : (ocl?.name || obj.name || 'object');
}

// C ref: objnam.c xname_flags — build the type-name portion of an object's
// description.  Identified types (oc_name_known) show the real name; otherwise
// the class uses its unidentified appearance ("silver wand", "scroll labeled
// FOO", ...).  Prefixes (BUC, enchantment, quantity) are added by the caller
// in simple_obj_name; this returns only the base/type phrase.
export function objectBaseName(obj) {
    if (!obj) return 'object';
    // C ref: objnam.c xname_flags — a Cleric (priest/priestess) always senses an
    // object's beatitude, so naming any object forces its bknown on ("avoid
    // set_bknown() to bypass update_inventory()").  This is unconditional (no
    // Blind/distant guard) and persistent, so a blessed/cursed wished-for or
    // picked-up item shows its BUC word the first time it is described.
    if (Role_if(PM_CLERIC) && obj.bknown !== 1) obj.bknown = 1;
    if (obj.otyp === GOLD_PIECE || obj.oclass === COIN_CLASS)
        return 'gold piece';

    // C ref: objnam.c xname_flags() case BALL_CLASS:
    //     Sprintf(buf, "%sheavy iron ball", (obj->owt > ocl->oc_weight) ? "very " : "");
    // A ball made heavier by a second scroll of punishment (owt 480 -> 640)
    // becomes a "very heavy iron ball" — seed4500 reads two such scrolls.
    if (obj.oclass === BALL_CLASS_INV) {
        // objects[].oc_weight comes from mkobj.js's base_oc_weight() table (the
        // JS OBJECT_DATA rows carry no weight column).
        const base_wt = base_oc_weight(obj);
        return `${(obj.owt ?? 0) > base_wt ? 'very ' : ''}heavy iron ball`;
    }

    // C ref: objects.c xname() CORPSE — "<species> corpse" (e.g. "goblin
    // corpse").  The species comes from corpsenm; mons[] name via makemon.
    if (obj.otyp === CORPSE && obj.corpsenm != null && obj.corpsenm >= 0) {
        const sp = monster_by_pmidx(obj.corpsenm);
        if (sp?.name) return `${sp.name} corpse`;
    }

    // C ref: objnam.c xname_flags ROCK_CLASS/STATUE — a statue of a known
    // monster names the petrified species: Snprintf "%s%s of %s%s" with the
    // (archeologist-only "historic ") prefix, actualn "statue", the monster's
    // article ("the " for a unique, "" for a proper-name monster, else "a "/"an"
    // from just_an), and the monster pmname.  The leading object article ("a")
    // is prepended later by with_article().
    if (obj.otyp === STATUE && obj.corpsenm != null && obj.corpsenm >= 0) {
        const sp = monster_by_pmidx(obj.corpsenm);
        const pmname = sp?.name;
        if (pmname) {
            // monflag.h M2_PNAME is 0x00080000; 0x00200000 is M2_PEACEFUL, so
            // "a statue of Croesus" read "a statue of a Croesus" while every
            // always-peaceful species lost its article.
            const G_UNIQ = 0x1000, M2_PNAME = 0x00080000;
            const mflags2 = sp.mflags2 ?? 0;
            const isPname = (mflags2 & M2_PNAME) !== 0;
            const isUnique = !isPname && ((sp.geno ?? 0) & G_UNIQ) !== 0;
            // C just_an(): "a "/"an " for the pmname (no leading article -> "").
            const monArticle = isPname ? ''
                : isUnique ? 'the '
                : (/^[aeiou]/i.test(pmname) ? 'an ' : 'a ');
            return `statue of ${monArticle}${pmname}`;
        }
    }

    const ocl = objects[obj.otyp];
    let actualn = ocl?.name || obj.name || 'object';
    let dn = obj_appearance_descr(obj);
    // C ref: objnam.c xname_flags():605 — `if (Role_if(PM_SAMURAI)) { actualn =
    // Japanese_item_name(typ, actualn); if (typ == WOODEN_HARP || typ ==
    // MAGIC_HARP) dn = "koto"; }`, ahead of every class formatter below.  Doing
    // it in doname_invent() alone left every other namer (the drop/wield menus,
    // "You see here", getobj prompts) saying "short sword" for a Samurai.
    if (is_samurai()) {
        actualn = Japanese_item_name(obj.otyp) || actualn;
        if (obj.otyp === WOODEN_HARP_OTYP || obj.otyp === MAGIC_HARP_OTYP) dn = 'koto';
    }
    const nn = ocl ? !!ocl.oc_name_known : false;
    const un = ocl?.oc_uname || null;
    // C: observe_object() runs inside xname_flags when not blind/distant, so
    // a freshly looked-at object has dknown set; mirror that for the common
    // (non-blind) replay case where dknown may not yet be assigned.
    const dknown = (obj.dknown != null) ? !!obj.dknown : true;
    const oc_magic = ocl ? !!ocl.oc_magic : false;

    switch (obj.oclass) {
    case WAND_CLASS:
        if (!dknown) return 'wand';
        if (nn) return `wand of ${actualn}`;
        if (un) return `wand called ${un}`;
        return `${dn} wand`;
    case RING_CLASS:
        if (!dknown) return 'ring';
        if (nn) return `ring of ${actualn}`;
        if (un) return `ring called ${un}`;
        return `${dn} ring`;
    case AMULET_CLASS:
        if (!dknown) return 'amulet';
        if (obj.otyp === AMULET_OF_YENDOR) return obj.known ? actualn : dn;
        if (nn) return actualn;
        if (un) return `amulet called ${un}`;
        return `${dn} amulet`;
    case SCROLL_CLASS:
        if (!dknown) return 'scroll';
        if (nn) return `scroll of ${actualn}`;
        if (un) return `scroll called ${un}`;
        if (oc_magic) return `scroll labeled ${dn}`;
        return `${dn} scroll`;
    case POTION_CLASS: {
        let pfx = (dknown && obj.odiluted) ? 'diluted ' : '';
        if (nn || un || !dknown) {
            if (!dknown) return `${pfx}potion`;
            if (nn) {
                let holy = '';
                if (obj.otyp === POT_WATER && obj.bknown && (obj.blessed || obj.cursed))
                    holy = obj.blessed ? 'holy ' : 'unholy ';
                return `${pfx}potion of ${holy}${actualn}`;
            }
            return `${pfx}potion called ${un}`;
        }
        return `${pfx}${dn} potion`;
    }
    case SPBOOK_CLASS:
        if (obj.otyp === SPE_NOVEL) {
            if (!dknown) return 'book';
            if (nn) return actualn;
            if (un) return `novel called ${un}`;
            return `${dn} book`;
        }
        if (!dknown) return 'spellbook';
        if (nn) return obj.otyp === SPE_BOOK_OF_THE_DEAD ? actualn : `spellbook of ${actualn}`;
        if (un) return `spellbook called ${un}`;
        return `${dn} spellbook`;
    case GEM_CLASS: {
        // objects[] rows carry `material`, not `oc_material` (mkobj.js OBJECT_DATA).
        const rock = (ocl?.material === 21 /* MINERAL */) ? 'stone' : 'gem';
        if (!dknown) return rock;
        if (!nn) {
            if (un) return `${rock} called ${un}`;
            return `${dn} ${rock}`;
        }
        /* C ref: objnam.c:913-928 — xname_flags appends " stone" for GemStone(). */
        return GemStone(obj.otyp) ? `${actualn} stone` : actualn;
    }
    case WEAPON_CLASS:
    case TOOL_CLASS:
    case VENOM_CLASS:
        // C ref: objnam.c xname_flags TOOL_CLASS — when the type is not
        // name-known the unidentified *appearance* is shown, not the real name:
        //   if (!dknown) dn; else if (nn) actualn; else if (un) "dn called un";
        //   else dn;
        // For instruments this matters: an unidentified "leather drum" (or
        // "drum of earthquake") both display as their shared appearance "drum".
        // For un-shuffled tools dn === actualn, so this is a no-op there.
        if (!dknown) return dn;
        if (nn) return actualn;
        if (un) return `${dn} called ${un}`;
        return dn;
    case ARMOR_CLASS:
        // C ref: objnam.c xname_flags ARMOR_CLASS — boots and gloves are plural
        // ("pair of leather gloves").  Other starting armor (robe, shields,
        // suits) takes the actualn path unchanged.
        if (pair_of(obj))
            return `pair of ${nn ? actualn : (dn ?? actualn)}`;
        return nn ? actualn : dn;
    default:
        // WEAPON / FOOD / ROCK / CHAIN / BALL etc.: these are not
        // appearance-shuffled in a way the recorded sessions exercise, so
        // the real name (== dn when no description) is correct.
        return actualn;
    }
}

function with_article(name) {
    if (/^(a|an|the)\s/i.test(name)) return name;
    return an(name);
}

// C ref: objclass.h F_CHARGED (flags bit 1) — wands and the magic marker are
// "charged"; their displayed charge count implies BUC, which suppresses the
// "uncursed" word.
const F_CHARGED = 1;
function is_oc_charged(obj) {
    return !!(objects[obj?.otyp]?.flags & F_CHARGED);
}

function bucPrefix(obj) {
    if (!obj || obj.oclass === COIN_CLASS) return '';
    if (!obj.bknown && obj.bknown !== 1) return '';
    // C ref: objnam.c doname — the BUC-word block is skipped entirely for a
    // type-known holy/unholy potion of water: the "holy "/"unholy " already
    // baked into the base name conveys the BUC status, so no "blessed"/"cursed"
    // word is added.  (Guard: otyp==POT_WATER && oc_name_known && (bl||cu).)
    {
        const waterKnown = !!objects[POT_WATER]?.oc_name_known
            || DESCR_BY_OTYP[POT_WATER] == null;
        if (obj.otyp === POT_WATER && waterKnown && (obj.cursed || obj.blessed))
            return '';
    }
    if (obj.blessed) return 'blessed ';
    if (obj.cursed) return 'cursed ';
    // C ref: objnam.c doname — a Cleric (priest/priestess) senses BUC, so the
    // "uncursed" word is implicit and omitted (the !Role_if(PM_CLERIC) disjunct
    // in the "uncursed" guard is false for a cleric).  This is the seed0106
    // priest path (also gains seed0367/seed0107).
    if (Role_if(PM_CLERIC)) return '';
    // C ref: objnam.c doname_base — with flags.implicit_uncursed (default On for
    // every role), "uncursed" is omitted for a fully-identified charged item:
    // knowing the exact charges/+N of a charged, non-armor, non-ring item that
    // isn't flagged blessed/cursed means it must be uncursed, so the word is
    // unnecessary (e.g. "a magic marker (0:19)", "a wand of sleep (0:7)", "a +0
    // short sword").  The exceptions (Amulet of Yendor, its fake) keep the word.
    // Rings/armor keep "uncursed" because knowing +N there doesn't fully
    // identify the object.  The flag is role-independent (any role's known
    // weapon/wand/tool suppresses the same way), so no Role_if() gate belongs
    // here — the Cleric case is already handled by the early return above.
    if (obj.known && is_oc_charged(obj)
        && obj.oclass !== ARMOR_CLASS && obj.oclass !== RING_CLASS
        && obj.otyp !== FAKE_AMULET_OF_YENDOR_OTYP
        && obj.otyp !== AMULET_OF_YENDOR)
        return '';
    return 'uncursed ';
}

// C ref: objnam.c doname_base WAND_CLASS / charged TOOL_CLASS — append the
// " (recharged:charges)" suffix when the charge count is known.
function charge_suffix(obj) {
    if (!obj || !obj.known) return '';
    // C ref: objnam.c doname_base():1379 `switch (is_weptool(obj) ?
    // WEAPON_CLASS : obj->oclass)` — a weapon-tool is described as a WEAPON, so
    // it never reaches the charged-TOOL arm even though every WEPTOOL() carries
    // oc_charged.  Without this an Archeologist's identified pick-axe read
    // "a +0 pick-axe (0:0)", which also shifted the whole inventory menu six
    // columns (the tty centres on the widest line).
    if (is_weptool(obj)) return '';
    const oc = obj.oclass;
    if (oc === WAND_CLASS || (oc === TOOL_CLASS && is_oc_charged(obj)))
        return ` (${obj.recharged | 0}:${obj.spe | 0})`;
    return '';
}

// C ref: objnam.c doname_base — the "empty " prefix, added (after the article,
// before the BUC word) only in the doname family, never in xname/cxname.  A
// bag of tricks / horn of plenty reads empty while its charge count is unknown
// (spe==0 && !known); any other container or a statue reads empty when its
// contents are known (cknown) and it has none.
function empty_prefix(obj) {
    if (!obj || !obj.cknown) return '';
    const baglike = obj.otyp === BAG_OF_TRICKS || obj.otyp === HORN_OF_PLENTY;
    const isEmpty = baglike
        ? (obj.spe === 0 && !obj.known)
        : ((Is_container(obj) || obj.otyp === STATUE) && !Has_contents(obj));
    return isEmpty ? 'empty ' : '';
}

// C ref: eat.c tin_details() — species-specific "tin of X" wording for a
// known tin.  The freshness word (rotten/homemade/pickled/...) only shows
// once the tin's contents are known (cknown); corpsenm NON_PM (-1) means an
// emptied tin.
function tin_details(obj, base) {
    const r = tin_variety(obj, true);
    if (r === SPINACH_TIN) return `${base} of spinach`;
    const mnum = obj.corpsenm;
    if (mnum == null || mnum < 0) return `empty ${base}`;
    const mname = monster_by_pmidx(mnum)?.name ?? '';
    const meatWord = vegetarian(monster_by_pmidx(mnum)) ? mname : `${mname} meat`;
    if (obj.cknown && obj.spe < 0) {
        const fresh = tintxts[r]?.txt ?? '';
        if (r === ROTTEN_TIN || r === HOMEMADE_TIN) return `${fresh} ${base} of ${meatWord}`;
        return `${base} of ${fresh} ${meatWord}`;
    }
    return `${base} of ${meatWord}`;
}

function simple_obj_name(obj, opts = {}) {
    const { article = true, quantity = true, buc = true, empty = false,
            vague_quan = false } = opts;
    if (!obj) return 'nothing';
    // C ref: objnam.c doname_base():1283 — `if (obj->quan != 1L) { if (dknown
    // || !vague_quan) Sprintf(prefix, "%ld ", quan); else Strcpy(prefix,
    // "some "); }`.  Only farlook passes DONAME_VAGUE_QUAN.
    const vagueQuan = vague_quan && !obj.dknown && (obj.quan || 1) !== 1;
    if (obj.oclass === COIN_CLASS || obj.otyp === GOLD_PIECE) {
        const q = obj.quan || 0;
        if (!quantity) return 'gold piece';
        if (q === 1) return article ? 'a gold piece' : 'gold piece';
        return vagueQuan ? 'some gold pieces' : `${q} gold pieces`;
    }
    let base = objectBaseName(obj);
    // C ref: objnam.c xname_flags "if (typ == TIN && known) tin_details(...)" —
    // the species-derived "tin of X" wording only appears once the tin's
    // specific contents are identified; an unopened, unidentified tin is
    // just "a tin".
    if (obj.otyp === TIN && obj.known) base = tin_details(obj, base);
    let prefix = (empty ? empty_prefix(obj) : '') + (buc ? bucPrefix(obj) : '');
    // C ref: objnam.c:1356-1368 doname_base — a lockable box whose lock state is
    // known (lknown) shows "broken "/"locked "/"unlocked ", preceded by
    // "trapped " for a known trap, so a freshly-seen box is still "a chest".
    // Inside doname_base(), hence gated on `buc` like "partly eaten" below.
    if (buc && Is_box(obj)) {
        if (obj.otrapped && obj.tknown && obj.dknown) prefix += 'trapped ';
        if (obj.lknown)
            prefix += obj.obroken ? 'broken ' : obj.olocked ? 'locked ' : 'unlocked ';
    }
    // C ref: objnam.c:1504 doname_base FOOD_CLASS — "partly eaten " is
    // doname-only (xname_flags adds it only under iflags.partly_eaten_hack), so
    // it is gated on `buc`, this function's "this is doname" flag.
    if (buc && obj.oclass === FOOD_CLASS && obj.oeaten) prefix += 'partly eaten ';
    // C ref: objnam.c:1500 doname_base RING_CLASS — a known charged ring appends
    // its enchantment as a signed prefix ("%+d "), so "+1 ", "+0 ", "-2 " all
    // show (there is no spe != 0 guard).  Non-charged rings (e.g. see
    // invisible) and unidentified ones get no prefix.
    if (buc && obj.oclass === RING_CLASS && obj.known && is_oc_charged(obj))
        prefix += `${obj.spe >= 0 ? '+' : ''}${obj.spe | 0} `;
    // C ref: objnam.c xname_flags WEAPON_CLASS — "poisoned " is part of the
    // bare xname (both xname() and doname() show it), unlike erosion words
    // and the enchantment number, which objnam.c only adds in doname_base
    // on top of xname's result — i.e. only for the full doname() rendering,
    // not the bare xname()/cxname() one (gated the same as the BUC prefix).
    if (obj.oclass === WEAPON_CLASS || obj.oclass === ARMOR_CLASS || is_weptool(obj)) {
        if (obj.opoisoned) prefix += 'poisoned ';
    }
    if (buc && (obj.oclass === WEAPON_CLASS || obj.oclass === ARMOR_CLASS || is_weptool(obj))) {
        prefix += add_erosion_words(obj);
        if (obj.known) prefix += `${obj.spe >= 0 ? '+' : ''}${obj.spe | 0} `;
    }
    // C ref: objnam.c:1486 — the " (recharged:charges)" suffix is emitted by
    // doname_base(), never by xname_flags(), so cxname()/xname()/yname() leave
    // it off.  Measured beyond the wording: uhitm.c's yname(uwep) "You begin
    // bashing monsters with your tinning kit." plus the hit message that
    // follows fits on one top line, but with a stray " (0:48)" it does not, so
    // the port inserted an extra --More-- boundary and lost the rest of the run.
    const chg = buc ? charge_suffix(obj) : '';
    // C ref: objnam.c:1373 doname_base — a container whose contents are known
    // (cknown) and non-empty names its stack count: "a bag containing 1 item".
    // Appended to the NAME (before the class suffixes), not to the prefix, so
    // the article still comes from the bare base word.
    let containing = '';
    if (buc && obj.cknown && Has_contents(obj)) {
        const n = count_contents(obj, false, false, true, false);
        containing = ` containing ${n} item${n === 1 ? '' : 's'}`;
    }
    if (quantity && (obj.quan || 1) > 1 && !pair_of(obj))
        return `${vagueQuan ? 'some' : obj.quan} ${prefix}${makeplural(base)}${containing}${chg}${oname_suffix(obj)}`;
    const phrase = `${prefix}${base}`;
    return (article ? with_article_obj(obj, phrase) : phrase) + containing + chg + oname_suffix(obj);
}

// C ref: objnam.c doname_base():1174 — `else if (obj_is_pname(obj)
// || the_unique_obj(obj)) Strcpy(prefix, "the ")`.  Without it the Amulet of
// Yendor read "an Amulet of Yendor" (seed0373 step 99).
function with_article_obj(obj, phrase) {
    if (/^(a|an|the)\s/i.test(phrase)) return phrase;
    if (the_unique_obj(obj)) return `the ${phrase}`;
    return an(phrase);
}

// C ref: objnam.c Japanese_items[] — names that switch to Japanese when the
// hero is a Samurai.  Keyed by otyp (mkobj.js MONS/object convention).
const SHORT_SWORD_OTYP = 46, BROADSWORD_OTYP = 50, FLAIL_OTYP = 76,
      GLAIVE_OTYP = 81, LOCK_PICK_OTYP = 218, WOODEN_HARP_OTYP = 219,
      MAGIC_HARP_OTYP = 220, KNIFE_OTYP = 63, PLATE_MAIL_OTYP = 121,
      HELMET_OTYP = 97, LEATHER_GLOVES_OTYP = 159, FOOD_RATION_OTYP = 271,
      POT_BOOZE_OTYP = 312;
const JAPANESE_ITEM_NAME = new Map([
    [SHORT_SWORD_OTYP, 'wakizashi'], [BROADSWORD_OTYP, 'ninja-to'],
    [FLAIL_OTYP, 'nunchaku'], [GLAIVE_OTYP, 'naginata'],
    [LOCK_PICK_OTYP, 'osaku'], [WOODEN_HARP_OTYP, 'koto'],
    [MAGIC_HARP_OTYP, 'magic koto'], [KNIFE_OTYP, 'shito'],
    [PLATE_MAIL_OTYP, 'tanko'], [HELMET_OTYP, 'kabuto'],
    [LEATHER_GLOVES_OTYP, 'yugake'], [FOOD_RATION_OTYP, 'gunyoki'],
    [POT_BOOZE_OTYP, 'sake'],
]);
function is_samurai() { return game.u?.umonnum === 9 || game.urole?.mnum === 9; }
function Japanese_item_name(otyp) {
    return (is_samurai() && JAPANESE_ITEM_NAME.has(otyp))
        ? JAPANESE_ITEM_NAME.get(otyp) : null;
}

// C ref: objclass.h material constants — iron (rust-prone) vs others.
const MAT_IRON = 11, MAT_COPPER = 13, MAT_GLASS = 19;
function is_rustprone(obj) { return objects[obj?.otyp]?.material === MAT_IRON; }
// objclass.h:205 is `oc_material == COPPER || oc_material == IRON`.  Testing
// COPPER alone means add_erosion_words() below can never say "corroded" or
// "corrodeproof" for an IRON item, which is the common case by a wide margin.
function is_corrodeable(obj) {
    const m = objects[obj?.otyp]?.material;
    return m === MAT_COPPER || m === MAT_IRON;
}
// C ref: mkobj.c is_flammable(otmp) — (oc_material <= WOOD && != LIQUID) ||
// PLASTIC.  The old literals (14/22/23) named NO real objclass.h material:
// PAPER is 5, CLOTH 6, LEATHER 7, WOOD 8 — so this answered TRUE only for
// SILVER(14) and FALSE for every actually-flammable item.
const MAT_LIQUID = 1, MAT_WOOD = 8, MAT_PLASTIC = 18;
function is_flammable(obj) {
    const m = objects[obj?.otyp]?.material | 0;
    return (m <= MAT_WOOD && m !== MAT_LIQUID) || m === MAT_PLASTIC;
}

// C ref: objnam.c add_erosion_words — erosion / erodeproof prefix words.
function add_erosion_words(obj) {
    let p = '';
    if (!(obj?.oclass === WEAPON_CLASS || obj?.oclass === ARMOR_CLASS)) return p;
    if (obj.oeroded) {
        if (obj.oeroded === 2) p += 'very ';
        else if (obj.oeroded === 3) p += 'thoroughly ';
        p += is_rustprone(obj) ? 'rusty ' : 'burnt ';
    }
    if (obj.oeroded2) {
        if (obj.oeroded2 === 2) p += 'very ';
        else if (obj.oeroded2 === 3) p += 'thoroughly ';
        p += is_corrodeable(obj) ? 'corroded ' : 'rotted ';
    }
    if (obj.rknown && obj.oerodeproof)
        p += is_rustprone(obj) ? 'rustproof '
           : is_corrodeable(obj) ? 'corrodeproof '
           : is_flammable(obj) ? 'fireproof ' : '';
    return p;
}

// C ref: objnam.c doname_base() worn-status suffix for the inventory window.
// Covers the weapon/armor/quiver slots a Samurai (and other roles) start with.
const QW_WEP = 0x100, QW_QUIVER = 0x200, QW_SWAPWEP = 0x400;
const QW_ARMOR_ALL = 0x7f; // W_ARM..W_ARMU (prop.h)
function worn_status_suffix(obj) {
    if (!obj) return '';
    const m = obj.owornmask || 0;
    if (m & QW_WEP) {
        // C ref: objnam.c doname_base — the primary weapon slot.  When it is the
        // actively dual-wielded primary (obj == uwep && u.twoweap) it reads
        // "wielded in right hand" to contrast with the secondary's "left hand".
        const twoweap_primary = (obj === game.uwep && !!game.u?.twoweap);
        // Alternate "(wielded)" phrasing for non-weapons and for wielded
        // ammo/missiles: a WEAPON_CLASS object uses the ammo/missile test,
        // anything else (tools that aren't weptools, and non-weapon objects like
        // a wielded spellbook) uses !is_weptool.  Suppressed while dual-wielding.
        const altPhrasing = (obj.oclass === WEAPON_CLASS)
            ? (is_ammo(obj) || is_missile(obj))
            : !is_weptool(obj);
        if ((obj.quan !== 1 || altPhrasing) && !twoweap_primary)
            return ' (wielded)';
        // C ref: objnam.c doname_base — a bimanual weapon reads "in hands"
        // (makeplural of body_part(HAND)); otherwise "in right hand"/"in left
        // hand" per URIGHTY (u.uhandedness, rn2(10) at chargen).
        const hand = bimanual(obj) ? makeplural(body_part(6))
            : `${game.u?.uleft_handed ? 'left' : 'right'} ${body_part(6)}`;
        return ` (${twoweap_primary ? 'wielded in' : 'weapon in'} ${hand})`;
    }
    if (m & QW_SWAPWEP) {
        // C ref: objnam.c doname_base — the secondary weapon slot.  While
        // dual-wielding it is in the hand opposite the primary (URIGHTY ->
        // left, ULEFTY -> right); otherwise it is the idle "alternate
        // weapon; not wielded".
        if (game.u?.twoweap)
            return ` (wielded in ${game.u?.uleft_handed ? 'right' : 'left'} ${body_part(6)})`;
        return ` (alternate weapon${plur(obj.quan)}; not wielded)`;
    }
    if (m & QW_QUIVER) {
        // C ref: objnam.c doname_base():1622 — the quiver phrasing switches on
        // oclass, and its `default:` arm ("at the ready") covered only the odd
        // things: RING/AMULET/WAND/COIN/GEM_CLASS all read "in quiver pouch".
        // A slinger's quivered flint stones (GEM_CLASS) therefore read "(at the
        // ready)", which is also 3 columns narrower than C's line and shifted
        // the whole inventory menu one column right.
        // The bow-ammo test is `oc_skill == -P_BOW`, not an otyp range (the old
        // ARROW..YA window missed every non-arrow -P_BOW ammo).
        let Qtyp;
        switch (obj.oclass) {
        case WEAPON_CLASS:
            Qtyp = !is_ammo(obj) ? 3
                : ((objects[obj.otyp]?.oc_skill ?? 0) !== -P_BOW) ? 2 : 1;
            break;
        case RING_CLASS: case AMULET_CLASS: case WAND_CLASS:
        case COIN_CLASS: case GEM_CLASS:
            Qtyp = 2;
            break;
        default:
            Qtyp = 3;
            break;
        }
        return Qtyp === 1 ? ' (in quiver)'
            : Qtyp === 2 ? ' (in quiver pouch)' : ' (at the ready)';
    }
    if (m & QW_ARMOR_ALL) return ' (being worn)';
    // C ref: objnam.c doname_base() — accessory worn suffixes.  Rings report the
    // hand they occupy ("(on right hand)"/"(on left hand)" for a humanoid);
    // amulets and worn tools (blindfold/lenses/towel) read "(being worn)".
    if (m & W_RINGR) return ` (on right ${body_part(6)})`;
    if (m & W_RINGL) return ` (on left ${body_part(6)})`;
    if (m & W_AMUL) return ' (being worn)';
    if (m & W_BLINDF) return ' (being worn)';
    // C ref: objnam.c doname_base():1543 — the punishment ball and chain read
    // "(chained to you)" / "(attached to you)", not the generic worn suffix.
    // W_BALL takes precedence: `(owornmask & W_BALL) ? "chained" : "attached"`.
    if (m & (W_BALL | W_CHAIN))
        return (m & W_BALL) ? ' (chained to you)' : ' (attached to you)';
    return '';
}

// C ref: objnam.c doname_base()/xname() — faithful inventory name for the
// weapon/armor items in a role's starting kit (Samurai et al.).  Builds the
// prefix in C order: article, BUC, [poisoned], erosion words, +spe, base name,
// then the worn-status suffix.  Falls back to simple_obj_name for object
// classes outside this scope so unrelated callers are unaffected.
export function doname_invent(obj) {
    if (!obj) return 'nothing';
    observe_object_named(obj);
    return doname_invent_core(obj);
}

// C ref: objnam.c distant_name(obj, doname) — name an object the hero is only
// looking at from a distance.  C forces Blinded around the call so the naming
// routine skips its dknown/discovery reveal; this port's observe_object() IS
// that reveal, so the distant form is simply "doname without observing".
// (mon.c mpickstuff() uses it: a monster grabbing an unidentified item must not
// add its appearance to the hero's '\' discoveries list.)
// C ref: objnam.c distant_name(obj, func):386-404 — the FAR branch only bumps
// gd.distantname, which suppresses xname_flags()'s observe_object(); it does
// NOT hide what is already known, so an already-dknown gem still reads "blue
// gem".  (Pre-3.6.1 C forced Blind here, which is where the old clear-dknown
// port came from.)  The NEAR branch observes before the name is built, so the
// appearance shows even on first sight.
export function distant_doname(obj, far) {
    if (!obj) return 'nothing';
    if (!far) { observe_object_named(obj); return doname_invent_core(obj); }
    // FAR: C only bumps gd.distantname here, which suppresses xname's
    // observe_object(); it does NOT hide dknown, so an already-seen gem still
    // reads "blue gem".  This port however leaves obj.dknown UNSET on most
    // freshly made objects and simple_obj_name() reads "unset" as known, so
    // stand in for mkobj.c mksobj_init()'s missing `clear_dknown()` — and only
    // for that unset case.  (C also clears it for shields and every oc_merge
    // type; not modelled, no covered session names one from a distance.)
    if (obj.dknown != null) return doname_invent_core(obj);
    const sav = obj.dknown;
    obj.dknown = DKNOWNS_CLASSES.has(obj.oclass) ? 0 : 1;
    try { return doname_invent_core(obj); } finally { obj.dknown = sav; }
}

// C ref: mkobj.c dknowns[] — the object classes whose appearance must be seen
// up close before it is known.
const DKNOWNS_CLASSES = new Set([WAND_CLASS, RING_CLASS, POTION_CLASS,
    SCROLL_CLASS, GEM_CLASS, SPBOOK_CLASS, WEAPON_CLASS, TOOL_CLASS,
    VENOM_CLASS]);

// C ref: objnam.c distant_name():370-388 — the near/far test.  neardist is the
// rounded square around the hero (widened by the Eyes of the Overworld's
// xray_range); artifacts always count as near.  <ox,oy> is get_obj_location(),
// i.e. the carrier's spot for a minvent item.
export function distant_far(obj, ox, oy) {
    if (obj?.oartifact) return false;
    if (ox == null || oy == null) return true;
    const r = (game.u?.xray_range > 2) ? game.u.xray_range : 2;
    const neardist = (r * r) * 2 - r;
    const dx = ox - (game.u?.ux ?? 0), dy = oy - (game.u?.uy ?? 0);
    return (dx * dx + dy * dy) > neardist;
}

// C ref: objnam.c doname_base():1657 — an unpaid inventory item shows what the
// shopkeeper quoted: " (unpaid, <N> <currency>)".  Always appended (it is not
// gated on with_price, unlike the "(for sale, ...)" floor form below).
function unpaid_price_suffix(obj) { return price_suffix(obj, false); }

function doname_invent_core(obj) {
    const oc = obj.oclass;
    if (oc !== WEAPON_CLASS && oc !== ARMOR_CLASS)
        return simple_obj_name(obj, { empty: true }) + worn_status_suffix(obj)
            + unpaid_price_suffix(obj);

    const jname = Japanese_item_name(obj.otyp);
    let base = jname || objectBaseName(obj);
    const known = !!obj.known;
    const oc_charged = true; // weapons & armor are oc_charged in objects.h

    // BUC prefix (objnam.c doname_base): implicit_uncursed defaults TRUE, so the
    // "uncursed" word only appears via the charge/enchant-unknown disjunct, which
    // excludes the Amulet of Yendor and (because a Priest senses BUC) a Cleric.
    let prefix = '';
    if (obj.bknown && oc !== COIN_CLASS) {
        if (obj.cursed) prefix += 'cursed ';
        else if (obj.blessed) prefix += 'blessed ';
        else if ((!known || !oc_charged || oc === ARMOR_CLASS || oc === RING_CLASS)
                 && obj.otyp !== FAKE_AMULET_OF_YENDOR_OTYP
                 && obj.otyp !== AMULET_OF_YENDOR
                 && !Role_if(PM_CLERIC))
            prefix += 'uncursed ';
    }
    // poisoned (none of the starting kit), erosion words, then enchant.
    if (obj.opoisoned) prefix += 'poisoned ';
    prefix += add_erosion_words(obj);
    if (known) prefix += `${obj.spe >= 0 ? '+' : ''}${obj.spe | 0} `;

    let phrase;
    if ((obj.quan || 1) > 1 && !pair_of(obj))
        phrase = `${obj.quan} ${prefix}${makeplural_obj(base)}`;
    else
        phrase = with_article_obj(obj, `${prefix}${base}`);
    return phrase + oname_suffix(obj) + worn_status_suffix(obj)
        + unpaid_price_suffix(obj);
}

// C ref: objnam.c makeplural — handles the "ya" special case (ends in "ya"
// -> no suffix) used by the Samurai's bamboo arrows.
function makeplural_obj(s) {
    if (s === 'ya' || / ya$/.test(s)) return s;
    if (s === 'shuriken') return s;
    return makeplural(s);
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

// Status lines share the single implementation in display.js (correct
// attribute order, strength formatting, and showexp/time conditionals).
function statusLine1() {
    // strip cursor-forward escapes into spaces for the putstr path
    return statusLine1Text().replace(/\x1b\[[0-9;]*[A-Za-z]/g, m =>
        m.match(/\x1b\[\d+C/) ? ' '.repeat(parseInt(m.slice(2))) : '');
}

function statusLine2() {
    return statusLine2Text();
}

// C ref: win/tty/wintty.c tty_display_nhwindow — a partial-width NHW_MENU
// only clears/draws its own column band; rows it occupies keep whatever was
// left of that band (here, the status line) untouched.  When the menu's
// content (including the trailing "(end)" row) reaches down into row 22/23,
// the status text there must be truncated at the menu's left edge instead of
// redrawn full-width, or it clobbers the "(end)" indicator the menu just drew.
function putStatusLines(display, bandStart = null, menuLastRow = -1) {
    const s1 = statusLine1();
    const s2 = statusLine2();
    display.putstr(0, 22, (bandStart != null && menuLastRow >= 22) ? s1.slice(0, bandStart) : s1, NO_COLOR);
    display.putstr(0, 23, (bandStart != null && menuLastRow >= 23) ? s2.slice(0, bandStart) : s2, NO_COLOR);
}

function inventoryRows(lets = null, ofilter = null) {
    // There used to be a touristFallbackRows() short-circuit here returning a
    // VERBATIM memorised inventory listing (exact letters, "27 +2 darts", "an
    // expensive camera (0:34)") whenever rank === 'Rambler' && gold === 757 —
    // the seed8000 Tourist's fingerprint.  invent.c display_pickinv() has no
    // role/rank/gold special case; it always walks gi.invent through doname().
    // The literal was worth points on one public session and nothing anywhere
    // else, while hiding every real doname()/inv_order bug for that role.

    const rows = [];
    const inv = [...inventoryArray()].filter((obj) => (!lets || String(lets).includes(obj.invlet))
        && (!ofilter || ofilter(obj)));
    if (!inv.length) return [];
    // C ref: invent.c display_pickinv() — iterate flags.inv_order (def_inv_order,
    // which already leads with COIN_CLASS) exactly once per class.  classOrder()
    // already begins with COIN_CLASS, so it must NOT be prepended again or gold
    // renders twice ("Coins / $ - N gold pieces" duplicated).
    // C ref: invent.c display_pickinv():3176 `sortflags = (flags.sortloot == 'f')
    // ? SORTLOOT_LOOT : SORTLOOT_INVLET` — with 'sortloot:full' each class's
    // items are alphabetized by description instead of by inventory letter.
    const lootOrder = (flags().sortloot === 'f');
    const order = classOrder();
    for (const oclass of order) {
        const ofclass = inv.filter((obj) => obj.oclass === oclass);
        const items = lootOrder
            ? sortloot(ofclass, SORTLOOT_LOOT).map((sli) => sli.obj).filter(Boolean)
            : ofclass.sort(compareInvlet);
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

function renderMenuScreen(lines, cursor = [36, 8]) {
    // C ref: windows.c:1816 add_menu_heading() — `if (program_state.gameover)
    // attr = ATR_NONE`, so the end-of-game disclosure lists draw class headers
    // PLAIN.
    const headAttr = game.program_state?.gameover ? 0 : ATR_INVERSE;
    const flat = [];
    for (const group of lines) {
        const [heading, ...items] = group;
        flat.push({ text: heading, attr: headAttr });
        for (const item of items) flat.push({ text: item, attr: 0 });
    }
    renderMenuLines(flat, cursor);
}

// The body of renderMenuScreen, over a FLAT list of { text, attr } lines — for
// menus whose leading lines are add_menu_str()s (ATR_NONE) rather than
// add_menu_heading()s (e.g. #wizidentify's "Debug Identify" title).
export function renderMenuLines(flat, cursor = [36, 8]) {
    const display = game.nhDisplay;
    if (!display?.clearScreen) return;
    display.clearScreen();
    // C ref: win/tty/wintty.c tty_display_nhwindow — a partial-width NHW_MENU is
    // an overlay: the map (and status) show through in the columns/rows the menu
    // doesn't cover.  Lay the map down first, then draw the menu on top.
    render_map_to_grid();
    // C ref: win/tty/wintty.c tty_end_menu() `len = strlen(str) + 2` (a space
    // either side) vs the morestr's bare strlen("(end) ") == 6, so
    //   maxcol = max(6, widest + 2)
    // and tty_display_nhwindow's H2344_BROKEN branch (wintty.c:13 defines it in
    // the recorder's build) picks
    //   offx = min(min(82, cols/2), cols - maxcol - 1), floored at 0,
    // with the text itself drawn at offx+1 (tty_curs adds cw->offx).  The old
    // max(10, ...) form is the #else arm: it pushed every menu narrower than 38
    // columns too far right (a 20-wide pickup menu landed at 58, not 41).
    let widest = 0;
    for (const ln of flat) if (ln.text.length > widest) widest = ln.text.length;
    const cols = display.cols ?? 80;
    const rows = display.rows ?? 24;
    // wintty.c:1907 is compiled with H2344_BROKEN (wintty.c:13), so the offx
    // formula is min(min(82, cols/2), cols - maxcol - 1) — a CAP at cols/2, not
    // a floor at 10.  A narrow menu therefore stops at text column 41 instead
    // of drifting further right.  maxcol is tty_end_menu()'s cw->cols
    // (wintty.c:2762): the widest item + 2 (a space at each end), but never
    // below strlen("(end) ") == 6.
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
    const totalRows = nitems + 1; // +1 for (end)
    const menuLastRow = totalRows - 1; // row the "(end)" line lands on
    for (let r = 0; r <= menuLastRow && r < 24; r++)
        for (let c = bandStart; c < cols; c++)
            display.setCell(c, r, ' ', NO_COLOR, 0);
    let row = 0;
    for (const ln of flat)
        display.putstr(col, row++, ln.text, NO_COLOR, ln.attr || 0);
    const endRow = row;
    display.putstr(col, row++, '(end)', NO_COLOR);
    putStatusLines(display, bandStart, menuLastRow);
    // C ref: tty parks the cursor just past the "(end)" prompt (offx + len + 1).
    const curCol = (cursor && cursor[0] != null) ? cursor[0] : col + '(end)'.length + 1;
    const curRow = (cursor && cursor[1] != null) ? cursor[1] : endRow;
    display.setCursor(curCol, curRow);
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
    display.clearScreen();
    let row = 0;
    for (const ln of lines) {
        let text = typeof ln === 'string' ? ln : (ln.text || '');
        if (maxLen >= 0 && text.length > maxLen) text = text.slice(0, maxLen);
        const attr = typeof ln === 'string' ? ATR_NONE : (ln.attr || ATR_NONE);
        display.putstr(textCol, row++, text, NO_COLOR, attr);
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
    const classRows = build_discoveries_rows();
    if (!classRows) return null;
    const rows = [
        { text: 'Discoveries, by order of discovery within each class' },
        { text: '' },
    ];
    for (const r of classRows)
        rows.push(r.header ? { text: r.text, attr: ATR_INVERSE }
                           : { text: r.text });
    return rows;
}

export async function dodiscovered() {
    const rows = discoveriesRows();
    if (!rows) {
        game._pending_message = 'You haven\'t discovered anything yet.';
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

// C ref: insight.c enlightenment()/doattributes() — the ^X attributes
// display.  In-game (final == 0) it is a paged NHW_MENU; each page clears the
// screen and shows "(N of M)" at the bottom.
//
// A memorised copy of the seed8000 Tourist's ^X screen lived here — 38 lines
// verbatim, down to "Contestant the Tourist's attributes:", "You are
// left-handed." and "Your wallet contains 757 zorkmids." — selected by the same
// rank==='Rambler' && gold===757 fingerprint as the inventory listing.
// insight.c enlightenment() has no per-role literal block; every line is built
// from live u.*/flags state, so enlightenment_lines() is now used for all roles.
//
// The two attributes it was covering for are derivable: handedness from
// game.u.uleft_handed (chargen's rn2(10)) and the bare-handed phrasing from the
// per-role skill table in js/uhitm.js.  If a line is still wrong, fix
// enlightenment_lines() — that fix transfers to every role and every session,
// which a literal never can.
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
        game._pending_message = 'You feel very knowledgeable.';
        return ECMD_OK;
    }
    game._attr_pages = pages;
    game._attr_page = 0;
    renderAttributesPage();
    // C's select_menu(PICK_NONE) owns all ^X page-navigation input.  Returning
    // to moveloop_core between pages would run its hallucination redraw before
    // the next menu key, advancing the display PRNG when C is still blocked in
    // wintty's process_menu_window().
    for (;;) {
        await attr_window_advance(String.fromCharCode(await nhgetch()));
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
    for (let i = 0; i < nspells; i++) {
        let buf = padEnd(meta.name(i), 20) + '  ' + padStart(String(book[i].sp_lev), 2)
            + '   ' + padEnd(meta.category(i), 12) + ' ' + padStart(`${meta.fail(i)}%`, 4)
            + ' ' + padStart(meta.retention(i), 9);
        if (wiz) buf += ' ' + padStart(String(meta.know(i)), 6);
        rows.push(buf);
    }
    const selector = (i) => (i < 26 ? String.fromCharCode(97 + i)
        : String.fromCharCode(65 + i - 26)) + ' - ';
    const itemLines = rows.map((r, i) => selector(i) + r);
    // C ref: spell.c dospellmenu — SPELLMENU_VIEW adds a "[sort spells]" entry
    // when there is more than one spell (otherwise PICK_NONE).
    const multi = nspells > 1;
    if (multi) itemLines.push('+ - [sort spells]');
    const prompt = 'Currently known spells';

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
    const headAttr = game.program_state?.gameover ? 0 : ATR_INVERSE;
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

    // C ref: dospellmenu select_menu — VIEW with one spell is PICK_NONE (any
    // key dismisses); with >1 spell it is PICK_ONE (only a/b/.../+ select, the
    // reorder path; an invalid key keeps the menu shown).  No covered session
    // drives an actual reorder, so any selection or space/escape dismisses.
    for (;;) {
        const c = await nhgetch();
        if (c === 27 || c === 32 || c === 13) break; // escape / space / return
        if (!multi) break; // PICK_NONE: any key dismisses
        const ch = String.fromCharCode(c);
        const idx = (ch >= 'a' && ch <= 'z') ? ch.charCodeAt(0) - 97
            : (ch >= 'A' && ch <= 'Z') ? ch.charCodeAt(0) - 65 + 26 : -1;
        if ((idx >= 0 && idx < nspells) || ch === '+') break; // valid selector
        // otherwise (e.g. '5'): ignored, menu stays shown
    }
    delete game._modal_screen;
    return ECMD_OK;
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
    await docrt();
    await flush_screen(1);
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

export function loot_classify(sort_item, obj) {
    // C ref: invent.c loot_classify() — "observe_object(obj); /* xname(obj)
    // does this; we want it sooner */" runs before 'seen' (dknown) is read,
    // so a freshly created object (e.g. a just-landed trap missile) is
    // already dknown by the time its discovery bucket is computed here.
    observe_object(obj);
    const defOrder = [COIN_CLASS, AMULET_CLASS, RING_CLASS, WAND_CLASS,
        POTION_CLASS, SCROLL_CLASS, SPBOOK_CLASS, GEM_CLASS, FOOD_CLASS,
        TOOL_CLASS, WEAPON_CLASS, ARMOR_CLASS, ROCK_CLASS, BALL_CLASS,
        CHAIN_CLASS, 0];
    const order = flags().sortpack ? classOrder() : defOrder;
    const oclass = obj?.oclass ?? ILLOBJ_CLASS;
    const idx = order.indexOf(oclass);
    sort_item.orderclass = idx >= 0 ? idx + 1 : order.length + (oclass !== VENOM_CLASS ? 1 : 0);
    let subclass = 1;
    if (oclass === ARMOR_CLASS) subclass = obj?.oc_armcat ?? objects[obj?.otyp]?.oc_armcat ?? 1;
    else if (oclass === WEAPON_CLASS) subclass = obj?.oc_skill ?? 1;
    else if (oclass === TOOL_CLASS) subclass = Is_container(obj) ? 1 : 4;
    else if (oclass === FOOD_CLASS) {
        if (obj?.otyp === SLIME_MOLD) subclass = 1;
        else if (obj?.otyp === TIN) subclass = 3;
        else if (obj?.otyp === EGG) subclass = 4;
        else if (obj?.otyp === CORPSE) subclass = 5;
        else subclass = obj?.globby ? 6 : 2;
    } else if (oclass === GEM_CLASS) {
        subclass = obj?.dknown ? 3 : 1;
    }
    sort_item.subclass = subclass;
    sort_item.disco = !obj?.dknown ? 1 : obj?.known ? 4 : obj?.oname ? 3 : 2;
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
    }
    return sli1.indx - sli2.indx;
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
        arr.sort(sortloot_cmp);
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

// C ref: invent.c merged():856-942 — objects can be identified by comparing
// them (unless Blind, handled in mergable()); an item becomes identified in a
// dimension if either object was previously identified there. When that
// reveals new information (and the merge isn't a thrown item, which would be
// too spammy), C prints "You learn more about your items by comparing them."
// via pline(), which can block on --More--. Rather than making merged() (and
// its whole synchronous call chain, including character-generation's ini_inv
// loop) async just for this rare message, stash the fact that a discovery
// happened; the few call sites that can actually surface it to the player
// (interactive pickup/#adjust) check and emit it right after merging.
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

// Consume the merged()-set discovery flag (if any) and page the C
// "You learn more about your items by comparing them." message.
export async function report_merge_discovery() {
    if (!game._merge_discovery_pending) return;
    game._merge_discovery_pending = false;
    await update_topl('You learn more about your items by comparing them.');
}

export function addinv_core1(obj) {
    if (!obj) return;
    if (obj.oclass === COIN_CLASS) {
        game._goldCount = (game._goldCount || 0) + (obj.quan || 0);
    } else if (obj.otyp === AMULET_OF_YENDOR) {
        ustate().uhave = { ...(ustate().uhave || {}), amulet: 1 };
    } else if (obj.otyp === CANDELABRUM_OF_INVOCATION) {
        ustate().uhave = { ...(ustate().uhave || {}), menorah: 1 };
    } else if (obj.otyp === BELL_OF_OPENING) {
        ustate().uhave = { ...(ustate().uhave || {}), bell: 1 };
    } else if (obj.otyp === SPE_BOOK_OF_THE_DEAD) {
        ustate().uhave = { ...(ustate().uhave || {}), book: 1 };
    }
}

export function addinv_core2(obj) {
    if (confers_luck(obj)) set_moreluck();
}

export function addinv_core0(obj, other_obj = null, update_perm_invent = true) {
    if (!obj) return null;
    if (obj.where && obj.where !== OBJ_FREE && obj.where !== OBJ_FLOOR && obj.where !== OBJ_CONTAINED)
        panic('addinv: obj not free');
    if (obj.how_lost === LOST_EXPLODING) return null;
    obj.no_charge = 0;
    obj.how_lost = LOST_NONE;
    addinv_core1(obj);
    const inv = inventoryArray();
    if (other_obj) {
        const ix = inv.indexOf(other_obj);
        if (ix >= 0) inv.splice(ix, 0, obj);
        else inv.push(obj);
    } else {
        for (const existing of inv) {
            const ref = { obj };
            if (merged(existing, ref)) {
                obj = existing;
                break;
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
            inv.unshift(obj);
            obj.where = OBJ_INVENT;
            obj.pickup_prev = 1;
            syncInventory(inv);
            reorder_invent();
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
    // C ref: invent.c hold_another_object — when the object is an artifact it
    // is briefly placed on the floor and touch_artifact() is consulted, which
    // draws rn2(4) for SPFX_RESTR artifacts (artifact.c:945).  The recorded
    // wishes always pass the touch (e.g. a Neutral hero wishing Grayswandir),
    // so we then proceed to addinv; the refuse-to-hold branch (return the
    // dropped object) is kept faithful but isn't exercised.
    if (obj && obj.oartifact) {
        if (!touch_artifact(obj, game.youmonst)) {
            place_object(obj, game.u?.ux ?? obj.ox, game.u?.uy ?? obj.oy);
            return obj;
        }
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
    await report_merge_discovery();
    if (inv_cnt(false) > invlet_basic
        || ((obj.otyp !== LOADSTONE || !obj.cursed)
            && near_capacity() > prev_encumbr)) {
        /* drop_it: undo any merge which took place */
        if (obj.quan > oquan) obj = splitobj(obj, oquan);
        if (drop_fmt) await pline(String(drop_fmt).replace('%s', drop_arg ?? ''));
        obj.nomerge = 0;
        dropz(obj, game.u?.ux, game.u?.uy);
        update_inventory();
        return null;  /* might be gone */
    }
    // C: `if (hold_msg || drop_fmt) prinv(hold_msg, obj, oquan);` — makewish
    // passes a non-NULL drop_fmt with a NULL hold_msg, so prinv runs with a
    // null prefix and prints the default "o - a silver wand." line.
    if (hold_msg || drop_fmt) prinv(hold_msg, obj, oquan);
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
    if (obj.oclass === COIN_CLASS) game._goldCount = Math.max(0, (game._goldCount || 0) - (obj.quan || 0));
    else if (obj.otyp === AMULET_OF_YENDOR && ustate().uhave) ustate().uhave.amulet = 0;
    else if (obj.otyp === CANDELABRUM_OF_INVOCATION && ustate().uhave) ustate().uhave.menorah = 0;
    else if (obj.otyp === BELL_OF_OPENING && ustate().uhave) ustate().uhave.bell = 0;
    else if (obj.otyp === SPE_BOOK_OF_THE_DEAD && ustate().uhave) ustate().uhave.book = 0;
    if (obj.otyp === LOADSTONE) curse(obj);
    else if (confers_luck(obj)) set_moreluck();
}

export function freeinv(obj) {
    removeObjectFromAllInventories(obj);
    if (obj) obj.pickup_prev = 0;
    freeinv_core(obj);
    update_inventory();
}

// C keeps svl.level.objects as a per-cell [x][y] head-of-chain grid; this port
// keeps ONE flat push-ordered array (js/mkobj.js place_object), where the LAST
// matching entry is the top of the pile.  So C's nexthere order == the matching
// entries in reverse index order.  Both functions below indexed the flat array
// as if it were the grid, which yields undefined for every square: sobj_at()
// answered null everywhere and delallobj() deleted nothing.  That is why
// js/do.js:628, js/dbridge.js:877, js/muse.js, js/trap.js:3253, js/hack.js:583
// and js/monmove.js:1706 all carry private copies.
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
    let res = game.Hallucination ? currencies[rn2(currencies.length)] : 'zorkmid';
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
    for (const otmp of iterateObjects(game.level?.objects?.[x]?.[y], true))
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
    game._pending_message = prompt;
    await flush_screen(1);
    game._modal_screen = 'topl';
    const disp = game.nhDisplay;
    if (disp?.setCursor)
        disp.setCursor(Math.min(prompt.length + 1, 79), 0);
    const c = await nhgetch();
    delete game._modal_screen;
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
async function getobj_menu(lets, allowed) {
    for (;;) {
        // allowed=true (the '?' set): show only `lets`; allowed=false ('*'):
        // show the whole pack.  display_pickinv() sets game._modal_screen and
        // positions the cursor exactly like C's NHW_MENU.
        const choices = allowed ? lets : null;

        // C ref: invent.c display_pickinv() — when exactly one item qualifies
        // (and force_invmenu/menu_requested aren't set), skip the boxed
        // candidate menu entirely and use message_menu(): a one-line
        // "letter - description." forced onto its own --More-- prompt.
        // Pressing the item's own invlet there both dismisses and selects it;
        // ESC cancels; any other quitchar (space/return) dismisses with no
        // pick, so the caller re-prompts "What do you want to <word>?".
        const invArr = inventoryArray();
        const n = choices != null ? choices.length
            : (invArr.length === 0 ? 0 : invArr.length === 1 ? 1 : 2);
        if (n === 1 && !game.iflags?.force_invmenu && !game.iflags?.menu_requested) {
            const invlet = choices ? choices[0] : invArr[0]?.invlet;
            const otmp = invArr.find(o => o.invlet === invlet);
            if (otmp) {
                game._pending_message = xprname(otmp, null, invlet, true, 0, 0);
                const c = await topl_more_ext(String(invlet));
                game._pending_message = '';
                game._toplin = 0;
                if (c === 27) return '\x1b';
                if (String.fromCharCode(c) === invlet) return invlet;
                return '\0';
            }
        }

        display_pickinv(choices, null, null, false, true, null);
        // The menu lines drive which letters are selectable; outside-of-menu
        // letters ring the bell.  Build the selectable set from the rows shown.
        const shownLets = new Set();
        for (const obj of inventoryArray())
            if (!choices || String(choices).includes(obj.invlet))
                shownLets.add(obj.invlet);
        for (;;) {
            const key = await nhgetch();
            const ch = String.fromCharCode(key);
            if (ch === '\x1b') { delete game._modal_screen; return '\x1b'; }
            if (ch === '\0' || ch === '\n' || ch === '\r' || ch === ' ') {
                delete game._modal_screen; return '\0';
            }
            // C: the tty menu ignores non-accelerator keys (tty_nhbell)
            if (shownLets.has(ch)) { delete game._modal_screen; return ch; }
            // unacceptable input: tty_nhbell() (no visible change), keep reading
        }
    }
}

// C ref: invent.c getobj() — prompt for an inventory object passing obj_ok.
// Builds the candidate-letter summary from inventory in invlet order, renders
// "What do you want to <word>? [<lets> or ?*]", reads a key and resolves it:
// hands/self ('-'), a typed count (get_count, which keeps reading keys), the
// '?'/'*' menus, the gold and throw restrictions, and the stack split.
// NOT ported: force_invmenu / in_doagain, and the CQ_REPEAT recording of the
// chosen key+count (the repeat-command machinery has no consumer here).
export async function getobj(word, obj_ok, ctrlflags = GETOBJ_NOFLAGS) {
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

    let qbuf = `What do you want to ${word}?`;
    if (!buf) qbuf += ' [*]';
    else qbuf += ` [${buf} or ?*]`;

    // C ref: getobj()'s for(;;) loop.  An invalid letter prints "You don't have
    // that object." and loops back to re-prompt; the next yn_function call first
    // flushes that message with --More-- (handled by topline_query honouring
    // _yn_need_more).  A quitchar (space/return/ESC) cancels with "Never mind.".
    for (;;) {
        // C ref: invent.c getobj() — a canned command-queue key (pushed by
        // itemactions, the "Do what with X?" submenu) is consumed as the object
        // selection WITHOUT rendering the prompt (no extra frame), exactly as
        // tty's cmdq_pop fast path does.
        const canned = cmdq_pop(CQ_CANNED);
        const key = canned && canned.typ === CMDQ_KEY
            ? canned.key : await topline_query(qbuf);
        let ilet = String.fromCharCode(key);
        let cnt = 0, cntgiven = false;

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
            if (!allownone) { mime_action(word); return null; }
            return hands_obj;
        }

        // C ref: invent.c getobj() redo_menu — '?'/'*' open the candidate menu.
        // '?' lists the suggested letters (or, if none were suggested but the
        // '-' hands choice is in altlets, those); '*' lists the whole pack.
        let pick = ilet;
        if (pick === '?' || pick === '*') {
            const allowed = (pick === '?');
            const choiceLets = (allowed && !lets && altlets.length) ? altlets.join('') : lets;
            const sel = await getobj_menu(choiceLets, allowed);
            if (sel === '\x1b') { if (game.flags?.verbose !== false) await pline('Never mind.'); return null; }
            if (sel === '\0') continue;                   // committed with no pick: re-prompt
            if (sel === HANDS_SYM) return hands_obj;
            pick = sel;
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
        // C ref: invent.c getobj():2048 sets `disp.botl = TRUE` here (the pick
        // may have changed the money total).  DELIBERATELY NOT PORTED: this
        // port's botl release point differs from C's, so setting the flag at
        // C's point costs 13 public steps (measured: seed0002 step 221,
        // seed0399 steps 398-411).  Revisit only with the release model.
        if (!otmp) {
            await pline('You don\'t have that object.');
            game._yn_need_more = true;
            continue;
        } else if (cnt < 0 || (otmp.quan || 1) < cnt) {
            await pline(`You don't have that many!  You have only ${otmp.quan || 1}.`);
            game._yn_need_more = true;
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
            return { key, cnt: 0 };   /* C: break with *count still 0 */
        } else {
            break;
        }
        if (cnt > 9) {
            game._pending_message = `Count: ${cnt}`;
            await flush_screen(1);
            const disp = game?.nhDisplay;
            if (disp?.setCursor)
                disp.setCursor(Math.min(game._pending_message.length, 79), 0);
        }
        key = await nhgetch();
    }
    game._pending_message = '';
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
    // C ref: do_wear.c Boots_off() case FUMBLE_BOOTS —
    //   if (!oldprop && !(HFumbling & ~TIMEOUT)) HFumbling = EFumbling = 0;
    // Removing the boots cancels the pending fumble timer outright, so the
    // per-turn slip/trip stops on the same turn.
    if ((mask & WA_ARMF) && game.uarmf?.otyp === FUMBLE_BOOTS && game.u) {
        if (!(game.u.HFumblingOutside || 0)) {
            game.u.HFumbling = 0;
            game.u.EFumbling = 0;
        }
    }
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
function setworn_accessory(obj, mask) {
    if (obj === game.uwep) setuwep_slot(null);
    else if (obj === game.uswapwep) setuswapwep(null);
    else if (obj === game.uquiver) setuqwep(null);
    obj.owornmask = (obj.owornmask || 0) | mask;
    if (mask === W_RINGL) game.uleft = obj;
    else if (mask === W_RINGR) game.uright = obj;
    else if (mask === W_AMUL) game.uamul = obj;
    else if (mask === W_BLINDF) game.ublindf = obj;
}
function clearworn_accessory(obj) {
    const m = obj.owornmask || 0;
    if (m & W_RINGL) game.uleft = null;
    if (m & W_RINGR) game.uright = null;
    if (m & W_AMUL) game.uamul = null;
    if (m & W_BLINDF) game.ublindf = null;
    obj.owornmask = m & ~W_ACCESSORY;
}

// C ref: do_wear.c Ring_on(obj) — applies a ring's on-effect after setworn().
// The ring is already in uleft/uright.  Attribute and protection rings adjust
// the relevant stat / AC; every other ring confers its extrinsic purely through
// the owornmask (no message, no RNG) and falls through the default no-op.
export async function Ring_on(obj) {
    // C ref: do_wear.c:1242 — oldprop is the property's extrinsic from the OTHER
    // hand; C masks W_RING out unless BOTH rings confer it.
    const other = (obj === game.uleft) ? game.uright : game.uleft;
    const oldprop = !!other && other.otyp === obj.otyp;
    switch (obj.otyp) {
    case RIN_STEALTH:
        await toggle_stealth(obj, oldprop, true);
        break;
    case RIN_WARNING:
        /* see_monsters(): display refresh, no JS equivalent (do_wear.js) */
        break;
    case RIN_SEE_INVISIBLE:
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
            await pline('Gee!  All of a sudden, you can see right through yourself.');
        }
        break;
    case RIN_LEVITATION:
        /* float_up()/float_vs_flight() (hack.c) are not ported; the extrinsic
           itself rides on the worn mask.  See do_wear.js Boots_on(). */
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
        if (objects[ringtype]?.oc_charged) ring.known = 1;
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
function poly_gender() {
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
        // can_be_strangled(): the hero has a head and breathes unless polymorphed
        // into a breathless/headless form, which this port never does.
        if (!u?.Strangled) {
            makeknown(AMULET_OF_STRANGULATION);
            u.Strangled = 6;
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
async function Blindf_on(obj) {
    const { Blind, vision_recalc } = await import('./vision.js');
    const already_blind = Blind();
    setworn_accessory(obj, W_BLINDF);
    await on_msg_accessory(obj);
    if (Blind() && !already_blind) {
        // flags.verbose defaults TRUE in these sessions.  update_topl (C pline)
        // accumulates after the "You are now wearing ..." line.
        if (game.flags?.verbose !== false) await update_topl("You can't see any more.");
        // toggle_blindness(): status update + immediate vision recalc.
        game.vision_full_recalc = 1;
        vision_recalc(0);
    }
}

// C ref: do_wear.c Blindf_off(obj) — clear the eyewear slot (does its own
// off_msg "You were wearing ..."), then if sight is regained emit "You can see
// again." and toggle blindness (recompute vision so the room reappears).
async function Blindf_off(obj) {
    const { Blind, vision_recalc } = await import('./vision.js');
    const was_blind = Blind();
    clearworn_accessory(obj);
    // off_msg(): no redundant "(being worn)" suffix after removal.
    // C ref: do_wear.c:68 off_msg() — the whole message is `if (flags.verbose)`.
    if (game.flags?.verbose !== false)
        await update_topl(`You were wearing ${doname_invent(obj)}.`);
    if (!Blind() && was_blind) {
        // gulp_blnd_check() (covered by mouth) is false here.
        await update_topl('You can see again.');
        game.vision_full_recalc = 1;
        vision_recalc(0);
        learn_unseen_invent();   // toggle_blindness() tail (potion.c:362)
    }
}

// C ref: do_wear.c Ring_off_or_gone(obj, gone) — the shared tail of Ring_off()
// (the hero deliberately removes it) and Ring_gone() (it leaves the finger
// without being taken off: stolen, destroyed, polymorphed).  Both clear the
// worn slot and then undo whatever on-effect Ring_on() applied.
function Ring_off_or_gone(obj, _gone) {
    // C ref: do_wear.c:1347 — takeoff.mask loses this ring's slot bit first.
    const mask = (obj.owornmask | 0) & (W_RINGL | W_RINGR);
    takeoff_ctx().mask &= ~mask;
    // setnotworn(obj) / setworn(0, owornmask): either way the finger is freed
    // and the extrinsic (carried by the owornmask here) goes with it.
    const other = (obj === game.uleft) ? game.uright : game.uleft;
    const still_from_other = !!other && other.otyp === obj.otyp;
    clearworn_accessory(obj);
    const spe = obj.spe | 0;
    switch (obj.otyp) {
    case RIN_STEALTH:
        toggle_stealth(obj, still_from_other, false);
        break;
    case RIN_WARNING:
        break;
    case RIN_SEE_INVISIBLE:
        if (game.u?.uprops?.Invis && !Blind_for_wear()) {
            newsym(game.u.ux, game.u.uy);
            pline('Suddenly you cannot see yourself.');
            learnring(obj, true);
        }
        break;
    case RIN_INVISIBILITY:
        if (!still_from_other && !game.u?.uprops?.HInvis && !Blind_for_wear()) {
            newsym(game.u.ux, game.u.uy);
            pline(`Your body seems to unfade${game.u?.uprops?.See_invisible ? ' completely' : '..'}.`);
            learnring(obj, true);
        }
        break;
    case RIN_LEVITATION:
        /* float_down() (hack.c): not ported, see Ring_on(). */
        break;
    case RIN_PROTECTION_FROM_SHAPE_CHAN:
        /* restartcham() (mon.c): no RNG */
        break;
    case RIN_PROTECTION:
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
export function Ring_off(obj) { Ring_off_or_gone(obj, false); }
export function Ring_gone(obj) { Ring_off_or_gone(obj, true); }

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
        if (game.u?.Strangled) {
            game.u.Strangled = 0;
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
    // donning(obj) -> cancel_don(): a multi-turn dressing maneuver in progress
    // on this very object is aborted.  The occupation machinery is the port's
    // start_occupation(); a stolen item is never mid-don in these sessions.
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
        Ring_gone(obj);
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
    const { Some_Monnam } = await import('./steal.js');
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
        prinv(null, obj, 0);
        // C ref: prinv() -> pline() leaves toplin == NEED_MORE, so a following
        // same-turn message (e.g. a monster's attack on the freed turn)
        // accumulates onto the worn-confirmation line via update_topl() instead
        // of replacing it (matches the wield prinv path above).
        game._toplin = 1;
        return;
    }
    // C ref: on_msg() verbose branch uses an(xname(otmp)) — no worn-status
    // suffix (xname omits it), so use simple_obj_name not doname_invent.  Route
    // through update_topl (C pline) so a same-turn follow-up (blindness or a
    // monster's "It bites!") accumulates on the topline instead of replacing it.
    // C: `how` is " around your <head>" for a towel and empty otherwise.
    const how = (obj.otyp === TOWEL) ? ` around your ${body_part(8 /*HEAD*/)}` : '';
    await update_topl(`You are now wearing ${simple_obj_name(obj, { buc: false })}${how}.`);
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
            if (game.uarmg && game.u?.Glib) {
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
        // C ref: do_wear.c accessory_or_armor_on — nomul(-delay) makes the hero
        // busy "dressing up" for `delay` game turns; nomovemsg is shown when the
        // occupation finishes.  Crucially, while multi < 0 the moveloop SKIPS the
        // intrinsic autosearch (allmain.c:342 guard `gm.multi >= 0`), so a hero
        // with Searching does not roll dosearch0() during the maneuver.
        //
        // The donning turns run inline here: in C the 'W' command's getobj()
        // reads the object-letter key (the recorded 'j' that follows 'W'), then
        // accessory_or_armor_on() calls nomul(-delay) and the moveloop runs the
        // `delay` elapsed turns before the next keystroke is polled — all within
        // the processing of that object-letter key, so the recorded screen for
        // it shows "You finish your dressing maneuver".  run_dress_occupation
        // advances exactly `delay` game turns with multi<0 (which suppresses the
        // intrinsic autosearch) and clears multi when done.
        // C ref: do_wear.c sets ga.afternmv to the slot's *_on routine before
        // nomul(-delay); unmul() runs it after the maneuver finishes.  Boots get
        // Boots_on (speed-up message + makeknown for speed boots); the body-armor
        // suit gets Armor_on (dragon scale mail's dragon_armor_handling); the
        // other slots' afternmv effects aren't exercised by the scored sessions.
        await run_dress_occupation(delay, 'You finish your dressing maneuver.',
                                   armor_on_fn(mask));
        if (game._allow_inventory_update !== undefined) update_inventory();
        return ECMD_OK;
    }
    // C ref: do_wear.c accessory_or_armor_on() — with no delay, unmul("") runs
    // the afternmv IMMEDIATELY and then on_msg().  Cloaks, shields and shirts all
    // have oc_delay 0, so this is the only path that reaches Cloak_on() (oilskin
    // "fits very tightly", elven-cloak stealth, displacement, invisibility).
    const on_fn = armor_on_fn(mask);
    if (on_fn) await on_fn();
    // C ref: do_wear.c on_msg() — `an(xname(otmp))`, NOT doname(): xname omits
    // both the enchantment and the "(being worn)" suffix setworn() just added.
    // C ref: do_wear.c on_msg() is pline() -> update_topl(): when the slot's
    // *_on() already put a line up (Cloak_on's displacement notice), this must
    // page it with --More-- rather than overwrite it (seed0360 step 497).
    await update_topl(`You are now wearing ${simple_obj_name(obj, { buc: false })}.`);
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

// C ref: hack.c nomul(-delay) + allmain.c moveloop_core() multi<0 occupation
// loop.  Drive a `delay`-turn immobile occupation inline: set multi negative so
// the per-turn autosearch is skipped, advance `delay` game turns of monster
// movement, then unmul() — print the finish message and run afternmv.
async function run_dress_occupation(delay, msg, afternmv) {
    const g = game;
    g.multi = -delay;
    g.multi_reason = 'dressing up';
    if (g.u && g.u.umovement == null) g.u.umovement = 12; // NORMAL_SPEED
    let guard = 0;
    // C ref: allmain.c moveloop_core() — the immobile occupation elapses one
    // game TURN per `++gm.multi`, and `++gm.multi` runs at the END of the
    // once-per-turn block (after the autosearch check at allmain.c:343).  A
    // single moveloop_turn() call may run a monster-movement pass WITHOUT
    // elapsing a turn (the hero had leftover umovement), in which case C does
    // not increment multi; only count an elapsed turn when 'moves' advanced.
    // Gating on multi (not on a fixed moves delta) keeps the autosearch — run
    // inside moveloop_turn while multi is still < 0 — suppressed on every
    // occupation turn, including the last, exactly as in C.
    while (g.multi < 0 && guard++ < 60) {
        await moveloop_turn();
        // C ref: allmain.c:453 — find_ac() is in the once-per-player-input block
        // of moveloop_core(), which an occupation re-enters on every elapsed
        // turn.  Running these turns inline here skipped it, so u.uac never went
        // stale-then-fresh and C's turn-2 AC_VALUE draw went missing.
        find_ac();
        // moveloop_turn() already performs the C ref allmain.c:380 `++gm.multi`
        // (and unmul when it reaches 0) inside the once-per-turn block, so the
        // occupation count is driven entirely by moveloop_turn — do NOT also
        // increment here (that would halve the maneuver length).
    }
    if (g.multi < 0) g.multi = 0; // safety: never leave the hero stuck busy
    // unmul(): clear busy state, print nomovemsg, THEN run afternmv (hack.c
    // unmul() prints gn.nomovemsg before invoking ga.afternmv).  Both messages
    // accumulate on the topline, so the finished maneuver and the afternmv
    // effect (e.g. "You feel yourself speed up.") share one "--More--" frame.
    g.multi = 0;
    g.multi_reason = null;
    if (msg) await update_topl(msg);
    if (afternmv) await afternmv();
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
// donning delay.  For a no-delay item the slot clears immediately and the
// "You were wearing ..." feedback follows the removal.
// C ref: do_wear.c armoroff() — objects[].oc_armcat picks both the "You finish
// taking off your %s." noun and the <Armor>_off() routine that undoes the
// piece's side effects (helm of brilliance INT/WIS, cornuthaum CHA, gauntlets of
// dexterity DEX, elven-cloak stealth, ...).  Clearing the slot alone left those
// bonuses applied forever.
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
        start_occupation(delay, `You finish taking off your ${armor_simple_name(otmp)}.`,
            async () => {
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
    if (game.u?.Glib && obj.bknown
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
async function select_off(obj) {
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
        } else if (game.uarmg && (game.uarmg.cursed || u?.Glib)) {
            buf = `take off your ${u?.Glib ? 'slippery ' : ''}${gloves_simple_name(game.uarmg)}`;
            why = u?.Glib ? null : game.uarmg;
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
        } else if (u?.Glib) {
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
            buf = `release your ${is_sword(game.uwep) ? 'sword' : 'weapon'}`;
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
    if ((obj.owornmask || 0) & WA_ARMOR_ALL) {
        await armoroff(obj);
    } else if (obj === game.uright || obj === game.uleft) {
        // C ref: off_msg() BEFORE Ring_off() so the "(on right hand)" suffix
        // is still present — "You were wearing a clay ring (on right hand)."
        if (game.flags?.verbose !== false)   // off_msg(): flags.verbose gated
            await pline(`You were wearing ${doname_invent(obj)}.`);
        clearworn_accessory(obj);
        if (obj.otyp === RIN_PROTECTION) find_ac();
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

// C ref: do_wear.c do_takeoff() — remove ONE slot's item; the body of the
// disrobing occupation the 'A' command drives.  NOT ported: take_off()'s
// per-item oc_delay occupation, so the caller removes everything on its own
// turn.
export async function takeoff_worn_obj(obj) {
    if (!obj) return ECMD_OK;
    if ((obj.owornmask || 0) & (WA_ARMOR_ALL | W_ACCESSORY))
        return await armor_or_accessory_off(obj);
    const was_twoweap = !!game.u?.twoweap;
    if (obj === game.uwep) {
        if (welded(obj)) return ECMD_OK;
        setuwep_slot(null);
        await pline(was_twoweap ? 'You are no longer wielding either weapon.'
                                : `You are ${empty_handed()}.`);
    } else if (obj === game.uswapwep) {
        setuswapwep(null);
        await pline(was_twoweap ? 'You are no longer wielding two weapons at once.'
                                : 'You no longer have a second weapon readied.');
    } else if (obj === game.uquiver) {
        setuqwep(null);
        await pline('You no longer have ammunition readied.');
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
    if (is_plural(obj)) return verb;
    if (/^are$/i.test(verb)) return 'is';
    if (/^have$/i.test(verb)) return 'has';
    if (/[^aeiou]y$/.test(verb)) return verb.slice(0, -1) + 'ies';
    if (/(s|x|z|ch|sh)$/.test(verb)) return verb + 'es';
    return verb + 's';
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
function untwoweapon() {
    if (game.u?.twoweap) {
        game._pending_message = 'You can no longer use two weapons at once.';
        game.u.twoweap = false;
        update_inventory();
    }
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
        game._pending_message = `You have nothing to ready for firing.`;
        return ECMD_OK;
    }

    let newquiver = await getobj(verb, ready_ok, GETOBJ_PROMPT | GETOBJ_ALLOWCNT);

    if (!newquiver) {
        return ECMD_CANCEL; // cancelled (quitchars)
    } else if (newquiver === hands_obj) { // '-' : explicitly nothing
        if (game.uquiver) {
            game._pending_message = 'You now have no ammunition readied.';
            setuqwep(null);
        } else {
            game._pending_message = 'You already have no ammunition readied!';
        }
        return ECMD_OK;
    } else if (newquiver === game.uquiver) {
        game._pending_message = 'That ammunition is already readied!';
        return ECMD_OK;
    } else if (newquiver.owornmask & QW_ARMOR_ALL) {
        // C: reject worn armor/accessory/saddle.  Only the armor bits (W_ARM..
        // W_ARMU == 0x7f, same scheme u_init.js uses) are ever set in these
        // sessions; accessory/saddle use higher prop.h bits that never appear.
        game._pending_message = `You cannot ${verb} that!`;
        return ECMD_OK;
    } else if (newquiver === game.uwep) {
        // readying the wielded weapon needs confirmation; the sessions reach the
        // single-item phrasing (quan 1, no welding).
        const use_plural = is_plural(game.uwep) || pair_of(game.uwep);
        const qbuf = `You are wielding ${!use_plural ? 'that' : 'those'}.  Ready ${!use_plural ? 'it' : 'them'} instead?`;
        if (await ynq(qbuf) !== 'y') {
            game._pending_message = `Your ${simpleonames(game.uwep)} ${otense(game.uwep, 'remain')} wielded.`;
            return ECMD_OK;
        }
        setuwep_slot(null);
        untwoweapon();
        was_uwep = true;
    } else if (newquiver === game.uswapwep) {
        const use_plural = is_plural(game.uswapwep) || pair_of(game.uswapwep);
        const qbuf = `${!use_plural ? 'That is' : 'Those are'} your ${game.u?.twoweap ? 'second' : 'alternate'} weapon.  Ready ${!use_plural ? 'it' : 'them'} instead?`;
        if (await ynq(qbuf) !== 'y') {
            game._pending_message = `Your ${simpleonames(game.uswapwep)} ${otense(game.uswapwep, 'remain')} ${game.u?.twoweap ? 'wielded' : 'as secondary weapon'}.`;
            return ECMD_OK;
        }
        setuswapwep(null);
        untwoweapon();
    }

    // quivering: C ref: wield.c — "ready" quivers first so the line shows
    // "(at the ready)"; "fire" prints "You ready: ..." BEFORE quivering so it
    // does not.
    if (verb === 'ready') {
        setuqwep(newquiver);
        prinv(null, newquiver, 0);
    } else {
        prinv('You ready:', newquiver, 0);
        setuqwep(newquiver);
    }

    let res = 0;
    if (was_uwep) {
        game._pending_message = `You are now ${empty_handed()}.`;
        res = 1;
    } else if (was_twoweap && !game.u?.twoweap) {
        game._pending_message = 'You are no longer wielding two weapons at once.';
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
// swords, the tsurugi, all the polearms, the dwarvish mattock, and the
// quarterstaff.  Used both for the wield-with-shield restriction and for the
// "(weapon in hands)" inventory phrasing.
const BIMANUAL_OTYPS = new Set([
    45 /*BATTLE_AXE*/, 55 /*TWO_HANDED_SWORD*/, 57 /*TSURUGI*/,
    59 /*PARTISAN*/, 60 /*RANSEUR*/, 61 /*SPETUM*/, 62 /*GLAIVE*/,
    63 /*HALBERD*/, 64 /*BARDICHE*/, 65 /*VOULGE*/, 66 /*FAUCHARD*/,
    67 /*GUISARME*/, 68 /*BILL_GUISARME*/, 69 /*LUCERN_HAMMER*/,
    70 /*BEC_DE_CORBIN*/, 71 /*DWARVISH_MATTOCK*/, 79 /*QUARTERSTAFF*/,
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

// C ref: artifact.c retouch_object() restricted to the wield path.  Consults
// touch_artifact() (drawing rn2(4) for SPFX_RESTR artifacts) and, for silver-
// haters / bane targets, would inflict damage.  Returns true when the hero can
// keep handling the object.  The recorded hero (Neutral archeologist) does not
// hate silver and is not a bane target, so after touch_artifact the function
// returns true with no further RNG.
function retouch_object(obj) {
    // C: a silver-hating hero may still perform the invocation ritual.
    if (obj?.otyp === BELL_OF_OPENING && game._invocation_pos) return true;
    if (touch_artifact(obj, game.youmonst)) {
        const ag = (objects[obj.otyp]?.material === 14 /* SILVER */) && Hate_silver();
        // bane_applies(): needs a polymorphed bane-target hero, not modelled.
        const bane = false;
        if (!ag && !bane) return true;
        game._pending_message =
            `You can't handle ${yname(obj)}${obj.owornmask ? ' anymore' : ''}!`;
        // C ref: artifact.c:2535 — the damage is skipped when touch_artifact()
        // already blasted the hero this call.
        if (!game._touch_blasted) {
            let dmg = 0;
            if (ag) dmg += Maybe_Half_Phys(rnd(10));
            if (bane) dmg += rnd(10);
            losehp_invent(dmg);
            exercise(A_CON, false);
        }
    }
    // C: the worn item comes off either way (and the caller's `loseit` drop is
    // not reached from the wield path).
    return false;
}

// C ref: wield.c ready_weapon() — install `wep` as the primary weapon (or
// unwield when wep is null).  Returns an ECMD_* result.  Ports the paths the
// recorded sessions reach: unwield, plain wield with the "weapon in hand"
// prinv announcement, and the artifact retouch (rn2(4)).  Welding, shield/
// two-handed conflicts, corpse-wield, and talking/glowing-artifact effects are
// modelled but not exercised.
function ready_weapon(wep) {
    let res = ECMD_OK;
    const was_twoweap = !!game.u?.twoweap;
    const had_wep = !!game.uwep;

    if (!wep) {
        if (game.uwep) {
            game._pending_message = `You are ${empty_handed()}.`;
            setuwep_slot(null);
            res = ECMD_TIME;
        } else {
            game._pending_message = `You are already ${empty_handed()}.`;
        }
    } else if (game.uarms && bimanual(wep)) {
        game._pending_message =
            `You cannot wield a two-handed ${is_sword(wep) ? 'sword'
              : wep.otyp === 45 /*BATTLE_AXE*/ ? 'axe' : 'weapon'} while wearing a shield.`;
        res = ECMD_FAIL;
    } else if (!retouch_object(wep)) {
        res = ECMD_TIME; // takes a turn even though it doesn't get wielded
    } else {
        res = ECMD_TIME;
        if (will_weld(wep)) {
            // Cursed-artifact weld message (not exercised: welded() is false for
            // the recorded kits).  Kept minimal to avoid unported name helpers.
            game._pending_message =
                `${cxname_singular(wep)} ${wep.quan === 1 ? 'welds itself' : 'weld themselves'} to your `
                + `${bimanual(wep) ? makeplural(body_part(6)) : `dominant right ${body_part(6)}`}!`;
            wep.bknown = 1;
        } else {
            // C kludge: temporarily set W_WEP so prinv() prints "(weapon in
            // <hand>)", then restore the mask before setuwep() applies it for
            // real.
            const dummy = wep.owornmask || 0;
            wep.owornmask = dummy | QW_WEP;
            prinv(null, wep, 0);
            wep.owornmask = dummy;
            // C ref: prinv() -> pline() leaves toplin == NEED_MORE, so a
            // following same-turn message (e.g. a pet's attack on the freed
            // turn) accumulates onto the wield line instead of replacing it.
            game._toplin = 1;
        }
        setuwep_slot(wep);
        if (was_twoweap && !game.u?.twoweap) {
            // (skip the two-weapon-ended message when already empty-handed)
        }
        // Talking / light artifacts: Grayswandir neither speaks nor glows, so
        // no further effects or RNG here.
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
    // cantwield (polymorph into a handless form) never applies for the
    // recorded human hero.
    clear_splitobjs();
    const wep = await getobj('wield', wield_ok, GETOBJ_PROMPT | GETOBJ_ALLOWCNT);
    if (!wep) {
        return ECMD_CANCEL; // cancelled
    } else if (wep === game.uwep) {
        game._pending_message = 'You are already wielding that!';
        if (is_weptool(wep)) game.unweapon = false;
        return ECMD_FAIL;
    } else if (welded(game.uwep)) {
        weldmsg(game.uwep);
        return ECMD_FAIL;
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
        game._pending_message = 'You cannot wield that!';
        return ECMD_FAIL;
    }

    const oldwep = game.uwep;
    const result = ready_weapon(newwep);
    if (game.flags?.pushweapon && oldwep && game.uwep !== oldwep)
        setuswapwep(oldwep);
    untwoweapon();
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
    // cantwield(): only a handless/polymorphed hero, never the recorded human.
    if (welded(game.uwep)) {
        weldmsg(game.uwep);
        return ECMD_FAIL;
    }

    const oldwep = game.uwep, oldswap = game.uswapwep;
    setuswapwep(null);
    const result = ready_weapon(oldswap);     // prints the new primary's line
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
        if (!(await can_twoweapon())) untwoweapon();
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

// Role mnums used by the multishot bonuses (js/invent.js ARTI_TOUCH_PROPS
// numbers the roles the same way u_init.c does).
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

// C ref: include/artilist.h index of Mjollnir (ARTI_TOUCH_PROPS above numbers
// the artifacts the same way).
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
function bhit_thrown_landing(dx, dy, range) {
    let bx = game.u.ux, by = game.u.uy;
    let hitmon = null;
    for (let r = range; r > 0; r--) {
        const nx = bx + dx, ny = by + dy;
        if (!throw_isok(nx, ny)) break;
        bx = nx; by = ny;
        const loc = game.level.at(bx, by);
        const typ = loc?.typ ?? 0;
        // C: `mtmp = m_at(x, y); ... if (mtmp) { result = mtmp; goto bhit_done; }`
        // comes BEFORE the ZAP_POS/closed-door test, so a monster standing in a
        // doorway is still hit.
        const mtmp = m_at(bx, by);
        if (mtmp) { hitmon = mtmp; break; }
        if (!throw_zap_pos(typ) || throw_closed_door(loc)) { bx -= dx; by -= dy; break; }
    }
    if (hitmon) return { x: bx, y: by, mon: hitmon };
    return { x: bx, y: by, mon: null };
}

// ── thrown-object combat (C ref: dothrow.c thitmonst / uhitm.c hmon) ─────────
//
// The whole "a thrown weapon can hit a monster" path was missing: bhit() walked
// past every monster and throwit() just dropped the object.  That skipped
// thitmonst()'s rnd(20) to-hit roll, hmon()'s damage roll and exercise()'s
// rn2(19) — three calls that put the rest of the session's PRNG stream out of
// phase (the whole seed-elf-ranger wall).
//
// The hmon() slice below is HMON_THROWN only.  It delegates every shared piece
// (dmgval, killed, monflee, wakeup, mon_nam) to js/uhitm.js's exports; the parts
// that stay local are the ones uhitm.js keeps module-private.  See the deferred
// note: exporting uhitm.c's hmon() would let this call it directly.

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

// C ref: zap.c exclam(force) / hit(str, mtmp, force) / miss(str, mtmp).
function exclam_thrown(force) { return force < 0 ? '?' : (force <= 4 ? '.' : '!'); }
async function hit_thrown(str, mon, force) {
    const { canspotmon, mon_nam } = await import('./uhitm.js');
    const verbose = game.flags?.verbose !== false;
    const named = verbose && (cansee(mon?.mx, mon?.my) || canspotmon(mon));
    await update_topl(`The ${str} ${is_plural_str(str) ? 'hit' : 'hits'} ${
        named ? mon_nam(mon) : 'it'}${force}`);
}
// C ref: hacklib.c ordin(n) — "1st", "2nd", "3rd", "4th", ... (11/12/13 take
// "th").
function ordin(n) {
    const dd = n % 10;
    return (dd === 0 || dd > 3 || (n % 100) / 10 === 1) ? 'th'
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
// C ref: hacklib.c vtense() as used by hit()/tmiss(): a plural subject takes the
// bare verb ("The daggers hit"), a singular one takes the -s form.
function is_plural_str(s) { return /s$/.test(s) && !/ss$/.test(s); }

// C ref: dothrow.c tmiss(obj, mon, maybe_wakeup) — the thrown-object miss
// message, then a 1-in-3 wakeup.  The rn2(3) is part of the recorded stream even
// when the monster is already awake.
async function tmiss(obj, mon, maybe_wakeup) {
    const { canspotmon, mon_nam, wakeupAttack } = await import('./uhitm.js');
    const missile = mshot_xname(obj);
    const verbose = game.flags?.verbose !== false;
    if (!canspotmon(mon)) {
        await update_topl(`The ${missile} ${is_plural_str(missile) ? 'miss' : 'misses'}.`);
    } else {
        const named = verbose && (cansee(mon?.mx, mon?.my) || canspotmon(mon));
        await update_topl(`The ${missile} ${is_plural_str(missile) ? 'miss' : 'misses'} ${
            named ? mon_nam(mon) : 'it'}.`);
    }
    if (maybe_wakeup && !rn2(3)) await wakeupAttack(mon, true);
}

// C ref: dog.c abuse_dog(mtmp), reached from uhitm.c hmon_hitmon_pet().
// Projectile attacks need the same pet complaint and wake-up side effects as
// hand-to-hand attacks; keeping this local preserves the thrown-path ordering.
async function abuse_dog_thrown(mtmp) {
    if (!mtmp.mtame) return;
    mtmp.mtame--;
    if (mtmp.mtame && !mtmp.isminion && mtmp.edog)
        mtmp.edog.abuse = (mtmp.edog.abuse || 0) + 1;
    if (mtmp.mx !== 0) {
        const { yelp, growl } = await import('./sounds.js');
        if (mtmp.mtame && rn2(mtmp.mtame)) await yelp(mtmp);
        else await growl(mtmp);
        if (!mtmp.mtame) newsym(mtmp.mx, mtmp.my);
    }
}

// C ref: uhitm.c hmon()/hmon_hitmon(mon, obj, HMON_THROWN, dieroll) — the
// thrown-object slice.  Returns TRUE when `mon` survives.
async function hmon_thrown(mon, obj, dieroll, skillsnap) {
    const U = await import('./uhitm.js');
    const { weapon_type, use_skill } = await import('./enhance.js');
    let dmg = 0, use_weapon_skill = false, train_weapon_skill = false;

    // C ref: uhitm.c hmon_hitmon_weapon() — a launcher, or ammo without its
    // matching launcher wielded, only does hmon_hitmon_weapon_ranged()'s rnd(2);
    // everything else thrown takes the melee arm and rolls dmgval().
    const ranged = is_launcher(obj)
        || (is_ammo(obj) && !ammo_and_launcher(obj, game.uwep));
    if (obj.oclass === WEAPON_CLASS || is_weptool(obj)) {
        if (ranged) {
            dmg = rnd(2);
        } else {
            use_weapon_skill = true;
            dmg = U.dmgval(obj, mon);
            train_weapon_skill = dmg > 1;
        }
        // C ref: uhitm.c:1048 — an elf/samurai firing their own arrow from
        // their own bow does one extra point.
        if ((is_ammo(obj) || is_missile(obj)) && ammo_and_launcher(obj, game.uwep))
            train_weapon_skill = dmg > 0;
    } else {
        // C ref: uhitm.c hmon_hitmon_misc_obj() default arm — weight-based.
        dmg = hmon_misc_obj_dmg_thrown(obj);
    }

    // C ref: uhitm.c hmon_hitmon_dmg_recalc() — u.udaminc (0 here) plus the
    // strength bonus, which a launcher-fired missile does NOT get, plus the
    // weapon-skill damage bonus.
    if (dmg > 0) {
        if (!(obj && game.uwep && ammo_and_launcher(obj, game.uwep)))
            dmg += dbon_thrown();
        if (use_weapon_skill) {
            const fired = is_ammo(obj) && ammo_and_launcher(obj, game.uwep);
            const skillwep = fired ? game.uwep : obj;
            dmg += weapon_dam_bonus_thrown(fired ? skillsnap.wep : skillsnap.obj,
                                          skillsnap,
                                          fired ? skillsnap.wep_type : skillsnap.obj_type);
            if (train_weapon_skill) use_skill(weapon_type(skillwep), 1);
        }
    }
    if (dmg < 1) dmg = 1;      /* get_dmg_bonus is TRUE; target is no shade */

    mon.mhp = (mon.mhp || 0) - dmg;
    if (mon.mhpmax != null && mon.mhp > mon.mhpmax) mon.mhp = mon.mhpmax;
    const destroyed = mon.mhp <= 0;

    // C ref: uhitm.c hmon_hitmon_pet() — runs BEFORE killed().
    if (mon.mtame && dmg > 0) {
        await abuse_dog_thrown(mon);
        if (mon.mtame && !destroyed)
            await U.monflee(mon, 10 * rnd(dmg), false, false);
    }

    if (!destroyed)
        await hit_thrown(mshot_xname(obj), mon, exclam_thrown(dmg));

    if (destroyed) {
        await U.killed(mon);
        return false;
    }
    // C ref: uhitm.c:1918 `wakeup(mon, TRUE)` — the knockback arm below it is
    // gated on `!thrown`, so a thrown hit never rolls it.
    await U.wakeupAttack(mon, true);
    return true;
}

// C ref: attrib.c dbon() — strength damage bonus (same table as js/uhitm.js).
// C ref: skills.h martial_bonus() = Role_if(SAMURAI) || Role_if(MONK).
const PM_MONK_INV = 5, PM_SAMURAI_INV = 9;
function martial_bonus_inv() {
    const m = game.urole?.mnum;
    return m === PM_MONK_INV || m === PM_SAMURAI_INV;
}
const dbon_thrown = dbon;   // js/weapon.js owns the complete weapon.c:993
// C ref: weapon.c:1644 weapon_dam_bonus(weapon).  The old copy took a bare
// skill LEVEL, so it had no P_NONE arm (a thrown non-weapon read -2 instead of
// 0), no two-weapon arm and no riding term.
function weapon_dam_bonus_thrown(skill, snap, type) {
    return weapon_dam_bonus_core(type, skill, snap.wep, {
        martial: snap.martial, usteed: snap.usteed,
        twoweap: snap.twoweap, skill_riding: snap.riding,
    });
}
// C ref: uhitm.c hmon_hitmon_misc_obj() default arm — `dmg = (obj->owt + 99)
// / 100` capped, i.e. an ordinary object hurts by its weight.
function hmon_misc_obj_dmg_thrown(obj) {
    const wt = obj?.owt || 0;
    let dmg = Math.trunc((wt + 99) / 100);
    if (dmg > 6) dmg = 6;
    return dmg;
}

// C ref: dothrow.c thitmonst(mon, obj) — a thrown object arrives at a monster.
// Returns TRUE when the object has been disposed of (the caller must not place
// it on the floor).  Ports the WEAPON/weptool/GEM arm plus the shared miss tail;
// the gem-to-unicorn, quest-leader, iron-ball/boulder, egg/cream-pie/venom,
// potion and pet-food arms are left for the caller-visible cases they need.
async function thitmonst(mon, obj, skillsnap) {
    const u = game.u;
    const otyp = obj.otyp;

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

    // C ref: dothrow.c:2054 — gloves hinder a bow.  GAUNTLETS_OF_POWER -2,
    // GAUNTLETS_OF_FUMBLING -3, leather/dexterity 0.
    if (game.uarmg && game.uwep
        && (objects[game.uwep.otyp]?.oc_skill ?? 0) === P_BOW) {
        if (game.uarmg.otyp === GAUNTLETS_OF_POWER) tmp -= 2;
        else if (game.uarmg.otyp === GAUNTLETS_OF_FUMBLING) tmp -= 3;
    }

    tmp += omon_adj(mon, obj, true);
    // C: `is_orc(mon->data) && Race_if(PM_ELF)` — an elf aims better at orcs.
    if ((mflags2_of(mon.data) & M2_ORC) && Race_if_ELF_thrown()) tmp++;
    // C ref: dothrow.c:2078 — an engulfed hero cannot miss the engulfer.
    const guaranteed_hit = !!(u.uswallow && mon === u.ustuck);
    if (guaranteed_hit) tmp += 1000;

    // C ref: dothrow.c:2087 — a real gem thrown to a unicorn is a gift, not an
    // attack (rocks/gray stones and sling-fired gems are attacks).  This arm
    // sits BEFORE the rnd(20) to-hit roll, so falling through to it drew a
    // dieroll C never draws, on top of missing gem_accept()'s Luck change.
    if (obj.oclass === GEM_CLASS && is_unicorn_mon(mon.data)
        && objects[obj.otyp]?.material !== 10 /* MINERAL */ && !uslinging()) {
        if (mon.msleeping || !mon.mcanmove) {
            await tmiss(obj, mon, false);
            return false;
        } else if (mon.mtame) {
            const { Monnam } = await import('./uhitm.js');
            await update_topl(`${Monnam(mon)} catches and drops ${the_name_of(obj)}.`);
            return false;
        } else {
            const { Monnam } = await import('./uhitm.js');
            await update_topl(`${Monnam(mon)} catches ${the_name_of(obj)}.`);
            return !!(await DT.gem_accept(mon, obj));
        }
    }

    const dieroll = rnd(20);

    if (obj.oclass === WEAPON_CLASS || is_weptool(obj)
        || obj.oclass === GEM_CLASS) {
        if (is_ammo(obj)) {
            if (!ammo_and_launcher(obj, game.uwep)) {
                tmp -= 4;
            } else {
                // C ref: dothrow.c:2163 `tmp += uwep->spe - greatest_erosion(uwep)`
                // — a rusty bow aims worse; the erosion term was missing.
                tmp += (game.uwep.spe || 0) - greatest_erosion(game.uwep);
                tmp += weapon_hit_bonus_thrown(skillsnap.wep, skillsnap, skillsnap.wep_type);
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
        } else {
            if (otyp === BOOMERANG) tmp += 4;
            else if (throwing_weapon(obj)) tmp += 2;
            else tmp -= 2;      /* not meant to be thrown (obj == thrownobj) */
            tmp += weapon_hit_bonus_thrown(skillsnap.obj, skillsnap, skillsnap.obj_type);
        }

        if (tmp >= dieroll) {
            await hmon_thrown(mon, obj, dieroll, skillsnap);
            exercise(A_DEX, true);
            // C ref: dothrow.c should_mulch_missile(obj) — only ammo/missiles
            // (excluding boomerangs and magical ones) can shatter on impact.
            if (should_mulch_missile(obj)) { delobj_thrown(obj); return true; }
            // passive_obj(mon, obj, NULL) follows in C: only an acid/rusting/
            // corroding/enchantment-draining defender draws there, and none of
            // the erosion helpers it needs live in this file.
        } else {
            await tmiss(obj, mon, true);
        }
        return false;
    }

    // C ref: dothrow.c:2233 — a thrown iron ball or boulder is its own arm:
    // exercise(A_STR, TRUE) fires WHETHER OR NOT it connects, and the hit adds
    // exercise(A_DEX, TRUE).  Both exercises draw (attrib.c rn2(19)/rn2(2)),
    // so routing these through the shared miss tail lost draws.
    if (otyp === HEAVY_IRON_BALL_OTYP || otyp === BOULDER) {
        exercise(A_STR, true);
        if (tmp >= dieroll) {
            exercise(A_DEX, true);
            await hmon_thrown(mon, obj, dieroll, skillsnap);
        } else {
            await tmiss(obj, mon, true);
        }
        return false;
    }

    // C ref: dothrow.c:2256 — `(otyp == EGG || CREAM_PIE || BLINDING_VENOM ||
    // ACID_VENOM) && (guaranteed_hit || ACURR(A_DEX) > rnd(25))` -> hmon().
    // Falling through to tmiss() instead drew rn2(3) + rn2(100) and left
    // mcansee SET, changing that monster's every later distfleeck/m_move.
    if ((otyp === EGG || otyp === 287 /*CREAM_PIE*/
         || otyp === 479 /*BLINDING_VENOM*/ || otyp === 480 /*ACID_VENOM*/)
        && (guaranteed_hit || acurr_eff(A_DEX) > rnd(25))) {
        await hmon_misc_thrown(mon, obj);
        return true;                            /* hmon used it up */
    }

    // C ref: dothrow.c:2267 — thrown food a monster will accept, or any food a
    // tame pet rates ACCFOOD or better.  tamedog() runs dogfood() (an
    // obj_resists rn2(100)) and the miss it falls back to passes maybe_wakeup
    // FALSE, so C never rolls tmiss's rn2(3) here.  C's POTION_CLASS arm sits
    // just above this one and is still missing (potionhit() for a monster
    // target is not ported), so a thrown potion still reaches this test.
    const { dogfood } = await import('./dogmove.js');
    if (DT.befriend_with_obj(mon.data, obj)
        || (mon.mtame && dogfood(mon, obj) <= ACCFOOD)) {
        if (await DT.tamedog(mon, obj, true))
            return true;                        /* obj is gone */
        await tmiss(obj, mon, false);
        mon.msleeping = 0;
        mon.mstrategy = (mon.mstrategy | 0) & ~STRAT_WAITMASK;
        return false;
    }

    // C ref: dothrow.c:2276 — an engulfed hero's throw simply vanishes into the
    // engulfer; there is no miss roll and no wakeup rn2(3).
    if (guaranteed_hit) {
        const U = await import('./uhitm.js');
        await U.wakeupAttack(mon, true);
        await update_topl(`${Tobjnam_throw(obj, 'vanish')} into ${U.mon_nam(mon)}.`);
        return false;
    }

    // Non-weapon thrown objects: C's remaining arms end in the same tmiss().
    await tmiss(obj, mon, true);
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

// C ref: uhitm.c hmon_hitmon_misc_obj()'s EGG / CREAM_PIE / BLINDING_VENOM /
// ACID_VENOM arms, reached from thitmonst()'s HMON_THROWN call.  These four
// share the "obj is used up" contract but nothing else: an ordinary egg does 1
// physical damage and exercises Wisdom DOWN, a cream pie or blinding venom
// blinds for rn1(25,21) and does none, and acid venom does dmgval().
async function hmon_misc_thrown(mon, obj) {
    const U = await import('./uhitm.js');
    const { mbodypart } = await import('./monmove.js');
    const otyp = obj.otyp;
    const cnt = obj.quan || 1;
    let dmg = 0;

    if (otyp === EGG) {
        dmg = 1;
        // C: breaking your own (fertile) eggs is bad luck.
        if (obj.spe && (obj.corpsenm | 0) >= 0)
            change_luck(-Math.min(cnt, 5));
        const eggp = ((obj.corpsenm | 0) >= 0 && obj.known)
            ? the_str(monster_by_pmidx(obj.corpsenm)?.name || 'egg')
            : (cnt > 1 ? 'some' : 'an');
        await update_topl(`You hit ${U.mon_nam(mon)} with ${eggp} egg${cnt > 1 ? 's' : ''}.`);
        await update_topl('Splat!');
        exercise(A_WIS, false);
    } else if (otyp === 480 /* ACID_VENOM */) {
        await update_topl(`Your venom burns ${U.mon_nam(mon)}!`);
        dmg = U.dmgval(obj, mon);
    } else { /* CREAM_PIE or BLINDING_VENOM */
        mon.msleeping = 0;
        if (Blinded_hero()) {
            await update_topl(otyp === 287 ? 'Splat!' : 'Splash!');
        } else if (otyp === 479 /* BLINDING_VENOM */) {
            await update_topl(`The venom blinds ${U.mon_nam(mon)}${mon.mcansee ? '' : ' further'}!`);
        } else {
            const what = `The ${xname(obj)}`;
            const whom = `${s_suffix(U.mon_nam(mon))} ${mbodypart(mon, 2 /*FACE*/)}`;
            await update_topl(`${what} splashes over ${whom}!`);
        }
        mon.mpeaceful = 0;
        mon.mcansee = 0;
        const blind = rn2(25) + 21;             // rn1(25, 21)
        mon.mblinded = Math.min(127, (mon.mblinded || 0) + blind);
        dmg = 0;                                 /* get_dmg_bonus is FALSE */
    }

    if (dmg > 0) {
        mon.mhp = (mon.mhp || 0) - dmg;
        if (mon.mhpmax != null && mon.mhp > mon.mhpmax) mon.mhp = mon.mhpmax;
    }
    // C ref: uhitm.c useup_eggs()/obfree() for a THROWN object — gone with no
    // obj_resists roll (unlike delobj()).
    delobj_thrown(obj);
    if (dmg > 0 && mon.mhp <= 0) await U.killed(mon);
}

// C ref: weapon.c weapon_hit_bonus(weapon) — skill-based to-hit modifier (the
// riding and two-weapon arms don't apply to a throw).
// C ref: weapon.c:1545 weapon_hit_bonus(weapon) — same completeness gap the
// damage copy had (no P_NONE arm, no two-weapon arm, no riding penalty).
function weapon_hit_bonus_thrown(skill, snap, type) {
    return weapon_hit_bonus_core(type, skill, snap.wep, {
        martial: snap.martial, usteed: snap.usteed,
        twoweap: snap.twoweap, skill_riding: snap.riding,
    });
}

// C ref: dothrow.c should_mulch_missile(obj).
function should_mulch_missile(obj) {
    if (!obj || !(is_ammo(obj) || is_missile(obj))
        || obj.otyp === BOOMERANG || objects[obj.otyp]?.oc_magic)
        return false;
    const chance = 3 + greatest_erosion(obj) - (obj.spe || 0);
    let broken = chance > 1 ? (rn2(chance) !== 0) : (rn2(4) === 0);
    if (obj.blessed && (game.context?.mon_moving ? (rn2(3) !== 0) : (rnl(4) !== 0)))
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
        game._pending_message = `${the_name_of(obj).replace(/^the /, 'The ')} must be wielded before it can be thrown.`;
        return ECMD_OK;
    }
    if ((obj.oartifact === ART_MJOLLNIR && acurr_eff(A_STR) < STR19_25)
        || (obj.otyp === BOULDER && !throws_rocks_flag(youmonst_data()))) {
        game._pending_message = "It's too heavy.";
        return ECMD_TIME;
    }
    if (!u.dx && !u.dy && !u.dz) {
        game._pending_message = 'You cannot throw an object at yourself.';
        return ECMD_OK;
    }
    // C ref: dothrow.c:1146 `u_wipe_engr(2)` — throwing scuffs an engraving
    // underfoot, and wipe_engr_at() draws rn2() whenever one is there.
    if (engr_at(u.ux, u.uy)) wipe_engr_at(u.ux, u.uy, 2, false);
    // C ref: dothrow.c:139 — a bare-handed throw of a cockatrice corpse is
    // fatal.  The message is printed before instapetrify() takes over.
    if (!game.uarmg && obj.otyp === CORPSE && corpse_petrifies(obj)
        && !(game.u?.uprops?.StoneResistance)) {
        game._pending_message = `You throw ${the_name_of(obj)} with your bare ${
            makeplural(body_part(6 /*HAND*/))}.`;
        instapetrify(`throwing ${xname(obj)} bare-handed`);
    }
    if (welded(obj)) { weldmsg(obj); return ECMD_TIME; }
    // C ref: dothrow.c:155 `if (is_wet_towel(obj)) dry_a_towel(obj, -1, FALSE)`
    // — throwing a wet towel dries it one step.  No RNG, but the towel's spe is
    // what a later apply reads.
    if (is_wet_towel(obj)) obj.spe = Math.max(0, (obj.spe | 0) - 1);

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
            next_ident();        // splitobj -> nextoid -> next_ident: rnd(2)
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
        // C ref: weapon.c P_SKILL(skill) reads u.weapon_skills[], persistent
        // state that u_init.c skill_init() fills once.  js/enhance.js instead
        // REBUILDS it from the weapons the hero is currently CARRYING, so it has
        // to be sampled before freeinv() takes the missile out of inventory -
        // otherwise a thrown dagger reads P_UNSKILLED and thitmonst()'s to-hit
        // lands 4 too low.
        const _enh = await import('./enhance.js');
        const skillsnap = {
            obj: _enh.p_skill_of(_enh.weapon_type(otmp)),
            wep: game.uwep ? _enh.p_skill_of(_enh.weapon_type(game.uwep)) : 0,
            // weapon.c's other three P_SKILL() readings: the discipline TYPE
            // (P_NONE has to answer 0, not the P_ISRESTRICTED -2/-4), the
            // two-weapon skill, and riding.  Sampled here for the same reason
            // as the two above.
            obj_type: _enh.weapon_type(otmp),
            wep_type: game.uwep ? _enh.weapon_type(game.uwep) : 0,
            twoweap_skill: _enh.p_skill_of(P_TWO_WEAPON_COMBAT_INV),
            riding: _enh.p_skill_of(P_RIDING_INV),
            usteed: !!game.u?.usteed,
            twoweap: !!game.u?.twoweap,
            martial: martial_bonus_inv(),
        };
        freeinv(otmp);
        res = await throwit(otmp, skillsnap, wep_mask);
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
const HEAVY_IRON_BALL_OTYP = 484;
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
async function throwit(otmp, skillsnap, wep_mask) {
    const u = game.u;
    const Underwater = !!u.uinwater;
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
        && (otmp.owt | 0) > (u.uhp | 0) * 2) {
        await update_topl(`You have so little stamina, ${the_name_of(otmp)} drops from your grasp.`);
        exercise(A_CON, false);
        u.dx = u.dy = 0;
        u.dz = 1;
    }

    otmp.how_lost = LOST_THROWN;
    // C ref: dothrow.c:1564 `iflags.returning_missile = AutoReturn(obj,wep_mask)`
    // — an aklys/Mjollnir wielded when thrown, or any boomerang, comes back.
    const returning_missile = AutoReturn(otmp, wep_mask);

    // C ref: dothrow.c throwit():1580 `} else if (u.dz) {` — a throw straight
    // up or down never enters the trajectory block at all.
    if (u.dz) {
        if (u.dz < 0 && returning_missile && !impaired) {
            // C ref: dothrow.c:1585 — a straight-up throw of a returning weapon
            // simply comes back to the hand.
            await update_topl(`${Tobjnam_throw(otmp, 'hit')} the ${
                ceiling_of(u.ux, u.uy)} and returns to your hand!`);
            await return_throw_to_inv(otmp, wep_mask);
        } else if (u.dz < 0) {
            // C ref: dothrow.c:1589 `(void) toss_up(obj, rn2(5) && !Underwater)`.
            // The whole up-throw was missing: the rn2(5) roof roll, toss_up()'s
            // two breaktest() rn2(100)s and dmgval()'s die all went unrolled.
            await toss_up(otmp, rn2(5) !== 0 && !Underwater);
        } else {
            await hitfloor(otmp, true);
        }
        return ECMD_TIME;
    }

    // C ref: dothrow.c:1601 — a boomerang does NOT fly in a straight line, so
    // it never reaches bhit(); zap.c boomhit() walks its curve instead.  The
    // port used to send it down the ordinary missile path, which hit the wrong
    // squares and skipped boomhit's rn2(20)-vs-DEX catch entirely.
    if (otmp.otyp === BOOMERANG_OTYP && !Underwater) {
        const res = await DT.boomhit(otmp, u.dx, u.dy, skillsnap);
        if (res.gone) return ECMD_TIME;
        if (res.caught) {
            exercise(A_DEX, true);
            await return_throw_to_inv(otmp, wep_mask);
            return ECMD_TIME;
        }
        if (res.mon && (await thitmonst(res.mon, otmp, skillsnap)))
            return ECMD_TIME;
        // C: the boomerang falls where the curve ended.
        const bx = res.x ?? u.ux, by = res.y ?? u.uy;
        otmp.owornmask = 0;
        mkobj_place_object(otmp, bx, by);
        otmp.where = OBJ_FLOOR;
        otmp.how_lost = LOST_THROWN;
        stackobj(otmp);
        newsym(bx, by);
        return ECMD_TIME;
    }

    // C ref: dothrow.c throwit() lines 1614-1648 — range derives from strength,
    // is clamped to >= 1, then ammo is adjusted: matching-launcher ammo gains a
    // cell (range++), while ammo thrown by hand (no wielded launcher, non-gem)
    // has its range HALVED (range /= 2) and prints the "by hand" notice.
    const crossbowing = ammo_and_launcher(otmp, game.uwep) && weapon_type(otmp) === 22 /* P_CROSSBOW */;
    const urange = Math.floor((crossbowing ? 18 : acurr_str_throw()) / 2);
    // C ref: dothrow.c:1622 — a HEAVY_IRON_BALL is easy to roll, so its weight
    // is divided by 100 rather than 40; using /40 for it gave range 1 instead
    // of the 5 an ordinary hero gets, so a thrown ball stopped one cell out.
    let range = urange - Math.floor((otmp.owt || 1)
                                    / (otmp.otyp === HEAVY_IRON_BALL_OTYP ? 100 : 40));
    if (range < 1) range = 1;
    if (is_ammo(otmp)) {
        if (ammo_and_launcher(otmp, game.uwep)) {
            if (crossbowing) range = 60; /* BOLT_LIM */
            else range++;
        } else if (otmp.oclass !== GEM_CLASS) {
            range = Math.trunc(range / 2); // C: range /= 2 (truncating int division)
            const launcherName = an(skill_name_for(weapon_type(otmp)));
            const descr = weapon_descr_for(otmp);
            game._pending_message = `You aren't wielding ${launcherName}, so you throw your ${descr} by hand.`;
        }
    }

    // C ref: dothrow.c:1660 — a boulder is thrown by a giant and flies 20; a
    // thrown Mjollnir is heavy and only makes half the distance.
    if (otmp.otyp === BOULDER) range = 20;
    else if (otmp.oartifact === ART_MJOLLNIR) range = Math.floor((range + 1) / 2);
    if (Underwater) range = 1;

    // Trajectory + landing.
    const land = bhit_thrown_landing(u.dx, u.dy, range);

    // C ref: dothrow.c throwit():1691 `if (throwit_mon_hit(obj, mon)) return;`
    // — a monster in the path takes the hit (thitmonst); only if the object
    // survives does it go on to break/land.
    if (land.mon) {
        if (await thitmonst(land.mon, otmp, skillsnap)) return ECMD_TIME;
    }

    // C ref: dothrow.c throwit():1710 — a Mjollnir or aklys that reached the end
    // of its flight tries to come back: rn2(100) for the tether holding, then
    // rn2(100) again for a clean catch, else rn2(2)+rnd(3) damage to your arm.
    // None of these draws happened before, so throwing an aklys desynced.
    if (returning_missile) {
        if (rn2(100)) {
            if (!impaired && rn2(100)) {
                await update_topl(`${Tobjnam_throw(otmp, 'return')} to your hand!`);
                if (((otmp.owornmask | 0) & QW_QUIVER) !== 0) setuqwep(null);
                const back = await return_throw_to_inv(otmp, wep_mask);
                setuwep_slot(back);
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
                    losehp_invent(dmg);
                }
                otmp.owornmask = 0;
                mkobj_place_object(otmp, u.ux, u.uy);
                otmp.where = OBJ_FLOOR;
                stackobj(otmp);
                newsym(u.ux, u.uy);
            }
            return ECMD_TIME;
        }
        // C ref: dothrow.c:1770 — the 1-in-100 failure; the weapon falls where
        // it landed and is picked up again by walking over it (how_lost).
        await update_topl(`${Tobjnam_throw(otmp, 'fail')} to return!`);
    }

    // C ref: dothrow.c throwit():1780 — `(!IS_SOFT(typ) && breaktest(obj)) ||
    // obj->oclass == VENOM_CLASS`: venom fails breaktest but is forced to break
    // even on soft terrain.  Then breakmsg() + breakobj(); the second is where
    // the mirror's Luck penalty, the camera demon's rn2(3)s and a next2u()
    // potion's potionbreathe() live, none of which a bare delobj() ran.
    const typ = game.level.at(land.x, land.y)?.typ ?? 0;
    const broke = (!IS_SOFT(typ) && DT.breaktest(otmp)) || otmp.oclass === VENOM_CLASS;
    if (broke) {
        await DT.breakmsg(otmp, cansee(land.x, land.y));
        otmp.owornmask = 0;
        if (await DT.breakobj(otmp, land.x, land.y, true, true)) {
            newsym(land.x, land.y);
            return ECMD_TIME;
        }
    }
    otmp.owornmask = 0;
    mkobj_place_object(otmp, land.x, land.y);
    otmp.where = OBJ_FLOOR;
    otmp.how_lost = LOST_THROWN;
    // C ref: dothrow.c throwit():1838 stackobj(obj) after place_object() —
    // a thrown apple merges into an identical pile already on that square.
    stackobj(otmp);
    newsym(land.x, land.y);
    return ECMD_TIME;
}

// C ref: dothrow.c hitfloor(obj, verbosely) — an object lands at the hero's
// feet: announce it, run hero_breaks() (breaktest's obj_resists rn2(100)) and
// drop it.  Split out of throw_obj() so toss_up() can reuse it.
async function hitfloor(otmp, verbosely) {
    const u = game.u;
    const hereTyp = game.level.at(u.ux, u.uy)?.typ ?? 0;
    const soft = IS_SOFT(hereTyp);
    // C ref: dothrow.c:610 — soft ground (air/cloud/water), being underwater or
    // being swallowed all short-circuit to dropy(): no message, no break test.
    if (!soft && verbosely) {
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
    if (!soft && (await DT.hero_breaks(otmp, u.ux, u.uy, DT.BRK_FROM_INV))) {
        newsym(u.ux, u.uy);
        return;
    }
    mkobj_place_object(otmp, u.ux, u.uy);
    otmp.where = OBJ_FLOOR;
    otmp.how_lost = LOST_THROWN;
    stackobj(otmp);
    newsym(u.ux, u.uy);
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
    const typ = game.level?.at?.(x, y)?.typ ?? 0;
    if (typ === 35 /* AIR */) return 'sky';
    if (typ >= ROOM_TYP || (typ && typ <= DBWALL) || IS_DOOR(typ)
        || typ === SDOOR_TYP)
        return 'ceiling';
    return 'rock cavern';
}

// C ref: dothrow.c harmless_missile(obj) — the arbitrary list of things that
// don't hurt when they land on your head.
function harmless_missile(obj) {
    const otyp = obj.otyp;
    switch (otyp) {
    case 83:  /* SLING */
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
function Blinded_hero() { return (game.u?.blinded | 0) > 0 || !!game.ublindf; }
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
    if (dmg < 0) dmg = 0;
    if (game.uarmh) {
        if (less_damage && dmg < (game.u.uhp | 0))
            await update_topl('Fortunately, you are wearing a hard helmet.');
        else if (game.flags?.verbose !== false)
            await update_topl(`Your ${armor_slot_noun(game.uarmh, WA_ARMH)} does not protect you.`);
    }
    await hitfloor(otmp, true);
    losehp_invent(dmg);
}

// Local name helpers for the throw "by hand" message (C skill_name/weapon_descr
// reduce to these for bow ammo).
function skill_name_for(skill) {
    if (skill === 20) return 'bow';      // P_BOW
    if (skill === 21) return 'sling';    // P_SLING
    if (skill === 22) return 'crossbow'; // P_CROSSBOW
    return 'weapon';
}
export function weapon_descr_for(obj) {
    const sk = objects[obj.otyp]?.oc_skill ?? 0;
    if (sk === -20) return 'arrow';      // -P_BOW ammo
    if (sk === -22) return 'bolt';       // -P_CROSSBOW ammo
    return objects[obj.otyp]?.name || 'weapon';
}
// C ref: attrib.c ACURRSTR — current strength on the 3..25 throwing scale.
function acurr_str_throw() {
    const str = game.u?.acurr?.a?.[0] ?? 0; // A_STR == 0
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
         an, s_suffix, singular_name, weapon_type,
         thitmonst, youmonst_data as youmonst_data_pub, ceiling_of,
         losehp_invent as losehp_throw, dbon_thrown as dbon,
         acurr_eff as acurr_attr, Role_if };

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
            // cmdq: doswapweapon then re-run dofire.
            await doswapweapon_inline();
            game.context.move = 0;
            await moveloop_turn();
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
            await doswapweapon_inline();
            // C ref: ready_weapon() returns ECMD_TIME — the swap costs a turn even
            // though the subsequent throw may be cancelled.  Take it inline.
            game.context.move = 0;
            await moveloop_turn();
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
                    if ((await doswapweapon()) === ECMD_TIME) {
                        game.context.move = 0;
                        await moveloop_turn();
                        // The queued dowield is a distinct command.  Its
                        // predecessor left the former primary's prinv() line
                        // pending, which C pages at the command boundary
                        // before dowield() can replace it with the launcher.
                        await display_nhwindow_message();
                    }
                }
                // The queued invlet is popped by getobj()'s cmdq fast path, so
                // dowield draws no prompt.
                cmdq_add_key(CQ_CANNED, olauncher.invlet);
                if ((await dowield()) === ECMD_TIME) {
                    game.context.move = 0;
                    await moveloop_turn();
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
    if (oldswap) {
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
        if (game.uswapwep)
            await update_topl(xprname(game.uswapwep,
                doname_invent_quan(game.uswapwep, 0), obj_to_let(game.uswapwep), true, 0, 0));
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
    const cc = await getpos('the desired destination', startx, starty, null,
                            /*force=*/true,
                            /*verbose=*/game.flags?.verbose !== false,
                            /*travelMode=*/true);
    if (!cc) return ECMD_CANCEL; // ESC -> cancelled, no time
    game.iflags = game.iflags || {};
    game.iflags.travelcc = { x: cc.x, y: cc.y };
    return await dotravel_target();
}

// C ref: cmd.c dotravel_target():5348 — the #retravel body dotravel() tail-calls
// once a destination is picked.  The two RNG-free early-outs come first; then
// domove() reaches findtravelpath(TRAVP_TRAVEL), whose adjacent-destination
// fast path IS ported (hack.js travel_adjacent_step).  Longer walks still need
// the BFS and cost no time.
async function dotravel_target() {
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
export async function dodrop() {
    const obj = await getobj('drop', any_obj_ok, GETOBJ_PROMPT | GETOBJ_ALLOWCNT);
    return await drop(obj);
}

// C ref: do.c drop().  Normal-floor path only.
async function drop(obj) {
    if (!obj) return 0;                 /* ECMD_FAIL — cancelled */
    if (obj === hands_obj) return 0;
    if (!(await canletgo(obj, 'drop'))) return 0;
    // unwield/unquiver/unswap a dropped wielded item (RNG-free).
    if (obj === game.uwep) {
        if (welded(game.uwep)) { weldmsg(obj); return 0; }
        setuwep_slot(null);
    }
    if (obj === game.uquiver) setuqwep(null);
    if (obj === game.uswapwep) setuswapwep(null);

    const u = ustate();
    // C: `if (!IS_ALTAR(...) && flags.verbose) You("drop %s.", doname(obj));`
    // The wandpoly session runs with !verbose so the drop is silent.
    // C's You() is pline(): it must accumulate onto a pending topline (and page
    // it) so the same-turn monster message merges behind a --More--.
    if (!IS_ALTAR_typ(u) && game.flags?.verbose) {
        await update_topl(`You drop ${doname(obj)}.`);
    }
    obj.how_lost = LOST_DROPPED;
    dropz(obj, u.ux, u.uy);
    return 1; /* ECMD_TIME */
}

// IS_ALTAR check stub — none of the recorded drop tiles are altars.
function IS_ALTAR_typ(_u) { return false; }

// ══════════════════════════════════════════════════════════════════════════
// The 'D' (#droptype) command: do.c doddrop() / menu_drop(), and the two
// pickup.c menus it drives.  js/pickup.js's query_category()/query_objlist()
// stop at the point a window would have to be drawn (each caller renders its
// own), so the menu halves live here, next to renderMenuLines().
// ══════════════════════════════════════════════════════════════════════════

/* wintty.c set_item_state():1209 — '+' == all of it, '#' == a counted pick.
   A page's first paint uses '*' for '+', but a single-page menu is painted
   once and then patched one column per toggle, so '+' is what ever shows. */
function menu_sel_char(it) {
    return !it.selected ? '-' : (it.count === -1 ? '+' : '#');
}
/* wintty.c tty_add_menu() — "<selector> <state> <description>". */
function menu_item_line(it) { return `${it.selector} ${menu_sel_char(it)} ${it.desc}`; }

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

    let counting = false, count = 0, reset_count = true, cancelled = false;
    for (;;) {
        if (reset_count) { counting = false; count = 0; } else reset_count = true;
        renderMenuLines(plan.map((p) => (p.item
            ? { text: menu_item_line(p.item), attr: p.item.attr || 0 }
            : { text: p.str, attr: p.attr || 0 })), null);
        const key = await nhgetch();
        const ch = String.fromCharCode(key);
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
        if (!explicit && ch === ' ') break;             /* last page: finish */
        if (!explicit) {
            /* wintype.h default_menu_cmds[]; gm.mapped_menu_cmds is empty
               unless the config rebinds them, so these are the literals. */
            if (ch === '^' || ch === '|' || ch === '>' || ch === '<') continue;
            if (ch === '.' || ch === ',') {             /* SELECT_ALL/_PAGE */
                if (how === PICK_ANY) set_all();
                continue;
            }
            if (ch === '-' || ch === '\\') { unset_all(); continue; }
            if (ch === '@' || ch === '~') {             /* INVERT_ALL/_PAGE */
                if (how === PICK_ANY) invert_all(0, -1);
                continue;
            }
        }
        if (how === PICK_NONE) continue;
        if (gacc.has(ch)) {
            invert_all(ch, counting ? count : -1);
            if (how === PICK_ONE) break;
            continue;
        }
        const hit = items.find((it) => it.selector === ch);
        if (hit) {
            toggle_menu_curr(hit, counting, count);
            if (how === PICK_ONE) break;
        }
        /* anything else: rejected (tty_nhbell), the menu stays up */
    }
    if (cancelled) return [];
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
    plan.unshift({ str: qstr, attr: ATR_INVERSE }, { str: '' });

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
    let menu_ch = 'a', first = true;
    const nextLetter = () => {
        const c = menu_ch;
        menu_ch = (menu_ch === 'z') ? 'A'
            : String.fromCharCode(menu_ch.charCodeAt(0) + 1);
        return c;
    };
    for (const oclass of (sorted ? pack : [null])) {
        let printed_type_name = false;
        for (const curr of sortedolist) {
            if (sorted && curr.oclass !== oclass) continue;
            if (!allow(curr)) continue;
            if (sorted && !printed_type_name) {
                plan.push({ str: let_to_name(curr.oclass, false, with_oc_sym),
                            attr: ATR_INVERSE });
                printed_type_name = true;
            }
            const selector = (qflags & USE_INVLET) ? curr.invlet
                : ((first && curr.oclass === COIN_CLASS) ? GOLD_SYM : nextLetter());
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
    if (qstr) plan.unshift({ str: qstr, attr: ATR_INVERSE }, { str: '' });

    const picked = await tty_select_menu(items, plan, how);
    /* fix up counts: -1 means no count was given, i.e. the whole stack */
    return picked.map((it) => ({
        obj: it.obj,
        count: (it.count === -1 || it.count > it.obj.quan) ? it.obj.quan : it.count,
    }));
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
    /* (*u.ushops) sellobj_state(SELL_DELIBERATE/SELL_NORMAL): this port's
       drop() does not run the shop sell-price bookkeeping. */
    if (menu_style() !== MENU_TRADITIONAL
        || (result = ggetobj('drop', drop, 0, false, null)) < -1)
        result = await menu_drop(result);
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
    const headAttr = game.program_state?.gameover ? 0 : ATR_INVERSE;
    // end_menu(win, "Pay for which items?") prepends the prompt + a blank line.
    const flat = [{ text: 'Pay for which items?', attr: ATR_INVERSE },
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

// C ref: do.c dropx/dropy/dropz — place the freed object on the floor and
// redraw the destination cell.  flooreffects (water/lava/trapdoor) are not
// reached on the recorded plain-floor tiles.
function dropz(obj, x, y) {
    freeinv(obj);
    place_object(obj, x, y);
    newsym(x, y);
}

function weldmsg(_obj) {}
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
    observe_object(obj);
    // C ref: pickup.c pick_obj():1907 — a shop-floor item is billed BEFORE
    // addinv(), so the merge that addinv() may do can see obj->unpaid.  This is
    // where the "For you, ...; only N zorkmids for this <item>." quote (and its
    // rn2(4)) comes from, and what makes doname() read "(unpaid, N zorkmids)".
    const robshop = costly_spot(obj.ox, obj.oy);
    floor_extract_self(obj);
    if (robshop) await addtobill(obj, true, false, false);
    const held = addinv(obj);
    // C ref: pickup.c pickup_prinv(held, count, "lifting") — only announce an
    // encumbrance-level change since the last check this pickup() call (reset
    // to 0 by pickup() before lifting anything).
    const liftPrefix = pickup_prinv_prefix('lifting');
    if (game._merge_discovery_pending || (robshop && obj.unpaid)) {
        // A merge inside addinv() above discovered new BUC/id info, or
        // addtobill() just printed the shop's price quote.  Either way a
        // message is already on the top line, and C's prinv() -> pline() would
        // page it with --More-- first, so route the pickup line through
        // update_topl() rather than the bare-setter prinv().
        await report_merge_discovery();
        await update_topl(prinv_fmt(liftPrefix, held, quan));
    } else {
        // C ref: prinv() -> pline() leaves toplin == NEED_MORE, so a following
        // same-turn message (e.g. a monster opening a door -> "You hear a door
        // open.") accumulates onto the pickup line via update_topl() instead of
        // replacing it (matches the wield/wear prinv paths).
        prinv(liftPrefix, held, quan);
        game._toplin = 1;
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
        for (const o of sorted)
            g.items.push({ obj: o, letter: oclass === COIN_CLASS ? GOLD_SYM : nextLetter() });
        groups.push(g);
    }
    // selected[invlet] = true
    const selected = new Map();

    const MENU_OFFX = 41;
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
        display.putstr(MENU_OFFX, row++, qstr, NO_COLOR, ATR_INVERSE);
        display.putstr(MENU_OFFX, row++, '', NO_COLOR, ATR_NONE);
        for (const g of groups) {
            display.putstr(MENU_OFFX, row++, g.header, NO_COLOR, ATR_INVERSE);
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
        // C ref: win/tty/wintty.c MENU_SELECT_ALL ('.') / MENU_UNSELECT_ALL
        // ('-') / MENU_INVERT_ALL ('@') -> set_all_on_page()/
        // unset_all_on_page()/invert_all(): mark every item on the (only)
        // page selected / deselected / toggled.
        if (ch === '.') { for (const let_ of letterMap.keys()) selected.set(let_, true); continue; }
        if (ch === '-') { selected.clear(); continue; }
        if (ch === '@') {
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
                game._pending_message = `You pick up the ${dat.name || 'monster'}'s tongue.`;
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
            game._pending_message = 'You cannot dive into the water to pick things up.';
            return 0;
        } else if (!game.Underwater) {
            game._pending_message =
                "You can't even see the bottom, let alone pick up something.";
            return 0;
        }
    }
    if (typ0 === LAVAPOOL) {
        if (u.uprops?.Wwalking || u.uprops?.Flying) {
            game._pending_message = "You can't reach the bottom to pick things up.";
            return 0;
        }
        game._pending_message = 'You would burn to a crisp trying to pick things up.';
        return 0;
    }
    if (objects_at(x, y).length === 0) {
        // C ref: hack.c pickup_checks():3827 !OBJ_AT cascade — the terrain
        // under the hero picks the message; only the final `else` is generic.
        const dmask = game.level?.at(x, y)?.doormask || 0;
        const looted = game.level?.at(x, y)?.looted;
        if (IS_THRONE(typ0)) game._pending_message = `It must weigh${looted ? ' almost' : ''} a ton!`;
        else if (IS_SINK(typ0)) game._pending_message = 'The plumbing connects it to the floor.';
        else if (IS_GRAVE(typ0)) game._pending_message = "You don't need a gravestone.  Yet.";
        else if (IS_FOUNTAIN(typ0)) game._pending_message = 'You could drink the water...';
        else if (IS_DOOR(typ0) && (dmask & D_ISOPEN)) game._pending_message = "It won't come off the hinges.";
        else if (IS_ALTAR(typ0)) game._pending_message = 'Moving the altar would be a very bad idea.';
        else if (typ0 === STAIRS) game._pending_message = 'The stairs are solidly affixed.';
        else game._pending_message = 'There is nothing here to pick up.';
        return 0;
    }
    // C ref: hack.c pickup_checks():3849 — can_reach_floor() gate.  This
    // port's can_reach_floor() only knows uswallow/Levitation, so the
    // usteed/Blind/hole wordings of C's else-if chain collapse to the surface
    // form; the pit arm is distinct because it names the pit.
    const traphere = t_at_local(x, y);
    if (!can_reach_floor_p(!!(traphere && is_pit(traphere.ttyp)))) {
        if (traphere && is_pit(traphere.ttyp) && traphere.tseen)
            game._pending_message = 'You cannot reach the bottom of the pit.';
        else if (game.Blind)
            game._pending_message = 'You cannot reach anything here.';
        else
            game._pending_message = 'You cannot reach the floor.';
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
        // C uses Norep(); the port has no repeat-suppressing pline, and the
        // repeat case needs two identical lines in a row to differ.
        if (word) await pline(`You cannot ${word} something you are wearing.`);
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

// printf-style helpers for the cast menu column layout.
function padEnd(s, n) { return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padStart(s, n) { return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

// C ref: spell.c dospellmenu — build the menu lines (header + per-spell rows)
// using the non-tab column format, return { header, rows } (without the "a - "
// selector prefix, which the tty menu prepends).
function buildSpellMenuLines(nspells, book, meta) {
    // Header: "    %-20s Level %-12s Fail Retention" (Name, Category).
    let header = '    ' + padEnd('Name', 20) + ' Level ' + padEnd('Category', 12)
        + ' Fail Retention';
    // C ref: spell.c dospellmenu — `if (wizard) Sprintf(eos(buf), "%c%6s", sep,
    // "turns");` and, per row, `"%c%6d"` with the raw spellknow() value.
    // `wizard` is C's debug-mode flag, which options.c set_playmode() sets from
    // OPTIONS=playmode:debug — the same thing js/options.js records as
    // flags.debug.  Omitting the column also shifted the whole menu 7 columns
    // right, because the tty derives offx from the widest line.
    const wiz = !!game.flags?.debug;
    if (wiz) header += ' ' + padStart('turns', 6);
    // Row fmt: "%-20s  %2d   %-12s %3d%% %9s".
    const rows = [];
    for (let i = 0; i < nspells; i++) {
        const ent = book[i];
        const name = meta.name(ent.sp_id);
        const lev = ent.sp_lev;
        const cat = meta.category(ent.sp_id);
        const fail = meta.fail(i);
        const reten = meta.retention(i);
        let buf = padEnd(name, 20) + '  ' + padStart(String(lev), 2) + '   '
            + padEnd(cat, 12) + ' ' + padStart(`${fail}%`, 4) + ' ' + padStart(reten, 9);
        if (wiz) buf += ' ' + padStart(String(meta.turns ? meta.turns(i) : 0), 6);
        rows.push(buf);
    }
    return { header, rows };
}

// C ref: spell.c dospellmenu / win/tty menu.  Render the known-spell list as a
// menu overlaying the map (offx column, status kept underneath) and return the
// picked spell index (or -1 on cancel).
export async function spell_menu(prompt, nspells, book, meta) {
    const display = game.nhDisplay;
    if (!display?.setCell) return -1;

    const { header, rows } = buildSpellMenuLines(nspells, book, meta);
    const selector = (i) => (i < 26 ? String.fromCharCode(97 + i)
        : String.fromCharCode(65 + i - 26)) + ' - ';

    // Menu item display lines (selector + buf); header has no selector.
    const itemLines = rows.map((r, i) => selector(i) + r);
    // C: each menu line's "len" = strlen + 2 (space at beg & end); maxcol is the
    // widest, capped at cols.  offx = max(10, cols - maxcol - 1).
    const allLines = [header, ...itemLines, prompt];
    let maxcol = 0;
    for (const ln of allLines) maxcol = Math.max(maxcol, ln.length + 2);
    if (maxcol > 80) maxcol = 80;
    // C: offx = max(10, ttyDisplay->cols - maxcol - 1).  The recorded sessions
    // place content one column further right than 80 - maxcol - 1, consistent
    // with ttyDisplay->cols == 81 (an 80-col map plus the status margin).
    let offx = Math.max(10, 81 - maxcol - 1);
    if (offx === 10) offx = 0; // full-screen fallback (matches C menu_overlay)

    // Draw: prompt (inverse) at row 0, blank, header (inverse), rows, (end).
    const draw = (text, row, attr) => {
        for (let c = 0; c < text.length && offx + c < 80; c++)
            display.setCell(offx + c, row, text[c], NO_COLOR, attr);
    };
    // C ref: win/tty/wintty.c — a menu heading is shown with ATR_INVERSE, but
    // the recorder serializes space-runs longer than 4 columns as cursor-forwards
    // (which decode as default attr) while runs of <= 4 spaces keep the inverse
    // bit.  Same treatment dovspell's menu already uses.
    const drawHeading = (text, row) => {
        for (let c = 0; c < text.length && offx + c < 80; c++) {
            let attr = ATR_INVERSE;
            if (text[c] === ' ') {
                let s = c; while (s > 0 && text[s - 1] === ' ') s--;
                let e = c; while (e + 1 < text.length && text[e + 1] === ' ') e++;
                if (e - s + 1 > 4) attr = 0;
            }
            display.setCell(offx + c, row, text[c], NO_COLOR, attr);
        }
    };
    // C ref: win/tty/topl.c — displaying the menu clears the message window, so
    // the previous command's topline is gone rather than showing through to the
    // left of the prompt.
    game._pending_message = '';
    for (let c = 0; c < offx && c < 80; c++)
        display.setCell(c, 0, ' ', NO_COLOR, 0);
    // C ref: win/tty/wintty.c — a menu window paints its full rectangle: every
    // row is cleared from offx to offx+maxcol before the text is written, so a
    // short row like "(end)" hides the map beneath instead of letting it show.
    const winRight = Math.min(offx + maxcol, 80);
    const totalRows = 3 + itemLines.length + 1;
    for (let r = 0; r < totalRows; r++)
        for (let c = offx; c < winRight; c++)
            display.setCell(c, r, ' ', NO_COLOR, 0);
    let row = 0;
    drawHeading(prompt, row++);
    draw('', row++, 0);
    drawHeading(header, row++);
    for (const ln of itemLines) draw(ln, row++, 0);
    draw('(end)', row, 0);
    if (offx > 0) putStatusLines(display);
    // Cursor parks at the start of the "(end)" line content (offx + 6 observed).
    display.setCursor(offx + 6, row);
    game._modal_screen = 'spellmenu';

    for (;;) {
        const c = await nhgetch();
        const ch = String.fromCharCode(c);
        // C ref: wintty.c tty_select_menu() — '\n' and '\r' end the menu exactly
        // like ' '/ESC (MENU_SELECT_PAGE is not bound to them for PICK_ONE).
        if (c === 27 || c === 32 || c === 10 || c === 13) { delete game._modal_screen; return -1; }
        const idx = (ch >= 'a' && ch <= 'z') ? ch.charCodeAt(0) - 97
            : (ch >= 'A' && ch <= 'Z') ? ch.charCodeAt(0) - 65 + 26 : -1;
        if (idx >= 0 && idx < nspells) {
            delete game._modal_screen;
            return idx;
        }
    }
}

export function splittable(obj) {
    return !(obj?.otyp === LOADSTONE && obj.cursed) && !(obj === game.uwep && welded(game.uwep));
}

export function taking_off(action) {
    return action === 'take off' || action === 'remove';
}

export function mime_action(word) {
    game._pending_message = `You mime ${ing_suffix(word)} something.`;
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


export function silly_thing(word, otmp) {
    if (word === 'call' && otmp?.otyp === AMULET_OF_YENDOR)
        game._pending_message = "The Amulet doesn't like being called names.";
    else game._pending_message = `That is a silly thing to ${word}.`;
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

export function ggetobj(_word, _fn, _mx, _combo, resultflags = null) {
    if (!inventoryArray().length) { if (resultflags) resultflags.value = 1; return 0; }
    return 0;
}

export function askchain(_objchn, _olets, _allflag, _fn, _ckfn, _mx, _word) { return 0; }
export function reroll_menu() { return false; }
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
export function menu_identify(id_limit) { identify_pack(id_limit, false); }
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
        // limited identify: identify up to id_limit items (menu selection in C;
        // the owned sessions never hit the partial-menu path, so take the first
        // id_limit unidentified items in pack order).
        let n = id_limit;
        for (const obj of inventoryArray()) {
            if (n > 0 && not_fully_identified(obj)) { await identify(obj); --n; }
        }
    }
    update_inventory();
}
// C ref: wizcmds.c wiz_identify() — sets iflags.override_ID and calls
// display_inventory(NULL, FALSE); invent.c display_pickinv()'s `wizid` block
// puts an add_menu_str() title ("Debug Identify", ATR_NONE) at the top and then
// lists ONLY the not-fully-identified items (`if (wizid &&
// !not_fully_identified(otmp)) continue`).  With nothing left to identify the
// list is empty and a single "(all items ...)" line replaces the selector entry.
// The menu is PICK_ANY, so the dismissal key is handled by the command loop
// (like the '\' list) rather than a local key loop.
export function wiz_identify() {
    const unid_cnt = count_unidentified(inventoryArray());
    let title = 'Debug Identify';
    if (unid_cnt)
        title += ` -- unidentified or partially identified item${unid_cnt === 1 ? '' : 's'}`;
    const flat = [{ text: title, attr: 0 }];
    if (!unid_cnt) {
        flat.push({ text: '(all items are permanently identified already)', attr: 0 });
    } else {
        // visctrl(C('I')) == "^I"; the primary selector is '_'.
        let prompt = `select ${unid_cnt === 1 ? 'it' : 'any or all of them'} to permanently identify`;
        if (unid_cnt > 1) prompt += ' (^I for all)';
        flat.push({ text: `_ - ${prompt}`, attr: 0 });
        const headAttr = game.program_state?.gameover ? 0 : ATR_INVERSE;
        for (const group of inventoryRows(null, not_fully_identified)) {
            const [heading, ...items] = group;
            flat.push({ text: heading, attr: headAttr });
            for (const item of items) flat.push({ text: item, attr: 0 });
        }
    }
    renderMenuLines(flat, null);
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
export function doperminv() { return ECMD_OK; }
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
    game._pending_message = prinv_fmt(prefix, obj, quan);
    // C ref: invent.c prinv() emits its line with pline(), which routes through
    // topl.c update_topl() and leaves gt.toplin == TOPLIN_NEED_MORE.  Any
    // message printed afterwards in the same command therefore either merges
    // onto this line or fires --More-- first; without recording the state the
    // follow-up (e.g. wizcmds.c wiz_wish()'s encumber_msg()) silently
    // overwrites the item line instead.
    game._toplines = game._pending_message;
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

// C ref: objects.h HARDGEM(n) == (n >= 8) — a gem/ring is "tough" (engrave, not
// write) only for the hardest gemstones (mohs >= 8: diamond and a handful of
// gem types).  The objects table here carries no mohs field; none of the
// exercised rings/gems are HARDGEM, so this conservatively returns false (->
// "Write").  Hard-gem otyps can be added if a session ever engraves with one.
function obj_is_hardgem(_obj) { return false; }

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
// C ref: objnam.c armor_simple_name(armor).
function armor_simple_name_ia(obj) { return armor_slot_noun(obj, armor_slot_mask(obj)); }
// C ref: iactions.c ia_checkfile(otmp) — gates the '/' line on the object
// having a data.base entry.  This port ships no data.base, and every object the
// menu can be opened on has one in C, so the line is always offered.
function ia_checkfile(_obj) { return true; }

function itemactions_list(otmp) {
    const out = [];
    const add = (act, accel, label) => out.push({ act, accel, label });
    const oclass = otmp.oclass;
    const already_worn = (otmp.owornmask & (W_ARMOR | W_ACCESSORY)) !== 0;
    const quan = otmp.quan || 1;
    const is_blade = (o) => o.oclass === WEAPON_CLASS && objects[o.otyp]?.oc_skill != null;

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
    // 'E' (engrave/write): wand / ring / gem / blade-tipped writer.  C verb is
    // "Engrave" iff is_blade || WAND || ((GEM||RING) && oc_tough), where oc_tough
    // = HARDGEM(mohs) (mohs >= 8 — only the hardest gemstones).  None of the
    // exercised rings/gems are HARDGEM (the see-invisible ring's mohs is 5), so
    // they "Write"; only wands and blades "Engrave".
    if (oclass === WAND_CLASS || oclass === RING_CLASS || oclass === GEM_CLASS
        || is_blade(otmp)) {
        const tough = (oclass === GEM_CLASS || oclass === RING_CLASS)
            && obj_is_hardgem(otmp);
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
    // 'w' (wield): C ref iactions.c:606 — a weapon/weptool is wielded "as your
    // weapon"; anything else unworn is wielded "in your <hands>"; the stack
    // wording follows quan.  Skipped entirely for the already-wielded item.
    if (otmp !== game.uwep) {
        const stack = quan > 1 ? 'stack' : 'item';
        if (oclass === WEAPON_CLASS || is_weptool(otmp))
            add(IA_WIELD_OBJ, 'w', `Wield this ${stack} as your weapon`);
        else if (!already_worn)
            // body_part index 6 == HAND (humanoid hero); makeplural -> "hands".
            add(IA_WIELD_OBJ, 'w', `Wield this ${stack} in your ${makeplural(body_part(6))}`);
    }
    // 'T' (take off armor / tip a container): C ref iactions.c:585.
    if ((otmp.owornmask || 0) & W_ARMOR)
        add(IA_TAKEOFF_OBJ, 'T', 'Take off this armor');
    if ((Is_container(otmp) && (Has_contents(otmp) || !otmp.cknown))
        || (otmp.otyp === HORN_OF_PLENTY && ((otmp.spe | 0) > 0 || !otmp.known)))
        add(IA_TIP_CONTAINER, 'T', 'Tip all the contents out of this container');
    // 'W' (wear armor): C ref iactions.c:631 — always offered for unworn armor;
    // when that slot is occupied the line is an inert "[already wearing ...]".
    if (!already_worn && oclass === ARMOR_CLASS) {
        const occupied = worn_in_slot_of(otmp);
        add(IA_WEAR_OBJ, 'W', occupied
            ? `[already wearing ${an(armor_simple_name_ia(occupied))}]`
            : 'Wear this armor');
    }
    // 'x' (swap primary/secondary weapon): C ref iactions.c:652.
    if (otmp === game.uwep && game.uswapwep)
        add(IA_SWAPWEAPON, 'x', 'Swap this with your alternate weapon');
    else if (otmp === game.uwep)
        add(IA_SWAPWEAPON, 'x', 'Ready this as an alternate weapon');
    else if (otmp === game.uswapwep)
        add(IA_SWAPWEAPON, 'x', 'Swap this with your main weapon');
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
    SPE_BLANK_PAPER = 407;
function item_reading_classification(obj) {
    const otyp = obj.otyp;
    if (otyp === FORTUNE_COOKIE) return 'Read the message inside this cookie';
    if (otyp === T_SHIRT) return 'Read the slogan on the shirt';
    if (otyp === ALCHEMY_SMOCK) return 'Read the slogan on the apron';
    if (otyp === HAWAIIAN_SHIRT) return 'Look at the pattern on the shirt';
    if (obj.oclass === SCROLL_CLASS) {
        const magic = (obj.dknown
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
    const title = `Do what with ${the_obj(otmp)}?`;
    const itemLines = entries.map((e) => `${e.accel} - ${e.label}`);
    const lines = [title, '', ...itemLines, '(end)'];
    // C ref: win/tty/wintty.c tty_end_menu — cw->maxcol = widest entry's
    // strlen()+2 ("extra space at beg & end"); tty_display_nhwindow NHW_MENU then
    // sets the window offset offx = max(10, cols - maxcol - 1), collapsing to a
    // full-screen menu (offx 0) when it would be 10.
    let maxcol = 0;
    for (const ln of lines) maxcol = Math.max(maxcol, ln.length + 2);
    if (maxcol > 80) maxcol = 80;
    const cols = display.cols ?? 80;
    let offx = Math.max(10, cols - maxcol - 1);
    if (offx === 10) offx = 0;
    // C ref: process_menu_window draws each row as tty_curs(win,1,r) + a leading
    // putchar(' ') then the entry text, so the text starts at screen column
    // offx+1 (the leading space occupies offx).
    const textx = offx + 1;

    display.clearScreen();
    render_map_to_grid();
    // C ref: process_menu_window's cl_end() blanks [offx, cols) on every menu row
    // (the leading-space column included); the map shows through only to the LEFT.
    for (let r = 0; r < lines.length && r < 22; r++)
        for (let c = offx; c < cols; c++)
            display.setCell(c, r, ' ', NO_COLOR, 0);
    let row = 0;
    // Row 0: the query title, drawn with the menu prompt style (= menu_headings,
    // ATR_INVERSE).
    for (let c = 0; c < title.length && textx + c < 80; c++)
        display.setCell(textx + c, row, title[c], NO_COLOR, ATR_INVERSE);
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
        putStatusLines(display);
    }
    // C tty parks the cursor just past the "(end)" prompt (textx + 5 + 1).
    display.setCursor(textx + '(end)'.length + 1, endRow);
    game._modal_screen = 'itemactions';
}

// the(cxname(otmp)) — "the <object name>", used in the submenu title.
function the_obj(otmp) {
    const nm = cxname_singular(otmp);
    return /^(the |a |an |your |my |[A-Z])/.test(nm) ? nm : `the ${nm}`;
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
    for (;;) {
        renderItemActionsMenu(otmp, entries);
        const c = await nhgetch();
        const ch = String.fromCharCode(c);
        if (c === 27) { // ESC: cancel — no action, no time
            delete game._modal_screen;
            return ECMD_OK;
        }
        if (c === 13 || c === 10) { // Return/Enter: commit with nothing -> cancel
            delete game._modal_screen;
            return ECMD_OK;
        }
        const chosen = sel.get(ch);
        if (!chosen) continue; // invalid selector: bell, menu stays (re-render)
        delete game._modal_screen;
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
    const seedInvlet = () => cmdq_add_key(CQ_CANNED, otmp.invlet);
    switch (act) {
    case IA_DROP_OBJ:
        seedInvlet();
        return await dodrop();
    case IA_THROW_OBJ:
        seedInvlet();
        return await dothrow(getDir);
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
    // IA_NAME_OBJ / IA_ADJUST_OBJ / IA_WHATIS_OBJ and the other actions are not
    // exercised by any recorded session; itemactions returns ECMD_OK for them so
    // the 'i' command elapses no time (the canned command, if any, would run on
    // a subsequent rhack iteration).
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
    for (;;) {
        if (repaint) info = renderInventoryMenu(rows, page);
        repaint = true;
        const c = await nhgetch();
        if (c === 32 && info.multipage && page < info.pages - 1) {
            page++;
            continue;
        }
        if (c === 27 || c === 32 || c === 13 || c === 10) {
            await dismiss_invent_screen();
            return null;
        }

        const ch = String.fromCharCode(c);
        if (ch === ':') {
            const cursor = game.nhDisplay?.getCursor?.();
            const picked = await search_inventory_menu(rows, byLet);
            if (picked) {
                delete game._modal_screen;
                return picked;
            }
            if (cursor) game.nhDisplay.setCursor(cursor[0], cursor[1]);
            repaint = false;
            continue;
        }

        const picked = byLet.get(ch);
        if (!picked) continue;
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
        await renderMessageOnMap('Not carrying anything.');
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
        await renderMessageOnMap('Not carrying anything.');
        return;
    }
    const byLet = new Map();
    for (const obj of inventoryArray())
        if (!lets || String(lets).includes(obj.invlet)) byLet.set(obj.invlet, obj);
    const picked = await select_inventory_menu(rows, byLet);
    if (picked) await dismiss_invent_screen();
}

// Render the selectable inventory.  When the content fits one page it is a tty
// overlay (offx computed from the widest line, "(end)" footer); when it overflows
// it becomes a full-screen paged menu with an "(N of M)" footer.  C ref:
// win/tty/wintty.c finalize NHW_MENU + process_menu_window paging.  Returns
// {multipage, pages} so callers can drive the space-advances-page loop.
function renderInventoryMenu(rows, page = 0) {
    // Flatten rows into menu lines, tagging class headers (ATR_INVERSE).
    // C ref: windows.c add_menu_heading() — suppresses the highlight
    // (attr = ATR_NONE) during end-of-game disclosure (program_state.gameover).
    const headerAttr = game.program_state?.gameover ? 0 : ATR_INVERSE;
    const lines = [];
    for (const group of rows) {
        const [heading, ...items] = group;
        lines.push({ text: heading, attr: headerAttr, header: true });
        for (const it of items) lines.push({ text: it, attr: 0 });
    }
    const display = game.nhDisplay;
    if (!display?.clearScreen) return { multipage: false, pages: 1 };
    const totalRows = display.rows ?? 24;
    const perPage = totalRows - 1; // 23 content lines, footer on the last row
    const multipage = lines.length > perPage;
    // C ref: win/tty/wintty.c — a paged menu is a full-screen window (offx==0);
    // dismissing it runs docrt(), which blanks the status window (see
    // renderItemActionsMenu).  A single-page menu is an overlay (offx>0) whose
    // dismiss uses docorner() and leaves the status intact.
    game._botl_blanked = multipage;
    if (multipage) {
        // Full-screen paged menu: footer "(N of M)".
        const pages = Math.ceil(lines.length / perPage);
        const curPage = Math.max(0, Math.min(page, pages - 1));
        const pageLines = lines.slice(curPage * perPage, curPage * perPage + perPage);
        display.clearScreen();
        let row = 0;
        // C ref: win/tty/wintty.c process_menu_window() — each row's leading
        // pad column is an unconditional plain putchar(' ') BEFORE the attr
        // toggle for the entry text, so a header's ATR_INVERSE never covers
        // that column (draw it separately, never as part of `ln.text`).
        for (const ln of pageLines) {
            display.putstr(0, row, ' ', NO_COLOR, 0);
            display.putstr(1, row, ln.text, NO_COLOR, ln.attr || 0);
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
        return { multipage: true, pages };
    }
    // Single page: overlay via the existing renderer (map shows through).
    renderMenuScreen(rows, null);
    return { multipage: false, pages: 1 };
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
        await renderMessageOnMap('Not carrying anything.');
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

export function display_pickinv(lets = null, xtra_choice = null, query = null, allowxtra = false, want_reply = false, out_cnt = null) {
    void xtra_choice; void query; void allowxtra; void want_reply;
    const rows = inventoryRows(lets);
    if (!rows.length) {
        game._pending_message = 'Not carrying anything.';
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
export function display_used_invlets(avoidlet) {
    for (const obj of inventoryArray()) if (obj.invlet !== avoidlet) return obj.invlet;
    return '\0';
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

export function dounpaid(count, floorcount, buriedcount) {
    void floorcount; void buriedcount;
    if (!count) game._pending_message = "You aren't carrying any unpaid objects.";
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
        if (any_unpaid) dounpaid(u_carried, u_floor, u_buried);
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

// C ref: invent.c dfeature_at() — the dungeon feature at (x,y).  Ports the
// staircase/ladder branch (via game.stairs) used by look_here on the dungeon
// entrance, then falls back to the cell's typName for other features.
export function dfeature_at(x, y, buf = '') {
    let feature = null;
    for (let s = game.stairs; s && !feature; s = s.next)
        if (s.sx === x && s.sy === y) feature = stairs_description(s, true);
    if (!feature) {
        // C ref: invent.c dfeature_at — terrain features named via defsyms
        // explanations.  Altars still fall through to loc.typName below.
        const loc = game.level?.at?.(x, y);
        const ltyp = loc?.typ;
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
        else if (ltyp === ICE) feature = 'ice';
        else if (ltyp === POOL || ltyp === MOAT || ltyp === WATER) feature = 'pool of water';
        else if (IS_SINK(ltyp)) feature = 'sink';
        // C ref: invent.c:4075 — ALTAR sits between SINK and the stairway arm.
        else if (IS_ALTAR(ltyp)) feature = altar_description(loc);
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
        // update_topl, not pline: C's pline() pages an unacknowledged topline
        // and this message routinely lands on one — from moveloop_preamble()'s
        // pickup(1) it arrives while the moon-phase greeting is still pending,
        // which is what puts the --More-- on that line.  update_topl() only
        // more()s a HARD-pending line (game._toplin); making it also more() a
        // pline()'d one globally costs -119 public (seed0014), so C's
        // "doesn't fit, so page it" rule (topl.c update_topl():257) is applied
        // here at the one call site that needs it.
        const pend = game._pending_message || '';
        if (!game._winStop && pend && game._toplinSoft === pend
            && decorMsg.length + pend.length + 3 >= 80 - 8)
            await topl_more();
        await update_topl(decorMsg);
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
    for (const o of objs) if (o.where === 'floor' && o.ox === x && o.oy === y) here.unshift(o);
    return here; // topmost (last placed) first
}

// C ref: engrave.c read_engr_at() — sense and read aloud any engraving at
// (x,y) via update_topl (so it properly merges onto / pages an already
// pending message, matching pline's real behavior).  Returns true if an
// engraving was sensed (and so a message was queued).
export async function read_engr_at(x, y) { return await read_engr_at_topl(x, y); }
async function read_engr_at_topl(x, y) {
    const ep = engr_at(x, y);
    const text = ep?.actualText || '';
    if (!ep || !text) return false;
    let intro;
    switch (ep.engr_type) {
    case DUST:       if (game.Blind) return false;
                     intro = 'Something is written here in the dust.'; break;
    case ENGRAVE:
    case HEADSTONE:  intro = 'Something is engraved here on the floor.'; break;
    case BURN:       intro = 'Some text has been burned into the floor here.'; break;
    case MARK:       if (game.Blind) return false;
                     intro = "There's some graffiti on the floor here."; break;
    case ENGR_BLOOD: if (game.Blind) return false;
                     intro = 'You see a message scrawled in blood here.'; break;
    default: return false;
    }
    const last = text.charAt(text.length - 1);
    const endpunct = (text.length >= 2 && '.!?'.includes(last)) ? '' : '.';
    await update_topl(intro);
    await update_topl(`You read: "${text}"${endpunct}`);
    ep.eread = 1;
    ep.erevealed = 1;
    return true;
}

// C ref: invent.c look_here() — report the dungeon feature and/or objects under
// the hero.  Ports the no-object, single-object, and feature-only branches the
// recorded sessions exercise; the multi-object menu branch is left for callers
// that need it.  Returns ECMD_OK / ECMD_TIME.  When both a feature and exactly
// one object are present, C prints the feature line, then the object line, which
// pages the feature line with --More-- (the recorded final frame).
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
        const trap = trap_at_hero();
        if (trap && trap.tseen) {
            const { trap_explanation } = await import('./trap.js');
            await update_topl(`There is ${an(trap_explanation(trap.ttyp))} here.`);
        }
    }

    // C ref: invent.c:4184 — a BLIND hero gropes around FIRST, before anything
    // else is described: "You try to feel what is lying here on the floor."
    // This whole block was missing, so a blind #look printed the sighted
    // wording with no groping line at all.  (can_reach_floor()'s "But you can't
    // reach it!" early-out needs the levitation/ball-and-chain state this port
    // does not model for the floor test, so only the reachable arm is emitted.)
    if (Blind_for_wear()) {
        if (dfeature && dfeature.startsWith('altar ')) {
            await update_topl('You try to feel what is here.');
        } else {
            const surf = surface(x, y);
            await update_topl(`You try to feel what is lying here on the ${surf}.`);
            if (dfeature && dfeature === surf) dfeature = null; /* skip_dfeature */
        }
    }

    if (!otmp) {
        // No object: feature (if any), then any engraving, then "no objects"
        // (only when blind or there was no feature to report).
        // C ref: invent.c look_here() !otmp branch — pline1(fbuf); read_engr_at();
        // if (!skip_objects && (Blind || !dfeature)) You("%s no objects here.", verb).
        if (dfeature) await update_topl(`There is ${an(dfeature)} here.`);
        await read_engr_at_topl(x, y);
        if (!skip_objects && (Blind_for_wear() || !dfeature))
            await update_topl(`You ${verb} no objects here.`);
        return Blind_for_wear() ? ECMD_TIME : ECMD_OK;
    }
    if (skip_objects) {
        // C ref: invent.c look_here():4249 — too many objects to list.
        if (dfeature) await update_topl(`There is ${an(dfeature)} here.`);
        await read_engr_at_topl(x, y);
        if (obj_cnt === 1 && (otmp.quan || 1) === 1)
            await update_topl(`There is ${picked_some ? 'another' : 'an'} object here.`);
        else
            await update_topl(`There are ${(obj_cnt === 2) ? 'two'
                : (obj_cnt < 5) ? 'a few'
                    : (obj_cnt < 10) ? 'several'
                        : 'many'}${picked_some ? ' more' : ''} objects here.`);
        for (const o of here)
            if (o.otyp === CORPSE && will_feel_cockatrice(o, false)) {
                feel_cockatrice(o, false);
                break;
            }
        return Blind_for_wear() ? ECMD_TIME : ECMD_OK;
    }
    if (here.length === 1) {
        // Single object (plus possibly a feature underneath).
        if (dfeature) {
            // First the feature pline, then the object pline.  update_topl pages
            // the unacknowledged feature message with --More-- before showing
            // the object line.
            game._pending_message = `There is ${an(dfeature)} here.`;
            game._toplin = 1; // NEED_MORE
            await update_topl(`You ${verb} here ${doname_with_price(otmp)}.`);
        } else if (Blind_for_wear()) {
            // The blind grope line above is already an unacknowledged topline,
            // so this second pline must chain through update_topl — which pages
            // it with --More-- when the pair overflows CO-8 (C's behaviour) —
            // instead of silently overwriting it.
            await update_topl(`You ${verb} here ${doname_with_price(otmp)}.`);
        } else {
            game._pending_message = `You ${verb} here ${doname_with_price(otmp)}.`;
        }
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
    const pre = dfeature ? [`There is ${an(dfeature)} here.`, ''] : [];
    await renderThingsHereMenu(header, itemLines, pre);
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
        await topl_more();
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
        if (c === 32 || c === 13 || c === 10 || c === 27) break;
    }
    delete game._modal_screen;
}

export async function dolook() {
    await look_here(0, 0);
    await renderMessageOnMap(game._pending_message || 'You see no objects here.');
    return ECMD_OK;
}

// C ref: invent.c will_feel_cockatrice() — the petrifying-corpse test is on the
// corpse's OWN species (touch_petrifies(&mons[otmp->corpsenm])); passing null
// meant the predicate could never be true.
export function will_feel_cockatrice(otmp, force_touch) {
    return !!((game.Blind || force_touch) && !game.uarmg && !game.Stone_resistance
        && otmp?.otyp === CORPSE && touch_petrifies(otmp.corpsenm));
}

export function feel_cockatrice(otmp, force_touch) {
    if (will_feel_cockatrice(otmp, force_touch))
        instapetrify(`touching ${killer_xname(otmp)} bare-handed`);
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
    if (obj.unpaid !== otmp.unpaid || obj.spe !== otmp.spe || obj.no_charge !== otmp.no_charge
        || obj.obroken !== otmp.obroken || obj.otrapped !== otmp.otrapped || obj.lamplit !== otmp.lamplit)
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
    if (safe_oname(obj) && safe_oname(otmp) && safe_oname(obj) !== safe_oname(otmp)) return false;
    if (has_omailcmd(obj) !== has_omailcmd(otmp) || OMAILCMD(obj) !== OMAILCMD(otmp)) return false;
    if (obj.oartifact !== otmp.oartifact) return false;
    return true;
}

// C ref: invent.c doprgold() — the '$' command.  Reports wallet gold
// (money_cnt over invent incl. containers) + any hidden_gold(); flags.verbose
// (the default / covered path) uses the "Your wallet ..." phrasing.  A plain
// pline (not a blocking window), so the following key is a normal command.
export async function doprgold() {
    const umoney = money_cnt(inventoryArray()) || game._goldCount || 0;
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
    shopper_financial_report();
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
        await dispinv_with_action(lets, true, null);
    }
    return ECMD_OK;
}

export function noarmor(report_uskin) {
    game._pending_message = report_uskin && game.uskin
        ? `You are not wearing armor but have ${simpleonames(game.uskin)} embedded in your skin.`
        : 'You are not wearing any armor.';
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
        await dispinv_with_action(worn.map((o) => o.invlet).join(''), true, null);
    }
    return ECMD_OK;
}

// C ref: invent.c doprring() — the '=' command (#seerings).
export async function doprring() {
    const worn = [game.uright, game.uleft].filter(Boolean);
    if (!worn.length) {
        game._pending_message = 'You are not wearing any rings.';
    } else if (worn.length === 1 && !game.iflags?.menu_requested) {
        prinv(null, worn[0], 0);
    } else {
        await dispinv_with_action(worn.map((o) => o.invlet).join(''), true,
                                  worn.length === 1 ? 'Ring' : 'Rings');
    }
    return ECMD_OK;
}

// C ref: invent.c dopramulet() — the '"' command (#seeamulet).
export async function dopramulet() {
    if (!game.uamul) {
        game._pending_message = 'You are not wearing an amulet.';
    } else if (!game.iflags?.menu_requested) {
        prinv(null, game.uamul, 0);
    } else {
        await dispinv_with_action(String(obj_to_let(game.uamul)), true, 'Amulet');
    }
    return ECMD_OK;
}

export function tool_being_used(obj) {
    if (obj?.owornmask & (W_TOOL | W_SADDLE)) return true;
    if (obj?.oclass !== TOOL_CLASS) return false;
    return obj === game.uwep || obj.lamplit || (obj.otyp === LEASH && obj.leashmon);
}

// C ref: invent.c doprtool() — the '(' command.  Nothing in use is a one-line
// message; otherwise dispinv_with_action(lets, TRUE, NULL), a PICK_ONE menu
// whose keystrokes belong to the menu rather than to the command parser.
export async function doprtool() {
    const lets = inventoryArray().filter(tool_being_used).map((obj) => obj_to_let(obj)).join('');
    if (!lets) await pline('You are not using any tools.');
    else await dispinv_with_action(lets, true, null);
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
        game._pending_message = `You aren't carrying anything ${inv.length ? 'adjustable' : 'to adjust'}.`;
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
    if (primary) setuwep_slot(null);
    if (alternate) setuswapwep(null);
    if (quivered) setuqwep(null);
    if (primary) setuwep_slot(to);
    else if (alternate) setuswapwep(to);
    else if (quivered) setuqwep(to);
    if (game.u?.twoweap && !game.uswapwep) game.u.twoweap = 0;
}

export async function doorganize_core(obj) {
    if (!obj) return ECMD_CANCEL;

    const inv = inventoryArray();
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const available = [...alphabet].filter((letter) => {
        const occupant = inv.find((other) => other !== obj && other.invlet === letter);
        return !occupant || mergable(occupant, obj);
    });
    const choices = compactify(available.join(''));
    const prompt = `Adjust letter to what [${choices}] (? see used letters)?`;
    const isgold = obj.oclass === COIN_CLASS;

    for (let trycnt = 1; ; ++trycnt) {
        const key = isgold ? GOLD_SYM
            : String.fromCharCode(await topline_query(prompt));
        if (QUITCHARS.includes(key)) {
            await pline('Never mind.');
            return ECMD_OK;
        }
        if (key === GOLD_SYM && !isgold) {
            await pline(`Only gold coins may be moved into the '${GOLD_SYM}' slot.`);
            return ECMD_OK;
        }
        if (!/^[A-Za-z#]$/.test(key) && key !== GOLD_SYM) {
            await pline('Select an inventory slot letter.');
            if (trycnt >= 5) {
                await pline('Never mind.');
                return ECMD_OK;
            }
            continue;
        }

        const oldlet = obj.invlet;
        const destination = inv.find((other) => other !== obj && other.invlet === key);
        let result = obj;
        let action = key === oldlet ? 'Collecting:' : 'Moving:';

        if (key === oldlet) {
            for (const other of [...inv]) {
                if (other === result || other.invlet === oldlet) continue;
                if (!has_oname(other) || (has_oname(result) && ONAME(other) === ONAME(result))) {
                    if (mergable(result, other)) {
                        merge_equipped_references(other, result);
                        merged(result, other);
                    }
                }
            }
        } else if (destination && mergable(destination, obj)) {
            merge_equipped_references(obj, destination);
            merged(destination, obj);
            result = destination;
            action = 'Merging:';
        } else {
            if (destination) {
                destination.invlet = oldlet;
                action = 'Swapping:';
            }
            obj.invlet = key;
        }

        reorder_invent();
        if (game._merge_discovery_pending) {
            await report_merge_discovery();
            const acc = game._pending_message;
            prinv(action, result, 0);
            const line = game._pending_message;
            game._pending_message = acc;
            await update_topl(line);
        } else {
            prinv(action, result, 0);
        }
        update_inventory();
        return ECMD_OK;
    }
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
