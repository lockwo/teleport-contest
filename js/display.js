// display.js — Map rendering and terminal output.
// C ref: display.c — newsym, show_glyph, docrt, cls, flush_screen.

import { game } from './gstate.js';
import { cansee } from './vision.js';
import {
    COLNO, ROWNO, STONE, ROOM, CORR, DOOR, STAIRS,
    HWALL, VWALL, TLCORNER, TRCORNER, BLCORNER, BRCORNER,
    CROSSWALL, TUWALL, TDWALL, TLWALL, TRWALL,
    D_NODOOR, D_ISOPEN, D_CLOSED, D_LOCKED,
} from './const.js';
import { NO_COLOR, CLR_GRAY, CLR_BROWN, CLR_WHITE, CLR_YELLOW, DEC_TO_UNICODE } from './terminal.js';

// ── ANSI color codes ──
// Maps CLR_* constants (0-15) to ANSI SGR color codes.
// C ref: wintty.c term_start_color
const ANSI_DEFAULT = 39;
const ANSI_COLOR = [
    30,  // CLR_BLACK     0
    31,  // CLR_RED       1
    32,  // CLR_GREEN     2
    33,  // CLR_BROWN     3
    34,  // CLR_BLUE      4
    35,  // CLR_MAGENTA   5
    36,  // CLR_CYAN      6
    37,  // CLR_GRAY      7
    39,  // NO_COLOR      8 → default
    91,  // CLR_ORANGE    9
    92,  // CLR_BRIGHT_GREEN  10
    93,  // CLR_YELLOW    11
    94,  // CLR_BRIGHT_BLUE   12
    95,  // CLR_BRIGHT_MAGENTA 13
    96,  // CLR_BRIGHT_CYAN   14
    97,  // CLR_WHITE     15
];

// True when the active symset uses VT100 line-drawing (DECgraphics).  C ref:
// drawing.c symset[] / dat/symbols — without it the default ASCII glyphs
// (defsym.h PCHAR) are used for walls/floor/doorways.
function useDECgraphics() {
    return /^dec/i.test(String(game.symset || ''));
}

// ── Terrain to display character + color + DEC flag ──
function terrain_glyph(loc, x, y) {
    const typ = loc.typ;
    const dec = useDECgraphics();
    switch (typ) {
    case STONE:     return { ch: ' ', color: NO_COLOR, dec: false };
    // S_room: DEC middle dot ('~') vs default '.'.
    case ROOM:      return dec ? { ch: '~', color: NO_COLOR, dec: true }
                               : { ch: '.', color: NO_COLOR, dec: false };
    case CORR:      return { ch: '#', color: NO_COLOR, dec: false };
    case DOOR:
        if (loc.doormask & D_ISOPEN) return { ch: '|', color: CLR_BROWN, dec: false };
        if (loc.doormask & (D_CLOSED | D_LOCKED)) return { ch: '+', color: CLR_BROWN, dec: false };
        // D_NODOOR (doorway) = S_ndoor = '.'.
        return dec ? { ch: '~', color: NO_COLOR, dec: true }
                   : { ch: '.', color: NO_COLOR, dec: false };
    case STAIRS:
        // Check upstair vs downstair
        if (game.level?.upstair?.x === x && game.level?.upstair?.y === y)
            return { ch: '<', color: CLR_YELLOW, dec: false };
        return { ch: '>', color: CLR_YELLOW, dec: false };
    // Wall types — DEC line-drawing or default ASCII (defsym.h):
    //   vwall '|', hwall/corners/T-up/T-down/cross '-', T-left/T-right '|'.
    case HWALL:     return dec ? { ch: 'q', color: NO_COLOR, dec: true } : { ch: '-', color: NO_COLOR, dec: false };
    case VWALL:     return dec ? { ch: 'x', color: NO_COLOR, dec: true } : { ch: '|', color: NO_COLOR, dec: false };
    case TLCORNER:  return dec ? { ch: 'l', color: NO_COLOR, dec: true } : { ch: '-', color: NO_COLOR, dec: false };
    case TRCORNER:  return dec ? { ch: 'k', color: NO_COLOR, dec: true } : { ch: '-', color: NO_COLOR, dec: false };
    case BLCORNER:  return dec ? { ch: 'm', color: NO_COLOR, dec: true } : { ch: '-', color: NO_COLOR, dec: false };
    case BRCORNER:  return dec ? { ch: 'j', color: NO_COLOR, dec: true } : { ch: '-', color: NO_COLOR, dec: false };
    case CROSSWALL: return dec ? { ch: 'n', color: NO_COLOR, dec: true } : { ch: '-', color: NO_COLOR, dec: false };
    case TUWALL:    return dec ? { ch: 'v', color: NO_COLOR, dec: true } : { ch: '-', color: NO_COLOR, dec: false };
    case TDWALL:    return dec ? { ch: 'w', color: NO_COLOR, dec: true } : { ch: '-', color: NO_COLOR, dec: false };
    case TLWALL:    return dec ? { ch: 'u', color: NO_COLOR, dec: true } : { ch: '|', color: NO_COLOR, dec: false };
    case TRWALL:    return dec ? { ch: 't', color: NO_COLOR, dec: true } : { ch: '|', color: NO_COLOR, dec: false };
    default:        return { ch: '?', color: NO_COLOR, dec: false };
    }
}

