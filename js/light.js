// light.js — C ref: src/light.c (mobile light sources).
//
// Light sources are (type, id) pairs hanging off gl.light_base.  C's list is a
// singly linked list built by PREPENDING (new_light_core: `ls->next =
// gl.light_base; gl.light_base = ls`), and do_light_sources()'s at-hero
// duplicate-suppression depends on traversal order, so the JS list is an array
// whose index 0 is the head and whose new entries are unshift()ed.
//
// C's `anything` union stores either a pointer (a_obj/a_monst) or an unsigned
// id (a_uint).  A JS reference is that union already: ls.id holds the obj or
// monst object normally, and a NUMBER (o_id/m_id) while LSF_NEEDS_FIXUP is set
// across a save/restore.  Comparisons below mirror C's `curr->id.a_obj == ...`
// exactly, including the union aliasing in del_light_source().
//
// NOTE: js/const.js:1971 exports LS_OBJECT=0, LS_MONSTER=1.  include/vision.h
// says LS_NONE=0, LS_OBJECT=1, LS_MONSTER=2 — const.js dropped LS_NONE and is
// off by one, so the values are defined locally here instead of imported.  It
// has no consumer yet; fixing const.js belongs to that file's owner.
//
// light.c contains NO RNG call of any kind (verified against the annotated C
// streams in sessions/, heldout-wave3/ and heldout-proxy/: zero draws are
// attributed to light.c).  Every routine here must stay RNG-free.

import { game, hooks } from './gstate.js';
import {
    COLNO, ROWNO, MAX_RADIUS, COULD_SEE, TEMP_LIT, RANGE_LEVEL,
    FM_YOU, FM_FMON, FM_MIGRATE, FM_MYDOGS, FM_EVERYWHERE,
} from './const.js';
import { clear_path, vision_recalc } from './vision.js';
import { flush_screen, map_invisible, canseemon_shared } from './display.js';
import { objects, place_object } from './mkobj.js';
import { DEADMONSTER, monsterList } from './mon.js';
import { name_to_pmidx } from './makemon.js';
import { mindless } from './monflags_data.js';
import { is_pool } from './dbridge.js';

// C ref: include/vision.h enum ls_sources.
export const LS_NONE = 0;
export const LS_OBJECT = 1;
export const LS_MONSTER = 2;

// C ref: light.c:41-43 flags.
const LSF_SHOW = 0x1;
const LSF_NEEDS_FIXUP = 0x2;
const LSF_IS_PROBLEMATIC = 0x4;

// otyps by their objects.h macro name — never by a literal index (js/mkobj.js
// OBJECT_DATA carries the C macro name in field 1).  Resolved LAZILY: reading
// `objects` at module-evaluation time forces mkobj.js to be fully initialised
// the moment anything imports light.js, which deadlocks the import cycle
// vision.js -> light.js -> mkobj.js with a TDZ error.
let _OTYP = null;
function otyp(sym) {
    if (!_OTYP) _OTYP = new Map(objects.map((o) => [o.sym, o.otyp]));
    return _OTYP.get(sym);
}
const TALLOW_CANDLE = () => otyp('TALLOW_CANDLE');
const WAX_CANDLE = () => otyp('WAX_CANDLE');
const BRASS_LANTERN = () => otyp('BRASS_LANTERN');
const OIL_LAMP = () => otyp('OIL_LAMP');
const MAGIC_LAMP = () => otyp('MAGIC_LAMP');
const CANDELABRUM_OF_INVOCATION = () => otyp('CANDELABRUM_OF_INVOCATION');
const POT_OIL = () => otyp('POT_OIL');
const GOLD_DRAGON_SCALE_MAIL = () => otyp('GOLD_DRAGON_SCALE_MAIL');
const GOLD_DRAGON_SCALES = () => otyp('GOLD_DRAGON_SCALES');

// artilist.h ordering: makedefs numbers ART_* from 1 (Excalibur), so Sunsword
// — the 20th A() entry after the empty ART_NONARTIFACT slot — is 20.
const ART_SUNSWORD = 20;

function impossible(...args) {
    if (game.debugImpossible) console.warn('impossible:', ...args);
}

// ── the light_base list ──

// C ref: gl.light_base.  Index 0 is the list head.  C keeps ONE global chain
// and save_light_sources(RANGE_LEVEL)/restore_light_sources() swap it on every
// level change; hanging the array off game.level scopes it the same way with
// no save/restore, and a revisited level gets its own list back.
function light_base() {
    const owner = game.level || game;
    if (!owner.light_base) owner.light_base = [];
    return owner.light_base;
}

// C ref: mondata.h:178 emits_light(ptr) — the light RADIUS a species emits, 0
// for almost all of them.  C compares permonst POINTERS against six fixed
// species (plus the whole S_LIGHT class), so this is a genuine species list,
// not a flag test; the pmidx are resolved BY NAME so a mons[] reshuffle cannot
// silently re-point them.
const S_LIGHT_CLS = 25;   // monsym.h S_LIGHT
let _lightPmidx = null;
function lightPmidx() {
    if (!_lightPmidx) {
        _lightPmidx = new Map();
        for (const n of ['flaming sphere', 'shocking sphere', 'baby gold dragon',
                         'fire vortex', 'fire elemental', 'gold dragon']) {
            const i = name_to_pmidx(n);
            if (i != null) _lightPmidx.set(i, 1);
        }
    }
    return _lightPmidx;
}
export function emits_light(ptr) {
    if (!ptr) return 0;
    if (ptr.mcls === S_LIGHT_CLS) return 1;
    return lightPmidx().has(ptr.pmidx) ? 1 : 0;
}

