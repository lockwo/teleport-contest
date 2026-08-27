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

import { game } from './gstate.js';
import { pline, newsym } from './display.js';
import { rnd } from './rng.js';
import {
    update_inventory, xname, is_plural, bimanual, otense, makeplural,
    body_part, setuswapwep, freeinv, inventoryArray, encumber_msg,
} from './invent.js';
import { objects, WEAPON_CLASS, TOOL_CLASS } from './mkobj.js';
import { monster_by_pmidx } from './makemon.js';
import { MATTK, AT_WEAP } from './monattk_data.js';
import { A_DEX } from './const.js';

// C ref: attrib.h ACURR(x) — current attribute value (acurr.a in
// [STR,INT,WIS,DEX,CON,CHA] order).
function ACURR(i) {
    return game.u?.acurr?.a?.[i] ?? 0;
}

// C ref: hack.h HAND — polyself.c body_part()'s bodypart_types index
// (include/hack.h:134).
const HAND = 6;

// mons[] index of the first role monster; js/hack.js keeps u.umonnum at the
// 0-based ROLE index while not polymorphed, so it has to be added (same
// resolution js/artifact.js:509 uses).
const PM_ARCHEOLOGIST = 331;

// C ref: monst.h gy.youmonst.data.
function youmonst_data() {
    const u = game.u;
    if (u?.Upolyd) return monster_by_pmidx(u.umonnum) || u?.data || null;
    return monster_by_pmidx(PM_ARCHEOLOGIST + (u?.umonnum ?? 0)) || u?.data || null;
}

// C ref: mondata.h:129 could_twoweap(ptr) — more than one of the form's first
// three attacks is AT_WEAP.  Two-weapon combat is NOT a role-name list: of the
// thirteen player-monster records only archeologist/barbarian/knight/rogue/
// samurai/tourist/valkyrie carry a second AT_WEAP, so caveman, healer, monk,
// priest, RANGER and wizard are all refused (monsters.h:3345-3455).
function could_twoweap(ptr) {
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
    return ((u.Glib | 0) > 0) || ((u.uprops?.Glib | 0) > 0) || ((u.uprops?.HGlib | 0) > 0);
}

// C ref: obj.h carried(o) == (o->where == OBJ_INVENT).  js/invent.js:261 spells
// OBJ_INVENT as the string 'invent' while js/const.js:1107 carries C's 3, so
// match on the inventory chain itself (js/invent.js:293's own fallback).
function carried(obj) { return !!obj && inventoryArray().includes(obj); }

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

// C ref: objnam.c xname() — the bare name, pluralized for a stack but with NO
// count (the count belongs to doname()/aobjnam()).  js/invent.js's xname() is
// "quantity-aware" and prepends obj->quan, so strip that prefix back off: the
// recorder says "Your darts aren't suitable secondary weapons.", not
// "Your 10 darts ...".
function xname_c(obj) {
    const s = xname(obj), q = obj.quan | 0;
    return (q > 1 && s.startsWith(`${q} `)) ? s.slice(String(q).length + 1) : s;
}
// C ref: objnam.c:1924 cxname(obj) — xname(), except a corpse gains its monster
// type.  can_twoweapon()'s TWOWEAPOK() test rejects a corpse before any of
// these names is built, so xname() is the whole reachable body.
function cxname(obj) { return xname_c(obj); }

// C ref: shk.c:5862 shk_your(buf, obj) — "your " for a carried item, "the " for
// one on the floor.  The shopkeeper-owns / monster-owns overrides need shk.c's
// bill, which no can_twoweapon() caller can reach with an unpaid weapon in the
// offhand slot without also being inside the shop.
function shk_your(obj) { return carried(obj) ? 'your ' : 'the '; }

// C ref: objnam.c not_fully_identified(otmp) — the fundamental ID hallmarks.
// Anything this port does not track counts as NOT known, which is the
// conservative answer: it keeps yobjnam()'s "your" prefix, exactly as C does
// for an artifact that is not yet fully identified.
function not_fully_identified(obj) {
    if (!obj.known || !obj.dknown || !obj.bknown
        || !objects[obj.otyp]?.oc_name_known)
        return true;
    if (obj.oartifact && !(game.artidisco || []).includes(obj.oartifact))
        return true;
    /* rknown is the only item of interest if we reach here; without it only
       damageable (rust/burn/rot/corrode-prone) objects fall short, and every
       artifact weapon is damageable. */
    return !obj.rknown;
}

// C ref: objnam.c obj_is_pname(obj) — an artifact bearing its own name string
// that the hero has fully identified.
function obj_is_pname(obj) {
    if (!obj.oartifact || !obj.oname) return false;
    return !not_fully_identified(obj);
}

// artilist.h:219 — ART_ORB_OF_DETECTION, the first quest artifact.
const ART_ORB_OF_DETECTION = 21;

// C ref: objnam.c:2244 aobjnam(otmp, verb) — "<count> <cxname> <otense(verb)>".
function aobjnam(obj, verb) {
    let bp = cxname(obj);
    if ((obj.quan || 1) !== 1) bp = `${obj.quan} ${bp}`;
    if (verb) bp += ` ${otense(obj, verb)}`;
    return bp;
}

