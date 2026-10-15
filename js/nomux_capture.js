// nomux_capture.js — the C recorder's screen-capture path, byte for byte.
//
// C ref: nethack-c/patches/006-nomux-capture.patch, win/tty/termcap.c
// nomux_capture_screen() / nomux_get_cursor() / nomux_emit_marker().  Every
// recorded screen is whatever that code wrote to stdout, NOT the idealised
// terminal grid, and it has a memory bug the scored sessions inherit:
//
//   static char nomux_out[24 * 256];            /* 6144 bytes */
//   nomux_capture_screen(): sprintf()s up to 24 rows of per-cell SGR/SO/SI
//       escapes into nomux_out with no bounds check.
//
// A screen full of colour changes (a magic-mapped swamp: nearly every cell
// flips between blue '`' and dark-grey '~') serialises to ~6.5 KB and runs off
// the end of the array into the statics the linker placed after it
// (nm of the recorder binary, offsets from nomux_out):
//
//     6146  int nomux_raw_active        6150  int nomux_raw_row
//     6154  int nomux_raw_col           6442  char obuf[BUFSIZ]  (stdout's
//                                              setbuf() buffer, wintty.c)
//
// so (1) nomux_raw_active turns non-zero FOREVER and nomux_get_cursor() then
// reports raw_col/raw_row, i.e. four bytes of screen text each, as the cursor;
// and (2) once the string reaches obuf, the fprintf() of the marker header
// lands in obuf and fwrite(scr) streams the header (and the stdio memmove()'d
// head of the screen) back out as part of the payload.
//
// The recorded screen is encode(payload.split('\n').slice(0,24)) (see
// scripts/record-session.mjs), so reproducing it means reproducing that
// memory model.  Nothing here changes game state: it only decides what the
// recorder would have written down.

import { DEC_TO_UNICODE } from './terminal.js';
import { game } from './gstate.js';

const OUT_SIZE = 24 * 256;
const RAW_ACTIVE = 6146;
const RAW_ROW = 6150;
const RAW_COL = 6154;
const OBUF = 6442;
const BUFSIZ = 1024;
const MEM_SIZE = 96 * 1024;

// DECgraphics codes the display layer resolves to Unicode before they reach
// the terminal grid (display.js decgfxMapChar / FROZEN_DEC_CODES).
const FROZEN_DEC_CODES = 'lqkxmjtuwvna~';
const UNICODE_TO_DEC = new Map();
for (const code of FROZEN_DEC_CODES) {
    if (DEC_TO_UNICODE[code]) UNICODE_TO_DEC.set(DEC_TO_UNICODE[code], code);
}

const NO_COLOR = 8;


// A display-side cell flag (decgfx / dark-gray) is only trusted while the
// cell still holds the glyph it was recorded for; any later text write that
// bypassed GameDisplay.setCell leaves ch/color/attr different or equal-by-
// construction, and either way the flag describes the same visible cell.
export function noteCellFlags(cell, dec, dark) {
    if (!dec && !dark) {
        if (cell._fl) cell._fl = null;
        return;
    }
    cell._fl = { ch: cell.ch, color: cell.color, attr: cell.attr, dec: !!dec, dark: !!dark };
}

function cellFlags(cell) {
    const f = cell._fl;
    if (f && f.ch === cell.ch && f.color === cell.color && f.attr === cell.attr) return f;
    return null;
}

// Terminal grid cell -> the (ch, fg, attr, decgfx) tuple nomux_buf[][] holds.
function shadowCell(cell) {
    if (!cell) return { ch: 32, fg: 7, attr: 0, dec: false };
    const f = cellFlags(cell);
    const dec = f ? f.dec : false;
    let ch = cell.ch;
    if (dec && UNICODE_TO_DEC.has(ch)) ch = UNICODE_TO_DEC.get(ch);
    let code = ch.length ? ch.charCodeAt(0) : 32;
    if (code > 255) code = 63;
    let fg;
    const color = cell.color;
    if (color === NO_COLOR || color == null || color < 0 || color > 15) fg = f && f.dark ? 8 : 7;
    else if (color === 0) fg = 8; /* nomux_set_fg(): CLR_BLACK -> 8 under wc2_darkgray */
    else fg = color;
    return { ch: code, fg, attr: cell.attr | 0, dec };
}

