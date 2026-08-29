// detect.js — magic detection / search helpers.
// C ref: detect.c.  Ports findit() (secret-door-detection wand / detect-unseen
// spell), which scans the area around the hero for hidden doors, corridors,
// traps and monsters, reveals them, and reports what (if anything) was found.

import { game } from './gstate.js';
import { pline, newsym, terrain_background_glyph, show_glyph_cell,
         object_glyph, vobj_at, trap_glyph, engraving_glyph } from './display.js';
import { engr_at } from './engrave.js';
import { couldsee } from './vision.js';
import { exercise } from './attrib.js';
import { COLNO, ROWNO, BOLT_LIM, SDOOR, SCORR, DOOR, CORR, A_WIS, IS_FURNITURE,
         STONE, W_NONDIGGABLE, W_NONPASSWALL, ROOMOFFSET } from './const.js';
import { room_discovered } from './dungeon.js';
import { BOULDER, COIN_CLASS, GOLD_PIECE, objects } from './mkobj.js';
import { NO_COLOR, CLR_WHITE } from './terminal.js';
import { rnd } from './rng.js';

// Additional imports used only by the translated block at the end of this file.
import { m_at, docrt, cls, covers_objects, map_invisible, unmap_object,
         terrain_glyph, see_monsters, update_topl, flush_screen,
         Hallucination_u, impossible } from './display.js';
import { Blind, cansee, unblock_point, clear_area_cells } from './vision.js';
import { TER_DETECT, TER_MAP, TER_TRP, TER_OBJ, TER_MON, TER_FULL, SVALL,
         COULD_SEE, IN_SIGHT, I_SPECIAL, isok, IS_DOOR, ROOM,
         D_NODOOR, D_BROKEN, D_ISOPEN, D_CLOSED, D_LOCKED, D_TRAPPED,
         BEAR_TRAP, STATUE_TRAP, TRAPPED_DOOR, TRAPPED_CHEST, STAIRS, LADDER,
         FOUNTAIN, THRONE, SINK, ALTAR, GRAVE,
         IS_WALL as IS_WALL_D } from './const.js';
import { MAXOCLASSES, POTION_CLASS, FOOD_CLASS, ROCK_CLASS, CHEST, LARGE_BOX,
         STRANGE_OBJECT } from './mkobj.js';
import { rn2 } from './rng.js';
import { NUMMONS } from './disprng.js';
import { random_monster as random_monster_disp,
         random_object as random_object_disp } from './disprng.js';
import { observe_object } from './o_init.js';
import { monster_by_pmidx } from './makemon.js';
import { depth } from './hacklib.js';
import { S_corr, S_room, S_darkroom, S_litcorr, S_stone, S_vwall, S_ndoor,
         S_vodoor, S_vcdoor, S_upstair, S_upladder, S_fountain, S_throne,
         S_sink, S_altar, S_grave, defsyms, def_oc_syms } from './symbols.js';

// objclass.h obj_material_types GOLD == 15 (the blessed-scroll "any gold
// object" scan, o_material(obj, GOLD)).
const GOLD_MATERIAL = 15;

// C ref: detect.c findone — reveal a single hidden feature at (zx,zy).
function findone(zx, zy, found) {
    const lev = game.level?.at(zx, zy);
    if (!lev) return;

    if (lev.typ === SDOOR) {
        lev.typ = DOOR;
        newsym(zx, zy);
        found.num_sdoors++;
    } else if (lev.typ === SCORR) {
        lev.typ = CORR;
        newsym(zx, zy);
        found.num_scorrs++;
    }

    const ttmp = (game.level?.traps || []).find(t => t.tx === zx && t.ty === zy);
    if (ttmp && !ttmp.tseen && ttmp.ttyp !== undefined) {
        ttmp.tseen = true;
        newsym(zx, zy);
        found.num_traps++;
    }
    // Hidden / invisible monster detection is not modeled (no such monsters
    // on the covered starting levels), so num_mons stays 0.
}

// C ref: vision.c do_clear_area — apply findone to each cell within range that
// the hero couldsee.  Approximated with a square scan clamped to the bolt
// circle radius; on the covered starts nothing is hidden so exact circle
// geometry is immaterial.
function do_clear_area(scol, srow, range, found) {
    const maxY = Math.min(srow + range, ROWNO - 1);
    const minY = Math.max(srow - range, 0);
    for (let y = minY; y <= maxY; y++) {
        const offset = range;
        const minX = Math.max(scol - offset, 1);
        const maxX = Math.min(scol + offset, COLNO - 1);
        for (let x = minX; x <= maxX; x++)
            if (couldsee(x, y))
                findone(x, y, found);
    }
}

// C ref: detect.c findit — reveal nearby hidden things and report.  Returns
// the count found.
export async function findit() {
    if (game.u?.uswallow) return 0;

    const found = { num_sdoors: 0, num_scorrs: 0, num_traps: 0, num_mons: 0 };
    do_clear_area(game.u.ux, game.u.uy, BOLT_LIM, found);

    const k = (found.num_sdoors ? 1 : 0) + (found.num_scorrs ? 1 : 0)
            + (found.num_traps ? 1 : 0) + (found.num_mons ? 1 : 0);
    let buf = '';
    let num = 0;
    if (found.num_sdoors) {
        buf += found.num_sdoors > 1 ? `${found.num_sdoors} secret doors` : 'a secret door';
        num += found.num_sdoors;
    }
    if (found.num_scorrs) {
        if (buf) buf += (k === 2) ? ' and ' : ', ';
        buf += found.num_scorrs > 1 ? `${found.num_scorrs} secret corridors` : 'a secret corridor';
        num += found.num_scorrs;
    }
    if (found.num_traps) {
        if (buf) buf += (k === 3 && !found.num_mons) ? ', and ' : (k === 2) ? ' and ' : ', ';
        buf += found.num_traps > 1 ? `${found.num_traps} traps` : 'a trap';
        num += found.num_traps;
    }
    if (found.num_mons) {
        if (buf) buf += (k > 2) ? ', and ' : ' and ';
        buf += found.num_mons > 1 ? `${found.num_mons} hidden monsters` : 'a hidden monster';
        num += found.num_mons;
    }
    if (buf)
        await pline(`You reveal ${buf}!`);

    if (!num)
        await pline("You don't find anything.");

    return num;
}

// C ref: detect.c show_map_spot(x, y, cnf) — reveal one cell's terrain into hero
// memory.  Secret corridors are exposed (but not secret doors).
// Furniture/traps/objects layering is simplified to the terrain background,
// which covers the open-room starting levels.
//
// `cnf` is C's Confusion, and it is NOT decorative: the `cnf && rn2(7)` guard
// draws once per cell for all 79x21 = 1659 cells, so a confused mapping both
// costs 1659 core draws and reveals only ~1/7 of the level.  js/read.js sets
// Confusion for a CURSED scroll of magic mapping, so this was reachable through
// an ordinary item: we mapped the whole level for zero draws where C maps a
// seventh for 1659.  cnf also suppresses the engraving arm and the #overview
// room_discovered() call.
function show_map_spot(x, y, cnf) {
    if (cnf && rn2(7)) return;
    const lev = game.level?.at(x, y);
    if (!lev) return;
    lev.seenv = 0xff;
    if (lev.typ === SCORR)
        lev.typ = CORR;

    // C ref: detect.c show_map_spot — "force the real background, then if it's
    // not furniture and there's a known trap there, display the trap, else if
    // there was an object shown there, redisplay the object.  So during mapping,
    // furniture takes precedence over traps, which take precedence over objects,
    // opposite to how normal vision behaves."
    let bg = terrain_background_glyph(lev, x, y);
    // C's map_trap(t, 1) / map_engraving(ep, 1) run AFTER newsym() and SHOW
    // their glyph, so during mapping a trap outranks whatever newsym just drew
    // there — including a live monster standing on it (seed4500 step 1241 shows
    // the giant spider's web, not the spider).
    let overrideShown = false;
    if (!IS_FURNITURE(lev.typ)) {
        const t = (game.level?.traps || []).find((tr) => tr.tx === x && tr.ty === y);
        const ep = engr_at(x, y);
        if (t && t.tseen) {
            bg = trap_glyph(t);
            overrideShown = true;
        } else if (ep && !cnf) {                  /* C: `ep != 0 && !cnf` */
            ep.erevealed = 1;                     /* map_engraving(ep, 1) */
            bg = engraving_glyph(lev);
            overrideShown = true;
        }
        // C's third arm restores a previously-shown trap/object glyph via
        // glyph_is_trap(oldglyph)/glyph_is_object(oldglyph); this port's
        // remembered_glyph carries no glyph-kind tag, so it is left out rather
        // than guessed at.
    }
    // Remember the background so the cell shows even out of sight (matches the
    // dim "magic-mapped" rendering once the hero looks away).
    lev.remembered_glyph = { ch: bg.ch, color: bg.color, decgfx: bg.dec, mapped: true };
    // Redraw via newsym so visible cells stay live and remembered ones appear.
    newsym(x, y);
    if (overrideShown || lev.disp_ch === ' ' || lev.disp_ch == null)
        show_glyph_cell(x, y, bg.ch, bg.color, bg.dec);
    // C ref: detect.c:1416 — "possibly update #overview".  Magic mapping learns
    // every room on the level, which is how #overview names a shop the hero
    // never walked into.  C's guard is `!cnf && lev->roomno >= ROOMOFFSET`.
    if (!cnf && (lev.roomno ?? 0) >= ROOMOFFSET)
        room_discovered(lev.roomno - ROOMOFFSET);
}

// C ref: detect.c do_mapping — reveal the whole level into hero memory, then
// exercise Wisdom (rn2(19) via exercise).
export async function do_mapping() {
    // C ref: detect.c do_mapping() — `show_map_spot(zx, zy, Confusion)`, x outer.
    const cnf = d_Confusion();
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++)
            show_map_spot(x, y, cnf);
    exercise(A_WIS, true);
}

