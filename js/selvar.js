// selvar.js — the special-level "selection" (set-of-map-cells) engine.
// C ref: src/selvar.c plus the Lua-binding argument handling in src/nhlsel.c.
//
// A selection is a COLNO x ROWNO bitmap with a cached bounding rectangle.  The
// bounds cache is NOT just an optimisation: several operations
// (selection_filter_percent, selection_rndcoord, selection_iterate,
// selection_numpoints) only scan inside the cached bounds, so the cache's exact
// staleness rules decide how many rn2() calls a filter draws.  They are
// reproduced here verbatim.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { COLNO, ROWNO, MAX_TYPE, MATCH_WALL, IS_STWALL, isok,
         ROOMOFFSET } from './const.js';
// Used only by the selvar.c block at the bottom of this file (line_dist_coord).
import { dist2 } from './hacklib.js';

// C ref: sp_lev.h — direction bitmask used by selection_do_grow / mazewalk.
export const W_RANDOM = -1;
export const W_NORTH = 1;
export const W_SOUTH = 2;
export const W_EAST = 4;
export const W_WEST = 8;
export const W_ANY = W_NORTH | W_SOUTH | W_EAST | W_WEST;

// C ref: sp_lev.c random_wdir() — one rn2(4) over {N,S,E,W} in that order.
export function random_wdir() {
    const wdirs = [W_NORTH, W_SOUTH, W_EAST, W_WEST];
    return wdirs[rn2(4)];
}

// C ref: sp_lev.c match_maptyps() — 'w' (MATCH_WALL) matches any IS_STWALL
// cell; MAX_TYPE ('x', "see-through") matches anything; otherwise exact typ.
export function match_maptyps(typ, levltyp) {
    if (typ === MATCH_WALL && !IS_STWALL(levltyp)) return false;
    if (typ < MAX_TYPE && typ !== levltyp) return false;
    return true;
}

// C ref: struct selectionvar.  map[] stores (value + 1), so a freshly
// allocated (memset 1) selection reads back as all-zero/empty.
export class Selection {
    constructor() {
        this.wid = COLNO;
        this.hei = ROWNO;
        this.map = new Uint8Array(COLNO * ROWNO).fill(1);
        this.bounds = { lx: COLNO, ly: ROWNO, hx: 0, hy: 0 };
        this.bounds_dirty = false;
    }
}

export function selection_new() {
    return new Selection();
}

export function selection_clone(sel) {
    const t = new Selection();
    t.wid = sel.wid;
    t.hei = sel.hei;
    t.bounds = { ...sel.bounds };
    t.bounds_dirty = sel.bounds_dirty;
    t.map = Uint8Array.from(sel.map);
    return t;
}

// C ref: selvar.c selection_clear() — memset(1 + val); bounds go full-map for
// val != 0 and "empty" for val == 0.
export function selection_clear(sel, val) {
    sel.map.fill(1 + (val ? 1 : 0));
    if (val) {
        sel.bounds = { lx: 0, ly: 0, hx: COLNO - 1, hy: ROWNO - 1 };
    } else {
        sel.bounds = { lx: COLNO, ly: ROWNO, hx: 0, hy: 0 };
    }
    sel.bounds_dirty = false;
    return sel;
}

export function selection_getpoint(x, y, sel) {
    if (!sel || !sel.map) return 0;
    if (x < 0 || y < 0 || x >= sel.wid || y >= sel.hei) return 0;
    return sel.map[sel.wid * y + x] - 1;
}

// C ref: selvar.c selection_setpoint().  Setting a point grows the cached
// bounds only while the cache is still clean; ANY other write dirties it
// (map[] never holds 0, so C's `map[i] != 0` test is always true there).
export function selection_setpoint(x, y, sel, c) {
    if (!sel || !sel.map) return;
    if (x < 0 || y < 0 || x >= sel.wid || y >= sel.hei) return;
    const v = c ? 1 : 0;
    if (v && !sel.bounds_dirty) {
        if (sel.bounds.lx > x) sel.bounds.lx = x;
        if (sel.bounds.ly > y) sel.bounds.ly = y;
        if (sel.bounds.hx < x) sel.bounds.hx = x;
        if (sel.bounds.hy < y) sel.bounds.hy = y;
    } else {
        sel.bounds_dirty = true;
    }
    sel.map[sel.wid * y + x] = v + 1;
}