// ── show_glyph_cell ──
export function show_glyph_cell(x, y, ch, color = NO_COLOR, decgfx = false, attr = 0) {
    const loc = game.level?.at(x, y);
    if (!loc) return;
    loc.disp_ch = ch;
    loc.disp_color = color;
    loc.disp_decgfx = !!decgfx;
    loc.disp_attr = attr | 0;
    loc.gnew = 1;
}

// ── newsym ──
export function newsym(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return;

    if (game.u?.ux === x && game.u?.uy === y) {
        // Hero
        show_glyph_cell(x, y, '@', CLR_WHITE, false);
        const tg = terrain_glyph(loc, x, y);
        loc.remembered_glyph = { ch: tg.ch, color: tg.color, decgfx: tg.dec };
        return;
    }

    // Contestants: add monster, object, and trap display here.

    const tg = terrain_glyph(loc, x, y);
    // Only update display/memory if cell is IN_SIGHT (lit and visible)
    if (cansee(x, y)) {
        show_glyph_cell(x, y, tg.ch, tg.color, tg.dec);
        if (game.level?.flags?.hero_memory) {
            loc.remembered_glyph = { ch: tg.ch, color: tg.color, decgfx: tg.dec };
        }
    } else if (loc.remembered_glyph) {
        // Out of sight but remembered — show remembered glyph
        show_glyph_cell(x, y, loc.remembered_glyph.ch,
            loc.remembered_glyph.color, loc.remembered_glyph.decgfx);
    }
}

// ── docrt ──
export async function docrt() {
    if (!game.level) return;
    for (let y = 0; y < ROWNO; y++)
        for (let x = 1; x < COLNO; x++) {
            const loc = game.level.at(x, y);
            if (loc?.remembered_glyph) {
                show_glyph_cell(x, y, loc.remembered_glyph.ch,
                    loc.remembered_glyph.color, loc.remembered_glyph.decgfx);
            }
        }
    if (game.u?.ux > 0) show_glyph_cell(game.u.ux, game.u.uy, '@', CLR_WHITE, false);
}

// ── Serialize a map row with DEC line-drawing and ANSI colors ──
function render_map_row(y) {
    if (!game.level) return '';
    let firstCol = -1, lastCol = -1;
    for (let x = 1; x < COLNO; x++) {
        const loc = game.level.at(x, y);
        if (loc?.disp_ch && loc.disp_ch !== ' ') {
            if (firstCol < 0) firstCol = x;
            lastCol = x;
        }
    }
    if (firstCol < 0) return '';

    let output = '';
    let activeColor = ANSI_DEFAULT;  // default
    let activeDec = false;

    // Leading gap
    const gap = firstCol - 1;
    if (gap > 4) output += `\x1b[${gap}C`;
    else if (gap > 0) output += ' '.repeat(gap);

    for (let x = firstCol; x <= lastCol; x++) {
        const loc = game.level.at(x, y);
        const ch = loc?.disp_ch ?? ' ';
        const color = loc?.disp_color ?? NO_COLOR;
        const dec = !!loc?.disp_decgfx;

        if (ch === ' ') {
            // Space runs
            let run = 1;
            while (x + run <= lastCol && (game.level.at(x + run, y)?.disp_ch ?? ' ') === ' ') run++;
            if (activeDec) { output += '\x0f'; activeDec = false; }
            if (run > 4) output += `\x1b[${run}C`;
            else output += ' '.repeat(run);
            x += run - 1;
            continue;
        }

        let wantAnsi = ANSI_COLOR[color] ?? ANSI_DEFAULT;
        if (wantAnsi !== activeColor) {
            output += `\x1b[${wantAnsi}m`;
            activeColor = wantAnsi;
        }

        // DEC mode switching
        if (dec && !activeDec) { output += '\x0e'; activeDec = true; }
        else if (!dec && activeDec) { output += '\x0f'; activeDec = false; }

        output += ch;
    }

    // Reset state at end of row (C does per-row SO/SI)
    if (activeColor !== ANSI_DEFAULT) output += `\x1b[${ANSI_DEFAULT}m`;
    if (activeDec) output += '\x0f';

    return output;
}

