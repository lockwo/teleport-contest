// role.js -- character role/race/gender/alignment selection.
// C ref: src/role.c

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import {
    A_CHAOTIC, A_LAWFUL, A_NEUTRAL, A_NONE,
    PICK_RANDOM, PICK_RIGID,
    ROLE_ALIGNMASK, ROLE_ALIGNS, ROLE_CHAOTIC, ROLE_FEMALE,
    ROLE_GENDERS, ROLE_GENDMASK, ROLE_LAWFUL, ROLE_MALE,
    ROLE_NEUTRAL, ROLE_NONE, ROLE_RACEMASK, ROLE_RANDOM,
} from './const.js';

const MH_HUMAN = 0x0008;
const MH_ELF = 0x0010;
const MH_DWARF = 0x0020;
const MH_GNOME = 0x0040;
const MH_ORC = 0x0080;

export const roles = [
    {
        name: { m: 'Archeologist', f: null },
        rank: [{ m: 'Digger', f: null }],
        filecode: 'Arc',
        mnum: 0,
        allow: MH_HUMAN | MH_DWARF | MH_GNOME | ROLE_MALE | ROLE_FEMALE | ROLE_LAWFUL | ROLE_NEUTRAL,
        gods: ['Quetzalcoatl', 'Camaxtli', 'Huhetotl'],
    },
    {
        name: { m: 'Barbarian', f: null },
        rank: [{ m: 'Plunderer', f: 'Plunderess' }],
        filecode: 'Bar',
        mnum: 1,
        allow: MH_HUMAN | MH_ORC | ROLE_MALE | ROLE_FEMALE | ROLE_NEUTRAL | ROLE_CHAOTIC,
        gods: ['Mitra', 'Crom', 'Set'],
    },
    {
        name: { m: 'Caveman', f: 'Cavewoman' },
        rank: [{ m: 'Troglodyte', f: null }],
        filecode: 'Cav',
        mnum: 2,
        allow: MH_HUMAN | MH_DWARF | MH_GNOME | ROLE_MALE | ROLE_FEMALE | ROLE_LAWFUL | ROLE_NEUTRAL,
        gods: ['Anu', 'Ishtar', 'Anshar'],
    },
    {
        name: { m: 'Healer', f: null },
        rank: [{ m: 'Rhizotomist', f: null }],
        filecode: 'Hea',
        mnum: 3,
        allow: MH_HUMAN | MH_GNOME | ROLE_MALE | ROLE_FEMALE | ROLE_NEUTRAL,
        gods: ['Athena', 'Hermes', 'Poseidon'],
    },
    {
        name: { m: 'Knight', f: null },
        rank: [{ m: 'Gallant', f: null }],
        filecode: 'Kni',
        mnum: 4,
        allow: MH_HUMAN | ROLE_MALE | ROLE_FEMALE | ROLE_LAWFUL,
        gods: ['Lugh', 'Brigit', 'Manannan Mac Lir'],
    },
    {
        name: { m: 'Monk', f: null },
        rank: [{ m: 'Candidate', f: null }],
        filecode: 'Mon',
        mnum: 5,
        allow: MH_HUMAN | ROLE_MALE | ROLE_FEMALE | ROLE_LAWFUL | ROLE_NEUTRAL | ROLE_CHAOTIC,
        gods: ['Shan Lai Ching', 'Chih Sung-tzu', 'Huan Ti'],
    },
    {
        name: { m: 'Priest', f: 'Priestess' },
        rank: [{ m: 'Aspirant', f: null }],
        filecode: 'Pri',
        mnum: 6,
        allow: MH_HUMAN | MH_ELF | ROLE_MALE | ROLE_FEMALE | ROLE_LAWFUL | ROLE_NEUTRAL | ROLE_CHAOTIC,
        gods: null,
    },
    {
        name: { m: 'Rogue', f: null },
        rank: [{ m: 'Footpad', f: null }],
        filecode: 'Rog',
        mnum: 8,
        allow: MH_HUMAN | MH_ORC | ROLE_MALE | ROLE_FEMALE | ROLE_CHAOTIC,
        gods: ['Issek', 'Mog', 'Kos'],
    },
    {
        name: { m: 'Ranger', f: null },
        rank: [{ m: 'Tenderfoot', f: null }],
        filecode: 'Ran',
        mnum: 7,
        allow: MH_HUMAN | MH_ELF | MH_GNOME | MH_ORC | ROLE_MALE | ROLE_FEMALE | ROLE_NEUTRAL | ROLE_CHAOTIC,
        gods: ['Mercury', 'Venus', 'Mars'],
    },
    {
        name: { m: 'Samurai', f: null },
        rank: [{ m: 'Hatamoto', f: null }],
        filecode: 'Sam',
        mnum: 9,
        allow: MH_HUMAN | ROLE_MALE | ROLE_FEMALE | ROLE_LAWFUL,
        gods: ['Amaterasu Omikami', 'Raijin', 'Susanowo'],
    },
    {
        name: { m: 'Tourist', f: null },
        rank: [{ m: 'Rambler', f: null }],
        filecode: 'Tou',
        mnum: 10,
        allow: MH_HUMAN | ROLE_MALE | ROLE_FEMALE | ROLE_NEUTRAL,
        gods: ['Blind Io', 'The Lady', 'Offler'],
    },
    {
        name: { m: 'Valkyrie', f: null },
        rank: [{ m: 'Stripling', f: null }],
        filecode: 'Val',
        mnum: 11,
        allow: MH_HUMAN | MH_DWARF | ROLE_FEMALE | ROLE_LAWFUL | ROLE_NEUTRAL,
        gods: ['Tyr', 'Odin', 'Loki'],
    },
    {
        name: { m: 'Wizard', f: null },
        rank: [{ m: 'Evoker', f: null }],
        filecode: 'Wiz',
        mnum: 12,
        allow: MH_HUMAN | MH_ELF | MH_GNOME | MH_ORC | ROLE_MALE | ROLE_FEMALE | ROLE_NEUTRAL | ROLE_CHAOTIC,
        gods: ['Ptah', 'Thoth', 'Anhur'],
    },
];

