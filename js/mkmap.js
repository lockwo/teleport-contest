// mkmap.js — port of src/mkmap.c, the cellular-automaton cave generator that
// des.map-less levels (the Gnomish Mines fill levels, the Priest quest levels,
// dat/Bar-fila.lua, …) are built from.
//
// INERT BY DESIGN.  Nothing in js/ imports this module.
//
// THIS FILE IS THE CANONICAL PORT; TWO REDUCED PRIVATE COPIES ARE LIVE.
// mkmap.c was previously translated twice, under mangled names, into the
// modules that needed it:
//
//   js/mklev.js:2936-3221   mk_get_map, mk_init_map, mk_init_fill,
//                           mk_pass_one, mk_pass_two, mk_pass_three,
//                           mk_flood_fill_rm, mk_join_map_cleanup,
//                           mk_join_map (+ mk_join_map_corridors),
//                           mk_wallify_map, mk_finish_map, mk_mkmap
//   js/levels/pri_loca.js:41-139  mkmap_init_map, mkmap_pass_one,
//                           mkmap_pass_two/three, mkmap_finish_map
//
// The mklev.js set is REDUCED in four measurable ways, all fixed here:
//   * mk_mkmap() hardcodes smoothed/joined TRUE and takes `lit` pre-resolved,
//     so it never calls litstate_rnd() and never passes icedpools;
//   * mk_finish_map() drops finish_map()'s `bg_typ == TREE` lit clause and its
//     whole trailing LAVAPOOL/ICE loop (so lava is not force-lit and ICE never
//     gets loc.icedpool set);
//   * mk_flood_fill_rm() implements the anyroom=FALSE path only (the anyroom
//     branch that pulls walls/doors into the room and marks SHARED is at
//     js/sp_lev.js:3508, also module-private);
//   * remove_room()/remove_rooms() have no port anywhere.
//
// A wiring pass must REPLACE those copies one call site at a time under
// measurement, not add a second caller
// ([[duplicate-reimplementation-shadows-faithful-port]]).
//
// litstate_rnd() and flood_fill_rm() are mkmap.c's own functions and are
// translated here for that reason even though the coverage tool already counts
// them from the private copies at js/sp_lev.js:325 / js/sp_lev.js:3508.

import { game } from './gstate.js';
import { rn2, rnd } from './rng.js';
import { isok, depth } from './hacklib.js';
import { somexy } from './mkroom.js';
import {
    COLNO, ROWNO, NO_ROOM, SHARED, ROOMOFFSET, MAXNROFROOMS, OROOM,
    SDOOR, TREE, LAVAPOOL, ICE, ICED_POOL, ICED_MOAT,
    IS_ROOM, IS_WALL, IS_DOOR, IS_OBSTRUCTED,
} from './const.js';

// C ref: mkmap.c:8-9.
const HEIGHT = (ROWNO - 1);
const WIDTH = (COLNO - 2);

// levl[x][y]
const at = (x, y) => game.level?.at(x, y) || null;

// C ref: mkmap.c:23 init_map(bg_typ).
export function init_map(bg_typ) {
    let x, y;

    for (x = 1; x < COLNO; x++)
        for (y = 0; y < ROWNO; y++) {
            const loc = at(x, y);
            if (!loc) continue;
            loc.roomno = NO_ROOM;
            loc.typ = bg_typ;
            loc.lit = false;
        }
}

// C ref: mkmap.c:36 init_fill(bg_typ, fg_typ) — seed the automaton with
// (WIDTH*HEIGHT*2)/5 fg cells.  RNG: rn1(WIDTH-1, 2) then rnd(HEIGHT-1) per
// attempt, retried until the cell was still bg.
export function init_fill(bg_typ, fg_typ) {
    let x, y;
    let limit, count;

    limit = Math.trunc((WIDTH * HEIGHT * 2) / 5);
    count = 0;
    while (count < limit) {
        x = rn1(WIDTH - 1, 2);
        y = rnd(HEIGHT - 1);
        const loc = at(x, y);
        if (loc && loc.typ === bg_typ) {
            loc.typ = fg_typ;
            count++;
        }
    }
}

