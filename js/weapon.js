// weapon.js — port of C src/weapon.c (to-hit / damage bonus calculation and
// the weapon-skill bookkeeping that has no other home).
//
// This file is the SINGLE owner of hitval()/dmgval()/weapon_type().  Four
// independent partial copies used to live in uhitm.js, invent.js, monmove.js
// and mhitm.js; each omitted a different subset of C's arms (the large-monster
// IRON_CHAIN case, the silver rnd(20), the thick-skinned zeroing, ...), so the
// same swing rolled different dice depending on which caller reached it.
//
// Deliberately kept low in the module graph: only leaf data modules plus
// mon.js/makemon.js/worn.js, all of which are already loaded before any
// combat runs.
import { game } from './gstate.js';
import { rn2, rnd, d } from './rng.js';
import { objects, WEAPON_CLASS, TOOL_CLASS, GEM_CLASS, BALL_CLASS,
         CHAIN_CLASS, HEAVY_IRON_BALL } from './mkobj.js';
import { WEP_SDAM, WEP_LDAM, WEP_HITBON } from './weapondmg_data.js';
import { mflags1_of, mflags2_of, M1_THICK_HIDE, M1_WALLWALK, M1_SWIM,
         M2_UNDEAD, M2_DEMON } from './monflags_data.js';
import { P_NONE, P_BARE_HANDED_COMBAT, P_AXE, P_SPEAR, P_PICK_AXE,
         P_ISRESTRICTED, P_UNSKILLED, P_BASIC, P_SKILLED, P_EXPERT,
         P_LAST_WEAPON, P_LAST_SPELL, P_NUM_SKILLS,
         P_TWO_WEAPON_COMBAT, P_RIDING, A_STR, A_DEX,
         W_ARM, W_ARMC, W_ARMU, W_ARMG, W_RINGL, W_RINGR } from './const.js';
import { name_to_pmidx, monster_by_pmidx } from './makemon.js';
import { mon_hates_silver } from './mon.js';
import { which_armor } from './worn.js';
import { attacktype, AT_WEAP } from './monattk_data.js';
import { acurr_eff } from './attrib.js';
// artifact.c spec_abon()/spec_dbon(): both were local `return 0` stubs, so a
// wielded artifact's rnd(attk.damn) to-hit draw never happened.
import { spec_abon, spec_dbon } from './artifact.js';

// C ref: objects.h oc_material enum (mkobj.js keeps the same numbering).
const MAT_LEATHER = 7, MAT_SILVER = 14;
// otyps, mkobj.js numbering (verified against js/mkobj.js OBJECT_DATA).
const W_ = {
    CREAM_PIE: 287, IRON_CHAIN: 478, CROSSBOW_BOLT: 23, MORNING_STAR: 75,
    PARTISAN: 59, RUNESWORD: 58, ELVEN_BROADSWORD: 53, BROADSWORD: 52,
    FLAIL: 81, RANSEUR: 60, VOULGE: 65, ACID_VENOM: 480, HALBERD: 63,
    SPETUM: 61, BATTLE_AXE: 45, BARDICHE: 64, TRIDENT: 33, TSURUGI: 57,
    DWARVISH_MATTOCK: 71, TWO_HANDED_SWORD: 55, MACE: 73, SILVER_MACE: 74,
    WAR_HAMMER: 76, BILL_GUISARME: 68, GUISARME: 67, LUCERN_HAMMER: 69,
};
// C ref: monsym.h — the mlet indices weapon.c's kebabable[] names.
const S_XORN = 50, S_DRAGON = 30, S_JABBERWOCK = 36, S_NAGA = 40, S_GIANT = 34,
      S_EEL = 57, S_SNAKE = 45;
const KEBABABLE = new Set([S_XORN, S_DRAGON, S_JABBERWOCK, S_NAGA, S_GIANT]);
// C ref: weight.h:18 WT_IRON_BALL_INCR.
const WT_IRON_BALL_INCR = 160;

let _PM_SHADE = -1;
function PM_SHADE() {
    if (_PM_SHADE < 0) _PM_SHADE = name_to_pmidx('shade') ?? -2;
    return _PM_SHADE;
}

