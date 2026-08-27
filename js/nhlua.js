// js/nhlua.js — port of src/nhlua.c, the C<->Lua binding layer: the `nh.*`,
// `nhc.*` and `u.*` tables handed to a level script, the `get_table_*` accessors
// every des.* option reader uses, and the sandboxed Lua-state lifecycle
// (nhl_init / nhl_pcall / nhl_done / nhlL_newstate).
//
// STATUS: INERT.  Nothing in js/ imports this file and nothing here is called
// from existing code.  It exists so the C surface is translated; wiring it up is
// a separate, measured change.  Same convention as js/dlb.js.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE STACK-MANIPULATION HALF IS NOT APPLICABLE.
//
// This port does not embed Lua.  dat/*.lua level scripts are hand-ported into
// js/sp_lev.js and js/levels/, so there is no `lua_State`, no value stack, and
// no bytecode.  Every `lua_pushX` / `lua_getfield` / `lua_settop` / `lua_next`
// in nhlua.c is therefore dropped, and what is translated is the LOGIC those
// sequences implement.  Concretely:
//
//   * a Lua table is a plain JS object.  `get_table_int(t, "x")` reads t.x;
//     `nhl_add_table_entry_int(t, "x", 5)` writes it.  A Lua ARRAY is a JS array
//     whose index 0 is unused, because Lua arrays start at 1 (nhl_stairways).
//   * a `lua_CFunction` (C signature `int f(lua_State *)`, returning the number
//     of values pushed) becomes an ordinary function taking the arguments the
//     Lua caller passed and RETURNING the value C pushed.  Where C pushes two
//     values (nhl_int_to_obj_name) the JS returns an array of them; where C
//     pushes none it returns undefined.  `...args` is C's stack indices 1..argc,
//     so `argc = args.length` and `lua_type(L, 1)` is `_luatype(args[0])`.
//   * a C out-param pair (`nhl_get_xy_params(L, &x, &y)` -> boolean) becomes a
//     returned record: { ok, x, y }.
//   * `nhl_error()` is ATTRNORETURN and ends in lua_error(), i.e. a non-local
//     exit; here it throws.  Every `/*NOTREACHED*/` in the C is thus really
//     unreachable, and the DISABLE_WARNING_UNREACHABLE_CODE pragmas around it
//     have no counterpart.
//   * a `lua_State *` is a plain record — { globals, ud } — NOT an interpreter.
//     It is what nhl_alloc / nhl_done / nhlL_newstate / the step+memory limiter
//     actually read (the nhl_user_data hanging off L->ud), so those functions
//     translate as written.  The three places that need real Lua EVALUATION
//     (luaL_loadbuffer of a .lua file, and the loadstring round-trip inside
//     nhl_variable) cannot: nhl_loadlua stops after the read+line-splitting it
//     does itself, and nhl_variable's table branch performs the round trip's
//     observable effect directly.  See those functions.
//
// RNG: nhlua.c draws no randomness of its own except through nhl_rn2/nhl_random.
// The rn2(3)+rn2(2) that a `nhl_init()` really costs comes from dat/nhlib.lua's
// top-level `shuffle(align)` running under nhl_loadlua("nhlib.lua"), and that is
// ALREADY ported at both of its call sites (mklev.js l_nhcore_init() and
// version.js ensure_lua_version_loaded()).  nhl_loadlua() below must therefore
// never draw it, or wiring this file up would double the draws.
//
// NAMING.  nhlua.c's own names are kept verbatim and exported.  Helpers that
// stand in for functions belonging to OTHER C files are `_`-prefixed, so
// swarm/bin/coverage.mjs cannot read them as ports of those files.
//
// ALREADY PORTED, DELIBERATELY NOT REPEATED HERE:
//   * splev_chr2typ() (nhlua.c:382) — js/sp_lev.js:158 has it as a file-local.
//     check_mapchr() below inlines the char2typ[] scan rather than adding a
//     second definition of the name.  NB the sp_lev.js copy accepts two chars
//     char2typ[] does NOT have ('_'->ALTAR, '"'->IRONBARS), where C answers
//     INVALID_TYPE, and nhlua.c is the only char2typ[] in the tree.
//   * l_nhcore_init() (nhlua.c:140) — js/mklev.js:316, as the align shuffle.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import {
    COLNO, ROWNO, BUFSZ, LOW_PM,
    STONE, CORR, ROOM, HWALL, VWALL, DOOR, SDOOR, SCORR, AIR, CLOUD,
    TLCORNER, TRCORNER, BLCORNER, BRCORNER, CROSSWALL,
    TUWALL, TDWALL, TLWALL, TRWALL, DBWALL,
    FOUNTAIN, THRONE, SINK, MOAT, POOL, LAVAPOOL, LAVAWALL, ICE, WATER,
    TREE, IRONBARS, MAX_TYPE, MATCH_WALL, INVALID_TYPE,
    isok, IS_DOOR, IS_ALTAR, IS_THRONE, IS_FOUNTAIN, IS_SINK,
    D_NODOOR, D_BROKEN, D_ISOPEN, D_CLOSED, D_LOCKED, D_TRAPPED,
    AM_SHRINE, T_LOOTED, TREE_LOOTED, TREE_SWARM, F_LOOTED, F_WARNED,
    S_LPUDDING, S_LDWASHER, S_LRING,
    SQKY_BOARD, ROLLING_BOULDER_TRAP, PIT, SPIKED_PIT,
    NHW_MENU, PICK_NONE, PICK_ONE, PICK_ANY,
    MENU_BEHAVE_STANDARD, MENU_ITEMFLAGS_NONE, MENU_ITEMFLAGS_SELECTED,
    CQ_CANNED, ANY_INT, ANY_UCHAR, ANY_SCHAR,
} from './const.js';
import { NUMMONS } from './disprng.js';
import { t_at, deltrap, Invocation_lev } from './trap.js';
import { depth } from './hacklib.js';
import { level_difficulty_c } from './dungeon.js';
import { name_to_pmidx, monster_by_pmidx } from './makemon.js';
import { objects, extract_nobj } from './mkobj.js';
import { makesingular } from './objnam.js';
import { makeplural, cmdq_add_key, useupall, freeinv, addinv_nomerge,
         update_inventory, obfree } from './invent.js';
import { flip_level } from './sp_lev.js';
import { gx, gy } from './sp_lev.js';
import { parse_conf_str, l_get_config_errors } from './cfgfiles.js';
import { moveloop_core } from './allmain.js';
import { pline, impossible, topl_more } from './display.js';
import { verbalize } from './shk.js';

const TRUE = true, FALSE = false;

/* permonst.h:22 */
const HIGH_PM = NUMMONS - 1;
/* objclass.h:176 / MAXOCLASSES — the first non-class objects[] index */
const FIRST_OBJECT = 18;
const NUM_OBJECTS = objects.length;
/* hack.h — nhl_pline()'s --more-- target; this port has no window-id registry,
   so the id is nominal and only _display_nhwindow() ever looks at it. */
const WIN_MESSAGE = 1;

/* hack.h:691 */
const NHCORE_START_NEW_GAME = 0, NHCORE_RESTORE_OLD_GAME = 1,
      NHCORE_MOVELOOP_TURN = 2, NHCORE_GAME_EXIT = 3, NHCORE_GETPOS_TIP = 4,
      NHCORE_ENTER_TUTORIAL = 5, NHCORE_LEAVE_TUTORIAL = 6,
      NUM_NHCORE_CALLS = 7;

/* hack.h:704 + decl.c:7 nhcb_name[] */
const NUM_NHCB = 4;
const nhcb_name = ['cmd_before', 'level_enter', 'level_leave', 'end_turn'];

/* timeout.h:37 enum timeout_types */
const MELT_ICE_AWAY = 8, NUM_TIME_FUNCS = 9;
const TIMER_LEVEL = 1;                              /* timeout.h:14 */
/* timeout.h:51 — timer_is_pos(ttype) is MELT_ICE_AWAY only */
function _timer_is_pos(ttype) { return ttype === MELT_ICE_AWAY; }

/* global.h:523-568 — sandbox flags.  NHL_SB_PACKAGE has no definition upstream;
   its only use is under `#ifdef notyet` (nhl_init), so it stays 0 here. */
const NHL_SB_STEPSIZE = 1000;
const NHL_SB_SAFE = 0x80000000, NHL_SB_VERSION = 0x40000000,
      NHL_SB_DEBUGGING = 0x08000000,
      NHL_SB_STRING = 0x00000001, NHL_SB_TABLE = 0x00000002,
      NHL_SB_COROUTINE = 0x00000004, NHL_SB_MATH = 0x00000008,
      NHL_SB_UTF8 = 0x00000010, NHL_SB_IO = 0x00000020,
      NHL_SB_BASEMASK = 0x00000f80, NHL_SB_BASE_BASE = 0x00000080,
      NHL_SB_BASE_ERROR = 0x00000100, NHL_SB_BASE_META = 0x00000200,
      NHL_SB_BASE_GC = 0x00000400, NHL_SB_BASE_UNSAFE = 0x00000800,
      NHL_SB_DBMASK = 0x00003000, NHL_SB_DB_DB = 0x00001000,
      NHL_SB_DB_SAFE = 0x00002000,
      NHL_SB_OSMASK = 0x0000c000, NHL_SB_OS_TIME = 0x00004000,
      NHL_SB_OS_FILES = 0x00008000, NHL_SB_ALL = 0x0000ffff,
      NHL_SB_PACKAGE = 0;
const NHL_SBRV_DENY = 1, NHL_SBRV_ACCEPT = 2, NHL_SBRV_FAIL = 3;
/* global.h:572 enum NHL_pcall_action */
export const NHLpa_panic = 0, NHLpa_impossible = 1;

/* lua.h — the type tags nhlua.c switches on.  _luatype() maps a JS value to
   one; note LUA_TNIL covers `undefined` too, since a missing property is what a
   `lua_getfield` of an absent key pushes. */
const LUA_TNONE = -1, LUA_TNIL = 0, LUA_TBOOLEAN = 1, LUA_TNUMBER = 3,
      LUA_TSTRING = 4, LUA_TTABLE = 5, LUA_TFUNCTION = 6;
const LUA_OK = 0, LUA_MULTRET = -1;
const LUA_GCCOUNT = 3, LUA_GCCOUNTB = 4;

function _luatype(v) {
    if (v === null || v === undefined) return LUA_TNIL;
    switch (typeof v) {
    case 'boolean':  return LUA_TBOOLEAN;
    case 'number':   return LUA_TNUMBER;
    case 'string':   return LUA_TSTRING;
    case 'function': return LUA_TFUNCTION;
    case 'object':   return LUA_TTABLE;
    default:         return LUA_TNONE;
    }
}

/* lua.h lua_toboolean(): only nil and false are false — 0 is TRUE. */
function _toboolean(v) { return v !== null && v !== undefined && v !== false; }

/* lua.h lua_tointeger() on a non-number yields 0, it does not raise. */
function _tointeger(v) {
    const n = typeof v === 'number' ? v
            : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/* lauxlib.c luaL_checkinteger / luaL_checkstring / luaL_optstring /
   luaL_checktype / luaL_checkoption — each raises a Lua error on a bad
   argument, so each throws here. */
function _checkinteger(v, what) {
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
        return Math.trunc(Number(v));
    throw new Error(`bad argument (number expected${what ? `, ${what}` : ''})`);
}

function _checkstring(v, what) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);  /* Lua coerces numbers */
    throw new Error(`bad argument (string expected${what ? `, ${what}` : ''})`);
}

function _optstring(v, defval) {
    return (v === null || v === undefined) ? defval : _checkstring(v);
}

function _checktype(v, want, what) {
    if (_luatype(v) !== want)
        throw new Error(`bad argument (wrong type${what ? `, ${what}` : ''})`);
}

/* luaL_checkoption: return the INDEX of the string in opts[], or raise.  A
   non-null `def` is used when the value is absent. */
function _checkoption(v, def, opts) {
    const name = (v === null || v === undefined) ? def : _checkstring(v);
    if (name === null || name === undefined)
        throw new Error('bad argument (string expected)');
    for (let i = 0; i < opts.length; i++)
        if (opts[i] !== null && opts[i] === name) return i;
    throw new Error(`invalid option '${name}'`);
}

/* ------------------------------------------------------------------------
 * Delegates.  nhlua.c's bindings are thin wrappers over game functions; where
 * this port exports the C-named function we call it (imports above).  The rest
 * have no C-named counterpart here, so each stands in below, tagged with the C
 * function it represents.  A stand-in with no counterpart at all does the
 * neutral thing rather than guessing, and says so.
 * ------------------------------------------------------------------------ */

/* pline.c impossible() — display.js exports an async impossible(); the
   plumbing paths below are sync (C's are), so they record instead of paging,
   the same way wintty.js:48 does. */
function _impossible(msg) { game._impossible = String(msg); }

/* panic.c panic() — aborts the process in C. */
function _panic(msg) { throw new Error(String(msg)); }

/* files.c paniclog() */
function _paniclog(type, line) {
    (game.paniclog ||= []).push(`${type} ${line}`);
}

/* alloc.c re_alloc()/free() — a JS array/object needs neither, so nhl_alloc()
   below can only model the SIZE decision, which is the part that matters. */

/* sp_lev.c:4772 cvt_to_abscoord() — map-relative to absolute.  Mutates a
   { x, y } in place, as C does through its pointers. */
