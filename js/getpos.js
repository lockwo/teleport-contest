// getpos.js — C ref: src/getpos.c.
//
// STATUS: INERT.  Nothing in the tree imports this module.  The LIVE getpos()
// loop lives in js/hack.js:1860 together with module-private copies of
// getpos_help() (hack.js:1274), gather_locs() (hack.js:1809),
// gather_locs_interesting() (hack.js:1767) and truncate_to_map()
// (hack.js:1323).  Those five are the reason getpos.c already reads as 5/22
// covered; this file adds the other seventeen so a later measured pass can
// wire them in one call site at a time.  DO NOT fork the five that already
// exist — export hack.js's, don't copy them.
//
// GLYPH REPRESENTATION.  C works in the integer glyph space (back_to_glyph()
// returns cmap_to_glyph(idx), glyph_is_cmap()/glyph_to_cmap() decode it).  This
// port has no integer glyph space on the level model, so the three
// gloc_filter_* functions below represent "a cmap glyph" by its S_* cmap INDEX
// and any non-cmap glyph by -1.  With that encoding glyph_is_cmap(g) is
// (g >= 0) and glyph_to_cmap(g) is g, so gloc_filter_classify_glyph() and
// gloc_filter_floodfill_matcharea() are literal translations.  When js/glyphs.js
// (already a full, inert glyphs.c port) is wired up, swap
// back_to_glyph_cmapidx() for the real back_to_glyph() and delete the encoding
// note — nothing else in this file changes.
//
// NO RNG.  getpos.c draws nothing: not one rn2/rnd/d in the whole file.  What
// it does control is WHICH SCREENS get recorded (every getpos frame is a
// readchar, hence a capture) and what the autodescribe line says, so the string
// assembly order below is the load-bearing part.

import { game } from './gstate.js';
import { isok } from './hacklib.js';
import {
    COLNO, ROWNO, DOOR, SDOOR, SCORR, STONE, ROOM, CORR, IRONBARS, TREE,
    POOL, MOAT, STAIRS, LADDER, FOUNTAIN, SINK, ALTAR, GRAVE, THRONE,
    LAVAPOOL, LAVAWALL, ICE, AIR, CLOUD, WATER, DBWALL,
    DRAWBRIDGE_UP, DRAWBRIDGE_DOWN, HWALL, VWALL,
    TLCORNER, TRCORNER, BLCORNER, BRCORNER, CROSSWALL,
    TUWALL, TDWALL, TLWALL, TRWALL,
    D_BROKEN, D_ISOPEN,
    GFILTER_AREA, GFILTER_VIEW, GLOC_EXPLORE,
    GPCOORDS_NONE, GPCOORDS_MAP, GPCOORDS_COMPASS, GPCOORDS_COMFULL,
    GPCOORDS_SCREEN,
    VIBRATING_SQUARE, HI_ZAP, LA_DOWN, MAXTCHARS, NHW_MENU, PICK_ONE,
    DB_UNDER, DB_MOAT, DB_LAVA, DB_ICE, DB_FLOOR,
    IS_DOOR,
} from './const.js';
import { NO_COLOR } from './terminal.js';
import { selection_new, selection_setpoint, selection_getpoint } from './selvar.js';
import { newsym } from './display.js';

// ---------------------------------------------------------------------------
// sym.h enum cmap_symbols — the indices getpos.c's is_cmap_*() macros bracket.
// js/symbols.js exports the same enum, but symbols.js pulls in options.js and
// this file is meant to stay import-light; display.js:465 and cmd.js:3440
// already keep local copies of the same block for the same reason.
// ---------------------------------------------------------------------------
const S_stone = 0, S_vwall = 1, S_hwall = 2, S_tlcorn = 3, S_trcorn = 4,
      S_blcorn = 5, S_brcorn = 6, S_crwall = 7, S_tuwall = 8, S_tdwall = 9,
      S_tlwall = 10, S_trwall = 11,
      S_ndoor = 12, S_vodoor = 13, S_hodoor = 14, S_vcdoor = 15, S_hcdoor = 16,
      S_bars = 17, S_tree = 18,
      S_room = 19, S_darkroom = 20, S_engroom = 21,
      S_corr = 22, S_litcorr = 23, S_engrcorr = 24,
      S_upstair = 25, S_dnstair = 26, S_upladder = 27, S_dnladder = 28,
      S_brupstair = 29, S_brdnstair = 30, S_brupladder = 31, S_brdnladder = 32,
      S_altar = 33, S_grave = 34, S_throne = 35, S_sink = 36, S_fountain = 37,
      S_pool = 38, S_ice = 39, S_lava = 40, S_lavawall = 41,
      S_vodbridge = 42, S_hodbridge = 43, S_vcdbridge = 44, S_hcdbridge = 45,
      S_air = 46, S_cloud = 47, S_water = 48,
      S_arrow_trap = 49;
// C ref: sym.h MAXTCHARS == TRAPNUM - 1 (const.js:2481; TRAPNUM is 26).

