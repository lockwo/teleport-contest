// levels/kni_fila.js — the Knight quest upper "filler" level (dat/Kni-fila.lua),
// used between the start and locate levels when the quest branch needs an
// extra rung.  No des.map at all: the whole level is the raw mkmap.c swamp
// cave, and both stairs land on a random ROOM/CORR/ICE square of it.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Kni-fila")
// -> load_special("Kni-fila.lua").  Loading nhlib.lua first runs the top-level
// shuffle(align) (rn2(3), rn2(2)) — never indexed here, but the draws still
// happen.  No levregion, so fixup_special() places nothing.  "noflip" means
// lspo_finalize_level's flip_level_rnd() draws nothing.

import { game } from '../gstate.js';
import { COLNO, CORR, ICE, POOL, ROOM, ROWNO } from '../const.js';
import { S_IMP } from '../symbols.js';
import { mkmap } from '../mkmap.js';
import { rn2 } from '../rng.js';
import {
    bigrm_wallification, gx, gy, quest_place_stair, reset_xystart_size, shuffle,
} from '../sp_lev.js';
import { quest_level_init_fill } from './quest_home_common.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_object_rnd,
    quest_trap_random,
} from './quest_common.js';

// C ref: sp_lev.c good_stair_loc() — the is_ok_location_func override
// set_ok_location_func() installs only while placing a coordless des.stair();
// it is hardcoded ROOM/CORR/ICE regardless of the level's own terrain (a
// swamp level's stairs still only land on those three typs).
function kni_stair_loc_ok(x, y) {
    const t = game.level?.at(x, y)?.typ;
    return t === ROOM || t === CORR || t === ICE;
}

// C ref: sp_lev.c get_location() random branch: up to 100 rn2(xsize)/rn2(ysize)
// tries, then a deterministic scan of the whole map footprint.  `nowarn` picks
// between the (-1,-1) bail and the gx.x_maze_max/gy.y_maze_max fallback.
function kni_stair_loc_once(nowarn) {
    let x = -1, y = -1, cpt = 0;
    do {
        x = gx.xstart + rn2(gx.xsize);
        y = gy.ystart + rn2(gy.ysize);
        if (kni_stair_loc_ok(x, y)) return { x, y };
    } while (++cpt < 100);
    for (let xx = 0; xx < gx.xsize; xx++)
        for (let yy = 0; yy < gy.ysize; yy++) {
            x = gx.xstart + xx; y = gy.ystart + yy;
            if (kni_stair_loc_ok(x, y)) return { x, y };
        }
    return nowarn ? { x: -1, y: -1 } : { x: gx.x_maze_max, y: gy.y_maze_max };
}

// C ref: sp_lev.c get_location_coord() for a RANDOM coord — the first pass
// carries NO_LOC_WARN (so a total miss returns (-1,-1) instead of falling
// back), and only a total miss on THAT pass runs a second full pass without
// it.  Exported for kni_filb.js to reuse (des.stair()'s no-coord form is
// identical there).
export function kni_random_stair(up) {
    let c = kni_stair_loc_once(true);
    if (c.x === -1 && c.y === -1) c = kni_stair_loc_once(false);
    // quest_place_stair(mx,my,up) adds gx.xstart/gy.ystart back on, so hand it
    // map-relative coords to undo the offset already baked into c.x/c.y.
    quest_place_stair(c.x - gx.xstart, c.y - gy.ystart, up);
}

export async function makemaz_kni_fila() {
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
        // des.object() x8 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 8; i++) quest_object_rnd();

        // des.monster({ id = "quasit", peaceful=0 }) x4
        for (let i = 0; i < 4; i++) quest_monster_named_rnd('quasit', false);
        // des.monster({ class = "i", peaceful=0 })
        quest_monster_class_rnd(S_IMP, false);
        // des.monster({ id = "ochre jelly", peaceful=0 })
        quest_monster_named_rnd('ochre jelly', false);

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
