// do_wear.js - wearing, taking off, putting on, removing.
// C ref: src/do_wear.c
//
// The 'W'/'T'/'P'/'R' command bodies and the accessory slot bookkeeping live in
// js/invent.js (they grew there before this file existed); this module owns the
// per-slot <Armor>_on()/<Armor>_off() side effects, the wearability checks, and
// the equipment-accessibility predicates, and invent.js calls into it.

import { game } from './gstate.js';
import { hcolor } from './do_name.js';
import { rnd } from './rng.js';
import { pline, update_topl, newsym } from './display.js';
import { objects, ARMOR_CLASS, WEAPON_CLASS, CORPSE } from './mkobj.js';
import { base_armcat } from './objarmor_data.js';
import { A_INT, A_WIS, A_DEX, A_CHA, TT_BEARTRAP, TT_INFLOOR, TT_LAVA, TT_BURIEDBALL,
         TIMEOUT } from './const.js';
import {
    WA_ARM, WA_ARMC, WA_ARMH, WA_ARMS, WA_ARMG, WA_ARMF, WA_ARMU,
    W_ARMOR_WORN, W_RINGL, W_RINGR, W_AMUL,
    worn_slot_clear, body_part, makeplural, xname, yname, makeknown,
    update_inventory, bimanual, is_sword, welded, adj_abon_attrib, learnring,
    silly_thing, dropx, canletgo, setuwep_slot, setuswapwep, setuqwep,
    Ring_off, Ring_on, Amulet_off, off_msg, curse_blocks_removal, oc_delay,
    otense, weapon_descr_for, makeknown_credit, cmdq_pop,
} from './invent.js';
import { youHaveFast, youHaveVeryFast } from './allmain.js';
import { acurr_eff } from './attrib.js';

/* onames.h otyps (this port's objects[] numbering, verified against
   js/mkobj.js OBJECT_DATA). */
const ELVEN_LEATHER_HELM = 89, ORCISH_HELM = 90, DWARVISH_IRON_HELM = 91,
    FEDORA = 92, CORNUTHAUM = 93, DUNCE_CAP = 94, DENTED_POT = 95,
    HELM_OF_BRILLIANCE = 96, HELMET = 97, HELM_OF_CAUTION = 98,
    HELM_OF_OPPOSITE_ALIGNMENT = 99, HELM_OF_TELEPATHY = 100;
/* objects[] order: gray, gold, silver, red, white, orange, black, blue, green,
   yellow — NOT objects.h's alphabetical reading order. */
const GRAY_DRAGON_SCALE_MAIL = 101, GOLD_DRAGON_SCALE_MAIL = 102,
    SILVER_DRAGON_SCALE_MAIL = 103, RED_DRAGON_SCALE_MAIL = 104,
    WHITE_DRAGON_SCALE_MAIL = 105, ORANGE_DRAGON_SCALE_MAIL = 106,
    BLACK_DRAGON_SCALE_MAIL = 107, BLUE_DRAGON_SCALE_MAIL = 108,
    GREEN_DRAGON_SCALE_MAIL = 109, YELLOW_DRAGON_SCALE_MAIL = 110;
const GRAY_DRAGON_SCALES = 111, GOLD_DRAGON_SCALES = 112,
    SILVER_DRAGON_SCALES = 113, RED_DRAGON_SCALES = 114,
    WHITE_DRAGON_SCALES = 115, ORANGE_DRAGON_SCALES = 116,
    BLACK_DRAGON_SCALES = 117, BLUE_DRAGON_SCALES = 118,
    GREEN_DRAGON_SCALES = 119, YELLOW_DRAGON_SCALES = 120;
const HAWAIIAN_SHIRT = 136, T_SHIRT = 137;
const MUMMY_WRAPPING = 138, ELVEN_CLOAK = 139, ORCISH_CLOAK = 140,
    DWARVISH_CLOAK = 141, OILSKIN_CLOAK = 142, ROBE = 143,
    ALCHEMY_SMOCK = 144, LEATHER_CLOAK = 145, CLOAK_OF_PROTECTION = 146,
    CLOAK_OF_INVISIBILITY = 147, CLOAK_OF_MAGIC_RESISTANCE = 148,
    CLOAK_OF_DISPLACEMENT = 149;
const SMALL_SHIELD = 150, SHIELD_OF_DRAIN_RESISTANCE = 151,
    SHIELD_OF_SHOCK_RESISTANCE = 152, ELVEN_SHIELD = 153,
    URUK_HAI_SHIELD = 154, ORCISH_SHIELD = 155, LARGE_SHIELD = 156,
    DWARVISH_ROUNDSHIELD = 157, SHIELD_OF_REFLECTION = 158;
const LEATHER_GLOVES = 159, GAUNTLETS_OF_FUMBLING = 160,
    GAUNTLETS_OF_POWER = 161, GAUNTLETS_OF_DEXTERITY = 162;
const LOW_BOOTS = 163, IRON_SHOES = 164, HIGH_BOOTS = 165, SPEED_BOOTS = 166,
    WATER_WALKING_BOOTS = 167, JUMPING_BOOTS = 168, ELVEN_BOOTS = 169,
    KICKING_BOOTS = 170, FUMBLE_BOOTS = 171, LEVITATION_BOOTS = 172;
const RIN_STEALTH = 181;
const BATTLE_AXE = 33, AKLYS = 44, TIN_OPENER = 240, HEAVY_IRON_BALL = 302,
    IRON_CHAIN = 303;

/* enum obj_armor_types (objclass.h) */
const ARM_SUIT = 0, ARM_SHIELD = 1, ARM_HELM = 2, ARM_GLOVES = 3,
    ARM_BOOTS = 4, ARM_CLOAK = 5, ARM_SHIRT = 6;

const c_armor = 'armor', c_suit = 'suit', c_shirt = 'shirt', c_cloak = 'cloak',
    c_gloves = 'gloves', c_boots = 'boots', c_weapon = 'weapon',
    c_sword = 'sword', c_axe = 'axe';

const u_ = () => (game.u = game.u || {});

// C ref: obj.h is_suit/is_shield/... — these test objects[otyp].oc_armcat, the
// column js/objarmor_data.js dumps from the recorder's own objects.o.  An otyp
// range test is not equivalent for hand-added objects, and a name regex answers
// FALSE for every unlisted species of armor (gauntlets of power were not gloves).
function armcat_is(obj, cat) {
    return !!obj && obj.oclass === ARMOR_CLASS && base_armcat(obj.otyp) === cat;
}
export function is_suit(obj) { return armcat_is(obj, ARM_SUIT); }
export function is_shield(obj) { return armcat_is(obj, ARM_SHIELD); }
export function is_helmet(obj) { return armcat_is(obj, ARM_HELM); }
export function is_gloves(obj) { return armcat_is(obj, ARM_GLOVES); }
export function is_boots(obj) { return armcat_is(obj, ARM_BOOTS); }
export function is_cloak(obj) { return armcat_is(obj, ARM_CLOAK); }
export function is_shirt(obj) { return armcat_is(obj, ARM_SHIRT); }
export function armcat_of(obj) {
    return (obj && obj.oclass === ARMOR_CLASS) ? base_armcat(obj.otyp) : -1;
}

// C ref: objclass.h is_metallic/is_crackable — oc_material IRON..MITHRIL and
// GLASS.  objects[].material carries the column.
const MAT_IRON = 11, MAT_MITHRIL = 17, MAT_GLASS = 19;
function is_metallic(obj) {
    const m = objects[obj?.otyp]?.material | 0;
    return m >= MAT_IRON && m <= MAT_MITHRIL;
}
function is_crackable(obj) { return (objects[obj?.otyp]?.material | 0) === MAT_GLASS; }

// C ref: do_wear.c:568 hard_helmet() — better protection against falling rocks.
export function hard_helmet(obj) {
    if (!obj || !is_helmet(obj)) return false;
    return is_metallic(obj) || is_crackable(obj);
}

// C ref: do_wear.c:60 fingers_or_gloves(check_gloves).  With check_gloves FALSE
// the answer is "fingers" even while gloved — the 'P' full-slots message and the
// "no more ring-fingers to fill" line both pass FALSE.
export function fingers_or_gloves(check_gloves) {
    return (check_gloves && game.uarmg) ? gloves_simple_name(game.uarmg)
                                        : makeplural(body_part(3 /*FINGER*/));
}

