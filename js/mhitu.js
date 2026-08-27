// mhitu.js — C's src/mhitu.c: a monster attacks the hero, plus the handful of
// helpers mhitu.c owns that mhitm.c / uhitm.c call across the file boundary.
//
// SCOPE / OWNERSHIP.  Three of mhitu.c's routines already had live ports
// elsewhere when this module was written and are NOT duplicated here:
//   mattacku(), hitmu(), missmu()/mswings()/mdamageu()  -> js/monmove.js
// Duplicating them would leave two implementations of the same PRNG-bearing
// control flow free to drift apart.  Everything else in mhitu.c lives here.
//
// The cross-file helpers below are the single source of truth for their
// callers: js/mhitm.js takes getmattk/could_seduce/mtrapped_in_pit from here
// (C: mhitm.c:383/426/85/659) and js/mhitm_ad.js takes magic_negation /
// mpoisons_subj / diseasemu / u_slip_free / u_slow_down (C: uhitm.c:86/3109/
// 3232/3675/3824).  Each replaced a subset copy; see the individual notes.
//
// Import-cycle note: mhitm_ad.js imports from this file and this file imports
// YOUMONST/AD_* back from it.  Every such binding is read INSIDE a function
// body, never at module top level, so neither evaluation order hits a TDZ.

import { game } from './gstate.js';
import { rn2, rnd, rn1, d } from './rng.js';
import {
    NATTK, M_ATTK_MISS, M_ATTK_HIT, M_ATTK_AGR_DIED, M_ATTK_AGR_DONE,
    W_ARMOR, W_AMUL, W_ARMG, TT_PIT, is_pit, BOLT_LIM,
    M_SEEN_NOTHING, M_SEEN_MAGR, M_SEEN_FIRE, M_SEEN_COLD, M_SEEN_SLEEP,
    M_SEEN_DISINT, M_SEEN_ELEC, M_SEEN_POISON, M_SEEN_ACID,
    A_CON, A_CHA, A_DEX, A_STR,
    NO_MINVENT, MM_EDOG, MM_NOMSG,
} from './const.js';
import {
    AT_NONE, AT_CLAW, AT_BITE, AT_KICK, AT_BUTT, AT_TUCH, AT_STNG, AT_HUGS,
    AT_SPIT, AT_ENGL, AT_BREA, AT_EXPL, AT_BOOM, AT_GAZE, AT_TENT,
    AT_WEAP, AT_MAGC,
    AD_PHYS, AD_MAGM, AD_FIRE, AD_COLD, AD_SLEE, AD_DISN, AD_ELEC, AD_DRST,
    AD_ACID, AD_BLND, AD_STUN, AD_SLOW, AD_PLYS, AD_DRLI, AD_DREN, AD_STON,
    AD_STCK, AD_SITM, AD_SEDU, AD_CONF, AD_WRAP, AD_DRIN, AD_DISE, AD_SSEX,
    AD_HALU, AD_PEST, AD_FAMN, AD_ENCH, AD_POLY, AD_DGST,
} from './monattk_data.js';
import {
    mflags1_of, mflags2_of, is_animal, is_neuter_flag, perceives_flag,
    is_demon_flag, is_were_flag, is_human_flag,
    M1_NOEYES, M1_NOLIMBS, M1_THICK_HIDE, M2_MINION,
} from './monflags_data.js';
import { objects as OBJECTS } from './mkobj.js';
import { acurr_eff, exercise } from './attrib.js';
import { newsym, map_invisible, update_topl, canseemon_shared } from './display.js';
import { cansee, couldsee, Blind } from './vision.js';
import { is_home_elemental, monster_by_pmidx, name_to_pmidx,
    enexto_spawn, makemon } from './makemon.js';
import { DEADMONSTER } from './mon.js';
import { t_at } from './mkroom.js';
import { permonst, mattk_list, attk_protection_mm as attk_protection } from './mhitm.js';
import { YOUMONST } from './mhitm_ad.js';

const is_hero = (m) => m === YOUMONST;

// ── hero-state accessors ────────────────────────────────────────────────────
// The port has three different spellings of the invisibility timer in use
// (u.uinvis, uprops.HInvis, uprops.EInvis); read all of them rather than pick
// one and silently answer FALSE for the other two.
function Invis() {
    const u = game.u || {};
    return !!(u.uinvis || u.uprops?.HInvis || u.uprops?.EInvis
              || u.uprops?.Invis);
}
function See_invisible() {
    const u = game.u || {};
    return !!(u.uprops?.See_invisible || u.uprops?.HSee_invisible
              || u.uprops?.ESee_invisible);
}
function Upolyd() { return !!game.u?.Upolyd; }
function Hallucination() { return !!(game.u?.uhallu || game.u?.uprops?.Hallucination); }
function Deaf() { return !!(game.u?.Deaf || (game.u?.uprops?.HDeaf | 0) > 0); }
function Unaware() { return !!(game.u?.usleep || (game.multi | 0) < 0); }
function Verbose() { return game.flags?.verbose !== false; }
// C ref: mondata.h poly_gender() — 2 (neuter) while poly'd into a neuter form.
function poly_gender() {
    const u = game.u || {};
    if (u.Upolyd && u.umonnum != null && is_neuter_flag(u.mondata)) return 2;
    return u.female ? 1 : 0;
}
// C ref: mondata.c gender(mtmp).
function gender(mtmp) {
    return is_neuter_flag(permonst(mtmp)) ? 2 : (mtmp?.female ? 1 : 0);
}
// C ref: gy.youmonst.data — the hero's current permonst record, which for a
// NON-polymorphed hero is still a real mons[] entry (&mons[urole.malenum], the
// '@' record that carries the role's attacks).  js/polyself.js:352 keeps
// u.umonnum pointing at it in both states, so resolve through that; the
// u.mondata / game.youmonst.data spellings are checked first because
// polyself.js writes them on the poly path.
function youmonst_data() {
    const u = game.u || {};
    if (u.mondata) return u.mondata;
    if (game.youmonst?.data) return game.youmonst.data;
    if (u.umonnum != null) {
        if (_yd_cache_idx !== u.umonnum) {
            _yd_cache_idx = u.umonnum;
            _yd_cache = monster_by_pmidx(u.umonnum) || null;
        }
        return _yd_cache;
    }
    return null;
}
let _yd_cache_idx = -1, _yd_cache = null;

async function emitU(msg) { if (msg) await update_topl(msg); }

// ── small mondata.h predicates ──────────────────────────────────────────────
const haseyes = (ptr) => (mflags1_of(ptr) & M1_NOEYES) === 0;
const nolimbs = (ptr) => (mflags1_of(ptr) & M1_NOLIMBS) === M1_NOLIMBS;
const thick_skinned = (ptr) => (mflags1_of(ptr) & M1_THICK_HIDE) !== 0;
const perceives = (ptr) => perceives_flag(ptr);
// The S_* enum from include/sym.h (generated by defsym.h's
// `MONSYM(idx, ...) sym = idx`), which is what permonst.mcls stores.
const S_NYMPH = 14;   // defsym.h:310
const AMULET_OF_GUARDING = 210;   // js/mkobj.js objects[] index
// js/invent.js:192 W_AMUL — the hero-inventory remap, NOT prop.h's value.
const W_AMUL_HERO = 0x00080000;

// C ref: monst.h m_seenres(mon, bit) — this monster has watched the hero
// shrug off that effect and will stop using the matching attack.
function m_seenres(mon, bit) { return ((mon?.seen_resistance | 0) & bit) !== 0; }

// ═══ mhitu.c:145 mpoisons_subj ══════════════════════════════════════════════
// The noun in "<Mon>'s <X> was poisoned!".  js/mhitm_ad.js used to carry a
// three-arm subset (weapon / bite / sting) that answered "sting" for the
// AT_TUCH and AT_GAZE poisoners, and answered "weapon" only via MON_WEP so the
// hero-as-attacker (uwep) direction was unreachable.
export function mpoisons_subj(mtmp, mattk) {
    if (mattk.aatyp === AT_WEAP) {
        const mwep = is_hero(mtmp) ? (game.uwep || game.u?.uwep) : (mtmp?.mw || null);
        return (!mwep || !mwep.opoisoned) ? 'attack' : 'weapon';
    }
    return (mattk.aatyp === AT_TUCH) ? 'contact'
        : (mattk.aatyp === AT_GAZE) ? 'gaze'
            : (mattk.aatyp === AT_BITE) ? 'bite' : 'sting';
}

// ═══ mhitu.c:163 u_slow_down ════════════════════════════════════════════════
export async function u_slow_down() {
    const u = game.u || {};
    const speedBoots = !!(u.uprops?.EFast);
    if (u.uprops) u.uprops.HFast = 0;
    u.HFast = 0;
    await emitU(!speedBoots ? 'You slow down.'
        : 'Your quickness feels less natural.');
    exercise(A_DEX, false);
}

// mswings_verb() (mhitu.c:105) and mswings() (mhitu.c:130) are NOT duplicated
// here: js/monmove.js:5417 already carries both on the live mattacku path, and
// its copy is strictly better because it supplies the strike-mode data this
// port is missing.  objects[] in js/mkobj.js has NO oc_dir column — every
// entry's `dir` field is 0, including the dagger's PIERCE — so a faithful
// `(oc_dir & PIERCE)` test here would answer FALSE for every weapon, print
// "swings" where C prints "thrusts", and silently drop mswings_verb's rn2(2)
// for the two-strike-mode weapons (knife, halberd, fauchard, bill-guisarme,
// lucern hammer, bec de corbin).  monmove.js patches around it with a
// hand-built WEAPON_ODIR table; the real fix is the data column (see report).

