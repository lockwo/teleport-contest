// input.js — Keystroke input handling.
// Provides async nhgetch() that reads from an input queue.

import { game } from './gstate.js';
import { KEY_BINDINGS } from './terminal.js';

const _inputQueue = [];

export function pushKey(key) {
    _inputQueue.push(typeof key === 'number' ? key : key.charCodeAt(0));
}

export function pushKeys(keys) {
    for (const k of keys) pushKey(k);
}

// C ref: tty_nhgetch — read one key.
// In replay mode, reads from the input queue.
// In browser mode, waits for a real keypress.
export async function nhgetch() {
    // C ref: win/tty/wintty.c tty_nhgetch() — `wins[WIN_MESSAGE]->flags &=
    // ~WIN_STOP;` unconditionally, before reading anything.  WIN_STOP (set by
    // topl_more_ext when a --More-- is dismissed with ESC, suppressing further
    // topline messages until acknowledged) only survives until the very next
    // keystroke read for ANY purpose; only more()'s own post-read ESC check
    // re-arms it.  Clearing it here (the one low-level read every nhgetch/
    // xwaitforspace call funnels through) makes that survive-one-read window
    // exact without threading the flag through every prompt call site.
    game._winStop = false;
    // C ref: win/tty/wintty.c tty_nhgetch():4099-4101 — `if (ttyDisplay->toplin
    // == TOPLINE_NEED_MORE) ttyDisplay->toplin = TOPLINE_NON_EMPTY;`.  An owed
    // --More-- survives only until the very next key read, for ANY purpose;
    // _yn_need_more is that NEED_MORE as tty_yn_function's `more()` gate sees
    // it (y_n / topline_query both test it before their own nhgetch, so a
    // "pline then prompt in one command" site still pages).  Without the
    // demotion a setter whose command never reaches a prompt left it armed
    // indefinitely and the next unrelated getobj opened with a bare "--More--".
    game._yn_need_more = false;
    // Fire the capture hook before reading the next key
    const hook = game._preNhgetchHook;
    if (hook) await hook();

    if (_inputQueue.length > 0) {
        return _inputQueue.shift();
    }

    // Browser mode: wait for keypress from the display
    const display = game?.nhDisplay;
    if (display?.readKey) {
        return await display.readKey({ bindings: KEY_BINDINGS.VI_KEYS });
    }

    throw new Error('Input queue empty - test may be missing keystrokes');
}

// Reset input state
export function resetInputState() {
    _inputQueue.length = 0;
}
