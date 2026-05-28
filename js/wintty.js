// wintty.js - TTY windowing port.
// C ref: win/tty/wintty.c
//
// This module keeps the same one-function-per-C-function surface as
// wintty.c.  The current JS engine already has a small display facade in
// display.js/game_display.js; this file provides the coherent tty window
// state and behavior that callers can move to incrementally.

import { game } from './gstate.js';
import { nhgetch } from './input.js';
import { bot, cls, docrt, flush_screen, pline, show_glyph_cell } from './display.js';
import {
    BL_ALIGN, BL_CAP, BL_CH, BL_CO, BL_CONDITION, BL_DX, BL_ENE, BL_ENEMAX,
    BL_EXP, BL_FLUSH, BL_GOLD, BL_HD, BL_HP, BL_HPMAX, BL_HUNGER, BL_IN,
    BL_LEVELDESC, BL_RESET, BL_SCORE, BL_STR, BL_TIME, BL_TITLE, BL_VERS,
    BL_WI, COLNO, CONDITION_COUNT, MAXBLSTATS, MENU_BEHAVE_PERMINV,
    MENU_FIRST_PAGE, MENU_INVERT_ALL, MENU_INVERT_PAGE, MENU_ITEMFLAGS_SELECTED,
    MENU_LAST_PAGE, MENU_NEXT_PAGE, MENU_PREVIOUS_PAGE, MENU_SEARCH,
    MENU_SELECT_ALL, MENU_SELECT_PAGE, MENU_UNSELECT_ALL, MENU_UNSELECT_PAGE,
    NHW_BASE, NHW_MAP, NHW_MENU, NHW_MESSAGE, NHW_PERMINVENT, NHW_STATUS,
    NHW_TEXT, PICK_ANY, PICK_NONE, PICK_ONE, ROWNO, ATR_URGENT,
    WIN_CANCELLED, WIN_ERR, WIN_NOSTOP, WIN_STOP,
} from './const.js';
import {
    ATR_BOLD, ATR_INVERSE, ATR_NONE, CLR_GRAY, NO_COLOR,
} from './terminal.js';

const MAXWIN = 20;
const QBUFSZ = 256;
const BUFSZ = 1024;
const TOPLINE_EMPTY = 0;
const TOPLINE_NEED_MORE = 1;
const TOPLINE_NON_EMPTY = 2;
const TOPLINE_SPECIAL_PROMPT = 3;
const MAX_STATUS_ROWS = 3;
const NOW = 0;
const BEFORE = 1;
const NH_BASIC_COLOR = 1;
const NO_GLYPH = -1;
const ESC = '\x1b';

// TODO(wintty): replace these local shims when the corresponding C modules
// have JS ports with stable imports.
function noop() {}
function clearlocks() {}
function nh_terminate() {}
function panic(msg, ...args) { throw new Error(format(msg, ...args)); }
function impossible(msg, ...args) { game._impossible = format(msg, ...args); }
function nhassert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }
function copyright_banner_line(i) {
    return [
        '',
        'NetHack, Copyright 1985-2026',
        'By Stichting Mathematisch Centrum and M. Stephenson.',
        'Version 5.0.0.',
        'See license for details.',
    ][i] || '';
}
function getwindowsz() { return { rows: displayRows(), cols: displayCols() }; }
function gettty() {}
function setftty() {}
function settty() {}
function term_startup(size) {
    size.cols = displayCols();
    size.rows = displayRows();
}
function term_shutdown() {}
function term_clear_screen() { const d = display(); if (d?.clearScreen) d.clearScreen(); }
function term_curs_set_impl(visibility) { const d = display(); if (d?.cursSet) d.cursSet(visibility); }
function term_start_attr(_attr) {}
function term_end_attr(_attr) {}
function term_start_color(_color) {}
function term_end_color() {}
function term_start_bgcolor_impl(_color) {}
function term_start_raw_bold() {}
function term_end_raw_bold() {}
function term_start_extracolor(_color, _idx) {}
function term_end_extracolor() {}
function term_attr_fixup(attr) { return attr || ATR_NONE; }
function standoutbeg() { term_start_attr(ATR_INVERSE); }
function standoutend() { term_end_attr(ATR_INVERSE); }
function graph_on() {}
function graph_off() {}
function backsp() { const d = display(); if (d) d.cursorCol = Math.max(0, (d.cursorCol || 0) - 1); }
function cl_end() { const d = display(); if (d?.clearToEol) d.clearToEol(); }
function cl_eos() {
    const d = display();
    if (!d?.clearRow) return;
    for (let r = d.cursorRow || 0; r < d.rows; r++) d.clearRow(r);
}
function home() { const d = display(); if (d?.setCursor) d.setCursor(0, 0); }
function cmov(x, y) { const d = display(); if (d?.setCursor) d.setCursor(x, y); }
function nocmov(x, y) { cmov(x, y); }
function row_refresh(_start, _stop, _row) {}
function redraw_map(_force) {}
function addtopl(s) { if (ttyDisplay) ttyDisplay.toplines = String(s || ''); }
function remember_topl() {}
function update_topl(s) { show_topl(s); }
function show_topl(s) {
    const d = display();
    if (d?.putstr_message) d.putstr_message(String(s || ''));
    game._pending_message = String(s || '');
    if (ttyDisplay) {
        ttyDisplay.toplin = s ? TOPLINE_NEED_MORE : TOPLINE_EMPTY;
        ttyDisplay.toplines = String(s || '');
    }
}
function more() { if (ttyDisplay) ttyDisplay.toplin = TOPLINE_EMPTY; }
function free_pickinv_cache() {}
function genl_player_setup() { return true; }
function restore_menu() { return 0; }
function genl_preference_update(_pref) {}
function genl_outrip() {}
function genl_status_finish() {}
function genl_status_init() {}
function genl_status_enablefield(_fieldidx, _nm, _fmt, _enable) {}
function genl_status_update() {}
function genl_can_suspend_yes() { return true; }
function perm_invent_toggled(_on) {}
function sync_perminvent() {}
function status_initialize(_mode) {}
function status_sanity_external() {}
function set_wc2_option_mod_status(_wc2, _status) {}
function set_option_mod_status(_opt, _status) {}
function menuitem_invert_test(op, itemflags, selected) {
    void op; void selected;
    return !(itemflags & 0x0000002);
}
function map_menu_cmd(ch) { return ch; }
function AppendLongDigit(n, dgt) {
    const next = n * 10 + dgt;
    return next > Number.MAX_SAFE_INTEGER ? -1 : next;
}
function pmatchi(pattern, text) {
    const p = String(pattern || '').replace(/^\*/, '').replace(/\*$/, '').toLowerCase();
    return String(text || '').toLowerCase().includes(p);
}
function tabexpand(s) { return String(s || '').replace(/\t/g, '        '); }
function decode_mixed(buf, str) {
    const text = String(str || '').replace(/\\G[0-9A-Fa-f]{8}:?/g, '');
    if (Array.isArray(buf)) buf[0] = text;
    return text;
}
function mixed_to_utf8(buf, _size, str, flagRef) {
    if (Array.isArray(flagRef)) flagRef[0] = 0;
    return decode_mixed(buf, str);
}
function map_glyphinfo(_x, _y, glyph, _mgflags, gi) {
    if (!gi) return;
    gi.glyph = glyph;
    gi.ttychar = gi.ttychar || ' ';
    gi.gm = gi.gm || { sym: { color: NO_COLOR }, glyphflags: 0 };
}
function cmap_D0walls_to_glyph(sym) { return sym; }
function money_cnt(invent) {
    return (invent || []).filter(o => o?.oclass === 12).reduce((n, o) => n + (o.quan || 0), 0);
}
function critically_low_hp() { return false; }
function stat_cap_indx() { return 0; }
function repad_with_dashes(s) { return s; }
function randomkey() { return ESC.charCodeAt(0); }
function tgetch() { return ESC.charCodeAt(0); }