// C ref: sym.h:98-108 — the cmap-range predicates, verbatim.
const is_cmap_trap = (i) => i >= S_arrow_trap && i < S_arrow_trap + MAXTCHARS;
const is_cmap_drawbridge = (i) => i >= S_vodbridge && i <= S_hcdbridge;
const is_cmap_door = (i) => i >= S_vodoor && i <= S_hcdoor;
const is_cmap_wall = (i) => i >= S_stone && i <= S_trwall;
const is_cmap_room = (i) => i >= S_room && i <= S_darkroom;
const is_cmap_corr = (i) => i >= S_corr && i <= S_litcorr;
const is_cmap_furniture = (i) => i >= S_upstair && i <= S_fountain;
const is_cmap_water = (i) => i === S_pool || i === S_water;
const is_cmap_lava = (i) => i === S_lava || i === S_lavawall;
const is_cmap_engraving = (i) => i === S_engroom || i === S_engrcorr;

// ---------------------------------------------------------------------------
// getpos.c:27-38 file-scope state.  C keeps these as `staticfn` function
// pointers plus two enum variables; the whole point of getpos_sethilite() is
// that they OUTLIVE a single getpos() call (jump()/polearm/read.c set them
// before the call and getpos()'s tail resets them with sethilite(NULL, NULL)).
// ---------------------------------------------------------------------------
let getpos_hilitefunc = null;
let getpos_getvalid = null;

// C ref: getpos.c:30 enum getposHiliteState.
const HiliteNormalMap = 0, HiliteGoodposSymbol = 1, HiliteBackground = 2;

let getpos_hilite_state = HiliteNormalMap;
let defaultHiliteState = HiliteNormalMap;

// C ref: getpos.c:40 getpos_sethilite(gp_hilitef, gp_getvalidf).
//
// Order matters and is easy to get wrong: getpos_getvalids_selection() is
// called TWICE on the SAME selection — once with the OLD validf and once with
// the NEW one — so `sel` ends up holding the UNION of the outgoing and incoming
// valid sets.  That union is what selection_force_newsyms() repaints, which is
// how spots that just stopped being valid get their old highlight cleared.
// Collapsing it to one call leaves stale '$' marks on the map.
export function getpos_sethilite(gp_hilitef, gp_getvalidf) {
    const old_getvalid = getpos_getvalid;
    const old_map_frame_color = wsettings_().map_frame_color;
    const sel = selection_new();

    defaultHiliteState = iflags_().bgcolors ? HiliteBackground : HiliteNormalMap;
    if (gp_getvalidf !== old_getvalid) getpos_hilite_state = defaultHiliteState;

    getpos_getvalids_selection(sel, getpos_getvalid);
    getpos_hilitefunc = gp_hilitef;
    getpos_getvalid = gp_getvalidf;
    getpos_getvalids_selection(sel, getpos_getvalid);
    wsettings_().map_frame_color = (getpos_hilite_state === HiliteBackground)
                                  ? HI_ZAP : NO_COLOR;

    if (getpos_getvalid !== old_getvalid
        || wsettings_().map_frame_color !== old_map_frame_color)
        selection_force_newsyms_(sel);
    /* selection_free(sel, TRUE) — nothing to free here */
}

// C ref: getpos.c:71 getpos_toggle_hilite_state() — the '$' key.  When 'bgcolors'
// is Off this alternates 2 states (off / temporary S_goodpos symbol); with
// 'bgcolors' On there are 3 and the background-colour state is the default.
// The tmp_at(DISP_END) teardown fires BEFORE the state advances, and the
// tmp_at(DISP_BEGIN) setup AFTER the sethilite() re-arm.
export function getpos_toggle_hilite_state() {
    /* getpos_hilitefunc isn't Null */
    if (getpos_hilite_state === HiliteGoodposSymbol) {
        /* currently on, finish */
        getpos_hilitefunc(false);      /* tmp_at(DISP_END) */
    }

    getpos_hilite_state = (getpos_hilite_state + 1)
                          % (iflags_().bgcolors ? 3 : 2);
    /* resetting the callbacks to their current values draws valid-spots with
       background colour if that is the new state and turns it off if it was
       the previous state */
    getpos_sethilite(getpos_hilitefunc, getpos_getvalid);

    if (getpos_hilite_state === HiliteGoodposSymbol) {
        /* now on, begin */
        getpos_hilitefunc(true);       /* tmp_at(DISP_BEGIN) */
    }
}

// C ref: getpos.c:93 mapxy_valid(x, y) — the public read of the file-scope
// validity callback.  FALSE when no caller installed one.
export function mapxy_valid(x, y) {
    if (getpos_getvalid) return getpos_getvalid(x, y);
    return false;
}

// C ref: getpos.c:101 getpos_getvalids_selection(sel, validf).  Note the x loop
// starts at 1 (map column 0 is unused) but the y loop starts at 0.
export function getpos_getvalids_selection(sel, validf) {
    let x, y;

    if (!sel || !validf) return;

    for (x = 1; x < sel.wid; x++)
        for (y = 0; y < sel.hei; y++)
            if (validf(x, y))
                selection_setpoint(x, y, sel, 1);
}

