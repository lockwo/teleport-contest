// pline.js — port of src/pline.c (the topline/message plumbing).
//
// INERT BY DESIGN.  Nothing in js/ imports this module.  Every function here is
// a translation of its C counterpart and none of them draws RNG, so wiring one
// up cannot reorder the shared draw stream by itself — but WHEN a message is
// emitted decides which frame a --More-- freezes, so a wiring pass must land
// one call site at a time under measurement.
//
// OVERLAP WITH THE LIVE PORT — read this before wiring anything up.
//
// There are TWO topline writers in this port and C has one (vpline):
//     js/display.js:2631  pline(msg)        — sets game._pending_message
//     js/display.js:2836  update_topl(bp)   — the topl.c-side writer
// Swapping them GLOBALLY measured -341.  Per-call-site swaps are a repeatable
// small win.  So `vpline()` below is the faithful body, not a drop-in for
// either one: routing display.js's pline() through it is a measured change,
// not a refactor.
//
// Names deliberately NOT redefined here (the tree keeps one definition each):
//     pline()      -> js/display.js:2631
//     impossible() -> js/display.js:2660      (nhassert_failed() calls it)
//     set_msg_xy() -> js/hack.js:3541         (a no-op stub there)
//     verbalize(), Norep(), You*(), pline_The(), pline_mon(), livelog_printf()
//                  -> already live in their callers' modules.
//
// THE INTERFACE LAYER IS STUBBED, as in js/topten.js: this module owns no
// window state.  Each stub names the live export a wiring pass must swap in:
//     putstr()           -> frozen/terminal.js via js/display.js
//     raw_print()        -> js/options.js:602
//     display_nhwindow() -> js/botl.js:2416 (tty_display_nhwindow)
//     msgtype_type()     -> js/options.js:2951  (exported)
//     flush_screen()     -> js/display.js:2578  (exported, async)
//     vision_recalc()    -> js/vision.js:633    (exported)
//     livelog_add()      -> js/livelog.js
// Only the stub bodies change; the control flow below is C's.

// global.h:389 BUFSZ; pline.c:8 BIGBUFSZ.
const BUFSZ = 256;
const BIGBUFSZ = 5 * BUFSZ;
const QBUFSZ = 128;

// config.h:737 — DUMPLOG_CORE is defined in this build (config.h:718) and
// CHRONICLE is defined (config.h:660), so dumplogmsg() runs from vpline() and
// gamelog_add() is the real list-appending version, not the empty stub.
const DUMPLOG_MSG_COUNT = 50;

// hack.h:1375-1381 gp.pline_flags bits.
export const PLINE_NOREPEAT = 1;
export const OVERRIDE_MSGTYPE = 2;
export const SUPPRESS_HISTORY = 4;
export const URGENT_MESSAGE = 8;
export const PLINE_VERBALIZE = 16;
export const PLINE_SPEECH = 32;
export const NO_CURS_ON_U = 64;

// hack.h:721-724 msgtype_type() results.
const MSGTYP_NORMAL = 0;
const MSGTYP_NOREP = 1;
const MSGTYP_NOSHOW = 2;
const MSGTYP_STOP = 3;

// wintype.h:128,137,138 putstr() attributes.
const ATR_NONE = 0;
const ATR_URGENT = 16;
const ATR_NOHISTORY = 32;

// winprocs.h:257,259 wincap2 bits.  win/tty/wintty.c:119 sets BOTH in the tty
// window port's wincap2, so putmesg()'s two `attr |=` arms are both live.
const WC2_URGENT_MESG = 0x4000;
const WC2_SUPPRESS_HIST = 0x8000;

// flag.h:177,180 iflags.getpos_coords values used by vpline()'s a11y prefix.
const GPCOORDS_NONE = 'n';
const GPCOORDS_COMFULL = 'f';

// wintype.h — the message window handle.
const WIN_MESSAGE = 1;