// C ref: makemon.c:1348 (create) + mon.c:2744 in m_detach (delete).  This port
// has no single m_detach, so instead of hooking every death/removal path the
// LS_MONSTER entries are reconciled against the level's monster list right
// before do_light_sources() runs.  The resulting SET is the same one C's chain
// holds; order is irrelevant because the only order-sensitive step
// (at_hero_range) compares against the hero's own square, which no monster
// light source occupies.
export function sync_monster_light_sources() {
    const list = light_base();
    const live = monsterList();
    for (let i = list.length - 1; i >= 0; i--) {
        const ls = list[i];
        if (ls.type !== LS_MONSTER) continue;
        const m = ls.id;
        if (!m || m === HERO) continue;
        if (DEADMONSTER(m) || !(m.mx > 0) || !live.includes(m)) list.splice(i, 1);
    }
    for (const m of fmon()) {
        if (DEADMONSTER(m) || !(m.mx > 0)) continue;
        const range = emits_light(m.data);
        if (!range) continue;
        if (list.some((ls) => ls.type === LS_MONSTER && ls.id === m)) continue;
        new_light_source(m.mx, m.my, range, LS_MONSTER, m);
    }
}

// ── borrowed leaves (each belongs to another C file; see the note per fn) ──

// C ref: obj.h Is_candle / ignitable.
function Is_candle(obj) {
    return obj?.otyp === TALLOW_CANDLE() || obj?.otyp === WAX_CANDLE();
}
function ignitable(obj) {
    if (!obj) return false;
    return obj.otyp === BRASS_LANTERN() || obj.otyp === OIL_LAMP()
        || (obj.otyp === MAGIC_LAMP() && (obj.spe | 0) > 0)
        || obj.otyp === CANDELABRUM_OF_INVOCATION()
        || obj.otyp === TALLOW_CANDLE() || obj.otyp === WAX_CANDLE()
        || obj.otyp === POT_OIL();
}

// C ref: artifact.c:2264 artifact_light(obj) — worn gold dragon scales/mail, or
// Sunsword.  js/monmove.js:493 has a private copy hardcoded to FALSE; that copy
// is a subset and belongs to artifact.c's owner (see `deferred`).  The worn-body
// -armor test is C's `(obj->owornmask & W_ARM)`; this port's body-armor slot is
// game.uarm (js/invent.js deliberately remaps the prop.h W_* bits, so its mask
// values must not be used from here).
export function artifact_light(obj) {
    if (obj && (obj.otyp === GOLD_DRAGON_SCALE_MAIL() || obj.otyp === GOLD_DRAGON_SCALES())
        && obj === game.uarm)
        return true;
    return !!obj && obj.oartifact === ART_SUNSWORD;
}

// C ref: zap.c:654 get_obj_location(obj, &x, &y, locflags) — returns
// {x, y} or null.  BURIED_TOO/CONTAINED_TOO are the locflags bits.
// (js/invent.js:1077 has a private copy that reads obj.ox/obj.oy for every
// `where`; this is the full switch.  Belongs to zap.c's owner.)
const BURIED_TOO = 0x2, CONTAINED_TOO = 0x1;
function get_obj_location(obj, locflags) {
    if (!obj) return null;
    switch (obj.where) {
    case 'invent':
        return { x: game.u?.ux, y: game.u?.uy };
    case 'floor':
        return { x: obj.ox, y: obj.oy };
    case 'minvent':
        if (obj.ocarry?.mx)
            return { x: obj.ocarry.mx, y: obj.ocarry.my };
        break; /* !mx => migrating monster */
    case 'buried':
        if (locflags & BURIED_TOO) return { x: obj.ox, y: obj.oy };
        break;
    case 'contained':
        if (locflags & CONTAINED_TOO)
            return get_obj_location(obj.ocontainer, locflags);
        break;
    default:
        break;
    }
    return null;
}

// C ref: zap.c:692 get_mon_location(mon, &x, &y, locflags).  The hero is
// represented by game.u, not a youmonst struct, so a light source attached to
// the hero (or to the steed she rides) carries the HERO sentinel below.
export const HERO = Symbol('youmonst');
function get_mon_location(mon, locflags) {
    if (mon === HERO || (game.u?.usteed && mon === game.u.usteed))
        return { x: game.u?.ux, y: game.u?.uy };
    if (mon && mon.mx > 0 && (!mon.mburied || locflags))
        return { x: mon.mx, y: mon.my };
    return null; /* migrating or buried */
}

// C ref: the `fmon` chain.  makemon prepends, so C walks newest-first while
// game.level.monsters is in creation order (js/mon.js has a private fmonOrder()
// that does the same reversal).
function fmon() {
    const list = monsterList();
    const out = new Array(list.length);
    for (let i = 0; i < list.length; i++) out[i] = list[list.length - 1 - i];
    return out;
}

