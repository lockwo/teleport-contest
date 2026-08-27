// levels/gehennom.js — machinery shared by the four Gehennom demon-lord lairs
// (asmodeus / baalz / juiblex / orcus).  Everything here is a direct port of a
// C function that js/mklev.js already implements privately for hellfill and the
// castle; those copies are not exported and mklev.js is a shared file, so the
// lair builders carry their own.
//
// C refs: sp_lev.c (lspo_mazewalk / fill_empty_maze / maze1xy / lvlfill_*),
// mkmaze.c (place_lregion / bad_location / put_lregion_here) and
// dat/nhlib.lua (hell_tweaks / percent / shuffle).

import {
    AIR, COLNO, CORR, HOLE, IRONBARS, IS_DOOR, In_endgame, LAVAPOOL, LEVEL_TELEP,
    MAGIC_PORTAL, NO_TRAP, ROCKTRAP, ROLLING_BOULDER_TRAP, ROOM, ROWNO, STAIRS,
    STONE, TELEP_TRAP, TRAPDOOR, TRAPNUM, VIBRATING_SQUARE, isok,
} from '../const.js';
import { game } from '../gstate.js';
import { depth as depth_of_level } from '../hacklib.js';
import { makemon, mkclass, monster_by_pmidx, name_gender_hint, name_to_pmidx,
         MGEND_NEUTRAL } from '../makemon.js';
import { walkfrom, mz } from '../mkmaze.js';
import { BOULDER, GEM_CLASS, RANDOM_CLASS, mkgold, mkobj_at, mksobj_at } from '../mkobj.js';
import { occupied } from '../mkroom.js';
import { rn1, rn2, rnd } from '../rng.js';
import {
    SET_LIT_NOCHANGE, bigrm_get_level_extends, is_ok_location, percent,
    selection_match, set_levltyp_lit, splev_map_at, splev_map_mark,
    splev_map_origin, LOC_DRY,
} from '../sp_lev.js';
import {
    W_ANY, W_EAST, W_NORTH, W_RANDOM, W_SOUTH, W_WEST, l_selection_and,
    l_selection_fillrect, l_selection_grow, l_selection_iterate, l_selection_negate,
    l_selection_or, l_selection_randline, selection_clone, selection_filter_percent,
    selection_getbounds, selection_iterate, selection_new, selection_numpoints,
    selection_rndcoord, selection_setpoint,
} from '../selvar.js';
import { Can_dig_down, maketrap, t_at } from '../trap.js';

export { W_EAST, W_NORTH, W_SOUTH, W_WEST };

// C ref: dungeon.h:36 — the levregion rtypes des.levregion() can carry.
export const LR_DOWNSTAIR = 0, LR_UPSTAIR = 1, LR_PORTAL = 2, LR_BRANCH = 3,
             LR_TELE = 4, LR_UPTELE = 5, LR_DOWNTELE = 6;

// C ref: trap.h is_pit / is_hole.
const PIT = 11, SPIKED_PIT_T = 12;
const is_pit_t = (t) => t === PIT || t === SPIKED_PIT_T;
const is_hole_t = (t) => t === HOLE || t === TRAPDOOR;

// C ref: nhlib.lua math.random(lo,hi) — the two-argument Lua form is
// lo + rn2(hi + 1 - lo); a bare math.random(n) is 1 + rn2(n).
export function geh_mrandom(lo, hi) { return lo + rn2(hi + 1 - lo); }
export const geh_percent = percent;

// C ref: sp_lev.c get_location() with croom == NULL — a des.* coordinate is
// relative to the last des.map() origin (gx.xstart / gy.ystart).
export function geh_loc(x, y) {
    const o = splev_map_origin();
    return { x: x + o.xstart, y: y + o.ystart };
}

// C ref: nhlsel.c l_selection_fillrect — selection.area(x1,y1,x2,y2); both
// corners go through get_location_coord() first, so they are map-relative.
export function geh_sel_area(x1, y1, x2, y2) {
    const a = geh_loc(x1, y1), b = geh_loc(x2, y2);
    return l_selection_fillrect(null, a.x, a.y, b.x, b.y);
}

