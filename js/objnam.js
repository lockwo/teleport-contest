// objnam.js — object-name parsing helpers for wishing.
//
// C ref: src/objnam.c.  This module ports the random-object-by-name/
// description selection used when granting a wish (readobjnam ->
// rnd_otyp_by_namedesc) plus the supporting fuzzy string matching
// (wishymatch / fuzzymatch) and the wishable name tables (o_ranges,
// alt-spellings).  The single RNG draw lives in rnd_otyp_by_namedesc:
//
//     rn2(maxprob) @ rnd_otyp_by_namedesc(objnam.c:3522)
//
// rendered exactly as the C source emits it.  Matching itself consumes no
// RNG; it only determines the candidate set (n / maxprob) and ordering,
// which in turn fixes the object that the single rn2() resolves to.

import { rn2 } from './rng.js';
import { game } from './gstate.js';
import {
    objects,
    MAXOCLASSES,
    STRANGE_OBJECT,
    BELL_OF_OPENING,
    GLOB_OF_GRAY_OOZE,
    GLOB_OF_BLACK_PUDDING,
    WEAPON_CLASS,
} from './mkobj.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
import { shop_price_suffix } from './shk.js';

// Additional imports used only by the objnam.c naming core appended at the end
// of this file.  Each of these six modules is outside the pre-existing
// objnam <-> shk <-> invent <-> artifact import cycle (verified: none of them
// reaches objnam.js, artifact.js, invent.js or shk.js), so the edges add no new
// cycle and cannot reorder that cycle's evaluation.
import {
    GemStone,
    base_oc_weight,
    AMULET_CLASS, ARMOR_CLASS, RING_CLASS, TOOL_CLASS, FOOD_CLASS,
    POTION_CLASS, SCROLL_CLASS, SPBOOK_CLASS, WAND_CLASS, COIN_CLASS,
    GEM_CLASS, ROCK_CLASS, BALL_CLASS, CHAIN_CLASS, VENOM_CLASS,
    GOLD_PIECE,
} from './mkobj.js';
import { OBJ_ARMCAT } from './objarmor_data.js';
import { OBJ_COST } from './objcost_data.js';
import { MFLAGS2, M2_PNAME } from './monflags_data.js';
import { monster_by_pmidx } from './makemon.js';
import { Blind } from './vision.js';
import { observe_object } from './o_init.js';
import { obj_pmname } from './do_name.js';
import {
    is_unpaid, unpaid_cost, get_cost_of_shop_item, COST_CONTENTS,
} from './shk.js';

const NUM_OBJECTS = objects.length;

// ─────────────────────────────────────────────────────────────────────────
// Object name / description / user-name accessors.
//
// C: OBJ_NAME(obj) = obj_descr[obj.oc_name_idx].oc_name
//    OBJ_DESCR(obj) = obj_descr[obj.oc_descr_idx].oc_descr
//    objects[i].oc_uname = player's call-name for that type
//
// In the JS port the canonical (never-shuffled) object name lives directly on
// objects[i].name.  The appearance text is keyed by the shuffled oc_descr_idx,
// matching C's obj_descr[objects[i].oc_descr_idx].oc_descr.
// ─────────────────────────────────────────────────────────────────────────
function OBJ_NAME(obj) {
    return obj && obj.name ? obj.name : null;
}
function OBJ_DESCR(obj) {
    if (!obj) return null;
    const idx = obj.oc_descr_idx != null ? obj.oc_descr_idx : obj.otyp;
    return DESCR_BY_OTYP[idx] ?? null;
}
function OBJ_UNAME(obj) {
    return obj && obj.oc_uname != null ? obj.oc_uname : null;
}

// ─────────────────────────────────────────────────────────────────────────
// String helpers (C ref: hacklib.c).  Self-contained so this module has no
// dependency on un-exported helpers elsewhere.
// ─────────────────────────────────────────────────────────────────────────

// lowc(): lower-case a single char (ASCII).  C ref: hacklib.c lowc().
function lowc(c) {
    return c >= 'A' && c <= 'Z' ? c.toLowerCase() : c;
}

// fuzzymatch(): compare two strings for equality, skipping any characters in
// ignore_chars (typically " -") and optionally case-blind.  Matches the C
// control flow exactly: each pass consumes one non-ignored char from each
// side, and a match requires both sides to reach their terminating NUL on the
// same pass.  C ref: hacklib.c fuzzymatch().
function fuzzymatch(s1, s2, ignore_chars, caseblind) {
    let i = 0, j = 0;
    const n1 = s1.length, n2 = s2.length;
    let c1, c2;
    do {
        // while ((c1 = *s1++) && strchr(ignore,c1)) continue;
        do {
            c1 = i < n1 ? s1[i++] : '\0';
        } while (c1 !== '\0' && ignore_chars.indexOf(c1) >= 0);
        do {
            c2 = j < n2 ? s2[j++] : '\0';
        } while (c2 !== '\0' && ignore_chars.indexOf(c2) >= 0);
        if (c1 === '\0' || c2 === '\0')
            break;
        if (caseblind) {
            c1 = lowc(c1);
            c2 = lowc(c2);
        }
    } while (c1 === c2);
    return c1 === '\0' && c2 === '\0';
}

// strstri(): case-insensitive substring search; returns the JS index of the
// first occurrence of needle in haystack, or -1.  C returns a pointer; here
// the index suffices and -1 means "not found".  C ref: hacklib.c strstri().
function strstri(haystack, needle) {
    if (haystack == null || needle == null) return -1;
    return haystack.toLowerCase().indexOf(needle.toLowerCase());
}

// strncmp / strncmpi over the first n chars.
function strncmp(a, b, n) {
    return a.slice(0, n) === b.slice(0, n);
}
function strncmpi(a, b, n) {
    return a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();
}
function strcmpi(a, b) {
    return a.toLowerCase() === b.toLowerCase();
}

// strsubst(): replace first occurrence of orig with replacement.  C ref:
// hacklib.c strsubst().
function strsubst(s, orig, replacement) {
    const idx = strstri(s, orig);
    if (idx < 0) return s;
    return s.slice(0, idx) + replacement + s.slice(idx + orig.length);
}

// makesingular(): minimal English de-pluralization sufficient for the
// wishymatch "detect <foo>" / "abilities" special cases.  Full makesingular
// lives in objnam.c; this covers the trailing-'s' cases those branches need.
export function makesingular(s) {
    if (s == null) return s;
    if (s.endsWith('ies')) return s.slice(0, -3) + 'y';
    if (s.endsWith('s')) return s.slice(0, -1);
    return s;
}

// C ref: objnam.c fruitname() — name the player's current fruit, optionally
// appending " juice".  svp.pl_fruit defaults to "slime molds"; a custom fruit
// "<x> of <y>" uses the part after " of ".  No public session sets a custom
// fruit, so the default singular ("slime mold") drives "slime mold juice".
export function fruitname(juice) {
    const pl_fruit = game.svp?.pl_fruit || game.pl_fruit || 'slime molds';
    const idx = pl_fruit.indexOf(' of ');
    const fruit_nam = idx >= 0 ? pl_fruit.slice(idx + 4) : pl_fruit;
    return makesingular(fruit_nam) + (juice ? ' juice' : '');
}

