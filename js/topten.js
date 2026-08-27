// topten.js — port of src/topten.c (the RECORD/logfile/xlogfile score board).
//
// INERT BY DESIGN.  Nothing in js/ imports this module yet.  Every function
// here is a translation of its C counterpart; none of them draws RNG, so
// wiring one up cannot reorder the shared draw stream by itself — but WHEN a
// caller runs still can, so a wiring pass must land one call site at a time
// under measurement.
//
// OVERLAP WITH js/end.js.  The death path already carries reduced, live copies
// of three of these functions, written against a different entry shape (a
// browser-storage JSON record rather than C's `struct toptenentry`):
//     topten()   -> js/end.js topten_list()      (list merge only: no RECORD
//                   file, no LOGFILE/XLOGFILE, no wizard/discover skip)
//     outheader()-> js/end.js topten_outheader(COLNO)
//     outentry() -> js/end.js topten_outentry(rank, entry, so, COLNO)
// topten() is NOT re-translated here — end.js owns it, and a second copy on
// the live death path is the duplicate-shadow trap.  outheader()/outentry()
// ARE translated, because prscore() below calls them and end.js's variants
// take the storage-JSON shape (entry.dungeonName / entry.knoxDnum) and drop
// the escaped/ascended/elemental-plane wording.  A wiring pass that reaches
// the death path must REPLACE end.js's copies, never add a second caller.

import {
    COLNO, NON_PM,
    KILLED_BY_AN, KILLED_BY, NO_KILLER_PREFIX,
    VERSION_MAJOR, VERSION_MINOR, PATCHLEVEL,
    A_ORIGINAL, G_GENOD,
    ACH_UWIN, ACH_ASTR, ACH_ENDG, ACH_AMUL, ACH_INVK, ACH_BOOK, ACH_BELL,
    ACH_CNDL, ACH_HELL, ACH_MEDU, ACH_MINE_PRIZE, ACH_SOKO_PRIZE, ACH_ORCL,
    ACH_NOVL, ACH_MINE, ACH_TOWN, ACH_SHOP, ACH_TMPL, ACH_SOKO, ACH_BGRM,
    ACH_TUNE, ACH_RNK1, ACH_RNK8,
} from './const.js';
import { game } from './gstate.js';
import { depth } from './hacklib.js';
import { roles, genders, aligns, str2role, str2race } from './role.js';
import { rank_of } from './exper.js';
import { money_cnt_invent, hidden_gold } from './shk.js';

// topten.c:29-36
const NAMSZ = 10;
const DTHSZ = 100;
const ROLESZ = 3;
// topten.c:58 — room for every string field of one record plus separators.
const SCANBUFSZ = (4 * (ROLESZ + 1)) + (NAMSZ + 1) + (DTHSZ + 1) + 1;

// topten.c:83 — Lattice scanf can't read the score file; our build is not that
// platform, so the mung/unmung pair is compiled out.  Kept as a constant so
// the guarded code below reads like the C.
const NO_SCAN_BRACK = false;

// global.h BUFSZ, used by prscore()'s player-list truncation.
const BUFSZ = 256;

// config.h:332-345 defaults, clamped by sys.c:66-70 sysopt_setup().
// PERS_IS_UID is 1 on unix.
export const sysopt = {
    persmax: 3,             // config.h PERSMAX
    entrymax: 100,          // config.h ENTRYMAX
    pointsmin: 1,           // config.h POINTSMIN
    pers_is_uid: 1,         // config.h PERS_IS_UID
    tt_oname_maxrank: 10,   // sys.c:70
};

// topten.c:26 `static long final_fpos` and :56 `static struct toptenentry
// *tt_head`.  Module state, exactly as C keeps it file-static.
let final_fpos = 0;
let tt_head = null;

// topten.c:60 `static struct toptenentry zerott;` — `*t0 = zerott` clears a
// freshly allocated entry.  fpos is the UPDATE_RECORD_IN_PLACE field.
export function zerott() {
    return {
        tt_next: null, fpos: 0,
        points: 0,
        deathdnum: 0, deathlev: 0,
        maxlvl: 0, hp: 0, maxhp: 0, deaths: 0,
        ver_major: 0, ver_minor: 0, patchlevel: 0,
        deathdate: 0, birthdate: 0,
        uid: 0,
        plrole: '', plrace: '', plgend: '', plalign: '', name: '', death: '',
    };
}

// ---------------------------------------------------------------------------
// stdio stand-ins.  C drives RECORD through FILE*; this port has no
// filesystem, so a read "file" is a cursor over a string and a write "file" is
// an accumulator.  Only the stdio behaviour topten.c depends on is modelled:
// fgetc's EOF, fgets' size limit and newline-inclusive stop, ftell/rewind, and
// scanf's whitespace/conversion rules.
// ---------------------------------------------------------------------------

const EOF = -1;
const NL = '\n'.charCodeAt(0);

export function ttfile_reader(text) { return { buf: String(text ?? ''), pos: 0 }; }
export function ttfile_writer() { return { out: '' }; }

function fgetc(rf) { return rf.pos < rf.buf.length ? rf.buf.charCodeAt(rf.pos++) : EOF; }
function ftell(rf) { return rf.pos; }
function fprintf(wf, s) { wf.out += s; }

// fgets(buf, size, rfile): at most size-1 chars, stopping after a '\n'.
// Returns null (C's NULL) when nothing could be read.
function fgets(rf, size) {
    if (rf.pos >= rf.buf.length) return null;
    let s = '';
    while (s.length < size - 1 && rf.pos < rf.buf.length) {
        const c = rf.buf[rf.pos++];
        s += c;
        if (c === '\n') break;
    }
    return s;
}

function is_space(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r'
                           || c === '\v' || c === '\f'; }

function skip_ws(rf) { while (rf.pos < rf.buf.length && is_space(rf.buf[rf.pos])) rf.pos++; }

// scanf "%d"/"%ld": skip leading whitespace, then an optionally signed digit
// run.  Returns null on a matching failure (which ends the conversion count).
function scan_int(rf) {
    skip_ws(rf);
    let p = rf.pos;
    const start = p;
    if (rf.buf[p] === '+' || rf.buf[p] === '-') p++;
    const d0 = p;
    while (p < rf.buf.length && rf.buf[p] >= '0' && rf.buf[p] <= '9') p++;
    if (p === d0) return null;
    rf.pos = p;
    return parseInt(rf.buf.slice(start, p), 10);
}