// C ref: detect.c gold_detect(sobj) — the scroll/spell of gold detection.
// Returns TRUE when nothing was detected (C's caller then does the
// strange_feeling()/useup); FALSE when the gold map was shown.
//
// This whole command was previously unported, so seffects() fell through its
// default and the browse_map() cursor loop never ran — the keystrokes C feeds
// to getpos then reached the command parser and moved the hero for real.
export async function gold_detect(sobj, getposFn, docrtFn, updateTopl, moreFn, flushFn) {
    const u = game.u;
    const objs = (game.level?.objects || []).filter((o) => o.where === 'floor');
    const gold = objs.filter((o) => o.oclass === COIN_CLASS
                                 || (sobj?.blessed && objects[o.otyp]?.material === GOLD_MATERIAL));
    // C: monsters carrying gold map a synthetic pile at their square, whose
    // quan is rnd(10) — an RNG draw, so it must only happen when one does.
    const goldmons = (game.level?.monsters || []).filter(
        (m) => !(m.mhp != null && m.mhp <= 0)
            && (m.minvent || []).some((o) => o.oclass === COIN_CLASS));

    // gk.known: any gold anywhere (carried by a monster, or on the floor).
    // "only under me" (every pile is on the hero's square) is not the
    // outgoldmap path — C prints "You notice some gold between your feet."
    const offSelf = gold.some((o) => o.ox !== u.ux || o.oy !== u.uy);
    if (!gold.length && !goldmons.length) return true;
    if (!offSelf && !goldmons.length) {
        await updateTopl(`You notice some gold between your ${makeplural_foot()}.`);
        return false;
    }

    // outgoldmap: cls() first does display_nhwindow(WIN_MESSAGE, FALSE), which
    // fires the pending --More-- (wintty.c:1874) — BEFORE the gold map is
    // painted, so the recorded --More-- frame still shows the ordinary map.
    if (game._toplin === 1) await moreFn();
    // ...then it blanks the map.  Each detected pile is map_object()ed, which
    // writes hero MEMORY as well as the live display, so the '$'s survive the
    // closing map_redisplay()/docrt().
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++)
            show_glyph_cell(x, y, ' ', NO_COLOR, false);
    let ugold = false;
    const mark = (x, y, obj) => {
        const g = object_glyph(obj);
        const loc = game.level?.at(x, y);
        if (loc) loc.remembered_glyph = { ch: g.ch, color: g.color, decgfx: g.dec };
        show_glyph_cell(x, y, g.ch, g.color, g.dec);
        if (x === u.ux && y === u.uy) ugold = true;
    };
    for (const o of gold) mark(o.ox, o.oy, o);
    for (const m of goldmons) {
        const fake = { otyp: GOLD_PIECE, oclass: COIN_CLASS, quan: rnd(10) };
        mark(m.mx, m.my, fake);
    }
    if (!ugold) {
        // newsym(u.ux, u.uy) redraws the hero on top of the blanked map.
        show_glyph_cell(u.ux, u.uy, '@', CLR_WHITE, false);
    }
    await flushFn(1);
    await updateTopl('You feel very greedy, and sense gold!');
    exercise(A_WIS, true);

    // browse_map(TER_DETECT|TER_OBJ[|TER_MON], "gold")
    await getposFn('gold');
    // map_redisplay() -> docrt()
    await docrtFn();
    return false;
}

// C ref: body_part(FOOT) pluralised — the hero is always humanoid here.
function makeplural_foot() { return 'feet'; }

// C ref: detect.c skip_premap_detect — a STONE cell flagged both nondiggable
// and nonpasswall is outside the special level's own map footprint (the rest
// of the level, solidified at finalize); premap_detect leaves it unmapped.
function skip_premap_detect(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return true;
    return loc.typ === STONE
        && ((loc.wall_info || 0) & (W_NONDIGGABLE | W_NONPASSWALL))
            === (W_NONDIGGABLE | W_NONPASSWALL);
}

// C ref: detect.c premap_detect() — used by splev_initlev() when a special
// level (Sokoban) sets the "premapped" level flag.  Maps every reachable
// cell's background (terrain + a boulder object, if any) into hero memory,
// and marks every trap on the level tseen.  No RNG.
export function premap_detect() {
    for (let x = 1; x < COLNO; x++) {
        for (let y = 0; y < ROWNO; y++) {
            if (skip_premap_detect(x, y)) continue;
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            loc.seenv = 0xff; // SVALL
            loc.waslit = true;
            const bg = terrain_background_glyph(loc, x, y);
            loc.remembered_glyph = { ch: bg.ch, color: bg.color, decgfx: bg.dec };
            const obj = vobj_at(x, y);
            if (obj && obj.otyp === BOULDER) {
                const og = object_glyph(obj);
                if (og) loc.remembered_glyph = { ch: og.ch, color: og.color, decgfx: og.dec };
            }
        }
    }
    for (const trap of game.level?.traps || []) {
        trap.tseen = true;
        const loc = game.level?.at(trap.tx, trap.ty);
        if (!loc || skip_premap_detect(trap.tx, trap.ty)) continue;
        const tg = trap_glyph(trap);
        loc.remembered_glyph = { ch: tg.ch, color: tg.color, decgfx: tg.dec };
    }
}

// ===========================================================================
// detect.c, remainder.
//
// STATUS: INERT.  Nothing below this banner is called from any existing code
// path in js/; each function is a faithful translation waiting for its call
// site to be wired one at a time.
//
// Two model gaps the block has to bridge:
//
//  * GLYPHS.  C keeps one integer glyph per cell (gbuf[][] live,
//    levl[][].glyph remembered) and answers glyph_is_object() /
//    glyph_is_trap() / glyph_to_obj() by range test.  This port keeps
//    {ch,color,decgfx} descriptors (loc.disp_* live, loc.remembered_glyph
//    remembered) with no kind tag, so glyph_at() below recovers the kind by
//    asking which of the cell's possible glyph producers drew the character
//    that is actually on screen — the technique js/hack.js already uses for
//    farlook and do_look_all.  map_trap() additionally stamps
//    loc.mapped_trap_ttyp, because a trapped-chest / trapped-door glyph
//    belongs to no gf.ftrap entry and t_at() cannot find it.
//
//  * RNG STREAM.  map_monst()'s Hallucination arm draws off
//    rn2_on_display_rng (display.h newsym_rn2 is that stream, the separate
//    isaac64 in js/disprng.js), but sense_trap() passes plain `rn2` to
//    random_object()/random_monster(), so ITS hallucinated glyph comes off the
//    CORE stream.  js/disprng.js's random_object/random_monster helpers are
//    hardwired to the display stream, hence the core-stream copies below.
//    Getting this backwards is invisible in the recorded core RNG trace.

/* obj.h:334-340 */
function d_Has_contents(o) { return !!(o && Array.isArray(o.cobj) && o.cobj.length); }
function d_cobj(o) { return d_Has_contents(o) ? o.cobj : []; }
function d_Is_box(o) { return !!o && (o.otyp === LARGE_BOX || o.otyp === CHEST); }
function d_SchroedingersBox(o) { return !!o && o.otyp === LARGE_BOX && o.spe === 1; }

/* monst.h:214 */
function d_DEADMONSTER(m) { return (m?.mhp ?? 1) < 1; }

// C ref: rm.h fmon / svl.level.objects[][] / svl.level.buriedobjlist.  This
// port keeps floor objects in ONE flat array with .ox/.oy/.where (see
// js/do.js:628 for why js/invent.js's grid-indexing sobj_at() answers null),
// and buried objects in TWO unmerged arrays: mkobj.js add_to_buried() pushes
// `buriedobjlist`, mklev.js:6675 bury() pushes `buriedobjs`.  Read both.
function d_fmon() { return game.level?.monsters || []; }
function d_fobj() {
    return (game.level?.objects || []).filter((o) => o.where === 'floor');
}
function d_objs_at(x, y) {
    return (game.level?.objects || []).filter(
        (o) => o.where === 'floor' && o.ox === x && o.oy === y);
}
function d_OBJ_AT(x, y) { return d_objs_at(x, y).length > 0; }
function d_buriedobjs() {
    return [...(game.level?.buriedobjlist || []), ...(game.level?.buriedobjs || [])];
}
function d_sobj_at(otyp, x, y) {
    for (const o of d_objs_at(x, y)) if (o.otyp === otyp) return o;
    return null;
}
/* trap.c t_at(x,y) */
function d_t_at(x, y) {
    for (const t of (game.level?.traps || [])) if (t.tx === x && t.ty === y) return t;
    return null;
}
/* you.h:558,562 + hack.h distu */
function d_u_at(x, y) { return x === game.u?.ux && y === game.u?.uy; }
function d_distu(x, y) {
    const dx = x - (game.u?.ux ?? 0), dy = y - (game.u?.uy ?? 0);
    return dx * dx + dy * dy;
}
/* mondata.h digests(ptr) == attacktype(ptr, AT_ENGL) */
function d_digests(ptr) {
    return (ptr?.mattk || []).some((a) => a && a.aatyp === 12 /* AT_ENGL */);
}
/* hack.h Confusion — mirrors js/allmain.js:1414. */
function d_Confusion() { return !!(game.u?.uconf || game.u?.HConfusion); }
/* pline.c Norep() — suppress when identical to the persistent top line. */
async function d_Norep(msg) {
    if (game._toplines === msg) return;
    await update_topl(msg);
}

// C ref: display.h random_monster(rng)/random_object(rng) with rng == rn2, the
// CORE stream (sense_trap's callers).  js/disprng.js's same-named helpers are
// bound to rn2_on_display_rng and must NOT be used here.
const D_FIRST_OBJECT = 18;                 /* objects.h MARKER(FIRST_OBJECT) */
function d_random_monster_core() { return rn2(NUMMONS); }
function d_random_object_core() {
    return rn2(objects.length - D_FIRST_OBJECT) + D_FIRST_OBJECT;
}

// C ref: detect.c:49 `static struct trap dummytrap` — reused by every caller
// that needs to draw a trap glyph for a trapped door or chest, neither of
// which is part of the gf.ftrap chain.
const dummytrap = { tx: 0, ty: 0, ttyp: 0, tseen: 0 };

// C ref: detect.c:64 `#define ALL_CLASSES (MAXOCLASSES + 1)` — clear_stale_map's
// wildcard class.
const ALL_CLASSES = MAXOCLASSES + 1;

// ── display.c primitives this port has no named equivalent for ─────────────

