// js/nhlsel.js — port of src/nhlsel.c, the Lua binding layer for the
// `selection` userdata: the des.map / themeroom selection algebra a level
// script drives through `selection.new()`, `sel:fillrect()`, `selection.grow()`,
// `selection.gradient{...}`, the &/|/~/- operators, and so on.
//
// STATUS: INERT.  Nothing in js/ imports this file, nothing here is called from
// existing code, and l_selection_register() is deliberately NOT installed into
// game.l_selection_register (js/nhlua.js:2170 is the hook that would pick it
// up).  Registering it would put these functions on the live level-generation
// path and move the RNG stream.  Same convention as js/nhlua.js and js/dlb.js.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHERE THE SELECTION ALGEBRA LIVES TODAY.
//
// This port does not embed Lua: dat/*.lua is hand-ported into js/sp_lev.js,
// js/mklev.js and js/levels/, so a level script's `selection.area(...)` arrives
// as a direct JS call.  Consequently the split is:
//
//   * js/selvar.js  — src/selvar.c, the real engine (bitmap + bounds cache) AND
//     already-reduced forms of eight of this file's functions, with the Lua
//     argument handling stripped off (a fixed signature instead of C's
//     argc dispatch).  Those eight are NOT repeated here; see ALREADY PORTED.
//   * this file      — src/nhlsel.c's argument marshalling proper: the argc
//     dispatch, get_location_coord()/cvt_to_abscoord() conversions, the
//     clone-before-mutate discipline, and the operator metamethods.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE LUA STACK.  Same mapping as js/nhlua.js documents:
//   * a `lua_CFunction` becomes an ordinary function taking the arguments the
//     Lua caller passed (`...args` == stack indices 1..argc, so
//     `argc = args.length` and `lua_type(L, 1)` is `typeof args[0]`), and
//     RETURNING what C pushed; `return 0` (no results) becomes `undefined`.
//   * a stack INDEX parameter stays: l_selection_check(args, index) is 1-based
//     exactly like C's, so `l_selection_check(L, 2)` reads `args[1]`.
//   * `(void) l_selection_new(L)` pushes a new selection and the following
//     `l_selection_check(L, 2)` reads it back.  Here the push is the return
//     value and the check is the local that receives it, so
//     "clone then mutate the clone then return it" is written out directly.
//     The `lua_remove`/`lua_settop` calls that leave exactly the result on the
//     stack therefore have no counterpart, except in params_sel_2coords()
//     where the trimmed stack IS the next call's input; that one rewrites
//     `args` in place, as C rewrites the stack.
//   * a C out-param pair (`selection_rndcoord(sel, &x, &y, removeit)`) becomes
//     a returned record.
//   * `nhl_error()` throws, so every `/*NOTREACHED*/` really is unreachable.
//
// RNG: nhlsel.c itself draws nothing.  Every draw comes from the selvar.c guts
// it calls — selection_filter_percent (one rn2(100) per set point),
// selection_filter_mapchar (rn2(2) per matching cell when lit == -1),
// selection_do_grow (one rn2(4) for W_RANDOM), selection_do_randline (a
// rejection-looped rn2(rough) pair per recursion level), selection_rndcoord
// (one rn2(count)) — plus get_location_coord()'s random-coordinate loops.  The
// ORDER of those calls is what this file has to preserve.
//
// ALREADY PORTED, DELIBERATELY NOT REPEATED HERE (the reduced forms named
// above; wiring this file up means reconciling their signatures):
//   * l_selection_and()      — js/selvar.js:177  (sela, selb)
//   * l_selection_or()       — js/selvar.js:189  (sela, selb)
//   * l_selection_grow()     — js/selvar.js:290  (sel, dir)         [no argc
//     dispatch and no luaL_checkoption over {"all","random","north",...}]
//   * l_selection_randline() — js/selvar.js:355  (sel, x1,y1,x2,y2, roughness)
//   * l_selection_iterate()  — js/selvar.js:376  (ov, origin, fn)
//   * l_selection_fillrect() — js/selvar.js:396  (sel, x1,y1,x2,y2)
//   * l_selection_line()     — js/selvar.js:408  (sel, x1,y1,x2,y2)
//   * l_selection_rect()     — js/selvar.js:415  (sel, x1,y1,x2,y2)
//   All eight skip the two get_location_coord() calls that nhlsel.c makes on
//   (x1,y1) and (x2,y2) — those turn a room-relative or random coordinate into
//   an absolute one and can THEMSELVES draw RNG.  params_sel_2coords() below is
//   exported for whoever reconciles that.
//   js/selvar.js:171 l_selection_negate() is l_selection_not()'s body under the
//   Lua method name, and js/selvar.js:386 selection_numpoints() is
//   l_selection_numpoints()'s body; both are delegated to below rather than
//   written twice.
//
// NAMING.  nhlsel.c's own names are kept verbatim and exported.  Helpers that
// stand in for functions belonging to OTHER C files are `_`-prefixed, so
// swarm/bin/coverage.mjs cannot read them as ports of those files.