// C ref: mkmap.c:54 get_map(col, row, bg_typ) — off-map reads answer bg_typ.
export function get_map(col, row, bg_typ) {
    if (col <= 0 || row < 0 || col > WIDTH || row >= HEIGHT)
        return bg_typ;
    return at(col, row)?.typ;
}

// C ref: mkmap.c:62 dirs[16] — the eight neighbour offsets, as x,y pairs.
const dirs = [
    -1, -1 /**/, -1, 0 /**/, -1, 1 /**/, 0, -1 /**/,
     0,  1 /**/,  1, -1 /**/,  1, 0 /**/, 1,  1,
];

// C ref: mkmap.c:67 pass_one(bg_typ, fg_typ) — in-place: 0-2 fg neighbours
// dies, 5-8 is born, 3-4 unchanged.  No RNG.
export function pass_one(bg_typ, fg_typ) {
    let x, y;
    let count, dr;

    for (x = 2; x <= WIDTH; x++)
        for (y = 1; y < HEIGHT; y++) {
            for (count = 0, dr = 0; dr < 8; dr++)
                if (get_map(x + dirs[dr * 2], y + dirs[(dr * 2) + 1], bg_typ)
                    === fg_typ)
                    count++;

            const loc = at(x, y);
            switch (count) {
            case 0: /* death */
            case 1:
            case 2:
                loc.typ = bg_typ;
                break;
            case 5:
            case 6:
            case 7:
            case 8:
                loc.typ = fg_typ;
                break;
            default:
                break;
            }
        }
}

// C ref: mkmap.c:98 `#define new_loc(i, j) *(gn.new_locations + ((j) * (WIDTH +
// 1)) + (i))` — the scratch buffer mkmap() allocates and frees.
let new_locations = null;
const new_loc_get = (i, j) => new_locations[(j * (WIDTH + 1)) + i];
const new_loc_set = (i, j, v) => { new_locations[(j * (WIDTH + 1)) + i] = v; };

// C ref: mkmap.c:100 pass_two(bg_typ, fg_typ) — exactly 5 fg neighbours dies,
// through the scratch buffer so the whole grid is judged simultaneously.
export function pass_two(bg_typ, fg_typ) {
    let x, y;
    let count, dr;

    for (x = 2; x <= WIDTH; x++)
        for (y = 1; y < HEIGHT; y++) {
            for (count = 0, dr = 0; dr < 8; dr++)
                if (get_map(x + dirs[dr * 2], y + dirs[(dr * 2) + 1], bg_typ)
                    === fg_typ)
                    count++;
            if (count === 5)
                new_loc_set(x, y, bg_typ);
            else
                new_loc_set(x, y, get_map(x, y, bg_typ));
        }

    for (x = 2; x <= WIDTH; x++)
        for (y = 1; y < HEIGHT; y++)
            at(x, y).typ = new_loc_get(x, y);
}

// C ref: mkmap.c:123 pass_three(bg_typ, fg_typ) — the smoothing pass: fewer
// than 3 fg neighbours dies.
export function pass_three(bg_typ, fg_typ) {
    let x, y;
    let count, dr;

    for (x = 2; x <= WIDTH; x++)
        for (y = 1; y < HEIGHT; y++) {
            for (count = 0, dr = 0; dr < 8; dr++)
                if (get_map(x + dirs[dr * 2], y + dirs[(dr * 2) + 1], bg_typ)
                    === fg_typ)
                    count++;
            if (count < 3)
                new_loc_set(x, y, bg_typ);
            else
                new_loc_set(x, y, get_map(x, y, bg_typ));
        }

    for (x = 2; x <= WIDTH; x++)
        for (y = 1; y < HEIGHT; y++)
            at(x, y).typ = new_loc_get(x, y);
}

