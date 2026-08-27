// levels/wiz_common.js - shared des.* machinery for the Wizard of Yendor tower
// levels (wizard1/2/3) and the two decoy towers (fakewiz1/2).
//
// Those five scripts share a shape no already-ported level has: a "mazegrid"
// level_init, a CENTER-aligned des.map submap whose contents() callback carries
// the whole level body, a stocked des.mazewalk() that carves and fills the rest
// of the level, a des.levregion set placed at fixup_special(), and nhlib.lua's
// hell_tweaks() epilogue.  js/mklev.js has private copies of most of this for
// hellfill/castle; none of them are exported, so the pieces are re-derived here
// straight from the C.

import {
    AIR, BR_NO_END1, BR_NO_END2, BR_PORTAL, COLNO, CORR, HWALL, IRONBARS,
    IS_DOOR, IS_STWALL, IS_TREE, LADDER, LA_DOWN, LA_UP, LAVAPOOL,
    LEVEL_TELEP, LR_BRANCH, LR_DOWNSTAIR, LR_DOWNTELE, LR_PORTAL, LR_TELE,
    LR_UPSTAIR, LR_UPTELE, MAGIC_PORTAL, NO_TRAP, ROCKTRAP,
    ROLLING_BOULDER_TRAP, ROOM, ROWNO, SPACE_POS, STAIRS, STONE, TELEP_TRAP,
    TRAPDOOR, TRAPNUM, TRAPPED_CHEST, TRAPPED_DOOR, VIBRATING_SQUARE,
    W_NONDIGGABLE, W_NONPASSWALL,
    is_hole, is_pit, isok, In_endgame, HOLE,
} from '../const.js';
import { dunlevs_in_dungeon } from '../dungeon.js';
import { game } from '../gstate.js';
import { depth } from '../hacklib.js';
import { makemon, mkclass, monster_by_pmidx, name_to_pmidx } from '../makemon.js';
import { BOULDER, GEM_CLASS, RANDOM_CLASS, mkgold, mkobj_at, mksobj_at } from '../mkobj.js';
import { mkportal, mz, walkfrom } from '../mkmaze.js';
import { occupied } from '../mkroom.js';
import { rn2, rnd, rn1 } from '../rng.js';
import {
    l_selection_and, l_selection_grow, l_selection_iterate, l_selection_negate,
    l_selection_or, selection_clone, selection_filter_percent, selection_new,
    selection_numpoints, selection_rndcoord, selection_setpoint, W_ANY,
    W_EAST, W_NORTH, W_RANDOM, W_SOUTH, W_WEST, l_selection_fillrect,
    l_selection_randline, selection_iterate,
} from '../selvar.js';
import {
    SET_LIT_NOCHANGE, bigrm_get_level_extends, selection_match,
    set_levltyp_lit, splev_map_at, splev_map_mark, splev_map_origin,
    splev_map_reset,
} from '../sp_lev.js';
import { maketrap, t_at } from '../trap.js';

// ── per-level reset ─────────────────────────────────────────────────────
// C ref: sp_lev.c load_special() memsets SpLev_Map before the script runs, and
// mkmaze.c fixup_special() frees gl.lregions at its tail (mkmaze.c:701-703).
// Neither list is reset anywhere else in this port — js/sp_lev.js's SpLev_Map
// Set has no caller at all and js/mklev.js's castle levregions are never freed —
// so a wizard level generated after any other special level would otherwise
// inherit both.  A stale SpLev_Map shrinks fill_empty_maze()'s mapfact (its
// rnd(20*mapfact/100) came out rnd(8) instead of rnd(29)); a stale lregion makes
// place_lregions() run someone else's region first.
export function wiz_level_reset() {
    splev_map_reset();
    game.lregions = [];
}

// ── coordinates ─────────────────────────────────────────────────────────
// C ref: sp_lev.c get_location() with croom == NULL — a des.* coordinate is
// relative to the last des.map() origin (gx.xstart / gy.ystart).
export function wiz_loc(x, y) {
    const o = splev_map_origin();
    return { x: x + o.xstart, y: y + o.ystart };
}