/* ---- objnam.c *_simple_name() family ----------------------------------- */
// The generic noun for a slot, used by every "take off your %s" message.  These
// live here because do_wear.c is their only caller.
export function gloves_simple_name(obj) {
    const nm = objects[obj?.otyp]?.name || '';
    return /gauntlets/.test(nm) ? 'gauntlets' : 'gloves';
}
export function boots_simple_name(obj) {
    const nm = objects[obj?.otyp]?.name || '';
    return /shoes/.test(nm) ? 'shoes' : 'boots';
}
export function cloak_simple_name(obj) {
    if (obj) {
        switch (obj.otyp) {
        case ROBE: return 'robe';
        case MUMMY_WRAPPING: return 'wrapping';
        case ALCHEMY_SMOCK:
            return (obj.dknown && objects[obj.otyp]?.oc_name_known) ? 'smock' : 'apron';
        default: break;
        }
    }
    return 'cloak';
}
export function suit_simple_name(obj) {
    const nm = objects[obj?.otyp]?.name || '';
    /* C ref: obj.h Is_dragon_mail/Is_dragon_scales — the whole 10-otyp block */
    if (obj && obj.otyp >= GRAY_DRAGON_SCALE_MAIL && obj.otyp <= YELLOW_DRAGON_SCALE_MAIL)
        return 'dragon mail';
    if (obj && obj.otyp >= GRAY_DRAGON_SCALES && obj.otyp <= YELLOW_DRAGON_SCALES)
        return 'dragon scales';
    if (nm.length > 5 && nm.endsWith(' mail')) return 'mail';
    if (nm.length > 7 && nm.endsWith(' jacket')) return 'jacket';
    return c_suit;
}
export function shirt_simple_name(_obj) { return c_shirt; }
export function shield_simple_name(obj) {
    if (obj && obj.otyp === SHIELD_OF_REFLECTION)
        return obj.dknown ? 'silver shield' : 'smooth shield';
    return 'shield';
}
// C ref: objnam.c armor_simple_name() — dispatch on oc_armcat.
export function armor_simple_name(obj) {
    switch (armcat_of(obj)) {
    case ARM_CLOAK: return cloak_simple_name(obj);
    case ARM_HELM: return helm_simple_name(obj);
    case ARM_GLOVES: return gloves_simple_name(obj);
    case ARM_BOOTS: return boots_simple_name(obj);
    case ARM_SHIELD: return shield_simple_name(obj);
    case ARM_SHIRT: return shirt_simple_name(obj);
    case ARM_SUIT: return suit_simple_name(obj);
    default: return c_armor;
    }
}

/* ---- property helpers -------------------------------------------------- */
// The port has no objects[].oc_oprop column and no u.uprops[].extrinsic
// bitmask, so `oldprop` (the property's extrinsic from OTHER slots) is derived
// from the other worn items that confer it.  Only the properties this file
// toggles need an entry.
function extrinsic_stealth_except(obj) {
    for (const o of [game.uarmc, game.uarmf, game.uleft, game.uright]) {
        if (!o || o === obj) continue;
        if (o.otyp === ELVEN_CLOAK || o.otyp === ELVEN_BOOTS || o.otyp === RIN_STEALTH)
            return true;
    }
    return false;
}
function extrinsic_displacement_except(obj) {
    const o = game.uarmc;
    return !!o && o !== obj && o.otyp === CLOAK_OF_DISPLACEMENT;
}
function extrinsic_fumbling_except(obj) {
    for (const o of [game.uarmf, game.uarmg]) {
        if (!o || o === obj) continue;
        if (o.otyp === FUMBLE_BOOTS || o.otyp === GAUNTLETS_OF_FUMBLING) return true;
    }
    return false;
}
function extrinsic_invis_except(obj) {
    for (const o of [game.uarmc, game.uleft, game.uright]) {
        if (!o || o === obj) continue;
        if (o.otyp === CLOAK_OF_INVISIBILITY || o.otyp === 198 /*RIN_INVISIBILITY*/)
            return true;
    }
    return false;
}
function HStealth() { const u = game.u || {}; return !!(u.HStealth || u.uStealth || u.uprops?.HStealth); }
function BStealth() {
    /* C: stealth is blocked while riding unless hero+steed fly */
    const u = game.u || {};
    return !!u.usteed && !u.uprops?.Flying;
}
function HFumbling() { const u = game.u || {}; return (u.HFumbling | 0); }
function HFumblingOutside() { const u = game.u || {}; return (u.HFumblingOutside | 0); }
function Hallucination() {
    const u = game.u || {};
    return !!u.uhallu || !!u.Hallucination || ((u.uprops?.Hallucination | 0) > 0);
}
function Glib() {
    const u = game.u || {};
    return ((u.Glib | 0) > 0) || ((u.uprops?.Glib | 0) > 0) || ((u.uprops?.HGlib | 0) > 0);
}
function Levitation() { return !!(game.u?.uprops?.Levitation); }
function Flying() { return !!(game.u?.uprops?.Flying); }
function Blind() { const u = game.u || {}; return !!(u.ublindf_blind || (u.uprops?.Blinded | 0) > 0 || game.ublindf); }
function Role_if(pm) { return (game.urole?.mnum ?? game.u?.umonnum) === pm; }
const PM_ARCHEOLOGIST = 0, PM_WIZARD = 12;

// C ref: attrib.c change_luck() — LUCKMIN/LUCKMAX clamps (-10/10 without the
// luckstone terms).  u.uluck != 0 makes rnl() draw an extra rn2(37+|Luck|), so
// this is never cosmetic.
const LUCKMIN = -10, LUCKMAX = 10;
export function change_luck(n) {
    const u = u_();
    u.uluck = (u.uluck | 0) + n;
    if (u.uluck < 0 && u.uluck < LUCKMIN) u.uluck = LUCKMIN;
    if (u.uluck > 0 && u.uluck > LUCKMAX) u.uluck = LUCKMAX;
}

// C ref: do_name.c hcolor() — hallucination substitutes a random color drawn
// from the DISPLAY rng (rn2_on_display_rng), which is a separate stream from
// the one the sessions score, so no core draw happens here either way.
// js/do_name.js owns hcolor(); a NULL colorpref DRAWS even when not hallucinating.

function newsym_here() { newsym(game.u?.ux, game.u?.uy); }

// C ref: display.c see_monsters() — a redisplay pass for telepathy/warning/
// see-invisible changes.  No JS equivalent exists (deferred); it draws no RNG.
function see_monsters() {}

/* ---- toggles ----------------------------------------------------------- */

// C ref: do_wear.c:107 toggle_stealth(obj, oldprop, on)
export async function toggle_stealth(obj, oldprop, on) {
    if (on ? game.initial_don : game.context?.takeoff?.cancelled_don) return;

    if (!oldprop && !HStealth() && !BStealth()) {
        if (obj.otyp === RIN_STEALTH) learnring(obj, true);
        else makeknown(obj.otyp);

        if (on) {
            if (!is_boots(obj)) await pline('You move very quietly.');
            else if (Levitation() || Flying()) await pline('You float imperceptibly.');
            else await pline('You walk very quietly.');
        } else {
            const riding = !!game.u?.usteed;
            /* x_monnam(usteed, ARTICLE_YOUR, ...) is the steed branch */
            await pline(riding ? 'You and your steed are noisy.'
                               : 'You sure are noisy.');
        }
    }
}

// C ref: do_wear.c:148 toggle_displacement(obj, oldprop, on)
export async function toggle_displacement(obj, oldprop, on) {
    if (on ? game.initial_don : game.context?.takeoff?.cancelled_don) return;
    const u = game.u || {};
    if (!oldprop
        && !(u.uprops?.DISPLACED_intrinsic)
        && ((!Blind() && !u.uswallow && !u.uprops?.Invis)
            || u.uprops?.Telepat || u.uprops?.Detect_monsters)) {
        if (obj) makeknown(obj.otyp);
        // C ref: do_wear.c You_feel() is pline(), i.e. update_topl(): the
        // following on_msg() ("You are now wearing ...") must page THIS line
        // with a --More-- instead of overwriting it (seed0360 step 497).
        await update_topl(`You feel that monsters${on ? '' : ' no longer'} have difficulty pinpointing your location.`);
    }
}