// C ref: selvar.c selection_recalc_bounds().  Note the C quirk faithfully kept
// here: for a selection that turned out to be EMPTY, `sel->bounds = r` is
// inside the `if (r.lx > -1)` guard, so bounds are left at the sentinel
// {COLNO, ROWNO, 0, 0} — which selection_getbounds() then reports as the WHOLE
// map, not as an empty rect.
export function selection_recalc_bounds(sel) {
    if (!sel.bounds_dirty) return;

    sel.bounds = { lx: COLNO, ly: ROWNO, hx: 0, hy: 0 };
    const r = { lx: -1, ly: -1, hx: -1, hy: -1 };

    for (let x = 0; x < sel.wid; x++) {
        for (let y = 0; y < sel.hei; y++)
            if (selection_getpoint(x, y, sel)) { r.lx = x; break; }
        if (r.lx > -1) break;
    }

    if (r.lx > -1) {
        for (let x = sel.wid - 1; x >= r.lx; x--) {
            for (let y = 0; y < sel.hei; y++)
                if (selection_getpoint(x, y, sel)) { r.hx = x; break; }
            if (r.hx > -1) break;
        }
        for (let y = 0; y < sel.hei; y++) {
            for (let x = r.lx; x <= r.hx; x++)
                if (selection_getpoint(x, y, sel)) { r.ly = y; break; }
            if (r.ly > -1) break;
        }
        for (let y = sel.hei - 1; y >= r.ly; y--) {
            for (let x = r.lx; x <= r.hx; x++)
                if (selection_getpoint(x, y, sel)) { r.hy = y; break; }
            if (r.hy > -1) break;
        }
        sel.bounds = r;
    }

    sel.bounds_dirty = false;
}

// C ref: selvar.c selection_getbounds() — the "no bounds recorded" sentinel
// (lx >= wid) means "whole map".
export function selection_getbounds(sel) {
    if (!sel) return { lx: 0, ly: 0, hx: COLNO - 1, hy: ROWNO - 1 };
    selection_recalc_bounds(sel);
    if (sel.bounds.lx >= sel.wid)
        return { lx: 0, ly: 0, hx: COLNO - 1, hy: ROWNO - 1 };
    return { ...sel.bounds };
}

// C ref: rect.c rect_bounds() — used by the &/|/~/- operators, which read the
// RAW ->bounds field (no recalc) and take their union.
function rect_bounds(r1, r2) {
    return {
        lx: Math.min(r1.lx, r2.lx),
        ly: Math.min(r1.ly, r2.ly),
        hx: Math.max(r1.hx, r2.hx),
        hy: Math.max(r1.hy, r2.hy),
    };
}

// C ref: selvar.c selection_not() — in-place negate.
export function selection_not(s) {
    for (let x = 0; x < s.wid; x++)
        for (let y = 0; y < s.hei; y++)
            selection_setpoint(x, y, s, selection_getpoint(x, y, s) ? 0 : 1);
    selection_getbounds(s);
    return s;
}

// C ref: nhlsel.c l_selection_not() — `selection.negate()` with no argument is
// a brand-new all-set selection; `sel:negate()` clones then negates.
export function l_selection_negate(sel) {
    if (!sel) return selection_clear(selection_new(), 1);
    return selection_not(selection_clone(sel));
}

// C ref: nhlsel.c l_selection_and().
export function l_selection_and(sela, selb) {
    const selr = selection_new();
    const rect = rect_bounds(sela.bounds, selb.bounds);
    for (let x = rect.lx; x <= rect.hx; x++)
        for (let y = rect.ly; y <= rect.hy; y++)
            selection_setpoint(x, y, selr,
                selection_getpoint(x, y, sela) & selection_getpoint(x, y, selb));
    return selr;
}