// C ref: nhlsel.c l_selection_fillrect() — both corners go through
// get_location_coord() first, so `selection.area()` is map-origin relative.
export function wiz_sel_area(x1, y1, x2, y2) {
    const a = wiz_loc(x1, y1), b = wiz_loc(x2, y2);
    return l_selection_fillrect(null, a.x, a.y, b.x, b.y);
}

// js/sp_lev.js's lspo_map() returns its "selection" as a bare array of {x,y}
// (a local lightweight form), but hell_tweaks() needs the real selvar bitmap so
// the |/& operators work.  Rebuild it exactly the way C's lspo_map does —
// selection_new() then selection_setpoint() per cell — which also leaves
// bounds_dirty set with the sentinel bounds, as C's does.
export function wiz_sel_from_points(pts) {
    const sel = selection_new();
    for (const p of pts || []) selection_setpoint(p.x, p.y, sel, 1);
    return sel;
}

// nhlib.lua's math.random shim: nh.random(lo, hi+1-lo).
export function wiz_mrandom(lo, hi) { return lo + rn2(hi + 1 - lo); }
// nhlib.lua percent(n) — math.random(0,99) < n.
export function wiz_percent(n) { return rn2(100) < n; }

// ── level_init / level_flags ────────────────────────────────────────────
// C ref: sp_lev.c splev_initlev() LVLINIT_MAZEGRID -> lvlfill_maze_grid().
// Unlike the solidfill arm it never touches linit->lit, so NO rn2(2) is drawn.
export function wiz_level_init_mazegrid(bg = HWALL) {
    const corrmaze = !!game.level?.flags?.corrmaze;
    for (let x = 2; x <= mz.x_maze_max; x++)
        for (let y = 0; y <= mz.y_maze_max; y++) {
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            loc.typ = corrmaze ? STONE
                : ((y < 2 || ((x % 2) && (y % 2))) ? STONE : bg);
        }
}

// des.level_flags(...) — no RNG.
export function wiz_level_flags(flags) {
    const f = game.level?.flags;
    if (!f) return;
    for (const name of flags) {
        if (name === 'mazelevel') f.is_maze_lev = true;
        else if (name === 'noteleport') f.noteleport = true;
        else if (name === 'hardfloor') f.hardfloor = true;
        else if (name === 'nommap') f.nommap = true;
        else if (name === 'shortsighted') f.shortsighted = true;
    }
}

// ── mazewalk + fill_empty_maze ──────────────────────────────────────────
// C ref: sp_lev.c maze1xy(m, DRY) — a random odd/odd cell the level loader did
// NOT touch (SpLev_Map) that is a DRY spot.  rn1(x_maze_max-3, 3) per axis.
function wiz_maze1xy() {
    let x = 3, y = 3, tryct = 2000;
    do {
        x = rn1(mz.x_maze_max - 3, 3);
        y = rn1(mz.y_maze_max - 3, 3);
        if (--tryct < 0) break;
    } while (!(x % 2) || !(y % 2) || splev_map_at(x, y) || !wiz_ok_dry(x, y));
    return { x, y };
}

// is_ok_location(x, y, DRY): SPACE_POS terrain with no boulder on it.
function wiz_ok_dry(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc || !SPACE_POS(loc.typ)) return false;
    return !wiz_sobj_at(BOULDER, x, y);
}

function wiz_sobj_at(otyp, x, y) {
    for (const o of game.level?.objects || [])
        if (o && o.otyp === otyp && o.ox === x && o.oy === y) return true;
    return false;
}

