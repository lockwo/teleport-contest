// makemon.js - Monster creation.
// C ref: makemon.c - rndmonst_adj, rndmonst, makemon, newmonhp.

import { game } from './gstate.js';
import { rn2, rnd, d } from './rng.js';
import { depth as depth_of_level } from './hacklib.js';
import { DART, mksobj } from './mkobj.js';

// Object type indices (mkobj.js OBJECT_DATA), needed by m_initweap.
const ORCISH_DAGGER = 36;
// SCIMITAR (50) is the alternative in C's ORCISH_DAGGER/SCIMITAR ternary, but
// PM_GOBLIN always short-circuits to ORCISH_DAGGER, so it is never reached here.
const ORCISH_HELM = 90;
import {
    A_NONE, A_CHAOTIC, A_NEUTRAL, A_LAWFUL,
    AM_NONE, AM_CHAOTIC, AM_NEUTRAL, AM_LAWFUL,
    DUNGEON_ALIGN_BY_DNUM,
    GEHENNOM,
    In_endgame, Is_astralevel, Is_rogue_level,
} from './const.js';

const G_UNIQ = 0x1000;
const G_NOHELL = 0x0800;
const G_HELL = 0x0400;
const G_NOGEN = 0x0200;
const G_NOCORPSE = 0x0010;
const G_FREQ = 0x0007;

const MR_FIRE = 0x01;
const MR_COLD = 0x02;

const NON_PM = -1;
const ALIGNWEIGHT = 5;

// Minimal mons[] slice needed by rndmonst_adj on depth 1.
// Fields: pmidx, name, mlet, mlevel, difficulty, maligntyp, geno, mresists, gender, mcolor.
// mcolor comes from include/monsters.h (the per-monster display color).
const RNDMONST_LOW_LEVEL = Object.freeze([
    { pmidx: 12, name: 'jackal', mlet: 'd', mlevel: 0, difficulty: 1, maligntyp: 0, geno: 3, mresists: 0, gender: 'random', mcolor: 3 },
    { pmidx: 13, name: 'fox', mlet: 'd', mlevel: 0, difficulty: 1, maligntyp: 0, geno: 1, mresists: 0, gender: 'random', mcolor: 1 },
    { pmidx: 59, name: 'kobold', mlet: 'k', mlevel: 0, difficulty: 1, maligntyp: -2, geno: 1, mresists: 0, gender: 'random', armed: true, mcolor: 3 },
    { pmidx: 70, name: 'goblin', mlet: 'o', mlevel: 0, difficulty: 1, maligntyp: -3, geno: 2, mresists: 0, gender: 'random', armed: true, mcolor: 7 },
    { pmidx: 88, name: 'sewer rat', mlet: 'r', mlevel: 0, difficulty: 1, maligntyp: 0, geno: 1, mresists: 0, gender: 'random', verysmall: true, mcolor: 3 },
    { pmidx: 116, name: 'grid bug', mlet: 'x', mlevel: 0, difficulty: 1, maligntyp: 0, geno: G_NOCORPSE | 3, mresists: 0, gender: 'random', verysmall: true, mcolor: 5 },
    { pmidx: 158, name: 'lichen', mlet: 'F', mlevel: 0, difficulty: 1, maligntyp: 0, geno: 4, mresists: 0, gender: 'neuter', mcolor: 10 },
    { pmidx: 239, name: 'kobold zombie', mlet: 'Z', mlevel: 0, difficulty: 1, maligntyp: -2, geno: G_NOCORPSE | 1, mresists: 0, gender: 'random', mcolor: 3 },
    { pmidx: 322, name: 'newt', mlet: ':', mlevel: 0, difficulty: 1, maligntyp: 0, geno: 5, mresists: 0, gender: 'random', verysmall: true, mcolor: 11 },
]);

export function monster_by_pmidx(pmidx) {
    return RNDMONST_LOW_LEVEL.find(mon => mon.pmidx === pmidx) ?? null;
}

function level_difficulty() {
    return depth_of_level(game.u?.uz);
}

function monmin_difficulty(levdif) {
    return Math.trunc(levdif / 6);
}

function monmax_difficulty(levdif) {
    return Math.trunc((levdif + (game.u?.ulevel || 1)) / 2);
}

function Inhell() {
    const dnum = game.u?.uz?.dnum ?? 0;
    return dnum === (game.gehennom_dnum ?? GEHENNOM);
}

function uncommon(ptr) {
    if (ptr.geno & (G_NOGEN | G_UNIQ)) return true;
    const mvflags = game.mvitals?.[ptr.pmidx]?.mvflags ?? 0;
    if (mvflags & 0x03) return true; // G_GONE: G_GENOD | G_EXTINCT
    if (Inhell()) return ptr.maligntyp > A_NEUTRAL;
    return !!(ptr.geno & G_HELL);
}