// A literal character in a scanf format must match exactly.
function scan_literal(rf, ch) {
    if (rf.buf[rf.pos] !== ch) return false;
    rf.pos++;
    return true;
}

// sscanf "%s": skip whitespace, then a run of non-whitespace.
function sscan_word(st) {
    while (st.pos < st.buf.length && is_space(st.buf[st.pos])) st.pos++;
    const start = st.pos;
    while (st.pos < st.buf.length && !is_space(st.buf[st.pos])) st.pos++;
    return st.pos > start ? st.buf.slice(start, st.pos) : null;
}

// sscanf "%[^<stop>]": a run of one or more characters that are not in `stop`.
// Unlike %s this does NOT skip leading whitespace.
function sscan_until(st, stop) {
    const start = st.pos;
    while (st.pos < st.buf.length && !stop.includes(st.buf[st.pos])) st.pos++;
    return st.pos > start ? st.buf.slice(start, st.pos) : null;
}

// sscanf "%c".
function sscan_char(st) {
    return st.pos < st.buf.length ? st.buf[st.pos++] : null;
}

// ---------------------------------------------------------------------------
// hacklib.c helpers topten.c leans on.  Kept local: js/hacklib.js is thin and
// several call sites in js/ already carry their own one-line copies
// (js/end.js:1216 an(), js/questpgr.js:2659 just_an(), js/role.js:868
// strsubst(), js/options.js:247 highc()).
// ---------------------------------------------------------------------------

// hacklib.c:287 copynchars(dst, src, n) — at most n chars, newline also ends
// the copy, always NUL-terminated.
function copynchars(src, n) {
    let out = '';
    const s = String(src ?? '');
    for (let i = 0; i < s.length && out.length < n && s[i] !== '\n'; i++) out += s[i];
    return out;
}

// hacklib.c:419 onlyspace() — TRUE when every character is a space or tab.
function onlyspace(s) {
    for (const c of String(s ?? '')) if (c !== ' ' && c !== '\t') return false;
    return true;
}

// hacklib.c:90 lcase().
function lcase(s) { return String(s ?? '').replace(/[A-Z]/g, (c) => c.toLowerCase()); }

// hacklib.c highc() — capitalise one character.
function highc(c) { return String(c ?? '').toUpperCase(); }

// hacklib.c:557 strNsubst(buf, orig, repl, 0) — replace EVERY occurrence.
function strNsubst_all(buf, orig, repl) {
    return String(buf ?? '').split(orig).join(repl);
}

// hacklib.c strsubst() — replaces the FIRST occurrence only.
function strsubst(bp, orig, replacement) {
    const i = bp.indexOf(orig);
    return i < 0 ? bp : bp.slice(0, i) + replacement + bp.slice(i + orig.length);
}

// objnam.c:2145 an() via just_an().  Same reduction js/questpgr.js:2659 uses:
// the general vowel rule plus the "wun"/long-'u' exceptions.
function an(str) {
    const s = String(str ?? '');
    if (!s) return 'an []';           /* C: impossible("Alphabet soup") */
    const c0 = s[0].toLowerCase();
    if (!s[1] || s[1] === ' ') return ('aefhilmnosx'.includes(c0) ? 'an ' : 'a ') + s;
    const low = s.toLowerCase();
    if (low.startsWith('the ')) return s;
    const vowel = 'aeiou'.includes(c0);
    const wunOrLongU = low.startsWith('one') || low.startsWith('eu')
        || low.startsWith('uke') || low.startsWith('ukulele')
        || low.startsWith('unicorn') || low.startsWith('uranium')
        || low.startsWith('useful');
    if ((vowel && !wunOrLongU)
        || (c0 === 'x' && !'aeiou'.includes((s[1] || '').toLowerCase())))
        return `an ${s}`;
    return `a ${s}`;
}

// insight.c:2517 sokoban_in_play() — "has the entered-Sokoban achievement been
// recorded".  js/insight.js:959 keeps a private copy of this.
function sokoban_in_play() {
    const ach = game.u?.uachieved;
    if (!Array.isArray(ach)) return false;
    for (let i = 0; i < ach.length && ach[i]; i++) if (ach[i] === ACH_SOKO) return true;
    return false;
}

// insight.c num_genocides() — svm.mvitals[] entries flagged G_GENOD.
// js/insight.js:887 keeps a private copy of this.
function num_genocides() {
    const mv = game.mvitals;
    if (!mv) return 0;
    let n = 0;
    for (let i = 0; i < mv.length; i++) if (mv[i] && (mv[i].mvflags & G_GENOD)) n++;
    return n;
}

// botl.c:314 rank_to_xlev(rank) — the LOW end of the rank's xlev range.
// js/insight.js:1157 keeps a private copy of this.
function rank_to_xlev(rank) {
    return (rank < 1) ? 1 : (rank < 2) ? 3 : (rank < 8) ? (rank * 4 - 2) : 30;
}

// mons[] indices of the thirteen player-role monsters (PM_ARCHEOLOGIST ..
// PM_WIZARD, contiguous), plus the two classmon() fallbacks.  Same constants
// js/makemon.js:2385 uses.
const PM_ARCHEOLOGIST = 331, PM_RANGER = 338;
const PM_HUMAN = 260, PM_HUMAN_MUMMY = 192;

// ---------------------------------------------------------------------------
// topten.c
// ---------------------------------------------------------------------------

// topten.c:92 killed_by_prefix[], indexed by the `how` death code
// (hack.h DIED..ASCENDED).
const killed_by_prefix = [
    /* DIED, CHOKING, POISONING, STARVING, */
    'killed by ', 'choked on ', 'poisoned by ', 'died of ',
    /* DROWNING, BURNING, DISSOLVED, CRUSHING, */
    'drowned in ', 'burned by ', 'dissolved in ', 'crushed to death by ',
    /* STONING, TURNED_SLIME, GENOCIDED, */
    'petrified by ', 'turned to slime by ', 'killed by ',
    /* PANICKED, TRICKED, QUIT, ESCAPED, ASCENDED */
    '', '', '', '', '',
];

