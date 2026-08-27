// levels/orcus.js — makemaz_orcus(), Orcus-town (dat/orcus.lua).
// C ref: mklev.c makelevel() -> makemaz("orcus") -> load_special().
//
// A ghost town on a mazegrid: one 45x17 map whose contents function carries the
// whole level (a mazewalk west, 24 "ruin" boulders, 16 doors, a sanctum altar,
// a morgue and two shops, the demon lord's court and a wish-grade prize), then
// nhlib.lua's hell_tweaks() over everything the map did not claim.
//
// The des.map() is loaded WITHOUT lspo_map's `contents` callback and the body
// run inline: the callback is synchronous but the body awaits maketrap().  C's
// lspo_map only adds a reset_xystart_size() afterwards, done explicitly below.

import {
    AM_NONE, ANTI_MAGIC, COLNO, FILL_NORMAL, FIRE_TRAP, HWALL, MAGIC_TRAP,
    MORGUE, ROWNO, SHOPBASE, SLP_GAS_TRAP, SPIKED_PIT,
} from '../const.js';
import { game } from '../gstate.js';
import { BOULDER, MAGIC_LAMP, MAGIC_MARKER } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    l_selection_negate, l_selection_or, selection_getbounds,
} from '../selvar.js';
import {
    bigrm_wallification, flip_level, lspo_map, quest_place_stair, quest_set_door,
    remove_boundary_syms, reset_xystart_size, selection_match, shuffle,
    splev_create_monster, splev_link_doors_rooms, splev_map_reset,
    splev_region_lit, vly_altar, vly_object, vly_region, vly_trap,
} from '../sp_lev.js';
import {
    LR_BRANCH, LR_TELE, LR_UPSTAIR, W_WEST, geh_flip_lregions, geh_hell_tweaks,
    geh_lvlfill_maze_grid, geh_mazewalk, geh_monster_at, geh_mrandom,
    geh_object_at, geh_place_lregions, geh_sel_area, geh_sel_from_points,
} from './gehennom.js';

const ORCUS_MAP = [
    '.|....|....|....|..............|....|........',
    '.|....|....|....|..............|....|........',
    '.|....|....|....|--...-+-------|.............',
    '.|....|....|....|..............+.............',
    '.|.........|....|..............|....|........',
    '.--+-...-+----+--....-------...--------.-+---',
    '.....................|.....|.................',
    '.....................|.....|.................',
    '.--+----....-+---....|.....|...----------+---',
    '.|....|....|....|....---+---...|......|......',
    '.|.........|....|..............|......|......',
    '.----...---------.....-----....+......|......',
    '.|........................|....|......|......',
    '.----------+-...--+--|....|....----------+---',
    '.|....|..............|....+....|.............',
    '.|....+.......|......|....|....|.............',
    '.|....|.......|......|....|....|.............',
].join('\n');

// "Wall ruins" — des.object("boulder", x, y), in file order.
const ORCUS_BOULDERS = [
    [19, 2], [20, 2], [21, 2], [36, 2], [36, 3], [6, 4], [5, 5], [6, 5],
    [7, 5], [39, 5], [8, 8], [9, 8], [10, 8], [11, 8], [6, 10], [5, 11],
    [6, 11], [7, 11], [21, 11], [21, 12], [13, 13], [14, 13], [15, 13],
    [14, 14],
];

// des.door(state, x, y), in file order.
const ORCUS_DOORS = [
    ['closed', 23, 2], ['open', 31, 3], ['nodoor', 3, 5], ['closed', 9, 5],
    ['closed', 14, 5], ['closed', 41, 5], ['open', 3, 8], ['nodoor', 13, 8],
    ['open', 41, 8], ['closed', 24, 9], ['closed', 31, 11], ['open', 11, 13],
    ['closed', 18, 13], ['closed', 41, 13], ['open', 26, 14], ['closed', 6, 15],
];

const ORCUS_TRAPS = [
    SPIKED_PIT, SLP_GAS_TRAP, ANTI_MAGIC, FIRE_TRAP, FIRE_TRAP, FIRE_TRAP,
    MAGIC_TRAP, MAGIC_TRAP,
];

// "The resident nasty" and its preferred companions, at fixed coordinates.
const ORCUS_COURT = [
    ['Orcus', 33, 15], ['human zombie', 32, 15], ['shade', 32, 14],
    ['shade', 32, 16], ['vampire', 35, 16], ['vampire', 35, 14],
    ['vampire lord', 36, 14], ['vampire lord', 36, 15],
];

