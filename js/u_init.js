// u_init.js - Initial inventory and attributes.
// C ref: u_init.c

import { game } from './gstate.js';
import { rn2, rnd, rne } from './rng.js';
import { addinv as invent_addinv } from './invent.js';
import {
    ARMOR_CLASS,
    COIN_CLASS,
    FOOD_CLASS,
    GEM_CLASS,
    MAGIC_MARKER,
    POTION_CLASS,
    RING_CLASS,
    SCROLL_CLASS,
    SPBOOK_CLASS,
    TOOL_CLASS,
    WAND_CLASS,
    WEAPON_CLASS,
    mkobj,
    mksobj,
    objects,
    weight,
} from './mkobj.js';
import { roles } from './role.js';

export const UNDEF_TYP = 0;
export const UNDEF_SPE = 0x7f;
export const UNDEF_BLESS = 2;

const PM_KNIGHT = 4;
const PM_CLERIC = 6; // Priest/Priestess
const PM_ROGUE = 8;
const PM_SAMURAI = 9;
const PM_WIZARD = 12;
const A_CHAOTIC = -1;

const YA = 22;
const DAGGER = 34;
const SHORT_SWORD = 46;
const LONG_SWORD = 54;
const KATANA = 56;
const LANCE = 72;
const MACE = 73;
const QUARTERSTAFF = 79;
const YUMI = 86;
const HELMET = 97;
const SPLINT_MAIL = 124;
const RING_MAIL = 132;
const LEATHER_ARMOR = 134;
const ROBE = 143;
const CLOAK_OF_MAGIC_RESISTANCE = 148;
const SMALL_SHIELD = 150;
const LEATHER_GLOVES = 159;
const SACK = 217;
const LOCK_PICK = 222;
const OIL_LAMP = 227;
const BLINDFOLD = 233;
const SPRIG_OF_WOLFSBANE = 283;
const CLOVE_OF_GARLIC = 284;
const POT_SICKNESS = 318;
const POT_WATER = 322;
const APPLE = 277;
const CARROT = 282;
const PANCAKE = 290;
const POT_HALLUCINATION = 304;
const POT_POLYMORPH = 316;
const POT_ACID = 320;
const SCR_ENCHANT_WEAPON = 328;
const SCR_AMNESIA = 338;
const SCR_FIRE = 339;
const SCR_BLANK_PAPER = 364;
const SPE_FORCE_BOLT = 375;
const SPE_POLYMORPH = 398;
const SPE_BLANK_PAPER = 406;
const SPE_NOVEL = 407;
const WAN_WISHING = 413;
const WAN_NOTHING = 415;
const WAN_POLYMORPH = 421;
const RIN_LEVITATION = 183;
const RIN_HUNGER = 184;
const RIN_AGGRAVATE_MONSTER = 185;
const RIN_POISON_RESISTANCE = 188;
const RIN_POLYMORPH = 196;
const RIN_POLYMORPH_CONTROL = 197;

const F_CHARGED = 1;