// C ref: decl.c gm.min_rx/max_rx/min_ry/max_ry and gn.n_loc_filled — the
// bounding box and cell count flood_fill_rm() accumulates for its caller.
export const ffrm = { min_rx: 0, max_rx: 0, min_ry: 0, max_ry: 0,
                      n_loc_filled: 0 };

// C ref: mkmap.c:152 flood_fill_rm(sx, sy, rmno, lit, anyroom) — flood the
// region containing <sx,sy> with room number rmno.  When anyroom is TRUE the
// membership test is IS_ROOM() rather than an exact typ match and the
// surrounding walls/doors are pulled into the room as well (edge=1, roomno
// SHARED if already claimed).  No RNG.
export function flood_fill_rm(sx, sy, rmno, lit, anyroom) {
    let i, nx;
    const fg_typ = at(sx, sy).typ;

    /* back up to find leftmost uninitialized location */
    while (sx > 0 && (anyroom ? IS_ROOM(at(sx, sy).typ)
                              : at(sx, sy).typ === fg_typ)
           && at(sx, sy).roomno !== rmno)
        sx--;
    sx++; /* compensate for extra decrement */

    /* assume sx,sy is valid */
    if (sx < ffrm.min_rx)
        ffrm.min_rx = sx;
    if (sy < ffrm.min_ry)
        ffrm.min_ry = sy;

    for (i = sx; i <= WIDTH && at(i, sy).typ === fg_typ; i++) {
        at(i, sy).roomno = rmno;
        at(i, sy).lit = lit;
        if (anyroom) {
            /* add walls to room as well */
            let ii, jj;
            for (ii = (i === sx ? i - 1 : i); ii <= i + 1; ii++)
                for (jj = sy - 1; jj <= sy + 1; jj++) {
                    if (!isok(ii, jj)) continue;
                    const loc = at(ii, jj);
                    if (IS_WALL(loc.typ) || IS_DOOR(loc.typ)
                        || loc.typ === SDOOR) {
                        loc.edge = 1;
                        if (lit)
                            loc.lit = lit;

                        if (loc.roomno === NO_ROOM)
                            loc.roomno = rmno;
                        else if (loc.roomno !== rmno)
                            loc.roomno = SHARED;
                    }
                }
        }
        ffrm.n_loc_filled++;
    }
    nx = i;

    if (isok(sx, sy - 1)) {
        for (i = sx; i < nx; i++)
            if (at(i, sy - 1).typ === fg_typ) {
                if (at(i, sy - 1).roomno !== rmno)
                    flood_fill_rm(i, sy - 1, rmno, lit, anyroom);
            } else {
                if ((i > sx || isok(i - 1, sy - 1))
                    && at(i - 1, sy - 1)?.typ === fg_typ) {
                    if (at(i - 1, sy - 1).roomno !== rmno)
                        flood_fill_rm(i - 1, sy - 1, rmno, lit, anyroom);
                }
                if ((i < nx - 1 || isok(i + 1, sy - 1))
                    && at(i + 1, sy - 1)?.typ === fg_typ) {
                    if (at(i + 1, sy - 1).roomno !== rmno)
                        flood_fill_rm(i + 1, sy - 1, rmno, lit, anyroom);
                }
            }
    }
    if (isok(sx, sy + 1)) {
        for (i = sx; i < nx; i++)
            if (at(i, sy + 1).typ === fg_typ) {
                if (at(i, sy + 1).roomno !== rmno)
                    flood_fill_rm(i, sy + 1, rmno, lit, anyroom);
            } else {
                if ((i > sx || isok(i - 1, sy + 1))
                    && at(i - 1, sy + 1)?.typ === fg_typ) {
                    if (at(i - 1, sy + 1).roomno !== rmno)
                        flood_fill_rm(i - 1, sy + 1, rmno, lit, anyroom);
                }
                if ((i < nx - 1 || isok(i + 1, sy + 1))
                    && at(i + 1, sy + 1)?.typ === fg_typ) {
                    if (at(i + 1, sy + 1).roomno !== rmno)
                        flood_fill_rm(i + 1, sy + 1, rmno, lit, anyroom);
                }
            }
    }

    if (nx > ffrm.max_rx)
        ffrm.max_rx = nx - 1; /* nx is just past valid region */
    if (sy > ffrm.max_ry)
        ffrm.max_ry = sy;
}

