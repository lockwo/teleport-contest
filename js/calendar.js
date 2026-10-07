// calendar.js — Real-world date side effects (moon phase, Friday the 13th).
// C ref: src/calendar.c — phase_of_the_moon, friday_13th, getlt/getnow.
//
// The contest fixes the in-game clock to game.datetime ("YYYYMMDDHHMMSS"),
// so these helpers parse that instead of reading the host clock.

import { game } from './gstate.js';

// Parse game.datetime into a struct-tm-like object.  C ref: getlt().
function getlt() {
    if (!/^\d{14}$/.test(String(game.datetime || ''))) return null;
    const lt = getlt_c();
    return { tm_year: lt.tm_year, tm_yday: lt.tm_yday, tm_mday: lt.tm_mday,
             tm_wday: lt.tm_wday, tm_hour: lt.tm_hour };
}

// C ref: calendar.c night() — hour < 6 || hour > 21.
export function night() {
    const lt = getlt();
    if (!lt) return false;
    return lt.tm_hour < 6 || lt.tm_hour > 21;
}

// C ref: calendar.c phase_of_the_moon — 0-7, 0: new, 4: full.
export function phase_of_the_moon() {
    const lt = getlt();
    if (!lt) return 1; // arbitrary non-special phase
    const diy = lt.tm_yday;
    const goldn = (lt.tm_year % 19) + 1;
    let epact = (11 * goldn + 18) % 30;
    if ((epact === 25 && goldn > 11) || epact === 24) epact++;
    return (Math.trunc((((diy + epact) * 6 + 11) % 177) / 22)) & 7;
}

// C ref: calendar.c friday_13th.
export function friday_13th() {
    const lt = getlt();
    if (!lt) return false;
    return lt.tm_wday === 5 && lt.tm_mday === 13;
}

export const NEW_MOON = 0;
export const FULL_MOON = 4;

// ═══════════════════════════════════════════════════════════════════════════
// The wall-clock half of calendar.c: getnow(), getyear(), yyyymmdd(),
// hhmmss(), midnight() and time_from_yyyymmddhhmmss().
//
// The getlt() above parses game.datetime directly and only fills in the four
// fields its three callers need.  yyyymmdd()/hhmmss() need tm_mon/tm_min/
// tm_sec too, and getnow() has to hand back a time_t rather than a struct tm,
// so this block builds the whole C chain time_t -> struct tm -> back again.
// getlt() itself is left exactly as it is: it is live code.
// ═══════════════════════════════════════════════════════════════════════════

// THE one environment constant in this file.  docs/recording-environment.md:
// "TZ was America/New_York.  Moon phase, Friday the 13th, and day-of-year
// calculations all used that zone."  Every localtime()/mktime() below resolves
// through it and nothing else here is environment-dependent.
const RECORDER_TZ = 'America/New_York';

