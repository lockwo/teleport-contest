// dungeon.js - Dungeon initialization.
// C ref: dungeon.c - init_dungeons, init_dungeon_dungeons, place_level.

import { game } from './gstate.js';
import { roles, align_gname } from './role.js';
import { rn2, rn1, rnd } from './rng.js';
import { nhgetch } from './input.js';
import { ATR_INVERSE, ATR_NONE, NO_COLOR } from './terminal.js';
import {
    MAXDUNGEON, MAXLEVEL,
    TBR_STAIR, TBR_NO_UP, TBR_NO_DOWN, TBR_PORTAL,
    BR_STAIR, BR_NO_END1, BR_NO_END2, BR_PORTAL,
    TOWN, HELLISH, MAZELIKE, ROGUELIKE, UNCONNECTED,
    D_ALIGN_NONE, D_ALIGN_CHAOTIC, D_ALIGN_NEUTRAL, D_ALIGN_LAWFUL,
    D_ALIGN_MASK,
    POOL, MOAT, WATER, LAVAPOOL, LAVAWALL, ICE, DRAWBRIDGE_UP, DRAWBRIDGE_DOWN,
    SDOOR, isok,
    IS_AIR, IS_ALTAR, IS_GRAVE, IS_FOUNTAIN, IS_WALL, IS_DOOR, IS_ROOM,
    IS_THRONE, IS_SINK, TREE, COLNO, ROWNO, NHW_MENU,
    Is_waterlevel, Is_earthlevel, Is_knox_level,
    SHOPBASE,
    /* used only by the dungeon.c tail below (mapseen, lev_by_name, ...) */
    In_endgame, In_quest, In_sokoban, In_V_tower,
    Is_astralevel, Is_rogue_level, Is_stronghold,
    STONE, VWALL, HWALL, TLCORNER, TRCORNER, BLCORNER, BRCORNER, CROSSWALL,
    TUWALL, TDWALL, TLWALL, TRWALL, IRONBARS, STAIRS, LADDER, AIR, CLOUD,
    CORR, ROOM, DOOR, DBWALL, ALTAR, GRAVE, THRONE, SINK, FOUNTAIN,
    TEMPLE, DELPHI, ROOMOFFSET, MAXNROFROOMS, VIBRATING_SQUARE,
    IS_DRAWBRIDGE, DB_UNDER, DB_ICE, DB_LAVA, DB_MOAT,
    DB_DIR, DB_WEST, DB_EAST, DB_NORTH, DB_SOUTH,
    MSA_NONE, AM_MASK, AM_SHRINE, Amask2align, MCORPSENM, NON_PM,
    M_AP_FURNITURE, SVALL, VISITED, MAXLINFO, BUFSZ,
    COUNTING, WRITING, FREEING,
    MENU_ITEMFLAGS_NONE, MENU_ITEMFLAGS_SKIPMENUCOLORS, MENU_BEHAVE_STANDARD,
    PICK_NONE, PICK_ONE, ASCENDED, ESCAPED,
} from './const.js';
import { shtypes } from './shtypes.js';

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

// C ref: dungeon.c:1884 dungeon_branch(s) — the branch whose FAR end is the
// dungeon named `s`.  C panic()s when there is none; every caller names a
// dungeon that init_dungeons() always builds, so returning null is equivalent.
export function dungeon_branch(s) {
    const dnum = dname_to_dnum(s);
    for (const br of game.branches || [])
        if (br?.end2?.dnum === dnum) return br;
    return null;
}

// C ref: dungeon.c:1897 at_dgn_entrance(s) — is the hero standing on the
// PARENT-side level of that branch?
export function at_dgn_entrance(s) {
    const br = dungeon_branch(s);
    const uz = game.u?.uz;
    return !!br && !!uz && br.end1.dnum === uz.dnum && br.end1.dlevel === uz.dlevel;
}

export function find_level(s) {
    return (game.sp_levchn || []).find((lev) => lev.proto.toLowerCase() === s.toLowerCase()) || null;
}

// C ref: dungeon.c In_hell(lev) = dungeons[lev->dnum].flags.hellish.
export function In_hell(lev) {
    const dnum = lev?.dnum;
    if (dnum == null) return false;
    // The flag lives on the dungeon's `flags` sub-object (init_dungeon() builds
    // it there from dungeon.lua's flags list) — reading it off the dungeon
    // itself silently returned false for every level.
    return !!game.dungeons?.[dnum]?.flags?.hellish;
}

// C ref: dungeon.h Is_valley(x) = Lcheck(x, &valley_level) — same dnum+dlevel.
export function Is_valley(lev) {
    const vl = game.valley_level;
    return !!vl && !!lev && lev.dnum === vl.dnum && lev.dlevel === vl.dlevel;
}

// C ref: dungeon.h Is_bigroom(x) = Lcheck(x, &bigroom_level).
export function Is_bigroom(lev) {
    const bl = game.bigroom_level;
    return !!bl && !!lev && lev.dnum === bl.dnum && lev.dlevel === bl.dlevel;
}

// C ref: dungeon.c find_hell(lev) — the entrance to Gehennom, i.e. the first
// level of the Valley's dungeon.  Returns a fresh d_level rather than filling
// one in place (the C signature's only purpose).
export function find_hell() {
    const vl = game.valley_level;
    return { dnum: vl?.dnum ?? 0, dlevel: 1 };
}

// C ref: dungeon.c dunlevs_in_dungeon(lev) — how many levels lev's dungeon has.
export function dunlevs_in_dungeon(lev) {
    return game.dungeons?.[lev?.dnum]?.num_dunlevs ?? 0;
}

// C ref: dungeon.c single_level_branch(lev) — "this should be generalized
// instead of assuming that Fort Ludios is the only single level branch"; the C
// body is literally `return Is_knox(lev)`.
export function single_level_branch(lev) {
    return Is_knox_level(lev);
}