// C ref: nhlsel.c l_selection_or() — note it force-assigns the union rect as
// the result's bounds afterwards (no recalc).
export function l_selection_or(sela, selb) {
    const selr = selection_new();
    const rect = rect_bounds(sela.bounds, selb.bounds);
    for (let x = rect.lx; x <= rect.hx; x++)
        for (let y = rect.ly; y <= rect.hy; y++)
            selection_setpoint(x, y, selr,
                selection_getpoint(x, y, sela) | selection_getpoint(x, y, selb));
    selr.bounds = { ...rect };
    selr.bounds_dirty = false;
    return selr;
}

// C ref: selvar.c selection_filter_percent() — ONE rn2(100) per set point
// inside the current bounds.
export function selection_filter_percent(ov, percent) {
    if (!ov) return null;
    const ret = selection_new();
    const rect = selection_getbounds(ov);
    for (let x = rect.lx; x <= rect.hx; x++)
        for (let y = rect.ly; y <= rect.hy; y++)
            if (selection_getpoint(x, y, ov) && rn2(100) < percent)
                selection_setpoint(x, y, ret, 1);
    return ret;
}

// C ref: selvar.c selection_filter_mapchar().  lit == -2 (the Lua default)
// accepts unconditionally; lit == -1 draws rn2(2) per matching cell.
export function selection_filter_mapchar(ov, typ, lit = -2) {
    if (!ov) return null;
    const ret = selection_new();
    const rect = selection_getbounds(ov);
    for (let x = rect.lx; x <= rect.hx; x++)
        for (let y = rect.ly; y <= rect.hy; y++) {
            if (!selection_getpoint(x, y, ov)) continue;
            const loc = game.level?.at(x, y);
            if (!loc || !match_maptyps(typ, loc.typ)) continue;
            if (lit === -1) selection_setpoint(x, y, ret, rn2(2));
            else if (lit === 0 || lit === 1) {
                if ((loc.lit ? 1 : 0) === lit) selection_setpoint(x, y, ret, 1);
            } else selection_setpoint(x, y, ret, 1);
        }
    return ret;
}

// C ref: selvar.c selection_rndcoord() — count set points in bounds, rn2(idx),
// then walk to the idx'th one in the same column-major order.
export function selection_rndcoord(ov, removeit = false) {
    const rect = selection_getbounds(ov);
    let idx = 0;
    for (let dx = rect.lx; dx <= rect.hx; dx++)
        for (let dy = rect.ly; dy <= rect.hy; dy++)
            if (selection_getpoint(dx, dy, ov)) idx++;
    if (idx) {
        let c = rn2(idx);
        for (let dx = rect.lx; dx <= rect.hx; dx++)
            for (let dy = rect.ly; dy <= rect.hy; dy++)
                if (selection_getpoint(dx, dy, ov)) {
                    if (!c) {
                        if (removeit) selection_setpoint(dx, dy, ov, 0);
                        return { x: dx, y: dy };
                    }
                    c--;
                }
    }
    return { x: -1, y: -1 };
}

// C ref: selvar.c selection_do_grow() — dilation.  W_RANDOM draws one rn2(4);
// every other direction mask is deterministic.  Diagonal growth only happens
// when both adjacent orthogonals are in the mask.
export function selection_do_grow(ov, dir = W_ANY) {
    if (!ov) return ov;
    const tmp = selection_new();
    if (dir === W_RANDOM) dir = random_wdir();

    let rect = selection_getbounds(ov);
    const x0 = Math.max(0, rect.lx - 1), x1 = Math.min(COLNO - 1, rect.hx + 1);
    const y0 = Math.max(0, rect.ly - 1), y1 = Math.min(ROWNO - 1, rect.hy + 1);
    const NW = W_WEST | W_NORTH, NE = W_NORTH | W_EAST;
    const ES = W_EAST | W_SOUTH, SW = W_SOUTH | W_WEST;
    for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
            if (((dir & W_WEST) && selection_getpoint(x + 1, y, ov))
                || ((dir & NW) === NW && selection_getpoint(x + 1, y + 1, ov))
                || ((dir & W_NORTH) && selection_getpoint(x, y + 1, ov))
                || ((dir & NE) === NE && selection_getpoint(x - 1, y + 1, ov))
                || ((dir & W_EAST) && selection_getpoint(x - 1, y, ov))
                || ((dir & ES) === ES && selection_getpoint(x - 1, y - 1, ov))
                || ((dir & W_SOUTH) && selection_getpoint(x, y - 1, ov))
                || ((dir & SW) === SW && selection_getpoint(x + 1, y - 1, ov)))
                selection_setpoint(x, y, tmp, 1);
        }

    rect = selection_getbounds(tmp);
    for (let x = rect.lx; x <= rect.hx; x++)
        for (let y = rect.ly; y <= rect.hy; y++)
            if (selection_getpoint(x, y, tmp)) selection_setpoint(x, y, ov, 1);
    return ov;
}

