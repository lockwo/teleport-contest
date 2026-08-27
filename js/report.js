// report.js — C ref: src/report.c.
//
// report.c is the crash/bug-report plumbing: it MD4-hashes its own binary into
// a "binary id", assembles a query-string URL out of a stack backtrace and the
// DUMPLOG message ring, hands that URL to a browser via fork/execve, and
// installs POSIX signal handlers so a fatal signal still produces a trace.
//
// Three of those four things have no JavaScript analogue, and report.c already
// has the code path for "the platform can't do it": crashreport_init() has a
// `skip:` label that leaves the binary id as "unknown", and submit_web_report()
// returns FALSE when no CRASHREPORTURL is configured.  The recorder's
// sys/unix/sysconf leaves CRASHREPORTURL unset (js/cfgfiles.js:182 keeps
// sysopt.crashreporturl NULL to match), so in the recorded builds
// submit_web_report() returns FALSE at its first guard and dobugreport()
// prints its fallback line — which is what this port reproduces.
//
// Everything that IS portable is ported verbatim: swr_add_uricoded()'s
// percent-encoder with its mark/rollback overflow semantics, the whole URL
// assembly order, and get_saved_pline()'s walk of the DUMPLOG ring (including
// C's spin-on-NULL-slot behaviour).  Nothing here draws RNG.

import { game } from './gstate.js';
import { ECMD_OK, DEVTEAM_URL } from './const.js';
import { sysopt } from './cfgfiles.js';
import { gs } from './pline.js';
import { version_string, getversionstring } from './version.js';

// C ref: config.h:737 DUMPLOG_MSG_COUNT (js/pline.js:45 keeps the same value).
const DUMPLOG_MSG_COUNT = 50;
// C ref: report.c:205,208 MAX_URL / SWR_FRAMES.
const MAX_URL = 8192, SWR_FRAMES = 20;

// C ref: report.c:110 `static char bid[40]` — the binary id.  Not a secret and
// trivially spoofed; contact.html only uses it as a hint.
let bid = '';
const BID_SIZE = 40;

// C ref: pline.c raw_print()/raw_printf().  js/options.js:602 and
// js/topten.js:335 each keep a local copy; this one appends to a module-level
// log so an inert caller can see what report.c would have printed.
export const report_raw_output = [];
function raw_print(str) { report_raw_output.push(String(str)); }

// ─── report.c:113 crashreport_init(argc, argv) ──────────────────────────────
// C hashes its own executable with MD4 and formats the digest as hex into
// bid[].  Every step that could fail does `goto skip`, which stores "unknown".
// A JS build has no argv[0] binary to open, so HASH_BINFILE() is exactly the
// step that fails; the faithful result is the skip path.  The `once` guard is
// real behaviour (NetHackW.exe calls this twice).
let crashreport_init_once = 0;
export function crashreport_init(argc, argv) {
    if (crashreport_init_once++)   /* NetHackW.exe calls us twice */
        return;
    // C: HASH_CONTEXTPTR / HASH_INIT / HASH_BINFILE().  There is no binary
    // path to readlink() or open() here, so HASH_BINFILE() takes `goto skip`.
    void argc; void argv;
    /* skip: */
    bid = 'unknown';
}

// ─── report.c:189 crashreport_bidshow() ────────────────────────────────────
export function crashreport_bidshow() {
    // C: `#if defined(WIN32) && !defined(WIN32CON)` wraps the raw_print in a
    // win32_cr_helper('D', ...) test; on every other platform it runs plainly.
    raw_print(bid);
}

