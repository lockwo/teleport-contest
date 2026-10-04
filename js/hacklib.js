// hacklib.js — Utility functions.
// C ref: hacklib.c, dungeon.c helpers

import { game } from './gstate.js';

export function isok(x, y) {
    const { COLNO, ROWNO } = await_const();
    return x >= 1 && x <= COLNO - 1 && y >= 0 && y <= ROWNO - 1;
}

// Lazy import to avoid circular deps
let _const = null;
function await_const() {
    if (!_const) _const = { COLNO: 80, ROWNO: 21 };
    return _const;
}

export function distmin(x1, y1, x2, y2) {
    return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

export function dist2(x1, y1, x2, y2) {
    return (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
}

// C ref: hacklib.c s_suffix() — possessive: "it" -> "its", "you" -> "your"
// (both case-insensitive, like strcmpi), "Xs" -> "Xs'", otherwise "X's".
export function s_suffix(s) {
    const str = String(s);
    const lower = str.toLowerCase();
    if (lower === 'it') return `${str}s`;
    if (lower === 'you') return `${str}r`;
    return str.endsWith('s') ? `${str}'` : `${str}'s`;
}

// C ref: objnam.c just_an(outbuf, str) / an(str) — indefinite article with the
// "wun"/long-u/x exceptions.  Lives in this leaf module so files low in the
// import graph can use it without pulling in objnam.js.
export function just_an(str) {
    const c0 = str[0].toLowerCase();
    if (!str[1] || str[1] === ' ')
        return 'aefhilmnosx'.includes(c0) ? 'an ' : 'a ';
    const low = str.toLowerCase();
    if (low.startsWith('the ') || low === 'molten lava' || low === 'iron bars'
        || low === 'ice')
        return '';
    const vowel = 'aeiou'.includes(c0);
    if ((vowel
         && (!low.startsWith('one') || (str[3] && !'-_ '.includes(str[3])))
         && !low.startsWith('eu') && !low.startsWith('uke')
         && !low.startsWith('ukulele')
         && !low.startsWith('unicorn') && !low.startsWith('uranium')
         && !low.startsWith('useful'))
        || (c0 === 'x' && !'aeiou'.includes(str[1].toLowerCase())))
        return 'an ';
    return 'a ';
}
export function an(str) {
    if (!str) return 'an []';
    return just_an(String(str)) + str;
}

export function depth(uz) {
    const dnum = uz?.dnum ?? 0;
    const dlevel = uz?.dlevel ?? 1;
    const dungeon = game?.dungeons?.[dnum];
    if (!dungeon) return dlevel;
    return (dungeon.depth_start || 1) + dlevel - 1;
}

// C ref: rn2(x) already in rng.js — re-export not needed
