// levels/sam_fila.js — the Samurai quest filler level "a" (dat/Sam-fila.lua),
// used for quest-branch levels between Sam-strt and the locate level
// (Sam-loca).  A "mines"-style cave whose background typ is POOL rather than
// STONE (fg=".", bg="P"): the cave floor is carved out of a lake instead of
// solid rock.  `lit` is NOT given explicitly in the .lua, so it draws
// litstate_rnd()'s RNG — unlike the already-landed Bar-fila/Bar-filb
// (mklev.js), which both pass an explicit lit=0.
//
// C ref: mklev.c makelevel() -> In_quest(&u.uz) branch -> makemaz("Sam-fila")
// -> load_special("Sam-fila.lua").

import { COLNO, POOL, ROOM, ROWNO, STONE } from '../const.js';
import { game } from '../gstate.js';
import { bigrm_wallification, reset_xystart_size, shuffle } from '../sp_lev.js';
import { quest_level_init_fill } from './quest_home_common.js';
import { sam_mkmap, sam_stair } from './sam_common.js';
import { S_DOG } from '../symbols.js';
import { quest_monster_class_rnd, quest_monster_named_rnd, quest_object_rnd,
         quest_trap_random } from './quest_common.js';

export async function makemaz_sam_fila() {
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
    // des.level_init({ style="mines", fg=".", bg="P", smoothed=true,
    //                  joined=true, walled=true }) — no explicit lit=, so
    // litstate_rnd() draws; walled&&join makes the level cavernous afterward.
    sam_mkmap({ bg_typ: POOL, fg_typ: ROOM, smooth: true, join: true, walled: true });

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.stair("up"); des.stair("down") — random ROOM/CORR/ICE spot.
        sam_stair(true);
        sam_stair(false);
        // des.object() x9 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 9; i++) quest_object_rnd();
        // des.monster("d") / des.monster("wolf") x5 / des.monster("stalker")
        // — all at a random location, no `peaceful` field.
        quest_monster_class_rnd(S_DOG, null);
        for (let i = 0; i < 5; i++) quest_monster_named_rnd('wolf', null);
        quest_monster_named_rnd('stalker', null);
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

