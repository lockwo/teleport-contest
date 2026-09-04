// levels/sam_common.js — machinery shared by the Samurai quest filler levels
// (dat/Sam-fila.lua, dat/Sam-filb.lua):
//
//   * the mkmap.c "mines" cave engine INCLUDING join_map() — none of the
//     already-landed mines-style levels need it exported: Bar-fila/Bar-filb
//     hardcode join=true inside mklev.js's file-private mk_mkmap(), and
//     Pri-loca/Pri-goal's own copy (pri_loca.js mkmap_mines) explicitly
//     throws when asked for it;
//   * a RANDOM-position des.stair() — every already-landed quest level places
//     its stairs at an explicit coordinate via sp_lev.js's quest_place_stair;
//     Sam-fila (mines cave) and Sam-filb (a plain des.map with no explicit
//     stair coords) are the first that need the real get_location search.

import {
    COLNO, CORR, CROSSWALL, HWALL, ICE, IS_OBSTRUCTED, IS_ROOM, IS_WALL,
    LAVAPOOL, MAXNROFROOMS, NO_ROOM, OROOM, ROOM, ROOMOFFSET, ROWNO, SCORR, STONE,
    TREE, VWALL, isok,
} from '../const.js';
import { game } from '../gstate.js';
import { depth } from '../hacklib.js';
import { BOULDER, mksobj_at } from '../mkobj.js';
import { somexy } from '../mkroom.js';
import { rn2, rnd } from '../rng.js';
import { add_sp_room, gx, gy, quest_place_stair, splev_map_mark } from '../sp_lev.js';

const SAM_MK_WIDTH = COLNO - 2;    // mkmap.c WIDTH
const SAM_MK_HEIGHT = ROWNO - 1;   // mkmap.c HEIGHT
const SAM_MK_DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1],
                     [0, 1], [1, -1], [1, 0], [1, 1]];   // mkmap.c dirs[]

// C ref: mkmap.c init_map().
function sam_mk_init_map(bg_typ) {
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const loc = game.level?.at(x, y);
            if (loc) { loc.roomno = NO_ROOM; loc.typ = bg_typ; loc.lit = false; }
        }
}

// C ref: mkmap.c init_fill().
function sam_mk_init_fill(bg_typ, fg_typ) {
    const limit = Math.trunc((SAM_MK_WIDTH * SAM_MK_HEIGHT * 2) / 5);
    let count = 0;
    while (count < limit) {
        const x = 2 + rn2(SAM_MK_WIDTH - 1);   // rn1(WIDTH-1, 2)  mkmap.c:45
        const y = rnd(SAM_MK_HEIGHT - 1);      //                  mkmap.c:46
        const loc = game.level?.at(x, y);
        if (loc && loc.typ === bg_typ) { loc.typ = fg_typ; count++; }
    }
}

// C ref: mkmap.c get_map() — out-of-bounds reads answer bg_typ.
function sam_mk_get_map(col, row, bg_typ) {
    if (col <= 0 || row < 0 || col > SAM_MK_WIDTH || row >= SAM_MK_HEIGHT) return bg_typ;
    return game.level?.at(col, row)?.typ;
}

function sam_mk_nbr_count(x, y, bg_typ, fg_typ) {
    let count = 0;
    for (const [dx, dy] of SAM_MK_DIRS)
        if (sam_mk_get_map(x + dx, y + dy, bg_typ) === fg_typ) count++;
    return count;
}

// C ref: mkmap.c pass_one().
function sam_mk_pass_one(bg_typ, fg_typ) {
    for (let x = 2; x <= SAM_MK_WIDTH; x++)
        for (let y = 1; y < SAM_MK_HEIGHT; y++) {
            const count = sam_mk_nbr_count(x, y, bg_typ, fg_typ);
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            if (count <= 2) loc.typ = bg_typ;
            else if (count >= 5) loc.typ = fg_typ;
        }
}