import { game } from './gstate.js';
import {
    ANY_LOC, SP_COORD_IS_RANDOM, INVALID_TYPE, isok,
} from './const.js';
import {
    Selection, selection_new, selection_clone, selection_clear,
    selection_getpoint, selection_setpoint, selection_recalc_bounds,
    selection_getbounds, selection_not, selection_numpoints,
    selection_filter_percent, selection_filter_mapchar, selection_rndcoord,
    l_selection_and, l_selection_or, l_selection_grow, l_selection_iterate,
    l_selection_fillrect, l_selection_line, l_selection_rect,
    l_selection_randline,
} from './selvar.js';
import {
    nhl_error, nhl_add_table_entry_int, nhl_get_xy_params, check_mapchr,
    lcheck_param_table, get_table_int, get_table_int_opt, get_table_option,
} from './nhlua.js';
import {
    get_location_coord, cvt_to_abscoord, update_croom, sp_lev_state,
    mapfrag_fromstr, mapfrag_match, mapfrag_error, mapfrag_free,
    set_floodfillchk_match_under, gx, gy,
} from './sp_lev.js';

/* ------------------------------------------------------------------------
 * lauxlib.c argument checkers.  js/nhlua.js has the same set as file-locals;
 * they are not exported there, so this file carries its own copies.
 * ------------------------------------------------------------------------ */

/* luaL_checkinteger() */
function _checkinteger(v, what = 'number expected') {
    if (typeof v === 'number') return Math.trunc(v);
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)))
        return Math.trunc(Number(v));
    nhl_error(null, what);
    /*NOTREACHED*/
    return 0;
}

/* luaL_optinteger() */
function _optinteger(v, defval) {
    return (v === undefined || v === null) ? defval : _checkinteger(v);
}

/* luaL_checkstring() */
function _checkstring(v, what = 'string expected') {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    nhl_error(null, what);
    /*NOTREACHED*/
    return '';
}

/* lua_toboolean() — only nil and false are false */
function _toboolean(v) { return v !== null && v !== undefined && v !== false; }

/* lua_type(L, i) == LUA_TNUMBER / LUA_TTABLE */
function _isnumber(v) { return typeof v === 'number'; }
function _istable(v) {
    return typeof v === 'object' && v !== null && !(v instanceof Selection);
}

/* ------------------------------------------------------------------------
 * sp_lev.h macros and the selvar.c guts this file calls.
 * ------------------------------------------------------------------------ */

/* C ref: sp_lev.h:82-85.  js/sp_lev.js has the same pair as file-locals. */
const _SP_COORD_PACK = (x, y) => ((x & 0xff) + ((y & 0xff) << 16));
const _SP_COORD_PACK_RANDOM = (f) => (SP_COORD_IS_RANDOM | f);

/* C ref: sp_lev.h:63-64 SEL_GRADIENT_RADIAL / SEL_GRADIENT_SQUARE. */
const SEL_GRADIENT_RADIAL = 0;
const SEL_GRADIENT_SQUARE = 1;

/* `gc.coder ? gc.coder->croom : NULL`, which is what every get_location_coord()
   call in this file passes as its room. */
function _coder_croom() {
    const spl = sp_lev_state();
    return spl.coder ? spl.coder.croom : null;
}

/* svn.nroom / svr.rooms, which this port keeps on the level. */
function _svn_nroom() { return game.level?.nroom ?? 0; }
function _svr_rooms() { return game.level?.rooms ?? []; }

/* rect.c rect_bounds(r1, r2, &res) — the union rect the &/|/~/- operators take
   over the two operands' RAW ->bounds (no recalc).  js/selvar.js:151 has the
   same body as a file-local, so this is a second copy rather than an import. */