// C ref: dungeon.c Is_special(lev) — return the s_level for this position if it
// is a special (named) level, else null.  Used by makelevel() to dispatch into
// the special-level (Lua) loader instead of ordinary room generation.
export function Is_special(uz) {
    if (!uz) return null;
    return (game.sp_levchn || []).find(
        (lev) => lev.dlevel.dnum === uz.dnum && lev.dlevel.dlevel === uz.dlevel) || null;
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

// C ref: dungeon.c builds_up(lev) — True iff <lev>'s dungeon is entered at its
// bottom and climbed (Vlad's Tower, Sokoban): the branch's "up" direction
// means depth() alone would make the harder-to-reach levels look easier, so
// level_difficulty() (do.js) compensates using this test.
export function builds_up(lev) {
    const dptr = game.dungeons[lev.dnum];
    if (dptr.num_dunlevs > 1)
        return dptr.entry_lev === dptr.num_dunlevs;
    const br = (game.branches || []).find((b) =>
        b.end2.dnum === lev.dnum && b.end2.dlevel === lev.dlevel);
    return br ? !!br.end1_up : false;
}

// C ref: dungeon.c:2027 level_difficulty() — the SINGLE authority for the
// "how hard is it here" depth used by monster/object generation.  Every caller
// used to keep a private copy that implemented only the third arm; the endgame
// planes sit at negative dlevels, so those copies handed d(level_difficulty(),N)
// a negative dice count and it silently rolled nothing (seed0373 step 99).
export function level_difficulty_c() {
    const uz = game.u?.uz;
    if (!uz) return 1;
    if (In_endgame_dg(uz))
        return depth_dg(game.sanctum_level) + Math.trunc((game.u?.ulevel || 0) / 2);
    if (game.u?.uhave?.amulet) return deepest_lev_reached_dg(false);
    let res = depth_dg(uz);
    if (builds_up(uz))
        res += 2 * (game.dungeons[uz.dnum].entry_lev - uz.dlevel + 1);
    return res;
}

// C ref: dungeon.c:1339 deepest_lev_reached(noquest).
function deepest_lev_reached_dg(noquest) {
    let ret = 0;
    const dgns = game.dungeons || [];
    for (let i = 0; i < dgns.length; i++) {
        if (noquest && i === game.quest_dnum) continue;
        const dlevel = dgns[i]?.dunlev_ureached | 0;
        if (!dlevel) continue;
        const d = depth_dg({ dnum: i, dlevel });
        if (d > ret) ret = d;
    }
    return ret;
}

// C ref: dungeon.c depth() / In_endgame().  Local copies: dungeon.js sits below
// hacklib.js/const.js in the import graph for these two callers only.
function depth_dg(uz) {
    const dnum = uz?.dnum ?? 0;
    const dlevel = uz?.dlevel ?? 1;
    const d = game?.dungeons?.[dnum];
    if (!d) return dlevel;
    return (d.depth_start || 1) + dlevel - 1;
}
function In_endgame_dg(uz) {
    const al = game.astral_level;
    return !!uz && !!al && uz.dnum === al.dnum;
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

// C ref: dungeon.c fixup_level_locations — the quest dungeon's levels are
// stored generically as "x-strt"/"x-loca"/"x-goal"; the "x" is replaced by the
// current role's filecode (gu.urole.filecode) so the overview/level-teleport
// listing shows e.g. "Arc-strt" for an Archeologist.
function urole_filecode() {
    if (Number.isInteger(game.initrole) && game.initrole >= 0)
        return roles[game.initrole]?.filecode || null;
    const name = String(game.initrole || '').toLowerCase();
    const r = roles.find((rr) => rr.name?.m?.toLowerCase() === name);
    return r?.filecode || null;
}

function fixup_level_locations() {
    const filecode = urole_filecode();
    for (const [lev_name, lev_spec] of level_map) {
        const x = find_level(lev_name);
        if (x) {
            game[lev_spec] = { ...x.dlevel };
            // C ref: dungeon.c fixup_level_locations — name substitution on the
            // quest dungeon's levels: proto = urole.filecode + &lev_name[1]
            // ("x-strt" -> "Arc-strt").
            if (lev_name.startsWith('x-') && filecode) {
                x.proto = filecode + lev_name.slice(1);
            }
            // C ref: dungeon.c init_dungeons() — Kludge to allow a floating
            // Knox (Fort Ludios) entrance: the branch reaching Knox has its
            // parent end (end1) marked with the bogus dnum n_dgns so it sorts
            // to the end of the branch list and is omitted from per-dungeon
            // listings (print_dungeon's level menu).
            if (lev_spec === 'knox_level') {
                const knox = x.dlevel;
                const br = (game.branches || []).find(
                    (b) => b.end2.dnum === knox.dnum && b.end2.dlevel === knox.dlevel);
                if (br) {
                    br.end1.dnum = game.n_dgns;
                    // Re-sort the branch list now that end1 changed.
                    game.branches.sort((a, b) => branch_val(a) - branch_val(b));
                }
            }
        }
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

// ── print_dungeon level-teleport menu (C ref: dungeon.c print_dungeon) ──
//
// The wizard ^V "? for a menu" path.  Renders the "Level teleport to where:"
// menu of every dungeon's special levels and branches and returns the chosen
// destination.  Consumes NO RNG (the whole menu is derived from the static
// dungeon model that init_dungeons() already built), so it can never perturb
// the PRNG stream the recorder captured.
//
// Returns { playerlev, destlev, destdnum } for a selection, or null if the
// player cancels (matching print_dungeon returning 0).

function br_string(type) {
    switch (type) {
    case BR_PORTAL: return 'Portal';
    case BR_NO_END1: return 'Connection';
    case BR_NO_END2: return 'One way stair';
    case BR_STAIR: return 'Stair';
    }
    return ' (unknown)';
}

function chr_u_on_lvl(dlev) {
    const u = game.u;
    return (u && u.uz && u.uz.dnum === dlev.dnum && u.uz.dlevel === dlev.dlevel)
        ? '*' : ' ';
}

// Logical depth of a level within a given dungeon model.
function pd_depth(M, lev) {
    return M.dungeons[lev.dnum].depth_start + lev.dlevel - 1;
}

// C ref: dungeon.c unplaced_floater() — Fort Ludios (knox) is "unplaced" while
// it remains a floating branch (end1.dnum == n_dgns).
function unplaced_floater(M, dnum) {
    const knox = M.knox_level;
    if (!knox || dnum !== knox.dnum) return false;
    for (const br of (M.branches || []))
        if (br.end1.dnum === M.n_dgns && br.end2.dnum === dnum)
            return true;
    return false;
}

// C ref: dungeon.c unreachable_level().  In_endgame is never the case for the
// recorded ^V sessions; the "dummy" Plane-of-Earth filler level is unreachable.
function unreachable_level(M, dlev, unplaced) {
    if (unplaced) return true;
    const dummy = (M.sp_levchn || []).find((l) => l.proto === 'dummy');
    if (dummy && dummy.dlevel.dnum === dlev.dnum
        && dummy.dlevel.dlevel === dlev.dlevel)
        return true;
    return false;
}

// makeplural for the single word used by print_dungeon ("level" -> "levels",
// "depth" -> "depths").  C ref: objnam.c makeplural — only these two strings
// reach it from print_dungeon.
function pd_makeplural(word) {
    return word + 's';
}

// Build the ordered list of menu entries that print_dungeon would emit from
// the given dungeon model M.  Each entry is a heading (non-selectable) or a
// selectable level.
function build_levtport_menu(M) {
    const entries = []; // { heading } | { text, lev, dgn, playerlev, reachable }
    let menuletter = 'a';
    const advance = () => {
        if (menuletter === 'z') menuletter = 'A';
        else menuletter = String.fromCharCode(menuletter.charCodeAt(0) + 1);
    };

    // C ref: tport_menu — record the lchoice slot and emit a menu line, with
    // 4-space padding (and no selector) for unreachable levels.
    const tport_menu = (entry, lvl, reachable) => {
        let text = entry;
        if (!reachable) text = '    ' + entry;
        entries.push({
            menuletter,
            text,
            lev: lvl.dlevel,
            dgn: lvl.dnum,
            playerlev: pd_depth(M, lvl),
            reachable,
        });
        advance();
    };

    // C ref: print_branch — print child branches whose parent end (end1) is in
    // [lower_bound+1, upper_bound] of this dungeon, in svb.branches order.
    const print_branch = (dnum, lowerBound, upperBound) => {
        for (const br of (M.branches || [])) {
            if (br.end1.dnum === dnum && lowerBound < br.end1.dlevel
                && br.end1.dlevel <= upperBound) {
                const buf = `${chr_u_on_lvl(br.end1)} ${br_string(br.type)} to `
                    + `${M.dungeons[br.end2.dnum].dname}: ${pd_depth(M, br.end1)}`;
                tport_menu(buf, br.end1, !unreachable_level(M, br.end1, false));
            }
        }
    };

    for (let i = 0; i < M.n_dgns; i++) {
        const dptr = M.dungeons[i];
        const unplaced = unplaced_floater(M, i);
        const descr = unplaced ? 'depth' : 'level';
        const nlev = dptr.num_dunlevs;
        let buf;
        if (nlev > 1)
            buf = `${dptr.dname}: ${pd_makeplural(descr)} ${dptr.depth_start} to `
                + `${dptr.depth_start + nlev - 1}`;
        else
            buf = `${dptr.dname}: ${descr} ${dptr.depth_start}`;
        if (dptr.entry_lev !== 1) {
            if (dptr.entry_lev === nlev) buf += ', entrance from below';
            else buf += `, entrance on ${dptr.depth_start + dptr.entry_lev - 1}`;
        }
        entries.push({ heading: true, text: buf });

        // Circle through the special levels in this dungeon (sp_levchn order).
        let lastLevel = 0;
        for (const slev of (M.sp_levchn || [])) {
            if (slev.dlevel.dnum !== i) continue;
            print_branch(i, lastLevel, slev.dlevel.dlevel);
            let lbuf = `${chr_u_on_lvl(slev.dlevel)} ${slev.proto}: ${pd_depth(M, slev.dlevel)}`;
            if (M.stronghold_level && slev.dlevel.dnum === M.stronghold_level.dnum
                && slev.dlevel.dlevel === M.stronghold_level.dlevel)
                lbuf += ` (tune ${(M.tune || []).join('').replace(/\0/g, '')})`;
            tport_menu(lbuf, slev.dlevel, !unreachable_level(M, slev.dlevel, unplaced));
            lastLevel = slev.dlevel.dlevel;
        }
        print_branch(i, lastLevel, MAXLEVEL);
    }
    return entries;
}

// C ref: dungeon.c:2290 print_dungeon(FALSE, 0, 0) — the #wizwhere form.  Same
// walk as build_levtport_menu() (which is the bymenu==TRUE form), but every
// line is a plain putstr(): branches get a literal ' ' in place of
// chr_u_on_lvl(), nothing is skipped for being unreachable, and the floating
// branches / invocation-or-portal tail is appended.  No RNG.
export function print_dungeon_lines() {
    const M = pd_model();
    const lines = [];

    // C ref: print_branch(win, dnum, lower, upper, FALSE, ...) — the bymenu
    // FALSE arm always formats the leading %c as a space.
    const print_branch = (dnum, lowerBound, upperBound) => {
        for (const br of (M.branches || [])) {
            if (br.end1.dnum === dnum && lowerBound < br.end1.dlevel
                && br.end1.dlevel <= upperBound) {
                lines.push(`  ${br_string(br.type)} to `
                    + `${M.dungeons[br.end2.dnum].dname}: ${pd_depth(M, br.end1)}`);
            }
        }
    };

    for (let i = 0; i < M.n_dgns; i++) {
        const dptr = M.dungeons[i];
        const unplaced = unplaced_floater(M, i);
        const descr = unplaced ? 'depth' : 'level';
        const nlev = dptr.num_dunlevs;
        let buf;
        if (nlev > 1)
            buf = `${dptr.dname}: ${pd_makeplural(descr)} ${dptr.depth_start} to `
                + `${dptr.depth_start + nlev - 1}`;
        else
            buf = `${dptr.dname}: ${descr} ${dptr.depth_start}`;
        if (dptr.entry_lev !== 1) {
            if (dptr.entry_lev === nlev) buf += ', entrance from below';
            else buf += `, entrance on ${dptr.depth_start + dptr.entry_lev - 1}`;
        }
        lines.push(buf);

        let lastLevel = 0;
        for (const slev of (M.sp_levchn || [])) {
            if (slev.dlevel.dnum !== i) continue;
            print_branch(i, lastLevel, slev.dlevel.dlevel);
            // C ref: dungeon.c:2345 — the special-level line keeps
            // chr_u_on_lvl() even in the non-menu form, so the level the hero
            // is standing on is flagged with '*'.
            let lbuf = `${chr_u_on_lvl(slev.dlevel)} ${slev.proto}: ${pd_depth(M, slev.dlevel)}`;
            if (M.stronghold_level && slev.dlevel.dnum === M.stronghold_level.dnum
                && slev.dlevel.dlevel === M.stronghold_level.dlevel)
                lbuf += ` (tune ${(M.tune || []).join('').replace(/\0/g, '')})`;
            lines.push(lbuf);
            lastLevel = slev.dlevel.dlevel;
        }
        print_branch(i, lastLevel, MAXLEVEL);
    }

    // C ref: dungeon.c:2380 — branches whose parent end is the pseudo-dungeon
    // n_dgns have not been attached to a real level yet.
    let first = true;
    for (const br of (M.branches || [])) {
        if (br.end1.dnum === M.n_dgns) {
            if (first) { lines.push(''); lines.push('Floating branches'); first = false; }
            lines.push(`   ${br_string(br.type)} to ${M.dungeons[br.end2.dnum].dname}`);
        }
    }

    // C ref: dungeon.c:2395 — on the invocation level report its position,
    // otherwise report this level's magic portal (or say there is none, but
    // only where one is expected).
    const uz = game.u?.uz;
    if (Invocation_lev(uz)) {
        lines.push('');
        lines.push(`Invocation position @ (${game.inv_pos?.x ?? 0},${game.inv_pos?.y ?? 0}), `
            + `hero @ (${game.u?.ux ?? 0},${game.u?.uy ?? 0})`);
    } else {
        const MAGIC_PORTAL = 17;                       // trap.h
        const trap = (game.level?.traps || []).find((t) => t.ttyp === MAGIC_PORTAL);
        let buf = '';
        if (trap) {
            buf = `Portal @ (${trap.tx},${trap.ty}), hero @ (${game.u?.ux ?? 0},${game.u?.uy ?? 0})`;
        } else if (pd_portal_expected(M, uz)) {
            buf = 'No portal found.';
        }
        if (buf) { lines.push(''); lines.push(buf); }
    }
    return lines;
}

// C ref: dungeon.c:2419 — the levels where "No portal found." is worth saying.
function pd_portal_expected(M, uz) {
    if (!uz) return false;
    const planes = M.dungeons?.[uz.dnum]?.dname === 'The Elemental Planes';
    if (planes) return true;
    const q = (M.sp_levchn || []).find((l) => /-strt$/.test(l.proto));
    if (q && q.dlevel.dnum === uz.dnum && q.dlevel.dlevel === uz.dlevel) return true;
    // at_dgn_entrance("The Quest") / Is_knox()
    for (const br of (M.branches || [])) {
        const dn = M.dungeons?.[br.end2.dnum]?.dname;
        if ((dn === 'The Quest' || dn === 'Fort Ludios')
            && br.end1.dnum === uz.dnum && br.end1.dlevel === uz.dlevel)
            return true;
    }
    return M.knox_level && uz.dnum === M.knox_level.dnum
        && uz.dlevel === M.knox_level.dlevel;
}

// C ref: dungeon.h Invocation_lev(lev) — the level just above the sanctum.
function Invocation_lev(lev) {
    if (!lev) return false;
    const hell = game._full_dungeon?.dungeons?.findIndex?.((d) => d?.flags?.hellish);
    const dun = game.dungeons?.[lev.dnum];
    if (!dun?.flags?.hellish) return false;
    void hell;
    return lev.dlevel === (dun.num_dunlevs - 1);
}

// Resolve the dungeon model: gameplay sessions stub g.dungeons down to a single
// dnum-0 level for level generation, but allmain.newgame() stashes the complete
// model (built by init_dungeons) in g._full_dungeon.
function pd_model() {
    return game._full_dungeon || {
        dungeons: game.dungeons,
        branches: game.branches,
        sp_levchn: game.sp_levchn,
        n_dgns: game.n_dgns,
        tune: game.tune,
        knox_level: game.knox_level,
        stronghold_level: game.stronghold_level,
    };
}

// Render one page of the level-teleport menu to the terminal grid and leave it
// there; the caller reads the selection key (the pre-nhgetch capture hook
// snapshots this rendered menu as the boundary screen).  Mirrors
// win/tty/wintty.c process_menu_window layout: title row, items, morestr.
export async function print_dungeon(bymenu, _rlev, _rdgn) {
    if (!bymenu) return 0;

    // Resolve the dungeon model: gameplay sessions stub g.dungeons down to a
    // single dnum-0 level for level generation, but allmain.newgame() stashes
    // the complete model (built by init_dungeons) in g._full_dungeon.  Fall
    // back to the live game state when the full model wasn't captured.
    const M = game._full_dungeon || {
        dungeons: game.dungeons,
        branches: game.branches,
        sp_levchn: game.sp_levchn,
        n_dgns: game.n_dgns,
        tune: game.tune,
        knox_level: game.knox_level,
        stronghold_level: game.stronghold_level,
    };

    const entries = build_levtport_menu(M);

    // The menu title occupies the inverse first row; in the tty menu the title
    // is emitted by end_menu() as the menu's prompt heading.  process_menu_window
    // renders it as the first line.  Recorded layout shows: title row, blank,
    // then headings/items, with the morestr on the final row.
    const lines = [{ title: true, text: 'Level teleport to where:' }, { blank: true }];
    for (const e of entries) lines.push(e);

    // The exact string tty_add_menu() stored for each row: a selectable entry
    // gets the "%c - " accelerator prefix, a heading and an unreachable entry
    // (added with a_int == 0, hence no selector) keep their text verbatim.
    // Shared by the renderer and the menu-geometry calculation so the two can
    // never disagree about the window's width.
    const lineText = (e) => (e.blank ? ''
        : (e.heading || e.title || !e.reachable) ? e.text
        : `${e.menuletter} - ${e.text}`);

    const disp = game.nhDisplay;
    const rows = (disp && disp.rows) || 24;
    // Each page fills rows-1 lines (the last row holds the morestr).
    const perPage = Math.max(1, rows - 1);
    const npages = Math.max(1, Math.ceil(lines.length / perPage));

    // Render helper that treats `lines` (with the title/blank prefixed).
    const renderPage = (pageNo) => {
        if (!disp || !disp.setCell) return;
        const cols = disp.cols || 80;
        const start = (pageNo - 1) * perPage;
        const end = Math.min(start + perPage, lines.length);
        const clearRow = (r) => { for (let c = 0; c < cols; c++) disp.setCell(c, r, ' ', NO_COLOR, 0); };
        let row = 0;
        for (let i = start; i < end; i++, row++) {
            const e = lines[i];
            clearRow(row);
            if (e.blank) continue;
            if (e.title) { disp.putstr(1, row, e.text, NO_COLOR, ATR_INVERSE); continue; }
            // C ref: tport_menu — an unreachable level is added with a_int==0
            // (zeroany), so the tty windowport shows no accelerator; its entry
            // text already carries the 4-space padding in place of "X - ".
            disp.putstr(1, row, lineText(e), NO_COLOR, e.heading ? ATR_INVERSE : 0);
        }
        const morestr = npages > 1 ? `(${pageNo} of ${npages})` : '(end) ';
        clearRow(row);
        disp.putstr(1, row, morestr, NO_COLOR, 0);
        for (let r = row + 1; r < rows; r++) clearRow(r);
        // C dmore parks the cursor just past the morestr (col 1 + its length).
        disp.setCursor(1 + morestr.length, row);
    };

    // C ref: dungeon.c print_dungeon() `win = create_nhwindow(NHW_MENU)` ...
    // `select_menu(win, PICK_ONE, &selected); destroy_nhwindow(win);`.  The
    // window is real because tty_select_menu() DISMISSES it before returning,
    // and for a full-width menu that dismissal runs docrt() — which under
    // Hallucination re-picks every glyph on the level off the display prng
    // (seed0383 step 195: 54 draws on the old level before the teleport).
    const wt = await import('./wintty.js');
    const win = wt.tty_create_nhwindow(NHW_MENU);
    Object.assign(wt.wins[win], wt.tty_menu_layout(lines.map(lineText)));
    wt.wins[win].active = true;

    let result = 0;
    let pageNo = 1;
    pick: for (;;) {
        renderPage(pageNo);
        const key = await nhgetch();
        const ch = String.fromCharCode(key);

        // Cancel: ESC.
        if (key === 27) break pick;

        // Accelerator selection: a letter that maps to a reachable entry on
        // ANY page selects it immediately (tty PICK_ONE behavior).
        const sel = entries.find((e) => !e.heading && e.reachable && e.menuletter === ch);
        if (sel) {
            result = { playerlev: sel.playerlev, destlev: sel.lev, destdnum: sel.dgn };
            break pick;
        }

        // Paging keys: space / '>' / return advance; '<' goes back.
        if (key === 32 || ch === '>' || key === 13 || key === 10) {
            if (pageNo < npages) pageNo++;
            else break pick; // past the last page with no selection: cancel
            continue;
        }
        if (ch === '<') {
            if (pageNo > 1) pageNo--;
            continue;
        }
        // Any other key: ignore and redraw.
    }

    // C ref: wintty.c tty_dismiss_nhwindow()'s NHW_MENU arm.  Its
    // `iflags.window_inited` guard is TRUE for the whole game in C (set during
    // tty_init_nhwindows), but this port drives the terminal directly and never
    // runs that init, so go straight to the erase instead of through a flag
    // that is permanently unset here.
    await wt.erase_menu_or_text(win, wt.wins[win], false);
    wt.wins[win].active = false;
    wt.tty_destroy_nhwindow(win);
    return result;
}

// ── #overview command (C ref: dungeon.c dooverview()/show_overview() ──
//
// Builds the display lines for the "#overview" menu: for each visited
// dungeon level, a heading (once per dungeon, C ref: print_mapseen's
// `printdun` line via svd.dungeons[dnum].dname) followed by a "Level N: ..."
// line, plus a feature-summary line when the level has fountains, sinks,
// thrones, graves, or trees that have actually been seen (C ref:
// print_mapseen's OF_INTEREST buf, via ADDNTOBUF).  A level with none of
// those and no annotation is skipped unless it's the level the hero is
// currently on (C ref: interest_mapseen's on_level(&u.uz, ...) shortcut).
// Shops/altars/temples/branches/bones/Sokoban/quest/endgame refinements
// aren't modeled: no recorded session visits a level that needs them.

const OVERVIEW_TAB = '   ';
const OVERVIEW_PREFIX = '      ';

// C ref: dungeon.c seen_string() — "no"/"a"/"an"/"some"/"many" by count.
function overview_seen_string(count, obj) {
    switch (count) {
    case 0: return 'no';
    case 1: return /^[aeiouAEIOU]/.test(obj) ? 'an' : 'a';
    case 2: return 'some';
    case 3: return 'many';
    }
    return '(unknown)';
}
function overview_plur(n) { return n === 1 ? '' : 's'; }

// C ref: dungeon.c count_feat_lastseentyp() — counts seen cells of a given
// terrain, capped at 3 (matches print_mapseen's "no/a/some/many" scale).
// lastseentyp isn't tracked separately here; a cell with a remembered_glyph
// has necessarily been seen, which is the same "has the hero observed this"
// gate hack.js's #terrain (reveal_terrain) uses.
function overview_count_feat(level, pred) {
    let n = 0;
    for (let x = 1; x < COLNO; x++) {
        for (let y = 0; y < ROWNO; y++) {
            const loc = level?.at(x, y);
            if (!loc || loc.remembered_glyph == null) continue;
            if (pred(loc.typ)) {
                n++;
                if (n >= 3) return 3;
            }
        }
    }
    return n;
}

// The live level if `ledger` is the hero's current one, else the stashed
// per-level object graph do.js's goto_level() keeps for previously-visited
// levels (the JS analog of a level's on-disk save file).
function overview_level_for(ledger) {
    const u = game.u;
    if (u && u.uz && `${u.uz.dnum}:${u.uz.dlevel}` === ledger) return game.level;
    return game._level_store?.[ledger]?.level || null;
}

// ── the mapseen bits that cannot be recomputed from a stored map ─────────────
//
// C keeps a `mapseen` per visited level.  Most of what print_mapseen() shows is
// re-derived here from the stashed level object, but two fields are HISTORY,
// not state: msrooms[].seen (which special rooms the hero actually walked into)
// and br (which branch stairway the hero actually took).  Neither can be read
// back off the map, so they are recorded at the moment C records them.
function mapseen_of(ledger) {
    const m = game._mapseen || (game._mapseen = {});
    return m[ledger] || (m[ledger] = { msrooms: {}, br: null });
}

// C ref: dungeon.c:3282 room_discovered(roomno) — "room entry message has just
// been delivered so learn room even if blind".  Called from hack.c
// check_special_room() for every TEMPLE or shop the hero enters.
export function room_discovered(roomno) {
    const uz = game.u?.uz;
    if (!uz) return;
    mapseen_of(`${uz.dnum}:${uz.dlevel}`).msrooms[roomno] = { seen: 1 };
}

// C ref: dungeon.c:2446 recbranch_mapseen(source, dest) — record that the hero
// KNOWS about a branch from `source`, which is what puts the "Stairs down to
// The Gnomish Mines." line in #overview.  Only forward (end1 -> end2)
// transitions count, and C deliberately does not call this for a level teleport
// or the Eye, so a ^V-hopping wizard-mode game gets no branch annotations.
export function recbranch_mapseen(source, dest) {
    if (!source || !dest || source.dnum === dest.dnum) return;
    const on = (l, e) => e && l.dnum === e.dnum && l.dlevel === e.dlevel;
    let found = null;
    for (const br of game.branches || []) {
        if (on(source, br.end1) && on(dest, br.end2)) { found = br; break; }
        if (on(source, br.end2) && on(dest, br.end1)) return;   // backward
    }
    if (!found) return;
    mapseen_of(`${source.dnum}:${source.dlevel}`).br = found;
}

// C ref: dungeon.c:3388 br_string2(branch *).  The quest-portal "Sealed portal"
// arm needs u.uevent.qexpelled, which this port does not track.
function br_string2(br) {
    switch (br.type) {
    case BR_PORTAL: return 'Portal';
    case BR_NO_END1: return 'Connection';
    case BR_NO_END2: return br.end1_up ? 'One way stairs up' : 'One way stairs down';
    case BR_STAIR: return br.end1_up ? 'Stairs up' : 'Stairs down';
    }
    return '(unknown)';
}

// C ref: dungeon.c:3441 shop_string(rtype) — the #overview name of a shop, which
// is shtypes[].annotation when that second (shorter) name exists and
// shtypes[].name otherwise.  A shop whose keeper has left is "untended shop"
// (shoptype forced to SHOPBASE-1 by recalc_mapseen).
// C ref: hacklib.c an() — every shop_string() result starts with a letter, so
// the vowel test is the whole rule here (no "the"/"some" special cases).
function an_dg(s) { return (/^[aeiouAEIOU]/.test(s) ? 'an ' : 'a ') + s; }

function shop_string(rtype) {
    const idx = rtype - SHOPBASE;
    if (idx < 0) return 'untended shop';
    const t = shtypes[idx];
    return t?.annotation || t?.name || 'shop?';
}

// `final` mirrors print_mapseen()'s eponymous parameter: 0 (default) is the
// live '#overview' command, which only lists levels interest_mapseen() flags
// as "of interest"; 1 or 2 is the end-of-game disclosure, which (per
// traverse_mapseenchn()'s `why != 0 || interest_mapseen(mptr)`) lists EVERY
// visited level unconditionally.  `how` is the death code, needed only to
// pick the "<- You are/were/left from here" verb for final==1 (an alive
// ending); it is unused for final==0/2.
export function build_overview_lines(final = 0, how = 0) {
    const M = game._full_dungeon || { dungeons: game.dungeons, n_dgns: game.n_dgns };
    const u = game.u;
    const uzLedger = u && u.uz ? `${u.uz.dnum}:${u.uz.dlevel}` : null;

    const ledgers = new Set(Object.keys(game._visited_levels || {}));
    if (uzLedger) ledgers.add(uzLedger);
    // C makes a mapseen for EVERY level the hero has been on, including the one
    // chargen built (which do.js deliberately leaves out of _visited_levels).
    // Anything with a stashed map, an annotation or mapseen history has been
    // visited, so union those in or the annotated Dlvl 1 goes missing.
    for (const k of Object.keys(game._level_store || {})) ledgers.add(k);
    for (const k of Object.keys(game._level_annotations || {})) ledgers.add(k);
    for (const k of Object.keys(game._mapseen || {})) ledgers.add(k);
    // C ref: allmain.c maybe_do_tutorial() -> goto_level(): a lua-scripted
    // level entry (the tutorial redirect) assigns u.ucamefrom the level the
    // hero is leaving, exactly as goto_level() would, but our tutorial-enter
    // shortcut (allmain.js enter_tutorial_level) bypasses do.js's goto_level()
    // and so never marks that departure level in _visited_levels/_level_store.
    // The end-of-game disclosure still needs to list it (a mapseen entry was
    // made for it when the hero's character was first placed there), so add
    // it here from the one general-purpose field that survives the shortcut.
    if (final && u?.ucamefrom) ledgers.add(`${u.ucamefrom.dnum}:${u.ucamefrom.dlevel}`);

    const parsed = Array.from(ledgers).map((ledger) => {
        const [dnum, dlevel] = ledger.split(':').map(Number);
        return { ledger, dnum, dlevel };
    });
    // C ref: init_mapseen() inserts each level in ascending (dnum, dlevel)
    // order, so mapseenchn traversal is already sorted that way.
    parsed.sort((a, b) => (a.dnum - b.dnum) || (a.dlevel - b.dlevel));

    // A dungeon's dunlev_ureached is, by definition, at least as deep as any
    // level of it the hero has actually visited.  A lua-scripted level entry
    // (the tutorial redirect, see the ucamefrom comment above) sets u.uz
    // directly without going through do.js's goto_level(), which is what
    // normally bumps dunlev_ureached, so the tracked field can understate it;
    // this recovers the invariant instead of trusting the possibly-stale field.
    const maxDlevelByDnum = new Map();
    for (const p of parsed)
        maxDlevelByDnum.set(p.dnum, Math.max(maxDlevelByDnum.get(p.dnum) ?? 0, p.dlevel));

    const lines = [];
    let lastdun = -1;
    for (const p of parsed) {
        const level = overview_level_for(p.ledger);
        // C's mapseen survives without the level being in memory, so a level
        // whose stashed map is gone still prints its heading line — dropping it
        // here lost the annotated Dlvl 1 of any game that had moved on.
        const feat = level ? {
            nthrone: overview_count_feat(level, IS_THRONE),
            nfount: overview_count_feat(level, IS_FOUNTAIN),
            nsink: overview_count_feat(level, IS_SINK),
            ngrave: overview_count_feat(level, IS_GRAVE),
            ntree: overview_count_feat(level, (t) => t === TREE),
        } : { nthrone: 0, nfount: 0, nsink: 0, ngrave: 0, ntree: 0 };
        const ms = game._mapseen?.[p.ledger] || null;
        // C ref: recalc_mapseen()'s msrooms loop — a shop counts only once the
        // hero has been INSIDE it (room_discovered), and shoptype collapses to 0
        // when two different shop types have been entered on the same level.
        feat.nshop = 0; feat.shoptype = 0;
        if (level && ms) {
            for (const key of Object.keys(ms.msrooms)) {
                const rt = level.rooms?.[+key]?.rtype | 0;
                if (rt < SHOPBASE) continue;
                if (!feat.nshop) feat.shoptype = rt;
                else if (feat.shoptype !== rt) feat.shoptype = 0;
                if (feat.nshop < 3) feat.nshop++;
            }
        }
        const custom = game._level_annotations?.[p.ledger] || '';
        const onHere = p.ledger === uzLedger;
        const ofInterest = !!(feat.nshop || feat.nthrone || feat.nfount
                              || feat.nsink || feat.ngrave || feat.ntree);
        const dptr = M.dungeons[p.dnum];
        if (!dptr) continue;
        const dunlevUreached = Math.max(dptr.dunlev_ureached ?? 0, maxDlevelByDnum.get(p.dnum) ?? 0);
        // C ref: dungeon.c interest_mapseen() last clause — a level is of
        // interest when it is "the furthest level reached in its branch"
        // (mptr->lev.dlevel == dungeons[dnum].dunlev_ureached), even with no
        // features and no annotation.  GAP: the auto-annotation flags (oracle /
        // bigroom / roguelevel / castle / valley / msanctum / vibrating_square /
        // quest_summons / questing) are not tracked here yet.
        const isDeepest = p.dlevel === dunlevUreached;
        if (!final && !onHere && !ofInterest && !custom && !ms?.br && !isDeepest) continue;
        const showheader = p.dnum !== lastdun;
        if (showheader) {
            const buf = (dunlevUreached === dptr.entry_lev)
                ? `${dptr.dname}:`
                : `${dptr.dname}: levels ${dptr.depth_start} to `
                  + `${dptr.depth_start + dunlevUreached - 1}`;
            // C ref: windows.c add_menu_heading() — "suppress highlighting
            // during end-of-game disclosure": program_state.gameover forces
            // ATR_NONE there, so only the live '#overview' command (final==0)
            // gets the highlighted iflags.menu_headings.attr (ATR_INVERSE).
            lines.push({ text: buf, attr: final ? 0 : ATR_INVERSE });
            lastdun = p.dnum;
        }

        // C: the quest and Fort Ludios levels are numbered as if level 1.
        const depthstart = (p.dnum === game.quest_dnum || p.dnum === game.knox_level?.dnum)
            ? 1 : dptr.depth_start;
        let lbuf = `${OVERVIEW_TAB}Level ${depthstart + p.dlevel - 1}:`;
        // C ref: print_mapseen():3567 — "wizmode prints out proto dungeon names
        // for clarity".  Sits BEFORE the custom annotation.
        if (wizard()) {
            const slev = Is_special({ dnum: p.dnum, dlevel: p.dlevel });
            if (slev) lbuf += ` [${slev.proto}]`;
        }
        if (custom) lbuf += ` "${custom}"`;
        if (onHere) {
            const ASCENDED = 15, ESCAPED = 14;
            const verb = (final <= 0 || (final === 1 && how === ASCENDED)) ? 'are'
                : (final === 1 && how === ESCAPED) ? 'left from' : 'were';
            lbuf += ` <- You ${verb} here.`;
        }
        lines.push({ text: lbuf, attr: 0 });

        if (ofInterest) {
            let fbuf = '';
            let n = 0;
            const add = (nam, val) => {
                if (!val) return;
                fbuf += (n++ > 0 ? ', ' : OVERVIEW_PREFIX)
                    + `${overview_seen_string(val, nam)} ${nam}${overview_plur(val)}`;
            };
            // C ref: print_mapseen() lists interests "in an order vaguely
            // corresponding to how important they are" — shops first.  A single
            // shop names its type ("a general store"); 2+ collapse to "N shops".
            if (feat.nshop > 1) add('shop', feat.nshop);
            else if (feat.nshop > 0)
                fbuf += (n++ > 0 ? ', ' : OVERVIEW_PREFIX) + an_dg(shop_string(feat.shoptype));
            add('throne', feat.nthrone);
            add('fountain', feat.nfount);
            add('sink', feat.nsink);
            add('grave', feat.ngrave);
            add('tree', feat.ntree);
            const idx = OVERVIEW_PREFIX.length;
            fbuf = fbuf.slice(0, idx) + fbuf[idx].toUpperCase() + fbuf.slice(idx + 1) + '.';
            lines.push({ text: fbuf, attr: 0 });
        }

        // C ref: print_mapseen():3681 — the known branch connection, printed
        // after the feature line.  `, level N` is appended only for an upward
        // branch (Sokoban, Vlad's), where the destination depth is not obvious.
        if (ms?.br) {
            const br = ms.br;
            let bbuf = `${OVERVIEW_PREFIX}${br_string2(br)} to `
                     + `${M.dungeons[br.end2.dnum]?.dname ?? ''}`;
            if (br.end1_up) bbuf += `, level ${depth(br.end2)}`;
            lines.push({ text: `${bbuf}.`, attr: 0 });
        }

        // C ref: print_mapseen()'s final_resting_place block — always entered
        // when final>0 (die-here bumps kncnt to 1); the bones-cemetery half of
        // that loop (other heroes' remains) isn't modeled since no covered
        // session ever reaches a level that already has bones.
        if (final === 2 && onHere) {
            lines.push({ text: `${OVERVIEW_PREFIX}Final resting place for`, attr: 0 });
            lines.push({
                text: `${OVERVIEW_PREFIX}${OVERVIEW_TAB}you, ${game._killer_name || 'died'}.`,
                attr: 0,
            });
        }
    }
    return lines;
}

// C ref: dbridge.c is_pool/is_lava/is_ice — terrain-class predicates.  The
// DB_UNDER (drawbridge-up) variants aren't tracked on the contest levels
// reached; the plain typ comparisons cover the ordinary cases.
function is_pool(x, y) {
    if (!isok(x, y)) return false;
    const t = game.level?.at(x, y)?.typ;
    return t === POOL || t === MOAT || t === WATER;
}
function is_lava(x, y) {
    if (!isok(x, y)) return false;
    const t = game.level?.at(x, y)?.typ;
    return t === LAVAPOOL || t === LAVAWALL;
}
function is_ice(x, y) {
    if (!isok(x, y)) return false;
    return game.level?.at(x, y)?.typ === ICE;
}
// C ref: stairs.c On_stairs(x,y) — stairway_at(x,y) != NULL.  Stairs live on
// game.stairs (mklev.js) with .sx/.sy coordinates.
function On_stairs(x, y) {
    for (let s = game.stairs; s; s = s.next)
        if (s.sx === x && s.sy === y) return true;
    return false;
}

// C ref: do_name.c:1492 hliquid(liquidpref) — js/do_name.js owns it.  The old
// identity stub here skipped the display-rng draw a hallucinating hero makes,
// which shifts every later hallucination pick.
export { hliquid } from './do_name.js';

// C ref: dungeon.c surface(x,y) — the noun for the terrain at (x,y) used in
// "sit on the %s", "Having fun sitting on the %s?", etc.  SURFACE_AT resolves
// a raised drawbridge to the terrain beneath it; the contest sessions never
// sit on a raised drawbridge, so the plain typ is used.
export function surface(x, y) {
    const u = game.u || {};
    const lev = game.level?.at(x, y) || {};
    const levtyp = lev.typ; // SURFACE_AT(x,y): DRAWBRIDGE_UP resolves under-typ
    const uz = u.uz;
    if (x === u.ux && y === u.uy && u.uswallow && u.ustuck)
        return 'maw'; /* swallowed: 'husk'/'maw' — not reached by contest hero */
    else if (IS_AIR(levtyp))
        return Is_waterlevel(uz) ? 'air bubble'
                                 : (levtyp === CLOUD) ? 'cloud' : 'air';
    else if (is_pool(x, y))
        return (u.uprops?.Underwater && !Is_waterlevel(uz))
            ? 'bottom' : hliquid('water');
    else if (is_ice(x, y))
        return 'ice';
    else if (is_lava(x, y))
        return hliquid('lava');
    else if (levtyp === DRAWBRIDGE_DOWN)
        return 'bridge';
    else if (IS_ALTAR(levtyp))
        return 'altar';
    else if (IS_GRAVE(levtyp))
        return 'headstone';
    else if (IS_FOUNTAIN(levtyp))
        return 'fountain';
    else if (On_stairs(x, y))
        return 'stairs';
    else if (IS_WALL(levtyp) || levtyp === SDOOR)
        return 'wall'; /* 'surface' during Passes_walls */
    else if (IS_DOOR(levtyp))
        return 'doorway'; /* even for closed door */
    else if (IS_ROOM(levtyp) && !Is_earthlevel(uz))
        return 'floor';
    else
        return 'ground';
}

// C ref: dungeon.c:3410 endgamelevelname(outbuf, indx) — name the endgame level
// whose observable_depth() is `indx`.  -5 is the Astral Plane (it keeps its own
// name); -4..-1 are the four Elemental Planes, spelled "Plane of <element>".
// Callers that want the bare element strip the "Plane of " prefix themselves
// (the status line), and insight.c prefixes "Elemental " instead.
export function endgamelevelname(indx) {
    switch (indx) {
    case -5: return 'Astral Plane';
    case -4: return 'Plane of Water';
    case -3: return 'Plane of Fire';
    case -2: return 'Plane of Air';
    case -1: return 'Plane of Earth';
    default: return `unknown plane #${indx}`;
    }
}

/* ══════════════════════════════════════════════════════════════════════════
 * The rest of dungeon.c.
 *
 * INERT: nothing above this line calls anything below it.  The mapseen chain
 * built here lives on game.mapseenchn (C's svm.mapseenchn); the ad-hoc
 * game._mapseen that build_overview_lines()/room_discovered() use is a
 * DIFFERENT field, so the two coexist until the wire-up pass replaces the
 * latter with show_overview()/recalc_mapseen().
 *
 * Helpers belonging to other C files are module-private here: every module
 * that exports them (shk.js, priest.js, display.js, dbridge.js, botl.js, ...)
 * imports THIS file, so a static import would close a cycle.  Async functions
 * reach them with `await import()`; sync ones keep a local copy, exactly as
 * is_pool()/On_stairs()/depth_dg() above already do.
 * ══════════════════════════════════════════════════════════════════════════ */

// C ref: dungeon.c:1439 on_level(lev1, lev2).  Private copies also sit at
// wizcmds.js:106 and questpgr.js:2883.
function on_level(lev1, lev2) {
    return !!lev1 && !!lev2 && lev1.dnum === lev2.dnum
        && lev1.dlevel === lev2.dlevel;
}

// C ref: dungeon.c:1376 ledger_no() / :1392 maxledgerno().  bones.js:69 and
// save.js:287 keep the same private copies for the same import-order reason.
function ledger_no(lev) {
    return (lev.dlevel | 0) + (game.dungeons?.[lev.dnum]?.ledger_start | 0);
}
function maxledgerno() {
    const d = game.dungeons?.[(game.n_dgns | 0) - 1];
    return d ? (d.ledger_start | 0) + (d.num_dunlevs | 0) : 0;
}

// C ref: youprop.h:103/240 Blind / Levitation / Flying, rm.h:538 Sokoban,
// you.h Upolyd.  Six other files keep the same one-line private copies.
function Blind() {
    const u = game.u || {};
    return !!(u.ublindf_blind || (u.uprops?.Blinded | 0) > 0 || game.ublindf);
}
function Levitation() { return !!game.u?.uprops?.Levitation; }
function Flying() { return !!game.u?.uprops?.Flying; }
function Upolyd() { return !!game.u?.Upolyd; }
function Sokoban() { return !!game.level?.flags?.sokoban_rules; }

// C ref: dungeon.h:142 In_tutorial(x) / :127 Is_sanctum(x).  botl.js:315 and
// cmd.js:7347 hold private In_tutorial copies; Is_sanctum has none yet.
function In_tutorial(lev) { return !!lev && lev.dnum === game.tutorial_dnum; }
function Is_sanctum(lev) {
    const sl = game.sanctum_level;
    return !!sl && !!lev && lev.dnum === sl.dnum && lev.dlevel === sl.dlevel;
}

// C ref: dungeon.c:1690 has_ceiling(lev).  NOTE: monmove.js:948's private copy
// answers `!Is_airlevel && !Is_waterlevel` and ignores its argument, so it says
// TRUE on the Astral Plane and the Planes of Fire/Earth where C says FALSE.
function has_ceiling(lev) {
    if (In_endgame(lev) && !Is_earthlevel(lev))
        return false;
    return true;
}

// C ref: align.h:59/60 Amask2msa(x) / Msa2amask(x).
function Amask2msa(x) { return ((x & AM_MASK) === 4) ? 3 : (x & AM_MASK); }
function Msa2amask(x) { return (x === 3) ? 4 : x; }

// C ref: hacklib.c mungspaces()/highc(), objnam.c plur().  Several files keep
// the same private copies (extcmd-handlers.js:292, topten.js:188, ...).
function mungspaces(s) {
    return String(s ?? '').replace(/\s+/g, ' ').replace(/^ | $/g, '');
}
function highc(c) { return String(c ?? '').toUpperCase(); }
function plur(n) { return (n === 1) ? '' : 's'; }

// C ref: hack.h Race_if(pm) == (gu.urace.malenum == pm); artifact.js:114 holds
// the same races[].malenum table.
const DG_RACE_PM = [260 /*PM_HUMAN*/, 264 /*PM_ELF*/, 44 /*PM_DWARF*/,
                    165 /*PM_GNOME*/, 72 /*PM_ORC*/];
const PM_DWARF = 44;
function Race_if(pm) {
    const mnum = game.urace?.mnum;
    return mnum != null && DG_RACE_PM[mnum] === pm;
}

// C ref: mon.c m_at(x, y) / display.c canseemon(mon).  display.js exports
// m_at() but imports this file; muse.js:252 and uhitm.js:308 keep the same
// private canseemon().  The infravision half of _canseemon() needs
// see_with_infrared() (mondata.c), which is not reachable from here.
function m_at(x, y) {
    for (const mtmp of (game.level?.monsters || []))
        if (mtmp && mtmp.mx === x && mtmp.my === y
            && !(mtmp.mhp != null && mtmp.mhp <= 0))
            return mtmp;
    return null;
}
function canseemon(mtmp) {
    if (!mtmp) return false;
    if (game.u?.uswallow) return true;
    if (mtmp.minvis && !game.u?.see_invis) return false;
    if (mtmp.mundetected) return false;
    /* UNPORTED: see_with_infrared(mon) (mondata.c) */
    return !!game.level?.at(mtmp.mx, mtmp.my)?.seenv;
}

// C ref: mextra.h:234 has_mcorpsenm(mon), pray.c:2490 altarmask_at(x, y).
// dig.js:683's private copy drops the M_AP_FURNITURE arm; this one keeps it.
function has_mcorpsenm(mon) {
    return !!mon?.mextra && MCORPSENM(mon) !== NON_PM;
}
function altarmask_at(x, y) {
    let res = 0;

    if (isok(x, y)) {
        const mon = m_at(x, y);

        if (mon && mon.m_ap_type === M_AP_FURNITURE
            && mon.mappearance === S_altar)
            res = has_mcorpsenm(mon) ? MCORPSENM(mon) : 0;
        else if (IS_ALTAR(game.level?.at(x, y)?.typ))
            res = game.level.at(x, y).altarmask | 0;
    }
    return res;
}

// C ref: dbridge.c:115 db_under_typ(mask) / :136 is_drawbridge_wall(x, y).
// dbridge.js exports both but imports this file.
function db_under_typ(mask) {
    switch (mask & DB_UNDER) {
    case DB_ICE:
        return ICE;
    case DB_LAVA:
        return LAVAPOOL;
    case DB_MOAT:
        return MOAT;
    default:
        return STONE;
    }
}
function is_drawbridge_wall(x, y) {
    const at = (xx, yy) => game.level?.at(xx, yy);
    if (!isok(x, y)) return -1;
    const lev = at(x, y);
    if (!lev || (lev.typ !== DOOR && lev.typ !== DBWALL)) return -1;

    if (isok(x + 1, y) && IS_DRAWBRIDGE(at(x + 1, y).typ)
        && ((at(x + 1, y).drawbridgemask | 0) & DB_DIR) === DB_WEST)
        return DB_WEST;
    if (isok(x - 1, y) && IS_DRAWBRIDGE(at(x - 1, y).typ)
        && ((at(x - 1, y).drawbridgemask | 0) & DB_DIR) === DB_EAST)
        return DB_EAST;
    if (isok(x, y - 1) && IS_DRAWBRIDGE(at(x, y - 1).typ)
        && ((at(x, y - 1).drawbridgemask | 0) & DB_DIR) === DB_SOUTH)
        return DB_SOUTH;
    if (isok(x, y + 1) && IS_DRAWBRIDGE(at(x, y + 1).typ)
        && ((at(x, y + 1).drawbridgemask | 0) & DB_DIR) === DB_NORTH)
        return DB_NORTH;

    return -1;
}

// C ref: defsym.h PCHAR() order — the S_* indices cmap_to_type() switches on.
// cmd.js:3440 carries the same block.
const S_stone = 0, S_vwall = 1, S_hwall = 2, S_tlcorn = 3, S_trcorn = 4,
      S_blcorn = 5, S_brcorn = 6, S_crwall = 7, S_tuwall = 8, S_tdwall = 9,
      S_tlwall = 10, S_trwall = 11, S_ndoor = 12, S_vodoor = 13, S_hodoor = 14,
      S_vcdoor = 15, S_hcdoor = 16, S_bars = 17, S_tree = 18, S_room = 19,
      S_darkroom = 20, S_corr = 22, S_litcorr = 23, S_upstair = 25,
      S_dnstair = 26, S_upladder = 27, S_dnladder = 28, S_altar = 33,
      S_grave = 34, S_throne = 35, S_sink = 36, S_fountain = 37, S_pool = 38,
      S_ice = 39, S_lava = 40, S_lavawall = 41, S_vodbridge = 42,
      S_hodbridge = 43, S_vcdbridge = 44, S_hcdbridge = 45, S_air = 46,
      S_cloud = 47, S_water = 48;

// C ref: mkroom.c:912 cmap_to_type(sym) — display symbol back to topology
// type, for remembered terrain when a mimic poses as furniture.  mkroom.js does
// not have it yet; it lives here because update_lastseentyp() is its only
// caller in this file and cannot await an import.
function cmap_to_type(sym) {
    let typ = STONE; /* catchall */

    switch (sym) {
    case S_stone: typ = STONE; break;
    case S_vwall: typ = VWALL; break;
    case S_hwall: typ = HWALL; break;
    case S_tlcorn: typ = TLCORNER; break;
    case S_trcorn: typ = TRCORNER; break;
    case S_blcorn: typ = BLCORNER; break;
    case S_brcorn: typ = BRCORNER; break;
    case S_crwall: typ = CROSSWALL; break;
    case S_tuwall: typ = TUWALL; break;
    case S_tdwall: typ = TDWALL; break;
    case S_tlwall: typ = TLWALL; break;
    case S_trwall: typ = TRWALL; break;
    case S_ndoor:  /* no door (empty doorway) */
    case S_vodoor: /* open door in vertical wall */
    case S_hodoor: /* open door in horizontal wall */
    case S_vcdoor: /* closed door in vertical wall */
    case S_hcdoor: typ = DOOR; break;
    case S_bars: typ = IRONBARS; break;
    case S_tree: typ = TREE; break;
    case S_room:
    case S_darkroom: typ = ROOM; break;
    case S_corr:
    case S_litcorr: typ = CORR; break;
    case S_upstair:
    case S_dnstair: typ = STAIRS; break;
    case S_upladder:
    case S_dnladder: typ = LADDER; break;
    case S_altar: typ = ALTAR; break;
    case S_grave: typ = GRAVE; break;
    case S_throne: typ = THRONE; break;
    case S_sink: typ = SINK; break;
    case S_fountain: typ = FOUNTAIN; break;
    case S_pool: typ = POOL; break;
    case S_ice: typ = ICE; break;
    case S_lava: typ = LAVAPOOL; break;
    case S_vodbridge: /* open drawbridge spanning north/south */
    case S_hodbridge: typ = DRAWBRIDGE_DOWN; break; /* east/west */
    case S_vcdbridge: /* closed drawbridge in vertical wall */
    case S_hcdbridge: typ = DBWALL; break;
    case S_air: typ = AIR; break;
    case S_cloud: typ = CLOUD; break;
    case S_water: typ = WATER; break;
    case S_lavawall: typ = LAVAWALL; break;
    default: break; /* not a cmap symbol? */
    }
    return typ;
}

// C ref: priest.c:376 has_shrine(pri) / :153 histemple_at() / :161
// inhistemple().  monmove.js:1635 and sounds.js:790 hold private copies of the
// last two; in_rooms() (shkroom.js) is behind a dynamic import, which is why
// histemple_at()/inhistemple() are async here.
function has_shrine(pri) {
    if (!pri || !pri.ispriest) return false;
    const epri_p = pri.epri;
    const lev = game.level?.at(epri_p?.shrpos?.x, epri_p?.shrpos?.y);
    if (!lev || !IS_ALTAR(lev.typ) || !((lev.altarmask | 0) & AM_SHRINE))
        return false;
    return epri_p.shralign === Amask2align((lev.altarmask | 0) & ~AM_SHRINE);
}
async function histemple_at(priest, x, y) {
    const { in_rooms } = await import('./shkroom.js');
    return !!priest && !!priest.ispriest
        && (priest.epri?.shroom === in_rooms(x, y, TEMPLE)[0])
        && on_level(priest.epri?.shrlevel, game.u?.uz);
}
async function inhistemple(priest) {
    /* make sure we have a priest */
    if (!priest || !priest.ispriest)
        return false;
    /* priest must be on right level and in right room */
    if (!(await histemple_at(priest, priest.mx, priest.my)))
        return false;
    /* temple room must still contain properly aligned altar */
    return has_shrine(priest);
}

// C ref: questpgr.c:50 ldrname() — "the " + mons[urole.ldrnum].pmnames[NEUTRAL].
// UNPORTED: js/role.js's roles[] carries no ldrnum and questpgr.js's
// QUEST_ROLE_DATA[].ldr (the identical string, article included) is
// module-private, so there is no source of truth reachable from here.  Left
// loud rather than stubbed to a plausible name — the three print_mapseen()
// lines that interpolate it are the only thing affected.
function ldrname() { return null; }

// C ref: windows.c:1816 add_menu_heading() / :1832 add_menu_str() — the two
// wrappers print_mapseen() uses.  windows.c has no js/ counterpart; these call
// the tty windowport directly (the whole port is tty-only).
function add_menu_heading(wt, tmpwin, buf) {
    const any = {};
    let attr = game.iflags?.menu_headings?.attr ?? ATR_INVERSE;
    let color = game.iflags?.menu_headings?.color ?? NO_COLOR;

    /* suppress highlighting during end-of-game disclosure */
    if (game.program_state?.gameover)
        attr = ATR_NONE, color = NO_COLOR;

    wt.tty_add_menu(tmpwin, null, any, '\0', '\0', attr, color,
                    buf, MENU_ITEMFLAGS_SKIPMENUCOLORS);
}
function add_menu_str(wt, tmpwin, buf) {
    const any = {};

    wt.tty_add_menu(tmpwin, null, any, '\0', '\0', ATR_NONE, NO_COLOR,
                    buf, MENU_ITEMFLAGS_NONE);
}

/* ── dungeon.c:91 dumpit ─────────────────────────────────────────────────── */

// C ref: dungeon.c:91 dumpit() — #ifdef DEBUG dump of the built dungeon, gated
// by explicitdebug(__FILE__) (the `debugcore` option naming this file).  C
// pauses on getchar() between sections; there is no synchronous stdin read
// here, so the pauses are dropped and nothing else changes.
function explicitdebug(_file) {
    /* C: hack.h explicitdebug(f) — iflags.debugcore[] name match */
    return !!game.iflags?.debugcore?.includes?.('dungeon.c');
}

export function dumpit() {
    let i;
    const err = (s) => { try { process.stderr.write(s); } catch (_e) { /*NOP*/ } };

    if (!explicitdebug('dungeon.c'))
        return;

    for (i = 0; i < game.n_dgns; i++) {
        const DD = game.dungeons[i];
        err(`\n#${i} "${DD.dname}" (${DD.proto}):\n`);
        err(`    num_dunlevs ${DD.num_dunlevs}, dunlev_ureached ${DD.dunlev_ureached}\n`);
        err(`    depth_start ${DD.depth_start}, ledger_start ${DD.ledger_start}\n`);
        err(`    flags:${DD.flags.rogue_like ? ' rogue_like' : ''}`
            + `${DD.flags.maze_like ? ' maze_like' : ''}`
            + `${DD.flags.hellish ? ' hellish' : ''}\n`);
    }
    err('\nSpecial levels:\n');
    for (const x of (game.sp_levchn || [])) {
        err(`${x.proto} (${x.rndlevs}): `);
        err(`on ${x.dlevel.dnum}, ${x.dlevel.dlevel}; `);
        err(`flags:${x.flags.rogue_like ? ' rogue_like' : ''}`
            + `${x.flags.maze_like ? ' maze_like' : ''}`
            + `${x.flags.hellish ? ' hellish' : ''}`
            + `${x.flags.town ? ' town' : ''}\n`);
    }
    err('\nBranches:\n');
    for (const br of (game.branches || [])) {
        err(`${br.id}: ${br.type === BR_STAIR ? 'stair'
            : br.type === BR_NO_END1 ? 'no end1'
            : br.type === BR_NO_END2 ? 'no end2'
            : br.type === BR_PORTAL ? 'portal' : 'unknown'}`
            + `, end1 ${br.end1.dnum} ${br.end1.dlevel}`
            + `, end2 ${br.end2.dnum} ${br.end2.dlevel}`
            + `, ${br.end1_up ? 'end1 up' : 'end1 down'}\n`);
    }
    err('\nDone\n');
    return;
}

/* ── dungeon.c:149 save_dungeon / :211 restore_dungeon ──────────────────── */

// C ref: hack.h:971/972 update_file()/release_data(); save.js exports the same
// two but imports this file.
function dg_update_file(mode) { return (mode & (COUNTING | WRITING)) !== 0; }
function dg_release_data(mode) { return (mode & FREEING) !== 0; }

// C ref: hack.h:358 struct dgn_topology — this port scatters the same fields
// over game.<name> (level_map above builds them), so Sfo_dgn_topology()'s one
// struct write becomes a gather and Sfi_dgn_topology()'s read a scatter.
const DGN_TOPOLOGY_LEVELS = [
    'oracle_level', 'bigroom_level', 'rogue_level', 'medusa_level',
    'stronghold_level', 'valley_level', 'wiz1_level', 'wiz2_level',
    'wiz3_level', 'juiblex_level', 'orcus_level', 'baalzebub_level',
    'asmodeus_level', 'portal_level', 'sanctum_level', 'earth_level',
    'water_level', 'fire_level', 'air_level', 'astral_level',
];
const DGN_TOPOLOGY_DNUMS = [
    'tower_dnum', 'sokoban_dnum', 'mines_dnum', 'quest_dnum', 'tutorial_dnum',
];
const DGN_TOPOLOGY_TAIL = [
    'qstart_level', 'qlocate_level', 'nemesis_level', 'knox_level',
    'mineend_level', 'sokoend_level',
];

function save_dgn_topology() {
    const out = {};
    for (const nm of DGN_TOPOLOGY_LEVELS) out[nm] = game[nm] ?? null;
    for (const nm of DGN_TOPOLOGY_DNUMS) out[nm] = game[nm] ?? 0;
    for (const nm of DGN_TOPOLOGY_TAIL) out[nm] = game[nm] ?? null;
    return out;
}
function restore_dgn_topology(src) {
    if (!src) return;
    for (const nm of DGN_TOPOLOGY_LEVELS) game[nm] = src[nm] ?? null;
    for (const nm of DGN_TOPOLOGY_DNUMS) game[nm] = src[nm] ?? 0;
    for (const nm of DGN_TOPOLOGY_TAIL) game[nm] = src[nm] ?? null;
}

// C ref: dungeon.c:149 save_dungeon(nhfp, perform_write, free_data).  `nhfp`
// is this port's save-mode int (save.js's convention) and the written stream is
// the returned object; save.js:834's `out.dungeon = { unported: 'save_dungeon' }`
// marker is the slot it belongs in.
export async function save_dungeon(nhfp, perform_write, free_data) {
    let i, count;
    const out = {};

    if (perform_write) {
        out.dungeon_count = game.n_dgns | 0;
        out.dungeons = [];
        for (i = 0; i < (game.n_dgns | 0); ++i)
            out.dungeons.push(game.dungeons?.[i] ?? null);
        out.dungeon_topology = save_dgn_topology();
        out.tune = (game.tune || []).join('');
        count = 0;
        for (const _curr of (game.branches || [])) { void _curr; count++; }
        out.branch_count = count;

        out.branches = [];
        for (const curr of (game.branches || []))
            out.branches.push(curr);
        count = maxledgerno();
        out.level_info_count = count;
        out.level_info = [];
        for (i = 0; i < count; ++i)
            out.level_info.push(game.level_info?.[i] ?? null);
        out.inv_pos = game.inv_pos ?? null;

        count = 0;
        for (const _cm of (game.mapseenchn || [])) { void _cm; count++; }

        out.mapseen_count = count;

        out.mapseen = [];
        for (const curr_ms of (game.mapseenchn || []))
            out.mapseen.push(await save_mapseen(nhfp, curr_ms));
    }

    if (free_data) {
        /* C free()s every branch; dropping the list is the whole of it here */
        game.branches = [];
        const { savecemetery } = await import('./save.js');
        for (const curr_ms of (game.mapseenchn || [])) {
            if (curr_ms.custom)
                curr_ms.custom = null;
            if (curr_ms.final_resting_place)
                savecemetery(curr_ms, 'final_resting_place', nhfp);
        }
        game.mapseenchn = [];
    }
    return perform_write ? out : null;
}

// C ref: dungeon.c:211 restore_dungeon(nhfp).  `nhfp` is the object
// save_dungeon() wrote.
export function restore_dungeon(nhfp) {
    let count = 0;
    let i;

    game.n_dgns = nhfp.dungeon_count | 0;
    game.dungeons = [];
    for (i = 0; i < (game.n_dgns | 0); ++i)
        game.dungeons[i] = nhfp.dungeons?.[i] ?? null;
    restore_dgn_topology(nhfp.dungeon_topology);
    game.tune = String(nhfp.tune ?? '').split('');

    game.branches = [];

    count = nhfp.branch_count | 0;

    for (i = 0; i < count; i++) {
        const curr = nhfp.branches?.[i] ?? null;
        if (curr) curr.next = null;
        game.branches.push(curr);
    }

    count = nhfp.level_info_count | 0;

    if (count >= MAXLINFO)
        throw new Error(`level information count larger (${count}) than allocated size`);
    game.level_info = [];
    for (i = 0; i < count; ++i)
        game.level_info[i] = nhfp.level_info?.[i] ?? null;

    game.inv_pos = nhfp.inv_pos ?? null;

    count = nhfp.mapseen_count | 0;

    game.mapseenchn = [];
    for (i = 0; i < count; i++) {
        const curr_ms = load_mapseen(nhfp.mapseen?.[i]);
        curr_ms.next = null;
        game.mapseenchn.push(curr_ms);
    }
}

/* ── dungeon.c:311 find_branch (the pd == NULL arm) ─────────────────────── */

// C ref: dungeon.c:311 find_branch(s, NULL) — "support for level tport by
// name": returns (ledger_no(end1) << 8) | ledger_no(end2) for the branch whose
// FAR dungeon is named `s`, else -1.  find_branch() above implements only the
// pd != NULL arm (its body is untouched by this pass), so the other arm lives
// here under a distinct name.
function find_branch_by_dname(s) {
    let br = null;
    let dnam;

    for (const b of (game.branches || [])) {
        dnam = game.dungeons?.[b.end2.dnum]?.dname ?? '';
        if (dnam.toLowerCase() === String(s).toLowerCase()
            || (dnam.slice(0, 4).toLowerCase() === 'the '
                && dnam.slice(4).toLowerCase() === String(s).toLowerCase())) {
            br = b;
            break;
        }
    }
    return br ? ((ledger_no(br.end1) << 8) | ledger_no(br.end2)) : -1;
}

/* ── dungeon.c:1185 free_proto_dungeon ──────────────────────────────────── */

// C ref: dungeon.c:1185 free_proto_dungeon(pd) — free()s the strdup'd names in
// the prototype tables.  Every one of them is a plain JS string owned by the
// pd object init_dungeons() drops on return, so this has nothing to do; kept
// for the position it holds at the end of init_dungeons().
export function free_proto_dungeon(pd) {
    let i;

    for (i = 0; i < pd.n_brs; i++) {
        void pd.tmpbranch[i].name;
    }
    for (i = 0; i < pd.n_levs; i++) {
        void pd.tmplevel[i].name;
        if (pd.tmplevel[i].chainlvl)
            void pd.tmplevel[i].chainlvl;
    }
    for (i = 0; i < game.n_dgns; i++) {
        void pd.tmpdungeon[i].name;
        void pd.tmpdungeon[i].protoname;
    }
}

/* ── dungeon.c:1339 deepest_lev_reached, :1402 ledger_to_dnum, :1422 ─────── */

// C ref: dungeon.c:1339 deepest_lev_reached(noquest).  The body already sits
// above as deepest_lev_reached_dg() (level_difficulty_c()'s callee); this is
// the C name for it, not a second copy.
export function deepest_lev_reached(noquest) {
    return deepest_lev_reached_dg(noquest);
}

// C ref: dungeon.c:1402 ledger_to_dnum(ledgerno).
export function ledger_to_dnum(ledgerno) {
    let i;

    /* find i such that (i->base + 1) <= ledgerno <= (i->base + i->count) */
    for (i = 0; i < game.n_dgns; i++)
        if (game.dungeons[i].ledger_start < ledgerno
            && ledgerno <= (game.dungeons[i].ledger_start
                            + game.dungeons[i].num_dunlevs))
            return i;

    throw new Error(`level number out of range [ledger_to_dnum(${ledgerno})]`);
}

// C ref: dungeon.c:1422 ledger_to_dlev(ledgerno).
export function ledger_to_dlev(ledgerno) {
    return ledgerno - game.dungeons[ledger_to_dnum(ledgerno)].ledger_start;
}

/* ── dungeon.c:1548 earth_sense ─────────────────────────────────────────── */

const FOOT = 5;   /* hack.h:136 body_part() index */

// C ref: dungeon.c:1548 earth_sense() — dwarves sense buried objects underfoot.
// Called from the tail of u_on_newpos(); async only because pline() is.
export async function earth_sense() {
    if (!Race_if(PM_DWARF))
        return;
    if (game.u?.usteed || Flying() || Levitation() || Upolyd())
        return;
    const u = game.u;
    const typ = game.level?.at(u.ux, u.uy)?.typ;
    if (typ !== CORR && typ !== ROOM)
        return;

    for (const otmp of (game.level?.buriedobjlist || []))
        if (otmp.ox === u.ux && otmp.oy === u.uy) {
            const { pline } = await import('./display.js');
            const { body_part, makeplural } = await import('./invent.js');
            await pline(`You sense something below your ${makeplural(body_part(FOOT))}.`);
            return;
        }
}

/* ── dungeon.c:1701 avoid_ceiling ──────────────────────────────────────── */

// C ref: dungeon.c:1701 avoid_ceiling(lev) — parts of the quest home levels are
// conceptually outdoors, so messages there must not say "ceiling" at all.
export function avoid_ceiling(lev) {
    if (In_quest(lev) || !has_ceiling(lev))
        return true;
    return false;
}

/* ── dungeon.c:1957 goto_hell, :1986 assign_rnd_level ──────────────────── */

// C ref: dungeon.c:1957 goto_hell(at_stairs, falling).
export async function goto_hell(at_stairs, falling) {
    const lev = find_hell();
    const { goto_level } = await import('./do.js');
    await goto_level(lev, at_stairs, falling, false);
}

// C ref: dungeon.c:1986 assign_rnd_level(dest, src, range) — dest = src +
// rnd(range), clamped to src's dungeon.  The ONE rnd() draw is the whole RNG
// contract: a negative range still draws rnd(-range), it is only the sign of
// the result that flips.
export function assign_rnd_level(dest, src, range) {
    dest.dnum = src.dnum;
    dest.dlevel = src.dlevel + ((range > 0) ? rnd(range) : -rnd(-range));

    if (dest.dlevel > dunlevs_in_dungeon(dest))
        dest.dlevel = dunlevs_in_dungeon(dest);
    else if (dest.dlevel < 1)
        dest.dlevel = 1;
}

/* ── dungeon.c:2098 lev_by_name ────────────────────────────────────────── */

// C ref: dungeon.c:2087 dlev_in_current_branch(dlev) — same branch, or else
// main dungeon <-> Gehennom.
function dlev_in_current_branch(dlev) {
    const uz = game.u?.uz;
    return !!uz && (dlev.dnum === uz.dnum
        || (uz.dnum === game.valley_level?.dnum
            && dlev.dnum === game.medusa_level?.dnum)
        || (uz.dnum === game.medusa_level?.dnum
            && dlev.dnum === game.valley_level?.dnum));
}

// C ref: dungeon.c:2098 lev_by_name(nam) — resolve one word to a level DEPTH
// (0 when it names nothing the hero may teleport to).  Recognized names are the
// ones print_dungeon() shows, plus the player's own annotations.
//
// NOTE: js/do.js:2066's lev_by_name() is a stub returning 0; swapping its
// callers over to this is a separate measured pass and is NOT done here.
export function lev_by_name(nam) {
    let lev = 0;
    let slev = null;
    let dlev = null;
    let p, idx, idxtoo;
    let mseen;

    /* look at the player's custom level annotations first */
    if ((mseen = find_mapseen_by_str(nam)) != null) {
        dlev = mseen.lev;
    } else {
        /* no matching annotation, check whether they used a name we know */

        /* allow strings like "the oracle level" to find "oracle" */
        if (String(nam).slice(0, 4).toLowerCase() === 'the ')
            nam = String(nam).slice(4);
        p = String(nam).toLowerCase().indexOf(' level');
        if (p >= 0 && p === String(nam).length - 6)
            nam = String(nam).slice(0, String(nam).length - 6);
        /* hell is the old name, and wouldn't match; gehennom would match its
           branch, yielding the castle level instead of valley of the dead */
        if (String(nam).toLowerCase() === 'gehennom'
            || String(nam).toLowerCase() === 'hell') {
            if (In_V_tower(game.u?.uz))
                nam = " to Vlad's tower"; /* branch to... */
            else
                nam = 'valley';
        } else if (String(nam).toLowerCase() === 'delphi') {
            /* Oracle says "welcome to Delphi" so recognize that name too */
            nam = 'oracle';
        }

        if ((slev = find_level(nam)) != null)
            dlev = slev.dlevel;
    }

    if (mseen || slev) {
        idx = ledger_no(dlev);
        if (dlev_in_current_branch(dlev)
            /* either wizard mode or else seen and not forgotten */
            && (wizard()
                || ((game.level_info?.[idx]?.flags | 0) & VISITED) === VISITED)) {
            lev = depth(dlev);
        }
    } else { /* not a specific level; try branch names */
        idx = find_branch_by_dname(nam);
        /* "<branch> to Xyzzy" */
        p = String(nam).toLowerCase().indexOf(' to ');
        if (idx < 0 && p >= 0)
            idx = find_branch_by_dname(String(nam).slice(p + 4));

        if (idx >= 0) {
            idxtoo = (idx >> 8) & 0x00FF;
            idx &= 0x00FF;
            /* either wizard mode, or else _both_ sides of branch seen */
            if (wizard()
                || ((((game.level_info?.[idx]?.flags | 0) & VISITED) === VISITED)
                    && (((game.level_info?.[idxtoo]?.flags | 0) & VISITED)
                        === VISITED))) {
                if (ledger_to_dnum(idxtoo) === game.u?.uz?.dnum)
                    idx = idxtoo;
                dlev = { dnum: ledger_to_dnum(idx), dlevel: ledger_to_dlev(idx) };
                if (dlev_in_current_branch(dlev))
                    lev = depth(dlev);
            }
        }
    }
    return lev;
}

/* ── dungeon.c:2478 get_annotation .. :2500 query_annotation ────────────── */

// C ref: dungeon.c:2478 get_annotation(lev).
export function get_annotation(lev) {
    const mptr = find_mapseen(lev);
    if (mptr)
        return mptr.custom;
    return null;
}

// C ref: dungeon.c:2489 print_level_annotation() — do.c's goto_level() tail.
export async function print_level_annotation() {
    const annotation = get_annotation(game.u?.uz);
    if (annotation) {
        const { pline } = await import('./display.js');
        await pline(`You remember this level as ${annotation}.`);
    }
}

// C ref: dungeon.c:2500 query_annotation(lev) — the #annotate prompt.  `lev`
// null means the current level.  EDIT_GETLIN is not defined in the recorder
// build, so the "Replace annotation ..." arm is the live one.
export async function query_annotation(lev) {
    let mptr;
    let nbuf; /* Buffer for response */

    if (!(mptr = find_mapseen(lev ? lev : game.u?.uz)))
        return;

    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    const getlin = (q) => hooked_tty_getlin(q, null);

    nbuf = '';
    if (mptr.custom) {
        const tmpbuf = `Replace annotation "${mptr.custom.slice(0, 30)}`
            + `${(mptr.custom.length > 30) ? '...' : ''}" with?`;
        nbuf = await getlin(tmpbuf);
    } else {
        let lbuf; /* level description */

        if (!lev || on_level(game.u?.uz, lev)) {
            lbuf = 'this dungeon level';
        } else {
            const dflgs = (lev.dnum === game.u?.uz?.dnum) ? 0 : 2;
            const save_uz = game.u.uz;
            const { describe_level } = await import('./botl.js');
            const out = { buf: '' };

            game.u.uz = lev;
            describe_level(out, dflgs);
            game.u.uz = save_uz;
            lbuf = out.buf;

            lbuf = lbuf.replace('Dlvl:', 'level ');
            /* describe_level() formats the level number with %-2d, so a single
               digit leaves a trailing space behind even without dflgs & 1 */
            lbuf = lbuf.replace(/^[ \t]+|[ \t]+$/g, '');
        }
        const qbuf = `What do you want to call ${lbuf}?`;
        nbuf = await getlin(qbuf);
    }

    /* empty input or ESC means don't add or change annotation;
       space-only means discard current annotation without adding new one */
    if (nbuf == null || nbuf === '' || nbuf.charCodeAt(0) === 27)
        return;
    /* strip leading and trailing spaces, compress out consecutive spaces */
    nbuf = mungspaces(nbuf);

    /* discard old annotation, if any */
    if (mptr.custom) {
        mptr.custom = null;
        mptr.custom_lth = 0;
    }
    /* add new annotation, unless it's all spaces */
    if (nbuf && nbuf !== ' ') {
        mptr.custom = nbuf;
        /* _lth field does not include trailing '\0' in the count */
        mptr.custom_lth = mptr.custom.length;
    }
}

/* ── dungeon.c:2582 exclusion zones ─────────────────────────────────────── */

// C ref: dungeon.c:2582 free_exclusions().
export function free_exclusions() {
    let ez = game.exclusion_zones;

    while (ez) {
        const nxtez = ez.next;

        void ez;
        ez = nxtez;
    }
    game.exclusion_zones = null;
}

// C ref: dungeon.c:2596 save_exclusions(nhfp).  save.js:1084's
// `out.exclusions = { unported: 'save_exclusions' }` is this stream's slot;
// note C's own comment calls it nhlua.c's, but the code is here.
export function save_exclusions(nhfp) {
    let ez;
    let nez;

    for (nez = 0, ez = game.exclusion_zones; ez; ez = ez.next, ++nez)
        ;

    const out = {};
    if (dg_update_file(nhfp)) {
        out.exclusion_count = nez;
        out.exclusions = [];
        for (ez = game.exclusion_zones; ez; ez = ez.next) {
            out.exclusions.push({
                zonetype: ez.zonetype, lx: ez.lx, ly: ez.ly,
                hx: ez.hx, hy: ez.hy,
            });
        }
    }
    return dg_update_file(nhfp) ? out : null;
}

// C ref: dungeon.c:2617 load_exclusions(nhfp).  Each entry is PREPENDED, so the
// restored chain is the reverse of the saved one — exactly as in C.
export function load_exclusions(nhfp) {
    let ez;
    let nez = nhfp?.exclusion_count | 0;
    let i = 0;

    while (nez-- > 0) {
        const src = nhfp.exclusions?.[i++] || {};
        ez = {
            zonetype: src.zonetype | 0,
            lx: src.lx | 0, ly: src.ly | 0,
            hx: src.hx | 0, hy: src.hy | 0,
            next: null,
        };
        ez.next = game.exclusion_zones ?? null;
        game.exclusion_zones = ez;
    }
}

/* ── dungeon.c:2640 the mapseen chain ──────────────────────────────────── */

// C's svm.mapseenchn is a singly-linked list kept sorted by (dnum, dlevel);
// this port holds it as an array in the same order, the way insert_branch() and
// add_level() above already do for svb.branches and svs.sp_levchn.  A `next`
// field is written where C writes one (restore_dungeon/load_mapseen) so a
// pointer-walking caller still reads correctly.
function mapseenchn() {
    return game.mapseenchn || (game.mapseenchn = []);
}

// C ref: dungeon.h:191/213/241 struct mapseen_feat / _flags / _rooms — the
// memset(0) shape init_mapseen() starts from.
function new_mapseen_feat() {
    return {
        nfount: 0, nsink: 0, naltar: 0, nthrone: 0,
        ngrave: 0, ntree: 0, water: 0, lava: 0,
        ice: 0, nshop: 0, ntemple: 0, msalign: 0,
        shoptype: 0,
    };
}
function new_mapseen_flags() {
    return {
        notreachable: 0, forgot: 0, knownbones: 0, oracle: 0,
        sokosolved: 0, bigroom: 0, castle: 0, castletune: 0,
        valley: 0, msanctum: 0, ludios: 0, roguelevel: 0,
        quest_summons: 0, questing: 0, vibrating_square: 0, spare1: 0,
    };
}
/* same size as svr.rooms[] */
const MSROOMS_SIZE = (MAXNROFROOMS + 1) * 2;
function new_msrooms() {
    const a = new Array(MSROOMS_SIZE);
    for (let i = 0; i < MSROOMS_SIZE; ++i) a[i] = { seen: 0, untended: 0 };
    return a;
}

// C ref: dungeon.c:2640 find_mapseen(lev) — may return null.
export function find_mapseen(lev) {
    for (const mptr of mapseenchn())
        if (on_level(mptr.lev, lev))
            return mptr;

    return null;
}

// C ref: dungeon.c:2652 find_mapseen_by_str(s).
export function find_mapseen_by_str(s) {
    for (const mptr of mapseenchn())
        if (mptr.custom
            && String(s).toLowerCase() === String(mptr.custom).toLowerCase())
            return mptr;

    return null;
}

// C ref: dungeon.c:2665 rm_mapseen(ledger_num) — drop one level's overview data
// (bones-file creation).
export function rm_mapseen(ledger_num) {
    const chn = mapseenchn();
    let mptr = null;
    let at = -1;

    for (let i = 0; i < chn.length; i++) {
        if (game.dungeons[chn[i].lev.dnum].ledger_start + chn[i].lev.dlevel
            === ledger_num) {
            mptr = chn[i];
            at = i;
            break;
        }
    }
    if (!mptr)
        return;

    if (mptr.custom)
        mptr.custom = null;

    let bpnext = mptr.final_resting_place;
    let bp;
    while ((bp = bpnext) != null) {
        bpnext = bp.next;
        void bp;
    }
    mptr.final_resting_place = null;

    chn.splice(at, 1);
}

// C ref: dungeon.c:2695 save_mapseen(nhfp, mptr).  `brindx` is the branch's
// POSITION in svb.branches, which is how the pointer survives save/restore.
export async function save_mapseen(nhfp, mptr) {
    let brindx = 0;
    const out = {};

    const brs = game.branches || [];
    for (brindx = 0; brindx < brs.length; ++brindx)
        if (brs[brindx] === mptr.br)
            break;
    out.branch_index = brindx;
    out.lev = { dnum: mptr.lev.dnum, dlevel: mptr.lev.dlevel };
    out.feat = { ...mptr.feat };
    out.flags = { ...mptr.flags };
    out.custom_lth = mptr.custom_lth | 0;

    if (mptr.custom_lth) {
        out.custom = String(mptr.custom).slice(0, mptr.custom_lth);
    }
    out.msrooms = [];
    for (let i = 0; i < MSROOMS_SIZE; ++i) {
        out.msrooms.push({ ...(mptr.msrooms[i] || { seen: 0, untended: 0 }) });
    }
    const { savecemetery } = await import('./save.js');
    out.cemetery = savecemetery(mptr, 'final_resting_place', nhfp);
    return out;
}

// C ref: dungeon.c:2721 load_mapseen(nhfp).
export function load_mapseen(nhfp) {
    let i, branchnum = 0, brindx;
    const load = {
        next: null, br: null, lev: { dnum: 0, dlevel: 0 },
        feat: new_mapseen_feat(), flags: new_mapseen_flags(),
        custom: null, custom_lth: 0, msrooms: new_msrooms(),
        final_resting_place: null,
    };

    branchnum = nhfp?.branch_index | 0;
    const brs = game.branches || [];
    let curr = null;
    for (brindx = 0; brindx < brs.length; ++brindx)
        if (brindx === branchnum) {
            curr = brs[brindx];
            break;
        }
    load.br = curr;

    load.lev = { dnum: nhfp?.lev?.dnum | 0, dlevel: nhfp?.lev?.dlevel | 0 };
    load.feat = { ...new_mapseen_feat(), ...(nhfp?.feat || {}) };
    load.flags = { ...new_mapseen_flags(), ...(nhfp?.flags || {}) };
    load.custom_lth = nhfp?.custom_lth | 0;

    if (load.custom_lth) {
        /* length doesn't include terminator (which isn't saved & restored) */
        load.custom = String(nhfp.custom ?? '').slice(0, load.custom_lth);
    } else {
        load.custom = null;
    }
    for (i = 0; i < MSROOMS_SIZE; ++i) {
        load.msrooms[i] = { seen: nhfp?.msrooms?.[i]?.seen | 0,
                            untended: nhfp?.msrooms?.[i]?.untended | 0 };
    }
    /* UNPORTED: restcemetery(nhfp, &load->final_resting_place) (restore.c) */
    return load;
}

/* ── dungeon.c:2761 overview_stats ─────────────────────────────────────── */

// sizeof() values from the recorder build (clang, LP64); #stats prints byte
// totals, so they are data.  wizcmds.js:189 already carries SIZEOF_MAPSEEN.
const SIZEOF_MAPSEEN = 384, SIZEOF_CEMETERY = 184;

// C ref: dungeon.c:2761 overview_stats(win, statsfmt, &count, &size) — the
// '#stats' block for the #overview data.  `win` is wizcmds.js's line array
// (its nyi_overview_stats() at :1615 is the placeholder this replaces);
// `statsfmt` is applied by `fmt`, which stands for C's Sprintf(buf, statsfmt,
// hdrbuf, count, size).  `totals` is the { count, size } pair C passes by
// address.
export function overview_stats(win, statsfmt, totals) {
    let buf, hdrbuf;
    let ocount, osize, bcount, bsize, acount, asize;
    const fmt = (typeof statsfmt === 'function')
        ? statsfmt
        : (h, c, s) => String(statsfmt).replace('%s', h)
              .replace('%ld', String(c)).replace('%ld', String(s));
    const putstr = (w, _attr, s) => { if (Array.isArray(w)) w.push(s); };

    ocount = bcount = acount = osize = bsize = asize = 0;
    for (const mptr of mapseenchn()) {
        ++ocount;
        osize += SIZEOF_MAPSEEN;
        for (let ce = mptr.final_resting_place; ce; ce = ce.next) {
            ++bcount;
            bsize += SIZEOF_CEMETERY;
        }
        if (mptr.custom_lth) {
            ++acount;
            asize += (mptr.custom_lth + 1);
        }
    }

    hdrbuf = `general, size ${SIZEOF_MAPSEEN}`;
    buf = fmt(hdrbuf, ocount, osize);
    putstr(win, 0, buf);
    if (bcount) {
        hdrbuf = `cemetery, size ${SIZEOF_CEMETERY}`;
        buf = fmt(hdrbuf, bcount, bsize);
        putstr(win, 0, buf);
    }
    if (acount) {
        hdrbuf = 'annotations, text';
        buf = fmt(hdrbuf, acount, asize);
        putstr(win, 0, buf);
    }
    totals.count += ocount + bcount + acount;
    totals.size += osize + bsize + asize;
}

/* ── dungeon.c:2811 remdun_mapseen, :2835 init_mapseen ─────────────────── */

// C ref: dungeon.c:2811 remdun_mapseen(dnum) — quest expulsion.  Nothing is
// deleted any more, the levels are only marked notreachable so that #overview
// skips them while end-of-game disclosure still lists them.
export function remdun_mapseen(dnum) {
    for (const mptr of mapseenchn()) {
        if (mptr.lev.dnum === dnum) {
            mptr.flags.notreachable = 1;
        }
    }
}

// C ref: dungeon.c:2835 init_mapseen(lev) — insertion sort by (dnum, dlevel).
// The lastseentyp wipe is load-bearing: that array is reused for every level.
export function init_mapseen(lev) {
    /* Create a level and insert in "sorted" order.  This is an insertion
     * sort first by dungeon (in order of discovery) and then by level number.
     */
    const init = {
        next: null, br: null, lev: { dnum: 0, dlevel: 0 },
        feat: new_mapseen_feat(), flags: new_mapseen_flags(),
        custom: null, custom_lth: 0, msrooms: new_msrooms(),
        final_resting_place: null,
    };
    /* svl.lastseentyp[][] is reused for each level, so get rid of
       previous level's data */
    game.lastseentyp = [];
    for (let x = 0; x < COLNO; ++x) {
        game.lastseentyp[x] = new Array(ROWNO).fill(0);
    }

    init.lev.dnum = lev.dnum;
    init.lev.dlevel = lev.dlevel;

    /* walk until we get to the place where we should insert init */
    const chn = mapseenchn();
    let pos = 0;
    for (; pos < chn.length; pos++) {
        const mptr = chn[pos];
        if (mptr.lev.dnum > init.lev.dnum
            || (mptr.lev.dnum === init.lev.dnum
                && mptr.lev.dlevel > init.lev.dlevel))
            break;
    }
    chn.splice(pos, 0, init);
    init.next = chn[pos + 1] ?? null;
    if (pos > 0) chn[pos - 1].next = init;
}

// C ref: dungeon.c:2873 OF_INTEREST(feat).
function OF_INTEREST(feat) {
    return !!(feat.nfount || feat.nsink || feat.nthrone || feat.naltar
              || feat.ngrave || feat.ntree || feat.nshop || feat.ntemple);
    /* || feat.water || feat.ice || feat.lava */
}

// C ref: dungeon.c:2880 interest_mapseen(mptr) — is this level worth listing?
export function interest_mapseen(mptr) {
    if (on_level(game.u?.uz, mptr.lev))
        return true;
    if (mptr.flags.notreachable || mptr.flags.forgot)
        return false;
    /* when in tutorial, show all tutorial levels visited whether interesting
       or not and don't show any other levels; when outside tutorial, don't
       show any tutorial levels even if they're considered interesting */
    if (In_tutorial(game.u?.uz)) {
        return In_tutorial(mptr.lev);
    } else {
        if (In_tutorial(mptr.lev))
            return false;
    }
    /* level is of interest if it has an auto-generated annotation */
    if (mptr.flags.oracle || mptr.flags.bigroom || mptr.flags.roguelevel
        || mptr.flags.castle || mptr.flags.valley
        || mptr.flags.msanctum || mptr.flags.vibrating_square
        || mptr.flags.quest_summons || mptr.flags.questing)
        return true;
    /* when in Sokoban, list all sokoban levels visited; when not in it,
       list any visited Sokoban level which remains unsolved */
    if (In_sokoban(mptr.lev)
        && (In_sokoban(game.u?.uz) || !mptr.flags.sokosolved))
        return true;
    /* when in the endgame, list all endgame levels visited */
    if (In_endgame(game.u?.uz))
        return In_endgame(mptr.lev);
    /* level is of interest if it has non-zero feature count or known bones
       or user annotation or known connection to another dungeon branch
       or is the furthest level reached in its branch */
    return !!(OF_INTEREST(mptr.feat)
              || (mptr.final_resting_place
                  && (mptr.flags.knownbones || wizard()))
              || mptr.custom || mptr.br
              || (mptr.lev.dlevel
                  === game.dungeons[mptr.lev.dnum].dunlev_ureached));
}

/* ── dungeon.c:2927 update_lastseentyp .. :2951 count_feat_lastseentyp ─── */

function lastseentyp_at(x, y) {
    return game.lastseentyp?.[x]?.[y] | 0;
}

// C ref: dungeon.c:2927 update_lastseentyp(x, y).
export function update_lastseentyp(x, y) {
    let mtmp;
    let ltyp = game.level?.at(x, y)?.typ;

    if (ltyp === DRAWBRIDGE_UP)
        ltyp = db_under_typ(game.level.at(x, y).drawbridgemask | 0);
    if ((mtmp = m_at(x, y)) != null
        && mtmp.m_ap_type === M_AP_FURNITURE && canseemon(mtmp))
        ltyp = cmap_to_type(mtmp.mappearance);
    if (!game.lastseentyp) game.lastseentyp = [];
    if (!game.lastseentyp[x]) game.lastseentyp[x] = new Array(ROWNO).fill(0);
    game.lastseentyp[x][y] = ltyp | 0;
}

// C ref: dungeon.c:2943 update_mapseen_for(x, y) — "deferred update needs to be
// done immediately; hide details from caller".  lock.c's not-a-door arm.
export async function update_mapseen_for(x, y) {
    await recalc_mapseen(); /* whole level */
    return lastseentyp_at(x, y);
}

// C ref: dungeon.c:2951 count_feat_lastseentyp(mptr, x, y) — one map square's
// contribution to the feature counts, each capped at 3.  The ICE/POOL/LAVA arms
// are `#if 0` in C ("levels that have these tend to have a lot of them").
export function count_feat_lastseentyp(mptr, x, y) {
    let count;
    let atmp;

    switch (lastseentyp_at(x, y)) {
    case TREE:
        count = mptr.feat.ntree + 1;
        if (count <= 3)
            mptr.feat.ntree = count;
        break;
    case FOUNTAIN:
        count = mptr.feat.nfount + 1;
        if (count <= 3)
            mptr.feat.nfount = count;
        break;
    case THRONE:
        count = mptr.feat.nthrone + 1;
        if (count <= 3)
            mptr.feat.nthrone = count;
        break;
    case SINK:
        count = mptr.feat.nsink + 1;
        if (count <= 3)
            mptr.feat.nsink = count;
        break;
    case GRAVE:
        count = mptr.feat.ngrave + 1;
        if (count <= 3)
            mptr.feat.ngrave = count;
        break;
    case ALTAR:
        /* get the altarmask for this location; might be a mimic */
        atmp = altarmask_at(x, y);
        /* convert to index: 0..3 */
        atmp = (Is_astralevel(game.u?.uz)
                && ((game.level?.at(x, y)?.seenv | 0) & SVALL) !== SVALL)
               ? MSA_NONE
               : Amask2msa(atmp);
        if (!mptr.feat.naltar)
            mptr.feat.msalign = atmp;
        else if (mptr.feat.msalign !== atmp)
            mptr.feat.msalign = MSA_NONE;
        count = mptr.feat.naltar + 1;
        if (count <= 3)
            mptr.feat.naltar = count;
        break;
        /*  An automatic annotation is added to the Castle and to Fort Ludios
         *  once their structure's main entrance has been seen. */
    case DOOR:
        if (Is_knox_level(game.u?.uz)) {
            let ty;
            const tx = x - 4;

            /* Throne is four columns to left, either directly in line or one
             * row higher or lower, and doesn't have to have been seen yet. */
            for (ty = y - 1; ty <= y + 1; ++ty)
                if (isok(tx, ty) && IS_THRONE(game.level?.at(tx, ty)?.typ)) {
                    mptr.flags.ludios = 1;
                    break;
                }
            break;
        }
        if (is_drawbridge_wall(x, y) < 0)
            break;
        /*FALLTHRU*/
    case DBWALL:
    case DRAWBRIDGE_DOWN:
        if (Is_stronghold(game.u?.uz))
            mptr.flags.castle = 1, mptr.flags.castletune = 1;
        break;
    default:
        break;
    }
}

/* ── dungeon.c:3075 recalc_mapseen ─────────────────────────────────────── */

// C ref: dungeon.c:3075 recalc_mapseen() — rebuild the current level's mapseen
// from the map.  Async only because shop_keeper()/inhishop()/findpriest() live
// in modules that import this one.
export async function recalc_mapseen() {
    let mptr, oth_mptr;
    let mtmp;
    let bp, t;
    let i, ridx;
    let count;
    let x, y;
    let uroom;

    /* Should not happen in general, but possible if in the process of being
     * booted from the quest. */
    if (!(mptr = find_mapseen(game.u?.uz)))
        return;

    /* reset all features; mptr->feat.* = 0; */
    mptr.feat = new_mapseen_feat();
    /* reset most flags; some level-specific ones are left as-is */
    if (mptr.flags.notreachable) {
        mptr.flags.notreachable = 0; /* reached it; Eye of the Aethiopica? */
        if (In_quest(game.u?.uz)) {
            /* getting back to the quest via arti-invoke should revive
               annotation data for ALL quest levels, not just this one */
            for (const mptrtmp of mapseenchn()) {
                if (mptrtmp.lev.dnum === mptr.lev.dnum)
                    mptrtmp.flags.notreachable = 0;
            }
        }
    }
    mptr.flags.knownbones = 0;
    mptr.flags.sokosolved = (In_sokoban(game.u?.uz) && !Sokoban()) ? 1 : 0;
    /* mptr->flags.bigroom retains previous value when hero can't see */
    if (!Blind())
        mptr.flags.bigroom = Is_bigroom(game.u?.uz) ? 1 : 0;
    else if (mptr.flags.forgot)
        mptr.flags.bigroom = 0;
    mptr.flags.roguelevel = Is_rogue_level(game.u?.uz) ? 1 : 0;
    mptr.flags.oracle = 0; /* recalculated during room traversal below */
    mptr.flags.castletune = 0;
    /* flags.castle retains previous value */
    mptr.flags.forgot = 0;
    /* flags.quest_summons disabled once quest finished */
    mptr.flags.quest_summons = (at_dgn_entrance('The Quest')
                                && game.u?.uevent?.qcalled
                                && !(game.u?.uevent?.qcompleted
                                     || game.u?.uevent?.qexpelled
                                     || game.quest_status?.leader_is_dead))
                               ? 1 : 0;
    mptr.flags.questing = (on_level(game.u?.uz, game.qstart_level)
                           && game.quest_status?.got_quest) ? 1 : 0;
    /* flags.msanctum, .valley, and .vibrating_square handled below */

    const { shop_keeper } = await import('./shkroom.js');
    const { inhishop } = await import('./shk.js');
    const { findpriest } = await import('./priest.js');
    const rooms = game.level?.rooms || [];

    /* track rooms the hero is in */
    const urooms = game.u?.urooms || [];
    for (i = 0; i < urooms.length; ++i) {
        uroom = urooms[i];
        ridx = (typeof uroom === 'string' ? uroom.charCodeAt(0) : uroom)
               - ROOMOFFSET;
        mptr.msrooms[ridx].seen = 1;
        mptr.msrooms[ridx].untended =
            ((rooms[ridx]?.rtype | 0) >= SHOPBASE)
                ? ((!(mtmp = shop_keeper(uroom)) || !inhishop(mtmp)) ? 1 : 0)
                : ((rooms[ridx]?.rtype | 0) === TEMPLE)
                      ? ((!(mtmp = findpriest(uroom))
                          || !(await inhistemple(mtmp))) ? 1 : 0)
                      : 0;
    }

    /* recalculate room knowledge: for now, just shops and temples */
    for (i = 0; i < MSROOMS_SIZE; ++i) {
        if (mptr.msrooms[i].seen) {
            if ((rooms[i]?.rtype | 0) >= SHOPBASE) {
                if (mptr.msrooms[i].untended)
                    mptr.feat.shoptype = SHOPBASE - 1;
                else if (!mptr.feat.nshop)
                    mptr.feat.shoptype = rooms[i].rtype;
                else if (mptr.feat.shoptype !== rooms[i].rtype)
                    mptr.feat.shoptype = 0;
                count = mptr.feat.nshop + 1;
                if (count <= 3)
                    mptr.feat.nshop = count;
            } else if ((rooms[i]?.rtype | 0) === TEMPLE) {
                /* altar and temple alignment handled below */
                count = mptr.feat.ntemple + 1;
                if (count <= 3)
                    mptr.feat.ntemple = count;
            } else if ((rooms[i]?.orig_rtype | 0) === DELPHI) {
                mptr.flags.oracle = 1;
            }
        }
    }

    /* Update lastseentyp with typ iff it is in sight or the hero can feel it
       on their current location (i.e. not levitating). */
    if (!Levitation())
        update_lastseentyp(game.u.ux, game.u.uy);

    for (x = 1; x < COLNO; x++) {
        for (y = 0; y < ROWNO; y++) {
            count_feat_lastseentyp(mptr, x, y);
        }
    }

    /* Moloch's Sanctum and the Valley of the Dead normally get their automatic
       annotation from entering an attended temple, but the priest can be killed
       first; both levels have exactly one altar, so a mapped altar is enough */
    if (Is_valley(game.u?.uz)) {
        /* don't clear valley if naltar==0; maybe altar got destroyed? */
        if (mptr.feat.naltar > 0)
            mptr.flags.valley = 1;

    /* Sanctum and Gateway-to-Sanctum are mutually exclusive annotations
       stored with data for DIFFERENT levels */
    } else if (Is_sanctum(game.u?.uz)) {
        if (mptr.feat.naltar > 0)
            mptr.flags.msanctum = 1;

        if (mptr.flags.msanctum) {
            const invocat_lvl = { dnum: game.u.uz.dnum,
                                  dlevel: game.u.uz.dlevel - 1 };
            if ((oth_mptr = find_mapseen(invocat_lvl)) != null)
                oth_mptr.flags.vibrating_square = 0;
        }
    } else if (Invocation_lev(game.u?.uz)) {
        /* annotate the vibrating square's level if the trap has been found or
           if it is gone (invocation happened), provided the sanctum's own
           annotation has not been added yet */
        t = null;
        for (const tr of (game.level?.traps || []))
            if (tr.ttyp === VIBRATING_SQUARE) { t = tr; break; }
        mptr.flags.vibrating_square = t ? (t.tseen ? 1 : 0)
                      /* no trap implies that invocation has been performed */
                             : (((oth_mptr = find_mapseen(game.sanctum_level)) == null
                                 || !oth_mptr.flags.msanctum) ? 1 : 0);
    }

    if (game.level?.bonesinfo && !mptr.final_resting_place) {
        /* clone the bonesinfo so we aren't dependent upon this
           level being in memory */
        let bonesaddr = { obj: mptr, key: 'final_resting_place' };
        bp = game.level.bonesinfo;
        do {
            const clone = { ...bp };
            bonesaddr.obj[bonesaddr.key] = clone;
            bp = bp.next;
            bonesaddr = { obj: clone, key: 'next' };
        } while (bp);
        bonesaddr.obj[bonesaddr.key] = null;
    }
    /* decide which past hero deaths have become known; there's no guarantee of
       either a grave or a ghost, so go by whether the current hero has seen the
       map location where each old one died */
    for (bp = mptr.final_resting_place; bp; bp = bp.next)
        if (lastseentyp_at(bp.frpx, bp.frpy)) {
            bp.bonesknown = true;
            mptr.flags.knownbones = 1;
        }
}

/* ── dungeon.c:3267 mapseen_temple ─────────────────────────────────────── */

// C ref: dungeon.c:3267 mapseen_temple(priest) — valley and sanctum get their
// automatic annotation once their temple is entered.
export function mapseen_temple(_priest /* UNUSED */) {
    const mptr = find_mapseen(game.u?.uz);

    if (!mptr)
        return;
    if (Is_valley(game.u?.uz))
        mptr.flags.valley = 1;
    else if (Is_sanctum(game.u?.uz))
        mptr.flags.msanctum = 1;
}

/* ── dungeon.c:3304 show_overview / :3344 traverse_mapseenchn ──────────── */

// C ref: dungeon.c:3304 show_overview(why, reason) — #overview and end-of-game
// disclosure.  The endgame levels come out FIRST so the Planes (dnum 5-ish)
// print above the main dungeon (dnum 0).
export async function show_overview(why, reason) {
    const lastdun_p = { v: -1 };
    let n;

    /* lazy initialization */
    await recalc_mapseen();

    const wt = await import('./wintty.js');
    const win = wt.tty_create_nhwindow(NHW_MENU);
    wt.tty_start_menu(win, MENU_BEHAVE_STANDARD);
    if (In_endgame(game.u?.uz))
        await traverse_mapseenchn(1, { wt, win }, why, reason, lastdun_p);
    /* if game is over or we're not in the endgame yet, show the dungeon */
    if (why > 0 || !In_endgame(game.u?.uz))
        await traverse_mapseenchn(0, { wt, win }, why, reason, lastdun_p);
    wt.tty_end_menu(win, null);
    const selected = [];
    n = await wt.tty_select_menu(win, (why !== -1) ? PICK_NONE : PICK_ONE,
                                selected);
    if (n > 0) {
        const ledger = (selected[0]?.item?.a_int ?? selected[0]?.a_int) - 1;
        const lev = { dnum: ledger_to_dnum(ledger),
                      dlevel: ledger_to_dlev(ledger) };
        await query_annotation(lev);
    }
    wt.tty_destroy_nhwindow(win);
}

// C ref: dungeon.c:3344 traverse_mapseenchn() — display endgame levels or
// non-endgame levels, not both.
export async function traverse_mapseenchn(viewendgame, win, why, reason, lastdun_p) {
    let showheader;

    for (const mptr of mapseenchn()) {
        if (viewendgame ^ (In_endgame(mptr.lev) ? 1 : 0))
            continue;

        /* only print out info for a level or a dungeon if it's of interest */
        if (why !== 0 || interest_mapseen(mptr)) {
            showheader = (mptr.lev.dnum !== lastdun_p.v);
            await print_mapseen(win, mptr, why, reason, showheader);
            lastdun_p.v = mptr.lev.dnum;
        }
    }
}

/* ── dungeon.c:3368 seen_string, :3460 tunesuffix ──────────────────────── */

// C ref: dungeon.c:3368 seen_string(x, obj) — "players are computer scientists:
// 0, 1, 2, n".  The body already sits above as overview_seen_string(); this is
// the C name for it, not a second copy.
export function seen_string(x, obj) {
    return overview_seen_string(x, obj);
}

// C ref: dungeon.c:3460 tunesuffix(mptr, outbuf, bsz) — append the passtune
// hint to the Castle annotation, but only if the player has heard it and the
// drawbridge still exists (flags.castletune).
export function tunesuffix(mptr) {
    let outbuf = '';
    if (mptr.flags.castletune && game.u?.uevent?.uheard_tune) {
        let tmp;

        if (game.u.uevent.uheard_tune === 2)
            tmp = `notes "${(game.tune || []).join('').replace(/\0/g, '')}"`;
        else
            tmp = '5-note tune';
        outbuf = ` (play ${tmp} to open or close drawbridge)`;
    }
    return outbuf;
}

/* ── dungeon.c:3516 print_mapseen ─────────────────────────────────────── */

/* some utility macros for print_mapseen (C ref: dungeon.c:3479) */
const TAB = '   ';    /* three spaces */
const PREFIX = '      '; /* two TABs + empty BULLET: six spaces */

// C ref: dungeon.c:3516 print_mapseen(win, mptr, final, how, printdun).
// `win` is show_overview()'s { wt, win } pair; an ARRAY is accepted too so a
// caller that only wants the lines (build_overview_lines()'s job today) can
// pass one.
export async function print_mapseen(win, mptr, final, how, printdun) {
    let buf, tmpbuf;
    let i, depthstart, dnum;
    const died_here = (final === 2 && on_level(game.u?.uz, mptr.lev));
    let any;

    const heading = (s) => {
        if (Array.isArray(win)) win.push({ text: s, attr: final ? ATR_NONE : ATR_INVERSE });
        else add_menu_heading(win.wt, win.win, s);
    };
    const menu_str = (s) => {
        if (Array.isArray(win)) win.push({ text: s, attr: ATR_NONE });
        else add_menu_str(win.wt, win.win, s);
    };
    const menu_item = (a, s) => {
        if (Array.isArray(win)) win.push({ text: s, attr: ATR_NONE, a_int: a.a_int });
        else win.wt.tty_add_menu(win.win, null, a, '\0', '\0', ATR_NONE,
                                 NO_COLOR, s, MENU_ITEMFLAGS_NONE);
    };

    /* Damnable special cases */
    /* The quest and knox should appear to be level 1 to match other text. */
    dnum = mptr.lev.dnum;
    if (dnum === game.quest_dnum || dnum === game.knox_level?.dnum)
        depthstart = 1;
    else
        depthstart = game.dungeons[dnum].depth_start;

    if (printdun) {
        if (game.dungeons[dnum].dunlev_ureached === game.dungeons[dnum].entry_lev
            /* suppress the negative numbers in the endgame */
            || In_endgame(mptr.lev))
            buf = `${game.dungeons[dnum].dname}:`;
        else if (builds_up(mptr.lev))
            buf = `${game.dungeons[dnum].dname}: levels `
                + `${depthstart + game.dungeons[dnum].entry_lev - 1} up to `
                + `${depthstart + game.dungeons[dnum].dunlev_ureached - 1}`;
        else
            buf = `${game.dungeons[dnum].dname}: levels ${depthstart} to `
                + `${depthstart + game.dungeons[dnum].dunlev_ureached - 1}`;

        heading(buf);
    }

    /* calculate level number */
    i = depthstart + mptr.lev.dlevel - 1;
    if (In_endgame(mptr.lev))
        buf = `${(final !== -1) ? TAB : ''}${endgamelevelname(i)}:`;
    else
        buf = `${(final !== -1) ? TAB : ''}Level ${i}:`;

    /* wizmode prints out proto dungeon names for clarity */
    if (wizard()) {
        const slev = Is_special(mptr.lev);

        if (slev != null)
            buf += ` [${slev.proto}]`;
    }
    /* [perhaps print custom annotation on its own line when it's long] */
    if (mptr.custom)
        buf += ` "${mptr.custom}"`;
    if (on_level(game.u?.uz, mptr.lev))
        buf += ` <- You ${(final <= 0 || (final === 1 && how === ASCENDED)) ? 'are'
                  : (final === 1 && how === ESCAPED) ? 'left from'
                    : 'were'} here.`;

    any = {};
    if (final === -1)
        /* `anything` is a UNION: writing a_int also makes a_void non-null,
           which is what tty_add_menu() tests for selectability */
        any.a_int = ledger_no(mptr.lev) + 1, any.a_void = true;
    menu_item(any, buf);

    if (mptr.flags.forgot)
        return;

    if (OF_INTEREST(mptr.feat)) {
        buf = '';

        i = 0; /* interest counter */
        const COMMA = () => (i++ > 0 ? ', ' : PREFIX);
        /* C ref: dungeon.c:3494 ADDNTOBUF / :3502 ADD2NTOBUF */
        const ADDNTOBUF = (nam, v) => {
            if (v) buf += `${COMMA()}${seen_string(v, nam)} ${nam}${plur(v)}`;
        };
        const ADD2NTOBUF = (nam, v, nam2, v2) => {
            if (v && v2) {
                buf += `${COMMA()}${seen_string(v, nam)} ${nam}${plur(v)}`
                    + ` and ${seen_string(v2, nam2)} ${nam2}${plur(v2)}`;
            } else if (v) {
                ADDNTOBUF(nam, v);
            } else if (v2) {
                ADDNTOBUF(nam2, v2);
            }
        };

        /* List interests in an order vaguely corresponding to how important
         * they are. */
        if (mptr.feat.nshop > 0) {
            if (mptr.feat.nshop > 1)
                ADDNTOBUF('shop', mptr.feat.nshop);
            else
                buf += `${COMMA()}${an_dg(shop_string(mptr.feat.shoptype))}`;
        }
        if (mptr.feat.naltar > 0 || mptr.feat.ntemple > 0) {
            let atmp;

            /* being aware of a temple doesn't guarantee being aware of its
               altar (blind on entry, or out of view in an irregular room) */
            ADD2NTOBUF('temple', mptr.feat.ntemple,
                       'altar', mptr.feat.naltar);

            /* only print out altar's god if they are all to your god */
            atmp = mptr.feat.msalign;               /*    0,  1,  2,  3 */
            atmp = Msa2amask(atmp);                /*    0,  1,  2,  4 */
            if (Amask2align(atmp) === game.u?.ualign?.type) /* -128,-1,0,+1 */
                buf += ` to ${align_gname(
                    roles.findIndex((r) => r.mnum === game.urole?.mnum),
                    game.u.ualign.type)}`;
        }
        ADDNTOBUF('throne', mptr.feat.nthrone);
        ADDNTOBUF('fountain', mptr.feat.nfount);
        ADDNTOBUF('sink', mptr.feat.nsink);
        ADDNTOBUF('grave', mptr.feat.ngrave);
        ADDNTOBUF('tree', mptr.feat.ntree);
        /* capitalize afterwards */
        i = PREFIX.length;
        buf = buf.slice(0, i) + highc(buf[i]) + buf.slice(i + 1);
        /* capitalizing it makes it a sentence; terminate with '.' */
        buf += '.';
        menu_str(buf);
    }

    /* we assume that these are mutually exclusive */
    buf = '';
    if (mptr.flags.oracle) {
        buf = `${PREFIX}Oracle of Delphi.`;
    } else if (In_sokoban(mptr.lev)) {
        buf = `${PREFIX}${mptr.flags.sokosolved ? 'Solved' : 'Unsolved'}.`;
    } else if (mptr.flags.bigroom) {
        buf = `${PREFIX}A very big room.`;
    } else if (mptr.flags.roguelevel) {
        buf = `${PREFIX}A primitive area.`;
    } else if (on_level(mptr.lev, game.qstart_level)) {
        buf = `${PREFIX}Home${mptr.flags.notreachable ? ' (no way back...)' : ''}.`;
        if (game.u?.uevent?.qcompleted)
            buf = `${PREFIX}Completed quest for ${ldrname()}.`;
        else if (mptr.flags.questing)
            buf = `${PREFIX}Given quest by ${ldrname()}.`;
    } else if (mptr.flags.ludios) {
        /* presence of the ludios branch in #overview output means the player
           made it onto the level; this annotation means the fort's entrance
           has been seen (or mapped) */
        buf = `${PREFIX}Fort Ludios.`;
    } else if (mptr.flags.castle) {
        buf = `${PREFIX}The castle${tunesuffix(mptr)}.`;
    } else if (mptr.flags.valley) {
        buf = `${PREFIX}Valley of the Dead.`;
    } else if (mptr.flags.vibrating_square) {
        buf = `${PREFIX}Gateway to Moloch's Sanctum.`;
    } else if (mptr.flags.msanctum) {
        buf = `${PREFIX}Moloch's Sanctum.`;
    }
    if (buf) {
        menu_str(buf);
    }
    /* quest entrance is not mutually-exclusive with bigroom or rogue level */
    if (mptr.flags.quest_summons) {
        buf = `${PREFIX}Summoned by ${ldrname()}.`;
        menu_str(buf);
    }

    /* print out branches */
    if (mptr.br) {
        buf = `${PREFIX}${br_string2(mptr.br)} to `
            + `${game.dungeons[mptr.br.end2.dnum].dname}`;

        /* mapseen objects are printed in increasing order of dlevel, so
         * clarify which level an UPWARD branch goes to.  Unless it's the
         * end game. */
        if (mptr.br.end1_up && !In_endgame(mptr.br.end2))
            buf += `, level ${depth(mptr.br.end2)}`;
        buf += '.';
        menu_str(buf);
    }

    /* maybe print out bones details */
    if (mptr.final_resting_place || final > 0) {
        let bp;
        let kncnt = !died_here ? 0 : 1;

        for (bp = mptr.final_resting_place; bp; bp = bp.next)
            if (bp.bonesknown || wizard() || final > 0)
                ++kncnt;
        if (kncnt) {
            buf = `${PREFIX}Final resting place for`;
            menu_str(buf);
            if (died_here) {
                /* disclosure happens before bones creation, so listing the
                   dead hero here doesn't give away whether bones are made */
                const { formatkiller } = await import('./topten.js');
                tmpbuf = formatkiller(BUFSZ, how, true);
                /* rephrase a few death reasons to work with "you" */
                tmpbuf = tmpbuf.replace(' himself', ' yourself');
                tmpbuf = tmpbuf.replace(' herself', ' yourself');
                tmpbuf = tmpbuf.replace(' his ', ' your ');
                tmpbuf = tmpbuf.replace(' her ', ' your ');
                buf = `${PREFIX}${TAB}you, ${tmpbuf}${--kncnt ? ',' : '.'}`;
                menu_str(buf);
            }
            for (bp = mptr.final_resting_place; bp; bp = bp.next) {
                if (bp.bonesknown || wizard() || final > 0) {
                    buf = `${PREFIX}${TAB}${bp.who}, ${bp.how}`
                        + `${--kncnt ? ',' : '.'}`;
                    menu_str(buf);
                }
            }
        }
    }
}
