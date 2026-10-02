// levels/val_filb.js — the Valkyrie quest lower "filler" level (dat/Val-filb.lua),
// used between the locate and goal levels when the quest branch needs an extra
// rung.  Structurally identical to val_fila.js (no des.map; both stairs land
// on a random square of the raw mkmap.c cave) but filled with lava instead of
// ice, and a heavier trap/monster load.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Val-filb")
// -> load_special("Val-filb.lua").  Loading nhlib.lua first runs the top-level
// shuffle(align) (rn2(3), rn2(2)) — never indexed here, but the draws still
// happen.  No levregion, so fixup_special() places nothing.  "noflip" means
// lspo_finalize_level's flip_level_rnd() draws nothing.

import { game } from '../gstate.js';
import { COLNO, FIRE_TRAP, LAVAPOOL, ROOM, ROWNO } from '../const.js';
import { S_ANT } from '../symbols.js';
import { mkmap } from '../mkmap.js';
import { bigrm_wallification, reset_xystart_size, shuffle } from '../sp_lev.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_object_rnd,
    quest_trap_random, quest_trap_typed_random,
} from './quest_common.js';
import { val_lvlfill_solid } from './val_loca.js';
import { val_random_stair } from './val_fila.js';

export async function makemaz_val_filb() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // sp_level_coder_init (sp_lev.c:6373) — no des.map ever runs on this
    // level, so gx/gy must stay at their default full-level bounds.
    reset_xystart_size();

    // des.level_init({ style="solidfill", fg="L" }) — rn2(2) + fill LAVAPOOL
    // (force-lit by set_levltyp_lit's IS_LAVA branch regardless of the coin).
    val_lvlfill_solid(LAVAPOOL);

    // des.level_flags("mazelevel","icedpools","noflip") — no hardfloor.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;

    // des.level_init({ style="mines", fg=".", bg="L", smoothed=true,
    //                  joined=true, lit=1, walled=false }).
    await mkmap({
        bg: LAVAPOOL, fg: ROOM, smoothed: true, joined: true,
        lit: 1, walled: false, icedpools: true,
    });

    // des.stair("up") / des.stair("down") — random ROOM/CORR/ICE squares.
    val_random_stair(true);
    val_random_stair(false);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.object() x11 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 11; i++) quest_object_rnd();

        // des.monster("fire ant") x3 — named, random spot, no peaceful key.
        for (let i = 0; i < 3; i++) quest_monster_named_rnd('fire ant', null);
        // des.monster("a") — bare single-char CLASS letter, random spot.
        quest_monster_class_rnd(S_ANT, null);
        // des.monster({ id = "fire giant", peaceful = 0 }) x3
        for (let i = 0; i < 3; i++) quest_monster_named_rnd('fire giant', 0);

        // des.trap("fire") x5 — fixed type at a random DRY spot.
        for (let i = 0; i < 5; i++) await quest_trap_typed_random(FIRE_TRAP);
        // des.trap() x2 — fully random type and spot.
        for (let i = 0; i < 2; i++) await quest_trap_random();
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // lspo_finalize_level: link_doors_rooms() is a no-op (no doors placed)
    // then wallification(1,0,COLNO-1,ROWNO-1).  "noflip" means
    // flip_level_rnd() draws nothing, so finalize stops here.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
}
