// js/nhlobj.js — port of src/nhlobj.c, the Lua binding layer for the `obj`
// userdata: what a level script or a nhcore callback gets from `obj.new("rock")`,
// `obj.at(x,y)`, `o:totable()`, `o:placeobj()`, `o:start_timer()`, `o:bury()`.
//
// STATUS: INERT.  Nothing in js/ imports this file, nothing here is called from
// existing code, and l_obj_register() is deliberately NOT installed into
// game.l_obj_register (js/nhlua.js:2172 is the hook that would pick it up).
// Registering it would put these functions on the live path and move the RNG
// stream, since obj.new() runs readobjnam()/mksobj()/mkobj().  Same convention
// as js/nhlua.js and js/nhlsel.js.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE LUA STACK.  Same mapping as js/nhlua.js documents: a `lua_CFunction`
// becomes a function taking the arguments the Lua caller passed (`...args` ==
// stack indices 1..argc) and returning what C pushed; `return 0` becomes
// `undefined`; a stack INDEX parameter stays 1-based (l_obj_check(args, 1)).
// A Lua table is a plain JS object.  nhl_error() throws, so every
// `/*NOTREACHED*/` really is unreachable.
//
// THE `struct _lua_obj` WRAPPER IS REAL AND MUST STAY.  It is not a stack
// artifact: it is the indirection that lets l_obj_add_to_container() and
// nhl_obj_u_giveobj() re-point a Lua-visible handle at the stack an object
// MERGED into, and it is what lua_ref_cnt / OBJ_LUAFREE are counted against.
// So `{ state, obj }` is kept verbatim.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHERE THIS PORT'S OBJECT MODEL DIFFERS FROM C (adaptations, flagged at each
// call site too):
//   * C threads floor objects on two singly-linked lists — the level-wide
//     `fobj` chain via ->nobj and the per-tile pile via ->nexthere.  This port
//     keeps ONE flat array, game.level.objects, in which the LAST entry
//     matching (x,y) is the head of C's nexthere chain (js/mkobj.js:2508), and
//     place_object() pushes onto the end, so the last element of the array is
//     the head of C's fobj chain.  l_obj_at()/l_obj_nextobj() are written
//     against that model.
//   * a container's contents are an ARRAY (obj.cobj), not a ->cobj chain, so
//     `obj->cobj` (the first content) is cobj[0] and Has_contents(o) is a
//     non-empty array.
//   * obj->where is a NUMBER in js/mkobj.js (const.js OBJ_*) but a STRING in
//     js/invent.js ('free'/'floor'/'contained'/...).  _where_is() below accepts
//     both spellings rather than picking one and being wrong half the time.
//   * objects[] rows here carry only part of C's struct objclass (see
//     l_obj_objects_to_table).
//
// RNG: nhlobj.c draws nothing itself.  Draws come from readobjnam(), mksobj(),
// mkobj(), add_to_container()/addinv() merging, and bury_an_obj().
//
// NAMING.  nhlobj.c's own names are kept verbatim and exported.  Helpers that
// stand in for functions or macros belonging to OTHER C files are `_`-prefixed,
// so swarm/bin/coverage.mjs cannot read them as ports of those files.

import { game } from './gstate.js';
import {
    OBJ_FREE, OBJ_FLOOR, OBJ_CONTAINED, OBJ_INVENT, OBJ_MINVENT, OBJ_LUAFREE,
    TIMER_OBJECT, NON_PM, ROT_ORGANIC, ROT_CORPSE, REVIVE_MON, ZOMBIFY_MON,
    BURN_OBJECT, HATCH_EGG, FIG_TRANSFORM, SHRINK_GLOB,
    CORPSTAT_HISTORIC, CORPSTAT_MALE, CORPSTAT_FEMALE,
    has_oname, ONAME, isok,
} from './const.js';
import {
    objects, mksobj, mkobj, add_to_container, place_object, weight, dealloc_obj,
    RANDOM_CLASS, MAXOCLASSES, WEAPON_CLASS, POTION_CLASS,
    LARGE_BOX, BAG_OF_TRICKS, CORPSE, EGG, TIN, FIGURINE, STATUE,
} from './mkobj.js';
import { obj_extract_self, addinv, hands_obj } from './invent.js';
import { readobjnam } from './readobjnam.js';
import { newsym } from './display.js';
import { peek_timer, obj_has_timer } from './timeout.js';
import { pmname_of_pmidx } from './makemon.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
import {
    nhl_error, nhl_add_table_entry_int, nhl_add_table_entry_str,
    nhl_add_table_entry_char, nhl_get_timertype,
} from './nhlua.js';
import { cvt_to_abscoord, get_table_objtype, get_table_objclass } from './sp_lev.js';

/* ------------------------------------------------------------------------
 * lauxlib.c argument checkers (js/nhlua.js has the same set as file-locals).
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

/* lua_tointeger() — 0 rather than an error for a non-number */
function _tointeger(v) {
    if (typeof v === 'number') return Math.trunc(v);
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)))
        return Math.trunc(Number(v));
    return 0;
}