export let BASE_WINDOW = WIN_ERR;
export const wins = Array(MAXWIN).fill(null);
export let ttyDisplay = null;
export const defmorestr = '--More--';

let erasing_tty_screen = 0;
let clipping = false;
let clipx = 0, clipxmax = 0, clipy = 0, clipymax = 0;
let vt_tile_current_window = -2;
let calling_from_update_inventory = false;
let tty_menu_promptstyle = { color: NO_COLOR, attr: ATR_NONE };
let tty_colormasks = null;
let tty_condition_bits = 0;
let hpbar_percent = 0, hpbar_crit_hp = 0;
let windowdata_init = false;
let cond_shrinklvl = 0, enc_shrinklvl = 0, enclev = 0, dlvl_shrinklvl = 0;
let truncation_expected = false;
let do_field_opt = 1;
let fieldorder = null;
let morc = 0;

const tty_status = [
    Array(MAXBLSTATS).fill(null).map(() => emptyStatusField()),
    Array(MAXBLSTATS).fill(null).map(() => emptyStatusField()),
];
const finalx = [
    [0, 0],
    [0, 0],
    [0, 0],
];
const status_vals = Array(MAXBLSTATS).fill('');
const status_activefields = Array(MAXBLSTATS).fill(true);
const status_fieldfmt = Array(MAXBLSTATS).fill('%s');
const conditions = Array(CONDITION_COUNT || 0).fill(null);
const cond_idx = conditions.map((_, i) => i);

const twolineorder = [
    [BL_TITLE, BL_STR, BL_DX, BL_CO, BL_IN, BL_WI, BL_CH, BL_ALIGN, BL_SCORE, BL_FLUSH],
    [BL_LEVELDESC, BL_GOLD, BL_HP, BL_HPMAX, BL_ENE, BL_ENEMAX, BL_CAP, BL_CONDITION, BL_FLUSH],
    [BL_FLUSH],
];
const threelineorder = [
    [BL_TITLE, BL_STR, BL_DX, BL_CO, BL_IN, BL_WI, BL_CH, BL_SCORE, BL_FLUSH],
    [BL_ALIGN, BL_GOLD, BL_HP, BL_HPMAX, BL_ENE, BL_ENEMAX, BL_CAP, BL_FLUSH],
    [BL_LEVELDESC, BL_TIME, BL_CONDITION, BL_VERS, BL_FLUSH],
];
const encvals = [
    ['', 'Burdened', 'Stressed', 'Strained', 'Overtaxed', 'Overloaded'],
    ['', 'Burden', 'Stress', 'Strain', 'Overtax', 'Overload'],
    ['', 'Brd', 'Strs', 'Strn', 'Ovtx', 'Ovld'],
];

function display() { return game?.nhDisplay || null; }
function displayRows() { return display()?.rows ?? 24; }
function displayCols() { return display()?.cols ?? 80; }
function StatusRows() {
    const n = game.iflags?.wc2_statuslines ?? 2;
    return n <= 2 ? 2 : MAX_STATUS_ROWS;
}
function bool(v) { return !!v; }
function min(a, b) { return Math.min(a, b); }
function max(a, b) { return Math.max(a, b); }
function chr(c) { return typeof c === 'number' ? String.fromCharCode(c) : String(c || ''); }
function code(c) { return typeof c === 'number' ? c : String(c || '\0').charCodeAt(0); }
function format(fmt, ...args) {
    let i = 0;
    return String(fmt || '').replace(/%[sd]/g, m => String(args[i++] ?? (m === '%d' ? 0 : '')));
}
function putchar(ch) {
    const d = display();
    if (d?.putCharAtCursor) d.putCharAtCursor(chr(ch));
    else if (d?.putString) d.putString(chr(ch));
    if (ttyDisplay) ttyDisplay.curx = (ttyDisplay.curx || 0) + 1;
}
function xputs(s) {
    const d = display();
    if (d?.putString) d.putString(String(s || ''));
    else {
        for (const ch of String(s || '')) putchar(ch);
    }
    if (ttyDisplay) ttyDisplay.curx = (ttyDisplay.curx || 0) + String(s || '').length;
}
function puts(s) { xputs(String(s || '') + '\n'); }
function xwaitforspace(valid = ' ') {
    void valid;
    morc = ' '.charCodeAt(0);
}
function ttywindowpanic(window = WIN_ERR) { panic('Bad window Id %d (wintty.js)', window); }
function emptyStatusField() {
    return { idx: BL_FLUSH, color: NO_COLOR, attr: ATR_NONE, x: 0, y: 0, lth: 0,
        valid: false, dirty: false, redraw: false, sanitycheck: false };
}
function newWinDesc(type) {
    return {
        type, flags: 0, active: false, curx: 0, cury: 0, offx: 0, offy: 0,
        rows: 0, cols: 0, maxrow: 0, maxcol: 0, morestr: null, mlist: null,
        plist: null, plist_size: 0, npages: 0, nitems: 0, how: PICK_NONE,
        mbehavior: 0, data: null, datlen: null, cells: null,
    };
}
function menuArray(head) {
    const out = [];
    for (let p = head; p; p = p.next) out.push(p);
    return out;
}
function setMenuArray(cw, arr) {
    cw.mlist = null;
    for (let i = arr.length - 1; i >= 0; --i) {
        arr[i].next = cw.mlist;
        cw.mlist = arr[i];
    }
}

export const tty_procs = {
    name: 'tty',
    init_nhwindows: tty_init_nhwindows,
    player_selection: tty_player_selection,
    askname: tty_askname,
    get_nh_event: tty_get_nh_event,
    exit_nhwindows: tty_exit_nhwindows,
    suspend_nhwindows: tty_suspend_nhwindows,
    resume_nhwindows: tty_resume_nhwindows,
    create_nhwindow: tty_create_nhwindow,
    clear_nhwindow: tty_clear_nhwindow,
    display_nhwindow: tty_display_nhwindow,
    destroy_nhwindow: tty_destroy_nhwindow,
    curs: tty_curs,
    putstr: tty_putstr,
    putmixed: tty_putmixed,
    display_file: tty_display_file,
    start_menu: tty_start_menu,
    add_menu: tty_add_menu,
    end_menu: tty_end_menu,
    select_menu: tty_select_menu,
    message_menu: tty_message_menu,
    mark_synch: tty_mark_synch,
    wait_synch: tty_wait_synch,
    print_glyph: tty_print_glyph,
    raw_print: tty_raw_print,
    raw_print_bold: tty_raw_print_bold,
    nhgetch: tty_nhgetch,
    nh_poskey: tty_nh_poskey,
    preference_update: tty_preference_update,
    status_init: tty_status_init,
    status_enablefield: tty_status_enablefield,
    status_update: tty_status_update,
    update_inventory: tty_update_inventory,
    ctrl_nhwindow: tty_ctrl_nhwindow,
};

export function print_vt_code(i, c = -1, d = -1) {
    if (!game.iflags?.vt_tiledata) return;
    if (i === 2 && c === vt_tile_current_window) return;
    if (i === 2) vt_tile_current_window = c;
    void d;
}

export function print_vt_soundcode_idx(idx, v) {
    if (!game.iflags?.vt_sounddata) return;
    void idx; void v;
}

export function bail(mesg) {
    clearlocks();
    tty_exit_nhwindows(mesg);
    nh_terminate(0);
}

export function winch_handler(_sig_unused) {
    game.program_state = game.program_state || {};
    game.program_state.resize_pending = (game.program_state.resize_pending || 0) + 1;
    if (game.program_state.getting_char) resize_tty();
}

