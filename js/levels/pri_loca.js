// levels/pri_loca.js - special level builder makemaz_pri_loca() (dat/Pri-loca.lua).
// Also exports the mkmap.c "mines"-style level_init engine, which Pri-goal and
// the Healer maze levels (hea_loca.js/hea_goal.js/hea_fila.js/hea_filb.js) reuse.

import {
    COLNO, CORR, ICE, IS_OBSTRUCTED, IS_WALL, LAVAPOOL, MAXNROFROOMS, MORGUE,
    NO_ROOM, OROOM, ROOM, ROWNO, SCORR, TREE,
    AM_NONE, A_NONE, FILL_NORMAL, LADDER, STAIRS, MM_ADJACENTOK, MM_NOMSG,
    ROOMOFFSET, SHARED, isok,
} from '../const.js';
import { game } from '../gstate.js';
import { depth as depth_of_level } from '../hacklib.js';
import { enexto_spawn, makemon, mm_mon_at, monster_by_pmidx, name_to_pmidx,
         name_gender_hint, MGEND_NEUTRAL, MM_EMIN } from '../makemon.js';
import { somexy } from '../mkroom.js';
import { rn2, rnd } from '../rng.js';
import { Can_fall_thru, maketrap } from '../trap.js';
import {
    TEMPLE_RTYPE, add_doors_to_room, add_sp_room, bigrm_load_map,
    bigrm_wallification, q_absx, q_absy,
    quest_level_init_solidfill, quest_place_stair, quest_set_door, shuffle,
    splev_get_location_rnd, splev_object_at, splev_traptype_rnd, vly_altar,
    vly_non_diggable, vly_region, LOC_DRY,
} from '../sp_lev.js';

// ════════════════════════════════════════════════════════════════════════
// mkmap.c — the des `level_init({style="mines", ...})` engine.
//
// C ref: sp_lev.c splev_initlev() LVLINIT_MINES -> mkmap(linit).  Exported
// because both Priest quest maze levels (Pri-loca, Pri-goal) drive it; the
// mklev.js copy (mk_mkmap) is file-private there and hardcodes
// smoothed/joined = true, which neither of these scripts asks for.
//
// Only the RNG lives in init_fill (two draws per placed cell); every other
// pass is deterministic.
// ════════════════════════════════════════════════════════════════════════

const MKMAP_WIDTH = COLNO - 2;    // mkmap.c:9
const MKMAP_HEIGHT = ROWNO - 1;   // mkmap.c:8

// mkmap.c:60 dirs[] — the eight neighbours, in C's order.
const MKMAP_DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1],
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

// mkmap.c:36 init_fill() — the ONLY RNG in mkmap.  limit is a fixed 624 for a
// standard 80x21 map; with bg_typ == fg_typ every draw lands (no retries).
function mkmap_init_fill(bg_typ, fg_typ) {
    const limit = Math.trunc((MKMAP_WIDTH * MKMAP_HEIGHT * 2) / 5);
    let count = 0;
    while (count < limit) {
        const x = 2 + rn2(MKMAP_WIDTH - 1);   // rn1(WIDTH-1, 2)  mkmap.c:45
        const y = rnd(MKMAP_HEIGHT - 1);      //                  mkmap.c:46
        const loc = game.level?.at(x, y);
        if (loc && loc.typ === bg_typ) { loc.typ = fg_typ; count++; }
    }
}

// mkmap.c:55 get_map() — out-of-bounds reads answer bg_typ.
function mkmap_get_map(col, row, bg_typ) {
    if (col <= 0 || row < 0 || col > MKMAP_WIDTH || row >= MKMAP_HEIGHT)
        return bg_typ;
    return game.level?.at(col, row)?.typ;
}

function mkmap_nbr_count(x, y, bg_typ, fg_typ) {
    let count = 0;
    for (const [dx, dy] of MKMAP_DIRS)
        if (mkmap_get_map(x + dx, y + dy, bg_typ) === fg_typ) count++;
    return count;
}