// C ref: mkmap.c pass_two()/pass_three() — both write through a scratch
// buffer, so the whole grid is evaluated against the PREVIOUS generation.
function sam_mk_pass_buffered(bg_typ, fg_typ, decide) {
    const next = new Map();
    for (let x = 2; x <= SAM_MK_WIDTH; x++)
        for (let y = 1; y < SAM_MK_HEIGHT; y++) {
            const count = sam_mk_nbr_count(x, y, bg_typ, fg_typ);
            next.set(x + ',' + y, decide(count) ? bg_typ : sam_mk_get_map(x, y, bg_typ));
        }
    for (let x = 2; x <= SAM_MK_WIDTH; x++)
        for (let y = 1; y < SAM_MK_HEIGHT; y++) {
            const loc = game.level?.at(x, y);
            if (loc) loc.typ = next.get(x + ',' + y);
        }
}

// mkmap.c flood_fill_rm() bookkeeping — anyroom=FALSE path only, the one
// join_map() uses.
let sam_min_rx, sam_max_rx, sam_min_ry, sam_max_ry, sam_n_loc_filled;

// C ref: mkmap.c flood_fill_rm().
function sam_flood_fill_rm(sx, sy, rmno) {
    const map = game.level;
    const fg_typ = map.at(sx, sy).typ;

    while (sx > 0 && map.at(sx, sy).typ === fg_typ && map.at(sx, sy).roomno !== rmno)
        sx--;
    sx++;

    if (sx < sam_min_rx) sam_min_rx = sx;
    if (sy < sam_min_ry) sam_min_ry = sy;

    let i;
    for (i = sx; i <= SAM_MK_WIDTH && map.at(i, sy).typ === fg_typ; i++) {
        map.at(i, sy).roomno = rmno;
        map.at(i, sy).lit = false;
        sam_n_loc_filled++;
    }
    const nx = i;

    if (isok(sx, sy - 1)) {
        for (i = sx; i < nx; i++)
            if (map.at(i, sy - 1).typ === fg_typ) {
                if (map.at(i, sy - 1).roomno !== rmno) sam_flood_fill_rm(i, sy - 1, rmno);
            } else {
                if ((i > sx || isok(i - 1, sy - 1)) && map.at(i - 1, sy - 1).typ === fg_typ) {
                    if (map.at(i - 1, sy - 1).roomno !== rmno) sam_flood_fill_rm(i - 1, sy - 1, rmno);
                }
                if ((i < nx - 1 || isok(i + 1, sy - 1)) && map.at(i + 1, sy - 1).typ === fg_typ) {
                    if (map.at(i + 1, sy - 1).roomno !== rmno) sam_flood_fill_rm(i + 1, sy - 1, rmno);
                }
            }
    }
    if (isok(sx, sy + 1)) {
        for (i = sx; i < nx; i++)
            if (map.at(i, sy + 1).typ === fg_typ) {
                if (map.at(i, sy + 1).roomno !== rmno) sam_flood_fill_rm(i, sy + 1, rmno);
            } else {
                if ((i > sx || isok(i - 1, sy + 1)) && map.at(i - 1, sy + 1).typ === fg_typ) {
                    if (map.at(i - 1, sy + 1).roomno !== rmno) sam_flood_fill_rm(i - 1, sy + 1, rmno);
                }
                if ((i < nx - 1 || isok(i + 1, sy + 1)) && map.at(i + 1, sy + 1).typ === fg_typ) {
                    if (map.at(i + 1, sy + 1).roomno !== rmno) sam_flood_fill_rm(i + 1, sy + 1, rmno);
                }
            }
    }

    if (nx > sam_max_rx) sam_max_rx = nx - 1;
    if (sy > sam_max_ry) sam_max_ry = sy;
}

// C ref: mkmap.c join_map_cleanup() — join_map uses temporary rooms; wipe them.
function sam_join_map_cleanup() {
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const loc = game.level?.at(x, y);
            if (loc) loc.roomno = NO_ROOM;
        }
    game.level.nroom = 0;
    game.level.rooms[0] = { hx: -1 };
}