export function resize_tty() {
    const oldRows = ttyDisplay?.rows;
    const oldCols = ttyDisplay?.cols;
    const sz = getwindowsz();
    game.program_state = game.program_state || {};
    game.program_state.resize_pending = 0;
    if (!ttyDisplay || (oldRows === sz.rows && oldCols === sz.cols)) return;
    ttyDisplay.rows = sz.rows;
    ttyDisplay.cols = sz.cols;
    const bw = wins[BASE_WINDOW];
    if (bw) { bw.rows = sz.rows; bw.cols = sz.cols; }
    if (!game.iflags?.window_inited) return;
    term_clear_screen();
    new_status_window();
    if (game.WIN_MAP !== WIN_ERR && wins[game.WIN_MAP]?.active) {
        docrt();
        bot();
        tty_curs(game.WIN_MAP, game.u?.ux || 1, game.u?.uy || 0);
        tty_display_nhwindow(game.WIN_MAP, false);
    }
}

export function newclipping(x, y) {
    if (displayCols() < COLNO || displayRows() < 1 + ROWNO + StatusRows()) {
        setclipped();
        if (x) tty_cliparound(x, y);
    } else {
        clipping = false;
        clipx = clipy = 0;
    }
}

export function new_status_window() {
    if (game.WIN_STATUS !== WIN_ERR && wins[game.WIN_STATUS]) {
        tty_clear_nhwindow(game.WIN_STATUS);
        tty_destroy_nhwindow(game.WIN_STATUS);
        game.WIN_STATUS = WIN_ERR;
    }
    genl_status_finish();
    tty_status_init();
    if (game.WIN_STATUS !== WIN_ERR) tty_clear_nhwindow(game.WIN_STATUS);
}

export function tty_init_nhwindows(_argcp, _argv) {
    game.iflags = game.iflags || {};
    game.program_state = game.program_state || {};
    game.iflags.wc2_statuslines = StatusRows();
    gettty();
    const sz = {};
    term_startup(sz);
    setftty();
    term_curs_set(0);
    ttyDisplay = {
        toplin: TOPLINE_EMPTY, toplines: '', topl_utf8: 0, rows: sz.rows,
        cols: sz.cols, curx: 0, cury: 0, inmore: 0, inread: 0, intr: 0,
        dismiss_more: 0, color: NO_COLOR, framecolor: NO_COLOR,
        colorflags: NH_BASIC_COLOR, attrs: 0, mixed: 0, rawprint: 0,
        lastwin: WIN_ERR,
    };
    game.ttyDisplay = ttyDisplay;
    BASE_WINDOW = tty_create_nhwindow(NHW_BASE);
    wins[BASE_WINDOW].active = true;
    tty_clear_nhwindow(BASE_WINDOW);
    tty_curs(BASE_WINDOW, 1, 4);
    for (let i = 1; i <= 4; ++i) tty_putstr(BASE_WINDOW, 0, copyright_banner_line(i));
    tty_putstr(BASE_WINDOW, 0, '');
    tty_display_nhwindow(BASE_WINDOW, false);
    tty_curs(BASE_WINDOW, 1, 11);
}

export function tty_preference_update(pref) {
    const newstatuslines = pref === 'statuslines' && game.iflags?.window_inited;
    if (newstatuslines) {
        new_status_window();
        newclipping(game.u?.ux || 0, game.u?.uy || 0);
    }
    genl_preference_update(pref);
}

export function tty_player_selection() {
    if (genl_player_setup(ttyDisplay?.rows || displayRows())) return;
    bail(null);
}

export async function tty_askname() {
    const prompt = 'Who are you? ';
    tty_putstr(BASE_WINDOW, 0, '');
    tty_putstr(BASE_WINDOW, 0, prompt);
    let name = '';
    for (;;) {
        const c = await tty_nhgetch();
        if (c === 10 || c === 13) break;
        if (c === 27) { name = ''; break; }
        if (c === 8 || c === 127) name = name.slice(0, -1);
        else if (c >= 32 && c < 127) name += String.fromCharCode(c);
    }
    game.plname = name || game.plname || 'Hero';
    game.iflags = game.iflags || {};
    game.iflags.renameallowed = true;
}

export function tty_get_nh_event() {}

export function getret() {
    xputs('\nHit space to continue: ');
    xwaitforspace(' ');
    if (game.iflags) game.iflags.raw_printed = 0;
}

export function tty_suspend_nhwindows(str) {
    term_curs_set(1);
    settty(str);
    if (!str) tty_raw_print('');
}

export function tty_resume_nhwindows() {
    gettty();
    setftty();
    term_curs_set(0);
    docrt();
}

export function tty_get_color_string() { return null; }

export function tty_exit_nhwindows(str) {
    tty_suspend_nhwindows(str);
    free_pickinv_cache();
    for (let i = 0; i < MAXWIN; i++) {
        if (i === BASE_WINDOW) continue;
        wins[i] = null;
    }
    game.WIN_MAP = game.WIN_MESSAGE = game.WIN_INVEN = game.WIN_STATUS = WIN_ERR;
    term_shutdown();
    if (game.iflags) game.iflags.window_inited = 0;
}

export function tty_create_nhwindow(type) {
    let newid = wins.findIndex(w => !w);
    if (newid < 0) panic('No window slots!');
    const newwin = newWinDesc(type);
    wins[newid] = newwin;
    switch (type) {
    case NHW_BASE:
        newwin.rows = ttyDisplay?.rows ?? displayRows();
        newwin.cols = ttyDisplay?.cols ?? displayCols();
        break;
    case NHW_MESSAGE:
        newwin.rows = newwin.maxrow = max(game.iflags?.msg_history || 20, 20);
        newwin.cols = newwin.maxcol = 0;
        newwin.data = Array(newwin.rows).fill('');
        newwin.datlen = Array(newwin.rows).fill(0);
        newwin.maxrow = 0;
        game.WIN_MESSAGE = newid;
        break;
    case NHW_STATUS:
        game.iflags = game.iflags || {};
        game.iflags.wc2_statuslines = StatusRows();
        newwin.offx = 0;
        newwin.offy = min((ttyDisplay?.rows ?? displayRows()) - game.iflags.wc2_statuslines, ROWNO + 1);
        newwin.rows = newwin.maxrow = game.iflags.wc2_statuslines;
        newwin.cols = newwin.maxcol = ttyDisplay?.cols ?? displayCols();
        newwin.data = Array.from({ length: newwin.maxrow },
            () => ' '.repeat(max(0, newwin.maxcol - 1)) + '\0');
        newwin.datlen = Array(newwin.maxrow).fill(newwin.maxcol);
        game.WIN_STATUS = newid;
        break;
    case NHW_MAP:
        newwin.offy = 1;
        newwin.rows = ROWNO;
        newwin.cols = COLNO;
        game.WIN_MAP = newid;
        break;
    case NHW_MENU:
    case NHW_TEXT:
    case NHW_PERMINVENT:
        newwin.cols = ttyDisplay?.cols ?? displayCols();
        break;
    default:
        panic('Tried to create window type %d', type);
    }
    return newid;
}

export function erase_menu_or_text(window, cw, clear) {
    if (cw.offx === 0) {
        if (cw.offy) {
            tty_curs(window, 1, 0);
            cl_eos();
        } else if (clear) term_clear_screen();
        else {
            docrt();
            flush_screen(1);
        }
    } else {
        docorner(cw.offx, cw.maxrow + 1, 0);
    }
}

export function free_window_info(cw, free_data) {
    if (!cw) return;
    if (free_data) {
        cw.data = null;
        cw.datlen = null;
        cw.rows = 0;
    } else if (Array.isArray(cw.data)) {
        cw.data.length = 0;
    }
    cw.maxrow = cw.maxcol = 0;
    cw.mlist = null;
    cw.plist = null;
    cw.plist_size = cw.npages = cw.nitems = cw.how = 0;
    cw.morestr = null;
}