/*
 * The Type_on() functions are called *after* setworn().
 * The Type_off() functions clear the slot themselves.
 */

// C ref: do_wear.c:187 Boots_on()
export async function Boots_on() {
    const uarmf = game.uarmf;
    if (!uarmf) return 0;
    const otyp = uarmf.otyp;
    switch (otyp) {
    case LOW_BOOTS: case IRON_SHOES: case HIGH_BOOTS:
    case JUMPING_BOOTS: case KICKING_BOOTS:
        break;
    case WATER_WALKING_BOOTS:
        /* spoteffects()/u.uinwater: the underwater-to-surface transition is not
           modelled; gw.wasinwater is recorded by the caller for the makeknown. */
        if (game.wasinwater) {
            if (!game.u?.uinwater) makeknown(WATER_WALKING_BOOTS);
            game.wasinwater = 0;
        }
        break;
    case SPEED_BOOTS: {
        /* oldprop: extrinsic FAST from another slot — blue dragon scales/mail */
        const oldprop = !!game.u?.efastArm;
        const u = game.u || {};
        if (!oldprop && !((u.HFast | 0) & TIMEOUT)) {
            makeknown_credit(otyp);
            await update_topl(`You feel yourself speed up${(oldprop || u.HFast) ? ' a bit more' : ''}.`);
        }
        break;
    }
    case ELVEN_BOOTS:
        await toggle_stealth(uarmf, extrinsic_stealth_except(uarmf), true);
        break;
    case FUMBLE_BOOTS: {
        const u = u_();
        /* the extrinsic itself comes from setworn(); only the timer is here */
        u.EFumbling = WA_ARMF;
        if (!extrinsic_fumbling_except(uarmf) && !HFumblingOutside())
            u.HFumbling = (u.HFumbling | 0) + rnd(20); /* incr_itimeout */
        break;
    }
    case LEVITATION_BOOTS:
        /* float_up()/float_vs_flight() (hack.c) have no JS equivalent; the
           extrinsic itself rides on the worn mask (deferred: levitation). */
        uarmf.known = 1;
        game.botl = true;
        makeknown(otyp);
        break;
    default:
        break;
    }
    if (game.uarmf && !game.uarmf.known) {
        game.uarmf.known = 1; /* +/- evident from the status-line AC */
        update_inventory();
    }
    return 0;
}

// C ref: do_wear.c:262 Boots_off()
export async function Boots_off() {
    const otmp = game.uarmf;
    if (!otmp) return 0;
    const otyp = otmp.otyp;
    const oldprop_stealth = extrinsic_stealth_except(otmp);
    const oldprop_fumble = extrinsic_fumbling_except(otmp);
    takeoff_mask_clear(WA_ARMF);
    /* setworn(0, W_ARMF) happens BEFORE the levitation case in C */
    worn_slot_clear(WA_ARMF);
    otmp.owornmask = (otmp.owornmask | 0) & ~WA_ARMF;
    switch (otyp) {
    case SPEED_BOOTS:
        if (!youHaveVeryFast() && !game.context?.takeoff?.cancelled_don) {
            makeknown_credit(otyp);
            await update_topl(`You feel yourself slow down${youHaveFast() ? ' a bit' : ''}.`);
        }
        break;
    case WATER_WALKING_BOOTS:
        /* spoteffects() drowning/lava check: not modelled (deferred). */
        break;
    case ELVEN_BOOTS:
        await toggle_stealth(otmp, oldprop_stealth, false);
        break;
    case FUMBLE_BOOTS: {
        const u = u_();
        if (!oldprop_fumble && !HFumblingOutside()) {
            u.HFumbling = 0;
            u.EFumbling = 0;
        }
        break;
    }
    case LEVITATION_BOOTS:
        /* float_down() (hack.c): deferred with the rest of levitation. */
        makeknown(otyp);
        break;
    default:
        break;
    }
    if (game.context?.takeoff) game.context.takeoff.cancelled_don = false;
    update_inventory();
    return 0;
}

// C ref: do_wear.c:326 Cloak_on()
export async function Cloak_on() {
    const uarmc = game.uarmc;
    if (!uarmc) return 0;
    switch (uarmc.otyp) {
    case ORCISH_CLOAK: case DWARVISH_CLOAK: case CLOAK_OF_MAGIC_RESISTANCE:
    case ROBE: case LEATHER_CLOAK:
        break;
    case CLOAK_OF_PROTECTION:
        makeknown(uarmc.otyp);
        break;
    case ELVEN_CLOAK:
        await toggle_stealth(uarmc, extrinsic_stealth_except(uarmc), true);
        break;
    case CLOAK_OF_DISPLACEMENT:
        await toggle_displacement(uarmc, extrinsic_displacement_except(uarmc), true);
        break;
    case MUMMY_WRAPPING:
        /* the wrapping is already worn, so C tests the raw Invis sources */
        if ((game.u?.uprops?.HInvis || game.u?.uprops?.EInvis) && !Blind()) {
            newsym_here();
            await pline(`You can ${game.u?.uprops?.See_invisible
                ? 'no longer see through yourself' : 'see yourself'}!`);
        }
        break;
    case CLOAK_OF_INVISIBILITY:
        if (!extrinsic_invis_except(uarmc) && !game.u?.uprops?.HInvis && !Blind()) {
            makeknown(uarmc.otyp);
            await pline(`Suddenly you can${game.u?.uprops?.See_invisible ? ' see through' : 'not see'} yourself.`);
        }
        break;
    case OILSKIN_CLOAK:
        await pline(`${Tobjnam(uarmc, 'fit')} very tightly.`);
        break;
    case ALCHEMY_SMOCK: {
        const u = u_();
        u.EAcid_resistance = (u.EAcid_resistance | 0) | WA_ARMC;
        break;
    }
    default:
        break;
    }
    if (game.uarmc && !game.uarmc.known) {
        game.uarmc.known = 1;
        update_inventory();
    }
    return 0;
}

// C ref: do_wear.c:383 Cloak_off()
export async function Cloak_off() {
    const otmp = game.uarmc;
    if (!otmp) return 0;
    const otyp = otmp.otyp;
    const oldstealth = extrinsic_stealth_except(otmp);
    const olddisp = extrinsic_displacement_except(otmp);
    const oldinvis = extrinsic_invis_except(otmp);
    takeoff_mask_clear(WA_ARMC);
    worn_slot_clear(WA_ARMC);
    otmp.owornmask = (otmp.owornmask | 0) & ~WA_ARMC;
    switch (otyp) {
    case ORCISH_CLOAK: case DWARVISH_CLOAK: case CLOAK_OF_PROTECTION:
    case CLOAK_OF_MAGIC_RESISTANCE: case OILSKIN_CLOAK: case ROBE:
    case LEATHER_CLOAK:
        break;
    case ELVEN_CLOAK:
        await toggle_stealth(otmp, oldstealth, false);
        break;
    case CLOAK_OF_DISPLACEMENT:
        await toggle_displacement(otmp, olddisp, false);
        break;
    case MUMMY_WRAPPING:
        if (game.u?.uprops?.Invis && !Blind())
            await pline(`You can ${game.u?.uprops?.See_invisible ? 'see through yourself' : 'no longer see yourself'}.`);
        break;
    case CLOAK_OF_INVISIBILITY:
        if (!oldinvis && !game.u?.uprops?.HInvis && !Blind()) {
            makeknown(CLOAK_OF_INVISIBILITY);
            await pline(`Suddenly you can ${game.u?.uprops?.See_invisible ? 'no longer see through yourself' : 'see yourself'}.`);
        }
        break;
    case ALCHEMY_SMOCK: {
        const u = u_();
        u.EAcid_resistance = (u.EAcid_resistance | 0) & ~WA_ARMC;
        break;
    }
    default:
        break;
    }
    update_inventory();
    return 0;
}

