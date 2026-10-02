// levels/cav_filb.js - special level builder makemaz_cav_filb() (dat/Cav-filb.lua),
// the Caveman quest branch's second generic "filler" depth level.  Structurally
// identical to Cav-fila.lua (same level_init/level_flags/stair shape, just
// different object/trap/monster counts), so it reuses cav_fila.js's join-
// capable mkmap.c engine and random-stair helper rather than duplicating them.

import { COLNO, ROOM, ROWNO, STONE } from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import { bigrm_wallification, quest_level_init_solidfill, splev_link_doors_rooms } from '../sp_lev.js';
import { cav_stair_random, mkmap_mines_joined } from './cav_fila.js';
import { quest_align_shuffle } from './quest_home_common.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_object_rnd, quest_trap_random,
} from './quest_common.js';

// C ref: monsym.h — the one class letter this filler level rolls.
const S_HUMANOID = 8;

// ════════════════════════════════════════════════════════════════════════
// Caveman quest filler level "b" (dat/Cav-filb.lua).  Same C ref chain and
// the same solidfill-then-mines / noflip reasoning as makemaz_cav_fila() in
// cav_fila.js; see that file for the detailed commentary.
// ════════════════════════════════════════════════════════════════════════
export async function makemaz_cav_filb() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    quest_align_shuffle();

    // des.level_init({ style="solidfill", fg=" " }) — rn2(2); fully
    // overwritten by the mines init below.
    quest_level_init_solidfill();

    // des.level_flags("mazelevel", "noflip") — no RNG.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;

    // des.level_init({ style="mines", fg=".", bg=" ", smoothed=true,
    //                  joined=true, walled=true }) — lit unset -> one rn2(2)
    // (splev_initlev's LVLINIT_MINES arm) before mkmap() itself runs.
    const lit = rn2(2);
    mkmap_mines_joined(STONE, ROOM, true, true, lit, true);

    // des.stair("up") / des.stair("down") — both fully random.
    cav_stair_random(true);
    cav_stair_random(false);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.object() x12 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 12; i++) quest_object_rnd();
        // des.trap() x4 — random type at a random DRY spot.
        for (let i = 0; i < 4; i++) await quest_trap_random();
        // des.monster({id="bugbear",peaceful=0}) x4 / class="h" x2 / "hill giant" x2.
        for (let i = 0; i < 4; i++) quest_monster_named_rnd('bugbear', 0);
        for (let i = 0; i < 2; i++) quest_monster_class_rnd(S_HUMANOID, 0);
        for (let i = 0; i < 2; i++) quest_monster_named_rnd('hill giant', 0);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // lspo_finalize_level: link_doors_rooms() (no doors exist, so a no-op)
    // then wallification(1,0,COLNO-1,ROWNO-1) (corrmaze isn't set).  "noflip"
    // means neither of flip_level_rnd's two `flp & N` tests is true, so
    // neither rn2(2) is ever drawn.
    splev_link_doors_rooms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
}
