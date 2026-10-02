// levels/tou_fila.js - special level builder makemaz_tou_fila() (dat/Tou-fila.lua).
// Also exports tou_mkmap_mines(), a JOIN-capable des.level_init({style="mines"})
// engine that Tou-filb reuses (mirrors how js/levels/pri_loca.js exports its own
// mkmap_mines() for Pri-goal).
//
// C ref: mklev.c makelevel() -> makemaz("Tou-fila") -> load_special.  These two
// "filler" levels are plain Gnomish-Mines-style caverns dropped into the quest
// branch; both pass joined=true, which NEITHER of the two prior mkmap.c ports
// supports:
//   * js/mklev.js's mk_mkmap() hardcodes smoothed/joined and would be exactly
//     right, but it is module-private and js/mklev.js is protected (read-only)
//     for this task, so it cannot be exported;
//   * js/mkmap.js's own canonical mkmap() is INERT and its join_map() reaches
//     mklev.js's *other* module-private helpers (add_room/dig_corridor) through
//     a dynamic import that resolves to undefined -- pri_loca.js's mkmap_mines()
//     hit the same wall and left join=true throwing "unported".
//
// tou_join_map()/tou_add_room()/tou_dig_corridor() below are a fresh, narrowly
// scoped transcription of mklev.c add_room() and sp_lev.c dig_corridor(),
// specialized to the ONE call shape mkmap.c join_map() ever uses them with (an
// irregular, unlit OROOM booking with special=TRUE; a plain fg/bg corridor with
// nxcor=FALSE and ftyp!=CORR, so the secret-door and boulder-drop branches never
// fire) -- cross-checked against the C source and against both the mklev.js and
// mkmap.js copies of the general versions.  Everything else in this engine
// (init_map/init_fill/pass_one/two/three/finish_map/litstate_rnd) is the same
// transcription pri_loca.js already uses, since importing the mkmap.js originals
// directly is unsafe here: pass_two/pass_three read and write through a
// module-private scratch buffer that only js/mkmap.js's own mkmap() orchestrator
// allocates, so calling them standalone (bypassing that orchestrator, which is
// unavoidable since ITS join_map() is the broken piece) would write into null.

import {
    COLNO, CORR, ICE, IS_OBSTRUCTED, IS_WALL, LAVAPOOL, MAXNROFROOMS, NO_ROOM,
    OROOM, ROOM, ROOMOFFSET, ROWNO, STONE, TREE,
} from '../const.js';
import { game } from '../gstate.js';
import { depth, isok } from '../hacklib.js';
import { somexy } from '../mkroom.js';
import { rn2, rnd } from '../rng.js';
import {
    bigrm_wallification, gx, gy, quest_level_init_solidfill, quest_place_stair,
    reset_xystart_size, shuffle, wallify_map,
} from '../sp_lev.js';
import { quest_object_rnd, quest_trap_random } from './quest_common.js';
import { S_CENTAUR, quest_monster } from './quest_home_common.js';

// C ref: defsym.h MONSYM(34, 'H', GIANT, S_GIANT, ...).
const S_GIANT = 34;

// mkmap.c:8-9.
const MK_WIDTH = COLNO - 2, MK_HEIGHT = ROWNO - 1;
// mkmap.c:62 dirs[16].
const MK_DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1],
                 [0, 1], [1, -1], [1, 0], [1, 1]];

// mkmap.c:442 litstate_rnd(litstate).
function tou_litstate_rnd(litstate) {
    if (litstate < 0)
        return (rnd(1 + Math.abs(depth(game.u?.uz))) < 11 && rn2(77)) ? true : false;
    return !!litstate;
}

function tou_init_map(bg_typ) {
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            loc.roomno = NO_ROOM;
            loc.typ = bg_typ;
            loc.lit = false;
        }
}

// mkmap.c:36 init_fill() -- the only RNG source besides litstate_rnd/join_map.
function tou_init_fill(bg_typ, fg_typ) {
    const limit = Math.trunc((MK_WIDTH * MK_HEIGHT * 2) / 5);
    let count = 0;
    while (count < limit) {
        const x = 2 + rn2(MK_WIDTH - 1);       // rn1(WIDTH-1, 2)  mkmap.c:45
        const y = rnd(MK_HEIGHT - 1);          //                  mkmap.c:46
        const loc = game.level?.at(x, y);
        if (loc && loc.typ === bg_typ) { loc.typ = fg_typ; count++; }
    }
}