function _rect_bounds(r1, r2) {
    return {
        lx: Math.min(r1.lx, r2.lx),
        ly: Math.min(r1.ly, r2.ly),
        hx: Math.max(r1.hx, r2.hx),
        hy: Math.max(r1.hy, r2.hy),
    };
}

/* selvar.c's deallocator.  The JS GC owns the bitmap, so this is a no-op; the
   `freesel` argument says whether the struct itself goes too. */
function _selection_free(_sel, _freesel) {}

/* ---- UNPORTED selvar.c guts -------------------------------------------------
 * Five of the engine functions nhlsel.c drives have no JS counterpart anywhere
 * (grep confirms: js/cmd.js:5482 carries its own no-op flood-fill stub for
 * dolookaround, and js/sp_lev.js's extern table lists the flood fill as not
 * wired up).  They are stubbed here so this file's control flow is the C's;
 * wiring nhlsel.js up requires porting them in js/selvar.js first:
 *
 *   selvar.c:395  the flood fill        (no RNG; walks the current floodfillchk)
 *   selvar.c:456  McIlroy's ellipse     (no RNG)
 *   selvar.c:570  the gradient          (one rn2(maxd - mind) per candidate
 *                                        point between mindist and maxdist)
 *   selvar.c:764  the size description  ("irregularly shaped"/"square"/
 *                                        "rectangular" WxH)
 *   selvar.c:781  the mkroom -> selection conversion (no RNG)
 *
 * The gradient one is the only RNG-bearing member, so l_selection_gradient()
 * below is the only inert caller whose draws are currently missing.
 * ------------------------------------------------------------------------- */
function _selection_floodfill(_ov, _x, _y, _diagonals) {}
function _selection_do_ellipse(_ov, _xc, _yc, _a, _b, _filled) {}
function _selection_do_gradient(_ov, _x, _y, _x2, _y2, _gtyp, _mind, _maxd) {}
function _selection_size_description(_sel, _buf) { return 'area'; }
function _selection_from_mkroom(_croom) { return selection_new(); }

/* ------------------------------------------------------------------------
 * nhlsel.c:57 — the userdata checker.  C runs luaL_checktype(LUA_TUSERDATA)
 * and then luaL_checkudata(..., "selection"); both throw on a mismatch, so the
 * two collapse into one instanceof test here.  `index` is 1-based, as in C.
 * ------------------------------------------------------------------------ */
export function l_selection_check(args, index) {
    const sel = args[index - 1];

    if (!(sel instanceof Selection))
        nhl_error(null, 'Selection error');
    return sel;
}

/* nhlsel.c:69 — __gc */
export function l_selection_gc(...args) {
    const sel = l_selection_check(args, 1);

    if (sel)
        _selection_free(sel, false);
    return undefined;                           /* C: return 0 */
}

/* nhlsel.c:79 — inside `#if 0` in the C, kept for the record: the same check
   as l_selection_check() but with a plain lua_touserdata(), i.e. no type test
   at all, so a non-selection userdata slips through. */
export function l_selection_to(args, index) {
    const sel = args[index - 1];

    if (!sel)
        nhl_error(null, 'Selection error');
    return sel;
}

/* nhlsel.c:93 — push a new selection into the lua stack, return it.  C builds
   the userdata, shallow-copies a fresh selection into it, re-duplicates the
   bitmap and frees the temporary; selection_clone() is that copy. */
export function l_selection_push_new() {
    const tmp = selection_new();
    const sel = selection_clone(tmp);

    _selection_free(tmp, true);
    return sel;
}

/* nhlsel.c:111 — push a copy of selectionvar tmp to the lua stack.  Unlike
   l_selection_push_new() this one does NOT free its argument. */
export function l_selection_push_copy(tmp) {
    return selection_clone(tmp);
}

/* nhlsel.c:126 — local sel = selection.new(); */
export function l_selection_new() {
    return l_selection_push_new();
}

/* nhlsel.c:135 — replace the topmost selection in the stack with a clone of it.
   The new selection is pushed first and then overwritten field by field, so the
   result carries the SOURCE's wid/hei/bounds/bounds_dirty, not a fresh set. */