// ── predicates weapon.c reads out of obj.h / mondata.h ──
// C ref: obj.h is_weptool(o) — a TOOL_CLASS object with a nonzero oc_skill.
export function is_weptool(obj) {
    return obj?.oclass === TOOL_CLASS && (objects[obj.otyp]?.oc_skill ?? 0) !== 0;
}
// C ref: obj.h is_pick / is_axe / is_spear — oc_skill of a weapon or weptool.
function oc_skill_of(obj) { return objects[obj?.otyp]?.oc_skill ?? 0; }
function weapon_or_weptool(obj) {
    return obj?.oclass === WEAPON_CLASS || obj?.oclass === TOOL_CLASS;
}
export function is_pick(obj) {
    return weapon_or_weptool(obj) && oc_skill_of(obj) === P_PICK_AXE;
}
export function is_axe(obj) {
    return weapon_or_weptool(obj) && oc_skill_of(obj) === P_AXE;
}
export function is_spear(obj) {
    return obj?.oclass === WEAPON_CLASS && oc_skill_of(obj) === P_SPEAR;
}
// C ref: mondata.h thick_skinned / passes_walls / is_swimmer.
function thick_skinned(ptr) { return (mflags1_of(ptr) & M1_THICK_HIDE) !== 0; }
function passes_walls(ptr) { return (mflags1_of(ptr) & M1_WALLWALK) !== 0; }
function is_swimmer(ptr) { return (mflags1_of(ptr) & M1_SWIM) !== 0; }
// C ref: mondata.c hates_blessings(ptr) = is_undead(ptr) || is_demon(ptr);
// mon_hates_blessings(mon) adds is_vampshifter(mon) (mon->cham, untracked).
export function mon_hates_blessings(mon) {
    return (mflags2_of(mdata_of(mon)) & (M2_UNDEAD | M2_DEMON)) !== 0;
}
// C ref: mondata.h is_wooden(ptr) — the wood golem alone.
let _PM_WOOD_GOLEM = -1;
function is_wooden(ptr) {
    if (_PM_WOOD_GOLEM < 0) _PM_WOOD_GOLEM = name_to_pmidx('wood golem') ?? -2;
    return ptr?.pmidx === _PM_WOOD_GOLEM;
}
// C ref: mondata.h hates_light(ptr) — the gremlin alone.
let _PM_GREMLIN = -1;
function hates_light(ptr) {
    if (_PM_GREMLIN < 0) _PM_GREMLIN = name_to_pmidx('gremlin') ?? -2;
    return ptr?.pmidx === _PM_GREMLIN;
}
// C ref: mondata.h bigmonst(ptr) — msize >= MZ_LARGE.
const MZ_LARGE = 3;
function bigmonst(ptr) { return (ptr?.msize ?? 2 /* MZ_MEDIUM */) >= MZ_LARGE; }
// C ref: obj.h greatest_erosion(otmp).
export function greatest_erosion(otmp) {
    return Math.max(otmp?.oeroded | 0, otmp?.oeroded2 | 0);
}
// C ref: artifact.c shade_glare(obj) — any silver object works; the artifact
// arm needs artilist SPFX_DFLAG2/M2_UNDEAD, which no live path reaches.
function shade_glare(obj) {
    return objects[obj?.otyp]?.material === MAT_SILVER;
}
// artifact.c artifact_light(obj) — no artifact is wired into the live paths.
function artifact_light(_obj) { return false; }

// The defender's permonst.  Callers pass a real monster (mon.data), the
// youmonst pseudo-monster, or bare game.u; C always has &youmonst.data.
function mdata_of(mon) {
    if (!mon) return null;
    if (mon.data) return mon.data;
    if (mon === game.u || mon._isyou || mon === game.youmonst)
        return monster_by_pmidx(game.u?.umonnum ?? -1);
    return null;
}

// C ref: weapon.c:1517 weapon_type(obj) — |oc_skill|; ammo carries the negated
// launcher skill.  A NULL object is bare-handed combat, and anything outside
// WEAPON/TOOL/GEM is P_NONE (three of the four old copies dropped that gate,
// so a wielded corpse answered with whatever oc_skill garbage sat at its otyp).
export function weapon_type(obj) {
    if (!obj) return P_BARE_HANDED_COMBAT;
    if (obj.oclass !== WEAPON_CLASS && obj.oclass !== TOOL_CLASS
        && obj.oclass !== GEM_CLASS)
        return P_NONE;
    const type = objects[obj.otyp]?.oc_skill ?? P_NONE;
    return type < 0 ? -type : type;
}

// C ref: weapon.c:149 hitval(otmp, mon).
export function hitval(otmp, mon) {
    if (!otmp) return 0;
    const ptr = mdata_of(mon);
    let tmp = 0;
    // Objects built without an oclass field predate the class column and are
    // treated as weapons (the pre-existing convention in uhitm.js).
    const Is_weapon = otmp.oclass === undefined
        || otmp.oclass === WEAPON_CLASS || is_weptool(otmp);

    if (Is_weapon) tmp += otmp.spe | 0;
    tmp += WEP_HITBON[otmp.otyp] || 0;

    if (Is_weapon && otmp.blessed && mon_hates_blessings(mon)) tmp += 2;

    if (is_spear(otmp) && KEBABABLE.has(ptr?.mcls)) tmp += 2;

    if (otmp.otyp === W_.TRIDENT && is_swimmer(ptr)) {
        if (is_pool_at(mon?.mx, mon?.my)) tmp += 4;
        else if (ptr?.mcls === S_EEL || ptr?.mcls === S_SNAKE) tmp += 2;
    }

    if (is_pick(otmp) && passes_walls(ptr) && thick_skinned(ptr)) tmp += 2;

    if (otmp.oartifact) tmp += spec_abon(otmp, mon);
    return tmp;
}

// rm.h is_pool(x,y) — POOL/MOAT/WATER at that square.  Read through the live
// level map; an off-level or unknown square is dry.
const POOL = 20, MOAT = 21, WATER = 22; // C ref: rm.h typ values
function is_pool_at(x, y) {
    if (x == null || y == null) return false;
    const typ = game.level?.locations?.[x]?.[y]?.typ;
    return typ === POOL || typ === MOAT || typ === WATER;
}