// ═══ mhitu.c:1033 diseasemu ═════════════════════════════════════════════════
// DRAWS rn1(ACURR(A_CON), 20) whenever the hero is not already Sick and has no
// sickness resistance — i.e. on nearly every AD_DISE / AD_PEST landing.  The
// js/mhitm_ad.js AD_DISE hero arm used to draw nothing at all here.
export async function diseasemu(mdat) {
    if (Sick_resistance()) {
        await emitU('You feel a slight illness.');
        return false;
    }
    const u = game.u || {};
    const sick = (u.uprops?.Sick | 0) || (u.Sick | 0);
    const xtime = sick ? Math.trunc(sick / 3) + 1 : rn1(acurr_eff(A_CON), 20);
    await make_sick_u(xtime, mdat?.name, true, SICK_NONVOMITABLE);
    return true;
}
const SICK_NONVOMITABLE = 0x02;   // C ref: youprop.h
function Sick_resistance() {
    const u = game.u || {};
    return !!(u.uprops?.Sick_resistance || u.uprops?.Sick_res);
}
// potion.c make_sick() is not exported by js/potion.js; the only RNG it owns is
// the trailing exercise(A_CON, FALSE), which fires whenever Sick ends up set.
async function make_sick_u(xtime, cause, talk, type) {
    const u = game.u || {};
    u.uprops = u.uprops || {};
    const old = u.uprops.Sick | 0;
    if (xtime > 0) {
        if (Sick_resistance()) return;
        if (!old) await emitU('You feel deathly sick.');
        else if (talk)
            await emitU(`You feel ${xtime <= old / 2 ? 'much' : 'even'} worse.`);
        u.uprops.Sick = xtime;
        u.usick_type = (u.usick_type | 0) | type;
        u.sick = true;
        u.usick_cause = cause;
    }
    if (u.uprops.Sick) exercise(A_CON, false);
}

// ═══ mhitu.c:1047 u_slip_free ═══════════════════════════════════════════════
// Greased / oilskin body armour makes a hug or wrap attack slide off.  DRAWS
// rn2(3) when that piece is cursed and rn2(2) for the grease wearing off, so
// an AD_WRAP / AD_STCK handler that skips it loses calls for a greased hero.
export async function u_slip_free(mtmp, mattk) {
    if (mattk.aatyp === AT_ENGL) return false;   // grease doesn't help vs AD_WRAP engulf

    // C: uarmc ? uarmc : uarm, else uarmu; AD_DRIN looks at uarmh instead.
    // Read the port's own slot caches (js/invent.js setworn) rather than
    // rescanning owornmask — the hero chain uses invent.js's REMAPPED W_* bits.
    let obj = game.uarmc || game.uarm;
    if (!obj) obj = game.uarmu;
    if (mattk.adtyp === AD_DRIN) obj = game.uarmh;

    if (obj && (obj.greased || obj.otyp === OILSKIN_CLOAK)
        && (!obj.cursed || rn2(3))) {
        const { Monnam } = await import('./uhitm.js');
        const { xname } = await import('./invent.js');
        await emitU(`${Monnam(mtmp)} ${(mattk.adtyp === AD_WRAP)
            ? 'slips off of' : 'grabs you, but cannot hold onto'} your ${
            obj.greased ? 'greased' : 'slippery'} ${xname(obj)}!`);
        if (obj.greased && !rn2(2)) {
            await emitU('The grease wears off.');
            obj.greased = 0;
        }
        return true;
    }
    return false;
}
const OILSKIN_CLOAK = 142;   // js/mkobj.js objects[] index (verified by name)

// ═══ mhitu.c:1089 magic_negation ════════════════════════════════════════════
// "armor that sufficiently covers the body might be able to block magic".
// Feeds mhitm_mgc_atk_negated()'s `rn2(10) >= 3 * armpro`, so a wrong answer
// flips whole damage arms on and off.  Both directions live here; js/mhitm_ad.js
// used to return 0 for the hero unless the caller injected a hook, and
// js/monmove.js keeps its own hero-only twin (see `deferred`).
export function magic_negation(mon) {
    const is_you = is_hero(mon);
    const ptr = is_you ? null : permonst(mon);
    let mc = 0, via_amul = false;
    // C: extrinsic Protection for the hero; PM_HIGH_CLERIC has it innately.
    // mons[] names the species "high cleric" — "high priest" is only its male
    // pmnames[] variant, so a display-name test misses every one of them.
    let gotprot = is_you ? (EProtection() !== 0) : (ptr?.name === 'high cleric');

    const chain = is_you ? (game.invent || []) : (mon.minvent || []);
    // js/invent.js REMAPS the amulet bit for HERO inventory (0x00080000, which
    // is const.js's W_TOOL); the body-armour bits 0x01..0x40 agree between the
    // two layouts.  Testing const.js's W_AMUL against a hero amulet answers
    // FALSE, so pick the mask by which chain is being walked.
    const AMUL_BIT = is_you ? W_AMUL_HERO : W_AMUL;
    for (const o of chain) {
        const wornmask = o.owornmask || 0;
        if (wornmask & W_ARMOR) {
            const armpro = OBJECTS[o.otyp]?.oc_can | 0;
            if (armpro > mc) mc = armpro;
        } else if (wornmask & AMUL_BIT) {
            via_amul = (o.otyp === AMULET_OF_GUARDING);
        }
        if (is_you || gotprot) continue;
        // C's remaining per-item test is protects(o, worn), over the mask
        // W_ARMOR|W_ACCESSORY (+W_WEP for a weapon or weptool).  It needs the
        // artifact table (W_ART/W_ARTI); no monster in this port carries an
        // artifact, so it can only answer FALSE.
    }

    if (gotprot) {
        mc += via_amul ? 2 : 1;      // multiple sources don't stack
        if (mc > 3) mc = 3;
    } else if (mc < 1) {
        const u = game.u || {};
        if ((is_you && (((u.uprops?.HProtection | 0) && (u.ublessed | 0) > 0)
                        || (u.uspellprot | 0)))
            || (!is_you && (ptr?.name === 'aligned cleric'
                            || (mflags2_of(ptr) & M2_MINION) !== 0)))
            mc = 1;                  // intrinsic Protection is weaker
    }
    return mc;
}
function EProtection() {
    const u = game.u || {};
    return (u.uprops?.EProtection | 0) || (u.EProtection | 0)
        || (game.EProtection | 0);
}

// ═══ mhitu.c:467 mtrapped_in_pit ════════════════════════════════════════════
// TRUE iff that combatant is stuck in a (spiked) pit; an AT_KICK attack is
// skipped outright while it is, so the to-hit roll never happens.  The hero
// arm reads u.utrap/u.utraptype, which the js/mhitm.js copy omitted entirely.
export function mtrapped_in_pit(mtmp) {
    let ttmp = null;
    if (is_hero(mtmp)) {
        const u = game.u || {};
        ttmp = (u.utrap && u.utraptype === TT_PIT) ? t_at(u.ux, u.uy) : null;
    } else {
        ttmp = mtmp?.mtrapped ? t_at(mtmp.mx, mtmp.my) : null;
    }
    return !!ttmp && is_pit(ttmp.ttyp);
}
// ═══ mhitu.c:1934 could_seduce ══════════════════════════════════════════════
// 0 = not a seduction-capable attack, 1 = opposite gender ("seductively"),
// 2 = a nymph whose gender matches the target's ("engagingly").
export function could_seduce(magr, mdef, mattk) {
    // C reads magr->data here, but a js/dog.js pet's .data carries a
    // NON-makemon pmidx, so every pmidx-keyed flag lookup on it answers for the
    // wrong species; resolve through permonst() (mhitm.js) as the rest of the
    // port does.  The test order still matches C: is_animal comes first.
    const pagr = is_hero(magr) ? youmonst_data() : permonst(magr);
    if (is_animal(pagr)) return 0;
    let agrinvis, genagr;
    if (is_hero(magr)) {
        agrinvis = Invis();
        genagr = poly_gender();
    } else {
        agrinvis = !!magr.minvis;
        genagr = gender(magr);
    }
    let defperc, gendef;
    if (is_hero(mdef)) {
        defperc = See_invisible();
        gendef = poly_gender();
    } else {
        defperc = perceives(permonst(mdef));
        gendef = gender(mdef);
    }

    let adtyp = mattk ? mattk.adtyp
        : dmgtype_ptr(pagr, AD_SSEX) ? AD_SSEX
            : dmgtype_ptr(pagr, AD_SEDU) ? AD_SEDU : AD_PHYS;
    // SYSOPT_SEDUCE is on in this build (sys.c:100), so AD_SSEX stands.
    if (adtyp === AD_SSEX && !SYSOPT_SEDUCE) adtyp = AD_SEDU;

    if (agrinvis && !defperc && adtyp === AD_SEDU) return 0;

    // C: `pagr->mlet != S_NYMPH && pagr != &mons[PM_AMOROUS_DEMON]`.
    if ((pagr?.mcls !== S_NYMPH && pagr?.name !== 'amorous demon')
        || (adtyp !== AD_SEDU && adtyp !== AD_SSEX && adtyp !== AD_SITM))
        return 0;

    return (genagr === 1 - gendef) ? 1 : (pagr?.mcls === S_NYMPH) ? 2 : 0;
}
const SYSOPT_SEDUCE = true;   // sysconf ships SEDUCE=1 for the recorded build
function dmgtype_ptr(ptr, adtyp) {
    return (mattk_list({ data: ptr }) || []).some((a) => a[1] === adtyp);
}