// C ref: gm.migrating_mons / gm.mydogs.  Neither chain is modelled by this port
// yet; read them through so find_mid()/whereis_mon() become correct for free
// the moment they exist.
function migrating_mons() { return game.migrating_mons || []; }
function mydogs() { return game.mydogs || []; }

// C ref: mkobj.c remove_object(obj) — unlink a floor object from the level pile.
// (js/ball.js:37 has the same private copy; it belongs in js/mkobj.js.)
function remove_object(obj) {
    const arr = game.level?.objects;
    if (!arr) return;
    const ix = arr.indexOf(obj);
    if (ix >= 0) arr.splice(ix, 1);
    obj.where = 'free';
}

// C ref: vision.c circle_data[] / circle_start[] — the same table js/vision.js
// keeps privately; circle_ptr() is not exported from there, so it is duplicated
// here (consolidating it is a vision.js change, see `deferred`).
const circle_data = [
    /*  0*/ 0,
    /*  1*/ 1, 1,
    /*  3*/ 2, 2, 1,
    /*  6*/ 3, 3, 2, 1,
    /* 10*/ 4, 4, 4, 3, 2,
    /* 15*/ 5, 5, 5, 4, 3, 2,
    /* 21*/ 6, 6, 6, 5, 5, 4, 2,
    /* 28*/ 7, 7, 7, 6, 6, 5, 4, 2,
    /* 36*/ 8, 8, 8, 7, 7, 6, 6, 4, 2,
    /* 45*/ 9, 9, 9, 9, 8, 8, 7, 6, 5, 3,
    /* 55*/ 10, 10, 10, 10, 9, 9, 8, 7, 6, 5, 3,
    /* 66*/ 11, 11, 11, 11, 10, 10, 9, 9, 8, 7, 5, 3,
    /* 78*/ 12, 12, 12, 12, 11, 11, 10, 10, 9, 8, 7, 5, 3,
    /* 91*/ 13, 13, 13, 13, 12, 12, 12, 11, 10, 10, 9, 7, 6, 3,
    /*105*/ 14, 14, 14, 14, 13, 13, 13, 12, 12, 11, 10, 9, 8, 6, 3,
    /*120*/ 15, 15, 15, 15, 14, 14, 14, 13, 13, 12, 11, 10, 9, 8, 6, 3,
    /*136*/ 16,
];
const circle_start = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78, 91, 105, 120];
// C ref: vision.h circle_ptr(z) == &circle_data[(int) circle_start[z]].
function circle_ptr(range) {
    const base = circle_start[range];
    return (i) => circle_data[base + i];
}

function u_at(x, y) { return game.u?.ux === x && game.u?.uy === y; }

// C ref: hacklib.c dist2.
function dist2(x0, y0, x1, y1) { return (x0 - x1) * (x0 - x1) + (y0 - y1) * (y0 - y1); }

// ── light.c proper ──

// C ref: light.c:61 new_light_source().
export function new_light_source(x, y, range, type, id) {
    new_light_core(x, y, range, type, id);
}

// C ref: light.c:68 new_light_core().  `id` is the obj/monst reference (C's
// anything); a camera flash passes LS_OBJECT with a null id and range 0.
function new_light_core(x, y, range, type, id) {
    if (range > MAX_RADIUS || range < 0
        /* camera flash uses radius 0 and passes Null object */
        || (range === 0 && (type !== LS_OBJECT || id != null))) {
        impossible('new_light_source:  illegal range %d', range);
        return null;
    }

    const ls = { next: null, x, y, range, type, id, flags: 0 };
    light_base().unshift(ls);

    game.vision_full_recalc = 1; /* make the source show up */
    return ls;
}

// C ref: light.c:98 del_light_source().  Assumes at most one light source is
// attached to an object at a time.
export function del_light_source(type, id) {
    let tmp_id;

    /* need to be prepared for dealing a with light source which has only
       been partially restored during a level change */
    switch (type) {
    case LS_NONE:
        impossible('del_light_source:type=none');
        tmp_id = 0;
        break;
    case LS_OBJECT:
        tmp_id = id ? id.o_id : 0;
        break;
    case LS_MONSTER:
        tmp_id = id === HERO ? 1 : id.m_id;
        break;
    default:
        tmp_id = 0;
        break;
    }

    /* find the light source from its id */
    let curr = null;
    for (const ls of light_base()) {
        if (ls.type !== type) continue;
        if (ls.id === ((ls.flags & LSF_NEEDS_FIXUP) ? tmp_id : id)) { curr = ls; break; }
    }
    if (curr) {
        delete_ls(curr);
    } else {
        impossible('del_light_source: not found type=%d', type);
    }
}

// C ref: light.c:141 delete_ls() — remove from the list and free.
function delete_ls(ls) {
    const list = light_base();
    const ix = list.indexOf(ls);
    if (ix >= 0) {
        list.splice(ix, 1);
        game.vision_full_recalc = 1;
    } else {
        impossible('delete_ls not found');
    }
}