// C ref: sp_lev.c rndtrap() — reroll until a trap type this level allows.
function wiz_rndtrap() {
    let rtrap;
    do {
        rtrap = rnd(TRAPNUM - 1);
        switch (rtrap) {
        case HOLE: case VIBRATING_SQUARE: case MAGIC_PORTAL:
            rtrap = NO_TRAP; break;
        case TRAPDOOR:
            if (!wiz_can_dig_down()) rtrap = NO_TRAP;
            break;
        case LEVEL_TELEP: case TELEP_TRAP:
            if (game.level?.flags?.noteleport) rtrap = NO_TRAP;
            break;
        case ROLLING_BOULDER_TRAP: case ROCKTRAP:
            if (In_endgame(game.u?.uz)) rtrap = NO_TRAP;
            break;
        default: break;
        }
    } while (rtrap === NO_TRAP);
    return rtrap;
}

// C ref: dungeon.c Can_dig_down() — !hardfloor && !In_endgame.
function wiz_can_dig_down() {
    return !game.level?.flags?.hardfloor && !In_endgame(game.u?.uz);
}

// C ref: sp_lev.c fill_empty_maze() — proportionally stock whatever part of the
// maze the special level did not cover.  Reached from lspo_mazewalk()'s
// 3-argument form, whose `stocked` defaults to TRUE (sp_lev.c:5780).
async function wiz_fill_empty_maze() {
    const mapcountmax = Math.trunc(((mz.x_maze_max - 2) * (mz.y_maze_max - 2)) / 2);
    let mapcount = (mz.x_maze_max - 2) * (mz.y_maze_max - 2);
    for (let x = 2; x < mz.x_maze_max; x++)
        for (let y = 0; y < mz.y_maze_max; y++)
            if (splev_map_at(x, y)) mapcount--;
    if (mapcount <= Math.trunc(mapcountmax / 10)) return;

    const mapfact = Math.trunc((mapcount * 100) / mapcountmax);
    let cnt;
    for (cnt = rnd(Math.trunc((20 * mapfact) / 100)); cnt; cnt--) {
        const mm = wiz_maze1xy();
        mkobj_at(rn2(2) ? GEM_CLASS : RANDOM_CLASS, mm.x, mm.y, true);
    }
    for (cnt = rnd(Math.trunc((12 * mapfact) / 100)); cnt; cnt--) {
        const mm = wiz_maze1xy();
        const tt = t_at(mm.x, mm.y);
        if (tt && (is_pit(tt.ttyp) || is_hole(tt.ttyp))) continue;
        mksobj_at(BOULDER, mm.x, mm.y, true, false);
    }
    for (cnt = rn2(2); cnt; cnt--) {
        const mm = wiz_maze1xy();
        wiz_makemon(monster_by_pmidx(name_to_pmidx('minotaur')), mm.x, mm.y);
    }
    for (cnt = rnd(Math.trunc((12 * mapfact) / 100)); cnt; cnt--) {
        const mm = wiz_maze1xy();
        wiz_makemon(null, mm.x, mm.y);
    }
    for (cnt = rn2(Math.trunc((15 * mapfact) / 100)); cnt; cnt--) {
        const mm = wiz_maze1xy();
        mkgold(0, mm.x, mm.y);
    }
    for (cnt = rn2(Math.trunc((15 * mapfact) / 100)); cnt; cnt--) {
        const mm = wiz_maze1xy();
        let trytrap = wiz_rndtrap();
        if (wiz_sobj_at(BOULDER, mm.x, mm.y))
            while (is_pit(trytrap) || is_hole(trytrap)) trytrap = wiz_rndtrap();
        await wiz_maketrap(mm.x, mm.y, trytrap);
    }
}

// C ref: trap.c:463-464 — maketrap() refuses TRAPPED_DOOR and TRAPPED_CHEST
// OUTRIGHT ("part of door / part of object; not present on map as a trap"),
// before it allocates anything.  rndtrap() does NOT screen them out, so
// fill_empty_maze() really does ask for them (seed0360 step 330 rolls
// rnd(25)=24 at index 2411) and C silently makes no trap.  js/trap.js's
// maketrap() has no such guard, and the phantom trap it leaves makes
// occupied() reject that square: the branch levregion then needed one extra
// place_lregion() retry, costing two draws.  Guarded here because js/trap.js is
// outside this file's lease; the general fix belongs at the top of maketrap().
function wiz_maketrap(x, y, typ) {
    if (typ === TRAPPED_DOOR || typ === TRAPPED_CHEST) return null;
    return maketrap(x, y, typ);
}