function mkmap_pass_one(bg_typ, fg_typ) {
    for (let x = 2; x <= MKMAP_WIDTH; x++)
        for (let y = 1; y < MKMAP_HEIGHT; y++) {
            const count = mkmap_nbr_count(x, y, bg_typ, fg_typ);
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            if (count <= 2) loc.typ = bg_typ;
            else if (count >= 5) loc.typ = fg_typ;
        }
}

// pass_two/pass_three both write through a scratch buffer, so the whole grid
// is evaluated against the PREVIOUS generation.
function mkmap_pass_buffered(bg_typ, fg_typ, decide) {
    const next = new Map();
    for (let x = 2; x <= MKMAP_WIDTH; x++)
        for (let y = 1; y < MKMAP_HEIGHT; y++) {
            const count = mkmap_nbr_count(x, y, bg_typ, fg_typ);
            next.set(x + ',' + y,
                     decide(count) ? bg_typ : mkmap_get_map(x, y, bg_typ));
        }
    for (let x = 2; x <= MKMAP_WIDTH; x++)
        for (let y = 1; y < MKMAP_HEIGHT; y++) {
            const loc = game.level?.at(x, y);
            if (loc) loc.typ = next.get(x + ',' + y);
        }
}

// mkmap.c:326 finish_map().  `walled` is FALSE for both Priest quest levels
// (their scripts say walled=false), so wallify_map() is never reached.
function mkmap_finish_map(fg_typ, bg_typ, lit, walled, icedpools) {
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

// ── mkmap.c join_map() — the "joined=true" arm, needed by the Healer maze
// levels (Hea-loca/Hea-goal/Hea-fila/Hea-filb all pass joined=true; neither
// Priest maze level does, which is why this was originally left unported).
//
// C ref: mkmap.c flood_fill_rm() anyroom=FALSE path (the arm join_map() itself
// uses).  Distinct from sp_lev.js's flood_fill_room(), which is the OTHER,
// anyroom=TRUE arm used by vly_region()'s irregular branch.
let _joinMinRx, _joinMaxRx, _joinMinRy, _joinMaxRy, _joinFilled;

function mkmap_flood_fill_rm(sx, sy, rmno) {
    const map = game.level;
    const fg_typ = map.at(sx, sy).typ;

    while (sx > 0 && map.at(sx, sy).typ === fg_typ && map.at(sx, sy).roomno !== rmno)
        sx--;
    sx++;

    if (sx < _joinMinRx) _joinMinRx = sx;
    if (sy < _joinMinRy) _joinMinRy = sy;

    let i;
    for (i = sx; i <= MKMAP_WIDTH && map.at(i, sy).typ === fg_typ; i++) {
        map.at(i, sy).roomno = rmno;
        map.at(i, sy).lit = false;
        _joinFilled++;
    }
    const nx = i;

    if (isok(sx, sy - 1)) {
        for (i = sx; i < nx; i++)
            if (map.at(i, sy - 1).typ === fg_typ) {
                if (map.at(i, sy - 1).roomno !== rmno) mkmap_flood_fill_rm(i, sy - 1, rmno);
            } else {
                if ((i > sx || isok(i - 1, sy - 1)) && map.at(i - 1, sy - 1).typ === fg_typ) {
                    if (map.at(i - 1, sy - 1).roomno !== rmno) mkmap_flood_fill_rm(i - 1, sy - 1, rmno);
                }
                if ((i < nx - 1 || isok(i + 1, sy - 1)) && map.at(i + 1, sy - 1).typ === fg_typ) {
                    if (map.at(i + 1, sy - 1).roomno !== rmno) mkmap_flood_fill_rm(i + 1, sy - 1, rmno);
                }
            }
    }
    if (isok(sx, sy + 1)) {
        for (i = sx; i < nx; i++)
            if (map.at(i, sy + 1).typ === fg_typ) {
                if (map.at(i, sy + 1).roomno !== rmno) mkmap_flood_fill_rm(i, sy + 1, rmno);
            } else {
                if ((i > sx || isok(i - 1, sy + 1)) && map.at(i - 1, sy + 1).typ === fg_typ) {
                    if (map.at(i - 1, sy + 1).roomno !== rmno) mkmap_flood_fill_rm(i - 1, sy + 1, rmno);
                }
                if ((i < nx - 1 || isok(i + 1, sy + 1)) && map.at(i + 1, sy + 1).typ === fg_typ) {
                    if (map.at(i + 1, sy + 1).roomno !== rmno) mkmap_flood_fill_rm(i + 1, sy + 1, rmno);
                }
            }
    }

    if (nx > _joinMaxRx) _joinMaxRx = nx - 1;
    if (sy > _joinMaxRy) _joinMaxRy = sy;
}

// C ref: mkmap.c maybe_sdoor() reached from dig_corridor()'s CORR arm — dead
// for every current caller (fg_typ is never CORR here) but kept so a future
// caller that DID pass fg="#" would draw the same RNG.
function mkmap_maybe_sdoor(chance) {
    const d = depth_of_level(game.u?.uz);
    return (d > 2) && !rn2(Math.max(2, chance));
}

// C ref: mkmap.c dig_corridor().  join_map() always calls this with nxcor
// hardcoded FALSE (mkmap.c:316), so the nxcor-gated early-return and boulder
// arms never fire and are omitted; everything else is a direct port.
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
            if (ftyp === CORR && mkmap_maybe_sdoor(100)) crm.typ = SCORR;
            else crm.typ = ftyp;
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

// C ref: mkmap.c join_map_cleanup().
function mkmap_join_cleanup() {
    const map = game.level;
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++)
            map.at(x, y).roomno = NO_ROOM;
    game.level.nroom = 0;
    game.level.rooms[0] = { hx: -1 };
}

