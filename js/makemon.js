// makemon.js - Monster creation.
// C ref: makemon.c - rndmonst_adj, rndmonst, makemon, newmonhp.

import { game } from './gstate.js';
import { rn2, rnd } from './rng.js';
import { depth as depth_of_level } from './hacklib.js';
import { DART, mksobj } from './mkobj.js';
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
// Fields: pmidx, name, mlet, mlevel, difficulty, maligntyp, geno, mresists, gender.
const RNDMONST_LOW_LEVEL = Object.freeze([
    { pmidx: 12, name: 'jackal', mlet: 'd', mlevel: 0, difficulty: 1, maligntyp: 0, geno: 3, mresists: 0, gender: 'random' },
    { pmidx: 13, name: 'fox', mlet: 'd', mlevel: 0, difficulty: 1, maligntyp: 0, geno: 1, mresists: 0, gender: 'random' },
    { pmidx: 59, name: 'kobold', mlet: 'k', mlevel: 0, difficulty: 1, maligntyp: -2, geno: 1, mresists: 0, gender: 'random', armed: true },
    { pmidx: 70, name: 'goblin', mlet: 'o', mlevel: 0, difficulty: 1, maligntyp: -3, geno: 2, mresists: 0, gender: 'random', armed: true },
    { pmidx: 88, name: 'sewer rat', mlet: 'r', mlevel: 0, difficulty: 1, maligntyp: 0, geno: 1, mresists: 0, gender: 'random' },
    { pmidx: 116, name: 'grid bug', mlet: 'x', mlevel: 0, difficulty: 1, maligntyp: 0, geno: G_NOCORPSE | 3, mresists: 0, gender: 'random' },
    { pmidx: 158, name: 'lichen', mlet: 'F', mlevel: 0, difficulty: 1, maligntyp: 0, geno: 4, mresists: 0, gender: 'neuter' },
    { pmidx: 239, name: 'kobold zombie', mlet: 'Z', mlevel: 0, difficulty: 1, maligntyp: -2, geno: G_NOCORPSE | 1, mresists: 0, gender: 'random' },
    { pmidx: 322, name: 'newt', mlet: ':', mlevel: 0, difficulty: 1, maligntyp: 0, geno: 5, mresists: 0, gender: 'random' },
]);

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

function rne(x) {
    const utmp = (game.u?.ulevel || 1) < 15 ? 5 : Math.trunc((game.u?.ulevel || 1) / 3);
    let tmp = 1;
    while (tmp < utmp && !rn2(x))
        tmp++;
    return tmp;
}

function blessorcurse(chance) {
    if (!rn2(chance))
        rn2(2);
}

function mksobj_weapon({ multigen = false, poisonable = false } = {}) {
    next_ident();
    if (multigen)
        rn2(6); // rn1(6, 6), quantity is overwritten by m_initthrow().
    if (!rn2(11)) {
        rne(3);
        rn2(2);
    } else if (!rn2(10)) {
        rne(3);
    } else {
        blessorcurse(10);
    }
    if (poisonable)
        rn2(100);
}

function mongets_weapon() {
    mksobj_weapon();
}

function m_initthrow(_otyp, oquan) {
    const was_in_mklev = game.in_mklev;
    game.in_mklev = true;
    try {
        mksobj(_otyp, true, false);
    } finally {
        game.in_mklev = was_in_mklev;
    }
    rn2(oquan); // rn1(oquan, 3)
}

export function newmonhp(ptr) {
    if (!ptr) return 0;
    if (ptr.mlevel <= 0) return rnd(4);

    let hp = 0;
    for (let i = 0; i < ptr.mlevel; i++)
        hp += rnd(8);
    return hp;
}

function m_initinv(ptr) {
    rn2(50);
    rn2(100);
}

function m_initweap(mtmp) {
    const ptr = mtmp?.data;
    if (!ptr || Is_rogue_level(game.u?.uz)) return;

    switch (ptr.mlet) {
    case 'k': // S_KOBOLD
        if (!rn2(4))
            m_initthrow(DART, 12);
        break;
    case 'o': // S_ORC; current low-level table only includes goblin.
        if (rn2(2))
            mongets_weapon();
        break;
    default:
        break;
    }

    if (mtmp.m_lev > rn2(75))
        mongets_weapon();
}

export function makemon(mdat = null, x = 0, y = 0, mmflags = 0) {
    const ptr = mdat ?? rndmonst();
    if (!ptr) return null;

    const mtmp = { data: ptr, mx: x, my: y, mmflags };
    mtmp.m_id = next_ident();
    mtmp.m_lev = ptr.mlevel;
    mtmp.mhp = newmonhp(ptr);
    if (ptr.gender === 'random')
        mtmp.female = rn2(2);

    if (ptr.armed)
        m_initweap(mtmp);
    m_initinv(ptr);
    rn2(100); // saddle chance, checked before domestic/can_saddle predicates.
    return mtmp;
}