function tou_get_map(col, row, bg_typ) {
    if (col <= 0 || row < 0 || col > MK_WIDTH || row >= MK_HEIGHT) return bg_typ;
    return game.level?.at(col, row)?.typ;
}

function tou_nbr_count(x, y, bg_typ, fg_typ) {
    let count = 0;
    for (const [dx, dy] of MK_DIRS)
        if (tou_get_map(x + dx, y + dy, bg_typ) === fg_typ) count++;
    return count;
}

function tou_pass_one(bg_typ, fg_typ) {
    for (let x = 2; x <= MK_WIDTH; x++)
        for (let y = 1; y < MK_HEIGHT; y++) {
            const count = tou_nbr_count(x, y, bg_typ, fg_typ);
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            if (count <= 2) loc.typ = bg_typ;
            else if (count >= 5) loc.typ = fg_typ;
        }
}

// pass_two/pass_three both write through a scratch buffer, so the whole grid is
// judged against the PREVIOUS generation.  Using a fresh Map per call (rather
// than mkmap.js's shared module-level array) sidesteps that module's allocate/
// free lifecycle, which only its own mkmap() orchestrator drives.
function tou_pass_buffered(bg_typ, fg_typ, decide) {
    const next = new Map();
    for (let x = 2; x <= MK_WIDTH; x++)
        for (let y = 1; y < MK_HEIGHT; y++) {
            const count = tou_nbr_count(x, y, bg_typ, fg_typ);
            next.set(x + ',' + y, decide(count) ? bg_typ : tou_get_map(x, y, bg_typ));
        }
    for (let x = 2; x <= MK_WIDTH; x++)
        for (let y = 1; y < MK_HEIGHT; y++) {
            const loc = game.level?.at(x, y);
            if (loc) loc.typ = next.get(x + ',' + y);
        }
}

// mkmap.c:152 flood_fill_rm(sx, sy, rmno, lit, anyroom=FALSE) -- join_map()
// never asks for the anyroom=TRUE arm, so it is not ported here.  No RNG.
const ffrm = { min_rx: 0, max_rx: 0, min_ry: 0, max_ry: 0, n_loc_filled: 0 };
function tou_flood_fill_rm(sx, sy, rmno, lit) {
    const lev = game.level;
    const fg_typ = lev.at(sx, sy).typ;
    while (sx > 0 && lev.at(sx, sy).typ === fg_typ && lev.at(sx, sy).roomno !== rmno)
        sx--;
    sx++;
    if (sx < ffrm.min_rx) ffrm.min_rx = sx;
    if (sy < ffrm.min_ry) ffrm.min_ry = sy;
    let i;
    for (i = sx; i <= MK_WIDTH && lev.at(i, sy).typ === fg_typ; i++) {
        lev.at(i, sy).roomno = rmno;
        lev.at(i, sy).lit = lit;
        ffrm.n_loc_filled++;
    }
    const nx = i;
    if (isok(sx, sy - 1)) {
        for (i = sx; i < nx; i++)
            if (lev.at(i, sy - 1).typ === fg_typ) {
                if (lev.at(i, sy - 1).roomno !== rmno) tou_flood_fill_rm(i, sy - 1, rmno, lit);
            } else {
                if ((i > sx || isok(i - 1, sy - 1)) && lev.at(i - 1, sy - 1)?.typ === fg_typ
                    && lev.at(i - 1, sy - 1).roomno !== rmno)
                    tou_flood_fill_rm(i - 1, sy - 1, rmno, lit);
                if ((i < nx - 1 || isok(i + 1, sy - 1)) && lev.at(i + 1, sy - 1)?.typ === fg_typ
                    && lev.at(i + 1, sy - 1).roomno !== rmno)
                    tou_flood_fill_rm(i + 1, sy - 1, rmno, lit);
            }
    }
    if (isok(sx, sy + 1)) {
        for (i = sx; i < nx; i++)
            if (lev.at(i, sy + 1).typ === fg_typ) {
                if (lev.at(i, sy + 1).roomno !== rmno) tou_flood_fill_rm(i, sy + 1, rmno, lit);
            } else {
                if ((i > sx || isok(i - 1, sy + 1)) && lev.at(i - 1, sy + 1)?.typ === fg_typ
                    && lev.at(i - 1, sy + 1).roomno !== rmno)
                    tou_flood_fill_rm(i - 1, sy + 1, rmno, lit);
                if ((i < nx - 1 || isok(i + 1, sy + 1)) && lev.at(i + 1, sy + 1)?.typ === fg_typ
                    && lev.at(i + 1, sy + 1).roomno !== rmno)
                    tou_flood_fill_rm(i + 1, sy + 1, rmno, lit);
            }
    }
    if (nx > ffrm.max_rx) ffrm.max_rx = nx - 1;
    if (sy > ffrm.max_ry) ffrm.max_ry = sy;
}

