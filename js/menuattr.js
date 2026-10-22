// menuattr.js -- consumer-side translation of iflags.menu_headings.attr.
//
// options.js stores menu_headings.attr verbatim in its own enum (NONE=0,
// BOLD=1, DIM=2, ITALIC=3, ULINE=4, BLINK=5, INVERSE=7 -- C ref: options.c
// ATR_* / coloratt.c attrnames[]), NOT terminal.js's render BITS (NONE=0,
// INVERSE=1, BOLD=2, UNDERLINE=4); only NONE/ULINE(4) coincide by accident.
// DIM/ITALIC/BLINK have no render bit here and fall back to no attr.
// Leaf module (gstate + terminal only) so early modules may import it.
import { game } from './gstate.js';
import { ATR_NONE, ATR_INVERSE, ATR_BOLD, ATR_UNDERLINE } from './terminal.js';

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
