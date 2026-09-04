// levels/cav_fila.js - special level builder makemaz_cav_fila() (dat/Cav-fila.lua),
// one of the Caveman quest branch's two generic "filler" depth levels: a
// smoothed, walled, self-joining Mines-style cavern with a random up/down
// stair pair.  Exports the join-capable mkmap.c engine that cav_filb.js
// (dat/Cav-filb.lua, structurally identical) reuses, plus the random-stair
// helper both files and cav_goal.js need.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Cav-fila")
// -> load_special("Cav-fila.lua").  load_special loads nhlib.lua first, whose
// top-level shuffle(align) always runs (rn2(3), rn2(2)) even though this file
// never indexes the result.  No levregion is registered, so fixup_special()
// places nothing.

import {
    COLNO, CORR, CROSSWALL, HWALL, ICE, IS_OBSTRUCTED, IS_ROOM, IS_WALL, LAVAPOOL,
    MAXNROFROOMS, NO_ROOM, OROOM, ROOM, ROOMOFFSET, ROWNO, STAIRS, STONE, TREE, VWALL, isok,
} from '../const.js';
import { game } from '../gstate.js';
import { somexy } from '../mkroom.js';
import { rn2, rnd } from '../rng.js';
import {
    add_sp_room, bigrm_wallification, gx, gy, quest_level_init_solidfill,
    splev_link_doors_rooms,
} from '../sp_lev.js';
import { quest_align_shuffle } from './quest_home_common.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_object_rnd, quest_trap_random,
} from './quest_common.js';

// C ref: monsym.h — the class letter Cav-fila.lua's random humanoid rolls.
const S_HUMANOID = 8;

// ════════════════════════════════════════════════════════════════════════
// mkmap.c — the des `level_init({style="mines", joined=true, ...})` engine.
//
// C ref: sp_lev.c splev_initlev() LVLINIT_MINES -> mkmap(linit).  This is a
// second, independent port of the same C functions js/levels/pri_loca.js
// exports as mkmap_mines(): that copy throws on joined=true ("unported"),
// which is exactly the case both Cav-fila and Cav-filb need, so the join_map
// half is implemented here instead of touching pri_loca.js's file (a
// different lane's owned file).  mklev.js also carries a third, file-private
// copy (mk_mkmap, for minefill.lua's real Mines-branch levels) that always
// hardcodes smoothed/joined=true; this is a faithful sibling of that one.
// ════════════════════════════════════════════════════════════════════════

const MK_WIDTH = COLNO - 2;    // mkmap.c:9  #define WIDTH (COLNO - 2)
const MK_HEIGHT = ROWNO - 1;   // mkmap.c:8  #define HEIGHT (ROWNO - 1)

// mkmap.c:60 dirs[] — the eight neighbours, in C's order.
const MK_DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1],
                 [0, 1], [1, -1], [1, 0], [1, 1]];

function mkmap_init_map(bg_typ) {
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            loc.roomno = NO_ROOM;
            loc.typ = bg_typ;
            loc.lit = false;
        }
}

// mkmap.c:36 init_fill() — the only RNG in mkmap.c before smoothing/joining.
function mkmap_init_fill(bg_typ, fg_typ) {
    const limit = Math.trunc((MK_WIDTH * MK_HEIGHT * 2) / 5);
    let count = 0;
    while (count < limit) {
        const x = 2 + rn2(MK_WIDTH - 1);   // rn1(WIDTH-1, 2)  mkmap.c:45
        const y = rnd(MK_HEIGHT - 1);      //                  mkmap.c:46
        const loc = game.level?.at(x, y);
        if (loc && loc.typ === bg_typ) { loc.typ = fg_typ; count++; }
    }
}

// mkmap.c:55 get_map() — out-of-bounds reads answer bg_typ.
function mkmap_get_map(col, row, bg_typ) {
    if (col <= 0 || row < 0 || col > MK_WIDTH || row >= MK_HEIGHT) return bg_typ;
    return game.level?.at(col, row)?.typ;
}

function mkmap_nbr_count(x, y, bg_typ, fg_typ) {
    let count = 0;
    for (const [dx, dy] of MK_DIRS)
        if (mkmap_get_map(x + dx, y + dy, bg_typ) === fg_typ) count++;
    return count;
}