export function l_selection_clone(...args) {
    const sel = l_selection_check(args, 1);
    const tmp = l_selection_new();

    tmp.wid = sel.wid;
    tmp.hei = sel.hei;
    tmp.bounds = { ...sel.bounds };
    tmp.bounds_dirty = sel.bounds_dirty;
    tmp.map = Uint8Array.from(sel.map);         /* dupstr(sel->map) */
    return tmp;
}

/* nhlsel.c:158 — selection.set(sel, x, y[, value]) / selection.set(x, y).
   NB the zero-argument form: C pushes a new selection but leaves its own `sel`
   NULL, so `selection.set()` always falls into the error below despite the
   comment above the C function claiming otherwise.  Kept verbatim. */
export function l_selection_setpoint(...args) {
    let sel = null;
    let x = -1, y = -1;
    let val = 1;
    const argc = args.length;
    let crd = 0;

    if (argc === 0) {
        l_selection_new();
    } else if (argc === 1) {
        sel = l_selection_check(args, 1);
    } else if (argc === 2) {
        x = _checkinteger(args[0]);
        y = _checkinteger(args[1]);
        args.length = 0;                        /* lua_pop(L, 2) */
        args.push(l_selection_new());
        sel = l_selection_check(args, 1);
    } else {
        sel = l_selection_check(args, 1);
        x = _checkinteger(args[1]);
        y = _checkinteger(args[2]);
        val = _optinteger(args[3], 1);
    }

    if (!sel || !sel.map) {
        nhl_error(null, 'Selection setpoint error');
        /*NOTREACHED*/
        return undefined;
    }

    if (x === -1 && y === -1)
        crd = _SP_COORD_PACK_RANDOM(0);
    else
        crd = _SP_COORD_PACK(x, y);

    const c = { x, y };
    get_location_coord(c, ANY_LOC, _coder_croom(), crd);
    selection_setpoint(c.x, c.y, sel, val);
    return sel;                                 /* lua_settop(L, 1) */
}

/* nhlsel.c:202 — local numpoints = selection.numpoints(sel);
   The body (count set points inside the bounds, column-major) is
   js/selvar.js:386 selection_numpoints(). */
export function l_selection_numpoints(...args) {
    const sel = l_selection_check(args, 1);

    return selection_numpoints(sel);
}

/* nhlsel.c:223 — local value = selection.get(sel, x, y);
   The selection is REMOVED from the stack first, so nhl_get_xy_params() sees
   only the coordinate arguments and both the (x,y) and the ({x=,y=}) forms
   work. */
export function l_selection_getpoint(...args) {
    const sel = l_selection_check(args, 1);
    let crd;

    args.shift();                               /* lua_remove(L, 1) — sel */
    const p = nhl_get_xy_params(args);
    if (!p.ok) {
        nhl_error(null, 'l_selection_getpoint: Incorrect params');
        /*NOTREACHED*/
        return undefined;
    }

    const c = { x: p.x, y: p.y };

    if (c.x === -1 && c.y === -1)
        crd = _SP_COORD_PACK_RANDOM(0);
    else
        crd = _SP_COORD_PACK(c.x, c.y);
    get_location_coord(c, ANY_LOC, _coder_croom(), crd);

    return selection_getpoint(c.x, c.y, sel);
}

/* nhlsel.c:259 — local s = selection.negate(sel) / selection.negate() / __unm /
   __bnot.  With no argument the result is a brand-new ALL-SET selection; with
   one it is a negated clone, so the operand is left alone.
   js/selvar.js:171 l_selection_negate() is this same body. */
export function l_selection_not(...args) {
    const argc = args.length;
    let sel, sel2;
    let ret;

    if (argc === 0) {
        sel = l_selection_new();
        selection_clear(sel, 1);
        ret = sel;
    } else {
        l_selection_check(args, 1);
        sel2 = l_selection_clone(...args);
        selection_not(sel2);
        ret = sel2;                             /* lua_remove(L, 1) */
    }
    return ret;
}

/* nhlsel.c:331 — __bxor.  Unlike l_selection_or(), which force-assigns the
   union rect, xor can carve an irregular or smaller shape, so the result's
   bounds are recalculated. */