// C ref: mkmap.c:245 join_map_cleanup() — join_map uses temporary rooms; clean
// up after it.
export function join_map_cleanup() {
    let x, y;

    for (x = 1; x < COLNO; x++)
        for (y = 0; y < ROWNO; y++) {
            const loc = at(x, y);
            if (loc) loc.roomno = NO_ROOM;
        }
    const lev = game.level;
    lev.nroom = lev.nsubroom = 0;
    if (!lev.rooms) lev.rooms = [];
    if (!lev.subrooms) lev.subrooms = [];
    /* svr.rooms[svn.nroom].hx = gs.subrooms[gn.nsubroom].hx = -1 */
    lev.rooms[lev.nroom] = { ...(lev.rooms[lev.nroom] || {}), hx: -1 };
    lev.subrooms[lev.nsubroom] = { ...(lev.subrooms[lev.nsubroom] || {}), hx: -1 };
}

// C ref: mkmap.c:257 join_map(bg_typ, fg_typ) — flood-fill every fg region into
// a temporary irregular room, erase regions of 3 cells or fewer, then dig
// corridors between consecutive rooms.  RNG: the rn2(3) that decides whether to
// advance `croom`, plus somexy()'s and dig_corridor()'s own draws.
export async function join_map(bg_typ, fg_typ) {
    const lev = game.level;
    let croom, croom2;      /* indices into svr.rooms[] */
    let x, y, sx, sy;
    const sm = { x: 0, y: 0 }, em = { x: 0, y: 0 };

    /* C ref: mklev.c add_room() and sp_lev.c dig_corridor() — the faithful
       ports are MODULE-PRIVATE at js/mklev.js:2278 and js/mklev.js:2496.
       Export those two when wiring this up; do not transcribe them here. */
    const MKLEV = await import('./mklev.js');
    const add_room = MKLEV.add_room;
    const dig_corridor = MKLEV.dig_corridor;

    /* first, use flood filling to find all of the regions that need joining */
    let goto_joinm = false;
    for (x = 2; x <= WIDTH && !goto_joinm; x++)
        for (y = 1; y < HEIGHT; y++) {
            const loc = at(x, y);
            if (loc.typ === fg_typ && loc.roomno === NO_ROOM) {
                ffrm.min_rx = ffrm.max_rx = x;
                ffrm.min_ry = ffrm.max_ry = y;
                ffrm.n_loc_filled = 0;
                flood_fill_rm(x, y, lev.nroom + ROOMOFFSET, false, false);
                if (ffrm.n_loc_filled > 3) {
                    if (typeof add_room === 'function') {
                        add_room(ffrm.min_rx, ffrm.min_ry, ffrm.max_rx,
                                 ffrm.max_ry, false, OROOM, true);
                        lev.rooms[lev.nroom - 1].irregular = true;
                    }
                    if (lev.nroom >= (MAXNROFROOMS * 2)) {
                        goto_joinm = true;   /* goto joinm */
                        break;
                    }
                } else {
                    /*
                     * it's a tiny hole; erase it from the map to avoid having
                     * the player end up here with no way out.
                     */
                    for (sx = ffrm.min_rx; sx <= ffrm.max_rx; sx++)
                        for (sy = ffrm.min_ry; sy <= ffrm.max_ry; sy++) {
                            const l2 = at(sx, sy);
                            if (l2.roomno === lev.nroom + ROOMOFFSET) {
                                l2.typ = bg_typ;
                                l2.roomno = NO_ROOM;
                            }
                        }
                }
            }
        }

    /* joinm:
     * Ok, now we can actually join the regions with fg_typ's.
     * The rooms are already sorted due to the previous loop, so don't call
     * sort_rooms(), which can screw up the roomno's validity in levl.
     */
    for (croom = 0, croom2 = croom + 1; croom2 < lev.nroom; ) {
        const r1 = lev.rooms[croom], r2 = lev.rooms[croom2];
        /* pick random starting and end locations for "corridor" */
        if (!somexy(r1, sm) || !somexy(r2, em)) {
            /* ack! -- the level is going to be busted */
            /* arbitrarily pick centers of both rooms and hope for the best */
            sm.x = r1.lx + Math.trunc((r1.hx - r1.lx) / 2);
            sm.y = r1.ly + Math.trunc((r1.hy - r1.ly) / 2);
            em.x = r2.lx + Math.trunc((r2.hx - r2.lx) / 2);
            em.y = r2.ly + Math.trunc((r2.hy - r2.ly) / 2);
        }

        if (typeof dig_corridor === 'function')
            dig_corridor(sm, em, null, false, fg_typ, bg_typ);

        /* choose next region to join */
        /* only increment croom if croom and croom2 are non-overlapping */
        if (r2.lx > r1.hx
            || ((r2.ly > r1.hy || r2.hy < r1.ly)
                && rn2(3))) {
            croom = croom2;
        }
        croom2++; /* always increment the next room */
    }
    join_map_cleanup();
}