// C ref: display.h glyph_at(x,y) — the DISPLAYED glyph.  Returned as a tagged
// descriptor (see the banner) rather than an int; `kind` is one of
// 'monster' | 'object' | 'trap' | 'invisible' | 'cmap' | 'unexplored'.
function glyph_at(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return { kind: 'unexplored', x, y };
    const sym = (loc.disp_ch != null) ? loc.disp_ch : ' ';
    if (loc.invisMon && sym === 'I') return { kind: 'invisible', x, y };
    if (d_u_at(x, y)) return { kind: 'monster', mon: null, isyou: true, x, y };
    const mon = m_at(x, y);
    if (mon && sym === (mon.data?.mlet ?? '\0'))
        return { kind: 'monster', mon, x, y };
    // C's trap-glyph test comes AFTER objects in _map_location's precedence but
    // BEFORE it here, because a mapped trapped chest/door glyph (stamped by
    // map_trap below) is what trapped_chest_at()/trapped_door_at() are asking
    // about and it sits on top of whatever object is on the square.
    if (loc.mapped_trap_ttyp)
        return { kind: 'trap', trap: null, ttyp: loc.mapped_trap_ttyp, x, y };
    const otmp = vobj_at(x, y);
    if (otmp && !covers_objects(loc)) {
        const og = object_glyph(otmp);
        if (og && og.ch === sym)
            return { kind: 'object', obj: otmp, otyp: otmp.otyp, x, y };
    }
    const t = d_t_at(x, y);
    if (t && t.tseen && !covers_objects(loc)) {
        const tg = trap_glyph(t);
        if (tg && tg.ch === sym)
            return { kind: 'trap', trap: t, ttyp: t.ttyp, x, y };
    }
    if (!loc.seenv && loc.remembered_glyph == null)
        return { kind: 'unexplored', x, y };
    return { kind: 'cmap', sym, cmap: cmap_index_for(loc, x, y), x, y };
}

// The cmap index a cell's terrain draws as.  C reads it back out of the integer
// glyph (glyph_to_cmap); here it comes from levl[][].typ, which is what
// back_to_glyph() derives every cmap glyph from in the first place.
function cmap_index_for(loc, x, y) {
    const t = loc.typ;
    if (t === STONE || t === SCORR) return S_stone;
    if (IS_WALL_D(t) || t === SDOOR) return S_vwall;
    if (t === DOOR) {
        if ((loc.doormask | 0) & (D_CLOSED | D_LOCKED)) return S_vcdoor;
        if ((loc.doormask | 0) & D_ISOPEN) return S_vodoor;
        return S_ndoor;
    }
    if (t === CORR) return (cansee(x, y) && loc.waslit) ? S_litcorr : S_corr;
    if (t === ROOM) return cansee(x, y) ? S_room : S_darkroom;
    if (t === STAIRS) return S_upstair;
    if (t === LADDER) return S_upladder;
    if (t === FOUNTAIN) return S_fountain;
    if (t === THRONE) return S_throne;
    if (t === SINK) return S_sink;
    if (t === ALTAR) return S_altar;
    if (t === GRAVE) return S_grave;
    return S_room;
}
function glyph_is_object(g) { return g?.kind === 'object'; }
function glyph_is_trap(g) { return g?.kind === 'trap'; }
function glyph_is_monster(g) { return g?.kind === 'monster'; }
function glyph_is_invisible(g) { return g?.kind === 'invisible'; }
function glyph_is_cmap(g) { return g?.kind === 'cmap'; }
function glyph_is_unexplored(g) { return g?.kind === 'unexplored'; }
function glyph_to_obj(g) { return g?.otyp ?? STRANGE_OBJECT; }

// C ref: display.c back_to_glyph(x,y) — the bare terrain glyph (js/display.js
// terrain_glyph is this port's copy).
function back_to_glyph(x, y) {
    const loc = game.level?.at(x, y);
    return loc ? terrain_glyph(loc, x, y) : { ch: ' ', color: NO_COLOR, dec: false };
}

// C ref: display.c magic_map_background(x,y,show) — display.c map_background()
// plus the "out of sight lit corridors and rooms the hero doesn't remember as
// lit" correction.  js/display.js terrain_background_glyph() is back_to_glyph only
// and omits that correction, which is why this is spelled out here.
function magic_map_background(x, y, show) {
    const loc = game.level?.at(x, y);
    if (!loc) return;
    let g = back_to_glyph(x, y);
    if (!cansee(x, y) && !loc.waslit) {
        if (loc.typ === ROOM && g.ch === defsyms[S_room].sym) {
            // flags.dark_room and iflags.use_color both default on, so the
            // DARKROOMSYM ('.' at CLR_BLACK, defsyms[S_darkroom]) arm is taken
            // rather than GLYPH_NOTHING.
            g = (game.flags?.dark_room !== false && game.flags?.color !== false)
                ? { ch: defsyms[S_darkroom].sym, color: defsyms[S_darkroom].color,
                    dec: false }
                : { ch: ' ', color: NO_COLOR, dec: false };
        } else if (loc.typ === CORR && g.ch === defsyms[S_litcorr].sym
                   && g.color === defsyms[S_litcorr].color) {
            g = { ch: defsyms[S_corr].sym, color: defsyms[S_corr].color, dec: false };
        }
    }
    if (game.level?.flags?.hero_memory) {
        loc.remembered_glyph = { ch: g.ch, color: g.color, decgfx: g.dec };
        loc.mapped_trap_ttyp = 0;
    }
    if (show) show_glyph_cell(x, y, g.ch, g.color, g.dec);
}

// C ref: display.c map_trap(trap, show).  The extra loc.mapped_trap_ttyp stamp
// is what lets glyph_at() report a trapped chest/door that is in no ftrap chain.
function map_trap(trap, show) {
    const x = trap.tx, y = trap.ty, loc = game.level?.at(x, y);
    if (!loc) return;
    const g = trap_glyph(trap);
    if (game.level?.flags?.hero_memory) {
        loc.remembered_glyph = { ch: g.ch, color: g.color, decgfx: g.dec };
        loc.mapped_trap_ttyp = trap.ttyp;
    }
    if (show) show_glyph_cell(x, y, g.ch, g.color, g.dec);
}

// C ref: display.c map_object(obj, show).  The generic-object upgrade and the
// Hallucination statue split are both reproduced; the hallucinated draws come
// off the DISPLAY rng (obj_to_glyph(obj, newsym_rn2)).
function map_object(obj, show) {
    const x = obj.ox, y = obj.oy, loc = game.level?.at(x, y);
    if (!loc) return;
    let g;
    const halluc = Hallucination_u();
    const STATUE_OTYP_D = 481;                 /* objects.h STATUE */
    if (halluc) {
        // obj_to_glyph -> random_obj_to_glyph / statue_to_glyph on the display
        // rng; the exact glyph does not matter to the callers here, only that
        // the draws happen (and in this order).
        const otyp = random_object_disp(objects.length);
        const mon = (otyp === 259 /* CORPSE */) ? monster_by_pmidx(random_monster_disp())
                                               : null;
        if (obj.otyp === STATUE_OTYP_D) {
            const m2 = monster_by_pmidx(random_monster_disp());
            random_monster_disp();                 /* statue_to_glyph gender pick */
            g = { ch: m2?.mlet || 'x', color: m2?.mcolor ?? NO_COLOR, dec: false };
        } else {
            g = mon ? { ch: '%', color: mon.mcolor ?? NO_COLOR, dec: false }
                    : (object_glyph({ ...obj, otyp }) || object_glyph(obj));
        }
    } else {
        g = object_glyph(obj);
        // C: a generic object glyph seen from close up is observed and re-glyphed.
        if (obj.dknown !== 1 && cansee(x, y)) {
            const r = ((game.u?.xray_range ?? 0) > 2) ? game.u.xray_range : 2;
            if (d_distu(x, y) <= (r * r) * 2 - r) {
                observe_object(obj);
                g = object_glyph(obj);
            }
        }
    }
    if (!g) return;
    if (game.level?.flags?.hero_memory) {
        if (halluc && obj.otyp === STATUE_OTYP_D) {
            random_object_disp(objects.length);   /* remembered as a random OBJECT */
        }
        loc.remembered_glyph = { ch: g.ch, color: g.color, decgfx: g.dec };
        loc.mapped_trap_ttyp = 0;
    }
    if (show) show_glyph_cell(x, y, g.ch, g.color, g.dec);
}

// ── detect.c ───────────────────────────────────────────────────────────────

// C ref: detect.c:69 unconstrain_map() — bring an Underwater / buried /
// swallowed hero onto the normal map, bypassing set_uinwater().  Returns TRUE
// iff any change occurred.
export function unconstrain_map() {
    const u = (game.u = game.u || {});
    const iflags = (game.iflags = game.iflags || {});
    const res = !!(u.uinwater || u.uburied || u.uswallow);

    iflags.save_uinwater = u.uinwater; u.uinwater = 0;
    iflags.save_uburied = u.uburied;   u.uburied = 0;
    iflags.save_uswallow = u.uswallow; u.uswallow = 0;

    return res;
}

// C ref: detect.c:84 reconstrain_map() — put the hero back.
export function reconstrain_map() {
    const u = (game.u = game.u || {});
    const iflags = (game.iflags = game.iflags || {});
    u.uinwater = iflags.save_uinwater; iflags.save_uinwater = 0;
    u.uburied = iflags.save_uburied;   iflags.save_uburied = 0;
    u.uswallow = iflags.save_uswallow; iflags.save_uswallow = 0;
}

// C ref: detect.c:93 map_redisplay() — reconstrain, then redraw the screen to
// remove unseen traps from the map, then re-enter the water/ground view.
export async function map_redisplay() {
    reconstrain_map();
    await docrt();
    // C: `if (Underwater) under_water(2); if (u.uburied) under_ground(2);` —
    // js/do.js has no under_water()/under_ground() yet, so the two re-entry
    // redraws are the only part of map_redisplay not represented.
}

