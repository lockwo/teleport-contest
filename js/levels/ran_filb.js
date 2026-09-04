// levels/ran_filb.js — the Ranger quest filler level "b" (dat/Ran-filb.lua),
// used for quest-branch levels at/after the locate level (Ran-loca).  A
// "mines"-style cave whose background AND foreground share the same STONE/ROOM
// pair as a plain mines level (fg=".", bg=" "): the cave is carved out of
// solid rock, unlike Ran-fila's forest.  `lit` is NOT given explicitly in the
// .lua, so it draws litstate_rnd()'s RNG.
//
// C ref: mklev.c makelevel() -> In_quest(&u.uz) branch -> makemaz("Ran-filb")
// -> load_special("Ran-filb.lua").

import { COLNO, ROOM, ROWNO, STONE } from '../const.js';
import { game } from '../gstate.js';
import { bigrm_wallification, reset_xystart_size, shuffle } from '../sp_lev.js';
import { quest_level_init_fill, S_CENTAUR } from './quest_home_common.js';
import { ran_mkmap, ran_stair } from './ran_common.js';
import { quest_monster_class_rnd, quest_monster_named_rnd, quest_object_rnd,
         quest_trap_random } from './quest_common.js';

export async function makemaz_ran_filb() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // sp_level_coder_init (sp_lev.c:6373) — this level has no des.map(), so
    // xstart/ystart/xsize/ysize stay at their whole-map reset default for
    // every des.* call below.
    reset_xystart_size();
    // des.level_init({ style = "solidfill", fg = " " }) — rn2(2) + fill STONE.
    quest_level_init_fill(STONE);
    // des.level_flags("mazelevel", "noflip") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noflip = true;
    }
    // des.level_init({ style="mines", fg=".", bg=" ", smoothed=true,
    //                  joined=true, walled=true }) — no explicit lit=, so
    // litstate_rnd() draws; walled&&join makes the level cavernous afterward.
    ran_mkmap({ bg_typ: STONE, fg_typ: ROOM, smooth: true, join: true, walled: true });

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.stair("up"); des.stair("down") — random ROOM/CORR/ICE spot.
        ran_stair(true);
        ran_stair(false);
        // des.object() x11 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 11; i++) quest_object_rnd();
        // des.monster({id="mountain centaur",peaceful=0}) x4 — random position.
        for (let i = 0; i < 4; i++) quest_monster_named_rnd('mountain centaur', 0);
        // des.monster({class="C",peaceful=0}) — random S_CENTAUR species.
        quest_monster_class_rnd(S_CENTAUR, 0);
        // des.monster({id="scorpion",peaceful=0}) x2 — random position.
        for (let i = 0; i < 2; i++) quest_monster_named_rnd('scorpion', 0);
        // des.trap() x4 — random type at a random DRY spot.  No "hardfloor"
        // shortcut here: this level does NOT set hardfloor, and
        // quest_trap_random() reads the real Can_fall_thru() state.
        for (let i = 0; i < 4; i++) await quest_trap_random();
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level -> wallification(1,0,COLNO-1,ROWNO-1).
    // "noflip" is set (des.level_flags above), so flip_level_rnd draws nothing
    // and is omitted entirely — matching every other noflip quest level here.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
}