// mkmap.c:68 pass_one() — writes straight into levl (no scratch buffer).
function mkmap_pass_one(bg_typ, fg_typ) {
    for (let x = 2; x <= MK_WIDTH; x++)
        for (let y = 1; y < MK_HEIGHT; y++) {
            const count = mkmap_nbr_count(x, y, bg_typ, fg_typ);
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            if (count <= 2) loc.typ = bg_typ;
            else if (count >= 5) loc.typ = fg_typ;
        }
}

// mkmap.c pass_two()/pass_three() both evaluate every cell against the
// PREVIOUS generation via a scratch buffer, then commit in a second pass.
function mkmap_pass_buffered(bg_typ, fg_typ, decide) {
    const next = new Map();
    for (let x = 2; x <= MK_WIDTH; x++)
        for (let y = 1; y < MK_HEIGHT; y++) {
            const count = mkmap_nbr_count(x, y, bg_typ, fg_typ);
            next.set(x + ',' + y, decide(count) ? bg_typ : mkmap_get_map(x, y, bg_typ));
        }
    for (let x = 2; x <= MK_WIDTH; x++)
        for (let y = 1; y < MK_HEIGHT; y++) {
            const loc = game.level?.at(x, y);
            if (loc) loc.typ = next.get(x + ',' + y);
        }
}

// flood_fill_rm bookkeeping (C ref: mkmap.c gm.min_rx etc, the module-level
// scratch the anyroom=FALSE flood fill shares with its caller join_map()).
let mk_min_rx, mk_max_rx, mk_min_ry, mk_max_ry, mk_n_loc_filled;

// C ref: mkmap.c flood_fill_rm() — the anyroom=FALSE arm only (used by
// join_map(); the anyroom=TRUE arm is a different call site, already ported
// as sp_lev.js's flood_fill_room() for lspo_region()'s irregular regions).
function mkmap_flood_fill_rm(sx, sy, rmno) {
    const map = game.level;
    const fg_typ = map.at(sx, sy).typ;

    while (sx > 0 && map.at(sx, sy).typ === fg_typ && map.at(sx, sy).roomno !== rmno)
        sx--;
    sx++;

    if (sx < mk_min_rx) mk_min_rx = sx;
    if (sy < mk_min_ry) mk_min_ry = sy;

    let i;
    for (i = sx; i <= MK_WIDTH && map.at(i, sy).typ === fg_typ; i++) {
        map.at(i, sy).roomno = rmno;
        map.at(i, sy).lit = false;
        mk_n_loc_filled++;
    }
    const nx = i;

    if (isok(sx, sy - 1)) {
        for (i = sx; i < nx; i++)
            if (map.at(i, sy - 1).typ === fg_typ) {
                if (map.at(i, sy - 1).roomno !== rmno) mkmap_flood_fill_rm(i, sy - 1, rmno);
            } else {
                if ((i > sx || isok(i - 1, sy - 1)) && map.at(i - 1, sy - 1).typ === fg_typ) {
                    if (map.at(i - 1, sy - 1).roomno !== rmno)
                        mkmap_flood_fill_rm(i - 1, sy - 1, rmno);
                }
                if ((i < nx - 1 || isok(i + 1, sy - 1)) && map.at(i + 1, sy - 1).typ === fg_typ) {
                    if (map.at(i + 1, sy - 1).roomno !== rmno)
                        mkmap_flood_fill_rm(i + 1, sy - 1, rmno);
                }
            }
    }
    if (isok(sx, sy + 1)) {
        for (i = sx; i < nx; i++)
            if (map.at(i, sy + 1).typ === fg_typ) {
                if (map.at(i, sy + 1).roomno !== rmno) mkmap_flood_fill_rm(i, sy + 1, rmno);
            } else {
                if ((i > sx || isok(i - 1, sy + 1)) && map.at(i - 1, sy + 1).typ === fg_typ) {
                    if (map.at(i - 1, sy + 1).roomno !== rmno)
                        mkmap_flood_fill_rm(i - 1, sy + 1, rmno);
                }
                if ((i < nx - 1 || isok(i + 1, sy + 1)) && map.at(i + 1, sy + 1).typ === fg_typ) {
                    if (map.at(i + 1, sy + 1).roomno !== rmno)
                        mkmap_flood_fill_rm(i + 1, sy + 1, rmno);
                }
            }
    }

    if (nx > mk_max_rx) mk_max_rx = nx - 1;
    if (sy > mk_max_ry) mk_max_ry = sy;
}

