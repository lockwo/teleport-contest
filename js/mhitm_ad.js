// mhitm_ad.js — C's shared AD_* damage-type family (src/uhitm.c:2280-4830).
//
// In C one `mhitm_ad_<type>()` per damage type serves all three combat
// directions, branching internally on `magr == &youmonst` (hero attacks),
// `mdef == &youmonst` (hero defends) and neither (monster vs monster).  This
// port had the family scattered: js/mhitm.js:468 handled AD_PHYS plus the
// nymph theft pair and let every other type fall through with only its base
// damage, while js/monmove.js:6392 handled five types for the hero-defender
// side.  Both `default:` arms drew NOTHING where C draws RNG in most arms, so
// a raven (AD_BLND), leprechaun (AD_SGLD), werejackal (AD_WERE), vampire bat
// (AD_DRLI) or fire ant (AD_FIRE) — all Dlvl 2-6 monsters — desynced the
// stream for the rest of the turn.
//
// The handlers are collected here ONCE and take C's `mhm` struct.  The caller
// supplies an `ops` bundle for the things it owns (name rendering, visibility,
// the kill tail); that keeps this module free of an import cycle back into
// js/mhitm.js and lets the hero-defender caller drive the same handlers.
//
// WIRED: js/mhitm.js mdamagem() (monster vs monster).  STILL TO WIRE, both
// outside this change's file lease: js/monmove.js:6392 (its own 5-arm
// mhitm_adtyping, hero as defender) and a damageum() in js/uhitm.js (hero
// polyform).  Pass YOUMONST as the hero side and fill in the ops marked
// "hero-defender only" below.
//
//   ops.permonst(mon)        species record (name-resolved; see mhitm.js)
//   ops.vis                  C's gv.vis, LATCHED by the caller before the hit
//   ops.Monnam/mon_nam       unconditional "The jackal" / "the jackal"
//   ops.Monnam_vis/mon_nam_vis   collapse to "it" when unspottable
//   ops.canseemon/canspotmon
//   ops.emit(msg)            pline -> update_topl
//   ops.monkilled(mdef, ad)  death line + detach + corpse (mon.c monkilled)
//   ops.mondied(mdef)        detach + corpse, no death line
//   ops.grow_up(magr, mdef)  killer's level gain; FALSE => M_ATTK_AGR_DIED
//   ops.MON_WEP(mon)
//   ops.monLev(mon)
//   ops.mattk_list(mon)
//   ops.hitmsg(magr, mattk)  hero-defender only ("The cobra bites!")
//
// A handler that needs machinery this port does not carry yet stops at the
// last faithful step and says so, rather than inventing a roll: an explicit
// screen divergence beats a silent PRNG desync.

import { game } from './gstate.js';
import { rn2, rnd, rn1, d } from './rng.js';
import {
    mflags1_of, mflags2_of, is_animal, is_undead_flag, is_were_flag,
    is_demon_flag,
    M1_NOEYES, M1_NOHEAD, M1_THICK_HIDE, M1_SLITHY, M1_CARNIVORE,
    M1_HERBIVORE, M1_METALLIVORE, M1_ACID, M1_POIS, M2_UNDEAD, M2_MINION,
} from './monflags_data.js';
import { DEADMONSTER, healmon } from './mon.js';
import {
    STRAT_WAITFORU, W_ARMOR, W_AMUL, W_ARMH, W_ARMS, W_ARMG, W_ARMF,
    A_STR, A_DEX, LEFT_SIDE, RIGHT_SIDE,
} from './const.js';
import { dmgval } from './uhitm.js';
import { monster_by_pmidx } from './makemon.js';
import {
    objects as OBJECTS, POTION_CLASS, SCROLL_CLASS, SPBOOK_CLASS,
    RING_CLASS, WAND_CLASS, COIN_CLASS, FOOD_CLASS,
} from './mkobj.js';
// mhitu.c owns these; uhitm.c's shared AD_* handlers call them across the file
// boundary (uhitm.c:86 / 3109 / 3232 / 3675 / 3824).  Every one of them is read
// inside a function body only, so the mhitu.js <-> mhitm_ad.js import cycle can
// be entered from either side without a TDZ.
import { magic_negation, mpoisons_subj, diseasemu, u_slip_free,
    u_slow_down } from './mhitu.js';

// ── include/monattk.h ────────────────────────────────────────────────────────
export const AD_PHYS = 0, AD_MAGM = 1, AD_FIRE = 2, AD_COLD = 3, AD_SLEE = 4,
    AD_DISN = 5, AD_ELEC = 6, AD_DRST = 7, AD_ACID = 8, AD_BLND = 11,
    AD_STUN = 12, AD_SLOW = 13, AD_PLYS = 14, AD_DRLI = 15, AD_DREN = 16,
    AD_LEGS = 17, AD_STON = 18, AD_STCK = 19, AD_SGLD = 20, AD_SITM = 21,
    AD_SEDU = 22, AD_TLPT = 23, AD_RUST = 24, AD_CONF = 25, AD_DGST = 26,
    AD_HEAL = 27, AD_WRAP = 28, AD_WERE = 29, AD_DRDX = 30, AD_DRCO = 31,
    AD_DRIN = 32, AD_DISE = 33, AD_DCAY = 34, AD_SSEX = 35, AD_HALU = 36,
    AD_DETH = 37, AD_PEST = 38, AD_FAMN = 39, AD_SLIM = 40, AD_ENCH = 41,
    AD_CORR = 42, AD_POLY = 43, AD_SAMU = 252, AD_CURS = 253;

const AT_NONE = 0, AT_CLAW = 1, AT_BITE = 2, AT_KICK = 3, AT_BUTT = 4,
    AT_TUCH = 5, AT_STNG = 6, AT_HUGS = 7, AT_SPIT = 10, AT_ENGL = 11,
    AT_BREA = 12, AT_EXPL = 13, AT_BOOM = 14, AT_GAZE = 15, AT_TENT = 16,
    AT_WEAP = 254, AT_MAGC = 255;

// C ref: mhitm.c / uhitm.c M_ATTK_* (include/hack.h).
const M_ATTK_MISS = 0, M_ATTK_HIT = 1, M_ATTK_DEF_DIED = 2,
    M_ATTK_AGR_DIED = 4, M_ATTK_AGR_DONE = 8;

// C ref: monst.h — mresists bits used by the damage arms.
const MR_FIRE = 0x01, MR_COLD = 0x02, MR_SLEEP = 0x04, MR_DISINT = 0x08,
    MR_ELEC = 0x10, MR_POISON = 0x20, MR_ACID = 0x40, MR_STONE = 0x80;

// C ref: monsym.h — mlet values the arms key on.
// Values are the S_* enum from include/sym.h, which is generated from
// defsym.h's `MONSYM(idx, ...) sym = idx` — i.e. the mons[].mlet numbering that
// this port stores as permonst.mcls (verified: lich 38, wood nymph 14,
// cockatrice 3, Medusa 53).  FOUR of these were the 'a' - 'z' ordinal instead
// of the enum value and so named a different class entirely:
//   S_FUNGUS was 15 (that is S_ORC)       -> defsym.h:332 = 32
//   S_SNAKE  was 34 (that is S_GIANT)     -> defsym.h:346 = 45
//   S_NAGA   was 31 (that is S_ELEMENTAL) -> defsym.h:341 = 40
//   S_HUMAN  was 41 (that is S_OGRE)      -> defsym.h:356 = 53
const S_NYMPH = 14, S_FUNGUS = 32, S_SNAKE = 45, S_NAGA = 40, S_HUMAN = 53,
    S_LICH = 38, S_GOLEM = 55;

// The hero, as a defender.  C compares pointers against &gy.youmonst; the
// callers pass this sentinel for the mhitu direction.
export const YOUMONST = Symbol('youmonst');
const is_hero = (m) => m === YOUMONST;

// ── small species predicates ────────────────────────────────────────────────
const haseyes = (ptr) => (mflags1_of(ptr) & M1_NOEYES) === 0;
const has_head = (ptr) => (mflags1_of(ptr) & M1_NOHEAD) === 0;
const thick_skinned = (ptr) => (mflags1_of(ptr) & M1_THICK_HIDE) !== 0;
const slithy = (ptr) => (mflags1_of(ptr) & M1_SLITHY) !== 0;
const carnivorous = (ptr) => (mflags1_of(ptr) & M1_CARNIVORE) !== 0;
const herbivorous = (ptr) => (mflags1_of(ptr) & M1_HERBIVORE) !== 0;
const metallivorous = (ptr) => (mflags1_of(ptr) & M1_METALLIVORE) !== 0;
const acidic = (ptr) => (mflags1_of(ptr) & M1_ACID) !== 0;
const poisonous = (ptr) => (mflags1_of(ptr) & M1_POIS) !== 0;
const is_undead = (ptr) => (mflags2_of(ptr) & M2_UNDEAD) !== 0;

const mres = (ops, mon, bit) => ((ops.permonst(mon)?.mresists ?? 0) & bit) !== 0;
const resists_fire = (ops, m) => mres(ops, m, MR_FIRE);
const resists_cold = (ops, m) => mres(ops, m, MR_COLD);
const resists_elec = (ops, m) => mres(ops, m, MR_ELEC);
const resists_acid = (ops, m) => mres(ops, m, MR_ACID);
const resists_ston = (ops, m) => mres(ops, m, MR_STONE);
const resists_poison = (ops, m) => mres(ops, m, MR_POISON);
const resists_sleep = (ops, m) => mres(ops, m, MR_SLEEP);

