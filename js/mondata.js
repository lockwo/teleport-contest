// mondata.js — C ref: src/mondata.c.
//
// The mondata.h flag predicates themselves live in the generated
// js/monflags_data.js (mflags1/2/3) and js/monattk_data.js (mattk[] +
// attacktype/dmgtype/is_armed).  This file is for the mondata.c FUNCTIONS that
// compute something from those tables.

import { mattk_of, AT_NONE, AT_BOOM, AT_CLAW, AT_BITE, AT_KICK, AT_BUTT,
    AT_TUCH, AT_STNG, AT_HUGS, AT_ENGL, AT_TENT, AT_WEAP, AT_ANY,
    AT_SPIT, AT_BREA, AT_EXPL, AT_GAZE, AT_MAGC,
    AD_FIRE, AD_COLD, AD_ELEC, AD_ACID, AD_PHYS, AD_DCAY, AD_RUST,
    AD_DRST, AD_DRLI, AD_STON, AD_DRDX, AD_DRCO, AD_WERE, AD_BLND }
    from './monattk_data.js';
import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { mflags2_of, humanoid, is_undead_flag, is_demon_flag, is_neuter_flag,
    M2_STRONG, M2_PNAME } from './monflags_data.js';
import { monster_by_pmidx } from './makemon.js';
import { NON_PM, PRONOUN_NO_IT, PRONOUN_HALLU,
    M_SEEN_NOTHING, M_SEEN_MAGR, M_SEEN_FIRE, M_SEEN_COLD, M_SEEN_SLEEP,
    M_SEEN_DISINT, M_SEEN_ELEC, M_SEEN_POISON, M_SEEN_ACID, M_SEEN_REFL,
    FIRE_RES, COLD_RES, SLEEP_RES, DISINT_RES, SHOCK_RES, POISON_RES,
    ACID_RES, STONE_RES, ANTIMAGIC, REFLECTING } from './const.js';
// mmove_of / DEADMONSTER / m_canseeu / canspotmon / defends are all `export
// function` declarations, so they are hoisted at module instantiation and are
// safe to name across the mondata <-> mon/monmove/uhitm/artifact import cycles
// (a module-scope `const` initialised from one of these would NOT be — see
// [[_mktrap_victim TDZ is real]]).  Nothing below runs at module-eval time.
import { mmove_of, DEADMONSTER } from './mon.js';
import { m_canseeu } from './monmove.js';
import { canspotmon } from './uhitm.js';
import { defends, defends_when_carried } from './artifact.js';

// C ref: monflag.h MR_* resistance bits (permonst.mresists).
const MR_FIRE = 0x01, MR_COLD = 0x02, MR_ELEC = 0x10, MR_ACID = 0x40;

// C ref: monst.h resists_*(mon) == Resists_Elem(mon, X) ==
// (mresists | mextrinsics | mintrinsics) & X.  Monster extrinsics/intrinsics
// (worn gear, eaten corpses) are not tracked on our monster record, so these
// read the species bit only.
const resists_bit = (mon, bit) => (((mon?.data?.mresists ?? 0) & bit) !== 0);
export const resists_fire = (mon) => resists_bit(mon, MR_FIRE);
export const resists_cold = (mon) => resists_bit(mon, MR_COLD);
export const resists_elec = (mon) => resists_bit(mon, MR_ELEC);
export const resists_acid = (mon) => resists_bit(mon, MR_ACID);

// C ref: mondata.h completelyburns/completelyrots/completelyrusts — the golems
// a passive element destroys outright.
const BURNS_NAMES = new Set(['paper golem', 'straw golem']);
const ROTS_NAMES = new Set(['wood golem', 'leather golem']);
export const completelyburns = (ptr) => BURNS_NAMES.has(ptr?.name);
export const completelyrots = (ptr) => ROTS_NAMES.has(ptr?.name);
export const completelyrusts = (ptr) => ptr?.name === 'iron golem';

// The attack types that can each trigger a defender's passive.
const PASSIVE_TRIGGERS = new Set([AT_CLAW, AT_BITE, AT_KICK, AT_BUTT, AT_TUCH,
    AT_STNG, AT_HUGS, AT_ENGL, AT_TENT, AT_WEAP]);