// C ref: light.c:168 do_light_sources(cs_rows) — mark locations temporarily lit
// by mobile light sources.  cs_rows is the COULD_SEE bitmap vision_recalc() is
// filling in (one row array per y).
export function do_light_sources(cs_rows) {
    let at_hero_range = 0;

    for (const ls of light_base().slice()) {
        ls.flags &= ~LSF_SHOW;

        /* Check for moved light sources. */
        // C's get_obj_location()/get_mon_location() write <0,0> into ls->{x,y}
        // when they fail, so the failure path clears the position too.
        if (ls.type === LS_OBJECT) {
            if (ls.range === 0) { /* camera flash; caller has set ls.{x,y} */
                ls.flags |= LSF_SHOW;
            } else {
                const loc = get_obj_location(ls.id, 0);
                ls.x = loc ? loc.x : 0;
                ls.y = loc ? loc.y : 0;
                if (loc) ls.flags |= LSF_SHOW;
            }
        } else if (ls.type === LS_MONSTER) {
            const loc = get_mon_location(ls.id, 0);
            ls.x = loc ? loc.x : 0;
            ls.y = loc ? loc.y : 0;
            if (loc) ls.flags |= LSF_SHOW;
        }

        /* minor optimization: don't bother with duplicate light sources
           at hero */
        if (u_at(ls.x, ls.y)) {
            if (at_hero_range >= ls.range)
                ls.flags &= ~LSF_SHOW;
            else
                at_hero_range = ls.range;
        }

        if (ls.flags & LSF_SHOW) {
            const limits = circle_ptr(ls.range);
            let max_y = ls.y + ls.range;
            if (max_y >= ROWNO) max_y = ROWNO - 1;
            let y = ls.y - ls.range;
            if (y < 0) y = 0;
            for (; y <= max_y; y++) {
                const row = cs_rows[y];
                if (!row) continue;
                const offset = limits(Math.abs(y - ls.y));
                let min_x = ls.x - offset;
                if (min_x < 1) min_x = 1;
                let max_x = ls.x + offset;
                if (max_x >= COLNO) max_x = COLNO - 1;

                if (u_at(ls.x, ls.y)) {
                    /* the vision system already computed COULD_SEE from the
                       hero's position, and it fixes up clear_path()'s
                       cosmetic misses */
                    for (let x = min_x; x <= max_x; x++)
                        if (row[x] & COULD_SEE) row[x] |= TEMP_LIT;
                } else {
                    for (let x = min_x; x <= max_x; x++)
                        if ((ls.x === x && ls.y === y)
                            || clear_path(ls.x, ls.y, x, y))
                            row[x] |= TEMP_LIT;
                }
            }
        }
    }
}

// C ref: light.c:256 show_transient_light(obj, x, y) — a lit object flying
// through <x,y>, or (obj == null) a camera flash at <x,y>.
export async function show_transient_light(obj, x, y) {
    let ls = null;

    /* Null object indicates camera flash */
    if (!obj) {
        /* no need to temporarily light an already lit spot */
        if (game.level?.at(x, y)?.lit) return;

        /* radius 0 will just light <x,y>; the anything is Null */
        ls = new_light_core(x, y, 0, LS_OBJECT, null);
        if (!ls) return;
    } else {
        /* thrown or kicked object which is emitting light; validate its
           light source to obtain its radius (for monster sightings) */
        for (const cand of light_base()) {
            if (cand.type !== LS_OBJECT) continue;
            if (cand.id === obj) { ls = cand; break; }
        }
        if (!ls || obj.where !== 'free') {
            impossible('transient light not a light source / not free');
            return;
        }
    }

    if (obj) {
        /* put lit candle or lamp temporarily on the map.  C uses gb.bhitpos;
           at both C call sites (zap.c bhit) <x,y> IS gb.bhitpos, so fall back
           to it while this port has no bhitpos global. */
        place_object(obj, game.bhitpos?.x ?? x, game.bhitpos?.y ?? y);
    } else /* camera flash:  no object; set the light source's location */
        (ls.x = x, ls.y = y);

    /* full recalc; runs do_light_sources() */
    vision_recalc(0);
    await flush_screen(0);

    const radius_squared = ls.range * ls.range;
    for (const mon of fmon()) {
        if (DEADMONSTER(mon) || (mon.isgd && !mon.mx)) continue;
        /* a square enclosing the circle: an over-eager mtemplit only costs
           one extra canseemon() check later */
        if (dist2(mon.mx, mon.my, x, y) <= radius_squared) {
            if (canseemon_shared(mon)) mon.mtemplit = 1;
        }
    }

    if (obj) { /* take thrown/kicked candle or lamp off the map */
        await nh_delay_output();
        remove_object(obj);
    }
}

// C ref: light.c:329 transient_light_cleanup().
export async function transient_light_cleanup() {
    /* remove all object light sources not associated with a specific object */
    discard_flashes();
    if (game.vision_full_recalc) /* set by del_light_source() */
        vision_recalc(0);

    let mtempcount = 0;
    for (const mon of fmon()) {
        if (DEADMONSTER(mon)) continue;
        if (mon.mtemplit) {
            mon.mtemplit = 0;
            ++mtempcount;
            if (!canspotmon(mon)) map_invisible(mon.mx, mon.my);
        }
    }
    if (mtempcount) await flush_screen(0);
}

// C ref: light.c:360 discard_flashes() — camera flashes have a Null object.
function discard_flashes() {
    for (const ls of light_base().slice())
        if (ls.type === LS_OBJECT && !ls.id) delete_ls(ls);
}

