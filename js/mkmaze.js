// mkmaze.js — the raw maze carver.
// C ref: src/mkmaze.c (okay / maze0xy / walkfrom / create_maze /
// maze_remove_deadends / set_levltyp_lit).  Used both by the bare
// makemaz("") path and, via des.level_init({style="maze"}) and
// des.mazewalk(), by the .lua special levels (hellfill.lua in particular).

import { game } from './gstate.js';
import { rn2, rnd } from './rng.js';
import {
    COLNO, ROWNO, STONE, ROOM, CORR, HWALL, isok, IS_DOOR, ACCESSIBLE,
    MAGIC_PORTAL, LAVAPOOL, POOL, MOAT, WATER, AIR, CLOUD,
    Is_firelevel, Is_waterlevel, Is_airlevel,
} from './const.js';
import { maketrap, t_at } from './trap.js';
import { m_at, newsym, pline, terrain_glyph } from './display.js';
import {
    block_point, recalc_block_point, unblock_point, vision_recalc,
} from './vision.js';
import { obj_extract_self, objects_at, stackobj } from './invent.js';
import { place_object } from './mkobj.js';
import { enexto_spawn } from './makemon.js';
import { goodpos, rloc_to, RLOC_NOMSG } from './teleport.js';
import { placebc, unplacebc } from './ball.js';

// C ref: decl.c g_init_x/g_init_y — x_maze_max = (COLNO-1) & ~1 = 78,
// y_maze_max = (ROWNO-1) & ~1 = 20.  create_maze() temporarily shrinks these
// while carving and restores them afterwards, so they are mutable state, not
// constants.
export const X_MAZE_MAX_DEFAULT = (COLNO - 1) & ~1;
export const Y_MAZE_MAX_DEFAULT = (ROWNO - 1) & ~1;

export const mz = {
    x_maze_max: X_MAZE_MAX_DEFAULT,
    y_maze_max: Y_MAZE_MAX_DEFAULT,
};

export function reset_maze_bounds() {
    mz.x_maze_max = X_MAZE_MAX_DEFAULT;
    mz.y_maze_max = Y_MAZE_MAX_DEFAULT;
}

// C ref: mkmaze.c mkportal(x, y, todnum, todlevel) — a MAGIC_PORTAL "trap"
// carrying the dungeon/level it leads to.  Every portal must be matched by a
// portal in the destination dungeon/dlevel: one is made on each side of a
// BR_PORTAL branch when that side's level is generated (place_branch() for the
// parent-dungeon side, put_lregion_here(LR_PORTAL)/place_branch() for the
// child's entry level), and goto_level() walks the destination level's trap
// list to find where the hero comes out.
//
// maketrap() consumes NO RNG for MAGIC_PORTAL (its type switch has no case for
// it) and leaves tseen clear (unhideable_trap() is HOLE-only), so a portal is
// invisible until the hero arrives on it or steps onto it — creating one does
// not perturb the level's PRNG stream or its initial appearance.
export async function mkportal(x, y, todnum, todlevel) {
    const ttmp = await maketrap(x, y, MAGIC_PORTAL);
    if (!ttmp) return;  /* C: impossible("portal on top of portal?") */
    ttmp.dst.dnum = todnum;
    ttmp.dst.dlevel = todlevel;
}

// C ref: mkmaze.c mz_move() macro — 0=north, 1=east, 2=south, 3=west.
export function mz_move(p, dir) {
    switch (dir) {
    case 0: p.y--; break;
    case 1: p.x++; break;
    case 2: p.y++; break;
    case 3: p.x--; break;
    default: break;
    }
}

// C ref: mkmaze.c okay() — is the cell TWO steps away in `dir` still virgin
// STONE and inside the (possibly shrunk) maze bounds?
export function okay(x, y, dir) {
    const p = { x, y };
    mz_move(p, dir);
    mz_move(p, dir);
    if (p.x < 3 || p.y < 3 || p.x > mz.x_maze_max || p.y > mz.y_maze_max)
        return false;
    return game.level?.at(p.x, p.y)?.typ === STONE;
}

// C ref: mkmaze.c maze0xy() — two rn2 draws for the carve start point.
export function maze0xy() {
    return {
        x: 3 + 2 * rn2((mz.x_maze_max >> 1) - 1),
        y: 3 + 2 * rn2((mz.y_maze_max >> 1) - 1),
    };
}

// C ref: mkmaze.c walkfrom() — the non-MICRO (recursive) build, ported
// literally.  This is deliberately NOT rewritten as an explicit-stack loop:
// C's `x`/`y` are the *parameters*, which mz_move() mutates in place, so after
// each recursive call the caller resumes scanning from the CELL IT JUST
// RECURSED INTO rather than from its own cell.  An ordinary
// push-my-own-cell backtracker visits cells in a different order and therefore
// consumes rn2(q) differently.  Depth is bounded by the number of odd cells in
// the maze grid (<= 39*10), so plain recursion is safe here.
export function walkfrom(x, y, typ) {
    if (!typ) typ = game.level?.flags?.corrmaze ? CORR : ROOM;

    const loc0 = game.level?.at(x, y);
    if (loc0 && !IS_DOOR(loc0.typ)) {
        // might still be on edge of MAP, so don't overwrite
        loc0.typ = typ;
        loc0.flags = 0;
    }

    for (;;) {
        const dirs = [];
        for (let a = 0; a < 4; a++) if (okay(x, y, a)) dirs.push(a);
        if (!dirs.length) return;
        const dir = dirs[rn2(dirs.length)];
        const p = { x, y };
        mz_move(p, dir);
        const mid = game.level?.at(p.x, p.y);
        if (mid) mid.typ = typ;
        mz_move(p, dir);
        x = p.x;
        y = p.y;
        walkfrom(x, y, typ);
    }
}

// C ref: mkmaze.c maze_inbounds().
function maze_inbounds(x, y) {
    return x >= 2 && y >= 2 && x < mz.x_maze_max && y < mz.y_maze_max
        && isok(x, y);
}

// C ref: mkmaze.c maze_remove_deadends() — one rn2(idx) per dead-end cell that
// has at least 3 blocked directions and at least one re-joinable neighbour.
export function maze_remove_deadends(typ) {
    for (let x = 2; x < mz.x_maze_max; x++)
        for (let y = 2; y < mz.y_maze_max; y++) {
            const loc = game.level?.at(x, y);
            if (!loc || !ACCESSIBLE(loc.typ) || !(x % 2) || !(y % 2)) continue;
            const dirok = [];
            let idx2 = 0;
            for (let dir = 0; dir < 4; dir++) {
                const p1 = { x, y }, p2 = { x, y };
                mz_move(p1, dir);
                if (!maze_inbounds(p1.x, p1.y)) { idx2++; continue; }
                mz_move(p2, dir); mz_move(p2, dir);
                if (!maze_inbounds(p2.x, p2.y)) { idx2++; continue; }
                const a = game.level.at(p1.x, p1.y), b = game.level.at(p2.x, p2.y);
                if (a && b && !ACCESSIBLE(a.typ) && ACCESSIBLE(b.typ)) {
                    dirok.push(dir);
                    idx2++;
                }
            }
            if (idx2 >= 3 && dirok.length > 0) {
                const p = { x, y };
                mz_move(p, dirok[rn2(dirok.length)]);
                const t = game.level.at(p.x, p.y);
                if (t) t.typ = typ;
            }
        }
}

// C ref: mkmaze.c create_maze(corrwid, wallthick, rmdeadends).
// corrwid/wallthick == -1 mean "roll it": rnd(4) and rnd(4)-corrwid, in that
// order.  The maze is carved on a half-scale grid and then tiled back up.
export function create_maze(corrwid, wallthick, rmdeadends) {
    const tmp_xmax = mz.x_maze_max;
    const tmp_ymax = mz.y_maze_max;

    if (corrwid === -1) corrwid = rnd(4);
    if (wallthick === -1) wallthick = rnd(4) - corrwid;

    if (wallthick < 1) wallthick = 1;
    else if (wallthick > 5) wallthick = 5;
    if (corrwid < 1) corrwid = 1;
    else if (corrwid > 5) corrwid = 5;

    const scale = corrwid + wallthick;
    const rdx = Math.trunc(mz.x_maze_max / scale);
    const rdy = Math.trunc(mz.y_maze_max / scale);
    const corrmaze = !!game.level?.flags?.corrmaze;

    if (corrmaze) {
        for (let x = 2; x < rdx * 2; x++)
            for (let y = 2; y < rdy * 2; y++) {
                const loc = game.level.at(x, y);
                if (loc) loc.typ = STONE;
            }
    } else {
        for (let x = 2; x <= rdx * 2; x++)
            for (let y = 2; y <= rdy * 2; y++) {
                const loc = game.level.at(x, y);
                if (loc) loc.typ = ((x % 2) && (y % 2)) ? STONE : HWALL;
            }
    }

    // set upper bounds for maze0xy and walkfrom
    mz.x_maze_max = rdx * 2;
    mz.y_maze_max = rdy * 2;

    const mm = maze0xy();
    walkfrom(mm.x, mm.y, 0);

    if (rmdeadends) maze_remove_deadends(corrmaze ? CORR : ROOM);

    // restore bounds
    mz.x_maze_max = tmp_xmax;
    mz.y_maze_max = tmp_ymax;

    if (scale > 2) {
        // back up the existing smaller maze, then tile each small-grid cell
        // into a mx-by-my block.
        const tmpmap = [];
        for (let x = 1; x < mz.x_maze_max; x++) {
            tmpmap[x] = [];
            for (let y = 1; y < mz.y_maze_max; y++)
                tmpmap[x][y] = game.level.at(x, y)?.typ;
        }

        let rx = 2, x = 2;
        while (rx < mz.x_maze_max) {
            const mx = (x % 2) ? corrwid
                : (x === 2 || x === rdx * 2) ? 1 : wallthick;
            let ry = 2, y = 2;
            while (ry < mz.y_maze_max) {
                const my = (y % 2) ? corrwid
                    : (y === 2 || y === rdy * 2) ? 1 : wallthick;
                for (let dx = 0; dx < mx; dx++) {
                    for (let dy = 0; dy < my; dy++) {
                        if (rx + dx >= mz.x_maze_max || ry + dy >= mz.y_maze_max)
                            break;
                        const loc = game.level.at(rx + dx, ry + dy);
                        const t = tmpmap[x]?.[y];
                        if (loc && t != null) loc.typ = t;
                    }
                }
                ry += my;
                y++;
            }
            rx += mx;
            x++;
        }
    }
}