// C ref: mondata.c:720 max_passive_dmg(mdef, magr) — the most damage `mdef`
// could do back to `magr` purely by being hit.  dogmove.c's pet-attack balk
// test compares this against the pet's current hp, which is what stops a
// 2 hp kitten from swatting a green mold (AD_ACID passive, max 8).
export function max_passive_dmg(mdef, magr) {
    const agrAttks = mattk_of(magr?.data);
    const defAttks = mattk_of(mdef?.data);

    /* each attack by magr can result in passive damage */
    let multi2 = 0;
    for (const a of agrAttks)
        if (PASSIVE_TRIGGERS.has(a.aatyp)) multi2++;

    let dmg = 0;
    for (const a of defAttks) {
        if (a.aatyp !== AT_NONE && a.aatyp !== AT_BOOM) continue;
        const adtyp = a.adtyp;
        if ((adtyp === AD_FIRE && completelyburns(magr?.data))
            || (adtyp === AD_DCAY && completelyrots(magr?.data))
            || (adtyp === AD_RUST && completelyrusts(magr?.data))) {
            dmg = magr.mhp | 0;
        } else if ((adtyp === AD_ACID && !resists_acid(magr))
                   || (adtyp === AD_COLD && !resists_cold(magr))
                   || (adtyp === AD_FIRE && !resists_fire(magr))
                   || (adtyp === AD_ELEC && !resists_elec(magr))
                   || adtyp === AD_PHYS) {
            dmg = a.damn | 0;
            if (!dmg) dmg = (mdef.data?.mlevel | 0) + 1;
            dmg *= (a.damd | 0);
        }
        dmg *= multi2;
        break; /* C breaks on the FIRST AT_NONE/AT_BOOM slot, matched or not */
    }
    return dmg;
}

// ─────────────────────────────────────────────────────────────────────────────
// The rest of src/mondata.c.  INERT: nothing above this line calls into it and
// no existing call site was rewired, so the additions are score-neutral by
// construction.  Two conventions this port gets wrong easily:
//   * `ptr.mlet` (js/makemon.js:621) is the display CHARACTER; the numeric
//     defsym.h S_* class index is `ptr.mcls` (:620).  Every C `ptr->mlet ==
//     S_FOO` below is therefore written `ptr.mcls === S_FOO`.
//   * `u.umonnum` is a ROLE index here, not C's urole.mnum, so `u.data` is a
//     bogus mons[] row while unpolymorphed — every u.data read is guarded by
//     `u.Upolyd`, exactly as C's Upolyd does.
// ─────────────────────────────────────────────────────────────────────────────

// C ref: include/defsym.h MONSYMS — the numeric class indices this file needs.
const S_RODENT = 18, S_LIGHT = 25, S_ANGEL = 27;
// C ref: include/monsters.h G_SGROUP/G_LGROUP/G_UNIQ (permonst.geno).
const G_SGROUP = 0x0080, G_LGROUP = 0x0040, G_UNIQ = 0x1000;

// C ref: monst.h MON_WEP(mon) — the monster's wielded weapon.
function MON_WEP(mon) { return mon?.mw || null; }
// C ref: monst.h `mon == &gy.youmonst`.
function is_you(mon) { return !!mon && (mon === game.youmonst || mon === game.u); }
// C ref: mondata.h monsndx(ptr) — mons[] index of a permonst row.
function monsndx(ptr) { return ptr?.pmidx ?? NON_PM; }
// C ref: youprop.h Upolyd.
function Upolyd() { return !!game.u?.Upolyd; }

// C ref: mondata.c:13 set_mon_data(mon, ptr) — install a monster's base type
// (initial creation or shapechange).  Leftover movement points are PRORATED
// when the new form is slower, so a Human->gnome polymorph takes u.umovement
// 12 -> 6 and changes how many turns every later command costs.  The C order
// matters: old_speed is read from the OLD data before the assignment.
// permonst.mmove is not on the makemon.js MONS row; the table is js/mon.js:149
// mmove_of().  RNG-free.
export function set_mon_data(mon, ptr) {
    if (!mon) return;
    const old_speed = mon.data ? mmove_of(mon.data) : 0;
    /* C picks a pointer to u.umovement for the hero, mon->movement otherwise */
    const you = is_you(mon);
    const holder = you ? game.u : mon;
    const field = you ? 'umovement' : 'movement';

    mon.data = ptr;
    mon.mnum = monsndx(ptr);

    if (holder && holder[field]) { /* adjusts poly'd hero as well as monsters */
        const new_speed = mmove_of(ptr);
        /* prorate unused movement if the new form is slower so that it doesn't
           get extra moves left over from the previous form; if the new form is
           faster, leave unused movement as is */
        if (new_speed < old_speed) {
            /* C multiplies first and only then divides, so the single integer
               truncation lands at the end */
            let v = holder[field] * new_speed;
            if (old_speed > 0) v = Math.trunc(v / old_speed);
            holder[field] = v;
        }
    }
}