// ── Status lines ──
// Hero name as shown on the status line. In debug (wizard) mode the C
// game forces plname to "wizard"; status capitalizes the first letter.
function _statusPlname() {
    let name = game.flags?.debug ? 'wizard' : (game.plname || 'Hero');
    if (name && name[0] >= 'a' && name[0] <= 'z')
        name = name[0].toUpperCase() + name.slice(1);
    return name;
}

// C ref: botl.c get_strength_str — STR encoded 3..18 normal, 19..118 as 18/xx.
function _strengthStr(st) {
    const STR18_100 = 118;
    if (st > 18) {
        if (st > STR18_100) return String(st - 100);
        if (st < STR18_100) return `18/${String(st - 18).padStart(2, '0')}`;
        return '18/**';
    }
    return String(st);
}

export function statusLine1Text() { return _statusLine1(); }
export function statusLine2Text() { return _statusLine2(); }

function _statusLine1() {
    const u = game.u;
    if (!u) return '';
    const name = _statusPlname();
    const role = game.urole?.rank?.m || game.urole?.name?.m || 'Adventurer';
    const title = `${name} the ${role}`;
    // acurr.a is stored in attribute order [STR, INT, WIS, DEX, CON, CHA]
    // (A_STR..A_CHA); the status line displays St Dx Co In Wi Ch.
    const a = u.acurr?.a || [];
    const stats = `St:${_strengthStr(a[0] ?? 0)} Dx:${a[3] ?? 0} Co:${a[4] ?? 0} In:${a[1] ?? 0} Wi:${a[2] ?? 0} Ch:${a[5] ?? 0}`;
    const align = u.ualign?.type === 0 ? 'Neutral' : u.ualign?.type > 0 ? 'Lawful' : 'Chaotic';
    // C pads title+"  " out so the stats column starts at a fixed offset
    // (mrank_sz + 15 == 31 for our roles).
    const gap = Math.max(2, 31 - title.length);
    if (gap > 4) return `${title}\x1b[${gap}C${stats} ${align}`;
    return `${title}${' '.repeat(gap)}${stats} ${align}`;
}

function _statusLine2() {
    const u = game.u;
    if (!u) return '';
    let s = `Dlvl:${u.uz?.dlevel || 1} $:${game._goldCount || 0} HP:${u.uhp || 0}(${u.uhpmax || 0}) Pw:${u.uen || 0}(${u.uenmax || 0}) AC:${u.uac ?? 0}`;
    // C ref: botl.c do_statusline2 — Xp:<lvl>[/<exp>], optional T:<moves>.
    if (game.flags?.showexp)
        s += ` Xp:${u.ulevel || 1}/${u.uexp || 0}`;
    else
        s += ` Xp:${u.ulevel || 1}`;
    if (game.flags?.time)
        s += ` T:${game.moves || 1}`;
    return s;
}

