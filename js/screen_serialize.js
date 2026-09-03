// screen_serialize.js — our own Terminal-grid serializer, replacing the
// frozen js/terminal.js Terminal.serialize() at the two jsmain.js capture
// sites. docs/API.md permits this: "If you implement your own terminal,
// output anything that -- after canonicalization -- matches the recorded
// screen."
//
// Bug being fixed: frozen serialize() finds a row's [firstCol, lastCol]
// span using ONLY `ch !== ' '` as the "meaningful" test, then (a) collapses
// every column left of firstCol to plain spaces / an ESC[NC skip, (b) never
// emits anything right of lastCol, and (c) drops an entire row that has no
// non-space glyph. All three paths silently discard SGR state (inverse /
// underline) that was set on a blank cell — e.g. an inverse-video menu
// section heading like " General" padded with inverse spaces. The judge's
// decodeScreen() (frozen/screen-decode.mjs) DOES track attr/color on space
// cells, so those bytes are unrecoverable once dropped.
//
// Fix: widen the "meaningful" test to `ch !== ' ' || attr !== 0`, which
// pulls attributed blanks into the emitted span (and into lastRow). The
// per-cell body of the span loop is otherwise byte-for-byte identical to
// frozen/terminal.js's serialize(), so every screen the old path already
// rendered correctly keeps decoding to the exact same grid — see
// swarm/bin/verify-screen-serialize.mjs for the round-trip proof.

const DEFAULT_FG = 39;

function colorToFg(color) {
    if (color === 8 || color < 0 || color > 15) return DEFAULT_FG;
    return color < 8 ? 30 + color : 90 + (color - 8);
}

// Identical transition logic to frozen/terminal.js's inline sgrTransition —
// reimplemented here (not imported: the frozen copy is a closure private to
// Terminal.serialize(), not an exported function).
function sgrTransition(curFg, curAttr, wantFg, wantAttr) {
    if (curFg === wantFg && curAttr === wantAttr) return '';
    const wantBold = (wantAttr & 2) !== 0;
    const wantUnder = (wantAttr & 4) !== 0;
    const wantInv = (wantAttr & 1) !== 0;
    const curBold = (curAttr & 2) !== 0;
    const curUnder = (curAttr & 4) !== 0;
    const curInv = (curAttr & 1) !== 0;
    const needReset = (curBold && !wantBold) || (curUnder && !wantUnder) || (curInv && !wantInv);
    const codes = [];
    if (needReset) {
        codes.push(0);
        if (wantBold) codes.push(1);
        if (wantUnder) codes.push(4);
        if (wantInv) codes.push(7);
        if (wantFg !== 39) codes.push(wantFg);
    } else {
        if (wantBold && !curBold) codes.push(1);
        if (wantUnder && !curUnder) codes.push(4);
        if (wantInv && !curInv) codes.push(7);
        if (wantFg !== curFg) codes.push(wantFg);
    }
    return codes.length ? `\x1b[${codes.join(';')}m` : '';
}

// A cell that decodeScreen()'s blank grid already represents with no bytes
// at all: a space with no attribute. (Its `color` field is irrelevant here
// — screen-decode.mjs's diffCell()/observableState() only reads color on a
// space when an attr bit is set, and frozen serialize() likewise never
// bothered emitting color for an attr===0 space; we match that so a cell
// nobody ever wrote to keeps decoding to the same {color:8,attr:0} default
// on both the old and new path.)
function isMeaningful(cell) {
    return cell.ch !== ' ' || (cell.attr | 0) !== 0;
}

function rowLastMeaningfulCol(term, r) {
    for (let c = term.cols - 1; c >= 0; c--) {
        if (isMeaningful(term.grid[r][c])) return c;
    }
    return -1;
}

function rowFirstMeaningfulCol(term, r, lastCol) {
    for (let c = 0; c <= lastCol; c++) {
        if (isMeaningful(term.grid[r][c])) return c;
    }
    return 0;
}

/**
 * Serialize a Terminal's grid to the same wire format frozen serialize()
 * uses (rows separated by '\n', SGR transitions before runs, ESC[NC to
 * skip default-cell columns), except it never loses attr/color on a blank
 * cell — the emitted span per row is bounded by the first/last column that
 * is EITHER a glyph OR carries a non-zero attr, not glyph-only.
 */
export function serializeGrid(term) {
    let lastRow = 0;
    for (let r = 0; r < term.rows; r++) {
        if (rowLastMeaningfulCol(term, r) >= 0) lastRow = r;
    }

    let out = '';
    let curFg = DEFAULT_FG, curAttr = 0;
    for (let r = 0; r <= lastRow; r++) {
        const lastCol = rowLastMeaningfulCol(term, r);
        if (lastCol < 0) {
            if (r < lastRow) out += '\n';
            continue;
        }
        const firstCol = rowFirstMeaningfulCol(term, r, lastCol);
        // curFg/curAttr are always (39, 0) here — reset at the end of every
        // previously emitted row, and decodeScreen() starts in that same
        // state — so an ESC[NC skip never needs an SGR reset first, and
        // never touches a cell (decodeScreen only writes the grid on a
        // literal printable byte), leaving the skipped columns at their
        // default-initialized {ch:' ', color:8, attr:0}.
        if (firstCol > 0) out += `\x1b[${firstCol}C`;
        for (let c = firstCol; c <= lastCol; c++) {
            const cell = term.grid[r][c];
            const wantFg = colorToFg(cell.color);
            const wantAttr = cell.attr | 0;
            out += sgrTransition(curFg, curAttr, wantFg, wantAttr);
            curFg = wantFg;
            curAttr = wantAttr;
            out += cell.ch;
        }
        out += sgrTransition(curFg, curAttr, DEFAULT_FG, 0);
        curFg = DEFAULT_FG;
        curAttr = 0;
        if (r < lastRow) out += '\n';
    }
    return out;
}