// C ref: mondata.c:278 resists_blnd_by_arti(mon) — True iff the monster resists
// light-induced blindness because of worn/wielded magical equipment; used only
// to decide whether to play the shieldeff() sparkle.  RNG-free.
export function resists_blnd_by_arti(mon) {
    const you = is_you(mon);
    let o = you ? (game.uwep || null) : MON_WEP(mon);

    if (o && o.oartifact && defends(AD_BLND, o))
        return true;
    const inv = you ? (Array.isArray(game.invent) ? game.invent : [])
                    : (Array.isArray(mon?.minvent) ? mon.minvent : []);
    for (o of inv)
        if (defends_when_carried(AD_BLND, o))
            return true;
    /* C's #if 0 block (Eyes of the Overworld) is deliberately omitted there
       too — their worn property is magic resistance, not blindness. */
    return false;
}

// C ref: monattk.h:31 DISTANCE_ATTK_TYPE(atyp) — SPIT/BREA/MAGC/GAZE.
function DISTANCE_ATTK_TYPE(atyp) {
    return atyp === AT_SPIT || atyp === AT_BREA
        || atyp === AT_MAGC || atyp === AT_GAZE;
}

// C ref: mondata.c:402 ranged_attk(ptr) — can this species attack at range?
// NOTE: js/monmove.js:4345 ranged_attk_available() is mhitu.c's DIFFERENT
// predicate (it also consults m_seenres and DRAWS through get_atkdam_type);
// this one is the pure mattk[] scan.
export function ranged_attk(ptr) {
    for (const a of mattk_of(ptr))
        if (DISTANCE_ATTK_TYPE(a.aatyp))
            return true;
    return false;
}

// C ref: mondata.c:501 mstrength_ranged_attk(ptr) (staticfn) — mstrength()'s
// own, LOOSER notion of a ranged attack: AT_WEAP/AT_MAGC (>= AT_WEAP == 254)
// plus the BREA/SPIT/GAZE bitmask.  Deliberately not the same as ranged_attk().
export function mstrength_ranged_attk(ptr) {
    const atk_mask = (1 << AT_BREA) | (1 << AT_SPIT) | (1 << AT_GAZE);
    for (const a of mattk_of(ptr)) {
        const j = a.aatyp;
        if (j >= AT_WEAP || (j < 32 && (atk_mask & (1 << j)) !== 0))
            return true;
    }
    return false;
}