// C ref: weapon.c:216 dmgval(otmp, mon).
export function dmgval(otmp, mon) {
    if (!otmp) return 1;
    const otyp = otmp.otyp;
    const ptr = mdata_of(mon);
    let tmp = 0;
    const Is_weapon = otmp.oclass === undefined
        || otmp.oclass === WEAPON_CLASS || is_weptool(otmp);

    if (otyp === W_.CREAM_PIE) return 0;

    if (bigmonst(ptr)) {
        const d0 = WEP_LDAM[otyp];
        if (d0) tmp = rnd(d0);
        switch (otyp) {
        case W_.IRON_CHAIN: case W_.CROSSBOW_BOLT: case W_.MORNING_STAR:
        case W_.PARTISAN: case W_.RUNESWORD: case W_.ELVEN_BROADSWORD:
        case W_.BROADSWORD:
            tmp++; break;
        case W_.FLAIL: case W_.RANSEUR: case W_.VOULGE:
            tmp += rnd(4); break;
        case W_.ACID_VENOM: case W_.HALBERD: case W_.SPETUM:
            tmp += rnd(6); break;
        case W_.BATTLE_AXE: case W_.BARDICHE: case W_.TRIDENT:
            tmp += d(2, 4); break;
        case W_.TSURUGI: case W_.DWARVISH_MATTOCK: case W_.TWO_HANDED_SWORD:
            tmp += d(2, 6); break;
        default: break;
        }
    } else {
        const d0 = WEP_SDAM[otyp];
        if (d0) tmp = rnd(d0);
        switch (otyp) {
        case W_.IRON_CHAIN: case W_.CROSSBOW_BOLT: case W_.MACE:
        case W_.SILVER_MACE: case W_.WAR_HAMMER: case W_.FLAIL:
        case W_.SPETUM: case W_.TRIDENT:
            tmp++; break;
        case W_.BATTLE_AXE: case W_.BARDICHE: case W_.BILL_GUISARME:
        case W_.GUISARME: case W_.LUCERN_HAMMER: case W_.MORNING_STAR:
        case W_.RANSEUR: case W_.BROADSWORD: case W_.ELVEN_BROADSWORD:
        case W_.RUNESWORD: case W_.VOULGE:
            tmp += rnd(4); break;
        case W_.ACID_VENOM:
            tmp += rnd(6); break;
        default: break;
        }
    }
    if (Is_weapon) {
        tmp += otmp.spe | 0;
        // negative enchantment mustn't produce negative damage
        if (tmp < 0) tmp = 0;
    }

    const mat = objects[otyp]?.material;
    if (mat != null && mat <= MAT_LEATHER && thick_skinned(ptr))
        tmp = 0;
    if (ptr && ptr.pmidx === PM_SHADE() && !shade_glare(otmp))
        tmp = 0;

    if (otyp === HEAVY_IRON_BALL && tmp > 0) {
        let wt = objects[HEAVY_IRON_BALL]?.oc_weight ?? 480;
        if ((otmp.owt | 0) > wt) {
            wt = ((otmp.owt | 0) - wt) / WT_IRON_BALL_INCR | 0;
            tmp += rnd(4 * wt);
            if (tmp > 25) tmp = 25; /* objects[].oc_wldam */
        }
    }

    if (Is_weapon || otmp.oclass === GEM_CLASS || otmp.oclass === BALL_CLASS
        || otmp.oclass === CHAIN_CLASS) {
        let bonus = 0;

        if (otmp.blessed && mon_hates_blessings(mon)) bonus += rnd(4);
        if (is_axe(otmp) && is_wooden(ptr)) bonus += rnd(4);
        if (mat === MAT_SILVER && mon && mon_hates_silver_any(mon)) bonus += rnd(20);
        if (artifact_light(otmp) && otmp.lamplit && hates_light(ptr))
            bonus += rnd(8);

        if (bonus > 1 && otmp.oartifact && spec_dbon(otmp, mon, 25) >= 25)
            bonus = ((bonus + 1) / 2) | 0;

        tmp += bonus;
    }

    if (tmp > 0) {
        tmp -= greatest_erosion(otmp);
        if (tmp < 1) tmp = 1;
    }
    return tmp;
}

// mon.js's mon_hates_silver() dereferences mon.data directly; the hero-as-
// defender callers pass game.u, so resolve the permonst first.
function mon_hates_silver_any(mon) {
    if (mon?.data) return mon_hates_silver(mon);
    const ptr = mdata_of(mon);
    return ptr ? mon_hates_silver({ data: ptr }) : false;
}

// C ref: weapon.c:361 special_dmgval(magr, mdef, armask, silverhit_p) — the
// blessed/silver extra damage for a *non-weapon* hit (claw/kick/bite while
// wearing blessed or silver gear).  Returns { bonus, silverhit }.
export function special_dmgval(magr, mdef, armask) {
    const left_ring = (armask & W_RINGL) !== 0;
    const right_ring = (armask & W_RINGR) !== 0;
    let silverhit = 0;
    let bonus = 0;
    let obj = null;

    if (armask & (W_ARMC | W_ARM | W_ARMU)) {
        if ((armask & W_ARMC) && (obj = which_armor(magr, W_ARMC))) armask = W_ARMC;
        else if ((armask & W_ARM) && (obj = which_armor(magr, W_ARM))) armask = W_ARM;
        else if ((armask & W_ARMU) && (obj = which_armor(magr, W_ARMU))) armask = W_ARMU;
        else armask = 0;
    } else if (armask & (W_ARMG | W_RINGL | W_RINGR)) {
        obj = which_armor(magr, W_ARMG);
        armask = obj ? W_ARMG : 0;
    } else {
        obj = which_armor(magr, armask);
    }

    if (obj) {
        if (obj.blessed && mon_hates_blessings(mdef)) bonus += rnd(4);
        if (objects[obj.otyp]?.material === MAT_SILVER
            && mon_hates_silver_any(mdef)) {
            bonus += rnd(20);
            silverhit |= armask;
        }
    } else if ((left_ring || right_ring) && is_hero(magr)) {
        const uleft = game.uleft, uright = game.uright;
        if (left_ring && uleft) {
            if (objects[uleft.otyp]?.material === MAT_SILVER
                && mon_hates_silver_any(mdef)) {
                bonus += rnd(20);
                silverhit |= W_RINGL;
            }
        }
        if (right_ring && uright) {
            if (objects[uright.otyp]?.material === MAT_SILVER
                && mon_hates_silver_any(mdef)) {
                // two silver rings don't give double silver damage
                if (!(silverhit & W_RINGL)) bonus += rnd(20);
                silverhit |= W_RINGR;
            }
        }
    }
    return { bonus, silverhit };
}