// C ref: nhlsel.c l_selection_grow() — clones first, so the source is untouched.
export function l_selection_grow(sel, dir = W_ANY) {
    return selection_do_grow(selection_clone(sel), dir);
}

// C ref: selvar.c selection_do_line() — Bresenham; no RNG.
export function selection_do_line(x1, y1, x2, y2, ov) {
    let xi, yi, dx, dy;
    if (x1 < x2) { xi = 1; dx = x2 - x1; } else { xi = -1; dx = x1 - x2; }
    if (y1 < y2) { yi = 1; dy = y2 - y1; } else { yi = -1; dy = y1 - y2; }

    selection_setpoint(x1, y1, ov, 1);

    if (!dx && !dy) return;
    if (dx > dy) {
        const ai = (dy - dx) * 2, bi = dy * 2;
        let d0 = bi - dx;
        do {
            if (d0 >= 0) { y1 += yi; d0 += ai; } else d0 += bi;
            x1 += xi;
            selection_setpoint(x1, y1, ov, 1);
        } while (x1 !== x2);
    } else {
        const ai = (dx - dy) * 2, bi = dx * 2;
        let d0 = bi - dy;
        do {
            if (d0 >= 0) { x1 += xi; d0 += ai; } else d0 += bi;
            y1 += yi;
            selection_setpoint(x1, y1, ov, 1);
        } while (y1 !== y2);
    }
}

// C ref: selvar.c selection_do_randline() — midpoint displacement.  Draws a
// rejection-looped rn2(rough) pair per recursion level while rough >= 2.
export function selection_do_randline(x1, y1, x2, y2, rough, rec, ov) {
    if (rec < 1 || (x2 === x1 && y2 === y1)) return;

    const span = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    if (rough > span) rough = span;

    let mx, my;
    if (rough < 2) {
        mx = Math.trunc((x1 + x2) / 2);
        my = Math.trunc((y1 + y2) / 2);
    } else {
        do {
            const dx = rn2(rough) - Math.trunc(rough / 2);
            const dy = rn2(rough) - Math.trunc(rough / 2);
            mx = Math.trunc((x1 + x2) / 2) + dx;
            my = Math.trunc((y1 + y2) / 2) + dy;
        } while (mx > COLNO - 1 || mx < 0 || my < 0 || my > ROWNO - 1);
    }

    if (!selection_getpoint(mx, my, ov)) selection_setpoint(mx, my, ov, 1);

    rough = Math.trunc((rough * 2) / 3);
    rec--;

    selection_do_randline(x1, y1, mx, my, rough, rec, ov);
    selection_do_randline(mx, my, x2, y2, rough, rec, ov);

    selection_setpoint(x2, y2, ov, 1);
}

// C ref: nhlsel.c l_selection_randline() — clones, then rec = 12.
export function l_selection_randline(sel, x1, y1, x2, y2, roughness) {
    const out = selection_clone(sel);
    selection_do_randline(x1, y1, x2, y2, roughness, 12, out);
    return out;
}

// C ref: selvar.c selection_iterate() — column-major over the bounds.
export function selection_iterate(ov, fn) {
    if (!ov) return;
    const rect = selection_getbounds(ov);
    for (let x = rect.lx; x <= rect.hx; x++)
        for (let y = rect.ly; y <= rect.hy; y++)
            if (isok(x, y) && selection_getpoint(x, y, ov)) fn(x, y);
}

