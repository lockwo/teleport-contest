// levels/minend1.js - special level builder makemaz_minend1().
// C ref: makemaz("minend") -> load_special("minend-1.lua"), the "Mimic of the
// Mines" variant (rnd(3) == 1 of minend's three rndlevs).

import { COLNO, OROOM, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { GEM_CLASS, TOOL_CLASS, uncurse } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    S_HUMANOID, bigrm_load_map, bigrm_wallification, flip_level,
    quest_level_init_solidfill, quest_place_stair, remove_boundary_syms, shuffle,
    splev_create_monster, splev_door_at, splev_link_doors_rooms, splev_object_at,
    splev_region_lit, vly_flip_dndest, vly_non_diggable, vly_object, vly_region,
} from '../sp_lev.js';
import { splev_trap_random } from './minend2.js';

// C ref: defsym.h MONSYM(13, 'm', MIMIC, S_MIMIC) — def_char_to_monclass('m').
const S_MIMIC = 13;

// C ref: mkobj.js OBJECT_DATA otyps for the gem names minend-1.lua spells out.
const DIAMOND_OTYP = 440, RUBY_OTYP = 441, EMERALD_OTYP = 445,
      AMETHYST_OTYP = 455, WORTHLESS_WHITE_OTYP = 461, WORTHLESS_RED_OTYP = 463,
      WORTHLESS_GREEN_OTYP = 468, WORTHLESS_VIOLET_OTYP = 469,
      LUCKSTONE_OTYP = 470, LOADSTONE_OTYP = 471, TOUCHSTONE_OTYP = 472,
      FLINT_OTYP = 473;

const MINEND1_MAP = [
    '------------------------------------------------------------------   ------',
    '|                        |.......|     |.......-...|       |.....|.       |',
    '|    ---------        ----.......-------...........|       ---...-S-      |',
    '|    |.......|        |..........................-S-      --.......|      |',
    '|    |......-------   ---........................|.       |.......--      |',
    '|    |..--........-----..........................|.       -.-..----       |',
    '|    --..--.-----........-.....................---        --..--          |',
    '|     --..--..| -----------..................---.----------..--           |',
    '|      |...--.|    |..S...S..............---................--            |',
    '|     ----..-----  ------------........--- ------------...---             |',
    '|     |.........--            ----------              ---...-- -----      |',
    '|    --.....---..--                           --------  --...---...--     |',
    '| ----..-..-- --..---------------------      --......--  ---........|     |',
    '|--....-----   --..-..................---    |........|    |.......--     |',
    '|.......|       --......................S..  --......--    ---..----      |',
    '|--.--.--        ----.................---     ------..------...--         |',
    '| |....S..          |...............-..|         ..S...........|          |',
    '--------            --------------------           ------------------------',
].join('\n');

// C ref: minend-1.lua:35 `local place = { ... }` — the seven gem niches, in
// source order.  shuffle() permutes them, so which niche gets which pile (and
// which one is left empty) is the load-bearing result of the 7-element
// Fisher-Yates: rn2(7), rn2(6), rn2(5), rn2(4), rn2(3), rn2(2).
const MINEND1_PLACE = [[8, 16], [13, 7], [21, 8], [41, 14],
                       [50, 4], [50, 16], [66, 1]];

// C ref: sp_lev.c create_monster()'s M_AP_OBJECT arm — a mimic given an
// explicit `appear_as="obj:NAME"` overrides whatever set_mimic_sym() picked
// inside makemon().  No RNG; the retry loop is BOULDER-only.
function mimic_appear_as(mtmp, otyp) {
    if (!mtmp) return;
    mtmp.m_ap_type = 'obj';
    mtmp.mappearance = otyp;
}