export function tty_clear_nhwindow(window) {
    const cw = wins[window];
    if (window === WIN_ERR || !cw) ttywindowpanic(window);
    if (ttyDisplay) ttyDisplay.lastwin = window;
    print_vt_code(2, window);
    switch (cw.type) {
    case NHW_MESSAGE:
        if (ttyDisplay) ttyDisplay.toplin = TOPLINE_EMPTY;
        cw.curx = cw.cury = 0;
        if (!erasing_tty_screen) {
            home();
            cl_end();
        }
        break;
    case NHW_STATUS:
        cw.data = Array.from({ length: cw.maxrow },
            () => ' '.repeat(max(0, cw.cols - 1)) + '\0');
        game.disp = game.disp || {};
        game.disp.botlx = true;
        break;
    case NHW_MAP:
        game.disp = game.disp || {};
        game.disp.botlx = true;
        if (!erasing_tty_screen) term_clear_screen();
        break;
    case NHW_BASE:
        if (!erasing_tty_screen) term_clear_screen();
        break;
    case NHW_MENU:
    case NHW_TEXT:
    case NHW_PERMINVENT:
        if (!erasing_tty_screen) {
            if (cw.active) erase_menu_or_text(window, cw, true);
            free_window_info(cw, false);
        }
        break;
    default:
        break;
    }
    cw.curx = cw.cury = 0;
}

export function toggle_menu_curr(window, curr, lineno, in_view, counting, count) {
    if (curr.selected) {
        if (counting && count > 0) {
            curr.count = count;
        } else {
            curr.selected = false;
            curr.count = -1;
        }
    } else if (counting && count > 0) {
        curr.count = count;
        curr.selected = true;
    } else if (!counting) {
        curr.selected = true;
    } else {
        return false;
    }
    if (in_view) set_item_state(window, lineno, curr);
    return true;
}

export function dmore(cw, s) {
    const prompt = cw.morestr || defmorestr;
    const offset = cw.type === NHW_TEXT ? 1 : 2;
    tty_curs(BASE_WINDOW, (ttyDisplay?.curx || 0) + offset, ttyDisplay?.cury || 0);
    standoutbeg();
    xputs(prompt);
    standoutend();
    xwaitforspace(s);
}

export function set_item_state(window, lineno, item) {
    const ch = item.selected ? (item.count === -1 ? '+' : '#') : '-';
    tty_curs(window, 4, lineno);
    putchar(ch);
}

export function set_all_on_page(window, page_start, page_end) {
    let n = 0;
    for (let curr = page_start; curr && curr !== page_end; curr = curr.next, n++) {
        if (!curr.identifier?.a_void || curr.selected
            || !menuitem_invert_test(1, curr.itemflags, false)) continue;
        curr.selected = true;
        set_item_state(window, n, curr);
    }
}

export function unset_all_on_page(window, page_start, page_end) {
    let n = 0;
    for (let curr = page_start; curr && curr !== page_end; curr = curr.next, n++) {
        if (!curr.identifier?.a_void || !curr.selected
            || !menuitem_invert_test(2, curr.itemflags, true)) continue;
        curr.selected = false;
        curr.count = -1;
        set_item_state(window, n, curr);
    }
}

export function invert_all_on_page(window, page_start, page_end, acc, count) {
    let n = 0;
    for (let curr = page_start; curr && curr !== page_end; curr = curr.next, n++) {
        if (!curr.identifier?.a_void
            || (acc ? curr.gselector !== acc
                : !menuitem_invert_test(0, curr.itemflags, curr.selected))) continue;
        curr.selected = !curr.selected;
        curr.count = curr.selected && count > 0 ? count : -1;
        set_item_state(window, n, curr);
    }
}

export function invert_all(window, page_start, page_end, acc, count) {
    invert_all_on_page(window, page_start, page_end, acc, count);
    const cw = wins[window];
    let on_curr_page = false;
    for (let curr = cw.mlist; curr; curr = curr.next) {
        if (curr === page_start) on_curr_page = true;
        else if (curr === page_end) on_curr_page = false;
        if (on_curr_page || !curr.identifier?.a_void
            || (acc ? curr.gselector !== acc
                : !menuitem_invert_test(0, curr.itemflags, curr.selected))) continue;
        curr.selected = !curr.selected;
        curr.count = curr.selected && count > 0 ? count : -1;
    }
}

export function toggle_menu_attr(on, color, attr) {
    if (on) {
        term_start_attr(attr);
        if (color !== NO_COLOR) term_start_color(color);
    } else {
        if (color !== NO_COLOR) term_end_color();
        term_end_attr(attr);
    }
}

export function process_menu_window(window, cw) {
    const items = menuArray(cw.mlist);
    const pageLines = min(items.length, max(0, (ttyDisplay?.rows || displayRows()) - 1));
    for (let i = 0; i < pageLines; i++) {
        const item = items[i];
        tty_curs(window, 1, i);
        cl_end();
        const line = item.str || '';
        if (item.color !== NO_COLOR || item.attr !== ATR_NONE) toggle_menu_attr(true, item.color, item.attr);
        xputs(' ' + line);
        if (item.color !== NO_COLOR || item.attr !== ATR_NONE) toggle_menu_attr(false, item.color, item.attr);
    }
    cw.morestr = cw.morestr || (cw.npages > 1 ? '(1 of ' + cw.npages + ')' : '(end) ');
    tty_curs(window, 1, pageLines);
    cl_end();
    dmore(cw, ' \n\r' + ESC);
    if (cw.how === PICK_ONE) {
        const chosen = items.find(it => it.identifier?.a_void);
        if (chosen) chosen.selected = true;
    }
}

export function process_text_window(window, cw) {
    const rows = cw.data || [];
    let n = 0;
    for (let i = 0; i < rows.length && i < cw.maxrow; i++) {
        tty_curs(window, 1, n++);
        cl_end();
        const row = rows[i];
        if (!row) continue;
        const attr = Math.max(0, row.charCodeAt(0) - 1);
        term_start_attr(attr);
        xputs(row.slice(1));
        term_end_attr(attr);
        if (n + cw.offy >= (ttyDisplay?.rows || displayRows()) - 1) {
            dmore(cw, ' \n\r' + ESC);
            if (code(morc) === 27) { cw.flags |= WIN_CANCELLED; break; }
            n = 0;
            if (cw.offy) cl_eos();
            else term_clear_screen();
        }
    }
    if (!(cw.flags & WIN_CANCELLED)) dmore(cw, ' \n\r' + ESC);
}

export function tty_display_nhwindow(window, blocking) {
    const cw = wins[window];
    if (window === WIN_ERR || !cw) ttywindowpanic(window);
    if (cw.flags & WIN_CANCELLED) return;
    if (ttyDisplay) {
        ttyDisplay.lastwin = window;
        ttyDisplay.rawprint = 0;
    }
    print_vt_code(2, window);
    switch (cw.type) {
    case NHW_MESSAGE:
        if (ttyDisplay?.toplin === TOPLINE_NEED_MORE) {
            more();
            tty_clear_nhwindow(window);
        } else if (ttyDisplay) ttyDisplay.toplin = TOPLINE_EMPTY;
        cw.curx = cw.cury = 0;
        game.iflags = game.iflags || {};
        game.iflags.window_inited = true;
        break;
    case NHW_MAP:
        end_glyphout();
        if (blocking && game.WIN_MESSAGE !== WIN_ERR) {
            if (ttyDisplay?.toplin !== TOPLINE_EMPTY) ttyDisplay.toplin = TOPLINE_NEED_MORE;
            tty_display_nhwindow(game.WIN_MESSAGE, true);
            return;
        }
        flush_screen(1);
        break;
    case NHW_BASE:
        flush_screen(1);
        break;
    case NHW_TEXT:
        cw.maxcol = ttyDisplay?.cols || displayCols();
        cw.active = true;
        process_text_window(window, cw);
        break;
    case NHW_MENU:
        cw.active = true;
        if (cw.data || !cw.maxrow) process_text_window(window, cw);
        else process_menu_window(window, cw);
        break;
    default:
        break;
    }
    cw.active = true;
    void blocking;
}

