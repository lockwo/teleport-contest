// levels/tower2.js - special level builder makemaz_tower2(), split out of js/sp_lev.js.
// sp_lev.js re-exports makemaz_tower2 so existing importers are unaffected; the
// shared special-level machinery still lives there and is imported below.

import { COLNO, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { CHEST, mksobj, mksobj_at, weight } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    AMULET_OF_LIFE_SAVING, AMULET_OF_STRANGULATION, CRYSTAL_PLATE_MAIL, SPE_CHARM_MONSTER,
    SPE_CLAIRVOYANCE, SPE_CONE_OF_COLD, SPE_CREATE_FAMILIAR, SPE_INVISIBILITY, SPE_POLYMORPH,
    SPE_STONE_TO_FLESH, S_DEMON, WATER_WALKING_BOOTS, bigrm_get_location_dry, flip_level,
    q_absx, q_absy, quest_create_monster, quest_create_monster_class, quest_create_object,
    quest_level_init_solidfill, quest_set_door, shuffle, tower1_load_map, tower_place_ladder,
    tower_wallification,
} from '../sp_lev.js';

// ════════════════════════════════════════════════════════════════════════
// Vlad's Tower middle stage (dat/tower2.lua).
//
// Tour order matters: tower3 is the branch level reached from Gehennom, tower2
// sits above it and tower1 on top.  All three share tower1's
// skeleton — nhlib shuffle(align), solidfill level_init, a fixed map with
// halign="half-left"/valign="center", then monsters/objects/traps in file
// order, wallification and flip_level_rnd.
// ════════════════════════════════════════════════════════════════════════

const TOWER2_MAP = [
    '  --- --- ---  ',
    '  |.| |.| |.|  ',
    '---S---S---S---',
    '|.S.........S.|',
    '---.------+----',
    '  |......|..|  ',
    '--------.------',
    '|.S......+..S.|',
    '---S---S---S---',
    '  |.| |.| |.|  ',
    '  --- --- ---  ',
].join('\n');

// C ref: sp_lev.c create_object with SP_OBJ_CONTAINER + a contents callback.
// mksobj_at(CHEST) (rnd(2) ident, olocked rn2(5), otrapped rn2(10), mkbox_cnts
// rn2(8) [+ each auto content]), then delete_contents (no RNG), then the
// callback's create_object: get_location(DRY) — a RANDOM location, so the
// retry loop runs — followed by mksobj for the item, which is then moved into
// the container.
function tower_chest_containing(mx, my, otyp) {
    const x = q_absx(mx), y = q_absy(my);
    const chest = mksobj_at(CHEST, x, y, true, true);
    if (chest) chest.cobj = null;                     // delete_contents
    bigrm_get_location_dry();                         // get_location(DRY) loop
    const item = mksobj(otyp, true, true);
    if (chest && item) {
        if (!Array.isArray(chest.cobj)) chest.cobj = [];
        chest.cobj.push(item);
        chest.owt = weight(chest);
    }
    return chest;
}

// Main executor.  C ref: makemaz("tower2") -> load_special.
export async function makemaz_tower2() {
    const g = game;
    shuffle(['law', 'neutral', 'chaos']);            // nhlib.lua top level
    quest_level_init_solidfill();                    // splev_initlev rn2(2)
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
    }
    tower1_load_map(TOWER2_MAP, false);              // 15x11, half-left/center

    // local place = { 10 niches }; shuffle(place) — rn2(10)..rn2(2).
    const place = [[3, 1], [7, 1], [11, 1], [1, 3], [13, 3],
                   [1, 7], [13, 7], [3, 9], [7, 9], [11, 9]];
    shuffle(place);

    tower_place_ladder(11, 5, true);                 // des.ladder("up", 11,05)
    tower_place_ladder(3, 7, false);                 // des.ladder("down", 03,07)
    quest_set_door(10, 4, 'locked');
    quest_set_door(9, 7, 'locked');

    g._full_mon_gen = true;
    try {
        // des.monster("&", place[10]) / place[1] — mkclass(S_DEMON, G_NOGEN).
        quest_create_monster_class(S_DEMON, place[9][0], place[9][1]);
        quest_create_monster_class(S_DEMON, place[0][0], place[0][1]);
        quest_create_monster('hell hound pup', place[1][0], place[1][1], null);
        quest_create_monster('hell hound pup', place[2][0], place[2][1], null);
        quest_create_monster('winter wolf', place[3][0], place[3][1], null);
    } finally {
        g._full_mon_gen = false;
    }

    g._full_mon_gen = true;
    try {
        tower_chest_containing(place[4][0], place[4][1], AMULET_OF_LIFE_SAVING);
        tower_chest_containing(place[5][0], place[5][1], AMULET_OF_STRANGULATION);
        quest_create_object(WATER_WALKING_BOOTS, place[6][0], place[6][1], null, null);
        quest_create_object(CRYSTAL_PLATE_MAIL, place[7][0], place[7][1], null, null);
        // local spbooks = { 7 titles }; shuffle(spbooks) — rn2(7)..rn2(2).
        const spbooks = [SPE_INVISIBILITY, SPE_CONE_OF_COLD, SPE_CREATE_FAMILIAR,
                         SPE_CLAIRVOYANCE, SPE_CHARM_MONSTER, SPE_STONE_TO_FLESH,
                         SPE_POLYMORPH];
        shuffle(spbooks);
        quest_create_object(spbooks[0], place[8][0], place[8][1], null, null);
    } finally {
        g._full_mon_gen = false;
    }

    // des.non_diggable(selection.area(0,0,14,10)) — no RNG.
    tower_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