// C ref: mkmap.c:330 finish_map(fg_typ, bg_typ, lit, walled, icedpools).
// No RNG.
export async function finish_map(fg_typ, bg_typ, lit, walled, icedpools) {
    let x, y;

    if (walled) {
        const { wallify_map } = await import('./sp_lev.js');
        wallify_map(1, 0, COLNO - 1, ROWNO - 1);
    }

    if (lit) {
        for (x = 1; x < COLNO; x++)
            for (y = 0; y < ROWNO; y++) {
                const loc = at(x, y);
                if (!loc) continue;
                if ((!IS_OBSTRUCTED(fg_typ) && loc.typ === fg_typ)
                    || (!IS_OBSTRUCTED(bg_typ) && loc.typ === bg_typ)
                    || (bg_typ === TREE && loc.typ === bg_typ)
                    || (walled && IS_WALL(loc.typ)))
                    loc.lit = true;
            }
        for (x = 0; x < game.level.nroom; x++)
            game.level.rooms[x].rlit = 1;
    }
    /* light lava even if everything's otherwise unlit;
       ice might be frozen pool rather than frozen moat */
    for (x = 1; x < COLNO; x++)
        for (y = 0; y < ROWNO; y++) {
            const loc = at(x, y);
            if (!loc) continue;
            if (loc.typ === LAVAPOOL)
                loc.lit = true;
            else if (loc.typ === ICE)
                loc.icedpool = icedpools ? ICED_POOL : ICED_MOAT;
        }
}

// C ref: mkmap.c:378 remove_rooms(lx, ly, hx, hy) — when a level processed by
// join_map is overlaid by a MAP, some rooms may no longer be valid.  All rooms
// in the region lx <= x < hx, ly <= y < hy are removed; rooms partially in the
// region are truncated.  Must be called before the map's REGIONs or ROOMs are
// processed, or those rooms will be removed as well.
export function remove_rooms(lx, ly, hx, hy) {
    let i;
    let croom;
    const lev = game.level;

    for (i = lev.nroom - 1; i >= 0; --i) {
        croom = lev.rooms[i];
        if (croom.hx < lx || croom.lx >= hx || croom.hy < ly
            || croom.ly >= hy)
            continue; /* no overlap */

        if (croom.lx < lx || croom.hx >= hx || croom.ly < ly
            || croom.hy >= hy) { /* partial overlap */
            /* C: impossible("regular room in joined map") when !irregular */
            void croom.irregular;
        } else {
            /* total overlap, remove the room */
            remove_room(i);
        }
    }
}

