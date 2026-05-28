// dungeon.js - Dungeon initialization.
// C ref: dungeon.c - init_dungeons, init_dungeon_dungeons, place_level.

import { game } from './gstate.js';
import { rn2, rn1 } from './rng.js';
import {
    MAXDUNGEON, MAXLEVEL,
    TBR_STAIR, TBR_NO_UP, TBR_NO_DOWN, TBR_PORTAL,
    BR_STAIR, BR_NO_END1, BR_NO_END2, BR_PORTAL,
    TOWN, HELLISH, MAZELIKE, ROGUELIKE, UNCONNECTED,
    D_ALIGN_NONE, D_ALIGN_CHAOTIC, D_ALIGN_NEUTRAL, D_ALIGN_LAWFUL,
    D_ALIGN_MASK,
} from './const.js';

const X_START = 'x-strt';
const X_LOCATE = 'x-loca';
const X_GOAL = 'x-goal';

const DUNGEON_FILE = [
    {
        name: 'The Dungeons of Doom',
        bonetag: 'D',
        base: 25,
        range: 5,
        alignment: 'unaligned',
        themerooms: 'themerms.lua',
        branches: [
            { name: 'The Gnomish Mines', base: 2, range: 3 },
            { name: 'Sokoban', chainlevel: 'oracle', base: 1, direction: 'up' },
            { name: 'The Quest', chainlevel: 'oracle', base: 6, range: 2, branchtype: 'portal' },
            { name: 'Fort Ludios', base: 18, range: 4, branchtype: 'portal' },
            { name: 'Gehennom', chainlevel: 'castle', base: 0, branchtype: 'no_down' },
            { name: 'The Elemental Planes', base: 1, branchtype: 'no_down', direction: 'up' },
        ],
        levels: [
            { name: 'rogue', bonetag: 'R', base: 15, range: 4, flags: 'roguelike' },
            { name: 'oracle', bonetag: 'O', base: 5, range: 5, alignment: 'neutral' },
            { name: 'bigrm', bonetag: 'B', base: 10, range: 3, chance: 40, nlevels: 13 },
            { name: 'medusa', base: -5, range: 4, nlevels: 4, alignment: 'chaotic' },
            { name: 'castle', base: -1 },
        ],
    },
    {
        name: 'Gehennom',
        bonetag: 'G',
        base: 20,
        range: 5,
        flags: ['mazelike', 'hellish'],
        lvlfill: 'hellfill',
        alignment: 'noalign',
        branches: [
            { name: "Vlad's Tower", base: 9, range: 5, direction: 'up' },
        ],
        levels: [
            { name: 'valley', bonetag: 'V', base: 1 },
            { name: 'sanctum', base: -1 },
            { name: 'juiblex', bonetag: 'J', base: 4, range: 4 },
            { name: 'baalz', bonetag: 'B', base: 6, range: 4 },
            { name: 'asmodeus', bonetag: 'A', base: 2, range: 6 },
            { name: 'wizard1', base: 11, range: 6 },
            { name: 'wizard2', bonetag: 'X', chainlevel: 'wizard1', base: 1 },
            { name: 'wizard3', bonetag: 'Y', chainlevel: 'wizard1', base: 2 },
            { name: 'orcus', bonetag: 'O', base: 10, range: 6 },
            { name: 'fakewiz1', bonetag: 'F', base: -6, range: 4 },
            { name: 'fakewiz2', bonetag: 'G', base: -6, range: 4 },
        ],
    },
    {
        name: 'The Gnomish Mines',
        bonetag: 'M',
        base: 8,
        range: 2,
        alignment: 'lawful',
        flags: ['mazelike'],
        lvlfill: 'minefill',
        levels: [
            { name: 'minetn', bonetag: 'T', base: 3, range: 2, nlevels: 7, flags: 'town' },
            { name: 'minend', base: -1, nlevels: 3 },
        ],
    },
    {
        name: 'The Quest',
        bonetag: 'Q',
        base: 5,
        range: 2,
        levels: [
            { name: X_START, base: 1, range: 1 },
            { name: X_LOCATE, bonetag: 'L', base: 3, range: 1 },
            { name: X_GOAL, base: -1 },
        ],
    },
    {
        name: 'Sokoban',
        base: 4,
        alignment: 'neutral',
        flags: ['mazelike'],
        entry: -1,
        levels: [
            { name: 'soko1', base: 1, nlevels: 2 },
            { name: 'soko2', base: 2, nlevels: 2 },
            { name: 'soko3', base: 3, nlevels: 2 },
            { name: 'soko4', base: 4, nlevels: 2 },
        ],
    },
    {
        name: 'Fort Ludios',
        base: 1,
        bonetag: 'K',
        flags: ['mazelike'],
        alignment: 'unaligned',
        levels: [
            { name: 'knox', bonetag: 'K', base: -1 },
        ],
    },
    {
        name: "Vlad's Tower",
        base: 3,
        bonetag: 'T',
        protofile: 'tower',
        alignment: 'chaotic',
        flags: ['mazelike'],
        entry: -1,
        levels: [
            { name: 'tower1', base: 1 },
            { name: 'tower2', base: 2 },
            { name: 'tower3', base: 3 },
        ],
    },
    {
        name: 'The Elemental Planes',
        bonetag: 'E',
        base: 6,
        alignment: 'unaligned',
        flags: ['mazelike'],
        entry: -2,
        levels: [
            { name: 'astral', base: 1 },
            { name: 'water', base: 2 },
            { name: 'fire', base: 3 },
            { name: 'air', base: 4 },
            { name: 'earth', base: 5 },
            { name: 'dummy', base: 6 },
        ],
    },
    {
        name: 'The Tutorial',
        base: 2,
        flags: ['mazelike', 'unconnected'],
        levels: [
            { name: 'tut-1', base: 1 },
            { name: 'tut-2', base: 2 },
        ],
    },
];

