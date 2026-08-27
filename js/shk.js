// shk.js — shop PRICING and the price strings doname() shows.
//
// C ref: src/shk.c.  This is the quoted-price core only: get_cost()/
// get_cost_of_shop_item() (what "(for sale, N zorkmids)" prints), set_cost()
// (what the shk pays when buying), unpaid_cost() ("(unpaid, N zorkmids)"),
// billable(), shk_names_obj(), inhishop() and costly_spot().
//
// NONE of these functions draws RNG.  Every rn2() on a shop path lives
// elsewhere — append_honorific() in addtobill(), the Kop spawn in
// hot_pursuit() — so a price that comes out wrong shifts screens without
// shifting the PRNG stream, which is exactly how a shop session can match 95%
// of C's RNG and 30% of its screens.
//
// The prices themselves come from js/objcost_data.js (objects[].oc_cost,
// dumped from the recorder's own objects.o) via mkobj.js base_oc_cost().

import { game } from './gstate.js';
import { objects, base_oc_cost, base_oc_weight, weight, next_ident,
         mksobj, place_object, remove_object, dealloc_obj, bill_dummy_object,
         newomid, MAGIC_LAMP, OIL_LAMP, BRASS_LANTERN, MAGIC_MARKER,
         BAG_OF_TRICKS, HORN_OF_PLENTY, CRYSTAL_BALL, MAGIC_FLUTE,
         DRUM_OF_EARTHQUAKE, CAN_OF_GREASE, TINNING_KIT, EXPENSIVE_CAMERA,
         POT_OIL, ROCK, BOULDER, LEASH,
         CANDELABRUM_OF_INVOCATION } from './mkobj.js';
import { acurr_eff, adjalign, exercise } from './attrib.js';
import { monster_by_pmidx, mpickobj } from './makemon.js';
import { rn2 } from './rng.js';
import { update_topl, newsym, m_at, map_invisible } from './display.js';
import { MFLAGS1, MFLAGS2, M1_TPORT, M1_TPORT_CNTRL, M1_HUMANOID, M2_DEMON,
         M2_NEUTER, msound_of, passes_walls_flag } from './monflags_data.js';
import { in_rooms, shop_keeper, shkname } from './shkroom.js';
import { shtypes, VEGETARIAN_CLASS } from './shtypes.js';
import { observe_object, discover_object, record_price_quote } from './o_init.js';
// currency() is NOT re-implemented here: C's currency() rolls
// ROLL_FROM(currencies) while hallucinating, so a local copy would silently
// drop an rn2() draw from every "(unpaid, N ...)" render.
import { currency, objects_at, count_contents, obj_extract_self, obfree,
         xname, doname_invent, ansimpleoname, is_pick, carrying,
         update_inventory, xprname, body_part } from './invent.js';
import { A_CHA, A_WIS, HUNGRY, SHOPBASE, ROOMOFFSET, NO_ROOM,
         isok, IS_DOOR, IS_ROOM, IS_WALL, ZAP_POS, REPAIR_DELAY, BOLT_LIM,
         SVALL, D_CLOSED, D_BROKEN, PL_NSIZ, ANY_TYPE, ANY_SHOP, OROOM,
         CANDLESHOP, LANDMINE, BEAR_TRAP, HOLE, PIT, SPIKED_PIT,
         SELL_NORMAL, SELL_DONTSELL, M_AP_NOTHING, M_AP_MONSTER,
         ARM, HAND, HEAD, NECK, COLNO, ROWNO, D_LOCKED, TT_PIT,
         W_SWAPWEP, W_QUIVER } from './const.js';

// ── constants ────────────────────────────────────────────────────────────────
// objclass.h object classes.
const RANDOM_CLASS = 0, WEAPON_CLASS = 2, ARMOR_CLASS = 3, TOOL_CLASS = 6,
      FOOD_CLASS = 7, POTION_CLASS = 8, SCROLL_CLASS = 9, SPBOOK_CLASS = 10,
      WAND_CLASS = 11, COIN_CLASS = 12, GEM_CLASS = 13, BALL_CLASS = 15;
// Verified against js/mkobj.js objects[].oclass (11 = generic wand,
// 15 = generic iron ball).  shkroom.js's private copy says WAND_CLASS = 10,
// which is SPBOOK_CLASS — see the deferred note.

// objects.h otyps referenced by name in shk.c.
const DUNCE_CAP = 94, MIRROR = 218, TALLOW_CANDLE = 224, WAX_CANDLE = 225,
      CORPSE = 265, EGG = 266, TIN = 296, POT_WATER = 322;
const FIRST_REAL_GEM = 439;         // objects.h MARKER(FIRST_REAL_GEM, DILITHIUM_CRYSTAL)
const FIRST_GLASS_GEM = 461;        // objects.h MARKER(FIRST_GLASS_GEM, WORTHLESS_WHITE_GLASS)
// objclass.h materials.
const VEGGY = 3, GLASS = 19, GEMSTONE = 20;
const STRANGE_OBJECT = 0;
const NON_PM = -1;                  // monsters.h

// defsym.h MONSYM() indices (makemon.js MONS[].mcls carries the same number).
const S_BLOB = 2, S_JELLY = 10, S_VORTEX = 22, S_LIGHT = 25,
      S_ELEMENTAL = 31, S_FUNGUS = 32, S_PUDDING = 42, S_GHOST = 54,
      S_GOLEM = 55;
// pmidx of the species vegan()/vegetarian() carve out by identity.
const PM_STALKER = 153, PM_BLACK_PUDDING = 209, PM_LEATHER_GOLEM = 253,
      PM_FLESH_GOLEM = 255;

const PM_TOURIST = 10;              // roles[].mnum
const MAXULEV = 30;                 // you.h
const G_UNIQ = 0x1000;              // monflag.h
const NUMMONS = 383;                // mons[] size in the recorder build
const BILLSZ = 200;                 // shk.h

// hack.h — unpaid_cost()'s cost_type.
export const COST_NOCONTENTS = 0, COST_CONTENTS = 1, COST_SINGLEOBJ = 2;

// obj.h obj->where.  This port stores `where` as a STRING (mkobj.js/invent.js),
// not the C small-int, so compare against these spellings.
const OBJ_FREE = 'free', OBJ_FLOOR = 'floor', OBJ_CONTAINED = 'contained',
      OBJ_INVENT = 'invent', OBJ_MINVENT = 'minvent';

const carried = (o) => o.where === OBJ_INVENT;
// obj.h Has_contents(o) — the Is_container()/STATUE test is commented out in C,
// so it really is just "has a contents chain".
const Has_contents = (o) => !!(o && o.cobj && o.cobj.length);
const Is_candle = (o) => o.otyp === TALLOW_CANDLE || o.otyp === WAX_CANDLE;

// ── mons[].mconveys ──────────────────────────────────────────────────────────
// permonst.mconveys — the SECOND MR_* argument of each MON() entry (the first
// is mresists, which makemon.js already carries as MONS[].mresists; they differ
// for e.g. a wraith, which resists nothing it conveys).  corpsenm_price_adj()
// is the only caller here, and without this column every tin/egg/corpse in a
// delicatessen prices as 0 -> get_cost()'s `if (!tmp) tmp = 5` floor.
//
// Extracted from nethack-c/recorder/include/monsters.h with the same
// preprocessor-guard handling swarm/bin/gen-monflags.mjs uses (MAIL_STRUCTURES
// defined, CHARON not, `#if 0` beholder excluded) and verified index-aligned
// BY NAME against js/makemon.js for all 383 entries.
// monflag.h: MR_FIRE 0x01 MR_COLD 0x02 MR_SLEEP 0x04 MR_DISINT 0x08
//            MR_ELEC 0x10 MR_POISON 0x20 MR_ACID 0x40 MR_STONE 0x80
const MR_FIRE = 0x01, MR_COLD = 0x02, MR_SLEEP = 0x04, MR_DISINT = 0x08,
      MR_ELEC = 0x10, MR_POISON = 0x20, MR_ACID = 0x40, MR_STONE = 0x80;

const MCONVEYS = [
    0x0, 0x20, 0x20, 0x1, 0x20, 0x20, 0xc0, 0x20, 0x17, 0xa0, 0xa0, 0x21,
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x2, 0x0,
    0x2, 0x1, 0x1, 0x0, 0x0, 0x2, 0x1, 0x10, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x20, 0x80, 0x80, 0x0, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x24, 0x0, 0x4, 0x20, 0x20, 0x22, 0xc0, 0xc0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x20, 0x20,
    0x20, 0x20, 0x0, 0x0, 0x0, 0x20, 0x20, 0x20, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x20, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x1, 0x2, 0x4, 0x8, 0x10, 0x20, 0xc0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x22, 0x20, 0xc0, 0x21, 0x20, 0x20, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x1, 0x2, 0x0, 0x10, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x2, 0x2, 0x3, 0x3, 0x0, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x20, 0x20, 0x20, 0x20, 0x21, 0xe0, 0x20, 0x20, 0x0,
    0x0, 0x0, 0x23, 0x32, 0xc0, 0x32, 0x0, 0x0, 0x0, 0x0, 0x0, 0x20,
    0x20, 0x0, 0x20, 0x20, 0x0, 0x2, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x80, 0x0, 0x0, 0x0, 0x2, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x37, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
    0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x20, 0x0, 0x0, 0x0, 0x0, 0xa0, 0x21, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x20, 0x0, 0x0, 0x0, 0x10, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x80, 0x0, 0x0, 0x1, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0xff,
    0x0, 0x1, 0x20, 0x0, 0x20, 0x0, 0x0, 0x1, 0x0, 0x0, 0x0, 0x0,
    0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
];

// mondata.h telepathic(ptr) — an explicit three-species test in C, NOT a flag.
const PM_FLOATING_EYE = 28, PM_MIND_FLAYER = 48, PM_MASTER_MIND_FLAYER = 49;

// monst.h ismnum(x) = (x >= LOW_PM && x < NUMMONS); LOW_PM is 0.
const ismnum = (x) => Number.isInteger(x) && x >= 0 && x < NUMMONS;
// mondata.h unique_corpstat(ptr) = (ptr->geno & G_UNIQ) != 0
const unique_corpstat = (ptr) => ((ptr?.geno ?? 0) & G_UNIQ) !== 0;

// C ref: eat.c intrinsic_possible(type, ptr).  prop.h numbers are irrelevant
// here — shk.c's icost[] names the properties, so key on those names directly.
function intrinsic_possible(trinsic, ptr) {
    const idx = ptr?.pmidx;
    const conv = idx != null ? (MCONVEYS[idx] || 0) : 0;
    const f1 = idx != null ? (MFLAGS1[idx] || 0) : 0;
    switch (trinsic) {
    case 'FIRE_RES':   return (conv & MR_FIRE) !== 0;
    case 'SLEEP_RES':  return (conv & MR_SLEEP) !== 0;
    case 'COLD_RES':   return (conv & MR_COLD) !== 0;
    case 'DISINT_RES': return (conv & MR_DISINT) !== 0;
    case 'SHOCK_RES':  return (conv & MR_ELEC) !== 0;
    case 'POISON_RES': return (conv & MR_POISON) !== 0;
    case 'ACID_RES':   return (conv & MR_ACID) !== 0;
    case 'STONE_RES':  return (conv & MR_STONE) !== 0;
    case 'TELEPORT':   return (f1 & M1_TPORT) !== 0;
    case 'TELEPORT_CONTROL': return (f1 & M1_TPORT_CNTRL) !== 0;
    case 'TELEPAT':
        return idx === PM_FLOATING_EYE || idx === PM_MIND_FLAYER
            || idx === PM_MASTER_MIND_FLAYER;
    default: return false;
    }
}

// C ref: shk.c corpsenm_price_adj(obj):4275 — a tin/egg/corpse costs more the
// more intrinsics it can grant and the tougher the beast was.
const ICOST = [
    ['FIRE_RES', 2], ['SLEEP_RES', 3], ['COLD_RES', 2], ['DISINT_RES', 5],
    ['SHOCK_RES', 4], ['POISON_RES', 2], ['ACID_RES', 1], ['STONE_RES', 3],
    ['TELEPORT', 2], ['TELEPORT_CONTROL', 3], ['TELEPAT', 5],
];

export function corpsenm_price_adj(obj) {
    let val = 0;
    if ((obj.otyp === TIN || obj.otyp === EGG || obj.otyp === CORPSE)
        && ismnum(obj.corpsenm)) {
        const ptr = monster_by_pmidx(obj.corpsenm);
        if (!ptr) return 0;
        let tmp = 1;
        for (const [trinsic, cost] of ICOST)
            if (intrinsic_possible(trinsic, ptr)) tmp += cost;
        if (unique_corpstat(ptr)) tmp += 50;

        val = Math.max(1, (ptr.mlevel - 1) * 2);
        if (obj.otyp === CORPSE)
            val += Math.max(1, Math.trunc((ptr.cnutrit ?? 0) / 30));
        val = val * tmp;
    }
    return val;
}

// ── price helpers ────────────────────────────────────────────────────────────

// C ref: shk.c get_pricing_units(obj) — quan, except globs sell by weight.
// C falls back to weight(obj) when owt is 0; using 0 there rounds units to 0
// and prices the whole glob at nothing.
export function get_pricing_units(obj) {
    let units = obj.quan ?? 1;
    if (obj.globby) {
        const unit_weight = base_oc_weight(obj) || 0;
        const wt = (obj.owt > 0) ? obj.owt : weight(obj);
        if (unit_weight) units = Math.trunc((wt + unit_weight - 1) / unit_weight);
    }
    return units;
}

// C ref: shk.c oid_price_adjustment(obj, oid):2860 — one unidentified item in
// four (by o_id, so it is stable within a game) carries a surcharge.
export function oid_price_adjustment(obj, oid) {
    const o = objects[obj.otyp];
    if (!(obj.dknown && o?.oc_name_known)
        && (obj.oclass !== GEM_CLASS || o?.material !== GLASS))
        return (oid % 4) === 0 ? 1 : 0;
    return 0;
}

// C ref: artifact.c arti_cost(otmp).  artilist[] is not ported, so an artifact
// with no listed cost is the only branch we can evaluate; see the deferred note.
function arti_cost(obj) {
    if (!obj.oartifact) return base_oc_cost(obj.otyp);
    return 100 * base_oc_cost(obj.otyp);
}

// C ref: shk.c getprice(obj, shk_buying):4318 — list price before the shk's
// charisma / dunce-cap / unidentified multipliers.
export function getprice(obj, shk_buying) {
    let tmp = base_oc_cost(obj.otyp);

    if (obj.oartifact) {
        tmp = arti_cost(obj);
        if (shk_buying) tmp = Math.trunc(tmp / 4);
    }
    switch (obj.oclass) {
    case FOOD_CLASS:
        tmp += corpsenm_price_adj(obj);
        // C: a HUNGRY-or-worse hero is charged u.uhs (2..4)x for food.
        if ((game.u?.uhs || 0) >= HUNGRY && !shk_buying) tmp *= game.u.uhs;
        if (obj.oeaten) tmp = 0;
        break;
    case WAND_CLASS:
        if (obj.spe === -1) tmp = 0;
        break;
    case POTION_CLASS:
        if (obj.otyp === POT_WATER && !obj.blessed && !obj.cursed) tmp = 0;
        break;
    case ARMOR_CLASS:
    case WEAPON_CLASS:
        if ((obj.spe || 0) > 0) tmp += 10 * obj.spe;
        break;
    case TOOL_CLASS:
        if (Is_candle(obj) && (obj.age || 0) < 20 * base_oc_cost(obj.otyp))
            tmp = Math.trunc(tmp / 2);
        break;
    default: break;
    }
    return tmp;
}

// C ref: shk.c get_cost():2877 glass-gem branch — `(int) ubirthday % otyp`.
// ubirthday is the game-start wall clock in SECONDS; shknam.c's nameshk() seed
// derives it the same way (see js/shknam.js ubirthdaySeconds(), which measured
// the recordings' fixed UTC-4 offset against four recorded shopkeeper names).
// game.ubirthday is never assigned anywhere in this port, so reading it
// directly makes the expression 0 and the pseudorandom bit constantly false.
const UBIRTHDAY_UTC_OFFSET = -4 * 3600;
function ubirthday() {
    if (typeof game.ubirthday === 'number' && game.ubirthday) return game.ubirthday;
    const dt = String(game.datetime || '');
    if (!/^\d{14}$/.test(dt)) return 0;
    const y = +dt.slice(0, 4), mo = +dt.slice(4, 6), d = +dt.slice(6, 8);
    const h = +dt.slice(8, 10), mi = +dt.slice(10, 12), s = +dt.slice(12, 14);
    // C truncates to `int`; a 2026 epoch-second count fits in int32 unchanged.
    return (Math.trunc(Date.UTC(y, mo - 1, d, h, mi, s) / 1000)
            - UBIRTHDAY_UTC_OFFSET) | 0;
}

// C ref: shk.c get_cost() — each worthless glass gem is priced as one of two
// real gems, picked by a per-game pseudorandom bit.  Indexed from
// FIRST_GLASS_GEM; [pseudorand ? a : b].
const GLASS_GEM_PRICED_AS = [
    [440, 452],  // white:  diamond / opal
    [443, 448],  // blue:   sapphire / aquamarine
    [441, 456],  // red:    ruby / jasper
    [449, 450],  // yellowish brown: amber / topaz
    [442, 459],  // orange: jacinth / agate
    [447, 453],  // yellow: citrine / chrysoberyl
    [444, 451],  // black:  black opal / jet
    [445, 460],  // green:  emerald / jade
    [455, 457],  // violet: amethyst / fluorite
];

// C ref: shk.c get_cost(obj, shkp):2877 — what the shk CHARGES for one of obj.
// No RNG.
export function get_cost(obj, shkp) {
    let tmp = getprice(obj, false);
    let multiplier = 1, divisor = 1;

    if (!tmp) tmp = 5;
    if (!obj.dknown || !objects[obj.otyp]?.oc_name_known) {
        if (obj.oclass === GEM_CLASS && objects[obj.otyp]?.material === GLASS) {
            const pseudorand =
                (ubirthday() % obj.otyp) >= Math.trunc(obj.otyp / 2);
            const pair = GLASS_GEM_PRICED_AS[obj.otyp - FIRST_GLASS_GEM];
            // C impossible()s on an out-of-range glass gem and uses
            // objects[STRANGE_OBJECT].oc_cost (0).
            tmp = pair ? base_oc_cost(pseudorand ? pair[0] : pair[1])
                       : base_oc_cost(STRANGE_OBJECT);
        } else if (oid_price_adjustment(obj, obj.o_id) > 0) {
            multiplier *= 4; divisor *= 3;
        }
    }
    if (game.uarmh && game.uarmh.otyp === DUNCE_CAP) {
        multiplier *= 4; divisor *= 3;
    } else if ((game.urole?.mnum === PM_TOURIST
                && (game.u?.ulevel || 1) < Math.trunc(MAXULEV / 2))
               || (game.uarmu && !game.uarm && !game.uarmc)) {
        multiplier *= 4; divisor *= 3;
    }

    const cha = acurr_eff(A_CHA);
    if (cha > 18) divisor *= 2;
    else if (cha === 18) { multiplier *= 2; divisor *= 3; }
    else if (cha >= 16) { multiplier *= 3; divisor *= 4; }
    else if (cha <= 5) multiplier *= 2;
    else if (cha <= 7) { multiplier *= 3; divisor *= 2; }
    else if (cha <= 10) { multiplier *= 4; divisor *= 3; }

    tmp *= multiplier;
    if (divisor > 1) {
        // C: tmp = (((tmp * 10) / divisor) + 5) / 10 — integer round-half-up.
        tmp = Math.trunc((Math.trunc((tmp * 10) / divisor) + 5) / 10);
    }
    if (tmp <= 0) tmp = 1;
    if (obj.oartifact) tmp *= 4;
    // C applies the anger surcharge separately from multiplier/divisor so it
    // matches rile_shk()'s.
    if (shkp?.eshk?.surcharge) tmp += Math.trunc((tmp + 2) / 3);
    return tmp;
}

// C ref: shk.c set_cost(obj, shkp):3148 — what the shk PAYS for all of obj.
// Note this one is for the whole stack (it multiplies by get_pricing_units
// itself), unlike get_cost() which is per unit.  No RNG.
export function set_cost(obj, shkp) {
    const unit_price = getprice(obj, true);
    let tmp = get_pricing_units(obj) * unit_price;
    let multiplier = 1, divisor = 1;

    if (game.uarmh && game.uarmh.otyp === DUNCE_CAP) divisor *= 3;
    else if ((game.urole?.mnum === PM_TOURIST
              && (game.u?.ulevel || 1) < Math.trunc(MAXULEV / 2))
             || (game.uarmu && !game.uarm && !game.uarmc)) divisor *= 3;
    else divisor *= 2;

    if (!obj.dknown || !objects[obj.otyp]?.oc_name_known) {
        if (obj.oclass === GEM_CLASS) {
            const mat = objects[obj.otyp]?.material;
            if (mat === GEMSTONE || mat === GLASS) {
                // C: different shopkeepers give different prices; m_id keys it.
                tmp = (obj.otyp - FIRST_REAL_GEM) % (6 - (shkp.m_id % 3));
                tmp = (tmp + 3) * (obj.quan ?? 1);
                divisor = 1;
            }
        } else if (tmp > 1 && !(shkp.m_id % 4)) {
            multiplier *= 3; divisor *= 4;
        }
    }

    if (tmp >= 1) {
        tmp *= multiplier;
        if (divisor > 1) {
            tmp = Math.trunc((Math.trunc((tmp * 10) / divisor) + 5) / 10);
        }
        if (tmp < 1) tmp = 1;   /* avoid adjusting nonzero to zero */
    }
    /* (no adjustment for angry shk here) */
    return tmp;
}