export const races = [
    {
        name: 'human',
        noun: 'human',
        adj: 'human',
        filecode: 'Hum',
        mnum: 0,
        allow: MH_HUMAN | ROLE_MALE | ROLE_FEMALE | ROLE_LAWFUL | ROLE_NEUTRAL | ROLE_CHAOTIC,
        selfmask: MH_HUMAN,
    },
    {
        name: 'elf',
        noun: 'elf',
        adj: 'elven',
        filecode: 'Elf',
        mnum: 1,
        allow: MH_ELF | ROLE_MALE | ROLE_FEMALE | ROLE_CHAOTIC,
        selfmask: MH_ELF,
    },
    {
        name: 'dwarf',
        noun: 'dwarf',
        adj: 'dwarven',
        filecode: 'Dwa',
        mnum: 2,
        allow: MH_DWARF | ROLE_MALE | ROLE_FEMALE | ROLE_LAWFUL,
        selfmask: MH_DWARF,
    },
    {
        name: 'gnome',
        noun: 'gnome',
        adj: 'gnomish',
        filecode: 'Gno',
        mnum: 3,
        allow: MH_GNOME | ROLE_MALE | ROLE_FEMALE | ROLE_NEUTRAL,
        selfmask: MH_GNOME,
    },
    {
        name: 'orc',
        noun: 'orc',
        adj: 'orcish',
        filecode: 'Orc',
        mnum: 4,
        allow: MH_ORC | ROLE_MALE | ROLE_FEMALE | ROLE_CHAOTIC,
        selfmask: MH_ORC,
    },
];