const flagstrs2i = {
    town: TOWN,
    hellish: HELLISH,
    mazelike: MAZELIKE,
    roguelike: ROGUELIKE,
    unconnected: UNCONNECTED,
};

const dgnaligns2i = {
    unaligned: D_ALIGN_NONE,
    noalign: D_ALIGN_NONE,
    lawful: D_ALIGN_LAWFUL,
    neutral: D_ALIGN_NEUTRAL,
    chaotic: D_ALIGN_CHAOTIC,
};

const brtypes2i = {
    stair: TBR_STAIR,
    portal: TBR_PORTAL,
    no_down: TBR_NO_DOWN,
    no_up: TBR_NO_UP,
};

const brdirstr2i = {
    up: true,
    down: false,
};

function dname_to_dnum(s) {
    for (let i = 0; i < game.n_dgns; i++)
        if (game.dungeons[i]?.dname === s)
            return i;
    throw new Error(`Couldn't resolve dungeon number for name "${s}".`);
}

export function find_level(s) {
    return (game.sp_levchn || []).find((lev) => lev.proto.toLowerCase() === s.toLowerCase()) || null;
}

function find_branch(s, pd) {
    for (let i = 0; i < pd.n_brs; i++)
        if (pd.tmpbranch[i]?.name === s)
            return i;
    throw new Error(`find_branch: can't find ${s}`);
}

function parent_dnum(s, pd) {
    let i = find_branch(s, pd);
    for (let pdnum = 0; pd.tmpdungeon[pdnum]?.name !== s; pdnum++) {
        i -= pd.tmpdungeon[pdnum]?.branches || 0;
        if (i < 0) return pdnum;
    }
    throw new Error('parent_dnum: could not resolve branch.');
}

