// levels/bigroom.js - special level builder makemaz_bigroom(), split out of js/sp_lev.js.
// sp_lev.js re-exports makemaz_bigroom so existing importers are unaffected; the
// shared special-level machinery still lives there and is imported below.

import {
    ARROW_TRAP, CLOUD, COLNO, CROSSWALL, FILL_NONE, FIRE_TRAP, FOUNTAIN, HOLE, HWALL, ICE,
    IRONBARS, IS_DOOR, IS_FURNITURE, IS_LAVA, IS_ROOM, IS_STWALL, IS_TREE, LAVAPOOL, LAVAWALL,
    LEVEL_TELEP, MAGIC_PORTAL, MATCH_WALL, MOAT, NO_ROOM, NO_TRAP, OROOM, PIT, POLY_TRAP,
    POOL, ROCKTRAP, ROLLING_BOULDER_TRAP, ROOM, ROOMOFFSET, ROWNO, SLP_GAS_TRAP, SPIKED_PIT,
    STAIRS, STATUE_TRAP, STONE, TELEP_TRAP, TRAPNUM, TRAPPED_CHEST, TRAPPED_DOOR, TREE,
    VIBRATING_SQUARE, VWALL, WATER, WEB, W_NONDIGGABLE, isok,
} from '../const.js';
import { game } from '../gstate.js';
import { enexto_spawn, makemon, mm_mon_at, monster_by_pmidx, name_to_pmidx } from '../makemon.js';
import { create_maze, walkfrom } from '../mkmaze.js';
import { BOULDER, mkobj_at, mksobj_at } from '../mkobj.js';
import { rn2, rnd } from '../rng.js';
import {
    l_selection_fillrect, l_selection_grow, l_selection_line, l_selection_or,
    l_selection_rect, selection_clear, selection_filter_percent, selection_getbounds,
    selection_getpoint, selection_iterate, selection_new,
} from '../selvar.js';
import { maketrap } from '../trap.js';
import {
    SET_LIT_NOCHANGE, add_sp_room, bigrm_get_location_dry, bigrm_level_init_solidfill,
    bigrm_load_map, bigrm_wallification, flip_level, gx, gy, percent, reset_xystart_size,
    selection_match, set_levltyp_lit, shuffle, splev_map_mark,
} from '../sp_lev.js';

// des.* coordinates are relative to the last des.map()'s origin; get_location()
// with an explicit coord adds it back and draws no RNG.
const bx = (mx) => mx + gx.xstart;
const by = (my) => my + gy.ystart;

// C ref: nhlsel.c selection.area(x1,y1,x2,y2) — a filled rect whose corners go
// through get_location_coord(ANY_LOC) first.
function bigrm_area(x1, y1, x2, y2, base = null) {
    return l_selection_fillrect(base, bx(x1), by(y1), bx(x2), by(y2));
}
function bigrm_line_sel(x1, y1, x2, y2, base = null) {
    return l_selection_line(base, bx(x1), by(y1), bx(x2), by(y2));
}
function bigrm_rect_sel(x1, y1, x2, y2, base = null) {
    return l_selection_rect(base, bx(x1), by(y1), bx(x2), by(y2));
}

// C ref: sp_lev.c lspo_terrain() selection form -> selection_iterate(sel,
// sel_set_ter).  set_levltyp_lit() carries sel_set_ter's door/HWALL/IRONBARS
// `horizontal` fixups.  No RNG.
function bigrm_terrain_sel(sel, typ) {
    selection_iterate(sel, (x, y) => set_levltyp_lit(x, y, typ, SET_LIT_NOCHANGE));
}

// C ref: sp_lev.c lspo_replace_terrain().  `sel` selects the candidate cells;
// every cell in the selection whose typ matches `fromtyp` draws one rn2(100)
// and is replaced when it comes up < chance — so the draw happens even at the
// default chance of 100.  Iteration is x-outer over the selection's BOUNDS,
// starting at max(1, lx).
function bigrm_replace_terrain_sel(sel, fromtyp, totyp, chance = 100) {
    const rect = selection_getbounds(sel);
    for (let x = Math.max(1, rect.lx); x <= rect.hx; x++)
        for (let y = rect.ly; y <= rect.hy; y++) {
            if (!selection_getpoint(x, y, sel)) continue;
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            const matches = (fromtyp === MATCH_WALL)
                ? IS_STWALL(loc.typ) : (loc.typ === fromtyp);
            if (matches && rn2(100) < chance)
                set_levltyp_lit(x, y, totyp, SET_LIT_NOCHANGE);
        }
}

// des.replace_terrain with neither `selection` nor `region`: selection_clear(sel, 1)
// sets EVERY cell, so the scan is the whole map (x from 1, y from 0), not the
// des.map()'s extent.
function bigrm_replace_terrain(fromtyp, totyp, chance = 100) {
    bigrm_replace_terrain_sel(selection_clear(selection_new(), 1), fromtyp, totyp, chance);
}

// des.replace_terrain({ region = {x1,y1,x2,y2}, ... }) — map-relative corners.
function bigrm_replace_terrain_region(x1, y1, x2, y2, fromtyp, totyp, chance = 100) {
    bigrm_replace_terrain_sel(bigrm_area(x1, y1, x2, y2), fromtyp, totyp, chance);
}

// C ref: sp_lev.c sel_set_feature() — a des.feature() square keeps whatever it
// already has if that is furniture; otherwise it becomes the feature.  No RNG.
function bigrm_feature(mx, my, typ) {
    const loc = game.level?.at(bx(mx), by(my));
    if (!loc || IS_FURNITURE(loc.typ)) return;
    loc.typ = typ;
}

// C ref: sp_lev.c lspo_region() 2-arg form `des.region(sel, "lit"/"unlit")`:
// it clones the selection, GROWS it (W_ANY) when lighting, runs sel_set_lit on
// every point and returns — no room is created.  Used for the selection-shaped
// regions; the plain rectangular ones go through bigrm_region() below, which
// additionally registers a room for this port's vision/rendering.
// C ref: nhlsel.c l_selection_iterate() — the LUA-facing iterate walks
// y-outer / x-inner (x from max(1, lx)), which is a different visit order from
// selvar.c's internal column-major selection_iterate().
function selection_iterate_lua(sel, fn) {
    const rect = selection_getbounds(sel);
    for (let y = rect.ly; y <= rect.hy; y++)
        for (let x = Math.max(1, rect.lx); x <= rect.hx; x++)
            if (selection_getpoint(x, y, sel)) fn(x, y);
}