function is_hero(mon) {
    return !!mon && (mon === game.u || mon === game.youmonst || mon._isyou === true);
}

// C ref: weapon.c:436 silver_sears(magr, mdef, silverhit) — "Your silver rings
// sear <mon>!".  Only the ring half exists in C (a weapon hit prints its own).
export async function silver_sears(_magr, mdef, silverhit) {
    if (!(silverhit & (W_RINGL | W_RINGR))) return;
    const uleft = game.uleft, uright = game.uright;
    const STRANGE_OBJECT = 0;
    const ltyp = (uleft && (silverhit & W_RINGL)) ? uleft.otyp : STRANGE_OBJECT;
    const rtyp = (uright && (silverhit & W_RINGR)) ? uright.otyp : STRANGE_OBJECT;
    const l_dknown = !!(uleft && uleft.dknown), r_dknown = !!(uright && uright.dknown);
    const l_ag = objects[ltyp]?.material === MAT_SILVER && l_dknown;
    const r_ag = objects[rtyp]?.material === MAT_SILVER && r_dknown;
    const both = ((ltyp === rtyp && l_dknown === r_dknown) || (l_ag && r_ag));
    const rings = both ? 'rings' : 'ring';
    const which = (l_ag || r_ag) ? 'silver '
        : both ? ''
        : (silverhit & W_RINGL) ? 'left ' : 'right ';
    const { pline } = await import('./display.js');
    const { mon_nam } = await import('./uhitm.js');
    await pline(`Your ${which}${rings} ${both ? 'sear' : 'sears'} ${mon_nam(mdef)}!`);
}

// C ref: weapon.c:90 weapon_descr(obj) — the weapon's skill-category name, used
// to shorten involuntary-drop messages.
const ODD_SKILL_NAMES = [
    'no skill', 'bare hands', 'two weapon combat', 'riding', 'polearms',
    'saber', 'hammer', 'whip', 'attack spells', 'healing spells',
    'divination spells', 'enchantment spells', 'clerical spells',
    'escape spells', 'matter spells',
];
// C ref: weapon.c skill_names_indices[] — negative entries index
// odd_skill_names[], positive ones are otyps whose OBJ_NAME supplies the label.
const SKILL_NAMES_INDICES = [
    0, 34 /*DAGGER*/, 40 /*KNIFE*/, 44 /*AXE*/, 259 /*PICK_AXE*/,
    46 /*SHORT_SWORD*/, 52 /*BROADSWORD*/, 54 /*LONG_SWORD*/,
    55 /*TWO_HANDED_SWORD*/, -5 /*PN_SABER*/, 77 /*CLUB*/, 73 /*MACE*/,
    75 /*MORNING_STAR*/, 81 /*FLAIL*/, -6 /*PN_HAMMER*/, 79 /*QUARTERSTAFF*/,
    -4 /*PN_POLEARMS*/, 27 /*SPEAR*/, 33 /*TRIDENT*/, 72 /*LANCE*/,
    83 /*BOW*/, 87 /*SLING*/, 88 /*CROSSBOW*/, 24 /*DART*/, 25 /*SHURIKEN*/,
    26 /*BOOMERANG*/, -7 /*PN_WHIP*/, 261 /*UNICORN_HORN*/,
    -8, -9, -10, -11, -12, -13, -14,
    -1 /*PN_BARE_HANDED*/, -2 /*PN_TWO_WEAPONS*/, -3 /*PN_RIDING*/,
];
// C ref: objclass.h def_oc_syms[].name — the class-name fallback.
const OC_CLASS_NAME = {
    1: 'illegal object', 2: 'weapon', 3: 'armor', 4: 'ring', 5: 'amulet',
    6: 'tool', 7: 'food', 8: 'potion', 9: 'scroll', 10: 'spellbook',
    11: 'wand', 12: 'coin', 13: 'gem', 14: 'large rock', 15: 'iron ball',
    16: 'iron chain', 17: 'venom',
};
export function weapon_descr(obj) {
    const skill = weapon_type(obj);
    const idx = SKILL_NAMES_INDICES[skill] ?? 0;
    let descr = idx > 0 ? (objects[idx]?.name || 'weapon')
        : skill === P_BARE_HANDED_COMBAT ? 'bare handed combat'
        : ODD_SKILL_NAMES[-idx];
    if (skill === P_NONE) {
        const nm = objects[obj?.otyp]?.name || '';
        // C names the otyps explicitly (CORPSE/TIN/EGG/STATUE/BOULDER/TOWEL/
        // TIN_OPENER); mkobj.js otyps, verified against OBJECT_DATA.
        const NAMED = new Set([265 /*CORPSE*/, 296 /*TIN*/, 266 /*EGG*/,
                               476 /*STATUE*/, 475 /*BOULDER*/, 234 /*TOWEL*/,
                               239 /*TIN_OPENER*/]);
        descr = NAMED.has(obj?.otyp) ? nm
            : obj?.globby ? 'glob'
            : (OC_CLASS_NAME[obj?.oclass] || 'weapon');
    }
    return descr;
}