// ═══ mhitu.c:310 getmattk ═══════════════════════════════════════════════════
// Pick attack `indx`, possibly substituting for the species' usual one.  No
// branch draws RNG, but several CHANGE damn/damd, so a missing arm moves the
// later d(damn,damd) roll.  Returns a fresh record; `prev_result` is the
// caller's sum[] so far.
//
// The js/mhitm.js copy this replaces was missing (a) the whole
// is_home_elemental double-damage tail — an air/fire/earth/water elemental on
// its own Elemental Plane rolls d(2*damn, damd), which is a DIFFERENT number of
// die rolls — and (b) the AD_DREN rescale against the hero.
export function getmattk(magr, mdef, indx, prev_result) {
    const mptr = is_hero(magr) ? youmonst_data() : permonst(magr);
    const list = is_hero(magr)
        ? (mattk_list({ data: mptr }) || []) : (mattk_list(magr) || []);
    const raw = list[indx];
    const udefend = is_hero(mdef);
    if (!raw) return { aatyp: AT_NONE, adtyp: AD_PHYS, damn: 0, damd: 0 };

    // C keeps `attk` pointed at the read-only mons[] slot until something
    // substitutes; the home-elemental tail below fires ONLY when nothing did.
    const attk = { aatyp: raw[0], adtyp: raw[1], damn: raw[2] | 0, damd: raw[3] | 0 };
    let substituted = false;

    // SYSOPT_SEDUCE is on, so the c_sa_no[] / AD_SSEX->AD_DRLI swap is inert.

    const prevAd = (indx > 0 && list[indx - 1]) ? list[indx - 1][1] : -1;
    if (indx > 0 && prev_result[indx - 1] > M_ATTK_MISS
        && (attk.adtyp === AD_DISE || attk.adtyp === AD_PEST
            || attk.adtyp === AD_FAMN)
        && attk.adtyp === prevAd) {
        attk.adtyp = AD_STUN;
        substituted = true;

    } else if (attk.adtyp === AD_DREN && udefend) {
        // Drain-energy damage scales with the hero's current/max energy.
        const u = game.u || {};
        const ulev = Math.max(u.ulevel | 0, 6);
        substituted = true;
        if ((u.uen | 0) <= 5 * ulev && attk.damn > 1) {
            attk.damn -= 1;
            if ((u.uenmax | 0) <= 2 * ulev && attk.damd > 3) attk.damd -= 3;
        } else if ((u.uen | 0) > 12 * ulev) {
            attk.damn += 1;
            if ((u.uenmax | 0) > 20 * ulev) attk.damd += 3;
        }

    } else if (!is_hero(magr) && magr.mspec_used
               && (attk.aatyp === AT_ENGL || attk.aatyp === AT_HUGS
                   || attk.adtyp === AD_STCK || attk.adtyp === AD_POLY)) {
        const wimpy = (attk.damd === 0);   // lichen, violet fungus
        substituted = true;
        if (attk.adtyp === AD_ACID || attk.adtyp === AD_ELEC
            || attk.adtyp === AD_COLD || attk.adtyp === AD_FIRE) {
            attk.aatyp = AT_TUCH;
        } else {
            attk.aatyp = AT_CLAW;
            attk.adtyp = AD_PHYS;
        }
        attk.damn = 1;
        attk.damd = 6;
        if (wimpy && attk.aatyp === AT_CLAW) {
            attk.aatyp = AT_TUCH;
            attk.damn = attk.damd = 0;
        }

    } else if (indx === 0 && !is_hero(magr) && attk.aatyp === AT_WEAP
               && attk.adtyp !== AD_PHYS
               && !(list[1] && list[1][0] === AT_WEAP && list[1][1] === AD_PHYS)
               && (magr.mcan || weapon_forces_phys(magr))) {
        attk.adtyp = AD_PHYS;
        substituted = true;

    } else if (indx === 0 && attk.aatyp === AT_TUCH && attk.adtyp === AD_COLD
               && (udefend ? Cold_resistance() : resists_cold_mon(mdef))
               && (is_hero(mdef) || permonst(mdef)?.name !== 'shade')) {
        // lich touch vs a cold-resistant target becomes weaker physical damage
        attk.adtyp = AD_PHYS;
        substituted = true;
        attk.damn = Math.trunc((attk.damn + 1) / 2);
        if (attk.damd === 10) attk.damd = 6;
    }

    // C ref mhitu.c:432 — `if (attk != alt_attk_buf && is_home_elemental(mptr))`:
    // an elemental on its home plane does double damage, but ONLY when no
    // substitution above claimed the buffer.
    if (!substituted && mptr && is_home_elemental(mptr)) attk.damn *= 2;

    return attk;
}
// C: `weap && ((weap->otyp == CORPSE && touch_petrifies(...)) ||
//     is_art(weap, ART_STORMBRINGER) || is_art(weap, ART_VORPAL_BLADE))`.
// No monster in this port wields an artifact or a cockatrice corpse; the corpse
// half is checked so a future m_initinv change is picked up automatically.
const CORPSE_OTYP = 265;   // js/mkobj.js objects[] index
function weapon_forces_phys(magr) {
    const weap = magr?.mw;
    if (!weap) return false;
    if (weap.otyp === CORPSE_OTYP) {
        const nm = weap.corpsenm_name;
        return nm === 'cockatrice' || nm === 'chickatrice';
    }
    return false;
}
const MR_COLD = 0x02;
function resists_cold_mon(mdef) {
    return ((permonst(mdef)?.mresists | 0) & MR_COLD) !== 0;
}
function Cold_resistance() {
    const u = game.u || {};
    return !!(u.uprops?.Cold_resistance || u.uprops?.HCold_resistance
              || u.uprops?.ECold_resistance);
}

// ═══ mhitu.c:448 calc_mattacku_vars ═════════════════════════════════════════
// Recomputed at the top of mattacku() and again before each attack after the
// first: a prior attack may have moved the hero.
export function calc_mattacku_vars(mtmp) {
    const u = game.u || {};
    const mux = mtmp.mux ?? mtmp.mx, muy = mtmp.muy ?? mtmp.my;
    const dx = mtmp.mx - u.ux, dy = mtmp.my - u.uy;
    const ranged = (dx * dx + dy * dy) > 3;                 // mdistu(mtmp) > 3
    const range2 = !monnear_xy(mtmp, mux, muy);
    const foundyou = (mux === u.ux && muy === u.uy);
    const youseeit = canseemon_shared(mtmp);
    // do_attack() uses bhitpos to set/clear notonhead; do likewise here.
    game.bhitpos = { x: u.ux, y: u.uy };
    game.notonhead = false;
    return { ranged, range2, foundyou, youseeit };
}
// C ref: mon.c monnear(mon, x, y) — within one king-step; a grid bug can't
// reach a diagonal neighbour.
const PM_GRID_BUG_NAME = 'grid bug';
function monnear_xy(mon, x, y) {
    const dx = mon.mx - x, dy = mon.my - y;
    const distance = dx * dx + dy * dy;
    if (distance === 2 && mon.data?.name === PM_GRID_BUG_NAME) return false;
    return distance < 3;
}

// ═══ mhitu.c:29 hitmsg ══════════════════════════════════════════════════════
// "<The monster> <verb>[ again]!"  The "again" test is on the mattk POINTER
// being exactly one slot past the previous one, so it needs the slot index.
export async function hitmsg(mtmp, mattk) {
    const { Monnam } = await import('./uhitm.js');
    const compat = could_seduce(mtmp, YOUMONST, mattk);
    let Monst_name = Monnam(mtmp);
    if (compat && !mtmp.mcan && !mtmp.mspec_used) {
        await emitU(`${Monst_name} ${!Blind() ? 'smiles at'
            : !Deaf() ? 'talks to' : 'touches'} you ${
            (compat === 2) ? 'engagingly' : 'seductively'}.`);
    } else {
        let verb, punct = '!';
        switch (mattk.aatyp) {
        case AT_BITE: verb = 'bites'; break;
        case AT_KICK:
            if (thick_skinned(youmonst_data())) punct = '.';
            verb = 'kicks';
            break;
        case AT_STNG: verb = 'stings'; break;
        case AT_BUTT: verb = 'butts'; break;
        case AT_TUCH: verb = 'touches you'; break;
        case AT_TENT:
            verb = 'tentacles suck your brain';
            Monst_name = s_suffix(Monst_name);
            break;
        case AT_EXPL: case AT_BOOM: verb = 'explodes'; break;
        default: verb = 'hits'; break;
        }
        const h = game._hitmsg || (game._hitmsg = {});
        const again = (h.mid === mtmp.m_id && h.slot != null
                       && mattk._slot === h.slot + 1
                       && mattk.aatyp === h.aatyp) ? ' again' : '';
        await emitU(`${Monst_name} ${verb}${again}${punct}`);
    }
    const h = game._hitmsg || (game._hitmsg = {});
    h.mid = mtmp.m_id; h.slot = mattk._slot; h.aatyp = mattk.aatyp;
}
const s_suffix = (s) => (/s$/.test(s) ? `${s}'` : `${s}'s`);

// ═══ mhitu.c:85 missmu ══════════════════════════════════════════════════════
// js/monmove.js owns the live copy on the mattacku path; this one exists so the
// gaze/explode/passive routines below can report a miss without reaching into
// that module.  No RNG.
export async function missmu(mtmp, nearmiss, mattk) {
    const h = game._hitmsg || (game._hitmsg = {});
    h.mid = 0; h.slot = null;
    const { Monnam, canspotmon } = await import('./uhitm.js');
    if (!canspotmon(mtmp)) map_invisible(mtmp.mx, mtmp.my);
    if (could_seduce(mtmp, YOUMONST, mattk) && !mtmp.mcan)
        await emitU(`${Monnam(mtmp)} pretends to be friendly.`);
    else
        await emitU(`${Monnam(mtmp)} ${(nearmiss && Verbose()) ? 'just ' : ''}misses!`);
    await (await import('./hack.js')).stop_occupation();
}

// ═══ mhitu.c:176 wildmiss ═══════════════════════════════════════════════════
// The monster swung at the wrong square (it is blind, or the hero is invisible
// / displaced / underwater).  DRAWS rn2(3) to pick the flavour line, but ONLY
// after the verbose and cansee early-outs — so a caller that treats this as
// "no RNG" is right for an unseen attacker and wrong for a seen one.
export async function wildmiss(mtmp, mattk) {
    const unotseen = (!mtmp.mcansee || (Invis() && !perceives(mtmp.data)));
    const unotthere = Displaced() !== 0;
    const usubmerged = Underwater() !== 0;

    if (!unotseen && !unotthere && !usubmerged) return;   // C: impossible()
    if (!Verbose()) return;
    if (!cansee(mtmp.mx, mtmp.my)) return;

    const compat = ((mattk.adtyp === AD_SEDU || mattk.adtyp === AD_SSEX)
        ? could_seduce(mtmp, YOUMONST, mattk) : 0);
    const { Monnam } = await import('./uhitm.js');
    const Monst_name = Monnam(mtmp);

    if (unotseen) {
        const swings = (mattk.aatyp === AT_BITE) ? 'snaps'
            : (mattk.aatyp === AT_KICK) ? 'kicks'
                : (mattk.aatyp === AT_STNG || mattk.aatyp === AT_BUTT
                   || nolimbs(mtmp.data)) ? 'lunges' : 'swings';
        if (compat) {
            await emitU(`${Monst_name} tries to touch you and misses!`);
        } else {
            switch (rn2(3)) {
            case 0: await emitU(`${Monst_name} ${swings} wildly and misses!`); break;
            case 1: await emitU(`${Monst_name} attacks a spot beside you.`); break;
            case 2: await emitU(`${Monst_name} strikes at thin air!`); break;
            default: await emitU(`${Monst_name} ${swings} wildly!`); break;
            }
        }
    } else if (unotthere) {
        if (compat)
            await emitU(`${Monst_name} smiles ${(compat === 2) ? 'engagingly'
                : 'seductively'} at your ${Invis() ? 'invisible ' : ''}displaced image...`);
        else
            await emitU(`${Monst_name} strikes at your ${
                Invis() ? 'invisible ' : ''}displaced image and misses you!`);
    } else if (usubmerged) {
        if (compat)
            await emitU(`${Monst_name} reaches towards your distorted image.`);
        else
            await emitU(`${Monst_name} is fooled by water reflections and misses!`);
    }
}
// C ref: youprop.h Displaced == (HDisplaced || EDisplaced).  EDisplaced comes
// from setworn() on the cloak of displacement (otyp 149); u.uprops.Displaced is
// not a field this port ever writes, so reading it made wildmiss() answer "not
// displaced" for a hero every monmove.js set_apparxy() had already treated as
// displaced, and the "strikes at your displaced image" line went missing.
const CLOAK_OF_DISPLACEMENT_OTYP = 149;
function Displaced() {
    return (game.uarmc?.otyp === CLOAK_OF_DISPLACEMENT_OTYP
            || !!game.u?.uprops?.HDisplaced) ? 1 : 0;
}
function Underwater() { return game.u?.uinwater ? 1 : 0; }