// Entry point.  C ref: makemaz("minend") -> load_special("minend-1.lua").
export async function makemaz_minend1() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    quest_level_init_solidfill();
    // des.level_flags("mazelevel") — no RNG.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    if (g.level) g.level._splev_fullmon = true;
    // des.map([[...]]) — 75x18, SPLEV_CENTER offset.  No RNG.
    bigrm_load_map(MINEND1_MAP, false);

    const place = shuffle(MINEND1_PLACE.map(p => p.slice()));

    // des.region({ region={26,01,32,01}, lit=0, type="ordinary", irregular=1,
    // arrival_room=true }).  irregular forces the room to really be built
    // (sp_lev.c:5652 room_not_needed), so arrival_room adds nothing here;
    // lit is explicit, so litstate_rnd() draws nothing.
    vly_region(26, 1, 32, 1, 0, OROOM, 0, true);
    // des.region(selection.area(...), "unlit") — the 2-arg lighting-only form.
    splev_region_lit(20, 8, 21, 8, 0);
    splev_region_lit(23, 8, 25, 8, 0);

    // Secret doors.
    splev_door_at('locked', 7, 16);
    splev_door_at('locked', 22, 8);
    splev_door_at('locked', 26, 8);
    splev_door_at('locked', 40, 14);
    splev_door_at('locked', 50, 3);
    splev_door_at('locked', 51, 16);
    splev_door_at('locked', 66, 2);
    // Stairs / non-diggable walls.
    quest_place_stair(36, 4, true);
    vly_non_diggable(0, 0, 74, 17);

    g._full_mon_gen = true;
    try {
        // Niches.  Lua place[N] is 1-based; place[6] is deliberately empty.
        // Each mimic lands on a square that already holds objects, so
        // set_mimic_sym() takes the OBJ_AT arm and draws nothing before the
        // explicit appear_as overrides it.
        const niche = (i) => place[i - 1];

        let [x, y] = niche(7);
        splev_object_at({ otyp: DIAMOND_OTYP }, x, y);
        splev_object_at({ otyp: EMERALD_OTYP }, x, y);
        splev_object_at({ otyp: WORTHLESS_VIOLET_OTYP }, x, y);
        mimic_appear_as(splev_create_monster({ cls: S_MIMIC, mx: x, my: y }),
                        LUCKSTONE_OTYP);

        [x, y] = niche(1);
        splev_object_at({ otyp: WORTHLESS_WHITE_OTYP }, x, y);
        splev_object_at({ otyp: EMERALD_OTYP }, x, y);
        splev_object_at({ otyp: AMETHYST_OTYP }, x, y);
        mimic_appear_as(splev_create_monster({ cls: S_MIMIC, mx: x, my: y }),
                        LOADSTONE_OTYP);

        [x, y] = niche(2);
        splev_object_at({ otyp: DIAMOND_OTYP }, x, y);
        splev_object_at({ otyp: WORTHLESS_GREEN_OTYP }, x, y);
        splev_object_at({ otyp: AMETHYST_OTYP }, x, y);
        mimic_appear_as(splev_create_monster({ cls: S_MIMIC, mx: x, my: y }),
                        FLINT_OTYP);

        [x, y] = niche(3);
        splev_object_at({ otyp: WORTHLESS_WHITE_OTYP }, x, y);
        splev_object_at({ otyp: EMERALD_OTYP }, x, y);
        splev_object_at({ otyp: WORTHLESS_VIOLET_OTYP }, x, y);
        mimic_appear_as(splev_create_monster({ cls: S_MIMIC, mx: x, my: y }),
                        TOUCHSTONE_OTYP);

        [x, y] = niche(4);
        splev_object_at({ otyp: WORTHLESS_RED_OTYP }, x, y);
        splev_object_at({ otyp: RUBY_OTYP }, x, y);
        // mksobj_init's GEM_CLASS arm curses a LOADSTONE and draws no rn2(6).
        splev_object_at({ otyp: LOADSTONE_OTYP }, x, y);

        [x, y] = niche(5);
        splev_object_at({ otyp: RUBY_OTYP }, x, y);
        splev_object_at({ otyp: WORTHLESS_RED_OTYP }, x, y);
        // buc="not-cursed" is create_object's curse_state 4 -> uncurse(); no RNG.
        // achievement=1 only records achieveo.mines_prize_oid, which this port
        // stubs out (monmove.js is_mines_prize).
        const luck = splev_object_at({ otyp: LUCKSTONE_OTYP }, x, y);
        if (luck) uncurse(luck);

        // Random objects: des.object("*") x7, des.object("(") x2, des.object() x3.
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
