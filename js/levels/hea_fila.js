// levels/hea_fila.js - special level builder makemaz_hea_fila() (dat/Hea-fila.lua).
// Also exports the random-stair placement helper hea_filb.js reuses (neither
// filler level carries a des.map(), so both need it).

import { COLNO, CORR, ICE, POOL, ROOM, ROWNO, STAIRS } from '../const.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import { deltrap, t_at } from '../trap.js';
import {
    bigrm_wallification, gx, gy, reset_xystart_size, vly_object,
} from '../sp_lev.js';
import { quest_align_shuffle, quest_monster } from './quest_home_common.js';
import { mkmap_mines, pri_create_trap } from './pri_loca.js';

// ════════════════════════════════════════════════════════════════════════
// Healer quest "filler A" level (dat/Hea-fila.lua) — an unthemed joined mines
// cavern used when the quest's branch structure needs an extra level.  No
// des.map(): the whole level is the mines cavern, and every placement
// (stairs included) is at a random location.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Hea-fila") ->
// load_special("Hea-fila.lua").  nhlib.lua's top-level shuffle(align)
// (rn2(3), rn2(2)) runs first, then the des.* program in file order.
// ════════════════════════════════════════════════════════════════════════

// C ref: monsym.h S_* class indices (def_char_to_monclass()).
const S_RODENT = 18, S_DRAGON = 30, S_SPIDER = 19;

// C ref: sp_lev.c:4138 good_stair_loc() — the is_ok_location_func installed
// only while a des.stair()/des.ladder() with no explicit coord searches for a
// spot; it replaces (not augments) the humidity check, so the DRY argument
// get_location_coord() is called with is otherwise irrelevant here.
function hea_good_stair_loc(x, y) {
    const typ = game.level?.at(x, y)?.typ;
    return typ === ROOM || typ === CORR || typ === ICE;
}

// C ref: sp_lev.c get_location() random-location branch (croom == NULL),
// but with is_ok_location_func == good_stair_loc instead of the humidity
// check: loop rn2(xsize)+xstart / rn2(ysize)+ystart up to 100 tries, then a
// deterministic scan of the whole footprint.
function hea_stair_scan_once(nowarn) {
    let x = -1, y = -1, cpt = 0;
    do {
        x = gx.xstart + rn2(gx.xsize);   // sp_lev.c:1233
        y = gy.ystart + rn2(gy.ysize);   // sp_lev.c:1234
        if (hea_good_stair_loc(x, y)) return { x, y };
    } while (++cpt < 100);
    for (let xx = 0; xx < gx.xsize; xx++)
        for (let yy = 0; yy < gy.ysize; yy++) {
            x = gx.xstart + xx; y = gy.ystart + yy;
            if (hea_good_stair_loc(x, y)) return { x, y };
        }
    if (nowarn) return { x: -1, y: -1 };
    return { x: gx.x_maze_max, y: gy.y_maze_max };
}

// C ref: sp_lev.c get_location_coord() random-coord path: a first pass forces
// NO_LOC_WARN; only if that comes back (-1,-1) does a second full pass run.
function hea_stair_scan_rnd() {
    const r = hea_stair_scan_once(true);
    if (r.x !== -1 || r.y !== -1) return r;
    return hea_stair_scan_once(false);
}

// C ref: sp_lev.c l_create_stairway() -> mkstairs(): the STAIRS type-set plus
// the bookkeeping quest_place_stair() also does, but taking already-absolute
// coordinates (the random search above works in absolute space already).
function hea_place_stair_abs(x, y, up) {
    const loc = game.level?.at(x, y);
    if (loc) loc.typ = STAIRS;
    if (!game.stairs) game.stairs = [];
    game.stairs.push({ sx: x, sy: y, up: !!up });
    if (up) { game.upstair = { x, y }; if (game.level) game.level.upstair = { x, y }; }
    else { game.dnstair = { x, y }; if (game.level) game.level.dnstair = { x, y }; }
}

// C ref: sp_lev.c l_create_stairway() full random-coord path: search, then
// (per every des.stair()/des.ladder()) delete any trap already on the square.
export async function hea_place_stair_rnd(up) {
    const { x, y } = hea_stair_scan_rnd();
    const badtrap = t_at(x, y);
    if (badtrap) deltrap(badtrap);
    hea_place_stair_abs(x, y, up);
}

export async function makemaz_hea_fila() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)

    // des.level_init({ style="solidfill", fg="P" }) — one rn2(2); the fill
    // itself is wholesale overwritten by the mines init below.
    rn2(2);                                              // sp_lev.c:2992

    // des.level_flags("mazelevel", "noflip") — no hardfloor; noflip means the
    // finalize tail draws no flip rn2(2)s.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noflip = true;
    }

    // des.level_init({ style="mines", fg=".", bg="P", smoothed=false,
    //                  joined=true, lit=1, walled=false })
    mkmap_mines(POOL, ROOM, false, true, 1, false);

    // des.stair("up"); des.stair("down") — both fully random.
    await hea_place_stair_rnd(true);
    await hea_place_stair_rnd(false);

    // 8 x des.object() — fully random class at a random DRY square.
    for (let i = 0; i < 8; i++) vly_object({});

    // 4 x des.trap() — fully random type and location.  hardfloor is NOT set
    // on this level, so pri_create_trap's Can_fall_thru() check leaves any
    // hole/trapdoor roll alone.
    for (let i = 0; i < 4; i++) await pri_create_trap(0, null, null);

    // Random monsters.
    quest_monster({ name: 'rabid rat' });
    for (let i = 0; i < 2; i++) quest_monster({ cls: S_RODENT, peaceful: 0 });
    for (let i = 0; i < 2; i++) quest_monster({ name: 'giant eel' });
    quest_monster({ name: 'electric eel' });
    for (let i = 0; i < 4; i++) quest_monster({ cls: S_DRAGON, peaceful: 0 });
    for (let i = 0; i < 3; i++) quest_monster({ cls: S_SPIDER, peaceful: 0 });

    // lspo_finalize_level: wallification only — noflip is set, so
    // flip_level_rnd() draws nothing.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
}