// C ref: mkmaze.c:1484 fumaroles() — "augment the Plane of Fire"; called from
// goto_level() on arrival and from moveloop_core() every turn a level carries
// des.level_flags("fumaroles").  The rn2(3) count and the per-fumarole
// rn1(COLNO-4,3)/rn1(ROWNO-4,3) coordinate pair ALWAYS draw; the gas cloud (and
// its two extra rolls) only when the square happens to be lava.
export function fumaroles() {
    const g = game;
    let nmax = rn2(3);                                   // mkmaze.c:1486
    let sizemin = 5;
    if (Is_firelevel(g.u?.uz)) { nmax++; sizemin += 5; }
    if ((g.level?.flags?.temperature ?? 0) > 0) { nmax++; sizemin += 5; }
    for (let n = nmax; n; n--) {
        const x = rn2(COLNO - 4) + 3;                    // mkmaze.c:1500
        const y = rn2(ROWNO - 4) + 3;                    // mkmaze.c:1501
        if (g.level?.at(x, y)?.typ === LAVAPOOL) {
            // C ref: region.c create_gas_cloud(x, y, rn1(10, sizemin),
            // rn1(10, 5)) — the region itself is not modelled, but both rolls
            // are part of the stream.
            rn2(10); rn2(10);
            void sizemin;
        }
    }
}

// ── Special waterlevel stuff in endgame (TH) ─────────────────────────────────
// C ref: mkmaze.c:1576-2107.  The Planes of Water and Air are built as one
// solid element by their .lua scripts; everything the hero actually stands in
// is made here, at fixup_special() time (setup_waterlevel) and then again on
// every arrival/turn (movebubbles).  Water bubbles CARRY their contents (hero,
// monsters, objects, traps) as they drift; Air clouds only repaint terrain.

// C ref: mkmaze.c:1524-1527 — the bubble movement boundaries, one cell inside
// the box setup_waterlevel() hardcodes into svx/svy (which save_waterlevel
// writes into the level file, so a revisit gets the same numbers back).
const wl = { xmin: 0, ymin: 0, xmax: 0, ymax: 0 };
const gbxmin = () => wl.xmin + 1;
const gbymin = () => wl.ymin + 1;
const gbxmax = () => wl.xmax - 1;
const gbymax = () => wl.ymax - 1;

// C ref: mkmaze.c:1530 `static struct bubble *hero_bubble` — the bubble the
// hero is riding, set by movebubbles()'s pickup pass and read by
// maybe_adjust_hero_bubble().
let hero_bubble = null;

// C ref: mkmaze.c:1543 `static boolean up = FALSE` inside movebubbles() — a
// function-scope static, so it toggles once per call for the whole GAME and is
// deliberately not reset per level.
let mb_up = false;

// C ref: mkmaze.c svb.bbubbles (head) / ge.ebubbles (tail).  save_waterlevel()
// writes the chain into the LEVEL file, so it rides with game.level exactly as
// the region list and the footprint ring do; iterating the array forwards is
// b->next, backwards is b->prev.
function bubble_list() {
    const lev = game.level;
    if (!lev) return [];
    if (!lev.bubbles) lev.bubbles = [];
    return lev.bubbles;
}

// C ref: mkmaze.c:1801 set_wportal() — "there better be only one magic portal
// on water level".  gw.wportal is never read back in 3.7; the assignment is
// kept so the impossible() branch stays reachable the same way.
function set_wportal() {
    for (const t of (game.level?.traps || []))
        if (t.ttyp === MAGIC_PORTAL) { game.wportal = t; return; }
    game.wportal = null;
}

// C ref: mkmaze.c movebubbles()'s `levl[x][y] = water_pos` / `= air_pos`.  That
// is a WHOLE struct rm assignment, so seenv, flags, horizontal, waslit, roomno,
// edge and candig are all zeroed alongside typ/lit/glyph.  This port splits C's
// 5-bit `flags` into doormask + wall_info, so both are cleared here.
function set_bubble_bg(loc, glyph, typ, lit) {
    loc.typ = typ;
    loc.seenv = 0;
    loc.flags = 0;
    loc.doormask = 0;
    loc.wall_info = 0;
    loc.horizontal = false;
    loc.lit = !!lit;
    loc.waslit = false;
    loc.roomno = 0;
    loc.edge = false;
    loc.invisMon = false;
    loc.remembered_glyph = { ch: glyph.ch, color: glyph.color, decgfx: glyph.dec };
}

// C ref: display.h cmap_to_glyph(S_water/S_air/S_cloud) — the base element's
// map-memory glyph.  Routed through back_to_glyph()'s own table so the DEC /
// ASCII symset choice stays in one place.
function element_glyph(typ) { return terrain_glyph({ typ }, 0, 0); }

// C ref: mkmaze.c:1811 setup_waterlevel() — called from fixup_special() BEFORE
// place_lregions(), because the portal's levregion has to land on a square the
// bubbles have already decided about.  Draw order: the xskip/yskip pair, then
// for every grid point an rn2(7) bubble size followed by mk_bubble()'s own
// rolls.
export async function setup_waterlevel() {
    const g = game;
    const water = !!Is_waterlevel(g.u?.uz);
    // C: panic() when neither.  Nothing else may call this.
    if (!water && !Is_airlevel(g.u?.uz)) return;

    /* ouch, hardcoded... (file scope statics and used in bxmin,bymax,&c) */
    wl.xmin = 3;
    wl.ymin = 1;
    wl.xmax = Math.min(78, (COLNO - 1) - 1);
    wl.ymax = Math.min(20, ROWNO - 1);

    // "entire level is remembered as one glyph and any unspecified portion
    // should default to level's base element rather than to usual stone"
    const glyph = element_glyph(water ? WATER : AIR);
    const typ = water ? WATER : AIR;
    for (let x = 1; x <= COLNO - 1; x++)
        for (let y = 0; y <= ROWNO - 1; y++) {
            const loc = g.level?.at(x, y);
            if (!loc) continue;
            loc.remembered_glyph = { ch: glyph.ch, color: glyph.color, decgfx: glyph.dec };
            if (loc.typ === STONE) loc.typ = typ;
        }

    /* make bubbles */
    let xskip, yskip;
    if (water) {
        xskip = 10 + rn2(10);                            // mkmaze.c:1847
        yskip = 4 + rn2(4);                              // mkmaze.c:1848
    } else {
        xskip = 6 + rn2(4);                              // mkmaze.c:1850
        yskip = 3 + rn2(3);                              // mkmaze.c:1851
    }
    for (let x = gbxmin(); x <= gbxmax(); x += xskip)
        for (let y = gbymin(); y <= gbymax(); y += yskip)
            await mk_bubble(x, y, rn2(7));               // mkmaze.c:1856
}

// C ref: mkmaze.c:1859 unsetup_waterlevel() — free the chain.  Reached from
// save_waterlevel()'s release_data() arm when the level is written out.
export function unsetup_waterlevel() {
    const lev = game.level;
    if (lev) lev.bubbles = [];
    hero_bubble = null;
}

// C ref: mkmaze.c:1877 mk_bubble()'s bm2..bm8 bit masks.  "These bit masks make
// visually pleasing bubbles on a normal aspect 25x80 terminal, which naturally
// results in them being mathematically anything but symmetric."  bm[0]/bm[1]
// are the bounding-box width/height; bm[2+j] is row j's column bitmap.
const BMASK = [
    [2, 1, 0x3],
    [3, 2, 0x7, 0x7],
    [4, 3, 0x6, 0xf, 0x6],
    [5, 3, 0xe, 0x1f, 0xe],
    [6, 4, 0x1e, 0x3f, 0x3f, 0x1e],
    [7, 4, 0x3e, 0x7f, 0x7f, 0x3e],
    [8, 4, 0x7e, 0xff, 0xff, 0x7e],
];

// C ref: mkmaze.c:1863 mk_bubble(x, y, n).  The early return draws NOTHING, so
// a grid point past the far edge costs only setup_waterlevel's own rn2(7).
async function mk_bubble(x, y, n) {
    if (x >= gbxmax() || y >= gbymax()) return;
    if (n >= BMASK.length) n = BMASK.length - 1;   // C: impossible("n too large")
    const bm = BMASK[n];
    if ((x + bm[0] - 1) > gbxmax()) x = gbxmax() - bm[0] + 1;
    if ((y + bm[1] - 1) > gbymax()) y = gbymax() - bm[1] + 1;
    const b = {
        x, y,
        dx: 0, dy: 0,
        // C: memcpy of (bmask[n][1] + 2) bytes — the dims plus one byte per row.
        bm: bm.slice(0, bm[1] + 2),
        cons: [],
    };
    b.dx = 1 - rn2(3);                                   // mkmaze.c:1909
    b.dy = 1 - rn2(3);                                   // mkmaze.c:1910
    bubble_list().push(b);
    await mv_bubble(b, 0, 0, true);
}