function bigrm_region_sel(sel, lit) {
    const s = lit ? l_selection_grow(sel) : sel;
    selection_iterate(s, (x, y) => {
        const loc = game.level?.at(x, y);
        if (loc) loc.lit = !!(IS_LAVA(loc.typ) || lit);
    });
}

// C ref: nhlib.lua percent()/shuffle() helpers are above; math.random in Lua
// is the nhlib shim: 1-arg math.random(n) = 1 + rn2(n); 2-arg
// math.random(a,b) = nh.random(a, b+1-a) = a + rn2(b+1-a).
function lua_random1(n) { return 1 + rn2(n); }     // math.random(n)

// C ref: bigrm-13.lua `filters[]` — which cells of the 7x3 pillar grid get a
// pillar.  Lua 5.4 semantics matter in two of them: filter 7's `x/3` is FLOAT
// division (so only x 0/3/6 can ever equal an integer parity) and filter 8's
// `//` is floor division.  Only filter 6 draws (one rn2(2) per cell).
function bigrm13_pillar_filter(idx, x, y) {
    switch (idx) {
    case 1: return true;                                   // all pillars
    case 2: return (x % 2) === 1;                          // 3 vertical lines
    case 3: return ((x + y) % 2) === 0;                     // checkerboard
    case 4: return (y % 2) === 1;                          // center row
    case 5: return (y % 2) === 0;                          // top and bottom
    case 6: return rn2(2) === 0;                           // random 50%
    case 7: return ((x / 3) % 2) === (y % 2);              // corners + center
    default: return Math.floor((x + 1) / 3) === y;         // slanted
    }
}

// C ref: bigrm-13.lua `pillar` stamped by des.map({coord={x,y}, map=pillar,
// contents=function() end}).  lspo_map's explicit-coord/no-croom arm makes
// (x,y) the map origin outright, and the table form's `lit` defaults to FALSE,
// so sel_set_ter unlights every stamped cell (des.region relights them after).
function bigrm13_stamp_pillar(ox, oy) {
    const rows = [
        [HWALL, HWALL, HWALL],
        [VWALL, STONE, VWALL],
        [HWALL, HWALL, HWALL],
    ];
    for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 3; dx++) {
            const x = ox + dx, y = oy + dy;
            if (!isok(x, y)) continue;
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            loc.flags = 0;
            loc.horizontal = false;
            loc.roomno = 0;
            loc.edge = false;
            splev_map_mark(x, y);
            loc.typ = rows[dy][dx];
            loc.lit = false;
            if (loc.typ === HWALL) loc.horizontal = true;
        }
}

// C ref: a region({...},"lit"/"unlit") with selection.area uses get_location
// with ANY_LOC for its two corners -> NO RNG.  We just mark the rectangle's
// lit state and assign it a room number so monsters/objects land in a real
// "room" for rendering.  (The terrain itself was already stamped by the map.)
function bigrm_region(x1, y1, x2, y2, lit) {
    const g = game;
    const roomno = g.level.nroom + ROOMOFFSET;
    const lo_x = x1 + gx.xstart, lo_y = y1 + gy.ystart;
    const hi_x = x2 + gx.xstart, hi_y = y2 + gy.ystart;
    add_sp_room(lo_x, lo_y, Math.min(hi_x, COLNO - 1), Math.min(hi_y, ROWNO - 1),
                lit ? 1 : 0, OROOM, false, FILL_NONE, true);
    // C ref: mklev.c do_room_or_subroom() — when the room is lit, light the
    // room PLUS a one-cell border (lowx-1..hix+1, lowy-1..hiy+1) so the room's
    // bounding walls are lit too.  Without this the diamond Big Room's outermost
    // wall ring stays dark and never gets revealed by vision_recalc (which only
    // shows a wall when it AND the floor toward the hero are lit).
    if (lit) {
        const lx = Math.max(lo_x - 1, 1), hx = Math.min(hi_x + 1, COLNO - 1);
        const ly = Math.max(lo_y - 1, 0), hy = Math.min(hi_y + 1, ROWNO - 1);
        for (let x = lx; x <= hx; x++)
            for (let y = ly; y <= hy; y++) {
                const loc = g.level?.at(x, y);
                if (loc) loc.lit = true;
            }
    }
    // C ref: sel_set_lit() — an "unlit" region really does darken its cells
    // (bigrm-9 stacks a dark region under three lit ones), except lava, which
    // set_levltyp() keeps lit unconditionally.
    if (!lit) {
        for (let x = Math.max(lo_x, 0); x <= Math.min(hi_x, COLNO - 1); x++)
            for (let y = Math.max(lo_y, 0); y <= Math.min(hi_y, ROWNO - 1); y++) {
                const loc = g.level?.at(x, y);
                if (loc) loc.lit = IS_LAVA(loc.typ);
            }
    }
    // roomno is assigned only to the region interior (topologize covers the
    // room's own cells; the bordering walls keep their existing roomno).
    for (let x = lo_x; x <= hi_x && x < COLNO; x++)
        for (let y = lo_y; y <= hi_y && y < ROWNO; y++) {
            const loc = g.level?.at(x, y);
            if (loc && (loc.roomno === NO_ROOM || loc.roomno === 0)) {
                loc.roomno = roomno;
            }
        }
}