// C ref: do_wear.c:434 Helmet_on()
export async function Helmet_on() {
    const uarmh = game.uarmh;
    if (!uarmh) return 0;
    let fallthru_dunce = false;
    switch (uarmh.otyp) {
    case FEDORA:
        /* the Archeologist's starting fedora is worn by u_init, so C's
           set_wear() at allmain.c:73 gives that role +1 Luck for the whole game
           (rnl() then draws an extra rn2(37+|Luck|) on every call). */
        if (Role_if(PM_ARCHEOLOGIST)) { change_luck(1); uarmh._luck_from_don = 1; }
        break;
    case HELMET: case DENTED_POT: case ELVEN_LEATHER_HELM:
    case DWARVISH_IRON_HELM: case ORCISH_HELM: case HELM_OF_TELEPATHY:
        break;
    case HELM_OF_CAUTION:
        see_monsters();
        break;
    case HELM_OF_BRILLIANCE:
        adj_abon(uarmh, uarmh.spe | 0);
        break;
    case CORNUTHAUM:
        adj_abon_attrib(A_CHA, Role_if(PM_WIZARD) ? 1 : -1);
        game.botl = true;
        makeknown(uarmh.otyp);
        break;
    case HELM_OF_OPPOSITE_ALIGNMENT:
        uarmh.known = 1;
        /* uchangealign() (align.c) has no JS equivalent — the alignment flip and
           its messages are deferred; the shared curse below still applies. */
        fallthru_dunce = true;
        /* FALLTHRU */
    case DUNCE_CAP:
        if (game.uarmh && !game.uarmh.cursed) {
            if (Blind()) await pline(`${Tobjnam(game.uarmh, 'vibrate')} for a moment.`);
            else await pline(`${Tobjnam(game.uarmh, 'glow')} ${hcolor('black')} for a moment.`);
            game.uarmh.cursed = true; game.uarmh.blessed = false; /* curse() */
            if (Blind()) game.uarmh.bknown = 0;
            else if (Role_if(6 /*PM_CLERIC*/)) game.uarmh.bknown = 1;
            else if (game.uarmh.bknown) update_inventory();
        }
        game.botl = true;
        if (Hallucination()) {
            await pline('My brain hurts!');
        } else if (game.uarmh && game.uarmh.otyp === DUNCE_CAP) {
            /* C tracks the INT change: acurr <= abase+abon+atemp means the cap
               pinned it (6), which reads as dull rather than giddy */
            const u = game.u || {};
            const raw = (u.acurr?.a?.[A_INT] || 0) + (u.abon?.a?.[A_INT] || 0)
                + (u.atemp?.a?.[A_INT] || 0);
            await pline(`You feel ${acurr_eff(A_INT) <= raw
                ? 'like sitting in a corner' : 'giddy'}.`);
        } else if (fallthru_dunce) {
            makeknown(HELM_OF_OPPOSITE_ALIGNMENT);
        }
        break;
    default:
        break;
    }
    if (game.uarmh && !game.uarmh.known) {
        game.uarmh.known = 1;
        update_inventory();
    }
    return 0;
}

// C ref: do_wear.c:518 Helmet_off()
export async function Helmet_off() {
    const uarmh = game.uarmh;
    if (!uarmh) return 0;
    takeoff_mask_clear(WA_ARMH);
    switch (uarmh.otyp) {
    case FEDORA:
        /* the -1 only balances a +1 this hero actually received: until
           allmain.js calls set_wear(), a fedora worn since turn 0 never ran
           Helmet_on, and subtracting here would drive Luck negative (measured:
           -53 screens on seed0361).  Drop the guard when set_wear() is wired. */
        if (Role_if(PM_ARCHEOLOGIST) && uarmh._luck_from_don) {
            change_luck(-1);
            uarmh._luck_from_don = 0;
        }
        break;
    case HELMET: case DENTED_POT: case ELVEN_LEATHER_HELM:
    case DWARVISH_IRON_HELM: case ORCISH_HELM:
        break;
    case DUNCE_CAP:
        game.botl = true;
        break;
    case CORNUTHAUM:
        if (!game.context?.takeoff?.cancelled_don) {
            adj_abon_attrib(A_CHA, Role_if(PM_WIZARD) ? -1 : 1);
            game.botl = true;
        }
        break;
    case HELM_OF_TELEPATHY:
    case HELM_OF_CAUTION:
        /* C updates the ability BEFORE see_monsters(), and returns early */
        worn_slot_clear(WA_ARMH);
        uarmh.owornmask = (uarmh.owornmask | 0) & ~WA_ARMH;
        see_monsters();
        update_inventory();
        return 0;
    case HELM_OF_BRILLIANCE:
        if (!game.context?.takeoff?.cancelled_don) adj_abon(uarmh, -(uarmh.spe | 0));
        break;
    case HELM_OF_OPPOSITE_ALIGNMENT:
        /* uchangealign(u.ualignbase[A_CURRENT]): deferred, see Helmet_on(). */
        break;
    default:
        break;
    }
    worn_slot_clear(WA_ARMH);
    uarmh.owornmask = (uarmh.owornmask | 0) & ~WA_ARMH;
    if (game.context?.takeoff) game.context.takeoff.cancelled_don = false;
    update_inventory();
    return 0;
}

// C ref: do_wear.c:576 Gloves_on()
export async function Gloves_on() {
    const uarmg = game.uarmg;
    if (!uarmg) return 0;
    switch (uarmg.otyp) {
    case LEATHER_GLOVES:
        break;
    case GAUNTLETS_OF_FUMBLING: {
        const u = u_();
        u.EFumbling = WA_ARMG;
        if (!extrinsic_fumbling_except(uarmg) && !HFumblingOutside())
            u.HFumbling = (u.HFumbling | 0) + rnd(20); /* incr_itimeout */
        break;
    }
    case GAUNTLETS_OF_POWER:
        makeknown(uarmg.otyp);
        game.botl = true;
        break;
    case GAUNTLETS_OF_DEXTERITY:
        adj_abon(uarmg, uarmg.spe | 0);
        break;
    default:
        break;
    }
    if (!uarmg.known) {
        uarmg.known = 1;
        update_inventory();
    }
    return 0;
}

// C ref: do_wear.c:608 wielding_corpse(obj, how, voluntary) — bare-handed
// cockatrice corpse after the gloves (or yellow dragon armor) come off.
export async function wielding_corpse(obj, how, voluntary) {
    if (!obj || obj.otyp !== CORPSE || game.uarmg) return;
    if (obj !== game.uwep && (obj !== game.uswapwep || !game.u?.twoweap)) return;
    /* touch_petrifies(&mons[obj->corpsenm]) && !Stone_resistance: instapetrify()
       (polyself.c) has no JS equivalent, so the fatal branch is deferred. */
    void how; void voluntary;
}

// C ref: do_wear.c:646 Gloves_off()
export async function Gloves_off() {
    const gloves = game.uarmg;
    if (!gloves) return 0;
    const oldprop_fumble = extrinsic_fumbling_except(gloves);
    const on_purpose = !game.context?.mon_moving && !gloves.in_use;
    takeoff_mask_clear(WA_ARMG);
    switch (gloves.otyp) {
    case LEATHER_GLOVES:
        break;
    case GAUNTLETS_OF_FUMBLING: {
        const u = u_();
        if (!oldprop_fumble && !HFumblingOutside()) { u.HFumbling = 0; u.EFumbling = 0; }
        break;
    }
    case GAUNTLETS_OF_POWER:
        makeknown(gloves.otyp);
        game.botl = true;
        break;
    case GAUNTLETS_OF_DEXTERITY:
        if (!game.context?.takeoff?.cancelled_don) adj_abon(gloves, -(gloves.spe | 0));
        break;
    default:
        break;
    }
    worn_slot_clear(WA_ARMG);
    gloves.owornmask = (gloves.owornmask | 0) & ~WA_ARMG;
    if (game.context?.takeoff) game.context.takeoff.cancelled_don = false;
    /* encumber_msg(): immediate feedback for gauntlets of power; the caller's
       once-per-input encumbrance check covers it. */
    if (Glib()) {
        const u = u_();
        u.Glib = 0;
        if (u.uprops) { u.uprops.Glib = 0; u.uprops.HGlib = 0; }
    }
    if (game.uwep && game.uwep.otyp === CORPSE)
        await wielding_corpse(game.uwep, gloves, on_purpose);
    if (game.u?.twoweap && game.uswapwep && game.uswapwep.otyp === CORPSE)
        await wielding_corpse(game.uswapwep, gloves, on_purpose);
    game.botl = true; /* condtests[bl_bareh] */
    update_inventory();
    return 0;
}