// C ref: mkmaze.c:1928 maybe_adjust_hero_bubble() — after a successful walk on
// the Plane of Water, the bubble the hero rides may take up the hero's heading.
export function maybe_adjust_hero_bubble() {
    const u = game.u;
    if (!Is_waterlevel(u?.uz)) return;
    if (!u.dx && !u.dy) return;
    if (hero_bubble && !rn2(2)) {                        // mkmaze.c:1938
        hero_bubble.dx = u.dx;
        hero_bubble.dy = u.dy;
    }
}

// C ref: mkmaze.c:1949 mv_bubble(b, dx, dy, ini).
//
// "The player, the portal and all other objects and monsters float along with
// their associated bubbles.  Bubbles may overlap freely, and the contents may
// get associated with other bubbles in the process."
//
// Draw order: the air level's "clouds move slowly" rn2(6) gate first, then
// (only from the movebubbles() pass, never from mk_bubble's ini=TRUE call) the
// colli==0 direction shake — rn2(20) for a drifting bubble, rn2(5) for a
// stationary one, each followed by two rn2(3) when it fires.
async function mv_bubble(b, dx, dy, ini) {
    const g = game;
    const water = !!Is_waterlevel(g.u?.uz);
    const air = !!Is_airlevel(g.u?.uz);
    let colli = 0;

    /* clouds move slowly */
    if (!air || !rn2(6)) {                               // mkmaze.c:1959
        /* move bubble */
        if (dx < -1 || dx > 1 || dy < -1 || dy > 1) {
            dx = Math.sign(dx);
            dy = Math.sign(dy);
        }

        // collision with level borders?
        //      1 = horizontal border, 2 = vertical, 3 = corner
        if (b.x <= gbxmin()) colli |= 2;
        if (b.y <= gbymin()) colli |= 1;
        if ((b.x + b.bm[0] - 1) >= gbxmax()) colli |= 2;
        if ((b.y + b.bm[1] - 1) >= gbymax()) colli |= 1;

        // C's four out-of-range arms each pline() a diagnostic and clamp; the
        // clamp is kept, the debug line is not a game message.
        if (b.x < gbxmin()) b.x = gbxmin();
        if (b.y < gbymin()) b.y = gbymin();
        if ((b.x + b.bm[0] - 1) > gbxmax()) b.x = gbxmax() - b.bm[0] + 1;
        if ((b.y + b.bm[1] - 1) > gbymax()) b.y = gbymax() - b.bm[1] + 1;

        /* bounce if we're trying to move off the border */
        if (b.x === gbxmin() && dx < 0) dx = -dx;
        if (b.x + b.bm[0] - 1 === gbxmax() && dx > 0) dx = -dx;
        if (b.y === gbymin() && dy < 0) dy = -dy;
        if (b.y + b.bm[1] - 1 === gbymax() && dy > 0) dy = -dy;

        b.x += dx;
        b.y += dy;
    }

    /* draw the bubbles */
    for (let i = 0, x = b.x; i < b.bm[0]; i++, x++)
        for (let j = 0, y = b.y; j < b.bm[1]; j++, y++)
            if (b.bm[j + 2] & (1 << i)) {
                const loc = g.level?.at(x, y);
                if (!loc) continue;
                if (water) {
                    loc.typ = AIR;
                    loc.lit = true;
                    unblock_point(x, y);
                } else if (air) {
                    loc.typ = CLOUD;
                    loc.lit = true;
                    block_point(x, y);
                }
            }

    if (water) await replace_bubble_contents(b, dx, dy);

    /* boing? */
    switch (colli) {
    case 1:
        b.dy = -b.dy;
        break;
    case 3:
        b.dy = -b.dy;
        /* FALLTHRU */
    case 2:
        b.dx = -b.dx;
        break;
    default:
        // sometimes alter direction for fun anyway
        // (higher probability for stationary bubbles)
        if (!ini && ((b.dx || b.dy) ? !rn2(20) : !rn2(5))) {   // mkmaze.c:2102
            b.dx = 1 - rn2(3);                                 // mkmaze.c:2103
            b.dy = 1 - rn2(3);                                 // mkmaze.c:2104
        }
        break;
    }
}

// C ref: mkmaze.c:1567-1647 — movebubbles()'s Plane-of-Water pickup pass.
// Everything standing on a bubble cell is lifted off the map into b->cons, the
// cell is reset to solid water, and mv_bubble() puts the pile back down at the
// bubble's new offset.  Nothing here draws RNG.
function pickup_bubble_contents(b) {
    const g = game;
    const water_glyph = element_glyph(WATER);
    for (let i = 0, x = b.x; i < b.bm[0]; i++, x++)
        for (let j = 0, y = b.y; j < b.bm[1]; j++, y++) {
            if (!(b.bm[j + 2] & (1 << i))) continue;
            if (!isok(x, y)) continue;   // C: impossible("movebubbles: bad pos")

            /* pick up objects, monsters, hero, and traps */
            const here = objects_at(x, y);
            if (here.length) {
                // C detaches the pile head-first onto `olist`, which reverses
                // it; mv_bubble then place_object()s that list back in order.
                const olist = [];
                for (const otmp of [...here]) {
                    obj_extract_self(otmp);
                    otmp.ox = otmp.oy = 0;
                    olist.unshift(otmp);
                }
                b.cons.unshift({ x, y, what: 'obj', list: olist });
            }
            const mon = m_at(x, y);
            if (mon) {
                b.cons.unshift({ x, y, what: 'mon', list: mon });
                // C: remove_worm()/remove_monster(x, y).  This port keys
                // monsters off their own mx/my rather than a grid, so taking
                // one off the map IS the coordinate write C does next.
                newsym(x, y);            /* clean up old position */
                mon.mx = mon.my = 0;
            }
            if (!g.u?.uswallow && x === g.u?.ux && y === g.u?.uy) {
                b.cons.unshift({ x, y, what: 'hero', list: null });
                hero_bubble = b;
            }
            const btrap = t_at(x, y);
            if (btrap) b.cons.unshift({ x, y, what: 'trap', list: btrap });

            const loc = g.level.at(x, y);
            set_bubble_bg(loc, water_glyph, WATER, false);
            block_point(x, y);
        }
}

// C ref: mkmaze.c:2027-2085 — mv_bubble()'s "replace contents of bubble" arm,
// Plane of Water only.  C frees each container as it goes, so the list is
// consumed exactly once.
async function replace_bubble_contents(b, dx, dy) {
    const g = game;
    for (const cons of b.cons) {
        cons.x += dx;
        cons.y += dy;
        switch (cons.what) {
        case 'obj':
            for (const olist of cons.list) {
                place_object(olist, cons.x, cons.y);
                stackobj(olist);
            }
            break;
        case 'mon': {
            const mon = cons.list;
            // C: `if (!mnearto(mon, cons->x, cons->y, TRUE, RLOC_NOMSG))
            //         elemental_clog(mon);`
            await mnearto_bubble(mon, cons.x, cons.y);
            break;
        }
        case 'hero': {
            // do.js imports this module (fumaroles), so the two hero helpers
            // are pulled in on demand rather than statically.
            const { u_on_newpos, mnexto_rloc } = await import('./do.js');
            const mtmp = m_at(cons.x, cons.y);
            const ux0 = g.u.ux, uy0 = g.u.uy;
            u_on_newpos(cons.x, cons.y);
            newsym(ux0, uy0);            /* clean up old position */
            if (mtmp) await mnexto_rloc(mtmp, RLOC_NOMSG);
            break;
        }
        case 'trap':
            cons.list.tx = cons.x;
            cons.list.ty = cons.y;
            break;
        default:
            break;
        }
    }
    b.cons = [];
}

// C ref: mon.c:4030 mnearto(mtmp, x, y, move_other=TRUE, RLOC_NOMSG), reached
// only from mv_bubble().  NOT ported: the deal_with_overcrowding() ->
// elemental_clog() tail that runs when enexto() cannot find any square at all
// (it needs the whole "besieged" elemental-obliteration walk of mon.c:3878).
// Every other path — already-there, occupied-so-displace-the-other, goodpos,
// enexto fallback — is C's.
async function mnearto_bubble(mtmp, x, y) {
    if (mtmp.mx === x && mtmp.my === y && m_at(x, y) === mtmp) return 1;

    const othermon = m_at(x, y);
    /* take othermon off the map; it might end up immediately returning
       but for the moment it is leaving */
    if (othermon) othermon.mx = othermon.my = 0;
    let newx = x, newy = y;
    if (!goodpos(newx, newy, mtmp, 0)) {
        const mm = enexto_spawn(newx, newy, mtmp.data);
        if (!mm || !isok(mm.x, mm.y)) return 0;
        newx = mm.x; newy = mm.y;
    }
    await rloc_to(mtmp, newx, newy);   /* rloc_to_flag(..., RLOC_NOMSG) */
    if (othermon) {
        /* 'move_other'==FALSE this time; fail rather than recurse */
        await mnearto_bubble(othermon, x, y);
        return 2;
    }
    return 1;
}