/* luaL_checkstring() */
function _checkstring(v, what = 'string expected') {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    nhl_error(null, what);
    /*NOTREACHED*/
    return '';
}

/* lua_toboolean() */
function _toboolean(v) { return v !== null && v !== undefined && v !== false; }

/* lua_type(L, i) == LUA_TNUMBER / LUA_TSTRING / LUA_TTABLE / LUA_TUSERDATA */
function _isnumber(v) { return typeof v === 'number'; }
function _isstring(v) { return typeof v === 'string'; }
function _istable(v) {
    return typeof v === 'object' && v !== null && !(v instanceof _LuaObj);
}
function _isuserdata(v) { return v instanceof _LuaObj; }

/* ------------------------------------------------------------------------
 * Constants, macros and callees belonging to other C files.
 * ------------------------------------------------------------------------ */

/* C ref: objclass.h — the first real object; js/nhlua.js:101 uses the same 18. */
const FIRST_OBJECT = 18;

/* C ref: skills.h:43/:47 — the ammunition oc_skill window is_poisonable() uses. */
const P_BOW = 20, P_SHURIKEN = 24;

/* C ref: decl.c:90 materialnm[] — the order matches objclass.h's oc_material
   #defines exactly, so this is indexed by oc_material. */
const _materialnm = [
    'mysterious', 'liquid', 'wax', 'organic',
    'flesh', 'paper', 'cloth', 'leather',
    'wooden', 'bone', 'dragonhide', 'iron',
    'metal', 'copper', 'silver', 'gold',
    'platinum', 'mithril', 'plastic', 'glass',
    'gemstone', 'stone',
];

/* C ref: objclass.h def_oc_syms[].sym — the class symbols, indexed by oclass.
   js/nhlua.js:1193 and js/invent.js:1400 carry the same table as file-locals. */
const _def_oc_syms = ['\0', ']', ')', '[', '=', '"', '(', '%', '!', '?', '+',
                      '/', '$', '*', '`', '0', '_', '.'];

/* def_oc_syms[(uchar) oclass].sym as the `char` nhl_add_table_entry_char wants */
function _oc_sym(oclass) {
    const s = _def_oc_syms[oclass & 0xff];

    return s ? s.charCodeAt(0) : 0;
}

/* C ref: objnam.c def_char_to_objclass() — a class symbol back to its oclass,
   MAXOCLASSES when the symbol is not one.  Three file-local copies already
   exist (js/invent.js:1278, js/readobjnam.js:87, js/sp_lev.js) and none is
   exported. */
function _def_char_to_objclass(ch) {
    const c = (typeof ch === 'number') ? String.fromCharCode(ch) : String(ch);
    const i = _def_oc_syms.indexOf(c);
    return i < 0 ? MAXOCLASSES : i;
}

/* C ref: obj.h:333 Has_contents(o) / :336 Is_container(o).  Note that C's
   Has_contents() has its Is_container() half commented OUT, so ANY object with
   a non-empty ->cobj answers TRUE. */
function _Has_contents(o) { return !!(o && o.cobj && o.cobj.length); }
function _Is_container(o) {
    return !!o && o.otyp >= LARGE_BOX && o.otyp <= BAG_OF_TRICKS;
}

/* C ref: obj.h:264 is_poisonable(otmp) — a weapon in the ammunition oc_skill
   window, or a permanently poisoned one.  js/mhitm_ad.js:1263 has the same
   `permapoisoned` stand-in (no object in this port is permanently poisoned). */
function _permapoisoned(_obj) { return false; }
function _is_poisonable(otmp) {
    const oc = objects[otmp.otyp];

    return ((otmp.oclass === WEAPON_CLASS && oc
             && oc.oc_skill >= -P_SHURIKEN && oc.oc_skill <= -P_BOW)
            || _permapoisoned(otmp));
}

/* C ref: timeout.h:52 timer_is_obj(ttype) — the timer kinds that hang off an
   object.  js/nhlua.js:121 has the sibling timer_is_pos() the same way. */
function _timer_is_obj(ttype) {
    return (ttype === ROT_ORGANIC
            || ttype === ROT_CORPSE
            || ttype === REVIVE_MON
            || ttype === ZOMBIFY_MON
            || ttype === BURN_OBJECT
            || ttype === HATCH_EGG
            || ttype === FIG_TRANSFORM
            || ttype === SHRINK_GLOB);
}

/* C ref: mkobj.c obj_to_any(obj) — wrap an object as an anything.  This port
   passes the object itself (js/invent.js:780 does the same). */
function _obj_to_any(obj) { return obj; }

/* ---- UNPORTED callees ------------------------------------------------------
 * These have no JS definition anywhere (js/sp_lev.js's extern table lists
 * bury_an_obj as not wired up; js/timeout.js has peek_timer/obj_has_timer but
 * neither the starter nor the stopper, and js/mkobj.js's are file-local
 * stubs).  Stubbed here so this file's control flow is the C's; wiring
 * nhlobj.js up requires the real ones:
 *
 *   timeout.c  start_timer / stop_timer / obj_stop_timers
 *   dig.c      bury_an_obj  (may merge the object into the ground and free it,
 *                            which is what l_obj_bury() reports)
 * ------------------------------------------------------------------------- */
