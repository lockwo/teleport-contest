// levels/sanctum.js - special level builder makemaz_sanctum(), split out of js/sp_lev.js.
// sp_lev.js re-exports makemaz_sanctum so existing importers are unaffected; the
// shared special-level machinery still lives there and is imported below.

import {
    AM_NONE, ANTI_MAGIC, A_NONE, COLNO, FILL_NORMAL, FIRE_TRAP, IRONBARS, IS_STWALL, IS_TREE,
    MAGIC_TRAP, MORGUE, ROWNO, SLP_GAS_TRAP, SPIKED_PIT, W_NONPASSWALL,
} from '../const.js';
import { game } from '../gstate.js';
import {
    MGEND_NEUTRAL, MM_EMIN, enexto_spawn, makemon, mm_mon_at, monster_by_pmidx,
    name_gender_hint, name_to_pmidx,
} from '../makemon.js';
import { ARMOR_CLASS, GEM_CLASS, POTION_CLASS, SCROLL_CLASS, WEAPON_CLASS } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    TEMPLE_RTYPE, VLY_S_LICH, VLY_S_VAMPIRE, bigrm_load_map, bigrm_wallification, flip_level,
    lspo_door_relative, quest_level_init_solidfill, quest_place_stair, quest_set_door,
    remove_boundary_syms, shuffle, vly_abs, vly_altar, vly_flip_dndest, vly_monster_class,
    vly_non_diggable, vly_object, vly_region, vly_teleport_region, vly_trap,
} from '../sp_lev.js';

// ============================================================
// Moloch's Sanctum (C ref: makemaz("sanctum") -> dat/sanctum.lua)
// ============================================================

const SANCTUM_MAP = [
    '----------------------------------------------------------------------------',
    '|             --------------                                               |',
    '|             |............|             -------                           |',
    '|       -------............-----         |.....|                           |',
    '|       |......................|        --.....|            ---------      |',
    '|    ----......................---------|......----         |.......|      |',
    '|    |........---------..........|......+.........|     ------+---..|      |',
    '|  ---........|.......|..........--S----|.........|     |........|..|      |',
    '|  |..........|.......|.............|   |.........-------..----------      |',
    '|  |..........|.......|..........----   |..........|....|..|......|        |',
    '|  |..........|.......|..........|      --.......----+---S---S--..|        |',
    '|  |..........---------..........|       |.......|.............|..|        |',
    '|  ---...........................|       -----+-------S---------S---       |',
    '|    |...........................|          |...| |......|    |....|--     |',
    '|    ----.....................----          |...---....---  ---......|     |',
    '|       |.....................|             |..........|    |.....----     |',
    '|       -------...........-----             --...-------    |.....|        |',
    '|             |...........|                  |...|          |.....|        |',
    '|             -------------                  -----          -------        |',
    '----------------------------------------------------------------------------',
].join('\n');

// C ref: sp_lev.c lspo_non_passwall() -> set_wall_property(W_NONPASSWALL) over
// the selection: an invisible barrier that blocks phasing through those walls.
// No RNG.
function vly_non_passwall(mx1, my1, mx2, my2) {
    const a = vly_abs(mx1, my1), b = vly_abs(mx2, my2);
    for (let x = Math.max(a.x, 1); x <= Math.min(b.x, COLNO - 1); x++)
        for (let y = Math.max(a.y, 0); y <= Math.min(b.y, ROWNO - 1); y++) {
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            if (IS_STWALL(loc.typ) || IS_TREE(loc.typ) || loc.typ === IRONBARS)
                loc.wall_info = (loc.wall_info || 0) | W_NONPASSWALL;
        }
}

