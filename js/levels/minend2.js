// levels/minend2.js - special level builder makemaz_minend2(), split out of js/sp_lev.js.
// sp_lev.js re-exports makemaz_minend2 so existing importers are unaffected; the
// shared special-level machinery still lives there and is imported below.

import {
    COLNO, ENGRAVE, FOUNTAIN, HOLE, HWALL, LADDER, MAGIC_TRAP, NO_TRAP, ROCKTRAP, ROOM, ROWNO,
    RUST_TRAP, SDOOR, SQKY_BOARD, STAIRS, TRAPDOOR, VWALL, WEB, is_pit,
} from '../const.js';
import { make_engr_at } from '../engrave.js';
import { game } from '../gstate.js';
import { level_difficulty_ext, makemon, monster_by_pmidx, name_to_pmidx } from '../makemon.js';
import { GEM_CLASS, POTION_CLASS, TOOL_CLASS, uncurse } from '../mkobj.js';
import { rn2, rnd } from '../rng.js';
import { Can_fall_thru, maketrap } from '../trap.js';
import {
    LOC_DRY, S_HUMANOID, _mktrap_victim, bigrm_load_map, bigrm_wallification, flip_level,
    percent, quest_level_init_solidfill, quest_place_stair, remove_boundary_syms, shuffle,
    splev_create_monster, splev_door_at, splev_feature, splev_get_location_rnd,
    splev_link_doors_rooms, splev_object_at, splev_region_lit, splev_terrain_area,
    splev_traptype_rnd, vly_abs, vly_flip_dndest, vly_non_diggable, vly_object,
    vly_teleport_region, vly_terrain_at,
} from '../sp_lev.js';