export const genders = [
    { name: 'male', adj: 'male', filecode: 'Mal', value: 0, allow: ROLE_MALE },
    { name: 'female', adj: 'female', filecode: 'Fem', value: 1, allow: ROLE_FEMALE },
];

export const aligns = [
    { name: 'law', adj: 'lawful', filecode: 'Law', allow: ROLE_LAWFUL, value: A_LAWFUL },
    { name: 'balance', adj: 'neutral', filecode: 'Neu', allow: ROLE_NEUTRAL, value: A_NEUTRAL },
    { name: 'chaos', adj: 'chaotic', filecode: 'Cha', allow: ROLE_CHAOTIC, value: A_CHAOTIC },
];

export const ROLE_PRIEST = 6;
export const ROLE_TOURIST = 10;

function IndexOkT(idx, arr) {
    return Number.isInteger(idx) && idx >= 0 && idx < arr.length;
}

function rfilter() {
    return game.rfilter || { roles: [], mask: 0 };
}

function roleBlocked(rolenum) {
    return !!rfilter().roles?.[rolenum];
}

function maskBlocked(mask) {
    return !!(rfilter().mask & mask);
}

function normalizeName(str) {
    return String(str || '').trim().toLowerCase();
}

function isRandomString(str) {
    const s = normalizeName(str);
    return s === '*' || s === '@' || 'random'.startsWith(s);
}

export function validrole(rolenum) {
    return IndexOkT(rolenum, roles);
}

export function randrole(for_display = false) {
    void for_display;
    return rn2(roles.length);
}

export function randrole_filtered() {
    const set = [];

    for (let i = 0; i < roles.length; i++) {
        if (ok_role(i, ROLE_NONE, ROLE_NONE, ROLE_NONE)
            && ok_race(i, ROLE_RANDOM, ROLE_NONE, ROLE_NONE)
            && ok_gend(i, ROLE_NONE, ROLE_RANDOM, ROLE_NONE)
            && ok_align(i, ROLE_NONE, ROLE_NONE, ROLE_RANDOM))
            set.push(i);
    }
    return set.length ? set[rn2(set.length)] : randrole(false);
}

export function str2role(str) {
    if (typeof str === 'number') return validrole(str) ? str : ROLE_NONE;
    if (!str) return ROLE_NONE;
    const s = normalizeName(str);

    for (let i = 0; i < roles.length; i++) {
        const role = roles[i];
        if (role.name.m.toLowerCase().startsWith(s))
            return i;
        if (role.name.f && role.name.f.toLowerCase().startsWith(s))
            return i;
        if (role.filecode.toLowerCase() === s)
            return i;
    }
    return isRandomString(str) ? ROLE_RANDOM : ROLE_NONE;
}

export function validrace(rolenum, racenum) {
    return IndexOkT(racenum, races)
        && IndexOkT(rolenum, roles)
        && !!(roles[rolenum].allow & races[racenum].allow & ROLE_RACEMASK);
}

export function randrace(rolenum) {
    let n = 0;

    for (let i = 0; i < races.length; i++)
        if (roles[rolenum].allow & races[i].allow & ROLE_RACEMASK)
            n++;
    if (n)
        n = Math.trunc(rn2(n * 100) / 100);
    for (let i = 0; i < races.length; i++) {
        if (roles[rolenum].allow & races[i].allow & ROLE_RACEMASK) {
            if (n)
                n--;
            else
                return i;
        }
    }
    return rn2(races.length);
}

export function str2race(str) {
    if (typeof str === 'number') return IndexOkT(str, races) ? str : ROLE_NONE;
    if (!str) return ROLE_NONE;
    const s = normalizeName(str);

    for (let i = 0; i < races.length; i++) {
        const race = races[i];
        if (race.noun.toLowerCase().startsWith(s))
            return i;
        if (race.adj.toLowerCase().startsWith(s))
            return i;
        if (race.filecode.toLowerCase() === s)
            return i;
    }
    return isRandomString(str) ? ROLE_RANDOM : ROLE_NONE;
}