// C ref: mkmap.c dig_corridor().  Only ever called (below) with ftyp == the
// cavern's fg_typ (ROOM) and nxcor == FALSE, so the `ftyp==CORR` secret-door
// arm and the nxcor-gated early-exit/boulder-drop arms are dead for this
// caller and are written as plain no-ops rather than pulled in from scratch.
function mkmap_dig_corridor(org, dest, ftyp, btyp) {
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

// C ref: mkmap.c join_map_cleanup() — join_map's temporary rooms are wiped
// afterward; the mines cavern keeps no room bookkeeping of its own.
function mkmap_join_map_cleanup() {
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const loc = game.level?.at(x, y);
            if (loc) loc.roomno = NO_ROOM;
        }
    game.level.nroom = 0;
    game.level.rooms[0] = { hx: -1 };
}

// C ref: mkmap.c join_map() second half — connect regions with corridors.
function mkmap_join_map_corridors(bg_typ, fg_typ) {
    const rooms = game.level.rooms;
    let ci = 0, c2i = 1;
    while (c2i < game.level.nroom) {
        const croom = rooms[ci], croom2 = rooms[c2i];
        const sm = { x: 0, y: 0 }, em = { x: 0, y: 0 };
        if (!somexy(croom, sm) || !somexy(croom2, em)) {
            sm.x = croom.lx + Math.trunc((croom.hx - croom.lx) / 2);
            sm.y = croom.ly + Math.trunc((croom.hy - croom.ly) / 2);
            em.x = croom2.lx + Math.trunc((croom2.hx - croom2.lx) / 2);
            em.y = croom2.ly + Math.trunc((croom2.hy - croom2.ly) / 2);
        }
        mkmap_dig_corridor(sm, em, fg_typ, bg_typ);
        if (croom2.lx > croom.hx
            || ((croom2.ly > croom.hy || croom2.hy < croom.ly) && rn2(3)))
            ci = c2i;
        c2i++;
    }
    mkmap_join_map_cleanup();
}

// C ref: mkmap.c join_map() first half — flood-fill every unclaimed fg_typ
// blob into its own temporary irregular OROOM (tiny 1-3 cell blobs are erased
// back to bg_typ instead), then join_map_corridors connects them all.
function mkmap_join_map(bg_typ, fg_typ) {
    for (let x = 2; x <= MK_WIDTH; x++)
        for (let y = 1; y < MK_HEIGHT; y++) {
            const loc = game.level?.at(x, y);
            if (loc && loc.typ === fg_typ && loc.roomno === NO_ROOM) {
                mk_min_rx = mk_max_rx = x;
                mk_min_ry = mk_max_ry = y;
                mk_n_loc_filled = 0;
                mkmap_flood_fill_rm(x, y, game.level.nroom + ROOMOFFSET);
                if (mk_n_loc_filled > 3) {
                    const croom = add_sp_room(mk_min_rx, mk_min_ry, mk_max_rx, mk_max_ry,
                                              false, OROOM, true, 0, false);
                    croom.irregular = true;
                    if (game.level.nroom >= (MAXNROFROOMS * 2))
                        return mkmap_join_map_corridors(bg_typ, fg_typ);
                } else {
                    for (let sx = mk_min_rx; sx <= mk_max_rx; sx++)
                        for (let sy = mk_min_ry; sy <= mk_max_ry; sy++) {
                            const l2 = game.level.at(sx, sy);
                            if (l2.roomno === game.level.nroom + ROOMOFFSET) {
                                l2.typ = bg_typ;
                                l2.roomno = NO_ROOM;
                            }
                        }
                }
            }
        }
    return mkmap_join_map_corridors(bg_typ, fg_typ);
}