// C ref: mkmaze.c:1538 movebubbles() — "augment the Planes of Water (for
// bubbles) and Air (for clouds); called from goto_level() when arriving and
// moveloop_core() when on the level".
//
// Draw order, and it is the whole game here: on Air, the perimeter-break
// rn2(3)/rn2(5) sweep over EVERY cell of the level runs first (5 edge columns x
// 21 rows at rn2(3), then 3 edge rows x 74 interior columns at rn2(5) = 327
// draws on a default 80x21 map), and only then the per-bubble rx/ry pair plus
// mv_bubble's own rolls.  On Water the sweep does not exist; the pickup pass
// replaces it and draws nothing.
export async function movebubbles() {
    const g = game;
    const water = !!Is_waterlevel(g.u?.uz);
    const air = !!Is_airlevel(g.u?.uz);

    /* set up the portal the first time bubbles are moved */
    if (!g.wportal) set_wportal();

    vision_recalc(2);

    hero_bubble = null;

    const list = bubble_list();
    let bcpin = 0;
    if (water) {
        /* keep attached ball&chain separate from bubble objects */
        if (g.u?.uball) {
            // C ref: ball.c:222 unplacebc_and_covet_placebc() — rnd(400) is the
            // restriction cookie, and it IS part of the stream.
            bcpin = rnd(400);
            unplacebc();
        }
        // "Pick up everything inside of a bubble then fill all bubble
        // locations."  Uses the PREVIOUS call's `up`, before the toggle below.
        for (const b of (mb_up ? list : [...list].reverse()))
            pickup_bubble_contents(b);
    } else if (air) {
        const air_glyph = element_glyph(CLOUD);
        for (let x = 1; x <= COLNO - 1; x++)
            for (let y = 0; y <= ROWNO - 1; y++) {
                const loc = g.level?.at(x, y);
                if (!loc) continue;
                set_bubble_bg(loc, air_glyph, AIR, true);
                recalc_block_point(x, y);
                // "all air or all cloud around the perimeter of the Air level
                // tends to look strange; break up the pattern"
                const xedge = (x < gbxmin() || x > gbxmax());
                const yedge = (y < gbymin() || y > gbymax());
                if (xedge || yedge) {
                    if (!rn2(xedge ? 3 : 5)) {           // mkmaze.c:1660
                        loc.typ = CLOUD;
                        block_point(x, y);
                    }
                }
            }
    }

    // "Every second time traverse down.  This is because otherwise all the junk
    // that changes owners when bubbles overlap would eventually end up in the
    // last bubble in the chain."
    mb_up = !mb_up;
    for (const b of (mb_up ? list : [...list].reverse())) {
        const rx = rn2(3), ry = rn2(3);                  // mkmaze.c:1675
        await mv_bubble(b, b.dx + 1 - (!b.dx ? rx : (rx ? 1 : 0)),
                        b.dy + 1 - (!b.dy ? ry : (ry ? 1 : 0)), false);
    }

    /* put attached ball&chain back */
    if (water && g.u?.uball) {
        void bcpin;                      // C: lift_covet_and_placebc(bcpin)
        placebc();
    }
    g.vision_full_recalc = 1;
}

// C ref: mkmaze.c:1688 water_friction() — "when moving in water, possibly (1 in
// 3) alter the intended destination".  Called from hack.c water_turbulence(),
// i.e. only while u.uinwater.
export async function water_friction() {
    const u = game.u;
    let x, y, dx, dy;
    let eff = false;

    if (u.uprops?.Swimming && rn2(4))
        return; /* natural swimmers have advantage */

    if (u.dx && !rn2(!u.dy ? 3 : 6)) { /* 1/3 chance or half that */
        /* cancel delta x and choose an arbitrary delta y value */
        x = u.ux;
        do {
            dy = rn2(3) - 1; /* -1, 0, 1 */
            y = u.uy + dy;
        } while (dy && (!isok(x, y) || !is_pool_bubble(x, y)));
        u.dx = 0;
        u.dy = dy;
        eff = true;
    } else if (u.dy && !rn2(!u.dx ? 3 : 5)) { /* 1/3 or 1/5*(5/6) */
        /* cancel delta y and choose an arbitrary delta x value */
        y = u.uy;
        do {
            dx = rn2(3) - 1; /* -1 .. 1 */
            x = u.ux + dx;
        } while (dx && (!isok(x, y) || !is_pool_bubble(x, y)));
        u.dy = 0;
        u.dx = dx;
        eff = true;
    }
    if (eff) await pline('Water turbulence affects your movements.');
}

// C ref: rm.h is_pool(x,y) — POOL/MOAT/WATER (the drawbridge arm cannot occur
// on the Plane of Water).
function is_pool_bubble(x, y) {
    const t = game.level?.at(x, y)?.typ;
    return t === POOL || t === MOAT || t === WATER;
}

// ─────────────────────────────────────────────────────────────────────────────
// mkmaze.c: the remaining top-level functions.
//
// A faithful, INERT translation — nothing above this line calls into this
// block, and no existing function was touched.  Two house rules apply:
//   * where a C callee has no port at all the call site is flagged
//     `UNPORTED:` and left visible rather than stubbed silently;
//   * where the port DOES have it but under a module-private name, the
//     file:line is named so the fix is to export that one, not to fork it.
//
// The static imports below deliberately only name modules already in this
// file's static graph plus the two leaf data modules; everything else is
// reached with `await import()`.  Adding sp_lev.js / mklev.js / dungeon.js to
// the static graph would introduce a cycle THROUGH mkmaze.js (both import
// create_maze/walkfrom from here) and reorder ESM evaluation, which this port
// is measurably sensitive to.

import { rn1 as mm_rn1 } from './rng.js';
import {
    IS_STWALL, SPACE_POS, TRAPNUM, NO_TRAP, is_pit, is_hole,
    VIBRATING_SQUARE, MKTRAP_MAZEFLAG, MKTRAP_SEEN, ROCKTRAP,
    NO_MM_FLAGS, MM_NONAME, CORPSTAT_NONE,
    LR_BRANCH, LR_PORTAL, LR_UPSTAIR, LR_DOWNSTAIR,
    LR_TELE, LR_UPTELE, LR_DOWNTELE,
    MIGR_RANDOM, MIGR_LEFTOVERS,
    Is_medusa_level, Is_stronghold, In_quest,
    COUNTING as MM_COUNTING, WRITING as MM_WRITING, FREEING as MM_FREEING,
} from './const.js';
import { depth as mm_depth, distmin as mm_distmin } from './hacklib.js';
import { within_bounded_area as mm_within_bounded_area } from './rect.js';
import { occupied as mm_occupied, somex as mm_somex, somey as mm_somey } from './mkroom.js';
import { is_orc_flag as mm_is_orc } from './monflags_data.js';
import { makemon as mm_makemon, set_malign as mm_set_malign } from './makemon.js';
import {
    objects as MM_OBJECTS, mksobj as mm_mksobj, mkobj as mm_mkobj,
    mkobj_at as mm_mkobj_at, mksobj_at as mm_mksobj_at, mkgold as mm_mkgold,
    mk_tt_object as mm_mk_tt_object, mkcorpstat as mm_mkcorpstat,
    set_corpsenm as mm_set_corpsenm, weight as mm_weight,
    dealloc_obj as mm_dealloc_obj,
    mksobj_migr_to_species as mm_mksobj_migr_to_species,
    RANDOM_CLASS as MM_RANDOM_CLASS, GEM_CLASS as MM_GEM_CLASS,
    RING_CLASS as MM_RING_CLASS, FOOD_CLASS as MM_FOOD_CLASS,
    ROCK as MM_ROCK, BOULDER as MM_BOULDER, STATUE as MM_STATUE,
    GOLD_PIECE as MM_GOLD_PIECE,
} from './mkobj.js';

// C ref: objects.h otyps, resolved against js/mkobj.js objects[] by name (the
// pattern js/artifact.js:154 and js/sp_lev.js:5188 already use).
function mm_otyp_by_name(nm) { return MM_OBJECTS.findIndex((o) => o.name === nm); }
const MM_STRANGE_OBJECT = 0;
const MM_TALLOW_CANDLE = mm_otyp_by_name('tallow candle');
const MM_WAX_CANDLE = mm_otyp_by_name('wax candle');
const MM_SKELETON_KEY = mm_otyp_by_name('skeleton key');
const MM_LEATHER_GLOVES = mm_otyp_by_name('leather gloves');
const MM_GAUNTLETS_OF_DEXTERITY = mm_otyp_by_name('gauntlets of dexterity');
const MM_TRIPE_RATION = mm_otyp_by_name('tripe ration');
const MM_TIN = mm_otyp_by_name('tin');
const MM_LEMBAS_WAFER = mm_otyp_by_name('lembas wafer');
const MM_C_RATION = mm_otyp_by_name('C-ration');
const MM_K_RATION = mm_otyp_by_name('K-ration');
const MM_CORPSE = mm_otyp_by_name('corpse');
const MM_EGG = mm_otyp_by_name('egg');
const MM_SLIME_MOLD = mm_otyp_by_name('slime mold');
const MM_LONG_SWORD = mm_otyp_by_name('long sword');
const MM_SILVER_SABER = mm_otyp_by_name('silver saber');

// monsters.h PM_ indices this block names.
const MM_PM_MINOTAUR = 210;
const MM_PM_ORC = 72;
const MM_PM_ORC_SHAMAN = 76;
const MM_PM_ORC_CAPTAIN = 80;

// C ref: decl.c gr.ransacked — set by check_ransacked() while makemaz() picks
// the proto level name, read by fixup_special() after the level is built and
// cleared by stolen_booty().  Not saved: it only lives across one mklev().
export const gr = { ransacked: 0 };

// C ref: mkmaze.c:70 is_solid(x, y) — "return TRUE if out of bounds, wall or
// rock".  Note this is NOT iswall_or_stone(): IS_STWALL covers STONE too, so
// out-of-bounds and every undug cell answer TRUE.
export function is_solid(x, y) {
    return !isok(x, y) || IS_STWALL(game.level?.at(x, y)?.typ);
}

// C ref: mkmaze.c:317 is_exclusion_zone(type, x, y) — walks sve.exclusion_zones
// (registered by nhlua.c's des.exclusion() / lspo_exclusion()).  An LR_TELE
// zone blocks BOTH LR_UPTELE and LR_DOWNTELE queries; every other type matches
// only itself.
export function is_exclusion_zone(type, x, y) {
    for (const ez of (game.exclusion_zones || [])) {
        if (((type === LR_DOWNTELE
              && (ez.zonetype === LR_DOWNTELE || ez.zonetype === LR_TELE))
             || (type === LR_UPTELE
                 && (ez.zonetype === LR_UPTELE || ez.zonetype === LR_TELE))
             || type === ez.zonetype)
            && mm_within_bounded_area(x, y, ez.lx, ez.ly, ez.hx, ez.hy))
            return true;
    }
    return false;
}