// C ref: nhlsel.c l_selection_iterate() — the LUA-facing iterate, which differs
// from selvar.c's internal selection_iterate() above in two ways that matter:
// it walks y-outer / x-inner (starting at max(1, lx)), and it runs each point
// through cvt_to_relcoord() before handing it to the callback, so a des.* call
// inside the callback re-adds the map origin and lands on the original square.
// `origin` is {xstart, ystart}; the callback receives MAP-RELATIVE coords.
export function l_selection_iterate(ov, origin, fn) {
    if (!ov) return;
    const rect = selection_getbounds(ov);
    for (let y = rect.ly; y <= rect.hy; y++)
        for (let x = Math.max(1, rect.lx); x <= rect.hx; x++)
            if (selection_getpoint(x, y, ov))
                fn(x - origin.xstart, y - origin.ystart);
}

// C ref: nhlsel.c l_selection_numpoints().
export function selection_numpoints(sel) {
    let ret = 0;
    const rect = selection_getbounds(sel);
    for (let x = rect.lx; x <= rect.hx; x++)
        for (let y = rect.ly; y <= rect.hy; y++)
            if (selection_getpoint(x, y, sel)) ret++;
    return ret;
}

// C ref: nhlsel.c l_selection_fillrect() / selection.area().
export function l_selection_fillrect(sel, x1, y1, x2, y2) {
    const out = sel ? selection_clone(sel) : selection_new();
    if (x1 === x2) {
        for (let y = y1; y <= y2; y++) selection_setpoint(x1, y, out, 1);
    } else {
        for (let y = y1; y <= y2; y++) selection_do_line(x1, y, x2, y, out);
    }
    return out;
}

// C ref: nhlsel.c l_selection_line() / selection.line() — a single Bresenham
// line added to (a clone of) `sel`.  No RNG.
export function l_selection_line(sel, x1, y1, x2, y2) {
    const out = sel ? selection_clone(sel) : selection_new();
    selection_do_line(x1, y1, x2, y2, out);
    return out;
}

// C ref: nhlsel.c l_selection_rect() — the four edges only, not a filled area.
export function l_selection_rect(sel, x1, y1, x2, y2) {
    const out = sel ? selection_clone(sel) : selection_new();
    selection_do_line(x1, y1, x2, y1, out);
    selection_do_line(x1, y1, x1, y2, out);
    selection_do_line(x2, y1, x2, y2, out);
    selection_do_line(x1, y2, x2, y2, out);
    return out;
}

// ===========================================================================
// selvar.c functions with no caller in js/ yet.  Nothing above this line calls
// into this block: it is additive only.  nhlsel.c/nhlobj.c are somebody else's
// file, so nothing here registers itself into a Lua binding table.
// ===========================================================================

// C ref: sp_lev.h:63/64.
export const SEL_GRADIENT_RADIAL = 0;
export const SEL_GRADIENT_SQUARE = 1;

// C ref: selvar.c:33 selection_free(sel, freesel).  JS is garbage-collected, so
// the free()s are no-ops; the OBSERVABLE half is the `else` branch, which
// memsets the struct to zero — wid/hei become 0, so every subsequent
// selection_getpoint()/setpoint() on that struct is a no-op and getbounds()
// reports the whole map (lx >= wid).  Callers that reuse a selection after
// freeing it depend on exactly that.
export function selection_free(sel, freesel) {
    if (sel) {
        sel.map = null;
        if (freesel) {
            /* C free()s the struct; nothing to do here. */
        } else {
            sel.wid = 0;
            sel.hei = 0;
            sel.bounds = { lx: 0, ly: 0, hx: 0, hy: 0 };
            sel.bounds_dirty = false;
        }
    }
}

// C ref: selvar.c:369 the file-static selection_flood_check_func.
let selection_flood_check_func = null;

// C ref: selvar.c:372 set_selection_floodfillchk(f).
export function set_selection_floodfillchk(f) {
    selection_flood_check_func = f;
}

// C ref: selvar.c:379 sel_flood_havepoint(x, y, xs, ys, n) — "check whether
// <x,y> is already in xs[],ys[]".  Walks the pending stack BACKWARDS from n-1;
// the order is irrelevant to the answer but the linear scan is what bounds the
// flood's cost, so it is kept as-is rather than replaced with a Set.
function sel_flood_havepoint(x, y, xs, ys, n) {
    const xx = x, yy = y;

    while (n > 0) {
        --n;
        if (xs[n] === xx && ys[n] === yy)
            return true;
    }
    return false;
}