// C ref: mkmap.c wallify_map() — via finish_map()'s `if (walled)` arm.
function mkmap_wallify_map(x1, y1, x2, y2) {
    y1 = Math.max(y1, 0); x1 = Math.max(x1, 1);
    y2 = Math.min(y2, ROWNO - 1); x2 = Math.min(x2, COLNO - 1);
    for (let y = y1; y <= y2; y++) {
        const loYY = (y > 0) ? y - 1 : 0;
        const hiYY = (y < y2) ? y + 1 : y2;
        for (let x = x1; x <= x2; x++) {
            const loc = game.level?.at(x, y);
            if (!loc || loc.typ !== STONE) continue;
            const loXX = (x > 1) ? x - 1 : 1;
            const hiXX = (x < x2) ? x + 1 : x2;
            let done = false;
            for (let yy = loYY; yy <= hiYY && !done; yy++)
                for (let xx = loXX; xx <= hiXX; xx++) {
                    const t = game.level?.at(xx, yy)?.typ;
                    if (IS_ROOM(t) || t === CROSSWALL) {
                        loc.typ = (yy !== y) ? HWALL : VWALL;
                        done = true; break;
                    }
                }
        }
    }
}

// C ref: mkmap.c finish_map().
function mkmap_finish_map(fg_typ, bg_typ, lit, walled) {
    if (walled) mkmap_wallify_map(1, 0, COLNO - 1, ROWNO - 1);
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
            else if (loc.typ === ICE) loc.icedpool = 2;   // icedpools always false here
        }
}

// C ref: mkmap.c mkmap(lev_init*).  Both Cav-fila and Cav-filb pass
// smoothed=true, joined=true, walled=true, fg="." (ROOM), bg=" " (STONE), and
// no explicit `lit` (BOOL_RANDOM, resolved by the caller's own rn2(2) before
// this runs — see splev_initlev's LVLINIT_MINES arm).
export function mkmap_mines_joined(bg_typ, fg_typ, smooth, join, lit, walled) {
    mkmap_init_map(bg_typ);
    mkmap_init_fill(bg_typ, fg_typ);
    mkmap_pass_one(bg_typ, fg_typ);                             // N_P1_ITER 1
    mkmap_pass_buffered(bg_typ, fg_typ, (c) => c === 5);        // N_P2_ITER 1
    if (smooth) {                                               // N_P3_ITER 2
        mkmap_pass_buffered(bg_typ, fg_typ, (c) => c < 3);
        mkmap_pass_buffered(bg_typ, fg_typ, (c) => c < 3);
    }
    if (join) mkmap_join_map(bg_typ, fg_typ);
    mkmap_finish_map(fg_typ, bg_typ, lit, walled);
    // mkmap.c:480-484 — a walled AND joined level is cavernous, not mazelike.
    if (walled && join && game.level?.flags) {
        game.level.flags.is_maze_lev = false;
        game.level.flags.is_cavernous_lev = true;
    }
}