// C ref: mkmaze.c:707 check_ransacked(s) — "this kludge only works as long as
// orctown is minetn-1".  Called from makemaz() with the proto file name BEFORE
// LEV_EXT is appended, so the compare is against the bare "minetn-1".
export function check_ransacked(s) {
    gr.ransacked = (game.u?.uz?.dnum === game.mines_dnum && s === 'minetn-1')
        ? 1 : 0;
}

// C ref: mkmaze.c:713 `#define ORC_LEADER 1` and the orcfruit[] table used by
// migr_booty_item()'s SLIME_MOLD arm.
const ORC_LEADER = 1;
const orcfruit = ['paddle cactus', 'dwarven root'];

// C ref: dungeon.c get_level(&dest, nlev) — an absolute depth to a d_level in
// whichever dungeon holds that depth.  js/dig.js:923 carries a one-line private
// copy that just assumes the current dungeon; this is the clamped walk C does
// for the only caller here (a Mines level, so the branch is never crossed).
function mm_get_level(nlev) {
    const g = game;
    const dnum = g.u?.uz?.dnum ?? 0;
    const dgn = g.dungeons?.[dnum];
    const depth_start = dgn?.depth_start ?? 1;
    const num = dgn?.num_dunlevs ?? 1;
    let dlevel = nlev - depth_start + 1;
    if (dlevel < 1) dlevel = 1;
    else if (dlevel > num) dlevel = num;
    return { dnum, dlevel };
}

// C ref: mkmaze.c:717 migrate_orc(mtmp, mflags) — send one member of the gang
// that sacked Frontier Town down the Mines.  The LEADER goes to the bottom
// (with a 1-in-40 "not quite the very bottom") and carries MIGR_LEFTOVERS;
// everyone else gets a uniform level between here and the bottom, bumped one
// deeper when the roll lands on the current level.
export function migrate_orc(mtmp, mflags) {
    let nlev;
    const cur_depth = mm_depth(game.u?.uz) | 0;
    const dgn = game.dungeons?.[game.u?.uz?.dnum ?? 0];
    const max_depth = (dgn?.num_dunlevs ?? 1) + ((dgn?.depth_start ?? 1) - 1);

    if (mflags === ORC_LEADER) {
        /* Note that the orc leader will take possession of any remaining
           stuff not already delivered to other orcs between here and the
           bottom of the mines. */
        nlev = max_depth;
        /* once in a blue moon, he won't be at the very bottom */
        if (!rn2(40)) nlev--;                            // mkmaze.c:737
        mtmp.migflags = (mtmp.migflags | 0) | MIGR_LEFTOVERS;
    } else {
        nlev = rn2((max_depth - cur_depth) + 1) + cur_depth;   // mkmaze.c:740
        if (nlev === cur_depth) nlev++;
        if (nlev > max_depth) nlev = max_depth;
        mtmp.migflags = (mtmp.migflags | 0) & ~MIGR_LEFTOVERS;
    }
    const dest = mm_get_level(nlev);
    // UNPORTED: dungeon.c migrate_to_level(mtmp, ledger_no(&dest),
    // MIGR_RANDOM, (coord *) 0).  Neither migrate_to_level() nor ledger_no()
    // has a live port (js/dig.js:924/925 are no-op privates, js/mon.js:2958
    // migrate_mon_local() names the same gap), so the monster is not actually
    // handed to the migrating-monster list here.  Everything above it — the
    // rn2(40) / rn2(range) draws and the migflags bit — is C's.
    void dest; void MIGR_RANDOM;
}

// C ref: mon.c add_to_minv(mon, obj) — prepend to the monster's minvent chain.
// js/vault.js:184 and js/shk.js:3084 already carry private copies; the right
// fix is to export ONE of them, so this local is deliberately a different name
// and only exists so the two mkmaze callers below can be written out in full.
function mm_add_to_minv(mon, obj) {
    if (!mon.minvent) mon.minvent = [];
    obj.where = 'minvent';
    obj.ocarry = mon;
    mon.minvent.unshift(obj);
    return obj;
}

// C ref: mkmaze.c:748 shiny_orc_stuff(mtmp) — the loot each member of the gang
// carries off.  Draw order is fixed: the gold gate, then the gold quantity,
// then the gem gate, then (captain OR 1-in-8) the ring.  An orc captain is
// twice as likely to have gold and gets the ring unconditionally.
export function shiny_orc_stuff(mtmp) {
    const is_captain = (mtmp.data?.name === 'orc-captain'
                        || mtmp.mnum === MM_PM_ORC_CAPTAIN);
    /* probabilities */
    const goldprob = is_captain ? 600 : 300;
    const gemprob = Math.trunc(goldprob / 4);

    if (rn2(1000) < goldprob) {                           // mkmaze.c:757
        const otmp = mm_mksobj(MM_GOLD_PIECE, true, false);
        if (otmp) {
            otmp.quan = 1 + rnd(goldprob);                // mkmaze.c:759
            otmp.owt = mm_weight(otmp);
            mm_add_to_minv(mtmp, otmp);
        }
    }
    if (rn2(1000) < gemprob) {                            // mkmaze.c:764
        const otmp = mm_mkobj(MM_GEM_CLASS, false);
        if (otmp) {
            if (otmp.otyp === MM_ROCK) mm_dealloc_obj(otmp);
            else mm_add_to_minv(mtmp, otmp);
        }
    }
    if (is_captain || !rn2(8)) {                          // mkmaze.c:771
        const otyp = mm_shiny_obj(MM_RING_CLASS);
        let otmp;
        if (otyp !== MM_STRANGE_OBJECT && (otmp = mm_mksobj(otyp, true, false)))
            mm_add_to_minv(mtmp, otmp);
    }
}

// C ref: objnam.c shiny_obj(oclass) — js/objnam.js exports the real one, but
// objnam.js is not in this file's static graph (it pulls in shk.js/makemon.js),
// so the one call site resolves it lazily.  Kept synchronous by caching.
let mm_shiny_ring = null;
function mm_shiny_obj(oclass) {
    if (oclass === MM_RING_CLASS && mm_shiny_ring != null) return mm_shiny_ring;
    // C ref: objnam.c shiny_obj() — RING_CLASS answers the first gold ring in
    // objects[], i.e. "ring of adornment"'s material==GOLD sibling; resolving
    // it by material keeps this out of objnam.js's import closure.
    const i = MM_OBJECTS.findIndex((o) => o.oc_class === oclass
                                   && /gold/i.test(String(o.material ?? '')));
    const res = i >= 0 ? i : MM_STRANGE_OBJECT;
    if (oclass === MM_RING_CLASS) mm_shiny_ring = res;
    return res;
}

// C ref: mkmaze.c:780 migr_booty_item(otyp, gang) — one object destined for
// whichever orc of the gang picks it up, named after the gang.  Food gets a
// random extra 0..2 to the stack and a slime mold gets one of the two orcish
// fruit names (a CORE rn2(2) via ROLL_FROM).
export async function migr_booty_item(otyp, gang) {
    const { new_oname } = await import('./do_name.js');
    const { fruitadd } = await import('./options.js');

    const otmp = mm_mksobj_migr_to_species(otyp, 0x00000080 /*M2_ORC*/, true, false);
    if (otmp && gang) {
        new_oname(otmp, gang.length + 1); /* removes old name if present */
        if (!otmp.oextra) otmp.oextra = {};
        otmp.oextra.oname = gang;
        otmp.oname = gang;
        if (MM_OBJECTS[otyp]?.oc_class === MM_FOOD_CLASS) {
            if (otyp === MM_SLIME_MOLD)
                otmp.spe = fruitadd(orcfruit[rn2(orcfruit.length)], null);
            otmp.quan = (otmp.quan | 0) + rn2(3);         // mkmaze.c:792
            otmp.owt = mm_weight(otmp);
        }
    }
    return otmp;
}

