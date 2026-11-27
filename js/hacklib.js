// hacklib.js — Utility functions.
// C ref: hacklib.c, dungeon.c helpers

import { game } from './gstate.js';

// Darwin libc atoi(): decimal strtol with signed-long saturation, then an
// int32 conversion. Config values can exceed Number's exact integer range.
export function c_atoi(s) {
    const prefix = /^[\t\n\v\f\r ]*([+-]?[0-9]+)/.exec(String(s));
    if (!prefix) return 0;
    let n = BigInt(prefix[1]);
    if (n > 0x7fffffffffffffffn) n = 0x7fffffffffffffffn;
    else if (n < -0x8000000000000000n) n = -0x8000000000000000n;
    return Number(BigInt.asIntN(32, n));
}

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

// C ref: hacklib.c letter() -- '@' counts as a letter ('@' through 'Z', a-z).
export function letter(c) {
    return typeof c === 'string' && c.length === 1
        && (('@' <= c && c <= 'Z') || ('a' <= c && c <= 'z'));
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
// C ref: objnam.c an()
export function an(str) {
    if (!str) {
        if (game.debugImpossible)
            console.warn(`impossible: Alphabet soup: 'an(${str == null ? '<null>' : '""'})'.`);
        return 'an []';
    }
    return just_an(String(str)) + str;
}

// C ref: objnam.c An() -- an() with the first letter capitalized.
export function An(str) {
    return upstart(an(str));
}

// C ref: hacklib.c highc() -- force a single char into uppercase.
export function highc(c) {
    return (c >= 'a' && c <= 'z') ? c.toUpperCase() : c;
}

// C ref: hacklib.c upstart() -- capitalize the first letter of a string.
export function upstart(s) {
    return s ? highc(s[0]) + s.slice(1) : s;
}

// C ref: hack.h plur() -- "s" unless the count is exactly 1.
export function plur(n) {
    return Number(n) === 1 ? '' : 's';
}

export function depth(uz) {
    const dnum = uz?.dnum ?? 0;
    const dlevel = uz?.dlevel ?? 1;
    const dungeon = game?.dungeons?.[dnum];
    if (!dungeon) return dlevel;
    return (dungeon.depth_start || 1) + dlevel - 1;
}

// C ref: rn2(x) already in rng.js — re-export not needed

// C's atoi() in the C locale: skip isspace() (' ' and \t\n\v\f\r only), an
// optional sign, then digits.  parseInt() also skips Unicode spaces such as
// U+00A0, a byte that a typed meta key can leave in a getlin() buffer.
export function atoi(s) {
    s = String(s ?? '');
    let i = 0, n = 0, neg = false;
    while (i < s.length && ' \t\n\v\f\r'.includes(s[i])) i++;
    if (s[i] === '+' || s[i] === '-') neg = s[i++] === '-';
    while (i < s.length && s[i] >= '0' && s[i] <= '9') n = n * 10 + (s.charCodeAt(i++) - 48);
    return neg ? -n : n;
}

// C ref: hacklib.c mungspaces() — remove excess whitespace: tabs become
// spaces, runs of spaces collapse to one, leading and trailing space are
// dropped, and a newline ends the string.
export function mungspaces(bp) {
    bp = String(bp ?? '');
    let out = '', was_space = true;
    for (let i = 0; i < bp.length; i++) {
        let c = bp[i];
        if (c === '\n') break;
        if (c === '\t') c = ' ';
        if (c !== ' ' || !was_space) out += c;
        was_space = (c === ' ');
    }
    if (was_space && out.length > 0) out = out.slice(0, -1);
    return out;
}

/* C ref: hacklib.c:700 strncmp(s1, s2, n) / strncmpi(s1, s2, n) — C's -1/0/1
   ordering (0 means equal); the i form folds case with lowc().  C stops at the
   terminating NUL, so the shorter string sorts first.  strcmpi(a, b) is
   strncmpi(a, b, -1) (global.h:113). */
export function strncmp(s1, s2, n) {
    s1 = String(s1 ?? ''); s2 = String(s2 ?? '');
    for (let i = 0; n-- !== 0; i++) {
        if (i >= s2.length) return (i < s1.length) ? 1 : 0; /* s1 >= s2 */
        if (i >= s1.length) return -1;                      /* s1  < s2 */
        const t1 = s1.charCodeAt(i), t2 = s2.charCodeAt(i);
        if (t1 !== t2) return (t1 > t2) ? 1 : -1;
    }
    return 0; /* s1 == s2 */
}
export function strncmpi(s1, s2, n) {
    return strncmp(String(s1 ?? '').toLowerCase(), String(s2 ?? '').toLowerCase(), n);
}
export function strcmpi(a, b) { return strncmpi(a, b, -1); }