// C ref: mondata.c:428 mstrength(ptr) — the makedefs/#mondifficulty estimate of
// a species' strength.  Wizard-mode only (it is what `#mondifficulty` compares
// against the hardcoded monsters.h difficulty column), and RNG-free.
// js/wizcmds.js:1443 stubs this as nyi_mstrength() "needs a permonst.mmove
// table"; the table is js/mon.js:149 mmove_of(), used here.
export function mstrength(ptr) {
    let tmp = ptr?.mlevel | 0;

    if (tmp > 49) /* special fixed hp monster */
        tmp = Math.trunc((2 * (tmp - 6)) / 4);

    const geno = ptr?.geno | 0;
    /* for creation in groups */
    let n = (geno & G_SGROUP) ? 1 : 0;
    n += ((geno & G_LGROUP) ? 1 : 0) << 1;

    /* for ranged attacks */
    if (mstrength_ranged_attk(ptr)) n++;

    /* for higher ac values */
    const ac = ptr?.ac ?? 10;
    n += (ac < 4) ? 1 : 0;
    n += (ac < 0) ? 1 : 0;

    /* for very fast monsters */
    n += (mmove_of(ptr) >= 18) ? 1 : 0;

    const attks = mattk_of(ptr);
    /* for each attack and "special" attack */
    for (const a of attks) {
        const tmp2 = a.aatyp;
        n += (tmp2 > 0) ? 1 : 0;
        n += (tmp2 === AT_MAGC) ? 1 : 0;
        n += (tmp2 === AT_WEAP && (mflags2_of(ptr) & M2_STRONG)) ? 1 : 0;
        if (tmp2 === AT_EXPL) {
            const tmp3 = a.adtyp;
            /* {freezing,flaming,shocking} spheres are fairly weak but can
               destroy equipment; {yellow,black} lights can't */
            n += (tmp3 === AD_COLD || tmp3 === AD_FIRE) ? 3
                 : (tmp3 === AD_ELEC) ? 5 : 0;
        }
    }

    /* for each "special" damage type */
    for (const a of attks) {
        const tmp2 = a.adtyp;
        if (tmp2 === AD_DRLI || tmp2 === AD_STON || tmp2 === AD_DRST
            || tmp2 === AD_DRDX || tmp2 === AD_DRCO || tmp2 === AD_WERE)
            n += 2;
        else if (ptr?.name !== 'grid bug') /* C: strcmp(...) != 0 */
            n += (tmp2 !== AD_PHYS) ? 1 : 0;
        n += ((a.damd | 0) * (a.damn | 0) > 23) ? 1 : 0;
    }

    /* Leprechauns have many hit dice but don't really do much damage. */
    if (ptr?.name === 'leprechaun') n -= 2;

    /* soldier ants and killer bees are underestimated by the formula */
    if (ptr?.name === 'killer bee' || ptr?.name === 'soldier ant')
        n += 2; /* +1 after 'tmp += n/2' below */

    /* finally, adjust the monster level  0 <= n <= 24 (approx.) */
    if (n === 0) tmp -= 1;
    else if (n < 6) tmp += Math.trunc(n / 3) + 1;
    else tmp += Math.trunc(n / 2);

    return (tmp >= 0) ? tmp : 0;
}

// C ref: mondata.c:540 hates_blessings(ptr) — the species-level half of
// mon_hates_blessings().  js/weapon.js:81 documents the same expression at its
// own call site; this is mondata.c's symbol.
export function hates_blessings(ptr) {
    return is_undead_flag(ptr) || is_demon_flag(ptr);
}

// C ref: mondata.c:663 cantvomit(ptr) — rats, mice and horses can't vomit.
// C compares mons[] ROW POINTERS (ptr != &mons[PM_ROCK_MOLE]); the names below
// are unique in mons[] so the comparison is exact (unlike a species-name REGEX,
// which is the bug pattern in [[name-regex-predicate-sweep]]).
export function cantvomit(ptr) {
    if (ptr?.mcls === S_RODENT && ptr.name !== 'rock mole'
        && ptr.name !== 'woodchuck')
        return true;
    if (ptr?.name === 'warhorse' || ptr?.name === 'horse'
        || ptr?.name === 'pony')
        return true;
    return false;
}

// C ref: mondata.c:700 dmgtype_fromattack(ptr, dtyp, atyp) — the FIRST mattk[]
// slot dealing damage type dtyp (from attack type atyp, or AT_ANY).  Returns
// the attack, not a boolean: mhitu.c/uhitm.c read damn/damd off it.
// js/monattk_data.js:491 dmgtype() is the boolean wrapper over this.
export function dmgtype_fromattack(ptr, dtyp, atyp) {
    for (const a of mattk_of(ptr))
        if (a.adtyp === dtyp && (atyp === AT_ANY || a.aatyp === atyp))
            return a;
    return null;
}