// C ref: mkmaze.c:799 stolen_booty() — "A tragic accident has occurred in
// Frontier Town... It has been overrun by orcs."  Reached from fixup_special()
// on the Mines level built right after minetn-1 (orctown).
//
// Draw order matters and is long: rndorcname(), then rnd(4) candles,
// rnd(3) keys, one rn1 glove type, rnd(10) food attempts (each rn1, and only
// the surviving ones make an object), one rn2(2) weapon, the captain, then one
// rn2(10) per already-placed orc on the level, then rn2(10)+5 more gang
// members each with a species roll + shiny_orc_stuff() + migrate_orc().
export async function stolen_booty() {
    const { rndorcname, christen_monst, christen_orc } = await import('./do_name.js');
    const { DEADMONSTER, monsterList } = await import('./mon.js');

    let cnt, i, otyp, mtmp;

    const gang = rndorcname();
    /* create the stuff that the gang took */
    cnt = rnd(4);                                        // mkmaze.c:820
    for (i = 0; i < cnt; ++i)
        await migr_booty_item(rn2(4) ? MM_TALLOW_CANDLE : MM_WAX_CANDLE, gang);
    cnt = rnd(3);                                        // mkmaze.c:823
    for (i = 0; i < cnt; ++i)
        await migr_booty_item(MM_SKELETON_KEY, gang);
    otyp = mm_rn1((MM_GAUNTLETS_OF_DEXTERITY - MM_LEATHER_GLOVES) + 1,
                  MM_LEATHER_GLOVES);
    await migr_booty_item(otyp, gang);
    cnt = rnd(10);                                       // mkmaze.c:828
    for (i = 0; i < cnt; ++i) {
        /* Food items - but no lembas! (or some other weird things) */
        otyp = mm_rn1(MM_TIN - MM_TRIPE_RATION + 1, MM_TRIPE_RATION);
        if (otyp !== MM_LEMBAS_WAFER
            /* exclude meat <anything>, globs of <anything>, kelp which all
               have random generation probability of 0 (K-/C-rations do too,
               but we want to include those) */
            && (MM_OBJECTS[otyp]?.oc_prob !== 0
                || otyp === MM_C_RATION || otyp === MM_K_RATION)
            /* exclude food items which utilize obj->corpsenm because that
               field is going to be overloaded for delivery purposes */
            && otyp !== MM_CORPSE && otyp !== MM_EGG && otyp !== MM_TIN)
            await migr_booty_item(otyp, gang);
    }
    await migr_booty_item(rn2(2) ? MM_LONG_SWORD : MM_SILVER_SABER, gang);

    /* create the leader of the orc gang */
    mtmp = mm_makemon(mm_monster_by_pm(MM_PM_ORC_CAPTAIN), 0, 0, MM_NONAME);
    if (mtmp) {
        mtmp = christen_monst(mtmp, mm_upstart(gang));
        mtmp.mpeaceful = 0;
        mm_set_malign(mtmp);
        shiny_orc_stuff(mtmp);
        migrate_orc(mtmp, ORC_LEADER);
    }

    /* Make most of the orcs on the level be part of the invading gang */
    // C walks the fmon chain, which makemon() prepends to, so this is the
    // newest-first order js/mon.js:183 fmonOrder() reproduces.
    const chain = monsterList();
    for (let k = chain.length - 1; k >= 0; k--) {
        mtmp = chain[k];
        if (DEADMONSTER(mtmp)) continue;

        if (mm_is_orc(mtmp.data) && !mm_has_mgivenname(mtmp) && rn2(10)) {
            /*
             * We'll consider the orc captain from the level description to be
             * the captain of a rival orc horde who is there to see what has
             * transpired, and to contemplate future action.
             *
             * Don't christen the orc captain as a subordinate member of the
             * main orc horde.
             */
            if (mtmp.mnum !== MM_PM_ORC_CAPTAIN
                && mtmp.data?.name !== 'orc-captain')
                christen_orc(mtmp, mm_upstart(gang), '');
        }
    }

    /* Lastly, ensure there's several more orcs from the gang along the way.
     * The mechanics are such that they aren't actually identified as members
     * of the invading gang until they get their spoils assigned to the
     * inventory; handled during that assignment. */
    cnt = rn2(10) + 5;                                   // mkmaze.c:878
    for (i = 0; i < cnt; ++i) {
        const mtyp = rn2((MM_PM_ORC_SHAMAN - MM_PM_ORC) + 1) + MM_PM_ORC;
        mtmp = mm_makemon(mm_monster_by_pm(mtyp), 0, 0, MM_NONAME);
        if (mtmp) {
            shiny_orc_stuff(mtmp);
            migrate_orc(mtmp, 0);
        }
    }
    gr.ransacked = 0;
}

// C ref: &mons[pmidx].  js/makemon.js exports monster_by_pmidx() but it is not
// in this file's static graph; the one-line lookup is inlined so the two
// makemon() call sites above stay synchronous like C's.
function mm_monster_by_pm(pmidx) {
    return game.mons?.[pmidx] ?? { mnum: pmidx };
}

// C ref: mondata.h has_mgivenname(mtmp).  js/const.js:2884 exports the real
// one but under a name this file does not import; kept local rather than
// widening the const.js import list of an existing line.
function mm_has_mgivenname(mtmp) {
    return !!(mtmp?.mextra?.mgivenname || mtmp?.mgivenname);
}

// C ref: hacklib.c upstart(s) — capitalise the first letter IN PLACE.
// js/hack.js:3082 and js/wizcmds.js:418 both carry a private copy.
function mm_upstart(s) {
    const str = String(s ?? '');
    return str ? str[0].toUpperCase() + str.slice(1) : str;
}

// C ref: mkmaze.c:570 fixup_special() — "this is special stuff that the level
// compiler cannot (yet) handle".  Runs at the very end of mklev(), after the
// .lua script has been executed:
//   1. the Planes of Water/Air get their bubbles BEFORE any lregion is placed;
//   2. every registered levregion is consumed — stairs/portals/branch are
//      placed now, the three *TELE kinds only record their rectangles for
//      goto_level() to use on arrival;
//   3. a level that is a branch level but registered no LR_BRANCH gets one;
//   4. the per-level odds and ends: Medusa's statues, the Priest-quest and
//      stronghold graveyard flags, Baalzebub's wallification, and orctown's
//      stolen booty.
export async function fixup_special() {
    const g = game;
    const { place_lregion } = await import('./mklev.js');
    const { find_level } = await import('./dungeon.js');
    let x, y, croom;
    let added_branch = false;
    let lev = null;

    if (Is_waterlevel(g.u?.uz) || Is_airlevel(g.u?.uz)) {
        if (g.level?.flags) g.level.flags.hero_memory = 0;
        /* water level is an odd beast - it has to be set up before calling
           place_lregions etc. */
        await setup_waterlevel();
    }

    for (const r of (g.lregions || [])) {
        let place_it = false;
        switch (r.rtype) {
        case LR_BRANCH:
            added_branch = true;
            place_it = true;
            break;

        case LR_PORTAL:
            if (r.rname && r.rname[0] >= '0' && r.rname[0] <= '9') {
                /* "chutes and ladders" */
                lev = { ...g.u.uz };
                lev.dlevel = parseInt(r.rname, 10);
            } else {
                const sp = find_level(r.rname);
                lev = sp ? sp.dlevel : null;
            }
            place_it = true;   /* C: FALLTHRU into place_it */
            break;

        case LR_UPSTAIR:
        case LR_DOWNSTAIR:
            place_it = true;
            break;

        case LR_TELE:
        case LR_UPTELE:
        case LR_DOWNTELE:
            /* save the region outlines for goto_level() */
            if (r.rtype === LR_TELE || r.rtype === LR_UPTELE) {
                if (!g.updest) g.updest = {};
                g.updest.lx = r.lx; g.updest.ly = r.ly;
                g.updest.hx = r.hx; g.updest.hy = r.hy;
                g.updest.nlx = r.nlx; g.updest.nly = r.nly;
                g.updest.nhx = r.nhx; g.updest.nhy = r.nhy;
            }
            if (r.rtype === LR_TELE || r.rtype === LR_DOWNTELE) {
                if (!g.dndest) g.dndest = {};
                g.dndest.lx = r.lx; g.dndest.ly = r.ly;
                g.dndest.hx = r.hx; g.dndest.hy = r.hy;
                g.dndest.nlx = r.nlx; g.dndest.nly = r.nly;
                g.dndest.nhx = r.nhx; g.dndest.nhy = r.nhy;
            }
            /* place_lregion gets called from goto_level() */
            break;
        default:
            break;
        }
        if (place_it)
            place_lregion(r.lx, r.ly, r.hx, r.hy,
                          r.nlx, r.nly, r.nhx, r.nhy, r.rtype, lev);
        r.rname = null;   /* C free()s the name string */
    }

    /* place dungeon branch if not placed above */
    if (!added_branch && mm_Is_branchlev(g.u?.uz))
        place_lregion(0, 0, 0, 0, 0, 0, 0, 0, LR_BRANCH, null);

    /* Still need to add some stuff to level file */
    if (Is_medusa_level(g.u?.uz)) {
        let otmp;
        let tryct;

        croom = g.level?.rooms?.[0];  /* the first room defined on Medusa */
        for (tryct = rnd(4); tryct; tryct--) {           // mkmaze.c:655
            x = mm_somex(croom);
            y = mm_somey(croom);
            if (goodpos(x, y, null, 0)) {
                let tryct2 = 0;

                otmp = mm_mk_tt_object(MM_STATUE, x, y);
                while (++tryct2 < 100 && otmp
                       && (mm_poly_when_stoned(mm_monster_by_pm(otmp.corpsenm))
                           || mm_pm_resistance(mm_monster_by_pm(otmp.corpsenm),
                                               MM_MR_STONE))) {
                    /* set_corpsenm() handles weight too */
                    mm_set_corpsenm(otmp, mm_rndmonnum());
                }
            }
        }

        if (rn2(2)) {                                    // mkmaze.c:672
            otmp = mm_mk_tt_object(MM_STATUE, mm_somex(croom), mm_somey(croom));
        } else {
            /* Medusa statues don't contain books */
            otmp = mm_mkcorpstat(MM_STATUE, null, null,
                                 mm_somex(croom), mm_somey(croom),
                                 CORPSTAT_NONE);
        }
        if (otmp) {
            tryct = 0;
            while (++tryct < 100
                   && (mm_pm_resistance(mm_monster_by_pm(otmp.corpsenm),
                                        MM_MR_STONE)
                       || mm_poly_when_stoned(mm_monster_by_pm(otmp.corpsenm)))) {
                /* set_corpsenm() handles weight too */
                mm_set_corpsenm(otmp, mm_rndmonnum());
            }
        }
    } else if (mm_Role_if(MM_PM_CLERIC) && In_quest(g.u?.uz)) {
        /* less chance for undead corpses (lured from lower morgues) */
        if (g.level?.flags) g.level.flags.graveyard = 1;
    } else if (Is_stronghold(g.u?.uz)) {
        if (g.level?.flags) g.level.flags.graveyard = 1;
    } else if (mm_on_baalzebub_level(g.u?.uz)) {
        /* custom wallify the "beetle" portion of the level */
        const { baalz_fixup } = await import('./levels/baalz.js');
        baalz_fixup();
    } else if (g.u?.uz?.dnum === g.mines_dnum && gr.ransacked) {
        await stolen_booty();
    }

    const { Is_special } = await import('./dungeon.js');
    const sp = Is_special(g.u?.uz);
    if (sp && sp.flags?.town && g.level?.flags)
        g.level.flags.has_town = 1;   /* Mine Town */

    g.lregions = null;
    g.num_lregions = 0;
}