// C ref: mondata.h resists_drli(mon) — undead, demons, the Wizard, and
// anything with MR_DRAIN-equivalent species flags.  mons[].mresists has no
// drain bit in 3.7; C tests `is_undead(ptr) || is_demon(ptr) || is_were(ptr)
// || ptr == &mons[PM_DEATH]` via the MR_ bitmask built in mondata.c.  The
// undead/were half is what a vampire bat or a werejackal actually meets.
function resists_drli(ops, mon) {
    const ptr = ops.permonst(mon);
    return is_undead(ptr) || is_demon_flag(ptr) || is_were_flag(ptr)
        || ptr?.name === 'Death';
}

// C ref: mondata.c defended(mon, adtyp) — dragon scales / scale mail that
// guard against a damage type.  js/zap.js:1555 already answers FALSE for every
// monster in this port (none wears dragon scales); keep the call sites so the
// predicate has one place to grow.
const defended = (_mon, _adtyp) => false;

// C ref: mondata.h completelyburns/completelyrusts/completelyrots — the golems
// that a matching damage type destroys outright.
const completelyburns = (ptr) => ptr?.name === 'paper golem'
    || ptr?.name === 'straw golem';
const completelyrusts = (ptr) => ptr?.name === 'iron golem';
const completelyrots = (ptr) => ptr?.name === 'wood golem'
    || ptr?.name === 'leather golem';
// C ref: mondata.h poly_when_stoned(ptr) — a flesh golem//clay golem becomes a
// stone golem instead of dying.
const poly_when_stoned = (ptr) => ptr?.mcls === S_GOLEM
    && ptr?.name !== 'stone golem';
// C ref: mondata.h:75 slimeproof(ptr) — green slime || flaming() ||
// noncorporeal().  It is NOT "acidic or a golem": a straw golem IS slimeable.
const FLAMING_NAMES = new Set(['fire vortex', 'flaming sphere',
    'fire elemental', 'salamander']);            // mondata.h:59 flaming()
// defsym.h:358 MONSYM(54, ' ', GHOST, S_GHOST) — 24 is S_XAN, so slimeproof()
// used to answer TRUE for a xan and FALSE for a ghost.
const S_GHOST = 54;
const slimeproof = (ptr) => ptr?.name === 'green slime'
    || FLAMING_NAMES.has(ptr?.name) || ptr?.mcls === S_GHOST;

// C ref: mondata.h:200 touch_petrifies(ptr) — PM_COCKATRICE || PM_CHICKATRICE
// ONLY.  Medusa is flesh_petrifies(), a strictly wider macro; including her
// here would stone anything that bit her, which C does not do.
const touch_petrifies = (ptr) => ptr?.name === 'cockatrice'
    || ptr?.name === 'chickatrice';

// ── uhitm.c:75 mhitm_mgc_atk_negated ────────────────────────────────────────
// "armor that sufficiently covers the body might be able to block magic".
// The rn2(10) ALWAYS fires for an uncancelled attacker, which is why leaving a
// damage type on the dispatcher's `default:` arm loses a call: nearly every
// AD_* handler opens with this test.
export async function mhitm_mgc_atk_negated(magr, mdef, verbosely, ops) {
    // mcan doesn't apply to youmonst; the hero can't be cancelled.
    if (!is_hero(magr) && magr.mcan) return true;   // no message, no roll
    const armpro = magic_negation(mdef);            // uhitm.c:86
    const negated = !(rn2(10) >= 3 * armpro);       // uhitm.c:87
    if (negated && verbosely) {
        if (is_hero(mdef)) await ops.emit('You avoid harm.');
        else if (ops.vis && ops.canseemon(mdef))
            await ops.emit(`${ops.Monnam(mdef)} avoids harm.`);
    }
    return negated;
}

// magic_negation() now lives in js/mhitu.js (its C home, mhitu.c:1089).  The
// copy that used to be here returned 0 for the HERO unless the caller injected
// a magic_negation_hero hook, so every hero-defender arm read armpro == 0 and
// mhitm_mgc_atk_negated()'s `rn2(10) >= 3 * armpro` could never come out
// un-negated for an armoured hero.
//
// NOTE: js/invent.js deliberately remaps some W_* bits for HERO inventory
// (its W_AMUL is 0x00080000, const.js's is 0x00010000) — see the worn-mask
// remap note.  The monster arm reads misc_worn_check / minvent owornmask,
// which use the const.js layout.

// ── uhitm.c:126 erode_armor ─────────────────────────────────────────────────
// Loops rn2(5) until it lands on a slot that erodes (case 1, the torso, always
// terminates because the body is a target whether or not it is covered).  For
// an unarmoured monster that is a geometric run of rn2(5) draws — real RNG the
// `default:` arm was throwing away for every rust monster / black pudding /
// acid blob hit.
async function erode_armor(mdef, _hurt, ops) {
    const chain = is_hero(mdef) ? (game.invent || []) : (mdef.minvent || []);
    const worn = (mask) => chain.some((o) => (o.owornmask || 0) & mask);
    for (;;) {
        switch (rn2(5)) {                       // uhitm.c:136
        case 0: if (worn(W_ARMH)) return; continue;
        case 1: return;                         // torso: always terminates
        case 2: if (worn(W_ARMS)) return; continue;
        case 3: if (worn(W_ARMG)) return; continue;
        case 4: if (worn(W_ARMF)) return; continue;
        }
    }
    // APPROXIMATION: C re-rolls when erode_obj() returns ER_NOTHING (slot empty
    // OR the piece is already maximally eroded / greased); this stops at "slot
    // occupied", so an armoured target can end the walk one draw early.  The
    // unarmoured case — the only one this port's monsters reach — is exact.
    // erode_obj()'s "Your <armor> rusts!" messaging needs the erosion fields.
    void ops;
}

// ── zap.c destroy_items (monster carrier) ───────────────────────────────────
// AD_FIRE / AD_COLD / AD_ELEC all end with `mhm->damage += destroy_items(...)`,
// and destroy_items ALWAYS draws its rn2(DMG_DESTROY_SCALE) limit roll before
// looking at the inventory — so even a monster carrying nothing costs one call.
// (js/zap.js has the hero-side twin but does not export it; see `deferred`.)
const DMG_DESTROY_SCALE = 5, MAX_ITEMS_DESTROYED = 20;
// otyps resolved from this port's own objects[] (js/mkobj.js), NOT from
// upstream onames.h — the two numberings differ.
const POT_OIL = 321, SCR_FIRE = 339, SPE_FIREBALL = 368,
      GLOB_OF_GREEN_SLIME = 273, WAN_LIGHTNING = 434,
      // js/mkobj.js:393.  js/zap.js:2084's twin hardcodes 207, which is
      // AMULET_OF_UNCHANGING (js/mkobj.js:409) — see `deferred`.
      RIN_SHOCK_RESISTANCE = 191;

function destroyable(obj, adtyp) {
    if (obj.oartifact) return false;
    if (obj.in_use && obj.quan === 1) return false;
    if (adtyp === AD_FIRE) {
        if (obj.otyp === SCR_FIRE || obj.otyp === SPE_FIREBALL) return false;
        return obj.otyp === GLOB_OF_GREEN_SLIME || obj.oclass === POTION_CLASS
            || obj.oclass === SCROLL_CLASS || obj.oclass === SPBOOK_CLASS;
    }
    if (adtyp === AD_COLD)
        return obj.oclass === POTION_CLASS && obj.otyp !== POT_OIL;
    if (adtyp === AD_ELEC) {
        if (obj.oclass !== RING_CLASS && obj.oclass !== WAND_CLASS) return false;
        return obj.otyp !== RIN_SHOCK_RESISTANCE && obj.otyp !== WAN_LIGHTNING;
    }
    return false;
}

async function destroy_items_mon(mon, dmgtyp, dmg_in, ops) {
    let limit = Math.floor(dmg_in / DMG_DESTROY_SCALE);
    if (dmg_in % DMG_DESTROY_SCALE > rn2(DMG_DESTROY_SCALE)) limit++;
    if (limit > MAX_ITEMS_DESTROYED) limit = MAX_ITEMS_DESTROYED;
    if (limit < 1) return 0;

    const picks = new Array(MAX_ITEMS_DESTROYED).fill(null);
    let elig = 0;
    for (const obj of (mon.minvent || [])) {
        if (!destroyable(obj, dmgtyp)) continue;
        const i = (elig < limit) ? elig : rn2(elig);   // reservoir sample
        elig++;
        if (i < 0 || i >= limit) continue;
        picks[i] = obj;
    }
    if (elig > limit) elig = limit;
    let dmg_out = 0;
    for (let i = 0; i < elig; i++) {
        const obj = picks[i];
        if (obj) dmg_out += await maybe_destroy_item_mon(mon, obj, dmgtyp, ops);
    }
    return dmg_out;
}

// C ref: zap.c destroy_strings[dindx][0 singular, 1 plural, 2 killer reason].
const DESTROY_STRINGS = [
    ['freezes and shatters', 'freeze and shatter', 'shattered potion'],
    ['boils and explodes', 'boil and explode', 'boiling potion'],
    ['ignites and explodes', 'ignite and explode', 'exploding potion'],
    ['catches fire and burns', 'catch fire and burn', 'burning scroll'],
    ['catches fire and burns', null, 'burning book'],
    ['turns to dust and vanishes', null, null],
    ['breaks apart and explodes', null, 'exploding wand'],
];