// localtime()'s field extraction, in RECORDER_TZ.  hourCycle 'h23' keeps
// midnight at 0 rather than the 24 that hour12:false yields on some ICU
// builds — midnight() is exactly the caller that would get that wrong.
const TZ_PARTS = new Intl.DateTimeFormat('en-US', {
    timeZone: RECORDER_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function tz_fields(ms) {
    const p = {};
    for (const part of TZ_PARTS.formatToParts(new Date(ms))) p[part.type] = part.value;
    return { y: +p.year, mon: +p.month - 1, mday: +p.day,
             hour: +p.hour % 24, min: +p.minute, sec: +p.second };
}

// C ref: u_init.c ubirthday = getnow() — the game-start clock in seconds for
// a session `datetime` stamp.  The recordings ran at a FIXED UTC-4 offset
// (see js/shknam.js for the evidence), independent of the host timezone, so
// this does not go through the host-dependent getnow() above.  Returns 0 for a
// missing/malformed stamp.
const RECORDER_UTC_OFFSET = -4 * 3600;
export function recorder_ubirthday(datetime) {
    const dt = String(datetime || '');
    if (!/^\d{14}$/.test(dt)) return 0;
    const n = (a, b) => +dt.slice(a, b);
    return Math.trunc(Date.UTC(n(0, 4), n(4, 6) - 1, n(6, 8),
                               n(8, 10), n(10, 12), n(12, 14)) / 1000)
           - RECORDER_UTC_OFFSET;
}

// C ref: calendar.c:40 getlt() / libc localtime(&date) — a full struct tm for
// the time_t `date` (seconds since the epoch), in RECORDER_TZ.
function localtime_c(date) {
    const f = tz_fields(date * 1000);
    // tm_wday (0 == Sunday) and tm_yday (0-based) are computed rather than
    // formatted: the arithmetic is exact and needs no locale.
    const wday = new Date(Date.UTC(f.y, f.mon, f.mday)).getUTCDay();
    const leap = (f.y % 4 === 0 && f.y % 100 !== 0) || (f.y % 400 === 0);
    const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let yday = 0;
    for (let i = 0; i < f.mon; i++) yday += dim[i];
    yday += f.mday - 1;
    return { tm_year: f.y - 1900, tm_mon: f.mon, tm_mday: f.mday,
             tm_hour: f.hour, tm_min: f.min, tm_sec: f.sec,
             tm_wday: wday, tm_yday: yday };
}

// libc mktime() with tm_isdst == -1: broken-down RECORDER_TZ fields back to a
// time_t.  Date.UTC() does mktime's field normalisation (month 12 -> next
// January, &c); the two passes resolve the zone offset at the *target* instant,
// which is what makes localtime_c(mktime(x)) == x across a DST boundary.
function mktime_c(y, mon, mday, hour, min, sec) {
    const naive = Date.UTC(y, mon, mday, hour, min, sec);   /* ms, fields as UTC */
    const offset_at = (ms) => {
        const f = tz_fields(ms);
        return (Date.UTC(f.y, f.mon, f.mday, f.hour, f.min, f.sec) - ms) / 1000;
    };
    let t = Math.trunc(naive / 1000) - offset_at(naive);
    t = Math.trunc(naive / 1000) - offset_at(t * 1000);
    return t;
}

// patches/001-deterministic-runtime.patch seeds time_from_yyyymmddhhmmss()'s
// struct tm from localtime(real now), so mktime() sees the tm_isdst of the
// day the session was RECORDED, not of the stamp's date.  The recordings were
// made during US daylight time (tm_isdst == 1), so a stamp that falls in
// standard time (winter) is read as if it were DST: libc mktime() lands one
// hour earlier (a "00:20" January stamp is really 23:20 the day before, which
// moves the moon phase / Friday-13th day and midnight()/night()).
const RECORDER_TM_ISDST = 1;

// mktime() with tm_isdst == RECORDER_TM_ISDST: when the target instant is not
// in the requested DST state, libc shifts by the DST/standard offset delta.
function mktime_recorder(y, mon, mday, hour, min, sec) {
    const t = mktime_c(y, mon, mday, hour, min, sec);
    const off = (ms) => {
        const f = tz_fields(ms);
        return (Date.UTC(f.y, f.mon, f.mday, f.hour, f.min, f.sec) - ms) / 1000;
    };
    const jan = off(Date.UTC(y, 0, 1)), jul = off(Date.UTC(y, 6, 1));
    const std = Math.min(jan, jul), dst = Math.max(jan, jul);
    if (std === dst) return t;                      /* zone without DST */
    const isdst = off(t * 1000) === dst ? 1 : 0;
    if (isdst === RECORDER_TM_ISDST) return t;
    return t + (RECORDER_TM_ISDST ? std - dst : dst - std);
}

// C ref: hacklib.c-adjacent libc atoi() — leading digits only, 0 otherwise.
function atoi(s) {
    const m = /^\s*[-+]?\d+/.exec(String(s));
    return m ? (parseInt(m[0], 10) | 0) : 0;
}

// C ref: calendar.c:119 time_from_yyyymmddhhmmss(buf) — parse the recorder's
// 14-digit stamp into a time_t.  C splits `buf` into six fixed-width fields,
// copies the *current* struct tm (so only tm_isdst carries over; all six
// meaningful fields are overwritten) and calls mktime(); a -1 result is
// discarded and 0 returned.
//
// Divergence worth knowing: nethack-c/patches/001-deterministic-runtime.patch
// replaces the `lt = getlt()` here with localtime(&real_now) to avoid recursing
// into the patched getnow(), so the C build's tm_isdst comes from the wall
// clock at RECORDING time, not from the target date.  Had the recorder run on
// the other side of a DST boundary from the session's `datetime`, C's
// getnow() would land an hour off it.  mktime_c() resolves DST from the target
// date instead (tm_isdst == -1), which is the identity round trip the getlt()
// above already assumes.
export function time_from_yyyymmddhhmmss(buf) {
    let timeresult = 0;

    if (buf && String(buf).length === 14) {
        const d = String(buf);
        const y = d.slice(0, 4), mo = d.slice(4, 6), md = d.slice(6, 8),
              h = d.slice(8, 10), mi = d.slice(10, 12), s = d.slice(12, 14);
        timeresult = mktime_recorder(atoi(y), atoi(mo) - 1, atoi(md),
                              atoi(h), atoi(mi), atoi(s));
        if (timeresult === -1) {
            /* C: debugpline1(...) under #if 0 — no return, falls to `return 0` */
        } else {
            return timeresult;
        }
    }
    return 0;
}

// C ref: calendar.c:31 getnow(), as patched for the recorder: when
// NETHACK_FIXED_DATETIME is set the wall clock is that stamp, and the harness
// always sets it from the session's `datetime` field (docs/recording-
// environment.md, "Clock and timezone").  This port keeps that field in
// game.datetime, so it stands in for the env var.
export function getnow() {
    const fixed_dt = String(game.datetime || '');

    if (fixed_dt) {
        const parsed = time_from_yyyymmddhhmmss(fixed_dt);
        if (parsed !== 0)
            return parsed;
    }
    return Math.trunc(Date.now() / 1000);   /* C: time(&datetime) */
}

// C ref: calendar.c:40 getlt() — localtime(getnow()).  Named apart from the
// getlt() at the top of this file, which is live and returns a partial tm.
function getlt_c() {
    return localtime_c(getnow());
}

// C ref: calendar.c:48 getyear().
export function getyear() {
    return 1900 + getlt_c().tm_year;
}

// C ref: calendar.c:55 yyyymmdd(date) — `date == 0` means "now".  The
// `tm_year < 70` arm guards against a localtime() that hands back year % 100.
export function yyyymmdd(date) {
    let datenum;
    const lt = !date ? getlt_c() : localtime_c(date);

    if (lt.tm_year < 70)
        datenum = lt.tm_year + 2000;
    else
        datenum = lt.tm_year + 1900;
    datenum = datenum * 100 + (lt.tm_mon + 1);      /* yyyy   -> yyyymm   */
    datenum = datenum * 100 + lt.tm_mday;           /* yyyymm -> yyyymmdd */
    return datenum;
}

// C ref: calendar.c:79 hhmmss(date).
export function hhmmss(date) {
    const lt = !date ? getlt_c() : localtime_c(date);

    return lt.tm_hour * 10000 + lt.tm_min * 100 + lt.tm_sec;
}

// C ref: calendar.c:222 midnight() — returns an int, like night() in C does.
export function midnight() {
    return getlt_c().tm_hour === 0 ? 1 : 0;
}
