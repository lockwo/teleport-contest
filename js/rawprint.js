// Raw capture follows the no-reset reference recorder, termcap.c:880-960.
import { game } from './gstate.js';
import { NO_COLOR } from './terminal.js';

export function raw_print(disp, text, attr = 0, ttyAlive = true) {
    text = String(text ?? '');
    if (!game._nomux_raw) {
        if (ttyAlive && !text) return;
        disp?.clearScreen();
        game._nomux_raw = { row: 0, col: 0 };
    }
    const raw = game._nomux_raw;
    for (const line of text.split('\n')) {
        raw_putstr(disp, raw.row, line, NO_COLOR, attr);
        raw.row++;
        raw.col = 0;
    }
    disp?.setCursor(0, raw.row);
}

// tty_suspend_nhwindows(NULL) emits one empty line if raw mode is active.
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
