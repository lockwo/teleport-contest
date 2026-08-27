// rip.js — end-of-game tombstone ("REST IN PEACE").
//
// C ref: src/rip.c genl_outrip().  The tty window-port uses genl_outrip
// directly (win/tty/wintty.c window_procs .outrip = genl_outrip), so this is
// the whole tombstone renderer.  It builds the 15-line stone graphic with the
// hero's name, gold, cause of death (word-wrapped over up to four lines) and
// the year of death centred onto the face of the stone, and returns the lines
// as an array of strings for the caller to putstr() into the endgame TEXT
// window.  No RNG.

// C ref: rip.c rip_txt[] — the normal tombstone (NH320_DEDICATION off).  '\'
// and other escapes are the literal stone-face characters.
const RIP_TXT = [
    '                       ----------',
    '                      /          \\',
    '                     /    REST    \\',
    '                    /      IN      \\',
    '                   /     PEACE      \\',
    '                  /                  \\',
    '                  |                  |', // NAME_LINE  (6)
    '                  |                  |', // GOLD_LINE  (7)
    '                  |                  |', // DEATH_LINE (8)
    '                  |                  |', // .          (9)
    '                  |                  |', // .          (10)
    '                  |                  |', // .          (11)
    '                  |       1001       |', // YEAR_LINE  (12)
    '                 *|     *  *  *      | *',
    '        _________)/\\\\_//(\\/(/\\)/\\//\\/|_)_______',
];

const STONE_LINE_CENT = 28; // char[] element of centre of stone face
const STONE_LINE_LEN = 16;  // # chars that fit on one line (1-space border)
const NAME_LINE = 6;
const GOLD_LINE = 7;
const DEATH_LINE = 8;
const YEAR_LINE = 12;

// C ref: rip.c center(line, text) — copy text into gr.rip[line] so that it is
// centred at column STONE_LINE_CENT.  op = &rip[line][STONE_LINE_CENT -
// ((strlen(text)+1) >> 1)].
function center(rows, line, text) {
    const start = STONE_LINE_CENT - ((text.length + 1) >> 1);
    const arr = rows[line].split('');
    for (let i = 0; i < text.length; i++) {
        if (start + i >= 0 && start + i < arr.length) arr[start + i] = text[i];
    }
    rows[line] = arr.join('');
}

// C ref: rip.c genl_outrip(tmpwin, how, when).  Returns the 15 completed stone
// lines.  `plname` is the hero's name, `cash` the gold to engrave (already
// clamped to >= 0 by the caller), `deathText` the formatkiller() cause string,
// `year` the 4-digit year of death.
export function genl_outrip(plname, cash, deathText, year) {
    const rows = RIP_TXT.slice();

    // Put name on stone: Sprintf(buf, "%.*s", STONE_LINE_LEN, svp.plname).
    center(rows, NAME_LINE, String(plname).slice(0, STONE_LINE_LEN));

    // Put $ on stone: "%ld Au" with cash clamped to [0, 999999999].
    let money = Math.max(cash, 0);
    if (money > 999999999) money = 999999999;
    center(rows, GOLD_LINE, `${money} Au`);

    // Put together death description, word-wrapped across DEATH_LINE..YEAR_LINE.
    // C ref: rip.c genl_outrip() death-splitting loop.
    let dpx = String(deathText);
    for (let line = DEATH_LINE; line < YEAR_LINE; line++) {
        let i0 = dpx.length;
        if (i0 > STONE_LINE_LEN) {
            // scan back from STONE_LINE_LEN for a space to break on
            let i;
            for (i = STONE_LINE_LEN; i > 0 && i0 > STONE_LINE_LEN; --i) {
                if (dpx[i] === ' ') i0 = i;
            }
            if (i === 0) i0 = STONE_LINE_LEN;
        }
        const tmpchar = i0 < dpx.length ? dpx[i0] : '\0';
        const piece = dpx.slice(0, i0);
        center(rows, line, piece);
        if (tmpchar !== ' ') {
            dpx = dpx.slice(i0);
        } else {
            dpx = dpx.slice(i0 + 1);
        }
        if (!dpx) {
            // remaining lines stay blank; keep looping to leave them untouched
        }
    }

    // Put year on stone: Sprintf(buf, "%4d", year).
    center(rows, YEAR_LINE, String(year).padStart(4, ' '));

    return rows;
}
