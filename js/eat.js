// eat.js - Eating / food code (and tin variety helpers used at object creation).
// C ref: nethack-c/upstream/src/eat.c

import { rn2 } from './rng.js';
import { monster_by_pmidx } from './makemon.js';

// tin types [SPINACH_TIN = -1, overrides corpsenm, nut==600]
// C ref: eat.c tintxts[]
// { txt, nut, fodder, greasy }
export const tintxts = [
    { txt: 'rotten', nut: -50, fodder: 0, greasy: 0 },  // ROTTEN_TIN = 0
    { txt: 'homemade', nut: 50, fodder: 1, greasy: 0 }, // HOMEMADE_TIN = 1
    { txt: 'soup made from', nut: 20, fodder: 1, greasy: 0 },
    { txt: 'french fried', nut: 40, fodder: 0, greasy: 1 },
    { txt: 'pickled', nut: 40, fodder: 1, greasy: 0 },
    { txt: 'boiled', nut: 50, fodder: 1, greasy: 0 },
    { txt: 'smoked', nut: 50, fodder: 1, greasy: 0 },
    { txt: 'dried', nut: 55, fodder: 1, greasy: 0 },
    { txt: 'deep fried', nut: 60, fodder: 0, greasy: 1 },
    { txt: 'szechuan', nut: 70, fodder: 1, greasy: 0 },
    { txt: 'broiled', nut: 80, fodder: 0, greasy: 0 },
    { txt: 'stir fried', nut: 80, fodder: 0, greasy: 1 },
    { txt: 'sauteed', nut: 95, fodder: 0, greasy: 0 },
    { txt: 'candied', nut: 100, fodder: 1, greasy: 0 },
    { txt: 'pureed', nut: 500, fodder: 1, greasy: 0 },
    { txt: '', nut: 0, fodder: 0, greasy: 0 },
];
// C ref: #define TTSZ SIZE(tintxts)
export const TTSZ = tintxts.length;

export const ROTTEN_TIN = 0;
export const HOMEMADE_TIN = 1;

// C ref: hack.h
export const SPINACH_TIN = -1;
export const RANDOM_TIN = -2;
export const HEALTHY_TIN = -3;

const NON_PM = -1;
const PM_LICHEN = 158;
const PM_LIZARD = 333;
const PM_DEATH = 318;
const PM_PESTILENCE = 319;
const PM_FAMINE = 320;
const PM_ACID_BLOB = 1; // placeholder; only used for ROTTEN_TIN->HOMEMADE adjustment

function corpse_mon_name(corpsenm) {
    return monster_by_pmidx(corpsenm)?.name ?? '';
}

// C ref: eat.c:58 #define nonrotting_corpse(mnum)
//   ((mnum) == PM_LIZARD || (mnum) == PM_LICHEN || is_rider(&mons[mnum])
//    || (mnum) == PM_ACID_BLOB)
function nonrotting_corpse(mnum) {
    const name = corpse_mon_name(mnum);
    return mnum === PM_LIZARD || mnum === PM_LICHEN
        || name === 'lizard' || name === 'lichen'
        || mnum === PM_DEATH || mnum === PM_PESTILENCE || mnum === PM_FAMINE
        || name === 'Death' || name === 'Pestilence' || name === 'Famine'
        || mnum === PM_ACID_BLOB || name === 'acid blob';
}

// C ref: ismnum(mnum) -> mnum is a valid monster index (>= LOW_PM)
function ismnum(mnum) {
    return mnum >= 0;
}

function vegetarian(ptr) {
    // C ref: vegetarian() in eat.c; only consulted for HEALTHY_TIN, which
    // is not used at object creation. Conservative default.
    return false;
}

// C ref: eat.c tin_variety(obj, displ)
export function tin_variety(obj, displ) {
    let r;
    const mnum = obj.corpsenm;

    if (obj.spe === 1) {
        r = SPINACH_TIN;
    } else if (obj.cursed) {
        r = ROTTEN_TIN; // always rotten if cursed
    } else if (obj.spe < 0) {
        r = -(obj.spe);
        --r; // get rid of the offset
    } else {
        r = rn2(TTSZ - 1);
    }

    if (!displ && r === HOMEMADE_TIN && !obj.blessed && !rn2(7))
        r = ROTTEN_TIN; // some homemade tins go bad

    if (r === ROTTEN_TIN && (ismnum(mnum) && nonrotting_corpse(mnum)))
        r = HOMEMADE_TIN; // lizards don't rot
    return r;
}

// C ref: eat.c:1460 set_tin_variety(struct obj *obj, int forcetype)
export function set_tin_variety(obj, forcetype) {
    let r;
    const mnum = obj.corpsenm;

    if (forcetype === SPINACH_TIN
        || (forcetype === HEALTHY_TIN
            && (mnum === NON_PM /* empty or already spinach */
                || !vegetarian(monster_by_pmidx(mnum))))) { /* replace meat */
        obj.corpsenm = NON_PM; /* not based on any monster */
        obj.spe = 1;           /* spinach */
        return;
    } else if (forcetype === HEALTHY_TIN) {
        r = tin_variety(obj, false);
        if (r < 0 || r >= TTSZ)
            r = ROTTEN_TIN; /* shouldn't happen */
        while ((r === ROTTEN_TIN && !obj.cursed) || !tintxts[r].fodder)
            r = rn2(TTSZ - 1);
    } else if (forcetype >= 0 && forcetype < TTSZ - 1) {
        r = forcetype;
    } else {               /* RANDOM_TIN */
        r = rn2(TTSZ - 1); /* take your pick */
        if (r === ROTTEN_TIN && (ismnum(mnum) && nonrotting_corpse(mnum)))
            r = HOMEMADE_TIN; /* lizards don't rot */
    }
    obj.spe = -(r + 1); /* offset by 1 to allow index 0 */
}