// hack.h:640,652,655 + decl.c:77-78.  set_msg_dir() indexes these with a
// direction code; N_DIRS_Z is 10 (8 compass + up + down).
const DIR_ERR = -1;
const N_DIRS_Z = 10;
const xdir = [-1, -1, 0, 1, 1, 1, 0, -1, 0, 0];
const ydir = [0, -1, -1, -1, 0, 1, 1, 1, 0, 0];

// ---------------------------------------------------------------------------
// C globals this file reads/writes, as their own objects so a wiring pass can
// repoint them at the live state instead of editing every body.  The live
// equivalents that already exist:
//   gp.prevmsg   -> game._prevmsg      (js/display.js msgtype_suppressed)
//   iflags.last_msg, iflags.window_inited, program_state.* — not modelled yet.
// ---------------------------------------------------------------------------

/* decl.c gs — saved_plines[] is the DUMPLOG_CORE message ring. */
export const gs = {
    saved_plines: new Array(DUMPLOG_MSG_COUNT).fill(null),
    saved_pline_index: 0,
};
/* decl.c gp */
export const gp = {
    pline_flags: 0,
    prevmsg: '',
};
/* decl.c gy — the You()/Your()/verbalize() prefix scratch buffer. */
export const gy = {
    you_buf: null,
    you_buf_siz: 0,
};
/* decl.c gg — the CHRONICLE game log, a singly linked list in C. */
export const gg = {
    gamelog: null,
};
/* decl.c ge */
export const ge = {
    early_raw_messages: 0,
};
/* decl.c a11y (accessibility): msg_loc is consumed and cleared by vpline(). */
export const a11y = {
    accessiblemsg: false,
    msg_loc: { x: 0, y: 0 },
};
/* flag.h iflags — only the fields pline.c touches. */
export const iflags = {
    debug_prevent_pline: false,
    window_inited: false,
    last_msg: 0,            /* PLNMSG_UNKNOWN == 0 */
    getpos_coords: GPCOORDS_NONE,
    debug_fuzzer: 0,
    sanity_check: false,
};
/* decl.c program_state — the guards vpline()/raw_printf()/impossible() read. */
export const program_state = {
    done_hup: false,
    wizkit_wishing: false,
    beyond_savefile_load: false,
    in_impossible: 0,
    in_sanity_check: 0,
    something_worth_saving: 0,
};
/* winprocs.c windowprocs — putmesg() only reads wincap2. */
export const windowprocs = {
    wincap2: WC2_URGENT_MESG | WC2_SUPPRESS_HIST,   /* win/tty/wintty.c:119 */
};
/* sys.c sysopt — execplinehandler() only reads msghandler.  The recorder's
   sys/unix/sysconf:37 leaves MSGHANDLER commented out, so it is NULL and
   execplinehandler() returns at its first guard for every message. */
export const sysopt = {
    msghandler: null,
};

// ---------------------------------------------------------------------------
// Interface layer — stubs.  See the header for the live export each maps to.
// ---------------------------------------------------------------------------

function putstr(_win, _attr, _line) { /* frozen/terminal.js via display.js */ }
function raw_print(_line) { /* js/options.js:602 */ }
function display_nhwindow(_win, _blocking) { /* js/botl.js:2416 */ }
function msgtype_type(_line, _norep) { return MSGTYP_NORMAL; } /* options.js:2951 */
function flush_screen(_cursor_on_u) { /* js/display.js:2578 */ }
function vision_recalc(_control) { /* js/vision.js:633 */ }
function livelog_add(_ll_type, _line) { /* js/livelog.js */ }
function paniclog(_type, _line) { /* files.c; no filesystem in this port */ }
function panic(_fmt) { throw new Error('panic'); }
function impossible(_fmt) { /* js/display.js:2660 */ }
function isok(x, y) { return x >= 1 && x < 80 && y >= 0 && y < 21; } /* hack.h */