// C ref: getpos.c:117 gloc_descr[NUM_GLOCS][4] — [0] "cannot see/detect X",
// [1] "Pick an X", [2] cursor-mode help text, [3] menu-mode help text.  The
// help text picks column `2 + iflags.getloc_usemenu`, so [2] and [3] must stay
// adjacent and in this order.
const gloc_descr = [
    ['any monsters', 'monster', 'next/previous monster', 'monsters'],
    ['any items', 'item', 'next/previous object', 'objects'],
    ['any doors', 'door', 'next/previous door or doorway',
     'doors or doorways'],
    ['any unexplored areas', 'unexplored area', 'unexplored location',
     'locations next to unexplored locations'],
    ['anything interesting', 'interesting thing', 'anything interesting',
     'anything interesting'],
    ['any valid locations', 'valid location', 'valid location',
     'valid locations'],
];

// C ref: getpos.c:130 gloc_filtertxt[NUM_GFILTER].
const gloc_filtertxt = ['', ' in view', ' in this area'];

// C ref: getpos.c:136 getpos_help_keyxhelp(tmpwin, k1, k2, gloc) — one help
// line per next/prev key pair.  GLOC_EXPLORE is special twice over: its wording
// is "next to an" (the cursor lands one spot short of the unexplored square),
// and in menu mode its filter text is shortened "this area" -> "area" so the
// line does not wrap on an 80-column tty.
export function getpos_help_keyxhelp(tmpwin, k1, k2, gloc) {
    const ifl = iflags_();
    let move_cursor_to = 'move the cursor to ',
        filtertxt = gloc_filtertxt[ifl.getloc_filter | 0];

    if (gloc === GLOC_EXPLORE) {
        move_cursor_to = 'move the cursor next to an ';
        if (ifl.getloc_usemenu)
            filtertxt = strsubst_(filtertxt, 'this area', 'area');
    }
    const sbuf = `Use '${k1}'/'${k2}' to `
        + `${ifl.getloc_usemenu ? 'get a menu of ' : move_cursor_to}`
        + `${gloc_descr[gloc][2 + (ifl.getloc_usemenu ? 1 : 0)]}${filtertxt}.`;
    putstr_(tmpwin, 0, sbuf);
}

// C ref: getpos.c:311 cmp_coord_distu(a, b) — gather_locs()'s qsort comparator.
// The distance is CHEBYSHEV (max of the two absolute deltas), not dist2, and
// the tie-break is y THEN x.  The hero's own spot therefore always sorts to
// index 0, which is what makes "successive m's cycled all the way round" show
// as the cursor returning to the hero.
export function cmp_coord_distu(a, b) {
    let dx, dy, dist_1, dist_2;
    const u = game.u;

    dx = (u?.ux | 0) - a.x;
    dy = (u?.uy | 0) - a.y;
    dist_1 = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (u?.ux | 0) - b.x;
    dy = (u?.uy | 0) - b.y;
    dist_2 = Math.max(Math.abs(dx), Math.abs(dy));

    if (dist_1 === dist_2)
        return (a.y !== b.y) ? (a.y - b.y) : (a.x - b.x);

    return dist_1 - dist_2;
}

// C ref: getpos.c:340 gloc_filter_classify_glyph(glyph) — coarse terrain class
// used to decide whether two squares belong to the same "area".  A non-cmap
// glyph, and any cmap outside the five listed groups, is class 0 (which
// matcharea() below treats as "same class" for two class-0 glyphs).
export function gloc_filter_classify_glyph(glyph) {
    let c;

    if (!glyph_is_cmap_(glyph)) return 0;

    c = glyph_to_cmap_(glyph);

    if (is_cmap_room(c) || is_cmap_furniture(c)) return 1;
    else if (is_cmap_wall(c) || c === S_tree) return 2;
    else if (is_cmap_corr(c)) return 3;
    else if (is_cmap_water(c)) return 4;
    else if (is_cmap_lava(c)) return 5;
    return 0;
}

// C ref: getpos.c:363 gloc_filter_floodfill_matcharea(x, y) — the flood-fill
// membership test.  Order: the seenv gate FIRST (an unseen square never joins
// the area even if its terrain matches), then exact glyph equality, then the
// coarse class comparison.
export function gloc_filter_floodfill_matcharea(x, y) {
    const glyph = back_to_glyph_cmapidx(x, y);

    if (!seenv_(x, y)) return false;

    if (glyph === gloc_filter_floodfill_match_glyph) return true;

    if (gloc_filter_classify_glyph(glyph)
        === gloc_filter_classify_glyph(gloc_filter_floodfill_match_glyph))
        return true;

    return false;
}

// C ref: getpos.c:381 gloc_filter_floodfill(x, y).  The match glyph is latched
// from <x,y> BEFORE the fill starts, so every square is compared against the
// SEED's terrain rather than its neighbour's.
export function gloc_filter_floodfill(x, y) {
    gloc_filter_floodfill_match_glyph = back_to_glyph_cmapidx(x, y);

    set_selection_floodfillchk_(gloc_filter_floodfill_matcharea);
    selection_floodfill_(gloc_filter_map, x, y, false);
}