// C ref: do_wear.c:705 Shield_on()
export async function Shield_on() {
    const uarms = game.uarms;
    if (!uarms) return 0;
    switch (uarms.otyp) {
    case SMALL_SHIELD: case SHIELD_OF_DRAIN_RESISTANCE:
    case SHIELD_OF_SHOCK_RESISTANCE: case ELVEN_SHIELD: case URUK_HAI_SHIELD:
    case ORCISH_SHIELD: case DWARVISH_ROUNDSHIELD: case LARGE_SHIELD:
    case SHIELD_OF_REFLECTION:
        break;
    default:
        break;
    }
    if (!uarms.known) {
        uarms.known = 1;
        update_inventory();
    }
    return 0;
}

// C ref: do_wear.c:733 Shield_off()
export async function Shield_off() {
    const uarms = game.uarms;
    if (!uarms) return 0;
    takeoff_mask_clear(WA_ARMS);
    worn_slot_clear(WA_ARMS);
    uarms.owornmask = (uarms.owornmask | 0) & ~WA_ARMS;
    update_inventory();
    return 0;
}

// C ref: do_wear.c:759 Shirt_on()
export async function Shirt_on() {
    const uarmu = game.uarmu;
    if (!uarmu) return 0;
    switch (uarmu.otyp) {
    case HAWAIIAN_SHIRT: case T_SHIRT:
        break;
    default:
        break;
    }
    if (!uarmu.known) {
        uarmu.known = 1;
        update_inventory();
    }
    return 0;
}

// C ref: do_wear.c:778 Shirt_off()
export async function Shirt_off() {
    const uarmu = game.uarmu;
    if (!uarmu) return 0;
    takeoff_mask_clear(WA_ARMU);
    worn_slot_clear(WA_ARMU);
    uarmu.owornmask = (uarmu.owornmask | 0) & ~WA_ARMU;
    update_inventory();
    return 0;
}

// C ref: do_wear.c:798 dragon_armor_handling(otmp, puton, on_purpose)
export async function dragon_armor_handling(otmp, puton, on_purpose) {
    if (!otmp) return;
    const u = u_();
    const setE = (name, on) => {
        u[name] = on ? ((u[name] | 0) | WA_ARM) : ((u[name] | 0) & ~WA_ARM);
    };
    switch (otmp.otyp) {
    case BLACK_DRAGON_SCALES: case BLACK_DRAGON_SCALE_MAIL:
        setE('EDrain_resistance', puton);
        break;
    case BLUE_DRAGON_SCALES: case BLUE_DRAGON_SCALE_MAIL:
        if (puton) {
            if (!youHaveVeryFast())
                await update_topl(`You speed up${youHaveFast() ? ' a bit more' : ''}.`);
            u.efastArm = true;
        } else {
            u.efastArm = false;
            if (!youHaveVeryFast() && !game.context?.takeoff?.cancelled_don)
                await update_topl('You slow down.');
        }
        break;
    case GREEN_DRAGON_SCALES: case GREEN_DRAGON_SCALE_MAIL:
        setE('ESick_resistance', puton);
        break;
    case RED_DRAGON_SCALES: case RED_DRAGON_SCALE_MAIL:
        setE('EInfravision', puton);
        see_monsters();
        break;
    case GOLD_DRAGON_SCALES: case GOLD_DRAGON_SCALE_MAIL:
        /* make_hallucinated(!puton, TRUE, W_ARM): the hallucination timer lives
           in potion.js; wearing gold DSM should CLEAR hallucination. */
        if (puton && u.uprops) u.uprops.Hallucination = 0;
        break;
    case ORANGE_DRAGON_SCALES: case ORANGE_DRAGON_SCALE_MAIL:
        setE('EFree_action', puton);
        break;
    case YELLOW_DRAGON_SCALES: case YELLOW_DRAGON_SCALE_MAIL:
        setE('EStone_resistance', puton);
        if (!puton) {
            await wielding_corpse(game.uwep, otmp, on_purpose);
            await wielding_corpse(game.uswapwep, otmp, on_purpose);
        }
        break;
    case WHITE_DRAGON_SCALES: case WHITE_DRAGON_SCALE_MAIL:
        setE('ESlow_digestion', puton);
        break;
    default:
        break;
    }
}

// C ref: do_wear.c:887 Armor_on()
export async function Armor_on() {
    const uarm = game.uarm;
    if (!uarm) return 0;
    if (!uarm.known) {
        uarm.known = 1;
        update_inventory();
    }
    await dragon_armor_handling(uarm, true, true);
    /* artifact_light()/begin_burn(): gold DSM's light source is not modelled. */
    return 0;
}

// C ref: do_wear.c:909 Armor_off()
export async function Armor_off() {
    const otmp = game.uarm;
    if (!otmp) return 0;
    takeoff_mask_clear(WA_ARM);
    worn_slot_clear(WA_ARM);
    otmp.owornmask = (otmp.owornmask | 0) & ~WA_ARM;
    if (game.context?.takeoff) game.context.takeoff.cancelled_don = false;
    await dragon_armor_handling(otmp, false, true);
    update_inventory();
    return 0;
}

// C ref: do_wear.c:939 Armor_gone() — like Armor_off() but the removal was not
// voluntary (destroyed/stolen), which matters for the yellow-DSM stoning check.
export async function Armor_gone() {
    const otmp = game.uarm;
    if (!otmp) return 0;
    takeoff_mask_clear(WA_ARM);
    worn_slot_clear(WA_ARM);
    otmp.owornmask = (otmp.owornmask | 0) & ~WA_ARM;
    if (game.context?.takeoff) game.context.takeoff.cancelled_don = false;
    await dragon_armor_handling(otmp, false, false);
    update_inventory();
    return 0;
}

// C ref: do_wear.c:3319 adj_abon(otmp, delta) — gauntlets of dexterity and helm
// of brilliance only.
export function adj_abon(otmp, delta) {
    if (game.uarmg && game.uarmg === otmp && otmp.otyp === GAUNTLETS_OF_DEXTERITY) {
        if (delta) {
            makeknown(game.uarmg.otyp);
            adj_abon_attrib(A_DEX, delta);
        }
        game.botl = true;
    }
    if (game.uarmh && game.uarmh === otmp && otmp.otyp === HELM_OF_BRILLIANCE) {
        if (delta) {
            makeknown(game.uarmh.otyp);
            adj_abon_attrib(A_INT, delta);
            adj_abon_attrib(A_WIS, delta);
        }
        game.botl = true;
    }
}

/* ---- takeoff context --------------------------------------------------- */

// C ref: do_wear.c svc.context.takeoff — the 'A' command's per-slot work list.
export function takeoff_ctx() {
    game.context = game.context || {};
    if (!game.context.takeoff)
        game.context.takeoff = { mask: 0, what: 0, delay: 0, cancelled_don: false, disrobing: '' };
    return game.context.takeoff;
}
function takeoff_mask_clear(bits) {
    const t = takeoff_ctx();
    t.mask &= ~bits;
}

// C ref: do_wear.c:3014 reset_remarm()
export function reset_remarm() {
    const t = takeoff_ctx();
    t.what = 0;
    t.mask = 0;
    t.disrobing = '';
}

// C ref: do_wear.c:1574 donning(otmp) / :1603 doffing(otmp).  This port drives
// the dressing maneuver through invent.js run_dress_occupation()/start_occupation
// rather than ga.afternmv, so the identity of the pending afternmv is recorded
// on game._dressing_obj.
export function donning(otmp) {
    if (doffing(otmp)) return true;
    return !!otmp && game._dressing_obj === otmp && !game._dressing_off;
}
export function doffing(otmp) {
    if (!otmp) return false;
    const t = takeoff_ctx();
    if (game._dressing_obj === otmp && game._dressing_off) return true;
    const slotbit = (otmp === game.uarm) ? WA_ARM : (otmp === game.uarmu) ? WA_ARMU
        : (otmp === game.uarmc) ? WA_ARMC : (otmp === game.uarmf) ? WA_ARMF
        : (otmp === game.uarmh) ? WA_ARMH : (otmp === game.uarmg) ? WA_ARMG
        : (otmp === game.uarms) ? WA_ARMS : (otmp === game.uamul) ? W_AMUL
        : (otmp === game.uleft) ? W_RINGL : (otmp === game.uright) ? W_RINGR : 0;
    return !!slotbit && t.what === slotbit;
}