// C ref: detect.c:105 browse_map(ter_typ, ter_explain) — hand control to
// getpos()'s autodescribe cursor so the player can read whatever is currently
// painted on the map.  The starting spot is the hero's; the picked position is
// discarded.  hack.js owns getpos(), and it imports this module's siblings, so
// the call is a dynamic import.
export async function browse_map(ter_typ, ter_explain) {
    const iflags = (game.iflags = game.iflags || {});
    const save_autodescribe = iflags.autodescribe;
    iflags.autodescribe = true;
    iflags.terrainmode = ter_typ;
    const { browse_map_getpos } = await import('./hack.js');
    await browse_map_getpos(ter_explain, (ter_typ & TER_DETECT) !== 0);
    iflags.terrainmode = 0;
    iflags.autodescribe = save_autodescribe;
}

// C ref: detect.c:121 map_monst(mtmp, showtail) — "extracted from
// monster_detection() so can be shared by do_vicinity_map()".  A monster whose
// class symbol is a space gets the detected-monster glyph; a pet gets the pet
// glyph (same sym/color on a plain terminal, MG_PET aside); everything else the
// plain monster glyph.  All three what_mon() through the DISPLAY rng.
export function map_monst(mtmp, showtail) {
    const data = mtmp.data || {};
    let mon = data;
    // what_mon(monsndx(mon->data), newsym_rn2): while Hallucination every
    // detected monster re-rolls off the display rng.
    if (Hallucination_u()) mon = monster_by_pmidx(random_monster_disp()) || data;
    const g = { ch: mon.mlet || 'x', color: (mon.mcolor != null) ? mon.mcolor : NO_COLOR };
    show_glyph_cell(mtmp.mx, mtmp.my, g.ch, g.color, false);

    if (showtail && data.mlet === 'w' && data.name === 'long worm') {
        // detect_wsegs(mtmp, 0) — dynamic import: worm.js is a leaf here.
        import('./worm.js').then((W) => W.detect_wsegs?.(mtmp, 0)).catch(() => {});
    }
}

// C ref: detect.c:136 trapped_chest_at(ttyp, x, y) — "checking whether a trap
// symbol represents a trapped chest, not whether a trapped chest is actually
// present".  The Hallucination rn2(20) is a CORE-stream draw.
export function trapped_chest_at(ttyp, x, y) {
    if (!glyph_is_trap(glyph_at(x, y))) return false;
    if (ttyp !== TRAPPED_CHEST || (Hallucination_u() && rn2(20))) return false;

    /* on map, presence of any trappable container will do */
    if (d_sobj_at(CHEST, x, y) || d_sobj_at(LARGE_BOX, x, y)) return true;
    /* in inventory, we need to find one which is actually trapped */
    if (d_u_at(x, y)) {
        for (const otmp of (game.invent || []))
            if (d_Is_box(otmp) && otmp.otrapped) return true;
        if (game.u?.usteed) {
            for (const otmp of (game.u.usteed.minvent || []))
                if (d_Is_box(otmp) && otmp.otrapped) return true;
        }
    }
    const mtmp = m_at(x, y);
    if (mtmp)
        for (const otmp of (mtmp.minvent || []))
            if (d_Is_box(otmp) && otmp.otrapped) return true;
    return false;
}

// C ref: detect.c:182 trapped_door_at(ttyp, x, y).
export function trapped_door_at(ttyp, x, y) {
    if (!glyph_is_trap(glyph_at(x, y))) return false;
    if (ttyp !== TRAPPED_DOOR || (Hallucination_u() && rn2(20))) return false;
    const lev = game.level?.at(x, y);
    if (!lev || !IS_DOOR(lev.typ)) return false;
    if (((lev.doormask | 0) & (D_NODOOR | D_BROKEN | D_ISOPEN)) !== 0
        && trapped_chest_at(ttyp, x, y))
        return false;
    return true;
}

// C ref: detect.c:201 o_in(obj, oclass) — recursively search obj for an object
// in class oclass, return the 1st found.  SchroedingersBox is excluded: the
// corpse it contains isn't necessarily a corpse yet.
export function o_in(obj, oclass) {
    if (!obj) return null;
    if (obj.oclass === oclass) return obj;
    if (d_Has_contents(obj) && !d_SchroedingersBox(obj)) {
        for (const otmp of d_cobj(obj)) {
            if (otmp.oclass === oclass) return otmp;
            if (d_Has_contents(otmp)) {
                const temp = o_in(otmp, oclass);
                if (temp) return temp;
            }
        }
    }
    return null;
}

// C ref: detect.c:229 o_material(obj, material) — recursively search obj for an
// object made of the given material.  NOTE the asymmetry with o_in(): this one
// has no SchroedingersBox guard.
export function o_material(obj, material) {
    if (!obj) return null;
    // js/mkobj.js's objects[] table names objclass.h's oc_material field
    // `material` (see this file's gold_detect); oc_class is present under both
    // spellings, oc_material only under the short one.
    if (objects[obj.otyp]?.material === material) return obj;
    if (d_Has_contents(obj)) {
        for (const otmp of d_cobj(obj)) {
            if (objects[otmp.otyp]?.material === material) return otmp;
            if (d_Has_contents(otmp)) {
                const temp = o_material(otmp, material);
                if (temp) return temp;
            }
        }
    }
    return null;
}

// C ref: detect.c:248 observe_recursively(obj).
export function observe_recursively(obj) {
    observe_object(obj);
    if (d_Has_contents(obj))
        for (const otmp of d_cobj(obj)) observe_recursively(otmp);
}

// C ref: detect.c:261 check_map_spot(x, y, oclass, material) — does <x,y> show
// an OUTDATED object (a corpse that rotted away, an item a monster carried off)
// that detection should erase?
export function check_map_spot(x, y, oclass, material) {
    const glyph = glyph_at(x, y);
    if (glyph_is_object(glyph)) {
        if (oclass === ALL_CLASSES) {
            const mtmp = m_at(x, y);
            return !(d_OBJ_AT(x, y) || (mtmp && (mtmp.minvent || []).length));
        }
        const gotyp = glyph_to_obj(glyph);
        if (material && objects[gotyp]?.material === material) {
            for (const otmp of d_objs_at(x, y))
                if (o_material(otmp, GOLD_MATERIAL)) return false;
            const mtmp = m_at(x, y);
            if (mtmp)
                for (const otmp of (mtmp.minvent || []))
                    if (o_material(otmp, GOLD_MATERIAL)) return false;
            return true;
        }
        if (oclass && objects[gotyp]?.oc_class === oclass) {
            for (const otmp of d_objs_at(x, y))
                if (o_in(otmp, oclass)) return false;
            const mtmp = m_at(x, y);
            if (mtmp)
                for (const otmp of (mtmp.minvent || []))
                    if (o_in(otmp, oclass)) return false;
            return true;
        }
    }
    return false;
}

// C ref: detect.c:317 clear_stale_map(oclass, material) — remove stale data from
// the map display so it doesn't reappear after detection completes.  Returns
// TRUE if a noticeable change occurred.
export function clear_stale_map(oclass, material) {
    let change_made = false;
    for (let zx = 1; zx < COLNO; zx++)
        for (let zy = 0; zy < ROWNO; zy++)
            if (check_map_spot(zx, zy, oclass, material)) {
                unmap_object(zx, zy);
                change_made = true;
            }
    return change_made;
}

// C ref: detect.c:479 food_detect(sobj) — the scroll/spell/potion of food
// detection.  Returns 1 if nothing was detected, 0 if something was.
// Confusion (or a cursed source) detects POTION_CLASS instead of FOOD_CLASS.
export async function food_detect(sobj) {
    const u = game.u;
    const confused = !!(d_Confusion() || (sobj && sobj.cursed));
    const oclass = confused ? POTION_CLASS : FOOD_CLASS;
    const what = confused ? 'something' : 'food';
    let ct = 0, ctu = 0;

    const stale = clear_stale_map(oclass, 0);
    if (u?.usteed) { u.usteed.mx = u.ux; u.usteed.my = u.uy; }

    for (const obj of d_fobj())
        if (o_in(obj, oclass)) {
            if (d_u_at(obj.ox, obj.oy)) ctu++;
            else ct++;
        }
    for (const mtmp of d_fmon()) {
        if (ct && ctu) break;                       /* C's loop condition */
        if (d_DEADMONSTER(mtmp) || (mtmp.isgd && !mtmp.mx)) continue;
        for (const obj of (mtmp.minvent || []))
            if (o_in(obj, oclass)) {
                if (d_u_at(mtmp.mx, mtmp.my)) ctu++;
                else ct++;
                break;
            }
    }

    if (!ct && !ctu) {
        game.known = stale && !confused;
        if (stale) {
            await docrt();
            await update_topl(`You sense a lack of ${what} nearby.`);
            if (sobj && sobj.blessed) {
                if (!u.uedibility) await pline('Your nose starts to tingle.');
                u.uedibility = 1;
            }
        } else if (sobj) {
            const buf = `Your nose twitches${(sobj.blessed && !u.uedibility)
                            ? ' then starts to tingle' : ''}.`;
            if (sobj.blessed && !u.uedibility) {
                // C saves/clears flags.beginner around strange_feeling() to
                // "prevent non-delivery of message".
                const savebeginner = game.flags?.beginner;
                if (game.flags) game.flags.beginner = false;
                await strange_feeling(sobj, buf);
                if (game.flags) game.flags.beginner = savebeginner;
                u.uedibility = 1;
            } else {
                await strange_feeling(sobj, buf);
            }
        }
        return !stale ? 1 : 0;
    } else if (!ct) {
        game.known = true;
        await update_topl(`You ${sobj ? 'smell' : 'sense'} ${what} nearby.`);
        if (sobj && sobj.blessed) {
            if (!u.uedibility) await pline('Your nose starts to tingle.');
            u.uedibility = 1;
        }
    } else {
        let ter_typ = TER_DETECT | TER_OBJ;

        game.known = true;
        await cls();
        unconstrain_map();
        for (const obj of d_fobj()) {
            const temp = o_in(obj, oclass);
            if (temp) {
                if (temp !== obj) { temp.ox = obj.ox; temp.oy = obj.oy; }
                map_object(temp, 1);
            }
        }
        for (const mtmp of d_fmon()) {
            if (d_DEADMONSTER(mtmp) || (mtmp.isgd && !mtmp.mx)) continue;
            for (const obj of (mtmp.minvent || [])) {
                const temp = o_in(obj, oclass);
                if (temp) {
                    temp.ox = mtmp.mx; temp.oy = mtmp.my;
                    map_object(temp, 1);
                    break;
                }
            }
        }
        if (!ctu) {
            newsym(u.ux, u.uy);
            ter_typ |= TER_MON;                     /* for autodescribe of self */
        }
        if (sobj) {
            if (sobj.blessed) {
                await update_topl(`Your nose ${u.uedibility ? 'continues' : 'starts'}`
                                  + ` to tingle and you smell ${what}.`);
                u.uedibility = 1;
            } else {
                await update_topl(`Your nose tingles and you smell ${what}.`);
            }
        } else {
            await update_topl(`You sense ${what}.`);
        }
        exercise(A_WIS, true);

        await browse_map(ter_typ, 'food');
        await map_redisplay();
    }
    return 0;
}