function dungeon_alignment() {
    const dnum = game.u?.uz?.dnum ?? 0;
    const lev = game.special_levels?.find?.(l => l?.dlevel?.dnum === dnum
        && l?.dlevel?.dlevel === (game.u?.uz?.dlevel ?? 1));
    const raw = lev?.flags?.align
        ?? game.dungeons?.[dnum]?.flags?.align
        ?? DUNGEON_ALIGN_BY_DNUM[dnum]
        ?? A_NONE;

    if (raw === AM_NONE || raw === A_NONE) return AM_NONE;
    if (raw === AM_LAWFUL || raw === A_LAWFUL) return AM_LAWFUL;
    if (raw === AM_NEUTRAL || raw === A_NEUTRAL) return AM_NEUTRAL;
    if (raw === AM_CHAOTIC || raw === A_CHAOTIC) return AM_CHAOTIC;
    return AM_NONE;
}

function align_shift(ptr) {
    switch (dungeon_alignment()) {
    default:
    case AM_NONE:
        return 0;
    case AM_LAWFUL:
        return Math.trunc((ptr.maligntyp + 20) / (2 * ALIGNWEIGHT));
    case AM_NEUTRAL:
        return Math.trunc((20 - Math.abs(ptr.maligntyp)) / ALIGNWEIGHT);
    case AM_CHAOTIC:
        return Math.trunc((-(ptr.maligntyp - 20)) / (2 * ALIGNWEIGHT));
    }
}

function temperature_shift(ptr) {
    const temperature = game.level?.flags?.temperature ?? 0;
    if (temperature && (ptr.mresists & (temperature > 0 ? MR_FIRE : MR_COLD)))
        return 3;
    return 0;
}

function wrong_elem_type(_ptr) {
    // Elemental plane filtering is outside the current level-generation slice.
    return false;
}

export function rndmonst_adj(minadj = 0, maxadj = 0) {
    let ptr;

    if (game.u?.uz?.dnum === game.quest_dnum) {
        if (rn2(7)) return null; // qt_montype() is not ported yet.
    }

    const zlevel = level_difficulty();
    const minmlev = monmin_difficulty(zlevel) + minadj;
    const maxmlev = monmax_difficulty(zlevel) + maxadj;
    const upper = Is_rogue_level(game.u?.uz);
    const elemlevel = In_endgame(game.u?.uz) && !Is_astralevel(game.u?.uz);

    let totalweight = 0;
    let selected_mndx = NON_PM;

    for (const mon of RNDMONST_LOW_LEVEL) {
        ptr = mon;

        if (ptr.difficulty < minmlev || ptr.difficulty > maxmlev) continue;
        if (upper && ptr.mlet !== ptr.mlet.toUpperCase()) continue;
        if (elemlevel && wrong_elem_type(ptr)) continue;
        if (uncommon(ptr)) continue;
        if (Inhell() && (ptr.geno & G_NOHELL)) continue;

        let weight = (ptr.geno & G_FREQ) + align_shift(ptr);
        weight += temperature_shift(ptr);
        if (weight < 0 || weight > 127) weight = 0;
        if (weight > 0) {
            totalweight += weight;
            if (rn2(totalweight) < weight)
                selected_mndx = ptr.pmidx;
        }
    }

    if (selected_mndx === NON_PM) return null;
    return RNDMONST_LOW_LEVEL.find(mon => mon.pmidx === selected_mndx) ?? null;
}

export function rndmonst() {
    return rndmonst_adj(0, 0);
}

function next_ident() {
    return rnd(2);
}

// C ref: mongets() (makemon.c:2181). Creates obj via mksobj and gives it to
// mtmp. We only need the RNG-consuming mksobj() call; the post-creation
// blessing/spe tweaks in C don't consume RNG for the low-level cases here.
function mongets(_mtmp, otyp) {
    if (!otyp) return;
    mksobj(otyp, true, false);
}

function m_initthrow(_mtmp, otyp, oquan) {
    mksobj(otyp, true, false);
    rn2(oquan); // rn1(oquan, 3) — quantity (the +3 base consumes no RNG)
}

// C ref: adj_lev() (makemon.c:2016). Adjusts a monster's level for the
// current depth and player level. The slice has no Wizard of Yendor / special
// (>49) monsters, so only the general path is needed.
function adj_lev(ptr) {
    let tmp = ptr.mlevel;
    if (tmp > 49) return 50;

    let tmp2 = level_difficulty() - tmp;
    if (tmp2 < 0)
        tmp--;
    else
        tmp += Math.trunc(tmp2 / 5);

    tmp2 = (game.u?.ulevel || 1) - ptr.mlevel;
    if (tmp2 > 0)
        tmp += Math.trunc(tmp2 / 4);

    let upper = Math.trunc((3 * ptr.mlevel) / 2);
    if (upper > 49) upper = 49;
    return tmp > upper ? upper : (tmp > 0 ? tmp : 0);
}