// C ref: getpos.c:390 gloc_filter_init() — build the "same area" map when the
// '"' filter is set to GFILTER_AREA.  Standing IN a doorway is special-cased:
// the fill seeds from the square the hero is heading INTO (u.dx,u.dy), because
// a doorway touches two different areas.  With no direction set, C deliberately
// does nothing (see its TODO), leaving an EMPTY filter map.
export function gloc_filter_init() {
    const u = game.u;
    if (iflags_().getloc_filter === GFILTER_AREA) {
        if (!gloc_filter_map) {
            gloc_filter_map = selection_new();
        }
        /* special case: if we're in a doorway, figure out which direction
           we're moving and use that side of the doorway */
        if (IS_DOOR(terrainTyp_(u.ux, u.uy))) {
            if ((u.dx || u.dy) && isok(u.ux + u.dx, u.uy + u.dy)) {
                gloc_filter_floodfill(u.ux + u.dx, u.uy + u.dy);
            } else {
                /* TODO: maybe add both sides of the doorway? */
            }
        } else {
            gloc_filter_floodfill(u.ux, u.uy);
        }
    }
}

// C ref: getpos.c:411 gloc_filter_done().
export function gloc_filter_done() {
    if (gloc_filter_map) {
        /* selection_free(gloc_filter_map, TRUE) */
        gloc_filter_map = null;
    }
}

// C ref: getpos.c:421 known_vibrating_square_at(x, y).  Only the GENUINE
// vibrating square counts — a wizard-mode wished-for VIBRATING_SQUARE trap
// elsewhere on the level (which could reach normal play through a bones file)
// answers FALSE because invocation_pos() gates it.
export function known_vibrating_square_at(x, y) {
    if (invocation_pos_(x, y)) {
        const ttmp = t_at_(x, y);

        return !!ttmp && ttmp.ttyp === VIBRATING_SQUARE && !!ttmp.tseen;
    }
    return false;
}

// C ref: getpos.c:556 dxdy_to_dist_descr(dx, dy, fulldir) — the "(east)" /
// "(3s)" / "(2n,4w)" body of the whatis_coord compass forms.  Three arms in
// this order: no delta at all -> "here"; an exact one-step direction ->
// directionname(); otherwise the row part then the column part, with the comma
// emitted by the ROW arm only when there is also a column part.
export function dxdy_to_dist_descr(dx, dy, fulldir) {
    let buf;
    let dst;

    if (!dx && !dy) {
        buf = 'here';
    } else if ((dst = xytodir_(dx, dy)) !== -1) {
        /* explicit direction; 'one step' is implicit */
        buf = directionname_(dst);
    } else {
        const dirnames = [
            ['n', 'north'],
            ['s', 'south'],
            ['w', 'west'],
            ['e', 'east'],
        ];
        buf = '';
        /* 9999: protect buf[] against overflow caused by invalid values */
        if (dy) {
            if (Math.abs(dy) > 9999) dy = sgn_(dy) * 9999;
            buf += `${Math.abs(dy)}${dirnames[(dy > 0) ? 1 : 0][fulldir ? 1 : 0]}`
                 + `${dx ? ',' : ''}`;
        }
        if (dx) {
            if (Math.abs(dx) > 9999) dx = sgn_(dx) * 9999;
            buf += `${Math.abs(dx)}${dirnames[2 + ((dx > 0) ? 1 : 0)][fulldir ? 1 : 0]}`;
        }
    }
    return buf;
}

// C ref: getpos.c:594 coord_desc(x, y, outbuf, cmode) — the 'whatis_coord'
// option's coordinate text.  Every arm STARTS by clearing outbuf, and the
// default (GPCOORDS_NONE) leaves it empty — that empty string is what makes
// auto_describe() drop the separating space.  Returns the buffer.
//   GPCOORDS_COMPASS / COMFULL  "(east)", "(3s)", "(2n,4w)"
//   GPCOORDS_MAP                "<x,y>"   (upper-left of map is <1,0>)
//   GPCOORDS_SCREEN             "[row,col]" as y+2,x, zero-padded to width 2
export function coord_desc(x, y, _outbuf, cmode) {
    let outbuf = '';
    let dx, dy;

    switch (cmode) {
    default:
        break;
    case GPCOORDS_COMFULL:
    case GPCOORDS_COMPASS:
        /* "east", "3s", "2n,4w" */
        dx = x - (game.u?.ux | 0);
        dy = y - (game.u?.uy | 0);
        outbuf = `(${dxdy_to_dist_descr(dx, dy, cmode === GPCOORDS_COMFULL)})`;
        break;
    case GPCOORDS_MAP: /* x,y */
        outbuf = `<${x},${y}>`;
        break;
    case GPCOORDS_SCREEN: /* y+2,x */
        /* fixed-width so that /m, /M, /o and /O output lines up cleanly; the
           width is "02" for any map no bigger than 99 rows / 99 columns */
        outbuf = `[${pad0_(y + 2, (ROWNO - 1 + 2 < 100) ? 2 : 3)},`
               + `${pad0_(x, (COLNO - 1 < 100) ? 2 : 3)}]`;
        break;
    }
    return outbuf;
}