function _start_timer(_when, _kind, _func_index, _arg) { return 0; }
function _stop_timer(_func_index, _arg) { return 0; }
function _obj_stop_timers(obj) { if (obj) obj.timed = false; }
function _bury_an_obj(_otmp, box) { if (box) box.dealloced = false; return null; }

/* obj->where, which is numeric in js/mkobj.js and a lowercase string in
   js/invent.js.  Both spellings answer here. */
const _WHERE_NAMES = {
    [OBJ_FREE]: 'free', [OBJ_FLOOR]: 'floor', [OBJ_CONTAINED]: 'contained',
    [OBJ_INVENT]: 'invent', [OBJ_MINVENT]: 'minvent',
    [OBJ_LUAFREE]: 'luafree',
};
function _where_is(obj, where) {
    return !!obj && (obj.where === where || obj.where === _WHERE_NAMES[where]);
}

/* C ref: nhlobj.c:8 struct _lua_obj.  `state` is UNUSED in the C too. */
class _LuaObj {
    constructor() {
        this.state = 0;
        this.obj = null;
    }
}

/* C ref: nhlobj.c:32 #define lobj_is_ok(lo) — a live handle on a live object.
   (#undef'd at the bottom of the C file for 'onefile' builds.) */
function _lobj_is_ok(lo) {
    return !!(lo && lo.obj && !_where_is(lo.obj, OBJ_LUAFREE));
}

/* ------------------------------------------------------------------------
 * nhlobj.c:34 — the userdata checker.  As in nhlsel.c, C's
 * luaL_checktype(LUA_TUSERDATA) + luaL_checkudata(..., "obj") both throw on a
 * mismatch, so they collapse into one test.  `indx` is 1-based, as in C.
 * ------------------------------------------------------------------------ */
export function l_obj_check(args, indx) {
    const lo = args[indx - 1];

    if (!(lo instanceof _LuaObj))
        nhl_error(null, 'Obj error');
    return lo;
}

/* nhlobj.c:46 — __gc.  Dropping the last Lua reference to a free-floating
   object deallocates it AND its contents; an object that is still on the map or
   in an inventory is only unreferenced. */
export function l_obj_gc(...args) {
    let obj, otmp;
    const lo = l_obj_check(args, 1);

    if (lo && (obj = lo.obj) !== null && obj !== undefined) {
        if (obj.lua_ref_cnt > 0)
            obj.lua_ref_cnt--;
        /* free-floating objects with no other refs are deallocated. */
        if (!obj.lua_ref_cnt
            && (_where_is(obj, OBJ_FREE) || _where_is(obj, OBJ_LUAFREE))) {
            if (_Has_contents(obj)) {
                /* C: `while ((otmp = obj->cobj) != 0)`, i.e. always the head of
                   the chain; here the head of the contents array.  C's
                   obj_extract_self() unlinks that head (extract_nobj on
                   &obj->cobj) and THAT is what ends the loop; js/invent.js:815
                   only unlinks floor and inventory objects, so the splice below
                   supplies the missing half rather than spinning forever. */
                while (obj.cobj && obj.cobj.length && (otmp = obj.cobj[0])) {
                    obj_extract_self(otmp);
                    if (obj.cobj[0] === otmp)
                        obj.cobj.shift();
                    dealloc_obj(otmp);
                }
            }
            obj.where = OBJ_FREE;
            dealloc_obj(obj);
            obj = null;
        }
        lo.obj = null;
    }
    return undefined;                           /* C: return 0 */
}

/* nhlobj.c:72 — wrap an object as a new userdata and count the reference. */
export function l_obj_push(otmp) {
    const lo = new _LuaObj();

    lo.state = 0;
    lo.obj = otmp ?? null;
    if (otmp)
        otmp.lua_ref_cnt = (otmp.lua_ref_cnt || 0) + 1;

    return lo;
}

/* nhlobj.c:88 — the non-static entry point other C files use. */
export function nhl_push_obj(_L, otmp) {
    return l_obj_push(otmp);
}

/* nhlobj.c:96 — local cobj = o:contents();
   Returns a handle on the FIRST content (C's ->cobj), which may be a handle on
   nothing.  Note C errors when the handle has no object but still pushes. */
export function l_obj_getcontents(...args) {
    const lo = l_obj_check(args, 1);
    const obj = lo.obj;

    if (!obj)
        nhl_error(null, 'l_obj_getcontents: no obj');

    return l_obj_push((obj.cobj && obj.cobj.length) ? obj.cobj[0] : null);
}

/* nhlobj.c:113 — box:addcontent(obj.new("rock"));
   The handle is re-pointed if add_to_container() merged the object into a stack
   already inside the box, and the box's weight is recomputed afterwards. */
