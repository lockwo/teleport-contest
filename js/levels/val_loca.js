// levels/val_loca.js — the Valkyrie quest "locate" level (dat/Val-loca.lua),
// a fire-ant/fire-giant warren carved into an icy mines cavern.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Val-loca")
// -> load_special("Val-loca.lua").  Loading nhlib.lua first runs the top-level
// shuffle(align) (rn2(3), rn2(2)) — this level never indexes that table, but
// the draws still happen (same as Arc-goal).  No levregion is registered, so
// fixup_special() places nothing.
//
// Unlike Arc-loca/Pri-loca (a bare STONE solidfill under their des.map), this
// level's SECOND level_init runs the real mkmap.c cellular-automaton cave
// generator (style="mines", fg=".", bg="I", smoothed=true, joined=false) over
// the whole level BEFORE des.map draws its 40x13 room on top; des.map's "x"
// cells (MAX_TYPE) are a deliberate no-op that leaves the generated ice cave
// showing outside the room, which is why the up/down stairs (48,14 / 20,06)
// sit outside the 0..39 map footprint the des.region/non_diggable calls cover.

import { game } from '../gstate.js';
import { COLNO, FIRE_TRAP, ICE, ROOM, ROWNO, STONE } from '../const.js';
import { S_ANT, S_GIANT } from '../symbols.js';
import { mkmap } from '../mkmap.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, quest_place_stair, quest_region_light,
    set_levltyp_lit, shuffle, vly_non_diggable,
} from '../sp_lev.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_object_rnd,
    quest_trap_random, quest_trap_typed_random,
} from './quest_common.js';

// C ref: sp_lev.c lvlfill_solid(filling, lit) — level_init style="solidfill".
// `filling` defaults to `fg` (lspo_level_init, sp_lev.c:3862), so a level whose
// fg isn't " " (Val-goal/fila/filb all use "I"/"L") fills with something other
// than STONE.  Goes through set_levltyp_lit() so an IS_LAVA filling is
// force-lit regardless of the coin flip — quest_home_common.js's
// quest_level_init_fill() (built for val_strt.js's fg="I" case) skips that
// branch, so it would under-light Val-goal/Val-filb's fg="L" solidfill.
// Exported for val_goal.js/val_fila.js/val_filb.js to reuse.
export function val_lvlfill_solid(filling) {
    const lit = rn2(2);                        // BOOL_RANDOM -> sp_lev.c:2992
    const xmax = (COLNO - 1) & ~1, ymax = (ROWNO - 1) & ~1;
    for (let x = 2; x <= xmax; x++)
        for (let y = 0; y <= ymax; y++) {
            if (!set_levltyp_lit(x, y, filling, lit)) continue;
            const loc = game.level?.at(x, y);
            if (loc) { loc.flags = 0; loc.horizontal = false; loc.roomno = 0; loc.edge = false; }
        }
}

const VAL_LOCA_MAP = [
    'PPPPxxxx                      xxxxPPPPPx',
    'PLPxxx                          xPPLLLPP',
    'PPP    .......................    PPPLLP',
    'xx   ............................   PPPP',
    'x  ...............................  xxxx',
    '  .................................   xx',
    '....................................   x',
    '  ...................................   ',
    'x  ..................................  x',
    'xx   ..............................   PP',
    'xPPP  ..........................     PLP',
    'xPLLP                             xxPLLP',
    'xPPPPxx                         xxxxPPPP',
].join('\n');

export async function makemaz_val_loca() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);

    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    val_lvlfill_solid(STONE);

    // des.level_flags("mazelevel","hardfloor","icedpools","noflip") — no RNG.
    // "icedpools" is a coder-local flag consumed only by mkmap()'s finish_map
    // below (sp_lev.c:3009), not a persistent level.flags bit.  "noflip" zeroes
    // gc.coder->allow_flips, so lspo_finalize_level's flip_level_rnd() short-
    // circuits BOTH rn2(2) draws (sp_lev.c:975/977) — quest_finalize() below is
    // deliberately not called; the flip draws just never happen here.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.hardfloor = true;
    }

    // des.level_init({ style="mines", fg=".", bg="I", smoothed=true,
    //                  joined=false, lit=1, walled=false }) — the full mkmap.c
    // cave generator: litstate_rnd (no draw, lit is explicit), init_fill (RNG),
    // pass_one/two/three (no RNG), no join_map (joined=false), finish_map.
    await mkmap({
        bg: ICE, fg: ROOM, smoothed: true, joined: false,
        lit: 1, walled: false, icedpools: true,
    });

    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).  "x" cells
    // are MAX_TYPE and skip, leaving the mkmap() cave outside the room intact.
    bigrm_load_map(VAL_LOCA_MAP, false);

    // des.region(selection.area(00,00,39,12), "lit") — no RNG.
    quest_region_light(0, 0, 39, 12, true);

    // des.stair("up", 48,14) / des.stair("down", 20,06) — no RNG.  Both sit
    // outside the des.map footprint, on the raw mkmap() cave.
    quest_place_stair(48, 14, true);
    quest_place_stair(20, 6, false);

    // des.non_diggable(selection.area(00,00,39,12)) — no RNG.
    vly_non_diggable(0, 0, 39, 12);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.object() x15 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 15; i++) quest_object_rnd();

        // des.trap("fire") x4 — fixed type at a random DRY spot.
        for (let i = 0; i < 4; i++) await quest_trap_typed_random(FIRE_TRAP);
        // des.trap() x2 — fully random type and spot.
        for (let i = 0; i < 2; i++) await quest_trap_random();

        // des.monster("fire ant") x17 — named, random spot, no peaceful key.
        for (let i = 0; i < 17; i++) quest_monster_named_rnd('fire ant', null);
        // des.monster("a") — a bare single-char string is a CLASS letter.
        quest_monster_class_rnd(S_ANT, null);
        // des.monster({ class = "H", peaceful = 0 })
        quest_monster_class_rnd(S_GIANT, 0);
        // des.monster({ id = "fire giant", peaceful = 0 }) x7
        for (let i = 0; i < 7; i++) quest_monster_named_rnd('fire giant', 0);
        // des.monster({ class = "H", peaceful = 0 })
        quest_monster_class_rnd(S_GIANT, 0);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // lspo_finalize_level: link_doors_rooms() is a no-op (this level places no
    // des.door()s) then wallification(1,0,COLNO-1,ROWNO-1).  "noflip" means
    // flip_level_rnd() draws nothing (see above), so finalize stops here.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
}