// C ref: newmonhp() (makemon.c:1012). Sets mon.m_lev / mhp / mhpmax and
// returns mhp. Only the general (non-golem, non-rider, non-special, non-dragon)
// paths are reachable by the low-level slice.
export function newmonhp(mon) {
    // Backward-compatible: callers may pass a bare permonst (ptr) instead of a
    // monst; in that case operate on a scratch object.
    const isMon = mon && mon.data !== undefined;
    const ptr = isMon ? mon.data : mon;
    const out = isMon ? mon : {};
    if (!ptr) return 0;

    out.m_lev = adj_lev(ptr);
    let basehp;
    if (!out.m_lev) {
        basehp = 1;
        out.mhpmax = out.mhp = rnd(4);
    } else {
        basehp = out.m_lev;
        out.mhpmax = out.mhp = d(basehp, 8);
    }

    if (out.mhpmax === basehp) {
        out.mhpmax += 1;
        out.mhp = out.mhpmax;
    }
    return out.mhp;
}

function m_initinv(ptr) {
    rn2(50);
    rn2(100);
}

// C ref: m_initweap() (makemon.c:160). Only the cases reachable by the
// low-level mons[] slice (S_KOBOLD, S_ORC) plus the general default tail are
// ported; the slice contains no giants/mercenaries/elves/etc.
function m_initweap(mtmp) {
    const ptr = mtmp?.data;
    if (!ptr || Is_rogue_level(game.u?.uz)) return;

    switch (ptr.mlet) {
    case 'o': { // S_ORC
        if (rn2(2)) // makemon.c:411
            mongets(mtmp, ORCISH_HELM);
        // makemon.c:413 switch selector: only PM_ORC_CAPTAIN consumes rn2(2);
        // the slice's only orc is PM_GOBLIN, so the selector is just mm and we
        // fall through to the default case (makemon.c:439).
        // default (makemon.c:440): PM_GOBLIN short-circuits the inner rn2(2)
        // in `(mm == PM_GOBLIN || rn2(2) == 0)`, so it is never evaluated.
        if (rn2(2)) // mm != PM_ORC_SHAMAN && rn2(2)
            mongets(mtmp, ORCISH_DAGGER); // mm == PM_GOBLIN -> ORCISH_DAGGER
        break;
    }
    case 'k': // S_KOBOLD (makemon.c:469)
        if (!rn2(4))
            m_initthrow(mtmp, DART, 12);
        break;
    default:
        break;
    }

    // General tail (makemon.c:570). rnd_offensive_item() consumes no RNG before
    // mongets() is reached for the level-0 slice monsters (m_lev 0 means the
    // guard `m_lev > rn2(75)` is always false, so mongets is never called).
    if (mtmp.m_lev > rn2(75))
        mongets(mtmp, rnd_offensive_item(mtmp));
}

// C ref: rnd_offensive_item() (muse.c:2035). For the low-level slice this is
// only reached when m_lev > rn2(75), which never happens for m_lev 0; provide
// the RNG-faithful selector anyway. difficulty<4 here so the switch is rn2(8).
function rnd_offensive_item(mtmp) {
    const ptr = mtmp?.data;
    const difficulty = ptr?.difficulty ?? 0;
    // is_animal / mindless monsters return 0 with no RNG; the slice's orc &
    // kobold are neither, so this branch is the relevant one.
    if (difficulty > 7 && !rn2(35)) return /*WAN_DEATH*/ 432;
    rn2(9 - (difficulty < 4 ? 1 : 0) + 4 * (difficulty > 6 ? 1 : 0));
    return 0; // exact item irrelevant for parity at this difficulty
}

export function makemon(mdat = null, x = 0, y = 0, mmflags = 0) {
    const ptr = mdat ?? rndmonst();
    if (!ptr) return null;

    const mtmp = { data: ptr, mx: x, my: y, mmflags };
    mtmp.m_id = next_ident();
    // newmonhp() sets mtmp.m_lev (= adj_lev(ptr)), mhp and mhpmax.
    newmonhp(mtmp);
    if (ptr.gender === 'random')
        mtmp.female = rn2(2);

    if (ptr.armed)
        m_initweap(mtmp);
    m_initinv(ptr);
    rn2(100); // saddle chance, checked before domestic/can_saddle predicates.
    return mtmp;
}