// C ref: mklev.c add_room(lowx,lowy,hix,hiy, lit=FALSE, rtype=OROOM,
// special=TRUE).  special=TRUE skips do_room_or_subroom's whole wall/floor-
// drawing block (flood_fill_rm already set typ/roomno), so this reduces to the
// room-table bookkeeping.  No RNG.
function tou_add_room_joined(lowx, lowy, hix, hiy) {
    const lev = game.level;
    const croom = {
        lx: lowx, ly: lowy, hx: hix, hy: hiy,
        rtype: OROOM, rlit: 0,
        doorct: 0, fdoor: lev.doorindex,
        irregular: false, needjoining: false,
        nsubrooms: 0, sbrooms: [],
        roomnoidx: lev.nroom, needfill: 0,
    };
    lev.rooms[lev.nroom] = croom;
    lev.nroom++;
    if (lev.nroom < MAXNROFROOMS) lev.rooms[lev.nroom] = { hx: -1 };
    return croom;
}

// C ref: sp_lev.c dig_corridor(org, dest, npoints_out=NULL, nxcor=FALSE, ftyp,
// btyp), specialized for join_map()'s one call shape: nxcor is always FALSE (so
// the retry-abort and boulder-drop branches never draw) and ftyp is always the
// cavern's ROOM fg_typ, never CORR (so maybe_sdoor()/SCORR never fire either).
// The direction-preference rn2() draws are the only RNG and are unaffected by
// that specialization.
function tou_dig_corridor(org, dest, ftyp, btyp) {
    const map = game.level;
    let dx = 0, dy = 0;
    let xx = org.x, yy = org.y;
    const tx = dest.x, ty = dest.y;
    if (xx <= 0 || yy <= 0 || tx <= 0 || ty <= 0
        || xx > COLNO - 1 || tx > COLNO - 1 || yy > ROWNO - 1 || ty > ROWNO - 1)
        return false;
    if (tx > xx) dx = 1;
    else if (ty > yy) dy = 1;
    else if (tx < xx) dx = -1;
    else dy = -1;
    xx -= dx; yy -= dy;
    let cct = 0;
    while (xx !== tx || yy !== ty) {
        if (cct++ > 500) return false;
        xx += dx; yy += dy;
        if (xx >= COLNO - 1 || xx <= 0 || yy <= 0 || yy >= ROWNO - 1) return false;
        const crm = map.at(xx, yy);
        if (!crm) return false;
        if (crm.typ === btyp) {
            crm.typ = ftyp;
        } else if (crm.typ !== ftyp) {
            return false;
        }
        let dix = Math.abs(xx - tx);
        let diy = Math.abs(yy - ty);
        if ((dix > diy) && diy && !rn2(dix - diy + 1)) dix = 0;
        else if ((diy > dix) && dix && !rn2(diy - dix + 1)) diy = 0;
        if (dy && dix > diy) {
            const ddx = (xx > tx) ? -1 : 1;
            const ncr = map.at(xx + ddx, yy);
            if (ncr && (ncr.typ === btyp || ncr.typ === ftyp)) { dx = ddx; dy = 0; continue; }
        } else if (dx && diy > dix) {
            const ddy = (yy > ty) ? -1 : 1;
            const ncr = map.at(xx, yy + ddy);
            if (ncr && (ncr.typ === btyp || ncr.typ === ftyp)) { dy = ddy; dx = 0; continue; }
        }
        const straight = map.at(xx + dx, yy + dy);
        if (straight && (straight.typ === btyp || straight.typ === ftyp)) continue;
        if (dx) { dx = 0; dy = (ty < yy) ? -1 : 1; }
        else { dy = 0; dx = (tx < xx) ? -1 : 1; }
        const alt = map.at(xx + dx, yy + dy);
        if (alt && (alt.typ === btyp || alt.typ === ftyp)) continue;
        dy = -dy; dx = -dx;
    }
    return true;
}