function _cvt_to_abscoord(p) {
    const croom = game.coder?.croom;
    if (croom) { p.x += croom.lx; p.y += croom.ly; }
    else { p.x += gx.xstart; p.y += gy.ystart; }
}

/* sp_lev.c:5319 get_coord() — accepts { x=, y= } or a 2-element array. */
function _get_coord(t) {
    const ltyp = _luatype(t);
    if (ltyp === LUA_TTABLE) {
        let x = 0, y = 0, gotx = FALSE;
        if (t.x !== null && t.x !== undefined) { x = _checkinteger(t.x); gotx = TRUE; }
        if (gotx) {
            if (t.y !== null && t.y !== undefined) return { ok: TRUE, x, y: _checkinteger(t.y) };
            nhl_error(null, 'Not a coordinate');
        }
        const arrlen = Array.isArray(t) ? t.length : 0;
        if (arrlen !== 2) nhl_error(null, 'Not a coordinate');
        /* sp_lev.c get_table_intarray_entry(L, i, 1|2): Lua indices 1 and 2 */
        return { ok: TRUE, x: _checkinteger(t[0]), y: _checkinteger(t[1]) };
    } else if (ltyp !== LUA_TNIL) {
        nhl_error(null, 'non-table coord specified');   /* non-existent coord is ok */
    }
    return { ok: FALSE, x: 0, y: 0 };
}

/* trap.c get_trapname_bytype(ttyp) */
function _get_trapname_bytype(ttyp) { return `trap ${ttyp}`; }

/* mkmaze.c levltyp_to_name(typ) — the debug name of a terrain type. */
function _levltyp_to_name(typ) { return `typ ${typ}`; }

/* objnam.c an(), s_suffix(), ing_suffix() — this port keeps only file-local
   copies of these, so there is nothing to import; the three nh.* wrappers
   below still check their argument count exactly as C does. */
function _an(str) { return /^[aeiouAEIOU]/.test(str) ? `an ${str}` : `a ${str}`; }
function _s_suffix(str) { return /s$/.test(str) ? `${str}'` : `${str}'s`; }
function _ing_suffix(str) { return `${str.replace(/e$/, '')}ing`; }

/* mon.c name_to_mon(str, &gend) -> pm index, NON_PM if unknown. */
function _name_to_mon(str) { return { pm: name_to_pmidx(str), mgend: -1 }; }

/* getline.c getlin(prompt, buf) — the port's line editor is reached through
   the command loop, not as a C-named call, so this yields the empty answer an
   ESC would give. */
function _getlin(_prompt) { return ''; }

/* wintty.c create_nhwindow/start_menu/add_menu/add_menu_str/end_menu/
   select_menu/destroy_nhwindow.  A winid here is the accumulator the two menu
   builders below fill; _select_menu() cannot run a real menu, so it returns no
   picks, which is exactly the pick_cnt==0 arm nhl_menu() already handles. */
function _create_nhwindow(type) { return { type, items: [], prompt: null }; }
function _start_menu(win, _behaviour) { win.items.length = 0; }
function _add_menu(win, _glyph, any, ch, gch, attr, clr, str, itemflags) {
    win.items.push({ any, ch, gch, attr, clr, str, itemflags });
}
function _add_menu_str(win, str) { win.items.push({ str }); }
function _end_menu(win, prompt) { win.prompt = prompt; }
function _select_menu(_win, _how) { return { cnt: 0, picks: [] }; }
function _destroy_nhwindow(_win) {}

/* windows.c display_nhwindow(WIN_MESSAGE, TRUE) — the message window's flush
   plus more(); display.js topl_more() is this port's --More--. */
async function _display_nhwindow(window, blocking) {
    if (window === WIN_MESSAGE && blocking) await topl_more();
}

/* options.c get_option_value(name, unambiguous) */
function _get_option_value(_name, _unambiguous) { return ''; }

/* cmd.c cmd_from_ecname(ecname) — the key an extended command is bound to, or
   the ext-cmd name when it is bound to none.  C's fallback is what nh.eckey()
   documents, so return that. */
function _cmd_from_ecname(ecname) { return ecname; }

/* dungeon.c dump_fmtstr(fmt, buf, fullname) — DUMPLOG only. */
function _dump_fmtstr(fmt, _fullname) { return fmt; }

/* timeout.c spot_time_expires / spot_stop_timers / start_timer */
function _spot_time_expires(_x, _y, _ttyp) { return 0; }
function _spot_stop_timers(_x, _y, _ttyp) {}
function _start_timer(_when, _kind, _func_index, _arg) { return 0; }
/* hack.h long_to_any() */
function _long_to_any(v) { return { a_long: v }; }

/* worn.c setworn / setnotworn */
function _setworn(_obj, _mask) {}
function _setnotworn(_obj) {}

/* eat.c init_uhunger() */
function _init_uhunger() {
    if (game.u) { game.u.uhunger = 900; game.u.uhs = 1; }  /* NOT_HUNGRY */
}

/* mon.c mongone(mtmp) */
function _mongone(_mtmp) {}

/* nhlobj.c nhl_push_obj(L, otmp) / nhl_obj_u_giveobj(L) */
function _nhl_push_obj(otmp) { return otmp; }
function _nhl_obj_u_giveobj(_args) { return undefined; }

/* sfstruct.c Sfo_ / Sfi_ — the save-file marshalling coverage.mjs lists as
   judge-frozen.  An NHFILE here is a plain record with named fields. */
function _Sfo_unsigned(nhfp, val, _name) { nhfp.luadata_len = val; }
function _Sfo_char(nhfp, buf, _name, _len) { nhfp.luadata = buf; }
function _Sfi_unsigned(nhfp, _name) { return nhfp.luadata_len | 0; }
function _Sfi_char(nhfp, _name, len) {
    return String(nhfp.luadata ?? '').slice(0, len);
}

/* ------------------------------------------------------------------------
 * The lua_State stand-in and the nhl_user_data that hangs off it.
 * nhlua.c:116 — one record does double duty for memory accounting and
 * instruction counting.
 * ------------------------------------------------------------------------ */

function _new_user_data() {
    return {
        L: null, flags: 0, memlimit: 0,
        steps: 0, osteps: 0, perpcall: 0,
        statctr: 0, sid: 0, name: null,
        jb: null,               /* NHL_SANDBOX: setjmp buffer */
        meminuse: 0,            /* what lua_gc(LUA_GCCOUNT*) reports */
    };
}

/* nhlua.c:137 — the pattern-matching-only instance (see the #3 comment at
   nhlua.c:2655). */
let luapat = null;

/* nhlua.c:110 */
const nhcore_call_available = new Array(NUM_NHCORE_CALLS).fill(FALSE);

/* nhlua.c:101 */
const nhcore_call_names = [
    'start_new_game',
    'restore_old_game',
    'moveloop_turn',
    'game_exit',
    'getpos_tip',
    'enter_tutorial',
    'leave_tutorial',
];

/* ------------------------------------------------------------------------
 * nhlua.c:158 — nhcore lifecycle
 * ------------------------------------------------------------------------ */

export function l_nhcore_done() {
    if (game.luacore) {
        nhl_done(game.luacore);
        game.luacore = 0;
    }
    end_luapat();
}

/* nhlua.c:169.  The nhcore.<name> lookup is a table read; when the field is not
   a function, the call is disabled FOR THE REST OF THE GAME, which is why
   nhcore_call_available[] is module state and not a local. */
export function l_nhcore_call(callidx) {
    if (callidx < 0 || callidx >= NUM_NHCORE_CALLS || !game.luacore
        || !nhcore_call_available[callidx])
        return;

    const nhcore = game.luacore.globals.nhcore;
    if (_luatype(nhcore) !== LUA_TTABLE) {
        /* impossible("nhcore is not a lua table"); */
        nhl_done(game.luacore);
        game.luacore = 0;
        return;
    }

    const fn = nhcore[nhcore_call_names[callidx]];
    const ltyp = _luatype(fn);
    if (ltyp === LUA_TFUNCTION) {
        nhl_pcall_handle(game.luacore, 0, 1, 'l_nhcore_call', NHLpa_panic, fn);
    } else {
        /* impossible("nhcore.%s is not a lua function", ...) */
        nhcore_call_available[callidx] = FALSE;
    }
}

/* nhlua.c:199.  C appends " (line N <source>)" from the Lua debug info; with no
   VM there is no currentline, so the message is what survives. */
export function nhl_error(_L, msg) {
    throw new Error(String(msg));
}

/* nhlua.c:225.  Check that the parameters are nothing but a single table, or if
   none was given, put an empty one there.  Returns the (possibly created)
   table, which is what the caller's subsequent get_table_* reads. */
export function lcheck_param_table(args) {
    const argc = args.length;

    if (argc < 1) args.push({});

    /* discard any extra arguments passed in */
    args.length = 1;

    _checktype(args[0], LUA_TTABLE, 'table expected');
    return args[0];
}

/* ------------------------------------------------------------------------
 * nhlua.c:241 — map-char accessors
 * ------------------------------------------------------------------------ */

export function get_table_mapchr(t, name) {
    const ter = get_table_str(t, name);
    const typ = check_mapchr(ter);
    if (typ === INVALID_TYPE)
        nhl_error(null, 'Erroneous map char');
    return typ;
}

export function get_table_mapchr_opt(t, name, defval) {
    const ter = get_table_str_opt(t, name, '');
    let typ;
    if (ter && ter.length) {
        typ = check_mapchr(ter);
        if (typ === INVALID_TYPE)
            nhl_error(null, 'Erroneous map char');
    } else
        typ = defval;
    return typ;
}

/* nhlua.c:274.  The names are in the same order as enum timeout_types
   (timeout.h) and timeout_funcs[] (timeout.c), spelled differently. */
export function nhl_get_timertype(v) {
    const timerstr = [
        'rot-organic', 'rot-corpse', 'revive-mon', 'zombify-mon',
        'burn-obj', 'hatch-egg', 'fig-transform', 'shrink-glob',
        'melt-ice', null,
    ];
    const ret = _checkoption(v, null, timerstr);

    if (ret < 0 || ret >= NUM_TIME_FUNCS)
        nhl_error(null, 'Unknown timer type');
    return ret;
}

/* ------------------------------------------------------------------------
 * nhlua.c:293 — table writers.  C's `lua_rawset(L, -3)` writes into the table
 * two slots down, i.e. the one the caller left on the stack; that table is the
 * explicit first argument here.
 * ------------------------------------------------------------------------ */

export function nhl_add_table_entry_int(t, name, value) {
    t[name] = value;
}

export function nhl_add_table_entry_char(t, name, value) {
    /* C Sprintf("%c") — a one-char string, not a number */
    t[name] = String.fromCharCode(value & 0xff);
}

export function nhl_add_table_entry_str(t, name, value) {
    t[name] = value;
}

export function nhl_add_table_entry_bool(t, name, value) {
    t[name] = !!value;
}

export function nhl_add_table_entry_region(t, name, x1, y1, x2, y2) {
    const sub = {};
    nhl_add_table_entry_int(sub, 'x1', x1);
    nhl_add_table_entry_int(sub, 'y1', y1);
    nhl_add_table_entry_int(sub, 'x2', x2);
    nhl_add_table_entry_int(sub, 'y2', y2);
    t[name] = sub;
}

/* ------------------------------------------------------------------------
 * nhlua.c:340 char2typ[] — special-level "map character" <-> location type.
 * ORDER IS LOAD-BEARING: the nine '-' rows mean chr2typ('-') is HWALL (the
 * first), while typ2chr(CROSSWALL) is '-' (also the first match, not 'B'), and
 * splev_typ2chr()'s loop stops at the first entry whose typ >= MAX_TYPE, so the
 * 'x'/'B'/'w' tail is unreachable from that direction.
 * ------------------------------------------------------------------------ */
const char2typ = [
    [' ', STONE],
    ['#', CORR],
    ['.', ROOM],
    ['-', HWALL],
    ['-', TLCORNER],
    ['-', TRCORNER],
    ['-', BLCORNER],
    ['-', BRCORNER],
    ['-', CROSSWALL],
    ['-', TUWALL],
    ['-', TDWALL],
    ['-', TLWALL],
    ['-', TRWALL],
    ['-', DBWALL],
    ['|', VWALL],
    ['+', DOOR],
    ['A', AIR],
    ['C', CLOUD],
    ['S', SDOOR],
    ['H', SCORR],
    ['{', FOUNTAIN],
    ['\\', THRONE],
    ['K', SINK],
    ['}', MOAT],
    ['P', POOL],
    ['L', LAVAPOOL],
    ['Z', LAVAWALL],
    ['I', ICE],
    ['W', WATER],
    ['T', TREE],
    ['F', IRONBARS],        /* Fe = iron */
    ['x', MAX_TYPE],        /* "see-through" */
    ['B', CROSSWALL],       /* hack: boundary location */
    ['w', MATCH_WALL],      /* IS_STWALL() */
    ['\0', STONE],
];

/* nhlua.c:393.  The splev_chr2typ() scan is inlined — see the header note; C's
   loop stops at the '\0' sentinel, so ' ' is the only route to STONE. */
export function check_mapchr(s) {
    if (s && s.length === 1) {
        for (let i = 0; char2typ[i][0] !== '\0'; i++)
            if (s[0] === char2typ[i][0]) return char2typ[i][1];
        return INVALID_TYPE;
    }
    return INVALID_TYPE;
}