// C ref: mklev.c maybe_sdoor().
function sam_maybe_sdoor(chance) {
    return depth(game.u?.uz) > 2 && !rn2(Math.max(2, chance));
}

// C ref: sp_lev.c dig_corridor().  join_map's own call always passes
// nxcor=FALSE and ftyp=fg_typ=ROOM (never CORR) for both Sam fillers, so the
// SCORR/boulder-drop branches never actually fire here — kept anyway so this
// stays a faithful, independently reusable port of the C function.
function sam_dig_corridor(org, dest, ftyp, btyp, nxcor = false) {
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
        if (cct++ > 500 || (nxcor && !rn2(35))) return false;
        xx += dx; yy += dy;
        if (xx >= COLNO - 1 || xx <= 0 || yy <= 0 || yy >= ROWNO - 1) return false;
        const crm = map.at(xx, yy);
        if (!crm) return false;
        if (crm.typ === btyp) {
            if (ftyp === CORR && sam_maybe_sdoor(100)) {
                crm.typ = SCORR;
            } else {
                crm.typ = ftyp;
                if (nxcor && !rn2(50)) mksobj_at(BOULDER, xx, yy, true, false);
            }
        } else if (crm.typ !== ftyp && crm.typ !== SCORR) {
            return false;
        }
        let dix = Math.abs(xx - tx);
        let diy = Math.abs(yy - ty);
        if ((dix > diy) && diy && !rn2(dix - diy + 1)) dix = 0;
        else if ((diy > dix) && dix && !rn2(diy - dix + 1)) diy = 0;
        if (dy && dix > diy) {
            const ddx = (xx > tx) ? -1 : 1;
            const ncr = map.at(xx + ddx, yy);
            if (ncr && (ncr.typ === btyp || ncr.typ === ftyp || ncr.typ === SCORR)) {
                dx = ddx; dy = 0; continue;
            }
        } else if (dx && diy > dix) {
            const ddy = (yy > ty) ? -1 : 1;
            const ncr = map.at(xx, yy + ddy);
            if (ncr && (ncr.typ === btyp || ncr.typ === ftyp || ncr.typ === SCORR)) {
                dy = ddy; dx = 0; continue;
            }
        }
        const straight = map.at(xx + dx, yy + dy);
        if (straight && (straight.typ === btyp || straight.typ === ftyp || straight.typ === SCORR))
            continue;
        if (dx) { dx = 0; dy = (ty < yy) ? -1 : 1; }
        else { dy = 0; dx = (tx < xx) ? -1 : 1; }
        const alt = map.at(xx + dx, yy + dy);
        if (alt && (alt.typ === btyp || alt.typ === ftyp || alt.typ === SCORR)) continue;
        dy = -dy; dx = -dx;
    }
    return true;
}

// C ref: mkmap.c join_map() second half — connect the flood-filled regions
// with corridors.  Rooms are already sorted by discovery order, so (matching
// the C comment) this must NOT call sort_rooms().
function sam_join_map_corridors(bg_typ, fg_typ) {
    const g = game;
    const rooms = g.level.rooms;
    let ci = 0, c2i = 1;
    const sm = { x: 0, y: 0 }, em = { x: 0, y: 0 };
    while (c2i < g.level.nroom) {
        const croom = rooms[ci], croom2 = rooms[c2i];
        if (!somexy(croom, sm) || !somexy(croom2, em)) {
            sm.x = croom.lx + Math.trunc((croom.hx - croom.lx) / 2);
            sm.y = croom.ly + Math.trunc((croom.hy - croom.ly) / 2);
            em.x = croom2.lx + Math.trunc((croom2.hx - croom2.lx) / 2);
            em.y = croom2.ly + Math.trunc((croom2.hy - croom2.ly) / 2);
        }
        sam_dig_corridor(sm, em, fg_typ, bg_typ, false);
        if (croom2.lx > croom.hx
            || ((croom2.ly > croom.hy || croom2.hy < croom.ly) && rn2(3))) {
            ci = c2i;
        }
        c2i++;
    }
    sam_join_map_cleanup();
}