// ── the small predicates fixup_special() needs ──────────────────────────────
// Each of these HAS a faithful port elsewhere but only as a module-private; the
// file:line is named so the fix is to export the original.

// C ref: dungeon.c:1464 Is_branchlev(lev) — js/bones.js:86 has the real walk
// over the global branch chain.
function mm_Is_branchlev(lev) {
    if (!lev) return false;
    for (const br of (game.branches || []))
        if ((br.end1?.dnum === lev.dnum && br.end1?.dlevel === lev.dlevel)
            || (br.end2?.dnum === lev.dnum && br.end2?.dlevel === lev.dlevel))
            return true;
    return false;
}

// C ref: you.h Role_if(X) == (gu.urole.mnum == (X)).  js/invent.js:356,
// js/artifact.js:516 and js/do_wear.js:222 each carry a copy.
const MM_PM_CLERIC = 6;   /* roles[] mnum of Priest */
function mm_Role_if(pm) { return (game.urole?.mnum ?? game.initrole) === pm; }

// C ref: dungeon.c on_level(&u.uz, &baalzebub_level).
function mm_on_baalzebub_level(uz) {
    const bl = game.baalzebub_level;
    return !!(bl && uz && uz.dnum === bl.dnum && uz.dlevel === bl.dlevel);
}

// C ref: monst.h MR_STONE, and mondata.h pm_resistance(ptr, mask) /
// polyself.c poly_when_stoned(ptr).  js/mhitm_ad.js:157 has the real
// poly_when_stoned (S_GOLEM flesh/clay); js/makemon.js:1009 names
// pm_resistance's one-line body.
const MM_MR_STONE = 0x20;
function mm_pm_resistance(ptr, mask) { return !!((ptr?.mresists | 0) & mask); }
function mm_poly_when_stoned(ptr) {
    return ptr?.mcls === 12 /* S_GOLEM */
        && (ptr?.name === 'flesh golem' || ptr?.name === 'clay golem');
}

// C ref: makemon.c rndmonnum() — js/mkobj.js:1279 and js/mklev.js:276 both
// carry a private copy.  Deliberately NOT re-derived here: a wrong reservoir
// walk would emit the wrong number of rn2() draws.  Callers above are inert.
function mm_rndmonnum() {
    // UNPORTED (as an export): makemon.c rndmonnum().  Returning 0 keeps the
    // Medusa loops finite; they are unreachable until this is exported.
    return 0;
}

// C ref: mkmaze.c:1042 pick_vibrasquare_location() — choose where the stairs
// down to Moloch's Sanctum will be cut, on the Invocation level.  The position
// has to leave room for mkinvokearea()'s 2-cell-slop area, must not share a
// row/column/diagonal with the up stairs, and must be at least
// INVPOS_DISTANCE away from them.
//
// NOTE the loop shape: C's do/while re-rolls x,y and then tests, so the
// trycnt>1000 break happens BEFORE the reject test — i.e. the 1001st roll is
// always accepted.  js/mklev.js:4559 hf_pick_vibrasquare_location() is the live
// copy used by des.trap("vibrating square"); it returns the coords instead of
// writing svi.inv_pos, which is what this one does.
export function pick_vibrasquare_location() {
    const x_maze_min = 2, y_maze_min = 2;
    const INVPOS_X_MARGIN = (6 - 2), INVPOS_Y_MARGIN = (5 - 2);
    const INVPOS_DISTANCE = 11;
    const x_range = mz.x_maze_max - x_maze_min - 2 * INVPOS_X_MARGIN - 1;
    const y_range = mz.y_maze_max - y_maze_min - 2 * INVPOS_Y_MARGIN - 1;
    let x = 0, y = 0, trycnt = 0, stway;

    /* C debugpline2()s "maze is too small!" here; not a game message. */
    if (!game.inv_pos) game.inv_pos = { x: 0, y: 0 };
    game.inv_pos.x = game.inv_pos.y = 0;  /*{occupied() => invocation_pos()}*/
    do {
        x = mm_rn1(x_range, x_maze_min + INVPOS_X_MARGIN + 1);
        y = mm_rn1(y_range, y_maze_min + INVPOS_Y_MARGIN + 1);
        /* we don't want it to be too near the stairs, nor to be on a spot
           that's already in use (wall|trap) */
        if (++trycnt > 1000) break;
    } while ((stway = mm_stairway_find_dir(true))
             && (x === stway.sx || y === stway.sy /*(direct line)*/
                 || Math.abs(x - stway.sx) === Math.abs(y - stway.sy)
                 || mm_distmin(x, y, stway.sx, stway.sy) <= INVPOS_DISTANCE
                 || !SPACE_POS(game.level?.at(x, y)?.typ)
                 || mm_occupied(x, y)));
    game.inv_pos.x = x;
    game.inv_pos.y = y;
}

// C ref: stairs.c stairway_find_dir(up) — js/do.js:2127 has the real one
// (module-private).
function mm_stairway_find_dir(up) {
    for (const s of (game.level?.stairs || []))
        if (!s.isladder && !!s.up === !!up) return s;
    return null;
}

// C ref: mkmaze.c:1097 populate_maze() — "add objects and monsters to random
// maze".  Every count is drawn first, then one mazexy() per item; a maze
// therefore consumes a fixed 6 count-rolls plus 2 coordinate rolls per item.
export async function populate_maze() {
    let i;
    let mm;

    for (i = mm_rn1(8, 11); i; i--) {                    // mkmaze.c:1102
        mm = mazexy();
        mm_mkobj_at(rn2(2) ? MM_GEM_CLASS : MM_RANDOM_CLASS, mm.x, mm.y, true);
    }
    for (i = mm_rn1(10, 2); i; i--) {                    // mkmaze.c:1106
        mm = mazexy();
        mm_mksobj_at(MM_BOULDER, mm.x, mm.y, true, false);
    }
    for (i = rn2(3); i; i--) {                           // mkmaze.c:1110
        mm = mazexy();
        mm_makemon(mm_monster_by_pm(MM_PM_MINOTAUR), mm.x, mm.y, NO_MM_FLAGS);
    }
    for (i = mm_rn1(5, 7); i; i--) {                     // mkmaze.c:1114
        mm = mazexy();
        mm_makemon(null, mm.x, mm.y, NO_MM_FLAGS);
    }
    for (i = mm_rn1(6, 7); i; i--) {                     // mkmaze.c:1118
        mm = mazexy();
        mm_mkgold(0, mm.x, mm.y);
    }
    for (i = mm_rn1(6, 7); i; i--)                       // mkmaze.c:1122
        await mm_mktrap_mazeflag();
}

// C ref: mklev.c:2036 mktrap(0, MKTRAP_MAZEFLAG, (struct mkroom *) 0,
// (coord *) 0) — the exact form populate_maze() uses, with num==0 and no room
// and no coord, so the type comes from the traptype_rnd() retry loop and the
// position from mazexy().  mklev.c mktrap() itself is not exported (js/mklev.js
// has mktrap_room()/mktrap_random_kind()/mktrap_victim() as privates), so this
// spells out only that one argument combination.
async function mm_mktrap_mazeflag() {
    const { splev_traptype_rnd } = await import('./sp_lev.js');
    let kind;

    /* C: `unsigned lvl = level_difficulty();` is read for the victim gate at
       the bottom of mktrap(), which needs mktrap_victim() (js/mklev.js:6303,
       private).  Neither the Rogue-level nor the Gehennom fire-trap bias arm
       applies on a plain random maze. */
    do {
        kind = splev_traptype_rnd(MKTRAP_MAZEFLAG);
    } while (kind === NO_TRAP);

    if (is_hole(kind) && !mm_Can_fall_thru(game.u?.uz)) kind = ROCKTRAP;

    let m;
    {
        let tryct = 0;
        const avoid_boulder = (is_pit(kind) || is_hole(kind));
        do {
            if (++tryct > 200) return;
            m = mazexy();
        } while (mm_occupied(m.x, m.y)
                 || (avoid_boulder && mm_sobj_at_boulder(m.x, m.y)));
    }

    const t = await maketrap(m.x, m.y, kind);
    kind = t ? t.ttyp : NO_TRAP;
    void kind; void MKTRAP_SEEN; void TRAPNUM;
    // UNPORTED: mklev.c mktrap()'s tail — the WEB giant spider, the
    // MKTRAP_SEEN tseen flag and mktrap_victim() (js/mklev.js:6303, private).
    // populate_maze() passes neither MKTRAP_SEEN nor MKTRAP_NOSPIDERONWEB, so
    // both of the first two are live in C.
}

// C ref: dungeon.c Can_fall_thru(lev) — js/trap.js exports it, but under a name
// this file's existing trap.js import does not list.
function mm_Can_fall_thru(uz) {
    const g = game;
    if (!uz) return false;
    if (Is_stronghold(uz)) return true;
    const dgn = g.dungeons?.[uz.dnum];
    return !!dgn && uz.dlevel < (dgn.num_dunlevs ?? 1);
}

// C ref: invent.c sobj_at(BOULDER, x, y) — js/mklev.js:6371 has a copy.
function mm_sobj_at_boulder(x, y) {
    for (const o of (game.level?.objects || []))
        if (o.where === 'floor' && o.ox === x && o.oy === y
            && o.otyp === MM_BOULDER) return true;
    return false;
}