// C ref: do_wear.c:1664 cancel_don()
export function cancel_don() {
    const t = takeoff_ctx();
    t.cancelled_don = !!game._dressing_obj && !game._dressing_off;
    game._dressing_obj = null;
    game._dressing_off = false;
    game.afternmv = null;
    game.nomovemsg = null;
    game.multi = 0;
    t.delay = 0;
    t.what = 0;
}

// C ref: do_wear.c:1645 cancel_doff(obj, slotmask) — I_SPECIAL keeps the 'A'
// command's own <slot>_off() from cancelling the disrobing it is driving.
const I_SPECIAL = 0x40000000;
export function cancel_doff(obj, slotmask) {
    const t = takeoff_ctx();
    if (!(t.mask & I_SPECIAL) && donning(obj)) cancel_don();
    t.mask &= ~slotmask;
}

// C ref: do_wear.c:1539 set_wear(obj) — side effects of already-worn gear.
// allmain.c:73 calls set_wear(NULL) for the starting inventory, which is where
// the Archeologist's fedora grants its +1 Luck.
export async function set_wear(obj) {
    game.initial_don = !obj;

    /* Blindf_on()/Amulet_on() live in invent.js with the accessory slot
       bookkeeping; C's set_wear() runs them first, but the starting inventory
       never wears eyewear or an amulet (deferred with those two). */
    if (!obj ? !!game.uright : (obj === game.uright)) await Ring_on(game.uright);
    if (!obj ? !!game.uleft : (obj === game.uleft)) await Ring_on(game.uleft);

    if (!obj ? !!game.uarmu : (obj === game.uarmu)) await Shirt_on();
    if (!obj ? !!game.uarm : (obj === game.uarm)) await Armor_on();
    if (!obj ? !!game.uarmc : (obj === game.uarmc)) await Cloak_on();
    if (!obj ? !!game.uarmf : (obj === game.uarmf)) await Boots_on();
    if (!obj ? !!game.uarmg : (obj === game.uarmg)) await Gloves_on();
    if (!obj ? !!game.uarmh : (obj === game.uarmh)) await Helmet_on();
    if (!obj ? !!game.uarms : (obj === game.uarms)) await Shield_on();

    game.initial_don = false;
}
/* ---- wearability checks ------------------------------------------------ */

// C ref: do_wear.c:2030 canwearobj(otmp, &mask, noisy) — can this piece of armor
// be worn?  Returns { mask, msgs }: the WA_* slot mask (0 when it can't be worn)
// plus the messages C prints when noisy.  Split into a sync decision core because
// equip_ok() is a getobj callback and cannot await.
export function canwearobj_impl(otmp) {
    const u = game.u || {};
    const msgs = [];
    let mask = 0, err = 0;

    /* verysmall()/nohands()/cantweararm() only bite while polymorphed */
    if ((otmp.owornmask | 0) & W_ARMOR_WORN) {
        msgs.push('You are already wearing that!');
        return { mask: 0, msgs };
    }
    if (welded(game.uwep) && bimanual(game.uwep)
        && (is_suit(otmp) || is_shirt(otmp))) {
        msgs.push(`You cannot do that while holding your ${is_sword(game.uwep) ? c_sword : c_weapon}.`);
        return { mask: 0, msgs };
    }

    if (is_helmet(otmp)) {
        if (game.uarmh) {
            msgs.push(already_wearing_msg(an(helm_simple_name(game.uarmh))));
            err++;
        } else mask = WA_ARMH;
    } else if (is_shield(otmp)) {
        if (game.uarms) {
            msgs.push(already_wearing_msg('a shield'));
            err++;
        } else if (game.uwep && bimanual(game.uwep)) {
            msgs.push(`You cannot wear a shield while wielding a two-handed ${is_sword(game.uwep) ? c_sword : (game.uwep.otyp === BATTLE_AXE) ? c_axe : c_weapon}.`);
            err++;
        } else if (u.twoweap) {
            msgs.push('You cannot wear a shield while wielding two weapons.');
            err++;
        } else mask = WA_ARMS;
    } else if (is_boots(otmp)) {
        if (game.uarmf) {
            msgs.push(already_wearing_msg(c_boots));
            err++;
        } else if (u.utrap
                   && (u.utraptype === TT_BEARTRAP || u.utraptype === TT_INFLOOR
                       || u.utraptype === TT_LAVA || u.utraptype === TT_BURIEDBALL)) {
            if (u.utraptype === TT_BEARTRAP)
                msgs.push(`Your ${body_part(5 /*FOOT*/)} is trapped!`);
            else if (u.utraptype === TT_INFLOOR || u.utraptype === TT_LAVA)
                msgs.push(`Your ${makeplural(body_part(5))} are stuck in the ${surface_here()}!`);
            else
                msgs.push(`Your ${body_part(9 /*LEG*/)} is attached to the buried ball!`);
            err++;
        } else mask = WA_ARMF;
    } else if (is_gloves(otmp)) {
        if (game.uarmg) {
            msgs.push(already_wearing_msg(c_gloves));
            err++;
        } else if (welded(game.uwep)) {
            msgs.push(`You cannot wear gloves over your ${is_sword(game.uwep) ? c_sword : c_weapon}.`);
            err++;
        } else if (Glib()) {
            msgs.push(`Your ${fingers_or_gloves(false)} are too slippery to pull on ${gloves_simple_name(otmp)}.`);
            err++;
        } else mask = WA_ARMG;
    } else if (is_shirt(otmp)) {
        if (game.uarm || game.uarmc || game.uarmu) {
            if (game.uarmu) msgs.push(already_wearing_msg(an(c_shirt)));
            else msgs.push(`You can't wear that over your ${(game.uarm && !game.uarmc) ? c_armor : cloak_simple_name(game.uarmc)}.`);
            err++;
        } else mask = WA_ARMU;
    } else if (is_cloak(otmp)) {
        if (game.uarmc) {
            msgs.push(already_wearing_msg(an(cloak_simple_name(game.uarmc))));
            err++;
        } else mask = WA_ARMC;
    } else if (is_suit(otmp)) {
        if (game.uarmc) {
            msgs.push(`You cannot wear armor over a ${cloak_simple_name(game.uarmc)}.`);
            err++;
        } else if (game.uarm) {
            msgs.push(already_wearing_msg('some armor'));
            err++;
        } else mask = WA_ARM;
    } else {
        msgs.push(null); /* silly_thing("wear", otmp) */
        err++;
    }
    return { mask: err ? 0 : mask, msgs };
}

// C ref: do_wear.c canwearobj() with noisy=TRUE.
export async function canwearobj(otmp, noisy) {
    const { mask, msgs } = canwearobj_impl(otmp);
    if (noisy) {
        for (const m of msgs) {
            if (m === null) await silly_thing('wear', otmp);
            else await pline(m);
        }
    }
    return mask;
}

// C ref: do_wear.c canwearobj(obj, &dummymask, FALSE) as called by equip_ok().
export function canwearobj_quiet(otmp) { return canwearobj_impl(otmp).mask; }

// C ref: do_wear.c:3342 inaccessible_equipment(obj, verb, only_if_known_cursed)
export async function inaccessible_equipment(obj, verb, only_if_known_cursed) {
    const anycovering = !only_if_known_cursed;
    const BLOCKSACCESS = (x) => anycovering || (x.cursed && x.bknown);
    const need = (outer, o) => pline(`You need to take off ${outer} to ${verb} ${yname(o)}.`);

    if (!obj || !(obj.owornmask | 0)) return false;

    if (obj === game.uarm && game.uarmc && BLOCKSACCESS(game.uarmc)) {
        if (verb) await need(yname(game.uarmc), obj);
        return true;
    }
    if (obj === game.uarmu
        && ((game.uarm && BLOCKSACCESS(game.uarm)) || (game.uarmc && BLOCKSACCESS(game.uarmc)))) {
        if (verb) {
            let buf = '';
            if (game.uarmc) buf += yname(game.uarmc);
            if (game.uarm && game.uarmc) buf += ' and ';
            if (game.uarm) buf += game.uarmc ? xname(game.uarm) : yname(game.uarm);
            await need(buf, obj);
        }
        return true;
    }
    if ((obj === game.uleft || obj === game.uright) && game.uarmg
        && BLOCKSACCESS(game.uarmg)) {
        if (verb) await need(yname(game.uarmg), obj);
        return true;
    }
    return false;
}