// ── attribute-driven bonuses (weapon.c:950 abon / :993 dbon) ──
// C ref: include/attrib.h STR18(x) == 18 + x.  The three call sites that used
// to inline these read STR18(50) as 118 and STR18(100) as 121/122/125 — the
// encoding really runs 19..118 for 18/01..18/100 (js/display.js:1518 agrees),
// so every 18/xx hero got the wrong to-hit and damage bonus.
const STR18 = (x) => 18 + x;
// C ref: attrib.c ACURR(x) — acurr() adds u.abon/u.atemp and clamps.
export const ACURR = acurr_eff;


// C ref: weapon.c:950 abon() — STR/DEX to-hit bonus.
export function abon() {
    const u = game.u;
    const str = ACURR(A_STR), dex = ACURR(A_DEX);
    if (u?.Upolyd) return adj_lev_pm(monster_by_pmidx(u.umonnum ?? -1)) - 3;
    let sbon;
    if (str < 6) sbon = -2;
    else if (str < 8) sbon = -1;
    else if (str < 17) sbon = 0;
    else if (str < STR18(50)) sbon = 1;   /* up to 18/49 */
    else if (str < STR18(100)) sbon = 2;
    else sbon = 3;
    sbon += ((u?.ulevel || 1) < 3) ? 1 : 0;
    if (dex < 4) return sbon - 3;
    if (dex < 6) return sbon - 2;
    if (dex < 8) return sbon - 1;
    if (dex < 14) return sbon;
    return sbon + dex - 14;
}

// C ref: weapon.c:993 dbon() — the STR damage bonus.
export function dbon() {
    if (game.u?.Upolyd) return 0;
    const str = ACURR(A_STR);
    if (str < 6) return -1;
    if (str < 16) return 0;
    if (str < 18) return 1;
    if (str === 18) return 2;              /* 18 */
    if (str <= STR18(75)) return 3;        /* up to 18/75 */
    if (str <= STR18(90)) return 4;        /* up to 18/90 */
    if (str < STR18(100)) return 5;        /* up to 18/99 */
    return 6;
}

// C ref: makemon.c:2016 adj_lev(ptr) — the Upolyd arm of abon() needs it.
function adj_lev_pm(ptr) {
    if (!ptr) return 0;
    const u = game.u;
    let tmp = ptr.mlevel | 0;
    if (tmp > 49) return 50;
    const depth = u?.uz?.dlevel ?? 1;
    const tmp2 = depth - tmp;
    if (tmp2 < 0) tmp--;
    else tmp += Math.trunc(tmp2 / 5);
    const udiff = (u?.ulevel || 1) - (ptr.mlevel | 0);
    if (udiff > 0) tmp += Math.trunc(udiff / 4);
    let cap = Math.trunc((3 * (ptr.mlevel | 0)) / 2);
    if (cap > 49) cap = 49;
    return tmp > cap ? cap : (tmp > 0 ? tmp : 0);
}

// ── skill-slot bookkeeping (weapon.c:1414-1516) ──
// enhance.js owns the live skill array (skill_init baseline + replayed
// advances); these four are the slot arithmetic that exercise/level-gain,
// prayer and skill-drain call, and had no implementation anywhere.
// They are async only so the enhance.js state can be pulled in without adding
// a static weapon -> enhance -> invent edge to the module graph.

function skill_u() {
    const u = game.u = game.u || {};
    if (u.weapon_slots == null) u.weapon_slots = 0;
    if (u.skills_advanced == null) u.skills_advanced = 0;
    if (!Array.isArray(u.skill_record)) u.skill_record = [];
    if (!u.skill_training) u.skill_training = {};
    return u;
}

// C ref: weapon.c:1414 unrestrict_weapon_skill(skill) — restricted -> unskilled
// with P_BASIC as the new ceiling.  May be called with P_NONE.
export async function unrestrict_weapon_skill(skill) {
    const u = skill_u();
    const { p_skill_of } = await import('./enhance.js');
    if (skill < P_NUM_SKILLS && p_skill_of(skill) === P_ISRESTRICTED) {
        u.skill_unrestricted = u.skill_unrestricted || {};
        u.skill_unrestricted[skill] = P_BASIC;   /* P_MAX_SKILL(skill) */
        u.skill_training[skill] = 0;             /* P_ADVANCE(skill) */
    }
}

// C ref: weapon.c:1437 add_weapon_skill(n) — gain n slots; the "you feel more
// confident" message fires when the count of advanceable skills goes UP.
export async function add_weapon_skill(n) {
    const u = skill_u();
    const before = await count_can_advance();
    u.weapon_slots += n;
    const after = await count_can_advance();
    if (before < after) await give_may_advance_msg(P_NONE);
}

// C ref: weapon.c:1453 lose_weapon_skill(n) — deduct from unused slots first,
// then step the last-placed skill back down and REFUND slots_required - 1.
export async function lose_weapon_skill(n) {
    const u = skill_u();
    while (--n >= 0) {
        if (u.weapon_slots) {
            u.weapon_slots--;
        } else if (u.skills_advanced) {
            const skill = u.skill_record[--u.skills_advanced];
            u.skill_record.length = u.skills_advanced;
            const req = await slots_required(skill);
            u.weapon_slots = req - 1;
        }
    }
}

