// questpgr.js — Common quest-text pager ("legacy" intro).
// C ref: src/questpgr.c (com_pager / convert_line / deliver_by_window)
//        and the tty NHW_MENU window display in win/tty/wintty.c.
//
// Only the "legacy" common message (shown at game start when the
// `legacy` option is on) is needed for screen parity, so this is a
// focused port that renders that text into the terminal grid exactly
// the way the tty NHW_MENU window does, then waits for --More--.

import { game } from './gstate.js';
import { nhgetch } from './input.js';
import { NO_COLOR } from './terminal.js';
import { roles, rank_of, align_gname, align_gtitle } from './role.js';
import { A_LAWFUL, A_NEUTRAL, A_CHAOTIC } from './const.js';

// dat/quest.lua questtext.common.legacy.text
const LEGACY_TEXT = [
    'It is written in the Book of %d:',
    '',
    '    After the Creation, the cruel god Moloch rebelled',
    '    against the authority of Marduk the Creator.',
    '    Moloch stole from Marduk the most powerful of all',
    '    the artifacts of the gods, the Amulet of Yendor,',
    '    and he hid it in the dark cavities of Gehennom, the',
    '    Under World, where he now lurks, and bides his time.',
    '',
    'Your %G %d seeks to possess the Amulet, and with it',
    'to gain deserved ascendance over the other gods.',
    '',
    'You, a newly trained %r, have been heralded',
    'from birth as the instrument of %d.  You are destined',
    'to recover the Amulet for your deity, or die in the',
    'attempt.  Your hour of destiny has come.  For the sake',
    'of us all:  Go bravely with %d!',
];

// alignment-index (0 lawful, 1 neutral, 2 chaotic) → A_* value
function alignTypeFromIndex(idx) {
    if (idx === 0) return A_LAWFUL;
    if (idx === 2) return A_CHAOTIC;
    return A_NEUTRAL;
}

// C ref: questpgr.c convert_arg/convert_line — substitute %-codes.
function convert_line(line, rolenum, alignType, female) {
    const deity = align_gname(rolenum, alignType);
    const gtitle = align_gtitle(rolenum, alignType);
    const rank = rank_of(1, rolenum, female);
    // %d=deity, %G=god/goddess, %r=rank.  Order matters only in that
    // each code is replaced literally with no further interpretation.
    return line
        .replace(/%G/g, gtitle)
        .replace(/%r/g, rank)
        .replace(/%d/g, deity);
}

// Render the "legacy" intro exactly like a tty NHW_MENU window: the
// lines are centered with offx = max(10, cols - (maxlen+1) - 1), each
// line preceded by one space (so text starts at column offx+1), and a
// plain "--More--" prompt on the row after the last line at column
// offx+1.  C ref: wintty.c tty_display_nhwindow + process_text_window.
export async function com_pager_legacy() {
    const g = game;
    const disp = g.nhDisplay;
    if (!disp?.putstr) return;

    const rolenum = roles.findIndex((r) => r.mnum === (g.urole?.mnum));
    const role = rolenum >= 0 ? rolenum : (g.initrole | 0);
    const alignType = alignTypeFromIndex(g.initalign);
    const female = !!g.flags?.female;

    const lines = LEGACY_TEXT.map((l) => convert_line(l, role, alignType, female));

    // maxcol mirrors tty_putstr: strlen(str)+1 over all lines.
    let maxcol = 0;
    for (const l of lines)
        if (l.length + 1 > maxcol) maxcol = l.length + 1;

    const cols = 80;
    // C ref: wintty.c tty_display_nhwindow NHW_MENU offx — the recorder build
    // defines H2344_BROKEN, so offx = min(min(82, cols/2), cols-maxcol-1)
    // (NOT the max(10,...) form).  The longer Samurai deity ("Amaterasu
    // Omikami") pushes offx below 10, which the H2344 path allows.
    let offx = Math.min(Math.min(82, Math.floor(cols / 2)), cols - maxcol - 1);
    if (offx < 0) offx = 0;
    // The leading space printed for each menu line shifts text to offx+1.
    const textCol = offx + 1;

    // The legend is a tty NHW_MENU window overlaying the already-drawn map.
    // With menu_overlay on (offx != 0/10) it does NOT clear the whole screen:
    // WIN_MESSAGE (row 0) is cleared, and each menu row clears columns
    // offx..end before writing.  So map content left of offx survives and
    // shows through; map content under the legend is erased.
    // C ref: wintty.c tty_display_nhwindow / process_text_window.
    const blankCols = (row) => {
        for (let c = offx; c < cols; c++) disp.setCell(c, row, ' ', NO_COLOR, 0);
    };
    for (let c = 0; c < cols; c++) disp.setCell(c, 0, ' ', NO_COLOR, 0); // WIN_MESSAGE

    const moreRow = lines.length; // row immediately after the last line
    for (let i = 0; i < lines.length; i++) {
        blankCols(i);
        if (lines[i]) disp.putstr(textCol, i, lines[i], NO_COLOR, 0);
    }
    blankCols(moreRow);
    disp.putstr(textCol, moreRow, '--More--', NO_COLOR, 0);
    disp.setCursor(textCol + 8, moreRow);

    await nhgetch();
}