// C ref: zap.c destroy_items(&gy.youmonst, dmgtyp, dmg_in) — the u_carry arm of
// the same routine destroy_items_mon() ports.  It runs off gi.invent and its
// damage lands on the hero through losehp() instead of being returned.  The
// leading rn2(DMG_DESTROY_SCALE) fires even when 'limit' ends up 0, which is
// the common case for a small melee hit — and it is a real call in the stream.
export async function destroy_items_hero(dmgtyp, dmg_in, ops) {
    let limit = Math.floor(dmg_in / DMG_DESTROY_SCALE);
    if (dmg_in % DMG_DESTROY_SCALE > rn2(DMG_DESTROY_SCALE)) limit++;
    if (limit > MAX_ITEMS_DESTROYED) limit = MAX_ITEMS_DESTROYED;
    if (limit < 1) return 0;

    const picks = new Array(MAX_ITEMS_DESTROYED).fill(null);
    let elig = 0;
    for (const obj of (game.invent || [])) {
        if (!destroyable(obj, dmgtyp)) continue;
        const i = (elig < limit) ? elig : rn2(elig);   // reservoir sample
        elig++;
        if (i < 0 || i >= limit) continue;
        picks[i] = obj;
    }
    if (elig > limit) elig = limit;
    let dmg_out = 0;
    for (let i = 0; i < elig; i++) {
        const obj = picks[i];
        if (obj) dmg_out += await maybe_destroy_item_hero(obj, dmgtyp, ops);
    }
    return dmg_out;
}

// C ref: zap.c u_adtyp_resistance_obj() / inventory_resistance_check() — an
// EXTRINSIC source of the matching resistance protects carried items 99% of the
// time (a dwarvish cloak 90% against heat/cold).  The rn2(100) only happens
// when such a source is worn, so a hero without one spends no call here.
function inventory_resistance_check(dmgtyp) {
    const u = game.u || {};
    const prop = (dmgtyp === AD_COLD) ? 'Cold_resistance'
        : (dmgtyp === AD_FIRE) ? 'Fire_resistance'
            : (dmgtyp === AD_ELEC) ? 'Shock_resistance' : null;
    if (!prop) return false;
    const prob = (u.uprops?.['E' + prop] || u['E' + prop]) ? 99 : 0;
    if (!prob) return false;
    return rn2(100) < prob;
}

// C ref: zap.c maybe_destroy_item(&gy.youmonst, obj, dmgtyp).
async function maybe_destroy_item_hero(obj, dmgtyp, ops) {
    if (inventory_resistance_check(dmgtyp)) return 0;
    let dmg = 0, dindx = 0, quan = obj.quan | 0;
    switch (dmgtyp) {
    case AD_COLD: dindx = 0; dmg = rnd(4); break;
    case AD_FIRE:
        switch (obj.oclass) {
        case POTION_CLASS: dindx = (obj.otyp !== POT_OIL) ? 1 : 2; dmg = rnd(6); break;
        case SCROLL_CLASS: dindx = 3; dmg = 1; break;
        case SPBOOK_CLASS: dindx = 4; dmg = 1; break;
        default: dindx = 1; dmg = Math.floor(((obj.owt | 0) + 19) / 20); break;
        }
        break;
    case AD_ELEC:
        if (obj.oclass === WAND_CLASS) { dindx = 6; dmg = rnd(10); }
        else { dindx = 5; dmg = 0; }
        break;
    default: return 0;
    }
    if (obj.in_use) quan--;
    let cnt = 0;
    for (let i = 0; i < quan; i++) if (!rn2(3)) cnt++;
    if (!cnt) return 0;
    const mult = (cnt === 1) ? ((quan === 1) ? '' : 'One of ')
        : ((cnt < quan) ? 'Some of ' : (quan === 2) ? 'Both of ' : 'All of ');
    const nm = ops.yname ? ops.yname(obj) : (OBJECTS[obj.otyp]?.name || 'item');
    await ops.emit(`${mult}${cnt === 1 && quan === 1 ? 'Your' : 'your'} ${nm} ${
        DESTROY_STRINGS[dindx][(cnt > 1) ? 1 : 0]}!`);
    // potionbreathe() (AD_FIRE/AD_ELEC potions only), Ring_gone()/setnotworn()
    // and gc.current_wand are not reached by an AD_COLD potion shatter, the only
    // caller wired to this today.
    if (ops.useup) for (let i = 0; i < cnt; i++) ops.useup(obj);
    if (dmg && ops.losehp) await ops.losehp(dmg);
    return dmg;
}

async function maybe_destroy_item_mon(mon, obj, dmgtyp, ops) {
    let dmg = 0, quan = obj.quan | 0, xresist = false;
    switch (dmgtyp) {
    case AD_COLD: dmg = rnd(4); break;
    case AD_FIRE:
        xresist = (obj.oclass !== POTION_CLASS
                   && obj.otyp !== GLOB_OF_GREEN_SLIME
                   && resists_fire(ops, mon));
        // zap.c maybe_destroy_item: rnd(6) for either potion dindx; scrolls and
        // spellbooks are a flat 1; a FOOD_CLASS glob is weight-scaled, NOT 1.
        switch (obj.oclass) {
        case POTION_CLASS: dmg = rnd(6); break;
        case SCROLL_CLASS: case SPBOOK_CLASS: dmg = 1; break;
        case FOOD_CLASS: dmg = Math.floor(((obj.owt | 0) + 19) / 20); break;
        default: dmg = 1; break;
        }
        break;
    case AD_ELEC: if (obj.oclass === WAND_CLASS) dmg = rnd(10); break;
    default: return 0;
    }
    let cnt = 0;
    if (obj.in_use) quan--;
    for (let i = 0; i < quan; i++) if (!rn2(3)) cnt++;   // zap.c per-item roll
    if (!cnt) return 0;
    if (ops.canspotmon(mon))
        await ops.emit(`${ops.Monnam(mon)}'s ${OBJECTS[obj.otyp]?.name || 'item'} is destroyed!`);
    const inv = mon.minvent || [];
    for (let i = 0; i < cnt; i++) {
        const at = inv.indexOf(obj);
        if (at >= 0) {
            if ((obj.quan | 0) > 1) obj.quan -= 1; else inv.splice(at, 1);
        }
    }
    return xresist ? 0 : dmg;
}

// ── mondata.c:305 can_blnd ──────────────────────────────────────────────────
// No RNG, but it decides whether AD_BLND's d(damn,damd) is drawn at all.
export function can_blnd(magr, mdef, aatyp, obj, ops) {
    const pd = ops.permonst(mdef);
    if (!is_hero(mdef) && !haseyes(pd)) return false;
    if (is_hero(mdef) && false) return false;   // hero always has eyes here
    // "a crow will not pluck out the eye of another crow"
    if (magr && !is_hero(magr) && ops.permonst(magr)?.name === 'raven'
        && pd?.name === 'raven') return false;
    switch (aatyp) {
    case AT_EXPL: case AT_BOOM: case AT_GAZE: case AT_MAGC: case AT_BREA:
        if (magr && !is_hero(magr) && magr.mcan) return false;
        return true;                            // !resists_blnd(mdef)
    case AT_WEAP: case AT_SPIT: case AT_NONE:
        // Only a cream pie / blinding venom / potion of blindness blinds here.
        return !!obj && (obj.otyp === CREAM_PIE || obj.otyp === BLINDING_VENOM
                         || obj.otyp === POT_BLINDNESS);
    case AT_ENGL:
        if (!is_hero(mdef) && mdef.msleeping) return false;
        return true;
    case AT_CLAW:
        // e.g. raven: every ublindf, LENSES included, protects the hero.
        if (is_hero(mdef) && (game.u?.ublindf || game.ublindf)) return false;
        return true;
    case AT_TUCH: case AT_STNG:
        if (magr && !is_hero(magr) && magr.mcan) return false;
        return true;
    default:
        return true;
    }
}
const CREAM_PIE = 287, BLINDING_VENOM = 479, POT_BLINDNESS = 300;

// mpoisons_subj() now lives in js/mhitu.js (its C home, mhitu.c:145).  The copy
// that used to be here had three of the five arms: an AT_TUCH poisoner (C says
// "contact") and an AT_GAZE one ("gaze") both came out as "sting", so the top
// line read wrong for every touch/gaze poisoner.

// C ref: mondata.c stagger(ptr, verb) — "stagger"/"stumble"/"slither"/"falter".
function stagger(ptr, verb) {
    if ((mflags1_of(ptr) & 0x6000) === 0x6000) return 'falter';   // M1_NOLIMBS
    if (slithy(ptr)) return 'slither';
    return verb;
}
const makeplural_stagger = (s) => `${s}s`;

// C ref: uhitm.c on_fire(pd, mattk) — the flavour of a fire attack.
function on_fire(ptr, mattk) {
    switch (mattk.aatyp) {
    case AT_TUCH: return 'burned by fire';
    case AT_BITE: return 'burned by fire';
    default: return (ptr?.mcls === S_GOLEM) ? 'on fire' : 'on fire';
    }
}

// C ref: mon.c golemeffects() — flesh/iron golems heal or slow from the
// elemental type instead of taking it.  No RNG.
function golemeffects(mon, damtype, dam, ops) {
    const ptr = ops.permonst(mon);
    let heal = 0;
    if (ptr?.name === 'flesh golem') {
        if (damtype === AD_ELEC) heal = Math.floor((dam + 5) / 6);
    } else if (ptr?.name === 'iron golem') {
        if (damtype === AD_FIRE) heal = dam;
    } else {
        return;
    }
    if (heal) healmon(mon, heal, 0);
}

// ── the damage-type handlers ────────────────────────────────────────────────
// Each is `(magr, mattk, mdef, mhm, ops)` and mutates mhm exactly as C does.