export function tty_dismiss_nhwindow(window) {
    const cw = wins[window];
    if (window === WIN_ERR || !cw) ttywindowpanic(window);
    print_vt_code(2, window);
    if (cw.type === NHW_MESSAGE && ttyDisplay?.toplin !== TOPLINE_EMPTY)
        tty_display_nhwindow(window, true);
    if (cw.type === NHW_MENU || cw.type === NHW_TEXT || cw.type === NHW_PERMINVENT) {
        if (cw.active && game.iflags?.window_inited && !erasing_tty_screen)
            erase_menu_or_text(window, cw, false);
    }
    cw.active = false;
    cw.flags = 0;
}

export function tty_destroy_nhwindow(window) {
    const cw = wins[window];
    if (window === WIN_ERR || !cw) {
        if (window === game.WIN_INVEN) return;
        ttywindowpanic(window);
    }
    if (cw.active) tty_dismiss_nhwindow(window);
    if (cw.type === NHW_MESSAGE && game.iflags) game.iflags.window_inited = 0;
    if (cw.type === NHW_MAP) term_clear_screen();
    free_window_info(cw, true);
    wins[window] = null;
}

export function erase_tty_screen() {
    if (erasing_tty_screen++) return;
    for (let i = 0; i < MAXWIN; i++) if (wins[i]?.active) tty_clear_nhwindow(i);
    if (BASE_WINDOW !== WIN_ERR && wins[BASE_WINDOW]) tty_curs(BASE_WINDOW, 1, 0);
    erasing_tty_screen = 0;
}

export function tty_curs(window, x, y) {
    const cw = wins[window];
    if (window === WIN_ERR || !cw) ttywindowpanic(window);
    if (ttyDisplay) ttyDisplay.lastwin = window;
    print_vt_code(2, window);
    cw.curx = x - 1;
    cw.cury = y;
    let sx = x - 1 + (cw.offx || 0);
    let sy = y + (cw.offy || 0);
    if (clipping && window === game.WIN_MAP) {
        sx -= clipx;
        sy -= clipy;
    }
    if (cw.type === NHW_MAP) end_glyphout();
    cmov(sx, sy);
    if (ttyDisplay) {
        ttyDisplay.curx = sx;
        ttyDisplay.cury = sy;
    }
}

export function tty_putsym(window, x, y, ch) {
    const cw = wins[window];
    if (window === WIN_ERR || !cw) ttywindowpanic(window);
    tty_curs(window, x, y);
    putchar(ch);
    cw.curx++;
}

export function compress_str(str) {
    let s = String(str || '');
    if (s.length >= displayCols() || s.includes('\n')) {
        s = s.replace(/\n/g, ' ').replace(/ +/g, ' ').trim();
    }
    return s;
}

export function tty_putstr(window, attr, str) {
    let cw = wins[window];
    if (window === WIN_ERR || !cw) {
        tty_raw_print(str);
        return;
    }
    if (str == null || ((cw.flags & WIN_CANCELLED) && cw.type !== NHW_MESSAGE)) return;
    let s = String(str);
    if (cw.type !== NHW_MESSAGE && window !== game.WIN_INVEN) s = compress_str(s);
    if (ttyDisplay) ttyDisplay.lastwin = window;
    print_vt_code(2, window);
    switch (cw.type) {
    case NHW_MESSAGE:
        if (attr & ATR_URGENT) {
            if (cw.flags & WIN_STOP) {
                tty_clear_nhwindow(window);
                cw.flags &= ~WIN_STOP;
            }
            cw.flags |= WIN_NOSTOP;
        }
        show_topl(s);
        cw.flags &= ~WIN_NOSTOP;
        break;
    case NHW_STATUS:
        if (!Array.isArray(cw.data)) cw.data = Array(cw.maxrow).fill('');
        cw.data[cw.cury] = s.padEnd(max(0, cw.cols - 1), ' ').slice(0, max(0, cw.cols - 1)) + '\0';
        tty_curs(window, 1, cw.cury);
        xputs(s.slice(0, cw.cols - 1));
        cw.cury = (cw.cury + 1) % max(1, cw.maxrow);
        cw.curx = 0;
        break;
    case NHW_MAP:
    case NHW_BASE:
        tty_curs(window, cw.curx + 1, cw.cury);
        term_start_attr(attr);
        xputs(s);
        term_end_attr(attr);
        cw.curx = 0;
        cw.cury++;
        break;
    case NHW_MENU:
    case NHW_TEXT:
        if (!Array.isArray(cw.data)) cw.data = [];
        cw.data[cw.cury] = String.fromCharCode((attr || 0) + 1) + s;
        cw.maxcol = max(cw.maxcol, s.length + 1);
        cw.cury++;
        cw.maxrow = max(cw.maxrow, cw.cury);
        cw.rows = max(cw.rows, cw.cury);
        break;
    default:
        break;
    }
}

export function tty_display_file(fname, complain) {
    if (complain) pline('Cannot open "' + fname + '".');
}

export function tty_start_menu(window, mbehavior) {
    const cw = wins[window];
    if (window === WIN_ERR || !cw) ttywindowpanic(window);
    if (mbehavior === MENU_BEHAVE_PERMINV) {
        cw.mbehavior = mbehavior;
        return;
    }
    tty_clear_nhwindow(window);
}

export function tty_add_menu(window, glyphinfo, identifier, ch, gch, attr, clr, str, itemflags) {
    const cw = wins[window];
    if (str == null) return;
    if (window === WIN_ERR || !cw || cw.type !== NHW_MENU) ttywindowpanic(window);
    if (cw.mbehavior === MENU_BEHAVE_PERMINV) {
        ttyinv_add_menu(window, cw, ch, attr, clr, str);
        return;
    }
    cw.nitems++;
    const selectable = !!identifier?.a_void;
    const line = selectable ? `${ch || '?'} - ${String(str).slice(0, BUFSZ - 1)}` : String(str);
    const item = {
        identifier: { ...(identifier || {}) },
        count: -1,
        selected: !!(itemflags & MENU_ITEMFLAGS_SELECTED),
        itemflags,
        selector: ch || '',
        gselector: gch || '',
        attr: attr || ATR_NONE,
        color: clr ?? NO_COLOR,
        str: line,
        glyphinfo: glyphinfo ? { ...glyphinfo } : { glyph: NO_GLYPH },
        next: cw.mlist,
    };
    cw.mlist = item;
}

export function reverse(curr) {
    let head = null;
    while (curr) {
        const next = curr.next;
        curr.next = head;
        head = curr;
        curr = next;
    }
    return head;
}

export function tty_end_menu(window, prompt) {
    const cw = wins[window];
    if (window === WIN_ERR || !cw || cw.type !== NHW_MENU) {
        if (window === game.WIN_INVEN && !cw) return;
        ttywindowpanic(window);
    }
    if (cw.mbehavior === MENU_BEHAVE_PERMINV && window === game.WIN_INVEN) {
        ttyinv_end_menu(window, cw);
        return;
    }
    cw.mlist = reverse(cw.mlist);
    if (prompt) {
        const arr = menuArray(cw.mlist);
        arr.unshift({ identifier: {}, count: -1, selected: false, itemflags: 0, selector: '',
            gselector: '', attr: ATR_NONE, color: NO_COLOR, str: '', glyphinfo: {}, next: null });
        arr.unshift({ identifier: {}, count: -1, selected: false, itemflags: 0, selector: '',
            gselector: '', attr: tty_menu_promptstyle.attr, color: tty_menu_promptstyle.color,
            str: prompt, glyphinfo: {}, next: null });
        setMenuArray(cw, arr);
        cw.nitems += 2;
    }
    const lmax = min(52, (ttyDisplay?.rows || displayRows()) - 1);
    cw.npages = Math.ceil(cw.nitems / max(1, lmax));
    cw.plist = [];
    let menu_ch = 'a'.charCodeAt(0);
    let n = 0, maxcols = 0;
    for (let curr = cw.mlist; curr; curr = curr.next, n++) {
        if ((n % lmax) === 0) {
            menu_ch = 'a'.charCodeAt(0);
            cw.plist[Math.floor(n / lmax)] = curr;
        }
        if (curr.identifier?.a_void && !curr.selector) {
            curr.selector = String.fromCharCode(menu_ch);
            curr.str = curr.selector + curr.str.slice(1);
            menu_ch = menu_ch === 'z'.charCodeAt(0) ? 'A'.charCodeAt(0) : menu_ch + 1;
        }
        if (curr.str.length + 2 > (ttyDisplay?.cols || displayCols()))
            curr.str = curr.str.slice(0, (ttyDisplay?.cols || displayCols()) - 2);
        maxcols = max(maxcols, curr.str.length + 2);
    }
    cw.plist[cw.npages] = null;
    cw.morestr = cw.npages > 1 ? '' : '(end) ';
    cw.cols = cw.maxcol = max(maxcols, cw.morestr.length);
    cw.maxrow = cw.rows = cw.npages > 1 ? lmax + 1 : cw.nitems + 1;
}