/* nhlua.c:401 */
export function splev_typ2chr(typ) {
    for (let i = 0; char2typ[i][1] < MAX_TYPE; i++)
        if (typ === char2typ[i][1]) return char2typ[i][0];
    return 'x';
}

/* ------------------------------------------------------------------------
 * nhlua.c:416 — nh.gettrap / nh.deltrap / nh.getmap
 * ------------------------------------------------------------------------ */

/* local t = nh.gettrap(x,y);  or  nh.gettrap({ x = 10, y = 10 }); */
export function nhl_gettrap(...args) {
    const p = nhl_get_xy_params(args);
    if (!p.ok) {
        nhl_error(null, 'Incorrect arguments');
        /*NOTREACHED*/
        return undefined;
    }
    const c = { x: p.x, y: p.y };
    _cvt_to_abscoord(c);

    if (isok(c.x, c.y)) {
        const ttmp = t_at(c.x, c.y);

        if (ttmp) {
            const t = {};

            nhl_add_table_entry_int(t, 'tx', ttmp.tx);
            nhl_add_table_entry_int(t, 'ty', ttmp.ty);
            nhl_add_table_entry_int(t, 'ttyp', ttmp.ttyp);
            nhl_add_table_entry_str(t, 'ttyp_name',
                                    _get_trapname_bytype(ttmp.ttyp));
            nhl_add_table_entry_bool(t, 'tseen', ttmp.tseen);
            nhl_add_table_entry_bool(t, 'madeby_u', ttmp.madeby_u);
            nhl_add_table_entry_bool(t, 'once', ttmp.once);
            switch (ttmp.ttyp) {
            case SQKY_BOARD:
                nhl_add_table_entry_int(t, 'tnote', ttmp.tnote);
                break;
            case ROLLING_BOULDER_TRAP:
                nhl_add_table_entry_int(t, 'launchx', ttmp.launch.x);
                nhl_add_table_entry_int(t, 'launchy', ttmp.launch.y);
                nhl_add_table_entry_int(t, 'launch2x', ttmp.launch2.x);
                nhl_add_table_entry_int(t, 'launch2y', ttmp.launch2.y);
                break;
            case PIT:
            case SPIKED_PIT:
                nhl_add_table_entry_int(t, 'conjoined', ttmp.conjoined);
                break;
            }
            return t;
        } else {
            nhl_error(null, 'No trap at location');
        }
    } else {
        nhl_error(null, 'Coordinates out of range');
    }
    return undefined;
}

/* nh.deltrap(x,y); nh.deltrap({ x = 10, y = 15 }); */
export function nhl_deltrap(...args) {
    const p = nhl_get_xy_params(args);
    if (!p.ok) {
        nhl_error(null, 'Incorrect arguments');
        /*NOTREACHED*/
        return undefined;
    }
    const c = { x: p.x, y: p.y };
    _cvt_to_abscoord(c);

    if (isok(c.x, c.y)) {
        const ttmp = t_at(c.x, c.y);

        if (ttmp)
            deltrap(ttmp);
    }
    return undefined;
}

/* nhlua.c:506.  (XX,YY) or ({ x = XX, y = YY }) or ({ XX, YY }).  The values
   are NOT adjusted from what the level file said, so these are ABSOLUTE
   coordinates; every caller decides for itself whether to treat them as
   map-relative and calls cvt_to_abscoord. */
export function nhl_get_xy_params(args) {
    const argc = args.length;
    let x = 0, y = 0;
    let ret = FALSE;

    if (argc === 2) {
        x = _tointeger(args[0]);
        y = _tointeger(args[1]);
        ret = TRUE;
    } else if (argc === 1 && _luatype(args[0]) === LUA_TTABLE) {
        const c = _get_coord(args[0]);
        ret = c.ok;
        x = c.x;
        y = c.y;
    }
    return { ok: ret, x, y };
}

/* local loc = nh.getmap(x,y);  or  nh.getmap({ x = 10, y = 35 });
   C reads levl[x][y].flags, the rm.h union; this port splits that union into
   named fields (doormask / altarmask / looted), so each arm reads its own. */
export function nhl_getmap(...args) {
    const p = nhl_get_xy_params(args);
    if (!p.ok) {
        nhl_error(null, 'Incorrect arguments');
        return undefined;
    }
    const c = { x: p.x, y: p.y };
    _cvt_to_abscoord(c);

    if (isok(c.x, c.y)) {
        const loc = game.level.at(c.x, c.y);
        const t = {};

        /* FIXME: some should be boolean values */
        /* C's rm.glyph is the hero's memory of the square; this port keeps that
           as remembered_glyph/glyph_symidx rather than one packed int. */
        nhl_add_table_entry_int(t, 'glyph', loc.glyph_symidx);
        nhl_add_table_entry_int(t, 'typ', loc.typ);
        nhl_add_table_entry_str(t, 'typ_name', _levltyp_to_name(loc.typ));
        nhl_add_table_entry_str(t, 'mapchr', splev_typ2chr(loc.typ));
        nhl_add_table_entry_int(t, 'seenv', loc.seenv);
        nhl_add_table_entry_bool(t, 'horizontal', loc.horizontal);
        nhl_add_table_entry_bool(t, 'lit', loc.lit);
        nhl_add_table_entry_bool(t, 'waslit', loc.waslit);
        nhl_add_table_entry_int(t, 'roomno', loc.roomno);
        nhl_add_table_entry_bool(t, 'edge', loc.edge);
        nhl_add_table_entry_bool(t, 'candig', loc.candig);

        nhl_add_table_entry_bool(t, 'has_trap', t_at(c.x, c.y) ? 1 : 0);

        /* TODO: FIXME: levl[x][y].flags */

        const flags = {};

        if (IS_DOOR(loc.typ)) {
            const dm = loc.doormask | 0;
            nhl_add_table_entry_bool(flags, 'nodoor', (dm === D_NODOOR));
            nhl_add_table_entry_bool(flags, 'broken', (dm & D_BROKEN));
            nhl_add_table_entry_bool(flags, 'isopen', (dm & D_ISOPEN));
            nhl_add_table_entry_bool(flags, 'closed', (dm & D_CLOSED));
            nhl_add_table_entry_bool(flags, 'locked', (dm & D_LOCKED));
            nhl_add_table_entry_bool(flags, 'trapped', (dm & D_TRAPPED));
        } else if (IS_ALTAR(loc.typ)) {
            /* TODO: bits 0, 1, 2 */
            nhl_add_table_entry_bool(flags, 'shrine',
                                     ((loc.altarmask | 0) & AM_SHRINE));
        } else if (IS_THRONE(loc.typ)) {
            nhl_add_table_entry_bool(flags, 'looted',
                                     ((loc.looted | 0) & T_LOOTED));
        } else if (loc.typ === TREE) {
            nhl_add_table_entry_bool(flags, 'looted',
                                     ((loc.looted | 0) & TREE_LOOTED));
            nhl_add_table_entry_bool(flags, 'swarm',
                                     ((loc.looted | 0) & TREE_SWARM));
        } else if (IS_FOUNTAIN(loc.typ)) {
            nhl_add_table_entry_bool(flags, 'looted',
                                     ((loc.looted | 0) & F_LOOTED));
            nhl_add_table_entry_bool(flags, 'warned',
                                     ((loc.looted | 0) & F_WARNED));
        } else if (IS_SINK(loc.typ)) {
            nhl_add_table_entry_bool(flags, 'pudding',
                                     ((loc.looted | 0) & S_LPUDDING));
            nhl_add_table_entry_bool(flags, 'dishwasher',
                                     ((loc.looted | 0) & S_LDWASHER));
            nhl_add_table_entry_bool(flags, 'ring',
                                     ((loc.looted | 0) & S_LRING));
        }
        /* TODO: drawbridges, walls, ladders, room=>ICED_xxx */

        t.flags = flags;

        return t;
    } else {
        /* TODO: return zerorm instead? */
        nhl_error(null, 'Coordinates out of range');
        return undefined;
    }
}

/* ------------------------------------------------------------------------
 * nhlua.c:620 — message / prompt bindings
 * ------------------------------------------------------------------------ */

/* impossible("Error!") */
export async function nhl_impossible(...args) {
    const argc = args.length;

    if (argc === 1)
        await impossible(_checkstring(args[0]));
    else
        nhl_error(null, 'Wrong args');
    return undefined;
}

/* pline("It hits!")  /  pline("It hits!", true) */
export async function nhl_pline(...args) {
    const argc = args.length;

    if (argc === 1 || argc === 2) {
        await pline(_checkstring(args[0]));
        if (_toboolean(args[1]))
            await _display_nhwindow(WIN_MESSAGE, TRUE);  /* --more-- */
    } else
        nhl_error(null, 'Wrong args');

    return undefined;
}

/* verbalize("Fool!") */
export async function nhl_verbalize(...args) {
    const argc = args.length;

    if (argc === 1)
        await verbalize(_checkstring(args[0]));
    else
        nhl_error(null, 'Wrong args');

    return undefined;
}

/* parse_config("OPTIONS=!color") */
export function nhl_parse_config(...args) {
    const argc = args.length;

    if (argc === 1)
        parse_conf_str(_checkstring(args[0]), game.parse_config_line);
    else
        nhl_error(null, 'Wrong args');

    return undefined;
}

/* local windowtype = get_config("windowtype"); */
export function nhl_get_config(...args) {
    const argc = args.length;

    if (argc === 1)
        return _get_option_value(_checkstring(args[0]), TRUE);
    else
        nhl_error(null, 'Wrong args');

    return undefined;
}

/* str = getlin("What do you want to call this dungeon level?"); */
export function nhl_getlin(...args) {
    const argc = args.length;

    if (argc === 1)
        return _getlin(_checkstring(args[0]));

    nhl_error(null, 'Wrong args');
    /*NOTREACHED*/
    return undefined;
}

/* selected = menu("prompt", default, pickX, {"a"="option a", ...})
   pickX = 0,1,2 or "none","one","any" (PICK_X in code).  The table may also be
   an array of { key=, text= } records.
   The iteration is C's lua_next over the LAST argument; for a JS object that is
   insertion order, where Lua's hash-part order is unspecified. */
export function nhl_menu(...args) {
    const pickX = ['none', 'one', 'any'];       /* PICK_x */
    const argc = args.length;
    let defval = '';
    let pick = PICK_ONE;
    const clr = 8;                              /* color.h NO_COLOR */

    if (argc < 2 || argc > 4) {
        nhl_error(null, 'Wrong args');
        /*NOTREACHED*/
        return undefined;
    }

    const prompt = _checkstring(args[0]);
    if (typeof args[1] === 'string' || typeof args[1] === 'number')
        defval = _checkstring(args[1]);
    if (typeof args[2] === 'string' || typeof args[2] === 'number')
        pick = _checkoption(args[2], 'one', pickX);
    _checktype(args[argc - 1], LUA_TTABLE, 'table expected');
    const tbl = args[argc - 1];

    const tmpwin = _create_nhwindow(NHW_MENU);
    _start_menu(tmpwin, MENU_BEHAVE_STANDARD);

    for (const [k, v] of Object.entries(tbl)) {
        let str = '';
        let key = '';

        /* key @ index -2, value @ index -1 */
        if (_luatype(v) === LUA_TTABLE) {
            key = v.key === null || v.key === undefined ? '' : String(v.key);
            str = v.text === null || v.text === undefined ? '' : String(v.text);

            /* TODO: glyph, attr, accel, group accel (all optional) */
        } else if (typeof v === 'string' || typeof v === 'number') {
            str = _checkstring(v);
            key = _checkstring(k);
        }

        const any = { a_char: 0 };              /* cg.zeroany */
        if (key.length)
            any.a_char = key[0];
        _add_menu(tmpwin, null, any, 0, 0, 0 /* ATR_NONE */, clr, str,
                  (defval.length && key.length && defval[0] === key[0])
                      ? MENU_ITEMFLAGS_SELECTED
                      : MENU_ITEMFLAGS_NONE);
    }

    _end_menu(tmpwin, prompt);
    const sel = _select_menu(tmpwin, pick, null);
    const pick_cnt = sel.cnt;
    const picks = sel.picks;
    _destroy_nhwindow(tmpwin);

    if (pick_cnt > 0) {
        let buf0 = picks[0].item.a_char;

        if (pick === PICK_ONE && pick_cnt > 1 && defval.length
            && defval[0] === picks[0].item.a_char)
            buf0 = picks[1].item.a_char;

        return String(buf0);
        /* TODO: pick any */
    }
    /* C copies defval[0] into a 2-byte buffer, so an empty defval yields "" */
    return defval.length ? defval[0] : '';
}

/* text("foo\nbar\nbaz").  The wrap is done on a mutable char buffer: C writes a
   '\0' at the break point, so the loop's `*str` test reads the char PAST that
   NUL on the next pass.  Modelled with a char array for exactly that reason. */