export async function mhitm_ad_rust(magr, mattk, mdef, mhm, ops) {
    const pd = ops.permonst(mdef);
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (magr.mcan) return;
        if (completelyrusts(pd)) return;        // rehumanize(): hero not poly'd
        await erode_armor(mdef, ERODE_RUST, ops);
    } else {
        if (magr.mcan) return;
        if (completelyrusts(pd)) {
            if (ops.vis && ops.canseemon(mdef))
                await ops.emit(`${ops.Monnam(mdef)} falls to pieces!`);
            await ops.monkilled(mdef, AD_RUST);
            mhm.hitflags = M_ATTK_DEF_DIED
                | (ops.grow_up(magr, mdef) ? 0 : M_ATTK_AGR_DIED);
            mhm.done = true;
            return;
        }
        await erode_armor(mdef, ERODE_RUST, ops);
        clear_waitforu(mdef);
        mhm.damage = 0;
    }
}
const ERODE_RUST = 0, ERODE_CORRODE = 2, ERODE_ROT = 3;   // C ref: obj.h

export async function mhitm_ad_corr(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (magr.mcan) return;
        await erode_armor(mdef, ERODE_CORRODE, ops);
    } else {
        if (magr.mcan) return;
        await erode_armor(mdef, ERODE_CORRODE, ops);
        clear_waitforu(mdef);
        mhm.damage = 0;
    }
}

export async function mhitm_ad_dcay(magr, mattk, mdef, mhm, ops) {
    const pd = ops.permonst(mdef);
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (magr.mcan) return;
        if (completelyrots(pd)) return;         // rehumanize(): hero not poly'd
        await erode_armor(mdef, ERODE_ROT, ops);
    } else {
        if (magr.mcan) return;
        if (completelyrots(pd)) {
            if (ops.vis && ops.canseemon(mdef))
                await ops.emit(`${ops.Monnam(mdef)} falls to pieces!`);
            await ops.monkilled(mdef, AD_DCAY);
            mhm.hitflags = M_ATTK_DEF_DIED
                | (ops.grow_up(magr, mdef) ? 0 : M_ATTK_AGR_DIED);
            mhm.done = true;
            return;
        }
        await erode_armor(mdef, ERODE_ROT, ops);
        clear_waitforu(mdef);
        mhm.damage = 0;
    }
}

export async function mhitm_ad_dren(magr, mattk, mdef, mhm, ops) {
    const negated = await mhitm_mgc_atk_negated(magr, mdef, false, ops);
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (!negated && !rn2(4)) {
            // drain_en(mhm.damage): u.uen bookkeeping; the botl Pw row belongs
            // to the caller, so the hero arm stops after the roll.
        }
        mhm.damage = 0;
    } else {
        if (!negated && !rn2(4)) {
            // xdrainenergym(): monsters have no Pw row in this port.
        }
        mhm.damage = 0;
    }
}

export async function mhitm_ad_drli(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        // Drain_resistance is off for every starting role here.
        if (!rn2(3) && !await mhitm_mgc_atk_negated(magr, mdef, true, ops)) {
            // losexp("life drainage") — experience-level loss; the caller owns
            // the hero's Xp row.
            if (ops.losexp) await ops.losexp('life drainage');
        }
        return;
    }
    // mhitm.  mhitm_ad_deth redirects here for Death's touch.
    const is_death = (mattk.adtyp === AD_DETH);
    if (is_death
        || (!rn2(3) && !(resists_drli(ops, mdef) || defended(mdef, AD_DRLI))
            && !await mhitm_mgc_atk_negated(magr, mdef, true, ops))) {
        if (!is_death) mhm.damage = d(2, 6);
        if (ops.vis && ops.canspotmon(mdef))
            await ops.emit(`${ops.Monnam(mdef)} becomes weaker!`);
        const mlev = ops.monLev(mdef);
        if ((mdef.mhpmax | 0) - mhm.damage > mlev) mdef.mhpmax -= mhm.damage;
        else if ((mdef.mhpmax | 0) > mlev) mdef.mhpmax = mlev + 1;
        if (mlev === 0) mhm.damage = mdef.mhp | 0;   // drained past level 0
        else mdef.m_lev = mlev - 1;
    }
}

export async function mhitm_ad_fire(magr, mattk, mdef, mhm, ops) {
    const pd = ops.permonst(mdef);
    const orig_dmg = mhm.damage;
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (!await mhitm_mgc_atk_negated(magr, mdef, true, ops)) {
            await ops.emit(`You're ${on_fire(pd, mattk)}!`);
            // Fire_resistance is off for the covered roles; the hero is never
            // a paper/straw golem, so rehumanize() can't fire.
            if (ops.monLev(magr) > rn2(20)) {
                if (ops.destroy_items_hero)
                    await ops.destroy_items_hero(AD_FIRE, orig_dmg);
            }
            // burn_away_slime(): needs Slimed, never set here.
        } else {
            mhm.damage = 0;
        }
        return;
    }
    if (await mhitm_mgc_atk_negated(magr, mdef, true, ops)) { mhm.damage = 0; return; }
    if (ops.vis && ops.canseemon(mdef))
        await ops.emit(`${ops.Monnam(mdef)} is ${on_fire(pd, mattk)}!`);
    if (completelyburns(pd)) {
        if (ops.vis && ops.canseemon(mdef))
            await ops.emit(`${ops.Monnam(mdef)} burns completely!`);
        await ops.monkilled(mdef, AD_FIRE);
        mhm.hitflags = M_ATTK_DEF_DIED
            | (ops.grow_up(magr, mdef) ? 0 : M_ATTK_AGR_DIED);
        mhm.done = true;
        return;
    }
    if (resists_fire(ops, mdef) || defended(mdef, AD_FIRE)) {
        if (ops.vis && ops.canseemon(mdef))
            await ops.emit(`The fire doesn't seem to burn ${ops.mon_nam(mdef)}!`);
        golemeffects(mdef, AD_FIRE, mhm.damage, ops);
        mhm.damage = 0;
    }
    mhm.damage += await destroy_items_mon(mdef, AD_FIRE, orig_dmg, ops);
    // ignite_items(): oil lamps / potions of oil catching light; no RNG.
}

export async function mhitm_ad_cold(magr, mattk, mdef, mhm, ops) {
    const orig_dmg = mhm.damage;
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (!await mhitm_mgc_atk_negated(magr, mdef, true, ops)) {
            await ops.emit("You're covered in frost!");
            // Cold_resistance is off for the covered roles.
            if (ops.monLev(magr) > rn2(20)) {
                if (ops.destroy_items_hero)
                    await ops.destroy_items_hero(AD_COLD, orig_dmg);
            }
        } else {
            mhm.damage = 0;
        }
        return;
    }
    if (await mhitm_mgc_atk_negated(magr, mdef, true, ops)) { mhm.damage = 0; return; }
    if (ops.vis && ops.canseemon(mdef))
        await ops.emit(`${ops.Monnam(mdef)} is covered in frost!`);
    if (resists_cold(ops, mdef) || defended(mdef, AD_COLD)) {
        if (ops.vis && ops.canseemon(mdef))
            await ops.emit(`The frost doesn't seem to chill ${ops.mon_nam(mdef)}!`);
        golemeffects(mdef, AD_COLD, mhm.damage, ops);
        mhm.damage = 0;
    }
    mhm.damage += await destroy_items_mon(mdef, AD_COLD, orig_dmg, ops);
}

export async function mhitm_ad_elec(magr, mattk, mdef, mhm, ops) {
    const orig_dmg = mhm.damage;
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);           // "The grid bug bites!"
        if (!await mhitm_mgc_atk_negated(magr, mdef, true, ops)) {
            await ops.emit('You get zapped!');
            // Shock_resistance is off for the covered roles.
            if (ops.monLev(magr) > rn2(20)) {
                if (ops.destroy_items_hero)
                    await ops.destroy_items_hero(AD_ELEC, orig_dmg);
            }
        } else {
            mhm.damage = 0;
        }
        return;
    }
    if (await mhitm_mgc_atk_negated(magr, mdef, true, ops)) { mhm.damage = 0; return; }
    if (ops.vis && ops.canseemon(mdef))
        await ops.emit(`${ops.Monnam(mdef)} gets zapped!`);
    if (resists_elec(ops, mdef) || defended(mdef, AD_ELEC)) {
        if (ops.vis && ops.canseemon(mdef))
            await ops.emit(`The zap doesn't shock ${ops.mon_nam(mdef)}!`);
        golemeffects(mdef, AD_ELEC, mhm.damage, ops);
        mhm.damage = 0;
    }
    mhm.damage += await destroy_items_mon(mdef, AD_ELEC, orig_dmg, ops);
}

export async function mhitm_ad_acid(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (!magr.mcan && !rn2(3)) {
            // Acid_resistance is off for the covered roles.
            await ops.emit("You're covered in acid!  It burns!");
        } else {
            mhm.damage = 0;
        }
        return;
    }
    if (magr.mcan) { mhm.damage = 0; return; }
    if (resists_acid(ops, mdef) || defended(mdef, AD_ACID)) {
        if (ops.vis && ops.canseemon(mdef))
            await ops.emit(`${ops.Monnam(mdef)} is covered in acid, but it seems harmless.`);
        mhm.damage = 0;
    } else if (ops.vis && ops.canseemon(mdef)) {
        await ops.emit(`${ops.Monnam(mdef)} is covered in acid!`);
        await ops.emit(`It burns ${ops.mon_nam(mdef)}!`);
    }
    // Both rolls fire regardless of the resistance branch above (uhitm.c:2781).
    if (!rn2(30)) await erode_armor(mdef, ERODE_CORRODE, ops);
    if (!rn2(6)) {
        // acid_damage(MON_WEP(mdef)): erodes the defender's wielded weapon.
        // erode_obj() draws no RNG, so nothing is lost by stopping here.
    }
}