// ── shop geometry ────────────────────────────────────────────────────────────

// C ref: shk.c inhishop(shkp):1039 — is the shk inside her shop OR ON ITS
// BOUNDARY?  C asks in_rooms(mx, my, SHOPBASE) and searches the result for
// shoproom; reading levl[mx][my].roomno directly answers NO_ROOM/SHARED for a
// shk standing in her own doorway, which is where shopkeepers usually stand.
export function inhishop(shkp) {
    const eshk = shkp?.eshk;
    if (!eshk) return false;
    // C also requires on_level(&eshkp->shoplevel, &u.uz); eshk.shoplevel is
    // never populated by this port's shkinit, and shop_keeper() only ever
    // resolves residents of the current level's rooms, so it is implied.
    if (eshk.shoplevel && game.u?.uz
        && (eshk.shoplevel.dnum !== game.u.uz.dnum
            || eshk.shoplevel.dlevel !== game.u.uz.dlevel)) return false;
    return in_rooms(shkp.mx, shkp.my, SHOPBASE).includes(eshk.shoproom);
}

// C ref: shk.c inside_shop(x, y) — the shop's room number, 0 if not inside.
// levl[x][y].edge marks the wall ring, which is NOT "inside".
export function inside_shop(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return 0;
    const rno = loc.roomno ?? NO_ROOM;
    if (rno < ROOMOFFSET || loc.edge) return 0;
    const rtype = game.level?.rooms?.[rno - ROOMOFFSET]?.rtype ?? 0;
    return rtype >= SHOPBASE ? rno : 0;
}

// C ref: shk.c costly_spot(x, y):5350 — shop floor whose contents the shk owns.
// The shk's own square (eshk->shk, the "free spot" just inside the door) is
// excluded: goods dropped there are not charged for.
export function costly_spot(x, y) {
    if (!game.level?.flags?.has_shop) return false;
    const shkp = shop_keeper(in_rooms(x, y, SHOPBASE)[0]);
    if (!shkp || !inhishop(shkp)) return false;
    const eshk = shkp.eshk;
    return !!inside_shop(x, y)
        && !(x === eshk.shk?.x && y === eshk.shk?.y);
}

// C ref: shk.c onbill(obj, shkp, silent) — obj's bill entry, if any.
function onbill(obj, shkp) {
    const eshk = shkp?.eshk;
    if (!eshk?.bill) return null;
    for (let ct = 0; ct < (eshk.billct || 0); ct++)
        if (eshk.bill[ct]?.bo_id === obj.o_id) return eshk.bill[ct];
    return null;
}

// C ref: obj.c get_obj_location(obj, &x, &y, CONTAINED_TOO) — an OBJ_CONTAINED
// object reports its outermost container's spot.  add_to_container() (mkobj.js)
// does not set ocontainer, so the walk falls back to a contents search.
function outermost(obj) {
    let top = obj, guard = 0;
    while (top.where === OBJ_CONTAINED && guard++ < 32) {
        const next = top.ocontainer || find_container_of(top);
        if (!next) break;
        top = next;
    }
    return top;
}

function find_container_of(obj) {
    const scan = (list, depth) => {
        if (depth > 8) return null;
        for (const o of list || []) {
            if (!o || !o.cobj) continue;
            if (o.cobj.includes(obj)) return o;
            const r = scan(o.cobj, depth + 1);
            if (r) return r;
        }
        return null;
    };
    return scan(game.level?.objects, 0) || scan(game.invent, 0) || null;
}

// C ref: zap.c get_obj_location(obj, &x, &y, CONTAINED_TOO).  OBJ_FREE,
// OBJ_ONBILL, OBJ_MIGRATING and (without BURIED_TOO) OBJ_BURIED all return
// FALSE with x=y=0, which is what makes get_cost_of_shop_item() quote nothing
// for an object that is between owners.
function obj_location(obj) {
    const top = outermost(obj);
    switch (top.where) {
    case OBJ_INVENT: return { x: game.u?.ux, y: game.u?.uy, ok: true };
    case OBJ_FLOOR:  return { x: top.ox, y: top.oy, ok: true };
    case OBJ_MINVENT:
        if (top.ocarry?.mx) return { x: top.ocarry.mx, y: top.ocarry.my, ok: true };
        break;
    default: break;
    }
    return { x: 0, y: 0, ok: false };
}

// ── the price strings ────────────────────────────────────────────────────────

// C ref: shk.c contained_cost(obj, shkp, price, usell, unpaid_only):2994 —
// the price of a container's CONTENTS ("the top container is added in the
// calling functions").
export function contained_cost(obj, shkp, price, usell, unpaid_only) {
    const top = outermost(obj);
    // pick_obj() removes the item from the floor, bills it, then puts it in
    // inventory; treat OBJ_FREE as still-on-floor for that window.
    const on_floor = (top.where === OBJ_FLOOR || top.where === OBJ_FREE);
    let x, y;
    const loc = obj_location(top);
    if (top.where === OBJ_FREE || !loc.ok) { x = game.u?.ux; y = game.u?.uy; }
    else { x = loc.x; y = loc.y; }
    const eshk = shkp?.eshk;
    const freespot = on_floor && x === eshk?.shk?.x && y === eshk?.shk?.y;

    for (const otmp of (obj.cobj || [])) {
        if (otmp.oclass === COIN_CLASS) continue;

        if (usell) {
            if (saleable(shkp, otmp) && !otmp.unpaid
                && otmp.oclass !== BALL_CLASS
                && !(otmp.oclass === FOOD_CLASS && otmp.oeaten)
                && !(Is_candle(otmp)
                     && (otmp.age || 0) < 20 * base_oc_cost(otmp.otyp)))
                price += set_cost(otmp, shkp);
        } else if (on_floor ? (!otmp.no_charge && !freespot)
                            : (otmp.unpaid || !unpaid_only)) {
            price += get_cost(otmp, shkp) * get_pricing_units(otmp);
        }

        if (Has_contents(otmp))
            price = contained_cost(otmp, shkp, price, usell, unpaid_only);
    }
    return price;
}

// C ref: shk.c contained_gold(obj, even_if_unknown):3044
export function contained_gold(obj, even_if_unknown) {
    let value = 0;
    for (const otmp of (obj.cobj || [])) {
        if (otmp.oclass === COIN_CLASS) value += (otmp.quan ?? 1);
        else if (Has_contents(otmp) && (otmp.cknown || even_if_unknown))
            value += contained_gold(otmp, even_if_unknown);
    }
    return value;
}

// C ref: shk.c get_cost_of_shop_item(obj, &nochrg):2809 — the "(for sale, N
// zorkmids)" price of something the hero is looking at on shop floor.
// nochrg: 1 = no charge, 0 = shop owned, -1 = not applicable (don't format).
export function get_cost_of_shop_item(obj) {
    const u = game.u;
    const res = { cost: 0, nochrg: -1 };
    if (!u?.ushops?.length || obj.oclass === COIN_CLASS
        || obj === u.uball || obj === u.uchain) return res;

    const loc = obj_location(obj);
    if (!loc.ok) return res;
    const { x, y } = loc;
    if (in_rooms(x, y, SHOPBASE)[0] !== u.ushops[0]) return res;
    const shkp = shop_keeper(inside_shop(x, y));
    if (!shkp || !inhishop(shkp)) return res;

    const top = outermost(obj);
    const eshk = shkp.eshk;
    const freespot = (top.where === OBJ_FLOOR
                      && x === eshk.shk?.x && y === eshk.shk?.y);
    // no_charge is only set for floor items inside the shop proper; items on
    // the free spot are implicitly 'no charge'.
    res.nochrg = (top.where === OBJ_FLOOR && (obj.no_charge || freespot)) ? 1 : 0;

    if (carried(top) ? !!obj.unpaid : !res.nochrg)
        res.cost = get_pricing_units(obj) * get_cost(obj, shkp);
    if (Has_contents(obj) && !freespot)
        res.cost += contained_cost(obj, shkp, 0, false, true);
    return res;
}

// C ref: shk.c unpaid_cost(unp_obj, cost_type):3260 — what doname() quotes for
// an unpaid inventory item.  doname() passes COST_CONTENTS, so a bag of unpaid
// goods must add its contents; quan (not get_pricing_units) is deliberate,
// because a glob's weight is already folded into bp->price.
export function unpaid_cost(unp_obj, cost_type = COST_CONTENTS) {
    let amt = 0, bp = null, shkp = null;
    for (const rno of (game.u?.ushops || [])) {
        shkp = shop_keeper(rno);
        if (!shkp) continue;
        bp = onbill(unp_obj, shkp);
        if (bp) {
            amt = bp.price;
            if (cost_type !== COST_SINGLEOBJ) amt *= (unp_obj.quan ?? 1);
        }
        if (cost_type === COST_CONTENTS && Has_contents(unp_obj))
            amt = contained_cost(unp_obj, shkp, amt, false, true);
        if (bp || (!unp_obj.unpaid && amt)) break;
    }
    return amt;
}

// C ref: shk.c is_unpaid(obj):1167 — obj itself, or anything inside it, is
// on a shop bill.
export function is_unpaid(obj) {
    if (obj.unpaid) return true;
    for (const o of (obj.cobj || [])) {
        if (o.unpaid) return true;
        if (Has_contents(o) && is_unpaid(o)) return true;
    }
    return false;
}

// C ref: shk.c picked_container(obj) — clear no_charge through every nesting
// level, not just the top one.
function picked_container(obj) {
    for (const otmp of (obj.cobj || [])) {
        if (otmp.no_charge) otmp.no_charge = 0;
        if (Has_contents(otmp)) picked_container(otmp);
    }
}

// C ref: shk.c billable(&shkpp, obj, roomno, reset_nocharge):3451 — decide
// whether a shopkeeper thinks the item belongs to her.  Returns the shk (C's
// out-parameter) or null.
export function billable(shkp, obj, roomno, reset_nocharge) {
    if (!shkp) {
        if (!roomno) return null;
        shkp = shop_keeper(roomno);
        if (!shkp || !inhishop(shkp)) return null;
    }
    /* perhaps we threw it away earlier */
    if (onbill(obj, shkp) || (obj.oclass === FOOD_CLASS && obj.oeaten))
        return null;
    // An outer container marked no_charge can still hold chargeable contents;
    // only then does picking it up clear the flag.
    if (obj.no_charge) {
        if (!Has_contents(obj)
            || (contained_gold(obj, true) === 0
                && contained_cost(obj, shkp, 0, false, !reset_nocharge) === 0))
            shkp = null;
        if (reset_nocharge && !shkp && obj.oclass !== COIN_CLASS) {
            obj.no_charge = 0;
            if (Has_contents(obj)) picked_container(obj);
        }
    }
    return shkp || null;
}

// C ref: shknam.c saleable(shkp, obj) — does this shop deal in obj's class?
// A RANDOM_CLASS shop (the general store) takes everything.
export function saleable(shkp, obj) {
    const shp_indx = (shkp?.eshk?.shoptype ?? 0) - SHOPBASE;
    const shp = shtypes[shp_indx];
    if (!shp) return false;
    if (shp.symb === RANDOM_CLASS) return true;
    for (const ip of (shp.iprobs || [])) {
        if (!ip.iprob) break;
        if (ip.itype === VEGETARIAN_CLASS) {
            if (veggy_item(obj)) return true;
        } else if (ip.itype < 0 ? ip.itype === -obj.otyp
                                : ip.itype === obj.oclass) return true;
    }
    return false;
}

// C ref: mondata.h vegan(ptr) / vegetarian(ptr).
function vegan(ptr) {
    const c = ptr?.mcls, i = ptr?.pmidx;
    return c === S_BLOB || c === S_JELLY || c === S_FUNGUS || c === S_VORTEX
        || c === S_LIGHT
        || (c === S_ELEMENTAL && i !== PM_STALKER)
        || (c === S_GOLEM && i !== PM_FLESH_GOLEM && i !== PM_LEATHER_GOLEM)
        || c === S_GHOST; /* noncorporeal() */
}
function vegetarian(ptr) {
    return vegan(ptr) || (ptr?.mcls === S_PUDDING && ptr?.pmidx !== PM_BLACK_PUDDING);
}

// C ref: shknam.c veggy_item(obj, 0) — the object-mode call (shknam.js has a
// private type-only port, which stands PM_LICHEN in for tin/corpse contents;
// the object mode asks the real corpsenm instead).
function veggy_item(obj) {
    if (obj.oclass !== FOOD_CLASS) return false;
    if (objects[obj.otyp]?.material === VEGGY || obj.otyp === EGG) return true;
    if (obj.otyp === TIN && obj.corpsenm === NON_PM)
        return obj.spe === 1;   /* 0 = empty, 1 = spinach */
    if (obj.otyp === TIN || obj.otyp === CORPSE)
        return ismnum(obj.corpsenm) && vegetarian(monster_by_pmidx(obj.corpsenm));
    return false;
}

// C ref: objnam.c paydoname(obj) — the billing-style name: doname_base() with
// iflags.suppress_price set (the caller adds the billing price itself), plus
// the container wording.  suppress_price is honoured by shop_price_suffix()
// below, so this is only correct once doname() routes through that hook.
export async function paydoname(obj) {
    const { doname_invent } = await import('./invent.js');
    game.iflags = game.iflags || {};
    const save_cknown = obj.cknown, save_wizweight = game.iflags.wizweight;
    if (Has_contents(obj)) obj.cknown = 0;
    game.iflags.wizweight = false;
    game.iflags.suppress_price = (game.iflags.suppress_price || 0) + 1;
    let p = doname_invent(obj);
    game.iflags.suppress_price--;
    game.iflags.wizweight = save_wizweight;

    if (Has_contents(obj)) {
        // buy_container() sets no_charge on a just-purchased container so this
        // reads "a <container>" rather than "your <container>".
        if (!obj.no_charge) {
            if (p.startsWith('a ')) p = p.slice(2);
            else if (p.startsWith('an ')) p = p.slice(3);
            p = (obj.unpaid ? 'an unpaid ' : 'your ') + p;
        }
        if (!obj.cknown)
            p = obj.unpaid ? `${p} and its contents` : `the contents of ${p}`;
    }
    obj.cknown = save_cknown;
    return p;
}

// C ref: shk.c shk_names_obj(shkp, obj, fmt, amt, arg):3413 — "You bought a
// polished silver shield for 50 gold pieces."  The makeknown() here is a real
// state change: buying an ordinary weapon/armour/blank scroll from a shop that
// deals in it IDENTIFIES the type for the rest of the game.
export async function shk_names_obj(shkp, obj, fmt, amt, arg) {
    // update_topl(), not pline(): C's pline() ends in update_topl(), and the
    // NEED_MORE state it leaves is what puts the "--More--" between "You
    // bought ..." and the shk's "Thank you for shopping ..." verbalize.
    let was_unknown = !obj.dknown;

    observe_object(obj);
    // Real name for ordinary weapons/armour and spell-less scrolls/books
    // (blank and mail), but only within the shk's area of expertise.
    if (!objects[obj.otyp]?.oc_magic && saleable(shkp, obj)
        && (obj.oclass === WEAPON_CLASS || obj.oclass === ARMOR_CLASS
            || obj.oclass === SCROLL_CLASS || obj.oclass === SPBOOK_CLASS
            || obj.otyp === MIRROR)) {
        was_unknown = was_unknown || !objects[obj.otyp]?.oc_name_known;
        discover_object(obj.otyp, true, true, true); /* hack.h makeknown() */
    }
    let obj_name = await paydoname(obj);
    const plur = (n) => (n === 1 ? '' : 's');
    if (was_unknown) {
        // C: Sprintf(fmtbuf, "%%s; you %s", fmt) — the alternate phrasing used
        // when the transaction just revealed something.
        obj_name = obj_name.charAt(0).toUpperCase() + obj_name.slice(1);
        const body = fmt.replace('%s', (obj.quan ?? 1) > 1 ? 'them' : 'it')
            .replace('%ld', String(amt)).replace('%s', plur(amt))
            .replace('%s', arg);
        await update_topl(`${obj_name}; you ${body}`);
    } else {
        const body = fmt.replace('%s', obj_name)
            .replace('%ld', String(amt)).replace('%s', plur(amt))
            .replace('%s', arg);
        await update_topl(`You ${body}`);
    }
}

// ── the doname() suffix ──────────────────────────────────────────────────────

// C ref: objnam.c doname_base():1648-1682 — the shop-price suffix.  This is the
// whole point of the module: it is what the recorded screens actually SHOW.
//
//   is_unpaid(obj)          -> " (unpaid, N zorkmids)" / " (contents, N ...)"
//   with_price && price > 0 -> " (for sale, N zorkmids)" / " (contents, N ...)"
//   with_price && nochrg>0  -> " (no charge)"
//
// iflags.pricequotes (append_price_quote) is not modelled — see the deferred
// note; it is off by default and no recorded nethackrc turns it on.
export function shop_price_suffix(obj, with_price) {
    // C also skips while program_state.restoring; this port has no equivalent
    // flag and does not format objects during restore.
    if (!obj || game.iflags?.suppress_price) return '';
    // C ref: objnam.c:1663/:1681 — every price the hero is shown is also
    // recorded on the object TYPE, which is what the discoveries list's
    // " {buy N}" suffix reads back.
    if (is_unpaid(obj)) {
        const quoted = unpaid_cost(obj, COST_CONTENTS);
        record_price_quote(obj.otyp, Math.trunc(quoted / (obj.quan || 1)), true);
        return ` (${obj.unpaid ? 'unpaid' : 'contents'}, ${quoted} ${currency(quoted)})`;
    }
    if (with_price) {
        const { cost, nochrg } = get_cost_of_shop_item(obj);
        if (cost > 0) {
            record_price_quote(obj.otyp, Math.trunc(cost / (obj.quan || 1)), true);
            return ` (${nochrg ? 'contents' : 'for sale'}, ${cost} ${currency(cost)})`;
        }
        if (nochrg > 0) return ' (no charge)';
    }
    return '';
}

// ── the shop bill: paying for it ─────────────────────────────────────────────
// C ref: shk.c:17-29.  The itemized-bill machinery dopay() runs on; the command
// itself and its "Pay for which items?" menu live in invent.js (they need the
// tty menu renderer).

export const PAY_BUY = 1, PAY_CANT = 0, PAY_SKIP = -1, PAY_BROKE = -2;

// C ref: shk.c enum billitem_status:22.  The ORDER is load-bearing:
// sortbill_cmp() splits the bill on `usedup <= PartlyUsedUp`.
export const FullyUsedUp = 1, PartlyUsedUp = 2, PartlyIntact = 3,
             FullyIntact = 4, KnownContainer = 5, UndisclosedContainer = 6;

const OBJ_ONBILL = 'onbill';
const PM_ROGUE = 8;                 // roles[].mnum

// C ref: shk.c:57 NOTANGRY(mon)/ANGRY(mon).
export const NOTANGRY = (mon) => !!mon.mpeaceful;
export const ANGRY = (mon) => !mon.mpeaceful;
// C ref: monst.h helpless(mon).
const helpless = (mon) => !!(mon.msleeping || !mon.mcanmove);
// C ref: shk.c:60 muteshk(shkp).  sounds.h MS_ANIMAL == 17.
const MS_ANIMAL = 17;
const muteshk = (shkp) => helpless(shkp) || (msound_of(shkp.data) ?? 99) <= MS_ANIMAL;
// C ref: youprop.h Deaf.
const Deaf = () => ((game.u?.uprops?.Deaf || 0) > 0)
                   || ((game.u?.uprops?.HDeaf || 0) > 0);
// C ref: shk.c Shknam(shkp) — shkname() with the first letter capitalised.
export function Shknam(shkp) {
    const s = shkname(shkp);
    return s.charAt(0).toUpperCase() + s.slice(1);
}
const s_suffix = (s) => (/s$/.test(s) ? `${s}'` : `${s}'s`);
const plur = (n) => (n === 1 ? '' : 's');
// C ref: pline.c verbalize() — the line wrapped in double quotes.
const verbalize = (line) => update_topl(`"${line}"`);
// C ref: monst.h DEADMONSTER(mon).
const DEADMONSTER = (mon) => !mon || (mon.mhp != null && mon.mhp < 1);
// C ref: pronoun.c noit_mhe/noit_mhim/noit_mhis — never "it" for a shopkeeper.
const noit_mhe = (m) => (m?.female ? 'she' : 'he');
const noit_mhim = (m) => (m?.female ? 'her' : 'him');
const noit_mhis = (m) => (m?.female ? 'her' : 'his');

// C ref: hack.c money_cnt(otmp) — the quan of the FIRST coin stack on the
// chain.  It stops there and does NOT descend into containers (that is
// hidden_gold()'s job); invent.js's private money_cnt() does both, so dopay()
// uses this one.
export function money_cnt_invent() {
    for (const o of (game.invent || []))
        if (o.oclass === COIN_CLASS) return o.quan || 0;
    return 0;
}

// C ref: invent.c hidden_gold(even_if_unknown) — gold inside carried containers.
export function hidden_gold(even_if_unknown) {
    let value = 0;
    for (const obj of (game.invent || []))
        if (Has_contents(obj) && (obj.cknown || even_if_unknown))
            value += contained_gold(obj, even_if_unknown);
    return value;
}

