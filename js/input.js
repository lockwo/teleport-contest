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
    // Fire the capture hook before reading the next key
    const hook = game._preNhgetchHook;
    if (hook) await hook();

    let k;
    if (_inputQueue.length > 0) {
        k = _inputQueue.shift();
    } else if (game.nhDisplay?.readKey) {
        k = await game.nhDisplay.readKey({ bindings: KEY_BINDINGS.VI_KEYS });
    } else {
        throw new Error('Input queue empty - test may be missing keystrokes');
    }

    // C tty_nhgetch acknowledges the topline after the input boundary.
    if (game._toplin === 1) game._toplin = 2;
    game._toplinSoft = null;
    game._yn_need_more = false;
    return k === 0 ? 27 : k === 13 ? 10 : k;
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

// C ref: getline.c xwaitforspace() on ANY wait it serves (a menu page, a --More--, a text
// window page): an ESC read there leaves ttyDisplay->dismiss_more == 1.  Menus themselves
// treat the ESC as their own cancel (or count-stop), so this only records the side effect
// that makes a later ^A dismiss a --More-- or text window page.  Returns its argument.
export function xwaitforspace_note(c) {
    if (c === 27) game._dismissMore = 1;
    return c;
}

// Reset input state
export function resetInputState() {
    _inputQueue.length = 0;
}