// C ref: sp_lev.c lspo_mazewalk() 3-argument form — an explicit direction (so
// random_wdir() is not called) and stocked=TRUE.
export async function wiz_mazewalk(mx, my, dir) {
    const c = wiz_loc(mx, my);
    let x = c.x, y = c.y;
    if (!isok(x, y)) return;
    // C ref: sp_lev.c lspo_mazewalk():779 `coordxy ftyp = ROOM;` — the
    // corrmaze fallback only applies when an explicit `typ` maps below 1, so
    // the 3-argument des.mazewalk() always digs ROOM.
    const ftyp = ROOM;

    switch (dir) {
    case W_NORTH: y--; break;
    case W_SOUTH: y++; break;
    case W_EAST: x++; break;
    case W_WEST: x--; break;
    default: break;
    }
    let loc = game.level?.at(x, y);
    if (loc && !IS_DOOR(loc.typ)) { loc.typ = ftyp; loc.flags = 0; }
    // walkfrom() needs odd parity, biased away from the entry direction.
    if (!(x % 2)) {
        x += (dir === W_EAST) ? 1 : -1;
        loc = game.level?.at(x, y);
        if (loc) { loc.typ = ftyp; loc.flags = 0; }
    }
    if (!(y % 2)) y += (dir === W_SOUTH) ? 1 : -1;

    walkfrom(x, y, ftyp);
    await wiz_fill_empty_maze();
}

// selvar.js's direction bits, re-exported so the level scripts read like the
// .lua ("east"/"west").
export const WIZ_W_NORTH = W_NORTH, WIZ_W_SOUTH = W_SOUTH,
             WIZ_W_EAST = W_EAST, WIZ_W_WEST = W_WEST;