// ═══ mhitu.c:264 expels ═════════════════════════════════════════════════════
// The engulfer lets the hero go.  No RNG of its own; mnexto() and spoteffects()
// both do, which is why the call order matters.
export async function expels(mtmp, mdat, message) {
    game.disp_botl = true;
    if (message) {
        if (digests(mdat)) {
            await emitU('You get regurgitated!');
        } else if (enfolds(mdat)) {
            const { Monnam } = await import('./uhitm.js');
            await emitU(`${Monnam(mtmp)} unfolds and you are released!`);
        } else {
            const { mon_nam } = await import('./uhitm.js');
            const attk = (mattk_list(mtmp) || []).find(
                (a) => a[0] === AT_ENGL);
            let blast = '';
            if (attk) {
                if (is_whirly(mtmp.data)) {
                    if (attk[1] === AD_ELEC) blast = ' in a shower of sparks';
                    else if (attk[1] === AD_COLD) blast = ' in a blast of frost';
                } else {
                    blast = ' with a squelch';
                }
                await emitU(`You get expelled from ${mon_nam(mtmp)}${blast}!`);
            }
        }
    }
    const u = game.u || {};
    // C ref: mon.c:3438 unstuck(mtmp) — set_ustuck(0), then (when the hero was
    // swallowed) move the hero onto the engulfer's square and redraw, then the
    // re-grab cooldown rnd(2) (mon.c:3465).  That rnd(2) was missing entirely.
    const swallowed = u.uswallow;
    u.uswallow = 0;
    u.uswldtim = 0;
    u.ustuck = null;
    if (swallowed) {
        u.ux = mtmp.mx; u.uy = mtmp.my;
        const { docrt } = await import('./display.js');
        await docrt();
    }
    {
        const { unstuck_mspec_used } = await import('./uhitm.js');
        unstuck_mspec_used(mtmp);
    }
    // C ref: mhitu.c:300 mnexto(mtmp, RLOC_NOMSG) — the enexto() ring search
    // DRAWS (collect_coords shuffles rings 1..3), so it belongs in the stream.
    {
        const { mnexto_rloc } = await import('./do.js');
        const { RLOC_NOMSG } = await import('./teleport.js');
        await mnexto_rloc(mtmp, RLOC_NOMSG);
    }
    newsym(u.ux, u.uy);
    if (um_dist(mtmp.mx, mtmp.my, 1))
        await emitU('Brrooaa...  You land hard at some distance.');
    // spoteffects(TRUE): trap/object effects on the hero's square.
    const { spoteffects } = await import('./hack.js');
    if (spoteffects) await spoteffects(true);
}
const digests = (mdat) => (mattk_list({ data: mdat }) || []).some(
    (a) => a[0] === AT_ENGL && a[1] === AD_DGST);
const S_VORTEX = 22;   // defsym.h:320
// C ref: mondata.h:58 is_whirly(ptr) — mlet == S_VORTEX || PM_AIR_ELEMENTAL.
const is_whirly = (mdat) => mdat?.mcls === S_VORTEX
    || mdat?.name === 'air elemental';
const enfolds = (mdat) => mdat?.name === 'trapper' || mdat?.name === 'lurker above';
function um_dist(x, y, n) {
    const u = game.u || {};
    return Math.abs(x - u.ux) > n || Math.abs(y - u.uy) > n;
}

// ═══ mhitu.c:956 summonmu ═══════════════════════════════════════════════════
// A non-cancelled, non-shapechanged demon summons help; a were flips form and
// may call critters.  Every branch is a bare rn2 gate, and the `||` in the
// were->human arm SHORT-CIRCUITS, so Protection_from_shape_changers suppresses
// the rn2(30) entirely.
export async function summonmu(mtmp, youseeit) {
    let mdat = mtmp.data;

    if (is_demon_flag(mdat)) {
        if (mdat.name !== 'Balrog' && mdat.name !== 'amorous demon') {
            if (!rn2(Inhell() ? 10 : 16)) {
                // msummon(mtmp): the demon-summoning subsystem (minion.c).
            }
        }
        return;   // no such thing as a demon were creature
    }

    if (is_were_flag(mdat)) {
        const { Protection_from_shape_changers } = await import('./mon.js');
        const prot = Protection_from_shape_changers();
        const { night } = await import('./calendar.js');
        if (is_human_flag(mdat)) {
            if (!prot && !rn2(5 - (night() ? 2 : 0))) await new_were_u(mtmp);
        } else {
            if (prot || !rn2(30)) await new_were_u(mtmp);
        }
        mdat = mtmp.data;   // form change invalidates the cached value

        if (!rn2(10)) {
            if (youseeit) {
                const { Monnam } = await import('./uhitm.js');
                await emitU(`${Monnam(mtmp)} summons help!`);
            }
            const { total, visible } = await were_summon_u(mdat, youseeit, prot);
            if (youseeit) {
                if (total > 0) {
                    if (visible === 0) await emitU('You feel hemmed in.');
                } else {
                    await emitU('But none comes.');
                }
            }
        }
        return;
    }
}
function Inhell() {
    const dnum = game.u?.uz?.dnum;
    return !!game.dungeons?.[dnum]?.flags?.hellish;
}
// js/mon.js new_were() is module-private; the shape swap itself draws no RNG
// (its trailing monflee rn1(9,2) only fires with context.mon_moving set and a
// scary square adjacent), so a were that changes form here keeps its stream.
async function new_were_u(mtmp) {
    // mon.js owns the complete were.c form swap (message, healing, armor,
    // and the scary-square flee check); call it lazily to avoid a module-init
    // cycle while retaining mhitu.c's async call shape.
    const { new_were_for_mhitu } = await import('./mon.js');
    await new_were_for_mhitu(mtmp);
}

// C ref: were.c:142 were_summon().  A helper is created at a square selected
// by enexto_core around the hero; makemon() then consumes the normal identity,
// HP, gender, inventory, and saddle draws for that species.  The caller passes
// the post-form-change data so the animal and human forms share one table.
async function were_summon_u(mdat, youseeit, blocked) {
    if (blocked) return { total: 0, visible: 0 };
    const pm = mdat?.pmidx;
    // The generated mons table gives the human forms the same display name
    // as their animal counterparts, so use both verified pmidx values.
    const rat = pm === 91 || pm === 261;
    const jackal = pm === 15 || pm === 262;
    const wolf = pm === 21 || pm === 263;
    const names = rat ? ['sewer rat', 'giant rat', 'rabid rat']
        : jackal ? ['jackal', 'coyote', 'fox']
            : wolf ? ['wolf', 'warg', 'winter wolf'] : null;
    let total = 0, visible = 0;
    for (let i = rnd(5); i > 0; i--) {
        if (!names) continue;
        let idx;
        if (rat) idx = rn2(3) ? 0 : (rn2(3) ? 1 : 2);
        else if (jackal) idx = rn2(7) ? 0 : (rn2(3) ? 1 : 2);
        else idx = rn2(5) ? 0 : (rn2(2) ? 1 : 2);
        const ptr = monster_by_pmidx(name_to_pmidx(names[idx]));
        if (!ptr) continue;
        const spot = enexto_spawn(game.u?.ux, game.u?.uy, ptr);
        if (!spot) continue;
        const mon = makemon(ptr, spot.x, spot.y, 0);
        if (!mon) continue;
        // makemon() links the record but does not redraw its square; C's
        // place_monster() path leaves the new helper visible immediately.
        newsym(spot.x, spot.y);
        if (youseeit && canseemon_shared(mon)
            && Math.max(Math.abs(spot.x - (game.u?.ux ?? 0)),
                                 Math.abs(spot.y - (game.u?.uy ?? 0))) <= 1) {
            const article = /^[aeiou]/i.test(ptr.name || '') ? 'An' : 'A';
            await emitU(`${article} ${ptr.name} suddenly appears next to you!`);
        }
        total++;
        if (canseemon_shared(mon)) visible++;
    }
    return { total, visible };
}

// ═══ mhitu.c:1273 gulp_blnd_check ═══════════════════════════════════════════
// Taking a blindfold off inside an AD_BLND engulfer re-fires the blinding.
export async function gulp_blnd_check() {
    const u = game.u || {};
    if (Blind() || !u.uswallow || !u.ustuck) return false;
    const attk = (mattk_list(u.ustuck) || []).find(
        (a) => a[0] === AT_ENGL && a[1] === AD_BLND);
    if (!attk) return false;
    const { can_blnd } = await import('./mhitm_ad.js');
    if (!can_blnd(u.ustuck, YOUMONST, attk[0], null, mhitu_ops())) return false;
    u.uswldtim = (u.uswldtim | 0) + 1;   // compensate for the gulpmu decrement
    await gulpmu(u.ustuck, { aatyp: attk[0], adtyp: attk[1],
        damn: attk[2] | 0, damd: attk[3] | 0 });
    return true;
}

