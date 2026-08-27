// levels/minend3.js - special level builder makemaz_minend3() (dat/minend-3.lua).
// The shared special-level machinery lives in js/sp_lev.js and is imported below;
// sp_lev.js re-exports makemaz_minend3 so js/mklev.js can dispatch to it.

import {
    COLNO, CROSSWALL, FOUNTAIN, HOLE, HWALL, IS_DOOR, IS_ROOM, LADDER, LEVEL_TELEP,
    MAGIC_TRAP, NO_TRAP, ROCKTRAP, ROOM, ROWNO, RUST_TRAP, SQKY_BOARD, STAIRS, STONE,
    TRAPDOOR, VWALL, WEB, is_pit,
} from '../const.js';
import { game } from '../gstate.js';
import { level_difficulty_ext, makemon, monster_by_pmidx, name_to_pmidx } from '../makemon.js';
import { walkfrom } from '../mkmaze.js';
import { GEM_CLASS, SCROLL_CLASS, SPBOOK_CLASS, uncurse } from '../mkobj.js';
import { rn2, rnd } from '../rng.js';
import { Can_fall_thru, maketrap } from '../trap.js';
import {
    LOC_DRY, VLY_S_MUMMY, VLY_S_VAMPIRE, VLY_S_ZOMBIE, _mktrap_victim,
    bigrm_wallification, flip_level, gx, gy, lspo_map, quest_place_stair,
    remove_boundary_syms, set_levltyp_lit, shuffle, splev_create_monster, splev_door_at,
    splev_feature, splev_get_location_rnd, splev_link_doors_rooms, splev_object_at,
    splev_region_lit, splev_traptype_rnd, vly_abs, vly_non_diggable, vly_object, vly_trap,
} from '../sp_lev.js';

// ============================================================
// Mine's End variant 3 — "Catacombs" by Kelly Bailey.
// C ref: mkmaze.c:1136 makemaz("minend") -> load_special("minend-3.lua").
//
// The level is solid-filled with HWALL, then the map paints STONE into the
// gaps between its walls; des.mazewalk() then carves a maze THROUGH those
// STONE cells (okay() only accepts STONE, mkmaze.c:301) — the "very specific
// behavior of MAZEWALK" the script's header comment refers to.
// ============================================================

const MINEND3_MAP = [
    ' - - - - - - - - - - -- -- - - . - - - - - - - - - -- - - -- - - - - . - - |',
    '------...---------.-----------...-----.-------.-------     ----------------|',
    ' - - - - - - - - - - - . - - - . - - - - - - - - - - -- - -- - . - - - - - |',
    '------------.---------...-------------------------.---   ------------------|',
    ' - - - - - - - - - - . . - - --- - . - - - - - - - - -- -- - - - - |.....| |',
    '--.---------------.......------------------------------- ----------|.....S-|',
    ' - - - - |.. ..| - ....... . - - - - |.........| - - - --- - - - - |.....| |',
    '----.----|.....|------.......--------|.........|--------------.------------|',
    ' - - - - |..{..| - - -.... . --- - -.S.........S - - - - - - - - - - - - - |',
    '---------|.....|--.---...------------|.........|---------------------------|',
    ' - - - - |.. ..| - - - . - - - - - - |.........| - --- . - - - - - - - - - |',
    '----------------------...-------.---------------------...------------------|',
    '---..| - - - - - - - - . --- - - - - - - - - - - - - - . - - --- - - --- - |',
    '-.S..|----.-------.------- ---------.-----------------...----- -----.-------',
    '---..| - - - - - - - -- - - -- . - - - - - . - - - . - . - - -- -- - - - -- ',
    '-.S..|--------.---.---       -...---------------...{.---------   ---------  ',
    '--|. - - - - - - - -- - - - -- . - - - --- - - - . . - - - - -- - - - - - - ',
].join('\n');

// C ref: src/objects.c OBJ_NAME() ids.
const O_DIAMOND = 440, O_RUBY = 441, O_EMERALD = 445, O_AMETHYST = 455,
      O_LUCKSTONE = 470, O_FLINT = 473;
// monsym.h S_EYE ('e') — lowercase class letters are 1..26.
const S_EYE = 5;