// C ref: sp_lev.c lspo_terrain() — des.terrain(selection, "X").  No RNG.
export function geh_terrain_sel(sel, typ, tolit = SET_LIT_NOCHANGE) {
    selection_iterate(sel, (x, y) => set_levltyp_lit(x, y, typ, tolit));
}

// C ref: sp_lev.c lspo_terrain() 3-argument form des.terrain(x, y, "X").
export function geh_terrain_at(x, y, typ) {
    const c = geh_loc(x, y);
    set_levltyp_lit(c.x, c.y, typ, SET_LIT_NOCHANGE);
}

// C ref: sp_lev.c lvlfill_solid() — des.level_init({style="solidfill"}) with an
// EXPLICIT lit, so no BOOL_RANDOM rn2(2) (quest_level_init_solidfill draws it).
export function geh_lvlfill_solid(filling, lit) {
    for (let x = 2; x <= mz.x_maze_max; x++)
        for (let y = 0; y <= mz.y_maze_max; y++) {
            if (!set_levltyp_lit(x, y, filling, lit)) continue;
            const loc = game.level.at(x, y);
            loc.flags = 0;
            loc.horizontal = false;
            loc.roomno = 0;
            loc.edge = false;
        }
}

// C ref: sp_lev.c lvlfill_maze_grid() — des.level_init({style="mazegrid"}).
// No RNG.  splev_initlev() calls it as lvlfill_maze_grid(2, 0, x_maze_max,
// y_maze_max, bg).
export function geh_lvlfill_maze_grid(filling) {
    const corrmaze = !!game.level?.flags?.corrmaze;
    for (let x = 2; x <= mz.x_maze_max; x++)
        for (let y = 0; y <= mz.y_maze_max; y++) {
            const loc = game.level.at(x, y);
            if (!loc) continue;
            loc.typ = corrmaze ? STONE
                : ((y < 2 || ((x % 2) && (y % 2))) ? STONE : filling);
        }
}

// C ref: sp_lev.c SpLev_Map / is_ok_location(x, y, DRY).
const geh_splev_at = splev_map_at;
function geh_ok_dry(x, y) { return is_ok_location(x, y, LOC_DRY); }
function geh_sobj_at(otyp, x, y) {
    for (const o of game.level?.objects || [])
        if (o.otyp === otyp && o.ox === x && o.oy === y) return true;
    return false;
}

// C ref: sp_lev.c maze1xy(m, DRY) — a random odd/odd cell the level loader did
// not touch.  Each retry costs the two rn1 draws, which is why the recorded
// traces are dominated by this function.
function geh_maze1xy() {
    let x = 3, y = 3, tryct = 2000;
    do {
        x = rn1(mz.x_maze_max - 3, 3);          // sp_lev.c:2908
        y = rn1(mz.y_maze_max - 3, 3);          // sp_lev.c:2909
        if (--tryct < 0) break;
    } while (!(x % 2) || !(y % 2) || geh_splev_at(x, y) || !geh_ok_dry(x, y));
    return { x, y };
}