export function tty_select_menu(window, how, menu_list) {
    const cw = wins[window];
    if (window === WIN_ERR || !cw || cw.type !== NHW_MENU) ttywindowpanic(window);
    if (cw.mbehavior === MENU_BEHAVE_PERMINV) return 0;
    cw.how = how;
    morc = 0;
    tty_display_nhwindow(window, true);
    const cancelled = !!(cw.flags & WIN_CANCELLED);
    tty_dismiss_nhwindow(window);
    if (cancelled) return -1;
    const selected = menuArray(cw.mlist).filter(it => it.selected);
    if (Array.isArray(menu_list)) {
        menu_list.length = 0;
        for (const curr of selected) menu_list.push({ item: curr.identifier, count: curr.count });
    }
    return selected.length;
}

export function tty_message_menu(let_, how, mesg) {
    if (how === PICK_NONE) {
        pline(String(mesg || ''));
        return 0;
    }
    if (ttyDisplay) ttyDisplay.dismiss_more = let_;
    morc = 0;
    tty_putstr(game.WIN_MESSAGE, 0, mesg);
    if (ttyDisplay?.toplin === TOPLINE_NEED_MORE) {
        more();
        ttyDisplay.toplin = TOPLINE_NEED_MORE;
        tty_clear_nhwindow(game.WIN_MESSAGE);
    }
    if (wins[game.WIN_MESSAGE]) wins[game.WIN_MESSAGE].flags &= ~WIN_CANCELLED;
    if (ttyDisplay) ttyDisplay.dismiss_more = 0;
    return ((how === PICK_ONE && morc === code(let_)) || morc === 27) ? morc : 0;
}

export function tty_ctrl_nhwindow(_window, request, wri) {
    if (!wri) return null;
    if (request === 'set_menu_promptstyle' || request === 2)
        tty_menu_promptstyle = wri.fromcore?.menu_promptstyle || tty_menu_promptstyle;
    return wri;
}

export function ttyinv_create_window(newid, newwin) {
    newwin.cells = [];
    newwin.active = true;
    return newid;
}

export function ttyinv_remove_data(cw, destroy) {
    if (!cw) return impossible('Removing ttyinv data for nonexistent perm invent window?');
    cw.cells = destroy ? null : [];
}

export function ttyinv_add_menu(_window, cw, ch, _attr, clr, str) {
    const row = selector_to_slot(ch, 0, [false]) + 1;
    ttyinv_populate_slot(cw, row, 0, `${ch} - ${str}`, clr, 4);
}

export function selector_to_slot(ch, invflags, ignoreRef) {
    const show_gold = !!(invflags & 1);
    if (Array.isArray(ignoreRef)) ignoreRef[0] = false;
    if (!ch) { if (Array.isArray(ignoreRef)) ignoreRef[0] = true; return 0; }
    if (ch === '$') return show_gold ? 0 : (ignoreRef[0] = true, 0);
    if (ch === '#') return show_gold ? 53 : (ignoreRef[0] = true, 0);
    if (ch >= 'a' && ch <= 'z') return ch.charCodeAt(0) - 'a'.charCodeAt(0) + (show_gold ? 1 : 0);
    if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 'A'.charCodeAt(0) + 26 + (show_gold ? 1 : 0);
    return 0;
}

export function slot_to_invlet(slot, incl_gold) {
    if (slot === 0) return incl_gold ? '$' : 'a';
    if (slot === 53) return '#';
    const s = incl_gold ? slot - 1 : slot;
    return s < 26 ? String.fromCharCode('a'.charCodeAt(0) + s)
        : String.fromCharCode('A'.charCodeAt(0) + s - 26);
}

export function ttyinv_inuse_fulllines(_cw, _rows_per_side) {}
export function ttyinv_inuse_twosides(_cw, _rows_per_side) {}
export function ttyinv_end_menu(window, cw) { ttyinv_render(window, cw); }

export function ttyinv_render(window, cw) {
    if (!cw?.cells) return;
    for (let row = 0; row < cw.cells.length; row++) {
        for (let col = 0; col < (cw.cells[row] || []).length; col++) {
            const cell = cw.cells[row][col];
            if (!cell?.refresh) continue;
            tty_curs(window, col + 1, row);
            putchar(cell.content?.ttychar || ' ');
            cell.refresh = 0;
        }
    }
}

export function ttyinv_populate_slot(cw, row, side, text, color, clroffset) {
    if (!cw.cells) cw.cells = [];
    if (!cw.cells[row]) cw.cells[row] = [];
    const start = side ? Math.floor((cw.maxcol || 80) / 2) : 1;
    const end = side ? (cw.maxcol || 80) - 2 : Math.floor((cw.maxcol || 80) / 2) - 1;
    let idx = 0;
    for (let col = start; col <= end; col++, idx++) {
        cw.cells[row][col] = {
            glyph: 0, text: 1, refresh: 1, color: (idx >= clroffset ? color : NO_COLOR) + 1,
            content: { ttychar: text[idx] || ' ' },
        };
    }
}

export function tty_refresh_inventory(start, stop, y) {
    const cw = wins[game.WIN_INVEN];
    if (!cw?.cells) return;
    for (let col = start - 1; col < min(stop, cw.maxcol); ++col) {
        const cell = cw.cells[y]?.[col];
        if (!cell) continue;
        tty_curs(game.WIN_INVEN, col + 1, y);
        putchar(cell.content?.ttychar || ' ');
        cell.refresh = 0;
    }
}

export function tty_invent_box_glyph_init(_cw) {}

export function assesstty(_invmode, offx, offy, rows, cols, maxcol, minrow, maxrow) {
    if (Array.isArray(offx)) offx[0] = 0;
    if (Array.isArray(offy)) offy[0] = 1 + ROWNO + StatusRows();
    if (Array.isArray(rows)) rows[0] = max(0, displayRows() - (offy?.[0] || 0));
    if (Array.isArray(cols)) cols[0] = displayCols();
    if (Array.isArray(maxcol)) maxcol[0] = displayCols();
    if (Array.isArray(minrow)) minrow[0] = 10;
    if (Array.isArray(maxrow)) maxrow[0] = min(rows?.[0] || 0, minrow?.[0] || 10);
    return displayRows() >= 1 + ROWNO + StatusRows() + 10 && displayCols() >= 79;
}

export function tty_update_inventory(_arg) { sync_perminvent(); }

export function tty_mark_synch() { flush_screen(1); }

export function tty_wait_synch() {
    if (game.WIN_MAP === WIN_ERR || !ttyDisplay || ttyDisplay.rawprint) {
        getret();
        if (ttyDisplay) ttyDisplay.rawprint = 0;
    } else {
        tty_display_nhwindow(game.WIN_MAP, false);
    }
}