export function level_range(dgn, base, randc, chain, pd, adjusted_base) {
    const lmax = game.dungeons[dgn].num_dunlevs;

    if (chain >= 0) {
        const levtmp = pd.final_lev[chain];
        if (!levtmp) throw new Error('level_range: empty chain level.');
        base += levtmp.dlevel.dlevel;
    } else if (base < 0) {
        base = lmax + base + 1;
    }

    if (base < 1 || base > lmax)
        throw new Error('level_range: base value out of range');

    adjusted_base.v = base;

    if (randc === -1)
        return lmax - base + 1;
    if (randc)
        return ((base + randc - 1) > lmax) ? lmax - base + 1 : randc;
    return 1;
}

function correct_branch_type(tbr) {
    switch (tbr.type) {
    case TBR_STAIR:
        return BR_STAIR;
    case TBR_NO_UP:
        return tbr.up ? BR_NO_END1 : BR_NO_END2;
    case TBR_NO_DOWN:
        return tbr.up ? BR_NO_END2 : BR_NO_END1;
    case TBR_PORTAL:
        return BR_PORTAL;
    default:
        return BR_STAIR;
    }
}

function branch_val(bp) {
    return ((((bp.end1.dnum * (MAXLEVEL + 1) + bp.end1.dlevel)
        * (MAXDUNGEON + 1) * (MAXLEVEL + 1))
        + (bp.end2.dnum * (MAXLEVEL + 1) + bp.end2.dlevel)));
}

export function insert_branch(new_branch) {
    game.branches.push(new_branch);
    game.branches.sort((a, b) => branch_val(a) - branch_val(b));
}

let branch_id = 0;

function wizard() {
    return !!game.flags?.debug;
}

function depth(lev) {
    return game.dungeons[lev.dnum].depth_start + lev.dlevel - 1;
}

function parent_dlevel(s, pd) {
    const branch_index = find_branch(s, pd);
    const dnum = parent_dnum(s, pd);
    const base = { v: 0 };
    const num = level_range(dnum, pd.tmpbranch[branch_index].lev.base,
        pd.tmpbranch[branch_index].lev.rand, pd.tmpbranch[branch_index].chain,
        pd, base);

    let i = rn2(num);
    const j = i;
    let curr;
    do {
        if (++i >= num)
            i = 0;
        curr = game.branches.find((br) =>
            (br.end1.dnum === dnum && br.end1.dlevel === base.v + i)
            || (br.end2.dnum === dnum && br.end2.dlevel === base.v + i));
    } while (curr && i !== j);
    return base.v + i;
}

function add_branch(dgn, child_entry_level, pd) {
    const branch_num = find_branch(game.dungeons[dgn].dname, pd);
    const new_branch = {
        next: null,
        id: branch_id++,
        type: correct_branch_type(pd.tmpbranch[branch_num]),
        end1: {
            dnum: parent_dnum(game.dungeons[dgn].dname, pd),
            dlevel: parent_dlevel(game.dungeons[dgn].dname, pd),
        },
        end2: { dnum: dgn, dlevel: child_entry_level },
        end1_up: !!pd.tmpbranch[branch_num].up,
    };

    insert_branch(new_branch);
    return new_branch;
}

function add_level(new_lev) {
    const list = game.sp_levchn;
    let pos = 0;
    while (pos < list.length) {
        const curr = list[pos];
        if (curr.dlevel.dnum === new_lev.dlevel.dnum
            && curr.dlevel.dlevel > new_lev.dlevel.dlevel)
            break;
        pos++;
    }
    list.splice(pos, 0, new_lev);
}

function init_level(dgn, proto_index, pd) {
    const tlevel = pd.tmplevel[proto_index];

    pd.final_lev[proto_index] = null;
    if (!wizard() && tlevel.chance <= rn2(100))
        return;

    const new_level = {
        next: null,
        dlevel: { dnum: dgn, dlevel: 0 },
        proto: tlevel.name,
        boneid: tlevel.boneschar,
        rndlevs: tlevel.rndlevs,
        flags: {
            town: !!(tlevel.flags & TOWN),
            hellish: !!(tlevel.flags & HELLISH),
            maze_like: !!(tlevel.flags & MAZELIKE),
            rogue_like: !!(tlevel.flags & ROGUELIKE),
            align: (tlevel.flags & D_ALIGN_MASK) >> 4,
        },
    };
    if (!new_level.flags.align)
        new_level.flags.align = (pd.tmpdungeon[dgn].flags & D_ALIGN_MASK) >> 4;

    pd.final_lev[proto_index] = new_level;
}