// C ref: topten.c:88 formatkiller(buf, siz, how, incl_helpless) — build
// '"killed by",&c ["an"] svk.killer.name'.  C fills a caller-supplied buffer;
// this returns the string instead, but keeps `siz` because the ", while ..."
// suffix is emitted only if it FITS in what the kname copy left over.
//
// js/end.js:329 killer_epitaph() is a three-line reduction of this used for
// the headstone; it has no prefix table, no article, and no field munging.
export function formatkiller(siz, how, incl_helpless) {
    let buf = '';
    let kname = String(game.killer?.name ?? '');
    const format = game.killer?.format;

    switch (format) {
    default:
        /* C: impossible("bad killer format? (%d)"); FALLTHRU */
    case NO_KILLER_PREFIX:
        break;
    case KILLED_BY_AN:
        kname = an(kname);
        /* FALLTHRU */
    case KILLED_BY: {
        const pfx = String(killed_by_prefix[how] ?? '').slice(0, Math.max(0, siz - 1));
        buf += pfx;                       /* strncat(buf, prefix, siz - 1) */
        siz -= pfx.length;                /* buf += l, siz -= l */
        break;
    }
    }

    // Copy kname into buf[].  Monsters can carry "called '<arbitrary text>'",
    // so sanitize the characters that would break field splitting when
    // record/logfile/xlogfile is re-read.
    let k = 0;
    while (--siz > 0) {
        let c = kname[k++];
        if (c === undefined) break;       /* C: if (!c) break; */
        else if (c === ',') c = ';';
        // 'xlogfile' doesn't really need protection for '=', but
        // fixrecord.awk for corrupted 3.6.0 'record' does.
        else if (c === '=') c = '_';
        else if (c === '\t') c = ' ';
        buf += c;
    }

    const multi = game.multi ?? 0;
    const multi_reason = game.multi_reason;
    if (incl_helpless && multi < 0) {
        /* X <= siz: 'sizeof "string"' includes 1 for '\0' terminator */
        if (multi_reason && String(multi_reason).length + 9 /* sizeof ", while " */ <= siz)
            buf += `, while ${multi_reason}`;
        else if (17 /* sizeof ", while helpless" */ <= siz)
            buf += ', while helpless';
        /* else extra death info won't fit, so leave it out */
    }
    return buf;
}

// C's gt.toptenwin (decl.h).  WIN_ERR routes to raw_print; a real window id
// routes to putstr().  Until a wiring pass supplies the window, both sinks
// append to `tt_output` so a caller can read the list back.
const WIN_ERR = -1;
const ATR_NONE = 0, ATR_BOLD = 4;
let toptenwin = WIN_ERR;
export const tt_output = [];

export function set_toptenwin(win) { toptenwin = (win === undefined) ? WIN_ERR : win; }

function raw_print(x) { tt_output.push({ text: x, attr: ATR_NONE }); }
function raw_print_bold(x) { tt_output.push({ text: x, attr: ATR_BOLD }); }
function putstr(_win, attr, x) { tt_output.push({ text: x, attr }); }

// C ref: topten.c:164 topten_print().
export function topten_print(x) {
    if (toptenwin === WIN_ERR)
        raw_print(x);
    else
        putstr(toptenwin, ATR_NONE, x);
}

// C ref: topten.c:173 topten_print_bold().
export function topten_print_bold(x) {
    if (toptenwin === WIN_ERR)
        raw_print_bold(x);
    else
        putstr(toptenwin, ATR_BOLD, x);
}

// C ref: topten.c:182 observable_depth(lev).  The elemental-plane remapping
// (-5..-1) sits inside `#if 0` upstream — it would only be needed if the order
// of the planes were ever randomized — so the live body is just depth().
export function observable_depth(lev) {
    return depth(lev);
}

// C ref: topten.c:207 discardexcess() — throw away characters until the
// current record has been entirely consumed.
export function discardexcess(rfile) {
    let c;
    do {
        c = fgetc(rfile);
    } while (c !== NL && c !== EOF);
}

const TTFIELDS = 13;

// C ref: topten.c:219 readentry(rfile, tt).  Reads one record; a short or
// malformed line leaves tt.points == 0, which is the list terminator.
export function readentry(rfile, tt) {
    // note: input below must read the record's terminating newline
    final_fpos = tt.fpos = ftell(rfile);

    // fmt: "%d.%d.%d %ld %d %d %d %d %d %d %ld %ld %d "
    const v = [];
    for (let i = 0; i < TTFIELDS; i++) {
        if (i === 1 || i === 2) {                 /* the '.'s of %d.%d.%d */
            if (!scan_literal(rfile, '.')) break;
        }
        const x = scan_int(rfile);
        if (x === null) break;
        v.push(x);
    }
    if (v.length === TTFIELDS) skip_ws(rfile);    /* the format's trailing ' ' */

    if (v.length !== TTFIELDS) {
        tt.points = 0;
        discardexcess(rfile);
    } else {
        [tt.ver_major, tt.ver_minor, tt.patchlevel, tt.points, tt.deathdnum,
         tt.deathlev, tt.maxlvl, tt.hp, tt.maxhp, tt.deaths, tt.deathdate,
         tt.birthdate, tt.uid] = v;

        // load remainder of record into a local buffer; this imposes an
        // implicit length limit of SCANBUFSZ on every string field
        let inbuf = fgets(rfile, SCANBUFSZ);
        if (inbuf === null) {
            inbuf = '';                            /* sscanf will fail -> points 0 */
        } else if (!inbuf.includes('\n')) {
            inbuf = `${inbuf.slice(0, SCANBUFSZ - 2)}\n`;
            discardexcess(rfile);
        }

        // Check for backwards compatibility
        if (tt.ver_major < 3 || (tt.ver_major === 3 && tt.ver_minor < 3)) {
            // fmt32: "%c%c %[^,],%[^\n]%*c"
            const st = { buf: inbuf, pos: 0 };
            const c1 = sscan_char(st), c2 = sscan_char(st);
            let s1 = null, s2 = null;
            if (c1 !== null && c2 !== null) {
                while (st.pos < st.buf.length && is_space(st.buf[st.pos])) st.pos++;
                s1 = sscan_until(st, ',');
                if (s1 !== null && scan_literal(st, ',')) s2 = sscan_until(st, '\n');
            }
            if (s2 !== null) {                     /* sscanf(...) == 4 */
                tt.plrole = c1;                    /* [1] = '\0': read via %c */
                tt.plgend = c2;
                tt.name = copynchars(s1, NAMSZ);
                tt.death = copynchars(s2, DTHSZ);
            } else {
                tt.points = 0;
                tt.plrole = c1 ?? '';
                tt.plgend = c2 ?? '';
            }
            tt.plrole = tt.plrole.slice(0, 1);
            const i = str2role(tt.plrole);
            if (i >= 0) tt.plrole = roles[i].filecode;
            tt.plrace = '?';
            tt.plgend = (tt.plgend[0] === 'M') ? 'Mal' : 'Fem';
            tt.plalign = '?';
        } else {
            // fmt33: "%s %s %s %s %[^,],%[^\n]%*c"
            const st = { buf: inbuf, pos: 0 };
            const s1 = sscan_word(st), s2 = sscan_word(st);
            const s3 = sscan_word(st), s4 = sscan_word(st);
            let s5 = null, s6 = null;
            if (s4 !== null) {
                while (st.pos < st.buf.length && is_space(st.buf[st.pos])) st.pos++;
                s5 = sscan_until(st, ',');
                if (s5 !== null && scan_literal(st, ',')) s6 = sscan_until(st, '\n');
            }
            if (s6 !== null) {                     /* sscanf(...) == 6 */
                tt.plrole = copynchars(s1, ROLESZ);
                tt.plrace = copynchars(s2, ROLESZ);
                tt.plgend = copynchars(s3, ROLESZ);
                tt.plalign = copynchars(s4, ROLESZ);
                tt.name = copynchars(s5, NAMSZ);
                tt.death = copynchars(s6, DTHSZ);
            } else {
                tt.points = 0;
            }
        }
        if (NO_SCAN_BRACK && tt.points > 0) {
            tt.name = nsb_unmung_line(tt.name);
            tt.death = nsb_unmung_line(tt.death);
        }
    }

    // check old score entries for Y2K problem and fix whenever found
    if (tt.points > 0) {
        if (tt.birthdate < 19000000) tt.birthdate += 19000000;
        if (tt.deathdate < 19000000) tt.deathdate += 19000000;
    }
}