export function docorner(xmin, ymax, ystart_between_menu_pages) {
    const ystart = ystart_between_menu_pages || 0;
    for (let y = ystart; y < ymax; y++) {
        tty_curs(BASE_WINDOW, xmin, y);
        if (!ystart_between_menu_pages) cl_end();
        row_refresh(xmin, COLNO - 1, y - 1);
    }
    end_glyphout();
    if (game.WIN_STATUS !== WIN_ERR && ymax >= (wins[game.WIN_STATUS]?.offy || 0)
        && !ystart_between_menu_pages) {
        game.disp = game.disp || {};
        game.disp.botlx = true;
        bot();
    }
}

export function end_glyphout() {
    if (ttyDisplay?.color !== NO_COLOR) {
        term_end_color();
        ttyDisplay.color = NO_COLOR;
    }
}

export function g_putch(in_ch) { putchar(chr(in_ch)); }

export function g_pututf8(utf8str) { xputs(String(utf8str || '')); }

export function setclipped() {
    clipping = true;
    clipx = clipy = 0;
    clipxmax = displayCols();
    clipymax = displayRows() - 1 - StatusRows();
}

export function tty_cliparound(x, y) {
    const oldx = clipx, oldy = clipy;
    if (!clipping) return;
    if (x < clipx + 5) {
        clipx = max(0, x - 20);
        clipxmax = clipx + displayCols();
    } else if (x > clipxmax - 5) {
        clipxmax = min(COLNO, clipxmax + 20);
        clipx = clipxmax - displayCols();
    }
    if (y < clipy + 2) {
        clipy = max(0, y - Math.trunc((clipymax - clipy) / 2));
        clipymax = clipy + (displayRows() - 1 - StatusRows());
    } else if (y > clipymax - 2) {
        clipymax = min(ROWNO, clipymax + Math.trunc((clipymax - clipy) / 2));
        clipy = clipymax - (displayRows() - 1 - StatusRows());
    }
    if (clipx !== oldx || clipy !== oldy) redraw_map(true);
}

export function tty_print_glyph(window, x, y, glyphinfo, bkglyphinfo) {
    if (clipping && (x <= clipx || y < clipy || x >= clipxmax || y >= clipymax)) return;
    const gi = glyphinfo || {};
    const ch = gi.ttychar || gi.ch || ' ';
    const color = gi.gm?.sym?.color ?? gi.color ?? NO_COLOR;
    const special = gi.gm?.glyphflags ?? 0;
    print_vt_code(2, window);
    tty_curs(window, x, y);
    print_vt_code(0, gi.gm?.tileidx ?? -1, special);
    if (game.iflags?.use_color && color !== NO_COLOR) {
        term_start_color(color);
        if (ttyDisplay) ttyDisplay.color = color;
    }
    if (bkglyphinfo?.framecolor !== undefined && bkglyphinfo.framecolor !== NO_COLOR)
        term_start_bgcolor(bkglyphinfo.framecolor);
    g_putch(ch);
    if (game.iflags?.use_color && ttyDisplay?.color !== NO_COLOR) {
        term_end_color();
        ttyDisplay.color = ttyDisplay.framecolor = NO_COLOR;
    }
    print_vt_code(1);
    if (wins[window]) wins[window].curx++;
    if (ttyDisplay) ttyDisplay.curx++;
    if (window === game.WIN_MAP || wins[window]?.type === NHW_MAP)
        show_glyph_cell(x, y, ch, color, false, ATR_NONE);
}

export function term_start_bgcolor(color) { term_start_bgcolor_impl(color); }
export function term_curs_set(visibility) { term_curs_set_impl(visibility); }
export function tty_change_color(_color, _rgb, _reverse) {}

export function tty_raw_print(str) {
    if (ttyDisplay) ttyDisplay.rawprint++;
    else {
        game.iflags = game.iflags || {};
        if (str) game.iflags.raw_printed = (game.iflags.raw_printed || 0) + 1;
    }
    print_vt_code(2, NHW_BASE);
    puts(str || '');
}

export function tty_raw_print_bold(str) {
    if (ttyDisplay) ttyDisplay.rawprint++;
    else {
        game.iflags = game.iflags || {};
        if (str) game.iflags.raw_printed = (game.iflags.raw_printed || 0) + 1;
    }
    print_vt_code(2, NHW_BASE);
    term_start_raw_bold();
    xputs(str || '');
    term_end_raw_bold();
    puts('');
}

export async function tty_nhgetch() {
    print_vt_code(3);
    term_curs_set(1);
    if (game.WIN_MESSAGE !== WIN_ERR && wins[game.WIN_MESSAGE])
        wins[game.WIN_MESSAGE].flags &= ~WIN_STOP;
    game.program_state = game.program_state || {};
    game.program_state.getting_char = (game.program_state.getting_char || 0) + 1;
    let i;
    if (game.iflags?.debug_fuzzer) i = randomkey();
    else i = await nhgetch();
    game.program_state.getting_char--;
    term_curs_set(0);
    if (!i || i < 0) {
        game.iflags = game.iflags || {};
        if (i < 0) game.iflags.term_gone = 1;
        i = 27;
    }
    if (ttyDisplay?.toplin === TOPLINE_NEED_MORE) ttyDisplay.toplin = TOPLINE_NON_EMPTY;
    return i;
}

export async function tty_nh_poskey(_x, _y, _mod) { return tty_nhgetch(); }

export function win_tty_init(dir) { if (dir !== 'WININIT' && dir !== 1) return; }

export function tty_update_positionbar(_posbar) {}

export function tty_putmixed(window, attr, str) {
    const cw = wins[window];
    if (window === WIN_ERR || !cw) {
        tty_raw_print(str);
        return;
    }
    if (ttyDisplay) ttyDisplay.mixed = 1;
    const buf = decode_mixed([], str);
    if (cw.type === NHW_MESSAGE && ttyDisplay) ttyDisplay.topl_utf8 = 0;
    tty_putstr(window, attr, buf);
    if (ttyDisplay) {
        ttyDisplay.topl_utf8 = 0;
        ttyDisplay.mixed = 0;
    }
}

export function tty_status_init() {
    const num_rows = StatusRows();
    fieldorder = num_rows !== 3 ? twolineorder : threelineorder;
    for (let i = 0; i < MAXBLSTATS; ++i) {
        tty_status[NOW][i] = emptyStatusField();
        tty_status[BEFORE][i] = emptyStatusField();
    }
    tty_condition_bits = 0;
    hpbar_percent = hpbar_crit_hp = 0;
    genl_status_init();
    if (game.WIN_STATUS === WIN_ERR || game.WIN_STATUS == null)
        game.WIN_STATUS = tty_create_nhwindow(NHW_STATUS);
}

export function tty_status_enablefield(fieldidx, nm, fmt, enable) {
    status_activefields[fieldidx] = !!enable;
    status_fieldfmt[fieldidx] = fmt || '%s';
    genl_status_enablefield(fieldidx, nm, fmt, enable);
}