// ═══ mhitu.c:1289 gulpmu ════════════════════════════════════════════════════
// The engulfer swallows the hero, or damages an already-swallowed one.  RNG, in
// order: d(damn,damd) at the top ALWAYS; on the swallow turn either
// rn2(20) (AD_DGST digestion timer) or rnd(m_lev + 5) (everything else); then
// one rn2(2) per AD_ELEC/AD_COLD/AD_FIRE round, and rn2(4) for AD_DREN.
//
// NOT modelled and stopped-at rather than approximated: the actual swallow
// display (vision_recalc(2)/swallowed(1)), the touch_petrifies statue tail, and
// the leash/ball&chain bookkeeping.  Everything RNG-bearing above them is here.
export async function gulpmu(mtmp, mattk) {
    const u = game.u || {};
    let tmp = d(mattk.damn | 0, mattk.damd | 0);
    let physical_damage = false;
    const { Monnam } = await import('./uhitm.js');

    if (!u.uswallow) {
        // engulf_target() / the boulder-in-a-pit guard / failed_grab() all
        // return before any roll; failed_grab needs an unsolid hero.
        // C ref mhitu.c:1310 — the engulfer MOVES ONTO the hero's square
        // (remove_monster(omx,omy); place_monster(mtmp, u.ux, u.uy)); leaving
        // it on its old tile leaves a phantom glyph there for the whole
        // swallow and puts the wrong square under later newsym()s.
        const omx = mtmp.mx, omy = mtmp.my;
        mtmp.mtrapped = 0;               /* no longer on the old trap */
        mtmp.mx = u.ux; mtmp.my = u.uy;
        u.ustuck = mtmp;
        void omx; void omy;
        // C ref mhitu.c:1315 — only the NEW square is newsym()ed; the engulfer's
        // old tile keeps its stale glyph until the next full redraw, which is
        // what the recorded --More-- frame shows (seed0383 step 140 still has
        // the 'v' on row 7).
        newsym(mtmp.mx, mtmp.my);
        await emitU(`${Monnam(mtmp)} ${digests(mtmp.data) ? 'swallows you whole'
            : enfolds(mtmp.data) ? 'folds itself around you' : 'engulfs you'}!`);
        await (await import('./hack.js')).stop_occupation();

        if (u.utrap) {
            await emitU(`You are released from the ${
                u.utraptype === TT_WEB ? 'web' : 'trap'}!`);
            u.utrap = 0;
        }

        // C ref mhitu.c:1374 — display_nhwindow(WIN_MESSAGE, FALSE) flushes the
        // pending "engulfs you!" with its own --More-- BEFORE the map is redrawn
        // as the stomach, so that frame still shows the dungeon (seed0383 step
        // 141).  vision_recalc(2): the hero can't see anything from in there.
        const disp = await import('./display.js');
        await disp.display_nhwindow_message();
        const { vision_recalc } = await import('./vision.js');
        vision_recalc(2);
        u.uswallow = 1;

        let tim_tmp;
        if (mattk.adtyp === AD_DGST) {
            // Good armour and a high Con make digestion slower — and the stay
            // inside longer.  ACURR(A_CON) + 10 - uac + rn2(20), all over m_lev.
            tim_tmp = acurr_eff(A_CON) + 10 - (u.uac | 0) + rn2(20);
            if (tim_tmp < 0) tim_tmp = 0;
            tim_tmp = Math.trunc(tim_tmp / (mtmp.m_lev | 0));
            tim_tmp += 3;
        } else {
            // C ref mhitu.c:1387 — `rnd((int) mtmp->m_lev + 10 / 2)`.  The
            // `10 / 2` is integer division INSIDE the argument, so the modulus
            // is m_lev + 5, not (m_lev + 10) / 2.
            tim_tmp = rnd((mtmp.m_lev | 0) + 5);
        }
        u.uswldtim = (tim_tmp < 2) ? 2 : tim_tmp;
        // C ref mhitu.c:1396 — swallowed(1) redraws the map as the stomach view
        // (cls() first, so the dungeon is gone); snuff_lit() over the whole
        // inventory for a non-flaming engulfer draws nothing.
        await disp.swallowed(1);
    }

    if (mtmp !== u.ustuck) return M_ATTK_MISS;
    if (u.uswldtim > 0) u.uswldtim -= 1;

    switch (mattk.adtyp) {
    case AD_DGST:
        physical_damage = true;
        if (u.uswldtim === 0) {
            await emitU(`${Monnam(mtmp)} totally digests you!`);
            tmp = u.uhp | 0;
        } else {
            await emitU(`${Monnam(mtmp)}${(u.uswldtim === 2) ? ' thoroughly'
                : (u.uswldtim === 1) ? ' utterly' : ''} digests you!`);
            exercise(A_STR, false);
        }
        break;
    case AD_PHYS:
        physical_damage = true;
        if (mtmp.data?.name === 'fog cloud') {
            await emitU('You are laden with moisture and can barely breathe!');
        } else {
            await emitU(`You are ${enfolds(mtmp.data) ? 'being squashed'
                : 'pummeled with debris'}!`);
            exercise(A_STR, false);
        }
        break;
    case AD_ACID:
        await emitU('You are covered in slime!  It burns!');
        exercise(A_STR, false);
        break;
    case AD_BLND: {
        const { can_blnd } = await import('./mhitm_ad.js');
        if (can_blnd(mtmp, YOUMONST, mattk.aatyp, null, mhitu_ops())) {
            if (!Blind()) {
                await emitU("You can't see in here!");
                await make_blinded_u(tmp);
            } else {
                const up = (u.uprops = u.uprops || {});
                up.Blinded = (up.Blinded | 0) + 1;   // blind until disgorged
            }
        }
        tmp = 0;
        break;
    }
    case AD_ELEC:
        if (!mtmp.mcan && rn2(2)) {
            await emitU('The air around you crackles with electricity.');
        } else {
            tmp = 0;
        }
        break;
    case AD_COLD:
        if (!mtmp.mcan && rn2(2)) {
            await emitU('You are freezing to death!');
        } else {
            tmp = 0;
        }
        break;
    case AD_FIRE:
        if (!mtmp.mcan && rn2(2)) {
            await emitU('You are burning to a crisp!');
        } else {
            tmp = 0;
        }
        break;
    case AD_DISE:
        if (!await diseasemu(mtmp.data)) tmp = 0;
        break;
    case AD_DREN:
        // AC magic cancellation doesn't help while engulfed.
        if (!mtmp.mcan && rn2(4)) {
            // drain_en(tmp, FALSE): the Pw drain.
        }
        tmp = 0;
        break;
    default:
        physical_damage = true;
        tmp = 0;
        break;
    }

    if (physical_damage) {
        // Same AC reduction as hitmu.  Note C's `if (tmp < 0) tmp = 1;` —
        // it clamps NEGATIVE damage up to 1, it does not clamp zero.
        if ((u.uac | 0) < 0) tmp -= rnd(-(u.uac | 0));
        if (tmp < 0) tmp = 1;
    }

    game.mswallower = mtmp;                     // match gulpmm()
    await mdamageu(mtmp, tmp);
    game.mswallower = null;
    if (tmp) await (await import('./hack.js')).stop_occupation();

    if (!u.uswallow) {
        /* life-saving has already expelled the hero */
    } else if (!u.uswldtim || (youmonst_data()?.msize | 0) >= MZ_HUGE) {
        await emitU(`You get ${digests(mtmp.data) ? 'regurgitated'
            : enfolds(mtmp.data) ? 'released' : 'expelled'}!`);
        await expels(mtmp, mtmp.data, false);
    }
    return M_ATTK_HIT;
}
const MZ_HUGE = 4;   // C ref: monflag.h:182 (MZ_GIGANTIC is 7, not 5)

// ═══ mhitu.c:1591 explmu ════════════════════════════════════════════════════
// A yellow light / gas spore style attacker detonates next to the hero.
// RNG: d(damn,damd) always; AD_BLND adds rnd(tmp/2) but ONLY when the exploder
// is not visible (C's `||` short-circuits on mon_visible).
export async function explmu(mtmp, mattk, ufound) {
    if (mtmp.mcan) return M_ATTK_MISS;

    let kill_agr = true;
    let tmp = d(mattk.damn | 0, mattk.damd | 0);
    let not_affected = false;   // defended(mtmp, adtyp): no dragon scales here
    const { Monnam, canspotmon } = await import('./uhitm.js');

    if (!ufound) {
        await emitU(`${canseemon_shared(mtmp) ? Monnam(mtmp) : 'It'
            } explodes at a spot in thin air!`);
    } else {
        await hitmsg(mtmp, mattk);
    }

    switch (mattk.adtyp) {
    case AD_COLD: case AD_FIRE: case AD_ELEC: {
        // C ref: mhitu.c:1619 — mon_explodes(mtmp, mattk) rolls its OWN
        // d(damn,damd) on top of the `tmp` above, kills the exploder and runs
        // the whole explode() blast (destroy_items / resist / burnarmor).
        const { mon_explodes } = await import('./explode.js');
        await mon_explodes(mtmp, [mattk.aatyp, mattk.adtyp,
                                  mattk.damn, mattk.damd]);
        if (!DEADMONSTER(mtmp)) kill_agr = false;
        break;
    }
    case AD_BLND:
        not_affected = resists_blnd_u();
        if (ufound && !not_affected) {
            // C ref mhitu.c:1631 — `mon_visible(mtmp) || (rnd(tmp /= 2) > u.ulevel)`.
            // The halving is INSIDE the short-circuited right operand, so a
            // VISIBLE exploder blinds for the full tmp and rolls nothing.
            let blinded = false;
            if (canseemon_shared(mtmp)) blinded = true;
            else { tmp = Math.trunc(tmp / 2); blinded = rnd(tmp) > (game.u?.ulevel | 0); }
            if (blinded) {
                await emitU('You are blinded by a blast of light!');
                await make_blinded_u(tmp);
                if (!Blind()) await emitU('Your vision clears.');
            } else if (Verbose()) {
                await emitU('You get the impression it was not terribly bright.');
            }
        }
        break;
    case AD_HALU:
        not_affected = not_affected || Blind();
        if (ufound && !not_affected) {
            if (!Hallucination())
                await emitU('You are caught in a blast of kaleidoscopic light!');
            // mondead(mtmp) first, so the dying light is never hallucinated.
            kill_agr = false;
            await emitU('You seem unaffected.');
        }
        break;
    default:
        break;
    }
    if (not_affected) {
        await emitU('You seem unaffected by it.');
        // ugolemeffects(adtyp, tmp): the hero is never a golem here.
    }
    void kill_agr;
    void canspotmon;
    // mondead(mtmp) + wake_nearto(mx, my, 49) belong to the caller's kill tail.
    return (!DEADMONSTER(mtmp)) ? M_ATTK_MISS : M_ATTK_AGR_DIED;
}
function resists_blnd_u() {
    const u = game.u || {};
    return !!(u.ublindf || u.uprops?.Blind_telepat);
}
async function make_blinded_u(xtime) {
    const u = game.u || {};
    u.uprops = u.uprops || {};
    u.uprops.Blinded = xtime;
    if (u.blinded != null) u.blinded = xtime;
}

// ═══ mhitu.c:1668 gazemu ════════════════════════════════════════════════════
// A gaze attack.  Every arm's rn2 gate fires from the SAME `mcanseeu &&
// !mspec_used && rn2(5)` shape, so an unmodelled adtyp loses one call per
// gazing monster per turn; the "looks confused/dazzled" tail then draws
// another 1-3.  This is the most frequently skipped RNG in the file.
const GAZE_REACTIONS = ['confused', 'stunned', 'puzzled', 'dazzled',
    'irritated', 'inflamed', 'tired', 'dulled'];
