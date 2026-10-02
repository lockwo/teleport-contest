// levels/rog_loca.js — Rogue quest "locate" level (dat/Rog-loca.lua): the
// warren's back streets, another leprechaun/naga/chameleon nest.  sp_lev.js
// re-exports makemaz_rog_loca.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Rog-loca")
// -> load_special("Rog-loca.lua").  nhlib.lua's top-level shuffle(align)
// (rn2(3),rn2(2)) runs first; level_init solidfill draws one rn2(2); the
// des.* program then runs in file order.  No levregion, so fixup_special()
// places nothing extra (unlike Rog-goal's registered up-stair).

import {
    COLNO, DRY, LA_DOWN, LA_UP, ROWNO, STAIRS,
} from '../const.js';
import { dunlevs_in_dungeon } from '../dungeon.js';
import { game } from '../gstate.js';
import { SCR_TELEPORTATION } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, get_location,
    good_stair_loc, map_cleanup, quest_level_init_solidfill, quest_region_light,
    remove_boundary_syms, set_ok_location_func, shuffle, splev_link_doors_rooms,
    vly_non_diggable,
} from '../sp_lev.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_named_object_at,
    quest_object_rnd, quest_trap_random,
} from './quest_common.js';

// C ref: monsym.h def_char_to_monclass() — 'l' = leprechaun, 'N' = naga.
const ROG_S_LEPRECHAUN = 12, ROG_S_NAGA = 40;

// C ref: mklev.c mkstairs(x, y, up, croom=NULL, force=FALSE).  sp_lev.js's own
// lspo_stair()/quest_place_stair() are unusable here: the former routes
// through the unwired EXT.mkstairs bridge (bind_sp_lev_externs() is never
// called anywhere in this port — sp_lev.js:4020-4061), and the latter pushes
// onto a plain ARRAY that every real consumer (stairway_find_dir() and
// friends, all over js/) is blind to, since they all walk the singly-linked
// `.next` chain js/mklev.js's stairway_add() actually builds.  Reproduced
// locally instead (also mirrored, unexported, in js/levels/mon_loca.js,
// js/levels/wiz_common.js's wiz_mkstairs() and js/levels/rog_goal.js's
// rog_goal_mkstairs()).
function rog_loca_mkstairs(x, y, up) {
    const g = game;
    if ((g.u?.uz?.dlevel ?? 1) === (up ? 1 : dunlevs_in_dungeon(g.u?.uz))) return;
    const loc = g.level?.at(x, y);
    if (loc) { loc.typ = STAIRS; loc.ladder = up ? LA_UP : LA_DOWN; }
    g.stairs = { sx: x, sy: y, up: !!up, isladder: false,
                 tolev: { dnum: g.u?.uz?.dnum ?? 0, dlevel: (g.u?.uz?.dlevel ?? 1) + (up ? -1 : 1) },
                 next: g.stairs };
    if (up) { if (g.level) g.level.upstair = { x, y }; }
    else if (g.level) g.level.dnstair = { x, y };
}

// C ref: sp_lev.c l_create_stairway()'s random branch — set_ok_location_func
// (good_stair_loc) then get_location(DRY) with croom==NULL.  Both are pure
// sp_lev.js (no EXT dependency); only the terrain-writing tail (EXT.mkstairs)
// is swapped for the local one above.
function rog_loca_stair_random(up) {
    set_ok_location_func(good_stair_loc);
    const c = { x: -1, y: -1 };
    get_location(c, DRY, null);
    set_ok_location_func(null);
    if (c.x === -1 && c.y === -1) return;
    rog_loca_mkstairs(c.x, c.y, up);
}

const ROG_LOCA_MAP = [
    "             ----------------------------------------------------   --------",
    "           ---.................................................-    --.....|",
    "         ---...--------........-------.......................---     ---...|",
    "       ---.....-      ---......-     ---..................----         --.--",
    "     ---.....----       --------       --..................--         --..| ",
    "   ---...-----                       ----.----.....----.....---      --..|| ",
    "----..----                       -----..---  |...---  |.......---   --...|  ",
    "|...---                       ----....---    |.---    |.........-- --...||  ",
    "|...-                      ----.....---     ----      |..........---....|   ",
    "|...----                ----......---       |         |...|.......-....||   ",
    "|......-----          ---.........-         |     -----...|............|    ",
    "|..........-----   ----...........---       -------......||...........||    ",
    "|..............-----................---     |............|||..........|     ",
    "|------...............................---   |...........|| |.........||     ",
    "|.....|..............------.............-----..........||  ||........|      ",
    "|.....|.............--    ---.........................||    |.......||      ",
    "|.....|.............-       ---.....................--|     ||......|       ",
    "|-S----------.......----      --.................----        |.....||       ",
    "|...........|..........--------..............-----           ||....|        ",
    "|...........|............................-----                |....|        ",
    "------------------------------------------                    ------        ",
].join('\n');

export async function makemaz_rog_loca() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    quest_level_init_solidfill();
    // des.level_flags("mazelevel") — no RNG.  No "hardfloor"/"noflip"/
    // "noteleport" this time (unlike Rog-goal/Rog-strt).
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).
    bigrm_load_map(ROG_LOCA_MAP, false);

    // des.region(selection.area(00,00,75,20), "lit") — no RNG, no room.
    quest_region_light(0, 0, 75, 20, true);
    // -- Doors: none (the .lua's "--DOOR:..." line is a comment; every 'S' on
    // the map is a plain secret door baked into the map itself).
    // des.stair("up") / des.stair("down") — bare form: a RANDOM ROOM/CORR/ICE
    // spot (good_stair_loc).
    rog_loca_stair_random(true);
    rog_loca_stair_random(false);
    // des.non_diggable(selection.area(00,00,75,20)) — no RNG.
    vly_non_diggable(0, 0, 75, 20);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.object({ id="scroll of teleportation", x=11,y=18,
        //              buc="cursed", spe=0 }) — no `name`, so the named-object
        // helper's hardcoded artif=false is inert (SCROLL_CLASS never reads
        // that flag; only WEAPON_CLASS/ARMOR_CLASS roll mk_artifact()).
        quest_named_object_at(SCR_TELEPORTATION, 11, 18, { spe: 0, buc: 'cursed' });
        // des.object() x14 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 14; i++) quest_object_rnd();
        // des.trap() x6 — random type at a random DRY spot.
        for (let i = 0; i < 6; i++) await quest_trap_random();
        // des.monster({ id="leprechaun", peaceful=0 }) x17 — random locations.
        for (let i = 0; i < 17; i++) quest_monster_named_rnd('leprechaun', false);
        // des.monster({ class="l", peaceful=0 }) x1.
        quest_monster_class_rnd(ROG_S_LEPRECHAUN, false);
        // des.monster({ id="guardian naga", peaceful=0 }) x7.
        for (let i = 0; i < 7; i++) quest_monster_named_rnd('guardian naga', false);
        // des.monster({ class="N", peaceful=0 }) x3.
        for (let i = 0; i < 3; i++) quest_monster_class_rnd(ROG_S_NAGA, false);
        // des.monster({ id="chameleon", peaceful=0 }) x5.
        for (let i = 0; i < 5; i++) quest_monster_named_rnd('chameleon', false);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: load_special()'s tail (sp_lev.c:6464-6491) — link_doors_rooms(),
    // remove_boundary_syms(), map_cleanup(), wallification(1,0,COLNO-1,
    // ROWNO-1), then flip_level_rnd(allow_flips=3, FALSE): one rn2(2) per axis.
    splev_link_doors_rooms();
    remove_boundary_syms();
    map_cleanup();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