export function l_obj_add_to_container(...args) {
    const lobox = l_obj_check(args, 1);
    const lo = l_obj_check(args, 2);
    let otmp;
    let refs;

    if (!_lobj_is_ok(lo) || !_lobj_is_ok(lobox))
        return undefined;

    refs = lo.obj.lua_ref_cnt;

    obj_extract_self(lo.obj);
    otmp = add_to_container(lobox.obj, lo.obj);

    /* was lo->obj merged? */
    if (otmp !== lo.obj) {
        lo.obj = otmp;
        lo.obj.lua_ref_cnt = (lo.obj.lua_ref_cnt || 0) + refs;
    }
    lobox.obj.owt = weight(lobox.obj);

    return undefined;                           /* C: return 0 */
}

/* nhlobj.c:141 — u.giveobj(obj.new("rock"));
   NB the asymmetry against l_obj_add_to_container() above, kept verbatim: here
   the reference count is added to the OLD object and only then is the handle
   re-pointed, so a merge loses the count. */
export function nhl_obj_u_giveobj(...args) {
    const lo = l_obj_check(args, 1);
    let otmp;
    let refs;

    if (!_lobj_is_ok(lo) || _where_is(lo.obj, OBJ_INVENT))
        return undefined;

    refs = lo.obj.lua_ref_cnt;

    obj_extract_self(lo.obj);
    otmp = addinv(lo.obj);

    if (otmp !== lo.obj) {
        lo.obj.lua_ref_cnt = (lo.obj.lua_ref_cnt || 0) + refs;
        lo.obj = otmp;
    }

    return undefined;                           /* C: return 0 */
}

/* nhlobj.c:170 — local odata = obj.class(otyp) / obj.class(o) / o:class();
   a table of struct objclass data.
   THIS PORT'S objects[] ROWS ARE PARTIAL: they carry otyp, oclass, oc_prob,
   oc_color, oc_skill/oc_subtyp, oc_magic, oc_can, oc_oprop, a packed `flags`
   word, `material`, `dir` and `name` (js/mkobj.js:734).  The remaining
   objclass fields C reads here (oc_name_known, oc_merge, oc_uses_known,
   oc_encountered, oc_charged, oc_unique, oc_nowish, oc_big, oc_tough,
   oc_delay, oc_weight, oc_cost, oc_wsdam, oc_wldam, oc_nutrition) live either
   in the flags word, in a separate module (js/objcost_data.js,
   js/dogmove.js), or nowhere yet — every one of those reads is `?? 0` here and
   the entry is still emitted, so the table's KEY SET matches C's.  Wiring this
   up means filling objects[] in, not reshaping this function. */
export function l_obj_objects_to_table(...args) {
    const argc = args.length;
    let otyp = -1;
    let o;

    if (argc !== 1) {
        nhl_error(null, 'l_obj_objects_to_table: Wrong args');
        /*NOTREACHED*/
        return undefined;
    }

    if (_isnumber(args[0])) {
        otyp = _checkinteger(args[0]);
    } else if (_isuserdata(args[0])) {
        const lo = l_obj_check(args, 1);

        if (lo && lo.obj)
            otyp = lo.obj.otyp;
    }

    if (otyp === -1) {
        nhl_error(null, 'l_obj_objects_to_table: Wrong args');
        /*NOTREACHED*/
        return undefined;
    }

    o = objects[otyp];

    const t = {};

    if (_OBJ_NAME(objects[otyp]))
        nhl_add_table_entry_str(t, 'name', _OBJ_NAME(objects[otyp]));
    if (_OBJ_DESCR(objects[otyp]))
        nhl_add_table_entry_str(t, 'descr', _OBJ_DESCR(objects[otyp]));
    if (o.oc_uname)
        nhl_add_table_entry_str(t, 'uname', o.oc_uname);

    nhl_add_table_entry_int(t, 'name_known', o.oc_name_known ?? 0);
    nhl_add_table_entry_int(t, 'merge', o.oc_merge ?? 0);
    nhl_add_table_entry_int(t, 'uses_known', o.oc_uses_known ?? 0);
    nhl_add_table_entry_int(t, 'encountered', o.oc_encountered ?? 0);
    nhl_add_table_entry_int(t, 'magic', o.oc_magic ?? 0);
    nhl_add_table_entry_int(t, 'charged', o.oc_charged ?? 0);
    nhl_add_table_entry_int(t, 'unique', o.oc_unique ?? 0);
    nhl_add_table_entry_int(t, 'nowish', o.oc_nowish ?? 0);
    nhl_add_table_entry_int(t, 'big', o.oc_big ?? 0);
    /* TODO: oc_bimanual, oc_bulky */
    nhl_add_table_entry_int(t, 'tough', o.oc_tough ?? 0);
    nhl_add_table_entry_int(t, 'dir', o.dir ?? 0);  /* TODO: convert to text */
    nhl_add_table_entry_str(t, 'material', _materialnm[o.material ?? 0]);
    /* TODO: oc_subtyp, oc_skill, oc_armcat */
    nhl_add_table_entry_int(t, 'oprop', o.oc_oprop ?? 0);
    nhl_add_table_entry_char(t, 'class', _oc_sym(o.oc_class));
    nhl_add_table_entry_int(t, 'delay', o.oc_delay ?? 0);
    nhl_add_table_entry_int(t, 'color', o.oc_color ?? 0); /* TODO: text? */
    nhl_add_table_entry_int(t, 'prob', o.oc_prob ?? 0);
    nhl_add_table_entry_int(t, 'weight', o.oc_weight ?? 0);
    nhl_add_table_entry_int(t, 'cost', o.oc_cost ?? 0);
    nhl_add_table_entry_int(t, 'damage_small', o.oc_wsdam ?? 0);
    nhl_add_table_entry_int(t, 'damage_large', o.oc_wldam ?? 0);
    /* TODO: oc_oc1, oc_oc2, oc_hitbon, a_ac, a_can, oc_level */
    nhl_add_table_entry_int(t, 'nutrition', o.oc_nutrition ?? 0);

    return t;
}