export async function gazemu(mtmp, mattk) {
    let react = -1;
    let cancelled = (mtmp.mcan !== 0 && mtmp.mcan != null && !!mtmp.mcan);
    let already = false;
    const mcanseeu = (canseemon_shared(mtmp) && couldsee(mtmp.mx, mtmp.my)
                      && !!mtmp.mcansee);
    const { Monnam, mon_nam } = await import('./uhitm.js');

    if (m_seenres(mtmp, cvt_adtyp_to_mseenres(mattk.adtyp)))
        return M_ATTK_MISS;

    const is_medusa = (mtmp.data?.name === 'Medusa');
    const reflectable = (Reflecting() && couldsee(mtmp.mx, mtmp.my) && is_medusa);
    // Hallucination usually scrambles the gaze; Unaware never sees it.
    if ((Hallucination() && rn2(4)) || (Unaware() && !reflectable))
        cancelled = true;

    switch (mattk.adtyp) {
    case AD_STON:
        if (cancelled || !mtmp.mcansee) {
            if (!canseemon_shared(mtmp)) break;
            if (Unaware()) { react = is_medusa ? 4 : 2; break; }
            if (is_medusa && Hallucination() && !rn2(3))
                await emitU('Someone seems overdue for a serpent cut.');
            else
                await emitU(`${Monnam(mtmp)} ${(is_medusa && mtmp.mcan && !react)
                    ? "doesn't look all that ugly" : 'gazes ineffectually'}.`);
            break;
        }
        // The reflection / stoning tail needs ureflects(), polymon(PM_STONE_GOLEM)
        // and done(STONING); Medusa is not reachable in the covered dungeon
        // range, so stop before inventing that sequence.
        break;
    case AD_CONF:
        if (mcanseeu && !mtmp.mspec_used && rn2(5)) {
            if (cancelled) {
                react = 0;
                already = !!mtmp.mconf;
            } else {
                const conf = d(3, 4);
                mtmp.mspec_used = (mtmp.mspec_used | 0) + (conf + rn2(6));
                await emitU(!Confusion()
                    ? `${s_suffix(Monnam(mtmp))} gaze confuses you!`
                    : 'You are getting more and more confused.');
                await make_confused_u(HConfusion() + conf);
                await (await import('./hack.js')).stop_occupation();
            }
        }
        break;
    case AD_STUN:
        if (mcanseeu && !mtmp.mspec_used && rn2(5)) {
            if (cancelled) {
                react = 1;
                already = !!mtmp.mstun;
            } else {
                const stun = d(2, 6);
                mtmp.mspec_used = (mtmp.mspec_used | 0) + (stun + rn2(6));
                await emitU(`${Monnam(mtmp)} stares piercingly at you!`);
                await make_stunned_u(HStun() + stun);
                await (await import('./hack.js')).stop_occupation();
            }
        }
        break;
    case AD_BLND:
        if (canseemon_shared(mtmp) && !resists_blnd_u()
            && mdistu(mtmp) <= BOLT_LIM * BOLT_LIM) {
            if (cancelled) {
                react = rn1(2, 2);                    // "puzzled" || "dazzled"
                already = !mtmp.mcansee;
                // Archons gaze every round; don't spam the cancelled message.
                if (mtmp.mcan && mtmp.data?.name === 'Archon' && rn2(5))
                    react = -1;
            } else {
                const blnd = d(mattk.damn | 0, mattk.damd | 0);
                await emitU(`You are blinded by ${s_suffix(mon_nam(mtmp))} radiance!`);
                await make_blinded_u(blnd);
                await (await import('./hack.js')).stop_occupation();
                if (!Blind()) {
                    await emitU('Your vision clears.');
                } else {
                    const oldstun = HStun(), newstun = rnd(3);
                    await make_stunned_u(Math.max(oldstun, newstun));
                }
            }
        }
        break;
    case AD_FIRE:
        if (mcanseeu && !mtmp.mspec_used && rn2(5)) {
            if (cancelled) {
                react = rn1(2, 4);                    // "irritated" || "inflamed"
            } else {
                let dmg = d(2, 6);
                const orig_dmg = dmg, lev = mtmp.m_lev | 0;
                await emitU(`${Monnam(mtmp)} attacks you with a fiery gaze!`);
                await (await import('./hack.js')).stop_occupation();
                if (Fire_resistance()) {
                    await emitU("The fire doesn't feel hot!");
                    d(12, 6);                         // ugolemeffects' damage roll
                    dmg = 0;
                }
                if (lev > rn2(20)) {
                    // burnarmor(&youmonst): the per-slot armour burn walk.
                }
                if (lev > rn2(20)) {
                    // destroy_items(&youmonst, AD_FIRE, orig_dmg) + ignite_items.
                    void orig_dmg;
                }
                if (dmg) await mdamageu(mtmp, dmg);
            }
        }
        break;
    default:
        // PM_BEHOLDER's AD_SLEE / AD_SLOW arms are #ifdef'd out of this build.
        break;
    }
    if (react >= 0) {
        if (Hallucination() && rn2(3)) react = rn2(GAZE_REACTIONS.length);
        const qual = !rn2(3) ? '' : already ? 'quite '
            : (!rn2(2) ? 'a bit ' : 'somewhat ');
        await emitU(`${Monnam(mtmp)} looks ${qual}${GAZE_REACTIONS[react]}.`);
    }
    return M_ATTK_MISS;
}
function mdistu(mtmp) {
    const u = game.u || {};
    const dx = mtmp.mx - u.ux, dy = mtmp.my - u.uy;
    return dx * dx + dy * dy;
}
function Reflecting() { return !!game.u?.uprops?.Reflecting; }
function Confusion() { return (game.u?.uprops?.Confusion | 0) || (game.u?.uconf | 0); }
function HConfusion() { return (game.u?.uprops?.HConfusion | 0) || Confusion(); }
function HStun() { return (game.u?.uprops?.HStun | 0) || (game.u?.ustun | 0); }
function Fire_resistance() {
    const u = game.u || {};
    return !!(u.uprops?.Fire_resistance || u.uprops?.HFire_resistance
              || u.uprops?.EFire_resistance);
}
async function make_confused_u(xtime) {
    const u = game.u || {};
    u.uprops = u.uprops || {};
    u.uprops.HConfusion = xtime;
    u.uconf = xtime;
}
async function make_stunned_u(xtime) {
    const u = game.u || {};
    u.uprops = u.uprops || {};
    u.uprops.HStun = xtime;
    u.ustun = xtime;
}
// C ref: mondata.c:1522 cvt_adtyp_to_mseenres — M_SEEN_NOTHING for every
// damage type the hero has no matching resistance for.
export function cvt_adtyp_to_mseenres(adtyp) {
    switch (adtyp) {
    case AD_MAGM: return M_SEEN_MAGR;
    case AD_FIRE: return M_SEEN_FIRE;
    case AD_COLD: return M_SEEN_COLD;
    case AD_SLEE: return M_SEEN_SLEEP;
    case AD_DISN: return M_SEEN_DISINT;
    case AD_ELEC: return M_SEEN_ELEC;
    case AD_DRST: return M_SEEN_POISON;
    case AD_ACID: return M_SEEN_ACID;
    default: return M_SEEN_NOTHING;
    }
}
const AD_STON_LOCAL = AD_STON;   void AD_STON_LOCAL;

// ═══ mhitu.c:1902 mdamageu ══════════════════════════════════════════════════
// Subtract n HP from the hero.  js/monmove.js and js/uhitm.js each carry their
// own copy (see `deferred`); this one is the complete version — it sets
// disp.botl (the status rows are a SNAPSHOT, so missing this leaves a stale
// HP row) and honours the Upolyd branch.
export async function mdamageu(mtmp, n) {
    if (n < 0) n = 0;
    const u = game.u || {};
    game.disp_botl = true;
    if (Upolyd()) {
        u.mh = (u.mh | 0) - n;
        if (u.mh > u.mhmax) u.mh = u.mhmax;
        if (u.mh < 1) {
            const { rehumanize } = await import('./polyself.js');
            if (rehumanize) await rehumanize();
        }
    } else {
        u.uhp = (u.uhp | 0) - n;
        if (u.uhp > u.uhpmax) u.uhp = u.uhpmax;
        if (u.uhp < 1) {
            const { done_in_by } = await import('./end.js');
            await done_in_by(mtmp, DIED);
        }
    }
}
const DIED = 0;   // C ref: hack.h DIED

// ═══ mhitu.c:2309 mayberem ══════════════════════════════════════════════════
// The seducer talks a piece of armour off the hero.  DRAWS rn2(20) against
// ACURR(A_CHA) to decide between the y/n prompt and the flat "take it off"
// line, and the prompt's pet name costs one or two more rn2(2)s.  The prompt is
// a REAL keystroke read: skipping it would let the answer fall through to
// rhack() and run a phantom turn.
export async function mayberem(mon, seducer, obj, str) {
    if (!obj || !obj.owornmask) return;
    // A previous removal may have dropped the hero through a trap door.
    if (game.u?.utotype || !await m_next2u_u(mon)) return;

    if (Deaf()) {
        await emitU(`${seducer} takes off your ${str}.`);
    } else if (rn2(20) < acurr_eff(A_CHA)) {
        const pet = !rn2(2) ? 'lover' : !rn2(2) ? 'dear' : 'sweetheart';
        const { y_n } = await import('./display.js');
        if (await y_n(`"Shall I remove your ${str}, ${pet}?"`) === 'n') return;
    } else {
        const { xname } = await import('./invent.js');
        void xname;
        await emitU(`Take off your ${str}; ${
            (obj === game.uarm) ? "let's get a little closer"
                : (obj === game.uarmc || obj === game.uarms) ? "it's in the way"
                    : (obj === game.uarmf) ? 'let me rub your feet'
                        : (obj === game.uarmg) ? "they're too clumsy"
                            : (obj === game.uarmu) ? 'let me massage you'
                                : 'let me run my fingers through your hair'}.`);
    }
    // remove_worn_item(obj, TRUE): js/worn.js's slot bookkeeping.
}
// C ref: mon.c m_next2u(mon) — adjacent to the hero.
async function m_next2u_u(mon) {
    const u = game.u || {};
    return Math.abs(mon.mx - u.ux) <= 1 && Math.abs(mon.my - u.uy) <= 1;
}