// C ref: mkmap.c join_map() second half — somexy(croom)/somexy(croom2) pick
// the corridor endpoints, dig_corridor() connects them.  add_room(...,TRUE)'s
// "special" bookkeeping-only room (no wall/corner drawing) is add_sp_room()
// with irregular=true, needfill=0, joined=false.
function mkmap_join_corridors(bg_typ, fg_typ) {
    const g = game;
    const rooms = g.level.rooms;
    let ci = 0, c2i = 1;
    while (c2i < g.level.nroom) {
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
    mkmap_join_cleanup();
}

// C ref: mkmap.c join_map() first half — flood-fill every unclaimed fg_typ
// island into its own irregular room (erasing tiny 1-3 cell ones), then join.
function mkmap_join_map(bg_typ, fg_typ) {
    const g = game;
    const map = g.level;
    for (let x = 2; x <= MKMAP_WIDTH; x++)
        for (let y = 1; y < MKMAP_HEIGHT; y++) {
            const loc = map.at(x, y);
            if (loc.typ === fg_typ && loc.roomno === NO_ROOM) {
                _joinMinRx = _joinMaxRx = x;
                _joinMinRy = _joinMaxRy = y;
                _joinFilled = 0;
                mkmap_flood_fill_rm(x, y, g.level.nroom + ROOMOFFSET);
                if (_joinFilled > 3) {
                    add_sp_room(_joinMinRx, _joinMinRy, _joinMaxRx, _joinMaxRy,
                                false, OROOM, true, 0, false);
                    if (g.level.nroom >= (MAXNROFROOMS * 2)) {
                        mkmap_join_corridors(bg_typ, fg_typ);
                        return;
                    }
                } else {
                    for (let sx = _joinMinRx; sx <= _joinMaxRx; sx++)
                        for (let sy = _joinMinRy; sy <= _joinMaxRy; sy++) {
                            const l2 = map.at(sx, sy);
                            if (l2.roomno === g.level.nroom + ROOMOFFSET) {
                                l2.typ = bg_typ;
                                l2.roomno = NO_ROOM;
                            }
                        }
                }
            }
        }
    mkmap_join_corridors(bg_typ, fg_typ);
}

// C ref: mkmap.c:449 mkmap(lev_init *).  `lit` here is already resolved (both
// Priest scripts pass an explicit 0/1, so litstate_rnd draws nothing).
export function mkmap_mines(bg_typ, fg_typ, smooth, join, lit, walled) {
    mkmap_init_map(bg_typ);
    mkmap_init_fill(bg_typ, fg_typ);
    mkmap_pass_one(bg_typ, fg_typ);                            // N_P1_ITER 1
    mkmap_pass_buffered(bg_typ, fg_typ, (c) => c === 5);       // N_P2_ITER 1
    if (smooth) {                                              // N_P3_ITER 2
        mkmap_pass_buffered(bg_typ, fg_typ, (c) => c < 3);
        mkmap_pass_buffered(bg_typ, fg_typ, (c) => c < 3);
    }
    if (join) mkmap_join_map(bg_typ, fg_typ);
    mkmap_finish_map(fg_typ, bg_typ, lit, walled, false);
    if (walled && join && game.level?.flags) {
        game.level.flags.is_maze_lev = false;
        game.level.flags.is_cavernous_lev = true;
    }
}

// ════════════════════════════════════════════════════════════════════════
// Priest quest "locate" level (dat/Pri-loca.lua) — a walled temple compound
// ringed by four morgue regions.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Pri-loca")
// -> load_special("Pri-loca.lua").  Loading nhlib.lua first runs the top-level
// shuffle(align) (rn2(3), rn2(2)); then the des.* program runs in file order.
//
// The four morgues and the temple are des.region{filled=1} rooms: they draw
// NOTHING at region time and are stocked by lspo_finalize_level's trailing
// fill_special_room() loop, which this engine runs generically post-mklev
// (fastforward_fill_mineralize).
// ════════════════════════════════════════════════════════════════════════

const PRI_LOCA_MAP = [
    '........................................',
    '........................................',
    '..........----------+----------.........',
    '..........|........|.|........|.........',
    '..........|........|.|........|.........',
    '..........|----.----.----.----|.........',
    '..........+...................+.........',
    '..........+...................+.........',
    '..........|----.----.----.----|.........',
    '..........|........|.|........|.........',
    '..........|........|.|........|.........',
    '..........----------+----------.........',
    '........................................',
    '........................................',
].join('\n');

// C ref: sp_lev.c lspo_region()'s NON-irregular arm — add_room(...,special=TRUE)
// then topologize(troom).  Deliberately not sp_lev.js's vly_region(): that one
// writes `loc.lit = !!lit` over the whole rectangle, but C's
// do_room_or_subroom() only ever LIGHTS (and then a one-cell border too) — an
// unlit region records croom->rlit = 0 and leaves levl[][].lit untouched.  The
// difference is invisible on a level whose floor starts dark; here the
// level_init lit the whole cavern, so unlighting the four morgue rectangles hid
// every monster C displays in them (27 cells per screen on seed0367 step 203).
// Exported: hea_loca.js reuses this for Hea-loca.lua's non-irregular temple
// region (des.region({region={...}, filled=1}) with no irregular=1 flag) —
// the exact same lspo_region() arm, not Priest-specific despite the name.
export function pri_region_rect(mx1, my1, mx2, my2, rlit, rtype, needfill) {
    let lowx = q_absx(mx1), lowy = q_absy(my1);
    let hix = q_absx(mx2), hiy = q_absy(my2);
    // do_room_or_subroom(): "locations might bump level edges in wall-less rooms"
    if (!lowx) lowx++;
    if (!lowy) lowy++;
    if (hix >= COLNO - 1) hix = COLNO - 2;
    if (hiy >= ROWNO - 1) hiy = ROWNO - 2;
    if (rlit) {
        for (let x = lowx - 1; x <= hix + 1; x++)
            for (let y = Math.max(lowy - 1, 0); y <= hiy + 1; y++) {
                const loc = game.level?.at(x, y);
                if (loc) loc.lit = true;
            }
    }
    const croom = add_sp_room(lowx, lowy, hix, hiy, rlit, rtype, false,
                              needfill, true);
    // topologize(croom) — mklev.c:1599.  Innards get the room number; the wall
    // ring is marked edge and becomes SHARED when another room already owns it.
    const roomno = croom.roomnoidx + ROOMOFFSET;
    for (let x = lowx; x <= hix; x++)
        for (let y = lowy; y <= hiy; y++) {
            const loc = game.level?.at(x, y);
            if (loc) loc.roomno = roomno;
        }
    const mark = (x, y) => {
        const loc = game.level?.at(x, y);
        if (!loc) return;
        loc.edge = 1;
        loc.roomno = loc.roomno ? SHARED : roomno;
    };
    for (let x = lowx - 1; x <= hix + 1; x++)
        for (let y = lowy - 1; y <= hiy + 1; y += (hiy - lowy + 2)) mark(x, y);
    for (let x = lowx - 1; x <= hix + 1; x += (hix - lowx + 2))
        for (let y = lowy; y <= hiy; y++) mark(x, y);
    add_doors_to_room(croom);
    return croom;
}

// C ref: sp_lev.c create_monster() for a table that CARRIES an `align` key:
// sp_amask_to_amask() takes the `sp_amask & AM_MASK` arm, so induced_align's
// rn2(3) is NOT drawn (unlike every AM_SPLEV_RANDOM monster).  `id` is set, so
// find_montype's gender rn2(2) still is.  The tail is mk_roamer() (priest.c:724)
// — plain makemon plus bookkeeping, no further RNG.
function pri_create_roamer(name, mx, my, peaceful) {
    const pmidx = name_to_pmidx(name);
    const ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    if (!ptr) return null;
    if (ptr.gcode !== 1 && ptr.gcode !== 2
        && name_gender_hint(name) === MGEND_NEUTRAL)
        rn2(2);                                 // find_montype sp_lev.c:3156
    let x = q_absx(mx), y = q_absy(my);
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, ptr);
        if (cc) { x = cc.x; y = cc.y; }
    }
    // MM_EMIN is load-bearing: makemon.c:1414 gives an aligned cleric created
    // WITHOUT it a random roaming alignment (three rn2(3) draws).  mk_roamer
    // sets min_align itself, so C passes the flag and skips them.
    const mtmp = makemon(ptr, x, y, MM_ADJACENTOK | MM_EMIN | MM_NOMSG);
    if (!mtmp) return null;
    mtmp.isminion = 1;
    mtmp.ispriest = 0;
    mtmp.emin = { min_align: A_NONE, renegade: false };
    mtmp.mtrapseen = ~0;                        // mon_learns_traps(ALL_TRAPS)
    mtmp.mpeaceful = peaceful ? 1 : 0;
    mtmp.msleeping = 0;
    return mtmp;
}