export function nhl_text(...args) {
    const argc = args.length;

    if (argc > 0) {
        const tmpwin = _create_nhwindow(NHW_MENU);
        _start_menu(tmpwin, MENU_BEHAVE_STANDARD);

        for (let a = 0; a < args.length; a++) {
            const ostr = Array.from(_checkstring(args[a]));
            let ptr;
            let str = 0;
            const lstr = ostr.length - 1;

            do {
                const nlp = ostr.indexOf('\n', str);

                if (nlp >= 0 && (nlp - str) <= 76) {
                    ptr = nlp;
                } else {
                    ptr = str + 76;
                    if (ptr > lstr)
                        ptr = lstr;
                }
                while ((ptr > str) && !(ostr[ptr] === ' ' || ostr[ptr] === '\n'))
                    ptr--;
                ostr[ptr] = '\0';
                _add_menu_str(tmpwin, ostr.slice(str, ptr).join(''));
                str = ptr + 1;
            } while (ostr[str] && ostr[str] !== '\0' && str <= lstr);
        }

        _end_menu(tmpwin, null);
        _select_menu(tmpwin, PICK_NONE, null);
        _destroy_nhwindow(tmpwin);
    }
    return undefined;
}

/* ------------------------------------------------------------------------
 * nhlua.c:855 — string / RNG / query bindings.  Each of these returns 1 even
 * on the nhl_error() path, which is unreachable.
 * ------------------------------------------------------------------------ */

/* makeplural("zorkmid") */
export function nhl_makeplural(...args) {
    const argc = args.length;

    if (argc === 1)
        return makeplural(_checkstring(args[0]));
    nhl_error(null, 'Wrong args');
    return undefined;
}

/* makesingular("zorkmids") */
export function nhl_makesingular(...args) {
    const argc = args.length;

    if (argc === 1)
        return makesingular(_checkstring(args[0]));
    nhl_error(null, 'Wrong args');
    return undefined;
}

/* s_suffix("foo") */
export function nhl_s_suffix(...args) {
    const argc = args.length;

    if (argc === 1)
        return _s_suffix(_checkstring(args[0]));
    nhl_error(null, 'Wrong args');
    return undefined;
}

/* ing_suffix("foo") */
export function nhl_ing_suffix(...args) {
    const argc = args.length;

    if (argc === 1)
        return _ing_suffix(_checkstring(args[0]));
    nhl_error(null, 'Wrong args');
    return undefined;
}

/* an("foo") */
export function nhl_an(...args) {
    const argc = args.length;

    if (argc === 1)
        return _an(_checkstring(args[0]));
    nhl_error(null, 'Wrong args');
    return undefined;
}

/* rn2(10) */
export function nhl_rn2(...args) {
    const argc = args.length;

    if (argc === 1)
        return rn2(_checkinteger(args[0]));
    nhl_error(null, 'Wrong args');
    return undefined;
}

/* random(10) is rn2(10);  random(5,8) is 5 + rn2(8) */
export function nhl_random(...args) {
    const argc = args.length;

    if (argc === 1)
        return rn2(_checkinteger(args[0]));
    else if (argc === 2)
        return _checkinteger(args[0]) + rn2(_checkinteger(args[1]));
    nhl_error(null, 'Wrong args');
    return undefined;
}

/* level_difficulty() */
export function nhl_level_difficulty(...args) {
    const argc = args.length;
    if (argc === 0)
        return level_difficulty_c();
    nhl_error(null, 'level_difficulty should not have any args');
    return undefined;
}

/* local x = nh.is_genocided("vampire") */
export function nhl_is_genocided(...args) {
    const argc = args.length;

    if (argc === 1) {
        const paramstr = _checkstring(args[0]);
        const { pm: i } = _name_to_mon(paramstr);

        /* mons.h G_GENOD */
        return (i !== -1 && ((game.mvitals?.[i]?.mvflags ?? 0) & 0x02))
            ? TRUE : FALSE;
    }
    nhl_error(null, 'Wrong args');
    return undefined;
}

/* local debug_themerm = nh.debug_themerm(isfill)
   isfill false -> $THEMERM, true -> $THEMERMFILL; nil unless in wizard mode and
   the variable is set.  There is no process environment here, so the lookup
   goes through the debug hooks the port already keys off game. */
export function nhl_get_debug_themerm_name(...args) {
    const argc = args.length;
    if (argc === 1) {
        let dbg_themerm = null;
        const is_fill = _toboolean(args[0]);
        if (game.flags?.debug)
            dbg_themerm = is_fill ? (game.env_THEMERMFILL ?? null)
                                  : (game.env_THEMERM ?? null);
        if (!dbg_themerm || !dbg_themerm.length)
            return null;                        /* lua_pushnil */
        return dbg_themerm;
    }
    nhl_error(null, 'debug_themerm should have 1 boolean arg');
    return undefined;
}

/* ------------------------------------------------------------------------
 * nhlua.c:1017 — the get_table_* accessors.  Every one is "read the named
 * field of the table on top of the stack, then pop it", so the table is the
 * explicit first argument here.
 * ------------------------------------------------------------------------ */

/* get mandatory integer value from table */
export function get_table_int(t, name) {
    return _checkinteger(t?.[name], name);
}

/* get optional integer value from table */
export function get_table_int_opt(t, name, defval) {
    let ret = defval;

    const v = t?.[name];
    if (_luatype(v) !== LUA_TNIL)
        ret = _checkinteger(v, name);
    return ret;
}

export function get_table_str(t, name) {
    return _checkstring(t?.[name], name);
}

/* get optional string value from table.  C's return must be freed by the
   caller; the LUA_TFUNCTION arm calls the field and uses its result. */
export function get_table_str_opt(t, name, defval) {
    let ret;
    const v = t?.[name];
    const ltyp = _luatype(v);

    if (ltyp === LUA_TSTRING || ltyp === LUA_TNIL) {
        ret = _optstring(v, defval);
    } else if (ltyp === LUA_TFUNCTION) {
        /* C calls the field and lets luaL_optstring read what it LEFT on the
           stack, not the pcall status; st.retval is that value. */
        const st = { errmsg: null, retval: null };
        nhl_pcall_handle(st, 0, 1, 'get_table_str_opt', NHLpa_panic, v);
        ret = _optstring(st.retval, defval);
    } else {
        nhl_error(null, 'get_table_str_opt: no string');
    }
    if (ret !== null && ret !== undefined)
        return ret;
    return null;
}

export function get_table_boolean(t, name) {
    const boolstr = ['true', 'false', 'yes', 'no', null];
    /* static const int boolstr2i[] = { TRUE, FALSE, TRUE, FALSE, -1 };
       C never uses it: the returned INDEX is what the caller gets, so "yes"
       yields 2, not 1.  Kept as written. */
    let ret = -1;

    const v = t?.[name];
    const ltyp = _luatype(v);
    if (ltyp === LUA_TSTRING) {
        ret = _checkoption(v, null, boolstr);
    } else if (ltyp === LUA_TBOOLEAN) {
        ret = _toboolean(v) ? 1 : 0;
    } else if (ltyp === LUA_TNUMBER) {
        ret = _checkinteger(v, name);
        if (ret < 0 || ret > 1)
            ret = -1;
    }
    if (ret === -1)
        nhl_error(null, 'Expected a boolean');
    return ret;
}

export function get_table_boolean_opt(t, name, defval) {
    const ret = defval;

    if (_luatype(t?.[name]) !== LUA_TNIL)
        return get_table_boolean(t, name);
    return ret;
}

/* opts[] is a null-terminated list */
export function get_table_option(t, name, defval, opts) {
    return _checkoption(t?.[name], defval, opts);
}

/* ------------------------------------------------------------------------
 * nhlua.c:1138 — name/number lookups
 * ------------------------------------------------------------------------ */

/* local fname = dump_fmtstr("/tmp/nethack.%n.%d.log");  (DUMPLOG only) */
export function nhl_dump_fmtstr(...args) {
    const argc = args.length;

    if (argc === 1)
        return _dump_fmtstr(_checkstring(args[0]), TRUE);
    nhl_error(null, 'Expected a string parameter');
    return undefined;
}

/* local dungeon_name = dnum_name(u.dnum); */
export function nhl_dnum_name(...args) {
    const argc = args.length;

    if (argc === 1) {
        const dnum = _checkinteger(args[0]);

        if (dnum >= 0 && dnum < (game.n_dgns ?? 0))
            return game.dungeons[dnum].dname;
        return '';
    }
    nhl_error(null, 'Expected an integer parameter');
    return undefined;
}

/* gender-neutral monster type name by integer, "" outside LOW_PM..HIGH_PM.
   local montypename = int_to_pmname(12); */
export function nhl_int_to_pm_name(...args) {
    const argc = args.length;

    if (argc === 1) {
        const i = _checkinteger(args[0]);

        if (i >= LOW_PM && i <= HIGH_PM)
            return monster_by_pmidx(i)?.name;  /* mons[i].pmnames[NEUTRAL] */
        return '';
    }
    nhl_error(null, 'Expected an integer parameter');
    return undefined;
}

/* drawing.c def_oc_syms[].sym, indexed by oclass (defsym.h OBJCLASS) */
const def_oc_syms = [
    '\0', ']', ')', '[', '=', '"', '(', '%', '!', '?', '+', '/', '$', '*',
    '`', '0', '_', '.',
];

/* convert integer to object type name and class.
   local oname,oclass = int_to_objname(25);  -> [name, sym] here, as C pushes 2 */
export function nhl_int_to_obj_name(...args) {
    const argc = args.length;

    if (argc === 1) {
        const i = _checkinteger(args[0]);

        if (i >= 0 && i < NUM_OBJECTS && objects[i] && objects[i].name) {
            return [objects[i].name, def_oc_syms[objects[i].oc_class] ?? '\0'];
        }
        return ['', ''];
    }
    nhl_error(null, 'Expected an integer parameter');
    return undefined;
}

/* ------------------------------------------------------------------------
 * nhlua.c:1221 — nh.variable(): game-state-saved Lua variables.
 *
 * C keeps them in the nhcore state's `nh_lua_variables` global and copies
 * values BETWEEN two Lua states, which is why every branch is duplicated for
 * get and set.  A table value cannot be copied slot-by-slot, so C serialises it
 * with dat/nhlib.lua's table_stringify() and re-executes the source in the
 * other state; _lua_table_roundtrip() below performs that trip's observable
 * effect, which is lossy in exactly two ways table_stringify() is: every key
 * comes back as a STRING (it writes ["<key>"]=), and functions/userdata are
 * dropped.
 * ------------------------------------------------------------------------ */

function _lua_table_roundtrip(v) {
    /* dat/nhlib.lua:157 table_stringify() */
    switch (_luatype(v)) {
    case LUA_TTABLE: {
        const out = {};
        for (const [k, val] of Object.entries(v)) {
            const t = _luatype(val);
            if (t === LUA_TTABLE || t === LUA_TSTRING || t === LUA_TBOOLEAN
                || t === LUA_TNUMBER)
                out[String(k)] = _lua_table_roundtrip(val);
        }
        return out;
    }
    default:
        return v;
    }
}

/* nh.variable("test", 10);  local ten = nh.variable("test"); */
export function nhl_variable(...args) {
    const argc = args.length;

    if (!game.luacore) {
        _panic('nh luacore not inited');
        /*NOTREACHED*/
        return undefined;
    }

    const vars = game.luacore.globals.nh_lua_variables;
    if (_luatype(vars) !== LUA_TTABLE) {
        _impossible('nh_lua_variables is not a lua table');
        return undefined;
    }

    if (argc === 1) {
        const key = _checkstring(args[0]);

        const v = vars[key];
        const typ = _luatype(v);
        if (typ === LUA_TSTRING)
            return v;
        else if (typ === LUA_TNIL)
            return null;
        else if (typ === LUA_TBOOLEAN)
            return _toboolean(v);
        else if (typ === LUA_TNUMBER)
            return _tointeger(v);
        else if (typ === LUA_TTABLE)
            return _lua_table_roundtrip(v);
        else
            nhl_error(null, 'Cannot get variable of that type');
        return undefined;
    } else if (argc === 2) {
        /* set nh_lua_variables[key] = value; */
        const key = _checkstring(args[0]);
        const val = args[argc - 1];
        const typ = _luatype(val);

        if (typ === LUA_TSTRING) {
            vars[key] = _checkstring(val);
        } else if (typ === LUA_TNIL) {
            vars[key] = null;
        } else if (typ === LUA_TBOOLEAN) {
            vars[key] = _toboolean(val);
        } else if (typ === LUA_TNUMBER) {
            vars[key] = _tointeger(val);
        } else if (typ === LUA_TTABLE) {
            vars[key] = _lua_table_roundtrip(val);
        } else
            nhl_error(null, 'Cannot set variable of that type');
        return undefined;
    }
    nhl_error(null, 'Wrong number of arguments');
    return undefined;
}

/* nhlua.c:1297 — return the nh_lua_variables table as a Lua source string.
   NB the global it looks up is `get_variables_string`, which dat/nhlib.lua does
   NOT define (it defines nh_get_variables_string).  So the type test fails, the
   body is skipped, and this ALWAYS returns NULL upstream — which is why
   save_luadata() below writes a 1-byte empty string every time. */
export function get_nh_lua_variables() {
    let key = null;

    if (!game.luacore) {
        _panic('nh luacore not inited');
        /*NOTREACHED*/
        return key;
    }
    const fn = game.luacore.globals.get_variables_string;
    if (_luatype(fn) === LUA_TFUNCTION) {
        const r = nhl_pcall_handle(game.luacore, 0, 1, 'get_nh_lua_variables',
                                   NHLpa_impossible, fn);
        if (r) {
            return key;
        }
        key = String(game.luacore.retval);
    }
    return key;
}

