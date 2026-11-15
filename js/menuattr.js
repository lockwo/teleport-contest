// menuattr.js -- consumer-side translation of iflags.menu_headings.
//
// options.js stores menu_headings.attr verbatim in its own enum (NONE=0,
// BOLD=1, DIM=2, ITALIC=3, ULINE=4, BLINK=5, INVERSE=7 -- C ref: options.c
// ATR_* / coloratt.c attrnames[]), NOT terminal.js's render BITS (NONE=0,
// INVERSE=1, BOLD=2, UNDERLINE=4); only NONE/ULINE(4) coincide by accident.
// DIM/ITALIC/BLINK have no render bit here and fall back to no attr.
// Leaf module (gstate + terminal only) so early modules may import it.
import { game } from './gstate.js';
import { ATR_NONE, ATR_INVERSE, ATR_BOLD, ATR_UNDERLINE, NO_COLOR, CLR_GRAY, CLR_BLACK } from './terminal.js';

export function menuHeadAttr() {
    const a = game.iflags?.menu_headings?.attr;
    if (a == null) return ATR_INVERSE;
    switch (a) {
    case 1: return ATR_BOLD;       // options.js ATR_BOLD
    case 4: return ATR_UNDERLINE;  // options.js ATR_ULINE
    case 7: return ATR_INVERSE;    // options.js ATR_INVERSE (wintype.h:134)
    default: return ATR_NONE;      // NONE/DIM/ITALIC/BLINK: no render bit
    }
}

export function menuHeadColor() {
    const color = game.iflags?.menu_headings?.color ?? NO_COLOR;
    // Gray is the tty default. The recorder's bright black also decodes to 8.
    if (color === CLR_GRAY || color === CLR_BLACK) return NO_COLOR;
    return color;
}

// add_menu_heading() and tty_end_menu() bypass MENUCOLOR rules. Only
// add_menu_heading() suppresses its style during end-of-game disclosure.
export function menuHeadStyle(suppress = false) {
    return {
        attr: suppress ? ATR_NONE : menuHeadAttr(),
        color: suppress ? NO_COLOR : menuHeadColor(),
        header: true,
    };
}