export function l_selection_xor(...args) {
    const sela = l_selection_check(args, 1);
    const selb = l_selection_check(args, 2);
    const selr = l_selection_push_new();
    const rect = _rect_bounds(sela.bounds, selb.bounds);

    for (let x = rect.lx; x <= rect.hx; x++)
        for (let y = rect.ly; y <= rect.hy; y++) {
            const val = (selection_getpoint(x, y, sela)
                         ^ selection_getpoint(x, y, selb));

            selection_setpoint(x, y, selr, val);
        }
    selection_recalc_bounds(selr);

    return selr;
}

/* nhlsel.c:360 — __sub, i.e. the points that are in A but not in B. */
export function l_selection_sub(...args) {
    const sela = l_selection_check(args, 1);
    const selb = l_selection_check(args, 2);
    const selr = l_selection_push_new();
    const rect = _rect_bounds(sela.bounds, selb.bounds);

    for (let x = rect.lx; x <= rect.hx; x++)
        for (let y = rect.ly; y <= rect.hy; y++) {
            const a_pt = selection_getpoint(x, y, sela);
            const b_pt = selection_getpoint(x, y, selb);
            const val = (a_pt ^ b_pt) & a_pt;

            selection_setpoint(x, y, selr, val);
        }
    selection_recalc_bounds(selr);

    return selr;
}

/* nhlsel.c:388 — local s = selection.percentage(sel, 50);
   One rn2(100) per set point inside sel's CURRENT bounds. */
export function l_selection_filter_percent(...args) {
    const sel = l_selection_check(args, 1);
    const p = _checkinteger(args[1]);

    const tmp = selection_filter_percent(sel, p);
    const ret = l_selection_push_copy(tmp);
    _selection_free(tmp, true);

    return ret;
}

/* nhlsel.c:406 — local pt = selection.rndcoord(sel[, removeit]);
   The drawn point is handed back MAP- or ROOM-RELATIVE (croom wins over the
   map origin), because a level script feeds it straight back into des.*. */
export function l_selection_rndcoord(...args) {
    const sel = l_selection_check(args, 1);
    const removeit = _optinteger(args[1], 0);
    const p = selection_rndcoord(sel, removeit);
    let x = p.x, y = p.y;

    if (!(x === -1 && y === -1)) {
        update_croom();
        const croom = _coder_croom();

        if (croom) {
            x -= croom.lx;
            y -= croom.ly;
        } else {
            x -= gx.xstart;
            y -= gy.ystart;
        }
    }

    const t = {};
    nhl_add_table_entry_int(t, 'x', x);
    nhl_add_table_entry_int(t, 'y', y);
    return t;
}

/* nhlsel.c:431 — local s = selection.room([i]);
   With no argument selection_from_mkroom(NULL) falls back to the coder's
   current room; with one it is an svr.rooms[] index, out-of-range meaning the
   same NULL. */
export function l_selection_room(...args) {
    let sel;
    const argc = args.length;
    let croom = null;

    if (argc === 1) {
        const i = _checkinteger(args[args.length - 1]);  /* index -1 */

        croom = (i >= 0 && i < _svn_nroom()) ? _svr_rooms()[i] : null;
    }

    sel = _selection_from_mkroom(croom);

    const ret = l_selection_push_copy(sel);
    _selection_free(sel, true);

    return ret;
}

/* nhlsel.c:453 — local rect = sel:bounds();
   selection_getbounds() reports the "no bounds recorded" sentinel as the WHOLE
   map, so an empty selection answers 0,0..COLNO-1,ROWNO-1. */
export function l_selection_getbounds(...args) {
    const sel = l_selection_check(args, 1);
    const rect = selection_getbounds(sel);
    const t = {};

    nhl_add_table_entry_int(t, 'lx', rect.lx);
    nhl_add_table_entry_int(t, 'ly', rect.ly);
    nhl_add_table_entry_int(t, 'hx', rect.hx);
    nhl_add_table_entry_int(t, 'hy', rect.hy);
    return t;
}

/* nhlsel.c:475 — get a selection and 4 integers off the stack, and REMOVE the
   integers so that what is left is exactly the selection, ready for the
   l_selection_clone() the callers do next.  `args` is rewritten in place for
   that reason.  Returns { ok, sel, x1, y1, x2, y2 }.
   function(selection, x1,y1, x2,y2)  /  selection:function(x1,y1, x2,y2) */