// C ref: mkmap.c join_map() second half -- connect the joined rooms in array
// order with corridors.
function tou_join_map_corridors(bg_typ, fg_typ) {
    const lev = game.level;
    const rooms = lev.rooms;
    let ci = 0, c2i = 1;
    while (c2i < lev.nroom) {
        const croom = rooms[ci], croom2 = rooms[c2i];
        const sm = { x: 0, y: 0 }, em = { x: 0, y: 0 };
        if (!somexy(croom, sm) || !somexy(croom2, em)) {
            sm.x = croom.lx + Math.trunc((croom.hx - croom.lx) / 2);
            sm.y = croom.ly + Math.trunc((croom.hy - croom.ly) / 2);
            em.x = croom2.lx + Math.trunc((croom2.hx - croom2.lx) / 2);
            em.y = croom2.ly + Math.trunc((croom2.hy - croom2.ly) / 2);
        }
        tou_dig_corridor(sm, em, fg_typ, bg_typ);
        if (croom2.lx > croom.hx
            || ((croom2.ly > croom.hy || croom2.hy < croom.ly) && rn2(3)))
            ci = c2i;
        c2i++;
    }
    lev.nroom = 0;
    lev.rooms = [{ hx: -1 }];
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++)
            if (lev.at(x, y)) lev.at(x, y).roomno = NO_ROOM;
}

// C ref: mkmap.c join_map(bg_typ, fg_typ) -- flood-fill every fg region into a
// temporary irregular room, erase 3-cell-or-smaller holes, then corridor-join.
function tou_join_map(bg_typ, fg_typ) {
    const lev = game.level;
    for (let x = 2; x <= MK_WIDTH; x++)
        for (let y = 1; y < MK_HEIGHT; y++) {
            const loc = lev.at(x, y);
            if (loc.typ === fg_typ && loc.roomno === NO_ROOM) {
                ffrm.min_rx = ffrm.max_rx = x;
                ffrm.min_ry = ffrm.max_ry = y;
                ffrm.n_loc_filled = 0;
                tou_flood_fill_rm(x, y, lev.nroom + ROOMOFFSET, false);
                if (ffrm.n_loc_filled > 3) {
                    tou_add_room_joined(ffrm.min_rx, ffrm.min_ry, ffrm.max_rx, ffrm.max_ry);
                    lev.rooms[lev.nroom - 1].irregular = true;
                    if (lev.nroom >= (MAXNROFROOMS * 2))
                        return tou_join_map_corridors(bg_typ, fg_typ);
                } else {
                    for (let sx = ffrm.min_rx; sx <= ffrm.max_rx; sx++)
                        for (let sy = ffrm.min_ry; sy <= ffrm.max_ry; sy++) {
                            const l2 = lev.at(sx, sy);
                            if (l2.roomno === lev.nroom + ROOMOFFSET) {
                                l2.typ = bg_typ;
                                l2.roomno = NO_ROOM;
                            }
                        }
                }
            }
        }
    return tou_join_map_corridors(bg_typ, fg_typ);
}

// mkmap.c:326 finish_map(fg_typ, bg_typ, lit, walled, icedpools=FALSE -- neither
// Tou-fila nor Tou-filb calls des.mineralize()).
function tou_finish_map(fg_typ, bg_typ, lit, walled) {
    if (walled) wallify_map(1, 0, COLNO - 1, ROWNO - 1);
    if (lit) {
        for (let x = 1; x < COLNO; x++)
            for (let y = 0; y < ROWNO; y++) {
                const loc = game.level?.at(x, y);
                if (!loc) continue;
                if ((!IS_OBSTRUCTED(fg_typ) && loc.typ === fg_typ)
                    || (!IS_OBSTRUCTED(bg_typ) && loc.typ === bg_typ)
                    || (bg_typ === TREE && loc.typ === bg_typ)
                    || (walled && IS_WALL(loc.typ)))
                    loc.lit = true;
            }
        for (let i = 0; i < (game.level?.nroom ?? 0); i++)
            if (game.level.rooms[i]) game.level.rooms[i].rlit = 1;
    }
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            if (loc.typ === LAVAPOOL) loc.lit = true;
            else if (loc.typ === ICE) loc.icedpool = 2;    // icedpools=false -> ICED_MOAT
        }
}