// getpos.c coord_desc(x, y, outbuf, cmode) — only the GPCOORDS_COMFULL form is
// reachable from vpline() (GPCOORDS_NONE is remapped by the caller), which is
// "<col>,<row> (<dx>,<dy> from hero)".  Stubbed: js/ has no coord_desc yet.
function coord_desc(x, y, _buf, _cmode) { return `(${x},${y})`; }

// cmd.c:3858 dirtocoord(cc, dd) — writes the direction's unit delta into cc.
// Out-of-range dd leaves cc alone, which is why set_msg_dir() can be called
// with DIR_ERR and simply lands on the hero's own square.
function dirtocoord(cc, dd) {
    if (dd > DIR_ERR && dd < N_DIRS_Z) {
        cc.x = xdir[dd];
        cc.y = ydir[dd];
    }
}

// hacklib.c dupstr() — C allocates; JS strings are values.
function dupstr(s) { return String(s); }

// libc vsnprintf(), which pline.c leans on for every '%' format.  Stand-in
// covering the conversions NetHack's format strings actually use; returns the
// formatted text.  Callers that need C's return value (the number of characters
// ATTEMPTED, which is what vpline()'s overflow check tests) use .length, since
// this stand-in never truncates.
function vsnprintf(fmt, args) {
    let ai = 0;
    return String(fmt).replace(
        /%(-)?(\d+|\*)?(?:\.(\d+|\*))?(?:hh|h|ll|l|z)?([diouxXcspf%])/g,
        (_m, left, width, prec, conv) => {
            if (conv === '%') return '%';
            if (width === '*') width = args[ai++];
            if (prec === '*') prec = args[ai++];
            const a = args[ai++];
            let out;
            switch (conv) {
            case 'd': case 'i': out = String(Math.trunc(Number(a) || 0)); break;
            case 'u': out = String(Math.abs(Math.trunc(Number(a) || 0))); break;
            case 'o': out = (Math.trunc(Number(a) || 0) >>> 0).toString(8); break;
            case 'x': out = (Math.trunc(Number(a) || 0) >>> 0).toString(16); break;
            case 'X': out = (Math.trunc(Number(a) || 0) >>> 0).toString(16).toUpperCase(); break;
            case 'c': out = typeof a === 'number' ? String.fromCharCode(a) : String(a); break;
            case 'f': out = Number(a || 0).toFixed(prec === undefined ? 6 : Number(prec)); break;
            case 'p': out = String(a); break;
            default:  out = a === undefined || a === null ? '' : String(a); break;
            }
            if (conv === 's' && prec !== undefined) out = out.slice(0, Number(prec));
            const w = width === undefined ? 0 : Number(width);
            if (out.length < w) out = left ? out.padEnd(w, ' ') : out.padStart(w, ' ');
            return out;
        });
}

// ---------------------------------------------------------------------------
// pline.c
// ---------------------------------------------------------------------------

// C ref: pline.c:21 — keep the most recent DUMPLOG_MSG_COUNT messages.  The
// realloc-vs-Strcpy branch is a C allocation detail with no JS analogue, but
// the "Unknown command" filter and the ring index update are behaviour.
export function dumplogmsg(line) {
    const indx = gs.saved_pline_index;             /* next slot to use */
    const oldest = gs.saved_plines[indx];          /* current content of that slot */

    if (String(line).slice(0, 15) === 'Unknown command')
        return;
    if (oldest && oldest.length >= String(line).length) {
        gs.saved_plines[indx] = String(line);      /* C: Strcpy(oldest, line) */
    } else {
        gs.saved_plines[indx] = dupstr(line);
    }
    gs.saved_pline_index = (indx + 1) % DUMPLOG_MSG_COUNT;
}

// C ref: pline.c:51 — called during save; end-of-game releases saved_plines[]
// while writing them to the dump log.  js/save.js:1184 records this as UNPORTED.
export function dumplogfreemessages() {
    for (let i = 0; i < DUMPLOG_MSG_COUNT; ++i)
        if (gs.saved_plines[i])
            gs.saved_plines[i] = 0;
    gs.saved_pline_index = 0;
}

