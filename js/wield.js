// wield.js — Weapon wielding / two-weapon combat.
// C ref: src/wield.c.
//
// The #twoweapon command (dotwoweapon) plus its full precondition chain
// (can_twoweapon) and the cursed/slippery offhand drop (drop_uswapwep).
// dowield/doswapweapon/ready_weapon live in js/invent.js.
//
// The success path performs a trailing `rnd(20) > ACURR(A_DEX)` roll to decide
// whether the toggle also consumes a turn; that RNG call must fire for stream
// parity (wield.c:861).

import { acurr_eff } from './attrib.js';
import { game } from './gstate.js';
import { pline, hold_botl_con } from './display.js';
import { rnd } from './rng.js';
import {
    update_inventory, is_plural, bimanual, otense, yobjnam, Yobjnam2, Yname2, body_part, setuswapwep, freeinv, carried,
} from './invent.js';
import { makeplural } from './plural.js';
import { objects, WEAPON_CLASS, TOOL_CLASS } from './mkobj.js';
import { monster_by_pmidx } from './makemon.js';
import { MATTK, AT_WEAP } from './monattk_data.js';
import { A_DEX } from './const.js';

// C ref: attrib.h ACURR(x) — current attribute value (acurr.a in
// [STR,INT,WIS,DEX,CON,CHA] order).
function ACURR(i) {
    return acurr_eff(i);
}

// C ref: hack.h HAND — polyself.c body_part()'s bodypart_types index
// (include/hack.h:134).
const HAND = 6;


// C ref: mondata.h:129 could_twoweap(ptr) — more than one of the form's first
// three attacks is AT_WEAP.  Two-weapon combat is NOT a role-name list: of the
// thirteen player-monster records only archeologist/barbarian/knight/rogue/
// samurai/tourist/valkyrie carry a second AT_WEAP, so caveman, healer, monk,
// priest, RANGER and wizard are all refused (monsters.h:3345-3455).
export function could_twoweap(ptr) {
    const rows = (ptr?.pmidx != null ? MATTK[ptr.pmidx] : null) || [];
    let n = 0;
    for (let i = 0; i < 3; i++) if (rows[i] && rows[i][0] === AT_WEAP) n++;
    return n > 1;
}

// C ref: youprop.h Upolyd.
function Upolyd() { return !!game.u?.Upolyd; }

// C ref: youprop.h Glib — the "slippery fingers" timer (same spelling
// js/do_wear.js:215 uses).
function Glib() {
    const u = game.u || {};
    return (u.uprops?.Glib | 0) > 0;
}

// C ref: obj.h is_weptool(o) / wield.c:74 TWOWEAPOK(obj).
function is_weptool(obj) {
    return obj?.oclass === TOOL_CLASS && (objects[obj.otyp]?.oc_skill ?? 0) !== 0;
}
function oc_skill(obj) { return objects[obj?.otyp]?.oc_skill ?? 0; }
// include/skills.h:43-48 — the launcher and negated-missile skill windows.
const P_BOW = 20, P_CROSSBOW = 22, P_DART = 23, P_BOOMERANG = 25;
function twoweapok(obj) {
    if (obj.oclass === WEAPON_CLASS) {
        const sk = oc_skill(obj);
        const launcher = sk >= P_BOW && sk <= P_CROSSBOW;
        const ammo = sk >= -P_CROSSBOW && sk <= -P_BOW;
        const missile = sk >= -P_BOOMERANG && sk <= -P_DART;
        return !(launcher || ammo || missile);
    }
    return is_weptool(obj);
}

// C ref: iactions.c:666-682 — the 'X' "Toggle two-weapon combat" item-action
// is offered for uwep/uswapwep when already two-weaponing, or when the quiet
// subset of can_twoweapon() passes (MAYBETWOWEAPON = TWOWEAPOK && !bimanual).
export function twoweapon_action_ok(otmp) {
    const uwep = game.uwep, uswapwep = game.uswapwep;
    if (otmp !== uwep && otmp !== uswapwep) return false;
    if (game.u?.twoweap) return true;
    const maybe = (o) => !!o && twoweapok(o) && !bimanual(o);
    return could_twoweap(youmonst_data()) && !game.uarms
        && maybe(uwep) && maybe(uswapwep);
}