export async function mhitm_ad_sgld(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        // Same-class attacker (a leprechaun mugging a leprechaun-shaped hero)
        // takes nothing.
        if (ops.permonst(mdef)?.mcls === ops.permonst(magr)?.mcls) return;
        if (!magr.mcan && ops.stealgold) await ops.stealgold(magr);
        return;
    }
    mhm.damage = 0;
    if (magr.mcan) return;
    const inv = mdef.minvent || [];
    const gi = inv.findIndex((o) => o.oclass === COIN_CLASS);
    if (gi < 0) return;
    const gold = inv[gi];
    inv.splice(gi, 1);
    (magr.minvent = magr.minvent || []).push(gold);
    clear_waitforu(mdef);
    const buf = ops.Monnam(magr);
    if (ops.vis && ops.canseemon(mdef))
        await ops.emit(`${buf} steals some gold from ${ops.mon_nam(mdef)}.`);
    const { rloc, tele_restrict, RLOC_NOMSG } = await import('./teleport.js');
    if (!await tele_restrict(magr)) {
        const couldspot = ops.canspotmon(magr);
        mhm.hitflags = M_ATTK_AGR_DONE;
        await rloc(magr, RLOC_NOMSG);
        if (ops.vis && couldspot && !ops.canspotmon(magr))
            await ops.emit(`${buf} suddenly disappears!`);
    }
}

export async function mhitm_ad_tlpt(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (await mhitm_mgc_atk_negated(magr, mdef, false, ops)) {
            await ops.emit('You are not affected.');
            return;
        }
        if (game.flags?.verbose !== false)
            await ops.emit('Your position suddenly seems very uncertain!');
        if (ops.tele) await ops.tele();
        // Cap the damage so the teleport can't be posthumously fatal.
        const uhp = game.u?.uhp ?? 0;
        if (mhm.damage >= uhp) {
            mhm.damage = uhp - 1;
            if (mhm.damage < 1) { mhm.damage = 1; if (uhp === 1) game.u.uhp += 1; }
        }
        return;
    }
    const { rloc, tele_restrict, RLOC_NOMSG } = await import('./teleport.js');
    if (magr.mcan || mhm.damage >= (mdef.mhp | 0) || await tele_restrict(mdef)) {
        /* no negation message, and — importantly — no rn2(10) either */
    } else if (await mhitm_mgc_atk_negated(magr, mdef, true, ops)) {
        if (ops.vis) await ops.emit(`${ops.Monnam(mdef)} is not affected.`);
    } else {
        const wasseen = ops.canspotmon(mdef);
        const nam = (ops.vis && wasseen) ? ops.Monnam(mdef) : '';
        clear_waitforu(mdef);
        await rloc(mdef, RLOC_NOMSG);
        if (ops.vis && wasseen && !ops.canspotmon(mdef))
            await ops.emit(`${nam} suddenly disappears!`);
        if (mhm.damage >= (mdef.mhp | 0)) {
            if ((mdef.mhp | 0) === 1) mdef.mhp += 1;
            mhm.damage = (mdef.mhp | 0) - 1;
        }
    }
}

export async function mhitm_ad_blnd(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        if (can_blnd(magr, mdef, mattk.aatyp, null, ops)) {
            if (!ops.Blind || !ops.Blind())
                await ops.emit(`${ops.Monnam(magr)} blinds you!`);
            if (ops.make_blinded) await ops.make_blinded(mhm.damage);
        }
        mhm.damage = 0;
        return;
    }
    if (can_blnd(magr, mdef, mattk.aatyp, null, ops)) {
        if (ops.vis && mdef.mcansee && ops.canspotmon(mdef))
            await ops.emit(`${ops.Monnam(mdef)} is blinded.`);
        // The d() is INSIDE the can_blnd gate — C rolls the blindness duration
        // only for a target it can actually blind.
        let rnd_tmp = d(mattk.damn | 0, mattk.damd | 0);
        rnd_tmp += (mdef.mblinded | 0);
        if (rnd_tmp > 127) rnd_tmp = 127;
        mdef.mblinded = rnd_tmp;
        mdef.mcansee = 0;
        clear_waitforu(mdef);
    }
    mhm.damage = 0;
}

export async function mhitm_ad_curs(magr, mattk, mdef, mhm, ops) {
    const pa = ops.permonst(magr), pd = ops.permonst(mdef);
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (!night() && pa?.name === 'gremlin') return;
        if (!magr.mcan && !rn2(10)) {
            if (!game.u?.Deaf) await ops.emit(`${ops.Monnam(magr)} chuckles.`);
            // mon_give_prop(magr, attrcurse()): the intrinsic-theft table.
        }
        return;
    }
    if (!night() && pa?.name === 'gremlin') return;
    if (!magr.mcan && !rn2(10)) {
        mdef.mcan = 1;
        clear_waitforu(mdef);
        // were_change() needs the lycanthrope shapeshift table.
        if (pd?.name === 'clay golem') {
            if (ops.vis && ops.canseemon(mdef)) {
                await ops.emit(`Some writing vanishes from ${ops.mon_nam(mdef)}'s head!`);
                await ops.emit(`${ops.Monnam(mdef)} is destroyed!`);
            }
            await ops.mondied(mdef);
            mhm.hitflags = M_ATTK_DEF_DIED
                | (ops.grow_up(magr, mdef) ? 0 : M_ATTK_AGR_DIED);
            mhm.done = true;
            return;
        }
        if (!game.u?.Deaf) {
            if (!ops.vis) await ops.emit('You hear laughter.');
            else if (ops.canseemon(magr)) await ops.emit(`${ops.Monnam(magr)} chuckles.`);
        }
    }
}
// C ref: hacklib.c night() — the recorded sessions all run in daylight; the
// gremlin/AD_CURS arms are the only readers.
function night() {
    const h = game.datetime ? new Date(game.datetime).getHours() : 12;
    return h < 6 || h > 21;
}

// C ref: uhitm.c:3113 mhitm_really_poison() — shared by AD_DRST and by
// AD_PHYS's poisoned-weapon arm; not subject to cancellation or the 1/8 roll.
async function mhitm_really_poison(magr, mattk, mdef, mhm, ops) {
    if (ops.vis && ops.canspotmon(magr))
        await ops.emit(`${ops.Monnam(magr)}'s ${mpoisons_subj(magr, mattk)} was poisoned!`);
    if (resists_poison(ops, mdef)) {
        if (ops.vis && ops.canspotmon(mdef) && ops.canspotmon(magr))
            await ops.emit(`The poison doesn't seem to affect ${ops.mon_nam(mdef)}.`);
    } else {
        mhm.damage += rn1(10, 6);
        if (mhm.damage >= (mdef.mhp | 0) && ops.vis && ops.canspotmon(mdef))
            await ops.emit('The poison was deadly...');
    }
}

export async function mhitm_ad_drst(magr, mattk, mdef, mhm, ops) {
    // The negation roll is computed at function entry in C, so it fires even
    // when the 1/8 poison check below is going to decline.
    const negated = await mhitm_mgc_atk_negated(magr, mdef, false, ops);
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);          // "The cobra bites!"
        if (!negated && !rn2(8)) {
            // poisoned(buf, A_STR/A_DEX/A_CON, ..., 30, FALSE) — the attribute
            // loss + losehp; the caller owns the hero's attribute rows.
            if (ops.poisoned) {
                const ptmp = (mattk.adtyp === AD_DRDX) ? 1
                    : (mattk.adtyp === AD_DRCO) ? 2 : 0;   // A_STR/A_DEX/A_CON
                await ops.poisoned(magr, mattk, ptmp);
            }
        }
        return;
    }
    if (!negated && !rn2(8))
        await mhitm_really_poison(magr, mattk, mdef, mhm, ops);
}

export async function mhitm_ad_drin(magr, mattk, mdef, mhm, ops) {
    const pd = ops.permonst(mdef);
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (!has_head(pd)) {
            await ops.emit("You don't seem harmed.");
            if (ops.set_skipdrin) ops.set_skipdrin();
            return;
        }
        // uhitm.c:3232 — a greased/oilskin HELMET (AD_DRIN redirects
        // u_slip_free to uarmh) makes the tentacles slide off; the call was
        // missing, so a greased cap lost its rn2(3)/rn2(2) draws.
        if (await u_slip_free(magr, mattk)) return;
        if (game.uarmh && rn2(8)) return;       // helmet blocks
        // eat_brains() + adjattrib(A_INT) + the two rn2(5) spell/skill losses
        // need the hero attribute machinery.
        return;
    }
    if (!has_head(pd)) {
        if (ops.vis && ops.canspotmon(mdef))
            await ops.emit(`${ops.Monnam(mdef)} doesn't seem harmed.`);
        mhm.damage = 0;
        // gs.skipdrin: affects mattackm()'s attack loop (mhitm.c:387).
        if (ops.set_skipdrin) ops.set_skipdrin();
        return;
    }
    if (((mdef.misc_worn_check | 0) & W_ARMH) && rn2(8)) {
        if (ops.vis && ops.canspotmon(magr) && ops.canseemon(mdef))
            await ops.emit(`${ops.Monnam(mdef)}'s helmet blocks ${ops.mon_nam(magr)}'s attack to its head.`);
        return;
    }
    // eat_brains(): the mind-flayer INT drain + its own kill tail.
}

export async function mhitm_ad_stck(magr, mattk, mdef, mhm, ops) {
    // The rn2(10) precedes hitmsg() here (unlike AD_ELEC, where it follows).
    const negated = await mhitm_mgc_atk_negated(magr, mdef, false, ops);
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        const u = game.u;
        // sticks(youmonst.data) is FALSE for every playable role's base form.
        if (!negated && !u.ustuck) {
            u.ustuck = magr;
            game.disp_botl = true;
        }
        return;
    }
    if (negated) mhm.damage = 0;
}