// C ref: sp_lev.c create_trap() -> mklev.c mktrap(0, MKTRAP_MAZEFLAG|
// MKTRAP_NOSPIDERONWEB, NULL, &tm).  An explicit coord costs no get_location
// draw; a bare des.trap() runs get_location(DRY)'s rn2(xsize)/rn2(ysize) loop
// first, rejecting stairs/ladders.  Then the type is rolled (retry until not
// NO_TRAP), maketrap runs, and mklev.c:2137's victim check rnd(4) is drawn
// unconditionally (level_difficulty here is far above 4, so it never fires).
const MKTRAP_MAZEFLAG = 0x02, MKTRAP_NOSPIDERONWEB = 0x04;
export async function pri_create_trap(ttyp, mx, my) {
    let x, y;
    if (mx != null) { x = q_absx(mx); y = q_absy(my); }
    else {
        let trycnt = 0;
        do {
            const c = splev_get_location_rnd(LOC_DRY);
            x = c.x; y = c.y;
            const t = game.level?.at(x, y)?.typ;
            if (t !== STAIRS && t !== LADDER) break;
        } while (++trycnt <= 100);
    }
    let kind = ttyp;
    if (!kind) {
        do { kind = splev_traptype_rnd(MKTRAP_MAZEFLAG | MKTRAP_NOSPIDERONWEB); }
        while (kind === 0 /* NO_TRAP */);
    }
    // Pri-loca sets "hardfloor" so Can_fall_thru() is FALSE there and a hole
    // becomes a falling rock trap; Pri-goal does not, so keep the predicate.
    if ((kind === 13 /* HOLE */ || kind === 14 /* TRAPDOOR */)
        && !Can_fall_thru(game.u?.uz)) kind = 3 /* ROCKTRAP */;
    await maketrap(x, y, kind);
    rnd(4);                                      // mktrap victim check mklev.c:2137
}