/* C ref: objclass.h OBJ_NAME(obj) / OBJ_DESCR(obj) — obj_descr[oc_name_idx]
   .oc_name and obj_descr[oc_descr_idx].oc_descr.  This port keeps the name on
   the row and the appearance in js/o_descr_data.js keyed by oc_descr_idx
   (== otyp for the unshuffled classes). */
function _OBJ_NAME(oc) { return oc ? (oc.name || '') : ''; }
function _OBJ_DESCR(oc) {
    if (!oc) return '';
    return DESCR_BY_OTYP[oc.oc_descr_idx ?? oc.otyp] || '';
}

/* nhlobj.c:246 — local otbl = o:totable();
   Unpack every object field into a table.  A dead handle answers with just
   { NO_OBJ = 1 }. */
export function l_obj_to_table(...args) {
    const lo = l_obj_check(args, 1);
    const obj = lo.obj;

    const t = {};

    if (!obj || _where_is(obj, OBJ_LUAFREE)) {
        nhl_add_table_entry_int(t, 'NO_OBJ', 1);
        return t;
    }

    nhl_add_table_entry_int(t, 'has_contents', _Has_contents(obj) ? 1 : 0);
    nhl_add_table_entry_int(t, 'is_container', _Is_container(obj) ? 1 : 0);
    nhl_add_table_entry_int(t, 'o_id', obj.o_id);
    nhl_add_table_entry_int(t, 'ox', obj.ox);
    nhl_add_table_entry_int(t, 'oy', obj.oy);
    nhl_add_table_entry_int(t, 'otyp', obj.otyp);
    if (_OBJ_NAME(objects[obj.otyp]))
        nhl_add_table_entry_str(t, 'otyp_name', _OBJ_NAME(objects[obj.otyp]));
    if (_OBJ_DESCR(objects[obj.otyp]))
        nhl_add_table_entry_str(t, 'otyp_descr', _OBJ_DESCR(objects[obj.otyp]));
    nhl_add_table_entry_int(t, 'owt', obj.owt);
    nhl_add_table_entry_int(t, 'quan', obj.quan);
    nhl_add_table_entry_int(t, 'spe', obj.spe);

    if (obj.otyp === STATUE)
        nhl_add_table_entry_int(t, 'historic',
                                (obj.spe & CORPSTAT_HISTORIC) !== 0 ? 1 : 0);
    if (obj.otyp === CORPSE || obj.otyp === STATUE) {
        nhl_add_table_entry_int(t, 'male',
                                (obj.spe & CORPSTAT_MALE) !== 0 ? 1 : 0);
        nhl_add_table_entry_int(t, 'female',
                                (obj.spe & CORPSTAT_FEMALE) !== 0 ? 1 : 0);
    }

    nhl_add_table_entry_char(t, 'oclass', _oc_sym(obj.oclass));
    nhl_add_table_entry_char(t, 'invlet', _charcode(obj.invlet));
    /* TODO: nhl_add_table_entry_char(L, "oartifact", obj->oartifact); */
    nhl_add_table_entry_int(t, 'where', obj.where);
    /* TODO: nhl_add_table_entry_int(L, "timed", obj->timed); */
    nhl_add_table_entry_int(t, 'cursed', obj.cursed ? 1 : 0);
    nhl_add_table_entry_int(t, 'blessed', obj.blessed ? 1 : 0);
    nhl_add_table_entry_int(t, 'unpaid', obj.unpaid ? 1 : 0);
    nhl_add_table_entry_int(t, 'no_charge', obj.no_charge ? 1 : 0);
    nhl_add_table_entry_int(t, 'known', obj.known ? 1 : 0);
    nhl_add_table_entry_int(t, 'dknown', obj.dknown ? 1 : 0);
    nhl_add_table_entry_int(t, 'bknown', obj.bknown ? 1 : 0);
    nhl_add_table_entry_int(t, 'rknown', obj.rknown ? 1 : 0);
    nhl_add_table_entry_int(t, 'tknown', obj.tknown ? 1 : 0);
    if (obj.oclass === POTION_CLASS)
        nhl_add_table_entry_int(t, 'odiluted', obj.odiluted ? 1 : 0);
    else
        nhl_add_table_entry_int(t, 'oeroded', obj.oeroded ?? 0);
    nhl_add_table_entry_int(t, 'oeroded2', obj.oeroded2 ?? 0);
    /* TODO: orotten, norevive */
    nhl_add_table_entry_int(t, 'oerodeproof', obj.oerodeproof ? 1 : 0);
    nhl_add_table_entry_int(t, 'olocked', obj.olocked ? 1 : 0);
    nhl_add_table_entry_int(t, 'obroken', obj.obroken ? 1 : 0);
    if (_is_poisonable(obj))
        nhl_add_table_entry_int(t, 'opoisoned', obj.opoisoned ? 1 : 0);
    else
        nhl_add_table_entry_int(t, 'otrapped', obj.otrapped ? 1 : 0);
    /* TODO: degraded_horn */
    nhl_add_table_entry_int(t, 'recharged', obj.recharged ?? 0);
    /* TODO: on_ice */
    nhl_add_table_entry_int(t, 'lamplit', obj.lamplit ? 1 : 0);
    nhl_add_table_entry_int(t, 'globby', obj.globby ? 1 : 0);
    nhl_add_table_entry_int(t, 'greased', obj.greased ? 1 : 0);
    nhl_add_table_entry_int(t, 'nomerge', obj.nomerge ? 1 : 0);
    nhl_add_table_entry_int(t, 'how_lost', obj.how_lost ?? 0);
    nhl_add_table_entry_int(t, 'in_use', obj.in_use ? 1 : 0);
    nhl_add_table_entry_int(t, 'bypass', obj.bypass ? 1 : 0);
    nhl_add_table_entry_int(t, 'cknown', obj.cknown ? 1 : 0);
    nhl_add_table_entry_int(t, 'lknown', obj.lknown ? 1 : 0);
    nhl_add_table_entry_int(t, 'corpsenm', obj.corpsenm ?? NON_PM);
    if ((obj.corpsenm ?? NON_PM) !== NON_PM
        && (obj.otyp === TIN || obj.otyp === CORPSE || obj.otyp === EGG
            || obj.otyp === FIGURINE || obj.otyp === STATUE))
        nhl_add_table_entry_str(t, 'corpsenm_name',
                                /* mons[corpsenm].pmnames[NEUTRAL] */
                                pmname_of_pmidx(obj.corpsenm, false));
    /* TODO: leashmon, fromsink, novelidx, record_achieve_special */
    nhl_add_table_entry_int(t, 'usecount', obj.usecount ?? 0);
    /* TODO: spestudied */
    nhl_add_table_entry_int(t, 'oeaten', obj.oeaten ?? 0);
    nhl_add_table_entry_int(t, 'age', obj.age ?? 0);
    nhl_add_table_entry_int(t, 'owornmask', obj.owornmask ?? 0);
    /* TODO: more of oextra */
    nhl_add_table_entry_int(t, 'has_oname', has_oname(obj) ? 1 : 0);
    if (has_oname(obj))
        nhl_add_table_entry_str(t, 'oname', ONAME(obj));

    return t;
}