// C ref: detect.c:603 object_detect(detector, class) — used for scrolls,
// potions, spells and crystal balls.  Returns 1 if nothing was detected, 0 if
// something was.  `class` 0 means all classes.
export async function object_detect(detector, oclass) {
    const u = game.u;
    let klass = oclass;
    const is_cursed = !!(detector && detector.cursed);
    const do_dknown = !!(detector
                         && (detector.oclass === POTION_CLASS
                             || detector.oclass === 10 /* SPBOOK_CLASS */)
                         && detector.blessed);
    let ct = 0, ctu = 0, boulder = 0, ter_typ = TER_DETECT | TER_OBJ;
    let otmp = null;

    if (klass < 0 || klass >= MAXOCLASSES) {
        await impossible(`object_detect:  illegal class ${klass}`);
        klass = 0;
    }

    // "Special boulder symbol check" — when the class symbol happens to equal
    // the (user-definable) boulder symbol we don't know which the player meant,
    // so show both possibilities.
    const sym = klass ? def_oc_sym(klass) : 0;
    if (sym && sym === boulder_sym()) boulder = ROCK_CLASS;

    let stuff;
    if (Hallucination_u() || (d_Confusion() && klass === 9 /* SCROLL_CLASS */))
        stuff = 'something';
    else
        stuff = klass ? def_oc_name(klass) : 'objects';
    if (boulder && klass !== ROCK_CLASS) stuff += ' and/or large stones';

    if (do_dknown)
        for (const obj of (game.invent || [])) observe_recursively(obj);

    for (const obj of d_fobj()) {
        if ((!klass && !boulder) || o_in(obj, klass) || o_in(obj, boulder)) {
            if (d_u_at(obj.ox, obj.oy)) ctu++;
            else ct++;
        }
        if (do_dknown) observe_recursively(obj);
    }
    for (const obj of d_buriedobjs()) {
        if (!klass || o_in(obj, klass)) {
            if (d_u_at(obj.ox, obj.oy)) ctu++;
            else ct++;
        }
        if (do_dknown) observe_recursively(obj);
    }
    if (u?.usteed) { u.usteed.mx = u.ux; u.usteed.my = u.uy; }

    for (const mtmp of d_fmon()) {
        if (d_DEADMONSTER(mtmp) || (mtmp.isgd && !mtmp.mx)) continue;
        for (const obj of (mtmp.minvent || [])) {
            if ((!klass && !boulder) || o_in(obj, klass) || o_in(obj, boulder)) ct++;
            if (do_dknown) observe_recursively(obj);
        }
        if ((is_cursed && mtmp.m_ap_type === 'obj'
             && (!klass || klass === objects[mtmp.mappearance]?.oc_class))
            || (findgold(mtmp.minvent) && (!klass || klass === COIN_CLASS))) {
            ct++;
            break;
        }
    }

    if (!clear_stale_map(!klass ? ALL_CLASSES : klass, 0) && !ct) {
        if (!ctu) {
            if (detector) await strange_feeling(detector, 'You feel a lack of something.');
            return 1;
        }
        await update_topl(`You sense ${stuff} nearby.`);
        return 0;
    }

    await cls();
    unconstrain_map();

    /* map all buried objects first */
    for (const obj of d_buriedobjs()) {
        if (!klass) { map_object(obj, 1); continue; }
        otmp = o_in(obj, klass);
        if (otmp) {
            if (otmp !== obj) { otmp.ox = obj.ox; otmp.oy = obj.oy; }
            map_object(otmp, 1);
        }
    }
    /* floor objects override buried objects */
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++)
            for (const obj of d_objs_at(x, y)) {
                otmp = klass ? o_in(obj, klass) : null;
                if (!otmp && boulder) otmp = o_in(obj, boulder);
                if ((!klass && !boulder) || otmp) {
                    if (klass || boulder) {
                        if (otmp !== obj) { otmp.ox = obj.ox; otmp.oy = obj.oy; }
                        map_object(otmp, 1);
                    } else {
                        map_object(obj, 1);
                    }
                    break;
                }
            }
    /* objects in a monster's inventory override floor objects */
    for (const mtmp of d_fmon()) {
        if (d_DEADMONSTER(mtmp) || (mtmp.isgd && !mtmp.mx)) continue;
        for (const obj of (mtmp.minvent || [])) {
            otmp = klass ? o_in(obj, klass) : null;
            if (!otmp && boulder) otmp = o_in(obj, boulder);
            if ((!klass && !boulder) || otmp) {
                if (!klass && !boulder) otmp = obj;
                otmp.ox = mtmp.mx;                  /* at monster location */
                otmp.oy = mtmp.my;
                map_object(otmp, 1);
                break;
            }
        }
        /* allow a mimic to override the detected objects it is carrying */
        if (is_cursed && mtmp.m_ap_type === 'obj'
            && (!klass || klass === objects[mtmp.mappearance]?.oc_class)) {
            map_object({ otyp: mtmp.mappearance,
                         oclass: objects[mtmp.mappearance]?.oc_class,
                         quan: 1, ox: mtmp.mx, oy: mtmp.my,
                         // C ref: display.c:571 `has_mcorpsenm(mon) ?
                         // MCORPSENM(mon) : PM_TENGU`.  PM_TENGU is pmidx 55;
                         // the old literal 149 is the black dragon, so a mimic
                         // posing as a corpse or statue with no mcorpsenm named
                         // the wrong species.
                         corpsenm: (mtmp.mcorpsenm != null) ? mtmp.mcorpsenm
                                                            : 55 /* PM_TENGU */ }, 1);
        } else if (findgold(mtmp.minvent) && (!klass || klass === COIN_CLASS)) {
            map_object({ otyp: GOLD_PIECE, oclass: COIN_CLASS, quan: rnd(10),
                         ox: mtmp.mx, oy: mtmp.my }, 1);
        }
    }
    if (!glyph_is_object(glyph_at(u.ux, u.uy))) {
        newsym(u.ux, u.uy);
        ter_typ |= TER_MON;
    }
    await update_topl(`You detect the ${ct ? 'presence' : 'absence'} of ${stuff}.`);

    if (!ct) await flush_screen(1);                 /* display_nhwindow(WIN_MAP, TRUE) */
    else await browse_map(ter_typ, 'object');

    await map_redisplay();
    return 0;
}

// C ref: detect.c:864 sense_trap(trap, x, y, src_cursed) — draw one trap onto
// the detection map.  While Hallucinating (or from a cursed source) a fake
// OBJECT is mapped instead; those random_object()/random_monster() draws use
// the CORE rng because sense_trap passes plain rn2.
export function sense_trap(trap, x, y, src_cursed) {
    if (Hallucination_u() || src_cursed) {
        const obj = { otyp: 0, quan: 1, corpsenm: 0, ox: 0, oy: 0 };
        if (trap) { obj.ox = trap.tx; obj.oy = trap.ty; }
        else { obj.ox = x; obj.oy = y; }
        obj.otyp = !Hallucination_u() ? GOLD_PIECE : d_random_object_core();
        obj.quan = (obj.otyp === GOLD_PIECE) ? rnd(10)
                   : objects[obj.otyp]?.oc_merge ? rnd(2) : 1;
        obj.oclass = objects[obj.otyp]?.oc_class;
        obj.corpsenm = d_random_monster_core();     /* if otyp == CORPSE */
        map_object(obj, 1);
    } else if (trap) {
        map_trap(trap, 1);
        trap.tseen = 1;
    } else {
        // OBSOLETE in C too: trapped door / trapped chest now come through the
        // `if (trap)` arm above, so this block should be unreachable.
        dummytrap.tx = x;
        dummytrap.ty = y;
        dummytrap.ttyp = BEAR_TRAP;
        map_trap(dummytrap, 1);
    }
}

/* detect.c:944-946 */
const OTRAP_NONE = 0, OTRAP_HERE = 1, OTRAP_THERE = 2;

// C ref: detect.c:906 detect_obj_traps(objlist, show_them, how, ft) — check a
// list of objects for chest traps.  Returns OTRAP_HERE|OTRAP_THERE bits;
// optionally updates the map and (when ft is non-null, i.e. called from
// findone()) flashes and counts each one.
export function detect_obj_traps(objlist, show_them, how, ft) {
    let result = OTRAP_NONE;

    dummytrap.ttyp = TRAPPED_CHEST;
    const trapglyph = ft ? trap_glyph(dummytrap) : null;
    for (const otmp of (objlist || [])) {
        let x = 0, y = 0;
        if ((d_Is_box(otmp) && otmp.otrapped) || d_Has_contents(otmp)) {
            const loc = get_obj_location(otmp);
            if (!loc || !isok(loc.x, loc.y)
                || (ft && (loc.x !== ft.ft_cc.x || loc.y !== ft.ft_cc.y)))
                continue;
            x = loc.x; y = loc.y;
        }
        if (d_Is_box(otmp) && otmp.otrapped) {
            otmp.tknown = 1;
            observe_object(otmp);
            result |= d_u_at(x, y) ? OTRAP_HERE : OTRAP_THERE;
            // flash_glyph_at(x, y, trapglyph, FOUND_FLASH_COUNT) — FOUND_FLASH_COUNT
            // is 6 so C animates the find; js/display.js has no flash_glyph_at.
            if (show_them) {
                dummytrap.tx = x; dummytrap.ty = y;
                sense_trap(dummytrap, x, y, how);
            }
            if (ft) {
                foundone(x, y, trapglyph ? { kind: 'trap', ttyp: TRAPPED_CHEST } : null);
                ft.num_traps++;
            }
        }
        if (d_Has_contents(otmp))
            result |= detect_obj_traps(d_cobj(otmp), show_them, how, ft);
    }
    return result;
}