export async function mhitm_ad_wrap(magr, mattk, mdef, mhm, ops) {
    const pa = ops.permonst(magr);
    const coil = slithy(pa) && (pa?.mcls === S_SNAKE || pa?.mcls === S_NAGA);
    if (is_hero(mdef)) {
        const u = game.u;
        // C ref uhitm.c:3377 — `(!magr->mcan || u.ustuck == magr) && !sticks(pd)`.
        // sticks() is FALSE for every playable role's base form.
        if (!magr.mcan || u.ustuck === magr) {
            if (!u.ustuck && !rn2(10)) {
                // uhitm.c:3380 — greased/oilskin body armour lets the coil slip
                // off; u_slip_free() DRAWS for a cursed or greased piece, and
                // this call was missing entirely.
                if (await u_slip_free(magr, mattk)) {
                    mhm.damage = 0;
                } else {
                    u.ustuck = magr;            // set_ustuck before the message
                    game.disp_botl = true;
                    await ops.emit(`${ops.Monnam(magr)} ${coil ? 'coils' : 'swings'} itself around you!`);
                }
            } else if (u.ustuck === magr) {
                // The drowning arm needs a pool under the attacker.
                if (mattk.aatyp === AT_HUGS) await ops.emit('You are being crushed.');
            } else {
                mhm.damage = 0;
                if (game.flags?.verbose !== false)
                    await ops.emit(coil
                        ? `${ops.Monnam(magr)} brushes against you.`
                        : `${ops.Monnam(magr)} brushes against your leg.`);
            }
        } else {
            mhm.damage = 0;
        }
        return;
    }
    if (magr.mcan) mhm.damage = 0;
    if (!mhm.damage && (ops.canseemon(magr) || ops.canseemon(mdef)))
        await ops.emit(`${ops.Monnam_vis(magr)} brushes against ${ops.mon_nam_vis(mdef)}.`);
}

export async function mhitm_ad_plys(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if ((game.multi ?? 0) >= 0 && !rn2(3)
            && !await mhitm_mgc_atk_negated(magr, mdef, true, ops)) {
            // Free_action is off for the covered roles.
            await ops.emit(`You are frozen by ${ops.mon_nam(magr)}!`);
            if (ops.nomul) await ops.nomul(-rnd(10));
        }
        return;
    }
    if (mdef.mcanmove && !rn2(3)
        && !await mhitm_mgc_atk_negated(magr, mdef, true, ops)) {
        if (ops.vis && ops.canspotmon(mdef))
            await ops.emit(`${ops.Monnam(mdef)} is frozen by ${ops.mon_nam(magr)}.`);
        paralyze_monst(mdef, rnd(10));
    }
    void mhm;
}
// C ref: mon.c paralyze_monst(mon, amt) — no RNG of its own.
function paralyze_monst(mon, amt) {
    mon.mcanmove = 0;
    mon.mfrozen = Math.min(amt | 0, 127);
}

export async function mhitm_ad_slee(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if ((game.multi ?? 0) >= 0 && !rn2(5)
            && !await mhitm_mgc_atk_negated(magr, mdef, true, ops)) {
            // Sleep_resistance is off for the covered roles.
            if (ops.fall_asleep) await ops.fall_asleep(-rnd(10));
            await ops.emit(`You are put to sleep by ${ops.mon_nam(magr)}!`);
        }
        return;
    }
    // C really does call sleep_monst() TWICE here (uhitm.c:3510); each call
    // draws its own rnd(10) argument, so both must fire.
    const { sleep_monst } = await import('./zap.js');
    if (!mdef.msleeping && await sleep_monst(mdef, rnd(10), -1)
        && await sleep_monst(mdef, rnd(10), -1)) {
        if (ops.vis && ops.canspotmon(mdef))
            await ops.emit(`${ops.Monnam(mdef)} is put to sleep by ${ops.mon_nam(magr)}.`);
        clear_waitforu(mdef);
    }
    void mhm;
}

export async function mhitm_ad_slim(magr, mattk, mdef, mhm, ops) {
    const negated = await mhitm_mgc_atk_negated(magr, mdef, false, ops);
    const pd = ops.permonst(mdef);
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (negated) { if (!magr.mcan) await ops.emit('You escape harm.'); return; }
        // Unchanging / already-Slimed arms need the Slimed timer.
        await ops.emit("You don't feel very well.");
        return;
    }
    if (negated) return;                        // physical damage only
    if (!rn2(4) && !slimeproof(pd)) {
        // munslime()/newcham(PM_GREEN_SLIME): the shapechange machinery.
        mhm.damage = 0;
    }
}

export async function mhitm_ad_ench(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        // NOTE the order: C computes `negated` BEFORE hitmsg() in this arm.
        const negated = await mhitm_mgc_atk_negated(magr, mdef, false, ops);
        await ops.hitmsg(magr, mattk);
        if (!negated) {
            // some_armor(hero); when the hero wears none, C picks a ring /
            // amulet / blindfold slot with rn2(5) — the roll fires either way
            // only when there is no armor, so it is gated on that.
            const armored = (game.invent || []).some((o) => (o.owornmask || 0) & W_ARMOR);
            if (!armored) rn2(5);
            // drain_item(): the enchantment decrement.
        }
        return;
    }
    // mhitm: "there's no msomearmor() function, so just do damage".
    void mhm;
}

export async function mhitm_ad_slow(magr, mattk, mdef, mhm, ops) {
    // C computes negated FIRST, then returns for a defended target — so the
    // rn2(10) fires even when the return happens.
    const negated = await mhitm_mgc_atk_negated(magr, mdef, false, ops);
    if (defended(mdef, AD_SLOW)) return;
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (!negated && game.u?.HFast && !rn2(4)) await u_slow_down();
        return;
    }
    if (!negated && mdef.mspeed !== MSLOW) {
        const { mon_adjust_speed } = await import('./muse.js');
        const oldspeed = mdef.mspeed;
        await mon_adjust_speed(mdef, -1, null);
        clear_waitforu(mdef);
        if (mdef.mspeed !== oldspeed && ops.vis && ops.canspotmon(mdef))
            await ops.emit(`${ops.Monnam(mdef)} slows down.`);
    }
    void mhm;
}
const MSLOW = 2;                                // C ref: monst.h

export async function mhitm_ad_conf(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (!magr.mcan && !rn2(4) && !magr.mspec_used) {
            magr.mspec_used = (magr.mspec_used | 0) + (mhm.damage + rn2(6));
            await ops.emit('You are getting confused.');
            if (ops.make_confused) await ops.make_confused(mhm.damage);
        }
        mhm.damage = 0;
        return;
    }
    if (!magr.mcan && !mdef.mconf && !magr.mspec_used) {
        if (ops.vis && ops.canseemon(mdef))
            await ops.emit(`${ops.Monnam(mdef)} looks confused.`);
        mdef.mconf = 1;
        clear_waitforu(mdef);
    }
}

export async function mhitm_ad_poly(magr, mattk, mdef, mhm, ops) {
    // `negated` is a || whose LEFT side is the roll, so the rn2(10) always
    // fires even for a monster that has already used its special.
    const negated = (await mhitm_mgc_atk_negated(magr, mdef, false, ops))
        || !!magr.mspec_used;
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (mhm.damage < (game.u?.uhp ?? 0) && !negated) {
            // mon_poly(): the hero polymorph; needs polyself().
        }
        return;
    }
    if (mhm.damage < (mdef.mhp | 0) && !negated) {
        // mon_poly(magr, mdef, damage) -> newcham(); the shapechange machinery
        // is not carried, so stop here rather than invent its rolls.
    }
}

export async function mhitm_ad_famn(magr, mattk, mdef, mhm, ops) {
    const pd = ops.permonst(mdef);
    if (is_hero(mdef)) {
        await ops.emit(`${ops.Monnam(magr)} reaches out, and your body shrivels.`);
        if (ops.morehungry) await ops.morehungry(rn1(40, 40));
        return;
    }
    if (!(carnivorous(pd) || herbivorous(pd) || metallivorous(pd)))
        mhm.damage = 0;
    void mattk;
}

export async function mhitm_ad_pest(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        await ops.emit(`${ops.Monnam(magr)} reaches out, and you feel fever and chills.`);
        // uhitm.c:3824 — the return value is discarded here (Pestilence's
        // normal damage lands either way), but diseasemu() still draws.
        await diseasemu(ops.permonst(magr));
        return;
    }
    const alt = { ...mattk, adtyp: AD_DISE };
    await mhitm_ad_dise(magr, alt, mdef, mhm, ops);
}

export async function mhitm_ad_deth(magr, mattk, mdef, mhm, ops) {
    const pd = ops.permonst(mdef);
    if (is_hero(mdef)) {
        await ops.emit(`${ops.Monnam(magr)} reaches out with its deadly touch.`);
        // The hero is never undead here, so the rn2(20) below always fires.
        switch (rn2(20)) {
        case 19: case 18: case 17:
            // touch_of_death() (no Antimagic on the covered roles).
            mhm.damage = 0;
            return;
        case 4: case 3: case 2: case 1: case 0:
            await ops.emit("Lucky for you, it didn't work!");
            mhm.damage = 0;
            return;
        default:
            await ops.emit('You feel your life force draining away...');
            mhm.permdmg = 1;
            return;
        }
    }
    if (is_undead(pd) && mhm.damage > 1)
        mhm.damage = rnd(Math.floor(mhm.damage / 2));
    await mhitm_ad_drli(magr, mattk, mdef, mhm, ops);
}

export async function mhitm_ad_halu(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) { mhm.damage = 0; return; }
    const pd = ops.permonst(mdef);
    if (!magr.mcan && haseyes(pd) && mdef.mcansee) {
        if (ops.vis && ops.canseemon(mdef))
            await ops.emit(`${ops.Monnam(mdef)} looks ${mdef.mconf ? 'more ' : ''}confused.`);
        mdef.mconf = 1;
        clear_waitforu(mdef);
    }
    mhm.damage = 0;
    void mattk;
}