// C ref: sp_lev.c splev_initlev() LVLINIT_MINES -> mkmap.c mkmap(init_lev).
// `lit` is never given by Tou-fila/Tou-filb's des.level_init table, so it stays
// BOOL_RANDOM and litstate_rnd() draws.
export function tou_mkmap_mines(bg_typ, fg_typ, smooth, join, walled) {
    const lit = tou_litstate_rnd(-1);
    tou_init_map(bg_typ);
    tou_init_fill(bg_typ, fg_typ);
    tou_pass_one(bg_typ, fg_typ);                          // N_P1_ITER 1
    tou_pass_buffered(bg_typ, fg_typ, (c) => c === 5);     // N_P2_ITER 1
    if (smooth) {                                           // N_P3_ITER 2
        tou_pass_buffered(bg_typ, fg_typ, (c) => c < 3);
        tou_pass_buffered(bg_typ, fg_typ, (c) => c < 3);
    }
    if (join) tou_join_map(bg_typ, fg_typ);
    tou_finish_map(fg_typ, bg_typ, lit, walled);
    if (walled && join && game.level?.flags) {
        game.level.flags.is_maze_lev = false;
        game.level.flags.is_cavernous_lev = true;
    }
}

// C ref: sp_lev.c l_create_stairway() random-location branch: set_ok_location_
// func(good_stair_loc) then a 100-try rn2(xsize)/rn2(ysize) loop (falling back to
// a full-grid scan), same shape as js/mklev.js's private mk_get_location_random
// -- neither of these levels calls des.map, so gx.xstart/xsize are still at
// their reset_xystart_size() defaults (1, COLNO-1) here.
export function tou_random_stair(up) {
    const okfn = (x, y) => {
        const t = game.level?.at(x, y)?.typ;
        return t === ROOM || t === CORR || t === ICE;
    };
    let x = -1, y = -1, cpt = 0;
    do {
        x = gx.xstart + rn2(gx.xsize);
        y = gy.ystart + rn2(gy.ysize);
        if (okfn(x, y)) break;
    } while (++cpt < 100);
    if (cpt >= 100) {
        outer:
        for (let xx = 0; xx < gx.xsize; xx++)
            for (let yy = 0; yy < gy.ysize; yy++) {
                x = gx.xstart + xx; y = gy.ystart + yy;
                if (okfn(x, y)) break outer;
            }
    }
    quest_place_stair(x - gx.xstart, y - gy.ystart, up);
}

// C ref: mklev.c makelevel() -> makemaz("Tou-fila") -> load_special("Tou-fila.lua").
export async function makemaz_tou_fila() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    reset_xystart_size();                  // sp_level_coder_init (sp_lev.c:6373)

    // des.level_init({ style="solidfill", fg=" " }) -- rn2(2) + fill STONE.
    quest_level_init_solidfill();
    // des.level_flags("mazelevel", "noflip") -- no RNG.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;

    // des.level_init({ style="mines", fg=".", bg=" ", smoothed=true,
    //                  joined=true, walled=true })
    tou_mkmap_mines(STONE, ROOM, true, true, true);

    // des.stair("up"); des.stair("down") -- both random location.
    tou_random_stair(true);
    tou_random_stair(false);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        for (let i = 0; i < 7; i++) quest_object_rnd();
        for (let i = 0; i < 4; i++) await quest_trap_random();
        for (let i = 0; i < 5; i++) quest_monster({ name: 'soldier', peaceful: false });
        quest_monster({ cls: S_GIANT, peaceful: false });
        quest_monster({ cls: S_CENTAUR, peaceful: false });
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // load_special() tail: wallification(1,0,COLNO-1,ROWNO-1) -- mklev.c's
    // corner/junction pass, distinct from mkmap.c's wallify_map() already run
    // inside tou_mkmap_mines()'s finish_map step.  "noflip" is set, so
    // flip_level_rnd(allow_flips=0, FALSE) draws nothing.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
}