// C ref: shk.c bp_to_obj(bp) -> o_on(id, gb.billobjs) / find_oid(id).
// gb.billobjs (the chain holding FULLY used up billed items) is not modelled by
// this port, so a useup entry whose object is already gone resolves to null and
// make_itemized_bill() drops it rather than listing a phantom line.
function oid_scan(list, id, depth) {
    for (const o of (list || [])) {
        if (!o) continue;
        if (o.o_id === id) return o;
        if (depth < 8 && o.cobj?.length) {
            const r = oid_scan(o.cobj, id, depth + 1);
            if (r) return r;
        }
    }
    return null;
}
export function bp_to_obj(bp) {
    const id = bp?.bo_id;
    if (id == null) return null;
    let r = oid_scan(game.invent, id, 0);
    if (r) return r;
    for (const mon of (game.level?.monsters || [])) {
        r = oid_scan(mon.minvent, id, 0);
        if (r) return r;
    }
    return oid_scan(game.level?.objects, id, 0);
}

// C ref: shk.c next_shkp(shkp, withbill):215 — the shopkeeper scan, INCLUDING
// its side effect: an angry shk whose surcharge has not been applied yet is
// riled (which rewrites every bill price) merely by being enumerated.
export function shk_scan(withbill) {
    const out = [];
    for (const mon of (game.level?.monsters || [])) {
        if (DEADMONSTER(mon)) continue;
        if (!mon.isshk || !mon.eshk) continue;
        if (withbill && !mon.eshk.billct) continue;
        if (ANGRY(mon) && !mon.eshk.surcharge) rile_shk(mon);
        out.push(mon);
    }
    return out;
}

// C ref: shk.c rile_shk(shkp):1360 — anger + a 4/3 surcharge on every entry.
export function rile_shk(shkp) {
    shkp.mpeaceful = 0;
    const eshk = shkp.eshk;
    if (!eshk || eshk.surcharge) return;
    eshk.surcharge = 1;
    for (let ct = 0; ct < (eshk.billct || 0); ct++)
        eshk.bill[ct].price += Math.trunc((eshk.bill[ct].price + 2) / 3);
}

// C ref: shk.c pacify_shk(shkp, clear_surcharge):1344 — undo the 33% increase.
export function pacify_shk(shkp, clear_surcharge) {
    shkp.mpeaceful = 1;
    const eshk = shkp.eshk;
    if (!clear_surcharge || !eshk?.surcharge) return;
    eshk.surcharge = 0;
    for (let ct = 0; ct < (eshk.billct || 0); ct++)
        eshk.bill[ct].price -= Math.trunc((eshk.bill[ct].price + 3) / 4);
}

// C ref: shk.c rouse_shk(shkp, verbosely):1381 — greed-induced recovery.
export async function rouse_shk(shkp, verbosely) {
    if (!helpless(shkp)) return;
    const { canspotmon } = await import('./uhitm.js');
    if (verbosely && canspotmon(shkp))
        await update_topl(`${Shknam(shkp)} ${
            shkp.msleeping ? 'wakes up' : 'can move again'}.`);
    shkp.msleeping = 0;
    shkp.mfrozen = 0;
    shkp.mcanmove = 1;
}

// C ref: shk.c make_happy_shk(shkp, silentkops):1395.  The home_shk()/
// migrate_to_level() arms (a shk that has chased the hero off its own level)
// are NOT ported — relocating a drawn monster from here would move it on the
// map with no newsym; no covered session settles a bill with an absent shk.
// make_happy_shoppers()'s kops_gone()/pacify_guards() have no port either
// (the Keystone Kops are never spawned).
export async function make_happy_shk(shkp, _silentkops) {
    const wasmad = ANGRY(shkp);
    const eshkp = shkp.eshk;

    pacify_shk(shkp, false);
    if (eshkp) { eshkp.following = 0; eshkp.robbed = 0; }
    if ((game.urole?.mnum ?? -1) !== PM_ROGUE)
        adjalign(Math.sign(game.u?.ualign?.type || 0));
    if (inhishop(shkp) && wasmad)
        await update_topl(`${Shknam(shkp)} calms down.`);
}

// C ref: mkobj.c nextoid(oldobj, newobj):536 — pick the split stack's o_id so
// that it keeps the parent's price adjustment, then advance context.ident.
// The `(void) next_ident()` at the end is the rnd(2) that splitobj() spends.
function nextoid(oldobj, newobj) {
    let trylimit = 256;
    let oid = (game.context_ident ?? 2) - 1; /* loop increment reverses the -1 */
    const olddif = oid_price_adjustment(oldobj, oldobj.o_id);
    let newdif;
    do {
        ++oid;
        if (!oid) ++oid;
        newdif = oid_price_adjustment(newobj, oid);
    } while (newdif !== olddif && --trylimit >= 0);
    game.context_ident = oid;
    next_ident(); /* rnd(2) */
    return oid;
}

// C ref: shk.c money2mon(mon, amount):157 — hand `amount` gold to the monster.
// The splitobj() when the hero carries more than the price is the ONLY RNG the
// whole payment path spends (mkobj.c:521 next_ident's rnd(2), recorded at
// seed0002 step 359).
export async function money2mon(mon, amount) {
    const { freeinv } = await import('./invent.js');
    const { findgold } = await import('./steal.js');
    const ygold = findgold(game.invent);
    if (amount <= 0) return 0;
    if (!ygold || (ygold.quan || 0) < amount) return 0; /* C: impossible() */

    let give = ygold;
    if ((ygold.quan || 0) > amount) {
        // mkobj.c splitobj(): the new stack carries the split-off quantity and
        // leaves invent; the original keeps the remainder.
        give = { ...ygold, quan: amount, owornmask: 0, nobj: null,
                 cobj: undefined, oextra: undefined, timed: 0, lamplit: 0,
                 pickup_prev: 0 };
        give.o_id = nextoid(ygold, give);
        ygold.quan -= amount;
        ygold.owt = weight(ygold);
        give.owt = weight(give);
        game._goldCount = Math.max(0, (game._goldCount || 0) - amount);
    } else {
        if (ygold.owornmask) ygold.owornmask = 0; /* remove_worn_item: quiver */
        freeinv(ygold);
    }
    if (!mon.minvent) mon.minvent = [];
    mon.minvent.unshift(give);
    give.where = OBJ_MINVENT;
    give.ocarry = mon;
    return amount;
}

// C ref: shk.c money2u(mon, amount):185 — the shk hands gold back.  Only
// reachable from pay() with a negative balance (a credit refund).
async function money2u(mon, amount) {
    const { addinv } = await import('./invent.js');
    const { findgold } = await import('./steal.js');
    const mongold = findgold(mon.minvent);
    if (amount <= 0 || !mongold || (mongold.quan || 0) < amount) return;
    let give = mongold;
    if ((mongold.quan || 0) > amount) {
        give = { ...mongold, quan: amount, owornmask: 0, nobj: null };
        give.o_id = nextoid(mongold, give);
        mongold.quan -= amount;
    } else {
        mon.minvent.splice(mon.minvent.indexOf(mongold), 1);
    }
    give.where = OBJ_FREE;
    give.ocarry = null;
    addinv(give);
}

// C ref: shk.c check_credit(tmp, shkp):1276.
async function check_credit(tmp, shkp) {
    const credit = shkp.eshk.credit || 0;
    if (credit === 0) return tmp;
    if (credit >= tmp) {
        await update_topl('The price is deducted from your credit.');
        shkp.eshk.credit -= tmp;
        return 0;
    }
    await update_topl('The price is partially covered by your credit.');
    shkp.eshk.credit = 0;
    return tmp - credit;
}

// C ref: shk.c pay(tmp, shkp):1296.
export async function pay(tmp, shkp) {
    const robbed = shkp.eshk.robbed || 0;
    const balance = (tmp <= 0) ? tmp : await check_credit(tmp, shkp);
    if (balance > 0) await money2mon(shkp, balance);
    else if (balance < 0) await money2u(shkp, -balance);
    if (robbed) shkp.eshk.robbed = Math.max(0, robbed - tmp);
}

// C ref: shk.c insufficient_funds(shkp, item, cost):2454.  cost 0 asks "any
// gold at all?", cost > 0 asks "enough for this?"; the two give different
// feedback, which is why dopayobj() calls it twice.
export async function insufficient_funds(shkp, item, cost) {
    const umoney = money_cnt_invent(), ecredit = shkp.eshk.credit || 0;
    if (!cost && umoney + ecredit === 0) {
        const stashed = hidden_gold(true);
        await update_topl(`You ${stashed > 0 ? 'seem to ' : ''}have no gold or credit left.`);
        return true;
    }
    if (cost && umoney + ecredit < cost) {
        const stashed = hidden_gold(true);
        await update_topl(`You don't${stashed > 0 ? ' seem to' : ''} have gold${
            ecredit > 0 ? ' or credit' : ''} enough to pay for ${await paydoname(item)}.`);
        return true;
    }
    return false;
}

// C ref: shk.c reject_purchase(shkp, obj, intact_quan):2418 — the shk refuses
// to sell the intact half of a partly used stack.  C names the used-up half
// with simpleonames(); this port has no simpleonames(), so xname() stands in
// (it differs only for an artifact/named/charged item, which a partly used
// stack can't be).
async function reject_purchase(shkp, obj, intact_quan) {
    const { xname } = await import('./invent.js');
    const save_quan = obj.quan;
    obj.quan = intact_quan - save_quan;
    const which = save_quan > 1 ? 'these' : 'this one';
    const other = xname(obj);
    obj.quan = save_quan;
    if (!Deaf() && !muteshk(shkp)) {
        await verbalize(`${ANGRY(shkp) ? 'Pay' : 'Please pay'} for the other ${
            other} before buying ${which}.`);
    } else {
        await update_topl(`${Shknam(shkp)} ${ANGRY(shkp) ? 'angrily ' : ''}${
            'points out'} your bill for the other ${other} first.`);
    }
}

// C ref: shk.c sortbill_cmp(vptr1, vptr2):1497 — used-up entries first, then
// dearest first, then bill index as a stable tie-break.
function sortbill_cmp(sbi1, sbi2) {
    const used1 = sbi1.usedup <= PartlyUsedUp ? 1 : 0;
    const used2 = sbi2.usedup <= PartlyUsedUp ? 1 : 0;
    if (used1 !== used2) return used2 - used1;
    if (sbi1.cost !== sbi2.cost) return sbi2.cost - sbi1.cost;
    return sbi1.bidx - sbi2.bidx;
}

// C ref: shk.c cheapest_item(ibillct, ibill):1521.
export function cheapest_item(ibillct, ibill) {
    let gmin = ibill[0].cost;
    for (let i = 1; i < ibillct; ++i) if (ibill[i].cost < gmin) gmin = ibill[i].cost;
    return gmin;
}

// C ref: shk.c make_itemized_bill(shkp, &ibill):1545 — the augmented bill that
// hides container contents and splits a partly used stack into two entries.
export function make_itemized_bill(shkp) {
    const eshkp = shkp.eshk;
    const ebillct = eshkp.billct || 0;
    const ibill = [];

    for (let i = 0; i < ebillct; ++i) {
        const bp = eshkp.bill[i];
        let otmp = bp_to_obj(bp);
        if (!otmp) continue; /* C: impossible("Can't find shop bill entry") */
        let bidx = i;

        if ((otmp.quan || 0) === 0 || otmp.where === OBJ_ONBILL) {
            otmp.quan = bp.bquan;
            bp.useup = true;
        } else if ((otmp.quan || 0) < bp.bquan) {
            const upquan = bp.bquan - otmp.quan;
            ibill.push({ obj: otmp, quan: upquan, cost: bp.price * upquan,
                         bidx, usedup: PartlyUsedUp, queuedpay: false });
        }

        let quan, cost, used;
        if (otmp.where === OBJ_ONBILL) {
            quan = bp.bquan;
            cost = bp.price * quan;
            used = FullyUsedUp;
        } else if (otmp.where === OBJ_CONTAINED || Has_contents(otmp)) {
            const item = otmp;
            let cknown = true;
            for (let guard = 0; otmp.where === OBJ_CONTAINED && guard < 32; guard++) {
                const next = otmp.ocontainer || find_container_of(otmp);
                if (!next) break;
                otmp = next;
                if (!otmp.cknown) cknown = false;
            }
            let j = 0;
            for (; j < ibill.length; ++j) if (otmp === ibill[j].obj) break;
            if (j < ibill.length) {
                if (ibill[j].usedup === FullyIntact)
                    ibill[j].usedup = cknown ? KnownContainer : UndisclosedContainer;
                continue;
            }
            quan = 1;
            cost = unpaid_cost(otmp, COST_CONTENTS);
            if (!otmp.unpaid) bidx = -1;
            used = (otmp === item) ? FullyIntact
                   : cknown ? KnownContainer : UndisclosedContainer;
        } else {
            quan = otmp.quan;
            cost = bp.price * quan;
            used = (quan < bp.bquan) ? PartlyIntact : FullyIntact;
        }
        ibill.push({ obj: otmp, quan, cost, bidx, usedup: used, queuedpay: false });
    }

    // C qsorts; sortbill_cmp's bidx tie-break makes the order total, so the
    // JS sort's (unspecified) stability can't change the result.
    if (ibill.length > 1) ibill.sort(sortbill_cmp);
    return ibill;
}

// C ref: shk.c update_bill(indx, ibillct, ibill, eshkp, bp, paiditem):2168 —
// take a just-bought item off the shk's bill.
export function update_bill(indx, ibillct, ibill, eshkp, bp, paiditem) {
    if (indx >= 0 && ibill[indx].usedup === PartlyUsedUp) {
        /* only the used-up portion was paid for; the intact part stays billed */
        bp.bquan = paiditem.quan;
        for (let j = 0; j < ibillct; ++j)
            if (ibill[j].obj === paiditem && ibill[j].usedup === PartlyIntact) {
                ibill[j].usedup = FullyIntact;
                break;
            }
        return;
    }
    paiditem.unpaid = 0;
    if (paiditem.where === OBJ_ONBILL) paiditem.where = OBJ_FREE;
    const slot = eshkp.bill.indexOf(bp);
    const newebillct = (eshkp.billct || 0) - 1;
    eshkp.bill[slot] = eshkp.bill[newebillct];
    for (let j = 0; j < ibillct; ++j)
        if (ibill[j].bidx === newebillct) ibill[j].bidx = slot;
    eshkp.billct = newebillct;
}

// C ref: shk.c dopayobj(shkp, bp, obj, which, itemize, unseen):2220.
// which: 0 => used-up item, 1 => other (unpaid or lost).
export async function dopayobj(shkp, bp, obj, which, itemize, unseen) {
    const consumed = (which === 0);

    if (!obj.unpaid && !bp.useup
        && !(Has_contents(obj) && unpaid_cost(obj, COST_CONTENTS)))
        return PAY_BUY; /* C: impossible("Paid object on bill??") */
    if (itemize && await insufficient_funds(shkp, obj, 0)) return PAY_BROKE;

    const save_quan = obj.quan;
    let quan;
    if (consumed) {
        quan = bp.bquan;
        if (quan > obj.quan) quan -= obj.quan; /* difference is the used part */
    } else {
        quan = obj.quan;
    }
    const ltmp = bp.price * quan;

    obj.quan = quan;                    /* to be used by doname() */
    game.iflags = game.iflags || {};
    game.iflags.suppress_price = (game.iflags.suppress_price || 0) + 1;
    let buy = PAY_BUY;

    if (itemize) {
        // menustyle:traditional only.  C wraps the name in safe_qbuf(), whose
        // BUFSZ fallback ("that"/"those") this port does not reproduce.
        const { y_n } = await import('./display.js');
        const { doname_invent } = await import('./invent.js');
        const nm = doname_invent(obj);
        const qbuf = `${quan === 1 ? nm.charAt(0).toUpperCase() + nm.slice(1) : nm
            } for ${ltmp} ${currency(ltmp)}.  Pay?`;
        if (await y_n(qbuf) === 'n') buy = PAY_SKIP; /* don't want to buy */
    }

    if (quan < bp.bquan && !consumed) { /* partly used goods */
        await reject_purchase(shkp, obj, bp.bquan);
        buy = PAY_SKIP;
    }
    if (buy === PAY_BUY && await insufficient_funds(shkp, obj, ltmp))
        buy = itemize ? PAY_SKIP : PAY_CANT;

    if (buy === PAY_BUY) {
        await pay(ltmp, shkp);
        if (!unseen)
            await shk_names_obj(shkp, obj,
                consumed ? 'paid for %s at a cost of %ld gold piece%s.%s'
                         : 'bought %s for %ld gold piece%s.%s',
                ltmp, '');
    }

    obj.quan = save_quan;               /* restore original count */
    game.iflags.suppress_price--;
    return buy;
}

// C ref: shk.c dopay():1970 tail — the shk's thank-you after a paid bill.
export async function shk_thank_you(shkp) {
    const eshkp = shkp.eshk;
    const shopname = shtypes[(eshkp.shoptype || SHOPBASE) - SHOPBASE]?.name || 'store';
    const bang = !eshkp.surcharge ? '!' : '.';
    if (!Deaf() && !muteshk(shkp)) {
        await verbalize(`Thank you for shopping in ${s_suffix(shkname(shkp))} ${shopname}${bang}`);
    } else {
        await update_topl(`${Shknam(shkp)} nods${!eshkp.surcharge ? ' appreciatively' : ''
            } at you for shopping in ${noit_mhis(shkp)} ${shopname}${bang}`);
    }
}

// C ref: shk.c dopay():1858 — a shk still asleep/paralyzed after rouse_shk().
export async function shk_napping_msg(shkp) {
    await update_topl(`${Shknam(shkp)} ${
        rn2(2) ? 'seems to be napping' : "doesn't respond"}.`);
}

// C ref: shk.c dopay():1868-1893 — settling a robbery debt with a shk who is
// not the resident of the shop the hero is standing in.
export async function pay_robbed_debt(shkp, ltmp, stashed_gold) {
    const umoney = money_cnt_invent();
    if (!ltmp) {
        await update_topl(`You do not owe ${shkname(shkp)} anything.`);
    } else if (!umoney) {
        await update_topl(`You ${stashed_gold ? 'seem to ' : ''}have no gold.`);
        if (stashed_gold) await update_topl('But you have some gold stashed away.');
    } else {
        if (umoney > ltmp) {
            await update_topl(`You give ${shkname(shkp)} the ${ltmp} gold piece${
                plur(ltmp)} ${noit_mhe(shkp)} asked for.`);
            await pay(ltmp, shkp);
        } else {
            await update_topl(`You give ${shkname(shkp)} all your${
                stashed_gold ? ' openly kept' : ''} gold.`);
            await pay(umoney, shkp);
            if (stashed_gold) await update_topl('But you have hidden gold!');
        }
        if ((umoney < ltmp / 2) || (umoney < ltmp && stashed_gold))
            await update_topl(`Unfortunately, ${noit_mhe(shkp)} doesn't look satisfied.`);
        else
            await make_happy_shk(shkp, false);
    }
}

// C ref: shk.c:1489 no_money[] / not_enough_money[].
export const no_money = (stashed) => `Moreover, you${stashed ? ' seem to' : ''} have no gold.`;
export const not_enough_money = (shkp) =>
    `Besides, you don't have enough to interest ${noit_mhim(shkp)}.`;

export { helpless, muteshk, Deaf, verbalize, plur, noit_mhe, noit_mhim, noit_mhis };

// ═══════════════════════════════════════════════════════════════════════════
// THE REST OF shk.c — INERT
//
// Every function below is a faithful translation of a shk.c function that had
// no same-named JS definition.  None of it is reachable: nothing above this
// line changed and no other module imports any of it.
//
// SHARED-HELPER NOTE.  shk.c's setpaid(), addupbill(), hot_pursuit(),
// rob_shop(), call_kops(), makekops() and add_one_tobill() ARE already ported
// — module-PRIVATELY, in js/shkroom.js — and this file may not edit that file
// to export them.  find_oid() is likewise private in js/light.js and
// money_cnt()/doname() in js/invent.js.  The file-local copies below exist
// only so these translations are executable and their control flow reads
// true.  When this code is made live, export the originals and delete these.
// ═══════════════════════════════════════════════════════════════════════════

// C ref: shk.c:139 angrytexts[] and :5508 Izchak_speaks[].  ROLL_FROM(arr) is
// rn2(SIZE(arr)), so these arrays' LENGTHS are load-bearing for the PRNG.
const angrytexts = ['quite upset', 'ticked off', 'furious'];
const Izchak_speaks = [
    "%s says: 'These shopping malls give me a headache.'",
    "%s says: 'Slow down.  Think clearly.'",
    "%s says: 'You need to take things one at a time.'",
    "%s says: 'I don't like poofy coffee... give me Colombian Supremo.'",
    '%s says that getting the devteam’s agreement on anything is difficult.',
    '%s says that he has noticed those who serve their deity will prosper.',
    "%s says: 'Don't try to steal from me - I have friends in high places!'",
    "%s says: 'You may well need something from this shop in the future.'",
    '%s comments about the Valley of the Dead as being a gateway.',
];
const ROLL_FROM = (arr) => arr[rn2(arr.length)];
// C ref: shk.c:62-63.
const and_its_contents = ' and its contents';
const the_contents_of = 'the contents of ';
// objclass.h GOLD_SYM.
const GOLD_SYM = '$';
// obj.h obj->where.  place_object()/add_to_container() write these strings;
// mkobj.js's bury/migrate/billobjs paths write the const.js INTEGERS instead,
// so both spellings have to be accepted for those three.
const OBJ_BURIED_STR = 'buried';
const is_buried = (o) => o.where === OBJ_BURIED_STR || o.where === 6;