// ── nhlib.lua hell_tweaks(protected_area) ───────────────────────────────
// Random lava pools, a lava river, and wall-to-boulder / wall-to-iron-bars
// substitutions.  FOUR top-level percent() rolls, always drawn — on most seeds
// every one of them fails and hell_tweaks costs exactly four rn2(100)s.
export function wiz_hell_tweaks(protected_area) {
    const liquid = LAVAPOOL, ground = ROOM;
    const n_prot = selection_numpoints(protected_area);
    const prot = l_selection_negate(protected_area);
    const dep = depth(game.u?.uz);

    // random pools
    if (wiz_percent(20 + dep)) {
        let pools = selection_new();
        const maxpools = 5 + wiz_mrandom(1, dep);
        for (let i = 0; i < maxpools; i++) wiz_sel_set_random(pools);
        pools = l_selection_or(pools,
            l_selection_grow(wiz_sel_set_random(selection_new()), W_WEST));
        pools = l_selection_or(pools,
            l_selection_grow(wiz_sel_set_random(selection_new()), W_NORTH));
        pools = l_selection_or(pools,
            l_selection_grow(wiz_sel_set_random(selection_new()), W_RANDOM));
        pools = l_selection_and(pools, prot);

        if (wiz_percent(80)) {
            const poolground = l_selection_and(
                l_selection_grow(selection_clone(pools), W_ANY), prot);
            const pval = wiz_mrandom(1, 8) * 10;
            wiz_terrain_sel(selection_filter_percent(poolground, pval), ground);
        }
        wiz_terrain_sel(pools, liquid);
    }

    // river
    if (wiz_percent(50)) {
        let allrivers = selection_new();
        const reqpts = ((COLNO * ROWNO) - n_prot) / 12;
        let rpts = 0, rivertries = 0;
        do {
            const floor = selection_match('.');
            const a = wiz_rndcoord(floor);
            const b = wiz_rndcoord(floor);
            const ca = wiz_loc(a.x, a.y), cb = wiz_loc(b.x, b.y);
            let lavariver = l_selection_randline(selection_new(),
                                                 ca.x, ca.y, cb.x, cb.y, 10);
            if (wiz_percent(50)) lavariver = l_selection_grow(lavariver, W_NORTH);
            if (wiz_percent(50)) lavariver = l_selection_grow(lavariver, W_WEST);
            allrivers = l_selection_or(allrivers, lavariver);
            allrivers = l_selection_and(allrivers, prot);
            rpts = selection_numpoints(allrivers);
            rivertries++;
        } while (!(rpts > reqpts || rivertries > 7));

        if (wiz_percent(60)) {
            const prc = 10 * wiz_mrandom(1, 6);
            let riverbanks = l_selection_grow(allrivers, W_ANY);
            riverbanks = l_selection_and(riverbanks, prot);
            wiz_terrain_sel(selection_filter_percent(riverbanks, prc), ground);
        }
        wiz_terrain_sel(allrivers, liquid);
    }

    // replacing some walls with boulders
    if (wiz_percent(20)) {
        const amount = 3 * wiz_mrandom(1, 8);
        let bwalls = l_selection_or(
            selection_filter_percent(selection_match('.w.'), amount),
            selection_filter_percent(selection_match('.\nw\n.'), amount));
        bwalls = l_selection_and(bwalls, prot);
        // C ref: nhlsel.c l_selection_iterate() hands the callback MAP-RELATIVE
        // coordinates, which des.terrain()/des.object() run back through
        // get_location_coord().  y-outer / x-inner fixes the boulders' o_ids.
        const pts = [];
        l_selection_iterate(bwalls, splev_map_origin(), (x, y) => pts.push({ x, y }));
        for (const p of pts) {
            const c = wiz_loc(p.x, p.y);
            set_levltyp_lit(c.x, c.y, ROOM, SET_LIT_NOCHANGE);
            mksobj_at(BOULDER, c.x, c.y, true, true);
        }
    }

    // replacing some walls with iron bars
    if (wiz_percent(20)) {
        const amount = 3 * wiz_mrandom(1, 8);
        let fwalls = l_selection_or(
            selection_filter_percent(selection_match('.w.'), amount),
            selection_filter_percent(selection_match('.\nw\n.'), amount));
        fwalls = l_selection_and(l_selection_grow(fwalls, W_ANY),
                                 selection_match('w'));
        fwalls = l_selection_and(fwalls, prot);
        wiz_terrain_sel(fwalls, IRONBARS);
    }
}

// C ref: sp_lev.c lspo_terrain() over a selection — des.terrain(sel, "X").
function wiz_terrain_sel(sel, typ) {
    selection_iterate(sel, (x, y) => set_levltyp_lit(x, y, typ, SET_LIT_NOCHANGE));
}

// C ref: nhlsel.c l_selection_setpoint() called as sel:set() — a random
// ANY_LOC spot, i.e. two rn2 draws against the current map origin/size.
function wiz_sel_set_random(sel) {
    const o = splev_map_origin();
    const x = o.xstart + rn2(o.xsize);
    const y = o.ystart + rn2(o.ysize);
    selection_setpoint(x, y, sel, 1);
    return sel;
}

// C ref: nhlsel.c l_selection_rndcoord() — the coordinate handed back to Lua is
// made map-origin RELATIVE, and the caller feeds it back through get_location.
function wiz_rndcoord(sel) {
    const c = selection_rndcoord(sel, false);
    if (c.x === -1 && c.y === -1) return c;
    const o = splev_map_origin();
    return { x: c.x - o.xstart, y: c.y - o.ystart };
}