// C ref: uhitm.c:3944 do_stone_mon() — the shared petrification tail.
export async function do_stone_mon(magr, mattk, mdef, mhm, ops) {
    const pd = ops.permonst(mdef);
    const { munstone } = await import('./muse.js');
    if (await munstone(mdef, false)) {           // ate a stone-curing corpse
        mhm.hitflags = M_ATTK_DEF_DIED
            | (ops.grow_up(magr, mdef) ? 0 : M_ATTK_AGR_DIED);
        mhm.done = true;
        return;
    }
    if (poly_when_stoned(pd)) {
        // mon_to_stone(): flesh/clay golem becomes a stone golem.
        mhm.damage = 0;
        return;
    }
    if (!resists_ston(ops, mdef)) {
        if (ops.vis && ops.canseemon(mdef))
            await ops.emit(`${ops.Monnam(mdef)} turns to stone!`);
        // monstone() leaves a STATUE, so it must NOT run mondied()'s
        // corpse_chance() rn2 — that would be an invented draw.
        await (ops.monstone ? ops.monstone(mdef) : ops.mondied(mdef));
        mhm.hitflags = M_ATTK_DEF_DIED
            | (ops.grow_up(magr, mdef) ? 0 : M_ATTK_AGR_DIED);
        mhm.done = true;
        return;
    }
    mhm.damage = (mattk.adtyp === AD_STON) ? 0 : 1;
}

export async function mhitm_ad_phys(magr, mattk, mdef, mhm, ops) {
    const pa = ops.permonst(magr), pd = ops.permonst(mdef);
    if (is_hero(mdef)) {
        if (mattk.aatyp === AT_HUGS) {
            const u = game.u;
            if (!u.ustuck && rn2(2)) {
                u.ustuck = magr;
                await ops.emit(`${ops.Monnam(magr)} grabs you!`);
                mhm.hitflags |= M_ATTK_HIT;
            } else if (u.ustuck === magr) {
                await ops.emit(`You are being ${pa?.name === 'rope golem' ? 'choked' : 'crushed'}.`);
            }
            return;
        }
        const otmp = (mattk.aatyp === AT_WEAP) ? ops.MON_WEP(magr) : null;
        if (otmp) {
            mhm.damage += dmgval(otmp, game.youmonst || game.u);
            // GAUNTLETS_OF_POWER rn1(4,3): no recorded monster wears them.
            if (mhm.damage <= 0) mhm.damage = 1;
            await ops.hitmsg(magr, mattk);
            mhm.hitflags |= M_ATTK_HIT;
        } else if (mattk.aatyp !== AT_TUCH || mhm.damage !== 0
                   || magr !== game.u?.ustuck) {
            await ops.hitmsg(magr, mattk);
            mhm.hitflags |= M_ATTK_HIT;
        }
        return;
    }
    // mhitm
    let mwep = ops.MON_WEP(magr);
    if (mattk.aatyp !== AT_WEAP && mattk.aatyp !== AT_CLAW) mwep = null;
    // shade_miss(): no shade reaches mon-vs-mon melee in this port.
    if (mattk.aatyp === AT_KICK && thick_skinned(pd)) {
        mhm.damage = 0;
    } else if (mwep) {
        if (mwep.otyp === CORPSE_OTYP && mwep.corpsenm != null
            && touch_petrifies(monster_by_pmidx(mwep.corpsenm))) {
            await do_stone_mon(magr, mattk, mdef, mhm, ops);
            if (mhm.done) return;
        }
        mhm.damage += dmgval(mwep, { data: pd });
        // GAUNTLETS_OF_POWER rn1(4,3) / artifact_hit(): no monster here has them.
        if (mhm.damage < 1) mhm.damage = 1;
        // rustm(): erodes the defender's armor; no RNG.
        if ((mwep.opoisoned || permapoisoned(mwep)) && !rn2(4))
            await mhitm_really_poison(magr, mattk, mdef, mhm, ops);
    } else if (pa?.name === 'purple worm' && pd?.name === 'shrieker') {
        // Keep the shrieker alive so the follow-up engulf can swallow it.
        if (mhm.damage >= (mdef.mhp | 0) && (mdef.mhp | 0) > 1)
            mhm.damage = (mdef.mhp | 0) - 1;
    }
}
const CORPSE_OTYP = 265;   // js/mkobj.js objects[] index
// C ref: obj.h permapoisoned(obj) — permanently poisoned weapons (none here).
const permapoisoned = (_obj) => false;

export async function mhitm_ad_ston(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (!rn2(3)) {
            if (magr.mcan) {
                await ops.emit(`You hear a cough from ${ops.mon_nam(magr)}!`);
            } else {
                await ops.emit(`You hear ${ops.mon_nam(magr)}'s hissing!`);
                if (!rn2(10) || game.flags?.moonphase === NEW_MOON) {
                    if (ops.do_stone_u && await ops.do_stone_u(magr)) {
                        mhm.hitflags = M_ATTK_HIT;
                        mhm.done = true;
                        return;
                    }
                }
            }
        }
        return;
    }
    if (magr.mcan) return;
    await do_stone_mon(magr, mattk, mdef, mhm, ops);
}
const NEW_MOON = 0;

export async function mhitm_ad_were(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (!rn2(4) && (game.u?.ulycn ?? -1) === -1
            && !await mhitm_mgc_atk_negated(magr, mdef, true, ops)) {
            await ops.emit('You feel feverish.');
            if (ops.set_ulycn) await ops.set_ulycn(ops.permonst(magr));
        }
        return;
    }
    await mhitm_ad_phys(magr, mattk, mdef, mhm, ops);
}

export async function mhitm_ad_heal(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        const pd = ops.permonst(mdef);
        if (magr.mcan) { await ops.hitmsg(magr, mattk); return; }
        // The nurse only heals a hero carrying no weapon and wearing no armor.
        if (ops.nurse_undressed && ops.nurse_undressed()) {
            await ops.emit(`${ops.Monnam(magr)} hits!  (I hope you don't mind.)`);
            const u = game.u;
            u.uhp = (u.uhp | 0) + rnd(7);
            if (!rn2(7)) {
                if ((u.uhpmax | 0) < 5 * (u.ulevel | 0) + d(2 * (u.ulevel | 0), 10))
                    u.uhpmax = (u.uhpmax | 0) + 1;
                if (!rn2(13)) {
                    if (ops.mongone) await ops.mongone(magr);
                    mhm.done = true;
                    mhm.hitflags = M_ATTK_DEF_DIED;
                    return;
                }
            }
            if (u.uhp > u.uhpmax) u.uhp = u.uhpmax;
            if (!rn2(3)) { /* exercise(A_STR) */ }
            if (!rn2(3)) { /* exercise(A_CON) */ }
            game.disp_botl = true;
            if (!rn2(33)) {
                const { rloc, tele_restrict, RLOC_MSG } = await import('./teleport.js');
                if (!await tele_restrict(magr)) await rloc(magr, RLOC_MSG);
                if (ops.monflee) await ops.monflee(magr, d(3, 6));
                mhm.done = true;
                mhm.hitflags = M_ATTK_HIT | M_ATTK_DEF_DIED;
                return;
            }
            mhm.damage = 0;
        } else {
            await ops.hitmsg(magr, mattk);
        }
        void pd;
        return;
    }
    await mhitm_ad_phys(magr, mattk, mdef, mhm, ops);
}

export async function mhitm_ad_stun(magr, mattk, mdef, mhm, ops) {
    const pd = ops.permonst(mdef);
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (!magr.mcan && !rn2(4)) {
            if (ops.make_stunned) await ops.make_stunned(mhm.damage);
            mhm.damage = Math.trunc(mhm.damage / 2);
        }
        return;
    }
    if (magr.mcan) return;
    if (ops.canseemon(mdef))
        await ops.emit(`${ops.Monnam(mdef)} ${makeplural_stagger(stagger(pd, 'stagger'))} for a moment.`);
    mdef.mstun = 1;
    await mhitm_ad_phys(magr, mattk, mdef, mhm, ops);
}

export async function mhitm_ad_legs(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        const sideMask = rn2(2) ? RIGHT_SIDE : LEFT_SIDE;
        const side = sideMask === RIGHT_SIDE ? 'right' : 'left';
        const u = game.u;
        if ((u.usteed || u.Levitation || u.Flying)
            && !((mflags1_of(ops.permonst(magr)) & 0x1) !== 0)) {   // M1_FLY
            await ops.emit(`${ops.Monnam(magr)} tries to reach your ${side} leg!`);
            mhm.damage = 0;
        } else if (magr.mcan) {
            await ops.emit(`${ops.Monnam(magr)} nuzzles against your ${side} leg!`);
            mhm.damage = 0;
        } else {
            const uarmf = (game.invent || []).find((o) => (o.owornmask || 0) & W_ARMF);
            if (uarmf) {
                if (rn2(2) && (uarmf.otyp === LOW_BOOTS || uarmf.otyp === IRON_SHOES)) {
                    await ops.emit(`${ops.Monnam(magr)} pricks the exposed part of your ${side} leg!`);
                } else if (!rn2(5)) {
                    await ops.emit(`${ops.Monnam(magr)} pricks through your ${side} boot!`);
                } else {
                    await ops.emit(`${ops.Monnam(magr)} scratches your ${side} boot!`);
                    mhm.damage = 0;
                    return;
                }
            } else {
                await ops.emit(`${ops.Monnam(magr)} pricks your ${side} leg!`);
            }
            if (ops.set_wounded_legs) {
                await ops.set_wounded_legs(sideMask,
                    rnd(60 - (ops.ACURR_DEX ? ops.ACURR_DEX() : 10)));
                // uhitm.c:4444-4445: a successful leg wound weakens both
                // exercise accumulators.  These are RNG-bearing while their
                // accumulators have room, so omitting them desynchronizes the
                // following attack even when the visible wound is correct.
                ops.exercise?.(A_STR, false);
                ops.exercise?.(A_DEX, false);
            }
        }
        return;
    }
    if (magr.mcan) { mhm.damage = 0; return; }
    await mhitm_ad_phys(magr, mattk, mdef, mhm, ops);
}
const LOW_BOOTS = 163, IRON_SHOES = 164;