// C ref: selvar.c:395 selection_floodfill(ov, x, y, diagonals).
// No RNG, but the ORDER the four (or eight) neighbours are pushed decides the
// order cells are visited, which is visible through any callback the caller
// hangs off set_selection_floodfillchk().  C pushes +x, -x, +y, -y (then the
// four diagonals) and pops from the TOP, so the last one pushed is explored
// first.  `tmp` is the visited set; `ov` accumulates the result.
export function selection_floodfill(ov, x, y, diagonals) {
    const tmp = selection_new();
    const SEL_FLOOD_STACK = COLNO * ROWNO;
    let idx = 0;
    const dx = new Int16Array(SEL_FLOOD_STACK);
    const dy = new Int16Array(SEL_FLOOD_STACK);

    const SEL_FLOOD = (nx, ny) => {
        if (idx < SEL_FLOOD_STACK) {
            dx[idx] = nx;
            dy[idx] = ny;
            idx++;
        } else {
            throw new Error('floodfill stack overrun');   /* C: panic() */
        }
    };
    const SEL_FLOOD_CHKDIR = (mx, my, sel) => {
        if (isok(mx, my)
            && selection_flood_check_func(mx, my)
            && !selection_getpoint(mx, my, sel)
            && !sel_flood_havepoint(mx, my, dx, dy, idx))
            SEL_FLOOD(mx, my);
    };

    if (selection_flood_check_func === null) {
        selection_free(tmp, true);
        return;
    }
    SEL_FLOOD(x, y);
    do {
        idx--;
        x = dx[idx];
        y = dy[idx];
        if (isok(x, y)) {
            selection_setpoint(x, y, ov, 1);
            selection_setpoint(x, y, tmp, 1);
        }
        SEL_FLOOD_CHKDIR(x + 1, y, tmp);
        SEL_FLOOD_CHKDIR(x - 1, y, tmp);
        SEL_FLOOD_CHKDIR(x, y + 1, tmp);
        SEL_FLOOD_CHKDIR(x, y - 1, tmp);
        if (diagonals) {
            SEL_FLOOD_CHKDIR(x + 1, y + 1, tmp);
            SEL_FLOOD_CHKDIR(x - 1, y - 1, tmp);
            SEL_FLOOD_CHKDIR(x - 1, y + 1, tmp);
            SEL_FLOOD_CHKDIR(x + 1, y - 1, tmp);
        }
    } while (idx > 0);
    selection_free(tmp, true);
}

