// levels/arc_goal.js — the Archeologist quest "goal" level (dat/Arc-goal.lua),
// the concentric tomb where the Minion of Huhetotl guards the Orb of Detection.
// sp_lev.js re-exports makemaz_arc_goal.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Arc-goal")
// -> load_special("Arc-goal.lua").  nhlib.lua's shuffle(align) (rn2(3),rn2(2))
// runs first — this level does not index the table, but the draws still happen;
// level_init solidfill draws one rn2(2); then the des.* program runs in file
// order.  No levregion, so fixup_special() places nothing.

import { COLNO, ROLLING_BOULDER_TRAP, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { CRYSTAL_BALL } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    ARC_S_MUMMY, ARC_S_SNAKE, TEMPLE_RTYPE, bigrm_load_map, bigrm_wallification,
    flip_level, quest_create_monster, quest_level_init_solidfill, quest_place_stair,
    quest_region_light, shuffle, splev_link_doors_rooms, vly_altar, vly_non_diggable,
    vly_region,
} from '../sp_lev.js';
import {
    QUEST_ALIGN_AMASK, quest_monster_class_rnd, quest_monster_named_rnd,
    quest_named_object_at, quest_object_rnd, quest_trap_random, quest_trap_typed_at,
} from './quest_common.js';

// C ref: sp_lev.c lspo_region "filled" — 2 means "set the level flags only".
const FILL_LVLFLAGS_ONLY = 2;

const ARC_GOAL_MAP = [
    '                                                                            ',
    '                                  ---------                                 ',
    '                                  |..|.|..|                                 ',
    '                       -----------|..S.S..|-----------                      ',
    '                       |.|........|+-|.|-+|........|.|                      ',
    '                       |.S........S..|.|..S........S.|                      ',
    '                       |.|........|..|.|..|........|.|                      ',
    '                    ------------------+------------------                   ',
    '                    |..|..........|.......|..........|..|                   ',
    '                    |..|..........+.......|..........S..|                   ',
    '                    |..S..........|.......+..........|..|                   ',
    '                    |..|..........|.......|..........|..|                   ',
    '                    ------------------+------------------                   ',
    '                       |.|........|..|.|..|........|.|                      ',
    '                       |.S........S..|.|..S........S.|                      ',
    '                       |.|........|+-|.|-+|........|.|                      ',
    '                       -----------|..S.S..|-----------                      ',
    '                                  |..|.|..|                                 ',
    '                                  ---------                                 ',
    '                                                                            ',
].join('\n');

export async function makemaz_arc_goal() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    quest_level_init_solidfill();
    // des.level_flags("mazelevel") — no RNG, and no "noflip".
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).
    bigrm_load_map(ARC_GOAL_MAP, false);

    // des.region(...) — the whole level lit, then the nested chambers.  Only the
    // last one is a room (a temple); every other region is a rectangular OROOM,
    // which C handles with light_region() alone (no room, no RNG).
    quest_region_light(0, 0, 75, 19, true);
    quest_region_light(35, 2, 36, 3, false);
    quest_region_light(40, 2, 41, 3, false);
    quest_region_light(24, 4, 24, 6, false);
    quest_region_light(26, 4, 33, 6, true);
    quest_region_light(38, 2, 38, 6, false);
    quest_region_light(43, 4, 50, 6, true);
    quest_region_light(52, 4, 52, 6, false);
    quest_region_light(35, 5, 36, 6, false);
    quest_region_light(40, 5, 41, 6, false);
    quest_region_light(21, 8, 22, 11, false);
    quest_region_light(24, 8, 33, 11, true);
    quest_region_light(35, 8, 41, 11, false);
    quest_region_light(43, 8, 52, 11, true);
    quest_region_light(54, 8, 55, 11, false);
    quest_region_light(24, 13, 24, 15, false);
    quest_region_light(26, 13, 33, 15, false);
    quest_region_light(35, 13, 36, 14, false);
    quest_region_light(35, 16, 36, 17, false);
    quest_region_light(38, 13, 38, 17, false);
    quest_region_light(40, 13, 41, 14, false);
    quest_region_light(40, 16, 41, 17, false);
    vly_region(43, 13, 50, 15, 0, TEMPLE_RTYPE, FILL_LVLFLAGS_ONLY, false);
    quest_region_light(52, 13, 52, 15, false);

    // des.stair("up", 38,10) — no down stair: bottom of the quest branch.
    quest_place_stair(38, 10, true);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.non_diggable(selection.area(00,00,75,19)) — no RNG.
        vly_non_diggable(0, 0, 75, 19);
        // des.altar({x=50,y=14,align="chaos",type="altar"}) — the altar of
        // Huhetotl.  A literal alignment, so no rn2; shrine==0, so no priest.
        vly_altar(50, 14, QUEST_ALIGN_AMASK.chaos, 0);
        // des.object({id="crystal ball", x=50,y=14, buc="blessed", spe=5,
        //             name="The Orb of Detection"}) — the quest artifact.
        quest_named_object_at(CRYSTAL_BALL, 50, 14,
                              { spe: 5, buc: 'blessed', name: 'The Orb of Detection' });
        // des.object() x14 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 14; i++) quest_object_rnd();
        // des.trap() x6 — random type at a random DRY spot.
        for (let i = 0; i < 6; i++) await quest_trap_random();
        // des.trap("rolling boulder",46,14) — fixed type + fixed coord: the
        // launch-coord rolls plus the mktrap victim rnd(4), no get_location.
        await quest_trap_typed_at(ROLLING_BOULDER_TRAP, 46, 14);
        // des.monster("Minion of Huhetotl", 50, 14) — the nemesis, on the altar.
        // The 3-arg string form carries no `peaceful` key, so makemon's own
        // answer stands (hostile: the minion is never peaceful).
        quest_create_monster('Minion of Huhetotl', 50, 14, null);
        // des.monster("S") x18 / "human mummy" x8 / "M" — random locations, no
        // `peaceful` field (makemon's own answer stands).
        for (let i = 0; i < 18; i++) quest_monster_class_rnd(ARC_S_SNAKE, null);
        for (let i = 0; i < 8; i++) quest_monster_named_rnd('human mummy', null);
        quest_monster_class_rnd(ARC_S_MUMMY, null);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level -> link_doors_rooms() then
    // wallification(1,0,COLNO-1,ROWNO-1) then flip_level_rnd(3, FALSE).
    splev_link_doors_rooms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