function inkedCells(term) {
    let n = 0;
    for (let r = 0; r < 24; r++) {
        const row = term.grid[r];
        if (!row) continue;
        for (let c = 0; c < 80; c++) if (row[c] && (row[c].ch !== ' ' || row[c].attr)) n++;
    }
    return n;
}

// C ref: nomux_capture_screen().
function captureScreen(term) {
    const out = [];
    const emit = (s) => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); };
    const sgrFg = (fg) => (fg >= 0 && fg <= 7 ? 30 + fg : fg >= 8 && fg <= 15 ? 90 + (fg - 8) : 37);
    for (let row = 0; row < 24; row++) {
        let curFg = 7, curAttr = 0;
        const cells = [];
        for (let col = 0; col < 80; col++) cells.push(shadowCell(term.grid[row]?.[col]));
        let end = 79;
        while (end >= 0 && (cells[end].ch === 32 || cells[end].ch === 0)
               && cells[end].attr === 0 && (cells[end].fg === 7 || cells[end].fg === 0)) end--;
        let inDec = false;
        for (let col = 0; col <= end; col++) {
            const c = cells[col];
            const ch = c.ch ? c.ch : 32;
            const fg = c.fg ? c.fg : 7;
            const at = c.attr;
            if (at !== curAttr) {
                if ((at & 1) && !(curAttr & 1)) emit('\x1b[7m');
                if (!(at & 1) && (curAttr & 1)) emit('\x1b[27m');
                if ((at & 2) && !(curAttr & 2)) emit('\x1b[1m');
                if (!(at & 2) && (curAttr & 2)) emit('\x1b[22m');
                if ((at & 4) && !(curAttr & 4)) emit('\x1b[4m');
                if (!(at & 4) && (curAttr & 4)) emit('\x1b[24m');
                curAttr = at;
            }
            if (fg !== curFg) {
                emit(fg === 7 ? '\x1b[39m' : `\x1b[${sgrFg(fg)}m`);
                curFg = fg;
            }
            if (c.dec && !inDec) { out.push(14); inDec = true; }
            else if (!c.dec && inDec) { out.push(15); inDec = false; }
            out.push(ch);
        }
        if (inDec) { out.push(15); inDec = false; }
        if (curAttr) emit('\x1b[0m');
        else if (curFg !== 7) emit('\x1b[39m');
        if (row < 23) out.push(10);
    }
    return out;
}

const bytesToString = (a) => {
    let s = '';
    for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.slice(i, i + 8192));
    return s;
};

// scripts/record-session.mjs encodeScreenAnsiRle(payloadToLines(payload)).
function encodeScreenAnsiRle(payload) {
    const lines = payload.split('\n');
    while (lines.length < 24) lines.push('');
    const compressed = lines.slice(0, 24).map((line) => {
        const stripped = line.replace(/ +$/u, '');
        let out = '';
        for (let i = 0; i < stripped.length;) {
            if (stripped[i] === ' ') {
                const start = i;
                while (i < stripped.length && stripped[i] === ' ') i++;
                out += i - start >= 5 ? `\x1b[${i - start}C` : ' '.repeat(i - start);
            } else {
                out += stripped[i++];
            }
        }
        return out;
    });
    while (compressed.length > 0 && compressed[compressed.length - 1] === '') compressed.pop();
    return compressed.join('\n');
}

/**
 * C ref: win/tty/wintty.c tty_nh_delay_output() — with NETHACK_NO_DELAY the
 * recorder skips the sleep but calls nomux_capture_write_screen(), which bumps
 * nomux_anim_id (the ANIM= field of every later marker).  Called from every
 * port of a nh_delay_output().
 */
export function nh_delay_output_tick() {
    game._nomuxAnimId = (game._nomuxAnimId | 0) + 1;
}