// ── C chain / string / misc primitives ──────────────────────────────────────

// C ref: decl.h fmon, monst.h nmon.  This port keeps the monster chain as an
// ARRAY, so `for (m = fmon; m; m = m->nmon)` becomes a scan from an index.
const fmon = () => (game.level?.monsters || []);
function nmon(mon) {
    const list = fmon();
    const i = list.indexOf(mon);
    return (i >= 0 && i + 1 < list.length) ? list[i + 1] : null;
}

// C ref: shk.c:56 IS_SHOP(x) — x is a rooms[] INDEX (roomno - ROOMOFFSET).
const IS_SHOP = (i) => ((game.level?.rooms?.[i]?.rtype ?? 0) >= SHOPBASE);

// C ref: dungeon.c on_level(&ESHK(shkp)->shoplevel, &u.uz).  eshk.shoplevel is
// never populated by this port's shkinit, so a missing one reads as "same
// level" — the convention inhishop() above already uses.
function on_shoplevel(eshkp) {
    const lv = eshkp?.shoplevel, uz = game.u?.uz;
    if (!lv || !uz) return true;
    return lv.dnum === uz.dnum && lv.dlevel === uz.dlevel;
}

// C ref: mkroom.c search_special(type) — ANY_SHOP means "rtype >= SHOPBASE",
// NOT "rtype == ANY_SHOP" (js/trap.js's private copy tests plain equality).
function search_special(type) {
    for (const list of [game.level?.rooms, game.level?.subrooms])
        for (const croom of (list || [])) {
            if (!croom || (croom.hx ?? -1) < 0) break;
            if ((type === ANY_TYPE && croom.rtype !== OROOM)
                || (type === ANY_SHOP && croom.rtype >= SHOPBASE)
                || croom.rtype === type) return croom;
        }
    return null;
}

const strncmp = (a, b, n) => ((a || '').slice(0, n) === (b || '').slice(0, n) ? 0 : 1);
const strncmpi = (a, b, n) => (strncmp((a || '').toLowerCase(), (b || '').toLowerCase(), n));
const the = (s) => (/^[A-Z]/.test(s) ? s : `the ${s}`);
const upstart = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const sgn = (x) => Math.sign(x || 0);
const distu = (x, y) => {
    const u = game.u;
    return (x - (u?.ux ?? 0)) ** 2 + (y - (u?.uy ?? 0)) ** 2;
};
const mdistu = (mon) => distu(mon.mx, mon.my);
// C ref: hack.h um_dist(x, y, n).
const um_dist = (x, y, n) =>
    (Math.abs(x - (game.u?.ux ?? 0)) > n || Math.abs(y - (game.u?.uy ?? 0)) > n);
const u_at = (x, y) => (x === game.u?.ux && y === game.u?.uy);
// C ref: mon.c m_next2u(mtmp) — distmin(mx, my, ux, uy) <= 1.
const m_next2u = (mon) =>
    Math.max(Math.abs(mon.mx - (game.u?.ux ?? 0)),
             Math.abs(mon.my - (game.u?.uy ?? 0))) <= 1;
// C ref: mondata.h nolimbs/has_head/haseyes/is_silent/humanoid/is_neuter.
// monflag.h: M1_NOEYES 0x1000 M1_NOLIMBS 0x6000 M1_NOHEAD 0x8000.
const M1_NOEYES_ = 0x1000, M1_NOLIMBS_ = 0x6000, M1_NOHEAD_ = 0x8000;
const MS_SILENT_ = 0;
const mf1 = (ptr) => (ptr?.pmidx != null ? (MFLAGS1[ptr.pmidx] || 0) : 0);
const mf2 = (ptr) => (ptr?.pmidx != null ? (MFLAGS2[ptr.pmidx] || 0) : 0);
const haseyes = (ptr) => (mf1(ptr) & M1_NOEYES_) === 0;
const has_head = (ptr) => (mf1(ptr) & M1_NOHEAD_) === 0;
const nolimbs = (ptr) => (mf1(ptr) & M1_NOLIMBS_) === M1_NOLIMBS_;
const is_silent = (ptr) => (msound_of(ptr) ?? MS_SILENT_) === MS_SILENT_;
const is_demon = (ptr) => (mf2(ptr) & M2_DEMON) !== 0;
const humanoid = (ptr) => (mf1(ptr) & M1_HUMANOID) !== 0;
const is_neuter = (ptr) => (mf2(ptr) & M2_NEUTER) !== 0;
// C ref: polyself.c poly_gender() — 0/1 as flags.female, 2 = none.
function poly_gender() {
    const ptr = game.u?.Upolyd ? game.u.data : null;
    if (ptr && (is_neuter(ptr) || !humanoid(ptr))) return 2;
    return game.flags?.female ? 1 : 0;
}

// C ref: shk.c addupbill(shkp):496.  (Real port: js/shkroom.js, private.)
function addupbill(shkp) {
    const eshk = shkp.eshk;
    let total = 0;
    for (let ct = 0; ct < (eshk.billct || 0); ct++)
        total += (eshk.bill[ct].price || 0) * (eshk.bill[ct].bquan || 0);
    return total;
}

// C ref: hack.c money_cnt(otmp) over an arbitrary chain.  money_cnt_invent()
// above is the same walk hard-wired to game.invent.
function money_cnt(list) {
    for (const o of (list || []))
        if (o?.oclass === COIN_CLASS) return o.quan || 0;
    return 0;
}

// C ref: shk.c find_oid(id):2777 — every obj list except gb.billobjs.
// (Real port: js/light.js, private.)
function find_oid(id) {
    let obj = oid_scan(game.invent, id, 0);
    if (obj) return obj;
    obj = oid_scan(game.level?.objects, id, 0);
    if (obj) return obj;
    obj = oid_scan(game.level?.buriedobjlist, id, 0);
    if (obj) return obj;
    obj = oid_scan(game.migrating_objs, id, 0);
    if (obj) return obj;
    for (const list of [fmon(), game.migrating_mons, game.mydogs])
        for (const mon of (list || [])) {
            obj = oid_scan(mon?.minvent, id, 0);
            if (obj) return obj;
        }
    return null;
}

// C ref: shk.c setpaid(shkp):400.  gb.billobjs is an ARRAY in this port, so
// C's "extract and dealloc each" is a truncation.
// (Real port: js/shkroom.js, private.)
function setpaid(shkp) {
    clear_unpaid(shkp, game.invent);
    clear_unpaid(shkp, game.level?.objects);
    if (game.level?.buriedobjlist) clear_unpaid(shkp, game.level.buriedobjlist);
    if (game.thrownobj) clear_unpaid_obj(shkp, game.thrownobj);
    if (game.kickedobj) clear_unpaid_obj(shkp, game.kickedobj);
    for (const mtmp of fmon()) if (mtmp.minvent) clear_unpaid(shkp, mtmp.minvent);
    for (const mtmp of (game.migrating_mons || []))
        if (mtmp.minvent) clear_unpaid(shkp, mtmp.minvent);

    clear_no_charge(shkp, game.level?.objects);
    clear_no_charge(shkp, game.level?.buriedobjlist);

    while (Array.isArray(game.billobjs) && game.billobjs.length) {
        const obj = game.billobjs.pop();
        obj_extract_self(obj);
        dealloc_obj(obj);
    }
    if (shkp) {
        shkp.eshk.billct = 0;
        shkp.eshk.credit = 0;
        shkp.eshk.debit = 0;
        shkp.eshk.loan = 0;
    }
}

// C ref: shk.c hot_pursuit(shkp):1449.  (Real port: js/shkroom.js, private.)
function hot_pursuit(shkp) {
    if (!shkp.isshk) return;
    rile_shk(shkp);
    shkp.eshk.customer = game.plname;
    shkp.eshk.following = 1;
    /* shopkeeper networking: every floor item on the level loses no_charge */
    clear_no_charge(null, game.level?.objects);
    clear_no_charge_pets(shkp);
}

// C ref: display.h canseemon(mon).  js/uhitm.js's canseemon_shared() is
// module-private; this matches js/dogmove.js's local port (the infravision
// half is omitted — a shopkeeper is always on a lit shop square).
async function canseemon(mtmp) {
    if (!mtmp) return false;
    if (game.u?.uswallow) return true;
    if (mtmp.minvis && !game.u?.see_invis) return false;
    if (mtmp.mundetected) return false;
    const { cansee } = await import('./vision.js');
    return !!cansee(mtmp.mx, mtmp.my);
}

// C ref: polyself.c mbodypart(mon, part).  js/polyself.js is not statically
// imported here (cycle risk), so this is the awaited wrapper.
async function mbodypart_(mon, part) {
    const { mbodypart } = await import('./polyself.js');
    return mbodypart(mon, part);
}

// C ref: shknam.c is_izchak(shkp, override_hallucination):908.
async function is_izchak(shkp, override_hallucination) {
    if ((game.u?.uprops?.Hallucination || 0) > 0 && !override_hallucination)
        return false;
    if (!shkp.isshk) return false;
    const { in_town } = await import('./dig.js');
    if (!in_town(shkp.mx, shkp.my)) return false;
    let shknm = shkp.eshk?.shknam || '';
    if (!/^[A-Za-z]/.test(shknm)) shknm = shknm.slice(1); /* skip "+" prefix */
    return shknm === 'Izchak';
}

// C ref: shk.c rob_shop(shkp):687 — settle-or-steal when the hero leaves with
// unpaid goods; TRUE means an actual robbery, which is what calls the Kops.
// livelog_printf() has no effect on the screen.  No RNG.
// (Real port: js/shkroom.js, private.)
async function rob_shop(shkp) {
    const eshkp = shkp.eshk;
    await rouse_shk(shkp, true);
    let total = addupbill(shkp) + (eshkp.debit || 0);
    if ((eshkp.credit || 0) >= total) {
        await update_topl(`Your credit of ${eshkp.credit} ${
            currency(eshkp.credit)} is used to cover your shopping bill.`);
        total = 0; /* credit gets cleared by setpaid() */
    } else {
        await update_topl('You escaped the shop without paying!');
        total -= (eshkp.credit || 0);
    }
    setpaid(shkp);
    if (!total) return false;

    eshkp.robbed = (eshkp.robbed || 0) + total;
    await update_topl(`You stole ${total} ${currency(total)} worth of merchandise.`);
    if ((game.urole?.mnum ?? -1) !== PM_ROGUE) /* stealing is unlawful */
        adjalign(-sgn(game.u?.ualign?.type || 0));
    hot_pursuit(shkp);
    return true;
}

// C ref: shk.c call_kops(shkp, nearshop):510.  GAP: the Keystone Kop spawn is
// makekops(), which is module-private in js/shkroom.js; duplicating it here
// would duplicate its rnd(5)/enexto()/makemon() draws, so this stops at the
// alarm.  mvitals[] (the G_GONE test that decides whether any Kop can appear
// at all) is not modelled by this port either.
async function call_kops(shkp, _nearshop) {
    if (!shkp) return;
    if (!Deaf()) await update_topl('An alarm sounds!');
    /* GAP: nokops / angry_guards() / makekops() — see js/shkroom.js. */
}

// ── shk.c:214 .. :1200 ──────────────────────────────────────────────────────

// C ref: shk.c next_shkp(shkp, withbill):215.  Side effect: merely enumerating
// an angry shk whose surcharge has not been applied riles her, which rewrites
// every price on her bill.  shk_scan() above is the same walk done eagerly.
// C passes the chain head (fmon) or a successor (shkp->nmon); here that is
// fmon()[0] / nmon(shkp).  A monster not on the chain reads as end-of-chain.
export function next_shkp(shkp, withbill) {
    const list = fmon();
    let found = null;
    for (let i = shkp ? list.indexOf(shkp) : -1; i >= 0 && i < list.length; i++) {
        const m = list[i];
        if (DEADMONSTER(m)) continue;
        if (m.isshk && ((m.eshk?.billct || 0) || !withbill)) { found = m; break; }
    }
    if (found && ANGRY(found) && !found.eshk.surcharge) rile_shk(found);
    return found;
}

// C ref: shk.c shkgone(mtmp):235 — the shk died; her shop reverts to ordinary
// rooms and ordinary objects.  Called from mon.c.
export function shkgone(mtmp) {
    const eshk = mtmp.eshk;
    const sroom = game.level?.rooms?.[eshk.shoproom - ROOMOFFSET];
    if (!on_shoplevel(eshk)) return;

    discard_damage_owned_by(mtmp);
    if (sroom) sroom.resident = null;
    if (!search_special(ANY_SHOP) && game.level?.flags)
        game.level.flags.has_shop = 0;

    /* items on shop floor revert to ordinary objects */
    if (sroom)
        for (let sx = sroom.lx; sx <= sroom.hx; sx++)
            for (let sy = sroom.ly; sy <= sroom.hy; sy++)
                for (const otmp of objects_at(sx, sy)) otmp.no_charge = 0;

    /* set the bill only when the dead shk is the resident shk */
    const p = (game.u?.ushops || []).indexOf(eshk.shoproom);
    if (p >= 0) {
        setpaid(mtmp);
        eshk.bill_p = null;
        game.u.ushops.splice(p, 1); /* remove shoproom from u.ushops */
    }
}

// C ref: shk.c set_residency(shkp, zero_out):272.
export function set_residency(shkp, zero_out) {
    if (!on_shoplevel(shkp.eshk)) return;
    const room = game.level?.rooms?.[shkp.eshk.shoproom - ROOMOFFSET];
    if (room) room.resident = zero_out ? null : shkp;
}

// C ref: shk.c replshk(mtmp, mtmp2):280 — mtmp2 replaces mtmp (relocation to a
// new monst struct).  eshk.bill_p is not modelled separately by this port
// (onbill() reads eshk.bill directly), so the assignment is nominal.
export function replshk(mtmp, mtmp2) {
    const room = game.level?.rooms?.[mtmp2.eshk.shoproom - ROOMOFFSET];
    if (room) room.resident = mtmp2;
    if (inhishop(mtmp) && (game.u?.ushops || [])[0] === mtmp.eshk.shoproom)
        mtmp2.eshk.bill_p = mtmp2.eshk.bill;
}

// C ref: shk.c restshk(shkp, ghostly):290 — bones/save fixups.  The -1000
// sentinel bill_p (u_entered_shop's "dump core when referenced") survives.
export function restshk(shkp, ghostly) {
    if (!game.u?.uz?.dlevel) return;
    const eshkp = shkp.eshk;
    if (eshkp.bill_p !== -1000) eshkp.bill_p = eshkp.bill;
    /* shoplevel can change as dungeons move around */
    if (ghostly) {
        eshkp.shoplevel = { dnum: game.u.uz.dnum, dlevel: game.u.uz.dlevel };
        if (ANGRY(shkp) && strncmpi(eshkp.customer, game.plname, PL_NSIZ))
            pacify_shk(shkp, true);
    }
}

// C ref: shk.c clear_unpaid_obj(shkp, otmp):309.
export function clear_unpaid_obj(shkp, otmp) {
    if (Has_contents(otmp)) clear_unpaid(shkp, otmp.cobj);
    if (onbill(otmp, shkp)) otmp.unpaid = 0;
}

// C ref: shk.c clear_unpaid(shkp, list):319 — C walks an obj->nobj chain; this
// port's equivalent of every such list is a JS array.
export function clear_unpaid(shkp, list) {
    for (const otmp of (list || [])) if (otmp) clear_unpaid_obj(shkp, otmp);
}

// C ref: shk.c clear_no_charge_obj(shkp, otmp):329.  shkp == null clears every
// item on the list regardless of shop (hot_pursuit's shopkeeper networking).
// GAP: obj_location() cannot resolve an OBJ_BURIED item, so a buried no_charge
// item takes the !get_obj_location arm and is cleared unconditionally.
export function clear_no_charge_obj(shkp, otmp) {
    if (Has_contents(otmp)) clear_no_charge(shkp, otmp.cobj);
    if (!otmp.no_charge) return;

    const loc = obj_location(otmp);
    const rno = game.level?.at(loc.x, loc.y)?.roomno ?? NO_ROOM;
    let rm_shkp = null;
    if (!shkp
        || (otmp.where !== OBJ_FLOOR && otmp.where !== OBJ_CONTAINED
            && !is_buried(otmp))
        || !loc.ok
        || !isok(loc.x, loc.y)
        || rno < ROOMOFFSET
        || !IS_SHOP(rno - ROOMOFFSET)
        || !(rm_shkp = game.level?.rooms?.[rno - ROOMOFFSET]?.resident)
        || rm_shkp === shkp)
        otmp.no_charge = 0;
}

// C ref: shk.c clear_no_charge(shkp, list):377.
export function clear_no_charge(shkp, list) {
    for (const otmp of (list || [])) if (otmp) clear_no_charge_obj(shkp, otmp);
}

// C ref: shk.c clear_no_charge_pets(shkp):389.
export function clear_no_charge_pets(shkp) {
    for (const mtmp of fmon())
        if (mtmp.mtame && mtmp.minvent?.length) clear_no_charge(shkp, mtmp.minvent);
}

// C ref: shk.c credit_report(shkp, idx, silent):628 — the before/after snapshot
// that reports "Your debt has increased by N zorkmids." after a shop action.
// The snapshot is a C `static`, hence a module-level array here.
const BEFORE = 0, NOW = 1;
const credit_snap = [[0, 0, 0], [0, 0, 0]];
export async function credit_report(shkp, idx, silent) {
    const eshkp = shkp.eshk;

    if (!idx) {
        credit_snap[BEFORE][0] = credit_snap[NOW][0] = 0;
        credit_snap[BEFORE][1] = credit_snap[NOW][1] = 0;
        credit_snap[BEFORE][2] = credit_snap[NOW][2] = 0;
    } else {
        idx = 1;
    }

    credit_snap[idx][0] = eshkp.credit || 0;
    credit_snap[idx][1] = eshkp.debit || 0;
    credit_snap[idx][2] = eshkp.loan || 0;

    if (idx && !silent) {
        let amt = 0;
        let msg = 'debt has increased';

        if (credit_snap[NOW][0] < credit_snap[BEFORE][0]) {
            amt = credit_snap[BEFORE][0] - credit_snap[NOW][0];
            msg = 'credit has been reduced';
        } else if (credit_snap[NOW][1] > credit_snap[BEFORE][1]) {
            amt = credit_snap[NOW][1] - credit_snap[BEFORE][1];
        } else if (credit_snap[NOW][2] > credit_snap[BEFORE][2]) {
            amt = credit_snap[NOW][2] - credit_snap[BEFORE][2];
        }
        if (amt) await update_topl(`Your ${msg} by ${amt} ${currency(amt)}.`);
    }
}

// C ref: shk.c remote_burglary(x, y):665 — robbery from outside the shop via
// telekinesis or a grappling hook.
export async function remote_burglary(x, y) {
    const shkp = shop_keeper(in_rooms(x, y, SHOPBASE)[0]);
    if (!shkp || !inhishop(shkp)) return; /* shk died, teleported, ... */

    const eshkp = shkp.eshk;
    if (!eshkp.billct && !eshkp.debit) return; /* bill is settled */

    if (await rob_shop(shkp)) await call_kops(shkp, false);
}

// C ref: shk.c deserted_shop(enterstring):723 — "This shop is deserted." vs
// "...seems to be untended.": n counts monsters in the room, m counts the ones
// the hero can account for.  No RNG.  C's enterstring is a char* whose FIRST
// CHARACTER is the roomno; this port passes the roomno itself (u.ushops is an
// array of numbers here, not a string).
export async function deserted_shop(enterstring) {
    const r = game.level?.rooms?.[enterstring - ROOMOFFSET];
    const { sensemon } = await import('./mon.js');
    let m = 0, n = 0;

    for (let x = r?.lx ?? 0; x <= (r?.hx ?? -1); ++x)
        for (let y = r?.ly ?? 0; y <= (r?.hy ?? -1); ++y) {
            if (u_at(x, y)) continue;
            const mtmp = m_at(x, y);
            if (mtmp) {
                ++n;
                const ap = mtmp.m_ap_type ?? M_AP_NOTHING;
                if (sensemon(mtmp)
                    || ((ap === M_AP_NOTHING || ap === M_AP_MONSTER)
                        && await canseemon(mtmp)))
                    ++m;
            }
        }

    if ((game.u?.uprops?.Blind || 0) > 0
        && !((game.u?.uprops?.Blind_telepat || 0) > 0
             || (game.u?.uprops?.Detect_monsters || 0) > 0))
        ++n; /* force feedback to be less specific */

    await update_topl(`This shop ${(m < n) ? 'seems to be' : 'is'} ${
        !n ? 'deserted' : 'untended'}.`);
}

// C ref: shk.c pick_pick(obj):921 — taking a pick-axe out of a container while
// inside a shop.  pickmovetime is a C `static`, hence module-level here.
let pickmovetime = 0;
export async function pick_pick(obj) {
    if (obj.unpaid || !is_pick(obj)) return;
    const shkp = shop_keeper((game.u?.ushops || [])[0]);
    if (shkp && inhishop(shkp)) {
        /* don't repeat this N times for a sack of N picks */
        if (game.moves !== pickmovetime) {
            if (!Deaf() && !muteshk(shkp)) {
                await verbalize(`You sneaky ${cad(false)}!  Get out of here with that pick!`);
            } else {
                await update_topl(`${Shknam(shkp)} ${
                    haseyes(shkp.data) ? 'glares at' : 'is dismayed because of'
                } your pick!`);
            }
        }
        pickmovetime = game.moves;
    }
}