// ─────────────────────────────────────────────────────────────────────────
// wishymatch(): does a user-supplied object name match a canonical object
// name/description?  C ref: objnam.c:3243 wishymatch().
//
//   u_str           — from the user (possibly a variant spelling)
//   o_str           — from objects[] (canonical form)
//   retry_inverted  — also try "foo of bar" <-> "bar foo" conversions
// ─────────────────────────────────────────────────────────────────────────
function wishymatch(u_str, o_str, retry_inverted) {
    const detect_SP = 'detect ';
    const SP_detection = ' detection';

    // ignore spaces & hyphens and upper/lower case when comparing
    if (fuzzymatch(u_str, o_str, ' -', true))
        return true;

    if (retry_inverted) {
        // when just one string is "foo of bar", convert it to "bar foo"
        const u_of = strstri(u_str, ' of ');
        const o_of = strstri(o_str, ' of ');
        if (u_of >= 0 && o_of < 0) {
            const buf = u_str.slice(u_of + 4) + ' ' + u_str.slice(0, u_of);
            if (fuzzymatch(buf, o_str, ' -', true))
                return true;
        } else if (o_of >= 0 && u_of < 0) {
            const buf = o_str.slice(o_of + 4) + ' ' + o_str.slice(0, o_of);
            if (fuzzymatch(u_str, buf, ' -', true))
                return true;
        }
    }

    // special cases (note: any " wand" suffix has already been stripped)
    if (strncmp(o_str, 'dwarvish ', 9)) {
        if (strncmpi(u_str, 'dwarven ', 8))
            return fuzzymatch(u_str.slice(8), o_str.slice(9), ' -', true);
    } else if (strncmp(o_str, 'elven ', 6)) {
        if (strncmpi(u_str, 'elvish ', 7))
            return fuzzymatch(u_str.slice(7), o_str.slice(6), ' -', true);
        else if (strncmpi(u_str, 'elfin ', 6))
            return fuzzymatch(u_str.slice(6), o_str.slice(6), ' -', true);
    } else if (strstri(o_str, 'helm') >= 0 && strstri(u_str, 'helmet') >= 0) {
        const buf = strsubst(u_str, 'helmet', 'helm');
        return wishymatch(buf, o_str, true);
    } else if (strstri(o_str, 'gauntlets') >= 0 && strstri(u_str, 'gloves') >= 0) {
        const buf = strsubst(u_str, 'gloves', 'gauntlets');
        return wishymatch(buf, o_str, true);
    } else if (strncmp(o_str, detect_SP, detect_SP.length)) {
        // "detect <foo>" vs "<foo> detection"
        const p = strstri(u_str, SP_detection);
        if (p >= 0 && p + SP_detection.length === u_str.length) {
            let inner = u_str.slice(0, p);
            let buf = detect_SP + inner;
            if (strcmpi(inner, 'monster'))
                buf += 's';
            return fuzzymatch(buf, o_str, ' -', true);
        }
    } else if (strstri(o_str, SP_detection) >= 0) {
        // inverse: "<foo> detection" vs "detect <foo>"
        if (strncmpi(u_str, detect_SP, detect_SP.length)) {
            const p = makesingular(u_str.slice(detect_SP.length));
            const buf = p + SP_detection;
            return fuzzymatch(buf, o_str, ' -', true);
        }
    } else if (strstri(o_str, 'ability') >= 0) {
        // "{potion(s),ring} of {gain,restore,sustain} abilities"
        const p = strstri(u_str, 'abilities');
        if (p >= 0 && p + 'abilities'.length === u_str.length) {
            const buf = u_str.slice(0, p) + 'ability';
            return fuzzymatch(buf, o_str, ' -', true);
        }
    } else if (o_str === 'aluminum') {
        if (strcmpi(u_str, 'aluminium'))
            return fuzzymatch(u_str.slice(9), o_str.slice(8), ' -', true);
    }

    return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Wishable subranges of objects.  C ref: objnam.c o_ranges[].
// (Kept for the readobjnam port to consume; otyp numbers match objects[].)
// ─────────────────────────────────────────────────────────────────────────
export const o_ranges = [
    // name, oclass, f_o_range, l_o_range
    ['bag', 6 /*TOOL_CLASS*/, 217 /*SACK*/, 220 /*BAG_OF_TRICKS*/],
    ['lamp', 6, 227 /*OIL_LAMP*/, 228 /*MAGIC_LAMP*/],
    ['candle', 6, 224 /*TALLOW_CANDLE*/, 225 /*WAX_CANDLE*/],
    ['horn', 6, 249 /*TOOLED_HORN*/, 252 /*HORN_OF_PLENTY*/],
    ['shield', 3 /*ARMOR_CLASS*/, 150 /*SMALL_SHIELD*/, 158 /*SHIELD_OF_REFLECTION*/],
    ['hat', 3, 92 /*FEDORA*/, 94 /*DUNCE_CAP*/],
    ['helm', 3, 89 /*ELVEN_LEATHER_HELM*/, 100 /*HELM_OF_TELEPATHY*/],
    ['gloves', 3, 159 /*LEATHER_GLOVES*/, 162 /*GAUNTLETS_OF_DEXTERITY*/],
    ['gauntlets', 3, 159, 162],
    ['boots', 3, 163 /*LOW_BOOTS*/, 172 /*LEVITATION_BOOTS*/],
    ['shoes', 3, 163, 164 /*IRON_SHOES*/],
    ['cloak', 3, 138 /*MUMMY_WRAPPING*/, 149 /*CLOAK_OF_DISPLACEMENT*/],
    ['shirt', 3, 136 /*HAWAIIAN_SHIRT*/, 137 /*T_SHIRT*/],
    ['dragon scales', 3, 111 /*GRAY_DRAGON_SCALES*/, 120 /*YELLOW_DRAGON_SCALES*/],
    ['dragon scale mail', 3, 101 /*GRAY_DRAGON_SCALE_MAIL*/, 110 /*YELLOW_DRAGON_SCALE_MAIL*/],
    ['sword', 2 /*WEAPON_CLASS*/, 46 /*SHORT_SWORD*/, 56 /*KATANA*/],
    ['venom', 17 /*VENOM_CLASS*/, 479 /*BLINDING_VENOM*/, 480 /*ACID_VENOM*/],
    ['gray stone', 13 /*GEM_CLASS*/, 470 /*LUCKSTONE*/, 473 /*FLINT*/],
    ['grey stone', 13, 470, 473],
];

// Alternate spellings.  C ref: objnam.c spellings[].  (otyp numbers.)
export const spellings = [
    ['pickax', 259 /*PICK_AXE*/],
    ['whip', 82 /*BULLWHIP*/],
    ['saber', 51 /*SILVER_SABER*/],
    ['silver sabre', 51],
    ['smooth shield', 158 /*SHIELD_OF_REFLECTION*/],
    ['grey dragon scale mail', 101 /*GRAY_DRAGON_SCALE_MAIL*/],
    ['grey dragon scales', 111 /*GRAY_DRAGON_SCALES*/],
    ['iron ball', 477 /*HEAVY_IRON_BALL*/],
    ['lantern', 226 /*BRASS_LANTERN*/],
    ['mattock', 71 /*DWARVISH_MATTOCK*/],
    ['amulet of poison resistance', 205 /*AMULET_VERSUS_POISON*/],
    ['amulet of protection', 210 /*AMULET_OF_GUARDING*/],
    ['amulet of telepathy', 201 /*AMULET_OF_ESP*/],
    ['helm of esp', 100 /*HELM_OF_TELEPATHY*/],
    ['gauntlets of ogre power', 161 /*GAUNTLETS_OF_POWER*/],
    ['gauntlets of giant strength', 161],
    ['elven chain mail', 127 /*ELVEN_MITHRIL_COAT*/],
    ['silver shield', 158 /*SHIELD_OF_REFLECTION*/],
    ['potion of sleep', 314 /*POT_SLEEPING*/],
    ['scroll of recharging', 342 /*SCR_CHARGING*/],
    ['recharging', 342],
    ['stone', 474 /*ROCK*/],
    ['camera', 229 /*EXPENSIVE_CAMERA*/],
    ['tee shirt', 137 /*T_SHIRT*/],
    ['can', 296 /*TIN*/],
    ['can opener', 239 /*TIN_OPENER*/],
    ['kelp', 275 /*KELP_FROND*/],
    ['eucalyptus', 276 /*EUCALYPTUS_LEAF*/],
    ['lembas', 291 /*LEMBAS_WAFER*/],
    ['tripe', 264 /*TRIPE_RATION*/],
    ['cookie', 289 /*FORTUNE_COOKIE*/],
    ['pie', 287 /*CREAM_PIE*/],
    ['huge meatball', 269 /*ENORMOUS_MEATBALL*/],
    ['huge chunk of meat', 269],
    ['marker', 242 /*MAGIC_MARKER*/],
    ['hook', 260 /*GRAPPLING_HOOK*/],
    ['grappling iron', 260],
    ['grapnel', 260],
    ['grapple', 260],
    ['protection from shape shifters', 200 /*RIN_PROTECTION_FROM_SHAPE_CHAN*/],
    ['accuracy', 176 /*RIN_INCREASE_ACCURACY*/],
    ['box', 214 /*LARGE_BOX*/],
    ['luck stone', 470 /*LUCKSTONE*/],
    ['load stone', 471 /*LOADSTONE*/],
    ['touch stone', 472 /*TOUCHSTONE*/],
    ['flintstone', 473 /*FLINT*/],
];

// ─────────────────────────────────────────────────────────────────────────
// Class bases.  C ref: objclass.h svb.bases[oclass] = first otyp of class.
// Computed once from objects[] (objects are listed in otyp order grouped by
// class, exactly as the C init_objects() relies on).
// ─────────────────────────────────────────────────────────────────────────
const bases = (() => {
    const b = new Array(MAXOCLASSES + 2).fill(0);
    let prevclass = -1;
    for (let i = 0; i < objects.length; i++) {
        const c = objects[i].oc_class;
        if (c !== prevclass) {
            b[c] = i;
            prevclass = c;
        }
    }
    b[MAXOCLASSES] = b[MAXOCLASSES + 1] = objects.length;
    // back-fill any empty class slots with the following class's base
    for (let last = MAXOCLASSES - 1; last >= 0; last--)
        if (!b[last]) b[last] = b[last + 1];
    return b;
})();

// ─────────────────────────────────────────────────────────────────────────
// rnd_otyp_by_wpnskill(): pick a random weapon of the given skill.  C ref:
// objnam.c:3432.  Requires per-object oc_skill data; the port's objects[]
// does not currently carry oc_skill, so this returns STRANGE_OBJECT (and
// consumes no RNG) until that data is available.  No recorded session reaches
// this path (it is only used for "polearm"/"hammer" wishes).
// ─────────────────────────────────────────────────────────────────────────
export function rnd_otyp_by_wpnskill(skill) {
    let n = 0;
    let otyp = STRANGE_OBJECT;
    for (let i = bases[WEAPON_CLASS];
         i < NUM_OBJECTS && objects[i].oc_class === WEAPON_CLASS; i++) {
        if (objects[i].oc_skill === skill) {
            n++;
            otyp = i;
        }
    }
    if (n > 0) {
        n = rn2(n);
        for (let i = bases[WEAPON_CLASS];
             i < NUM_OBJECTS && objects[i].oc_class === WEAPON_CLASS; i++) {
            if (objects[i].oc_skill === skill)
                if (--n < 0)
                    return i;
        }
    }
    return otyp;
}

// ─────────────────────────────────────────────────────────────────────────
// rnd_otyp_by_namedesc(): of the objects whose name / description / partial
// name / user-name fuzzy-matches `name`, pick one weighted by (oc_prob +
// xtra_prob).  C ref: objnam.c:3455.
//
//   name       — user-supplied target string
//   oclass     — restrict to this object class (0 = all classes)
//   xtra_prob  — added to each candidate's chance; non-zero also lets
//                0%-generation items be considered (wish path passes 1)
//
// The ONLY RNG draw is:  prob = rn2(maxprob)  @ objnam.c:3522
// ─────────────────────────────────────────────────────────────────────────
export function rnd_otyp_by_namedesc(name, oclass, xtra_prob) {
    if (!name || name.length === 0)
        return STRANGE_OBJECT;

    let n = 0;
    const validobjs = [];
    let maxprob = 0;

    // only skip "foo of" for "foo of bar" if target doesn't contain " of "
    const check_of = strstri(name, ' of ') < 0;
    const minglob = GLOB_OF_GRAY_OOZE;
    const maxglob = GLOB_OF_BLACK_PUDDING;

    let lo, hi;
    if (oclass) {
        lo = bases[oclass & 0xff];
        hi = bases[(oclass & 0xff) + 1] - 1;
    } else {
        lo = MAXOCLASSES; // STRANGE_OBJECT + 1
        hi = NUM_OBJECTS - 1;
    }

    for (let i = lo; i <= hi; ++i) {
        let zn = OBJ_NAME(objects[i]);
        // don't match extra descriptions (w/o a real name)
        if (zn == null)
            continue;
        let of;
        if (
            wishymatch(name, zn, true) /* objects[] name */
            // let "<bar>" match "<foo> of <bar>"
            || (check_of
                && i !== BELL_OF_OPENING
                && (i < minglob || i > maxglob)
                && (of = strstri(zn, ' of ')) >= 0
                && wishymatch(name, zn.slice(of + 4), false)) /* partial name */
            || ((zn = OBJ_DESCR(objects[i])) != null
                && wishymatch(name, zn, false)) /* objects[] description */
            || (zn != null && check_of && (of = strstri(zn, ' of ')) >= 0
                && wishymatch(name, zn.slice(of + 4), false)) /* partial descr */
            || ((zn = OBJ_UNAME(objects[i])) != null
                && wishymatch(name, zn, false)) /* user-called name */
        ) {
            validobjs[n++] = i;
            maxprob += (objects[i].oc_prob + xtra_prob);
        }
    }

    if (n > 0 && maxprob) {
        let prob = rn2(maxprob); // @ rnd_otyp_by_namedesc(objnam.c:3522)
        let i;
        for (i = 0; i < n - 1; i++)
            if ((prob -= (objects[validobjs[i]].oc_prob + xtra_prob)) < 0)
                break;
        return validobjs[i];
    }
    return STRANGE_OBJECT;
}

// shiny_obj(): random shiny object of the given class.  C ref: objnam.c:3532.
export function shiny_obj(oclass) {
    return rnd_otyp_by_namedesc('shiny', oclass, 0);
}

// Exported for callers/tests that want the matching primitives directly.
// readobjnam.js consumes these to parse a wish string without duplicating the
// hacklib string helpers.
export { wishymatch, fuzzymatch, strstri };

// ─────────────────────────────────────────────────────────────────────────
// doname_base() shop-price suffix.
//
// C ref: objnam.c doname_base():1648-1682 — the last thing doname_base()
// appends before the article fixup:
//
//     is_unpaid(obj)            -> " (unpaid, N zorkmids)"   (or "contents")
//     with_price && price > 0   -> " (for sale, N zorkmids)" (or "contents")
//     with_price && nochrg > 0  -> " (no charge)"
//
// This is what the recorded screens SHOW for a shop floor item ("You see here
// a cream pie (for sale, 8 zorkmids).") and for an unpaid inventory item
// ("i - a cream pie (unpaid, 8 zorkmids).").  All of the arithmetic lives in
// js/shk.js (get_cost / get_cost_of_shop_item / unpaid_cost); this is only the
// formatting seam, kept here because that is where C formats it.
//
// doname()            -> price_suffix(obj, false)
// doname_with_price() -> price_suffix(obj, true)   [DONAME_WITH_PRICE]
export function price_suffix(obj, with_price) {
    return shop_price_suffix(obj, !!with_price);
}
export function doname_with_price_suffix(obj) { return shop_price_suffix(obj, true); }

// ═════════════════════════════════════════════════════════════════════════
// objnam.c naming core — INERT ADDITION.
//
// Faithful ports of the objnam.c functions that had no JS counterpart.  None
// of the code ABOVE this line calls into it: js/invent.js holds the LIVE
// (reduced) xname/doname/simple_typename implementations that every scored
// screen goes through, so this block is dead code until a measured swap lands.
//
// C buffers: obuf[] slots are modelled as { s } boxes so nextobuf()'s rotation
// (the only externally visible part of the pool) matches C call-for-call, while
// the formatting itself uses ordinary JS strings.  The PREFIX/BUFSZ overflow
// paniclog()s are therefore unreachable and omitted; the truncations that CAN
// change output (xcalled's %.*s, doname_base's BUFSZ-1 clamp) are kept.
//
// Where a C dependency lives in a module this file must not import (artifact.js
// imports objnam.js, so the edge cannot be reversed; timeout.js/invent.js reach
// objnam.js through that same cycle), a module-local copy or shim is used and
// the owning file is named at the definition.
// ═════════════════════════════════════════════════════════════════════════

const PREFIX = 80;  /* objnam.c:9 */
const BUFSZ = 256;  /* global.h:389 */
const NUMOBUF = 12; /* objnam.c:11 */

/* hack.h:61-66 */
const CXN_NORMAL = 0, CXN_SINGULAR = 1, CXN_ARTICLE = 8, CXN_NOCORPSE = 16;
/* objnam.c:1217-1219 */
const DONAME_WITH_PRICE = 1, DONAME_VAGUE_QUAN = 2, DONAME_FOR_MENU = 4;

/* prop.h:101-127 owornmask bits.  NOTE js/invent.js deliberately REMAPS these
   (see its W_* block); this port uses the real prop.h values. */
const W_ARM = 0x1, W_ARMC = 0x2, W_ARMH = 0x4, W_ARMS = 0x8, W_ARMG = 0x10,
      W_ARMF = 0x20, W_ARMU = 0x40,
      W_ARMOR = W_ARM | W_ARMC | W_ARMH | W_ARMS | W_ARMG | W_ARMF | W_ARMU,
      W_WEP = 0x100, W_QUIVER = 0x200, W_SWAPWEP = 0x400,
      W_AMUL = 0x10000, W_RINGL = 0x20000, W_RINGR = 0x40000,
      W_RING = W_RINGL | W_RINGR, W_TOOL = 0x80000,
      W_SADDLE = 0x100000, W_BALL = 0x200000, W_CHAIN = 0x400000;

/* objclass.h:12-35 obj_material_types */
const LIQUID = 1, WOOD = 8, DRAGON_HIDE = 10, IRON = 11, COPPER = 13,
      MITHRIL = 17, PLASTIC = 18, GLASS = 19, MINERAL = 21;
/* objclass.h:37-45 obj_armor_types */
const ARM_SUIT = 0, ARM_SHIELD = 1, ARM_HELM = 2, ARM_GLOVES = 3,
      ARM_BOOTS = 4, ARM_CLOAK = 5, ARM_SHIRT = 6;
/* mkobj.js F_* (include/objects.h BITS() bits); oc_charged/oc_unique live in
   objects[].flags in this port. */
const F_CHARGED = 1, F_CONTAINER = 8, F_UNIQUE = 64;
/* monflag.h G_UNIQ */
const G_UNIQ = 0x1000;
/* monst.h:52-55 — NOTE js/dogmove.js:2264 declares M_AP_OBJECT=3/M_AP_MONSTER=2,
   which is the reverse of C and of js/const.js:1288. */
const M_AP_OBJECT = 2;
/* hack.h:1189-1200 */
const CORPSTAT_GENDER = 0x03, CORPSTAT_HISTORIC = 0x04,
      CORPSTAT_RANDOM = 0, CORPSTAT_FEMALE = 1, CORPSTAT_MALE = 2;
/* you.h roles; NEUTRAL/MALE/FEMALE are genders[] indices (role.c:688) */
const MALE = 0, FEMALE = 1, NEUTRAL = 2;
const NON_PM = -1, LOW_PM = 0;

// otyps objnam.c names directly.  Values taken from js/mkobj.js objects[].sym
// (the sym column IS the C constant name), so each line is checkable by name.
const KNIFE = 40, CRYSKNIFE = 43, SHORT_SWORD = 46, BROADSWORD = 52,
      GLAIVE = 62, AKLYS = 80, FLAIL = 81,
      ELVEN_LEATHER_HELM = 89, HELMET = 97, HELM_OF_TELEPATHY = 100,
      GRAY_DRAGON_SCALE_MAIL = 101, YELLOW_DRAGON_SCALE_MAIL = 110,
      GRAY_DRAGON_SCALES = 111, YELLOW_DRAGON_SCALES = 120,
      PLATE_MAIL = 121, MUMMY_WRAPPING = 138, ALCHEMY_SMOCK = 144,
      ROBE = 145, ELVEN_SHIELD = 153, ORCISH_SHIELD = 155,
      SHIELD_OF_REFLECTION = 158, LEATHER_GLOVES = 159,
      HAWAIIAN_SHIRT = 136, T_SHIRT = 137,
      FAKE_AMULET_OF_YENDOR = 212, AMULET_OF_YENDOR_ = 213,
      LARGE_BOX_ = 214, CHEST_ = 215,
      LOCK_PICK = 222, TALLOW_CANDLE_ = 224, WAX_CANDLE_ = 225,
      BRASS_LANTERN_ = 226, OIL_LAMP_ = 227, MAGIC_LAMP_ = 228,
      LENSES = 232, TOWEL = 234, LEASH_ = 236, FIGURINE_ = 241,
      WOODEN_HARP = 253, MAGIC_HARP_ = 254,
      CANDELABRUM_OF_INVOCATION_ = 262, BELL_OF_OPENING_ = 263,
      CORPSE_ = 265, EGG_ = 266, MEAT_RING_ = 270, SLIME_MOLD_ = 285,
      FOOD_RATION = 293, TIN_ = 296, POT_WATER_ = 322, POT_OIL_ = 321,
      POT_BOOZE = 317, SPE_BOOK_OF_THE_DEAD_ = 409, SPE_NOVEL_ = 408,
      BAG_OF_TRICKS_ = 220, HORN_OF_PLENTY_ = 252, CANDY_BAR_ = 288,
      BOULDER_ = 475, STATUE_ = 476;

/* role indices as this port stores them (js/invent.js Role_if): urole.mnum is
   the roles[] index 0..12, NOT C's mons[] PM_ARCHEOLOGIST(331). */
const PM_ARCHEOLOGIST = 0, PM_CLERIC = 6, PM_SAMURAI = 9;

const vowels = 'aeiouAEIOU';

// ── C string primitives (hacklib.c) ───────────────────────────────────────
function highc(c) { return c >= 'a' && c <= 'z' ? c.toUpperCase() : c; }
function letter(c) { return !!c && /[A-Za-z]/.test(c); }

/* objnam.c:66 BSTRCMPI(base, ptr, str): TRUE (non-zero) when ptr is in front of
   base or the tail differs.  `idx` is the C pointer as an index into base. */
function bstrcmpi(base, idx, str) {
    if (idx < 0) return 1;
    return base.slice(idx).toLowerCase() === str.toLowerCase() ? 0 : 1;
}
/* objnam.c:67 BSTRNCMPI */
function bstrncmpi(base, idx, str, num) {
    if (idx < 0) return 1;
    return base.slice(idx, idx + num).toLowerCase()
        === str.slice(0, num).toLowerCase() ? 0 : 1;
}
/* plain strcmpi(ptr, str) where callers guard the pointer with a length test.
   C reads in front of the buffer if a caller's guard is wrong; JS slice() would
   silently count from the END instead, so an out-of-range index answers "no
   match" here. */
function strcmpi_at(s, idx, str) {
    if (idx < 0) return 1;
    return s.slice(idx).toLowerCase() === str.toLowerCase() ? 0 : 1;
}

/* hacklib.c:300 chrcasecpy(oc, nc) — force nc into oc's case. */
function chrcasecpy(oc, nc) {
    if (oc >= 'a' && oc <= 'z') {
        if (nc >= 'A' && nc <= 'Z') return nc.toLowerCase();
    } else if (oc >= 'A' && oc <= 'Z') {
        if (nc >= 'a' && nc <= 'z') return nc.toUpperCase();
    }
    return nc;
}

/* hacklib.c:323 strcasecpy(dst, src) — overwrite dst from `at` onward with src,
   preserving the case of the characters being replaced, then terminate (which
   discards anything after).  Returns the whole new string. */
function strcasecpy(dst, at, src) {
    const arr = dst.split('');
    let d = at, exh = 0;
    for (const ic of src) {
        if (!exh && d >= arr.length) exh = 1; /* C: !*dst */
        const oc = arr[d - exh];
        arr[d] = chrcasecpy(oc === undefined ? '' : oc, ic);
        d++;
    }
    arr.length = d; /* C: *dst = '\0' */
    return arr.join('');
}

function impossible(msg) {
    if (game.debugImpossible) console.warn('impossible:', msg);
}
function panic(msg) { throw new Error(msg); }

/* hacklib.c plur(n) / ordin(n) / shk.c currency(amount) — each has private
   copies scattered through js/ (js/invent.js:1287, :5465, :3075); these are
   the objnam.c-side ones so this block stays import-free. */
function plur(n) { return Number(n) === 1 ? '' : 's'; }
function ordin(n) {
    const dd = n % 10;
    return (dd === 0 || dd > 3 || (n % 100) / 10 === 1) ? 'th'
        : (dd === 1) ? 'st' : (dd === 2) ? 'nd' : 'rd';
}
function currency(amount) {
    /* C: Hallucination ? currency_hallucinated() : "zorkmid" + plur */
    return `zorkmid${Number(amount) === 1 ? '' : 's'}`;
}
/* polyself.c body_part(HAND) for an unpolymorphed hero */
function body_part_HAND() { return 'hand'; }

/* role.c:688 genders[] — the four rows makeplural()/makesingular()/doname_base()
   read (adj is used by doname_base's wizmgender suffix). */
const genders = [
    { adj: 'male', he: 'he', him: 'him', his: 'his' },
    { adj: 'female', he: 'she', him: 'her', his: 'her' },
    { adj: 'neuter', he: 'it', him: 'it', his: 'its' },
    { adj: 'group', he: 'they', him: 'them', his: 'their' },
];

// ── flag / hero-state accessors ───────────────────────────────────────────
function iflags() { return game.iflags || (game.iflags = {}); }
function flags() { return game.flags || (game.flags = {}); }
function program_state() { return game.program_state || (game.program_state = {}); }
function wizard() { return !!(game.flags && game.flags.debug) || !!game.wizard; }
function moves() { return game.svm?.moves ?? game.moves ?? 0; }
/* you.h Role_if(pm) */
function Role_if(pm) {
    const m = game.urole?.mnum ?? game.u?.umonnum;
    return m === pm;
}
/* objnam.c gd.distantname — non-zero while distant_name() formats a far object,
   which suppresses xname_flags()'s observe_object(). */
let gd_distantname = 0;

// ── objclass field accessors ──────────────────────────────────────────────
function oc_charged(otyp) { return !!(objects[otyp]?.flags & F_CHARGED); }
function oc_unique(otyp) { return !!(objects[otyp]?.flags & F_UNIQUE); }
function oc_armcat(otyp) { return OBJ_ARMCAT[otyp] | 0; }

// ── obj/mon predicates (obj.h, objclass.h, mondata.h) ─────────────────────
function is_weptool(o) {
    return o.oclass === TOOL_CLASS && (objects[o.otyp]?.oc_skill | 0) !== 0;
}
function is_wet_towel(o) { return o.otyp === TOWEL && o.spe > 0; }
function is_poisonable(o) {
    /* obj.h:264 — oc_skill in [-P_SHURIKEN .. -P_BOW]; the port stores the
       negative launcher/ammo skills in oc_skill exactly as C does. */
    const sk = objects[o.otyp]?.oc_skill | 0;
    return o.oclass === WEAPON_CLASS && sk >= -15 /* -P_SHURIKEN */
        && sk <= -11 /* -P_BOW */;
}
function is_ammo(o) {
    const sk = objects[o.otyp]?.oc_skill | 0;
    return (o.oclass === WEAPON_CLASS || o.oclass === TOOL_CLASS)
        && sk >= -13 /* -P_CROSSBOW */ && sk <= -11 /* -P_BOW */;
}
function is_missile(o) {
    const sk = objects[o.otyp]?.oc_skill | 0;
    return (o.oclass === WEAPON_CLASS || o.oclass === TOOL_CLASS)
        && sk >= -17 /* -P_BOOMERANG */ && sk <= -14 /* -P_DART */;
}
function bimanual(o) {
    /* objects[].oc_bimanual is not carried by this port's objects[]; the two-
       handed weapons are a fixed list in objects.h. */
    return (o.oclass === WEAPON_CLASS || o.oclass === TOOL_CLASS)
        && BIMANUAL_OTYPS.has(o.otyp);
}
/* objects.h `bi` argument == 1: two-handed sword, battle-axe, tsurugi,
   dwarvish mattock, and the polearms that take both hands. */
const BIMANUAL_OTYPS = new Set([
    57 /*TWO_HANDED_SWORD*/, 58 /*TSURUGI*/, 65 /*BATTLE_AXE*/,
    71 /*DWARVISH_MATTOCK*/,
]);
function is_shield(o) { return o.oclass === ARMOR_CLASS && oc_armcat(o.otyp) === ARM_SHIELD; }
function is_helmet(o) { return o.oclass === ARMOR_CLASS && oc_armcat(o.otyp) === ARM_HELM; }
function is_boots(o) { return o.oclass === ARMOR_CLASS && oc_armcat(o.otyp) === ARM_BOOTS; }
function is_gloves(o) { return o.oclass === ARMOR_CLASS && oc_armcat(o.otyp) === ARM_GLOVES; }
function Is_dragon_scales(o) {
    return o.otyp >= GRAY_DRAGON_SCALES && o.otyp <= YELLOW_DRAGON_SCALES;
}
function Is_dragon_mail(o) {
    return o.otyp >= GRAY_DRAGON_SCALE_MAIL && o.otyp <= YELLOW_DRAGON_SCALE_MAIL;
}
function omat(o) { return objects[o.otyp]?.material | 0; }
function is_metallic(o) { return omat(o) >= IRON && omat(o) <= MITHRIL; }
function is_rustprone(o) { return omat(o) === IRON; }
function is_crackable(o) { return omat(o) === GLASS && o.oclass === ARMOR_CLASS; }
/* objclass.h:205 — COPPER *or* IRON.  js/invent.js:1845's copy tests COPPER
   only, so a rusty iron item there never reads as corrodeable. */
function is_corrodeable(o) { return omat(o) === COPPER || omat(o) === IRON; }
function Is_candle(o) { return o.otyp === TALLOW_CANDLE_ || o.otyp === WAX_CANDLE_; }
function is_flammable(o) {
    /* mkobj.c:2270.  objects[].oc_oprop is not carried by this port, so the
       FIRE_RES check degenerates to the WAN_FIRE special case. */
    if (Is_candle(o)) return false;
    if (o.otyp === 430 /*WAN_FIRE*/) return false;
    const m = omat(o);
    return (m <= WOOD && m !== LIQUID) || m === PLASTIC;
}
function is_rottable(o) {
    const m = omat(o);
    return (m <= WOOD && m !== LIQUID) || m === DRAGON_HIDE;
}
function is_damageable(o) {
    return is_rustprone(o) || is_flammable(o) || is_rottable(o)
        || is_corrodeable(o) || is_crackable(o);
}
function Is_box(o) { return o.otyp === LARGE_BOX_ || o.otyp === CHEST_; }
/* obj.h Is_container(o) = objects[].oc_container == objects.h F_CONTAINER */
function Is_container(o) { return !!(objects[o.otyp]?.flags & F_CONTAINER); }
function Has_contents(o) { return !!(o?.cobj && o.cobj.length); }
function has_oname(o) { return !!(o && o.oname); }
function ONAME(o) { return (o && o.oname) || ''; }
function ismnum(m) { return m != null && m >= LOW_PM; }
/* mondata.h type_is_pname(ptr) = (mflags2 & M2_PNAME) */
function type_is_pname(ptr) {
    return !!(ptr && (MFLAGS2[ptr.pmidx] | 0) & M2_PNAME);
}
function mons_at(mndx) { return monster_by_pmidx(mndx); }

// ── shims for helpers owned by modules that import THIS file ──────────────
// artifact.js imports objnam.js, so these edges cannot be reversed; timeout.js
// reaches objnam.js through invent.js.  Named so a later merge can delete the
// shim and import the real thing if the cycle is ever broken.
function find_artifact(_obj) { /* artifact.c find_artifact(): livelog only */ }
function artifact_name(_nam) { return null; } /* artifact.c artifact_name() */
function artifact_light(_obj) { return false; } /* artifact.c artifact_light() */
function arti_light_description(_obj) { return 'brilliantly'; }
function glow_verb(_cnt, _ing) { return 'glowing'; } /* mon.c glow_verb() */
function glow_color(_arti) { return 'red'; } /* mon.c glow_color() */
function peek_timer(_kind, _arg) { return 0; } /* timeout.c peek_timer() */
function find_mid(_id, _fmflags) { return null; } /* mon.c find_mid() */
function noit_mon_nam(_mtmp) { return 'it'; } /* do_name.c noit_mon_nam() */
function tin_details(_obj, _mnum, buf) { return buf; } /* eat.c tin_details() */
function append_price_quote(bp, _otyp) { return bp; } /* o_init.c */
function record_price_quote(_otyp, _price, _buy) {} /* shk.c */
function count_contents(container, nested, quantity, everything) {
    /* invent.c count_contents(obj, nested, quantity, everything, newdrop) */
    let count = 0;
    for (const o of (container?.cobj || [])) {
        if (nested && Has_contents(o))
            count += count_contents(o, nested, quantity, everything);
        if (everything || o.unpaid) count += quantity ? (o.quan || 1) : 1;
    }
    return count;
}
/* objnam.c:1787 not_fully_identified() — js/invent.js:1205 holds the live port. */
function not_fully_identified(otmp) {
    if (!objects[otmp.otyp]?.oc_name_known || !otmp.known || !otmp.dknown
        || (!otmp.bknown && !Role_if(PM_CLERIC)))
        return true;
    return false;
}

// ── obuf pool (objnam.c:137-198) ──────────────────────────────────────────
const obufs = Array.from({ length: NUMOBUF }, () => ({ s: '' }));
let obufidx = 0;

// nextobuf(): rotate to the next of the NUMOBUF work buffers.
// C ref: objnam.c:141.
export function nextobuf() {
    obufidx = (obufidx + 1) % NUMOBUF;
    return obufs[obufidx];
}

// releaseobuf(): give the most recently allocated buffer back.  C tests whether
// bufp points anywhere INSIDE obufs[obufidx] (callers may hold a pointer into
// the middle of it, e.g. &obuf[PREFIX] from xname()); slot identity is the same
// test.  C ref: objnam.c:149.
export function releaseobuf(bufp) {
    if (bufp === obufs[obufidx])
        obufidx = (obufidx - 1 + NUMOBUF) % NUMOBUF;
}
/* every C releaseobuf() call site releases the buffer it just allocated, which
   is the only case the guard above accepts */
function cur_obuf() { return obufs[obufidx]; }
function setobuf(ob, s) { ob.s = s; return s; }

// maybereleaseobuf(): display_pickinv()'s hook.  C ref: objnam.c:166.
export function maybereleaseobuf(obuffer) { releaseobuf(obuffer); }

// strprepend(): insert pref in front of s, using the PREFIX bytes xname()
// reserved at the front of the obuf.  C ref: objnam.c:122.
export function strprepend(s, pref) {
    const i = pref.length;
    if (i > PREFIX) {
        impossible(`PREFIX too short (for ${i}).`);
        return s;
    }
    return pref + s;
}

// xcalled(): append "<pfx> called <sfx>" to buf, truncating sfx if necessary.
// C writes in place; here the extended string is returned.
// C ref: objnam.c:557.
export function xcalled(buf, siz, pfx, sfx) {
    const bufsiz = siz - 1 - buf.length;
    const pfxlen = pfx.length + ' called '.length;

    if (pfxlen > bufsiz)
        panic(`xcalled: not enough room for prefix (${pfxlen} > ${bufsiz})`);

    return buf + pfx + ' called ' + sfx.slice(0, Math.max(0, bufsiz - pfxlen));
}

// Japanese_item_name(): objnam.c:5421 + the Japanese_items[] table at
// objnam.c:105.  js/o_init.js has a private copy for the discoveries list.
const Japanese_items = [
    [SHORT_SWORD, 'wakizashi'], [BROADSWORD, 'ninja-to'], [FLAIL, 'nunchaku'],
    [GLAIVE, 'naginata'], [LOCK_PICK, 'osaku'], [WOODEN_HARP, 'koto'],
    [MAGIC_HARP_, 'magic koto'], [KNIFE, 'shito'], [PLATE_MAIL, 'tanko'],
    [HELMET, 'kabuto'], [LEATHER_GLOVES, 'yugake'], [FOOD_RATION, 'gunyoki'],
    [POT_BOOZE, 'sake'],
];
function Japanese_item_name(i, ordinaryname) {
    for (const [item, name] of Japanese_items)
        if (i === item) return name;
    return ordinaryname;
}

// obj_typename(): the discovery-state name of an object TYPE.
// C ref: objnam.c:201.
export function obj_typename(otyp) {
    const ob = nextobuf();
    const ocl = objects[otyp];
    let actualn = OBJ_NAME(ocl);
    let dn = OBJ_DESCR(ocl);
    const un = OBJ_UNAME(ocl);
    let nn = ocl.oc_name_known;
    let buf = '';

    if (Role_if(PM_SAMURAI)) {
        actualn = Japanese_item_name(otyp, actualn);
        if (otyp === WOODEN_HARP || otyp === MAGIC_HARP_) dn = 'koto';
    }
    /* generic items don't have an actual-name */
    if (!actualn)
        actualn = (otyp > 0 && otyp < MAXOCLASSES) ? 'generic' : 'object?';

    switch (ocl.oc_class) {
    case COIN_CLASS:
        return setobuf(ob, actualn); /* "gold piece" */
    case POTION_CLASS:
        buf = 'potion';
        break;
    case SCROLL_CLASS:
        buf = 'scroll';
        break;
    case WAND_CLASS:
        buf = 'wand';
        break;
    case SPBOOK_CLASS:
        if (otyp !== SPE_NOVEL_) {
            buf = 'spellbook';
        } else {
            buf = !nn ? 'book' : 'novel';
            nn = 0;
        }
        break;
    case RING_CLASS:
        buf = 'ring';
        break;
    case AMULET_CLASS:
        buf = nn ? actualn : 'amulet';
        if (un)
            buf = xcalled(buf, BUFSZ - (dn ? dn.length + 3 : 0), '', un);
        if (dn)
            buf += ` (${dn})`;
        return setobuf(ob, buf);
    case ARMOR_CLASS:
        if (oc_armcat(otyp) === ARM_GLOVES || oc_armcat(otyp) === ARM_BOOTS)
            buf = 'pair of ';
        else if (otyp >= GRAY_DRAGON_SCALES && otyp <= YELLOW_DRAGON_SCALES)
            buf = 'set of ';
        /* FALLTHRU */
    default:
        if (nn) {
            buf += actualn;
            if (GemStone(otyp))
                buf += ' stone';
            if (un) /* 3: length of " (" + ")" which will enclose 'dn' */
                buf = xcalled(buf, BUFSZ - (dn ? dn.length + 3 : 0), '', un);
            if (dn)
                buf += ` (${dn})`;
        } else {
            buf += dn ? dn : actualn;
            if (ocl.oc_class === GEM_CLASS)
                buf += (ocl.material === MINERAL) ? ' stone' : ' gem';
            if (un)
                buf = xcalled(buf, BUFSZ, '', un);
        }
        return setobuf(ob, buf);
    }
    /* here for ring/scroll/potion/wand */
    if (nn) {
        if (oc_unique(otyp))
            buf = actualn; /* avoid spellbook of Book of the Dead */
        else
            buf += ` of ${actualn}`;
    }
    if (un)
        buf = xcalled(buf, BUFSZ - (dn ? dn.length + 3 : 0), '', un);
    if (dn)
        buf += ` (${dn})`;
    return setobuf(ob, buf);
}

// simple_typename(): actual name OR description, never both, user-name ignored.
// C ref: objnam.c:298.  js/invent.js:589 holds the LIVE (reduced) copy that the
// scored screens use; this one is the objnam.c-faithful sibling and exists so
// safe_typename()/mimic_obj_name() below can be exact.
function simple_typename(otyp) {
    const save_uname = objects[otyp].oc_uname;
    objects[otyp].oc_uname = 0; /* suppress any name given by user */
    let bufp = obj_typename(otyp);
    objects[otyp].oc_uname = save_uname;
    const pp = strstri(bufp, ' (');
    if (pp >= 0)
        bufp = bufp.slice(0, pp); /* strip the appended description */
    return bufp;
}

// safe_typename(): typename for debugging feedback where the data might be
// suspect.  C ref: objnam.c:312.
export function safe_typename(otyp) {
    let res;

    if (otyp < STRANGE_OBJECT || otyp >= NUM_OBJECTS
        || !OBJ_NAME(objects[otyp])) {
        const ob = nextobuf();
        res = setobuf(ob, `glorkum[${otyp}]`);
        impossible(`safe_typename: ${res}`);
    } else {
        /* force it to be treated as fully discovered */
        const save_nameknown = objects[otyp].oc_name_known;
        objects[otyp].oc_name_known = 1;
        res = simple_typename(otyp);
        objects[otyp].oc_name_known = save_nameknown;
    }
    return res;
}

// mimic_obj_name(): what a mimicking monster looks like.
// C ref: objnam.c:5606.
export function mimic_obj_name(mtmp) {
    if (mtmp.m_ap_type === M_AP_OBJECT) {
        if (mtmp.mappearance === GOLD_PIECE)
            return 'gold';
        if (mtmp.mappearance !== STRANGE_OBJECT)
            return simple_typename(mtmp.mappearance);
    }
    return 'whatcha-may-callit';
}

// ── named fruits (objnam.c:429-554) ───────────────────────────────────────
function ffruit_chain() {
    const out = [];
    for (let f = game.ffruit; f; f = f.nextf) out.push(f);
    return out;
}

// fruit_from_indx(): look up a named fruit by index (1..127).
// C ref: objnam.c:431.
export function fruit_from_indx(indx) {
    for (let f = game.ffruit; f; f = f.nextf)
        if (f.fid === indx)
            return f;
    return null;
}

// fruit_from_name(): look up a named fruit by name.  `highest_fid`, when
// supplied, is an out-parameter object whose .value receives C's *highest_fid
// (only meaningful when 'fname' isn't found).  js/options.js:6596 carries a
// private copy (fruit_from_name_local) which this replaces.
// C ref: objnam.c:443.
export function fruit_from_name(fname, exact, highest_fid) {
    let f = null, tentativef, altfname, k;

    /* note: named fruits are case-sensitive... */
    if (highest_fid)
        highest_fid.value = 0;
    /* first try for an exact match */
    for (f = game.ffruit; f; f = f.nextf) {
        if (f.fname === fname)
            return f;
        else if (highest_fid && f.fid > highest_fid.value)
            highest_fid.value = f.fid;
    }

    /* didn't match as-is; if caller is willing to accept a prefix match, try to
       find one; we want the longest prefix that matches, not the first */
    if (!exact) {
        tentativef = null;
        for (const g of ffruit_chain()) {
            k = g.fname.length;
            if (fname.slice(0, k) === g.fname
                && (!fname[k] || fname[k] === ' ')
                && (!tentativef || k > tentativef.fname.length))
                tentativef = g;
        }
        f = tentativef;
    }
    /* if we still don't have a match, try singularizing the target */
    if (!f) {
        altfname = makesingular_full(fname);
        for (const g of ffruit_chain()) {
            if (g.fname === altfname) { f = g; break; }
        }
        releaseobuf(cur_obuf());
    }
    if (!f && !exact) {
        const fname_k = fname.length; /* length of assumed plural fname */

        tentativef = null;
        for (const g of ffruit_chain()) {
            k = g.fname.length;
            /* reload fnamebuf[] each iteration in case it gets modified */
            let fnamebuf = fname;
            /* C uses 'fname_k >= k' rather than '>' deliberately: see the
               comment at objnam.c:498 */
            const sp = fnamebuf.indexOf(' ', k);
            if (fname_k >= k && sp >= 0) {
                fnamebuf = fnamebuf.slice(0, sp);
                altfname = makesingular_full(fnamebuf);
                k = altfname.length; /* actually revised 'fname_k' */
                if (g.fname === altfname
                    && (!tentativef || k > tentativef.fname.length))
                    tentativef = g;
                releaseobuf(cur_obuf());
            }
        }
        f = tentativef;
    }
    return f || null;
}

// reorder_fruit(): sort the named-fruit linked list by fruit index number.
// C ref: objnam.c:523.
export function reorder_fruit(forward) {
    const k = 1 + 127;
    const allfr = new Array(k).fill(null);
    let i, j;

    for (let f = game.ffruit; f; f = f.nextf) {
        j = f.fid;
        if (j < 1 || j >= k) {
            impossible(`reorder_fruit: fruit index (${j}) out of range`);
            return; /* don't sort after all; should never happen... */
        } else if (allfr[j]) {
            impossible(`reorder_fruit: duplicate fruit index (${j})`);
            return;
        }
        allfr[j] = f;
    }
    game.ffruit = null; /* reset linked list; rebuild it from scratch */
    /* slot [0] is always empty; start 'i' at 1 so [k - i] stays in bounds */
    for (i = 1; i < k; ++i) {
        j = forward ? (k - i) : i;
        if (allfr[j]) {
            allfr[j].nextf = game.ffruit;
            game.ffruit = allfr[j];
        }
    }
}

// ── singularize / pluralize (objnam.c:2550-3239) ──────────────────────────
/* strchr(set, c) with an empty/absent c treated as "not found" ('' would match
   every set under String.includes) */
function strchr(set, c) { return c != null && c !== '' && set.indexOf(c) >= 0; }

/* objnam.c:2662 one_off[] — word pairs that no formula reverses */
const one_off = [
    ['child', 'children'], /* (for wise guys who give their food funny names) */
    ['cubus', 'cubi'],     /* in-/suc-cubus */
    ['culus', 'culi'],     /* homunculus */
    ['Cyclops', 'Cyclopes'],
    ['djinni', 'djinn'],
    ['erinys', 'erinyes'],
    ['foot', 'feet'],
    ['fungus', 'fungi'],
    ['goose', 'geese'],
    ['knife', 'knives'],
    ['labrum', 'labra'],   /* candelabrum */
    ['louse', 'lice'],
    ['mouse', 'mice'],
    ['mumak', 'mumakil'],
    ['nemesis', 'nemeses'],
    ['ovum', 'ova'],
    ['ox', 'oxen'],
    ['passerby', 'passersby'],
    ['rtex', 'rtices'],    /* vortex */
    ['serum', 'sera'],
    ['staff', 'staves'],
    ['tooth', 'teeth'],
];

/* objnam.c:2689 as_is[] */
const as_is = [
    /* makesingular() leaves these plural due to how they're used */
    'boots', 'shoes', 'gloves', 'lenses', 'scales',
    'eyes', 'gauntlets', 'iron bars',
    /* both singular and plural are spelled the same */
    'bison', 'deer', 'elk', 'fish', 'fowl',
    'tuna', 'yaki', '-hai', 'krill', 'manes',
    'moose', 'ninja', 'sheep', 'ronin', 'roshi',
    'shito', 'tengu', 'ki-rin', 'Nazgul', 'gunyoki',
    'piranha', 'samurai', 'shuriken', 'haggis', 'Bordeaux',
];

/* objnam.c:2550 special_subjs[] */
const special_subjs = [
    'erinys', 'manes', /* this one is ambiguous */
    'Cyclops', 'Hippocrates', 'Pelias', 'aklys',
    'amnesia', 'detect monsters', 'paralysis', 'shape changers',
    'nemesis',
];

// badman(): does this *man/*men word take a plain 's' plural / have no *man
// singular?  C ref: objnam.c:3194.
function badman(basestr, to_plural) {
    /* prefixes for *man that don't have a *men plural */
    const no_men = [
        'albu', 'antihu', 'anti', 'ata', 'auto', 'bildungsro', 'cai', 'cay',
        'ceru', 'corner', 'decu', 'des', 'dura', 'fir', 'hanu', 'het',
        'infrahu', 'inhu', 'nonhu', 'otto', 'out', 'prehu', 'protohu',
        'subhu', 'superhu', 'talis', 'unhu', 'sha',
        'hu', 'un', 'le', 're', 'so', 'to', 'at', 'a',
    ];
    /* prefixes for *men that don't have a *man singular */
    const no_man = [
        'abdo', 'acu', 'agno', 'ceru', 'cogno', 'cycla', 'fleh', 'grava',
        'hegu', 'preno', 'sonar', 'speci', 'dai', 'exa', 'fla', 'sta', 'teg',
        'tegu', 'vela', 'da', 'hy', 'lu', 'no', 'nu', 'ra', 'ru', 'se', 'vi',
        'ya', 'o', 'a',
    ];

    if (!basestr || basestr.length < 4)
        return false;

    const endstr = basestr.length;
    const list = to_plural ? no_men : no_man;
    for (const w of list) {
        const al = w.length;
        const spot = endstr - (al + 3);
        if (bstrncmpi(basestr, spot, w, al) === 0
            && (spot === 0 || basestr[spot - 1] === ' '))
            return true;
    }
    return false;
}

// ch_ksound(): *ch words whose 'ch' is a k-sound, so they pluralize with 's'
// rather than 'es'.  C ref: objnam.c:3167.
export function ch_ksound(basestr) {
    const ch_k = [
        'monarch', 'poch', 'tech', 'mech', 'stomach', 'psych',
        'amphibrach', 'anarch', 'atriarch', 'azedarach', 'broch',
        'gastrotrich', 'isopach', 'loch', 'oligarch', 'peritrich',
        'sandarach', 'sumach', 'symposiarch',
    ];

    if (!basestr || basestr.length < 4)
        return false;

    const endstr = basestr.length;
    for (const w of ch_k)
        if (bstrcmpi(basestr, endstr - w.length, w) === 0)
            return true;
    return false;
}

// singplur_lookup(): the singularize/pluralize decisions common to makeplural()
// and makesingular().  C mutates basestr in place via Strcasecpy(), so the
// string is passed BOXED: `sb` is { s } and any transformation is written back
// to sb.s.  C ref: objnam.c:2707.
export function singplur_lookup(sb, endstring, to_plural, alt_as_is) {
    const basestr = sb.s;
    const baselen = basestr.length;
    let al;

    for (const as of as_is) {
        al = as.length;
        if (bstrcmpi(basestr, endstring - al, as) === 0)
            return true;
    }
    if (alt_as_is) {
        for (const as of alt_as_is) {
            al = as.length;
            if (bstrcmpi(basestr, endstring - al, as) === 0)
                return true;
        }
    }

    /* Leave "craft" as a suffix as-is (aircraft, hovercraft) */
    if (baselen > 5 && bstrcmpi(basestr, endstring - 5, 'craft') === 0)
        return true;
    /* avoid false hit on one_off[].plur == "lice" or .sing == "goose" */
    if (strcmpi(basestr, 'slice') || strcmpi(basestr, 'mongoose')) {
        if (to_plural)
            sb.s = strcasecpy(basestr, endstring, 's');
        return true;
    }
    /* skip "ox" -> "oxen" when pluralizing "<something>ox" unless muskox */
    if (to_plural && baselen > 2 && strcmpi_at(basestr, endstring - 2, 'ox') === 0
        && !(baselen > 5 && strcmpi_at(basestr, endstring - 6, 'muskox') === 0)) {
        sb.s = strcasecpy(basestr, endstring, 'es'); /* "fox" -> "foxes" */
        return true;
    }
    if (to_plural) {
        if (baselen > 2 && strcmpi_at(basestr, endstring - 3, 'man') === 0
            && badman(basestr, to_plural)) {
            sb.s = strcasecpy(basestr, endstring, 's');
            return true;
        }
    } else {
        if (baselen > 2 && strcmpi_at(basestr, endstring - 3, 'men') === 0
            && badman(basestr, to_plural))
            return true;
    }
    for (const [sing, plural] of one_off) {
        /* check whether endstring already matches */
        const same = to_plural ? plural : sing;
        al = same.length;
        if (bstrcmpi(basestr, endstring - al, same) === 0)
            return true; /* use as-is */
        /* check whether it matches the inverse; if so, transform it */
        const other = to_plural ? sing : plural;
        al = other.length;
        if (bstrcmpi(basestr, endstring - al, other) === 0) {
            sb.s = strcasecpy(basestr, endstring - al, same);
            return true; /* one_off[] transformation */
        }
    }
    return false;
}

// singplur_compound(): index of a compound-phrase separator (" of ", " called ",
// ...) or -1.  C ref: objnam.c:2782.  js/readobjnam.js:200 has the live copy.
function singplur_compound(str) {
    const compounds = [
        ' of ', ' labeled ', ' called ',
        ' named ', ' above', /* lurkers above */
        ' versus ', ' from ', ' in ',
        ' on ', ' a la ', ' with', /* " with "? */
        ' de ', " d'", ' du ',
        ' au ', '-in-', '-at-',
    ];
    const compound_start = ' -';

    for (let p = 0; p < str.length; ++p) {
        if (compound_start.indexOf(str[p]) < 0)
            continue;
        for (const cmpd of compounds)
            if (str.slice(p, p + cmpd.length).toLowerCase() === cmpd.toLowerCase())
                return p;
    }
    return -1;
}

// makeplural(): the objnam.c plural routine.  C ref: objnam.c:2835.
// js/invent.js exports a reduced makeplural() that the live screens use; this is
// the faithful sibling (it is what makes singplur_lookup/ch_ksound reachable).
export function makeplural(oldstr) {
    const ob = nextobuf();
    let str, excess = null, spot, len, lo_c, i;

    if (oldstr != null)
        oldstr = String(oldstr).replace(/^ +/, '');
    if (oldstr == null || oldstr === '') {
        impossible('plural of null?');
        return setobuf(ob, 's');
    }
    /* pronouns: "he"/"she"/"it" -> "they", &c */
    str = '';
    for (i = 0; i <= 2; ++i) {
        if (strcmpi(genders[i].he, oldstr))
            str = genders[3].he; /* "they" */
        else if (strcmpi(genders[i].him, oldstr))
            str = genders[3].him; /* "them" */
        else if (strcmpi(genders[i].his, oldstr))
            str = genders[3].his; /* "their" */
        if (str) {
            if (oldstr[0] === highc(oldstr[0]))
                str = highc(str[0]) + str.slice(1);
            return setobuf(ob, str);
        }
    }

    str = oldstr;
    bottom: {
        /* Skip changing "pair of" to "pairs of" (objnam.c:2873) */
        if (strncmpi(str, 'pair of ', 8))
            break bottom;

        /* look for "foo of bar" so that we can focus on "foo" */
        const ci = singplur_compound(str);
        if (ci >= 0) {
            excess = oldstr.slice(ci);
            str = str.slice(0, ci);
            spot = ci;
        } else {
            spot = str.length;
        }

        spot--;
        while (spot > 0 && str[spot] === ' ')
            spot--; /* Strip blanks from end */
        str = str.slice(0, spot + 1);
        /* Now spot is the last character of the string */
        len = str.length;

        /* Single letters */
        if (len === 1 || !letter(str[spot])) {
            str = str.slice(0, spot + 1) + "'s";
            break bottom;
        }

        /* dispense with some words which don't need pluralization */
        {
            const already_plural = [
                'ae',    /* algae, larvae, &c */
                'eaux',  /* chateaux, gateaux */
                'matzot',
            ];
            /* spot+1: synch up with makesingular's usage */
            const sb = { s: str };
            const hit = singplur_lookup(sb, spot + 1, true, already_plural);
            str = sb.s;
            if (hit)
                break bottom;

            /* more of same, but not suitable for blanket loop checking */
            if ((len === 2 && strcmpi(str, 'ya'))
                || (len >= 3 && strcmpi_at(str, spot - 2, ' ya') === 0))
                break bottom;
        }

        /* man/men ("Wiped out all cavemen.") */
        if (len >= 3 && strcmpi_at(str, spot - 2, 'man') === 0
            /* exclude shamans and humans etc */
            && !badman(str, true)) {
            str = strcasecpy(str, spot - 1, 'en');
            break bottom;
        }
        if (lowc(str[spot]) === 'f') { /* (staff handled via one_off[]) */
            lo_c = lowc(str[spot - 1]);
            if (len >= 3 && strcmpi_at(str, spot - 2, 'erf') === 0) {
                /* avoid "nerf" -> "nerves", "serf" -> "serves"; fall through */
            } else if (strchr('lr', lo_c) || strchr(vowels, lo_c)) {
                str = strcasecpy(str, spot, 'ves'); /* [aeioulr]f -> ves */
                break bottom;
            }
        }
        /* ium/ia (mycelia, baluchitheria) */
        if (len >= 3 && strcmpi_at(str, spot - 2, 'ium') === 0) {
            str = strcasecpy(str, spot - 2, 'ia');
            break bottom;
        }
        /* algae, larvae, hyphae (another fungus part) */
        if ((len >= 4 && strcmpi_at(str, spot - 3, 'alga') === 0)
            || (len >= 5
                && (strcmpi_at(str, spot - 4, 'hypha') === 0
                    || strcmpi_at(str, spot - 4, 'larva') === 0))
            || (len >= 6 && strcmpi_at(str, spot - 5, 'amoeba') === 0)
            || (len >= 8 && strcmpi_at(str, spot - 7, 'vertebra') === 0)) {
            str = strcasecpy(str, spot + 1, 'e'); /* a to ae */
            break bottom;
        }
        /* fungus/fungi, homunculus/homunculi, but buses, lotuses, wumpuses */
        if (len > 3 && strcmpi_at(str, spot - 1, 'us') === 0
            && !((len >= 5 && strcmpi_at(str, spot - 4, 'lotus') === 0)
                 || (len >= 6 && strcmpi_at(str, spot - 5, 'wumpus') === 0))) {
            str = strcasecpy(str, spot - 1, 'i');
            break bottom;
        }
        /* sis/ses (nemesis) */
        if (len >= 3 && strcmpi_at(str, spot - 2, 'sis') === 0) {
            str = strcasecpy(str, spot - 1, 'es');
            break bottom;
        }
        /* -eau/-eaux (gateau, chapeau...) */
        if (len >= 3 && strcmpi_at(str, spot - 2, 'eau') === 0
            /* 'bureaus' is the more common plural of 'bureau' */
            && bstrcmpi(str, spot - 5, 'bureau') !== 0) {
            str = strcasecpy(str, spot + 1, 'x');
            break bottom;
        }
        /* matzoh/matzot, possible food name */
        if (len >= 6
            && (strcmpi_at(str, spot - 5, 'matzoh') === 0
                || strcmpi_at(str, spot - 5, 'matzah') === 0)) {
            str = strcasecpy(str, spot - 1, 'ot'); /* oh/ah -> ot */
            break bottom;
        }
        if (len >= 5
            && (strcmpi_at(str, spot - 4, 'matzo') === 0
                || strcmpi_at(str, spot - 4, 'matza') === 0)) {
            str = strcasecpy(str, spot, 'ot'); /* o/a -> ot */
            break bottom;
        }

        /* note: ox/oxen, VAX/VAXen, goose/geese */

        lo_c = lowc(str[spot]);

        /* codex/spadix/neocortex and the like */
        if (len >= 5
            && (strcmpi_at(str, spot - 2, 'dex') === 0
                || strcmpi_at(str, spot - 2, 'dix') === 0
                || strcmpi_at(str, spot - 2, 'tex') === 0)
            /* indices would have been ok too, but stick with indexes */
            && strcmpi_at(str, spot - 4, 'index') !== 0) {
            str = strcasecpy(str, spot - 1, 'ices'); /* ex|ix -> ices */
            break bottom;
        }
        /* Ends in z, x, s, ch, sh; add an "es" */
        if (strchr('zxs', lo_c)
            || (len >= 2 && lo_c === 'h' && strchr('cs', lowc(str[spot - 1]))
                /* 21st century k-sound */
                && !(len >= 4 && lowc(str[spot - 1]) === 'c' && ch_ksound(str)))
            /* Kludge to get "tomatoes" and "potatoes" right */
            || (len >= 4 && strcmpi_at(str, spot - 2, 'ato') === 0)
            || (len >= 5 && strcmpi_at(str, spot - 4, 'dingo') === 0)) {
            str = strcasecpy(str, spot + 1, 'es');
            break bottom;
        }
        /* Ends in y preceded by consonant (note: also "qu") change to "ies" */
        if (lo_c === 'y' && !strchr(vowels, lowc(str[spot - 1]))) {
            str = strcasecpy(str, spot, 'ies');
            break bottom;
        }
        /* Default: append an 's' */
        str = strcasecpy(str, spot + 1, 's');
    }

    if (excess != null)
        str += excess;
    return setobuf(ob, str);
}

// makesingular_full(): the faithful objnam.c:3036 makesingular().
// NAME: this module already exports a REDUCED makesingular() (near the top of
// the file) that live callers in js/nhlua.js, js/options.js, js/pickup.js and
// js/polyself.js import; swapping them is a separate measured change, so the
// faithful port carries a distinct name rather than shadowing it.
function makesingular_full(oldstr) {
    const ob = nextobuf();
    let bp, excess = null, p;

    if (oldstr != null)
        oldstr = String(oldstr).replace(/^ +/, '');
    if (oldstr == null || oldstr === '') {
        impossible('singular of null?');
        return setobuf(ob, '');
    }
    /* makeplural() of pronouns isn't reversible but we can force a singular */
    let str = '';
    if (strcmpi(genders[3].he, oldstr))        /* "they" */
        str = genders[2].he;                   /* "it" */
    else if (strcmpi(genders[3].him, oldstr))  /* "them" */
        str = genders[2].him;                  /* also "it" */
    else if (strcmpi(genders[3].his, oldstr))  /* "their" */
        str = genders[2].his;                  /* "its" */
    if (str) {
        if (oldstr[0] === highc(oldstr[0]))
            str = highc(str[0]) + str.slice(1);
        return setobuf(ob, str);
    }

    bp = oldstr;
    bottom: {
        /* check for "foo of bar" so that we can focus on "foo" */
        const ci = singplur_compound(bp);
        if (ci >= 0) {
            excess = oldstr.slice(ci);
            bp = bp.slice(0, ci);
            p = ci;
        } else {
            p = bp.length;
        }

        /* dispense with some words which don't need singularization */
        {
            const sb = { s: bp };
            const hit = singplur_lookup(sb, p, false, special_subjs);
            bp = sb.s;
            if (hit)
                break bottom;
        }

        /* remove -s or -es (boxes) or -ies (rubies) */
        if (p >= 1 && lowc(bp[p - 1]) === 's') {
            mins: {
                if (p >= 2 && lowc(bp[p - 2]) === 'e') {
                    if (p >= 3 && lowc(bp[p - 3]) === 'i') { /* "ies" */
                        if (bstrcmpi(bp, p - 7, 'cookies') === 0
                            || (bstrcmpi(bp, p - 4, 'pies') === 0
                                /* avoid false match for "harpies" */
                                && (p - 4 === 0 || bp[p - 5] === ' '))
                            /* alternate djinni/djinn spelling */
                            || (bstrcmpi(bp, p - 6, 'genies') === 0
                                /* avoid false match for "progenies" */
                                && (p - 6 === 0 || bp[p - 7] === ' '))
                            || bstrcmpi(bp, p - 5, 'mbies') === 0  /* zombie */
                            || bstrcmpi(bp, p - 5, 'yries') === 0) /* valkyrie */
                            break mins;
                        bp = strcasecpy(bp, p - 3, 'y'); /* ies -> y */
                        break bottom;
                    }
                    /* wolves, but f to ves isn't fully reversible */
                    if (p - 4 >= 0
                        && (strchr('lr', lowc(bp[p - 4]))
                            || strchr(vowels, lowc(bp[p - 4])))
                        && bstrcmpi(bp, p - 3, 'ves') === 0) {
                        if (bstrcmpi(bp, p - 6, 'cloves') === 0
                            || bstrcmpi(bp, p - 6, 'nerves') === 0)
                            break mins;
                        bp = strcasecpy(bp, p - 3, 'f'); /* ves -> f */
                        break bottom;
                    }
                    /* note: nurses, axes but boxes, wumpuses */
                    if (bstrcmpi(bp, p - 4, 'eses') === 0
                        || bstrcmpi(bp, p - 4, 'oxes') === 0  /* boxes, foxes */
                        || bstrcmpi(bp, p - 4, 'nxes') === 0  /* lynxes */
                        || bstrcmpi(bp, p - 4, 'ches') === 0
                        || bstrcmpi(bp, p - 4, 'uses') === 0  /* lotuses */
                        || bstrcmpi(bp, p - 4, 'shes') === 0  /* splashes */
                        || bstrcmpi(bp, p - 4, 'sses') === 0  /* priestesses */
                        || bstrcmpi(bp, p - 5, 'atoes') === 0 /* tomatoes */
                        || bstrcmpi(bp, p - 7, 'dingoes') === 0
                        || bstrcmpi(bp, p - 7, 'Aleaxes') === 0) {
                        bp = bp.slice(0, p - 2); /* drop es */
                        break bottom;
                    } /* else fall through to mins */

                    /* ends in 's' but not 'es' */
                } else if (bstrcmpi(bp, p - 2, 'us') === 0) { /* lotus, fungus */
                    if (bstrcmpi(bp, p - 6, 'tengus') !== 0 /* but not these... */
                        && bstrcmpi(bp, p - 7, 'hezrous') !== 0)
                        break bottom;
                } else if (bstrcmpi(bp, p - 2, 'ss') === 0
                           || bstrcmpi(bp, p - 5, ' lens') === 0
                           || (p - 4 === 0 && strcmpi_at(bp, p - 4, 'lens') === 0)) {
                    break bottom;
                }
            }
            bp = bp.slice(0, p - 1); /* mins: drop s */

        } else { /* input doesn't end in 's' */

            if (bstrcmpi(bp, p - 3, 'men') === 0 && !badman(bp, false)) {
                bp = strcasecpy(bp, p - 2, 'an');
                break bottom;
            }
            /* matzot -> matzo, algae -> alga */
            if (bstrcmpi(bp, p - 6, 'matzot') === 0
                || bstrcmpi(bp, p - 2, 'ae') === 0
                || bstrcmpi(bp, p - 4, 'eaux') === 0) {
                bp = bp.slice(0, p - 1); /* drop t/e/x */
                break bottom;
            }
            /* balactheria -> balactherium */
            if (p - 4 >= 0 && strcmpi_at(bp, p - 2, 'ia') === 0
                && strchr('lr', lowc(bp[p - 3])) && lowc(bp[p - 4]) === 'e') {
                bp = strcasecpy(bp, p - 1, 'um'); /* a -> um */
            }

            /* here we cannot find the plural suffix */
        }
    }

    /* if we stripped off a suffix (" of bar" from "foo of bar"), put it back */
    if (excess != null)
        bp += excess;
    return setobuf(ob, bp);
}

// ── article / possessive / whitespace helpers ─────────────────────────────
/* hacklib.c:142 mungspaces() */
function mungspaces(bp) {
    let out = '', was_space = true;
    for (let i = 0; i < bp.length; i++) {
        let c = bp[i];
        if (c === '\n') break;
        if (c === '\t') c = ' ';
        if (c !== ' ' || !was_space) out += c;
        was_space = (c === ' ');
    }
    if (was_space && out.length > 0) out = out.slice(0, -1);
    return out;
}
/* hacklib.c:345 s_suffix() */
function s_suffix(s) {
    if (strcmpi(s, 'it')) return s + 's';        /* it -> its */
    if (strcmpi(s, 'you')) return s + 'r';       /* you -> your */
    if (s[s.length - 1] === 's') return s + "'"; /* Xs -> Xs' */
    return s + "'s";                             /* X -> X's */
}
/* hacklib.c digit() */
function digit(c) { return c >= '0' && c <= '9'; }

// just_an(): "", "a " or "an " for str.  C ref: objnam.c:2108.  Note the
// inverted sense of this file's strncmpi/strcmpi helpers (true == equal).
function just_an(str) {
    const c0 = lowc(str[0]);
    if (!str[1] || str[1] === ' ') {
        /* single letter; might be a named fruit or a musical note */
        return strchr('aefhilmnosx', c0) ? 'an ' : 'a ';
    }
    if (strncmpi(str, 'the ', 4)
        || strcmpi(str, 'molten lava')
        || strcmpi(str, 'iron bars')
        || strcmpi(str, 'ice'))
        return ''; /* no article */
    /* normal case is "an <vowel>" or "a <consonant>" */
    if ((strchr(vowels, c0)
         /* 'wun' initial sound */
         && (!strncmpi(str, 'one', 3) || (str[3] && !strchr('-_ ', str[3])))
         /* long 'u' initial sound */
         && !strncmpi(str, 'eu', 2) /* "eucalyptus leaf" */
         && !strncmpi(str, 'uke', 3) && !strncmpi(str, 'ukulele', 7)
         && !strncmpi(str, 'unicorn', 7) && !strncmpi(str, 'uranium', 7)
         && !strncmpi(str, 'useful', 6)) /* "useful tool" */
        || (c0 === 'x' && !strchr(vowels, lowc(str[1]))))
        return 'an ';
    return 'a ';
}
/* objnam.c:2144 an() */
function an(str) {
    const buf = nextobuf();
    if (!str) {
        impossible(`Alphabet soup: 'an(${str == null ? '<null>' : '""'})'.`);
        return setobuf(buf, 'an []');
    }
    return setobuf(buf, just_an(str) + str);
}

// obj_is_pname(): is obj's user-given name a personal name (an artifact's)?
// C ref: objnam.c:332.
export function obj_is_pname(obj) {
    if (!obj.oartifact || !has_oname(obj))
        return false;
    if (!program_state().gameover && !iflags().override_ID) {
        if (not_fully_identified(obj))
            return false;
    }
    return true;
}

// the_unique_obj(): "the unique_item" rather than "a unique_item".
// C ref: objnam.c:1105.  js/end.js:1338 and js/invent.js:8474 hold copies.
function the_unique_obj(obj) {
    const known = (obj.known || iflags().override_ID);
    if (!obj.dknown && !iflags().override_ID)
        return false;
    else if (obj.otyp === FAKE_AMULET_OF_YENDOR && !known)
        return true; /* lie */
    else
        return oc_unique(obj.otyp)
            && (known || obj.otyp === AMULET_OF_YENDOR_);
}

// the_unique_pm(): should the monster type be prefixed with "the"?
// C ref: objnam.c:1120.
function the_unique_pm(ptr) {
    if (!ptr) return false;
    if (type_is_pname(ptr))
        return false;
    let uniq = (ptr.geno & G_UNIQ) ? true : false;
    /* high priest is unique only when it includes "of <deity>"; worm tail is
       included for completeness */
    if (ptr.name === 'high cleric' || ptr.name === 'long worm tail')
        uniq = false;
    if (ptr.name === 'Wizard of Yendor')
        uniq = true;
    return uniq;
}

// armor_simple_name(): objnam.c:5434, with the seven *_simple_name() bodies
// (objnam.c:5470-5602) inlined.  js/do_wear.js holds the live copies of all
// eight; that module reaches this one through artifact.js, so the import edge
// cannot be reversed.
function armor_simple_name(armor) {
    const armcat = oc_armcat(armor.otyp);
    switch (armcat) {
    case ARM_SUIT: {
        if (Is_dragon_mail(armor)) return 'dragon mail';
        if (Is_dragon_scales(armor)) return 'dragon scales';
        const suitnm = OBJ_NAME(objects[armor.otyp]) || '';
        if (suitnm.length > 5 && suitnm.slice(-5) === ' mail') return 'mail';
        if (suitnm.length > 7 && suitnm.slice(-7) === ' jacket') return 'jacket';
        return 'suit';
    }
    case ARM_CLOAK:
        if (armor.otyp === ROBE) return 'robe';
        if (armor.otyp === MUMMY_WRAPPING) return 'wrapping';
        if (armor.otyp === ALCHEMY_SMOCK)
            return (objects[armor.otyp].oc_name_known && armor.dknown)
                ? 'smock' : 'apron';
        return 'cloak';
    case ARM_HELM:
        /* hard_helmet(): a metallic or crackable helmet */
        return !(is_helmet(armor) && (is_metallic(armor) || is_crackable(armor)))
            ? 'hat' : 'helm';
    case ARM_GLOVES: {
        if (armor.dknown) {
            const actualn = OBJ_NAME(objects[armor.otyp]);
            const descrpn = OBJ_DESCR(objects[armor.otyp]);
            const which = objects[armor.otyp].oc_name_known ? actualn : descrpn;
            if (which && strstri(which, 'gauntlets') >= 0) return 'gauntlets';
        }
        return 'gloves';
    }
    case ARM_BOOTS: {
        if (armor.dknown) {
            const actualn = OBJ_NAME(objects[armor.otyp]);
            const descrpn = OBJ_DESCR(objects[armor.otyp]);
            if ((descrpn && strstri(descrpn, 'shoes') >= 0)
                || (objects[armor.otyp].oc_name_known && actualn
                    && strstri(actualn, 'shoes') >= 0))
                return 'shoes';
        }
        return 'boots';
    }
    case ARM_SHIELD:
        if (armor.otyp === SHIELD_OF_REFLECTION)
            return armor.dknown ? 'silver shield' : 'smooth shield';
        return 'shield';
    case ARM_SHIRT:
        return 'shirt';
    default:
        impossible(`unknown armor category (${armcat})`);
        return OBJ_NAME(objects[armor.otyp]) || 'armor';
    }
}

// corpse_xname(): objnam.c:1823.  Needed by doname_base()'s CORPSE branch;
// js/invent.js:654 holds the live (reduced) copy.
function corpse_xname(otmp, adjective, cxn_flags) {
    const omndx = otmp.corpsenm;
    const ignore_quan = (cxn_flags & CXN_SINGULAR) !== 0;
    let no_prefix = (cxn_flags & 2 /*CXN_NO_PFX*/) !== 0,
        the_prefix = (cxn_flags & 4 /*CXN_PFX_THE*/) !== 0,
        any_prefix = (cxn_flags & CXN_ARTICLE) !== 0;
    const omit_corpse = (cxn_flags & CXN_NOCORPSE) !== 0;
    let possessive = false;
    const glob = (otmp.otyp !== CORPSE_ && otmp.globby);
    let mnam;

    /* some callers [aobjnam()] rely on the prefix area xname() sets aside */
    gx.xnamep = nextobuf();
    let nambuf = '';

    if (glob) {
        mnam = OBJ_NAME(objects[otmp.otyp]); /* "glob of <monster>" */
    } else if (omndx === NON_PM) { /* paranoia */
        mnam = 'thing';
    } else {
        mnam = obj_pmname(otmp);
        const ptr = mons_at(omndx);
        if (the_unique_pm(ptr) || type_is_pname(ptr)) {
            mnam = s_suffix(mnam);
            possessive = true;
            /* don't precede a personal name like "Medusa" with an article */
            if (type_is_pname(ptr))
                no_prefix = true;
            else if (the_unique_pm(ptr) && !no_prefix)
                the_prefix = true;
        }
    }
    if (no_prefix)
        the_prefix = any_prefix = false;
    else if (the_prefix)
        any_prefix = false; /* mutually exclusive */

    if (the_prefix)
        nambuf += 'the ';

    if (!adjective || !adjective.length) {
        nambuf += mnam; /* normal case:  newt corpse */
    } else {
        /* adjective positioning depends upon format of monster name */
        nambuf += possessive ? `${mnam} ${adjective}` /* Medusa's ... corpse */
            : `${adjective} ${mnam}`;                 /* cursed troll corpse */
        nambuf = mungspaces(nambuf);
        /* doname() might include a count in the adjective argument */
        if (digit(adjective[0]))
            any_prefix = false;
    }

    if (glob) {
        ; /* omit_corpse doesn't apply; quantity is always 1 */
    } else if (!omit_corpse) {
        nambuf += ' corpse';
        if (otmp.quan > 1 && !ignore_quan) {
            nambuf += 's'; /* makeplural() => append "s" to "corpse" */
            any_prefix = false; /* avoid "a newt corpses" */
        }
    }

    if (any_prefix) {
        nambuf = an(nambuf);
        releaseobuf(cur_obuf());
    }
    return setobuf(gx.xnamep, nambuf);
}

// add_erosion_words(): objnam.c:1142.  C appends to prefix[]; here the extended
// prefix is returned.  js/invent.js:1857 holds the live copy.
function add_erosion_words(obj, prefix) {
    const iscrys = (obj.otyp === CRYSKNIFE);
    const rknown = (iflags().override_ID ? true : !!obj.rknown);

    if (!is_damageable(obj) && !iscrys)
        return prefix;

    if (obj.oeroded && !iscrys) {
        switch (obj.oeroded) {
        case 2: prefix += 'very '; break;
        case 3: prefix += 'thoroughly '; break;
        }
        prefix += is_rustprone(obj) ? 'rusty '
            : is_crackable(obj) ? 'cracked '
                : 'burnt ';
    }
    if (obj.oeroded2 && !iscrys) {
        switch (obj.oeroded2) {
        case 2: prefix += 'very '; break;
        case 3: prefix += 'thoroughly '; break;
        }
        prefix += is_corrodeable(obj) ? 'corroded ' : 'rotted ';
    }
    /* an item can be both eroded and erodeproof */
    if (rknown && obj.oerodeproof)
        prefix += iscrys ? 'fixed '
            : is_rustprone(obj) ? 'rustproof '
                : is_corrodeable(obj) ? 'corrodeproof '
                    : is_flammable(obj) ? 'fireproof '
                        : is_crackable(obj) ? 'tempered '
                            : is_rottable(obj) ? 'rotproof '
                                : '';
    return prefix;
}

/* end-of-game readable text: js/read.js owns the live tshirt/apron/candy/
   Hawaiian text (it reaches this file through artifact.js). */
function tshirt_text(_obj) { return ''; }
function apron_text(_obj) { return ''; }
function candy_wrapper_text(_obj) { return ''; }
function hawaiian_motif(_obj) { return 'floral'; }

/* objnam.c gx.xnamep — start of the obuf xname()/corpse_xname() is filling. */
const gx = { xnamep: null };

// xname_flags(): the core object formatter.  C ref: objnam.c:580.
// The obuf/PREFIX split (buf = obuf + PREFIX, so doname_base() can strprepend
// into the reserved head) has no JS analogue; gx.xnamep is still set because
// corpse_xname()/doname_base() save and restore it.
export function xname_flags(obj, cxn_flags) {
    let buf = '';
    const typ = obj.otyp;
    const ocl = objects[typ];
    let nn = ocl.oc_name_known;
    const omndx = obj.corpsenm;
    let actualn = OBJ_NAME(ocl);
    let dn = OBJ_DESCR(ocl);
    const un = OBJ_UNAME(ocl);
    let pluralize = (obj.quan !== 1) && !(cxn_flags & CXN_SINGULAR);
    let known, dknown, bknown;

    gx.xnamep = nextobuf();

    if (Role_if(PM_SAMURAI)) {
        actualn = Japanese_item_name(typ, actualn);
        if (typ === WOODEN_HARP || typ === MAGIC_HARP_) dn = 'koto';
    }
    if (!actualn)
        actualn = (typ > 0 && typ < MAXOCLASSES) ? 'generic' : 'object?';
    /* must come after possibly overriding 'actualn' */
    if (!dn)
        dn = actualn;

    /* clean up 'known' when it's tied to oc_name_known, eg after AD_DRIN */
    if (!nn && ocl.oc_uses_known && oc_unique(typ))
        obj.known = 0;
    if (!Blind() && !gd_distantname)
        observe_object(obj);
    if (Role_if(PM_CLERIC))
        obj.bknown = 1; /* bypass set_bknown()/update_inventory() */

    if (iflags().override_ID) {
        known = dknown = bknown = true;
        nn = 1;
    } else {
        known = obj.known;
        dknown = obj.dknown;
        bknown = obj.bknown;
    }

    /* maybe find a previously unseen artifact (uses the real dknown) */
    if (obj.oartifact && obj.dknown)
        find_artifact(obj);

    let nameit = false;
    if (obj_is_pname(obj)) {
        nameit = true;
    } else {
    switch (obj.oclass) {
    case AMULET_CLASS:
        if (!dknown)
            buf = 'amulet';
        else if (typ === AMULET_OF_YENDOR_ || typ === FAKE_AMULET_OF_YENDOR)
            /* each must be identified individually */
            buf = known ? actualn : dn;
        else if (nn)
            buf = actualn;
        else if (un)
            buf = xcalled(buf, BUFSZ - PREFIX, 'amulet', un);
        else
            buf = `${dn} amulet`;
        break;
    case WEAPON_CLASS:
        if (is_poisonable(obj) && obj.opoisoned)
            buf = 'poisoned ';
        /* FALLTHRU */
    case VENOM_CLASS:
    case TOOL_CLASS:
        /* lenses/towel prefix would overwrite the poisoned-weapon prefix if
           both were possible, but they aren't */
        if (typ === LENSES)
            buf = 'pair of ';
        else if (is_wet_towel(obj))
            buf = (obj.spe < 3) ? 'moist ' : 'wet ';

        if (!dknown)
            buf += dn;
        else if (nn)
            buf += actualn;
        else if (un)
            buf = xcalled(buf, BUFSZ - PREFIX, dn, un);
        else
            buf += dn;

        if (typ === FIGURINE_ && omndx !== NON_PM) {
            const pm_name = obj_pmname(obj);
            buf += ` of ${just_an(pm_name)}${pm_name}`;
        } else if (is_wet_towel(obj)) {
            if (wizard())
                buf += ` (${obj.spe})`;
        }
        break;
    case ARMOR_CLASS:
        /* depends on order of the dragon scales objects */
        if (typ >= GRAY_DRAGON_SCALES && typ <= YELLOW_DRAGON_SCALES) {
            buf = `set of ${actualn}`;
            break;
        } else if (is_boots(obj) || is_gloves(obj)) {
            buf = 'pair of ';
            /* FALLTHRU */
        } else if (is_shield(obj) && !dknown) {
            if (obj.otyp >= ELVEN_SHIELD && obj.otyp <= ORCISH_SHIELD) {
                buf = 'shield';
                break;
            } else if (obj.otyp === SHIELD_OF_REFLECTION) {
                buf = 'smooth shield';
                break;
            }
        }

        if (nn)
            buf += actualn;
        else if (un)
            buf = xcalled(buf, BUFSZ - PREFIX, armor_simple_name(obj), un);
        else
            buf += dn;
        break;
    case FOOD_CLASS:
        if (typ === SLIME_MOLD_) {
            const f = fruit_from_indx(obj.spe);

            if (!f) {
                impossible(`Bad fruit #${obj.spe}?`);
                buf = 'fruit';
            } else {
                buf = f.fname;
                if (pluralize) {
                    /* already-pluralized fruit names are allowed, so singularize
                       first to avoid a redundant plural suffix */
                    buf = makesingular_full(buf);
                    releaseobuf(cur_obuf());
                    buf = makeplural(buf);
                    releaseobuf(cur_obuf());

                    pluralize = false;
                }
            }
            break;
        }
        if (iflags().partly_eaten_hack && obj.oeaten) {
            /* shrink_glob() wants "partly eaten" from Yname2() -> xname() */
            buf += 'partly eaten ';
        }
        if (obj.globby) { /* 5.0 added "medium" to replace no-prefix */
            buf += `${(obj.owt <= 100) ? 'small'
                : (obj.owt <= 300) ? 'medium'
                    : (obj.owt <= 500) ? 'large'
                        : 'very large'} ${actualn}`;
            break;
        }

        buf += actualn;
        if (typ === TIN_ && known)
            buf = tin_details(obj, omndx, buf);
        break;
    case COIN_CLASS:
    case CHAIN_CLASS:
        buf = actualn;
        break;
    case ROCK_CLASS:
        if (typ === STATUE_ && omndx !== NON_PM) {
            const statue_pmname = obj_pmname(obj);
            const ptr = mons_at(omndx);
            buf = `${(Role_if(PM_ARCHEOLOGIST)
                      && (obj.spe & CORPSTAT_HISTORIC) !== 0) ? 'historic ' : ''}`
                + `${actualn} of `
                + `${type_is_pname(ptr) ? ''
                    : the_unique_pm(ptr) ? 'the '
                        : just_an(statue_pmname)}${statue_pmname}`;
        } else if (typ === BOULDER_ && obj.next_boulder === 1) {
            /* "next boulder" when pushing against a pile of more than one */
            buf = `next ${actualn}`;
            obj.next_boulder = 0;
        } else {
            buf = actualn; /* "boulder" or "statue" */
        }
        break;
    case BALL_CLASS:
        buf = `${(obj.owt > base_oc_weight(obj)) ? 'very ' : ''}heavy iron ball`;
        break;
    case POTION_CLASS:
        if (dknown && obj.odiluted)
            buf = 'diluted ';
        if (nn || un || !dknown) {
            buf += 'potion';
            if (!dknown)
                break;
            if (nn) {
                buf += ' of ';
                if (typ === POT_WATER_ && bknown
                    && (obj.blessed || obj.cursed)) {
                    buf += obj.blessed ? 'holy ' : 'unholy ';
                }
                buf += actualn;
            } else {
                buf = xcalled(buf, BUFSZ - PREFIX, '', un);
            }
        } else {
            buf += dn;
            buf += ' potion';
        }
        break;
    case SCROLL_CLASS:
        buf = 'scroll';
        if (!dknown)
            break;
        if (nn) {
            buf += ' of ';
            buf += actualn;
        } else if (un) {
            buf = xcalled(buf, BUFSZ - PREFIX, '', un);
        } else if (ocl.oc_magic) {
            buf += ' labeled ';
            buf += dn;
        } else {
            buf = dn;
            buf += ' scroll';
        }
        break;
    case WAND_CLASS:
        if (!dknown)
            buf = 'wand';
        else if (nn)
            buf = `wand of ${actualn}`;
        else if (un)
            buf = xcalled(buf, BUFSZ - PREFIX, 'wand', un);
        else
            buf = `${dn} wand`;
        break;
    case SPBOOK_CLASS:
        if (typ === SPE_NOVEL_) { /* 3.6 tribute */
            if (!dknown)
                buf = 'book';
            else if (nn)
                buf = actualn;
            else if (un)
                buf = xcalled(buf, BUFSZ - PREFIX, 'novel', un);
            else
                buf = `${dn} book`;
            break;
        } else if (!dknown) {
            buf = 'spellbook';
        } else if (nn) {
            if (typ !== SPE_BOOK_OF_THE_DEAD_)
                buf = 'spellbook of ';
            buf += actualn;
        } else if (un) {
            buf = xcalled(buf, BUFSZ - PREFIX, 'spellbook', un);
        } else {
            buf = `${dn} spellbook`;
        }
        break;
    case RING_CLASS:
        if (!dknown)
            buf = 'ring';
        else if (nn)
            buf = `ring of ${actualn}`;
        else if (un)
            buf = xcalled(buf, BUFSZ - PREFIX, 'ring', un);
        else
            buf = `${dn} ring`;
        break;
    case GEM_CLASS: {
        const rock = (ocl.material === MINERAL) ? 'stone' : 'gem';

        if (!dknown) {
            buf = rock;
        } else if (!nn) {
            if (un)
                buf = xcalled(buf, BUFSZ - PREFIX, rock, un);
            else
                buf = `${dn} ${rock}`;
        } else {
            buf = actualn;
            if (GemStone(typ))
                buf += ' stone';
        }
        break;
    } /* gem */
    default:
        buf = `glorkum ${obj.oclass} ${typ} ${obj.spe}`;
        impossible(`xname_flags: ${buf}`);
        break;
    } /* switch */

    /* if the name should be plural, do that now */
    if (pluralize) {
        const obufp = makeplural(buf);
        buf = obufp;
        releaseobuf(cur_obuf());
    }

    /* extra information when the game is over; minimal_xname() passes a dummy
       object with o_id==0 so attribute disclosure omits the "with text" part */
    if (program_state().gameover && obj.o_id) {
        switch (obj.otyp) {
        case T_SHIRT:
        case ALCHEMY_SMOCK:
            buf += ` with text "${(obj.otyp === T_SHIRT) ? tshirt_text(obj)
                : apron_text(obj)}"`;
            break;
        case CANDY_BAR_: {
            const lbl = candy_wrapper_text(obj);
            if (lbl)
                buf += ` labeled "${lbl}"`;
            break;
        }
        case HAWAIIAN_SHIRT:
            buf += ` with ${an(hawaiian_motif(obj))} motif`;
            break;
        default:
            break;
        }
    }
    } /* !obj_is_pname(obj) */

    if (nameit || (has_oname(obj) && dknown)) {
        if (!nameit)
            buf += ' named ';
        /* nameit: jumped directly here when obj passes has-personal-name */
        const at = buf.length; /* where the name starts */
        buf += ONAME(obj);
        /* downcase "The" in "<quest-artifact-item> named The ..." */
        if (obj.oartifact && strncmp(buf.slice(at), 'The ', 4))
            buf = buf.slice(0, at) + lowc(buf[at]) + buf.slice(at + 1);
    }

    if (strncmpi(buf, 'the ', 4))
        buf = buf.slice(4);

    return setobuf(gx.xnamep, buf);
}

// xname(): objnam.c:574.  js/invent.js exports the live xname(); this is the
// xname_flags() wrapper the ports below need.
function xname_c(obj) { return xname_flags(obj, CXN_NORMAL); }

// minimal_xname(): the most basic info for a particular object — "potion",
// "brown potion", "potion of object detection".  C ref: objnam.c:1037.
export function minimal_xname(obj) {
    const otyp = obj.otyp;
    const saveobcls = {};

    /* suppress user-supplied name */
    saveobcls.oc_uname = objects[otyp].oc_uname;
    objects[otyp].oc_uname = 0;
    /* suppress actual name if the object's description is unknown */
    saveobcls.oc_name_known = objects[otyp].oc_name_known;
    if (iflags().override_ID)
        objects[otyp].oc_name_known = 1;
    else if (!obj.dknown)
        objects[otyp].oc_name_known = 0;

    /* cg.zeroobj plus the fields xname() needs */
    const bareobj = {
        otyp,
        oclass: obj.oclass,
        /* not observe_object: either the hero already saw it, or this is
           override-ID and shouldn't discover the object */
        dknown: (obj.dknown || iflags().override_ID) ? 1 : 0,
        /* suppress known except for amulets (real and fake A-of-Y) */
        known: (obj.oclass === AMULET_CLASS) ? obj.known
            : (objects[otyp].oc_uses_known ? 0 : 1),
        quan: 1, /* don't want plural */
        spe: 0, corpsenm: NON_PM, o_id: 0,
        blessed: 0, cursed: 0, bknown: 0, owt: 0, oeroded: 0, oeroded2: 0,
    };
    /* for a boulder, leave corpsenm 0; non-zero produces "next boulder" */
    if (otyp === BOULDER_)
        bareobj.corpsenm = 0;
    /* suppressing fruit details would lead to "bad fruit #0" */
    if (obj.otyp === SLIME_MOLD_)
        bareobj.spe = obj.spe;

    /* C: distant_name(&bareobj, xname).  bareobj is a stack copy that is not on
       the map, so get_obj_location() fails and distant_name() takes its
       ++gd.distantname branch; js/invent.js:521 holds the live distant_name(). */
    let bufp;
    ++gd_distantname;
    try {
        bufp = xname_c(bareobj);
    } finally {
        --gd_distantname;
    }
    /* undo the forced bareobj.blessed for a cleric (priest[ess]) */
    if (strncmp(bufp, 'uncursed ', 9))
        bufp = bufp.slice(9);

    objects[otyp].oc_uname = saveobcls.oc_uname;
    objects[otyp].oc_name_known = saveobcls.oc_name_known;
    return bufp;
}

// actualoname(): the basic name of obj as if it had been discovered.
// C ref: objnam.c:2489.
export function actualoname(obj) {
    iflags().override_ID = true;
    const res = minimal_xname(obj);
    iflags().override_ID = false;
    return res;
}

// singular(): format obj as if only one of it were present.
// C ref: objnam.c:2090.
export function singular(otmp, func) {
    /* using xname for corpses does not give the monster type */
    if (otmp.otyp === CORPSE_ && func === xname_c)
        func = (o) => corpse_xname(o, null, CXN_NORMAL);

    const savequan = otmp.quan;
    otmp.quan = 1;
    const nam = func(otmp);
    otmp.quan = savequan;
    return nam;
}

// doname_base(): the core of doname() — xname() plus every prefix (count,
// article, BUC, erosion, enchantment) and every parenthesised suffix (worn
// state, charges, price).  C ref: objnam.c:1222.
//
// The two internal goto labels are hoisted out of the switch as the
// `goto_charges` / `goto_ring` blocks below; each label is only ever entered at
// its top and is followed by `break`, so running it after the switch is exact.
export function doname_base(obj, doname_flags) {
    let ispoisoned = false;
    const with_price = (doname_flags & DONAME_WITH_PRICE) !== 0,
          vague_quan = (doname_flags & DONAME_VAGUE_QUAN) !== 0,
          for_menu = (doname_flags & DONAME_FOR_MENU) !== 0;
    let known, dknown, cknown, bknown, lknown;
    let prefix, tmpbuf, aname = null;
    const omndx = obj.corpsenm;
    let bp;

    bp = xname_c(obj);

    if (iflags().override_ID) {
        known = dknown = cknown = bknown = lknown = true;
    } else {
        known = obj.known;
        dknown = obj.dknown;
        cknown = obj.cknown;
        bknown = obj.bknown;
        lknown = obj.lknown;
    }

    /* xname gives "poisoned arrow", doname wants "poisoned +0 arrow"; must
       check opoisoned--someone can have a weirdly-named fruit */
    if (strncmp(bp, 'poisoned ', 9) && obj.opoisoned) {
        bp = bp.slice(9);
        ispoisoned = true;
    }

    /* fruits are allowed to be given artifact names; format like the
       corresponding artifact when that happens */
    const fake_arti = (obj.otyp === SLIME_MOLD_
                       && (aname = artifact_name(bp)) != null);
    const force_the = (fake_arti && strncmpi(aname, 'the ', 4));

    prefix = '';
    if (obj.quan !== 1) {
        if (dknown || !vague_quan)
            prefix = `${obj.quan} `;
        else
            prefix = 'some ';
    } else if (obj.otyp === CORPSE_) {
        /* skip article prefix for corpses [else corpse_xname() would have to
           be taught how to strip it off again] */
        ;
    } else if (force_the || obj_is_pname(obj) || the_unique_obj(obj)) {
        if (strncmpi(bp, 'the ', 4))
            bp = bp.slice(4);
        prefix = 'the ';
    } else if (!fake_arti) {
        prefix = 'a '; /* default prefix */
    }

    /* "empty" goes at the beginning, but item count goes at the end */
    if (cknown
        && ((obj.otyp === BAG_OF_TRICKS_ || obj.otyp === HORN_OF_PLENTY_)
            ? (obj.spe === 0 && !known)
            : ((Is_container(obj) || obj.otyp === STATUE_)
               && !Has_contents(obj))))
        prefix += 'empty ';

    if (bknown && obj.oclass !== COIN_CLASS
        && (obj.otyp !== POT_WATER_ || !objects[POT_WATER_].oc_name_known
            || (!obj.cursed && !obj.blessed))) {
        /* allow 'blessed clear potion' if we don't know it's holy water;
           always allow "uncursed potion of water" */
        if (obj.cursed)
            prefix += 'cursed ';
        else if (obj.blessed)
            prefix += 'blessed ';
        else if (!(flags().implicit_uncursed ?? true)
                 /* for most items with charges or +/-, knowing the count means
                    the item is fully identified, so "uncursed" is redundant */
                 || ((!known || !oc_charged(obj.otyp)
                      || obj.oclass === ARMOR_CLASS
                      || obj.oclass === RING_CLASS)
                     && obj.otyp !== 344 /*SCR_MAIL*/
                     && obj.otyp !== FAKE_AMULET_OF_YENDOR
                     && obj.otyp !== AMULET_OF_YENDOR_
                     && !Role_if(PM_CLERIC)))
            prefix += 'uncursed ';
    }

    if (Is_box(obj) && obj.otrapped && obj.tknown && obj.dknown)
        prefix += 'trapped ';
    if (lknown && Is_box(obj)) {
        if (obj.obroken)
            prefix += 'broken ';
        else if (obj.olocked)
            prefix += 'locked ';
        else
            prefix += 'unlocked ';
    }

    if (obj.greased)
        prefix += 'greased ';

    if (cknown && Has_contents(obj)) {
        /* the number of separate stacks == the invent slots needed to take
           everything out if no merges occur */
        const itemcount = count_contents(obj, false, false, true, false);

        bp += ` containing ${itemcount} item${plur(itemcount)}`;
    }

    let goto_charges = false, goto_ring = false;
    switch (is_weptool(obj) ? WEAPON_CLASS : obj.oclass) {
    case AMULET_CLASS:
        if (obj.owornmask & W_AMUL)
            bp += ' (being worn)';
        break;
    case ARMOR_CLASS:
        if (obj.owornmask & W_ARMOR) {
            bp += (obj === game.uskin) ? ' (embedded in your skin)'
                /* check doffing() before donning(): donning() is True for both */
                : doffing(obj) ? ' (being doffed)'
                    : donning(obj) ? ' (being donned)'
                        : ' (being worn)';
            if (bp[bp.length - 1] === ')') {
                /* gloves read as slippery when the hero has slippery fingers */
                if (obj === game.uarmg && Glib())
                    bp = bp.slice(0, -1) + '; slippery)';
            }
            if (bp[bp.length - 1] === ')') {
                if (!Blind() && obj.lamplit && artifact_light(obj))
                    bp = bp.slice(0, -1) + `, ${arti_light_description(obj)} lit)`;
            }
        }
        /* FALLTHRU */
    case WEAPON_CLASS:
        if (ispoisoned)
            prefix += 'poisoned ';
        prefix = add_erosion_words(obj, prefix);
        if (known)
            prefix += `${obj.spe >= 0 ? '+' : '-'}${Math.abs(obj.spe | 0)} `;
        break;
    case TOOL_CLASS:
        if (obj.owornmask & (W_TOOL | W_SADDLE)) { /* blindfold */
            bp += ' (being worn)';
            break;
        }
        if (obj.otyp === LEASH_ && obj.leashmon !== 0) {
            const mlsh = find_mid(obj.leashmon, 1 /*FM_FMON*/);

            if (mlsh && !mlsh.dead) {
                bp += ` (attached to ${noit_mon_nam(mlsh)})`;
            } else {
                impossible(`leashed monster #${obj.leashmon} not found`);
                obj.leashmon = 0;
            }
            break;
        }
        if (obj.otyp === CANDELABRUM_OF_INVOCATION_) {
            const suffix = `${plur(obj.spe)}${!obj.lamplit ? ' attached' : ', lit'}`;
            bp += ` (${obj.spe} of 7 candle${suffix})`;
            break;
        } else if (obj.otyp === OIL_LAMP_ || obj.otyp === MAGIC_LAMP_
                   || obj.otyp === BRASS_LANTERN_ || Is_candle(obj)) {
            if (Is_candle(obj)) {
                const full_burn_time = 20 * (OBJ_COST[obj.otyp] | 0);
                let turns_left = obj.age;

                if (obj.lamplit) {
                    /* without this, wishing for "lit candle" yields "partly
                       used candle (lit)" */
                    turns_left += peek_timer(1 /*BURN_OBJECT*/, obj) - moves();
                }
                if (turns_left < full_burn_time)
                    prefix += 'partly used ';
            }
            if (obj.lamplit)
                bp += ' (lit)';
            break;
        }
        if (oc_charged(obj.otyp))
            goto_charges = true;
        break;
    case WAND_CLASS:
        goto_charges = true;
        break;
    case POTION_CLASS:
        if (obj.otyp === POT_OIL_ && obj.lamplit)
            bp += ' (lit)';
        break;
    case RING_CLASS:
        goto_ring = true; /* meat ring jumps here too */
        break;
    case FOOD_CLASS:
        if (obj.oeaten)
            prefix += 'partly eaten ';
        if (obj.otyp === CORPSE_) {
            /* (quan == 1) => want corpse_xname() to supply the article,
               (quan != 1) => already have a count or "some" as prefix */
            const cxarg = (((obj.quan !== 1) ? 0 : CXN_ARTICLE) | CXN_NOCORPSE);
            const save_xnamep = gx.xnamep;

            const cxstr = corpse_xname(obj, prefix, cxarg);
            prefix = `${cxstr} `;
            releaseobuf(cur_obuf()); /* avoid consuming an extra obuf */
            gx.xnamep = save_xnamep;
        } else if (obj.otyp === EGG_) {
            if (ismnum(omndx)
                && (known || (mvitals_mvflags(omndx) & 0x04 /*MV_KNOWS_EGG*/))) {
                prefix += `${mons_at(omndx)?.name ?? ''} `;
                if (obj.spe === 1)
                    bp += ' (laid by you)';
            }
        } else if (obj.otyp === MEAT_RING_) {
            goto_ring = true;
        }
        break;
    case BALL_CLASS:
    case CHAIN_CLASS:
        prefix = add_erosion_words(obj, prefix);
        if (obj.owornmask & (W_BALL | W_CHAIN))
            bp += ` (${(obj.owornmask & W_BALL) ? 'chained' : 'attached'} to you)`;
        break;
    }
    if (goto_charges) { /* objnam.c:1484 'charges:' */
        if (known)
            bp += ` (${obj.recharged | 0}:${obj.spe | 0})`;
    }
    if (goto_ring) { /* objnam.c:1493 'ring:' */
        if (obj.owornmask & W_RINGR)
            bp += ' (on right ';
        if (obj.owornmask & W_RINGL)
            bp += ' (on left ';
        if (obj.owornmask & W_RING) /* either left or right */
            bp += `${body_part_HAND()})`;
        if (known && oc_charged(obj.otyp))
            prefix += `${obj.spe >= 0 ? '+' : '-'}${Math.abs(obj.spe | 0)} `;
    }

    if ((obj.otyp === STATUE_ || obj.otyp === CORPSE_ || obj.otyp === FIGURINE_)
        && wizard() && iflags().wizmgender) {
        const cgend = (obj.spe & CORPSTAT_GENDER),
              mgend = ((cgend === CORPSTAT_MALE) ? MALE
                  : (cgend === CORPSTAT_FEMALE) ? FEMALE
                      : NEUTRAL);

        bp += ` (${(cgend !== CORPSTAT_RANDOM) ? genders[mgend].adj
            : 'unspecified gender'})`;
    }

    if ((obj.owornmask & W_WEP) && !game.gm?.mrg_to_wielded) {
        const twoweap_primary = (obj === game.uwep && game.u?.twoweap),
              tethered = (obj.otyp === AKLYS);

        /* alternate phrasing for non-weapons and for wielded ammo/missiles,
           except when actively dual-wielding */
        if ((obj.quan !== 1
             || ((obj.oclass === WEAPON_CLASS)
                 ? (is_ammo(obj) || is_missile(obj))
                 : !is_weptool(obj)))
            && !twoweap_primary) {
            bp += ' (wielded)';
        } else {
            let hand_s = body_part_HAND();

            if (bimanual(obj)) { /* "hands" */
                hand_s = makeplural(hand_s);
                releaseobuf(cur_obuf());
            } else { /* "right hand" or "left hand" */
                hand_s = `${URIGHTY() ? 'right' : 'left'} ${hand_s}`;
            }
            bp += ` (${tethered ? 'tethered to'
                : twoweap_primary ? 'wielded in'
                    : 'weapon in'} ${hand_s})`;

            if (!Blind() && bp[bp.length - 1] === ')') {
                if (game.gw?.warn_obj_cnt && obj === game.uwep
                    && ((game.EWarn_of_mon | 0) & W_WEP) !== 0)
                    bp = bp.slice(0, -1)
                        + `, ${glow_verb(game.gw.warn_obj_cnt, true)} `
                        + `${glow_color(obj.oartifact)})`;
                else if (obj.lamplit && artifact_light(obj))
                    bp = bp.slice(0, -1) + `, ${arti_light_description(obj)} lit)`;
            }
        }
    }
    if (obj.owornmask & W_SWAPWEP) {
        if (game.u?.twoweap)
            bp += ` (wielded in ${URIGHTY() ? 'left' : 'right'} ${body_part_HAND()})`;
        else
            bp += ` (alternate weapon${plur(obj.quan)}; not wielded)`;
    }
    if (obj.owornmask & W_QUIVER) {
        let Qtyp;

        switch (obj.oclass) {
        case WEAPON_CLASS:
            Qtyp = !is_ammo(obj) ? 3 /* not ammo: "at the ready" */
                : ((objects[obj.otyp]?.oc_skill | 0) !== -11 /*-P_BOW*/) ? 2
                    : 1; /* ammo for a bow: "in quiver" */
            break;
        case RING_CLASS:
        case AMULET_CLASS:
        case WAND_CLASS:
        case COIN_CLASS:
        case GEM_CLASS:
            Qtyp = 2; /* small, non-bow: "in quiver pouch" */
            break;
        default: /* odd things */
            Qtyp = 3; /* "at the ready" */
            break;
        }
        bp += ` (${(Qtyp === 1) ? 'in quiver'
            : (Qtyp === 2) ? 'in quiver pouch' : 'at the ready'})`;
    }

    /* 'restoring' is treated like suppress_price because the shopkeeper and
       bill might not be available yet */
    if (iflags().suppress_price || program_state().restoring) {
        ; /* don't attempt to obtain any shop pricing */
    } else if (is_unpaid(obj)) { /* in invent, or in a container in invent */
        const quotedprice = unpaid_cost(obj, COST_CONTENTS);
        const pricebuf = `${quotedprice} ${currency(quotedprice)}`;

        bp += ` (${obj.unpaid ? 'unpaid' : 'contents'}, ${pricebuf})`;
        record_price_quote(obj.otyp, quotedprice / obj.quan, true);
    } else if (with_price) { /* on floor or in a container on the floor */
        /* C: get_cost_of_shop_item(obj, &nochrg); js/shk.js returns the pair */
        const gcs = get_cost_of_shop_item(obj);
        const nochrg = gcs.nochrg, price = gcs.cost;

        if (price > 0) {
            const pricebuf = `${price} ${currency(price)}`;
            bp += ` (${nochrg ? 'contents' : 'for sale'}, ${pricebuf})`;
        } else if (nochrg > 0) {
            bp += ' (no charge)';
        } else if (iflags().pricequotes && !objects[obj.otyp].oc_name_known) {
            bp = append_price_quote(bp, obj.otyp);
        }

        if (price > 0)
            record_price_quote(obj.otyp, price / obj.quan, true);
    } else if (iflags().pricequotes && !objects[obj.otyp].oc_name_known) {
        bp = append_price_quote(bp, obj.otyp);
    }

    if (strncmp(prefix, 'a ', 2)) {
        /* save the current prefix without "a "; might be empty */
        tmpbuf = prefix.slice(2);
        /* set prefix to "", "a ", or "an " */
        prefix = just_an(tmpbuf ? tmpbuf : bp);
        /* append the remainder of the original prefix */
        prefix += tmpbuf;
    }

    /* show weight for items (debug tourist info) */
    if (wizard() && iflags().wizweight) {
        if (with_price && bp[bp.length - 1] === ')')
            bp = bp.slice(0, -1) + `, ${obj.owt} aum)`;
        else
            bp += ` (${obj.owt} aum)`;
    }

    bp = strprepend(bp, prefix);

    /* last-gasp bounds check (objnam.c:1713-1748) */
    const offsetbp = for_menu ? 4 : 0;
    if (bp.length + offsetbp >= BUFSZ - 1)
        bp = bp.slice(0, BUFSZ - 1 - offsetbp);

    return bp;
}

/* doname_base() helpers that read hero state this port keeps elsewhere. */
/* do_wear.c doffing()/donning(): this port tracks the in-progress Wear/Takeoff
   in game._dressing_obj/_dressing_off (js/do_wear.js:883, which reaches this
   file through artifact.js, so it can't be imported here). */
function doffing(obj) { return !!obj && game._dressing_obj === obj && !!game._dressing_off; }
function donning(obj) {
    return doffing(obj) || (!!obj && game._dressing_obj === obj && !game._dressing_off);
}
/* youprop.h Glib — slippery fingers (js/botl.js:365 reads the same property) */
function Glib() { return (game.u?.uprops?.Glib?.intrinsic | 0) > 0
    || (game.u?.Glib | 0) > 0; }
/* you.h:564 URIGHTY == (u.uhandedness == RIGHT_HANDED(0)); u_init.c sets
   uhandedness with rn2(10) at chargen (see js/bones.js:1066) */
function URIGHTY() { return (game.u?.uhandedness | 0) === 0; }
/* mvitals[].mvflags — js/mon.js owns the live table */
function mvitals_mvflags(mndx) { return game.svm?.mvitals?.[mndx]?.mvflags | 0; }

// doname(): objnam.c:1753.  js/invent.js exports the live doname(); these three
// wrappers exist so the doname_base() flags are named where C names them.
export function doname_c(obj) { return doname_base(obj, 0); }
export function doname_with_price_c(obj) { return doname_base(obj, DONAME_WITH_PRICE); }
export function doname_vague_quan_c(obj) { return doname_base(obj, DONAME_VAGUE_QUAN); }