// C ref: do_wear.c:2990 better_not_take_that_off(otmp) — confirm before taking
// gloves off while carrying a cockatrice corpse.
export async function better_not_take_that_off(otmp) {
    /* carrying_stoning_corpse() (invent.c) has no JS equivalent yet, so no
       corpse is ever found and the prompt is skipped (deferred). */
    void otmp;
    return false;
}

// C ref: do_wear.c:2657 stuck_ring(ring, otyp) — what (if anything) prevents
// this ring from being removed; used by pray.c's trouble scan.
export function stuck_ring(ring, otyp) {
    if (!ring) return null;
    if (ring !== game.uleft && ring !== game.uright) return null;
    if (ring.otyp === otyp) {
        const lefty = (game.u?.uhandedness === 1);
        const ring_on_primary = lefty ? game.uleft : game.uright;
        if (game.uamul && game.uamul.otyp === 207 /*AMULET_OF_UNCHANGING*/
            && game.uamul.cursed && nolimbs_hero()) return game.uamul;
        if (welded(game.uwep) && (ring === ring_on_primary || bimanual(game.uwep)))
            return game.uwep;
        if (game.uarmg && game.uarmg.cursed) return game.uarmg;
        if (ring.cursed) return ring;
        if (game.uarmg && Glib()) return game.uarmg;
    }
    return null;
}
function nolimbs_hero() { return false; /* only reachable while polymorphed */ }

// C ref: do_wear.c:2687 unchanger()
export function unchanger() {
    if (game.uamul && game.uamul.otyp === 207 /*AMULET_OF_UNCHANGING*/) return game.uamul;
    return null;
}

// C ref: do_wear.c:2528 glibr() — slippery fingers: rings and weapons slip off.
// allmain.c:271 calls this once per turn while Glib.
export async function glibr() {
    let xfl = 0;
    const lefty = (game.u?.uhandedness === 1);
    const uwep = game.uwep;
    const leftfall = !!game.uleft && !game.uleft.cursed
        && (!uwep || !(welded(uwep) && lefty) || !bimanual(uwep));
    const rightfall = !!game.uright && !game.uright.cursed
        && (!uwep || !(welded(uwep) && !lefty) || !bimanual(uwep));

    if (!game.uarmg && (leftfall || rightfall)) {
        await pline(`Your ${(leftfall && rightfall) ? 'rings slip' : 'ring slips'} off your ${(leftfall && rightfall) ? fingers_or_gloves(false) : body_part(3 /*FINGER*/)}.`);
        xfl++;
        if (leftfall) {
            const otmp = game.uleft;
            Ring_off(otmp);
            dropx(otmp);
        }
        if (rightfall) {
            const otmp = game.uright;
            Ring_off(otmp);
            dropx(otmp);
        }
    }

    let otherwep = null, wastwoweap = false;
    let otmp = game.uswapwep;
    if (game.u?.twoweap && otmp) {
        otherwep = is_sword(otmp) ? c_sword : weapon_descr_for(otmp);
        if ((otmp.quan | 0) > 1) otherwep = makeplural(otherwep);
        const which = lefty ? 'right ' : 'left ';
        await pline(`Your ${otherwep} ${xfl ? 'also ' : ''}${otense(otmp, 'slip')} from your ${which}${body_part(6 /*HAND*/)}.`);
        xfl++;
        wastwoweap = true;
        setuswapwep(null);
        if (canletgo(otmp, '')) dropx(otmp);
    }
    otmp = game.uwep;
    if (otmp && otmp.otyp !== AKLYS && !welded(otmp)) {
        const savequan = otmp.quan;
        let thiswep = is_sword(otmp) ? c_sword : weapon_descr_for(otmp);
        if (otherwep && thiswep !== makesingular_simple(otherwep)) otherwep = null;
        if ((otmp.quan | 0) > 1) {
            if (thiswep === 'food') otmp.quan = 1;
            else thiswep = makeplural(thiswep);
        }
        let hand = body_part(6), which = '';
        if (bimanual(otmp)) hand = makeplural(hand);
        else if (wastwoweap) which = lefty ? 'left ' : 'right ';
        await pline(`${thiswep.startsWith('corpse') ? 'The' : 'Your'} ${otherwep ? 'other ' : ''}${thiswep} ${xfl ? 'also ' : ''}${otense(otmp, 'slip')} from your ${which}${hand}.`);
        otmp.quan = savequan;
        setuwep_slot(null);
        if (canletgo(otmp, '')) dropx(otmp);
    }
}
function makesingular_simple(s) { return String(s).replace(/s$/, ''); }

// C ref: do_wear.c:3489 count_worn_armor()
export function count_worn_armor() {
    let ret = 0;
    for (const o of [game.uarm, game.uarmc, game.uarmh, game.uarms, game.uarmg,
                     game.uarmf, game.uarmu]) if (o) ret++;
    return ret;
}

// C ref: do_wear.c:3480 any_worn_armor_ok(obj) — getobj callback for blessed
// destroy armor: suggest any worn armor even when covered.
export function any_worn_armor_ok(obj) {
    return (obj && ((obj.owornmask | 0) & W_ARMOR_WORN)) ? 2 /*GETOBJ_SUGGEST*/
                                                        : -3 /*GETOBJ_EXCLUDE*/;
}

// C ref: do_wear.c:2824 do_takeoff() — remove the slot named by takeoff.what.
// Returns the object whose off_msg() the caller owes.
export async function do_takeoff() {
    const doff = takeoff_ctx();
    let otmp = null;
    const was_twoweap = !!game.u?.twoweap;
    doff.mask |= I_SPECIAL;
    if (doff.what === 0x100 /*W_WEP*/) {
        if (!(await cursed_blocks(game.uwep))) {
            setuwep_slot(null);
            await pline(was_twoweap ? 'You are no longer wielding either weapon.'
                                    : `You are ${game.uarmg ? 'empty handed' : 'bare handed'}.`);
        }
    } else if (doff.what === 0x400 /*W_SWAPWEP*/) {
        setuswapwep(null);
        await pline(`You ${was_twoweap ? 'are ' : ''}no longer ${was_twoweap ? 'wielding two weapons at once' : 'have a second weapon readied'}.`);
    } else if (doff.what === 0x200 /*W_QUIVER*/) {
        setuqwep(null);
        await pline('You no longer have ammunition readied.');
    } else if (doff.what === WA_ARM) {
        otmp = game.uarm;
        if (!(await cursed_blocks(otmp))) await Armor_off();
    } else if (doff.what === WA_ARMC) {
        otmp = game.uarmc;
        if (!(await cursed_blocks(otmp))) await Cloak_off();
    } else if (doff.what === WA_ARMF) {
        otmp = game.uarmf;
        if (!(await cursed_blocks(otmp))) await Boots_off();
    } else if (doff.what === WA_ARMG) {
        otmp = game.uarmg;
        if (!(await cursed_blocks(otmp))) await Gloves_off();
    } else if (doff.what === WA_ARMH) {
        otmp = game.uarmh;
        if (!(await cursed_blocks(otmp))) await Helmet_off();
    } else if (doff.what === WA_ARMS) {
        otmp = game.uarms;
        if (!(await cursed_blocks(otmp))) await Shield_off();
    } else if (doff.what === WA_ARMU) {
        otmp = game.uarmu;
        if (!(await cursed_blocks(otmp))) await Shirt_off();
    } else if (doff.what === W_AMUL) {
        otmp = game.uamul;
        if (!(await cursed_blocks(otmp))) await Amulet_off(otmp);
    } else if (doff.what === W_RINGL) {
        otmp = game.uleft;
        if (!(await cursed_blocks(otmp))) Ring_off(game.uleft);
    } else if (doff.what === W_RINGR) {
        otmp = game.uright;
        if (!(await cursed_blocks(otmp))) Ring_off(game.uright);
    }
    doff.mask &= ~I_SPECIAL;
    return otmp;
}
// C ref: do_wear.c:1893 cursed(otmp) — refuse to remove a cursed worn item.
async function cursed_blocks(obj) {
    if (!obj) return false;
    return await curse_blocks_removal(obj);
}