export async function mhitm_ad_dgst(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) { mhm.damage = 0; return; }
    const pd = ops.permonst(mdef);
    if (pd?.name === 'Death' || pd?.name === 'Famine' || pd?.name === 'Pestilence') {
        if (ops.vis && ops.canseemon(magr))
            await ops.emit(`${ops.Monnam(magr)} vomits violently and drops dead!`);
        await ops.mondied(magr);
        mhm.hitflags = M_ATTK_AGR_DIED;
        mhm.done = true;
        return;
    }
    if (game.flags?.verbose !== false && !game.u?.Deaf)
        await ops.emit('Burrrrp!');
    mhm.damage = mdef.mhp | 0;
    // corpse_chance(mdef, magr, TRUE) and the pet-nutrition mksobj() belong to
    // the caller's kill tail (js/mhitm.js killMonster).
    void mattk;
}

export async function mhitm_ad_samu(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        if (!rn2(20)) {
            // stealamulet(): the quest-artifact / Amulet theft.
        }
        return;
    }
    mhm.damage = 0;
    void ops;
}

export async function mhitm_ad_dise(magr, mattk, mdef, mhm, ops) {
    const pd = ops.permonst(mdef);
    if (is_hero(mdef)) {
        await ops.hitmsg(magr, mattk);
        // uhitm.c:4607 — diseasemu() DRAWS rn1(ACURR(A_CON), 20) whenever the
        // hero isn't already Sick, and zeroes the damage when it declines.
        if (!await diseasemu(ops.permonst(magr))) mhm.damage = 0;
        return;
    }
    if (pd?.mcls === S_FUNGUS || pd?.name === 'ghoul' || defended(mdef, AD_DISE))
        mhm.damage = 0;
    void mattk;
}

export async function mhitm_ad_sedu(magr, mattk, mdef, mhm, ops) {
    if (is_hero(mdef)) {
        if (ops.sedu_hero) { await ops.sedu_hero(magr, mattk, mhm); return; }
        await ops.hitmsg(magr, mattk);
        return;
    }
    if (magr.mcan) return;
    const obj = (mdef.minvent || []).find((o) => !magr.mtame || !o.cursed);
    if (obj) {
        const { doname_invent } = await import('./invent.js');
        // gv.vis is latched by the caller and NOT recomputed after the rloc().
        const vis = ops.vis;
        const couldspot = ops.canspotmon(magr);
        const buf = ops.Monnam(magr);
        const mdefnam = ops.mon_nam(mdef);
        const onam = doname_invent(obj);
        mdef.minvent.splice(mdef.minvent.indexOf(obj), 1);
        (magr.minvent = magr.minvent || []).push(obj);
        if (vis && ops.canseemon(mdef))
            await ops.emit(`${buf} steals ${onam} from ${mdefnam}!`);
        clear_waitforu(mdef);
        // possibly_unwield()/mselftouch(): no covered defender is harmed by
        // its own stolen gear.
        if (ops.permonst(magr)?.mcls === S_NYMPH) {
            const { rloc, tele_restrict, RLOC_NOMSG } = await import('./teleport.js');
            if (!await tele_restrict(magr)) {
                mhm.hitflags = M_ATTK_AGR_DONE;
                await rloc(magr, RLOC_NOMSG);
                if (vis && couldspot && !ops.canspotmon(magr))
                    await ops.emit(`${buf} suddenly disappears!`);
            }
        }
    }
    mhm.damage = 0;
}

export async function mhitm_ad_ssex(magr, mattk, mdef, mhm, ops) {
    // SYSOPT_SEDUCE is on in this build (sys.c:100), so the hero-defender arm
    // would run doseduce(); that needs the whole foocubus dialogue, so fall
    // back to the theft path rather than invent it.
    await mhitm_ad_sedu(magr, mattk, mdef, mhm, ops);
}

// C ref: monst.h STRAT_WAITFORU — cleared on almost every landed mhitm effect.
function clear_waitforu(mdef) {
    if (mdef && !is_hero(mdef)) mdef.mstrategy = (mdef.mstrategy | 0) & ~STRAT_WAITFORU;
}

// ── uhitm.c:4782 mhitm_adtyping ─────────────────────────────────────────────
// C's `default:` arm sets damage to 0 — it is NOT a "deal the base damage and
// print the verb" fallback, which is what both of this port's dispatchers used
// to do.
export async function mhitm_adtyping(magr, mattk, mdef, mhm, ops) {
    switch (mattk.adtyp) {
    case AD_STUN: await mhitm_ad_stun(magr, mattk, mdef, mhm, ops); break;
    case AD_LEGS: await mhitm_ad_legs(magr, mattk, mdef, mhm, ops); break;
    case AD_WERE: await mhitm_ad_were(magr, mattk, mdef, mhm, ops); break;
    case AD_HEAL: await mhitm_ad_heal(magr, mattk, mdef, mhm, ops); break;
    case AD_PHYS: await mhitm_ad_phys(magr, mattk, mdef, mhm, ops); break;
    case AD_FIRE: await mhitm_ad_fire(magr, mattk, mdef, mhm, ops); break;
    case AD_COLD: await mhitm_ad_cold(magr, mattk, mdef, mhm, ops); break;
    case AD_ELEC: await mhitm_ad_elec(magr, mattk, mdef, mhm, ops); break;
    case AD_ACID: await mhitm_ad_acid(magr, mattk, mdef, mhm, ops); break;
    case AD_STON: await mhitm_ad_ston(magr, mattk, mdef, mhm, ops); break;
    case AD_SSEX: await mhitm_ad_ssex(magr, mattk, mdef, mhm, ops); break;
    case AD_SITM:
    case AD_SEDU: await mhitm_ad_sedu(magr, mattk, mdef, mhm, ops); break;
    case AD_SGLD: await mhitm_ad_sgld(magr, mattk, mdef, mhm, ops); break;
    case AD_TLPT: await mhitm_ad_tlpt(magr, mattk, mdef, mhm, ops); break;
    case AD_BLND: await mhitm_ad_blnd(magr, mattk, mdef, mhm, ops); break;
    case AD_CURS: await mhitm_ad_curs(magr, mattk, mdef, mhm, ops); break;
    case AD_DRLI: await mhitm_ad_drli(magr, mattk, mdef, mhm, ops); break;
    case AD_RUST: await mhitm_ad_rust(magr, mattk, mdef, mhm, ops); break;
    case AD_CORR: await mhitm_ad_corr(magr, mattk, mdef, mhm, ops); break;
    case AD_DCAY: await mhitm_ad_dcay(magr, mattk, mdef, mhm, ops); break;
    case AD_DREN: await mhitm_ad_dren(magr, mattk, mdef, mhm, ops); break;
    case AD_DRST:
    case AD_DRDX:
    case AD_DRCO: await mhitm_ad_drst(magr, mattk, mdef, mhm, ops); break;
    case AD_DRIN: await mhitm_ad_drin(magr, mattk, mdef, mhm, ops); break;
    case AD_STCK: await mhitm_ad_stck(magr, mattk, mdef, mhm, ops); break;
    case AD_WRAP: await mhitm_ad_wrap(magr, mattk, mdef, mhm, ops); break;
    case AD_PLYS: await mhitm_ad_plys(magr, mattk, mdef, mhm, ops); break;
    case AD_SLEE: await mhitm_ad_slee(magr, mattk, mdef, mhm, ops); break;
    case AD_SLIM: await mhitm_ad_slim(magr, mattk, mdef, mhm, ops); break;
    case AD_ENCH: await mhitm_ad_ench(magr, mattk, mdef, mhm, ops); break;
    case AD_SLOW: await mhitm_ad_slow(magr, mattk, mdef, mhm, ops); break;
    case AD_CONF: await mhitm_ad_conf(magr, mattk, mdef, mhm, ops); break;
    case AD_POLY: await mhitm_ad_poly(magr, mattk, mdef, mhm, ops); break;
    case AD_DISE: await mhitm_ad_dise(magr, mattk, mdef, mhm, ops); break;
    case AD_SAMU: await mhitm_ad_samu(magr, mattk, mdef, mhm, ops); break;
    case AD_DETH: await mhitm_ad_deth(magr, mattk, mdef, mhm, ops); break;
    case AD_PEST: await mhitm_ad_pest(magr, mattk, mdef, mhm, ops); break;
    case AD_FAMN: await mhitm_ad_famn(magr, mattk, mdef, mhm, ops); break;
    case AD_DGST: await mhitm_ad_dgst(magr, mattk, mdef, mhm, ops); break;
    case AD_HALU: await mhitm_ad_halu(magr, mattk, mdef, mhm, ops); break;
    default:
        mhm.damage = 0;
        break;
    }
}

// Silence the unused-binding lint for the enum members kept for documentation
// parity with include/monattk.h.
void AD_MAGM; void AD_DISN; void AT_NONE; void AT_BUTT; void AT_STNG;
void AT_TENT; void AT_KICK; void AT_SPIT; void AT_ENGL; void AT_BREA;
void S_HUMAN; void S_LICH; void is_animal; void is_undead_flag; void acidic;
void poisonous; void resists_sleep; void MR_DISINT; void DEADMONSTER;