/* save nh_lua_variables table to file */
export function save_luadata(nhfp) {
    let lua_data = get_nh_lua_variables();      /* note: '\0' terminated */

    if (!lua_data)
        lua_data = '';
    const lua_data_len = lua_data.length + 1;   /* +1: include the terminator */
    _Sfo_unsigned(nhfp, lua_data_len, 'luadata-lua_data_len');
    _Sfo_char(nhfp, lua_data, 'luadata', lua_data_len);
}

/* restore nh_lua_variables table from file */
export function restore_luadata(nhfp) {
    const lua_data_len = _Sfi_unsigned(nhfp, 'luadata-lua_data_len');
    const lua_data = _Sfi_char(nhfp, 'luadata', lua_data_len);

    if (!game.luacore)
        _l_nhcore_init_ref();
    /* luaL_loadstring(gl.luacore, lua_data) + nhl_pcall_handle(): the blob is
       Lua source of the form `nh_lua_variables["k"]={...};`.  With no VM the
       assignment cannot be executed; the surrounding control flow is what is
       translated.  See the get_nh_lua_variables() note — upstream this blob is
       always the empty string. */
    game.luacore.pending_luadata = lua_data;
    nhl_pcall_handle(game.luacore, 0, 0, 'restore_luadata', NHLpa_panic, null);
}

/* allmain.c l_nhcore_init() is js/mklev.js:316; reached through game so this
   file adds no second definition of the name and stays import-cycle free. */
function _l_nhcore_init_ref() {
    if (game.l_nhcore_init) game.l_nhcore_init();
    else game.luacore = nhl_init({ flags: NHL_SB_SAFE, memlimit: 1024 * 1024,
                                   steps: 0, perpcall: 1024 * 1024 });
}

/* ------------------------------------------------------------------------
 * nhlua.c:1369 — level / turn / debug bindings
 * ------------------------------------------------------------------------ */

/* local stairs = stairways();  Lua arrays start at 1, so index 0 is unused. */
export function nhl_stairways() {
    let tmp = game.stairs;
    let i = 1;

    const arr = [];

    while (tmp) {
        const t = {};

        nhl_add_table_entry_bool(t, 'up', tmp.up);
        nhl_add_table_entry_bool(t, 'ladder', tmp.isladder);
        nhl_add_table_entry_int(t, 'x', tmp.sx);
        nhl_add_table_entry_int(t, 'y', tmp.sy);
        nhl_add_table_entry_int(t, 'dnum', tmp.tolev.dnum);
        nhl_add_table_entry_int(t, 'dlevel', tmp.tolev.dlevel);

        arr[i] = t;

        tmp = tmp.next;
        i++;
    }

    return arr;
}

/* test( { x = 123, y = 456 } ) */
export async function nhl_test(...args) {
    const Player = 'Player';

    /* discard any extra arguments passed in */
    args.length = 1;

    _checktype(args[0], LUA_TTABLE, 'table expected');

    const x = get_table_int(args[0], 'x');
    const y = get_table_int(args[0], 'y');
    const name = get_table_str_opt(args[0], 'name', Player);

    await pline(`TEST:{ x=${x}, y=${y}, name="${name}" }`);

    return undefined;
}

/* push a key into the command queue.  nh.pushkey("i"); */
export function nhl_pushkey(...args) {
    const argc = args.length;

    if (argc === 1) {
        const key = _checkstring(args[0]);

        for (let i = 0; i < key.length; i++)
            cmdq_add_key(CQ_CANNED, key[i]);
    }

    return undefined;
}

/* do a turn of moveloop, or until gm.multi is done if the param is true. */
export async function nhl_doturn(...args) {
    const argc = args.length;
    let domulti = FALSE;

    if (argc === 1)
        domulti = _toboolean(args[0]);

    do {
        await moveloop_core();
    } while (domulti && game.multi);

    return undefined;
}

/* nh.debug_flags({ mongen = false, hunger = false,
                    overwrite_stairs = true });  debugging use only. */
export function nhl_debug_flags(...args) {
    let val;

    const t = lcheck_param_table(args);
    const iflags = (game.iflags ||= {});

    /* disable monster generation */
    val = get_table_boolean_opt(t, 'mongen', -1);
    if (val !== -1) {
        iflags.debug_mongen = !val;             /* value in lua is negated */
        if (iflags.debug_mongen) {
            /* C walks fmon with an nmon lookahead because mongone() unlinks;
               this port's fmon is an array, so iterate a copy for the same
               reason. */
            for (const mtmp of [...(game.fmon || game.level?.monsters || [])]) {
                if ((mtmp.mhp ?? 0) < 1)        /* DEADMONSTER() */
                    continue;
                _mongone(mtmp);
            }
        }
    }

    /* prevent hunger */
    val = get_table_boolean_opt(t, 'hunger', -1);
    if (val !== -1) {
        iflags.debug_hunger = !val;             /* value in lua is negated */
    }

    /* allow overwriting stairs */
    val = get_table_boolean_opt(t, 'overwrite_stairs', -1);
    if (val !== -1) {
        iflags.debug_overwrite_stairs = !!val;
    }

    /* prevent pline going out to the UI */
    val = get_table_boolean_opt(t, 'prevent_pline', -1);
    if (val !== -1) {
        iflags.debug_prevent_pline = !!val;
    }

    return undefined;
}

/* nh.flip_level(n).  C passes flip_level(flp, !gi.in_mklev); this port's
   flip_level takes only flp and reads in_mklev itself. */
export function nhl_flip_level(...args) {
    const argc = args.length;
    let flp = 0;

    if (argc === 1)
        flp = _tointeger(args[0]);

    flip_level(flp, !game.in_mklev);

    return undefined;
}

/* ------------------------------------------------------------------------
 * nhlua.c:1528 — position timers.  All four read the timer type off the TOP of
 * the stack (the LAST argument) and pop it before parsing the coordinates, so
 * here the trailing argument(s) are split off first.
 * ------------------------------------------------------------------------ */

/* local has_melttimer = nh.has_timer_at(x,y, "melt-ice"); */
export function nhl_timer_has_at(...args) {
    let ret = FALSE;
    const timertype = nhl_get_timertype(args[args.length - 1]);

    args.pop();                                 /* remove timertype */
    const p = nhl_get_xy_params(args);
    if (!p.ok) {
        nhl_error(null, 'nhl_timer_has_at: Wrong args');
        /*NOTREACHED*/
        return undefined;
    }

    const c = { x: p.x, y: p.y };
    _cvt_to_abscoord(c);

    if (isok(c.x, c.y)) {
        const when = _spot_time_expires(c.x, c.y, timertype);
        ret = (when > 0);
    }
    return ret;
}

/* local melttime = nh.peek_timer_at(x,y, "melt-ice"); */
export function nhl_timer_peek_at(...args) {
    let when = 0;
    const timertype = nhl_get_timertype(args[args.length - 1]);

    args.pop();                                 /* remove timertype */
    const p = nhl_get_xy_params(args);
    if (!p.ok) {
        nhl_error(null, 'nhl_timer_peek_at: Wrong args');
        /*NOTREACHED*/
        return undefined;
    }

    const c = { x: p.x, y: p.y };
    _cvt_to_abscoord(c);

    if (_timer_is_pos(timertype) && isok(c.x, c.y))
        when = _spot_time_expires(c.x, c.y, timertype);
    return when;
}

/* nh.stop_timer_at(x,y, "melt-ice"); */
export function nhl_timer_stop_at(...args) {
    const timertype = nhl_get_timertype(args[args.length - 1]);

    args.pop();                                 /* remove timertype */
    const p = nhl_get_xy_params(args);
    if (!p.ok) {
        nhl_error(null, 'nhl_timer_stop_at: Wrong args');
        /*NOTREACHED*/
        return undefined;
    }

    const c = { x: p.x, y: p.y };
    _cvt_to_abscoord(c);

    if (_timer_is_pos(timertype) && isok(c.x, c.y))
        _spot_stop_timers(c.x, c.y, timertype);
    return undefined;
}

/* nh.start_timer_at(x,y, "melt-ice", 10) — timertype is at -2, `when` at -1. */
export function nhl_timer_start_at(...args) {
    const timertype = nhl_get_timertype(args[args.length - 2]);
    const when = _tointeger(args[args.length - 1]);

    args.length = Math.max(0, args.length - 2);  /* remove when and timertype */
    const p = nhl_get_xy_params(args);
    if (!p.ok) {
        nhl_error(null, 'nhl_timer_start_at: Wrong args');
        /*NOTREACHED*/
        return undefined;
    }

    const c = { x: p.x, y: p.y };
    _cvt_to_abscoord(c);

    if (_timer_is_pos(timertype) && isok(c.x, c.y)) {
        const where = (c.x << 16) | c.y;

        _spot_stop_timers(c.x, c.y, timertype);
        _start_timer(when, TIMER_LEVEL, MELT_ICE_AWAY, _long_to_any(where));
    }
    return undefined;
}

/* the visual form of the key bound to an extended command, or the ext cmd name
   when it is bound to none.  local helpkey = eckey("help"); */
export function nhl_get_cmd_key(...args) {
    const argc = args.length;

    if (argc === 1) {
        const cmd = _checkstring(args[0]);
        return _cmd_from_ecname(cmd);
    }

    return undefined;
}

/* add or remove a lua function callback.
   callback("level_enter", "function_name"[, true]) */
export function nhl_callback(...args) {
    const argc = args.length;
    let i;
    let rm, fn, cb;

    if (!game.luacore) {
        _panic('nh luacore not inited');
        /*NOTREACHED*/
        return undefined;
    }
    if (argc === 2 || argc === 3) {
        if (argc === 2) {
            rm = FALSE;
            fn = _checkstring(args[argc - 1]);
            cb = _checkstring(args[argc - 2]);
        } else {
            rm = _toboolean(args[argc - 1]);
            fn = _checkstring(args[argc - 2]);
            cb = _checkstring(args[argc - 3]);
        }
        for (i = 0; i < NUM_NHCB; i++)
            if (cb === nhcb_name[i])
                break;
        if (i >= NUM_NHCB)
            return undefined;

        const counts = (game.nhcb_counts ||= new Array(NUM_NHCB).fill(0));
        if (rm) {
            counts[i]--;
            if (counts[i] < 0)
                _impossible('nh.callback counts are wrong');
        } else {
            counts[i]++;
        }

        const setter = game.luacore.globals[rm ? 'nh_callback_rm'
                                               : 'nh_callback_set'];
        nhl_pcall_handle(game.luacore, 2, 0, 'nhl_callback', NHLpa_panic,
                         setter, cb, fn);
    }
    return undefined;
}

/* ------------------------------------------------------------------------
 * nhlua.c:1722 — store or restore game state (the tutorial's save point).
 * Handles the turn counter, hero inventory and hunger, `struct u` (attributes,
 * skills, conducts), object discoveries, and the mongen/vanquished stats.
 * Would not survive a real save+restore, which is why #save is disabled inside
 * the tutorial.
 *   gamestate();      -- save state
 *   gamestate(true);  -- restore state
 * C moves objects between two nobj chains; this port's invent is an array, so
 * the sequestered list gg.gmst_invent is one too and the moves keep C's order.
 * ------------------------------------------------------------------------ */
export async function nhl_gamestate(...args) {
    let wornmask;
    let otmp;
    const argc = args.length;
    const reststate = (argc > 0) ? _toboolean(args[argc - 1]) : FALSE;
    let otyp;
    const gg = (game.gg ||= {});
    const u = game.u;

    if (reststate && gg.gmst_stored) {
        const cur_uz = u.uz, cur_uz0 = u.uz0;

        /* restore game state */
        game.moves = gg.gmst_moves;
        await pline(`Resetting time to move #${game.moves}.`);
        gg.gmst_moves = 0;

        game.lastinvnr = 51;
        while (game.invent.length)
            useupall(game.invent[0]);
        while ((otmp = gg.gmst_invent?.[0]) !== undefined) {
            wornmask = otmp.owornmask;
            otmp.owornmask = 0;
            extract_nobj(otmp, gg.gmst_invent);
            addinv_nomerge(otmp);
            if (wornmask)
                _setworn(otmp, wornmask);
        }
        game.u = { ...gg.gmst_ubak };            /* memcpy(&u, gmst_ubak) */
        game.disco = [...gg.gmst_disco];
        game.mvitals = gg.gmst_mvitals.map((m) => ({ ...m }));
        /* clear user-given object type names */
        for (otyp = 0; otyp < NUM_OBJECTS; otyp++)
            if (objects[otyp].oc_uname) {
                objects[otyp].oc_uname = null;
            }
        /* some restored state would confuse the level change in progress */
        game.u.uz = cur_uz; game.u.uz0 = cur_uz0;
        _init_uhunger();
        free_tutorial();                         /* release gg.gmst_XYZ */
        gg.gmst_stored = FALSE;
        game.spl_book = [...gg.gmst_spl_book];
    } else if (!reststate && !gg.gmst_stored) {
        /* store game state */
        gg.gmst_moves = game.moves;
        gg.gmst_invent ||= [];
        while ((otmp = game.invent[0]) !== undefined) {
            wornmask = otmp.owornmask;
            _setnotworn(otmp);
            freeinv(otmp);
            otmp.owornmask = wornmask;           /* flag for later restore */
            gg.gmst_invent.unshift(otmp);        /* otmp->nobj = gmst_invent */
        }
        game.lastinvnr = 51;   /* next inv letter to try to use will be 'a' */
        gg.gmst_ubak = { ...u };
        gg.gmst_disco = [...(game.disco || [])];
        gg.gmst_mvitals = (game.mvitals || []).map((m) => ({ ...m }));
        gg.gmst_spl_book = [...(game.spl_book || [])];
        game.spl_book = [];
        gg.gmst_stored = TRUE;
    } else {
        _impossible(`nhl_gamestate: inconsistent state (${
            reststate ? 'restore' : 'save'} vs ${
            gg.gmst_stored ? 'already stored' : 'not stored'})`);
    }
    update_inventory();
    return undefined;
}