// C ref: mkmaze.c:1127 makemaz(s) — the entry point mklev() uses for every
// level that is not built out of rooms.  Resolves the proto-level name (an
// explicit `s`, else the dungeon's own `proto` plus the dlevel, plus a
// `-<n>` variant when the s_level has rndlevs), loads it, and only if there is
// no proto at all carves a raw maze.
//
// The raw-maze arm's draw order is exact and drives every "mazelevel" seed:
// corrmaze !rn2(3), then (off the Invocation level) rn2(2) picking between the
// wide create_maze(-1,-1,!rn2(5)) and the plain create_maze(1,1,FALSE), then
// the up-stairs mazexy(), then either the down-stairs mazexy() or
// pick_vibrasquare_location(), then place_branch(), then populate_maze().
export async function makemaz(s) {
    const g = game;
    const { load_special } = await import('./sp_lev.js');
    const { wallification } = await import('./mklev.js');
    const { dunlevs_in_dungeon, Is_special } = await import('./dungeon.js');
    const sp = Is_special(g.u?.uz);
    let protofile;
    let mm;

    if (s && s.length) {
        if (sp && sp.rndlevs) protofile = `${s}-${rnd(sp.rndlevs)}`;
        else protofile = s;
    } else if (g.dungeons?.[g.u?.uz?.dnum]?.proto) {
        const proto = g.dungeons[g.u.uz.dnum].proto;
        if (dunlevs_in_dungeon(g.u.uz) > 1) {
            if (sp && sp.rndlevs)
                protofile = `${proto}${g.u.uz.dlevel}-${rnd(sp.rndlevs)}`;
            else
                protofile = `${proto}${g.u.uz.dlevel}`;
        } else if (sp && sp.rndlevs) {
            protofile = `${proto}-${rnd(sp.rndlevs)}`;
        } else {
            protofile = proto;
        }
    } else {
        protofile = '';
    }

    // C's wizard-mode SPLEVTYPE override reads getenv("SPLEVTYPE") to pin which
    // rndlevs variant loads.  Not ported: a recording-environment literal has
    // no place in port logic, and it is wizard-only.

    if (protofile) {
        check_ransacked(protofile);
        protofile += '.lua';   /* LEV_EXT */
        g.in_mk_themerooms = false;
        if (await load_special(protofile)) {
            /* some levels can end up with monsters on dead mon list,
               including light source monsters */
            const { dmonsfree } = await import('./mon.js');
            await dmonsfree();
            return; /* no mazification right now */
        }
        /* C: impossible("Couldn't load \"%s\" - making a maze.", protofile) */
    }

    if (g.level?.flags) {
        g.level.flags.is_maze_lev = 1;
        g.level.flags.corrmaze = !rn2(3);                // mkmaze.c:1218
    }

    if (!Invocation_lev(g.u?.uz) && rn2(2)) {            // mkmaze.c:1220
        create_maze(-1, -1, !rn2(5));
    } else {
        create_maze(1, 1, false);
    }

    if (!g.level?.flags?.corrmaze)
        wallification(2, 2, mz.x_maze_max, mz.y_maze_max);

    mm = mazexy();
    mm_mkstairs(mm.x, mm.y, 1, null, false); /* up */
    if (!Invocation_lev(g.u?.uz)) {
        mm = mazexy();
        mm_mkstairs(mm.x, mm.y, 0, null, false); /* down */
    } else { /* choose "vibrating square" location */
        pick_vibrasquare_location();
        await maketrap(g.inv_pos.x, g.inv_pos.y, VIBRATING_SQUARE);
    }

    /* place branch stair or portal */
    await mm_place_branch(mm_Is_branchlev(g.u?.uz), 0, 0);

    await populate_maze();
}

// C ref: mklev.c mkstairs(x, y, up, croom, force) — js/mklev.js:2755 has the
// real one (module-private, and its signature drops `force`).
function mm_mkstairs(x, y, up, croom, force) {
    void croom; void force;
    const g = game;
    if (!g.level) return;
    if (!g.level.stairs) g.level.stairs = [];
    g.level.stairs.push({ sx: x, sy: y, up: !!up, isladder: false });
    const loc = g.level.at(x, y);
    if (loc) loc.typ = 24;  /* STAIRS */
}

// C ref: mklev.c place_branch(br, x, y) — js/mklev.js:6110 has the real one
// (module-private).  Reached lazily so mkmaze.js stays out of mklev's cycle.
async function mm_place_branch(br, x, y) {
    void br; void x; void y;
    // UNPORTED (as an export): mklev.c place_branch().  js/mklev.js:6110 is the
    // faithful port; exporting it is the fix.
}

// C ref: mkmaze.c:1316 mazexy(cc) — "find random point in generated corridors,
// so we don't create items in moats, bunkers, or walls".  100 rnd()-pairs, then
// a deterministic scan.  NOTE both coordinate draws happen on EVERY attempt,
// including the ones that are rejected, so a maze whose corridors are sparse
// eats a lot of stream here.
export function mazexy() {
    const allowedtyp = game.level?.flags?.corrmaze ? CORR : ROOM;
    let cpt = 0;
    let x, y;

    do {
        /* once upon a time this only considered odd values greater than 2 and
           less than N (for N=={x,y}_maze_max) because even values were where
           maze walls always got placed; when wider maze corridors were
           introduced it was changed to 1+rn2(N) which is just an obscure way
           to get rnd(N) */
        x = rnd(mz.x_maze_max);
        y = rnd(mz.y_maze_max);
        if (game.level?.at(x, y)?.typ === allowedtyp)
            return { x, y };
    } while (++cpt < 100);

    /* 100 random attempts failed; systematically try every possibility */
    for (x = 1; x <= mz.x_maze_max; x++)
        for (y = 1; y <= mz.y_maze_max; y++)
            if (game.level?.at(x, y)?.typ === allowedtyp)
                return { x, y };

    /* C: panic("mazexy: can't find a place!") */
    return { x: 0, y: 0 };
}

// C ref: mkmaze.c:1723 save_waterlevel(nhfp) — the bubble/cloud chain rides in
// the LEVEL file, so a revisit to the Plane of Water gets the same bubbles (and
// the same svx/svy box) back.  Follows this port's save convention (js/save.js,
// js/dungeon.js:2010): `nhfp` is the save-mode int and the written stream is
// the returned object.
export function save_waterlevel(nhfp) {
    const list = bubble_list();
    let out = null;

    if (!list.length) return null;   /* C: `if (!svb.bbubbles) return;` */

    if (update_file_mode(nhfp)) {
        out = {};
        let n = 0;
        for (const _b of list) { void _b; ++n; }
        out.bubble_count = n;
        out.xmin = wl.xmin;
        out.ymin = wl.ymin;
        out.xmax = wl.xmax;
        out.ymax = wl.ymax;
        out.bubbles = [];
        for (const b of list)
            /* C ref: sfbase.c Sfo_bubble() — x, y, dx, dy and the bmask
               bytes.  b->cons is NOT written: movebubbles() empties it on
               every pass, so it is always Null at save time. */
            out.bubbles.push({ x: b.x, y: b.y, dx: b.dx, dy: b.dy,
                               bm: [...b.bm] });
    }
    if (release_data_mode(nhfp))
        unsetup_waterlevel();
    return out;
}

// C ref: mkmaze.c:1750 restore_waterlevel(nhfp) — "restoring air bubbles on
// Plane of Water or clouds on Plane of Air".  Every restored bubble is passed
// through mv_bubble(b, 0, 0, TRUE), which re-paints its cells; the ini=TRUE
// flag is what keeps that pass from drawing the "alter direction for fun"
// rn2(20)/rn2(5).
export function restore_waterlevel(nhfp) {
    const lev = game.level;
    if (!lev) return;
    lev.bubbles = [];

    const n = nhfp?.bubble_count | 0;
    wl.xmin = nhfp?.xmin ?? wl.xmin;
    wl.ymin = nhfp?.ymin ?? wl.ymin;
    wl.xmax = nhfp?.xmax ?? wl.xmax;
    wl.ymax = nhfp?.ymax ?? wl.ymax;

    let b = null;
    for (let i = 0; i < n; i++) {
        const src = nhfp.bubbles?.[i] || {};
        b = { x: src.x | 0, y: src.y | 0, dx: src.dx | 0, dy: src.dy | 0,
              bm: [...(src.bm || [2, 1, 0x3])], cons: [] };
        lev.bubbles.push(b);
        mv_bubble_restore(b);
    }
    if (!b) {
        /* C clears program_state.something_worth_saving around an
           impossible("No air bubbles or clouds to restore?"). */
    }
}

// C ref: mkmaze.c:1949 mv_bubble(b, 0, 0, TRUE) as called from
// restore_waterlevel().  With ini=TRUE and both deltas zero, every arm of
// mv_bubble() except the "draw the bubbles" loop is a no-op: the collision
// clamps cannot fire on a bubble that is already inside the box, the
// replace-contents pass sees an empty b->cons, and the colli==0 default arm's
// rn2(20)/rn2(5) is gated off by `!ini`.  So this is that loop, and nothing
// here draws RNG.  (The private mv_bubble() above is left untouched.)
function mv_bubble_restore(b) {
    const water = !!Is_waterlevel(game.u?.uz);
    const air = !!Is_airlevel(game.u?.uz);
    for (let i = 0, x = b.x; i < b.bm[0]; i++, x++)
        for (let j = 0, y = b.y; j < b.bm[1]; j++, y++)
            if (b.bm[j + 2] & (1 << i)) {
                const loc = game.level?.at(x, y);
                if (!loc) continue;
                if (water) { loc.typ = AIR; loc.lit = true; unblock_point(x, y); }
                else if (air) { loc.typ = CLOUD; loc.lit = true; block_point(x, y); }
            }
}

// C ref: hack.h:971/972 update_file(nhfp) / release_data(nhfp).  js/save.js
// exports both, but importing it here would put save.js in mkmaze's static
// graph; the two masks are const.js values.
function update_file_mode(mode) {
    return ((mode | 0) & (MM_COUNTING | MM_WRITING)) !== 0;
}
function release_data_mode(mode) { return ((mode | 0) & MM_FREEING) !== 0; }