// C ref: getpos.c:639 auto_describe(cx, cy) — the line getpos() rewrites under
// the cursor on every keystroke, and the reason the save/restore sessions turn
// on this whole file.
//
// THE ASSEMBLY ORDER IS THE POINT.  do_screen_description() fills tmpbuf AND
// sets firstmatch; coord_desc() then OVERWRITES tmpbuf with the coordinate
// text, so the printed line is
//     <firstmatch><space iff coords non-empty><coords><invalid?><notravel?>
// and the description text itself is carried only by firstmatch.  Reusing
// do_screen_description's buffer here (rather than a second one) is not a C
// wart to be tidied up: it is why GPCOORDS_NONE prints the bare description
// with no trailing space.
//
// The two suffixes are separately gated: "(invalid target)" needs
// iflags.autodescribe AND an installed getpos_getvalid that rejects the spot;
// "(no travel path)" needs iflags.getloc_travelmode (only travel's getpos sets
// it) and a findtravelpath() miss.
//
// custompline's flags are load-bearing for the recorded screen: SUPPRESS_HISTORY
// keeps the line out of ^P, OVERRIDE_MSGTYPE stops a msgtype rule hiding it,
// and NO_CURS_ON_U is why the cursor stays on <cx,cy> instead of snapping back
// to the hero.  Nothing here draws from the RNG.
export async function auto_describe(cx, cy) {
    const cc = { x: cx, y: cy };
    const sym = 0;
    let tmpbuf = '';
    let firstmatch = 'unknown';

    const dsd = await do_screen_description_(cc, true, sym, tmpbuf);
    if (dsd) {
        firstmatch = dsd.firstmatch;
        tmpbuf = coord_desc(cx, cy, tmpbuf, iflags_().getpos_coords);
        await custompline_(
            `${firstmatch}${tmpbuf ? ' ' : ''}${tmpbuf}`
            + `${(iflags_().autodescribe
                  && getpos_getvalid && !getpos_getvalid(cx, cy))
                 ? ' (invalid target)' : ''}`
            + `${(iflags_().getloc_travelmode && !is_valid_travelpt_(cx, cy))
                 ? ' (no travel path)' : ''}`);
        curs_(cx, cy);
        await flush_screen_(0);
    }
}

// C ref: getpos.c:664 getpos_menu(ccp, gloc) — the 'm'/'o'/'d'/'x' menu form
// (iflags.getloc_usemenu, toggled by '!').  gather_locs() runs FIRST, so its
// gloc_filter_init()/done() side effects happen even when the count is too low
// and the "You cannot see/detect ..." line is printed instead.
//
// gcount always includes the hero (gather_locs() forces u's own spot in), which
// is why the "nothing to pick" test is `< 2` and why the item loop starts at 1.
// The menu's a_int is `i + 1`, and the pick is read back as
// garr[picks->item.a_int - 1] — an off-by-one that cancels; do not "fix" it.
//
// BLOCKER: gather_locs() is module-private in js/hack.js:1809 (and has a
// different signature: it RETURNS the array instead of filling out-params).
// The fix is to export hack.js's, not to fork it here — so this returns FALSE
// until that export exists.
export async function getpos_menu(ccp, gloc) {
    const H = await import('./hack.js');
    if (typeof H.gather_locs !== 'function') return false;  /* see BLOCKER */
    const garr = H.gather_locs(gloc, getpos_getvalid);
    const gcount = garr.length;
    let i, pick_cnt;
    let tmpbuf = '';

    if (gcount < 2) { /* gcount always includes the hero */
        await custompline_(`You cannot `
            + `${(iflags_().getloc_filter === GFILTER_VIEW) ? 'see' : 'detect'} `
            + `${gloc_descr[gloc][0]}.`);
        return false;
    }

    const tmpwin = create_nhwindow_(NHW_MENU);
    start_menu_(tmpwin);

    /* gather_locs returns array[0] == you.  skip it. */
    for (i = 1; i < gcount; i++) {
        const tmpcc = { x: garr[i].x, y: garr[i].y };
        const sym = 0;
        const any_a_int = i + 1;
        const dsd = await do_screen_description_(tmpcc, true, sym, tmpbuf);
        if (dsd) {
            tmpbuf = coord_desc(garr[i].x, garr[i].y, tmpbuf,
                                iflags_().getpos_coords);
            const fullbuf = `${dsd.firstmatch}${tmpbuf ? ' ' : ''}${tmpbuf}`;
            add_menu_(tmpwin, any_a_int, fullbuf);
        }
    }

    tmpbuf = `Pick ${an_(gloc_descr[gloc][1])}`
           + `${gloc_filtertxt[iflags_().getloc_filter | 0]}`
           + `${iflags_().getloc_travelmode ? ' for travel destination' : ''}`;
    end_menu_(tmpwin, tmpbuf);
    const picks = await select_menu_(tmpwin, PICK_ONE);
    destroy_nhwindow_(tmpwin);
    pick_cnt = picks ? picks.length : 0;
    if (pick_cnt > 0) {
        ccp.x = garr[picks[0] - 1].x;
        ccp.y = garr[picks[0] - 1].y;
    }
    return (pick_cnt > 0);
}

