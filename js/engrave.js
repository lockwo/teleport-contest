// engrave.js - engraving text selection and degradation.
// C refs: engrave.c random_engraving(), wipeout_text(), wipe_engr_at();
//         rumors.c init_rumors(), getrumor(), get_rnd_line(), get_rnd_text();
//         hacklib.c xcrypt().

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { BUFSZ, BURN, DUST, ENGR_BLOOD, HEADSTONE, ICE } from './const.js';
import { RUMORS_B64, ENGRAVE_B64 } from './rumors_data.js';
import { EPITAPH_B64 } from './epitaph_data.js';

const MD_PAD_RUMORS = 60;

// ---------------------------------------------------------------------------
// Embedded dlb data files (makedefs-built, xcrypt'd + underscore-padded).
// We reproduce the C side's byte-offset line selection (rumors.c get_rnd_line)
// against the *exact* bytes the recorder read, so rumor/engrave lengths and
// contents — and therefore the rn2() call sequence in wipeout_text — match C.
// ---------------------------------------------------------------------------
const RUMORS_DATA = decodeBase64(RUMORS_B64);
const ENGRAVE_DATA = decodeBase64(ENGRAVE_B64);
const EPITAPH_DATA = decodeBase64(EPITAPH_B64);

function decodeBase64(b64) {
    if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// C ref: hacklib.c xcrypt() — symmetric bit-rotation cipher used for data files.
function xcrypt(str) {
    let out = '';
    let bitmask = 1;
    for (let i = 0; i < str.length; i++) {
        let q = str.charCodeAt(i);
        if (q & (32 | 64)) q ^= bitmask;
        out += String.fromCharCode(q);
        bitmask <<= 1;
        if (bitmask >= 32) bitmask = 1;
    }
    return out;
}

// C ref: rumors.c unpadline() — strip trailing newline then '_' padding.
function unpadline(line) {
    let p = line.length;
    if (p > 0 && line[p - 1] === '\n') --p;
    while (p > 0 && line[p - 1] === '_') --p;
    return line.slice(0, p);
}

// Mimic dlb_fgets: read bytes (as a 1:1 char string) from `pos`, stopping after
// the first '\n' (inclusive) or after BUFSZ-1 chars, or at EOF.
function dlb_fgets(data, pos) {
    let s = '';
    let i = pos;
    while (i < data.length && s.length < BUFSZ - 1) {
        const c = String.fromCharCode(data[i]);
        s += c;
        i++;
        if (c === '\n') break;
    }
    return { line: s, next: i };
}

// C ref: rumors.c get_rnd_line(). Position randomly inside [startpos,endpos),
// land mid-line, read the rest of that line, then use the *next* line (wrapping
// to startpos at EOF/endpos). Lines are xcrypt'd and underscore-padded.
function get_rnd_line(data, startpos, endpos, padlength) {
    if (!endpos) endpos = data.length;
    const filechunksize = endpos - startpos;
    if (filechunksize < 1) return '';

    let bufstr = '';
    let next = startpos;
    for (let trylimit = 10; trylimit > 0; --trylimit) {
        const chunkoffset = rn2(filechunksize);
        ({ line: bufstr, next } = dlb_fgets(data, startpos + chunkoffset));
        if (!padlength || bufstr.length <= padlength + 1) break;
    }

    // use next line; reaching endpos is treated as end-of-file
    if (next >= endpos) {
        ({ line: bufstr, next } = dlb_fgets(data, startpos));
    } else {
        const r = dlb_fgets(data, next);
        if (r.line.length === 0) {
            ({ line: bufstr, next } = dlb_fgets(data, startpos));
        } else {
            ({ line: bufstr, next } = r);
        }
    }

    const nl = bufstr.indexOf('\n');
    if (nl >= 0) bufstr = bufstr.slice(0, nl);
    bufstr = xcrypt(bufstr);
    if (padlength) bufstr = unpadline(bufstr);
    return bufstr;
}

// C ref: rumors.c init_rumors() — parse the header line for the true/false
// rumor file regions. Memoized; mirrors gt.true_rumor_* / gf.false_rumor_*.
let _rumorMeta = null;
function init_rumors() {
    if (_rumorMeta) return _rumorMeta;
    // line 1: "don't edit" comment; line 2: header
    const { next: p1 } = dlb_fgets(RUMORS_DATA, 0);
    const { line: header } = dlb_fgets(RUMORS_DATA, p1);
    // "%d,%ld,%lx;%d,%ld,%lx;0,0,%lx" — true_count,true_size,true_start; ...
    const m = header.match(
        /^(\d+),(\d+),([0-9a-fA-F]+);(\d+),(\d+),([0-9a-fA-F]+);0,0,([0-9a-fA-F]+)/,
    );
    const true_size = parseInt(m[2], 10);
    const true_start = parseInt(m[3], 16);
    const false_size = parseInt(m[5], 10);
    const false_start = parseInt(m[6], 16);
    _rumorMeta = {
        true_rumor_size: true_size,
        true_rumor_start: true_start,
        true_rumor_end: true_start + true_size,
        false_rumor_size: false_size,
        false_rumor_start: false_start,
        false_rumor_end: false_start + false_size,
    };
    return _rumorMeta;
}

const rubouts = [
    ['A', '^'],
    ['B', 'Pb['],
    ['C', '('],
    ['D', '|)['],
    ['E', '|FL[_'],
    ['F', '|-'],
    ['G', 'C('],
    ['H', '|-'],
    ['I', '|'],
    ['K', '|<'],
    ['L', '|_'],
    ['M', '|'],
    ['N', '|\\'],
    ['O', 'C('],
    ['P', 'F'],
    ['Q', 'C('],
    ['R', 'PF'],
    ['T', '|'],
    ['U', 'J'],
    ['V', '/\\'],
    ['W', 'V/\\'],
    ['Z', '/'],
    ['b', '|'],
    ['d', 'c|'],
    ['e', 'c'],
    ['g', 'c'],
    ['h', 'n'],
    ['j', 'i'],
    ['k', '|'],
    ['l', '|'],
    ['m', 'nr'],
    ['n', 'r'],
    ['o', 'c'],
    ['q', 'c'],
    ['w', 'v'],
    ['y', 'v'],
    [':', '.'],
    [';', ',:'],
    [',', '.'],
    ['=', '-'],
    ['+', '-|'],
    ['*', '+'],
    ['@', '0'],
    ['0', 'C('],
    ['1', '|'],
    ['6', 'o'],
    ['7', '/'],
    ['8', '3o'],
];

// C ref: rumors.c get_rnd_text() — pick a random line from a whole data file
// (no true/false split). Skips the leading "don't edit" comment line.
function get_rnd_text(data, padlength) {
    const { next: starttxt } = dlb_fgets(data, 0); // skip comment line
    return get_rnd_line(data, starttxt, 0, padlength);
}

// C ref: engrave.c make_grave() -> get_rnd_text(EPITAPHFILE, buf, rn2, MD_PAD_RUMORS).
// Emits the same rn2() draw the C side does against the makedefs-built 'epitaph' file
// (rn2(24075) over the text region, then the MD_PAD_RUMORS line scan). The epitaph text
// is not displayed at game start, so only the draw sequence is load-bearing.
export function get_rnd_epitaph() {
    return get_rnd_text(EPITAPH_DATA, MD_PAD_RUMORS);
}

// C ref: rumors.c getrumor(). truth: 1=true, -1=false, 0=either.
function getrumor(truth, exclude_cookie) {
    const cookie_marker = '[cookie] ';
    const marklen = cookie_marker.length;
    const meta = init_rumors();

    let rumor = '';
    let count = 0;
    do {
        rumor = '';
        // input: 1 0 -1 ; rn2+1 => 2/1=T, 1/0=T/F, 0/-1=F/F
        const adjtruth = truth + rn2(2);
        let beginning;
        let ending;
        if (adjtruth >= 1) {
            beginning = meta.true_rumor_start;
            ending = meta.true_rumor_end;
        } else {
            beginning = meta.false_rumor_start;
            ending = meta.false_rumor_end;
        }
        rumor = get_rnd_line(RUMORS_DATA, beginning, ending, MD_PAD_RUMORS);
    } while (count++ < 50 && exclude_cookie
             && rumor.slice(0, marklen) === cookie_marker);

    if (!exclude_cookie && rumor.slice(0, marklen) === cookie_marker)
        rumor = rumor.slice(marklen);
    return rumor;
}

export function random_engraving() {
    // a random engraving may come from the "rumors" file, or the "engrave" file
    let pristine = '';
    if (!rn2(4) || !(pristine = getrumor(0, true)) || !pristine)
        pristine = get_rnd_text(ENGRAVE_DATA, MD_PAD_RUMORS);

    const text = wipeout_text(pristine, Math.trunc(pristine.length / 4), 0);
    return { text, pristine };
}

export function wipeout_text(engr, cnt, seed = 0) {
    const chars = Array.from(engr);
    let lth = chars.length;

    if (lth && cnt > 0) {
        while (cnt--) {
            let nxt, use_rubout;
            if (!seed) {
                nxt = rn2(lth);
                use_rubout = rn2(4);
            } else {
                nxt = seed % lth;
                seed *= 31;
                seed %= (BUFSZ - 1);
                use_rubout = seed & 3;
            }

            const ch = chars[nxt];
            if (ch === ' ') continue;
            if ("?. ,'`-|_".includes(ch) && ch !== ' ') {
                chars[nxt] = ' ';
                continue;
            }

            let found = false;
            if (use_rubout) {
                for (const [wipefrom, wipeto] of rubouts) {
                    if (ch === wipefrom) {
                        let j;
                        if (!seed) {
                            j = rn2(wipeto.length);
                        } else {
                            seed *= 31;
                            seed %= (BUFSZ - 1);
                            j = seed % wipeto.length;
                        }
                        chars[nxt] = wipeto[j];
                        found = true;
                        break;
                    }
                }
            }

            if (!found)
                chars[nxt] = '?';
        }
    }

    while (lth && chars[lth - 1] === ' ') {
        chars.pop();
        --lth;
    }
    return chars.join('');
}

export function engr_at(x, y) {
    const engravings = game.level?.engravings ?? [];
    return engravings.find((ep) => ep.engr_x === x && ep.engr_y === y) ?? null;
}

export function make_engr_at(x, y, text, pristine, epoch, engr_type) {
    if (!game.level) return null;
    if (!game.level.engravings) game.level.engravings = [];
    game.level.engravings = game.level.engravings.filter(
        (ep) => ep.engr_x !== x || ep.engr_y !== y,
    );
    const ep = {
        engr_x: x,
        engr_y: y,
        engr_type,
        engr_time: epoch,
        nowipeout: false,
        actualText: text,
        rememberedText: text,
        pristineText: pristine ?? text,
    };
    game.level.engravings.unshift(ep);
    return ep;
}

export function wipe_engr_at(x, y, cnt, magical = false) {
    const ep = engr_at(x, y);
    if (!ep || ep.engr_type === HEADSTONE || ep.nowipeout) return;

    const loc = game.level?.at(x, y);
    const on_ice = loc?.typ === ICE;
    if (ep.engr_type !== BURN || on_ice || (magical && !rn2(2))) {
        if (ep.engr_type !== DUST && ep.engr_type !== ENGR_BLOOD)
            cnt = rn2(1 + Math.trunc(50 / (cnt + 1))) ? 0 : 1;
        ep.actualText = wipeout_text(ep.actualText, cnt, 0).replace(/^ +/, '');
        if (!ep.actualText && game.level?.engravings) {
            game.level.engravings = game.level.engravings.filter((e) => e !== ep);
        }
    }
}