export function params_sel_2coords(args) {
    const argc = args.length;

    if (argc === 4) {
        /* C pushes the new selection at index 5, reads the four integers from
           1..4, then removes index 1 four times, leaving just the selection. */
        const nsel = l_selection_new();
        const x1 = _checkinteger(args[0]);
        const y1 = _checkinteger(args[1]);
        const x2 = _checkinteger(args[2]);
        const y2 = _checkinteger(args[3]);

        args.length = 0;
        args.push(nsel);
        return { ok: true, sel: nsel, x1, y1, x2, y2 };
    } else if (argc === 5) {
        const sel = l_selection_check(args, 1);
        const x1 = _checkinteger(args[1]);
        const y1 = _checkinteger(args[2]);
        const x2 = _checkinteger(args[3]);
        const y2 = _checkinteger(args[4]);

        args.length = 1;                        /* lua_pop(L, 4) */
        return { ok: true, sel, x1, y1, x2, y2 };
    }
    return { ok: false };
}

/* nhlsel.c:656 — local s = selection.filter_mapchar(sel, mapchar[, lit]);
   lit defaults to -2 ("don't care"); -1 costs one rn2(2) per matching cell. */
export function l_selection_filter_mapchar(...args) {
    const sel = l_selection_check(args, 1);
    const mapchr = _checkstring(args[1]);
    const typ = check_mapchr(mapchr);
    const lit = _optinteger(args[2], -2);

    if (typ === INVALID_TYPE)
        nhl_error(null, 'Erroneous map char');

    const tmp = selection_filter_mapchar(sel, typ, lit);
    const ret = l_selection_push_copy(tmp);
    _selection_free(tmp, true);

    return ret;
}

/* nhlsel.c:681 — local s = selection.match([[...]]);
   Two C quirks kept verbatim: the y loop runs `y <= sel->hei` (one row past the
   bitmap, which selection_setpoint() then discards) and the x loop starts at 1,
   so column 0 is never matched.  The trailing recalc exists because of that
   second one — without a match at x=0 the incremental bounds would be left
   inverted. */
export function l_selection_match(...args) {
    const argc = args.length;
    let sel = null;
    const box = { mf: null };                   /* struct mapfragment *mf */

    if (argc === 1) {
        const mapstr = _checkstring(args[0]);

        sel = l_selection_new();

        box.mf = mapfrag_fromstr(mapstr);

        const err = mapfrag_error(box.mf);
        if (err !== null) {
            nhl_error(null, err);
            /*NOTREACHED*/
        }
    } else {
        nhl_error(null, 'wrong parameters');
        /*NOTREACHED*/
    }

    for (let y = 0; y <= sel.hei; y++)
        for (let x = 1; x < sel.wid; x++)
            selection_setpoint(x, y, sel,
                               mapfrag_match(box.mf, x, y) ? 1 : 0);

    selection_recalc_bounds(sel);

    mapfrag_free(box);

    return sel;
}

/* nhlsel.c:725 — local s = selection.floodfill(x, y[, diagonals]);
   The terrain to spread over is latched from the STARTING square, so the
   set_floodfillchk_match_under() call must stay before the fill. */
export function l_selection_flood(...args) {
    const argc = args.length;
    let sel = null;
    let x = 0, y = 0;
    let diagonals = false;

    if (argc === 2 || argc === 3) {
        x = _checkinteger(args[0]);
        y = _checkinteger(args[1]);
        if (argc === 3)
            diagonals = _toboolean(args[2]);
        sel = l_selection_new();
    } else {
        nhl_error(null, 'wrong parameters');
        /*NOTREACHED*/
    }

    const c = { x, y };
    get_location_coord(c, ANY_LOC, _coder_croom(), _SP_COORD_PACK(x, y));

    if (isok(c.x, c.y)) {
        set_floodfillchk_match_under(game.level.at(c.x, c.y).typ);
        _selection_floodfill(sel, c.x, c.y, diagonals);
    }
    return sel;
}

/* nhlsel.c:761 — selection.circle(x,y,r[,filled]) or
   selection.circle(sel, x,y,r[,filled]).  Note what the engine is handed:
   `!filled`, i.e. selection_do_ellipse()'s last parameter is really "outline
   only" despite being named `filled` there. */