export function tty_status_update(fldidx, ptr, _chg, percent, color, colormasks) {
    if (fldidx < BL_RESET || fldidx >= MAXBLSTATS) return;
    if (fldidx >= 0 && !status_activefields[fldidx]) return;
    if (fldidx === BL_RESET || fldidx === BL_FLUSH) {
        if (make_things_fit(fldidx === BL_RESET) || truncation_expected) {
            render_status();
            status_sanity_external();
        }
        return;
    }
    if (fldidx === BL_CONDITION) {
        tty_status[NOW][fldidx].idx = fldidx;
        tty_condition_bits = Number(ptr || 0);
        tty_colormasks = colormasks;
        tty_status[NOW][fldidx].valid = true;
        tty_status[NOW][fldidx].dirty = true;
        tty_status[NOW][fldidx].sanitycheck = true;
        truncation_expected = false;
        set_condition_length();
        return;
    }
    let text = String(ptr ?? '');
    if (fldidx === BL_GOLD) text = decode_mixed([], text);
    const fmt = status_fieldfmt[fldidx] || '%s';
    status_vals[fldidx] = fmt.replace('%s', text).replace('%d', text);
    tty_status[NOW][fldidx].idx = fldidx;
    tty_status[NOW][fldidx].color = color & 0xff;
    tty_status[NOW][fldidx].attr = term_attr_fixup((color >> 8) & 0xff);
    tty_status[NOW][fldidx].lth = status_vals[fldidx].length;
    tty_status[NOW][fldidx].valid = true;
    tty_status[NOW][fldidx].dirty = true;
    tty_status[NOW][fldidx].sanitycheck = true;
    if (status_vals[fldidx] === ' ') {
        status_vals[fldidx] = '';
        tty_status[NOW][fldidx].lth = 0;
    }
    if (fldidx === BL_HP) {
        hpbar_percent = percent || 0;
        hpbar_crit_hp = critically_low_hp(true) ? 1 : 0;
    } else if (fldidx === BL_LEVELDESC) dlvl_shrinklvl = 0;
    else if (fldidx === BL_CAP) {
        enc_shrinklvl = 0;
        enclev = stat_cap_indx();
    }
}

export function make_things_fit(force_update) {
    const rowsz = Array(MAX_STATUS_ROWS).fill(0);
    cond_shrinklvl = 0;
    if (!check_fields(force_update, rowsz)) return 0;
    const condrow = StatusRows() - 1;
    const requirement = rowsz[condrow] - 1;
    if (requirement <= (wins[game.WIN_STATUS]?.cols || displayCols()) - 1)
        return requirement;
    if (cond_shrinklvl < 2) {
        cond_shrinklvl++;
        set_condition_length();
    } else {
        truncation_expected = true;
    }
    return 0;
}

export function check_fields(forcefields, sz) {
    if (!windowdata_init && !check_windowdata()) return false;
    let valid = true;
    const num_rows = StatusRows();
    for (let row = 0; row < num_rows; ++row) {
        let col = 1;
        for (let i = 0; fieldorder[row][i] !== BL_FLUSH; ++i) {
            const idx = fieldorder[row][i];
            if (!status_activefields[idx]) continue;
            if (!tty_status[NOW][idx].valid) valid = false;
            tty_status[NOW][idx].y = row;
            tty_status[NOW][idx].x = col;
            tty_status[NOW][idx].redraw = forcefields || tty_status[NOW][idx].dirty
                || tty_status[NOW][idx].lth !== tty_status[BEFORE][idx].lth
                || tty_status[NOW][idx].x !== tty_status[BEFORE][idx].x;
            col += tty_status[NOW][idx].lth;
        }
        sz[row] = col;
    }
    return valid;
}

export function status_sanity_check() {
    for (let i = 0; i < MAXBLSTATS; ++i)
        tty_status[NOW][i].sanitycheck = false;
}

export function tty_putstatusfield(text, x, y) {
    const cw = wins[game.WIN_STATUS];
    if (!cw) panic('tty_putstatusfield: Invalid WinDesc');
    print_vt_code(2, NHW_STATUS);
    if (x < cw.cols && y < cw.maxrow) {
        tty_curs(game.WIN_STATUS, x, y);
        const s = String(text || '').slice(0, max(0, cw.cols - x));
        xputs(s);
        const base = (cw.data[y] || '').replace(/\0.*$/, '').padEnd(cw.cols - 1, ' ');
        cw.data[y] = base.slice(0, x - 1) + s + base.slice(x - 1 + s.length);
        cw.data[y] = cw.data[y].slice(0, cw.cols - 1) + '\0';
    }
}

export function set_condition_length() {
    let lth = 0;
    if (tty_condition_bits) {
        for (const cond of conditions) {
            if (cond && (tty_condition_bits & cond.mask) === cond.mask)
                lth += 1 + String(cond.text?.[cond_shrinklvl] || '').length;
        }
    }
    if (tty_status[NOW][BL_CONDITION])
        tty_status[NOW][BL_CONDITION].lth = lth;
}

export function shrink_enc(lvl) {
    if (lvl <= 2) {
        enc_shrinklvl = lvl;
        status_vals[BL_CAP] = ' ' + (encvals[lvl]?.[enclev] || '');
    }
    tty_status[NOW][BL_CAP].lth = status_vals[BL_CAP].length;
}

export function shrink_dlvl(lvl) {
    const p = status_vals[BL_LEVELDESC].indexOf(':');
    if (p >= 0) {
        dlvl_shrinklvl = lvl;
        status_vals[BL_LEVELDESC] = (lvl === 0 ? 'Dlvl' : 'Dl') + status_vals[BL_LEVELDESC].slice(p);
        tty_status[NOW][BL_LEVELDESC].lth = status_vals[BL_LEVELDESC].length;
    }
}

export function check_windowdata() {
    if (game.WIN_STATUS === WIN_ERR || !wins[game.WIN_STATUS]) {
        game.WIN_STATUS = tty_create_nhwindow(NHW_STATUS);
    }
    if (!windowdata_init) {
        tty_clear_nhwindow(game.WIN_STATUS);
        windowdata_init = true;
    }
    return true;
}

export function condcolor(bm, bmarray) {
    if (bm && bmarray) {
        for (let i = 0; i < bmarray.length; ++i)
            if ((bm & bmarray[i]) !== 0) return i;
    }
    return NO_COLOR;
}

export function condattr(bm, bmarray) {
    let attr = 0;
    if (bm && bmarray) {
        for (let i = 0; i < bmarray.length; ++i)
            if ((bm & bmarray[i]) !== 0) attr |= 1 << i;
    }
    return attr;
}

export function render_status() {
    const cw = wins[game.WIN_STATUS];
    if (!cw) return;
    const num_rows = StatusRows();
    for (let row = 0; row < num_rows; ++row) {
        let x = 1;
        tty_curs(game.WIN_STATUS, 1, row);
        for (let i = 0; fieldorder[row][i] !== BL_FLUSH; ++i) {
            const idx = fieldorder[row][i];
            if (!status_activefields[idx]) continue;
            const text = idx === BL_CONDITION ? '' : (status_vals[idx] || '');
            if (tty_status[NOW][idx].redraw || !do_field_opt) {
                if (idx === BL_CONDITION) {
                    let bits = tty_condition_bits;
                    for (let c = 0; c < conditions.length && bits; ++c) {
                        const ci = cond_idx[c];
                        const cond = conditions[ci];
                        if (!cond) continue;
                        const mask = cond.mask;
                        if (bits & mask) {
                            tty_putstatusfield(' ', x++, row);
                            const condtext = cond.text?.[cond_shrinklvl] || '';
                            tty_putstatusfield(condtext, x, row);
                            x += condtext.length;
                            bits &= ~mask;
                        }
                    }
                } else {
                    tty_putstatusfield(text, x, row);
                    x += text.length;
                }
            } else {
                x += tty_status[NOW][idx].lth;
            }
            finalx[row][NOW] = x - 1;
            tty_status[NOW][idx].dirty = false;
            tty_status[NOW][idx].redraw = false;
            tty_status[NOW][idx].sanitycheck = false;
            tty_status[BEFORE][idx] = { ...tty_status[NOW][idx] };
        }
        if ((finalx[row][NOW] < finalx[row][BEFORE] || !finalx[row][BEFORE])
            && finalx[row][NOW] + 1 < cw.cols) {
            tty_curs(game.WIN_STATUS, finalx[row][NOW] + 1, row);
            cl_end();
        }
        finalx[row][BEFORE] = finalx[row][NOW];
    }
}

export function play_usersound_via_idx(idx, volume) {
    print_vt_soundcode_idx(idx, volume);
}

export default tty_procs;