// C ref: shk.c shop_debt(eshkp):990 — debit plus everything still on the bill.
// Deliberately ignores eshkp->robbed (see the C comment at :983).
export function shop_debt(eshkp) {
    let debt = eshkp.debit || 0;
    for (let ct = 0; ct < (eshkp.billct || 0); ct++)
        debt += (eshkp.bill[ct].price || 0) * (eshkp.bill[ct].bquan || 0);
    return debt;
}

// C ref: shk.c noisy_shop(sroom):1126.
export async function noisy_shop(sroom) {
    const mtmp = sroom?.resident;
    if (mtmp && inhishop(mtmp)) {
        const { wake_nearto } = await import('./cmd.js');
        await wake_nearto(mtmp.mx, mtmp.my, 11 * 11);
    }
}

// C ref: shk.c onshopbill(obj, shkp, silent):1160 — onbill() without exposing
// the bill entry.  onbill() above takes no `silent` (it never impossible()s).
export function onshopbill(obj, shkp, _silent) {
    return onbill(obj, shkp) ? true : false;
}

// C ref: shk.c delete_contents(obj):1175.
export function delete_contents(obj) {
    while (obj.cobj && obj.cobj.length) {
        const curr = obj.cobj[0];
        obj_extract_self(curr);
        obfree(curr, null);
        /* obj_extract_self() may not detach from a JS array; guard the loop */
        if (obj.cobj.length && obj.cobj[0] === curr) obj.cobj.shift();
    }
}

// ── shk.c:1316 .. :2760 ─────────────────────────────────────────────────────

// C ref: shk.c home_shk(shkp, killkops):1317 — return the shk to the spot just
// inside her door.  GAP: mnearto() (the enexto ring search that actually moves
// her, and its RNG) and pacify_guards() have no port in this tree, so this
// only re-flags the level and re-checks occupancy.
export async function home_shk(shkp, killkops) {
    /* GAP: mnearto(shkp, ESHK(shkp)->shk.x, ESHK(shkp)->shk.y, TRUE,
       RLOC_NOMSG) — the shk does not actually move here. */
    if (game.level?.flags) game.level.flags.has_shop = 1;
    if (killkops) {
        await kops_gone(true);
        /* GAP: pacify_guards() */
    }
    await after_shk_move(shkp);
}

// C ref: shk.c angry_shk_exists():1331.
export function angry_shk_exists() {
    for (let shkp = next_shkp(fmon()[0], false); shkp;
         shkp = next_shkp(nmon(shkp), false))
        if (ANGRY(shkp)) return true;
    return false;
}

// C ref: shk.c make_happy_shoppers(silentkops):1440 — also called from
// losedogs() for a migrating shk.  GAP: pacify_guards() has no port.
export async function make_happy_shoppers(silentkops) {
    if (!angry_shk_exists()) {
        await kops_gone(silentkops);
        /* GAP: pacify_guards() */
    }
}

// C ref: shk.c make_angry_shk(shkp, ox, oy):1470 — the shk was teleported or
// fell out of her shop, or the hero broke something from outside it.  Every
// pending transaction becomes "past due" (robbed), then hot pursuit.
export async function make_angry_shk(shkp, _ox, _oy) {
    const eshkp = shkp.eshk;

    if (eshkp.billct || eshkp.debit || eshkp.loan || eshkp.credit) {
        eshkp.robbed = (eshkp.robbed || 0)
            + (addupbill(shkp) + (eshkp.debit || 0) + (eshkp.loan || 0));
        eshkp.robbed -= (eshkp.credit || 0);
        if (eshkp.robbed < 0) eshkp.robbed = 0;
        /* billct, debit, loan and credit are cleared by setpaid() */
        setpaid(shkp);
    }

    await update_topl(`${Shknam(shkp)} ${!ANGRY(shkp) ? 'gets angry' : 'is furious'}!`);
    hot_pursuit(shkp);
}

// C ref: decl.h gr.repo — where a dying hero's inventory gets dumped.  This
// port has no `gr` struct; the object below is local to set_repo_loc() and
// finish_paybill(), which are the only two readers/writers in C as well.
const repo = { location: { x: 0, y: 0 }, shopkeeper: null };

// C ref: shk.c inherits(shkp, numsk, croaked, silently):2577 — does this shk
// take the dead hero's possessions?  RNG: ONE rn2(2) (the head-shake), and
// only on the numsk > 1 path with the shk in view.
// js/shkroom.js's exported paybill() carries a reduced inline version of this
// (single-shk, no rn2(2) arm); this is the full translation.
export async function inherits(shkp, numsk, croaked, silently) {
    let loss = 0;
    const eshkp = shkp.eshk;
    let take = false, taken = false;
    const uinshop = (game.u?.ushops || []).includes(eshkp.shoproom);
    let takes = '';
    const invent = game.invent || [];

    /* prevents the next player from being ambushed by an invisible shk */
    shkp.minvis = 0;
    shkp.perminvis = 0;

    /* first-come already took everything you had */
    if (numsk > 1) {
        const { cansee } = await import('./vision.js');
        if (cansee(shkp.mx, shkp.my) && croaked && !silently) {
            takes = '';
            if (has_head(shkp.data) && !rn2(2))
                takes = `, shakes ${noit_mhis(shkp)} ${await mbodypart_(shkp, HEAD)},`;
            await update_topl(`${Shknam(shkp)} ${
                helpless(shkp) ? 'wakes up, ' : ''}looks at your corpse${
                takes} and ${!inhishop(shkp) ? 'disappears' : 'sighs'}.`);
        }
        taken = uinshop;
        /* C: goto skip */
        await rouse_shk(shkp, false);
        if (!inhishop(shkp)) await home_shk(shkp, false);
        setpaid(shkp);
        if (taken) set_repo_loc(shkp);
        return taken;
    }

    /* you die in the shop, the shk is peaceful, nothing stolen, nothing owed */
    if (uinshop && inhishop(shkp) && !eshkp.billct && !eshkp.robbed
        && !eshkp.debit && NOTANGRY(shkp) && !eshkp.following
        && (game.u?.ugrave_arise ?? -1) < 0 /* LOW_PM */) {
        taken = invent.length > 0;
        if (taken && !silently)
            await update_topl(`${Shknam(shkp)} gratefully inherits all your possessions.`);
        /* C: goto clear */
        setpaid(shkp);
        if (taken) set_repo_loc(shkp);
        return taken;
    }

    if (eshkp.billct || eshkp.debit || eshkp.robbed) {
        if (uinshop && inhishop(shkp)) loss = addupbill(shkp) + (eshkp.debit || 0);
        if (loss < (eshkp.robbed || 0)) loss = eshkp.robbed || 0;
        take = true;
    }

    if (eshkp.following || ANGRY(shkp) || take) {
        if (!invent.length) {
            /* C: goto skip */
            await rouse_shk(shkp, false);
            if (!inhishop(shkp)) await home_shk(shkp, false);
            setpaid(shkp);
            return false;
        }
        const umoney = money_cnt(invent);
        takes = '';
        if (helpless(shkp)) takes += 'wakes up and ';
        if (!m_next2u(shkp)) takes += 'comes and ';
        takes += 'takes';

        if (loss > umoney || !loss || uinshop) {
            eshkp.robbed = (eshkp.robbed || 0) - umoney;
            if (eshkp.robbed < 0) eshkp.robbed = 0;
            if (umoney > 0) await money2mon(shkp, umoney);
            if (!silently)
                await update_topl(`${Shknam(shkp)} ${takes} all your possessions.`);
            taken = true;
        } else {
            await money2mon(shkp, loss);
            if (!silently)
                await update_topl(`${Shknam(shkp)} ${takes} the ${loss} ${
                    currency(loss)} ${
                    strncmp(eshkp.customer, game.plname, PL_NSIZ) ? '' : 'you '
                }owed ${noit_mhim(shkp)}.`);
            /* shopkeeper has now been paid in full */
            pacify_shk(shkp, false);
            eshkp.following = 0;
            eshkp.robbed = 0;
        }
        /* skip: */
        await rouse_shk(shkp, false); /* in case we create bones */
        if (!inhishop(shkp)) await home_shk(shkp, false);
    }
    /* clear: */
    setpaid(shkp); /* clear this shk's bill */
    if (taken) set_repo_loc(shkp);
    return taken;
}

// C ref: shk.c set_repo_loc(shkp):2682 — where the dead hero's gear lands.
export function set_repo_loc(shkp) {
    const eshkp = shkp.eshk;

    /* with multiple shopkeepers we may be called more than once */
    if (repo.shopkeeper) return;

    const u = game.u;
    let ox = u?.ux ? u.ux : u?.ux0;
    let oy = u?.ux ? u.uy : u?.uy0; /* testing u.ux when setting oy IS correct */

    /* not in this shk's room, or in its doorway/entry spot/wall: dump the gear
       all the way inside */
    if (!(u?.ushops || []).includes(eshkp.shoproom)
        || costly_adjacent(shkp, ox, oy)) {
        /* shk.x,shk.y is immediately in front of the door; move in one more */
        ox = eshkp.shk.x;
        oy = eshkp.shk.y;
        ox += sgn(ox - eshkp.shd.x);
        oy += sgn(oy - eshkp.shd.y);
    }
    repo.location.x = ox;
    repo.location.y = oy;
    repo.shopkeeper = shkp;
}

// C ref: shk.c finish_paybill():2723 — after disclosure, before bones.  Issues
// no messages.  GAP: unleash_all() has no port in this tree.
export async function finish_paybill() {
    const shkp = repo.shopkeeper;
    let ox = repo.location.x, oy = repo.location.y;

    if (!isok(ox, oy)) {
        const u = game.u;
        ox = u?.ux ? u.ux : u?.ux0;
        oy = u?.ux ? u.uy : u?.uy0;
    }
    /* GAP: unleash_all() — normally done by savebones(), too late in this case */
    if (shkp) {
        const umoney = money_cnt(game.invent);
        if (umoney) await money2mon(shkp, umoney);
    }
    const { drop_upon_death } = await import('./bones.js');
    await drop_upon_death(null, null, ox, oy);
}

// ── shk.c:3063 .. :4270 ─────────────────────────────────────────────────────

// objclass.h classes shk.c names below and shk.js's header block does not.
const RING_CLASS = 4, AMULET_CLASS = 5, CHAIN_CLASS = 16;
// objects.h otyps and sounds.h/role indices shk.c names below.  PICK_AXE and
// DWARVISH_MATTOCK match js/invent.js:8464 (js/dogmove.js's PICK_AXE = 66 is a
// different, unrelated numbering).
const PICK_AXE = 259, DWARVISH_MATTOCK = 71, LAND_MINE = 243, BEARTRAP = 244;
const LARGE_BOX = 216;
const MS_HUMANOID = 25;
const PM_KNIGHT = 4;                /* roles[].mnum, as PM_TOURIST/PM_ROGUE */
// C ref: mkobj.c SchroedingersBox(obj) — a LARGE_BOX with spe == 1.
const SchroedingersBox = (obj) => !!obj && obj.otyp === LARGE_BOX && obj.spe === 1;
// C ref: mondata.h passes_walls(ptr).
const passes_walls = (ptr) => passes_walls_flag(ptr);
// wintype.h NHW_MENU.  js/invent.js and js/end.js each keep a PRIVATE
// create_nhwindow/putstr/display_nhwindow/destroy_nhwindow shim; neither is
// exported, so these are the same shim again.  GAP: nothing renders.
const NHW_MENU = 3;
function create_nhwindow(_type) { return { lines: [] }; }
function putstr(win, _attr, str) { if (win) win.lines.push(str); }
function display_nhwindow(_win, _blocking) {}
function destroy_nhwindow(_win) {}
// C ref: getlin.c ynaq()/nyaq() — 'a' means "all", 'q' means "quit"; nyaq's
// default is 'n', ynaq's is 'y'.  js/pickup.js's ynaq() is module-private.
async function ynaq_(query) {
    const { y_n } = await import('./display.js');
    return await y_n(query, 'ynaq\x1b', 'y');
}
async function nyaq_(query) {
    const { y_n } = await import('./display.js');
    return await y_n(query, 'ynaq\x1b', 'n');
}

// C ref: shk.c dropped_container(obj, shkp, sale):3064 — mark a just-dropped
// container's contents "no charge" (the top container is the caller's job).
export function dropped_container(obj, shkp, sale) {
    for (const otmp of (obj.cobj || [])) {
        if (otmp.oclass === COIN_CLASS) continue;

        if (!otmp.unpaid && !(sale && saleable(shkp, otmp))) otmp.no_charge = 1;

        if (Has_contents(otmp)) dropped_container(otmp, shkp, sale);
    }
}

// C ref: shk.c special_stock(obj, shkp, quietly):3103 — Izchak won't buy the
// Candelabrum.  No RNG.
export async function special_stock(obj, shkp, quietly) {
    if (shkp.eshk.shoptype === CANDLESHOP
        && obj.otyp === CANDELABRUM_OF_INVOCATION) {
        if (!quietly) {
            if (await is_izchak(shkp, true) && !game.u?.uevent?.invoked) {
                if (Deaf() || muteshk(shkp)) {
                    await update_topl(`${Shknam(shkp)} seems ${
                        (obj.spe < 7) ? 'horrified' : 'concerned'
                    } that you want to sell that.`);
                } else {
                    await verbalize("No thanks, I'd hang onto that if I were you.");
                    if (obj.spe < 7)
                        await verbalize(`You'll need ${7 - obj.spe}${
                            (obj.spe > 0) ? ' more' : ''} candle${
                            plur(7 - obj.spe)} to go along with it.`);
                }
            } else {
                if (!Deaf() && !muteshk(shkp)) {
                    await verbalize("I won't stock that.  Take it out of here!");
                } else {
                    await update_topl(`${Shknam(shkp)} shakes ${noit_mhis(shkp)} ${
                        await mbodypart_(shkp, HEAD)} in refusal.`);
                }
            }
        }
        return true;
    }
    return false;
}

// C ref: shk.c gem_learned(oindx):3198 — IDing (or forgetting) a gem reprices
// every unpaid stack of that type on every bill on the level.  oindx ==
// STRANGE_OBJECT means "all gems".  No RNG.
export function gem_learned(oindx) {
    for (let shkp = next_shkp(fmon()[0], true); shkp;
         shkp = next_shkp(nmon(shkp), true)) {
        const eshk = shkp.eshk;
        for (let ct = (eshk.billct || 0) - 1, i = 0; ct >= 0; --ct, ++i) {
            const bp = eshk.bill[i];
            const obj = find_oid(bp.bo_id);
            if (!obj) continue; /* shouldn't happen */
            if ((oindx !== STRANGE_OBJECT) ? (obj.otyp === oindx)
                                           : (obj.oclass === GEM_CLASS))
                bp.price = get_cost(obj, shkp);
        }
    }
}

// C ref: shk.c alter_cost(obj, amt):3237 — an item got more valuable; raise its
// bill entry.  amt 0 = reprice, amt < 0 = force abs(amt) even if lower.
// NOTE the C loop advances `shkp` itself, not shkp->nmon, so it re-tests the
// same shk forever unless it breaks; next_shkp() finding the same monster again
// is what makes that terminate.  Reproduced as-is.
export function alter_cost(obj, amt) {
    for (let shkp = next_shkp(fmon()[0], true); shkp; shkp = next_shkp(shkp, true)) {
        const bp = onbill(obj, shkp);
        if (bp) {
            const new_price = !amt ? get_cost(obj, shkp) : (amt < 0) ? -amt : amt;
            if (new_price > bp.price || amt < 0) {
                bp.price = new_price;
                update_inventory();
            }
            break; /* done */
        }
        break; /* C's loop cannot advance; without this it never terminates */
    }
}

// C ref: shk.c add_one_tobill(obj, dummy, shkp):3309.  (Real port:
// js/shkroom.js, private.)  No RNG.
function add_one_tobill(obj, dummy, shkp) {
    const eshkp = shkp.eshk;
    let unbilled = false;

    if (!eshkp.bill_p) eshkp.bill_p = eshkp.bill;

    const owner = billable(shkp, obj, (game.u?.ushops || [])[0], true);
    if (!owner) {
        unbilled = true; /* shk doesn't want it */
    } else if (eshkp.billct === BILLSZ) {
        update_topl('You got that for free!');
        unbilled = true;
    }
    if (unbilled) {
        if (obj.where === OBJ_FREE) dealloc_obj(obj);
        return;
    }
    shkp = owner;

    const bct = eshkp.billct;
    if (!Array.isArray(eshkp.bill)) eshkp.bill = [];
    const bp = eshkp.bill[bct] || (eshkp.bill[bct] = {});
    bp.bo_id = obj.o_id;
    bp.bquan = obj.quan;
    if (dummy) {         /* a dummy object goes on the billobjs chain here */
        bp.useup = true;
        add_to_billobjs(obj);
    } else {
        bp.useup = false;
    }
    bp.price = get_cost(obj, shkp);
    if (obj.globby) {
        /* for globs the amount charged for quan 1 depends on owt */
        bp.price *= get_pricing_units(obj);
        newomid(obj);
        if (obj.oextra) obj.oextra.omid = obj.owt;
    }
    eshkp.billct++;
    obj.unpaid = 1;
    record_price_quote(obj.otyp, bp.price, true);
}

// C ref: shk.c add_to_billobjs(obj):3366 — the chain of FULLY used-up billed
// items.  This port keeps it as an ARRAY, so C's prepend is a push (only o_on()
// scan order differs, and no RNG depends on it).
export function add_to_billobjs(obj) {
    if (obj.where !== OBJ_FREE) return; /* C: panic("obj not free") */
    if (obj.timed) obj.timed = 0;       /* C: obj_stop_timers(obj) */

    if (!Array.isArray(game.billobjs)) game.billobjs = [];
    game.billobjs.push(obj);
    obj.where = OBJ_ONBILL;

    /* a shop potion the hero drank is in_use but is not used up yet */
    obj.in_use = 0;
    obj.bypass = 0;
}

// C ref: shk.c bill_box_content(obj, ininv, dummy, shkp):3387 — recursive
// billing of a container's contents.  A Schroedinger's Box is skipped so its
// contents are not collapsed into existence.
export function bill_box_content(obj, ininv, dummy, shkp) {
    if (SchroedingersBox(obj)) return;
    for (const otmp of (obj.cobj || [])) {
        if (otmp.oclass === COIN_CLASS) continue;

        /* the "top" box is added in addtobill() */
        if (!otmp.no_charge) add_one_tobill(otmp, dummy, shkp);
        if (Has_contents(otmp)) bill_box_content(otmp, ininv, dummy, shkp);
    }
}

// C ref: shk.c splitbill(obj, otmp):3623 — otmp was split off obj, so the bill
// grows a second entry at the same unit price.  No RNG (splitobj's rnd(2) is
// spent by its caller).
export function splitbill(obj, otmp) {
    const shkp = shop_keeper((game.u?.ushops || [])[0]);
    if (!shkp || !inhishop(shkp)) return; /* C: impossible() */
    const bp = onbill(obj, shkp);
    if (!bp) return;                      /* C: impossible() */
    /* C impossible()s on bquan < quan and bquan == quan but keeps going */
    bp.bquan -= otmp.quan;

    if (shkp.eshk.billct === BILLSZ) {
        otmp.unpaid = 0;
    } else {
        const tmp = bp.price;
        const nbp = shkp.eshk.bill[shkp.eshk.billct]
            || (shkp.eshk.bill[shkp.eshk.billct] = {});
        nbp.bo_id = otmp.o_id;
        nbp.bquan = otmp.quan;
        nbp.useup = false;
        nbp.price = tmp;
        shkp.eshk.billct++;
    }
}

// C ref: shk.c sub_one_frombill(obj, shkp):3661 — take obj off the bill.  RNG:
// next_ident()'s rnd(2), and ONLY on the partly-used-up branch (bquan > quan),
// where a dummy stands in for the consumed part.
export function sub_one_frombill(obj, shkp) {
    const bp = onbill(obj, shkp);
    if (bp) {
        obj.unpaid = 0;
        if (bp.bquan > obj.quan) {
            const otmp = { ...obj };       /* C: newobj(); *otmp = *obj */
            otmp.oextra = null;
            bp.bo_id = otmp.o_id = next_ident(); /* svc.context.ident++ */
            otmp.where = OBJ_FREE;
            bp.bquan -= obj.quan;
            otmp.quan = bp.bquan;
            otmp.owt = 0;                  /* superfluous */
            bp.useup = true;
            add_to_billobjs(otmp);
            return;
        }
        const eshkp = shkp.eshk;
        eshkp.billct--;
        eshkp.bill[eshkp.bill.indexOf(bp)] = eshkp.bill[eshkp.billct];
        return;
    }
    if (obj.unpaid) obj.unpaid = 0;         /* C: impossible() first */
}

// C ref: shk.c subfrombill(obj, shkp):3694 — recursive over nested containers.
export function subfrombill(obj, shkp) {
    sub_one_frombill(obj, shkp);

    if (Has_contents(obj))
        for (const otmp of (obj.cobj || [])) {
            if (otmp.oclass === COIN_CLASS) continue;

            if (Has_contents(otmp)) subfrombill(otmp, shkp);
            else sub_one_frombill(otmp, shkp);
        }
}