export function validgend(rolenum, racenum, gendnum) {
    return gendnum >= 0 && gendnum < ROLE_GENDERS
        && IndexOkT(rolenum, roles)
        && IndexOkT(racenum, races)
        && !!(roles[rolenum].allow & races[racenum].allow
              & genders[gendnum].allow & ROLE_GENDMASK);
}

export function randgend(rolenum, racenum) {
    let n = 0;

    for (let i = 0; i < ROLE_GENDERS; i++)
        if (roles[rolenum].allow & races[racenum].allow & genders[i].allow
            & ROLE_GENDMASK)
            n++;
    if (n)
        n = rn2(n);
    for (let i = 0; i < ROLE_GENDERS; i++) {
        if (roles[rolenum].allow & races[racenum].allow & genders[i].allow
            & ROLE_GENDMASK) {
            if (n)
                n--;
            else
                return i;
        }
    }
    return rn2(ROLE_GENDERS);
}

export function str2gend(str) {
    if (typeof str === 'number') return str >= 0 && str < ROLE_GENDERS ? str : ROLE_NONE;
    if (!str) return ROLE_NONE;
    const s = normalizeName(str);

    for (let i = 0; i < ROLE_GENDERS; i++) {
        if (genders[i].adj.toLowerCase().startsWith(s))
            return i;
        if (genders[i].filecode.toLowerCase() === s)
            return i;
    }
    return isRandomString(str) ? ROLE_RANDOM : ROLE_NONE;
}

export function validalign(rolenum, racenum, alignnum) {
    return alignnum >= 0 && alignnum < ROLE_ALIGNS
        && IndexOkT(rolenum, roles)
        && IndexOkT(racenum, races)
        && !!(roles[rolenum].allow & races[racenum].allow
              & aligns[alignnum].allow & ROLE_ALIGNMASK);
}

export function randalign(rolenum, racenum) {
    let n = 0;

    for (let i = 0; i < ROLE_ALIGNS; i++)
        if (roles[rolenum].allow & races[racenum].allow & aligns[i].allow
            & ROLE_ALIGNMASK)
            n++;
    if (n)
        n = rn2(n);
    for (let i = 0; i < ROLE_ALIGNS; i++) {
        if (roles[rolenum].allow & races[racenum].allow & aligns[i].allow
            & ROLE_ALIGNMASK) {
            if (n)
                n--;
            else
                return i;
        }
    }
    return rn2(ROLE_ALIGNS);
}

export function str2align(str) {
    if (typeof str === 'number') return str >= 0 && str < ROLE_ALIGNS ? str : ROLE_NONE;
    if (!str) return ROLE_NONE;
    const s = normalizeName(str);

    for (let i = 0; i < ROLE_ALIGNS; i++) {
        if (aligns[i].adj.toLowerCase().startsWith(s))
            return i;
        if (aligns[i].filecode.toLowerCase() === s)
            return i;
    }
    return isRandomString(str) ? ROLE_RANDOM : ROLE_NONE;
}

export function ok_role(rolenum, racenum, gendnum, alignnum) {
    let allow;

    if (IndexOkT(rolenum, roles)) {
        if (roleBlocked(rolenum))
            return false;
        allow = roles[rolenum].allow;
        if (IndexOkT(racenum, races)
            && !(allow & races[racenum].allow & ROLE_RACEMASK))
            return false;
        if (gendnum >= 0 && gendnum < ROLE_GENDERS
            && !(allow & genders[gendnum].allow & ROLE_GENDMASK))
            return false;
        if (alignnum >= 0 && alignnum < ROLE_ALIGNS
            && !(allow & aligns[alignnum].allow & ROLE_ALIGNMASK))
            return false;
        return true;
    }

    for (let i = 0; i < roles.length; i++) {
        if (roleBlocked(i))
            continue;
        allow = roles[i].allow;
        if (IndexOkT(racenum, races)
            && !(allow & races[racenum].allow & ROLE_RACEMASK))
            continue;
        if (gendnum >= 0 && gendnum < ROLE_GENDERS
            && !(allow & genders[gendnum].allow & ROLE_GENDMASK))
            continue;
        if (alignnum >= 0 && alignnum < ROLE_ALIGNS
            && !(allow & aligns[alignnum].allow & ROLE_ALIGNMASK))
            continue;
        return true;
    }
    return false;
}