// C ref: sp_lev.c lvlfill_solid(filling, lit) (sp_lev.c:374) — x runs 2..
// x_maze_max and y 0..y_maze_max, NOT the whole grid, so the outermost columns
// keep whatever they had.  quest_level_init_solidfill() covers the whole map,
// which is indistinguishable for a STONE fill but not for this level's HWALL.
function minend3_level_init_solidfill(filling) {
    const lit = rn2(2);                            // splev_initlev sp_lev.c:2992
    const xmm = (COLNO - 1) & ~1, ymm = (ROWNO - 1) & ~1;
    for (let x = 2; x <= xmm; x++)
        for (let y = 0; y <= ymm; y++) {
            if (!set_levltyp_lit(x, y, filling, lit ? 1 : 0)) continue;
            const loc = game.level.at(x, y);
            loc.flags = 0; loc.horizontal = false; loc.roomno = 0; loc.edge = false;
        }
}

// C ref: mkmap.c wallify_map() — a STONE cell next to a ROOM (or CROSSWALL)
// becomes HWALL when the neighbour is vertically adjacent, VWALL otherwise.
// des.wallify() with no arguments passes the map's own bounding box grown by
// one (sp_lev.c lspo_wallify).  No RNG.
function minend3_wallify_map(x1, y1, x2, y2) {
    const map = game.level;
    y1 = Math.max(y1, 0); x1 = Math.max(x1, 1);
    y2 = Math.min(y2, ROWNO - 1); x2 = Math.min(x2, COLNO - 1);
    for (let y = y1; y <= y2; y++) {
        const loYY = (y > 0) ? y - 1 : 0;
        const hiYY = (y < y2) ? y + 1 : y2;
        for (let x = x1; x <= x2; x++) {
            if (map.at(x, y)?.typ !== STONE) continue;
            const loXX = (x > 1) ? x - 1 : 1;
            const hiXX = (x < x2) ? x + 1 : x2;
            let done = false;
            for (let yy = loYY; yy <= hiYY && !done; yy++)
                for (let xx = loXX; xx <= hiXX; xx++) {
                    const t = map.at(xx, yy)?.typ;
                    if (IS_ROOM(t) || t === CROSSWALL) {
                        map.at(x, y).typ = (yy !== y) ? HWALL : VWALL;
                        done = true; break;
                    }
                }
        }
    }
}

// C ref: sp_lev.c lspo_mazewalk() (sp_lev.c:5769) for the table form with an
// explicit dir and stocked=false: the target cell is stepped one square in
// `dir`, floored to ftyp unless it is a door, then nudged to ODD parity before
// walkfrom() runs.  fill_empty_maze() is skipped when stocked is false.
function minend3_mazewalk(mx, my, dir, ftyp) {
    const c = vly_abs(mx, my);
    let x = c.x, y = c.y;
    switch (dir) {
    case 'north': y--; break;
    case 'south': y++; break;
    case 'east': x++; break;
    case 'west': x--; break;
    default: break;
    }
    let loc = game.level?.at(x, y);
    if (loc && !IS_DOOR(loc.typ)) { loc.typ = ftyp; loc.flags = 0; }
    if (!(x % 2)) {
        x += (dir === 'east') ? 1 : -1;
        loc = game.level?.at(x, y);
        if (loc) { loc.typ = ftyp; loc.flags = 0; }
    }
    if (!(y % 2)) y += (dir === 'south') ? 1 : -1;
    walkfrom(x, y, ftyp);
}

// C ref: sp_lev.c create_trap() with no type and no coordinate — see
// js/levels/minend2.js for the full note on the flags.
async function minend3_trap_random() {
    let x = -1, y = -1, trycnt = 0;
    do {
        const c = splev_get_location_rnd(LOC_DRY);
        x = c.x; y = c.y;
        const t = game.level?.at(x, y)?.typ;
        if (t !== STAIRS && t !== LADDER) break;
    } while (++trycnt <= 100);
    let kind;
    do { kind = splev_traptype_rnd(0); } while (kind === NO_TRAP);
    if ((kind === HOLE || kind === TRAPDOOR) && !Can_fall_thru(game.u?.uz))
        kind = ROCKTRAP;
    const t = await maketrap(x, y, kind);
    const k = t ? t.ttyp : NO_TRAP;
    if (k === WEB) {
        const spider = monster_by_pmidx(name_to_pmidx('giant spider'));
        if (spider) makemon(spider, x, y, 0 /* NO_MM_FLAGS */);
    }
    const lvl = level_difficulty_ext();
    if (k !== NO_TRAP && lvl <= rnd(4)                // mklev.c:2137
        && k !== SQKY_BOARD && k !== RUST_TRAP
        && !is_pit(k) && (k < HOLE || k === MAGIC_TRAP)
        && _mktrap_victim)
        _mktrap_victim(t);
}