// C ref: detect.c:955 display_trap_map(cursed_src) — paint every trap on the
// level (floor traps, chest traps buried/floor/carried, trapped doors) and hand
// the result to browse_map().
export async function display_trap_map(cursed_src) {
    const u = game.u;
    let ter_typ = TER_DETECT | (cursed_src ? TER_OBJ : TER_TRP);

    await cls();
    unconstrain_map();
    /* chest traps first, buried before floor so floor traps override */
    detect_obj_traps(d_buriedobjs(), true, cursed_src, null);
    detect_obj_traps(d_fobj(), true, cursed_src, null);
    for (const mon of d_fmon()) {
        if (d_DEADMONSTER(mon) || (mon.isgd && !mon.mx)) continue;
        detect_obj_traps(mon.minvent, true, cursed_src, null);
    }
    detect_obj_traps(game.invent, true, cursed_src, null);

    for (const ttmp of (game.level?.traps || []))
        sense_trap(ttmp, 0, 0, cursed_src);

    dummytrap.ttyp = TRAPPED_DOOR;
    const doorindex = game.level?.doorindex | 0;
    for (let door = 0; door < doorindex; door++) {
        const cc = game.level?.doors?.[door];
        if (!cc) continue;
        const lev = game.level?.at(cc.x, cc.y);
        if (!lev || lev.typ === SDOOR) continue;     /* can't be trapped */
        if ((lev.doormask | 0) & D_TRAPPED) {
            dummytrap.tx = cc.x; dummytrap.ty = cc.y;
            sense_trap(dummytrap, cc.x, cc.y, cursed_src);
        }
    }

    /* redisplay hero unless sense_trap() revealed something at <ux,uy> */
    const glyph = glyph_at(u.ux, u.uy);
    if (!(glyph_is_trap(glyph) || glyph_is_object(glyph))) {
        newsym(u.ux, u.uy);
        ter_typ |= TER_MON;
    }
    await update_topl(`You feel ${cursed_src ? 'very greedy' : 'entrapped'}.`);

    await browse_map(ter_typ, cursed_src ? 'gold' : 'trap of interest');
    await map_redisplay();
}

// C ref: detect.c:1011 trap_detect(sobj) — sobj is Null for a crystal ball, the
// scroll for gold detection.  Returns 1 if nothing was detected, 0 otherwise.
// Any trap NOT under the hero jumps straight to the full map display.
export async function trap_detect(sobj) {
    const u = game.u;
    const cursed_src = !!(sobj && sobj.cursed);
    let found = false, tr;

    if (u?.usteed) { u.usteed.mx = u.ux; u.usteed.my = u.uy; }

    /* floor/ceiling traps */
    for (const ttmp of (game.level?.traps || [])) {
        if (ttmp.tx !== u.ux || ttmp.ty !== u.uy) {
            await display_trap_map(cursed_src);
            return 0;
        }
        found = true;
    }
    /* chest traps (might be buried or carried) */
    tr = detect_obj_traps(d_fobj(), false, 0, null);
    if (tr !== OTRAP_NONE) {
        if (tr & OTRAP_THERE) { await display_trap_map(cursed_src); return 0; }
        found = true;
    }
    tr = detect_obj_traps(d_buriedobjs(), false, 0, null);
    if (tr !== OTRAP_NONE) {
        if (tr & OTRAP_THERE) { await display_trap_map(cursed_src); return 0; }
        found = true;
    }
    for (const mon of d_fmon()) {
        if (d_DEADMONSTER(mon) || (mon.isgd && !mon.mx)) continue;
        tr = detect_obj_traps(mon.minvent, false, 0, null);
        if (tr !== OTRAP_NONE) {
            if (tr & OTRAP_THERE) { await display_trap_map(cursed_src); return 0; }
            found = true;
        }
    }
    if (detect_obj_traps(game.invent, false, 0, null) !== OTRAP_NONE) found = true;
    /* door traps: secret doors use wall_info so can't be marked as trapped */
    const doorindex = game.level?.doorindex | 0;
    for (let door = 0; door < doorindex; door++) {
        const cc = game.level?.doors?.[door];
        if (!cc) continue;
        const lev = game.level?.at(cc.x, cc.y);
        if (!lev || lev.typ === SDOOR) continue;
        if ((lev.doormask | 0) & D_TRAPPED) {
            if (cc.x !== u.ux || cc.y !== u.uy) {
                await display_trap_map(cursed_src);
                return 0;
            }
            found = true;
        }
    }
    if (!found) {
        await strange_feeling(sobj, 'Your toes stop itching.');
        return 1;
    }
    /* traps exist, but only under me - no separate display required */
    await update_topl('Your toes itch.');
    return 0;
}

// C ref: detect.c:1090 furniture_detect() — the crystal-ball / #wizmap style
// "points of interest" scan.  Always returns 0.
export async function furniture_detect() {
    let found = 0, revealed = 0;

    unconstrain_map();

    for (let y = 0; y < ROWNO; y++)
        for (let x = 1; x < COLNO; x++) {
            const before = glyph_at(x, y);
            const loc = game.level?.at(x, y);
            if (loc && IS_FURNITURE(loc.typ)) {
                ++found;
                magic_map_background(x, y, 1);
            } else if (glyph_is_cmap(before) && is_cmap_furniture(before.cmap)) {
                ++found;
                const mon = m_at(x, y);
                if (mon && mon.m_ap_type === 'furniture') {
                    // seemimic(mon) — js/apply.js:533 owns the async port; this
                    // module has no seemimic of its own.
                    mon.m_ap_type = 0;
                    mon.mappearance = 0;
                    newsym(x, y);
                }
                if (!mon || !canspotmon_lite(mon)) map_invisible(x, y);
            }
            const after = glyph_at(x, y);
            if (after.kind !== before.kind || after.sym !== before.sym
                || after.cmap !== before.cmap) ++revealed;
        }

    if (!found)
        await update_topl('There seems to be nothing of interest on this level.');
    else if (!revealed)
        await update_topl('Your map already shows all relevant locations.');

    if (!revealed) {
        await flush_screen(1);                      /* display_nhwindow(WIN_MAP, TRUE) */
    } else {
        await browse_map(TER_DETECT | TER_MAP | TER_TRP | TER_OBJ | TER_MON,
                         'location');
    }

    await map_redisplay();
    return 0;
}

// C ref: detect.c:1142 level_distance(where) — the crystal ball's "the Wizard
// is <somewhere>" phrasing.  Both rn2(3) draws are on the CORE rng and are only
// evaluated when |ll| is large enough to reach them.
export function level_distance(where) {
    const ll = depth(game.u?.uz) - depth(where);
    const indun = game.u?.uz?.dnum === where?.dnum;
    let res = '';

    if (ll < 0) {
        if (ll < (-8 - rn2(3))) res = !indun ? 'far away' : 'far below';
        else if (ll < -1) res = !indun ? 'away below you' : 'below you';
        else if (!indun) res = 'in the distance';
        else res = 'just below';
    } else if (ll > 0) {
        if (ll > (8 + rn2(3))) res = !indun ? 'far away' : 'far above';
        else if (ll > 1) res = !indun ? 'away above you' : 'above you';
        else if (!indun) res = 'in the distance';
        else res = 'just above';
    } else {
        res = !indun ? 'in the distance' : 'near you';
    }
    return res;
}

// C ref: detect.c:1448 do_vicinity_map(sobj) — clairvoyance.  `sobj` is a fake
// spellbook when the hero cast the spell and Null for the timed/random episode.
export async function do_vicinity_map(sobj) {
    const u = game.u;
    const props = (u.uprops = u.uprops || {});
    let refresh = false, mdetected = false, odetected = false;
    const extended = !!(sobj && (sobj.blessed || u.Clairvoyant));
    const random_farsight = !sobj;
    const lo_y = (u.uy - 5 < 0) ? 0 : u.uy - 5;
    const hi_y = (u.uy + 6 >= ROWNO) ? ROWNO - 1 : u.uy + 6;
    const lo_x = (u.ux - 9 < 1) ? 1 : u.ux - 9;     /* avoid column 0 */
    const hi_x = (u.ux + 10 >= COLNO) ? COLNO - 1 : u.ux + 10;
    let ter_typ = TER_DETECT | TER_MAP | TER_TRP | TER_OBJ;

    /* if hero is engulfed, show engulfer at <u.ux,u.uy> */
    const save_viz_uyux = game.viz_array?.[u.uy]?.[u.ux];
    if (u.uswallow && game.viz_array?.[u.uy]) game.viz_array[u.uy][u.ux] |= IN_SIGHT;
    const save_EDetect_mons = props.EDetect_monsters | 0;
    props.EDetect_monsters = save_EDetect_mons | I_SPECIAL;
    const unconstrained = unconstrain_map();

    for (let zx = lo_x; zx <= hi_x; zx++)
        for (let zy = lo_y; zy <= hi_y; zy++) {
            const oldglyph = glyph_at(zx, zy);
            /* this will remove 'remembered, unseen mon' (and objects) */
            show_map_spot_cnf(zx, zy, d_Confusion());
            /* if there are any objects here, see the top one.  NOT vobj_at():
               "this is not vision-based access; unlike object detection, we
               don't notice buried items". */
            if (d_OBJ_AT(zx, zy)) {
                const otmp = d_objs_at(zx, zy)[0];
                if (extended) observe_object(otmp);
                map_object(otmp, true);
                const newglyph = glyph_at(zx, zy);
                if (!same_glyph(newglyph, oldglyph)
                    && covers_objects(game.level?.at(zx, zy)))
                    odetected = true;
            }
            const mtmp = m_at(zx, zy);
            if (mtmp && mtmp.mx === zx && mtmp.my === zy) {  /* skip worm tails */
                if ((unconstrained || !game.level?.flags?.hero_memory)
                    && !extended && (zx !== u.ux || zy !== u.uy)
                    && !glyph_is_monster(oldglyph))
                    map_invisible(zx, zy);
                else
                    map_monst(mtmp, false);
                const newglyph = glyph_at(zx, zy);
                if (extended && !same_glyph(newglyph, oldglyph)
                    && !glyph_is_invisible(newglyph))
                    mdetected = true;
            }
        }

    /* 'quick_farsight' silences the random episode but never the spell */
    if (random_farsight && game.flags?.quick_farsight)
        mdetected = odetected = false;

    if (!game.level?.flags?.hero_memory || unconstrained || mdetected || odetected) {
        await flush_screen(1);
        // C makes this pline unconditional (not gated on flags.verbose like the
        // getpos prompt) "so that not-verbose users become aware".
        await update_topl('You sense your surroundings.');
        if (extended || glyph_is_monster(glyph_at(u.ux, u.uy))) ter_typ |= TER_MON;
        await browse_map(ter_typ, 'anything of interest');
        refresh = true;
    }
    reconstrain_map();
    props.EDetect_monsters = save_EDetect_mons;
    if (game.viz_array?.[u.uy]) game.viz_array[u.uy][u.ux] = save_viz_uyux;

    /* replace monsters with remembered,unseen monster, then see_monsters() */
    for (let zx = lo_x; zx <= hi_x; zx++)
        for (let zy = lo_y; zy <= hi_y; zy++) {
            if (d_u_at(zx, zy)) continue;
            const newglyph = glyph_at(zx, zy);
            if (glyph_is_monster(newglyph)) {
                const mtmp = m_at(zx, zy);
                if (!mtmp || !canspotmon_lite(mtmp)) map_invisible(zx, zy);
            }
        }
    see_monsters();

    if (refresh) await docrt();
}