export function pick_role(racenum, gendnum, alignnum, pickhow) {
    const set = [];

    for (let i = 0; i < roles.length; i++) {
        if (ok_role(i, racenum, gendnum, alignnum)
            && ok_race(i, (racenum >= 0) ? racenum : ROLE_RANDOM,
                       gendnum, alignnum)
            && ok_gend(i, racenum,
                       (gendnum >= 0) ? gendnum : ROLE_RANDOM, alignnum)
            && ok_align(i, racenum,
                        gendnum, (alignnum >= 0) ? alignnum : ROLE_RANDOM))
            set.push(i);
    }
    if (set.length === 0 || (set.length > 1 && pickhow === PICK_RIGID))
        return ROLE_NONE;
    return set[rn2(set.length)];
}

export function ok_race(rolenum, racenum, gendnum, alignnum) {
    let allow;

    if (IndexOkT(racenum, races)) {
        if (maskBlocked(races[racenum].selfmask))
            return false;
        allow = races[racenum].allow;
        if (IndexOkT(rolenum, roles)
            && !(allow & roles[rolenum].allow & ROLE_RACEMASK))
            return false;
        if (gendnum >= 0 && gendnum < ROLE_GENDERS
            && !(allow & genders[gendnum].allow & ROLE_GENDMASK))
            return false;
        if (alignnum >= 0 && alignnum < ROLE_ALIGNS
            && !(allow & aligns[alignnum].allow & ROLE_ALIGNMASK))
            return false;
        return true;
    }

    for (let i = 0; i < races.length; i++) {
        if (maskBlocked(races[i].selfmask))
            continue;
        allow = races[i].allow;
        if (IndexOkT(rolenum, roles)
            && !(allow & roles[rolenum].allow & ROLE_RACEMASK))
            continue;
        if (gendnum >= 0 && gendnum < ROLE_GENDERS
            && !(allow & genders[gendnum].allow & ROLE_GENDMASK))
            continue;
        if (alignnum >= 0 && alignnum < ROLE_ALIGNS
            && !(allow & aligns[alignnum].allow & ROLE_ALIGNMASK))
            continue;
        return true;
    }
    return false;
}

export function pick_race(rolenum, gendnum, alignnum, pickhow) {
    let races_ok = 0;

    for (let i = 0; i < races.length; i++) {
        if (ok_race(rolenum, i, gendnum, alignnum))
            races_ok++;
    }
    if (races_ok === 0 || (races_ok > 1 && pickhow === PICK_RIGID))
        return ROLE_NONE;
    races_ok = rn2(races_ok);
    for (let i = 0; i < races.length; i++) {
        if (ok_race(rolenum, i, gendnum, alignnum)) {
            if (races_ok === 0)
                return i;
            races_ok--;
        }
    }
    return ROLE_NONE;
}

export function ok_gend(rolenum, racenum, gendnum, alignnum) {
    void alignnum;
    let allow;

    if (gendnum >= 0 && gendnum < ROLE_GENDERS) {
        if (maskBlocked(genders[gendnum].allow))
            return false;
        allow = genders[gendnum].allow;
        if (IndexOkT(rolenum, roles)
            && !(allow & roles[rolenum].allow & ROLE_GENDMASK))
            return false;
        if (IndexOkT(racenum, races)
            && !(allow & races[racenum].allow & ROLE_GENDMASK))
            return false;
        return true;
    }

    for (let i = 0; i < ROLE_GENDERS; i++) {
        if (maskBlocked(genders[i].allow))
            continue;
        allow = genders[i].allow;
        if (IndexOkT(rolenum, roles)
            && !(allow & roles[rolenum].allow & ROLE_GENDMASK))
            continue;
        if (IndexOkT(racenum, races)
            && !(allow & races[racenum].allow & ROLE_GENDMASK))
            continue;
        return true;
    }
    return false;
}