export function l_selection_circle(...args) {
    const argc = args.length;
    let sel = null;
    let x = 0, y = 0;
    let r = 0, filled = 0;

    if (argc === 3) {
        x = _checkinteger(args[0]);
        y = _checkinteger(args[1]);
        r = _checkinteger(args[2]);
        sel = l_selection_new();
        filled = 0;
    } else if (argc === 4 && _isnumber(args[0])) {
        x = _checkinteger(args[0]);
        y = _checkinteger(args[1]);
        r = _checkinteger(args[2]);
        filled = _checkinteger(args[3]);        /* TODO: boolean */
        sel = l_selection_new();
    } else if (argc === 4 || argc === 5) {
        sel = l_selection_check(args, 1);
        x = _checkinteger(args[1]);
        y = _checkinteger(args[2]);
        r = _checkinteger(args[3]);
        filled = _optinteger(args[4], 0);       /* TODO: boolean */
    } else {
        nhl_error(null, 'wrong parameters');
        /*NOTREACHED*/
    }

    const c = { x, y };
    get_location_coord(c, ANY_LOC, _coder_croom(), _SP_COORD_PACK(x, y));

    _selection_do_ellipse(sel, c.x, c.y, r, r, !filled);

    return sel;                                 /* lua_settop(L, 1) */
}

/* nhlsel.c:809 — selection.ellipse(x,y,r1,r2[,filled]) or
   selection.ellipse(sel, x,y,r1,r2[,filled]).  Same `!filled` note as above;
   note also that the 4-argument form hardcodes filled = 0 while the
   5-argument numeric form reads it, exactly as in l_selection_circle(). */
export function l_selection_ellipse(...args) {
    const argc = args.length;
    let sel = null;
    let x = 0, y = 0;
    let r1 = 0, r2 = 0, filled = 0;

    if (argc === 4) {
        x = _checkinteger(args[0]);
        y = _checkinteger(args[1]);
        r1 = _checkinteger(args[2]);
        r2 = _checkinteger(args[3]);
        sel = l_selection_new();
        filled = 0;
    } else if (argc === 5 && _isnumber(args[0])) {
        x = _checkinteger(args[0]);
        y = _checkinteger(args[1]);
        r1 = _checkinteger(args[2]);
        r2 = _checkinteger(args[3]);
        filled = _optinteger(args[4], 0);       /* TODO: boolean */
        sel = l_selection_new();
    } else if (argc === 5 || argc === 6) {
        sel = l_selection_check(args, 1);
        x = _checkinteger(args[1]);
        y = _checkinteger(args[2]);
        r1 = _checkinteger(args[3]);
        r2 = _checkinteger(args[4]);
        filled = _optinteger(args[5], 0);       /* TODO: boolean */
    } else {
        nhl_error(null, 'wrong parameters');
        /*NOTREACHED*/
    }

    const c = { x, y };
    get_location_coord(c, ANY_LOC, _coder_croom(), _SP_COORD_PACK(x, y));

    _selection_do_ellipse(sel, c.x, c.y, r1, r2, !filled);

    return sel;                                 /* lua_settop(L, 1) */
}

/* nhlsel.c:861 — selection.gradient({ type=, x=, y=, x2=, y2=, mindist=,
   maxdist= }).  Table form only.
   TWO literals to leave alone: x2/y2 default to -1 and maxdist is REQUIRED
   (get_table_int, not _opt) while mindist defaults to 0.  And the -1 defaults
   are put through cvt_to_abscoord() BEFORE the `x2 == -1 && y2 == -1` test, so
   on a level with xstart 1 / ystart 0 an omitted x2,y2 arrives as (0,-1) and
   the test FAILS — the gradient then runs along a line to that corner instead
   of being centred on (x,y).  That is what the C does; do not "fix" it. */