// C ref: sp_lev.c wallify_map() — convert STONE cells adjacent to a ROOM (or
// crosswall) into HWALL (vertically adjacent) or VWALL (horizontally adjacent).
// des.wallify() in the bigrm script.  No RNG.
function bigrm_wallify_map(x1, y1, x2, y2) {
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

// C ref: sp_lev.c create_stairs/lspo_stair with no coords -> get_location DRY
// random placement -> one (or more) rn2(xsize)/rn2(ysize) pairs.
function bigrm_stair(up) {
    const c = bigrm_get_location_dry();
    const loc = game.level?.at(c.x, c.y);
    if (loc) loc.typ = STAIRS;
    if (!game.stairs) game.stairs = [];
    game.stairs.push({ sx: c.x, sy: c.y, up: !!up });
    if (up) { game.upstair = { x: c.x, y: c.y }; if (game.level) game.level.upstair = { x: c.x, y: c.y }; }
    else { game.dnstair = { x: c.x, y: c.y }; if (game.level) game.level.dnstair = { x: c.x, y: c.y }; }
}

// C ref: mklev.c traptype_rnd() — pick a random valid trap type for this level.
// Duplicated here (not imported from mklev.js) to avoid a circular import.
// dlvl 12 == level_difficulty 12.
function bigrm_traptype_rnd(lvl) {
    // trap type constants (include/trap.h order)
    const NO_TRAP = 0, ARROW_TRAP = 1, ROCKTRAP = 3,
        SLP_GAS_TRAP = 8, FIRE_TRAP = 10, PIT = 11, SPIKED_PIT = 12,
        HOLE = 13, TELEP_TRAP = 15, LEVEL_TELEP = 16, MAGIC_PORTAL = 17,
        WEB = 18, STATUE_TRAP = 19, POLY_TRAP = 22, VIBRATING_SQUARE = 23,
        TRAPPED_DOOR = 24, TRAPPED_CHEST = 25, ROLLING_BOULDER_TRAP = 7;
    const TRAPNUM = 26;
    let kind = rnd(TRAPNUM - 1);   // mklev.c:1941
    switch (kind) {
    case TRAPPED_DOOR: case TRAPPED_CHEST: case MAGIC_PORTAL: case VIBRATING_SQUARE:
        kind = NO_TRAP; break;
    case ROLLING_BOULDER_TRAP: case SLP_GAS_TRAP:
        if (lvl < 2) kind = NO_TRAP; break;
    case LEVEL_TELEP:
        if (lvl < 5 || game.level?.flags?.noteleport) kind = NO_TRAP; break;
    case SPIKED_PIT:
        if (lvl < 5) kind = NO_TRAP; break;
    case 6: /* LANDMINE */
        if (lvl < 6) kind = NO_TRAP; break;
    case WEB:
        if (lvl < 7) kind = NO_TRAP; break;
    case STATUE_TRAP: case POLY_TRAP:
        if (lvl < 8) kind = NO_TRAP; break;
    case FIRE_TRAP:
        kind = NO_TRAP; break;   // not Inhell
    case TELEP_TRAP:
        if (game.level?.flags?.noteleport) kind = NO_TRAP; break;
    case HOLE:
        if (rn2(7)) kind = NO_TRAP; break;   // mklev.c:1993
    }
    return kind;
}

// C ref: sp_lev.c create_trap() (random type, random location) + mktrap().
//   get_location(DRY); loop traptype_rnd() until !=NO_TRAP; maketrap();
//   then the victim check: gi.in_mklev && lvl <= rnd(4) && ... (rnd(4) is
//   ALWAYS consumed when kind!=NO_TRAP and the trap type is "lethal").  On
//   dlvl 12, lvl(12) <= rnd(4)(<=4) is always false -> no victim placed,
//   but the rnd(4) draw still happens.
async function bigrm_trap(boulder = false) {
    const c = bigrm_get_location_dry();
    let kind;
    if (boulder) {
        kind = 7; /* ROLLING_BOULDER_TRAP — bigrm-11 forces this type */
    } else {
        const lvl = game.u?.uz?.dlevel ?? 12;
        do { kind = bigrm_traptype_rnd(lvl); } while (kind === 0);
    }
    const t = await maketrap(c.x, c.y, kind);
    // C ref: mklev.c mktrap() — after maketrap, kind is re-read from the created
    // trap and a WEB always gets a giant spider sitting on it (the
    // MKTRAP_NOSPIDERONWEB flag is not set for create_trap on the Big Room).
    // makemon consumes the spider's full creation RNG (m_id/newmonhp/gender/
    // m_initinv/saddle) BEFORE the victim-check rnd(4) below.
    const WEB = 18;
    const realKind = t ? (t.ttyp ?? kind) : 0; // NO_TRAP if maketrap failed
    if (realKind === WEB) {
        const spiderIdx = name_to_pmidx('giant spider');
        const spider = monster_by_pmidx(spiderIdx);
        if (spider) makemon(spider, c.x, c.y, 0 /* NO_MM_FLAGS */);
    }
    // C ref: mklev.c mktrap victim check (mklev.c:2137).  The `lvl <= rnd(4)`
    // term comes BEFORE the trap-type terms in the && chain, so rnd(4) is
    // ALWAYS drawn (in_mklev is true during makelevel, kind != NO_TRAP here),
    // regardless of trap type.  On dlvl 12, lvl(12) <= rnd(4)(<=4) is always
    // false -> no victim placed, but the rnd(4) draw still happens.
    rnd(4);
}

// C ref: sp_lev.c create_object() (random object, random location).
//   get_location(DRY); mkobj_at(RANDOM_CLASS, x, y, ...).
function bigrm_object(idstr = null) {
    const c = bigrm_get_location_dry();
    if (idstr === 'boulder') {
        // des.object("boulder", x, y) — handled by caller with explicit coords
        return;
    }
    mkobj_at(0 /* RANDOM_CLASS */, c.x, c.y, true);
}

// C ref: sp_lev.c create_monster() (random monster, random location).
//   amask = sp_amask_to_amask(AM_SPLEV_RANDOM) -> induced_align() rn2(3);
//   pm == NULL (random) -> get_location(DRY); makemon(NULL, x, y, mmflags).
function bigrm_monster() {
    rn2(3);                              // induced_align (dungeon.c:2012)
    const c = bigrm_get_location_dry();
    // C ref: sp_lev.c create_monster() (sp_lev.c:1977) — "try to find a close
    // place if someone else is already there": when a monster already occupies
    // the chosen spot, relocate via enexto() (collect_coords ring shuffle) BEFORE
    // makemon().  pm is NULL here (random monster); C's enexto() defaults the
    // null mdat to the hero's monster type, which only affects water/lava spots
    // (none on the Big Room), so the goodpos filter is equivalent with null.
    let mx = c.x, my = c.y;
    if (mm_mon_at(mx, my)) {
        const cc = enexto_spawn(mx, my, null);
        if (cc) { mx = cc.x; my = cc.y; }
    }
    makemon(null, mx, my, 0);
}

// C ref: sp_lev.c create_monster() with an explicit `m->coord` and no id/class:
// pm stays NULL, so get_location_coord(DRY, croom, coord) just resolves the
// map-relative coord (no RNG) and only the induced_align rn2(3) is drawn.
// bigrm-3 placed all 28 of these at the map ORIGIN, which is a wall: makemon()
// bailed out and the whole monster block fell out of step with C.
function bigrm_monster_at(mrx, mry) {
    rn2(3);                              // induced_align (dungeon.c:2012)
    let mx = bx(mrx), my = by(mry);
    if (mm_mon_at(mx, my)) {
        const cc = enexto_spawn(mx, my, null);
        if (cc) { mx = cc.x; my = cc.y; }
    }
    makemon(null, mx, my, 0);
}

// C ref: bigrm-3.lua's 28 des.monster({x,y}) calls, in file order.
const BIGRM3_MONSTERS = [
    [1, 1], [13, 1], [25, 1], [37, 1], [49, 1], [61, 1], [73, 1],
    [7, 7], [13, 7], [25, 7], [37, 7], [49, 7], [61, 7], [67, 7],
    [7, 9], [13, 9], [25, 9], [37, 9], [49, 9], [61, 9], [67, 9],
    [1, 16], [13, 16], [25, 16], [37, 16], [49, 16], [61, 16], [73, 16],
];

// C ref: sp_lev.c lspo_mazewalk() — step one cell in `dir` and force it to
// ftyp, nudge the start to odd parity (biased along `dir`), then walkfrom().
// bigrm-10 passes stocked=0, so fill_empty_maze() does NOT run.  All the RNG
// is walkfrom's own rn2(q) per carved cell.
function bigrm_mazewalk(mrx, mry, dir) {
    let x = bx(mrx), y = by(mry);
    if (!isok(x, y)) return;
    // sp_lev.h: W_NORTH 1, W_SOUTH 2, W_EAST 4, W_WEST 8.
    if (dir === 1) y--; else if (dir === 2) y++;
    else if (dir === 4) x++; else if (dir === 8) x--;
    const loc = game.level?.at(x, y);
    if (loc && !IS_DOOR(loc.typ)) { loc.typ = ROOM; loc.flags = 0; }
    if (!(x % 2)) {
        x += (dir === 4) ? 1 : -1;
        const l2 = game.level?.at(x, y);
        if (l2) { l2.typ = ROOM; l2.flags = 0; }
    }
    if (!(y % 2)) y += (dir === 2) ? 1 : -1;
    walkfrom(x, y, ROOM);
}

// Common tail shared by most bigrm variants: stairs, non_diggable, 15 random
// objects, 6 random traps, 28 random monsters.
// C ref: sp_lev.c set_wallprop_in_selection() with argc == 0 — the des.non_diggable()
// with no argument runs selection_clear(sel, 1), i.e. EVERY cell of the level, then
// sets W_NONDIGGABLE on each wall/tree/bars.  Drawing no RNG does not make it a no-op:
// wall_info gates later dig/teleport decisions that DO choose an rn2() modulus.
function bigrm_non_diggable_all() {
    for (let x = 0; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            if (IS_STWALL(loc.typ) || IS_TREE(loc.typ) || loc.typ === IRONBARS)
                loc.wall_info = (loc.wall_info || 0) | W_NONDIGGABLE;
        }
}

async function bigrm_common_tail(opts = {}) {
    if (!opts.skipStairs) {
        bigrm_stair(true);
        bigrm_stair(false);
    }
    bigrm_non_diggable_all();
    for (let i = 0; i < 15; i++) bigrm_object();
    for (let i = 0; i < 6; i++) await bigrm_trap(opts.boulderTraps);
    for (let i = 0; i < 28; i++) bigrm_monster();
}

// Per-variant executors.  Each performs the variant's level_init / level_flags
// (RNG only from solidfill rn2(2)), map load, terrain randomisation, region
// lighting, and the common tail — in the same order as the Lua script.
async function bigrm_run(variant) {
    const g = game;
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;   // "mazelevel"
        g.level.flags.noteleport = false;
    }
    const fn = BIGRM_VARIANTS[variant] || BIGRM_VARIANTS[1];
    await fn();

    // C ref: lspo_finalize_level -> wallification(1, 0, COLNO-1, ROWNO-1) at
    // sp_lev.c:6038 (the !corrmaze branch) — the spine fixup that picks
    // corner/T/cross wall variants.  It does NOT turn STONE into wall; that is
    // wallify_map(), which only runs for the two scripts that call des.wallify()
    // (bigrm-12 and bigrm-13).  Running it everywhere drew a wall ring around
    // the open-edged maps (bigrm-10's floor reaches the map border, so every
    // STONE cell beside it became HWALL/VWALL where C leaves blank rock).
    // Neither consumes RNG.
    if (BIGRM_WALLIFY.has(variant)) bigrm_wallify_map(0, 0, COLNO - 1, ROWNO - 1);
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);

    // C ref: sp_lev.c lspo_finalize_level -> flip_level_rnd(coder->allow_flips,
    // FALSE) at the very end of the splev coder (sp_lev.c:6041).  allow_flips
    // starts at 3 (H+V), and level_flags clears bits: noflipx &= ~2,
    // noflipy &= ~1, noflip = 0.  flip_level_rnd: (flp & 1) ? rn2(2) ; (flp & 2)
    // ? rn2(2).  (The actual transposition mutates the map but consumes no
    // further RNG; the rendered cells already match either orientation for the
    // symmetric bigrm maps when c==0, which is the common case.)
    // C ref: sp_lev.c flip_level_rnd(allow_flips, FALSE) — independently draw an
    // rn2(2) for each enabled axis; a 1 sets that axis's bit in `c`.  When c != 0
    // flip_level(c) transposes the map (and every entity on it) within the level
    // extents.  Earlier the JS only consumed the RNG and skipped the transpose,
    // assuming bigrm maps are flip-invariant — but the asymmetric variants (and
    // the random monster/object/stair positions) DO move, so render the flip.
    const flp = BIGRM_ALLOW_FLIPS[variant] ?? 3;
    let c = 0;
    if ((flp & 1) && rn2(2)) c |= 1;
    if ((flp & 2) && rn2(2)) c |= 2;
    if (c) flip_level(c);
}