// C ref: do_wear.c takeoff_order[] — the order the 'A' command peels items off.
// Built on demand: invent.js imports this module before its own WA_* consts
// have been initialized, so a module-level array would hit the TDZ.
export function takeoff_order() {
    return [
        /*WORN_BLINDF*/ 0x00800000, /*W_WEP*/ 0x100, WA_ARMS, WA_ARMG,
        W_RINGL, W_RINGR, WA_ARMC, WA_ARMH, W_AMUL, WA_ARM, WA_ARMU,
        WA_ARMF, /*W_SWAPWEP*/ 0x400, /*W_QUIVER*/ 0x200, 0,
    ];
}

// C ref: do_wear.c:2900 take_off() — the 'A' occupation body: charge each slot
// its oc_delay, then remove it.  The moveloop hook that re-invokes an occupation
// each turn lives in allmain.js (deferred), so this computes the per-slot delay
// and performs one step per call.
export async function take_off() {
    const doff = takeoff_ctx();
    if (doff.what) {
        if (doff.delay > 0) { doff.delay--; return 1; }
        const otmp = await do_takeoff();
        if (otmp) await off_msg(otmp);
        doff.mask &= ~doff.what;
        doff.what = 0;
    }
    const order = takeoff_order();
    for (let i = 0; order[i]; i++) {
        if (doff.mask & order[i]) { doff.what = order[i]; break; }
    }
    let otmp = null;
    doff.delay = 0;
    if (doff.what === 0) {
        await pline(`You finish ${doff.disrobing}.`);
        return 0;
    } else if (doff.what === 0x100 || doff.what === 0x400 || doff.what === 0x200
               || doff.what === W_AMUL || doff.what === W_RINGL
               || doff.what === W_RINGR || doff.what === 0x00800000) {
        doff.delay = 1;
    } else if (doff.what === WA_ARM) {
        otmp = game.uarm;
        if (game.uarmc) doff.delay += 2 * oc_delay(game.uarmc.otyp) + 1;
    } else if (doff.what === WA_ARMC) { otmp = game.uarmc;
    } else if (doff.what === WA_ARMF) { otmp = game.uarmf;
    } else if (doff.what === WA_ARMG) { otmp = game.uarmg;
    } else if (doff.what === WA_ARMH) { otmp = game.uarmh;
    } else if (doff.what === WA_ARMS) { otmp = game.uarms;
    } else if (doff.what === WA_ARMU) {
        otmp = game.uarmu;
        if (game.uarm) doff.delay += 2 * oc_delay(game.uarm.otyp);
        if (game.uarmc) doff.delay += 2 * oc_delay(game.uarmc.otyp) + 1;
    }
    if (otmp) doff.delay += oc_delay(otmp.otyp);
    /* the occupation counter starts next move, so charge one turn less */
    if (doff.delay > 0) doff.delay--;
    return 1;
}

// C ref: do_wear.c:1688 stop_donning(stolenobj) — steal.c interrupts a dressing
// maneuver.  Returns the multi-turns that were still outstanding (for the
// theft's own timing).  js/steal.js currently stubs this to 0.
export async function stop_donning(stolenobj) {
    const otmp = (game.invent || []).find(
        (o) => ((o.owornmask | 0) & W_ARMOR_WORN) && donning(o));
    if (!otmp) return 0;

    const putting_on = !doffing(otmp);
    let result = 0;
    cancel_don();
    game.afternmv = null;
    let buf = '';
    if (putting_on || otmp !== stolenobj)
        buf = `You stop ${putting_on ? 'putting on' : 'taking off'} ${the_simple(otmp)}.`;
    else
        result = -(game.multi | 0);   /* read before unmul() clears it */
    game.multi = 0;
    game.nomovemsg = null;
    if (buf) await pline(buf);
    /* while putting on, the item is already worn but its effects are pending:
       an interruption makes it unworn again */
    if (putting_on) {
        const m = await import('./invent.js');
        await m.remove_worn_item(otmp, false);
    }
    return result;
}
function the_simple(obj) { return `your ${armor_simple_name(obj)}`; }

// C ref: do_wear.c:3144 wornarm_destroyed(wornarm) — take the piece off (so its
// side effects unwind) and then use it up.
export async function wornarm_destroyed(wornarm) {
    if (!wornarm) return;
    if (donning(wornarm)) cancel_don();
    const off_fn = (wornarm === game.uarmc) ? Cloak_off
        : (wornarm === game.uarm) ? Armor_off
        : (wornarm === game.uarmu) ? Shirt_off
        : (wornarm === game.uarmh) ? Helmet_off
        : (wornarm === game.uarmg) ? Gloves_off
        : (wornarm === game.uarmf) ? Boots_off
        : (wornarm === game.uarms) ? Shield_off : null;
    if (off_fn) await off_fn();
    /* xxx_off() can destroy the item itself (lava), so only use up what is
       still in the pack */
    if ((game.invent || []).includes(wornarm)) {
        const m = await import('./invent.js');
        m.useup(wornarm);
    }
}

// C ref: do_wear.c:3062 remarm_swapwep() — #altunwield / the '-' item action on
// uswapwep.  Returns ECMD_TIME only when the attempt taught the hero something
// (a cursed secondary weapon still comes off, but that costs no time).
export async function remarm_swapwep() {
    const cmd = cmdq_pop();
    const key = (cmd && cmd.typ === 0 /*CMDQ_KEY*/) ? cmd.key : '\0';
    if (key !== '-' || !game.uswapwep) return 2 /*ECMD_FAIL*/;
    const oldbknown = game.uswapwep.bknown;
    reset_remarm();
    const t = takeoff_ctx();
    t.what = t.mask = 0x400 /*W_SWAPWEP*/;
    await do_takeoff();
    return (!game.uswapwep || game.uswapwep.bknown !== oldbknown)
        ? 3 /*ECMD_TIME*/ : 0 /*ECMD_OK*/;
}

/* ---- small helpers shared with invent.js ------------------------------- */

// C ref: do_wear.c:2011 already_wearing(cc) — the trailing '!' belongs to the
// c_that_ case only.
function already_wearing_msg(cc) { return `You are already wearing ${cc}.`; }
function an(s) { return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`; }

// C ref: objnam.c helm_simple_name() — "helm" for hard helmets, else "hat".
export function helm_simple_name(obj) { return hard_helmet(obj) ? 'helm' : 'hat'; }

// C ref: dungeon.c surface(x,y) — only the message text depends on it.
function surface_here() {
    const loc = game.level?.at?.(game.u?.ux, game.u?.uy);
    return (loc && loc.typ === 21 /*ICE*/) ? 'ice' : 'floor';
}

function Tobjnam(obj, verb) {
    const nm = xname(obj);
    const v = otense(obj, verb);
    return `${/^[A-Z]/.test(nm) ? '' : 'The '}${nm} ${v}`.replace(/^The The /, 'The ');
}

// C ref: wield.c:68 will_weld(optr) / :1053 welded(obj) — a cursed wielded
// weapon (or weptool, tin opener, iron ball/chain) fuses to the hand.  Exported
// for invent.js's welded(), which used to be a constant FALSE.
export function will_weld(obj) {
    if (!obj || !obj.cursed) return false;
    return obj.oclass === WEAPON_CLASS || is_weptool_dw(obj)
        || obj.otyp === HEAVY_IRON_BALL || obj.otyp === IRON_CHAIN
        || obj.otyp === TIN_OPENER;
}
function is_weptool_dw(obj) {
    const TOOL_CLASS_DW = 8;
    return obj?.oclass === TOOL_CLASS_DW && (objects[obj.otyp]?.oc_skill ?? 0) !== 0;
}