// ── Serialize terminal grid for screen comparison ──
export function serialize_terminal_grid(display) {
    let output = '';
    let lastRow = 0;
    for (let r = 0; r < display.rows; r++) {
        for (let c = 0; c < display.cols; c++) {
            if (display.grid[r][c].ch !== ' ') { lastRow = r; break; }
        }
    }
    for (let r = 0; r <= lastRow; r++) {
        let lastCol = -1;
        for (let c = display.cols - 1; c >= 0; c--) {
            if (display.grid[r][c].ch !== ' ') { lastCol = c; break; }
        }
        if (lastCol < 0) { if (r < lastRow) output += '\n'; continue; }
        let firstCol = 0;
        for (let c = 0; c <= lastCol; c++) {
            if (display.grid[r][c].ch !== ' ') { firstCol = c; break; }
        }
        if (firstCol > 4) output += `\x1b[${firstCol}C`;
        else if (firstCol > 0) output += ' '.repeat(firstCol);
        for (let c = firstCol; c <= lastCol; c++) output += display.grid[r][c].ch;
        if (r < lastRow) output += '\n';
    }
    return output;
}

// ── Build screen output ──
function _buildScreenOutput() {
    const display = game?.nhDisplay;
    if (!display) return;

    let output = '';
    // Row 0: message
    output += (game._pending_message || '') + '\n';

    // Rows 1-21: map (rendered with DEC + ANSI, per-row SO/SI)
    for (let y = 0; y < ROWNO; y++) {
        output += render_map_row(y) + '\n';
    }

    // Row 22-23: status
    output += _statusLine1() + '\n';
    output += _statusLine2();

    game._screen_output = output;

    // Also write to grid for serialize_terminal_grid
    if (display.grid) {
        display.clearScreen();
        // Message line
        const msg = game._pending_message || '';
        for (let c = 0; c < Math.min(msg.length, display.cols); c++)
            display.setCell(c, 0, msg[c], NO_COLOR, 0);
        // Map — write characters to grid (DEC → Unicode for browser display)
        for (let y = 0; y < ROWNO; y++) {
            for (let x = 1; x < COLNO; x++) {
                const loc = game.level?.at(x, y);
                if (!loc?.disp_ch || loc.disp_ch === ' ') continue;
                const ch = loc.disp_decgfx ? (DEC_TO_UNICODE[loc.disp_ch] || loc.disp_ch) : loc.disp_ch;
                display.setCell(x - 1, y + 1, ch, loc.disp_color ?? NO_COLOR, loc.disp_attr ?? 0);
            }
        }
        // Status lines
        const s1 = _statusLine1().replace(/\x1b\[[0-9;]*[A-Za-z]/g, m =>
            m.match(/\x1b\[\d+C/) ? ' '.repeat(parseInt(m.slice(2))) : '');
        for (let c = 0; c < Math.min(s1.length, display.cols); c++)
            display.setCell(c, 22, s1[c], NO_COLOR, 0);
        const s2 = _statusLine2();
        for (let c = 0; c < Math.min(s2.length, display.cols); c++)
            display.setCell(c, 23, s2[c], NO_COLOR, 0);
        // Cursor at hero
        if (game.u?.ux > 0)
            display.setCursor(game.u.ux - 1, game.u.uy + 1);
    }
}

// Write the two status lines (rows 22-23) to the terminal grid. Used by
// the legend/welcome startup rendering, which overlays a window region
// but must keep the status visible underneath.
export function renderStatusLines(display) {
    if (!display?.setCell) return;
    const s1 = _statusLine1().replace(/\x1b\[[0-9;]*[A-Za-z]/g, m =>
        m.match(/\x1b\[\d+C/) ? ' '.repeat(parseInt(m.slice(2))) : '');
    for (let c = 0; c < Math.min(s1.length, display.cols); c++)
        display.setCell(c, 22, s1[c], NO_COLOR, 0);
    const s2 = _statusLine2();
    for (let c = 0; c < Math.min(s2.length, display.cols); c++)
        display.setCell(c, 23, s2[c], NO_COLOR, 0);
}

// ── flush_screen ──
export async function flush_screen(mode) {
    if (game._modal_screen) return;
    if (game._freeze_screen_once) {
        delete game._freeze_screen_once;
        return;
    }
    _buildScreenOutput();
}

// ── cls ──
export async function cls() {
    const display = game?.nhDisplay;
    if (display?.clearScreen) display.clearScreen();
    game._pending_message = '';
}

// ── bot ──
export async function bot() {
    // Status line updates happen in _buildScreenOutput
}

// ── pline ──
export async function pline(msg) {
    game._pending_message = msg;
}
