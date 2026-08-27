// mhitm.js — monster-vs-monster (incl. pet) melee combat.
// C ref: src/mhitm.c — mattackm(), hitmm(), mdamagem(), passivemm(); the
// knockback RNG lives in src/uhitm.c mhitm_knockback(); the kill tail
// (corpse_chance, grow_up) lives in src/mon.c / src/makemon.c.
//
// The per-species combat data (mattk[], base AC, mlevel, msize, geno) comes
// from the GENERATED tables (js/monattk_data.js MATTK[] + makemon.js MONS[]),
// resolved BY NAME — see permonst() for why pmidx can't be trusted.  It used
// to be a hand-written 26-entry table covering only the species the recorded
// sessions happened to show, which made mattackm() decline (M_ATTK_MISS, no
// RNG) for every other monster in the game, and got 5 of those 26 entries
// wrong (giant rat MZ_TINY, housecat AT_BITE, vampire bat's 2nd attack,
// lichen AD_STCK, grid bug AD_ELEC).
//
// The RNG-bearing calls, in stream order:
//   to-hit:        rnd(20 + i)              @ mattackm(mhitm.c:441)
//   base damage:   d(damn, damd)            @ mdamagem(mhitm.c:1025)
//   knockback:     rn2(3) then rn2(6)       @ mhitm_knockback(uhitm.c:5258/5269)
//   passive:       d(), then rn2(3) + the per-adtyp rolls  @ passivemm
//   kill tail:     rn2(corpse_chance), rnd(victim.m_lev+1) [+ rn2(max_inc)]
//
// STILL UNPORTED (each returns/continues without its C RNG, so it surfaces as
// a clean divergence rather than a silent desync): AT_GAZE gazemm(), AT_ENGL
// gulpmm(), AT_EXPL explmm(), AT_BREA/AT_SPIT breamm()/spitmm(), the AT_WEAP
// ranged thrwmm() branch, mhitm_adtyping()'s non-physical damage arms, and
// the pudding-division clone_mon().

import { game } from './gstate.js';
import { hitval } from './weapon.js';
import { rn2, rnd, d } from './rng.js';
import {
    NATTK, M_ATTK_MISS, M_ATTK_HIT, M_ATTK_DEF_DIED, M_ATTK_AGR_DIED,
    M_ATTK_AGR_DONE, W_SADDLE, STRAT_WAITMASK,
} from './const.js';
import { DEADMONSTER, mvitals_died, healmon } from './mon.js';
import { newsym, map_invisible, unmap_object, m_at, canseemon_shared } from './display.js';
import { cansee } from './vision.js';
import { update_topl } from './display.js';
import { make_corpse, dmgval } from './uhitm.js';
import { DOOR, POOL, DRAWBRIDGE_UP, STRAT_WAITFORU } from './const.js';
// used only by the appended mhitm.c translations at the bottom of this file
import { IS_OBSTRUCTED, IS_TREE, IRONBARS, D_CLOSED, D_LOCKED } from './const.js';
import { is_animal, is_neuter_flag, perceives_flag, is_elf_flag, is_orc_flag,
         is_undead_flag, is_demon_flag, unsolid_flag, mflags1_of, M1_NOEYES,
         M1_THICK_HIDE, M1_WALLWALK, M1_TPORT,
} from './monflags_data.js';
import { WEP_HITBON } from './weapondmg_data.js';
import { xname } from './invent.js';
import { MATTK } from './monattk_data.js';
import { name_to_pmidx, monster_by_pmidx, is_home_elemental } from './makemon.js';
// newcham/pm_to_cham: used only by the appended gulpmm()/mon_poly() below
import { newcham, pm_to_cham } from './makemon.js';
import { mhitm_adtyping } from './mhitm_ad.js';
// mhitu.c owns these four (mhitm.c:383/426/85/659 call them across the file
// boundary); js/mhitu.js is the single faithful copy.
import { getmattk, could_seduce, mtrapped_in_pit } from './mhitu.js';
import { find_mac as worn_find_mac } from './worn.js';

// C ref: mhitm.c:358 gv.vis — latched ONCE per mattackm() call, before the
// attack loop.  Several mhitm_ad_* handlers rloc() a combatant and then still
// read it, so recomputing live would test the post-teleport position.
let gv_vis = false;
// C ref: mhitm.c:372 gs.skipdrin — a mind flayer that finds a headless target
// skips its remaining AT_TENT/AD_DRIN attacks this move.
let gs_skipdrin = false;

// ── monster-combat message rendering ─────────────────────────────────────────
// C ref: mhitm.c hitmm()/missmm() + mon.c monkilled().  These emit the "The X
// bites/misses the Y." and "The Y is destroyed!" top-line messages.  The
// movemon() pass that reaches mattackm() is async (allmain.js), so each visible
// combat message is paged through update_topl() inline, exactly like C's topl
// buffer: a message arriving while the previous one is unacknowledged fires a
// blocking --More-- (captured as its own screen frame, with the LIVE map state
// underneath) before replacing it.  This inline timing is what makes the
// map-under-each-frame match C (the dead defender is still drawn until its
// death message's predecessor has been paged).
async function emitMMmsg(msg) {
    if (!msg) return;
    await update_topl(msg);
}