// C ref: getpos.c:752 getpos_refresh() — the ^R response inside getpos().  The
// temporary S_goodpos overlay must be torn down BEFORE docrt() (otherwise
// docrt repaints over live tmp_at glyphs and the teardown then erases real map
// cells), and the background-colour form has to be re-armed AFTER it, because
// docrt() wipes the colours sethilite() painted.  Note the state is reset to
// defaultHiliteState by the teardown, so ^R also cancels a '$' toggle.
export async function getpos_refresh() {
    if (getpos_hilitefunc && getpos_hilite_state === HiliteGoodposSymbol) {
        getpos_hilitefunc(false);              /* tmp_at(DISP_END) */
        getpos_hilite_state = defaultHiliteState;
    }

    await docrt_flags_(1 /* docrtRefresh */);

    if (getpos_hilitefunc && getpos_hilite_state === HiliteBackground) {
        /* resetting to current values redraws valid-spots highlighting */
        getpos_sethilite(getpos_hilitefunc, getpos_getvalid);
    }
}

// ---------------------------------------------------------------------------
// decl.c `gg` fields getpos.c owns.  C keeps these in the global struct; they
// persist between gloc_filter_init() and gloc_filter_done().
// ---------------------------------------------------------------------------
let gloc_filter_map = null;
let gloc_filter_floodfill_match_glyph = -1;

// ---------------------------------------------------------------------------
// Shims.  Each names the C function it stands in for and where a real port
// lives.  getpos.c itself draws no RNG, so none of these can desync the stream;
// what they can get wrong is the TEXT of a recorded screen, which is why
// do_screen_description_() below is the one that matters.
// ---------------------------------------------------------------------------

// C ref: pager.c:779 do_screen_description(cc, ter_typ, glyph, out_str,
// firstmatch, for_supplement).  UNPORTED as a named function: the live
// equivalent is the `describe()` closure inside js/hack.js:1925 plus
// terrain_description() at js/hack.js:1410, both module-private.
//
// Keep in mind when wiring: C dispatches on the DISPLAYED glyph, not
// levl[][].typ.  A square drawn blank is S_stone, and defsym.h's PCHAR2 row
// makes defsyms[S_stone].explanation == "stone" — the "dark part of a room"
// string in that row is the TILE NAME, not the explanation.  Returning
// {firstmatch} mirrors C's `*firstmatch` out-parameter; C's return value is
// "did anything match", which is what gates the whole of auto_describe().
async function do_screen_description_(_cc, _ter_typ, _glyph, _out_str) {
    return null;   /* UNPORTED: nothing matched, so auto_describe() prints nothing */
}

// C ref: pline.c custompline(pflags, fmt, ...) / display.c curs(window, x, y) /
// flush_screen(cursor_on_u).  update_topl()/flush_screen() in js/display.js are
// the live pair; the cursor placement getpos uses is
// disp.setCursor(cx - 1, cy + 1) (see js/hack.js getpos_render).
async function custompline_(msg) {
    const { update_topl } = await import('./display.js');
    await update_topl(msg);
}
function curs_(cx, cy) {
    const disp = game.nhDisplay;
    if (disp?.setCursor) disp.setCursor(cx - 1, cy + 1);
}
async function flush_screen_(mode) {
    const { flush_screen } = await import('./display.js');
    await flush_screen(mode);
}
// C ref: display.c docrt_flags(flags) — js/display.js:1725 exports docrt().
async function docrt_flags_(_flags) {
    const { docrt } = await import('./display.js');
    await docrt();
}

// C ref: hack.c:1531 is_valid_travelpt(x, y) — port is js/hack.js:1526, private.
function is_valid_travelpt_(_x, _y) { return true; }