// C ref: mkmap.c join_map() first half — flood fill to find the regions that
// need joining, discarding any that come out smaller than 4 cells.
function sam_join_map(bg_typ, fg_typ) {
    const g = game;
    joinscan:
    for (let x = 2; x <= SAM_MK_WIDTH; x++)
        for (let y = 1; y < SAM_MK_HEIGHT; y++) {
            const loc = g.level.at(x, y);
            if (loc.typ === fg_typ && loc.roomno === NO_ROOM) {
                sam_min_rx = sam_max_rx = x;
                sam_min_ry = sam_max_ry = y;
                sam_n_loc_filled = 0;
                sam_flood_fill_rm(x, y, g.level.nroom + ROOMOFFSET);
                if (sam_n_loc_filled > 3) {
                    add_sp_room(sam_min_rx, sam_min_ry, sam_max_rx, sam_max_ry,
                               false, OROOM, true, 0, false);
                    if (g.level.nroom >= (MAXNROFROOMS * 2)) break joinscan;
                } else {
                    // a tiny hole; erase it so the hero can't get stuck in it.
                    for (let sx = sam_min_rx; sx <= sam_max_rx; sx++)
                        for (let sy = sam_min_ry; sy <= sam_max_ry; sy++) {
                            const l2 = g.level.at(sx, sy);
                            if (l2.roomno === g.level.nroom + ROOMOFFSET) {
                                l2.typ = bg_typ;
                                l2.roomno = NO_ROOM;
                            }
                        }
                }
            }
        }
    sam_join_map_corridors(bg_typ, fg_typ);
}

// C ref: sp_lev.c wallify_map() — a STONE cell adjacent to ROOM/CROSSWALL
// becomes a wall.  With a non-STONE bg_typ (Sam-fila's is POOL) there is no
// STONE anywhere on the level and this is a faithful no-op, exactly like
// C's own wallify_map() would be for the same bg_typ.
function sam_wallify_map(x1, y1, x2, y2) {
    const map = game.level;
    y1 = Math.max(y1, 0); x1 = Math.max(x1, 1);
    y2 = Math.min(y2, ROWNO - 1); x2 = Math.min(x2, COLNO - 1);
    for (let y = y1; y <= y2; y++) {
        const loYY = (y > 0) ? y - 1 : 0;
        const hiYY = (y < y2) ? y + 1 : y2;
        for (let x = x1; x <= x2; x++) {
            if (map.at(x, y)?.typ !== STONE) continue;
            const loXX = (x > 1) ? x - 1 : 1;
            const hiXX = (x < x2) ? x + 1 : x2;
            let done = false;
            for (let yy = loYY; yy <= hiYY && !done; yy++)
                for (let xx = loXX; xx <= hiXX; xx++) {
                    const t = map.at(xx, yy)?.typ;
                    if (IS_ROOM(t) || t === CROSSWALL) {
                        map.at(x, y).typ = (yy !== y) ? HWALL : VWALL;
                        done = true; break;
                    }
                }
        }
    }
}

// C ref: mkmap.c finish_map().
function sam_finish_map(fg_typ, bg_typ, lit, walled, icedpools) {
    if (walled) sam_wallify_map(1, 0, COLNO - 1, ROWNO - 1);
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
            else if (loc.typ === ICE) loc.icedpool = icedpools ? 1 : 2;
        }
}

// C ref: mkmap.c litstate_rnd().  `litstate` mirrors get_table_boolean_opt's
// BOOL_RANDOM sentinel: pass `null` (no explicit lit= key in the .lua) or any
// negative number to draw; an explicit true/false costs no RNG.
function sam_litstate_rnd(litstate) {
    if (litstate == null || litstate < 0) {
        const d = depth(game.u?.uz);
        return (rnd(1 + Math.abs(d)) < 11 && rn2(77)) ? true : false;
    }
    return !!litstate;
}