// C ref: light.c:373 — (mon->mx == 0) implies migrating.
function mon_is_local(mon) { return mon === HERO ? true : mon.mx > 0; }

// C ref: light.c:375 find_mid(nid, fmflags).
export function find_mid(nid, fmflags) {
    if ((fmflags & FM_YOU) && nid === 1) return HERO;
    if (fmflags & FM_FMON)
        for (const mtmp of fmon())
            if (!DEADMONSTER(mtmp) && mtmp.m_id === nid) return mtmp;
    if (fmflags & FM_MIGRATE)
        for (const mtmp of migrating_mons())
            if (mtmp.m_id === nid) return mtmp;
    if (fmflags & FM_MYDOGS)
        for (const mtmp of mydogs())
            if (mtmp.m_id === nid) return mtmp;
    return null;
}

// C ref: light.c:397 whereis_mon(mon, fmflags) — unlike find_mid() this does
// NOT disregard a dead monster.
function whereis_mon(mon, fmflags) {
    if ((fmflags & FM_YOU) && mon === HERO) return FM_YOU;
    if (fmflags & FM_FMON)
        for (const mtmp of fmon()) if (mtmp === mon) return FM_FMON;
    if (fmflags & FM_MIGRATE)
        for (const mtmp of migrating_mons()) if (mtmp === mon) return FM_MIGRATE;
    if (fmflags & FM_MYDOGS)
        for (const mtmp of mydogs()) if (mtmp === mon) return FM_MYDOGS;
    return 0;
}

// C ref: light.c:420 save_light_sources(nhfp, range) — returns the records for
// the requested range (C writes them to the save file) and, for the
// release_data() pass, drops every source of the OTHER range from the list.
// `release` is C's release_data(nhfp): true on a level change / real save.
export function save_light_sources(range, release = true) {
    /* camera flash light sources have a Null object and wouldn't be useful
       after a restore; throw any away */
    discard_flashes();
    game.vision_full_recalc = 0;

    const count = maybe_write_ls(range, false);
    const records = [];
    const actual = maybe_write_ls(range, true, records);
    if (actual !== count)
        impossible('counted %d light sources, wrote %d! [range=%d]', count, actual, range);

    if (release) {
        const kept = [];
        for (const curr of light_base()) {
            let is_global;
            if (!curr.id) {
                impossible('save_light_sources: no id! [range=%d]', range);
                is_global = 0;
            } else {
                switch (curr.type) {
                case LS_OBJECT:
                    is_global = obj_is_local(curr.id) ? 0 : 1;
                    break;
                case LS_MONSTER:
                    is_global = mon_is_local(curr.id) ? 0 : 1;
                    break;
                default:
                    is_global = 0;
                    impossible('save_light_sources: bad type (%d) [range=%d]',
                               curr.type, range);
                    break;
                }
            }
            /* if global and not doing local, or vice versa, remove it */
            if (is_global ^ (range === RANGE_LEVEL ? 1 : 0)) continue;
            kept.push(curr);
        }
        game.light_base = kept;
    }
    return records;
}

// C ref: light.c:478 restore_light_sources(nhfp) — pull the structures back in
// without recalculating the object pointers (relink_light_sources does that).
export function restore_light_sources(records) {
    for (const rec of (records || [])) {
        const ls = { next: null, x: rec.x, y: rec.y, range: rec.range,
                     type: rec.type, id: rec.id, flags: rec.flags };
        light_base().unshift(ls);
    }
}

// C ref: light.c:500 light_stats(hdrfmt, hdrbuf, &count, &size) — the '#stats'
// wizard-mode command.  C's `size` is a byte total from sizeof(light_source),
// which has no JS analogue; report the record count for both, and the header
// with the struct size substituted as the record count of 1 entry.
export function light_stats(hdrfmt) {
    let count = 0;
    for (const _ls of light_base()) ++count;
    return { hdrbuf: (hdrfmt || '').replace(/%l?d/, '1'), count, size: count };
}

// C ref: light.c:516 relink_light_sources(ghostly).
export function relink_light_sources(ghostly) {
    for (const ls of light_base()) {
        if (ls.flags & LSF_NEEDS_FIXUP) {
            if (ls.type === LS_OBJECT || ls.type === LS_MONSTER) {
                let nid = ls.id;
                if (ghostly) {
                    const mapped = lookup_id_mapping(nid);
                    if (mapped == null)
                        throw new Error('relink_light_sources: no id mapping');
                    nid = mapped;
                }

                let which = '';
                if (ls.type === LS_OBJECT) {
                    ls.id = find_oid(nid);
                    if (!ls.id) which = 'o';
                } else {
                    ls.id = find_mid(nid, FM_EVERYWHERE);
                    if (!ls.id) which = 'm';
                }
                if (which !== '')
                    throw new Error(`relink_light_sources: can't find ${which}_id ${nid}`);
            } else {
                throw new Error(`relink_light_sources: bad type (${ls.type})`);
            }
            ls.flags &= ~LSF_NEEDS_FIXUP;
        }
    }
}