/**
 * The recorder process: its .bss image from nomux_out onward (only the bytes
 * past OUT_SIZE are observable, and they persist from one capture to the next
 * exactly as in C) plus the nomux_seq counter.  One per C process, i.e. one
 * per segment.
 */
export class NomuxRecorder {
    constructor() {
        this.mem = new Uint8Array(MEM_SIZE);
        this.seq = 0;
    }

    rdInt(off) {
        const m = this.mem;
        return (m[off] | (m[off + 1] << 8) | (m[off + 2] << 16) | (m[off + 3] << 24)) | 0;
    }

    wrInt(off, v) {
        const m = this.mem;
        m[off] = v & 255;
        m[off + 1] = (v >> 8) & 255;
        m[off + 2] = (v >> 16) & 255;
        m[off + 3] = (v >> 24) & 255;
    }

    /**
     * One input-boundary marker (C: nomux_capture_write_input_boundary ->
     * nomux_emit_marker).  `raw` is game._nomux_raw ({row, col} or null),
     * `cursor` the tty cursor [col,row], `animId` nomux_anim_id.  Returns
     * { screen, cursor, raw }: `screen` is the string the recorder stored
     * (null when the serialization fits in nomux_out and the caller's own
     * serializer is already exact), `cursor` what nomux_get_cursor() reported
     * and `raw` the raw-writer state to write back (null while inactive).
     */
    emitMarker(term, raw, cursor, animId) {
        const mem = this.mem;
        this.seq++;
        // nomux_raw_active / raw_row / raw_col live inside the overflow zone.
        if (raw) {
            this.wrInt(RAW_ACTIVE, 1);
            this.wrInt(RAW_ROW, raw.row);
            this.wrInt(RAW_COL, raw.col);
        }
        // The longest cell serialization is far under 20 bytes, so a screen
        // with fewer than OUT_SIZE/20 inked cells cannot reach the statics.
        const ser = inkedCells(term) < 300 ? null : captureScreen(term);
        const L = ser ? ser.length : 0;
        const overflow = L >= OUT_SIZE + 2;
        if (overflow) {
            for (let i = 0; i < L; i++) mem[i] = ser[i];
            mem[L] = 0;
        }
        const active = this.rdInt(RAW_ACTIVE) !== 0;
        const cx = active ? this.rdInt(RAW_COL) : cursor[0];
        const cy = active ? this.rdInt(RAW_ROW) : cursor[1];
        const newRaw = active ? { row: this.rdInt(RAW_ROW), col: this.rdInt(RAW_COL) } : null;
        const outCursor = [cx, cy, 1];
        if (!overflow) return { screen: null, cursor: outCursor, raw: newRaw };

        // fprintf(stdout, header) into the (empty) stdio buffer == obuf ...
        const header = `\x1b]7777;KIND=input;SEQ=${this.seq};ANIM=${animId};CX=${cx};CY=${cy};LEN=${L}\x07`;
        for (let i = 0; i < header.length; i++) mem[OBUF + i] = header.charCodeAt(i);
        let bufp = header.length;
        // ... then fwrite(scr, 1, L, stdout) reading nomux_out in place (BSD
        // __sfvwrite: fill-and-flush, direct BUFSIZ writes, copy the rest).
        const payload = [];
        let p = 0, len = L;
        while (len > 0) {
            if (bufp > 0 && len > BUFSIZ - bufp) {
                const w = BUFSIZ - bufp;
                const src = mem.slice(p, p + w);
                mem.set(src, OBUF + bufp);
                for (let i = 0; i < w; i++) payload.push(src[i]);
                bufp = 0;
                p += w; len -= w;
            } else if (len >= BUFSIZ) {
                for (let i = 0; i < BUFSIZ; i++) payload.push(mem[p + i]);
                p += BUFSIZ; len -= BUFSIZ;
            } else {
                const src = mem.slice(p, p + len);
                mem.set(src, OBUF + bufp);
                for (let i = 0; i < len; i++) payload.push(src[i]);
                bufp += len; p += len; len = 0;
            }
        }
        return { screen: encodeScreenAnsiRle(bytesToString(payload)), cursor: outCursor, raw: newRaw };
    }
}

