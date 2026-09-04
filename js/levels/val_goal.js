// levels/val_goal.js — the Valkyrie quest "goal" level (dat/Val-goal.lua),
// Lord Surtur's fire-giant fortress guarding the Orb of Fate, ringed by lava.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Val-goal")
// -> load_special("Val-goal.lua").  Loading nhlib.lua first runs the top-level
// shuffle(align) (rn2(3), rn2(2)) — never indexed here, but the draws still
// happen.  No levregion, so fixup_special() places nothing.  No "hardfloor"
// and no "noflip" this time (unlike loca/fila/filb), so trap holes stay holes
// and lspo_finalize_level's flip_level_rnd() draws both rn2(2)s.

import { game } from '../gstate.js';
import {
    COLNO, DB_NORTH, DB_SOUTH, FIRE_TRAP, LAVAPOOL, ROOM, ROWNO, SQKY_BOARD,
} from '../const.js';
import { S_ANT, S_GIANT } from '../symbols.js';
import { CRYSTAL_BALL } from '../mkobj.js';
import { create_drawbridge } from '../dbridge.js';
import { mkmap } from '../mkmap.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, percent, q_absx, q_absy,
    quest_create_monster, quest_place_stair, quest_region_light,
    quest_replace_terrain, shuffle, vly_non_diggable,
} from '../sp_lev.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_named_object_at,
    quest_object_rnd, quest_trap_random, quest_trap_typed_at,
    quest_trap_typed_random,
} from './quest_common.js';
import { val_lvlfill_solid } from './val_loca.js';

const VAL_GOAL_MAP = [
    'xxxxxx.....................xxxxxxxx',
    'xxxxx.......LLLLL.LLLLL......xxxxxx',
    'xxxx......LLLLLLLLLLLLLLL......xxxx',
    'xxxx.....LLL|---------|LLL.....xxxx',
    'xxxx....LL|--.........--|LL.....xxx',
    'x......LL|-...LLLLLLL...-|LL.....xx',
    '.......LL|...LL.....LL...|LL......x',
    '......LL|-..LL.......LL..-|LL......',
    '......LL|.................|LL......',
    '......LL|-..LL.......LL..-|LL......',
    '.......LL|...LL.....LL...|LL.......',
    'xx.....LL|-...LLLLLLL...-|LL......x',
    'xxx.....LL|--.........--|LL.....xxx',
    'xxxx.....LLL|---------|LLL...xxxxxx',
    'xxxxx.....LLLLLLLLLLLLLLL...xxxxxxx',
    'xxxxxx......LLLLL.LLLLL.....xxxxxxx',
    'xxxxxxxxx..................xxxxxxxx',
].join('\n');

// C ref: sp_lev.c lspo_drawbridge() — the location is always explicit here
// (no RNG), so the only draw is state="random"'s !rn2(2); "open"/"closed"
// literals draw nothing.
function val_goal_drawbridge(mx, my, dir, state) {
    const open = state === 'random' ? !rn2(2) : (state === 'open');
    create_drawbridge(q_absx(mx), q_absy(my), dir, open);
}

export async function makemaz_val_goal() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);

    // des.level_init({ style="solidfill", fg="L" }) — rn2(2) + fill LAVAPOOL
    // (force-lit by set_levltyp_lit's IS_LAVA branch regardless of the coin).
    val_lvlfill_solid(LAVAPOOL);

    // des.level_flags("mazelevel", "icedpools") — no hardfloor, no noflip.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;

    // des.level_init({ style="mines", fg=".", bg="L", smoothed=true,
    //                  joined=true, lit=1, walled=false }).
    await mkmap({
        bg: LAVAPOOL, fg: ROOM, smoothed: true, joined: true,
        lit: 1, walled: false, icedpools: true,
    });

    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).
    bigrm_load_map(VAL_GOAL_MAP, false);

    // des.region(selection.area(00,00,34,16), "lit") — no RNG.
    quest_region_light(0, 0, 34, 16, true);

    // des.replace_terrain({region={44,09,46,11}, fromterrain='L',
    //                       toterrain='.', chance=50}) — one rn2(100) per
    // matching (lava) square in the rect, even though the up stair sits
    // outside the des.map footprint on the raw mkmap() cave.
    quest_replace_terrain(44, 9, 46, 11, LAVAPOOL, ROOM, 50);
    // des.stair("up", 45,10) — no down stair: bottom of the quest branch.
    quest_place_stair(45, 10, true);

    // des.non_diggable(selection.area(00,00,34,16)) — no RNG.
    vly_non_diggable(0, 0, 34, 16);

    // Drawbridges; northern one opens from the south (portcullis) to further
    // north (lowered span), southern one from the north to further south.
    val_goal_drawbridge(17, 2, DB_SOUTH, 'random');
    if (percent(75)) {
        val_goal_drawbridge(17, 14, DB_NORTH, 'open');
    } else {
        val_goal_drawbridge(17, 14, DB_NORTH, 'random');
    }

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.object({id="crystal ball", x=17,y=08, buc="blessed", spe=5,
        //             name="The Orb of Fate"}) — the quest artifact.
        quest_named_object_at(CRYSTAL_BALL, 17, 8,
                              { spe: 5, buc: 'blessed', name: 'The Orb of Fate' });
        // des.object() x14 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 14; i++) quest_object_rnd();

        // des.trap("board",13,08) / des.trap("board",21,08) — fixed coord.
        await quest_trap_typed_at(SQKY_BOARD, 13, 8);
        await quest_trap_typed_at(SQKY_BOARD, 21, 8);
        // des.trap("fire") x4 — fixed type at a random DRY spot.
        for (let i = 0; i < 4; i++) await quest_trap_typed_random(FIRE_TRAP);
        // des.trap("board") — fixed type at a random DRY spot.
        await quest_trap_typed_random(SQKY_BOARD);
        // des.trap() x2 — fully random type and spot.
        for (let i = 0; i < 2; i++) await quest_trap_random();

        // des.monster("Lord Surtur", 17, 08) — the nemesis, explicit coord,
        // no peaceful key (makemon's own hostile answer stands).
        quest_create_monster('Lord Surtur', 17, 8, null);
        // des.monster("fire ant") x4 — named, random spot.
        for (let i = 0; i < 4; i++) quest_monster_named_rnd('fire ant', null);
        // des.monster("a") x2 — bare single-char CLASS letter, random spot.
        quest_monster_class_rnd(S_ANT, null);
        quest_monster_class_rnd(S_ANT, null);
        // des.monster({id="fire giant", x=.., y=.., peaceful=0}) x10 — the two
        // flanking columns guarding Surtur's throne room.
        for (const gy of [6, 7, 8, 9, 10]) quest_create_monster('fire giant', 10, gy, 0);
        for (const gy of [6, 7, 8, 9, 10]) quest_create_monster('fire giant', 24, gy, 0);
        // des.monster({id="fire giant", peaceful=0}) x2 — random spot.
        for (let i = 0; i < 2; i++) quest_monster_named_rnd('fire giant', 0);
        // des.monster({class="H", peaceful=0}) — random spot.
        quest_monster_class_rnd(S_GIANT, 0);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // lspo_finalize_level: link_doors_rooms() is a no-op (this level places no
    // des.door()s) then wallification(1,0,COLNO-1,ROWNO-1), then
    // flip_level_rnd(3, FALSE) — no "noflip" here, so both rn2(2)s draw.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