/* obj->invlet is a `char` in C; this port stores the letter itself. */
function _charcode(c) {
    if (typeof c === 'number') return c;
    if (typeof c === 'string' && c.length) return c.charCodeAt(0);
    return 0;
}

/* nhlobj.c:349 — local o = obj.new("rock") / obj.new({ id=, class= }).
   The string form goes through the WISHING parser, so it can draw RNG and can
   answer &hands_obj (which is turned into "no object"); the table form takes an
   explicit otyp (mksobj(id, TRUE, FALSE)) or a class symbol
   (mkobj(class, FALSE)), with an unrecognised class becoming RANDOM_CLASS. */
export function l_obj_new_readobjnam(...args) {
    const argc = args.length;

    if (argc === 1 && _isstring(args[0])) {
        let otmp;
        const buf = _checkstring(args[0]);

        if ((otmp = readobjnam(buf, null)) === hands_obj)
            otmp = null;
        return l_obj_push(otmp);
    } else if (argc === 1 && _istable(args[0])) {
        const id = get_table_objtype(args[0]);
        let cls = get_table_objclass(args[0]);
        let otmp;

        if (id >= FIRST_OBJECT) {
            otmp = mksobj(id, true, false);
        } else {
            cls = _def_char_to_objclass(cls);
            if (cls >= MAXOCLASSES)
                cls = RANDOM_CLASS;
            otmp = mkobj(cls, false);
        }
        return l_obj_push(otmp);
    } else
        nhl_error(null, 'l_obj_new_readobjname: Wrong args');
    /*NOTREACHED*/
    return undefined;
}

/* nhlobj.c:388 — local o = obj.at(x, y);
   The topmost object on the map at (x,y).  C reads svl.level.objects[x][y],
   the head of the tile's nexthere chain; in this port that is the LAST entry of
   game.level.objects matching (x,y) (js/mkobj.js:2508).  The coordinates are
   map- or room-relative, hence cvt_to_abscoord(). */