// C ref: do_name.c x_monnam — the bare species name for a monster instance.
// A mounted/grounded steed wearing a saddle is described as "saddled <species>"
// (steed.c mon_nam path); the contest's only monster-combat messages with a
// saddled attacker are the post-dismount pony bites.
function mon_species(mtmp) {
    let s = (mtmp?.data?.name) || 'monster';
    if (((mtmp?.misc_worn_check || 0) & W_SADDLE)
        && !(mtmp?.mgivenname || mtmp?.mextra?.mgivenname))
        s = 'saddled ' + s;
    return s;
}
// the(species): "the <species>" with a given name standing alone.
function the_monnam(mtmp) {
    const given = mtmp?.mgivenname || mtmp?.mextra?.mgivenname;
    if (given) return given;
    return 'the ' + mon_species(mtmp);
}
// Monnam(): capitalized the_monnam.
function Monnam(mtmp) {
    const s = the_monnam(mtmp);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// C ref: do_name.c x_monnam() do_it — when the hero can't spot the monster,
// mon_nam()/Monnam() collapse to "it" (article != ARTICLE_YOUR, not gameover,
// not the steed/engulfer).  For the modeled hero canspotmon() reduces to
// canseemon() == mm_can_see_mon() (no telepathy/detection, and cold undead
// aren't infravisible).  do_it is tested before the name is consulted, so even
// a named monster that can't be spotted renders as "it".
function mon_nam_mm(mtmp) {
    if (!mm_can_see_mon(mtmp)) return 'it';
    return the_monnam(mtmp);
}
function Monnam_mm(mtmp) {
    const s = mon_nam_mm(mtmp);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// C ref: mhitm.c:358 gv.vis — `(cansee(magr) && canspotmon(magr)) ||
// (cansee(mdef) && canspotmon(mdef))`.  The cansee() conjunct matters once the
// hero has infravision: a warm monster on an unlit square is canspotmon but
// NOT cansee, and its fight is silent.
function mm_visible(magr, mdef) {
    return (cansee(magr.mx, magr.my) && mm_can_see_mon(magr))
        || (cansee(mdef.mx, mdef.my) && mm_can_see_mon(mdef));
}

// C ref: mhitm.c:41 pre_mm_attack() — called at the top of hitmm()/missmm(),
// just before the attack message.  A formerly concealed combatant stops
// mimicking/hiding (this happens even when the hero can't see it, because the
// monster is now in action), and when the encounter is visible but one
// combatant isn't individually spotted the hero remembers that square as
// holding a sensed-but-unseen monster (the 'I' glyph).  The unhiding half was
// skipped on the grounds that no *listed* combatant was a mimic or hider; that
// list is gone, and mundetected hiders (lurkers, hiding-under-object vermin)
// reach mattackm routinely.  No RNG, but mundetected/m_ap_type steer later
// display and monmove decisions.
function pre_mm_attack(magr, mdef) {
    let showit = false;
    const vis = mm_visible(magr, mdef);
    for (const m of [mdef, magr]) {
        if (m.m_ap_type) {                 // mon.c seemimic(m)
            m.m_ap_type = 0;
            m.mappearance = 0;
            newsym(m.mx, m.my);
            showit = showit || vis;
        } else if (m.mundetected) {
            m.mundetected = 0;
            showit = showit || vis;
        }
    }
    if (!vis) return;
    if (!mm_can_see_mon(magr)) map_invisible(magr.mx, magr.my);
    else if (showit) newsym(magr.mx, magr.my);
    if (!mm_can_see_mon(mdef)) map_invisible(mdef.mx, mdef.my);
    else if (showit) newsym(mdef.mx, mdef.my);
}

// C ref: mhitm.c noises() — when a mon-vs-mon attack isn't visible (gv.vis
// false) the hero may still hear it.  farq = mdistu(magr) > 15 (dist2 from the
// hero).  Gated so a repeated same-distance noise within 10 turns is silent;
// tracked by gf.far_noise / gn.noisetime (stored on the game object so they
// reset per game and persist within it).  AT_EXPL never reaches here (mattackm
// handles it in its own case), so the sound is always "some noises".
async function noises(magr, mattk) {
    const u = game.u;
    if (u?.Deaf) return;
    const dx = magr.mx - (u?.ux ?? 0), dy = magr.my - (u?.uy ?? 0);
    const farq = (dx * dx + dy * dy) > 15;
    const prevFar = !!game.far_noise;
    const noisetime = game.noisetime || 0;
    if (farq !== prevFar || (game.moves - noisetime) > 10) {
        game.far_noise = farq;
        game.noisetime = game.moves;
        const what = (mattk && mattk.aatyp === AT_EXPL) ? 'an explosion' : 'some noises';
        await emitMMmsg(`You hear ${what}${farq ? ' in the distance' : ''}.`);
    }
}

// C ref: include/monsym.h defsym.h MONSYM indices.
const S_VORTEX = 22, S_LICH = 38, S_GOLEM = 55;

// C ref: mondata.h is_rider(ptr) / is_mplayer(ptr).  is_mplayer is the
// contiguous mons[] span PM_ARCHEOLOGIST..PM_WIZARD, resolved through the
// generated name table rather than hardcoded so a mons[] shift can't skew it.
const RIDER_NAMES = new Set(['Death', 'Famine', 'Pestilence']);
function is_rider(ptr) { return !!ptr && RIDER_NAMES.has(ptr.name); }
let _mplayer_span;   // resolved lazily: makemon.js may still be evaluating
function is_mplayer(ptr) {
    if (_mplayer_span === undefined) {
        const lo = name_to_pmidx('archeologist'), hi = name_to_pmidx('wizard');
        _mplayer_span = (lo >= 0 && hi >= lo) ? [lo, hi] : null;
    }
    return !!_mplayer_span && ptr?.pmidx != null
        && ptr.pmidx >= _mplayer_span[0] && ptr.pmidx <= _mplayer_span[1];
}

// C ref: mondata.h:219 nonliving(ptr) == is_undead(ptr) || ptr == &mons[PM_MANES]
// || weirdnonliving(ptr), where weirdnonliving == is_golem(ptr) || mlet ==
// S_VORTEX.  Was a species-name regex, which (a) answered FALSE for every
// undead whose name lacks one of the seven listed words (e.g. "vampire",
// "ghoul", "shade", "human zombie" is fine but "Vlad the Impaler" isn't) and
// (b) answered TRUE for elementals, which are NOT nonliving in C.
function nonliving(mtmp) {
    const ptr = permonst(mtmp);
    if (!ptr) return false;
    return is_undead_flag(ptr) || ptr.name === 'manes'
        || ptr.mcls === S_GOLEM || ptr.mcls === S_VORTEX;
}

// C ref: mhitm.c hitmm() — the verb for a connecting attack of type aatyp.
function hit_verb(aatyp) {
    switch (aatyp) {
    case AT_BITE: return 'bites';
    case AT_STNG: return 'stings';
    case AT_BUTT: return 'butts';
    case AT_TUCH: return 'touches';
    default:      return 'hits'; // AT_CLAW / AT_KICK / AT_WEAP / etc
    }
}

// ── attack-type / damage-type enums (include/monattk.h) ──────────────────────
const AT_NONE = 0, AT_CLAW = 1, AT_BITE = 2, AT_KICK = 3, AT_BUTT = 4,
      AT_TUCH = 5, AT_STNG = 6, AT_HUGS = 7, AT_ENGL = 11, AT_BREA = 12,
      AT_EXPL = 13, AT_BOOM = 14, AT_GAZE = 15, AT_TENT = 16,
      AT_SPIT = 10, AT_WEAP = 254, AT_MAGC = 255;
const AD_PHYS = 0, AD_FIRE = 2, AD_COLD = 3, AD_ELEC = 6, AD_ACID = 8,
      AD_PLYS = 14, AD_STUN = 12, AD_DGST = 26, AD_STCK = 19, AD_WRAP = 28,
      AD_SITM = 21, AD_SEDU = 22, AD_ENCH = 41, AD_SSEX = 35,
      AD_DISE = 33, AD_PEST = 38, AD_FAMN = 39, AD_POLY = 43,
      AD_DRIN = 32;                     // monattk.h:74 (NOT 27 = AD_HEAL)

// C ref: monst.h resists_*(mon) — the species mresists bits.  mondata.js's
// copies read mon.data.mresists directly, which is undefined on the pet's
// minimal data object; route through permonst() so a pet answers for its own
// species instead of silently "resists nothing".
const MR_FIRE = 0x01, MR_COLD = 0x02, MR_ELEC = 0x10, MR_ACID = 0x40;
const mm_resists = (mon, bit) => ((permonst(mon)?.mresists ?? 0) & bit) !== 0;
const mm_resists_fire = (mon) => mm_resists(mon, MR_FIRE);
const mm_resists_cold = (mon) => mm_resists(mon, MR_COLD);
const mm_resists_elec = (mon) => mm_resists(mon, MR_ELEC);
const mm_resists_acid = (mon) => mm_resists(mon, MR_ACID);

// C ref: mon->data — the permonst record.  dog.js builds the starting pet with
// a MINIMAL data object whose pmidx is the C PM_* value, which is NOT this
// port's MONS-table index (kitten: C 34 == our jaguar; pony: C 102 == our gray
// unicorn), and which carries no ac/mlevel/msize/geno at all.  Every
// pmidx-keyed table (MATTK, MFLAGS1/2/3) therefore answers for the wrong
// species when handed a pet's data directly.  Re-resolve through the species
// NAME, which both representations carry, and use the canonical MONS record
// everywhere mattackm needs species data.
const _permonst_cache = new Map();
export function permonst(mon) {
    const dat = mon?.data;
    if (!dat) return null;
    const nm = dat.name;
    if (!nm) return dat;
    let rec = _permonst_cache.get(nm);
    if (rec === undefined) {
        const p = name_to_pmidx(nm);
        rec = (p >= 0) ? monster_by_pmidx(p) : null;
        _permonst_cache.set(nm, rec);
    }
    return rec || dat;
}

// C ref: mons[].mattk[] — the attack list, trailing NO_ATTK slots dropped by
// the generator (they can never match a getmattk()/attacktype() query, and
// passivemm's "first AT_NONE slot" walk treats a missing slot as NO_ATTK).
export function mattk_list(mon) {
    const ptr = permonst(mon);
    const tbl = (ptr && ptr.pmidx != null) ? MATTK[ptr.pmidx] : null;
    return tbl || [];
}

// could_seduce() now lives in js/mhitu.js (its C home, mhitu.c:1934) — the copy
// that used to be here only had the monster-vs-monster arm, so the hero
// direction (mhitu.c's own callers) could never be served from it.

// C ref: mondata.h dmgtype(ptr, dtyp) — any attack slot with that damage type.
function attacktype_ad(mon, adtyp) {
    return mattk_list(mon).some((a) => a[1] === adtyp);
}
// C ref: mondata.h attacktype(ptr, atyp) — any attack slot of that attack type.
function attacktype_at(mon, aatyp) {
    return mattk_list(mon).some((a) => a[0] === aatyp);
}

// weapon_check states (C ref: monst.h wpn_chk_flags).
const NO_WEAPON_WANTED = 0, NEED_WEAPON = 1, NEED_HTH_WEAPON = 3;
// Hand-to-hand weapon priority (C ref: weapon.c hwep[]), restricted to the
// otyps the contest's armed monsters carry; the orcish "crude" dagger (36) is
// the only one reachable for the low-level orc/kobold slice.
const HWEP_PRIORITY_MM = [55, 45, 54, 52, 50, 46, 48, 73, 44, 27, 30, 28, 77,
    34, 35, 36, 40];
const ORCISH_DAGGER_MM = 36;

// C ref: mondata.h MON_WEP(mon) — the monster's wielded weapon (mw).
function MON_WEP_MM(mon) { return mon?.mw || null; }

// C ref: weapon.c select_hwep — first carried weapon in hwep[] priority.  No RNG.
function select_hwep_mm(mtmp) {
    for (const otyp of HWEP_PRIORITY_MM)
        for (const o of (mtmp?.minvent || []))
            if (o.otyp === otyp) return o;
    return null;
}

// C ref: weapon.c mon_wield_item(mon) — wield the best melee weapon.  Returns 1
// if the monster wielded a (different) weapon this turn, 0 otherwise.  No RNG;
// only the "<Mon> wields <weapon>!" message + mw set.
async function mon_wield_item_mm(mon) {
    if (mon.weapon_check === NO_WEAPON_WANTED) return 0;
    const obj = select_hwep_mm(mon);
    if (obj) {
        const mw_tmp = MON_WEP_MM(mon);
        if (mw_tmp && mw_tmp.otyp === obj.otyp) {
            mon.weapon_check = NEED_WEAPON;
            return 0;
        }
        mon.mw = obj;
        mon.weapon_check = NEED_WEAPON;
        if (mm_can_see_mon(mon)) {
            const nm = (obj.otyp === ORCISH_DAGGER_MM) ? 'a crude dagger' : 'a weapon';
            await emitMMmsg(`${Monnam(mon)} wields ${nm}!`);
        }
        return 1;
    }
    return 0;
}

// C ref: canseemon(mon) — (cansee || see_with_infrared) && mon_visible.
const mm_can_see_mon = canseemon_shared;

// C ref: include/monflag.h MZ_* body sizes.  MZ_HUMAN is an ALIAS for
// MZ_MEDIUM (== 2), not a size of its own; the previous local table defined
// MZ_HUMAN = 3, which is MZ_LARGE, and so mis-sized every human-sized monster
// for bigmonst()/the knockback differential.
const MZ_TINY = 0, MZ_SMALL = 1, MZ_MEDIUM = 2, MZ_HUMAN = MZ_MEDIUM,
      MZ_LARGE = 3;

// C ref: include/monflag.h G_FREQ — the creation-frequency mask of geno.
const G_FREQ = 0x0007;

// C ref: mondata.h verysmall(ptr) / bigmonst(ptr).
function verysmall(ptr) { return (ptr?.msize ?? MZ_MEDIUM) < MZ_SMALL; }
function bigmonst(ptr) { return (ptr?.msize ?? MZ_MEDIUM) >= MZ_LARGE; }

// C ref: mon.c m_lev — the monster's effective level.  makemon()'s newmonhp()
// and dog.c's makedog() both set m_lev; the species base level is the fallback
// for a record that predates that.
function monLev(mon) {
    if (mon && mon.m_lev != null) return mon.m_lev;
    return permonst(mon)?.mlevel ?? 0;
}

// C ref: worn.c find_mac(mdef).
function find_mac(mdef) { return worn_find_mac(mdef); }

// getmattk() now lives in js/mhitu.js (its C home, mhitu.c:310).  The copy that
// used to be here dropped the is_home_elemental() tail — an elemental on its own
// Elemental Plane doubles damn, which is a DIFFERENT number of d() rolls in
// mdamagem — and the AD_DREN hero rescale.

// C ref: hack.h distmin(x0,y0,x1,y1) — Chebyshev (king-move) distance.
function distmin(x0, y0, x1, y1) {
    return Math.max(Math.abs(x0 - x1), Math.abs(y0 - y1));
}

// ── uhitm.c mhitm_knockback ──────────────────────────────────────────────────
// C draws knockdistance = rn2(3) at the top (uhitm.c:5258), then rn2(chance)
// (chance == 6 without ART_OGRESMASHER; uhitm.c:5269).  Everything after the
// 1/6 branch is RNG-free up to the hurtle, so the gate chain is ported in full
// and the function still declines rather than hurtling the defender: the
// actual hurtle_step/mon_break_boulder machinery is not modelled.  Getting the
// chain right matters because it decides whether mdamagem() short-circuits.
function mhitm_knockback(magr, mdef, mattk, weaponUsed) {
    /* knockdistance */ rn2(3);              // uhitm.c:5258
    const chance = 6;                         // no ART_OGRESMASHER in this port
    if (rn2(chance)) return false;            // uhitm.c:5269 — 5/6 of the time

    // only AD_PHYS claw/kick/butt/weapon attacks qualify
    if (!(mattk.adtyp === AD_PHYS
          && (mattk.aatyp === AT_CLAW || mattk.aatyp === AT_KICK
              || mattk.aatyp === AT_BUTT || mattk.aatyp === AT_WEAP)))
        return false;
    // an attacker that wants to grab or engulf doesn't knock back
    if (attacktype_at(magr, AT_ENGL) || attacktype_at(magr, AT_HUGS)
        || attacktype_ad(magr, AD_STCK))
        return false;
    if (DEADMONSTER(magr) || DEADMONSTER(mdef)) return false;
    // attacker must be much larger than defender
    if (!((permonst(magr)?.msize ?? MZ_MEDIUM)
          > (permonst(mdef)?.msize ?? MZ_MEDIUM) + 1))
        return false;
    // The remaining steps (test_move, hurtle, saddle dismount) move the
    // defender; not modelled, so decline without further RNG.
    return false;
}

// ── the ops bundle js/mhitm_ad.js runs its handlers against ─────────────────
// C's mhitm_ad_* family is ONE function per damage type serving all three
// combat directions; this port keeps the name rendering, visibility rules and
// kill tail on the caller so mhitm_ad.js has no import cycle back here.
// `vis` is C's gv.vis, LATCHED in mattackm (mhitm.c:358) — several handlers
// rloc() their combatant and then still consult the pre-teleport value.
function mm_ops() {
    return {
        vis: gv_vis,
        permonst,
        Monnam,
        mon_nam: the_monnam,          /* x_monnam(ARTICLE_THE) */
        Monnam_vis: Monnam_mm,        /* Some_Monnam(): "it" when unspottable */
        mon_nam_vis: mon_nam_mm,      /* some_mon_nam() */
        canseemon: mm_can_see_mon,
        canspotmon: mm_can_see_mon,
        emit: emitMMmsg,
        MON_WEP: MON_WEP_MM,
        monLev,
        mattk_list,
        grow_up,
        monkilled: monkilled_mm,
        mondied: killMonster,
        monstone: monstone_mm,
        set_skipdrin: () => { gs_skipdrin = true; },
        // hero-defender only; mhitm.js never dispatches with mdef == youmonst.
        hitmsg: async () => {},
    };
}

// ── mhitm.c mdamagem ─────────────────────────────────────────────────────────
// Applies one successful melee hit's damage.  Returns the M_ATTK_* result.
async function mdamagem(magr, mdef, mattk, mwep, dieroll) {
    // C ref: mhitm.c:1025 — the mhm struct every mhitm_ad_* handler mutates.
    const mhm = {
        damage: d(mattk.damn | 0, mattk.damd | 0),
        hitflags: M_ATTK_MISS,
        permdmg: 0,
        specialdmg: 0,
        dieroll,
        done: false,
    };

    // C ref: mhitm.c:1032 — an aggressor that bites a cockatrice (or digests
    // Medusa) without the right protector turns to stone before its own
    // damage lands.  attk_protection() names the slot that would save it.
    if ((touch_petrifies_mm(permonst(mdef))
         || (mattk.adtyp === AD_DGST && permonst(mdef)?.name === 'Medusa'))
        && !resists_ston_mm(magr)) {
        const protector = attk_protection_mm(mattk.aatyp);
        let wornitems = magr.misc_worn_check | 0;
        if (mwep) wornitems |= W_ARMG;          /* wielded weapon == gloves */
        if (protector === 0
            || (protector !== -1 && (wornitems & protector) !== protector)) {
            if (poly_when_stoned_mm(permonst(magr)))
                return M_ATTK_HIT;              /* mon_to_stone(): no damage */
            if (gv_vis && mm_can_see_mon(magr))
                await emitMMmsg(`${Monnam(magr)} turns to stone!`);
            await monstone_mm(magr);
            return M_ATTK_AGR_DIED;
        }
    }

    await mhitm_adtyping(magr, mattk, mdef, mhm, mm_ops());

    // mhitm_knockback() — rolls rn2(3) then rn2(6); the gate chain always
    // declines here (the hurtle itself isn't modelled), so it never
    // short-circuits mdamagem.
    mhitm_knockback(magr, mdef, mattk, !!mwep);

    if (mhm.done) return mhm.hitflags;          // mhitm.c:1069

    const damage = mhm.damage;
    let hitflags = mhm.hitflags;
    if (!damage) return hitflags;

    mdef.mhp -= damage;
    if (mdef.mhp < 1) {
        await monkilled_mm(mdef, mattk.adtyp);
        if (hitflags === M_ATTK_AGR_DIED)
            return (M_ATTK_DEF_DIED | M_ATTK_AGR_DIED);
        // AD_DGST's post-kill arm (newcham / wraith grow_up / nurse healmon /
        // mon_givit) is skipped: mon_givit draws RNG this port can't yet place.
        const grew = grow_up(magr, mdef);
        return M_ATTK_DEF_DIED | (grew ? 0 : M_ATTK_AGR_DIED);
    }
    return (hitflags === M_ATTK_AGR_DIED) ? M_ATTK_AGR_DIED : M_ATTK_HIT;
}

// C ref: mon.c monkilled(mdef, "", adtyp) — the death line prints when the
// square is visible, BEFORE the corpse/detach bookkeeping.  Paging it here
// (while the defender is still on the map) reproduces C's frame where the
// previous combat line's --More-- shows the doomed defender still drawn;
// killMonster() then removes it for the final frame.  When the square ISN'T
// visible and the victim was tame, C prints "You have a sad feeling for a
// moment." AFTER mondied() instead.
async function monkilled_mm(mdef, _adtyp) {
    let be_sad = false;
    if (cansee(mdef.mx, mdef.my))
        await emitMMmsg(`${Monnam(mdef)} is ${nonliving(mdef) ? 'destroyed' : 'killed'}!`);
    else
        be_sad = !!mdef.mtame;
    await killMonster(mdef);
    if (be_sad) await emitMMmsg('You have a sad feeling for a moment.');
}

// C ref: mhitm.c:970 explmm(magr, mdef, mattk) — an AT_EXPL monster detonates
// next to another monster.  For the three adtyps that make a REAL explosion the
// blast is mon_explodes(); anything else is an ordinary mdamagem().  Either way
// the aggressor dies.
async function explmm(magr, mdef, mattk) {
    if (magr.mcan) return M_ATTK_MISS;

    if (cansee(magr.mx, magr.my))
        await emitMMmsg(`${Monnam(magr)} explodes!`);
    else
        await noises(magr, mattk);

    let result;
    if (mattk.adtyp === AD_FIRE || mattk.adtyp === AD_COLD
        || mattk.adtyp === AD_ELEC) {
        const { mon_explodes } = await import('./explode.js');
        await mon_explodes(magr, [mattk.aatyp, mattk.adtyp, mattk.damn, mattk.damd]);
        result = M_ATTK_AGR_DIED | (DEADMONSTER(mdef) ? M_ATTK_DEF_DIED : 0);
    } else {
        result = await mdamagem(magr, mdef, mattk, null, 0);
    }

    if (!(result & M_ATTK_AGR_DIED)) {
        await killMonster(magr);                       /* mondead(magr) */
        result |= M_ATTK_AGR_DIED;
    }
    if (magr.mtame) await emitMMmsg('You have a melancholy feeling for a moment.');
    return result;
}

// C ref: mon.c monstone(mdef) — the victim becomes a STATUE.  Unlike
// mondied() this does NOT run corpse_chance(), so it must not draw its rn2.
async function monstone_mm(mdef) {
    const mx = mdef.mx, my = mdef.my;
    const loc0 = game.level?.at(mx, my);
    if (loc0?.invisMon) unmap_object(mx, my);
    const list = game.level?.monsters;
    if (list) {
        mvitals_died(mdef);
        const idx = list.indexOf(mdef);
        if (idx >= 0) list.splice(idx, 1);
    }
    mdef.mhp = 0;
    // mkcorpstat(STATUE, ...) draws no RNG; the statue object itself is not
    // modelled, so the square just reverts to its remembered contents.
    { const { relobj } = await import('./uhitm.js'); relobj(mdef, mx, my); }
    if (mx > 0 && my > 0) newsym(mx, my);
}

// C ref: mondata.h:200 touch_petrifies(ptr) — PM_COCKATRICE || PM_CHICKATRICE.
// There is NO M1_* flag for this in 3.7; Medusa is flesh_petrifies() only and
// reaches mdamagem's guard through the separate AD_DGST arm.
function touch_petrifies_mm(ptr) {
    return ptr?.name === 'cockatrice' || ptr?.name === 'chickatrice';
}
// C ref: mondata.c resists_ston(mon) — MR_STONE in mresists.
const MR_STONE = 0x80;
function resists_ston_mm(mon) {
    return ((permonst(mon)?.mresists ?? 0) & MR_STONE) !== 0;
}
// C ref: mondata.h poly_when_stoned(ptr) — flesh/clay/... golems become stone.
function poly_when_stoned_mm(ptr) {
    return ptr?.mcls === S_GOLEM && ptr?.name !== 'stone golem';
}
// C ref: mhitm.c:1475 attk_protection(aatyp) — the worn slot that blocks
// contact petrification for that attack form; ~0L ("always safe") is -1 here.
export function attk_protection_mm(aatyp) {
    switch (aatyp) {
    case AT_NONE: case AT_SPIT: case AT_EXPL: case AT_BOOM:
    case AT_GAZE: case AT_BREA: case AT_MAGC:
        return -1;                       /* ~0L: no contact at all */
    case AT_CLAW: case AT_TUCH: case AT_WEAP:
        return W_ARMG;                   /* caller ORs in W_ARMG for a weapon */
    case AT_KICK:
        return W_ARMF;
    case AT_BUTT:
        return W_ARMH;
    case AT_HUGS:
        return W_ARMC | W_ARMG;          /* attacker needs BOTH */
    default:                             /* AT_BITE/STNG/ENGL/TENT */
        return 0;                        /* no defense available */
    }
}

// C ref: mon.c:3181 corpse_chance(mon, magr, was_swallowed).  The rn2(tmp) tail
// is load-bearing AND its TRUE result triggers make_corpse(), which itself
// consumes RNG (next_ident + rndmonnum reservoir + corpse timeout) — see
// killMonster() below.  The guards in front of it decide whether that rn2 is
// drawn AT ALL, so leaving them out (as this did) picks the wrong modulus for
// every big/golem/lich/gas-spore victim.
function corpse_chance(mdef) {
    const mdat = permonst(mdef);

    // Vlad and the liches crumble to dust: no corpse, NO rn2.
    if (mdat?.name === 'Vlad the Impaler' || mdat?.mcls === S_LICH) return false;

    // Gas spores always explode on death.  mon_explodes() is not modelled, but
    // the AT_BOOM damage roll in front of it is real RNG, so draw it and then
    // decline the corpse exactly as C does.
    for (const a of mattk_list(mdef)) {
        if (a[0] !== AT_BOOM) continue;
        if (a[2]) d(a[2], a[3]);
        else if (a[3]) d((mdat?.mlevel ?? 0) + 1, a[3]);
        return false;
    }

    // bigmonst/lizard/golem/mplayer/rider/shopkeeper always leave one: no rn2.
    if (((bigmonst(mdat) || mdat?.name === 'lizard') && !mdef.mcloned)
        || mdat?.mcls === S_GOLEM || is_mplayer(mdat) || is_rider(mdat)
        || mdef.isshk)
        return true;

    const tmp = 2 + (((mdat?.geno ?? 0) & G_FREQ) < 2 ? 1 : 0)
        + (verysmall(mdat) ? 1 : 0);
    return !rn2(tmp);                         // mon.c:3248
}

// C ref: monmove.c accessible(x,y) — ACCESSIBLE(typ)==typ>=DOOR && !closed_door.
// Kill sites in the contest sessions are open floor/corridor/doorway; no closed
// door sits under a dying monster, so the closed_door() refinement is omitted.
function accessible(x, y) {
    const typ = game.level?.at(x, y)?.typ;
    return typ != null && typ >= DOOR;
}

// C ref: rm.h IS_POOL(typ) — pools/moat/water also let a corpse drop.
function is_pool(x, y) {
    const typ = game.level?.at(x, y)?.typ;
    return typ != null && typ >= POOL && typ <= DRAWBRIDGE_UP;
}

// Remove a dead monster from the level and redraw its square.  C ref: mon.c
// mondied() -> mondead() [detach] then, if corpse_chance() succeeds and the
// square is accessible (or a pool), make_corpse() which rolls next_ident,
// rndmonnum and the corpse-timeout sequence.
export async function mondied_mm(mdef) { return await killMonster(mdef); }
async function killMonster(mdef) {
    mdef.mhp = 0;
    // C ref: mon.c mondead() — "if (glyph_is_invisible(...)) unmap_object(...)"
    // runs before m_detach.  A defender killed this same attack may have just
    // had pre_mm_attack() mark its square with the 'I' remembered-unseen-
    // monster glyph (attacker spotted, defender not); clear that stale marker
    // before the corpse/newsym below so the square reverts to its real
    // remembered contents instead of keeping the 'I'.
    const loc0 = game.level?.at(mdef.mx, mdef.my);
    if (loc0?.invisMon) unmap_object(mdef.mx, mdef.my);
    const dropCorpse = corpse_chance(mdef); // mon.c:3181
    const mx = mdef.mx, my = mdef.my;
    // Detach from the level so the renderer (m_at / MON_AT) stops drawing it.
    // The dead monster's coordinates are intentionally left intact: mattackm
    // still consults them for the post-attack passivemm adjacency guard (which
    // returns early for a dead defender anyway, so no extra RNG is drawn), and
    // make_corpse() places the cadaver at those same coordinates.
    const list = game.level?.monsters;
    if (list) {
        mvitals_died(mdef);            // mon.c:3135
        const idx = list.indexOf(mdef);
        if (idx >= 0) list.splice(idx, 1);
    }
    // C ref: mon.c m_detach(due_to_death) -> relobj(mtmp, 1, FALSE) — the dead
    // monster's inventory hits the floor BEFORE the corpse, so it sits under it.
    { const { relobj } = await import('./uhitm.js'); relobj(mdef, mx, my); }
    // C ref: mon.c mondied — make_corpse only when corpse_chance passed AND the
    // square can hold a corpse (accessible terrain or a pool).
    if (dropCorpse && mx > 0 && my >= 0 && (accessible(mx, my) || is_pool(mx, my)))
        make_corpse(mdef, mx, my);
    if (mx > 0 && my > 0) newsym(mx, my);
}

// C ref: makemon.c:2051 grow_up(mtmp, victim) — the killer may gain HP/levels.
// Only the `victim != 0` (killed a monster) branch is reachable from mdamagem.
// Returns TRUE if the aggressor survives; FALSE maps to M_ATTK_AGR_DIED.
//
// The hp_threshold clamp on max_increase (makemon.c:2096) was missing, and it
// is not cosmetic: it rewrites max_increase, which is the MODULUS of the
// rn2(max_increase) on the next line.
//
// NOT ported: the little_to_big() species change (kitten -> housecat and the
// rest of grownups[]) with its "grows up into a housecat" message, gender flip
// and G_GENOD death.  None of it draws RNG; it needs set_mon_data + the mvitals
// genocide table, and mutating mon.data mid-game touches the pet's whole
// (pmidx-mismatched) data representation.
function grow_up(magr, mdef) {
    if (DEADMONSTER(magr)) return false;       // makemon.c:2059

    const ptr = permonst(magr);
    const mlev = monLev(magr);
    const victimLev = monLev(mdef);

    let hp_threshold = mlev * 8;               // makemon.c:2082
    if (!mlev) hp_threshold = 4;
    else if (ptr?.mcls === S_GOLEM)
        hp_threshold = (Math.floor((magr.mhpmax | 0) / 10) + 1) * 10 - 1;
    else if (is_home_elemental(ptr)) hp_threshold *= 3;

    let lev_limit = Math.floor(3 * (ptr?.mlevel ?? 0) / 2); /* adj_lev() */

    // max_increase = rnd(victim->m_lev + 1), clamped so the gain stops at the
    // bottom of the next level.                          (makemon.c:2095-2098)
    let max_increase = rnd(victimLev + 1);
    if ((magr.mhpmax | 0) + max_increase > hp_threshold + 1)
        max_increase = Math.max((hp_threshold + 1) - (magr.mhpmax | 0), 0);
    const cur_increase = (max_increase > 1) ? rn2(max_increase) : 0;

    magr.mhpmax = (magr.mhpmax | 0) + max_increase;
    magr.mhp = (magr.mhp | 0) + cur_increase;
    if (magr.mhpmax <= hp_threshold) return true; /* doesn't gain a level */

    if (is_mplayer(ptr)) lev_limit = 30;
    else if (lev_limit < 5) lev_limit = 5;
    else if (lev_limit > 49) lev_limit = ((ptr?.mlevel ?? 0) > 49) ? 50 : 49;

    magr.m_lev = (magr.m_lev | 0) + 1;

    // sanity checks (makemon.c:2164)
    if (magr.m_lev > lev_limit) {
        magr.m_lev -= 1;
        if (magr.mhpmax === hp_threshold + 1) magr.mhpmax -= 1;
    }
    if (magr.mhpmax > 50 * 8) magr.mhpmax = 50 * 8;
    if (magr.mhp > magr.mhpmax) magr.mhp = magr.mhpmax;

    return true; /* aggressor survives */
}

// ── mhitm.c:1304 passivemm ───────────────────────────────────────────────────
// Defender's passive response.  Reached (even on a miss / kill) from mattackm's
// `if (attk && ... distmin <= 1)` guard.  Ported in full: the previous version
// rolled only the leading d() and one rn2(3), so it
//   * rolled rn2(3) for a defender whose six mattk[] slots are ALL attacks,
//     where C returns early with no roll at all;
//   * skipped AD_ACID's rn2(2) + rn2(30) + rn2(6), which C draws BEFORE the
//     `mdead || mcan` early-out (acid blob / green mold vs a pet is the classic
//     mon-vs-mon passive);
//   * skipped the floating eye's rn2(4); and
//   * never subtracted the passive damage from the aggressor, so a pet that C
//     kills on its own attack survived here.
async function passivemm(magr, mdef, mhitb, mdead, mwep) {
    const mddat = permonst(mdef), madat = permonst(magr);
    const attacks = mattk_list(mdef);
    const mhit = mhitb ? M_ATTK_HIT : M_ATTK_MISS;

    // find the first AT_NONE slot; six real attacks means no passive at all.
    let i = 0;
    for (;; i++) {
        if (i >= NATTK) return (mdead | mhit);  // mhitm.c:1315
        if (!attacks[i] || attacks[i][0] === AT_NONE) break;
    }
    const slot = attacks[i] || [AT_NONE, AD_PHYS, 0, 0];
    const damn = slot[2] | 0, damd = slot[3] | 0, adtyp = slot[1];
    let tmp;
    if (damn) tmp = d(damn, damd);
    else if (damd) tmp = d((mddat?.mlevel ?? 0) + 1, damd);
    else tmp = 0;

    let assess = false;
    // These affect the enemy even if the defender was killed.
    switch (adtyp) {
    case AD_ACID:
        if (mhitb && !rn2(2)) {
            if (mm_can_see_mon(magr))
                await emitMMmsg(`${Monnam(magr)} is splashed by ${s_suffix_mm(mon_nam_mm(mdef))} acid!`);
            if (mm_resists_acid(magr)) {
                if (mm_can_see_mon(magr))
                    await emitMMmsg(`${Monnam(magr)} is not affected.`);
                tmp = 0;
            }
        } else {
            tmp = 0;
        }
        rn2(30);   /* erode_armor(magr, ERODE_CORRODE) — no monster body armour */
        rn2(6);    /* acid_damage(MON_WEP(magr)) — erosion only, no RNG inside */
        assess = true;
        break;
    case AD_ENCH:
        /* drain_item(mwep) — no message, no RNG */
        break;
    default:
        break;
    }

    if (!assess) {
        if (mdead || mdef.mcan) return (mdead | mhit);

        // mhitm.c:1363 — `if (rn2(3))` gates the passive effect.
        if (rn2(3)) {
            switch (adtyp) {
            case AD_PLYS: /* floating eye / gelatinous cube */
                if (tmp > 127) tmp = 127;
                if (mddat?.name === 'floating eye') {
                    if (!rn2(4)) tmp = 127;
                    if (magr.mcansee && haseyes(madat) && mdef.mcansee
                        && (perceives_flag(madat) || !mdef.minvis)) {
                        // mon_reflects()/paralyze_monst() aren't modelled; C
                        // returns here either way, without further RNG.
                        return (mdead | mhit);
                    }
                } else {
                    return (mdead | mhit);
                }
                return 1;
            case AD_COLD:
                if (mm_resists_cold(magr)) { tmp = 0; break; }
                healmon(mdef, Math.floor(tmp / 2), Math.floor(tmp / 2));
                // split_mon() (blue jelly) isn't modelled — it makemon()s a
                // clone, which is RNG the port would have to reproduce exactly.
                break;
            case AD_STUN:
                if (!magr.mstun) magr.mstun = 1;
                tmp = 0;
                break;
            case AD_FIRE:
                if (mm_resists_fire(magr)) tmp = 0;
                break;
            case AD_ELEC:
                if (mm_resists_elec(magr)) tmp = 0;
                break;
            default:
                tmp = 0;
                break;
            }
        } else {
            tmp = 0;
        }
    }

    /* assess_dmg */
    magr.mhp = (magr.mhp | 0) - tmp;
    if (magr.mhp <= 0) {
        // monkilled(magr, "", adtyp) — the death line, then the detach/corpse.
        let be_sad = false;
        if (cansee(magr.mx, magr.my))
            await emitMMmsg(`${Monnam(magr)} is ${nonliving(magr) ? 'destroyed' : 'killed'}!`);
        else
            be_sad = !!magr.mtame;
        await killMonster(magr);
        if (be_sad) await emitMMmsg('You have a sad feeling for a moment.');
        return (mdead | mhit | M_ATTK_AGR_DIED);
    }
    return (mdead | mhit);
}

function s_suffix_mm(s) { return /s$/.test(s) ? `${s}'` : `${s}'s`; }

// C ref: mondata.h haseyes(ptr) = !(mflags1 & M1_NOEYES).
function haseyes(ptr) { return (mflags1_of(ptr) & M1_NOEYES) === 0; }

// C ref: mondata.h thick_skinned(ptr) = (mflags1 & M1_THICK_HIDE).
function thick_skinned(ptr) { return (mflags1_of(ptr) & M1_THICK_HIDE) !== 0; }

// ── mhitm.c mdisplacem ───────────────────────────────────────────────────────
// C ref: mhitm.c mdisplacem(magr, mdef, quietly) — the aggressor (a displacer
// beast, or a Rider) barges through the defender's square, swapping places
// with it instead of attacking.  Returns the same M_ATTK_* codes as
// mattackm(): a successful swap is M_ATTK_HIT, a failed one M_ATTK_MISS (the
// square is NOT entered on a miss — the caller must not move the aggressor).
export async function mdisplacem(magr, mdef, quietly) {
    if (!magr || !mdef || magr === mdef) return M_ATTK_MISS;
    const tx = mdef.mx, ty = mdef.my;
    const fx = magr.mx, fy = magr.my;
    if (m_at(fx, fy) !== magr || m_at(tx, ty) !== mdef) return M_ATTK_MISS;

    // 1-in-7 failure chance (matches the pet-displacement chance in do_attack()).
    if (!rn2(7)) return M_ATTK_MISS;

    const pa = permonst(magr);
    // Grid bugs cannot displace at an angle.  Resolved by species name, not by
    // data.pmidx: the pet records carry the C PM_* numbering (see permonst()).
    if (pa?.name === 'grid bug'
        && magr.mx !== mdef.mx && magr.my !== mdef.my)
        return M_ATTK_MISS;

    // C: mhitm.c:200-215 — the displaced defender stops hiding/mimicking, wakes
    // and drops its wait strategy; finish_meating() clears meating.  The
    // seemimic() arm was omitted as unreachable, but a mimic IS a valid
    // displacement target.  (touch_petrifies(pd) -> monstone(magr) is still
    // unported: monstone() builds a statue object, whose mksobj RNG this port
    // would have to reproduce exactly.)
    if (mdef.mundetected) mdef.mundetected = 0;
    if (mdef.m_ap_type && mdef.m_ap_type !== 'mon') {   // seemimic(mdef)
        mdef.m_ap_type = 0;
        mdef.mappearance = 0;
        newsym(mdef.mx, mdef.my);
    }
    mdef.msleeping = 0;
    mdef.mstrategy = (mdef.mstrategy || 0) & ~STRAT_WAITMASK;
    if (mdef.meating) mdef.meating = 0;

    const vis = mm_can_see_mon(magr) && mm_can_see_mon(mdef);

    magr.mx = tx; magr.my = ty;
    mdef.mx = fx; mdef.my = fy;

    if (vis && !quietly) {
        // C: `is_rider(pa) ? "the" : mhis(magr)` — a Rider barges through "the"
        // way, everyone else through "his"/"her" way.
        const hisher = is_rider(pa) ? 'the' : (magr.female ? 'her' : 'his');
        await emitMMmsg(`${Monnam_mm(magr)} moves ${mon_nam_mm(mdef)} out of ${hisher} way!`);
    }
    newsym(fx, fy);
    newsym(tx, ty);
    return M_ATTK_HIT;
}

// ── mhitm.c:597 failed_grab ──────────────────────────────────────────────────
// Can't hold an unsolid target (ghosts, lights, vortices, most elementals).
// notonhead (long-worm tail) isn't modelled.  Draws no RNG, but it CANCELS the
// strike, which suppresses mdamagem()'s d() roll and the whole kill tail.
async function failed_grab(magr, mdef, mattk) {
    if (unsolid_flag(permonst(mdef))
        && (mattk.aatyp === AT_HUGS || mattk.adtyp === AD_WRAP
            || mattk.adtyp === AD_STCK || mattk.adtyp === AD_DGST)) {
        if (mm_visible(magr, mdef) && mm_can_see_mon(mdef)) {
            const verb = (mattk.adtyp === AD_DGST) ? 'gulp'
                : (mattk.adtyp === AD_STCK) ? 'adhere' : 'grab';
            await emitMMmsg(`${s_suffix_mm(Monnam_mm(magr))} ${verb} attempt`
                + ` passes right through ${mon_nam_mm(mdef)}!`);
        }
        return true;
    }
    return false;
}

// ── mhitm.c:1283 mswingsm ────────────────────────────────────────────────────
// "<Mon> thrusts his <weapon> at <mdef>."  The mon-vs-mon format ends in
// "at %s"; mhitu.c's monster-vs-hero mswings() is the one that doesn't, and
// this used to emit that (hero-directed) wording with a hardcoded "crude
// dagger" as the weapon name.  Display only; no RNG.
async function mswingsm(magr, mdef, otemp) {
    if (!mm_can_see_mon(magr)) return;
    // mswings_verb(otemp, bash): SLASH weapons swing, everything else the
    // monsters here wield thrusts; a polearm used at reach bashes (no monster
    // in this port wields one).
    const verb = SLASH_OTYPS_MM.has(otemp.otyp) ? 'swings' : 'thrusts';
    const hisher = magr.female ? 'her' : 'his';
    const many = ((otemp.quan | 0) > 1) ? 'one of ' : '';
    await emitMMmsg(`${Monnam(magr)} ${verb} ${many}${hisher} ${xname(otemp)}`
        + ` at ${mon_nam_mm(mdef)}.`);
}
// C ref: objects[].oc_dir & SLASH for the edged weapons monsters can wield
// (otyps per mkobj.js).  Everything else they carry is PIERCE.
const SLASH_OTYPS_MM = new Set([
    43 /*scimitar*/, 44 /*silver saber*/, 45 /*broadsword*/, 46 /*long sword*/,
    47 /*two-handed sword*/, 48 /*katana*/, 51 /*axe*/, 52 /*battle-axe*/,
]);

// C ref: weapon.c hitval(otmp, mon) — spe + oc_hitbon, +2 for a blessed weapon
// against undead/demons.  (The spear-vs-kebabable, trident-vs-swimmer,
// pick-axe-vs-xorn and artifact bonuses need tables this port doesn't carry.)
// It is added to tmp BEFORE the to-hit roll and subtracted after, so leaving it
// out changed whether an armed monster connects.
const hitval_mm = hitval;   // js/weapon.js owns the complete weapon.c:149

// C ref: include/monst.h:251 helpless(mon) = msleeping || !mcanmove.
function helpless_mm(mtmp) {
    return !!(mtmp && (mtmp.msleeping || !mtmp.mcanmove));
}

// mtrapped_in_pit() now lives in js/mhitu.js (its C home, mhitu.c:467); the
// copy that used to be here had no hero arm (u.utrap / u.utraptype).

// C ref: do_name.c a_monnam(mtmp) — "a <species>" (the given name alone when
// the monster has one).
function a_monnam(mtmp) {
    const given = mtmp?.mgivenname || mtmp?.mextra?.mgivenname;
    if (given) return given;
    const s = mon_species(mtmp);
    return (/^[aeiouAEIOU]/.test(s) ? 'an ' : 'a ') + s;
}

// ── mhitm.c:644 hitmm ────────────────────────────────────────────────────────
// pre_mm_attack() first, then the "X <verb> Y." line (when visible), THEN
// mdamagem() — so the hit message precedes any death message.  Neither
// consumes RNG.  When not visible the hero may instead hear it (noises()).
// shade_miss() (a shade shrugging off a non-silver/non-blessed hit, which
// BYPASSES mdamagem and its d() roll) is not modelled.
async function hitmm(magr, mdef, mattk, mwep, dieroll) {
    pre_mm_attack(magr, mdef);
    const compat = !magr.mcan ? could_seduce(magr, mdef, mattk) : 0;
    if (mm_visible(magr, mdef)) {
        if (compat) {
            await emitMMmsg(`${Monnam_mm(magr)}`
                + ` ${mdef.mcansee ? 'smiles at' : 'talks to'}`
                + ` ${mon_nam_mm(mdef)}`
                + ` ${compat === 2 ? 'engagingly' : 'seductively'}.`);
        } else if (mattk.aatyp === AT_TENT) {
            await emitMMmsg(`${s_suffix_mm(Monnam_mm(magr))} tentacles suck`
                + ` ${mon_nam_mm(mdef)}.`);
        } else {
            await emitMMmsg(`${Monnam_mm(magr)} ${hit_verb(mattk.aatyp)}`
                + ` ${mon_nam_mm(mdef)}.`);
        }
    } else {
        await noises(magr, mattk);
    }
    return await mdamagem(magr, mdef, mattk, mwep, dieroll);
}

// ── mhitm.c:76 missmm ────────────────────────────────────────────────────────
async function missmm(magr, mdef, mattk) {
    pre_mm_attack(magr, mdef);
    if (mm_visible(magr, mdef)) {
        const seduces = !magr.mcan && could_seduce(magr, mdef, mattk);
        await emitMMmsg(`${Monnam_mm(magr)}`
            + ` ${seduces ? 'pretends to be friendly to' : 'misses'}`
            + ` ${mon_nam_mm(mdef)}.`);
    } else {
        await noises(magr, mattk);
    }
}

// ── mhitm.c:293 mattackm ─────────────────────────────────────────────────────
// A monster attacks another monster.  Returns M_ATTK_*.
export async function mattackm(magr, mdef) {
    if (!magr || !mdef) return M_ATTK_MISS;
    if (helpless_mm(magr)) return M_ATTK_MISS;         // mhitm.c:311
    if (DEADMONSTER(magr) || DEADMONSTER(mdef)) return M_ATTK_MISS;

    const pa = permonst(magr), pd = permonst(mdef);

    // Grid bugs cannot attack at an angle.                  mhitm.c:316
    if (pa?.name === 'grid bug' && magr.mx !== mdef.mx && magr.my !== mdef.my)
        return M_ATTK_MISS;

    // tmp = find_mac(mdef) + magr->m_lev, +4 if the defender is confused or
    // helpless (which also WAKES it), +1 for elf-vs-orc.  Both were dismissed
    // as "never apply to the modeled matchups"; a sleeping defender is the
    // normal case for a monster the hero hasn't disturbed, and the +4 flips the
    // `tmp > dieroll` test — i.e. it decides whether mdamagem() rolls at all.
    let tmpBase = find_mac(mdef) + monLev(magr);
    if (mdef.mconf || helpless_mm(mdef)) {             // mhitm.c:322
        tmpBase += 4;
        mdef.msleeping = 0;
    }

    // A hiding defender is flushed out by being attacked.   mhitm.c:328
    if (mdef.mundetected) {
        mdef.mundetected = 0;
        newsym(mdef.mx, mdef.my);
        if (mm_can_see_mon(mdef))
            await emitMMmsg(`Suddenly, you notice ${a_monnam(mdef)}.`);
    }

    if (is_elf_flag(pa) && is_orc_flag(pd)) tmpBase++;  // mhitm.c:353

    gv_vis = mm_visible(magr, mdef);                   // mhitm.c:358
    gs_skipdrin = false;                               // mhitm.c:372

    // magr->mlstmv = svm.moves — flags that the aggressor has acted this round
    // (the dog_move return-attack gate at dogmove.c:1159 reads the *defender's*
    // mlstmv, so keeping this current matters for the bounce-back attack).
    magr.mlstmv = game.moves;

    let struck = 0;
    const res = new Array(NATTK).fill(M_ATTK_MISS);

    for (let i = 0; i < NATTK; i++) {
        res[i] = M_ATTK_MISS;

        // target might no longer be there (after the first attack)
        if (i > 0 && (m_at(mdef.mx, mdef.my) !== mdef
                      || DEADMONSTER(magr) || DEADMONSTER(mdef)))
            continue;

        const mattk = getmattk(magr, mdef, i, res);

        // mhitm.c:387 — a mind flayer that already found a headless target
        // stops repeating its tentacle attacks (skips the to-hit rnd too).
        if (gs_skipdrin && mattk.aatyp === AT_TENT && mattk.adtyp === AD_DRIN)
            continue;

        let strike = 0, attk = 1;
        let mwep = null;
        let dieroll = 0;
        let tmp = tmpBase;

        switch (mattk.aatyp) {
        case AT_WEAP:
        case AT_CLAW:
        case AT_KICK:
        case AT_BITE:
        case AT_STNG:
        case AT_TUCH:
        case AT_BUTT:
        case AT_TENT: {
            if (mattk.aatyp === AT_WEAP) {
                if (distmin(magr.mx, magr.my, mdef.mx, mdef.my) > 1) {
                    // thrwmm(): a ranged volley with its own multishot/hit
                    // rolls — not modelled, so decline without RNG.
                    strike = 0; attk = 0;
                    break;
                }
                // C ref: mhitm.c:406 — an armed aggressor wields its weapon
                // before striking.  mon_wield_item consumes no RNG; when it
                // actually wields (returns 1) mattackm returns M_ATTK_MISS
                // (the turn was spent wielding).
                if (magr.weapon_check === NEED_WEAPON || !MON_WEP_MM(magr)) {
                    magr.weapon_check = NEED_HTH_WEAPON;
                    if (await mon_wield_item_mm(magr)) return M_ATTK_MISS;
                }
                // possibly_unwield(magr, FALSE) — only fires for a monster
                // wielding something that isn't a weapon; not modelled.
                mwep = MON_WEP_MM(magr);
                if (mwep) {
                    if (mm_visible(magr, mdef)) await mswingsm(magr, mdef, mwep);
                    tmp += hitval_mm(mwep, mdef);      // mhitm.c:412
                }
            }
            if (mattk.aatyp === AT_KICK && mtrapped_in_pit(magr))
                continue;                              // mhitm.c:419
            // Nymph that teleported away on its first attack?
            if (distmin(magr.mx, magr.my, mdef.mx, mdef.my) > 1)
                continue;                              // mhitm.c:423
            // The cockatrice-instinct guard below it in C is unreachable: mwep
            // is only ever set on the AT_WEAP arm, and the guard requires
            // aatyp != AT_WEAP.
            dieroll = rnd(20 + i);                     // mhitm.c:441
            strike = (tmp > dieroll) ? 1 : 0;
            if (mwep) tmp -= hitval_mm(mwep, mdef);    // don't accumulate
            if (strike) {
                if (unsolid_flag(pd) && await failed_grab(magr, mdef, mattk)) {
                    strike = 0;
                    break;
                }
                res[i] = await hitmm(magr, mdef, mattk, mwep, dieroll);
                // The black/brown pudding clone_mon() division is not modelled.
            } else {
                await missmm(magr, mdef, mattk);
            }
            break;
        }

        case AT_HUGS:                                  // mhitm.c:466
            strike = (i >= 2 && res[i - 1] === M_ATTK_HIT
                      && res[i - 2] === M_ATTK_HIT) ? 1 : 0;
            if (strike) {
                if (await failed_grab(magr, mdef, mattk)) strike = 0;
                else res[i] = await hitmm(magr, mdef, mattk, null, 0);
            }
            break;

        case AT_GAZE:                                  // mhitm.c:483
            // gazemm() itself is not modelled, but C leaves attk == 1 here, so
            // the defender still gets its passive; the previous `default:` arm
            // zeroed attk and swallowed passivemm's rolls.
            strike = 0;
            break;

        case AT_ENGL:                                  // mhitm.c:500
            if (pd?.name === 'shade') { strike = 0; break; }
            if (mdef === game.u?.usteed) { strike = 0; break; }
            if (distmin(magr.mx, magr.my, mdef.mx, mdef.my) > 1) continue;
            strike = (tmp > rnd(20 + i)) ? 1 : 0;
            if (strike) {
                // gulpmm() (swallow + digestion) is not modelled; failed_grab
                // still cancels an unsolid target faithfully.
                if (await failed_grab(magr, mdef, mattk)) strike = 0;
            } else {
                await missmm(magr, mdef, mattk);
            }
            break;

        case AT_EXPL:                                  // mhitm.c:497
            /* D: Prevent explosions from a distance */
            if (distmin(magr.mx, magr.my, mdef.mx, mdef.my) > 1) continue;
            res[i] = await explmm(magr, mdef, mattk);
            if (res[i] === M_ATTK_MISS) { strike = 0; attk = 0; }
            else strike = 1;                           /* automatic hit */
            break;

        case AT_BREA:
        case AT_SPIT:                                  // mhitm.c:527
            // Ranged attacks aren't allowed at point blank range, which is the
            // only distance mon-vs-mon melee reaches here; breamm()/spitmm()
            // for the non-adjacent case aren't modelled.
            strike = 0; attk = 0;
            break;

        default: /* AT_NONE, AT_MAGC, ... — no attack */
            strike = 0; attk = 0;
            break;
        }

        // passivemm: reached when attk && aggressor still alive && adjacent.
        if (attk && !(res[i] & M_ATTK_AGR_DIED)
            && distmin(magr.mx, magr.my, mdef.mx, mdef.my) <= 1) {
            res[i] = await passivemm(magr, mdef, strike,
                                     (res[i] & M_ATTK_DEF_DIED), mwep);
        }

        if (res[i] & M_ATTK_DEF_DIED) return res[i];
        if (res[i] & M_ATTK_AGR_DIED) return res[i];
        if ((res[i] & M_ATTK_AGR_DONE) || helpless_mm(magr)) return res[i];
        // mon_offmap(mdef) (knocked into a level teleporter) isn't modelled.
        if (res[i] & M_ATTK_HIT) struck = 1;
    }

    return struck ? M_ATTK_HIT : M_ATTK_MISS;
}

// ===========================================================================
// mhitm.c: the remaining top-level functions, translated.  APPEND-ONLY —
// nothing above this line calls anything below it.
//
// Two model gaps that these translations run into and do NOT paper over:
//   * remove_monster()/place_monster() are C's svl.level.monsters[x][y] GRID
//     ops.  This port has no grid: js/display.js:327 m_at() scans the fmon
//     chain (game.level.monsters) and skips only mridden steeds.  So gulpmm's
//     "leave the defender in the chain but off the screen" state cannot be
//     represented; the local helpers below carry the coordinate half and the
//     comment names what is missing.
//   * js/mhitm_ad.js mhitm_ad_blnd() writes mhm.damage unconditionally, but
//     uhitm.c:3009 guards it (`if (mhm) mhm->damage = 0;`) precisely because
//     gazemm() passes 0.  gazemm() below therefore hands it a scratch mhm; the
//     real fix is the missing null guard in js/mhitm_ad.js.
// ===========================================================================

// C ref: monattk.h:53 AD_BLND (11) — the Archon / yellow-light blinding gaze.
const AD_BLND = 11;
// C ref: monattk.h:24 AD_MAGM, :66 AD_RUST, :84 AD_CORR, :89 AD_RBRE.
const AD_MAGM = 1, AD_RUST = 24, AD_CORR = 42, AD_RBRE = 242;
// C ref: defsym.h:309 MONSYM(13, 'm', MIMIC, S_MIMIC).
const S_MIMIC = 13;
// C ref: monst.h:52 M_AP_NOTHING.
const M_AP_NOTHING = 0;
// C ref: monflag.h:182 MZ_HUGE.
const MZ_HUGE = 4;

// C ref: mondata.h:57 is_whirly(ptr) — a vortex, or the air elemental.
function is_whirly_mm(ptr) {
    return ptr?.mcls === S_VORTEX || ptr?.name === 'air elemental';
}
// C ref: mondata.h:59 flaming(ptr) — fire vortex / flaming sphere /
// fire elemental / salamander.
const FLAMING_NAMES = new Set(['fire vortex', 'flaming sphere',
                               'fire elemental', 'salamander']);
function flaming_mm(ptr) { return !!ptr && FLAMING_NAMES.has(ptr.name); }
// C ref: mondata.h:71/73 digests(ptr) / enfolds(ptr) — an AT_ENGL slot whose
// damage type is AD_DGST (purple worm) or AD_WRAP (trapper/lurker above).
function digests_mm(mon) {
    return mattk_list(mon).some((a) => a[0] === AT_ENGL && a[1] === AD_DGST);
}
function enfolds_mm(mon) {
    return mattk_list(mon).some((a) => a[0] === AT_ENGL && a[1] === AD_WRAP);
}
// C ref: mondata.h:29 passes_walls(ptr) — M1_WALLWALK.
function passes_walls_mm(ptr) { return (mflags1_of(ptr) & M1_WALLWALK) !== 0; }

// C ref: mondata.c:248 resists_blnd(mon).  The resists_blnd_by_arti() (Sunsword
// wielder) arm is absent: js/artifact.js exports no defends() predicate.
function resists_blnd_mm(mon) {
    const ptr = permonst(mon);
    if (mon?.mblinded || !mon?.mcansee || !haseyes(ptr) || mon?.msleeping)
        return true;
    return mattk_list(mon).some((a) => (a[0] === AT_EXPL || a[0] === AT_GAZE)
                                        && a[1] === AD_BLND);
}

// C ref: mondata.c:215 resists_magm(mon) — gray dragons, Angels, the Oracle,
// Yeenoghu, plus a wielded/worn ANTIMAGIC source.  The item half needs
// objects[].oc_oprop and defends_when_carried(); only the species half is
// modelled, so a monster carrying a cloak of magic resistance answers FALSE.
function resists_magm_mm(mon) {
    const ptr = permonst(mon);
    return attacktype_ad(mon, AD_MAGM) || ptr?.name === 'baby gray dragon'
        || attacktype_ad(mon, AD_RBRE);
}

// C ref: rm.h remove_monster(x,y) — clears svl.level.monsters[x][y].  See the
// header note: this port has no such grid, so there is nothing to clear.
function mm_remove_monster(x, y) { void x; void y; }
// C ref: steed.c:898 place_monster(mon, x, y) — the grid write plus the
// coordinate write.  Only the coordinates exist here.
function mm_place_monster(mon, x, y) { mon.mx = x; mon.my = y; mon.mstate = 0; }

// C ref: mon.c minliquid(mtmp) / trap.c mintrap(mtmp, flags) — both can kill
// the monster that just moved and both draw RNG.  Neither has an exported port
// (js/mon.js:591 and js/dig.js:900 hold private partial copies), so gulpmm's
// "aggressor moves onto the defender's square and dies there" tail can't fire.
function minliquid_mm(_mon) { return false; }        /* mon.c */
function mintrap_mm(_mon, _flags) { return 0; }      /* trap.c; Trap_Killed_Mon == 2 */
const Trap_Killed_Mon = 2;

// C ref: mhitm.c:736 gazemm(magr, mdef, mattk) — an AT_GAZE attack against
// another monster.  Returns the same values as mdamagem().
export async function gazemm(magr, mdef, mattk) {
    let buf;
    /* an Archon's gaze affects target even if Archon itself is blinded */
    const archon = (permonst(magr)?.name === 'Archon'
                    && mattk.adtyp === AD_BLND),
          altmesg = (archon && !magr.mcansee);

    /* bring target out of hiding even if hero doesn't see it happen (this
       is already done in pre_mm_attack() and shouldn't be needed here) */
    if (permonst(mdef)?.mcls === S_MIMIC && (mdef.m_ap_type | 0) !== M_AP_NOTHING) {
        const { seemimicLocal } = await import('./uhitm.js');
        seemimicLocal(mdef);
    }
    mdef.mundetected = 0;

    if (gv_vis) {
        const { Adjmonnam } = await import('./do_name.js');
        buf = `${altmesg ? Adjmonnam(magr, 'blinded') : Monnam(magr)} gazes ${
            altmesg ? 'toward' : 'at'}`;
        await emitMMmsg(`${buf} ${mm_can_see_mon(mdef) ? the_monnam(mdef)
                                                       : 'something'}...`);
    }

    if (magr.mcan || !mdef.mcansee
        || (archon ? resists_blnd_mm(mdef) : !magr.mcansee)
        || (magr.minvis && !perceives_flag(permonst(mdef))) || mdef.msleeping) {
        if (gv_vis && mm_can_see_mon(mdef))
            await emitMMmsg('but nothing happens.');
        return M_ATTK_MISS;
    }
    const { mon_reflects } = await import('./muse.js');
    /* call mon_reflects 2x, first test, then, if visible, print message */
    if (permonst(magr)?.name === 'Medusa' && await mon_reflects(mdef, null)) {
        if (mm_can_see_mon(mdef))
            await mon_reflects(mdef, 'The gaze is reflected away by %s %s.');
        if (mdef.mcansee) {
            if (await mon_reflects(magr, null)) {
                if (mm_can_see_mon(magr))
                    await mon_reflects(magr,
                                       'The gaze is reflected away by %s %s.');
                return M_ATTK_MISS;
            }
            if (magr.minvis && !perceives_flag(permonst(magr))) {
                if (mm_can_see_mon(magr)) {
                    await emitMMmsg(`${Monnam(magr)} doesn't seem to notice that ${
                        mhis_mm(magr)} gaze was reflected.`);
                }
                return M_ATTK_MISS;
            }
            if (mm_can_see_mon(magr))
                await emitMMmsg(`${Monnam(magr)} is turned to stone!`);
            await monstone_mm(magr);
            if (!DEADMONSTER(magr))
                return M_ATTK_MISS;
            return M_ATTK_AGR_DIED;
        }
    } else if (archon) {
        /* C passes (struct mhitm_data *) 0; see the header note — the JS
           handler has no null guard, so it gets a scratch struct whose
           damage field nothing reads back. */
        const { mhitm_ad_blnd } = await import('./mhitm_ad.js');
        await mhitm_ad_blnd(magr, mattk, mdef,
                            { damage: 0, hitflags: M_ATTK_MISS, permdmg: 0,
                              specialdmg: 0, dieroll: 0, done: false },
                            mm_ops());
        /* an Archon's blinding radiance also stuns;
           this is different from the way the hero gets stunned because
           a stunned monster recovers randomly instead of via countdown;
           both cases make an effort to prevent the target from being
           continuously stunned due to repeated gaze attacks */
        if (rn2(2))
            mdef.mstun = 1;
    }

    return await mdamagem(magr, mdef, mattk, null, 0);
}

// C ref: do_name.c mhis(mon) — the possessive pronoun.  js/mhitm.js already
// carries is_neuter_flag for exactly this decision elsewhere.
function mhis_mm(mtmp) {
    const ptr = permonst(mtmp);
    if (is_neuter_flag(ptr)) return 'its';
    return mtmp?.female ? 'her' : 'his';
}

// C ref: mhitm.c:807 engulf_target(magr, mdef) — may magr swallow mdef?
export function engulf_target(magr, mdef) {
    const uatk = is_youmonst_mm(magr), udef = is_youmonst_mm(mdef);
    const pa = permonst(magr), pd = permonst(mdef);

    /* can't swallow something that's too big */
    if ((pd?.msize ?? MZ_MEDIUM) >= MZ_HUGE
        || ((pa?.msize ?? MZ_MEDIUM) < (pd?.msize ?? MZ_MEDIUM)
            && !is_whirly_mm(pa)))
        return false;

    /* can't (move to) swallow if trapped. TODO: could do some? */
    if (mdef.mtrapped || magr.mtrapped)
        return false;

    /* if attacker is phasing in solid rock and defender can't move there,
       or vice versa, don't allow engulf to succeed; otherwise expelling
       might not be able to place attacker and defender both back on map */
    const dx = udef ? game.u.ux : mdef.mx, dy = udef ? game.u.uy : mdef.my;
    let lev = game.level?.at(dx, dy);
    if (!(udef ? Passes_walls_u() : passes_walls_mm(pd))
        && (IS_OBSTRUCTED(lev?.typ) || closed_door_mm(dx, dy)
            || IS_TREE(lev?.typ)
            /* not passes_bars(); engulfer isn't squeezing through */
            || (lev?.typ === IRONBARS && !is_whirly_mm(pa))))
        return false;
    const ax = uatk ? game.u.ux : magr.mx, ay = uatk ? game.u.uy : magr.my;
    lev = game.level?.at(ax, ay);
    if (!(uatk ? Passes_walls_u() : passes_walls_mm(pa))
        && (IS_OBSTRUCTED(lev?.typ) || closed_door_mm(ax, ay)
            || IS_TREE(lev?.typ)
            || (lev?.typ === IRONBARS && !is_whirly_mm(pd))))
        return false;

    return true;
}

// C ref: mhitm.c:811 `magr == &gy.youmonst` — mhitm.js never dispatches with a
// hero combatant (mattackm() is monster-vs-monster only), so the youmonst arms
// are reachable only through engulf_target()'s other callers (uhitm.c/mhitu.c).
function is_youmonst_mm(mon) { return mon === game.youmonst || mon?.isyou === true; }
// C ref: you.h Passes_walls — the hero's intrinsic/extrinsic wall-walking.
function Passes_walls_u() { return !!game.u?.uprops?.Passes_walls; }
// C ref: rm.h closed_door(x, y) — IS_DOOR && (D_CLOSED | D_LOCKED).
function closed_door_mm(x, y) {
    const loc = game.level?.at(x, y);
    return !!loc && loc.typ === DOOR && ((loc.doormask | 0) & (D_CLOSED | D_LOCKED)) !== 0;
}

// C ref: mhitm.c:849 gulpmm(magr, mdef, mattk) — an AT_ENGL attack.  Returns
// the same values as mattackm().
export async function gulpmm(magr, mdef, mattk) {
    if (!engulf_target(magr, mdef))
        return M_ATTK_MISS;

    if (gv_vis) {
        await emitMMmsg(`${Monnam(magr)} ${
            digests_mm(magr) ? 'swallows'
            : enfolds_mm(magr) ? 'encloses'
              : 'engulfs'} ${the_monnam(mdef)}.`);
    }
    if (!flaming_mm(permonst(magr))) {
        const { snuff_lit } = await import('./apply.js');
        for (const obj of (mdef.minvent || []))
            await snuff_lit(obj);
    }

    if (is_vampshifter_mm(mdef)
        && newcham(mdef, monster_by_pmidx(mdef.cham))) {
        if (gv_vis) {
            /* 'it' -- previous form is no longer available and
               using that would be excessively verbose */
            await emitMMmsg(`${Monnam(magr)} expels ${
                mm_can_see_mon(mdef) ? 'it' : 'something'}.`);
            if (mm_can_see_mon(mdef)) {
                const { x_monnam } = await import('./uhitm.js');
                await emitMMmsg(`It turns into ${
                    x_monnam(mdef, /*ARTICLE_A*/ 2, null,
                             SUPPRESS_NAME | SUPPRESS_IT | SUPPRESS_INVISIBLE,
                             false)}.`);
            }
        }
        return M_ATTK_HIT; /* bypass mdamagem() */
    }

    /*
     *  All of this manipulation is needed to keep the display correct.
     *  There is a flush at the next pline().
     */
    const ax = magr.mx, ay = magr.my;
    let dx = mdef.mx, dy = mdef.my;
    /*
     *  Leave the defender in the monster chain at its current position,
     *  but don't leave it on the screen.  Move the aggressor to the
     *  defender's position.
     */
    mm_remove_monster(dx, dy);
    mm_remove_monster(ax, ay);
    mm_place_monster(magr, dx, dy);
    newsym(ax, ay); /* erase old position */
    newsym(dx, dy); /* update new position */

    game.mswallower = magr; /* corpse_chance() wants this */
    let status = await mdamagem(magr, mdef, mattk, null, 0);
    game.mswallower = null;  /* reset */

    if ((status & (M_ATTK_AGR_DIED | M_ATTK_DEF_DIED))
        === (M_ATTK_AGR_DIED | M_ATTK_DEF_DIED)) {
        /* both died -- do nothing  */
    } else if (status & M_ATTK_DEF_DIED) { /* defender died */
        /* [5.0] relmon() only removes the dying monster from the grid when it
           is the one standing there, so magr is still at mdef's former spot.
           One fixup remains: an inhospitable spot sends magr back. */
        const { goodpos } = await import('./teleport.js');
        if (!goodpos(dx, dy, magr, MM_IGNOREWATER)) {
            if (m_at(dx, dy) === magr) {
                mm_remove_monster(dx, dy);
                newsym(dx, dy);
            }
            dx = ax; dy = ay; /* magr's spot at start of the attack */
        }
        if (m_at(dx, dy) !== magr) {
            mm_place_monster(magr, dx, dy);
            newsym(dx, dy);
        }
        /* aggressor moves to <dx,dy> and might encounter trouble there */
        const { t_at } = await import('./trap.js');
        if (minliquid_mm(magr)
            || (t_at(dx, dy)
                && mintrap_mm(magr, 0 /*NO_TRAP_FLAGS*/) === Trap_Killed_Mon))
            status |= M_ATTK_AGR_DIED;
    } else if (status & M_ATTK_AGR_DIED) { /* aggressor died */
        mm_place_monster(mdef, dx, dy);
        newsym(dx, dy);
    } else {                              /* both alive, put them back */
        if (cansee(dx, dy)) {
            await emitMMmsg(`${Monnam(mdef)} is ${
                digests_mm(magr) ? 'regurgitated'
                : enfolds_mm(magr) ? 'released'
                  : 'expelled'}!`);
        }

        mm_remove_monster(dx, dy);
        mm_place_monster(magr, ax, ay);
        mm_place_monster(mdef, dx, dy);
        newsym(ax, ay);
        newsym(dx, dy);
    }

    return status;
}

// C ref: hack.h:1016-1022 SUPPRESS_* flags used by gulpmm's x_monnam() call.
const SUPPRESS_IT = 0x01, SUPPRESS_INVISIBLE = 0x02, SUPPRESS_NAME = 0x20;
// C ref: mkobj.h MM_IGNOREWATER — goodpos() flag.
const MM_IGNOREWATER = 0x2000;
// C ref: mondata.h is_vampshifter(mon) — a vampire in another form (its cham
// index names a vampire).  mdef.cham is the shapeshifter's base pmidx.
function is_vampshifter_mm(mon) {
    if (mon?.cham == null || mon.cham < 0) return false;
    const base = monster_by_pmidx(mon.cham);
    return !!base && /vampire|Vlad/.test(base.name || '');
}

// C ref: mhitm.c:1122 mon_poly(magr, mdef, dmg) — an AD_POLY hit landed;
// returns the damage that still applies (0 when the target changed shape).
export async function mon_poly(magr, mdef, dmg) {
    const freaky = ' undergoes a freakish metamorphosis';
    const oldform = mdef.data;

    if (is_youmonst_mm(mdef)) {
        /* hero defender: mhitm.js never dispatches this way, so the arm is
           here for mon_poly()'s other callers (uhitm.c/mhitu.c/zap.c). */
        if (Antimagic_u()) {
            await shieldeff_mm(game.u.ux, game.u.uy);
        } else if (Unchanging_u()) {
            /* just take a little damage */
        } else {
            const u = game.u;
            /* system shock might take place in polyself() */
            if ((u.ulycn ?? NON_PM) === NON_PM) {
                await emitMMmsg('You are subjected to a freakish metamorphosis.');
                const { polyself } = await import('./polyself.js');
                await polyself(0 /*POLY_NOFLAGS*/);
            } else if (u.umonnum !== u.ulycn) {
                await emitMMmsg('You feel an unnatural urge coming on.');
                await you_were_mm();
            } else {
                await emitMMmsg('You feel a natural urge coming on.');
                await you_unwere_mm(false);
            }
            dmg = 0;
        }
    } else {
        const Before = Monnam(mdef);
        const { resist } = await import('./zap.js');

        if (resists_magm_mm(mdef)) {
            /* Magic resistance */
            if (gv_vis) await shieldeff_mon_mm(mdef);
        } else if (resist(mdef, WAND_CLASS_MM, 0, /*TELL*/ 1)) {
            /* general resistance to magic... */
        } else if (!rn2(25) && (mdef.cham ?? NON_PM) === NON_PM
                   && (mdef.mcan
                       || pm_to_cham_mm(mdef) !== NON_PM)) {
            /* system shock; this variation takes away half of mon's HP
               rather than kill outright */
            if (gv_vis)
                await emitMMmsg(`${Before} shudders!`);

            dmg += Math.trunc(((mdef.mhpmax | 0) + 1) / 2);
            mdef.mhp -= dmg;
            dmg = 0;
            if (DEADMONSTER(mdef)) {
                if (is_youmonst_mm(magr))
                    await xkilled_mm(mdef);
                else
                    await monkilled_mm(mdef, AD_RBRE);
            }
        } else if (newcham(mdef, null)) {
            if (gv_vis) { /* either seen or adjacent */
                const was_seen = Before.toLowerCase() !== 'it',
                      verbosely = !!game.flags?.verbose || !was_seen;

                if (mm_can_see_mon(mdef)) {
                    const { x_monnam } = await import('./uhitm.js');
                    await emitMMmsg(`${Before}${verbosely ? freaky : ''}${
                        verbosely ? ' and' : ''} turns into ${
                        x_monnam(mdef, /*ARTICLE_A*/ 2, null,
                                 SUPPRESS_NAME | SUPPRESS_IT | SUPPRESS_INVISIBLE,
                                 false)}.`);
                } else if (was_seen || is_youmonst_mm(magr)) {
                    await emitMMmsg(`${Before}${freaky}${
                        !was_seen ? '' : ' and disappears'}.`);
                }
            }
            dmg = 0;
            if (can_teleport_mm(permonst(magr))) {
                const { rloc, tele_restrict } = await import('./teleport.js');
                if (is_youmonst_mm(magr))
                    await tele_mm();
                else if (!tele_restrict(magr))
                    await rloc(magr, /*RLOC_MSG*/ 1);
            }
        } else {
            if (gv_vis && game.flags?.verbose)
                await emitMMmsg('Nothing seems to happen.'); /* nothing_happens */
        }
    }
    /* when a transformation has happened, can't attack again for poly
       effect during next turn or two; not enforced for poly'd hero */
    if (mdef.data !== oldform && !is_youmonst_mm(magr))
        magr.mspec_used = (magr.mspec_used | 0) + rnd(2);

    return dmg;
}

// C ref: hack.h NON_PM (-1) and objclass.h WAND_CLASS.
const NON_PM = -1, WAND_CLASS_MM = 8;
// C ref: makemon.c pm_to_cham(mndx) — js/makemon.js:2799 keys off the pmidx, so
// route through permonst() for a pet's non-makemon index.
function pm_to_cham_mm(mon) {
    const p = permonst(mon);
    return (p?.pmidx != null) ? pm_to_cham(p.pmidx) : NON_PM;
}
// C ref: you.h Antimagic / Unchanging.  polyself.c you_were()/you_unwere() and
// teleport.c tele() have no export; mon.c xkilled() likewise (js/uhitm.js keeps
// a private killed()).  The hero-defender arms are unreachable from mhitm.js.
function Antimagic_u() { return !!game.u?.uprops?.Antimagic; }
function Unchanging_u() { return !!game.u?.uprops?.Unchanging; }
async function you_were_mm() { /* polyself.c you_were() */ }
async function you_unwere_mm(_upgrade) { /* polyself.c you_unwere() */ }
async function tele_mm() { /* teleport.c tele() */ }
async function xkilled_mm(mdef) { return await killMonster(mdef); }
// C ref: display.c shieldeff(x, y) / shieldeff_mon(mon) — the reflective flash.
async function shieldeff_mm(x, y) {
    const { shieldeff } = await import('./display.js');
    await shieldeff(x, y);
}
async function shieldeff_mon_mm(mon) { await shieldeff_mm(mon.mx, mon.my); }
// C ref: mondata.h:82 can_teleport(ptr) — M1_TPORT.
function can_teleport_mm(ptr) { return (mflags1_of(ptr) & M1_TPORT) !== 0; }

// C ref: mhitm.c:1260 rustm(mdef, obj) — the defender's passive erosion attack
// applied to the attacker's weapon (or bare hand's glove).  AD_ACID and AD_ENCH
// are handled in passivemm()/passiveum() instead.
export async function rustm(mdef, obj) {
    let dmgtyp = ERODE_NONE_MM, chance = 1;

    if (!mdef || !obj)
        return; /* just in case */
    if (attacktype_ad(mdef, AD_CORR)) {
        dmgtyp = ERODE_CORRODE_MM;
    } else if (attacktype_ad(mdef, AD_RUST)) {
        dmgtyp = ERODE_RUST_MM;
    } else if (attacktype_ad(mdef, AD_FIRE)
               /* steam vortex: fire resist applies, fire damage doesn't */
               && permonst(mdef)?.name !== 'steam vortex') {
        dmgtyp = ERODE_BURN_MM;
        chance = 6;
    }

    if (dmgtyp !== ERODE_NONE_MM && !rn2(chance)) {
        const { erode_obj } = await import('./trap.js');
        await erode_obj(obj, null, dmgtyp, EF_GREASE_MM | EF_VERBOSE_MM);
    }
}

// C ref: obj.h:454 ERODE_NONE(-1)/ERODE_BURN(0)/ERODE_RUST(1)/ERODE_CORRODE(3)
// and the EF_* erode_obj() flags (js/const.js:1120/2244/2254 hold the same).
const ERODE_NONE_MM = -1, ERODE_BURN_MM = 0, ERODE_RUST_MM = 1,
      ERODE_CORRODE_MM = 3, EF_GREASE_MM = 0x01, EF_VERBOSE_MM = 0x04;

// C ref: mhitm.c:1461 xdrainenergym(mon, givemsg) — a landed drain-energy
// attack uses up the target's spell/breath reserve.
export async function xdrainenergym(mon, givemsg) {
    if ((mon.mspec_used | 0) < 20 /* limit draining */
        && (attacktype_at(mon, AT_MAGC) || attacktype_at(mon, AT_BREA))) {
        mon.mspec_used = (mon.mspec_used | 0) + d(2, 2);
        if (givemsg)
            await emitMMmsg(`${Monnam(mon)} seems lethargic.`);
    }
}

// C ref: mhitm.c:1475 attk_protection(aatyp).  The faithful port already lives
// in this file as attk_protection_mm() (mhitm.js:577) — its ~0L case returns -1,
// which IS C's value — so this is an alias, not a second copy.
export const attk_protection = attk_protection_mm;