// C ref: topten.c:300 writeentry(rfile, tt).
export function writeentry(rfile, tt) {
    let name = tt.name, death = tt.death;
    if (NO_SCAN_BRACK) {
        name = nsb_mung_line(name);
        death = nsb_mung_line(death);
    }

    // fmt0: "%d.%d.%d %ld %d %d %d %d %d %d %ld %ld %d "  (NO_SCAN_BRACK
    // swaps the version dots for spaces)
    fprintf(rfile, NO_SCAN_BRACK
        ? `${tt.ver_major} ${tt.ver_minor} ${tt.patchlevel} `
        : `${tt.ver_major}.${tt.ver_minor}.${tt.patchlevel} `);
    fprintf(rfile, `${tt.points} ${tt.deathdnum} ${tt.deathlev} ${tt.maxlvl} `
                 + `${tt.hp} ${tt.maxhp} ${tt.deaths} ${tt.deathdate} `
                 + `${tt.birthdate} ${tt.uid} `);
    if (tt.ver_major < 3 || (tt.ver_major === 3 && tt.ver_minor < 3))
        fprintf(rfile, `${tt.plrole[0] ?? ''}${tt.plgend[0] ?? ''} `);   /* fmt32 */
    else
        fprintf(rfile, `${tt.plrole} ${tt.plrace} ${tt.plgend} ${tt.plalign} `);
    // fmtX: "%s,%s\n" (NO_SCAN_BRACK: "%s %s\n")
    fprintf(rfile, `${onlyspace(name) ? '_' : name}${NO_SCAN_BRACK ? ' ' : ','}${death}\n`);
}

// ---------------------------------------------------------------------------
// XLOGFILE block (topten.c:340-605).  Guarded by #ifdef XLOGFILE upstream;
// config.h:302 defines it, so these are live in the C build.
// ---------------------------------------------------------------------------

const XLOG_SEP = '\t';

// C ref: topten.c:339 writexlentry(rfile, tt, how).  Field ORDER is part of
// the format — post-processors read it positionally as often as by key.
export function writexlentry(rfile, tt, how) {
    const u = game.u || {};
    const uc = u.uconduct || {};
    const rp = u.uroleplay || {};

    let buf = `version=${tt.ver_major}.${tt.ver_minor}.${tt.patchlevel}`;
    buf += `${XLOG_SEP}points=${tt.points}${XLOG_SEP}deathdnum=${tt.deathdnum}`
         + `${XLOG_SEP}deathlev=${tt.deathlev}`;
    buf += `${XLOG_SEP}maxlvl=${tt.maxlvl}${XLOG_SEP}hp=${tt.hp}`
         + `${XLOG_SEP}maxhp=${tt.maxhp}`;
    buf += `${XLOG_SEP}deaths=${tt.deaths}${XLOG_SEP}deathdate=${tt.deathdate}`
         + `${XLOG_SEP}birthdate=${tt.birthdate}${XLOG_SEP}uid=${tt.uid}`;
    fprintf(rfile, buf);
    buf = `${XLOG_SEP}role=${tt.plrole}${XLOG_SEP}race=${tt.plrace}`
        + `${XLOG_SEP}gender=${tt.plgend}${XLOG_SEP}align=${tt.plalign}`;
    // make a copy of death reason that doesn't include ", while helpless"
    const tmpbuf = formatkiller(DTHSZ + 1, how, false);
    fprintf(rfile, `${buf}${XLOG_SEP}name=${game.plname ?? ''}${XLOG_SEP}death=${tmpbuf}`);
    if ((game.multi ?? 0) < 0)
        fprintf(rfile, `${XLOG_SEP}while=${game.multi_reason || 'helpless'}`);
    fprintf(rfile, `${XLOG_SEP}conduct=0x${encodeconduct().toString(16)}`
                 + `${XLOG_SEP}turns=${game.moves ?? 0}`
                 + `${XLOG_SEP}achieve=0x${encodeachieve(false).toString(16)}`);
    fprintf(rfile, `${XLOG_SEP}achieveX=${encode_extended_achievements('')}`);
    fprintf(rfile, `${XLOG_SEP}conductX=${encode_extended_conducts('')}`);
    fprintf(rfile, `${XLOG_SEP}realtime=${game.urealtime?.realtime ?? 0}`
                 + `${XLOG_SEP}starttime=${game.ubirthday ?? 0}`
                 + `${XLOG_SEP}endtime=${game.urealtime?.finish_time ?? 0}`);
    fprintf(rfile, `${XLOG_SEP}gender0=${genders[game.initgend ?? 0]?.filecode}`
                 + `${XLOG_SEP}align0=${aligns[1 - (u.ualignbase?.[A_ORIGINAL] ?? 0)]?.filecode}`);
    fprintf(rfile, `${XLOG_SEP}flags=0x${encodexlogflags().toString(16)}`);
    fprintf(rfile, `${XLOG_SEP}gold=${money_cnt_invent() + hidden_gold(true)}`);
    fprintf(rfile, `${XLOG_SEP}wish_cnt=${uc.wishes ?? 0}`);
    fprintf(rfile, `${XLOG_SEP}arti_wish_cnt=${uc.wisharti ?? 0}`);
    fprintf(rfile, `${XLOG_SEP}bones=${rp.numbones ?? 0}`);
    fprintf(rfile, `${XLOG_SEP}rerolls=${rp.numrerolls ?? 0}`);
    fprintf(rfile, '\n');
}