// C ref: mkmap.c mkmap().  `lit` may be `null`/omitted for BOOL_RANDOM (no
// explicit des.level_init lit=... key, as in Sam-fila.lua); pass an explicit
// true/false otherwise.
export function sam_mkmap({ bg_typ, fg_typ, smooth, join, lit = null, walled }) {
    const resolvedLit = sam_litstate_rnd(lit);        // mkmap.c:458, drawn FIRST
    sam_mk_init_map(bg_typ);
    sam_mk_init_fill(bg_typ, fg_typ);
    sam_mk_pass_one(bg_typ, fg_typ);                          // N_P1_ITER 1
    sam_mk_pass_buffered(bg_typ, fg_typ, (c) => c === 5);     // N_P2_ITER 1
    if (smooth) {                                             // N_P3_ITER 2
        sam_mk_pass_buffered(bg_typ, fg_typ, (c) => c < 3);
        sam_mk_pass_buffered(bg_typ, fg_typ, (c) => c < 3);
    }
    if (join) sam_join_map(bg_typ, fg_typ);
    sam_finish_map(fg_typ, bg_typ, resolvedLit, walled, false);
    // a walled, joined level is cavernous, not mazelike (mkmap.c:481)
    if (walled && join && game.level?.flags) {
        game.level.flags.is_maze_lev = false;
        game.level.flags.is_cavernous_lev = true;
    }
}

// ── random-position des.stair() ─────────────────────────────────────────
// C ref: sp_lev.c l_create_stairway() RANDOM branch: set_ok_location_func()
// swaps in good_stair_loc(), which REPLACES the humidity check entirely
// (sp_lev.c is_ok_location(): `if (is_ok_location_func) return
// is_ok_location_func(x, y);`), so the search accepts ROOM/CORR/ICE only,
// regardless of the DRY flag get_location_coord is nominally called with.
function sam_ok_stair(x, y) {
    const typ = game.level?.at(x, y)?.typ;
    return typ === ROOM || typ === CORR || typ === ICE;
}

// C ref: sp_lev.c get_location_coord() for a RANDOM coord: get_location()
// runs TWICE, the first pass with NO_LOC_WARN forced on.
function sam_get_location_once(okfn, nowarn) {
    let x = -1, y = -1, cpt = 0;
    do {
        x = gx.xstart + rn2(gx.xsize);
        y = gy.ystart + rn2(gy.ysize);
        if (okfn(x, y)) return { x, y };
    } while (++cpt < 100);
    for (let xx = 0; xx < gx.xsize; xx++)
        for (let yy = 0; yy < gy.ysize; yy++) {
            x = gx.xstart + xx; y = gy.ystart + yy;
            if (okfn(x, y)) return { x, y };
        }
    if (nowarn) return { x: -1, y: -1 };
    return { x: gx.x_maze_max, y: gy.y_maze_max };
}

function sam_get_location_coord(okfn) {
    const r = sam_get_location_once(okfn, true);
    if (r.x !== -1 || r.y !== -1) return r;
    return sam_get_location_once(okfn, false);
}

// C ref: sp_lev.c l_create_stairway() -> EXT.mkstairs(..., force=FALSE) for
// the RANDOM branch.  good_stair_loc already guarantees ROOM/CORR/ICE, so
// forcing ROOM first is a no-op in observable terrain; kept to match the
// landed mk_stair()/qf_stair() convention (mklev.js) this mirrors.
export function sam_stair(up) {
    const c = sam_get_location_coord(sam_ok_stair);
    const loc = game.level?.at(c.x, c.y);
    if (loc) loc.typ = ROOM;
    splev_map_mark(c.x, c.y);
    quest_place_stair(c.x - gx.xstart, c.y - gy.ystart, up);
}