// ════════════════════════════════════════════════════════════════════════
// des.stair(dir) with NO coordinate — a RANDOM stair placement.  Every
// *-fila.lua/*-filb.lua filler level (and Cav-goal.lua) uses this bare form
// exclusively; no already-landed file needed it before now.
//
// C ref: sp_lev.c l_create_stairway() random branch: set_ok_location_func
// (good_stair_loc) then get_location_coord(&x,&y,DRY,coder->croom,RANDOM).
// is_ok_location() with a custom ok_location_func installed calls ONLY that
// function (sp_lev.c:1287-1288), so the DRY humidity flag never applies here
// — the sole acceptance test is good_stair_loc: typ is ROOM, CORR or ICE.
// croom is NULL for every caller below (none of these scripts open a
// des.room()/des.region() context first), so get_location()'s mx/my/sx/sy
// come from the CURRENT des.map footprint (gx.xstart/gy.ystart/gx.xsize/
// gy.ysize) — the full grid by default, but Cav-goal.lua calls this AFTER its
// own des.map(), so it must read the map's actual (smaller, centered) bounds,
// not the full-grid default mklev.js's private mk_stair() hardcodes for
// minefill.lua's no-map case.
//
// mkstairs()'s `force` arg is FALSE for a random coordinate (scoord IS
// random), so its `if (force) typ = ROOM` never fires; the dunlev-at-branch-
// end early return only matters for a dlvl-1 home level's up stair, never for
// these deeper filler/goal levels.  Both are omitted, matching the existing
// (fixed-coordinate) quest_place_stair() helper's own simplification.
export function cav_stair_random(up) {
    const mx = gx.xstart, my = gy.ystart, sx = gx.xsize, sy = gy.ysize;
    const okfn = (px, py) => {
        const loc = game.level?.at(px, py);
        return !!loc && (loc.typ === ROOM || loc.typ === CORR || loc.typ === ICE);
    };
    let x = -1, y = -1, cpt = 0;
    do {
        x = mx + rn2(sx);
        y = my + rn2(sy);
        if (okfn(x, y)) break;
    } while (++cpt < 100);
    if (cpt >= 100) {
        outer:
        for (let xx = 0; xx < sx; xx++) {
            for (let yy = 0; yy < sy; yy++) {
                x = mx + xx; y = my + yy;
                if (okfn(x, y)) break outer;
            }
        }
    }
    // C ref: mkstairs() tail (stairway_add + set_levltyp(STAIRS)); mirrors the
    // existing fixed-coordinate quest_place_stair()'s own bookkeeping exactly,
    // just with an already-absolute (x,y) instead of a map-relative one.
    const loc = game.level?.at(x, y);
    if (loc) loc.typ = STAIRS;
    if (!game.stairs) game.stairs = [];
    game.stairs.push({ sx: x, sy: y, up: !!up });
    if (up) { game.upstair = { x, y }; if (game.level) game.level.upstair = { x, y }; }
    else { game.dnstair = { x, y }; if (game.level) game.level.dnstair = { x, y }; }
}

// ════════════════════════════════════════════════════════════════════════
// Caveman quest filler level "a" (dat/Cav-fila.lua).
//
// C ref: makemaz("Cav-fila") -> load_special("Cav-fila.lua").  The file opens
// with des.level_init({style="solidfill", fg=" "}) exactly like every other
// special level (one rn2(2) for its own unused `lit`, then a full-grid STONE
// fill that the very next des.level_init({style="mines",...}) immediately and
// completely overwrites — same as pri_loca.js's identical no-op-fill
// observation for Pri-loca/Pri-goal).  "noflip" clears coder.allow_flips, so
// finalize's flip_level_rnd draws nothing at all (short-circuited, not just
// masked).
// ════════════════════════════════════════════════════════════════════════
export async function makemaz_cav_fila() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    quest_align_shuffle();

    // des.level_init({ style="solidfill", fg=" " }) — rn2(2), then a STONE
    // fill fully overwritten by the mines init below.
    quest_level_init_solidfill();

    // des.level_flags("mazelevel", "noflip") — no RNG.  mkmap_mines_joined's
    // walled+joined tail immediately flips is_maze_lev back to false.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;

    // des.level_init({ style="mines", fg=".", bg=" ", smoothed=true,
    //                  joined=true, walled=true }) — lit is unset (BOOL_RANDOM)
    // so splev_initlev's LVLINIT_MINES arm resolves it with one rn2(2) BEFORE
    // mkmap() runs (mkmap()'s own litstate_rnd() is then a no-op pass-through).
    const lit = rn2(2);
    mkmap_mines_joined(STONE, ROOM, true, true, lit, true);

    // des.stair("up") / des.stair("down") — both fully random.
    cav_stair_random(true);
    cav_stair_random(false);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.object() x7 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 7; i++) quest_object_rnd();
        // des.trap() x4 — random type at a random DRY spot.
        for (let i = 0; i < 4; i++) await quest_trap_random();
        // des.monster({id="bugbear",peaceful=0}) x5 / class="h" x1 / "hill giant" x1.
        for (let i = 0; i < 5; i++) quest_monster_named_rnd('bugbear', 0);
        quest_monster_class_rnd(S_HUMANOID, 0);
        quest_monster_named_rnd('hill giant', 0);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // lspo_finalize_level: link_doors_rooms() (no doors exist, so a no-op)
    // then wallification(1,0,COLNO-1,ROWNO-1) (corrmaze isn't set).  "noflip"
    // means coder.allow_flips == 0, so flip_level_rnd's two `flp & N` tests
    // are both false and neither rn2(2) is ever drawn.
    splev_link_doors_rooms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
}