// C ref: topten.c:393 encodexlogflags().
export function encodexlogflags() {
    let e = 0;
    const rp = game.u?.uroleplay || {};

    if (game.flags?.debug) e |= 1 << 0;                     /* wizard */
    if (game.flags?.explore || game.flags?.discover
        || game.flags?.playmode === 'explore') e |= 1 << 1; /* discover */
    if (!rp.numbones) e |= 1 << 2;
    if (rp.reroll) e |= 1 << 3;

    return e;
}

// C ref: topten.c:410 encodeconduct().
export function encodeconduct() {
    let e = 0;
    const uc = game.u?.uconduct || {};

    if (!uc.food) e |= 1 << 0;
    if (!uc.unvegan) e |= 1 << 1;
    if (!uc.unvegetarian) e |= 1 << 2;
    if (!uc.gnostic) e |= 1 << 3;
    if (!uc.weaphit) e |= 1 << 4;
    if (!uc.killer) e |= 1 << 5;
    if (!uc.literate) e |= 1 << 6;
    if (!uc.polypiles) e |= 1 << 7;
    if (!uc.polyselfs) e |= 1 << 8;
    if (!uc.wishes) e |= 1 << 9;
    if (!uc.wisharti) e |= 1 << 10;
    if (!num_genocides()) e |= 1 << 11;
    // one bit isn't really adequate for sokoban conduct: suppressing it when
    // sokoban was never entered risks reporting "violated sokoban rules" when
    // no such thing occurred; disambiguate via the achieve field's
    // entered-sokoban bit.
    if (!uc.sokocheat && sokoban_in_play()) e |= 1 << 12;
    if (!uc.pets) e |= 1 << 13;

    return e;
}

// C ref: topten.c:454 encodeachieve(secondlong).
// secondlong false: achievements 1..31; true: 32..62.
export function encodeachieve(secondlong) {
    const ach = game.u?.uachieved;
    let r = 0;

    // 32: portable limit for 'long'.  Forced even where long is 64 bits, and
    // kept to 31 bits because xlogfile post-processors may not handle
    // 'unsigned long'.
    const offset = secondlong ? (32 - 1) : 0;
    if (!Array.isArray(ach)) return r;
    for (let i = 0; ach[i]; ++i) {
        const achidx = ach[i] - offset;
        if (achidx > 0 && achidx < 32)  /* value 1..31 sets bit 0..30 */
            r |= 1 << (achidx - 1);
    }
    return r;
}

// C ref: topten.c:479 add_achieveX(buf, achievement, condition) — append the
// achievement/conduct to a comma-separated list.  C edits buf in place; this
// returns the new buffer.
export function add_achieveX(buf, achievement, condition) {
    if (condition) {
        if (buf !== '') buf += ',';
        buf += achievement;
    }
    return buf;
}

// C ref: topten.c:490 encode_extended_achievements(buf) — the xlogfile
// `achieveX` field: snake_case achievement names, in the order attained.
export function encode_extended_achievements(buf) {
    const ach = game.u?.uachieved;
    let achievement = null;

    buf = '';
    if (!Array.isArray(ach)) return buf;
    for (let i = 0; ach[i]; i++) {
        const achidx = ach[i];
        const absidx = Math.abs(achidx);
        switch (absidx) {
        case ACH_UWIN: achievement = 'ascended'; break;
        case ACH_ASTR: achievement = 'entered_astral_plane'; break;
        case ACH_ENDG: achievement = 'entered_elemental_planes'; break;
        case ACH_AMUL: achievement = 'obtained_the_amulet_of_yendor'; break;
        case ACH_INVK: achievement = 'performed_the_invocation_ritual'; break;
        case ACH_BOOK: achievement = 'obtained_the_book_of_the_dead'; break;
        case ACH_BELL: achievement = 'obtained_the_bell_of_opening'; break;
        case ACH_CNDL: achievement = 'obtained_the_candelabrum_of_invocation'; break;
        case ACH_HELL: achievement = 'entered_gehennom'; break;
        case ACH_MEDU: achievement = 'defeated_medusa'; break;
        case ACH_MINE_PRIZE: achievement = 'obtained_the_luckstone_from_the_mines'; break;
        case ACH_SOKO_PRIZE: achievement = 'obtained_the_sokoban_prize'; break;
        case ACH_ORCL: achievement = 'consulted_the_oracle'; break;
        case ACH_NOVL: achievement = 'read_a_discworld_novel'; break;
        case ACH_MINE: achievement = 'entered_the_gnomish_mines'; break;
        case ACH_TOWN: achievement = 'entered_mine_town'; break;
        case ACH_SHOP: achievement = 'entered_a_shop'; break;
        case ACH_TMPL: achievement = 'entered_a_temple'; break;
        case ACH_SOKO: achievement = 'entered_sokoban'; break;
        case ACH_BGRM: achievement = 'entered_bigroom'; break;
        case ACH_TUNE: achievement = 'learned_castle_drawbridge_tune'; break;
        default:
            // C spells out `case ACH_RNK1: .. case ACH_RNK8:` ahead of default;
            // 23..30 are contiguous so a range test is the same set.
            // rank 0 is the starting condition, not an achievement; 8 is Xp 30
            if (absidx >= ACH_RNK1 && absidx <= ACH_RNK8) {
                // a negative uachieved[] entry records the female rank title
                let rnkbuf = 'attained_the_rank_of_'
                    + rank_of(rank_to_xlev(absidx - (ACH_RNK1 - 1)),
                              game.urole?.mnum, achidx < 0);
                rnkbuf = strNsubst_all(rnkbuf, ' ', '_');   /* every ' ' -> '_' */
                achievement = lcase(rnkbuf);
                break;
            }
            continue;
        }
        buf = add_achieveX(buf, achievement, true);
    }

    return buf;
}

