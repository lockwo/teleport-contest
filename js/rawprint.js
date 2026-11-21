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

// C ref: 006-nomux-capture.patch nomux_raw_putch(): raw output keeps every
// byte >= 32 (control bytes are dropped without advancing), and the harness
// decodes the captured row as UTF-8, so a multibyte name takes one cell per
// decoded character.  Window text (nomux_putch) instead drops high bytes.
export function raw_putstr(disp, row, text, color, attr) {
    const bytes = [];
    for (const ch of String(text)) {
        const c = ch.codePointAt(0);
        if (c < 32) continue;
        if (c <= 0xff) bytes.push(c);
        else bytes.push(...new TextEncoder().encode(ch));
    }
    let col = 0;
    for (const ch of new TextDecoder('utf-8').decode(Uint8Array.from(bytes))) {
        if (col >= (disp.cols ?? 80)) break;
        disp.setCell(col++, row, ch, color, attr);
    }
}
