// levels/bar_goal.js — the Barbarian quest "goal" level (dat/Bar-goal.lua),
// the cavern lair of Thoth Amon.  sp_lev.js re-exports makemaz_bar_goal.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Bar-goal")
// -> load_special("Bar-goal.lua").  Same splev engine as Bar-strt/Bar-loca:
// loading nhlib.lua first runs shuffle(align) (rn2(3),rn2(2)); level_init
// solidfill draws one rn2(2); then the des.* program runs in file order.
// The level registers no levregion, so fixup_special() places nothing and
// (unlike Bar-strt) there is no quest_place_branch() finalize step.

import { COLNO, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { LUCKSTONE } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, quest_create_monster,
    quest_level_init_solidfill, quest_place_stair, quest_region_light, quest_set_door,
    shuffle, vly_altar, vly_non_diggable,
} from '../sp_lev.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_named_object_at,
    quest_noncoaligned_amask, quest_object_rnd, quest_trap_random,
} from './quest_common.js';

// C ref: defsym.h MONSYM() — 'O' = S_OGRE, 'T' = S_TROLL.
const S_OGRE = 41, S_TROLL = 46;

const BAR_GOAL_MAP = [
    '                                                                            ',
    '                               .............                                ',
    '                             ..................                             ',
    '        ....              .........................          ....           ',
    '      .......          ..........................           .......         ',
    '      ......             ........................          .......          ',
    '      ..  ......................................             ..             ',
    '       ..                 .....................             ..              ',
    '        ..                 ..................              ..               ',
    '         ..         ..S...S..............   ................                ',
    '          ..                   ........                ...                  ',
    '       .........                                         ..                 ',
    '       ......  ..                                         ...  ....         ',
    '      .. ...    ..                             ......       ........        ',
    '   ....          .. ..................        ........       ......         ',
    '  ......          ......................       ......         ..            ',
    '   ....             ..................              ...........             ',
    '                      ..............                                        ',
    '                        ...........                                         ',
    '                                                                            ',
].join('\n');

export async function makemaz_bar_goal() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    quest_level_init_solidfill();
    // des.level_flags("mazelevel") — no RNG.  No "noflip", so flip_level_rnd
    // below still draws its two rn2(2).
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    // des.map([[...]]) — bare string form, so lit is FALSE and no rn2(2).
    bigrm_load_map(BAR_GOAL_MAP, false);
    // des.region(selection.area(00,00,75,19), "unlit") — no RNG.
    quest_region_light(0, 0, 75, 19, false);
    // des.door("locked", ...) x2 — the two secret doors of the inner cave.
    quest_set_door(22, 9, 'locked');
    quest_set_door(26, 9, 'locked');
    // des.stair("up", 36,05) — no down stair: this is the bottom of the quest.
    quest_place_stair(36, 5, true);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.altar({x=63,y=04,align="noncoaligned",type="altar"}) — the
        // noncoaligned alignment costs one rn2(2); type="altar" means shrine==0,
        // so no priest is created and nothing else is drawn.
        vly_altar(63, 4, quest_noncoaligned_amask(), 0);
        // des.non_diggable(selection.area(00,00,75,19)) — no RNG.
        vly_non_diggable(0, 0, 75, 19);
        // des.object({id="luckstone", x=63,y=04, buc="blessed", spe=0,
        //             name="The Heart of Ahriman"}) — the quest artifact.
        quest_named_object_at(LUCKSTONE, 63, 4,
                              { spe: 0, buc: 'blessed', name: 'The Heart of Ahriman' });
        // des.object() x14 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 14; i++) quest_object_rnd();
        // des.trap() x6 — random type at a random DRY spot.
        for (let i = 0; i < 6; i++) await quest_trap_random();
        // des.monster({id="Thoth Amon", x=63,y=04, peaceful=0}) — the nemesis,
        // standing on his altar.
        quest_create_monster('Thoth Amon', 63, 4, false);
        // The Black Horde: 16 ogres, 2 random ogre-class, 8 rock trolls and a
        // random troll-class, all at random DRY spots and all forced hostile.
        for (let i = 0; i < 16; i++) quest_monster_named_rnd('ogre', false);
        for (let i = 0; i < 2; i++) quest_monster_class_rnd(S_OGRE, false);
        for (let i = 0; i < 8; i++) quest_monster_named_rnd('rock troll', false);
        quest_monster_class_rnd(S_TROLL, false);
        // des.wallify() — explicit, and RNG-free; the finalize pass below
        // repeats it over the same area.
        bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level -> wallification(1,0,COLNO-1,ROWNO-1) then
    // flip_level_rnd(allow_flips=3, FALSE): one rn2(2) per enabled axis.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