// C ref: topten.c:583 encode_extended_conducts(buf) — the xlogfile `conductX`
// field.  Order matters; it is the order C emits.
export function encode_extended_conducts(buf) {
    const uc = game.u?.uconduct || {};
    const rp = game.u?.uroleplay || {};

    buf = '';
    buf = add_achieveX(buf, 'foodless', !uc.food);
    buf = add_achieveX(buf, 'vegan', !uc.unvegan);
    buf = add_achieveX(buf, 'vegetarian', !uc.unvegetarian);
    buf = add_achieveX(buf, 'atheist', !uc.gnostic);
    buf = add_achieveX(buf, 'weaponless', !uc.weaphit);
    buf = add_achieveX(buf, 'pacifist', !uc.killer);
    buf = add_achieveX(buf, 'illiterate', !uc.literate);
    buf = add_achieveX(buf, 'polyless', !uc.polypiles);
    buf = add_achieveX(buf, 'polyselfless', !uc.polyselfs);
    buf = add_achieveX(buf, 'wishless', !uc.wishes);
    buf = add_achieveX(buf, 'artiwishless', !uc.wisharti);
    buf = add_achieveX(buf, 'genocideless', !num_genocides());
    if (sokoban_in_play())
        buf = add_achieveX(buf, 'sokoban', !uc.sokocheat);
    buf = add_achieveX(buf, 'blind', rp.blind);
    buf = add_achieveX(buf, 'deaf', rp.deaf);
    buf = add_achieveX(buf, 'nudist', rp.nudist);
    buf = add_achieveX(buf, 'pauper', rp.pauper);
    buf = add_achieveX(buf, 'bonesless', !game.flags?.bones);
    buf = add_achieveX(buf, 'petless', !uc.pets);
    buf = add_achieveX(buf, 'unrerolled', !rp.reroll);

    return buf;
}

// C ref: topten.c:614 free_ttlist(tt) — release the entry chain, including the
// zero-points terminator that ends it.  JS is garbage collected, so the walk
// only breaks the links; keeping the shape means a caller written against the
// C reads the same.
export function free_ttlist(tt) {
    let ttnext;

    while (tt && tt.points > 0) {
        ttnext = tt.tt_next;
        tt.tt_next = null;
        tt = ttnext;
    }
    if (tt) tt.tt_next = null;
    if (tt_head === tt) tt_head = null;
}

// topten() is NOT translated here — js/end.js topten_list() is this port's
// live implementation of the record merge.  See the header note.

// C ref: topten.c:928 outheader() — the column header, padded so "Hp [max]"
// lands flush against the right edge.
export function outheader() {
    let linebuf = ' No  Points     Name';
    while (linebuf.length < COLNO - 9) linebuf += ' ';
    linebuf += 'Hp [max]';
    topten_print(linebuf);
}