// C ref: sp_lev.c rndtrap() — reroll until a trap type allowed on this level.
function geh_rndtrap() {
    let rtrap;
    do {
        rtrap = rnd(TRAPNUM - 1);                // sp_lev.c:1164
        switch (rtrap) {
        case HOLE: case VIBRATING_SQUARE: case MAGIC_PORTAL:
            rtrap = NO_TRAP; break;
        case TRAPDOOR:
            if (!Can_dig_down(game.u?.uz)) rtrap = NO_TRAP;
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

// C ref: sp_lev.c fill_empty_maze() — proportionally stock whatever part of the
// maze the special level did not cover.
async function geh_fill_empty_maze() {
    const mapcountmax = Math.trunc(((mz.x_maze_max - 2) * (mz.y_maze_max - 2)) / 2);
    let mapcount = (mz.x_maze_max - 2) * (mz.y_maze_max - 2);
    for (let x = 2; x < mz.x_maze_max; x++)
        for (let y = 0; y < mz.y_maze_max; y++)
            if (geh_splev_at(x, y)) mapcount--;
    if (mapcount <= Math.trunc(mapcountmax / 10)) return;

    const mapfact = Math.trunc((mapcount * 100) / mapcountmax);
    let cnt;
    for (cnt = rnd(Math.trunc((20 * mapfact) / 100)); cnt; cnt--) {   // :2942
        const mm = geh_maze1xy();
        mkobj_at(rn2(2) ? GEM_CLASS : RANDOM_CLASS, mm.x, mm.y, true); // :2944
    }
    for (cnt = rnd(Math.trunc((12 * mapfact) / 100)); cnt; cnt--) {   // :2947
        const mm = geh_maze1xy();
        const tt = t_at(mm.x, mm.y);
        if (tt && (is_pit_t(tt.ttyp) || is_hole_t(tt.ttyp))) continue;
        mksobj_at(BOULDER, mm.x, mm.y, true, false);
    }
    for (cnt = rn2(2); cnt; cnt--) {                                  // :2956
        const mm = geh_maze1xy();
        makemon(monster_by_pmidx(name_to_pmidx('minotaur')), mm.x, mm.y, 0);
    }
    for (cnt = rnd(Math.trunc((12 * mapfact) / 100)); cnt; cnt--) {   // :2960
        const mm = geh_maze1xy();
        makemon(null, mm.x, mm.y, 0);
    }
    for (cnt = rn2(Math.trunc((15 * mapfact) / 100)); cnt; cnt--) {   // :2964
        const mm = geh_maze1xy();
        mkgold(0, mm.x, mm.y);
    }
    for (cnt = rn2(Math.trunc((15 * mapfact) / 100)); cnt; cnt--) {   // :2968
        const mm = geh_maze1xy();
        let trytrap = geh_rndtrap();
        if (geh_sobj_at(BOULDER, mm.x, mm.y))
            while (is_pit_t(trytrap) || is_hole_t(trytrap)) trytrap = geh_rndtrap();
        await maketrap(mm.x, mm.y, trytrap);
    }
}

// C ref: sp_lev.c lspo_mazewalk().  The 3-argument des.mazewalk(x, y, "dir")
// form leaves fstocked at its default 1, so fill_empty_maze() DOES run (unlike
// hellfill.lua's table form, which passes stocked=false).
export async function geh_mazewalk(mx, my, dir) {
    const c = geh_loc(mx, my);
    let x = c.x, y = c.y;
    if (!isok(x, y)) return;
    // C ref: sp_lev.c lspo_mazewalk():779 — `coordxy ftyp = ROOM;` is the
    // INITIALISER, and only the table form's `typ = "<mapchr>"` can change it.
    // The `if (ftyp < 1) ftyp = corrmaze ? CORR : ROOM;` fallback below it is
    // therefore dead for every des.mazewalk() in dat/: the 3-argument
    // positional form never touches ftyp.  baalz.lua is the only level that
    // sets corrmaze, so it (alone) got a CORR maze here where C digs ROOM —
    // one '#' where the recorder shows the DEC room dot.
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
    await geh_fill_empty_maze();
}

// ── nhlib.lua hell_tweaks(protected_area) ────────────────────────────────
// C ref: dat/nhlib.lua:57.  Random lava pools, a lava river, and
// wall-to-boulder / wall-to-iron-bars substitutions.  Every percent()/
// math.random() here is a live draw; port the call, never the outcome.

// C ref: nhlsel.c l_selection_setpoint() called as sel:set() with no args — a
// random ANY_LOC spot, i.e. two rn2 draws against the current map origin/size.
function geh_sel_set_random(sel) {
    const o = splev_map_origin();
    const x = o.xstart + rn2(o.xsize);
    const y = o.ystart + rn2(o.ysize);
    selection_setpoint(x, y, sel, 1);
    return sel;
}

// C ref: nhlsel.c l_selection_rndcoord() — the coordinate handed back to Lua is
// made map-origin RELATIVE, and des.terrain/des.object re-add the origin.
function geh_rndcoord(sel) {
    const c = selection_rndcoord(sel, false);
    if (c.x === -1 && c.y === -1) return c;
    const o = splev_map_origin();
    return { x: c.x - o.xstart, y: c.y - o.ystart };
}

// des.object("boulder", x, y) — a named object at a fixed map-relative spot.
export function geh_object_at(otyp, x, y) {
    const c = geh_loc(x, y);
    return mksobj_at(otyp, c.x, c.y, true, true);
}

export function geh_hell_tweaks(protected_area) {
    const liquid = LAVAPOOL, ground = ROOM;
    const n_prot = selection_numpoints(protected_area);
    const prot = l_selection_negate(protected_area);
    const depth = depth_of_level(game.u?.uz);

    // random pools
    if (percent(20 + depth)) {
        let pools = selection_new();
        const maxpools = 5 + geh_mrandom(1, depth);
        for (let i = 0; i < maxpools; i++) geh_sel_set_random(pools);
        pools = l_selection_or(pools,
            l_selection_grow(geh_sel_set_random(selection_new()), W_WEST));
        pools = l_selection_or(pools,
            l_selection_grow(geh_sel_set_random(selection_new()), W_NORTH));
        pools = l_selection_or(pools,
            l_selection_grow(geh_sel_set_random(selection_new()), W_RANDOM));
        pools = l_selection_and(pools, prot);

        if (percent(80)) {
            const poolground = l_selection_and(
                l_selection_grow(selection_clone(pools), W_ANY), prot);
            const pval = geh_mrandom(1, 8) * 10;
            geh_terrain_sel(selection_filter_percent(poolground, pval), ground);
        }
        geh_terrain_sel(pools, liquid);
    }

    // river
    if (percent(50)) {
        let allrivers = selection_new();
        const reqpts = ((COLNO * ROWNO) - n_prot) / 12;
        let rpts = 0, rivertries = 0;
        do {
            const floor = selection_match('.');
            const a = geh_rndcoord(floor);
            const b = geh_rndcoord(floor);
            const ca = geh_loc(a.x, a.y), cb = geh_loc(b.x, b.y);
            let lavariver = l_selection_randline(selection_new(),
                                                 ca.x, ca.y, cb.x, cb.y, 10);
            if (percent(50)) lavariver = l_selection_grow(lavariver, W_NORTH);
            if (percent(50)) lavariver = l_selection_grow(lavariver, W_WEST);
            allrivers = l_selection_or(allrivers, lavariver);
            allrivers = l_selection_and(allrivers, prot);
            rpts = selection_numpoints(allrivers);
            rivertries++;
        } while (!(rpts > reqpts || rivertries > 7));

        if (percent(60)) {
            const prc = 10 * geh_mrandom(1, 6);
            let riverbanks = l_selection_grow(allrivers, W_ANY);
            riverbanks = l_selection_and(riverbanks, prot);
            geh_terrain_sel(selection_filter_percent(riverbanks, prc), ground);
        }
        geh_terrain_sel(allrivers, liquid);
    }

    // replacing some walls with boulders
    if (percent(20)) {
        const amount = 3 * geh_mrandom(1, 8);
        let bwalls = l_selection_or(
            selection_filter_percent(selection_match('.w.'), amount),
            selection_filter_percent(selection_match('.\nw\n.'), amount));
        bwalls = l_selection_and(bwalls, prot);
        // C ref: nhlsel.c l_selection_iterate() hands the callback MAP-RELATIVE
        // coordinates; the y-outer/x-inner walk fixes the boulders' o_id order.
        const pts = [];
        l_selection_iterate(bwalls, splev_map_origin(), (x, y) => pts.push({ x, y }));
        for (const p of pts) {
            geh_terrain_at(p.x, p.y, ROOM);
            geh_object_at(BOULDER, p.x, p.y);
        }
    }

    // replacing some walls with iron bars
    if (percent(20)) {
        const amount = 3 * geh_mrandom(1, 8);
        let fwalls = l_selection_or(
            selection_filter_percent(selection_match('.w.'), amount),
            selection_filter_percent(selection_match('.\nw\n.'), amount));
        fwalls = l_selection_and(l_selection_grow(fwalls, W_ANY),
                                 selection_match('w'));
        fwalls = l_selection_and(fwalls, prot);
        geh_terrain_sel(fwalls, IRONBARS);
    }
}

// js/sp_lev.js models "the selection lspo_map returns" as a plain array of
// {x,y} (its own private selection_new()), while the selvar.js operators the
// des.* selection algebra needs want a Selection.  Convert, preserving the
// map-load order so the cached bounds come out identical.
export function geh_sel_from_points(pts) {
    const sel = selection_new();
    for (const p of pts || []) selection_setpoint(p.x, p.y, sel, 1);
    return sel;
}

// ── mkmaze.c place_lregions() ────────────────────────────────────────────
// The lairs register two whole-level levregions (a "stair-up" and a "branch"),
// which mklev.js's single-slot quest_place_branch() cannot express — and none
// of them honours the levregion's `exclude` rectangle, whose rejections are
// worth real PRNG draws.  Ported in full here.

// C ref: mkmaze.c bad_location().
function geh_bad_location(x, y, nlx, nly, nhx, nhy) {
    const loc = game.level?.at(x, y);
    if (!loc) return true;
    if (occupied(x, y)) return true;
    if (nlx > 0 && x >= nlx && x <= nhx && y >= nly && y <= nhy) return true;
    const is_maze = !!game.level?.flags?.is_maze_lev;
    return !((loc.typ === CORR && is_maze) || loc.typ === ROOM || loc.typ === AIR);
}

// C ref: mkmaze.c put_lregion_here().  The lairs' rtypes are LR_UPSTAIR (a
// plain mkstairs) and LR_BRANCH; none of asmodeus/juiblex/baalz/orcus is a
// branch level, so place_branch(Is_branchlev(), ...) is a no-op there and the
// only observable effect is the accept/reject that ends the rn1 retry loop.
function geh_put_lregion_here(x, y, reg, oneshot) {
    if (geh_bad_location(x, y, reg.nlx, reg.nly, reg.nhx, reg.nhy)) {
        if (!oneshot) return false;
        return false;
    }
    if (reg.rtype === LR_UPSTAIR || reg.rtype === LR_DOWNSTAIR) {
        const loc = game.level.at(x, y);
        loc.typ = STAIRS;
        if (!game.stairs) game.stairs = [];
        const up = reg.rtype === LR_UPSTAIR;
        game.stairs.push({ sx: x, sy: y, up });
        if (up) { game.upstair = { x, y }; if (game.level) game.level.upstair = { x, y }; }
        else { game.dnstair = { x, y }; if (game.level) game.level.dnstair = { x, y }; }
    }
    return true;
}

// C ref: sp_lev.c flip_level()'s "level (teleport) regions" block — every
// registered levregion's inarea AND delarea is flipped UNCONDITIONALLY (no
// "is it inside the level extents" test, unlike the map cells), then the
// corners are re-sorted.  Load-bearing: place_lregion() then CLAMPS the flipped
// rectangle to the map, and that clamp is what changes an lregion's size and
// therefore the modulus of its rn1 draws.  On seed0360 orcus the y range goes
// 21 -> 19 exactly this way.
export function geh_flip_lregions(flp, regions) {
    if ((flp & 3) === 0) return;
    const { minx, maxx, miny, maxy } = bigrm_get_level_extends();
    const FlipX = (x) => (minx + maxx - x);
    const FlipY = (y) => (miny + maxy - y);
    for (const r of regions) {
        if (flp & 1) {
            let a = FlipY(r.ly), b = FlipY(r.hy);
            if (a > b) { const t = a; a = b; b = t; }
            r.ly = a; r.hy = b;
            let c = FlipY(r.nly), d = FlipY(r.nhy);
            if (c > d) { const t = c; c = d; d = t; }
            r.nly = c; r.nhy = d;
        }
        if (flp & 2) {
            let a = FlipX(r.lx), b = FlipX(r.hx);
            if (a > b) { const t = a; a = b; b = t; }
            r.lx = a; r.hx = b;
            let c = FlipX(r.nlx), d = FlipX(r.nhx);
            if (c > d) { const t = c; c = d; d = t; }
            r.nlx = c; r.nhx = d;
        }
    }
}

// C ref: mkmaze.c place_lregion() — clamp the area to the map, then 200
// probabilistic tries (two rn1 draws each), then a deterministic scan.
export function geh_place_lregion(reg) {
    let { lx, ly, hx, hy } = reg;
    if (lx < 1) lx = 1;
    if (hx > COLNO - 1) hx = COLNO - 1;
    if (ly < 0) ly = 0;
    if (hy > ROWNO - 1) hy = ROWNO - 1;
    const oneshot = (lx === hx && ly === hy);
    for (let trycnt = 0; trycnt < 200; trycnt++) {
        const x = rn1((hx - lx) + 1, lx);        // mkmaze.c:396
        const y = rn1((hy - ly) + 1, ly);        // mkmaze.c:397
        if (geh_put_lregion_here(x, y, reg, oneshot)) return;
    }
    for (let x = lx; x <= hx; x++)
        for (let y = ly; y <= hy; y++)
            if (geh_put_lregion_here(x, y, reg, true)) return;
}

// C ref: mkmaze.c fixup_special() — walk the registered levregions in
// registration order.  LR_*TELE entries are only SAVED (goto_level() runs their
// place_lregion itself, and it re-reads the exclusion rectangle, which is why
// the region is stored whole rather than as bare corners).
export function geh_place_lregions(regions) {
    for (const reg of regions) {
        if (reg.rtype === LR_TELE || reg.rtype === LR_UPTELE
            || reg.rtype === LR_DOWNTELE) {
            const box = { lx: reg.lx, ly: reg.ly, hx: reg.hx, hy: reg.hy,
                          nlx: reg.nlx, nly: reg.nly, nhx: reg.nhx, nhy: reg.nhy };
            if (reg.rtype === LR_TELE || reg.rtype === LR_UPTELE)
                game.updest = { ...box };
            if (reg.rtype === LR_TELE || reg.rtype === LR_DOWNTELE)
                game.dndest = { ...box };
            continue;
        }
        geh_place_lregion(reg);
    }
}

// ── des.monster / des.object at fixed map-relative coordinates ───────────

// C ref: sp_lev.c create_monster() for des.monster("name", x, y) and
// des.monster("X", x, y).  Draw order: find_montype's gender rn2(2) (named
// species only, during lspo_monster's PARSE), induced_align's rn2(3), then
// mkclass for a bare class char, then makemon.
export function geh_monster_at(spec, mx, my, peaceful = null) {
    const isClass = spec.length === 1;
    let ptr = null;
    if (!isClass) {
        const pmidx = name_to_pmidx(spec);
        ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
        if (ptr && ptr.gcode !== 1 && ptr.gcode !== 2
            && name_gender_hint(spec) === MGEND_NEUTRAL)
            rn2(2);                                 // find_montype sp_lev.c:3156
    }
    rn2(3);                                         // induced_align dungeon.c:2012
    if (isClass) ptr = mkclass(GEH_MONSYM[spec] ?? 0, 0x0200 /* G_NOGEN */);
    const c = geh_loc(mx, my);
    const mtmp = makemon(ptr, c.x, c.y, 0);
    if (mtmp && peaceful != null) mtmp.mpeaceful = peaceful ? 1 : 0;
    return mtmp;
}

// C ref: include/defsym.h MONSYM() — class letter -> S_* index.
export const GEH_MONSYM = {
    a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10,
    k: 11, l: 12, m: 13, n: 14, o: 15, p: 16, q: 17, r: 18, s: 19, t: 20,
    u: 21, v: 22, w: 23, x: 24, y: 25, z: 26,
    A: 27, B: 28, C: 29, D: 30, E: 31, F: 32, G: 33, H: 34, I: 35, J: 36,
    K: 37, L: 38, M: 39, N: 40, O: 41, P: 42, Q: 43, R: 44, S: 45, T: 46,
    U: 47, V: 48, W: 49, X: 50, Y: 51, Z: 52,
    '@': 53, ' ': 54, "'": 55, '&': 56, ';': 57, ':': 58, '~': 59, ']': 60,
};

export { geh_splev_at, geh_ok_dry, geh_rndcoord, geh_sel_set_random, splev_map_mark };