// C ref: sp_lev.c create_monster() for des.monster({id=..., x=, y=, ...}).
// Two guards decide the prologue draws:
//   * find_montype (sp_lev.c:3156) rolls rn2(2) for the gender unless the
//     species has a fixed gender or the NAME itself is a gendered form;
//   * sp_amask_to_amask (sp_lev.c:1908) only reaches induced_align's rn2(3)
//     for AM_SPLEV_RANDOM, i.e. when the table carries NO `align` key.  An
//     explicit align="noalign" is a plain mask and draws nothing — and it also
//     routes creation through mk_roamer() (priest.c:724) instead of makemon().
function sanc_monster(name, mx, my, opts = {}) {
    const { sp_align = null, peaceful = null } = opts;
    const pmidx = name_to_pmidx(name);
    const ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    if (!ptr) return null;
    if (ptr.gcode !== 1 && ptr.gcode !== 2
        && name_gender_hint(name) === MGEND_NEUTRAL)
        rn2(2);                                   // find_montype (sp_lev.c:3156)
    if (sp_align === null) rn2(3);                // induced_align (dungeon.c:2012)
    let x = mx, y = my;
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, ptr);
        if (cc) { x = cc.x; y = cc.y; }
    }
    // mk_roamer() -> makemon(ptr, x, y, MM_ADJACENTOK|MM_EMIN|MM_NOMSG); the
    // AM_SPLEV_RANDOM arm is a plain makemon(pm, x, y, mm_flags).  MM_EMIN is
    // load-bearing: makemon()'s aligned-cleric/high-cleric minion block
    // (makemon.c:1411) is skipped when the caller supplies the emin itself, and
    // passing 0 here made every sanctum cleric draw its two rn2(3)s.
    const mtmp = makemon(ptr, x, y, sp_align !== null ? MM_EMIN : 0);
    if (!mtmp) return null;
    if (sp_align !== null) {
        mtmp.emin = mtmp.emin || {};
        mtmp.emin.min_align = sp_align;
        mtmp.emin.renegade = ((game.u?.ualign?.type ?? A_NONE) === sp_align)
                             && !peaceful;
        mtmp.ispriest = 0;
        mtmp.isminion = 1;
        mtmp.mtrapseen = ~0;                      // mon_learns_traps(ALL_TRAPS)
        mtmp.msleeping = 0;
    }
    if (peaceful != null) mtmp.mpeaceful = peaceful ? 1 : 0;
    return mtmp;
}

// C ref: sanctum.lua's fixed fire-trap ring around the temple, in file order.
function sanctum_fire_trap_coords() {
    const out = [];
    for (let x = 13; x <= 23; x++) out.push([x, 5]);
    for (let x = 13; x <= 23; x++) out.push([x, 12]);
    for (let y = 6; y <= 11; y++) out.push([13, y]);
    for (let y = 6; y <= 11; y++) out.push([23, y]);
    return out;
}

// C ref: objclass.h def_char_to_objclass() for the class chars sanctum.lua uses.
const SANCTUM_LOOT_CLASSES = [
    ARMOR_CLASS, ARMOR_CLASS, ARMOR_CLASS, ARMOR_CLASS,
    WEAPON_CLASS, WEAPON_CLASS,
    GEM_CLASS,
    POTION_CLASS, POTION_CLASS, POTION_CLASS, POTION_CLASS,
    SCROLL_CLASS, SCROLL_CLASS, SCROLL_CLASS, SCROLL_CLASS, SCROLL_CLASS,
];

// C ref: sanctum.lua's "Moloch's horde" — nine aligned clerics with explicit
// coords and align="noalign".
const SANCTUM_HORDE = [
    [20, 3], [15, 4], [11, 5], [11, 7], [11, 9], [11, 12],
    [15, 13], [17, 13], [21, 13],
];