export function l_selection_gradient(...args) {
    const argc = args.length;
    let sel = null;
    let x = 0, y = 0, x2 = -1, y2 = -1;
    let mindist = 0, maxdist = 0;
    let type = 0;
    const gradtypes = ['radial', 'square', null];
    const gradtypes2i = [SEL_GRADIENT_RADIAL, SEL_GRADIENT_SQUARE, -1];

    if (argc === 1 && _istable(args[0])) {
        const t = lcheck_param_table(args);

        type = gradtypes2i[get_table_option(t, 'type', 'radial', gradtypes)];
        x = get_table_int(t, 'x');
        y = get_table_int(t, 'y');
        x2 = get_table_int_opt(t, 'x2', -1);
        y2 = get_table_int_opt(t, 'y2', -1);

        const c1 = { x, y };
        cvt_to_abscoord(c1);
        x = c1.x;
        y = c1.y;

        const c2 = { x: x2, y: y2 };
        cvt_to_abscoord(c2);
        x2 = c2.x;
        y2 = c2.y;

        maxdist = get_table_int(t, 'maxdist');
        mindist = get_table_int_opt(t, 'mindist', 0);

        sel = l_selection_new();
    } else {
        nhl_error(null, 'selection.gradient requires table argument');
        /*NOTREACHED*/
    }

    if (x2 === -1 && y2 === -1) {
        x2 = x;
        y2 = y;
    }

    _selection_do_gradient(sel, x, y, x2, y2, type, mindist, maxdist);
    return sel;                                 /* lua_settop(L, 1) */
}

/* nhlsel.c:961 — local txt = sel:describe_size(); */
export function l_selection_size_description(...args) {
    const argc = args.length;

    if (argc === 1) {
        const sel = l_selection_check(args, 1);
        const buf = '';

        return _selection_size_description(sel, buf);
    } else {
        nhl_error(null, 'wrong parameters');
        /*NOTREACHED*/
    }
    return undefined;
}

/* ------------------------------------------------------------------------
 * nhlsel.c:981 — the method and metamethod tables, and the registrar.
 *
 * The eight entries marked (reduced) come from js/selvar.js and take FIXED
 * arguments instead of driving off argc, so they are not callable through this
 * table as-is; see the ALREADY PORTED note in the file header.  This is inert
 * either way: nothing assigns l_selection_register to
 * game.l_selection_register, which is the hook js/nhlua.js:2170 would use.
 * ------------------------------------------------------------------------ */
const l_selection_methods = [
    ['new', l_selection_new],
    ['clone', l_selection_clone],
    ['get', l_selection_getpoint],
    ['set', l_selection_setpoint],
    ['numpoints', l_selection_numpoints],
    ['negate', l_selection_not],
    ['percentage', l_selection_filter_percent],
    ['rndcoord', l_selection_rndcoord],
    ['line', l_selection_line],                 /* (reduced) */
    ['randline', l_selection_randline],         /* (reduced) */
    ['rect', l_selection_rect],                 /* (reduced) */
    ['fillrect', l_selection_fillrect],         /* (reduced) */
    ['area', l_selection_fillrect],             /* (reduced) */
    ['grow', l_selection_grow],                 /* (reduced) */
    ['filter_mapchar', l_selection_filter_mapchar],
    ['match', l_selection_match],
    ['floodfill', l_selection_flood],
    ['circle', l_selection_circle],
    ['ellipse', l_selection_ellipse],
    ['gradient', l_selection_gradient],
    ['iterate', l_selection_iterate],           /* (reduced) */
    ['bounds', l_selection_getbounds],
    ['room', l_selection_room],
    ['describe_size', l_selection_size_description],
];

const l_selection_meta = [
    ['__gc', l_selection_gc],
    ['__unm', l_selection_not],
    ['__band', l_selection_and],                /* (reduced) */
    ['__bor', l_selection_or],                  /* (reduced) */
    ['__bxor', l_selection_xor],
    ['__bnot', l_selection_not],
    ['__add', l_selection_or],                  /* (reduced) — + aliases | */
    ['__sub', l_selection_sub],
];

/* nhlsel.c:1024 */
export function l_selection_register(L) {
    /* luaL_newlib(L, l_selection_methods) — instance + static methods */
    const methods = {};
    for (const [name, fn] of l_selection_methods) methods[name] = fn;

    /* luaL_newmetatable(L, "selection"); luaL_setfuncs(L, l_selection_meta, 0) */
    const meta = { __name: 'selection' };
    for (const [name, fn] of l_selection_meta) meta[name] = fn;

    /* metatable.__index points at the selection method table */
    meta.__index = methods;

    /* don't let lua code mess with the real metatable — offer a copy that only
       contains the metamethods */
    const fake = {};
    for (const [name, fn] of l_selection_meta) fake[name] = fn;
    meta.__metatable = fake;

    if (L) {
        /* the Lua registry entry luaL_getmetatable() reads back */
        (L.registry ||= {}).selection = meta;
        /* lua_setglobal(L, "selection") */
        (L.globals ||= {}).selection = methods;
    }
    return 0;
}