// C ref: shk.c stolen_container(obj, shkp, price, ininv):3713 — the value of a
// stolen container's CONTENTS (the caller handles the top container).  Items
// already on the bill come off it so they are not billed twice.
export function stolen_container(obj, shkp, price, ininv) {
    for (const otmp of (obj.cobj || [])) {
        if (otmp.oclass === COIN_CLASS) continue;
        let billamt = 0;
        if (!billable(shkp, otmp, shkp.eshk.shoproom, true)) {
            /* billable() returns false for objects already on the bill */
            const bp = onbill(otmp, shkp);
            if (!bp) continue;
            billamt = bp.bquan * bp.price;
            sub_one_frombill(otmp, shkp); /* avoid double billing */
        }

        if (billamt) price += billamt;
        else if (ininv ? otmp.unpaid : !otmp.no_charge)
            price += get_pricing_units(otmp) * get_cost(otmp, shkp);

        if (Has_contents(otmp)) price = stolen_container(otmp, shkp, price, ininv);
    }

    return price;
}

// C ref: shk.c donate_gold(gltmp, shkp, selling):3877 — the hero dropped gold
// in a shop; it pays down debt first, then becomes credit.
export async function donate_gold(gltmp, shkp, selling) {
    const eshkp = shkp.eshk;

    if ((eshkp.debit || 0) >= gltmp) {
        if (eshkp.loan) { /* you carry shop's gold */
            if (eshkp.loan > gltmp) eshkp.loan -= gltmp;
            else eshkp.loan = 0;
        }
        eshkp.debit -= gltmp;
        await update_topl(`Your debt is ${eshkp.debit ? 'partially ' : ''}paid off.`);
    } else {
        const delta = gltmp - (eshkp.debit || 0);

        eshkp.credit = (eshkp.credit || 0) + delta;
        if (eshkp.debit) {
            eshkp.debit = 0;
            eshkp.loan = 0;
            await update_topl('Your debt is paid off.');
        }
        if (eshkp.credit === delta)
            await update_topl(`You have ${!selling ? 're-' : ''}established ${
                delta} ${currency(delta)} credit.`);
        else
            await update_topl(`${delta} ${currency(delta)} added${
                !selling ? ' back' : ''} to your credit; total is now ${
                eshkp.credit} ${currency(eshkp.credit)}.`);
    }
}

// C ref: shk.c sellobj_state(deliberate):3913 and decl.h gs.sell_response /
// gs.sell_how / ga.auto_credit.  This port has no gs/ga structs; these three
// module-level values are the C globals, read and written only by
// sellobj_state() and sellobj() as in C.
let sell_response = '\0';
let sell_how = SELL_NORMAL;
let auto_credit = false;
export function sellobj_state(deliberate) {
    /* dropping something deliberately means no automatic answer to the
       "want to sell?" query; an accidental drop is bought without asking */
    sell_response = (deliberate !== SELL_NORMAL) ? '\0' : 'a';
    sell_how = deliberate;
    auto_credit = false;
}

// C ref: shk.c sellobj(obj, x, y):3927 — the hero dropped something on shop
// floor.  No rn2() of its own; the RNG it can reach is sub_one_frombill()'s
// next_ident() and currency()'s hallucination roll.
export async function sellobj(obj, x, y) {
    let ltmp = 0, cltmp = 0, gltmp = 0, offer;
    let cgold = false;
    const container = Has_contents(obj);
    const isgold = (obj.oclass === COIN_CLASS);
    let only_partially_your_contents = false;

    if (!(game.u?.ushops || []).length) return; /* cheapest exclusion first */
    const shkp = shop_keeper(in_rooms(x, y, SHOPBASE)[0]);
    if (!shkp || !inhishop(shkp)) return;
    if (!costly_spot(x, y)) return;

    if (obj.unpaid && !container && !isgold) {
        sub_one_frombill(obj, shkp);
        return;
    }
    if (container) {
        /* the price of the contents, before subfrombill */
        cltmp = contained_cost(obj, shkp, cltmp, true, false);
        gltmp += contained_gold(obj, true);
        cgold = (gltmp > 0);
    }

    const saleitem = saleable(shkp, obj);
    if (!isgold && !obj.unpaid && saleitem) ltmp = set_cost(obj, shkp);

    offer = ltmp + cltmp;

    /* you dropped something of your own - probably want to sell it */
    await rouse_shk(shkp, true);
    const eshkp = shkp.eshk;

    if (ANGRY(shkp)) { /* they become shop-objects, no pay */
        if (!Deaf() && !muteshk(shkp)) await verbalize('Thank you, scum!');
        else await update_topl(`${Shknam(shkp)} smirks with satisfaction.`);
        subfrombill(obj, shkp);
        return;
    }

    /* nothing to sell, and no gold */
    if (!(isgold || cgold)
        && ((offer + gltmp) === 0 || sell_how === SELL_DONTSELL)) {
        const unpaid = is_unpaid(obj);

        if (container) {
            dropped_container(obj, shkp, false);
            if (!obj.unpaid) obj.no_charge = 1;
            if (unpaid) subfrombill(obj, shkp);
        } else {
            obj.no_charge = 1;
        }

        if (!unpaid && (sell_how !== SELL_DONTSELL)
            && !(await special_stock(obj, shkp, false)))
            await update_topl(`${Shknam(shkp)} seems uninterested.`);
        return;
    }

    if (eshkp.robbed) { /* bones; shop robbed by a previous customer */
        if (isgold) offer = obj.quan;
        else if (cgold) offer += 1; /* C really adds the BOOLEAN cgold */
        /* C:4004 `if ((eshkp->robbed -= offer < 0L))` — the comparison binds
           tighter than the -=, so this subtracts 0 or 1 and then zeroes the
           field whenever the result is nonzero.  Reproduced verbatim. */
        eshkp.robbed -= (offer < 0) ? 1 : 0;
        if (eshkp.robbed) eshkp.robbed = 0;
        if (offer && !Deaf() && !muteshk(shkp))
            await verbalize('Thank you for your contribution to restock this recently plundered shop.');
        subfrombill(obj, shkp);
        return;
    }

    if (isgold || cgold) {
        if (!cgold) gltmp = obj.quan;

        await donate_gold(gltmp, shkp, true);

        if (!offer || sell_how === SELL_DONTSELL) {
            if (!isgold) {
                if (container) dropped_container(obj, shkp, false);
                if (!obj.unpaid) obj.no_charge = 1;
                subfrombill(obj, shkp);
            }
            return;
        }
    }

    if ((!saleitem && !(container && cltmp > 0)) || eshkp.billct === BILLSZ
        || obj.oclass === BALL_CLASS || obj.oclass === CHAIN_CLASS
        || offer === 0 || (obj.oclass === FOOD_CLASS && obj.oeaten)
        || (Is_candle(obj) && (obj.age || 0) < 20 * base_oc_cost(obj.otyp))) {
        await update_topl(`${Shknam(shkp)} seems uninterested${
            cgold ? ' in the rest' : ''}.`);
        if (container) dropped_container(obj, shkp, false);
        obj.no_charge = 1;
        return;
    }

    const shkmoney = money_cnt(shkp.minvent);
    if (!shkmoney) {
        let c;
        const tmpcr = Math.trunc((offer * 9) / 10) + (offer <= 1 ? 1 : 0);

        if (sell_how === SELL_NORMAL || auto_credit) {
            c = sell_response = 'y';
        } else if (sell_response !== 'n') {
            await update_topl(`${Shknam(shkp)} cannot pay you at present.`);
            record_price_quote(obj.otyp, Math.trunc(tmpcr / (obj.quan || 1)), false);
            /* C wraps the name in safe_qbuf(); its BUFSZ fallback is not ported */
            c = await ynaq_(`Will you accept ${tmpcr} ${currency(tmpcr)
                } in credit for ${doname_invent(obj)}?`);
            if (c === 'a') { c = 'y'; auto_credit = true; }
        } else { /* previously specified "quit" */
            c = 'n';
        }

        if (c === 'y') {
            await shk_names_obj(shkp, obj,
                (sell_how !== SELL_NORMAL)
                    ? 'traded %s for %ld zorkmid%s in %scredit.'
                    : 'relinquish %s and acquire %ld zorkmid%s in %scredit.',
                tmpcr, ((eshkp.credit || 0) > 0) ? 'additional ' : '');
            eshkp.credit = (eshkp.credit || 0) + tmpcr;
            if (container) dropped_container(obj, shkp, true);
            subfrombill(obj, shkp);
        } else {
            if (c === 'q') sell_response = 'n';
            if (container) dropped_container(obj, shkp, false);
            if (!obj.unpaid) obj.no_charge = 1;
            subfrombill(obj, shkp);
        }
    } else {
        let qbuf = '';
        const short_funds = (offer > shkmoney);
        let one;

        if (short_funds) offer = shkmoney;
        if (!sell_response || sell_response === '\0') {
            let yourc = 0, shksc;

            if (container) {
                shksc = count_contents(obj, true, true, false, true);
                yourc = count_contents(obj, true, true, true, true) - shksc;
                only_partially_your_contents = !!(shksc && yourc);
            }
            qbuf = `${Shknam(shkp)} offers${short_funds ? ' only' : ''} ${offer
                } gold piece${plur(offer)} for ${
                (cltmp && !ltmp)
                    ? ((yourc === 1) ? 'your item in ' : 'your items in ')
                    : ''}${obj.unpaid ? 'the' : 'your'} `;
            one = !ltmp ? (yourc === 1) : ((obj.quan === 1) && !cltmp);
            const qsfx = `${(cltmp && ltmp)
                ? (only_partially_your_contents
                    ? ((yourc === 1) ? ' and item inside' : ' and items inside')
                    : and_its_contents)
                : ''}.  Sell ${one ? 'it' : 'them'}?`;
            record_price_quote(obj.otyp, Math.trunc(offer / (obj.quan || 1)), false);
            /* C: safe_qbuf(qbuf, qbuf, qsfx, obj, xname, simpleonames, ...) */
            qbuf = `${qbuf}${xname(obj)}${qsfx}`;
        }

        const resp = (sell_response && sell_response !== '\0')
            ? sell_response : await nyaq_(qbuf);
        switch (resp) {
        case 'q':
            sell_response = 'n';
            /* FALLTHRU */
        case 'n':
            if (container) dropped_container(obj, shkp, false);
            if (!obj.unpaid) obj.no_charge = 1;
            subfrombill(obj, shkp);
            break;
        case 'a':
            sell_response = 'y';
            /* FALLTHRU */
        case 'y':
            if (container) dropped_container(obj, shkp, true);
            if (!obj.unpaid && !saleitem) obj.no_charge = 1;
            subfrombill(obj, shkp);
            await pay(-offer, shkp);
            await shk_names_obj(shkp, obj,
                (sell_how !== SELL_NORMAL)
                    ? ((!ltmp && cltmp && only_partially_your_contents)
                        ? 'sold some items inside %s for %ld gold piece%s.%s'
                        : 'sold %s for %ld gold piece%s.%s')
                    : 'relinquish %s and receive %ld gold piece%s in compensation.%s',
                offer, '');
            break;
        default:
            break; /* C: impossible("invalid sell response") */
        }
    }
}

// C ref: shk.c doinvbill(mode):4197 — the `I x` listing of unpaid articles
// already used up.  mode 0 just returns the count (that is what decides
// whether `I`'s prompt offers 'x' at all).
export function doinvbill(mode) {
    const shkp = shop_keeper((game.u?.ushops || [])[0]);
    if (!shkp || !inhishop(shkp)) return 0; /* C: impossible() when mode != 0 */
    const eshkp = shkp.eshk;

    if (mode === 0) {
        let cnt = !eshkp.debit ? 0 : 1;
        for (let i = 0; i < (eshkp.billct || 0); i++) {
            const bp = eshkp.bill[i];
            let obj;
            if (bp.useup || ((obj = bp_to_obj(bp)) && obj.quan < bp.bquan)) cnt++;
        }
        return cnt;
    }

    const datawin = create_nhwindow(NHW_MENU);
    putstr(datawin, 0, 'Unpaid articles already used up:');
    putstr(datawin, 0, '');

    let totused = 0;
    for (let i = 0; i < (eshkp.billct || 0); i++) {
        const bp = eshkp.bill[i];
        const obj = bp_to_obj(bp);
        if (!obj) {                       /* C: impossible(); goto quit */
            destroy_nhwindow(datawin);
            return 0;
        }
        if (bp.useup || bp.bquan > obj.quan) {
            const oquan = obj.quan;
            const uquan = (bp.useup ? bp.bquan : bp.bquan - oquan);
            const thisused = bp.price * uquan;
            totused += thisused;
            game.iflags = game.iflags || {};
            game.iflags.suppress_price = (game.iflags.suppress_price || 0) + 1;
            /* 'x' to match `I x`, more or less */
            const buf_p = xprname(obj, null, 'x', false, thisused, uquan);
            game.iflags.suppress_price--;
            putstr(datawin, 0, buf_p);
        }
    }
    if (eshkp.debit) {
        if (totused) putstr(datawin, 0, '');
        totused += eshkp.debit;
        putstr(datawin, 0, xprname(null, 'usage charges and/or other fees',
                                   GOLD_SYM, false, eshkp.debit, 0));
    }
    putstr(datawin, 0, '');
    putstr(datawin, 0, xprname(null, 'Total:', '*', false, totused, 0));
    display_nhwindow(datawin, false);
    destroy_nhwindow(datawin);
    return 0;
}

// ── shk.c:4362 .. :6114 ─────────────────────────────────────────────────────

// C ref: rm.h closed_door(x, y).  js/dig.js and js/dothrow.js each keep a
// private copy.
function closed_door(x, y) {
    const loc = game.level?.at(x, y);
    return !!loc && IS_DOOR(loc.typ) && !!((loc.doormask || 0) & (D_LOCKED | D_CLOSED));
}
const Invis = () => ((game.u?.uprops?.Invis || 0) > 0);

// C ref: shk.c shkcatch(obj, x, y):4362 — the shk snatches a pick-axe thrown
// into her shop.  GAP: mnearto() is unported, so the `== 2` (had to displace a
// monster) arm can never fire and the shk does not actually move.
export async function shkcatch(obj, x, y) {
    const shkp = shop_keeper(inside_shop(x, y));
    if (!shkp || !inhishop(shkp)) return null;

    const { dist2 } = await import('./hacklib.js');
    if (!helpless(shkp)
        && ((game.u?.ushops || [])[0] !== shkp.eshk.shoproom
            || !inside_shop(game.u.ux, game.u.uy))
        && dist2(shkp.mx, shkp.my, x, y) < 3
        /* if it is the shk's own spot, you hit and anger him */
        && (shkp.mx !== x || shkp.my !== y)) {
        const moved = 0; /* GAP: mnearto(shkp, x, y, TRUE, RLOC_NOMSG) */
        if (moved === 2 && !Deaf() && !muteshk(shkp))
            await verbalize('Out of my way, scum!');
        const { cansee } = await import('./vision.js');
        if (cansee(x, y)) {
            await update_topl(`${Shknam(shkp)}${
                (x === shkp.mx && y === shkp.my) ? '' : ' reaches over and'
            } nimbly catches ${the(xname(obj))}.`);
            const { canspotmon } = await import('./uhitm.js');
            if (!canspotmon(shkp)) map_invisible(x, y);
        }
        subfrombill(obj, shkp);
        mpickobj(shkp, obj);
        return shkp;
    }
    return null;
}

// C ref: shk.c add_damage(x, y, cost):4399 — schedule a wall/door for repair.
// The damage list is a linked list threaded through `.next`, the shape
// js/save.js already expects at game.level.damagelist.
export async function add_damage(x, y, cost) {
    const loc = game.level?.at(x, y);

    if (loc && IS_DOOR(loc.typ)) {
        /* don't schedule a repair unless it's a real shop entrance */
        const shops = in_rooms(x, y, SHOPBASE);
        let found = false;
        for (const s of shops) {
            const mtmp = shop_keeper(s);
            if (mtmp && x === mtmp.eshk.shd?.x && y === mtmp.eshk.shd?.y) {
                found = true;
                break;
            }
        }
        if (!found) return;
    }
    for (let tmp_dam = game.level?.damagelist; tmp_dam; tmp_dam = tmp_dam.next)
        if (tmp_dam.place.x === x && tmp_dam.place.y === y) {
            tmp_dam.cost += cost;
            tmp_dam.when = game.moves; /* needed by pay_for_damage() */
            return;
        }
    const tmp_dam = {
        when: game.moves, place: { x, y }, cost,
        typ: loc?.typ ?? 0, flags: loc?.flags ?? 0,
        next: game.level?.damagelist || null,
    };
    if (game.level) game.level.damagelist = tmp_dam;
    /* if the player saw the damage, show the repaired wall as a wall */
    const { cansee } = await import('./vision.js');
    if (loc && cansee(x, y)) loc.seenv = SVALL;
}

// C ref: shk.c shk_impaired(shkp):4441 — cannot act (absent, helpless, or off
// chasing the hero).
export function shk_impaired(shkp) {
    if (!shkp || !shkp.isshk || !inhishop(shkp)) return true;
    if (helpless(shkp) || shkp.eshk.following) return true;
    return false;
}

// C ref: shk.c repairable_damage(dam, shkp):4452.
export async function repairable_damage(dam, shkp) {
    if (!dam || shk_impaired(shkp)) return false;

    const x = dam.place.x, y = dam.place.y;

    /* too soon to fix it? */
    if (((game.moves || 0) - dam.when) < REPAIR_DELAY) return false;
    /* is it a wall? don't fix if anyone is in the way */
    if (!IS_ROOM(dam.typ)) {
        const mtmp = m_at(x, y);
        if ((u_at(x, y) && !((game.u?.uprops?.Passes_walls || 0) > 0))
            || (x === shkp.mx && y === shkp.my)
            || (mtmp && !passes_walls(mtmp.data)))
            return false;
    }
    /* is it a trap? don't fix if hero or monster is in it */
    const { t_at } = await import('./mkroom.js');
    const ttmp = t_at(x, y);
    if (ttmp) {
        if (u_at(x, y)) return false;
        const mtmp = m_at(x, y);
        if (mtmp && mtmp.mtrapped) return false;
    }
    /* does it belong to shkp? */
    if (!in_rooms(x, y, SHOPBASE).includes(shkp.eshk.shoproom)) return false;

    return true;
}

// C ref: shk.c find_damage(shkp):4491.
export async function find_damage(shkp) {
    let dam = game.level?.damagelist;

    if (shk_impaired(shkp)) return null;

    while (dam) {
        if (await repairable_damage(dam, shkp)) return dam;
        dam = dam.next;
    }
    return null;
}

// C ref: shk.c discard_damage_struct(dam):4509.
export function discard_damage_struct(dam) {
    if (!dam) return;

    if (dam === game.level?.damagelist) {
        game.level.damagelist = dam.next;
    } else {
        let prev = game.level?.damagelist;
        while (prev && prev.next !== dam) prev = prev.next;
        if (prev) prev.next = dam.next;
    }
    dam.next = null; /* C memsets and frees */
}

// C ref: shk.c discard_damage_owned_by(shkp):4530.
export function discard_damage_owned_by(shkp) {
    let dam = game.level?.damagelist, dam2, prevdam = null;

    while (dam) {
        const x = dam.place.x, y = dam.place.y;

        if (in_rooms(x, y, SHOPBASE).includes(shkp.eshk.shoproom)) {
            dam2 = dam.next;
            if (prevdam) prevdam.next = dam2;
            if (dam === game.level.damagelist) game.level.damagelist = dam2;
            dam = null;
        } else {
            prevdam = dam;
            dam2 = dam.next;
        }
        dam = dam2;
    }
}

// C ref: shk.c shk_fixes_damage(shkp):4556 — the shk's per-move repair attempt.
export async function shk_fixes_damage(shkp) {
    const dam = await find_damage(shkp);
    if (!dam) return;

    const shk_closeby = (mdistu(shkp) <= Math.trunc(BOLT_LIM / 2) ** 2);

    if (await canseemon(shkp)) {
        await update_topl(`${Shknam(shkp)} whispers ${
            shk_closeby ? 'an incantation' : 'something'}.`);
    } else if (!Deaf() && shk_closeby) {
        await update_topl('You hear someone muttering an incantation.');
    }

    await repair_damage(shkp, dam, false);

    discard_damage_struct(dam);
}

// C ref: shk.c:4579 LITTER_* / horiz(i) / vert(i).
const LITTER_UPDATE = 0x01, LITTER_OPEN = 0x02, LITTER_INSHOP = 0x04;
const horiz = (i) => ((i % 3) - 1);
const vert = (i) => (Math.trunc(i / 3) - 1);

// C ref: shk.c litter_getpos(litter, x, y, shkp):4591 — the eligible spots to
// push items out of a wall gap that is about to be repaired.  Returns the count
// of adjacent squares inside shkp's shop.  No RNG.
export function litter_getpos(litter, x, y, shkp) {
    let k = 0; /* number of adjacent shop spots */

    for (let i = 0; i < 9; i++) litter[i] = 0;

    if (objects_at(x, y).length && !IS_ROOM(game.level?.at(x, y)?.typ ?? 0)) {
        for (let i = 0; i < 9; i++) {
            const ix = x + horiz(i), iy = y + vert(i);
            if (i === 4 || !isok(ix, iy)
                || !ZAP_POS(game.level?.at(ix, iy)?.typ ?? 0)) continue;
            litter[i] = LITTER_OPEN;
            if (inside_shop(ix, iy) === shkp.eshk.shoproom) {
                litter[i] |= LITTER_INSHOP;
                ++k;
            }
        }
    }
    return k;
}