// C ref: light.c:570 maybe_write_ls(nhfp, range, write_it) — count the light
// sources of this range, and when write_it push each one's record into `out`.
function maybe_write_ls(range, write_it, out) {
    let count = 0;

    for (const ls of light_base()) {
        if (!ls.id) {
            impossible('maybe_write_ls: no id! [range=%d]', range);
            continue;
        }
        let is_global;
        switch (ls.type) {
        case LS_OBJECT:
            is_global = obj_is_local(ls.id) ? 0 : 1;
            break;
        case LS_MONSTER:
            is_global = mon_is_local(ls.id) ? 0 : 1;
            break;
        default:
            is_global = 0;
            impossible('maybe_write_ls: bad type (%d) [range=%d]', ls.type, range);
            break;
        }
        /* if global and not doing local, or vice versa, count it */
        if (is_global ^ (range === RANGE_LEVEL ? 1 : 0)) {
            count++;
            if (write_it && out) out.push(write_ls(ls));
        }
    }

    return count;
}

// C ref: light.c:605 light_sources_sanity_check().
export function light_sources_sanity_check() {
    for (const ls of light_base()) {
        if (!ls.id) throw new Error('insane light source: no id!');
        if (ls.type === LS_OBJECT) {
            const otmp = ls.id;
            if (find_oid(otmp.o_id) !== otmp)
                throw new Error(`insane light source: can't find obj #${otmp.o_id}!`);
        } else if (ls.type === LS_MONSTER) {
            const mtmp = ls.id;
            const auint = mtmp === HERO ? 1 : mtmp.m_id;
            if (find_mid(auint, FM_EVERYWHERE) !== mtmp)
                throw new Error(`insane light source: can't find mon #${auint}!`);
        } else {
            throw new Error(`insane light source: bad ls type ${ls.type}`);
        }
    }
}

// C ref: light.c:633 write_ls() — replace the obj/monst pointer with its id for
// the write, then put the pointer back.  Returns the record C would emit.
function write_ls(ls) {
    if (ls.type !== LS_OBJECT && ls.type !== LS_MONSTER) {
        impossible('write_ls: bad type (%d)', ls.type);
        return null;
    }
    if (ls.flags & LSF_NEEDS_FIXUP)
        return { x: ls.x, y: ls.y, range: ls.range, type: ls.type,
                 id: ls.id, flags: ls.flags };

    /* replace object pointer with id for write, then put back */
    const arg_save = ls.id;
    if (ls.type === LS_OBJECT) {
        const otmp = ls.id;
        ls.id = otmp.o_id;
        if (find_oid(ls.id) !== otmp) {
            impossible("write_ls: can't find obj #%u!", ls.id);
            ls.flags |= LSF_IS_PROBLEMATIC;
        }
    } else { /* ls.type === LS_MONSTER */
        const mtmp = ls.id;
        /* the stashed monst reference may no longer be in any chain; check
           before pulling m_id out of it (find_mid disregards a DEADMONSTER,
           whereis_mon does not) */
        const monloc = whereis_mon(mtmp, FM_EVERYWHERE);
        if (monloc !== 0) {
            ls.id = mtmp === HERO ? 1 : mtmp.m_id;
            if (find_mid(ls.id, monloc) !== mtmp) {
                impossible("write_ls: can't find mon #%u!", ls.id);
                ls.flags |= LSF_IS_PROBLEMATIC;
            }
        } else {
            impossible('write_ls: stashed monst ptr not in any chain');
            ls.flags |= LSF_IS_PROBLEMATIC;
        }
    }
    ls.flags |= LSF_NEEDS_FIXUP;
    const rec = { x: ls.x, y: ls.y, range: ls.range, type: ls.type,
                  id: ls.id, flags: ls.flags };
    ls.id = arg_save;
    ls.flags &= ~LSF_NEEDS_FIXUP;
    ls.flags &= ~LSF_IS_PROBLEMATIC;
    return rec;
}

// C ref: light.c:705 obj_move_light_source(src, dest).
export function obj_move_light_source(src, dest) {
    for (const ls of light_base())
        if (ls.type === LS_OBJECT && ls.id === src) ls.id = dest;
    src.lamplit = 0;
    dest.lamplit = 1;
}

// C ref: light.c:718 any_light_source().
export function any_light_source() {
    return light_base().length > 0;
}

// C ref: light.c:728 snuff_light_source(x, y) — snuff an object light source at
// <x,y>.  Only works for burning light sources.
export function snuff_light_source(x, y) {
    for (const ls of light_base()) {
        /* the positions were refreshed by the last vision update */
        if (ls.type === LS_OBJECT && ls.x === x && ls.y === y) {
            const obj = ls.id;
            if (obj_is_burning(obj)) {
                /* the only way to snuff Sunsword is to unwield it */
                if (artifact_light(obj)) continue;
                end_burn(obj, obj.otyp !== MAGIC_LAMP());
                /* the current ls has just been removed; assume one light
                   source per object and return */
                return;
            }
        }
    }
}