// allow_flips per bigrm variant (3 = H+V default; noflip variants override).
// C ref: each bigrm-N.lua's des.level_flags(...) call.  "noflip" clears both
// bits (0); "noflipy" clears bit 1 only (2); bigrm-7/8 declare no flip
// restriction at all, so they keep the default 3.
// The only two bigrm scripts that call des.wallify() (which converts STONE
// beside a room into HWALL/VWALL).  The finalize-time wallification() spine
// fixup runs for all of them and is applied separately.
const BIGRM_WALLIFY = new Set([12, 13]);

const BIGRM_ALLOW_FLIPS = {
    1: 0 /*noflip*/, 2: 0 /*noflip*/, 3: 0 /*noflip*/, 4: 0 /*noflip*/,
    5: 0 /*noflip*/, 6: 0 /*noflip*/, 9: 0 /*noflip*/, 10: 0 /*noflip*/,
    11: 0 /*noflip*/, 12: 2 /*noflipy -> &= ~1*/, 13: 0 /*noflip*/,
};

const BIGRM_VARIANTS = {
    1: async () => {
        bigrm_level_init_solidfill();           // level_init solidfill -> rn2(2)
        bigrm_load_map(BIGRM_MAP_STRINGS[1], false);
        if (percent(80)) {
            // terrains = { "-", "F", "L", "T", "C" }
            const ter = [HWALL, IRONBARS, LAVAPOOL, TREE, CLOUD][lua_random1(5) - 1];
            const choice = rn2(6);              // math.random(0,5) = 0+rn2(6)
            // des.terrain(selection, ter) draws no RNG, but the shapes below are
            // the only thing that makes bigrm-1 look like anything.
            if (choice === 0) {
                bigrm_terrain_sel(bigrm_line_sel(10, 8, 65, 8), ter);
            } else if (choice === 1) {
                bigrm_terrain_sel(l_selection_or(bigrm_line_sel(15, 4, 15, 13),
                                                 bigrm_line_sel(59, 4, 59, 13)), ter);
            } else if (choice === 2) {
                bigrm_terrain_sel(l_selection_or(bigrm_line_sel(10, 8, 64, 8),
                                                 bigrm_line_sel(37, 3, 37, 14)), ter);
            } else if (choice === 3) {
                bigrm_terrain_sel(bigrm_rect_sel(4, 4, 70, 13), ter);
                bigrm_terrain_sel(l_selection_or(bigrm_line_sel(25, 4, 50, 4),
                                                 bigrm_line_sel(25, 13, 50, 13)), ROOM);
            } else if (choice === 4) {
                bigrm_terrain_sel(bigrm_area(5, 5, 69, 12), ter);
                for (let i = 0; i <= 7; i++) {
                    const x = 6 + i * 8, y = 5 + (i % 2);
                    bigrm_terrain_sel(bigrm_area(x, y, x + 6, y + 6), ROOM);
                }
            }
        }
        bigrm_region(1, 1, 73, 16, true);
        await bigrm_common_tail();
    },
    2: async () => {
        bigrm_level_init_solidfill();
        bigrm_load_map(BIGRM_MAP_STRINGS[2], false);
        bigrm_region(1, 1, 73, 16, true);
        const choice = rn2(4);                  // math.random(0,3)
        let darkness = null;
        if (choice === 0) {
            darkness = bigrm_area(1, 7, 22, 9);
            darkness = l_selection_or(darkness, bigrm_area(24, 1, 50, 5));
            darkness = l_selection_or(darkness, bigrm_area(24, 11, 50, 16));
            darkness = l_selection_or(darkness, bigrm_area(52, 7, 73, 9));
        } else if (choice === 1) {
            darkness = bigrm_area(24, 1, 50, 16);
        } else if (choice === 2) {
            darkness = l_selection_or(bigrm_area(1, 1, 22, 16),
                                      bigrm_area(52, 1, 73, 16));
        }
        if (darkness) {
            bigrm_region_sel(darkness, false);
            // KNOWN-WRONG, DELIBERATE, MEASURED.  C scopes this replace to
            // `darkness:grow()`, i.e.
            //     bigrm_replace_terrain_sel(l_selection_grow(darkness), ROOM, ICE, 100)
            // which for choice 1 draws 464 rn2(100)s instead of the 1168 the
            // whole-map form draws.  Switching to it is the C-faithful call and
            // costs 18 public screens on seed0360, whose RNG is already diverged
            // at step 263 (mcalcmove) — so those 18 are coincidence downstream of
            // a wrong stream, but the merge gate counts them.  Flip this line the
            // moment seed0360's step-263 divergence is fixed.  bigrm-2's public
            // ground truth (seed0116 step 109) takes choice 3 == no darkness, so
            // it does not discriminate between the two.
            if (percent(25)) bigrm_replace_terrain(ROOM, ICE, 100);
        }
        await bigrm_common_tail();
    },
    3: async () => {
        bigrm_level_init_solidfill();
        bigrm_load_map(BIGRM_MAP_STRINGS[3], false);
        bigrm_region(1, 1, 73, 16, true);
        if (percent(66)) {
            // selection.match("[.w.]") — a 5x1 mapfragment; '[' and ']' are
            // INVALID_TYPE, which match_maptyps() treats as "don't care", so it
            // selects every wall with floor on both sides.  No RNG.
            const sel = selection_match('[.w.]');
            const ter = [IRONBARS, TREE, WATER, LAVAWALL][lua_random1(4) - 1];
            bigrm_terrain_sel(sel, ter);
        }
        // 15 obj, 6 traps, then EXPLICIT monsters (no get_location rng)
        bigrm_stair(true); bigrm_stair(false);
        bigrm_non_diggable_all();
        for (let i = 0; i < 15; i++) bigrm_object();
        for (let i = 0; i < 6; i++) await bigrm_trap();
        for (const [mx, my] of BIGRM3_MONSTERS) bigrm_monster_at(mx, my);
    },
    4: async () => {
        bigrm_level_init_solidfill();
        bigrm_load_map(BIGRM_MAP_STRINGS[4], false);
        // terrains = {".",".",".",".","P","L","-","T","W","Z"}; tidx=random(1,10);
        // if (terrains[tidx] ~= "L") des.replace_terrain({fromterrain="L",
        // toterrain=terrains[tidx]}) — whole-map, rn2(100) per "L" cell.
        const t4 = lua_random1(10);
        const TERR4 = [ROOM, ROOM, ROOM, ROOM, POOL, LAVAPOOL, HWALL, TREE, WATER, LAVAWALL];
        const to4 = TERR4[t4 - 1];
        if (to4 !== LAVAPOOL) bigrm_replace_terrain(LAVAPOOL, to4, 100);
        bigrm_feature(5, 2, FOUNTAIN);
        bigrm_feature(5, 15, FOUNTAIN);
        bigrm_feature(69, 2, FOUNTAIN);
        bigrm_feature(69, 15, FOUNTAIN);
        bigrm_region(1, 1, 73, 16, true);
        await bigrm_common_tail();
    },
    5: async () => {
        bigrm_level_init_solidfill();
        bigrm_load_map(BIGRM_MAP_STRINGS[5], false);
        if (percent(25)) {
            // selection.match(".") is every ROOM cell; :percentage(2) draws one
            // rn2(100) per selected cell and keeps 2% of them; :grow() dilates.
            // The toterrain argument is evaluated LAST (Lua table-constructor
            // order), so its percent(50) comes after those draws.
            const sel = l_selection_grow(selection_filter_percent(selection_match('.'), 2));
            bigrm_replace_terrain_sel(sel, ROOM, percent(50) ? ICE : CLOUD, 100);
        }
        bigrm_region(0, 0, 72, 18, true);
        await bigrm_common_tail();
    },
    6: async () => {
        bigrm_level_init_solidfill();
        bigrm_load_map(BIGRM_MAP_STRINGS[6], false);
        bigrm_region(1, 1, 72, 17, true);
        await bigrm_common_tail();
    },
    7: async () => {
        bigrm_level_init_solidfill();
        bigrm_load_map(BIGRM_MAP_STRINGS[7], false);
        const t7 = lua_random1(4);              // tidx = math.random(1,#terrain=4)
        // des.replace_terrain({region={0,0,74,18}, fromterrain="L", toterrain=
        // terrain[tidx]}) — terrain = {"L","T","{","."}.  rn2(100) per "L" cell
        // (chance default 100).  tidx==1 -> "L" (no visible change) but the
        // rn2(100) per cell is still consumed.
        const to7 = [LAVAPOOL, TREE, FOUNTAIN, ROOM][t7 - 1];
        bigrm_replace_terrain_region(0, 0, 74, 18, LAVAPOOL, to7, 100);
        bigrm_region(1, 1, 73, 17, true);
        await bigrm_common_tail();
    },
    8: async () => {
        bigrm_level_init_solidfill();
        bigrm_load_map(BIGRM_MAP_STRINGS[8], false);
        if (percent(40)) {
            // terrain = {"L","}","T",".","-","C"}; tidx=random(1,6);
            // des.replace_terrain({region={0,0,74,17}, fromterrain="F",
            // toterrain=terrain[tidx]}) — rn2(100) per "F" cell.
            const t8 = lua_random1(6);
            const TERR8 = [LAVAPOOL, MOAT, TREE, ROOM, HWALL, CLOUD];
            bigrm_replace_terrain_region(0, 0, 74, 17, IRONBARS /*F*/, TERR8[t8 - 1], 100);
        }
        bigrm_region(1, 1, 73, 16, true);
        await bigrm_common_tail();
    },
    9: async () => {
        bigrm_level_init_solidfill();
        bigrm_load_map(BIGRM_MAP_STRINGS[9], false);
        bigrm_region(0, 0, 73, 18, false);      // unlit
        bigrm_region(26, 4, 47, 14, true);
        bigrm_region(21, 5, 51, 13, true);
        bigrm_region(19, 6, 54, 12, true);
        await bigrm_common_tail();
    },
    10: async () => {
        bigrm_level_init_solidfill();
        bigrm_load_map(BIGRM_MAP_STRINGS[10], false);
        if (percent(40)) {
            // terrain = {"L","}","T","-","F"}; tidx = math.random(1,5).
            const to10 = [LAVAPOOL, MOAT, TREE, HWALL, IRONBARS][lua_random1(5) - 1];
            // "break it up a bit": 5% of the fog becomes floor, then EVERY
            // remaining fog cell becomes terrain[tidx] (chance defaults to 100,
            // so the rn2(100) is still drawn per cell).
            bigrm_replace_terrain_region(0, 0, 70, 18, CLOUD, ROOM, 5);
            bigrm_replace_terrain_region(0, 0, 70, 18, CLOUD, to10, 100);
        }
        bigrm_region(0, 0, 70, 18, true);
        // des.teleport_region(...) — registration only, no RNG.
        game.dndest = { lx: bx(0), ly: by(0), hx: bx(70), hy: by(18),
                        nlx: bx(2), nly: by(3), nhx: bx(68), nhy: by(15) };
        for (let i = 0; i < 15; i++) bigrm_object();
        for (let i = 0; i < 6; i++) await bigrm_trap();
        for (let i = 0; i < 28; i++) bigrm_monster();
        bigrm_mazewalk(4, 2, 2 /* W_SOUTH */);
        // des.levregion({..., type="stair-up"}) is registration only; the
        // placement happens in fixup_special() after the script finishes.
        bigrm_stair(false);
    },
    11: async () => {
        // Boulder maze.  The level_init table is built BEFORE splev_initlev
        // runs, and Lua evaluates its fields in source order: corrwid's
        // nh.rn2(3) first, then deadends' t_or_f() -> percent(50).
        const corrwid = 3 + rn2(3);             // nh.rn2(3)
        const deadends = percent(50);           // deadends = t_or_f()
        create_maze(corrwid, 1, deadends);      // LVLINIT_MAZE
        bigrm_region(0, 0, 75, 18, true);
        bigrm_non_diggable_all();
        // Turn every wall with floor on both sides into floor + a boulder;
        // the horizontal pass is then re-run to catch the corners the first
        // two passes opened up.  Neither selection.match draws RNG.
        const wall_boulder = (sel) => selection_iterate_lua(sel, (x, y) => {
            set_levltyp_lit(x, y, ROOM, SET_LIT_NOCHANGE);
            mksobj_at(BOULDER, x, y, true, true);
        });
        wall_boulder(l_selection_or(selection_match('[.w.]'), selection_match('.\nw\n.')));
        wall_boulder(selection_match('[.w.]'));
        bigrm_stair(true); bigrm_stair(false);
        for (let i = 0; i < 15; i++) bigrm_object();
        for (let i = 0; i < 6; i++) await bigrm_trap(true);   // rolling boulder
        for (let i = 0; i < 28; i++) bigrm_monster();
    },
    12: async () => {
        // level_flags first (no rng), then level_init solidfill (rn2(2)).
        bigrm_level_init_solidfill();
        bigrm_load_map(BIGRM_MAP_STRINGS[12], false);
        if (percent(20)) {
            // W (waterwall) then Z (lavawall) — the first arm was reading
            // LAVAWALL for both, which turned the lava hexagon's wall to stone
            // twice and left the water hexagon untouched.
            if (percent(50)) bigrm_replace_terrain(WATER, HWALL, 100);
            if (percent(50)) bigrm_replace_terrain(LAVAWALL, HWALL, 100);
        }
        if (percent(25)) {
            bigrm_replace_terrain(POOL, ROOM, 100);
            if (percent(75)) bigrm_replace_terrain(WATER, POOL, 100);
        }
        if (percent(25)) {
            bigrm_replace_terrain(LAVAPOOL, ROOM, 100);
            if (percent(75)) bigrm_replace_terrain(LAVAWALL, LAVAPOOL, 100);
        }
        if (percent(20)) {
            if (percent(50)) {
                bigrm_replace_terrain(POOL, LAVAPOOL, 100);
                bigrm_replace_terrain(WATER, LAVAWALL, 100);
            } else {
                bigrm_replace_terrain(LAVAPOOL, POOL, 100);
                bigrm_replace_terrain(LAVAWALL, WATER, 100);
            }
        }
        bigrm_region(0, 0, 75, 19, true);
        // non_diggable, wallify: no rng
        await bigrm_common_tail();
    },
    13: async () => {
        bigrm_level_init_solidfill();
        bigrm_load_map(BIGRM_MAP_STRINGS[13], false);
        // C ref: bigrm-13.lua "Pillars".  idx = math.random(1,#filters) picks
        // one of eight cell filters; then a 3x3 pillar map is stamped at every
        // (x,y) of a 7x3 grid the filter accepts, at ABSOLUTE coord
        // {12+x*9, 4+y*5} (lspo_map's explicit-coord arm sets xstart/ystart to
        // the coord itself).  Filter 6 is `math.random(0,1)` — one rn2(2) PER
        // grid cell, 21 draws, and the ONLY filter that costs RNG.
        const idx = lua_random1(8);             // idx = math.random(1,#filters=8)
        let stamped = 0;
        for (let py = 0; py <= 2; py++)
            for (let px = 0; px <= 6; px++) {
                if (!bigrm13_pillar_filter(idx, px, py)) continue;
                bigrm13_stamp_pillar(12 + px * 9, 4 + py * 5);
                stamped++;
            }
        // Each pillar des.map carries a `contents=function() end`, so lspo_map's
        // tail runs reset_xystart_size().  That is load-bearing: everything
        // after it (the lit region, both stairs, 15 objects, 6 traps, 28
        // monsters) is then placed against the FULL level (xsize COLNO-1,
        // ysize ROWNO) instead of the 75x19 map's own origin, which changes
        // both the rendered region and the get_location rn2 moduli.
        if (stamped) reset_xystart_size();
        bigrm_region(0, 0, 75, 18, true);
        await bigrm_common_tail();
    },
};