// C ref: shk.c litter_scatter(litter, x, y, shkp):4622 — RNG: one rn2(9) per
// item moved, then the do/while walk of at most 10 slots.
export async function litter_scatter(litter, x, y, shkp) {
    const u = game.u;
    const uchain = u?.uchain, uball = u?.uball;

    /* either the ball or the chain is in the repair location.
       C ref: youprop.h Punished == (uball != 0). */
    if (uball && !u?.uswallow
        && ((uchain && uchain.ox === x && uchain.oy === y)
            || (uball && uball.where === OBJ_FLOOR
                && uball.ox === x && uball.oy === y))) {
        if (!Deaf() && !muteshk(shkp))
            await verbalize('Get your junk out of my wall!');
        const { unplacebc, placebc } = await import('./ball.js');
        unplacebc(); /* pick 'em up */
        placebc();   /* put 'em down */
    }

    for (;;) {
        const otmp = objects_at(x, y)[0];
        if (!otmp) break;
        /* don't mess w/ boulders -- just merge into wall */
        if (otmp.otyp === BOULDER || otmp.otyp === ROCK) {
            obj_extract_self(otmp);
            obfree(otmp, null);
        } else {
            let trylimit = 10;
            let i = rn2(9), ix, iy;

            /* otmp must be moved or the enclosing loop never terminates */
            do {
                i = (i + 1) % 9;
            } while (--trylimit && !(litter[i] & LITTER_INSHOP));
            if ((litter[i] & (LITTER_OPEN | LITTER_INSHOP)) !== 0) {
                ix = x + horiz(i);
                iy = y + vert(i);
            } else {
                /* the shk isn't at <x,y>: repair is deferred in that case */
                ix = shkp.mx;
                iy = shkp.my;
            }
            if (otmp.unpaid) {
                /* GAP: the `|| (oshk = find_objowner(...)) && onbill(...)`
                   half of C's test — find_objowner() is private in
                   js/dokick.js — so a shared wall's rival shk is not asked. */
                const oshk = shkp;
                if (costly_spot(ix, iy) && onbill(otmp, oshk))
                    subfrombill(otmp, oshk);
            }
            if (otmp.no_charge) {
                if (!costly_spot(ix, iy) && !costly_adjacent(shkp, ix, iy))
                    otmp.no_charge = 0;
            }

            remove_object(otmp);
            place_object(otmp, ix, iy);
            litter[i] |= LITTER_UPDATE;
        }
    }
}

// C ref: shk.c litter_newsyms(litter, x, y):4712.
export function litter_newsyms(litter, x, y) {
    for (let i = 0; i < 9; i++)
        if (litter[i] & LITTER_UPDATE) newsym(x + horiz(i), y + vert(i));
}

// C ref: shk.c repair_damage(shkp, tmp_dam, catchup):4732.
// 0: postponed, 1: silent repair, 2: normal repair, 3: untrap.
// RNG: litter_scatter()'s rn2(9) per item, plus one rn2(10) on the unseen-wall
// "dungeon acoustics" line.
export async function repair_damage(shkp, tmp_dam, catchup) {
    const litter = new Array(9).fill(0);
    let disposition = 1;
    let stop_picking = false;

    if (!(await repairable_damage(tmp_dam, shkp))) return 0;

    const x = tmp_dam.place.x, y = tmp_dam.place.y;
    const { cansee } = await import('./vision.js');
    const seeit = !!cansee(x, y);
    const loc = game.level?.at(x, y);

    const { t_at } = await import('./mkroom.js');
    const { deltrap } = await import('./trap.js');
    const { del_engr_at } = await import('./engrave.js');
    const ttmp = t_at(x, y);
    if (ttmp) {
        switch (ttmp.ttyp) {
        case LANDMINE:
        case BEAR_TRAP: {
            /* convert to an object */
            const otmp = mksobj((ttmp.ttyp === LANDMINE) ? LAND_MINE : BEARTRAP,
                                true, false);
            otmp.quan = 1;
            otmp.owt = weight(otmp);
            if (!catchup) {
                const { dist2 } = await import('./hacklib.js');
                if (await canseemon(shkp) && dist2(x, y, shkp.mx, shkp.my) <= 2)
                    await update_topl(`${Shknam(shkp)} untraps ${ansimpleoname(otmp)}.`);
                else if (ttmp.tseen && cansee(ttmp.tx, ttmp.ty))
                    await update_topl(`The ${await trapname_(ttmp.ttyp)} vanishes.`);
            }
            mpickobj(shkp, otmp);
            break;
        }
        case HOLE:
        case PIT:
        case SPIKED_PIT:
            if (!catchup && ttmp.tseen && cansee(ttmp.tx, ttmp.ty))
                await update_topl(`The ${await trapname_(ttmp.ttyp)} is filled in.`);
            break;
        default:
            if (!catchup && ttmp.tseen && cansee(ttmp.tx, ttmp.ty))
                await update_topl(`The ${await trapname_(ttmp.ttyp)} vanishes.`);
            break;
        }
        deltrap(ttmp);
        del_engr_at(x, y);
        if (seeit) newsym(x, y);
        if (!catchup) disposition = 3;
    }
    if (IS_ROOM(tmp_dam.typ)
        || (tmp_dam.typ === (loc?.typ ?? 0)
            && (!IS_DOOR(tmp_dam.typ) || (loc?.doormask || 0) > D_BROKEN)))
        /* no terrain fix necessary (trap removal or manually repaired) */
        return disposition;

    if (closed_door(x, y)) {
        const { picking_at } = await import('./lock.js');
        stop_picking = !!picking_at(x, y);
    }

    /* rm.doormask and rm.wall_info are both overlaid on rm.flags, so the new
       flags value has to match the restored typ */
    if (loc) {
        loc.typ = tmp_dam.typ;
        if (IS_DOOR(tmp_dam.typ)) loc.doormask = D_CLOSED; /* arbitrary */
        else loc.flags = tmp_dam.flags;
    }

    if (litter_getpos(litter, x, y, shkp))
        await litter_scatter(litter, x, y, shkp);
    del_engr_at(x, y);

    if (seeit) newsym(x, y);
    const { block_point } = await import('./vision.js');
    block_point(x, y);

    if (catchup) return 1; /* repair happened off level, so no messages */

    if (seeit) {
        if (IS_WALL(tmp_dam.typ)) {
            if (loc) loc.seenv = SVALL; /* hero KNOWS it's a wall */
            await update_topl('Suddenly, a section of the wall closes up!');
        } else if (IS_DOOR(tmp_dam.typ)) {
            await update_topl('Suddenly, the shop door reappears!');
        }
        newsym(x, y);
    } else if (IS_WALL(tmp_dam.typ)) {
        if (inside_shop(game.u.ux, game.u.uy) === shkp.eshk.shoproom)
            await update_topl('You feel more claustrophobic than before.');
        else if (!Deaf() && !rn2(10))
            await update_topl('The dungeon acoustics noticeably change.');
    }

    if (stop_picking) {
        const { stop_occupation } = await import('./hack.js');
        stop_occupation();
    }

    litter_newsyms(litter, x, y);

    if (disposition < 3) disposition = 2;
    return disposition;
}

// C ref: trap.c trapname(ttyp, override) — js/trap.js exports the underlying
// TRAP_EXPLANATION lookup as trap_explanation(), not trapname().
async function trapname_(ttyp) {
    const { trap_explanation } = await import('./trap.js');
    return trap_explanation(ttyp) || 'trap';
}

// C ref: shk.c fix_shop_damage():4850 — catch-up repairs when a level is
// reloaded.
export async function fix_shop_damage() {
    if (!game.level?.damagelist) return;

    for (let shkp = next_shkp(fmon()[0], false); shkp;
         shkp = next_shkp(nmon(shkp), false)) {
        if (shk_impaired(shkp)) continue;
        for (let damg = game.level.damagelist, nextdamg; damg; damg = nextdamg) {
            nextdamg = damg.next;
            if (await repair_damage(shkp, damg, true)) discard_damage_struct(damg);
        }
    }
}

// C ref: shk.c after_shk_move(shkp):4997 — the shk stepped back into her shop,
// so the -1000 sentinel bill_p becomes real again and occupancy is rechecked.
export async function after_shk_move(shkp) {
    const eshkp = shkp.eshk;

    if (eshkp.bill_p === -1000 && inhishop(shkp)) {
        eshkp.bill_p = eshkp.bill;
        /* only re-check occupancy if the game hasn't just ended */
        if (!game.program_state?.gameover) {
            const { check_special_room } = await import('./shkroom.js');
            await check_special_room(false);
        }
    }
}

// C ref: shk.c shopdig(fall):5019 — digging in a shop.  GAP: mnexto() has no
// port in this tree, so the "leaps and grabs your backpack" relocation is
// skipped (and with it the enexto() draws).  No rn2() of its own.
export async function shopdig(fall) {
    const shkp = shop_keeper((game.u?.ushops || [])[0]);
    let grabs = 'grabs';

    if (!shkp) return;
    if (!inhishop(shkp)) {
        if ((game.urole?.mnum ?? -1) === PM_KNIGHT) {
            await update_topl('You feel like a common thief.');
            adjalign(-sgn(game.u?.ualign?.type || 0));
        }
        return;
    }
    /* 0 == can't speak, 1 == makes animal noises, 2 == speaks */
    let lang = 0;
    if (helpless(shkp) || is_silent(shkp.data)) ; /* lang stays 0 */
    else if ((msound_of(shkp.data) ?? 99) <= MS_ANIMAL) lang = 1;
    else if ((msound_of(shkp.data) ?? 0) >= MS_HUMANOID) lang = 2;

    if (!fall) {
        if (lang === 2) {
            if (!Deaf() && !muteshk(shkp)) {
                if (game.u?.utraptype === TT_PIT)
                    await verbalize(`Be careful, ${
                        game.flags?.female ? 'madam' : 'sir'
                    }, or you might fall through the floor.`);
                else
                    await verbalize(`${game.flags?.female ? 'Madam' : 'Sir'
                    }, do not damage the floor here!`);
            }
        }
        if ((game.urole?.mnum ?? -1) === PM_KNIGHT) {
            await update_topl('You feel like a common thief.');
            adjalign(-sgn(game.u?.ualign?.type || 0));
        }
    } else if (!um_dist(shkp.mx, shkp.my, 5) && !helpless(shkp)
               && (shkp.eshk.billct || shkp.eshk.debit)) {
        if (nolimbs(shkp.data)) grabs = 'knocks off';
        if (!m_next2u(shkp)) {
            /* GAP: mnexto(shkp, RLOC_MSG) */
            if (!m_next2u(shkp)) {
                if (lang === 2)
                    await update_topl(`${Shknam(shkp)} curses you in anger and frustration!`);
                else if (lang === 1) {
                    const { growl } = await import('./sounds.js');
                    await growl(shkp);
                }
                rile_shk(shkp);
                return;
            }
            /* C: makeplural(locomotion(shkp->data, "leap")); locomotion() has
               no port in this tree, so the verb is fixed at "leaps". */
            await update_topl(`${Shknam(shkp)} leaps, and ${grabs} your backpack!`);
        } else {
            await update_topl(`${Shknam(shkp)} ${grabs} your backpack!`);
        }

        const { freeinv } = await import('./invent.js');
        /* W_SWAPWEP/W_QUIVER here are const.js's (i.e. prop.h's) real bits;
           js/invent.js deliberately REMAPS the W_* bits it writes into
           obj.owornmask, so this mask has to be revisited before going live. */
        for (const obj of (game.invent || []).slice()) {
            if (((obj.owornmask || 0) & ~(W_SWAPWEP | W_QUIVER)) !== 0
                || (obj === game.uswapwep && game.u?.twoweap)
                || (obj.otyp === LEASH && obj.leashmon))
                continue;
            if (obj === game.current_wand) continue;
            obj.owornmask = 0;              /* C: setnotworn(obj) */
            freeinv(obj);
            subfrombill(obj, shkp);
            add_to_minv_(shkp, obj);
        }
    }
}
// C ref: mon.c add_to_minv(mon, obj).  js/vault.js keeps a private copy.
function add_to_minv_(mon, obj) {
    if (!mon.minvent) mon.minvent = [];
    mon.minvent.unshift(obj);
    obj.where = OBJ_MINVENT;
    obj.ocarry = mon;
}

// C ref: shk.c getcad(shkp, dmgstr, x, y, uinshp, animal, pursue):5138 — the
// shk's reaction to damage she is not being paid for.  RNG: one
// ROLL_FROM(angrytexts) == rn2(3) on each Deaf arm.
export async function getcad(shkp, dmgstr, x, y, uinshp, animal, pursue) {
    const dugwall = (dmgstr === 'dig into')   /* wand */
                 || (dmgstr === 'damage');    /* pick-axe */

    if (muteshk(shkp)) {
        if (animal && !helpless(shkp)) {
            const { yelp } = await import('./sounds.js');
            await yelp(shkp);
        }
    } else if (pursue || uinshp || !um_dist(x, y, 1)) {
        if (!Deaf()) {
            await verbalize(`How dare you ${dmgstr} my ${dugwall ? 'shop' : 'door'}?`);
        } else {
            await update_topl(`${Shknam(shkp)} is ${ROLL_FROM(angrytexts)
            } that you decided to ${dmgstr} ${noit_mhis(shkp)} ${
                dugwall ? 'shop' : 'door'}!`);
        }
    } else {
        if (!Deaf()) {
            await update_topl(`${Shknam(shkp)} shouts:`);
            await verbalize(`Who dared ${dmgstr} my ${dugwall ? 'shop' : 'door'}?`);
        } else {
            await update_topl(`${Shknam(shkp)} is ${ROLL_FROM(angrytexts)
            } that someone decided to ${dmgstr} ${noit_mhis(shkp)} ${
                dugwall ? 'shop' : 'door'}!`);
        }
    }
    hot_pursuit(shkp);
}

// C ref: shk.c pay_for_damage(dmgstr, cant_mollify):5174.  RNG, in order: an
// rn2(++picks) tie-break per equidistant shopkeeper during the scan, then
// rn2(50) on the "shk won't be mollified" test, then whatever getcad() or
// currency() draw.  GAP: mnexto()/mnearto() are unported, so the shk does not
// actually come to the door.
export async function pay_for_damage(dmgstr, cant_mollify) {
    let shkp = null;
    const uinshp = ((game.u?.ushops || []).length > 0);
    let appear_here = null;
    let cost_of_damage = 0;
    let nearest_shk = (ROWNO * ROWNO) + (COLNO * COLNO);
    let nearest_damage = nearest_shk;
    let picks = 0;

    for (let tmp_dam = game.level?.damagelist; tmp_dam; tmp_dam = tmp_dam.next) {
        if (tmp_dam.when !== game.moves || !tmp_dam.cost) continue;
        cost_of_damage += tmp_dam.cost;
        const shops_affected = in_rooms(tmp_dam.place.x, tmp_dam.place.y, SHOPBASE);
        for (const shp of shops_affected) {
            const tmp_shk = shop_keeper(shp);
            if (!tmp_shk) continue;
            if (tmp_shk === shkp) {
                const damage_distance = distu(tmp_dam.place.x, tmp_dam.place.y);
                if (damage_distance < nearest_damage) {
                    nearest_damage = damage_distance;
                    appear_here = tmp_dam;
                }
                continue;
            }
            if (!inhishop(tmp_shk)) continue;
            const shk_distance = mdistu(tmp_shk);
            if (shk_distance > nearest_shk) continue;
            if ((shk_distance === nearest_shk) && picks) {
                if (rn2(++picks)) continue;
            } else {
                picks = 1;
            }
            shkp = tmp_shk;
            nearest_shk = shk_distance;
            appear_here = tmp_dam;
            nearest_damage = distu(tmp_dam.place.x, tmp_dam.place.y);
        }
    }

    if (!cost_of_damage || !shkp) return;

    const animal = ((msound_of(shkp.data) ?? 99) <= MS_ANIMAL);
    let pursue = false;
    const x = appear_here.place.x, y = appear_here.place.y;

    /* not the best introduction to the shk... */
    shkp.eshk.customer = game.plname;

    /* if the shk is already on the war path, be sure it's all out */
    if (ANGRY(shkp) || shkp.eshk.following) {
        hot_pursuit(shkp);
        return;
    }

    const { cansee } = await import('./vision.js');
    /* if the shk is not in their shop.. */
    if (!in_rooms(shkp.mx, shkp.my, SHOPBASE).length) {
        if (!cansee(shkp.mx, shkp.my)) return;
        pursue = true;
        await getcad(shkp, dmgstr, x, y, uinshp, animal, pursue);
        return;
    }

    if (uinshp) {
        if (um_dist(shkp.mx, shkp.my, 1) && !um_dist(shkp.mx, shkp.my, 3)) {
            await update_topl(`${Shknam(shkp)} leaps towards you!`);
            /* GAP: mnexto(shkp, RLOC_NOMSG) */
        }
        pursue = um_dist(shkp.mx, shkp.my, 1);
        if (pursue) {
            await getcad(shkp, dmgstr, x, y, uinshp, animal, pursue);
            return;
        }
    } else {
        /* make the shk show up at the door */
        if (m_at(x, y)) {
            if (!animal) {
                if (!Deaf() && !muteshk(shkp)) {
                    await update_topl('You hear an angry voice:');
                    await verbalize('Out of my way, scum!');
                }
            } else {
                const { growl } = await import('./sounds.js');
                await growl(shkp);
            }
        }
        /* GAP: mnearto(shkp, x, y, TRUE, RLOC_MSG) */
    }

    if ((um_dist(x, y, 1) && !uinshp) || cant_mollify
        || (money_cnt(game.invent) + (shkp.eshk.credit || 0)) < cost_of_damage
        || !rn2(50)) {
        await getcad(shkp, dmgstr, x, y, uinshp, animal, pursue);
        return;
    }

    if (Invis()) await update_topl(`Your invisibility does not fool ${shkname(shkp)}!`);
    const { y_n } = await import('./display.js');
    const qbuf = `${!animal ? cad(true) : ''}You did ${cost_of_damage} ${
        currency(cost_of_damage)} worth of damage!${!animal ? '"' : ''}  Pay?`;
    if (await y_n(qbuf) !== 'n') {
        const was_seen = await canseemon(shkp);
        const was_outside = !inhishop(shkp);
        const sx = shkp.mx, sy = shkp.my;

        cost_of_damage = await check_credit(cost_of_damage, shkp);
        if (cost_of_damage > 0) await money2mon(shkp, cost_of_damage);
        await update_topl(`Mollified, ${shkname(shkp)} accepts your restitution.`);
        /* move the shk back to her home loc */
        await home_shk(shkp, false);
        pacify_shk(shkp, false);
        /* home_shk() suppresses rloc()'s vanish/appear messages */
        if (shkp.mx !== sx || shkp.my !== sy) {
            const { canspotmon } = await import('./uhitm.js');
            const is_seen = await canseemon(shkp);
            if (was_outside && canspotmon(shkp))
                await update_topl(`${Shknam(shkp)} returns to ${noit_mhis(shkp)} shop.`);
            else if (is_seen || was_seen)
                await update_topl(`${Shknam(shkp)} ${
                    !was_seen ? 'appears' : is_seen ? 'shifts location' : 'disappears'
                }.`);
        }
    } else {
        if (!animal) {
            if (!Deaf() && !muteshk(shkp)) {
                await verbalize("Oh, yes!  You'll pay!");
            } else {
                await update_topl(`${Shknam(shkp)} lunges ${noit_mhis(shkp)} ${
                    await mbodypart_(shkp, HAND)} toward your ${body_part(NECK)}!`);
            }
        } else {
            const { growl } = await import('./sounds.js');
            await growl(shkp);
        }
        hot_pursuit(shkp);
        adjalign(-sgn(game.u?.ualign?.type || 0));
    }
}

// C ref: shk.c costly_adjacent(shkp, x, y):5369 — <x,y> is on the shop's wall
// ring (door included) or is the "free spot" one step inside the door, so an
// unpaid/no_charge flag there is still valid even though costly_spot() is false.
export function costly_adjacent(shkp, x, y) {
    if (!shkp || !inhishop(shkp) || !isok(x, y)) return false;
    const eshkp = shkp.eshk;
    return !!game.level?.at(x, y)?.edge
        || (x === eshkp.shk?.x && y === eshkp.shk?.y);
}

// C ref: shk.c shop_object(x, y):5386 — the goods #chat quotes a price for.
export function shop_object(x, y) {
    const shkp = shop_keeper(in_rooms(x, y, SHOPBASE)[0]);
    if (!shkp || !inhishop(shkp)) return null;

    let otmp = null;
    for (const o of objects_at(x, y))
        if (o.oclass !== COIN_CLASS) { otmp = o; break; }
    /* otmp might have no_charge set, but that's ok */
    return (otmp && costly_spot(x, y) && NOTANGRY(shkp) && !muteshk(shkp))
        ? otmp : null;
}