// C ref: weapon.c:1476 drain_weapon_skill(n) — DRAWS RNG: rn2(skills_advanced)
// picks which advanced skill to forget, and rn2(curradv - prevadv) resets the
// training counter.  Called from read.c (cursed amnesia) and uhitm.c.
export async function drain_weapon_skill(n) {
    const u = skill_u();
    const { p_skill_of } = await import('./enhance.js');
    const tmpskills = new Set();
    while (--n >= 0) {
        if (!u.skills_advanced) continue;
        const i = rn2(u.skills_advanced);
        const skill = u.skill_record[i];
        tmpskills.add(skill);
        u.skill_record.splice(i, 1);
        u.skills_advanced--;
        const req = await slots_required(skill);
        u.weapon_slots += req;
        const newlvl = p_skill_of(skill);   /* already one lower: record shrank */
        const curradv = practice_needed_to_advance(newlvl);
        const prevadv = practice_needed_to_advance(newlvl - 1);
        if ((u.skill_training[skill] || 0) >= curradv && curradv > prevadv)
            u.skill_training[skill] = prevadv + rn2(curradv - prevadv);
    }
    if (tmpskills.size) {
        const { P_NAME } = await import('./enhance.js');
        const { pline } = await import('./display.js');
        for (let skill = 0; skill < P_NUM_SKILLS; skill++) {
            if (!tmpskills.has(skill)) continue;
            await pline(`You forget ${p_skill_of(skill) >= P_BASIC ? 'some of ' : ''
                }your training in ${P_NAME(skill)}.`);
        }
    }
}

// C ref: weapon.c:76 give_may_advance_msg(skill).
export async function give_may_advance_msg(skill) {
    const { pline } = await import('./display.js');
    await pline(`You feel more confident in your ${
        skill === P_NONE ? ''
        : skill <= P_LAST_WEAPON ? 'weapon '
        : skill <= P_LAST_SPELL ? 'spell casting '
        : 'fighting '}skills.`);
}

// C ref: skills.h:106 practice_needed_to_advance(level) == level * level * 20.
export function practice_needed_to_advance(level) { return level * level * 20; }

// C ref: weapon.c:1132 slots_required(skill) — weapon and two-weapon skills
// cost their current level; the unarmed/martial ones cost half, rounded up.
export async function slots_required(skill) {
    const { p_skill_of } = await import('./enhance.js');
    const tmp = p_skill_of(skill);
    if (skill <= P_LAST_WEAPON || skill === P_TWO_WEAPON_COMBAT) return tmp;
    return Math.trunc((tmp + 1) / 2);
}

// C ref: weapon.c:1429/1443 — the `for (i = 0; i < P_NUM_SKILLS; i++)
// if (can_advance(i, FALSE)) n++;` loops.
async function count_can_advance() {
    const { can_advance_pub } = await import('./enhance.js');
    let n = 0;
    for (let i = 0; i < P_NUM_SKILLS; i++) if (can_advance_pub(i)) n++;
    return n;
}

// C ref: weapon.c:680 monmightthrowwep(obj) — would a monster ever throw this?
export function monmightthrowwep(obj) {
    if (!obj) return false;
    const sk = objects[obj.otyp]?.oc_skill ?? 0;
    // C walks rwep[]; every entry is a missile, an ammo type, a dagger-family
    // blade, a rock/gem or a cream pie.
    return RWEP_OTYPS.has(obj.otyp) || sk === -23 /* -P_DART */
        || sk === -24 /* -P_SHURIKEN */ || sk === -25 /* -P_BOOMERANG */;
}
// C ref: weapon.c rwep[] — mkobj.js otyp numbering.
const RWEP_OTYPS = new Set([
    30 /*DWARVISH_SPEAR*/, 31 /*SILVER_SPEAR*/, 28 /*ELVEN_SPEAR*/,
    27 /*SPEAR*/, 29 /*ORCISH_SPEAR*/, 32 /*JAVELIN*/, 25 /*SHURIKEN*/,
    22 /*YA*/, 21 /*SILVER_ARROW*/, 19 /*ELVEN_ARROW*/, 18 /*ARROW*/,
    20 /*ORCISH_ARROW*/, 23 /*CROSSBOW_BOLT*/, 37 /*SILVER_DAGGER*/,
    35 /*ELVEN_DAGGER*/, 34 /*DAGGER*/, 36 /*ORCISH_DAGGER*/, 40 /*KNIFE*/,
    473 /*FLINT*/, 474 /*ROCK*/, 471 /*LOADSTONE*/, 470 /*LUCKSTONE*/,
    24 /*DART*/, 287 /*CREAM_PIE*/,
]);

// C ref: weapon.c:1814 setmnotwielded(mon, obj) — clear the wielded flags when
// a monster stops holding a weapon.
export function setmnotwielded(mon, obj) {
    if (!obj) return;
    if (obj.oartifact) obj.owornmask = (obj.owornmask | 0) & ~0x1000 /* W_ART */;
    obj.owornmask = (obj.owornmask | 0) & ~0x00000100 /* W_WEP */;
    if (mon && mon.mw === obj) mon.mw = null;
}

// C ref: weapon.c:938 mwepgone(mon) — the monster's weapon left its hands.
export function mwepgone(mon) {
    const mwep = mon?.mw || null;
    if (mwep) {
        setmnotwielded(mon, mwep);
        mon.weapon_check = 1; /* NEED_WEAPON */
    }
}