const Knight = [
    { trotyp: LONG_SWORD, trspe: 1, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: LANCE, trspe: 1, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: RING_MAIL, trspe: 1, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: HELMET, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: SMALL_SHIELD, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: LEATHER_GLOVES, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: APPLE, trspe: 0, trclass: FOOD_CLASS, trquan_min: 10, trquan_max: 10, trbless: 0 },
    { trotyp: CARROT, trspe: 0, trclass: FOOD_CLASS, trquan_min: 10, trquan_max: 10, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

const Wizard = [
    { trotyp: QUARTERSTAFF, trspe: 1, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: 1 },
    { trotyp: CLOAK_OF_MAGIC_RESISTANCE, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: WAND_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: RING_CLASS, trquan_min: 2, trquan_max: 2, trbless: UNDEF_BLESS },
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: POTION_CLASS, trquan_min: 3, trquan_max: 3, trbless: UNDEF_BLESS },
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: SCROLL_CLASS, trquan_min: 3, trquan_max: 3, trbless: UNDEF_BLESS },
    { trotyp: SPE_FORCE_BOLT, trspe: 0, trclass: SPBOOK_CLASS, trquan_min: 1, trquan_max: 1, trbless: 1 },
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: SPBOOK_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: MAGIC_MARKER, trspe: 19, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Priest[].
const Priest = [
    { trotyp: MACE, trspe: 1, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: 1 },
    { trotyp: ROBE, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: SMALL_SHIELD, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: POT_WATER, trspe: 0, trclass: POTION_CLASS, trquan_min: 4, trquan_max: 4, trbless: 1 }, // holy water
    { trotyp: CLOVE_OF_GARLIC, trspe: 0, trclass: FOOD_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: SPRIG_OF_WOLFSBANE, trspe: 0, trclass: FOOD_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: SPBOOK_CLASS, trquan_min: 2, trquan_max: 2, trbless: UNDEF_BLESS },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Rogue[].
const Rogue = [
    { trotyp: SHORT_SWORD, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: DAGGER, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 6, trquan_max: 15, trbless: 0 },
    { trotyp: LEATHER_ARMOR, trspe: 1, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: POT_SICKNESS, trspe: 0, trclass: POTION_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: LOCK_PICK, trspe: 0, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: SACK, trspe: 0, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Samurai[].
const Samurai = [
    { trotyp: KATANA, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: SHORT_SWORD, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS }, // wakizashi
    { trotyp: YUMI, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: YA, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 26, trquan_max: 45, trbless: UNDEF_BLESS },
    { trotyp: SPLINT_MAIL, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

const Blindfold = [
    { trotyp: BLINDFOLD, trspe: 0, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Magicmarker[] / Lamp[] (optional extras).
const Magicmarker = [
    { trotyp: MAGIC_MARKER, trspe: 19, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

const Lamp = [
    { trotyp: OIL_LAMP, trspe: 1, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

const ROLE_INVENTORY = new Map([
    [PM_KNIGHT, Knight],
    [PM_CLERIC, Priest],
    [PM_ROGUE, Rogue],
    [PM_SAMURAI, Samurai],
    [PM_WIZARD, Wizard],
]);

// C ref: role.c — hpadv/enadv advance structs {infix,inrnd,lofix,lornd,hifix,hirnd}.
// Only the level-0 (initial) fields infix/inrnd are used here.
const ROLE_ADV = new Map([
    [PM_KNIGHT, { hpadv: { infix: 14, inrnd: 0 }, enadv: { infix: 1, inrnd: 4 } }],
    // role.c Priest: hp {12,0,...}, en {4,3,0,2,0,2} -> inrnd=3.
    [PM_CLERIC, { hpadv: { infix: 12, inrnd: 0 }, enadv: { infix: 4, inrnd: 3 } }],
    // role.c Rogue: hp {10,0,...}, en {1,0,0,1,0,1} -> inrnd=0.
    [PM_ROGUE, { hpadv: { infix: 10, inrnd: 0 }, enadv: { infix: 1, inrnd: 0 } }],
    // role.c Samurai: hp {13,0,...}, en {1,0,0,1,0,1} -> inrnd=0.
    [PM_SAMURAI, { hpadv: { infix: 13, inrnd: 0 }, enadv: { infix: 1, inrnd: 0 } }],
    [PM_WIZARD, { hpadv: { infix: 10, inrnd: 0 }, enadv: { infix: 4, inrnd: 3 } }],
]);
// Human race advance (the only race used by these sessions).
const RACE_ADV_HUMAN = { hpadv: { infix: 2, inrnd: 0 }, enadv: { infix: 1, inrnd: 0 } };

// Player-monster base armor class (mons[].ac).  C ref: include/monsters.h
// — both Knight and Wizard player-monsters have base AC 10.
const PLAYER_BASE_AC = new Map([
    [PM_KNIGHT, 10],
    [PM_WIZARD, 10],
]);

// a_ac (objects[].a_ac = 10 - macro ac arg) for the starting armor pieces.
// C ref: include/objects.h ARMOR()/HELM()/SHIELD()/GLOVES()/CLOAK().
const ARMOR_A_AC = new Map([
    [RING_MAIL, 3],
    [HELMET, 1],
    [SMALL_SHIELD, 1],
    [LEATHER_GLOVES, 1],
    [CLOAK_OF_MAGIC_RESISTANCE, 1],
]);

// Worn-armor slot masks (subset of do_wear.c W_ARM*).
const W_ARM = 0x01;
const W_ARMC = 0x02;
const W_ARMH = 0x04;
const W_ARMS = 0x08;
const W_ARMG = 0x10;
const W_ARMF = 0x20;
const W_ARMU = 0x40;

function is_cloak(obj) { return obj?.otyp === CLOAK_OF_MAGIC_RESISTANCE; }
function is_helmet(obj) { return obj?.otyp === HELMET; }
function is_gloves(obj) { return obj?.otyp === LEATHER_GLOVES; }
function is_shield(obj) { return obj?.otyp === SMALL_SHIELD; }
function is_suit(obj) { return obj?.otyp === RING_MAIL; }

// C ref: do.c setworn — record a worn armor object on the hero.
function setworn(obj, mask) {
    if (!obj) return;
    obj.owornmask = (obj.owornmask || 0) | mask;
    if (mask === W_ARM) game.uarm = obj;
    else if (mask === W_ARMC) game.uarmc = obj;
    else if (mask === W_ARMH) game.uarmh = obj;
    else if (mask === W_ARMS) game.uarms = obj;
    else if (mask === W_ARMG) game.uarmg = obj;
    else if (mask === W_ARMF) game.uarmf = obj;
    else if (mask === W_ARMU) game.uarmu = obj;
}

// C ref: u_init.c ini_inv_use_obj — auto-wear starting armor.
function ini_inv_wear_armor(obj) {
    if (obj.oclass !== ARMOR_CLASS) return;
    if (is_shield(obj) && !game.uarms) setworn(obj, W_ARMS);
    else if (is_helmet(obj) && !game.uarmh) setworn(obj, W_ARMH);
    else if (is_gloves(obj) && !game.uarmg) setworn(obj, W_ARMG);
    else if (is_cloak(obj) && !game.uarmc) setworn(obj, W_ARMC);
    else if (is_suit(obj) && !game.uarm) setworn(obj, W_ARM);
}

// C ref: hack.h ARM_BONUS — a_ac + spe (no erosion at game start).
function ARM_BONUS(obj) {
    return (ARMOR_A_AC.get(obj.otyp) || 0) + (obj.spe || 0);
}

// C ref: do_wear.c find_ac — current armor class from worn gear.
export function find_ac() {
    const base = PLAYER_BASE_AC.get(current_role_mnum()) ?? 10;
    let uac = base;
    for (const obj of [game.uarm, game.uarmc, game.uarmh, game.uarmf,
        game.uarms, game.uarmg, game.uarmu]) {
        if (obj) uac -= ARM_BONUS(obj);
    }
    game.u = game.u || {};
    game.u.uac = uac;
    return uac;
}

// C ref: attrib.c newhp() / exper.c newpw() — level-0 HP and Pw.
// The single rnd() each role's enadv contributes is emitted here at the
// same RNG position the old fastforward_newpw() used.
export function newhp() {
    const adv = ROLE_ADV.get(current_role_mnum());
    if (!adv) return 0;
    let hp = adv.hpadv.infix + RACE_ADV_HUMAN.hpadv.infix;
    if (adv.hpadv.inrnd > 0) hp += rnd(adv.hpadv.inrnd);
    if (RACE_ADV_HUMAN.hpadv.inrnd > 0) hp += rnd(RACE_ADV_HUMAN.hpadv.inrnd);
    return hp;
}

export function newpw() {
    const adv = ROLE_ADV.get(current_role_mnum());
    if (!adv) return 0;
    let en = adv.enadv.infix + RACE_ADV_HUMAN.enadv.infix;
    if (adv.enadv.inrnd > 0) en += rnd(adv.enadv.inrnd);
    if (RACE_ADV_HUMAN.enadv.inrnd > 0) en += rnd(RACE_ADV_HUMAN.enadv.inrnd);
    if (en <= 0) en = 1;
    return en;
}

const A_MAX = 6;
const HUMAN_ATTRMIN = [3, 3, 3, 3, 3, 3];
const HUMAN_ATTRMAX = [118, 18, 18, 18, 18, 18]; // STR18(100), then plain 18s.

// role.c attrbase/attrdist, order [Str,Int,Wis,Dex,Con,Cha].
const ROLE_ATTRS = new Map([
    [PM_KNIGHT, {
        attrbase: [13, 7, 14, 8, 10, 17],
        attrdist: [30, 15, 15, 10, 20, 10],
    }],
    [PM_CLERIC, {
        attrbase: [7, 7, 10, 7, 7, 7],
        attrdist: [15, 10, 30, 15, 20, 10],
    }],
    [PM_ROGUE, {
        attrbase: [7, 7, 7, 10, 7, 6],
        attrdist: [20, 10, 10, 30, 20, 10],
    }],
    [PM_SAMURAI, {
        attrbase: [10, 8, 7, 10, 17, 6],
        attrdist: [30, 10, 8, 30, 14, 8],
    }],
    [PM_WIZARD, {
        attrbase: [7, 10, 7, 7, 7, 7],
        attrdist: [10, 30, 10, 20, 20, 10],
    }],
]);

function current_role_mnum() {
    if (Number.isInteger(game.initrole))
        return roles[game.initrole]?.mnum ?? game.initrole;
    const name = String(game.initrole || '').toLowerCase();
    const role = roles.find((r) => r.name?.m?.toLowerCase() === name
        || r.name?.f?.toLowerCase() === name);
    return role?.mnum ?? null;
}

/* randomizes the quantity given a trobj description */
export function trquan(trop) {
    if (!trop?.trquan_min)
        return 1;
    return trop.trquan_min + rn2(trop.trquan_max - trop.trquan_min + 1);
}

function addinv(obj) {
    return invent_addinv(obj);
}

function ini_inv_obj_substitution(trop, obj) {
    void trop;
    return obj.otyp;
}

function uinit_nocreate() {
    game.uinit_nocreate = game.uinit_nocreate || [0, 0, 0, 0];
    return game.uinit_nocreate;
}

function reset_uinit_nocreate() {
    game.uinit_nocreate = [0, 0, 0, 0];
}

function role_is(pm) {
    return current_role_mnum() === pm;
}

function race_is(_pm) {
    return false;
}

function restricted_spell_discipline(_otyp) {
    return !role_is(PM_WIZARD);
}

function is_forbidden_ini_obj(obj, got_level1_spellbook) {
    const otyp = obj.otyp;
    const nocreate = uinit_nocreate();
    return otyp === WAN_WISHING || nocreate.includes(otyp)
        || otyp === RIN_LEVITATION
        || otyp === POT_HALLUCINATION
        || otyp === POT_ACID
        || otyp === SCR_AMNESIA
        || otyp === SCR_FIRE
        || otyp === SCR_BLANK_PAPER
        || otyp === SPE_BLANK_PAPER
        || otyp === RIN_AGGRAVATE_MONSTER
        || otyp === RIN_HUNGER
        || otyp === WAN_NOTHING
        || (otyp === RIN_POISON_RESISTANCE && race_is(4))
        || (otyp === SCR_ENCHANT_WEAPON && role_is(5))
        || (otyp === SPE_FORCE_BOLT && role_is(PM_WIZARD))
        || (obj.oclass === SPBOOK_CLASS
            && (((objects[otyp]?.dir ?? 0) > (got_level1_spellbook ? 3 : 1))
                || restricted_spell_discipline(otyp)))
        || otyp === SPE_NOVEL;
}

function ini_inv_mkobj_filter(oclass, got_level1_spellbook) {
    let obj = mkobj(oclass, false);
    let trycnt = 0;

    while (is_forbidden_ini_obj(obj, got_level1_spellbook)) {
        if (++trycnt > 1000)
            return mksobj(PANCAKE, true, false);
        obj = mkobj(oclass, false);
    }
    return obj;
}

function ini_inv_adjust_obj(trop, obj) {
    let stop = false;

    if (trop.trclass === COIN_CLASS) {
        obj.quan = game.u?.umoney0 ?? 0;
    } else {
        obj.known = obj.dknown = obj.bknown = obj.rknown = 1;
        obj.cursed = false;
        if (obj.opoisoned && ((game.u?.ualign?.type ?? 0) !== A_CHAOTIC))
            obj.opoisoned = 0;

        if (obj.oclass === WEAPON_CLASS || obj.oclass === TOOL_CLASS) {
            obj.quan = trquan(trop);
            stop = true;
        } else if (obj.oclass === GEM_CLASS) {
            obj.quan = obj.quan || 1;
        }

        if (trop.trspe !== UNDEF_SPE) {
            obj.spe = trop.trspe;
            if (trop.trotyp === MAGIC_MARKER && obj.spe < 96)
                obj.spe += rn2(4);
        } else if (obj.oclass === RING_CLASS
            && (objects[obj.otyp]?.flags & F_CHARGED) && obj.spe <= 0) {
            obj.spe = rne(3);
        }
        if (trop.trbless !== UNDEF_BLESS)
            obj.blessed = !!trop.trbless;
    }

    obj.owt = weight(obj);
    return stop;
}

export function ini_inv(tropList) {
    let idx = 0;
    let trop = tropList[idx];
    let quan;
    let got_sp1 = false;

    if (game.u?.uroleplay?.pauper)
        return;

    quan = trquan(trop);
    while (trop?.trclass) {
        let otyp = trop.trotyp;
        let obj;

        if (otyp !== UNDEF_TYP) {
            obj = mksobj(otyp, true, false);
        } else {
            obj = ini_inv_mkobj_filter(trop.trclass, got_sp1);
            otyp = obj.otyp;

            switch (otyp) {
            case WAN_POLYMORPH:
            case RIN_POLYMORPH:
            case POT_POLYMORPH:
                uinit_nocreate()[0] = RIN_POLYMORPH_CONTROL;
                break;
            case RIN_POLYMORPH_CONTROL:
                uinit_nocreate()[0] = RIN_POLYMORPH;
                uinit_nocreate()[1] = SPE_POLYMORPH;
                uinit_nocreate()[2] = POT_POLYMORPH;
                break;
            default:
                break;
            }
            if (obj.oclass === RING_CLASS || obj.oclass === SPBOOK_CLASS)
                uinit_nocreate()[3] = otyp;
        }

        ini_inv_obj_substitution(trop, obj);

        if (game.u?.uroleplay?.nudist && obj.oclass === ARMOR_CLASS) {
            idx++;
            trop = tropList[idx];
            quan = trquan(trop);
            continue;
        }

        if (ini_inv_adjust_obj(trop, obj))
            quan = 1;
        addinv(obj);
        ini_inv_wear_armor(obj);
        if (obj.oclass === SPBOOK_CLASS && (objects[obj.otyp]?.dir ?? 0) === 1)
            got_sp1 = true;

        if (--quan)
            continue;
        idx++;
        trop = tropList[idx];
        quan = trquan(trop);
    }
}

function u_init_race() {
    // Human has no random race-specific startup adjustments.
}

function current_role_attrs() {
    return ROLE_ATTRS.get(current_role_mnum());
}

function ensure_attr_arrays() {
    game.u = game.u || {};
    game.u.acurr = game.u.acurr || { a: Array(A_MAX).fill(0) };
    game.u.amax = game.u.amax || { a: Array(A_MAX).fill(0) };
}

function rnd_attr(roleAttrs) {
    let x = rn2(100);
    for (let i = 0; i < A_MAX; i++) {
        x -= roleAttrs.attrdist[i];
        if (x < 0)
            return i;
    }
    return A_MAX;
}

function init_attr_role_redist(np, addition, roleAttrs) {
    let tryct = 0;
    const adj = addition ? 1 : -1;

    while ((addition ? np > 0 : np < 0) && tryct < 100) {
        const i = rnd_attr(roleAttrs);
        const cur = game.u.acurr.a[i] ?? 0;
        if (i >= A_MAX
            || (addition ? cur >= HUMAN_ATTRMAX[i] : cur <= HUMAN_ATTRMIN[i])) {
            tryct++;
            continue;
        }
        tryct = 0;
        game.u.acurr.a[i] = cur + adj;
        game.u.amax.a[i] = (game.u.amax.a[i] ?? 0) + adj;
        np -= adj;
    }
    return np;
}

export function init_attr(np = 75) {
    const roleAttrs = current_role_attrs();
    if (!roleAttrs)
        return;

    ensure_attr_arrays();
    for (let i = 0; i < A_MAX; i++) {
        game.u.acurr.a[i] = roleAttrs.attrbase[i];
        game.u.amax.a[i] = roleAttrs.attrbase[i];
        np -= roleAttrs.attrbase[i];
    }

    np = init_attr_role_redist(np, true, roleAttrs);
    init_attr_role_redist(np, false, roleAttrs);
}

function adjattrib(ndx, incr) {
    const next = (game.u.acurr.a[ndx] ?? 0) + incr;
    const clamped = Math.max(HUMAN_ATTRMIN[ndx], Math.min(HUMAN_ATTRMAX[ndx], next));
    game.u.acurr.a[ndx] = clamped;
    if (game.u.amax.a[ndx] < clamped)
        game.u.amax.a[ndx] = clamped;
    return true;
}

export function vary_init_attr() {
    ensure_attr_arrays();
    for (let i = 0; i < A_MAX; i++) {
        if (!rn2(20)) {
            const xd = rn2(7) - 2;
            adjattrib(i, xd);
            if (game.u.acurr.a[i] < game.u.amax.a[i])
                game.u.amax.a[i] = game.u.acurr.a[i];
        }
    }
}

function u_init_carry_attr_boost() {
    // Inventory weight boosting has no RNG for the covered startup path.
}

// C ref: u_init.c u_init_role — role switch. The RNG-bearing tails
// (Blindfold/Magicmarker/Lamp extras) are ported faithfully so the call
// sequence matches C exactly. knows_object/knows_class consume no RNG.
export function u_init_role() {
    const role = current_role_mnum();

    game.moves = 1;
    switch (role) {
    case PM_KNIGHT:
        ini_inv(Knight);
        break;
    case PM_CLERIC: // priest/priestess
        ini_inv(Priest);
        if (!rn2(5))
            ini_inv(Magicmarker);
        else if (!rn2(10))
            ini_inv(Lamp);
        break;
    case PM_ROGUE:
        if (game.u) game.u.umoney0 = 0;
        ini_inv(Rogue);
        if (!rn2(5))
            ini_inv(Blindfold);
        break;
    case PM_SAMURAI:
        ini_inv(Samurai);
        if (!rn2(5))
            ini_inv(Blindfold);
        break;
    case PM_WIZARD:
        ini_inv(Wizard);
        if (!rn2(5))
            ini_inv(Blindfold);
        break;
    default: {
        // Roles without a ported inventory table: skip ini_inv (no RNG).
        const inventory = ROLE_INVENTORY.get(role);
        if (inventory)
            ini_inv(inventory);
        break;
    }
    }
    reset_uinit_nocreate();
}

export function u_init_inventory_attrs() {
    const was_log_mkobj_rne = game._log_mkobj_rne;
    game.u = game.u || {};
    game.invent = [];
    game.u.umoney0 = 0;
    game.uarm = game.uarmc = game.uarmh = game.uarmf = null;
    game.uarms = game.uarmg = game.uarmu = null;

    game._log_mkobj_rne = true;
    try {
        u_init_role();
        u_init_race();
        init_attr(75);
        vary_init_attr();
        u_init_carry_attr_boost();
    } finally {
        game._log_mkobj_rne = was_log_mkobj_rne;
    }
}

export function moveloop_preamble_startup() {
    rnd(9000);
    rnd(30);
}