// C ref: wield.c:761 can_twoweapon().  Decide whether the hero may dual-wield;
// every rejection prints its own reason.
export async function can_twoweapon() {
    const uwep = game.uwep;
    const uswapwep = game.uswapwep;
    let otmp;

    if (!could_twoweap(youmonst_data())) {
        if (Upolyd()) {
            await pline("You can't use two weapons in your current form.");
        } else {
            // "Wizards aren't able to use two weapons at once."
            const nm = (game.flags?.female && game.urole?.name?.f)
                ? game.urole.name.f : game.urole?.name?.m;
            await pline(`${makeplural(nm)} aren't able to use two weapons at once.`);
        }
    } else if (!uwep || !uswapwep) {
        // "Your hands are empty" or "Your {left|right} hand is empty"; C
        // pluralizes hand_s only when both slots are empty, which is exactly
        // when vtense(hand_s, "are") keeps "are".
        const both = !uwep && !uswapwep;
        const hand_s = both ? makeplural(body_part(HAND)) : body_part(HAND);
        await pline(`Your ${uwep ? 'left ' : uswapwep ? 'right ' : ''}${hand_s} `
            + `${both ? 'are' : 'is'} empty.`);
    } else if (!twoweapok(uwep) || !twoweapok(uswapwep)) {
        otmp = !twoweapok(uwep) ? uwep : uswapwep;
        await pline(`${Yname2(otmp)} ${is_plural(otmp) ? "aren't" : "isn't a"} suitable `
            + `${otmp === uwep ? 'primary' : 'secondary'} `
            + `weapon${(otmp.quan || 1) === 1 ? '' : 's'}.`);
    } else if (bimanual(uwep) || bimanual(uswapwep)) {
        otmp = bimanual(uwep) ? uwep : uswapwep;
        await pline(`${Yname2(otmp)} isn't one-handed.`);
    } else if (game.uarms) {
        await pline("You can't use two weapons while wearing a shield.");
    } else if (uswapwep.oartifact) {
        await pline(`${Yobjnam2(uswapwep, 'resist')} being held second to another weapon!`);
    // C's `uswapwep->otyp == CORPSE && cant_wield_corpse()` arm is dead: the
    // TWOWEAPOK() test above already rejects every FOOD_CLASS corpse.
    } else if (Glib() || uswapwep.cursed) {
        if (!Glib()) uswapwep.bknown = 1;      /* set_bknown(uswapwep, 1) */
        await drop_uswapwep();
    } else {
        return true;
    }
    return false;
}

// C ref: wield.c:806 drop_uswapwep() — uswapwep is cursed (or the hero's hands
// are slippery), so the secondary weapon lands on the floor.  Being secondary,
// it can only ever be in the left hand.
export async function drop_uswapwep() {
    const obj = game.uswapwep;
    if (!obj) return;
    const left_hand = `left ${body_part(HAND)}`;

    if (!obj.cursed)
        await pline(`${Yobjnam2(obj, 'slip')} from your ${left_hand}!`);
    else if (!game.u?.twoweap)
        await pline(`${Yobjnam2(obj, 'evade')} your grasp and ${otense(obj, 'drop')} `
            + `from your ${left_hand}!`);
    else
        await pline(`Your ${left_hand} spasms and drops ${yobjnam(obj, null)}!`);
    await dropx(obj);
}

// C ref: do.c dropx() -> dropy() -> dropz() — delegate to js/invent.js's real
// port of those three functions (freeinv, the IS_ALTAR bknown-reveal check via
// doaltarobj(), then flooreffects()/place_object()/shop-sell dispatch via
// dropz()).  Dynamic import avoids a static cycle: js/invent.js already
// imports this file's twoweapon_action_ok at module scope.
async function dropx(obj) {
    const { dropx: dropxReal } = await import('./invent.js');
    await dropxReal(obj);
}

// C ref: wield.c:833 set_twoweap — toggle the two-weapon flag.
export function set_twoweap(on_off) {
    if (!game.u) return;
    if (on_off !== game.u.twoweap) {
        game.u.twoweap = on_off;
        // botl.c:1251 renders the BL_WEAPON field only under this option.
        if (game.flags?.weaponstatus) game.botl = true;
    }
}