// ═══ mhitu.c:1985 doseduce ══════════════════════════════════════════════════
// The foocubus encounter.  Returns 1 if the monster teleported (or the hero
// left its vicinity).  RNG, in order: the per-ring rn2(20)-vs-Cha prompt gate,
// each mayberem()'s own rolls, then rn2(35) against min(Cha+Int, 32) to pick
// the outcome family, rn2(5) inside it, the payment rn2(20)/rnd(umoney+10), and
// finally rn2(25) for the monster burning itself out.
export async function doseduce(mon) {
    const u = game.u || {};
    const { Monnam, mon_nam } = await import('./uhitm.js');
    if (mon.mcan || mon.mspec_used) {
        await emitU(`${Monnam(mon)} acts as though ${mhe(mon)} has got a ${
            mon.mcan ? 'severe ' : ''}headache.`);
        return 0;
    }
    if (Unaware()) {
        await emitU(`${Monnam(mon)} seems dismayed at your lack of response.`);
        return 0;
    }
    const seewho = canseemon_shared(mon);
    const fem = (mon.data?.name === 'amorous demon' && gender(mon) === 1);
    if (!seewho) await emitU('Someone caresses you...');
    else await emitU(`You feel very attracted to ${mon_nam(mon)}.`);
    const Who = !seewho ? (fem ? 'She' : 'He') : Monnam(mon);

    // stop_donning(): the multi-turn armour timer, not carried.
    let tried_gloves = 0;
    // welded(uwep): a cursed two-hander pins the gloves on.

    const { y_n } = await import('./display.js');
    const { xname } = await import('./invent.js');
    for (const ring of [...(game.invent || [])]) {
        if (ring.otyp !== RIN_ADORNMENT) continue;
        if (fem) {
            if (ring.owornmask && game.uarmg) {
                if (!tried_gloves++) await mayberem(mon, Who, game.uarmg, 'gloves');
                if (game.uarmg) continue;
            }
            if (!Deaf() && rn2(20) < acurr_eff(A_CHA)) {
                if (await y_n(`"That ${xname(ring)} looks pretty.  May I have it?"`) === 'n')
                    continue;
            } else {
                await emitU(`${Who} decides she'd like your ${xname(ring)}, and takes it.`);
            }
            // freeinv + mpickobj: the ring changes owner.
        } else {
            if (game.uleft && game.uright
                && game.uleft.otyp === RIN_ADORNMENT
                && game.uright.otyp === RIN_ADORNMENT) break;
            if (ring === game.uleft || ring === game.uright) continue;
            if (game.uarmg) {
                if (!tried_gloves++) await mayberem(mon, Who, game.uarmg, 'gloves');
                if (game.uarmg) break;
            }
            if (!Deaf() && rn2(20) < acurr_eff(A_CHA)) {
                if (await y_n(`"That ${xname(ring)} looks pretty.  Would you wear it for me?"`) === 'n')
                    continue;
            } else {
                await emitU(`${Who} decides you'd look prettier wearing your ${xname(ring)},`);
                await emitU('and puts it on your finger.');
            }
            // setworn(RIGHT_RING/LEFT_RING) + Ring_on(): the ring slot machinery.
        }
    }

    const naked = !(game.uarmc || game.uarmf || game.uarmg || game.uarms
                    || game.uarmh || game.uarmu);
    await emitU(`${Who} ${Deaf() ? 'seems to murmur into your ear'
        : naked ? 'murmurs sweet nothings into your ear'
            : 'murmurs in your ear'}${naked ? '' : ', while helping you undress'}.`);
    await mayberem(mon, Who, game.uarmc, 'cloak');
    if (!game.uarmc) await mayberem(mon, Who, game.uarm, 'suit');
    await mayberem(mon, Who, game.uarmf, 'boots');
    if (!tried_gloves) await mayberem(mon, Who, game.uarmg, 'gloves');
    await mayberem(mon, Who, game.uarms, 'shield');
    await mayberem(mon, Who, game.uarmh, 'helmet');
    if (!game.uarmc && !game.uarm) await mayberem(mon, Who, game.uarmu, 'shirt');

    if (u.utotype || !await m_next2u_u(mon)) return 1;

    const { rloc, tele_restrict, RLOC_MSG } = await import('./teleport.js');
    if (game.uarm || game.uarmc) {
        if (!Deaf())
            await emitU(`You're such a ${u.female ? 'sweet lady' : 'nice guy'}; I wish...`);
        else if (seewho)
            await emitU(`${Monnam(mon)} appears to sigh.`);
        if (!await tele_restrict(mon)) await rloc(mon, RLOC_MSG);
        return 1;
    }
    const { adjalign } = await import('./attrib.js');
    if (u.ualign?.type === A_CHAOTIC_L) adjalign(1);

    await emitU(`Time stands still while you and ${mon_nam(mon)} lie in each other's arms...`);
    const attr_tot = acurr_eff(A_CHA) + acurr_eff(A_INT_L);
    if (rn2(35) > Math.min(attr_tot, 32)) {
        await emitU(`${Monnam(mon)} seems to have enjoyed it more than you...`);
        switch (rn2(5)) {
        case 0:
            await emitU('You feel drained of energy.');
            u.uen = 0;
            u.uenmax = (u.uenmax | 0) - rnd(10);   // Half_physical_damage off
            exercise(A_CON, false);
            if (u.uenmax < 0) u.uenmax = 0;
            break;
        case 1:
            await emitU('You are down in the dumps.');
            exercise(A_CON, false);              // adjattrib(A_CON, -1, TRUE)
            game.disp_botl = true;
            break;
        case 2:
            await emitU('Your senses are dulled.');
            exercise(A_WIS_L, false);            // adjattrib(A_WIS, -1, TRUE)
            game.disp_botl = true;
            break;
        case 3: {
            await emitU('You feel out of shape.');
            const { losexp } = await import('./exper.js');
            await losexp('overexertion');
            exercise(A_CON, false);
            exercise(A_DEX, false);
            exercise(A_WIS_L, false);
            break;
        }
        case 4:
            await emitU('You feel exhausted.');
            exercise(A_STR, false);
            await mdamageu(mon, rn1(10, 6));     // losehp(tmp, "exhaustion")
            break;
        }
    } else {
        mon.mspec_used = rnd(100);               // monster is worn out
        await emitU(`You seem to have enjoyed it more than ${mon_nam(mon)}...`);
        switch (rn2(5)) {
        case 0:
            await emitU('You feel raised to your full potential.');
            exercise(A_CON, true);
            u.uenmax = (u.uenmax | 0) + rnd(5);
            u.uen = u.uenmax;
            if (u.uenmax > (u.uenpeak | 0)) u.uenpeak = u.uenmax;
            break;
        case 1:
            await emitU('You feel good enough to do it again.');
            exercise(A_CON, true);               // adjattrib(A_CON, 1, TRUE)
            game.disp_botl = true;
            break;
        case 2:
            await emitU(`You will always remember ${mon_nam(mon)}...`);
            exercise(A_WIS_L, true);             // adjattrib(A_WIS, 1, TRUE)
            game.disp_botl = true;
            break;
        case 3: {
            await emitU('That was a very educational experience.');
            const { pluslvl } = await import('./exper.js');
            await pluslvl(false);
            exercise(A_WIS_L, true);
            break;
        }
        case 4:
            await emitU('You feel restored to health!');
            u.uhp = u.uhpmax;
            if (Upolyd()) u.mh = u.mhmax;
            exercise(A_STR, true);
            game.disp_botl = true;
            break;
        }
    }

    if (mon.mtame) {
        /* don't charge */
    } else if (rn2(20) < acurr_eff(A_CHA)) {
        await emitU(`${Monnam(mon)} demands that you pay ${
            gender(mon) === 1 ? 'her' : 'him'}, but you refuse...`);
    } else if (youmonst_data()?.name === 'leprechaun') {
        await emitU(`${Monnam(mon)} tries to take your gold, but fails...`);
    } else {
        const { money_cnt_invent } = await import('./shk.js');
        const umoney = money_cnt_invent();
        let cost = rnd(umoney + 10) + 500;
        if (mon.mpeaceful) { cost = Math.trunc(cost / 5); if (!cost) cost = 1; }
        if (cost > umoney) cost = umoney;
        if (!cost) await emitU(Deaf() ? 'No charge.' : "It's on the house!");
        else {
            await emitU(`${Monnam(mon)} takes ${cost} gold piece${
                cost === 1 ? '' : 's'} for services rendered!`);
            // money2mon(mon, cost): the gold transfer.
            game.disp_botl = true;
        }
    }
    if (!rn2(25)) mon.mcan = 1;                  // monster is worn out
    if (!await tele_restrict(mon)) await rloc(mon, RLOC_MSG);
    return 1;
}
const RIN_ADORNMENT = 173;   // js/mkobj.js objects[] index (verified by name)
const A_CHAOTIC_L = -1, A_INT_L = 1, A_WIS_L = 2;   // C ref: attrib.h
const mhe = (mon) => (gender(mon) === 1 ? 'she' : gender(mon) === 2 ? 'it' : 'he');

// ═══ mhitu.c:2355 assess_dmg ════════════════════════════════════════════════
export async function assess_dmg(mtmp, tmp) {
    mtmp.mhp = (mtmp.mhp | 0) - tmp;
    if (mtmp.mhp <= 0) {
        const { Monnam, killed } = await import('./uhitm.js');
        await emitU(`${Monnam(mtmp)} dies!`);
        await killed(mtmp, { nomsg: true });
        if (!DEADMONSTER(mtmp)) return M_ATTK_HIT;
        return M_ATTK_AGR_DIED;
    }
    return M_ATTK_HIT;
}

// ═══ mhitu.c:2374/2393/2413 the ranged-attack predicates ════════════════════
// DISTANCE_ATTK_TYPE (monattk.h:31) is SPIT || BREA || MAGC || GAZE.  Dropping
// AT_MAGC — as an existing hand-rolled copy in js/monmove.js does — makes every
// spellcaster read as having no ranged option, which changes dochug's
// approach/flee decision.  get_atkdam_type() also DRAWS rn2(8) for AD_RBRE
// (random-breath dragons), so these predicates are not RNG-free.
const DISTANCE_ATTK_TYPE = (atyp) => atyp === AT_SPIT || atyp === AT_BREA
    || atyp === AT_MAGC || atyp === AT_GAZE;
const AD_RBRE = 242;   // C ref: monattk.h:89
const RND_BREATH_TYP = [AD_MAGM, AD_FIRE, AD_COLD, AD_SLEE,
    AD_DISN, AD_ELEC, AD_DRST, AD_ACID];