// C ref: pline.c:64 — keeps windowprocs usage out of pline().  The two attr
// bits are both live in the tty port (wintty.c:119 sets both wincap2 bits), so
// an URGENT_MESSAGE really does reach putstr() as ATR_URGENT — that is what
// re-enables messages after an ESC'd --More--.
export function putmesg(line) {
    let attr = ATR_NONE;

    if (iflags.debug_prevent_pline)
        return;

    if ((gp.pline_flags & URGENT_MESSAGE) !== 0
        && (windowprocs.wincap2 & WC2_URGENT_MESG) !== 0)
        attr |= ATR_URGENT;
    if ((gp.pline_flags & SUPPRESS_HISTORY) !== 0
        && (windowprocs.wincap2 & WC2_SUPPRESS_HIST) !== 0)
        attr |= ATR_NOHISTORY;
    putstr(WIN_MESSAGE, attr, line);
    /* SoundSpeak(line) — sndprocs.h:275 makes this a no-op without SND_SPEECH */
}

// C ref: pline.c:83 — set the direction where the next message happens.  Note
// the hero offset is added AFTER dirtocoord(), so msg_loc ends up absolute.
export function set_msg_dir(dir, u = { ux: 0, uy: 0 }) {
    dirtocoord(a11y.msg_loc, dir);
    a11y.msg_loc.x += u.ux;
    a11y.msg_loc.y += u.uy;
}

// C ref: pline.c:113 — pline() with a direction attached.  The va_list is
// modelled as a trailing array of printf arguments.
export function pline_dir(dir, line, ...the_args) {
    set_msg_dir(dir);
    vpline(line, the_args);
}

// C ref: pline.c:125 — pline() with an absolute square attached.  set_msg_xy()
// lives at js/hack.js:3541 (a no-op stub); assign directly so this module does
// not add a second definition of that name.
export function pline_xy(x, y, line, ...the_args) {
    a11y.msg_loc.x = x;                 /* set_msg_xy(x, y) */
    a11y.msg_loc.y = y;
    vpline(line, the_args);
}

// C's `static int in_pline` inside vpline() — recursion depth.
let in_pline = 0;