// ─── report.c:237 swr_add_uricoded(in, out, remaining, markp) ──────────────
// Percent-encode `in` onto the end of the output buffer.  C threads a
// `char **out` write cursor and an `int *remaining` budget; this port models
// those two as single-field cells so the caller sees the same mutations.
//   out       - { s: string }   the accumulated buffer (C's *out cursor)
//   remaining - { v: number }   bytes left (C's *remaining)
//   markp     - number | null   index in out.s to roll back to on overflow
// Returns TRUE on overflow (C's caller then does `goto full`).
export function swr_add_uricoded(inStr, out, remaining, markp) {
    const src = String(inStr ?? '');
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (/[0-9A-Za-z]/.test(ch) || '_-.~'.includes(ch)) {
            out.s += ch;
            remaining.v--;
        } else if (ch === ' ') {
            out.s += '+';
            remaining.v--;
        } else {
            if (remaining.v <= 3) {
                if (markp != null) { out.s = out.s.slice(0, markp); remaining.v = 0; }
                return true;
            } else {
                /* C: Sprintf(chr, "%%%02X", *in) — uppercase hex, 2 digits */
                const chr = `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
                const x = chr.length;
                if (x <= remaining.v) {
                    out.s += chr;
                    remaining.v -= x;
                }
            }
        }
        if (!remaining.v) {
            if (markp != null) { out.s = out.s.slice(0, markp); remaining.v = 0; }
            return true;
        }
    }
    return false; /* normal return */
}

// C ref: report.c:110 the `url`/`urem`/`uend`/`mark` file statics.  `uend` is a
// write cursor into url[] in C; here the buffer object IS the cursor.
let swr_url = { s: '' };
let swr_urem = MAX_URL;
let swr_mark = 0;
// C ref: decl.c gc.crash_name / gc.crash_email / gc.crash_urlmax — set by
// options.c optfn_crash_name()/_email()/_urlmax(), which this port keeps on
// game.flags (js/options.js:1494 keep()).
function gc_crash_name() { return game.flags?.crash_name ?? null; }
function gc_crash_email() { return game.flags?.crash_email ?? null; }
function gc_crash_urlmax() {
    const v = game.flags?.crash_urlmax;
    return (v == null || v === '') ? -1 : (parseInt(v, 10) || 0);
}

// ─── report.c:290 submit_web_report(cos, msg, why) ─────────────────────────
// Build the report URL, then hand it to the platform's browser launcher.
// RNG-free.  Returns TRUE only when the launcher ran, so the JS build (which
// has no fork/execve and no CRASHREPORT helper) always returns FALSE — the same
// answer a C build compiled without CRASHREPORT gives, which is what makes
// dobugreport()'s fallback line the correct output here.
export function submit_web_report(cos, msg, why) {
    const urlmax = gc_crash_urlmax();
    swr_urem = (urlmax < 0 || urlmax > MAX_URL) ? MAX_URL : Math.min(MAX_URL, urlmax);
    swr_url = { s: '' };
    swr_mark = 0;
    let countpp = 0; /* pre and post traceback lines */

    // C ref: report.c:196 SWR_ADD(str) — plain append; on overflow it jumps to
    // `full:` (which in C still launches the truncated URL).
    let overflowed = false;
    const SWR_ADD = (str) => {
        const s = String(str ?? '');
        swr_mark = swr_url.s.length;
        if (s.length >= swr_urem) { overflowed = true; return true; }
        swr_url.s += s;
        swr_urem -= s.length;
        return false;
    };
    // C ref: report.c:222 SWR_ADD_URIcoded(str).
    const rem = { get v() { return swr_urem; }, set v(n) { swr_urem = n; } };
    const SWR_ADD_URI = (str) => {
        if (swr_add_uricoded(str, swr_url, rem, swr_mark)) { overflowed = true; return true; }
        return false;
    };

    //  URL loaded for creating reports to the NetHack DevTeam
    //  CRASHREPORTURL=https://nethack.org/links/cr-5.0.0.html
    if (!sysopt.crashreporturl)
        return false;

    full: {
        if (SWR_ADD(sysopt.crashreporturl)) break full;
        /* cos - operation, v - version */
        if (SWR_ADD(`?cos=${cos}&v=1`)) break full;

        /* msg==NULL for #bugreport */
        if (msg) {
            if (SWR_ADD('&subject=')) break full;
            if (SWR_ADD_URI(`${String(msg).slice(0, 40)} report for NetHack `
                            + `${String(version_string('', 200)).slice(0, 40)}`))
                break full;
        }

        if (SWR_ADD('&gitver=')) break full;
        if (SWR_ADD_URI(getversionstring('', 200))) break full;

        if (gc_crash_name()) {
            if (SWR_ADD('&name=')) break full;
            if (SWR_ADD_URI(gc_crash_name())) break full;
        }
        if (gc_crash_email()) {
            if (SWR_ADD('&email=')) break full;
            if (SWR_ADD_URI(gc_crash_email())) break full;
        }
        // hardware / software / comments: left for the user to fill in

        if (SWR_ADD('&details=')) break full;
        if (why) {
            if (SWR_ADD_URI(why)) break full;
            if (SWR_ADD_URI('\n')) break full;
            swr_mark = swr_url.s.length;
            countpp++;
        }

        if (SWR_ADD_URI('bid: ')) break full;
        if (SWR_ADD_URI(bid)) break full;
        if (SWR_ADD_URI('\n')) break full;
        swr_mark = swr_url.s.length;
        countpp++;

        let count = 0;
        if (cos === 1) {
            // GAP: execinfo.h backtrace()/backtrace_symbols() over SWR_FRAMES
            // frames.  A JS stack is available but its frames are not the C
            // ones, so emitting them would be inventing report content; C's
            // !PANICTRACE_LIBC build likewise contributes nothing here.
            void SWR_FRAMES;
            count = 0;
        }

        /* DUMPLOG_CORE: config.h turns this on */
        if (cos === 1) {
            if (SWR_ADD_URI('Latest messages:\n')) break full;
            swr_mark = swr_url.s.length;
            countpp++;
            for (let k = 0; k < 5; k++) {
                const line = get_saved_pline(k);
                if (!line) break;
                if (SWR_ADD_URI(line)) break full;
                if (SWR_ADD_URI('\n')) break full;
                countpp++;
                swr_mark = swr_url.s.length;
            }
        }

        // detailrows: Guess since we can't know the width of the window.
        if (SWR_ADD('&detailrows=')) break full;
        if (SWR_ADD_URI(String(Math.min(count + countpp, 30)))) break full;
    }
    void overflowed;   /* C's `full:` label falls straight into the launch */

    // GAP: the platform launch step — win32_cr_shellexecute(url) on Windows,
    // otherwise fork() + execve(CRASHREPORT, {CRASHREPORT, url}) and waitpid().
    // Neither exists here, so this is the "couldn't start the reporter" answer.
    return false;
}

// C ref: report.c the assembled URL, exposed so a caller (or a test) can see
// what submit_web_report() built without launching anything.
export function submit_web_report_url() { return swr_url.s; }

// ─── report.c:461 dobugreport() — the #bugreport command ───────────────────
export async function dobugreport() {
    if (!submit_web_report(2, null, '#bugreport command')) {
        const { pline } = await import('./display.js');
        await pline('Unable to send bug report.  Please visit '
            + `${(sysopt.crashreporturl && String(sysopt.crashreporturl).length)
                ? sysopt.crashreporturl : DEVTEAM_URL} instead.`);
    }
    return ECMD_OK;
}

// ─── report.c:571 get_saved_pline(lineno) ──────────────────────────────────
// lineno==0 gives the most recent message.  Transcribed verbatim, including
// two C quirks: with saved_pline_index==0 the starting `p` is -1 (C reads out
// of bounds, JS reads undefined — both fall into the "not a valid line" arm),
// and a NULL slot does NOT advance `p`, so the loop spins on it until `limit`
// runs out rather than skipping past it.
export function get_saved_pline(lineno) {
    let limit = DUMPLOG_MSG_COUNT;
    if (lineno >= DUMPLOG_MSG_COUNT)
        return null;
    let p = (gs.saved_pline_index - 1) % DUMPLOG_MSG_COUNT;

    while (limit--) {
        if (gs.saved_plines[p]) { /* valid line */
            if (lineno--) {
                p = (p - 1 + DUMPLOG_MSG_COUNT) % DUMPLOG_MSG_COUNT;
            } else {
                return gs.saved_plines[p];
            }
        }
    }
    return null;
}

// ─── report.c:600 panictrace_handler(sig) ──────────────────────────────────
// Called as a signal() handler, so it is passed at least one argument.
export function panictrace_handler(_sig_unused) {
    const SIG_MSG = '\nSignal received.\n';
    // C: the CURSES_GRAPHICS block calls curses_uncurse_terminal() first so the
    // backtrace isn't scrawled over the map.  This port has no curses window.
    // C: write(2, SIG_MSG, sizeof SIG_MSG - 1) — straight to stderr, not via
    // any window port, because the window system may already be gone.
    raw_print(SIG_MSG);
    // GAP: NH_abort(NULL) (unixmain.c) — dumps a trace and aborts the process.
    // Nothing in this port aborts, so control simply returns.
}

// ─── report.c:625 panictrace_setsignals(set) ──────────────────────────────
// Install panictrace_handler for every fatal signal the build has, or restore
// SIG_DFL.  The table is C's #ifdef ladder in its source order.
const PANICTRACE_SIGNALS = [
    ['SIGILL', 4], ['SIGTRAP', 5], ['SIGIOT', 6], ['SIGBUS', 10],
    ['SIGFPE', 8], ['SIGSEGV', 11], ['SIGSTKFLT', 16], ['SIGSYS', 12],
    ['SIGEMT', 7],
];
export const panictrace_installed = new Map();
export function panictrace_setsignals(set) {
    // C: SETSIGNAL(sig) => signal(sig, set ? panictrace_handler : SIG_DFL).
    // There are no POSIX signals to install here, so the dispositions are
    // recorded rather than registered; the walk order is C's.
    for (const [name, signo] of PANICTRACE_SIGNALS)
        panictrace_installed.set(name, set ? panictrace_handler : signo /*SIG_DFL*/);
}

// C ref: report.c:485 NH_panictrace_libc() / :529 NH_panictrace_gdb() — both
// already answer FALSE for this build: sysopt.panictrace_libc and
// sysopt.panictrace_gdb are 0 (js/cfgfiles.js:183-184, NH_STATUS_RELEASED), so
// PANICTRACE_LIBC/PANICTRACE_GDB are the "#else return FALSE" arms.  They are
// not redefined here because js/cfgfiles.js already carries that answer.

/*report.js*/