export function get_atkdam_type(adtyp) {
    if (adtyp === AD_RBRE) return RND_BREATH_TYP[rn2(RND_BREATH_TYP.length)];
    return adtyp;
}

export function mon_avoiding_this_attack(mtmp, attkidx) {
    const list = mattk_list(mtmp) || [];
    let typ = -1;
    if (attkidx >= 0 && list[attkidx]
        && (typ = get_atkdam_type(list[attkidx][1])) >= 0
        && m_seenres(mtmp, cvt_adtyp_to_mseenres(typ)))
        return true;
    return false;
}

export function ranged_attk_available(mtmp) {
    const list = mattk_list(mtmp) || [];
    for (let i = 0; i < NATTK; i++) {
        const a = list[i];
        if (!a) continue;
        let typ = -1;
        if (DISTANCE_ATTK_TYPE(a[0]) && (typ = get_atkdam_type(a[1])) >= 0
            && m_seenres(mtmp, cvt_adtyp_to_mseenres(typ)) === false)
            return true;
    }
    return false;
}

// C ref: mhitu.c:2374 — `#if 0` upstream, kept because monmove.c's comment
// documents it as the general form of ranged_attk_available().
export function ranged_attk_assessed(mtmp, assessfunc) {
    const list = mattk_list(mtmp) || [];
    for (let i = 0; i < NATTK; i++) {
        const a = list[i];
        if (a && DISTANCE_ATTK_TYPE(a[0])) {
            if (!assessfunc || assessfunc(mtmp, i) === false) return true;
        }
    }
    return false;
}

// ═══ mhitu.c:2435 passiveum ═════════════════════════════════════════════════
// The hero's passive counterattack after a monster lands a hit.  `olduasmon` is
// the hero's form BEFORE the hit (a hit that rehumanizes still fires the old
// form's passive).  ALWAYS draws its damage die when the passive slot carries
// one, and AD_ACID adds three more rolls — js/monmove.js's hitmu() short-cuts
// this to "returns M_ATTK_HIT, no RNG", which is only true for a passive-less
// hero form.
export async function passiveum(olduasmon, mtmp, mattk) {
    const list = mattk_list({ data: olduasmon }) || [];
    let oldu_mattk = null;
    for (let i = 0; !oldu_mattk; i++) {
        if (i >= NATTK) return M_ATTK_HIT;
        const a = list[i];
        // A dropped trailing slot IS an AT_NONE slot (the generator elides
        // them), so a form with fewer than NATTK entries has its passive there.
        if (!a || a[0] === AT_NONE || a[0] === AT_BOOM)
            oldu_mattk = a ? { aatyp: a[0], adtyp: a[1], damn: a[2] | 0, damd: a[3] | 0 }
                : { aatyp: AT_NONE, adtyp: AD_PHYS, damn: 0, damd: 0 };
    }
    let tmp;
    if (oldu_mattk.damn) tmp = d(oldu_mattk.damn, oldu_mattk.damd);
    else if (oldu_mattk.damd) tmp = d((olduasmon?.mlevel | 0) + 1, oldu_mattk.damd);
    else tmp = 0;

    const { Monnam } = await import('./uhitm.js');
    const mres = (bit) => ((permonst(mtmp)?.mresists | 0) & bit) !== 0;
    const MR_FIRE = 0x01, MR_COLD_L = 0x02, MR_ELEC = 0x10, MR_ACID = 0x40,
        MR_STONE = 0x80;

    // These affect the enemy even if the hit rehumanized the hero.
    switch (oldu_mattk.adtyp) {
    case AD_ACID:
        if (!rn2(2)) {
            await emitU(`${Monnam(mtmp)} is splashed by ${
                !Upolyd() ? '' : 'your '}acid!`);
            if (mres(MR_ACID)) {
                await emitU(`${Monnam(mtmp)} is not affected.`);
                tmp = 0;
            }
        } else {
            tmp = 0;
        }
        if (!rn2(30)) { /* erode_armor(mtmp, ERODE_CORRODE) */ }
        if (!rn2(6)) { /* acid_damage(MON_WEP(mtmp)) */ }
        return assess_dmg(mtmp, tmp);
    case AD_STON: {
        const protector = attk_protection(mattk.aatyp);
        let wornitems = mtmp.misc_worn_check | 0;
        if (mtmp.mw) wornitems |= W_ARMG;   // a wielded weapon guards like gloves
        if (!mres(MR_STONE)
            && (protector === 0
                || (protector !== ~0 && (wornitems & protector) !== protector))) {
            await emitU(`${Monnam(mtmp)} turns to stone!`);
            const { killed } = await import('./uhitm.js');
            game.stoned = true;
            await killed(mtmp, { nomsg: true });
            game.stoned = false;
            if (!DEADMONSTER(mtmp)) return M_ATTK_HIT;
            return M_ATTK_AGR_DIED;
        }
        return M_ATTK_HIT;
    }
    case AD_ENCH:
        // drain_item(mon_currwep, TRUE) — no message, no RNG.
        return M_ATTK_HIT;
    default:
        break;
    }
    if (!Upolyd()) return M_ATTK_HIT;

    // These affect the enemy only while the hero is still a monster.
    if (rn2(3)) {
        switch (oldu_mattk.adtyp) {
        case AD_PHYS:
            if (oldu_mattk.aatyp === AT_BOOM) {
                await emitU('You explode!');
                const { rehumanize } = await import('./polyself.js');
                if (rehumanize) await rehumanize();
                return assess_dmg(mtmp, tmp);
            }
            break;
        case AD_PLYS:
            if (tmp > 127) tmp = 127;
            if (youmonst_data()?.name === 'floating eye') {
                if (!rn2(4)) tmp = 127;
                if (mtmp.mcansee && haseyes(mtmp.data) && rn2(3)
                    && (perceives(mtmp.data) || !Invis())) {
                    if (Blind()) {
                        await emitU('As a blind floating eye, you cannot defend yourself.');
                    } else {
                        await emitU(`${Monnam(mtmp)} is frozen by your gaze!`);
                        paralyze_monst_u(mtmp, tmp);
                        return M_ATTK_AGR_DONE;
                    }
                }
            } else {
                await emitU(`${Monnam(mtmp)} is frozen by you.`);
                paralyze_monst_u(mtmp, tmp);
                return M_ATTK_AGR_DONE;
            }
            return M_ATTK_HIT;
        case AD_COLD:
            if (mres(MR_COLD_L)) {
                await emitU(`${Monnam(mtmp)} is mildly chilly.`);
                tmp = 0;
                break;
            }
            await emitU(`${Monnam(mtmp)} is suddenly very cold!`);
            {
                const u = game.u || {};
                u.mh = (u.mh | 0) + Math.trunc((tmp + rn2(2)) / 2);
                if ((u.mhmax | 0) < u.mh) u.mhmax = u.mh;
                // split_mon() when mhmax outgrows the form: the pudding-division
                // clone_mon() machinery is not carried.
            }
            break;
        case AD_STUN:
            if (!mtmp.mstun) {
                mtmp.mstun = 1;
                await emitU(`${Monnam(mtmp)} staggers.`);
            }
            tmp = 0;
            break;
        case AD_FIRE:
            if (mres(MR_FIRE)) {
                await emitU(`${Monnam(mtmp)} is mildly warm.`);
                tmp = 0;
                break;
            }
            await emitU(`${Monnam(mtmp)} is suddenly very hot!`);
            break;
        case AD_ELEC:
            if (mres(MR_ELEC)) {
                await emitU(`${Monnam(mtmp)} is slightly tingled.`);
                tmp = 0;
                break;
            }
            await emitU(`${Monnam(mtmp)} is jolted with your electricity!`);
            break;
        default:
            tmp = 0;
            break;
        }
    } else {
        tmp = 0;
    }
    return assess_dmg(mtmp, tmp);
}
// attk_protection() is mhitm.c:1475 — imported from js/mhitm.js rather than
// duplicated (a second copy here dropped AT_BREA from the "no contact at all"
// arm, which would have stoned every breath-weapon attacker).
function paralyze_monst_u(mon, amt) {
    mon.mcanmove = 0;
    mon.mfrozen = amt;
}

// ═══ mhitu.c:2616 cloneu ════════════════════════════════════════════════════
// A poly'd hero split in two (AD_SITM/AD_DRIN callers in uhitm.c).  No RNG of
// its own; makemon() inside it does.
export async function cloneu() {
    const u = game.u || {};
    if ((u.mh | 0) <= 1) return null;
    const mdat = youmonst_data();
    if (!mdat) return null;
    const mvit = game.mvitals?.[mdat.pmidx];
    const G_EXTINCT = 0x01;     // C ref: monflag.h:210
    if (mvit && ((mvit.mvflags | 0) & G_EXTINCT)) return null;
    const { makemon } = await import('./makemon.js');
    const mon = await makemon(mdat, u.ux, u.uy,
        NO_MINVENT | MM_EDOG | MM_NOMSG);
    if (!mon) return null;
    mon.mcloned = 1;
    mon.mgivenname = game.plname;
    mon.m_lev = mdat.mlevel | 0;
    mon.mhpmax = u.mhmax | 0;
    mon.mhp = Math.trunc((u.mh | 0) / 2);
    u.mh -= mon.mhp;
    game.disp_botl = true;
    return mon;
}

// ── the ops bundle js/mhitm_ad.js's hero-defender arms expect ───────────────
// mhitm_ad.js was written to take these as injected hooks so it need not import
// the hero side; this is the mhitu direction filled in.  js/monmove.js's
// mhitm_adtyping() is the caller that still has to be switched over to it.
let _ops = null;
export function mhitu_ops() {
    if (_ops) return _ops;
    _ops = {
        permonst,
        vis: true,
        mattk_list,
        monLev: (m) => (m?.m_lev != null ? m.m_lev : (permonst(m)?.mlevel | 0)),
        MON_WEP: (m) => (is_hero(m) ? (game.uwep || null) : (m?.mw || null)),
        emit: emitU,
        hitmsg,
        magic_negation_hero: () => magic_negation(YOUMONST),
        u_slow_down,
        canseemon: canseemon_shared,
        canspotmon: canseemon_shared,
        Monnam: (m) => m?.data?.name || 'monster',
        mon_nam: (m) => m?.data?.name || 'monster',
        ACURR_DEX: () => acurr_eff(A_DEX),
        diseasemu,
        u_slip_free,
        cloneu,
        mdamageu,
        mpoisons_subj,
    };
    return _ops;
}