// C ref: weapon.c:520 autoreturn_weapon(otmp) — the arwep[] table; only the
// aklys is in it.  Returns { otyp, range2, verbose } or null.
const AKLYS = 80; // mkobj.js otyp
const BOLT_LIM = 8, AKLYS_LIM = BOLT_LIM / 2;
const ARWEP = [{ otyp: AKLYS, range2: AKLYS_LIM * AKLYS_LIM, verbose: 1 }];
export function autoreturn_weapon(otmp) {
    for (const a of ARWEP) if (otmp?.otyp === a.otyp) return a;
    return null;
}

// ── wet towels (weapon.c:1020-1091) ──
const TOWEL = 234;
// C ref: obj.h is_wet_towel(o).
export function is_wet_towel(obj) {
    return obj?.otyp === TOWEL && (obj.spe | 0) > 0;
}
// C ref: weapon.c:1020 finish_towel_change(obj, newspe) — clamps to 0..7 and
// re-arms gu.unweapon when the wielded towel crosses the wet/dry line (a dry
// towel bashes, a wet one whips, and unweapon selects the message).
async function finish_towel_change(obj, newspe) {
    if (!obj) return;
    newspe = Math.min(newspe, 7);
    obj.spe = Math.max(newspe, 0);
    if (obj === game.uwep) game.unweapon = !is_wet_towel(obj);
    if (obj.where === 3 /* OBJ_INVENT */ || obj.carried) {
        const { update_inventory } = await import('./invent.js');
        update_inventory();
    }
}
// C ref: weapon.c:1038 wet_a_towel(obj, amt, verbose) — amt > 0 sets the new
// value, amt <= 0 increments by -amt.
export async function wet_a_towel(obj, amt, verbose) {
    if (!obj) return;
    const newspe = (amt <= 0) ? (obj.spe | 0) - amt : amt;
    if (newspe > (obj.spe | 0) && verbose) {
        const wetness = (newspe < 3) ? (!(obj.spe | 0) ? 'damp' : 'damper')
            : (!(obj.spe | 0) ? 'wet' : 'wetter');
        const { pline } = await import('./display.js');
        await pline(`Your ${objects[obj.otyp]?.name || 'towel'} gets ${wetness}.`);
    }
    if (newspe !== (obj.spe | 0)) await finish_towel_change(obj, newspe);
}
// C ref: weapon.c:1067 dry_a_towel(obj, amt, verbose) — unlike wetting, amt 0
// is NOT a no-op (it sets the towel bone dry).
export async function dry_a_towel(obj, amt, verbose) {
    if (!obj) return;
    const newspe = (amt < 0) ? (obj.spe | 0) + amt : amt;
    if (newspe < (obj.spe | 0) && verbose) {
        const { pline } = await import('./display.js');
        await pline(`Your ${objects[obj.otyp]?.name || 'towel'} dries${
            !newspe ? ' out' : ''}.`);
    }
    if (newspe !== (obj.spe | 0)) await finish_towel_change(obj, newspe);
}

// ── skill-based to-hit / damage modifiers (weapon.c:1545 / :1644) ──
// Split into a `_core` that takes the four P_SKILL() readings C consults, so the
// thrown path (js/invent.js) can pass a SNAPSHOT — it has to sample P_SKILL
// before freeinv() removes the missile, because this port rebuilds the skill
// array from what the hero is carrying.  Every arm below was missing from at
// least one of the three call sites: the P_NONE arm (which the thrown copy
// answered -2/-4 for), the two-weapon arm, the bare-handed arm and the riding
// terms.
export function weapon_hit_bonus_core(type, skill_type, skill_wep, o = {}) {
    let bonus = 0;
    if (type === P_NONE) {
        bonus = 0;
    } else if (type <= P_LAST_WEAPON) {
        switch (skill_type) {
        case P_ISRESTRICTED: case P_UNSKILLED: bonus = -4; break;
        case P_BASIC: bonus = 0; break;
        case P_SKILLED: bonus = 2; break;
        default: bonus = 3; break;            /* P_EXPERT and above */
        }
    } else if (type === P_TWO_WEAPON_COMBAT) {
        const skill = Math.min(skill_type, skill_wep);
        switch (skill) {
        case P_ISRESTRICTED: case P_UNSKILLED: bonus = -9; break;
        case P_BASIC: bonus = -7; break;
        case P_SKILLED: bonus = -5; break;
        default: bonus = -3; break;
        }
    } else if (type === P_BARE_HANDED_COMBAT) {
        bonus = Math.max(skill_type, P_UNSKILLED) - 1;
        bonus = Math.trunc((bonus + 2) * (o.martial ? 2 : 1) / 2);
    }
    if (o.usteed) {
        switch (o.skill_riding) {
        case P_ISRESTRICTED: case P_UNSKILLED: bonus -= 2; break;
        case P_BASIC: bonus -= 1; break;
        default: break;                       /* Skilled/Expert: no penalty */
        }
        if (o.twoweap) bonus -= 2;
    }
    return bonus;
}