// C ref: topten.c:945 outentry(rank, t1, so) — format and print one score-list
// entry, wrapping onto as many lines as it takes to keep the "Hp [max]" column
// at the right edge.  so>0: standout (bold, padded to COLNO-1).
//
// js/end.js:1144 topten_outentry() is the live reduced copy: it takes the
// storage-JSON entry shape and omits the escaped/ascended/elemental-plane
// wording that this one carries.
export function outentry(rank, t1, so) {
    let second_line = true;
    let linebuf = '';
    let bp;

    if (rank) linebuf += String(rank).padStart(3);
    else linebuf += '   ';

    // "%10ld" of points, or u.urexp when the entry was floored to zero
    linebuf += ` ${String(t1.points ? t1.points : (game.u?.urexp ?? 0)).padStart(10)}`
             + `  ${t1.name.slice(0, 10)}`;
    linebuf += `-${t1.plrole}`;
    if (t1.plrace[0] !== '?') linebuf += `-${t1.plrace}`;
    // Printing of gender and alignment is intentional.  It has been part of
    // the NetHack Geek Code, and illustrates a proper way to specify a
    // character from the command line.
    linebuf += `-${t1.plgend}`;
    if (t1.plalign[0] !== '?') linebuf += `-${t1.plalign} `;
    else linebuf += ' ';

    const astral_dnum = game.astral_level?.dnum;
    const knox_dnum = game.knox_level?.dnum;

    if (t1.death.startsWith('escaped')) {
        linebuf += `escaped the dungeon ${
            t1.death.slice(7, 9) === ' (' ? t1.death.slice(7 + 2) : ''}[max level ${t1.maxlvl}]`;
        // fixup for closing paren in "escaped... with...Amulet)[max..."
        bp = linebuf.indexOf(')');
        if (bp >= 0)
            linebuf = (t1.deathdnum === astral_dnum)
                ? linebuf.slice(0, bp)
                : `${linebuf.slice(0, bp)} ${linebuf.slice(bp + 1)}`;
        second_line = false;
    } else if (t1.death.startsWith('ascended')) {
        linebuf += `ascended to demigod${(t1.plgend[0] === 'F') ? 'dess' : ''}-hood`;
        second_line = false;
    } else {
        if (t1.death.startsWith('quit')) {
            linebuf += 'quit';
            second_line = false;
        } else if (t1.death.startsWith('died of st')) {
            linebuf += 'starved to death';
            second_line = false;
        } else if (t1.death.startsWith('choked')) {
            linebuf += `choked on h${(t1.plgend[0] === 'F') ? 'er' : 'is'} food`;
        } else if (t1.death.startsWith('poisoned')) {
            linebuf += 'was poisoned';
        } else if (t1.death.startsWith('crushed')) {
            linebuf += 'was crushed to death';
        } else if (t1.death.startsWith('petrified by ')) {
            linebuf += 'turned to stone';
        } else {
            linebuf += 'died';
        }

        if (t1.deathdnum === astral_dnum) {
            let arg, fmt = ' on the Plane of %s';

            switch (t1.deathlev) {
            case -5: fmt = ' on the %s Plane'; arg = 'Astral'; break;
            case -4: arg = 'Water'; break;
            case -3: arg = 'Fire'; break;
            case -2: arg = 'Air'; break;
            case -1: arg = 'Earth'; break;
            default: arg = 'Void'; break;
            }
            linebuf += fmt.replace('%s', arg);
        } else {
            linebuf += ` in ${game.dungeons?.[t1.deathdnum]?.dname}`;
            if (t1.deathdnum !== knox_dnum) linebuf += ` on level ${t1.deathlev}`;
            if (t1.deathlev !== t1.maxlvl) linebuf += ` [max ${t1.maxlvl}]`;
        }

        // kludge for "quit while already on Charon's boat"
        if (t1.death.startsWith('quit ')) linebuf += t1.death.slice(4);
    }
    linebuf += '.';

    // Quit, starved, ascended, and escaped contain no second line
    if (second_line) {
        const at = linebuf.length;
        let tail = `  ${highc(t1.death.charAt(0))}${t1.death.slice(1)}.`;
        // fix up "Killed by Mr. Asidonhopo; the shopkeeper"; that starts with a
        // comma but has it changed to semi-colon to keep the comma out of
        // 'record'; change it back for display.  C runs strsubst() on the
        // SECOND-LINE segment only, so an earlier "; the " is left alone.
        tail = strsubst(tail, '; the ', ', the ');
        linebuf = linebuf.slice(0, at) + tail;
    }

    let lngr = linebuf.length;
    const hpbuf = (t1.hp <= 0) ? '-' : String(t1.hp);
    // beginning of hp column after padding (not actually padded yet)
    // C: COLNO - (sizeof "  Hp [max]" - sizeof "") == COLNO - 10
    let hppos = COLNO - 10;
    while (lngr >= hppos) {
        for (bp = linebuf.length; !(linebuf[bp] === ' ' && bp < hppos); bp--)
            if (bp < 0) break;
        // special case: word is too long, wrap in the middle
        if (15 >= bp) bp = hppos - 1;
        // special case: if about to wrap in the middle of maximum dungeon
        // depth reached, wrap in front of it instead
        if (bp > 5 && linebuf.slice(bp - 5, bp) === ' [max') bp -= 5;
        const linebuf3 = (linebuf[bp] !== ' ') ? linebuf.slice(bp) : linebuf.slice(bp + 1);
        linebuf = linebuf.slice(0, bp);
        if (so) {
            while (linebuf.length < COLNO - 1) linebuf += ' ';
            topten_print_bold(linebuf);
        } else {
            topten_print(linebuf);
        }
        linebuf = `${''.padStart(15)} ${linebuf3}`;     /* "%15s %s", "" */
        lngr = linebuf.length;
    }
    // beginning of hp column not including padding
    hppos = COLNO - 7 - hpbuf.length;

    if (linebuf.length <= hppos) {
        // pad any necessary blanks to the hit point entry
        while (linebuf.length < hppos) linebuf += ' ';
        linebuf += hpbuf;
        linebuf += ` ${(t1.maxhp < 10) ? '  ' : (t1.maxhp < 100) ? ' ' : ''}[${t1.maxhp}]`;
    }

    if (so) {
        while (linebuf.length < COLNO - 1) linebuf += ' ';
        topten_print_bold(linebuf);
    } else {
        topten_print(linebuf);
    }
}

// C ref: topten.c:1111 score_wanted(current_ver, rank, t1, playerct, players,
// uid) — does this record match the `-s` command line's selection?
//
// Upstream FIXME retained: the selection is a UNION of criteria, not an
// intersection, so `-u igor -p Cav` lists every igor plus every caveman.
export function score_wanted(current_ver, rank, t1, playerct, players, uid) {
    let arg, nxt;

    if (current_ver && (t1.ver_major !== VERSION_MAJOR
                        || t1.ver_minor !== VERSION_MINOR
                        || t1.patchlevel !== PATCHLEVEL))
        return 0;

    if (sysopt.pers_is_uid && !playerct && t1.uid === uid)
        return 1;

    for (let i = 0; i < playerct; i++) {
        arg = players[i];
        if (arg[0] === '-' && arg[1] === 'u' && arg[2] !== undefined)
            arg = arg.slice(2);                      /* handle '-uname' */

        if (arg[0] === '-' && 'pru'.includes(arg[1]) && arg[2] === undefined
            && i + 1 < playerct) {
            nxt = players[i + 1];
            if ((arg[1] === 'p' && str2role(nxt) === str2role(t1.plrole))
                || (arg[1] === 'r' && str2race(nxt) === str2race(t1.plrace))
                /* handle '-u name' */
                || (arg[1] === 'u' && (nxt === 'all'
                                       || t1.name.slice(0, NAMSZ) === nxt.slice(0, NAMSZ))))
                return 1;
            i++;
        } else if (arg === 'all'
                   || t1.name.slice(0, NAMSZ) === arg.slice(0, NAMSZ)
                   || (arg[0] === '-' && arg[1] === t1.plrole[0] && arg[2] === undefined)
                   || (/^[0-9]/.test(arg) && rank <= parseInt(arg, 10)))
            return 1;
    }
    return 0;
}