// C ref: wield.c:846 dotwoweapon — the #twoweapon command ('X').
// Returns ECMD_TIME (0x01) when the toggle consumes a turn, else ECMD_OK.
export async function dotwoweapon() {
    // You can always toggle it off.
    if (game.u?.twoweap) {
        await pline('You switch to your primary weapon.');
        set_twoweap(false);
        update_inventory();
        return 0; // ECMD_OK
    }

    // May we use two weapons?
    if (await can_twoweapon()) {
        await pline('You begin two-weapon combat.');
        set_twoweap(true);
        update_inventory();
        // C: return (rnd(20) > ACURR(A_DEX)) ? ECMD_TIME : ECMD_OK;
        //
        // The trailing rnd(20) is the canonical C behavior (recorded at
        // wield.c:861).  It realigns the RNG stream exactly through the next
        // command.  It previously exposed a dog_goal() divergence (the appr==0
        // invent obj_resists scan / 2nd movemon pass), but that mechanism is
        // now ported faithfully in dogmove.js + allmain.js, so the roll is
        // emitted unconditionally as C does.
        return rnd(20) > ACURR(A_DEX) ? 1 : 0;
    }
    return 0; // ECMD_OK
}

// ═══════════════════════════════════════════════════════════════════════════
// The rest of wield.c's slot machinery.  ADDITIVE ONLY — nothing above this
// line calls any of it.
//
// One thing to know before wiring any of it up: js/invent.js:439
// setuwep_slot() is a LIVE, exported, near-faithful copy of wield.c setuwep().
// It differs from C in exactly three places, all of which are present below:
//   * the two `disp.botl = TRUE` arms for gaining/losing Ogresmasher's Con bonus
//     (wield.c:110 and wield.c:124),
//   * the artifact_light()/end_burn() "Sunsword stops shining" arm (wield.c:117),
//   * `&& !is_art(obj, ART_SNICKERSNEE)` inside the is_pole() clause of the
//     gu.unweapon computation (wield.c:133).
// Wire setuwep() in by replacing setuwep_slot()'s body with a call to it — do
// NOT leave both live, or the two copies will drift
// ([[duplicate-reimplementation-shadows-faithful-port]]).
// ═══════════════════════════════════════════════════════════════════════════

import { setuqwep, addinv_nomerge, is_pole, Tobjnam, is_weptool as inv_is_weptool,
         setuwep_slot } from './invent.js';
import { is_art, artifact_light, ART_OGRESMASHER, ART_SNICKERSNEE } from './artifact.js';
import { flush_hallucination_transitions } from './potion.js';
import { GEM_CLASS } from './mkobj.js';
import { youmonst_data } from './invent.js';

// C ref: obj.h is_launcher/is_ammo/is_missile — oc_skill range tests, the same
// definitions js/invent.js:455-473 uses.  Repeated here because that file keeps
// them module-private and they are objclass.h macros, not ported logic.
const P_BOW_SK = 20, P_CROSSBOW_SK = 22, P_DART_SK = 23, P_BOOMERANG_SK = 25;
function is_launcher(obj) {
    if (!obj || obj.oclass !== WEAPON_CLASS) return false;
    const sk = oc_skill(obj);
    return sk >= P_BOW_SK && sk <= P_CROSSBOW_SK;
}
function is_ammo(obj) {
    if (!obj) return false;
    const sk = oc_skill(obj);
    return (obj.oclass === WEAPON_CLASS || obj.oclass === GEM_CLASS)
        && sk >= -P_CROSSBOW_SK && sk <= -P_BOW_SK;
}
function is_missile(obj) {
    if (!obj) return false;
    const sk = oc_skill(obj);
    return (obj.oclass === WEAPON_CLASS || obj.oclass === TOOL_CLASS)
        && sk >= -P_BOOMERANG_SK && sk <= -P_DART_SK;
}
// C ref: obj.h is_wet_towel(o) — TOWEL with spe > 0.
const TOWEL = 234;
function is_wet_towel(obj) { return obj?.otyp === TOWEL && (obj.spe | 0) > 0; }