// ── levregions ──────────────────────────────────────────────────────────
// C ref: sp_lev.c levregion_add() — `region_islev` marks the region coordinates
// as already-absolute; the `exclude` rectangle has its own exclude_islev flag,
// which none of the wizard scripts set, so it IS map-relative and gets the
// des.map origin added.  Registration draws nothing.
export function wiz_levregion_add(rtype, inarea, exclude, opts = {}) {
    const g = game;
    if (!g.lregions) g.lregions = [];
    const in_islev = opts.region_islev ?? false;
    const a = in_islev ? { x: inarea[0], y: inarea[1] } : wiz_loc(inarea[0], inarea[1]);
    const b = in_islev ? { x: inarea[2], y: inarea[3] } : wiz_loc(inarea[2], inarea[3]);
    // C: an omitted `exclude` is forced exclude_islev and left at -1,-1,-1,-1.
    const d = exclude ? wiz_loc(exclude[0], exclude[1]) : { x: -1, y: -1 };
    const e = exclude ? wiz_loc(exclude[2], exclude[3]) : { x: -1, y: -1 };
    g.lregions.push({
        rtype, lx: a.x, ly: a.y, hx: b.x, hy: b.y,
        nlx: d.x, nly: d.y, nhx: e.x, nhy: e.y,
        toLevel: opts.toLevel || null,
    });
}

// C ref: sp_lev.c flip_level() "level (teleport) regions" (sp_lev.c:697-733) —
// BOTH inarea and delarea are flipped, unconditionally (there is no in-area
// guard here, unlike the object/monster passes).  No RNG.
export function wiz_flip_lregions(flp) {
    const { minx, maxx, miny, maxy } = bigrm_get_level_extends();
    const fx = (x) => (minx + maxx - x), fy = (y) => (miny + maxy - y);
    for (const r of game.lregions || []) {
        for (const [kx, ky, kx2, ky2] of [['lx', 'ly', 'hx', 'hy'],
                                          ['nlx', 'nly', 'nhx', 'nhy']]) {
            if (flp & 1) {
                r[ky] = fy(r[ky]); r[ky2] = fy(r[ky2]);
                if (r[ky] > r[ky2]) { const t = r[ky]; r[ky] = r[ky2]; r[ky2] = t; }
            }
            if (flp & 2) {
                r[kx] = fx(r[kx]); r[kx2] = fx(r[kx2]);
                if (r[kx] > r[kx2]) { const t = r[kx]; r[kx] = r[kx2]; r[kx2] = t; }
            }
        }
    }
}

// C ref: mkmaze.c place_lregions() — walk the registered lregions in order.
// The LR_*TELE arms only stash the region for goto_level()'s own placement.
export async function wiz_place_lregions() {
    const g = game;
    for (const r of g.lregions || []) {
        if (r.rtype === LR_TELE || r.rtype === LR_UPTELE) {
            g.updest = { lx: r.lx, ly: r.ly, hx: r.hx, hy: r.hy,
                         nlx: r.nlx, nly: r.nly, nhx: r.nhx, nhy: r.nhy };
        }
        if (r.rtype === LR_TELE || r.rtype === LR_DOWNTELE) {
            g.dndest = { lx: r.lx, ly: r.ly, hx: r.hx, hy: r.hy,
                         nlx: r.nlx, nly: r.nly, nhx: r.nhx, nhy: r.nhy };
        }
        if (r.rtype === LR_UPSTAIR || r.rtype === LR_DOWNSTAIR
            || r.rtype === LR_PORTAL || r.rtype === LR_BRANCH)
            await wiz_place_lregion(r);
    }
    // C ref: mkmaze.c:701-703 — fixup_special() frees the list once placed.
    g.lregions = [];
}

// C ref: mkmaze.c place_lregion().  Note the `if (!lx)` shortcut that hands an
// LR_BRANCH straight to place_branch(): every wizard-level levregion carries an
// explicit region starting at x1 == 1, so that arm is never taken and the
// probabilistic rn1 loop always runs.
async function wiz_place_lregion(r) {
    let lx = r.lx, ly = r.ly, hx = r.hx, hy = r.hy;
    if (!lx) { lx = 1; hx = COLNO - 1; ly = 0; hy = ROWNO - 1; }
    if (lx < 1) lx = 1;
    if (hx > COLNO - 1) hx = COLNO - 1;
    if (ly < 0) ly = 0;
    if (hy > ROWNO - 1) hy = ROWNO - 1;
    const oneshot = (lx === hx && ly === hy);
    for (let trycnt = 0; trycnt < 200; trycnt++) {
        const x = rn1((hx - lx) + 1, lx);          // mkmaze.c:396
        const y = rn1((hy - ly) + 1, ly);          // mkmaze.c:397
        if (await wiz_put_lregion_here(x, y, r, oneshot)) return;
    }
    for (let x = lx; x <= hx; x++)
        for (let y = ly; y <= hy; y++)
            if (await wiz_put_lregion_here(x, y, r, true)) return;
}