// C ref: selvar.c:456 selection_do_ellipse() — McIlroy's Ellipse Algorithm,
// e(x,y) = b^2*x^2 + a^2*y^2 - a^2*b^2.  No RNG.  Note C's `filled = !filled`
// inversion up front: the `!filled` branch below draws the OUTLINE.
// The integer division and `%` are C semantics (a, b are non-negative here, so
// Math.trunc matches).
export function selection_do_ellipse(ov, xc, yc, a, b, filled) {
    let x = 0, y = b;
    const a2 = a * a, b2 = b * b;
    const crit1 = -(Math.trunc(a2 / 4) + (a % 2) + b2);
    const crit2 = -(Math.trunc(b2 / 4) + (b % 2) + a2);
    const crit3 = -(Math.trunc(b2 / 4) + (b % 2));
    let t = -a2 * y; /* e(x+1/2,y-1/2) - (a^2+b^2)/4 */
    let dxt = 2 * b2 * x, dyt = -2 * a2 * y;
    const d2xt = 2 * b2, d2yt = 2 * a2;
    let width = 1;
    let i;

    if (!ov)
        return;

    filled = !filled;

    if (!filled) {
        while (y >= 0 && x <= a) {
            selection_setpoint(xc + x, yc + y, ov, 1);
            if (x !== 0 || y !== 0)
                selection_setpoint(xc - x, yc - y, ov, 1);
            if (x !== 0 && y !== 0) {
                selection_setpoint(xc + x, yc - y, ov, 1);
                selection_setpoint(xc - x, yc + y, ov, 1);
            }
            if (t + b2 * x <= crit1       /* e(x+1,y-1/2) <= 0 */
                || t + a2 * y <= crit3) { /* e(x+1/2,y) <= 0 */
                x++;
                dxt += d2xt;
                t += dxt;
            } else if (t - a2 * y > crit2) { /* e(x+1/2,y-1) > 0 */
                y--;
                dyt += d2yt;
                t += dyt;
            } else {
                x++;
                dxt += d2xt;
                t += dxt;
                y--;
                dyt += d2yt;
                t += dyt;
            }
        }
    } else {
        while (y >= 0 && x <= a) {
            if (t + b2 * x <= crit1       /* e(x+1,y-1/2) <= 0 */
                || t + a2 * y <= crit3) { /* e(x+1/2,y) <= 0 */
                x++;
                dxt += d2xt;
                t += dxt;
                width += 2;
            } else if (t - a2 * y > crit2) { /* e(x+1/2,y-1) > 0 */
                for (i = 0; i < width; i++)
                    selection_setpoint(xc - x + i, yc - y, ov, 1);
                if (y !== 0)
                    for (i = 0; i < width; i++)
                        selection_setpoint(xc - x + i, yc + y, ov, 1);
                y--;
                dyt += d2yt;
                t += dyt;
            } else {
                for (i = 0; i < width; i++)
                    selection_setpoint(xc - x + i, yc - y, ov, 1);
                if (y !== 0)
                    for (i = 0; i < width; i++)
                        selection_setpoint(xc - x + i, yc + y, ov, 1);
                x++;
                dxt += d2xt;
                t += dxt;
                y--;
                dyt += d2yt;
                t += dyt;
                width += 2;
            }
        }
    }
}

// C ref: selvar.c:542 line_dist_coord() — "square of distance from line segment
// (x1,y1, x2,y2) to point (x3,y3)".
// C computes `lu` in single precision (`/ (float) s`) and then TRUNCATES
// `x1 + lu * px` into a long, so the float width is observable: a double would
// land on the other side of an integer boundary for some inputs and shift the
// result by 1.  Math.fround() reproduces the float32 rounding at each step.
function line_dist_coord(x1, y1, x2, y2, x3, y3) {
    const px = x2 - x1;
    const py = y2 - y1;
    const s = px * px + py * py;
    let x, y, dx, dy, distsq = 0;
    let lu = 0;

    if (x1 === x2 && y1 === y2)
        return dist2(x1, y1, x3, y3);

    lu = Math.fround(Math.fround((x3 - x1) * px + (y3 - y1) * py) / Math.fround(s));
    if (lu > 1)
        lu = 1;
    else if (lu < 0)
        lu = 0;

    x = Math.trunc(Math.fround(x1 + Math.fround(lu * px)));
    y = Math.trunc(Math.fround(y1 + Math.fround(lu * py)));
    dx = x - x3;
    dy = y - y3;
    distsq = dx * dx + dy * dy;

    return distsq;
}