export function weapon_dam_bonus_core(type, skill_type, skill_wep, o = {}) {
    let bonus = 0;
    if (type === P_NONE) {
        bonus = 0;
    } else if (type <= P_LAST_WEAPON) {
        switch (skill_type) {
        case P_ISRESTRICTED: case P_UNSKILLED: bonus = -2; break;
        case P_BASIC: bonus = 0; break;
        case P_SKILLED: bonus = 1; break;
        default: bonus = 2; break;            /* P_EXPERT and above */
        }
    } else if (type === P_TWO_WEAPON_COMBAT) {
        const skill = Math.min(skill_type, skill_wep);
        switch (skill) {
        case P_ISRESTRICTED: case P_UNSKILLED: bonus = -3; break;
        case P_BASIC: bonus = -1; break;
        case P_SKILLED: bonus = 0; break;
        default: bonus = 1; break;
        }
    } else if (type === P_BARE_HANDED_COMBAT) {
        bonus = Math.max(skill_type, P_UNSKILLED) - 1;
        bonus = Math.trunc((bonus + 1) * (o.martial ? 3 : 1) / 2);
    }
    // KMH -- riding gives some thrusting damage (NOT while two-weaponing).
    if (o.usteed && type !== P_TWO_WEAPON_COMBAT) {
        if (o.skill_riding === P_SKILLED) bonus += 1;
        else if (o.skill_riding >= P_EXPERT) bonus += 2;
    }
    return bonus;
}

// C ref: weapon.c:1545 weapon_hit_bonus(weapon) / :1644 weapon_dam_bonus(weapon)
// — the hero-facing entry points, reading enhance.js's live skill array.  The
// per-caller `_core` variants above exist for the thrown path, which has to
// snapshot P_SKILL before the missile leaves inventory.
export async function weapon_hit_bonus(weapon) {
    const { p_skill_of } = await import('./enhance.js');
    const u = game.u;
    const wep_type = weapon_type(weapon);
    const type = (u?.twoweap && (weapon === game.uwep || weapon === game.uswapwep))
        ? P_TWO_WEAPON_COMBAT : wep_type;
    return weapon_hit_bonus_core(type, p_skill_of(type), p_skill_of(wep_type), {
        martial: martial_bonus(), usteed: !!u?.usteed, twoweap: !!u?.twoweap,
        skill_riding: p_skill_of(P_RIDING),
    });
}
export async function weapon_dam_bonus(weapon) {
    const { p_skill_of } = await import('./enhance.js');
    const u = game.u;
    const wep_type = weapon_type(weapon);
    const type = (u?.twoweap && (weapon === game.uwep || weapon === game.uswapwep))
        ? P_TWO_WEAPON_COMBAT : wep_type;
    return weapon_dam_bonus_core(type, p_skill_of(type), p_skill_of(wep_type), {
        martial: martial_bonus(), usteed: !!u?.usteed, twoweap: !!u?.twoweap,
        skill_riding: p_skill_of(P_RIDING),
    });
}
// C ref: skills.h martial_bonus() = Role_if(SAMURAI) || Role_if(MONK).
const PM_MONK_W = 5, PM_SAMURAI_W = 9;
function martial_bonus() {
    const m = game.urole?.mnum;
    return m === PM_MONK_W || m === PM_SAMURAI_W;
}

// C ref: weapon.c:1092 skill_level_name(skill, buf).
const SKILL_LEVEL_NAMES = {
    1: 'Unskilled', 2: 'Basic', 3: 'Skilled', 4: 'Expert',
    5: 'Master', 6: 'Grand Master',
};
export async function skill_level_name(skill) {
    const { p_skill_of } = await import('./enhance.js');
    return SKILL_LEVEL_NAMES[p_skill_of(skill)] || 'Unknown';
}
// C ref: weapon.c:1125 skill_name(skill) == P_NAME(skill).
export async function skill_name(skill) {
    const { P_NAME } = await import('./enhance.js');
    return P_NAME(skill, game.urole?.mnum);
}
// C ref: weapon.c:1306 show_skills() — enhance_weapon_skill()'s read-only form.
export async function show_skills() {
    const { doenhance } = await import('./enhance.js');
    return doenhance();
}

// C ref: weapon.c:747 possibly_unwield(mon, polyspot) — the monster's wielded
// weapon left its inventory, or the monster can no longer use weapons at all.
// Returns the object it dropped (null otherwise) so the caller can place it;
// the flooreffects()/stackobj() tail belongs to the caller's module.
export function possibly_unwield(mon, _polyspot) {
    const mw_tmp = mon?.mw || null;
    if (!mw_tmp) return null;
    const inv = mon.minvent || [];
    if (!inv.includes(mw_tmp)) {   /* stolen or destroyed */
        mon.mw = null;
        mon.weapon_check = 1;      /* NEED_WEAPON */
        return null;
    }
    if (!attacktype_weap(mon.data)) {
        setmnotwielded(mon, mw_tmp);
        mon.weapon_check = 0;      /* NO_WEAPON_WANTED */
        const i = inv.indexOf(mw_tmp);
        if (i >= 0) inv.splice(i, 1);
        return mw_tmp;             /* caller drops it at mon->mx,my */
    }
    if (!(mwelded_w(mw_tmp) && mon.weapon_check === 0))
        mon.weapon_check = 1;      /* NEED_WEAPON */
    return null;
}
// C ref: mondata.h attacktype(ptr, AT_WEAP).  AT_WEAP is 254, not 1 — the
// monattk.h enum runs AT_NONE..AT_BOOM then jumps to the "special" block.
function attacktype_weap(ptr) {
    return attacktype(ptr, AT_WEAP);
}
// C ref: obj.h mwelded(obj) — a cursed weapon a monster cannot let go of.
function mwelded_w(obj) {
    return !!obj && !!obj.cursed && !!(obj.owornmask & 0x00000100 /* W_WEP */);
}