export function l_obj_at(...args) {
    const argc = args.length;

    if (argc === 2) {
        const c = { x: _checkinteger(args[0]), y: _checkinteger(args[1]) };

        cvt_to_abscoord(c);

        return l_obj_push(_level_objects_at(c.x, c.y));
    } else
        nhl_error(null, 'l_obj_at: Wrong args');
    /*NOTREACHED*/
    return undefined;
}

/* svl.level.objects[x][y] */
function _level_objects_at(x, y) {
    const objs = game.level?.objects;

    if (!Array.isArray(objs)) return null;
    for (let i = objs.length - 1; i >= 0; i--)
        if (_where_is(objs[i], OBJ_FLOOR) && objs[i].ox === x
            && objs[i].oy === y)
            return objs[i];
    return null;
}

/* nhlobj.c:412 — o:placeobj(x, y); */
export function l_obj_placeobj(...args) {
    const argc = args.length;
    const lo = l_obj_check(args, 1);

    if (argc !== 3)
        nhl_error(null, 'l_obj_placeobj: Wrong args');

    const c = { x: _checkinteger(args[1]), y: _checkinteger(args[2]) };

    cvt_to_abscoord(c);

    if (_lobj_is_ok(lo)) {
        obj_extract_self(lo.obj);
        place_object(lo.obj, c.x, c.y);
        newsym(c.x, c.y);
    }

    return undefined;                           /* C: return 0 */
}

/* nhlobj.c:444 — local firstobj = obj.next() / local o2 = o:next([nexthere]);
   With no argument this is the head of the level's fobj chain; with a handle it
   walks either the tile's nexthere chain (when asked, and only for a floor
   object) or the level-wide nobj chain.  Neither chain exists in this port —
   game.level.objects is one flat array whose LAST element is C's fobj head and
   whose predecessors run in the opposite direction to ->nobj — so both walks
   step BACKWARDS through that array, and the nexthere walk additionally skips
   entries that are not on the same tile.
   NB the C also returns 1 value even on the `lo->obj == NULL` path, where
   nothing was pushed. */
export function l_obj_nextobj(...args) {
    const argc = args.length;

    if (argc === 0) {
        return l_obj_push(_fobj());
    } else {
        const lo = l_obj_check(args, 1);
        let use_nexthere = false;

        if (argc === 2)
            use_nexthere = _toboolean(args[1]);

        if (lo && lo.obj)
            return l_obj_push((use_nexthere && _where_is(lo.obj, OBJ_FLOOR))
                              ? _nexthere(lo.obj)
                              : _nobj(lo.obj));
    }
    return undefined;
}

/* fobj — the head of the level's object chain. */
function _fobj() {
    const objs = game.level?.objects;

    return (Array.isArray(objs) && objs.length) ? objs[objs.length - 1] : null;
}

/* obj->nobj */
function _nobj(obj) {
    const objs = game.level?.objects;

    if (!Array.isArray(objs)) return null;
    const i = objs.indexOf(obj);

    return (i > 0) ? objs[i - 1] : null;
}

/* obj->nexthere */
function _nexthere(obj) {
    const objs = game.level?.objects;

    if (!Array.isArray(objs)) return null;
    for (let i = objs.indexOf(obj) - 1; i >= 0; i--)
        if (_where_is(objs[i], OBJ_FLOOR) && objs[i].ox === obj.ox
            && objs[i].oy === obj.oy)
            return objs[i];
    return null;
}

/* nhlobj.c:468 — local box = o:container(); */
export function l_obj_container(...args) {
    const lo = l_obj_check(args, 1);

    if (lo && lo.obj && _where_is(lo.obj, OBJ_CONTAINED))
        return l_obj_push(lo.obj.ocontainer);
    else
        return l_obj_push(null);
}

/* nhlobj.c:482 — local badobj = o:isnull(); */
export function l_obj_isnull(...args) {
    const lo = l_obj_check(args, 1);

    return !_lobj_is_ok(lo);
}

/* nhlobj.c:495 — local hastimer = o:has_timer("rot-organic"); */
export function l_obj_timer_has(...args) {
    const argc = args.length;

    if (argc === 2) {
        const lo = l_obj_check(args, 1);
        const timertype = nhl_get_timertype(args[1]);

        if (_timer_is_obj(timertype) && lo && lo.obj) {
            return !!obj_has_timer(lo.obj, timertype);
        } else {
            return false;
        }
    } else
        nhl_error(null, 'l_obj_timer_has: Wrong args');
    return undefined;
}

/* nhlobj.c:519 — local timeout = o:peek_timer("hatch-egg");
   The turn the timer triggers, or 0 when there is no such timer. */
export function l_obj_timer_peek(...args) {
    const argc = args.length;

    if (argc === 2) {
        const lo = l_obj_check(args, 1);
        const timertype = nhl_get_timertype(args[1]);

        if (_timer_is_obj(timertype) && lo && lo.obj) {
            return peek_timer(timertype, _obj_to_any(lo.obj));
        } else {
            return 0;
        }
    } else
        nhl_error(null, 'l_obj_timer_peek: Wrong args');
    /*NOTREACHED*/
    return undefined;
}