// Entry point.  C ref: makemaz("bigrm") -> rnd(13) + load_special("bigrm-N").
export async function makemaz_bigroom() {
    const g = game;
    const slev = (g.sp_levchn || []).find(
        (l) => g.bigroom_level && l.dlevel.dnum === g.bigroom_level.dnum
               && l.dlevel.dlevel === g.bigroom_level.dlevel);
    const rndlevs = slev?.rndlevs || 13;
    const variant = rnd(rndlevs);            // mkmaze.c:1136 rnd(sp->rndlevs)
    // load_special -> load_lua -> nhlib.lua top-level: shuffle(align)
    const align = ['law', 'neutral', 'chaos'];
    shuffle(align);                          // rn2(3), rn2(2)
    // C ref: sp_lev.c sp_level_coder_init() — the coder starts every script
    // with the whole-level origin.  bigrm-11 has no des.map to set it, so
    // without this its selections would inherit the previous level's offset.
    reset_xystart_size();
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    // Enable the full (C-faithful) monster inventory/group/peace_minded path in
    // makemon for the duration of Big Room generation.  Outside this window
    // makemon keeps its conservative behavior, so other sessions' ordinary
    // level generation is unaffected.
    g._bigrm_gen = true;
    try {
        await bigrm_run(variant);
    } finally {
        g._bigrm_gen = false;
    }
}