// C ref: selvar.c selection_force_newsyms(sel) / set_selection_floodfillchk(f)
// / selection_floodfill(ov, x, y, diagonals) / selection_free(sel, freesel).
// None of these four is ported in js/selvar.js; the fix is to add them there.
// All are RNG-free.  selection_floodfill is spelled out because
// gloc_filter_floodfill() is meaningless without it.
function selection_force_newsyms_(sel) {
    if (!sel) return;
    for (let y = 0; y < sel.hei; y++)
        for (let x = 1; x < sel.wid; x++)
            if (selection_getpoint(x, y, sel)) newsym(x, y);
}
let selection_flood_check_func = null;
function set_selection_floodfillchk_(f) { selection_flood_check_func = f; }
function selection_floodfill_(ov, x, y, diagonals) {
    const tmp = selection_new();
    const dx = [], dy = [];
    let idx = 0;
    const SEL_FLOOD = (nx, ny) => { dx[idx] = nx; dy[idx] = ny; idx++; };
    const sel_flood_havepoint = (mx, my) => {
        for (let i = 0; i < idx; i++) if (dx[i] === mx && dy[i] === my) return true;
        return false;
    };
    const CHKDIR = (mx, my, sel) => {
        if (isok(mx, my) && selection_flood_check_func(mx, my)
            && !selection_getpoint(mx, my, sel)
            && !sel_flood_havepoint(mx, my))
            SEL_FLOOD(mx, my);
    };

    if (!selection_flood_check_func) return;
    SEL_FLOOD(x, y);
    do {
        idx--;
        x = dx[idx];
        y = dy[idx];
        if (isok(x, y)) {
            selection_setpoint(x, y, ov, 1);
            selection_setpoint(x, y, tmp, 1);
        }
        CHKDIR(x + 1, y, tmp);
        CHKDIR(x - 1, y, tmp);
        CHKDIR(x, y + 1, tmp);
        CHKDIR(x, y - 1, tmp);
        if (diagonals) {
            CHKDIR(x + 1, y + 1, tmp);
            CHKDIR(x - 1, y - 1, tmp);
            CHKDIR(x - 1, y + 1, tmp);
            CHKDIR(x + 1, y - 1, tmp);
        }
    } while (idx > 0);
}

// C ref: display.c back_to_glyph(x, y), reduced to the cmap INDEX (see this
// file's header for the encoding).  Faithful to display.c's switch except for
// wall_angle(): that routine picks between the eleven wall variants using the
// neighbouring seenv bits and is not ported, so a seen wall reports the index
// its typ implies.  gloc_filter_classify_glyph() maps every wall variant to
// class 2 so the classify path is unaffected; only the exact-equality test in
// gloc_filter_floodfill_matcharea() can differ, and only between two walls of
// different orientation (which are the same class anyway).
function back_to_glyph_cmapidx(x, y) {
    const ptr = game.level?.at(x, y);
    if (!ptr) return S_stone;
    let idx;

    switch (ptr.typ) {
    case SCORR:
    case STONE:
        idx = game.level?.flags?.arboreal ? S_tree : S_stone;
        break;
    case ROOM:
        idx = S_room;
        break;
    case CORR:
        idx = (ptr.waslit || game.flags?.lit_corridor) ? S_litcorr : S_corr;
        break;
    case SDOOR:
        if (ptr.arboreal_sdoor) { idx = S_tree; break; }
        /* FALLTHRU */
    case HWALL: case VWALL:
    case TLCORNER: case TRCORNER: case BLCORNER: case BRCORNER:
    case CROSSWALL: case TUWALL: case TDWALL: case TLWALL: case TRWALL:
        idx = ptr.seenv ? wall_angle_(ptr) : S_stone;
        break;
    case DOOR:
        if (ptr.doormask) {
            if (ptr.doormask & D_BROKEN) idx = S_ndoor;
            else if (ptr.doormask & D_ISOPEN)
                idx = ptr.horizontal ? S_hodoor : S_vodoor;
            else /* else is closed */
                idx = ptr.horizontal ? S_hcdoor : S_vcdoor;
        } else {
            idx = S_ndoor;
        }
        break;
    case IRONBARS: idx = S_bars; break;
    case TREE: idx = S_tree; break;
    case POOL:
    case MOAT: idx = S_pool; break;
    case STAIRS: {
        const sway = stairway_at_(x, y);
        if (known_branch_stairs_(sway))
            idx = (ptr.ladder & LA_DOWN) ? S_brdnstair : S_brupstair;
        else
            idx = (ptr.ladder & LA_DOWN) ? S_dnstair : S_upstair;
        break;
    }
    case LADDER: {
        const sway = stairway_at_(x, y);
        if (known_branch_stairs_(sway))
            idx = (ptr.ladder & LA_DOWN) ? S_brdnladder : S_brupladder;
        else
            idx = (ptr.ladder & LA_DOWN) ? S_dnladder : S_upladder;
        break;
    }
    case FOUNTAIN: idx = S_fountain; break;
    case SINK: idx = S_sink; break;
    case ALTAR: idx = S_altar; break;   /* C uses altar_to_glyph(altarmask),
                                           still a cmap glyph -> S_altar */
    case GRAVE: idx = S_grave; break;
    case THRONE: idx = S_throne; break;
    case LAVAPOOL: idx = S_lava; break;
    case LAVAWALL: idx = S_lavawall; break;
    case ICE: idx = S_ice; break;
    case AIR: idx = S_air; break;
    case CLOUD: idx = S_cloud; break;
    case WATER: idx = S_water; break;
    case DBWALL: idx = ptr.horizontal ? S_hcdbridge : S_vcdbridge; break;
    case DRAWBRIDGE_UP:
        switch (ptr.drawbridgemask & DB_UNDER) {
        case DB_MOAT: idx = S_pool; break;
        case DB_LAVA: idx = S_lava; break;
        case DB_ICE: idx = S_ice; break;
        case DB_FLOOR: idx = S_room; break;
        default: idx = S_room; break;   /* impossible("Strange db-under") */
        }
        break;
    case DRAWBRIDGE_DOWN:
        idx = ptr.horizontal ? S_hodbridge : S_vodbridge;
        break;
    default:
        idx = S_room;                   /* impossible("unknown level type") */
        break;
    }
    return idx;
}
// C ref: display.c wall_angle(lev) — UNPORTED (see back_to_glyph_cmapidx).
function wall_angle_(ptr) {
    switch (ptr.typ) {
    case VWALL: return S_vwall;
    case HWALL: return S_hwall;
    case TLCORNER: return S_tlcorn;
    case TRCORNER: return S_trcorn;
    case BLCORNER: return S_blcorn;
    case BRCORNER: return S_brcorn;
    case CROSSWALL: return S_crwall;
    case TUWALL: return S_tuwall;
    case TDWALL: return S_tdwall;
    case TLWALL: return S_tlwall;
    case TRWALL: return S_trwall;
    default: return S_stone;
    }
}
// C ref: stairs.c stairway_at(x, y) / known_branch_stairs(sway) —
// js/display.js:732/759 export both; kept local so this file's static import
// list stays at newsym().
function stairway_at_(x, y) {
    for (let s = game.stairs; s; s = s.next) if (s.sx === x && s.sy === y) return s;
    return null;
}
function known_branch_stairs_(sway) {
    return !!(sway && sway.tolev && sway.tolev.dnum !== (game.u?.uz?.dnum ?? 0)
              && sway.u_traversed);
}