// C ref: mkmap.c:411 remove_room(roomno) — drop roomno from the rooms array,
// decrementing nroom.  The last room is swapped into the hole and the level
// locations inside it get their roomno updated; other rooms are unaffected.
// Handles only rooms that have no subrooms.
export function remove_room(roomno) {
    const lev = game.level;
    const croom_ix = roomno;
    const maxroom_ix = --lev.nroom;       /* &svr.rooms[--svn.nroom] */
    let x, y;
    let oroomno;

    if (croom_ix !== maxroom_ix) {
        /* since the order in the array only matters for making corridors, copy
         * the last room over the one being removed on the assumption that
         * corridors have already been dug. */
        lev.rooms[croom_ix] = lev.rooms[maxroom_ix];

        /* since maxroom moved, update affected level roomno values */
        oroomno = lev.nroom + ROOMOFFSET;
        roomno += ROOMOFFSET;
        const croom = lev.rooms[croom_ix];
        for (x = croom.lx; x <= croom.hx; ++x)
            for (y = croom.ly; y <= croom.hy; ++y) {
                const loc = at(x, y);
                if (loc && loc.roomno === oroomno)
                    loc.roomno = roomno;
            }
    }

    if (!lev.rooms[maxroom_ix]) lev.rooms[maxroom_ix] = {};
    lev.rooms[maxroom_ix].hx = -1; /* just like add_room */
}

// C ref: mkmap.c:438-440 — "tune map generation via this value".
const N_P1_ITER = 1;
const N_P2_ITER = 1;
const N_P3_ITER = 2;

// C ref: mkmap.c:442 litstate_rnd(litstate) — a negative litstate means "roll
// for it".  RNG: rnd(1 + abs(depth)) is ALWAYS drawn, and rn2(77) only when
// that came out below 11 (C's && short-circuits).  The module-private copies
// are js/sp_lev.js:325 and js/mklev.js:406.
export function litstate_rnd(litstate) {
    if (litstate < 0)
        return (rnd(1 + Math.abs(depth(game.u?.uz))) < 11 && rn2(77))
            ? true : false;
    return !!litstate;
}

// C ref: mkmap.c:450 mkmap(init_lev) — the whole generator.  RNG order:
// litstate_rnd(), init_fill(), then join_map() if joined.
export async function mkmap(init_lev) {
    const bg_typ = init_lev.bg, fg_typ = init_lev.fg;
    const smooth = init_lev.smoothed, join = init_lev.joined;
    let lit = init_lev.lit;
    const walled = init_lev.walled;
    let i;

    lit = litstate_rnd(lit);

    /* alloc((WIDTH + 1) * HEIGHT) */
    new_locations = new Array((WIDTH + 1) * HEIGHT);

    init_map(bg_typ);
    init_fill(bg_typ, fg_typ);

    for (i = 0; i < N_P1_ITER; i++)
        pass_one(bg_typ, fg_typ);

    for (i = 0; i < N_P2_ITER; i++)
        pass_two(bg_typ, fg_typ);

    if (smooth)
        for (i = 0; i < N_P3_ITER; i++)
            pass_three(bg_typ, fg_typ);

    if (join)
        await join_map(bg_typ, fg_typ);

    await finish_map(fg_typ, bg_typ, !!lit, !!walled, init_lev.icedpools);
    /* a walled, joined level is cavernous, not mazelike -dlc */
    if (walled && join) {
        game.level.flags.is_maze_lev = false;
        game.level.flags.is_cavernous_lev = true;
    }
    new_locations = null;   /* free(gn.new_locations) */
}

// C ref: hacklib.c rn1(x, y) == rn2(x) + y.
function rn1(x, y) { return rn2(x) + y; }