// C ref: selvar.c:570 selection_do_gradient() — "guts of l_selection_gradient".
// RNG: rn2(dofs) is drawn ONCE per cell, and only when the cell is outside the
// mind radius but inside the maxd radius (C's `||` and `&&` short-circuit).
// Getting that gate wrong changes the draw COUNT for the whole map.
export async function selection_do_gradient(ov, x, y, x2, y2, gtyp, mind, maxd) {
    let dx, dy, dofs;

    if (mind > maxd) {
        const tmp = mind;
        mind = maxd;
        maxd = tmp;
    }

    dofs = maxd * maxd - mind * mind;
    if (dofs < 1)
        dofs = 1;

    if (gtyp !== SEL_GRADIENT_RADIAL && gtyp !== SEL_GRADIENT_SQUARE) {
        const { impossible } = await import('./display.js');
        await impossible('Unrecognized gradient type! Defaulting to radial...');
        gtyp = SEL_GRADIENT_RADIAL;   /* C: FALLTHROUGH into the radial case */
    }

    switch (gtyp) {
    default:
    case SEL_GRADIENT_RADIAL: {
        for (dx = 0; dx < COLNO; dx++)
            for (dy = 0; dy < ROWNO; dy++) {
                const d0 = line_dist_coord(x, y, x2, y2, dx, dy);

                if (d0 <= mind * mind
                    || (d0 <= maxd * maxd && d0 - mind * mind < rn2(dofs)))
                    selection_setpoint(dx, dy, ov, 1);
            }
        break;
    }
    case SEL_GRADIENT_SQUARE: {
        for (dx = 0; dx < COLNO; dx++)
            for (dy = 0; dy < ROWNO; dy++) {
                const d1 = line_dist_coord(x, y, x2, y2, x, dy);
                const d2 = line_dist_coord(x, y, x2, y2, dx, y);
                const d3 = line_dist_coord(x, y, x2, y2, x2, dy);
                const d4 = line_dist_coord(x, y, x2, y2, dx, y2);
                const d5 = line_dist_coord(x, y, x2, y2, dx, dy);
                const d0 = Math.min(d5, Math.min(Math.max(d1, d2),
                                                 Math.max(d3, d4)));

                if (d0 <= mind * mind
                    || (d0 <= maxd * maxd && d0 - mind * mind < rn2(dofs)))
                    selection_setpoint(dx, dy, ov, 1);
            }
        break;
    } /*case*/
    } /*switch*/
}

// C ref: selvar.c:747 selection_is_irregular(sel) — "selection is not
// rectangular, or has holes in it".  The isok() test is why a selection whose
// bounds include column 0 can still be "regular": column 0 is never ok.
export function selection_is_irregular(sel) {
    const rect = selection_getbounds(sel);

    for (let x = rect.lx; x <= rect.hx; x++)
        for (let y = rect.ly; y <= rect.hy; y++)
            if (isok(x, y) && !selection_getpoint(x, y, sel))
                return true;

    return false;
}

// C ref: selvar.c:764 selection_size_description(sel, buf) — "return a
// description of the selection size".  C's out-buffer becomes the return value.
export function selection_size_description(sel) {
    const rect = selection_getbounds(sel);
    const dx = rect.hx - rect.lx + 1;
    const dy = rect.hy - rect.ly + 1;
    return `${selection_is_irregular(sel) ? 'irregularly shaped'
             : (dx === dy) ? 'square' : 'rectangular'} ${dx} by ${dy}`;
}

// C ref: selvar.c:781 selection_from_mkroom(croom) — the cells that belong to
// one room, by roomno rather than by rectangle, so an irregular room comes back
// with its real shape.  sp_lev.js is imported lazily: it imports THIS file, so a
// static edge would be a cycle.
export async function selection_from_mkroom(croom) {
    const sel = selection_new();

    if (!croom) {
        const { sp_lev_state } = await import('./sp_lev.js');
        const coder = sp_lev_state().coder;
        if (coder && coder.croom)
            croom = coder.croom;
    }
    if (!croom)
        return sel;

    // C: `rmno = (croom - svr.rooms) + ROOMOFFSET`.  A SUBROOM lives past
    // MAXNROFROOMS in svr.rooms[], so indexOf() over level.rooms answers -1 for
    // it — js/mkroom.js:92 hit exactly that and records the index on the room as
    // `roomnoidx`.
    const idx = (croom.roomnoidx ?? (game.level?.rooms?.indexOf(croom) ?? -1));
    const rmno = idx + ROOMOFFSET;
    for (let y = croom.ly; y <= croom.hy; y++)
        for (let x = croom.lx; x <= croom.hx; x++) {
            const loc = game.level?.at(x, y);
            if (isok(x, y) && loc && !loc.edge && loc.roomno === rmno)
                selection_setpoint(x, y, sel, 1);
        }
    return sel;
}

// C ref: selvar.c:802 selection_force_newsyms(sel) — note it starts at x == 1,
// not 0.  newsym_force() is a display.c function that this port keeps in
// js/invent.js:8065, hence the lazy import (and it belongs in display.js).
export async function selection_force_newsyms(sel) {
    const { newsym_force } = await import('./invent.js');

    for (let x = 1; x < sel.wid; x++)
        for (let y = 0; y < sel.hei; y++)
            if (selection_getpoint(x, y, sel))
                newsym_force(x, y);
}