// C ref: mondata.c:1191 pronoun_gender(mtmp, pg_flags) — gender() but unseen
// humanoids are "it", lower animals are "it" even when seen, and hallucination
// may yield "they".  0 he / 1 she / 2 it / 3 they.
//
// THE RNG POINT: the rn2(4) fires whenever PRONOUN_HALLU is set and the hero is
// hallucinating, BEFORE any visibility test — so it is drawn even for a monster
// the hero cannot see at all.  js/do_name.js:221 keeps a module-private
// `pronoun_gender(mon)` that draws rn2(2) instead and returns 3-or-gender; that
// is a live modulus divergence (see this port's report), not a reduction.
// No js/ module has mhe()/mhim()/mhis() yet, so nothing calls this one.
export function pronoun_gender(mtmp, pg_flags) {
    const override_vis = (pg_flags & PRONOUN_NO_IT) !== 0;
    const hallu_rand = (pg_flags & PRONOUN_HALLU) !== 0;

    if (hallu_rand && Hallucination())
        return rn2(4); /* 0..3 */
    if (!override_vis && !canspotmon(mtmp))
        return 2;
    const ptr = mtmp?.data;
    if (is_neuter(ptr))
        return 2;
    return (humanoid(ptr) || ((ptr?.geno | 0) & G_UNIQ)
            || type_is_pname(ptr)) ? (mtmp.female ? 1 : 0) : 2;
}
// C ref: mondata.h is_neuter(ptr) / type_is_pname(ptr).
function is_neuter(ptr) { return is_neuter_flag(ptr); }
function type_is_pname(ptr) { return (mflags2_of(ptr) & M2_PNAME) !== 0; }
// C ref: youprop.h Hallucination — HHallucination && !Halluc_resistance.  Read
// through every spelling this port has used for the same u.uprops[] slot.
function Hallucination() {
    const u = game.u;
    if (!u) return false;
    const on = u.uhallu || u.HHallucination || u.uprops?.Hallucination
               || u.uprops?.HHallucination;
    const res = u.uprops?.HHalluc_resistance || u.uprops?.EHalluc_resistance;
    return !!on && !res;
}

// C ref: mondata.c:1228 grownups[][2] — the little/big progression table, in
// C's order (only little_to_big cares, and its keys are unique).  js/makemon.js
// :793 GROWNUPS_LITTLE_TO_BIG holds the same pairs but is module-private along
// with makemon.js:814 little_to_big() / :822 big_to_little(); the proper fix is
// to EXPORT those two (js/timeout.js:1114 already tries to import
// little_to_big and silently falls back to the identity, and :1138 calls
// big_to_little() which is undefined at runtime).  Until then this file needs
// the chain locally for big_little_match().
const GROWNUPS = Object.freeze([
    [9, 10], [16, 18], [18, 19], [25, 26], [22, 24], [32, 33], [33, 37],
    [100, 104], [104, 105], [59, 60], [60, 61], [165, 166], [166, 168],
    [44, 46], [46, 47], [48, 49], [72, 77], [73, 77], [74, 77], [75, 77],
    [88, 89], [94, 96], [203, 204], [204, 205], [264, 268], [265, 268],
    [266, 268], [267, 268], [268, 269], [183, 184], [184, 185], [185, 186],
    [226, 227], [126, 127], [133, 143], [134, 144], [135, 145], [136, 146],
    [137, 147], [138, 148], [139, 149], [140, 150], [141, 151], [142, 152],
    [195, 199], [196, 200], [197, 201], [198, 202], [64, 65], [65, 66],
    [112, 114], [113, 115], [325, 328], [277, 278], [278, 280], [280, 281],
    [282, 283], [275, 276], [369, 331], [372, 334], [373, 335], [375, 337],
    [382, 343], [50, 53], [179, 180], [180, 181], [181, 182],
]);
// C ref: mondata.c:1303 little_to_big(montype) — first grownups[] row whose
// little form matches.  Local because makemon.js's copy is not exported.
function grownup_of(montype) {
    for (const [little, big] of GROWNUPS)
        if (montype === little) return big;
    return montype;
}

// C ref: mondata.c:1331 big_little_match(montyp1, montyp2) — are the two mons[]
// indices part of one growth progression?  Multi-step progressions (lich ->
// demilich -> master lich -> arch-lich) make it more than a table lookup.
// NOTE: C's class test is `mons[montyp1].mlet != mons[montyp2].mlet`, which is
// the NUMERIC class index — `.mcls` here, not `.mlet` (the display char).
// js/mon.js:3200 big_little_match_mon() answers only the identity case.
export function big_little_match(montyp1, montyp2) {
    let l, b;

    /* simplest case: both are same pm */
    if (montyp1 === montyp2)
        return true;
    /* assume it isn't possible to grow from one class letter to another */
    if (monster_by_pmidx(montyp1)?.mcls !== monster_by_pmidx(montyp2)?.mcls)
        return false;
    /* check whether montyp1 can grow up into montyp2 */
    for (l = montyp1; (b = grownup_of(l)) !== l; l = b)
        if (b === montyp2)
            return true;
    /* check whether montyp2 can grow up into montyp1 */
    for (l = montyp2; (b = grownup_of(l)) !== l; l = b)
        if (b === montyp1)
            return true;
    /* neither grows up to become the other; no match */
    return false;
}

