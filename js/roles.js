// roles.js — Role, race, gender, alignment data.
// C ref: role.c — roles[], races[], aligns[], genders[]
//
// STUB: contestants should port the full role data from C.
// This minimal version provides just enough for Tourist.

// xlev / initrecord values come from src/role.c's roles[] table (the two
// scalars right after the enadv RoleAdvance array): xlev is the level cutoff
// for HP/Pw advancement, initrecord is the starting alignment record
// (attrib.c init_align: u.ualign.record = gu.urole.initrecord).
export const roles = [
    { name: { m: 'Archeologist', f: 'Archeologist' }, mnum: 0, xlev: 14, initrecord: 10 },
    { name: { m: 'Barbarian', f: 'Barbarian' }, mnum: 1, xlev: 10, initrecord: 10 },
    { name: { m: 'Caveman', f: 'Cavewoman' }, mnum: 2, xlev: 10, initrecord: 0 },
    { name: { m: 'Healer', f: 'Healer' }, mnum: 3, xlev: 20, initrecord: 10 },
    { name: { m: 'Knight', f: 'Knight' }, mnum: 4, xlev: 10, initrecord: 10 },
    { name: { m: 'Monk', f: 'Monk' }, mnum: 5, xlev: 10, initrecord: 10 },
    { name: { m: 'Priest', f: 'Priestess' }, mnum: 6, xlev: 10, initrecord: 0 },
    { name: { m: 'Ranger', f: 'Ranger' }, mnum: 7, xlev: 12, initrecord: 10 },
    { name: { m: 'Rogue', f: 'Rogue' }, mnum: 8, xlev: 11, initrecord: 10 },
    { name: { m: 'Samurai', f: 'Samurai' }, mnum: 9, xlev: 11, initrecord: 10 },
    { name: { m: 'Tourist', f: 'Tourist' }, mnum: 10, xlev: 14, initrecord: 0,
      title: [
          { m: 'Rambler', f: 'Rambler' },
          { m: 'Sightseer', f: 'Sightseer' },
      ],
    },
    { name: { m: 'Valkyrie', f: 'Valkyrie' }, mnum: 11, xlev: 10, initrecord: 0 },
    { name: { m: 'Wizard', f: 'Wizard' }, mnum: 12, xlev: 12, initrecord: 0 },
];

// `basepm` is the pmidx of the race's base monster (C role.c races[].mnum =
// PM_HUMAN/PM_ELF/PM_DWARF/PM_GNOME/PM_ORC).  set_uasmon (polyself.c) reads its
// mflags3 to grant the hero racial Infravision; elf/dwarf/gnome/orc have it,
// human does not.  Kept separate from `mnum` (a 0-4 race index) so existing
// callers are unaffected.
// selfmask: role.c races[].selfmask — the M2_ bit your_race(pm) tests.
export const races = [
    { name: 'human', adj: 'human', mnum: 0, basepm: 260, selfmask: 0x00000008 /*M2_HUMAN*/ },
    { name: 'elf', adj: 'elven', mnum: 1, basepm: 264, selfmask: 0x00000010 /*M2_ELF*/ },
    { name: 'dwarf', adj: 'dwarven', mnum: 2, basepm: 44, selfmask: 0x00000020 /*M2_DWARF*/ },
    { name: 'gnome', adj: 'gnomish', mnum: 3, basepm: 165, selfmask: 0x00000040 /*M2_GNOME*/ },
    { name: 'orc', adj: 'orcish', mnum: 4, basepm: 72, selfmask: 0x00000080 /*M2_ORC*/ },
];

export const aligns = [
    { name: 'lawful', value: 1 },
    { name: 'neutral', value: 0 },
    { name: 'chaotic', value: -1 },
];

export const genders = [
    { name: 'male', value: 0 },
    { name: 'female', value: 1 },
];

export function findRole(name) {
    if (!name) return null;
    const lc = name.toLowerCase();
    return roles.find(r => r.name.m.toLowerCase() === lc || r.name.f.toLowerCase() === lc);
}

export function findRace(name) {
    if (!name) return null;
    const lc = name.toLowerCase();
    return races.find(r => r.name.toLowerCase() === lc);
}
