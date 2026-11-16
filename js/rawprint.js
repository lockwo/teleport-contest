// rawprint.js - cursor bookkeeping shared by the raw_print() paths that run
// after the tty windows are gone (end.js topten() output, panic.js).
import { game } from './gstate.js';

// C ref: tty_exit_nhwindows() calls nomux_reset_raw_mode() after suspending
// the terminal, before topten() starts a new raw-output stream.
export function resetRawPrint() {
    delete game._nomux_raw;
}

// Before teardown, raw output continues from the startup-error cursor.
export function rawPrintBias() {
    return game._nomux_raw ? game._nomux_raw.row + 1 : 0;
}
// Park the cursor after the final raw_print()s; the captured cursor of a
// raw-writer session is the writer's own row/col, so advance that too.
export function setFinalCursor(disp, row) {
    disp.setCursor(0, row);
    if (game._nomux_raw) game._nomux_raw = { row, col: 0 };
}