// C ref: mondata.c:1359 raceptr(mtmp) — the permonst for a monster's RACE.  For
// the hero it is mons[urace.mnum] while unpolymorphed and u.data once poly'd —
// which is exactly why the Upolyd guard cannot be dropped in this port:
// u.umonnum is a ROLE index here, so an unguarded u.data reads a bogus mons[]
// row (a Wizard reads as a jackal).
export function raceptr(mtmp) {
    if (is_you(mtmp) && !Upolyd())
        return monster_by_pmidx(game.urace?.mnum ?? 0);
    return mtmp?.data ?? null;
}

// C ref: mondata.c:1449 msummon_environ(mptr, cloud) — "summoned in a <cloud>
// of <what>".  C's second parameter is an OUT-param (`const char **cloud`);
// here it is a ref object whose `.v` is set, matching js/sp_lev.js's
// `gender.v` convention for the same C idiom.  Returns `what`.
export function msummon_environ(mptr, cloud) {
    /* C keys the switch on mndx but folds every 'A' class to PM_ANGEL and every
       'y' class to PM_YELLOW_LIGHT first.  mlet is the numeric class in C ==
       .mcls here; the folded names stand in for the PM_ constants (each is a
       unique mons[] row, so the comparison is exact). */
    const name = (mptr?.mcls === S_ANGEL) ? 'Angel'
               : (mptr?.mcls === S_LIGHT) ? 'yellow light'
                 : mptr?.name;
    let what;

    if (cloud) cloud.v = 'cloud'; /* default is "cloud of <something>" */
    switch (name) {
    case 'water demon':
    case 'air elemental':
    case 'water elemental':
    case 'fog cloud':
    case 'ice vortex':
    case 'freezing sphere':
        what = 'vapor';
        break;
    case 'steam vortex':
        what = 'steam';
        break;
    case 'energy vortex':
    case 'shocking sphere':
        if (cloud) cloud.v = 'shower'; /* "shower of sparks" */
        what = 'sparks';
        break;
    case 'earth elemental':
    case 'dust vortex':
        what = 'dust';
        break;
    case 'fire elemental':
    case 'fire vortex':
    case 'flaming sphere':
        if (cloud) cloud.v = 'ball'; /* "ball of flame" */
        what = 'flame';
        break;
    case 'Angel':        /* actually any 'A'-class */
    case 'yellow light': /* any 'y'-class */
        if (cloud) cloud.v = 'flash'; /* "flash of light" */
        what = 'light';
        break;
    default:
        what = 'smoke';
        break;
    }
    return what;
}

// C ref: mondata.c:1540 cvt_prop_to_mseenres(prop) — property -> M_SEEN_ bit.
// The sibling cvt_adtyp_to_mseenres() already has copies at js/monmove.js:4358
// and js/mhitu.js; this is the PROPERTY-keyed one (monstunseesu_prop()).
export function cvt_prop_to_mseenres(prop) {
    switch (prop) {
    case ANTIMAGIC: return M_SEEN_MAGR;
    case FIRE_RES: return M_SEEN_FIRE;
    case COLD_RES: return M_SEEN_COLD;
    case SLEEP_RES: return M_SEEN_SLEEP;
    case DISINT_RES: return M_SEEN_DISINT;
    case POISON_RES: return M_SEEN_POISON;
    case SHOCK_RES: return M_SEEN_ELEC;
    case ACID_RES: return M_SEEN_ACID;
    case REFLECTING: return M_SEEN_REFL;
    default: return M_SEEN_NOTHING;
    }
}