// C ref: detect.c:1609 foundone(zx, zy, glyph) — flash a freshly found feature
// onto the map.  C forces viz_array to COULD_SEE|IN_SIGHT around the newsym()
// so the cell draws as if seen, then restores it.
export function foundone(zx, zy, glyph) {
    const lev = game.level?.at(zx, zy);
    if (!lev) return;
    if (glyph_is_cmap(glyph) || glyph_is_unexplored(glyph)) lev.seenv = SVALL;

    const row = game.viz_array?.[zy];
    const save_viz = row ? row[zx] : 0;
    if (row && !Blind()) row[zx] = COULD_SEE | IN_SIGHT;
    newsym(zx, zy);
    if (row) row[zx] = save_viz;
    // FOUND_FLASH_COUNT defaults to 6, so C's `#if FOUND_FLASH_COUNT == 0`
    // tmp_at() alternative is compiled out.
}

// C ref: detect.c:1728 openone(zx, zy, num) — the do_clear_area() callback for
// the wand/spell of opening (openit()).  `num` is C's `int *`, boxed here as
// { n }.
export async function openone(zx, zy, num) {
    const lev = game.level?.at(zx, zy);
    if (!lev) return;

    if (d_OBJ_AT(zx, zy)) {
        for (const otmp of d_objs_at(zx, zy))
            if (d_Is_box(otmp) && otmp.olocked) {
                otmp.olocked = 0;
                num.n++;
            }
        /* let it fall to the next cases. could be on trap. */
    }
    /* note: secret doors can't be trapped; they use levl[][].wall_info */
    if (lev.typ === SDOOR
        || (lev.typ === DOOR && ((lev.doormask | 0) & (D_CLOSED | D_LOCKED)))) {
        if (lev.typ === SDOOR) cvt_sdoor_to_door(lev);
        if ((lev.doormask | 0) & D_TRAPPED) {
            const C = await import('./cmd.js');
            if (d_distu(zx, zy) < 3) {
                await C.b_trapped('door', false);   /* NO_PART */
            } else {
                await d_Norep(`You ${cansee(zx, zy) ? 'see'
                    : (!game.u?.Deaf ? 'hear' : 'feel the shock of')} an explosion!`);
            }
            await C.wake_nearto(zx, zy, 11 * 11);
            lev.doormask = D_NODOOR;
        } else {
            lev.doormask = D_ISOPEN;
        }
        unblock_point(zx, zy);
        newsym(zx, zy);
        num.n++;
        return;
    }
    if (lev.typ === SCORR) {
        lev.typ = CORR;
        unblock_point(zx, zy);
        newsym(zx, zy);
        num.n++;
        return;
    }
    const ttmp = d_t_at(zx, zy);
    if (ttmp) {
        if (!ttmp.tseen && ttmp.ttyp !== STATUE_TRAP) {
            ttmp.tseen = 1;
            newsym(zx, zy);
            num.n++;
        }
        // C: `mon = u_at(zx,zy) ? &gy.youmonst : m_at(zx,zy);` then
        // openholdingtrap(mon,&dummy) || openfallingtrap(mon,TRUE,&dummy).
        // Neither trap.c routine is ported in js/trap.js, so the count they
        // would add is missing here.
        return;
    }
    const D = await import('./dbridge.js');
    const db = D.find_drawbridge(zx, zy);
    if (db.ok) {
        /* make sure it isn't an open drawbridge */
        await D.open_drawbridge(db.x, db.y);
        num.n++;
    }
}

// C ref: detect.c:1902 openit() — the wand/spell of opening.  Returns the count
// of things found and opened, or -1 when it only expelled the hero.
export async function openit() {
    const u = game.u;
    const num = { n: 0 };

    if (u.uswallow) {
        if (d_digests(u.ustuck?.data)) {            /* purple worm */
            const { Monnam } = await import('./do_name.js');
            if (Blind()) await pline('Its mouth opens!');
            else await pline(`${Monnam(u.ustuck)} opens its mouth!`);
        }
        const { expels } = await import('./mhitu.js');
        await expels(u.ustuck, u.ustuck.data, true);
        return -1;
    }

    // do_clear_area(u.ux, u.uy, BOLT_LIM, openone, &num) — clear_area_cells()
    // is vision.js's list form of the same scan, needed because openone() is
    // async (b_trapped / open_drawbridge are).
    for (const [x, y] of clear_area_cells(u.ux, u.uy, BOLT_LIM))
        await openone(x, y, num);
    return num.n;
}

// C ref: detect.c:1929 detecting(func) — "callback hack for overriding vision in
// do_clear_area()": these two callbacks see through walls.
export function detecting(func) {
    return func === findone || func === openone;
}

// C ref: detect.c:2107 warnreveal() — a warned-of monster adjacent to the hero
// stops being mundetected.
export function warnreveal() {
    const u = game.u;
    if (!u) return;
    for (let x = u.ux - 1; x <= u.ux + 1; x++)
        for (let y = u.uy - 1; y <= u.uy + 1; y++) {
            if (!isok(x, y) || d_u_at(x, y)) continue;
            const mtmp = m_at(x, y);
            if (mtmp && warning_of(mtmp) && mtmp.mundetected)
                mfind0(mtmp, 1);                    /* via_warning */
        }
}

// C ref: detect.c:2166 reveal_terrain_getglyph(x, y, swallowed, default_glyph,
// which_subset) — the per-cell glyph the #terrain command and dump_map() show:
// the remembered background with monsters/objects/traps stripped as the caller
// dictates.  'full' shows the real terrain for the whole level.
export function reveal_terrain_getglyph(x, y, swallowed, default_glyph, which_subset) {
    const loc = game.level?.at(x, y);
    if (!loc) return default_glyph;
    const keep_traps = (which_subset & TER_TRP) !== 0;
    const keep_objs = (which_subset & TER_OBJ) !== 0;
    const keep_mons = (which_subset & TER_MON) !== 0;
    const full = (which_subset & TER_FULL) !== 0;
    let glyph;

    const seenv = (full || game.level?.flags?.hero_memory)
                    ? loc.seenv : cansee(x, y) ? SVALL : 0;
    if (full) {
        const save = loc.seenv;
        loc.seenv = SVALL;
        glyph = { kind: 'cmap', sym: back_to_glyph(x, y).ch, cell: back_to_glyph(x, y) };
        loc.seenv = save;
    } else {
        let was_mon = false;
        // levl[][].glyph is the REMEMBERED glyph (never a monster, except the
        // invisible-monster glyph, which is handled like an object).
        const remembered = loc.invisMon ? { kind: 'invisible', x, y }
            : (game.level?.flags?.hero_memory && loc.remembered_glyph)
                ? { kind: 'cmap', sym: loc.remembered_glyph.ch,
                    cell: loc.remembered_glyph }
                : seenv ? { kind: 'cmap', sym: back_to_glyph(x, y).ch,
                            cell: back_to_glyph(x, y) }
                        : default_glyph;
        glyph = !swallowed ? glyph_at(x, y) : remembered;
        if (keep_mons && d_u_at(x, y) && swallowed) {
            const d = game.u?.ustuck?.data || {};
            glyph = { kind: 'monster', mon: game.u?.ustuck,
                      sym: Hallucination_u()
                            ? (monster_by_pmidx(random_monster_disp())?.mlet || 'x')
                            : (d.mlet || 'x') };
        } else if ((!keep_mons && glyph_is_monster(glyph)) ) {
            glyph = remembered;
            was_mon = true;
        }
        const reg = null;   /* visible_region_at(x, y); regions carry no glyph here */
        if (((!keep_objs && glyph_is_object(glyph)) || glyph_is_invisible(glyph))
            && keep_traps && !covers_objects(loc)) {
            const t = d_t_at(x, y);
            if (t && t.tseen) glyph = { kind: 'trap', trap: t, ttyp: t.ttyp,
                                        sym: trap_glyph(t).ch };
        }
        if ((!keep_objs && glyph_is_object(glyph))
            || (!keep_traps && glyph_is_trap(glyph))
            || (reg && was_mon)
            || glyph_is_invisible(glyph)) {
            if (!seenv) {
                glyph = default_glyph;
            } else if (lastseentyp(x, y) === loc.typ) {
                glyph = { kind: 'cmap', sym: back_to_glyph(x, y).ch,
                          cell: back_to_glyph(x, y) };
            } else {
                const mtmp = m_at(x, y);
                if (mtmp && mtmp.m_ap_type === 'furniture') {
                    glyph = { kind: 'cmap', sym: defsyms[mtmp.mappearance]?.sym || ' ' };
                } else {
                    // C swaps levl[x][y].typ to lastseentyp[][], recalculates
                    // wall_info for walls/SDOOR, takes back_to_glyph(), then
                    // restores the whole struct rm.
                    const save_typ = loc.typ;
                    loc.typ = lastseentyp(x, y);
                    const cell = back_to_glyph(x, y);
                    loc.typ = save_typ;
                    glyph = { kind: 'cmap', sym: cell.ch, cell };
                }
            }
        }
    }
    /* C's "FIXME: dirty hack" — normalize the two dark/lit variants. */
    if (glyph_is_cmap(glyph)) {
        if (glyph.sym === defsyms[S_darkroom].sym
            && glyph.cell && glyph.cell.color === defsyms[S_darkroom].color)
            glyph = { kind: 'cmap', sym: defsyms[S_room].sym,
                      cell: { ch: defsyms[S_room].sym, color: defsyms[S_room].color,
                              dec: false } };
        else if (glyph.sym === defsyms[S_litcorr].sym
                 && glyph.cell && glyph.cell.color === defsyms[S_litcorr].color)
            glyph = { kind: 'cmap', sym: defsyms[S_corr].sym,
                      cell: { ch: defsyms[S_corr].sym, color: defsyms[S_corr].color,
                              dec: false } };
    }
    return glyph;
}