// Entry point.  C ref: makemaz("minend") -> load_special("minend-3.lua").
export async function makemaz_minend3() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg="-" }) — rn2(2), then HWALL fill.
    minend3_level_init_solidfill(HWALL);
    // des.level_flags("mazelevel", "nommap") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.nommap = true;
    }
    if (g.level) g.level._splev_fullmon = true;
    // des.map({ halign="center", valign="bottom", map=[[...]] }) — 76x17.
    lspo_map({ map: MINEND3_MAP, halign: 'center', valign: 'bottom',
               lit: false, in_themerooms: false });

    // local place = { {1,15},{68,6},{1,13} }; shuffle(place) -> rn2(3), rn2(2).
    const place = shuffle([[1, 15], [68, 6], [1, 13]]);
    const P = (n) => place[n - 1];                 // Lua 1-based indexing

    g._full_mon_gen = true;
    try {
        vly_non_diggable(67, 3, 73, 7);
        vly_non_diggable(0, 12, 2, 16);
        splev_feature(12, 8, FOUNTAIN);
        splev_feature(51, 15, FOUNTAIN);
        splev_region_lit(0, 0, 75, 16, 0);
        splev_region_lit(38, 6, 46, 10, 1);
        splev_door_at('closed', 37, 8);
        splev_door_at('closed', 47, 8);
        splev_door_at('closed', 73, 5);
        splev_door_at('closed', 2, 15);
        // des.mazewalk({ x=36, y=8, dir="west", stocked=false })
        minend3_mazewalk(36, 8, 'west', ROOM);
        quest_place_stair(42, 8, true);
        // des.wallify() with no args — the map's box grown by one each way.
        minend3_wallify_map(gx.xstart - 1, gy.ystart - 1,
                            gx.xstart + gx.xsize + 1, gy.ystart + gy.ysize + 1);

        // Objects.  The gems alternate with fully random gems ("*").
        for (const otyp of [O_DIAMOND, null, O_DIAMOND, null, O_EMERALD, null,
                            O_EMERALD, null, O_EMERALD, null, O_RUBY, null,
                            O_RUBY, O_AMETHYST, null, O_AMETHYST]) {
            if (otyp == null) vly_object({ oclass: GEM_CLASS });
            else vly_object({ otyp });
        }
        // buc="not-cursed" is create_object's curse_state 4 -> uncurse().
        const luck = splev_object_at({ otyp: O_LUCKSTONE }, P(2)[0], P(2)[1]);
        if (luck) uncurse(luck);
        splev_object_at({ otyp: O_FLINT }, P(1)[0], P(1)[1]);
        for (let i = 0; i < 5; i++) vly_object({ oclass: SCROLL_CLASS });
        for (let i = 0; i < 4; i++) vly_object({ oclass: SPBOOK_CLASS });
        for (let i = 0; i < 3; i++) vly_object({});

        // Traps: seven random, then the two guaranteed level teleporters.
        for (let i = 0; i < 7; i++) await minend3_trap_random();
        await vly_trap(LEVEL_TELEP, P(2)[0], P(2)[1]);
        await vly_trap(LEVEL_TELEP, P(1)[0], P(1)[1]);

        // The undead.
        for (let i = 0; i < 5; i++) splev_create_monster({ cls: VLY_S_MUMMY });
        splev_create_monster({ name: 'ettin mummy' });
        splev_create_monster({ cls: VLY_S_VAMPIRE });
        for (let i = 0; i < 5; i++) splev_create_monster({ cls: VLY_S_ZOMBIE });
        splev_create_monster({ cls: VLY_S_VAMPIRE });
        for (let i = 0; i < 4; i++) splev_create_monster({ cls: S_EYE });
    } finally {
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level() tail.
    splev_link_doors_rooms();
    remove_boundary_syms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                          // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                          // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