// C ref: objnam.c:2262 yobjnam() / :2359 yname() — both prepend an ownership
// prefix, which is left off for a carried, fully-identified, non-quest named
// artifact ("Excalibur resists ...", not "Your Excalibur resists ...").
function own_prefix(obj) {
    if (!carried(obj) || !obj_is_pname(obj) || obj.oartifact >= ART_ORB_OF_DETECTION)
        return shk_your(obj);
    return '';
}
// yname() is built on cxname() and carries NO count; yobjnam() is built on
// aobjnam() and does.
function yname(obj) { return own_prefix(obj) + cxname(obj); }
function yobjnam(obj, verb) { return own_prefix(obj) + aobjnam(obj, verb); }
function highc(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
// C ref: objnam.c:2280 Yobjnam2 / :2378 Yname2 — capitalized yobjnam()/yname().
function Yobjnam2(obj, verb) { return highc(yobjnam(obj, verb)); }
function Yname2(obj) { return highc(yname(obj)); }

// C ref: objnam.c badman(basestr, TRUE) — the *man prefixes with no *men
// plural.  Each entry must sit at the very start of the word (or right after a
// space), which is why "caveman" is NOT excluded.
const NO_MEN = [
    'albu', 'antihu', 'anti', 'ata', 'auto', 'bildungsro', 'cai', 'cay',
    'ceru', 'corner', 'decu', 'des', 'dura', 'fir', 'hanu', 'het',
    'infrahu', 'inhu', 'nonhu', 'otto', 'out', 'prehu', 'protohu',
    'subhu', 'superhu', 'talis', 'unhu', 'sha',
    'hu', 'un', 'le', 're', 'so', 'to', 'at', 'a',
];
function badman(basestr) {
    if (!basestr || basestr.length < 4) return false;
    const s = basestr.toLowerCase();
    for (const pre of NO_MEN) {
        const at = s.length - (pre.length + 3);
        if (at < 0 || s.substr(at, pre.length) !== pre) continue;
        if (at === 0 || s.charAt(at - 1) === ' ') return true;
    }
    return false;
}

// C ref: objnam.c makeplural() — the man/men arm, which js/invent.js's
// makeplural() skips for every [aeiou]man, so it answers "Cavemans" where the
// recorder says "Cavemen".  Applied here to the role name before delegating;
// remove once invent.js carries badman() itself.
function makeplural_c(oldstr) {
    const s = String(oldstr || '');
    if (s.length >= 3 && s.slice(-3).toLowerCase() === 'man' && !badman(s))
        return `${s.slice(0, -2)}en`;
    return makeplural(s);
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
            await pline(`${makeplural_c(nm)} aren't able to use two weapons at once.`);
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

// C ref: do.c dropx() -> dropy() -> dropz() — no message; the slot is emptied,
// the object leaves inventory and is placed underfoot.  ship_object/doaltarobj/
// flooreffects/sellobj/stackobj need do.c's floor machinery, which js/invent.js's
// own drop() path (js/invent.js:7142 dropz) does not model either.
async function dropx(obj) {
    freeinv(obj);               /* dropx() */
    setuswapwep(null);          /* dropz(): obj == uswapwep */
    const u = game.u || {};
    obj.ox = u.ux; obj.oy = u.uy;
    if (game.level) {
        if (!Array.isArray(game.level.objects)) game.level.objects = [];
        if (!game.level.objects.includes(obj)) game.level.objects.push(obj);
    }
    newsym(u.ux, u.uy);         /* remap location under self */
    await encumber_msg();
}

// C ref: wield.c:833 set_twoweap — toggle the two-weapon flag.
function set_twoweap(on_off) {
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

import { setuqwep, addinv_nomerge, is_pole, is_weptool as inv_is_weptool,
         setuwep_slot } from './invent.js';
import { is_art, artifact_light, ART_OGRESMASHER, ART_SNICKERSNEE } from './artifact.js';
import { GEM_CLASS } from './mkobj.js';

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
    /* handle Ogresmasher before Sunsword; even though they can't be happening
       at the same time, botl flag update should come before pline message */
    if (game.uwep === obj
        && ((game.uwep && game.uwep.oartifact === ART_OGRESMASHER)
            || (olduwep && olduwep.oartifact === ART_OGRESMASHER)))
        game.botl = true;       /* gaining or losing Con bonus */
    /* This message isn't printed in the caller because it happens *whenever*
     * Sunsword is unwielded, from whatever cause. */
    if (game.uwep === obj && artifact_light(olduwep) && olduwep.lamplit) {
        await deps.end_burn?.(olduwep, false);
        if (!game.u?.Blinded)
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
// C ref: objnam.c Tobjnam(obj, verb) — capitalised "The <obj> <verbs>".
function Tobjnam(obj, verb) { return highc(aobjnam(obj, verb)); }

// ── cant_wield_corpse (C ref: wield.c:137) ─────────────────────────────────
//
// "Prevent wielding a cockatrice when not wearing gloves --KAA".  Returns TRUE
// after killing the hero, so every caller must treat TRUE as "abort".
// js/wield.js:230 notes the uswapwep arm of this test as dead in the covered
// sessions; this is the function that arm calls.
export async function cant_wield_corpse(obj, deps = {}) {
    if (game.uarmg || obj.otyp !== CORPSE_OTYP
        || !deps.touch_petrifies?.(obj.corpsenm)
        || deps.Stone_resistance?.())
        return false;

    await pline(`You wield ${deps.corpse_xname?.(obj, null, /* CXN_PFX_THE */ 4)
                             ?? `the ${xname_c(obj)}`} in your bare `
                + `${makeplural_c(body_part(HAND))}.`);
    const kbuf = `wielding ${deps.killer_xname?.(obj) ?? xname_c(obj)} bare-handed`;
    await deps.instapetrify?.(kbuf);
    return true;
}
// C ref: objects.h CORPSE.  (makeplural_c()/body_part()/HAND are already in
// this file, at lines 187, 32 and the invent.js import.)
const CORPSE_OTYP = 265;

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
            await deps.end_burn?.(game.uwep, false);
            if (!game.u?.Blinded)
                await pline(`${Tobjnam(game.uwep, 'stop')} shining.`);
        }
        setuwep_slot(null);             /* setworn(0, W_WEP) */
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