// C ref: timeout.c:1804 end_burn(obj, timer_attached) — DEFERRED in part: this
// port has no BURN_OBJECT timer (js/timeout.js has no timer queue and
// js/invent.js:686 stop_timer() is a stub returning 0), so the `timer_attached`
// arm — which would stop the timer and let cleanup_burn() do exactly the work
// below — cannot be taken.  Both arms end with the light source deleted and
// lamplit cleared, which is what this does.  Replace the body with a call to
// timeout.js end_burn() once the burn timer exists (see `deferred`).
function end_burn(obj, timer_attached) {
    if (!obj.lamplit) {
        impossible('end_burn: obj not lit');
        return;
    }
    if (obj.otyp === MAGIC_LAMP() || artifact_light(obj)) timer_attached = false;
    void timer_attached;
    del_light_source(LS_OBJECT, obj);
    obj.lamplit = 0;
    /* C: `if (obj->where == OBJ_INVENT) update_inventory()` — a no-op for a
       tty window port without perm_invent. */
}

// C ref: light.c:762 obj_sheds_light(obj).
export function obj_sheds_light(obj) {
    /* so far, only burning objects shed light */
    return obj_is_burning(obj);
}

// C ref: light.c:771 obj_is_burning(obj) — sheds light AND will be snuffed by
// end_burn().
export function obj_is_burning(obj) {
    return !!obj && !!obj.lamplit && (ignitable(obj) || artifact_light(obj));
}

// C ref: light.c:778 obj_split_light_source(src, dest).
export function obj_split_light_source(src, dest) {
    const list = light_base();
    /* C inserts each new source at the head, which never interferes with the
       walk because the walk is already past the insertion point; iterate over
       a snapshot to get the same effect. */
    for (const ls of list.slice()) {
        if (ls.type === LS_OBJECT && ls.id === src) {
            const new_ls = { ...ls };
            if (Is_candle(src)) {
                /* split candles may emit less light than the original group */
                ls.range = candle_light_range(src);
                new_ls.range = candle_light_range(dest);
                game.vision_full_recalc = 1; /* in case range changed */
            }
            new_ls.id = dest;
            list.unshift(new_ls);
            dest.lamplit = 1; /* now an active light source */
        }
    }
}

// C ref: light.c:807 obj_merge_light_sources(src, dest) — src has been folded
// into dest (merging lit candles, or adding candles to a lit candelabrum).
export function obj_merge_light_sources(src, dest) {
    /* src == dest implies adding to candelabrum */
    if (src !== dest) end_burn(src, true); /* extinguish candles */

    for (const ls of light_base())
        if (ls.type === LS_OBJECT && ls.id === dest) {
            ls.range = candle_light_range(dest);
            game.vision_full_recalc = 1; /* in case range changed */
            break;
        }
}

// C ref: light.c:825 obj_adjust_light_radius(obj, new_radius).
export function obj_adjust_light_radius(obj, new_radius) {
    for (const ls of light_base())
        if (ls.type === LS_OBJECT && ls.id === obj) {
            if (new_radius !== ls.range) game.vision_full_recalc = 1;
            ls.range = new_radius;
            return;
        }
    impossible("obj_adjust_light_radius: can't find obj");
}

// C ref: light.c:842 candle_light_range(obj) — candlelight is proportional to
// the number of candles; minimum range 2 for playability.
export function candle_light_range(obj) {
    let radius;

    if (obj.otyp === CANDELABRUM_OF_INVOCATION()) {
        /* 1..3 candles range 2, 4..6 range 3, 7 range 4 */
        radius = (obj.spe < 4) ? 2 : (obj.spe < 7) ? 3 : 4;
    } else if (Is_candle(obj)) {
        /* range grows quadratically: 1..3 -> 2, 4..8 -> 3, 9..15 -> 4, &c. */
        const n = obj.quan;

        radius = 1; /* always incremented at least once */
        while (radius * radius <= n && radius < MAX_RADIUS) {
            radius++;
        }
    } else {
        /* only called for a lit candelabrum or candles */
        radius = 3; /* lamp's value */
    }
    return radius;
}

// C ref: light.c:880 arti_light_radius(obj) — a light-emitting artifact's range
// depends on its curse/bless state.
export function arti_light_radius(obj) {
    /* sanity check [simplifies usage by bless()/curse()/&c] */
    if (!obj.lamplit || !artifact_light(obj)) return 0;

    /* a cursed radius of 1 is not noticeable when the hero carries it, but is
       when a monster does or it is left lit on the floor */
    let res = (obj.blessed ? 3 : !obj.cursed ? 2 : 1);

    /* embedded gold dragon scales (poly'd hero) give minimum radiance;
       otherwise worn gold DSM gives off more light than other sources */
    if (obj === game.uskin) res = 1;
    else if (obj.otyp === GOLD_DRAGON_SCALE_MAIL()) ++res; /* DSM but not scales */

    return res;
}

// C ref: light.c:915 arti_light_description(obj).
export function arti_light_description(obj) {
    switch (arti_light_radius(obj)) {
    case 4:
        return 'radiantly'; /* blessed gold dragon scale mail */
    case 3:
        return 'brilliantly'; /* blessed artifact, uncursed gold DSM */
    case 2:
        return 'brightly'; /* uncursed artifact, cursed gold DSM */
    case 1:
        return 'dimly'; /* cursed artifact, embedded scales */
    default:
        break;
    }
    return 'strangely';
}