// "Randomly placed companions" — named species, random DRY locations.
const ORCUS_COMPANIONS = [
    'skeleton', 'skeleton', 'skeleton', 'skeleton', 'skeleton',
    'shade', 'shade', 'shade', 'shade',
    'giant zombie', 'giant zombie', 'giant zombie',
    'ettin zombie', 'ettin zombie', 'ettin zombie',
    'human zombie', 'human zombie', 'human zombie',
    'vampire', 'vampire', 'vampire', 'vampire lord', 'vampire lord',
];

function orcus_lregions() {
    const box = { lx: 1, ly: 0, hx: 12, hy: 20,
                  nlx: 20, nly: 1, nhx: 70, nhy: 20 };
    return [
        { ...box, rtype: LR_UPSTAIR },
        { ...box, rtype: LR_BRANCH },
        { ...box, rtype: LR_TELE },
    ];
}

export async function makemaz_orcus() {
    const g = game;
    splev_map_reset();                 // C: load_special() memsets SpLev_Map
    reset_xystart_size();              // C: load_special() sp_lev.c:6373
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({style="mazegrid", bg="-"}) — no RNG, and it runs BEFORE
    // des.level_flags so corrmaze is still false.
    geh_lvlfill_maze_grid(HWALL);
    // des.level_flags("mazelevel", "shortsighted") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.shortsighted = true;
    }

    // nhlsel.c l_selection_getbounds() hands Lua ABSOLUTE coordinates, but
    // l_selection_fillrect() runs its corners back through get_location_coord(),
    // so the rect is shifted by the map origin a second time (xstart 1 here).
    const bnds = selection_getbounds(selection_match('-'));
    const bounds2 = geh_sel_area(bnds.lx, bnds.ly + 1,
                                 bnds.hx - 2, bnds.hy - 1);

    const orcus1 = geh_sel_from_points(lspo_map({
        map: ORCUS_MAP, halign: 'right', valign: 'center',
        in_themerooms: false }));
    g._full_mon_gen = true;
    try {
        // des.mazewalk(00,06,"west") — 3-argument form, so stocked stays TRUE
        // and fill_empty_maze() stocks the untouched part of the maze.
        await geh_mazewalk(0, 6, W_WEST);
        // Entire main area — the two-argument des.region form: lit only.
        splev_region_lit(1, 0, 44, 16, 0);
        quest_place_stair(33, 15, false);
        // Wall "ruins".
        for (const [bx, by] of ORCUS_BOULDERS) geh_object_at(BOULDER, bx, by);
        // Doors.
        for (const [st, dx, dy] of ORCUS_DOORS) quest_set_door(dx, dy, st);
        // Special rooms.  The altar is NOT inside a temple region, so
        // create_altar() only sets the altarmask — no priestini().
        vly_altar(24, 7, AM_NONE, 2);
        vly_region(22, 12, 25, 16, 0, MORGUE, FILL_NORMAL, false);
        vly_region(32, 9, 37, 12, 1, SHOPBASE, FILL_NORMAL, false);
        vly_region(12, 0, 15, 4, 1, SHOPBASE, FILL_NORMAL, false);
        // Some traps.
        for (const tt of ORCUS_TRAPS) await vly_trap(tt);
        // Some random objects.
        for (let i = 0; i < 10; i++) vly_object({});
        // "An object that's worth most of a wish" — math.random(0,1) is the
        // two-argument Lua form, i.e. one rn2(2).  orcus.lua:107.
        vly_object({ otyp: geh_mrandom(0, 1) === 1 ? MAGIC_MARKER : MAGIC_LAMP });
        // The resident nasty and its preferred companions.
        for (const [nm, cx, cy] of ORCUS_COURT) geh_monster_at(nm, cx, cy);
        // Randomly placed companions.
        for (const nm of ORCUS_COMPANIONS) splev_create_monster({ name: nm });
        // A few more for the party.
        for (let i = 0; i < 5; i++) splev_create_monster({});
    } finally {
        g._full_mon_gen = false;
    }
    reset_xystart_size();              // C: lspo_map's has_contents tail

    // des.levregion x2 + des.teleport_region — registered here, flipped and
    // consumed by fixup_special() below.
    const lregions = orcus_lregions();

    // local protected = bounds2:negate() | orcus1; hell_tweaks(protected)
    const protectedSel = l_selection_or(l_selection_negate(bounds2), orcus1);
    g._full_mon_gen = true;
    try {
        geh_hell_tweaks(protectedSel);
    } finally {
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level() — link_doors_rooms (the shops' doors are
    // declared before the des.region that creates them, so stock_room() has no
    // door without this), remove_boundary_syms, wallification (not corrmaze),
    // flip_level_rnd, fixup_special.  The fill_special_room() loop that stocks
    // the morgue and the two shops is the engine's post-mklev pass.
    splev_link_doors_rooms();
    remove_boundary_syms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) { flip_level(flp); geh_flip_lregions(flp, lregions); }
    geh_place_lregions(lregions);
}
