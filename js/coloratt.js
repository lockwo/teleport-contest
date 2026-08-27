// coloratt.js — port of src/coloratt.c: the colour and attribute NAME tables,
// the 155-entry colortable[] and 240-entry color_256_definitions[] palettes,
// the pick-a-color / pick-an-attribute menus, and the CHANGE_COLOR palette
// overrides.
//
// INERT: nothing in js/ calls anything in this file yet.  It exists so the
// breadth of coloratt.c is translated; wiring each entry point into its C call
// site is a separate, measured pass (a call added here reorders the shared RNG
// draw stream and forfeits every screen after that point).
//
// Already ported elsewhere, NOT duplicated here — js/options.js owns
// match_str2clr(), match_str2attr(), color_attr_parse_str(),
// add_menu_coloring(), add_menu_coloring_parsed() and count_menucolors(),
// because the nethackrc parser needed them first.  The three this file needs
// are imported from there.
//
// TWO CONSTANT MISMATCHES a wire-up pass must reconcile first (left alone here
// because changing either moves live behaviour):
//   - js/options.js's local ATR_INVERSE is 6; include/wintype.h:134 says 7.
//   - js/const.js carries 1 for ATR_ULINE and 4 for ATR_BLINK;
//     include/wintype.h:132-133 say 4 and 5.  (Phrased without an `=` so
//     swarm/bin/constaudit.mjs does not read this note as an annotation.)
// This file uses the wintype.h values, so an attr produced here does not
// necessarily compare equal to one produced by js/options.js.

import { CLR_BLACK, CLR_WHITE, NO_COLOR } from './terminal.js';
import {
    BUFSZ, QBUFSZ, CLR_MAX, NH_BASIC_COLOR, NH_ALTPALETTE,
    NHW_MENU, PICK_ONE, PICK_ANY, MENU_BEHAVE_STANDARD,
    MENU_ITEMFLAGS_NONE, MENU_ITEMFLAGS_SELECTED,
    HL_NONE, HL_BOLD, HL_DIM, HL_ITALIC, HL_ULINE, HL_BLINK, HL_INVERSE,
} from './const.js';
import { fuzzymatch, strstri } from './objnam.js';
import { game } from './gstate.js';
import { match_str2clr, match_str2attr, add_menu_coloring_parsed } from './options.js';
import {
    tty_create_nhwindow, tty_destroy_nhwindow, tty_start_menu, tty_add_menu,
    tty_end_menu, tty_select_menu, tty_procs,
} from './wintty.js';

// C ref: include/wintype.h:128-134 ATR_*.  Deliberately NOT imported from
// js/const.js — see the header note.
const ATR_NONE = 0, ATR_BOLD = 1, ATR_DIM = 2, ATR_ITALIC = 3,
      ATR_ULINE = 4, ATR_BLINK = 5, ATR_INVERSE = 7;

// C ref: include/color.h:61 `enum nhcolortype { no_color, nh_color, rgb_color }`.
const no_color = 0, nh_color = 1, rgb_color = 2;

// C ref: include/color.h:59 COLORVAL(x).
const COLORVAL = (x) => (x & 0xFFFFFF);

// C ref: src/decl.c:74 `const char hexdd[33]`.  Each hex digit appears twice
// (lower then upper) so that strchr()'s offset / 2 is the digit's value.
const hexdd = '00112233445566778899aAbBcCdDeEfF';

const INT_MAX = 2147483647;

// C ref: sys/share/posixregex.c:52.  sys/unix/Makefile.src:229 selects
// posixregex.o, so basic_menu_colors()'s pmatchregex test is FALSE.
const regex_id = 'posixregex';

// strchr(): index of c in s, or -1.  C's strchr also matches the terminating
// NUL, which alt_color_spec()'s `strchr(dec, *cp)` relies on when the argument
// is a single character.
function strchr(s, c) {
    if (c === '\0') return s.length;
    return s.indexOf(c);
}