// C ref: topten.c:1193 prscore(argc, argv) — print selected parts of the score
// list.  argc >= 2, argv[0] untrustworthy, argv[1] starting with "-s".
//
// `record` is this port's stand-in for the RECORD file's contents: C opens it
// with fopen_datafile(), which we have no filesystem for.  raw_printf() output
// goes through the same tt_output sink as topten_print().
export function prscore(argc, argv, record) {
    let players, player0;
    let playerct, rank;
    let t1;
    let pbuf, p;
    let uid = -1;
    let current_ver = true, init_done = false, match_found = false;

    // expect "-s" or "--scores"; "-s<anything>" is accepted
    p = (argc < 2) ? -1 : argv[1].indexOf(' ');
    const ln = (argc < 2) ? 0 : (p >= 0 ? p : argv[1].length);
    if (ln < 2 || (argv[1].slice(0, 2) !== '-s' && argv[1] !== '--scores')) {
        raw_print(`prscore: bad arguments (${argc})`);
        return;
    }

    const rfile = (record === undefined || record === null) ? null : ttfile_reader(record);
    if (!rfile) {
        raw_print('Cannot open record file!');
        return;
    }

    // If the score list isn't after a game, we never went through
    // initialization.  dlb_init()/init_dungeons() have no counterpart here;
    // the flag still drives the matching cleanup below.
    if (!game.wiz1_level?.dlevel) {
        init_done = true;
    }

    // to get here, argv[1] either starts with "-s" or is "--scores" without
    // trailing stuff; for "-s<anything>" treat <anything> as separate arg
    argv = argv.slice();
    if (argv[1][1] === '-' || !argv[1][2]) {
        argc--;
        argv = argv.slice(1);
    } else {   /* concatenated arg string; use up "-s" but keep argc,argv */
        argv[1] = argv[1].slice(2);
    }
    // -v doesn't take a version number arg; it means 'all versions present in
    // the file' instead of the default of only the current version
    if (argc > 1 && argv[1] === '-v') {
        current_ver = false;
        argc--;
        argv = argv.slice(1);
    }

    if (argc <= 1) {
        if (sysopt.pers_is_uid) {
            uid = getuid();
            playerct = 0;
            players = null;
        } else {
            player0 = game.plname ?? '';
            if (!player0)
                player0 = 'all';   /* if no plname[], show all scores */
            playerct = 1;
            players = [player0];
        }
    } else {
        playerct = --argc;
        players = argv.slice(1);
    }
    raw_print('');

    t1 = tt_head = zerott();
    for (rank = 1; ; rank++) {
        readentry(rfile, t1);
        if (t1.points === 0) break;
        if (!match_found
            && score_wanted(current_ver, rank, t1, playerct, players, uid))
            match_found = true;
        t1.tt_next = zerott();
        t1 = t1.tt_next;
    }

    if (init_done) {
        /* C: free_dungeons(); dlb_cleanup(); */
    }

    if (match_found) {
        outheader();
        t1 = tt_head;
        for (rank = 1; t1.points !== 0; rank++, t1 = t1.tt_next) {
            if (score_wanted(current_ver, rank, t1, playerct, players, uid))
                outentry(rank, t1, false);
        }
    } else {
        pbuf = `Cannot find any ${current_ver ? 'current ' : ''}entries for `;
        if (playerct < 1) {
            pbuf += 'you';
        } else {
            // minor bug: 'nethack -s -u ziggy' will say "any of" even though
            // the '-u' doesn't indicate multiple names
            if (playerct > 1) pbuf += 'any of ';
            for (let i = 0; i < playerct; i++) {
                // accept '-u name' and '-uname' as well as just 'name' so skip
                // '-u' for the none-found feedback
                if (players[i].slice(0, 2) === '-u') {
                    if (!players[i][2]) continue;
                    players[i] = players[i].slice(2);
                }
                // stop printing players if there are too many to fit
                if (pbuf.length + players[i].length + 2 >= BUFSZ) {
                    if (pbuf.length < BUFSZ - 4) pbuf += '...';
                    else pbuf = `${pbuf.slice(0, pbuf.length - 4)}...`;
                    break;
                }
                pbuf += players[i];
                if (i < playerct - 1) {
                    if (players[i][0] === '-' && 'pr'.includes(players[i][1])
                        && players[i][2] === undefined)
                        pbuf += ' ';
                    else
                        pbuf += ':';
                }
            }
        }
        // append end-of-sentence punctuation if there is room
        if (pbuf.length < BUFSZ - 1) pbuf += '.';
        raw_print(pbuf);
        raw_print(`Usage: ${game.hname ?? 'nethack'} -s [-v] <playertypes>`
                  + ' [maxrank] [playernames]');
        raw_print('Player types are: [-p role] [-r race]');
    }
    free_ttlist(tt_head);
}

// unixunix.c getuid() — one uid for the whole session in this port.
function getuid() { return game.uid ?? 0; }

// C ref: topten.c:1355 classmon(plch) — the mons[] index of the role whose
// filecode is `plch`.
//
// GOTCHA: C's roles[].mnum IS the mons[] index (PM_ARCHEOLOGIST..PM_WIZARD);
// js/role.js's `mnum` is the 0..12 ROLE index instead ([[umonnum-is-a-role-
// index]]).  The thirteen player monsters are contiguous and in role order, so
// the mons[] index is PM_ARCHEOLOGIST + roles[i].mnum.
export function classmon(plch) {
    const plch3 = String(plch ?? '').slice(0, ROLESZ);

    /* Look for this role in the role table */
    for (let i = 0; i < roles.length && roles[i].name.m; i++) {
        if (plch3 === String(roles[i].filecode).slice(0, ROLESZ)) {
            if (roles[i].mnum !== NON_PM)
                return PM_ARCHEOLOGIST + roles[i].mnum;
            else
                return PM_HUMAN;
        }
    }
    /* this might be from a 3.2.x score for former Elf class */
    if (plch === 'E') return PM_RANGER;

    /* C: impossible("What weird role is this? (%s)", plch); */
    return PM_HUMAN_MUMMY;
}

// topten.c:1380 get_rnd_toptenentry(), :1421 tt_oname() and :1444 tt_doppel()
// are already ported: js/mkobj.js:2453/2461 and js/makemon.js:2898/2906.  They
// are the RNG-bearing part of this file and are deliberately not re-copied.

// ---------------------------------------------------------------------------
// NO_SCAN_BRACK block (topten.c:1465-1485).  Lattice scanf can't read the
// scorefile; not our platform, so these are compiled out upstream.  C mungs
// the string in place; these return the new string.
// ---------------------------------------------------------------------------

// C ref: topten.c:1470 nsb_mung_line() — every ' ' becomes '|'.
export function nsb_mung_line(p) {
    return String(p ?? '').split(' ').join('|');
}

// C ref: topten.c:1478 nsb_unmung_line() — every '|' becomes ' '.
export function nsb_unmung_line(p) {
    return String(p ?? '').split('|').join(' ');
}

/*topten.js*/
