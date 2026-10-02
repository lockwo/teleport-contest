// levels/kni_filb.js — the Knight quest lower "filler" level (dat/Kni-filb.lua),
// used between the locate and goal levels when the quest branch needs an
// extra rung.  Structurally identical to kni_fila.js (no des.map; both stairs
// land on a random square of the raw mkmap.c swamp cave), just with a heavier
// object/monster load.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Kni-filb")
// -> load_special("Kni-filb.lua").  Loading nhlib.lua first runs the top-level
// shuffle(align) (rn2(3), rn2(2)) — never indexed here, but the draws still
// happen.  No levregion, so fixup_special() places nothing.  "noflip" means
// lspo_finalize_level's flip_level_rnd() draws nothing.

import { game } from '../gstate.js';
import { COLNO, POOL, ROOM, ROWNO } from '../const.js';
import { S_IMP } from '../symbols.js';
import { mkmap } from '../mkmap.js';
import { bigrm_wallification, reset_xystart_size, shuffle } from '../sp_lev.js';
import { quest_level_init_fill } from './quest_home_common.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_object_rnd,
    quest_trap_random,
} from './quest_common.js';
import { kni_random_stair } from './kni_fila.js';

export async function makemaz_kni_filb() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // sp_level_coder_init (sp_lev.c:6373) — no des.map ever runs on this
    // level, so gx/gy must stay at their default full-level bounds.
    reset_xystart_size();

    // des.level_init({ style="solidfill", fg="." }) — rn2(2) + fill ROOM
    // (`filling` defaults to `fg`, so this is floor, not stone).
    quest_level_init_fill(ROOM);

    // des.level_flags("mazelevel","noflip") — no hardfloor.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;

    // des.level_init({ style="mines", fg=".", bg="P", smoothed=false,
    //                  joined=true, lit=1, walled=false }).
    await mkmap({
        bg: POOL, fg: ROOM, smoothed: false, joined: true, lit: 1, walled: false,
    });

    // des.stair("up") / des.stair("down") — random ROOM/CORR/ICE squares.
    kni_random_stair(true);
    kni_random_stair(false);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.object() x11 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 11; i++) quest_object_rnd();

        // des.monster({ id = "quasit", peaceful=0 }) x4
        for (let i = 0; i < 4; i++) quest_monster_named_rnd('quasit', false);
        // des.monster({ class = "i", peaceful=0 })
        quest_monster_class_rnd(S_IMP, false);
        // des.monster({ id = "ochre jelly", peaceful=0 }) x3
        for (let i = 0; i < 3; i++) quest_monster_named_rnd('ochre jelly', false);

        // des.trap() x4 — fully random type and spot.
        for (let i = 0; i < 4; i++) await quest_trap_random();
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // lspo_finalize_level: link_doors_rooms() is a no-op (no doors placed)
    // then wallification(1,0,COLNO-1,ROWNO-1).  "noflip" means
    // flip_level_rnd() draws nothing, so finalize stops here.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
}