export function pick_gend(rolenum, racenum, alignnum, pickhow) {
    let gends_ok = 0;

    for (let i = 0; i < ROLE_GENDERS; i++) {
        if (ok_gend(rolenum, racenum, i, alignnum))
            gends_ok++;
    }
    if (gends_ok === 0 || (gends_ok > 1 && pickhow === PICK_RIGID))
        return ROLE_NONE;
    gends_ok = rn2(gends_ok);
    for (let i = 0; i < ROLE_GENDERS; i++) {
        if (ok_gend(rolenum, racenum, i, alignnum)) {
            if (gends_ok === 0)
                return i;
            gends_ok--;
        }
    }
    return ROLE_NONE;
}

export function ok_align(rolenum, racenum, gendnum, alignnum) {
    void gendnum;
    let allow;

    if (alignnum >= 0 && alignnum < ROLE_ALIGNS) {
        if (maskBlocked(aligns[alignnum].allow))
            return false;
        allow = aligns[alignnum].allow;
        if (IndexOkT(rolenum, roles)
            && !(allow & roles[rolenum].allow & ROLE_ALIGNMASK))
            return false;
        if (IndexOkT(racenum, races)
            && !(allow & races[racenum].allow & ROLE_ALIGNMASK))
            return false;
        return true;
    }

    for (let i = 0; i < ROLE_ALIGNS; i++) {
        if (maskBlocked(aligns[i].allow))
            continue;
        allow = aligns[i].allow;
        if (IndexOkT(rolenum, roles)
            && !(allow & roles[rolenum].allow & ROLE_ALIGNMASK))
            continue;
        if (IndexOkT(racenum, races)
            && !(allow & races[racenum].allow & ROLE_ALIGNMASK))
            continue;
        return true;
    }
    return false;
}

export function pick_align(rolenum, racenum, gendnum, pickhow) {
    let aligns_ok = 0;

    for (let i = 0; i < ROLE_ALIGNS; i++) {
        if (ok_align(rolenum, racenum, gendnum, i))
            aligns_ok++;
    }
    if (aligns_ok === 0 || (aligns_ok > 1 && pickhow === PICK_RIGID))
        return ROLE_NONE;
    aligns_ok = rn2(aligns_ok);
    for (let i = 0; i < ROLE_ALIGNS; i++) {
        if (ok_align(rolenum, racenum, gendnum, i)) {
            if (aligns_ok === 0)
                return i;
            aligns_ok--;
        }
    }
    return ROLE_NONE;
}

export function rigid_role_checks(sel) {
    let tmp;

    if (sel.role === ROLE_RANDOM) {
        sel.role = pick_role(sel.race, sel.gender, sel.align, PICK_RANDOM);
        if (sel.role < 0)
            sel.role = randrole_filtered();
    }
    if (sel.race === ROLE_RANDOM
        && (tmp = pick_race(sel.role, sel.gender, sel.align, PICK_RANDOM)) !== ROLE_NONE)
        sel.race = tmp;
    if (sel.align === ROLE_RANDOM
        && (tmp = pick_align(sel.role, sel.race, sel.gender, PICK_RANDOM)) !== ROLE_NONE)
        sel.align = tmp;
    if (sel.gender === ROLE_RANDOM
        && (tmp = pick_gend(sel.role, sel.race, sel.align, PICK_RANDOM)) !== ROLE_NONE)
        sel.gender = tmp;

    if (sel.role !== ROLE_NONE) {
        if (sel.race === ROLE_NONE)
            sel.race = pick_race(sel.role, sel.gender, sel.align, PICK_RIGID);
        if (sel.align === ROLE_NONE)
            sel.align = pick_align(sel.role, sel.race, sel.gender, PICK_RIGID);
        if (sel.gender === ROLE_NONE)
            sel.gender = pick_gend(sel.role, sel.race, sel.align, PICK_RIGID);
    }
    return sel;
}