function digit(c) { return c >= '0' && c <= '9'; }
function isxdigit(c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
function isspace(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\v' || c === '\f' || c === '\r'; }
function atoi(s) { const n = parseInt(s, 10); return Number.isNaN(n) ? 0 : n; }
function strncmpi(a, b, n) {
    const x = String(a).slice(0, n).toLowerCase(), y = String(b).slice(0, n).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
}

// C's `anything` is a UNION, so `any.a_int = n` also leaves any.a_void
// non-NULL — and non-NULL a_void is what wintty.c tty_add_menu() tests to
// decide an entry is selectable.  js/wintty.js keeps the fields separate, so
// both have to be set to reproduce that.
function anything_int(n) { return { a_void: n, a_int: n }; }

// ---------------------------------------------------------------------------
// C ref: coloratt.c:12 colornames[] — everything after the { NULL } sentinel
// is an alias.  clr2colorname() walks the whole table; query_color() and
// basic_menu_colors() stop AT the sentinel, so it has to be represented.
// (js/options.js keeps its own flattened, sentinel-less copy for
// match_str2clr(), which never needs the boundary.)
const colornames = [
    { name: 'black', color: CLR_BLACK },
    { name: 'red', color: 1 },
    { name: 'green', color: 2 },
    { name: 'brown', color: 3 },
    { name: 'blue', color: 4 },
    { name: 'magenta', color: 5 },
    { name: 'cyan', color: 6 },
    { name: 'gray', color: 7 },
    { name: 'orange', color: 9 },
    { name: 'light green', color: 10 },
    { name: 'yellow', color: 11 },
    { name: 'light blue', color: 12 },
    { name: 'light magenta', color: 13 },
    { name: 'light cyan', color: 14 },
    { name: 'white', color: CLR_WHITE },
    { name: 'no color', color: NO_COLOR },
    { name: null, color: CLR_BLACK }, /* everything after this is an alias */
    { name: 'transparent', color: NO_COLOR },
    { name: 'purple', color: 5 },
    { name: 'light purple', color: 13 },
    { name: 'bright purple', color: 13 },
    { name: 'grey', color: 7 },
    { name: 'bright red', color: 9 },
    { name: 'bright green', color: 10 },
    { name: 'bright blue', color: 12 },
    { name: 'bright magenta', color: 13 },
    { name: 'bright cyan', color: 14 },
];

// C ref: coloratt.c:46 attrnames[] — same { NULL } sentinel convention.
const attrnames = [
    { name: 'none', attr: ATR_NONE },
    { name: 'bold', attr: ATR_BOLD },
    { name: 'dim', attr: ATR_DIM },
    { name: 'italic', attr: ATR_ITALIC },
    { name: 'underline', attr: ATR_ULINE },
    { name: 'blink', attr: ATR_BLINK },
    { name: 'inverse', attr: ATR_INVERSE },
    { name: null, attr: ATR_NONE }, /* everything after this is an alias */
    { name: 'normal', attr: ATR_NONE },
    { name: 'uline', attr: ATR_ULINE },
    { name: 'reverse', attr: ATR_INVERSE },
];

// C ref: coloratt.c:66 colortable[] — { colortyp, tableindex, rgbindex, name,
// r, g, b }.  Indices 0..15 are the basic CLR_* colours; 16..154 are named
// rgb_color entries.
export const colortable = [
    { colortyp: nh_color, tableindex: 0, rgbindex: 0, name: "black", r: 0x00, g: 0x00, b: 0x00 },
    { colortyp: nh_color, tableindex: 1, rgbindex: 0, name: "red", r: 0xFF, g: 0x00, b: 0x00 },
    { colortyp: nh_color, tableindex: 2, rgbindex: 0, name: "green", r: 0x22, g: 0x8B, b: 0x22 },
    { colortyp: nh_color, tableindex: 3, rgbindex: 0, name: "brown", r: 0xA5, g: 0x2A, b: 0x2A },
    { colortyp: nh_color, tableindex: 4, rgbindex: 0, name: "blue", r: 0x00, g: 0x00, b: 0xFF },
    { colortyp: nh_color, tableindex: 5, rgbindex: 0, name: "magenta", r: 0xFF, g: 0x00, b: 0xFF },
    { colortyp: nh_color, tableindex: 6, rgbindex: 0, name: "cyan", r: 0x00, g: 0xFF, b: 0xFF },
    { colortyp: nh_color, tableindex: 7, rgbindex: 0, name: "gray", r: 0x80, g: 0x80, b: 0x80 },
    { colortyp: no_color, tableindex: 8, rgbindex: 0, name: "nocolor", r: 0x00, g: 0x00, b: 0x00 },
    { colortyp: nh_color, tableindex: 9, rgbindex: 0, name: "orange", r: 0xFF, g: 0xA5, b: 0x00 },
    { colortyp: nh_color, tableindex: 10, rgbindex: 0, name: "bright-green", r: 0x00, g: 0x80, b: 0x00 },
    { colortyp: nh_color, tableindex: 11, rgbindex: 0, name: "yellow", r: 0xFF, g: 0xFF, b: 0x00 },
    { colortyp: nh_color, tableindex: 12, rgbindex: 0, name: "bright-blue", r: 0xAD, g: 0xD8, b: 0xE6 },
    { colortyp: nh_color, tableindex: 13, rgbindex: 0, name: "bright-magenta", r: 0x93, g: 0x70, b: 0xDB },
    { colortyp: nh_color, tableindex: 14, rgbindex: 0, name: "light-cyan", r: 0xE0, g: 0xFF, b: 0xFF },
    { colortyp: nh_color, tableindex: 15, rgbindex: 0, name: "white", r: 0xFF, g: 0xFF, b: 0xFF },
    { colortyp: rgb_color, tableindex: 16, rgbindex: 0, name: "maroon", r: 0x80, g: 0x00, b: 0x00 },
    { colortyp: rgb_color, tableindex: 17, rgbindex: 1, name: "dark-red", r: 0x8B, g: 0x00, b: 0x00 },
    { colortyp: rgb_color, tableindex: 18, rgbindex: 2, name: "brown", r: 0xA5, g: 0x2A, b: 0x2A },
    { colortyp: rgb_color, tableindex: 19, rgbindex: 3, name: "firebrick", r: 0xB2, g: 0x22, b: 0x22 },
    { colortyp: rgb_color, tableindex: 20, rgbindex: 4, name: "crimson", r: 0xDC, g: 0x14, b: 0x3C },
    { colortyp: rgb_color, tableindex: 21, rgbindex: 5, name: "red", r: 0xFF, g: 0x00, b: 0x00 },
    { colortyp: rgb_color, tableindex: 22, rgbindex: 6, name: "tomato", r: 0xFF, g: 0x63, b: 0x47 },
    { colortyp: rgb_color, tableindex: 23, rgbindex: 7, name: "coral", r: 0xFF, g: 0x7F, b: 0x50 },
    { colortyp: rgb_color, tableindex: 24, rgbindex: 8, name: "indian-red", r: 0xCD, g: 0x5C, b: 0x5C },
    { colortyp: rgb_color, tableindex: 25, rgbindex: 9, name: "light-coral", r: 0xF0, g: 0x80, b: 0x80 },
    { colortyp: rgb_color, tableindex: 26, rgbindex: 10, name: "dark-salmon", r: 0xE9, g: 0x96, b: 0x7A },
    { colortyp: rgb_color, tableindex: 27, rgbindex: 11, name: "salmon", r: 0xFA, g: 0x80, b: 0x72 },
    { colortyp: rgb_color, tableindex: 28, rgbindex: 12, name: "light-salmon", r: 0xFF, g: 0xA0, b: 0x7A },
    { colortyp: rgb_color, tableindex: 29, rgbindex: 13, name: "orange-red", r: 0xFF, g: 0x45, b: 0x00 },
    { colortyp: rgb_color, tableindex: 30, rgbindex: 14, name: "dark-orange", r: 0xFF, g: 0x8C, b: 0x00 },
    { colortyp: rgb_color, tableindex: 31, rgbindex: 15, name: "orange", r: 0xFF, g: 0xA5, b: 0x00 },
    { colortyp: rgb_color, tableindex: 32, rgbindex: 16, name: "gold", r: 0xFF, g: 0xD7, b: 0x00 },
    { colortyp: rgb_color, tableindex: 33, rgbindex: 17, name: "dark-golden-rod", r: 0xB8, g: 0x86, b: 0x0B },
    { colortyp: rgb_color, tableindex: 34, rgbindex: 18, name: "golden-rod", r: 0xDA, g: 0xA5, b: 0x20 },
    { colortyp: rgb_color, tableindex: 35, rgbindex: 19, name: "pale-golden-rod", r: 0xEE, g: 0xE8, b: 0xAA },
    { colortyp: rgb_color, tableindex: 36, rgbindex: 20, name: "dark-khaki", r: 0xBD, g: 0xB7, b: 0x6B },
    { colortyp: rgb_color, tableindex: 37, rgbindex: 21, name: "khaki", r: 0xF0, g: 0xE6, b: 0x8C },
    { colortyp: rgb_color, tableindex: 38, rgbindex: 22, name: "olive", r: 0x80, g: 0x80, b: 0x00 },
    { colortyp: rgb_color, tableindex: 39, rgbindex: 23, name: "yellow", r: 0xFF, g: 0xFF, b: 0x00 },
    { colortyp: rgb_color, tableindex: 40, rgbindex: 24, name: "yellow-green", r: 0x9A, g: 0xCD, b: 0x32 },
    { colortyp: rgb_color, tableindex: 41, rgbindex: 25, name: "dark-olive-green", r: 0x55, g: 0x6B, b: 0x2F },
    { colortyp: rgb_color, tableindex: 42, rgbindex: 26, name: "olive-drab", r: 0x6B, g: 0x8E, b: 0x23 },
    { colortyp: rgb_color, tableindex: 43, rgbindex: 27, name: "lawn-green", r: 0x7C, g: 0xFC, b: 0x00 },
    { colortyp: rgb_color, tableindex: 44, rgbindex: 28, name: "chart-reuse", r: 0x7F, g: 0xFF, b: 0x00 },
    { colortyp: rgb_color, tableindex: 45, rgbindex: 29, name: "green-yellow", r: 0xAD, g: 0xFF, b: 0x2F },
    { colortyp: rgb_color, tableindex: 46, rgbindex: 30, name: "dark-green", r: 0x00, g: 0x64, b: 0x00 },
    { colortyp: rgb_color, tableindex: 47, rgbindex: 31, name: "green", r: 0x00, g: 0x80, b: 0x00 },
    { colortyp: rgb_color, tableindex: 48, rgbindex: 32, name: "forest-green", r: 0x22, g: 0x8B, b: 0x22 },
    { colortyp: rgb_color, tableindex: 49, rgbindex: 33, name: "lime", r: 0x00, g: 0xFF, b: 0x00 },
    { colortyp: rgb_color, tableindex: 50, rgbindex: 34, name: "lime-green", r: 0x32, g: 0xCD, b: 0x32 },
    { colortyp: rgb_color, tableindex: 51, rgbindex: 35, name: "light-green", r: 0x90, g: 0xEE, b: 0x90 },
    { colortyp: rgb_color, tableindex: 52, rgbindex: 36, name: "pale-green", r: 0x98, g: 0xFB, b: 0x98 },
    { colortyp: rgb_color, tableindex: 53, rgbindex: 37, name: "dark-sea-green", r: 0x8F, g: 0xBC, b: 0x8F },
    { colortyp: rgb_color, tableindex: 54, rgbindex: 38, name: "medium-spring-green", r: 0x00, g: 0xFA, b: 0x9A },
    { colortyp: rgb_color, tableindex: 55, rgbindex: 39, name: "spring-green", r: 0x00, g: 0xFF, b: 0x7F },
    { colortyp: rgb_color, tableindex: 56, rgbindex: 40, name: "sea-green", r: 0x2E, g: 0x8B, b: 0x57 },
    { colortyp: rgb_color, tableindex: 57, rgbindex: 41, name: "medium-aqua-marine", r: 0x66, g: 0xCD, b: 0xAA },
    { colortyp: rgb_color, tableindex: 58, rgbindex: 42, name: "medium-sea-green", r: 0x3C, g: 0xB3, b: 0x71 },
    { colortyp: rgb_color, tableindex: 59, rgbindex: 43, name: "light-sea-green", r: 0x20, g: 0xB2, b: 0xAA },
    { colortyp: rgb_color, tableindex: 60, rgbindex: 44, name: "dark-slate-gray", r: 0x2F, g: 0x4F, b: 0x4F },
    { colortyp: rgb_color, tableindex: 61, rgbindex: 45, name: "teal", r: 0x00, g: 0x80, b: 0x80 },
    { colortyp: rgb_color, tableindex: 62, rgbindex: 46, name: "dark-cyan", r: 0x00, g: 0x8B, b: 0x8B },
    { colortyp: rgb_color, tableindex: 63, rgbindex: 47, name: "aqua", r: 0x00, g: 0xFF, b: 0xFF },
    { colortyp: rgb_color, tableindex: 64, rgbindex: 48, name: "cyan", r: 0x00, g: 0xFF, b: 0xFF },
    { colortyp: rgb_color, tableindex: 65, rgbindex: 49, name: "light-cyan", r: 0xE0, g: 0xFF, b: 0xFF },
    { colortyp: rgb_color, tableindex: 66, rgbindex: 50, name: "dark-turquoise", r: 0x00, g: 0xCE, b: 0xD1 },
    { colortyp: rgb_color, tableindex: 67, rgbindex: 51, name: "turquoise", r: 0x40, g: 0xE0, b: 0xD0 },
    { colortyp: rgb_color, tableindex: 68, rgbindex: 52, name: "medium-turquoise", r: 0x48, g: 0xD1, b: 0xCC },
    { colortyp: rgb_color, tableindex: 69, rgbindex: 53, name: "pale-turquoise", r: 0xAF, g: 0xEE, b: 0xEE },
    { colortyp: rgb_color, tableindex: 70, rgbindex: 54, name: "aqua-marine", r: 0x7F, g: 0xFF, b: 0xD4 },
    { colortyp: rgb_color, tableindex: 71, rgbindex: 55, name: "powder-blue", r: 0xB0, g: 0xE0, b: 0xE6 },
    { colortyp: rgb_color, tableindex: 72, rgbindex: 56, name: "cadet-blue", r: 0x5F, g: 0x9E, b: 0xA0 },
    { colortyp: rgb_color, tableindex: 73, rgbindex: 57, name: "steel-blue", r: 0x46, g: 0x82, b: 0xB4 },
    { colortyp: rgb_color, tableindex: 74, rgbindex: 58, name: "corn-flower-blue", r: 0x64, g: 0x95, b: 0xED },
    { colortyp: rgb_color, tableindex: 75, rgbindex: 59, name: "deep-sky-blue", r: 0x00, g: 0xBF, b: 0xFF },
    { colortyp: rgb_color, tableindex: 76, rgbindex: 60, name: "dodger-blue", r: 0x1E, g: 0x90, b: 0xFF },
    { colortyp: rgb_color, tableindex: 77, rgbindex: 61, name: "light-blue", r: 0xAD, g: 0xD8, b: 0xE6 },
    { colortyp: rgb_color, tableindex: 78, rgbindex: 62, name: "sky-blue", r: 0x87, g: 0xCE, b: 0xEB },
    { colortyp: rgb_color, tableindex: 79, rgbindex: 63, name: "light-sky-blue", r: 0x87, g: 0xCE, b: 0xFA },
    { colortyp: rgb_color, tableindex: 80, rgbindex: 64, name: "midnight-blue", r: 0x19, g: 0x19, b: 0x70 },
    { colortyp: rgb_color, tableindex: 81, rgbindex: 65, name: "navy", r: 0x00, g: 0x00, b: 0x80 },
    { colortyp: rgb_color, tableindex: 82, rgbindex: 66, name: "dark-blue", r: 0x00, g: 0x00, b: 0x8B },
    { colortyp: rgb_color, tableindex: 83, rgbindex: 67, name: "medium-blue", r: 0x00, g: 0x00, b: 0xCD },
    { colortyp: rgb_color, tableindex: 84, rgbindex: 68, name: "blue", r: 0x00, g: 0x00, b: 0xFF },
    { colortyp: rgb_color, tableindex: 85, rgbindex: 69, name: "royal-blue", r: 0x41, g: 0x69, b: 0xE1 },
    { colortyp: rgb_color, tableindex: 86, rgbindex: 70, name: "blue-violet", r: 0x8A, g: 0x2B, b: 0xE2 },
    { colortyp: rgb_color, tableindex: 87, rgbindex: 71, name: "indigo", r: 0x4B, g: 0x00, b: 0x82 },
    { colortyp: rgb_color, tableindex: 88, rgbindex: 72, name: "dark-slate-blue", r: 0x48, g: 0x3D, b: 0x8B },
    { colortyp: rgb_color, tableindex: 89, rgbindex: 73, name: "slate-blue", r: 0x6A, g: 0x5A, b: 0xCD },
    { colortyp: rgb_color, tableindex: 90, rgbindex: 74, name: "medium-slate-blue", r: 0x7B, g: 0x68, b: 0xEE },
    { colortyp: rgb_color, tableindex: 91, rgbindex: 75, name: "medium-purple", r: 0x93, g: 0x70, b: 0xDB },
    { colortyp: rgb_color, tableindex: 92, rgbindex: 76, name: "dark-magenta", r: 0x8B, g: 0x00, b: 0x8B },
    { colortyp: rgb_color, tableindex: 93, rgbindex: 77, name: "dark-violet", r: 0x94, g: 0x00, b: 0xD3 },
    { colortyp: rgb_color, tableindex: 94, rgbindex: 78, name: "dark-orchid", r: 0x99, g: 0x32, b: 0xCC },
    { colortyp: rgb_color, tableindex: 95, rgbindex: 79, name: "medium-orchid", r: 0xBA, g: 0x55, b: 0xD3 },
    { colortyp: rgb_color, tableindex: 96, rgbindex: 80, name: "purple", r: 0x80, g: 0x00, b: 0x80 },
    { colortyp: rgb_color, tableindex: 97, rgbindex: 81, name: "thistle", r: 0xD8, g: 0xBF, b: 0xD8 },
    { colortyp: rgb_color, tableindex: 98, rgbindex: 82, name: "plum", r: 0xDD, g: 0xA0, b: 0xDD },
    { colortyp: rgb_color, tableindex: 99, rgbindex: 83, name: "violet", r: 0xEE, g: 0x82, b: 0xEE },
    { colortyp: rgb_color, tableindex: 100, rgbindex: 84, name: "magenta", r: 0xFF, g: 0x00, b: 0xFF },
    { colortyp: rgb_color, tableindex: 101, rgbindex: 85, name: "orchid", r: 0xDA, g: 0x70, b: 0xD6 },
    { colortyp: rgb_color, tableindex: 102, rgbindex: 86, name: "medium-violet-red", r: 0xC7, g: 0x15, b: 0x85 },
    { colortyp: rgb_color, tableindex: 103, rgbindex: 87, name: "pale-violet-red", r: 0xDB, g: 0x70, b: 0x93 },
    { colortyp: rgb_color, tableindex: 104, rgbindex: 88, name: "deep-pink", r: 0xFF, g: 0x14, b: 0x93 },
    { colortyp: rgb_color, tableindex: 105, rgbindex: 89, name: "hot-pink", r: 0xFF, g: 0x69, b: 0xB4 },
    { colortyp: rgb_color, tableindex: 106, rgbindex: 90, name: "light-pink", r: 0xFF, g: 0xB6, b: 0xC1 },
    { colortyp: rgb_color, tableindex: 107, rgbindex: 91, name: "pink", r: 0xFF, g: 0xC0, b: 0xCB },
    { colortyp: rgb_color, tableindex: 108, rgbindex: 92, name: "antique-white", r: 0xFA, g: 0xEB, b: 0xD7 },
    { colortyp: rgb_color, tableindex: 109, rgbindex: 93, name: "beige", r: 0xF5, g: 0xF5, b: 0xDC },
    { colortyp: rgb_color, tableindex: 110, rgbindex: 94, name: "bisque", r: 0xFF, g: 0xE4, b: 0xC4 },
    { colortyp: rgb_color, tableindex: 111, rgbindex: 95, name: "blanched-almond", r: 0xFF, g: 0xEB, b: 0xCD },
    { colortyp: rgb_color, tableindex: 112, rgbindex: 96, name: "wheat", r: 0xF5, g: 0xDE, b: 0xB3 },
    { colortyp: rgb_color, tableindex: 113, rgbindex: 97, name: "corn-silk", r: 0xFF, g: 0xF8, b: 0xDC },
    { colortyp: rgb_color, tableindex: 114, rgbindex: 98, name: "lemon-chiffon", r: 0xFF, g: 0xFA, b: 0xCD },
    { colortyp: rgb_color, tableindex: 115, rgbindex: 99, name: "light-golden-rod-yellow", r: 0xFA, g: 0xFA, b: 0xD2 },
    { colortyp: rgb_color, tableindex: 116, rgbindex: 100, name: "light-yellow", r: 0xFF, g: 0xFF, b: 0xE0 },
    { colortyp: rgb_color, tableindex: 117, rgbindex: 101, name: "saddle-brown", r: 0x8B, g: 0x45, b: 0x13 },
    { colortyp: rgb_color, tableindex: 118, rgbindex: 102, name: "sienna", r: 0xA0, g: 0x52, b: 0x2D },
    { colortyp: rgb_color, tableindex: 119, rgbindex: 103, name: "chocolate", r: 0xD2, g: 0x69, b: 0x1E },
    { colortyp: rgb_color, tableindex: 120, rgbindex: 104, name: "peru", r: 0xCD, g: 0x85, b: 0x3F },
    { colortyp: rgb_color, tableindex: 121, rgbindex: 105, name: "sandy-brown", r: 0xF4, g: 0xA4, b: 0x60 },
    { colortyp: rgb_color, tableindex: 122, rgbindex: 106, name: "burly-wood", r: 0xDE, g: 0xB8, b: 0x87 },
    { colortyp: rgb_color, tableindex: 123, rgbindex: 107, name: "tan", r: 0xD2, g: 0xB4, b: 0x8C },
    { colortyp: rgb_color, tableindex: 124, rgbindex: 108, name: "rosy-brown", r: 0xBC, g: 0x8F, b: 0x8F },
    { colortyp: rgb_color, tableindex: 125, rgbindex: 109, name: "moccasin", r: 0xFF, g: 0xE4, b: 0xB5 },
    { colortyp: rgb_color, tableindex: 126, rgbindex: 110, name: "navajo-white", r: 0xFF, g: 0xDE, b: 0xAD },
    { colortyp: rgb_color, tableindex: 127, rgbindex: 111, name: "peach-puff", r: 0xFF, g: 0xDA, b: 0xB9 },
    { colortyp: rgb_color, tableindex: 128, rgbindex: 112, name: "misty-rose", r: 0xFF, g: 0xE4, b: 0xE1 },
    { colortyp: rgb_color, tableindex: 129, rgbindex: 113, name: "lavender-blush", r: 0xFF, g: 0xF0, b: 0xF5 },
    { colortyp: rgb_color, tableindex: 130, rgbindex: 114, name: "linen", r: 0xFA, g: 0xF0, b: 0xE6 },
    { colortyp: rgb_color, tableindex: 131, rgbindex: 115, name: "old-lace", r: 0xFD, g: 0xF5, b: 0xE6 },
    { colortyp: rgb_color, tableindex: 132, rgbindex: 116, name: "papaya-whip", r: 0xFF, g: 0xEF, b: 0xD5 },
    { colortyp: rgb_color, tableindex: 133, rgbindex: 117, name: "sea-shell", r: 0xFF, g: 0xF5, b: 0xEE },
    { colortyp: rgb_color, tableindex: 134, rgbindex: 118, name: "mint-cream", r: 0xF5, g: 0xFF, b: 0xFA },
    { colortyp: rgb_color, tableindex: 135, rgbindex: 119, name: "slate-gray", r: 0x70, g: 0x80, b: 0x90 },
    { colortyp: rgb_color, tableindex: 136, rgbindex: 120, name: "light-slate-gray", r: 0x77, g: 0x88, b: 0x99 },
    { colortyp: rgb_color, tableindex: 137, rgbindex: 121, name: "light-steel-blue", r: 0xB0, g: 0xC4, b: 0xDE },
    { colortyp: rgb_color, tableindex: 138, rgbindex: 122, name: "lavender", r: 0xE6, g: 0xE6, b: 0xFA },
    { colortyp: rgb_color, tableindex: 139, rgbindex: 123, name: "floral-white", r: 0xFF, g: 0xFA, b: 0xF0 },
    { colortyp: rgb_color, tableindex: 140, rgbindex: 124, name: "alice-blue", r: 0xF0, g: 0xF8, b: 0xFF },
    { colortyp: rgb_color, tableindex: 141, rgbindex: 125, name: "ghost-white", r: 0xF8, g: 0xF8, b: 0xFF },
    { colortyp: rgb_color, tableindex: 142, rgbindex: 126, name: "honeydew", r: 0xF0, g: 0xFF, b: 0xF0 },
    { colortyp: rgb_color, tableindex: 143, rgbindex: 127, name: "ivory", r: 0xFF, g: 0xFF, b: 0xF0 },
    { colortyp: rgb_color, tableindex: 144, rgbindex: 128, name: "azure", r: 0xF0, g: 0xFF, b: 0xFF },
    { colortyp: rgb_color, tableindex: 145, rgbindex: 129, name: "snow", r: 0xFF, g: 0xFA, b: 0xFA },
    { colortyp: rgb_color, tableindex: 146, rgbindex: 130, name: "black", r: 0x00, g: 0x00, b: 0x00 },
    { colortyp: rgb_color, tableindex: 147, rgbindex: 131, name: "dim-gray", r: 0x69, g: 0x69, b: 0x69 },
    { colortyp: rgb_color, tableindex: 148, rgbindex: 132, name: "gray", r: 0x80, g: 0x80, b: 0x80 },
    { colortyp: rgb_color, tableindex: 149, rgbindex: 133, name: "dark-gray", r: 0xA9, g: 0xA9, b: 0xA9 },
    { colortyp: rgb_color, tableindex: 150, rgbindex: 134, name: "silver", r: 0xC0, g: 0xC0, b: 0xC0 },
    { colortyp: rgb_color, tableindex: 151, rgbindex: 135, name: "light-gray", r: 0xD3, g: 0xD3, b: 0xD3 },
    { colortyp: rgb_color, tableindex: 152, rgbindex: 136, name: "gainsboro", r: 0xDC, g: 0xDC, b: 0xDC },
    { colortyp: rgb_color, tableindex: 153, rgbindex: 137, name: "white-smoke", r: 0xF5, g: 0xF5, b: 0xF5 },
    { colortyp: rgb_color, tableindex: 154, rgbindex: 138, name: "white", r: 0xFF, g: 0xFF, b: 0xFF },
];

// ---------------------------------------------------------------------------
// C ref: coloratt.c:237 colortable_to_int32().
export function colortable_to_int32(cte) {
    let clr = NO_COLOR | NH_BASIC_COLOR;

    if (cte.colortyp === rgb_color)
        clr = (cte.r << 16) | (cte.g << 8) | cte.b;
    else if (cte.colortyp === nh_color)
        clr = cte.tableindex | NH_BASIC_COLOR;
    return clr;
}

// C ref: coloratt.c:249 color_attr_to_str().  Returns a static buf in C.
export function color_attr_to_str(ca) {
    const buf = `${clr2colorname(ca.color)}&${attr2attrname(ca.attr)}`;

    return buf.slice(0, BUFSZ - 1);
}

// C ref: coloratt.c:304 query_color_attr().  Async because select_menu() is.
export async function query_color_attr(ca, prompt) {
    let c, a;

    c = await query_color(prompt, ca.color);
    if (c === -1)
        return false;
    a = await query_attr(prompt, ca.attr);
    if (a === -1)
        return false;
    ca.color = c;
    ca.attr = a;
    return true;
}

// C ref: coloratt.c:320 attr2attrname().  Unlike clr2colorname() this does NOT
// skip the NULL-name sentinel; it never reaches it because the sentinel's attr
// is ATR_NONE, which entry 0 already matches.
export function attr2attrname(attr) {
    let i;

    for (i = 0; i < attrnames.length; i++)
        if (attrnames[i].attr === attr)
            return attrnames[i].name;
    return null;
}

/*
 * Color support functions and data for "color"
 *
 * Used by: optfn_()
 *
 */

// C ref: coloratt.c:338 clr2colorname().
export function clr2colorname(clr) {
    let i;

    for (i = 0; i < colornames.length; i++)
        if (colornames[i].name && colornames[i].color === clr)
            return colornames[i].name;
    return null;
}

/* ask about highlighting attribute; for menu headers and menu
   coloring patterns, only one attribute at a time is allowed;
   for status highlighting, multiple attributes are allowed [overkill;
   life would be much simpler if that were restricted to one also...] */
// C ref: coloratt.c:396 query_attr().
export async function query_attr(prompt, dflt_attr) {
    let tmpwin, any, i, pick_cnt;
    const picks = [];
    const allow_many = !!(prompt && !strncmpi(prompt, 'Choose', 6));
    const clr = NO_COLOR;

    tmpwin = tty_create_nhwindow(NHW_MENU);
    tty_start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    any = anything_int(0); /* cg.zeroany */
    for (i = 0; i < attrnames.length; i++) {
        if (!attrnames[i].name)
            break;
        any = anything_int(i + 1);
        /* C passes &nul_glyphinfo; js/wintty.js substitutes { glyph: NO_GLYPH }
           for a null glyphinfo. */
        tty_add_menu(tmpwin, null, any, 0, 0,
                     attrnames[i].attr, clr, attrnames[i].name,
                     (attrnames[i].attr === dflt_attr) ? MENU_ITEMFLAGS_SELECTED
                                                       : MENU_ITEMFLAGS_NONE);
    }
    tty_end_menu(tmpwin, (prompt && prompt.length) ? prompt : 'Pick an attribute');
    pick_cnt = await tty_select_menu(tmpwin, allow_many ? PICK_ANY : PICK_ONE, picks);
    tty_destroy_nhwindow(tmpwin);
    if (pick_cnt > 0) {
        let j, k = 0;

        if (allow_many) {
            /* PICK_ANY, with one preselected entry (ATR_NONE) which
               should be excluded if any other choices were picked */
            for (i = 0; i < pick_cnt; ++i) {
                j = picks[i].item.a_int - 1;
                if (attrnames[j].attr !== ATR_NONE || pick_cnt === 1) {
                    switch (attrnames[j].attr) {
                    case ATR_NONE:
                        k = HL_NONE;
                        break;
                    case ATR_BOLD:
                        k |= HL_BOLD;
                        break;
                    case ATR_DIM:
                        k |= HL_DIM;
                        break;
                    case ATR_ITALIC:
                        k |= HL_ITALIC;
                        break;
                    case ATR_ULINE:
                        k |= HL_ULINE;
                        break;
                    case ATR_BLINK:
                        k |= HL_BLINK;
                        break;
                    case ATR_INVERSE:
                        k |= HL_INVERSE;
                        break;
                    }
                }
            }
        } else {
            /* PICK_ONE, but might get 0 or 2 due to preselected entry */
            j = picks[0].item.a_int - 1;
            /* pick_cnt==2: explicitly picked something other than the
               preselected entry */
            if (pick_cnt === 2 && attrnames[j].attr === dflt_attr)
                j = picks[1].item.a_int - 1;
            k = attrnames[j].attr;
        }
        return k;
    } else if (pick_cnt === 0 && !allow_many) {
        /* PICK_ONE, preselected entry explicitly chosen */
        return dflt_attr;
    }
    /* either ESC to explicitly cancel (pick_cnt==-1) or
       PICK_ANY with preselected entry toggled off and nothing chosen */
    return -1;
}

// C ref: coloratt.c:475 query_color().
export async function query_color(prompt, dflt_color) {
    let tmpwin, any, i, pick_cnt;
    const picks = [];

    /* replace user patterns with color name ones and force 'menucolors' On */
    basic_menu_colors(true);

    tmpwin = tty_create_nhwindow(NHW_MENU);
    tty_start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    any = anything_int(0); /* cg.zeroany */
    for (i = 0; i < colornames.length; i++) {
        if (!colornames[i].name)
            break;
        any = anything_int(i + 1);
        tty_add_menu(tmpwin, null, any, 0, 0,
                     ATR_NONE, NO_COLOR, colornames[i].name,
                     (colornames[i].color === dflt_color) ? MENU_ITEMFLAGS_SELECTED
                                                          : MENU_ITEMFLAGS_NONE);
    }
    tty_end_menu(tmpwin, (prompt && prompt.length) ? prompt : 'Pick a color');
    pick_cnt = await tty_select_menu(tmpwin, PICK_ONE, picks);
    tty_destroy_nhwindow(tmpwin);

    /* remove temporary color name patterns and restore user-specified ones;
       reset 'menucolors' option to its previous value */
    basic_menu_colors(false);

    if (pick_cnt > 0) {
        i = colornames[picks[0].item.a_int - 1].color;
        /* pick_cnt==2: explicitly picked something other than the
           preselected entry */
        if (pick_cnt === 2 && i === NO_COLOR)
            i = colornames[picks[1].item.a_int - 1].color;
        return i;
    } else if (pick_cnt === 0) {
        /* pick_cnt==0: explicitly picking preselected entry toggled it off */
        return dflt_color;
    }
    return -1;
}

/* set up a menu for picking a color, one that shows each name in its color;
   overrides player's MENUCOLORS with a set of "blue"=blue, "red"=red, and
   so forth; suppresses color for black and white because one of those will
   likely be invisible due to matching the background; the alternate set of
   MENUCOLORS is kept around for potential re-use */
// C ref: coloratt.c:530 basic_menu_colors().  C globals map onto `game` as
// gm.menu_colorings -> game.menucolors, iflags.use_menu_color ->
// game.flags.menucolors, gc.color_colorings -> game.color_colorings,
// gs.save_menucolors/save_colorings -> game.save_menucolors/save_colorings.
export function basic_menu_colors(load_colors) {
    if (load_colors) {
        /* replace normal menu colors with a set specifically for colors */
        game.save_menucolors = game.flags ? game.flags.menucolors : undefined;
        game.save_colorings = game.menucolors;

        if (!game.flags) game.flags = {};
        game.flags.menucolors = true;
        if (game.color_colorings) {
            /* use the alternate colorings which were set up previously */
            game.menucolors = game.color_colorings;
        } else {
            /* create the alternate colorings once */
            let cnm;
            let i, c;
            const pmatchregex = regex_id.toLowerCase() === 'pmatchregex';
            const patternfmt = pmatchregex ? '*' : '';

            /* menu_colorings pointer has been saved; clear it in order
               to add the alternate entries as if from scratch */
            game.menucolors = [];
            /* add_menu_coloring_parsed() lives in js/options.js and writes
               through a { menucolors, flags } holder rather than the globals */
            const holder = { menucolors: game.menucolors, flags: game.flags };

            /* this orders the patterns last-in/first-out; that means
               that the "light <foo>" variations come before the basic
               "<foo>" ones, which is exactly what we want (so that the
               shorter basic names won't get false matches as substrings
               of the longer ones) */
            for (i = 0; i < colornames.length; ++i) {
                if (!colornames[i].name) /* first alias entry has no name */
                    break;
                c = colornames[i].color;
                if (c === CLR_BLACK || c === CLR_WHITE || c === NO_COLOR)
                    continue; /* skip these */
                cnm = (patternfmt + colornames[i].name).slice(0, QBUFSZ - 1);
                add_menu_coloring_parsed(cnm, c, ATR_NONE, holder);
            }

            /* right now, menu_colorings contains the alternate color list;
               remember that list for future pick-a-color instances and
               also keep it as is for this instance */
            game.color_colorings = game.menucolors;
        }
    } else {
        /* restore normal user-specified menu colors */
        game.flags.menucolors = game.save_menucolors;
        game.menucolors = game.save_colorings;
    }
}

/* release all menu color patterns */
// C ref: coloratt.c:664 free_menu_coloring().  C frees each node and then
// swaps in gc.color_colorings so the do-loop runs at most twice; JS is GC'd,
// so dropping the reference is the whole of it.
export function free_menu_coloring() {
    do {
        game.menucolors = game.color_colorings || null;
        game.color_colorings = null;
    } while (game.menucolors);
}

/* release a specific menu color pattern; not used for color_colorings */
// C ref: coloratt.c:684 free_one_menu_coloring().  C walks the
// gm.menu_colorings chain and unlinks the idx'th node; our list is that same
// chain as an array in the same (newest-first) order, so an out-of-range or
// negative idx has to stay a no-op.
export function free_one_menu_coloring(idx) {
    const list = game.menucolors;

    if (!list)
        return;
    if (idx >= 0 && idx < list.length)
        list.splice(idx, 1);
}

// C ref: coloratt.c:729 `sscanf(buf, "#%02x%02x%02x%c", &r, &g, &b, &xtra)`.
// The '#' must match literally; each %02x skips leading whitespace then takes
// at most two hex digits; the trailing %c then takes ONE character, so junk
// after "#rrggbb" leaves xtra non-NUL.  Returns sscanf's conversion count.
function sscanf_rrggbb(s) {
    const out = { n: 0, r: 0, g: 0, b: 0, xtra: 0 };
    const fields = ['r', 'g', 'b'];
    let i = 0;

    if (s[0] !== '#')
        return out; /* literal '#' failed to match */
    i = 1;
    for (const f of fields) {
        while (i < s.length && isspace(s[i])) i++;
        let digits = '';
        while (i < s.length && digits.length < 2 && isxdigit(s[i])) digits += s[i++];
        if (!digits.length)
            return out; /* matching failure: sscanf stops here */
        out[f] = parseInt(digits, 16);
        out.n++;
    }
    if (i < s.length) {
        out.xtra = s.charCodeAt(i);
        out.n++;
    }
    return out;
}

/* returns -1 on no-match.
 * buf is NONNULLARG1
 */
// C ref: coloratt.c:723 check_enhanced_colors().
export function check_enhanced_colors(buf) {
    let retcolor = -1, color;

    if ((color = match_str2clr(buf, true)) !== CLR_MAX) {
        retcolor = color | NH_BASIC_COLOR;
    } else {
        const sc = sscanf_rrggbb(buf);

        if (sc.n >= 3) {
            retcolor = !sc.xtra ? ((sc.r << 16) | (sc.g << 8) | sc.b) : -1;
        } else {
            /* altbuf: allow user's "grey" to match colortable[]'s "gray";
             * fuzzymatch(): ignore spaces, hyphens, and underscores so that
             * space or underscore in user-supplied name will match hyphen
             * [note: caller splits text at spaces so we won't see any here]
             */
            const greyoffset = strstri(buf, 'grey');
            let altbuf = null;

            if (greyoffset >= 0) {
                /* C memcpy()s 4 bytes in place, so the length is unchanged */
                altbuf = buf.slice(0, greyoffset) + 'gray' + buf.slice(greyoffset + 4);
            }
            for (color = 0; color < colortable.length; ++color) {
                if (fuzzymatch(buf, colortable[color].name, ' -_', true)
                    || (altbuf && fuzzymatch(altbuf, colortable[color].name,
                                             ' -_', true))) {
                    retcolor = colortable_to_int32(colortable[color]);
                    break;
                }
            }
        }
    }
    return retcolor;
}

/* return the canonical name of a particular color */
// C ref: coloratt.c:764 wc_color_name().
export function wc_color_name(colorindx) {
    let result = 'no-color';

    if (colorindx >= 0) {
        const basicindx = colorindx & ~NH_BASIC_COLOR;

        /* if colorindx has NH_BASIC_COLOR bit set, basicindx won't,
           so differing implies a basic color */
        if (basicindx !== colorindx) {
            /* assert(basicindx < 16) */
            result = colortable[basicindx].name;
        } else {
            let indx;
            const r = (colorindx >> 16) & 0x0000ff, /* shift rrXXXX to rr */
                  g = (colorindx >> 8) & 0x0000ff,  /* shift XXggXX to gg */
                  b = colorindx & 0x0000ff;         /* mask  XXXXbb to bb */
            const hex2 = (v) => (v & 0xff).toString(16).padStart(2, '0');
            const hexcolor = `#${hex2(r)}${hex2(g)}${hex2(b)}`;

            result = hexcolor;
            /* override hex value if this is a named color */
            for (indx = 16; indx < colortable.length; ++indx)
                if (colortable[indx].r === r
                    && colortable[indx].g === g
                    && colortable[indx].b === b) {
                    result = colortable[indx].name;
                    break;
                }
        }
    }
    return result;
}

/* hexdd[] is defined in decl.c */
// C ref: coloratt.c:801 onlyhexdigits().
export function onlyhexdigits(buf) {
    let dp;

    for (dp = 0; dp < buf.length; ++dp) {
        if (!(strchr(hexdd, buf[dp]) >= 0 || buf[dp] === '-'))
            return false;
    }
    return true;
}

// C ref: coloratt.c:813 rgbstr_to_int32() — "r-g-b" DECIMAL triples.  Note
// that onlyhexdigits() lets a hex letter through but the walk below rejects
// anything that is not a digit or '-', so "ff-00-00" returns -1.
export function rgbstr_to_int32(rgbstr) {
    let r, g, b, milestone = 0;
    let c_g, c_b, c_r, cp;
    let rgb = 0;
    let dash = false;

    /* C keeps buf[] mutable and NUL-terminates each field in place, so model
       it as a char array plus the three pointers-as-indices. */
    const buf = String(rgbstr != null ? rgbstr : '').slice(0, BUFSZ - 1).split('');
    /* what strlen()/atoi() see from a pointer into buf: up to the next NUL */
    const cstr = (start) => {
        let s = '';
        for (let k = start; k < buf.length && buf[k] !== '\0'; k++) s += buf[k];
        return s;
    };

    if (buf.length && onlyhexdigits(cstr(0))) {
        c_g = c_b = -1;
        c_r = cp = 0;
        while (cp < buf.length && buf[cp] !== '\0') {
            if (digit(buf[cp]) || buf[cp] === '-') {
                if (buf[cp] === '-') {
                    buf[cp] = '\0';
                    milestone++;
                    dash = true;
                }
                cp++;
                if (dash) {
                    if (milestone < 2)
                        c_g = cp;
                    else
                        c_b = cp;
                    dash = false;
                }
            } else {
                return -1;
            }
        }
        /* sanity checks */
        if (c_r >= 0 && c_g >= 0 && c_b >= 0) {
            const s_r = cstr(c_r), s_g = cstr(c_g), s_b = cstr(c_b);

            if ((s_r.length > 0 && s_r.length < 4)
                && (s_g.length > 0 && s_g.length < 4)
                && (s_b.length > 0 && s_b.length < 4)) {
                r = atoi(s_r);
                g = atoi(s_g);
                b = atoi(s_b);
                rgb = (r << 16) | (g << 8) | (b << 0);
                return rgb;
            }
        }
    } else if (buf.length) {
        /* perhaps an enhanced color name was used instead of rgb value? */
        if ((rgb = check_enhanced_colors(cstr(0))) !== -1) {
            return rgb;
        }
    }
    return -1;
}

// C ref: coloratt.c:868 set_map_customcolor().  `gmap` is a wintype.h
// glyph_map: the two fields written are customcolor and color256idx.
export function set_map_customcolor(gmap, nhcolor) {
    const tmpgm = gmap;
    const closecolor = { v: 0 };
    const clridx = { v: 0 };

    if (!tmpgm)
        return 0;

    gmap.customcolor = nhcolor;
    if (closest_color(nhcolor, closecolor, clridx))
        gmap.color256idx = clridx.v;
    else
        gmap.color256idx = 0;
    return 1;
}

// C ref: coloratt.c:877 color_256_definitions[] — the xterm-256 palette,
// indices 16..255 (values from UnNetHack).
const color_256_definitions = [
    { index: 16, value: 0x000000 }, { index: 17, value: 0x00005f }, { index: 18, value: 0x000087 },
    { index: 19, value: 0x0000af }, { index: 20, value: 0x0000d7 }, { index: 21, value: 0x0000ff },
    { index: 22, value: 0x005f00 }, { index: 23, value: 0x005f5f }, { index: 24, value: 0x005f87 },
    { index: 25, value: 0x005faf }, { index: 26, value: 0x005fd7 }, { index: 27, value: 0x005fff },
    { index: 28, value: 0x008700 }, { index: 29, value: 0x00875f }, { index: 30, value: 0x008787 },
    { index: 31, value: 0x0087af }, { index: 32, value: 0x0087d7 }, { index: 33, value: 0x0087ff },
    { index: 34, value: 0x00af00 }, { index: 35, value: 0x00af5f }, { index: 36, value: 0x00af87 },
    { index: 37, value: 0x00afaf }, { index: 38, value: 0x00afd7 }, { index: 39, value: 0x00afff },
    { index: 40, value: 0x00d700 }, { index: 41, value: 0x00d75f }, { index: 42, value: 0x00d787 },
    { index: 43, value: 0x00d7af }, { index: 44, value: 0x00d7d7 }, { index: 45, value: 0x00d7ff },
    { index: 46, value: 0x00ff00 }, { index: 47, value: 0x00ff5f }, { index: 48, value: 0x00ff87 },
    { index: 49, value: 0x00ffaf }, { index: 50, value: 0x00ffd7 }, { index: 51, value: 0x00ffff },
    { index: 52, value: 0x5f0000 }, { index: 53, value: 0x5f005f }, { index: 54, value: 0x5f0087 },
    { index: 55, value: 0x5f00af }, { index: 56, value: 0x5f00d7 }, { index: 57, value: 0x5f00ff },
    { index: 58, value: 0x5f5f00 }, { index: 59, value: 0x5f5f5f }, { index: 60, value: 0x5f5f87 },
    { index: 61, value: 0x5f5faf }, { index: 62, value: 0x5f5fd7 }, { index: 63, value: 0x5f5fff },
    { index: 64, value: 0x5f8700 }, { index: 65, value: 0x5f875f }, { index: 66, value: 0x5f8787 },
    { index: 67, value: 0x5f87af }, { index: 68, value: 0x5f87d7 }, { index: 69, value: 0x5f87ff },
    { index: 70, value: 0x5faf00 }, { index: 71, value: 0x5faf5f }, { index: 72, value: 0x5faf87 },
    { index: 73, value: 0x5fafaf }, { index: 74, value: 0x5fafd7 }, { index: 75, value: 0x5fafff },
    { index: 76, value: 0x5fd700 }, { index: 77, value: 0x5fd75f }, { index: 78, value: 0x5fd787 },
    { index: 79, value: 0x5fd7af }, { index: 80, value: 0x5fd7d7 }, { index: 81, value: 0x5fd7ff },
    { index: 82, value: 0x5fff00 }, { index: 83, value: 0x5fff5f }, { index: 84, value: 0x5fff87 },
    { index: 85, value: 0x5fffaf }, { index: 86, value: 0x5fffd7 }, { index: 87, value: 0x5fffff },
    { index: 88, value: 0x870000 }, { index: 89, value: 0x87005f }, { index: 90, value: 0x870087 },
    { index: 91, value: 0x8700af }, { index: 92, value: 0x8700d7 }, { index: 93, value: 0x8700ff },
    { index: 94, value: 0x875f00 }, { index: 95, value: 0x875f5f }, { index: 96, value: 0x875f87 },
    { index: 97, value: 0x875faf }, { index: 98, value: 0x875fd7 }, { index: 99, value: 0x875fff },
    { index: 100, value: 0x878700 }, { index: 101, value: 0x87875f }, { index: 102, value: 0x878787 },
    { index: 103, value: 0x8787af }, { index: 104, value: 0x8787d7 }, { index: 105, value: 0x8787ff },
    { index: 106, value: 0x87af00 }, { index: 107, value: 0x87af5f }, { index: 108, value: 0x87af87 },
    { index: 109, value: 0x87afaf }, { index: 110, value: 0x87afd7 }, { index: 111, value: 0x87afff },
    { index: 112, value: 0x87d700 }, { index: 113, value: 0x87d75f }, { index: 114, value: 0x87d787 },
    { index: 115, value: 0x87d7af }, { index: 116, value: 0x87d7d7 }, { index: 117, value: 0x87d7ff },
    { index: 118, value: 0x87ff00 }, { index: 119, value: 0x87ff5f }, { index: 120, value: 0x87ff87 },
    { index: 121, value: 0x87ffaf }, { index: 122, value: 0x87ffd7 }, { index: 123, value: 0x87ffff },
    { index: 124, value: 0xaf0000 }, { index: 125, value: 0xaf005f }, { index: 126, value: 0xaf0087 },
    { index: 127, value: 0xaf00af }, { index: 128, value: 0xaf00d7 }, { index: 129, value: 0xaf00ff },
    { index: 130, value: 0xaf5f00 }, { index: 131, value: 0xaf5f5f }, { index: 132, value: 0xaf5f87 },
    { index: 133, value: 0xaf5faf }, { index: 134, value: 0xaf5fd7 }, { index: 135, value: 0xaf5fff },
    { index: 136, value: 0xaf8700 }, { index: 137, value: 0xaf875f }, { index: 138, value: 0xaf8787 },
    { index: 139, value: 0xaf87af }, { index: 140, value: 0xaf87d7 }, { index: 141, value: 0xaf87ff },
    { index: 142, value: 0xafaf00 }, { index: 143, value: 0xafaf5f }, { index: 144, value: 0xafaf87 },
    { index: 145, value: 0xafafaf }, { index: 146, value: 0xafafd7 }, { index: 147, value: 0xafafff },
    { index: 148, value: 0xafd700 }, { index: 149, value: 0xafd75f }, { index: 150, value: 0xafd787 },
    { index: 151, value: 0xafd7af }, { index: 152, value: 0xafd7d7 }, { index: 153, value: 0xafd7ff },
    { index: 154, value: 0xafff00 }, { index: 155, value: 0xafff5f }, { index: 156, value: 0xafff87 },
    { index: 157, value: 0xafffaf }, { index: 158, value: 0xafffd7 }, { index: 159, value: 0xafffff },
    { index: 160, value: 0xd70000 }, { index: 161, value: 0xd7005f }, { index: 162, value: 0xd70087 },
    { index: 163, value: 0xd700af }, { index: 164, value: 0xd700d7 }, { index: 165, value: 0xd700ff },
    { index: 166, value: 0xd75f00 }, { index: 167, value: 0xd75f5f }, { index: 168, value: 0xd75f87 },
    { index: 169, value: 0xd75faf }, { index: 170, value: 0xd75fd7 }, { index: 171, value: 0xd75fff },
    { index: 172, value: 0xd78700 }, { index: 173, value: 0xd7875f }, { index: 174, value: 0xd78787 },
    { index: 175, value: 0xd787af }, { index: 176, value: 0xd787d7 }, { index: 177, value: 0xd787ff },
    { index: 178, value: 0xd7af00 }, { index: 179, value: 0xd7af5f }, { index: 180, value: 0xd7af87 },
    { index: 181, value: 0xd7afaf }, { index: 182, value: 0xd7afd7 }, { index: 183, value: 0xd7afff },
    { index: 184, value: 0xd7d700 }, { index: 185, value: 0xd7d75f }, { index: 186, value: 0xd7d787 },
    { index: 187, value: 0xd7d7af }, { index: 188, value: 0xd7d7d7 }, { index: 189, value: 0xd7d7ff },
    { index: 190, value: 0xd7ff00 }, { index: 191, value: 0xd7ff5f }, { index: 192, value: 0xd7ff87 },
    { index: 193, value: 0xd7ffaf }, { index: 194, value: 0xd7ffd7 }, { index: 195, value: 0xd7ffff },
    { index: 196, value: 0xff0000 }, { index: 197, value: 0xff005f }, { index: 198, value: 0xff0087 },
    { index: 199, value: 0xff00af }, { index: 200, value: 0xff00d7 }, { index: 201, value: 0xff00ff },
    { index: 202, value: 0xff5f00 }, { index: 203, value: 0xff5f5f }, { index: 204, value: 0xff5f87 },
    { index: 205, value: 0xff5faf }, { index: 206, value: 0xff5fd7 }, { index: 207, value: 0xff5fff },
    { index: 208, value: 0xff8700 }, { index: 209, value: 0xff875f }, { index: 210, value: 0xff8787 },
    { index: 211, value: 0xff87af }, { index: 212, value: 0xff87d7 }, { index: 213, value: 0xff87ff },
    { index: 214, value: 0xffaf00 }, { index: 215, value: 0xffaf5f }, { index: 216, value: 0xffaf87 },
    { index: 217, value: 0xffafaf }, { index: 218, value: 0xffafd7 }, { index: 219, value: 0xffafff },
    { index: 220, value: 0xffd700 }, { index: 221, value: 0xffd75f }, { index: 222, value: 0xffd787 },
    { index: 223, value: 0xffd7af }, { index: 224, value: 0xffd7d7 }, { index: 225, value: 0xffd7ff },
    { index: 226, value: 0xffff00 }, { index: 227, value: 0xffff5f }, { index: 228, value: 0xffff87 },
    { index: 229, value: 0xffffaf }, { index: 230, value: 0xffffd7 }, { index: 231, value: 0xffffff },
    { index: 232, value: 0x080808 }, { index: 233, value: 0x121212 }, { index: 234, value: 0x1c1c1c },
    { index: 235, value: 0x262626 }, { index: 236, value: 0x303030 }, { index: 237, value: 0x3a3a3a },
    { index: 238, value: 0x444444 }, { index: 239, value: 0x4e4e4e }, { index: 240, value: 0x585858 },
    { index: 241, value: 0x626262 }, { index: 242, value: 0x6c6c6c }, { index: 243, value: 0x767676 },
    { index: 244, value: 0x808080 }, { index: 245, value: 0x8a8a8a }, { index: 246, value: 0x949494 },
    { index: 247, value: 0x9e9e9e }, { index: 248, value: 0xa8a8a8 }, { index: 249, value: 0xb2b2b2 },
    { index: 250, value: 0xbcbcbc }, { index: 251, value: 0xc6c6c6 }, { index: 252, value: 0xd0d0d0 },
    { index: 253, value: 0xdadada }, { index: 254, value: 0xe4e4e4 }, { index: 255, value: 0xeeeeee },
];

/** Calculate the color distance between two colors.
 *
 * Algorithm taken from UnNetHack which took it from
 * https://www.compuphase.com/cmetric.htm
 **/
// C ref: coloratt.c:979 color_distance().
export function color_distance(rgb1, rgb2) {
    const r1 = (rgb1 >> 16) & 0xFF;
    const g1 = (rgb1 >> 8) & 0xFF;
    const b1 = (rgb1) & 0xFF;
    const r2 = (rgb2 >> 16) & 0xFF;
    const g2 = (rgb2 >> 8) & 0xFF;
    const b2 = (rgb2) & 0xFF;

    const rmean = ((r1 + r2) / 2) | 0; /* C integer division */
    const r = r1 - r2;
    const g = g1 - g2;
    const b = b1 - b2;
    return ((((512 + rmean) * r * r) >> 8) + 4 * g * g
            + (((767 - rmean) * b * b) >> 8));
}

// C ref: coloratt.c:997 closest_color().  C's two out-params are modelled as
// { v } refs; pass null for either to get C's "don't store" behaviour.
export function closest_color(lcolor, closecolor, clridx) {
    let i, color_index = -1, similar = INT_MAX, current;
    let retbool = false;

    for (i = 0; i < color_256_definitions.length; i++) {
        /* look for an exact match */
        if (lcolor === color_256_definitions[i].value) {
            color_index = i;
            break;
        }
        /* find a close color match */
        current = color_distance(lcolor, color_256_definitions[i].value);
        if (current < similar) {
            color_index = i;
            similar = current;
        }
    }
    if (closecolor && clridx && color_index >= 0) {
        closecolor.v = color_256_definitions[color_index].value;
        clridx.v = color_256_definitions[color_index].index;
        retbool = true;
    }
    return retbool;
}

// C ref: coloratt.c:1024 get_nhcolor_from_256_index().  `idx` is an index INTO
// color_256_definitions[] (0..239) via IndexOk(), NOT a 256-colour number, so
// idx 0 is 256-colour 16.
export function get_nhcolor_from_256_index(idx) {
    let retcolor = NO_COLOR | NH_BASIC_COLOR;

    if (idx >= 0 && idx < color_256_definitions.length) /* IndexOk() */
        retcolor = color_256_definitions[idx].value;
    return retcolor;
}

// ---------------------------------------------------------------------------
// #ifdef CHANGE_COLOR.  The reference build does NOT define CHANGE_COLOR, so
// these four are not compiled into the C we are matching; translated for
// completeness.  ga.altpalette -> game.altpalette (uint32[CLR_MAX], zeroed).

// C ref: coloratt.c:1036 count_alt_palette().
export function count_alt_palette() {
    let clr, clrcount = 0;
    const altpalette = game.altpalette || [];

    for (clr = 0; clr < CLR_MAX; ++clr) {
        if ((altpalette[clr] || 0) !== 0)
            clrcount++;
    }
    return clrcount;
}

// C ref: coloratt.c:1048 alternative_palette() — "colorname/rgbvalue".  A ':'
// is scanned for but does nothing; each '/' is NUL'd in place, so the id ends
// at the FIRST '/' and the value starts after the LAST one.
export function alternative_palette(op) {
    let c_colorid, c_colorval, cp;
    let reslt = 0, coloridx = CLR_MAX;
    let rgb = 0;
    let slash = false;

    if (!op)
        return 0;

    const buf = String(op).slice(0, BUFSZ - 1).split('');
    const cstr = (start) => {
        let s = '';
        for (let k = start; k < buf.length && buf[k] !== '\0'; k++) s += buf[k];
        return s;
    };

    c_colorval = -1;
    c_colorid = cp = 0;
    while (cp < buf.length && buf[cp] !== '\0') {
        if (buf[cp] === ':' || buf[cp] === '/') {
            if (buf[cp] === '/') {
                slash = true;
                buf[cp] = '\0';
            }
        }
        cp++;
        if (slash) {
            c_colorval = cp;
            slash = false;
        }
    }
    /* some sanity checks */
    if (c_colorid >= 0 && buf[c_colorid] === ' ')
        c_colorid++;
    if (c_colorval >= 0 && buf[c_colorval] === ' ')
        c_colorval++;
    if (c_colorid >= 0)
        coloridx = match_str2clr(cstr(c_colorid), true);

    if (c_colorval >= 0 && coloridx >= 0 && coloridx < CLR_MAX) {
        rgb = rgbstr_to_int32(cstr(c_colorval));
        if (rgb === -1) {
            rgb = alt_color_spec(cstr(c_colorval));
        }
        if (rgb !== -1) {
            if (!game.altpalette) game.altpalette = new Array(CLR_MAX).fill(0);
            game.altpalette[coloridx] = (rgb | NH_ALTPALETTE) >>> 0;
            /* use COLORVAL(game.altpalette[coloridx]) to get
               the actual rgb value out of game.altpalette[] */
            reslt = 1;
        }
    }
    return reslt;
}

// C ref: coloratt.c:1098 change_palette().  win_change_color only exists in a
// window port built with CHANGE_COLOR, which the tty port here is not.
export function change_palette() {
    let clridx;
    const altpalette = game.altpalette || [];

    for (clridx = 0; clridx < CLR_MAX; ++clridx) {
        if ((altpalette[clridx] || 0) !== 0) {
            const rgb = COLORVAL(altpalette[clridx]);
            tty_procs.change_color?.(clridx, rgb, 0);
        }
    }
}

// C ref: coloratt.c:1111 alt_color_spec() — "\xNN", "\oNNN", "#hex" or plain
// decimal.  staticfn in C; exported here so coverage.mjs sees it.
export function alt_color_spec(str) {
    const oct = '01234567', dec = '0123456789';
    /* hexdd[] is defined in decl.c */
    let dp;
    const s = String(str != null ? str : '');
    const at = (i) => (i < s.length ? s[i] : '\0');
    let cp = 0;
    let cval = -1;
    let dcount, dlimit = 6;
    let hexescape = false, octescape = false;

    dcount = 0; /* for decimal, octal, hexadecimal cases */
    hexescape =
        (at(cp) === '\\' && at(cp + 1) !== '\0'
         && (at(cp + 1) === 'x' || at(cp + 1) === 'X') && at(cp + 2) !== '\0');
    if (!hexescape) {
        octescape =
            (at(cp) === '\\' && at(cp + 1) !== '\0'
             && (at(cp + 1) === 'o' || at(cp + 1) === 'O') && at(cp + 2) !== '\0');
    }

    if (hexescape || octescape) {
        cval = 0;
        cp += 2;
        if (octescape)
            dlimit = 8;
    } else if (at(cp) === '#' && at(cp + 1) !== '\0') {
        hexescape = true;
        cval = 0;
        cp += 1;
    } else if (at(cp + 1) !== '\0') {
        cval = 0;
        dlimit = 8;
    } else if (at(cp + 1) === '\0') {
        if (strchr(dec, at(cp)) >= 0) {
            /* simple val, or nothing left for \ to escape.  C's strchr also
               matches the terminating NUL, so an empty string lands here with
               cval = '\0' - '0' = -48. */
            cval = at(cp).charCodeAt(0) - 48;
        }
        dlimit = 1;
        cp++;
    }

    while (at(cp) !== '\0') {
        if (!hexescape && !octescape && strchr(dec, at(cp)) >= 0) {
            cval = (cval * 10) + (at(cp).charCodeAt(0) - 48);
        } else if (octescape && strchr(oct, at(cp)) >= 0) {
            cval = (cval * 8) + (at(cp).charCodeAt(0) - 48);
        } else if (hexescape && (dp = strchr(hexdd, at(cp))) >= 0) {
            cval = (cval * 16) + ((dp / 2) | 0);
        }
        ++cp;
        if (++dcount > dlimit) {
            cval = -1;
            break;
        }
    }
    return cval;
}

/*coloratt.js*/