/* nhlua.c:1809 — free the state allocated on tutorial entry; called on a normal
   tutorial exit and when the player quits inside it. */
export function free_tutorial() {
    let otmp;
    const gg = (game.gg ||= {});

    /* for normal tutorial exit, gmst_invent will already be Null */
    while ((otmp = gg.gmst_invent?.[0]) !== undefined) {
        /* set otmp->where = OBJ_FREE, otmp->nobj = NULL */
        extract_nobj(otmp, gg.gmst_invent);
        /* for the sequestered items owornmask is a re-wear FLAG, not a claim
           that they are worn now; clear it so obfree() does not complain about
           deleting a worn obj */
        otmp.owornmask = 0;
        /* dealloc_obj() isn't enough: for containers it assumes the caller has
           already freed the contents */
        obfree(otmp, null);
    }

    if (gg.gmst_ubak) gg.gmst_ubak = null;
    if (gg.gmst_disco) gg.gmst_disco = null;
    if (gg.gmst_mvitals) gg.gmst_mvitals = null;
}

/* called from gotolevel(do.c) */
export function tutorial(entering) {
    l_nhcore_call(entering ? NHCORE_ENTER_TUTORIAL : NHCORE_LEAVE_TUTORIAL);

    if (!entering) {   /* after leaving, can't go back */
        nhcore_call_available[NHCORE_ENTER_TUTORIAL] = FALSE;
        nhcore_call_available[NHCORE_LEAVE_TUTORIAL] = FALSE;
    }
}

/* ------------------------------------------------------------------------
 * nhlua.c:1848 — the registration tables.  Array-of-pairs, exactly the shape
 * of C's luaL_Reg[] / nhl_consts[], with the trailing { NULL, NULL } dropped.
 * ------------------------------------------------------------------------ */
const nhl_functions = [
    ['test', nhl_test],

    ['getmap', nhl_getmap],
    /* { "setmap", nhl_setmap } is #if 0 upstream */
    ['gettrap', nhl_gettrap],
    ['deltrap', nhl_deltrap],

    ['has_timer_at', nhl_timer_has_at],
    ['peek_timer_at', nhl_timer_peek_at],
    ['stop_timer_at', nhl_timer_stop_at],
    ['start_timer_at', nhl_timer_start_at],

    /* sp_lev.c:4811 nhl_abs_coord */
    ['abscoord', null],

    ['impossible', nhl_impossible],
    ['pline', nhl_pline],
    ['verbalize', nhl_verbalize],
    ['menu', nhl_menu],
    ['text', nhl_text],
    ['getlin', nhl_getlin],
    ['eckey', nhl_get_cmd_key],
    ['callback', nhl_callback],
    ['gamestate', nhl_gamestate],

    ['makeplural', nhl_makeplural],
    ['makesingular', nhl_makesingular],
    ['s_suffix', nhl_s_suffix],
    ['ing_suffix', nhl_ing_suffix],
    ['an', nhl_an],
    ['rn2', nhl_rn2],
    ['random', nhl_random],
    ['level_difficulty', nhl_level_difficulty],
    ['is_genocided', nhl_is_genocided],
    ['debug_themerm', nhl_get_debug_themerm_name],
    ['parse_config', nhl_parse_config],
    ['get_config', nhl_get_config],
    ['get_config_errors', l_get_config_errors],
    ['dump_fmtstr', nhl_dump_fmtstr],           /* DUMPLOG */
    ['dnum_name', nhl_dnum_name],
    ['int_to_pmname', nhl_int_to_pm_name],
    ['int_to_objname', nhl_int_to_obj_name],
    ['variable', nhl_variable],
    ['stairways', nhl_stairways],
    ['pushkey', nhl_pushkey],
    ['doturn', nhl_doturn],
    ['debug_flags', nhl_debug_flags],
    ['flip_level', nhl_flip_level],
];

const nhl_consts = [
    ['COLNO', COLNO],
    ['ROWNO', ROWNO],
    ['NUMMONS', NUMMONS],
    ['LOW_PM', LOW_PM],
    ['HIGH_PM', HIGH_PM],
    ['FIRST_OBJECT', FIRST_OBJECT],
    ['LAST_OBJECT', NUM_OBJECTS - 1],
    ['DLB', 1],   /* the recorder build adds -DDLB; see js/dlb.js */
];

/* register and init the constants table */
export function init_nhc_data(L) {
    const t = {};

    for (let i = 0; i < nhl_consts.length; i++)
        t[nhl_consts[i][0]] = nhl_consts[i][1];

    L.globals.nhc = t;
}

/* nhlua.c:1940.  C stuffs the value through an `anything` first, which is what
   truncates it to the field's width; ANY_INT/UCHAR/SCHAR are the three widths
   nhl_meta_u_index needs.  The FIXME at nhlua.c:1999 is about exactly this:
   ANY_SCHAR through a_schar keeps a sign, ANY_UCHAR does not. */
export function nhl_push_anything(L, anytype, src) {
    const any = {};

    switch (anytype) {
    case ANY_INT:
        any.a_int = src | 0;
        return any.a_int;
    case ANY_UCHAR:
        any.a_uchar = src & 0xff;
        return any.a_uchar;
    case ANY_SCHAR:
        any.a_schar = (src << 24) >> 24;
        return any.a_schar;
    }
    return undefined;
}

/* nhlua.c:1964 — the `u` table's __index.  Each row is [name, getter, type];
   C stores a POINTER into `struct u`, which a JS object cannot, so the getter
   reads the same field. */
export function nhl_meta_u_index(L, tkey_in) {
    const u = game.u ?? {};
    const ustruct = [
        ['ux', () => u.ux, ANY_UCHAR],
        ['uy', () => u.uy, ANY_UCHAR],
        ['dx', () => u.dx, ANY_SCHAR],
        ['dy', () => u.dy, ANY_SCHAR],
        ['dz', () => u.dz, ANY_SCHAR],
        ['tx', () => u.tx, ANY_UCHAR],
        ['ty', () => u.ty, ANY_UCHAR],
        ['ulevel', () => u.ulevel, ANY_INT],
        ['ulevelmax', () => u.ulevelmax, ANY_INT],
        ['uhunger', () => u.uhunger, ANY_INT],
        ['nv_range', () => u.nv_range, ANY_INT],
        ['xray_range', () => u.xray_range, ANY_INT],
        ['umonster', () => u.umonster, ANY_INT],
        ['umonnum', () => u.umonnum, ANY_INT],
        ['mh', () => u.mh, ANY_INT],
        ['mhmax', () => u.mhmax, ANY_INT],
        ['mtimedone', () => u.mtimedone, ANY_INT],
        ['dlevel', () => u.uz?.dlevel, ANY_SCHAR],   /* actually coordxy */
        ['dnum', () => u.uz?.dnum, ANY_SCHAR],       /* actually coordxy */
        ['uluck', () => u.uluck, ANY_SCHAR],
        ['uhp', () => u.uhp, ANY_INT],
        ['uhpmax', () => u.uhpmax, ANY_INT],
        ['uen', () => u.uen, ANY_INT],
        ['uenmax', () => u.uenmax, ANY_INT],
    ];
    const tkey = _checkstring(tkey_in);

    /* FIXME: doesn't really work, eg. negative values for u.dx */
    for (let i = 0; i < ustruct.length; i++)
        if (tkey === ustruct[i][0])
            return nhl_push_anything(L, ustruct[i][2], ustruct[i][1]() ?? 0);

    if (tkey === 'inventory') {
        return _nhl_push_obj(game.invent);
    } else if (tkey === 'role') {
        return game.urole?.name?.m;
    } else if (tkey === 'moves') {
        return game.moves;
    } else if (tkey === 'uhave_amulet') {
        return u.uhave?.amulet ? 1 : 0;
    } else if (tkey === 'depth') {
        return depth(u.uz);
    } else if (tkey === 'invocation_level') {
        return !!Invocation_lev(u.uz);
    }

    nhl_error(L, 'Unknown u table index');
    /*NOTREACHED*/
    return undefined;
}

export function nhl_meta_u_newindex(L) {
    nhl_error(L, 'Cannot set u table values');
    /*NOTREACHED*/
    return undefined;
}

export function nhl_u_clear_inventory() {
    while (game.invent.length)
        useupall(game.invent[0]);
    return undefined;
}

/* Put object into player's inventory.  u.giveobj(obj.new("rock")); */
export function nhl_u_giveobj(...args) {
    return _nhl_obj_u_giveobj(args);
}

const nhl_u_functions = [
    ['clear_inventory', nhl_u_clear_inventory],
    ['giveobj', nhl_u_giveobj],
];

export function init_u_data(L) {
    const t = {};
    for (const [name, fn] of nhl_u_functions) t[name] = fn;
    /* the metatable: __index / __newindex.  Recorded on the table rather than
       installed, since a plain JS object has no metatable protocol. */
    t.__index = nhl_meta_u_index;
    t.__newindex = nhl_meta_u_newindex;
    L.globals.u = t;
}

/* nhlua.c:2078 — #ifdef notyet.  Returns 1 on the error path, 0 on success. */
export function nhl_set_package_path(L, path) {
    const pkg = L.globals.package;
    if (_luatype(pkg) !== LUA_TTABLE) {
        _impossible('package not a table in nhl_set_package_path');
        return 1;
    }
    pkg.path = path;
    return 0;
}

/* ------------------------------------------------------------------------
 * nhlua.c:2092 — pcall plumbing, memory + instruction limits.
 * ------------------------------------------------------------------------ */

/* luaL_traceback() of the error message.  With no VM there is no call stack to
   walk, so the message is the whole traceback. */
export function traceback_handler(L) {
    /* TODO: call impossible() if fuzzing? */
    return L?.errmsg ?? '';
}

/* lua_gc(LUA_GCCOUNT) is in KiB, LUA_GCCOUNTB is the remainder in bytes. */
export function nhl_getmeminuse(L) {
    const nud = L?.ud;
    const bytes = nud?.meminuse ?? 0;
    const count = Math.floor(bytes / 1024), countb = bytes % 1024;
    return count * 1024 + countb;
}

/* lua_pcall with our traceback handler plus memory and instruction-step
   limiting.  On error the traceback is left on top of the stack; here it lands
   in L.errmsg and the return value is the nonzero lua_pcall status.
   `fn` and `fnargs` stand in for the function+arguments C already pushed. */
export function nhl_pcall(L, nargs, nresults, name, fn, ...fnargs) {
    const nud = L?.ud;
    let rv;

    if (nud && name) {
        nud.name = name;
    }
    /* NB: We don't need to deal with nud->memlimit - Lua handles that. */
    if (nud && (nud.steps || nud.perpcall)) {
        if (nud.perpcall) {
            nud.steps = nud.perpcall;
            nud.statctr = 0;
        }
        /* setjmp(nud->jb): nhl_hookfn() longjmps here when the step budget runs
           out, and C then panics because the game state may be corrupt. */
        nud.jb = { name };
    }

    if (_luatype(fn) !== LUA_TFUNCTION) {
        rv = 2;                                  /* LUA_ERRRUN */
        if (L) L.errmsg = 'attempt to call a non-function value';
    } else {
        try {
            const r = fn(...fnargs);
            if (L) L.retval = r;
            rv = LUA_OK;
        } catch (e) {
            if (L) L.errmsg = String(e?.message ?? e);
            rv = 2;                              /* LUA_ERRRUN */
        }
    }

    if (nud && nud.perpcall && game.loglua) {
        const ic = nud.statctr * NHL_SB_STEPSIZE;   // an approximation
        _livelog_printf(`LUASTATS PCAL ${nud.sid}:${nud.name} ${ic}`);
    }
    if (nud && nud.memlimit && game.loglua) {
        _livelog_printf(`LUASTATS PMEM ${nud.sid}:${nud.name} ${
            nhl_getmeminuse(L)}`);
    }
    return rv;
}

/* livelog.c livelog_printf(LL_DEBUG, ...) */
function _livelog_printf(line) { (game.livelog ||= []).push(line); }

export function nhl_pcall_handle(L, nargs, nresults, name, npa, fn, ...fnargs) {
    const rv = nhl_pcall(L, nargs, nresults, name, fn, ...fnargs);
    if (rv) {
        const nud = L?.ud;
        switch (npa) {
        case NHLpa_panic:
            _panic(`Lua error ${nud?.sid}:${nud?.name ?? '(unknown)'} ${
                L?.errmsg}`);
            /*NOTREACHED*/
            break;
        case NHLpa_impossible:
            _impossible(`Lua error: ${nud?.sid}:${nud?.name ?? '(unknown)'} ${
                L?.errmsg}`);
            /* Drop the error.  If the caller cares, use nhl_pcall(). */
            if (L) L.errmsg = null;
        }
    }
    return rv;
}

