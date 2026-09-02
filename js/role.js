// role.js -- character role/race/gender/alignment selection.
// C ref: src/role.c

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import {
    A_CHAOTIC, A_LAWFUL, A_NEUTRAL, A_NONE,
    PICK_RANDOM, PICK_RIGID,
    ROLE_ALIGNMASK, ROLE_ALIGNS, ROLE_CHAOTIC, ROLE_FEMALE,
    ROLE_GENDERS, ROLE_GENDMASK, ROLE_LAWFUL, ROLE_MALE,
    ROLE_NEUTER, ROLE_NEUTRAL, ROLE_NONE, ROLE_RACEMASK, ROLE_RANDOM,
} from './const.js';

const MH_HUMAN = 0x0008;
const MH_ELF = 0x0010;
const MH_DWARF = 0x0020;
const MH_GNOME = 0x0040;
const MH_ORC = 0x0080;

export const roles = [
    {
        name: { m: 'Archeologist', f: null },
        rank: [{ m: 'Digger', f: null }, { m: 'Field Worker', f: null }, { m: 'Investigator', f: null }, { m: 'Exhumer', f: null }, { m: 'Excavator', f: null }, { m: 'Spelunker', f: null }, { m: 'Speleologist', f: null }, { m: 'Collector', f: null }, { m: 'Curator', f: null }],
        filecode: 'Arc',
        mnum: 0,
        allow: MH_HUMAN | MH_DWARF | MH_GNOME | ROLE_MALE | ROLE_FEMALE | ROLE_LAWFUL | ROLE_NEUTRAL,
        gods: ['Quetzalcoatl', 'Camaxtli', 'Huhetotl'],
        xlev: 14, initrecord: 10,
        // C ref: role.c roles[] spell-statistics block (drives spell.c
        // percent_success): { base, heal, shld, armr, stat (A_INT=1/A_WIS=2),
        // spec (special-spell otyp), sbon }.
        spel: { base: 5, heal: 0, shld: 2, armr: 10, stat: 1, spec: 396 /*magic mapping*/, sbon: -4 },
    },
    {
        name: { m: 'Barbarian', f: null },
        rank: [{ m: 'Plunderer', f: 'Plunderess' }, { m: 'Pillager', f: null }, { m: 'Bandit', f: null }, { m: 'Brigand', f: null }, { m: 'Raider', f: null }, { m: 'Reaver', f: null }, { m: 'Slayer', f: null }, { m: 'Chieftain', f: 'Chieftainess' }, { m: 'Conqueror', f: 'Conqueress' }],
        filecode: 'Bar',
        mnum: 1,
        allow: MH_HUMAN | MH_ORC | ROLE_MALE | ROLE_FEMALE | ROLE_NEUTRAL | ROLE_CHAOTIC,
        gods: ['Mitra', 'Crom', 'Set'],
        xlev: 10, initrecord: 10,
        spel: { base: 14, heal: 0, shld: 0, armr: 8, stat: 1, spec: 388 /*haste self*/, sbon: -4 },
    },
    {
        name: { m: 'Caveman', f: 'Cavewoman' },
        rank: [{ m: 'Troglodyte', f: null }, { m: 'Aborigine', f: null }, { m: 'Wanderer', f: null }, { m: 'Vagrant', f: null }, { m: 'Wayfarer', f: null }, { m: 'Roamer', f: null }, { m: 'Nomad', f: null }, { m: 'Rover', f: null }, { m: 'Pioneer', f: null }],
        filecode: 'Cav',
        mnum: 2,
        allow: MH_HUMAN | MH_DWARF | MH_GNOME | ROLE_MALE | ROLE_FEMALE | ROLE_LAWFUL | ROLE_NEUTRAL,
        gods: ['Anu', '_Ishtar', 'Anshar'],
        xlev: 10, initrecord: 0,
        spel: { base: 12, heal: 0, shld: 1, armr: 8, stat: 1, spec: 366 /*dig*/, sbon: -4 },
    },
    {
        name: { m: 'Healer', f: null },
        rank: [{ m: 'Rhizotomist', f: null }, { m: 'Empiric', f: null }, { m: 'Embalmer', f: null }, { m: 'Dresser', f: null }, { m: 'Medicus ossium', f: 'Medica ossium' }, { m: 'Herbalist', f: null }, { m: 'Magister', f: 'Magistra' }, { m: 'Physician', f: null }, { m: 'Chirurgeon', f: null }],
        filecode: 'Hea',
        mnum: 3,
        allow: MH_HUMAN | MH_GNOME | ROLE_MALE | ROLE_FEMALE | ROLE_NEUTRAL,
        gods: ['_Athena', 'Hermes', 'Poseidon'],
        xlev: 20, initrecord: 10,
        spel: { base: 3, heal: -3, shld: 2, armr: 10, stat: 2, spec: 386 /*cure sickness*/, sbon: -4 },
    },
    {
        name: { m: 'Knight', f: null },
        rank: [{ m: 'Gallant', f: null }, { m: 'Esquire', f: null }, { m: 'Bachelor', f: null }, { m: 'Sergeant', f: null }, { m: 'Knight', f: null }, { m: 'Banneret', f: null }, { m: 'Chevalier', f: 'Chevaliere' }, { m: 'Seignieur', f: 'Dame' }, { m: 'Paladin', f: null }],
        filecode: 'Kni',
        mnum: 4,
        allow: MH_HUMAN | ROLE_MALE | ROLE_FEMALE | ROLE_LAWFUL,
        gods: ['Lugh', '_Brigit', 'Manannan Mac Lir'],
        xlev: 10, initrecord: 10,
        spel: { base: 8, heal: -2, shld: 0, armr: 9, stat: 2, spec: 398 /*turn undead*/, sbon: -4 },
    },
    {
        name: { m: 'Monk', f: null },
        rank: [{ m: 'Candidate', f: null }, { m: 'Novice', f: null }, { m: 'Initiate', f: null }, { m: 'Student of Stones', f: null }, { m: 'Student of Waters', f: null }, { m: 'Student of Metals', f: null }, { m: 'Student of Winds', f: null }, { m: 'Student of Fire', f: null }, { m: 'Master', f: null }],
        filecode: 'Mon',
        mnum: 5,
        allow: MH_HUMAN | ROLE_MALE | ROLE_FEMALE | ROLE_LAWFUL | ROLE_NEUTRAL | ROLE_CHAOTIC,
        gods: ['Shan Lai Ching', 'Chih Sung-tzu', 'Huan Ti'],
        xlev: 10, initrecord: 10,
        spel: { base: 8, heal: -2, shld: 2, armr: 20, stat: 2, spec: 392 /*restore ability*/, sbon: -4 },
    },
    {
        name: { m: 'Priest', f: 'Priestess' },
        rank: [{ m: 'Aspirant', f: null }, { m: 'Acolyte', f: null }, { m: 'Adept', f: null }, { m: 'Priest', f: 'Priestess' }, { m: 'Curate', f: null }, { m: 'Canon', f: 'Canoness' }, { m: 'Lama', f: null }, { m: 'Patriarch', f: 'Matriarch' }, { m: 'High Priest', f: 'High Priestess' }],
        filecode: 'Pri',
        mnum: 6,
        allow: MH_HUMAN | MH_ELF | ROLE_MALE | ROLE_FEMALE | ROLE_LAWFUL | ROLE_NEUTRAL | ROLE_CHAOTIC,
        gods: null,
        xlev: 10, initrecord: 0,
        spel: { base: 3, heal: -2, shld: 2, armr: 10, stat: 2, spec: 395 /*remove curse*/, sbon: -4 },
    },
    {
        name: { m: 'Rogue', f: null },
        rank: [{ m: 'Footpad', f: null }, { m: 'Cutpurse', f: null }, { m: 'Rogue', f: null }, { m: 'Pilferer', f: null }, { m: 'Robber', f: null }, { m: 'Burglar', f: null }, { m: 'Filcher', f: null }, { m: 'Magsman', f: 'Magswoman' }, { m: 'Thief', f: null }],
        filecode: 'Rog',
        mnum: 8,
        allow: MH_HUMAN | MH_ORC | ROLE_MALE | ROLE_FEMALE | ROLE_CHAOTIC,
        gods: ['Issek', 'Mog', 'Kos'],
        xlev: 11, initrecord: 10,
        spel: { base: 8, heal: 0, shld: 1, armr: 9, stat: 1, spec: 394 /*detect treasure*/, sbon: -4 },
    },
    {
        name: { m: 'Ranger', f: null },
        rank: [{ m: 'Tenderfoot', f: null }, { m: 'Lookout', f: null }, { m: 'Trailblazer', f: null }, { m: 'Reconnoiterer', f: 'Reconnoiteress' }, { m: 'Scout', f: null }, { m: 'Arbalester', f: null }, { m: 'Archer', f: null }, { m: 'Sharpshooter', f: null }, { m: 'Marksman', f: 'Markswoman' }],
        filecode: 'Ran',
        mnum: 7,
        allow: MH_HUMAN | MH_ELF | MH_GNOME | MH_ORC | ROLE_MALE | ROLE_FEMALE | ROLE_NEUTRAL | ROLE_CHAOTIC,
        gods: ['Mercury', '_Venus', 'Mars'],
        xlev: 12, initrecord: 10,
        spel: { base: 9, heal: 2, shld: 1, armr: 10, stat: 1, spec: 393 /*invisibility*/, sbon: -4 },
    },
    {
        name: { m: 'Samurai', f: null },
        rank: [{ m: 'Hatamoto', f: null }, { m: 'Ronin', f: null }, { m: 'Ninja', f: 'Kunoichi' }, { m: 'Joshu', f: null }, { m: 'Ryoshu', f: null }, { m: 'Kokushu', f: null }, { m: 'Daimyo', f: null }, { m: 'Kuge', f: null }, { m: 'Shogun', f: null }],
        filecode: 'Sam',
        mnum: 9,
        allow: MH_HUMAN | ROLE_MALE | ROLE_FEMALE | ROLE_LAWFUL,
        gods: ['_Amaterasu Omikami', 'Raijin', 'Susanowo'],
        xlev: 11, initrecord: 10,
        spel: { base: 10, heal: 0, shld: 0, armr: 8, stat: 1, spec: 385 /*clairvoyance*/, sbon: -4 },
    },
    {
        name: { m: 'Tourist', f: null },
        rank: [{ m: 'Rambler', f: null }, { m: 'Sightseer', f: null }, { m: 'Excursionist', f: null }, { m: 'Peregrinator', f: 'Peregrinatrix' }, { m: 'Traveler', f: null }, { m: 'Journeyer', f: null }, { m: 'Voyager', f: null }, { m: 'Explorer', f: null }, { m: 'Adventurer', f: null }],
        filecode: 'Tou',
        mnum: 10,
        allow: MH_HUMAN | ROLE_MALE | ROLE_FEMALE | ROLE_NEUTRAL,
        gods: ['Blind Io', '_The Lady', 'Offler'],
        xlev: 14, initrecord: 0,
        spel: { base: 5, heal: 1, shld: 2, armr: 10, stat: 1, spec: 387 /*charm monster*/, sbon: -4 },
    },
    {
        name: { m: 'Valkyrie', f: null },
        rank: [{ m: 'Stripling', f: null }, { m: 'Skirmisher', f: null }, { m: 'Fighter', f: null }, { m: 'Man-at-arms', f: 'Woman-at-arms' }, { m: 'Warrior', f: null }, { m: 'Swashbuckler', f: null }, { m: 'Hero', f: 'Heroine' }, { m: 'Champion', f: null }, { m: 'Lord', f: 'Lady' }],
        filecode: 'Val',
        mnum: 11,
        allow: MH_HUMAN | MH_DWARF | ROLE_FEMALE | ROLE_LAWFUL | ROLE_NEUTRAL,
        gods: ['Tyr', 'Odin', 'Loki'],
        xlev: 10, initrecord: 0,
        spel: { base: 10, heal: -2, shld: 0, armr: 9, stat: 2, spec: 369 /*cone of cold*/, sbon: -4 },
    },
    {
        name: { m: 'Wizard', f: null },
        rank: [{ m: 'Evoker', f: null }, { m: 'Conjurer', f: null }, { m: 'Thaumaturge', f: null }, { m: 'Magician', f: null }, { m: 'Enchanter', f: 'Enchantress' }, { m: 'Sorcerer', f: 'Sorceress' }, { m: 'Necromancer', f: null }, { m: 'Wizard', f: null }, { m: 'Mage', f: null }],
        filecode: 'Wiz',
        mnum: 12,
        allow: MH_HUMAN | MH_ELF | MH_GNOME | MH_ORC | ROLE_MALE | ROLE_FEMALE | ROLE_NEUTRAL | ROLE_CHAOTIC,
        gods: ['Ptah', 'Thoth', 'Anhur'],
        xlev: 12, initrecord: 0,
        spel: { base: 1, heal: 0, shld: 3, armr: 10, stat: 1, spec: 367 /*magic missile*/, sbon: -4 },
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

// C ref: role.c:688 genders[] — struct Gender is { adj, he, him, his,
// filecode, allow } (you.h:301).  The he/him/his columns were missing here;
// you.h:316 uhis() and you.h:323 mhe()/mhim()/mhis() index this table for every
// monster pronoun, and four files already document that (js/wizcmds.js:90,
// js/extcmd-handlers.js:1209, js/monmove.js:6265, js/timeout.js:459).
//
// C's table has FOUR rows: male, female, "neuter" (ROLE_NEUTER — a real gender
// for monsters, never playable because ROLE_GENDERS is 2) and a trailing
// "group"/they row that exists purely so mondata.c:1196 pronoun_gender() can
// return rn2(4) while the hero is hallucinating.  Rows 2 and 3 live in
// PRONOUN_GENDERS below rather than here, and that is a DELIBERATE, MEASURED
// split, not an omission:
//
//   js/jsmain.js:516 (the live setup_gendmenu) and js/jsmain.js:935 (the live
//   reset_role_filtering) iterate `genders.length`, where C uses ROLE_GENDERS
//   and SIZE(genders)-1 respectively.  Appending the two rows here therefore
//   put "neuter" and "group" into the actual chargen gender menu and measured
//   -5 public screens (seed0006 -2, seed0007/seed0012/seed0077 -1 each).
//   Fixing those two bounds in jsmain.js is what lets this table become the
//   4-row C one; until then `genders` stays exactly ROLE_GENDERS long.
export const genders = [
    { name: 'male', adj: 'male', he: 'he', him: 'him', his: 'his', filecode: 'Mal', value: 0, allow: ROLE_MALE },
    { name: 'female', adj: 'female', he: 'she', him: 'her', his: 'her', filecode: 'Fem', value: 1, allow: ROLE_FEMALE },
];

// C ref: role.c:688 genders[] in full — the table mondata.c:1196
// pronoun_gender() indexes, including the hallucination-only rn2(4) row.
// you.h:323 `mhe(mtmp) == genders[pronoun_gender(mtmp, PRONOUN_HALLU)].he`, and
// pronoun_gender() can answer 2 (neuter) or 3 (group), so a two-row table makes
// every hallucinated monster pronoun read `undefined`.
export const PRONOUN_GENDERS = [
    genders[0],
    genders[1],
    { name: 'neuter', adj: 'neuter', he: 'it', him: 'it', his: 'its', filecode: 'Ntr', value: 2, allow: ROLE_NEUTER },
    /* used by pronoun_gender() when hallucinating */
    { name: 'group', adj: 'group', he: 'they', him: 'them', his: 'their', filecode: 'Grp', value: 3, allow: 0 },
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

// C ref: role.c gotrolefilter() — TRUE if any role/race/gender/alignment
// filtering is currently active (used for the "Set/Reset ... filtering" label).
export function gotrolefilter() {
    const f = rfilter();
    if (f.mask) return true;
    if (Array.isArray(f.roles)) for (const v of f.roles) if (v) return true;
    return false;
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
    return rank_of(1, rolenum, female);
}

// C ref: botl.c:298 xlev_to_rank(xlev) — 1..2 => 0, 3..5 => 1, 6..9 => 2, ...
export function xlev_to_rank(xlev) {
    return (xlev <= 2) ? 0 : (xlev <= 30) ? Math.trunc((xlev + 2) / 4) : 8;
}

// Player-monster (PM_) numbers, matching roles[].mnum.
const PM_KNIGHT = 4;
const PM_SAMURAI = 9;
const PM_TOURIST = 10;
const PM_VALKYRIE = 11;

// C ref: botl.c:332 rank_of(lev, monnum, female) — the rank walks DOWN from
// xlev_to_rank(lev) until an entry exists, so a role whose rank[i] has no
// female form falls back to the male form of the SAME index, not to a lower one.
export function rank_of(lev, rolenum, female = false) {
    const role = roles[rolenum];
    if (!role) return 'Player';
    for (let i = xlev_to_rank(lev); i >= 0; i--) {
        const r = role.rank?.[i];
        if (!r) continue;
        if (female && r.f) return r.f;
        if (r.m) return r.m;
    }
    return (female && role.name?.f) || role.name?.m || 'Player';
}

// C ref: role.c Hello() — role-specific greeting word for welcome().
export function Hello(rolenum, mtmp) {
    switch (rolenum) {
    case PM_KNIGHT:
        return 'Salutations';
    case PM_SAMURAI:
        return (mtmp && mtmp.data?.name === 'shopkeeper')
            ? 'Irasshaimase' : 'Konnichi wa';
    case PM_TOURIST:
        return 'Aloha';
    case PM_VALKYRIE:
        return (mtmp && mtmp.data?.name === 'mail daemon') ? 'Hail' : 'Velkommen';
    default:
        return 'Hello';
    }
}

// roles[].gods is [lawfulGod, neutralGod, chaoticGod].
function godForAlign(rolenum, alignType) {
    // C ref: role.c role_init — a role with no own gods (Priest) inherits the
    // randomly chosen flags.pantheon role's god names.  rolenum is the index into
    // the roles[] array (NOT the PM_ mnum; the two differ for Rogue/Ranger).
    let gods = roles[rolenum]?.gods;
    if (!gods && Number.isInteger(game.pantheon))
        gods = roles[game.pantheon]?.gods;
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

// C ref: role.c tty_player_selection() pick4u=='n' (manual menu) branches —
// each facet block counts the valid options with ok_X() (falling back to
// validX() when none are ok) and only shows a menu when the count is > 1; a
// single-valid facet is assigned directly (no menu, no keystroke, no RNG).
// These helpers return {n, k}: n = number of valid choices, k = last valid
// index (the forced value when n == 1), mirroring the C loops exactly.
export function count_ok_race(rolenum, gendnum, alignnum) {
    let n = 0, k = 0;
    for (let i = 0; i < races.length; i++)
        if (ok_race(rolenum, i, gendnum, alignnum)) { n++; k = i; }
    if (n === 0)
        for (let i = 0; i < races.length; i++)
            if (validrace(rolenum, i)) { n++; k = i; }
    return { n, k };
}

export function count_ok_gend(rolenum, racenum, alignnum) {
    let n = 0, k = 0;
    for (let i = 0; i < ROLE_GENDERS; i++)
        if (ok_gend(rolenum, racenum, i, alignnum)) { n++; k = i; }
    if (n === 0)
        for (let i = 0; i < ROLE_GENDERS; i++)
            if (validgend(rolenum, racenum, i)) { n++; k = i; }
    return { n, k };
}

export function count_ok_align(rolenum, racenum, gendnum) {
    let n = 0, k = 0;
    for (let i = 0; i < ROLE_ALIGNS; i++)
        if (ok_align(rolenum, racenum, gendnum, i)) { n++; k = i; }
    if (n === 0)
        for (let i = 0; i < ROLE_ALIGNS; i++)
            if (validalign(rolenum, racenum, i)) { n++; k = i; }
    return { n, k };
}

// ── "Shall I pick ... for you? [ynaq]" prompt ──
// C ref: role.c gr.role_post_attribs / gr.role_pa[] — which facets still have
// to be named in the prompt's trailing list.  hack.h BP_ALIGN 0 .. BP_ROLE 3.
const BP_ALIGN = 0, BP_GEND = 1, BP_RACE = 2, BP_ROLE = 3, NUM_BP = 4;
const gr = { role_post_attribs: 0, role_pa: new Array(NUM_BP).fill(0) };

// C ref: role.c race_alignmentcount().
function race_alignmentcount(racenum) {
    let aligncount = 0;
    if (racenum !== ROLE_NONE && racenum !== ROLE_RANDOM) {
        if (races[racenum].allow & ROLE_CHAOTIC) ++aligncount;
        if (races[racenum].allow & ROLE_LAWFUL) ++aligncount;
        if (races[racenum].allow & ROLE_NEUTRAL) ++aligncount;
    }
    return aligncount;
}

// C ref: role.c role_gendercount().
function role_gendercount(rolenum) {
    let gendcount = 0;
    if (validrole(rolenum)) {
        if (roles[rolenum].allow & ROLE_MALE) ++gendcount;
        if (roles[rolenum].allow & ROLE_FEMALE) ++gendcount;
        if (roles[rolenum].allow & ROLE_NEUTER) ++gendcount;
    }
    return gendcount;
}

// C ref: role.c promptsep() — the ", " / " and " separators, driven by how many
// facets are left to list; it DECREMENTS gr.role_post_attribs as a side effect.
function promptsep(buf, num_post_attribs) {
    if (num_post_attribs > 1 && gr.role_post_attribs < num_post_attribs
        && gr.role_post_attribs > 1)
        buf += ',';
    buf += ' ';
    --gr.role_post_attribs;
    if (!gr.role_post_attribs && num_post_attribs > 1)
        buf += 'and ';
    return buf;
}

// C ref: hacklib.c s_suffix().
function s_suffix(s) {
    if (/^it$/i.test(s)) return s + 's';
    if (/^you$/i.test(s)) return s + 'r';
    return s + (s.endsWith('s') ? "'" : "'s");
}

// C ref: hacklib.c strsubst() — replaces the FIRST occurrence only.
function strsubst(bp, orig, replacement) {
    const found = bp.indexOf(orig);
    return found < 0 ? bp
        : bp.slice(0, found) + replacement + bp.slice(found + orig.length);
}

// C ref: role.c root_plselection_prompt() — "<your lawful female gnomish
// cavewoman>": every facet that is already pinned is spelled out here, and
// every facet still open sets gr.role_pa[] so build_plselection_prompt() can
// list it after the possessive.
function root_plselection_prompt(rolenum, racenum, gendnum, alignnum) {
    let buf = '', donefirst = false, gendercount = 0, aligncount = 0;

    gr.role_post_attribs = 0;
    gr.role_pa = new Array(NUM_BP).fill(0);

    if (racenum !== ROLE_NONE && racenum !== ROLE_RANDOM)
        aligncount = race_alignmentcount(racenum);

    if (alignnum !== ROLE_NONE && alignnum !== ROLE_RANDOM
        && ok_align(rolenum, racenum, gendnum, alignnum)) {
        if (donefirst) buf += ' ';
        buf += aligns[alignnum].adj;
        donefirst = true;
    } else {
        // C keeps this reset in a local, and the ok_race() tests below see it.
        if (alignnum !== ROLE_RANDOM) alignnum = ROLE_NONE;
        if ((((racenum !== ROLE_NONE && racenum !== ROLE_RANDOM)
              && ok_race(rolenum, racenum, gendnum, alignnum))
             && (aligncount > 1))
            || (racenum === ROLE_NONE || racenum === ROLE_RANDOM)) {
            gr.role_pa[BP_ALIGN] = 1;
            gr.role_post_attribs++;
        }
    }

    if (validrole(rolenum)) gendercount = role_gendercount(rolenum);

    if (gendnum !== ROLE_NONE && gendnum !== ROLE_RANDOM) {
        if (validrole(rolenum)) {
            if (rolenum !== ROLE_NONE && gendercount > 1
                && !roles[rolenum].name.f) {
                if (donefirst) buf += ' ';
                buf += genders[gendnum].adj;
                donefirst = true;
            }
        } else {
            if (donefirst) buf += ' ';
            buf += genders[gendnum].adj;
            donefirst = true;
        }
    } else if ((validrole(rolenum) && gendercount > 1) || !validrole(rolenum)) {
        gr.role_pa[BP_GEND] = 1;
        gr.role_post_attribs++;
    }

    if (racenum !== ROLE_NONE && racenum !== ROLE_RANDOM) {
        if (validrole(rolenum) && ok_race(rolenum, racenum, gendnum, alignnum)) {
            if (donefirst) buf += ' ';
            buf += (rolenum === ROLE_NONE) ? races[racenum].noun
                                           : races[racenum].adj;
            donefirst = true;
        } else if (!validrole(rolenum)) {
            if (donefirst) buf += ' ';
            buf += races[racenum].noun;
            donefirst = true;
        } else {
            gr.role_pa[BP_RACE] = 1;
            gr.role_post_attribs++;
        }
    } else {
        gr.role_pa[BP_RACE] = 1;
        gr.role_post_attribs++;
    }

    if (validrole(rolenum)) {
        if (donefirst) buf += ' ';
        if (gendnum !== ROLE_NONE) {
            buf += (gendnum === 1 && roles[rolenum].name.f)
                ? roles[rolenum].name.f : roles[rolenum].name.m;
        } else {
            buf += roles[rolenum].name.f
                ? `${roles[rolenum].name.m}/${roles[rolenum].name.f}`
                : roles[rolenum].name.m;
        }
        donefirst = true;
    } else if (rolenum === ROLE_NONE) {
        gr.role_pa[BP_ROLE] = 1;
        gr.role_post_attribs++;
    }

    if ((racenum === ROLE_NONE || racenum === ROLE_RANDOM)
        && !validrole(rolenum)) {
        if (donefirst) buf += ' ';
        buf += 'character';
    }
    return buf;
}

// C ref: role.c build_plselection_prompt() — returns the whole yn_function
// query, INCLUDING the "[ynaq]" (genl_player_setup passes choices=NULL so
// yn_function adds nothing) and C's trailing space, which the caller trims.
export function build_plselection_prompt(rolenum, racenum, gendnum, alignnum) {
    let tmpbuf = 'Shall I pick ';
    tmpbuf += (racenum !== ROLE_NONE || validrole(rolenum)) ? 'your ' : 'a ';
    tmpbuf += root_plselection_prompt(rolenum, racenum, gendnum, alignnum);
    // "pick a character's <anything>" sounds stilted, so C drops the article.
    tmpbuf = strsubst(tmpbuf, 'pick a character', 'pick character');
    let buf = s_suffix(tmpbuf);
    if (buf.endsWith("priest/priestess'")) buf += 's';

    let num_post_attribs = gr.role_post_attribs;
    if (!num_post_attribs) {
        // Mutually exclusive constraints can leave nothing to list; then C asks
        // about every facet the config did not pin.
        if (game.initrole === ROLE_NONE && !gr.role_pa[BP_ROLE])
            gr.role_pa[BP_ROLE] = ++gr.role_post_attribs;
        if (game.initrace === ROLE_NONE && !gr.role_pa[BP_RACE])
            gr.role_pa[BP_RACE] = ++gr.role_post_attribs;
        if (game.initalign === ROLE_NONE && !gr.role_pa[BP_ALIGN])
            gr.role_pa[BP_ALIGN] = ++gr.role_post_attribs;
        if (game.initgend === ROLE_NONE && !gr.role_pa[BP_GEND])
            gr.role_pa[BP_GEND] = ++gr.role_post_attribs;
        num_post_attribs = gr.role_post_attribs;
    }
    if (num_post_attribs) {
        if (gr.role_pa[BP_RACE]) { buf = promptsep(buf, num_post_attribs); buf += 'race'; }
        if (gr.role_pa[BP_ROLE]) { buf = promptsep(buf, num_post_attribs); buf += 'role'; }
        if (gr.role_pa[BP_GEND]) { buf = promptsep(buf, num_post_attribs); buf += 'gender'; }
        if (gr.role_pa[BP_ALIGN]) { buf = promptsep(buf, num_post_attribs); buf += 'alignment'; }
    }
    return `${buf} for you? [ynaq] `;
}

// ─────────────────────────────────────────────────────────────────────────────
// role.c: the remaining top-level functions.
//
// A faithful, INERT translation.  Nothing above this line calls into this
// block and the existing chargen path is untouched — js/jsmain.js drives role
// selection with its own method-shaped copies of setup_rolemenu() /
// role_menu_extra() / maybe_skip_seps() (jsmain.js:466, :595, :578) and
// js/fastforward.js:35 fastforward_role_init() is the live reduced copy of
// role_init()'s RNG draws.  Those are the ones the sessions run; these are the
// C shapes, so that when the real window layer arrives the correct function is
// already here rather than needing to be re-derived.
//
// Every import below is dynamic: role.js sits very early in the module graph
// (options.js imports it) and adding modules to its static graph reorders ESM
// evaluation, which this port is measurably sensitive to.

import { RS_NAME, RS_ROLE, RS_RACE, RS_GENDER, RS_ALGNMNT } from './const.js';

// C ref: winprocs.h:313 `#define RS_filter 5` and winprocs.h:314
// `#define RS_menu_arg(x) (ROLE_RANDOM - ((x) + 1))  /* 0..5 -> -3..-8 */`.
// const.js exports RS_NAME..RS_ALGNMNT but not these two.
//
// NOTE a real divergence: js/options.js:2691 defines its OWN
// `RS_ROLE = 0, RS_RACE = 1, RS_GENDER = 2, RS_ALGNMNT = 3`, i.e. shifted by
// one from winprocs.h.  options.js only ever passes them to its own private
// clearrolefilter()/setrolefilter(), so it is self-consistent — but the two
// numberings must never be mixed across the two files.
export const RS_filter = 5;
export function RS_menu_arg(x) { return ROLE_RANDOM - (x + 1); }

// C ref: the tty window API — create_nhwindow / start_menu / add_menu /
// add_menu_str / end_menu / select_menu / putstr / destroy_nhwindow.  This port
// has no shared window layer (frozen/terminal.js owns the grid), so each inert
// port keeps its own descriptor: js/topten.js:337 and js/end.js:1375 do exactly
// this.  A "window" here is a plain object whose `strs` and `items` record what
// C would have drawn, which is what makes the four setup_*menu() builders below
// verifiable without a terminal.
const NHW_MENU = 4, MENU_BEHAVE_STANDARD = 0;
const ATR_NONE = 0, NO_COLOR = 0;
const MENU_ITEMFLAGS_NONE = 0, MENU_ITEMFLAGS_SELECTED = 1;
const PICK_ANY = 2;

export function rs_create_nhwindow(type) {
    return { type, strs: [], items: [], prompt: null, behave: null };
}
export function rs_start_menu(win, behave) { win.behave = behave; win.items = []; }
export function rs_add_menu_str(win, str) {
    win.strs.push(str);
    win.items.push({ str, selector: 0, groupacc: 0, any: null });
}
export function rs_add_menu(win, any, selector, groupacc, attr, clr, text, itemflags) {
    win.items.push({ str: text, selector, groupacc, attr, clr, any, itemflags });
}
export function rs_end_menu(win, prompt) { win.prompt = prompt; }
export function rs_putstr(win, attr, str) { win.strs.push(str); void attr; }

// C ref: hacklib.c lowc(c) / highc(c) — first character folded.  Six files in
// js/ carry the same one-liners (js/objnam.js:60, js/topten.js:188, ...).
function lowc(c) { return String(c ?? '').charAt(0).toLowerCase(); }
function highc(c) { return String(c ?? '').charAt(0).toUpperCase(); }
// C ref: objnam.c an(str).
function rs_an(s) { return /^[aeiou]/i.test(String(s)) ? `an ${s}` : `a ${s}`; }

// The four aspect tables' C sizes.  C's roles[] and races[] are NULL-terminated
// so `SIZE(x) - 1` is the number of REAL rows; genders[] and aligns[] are not
// terminated, so `SIZE(genders) - 1` is 3 (male/female/neuter, deliberately
// excluding the hallucination-only "group" row) and `SIZE(aligns) - 1` is 3
// (lawful/neutral/chaotic, excluding C's trailing "unaligned" row, which this
// port's aligns[] does not carry at all).
const C_NROLES = () => roles.length;              /* SIZE(roles) - 1  == 13 */
const C_NRACES = () => races.length;              /* SIZE(races) - 1  ==  5 */
const C_NGENDERS_FILTER = () => PRONOUN_GENDERS.length - 1; /* SIZE(genders)-1 == 3 */
const C_NALIGNS_FILTER = () => aligns.length;     /* SIZE(aligns) - 1 ==  3 */

// C ref: role.c:1284 setrolefilter(bufp) — "!Bar" style RC entries.  js has a
// private copy at js/options.js:2708; this is the C shape, including the return
// value that tells the caller the token was not recognised at all.
export function setrolefilter(bufp) {
    const f = rfilter();
    if (!game.rfilter) game.rfilter = f;
    if (!Array.isArray(f.roles)) f.roles = [];
    let i;
    let reslt = true;

    if ((i = str2role(bufp)) !== ROLE_NONE && i !== ROLE_RANDOM)
        f.roles[i] = true;
    else if ((i = str2race(bufp)) !== ROLE_NONE && i !== ROLE_RANDOM)
        f.mask |= races[i].selfmask;
    else if ((i = str2gend(bufp)) !== ROLE_NONE && i !== ROLE_RANDOM)
        f.mask |= genders[i].allow;
    else if ((i = str2align(bufp)) !== ROLE_NONE && i !== ROLE_RANDOM)
        f.mask |= aligns[i].allow;
    else
        reslt = false;
    return reslt;
}

// C ref: role.c:1358 clearrolefilter(which) — note the RS_filter FALLTHROUGH
// into RS_ROLE: clearing "the filter" clears the mask AND the per-role array.
export function clearrolefilter(which) {
    const f = rfilter();
    if (!game.rfilter) game.rfilter = f;
    let i;

    switch (which) {
    case RS_filter:
        f.mask = 0; /* clear race, gender, and alignment filters */
        /* FALLTHRU */
    case RS_ROLE:
        for (i = 0; i < C_NROLES(); ++i) f.roles[i] = false;
        break;
    case RS_RACE:
        f.mask &= ~ROLE_RACEMASK;
        break;
    case RS_GENDER:
        f.mask &= ~ROLE_GENDMASK;
        break;
    case RS_ALGNMNT:
        f.mask &= ~ROLE_ALIGNMASK;
        break;
    default:
        break;
    }
}

// C ref: role.c:1318 rolefilterstring(outbuf, which) — "create a string like
// ' !Bar !Kni' or ' !chaotic' that can be put back into an RC file by
// #saveoptions".  C builds it with a leading space and returns &outbuf[1];
// this returns the same string without that space.  Roles are abbreviated to
// their first THREE characters ("%.3s") — i.e. "!Arc", not "!Archeologist".
export function rolefilterstring(outbuf, which) {
    const f = rfilter();
    let buf = '';
    let i;

    switch (which) {
    case RS_ROLE:
        for (i = 0; i < C_NROLES(); ++i)
            if (f.roles?.[i]) buf += ` !${roles[i].name.m.slice(0, 3)}`;
        break;
    case RS_RACE:
        for (i = 0; i < C_NRACES(); ++i)
            if ((f.mask & races[i].selfmask) !== 0) buf += ` !${races[i].noun}`;
        break;
    case RS_GENDER:
        for (i = 0; i < C_NGENDERS_FILTER(); ++i)
            if ((f.mask & PRONOUN_GENDERS[i].allow) !== 0)
                buf += ` !${PRONOUN_GENDERS[i].adj}`;
        break;
    case RS_ALGNMNT:
        for (i = 0; i < C_NALIGNS_FILTER(); ++i)
            if ((f.mask & aligns[i].allow) !== 0) buf += ` !${aligns[i].adj}`;
        break;
    default:
        /* C: impossible("rolefilterstring: bad role aspect (%d)", which) */
        buf = ' ?';
        break;
    }
    void outbuf;
    /* constructed with a leading space; drop it */
    return buf.slice(1);
}

// C ref: role.c:1665 plnamesuffix() — "Strip the role letter out of the player
// name.  This is included for backwards compatibility."  Two jobs:
//   1. blank out a name that matches sysopt.genericusers (so askname() runs),
//      where a bare '*' means "every username is generic";
//   2. split what is left on '-' and feed each token to str2role/str2race/
//      str2gend/str2align, so `-u Bob-Val-dwa-fem-neu` pins four facets.
// gp.plnamelen is non-zero only when the username itself contains a dash, and
// it is reset every time askname() refills plname[].
//
// C's loop repeats until plname[] is non-empty (or askname() deferred it), so a
// generic username asks again rather than falling through with no name.
export function plnamesuffix() {
    const g = game;
    let sptr, eptr, i;

    /* some generic user names will be ignored in favor of prompting */
    const genericusers = g.sysopt?.genericusers;
    if (genericusers) {
        if (genericusers[0] === '*') {
            g.plname = '';
        } else {
            /* need to ignore appended '-role-race-gender-alignment';
               'plnamelen' is non-zero when dealing with plname[] value that
               contains a username with dash(es) in it and is usually 0 */
            const start = g.plnamelen | 0;
            const dash = String(g.plname || '').indexOf('-', start);
            i = (dash >= 0) ? dash : String(g.plname || '').length;
            /* look for plname[] in the 'genericusers' space-separated list */
            if (rs_findword(genericusers, String(g.plname || ''), i))
                /* it's generic; remove it so that askname() will be called */
                g.plname = '';
        }
        if (!g.plname) g.plnamelen = 0;
    }

    do {
        if (!g.plname) {
            // UNPORTED: files.c askname().  The chargen name prompt lives in
            // js/jsmain.js (see [[chargen-plselection-path]]: it is NOT
            // getlin), and calling into it from here would drag the whole
            // display layer into role.js.  C would fill plname[] or set
            // iflags.defer_plname; without it the loop below must not spin, so
            // break out exactly as the defer_plname case does.
            g.plnamelen = 0;
            break;
        }

        /* Look for tokens delimited by '-' */
        const parts = String(g.plname).slice(g.plnamelen | 0).split('-');
        sptr = parts[0];
        g.plname = String(g.plname).slice(0, g.plnamelen | 0) + sptr;
        for (let k = 1; k < parts.length; k++) {
            /* Isolate the next token */
            eptr = parts[k];

            /* Try to match it to something */
            if ((i = str2role(eptr)) !== ROLE_NONE) g.initrole = i;
            else if ((i = str2race(eptr)) !== ROLE_NONE) g.initrace = i;
            else if ((i = str2gend(eptr)) !== ROLE_NONE) g.initgend = i;
            else if ((i = str2align(eptr)) !== ROLE_NONE) g.initalign = i;
        }
    } while (!g.plname && !game.iflags?.defer_plname);

    /* commas in the plname confuse the record file, convert to spaces */
    g.plname = String(g.plname || '').replace(/,/g, ' ');
}

// C ref: hacklib.c findword(list, word, len, ignorecase) — is `word` (its first
// `len` chars) one of the space-separated entries of `list`?
function rs_findword(list, word, len) {
    const needle = String(word).slice(0, len);
    if (!needle) return false;
    return String(list).split(/\s+/).some((w) => w === needle);
}

// C ref: role.c:1726 role_selection_prolog(which, where) — the five-line
// "name: / role: / race: / gender: / alignment:" header the extended selection
// menus carry.  The aspect being chosen right now reads " choosing now"; an
// unset one " not yet specified"; ROLE_RANDOM " random".
//
// The constraint propagation is the interesting part and is one-directional:
// a chosen role can pin race (Samurai => human), gender (Valkyrie => female)
// and alignment, and a chosen race can pin alignment (orc => chaotic); gender
// and alignment never narrow anything else enough to matter.
export function role_selection_prolog(which, where) {
    const choosing = ' choosing now', not_yet = ' not yet specified',
          rand_choice = ' random';
    let buf;
    let r, c, gend, a, allowmask;

    r = game.initrole;
    c = game.initrace;
    gend = game.initgend;
    a = game.initalign;
    if (r >= 0) {
        allowmask = roles[r].allow;
        if ((allowmask & ROLE_RACEMASK) === MH_HUMAN)
            c = 0; /* races[human] */
        else if (IndexOkT(c, races)
                 && !(allowmask & ROLE_RACEMASK & races[c].allow))
            c = ROLE_RANDOM;
        if ((allowmask & ROLE_GENDMASK) === ROLE_MALE)
            gend = 0; /* role forces male (hypothetical) */
        else if ((allowmask & ROLE_GENDMASK) === ROLE_FEMALE)
            gend = 1; /* role forces female (valkyrie) */
        if ((allowmask & ROLE_ALIGNMASK) === AM_LAWFUL) a = 0;
        else if ((allowmask & ROLE_ALIGNMASK) === AM_NEUTRAL) a = 1;
        else if ((allowmask & ROLE_ALIGNMASK) === AM_CHAOTIC) a = 2;
    }
    if (c >= 0) {
        allowmask = races[c].allow;
        if ((allowmask & ROLE_ALIGNMASK) === AM_LAWFUL) a = 0;
        else if ((allowmask & ROLE_ALIGNMASK) === AM_NEUTRAL) a = 1;
        else if ((allowmask & ROLE_ALIGNMASK) === AM_CHAOTIC) a = 2;
        /* [c never forces gender] */
    }
    /* [g and a don't constrain anything sufficiently to narrow something
       down to a single choice] */

    buf = `${'name:'.padStart(12)} `;
    buf += (which === RS_NAME) ? choosing
        : !game.plname ? not_yet : game.plname;
    rs_putstr(where, 0, buf);

    buf = `${'role:'.padStart(12)} `;
    buf += (which === RS_ROLE) ? choosing
        : (r === ROLE_NONE) ? not_yet
        : (r === ROLE_RANDOM) ? rand_choice
        : roles[r].name.m;
    if (r >= 0 && roles[r].name.f) {
        /* distinct female name [caveman/cavewoman, priest/priestess] */
        if (gend === 1) {
            /* female specified; replace male role name with female one */
            const cut = buf.indexOf(':');
            buf = `${buf.slice(0, cut)}: ${roles[r].name.f}`;
        } else if (gend < 0) {
            /* gender unspecified; append slash and female role name */
            buf += `/${roles[r].name.f}`;
        }
    }
    rs_putstr(where, 0, buf);

    buf = `${'race:'.padStart(12)} `;
    buf += (which === RS_RACE) ? choosing
        : (c === ROLE_NONE) ? not_yet
        : (c === ROLE_RANDOM) ? rand_choice
        : races[c].noun;
    rs_putstr(where, 0, buf);

    buf = `${'gender:'.padStart(12)} `;
    buf += (which === RS_GENDER) ? choosing
        : (gend === ROLE_NONE) ? not_yet
        : (gend === ROLE_RANDOM) ? rand_choice
        : genders[gend].adj;
    rs_putstr(where, 0, buf);

    buf = `${'alignment:'.padStart(12)} `;
    buf += (which === RS_ALGNMNT) ? choosing
        : (a === ROLE_NONE) ? not_yet
        : (a === ROLE_RANDOM) ? rand_choice
        : aligns[a].adj;
    rs_putstr(where, 0, buf);
}

// C ref: role.c:1816 role_menu_extra(which, where, preselect) — "add a 'pick
// alignment first'-type entry to the specified menu".  It emits ONE line, and
// which line is the whole subtlety:
//   * when the aspect is already forced to a single value by role, race or the
//     user's filters, an UNSELECTABLE "<constrainer> forces <value>" line
//     faked-grey with four leading spaces (add_menu_str, so no selector);
//   * otherwise a selectable "Pick [another] <what> first" whose selector is
//     one of `= ? / " [` indexed by RS_NAME..RS_ALGNMNT;
//   * RS_filter emits "Set/Reset role/race/&c filtering" on '~';
//   * ROLE_RANDOM emits "Random" on '*' and ROLE_NONE "Quit" on 'q', either of
//     which can be preselected.
// C computes `f` (the aspect's current value) so that "another" appears only
// when the aspect already has a value.
export function role_menu_extra(which, where, preselect) {
    const RS_menu_let = ['=', '?', '/', '"', '['];
    let what = null, constrainer = null, forcedvalue = null;
    let f = 0, r, c, gend, a, i, allowmask;
    const clr = NO_COLOR;
    const fmask = rfilter().mask | 0;
    let any;

    r = game.initrole;
    c = game.initrace;
    switch (which) {
    case RS_NAME:
        what = 'name';
        break;
    case RS_ROLE:
        what = 'role';
        f = r;
        for (i = 0; i < C_NROLES(); ++i)
            if (i !== f && !rfilter().roles?.[i]) break;
        if (i === C_NROLES()) {
            constrainer = 'filter';
            forcedvalue = 'role';
        }
        break;
    case RS_RACE:
        what = 'race';
        f = game.initrace;
        c = ROLE_NONE; /* override player's setting */
        if (r >= 0) {
            allowmask = roles[r].allow & ROLE_RACEMASK;
            if (allowmask === MH_HUMAN) c = 0; /* races[human] */
            if (c >= 0) {
                constrainer = 'role';
                forcedvalue = races[c].noun;
            } else if (f >= 0 && ((allowmask & ~fmask) === races[f].selfmask)) {
                /* if there is only one race choice available due to user
                   options disallowing others, race menu entry is disabled */
                constrainer = 'filter';
                forcedvalue = 'race';
            }
        }
        break;
    case RS_GENDER:
        what = 'gender';
        f = game.initgend;
        gend = ROLE_NONE;
        if (r >= 0) {
            allowmask = roles[r].allow & ROLE_GENDMASK;
            if (allowmask === ROLE_MALE) gend = 0;         /* genders[male] */
            else if (allowmask === ROLE_FEMALE) gend = 1;  /* genders[female] */
            if (gend >= 0) {
                constrainer = 'role';
                forcedvalue = genders[gend].adj;
            } else if (f >= 0 && ((allowmask & ~fmask) === genders[f].allow)) {
                /* if there is only one gender choice available due to user
                   options disallowing other, gender menu entry is disabled */
                constrainer = 'filter';
                forcedvalue = 'gender';
            }
        }
        break;
    case RS_ALGNMNT:
        what = 'alignment';
        f = game.initalign;
        a = ROLE_NONE;
        if (r >= 0) {
            allowmask = roles[r].allow & ROLE_ALIGNMASK;
            if (allowmask === AM_LAWFUL) a = 0;
            else if (allowmask === AM_NEUTRAL) a = 1;
            else if (allowmask === AM_CHAOTIC) a = 2;
            if (a >= 0) constrainer = 'role';
        }
        if (c >= 0 && !constrainer) {
            allowmask = races[c].allow & ROLE_ALIGNMASK;
            if (allowmask === AM_LAWFUL) a = 0;
            else if (allowmask === AM_NEUTRAL) a = 1;
            else if (allowmask === AM_CHAOTIC) a = 2;
            if (a >= 0) constrainer = 'race';
        }
        if (f >= 0 && !constrainer
            && (ROLE_ALIGNMASK & ~fmask) === aligns[f].allow) {
            /* if there is only one alignment choice available due to user
               options disallowing others, algn menu entry is disabled */
            constrainer = 'filter';
            forcedvalue = 'alignment';
        }
        if (a >= 0) forcedvalue = aligns[a].adj;
        break;
    default:
        break;
    }

    if (constrainer) {
        /* use four spaces of padding to fake a grayed out menu choice */
        rs_add_menu_str(where, `    ${constrainer} forces ${forcedvalue}`);
    } else if (what) {
        any = { a_int: RS_menu_arg(which) };
        rs_add_menu(where, any, RS_menu_let[which], 0, ATR_NONE, clr,
                    `Pick${(f >= 0) ? ' another' : ''} ${what} first`,
                    MENU_ITEMFLAGS_NONE);
    } else if (which === RS_filter) {
        any = { a_int: RS_menu_arg(RS_filter) };
        rs_add_menu(where, any, '~', 0, ATR_NONE, clr,
                    `${gotrolefilter() ? 'Reset' : 'Set'} role/race/&c filtering`,
                    MENU_ITEMFLAGS_NONE);
    } else if (which === ROLE_RANDOM) {
        any = { a_int: ROLE_RANDOM };
        rs_add_menu(where, any, '*', 0, ATR_NONE, clr, 'Random',
                    preselect ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
    } else if (which === ROLE_NONE) {
        any = { a_int: ROLE_NONE };
        rs_add_menu(where, any, 'q', 0, ATR_NONE, clr, 'Quit',
                    preselect ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
    }
    /* else C: impossible("role_menu_extra: bad arg (%d)", which) */
}

// C ref: include/align.h AM_LAWFUL/AM_NEUTRAL/AM_CHAOTIC as they appear in a
// roles[].allow mask — these ARE ROLE_LAWFUL/ROLE_NEUTRAL/ROLE_CHAOTIC (the
// role.h ROLE_* alignment bits are #defined to the align.h AM_* values), so the
// masks role_selection_prolog()/role_menu_extra() compare against are the same
// bits the tables were built with.
const AM_LAWFUL = ROLE_LAWFUL, AM_NEUTRAL = ROLE_NEUTRAL,
      AM_CHAOTIC = ROLE_CHAOTIC;

// C ref: role.c:1980 role_init() — "this is going to have to be done on each
// newgame or restore, because you lose the permonst mods across a
// save/restore", and it also replaces quest_init().
//
// RNG-wise there are exactly three places this can draw, and they are why
// js/fastforward.js:35 exists at all:
//   * randrole_filtered() when no valid role was pinned;
//   * `rn2(100) < 50` for the quest LEADER and again for the quest NEMESIS,
//     but ONLY when that monster's permonst carries none of neuter/female/male
//     (in 3.7 that is the Archeologist's and Wizard's nemesis);
//   * the `while (!roles[pantheon].lgod) pantheon = randrole(FALSE)` loop,
//     which runs for the Priest (the only role with no gods of its own).
export async function role_init() {
    const g = game;
    const { MFLAGS2, MFLAGS3, MSOUND, MS_LEADER, MS_NEMESIS,
            M2_PEACEFUL, M2_HOSTILE, M2_NASTY, M2_STALK,
            M3_CLOSE, M3_WANTSARTI, M3_WAITFORU } = await import('./monflags_data.js');
    const { name_to_pmidx } = await import('./makemon.js');
    let alignmnt;

    /* Strip the role letter out of the player name. */
    plnamesuffix();

    /* Check for a valid role.  Try flags.initrole first. */
    if (!validrole(g.initrole)) {
        /* Try the player letter second */
        if ((g.initrole = str2role(g.pl_character)) < 0)
            /* None specified; pick a random role */
            g.initrole = randrole_filtered();
    }

    /* We now have a valid role index.  Copy the role name back.
       This should become OBSOLETE */
    g.pl_character = roles[g.initrole].name.m;

    /* Check for a valid race */
    if (!validrace(g.initrole, g.initrace))
        g.initrace = randrace(g.initrole);

    /* Check for a valid gender.  If new game, check both initgend and female.
       On restore, assume flags.female is correct. */
    if (g.pantheon === -1 || g.pantheon == null) { /* new game */
        if (!validgend(g.initrole, g.initrace, g.female ? 1 : 0))
            g.female = !g.female;
    }
    if (!validgend(g.initrole, g.initrace, g.initgend))
        /* Note that there is no way to check for an unspecified gender. */
        g.initgend = g.female ? 1 : 0;

    /* Check for a valid alignment */
    if (!validalign(g.initrole, g.initrace, g.initalign))
        /* Pick a random alignment */
        g.initalign = randalign(g.initrole, g.initrace);
    alignmnt = aligns[g.initalign].value;

    /* Initialize gu.urole and gu.urace */
    g.urole = { ...roles[g.initrole] };
    g.urace = { ...races[g.initrace] };

    if (!g.quest_status) g.quest_status = {};

    // C ref: role.c roles[].ldrnum / .guardnum / .neminum.  js/role.js's
    // roles[] table does NOT carry those three columns, so they are resolved
    // here by monster NAME instead; ROLE_QUEST below is that mapping, in
    // roles[] order.  This is the one part of role_init() that has no data to
    // stand on in the port, and it is the part that DRAWS — see the two
    // rn2(100) sites below.
    const q = ROLE_QUEST[g.initrole] || {};
    const ldrnum = q.ldr ? name_to_pmidx(q.ldr) : -1;
    const guardnum = q.guard ? name_to_pmidx(q.guard) : -1;
    const neminum = q.nemesis ? name_to_pmidx(q.nemesis) : -1;

    /* Fix up the quest leader */
    if (ldrnum >= 0) {
        MSOUND[ldrnum] = MS_LEADER;
        MFLAGS2[ldrnum] |= M2_PEACEFUL;
        MFLAGS3[ldrnum] |= M3_CLOSE;
        rs_set_maligntyp(ldrnum, alignmnt * 3);
        /* if gender is random, we choose it now instead of waiting until the
           leader monster is created */
        g.quest_status.ldrgend =
            rs_is_neuter(ldrnum) ? 2 : rs_is_female(ldrnum) ? 1
            : rs_is_male(ldrnum) ? 0 : ((rn2(100) < 50) ? 1 : 0);
    }

    /* Fix up the quest guardians */
    if (guardnum >= 0) {
        MFLAGS2[guardnum] |= M2_PEACEFUL;
        rs_set_maligntyp(guardnum, alignmnt * 3);
    }

    /* Fix up the quest nemesis */
    if (neminum >= 0) {
        MSOUND[neminum] = MS_NEMESIS;
        MFLAGS2[neminum] &= ~M2_PEACEFUL;
        MFLAGS2[neminum] |= (M2_NASTY | M2_STALK | M2_HOSTILE);
        MFLAGS3[neminum] &= ~M3_CLOSE;
        MFLAGS3[neminum] |= M3_WANTSARTI | M3_WAITFORU;
        /* if gender is random, we choose it now instead of waiting until the
           nemesis monster is created */
        g.quest_status.nemgend =
            rs_is_neuter(neminum) ? 2 : rs_is_female(neminum) ? 1
            : rs_is_male(neminum) ? 0 : ((rn2(100) < 50) ? 1 : 0);
    }

    /* Fix up the god names */
    if (g.pantheon === -1 || g.pantheon == null) {  /* new game */
        let trycnt = 0;
        g.pantheon = g.initrole;                    /* use own gods */
        /* unless they're missing */
        while (!roles[g.pantheon].gods && ++trycnt < 100)
            g.pantheon = randrole(false);
        if (!roles[g.pantheon].gods) {
            for (let i = 0; i < C_NROLES(); i++)
                if (roles[i].gods) { g.pantheon = i; break; }
        }
    }
    if (!g.urole.gods) {
        g.urole.gods = roles[g.pantheon].gods;
    }
    /* 0 or 1; no gods are neuter, nor is gender randomized */
    g.quest_status.godgend =
        (align_gtitle(g.initrole, alignmnt).toLowerCase() === 'goddess') ? 1 : 0;

    if (g.initrole === ROLE_PRIEST) {
        // C: objects[SPE_LIGHT].oc_skill = P_CLERIC_SPELL — a Priest's
        // spellbook of light is a clerical spell rather than an attack one.
        const { objects } = await import('./mkobj.js');
        const SPE_LIGHT = objects.findIndex((o) => o.name === 'light');
        const P_CLERIC_SPELL = 32;   /* skills.h */
        if (SPE_LIGHT >= 0) objects[SPE_LIGHT].oc_skill = P_CLERIC_SPELL;
    }

    /* The mons[] "Fix up infravision" block is `#if 0`'d out in 3.7 so that
       mons[] can be const; set_uasmon() reads mons[race] instead. */
    /* Artifacts are fixed in hack_artifacts() */
}

// C ref: role.c roles[].ldrnum / .guardnum / .neminum, in roles[] order
// (Arc, Bar, Cav, Hea, Kni, Mon, Pri, Rog, Ran, Sam, Tou, Val, Wiz — note
// Rogue precedes Ranger, matching both C and this file's roles[]).  Named
// rather than PM_-numbered so a mons[] index shift cannot silently repoint one.
const ROLE_QUEST = [
    { ldr: 'Lord Carnarvon', guard: 'student', nemesis: 'Minion of Huhetotl' },
    { ldr: 'Pelias', guard: 'chieftain', nemesis: 'Thoth Amon' },
    { ldr: 'Shaman Karnov', guard: 'neanderthal', nemesis: 'Chromatic Dragon' },
    { ldr: 'Hippocrates', guard: 'attendant', nemesis: 'Cyclops' },
    { ldr: 'King Arthur', guard: 'page', nemesis: 'Ixoth' },
    { ldr: 'Grand Master', guard: 'abbot', nemesis: 'Master Kaen' },
    { ldr: 'Arch Priest', guard: 'acolyte', nemesis: 'Nalzok' },
    { ldr: 'Master of Thieves', guard: 'thug', nemesis: 'Master Assassin' },
    { ldr: 'Orion', guard: 'hunter', nemesis: 'Scorpius' },
    { ldr: 'Lord Sato', guard: 'roshi', nemesis: 'Ashikaga Takauji' },
    { ldr: 'Twoflower', guard: 'guide', nemesis: 'Master of Thieves' },
    { ldr: 'Norn', guard: 'warrior', nemesis: 'Lord Surtur' },
    { ldr: 'Neferet the Green', guard: 'apprentice', nemesis: 'Dark One' },
];

// C ref: mondata.h is_neuter/is_female/is_male (ptr->mflags2 & M2_NEUTER etc.)
// and permonst.maligntyp.  The generated tables are the port's mons[] columns.
function rs_is_neuter(pmidx) { return rs_mflag2(pmidx, 0x40000); }  /* M2_NEUTER */
function rs_is_female(pmidx) { return rs_mflag2(pmidx, 0x20000); }  /* M2_FEMALE */
function rs_is_male(pmidx) { return rs_mflag2(pmidx, 0x10000); }    /* M2_MALE */
function rs_mflag2(pmidx, bit) {
    const t = game._MFLAGS2_cache;
    return !!(t ? (t[pmidx] | 0) & bit : 0);
}
function rs_set_maligntyp(pmidx, val) {
    const m = game.mons?.[pmidx];
    if (m) m.maligntyp = val;
}

// C ref: role.c:2163 character_race(pmindex) — "if pmindex is any player race
// (not necessarily the hero's), return a pointer to the races[] entry for it;
// if pmindex is for some other type of monster which isn't a player race,
// return Null".
//
// DIVERGENCE: C's races[].mnum IS the PM_ number (PM_HUMAN == 260); this port's
// races[].mnum is the 0..4 race INDEX, and js/roles.js:39 carries the PM_
// numbers in a separate `basepm` column.  So the scan has to go through the
// table below rather than through races[i].mnum, which would answer "human" for
// pmindex 0 (a giant ant).
const RACE_PMNUM = [260 /*PM_HUMAN*/, 264 /*PM_ELF*/, 44 /*PM_DWARF*/,
                    165 /*PM_GNOME*/, 72 /*PM_ORC*/];
export function character_race(pmindex) {
    for (let i = 0; i < races.length; ++i)
        if (RACE_PMNUM[i] === pmindex) return races[i];
    return null;
}

// C ref: role.c:2177 genl_player_selection() — "potential interface routine".
// The window port's player_selection() falls back to this; it is the whole of
// the generic path, and a cancelled selection QUITS the game rather than
// falling through to a random character.
export async function genl_player_selection() {
    if (await genl_player_setup(0)) return;

    // UNPORTED: allmain.c nh_terminate(EXIT_SUCCESS) — the player cancelled
    // role/race/&c selection, so C exits.  This port's shutdown path lives in
    // js/end.js / js/jsmain.js.
}

// C ref: role.c:2206 genl_player_setup(screenheight) — "guts of tty's
// player_selection()".  The 800-line interactive loop is what js/jsmain.js
// implements against the real terminal (jsmain.js:383-745), including the
// menu-vs-single-valid-facet decision that [[makepicks]] warns about: an
// rc-pinned INVALID facet must take the RNG-FREE counting branch.  Re-deriving
// it here would fork the live chargen path, so this is deliberately the C
// signature with the body named, not duplicated.
export async function genl_player_setup(screenheight) {
    void screenheight;
    // UNPORTED: role.c genl_player_setup().  Live equivalent: js/jsmain.js's
    // chargen driver.  Returning 0 means "player cancelled", which is what
    // genl_player_selection() above then acts on.
    return 0;
}

// C ref: role.c:2728 reset_role_filtering() — the "Pick all that apply" PICK_ANY
// menu that sets the role/race/gender/alignment filters.  Each of the four
// blocks is built with filtering=FALSE, which means: show EVERY row, key it by
// the row's name string rather than an index, and PRESELECT the rows the
// current filter already excludes.  n >= 0 (including n == 0, "clear the
// filters and set none") clears the old filter and re-reads the selection, and
// resets all four aspects to ROLE_NONE.
export async function reset_role_filtering() {
    let i, n;

    const win = rs_create_nhwindow(NHW_MENU);
    rs_start_menu(win, MENU_BEHAVE_STANDARD);

    /* no extra blank line preceding this entry; end_menu supplies one */
    rs_add_menu_str(win, 'Unacceptable roles');
    setup_rolemenu(win, false, ROLE_NONE, ROLE_NONE, ROLE_NONE);

    rs_add_menu_str(win, '');
    rs_add_menu_str(win, 'Unacceptable races');
    setup_racemenu(win, false, ROLE_NONE, ROLE_NONE, ROLE_NONE);

    rs_add_menu_str(win, '');
    rs_add_menu_str(win, 'Unacceptable genders');
    setup_gendmenu(win, false, ROLE_NONE, ROLE_NONE, ROLE_NONE);

    rs_add_menu_str(win, '');
    rs_add_menu_str(win, 'Unacceptable alignments');
    setup_algnmenu(win, false, ROLE_NONE, ROLE_NONE, ROLE_NONE);

    rs_end_menu(win, `Pick all that apply${gotrolefilter()
        ? ' and/or unpick any that no longer apply' : ''}`);
    // UNPORTED: windows.c select_menu(win, PICK_ANY, &selected).  With no
    // window layer there is nothing to select, so n stays -1 ("cancelled"),
    // which is exactly the arm that leaves the existing filters alone.
    const selected = [];
    n = -1;
    void PICK_ANY;

    if (n >= 0) { /* n==0: clear current filters and don't set new ones */
        clearrolefilter(RS_filter);
        for (i = 0; i < n; i++) setrolefilter(selected[i].item.a_string);

        game.initrole = game.initrace = game.initgend = game.initalign = ROLE_NONE;
    }
    return (n > 0);
}

// C ref: role.c:2777 maybe_skip_seps(rows, aspect) — "the change in format when
// this extended role selection was converted from tty-only to tty+curses+? made
// the role selection menu require two pages on a traditional 24-line tty; that
// wasn't fair to tty, so squeeze out some blank separator lines from the menu if
// that will make it fit on one".
//
// Returns the EXCESS line count, and only ever for RS_ROLE.  One excess line
// makes setup_rolemenu()'s caller drop the separator between 'random' and 'pick
// race first'; two also drops plsel_startmenu()'s separator after the
// role-so-far preview line.  The 4 + N + 2 + 5 + 1 arithmetic is C's, comment
// for comment.  js/jsmain.js:578 _maybeSkipSeps() is the live copy.
export function maybe_skip_seps(rows, aspect) {
    let i, n = 0;

    /* not much point to generalizing this to other aspects */
    if (aspect !== RS_ROLE) return 0;

    n += 4; /* title and ensuing separator, role info so far and separator */
    for (i = 0; i < C_NROLES(); ++i)
        if (ok_role(i, game.initrace, game.initgend, game.initalign)
            && ok_race(i, game.initrace, game.initgend, game.initalign)
            && ok_gend(i, game.initrace, game.initgend, game.initalign)
            && ok_align(i, game.initrace, game.initgend, game.initalign))
            ++n;
    n += 2; /* 'random' and separator */
    n += 5; /* race 1st, gender 1st, alignment 1st, reset filter, quit */
    n += 1; /* footer/prompt */
    if (rows > 0 && n > rows) return n - rows;
    return 0;
}

// C ref: role.c:2806 plsel_startmenu(ttyrows, aspect) — "start a menu; show
// role aspects specified so far as a header line".  rigid_role_checks() runs
// FIRST, because whatever aspect was just chosen might force others (Orc =>
// chaotic, Samurai => Human+lawful, Valkyrie => female).  The header is either
// "<role> <race> <gender> <alignment>" with angle-bracket placeholders while
// anything is still open, or the finished "<name> the <alignment> <gender>
// <race.adj> <role>".  Each field is truncated to 20 characters ("%.20s").
export function plsel_startmenu(ttyrows, aspect) {
    let qbuf;

    /* whatever aspect was just chosen might force others */
    const sel = { role: game.initrole, race: game.initrace,
                  gender: game.initgend, align: game.initalign };
    rigid_role_checks(sel);
    game.initrole = sel.role; game.initrace = sel.race;
    game.initgend = sel.gender; game.initalign = sel.align;

    const ROLE = game.initrole, RACE = game.initrace,
          GEND = game.initgend, ALGN = game.initalign;
    const t20 = (s) => String(s ?? '').slice(0, 20);
    const rolename = (ROLE < 0) ? '<role>'
        : (GEND === 1 && roles[ROLE].name.f) ? roles[ROLE].name.f
        : roles[ROLE].name.m;

    if (!game.plname || ROLE < 0 || RACE < 0 || GEND < 0 || ALGN < 0) {
        /* "<role> <race.noun> <gender> <alignment>" */
        qbuf = `${t20(rolename)} ${t20((RACE < 0) ? '<race>' : races[RACE].noun)}`
             + ` ${t20((GEND < 0) ? '<gender>' : genders[GEND].adj)}`
             + ` ${t20((ALGN < 0) ? '<alignment>' : aligns[ALGN].adj)}`;
    } else {
        /* "<name> the <alignment> <gender> <race.adjective> <role>" */
        qbuf = `${t20(game.plname)} the ${t20(aligns[ALGN].adj)}`
             + ` ${t20(genders[GEND].adj)} ${t20(races[RACE].adj)}`
             + ` ${t20(rolename)}`;
    }

    const win = rs_create_nhwindow(NHW_MENU);
    rs_start_menu(win, MENU_BEHAVE_STANDARD);

    rs_add_menu_str(win, qbuf);
    if (maybe_skip_seps(ttyrows, aspect) !== 2) rs_add_menu_str(win, '');
    return win;
}

// C ref: role.c:2854 setup_rolemenu(win, filtering, race, gend, algn) — "add
// entries a-Archeologist, b-Barbarian, &c to the menu being built in 'win'".
//
// Two modes, and they differ in more than the filter:
//   filtering=TRUE  (picking a role): skip rows the current race/gender/align
//                   rules out, and carry `any.a_int = i + 1`;
//   filtering=FALSE (reset_role_filtering): show EVERY row, carry
//                   `any.a_string = name`, and PRESELECT the rows that are
//                   currently excluded.
// The selector is the lowercase first letter, upper-cased when the previous
// entry already claimed it (Rogue 'r' then Ranger 'R') — note C compares
// against `lastch`, the letter of the PREVIOUS EMITTED row, not against every
// earlier row (js/jsmain.js:564 _roleSelectorChar() scans all earlier rows
// instead, which differs the moment three roles share a letter).
export function setup_rolemenu(win, filtering, race, gend, algn) {
    let any, i, role_ok, thisch, lastch = '\0', rolenamebuf;
    const clr = NO_COLOR;

    for (i = 0; i < C_NROLES(); i++) {
        /* role can be constrained by any of race, gender, or alignment */
        role_ok = (ok_role(i, race, gend, algn)
                   && ok_race(i, race, gend, algn)
                   && ok_gend(i, race, gend, algn)
                   && ok_align(i, race, gend, algn));
        if (filtering && !role_ok) continue;
        any = filtering ? { a_int: i + 1 } : { a_string: roles[i].name.m };
        thisch = lowc(roles[i].name.m);
        if (thisch === lastch) thisch = highc(thisch);
        rolenamebuf = roles[i].name.m;
        if (roles[i].name.f) {
            /* role has distinct name for female (C,P) */
            if (gend === 1) {
                /* female already chosen; replace male name */
                rolenamebuf = roles[i].name.f;
            } else if (gend < 0) {
                /* not chosen yet; append slash+female name */
                rolenamebuf += `/${roles[i].name.f}`;
            }
        }
        /* !filtering implies reset_role_filtering() where we want to mark this
           role as preselected if current filter excludes it */
        rs_add_menu(win, any, thisch, 0, ATR_NONE, clr, rs_an(rolenamebuf),
                    (!filtering && !role_ok)
                        ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
        lastch = thisch;
    }
}

// C ref: role.c:2905 setup_racemenu(win, filtering, role, gend, algn).  No
// ok_gend() test: race isn't constrained by gender.  The selector convention
// flips with the mode — when picking, the lowercase first letter with the
// uppercase as an unseen group accelerator; when resetting the filter, the
// UPPERCASE letter, because the lowercase role letters are already on screen.
export function setup_racemenu(win, filtering, role, gend, algn) {
    let any, race_ok, i, this_ch;
    const clr = NO_COLOR;

    for (i = 0; i < C_NRACES(); i++) {
        /* no ok_gend(); race isn't constrained by gender */
        race_ok = (ok_race(role, i, gend, algn)
                   && ok_role(role, i, gend, algn)
                   && ok_align(role, i, gend, algn));
        if (filtering && !race_ok) continue;
        any = filtering ? { a_int: i + 1 } : { a_string: races[i].noun };
        this_ch = races[i].noun[0];
        rs_add_menu(win, any, filtering ? this_ch : highc(this_ch),
                    filtering ? highc(this_ch) : 0,
                    ATR_NONE, clr, races[i].noun,
                    (!filtering && !race_ok)
                        ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
    }
}

// C ref: role.c:2943 setup_gendmenu(win, filtering, role, race, algn).  Bounded
// by ROLE_GENDERS (2), so neither the neuter nor the hallucination-only "group"
// row of genders[] can ever appear in this menu.  No ok_align(): gender isn't
// constrained by alignment.
export function setup_gendmenu(win, filtering, role, race, algn) {
    let any, gend_ok, i, this_ch;
    const clr = NO_COLOR;

    for (i = 0; i < ROLE_GENDERS; i++) {
        /* no ok_align(); gender isn't constrained by alignment */
        gend_ok = (ok_gend(role, race, i, algn)
                   && ok_role(role, race, i, algn)
                   && ok_race(role, race, i, algn));
        if (filtering && !gend_ok) continue;
        any = filtering ? { a_int: i + 1 } : { a_string: genders[i].adj };
        this_ch = genders[i].adj[0];
        rs_add_menu(win, any, filtering ? this_ch : highc(this_ch),
                    filtering ? highc(this_ch) : 0,
                    ATR_NONE, clr, genders[i].adj,
                    (!filtering && !gend_ok)
                        ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
    }
}

// C ref: role.c:2979 setup_algnmenu(win, filtering, role, race, gend).  Bounded
// by ROLE_ALIGNS (3).  No ok_gend(): alignment isn't constrained by gender.
export function setup_algnmenu(win, filtering, role, race, gend) {
    let any, algn_ok, i, this_ch;
    const clr = NO_COLOR;

    for (i = 0; i < ROLE_ALIGNS; i++) {
        /* no ok_gend(); alignment isn't constrained by gender */
        algn_ok = (ok_align(role, race, gend, i)
                   && ok_role(role, race, gend, i)
                   && ok_race(role, race, gend, i));
        if (filtering && !algn_ok) continue;
        any = filtering ? { a_int: i + 1 } : { a_string: aligns[i].adj };
        this_ch = aligns[i].adj[0];
        rs_add_menu(win, any, filtering ? this_ch : highc(this_ch),
                    filtering ? highc(this_ch) : 0,
                    ATR_NONE, clr, aligns[i].adj,
                    (!filtering && !algn_ok)
                        ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
    }
}