export async function makemaz_pri_loca() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);

    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    quest_level_init_solidfill();

    // des.level_flags("mazelevel", "hardfloor", "noflip") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.hardfloor = true;
        g.level.flags.noflip = true;
    }

    // des.level_init({ style="mines", fg=".", bg=".", smoothed=false,
    //                  joined=false, lit=1, walled=false })
    // lit is explicit, so litstate_rnd() draws nothing; `filling` is unset
    // (-1) so splev_initlev skips its lvlfill_solid.
    mkmap_mines(ROOM, ROOM, false, false, 1, false);

    // des.map([[...]]) — 40x14, SPLEV_CENTER.  Bare string => lit = FALSE.
    bigrm_load_map(PRI_LOCA_MAP, false);

    g._quest_gen = true;
    g._full_mon_gen = true;
    if (g.level) g.level._splev_fullmon = true;
    try {
        // Four morgue regions round the compound + the irregular temple.
        // filled=1 (FILL_NORMAL): stocked later by fill_special_room().
        pri_region_rect(0, 0, 9, 13, 0, MORGUE, FILL_NORMAL);
        pri_region_rect(9, 0, 30, 1, 0, MORGUE, FILL_NORMAL);
        pri_region_rect(9, 12, 30, 13, 0, MORGUE, FILL_NORMAL);
        pri_region_rect(31, 0, 39, 13, 0, MORGUE, FILL_NORMAL);
        vly_region(11, 3, 29, 10, 1, TEMPLE_RTYPE, FILL_NORMAL, true);

        // des.altar({x=20,y=07, align="noalign", type="shrine"}) — the square
        // is inside the temple region, so create_altar() reaches priestini()
        // (rn2(8) direction scan + the cleric + 2..4 spellbooks + robe rn2(2)).
        vly_altar(20, 7, AM_NONE, 1);

        // des.monster({id="aligned cleric", x=20, y=07, align="noalign",
        //              peaceful=0}) — priestini put its priest on an ADJACENT
        // square, so the altar cell is free and mk_roamer's MON_AT/rloc
        // insurance never fires.
        pri_create_roamer('aligned cleric', 20, 7, false);

        // Doors — explicit states over map-drawn '+' cells, no RNG.
        quest_set_door(10, 6, 'locked'); quest_set_door(10, 7, 'locked');
        quest_set_door(20, 2, 'locked'); quest_set_door(20, 11, 'locked');
        quest_set_door(30, 6, 'locked'); quest_set_door(30, 7, 'locked');

        // Stairs.  The up stairs are deliberately off the 40-wide map.
        quest_place_stair(43, 5, true);
        quest_place_stair(20, 6, false);

        // des.non_diggable(selection.area(10,02,30,13)) — no RNG.
        vly_non_diggable(10, 2, 30, 13);

        // 15 x des.object({coord={x,y}}) — random class at a fixed square.
        for (const [ox, oy] of [[14, 3], [15, 3], [16, 3],
                                [14, 10], [15, 10], [16, 10], [17, 10],
                                [24, 3], [25, 3], [26, 3], [27, 3],
                                [24, 10], [25, 10], [26, 10], [27, 10]])
            splev_object_at({}, ox, oy);

        // Traps: four at fixed coords, then two fully random.
        await pri_create_trap(0, 15, 4);
        await pri_create_trap(0, 25, 4);
        await pri_create_trap(0, 15, 9);
        await pri_create_trap(0, 25, 9);
        await pri_create_trap(0, null, null);
        await pri_create_trap(0, null, null);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // lspo_finalize_level: wallification(1,0,COLNO-1,ROWNO-1).  "noflip" is set
    // so flip_level_rnd() draws nothing.  The trailing fill_special_room() loop
    // that stocks the four morgues runs generically post-mklev.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
}