// C ref: monst.h m_setseenres/m_clearseenres — this port keeps C's `mseenres`
// field as `mon.seen_resistance` (see js/mhitu.js:122 m_seenres()).  NOTE
// js/monmove.js:5643 m_seenres_bream() reads `mtmp.mseenres`, a field nothing
// ever writes, so that gate is always false — reported, not fixed here.
function m_setseenres(mon, res) {
    if (mon) mon.seen_resistance = ((mon.seen_resistance | 0) | res);
}
function m_clearseenres(mon, res) {
    if (mon) mon.seen_resistance = ((mon.seen_resistance | 0) & ~res);
}
// C ref: decl.c fmon — the level's monster chain, in C's list order.
function fmon() { return game.level?.monsters || []; }

// C ref: mondata.c:1558 monstseesu(seenres) — every monster with line of sight
// to the hero remembers that the hero resisted M_SEEN_foo.  RNG-free itself,
// but muse.c's find_offensive()/find_defensive() m_seenres() gates read the
// bit, so it steers which wand a monster reaches for on a LATER turn.
// js/muse.js:1794 monstseesu_muse() is a reduced local copy that substitutes
// couldsee() for the full m_canseeu() and takes a `clear` boolean.
export function monstseesu(seenres) {
    if (seenres === M_SEEN_NOTHING || game.u?.uswallow)
        return;
    for (const mtmp of fmon())
        if (!DEADMONSTER(mtmp) && m_canseeu(mtmp))
            m_setseenres(mtmp, seenres);
}

// C ref: mondata.c:1572 monstunseesu(seenres) — the inverse: they watched the
// hero FAIL to resist, so forget the remembered resistance.
export function monstunseesu(seenres) {
    if (seenres === M_SEEN_NOTHING || game.u?.uswallow)
        return;
    for (const mtmp of fmon())
        if (!DEADMONSTER(mtmp) && m_canseeu(mtmp))
            m_clearseenres(mtmp, seenres);
}

// C ref: prop.h:25 res_to_mr(r) — the first eight hero properties (FIRE_RES ..
// STONE_RES) map 1:1 onto the MR_FIRE .. MR_STONE bits.
function res_to_mr(r) {
    return (FIRE_RES <= r && r <= STONE_RES) ? (1 << (r - 1)) : 0x00;
}
// C ref: mondata.c:1586 give_u_to_m_resistances(mtmp) — copy the hero's
// INTRINSIC resistances onto a monster (used when the hero's form is cloned:
// cloneu(), and the Rider revival path).
// SCOPE: C tests `u.uprops[intr].intrinsic & INTRINSIC`, but this port
// materialises u.uprops[] as a flat 0/1-or-timer per NAMED property with no
// per-source bitmask (js/polyself.js:615 documents that gap), so a property
// that is set at all counts as intrinsic here.  RNG-free either way.
const UPROP_NAMES_BY_RES = Object.freeze({
    [FIRE_RES]: ['HFire_resistance', 'FireResistance', 'Fire_resistance'],
    [COLD_RES]: ['HCold_resistance', 'ColdResistance', 'Cold_resistance'],
    [SLEEP_RES]: ['HSleep_resistance', 'SleepResistance', 'Sleep_resistance'],
    [DISINT_RES]: ['HDisint_resistance', 'DisintResistance'],
    [SHOCK_RES]: ['HShock_resistance', 'ShockResistance', 'Shock_resistance'],
    [POISON_RES]: ['HPoison_resistance', 'PoisonResistance', 'Poison_resistance'],
    [ACID_RES]: ['HAcid_resistance', 'AcidResistance', 'Acid_resistance'],
    [STONE_RES]: ['HStone_resistance', 'StoneResistance', 'Stone_resistance'],
});
export function give_u_to_m_resistances(mtmp) {
    if (!mtmp) return;
    const p = game.u?.uprops || {};
    /* convert the hero's current set of intrinsics to their monster
       equivalents -- FIRE_RES to MR_FIRE, COLD_RES to MR_COLD, etc -- and
       add each to the mintrinsics field for the given monster */
    for (let intr = FIRE_RES; intr <= STONE_RES; intr++) {
        const names = UPROP_NAMES_BY_RES[intr] || [];
        if (names.some((k) => p[k]))
            mtmp.mintrinsics = ((mtmp.mintrinsics | 0) | res_to_mr(intr));
    }
}
