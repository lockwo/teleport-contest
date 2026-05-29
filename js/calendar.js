// calendar.js — Real-world date side effects (moon phase, Friday the 13th).
// C ref: src/calendar.c — phase_of_the_moon, friday_13th, getlt/getnow.
//
// The contest fixes the in-game clock to game.datetime ("YYYYMMDDHHMMSS"),
// so these helpers parse that instead of reading the host clock.

import { game } from './gstate.js';

// Parse game.datetime into a struct-tm-like object.  C ref: getlt().
function getlt() {
    const dt = String(game.datetime || '');
    if (!/^\d{14}$/.test(dt)) return null;
    const year = +dt.slice(0, 4);
    const month = +dt.slice(4, 6);   // 1..12
    const day = +dt.slice(6, 8);     // 1..31
    // tm_yday: 0-based day of year.
    const leap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let yday = 0;
    for (let i = 0; i < month - 1; i++) yday += dim[i];
    yday += day - 1;
    // tm_wday: 0=Sunday.  Use a UTC Date (no timezone shift).
    const wday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return { tm_year: year - 1900, tm_yday: yday, tm_mday: day, tm_wday: wday };
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