// C ref: light.c:934 wiz_light_sources() — the #lightsources command.  Returns
// the menu lines; the wizard-mode command dispatcher is cmd.c's.
export function wiz_light_sources() {
    const lines = [];
    lines.push(`Mobile light sources: hero @ (${pad2(game.u?.ux)},${pad2(game.u?.uy)})`);
    lines.push('');

    const list = light_base();
    if (list.length) {
        lines.push('location range flags  type    id');
        lines.push('-------- ----- ------ ----  -------');
        for (const ls of list) {
            const kind = ls.type === LS_OBJECT ? 'obj'
                : ls.type === LS_MONSTER
                    ? (mon_is_local(ls.id) ? 'mon' : (ls.id === HERO ? 'you' : '<m>'))
                    : '???';
            lines.push(`  ${pad2(ls.x)},${pad2(ls.y)}   ${pad2(ls.range)}   `
                       + `0x${(ls.flags >>> 0).toString(16).padStart(4, '0')}  ${kind}`);
        }
    } else {
        lines.push('<none>');
    }
    return lines;
}

function pad2(n) { return String(n ?? 0).padStart(2, ' '); }

// ── leaves that belong to other C files ──

// C ref: timeout.c:2560 obj_is_local(obj) — TRUE if the object stays on the
// level when the level is saved.  (C panics on any other `where`; this port's
// 'free' objects are mid-transit, so treat them as C's OBJ_FLOOR.)
function obj_is_local(obj) {
    switch (obj?.where) {
    case 'invent':
    case 'migrating':
        return false;
    case 'floor':
    case 'buried':
        return true;
    case 'contained':
        return obj_is_local(obj.ocontainer);
    case 'minvent':
        return mon_is_local(obj.ocarry);
    default:
        break;
    }
    return true;
}

// C ref: shk.c:2777 find_oid(id) — locate an object anywhere by its o_id.  The
// full C version also walks the migrating/buried/bones chains; this walks the
// chains this port actually has (floor pile, hero inventory and its containers,
// monster inventories).  Belongs in shk.c's module (see `deferred`).
function find_oid(id) {
    const seen = (list) => {
        for (const o of (list || [])) {
            if (o.o_id === id) return o;
            const inside = seen(o.cobj);
            if (inside) return inside;
        }
        return null;
    };
    let hit = seen(game.invent);
    if (hit) return hit;
    hit = seen(game.level?.objects);
    if (hit) return hit;
    for (const mon of fmon()) {
        hit = seen(mon.minvent);
        if (hit) return hit;
    }
    return null;
}

// C ref: restore.c lookup_id_mapping(gid, nid) — the bones-file id remap.  This
// port does not load bones from another game, so the map is empty and every
// lookup fails (C panics, which relink_light_sources() turns into a throw).
function lookup_id_mapping(gid) {
    const map = game.id_map;
    if (!map) return null;
    const nid = map.get ? map.get(gid) : map[gid];
    return nid == null ? null : nid;
}

// C ref: display.h:129 canspotmon(mon) = canseemon(mon) || sensemon(mon).
// js/uhitm.js exports a canspotmon, but importing it here would drag the whole
// melee module into a vision-layer file; this pairs display.js's canseemon with
// the same sensemon() js/mon.js:655 keeps private.
function canspotmon(mon) {
    if (canseemon_shared(mon)) return true;
    return sensemon(mon);
}

// C ref: display.h:43 _tp_sensemon(mon) — the hero senses a monster with a mind
// when blind+telepathic, or with a telepathy-inducing item within its range.
function tp_sensemon(mon) {
    const u = game.u, p = u?.uprops || {};
    if (mindless(mon.data)) return false;
    /* Blind_telepat is the INTRINSIC half; it only works while blind */
    const blind = (u?.blinded || 0) > 0 || !!game.ublindf;
    if (blind && ((p.Telepat ?? 0) || (p.HTelepat ?? 0))) return true;
    /* Unblind_telepat is the EXTRINSIC (worn/wielded) half only */
    return !!p.ETelepat
        && dist2(mon.mx, mon.my, u?.ux ?? 0, u?.uy ?? 0) <= (u?.unblind_telepat_range ?? -1);
}

// C ref: display.h:55 _sensemon(mon).  MATCH_WARN_OF_MON needs svc.warntype
// (worn warn-of-monster gear), which this port does not track at all; it is the
// one term left out (same omission js/mon.js:645 documents).
function sensemon(mon) {
    if (!mon) return false;
    const u = game.u, p = u?.uprops || {};
    if (u?.uswallow && mon !== u.ustuck) return false;
    if (u?.uunderwater
        && !(dist2(mon.mx, mon.my, u.ux, u.uy) <= 2 && is_pool(mon.mx, mon.my)))
        return false;
    return !!((p.Detect_monsters ?? 0) || (p.HDetect_monsters ?? 0))
        || tp_sensemon(mon);
}

// C ref: windows nh_delay_output() — the 50ms pause a transient light uses so
// the player can see the flash.  The recorded corpora are screen-diffed, not
// timed, so this is a yield rather than a sleep.
async function nh_delay_output() { await Promise.resolve(); }

// C ref: vision.c:703 — vision_recalc() calls do_light_sources(next_array).
// js/vision.js cannot import this file directly (doing so reorders ESM module
// evaluation and TDZ-traps mkobj.js via u_init.js), so the entry point is
// registered here and vision.js reads it through gstate.  jsmain.js imports
// this module for the side effect.
hooks.lightsources = (cs_rows) => {
    sync_monster_light_sources();
    do_light_sources(cs_rows);
};