// ── setuwep (C ref: wield.c:99) ────────────────────────────────────────────
//
// "Functions that place a given item in a slot.  Proper usage includes:
//  1. Initializing the slot during character generation or a restore.
//  2. Setting the slot due to a player's actions. ...
//  5. Emptying the slot, by passing a null object.  NEVER pass cg.zeroobj!"
//
// No RNG, but two things behind it are stream-relevant: gu.unweapon gates
// uhitm.c's one-shot "You begin bashing monsters with ..." topline, and the
// Sunsword end_burn() arm both kills a light source (vision recalc) and prints
// a line, so getting it wrong moves every later --More-- boundary.
//
// `setworn` is C's worn.c primitive; js/invent.js:422 setworn_slot(obj, QW_WEP,
// ...) is it for this slot but is module-private, so it arrives via deps and
// defaults to the exported wrapper around it.  NOTE the wrapper's own early
// `if (obj === game.uwep) return` is harmless here: C tests the same thing one
// line earlier.
export async function setuwep(obj, deps = {}) {
    const olduwep = game.uwep;

    if (obj === game.uwep)
        return;                 /* necessary to not set gu.unweapon */
    (deps.setworn || setuwep_slot)(obj);        /* setworn(obj, W_WEP) */
    /* worn.c setworn() -> set_artifact_intrinsic() -> make_hallucinated():
       Grayswandir's redraw/message runs before the Ogresmasher/Sunsword lines */
    await flush_hallucination_transitions();
    /* handle Ogresmasher before Sunsword; even though they can't be happening
       at the same time, botl flag update should come before pline message */
    if (game.uwep === obj
        && ((game.uwep && game.uwep.oartifact === ART_OGRESMASHER)
            || (olduwep && olduwep.oartifact === ART_OGRESMASHER)))
        game.botl = true;       /* gaining or losing Con bonus */
    /* This message isn't printed in the caller because it happens *whenever*
     * Sunsword is unwielded, from whatever cause. */
    if (game.uwep === obj && artifact_light(olduwep) && olduwep.lamplit) {
        await (deps.end_burn || (await import('./timeout.js')).end_burn)(olduwep, false);
        if (!(await import('./vision.js')).Blind())   /* C: `if (!Blind)` */
            await pline(`${Tobjnam(olduwep, 'stop')} shining.`);
    }
    if (game.uwep === obj
        && (u_wield_art(ART_OGRESMASHER) || is_art(olduwep, ART_OGRESMASHER)))
        game.botl = true;
    /* Note: Explicitly wielding a pick-axe will not give a "bashing" message.
     * Wielding one via 'a'pplying it will.
     * 3.2.2:  Wielding arbitrary objects will give bashing message too.
     */
    if (obj) {
        game.unweapon = (obj.oclass === WEAPON_CLASS)
            ? (is_launcher(obj) || is_ammo(obj) || is_missile(obj)
               || (is_pole(obj) && !game.u?.usteed
                   && !is_art(obj, ART_SNICKERSNEE)))
            : (!inv_is_weptool(obj) && !is_wet_towel(obj));
    } else {
        game.unweapon = true;   /* for "bare hands" message */
    }
}
// C ref: artifact.h u_wield_art(art) — the hero is wielding that artifact.
function u_wield_art(art) { return is_art(game.uwep, art); }

// ── finish_splitting (C ref: wield.c:345) ─────────────────────────────────
//
// "obj was split off from something; give it its own invlet."  freeinv() then
// addinv_nomerge() is the pair that stops the split stack merging straight back
// into its parent — using plain addinv() here is the classic way to make a
// 2-of-N split silently reunite.
export function finish_splitting(obj) {
    freeinv(obj);
    addinv_nomerge(obj);
}

// ── uwepgone / uswapwepgone / uqwepgone (C ref: wield.c:873, :887, :896) ──
//
// "These function empty a slot and cannot be used to fill a slot.  Proper usage
// includes: 1. The item has been eaten, stolen, burned away, or rotted away.
// 2. Making an item disappear for a bones pile."
//
// js/eat.js:3195 records that none of the three was exported by this port; this
// is that gap.  setuwep_slot(null)/setuswapwep(null)/setuqwep(null) are C's
// `setworn((struct obj *) 0, W_xxx)` for the three weapon slots (they also clear
// two-weapon combat, which C's setworn does too).
export async function uwepgone(deps = {}) {
    if (game.uwep) {
        if (artifact_light(game.uwep) && game.uwep.lamplit) {
            await (deps.end_burn || (await import('./timeout.js')).end_burn)(game.uwep, false);
            if (!(await import('./vision.js')).Blind())   /* C: `if (!Blind)` */
                await pline(`${Tobjnam(game.uwep, 'stop')} shining.`);
        }
        hold_botl_con();                /* no disp.botl here: Ogresmasher's Con lingers */
        setuwep_slot(null);             /* setworn(0, W_WEP) */
        await flush_hallucination_transitions();
        game.unweapon = true;
        update_inventory();
    }
}

export function uswapwepgone() {
    if (game.uswapwep) {
        setuswapwep(null);              /* setworn(0, W_SWAPWEP) */
        update_inventory();
    }
}

export function uqwepgone() {
    if (game.uquiver) {
        setuqwep(null);                 /* setworn(0, W_QUIVER) */
        update_inventory();
    }
}
