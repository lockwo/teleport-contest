// levels/hea_goal.js - special level builder makemaz_hea_goal() (dat/Hea-goal.lua).

import { COLNO, FIRE_TRAP, POOL, ROOM, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { WAN_LIGHTNING } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, quest_create_object,
    quest_place_stair, reset_xystart_size, splev_region_lit, vly_non_diggable,
    vly_object,
} from '../sp_lev.js';
import { quest_align_shuffle, quest_monster } from './quest_home_common.js';
import { quest_named_object_at } from './quest_common.js';
import { mkmap_mines, pri_create_trap } from './pri_loca.js';

// ════════════════════════════════════════════════════════════════════════
// Healer quest "goal" level (dat/Hea-goal.lua) — the Cyclops guarding the
// Staff of Aesculapius in a joined mines cavern.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Hea-goal") ->
// load_special("Hea-goal.lua").  nhlib.lua's top-level shuffle(align)
// (rn2(3), rn2(2)) runs first, then the des.* program in file order.
// ════════════════════════════════════════════════════════════════════════

// C ref: monsym.h S_* class indices (def_char_to_monclass()).
const S_RODENT = 18, S_EEL = 57, S_DRAGON = 30, S_SPIDER = 19;
const QUARTERSTAFF = 79;

const HEA_GOAL_MAP = [
    '.P....................................PP.',
    'PP.......PPPPPPP....PPPPPPP....PPPP...PP.',
    '...PPPPPPP....PPPPPPP.....PPPPPP..PPP...P',
    '...PP..............................PPP...',
    '..PP..............................PP.....',
    '..PP..............................PPP....',
    '..PPP..............................PP....',
    '.PPP..............................PPPP...',
    '...PP............................PPP...PP',
    '..PPPP...PPPPP..PPPP...PPPPP.....PP...PP.',
    'P....PPPPP...PPPP..PPPPP...PPPPPPP...PP..',
    'PPP..................................PPP.',
].join('\n');

export async function makemaz_hea_goal() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)

    // des.level_init({ style="solidfill", fg="P" }) — one rn2(2); the fill
    // itself is wholesale overwritten by the mines init below.
    rn2(2);                                              // sp_lev.c:2992

    // des.level_flags("mazelevel") — no hardfloor, no noflip.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;

    // des.level_init({ style="mines", fg=".", bg="P", smoothed=false,
    //                  joined=true, lit=1, walled=false })
    mkmap_mines(POOL, ROOM, false, true, 1, false);

    // des.map([[...]]) — 41x12, SPLEV_CENTER.  Bare string => lit = FALSE.
    bigrm_load_map(HEA_GOAL_MAP, false);

    // des.region(selection.area(0,0,40,11), "lit") — 2-arg form: no room,
    // no RNG.
    splev_region_lit(0, 0, 40, 11, 1);

    // des.stair("up", 39,10) — no down stairs; this is the quest's last level.
    quest_place_stair(39, 10, true);

    // des.non_diggable(selection.area(0,0,40,11)) — no RNG.
    vly_non_diggable(0, 0, 40, 11);

    g._quest_gen = true;
    g._full_mon_gen = true;
    if (g.level) g.level._splev_fullmon = true;
    try {
        // des.object({id="quarterstaff", x=20,y=06, buc="blessed", spe=0,
        //             name="The Staff of Aesculapius"}) — a `name` is given,
        // so mksobj_at passes artif=FALSE; no "eroded" key, unlike Pri-goal's
        // Mitre, so oerodeproof is left unset.
        quest_named_object_at(QUARTERSTAFF, 20, 6,
                              { spe: 0, buc: 'blessed', name: 'The Staff of Aesculapius' });

        // des.object("wand of lightning", 20, 06) — plain id, explicit coord.
        quest_create_object(WAN_LIGHTNING, 20, 6, null, null);

        // 13 x des.object() — fully random class at a random DRY square.
        for (let i = 0; i < 13; i++) vly_object({});

        // 6 x des.trap("fire")/des.trap() — hardfloor is NOT set on this
        // level, so pri_create_trap's Can_fall_thru() check leaves any
        // hole/trapdoor roll alone (same as Pri-goal).
        for (let i = 0; i < 4; i++) await pri_create_trap(FIRE_TRAP, null, null);
        for (let i = 0; i < 2; i++) await pri_create_trap(0, null, null);

        // des.monster({id="Cyclops", x=20,y=06, peaceful=0}) — explicit coord.
        quest_monster({ name: 'Cyclops', mx: 20, my: 6, peaceful: 0 });
        for (let i = 0; i < 3; i++) quest_monster({ name: 'rabid rat' });
        for (let i = 0; i < 2; i++) quest_monster({ cls: S_RODENT, peaceful: 0 });
        for (let i = 0; i < 6; i++) quest_monster({ name: 'giant eel' });
        for (let i = 0; i < 2; i++) quest_monster({ name: 'electric eel' });
        for (let i = 0; i < 2; i++) quest_monster({ name: 'shark' });
        quest_monster({ cls: S_EEL, peaceful: 0 });
        for (let i = 0; i < 5; i++) quest_monster({ cls: S_DRAGON, peaceful: 0 });
        for (let i = 0; i < 10; i++) quest_monster({ cls: S_SPIDER, peaceful: 0 });
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // lspo_finalize_level: wallification, then flip_level_rnd(3, FALSE) —
    // one rn2(2) per axis (no "noflip" on this level).
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                                 // sp_lev.c:975
    if (rn2(2)) flp |= 2;                                 // sp_lev.c:977
    if (flp) flip_level(flp);
}