// Entry point.  C ref: makemaz("sanctum") -> load_special("sanctum.lua").
export async function makemaz_sanctum() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    const lit = quest_level_init_solidfill();
    // des.level_flags("mazelevel","noteleport","hardfloor","nommap") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
        g.level.flags.nommap = true;
    }
    // des.non_passwall(selection.area(39,00,41,00)) — deliberately BEFORE
    // des.map (sanctum.lua:11-13), so it uses the coder's initial origin and
    // reaches the top row that falls outside the drawn map.  No RNG.
    vly_non_passwall(39, 0, 41, 0);
    // des.map([[...]]) — full-level 76x20 map, SPLEV_CENTER offset.  No RNG.
    bigrm_load_map(SANCTUM_MAP, false);   // sanctum.lua:13 bare des.map — see VALLEY_MAP

    // The temple of Moloch.  filled=2 is FILL_LVLFLAGS_ONLY.  Its contents
    // function creates the one coordinate-less door on the level, which is the
    // only create_door() call any Gehennom script makes.
    vly_region(15, 7, 21, 10, 1, TEMPLE_RTYPE, 2, false, (croom) => {
        lspo_door_relative({ wall: 'random', state: 'secret' }, croom);
    });
    // des.altar({x=18,y=08,align="noalign",type="sanctum"}) — shrine == 2, so
    // priestini() makes the high priest of Moloch.
    g._full_mon_gen = true;
    try {
        vly_altar(18, 8, AM_NONE, 2);
    } finally {
        g._full_mon_gen = false;
    }
    // The morgue — irregular, unlit, stocked at level finalize.
    vly_region(41, 6, 48, 11, 0, MORGUE, FILL_NORMAL, true);
    // Non diggable walls, then the invisible barrier splitting the level.
    vly_non_diggable(0, 0, 75, 19);
    vly_non_passwall(37, 0, 39, 19);
    // Doors — explicit coords, so sel_set_door: no RNG.
    quest_set_door(40, 6, 'closed');
    quest_set_door(62, 6, 'locked');
    quest_set_door(46, 12, 'closed');
    quest_set_door(53, 10, 'closed');

    g._full_mon_gen = true;
    try {
        // Surround the temple with fire — 34 fixed traps, one rnd(4) each.
        for (const [tx, ty] of sanctum_fire_trap_coords())
            await vly_trap(FIRE_TRAP, tx, ty);
        // Some traps — random locations.
        await vly_trap(SPIKED_PIT);
        await vly_trap(FIRE_TRAP);
        await vly_trap(SLP_GAS_TRAP);
        await vly_trap(ANTI_MAGIC);
        await vly_trap(FIRE_TRAP);
        await vly_trap(MAGIC_TRAP);
        // Some random objects.
        for (const oc of SANCTUM_LOOT_CLASSES) vly_object({ oclass: oc });
        // Some monsters.
        sanc_monster('horned devil', ...sanc_abs(14, 12), { peaceful: 0 });
        sanc_monster('barbed devil', ...sanc_abs(18, 8), { peaceful: 0 });
        sanc_monster('erinys', ...sanc_abs(10, 4), { peaceful: 0 });
        sanc_monster('marilith', ...sanc_abs(7, 9), { peaceful: 0 });
        sanc_monster('nalfeshnee', ...sanc_abs(27, 8), { peaceful: 0 });
        // Moloch's horde.
        for (const [hx, hy] of SANCTUM_HORDE)
            sanc_monster('aligned cleric', ...sanc_abs(hx, hy),
                         { sp_align: A_NONE, peaceful: 0 });
        // A few nasties.
        vly_monster_class(VLY_S_LICH);
        vly_monster_class(VLY_S_LICH);
        for (let i = 0; i < 3; i++) vly_monster_class(VLY_S_VAMPIRE);
    } finally {
        g._full_mon_gen = false;
    }

    // des.stair("up", 63,15) — no RNG.
    quest_place_stair(63, 15, true);
    // des.teleport_region({region={54,1,79,18}, region_islev=1, dir="down"}).
    vly_teleport_region(54, 1, 79, 18, true, 'down');

    // C ref: lspo_finalize_level() — wallification (no RNG) then
    // flip_level_rnd(allow_flips=3): one rn2(2) per axis.
    remove_boundary_syms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) {
        flip_level(flp);
        vly_flip_dndest(flp);
    }
}

// sanctum.lua gives its monsters map-relative coordinates; create_monster
// resolves them through get_location_coord() (no RNG for an explicit coord).
function sanc_abs(mx, my) { const c = vly_abs(mx, my); return [c.x, c.y]; }