// C ref: pline.c:152 — the single topline writer.  See the module header: this
// port has TWO (display.js pline() and update_topl()), and swapping them
// globally measured -341, so this body is NOT a drop-in for either.
export function vpline(line, the_args = []) {
    let pbuf;                       /* char pbuf[BIGBUFSZ] */
    let ln;
    let msgtyp;
    let no_repeat;

    const a11y_mesgxy = { x: a11y.msg_loc.x, y: a11y.msg_loc.y };
    /* always reset a11y.msg_loc whether we end up using it or not */
    a11y.msg_loc.x = a11y.msg_loc.y = 0;

    if (!line || !String(line).length)
        return;
    /* global.h:278 defines HANGUPHANDLING */
    if (program_state.done_hup)
        return;
    if (program_state.wizkit_wishing)
        return;

    /* when accessiblemsg is set and a11y.msg_loc is nonzero, use the latter
       to insert a location prefix in front of current message */
    if (a11y.accessiblemsg && isok(a11y_mesgxy.x, a11y_mesgxy.y)) {
        const dirstrbuf = new Array(QBUFSZ);
        const dirstr = coord_desc(a11y_mesgxy.x, a11y_mesgxy.y, dirstrbuf,
                                  ((iflags.getpos_coords === GPCOORDS_NONE)
                                   ? GPCOORDS_COMFULL : iflags.getpos_coords));
        vpline(`${dirstr}: ${line}`, the_args);
        return;
    }

    if (!String(line).includes('%')) {
        /* format does not specify any substitutions; use it as-is */
        ln = String(line).length;
    } else if (String(line) === '%s') {
        /* "%s" => single string; skip format and use its first argument */
        line = the_args[0];
        ln = String(line).length;
    } else {
        /* perform printf() formatting */
        pbuf = vsnprintf(line, the_args);
        ln = pbuf.length;
        line = pbuf;
        /* note: 'ln' is number of characters attempted, not necessarily
           strlen(line); that matters for the overflow check */
    }
    if (ln > BIGBUFSZ - 1) /* extremely too long */
        panic(`pline attempting to print ${ln} characters!`);

    if (ln > BUFSZ - 1) {
        /* too long but modestly so; allow but truncate, preserving final
           3 chars: "___ extremely long text" -> "___ extremely l...ext".
           C writes '.' into pbuf[249..251] and line[ln-3..ln-1] into
           pbuf[252..254], then NUL-terminates at pbuf[255]; the result is
           the first 249 characters, "...", and the last 3. */
        const src = String(line);
        line = src.slice(0, BUFSZ - 1 - 6) + '...' + src.slice(ln - 3);
    }
    msgtyp = MSGTYP_NORMAL;

    /* DUMPLOG_CORE: hook here early to have options-agnostic output.  Norep()
       isn't honoured (general issue) and short lines aren't combined. */
    if ((gp.pline_flags & SUPPRESS_HISTORY) === 0)
        dumplogmsg(line);

    /* use raw_print() if we're called too early (or perhaps too late during
       shutdown) or if we're being called recursively */
    if (in_pline++ || !iflags.window_inited) {
        raw_print(line);
        iflags.last_msg = 0;                    /* PLNMSG_UNKNOWN */
        --in_pline;                             /* C: goto pline_done */
        return;
    }

    try {
        no_repeat = (gp.pline_flags & PLINE_NOREPEAT) ? true : false;
        if ((gp.pline_flags & OVERRIDE_MSGTYPE) === 0) {
            msgtyp = msgtype_type(line, no_repeat);
            if ((gp.pline_flags & URGENT_MESSAGE) === 0
                && (msgtyp === MSGTYP_NOSHOW
                    || (msgtyp === MSGTYP_NOREP && line === gp.prevmsg)))
                return;                         /* C: goto pline_done */
        }

        if (game_vision_full_recalc()) {
            const tmp_in_pline = in_pline;

            in_pline = 0;
            vision_recalc(0);
            in_pline = tmp_in_pline;
        }
        if (hero_ux())
            flush_screen((gp.pline_flags & NO_CURS_ON_U) ? 0 : 1); /* %% */

        putmesg(line);

        execplinehandler(line);

        /* this gets cleared after every pline message */
        iflags.last_msg = 0;                    /* PLNMSG_UNKNOWN */
        gp.prevmsg = String(line).slice(0, BUFSZ - 1);
        if (msgtyp === MSGTYP_STOP)
            display_nhwindow(WIN_MESSAGE, true); /* --more-- */
    } finally {
        /* SND_SPEECH is not defined, so the PLINE_SPEECH clear is compiled out */
        --in_pline;
    }
}

/* vpline() reads two pieces of live game state.  Kept behind accessors so
   wiring this module up is an edit here, not in the body: gv.vision_full_recalc
   is game.vision_full_recalc (js/display.js:2607) and u.ux gates flush_screen's
   cursor placement. */
function game_vision_full_recalc() { return false; }
function hero_ux() { return 0; }

// C ref: pline.c:298 — pline() variant which can override MSGTYPE handling or
// suppress message history (the tty interface issues prompts through pline()
// and they must not be blockable via MSGTYPE=hide).
export function custompline(pflags, line, ...the_args) {
    gp.pline_flags = pflags;
    vpline(line, the_args);
    gp.pline_flags = 0;
}

// C ref: pline.c:314 — if the player dismissed --More-- with ESC to suppress
// further messages until the next input request, tell the interface to override
// that.  Equivalent to custompline(URGENT_MESSAGE, ...).
export function urgent_pline(line, ...the_args) {
    gp.pline_flags = URGENT_MESSAGE;
    vpline(line, the_args);
    gp.pline_flags = 0;
}