async function wiz_put_lregion_here(x, y, r, _oneshot) {
    if (wiz_bad_location(x, y, r.nlx, r.nly, r.nhx, r.nhy)) return false;
    switch (r.rtype) {
    case LR_UPSTAIR: wiz_mkstairs(x, y, true); break;
    case LR_DOWNSTAIR: wiz_mkstairs(x, y, false); break;
    case LR_PORTAL:
        await mkportal(x, y, r.toLevel?.dnum ?? 0, r.toLevel?.dlevel ?? 0);
        break;
    case LR_BRANCH:
        await wiz_place_branch(wiz_is_branchlev(), x, y);
        break;
    default: return false;
    }
    return true;
}

// C ref: mkmaze.c bad_location() — occupied, inside the excluded rectangle, or
// not a ROOM / maze-CORR / AIR square.
function wiz_bad_location(x, y, nlx, nly, nhx, nhy) {
    const loc = game.level?.at(x, y);
    if (!loc) return true;
    if (occupied(x, y)) return true;
    if (nlx >= 0 && x >= nlx && x <= nhx && y >= nly && y <= nhy) return true;
    return !((loc.typ === CORR && !!game.level?.flags?.is_maze_lev)
             || loc.typ === ROOM || loc.typ === AIR);
}

// C ref: mklev.c mkstairs() — including the "no stair at the end of a dungeon"
// guard that fires before both stairway_add() and set_levltyp(STAIRS).
function wiz_mkstairs(x, y, up) {
    const g = game;
    if ((g.u?.uz?.dlevel ?? 1) === (up ? 1 : dunlevs_in_dungeon(g.u?.uz))) return;
    const loc = g.level?.at(x, y);
    if (loc) { loc.typ = STAIRS; loc.ladder = up ? LA_UP : LA_DOWN; }
    wiz_stairway_add(x, y, up, false, {
        dnum: g.u?.uz?.dnum ?? 0,
        dlevel: (g.u?.uz?.dlevel ?? 1) + (up ? -1 : 1),
    });
    if (up) { if (g.level) g.level.upstair = { x, y }; }
    else if (g.level) g.level.dnstair = { x, y };
}

// game.stairs is the singly-linked list js/mklev.js's stairway_add() builds.
function wiz_stairway_add(x, y, up, isladder, dest) {
    game.stairs = { sx: x, sy: y, up: !!up, isladder: !!isladder,
                    tolev: { ...dest }, next: game.stairs };
}

// C ref: dungeon.c Is_branchlev().
function wiz_is_branchlev() {
    const g = game;
    const dnum = g.u?.uz?.dnum ?? 0, dlevel = g.u?.uz?.dlevel ?? 1;
    for (const br of g.branches || []) {
        if (br?.end1?.dnum === dnum && br.end1.dlevel === dlevel) return br;
        if (br?.end2?.dnum === dnum && br.end2.dlevel === dlevel) return br;
    }
    return null;
}

// C ref: mklev.c place_branch() with explicit coordinates — no RNG.
async function wiz_place_branch(br, x, y) {
    const g = game;
    if (!br || g.made_branch) return;
    const on_end1 = (br.end1?.dnum === g.u?.uz?.dnum
                     && br.end1?.dlevel === g.u?.uz?.dlevel);
    const dest = on_end1 ? br.end2 : br.end1;
    const make_stairs = on_end1 ? (br.type !== BR_NO_END1)
                                : (br.type !== BR_NO_END2);
    if (br.type === BR_PORTAL) {
        await mkportal(x, y, dest?.dnum ?? 0, dest?.dlevel ?? 0);
    } else if (make_stairs) {
        const goes_up = on_end1 ? !!br.end1_up : !br.end1_up;
        wiz_stairway_add(x, y, goes_up, false, dest || { dnum: 0, dlevel: 0 });
        const loc = g.level?.at(x, y);
        if (loc) { loc.typ = STAIRS; loc.ladder = goes_up ? LA_UP : LA_DOWN; }
        if (goes_up) g.level.upstair = { x, y };
        else g.level.dnstair = { x, y };
    }
    g.made_branch = true;
}

