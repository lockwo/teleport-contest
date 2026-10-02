// levels/mon_loca.js — Monk quest "locate" level (dat/Mon-loca.lua): a maze
// hall of interlocking chambers, home to earth elementals and xorns and a
// blessed tin of spinach guarded by an Elbereth engraving (vegetarian monks
// shouldn't eat giant corpses, so this is their Str-boost workaround).
// sp_lev.js re-exports makemaz_mon_loca.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Mon-loca")
// -> load_special("Mon-loca.lua").  nhlib.lua's top-level shuffle(align)
// (rn2(3),rn2(2)) runs first; level_init solidfill draws one rn2(2); the
// des.* program then runs in file order.  No levregion, so fixup_special()
// places nothing extra.

import {
    BURN, COLNO, DRY, LA_DOWN, LA_UP, ROOM, ROWNO, STAIRS,
} from '../const.js';
import { dunlevs_in_dungeon } from '../dungeon.js';
import { make_engr_at } from '../engrave.js';
import { game } from '../gstate.js';
import { TIN, bless, mksobj_at } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, get_location,
    good_stair_loc, map_cleanup, quest_level_init_solidfill, quest_region_light,
    remove_boundary_syms, set_ok_location_func, shuffle, splev_link_doors_rooms,
    vly_non_diggable,
} from '../sp_lev.js';
import { quest_monster_named_rnd, quest_object_rnd, quest_trap_random } from './quest_common.js';

// C ref: mklev.c mkstairs(x, y, up, croom=NULL, force=FALSE).  sp_lev.js's own
// lspo_stair()/quest_place_stair() are unusable here: the former routes
// through the unwired EXT.mkstairs bridge (bind_sp_lev_externs() is never
// called anywhere in this port — sp_lev.js:4020-4061), and the latter pushes
// onto a plain ARRAY that every real consumer (stairway_find_dir() and
// friends, all over js/) is blind to, since they all walk the singly-linked
// `.next` chain js/mklev.js's stairway_add() actually builds.  Reproduced
// locally instead (also mirrored, unexported, as js/levels/wiz_common.js's
// wiz_mkstairs() and js/levels/rog_goal.js's rog_goal_mkstairs()).
function mon_loca_mkstairs(x, y, up) {
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
// (good_stair_loc) then get_location(DRY) with croom==NULL (the whole
// map-relative footprint): one rn2(xsize)/rn2(ysize) pair per try, up to 100,
// then a deterministic scan.  Both are pure sp_lev.js (no EXT dependency), so
// this reaches the exact same coordinate lspo_stair() would — only the
// terrain-writing tail (EXT.mkstairs) is swapped for the local one above.
function mon_loca_stair_random(up) {
    set_ok_location_func(good_stair_loc);
    const c = { x: -1, y: -1 };
    get_location(c, DRY, null);
    set_ok_location_func(null);
    if (c.x === -1 && c.y === -1) return;
    mon_loca_mkstairs(c.x, c.y, up);
}

const MON_LOCA_MAP = [
    "             ----------------------------------------------------   --------",
    "           ---.................................................-    --.....|",
    "         ---...--------........------........................---     ---...|",
    "       ---.....-      --.......-    ----..................----         --.--",
    "     ---.....----      ---------       --..................--         --..| ",
    "   ---...-----                       ----.----.....----.....---      --..|| ",
    "----..----                       -----..---  |...---  |.......---   --...|  ",
    "|...---                       ----....---    |.---    |.........-- --...||  ",
    "|...-                      ----.....---     ----      |..........---....|   ",
    "|...----                ----......---       |         |...|.......-....||   ",
    "|......-----          ---.........-         |     -----...|............|    ",
    "|..........-----   ----...........---       -------......||...........||    ",
    "|..............-----................---     |............|||..........|     ",
    "|-S----...............................---   |...........|| |.........||     ",
    "|.....|..............------.............-----..........||  ||........|      ",
    "|.....|.............--    ---.........................||    |.......||      ",
    "|.....|.............-       ---.....................--|     ||......|       ",
    "|---S--------.......----      --.................----        |.....||       ",
    "|...........|..........--------..............-----           ||....|        ",
    "|...........|............................-----                |....|        ",
    "------------------------------------------                    ------        ",
].join('\n');

export async function makemaz_mon_loca() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    quest_level_init_solidfill();
    // des.level_flags("mazelevel") — no RNG.  No "hardfloor"/"noflip".
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).
    bigrm_load_map(MON_LOCA_MAP, false);

    // des.region(selection.area(00,00,75,20), "lit") — no RNG, no room.
    quest_region_light(0, 0, 75, 20, true);
    // des.stair("up") / des.stair("down") — bare form: a RANDOM ROOM/CORR/ICE
    // spot (good_stair_loc).
    mon_loca_stair_random(true);
    mon_loca_stair_random(false);
    // des.non_diggable(selection.area(00,00,75,20)) — no RNG.
    vly_non_diggable(0, 0, 75, 20);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.object() x15 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 15; i++) quest_object_rnd();

        // local tinplace = selection.negate():filter_mapchar('.')
        // local tinloc = tinplace:rndcoord(0)
        // selection.negate() with no receiver is a brand-new ALL-SET
        // selection (the whole level); filter_mapchar('.') keeps only ROOM
        // squares; rndcoord(0) (removeit=false) scans x-outer/y-inner and
        // draws ONE rn2(count) — no retry loop, since this is a single pick.
        const dots = [];
        for (let x = 0; x < COLNO; x++)
            for (let y = 0; y < ROWNO; y++)
                if (game.level?.at(x, y)?.typ === ROOM) dots.push({ x, y });
        if (dots.length) {
            const tinloc = dots[rn2(dots.length)];
            // des.object({ id="tin", coord=tinloc, quantity=2, buc="blessed",
            //              montype="spinach" }) — "spinach" isn't a real
            // species, so create_object() leaves corpsenm at NON_PM and sets
            // spe=1 directly (that IS a spinach tin); mksobj_at's own `artif`
            // flag is inert for FOOD_CLASS, so the plain call is faithful.
            const tin = mksobj_at(TIN, tinloc.x, tinloc.y, true, true);
            if (tin) { tin.spe = 1; tin.quan = 2; bless(tin); }
            // des.engraving({ coord=tinloc, type="burn", text="Elbereth" }) —
            // explicit coord: no RNG.
            make_engr_at(tinloc.x, tinloc.y, 'Elbereth', 'Elbereth', 0, BURN);
        }

        // des.trap() x6 — random type at a random DRY spot.
        for (let i = 0; i < 6; i++) await quest_trap_random();
        // des.monster("earth elemental") x14 / "xorn" x9 — random locations,
        // no `peaceful` field (makemon's own answer stands).
        for (let i = 0; i < 14; i++) quest_monster_named_rnd('earth elemental', null);
        for (let i = 0; i < 9; i++) quest_monster_named_rnd('xorn', null);
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