// C ref: pline.c:338 You_buf(siz) — grows the shared You()/Your()/verbalize()
// prefix buffer.  Private in C; kept here because free_youbuf() is its pair.
function You_buf(siz) {
    if (siz > gy.you_buf_siz) {
        gy.you_buf_siz = siz + 10;
        gy.you_buf = '';
    }
    return gy.you_buf;
}

// C ref: pline.c:350 — release the You_buf() scratch buffer (called from
// freedynamicdata()).  js/save.js:1135 records this as unported.
export function free_youbuf() {
    if (gy.you_buf)
        gy.you_buf = null;
    gy.you_buf_siz = 0;
}

// C ref: pline.c:494 — CHRONICLE is defined in this build, so this is the real
// list-appending version (the pline.c:530 empty stub is compiled out).  C walks
// to the tail on every call; the JS array append is the same ordering.
// js/livelog.js already holds the livelog_printf() half of this pair.
export function gamelog_add(glflags, gltime, str) {
    const tmp = {
        turn: gltime,
        flags: glflags,
        text: dupstr(str),
        next: null,
    };
    let lst = gg.gamelog;
    while (lst && lst.next)
        lst = lst.next;
    if (!lst)
        gg.gamelog = tmp;
    else
        lst.next = tmp;
    return tmp;
}

// C ref: pline.c:548 — raw_printf() bumps early_raw_messages, and so does
// vraw_printf() below.  That double count is what C does; transcribed verbatim.
export function raw_printf(line, ...the_args) {
    vraw_printf(line, the_args);
    if (!program_state.beyond_savefile_load)
        ge.early_raw_messages++;
}

// C ref: pline.c:562 — unlike vpline(), no attempt to keep the last few chars.
export function vraw_printf(line, the_args = []) {
    let pbuf = null;

    if (String(line).includes('%')) {
        pbuf = vsnprintf(line, the_args);
        line = pbuf;
    }
    if (String(line).length > BUFSZ - 1) {
        /* C: strncpy into pbuf then pbuf[BUFSZ-1] = '\0' — plain truncation */
        line = String(line).slice(0, BUFSZ - 1);
    }
    raw_print(line);
    execplinehandler(line);
    if (!program_state.beyond_savefile_load)
        ge.early_raw_messages++;
}

/* pline.c:638 — cleared for good once a fork fails. */
let use_pline_handler = true;

// C ref: pline.c:640 — hand every message to sysopt.msghandler.  UNIX build, so
// C forks/execs the handler and waitpid()s for it.  There is no fork in JS and
// the recorder's sysconf leaves MSGHANDLER commented out, so the first guard
// returns for every message in every recorded session; the fork body is
// documented rather than emulated.
export function execplinehandler(line) {
    if (!use_pline_handler || !sysopt.msghandler)
        return;

    /* C: args[] = { sysopt.msghandler, line, NULL }; fork(); child setgid/
       setuid then execv(args[0], args), parent waitpid()s.  On fork() == -1 C
       clears use_pline_handler and plines "Fork to message handler failed."
       Treated as the #else arm (no fork available): clear the flag once. */
    use_pline_handler = false;
    return line;
}

// C ref: pline.c:689 — called when an nhassert's condition is false.  Reduces
// the path to a bare filename (both separators, because the VMS arm is compiled
// out here) and hands it to impossible() (js/display.js:2660).
export function nhassert_failed(expression, filepath, line) {
    let filename = String(filepath);
    let p;

    if ((p = filename.lastIndexOf('/')) >= 0)
        filename = filename.slice(p + 1);
    if ((p = filename.lastIndexOf('\\')) >= 0)
        filename = filename.slice(p + 1);

    impossible(`nhassert(${expression}) failed in file '${filename}' at line ${line}`);
}

/*pline.js*/