/* nhlua.c:2184 — read lua code/data from a dlb module or an external file into
   one buffer and feed that to lua.
   The read + line-normalisation half is real work and is translated: reads are
   capped at 8K so the partial-record path is exercised (the castle's level
   description needs it), a missing final newline is supplied, and a CR after a
   LF is absorbed.  The luaL_loadbuffer + pcall that follow need a VM; the
   remaining control flow is kept.  See the header note on why this must NOT
   draw the nhlib.lua align shuffle. */
export function nhl_loadlua(L, fname) {
    const LOADCHUNKSIZE = (1 << 13);            /* 8K */
    let ret = TRUE;
    const altfname = `(${fname})`;              /* 3: '('...')\0' */

    /* dlb_fopen(fname, RDBMODE) — js/dlb.js is the port of that layer and is
       itself inert, so the source text is looked up in whatever the caller
       registered rather than opened. */
    const src = game.luafiles?.[fname];
    if (src === undefined) {
        _impossible(`nhl_loadlua: Error opening ${altfname}`);
        return FALSE;
    }

    let buflen = src.length;
    let out = '';
    let pos = 0;
    let carry = '';                             /* the partial-record leftover */

    while (buflen > 0 || carry.length) {
        const want = Math.min(buflen, LOADCHUNKSIZE);
        let chunk = src.slice(pos, pos + want);
        pos += chunk.length;
        buflen -= chunk.length;
        if (chunk.length === 0)
            chunk = '\n';                       /* very last line unterminated */

        /* in case a partial line was leftover from the previous fread */
        let bufin = carry + chunk;
        carry = '';

        while (bufin.length > 0) {
            const nl = bufin.indexOf('\n');
            if (nl >= 0) {
                /* normal case, newline is present */
                let ct = nl + 1;                /* +1: keep the newline */
                out += bufin.slice(0, ct);
                if (bufin[ct] === '\r')
                    ct++;
                bufin = bufin.slice(ct);
            } else if (bufin.length < LOADCHUNKSIZE) {
                /* no newline => partial record; move the unprocessed chars to
                   the front of the input buffer */
                carry = bufin;
                bufin = '';
            } else {
                /* LOADCHUNKSIZE portion of the buffer already completely full */
                _impossible(`(${altfname}) line too long`);
                return FALSE;
            }
        }
    }

    /* luaL_loadbuffer(L, buf, strlen(buf), altfname) */
    const llret = _luaL_loadbuffer(L, out, altfname);
    if (llret !== LUA_OK) {
        _impossible(`luaL_loadbuffer: Error loading ${altfname}: ${L?.errmsg}`);
        ret = FALSE;
    } else {
        if (nhl_pcall_handle(L, 0, LUA_MULTRET, fname, NHLpa_impossible,
                             L.chunk)) {
            ret = FALSE;
        }
    }

    return ret;
}

/* lauxlib.c luaL_loadbuffer() — compiles source into a callable chunk.  There
   is no compiler here, so the chunk is a no-op closure and the buffer is kept
   for whoever wires this up. */
function _luaL_loadbuffer(L, buf, chunkname) {
    if (!L) return 2;                            /* LUA_ERRSYNTAX */
    L.buf = buf;
    L.chunkname = chunkname;
    L.chunk = () => undefined;
    return LUA_OK;
}

/* nhlua.c:2295.  sbi is an nhl_sandbox_info { flags, memlimit, steps,
   perpcall }.  Returns the new state, or 0. */
export function nhl_init(sbi) {
    /* NHL_SANDBOX also panics here when the linked Lua's
       LUA_VERSION_RELEASE_NUM differs from NHL_VERSION_EXPECTED (50408, or
       50500 from Lua 5.5): the sandbox is version-specific. */
    const L = nhlL_newstate(sbi, 'nhl_init');
    if (!L) return 0;

    (game.iflags ||= {}).in_lua = TRUE;
    nhlL_openlibs(L, sbi.flags);

    if (sbi.flags & NHL_SB_PACKAGE) {           /* #ifdef notyet */
        if (nhl_set_package_path(L, './?.lua'))
            return 0;
    }

    /* register the nh table, and functions for it */
    const nh = {};
    for (const [name, fn] of nhl_functions) nh[name] = fn;
    L.globals.nh = nh;

    /* init nhc -table */
    init_nhc_data(L);

    /* init u -table */
    init_u_data(L);

    /* sp_lev.c l_selection_register(L) / l_register_des(L),
       nhlobj.c l_obj_register(L) */
    if (game.l_selection_register) game.l_selection_register(L);
    if (game.l_register_des) game.l_register_des(L);
    if (game.l_obj_register) game.l_obj_register(L);

    /* nhlib.lua assumes the math table exists. */
    if (_luatype(L.globals.math) !== LUA_TTABLE)
        L.globals.math = {};

    if (!nhl_loadlua(L, 'nhlib.lua')) {
        nhl_done(L);
        return 0;
    }

    return L;
}

export function nhl_done(L) {
    if (L) {
        const nud = L.ud;
        if (game.loglua) {
            if (nud && nud.osteps) {
                const ic = nud.statctr * NHL_SB_STEPSIZE;  // an approximation
                _livelog_printf(`LUASTATS DONE ${nud.sid}:${nud.name} ${ic}`);
            }
            if (nud && nud.memlimit && !nud.perpcall) {
                _livelog_printf(`LUASTATS DMEM ${nud.sid}:${nud.name} ${
                    nhl_getmeminuse(L)}`);
            }
        }
        /* lua_close(L) */
        L.globals = {};
        if (nud)
            nhl_alloc(null, nud, 0, 0);          // free nud
    }
    (game.iflags ||= {}).in_lua = FALSE;
}

export function load_lua(name, sbi) {
    let ret = TRUE;
    const L = nhl_init(sbi);

    if (!L) {
        ret = FALSE;
    } else if (!nhl_loadlua(L, name)) {
        ret = FALSE;
    }

    nhl_done(L);

    return ret;
}

/* nhlua.c:2416.  LUA_VERSION is "<major>.<minor>"; we accept a leading "Lua"
   (with an optional '-' or ' ') and strip it.  LUA_RELEASE is
   <LUA_VERSION>.<LUA_VERSION_RELEASE> but is not exposed as a Lua global.
   The result is cached in gl.lua_ver, so the nhl_init() (and therefore the
   nhlib.lua align shuffle) happens at most once per process. */
export function get_lua_version() {
    const sbi = { flags: NHL_SB_VERSION, memlimit: 1 * 1024 * 1024, steps: 0,
                  perpcall: 1 * 1024 * 1024 };

    game.lua_ver ??= '';
    if (game.lua_ver.length === 0) {
        const L = nhl_init(sbi);

        if (L) {
            let vs = null;

            if (typeof L.globals._RELEASE === 'string')
                vs = L.globals._RELEASE;
            else
                vs = LUA_RELEASE;               /* #ifdef LUA_RELEASE */
            if (!vs) {
                if (typeof L.globals._VERSION === 'string')
                    vs = L.globals._VERSION;
                else
                    vs = LUA_VERSION;           /* #ifdef LUA_VERSION */
            }
            if (vs && vs.length < BUFSZ) {
                if (vs.slice(0, 3).toLowerCase() === 'lua') {
                    vs = vs.slice(3);
                    if (vs[0] === '-' || vs[0] === ' ')
                        vs = vs.slice(1);
                }
                game.lua_ver = vs;
            }
        }
        nhl_done(L);
        game.lua_copyright = LUA_COPYRIGHT;     /* #ifdef LUA_COPYRIGHT */
    }
    return game.lua_ver;
}

/* luaconf.h / lua.h of the Lua the recorder linked against */
const LUA_VERSION = 'Lua 5.4';
const LUA_RELEASE = 'Lua 5.4.8';
const LUA_COPYRIGHT = `${LUA_RELEASE}  Copyright (C) 1994-2025 Lua.org, PUC-Rio`;

/* ------------------------------------------------------------------------
 * SANDBOX / HARDENING (nhlua.c:2469).
 *
 * Tracing: define CHRONICLE + LIVELOG, rebuild, and the LUASTATS lines land in
 * livelog:
 *   DONE  rough step count over the life of the VM
 *   DMEM  memory in use when the VM is destroyed
 *   PCAL  rough step count during one lua_pcall
 *   PMEM  memory in use after lua_pcall returns
 * ------------------------------------------------------------------------ */

/* enum ewhen */
const NEVER = 0, IFFLAG = 1, EOT = 2;

/* NHL_BASE_BASE - safe things */
const ct_base_base = [
    [IFFLAG, 'ipairs'],
    [IFFLAG, 'next'],
    [IFFLAG, 'pairs'],
    [IFFLAG, 'pcall'],
    [IFFLAG, 'select'],
    [IFFLAG, 'tonumber'],
    [IFFLAG, 'tostring'],
    [IFFLAG, 'type'],
    [IFFLAG, 'xpcall'],
    [EOT, null],
];

/* NHL_BASE_ERROR - not really safe: we might not want Lua to kill the process */
const ct_base_error = [
    [IFFLAG, 'assert'],   /* ok, calls error */
    [IFFLAG, 'error'],    /* ok, calls G->panic */
    [NEVER, 'print'],     /* not ok - lua_writestring/lua_writeline -> stdout */
    [NEVER, 'warn'],      /* not ok - lua_writestringerror -> stderr */
    [EOT, null],
];

/* NHL_BASE_META - metatable access */
const ct_base_meta = [
    [IFFLAG, 'getmetatable'],
    [IFFLAG, 'rawequal'],
    [IFFLAG, 'rawget'],
    [IFFLAG, 'rawlen'],
    [IFFLAG, 'rawset'],
    [IFFLAG, 'setmetatable'],
    [EOT, null],
];

/* NHL_BASE_GC - questionable safety */
const ct_base_iffy = [
    [IFFLAG, 'collectgarbage'],
    [EOT, null],
];

/* NHL_BASE_UNSAFE - include only if required.  TODO: if it is ever used we
   need to wrap lua_load with something to forbid mode=="b". */
const ct_base_unsafe = [
    [IFFLAG, 'dofile'],
    [IFFLAG, 'loadfile'],
    [IFFLAG, 'load'],
    [EOT, null],
];

/* no ct_co_/ct_string_/ct_table_/ct_utf8_ tables: within each of those every
   function is at the same level of concern (though table.sort can take a lot of
   time and the step limit cannot catch it). */

/* possible ct_debug tables - likely to need changes */
const ct_debug_debug = [
    [NEVER, 'debug'],          /* uses normal I/O so needs re-write */
    [IFFLAG, 'getuservalue'],
    [NEVER, 'gethook'],        /* see sethook */
    [IFFLAG, 'getinfo'],
    [IFFLAG, 'getlocal'],
    [IFFLAG, 'getregistry'],
    [IFFLAG, 'getmetatable'],
    [IFFLAG, 'getupvalue'],
    [IFFLAG, 'upvaluejoin'],
    [IFFLAG, 'upvalueid'],
    [IFFLAG, 'setuservalue'],
    [NEVER, 'sethook'],        /* used for memory and step limits */
    [IFFLAG, 'setlocal'],
    [IFFLAG, 'setmetatable'],
    [IFFLAG, 'setupvalue'],
    [IFFLAG, 'setcstacklimit'],
    [EOT, null],
];
const ct_debug_safe = [
    [IFFLAG, 'traceback'],
    [EOT, null],
];

/* possible ct_os_ tables */
const ct_os_time = [
    [IFFLAG, 'clock'],         /* is this portable? XXX */
    [IFFLAG, 'date'],
    [IFFLAG, 'difftime'],
    [IFFLAG, 'time'],
    [EOT, null],
];

const ct_os_files = [
    [NEVER, 'execute'],        /* not portable */
    [NEVER, 'exit'],
    [NEVER, 'getenv'],
    [IFFLAG, 'remove'],
    [IFFLAG, 'rename'],
    [NEVER, 'setlocale'],
    [NEVER, 'tmpname'],
    [EOT, null],
];

/* nhlua.c:2608.  tndx is the loaded library's table.  If we load a library at
   all, NEVER items must be erased and IFFLAG items are erased when !flag. */
export function nhl_clearfromtable(L, flag, tndx, todo) {
    let i = 0;
    while (todo[i][0] !== EOT) {
        if (todo[i][0] === NEVER || !flag)
            tndx[todo[i][1]] = null;            /* lua_pushnil + lua_setfield */
        i++;
    }
}

/* ------------------------------------------------------------------------
 * nhlua.c:2643 — the hooked io.open access check.
 *
 * NetHack has no regex engine and Lua gives C no access to its pattern
 * matcher.  The three poor options were (1) import ~5K lines from FreeBSD,
 * (2) hack lstrlib.c to expose the matcher, (3) stand up a second Lua state
 * just for matching.  Upstream picked (3).  The registry entry is
 *   registry["org.nethack.nethack.sb.fs"][N] = { modepat, filepat }
 * and a check returns accept / reject / continue / fail.
 * ------------------------------------------------------------------------ */

/* nhlua.c:2659 — #ifdef notyet */
export function start_luapat() {
    /* XXX set memory and step limits */
    const sbi = { flags: NHL_SB_STRING, memlimit: 0, steps: 0, perpcall: 0 };

    if ((luapat = nhl_init(sbi)) === 0 || luapat === null)
        return FALSE;

    /* load a pattern matching function */
    const rv = _luaL_loadbuffer(luapat,
        'function matches(s,p) return not not stringm.match(s,p) end',
        'start_luapat');
    if (rv !== LUA_OK) {
        _panic(`start_luapat: ${rv}`);
    }
    return TRUE;
}