// The glyph decode this file's encoding collapses (see header).
function glyph_is_cmap_(g) { return g >= 0; }
function glyph_to_cmap_(g) { return g; }

function terrainTyp_(x, y) { return game.level?.at(x, y)?.typ; }
function seenv_(x, y) { return !!game.level?.at(x, y)?.seenv; }
// C ref: trap.c t_at(x, y) — js/hack.js:577 / js/trap.js copies are private.
function t_at_(x, y) {
    for (const t of (game.level?.traps || [])) if (t.tx === x && t.ty === y) return t;
    return null;
}
// C ref: dungeon.c invocation_pos(x, y) — js/hack.js:3773 (private) reads the
// same field.
function invocation_pos_(x, y) {
    const inv = game.level?.invocation_pos;
    return !!inv && inv.x === x && inv.y === y;
}

// C ref: decl.c iflags / gw.wsettings.  getloc_filter/getloc_usemenu/
// getloc_moveskip/getloc_travelmode/autodescribe/bgcolors/getpos_coords all
// live here; js/hack.js:1177 gp_iflags() is the live accessor and defaults
// autodescribe On, which this mirrors.
function iflags_() {
    const ifl = (game.iflags = game.iflags || {});
    if (ifl.autodescribe === undefined) ifl.autodescribe = true;
    if (ifl.getloc_filter === undefined) ifl.getloc_filter = 0;
    if (ifl.getpos_coords === undefined) ifl.getpos_coords = GPCOORDS_NONE;
    return ifl;
}
function wsettings_() {
    return (game.wsettings = game.wsettings || { map_frame_color: NO_COLOR });
}

// C ref: cmd.c xytodir(x, y) / directionname(dir) — xdir[]/ydir[] order is
// W, NW, N, NE, E, SE, S, SW (then down, up).  js/cmd.js:6605 exports
// directionname; js/dothrow.js:1008 has a private xytodir.
const xdir_ = [-1, -1, 0, 1, 1, 1, 0, -1];
const ydir_ = [0, -1, -1, -1, 0, 1, 1, 1];
const dirnames_ = ['west', 'northwest', 'north', 'northeast', 'east',
                   'southeast', 'south', 'southwest', 'down', 'up'];
function xytodir_(x, y) {
    for (let dd = 0; dd < 8; dd++)
        if (x === xdir_[dd] && y === ydir_[dd]) return dd;
    return -1;                                       /* DIR_ERR */
}
function directionname_(dir) {
    if (dir < 0 || dir >= dirnames_.length) return 'invalid';
    return dirnames_[dir];
}
function sgn_(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
function pad0_(n, w) { return String(n).padStart(w, '0'); }
// C ref: hacklib.c strsubst(bp, orig, replacement) — first occurrence only.
function strsubst_(bp, orig, replacement) {
    return String(bp).replace(orig, replacement);
}
// C ref: objnam.c an(str) — js/hack.js:2633 / js/objnam.js copies are private.
function an_(s) {
    const str = String(s || '');
    if (!str) return str;
    return (/^[aeiouAEIOU]/.test(str) ? 'an ' : 'a ') + str;
}
// C ref: window.c putstr / create_nhwindow / start_menu / add_menu / end_menu /
// select_menu / destroy_nhwindow.  js/end.js:1375 and js/invent.js:1238 have
// private no-op stubs of the same shape.
function putstr_(win, _attr, str) { if (win?.lines) win.lines.push(str); }
function create_nhwindow_(type) { return { type, lines: [], items: [] }; }
function start_menu_(_win) { }
function add_menu_(win, a_int, text) { win.items.push({ a_int, text }); }
function end_menu_(_win, _query) { }
async function select_menu_(_win, _how) { return null; }
function destroy_nhwindow_(_win) { }