// C ref: sp_lev.c create_trap() with no type and no coordinate — the DRY
// get_location loop (rejecting STAIRS/LADDER), then
// mktrap(0, MKTRAP_MAZEFLAG, croom, &tm).  NOTE the flags: lspo_trap defaults
// spider_on_web to TRUE (sp_lev.c:4405), so a bare `des.trap()` does NOT set
// MKTRAP_NOSPIDERONWEB — which both keeps traptype_rnd's `lvl < 7` gate on WEB
// alive and means a rolled web comes with a free giant spider.
// With an explicit `tm` mktrap skips its own placement loop, so the draws are
// traptype_rnd's retry loop, whatever maketrap() rolls, the web's spider, and
// the victim rnd(4) — the last skipped entirely when maketrap() could not build
// the trap (mklev.c:2137 re-derives `kind` from the returned pointer).
export async function splev_trap_random() {
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

// C ref: sp_lev.c lspo_engraving() -> make_engr_at(x, y, txt, 0L, etype).
// No RNG.
function splev_engraving(mx, my, text, etype) {
    const c = vly_abs(mx, my);
    make_engr_at(c.x, c.y, text, text, 0, etype);
}

// ============================================================
// Mine's End (C ref: makemaz("minend") -> dat/minend-<N>.lua)
// "minend" has rndlevs 3; only the "-2" variant ("Gnome King's Wine Cellar")
// is ported so far.
// ============================================================

const MINEND2_MAP = [
    '---------------------------------------------------------------------------',
    '|...................................................|                     |',
    '|.|---------S--.--|...|--------------------------|..|                     |',
    '|.||---|   |.||-| |...|..........................|..|                     |',
    '|.||...| |-|.|.|---...|.............................|                ..   |',
    '|.||...|-|.....|....|-|..........................|..|.               ..   |',
    '|.||.....|-S|..|....|............................|..|..                   |',
    '|.||--|..|..|..|-|..|----------------------------|..|-.                   |',
    '|.|   |..|..|....|..................................|...                  |',
    '|.|   |..|..|----|..-----------------------------|..|....                 |',
    '|.|---|..|--|.......|----------------------------|..|.....                |',
    '|...........|----.--|......................|     |..|.......              |',
    '|-----------|...|.| |------------------|.|.|-----|..|.....|..             |',
    '|-----------|.{.|.|--------------------|.|..........|.....|....           |',
    '|...............|.S......................|-------------..-----...         |',
    '|.--------------|.|--------------------|.|.........................       |',
    '|.................|                    |.....................|........    |',
    '---------------------------------------------------------------------------',
].join('\n');

// C ref: mkobj.c objects[] otyps minend-2.lua names by string.
const POT_BOOZE_OTYP = 317, POT_OBJECT_DETECTION_OTYP = 312,
      DIAMOND_OTYP = 440, MINEND_RUBY_OTYP = 441, EMERALD_OTYP = 445,
      AMETHYST_OTYP = 455, LUCKSTONE_OTYP = 470;

// Entry point.  C ref: makemaz("minend") -> load_special("minend-2.lua").
export async function makemaz_minend2() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    const lit = quest_level_init_solidfill();
    // des.level_flags("mazelevel") — no RNG.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    if (g.level) g.level._splev_fullmon = true;
    // des.map([[...]]) — 75x18, SPLEV_CENTER offset.  No RNG.
    bigrm_load_map(MINEND2_MAP, false);   // minend-2.lua:13 bare des.map — see VALLEY_MAP

    if (percent(50)) {
        vly_terrain_at(55, 14, HWALL);
        vly_terrain_at(56, 14, HWALL);
        vly_terrain_at(61, 15, VWALL);
        vly_terrain_at(52, 5, SDOOR);
        splev_door_at('locked', 52, 5);
    }
    if (percent(50)) {
        vly_terrain_at(18, 1, VWALL);
        splev_terrain_area(7, 12, 8, 13, ROOM);
    }
    if (percent(50)) {
        vly_terrain_at(49, 4, VWALL);
        vly_terrain_at(21, 5, ROOM);
    }
    if (percent(50)) {
        if (percent(50)) {
            vly_terrain_at(22, 1, VWALL);
        } else {
            vly_terrain_at(50, 7, HWALL);
            vly_terrain_at(51, 7, HWALL);
        }
    }

    // Uncontrolled arrival region — region_islev, so whole-level absolute
    // coordinates.  No RNG.
    vly_teleport_region(23, 3, 48, 16, true);
    // Dungeon description — no RNG.
    splev_feature(14, 13, FOUNTAIN);
    splev_region_lit(23, 3, 48, 6, 1);
    splev_region_lit(21, 6, 22, 6, 1);
    splev_region_lit(14, 4, 14, 4, 0);
    splev_region_lit(10, 5, 14, 8, 0);
    splev_region_lit(10, 9, 11, 9, 0);
    splev_region_lit(15, 8, 16, 8, 0);
    splev_door_at('locked', 12, 2);
    splev_door_at('locked', 11, 6);
    quest_place_stair(36, 4, true);
    vly_non_diggable(0, 0, 52, 17);
    vly_non_diggable(53, 0, 74, 0);
    vly_non_diggable(53, 17, 74, 17);
    vly_non_diggable(74, 1, 74, 16);
    vly_non_diggable(53, 7, 55, 7);
    vly_non_diggable(53, 14, 61, 14);
    splev_engraving(12, 3, "You are now entering the Gnome King's wine cellar.",
                    ENGRAVE);
    splev_engraving(12, 4, 'Trespassers will be persecuted!', ENGRAVE);

    g._full_mon_gen = true;
    try {
        // The Gnome King's wine cellar.
        for (const [ox, oy] of [[10, 7], [10, 8]]) {
            splev_object_at({ otyp: POT_BOOZE_OTYP }, ox, oy);
            splev_object_at({ otyp: POT_BOOZE_OTYP }, ox, oy);
            splev_object_at({ oclass: POTION_CLASS }, ox, oy);
        }
        splev_object_at({ otyp: POT_BOOZE_OTYP }, 10, 9);
        splev_object_at({ otyp: POT_BOOZE_OTYP }, 10, 9);
        splev_object_at({ otyp: POT_OBJECT_DETECTION_OTYP }, 10, 9);

        // The Treasure chamber.
        splev_object_at({ otyp: DIAMOND_OTYP }, 69, 4);
        splev_object_at({ oclass: GEM_CLASS }, 69, 4);
        splev_object_at({ otyp: DIAMOND_OTYP }, 69, 4);
        splev_object_at({ oclass: GEM_CLASS }, 69, 4);
        splev_object_at({ otyp: EMERALD_OTYP }, 70, 4);
        splev_object_at({ oclass: GEM_CLASS }, 70, 4);
        splev_object_at({ otyp: EMERALD_OTYP }, 70, 4);
        splev_object_at({ oclass: GEM_CLASS }, 70, 4);
        splev_object_at({ otyp: EMERALD_OTYP }, 69, 5);
        splev_object_at({ oclass: GEM_CLASS }, 69, 5);
        splev_object_at({ otyp: MINEND_RUBY_OTYP }, 69, 5);
        splev_object_at({ oclass: GEM_CLASS }, 69, 5);
        splev_object_at({ otyp: MINEND_RUBY_OTYP }, 70, 5);
        splev_object_at({ otyp: AMETHYST_OTYP }, 70, 5);
        splev_object_at({ oclass: GEM_CLASS }, 70, 5);
        splev_object_at({ otyp: AMETHYST_OTYP }, 70, 5);
        // buc="not-cursed" is create_object's curse_state 4 -> uncurse(); no RNG.
        const luck = splev_object_at({ otyp: LUCKSTONE_OTYP }, 70, 5);
        if (luck) uncurse(luck);

        // Scattered gems, tools, and three fully random objects.
        for (let i = 0; i < 7; i++) vly_object({ oclass: GEM_CLASS });
        for (let i = 0; i < 2; i++) vly_object({ oclass: TOOL_CLASS });
        for (let i = 0; i < 3; i++) vly_object({});

        // Random traps.
        for (let i = 0; i < 6; i++) await splev_trap_random();

        // Random monsters.
        splev_create_monster({ name: 'gnome king' });
        for (let i = 0; i < 3; i++) splev_create_monster({ name: 'gnome lord' });
        for (let i = 0; i < 2; i++) splev_create_monster({ name: 'gnomish wizard' });
        for (let i = 0; i < 9; i++) splev_create_monster({ name: 'gnome' });
        for (let i = 0; i < 2; i++) splev_create_monster({ name: 'hobbit' });
        for (let i = 0; i < 3; i++) splev_create_monster({ name: 'dwarf' });
        splev_create_monster({ cls: S_HUMANOID });
    } finally {
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level() tail.
    splev_link_doors_rooms();
    remove_boundary_syms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) { flip_level(flp); vly_flip_dndest(flp); }
}