export function possible_places(idx, map, pd) {
    const lev = pd.final_lev[idx];

    for (let i = 0; i <= MAXLEVEL; i++)
        map[i] = false;

    const start = { v: 0 };
    let count = level_range(lev.dlevel.dnum, pd.tmplevel[idx].lev.base,
        pd.tmplevel[idx].lev.rand, pd.tmplevel[idx].chain, pd, start);
    for (let i = start.v; i < start.v + count; i++)
        map[i] = true;

    for (let i = pd.start; i < idx; i++) {
        const placed = pd.final_lev[i];
        if (placed && map[placed.dlevel.dlevel]) {
            map[placed.dlevel.dlevel] = false;
            --count;
        }
    }

    return count;
}

export function pick_level(map, nth) {
    for (let i = 1; i <= MAXLEVEL; i++)
        if (map[i] && !nth--)
            return i;
    throw new Error('pick_level: ran out of valid levels');
}

export function place_level(proto_index, pd) {
    const map = new Array(MAXLEVEL + 1);

    if (proto_index === pd.n_levs)
        return true;

    const lev = pd.final_lev[proto_index];
    if (!lev)
        return place_level(proto_index + 1, pd);

    let npossible = possible_places(proto_index, map, pd);

    for (; npossible; --npossible) {
        lev.dlevel.dlevel = pick_level(map, rn2(npossible));
        if (place_level(proto_index + 1, pd))
            return true;
        map[lev.dlevel.dlevel] = false;
    }
    return false;
}

function get_dgn_flags(src) {
    const flags = src.flags;
    if (Array.isArray(flags))
        return flags.reduce((acc, flag) => acc | (flagstrs2i[flag] || 0), 0);
    if (typeof flags === 'string')
        return flagstrs2i[flags] || 0;
    return 0;
}

function get_dgn_align(src) {
    return dgnaligns2i[src.alignment || 'unaligned'] ?? D_ALIGN_NONE;
}

function init_dungeon_levels(src, pd, dngidx) {
    const levels = src.levels || [];
    pd.tmpdungeon[dngidx].levels = levels.length;

    for (let f = 0; f < levels.length; f++) {
        const lvl = levels[f];
        const lvl_chain = lvl.chainlevel || null;
        const tmpl = {
            name: lvl.name,
            chainlvl: lvl_chain,
            lev: { base: lvl.base, rand: lvl.range || 0 },
            chance: lvl.chance ?? 100,
            rndlevs: lvl.nlevels || 0,
            flags: get_dgn_flags(lvl) | get_dgn_align(lvl),
            boneschar: lvl.bonetag ? lvl.bonetag[0] : 0,
            chain: -1,
        };

        if (lvl_chain) {
            for (let bi = 0; bi < pd.n_levs + f; bi++) {
                if (pd.tmplevel[bi]?.name === lvl_chain) {
                    tmpl.chain = bi;
                    break;
                }
            }
            if (tmpl.chain === -1)
                throw new Error(`Could not chain level ${lvl.name} to ${lvl_chain}`);
        }
        pd.tmplevel[pd.n_levs + f] = tmpl;
    }

    pd.n_levs += levels.length;
}

