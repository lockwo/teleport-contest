// rawprint.js - cursor bookkeeping shared by the raw_print() paths that run
// after the tty windows are gone (end.js topten() output, panic.js).
import { game } from './gstate.js';

// C ref: termcap.c nomux_raw_putch() — once an rc error has put the recorder's
// raw writer in play (game._nomux_raw, never cleared) the topten() raw_print()s
// land that many rows further down: bl019 (cursor frozen at row 1) records the
// "score list will not be checked" line on row 3 and ends with the cursor on
// row 6, i.e. both shifted by raw.row + 1 against the home-cursor layout.
export function rawPrintBias() {
    return game._nomux_raw ? game._nomux_raw.row + 1 : 0;
}
// Park the cursor after the final raw_print()s; the captured cursor of a
// raw-writer session is the writer's own row/col, so advance that too.
export function setFinalCursor(disp, row) {
    disp.setCursor(0, row);
    if (game._nomux_raw) game._nomux_raw = { row, col: 0 };
}