export function roleName(rolenum, female = false) {
    const role = roles[rolenum];
    if (!role) return 'Adventurer';
    return (female && role.name.f) || role.name.m;
}

export function rankName(rolenum, female = false) {
    const rank = roles[rolenum]?.rank?.[0];
    if (!rank) return roleName(rolenum, female);
    return (female && rank.f) || rank.m;
}

// Player-monster (PM_) numbers, matching roles[].mnum.
const PM_KNIGHT = 4;
const PM_SAMURAI = 9;
const PM_TOURIST = 10;
const PM_VALKYRIE = 11;

// C ref: role.c rank_of() — rank title for a given experience level.
// At game start (level 1) this is the role's first rank entry.
export function rank_of(_lev, rolenum, female = false) {
    return rankName(rolenum, female);
}

// C ref: role.c Hello() — role-specific greeting word for welcome().
export function Hello(rolenum) {
    switch (rolenum) {
    case PM_KNIGHT:
        return 'Salutations';
    case PM_SAMURAI:
        return 'Konnichi wa';
    case PM_TOURIST:
        return 'Aloha';
    case PM_VALKYRIE:
        return 'Velkommen';
    default:
        return 'Hello';
    }
}

// roles[].gods is [lawfulGod, neutralGod, chaoticGod].
function godForAlign(rolenum, alignType) {
    const gods = roles[rolenum]?.gods;
    if (!gods) return null;
    if (alignType === A_LAWFUL) return gods[0];
    if (alignType === A_NEUTRAL) return gods[1];
    if (alignType === A_CHAOTIC) return gods[2];
    return null;
}

// C ref: pray.c align_gname() — deity name for the hero's alignment.
// A goddess name is stored with a leading '_' which is stripped here.
export function align_gname(rolenum, alignType) {
    if (alignType === A_NONE) return 'Moloch';
    let gnam = godForAlign(rolenum, alignType);
    if (!gnam) return 'someone';
    if (gnam[0] === '_') gnam = gnam.slice(1);
    return gnam;
}

// C ref: pray.c align_gtitle() — "god" or "goddess" (goddess marked by '_').
export function align_gtitle(rolenum, alignType) {
    const gnam = godForAlign(rolenum, alignType);
    return (gnam && gnam[0] === '_') ? 'goddess' : 'god';
}

export function roleFromGame() {
    return validrole(game.initrole) ? roles[game.initrole] : null;
}

export function selectionIsComplete(sel) {
    return validrole(sel.role)
        && IndexOkT(sel.race, races)
        && sel.gender >= 0 && sel.gender < ROLE_GENDERS
        && sel.align >= 0 && sel.align < ROLE_ALIGNS;
}

export function apply_selection(sel) {
    game.initrole = sel.role;
    game.initrace = sel.race;
    game.initgend = sel.gender;
    game.initalign = sel.align;
}

export function random_player_selection(sel) {
    sel.role = pick_role(sel.race, sel.gender, sel.align, PICK_RANDOM);
    if (sel.role < 0)
        sel.role = randrole_filtered();
    sel.race = pick_race(sel.role, sel.gender, sel.align, PICK_RANDOM);
    sel.gender = pick_gend(sel.role, sel.race, sel.align, PICK_RANDOM);
    sel.align = pick_align(sel.role, sel.race, sel.gender, PICK_RANDOM);
    return sel;
}

export function first_valid_align(rolenum, racenum, gendnum) {
    for (let i = 0; i < ROLE_ALIGNS; i++)
        if (ok_align(rolenum, racenum, gendnum, i))
            return i;
    return ROLE_NONE;
}