// C ref: sp_lev.c l_create_stairway() with is_ladder — the cell becomes LADDER,
// the stairway list gets an isladder entry, and SpLev_Map marks the square.
export function wiz_ladder(up, mx, my) {
    const c = wiz_loc(mx, my);
    const g = game;
    if ((g.u?.uz?.dlevel ?? 1) === (up ? 1 : dunlevs_in_dungeon(g.u?.uz))) return;
    const loc = g.level?.at(c.x, c.y);
    if (loc) { loc.typ = LADDER; loc.ladder = up ? LA_UP : LA_DOWN; }
    wiz_stairway_add(c.x, c.y, up, true, {
        dnum: g.u?.uz?.dnum ?? 0,
        dlevel: (g.u?.uz?.dlevel ?? 1) + (up ? -1 : 1),
    });
    if (up) { if (g.level) g.level.upstair = { x: c.x, y: c.y }; }
    else if (g.level) g.level.dnstair = { x: c.x, y: c.y };
    splev_map_mark(c.x, c.y);
}

// ── wall properties ─────────────────────────────────────────────────────
// C ref: sp_lev.c set_wallprop_in_selection() -> set_wall_property().  No RNG.
function wiz_set_wallprop(sel, prop) {
    selection_iterate(sel, (x, y) => {
        const loc = game.level?.at(x, y);
        if (!loc) return;
        if (IS_STWALL(loc.typ) || IS_TREE(loc.typ) || loc.typ === IRONBARS)
            loc.wall_info = (loc.wall_info || 0) | prop;
    });
}
export function wiz_non_diggable(sel) { wiz_set_wallprop(sel, W_NONDIGGABLE); }
export function wiz_non_passwall(sel) { wiz_set_wallprop(sel, W_NONPASSWALL); }

// ── monsters ────────────────────────────────────────────────────────────
// C ref: sp_lev.c fill_empty_maze()'s two makemon() calls, both NO_MM_FLAGS.
function wiz_makemon(mdat, x, y) {
    return makemon(mdat, x, y, 0);
}

// C ref: include/defsym.h MONSYM() — the des.monster("X") class letters.
export const WIZ_MONSYM = {
    a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10,
    k: 11, l: 12, m: 13, n: 14, o: 15, p: 16, q: 17, r: 18, s: 19, t: 20,
    u: 21, v: 22, w: 23, x: 24, y: 25, z: 26,
    A: 27, B: 28, C: 29, D: 30, E: 31, F: 32, G: 33, H: 34, I: 35, J: 36,
    K: 37, L: 38, M: 39, N: 40, O: 41, P: 42, Q: 43, R: 44, S: 45, T: 46,
    U: 47, V: 48, W: 49, X: 50, Y: 51, Z: 52,
    '@': 53, ' ': 54, "'": 55, '&': 56, ';': 57, ':': 58, '~': 59, ']': 60,
};

// C ref: objclass.h def_char_to_objclass() for the class chars these scripts use.
export const WIZ_OBJSYM = {
    '"': 5 /* AMULET_CLASS */, ')': 2 /* WEAPON_CLASS */, '[': 3 /* ARMOR_CLASS */,
    '!': 8 /* POTION_CLASS */, '?': 9 /* SCROLL_CLASS */, '+': 10 /* SPBOOK_CLASS */,
    '/': 11 /* WAND_CLASS */, '=': 4 /* RING_CLASS */, '(': 6 /* TOOL_CLASS */,
    '*': 13 /* GEM_CLASS */,
};

// mkclass() is re-exported so the level scripts don't need makemon.js directly.
export { mkclass };