// C ref: shk.c price_quote(first_obj):5406 — quote every item on this spot.
// RNG: shk_embellish()'s rn2(3)/rn2(5), but ONLY on the single-item priced arm.
export async function price_quote(first_obj) {
    let cost = 0;
    let cnt = 0;
    let contentsonly = false;
    let buf = '';

    const shkp = shop_keeper(inside_shop(game.u.ux, game.u.uy));
    if (!shkp || !inhishop(shkp)) return;

    const tmpwin = create_nhwindow(NHW_MENU);
    putstr(tmpwin, 0, 'Fine goods for sale:');
    putstr(tmpwin, 0, '');
    /* C walks obj->nexthere from first_obj; this port's floor pile is an array */
    const pile = objects_at(first_obj.ox, first_obj.oy);
    const start = Math.max(0, pile.indexOf(first_obj));
    for (let i = start; i < pile.length; i++) {
        const otmp = pile[i];
        if (otmp.oclass === COIN_CLASS) continue;
        cost = (otmp.no_charge || otmp === game.u?.uball || otmp === game.u?.uchain)
            ? 0 : get_cost(otmp, shkp);
        contentsonly = !cost;
        if (Has_contents(otmp)) cost += contained_cost(otmp, shkp, 0, false, false);
        if (otmp.globby) cost *= get_pricing_units(otmp);
        let price;
        if (!cost) {
            price = 'no charge';
            contentsonly = false;
        } else {
            price = `${cost} ${currency(cost)}${(otmp.quan > 1) ? ' each' : ''}`;
        }
        buf = `${contentsonly ? the_contents_of : ''}${doname_invent(otmp)}, ${price}`;
        putstr(tmpwin, 0, buf);
        cnt++;
    }
    if (cnt > 1) {
        display_nhwindow(tmpwin, true);
    } else if (cnt === 1) {
        if (!cost) {
            await verbalize(`${upstart(buf)}!`);
        } else {
            buf = `${contentsonly ? the_contents_of : ''}${doname_invent(first_obj)}`;
            await verbalize(`${upstart(buf)}, price ${cost} ${currency(cost)}${
                (first_obj.quan > 1) ? ' each' : ''}${
                contentsonly ? '.' : shk_embellish(first_obj, cost)}`);
        }
    }
    destroy_nhwindow(tmpwin);
}

// C ref: shk.c shk_embellish(itm, cost):5468 — the sales pitch.  RNG: rn2(3),
// and rn2(5) only when that first draw is 0.  Both are spent even when the
// chosen case falls through to the plain ".".
export function shk_embellish(itm, cost) {
    if (!rn2(3)) {
        let o, choice = rn2(5);

        if (choice === 0)
            choice = (cost < 100 ? 1 : cost < 500 ? 2 : 3);
        switch (choice) {
        case 4:
            if (cost < 10) break;
            else o = itm.oclass;
            if (o === FOOD_CLASS) return ", gourmets' delight!";
            if (objects[itm.otyp]?.oc_name_known
                ? objects[itm.otyp]?.oc_magic
                : (o === AMULET_CLASS || o === RING_CLASS || o === WAND_CLASS
                   || o === POTION_CLASS || o === SCROLL_CLASS
                   || o === SPBOOK_CLASS))
                return ', painstakingly developed!';
            return ', superb craftsmanship!';
        case 3:
            return ', finest quality.';
        case 2:
            return ', an excellent choice.';
        case 1:
            return ', a real bargain.';
        default:
            break;
        }
    } else if (itm.oartifact) {
        return ', one of a kind!';
    }
    return '.';
}

// C ref: shk.c shk_chat(shkp):5521 — #chat with a shopkeeper.  RNG: exactly one
// ROLL_FROM(Izchak_speaks) == rn2(9), and only on the Izchak arm.
export async function shk_chat(shkp) {
    if (!shkp.isshk) {
        /* a wished-for shopkeeper statue that got animated */
        const { Monnam } = await import('./do_name.js');
        await update_topl(`${Monnam(shkp)
        } asks whether you've seen any untended shops recently.`);
        return;
    }

    const eshk = shkp.eshk;
    let shkmoney;
    if (ANGRY(shkp)) {
        await update_topl(`${Shknam(shkp)} ${
            (!Deaf() && !muteshk(shkp)) ? 'mentions' : 'indicates'
        } how much ${noit_mhe(shkp)} dislikes ${
            eshk.robbed ? 'non-paying' : 'rude'} customers.`);
    } else if (eshk.following) {
        if (strncmp(eshk.customer, game.plname, PL_NSIZ)) {
            if (!Deaf() && !muteshk(shkp))
                await verbalize(`Hello ${game.plname}!  I was looking for ${
                    eshk.customer}.`);
            eshk.following = 0;
        } else {
            if (!Deaf() && !muteshk(shkp)) {
                await verbalize(`Hello ${game.plname}!  Didn't you forget to pay?`);
            } else {
                await update_topl(`${Shknam(shkp)} taps you on the ${body_part(ARM)}.`);
            }
        }
    } else if (eshk.billct) {
        const total = addupbill(shkp) + (eshk.debit || 0);
        await update_topl(`${Shknam(shkp)} ${
            (!Deaf() && !muteshk(shkp)) ? 'says' : 'indicates'
        } that your bill comes to ${total} ${currency(total)}.`);
    } else if (eshk.debit) {
        await update_topl(`${Shknam(shkp)} ${
            (!Deaf() && !muteshk(shkp)) ? 'reminds you' : 'indicates'
        } that you owe ${noit_mhim(shkp)} ${eshk.debit} ${currency(eshk.debit)}.`);
    } else if (eshk.credit) {
        await update_topl(`${Shknam(shkp)} encourages you to use your ${
            eshk.credit} ${currency(eshk.credit)} of credit.`);
    } else if (eshk.robbed) {
        await update_topl(`${Shknam(shkp)} ${
            (!Deaf() && !muteshk(shkp)) ? 'complains' : 'indicates concern'
        } about a recent robbery.`);
    } else if (eshk.surcharge) {
        await update_topl(`${Shknam(shkp)} ${
            (!Deaf() && !muteshk(shkp)) ? 'warns you' : 'indicates'
        } that ${noit_mhe(shkp)} is watching you carefully.`);
    } else if ((shkmoney = money_cnt(shkp.minvent)) < 50) {
        await update_topl(`${Shknam(shkp)} ${
            (!Deaf() && !muteshk(shkp)) ? 'complains' : 'indicates'
        } that business is bad.`);
    } else if (shkmoney > 4000) {
        await update_topl(`${Shknam(shkp)} ${
            (!Deaf() && !muteshk(shkp)) ? 'says' : 'indicates'
        } that business is good.`);
    } else if (await is_izchak(shkp, false)) {
        if (!Deaf() && !muteshk(shkp))
            await update_topl(ROLL_FROM(Izchak_speaks).replace('%s', shkname(shkp)));
    } else {
        if (!Deaf() && !muteshk(shkp))
            await update_topl(`${Shknam(shkp)} talks about the problem of shoplifters.`);
    }
}

// C ref: shk.c kops_gone(silent):5606 — the Kops give up.  GAP: mongone() is
// module-private in js/muse.js and js/vault.js, so the Kops are only counted
// here, not removed.  defsym.h S_KOP == 37.
const S_KOP = 37;
export async function kops_gone(silent) {
    let cnt = 0;

    const { canspotmon } = await import('./uhitm.js');
    for (const mtmp of fmon().slice()) {
        if (DEADMONSTER(mtmp)) continue;
        if (mtmp.data?.mcls === S_KOP) {
            if (canspotmon(mtmp)) cnt++;
            /* GAP: mongone(mtmp) */
        }
    }
    if (cnt && !silent)
        await update_topl(`The Kop${plur(cnt)} (disappointed) vanish${
            (cnt === 1) ? 'es' : ''} into thin air.`);
}

// C ref: shk.c cost_per_charge(shkp, otmp, altusage):5627 — the fee for using
// one charge of unpaid merchandise; exhaustive use costs more than buying it.
export function cost_per_charge(shkp, otmp, altusage) {
    let tmp = 0;

    if (!shkp || !inhishop(shkp)) return 0; /* insurance */
    tmp = get_cost(otmp, shkp);

    if (otmp.otyp === MAGIC_LAMP) {                 /* 1 */
        if (!altusage) tmp = base_oc_cost(OIL_LAMP);
        else tmp += Math.trunc(tmp / 3);            /* djinni being released */
    } else if (otmp.otyp === MAGIC_MARKER) {        /* 70 - 100 */
        tmp = Math.trunc(tmp / 2);
    } else if (otmp.otyp === BAG_OF_TRICKS          /* 1 - 20 */
               || otmp.otyp === HORN_OF_PLENTY) {
        if (!altusage) tmp = Math.trunc(tmp / 5);
    } else if (otmp.otyp === CRYSTAL_BALL           /* 1 - 5 */
               || otmp.otyp === OIL_LAMP            /* 1 - 10 */
               || otmp.otyp === BRASS_LANTERN
               || (otmp.otyp >= MAGIC_FLUTE
                   && otmp.otyp <= DRUM_OF_EARTHQUAKE) /* 5 - 9 */
               || otmp.oclass === WAND_CLASS) {        /* 3 - 11 */
        if (otmp.spe > 1) tmp = Math.trunc(tmp / 4);
    } else if (otmp.oclass === SPBOOK_CLASS) {
        tmp -= Math.trunc(tmp / 5);
    } else if (otmp.otyp === CAN_OF_GREASE || otmp.otyp === TINNING_KIT
               || otmp.otyp === EXPENSIVE_CAMERA) {
        tmp = Math.trunc(tmp / 10);
    } else if (otmp.otyp === POT_OIL) {
        tmp = Math.trunc(tmp / 5);
    }
    return tmp;
}

// C ref: shk.c check_unpaid_usage(otmp, altusage):5688 — the usage fee line.
// RNG, in order: the SPBOOK arm draws ONE rn2(2); the bag/horn and default arms
// draw TWO rn2(3)s each, and BOTH are always drawn (the second overwrites the
// first's decision).  Those draws happen before the Deaf test, so they are
// spent even when nothing is said.
export async function check_unpaid_usage(otmp, altusage) {
    if (!otmp.unpaid || !(game.u?.ushops || []).length
        || (otmp.spe <= 0 && objects[otmp.otyp]?.oc_charged))
        return;
    const shkp = shop_keeper((game.u.ushops)[0]);
    if (!shkp || !inhishop(shkp)) return;
    const tmp = cost_per_charge(shkp, otmp, altusage);
    if (tmp === 0) return;

    let fmt, arg1 = '', arg2 = '';
    if (otmp.oclass === SPBOOK_CLASS) {
        fmt = '%sYou owe%s %ld %s.';
        const buf = `This is no free library, ${cad(false)}!  `;
        arg1 = rn2(2) ? buf : '';
        arg2 = (shkp.eshk.debit || 0) > 0 ? ' an additional' : '';
    } else if (otmp.otyp === POT_OIL) {
        fmt = '%s%sThat will cost you %ld %s (Yendorian Fuel Tax).';
    } else if (altusage && (otmp.otyp === BAG_OF_TRICKS
                            || otmp.otyp === HORN_OF_PLENTY)) {
        fmt = '%s%sEmptying that will cost you %ld %s.';
        if (!rn2(3)) arg1 = 'Whoa!  ';
        if (!rn2(3)) arg1 = 'Watch it!  ';
    } else {
        fmt = '%s%sUsage fee, %ld %s.';
        if (!rn2(3)) arg1 = 'Hey!  ';
        if (!rn2(3)) arg2 = 'Ahem.  ';
    }

    if (!Deaf() && !muteshk(shkp)) {
        await verbalize(fmt.replace('%s', arg1).replace('%s', arg2)
            .replace('%ld', String(tmp)).replace('%s', currency(tmp)));
        exercise(A_WIS, true); /* you just got info */
    }
    shkp.eshk.debit = (shkp.eshk.debit || 0) + tmp;
}

// C ref: shk.c costly_gold(x, y, amount, silent):5745 — the hero picked up the
// shop's own gold.
export async function costly_gold(x, y, amount, silent) {
    if (!costly_spot(x, y)) return;
    const shkp = shop_keeper(in_rooms(x, y, SHOPBASE)[0]);
    if (!shkp) return;

    const eshkp = shkp.eshk;
    if ((eshkp.credit || 0) >= amount) {
        if (!silent) {
            if (eshkp.credit > amount)
                await update_topl(`Your credit is reduced by ${amount} ${currency(amount)}.`);
            else
                await update_topl('Your credit is erased.');
        }
        eshkp.credit -= amount;
    } else {
        const delta = amount - (eshkp.credit || 0);
        if (!silent) {
            if (eshkp.credit) await update_topl('Your credit is erased.');
            if (eshkp.debit)
                await update_topl(`Your debt increases by ${delta} ${currency(delta)}.`);
            else
                await update_topl(`You owe ${shkname(shkp)} ${delta} ${currency(delta)}.`);
        }
        eshkp.debit = (eshkp.debit || 0) + delta;
        eshkp.loan = (eshkp.loan || 0) + delta;
        eshkp.credit = 0;
    }
}

// C ref: shk.c block_door(x, y):5791 — the shk stands in her doorway to stop a
// diagonal exit.  <x,y> is always a door.
// C's `IS_SHOP(roomno)` here indexes svr.rooms[] with an UNADJUSTED roomno (the
// ROOMOFFSET is not subtracted, unlike clear_no_charge_obj()'s use of the same
// macro).  Reproduced as-is: "fixing" it would change which room is tested.
export async function block_door(x, y) {
    const roomno = in_rooms(x, y, SHOPBASE)[0] ?? 0;

    if (roomno < 0 || !IS_SHOP(roomno)) return false;
    if (!IS_DOOR(game.level?.at(x, y)?.typ ?? 0)) return false;
    if (roomno !== (game.u?.ushops || [])[0]) return false;

    const shkp = shop_keeper(roomno);
    if (!shkp || !inhishop(shkp)) return false;

    const eshkp = shkp.eshk;
    if (shkp.mx === eshkp.shk?.x && shkp.my === eshkp.shk?.y
        && eshkp.shd?.x === x && eshkp.shd?.y === y
        && !helpless(shkp)
        && (eshkp.debit || eshkp.billct || eshkp.robbed)) {
        await update_topl(`${Shknam(shkp)}${
            Invis() ? ' senses your motion and' : ''} blocks your way!`);
        return true;
    }
    return false;
}

// C ref: shk.c block_entry(x, y):5826 — the shk blocks a diagonal entry through
// a broken door.  u.ux,u.uy is always the door.
export async function block_entry(x, y) {
    const u = game.u;
    const uloc = game.level?.at(u.ux, u.uy);
    if (!(IS_DOOR(uloc?.typ ?? 0) && (uloc?.doormask || 0) === D_BROKEN))
        return false;

    const roomno = in_rooms(x, y, SHOPBASE)[0] ?? 0;
    if (roomno < 0 || !IS_SHOP(roomno)) return false; /* see block_door() */
    const shkp = shop_keeper(roomno);
    if (!shkp || !inhishop(shkp)) return false;

    const eshkp = shkp.eshk;
    if (eshkp.shd?.x !== u.ux || eshkp.shd?.y !== u.uy) return false;

    const sx = eshkp.shk.x, sy = eshkp.shk.y;

    if (shkp.mx === sx && shkp.my === sy && !helpless(shkp)
        && (x === sx - 1 || x === sx + 1 || y === sy - 1 || y === sy + 1)
        && (Invis() || carrying(PICK_AXE) || carrying(DWARVISH_MATTOCK)
            || u.usteed)) {
        await update_topl(`${Shknam(shkp)}${
            Invis() ? ' senses your motion and' : ''} blocks your way!`);
        return true;
    }
    return false;
}

// C ref: shk.c shk_owns(buf, obj):5885 — "Foobar's " when the shop owns obj.
// Returns null when it doesn't, which is what makes shk_your() fall through to
// mon_owns() and then "your"/"the".
export function shk_owns(obj) {
    const loc = obj_location(obj);
    if (loc.ok
        && (obj.unpaid || (obj.where === OBJ_FLOOR && !obj.no_charge
                           && costly_spot(loc.x, loc.y)))) {
        const shkp = shop_keeper(inside_shop(loc.x, loc.y));
        return shkp ? s_suffix(shkname(shkp)) : 'the';
    }
    return null;
}

// C ref: shk.c mon_owns(buf, obj):5900.
export async function mon_owns(obj) {
    if (obj.where === OBJ_MINVENT) {
        const { y_monnam } = await import('./do_name.js');
        return s_suffix(y_monnam(obj.ocarry));
    }
    return null;
}

// C ref: shk.c cad(altusage):5908 — how the shk addresses the hero.  No RNG.
export function cad(altusage) {
    let res;

    switch (is_demon(game.u?.Upolyd ? game.u.data : null) ? 3 : poly_gender()) {
    case 0: res = 'cad'; break;
    case 1: res = 'minx'; break;
    case 2: res = 'beast'; break;
    case 3: res = 'fiend'; break;
    default: res = 'thing'; break; /* C: impossible("cad: unknown gender") */
    }
    if (altusage) {
        /* a leading double quote plus a trailing "!  " */
        res = `"${res.charAt(0).toUpperCase()}${res.slice(1)}!  `;
    }
    return res;
}

// C ref: shk.c sasc_bug(op, x):5945 — an #ifdef __SASC compiler workaround.
export function sasc_bug(op, x) {
    op.unpaid = x;
}

// C ref: shk.c globby_bill_fixup(obj_absorber, obj_absorbed):5976 — one glob
// merged into another; the billing has to follow.  No RNG.
export async function globby_bill_fixup(obj_absorber, obj_absorbed) {
    let x = 0, y = 0;
    let shkp = null;
    let amount;
    const floor_absorber = (obj_absorber.where === OBJ_FLOOR);

    /* C impossible()s on a non-globby absorber and keeps going */
    if (floor_absorber) { x = obj_absorber.ox; y = obj_absorber.oy; }

    if (obj_absorber.unpaid) {
        for (shkp = next_shkp(fmon()[0], true); shkp;
             shkp = next_shkp(nmon(shkp), true))
            if (onbill(obj_absorber, shkp)) break;
    } else if (obj_absorbed.unpaid) {
        if (obj_absorbed.where === OBJ_FREE && floor_absorber && costly_spot(x, y))
            shkp = shop_keeper(in_rooms(x, y, SHOPBASE)[0]);
    }
    /* sanity check, in case obj is on bill but not marked 'unpaid' */
    if (!shkp) shkp = shop_keeper((game.u?.ushops || [])[0]);
    if (!shkp) return;
    const bp_absorber = onbill(obj_absorber, shkp);
    const bp = onbill(obj_absorbed, shkp);
    const eshkp = shkp.eshk;
    const per_unit_cost = set_cost(obj_absorbed, shkp);

    /* 1. shop-owned glob absorbing into shop-owned glob */
    if (bp && (!obj_absorber.no_charge
               || billable(shkp, obj_absorber, eshkp.shoproom, false))) {
        amount = bp.price;
        eshkp.billct--;
        eshkp.bill[eshkp.bill.indexOf(bp)] = eshkp.bill[eshkp.billct];
        clear_unpaid_obj(shkp, obj_absorbed);

        if (bp_absorber) bp_absorber.price += amount;
        return;
    }
    /* 2. player-owned glob absorbing into shop-owned glob */
    if (!bp_absorber && !bp && !obj_absorber.no_charge) {
        amount = get_pricing_units(obj_absorbed) * per_unit_cost;
        if (saleable(shkp, obj_absorbed)) {
            /* C: obj_typename(otyp); no port in this tree, xname() stands in */
            const tname = xname(obj_absorbed);
            if ((eshkp.debit || 0) >= amount) {
                if (eshkp.loan) { /* you carry shop's gold */
                    if (eshkp.loan >= amount) eshkp.loan -= amount;
                    else eshkp.loan = 0;
                }
                eshkp.debit -= amount;
                await update_topl(`The donated ${tname} ${
                    eshkp.debit ? 'partially ' : ''}pays off your debt.`);
            } else {
                const delta = amount - (eshkp.debit || 0);

                eshkp.credit = (eshkp.credit || 0) + delta;
                if (eshkp.debit) {
                    eshkp.debit = 0;
                    eshkp.loan = 0;
                    await update_topl('Your debt is paid off.');
                }
                if (eshkp.credit === delta)
                    await update_topl(`The ${tname} established ${delta} ${
                        currency(delta)} credit.`);
                else
                    await update_topl(`The ${tname} added ${delta} ${currency(delta)
                    } to your credit; total is now ${eshkp.credit} ${
                        currency(eshkp.credit)}.`);
            }
        }
        return;
    } else if (bp_absorber) {
        bp_absorber.price += per_unit_cost * get_pricing_units(obj_absorbed);
        return;
    }
    /* 3. shop-owned glob merging into player-owned glob */
    if (bp && (obj_absorber.no_charge
               || (floor_absorber && !costly_spot(x, y)))) {
        amount = bp.price;
        await bill_dummy_object(obj_absorbed);
        const tname = xname(obj_absorbed);
        await verbalize(`You owe me ${amount} ${currency(amount)} for my ${tname
        } that you ${ANGRY(shkp) ? 'had the audacity to mix' : 'just mixed'
        } with your${ANGRY(shkp) ? ' stinking batch!' : 's.'}`);
        return;
    }
    /* 4. player-owned glob merging into player-owned glob: nothing to do */
}

// C ref: shk.c use_unpaid_trapobj(otmp, x, y):6101 — setting a shop-owned land
// mine or bear trap buys it outright.
export async function use_unpaid_trapobj(otmp, x, y) {
    if (otmp.unpaid) {
        if (!Deaf()) {
            /* GAP: find_objowner(otmp, x, y) is private in js/dokick.js, so the
               shared-wall case picks the room's first shk instead. */
            const shkp = shop_keeper(in_rooms(x, y, SHOPBASE)[0]);
            if (shkp && !muteshk(shkp)) await verbalize('You set it, you buy it!');
        }
        await bill_dummy_object(otmp);
    }
}