/* nhlobj.c:546 — o:stop_timer(["rot-organic"]);
   With no timer type ALL of the object's timers stop and nothing is returned;
   with one, the stopped timer's timeout (0 if there was none) comes back. */
export function l_obj_timer_stop(...args) {
    const argc = args.length;

    if (argc === 1) {
        const lo = l_obj_check(args, 1);

        if (lo && lo.obj)
            _obj_stop_timers(lo.obj);
        return undefined;

    } else if (argc === 2) {
        const lo = l_obj_check(args, 1);
        const timertype = nhl_get_timertype(args[1]);

        if (_timer_is_obj(timertype) && lo && lo.obj) {
            return _stop_timer(timertype, _obj_to_any(lo.obj));
        } else {
            return 0;
        }
    } else
        nhl_error(null, 'l_obj_timer_stop: Wrong args');
    return undefined;
}

/* nhlobj.c:578 — o:start_timer("hatch-egg", 10);
   An existing timer of the same type is stopped first, so starting one twice
   does not stack. */
export function l_obj_timer_start(...args) {
    const argc = args.length;

    if (argc === 3) {
        const lo = l_obj_check(args, 1);
        const timertype = nhl_get_timertype(args[1]);
        const when = _checkinteger(args[2]);

        if (_timer_is_obj(timertype) && lo && lo.obj && when > 0) {
            if (obj_has_timer(lo.obj, timertype))
                _stop_timer(timertype, _obj_to_any(lo.obj));
            _start_timer(when, TIMER_OBJECT, timertype, _obj_to_any(lo.obj));
        }
    } else
        nhl_error(null, 'l_obj_timer_start: Wrong args');
    return undefined;                           /* C: return 0 */
}

/* nhlobj.c:602 — local ogone = o:bury() / o:bury(5,5);
   TRUE when the object is gone (merged with the ground).  NB the argc == 1 path
   dereferences lo->obj BEFORE lobj_is_ok() is consulted, and an argc that is
   neither 1 nor 3 falls through to the burial with x = y = 0. */
export function l_obj_bury(...args) {
    const argc = args.length;
    const box = { dealloced: false };
    const lo = l_obj_check(args, 1);
    let x = 0, y = 0;

    if (argc === 1) {
        x = lo.obj.ox;
        y = lo.obj.oy;
    } else if (argc === 3) {
        const c = { x: _tointeger(args[1]), y: _tointeger(args[2]) };

        cvt_to_abscoord(c);
        x = c.x;
        y = c.y;
    } else
        nhl_error(null, 'l_obj_bury: Wrong args');

    if (_lobj_is_ok(lo) && isok(x, y)) {
        lo.obj.ox = x;
        lo.obj.oy = y;
        _bury_an_obj(lo.obj, box);
    }
    return !!box.dealloced;
}

/* ------------------------------------------------------------------------
 * nhlobj.c:629 — the method and metamethod tables, and the registrar.
 * INERT: nothing assigns l_obj_register to game.l_obj_register, which is the
 * hook js/nhlua.js:2172 would use.
 * ------------------------------------------------------------------------ */
const l_obj_methods = [
    ['new', l_obj_new_readobjnam],
    ['isnull', l_obj_isnull],
    ['at', l_obj_at],
    ['next', l_obj_nextobj],
    ['totable', l_obj_to_table],
    ['class', l_obj_objects_to_table],
    ['placeobj', l_obj_placeobj],
    ['container', l_obj_container],
    ['contents', l_obj_getcontents],
    ['addcontent', l_obj_add_to_container],
    ['has_timer', l_obj_timer_has],
    ['peek_timer', l_obj_timer_peek],
    ['stop_timer', l_obj_timer_stop],
    ['start_timer', l_obj_timer_start],
    ['bury', l_obj_bury],
];

const l_obj_meta = [
    ['__gc', l_obj_gc],
];

/* nhlobj.c:653 */
export function l_obj_register(L) {
    /* luaL_newlib(L, l_obj_methods) — instance + static methods */
    const methods = {};
    for (const [name, fn] of l_obj_methods) methods[name] = fn;

    /* luaL_newmetatable(L, "obj"); luaL_setfuncs(L, l_obj_meta, 0) */
    const meta = { __name: 'obj' };
    for (const [name, fn] of l_obj_meta) meta[name] = fn;

    /* metatable.__index points at the object method table */
    meta.__index = methods;

    /* don't let lua code mess with the real metatable */
    const fake = {};
    for (const [name, fn] of l_obj_meta) fake[name] = fn;
    meta.__metatable = fake;

    if (L) {
        /* the Lua registry entry luaL_getmetatable() reads back */
        (L.registry ||= {}).obj = meta;
        /* lua_setglobal(L, "obj") */
        (L.globals ||= {}).obj = methods;
    }
    return 0;
}