function init_dungeon_branches(src, pd, dngidx) {
    const branches = src.branches || [];
    pd.tmpdungeon[dngidx].branches = branches.length;

    for (let f = 0; f < branches.length; f++) {
        const br = branches[f];
        const br_chain = br.chainlevel || null;
        const tmpb = {
            name: br.name,
            lev: { base: br.base, rand: br.range || 0 },
            type: brtypes2i[br.branchtype || 'stair'] ?? TBR_STAIR,
            up: brdirstr2i[br.direction || 'down'] ?? false,
            chain: -1,
        };

        if (br_chain) {
            for (let bi = 0; bi < pd.n_levs + f - 1; bi++) {
                if (pd.tmplevel[bi]?.name === br_chain) {
                    tmpb.chain = bi;
                    break;
                }
            }
            if (tmpb.chain === -1)
                throw new Error(`Could not chain branch ${br.name} to level ${br_chain}`);
        }
        pd.tmpbranch[pd.n_brs + f] = tmpb;
    }

    pd.n_brs += branches.length;
}

function init_dungeon_set_entry(pd, dngidx) {
    const dgn_entry = pd.tmpdungeon[dngidx].entry_lev;
    const dungeon = game.dungeons[dngidx];

    if (dgn_entry < 0) {
        dungeon.entry_lev = dungeon.num_dunlevs + dgn_entry + 1;
        if (dungeon.entry_lev <= 0)
            dungeon.entry_lev = 1;
    } else if (dgn_entry > 0) {
        dungeon.entry_lev = dgn_entry;
        if (dungeon.entry_lev > dungeon.num_dunlevs)
            dungeon.entry_lev = dungeon.num_dunlevs;
    } else {
        dungeon.entry_lev = 1;
    }
}

function init_dungeon_set_depth(pd, dngidx) {
    const dungeon = game.dungeons[dngidx];
    const br = add_branch(dngidx, dungeon.entry_lev, pd);

    let from_depth;
    let from_up;
    if (br.end1.dnum === dngidx) {
        from_depth = depth(br.end2);
        from_up = !br.end1_up;
    } else {
        from_depth = depth(br.end1);
        from_up = br.end1_up;
    }

    dungeon.depth_start = from_depth + (br.type === BR_PORTAL ? 0 : (from_up ? -1 : 1))
        - (dungeon.entry_lev - 1);
}

function init_dungeon_dungeons(src, pd, dngidx) {
    const dgn_chance = src.chance ?? 100;

    if (!wizard() && dgn_chance && dgn_chance <= rn2(100)) {
        game.n_dgns--;
        return false;
    }

    init_dungeon_levels(src, pd, dngidx);
    init_dungeon_branches(src, pd, dngidx);

    const dgn_flags = get_dgn_flags(src);
    const dgn_align = get_dgn_align(src);
    const tmpdungeon = pd.tmpdungeon[dngidx];

    tmpdungeon.name = src.name;
    tmpdungeon.protoname = src.protofile || '';
    tmpdungeon.boneschar = src.bonetag ? src.bonetag[0] : 0;
    tmpdungeon.lev = { base: src.base, rand: src.range || 0 };
    tmpdungeon.flags = dgn_flags;
    tmpdungeon.align = dgn_align;
    tmpdungeon.chance = dgn_chance;
    tmpdungeon.entry_lev = src.entry || 0;

    const dungeon = {
        dname: src.name,
        proto: src.protofile || '',
        fill_lvl: src.lvlfill || '',
        themerms: src.themerooms || '',
        boneid: src.bonetag ? src.bonetag[0] : 0,
        entry_lev: 0,
        num_dunlevs: src.range ? rn1(src.range, src.base) : src.base,
        dunlev_ureached: dngidx ? 0 : 1,
        ledger_start: dngidx
            ? game.dungeons[dngidx - 1].ledger_start + game.dungeons[dngidx - 1].num_dunlevs
            : 0,
        depth_start: dngidx ? 0 : 1,
        flags: {
            hellish: !!(dgn_flags & HELLISH),
            maze_like: !!(dgn_flags & MAZELIKE),
            rogue_like: !!(dgn_flags & ROGUELIKE),
            align: dgn_align,
            unconnected: !!(dgn_flags & UNCONNECTED),
        },
    };
    game.dungeons[dngidx] = dungeon;

    init_dungeon_set_entry(pd, dngidx);

    if (dungeon.flags.unconnected)
        dungeon.depth_start = 1;
    else if (dngidx)
        init_dungeon_set_depth(pd, dngidx);

    if (dungeon.num_dunlevs > MAXLEVEL)
        dungeon.num_dunlevs = MAXLEVEL;

    return true;
}