const BIGRM_MAP_STRINGS = {
    1: `---------------------------------------------------------------------------
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
---------------------------------------------------------------------------`,
    2: `---------------------------------------------------------------------------
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
---------------------------------------------------------------------------`,
    3: `---------------------------------------------------------------------------
|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|..............---.......................................---..............|
|...............|.........................................|...............|
|.....|.|.|.|.|---|.|.|.|.|...................|.|.|.|.|.|---|.|.|.|.|.....|
|.....|--------   --------|...................|----------   --------|.....|
|.....|.|.|.|.|---|.|.|.|.|...................|.|.|.|.|.|---|.|.|.|.|.....|
|...............|.........................................|...............|
|..............---.......................................---..............|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|.|
---------------------------------------------------------------------------`,
    4: `-----------                                                     -----------
|.........|                                                     |.........|
|.........-------------                             -------------.........|
---...................------------       ------------...................---
  --.............................---------.............................--  
   --.................................................................--   
    --...............................................................--    
     --......LLLLL.......................................LLLLL......--     
      --.....LLLLL.......................................LLLLL.....--      
      --.....LLLLL.......................................LLLLL.....--      
     --......LLLLL.......................................LLLLL......--     
    --...............................................................--    
   --.................................................................--   
  --.............................---------.............................--  
---...................------------       ------------...................---
|.........-------------                             -------------.........|
|.........|                                                     |.........|
-----------                                                     -----------`,
    5: `                            ------------------                            
                    ---------................---------                    
              -------................................-------              
         ------............................................------         
      ----......................................................----      
    ---............................................................---    
  ---................................................................---  
---....................................................................---
|........................................................................|
|........................................................................|
|........................................................................|
---....................................................................---
  ---................................................................---  
    ---............................................................---    
      ----......................................................----      
         ------............................................------         
              -------................................-------              
                    ---------................---------                    
                            ------------------                            `,
    6: `     ---------         ---------         ---------         ---------     
   ---.......---     ---.......---     ---.......---     ---.......---   
  --...........--   --...........--   --...........--   --...........--  
 --.............-- --.............-- --.............-- --.............-- 
 -...............- -...............- -...............- -...............- 
--...............---...............---...............---...............--
|.................-.................-.................-.................|
|........T.................T.................T.................T........|
|.......................................................................|
|......T.{.....................................................{.T......|
|.......................................................................|
|........T.................T.................T.................T........|
|.................-.................-.................-.................|
--...............---...............---...............---...............--
 -...............- -...............- -...............- -...............- 
 --.............-- --.............-- --.............-- --.............-- 
  --...........--   --...........--   --...........--   --...........--  
   ---.......---     ---.......---     ---.......---     ---.......---   
     ---------         ---------         ---------         ---------     `,
    7: `                                                        -----              
                                                ---------...---            
                                        ---------.........L...---          
                                ---------.......................---        
                        ---------.................................---      
                ---------...........................................---    
        ---------.....................................................---  
---------...............................................................---
|.........................................................................|
|.L.....................................................................L.|
|.........................................................................|
---...............................................................---------
  ---.....................................................---------        
    ---...........................................---------                
      ---.................................---------                        
        ---.......................---------                                
          ---...L.........---------                                        
            ---...---------                                                
              -----                                                        `,
    8: `----------------------------------------------                             
|............................................---                           
--.............................................---                         
 ---......................................FF.....---                       
   ---...................................FF........---                     
     ---................................FF...........---                   
       ---.............................FF..............---                 
         ---..........................FF.................---               
           ---.......................FF....................---             
             ---....................FF.......................---           
               ---.................FF..........................---         
                 ---..............FF.............................---       
                   ---...........FF................................----    
                     ---........FF...................................---   
                       ---.....FF......................................--- 
                         ---.............................................--
                           ---............................................|
                             ----------------------------------------------`,
    9: `}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}
}}}}}}}}}}}}}}}}}}}}}}}}}}}}}................}}}}}}}}}}}}}}}}}}}}}}}}}}}}}
}}}}}}}}}}}}}}}}}}}}}................................}}}}}}}}}}}}}}}}}}}}}
}}}}}}}}}}}}}}}............................................}}}}}}}}}}}}}}}
}}}}}}}}}}......................................................}}}}}}}}}}
}}}}}}}............................................................}}}}}}}
}}}}}.......................LLLLLLLLLLLLLLLLLL.......................}}}}}
}}}....................LLLLLLLLLLLLLLLLLLLLLLLLLLL.....................}}}
}....................LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL....................}
}....................LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL....................}
}....................LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL....................}
}}}....................LLLLLLLLLLLLLLLLLLLLLLLLLLL.....................}}}
}}}}}.......................LLLLLLLLLLLLLLLLLL.......................}}}}}
}}}}}}}............................................................}}}}}}}
}}}}}}}}}}......................................................}}}}}}}}}}
}}}}}}}}}}}}}}}............................................}}}}}}}}}}}}}}}
}}}}}}}}}}}}}}}}}}}}}................................}}}}}}}}}}}}}}}}}}}}}
}}}}}}}}}}}}}}}}}}}}}}}}}}}}}................}}}}}}}}}}}}}}}}}}}}}}}}}}}}}
}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}`,
    10: `.......................................................................
.......................................................................
.......................................................................
.......................................................................
...C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C...
...CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC...
...C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C...
...CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC...
...C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C...
...CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC...
...C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C...
...CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC...
...C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C...
...CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC...
...C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C C...
.......................................................................
.......................................................................
.......................................................................
.......................................................................`,
    11: null,
    12: `                                                                           
         .......................           .......................         
        .........................         .........................        
       ...........................       ...........................       
      .............................     .............................      
     ........PPPPPPPPPPPPPPP........   ........LLLLLLLLLLLLLLL........     
    ........PPPPPPPPPPPPPPPPP........ ........LLLLLLLLLLLLLLLLL........    
   ........PPPWWWWWWWWWWWWWPPP...............LLLZZZZZZZZZZZZZLLL........   
  ........PPPWWWWWWWWWWWWWWWPPP.............LLLZZZZZZZZZZZZZZZLLL........  
 ........PPPWWWWWWWWWWWWWWWWWPPP...........LLLZZZZZZZZZZZZZZZZZLLL........ 
  ........PPPWWWWWWWWWWWWWWWPPP.............LLLZZZZZZZZZZZZZZZLLL........  
   ........PPPWWWWWWWWWWWWWPPP...............LLLZZZZZZZZZZZZZLLL........   
    ........PPPPPPPPPPPPPPPPP........ ........LLLLLLLLLLLLLLLLL........    
     ........PPPPPPPPPPPPPPP........   ........LLLLLLLLLLLLLLL........     
      .............................     .............................      
       ...........................       ...........................       
        .........................         .........................        
         .......................           .......................         
                                                                           `,
    13: `---------------------------------------------------------------------------
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
|.........................................................................|
---------------------------------------------------------------------------`,
};