export function end_luapat() {
    if (luapat) {
        /* lua_close(luapat) */
        luapat = null;
    }
}

/* nhlua.c:2690 — #ifdef notyet.  Careful: two different, unrelated Lua states.
   `t` is the configtbl entry whose `ename` pattern we match `subject` against. */
export function opencheckpat(L, ename, param) {
    const subject = L?.stack?.[param];
    const t = L?.stack?.[L.stack.length - 1];
    const pattern = t?.[ename];

    if (!luapat) return NHL_SBRV_FAIL;
    const rv = _lua_pattern_matches(subject, pattern);
    if (rv === null) {
        /* impossible("access check internal error"); */
        return NHL_SBRV_FAIL;
    }
    return rv ? NHL_SBRV_ACCEPT : NHL_SBRV_DENY;
}

/* lstrlib.c string.match(s, p) reduced to "does it match at all".  Lua patterns
   are not regexes; with no matcher wired up this cannot answer, and a WRONG
   answer here would grant or deny file access, so it reports failure. */
function _lua_pattern_matches(_s, _p) { return null; }

/* nhlua.c:2726 — the table io.open's checks live in. */
const HOOKTBLNAME = 'org.nethack.nethack.sb.fs';

/* put the table open uses to check its arguments on top of the stack, creating
   it if needed.  Returns it, since there is no stack to leave it on. */
export function nhl_pushhooked_open_table(L) {
    const reg = (L.registry ||= {});
    if (!(HOOKTBLNAME in reg)) {                /* hot == LUA_TNONE */
        reg[HOOKTBLNAME] = {};
    }
    return reg[HOOKTBLNAME];
}

/* nhlua.c:2746 — #ifdef notyet.  Unlike io.open we treat mode as
   non-optional, defaulting it to "r". */
export function hooked_open(L) {
    let never = game._luapat_never ?? TRUE;

    if (never) {
        if (!start_luapat())
            return NHL_SBRV_FAIL;
        never = FALSE;
        game._luapat_never = FALSE;
    }
    const args = L.stack ?? [];
    _checkstring(args[0]);                      /* filename */

    if (args.length < 2)
        args.push('r');
    _optstring(args[1], 'r');                   /* mode */

    /* sandbox checks.  Do we need some ud from the calling state so this can
       differ per call without redoing the HO table?  Maybe for version 2. XXX */
    const params = args.length - 1;             /* point at the first param */
    const hot = nhl_pushhooked_open_table(L);

    if (_luatype(hot) === LUA_TTABLE) {
        for (let idx = 1; ; ++idx) {
            const entry = hot[idx];
            if (entry === null || entry === undefined)
                break;
            /* top of stack is our configtbl[idx] */
            switch (_luatype(entry)) {
            /* lots of options to expand this with other types XXX */
            case LUA_TTABLE: {
                L.stack = [...args, entry];
                const moderv = opencheckpat(L, 'modepat', params + 1);
                if (moderv === NHL_SBRV_FAIL)
                    return moderv;
                const filerv = opencheckpat(L, 'filepat', params);
                if (filerv === NHL_SBRV_FAIL)
                    return moderv;
                if (filerv === moderv) {
                    if (filerv === NHL_SBRV_DENY)
                        return NHL_SBRV_DENY;
                    if (filerv === NHL_SBRV_ACCEPT)
                        return _io_open_call(L, params);    /* goto doopen */
                }
                break;                          /* try next entry */
            }
            default:
                return NHL_SBRV_FAIL;
            }
        }
    } else
        return NHL_SBRV_DENY;                   /* default to "no" */

    return _io_open_call(L, params);            /* doopen: */
}

/* liolib.c io_open() — the saved original, called once the checks pass. */
function _io_open_call(L, params) {
    L.stack = (L.stack ?? []).slice(0, params + 1);
    return io_open ? io_open(L) : NHL_SBRV_FAIL;
}

/* nhlua.c:2728 — #ifdef notyet.  XXX may have to live in struct g. */
let io_open = null;

/* nhlua.c:2814 — #ifdef notyet.  Swap io.open for hooked_open, remembering the
   original.  The C comment notes the C11-vs-POSIX function-pointer cast this
   needs; a JS function value has no such problem. */
export function hook_open(L) {
    let rv = FALSE;
    if (!io_open) {
        const io = L.globals.io;
        if (_luatype(io) !== LUA_TTABLE)
            return rv;                          /* goto out */
        /* The only way the next test can fail is if someone is messing with
           us, and I'm not sure even that is possible. */
        if (typeof io.open !== 'function')
            return rv;                          /* goto out */
        io_open = io.open;
        io.open = hooked_open;
        rv = TRUE;
    }
    return rv;
}

/* nhlua.c:2846 — NHL_SANDBOX.  Load only the requested libraries, then delete
   the entries we never support or that were not asked for. */
export function nhlL_openlibs(L, lflags) {
    /* translate lflags from user-friendly to internal */
    if (NHL_SB_DEBUGGING & lflags) {
        lflags |= NHL_SB_DB_SAFE;
    }
    /* only for debugging the sandbox integration */
    if (NHL_SB_ALL & lflags) {
        lflags = -1;
    } else if (NHL_SB_SAFE & lflags) {
        lflags |= NHL_SB_BASE_BASE;
        lflags |= NHL_SB_COROUTINE;
        lflags |= NHL_SB_TABLE;
        lflags |= NHL_SB_STRING;
        lflags |= NHL_SB_MATH;
        lflags |= NHL_SB_UTF8;
    } else if (NHL_SB_VERSION) {
        /* NB the C really tests the CONSTANT, not `lflags & NHL_SB_VERSION`,
           so this arm is taken whenever neither ALL nor SAFE was set. */
        lflags |= NHL_SB_BASE_BASE;
    }
    /* NHL_SB_IO is #ifdef notyet: handling I/O is complex (hooked open, and a
       table of (mode, dirpat, filepat) tuples), so it is not available yet. */

    if (lflags & NHL_SB_BASEMASK) {
        /* load the entire library ... */
        const baselib = _requiref(L, '_G');

        /* ... and remove anything unsupported or not requested */
        nhl_clearfromtable(L, !!(lflags & NHL_SB_BASE_BASE), baselib, ct_base_base);
        nhl_clearfromtable(L, !!(lflags & NHL_SB_BASE_ERROR), baselib, ct_base_error);
        nhl_clearfromtable(L, !!(lflags & NHL_SB_BASE_META), baselib, ct_base_meta);
        nhl_clearfromtable(L, !!(lflags & NHL_SB_BASE_GC), baselib, ct_base_iffy);
        nhl_clearfromtable(L, !!(lflags & NHL_SB_BASE_UNSAFE), baselib, ct_base_unsafe);
    }

    if (lflags & NHL_SB_COROUTINE) _requiref(L, 'coroutine');
    if (lflags & NHL_SB_TABLE) _requiref(L, 'table');
    if (lflags & NHL_SB_IO) {
        _requiref(L, 'io');
        if (!hook_open(L))
            _panic("can't hook io.open");
    }
    if (lflags & NHL_SB_OSMASK) {
        const oslib = _requiref(L, 'os');
        nhl_clearfromtable(L, !!(lflags & NHL_SB_OS_TIME), oslib, ct_os_time);
        nhl_clearfromtable(L, !!(lflags & NHL_SB_OS_FILES), oslib, ct_os_files);
    }

    if (lflags & NHL_SB_STRING) _requiref(L, 'string');
    if (lflags & NHL_SB_MATH) {
        /* XXX math.random uses Lua's built-in xoshiro256** regardless of what
           the rest of the game uses.  Fixing it would mean changing
           lmathlib.c — which is why a ported .lua that calls math.random must
           NOT be routed through js/rng.js. */
        _requiref(L, 'math');
    }
    if (lflags & NHL_SB_UTF8) _requiref(L, 'utf8');
    if (lflags & NHL_SB_DBMASK) {
        const dblib = _requiref(L, 'debug');
        nhl_clearfromtable(L, !!(lflags & NHL_SB_DB_DB), dblib, ct_debug_debug);
        nhl_clearfromtable(L, !!(lflags & NHL_SB_DB_SAFE), dblib, ct_debug_safe);
    }
}

/* lauxlib.c luaL_requiref(L, name, openf, 1) — create the library table and
   store it as a global.  There is no library to load, so the table is empty;
   what matters downstream is that nhl_clearfromtable() gets a table to erase
   entries from. */
function _requiref(L, name) {
    const t = (L.globals[name] ||= {});
    return t;
}

/* nhlua.c:2969 — the lua_Alloc.  nsize 0 frees; otherwise realloc, but refuse
   once this state is over its memory limit.  nud->L is checked because it is
   NULL while the state is still being created. */
export function nhl_alloc(ud, ptr, osize, nsize) {
    const nud = ud;

    if (nsize === 0) {
        return null;
    }

    /* Check nud->L because it will be NULL during state init. */
    if (nud && nud.L && nud.memlimit) {         /* this state is size limited */
        if (nhl_getmeminuse(nud.L) > nud.memlimit)
            return null;
    }

    if (nud) nud.meminuse = (nud.meminuse ?? 0) + nsize - (osize ?? 0);
    return ptr ?? {};
}

/* nhlua.c:2992 — lua_atpanic handler; returning would abort Lua. */
export function nhl_panic(L) {
    let msg = L?.errmsg;

    if (msg === null || msg === undefined)
        msg = 'error object is not a string';
    _panic(`unprotected error in call to Lua API (${msg})\n`);
    /*NOTREACHED*/
    return 0;                                   /* return to Lua to abort */
}

/* nhlua.c:3008 — lua_setwarnf handler.  The message arrives in pieces across
   several calls; to_be_continued 0 means this was the last fragment.  The
   buffer is gl.lua_warnbuf and the truncation to its size is deliberate. */
export function nhl_warn(userdata, msg_fragment, to_be_continued) {
    const LUA_WARNBUFSZ = BUFSZ;                /* sizeof gl.lua_warnbuf */
    game.lua_warnbuf ??= '';
    const buflen = game.lua_warnbuf.length;

    if (msg_fragment && buflen < LUA_WARNBUFSZ - 1) {
        let fraglen = msg_fragment.length;
        if (buflen + fraglen > LUA_WARNBUFSZ - 1)
            fraglen = LUA_WARNBUFSZ - 1 - buflen;
        game.lua_warnbuf += msg_fragment.slice(0, fraglen);
    }
    if (!to_be_continued) {
        _paniclog('[lua]', game.lua_warnbuf);
        game.lua_warnbuf = '';
    }
}

/* nhlua.c:3029 — NHL_SANDBOX: the LUA_MASKCOUNT hook.  Charged every
   NHL_SB_STEPSIZE VM instructions; longjmps out when the budget is gone. */
export function nhl_hookfn(L, ar) {
    const nud = L?.ud;

    if (nud.steps <= NHL_SB_STEPSIZE)
        throw new Error(`Lua time exceeded ${nud.sid}:${nud.name ?? '(unknown)'}`);

    nud.steps -= NHL_SB_STEPSIZE;
    nud.statctr++;
}

/* nhlua.c:3044.  The nhl_user_data is only allocated when some limit is asked
   for, which is why every later `if (nud && ...)` guard exists. */
export function nhlL_newstate(sbi, name) {
    let nud = null;

    if (sbi.memlimit || sbi.steps || sbi.perpcall) {
        nud = _new_user_data();
        if (!nud)
            return 0;
        nud.L = null;
        nud.memlimit = sbi.memlimit;
        nud.perpcall = 0;                       /* set up below, if needed */
        nud.steps = 0;
        nud.osteps = 0;
        nud.flags = sbi.flags;                  /* save reporting flags */
        nud.statctr = 0;

        if (name) {
            nud.name = name;
        }
        game.lua_sid = (game.lua_sid ?? 0) + 1;
        nud.sid = game.lua_sid;
    }

    /* lua_newstate(nhl_alloc, nud) */
    const L = { globals: {}, registry: {}, ud: nud, errmsg: null, retval: null,
                stack: [], atpanic: null, warnf: null };
    if (!L)
        _panic('NULL lua_newstate');

    if (nud) nud.L = L;
    L.atpanic = nhl_panic;
    L.warnf = nhl_warn;                         /* LUA_VERSION_NUM == 504 */

    if (nud && (sbi.steps || sbi.perpcall)) {
        if (sbi.steps && sbi.perpcall)
            _impossible('steps and perpcall both non-zero');
        if (sbi.perpcall) {
            nud.perpcall = sbi.perpcall;
        } else {
            nud.steps = sbi.steps;
            nud.osteps = sbi.steps;
        }
        /* lua_sethook(L, nhl_hookfn, LUA_MASKCOUNT, NHL_SB_STEPSIZE) */
        L.hook = nhl_hookfn;
        L.hookmask = 'count';
        L.hookcount = NHL_SB_STEPSIZE;
    }

    return L;
}

/* nhlua.c:3100 — the closing comment argues that making the `package` library
   safe would mean unsetting LUA_PATH/LUA_CPATH (and their versioned forms),
   auditing LUA_PATH_DEFAULT/LUA_CPATH_DEFAULT, undefining LUA_USE_DLOPEN /
   LUA_DL_DLL so loadlib.c cannot dlopen, and/or clearing package.searchers —
   and concludes that the right answer is to replace _G.require with our own
   function and ignore the package library entirely. */

/*nhlua.js*/
