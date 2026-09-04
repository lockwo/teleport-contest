// levels/sam_filb.js — the Samurai quest filler level "b" (dat/Sam-filb.lua),
// used for quest-branch levels at/after the locate level (Sam-loca).  Unlike
// every other role's "-filb" (all mines-cave, ported inside mklev.js's
// QUEST_FILLERS table) or Bar-filb (a mines cave, mklev.js-private), this one
// is a plain symmetric two-winged des.map() level — closer in shape to
// Sam-strt than to any filler.  Its stairs/objects/monsters/traps are all
// placed RANDOMLY though (no explicit coordinates), which is why it needs
// sam_common.js's random-position des.stair() just like Sam-fila does.
//
// C ref: mklev.c makelevel() -> In_quest(&u.uz) branch -> makemaz("Sam-filb")
// -> load_special("Sam-filb.lua").

import { COLNO, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, quest_region_light,
    quest_set_door, shuffle,
} from '../sp_lev.js';
import { sam_stair } from './sam_common.js';
import { S_DOG } from '../symbols.js';
import { quest_monster_class_rnd, quest_monster_named_rnd, quest_object_rnd,
         quest_trap_random } from './quest_common.js';

const SAM_FILB_MAP = [
    '-------------                                  -------------',
    '|...........|                                  |...........|',
    '|...-----...|----------------------------------|...-----...|',
    '|...|   |...|..................................|...|   |...|',
    '|...-----..........................................-----...|',
    '|...........|--S----------------------------S--|...........|',
    '----...--------.|..........................|.--------...----',
    '   |...|........+..........................+........|...|   ',
    '   |...|........+..........................+........|...|   ',
    '----...--------.|..........................|.--------...----',
    '|...........|--S----------------------------S--|...........|',
    '|...-----..........................................-----...|',
    '|...|   |...|..................................|...|   |...|',
    '|...-----...|----------------------------------|...-----...|',
    '|...........|                                  |...........|',
    '-------------                                  -------------',
].join('\n');

export async function makemaz_sam_filb() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style = "solidfill", fg = " " }) — rn2(2) + fill STONE.
    rn2(2);
    // des.level_flags("mazelevel") — no RNG, and no "noflip".
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).
    bigrm_load_map(SAM_FILB_MAP, false);
    // des.region(selection.area(00,00,59,15), "unlit") — no RNG.
    quest_region_light(0, 0, 59, 15, false);
    // des.door(...) x4 — explicit states, no RNG.
    quest_set_door(16, 7, 'closed');
    quest_set_door(16, 8, 'closed');
    quest_set_door(43, 7, 'closed');
    quest_set_door(43, 8, 'closed');

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.stair("up"); des.stair("down") — random ROOM/CORR/ICE spot
        // within the map's placement bounds.
        sam_stair(true);
        sam_stair(false);
        // des.object() x9 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 9; i++) quest_object_rnd();
        // des.monster("d") / des.monster("wolf") x4 / des.monster("stalker")
        // x3 — all at a random location, no `peaceful` field.
        quest_monster_class_rnd(S_DOG, null);
        for (let i = 0; i < 4; i++) quest_monster_named_rnd('wolf', null);
        for (let i = 0; i < 3; i++) quest_monster_named_rnd('stalker', null);
        // des.trap() x4 — random type at a random DRY spot.  No "hardfloor"
        // shortcut here: this level does NOT set hardfloor, and
        // quest_trap_random() reads the real Can_fall_thru() state.
        for (let i = 0; i < 4; i++) await quest_trap_random();
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level -> wallification(1,0,COLNO-1,ROWNO-1) then
    // flip_level_rnd(allow_flips=3, FALSE) — no "noflip" here, so both bits
    // roll.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