// C ref: detect.c:2292 dump_map() (DUMPLOG) — the map rows written to the
// dumplog, with the blank rows at the top squeezed out and at most one blank
// row kept at the bottom.  C writes them with putstr(0, 0, buf) (winid 0 ==
// dumplog); js/end.js:1517 marks this as the missing piece of
// dump_everything(), so the rows are returned for that call site to emit.
export function dump_map() {
    const out = [];
    const subset = TER_MAP | TER_TRP | TER_OBJ | TER_MON;
    // cmap_to_glyph() evaluates its argument multiple times in C, so the
    // tree-vs-stone conditional is pulled out of it there too.
    const default_sym = game.level?.flags?.arboreal ? '#' : defsyms[0].sym;
    const default_glyph = { kind: 'cmap', sym: default_sym,
                            cell: { ch: default_sym, color: NO_COLOR, dec: false } };
    let skippedrows = 0, toprow = true;

    for (let y = 0; y < ROWNO; y++) {
        let blankrow = true, lastnonblank = -1;
        const buf = [];
        for (let x = 1; x < COLNO; x++) {
            const glyph = reveal_terrain_getglyph(x, y, game.u?.uswallow,
                                                  default_glyph, subset);
            const ch = glyph_ttychar(glyph);
            buf[x - 1] = ch;
            if (ch !== ' ') { blankrow = false; lastnonblank = x - 1; }
        }
        if (!blankrow) {
            const row = buf.slice(0, lastnonblank + 1).join('');
            if (toprow) { skippedrows = 0; toprow = false; }
            for (let x = 0; x < skippedrows; x++) out.push('');
            out.push(row);                          /* map row #y */
            skippedrows = 0;
        } else {
            ++skippedrows;
        }
    }
    if (skippedrows) out.push('');
    return out;
}

// ── small helpers the block above leans on ─────────────────────────────────

// C ref: detect.c show_map_spot(x, y, cnf) — the `cnf` (Confusion) parameter
// this file's existing show_map_spot() does not take: a confused mapping skips
// 6 cells out of 7, and the engraving arm plus the #overview update are gated
// off.  rn2(7) is a CORE-stream draw and happens for EVERY cell.
function show_map_spot_cnf(x, y, cnf) {
    if (cnf && rn2(7)) return;
    const lev = game.level?.at(x, y);
    if (!lev) return;
    lev.seenv = SVALL;
    if (lev.typ === SCORR) { lev.typ = CORR; unblock_point(x, y); }

    const oldglyph = glyph_at(x, y);
    if (game.level?.flags?.hero_memory) {
        magic_map_background(x, y, 0);
        newsym(x, y);                               /* show it, if not blocked */
    } else {
        magic_map_background(x, y, 1);              /* display it */
    }
    if (!IS_FURNITURE(lev.typ)) {
        const t = d_t_at(x, y);
        const ep = engr_at(x, y);
        if (t && t.tseen) {
            map_trap(t, 1);
        } else if (ep && !cnf) {
            ep.erevealed = 1;                       /* map_engraving(ep, 1) */
            const g = engraving_glyph(lev);
            if (game.level?.flags?.hero_memory)
                lev.remembered_glyph = { ch: g.ch, color: g.color, decgfx: g.dec };
            show_glyph_cell(x, y, g.ch, g.color, g.dec);
        } else if (glyph_is_trap(oldglyph) || glyph_is_object(oldglyph)) {
            if (oldglyph.cell)
                show_glyph_cell(x, y, oldglyph.cell.ch, oldglyph.cell.color,
                                oldglyph.cell.dec);
            if (game.level?.flags?.hero_memory && oldglyph.cell)
                lev.remembered_glyph = { ch: oldglyph.cell.ch,
                                         color: oldglyph.cell.color,
                                         decgfx: oldglyph.cell.dec };
        }
    }
    if (!cnf && (lev.roomno ?? 0) >= ROOMOFFSET)
        room_discovered(lev.roomno - ROOMOFFSET);
}

// C ref: detect.c:1589 cvt_sdoor_to_door(lev) — js/dokick.js:181 owns the same
// port; repeated here because this module cannot import that file's private copy.
function cvt_sdoor_to_door(lev) {
    let newmask = (lev.doormask | 0) & ~(0xE0 /* WM_MASK */);
    if (!(newmask & D_LOCKED)) newmask |= D_CLOSED;
    lev.typ = DOOR;
    lev.doormask = newmask;
    lev.arboreal_sdoor = 0;                         /* clears 'candig' */
}

// C ref: mkobj.c get_obj_location(obj, &x, &y, BURIED_TOO|CONTAINED_TOO) — the
// map spot an object (possibly buried, possibly nested in a container) is at.
function get_obj_location(obj) {
    let o = obj;
    for (let guard = 0; o && guard < 32; guard++) {
        if (o.where === 'floor' || o.where === 3 /* OBJ_FLOOR */
            || o.where === 'buried' || o.where === 5 /* OBJ_BURIED */)
            return { x: o.ox, y: o.oy };
        if (o.where === 'invent' || o.where === 1 /* OBJ_INVENT */)
            return { x: game.u?.ux, y: game.u?.uy };
        if (o.where === 'minvent' || o.where === 2 /* OBJ_MINVENT */)
            return o.ocarry ? { x: o.ocarry.mx, y: o.ocarry.my } : null;
        o = o.ocontainer;                           /* OBJ_CONTAINED */
        if (!o) return null;
    }
    return null;
}

// C ref: mkobj.c findgold(chain) — the first gold pile in an inventory chain.
function findgold(chain) {
    for (const o of (chain || [])) if (o.oclass === COIN_CLASS) return o;
    return null;
}

// C ref: potion.c strange_feeling(obj, txt) — reduced to the message half; the
// useup/exercise bookkeeping belongs to the caller's own module (js/read.js and
// js/potion.js each have their own copy of that part).
async function strange_feeling(_obj, txt) {
    if (game.flags?.beginner === false || !game.flags?.beginner) await pline(txt);
    else await pline('You have a strange feeling for a moment, then it passes.');
}

// C ref: drawing.c def_oc_syms[class].sym / .name (js/symbols.js owns the table).
function def_oc_sym(klass) { return def_oc_syms[klass]?.sym || 0; }
function def_oc_name(klass) { return def_oc_syms[klass]?.name || 'objects'; }
// gs.showsyms[SYM_BOULDER + SYM_OFF_X] — user-definable via SYMBOLS=; no rc in
// the covered corpus sets it, so it falls back to def_oc_syms[ROCK_CLASS].sym.
function boulder_sym() { return def_oc_syms[ROCK_CLASS]?.sym || '`'; }

// C ref: sym.h:104 is_cmap_furniture(i) — the contiguous S_upstair..S_fountain
// block (stairs, ladders, altar, grave, throne, sink, fountain).
function is_cmap_furniture(i) { return i >= S_upstair && i <= S_fountain; }

// C ref: display.h canspotmon(mon) — js/uhitm.js owns the real port; a static
// import of it from here would close a cycle through cmd.js, so this is the
// visibility half only.
function canspotmon_lite(mon) {
    return !!mon && !mon.mundetected && !mon.minvis && cansee(mon.mx, mon.my);
}

// C ref: svl.lastseentyp[x][y] — the terrain the hero last SAW at a spot.  The
// level graph keeps it as a flat COLNO*ROWNO array when it keeps it at all
// (js/pickup.js:544 writes it); fall back to the live typ.
function lastseentyp(x, y) {
    const arr = game.level?.lastseentyp;
    if (Array.isArray(arr)) {
        const v = arr[x + y * 80];
        if (v != null) return v;
    }
    return game.level?.at(x, y)?.typ;
}

function same_glyph(a, b) {
    return a?.kind === b?.kind && a?.sym === b?.sym
        && a?.otyp === b?.otyp && a?.ttyp === b?.ttyp;
}

// C ref: display.c map_glyphinfo() -> glyphinfo.ttychar, the plain character a
// glyph draws as (dump_map's only use of it).
function glyph_ttychar(glyph) {
    if (!glyph) return ' ';
    if (glyph.sym != null) return glyph.sym;
    if (glyph.cell?.ch != null) return glyph.cell.ch;
    return ' ';
}

// C ref: monmove.c warning_of(mtmp) — MATCH_WARN_OF_MON: the hero is warned of
// this monster's kind.  js/display.js have_warning() models only the
// role-granted intrinsic and there is no warntype state, so this is FALSE.
function warning_of(_mtmp) { return false; }

// C ref: detect.c:1964 mfind0(mtmp, via_warning) — reveal a hidden monster
// found by searching or by warning.  js/detect.js does not carry dosearch0()
// yet, so only the via_warning path warnreveal() needs is spelled out.
function mfind0(mtmp, via_warning) {
    if (via_warning) {
        // C: "You feel a presence" / map_invisible for a warned-of monster the
        // hero cannot actually see.
        map_invisible(mtmp.mx, mtmp.my);
        return -1;
    }
    mtmp.mundetected = 0;
    newsym(mtmp.mx, mtmp.my);
    return 1;
}
