// input.js — Keystroke input handling.
// Provides async nhgetch() that reads from an input queue.

import { game, hooks } from './gstate.js';
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
    // C ref: vision.c vision_recalc() tail notice_all_mons(): announcements
    // queued by the synchronous vision code print before the hero is asked for input.
    if (game._noticeQueue?.length) await hooks.flushNotices(true);
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

    // C ref: wintty.c tty_nhgetch() — `if (!i) i = '\033'`: NUL is read as ESC.
    // C tty_nhgetch() folds carriage return into line feed before any command
    // or prompt sees the key. Replay input may retain the raw CR code.
    if (_inputQueue.length > 0) {
        const k = _inputQueue.shift();
        return k === 0 ? 27 : k === 13 ? 10 : k;
    }

    // Browser mode: wait for keypress from the display
    const display = game?.nhDisplay;
    if (display?.readKey) {
        const k = await display.readKey({ bindings: KEY_BINDINGS.VI_KEYS });
        return k === 0 ? 27 : k === 13 ? 10 : k;
    }


    throw new Error('Input queue empty - test may be missing keystrokes');
}

// C ref: win/tty/getline.c xwaitforspace(quitchars) one-key test for a text
// window's dmore() (quitchars " \r\n\033"): space/return dismiss; ESC dismisses AND
// leaves ttyDisplay->dismiss_more == 1 (^A) behind, so a later ^A also dismisses
// a --More-- (`c == x`).  Any other key rings the bell and keeps waiting.
export function xwaitforspace_quit(c) {
    if (c === 13 || c === 10 || c === 32) return true;
    if (c === 27) { game._dismissMore = 1; return true; }
    return !!game._dismissMore && c === game._dismissMore;
}

// Reset input state
export function resetInputState() {
    _inputQueue.length = 0;
}