function init_castle_tune() {
    game.tune = [];
    for (let i = 0; i < 5; i++)
        game.tune[i] = String.fromCharCode('A'.charCodeAt(0) + rn2(7));
    game.tune[5] = '\0';
}

const level_map = [
    ['air', 'air_level'],
    ['asmodeus', 'asmodeus_level'],
    ['astral', 'astral_level'],
    ['baalz', 'baalzebub_level'],
    ['bigrm', 'bigroom_level'],
    ['castle', 'stronghold_level'],
    ['earth', 'earth_level'],
    ['fakewiz1', 'portal_level'],
    ['fire', 'fire_level'],
    ['juiblex', 'juiblex_level'],
    ['knox', 'knox_level'],
    ['medusa', 'medusa_level'],
    ['oracle', 'oracle_level'],
    ['orcus', 'orcus_level'],
    ['rogue', 'rogue_level'],
    ['sanctum', 'sanctum_level'],
    ['valley', 'valley_level'],
    ['water', 'water_level'],
    ['wizard1', 'wiz1_level'],
    ['wizard2', 'wiz2_level'],
    ['wizard3', 'wiz3_level'],
    ['minend', 'mineend_level'],
    ['soko1', 'sokoend_level'],
    [X_START, 'qstart_level'],
    [X_LOCATE, 'qlocate_level'],
    [X_GOAL, 'nemesis_level'],
];

function fixup_level_locations() {
    for (const [lev_name, lev_spec] of level_map) {
        const x = find_level(lev_name);
        if (x)
            game[lev_spec] = { ...x.dlevel };
    }

    game.quest_dnum = dname_to_dnum('The Quest');
    game.sokoban_dnum = dname_to_dnum('Sokoban');
    game.mines_dnum = dname_to_dnum('The Gnomish Mines');
    game.tower_dnum = dname_to_dnum("Vlad's Tower");
    game.tutorial_dnum = dname_to_dnum('The Tutorial');

    const dummy = find_level('dummy');
    if (dummy) {
        const i = dummy.dlevel.dnum;
        if (game.dungeons[i].num_dunlevs > 1 - game.dungeons[i].depth_start)
            game.dungeons[i].depth_start -= 1;
    }
}

export function init_dungeons() {
    const pd = {
        tmpdungeon: Array.from({ length: MAXDUNGEON }, () => ({ levels: 0, branches: 0 })),
        tmplevel: [],
        final_lev: [],
        tmpbranch: [],
        start: 0,
        n_levs: 0,
        n_brs: 0,
    };

    branch_id = 0;
    game.dungeons = [];
    game.branches = [];
    game.sp_levchn = [];
    game.n_dgns = DUNGEON_FILE.length;

    if (game.n_dgns >= MAXDUNGEON)
        throw new Error('init_dungeons: too many dungeons');

    let cl = 0;
    let i = 0;
    for (const dungeon_src of DUNGEON_FILE) {
        if (init_dungeon_dungeons(dungeon_src, pd, i)) {
            for (; cl < pd.n_levs; cl++)
                init_level(i, cl, pd);

            if (!place_level(pd.start, pd))
                throw new Error("init_dungeon: couldn't place levels");

            for (; pd.start < pd.n_levs; pd.start++)
                if (pd.final_lev[pd.start])
                    add_level(pd.final_lev[pd.start]);
            i++;
        }
    }

    init_castle_tune();
    fixup_level_locations();
}
