// rumors.js — C ref: src/rumors.c, the Oracle half.
//
// init_rumors()/getrumor()/get_rnd_line()/get_rnd_text()/outrumor() already
// live in js/engrave.js (they were needed for random engravings).  What was
// missing is everything the Oracle uses: init_oracles(), outoracle() and
// doconsult(), plus outrumor()'s BY_ORACLE arm — whose "offhandedly /
// casually / nonchalantly" adverb costs up to three real rn2() draws that no
// other rumor path makes.

import { game } from './gstate.js';
import { rn2, rnd } from './rng.js';
import { update_topl } from './display.js';
import { ORACLES_B64 } from './oracles_data.js';
import { outrumor, BY_ORACLE } from './engrave.js';

const ECMD_OK = 0x00, ECMD_TIME = 0x01;   // hack.h:1456
const BUFSZ = 256;
const COLNO = 80;

function decodeBase64(b64) {
    if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
const ORACLES_DATA = decodeBase64(ORACLES_B64);

// C ref: hacklib.c xcrypt() — the symmetric bit-rotation cipher, restarted for
// every line (bitmask is a local).
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

// dlb_fgets: read from `pos` up to and including the first '\n', or `max`-1
// bytes, or EOF.
function dlb_fgets(data, pos, max) {
    let s = '';
    let i = pos;
    while (i < data.length && s.length < max - 1) {
        const c = String.fromCharCode(data[i]);
        s += c;
        i++;
        if (c === '\n') break;
    }
    return { line: s, next: i };
}

// C ref: rumors.c:577 init_oracles(fp) — skip the "don't edit" comment, read
// the count, then that many "%5lx" offsets.  Called once; oracle_loc is then
// mutated by outoracle() as oracularities are used up.
let _oracles = null;
function init_oracles() {
    if (_oracles) return _oracles;
    let { next } = dlb_fgets(ORACLES_DATA, 0, BUFSZ);       /* comment */
    let line;
    ({ line, next } = dlb_fgets(ORACLES_DATA, next, BUFSZ));
    const cnt = parseInt(line, 10);
    const loc = [];
    if (cnt > 0) {
        for (let i = 0; i < cnt; i++) {
            ({ line, next } = dlb_fgets(ORACLES_DATA, next, BUFSZ));
            loc.push(parseInt(line.trim(), 16));
        }
    }
    _oracles = { cnt: cnt > 0 ? cnt : 0, loc };
    return _oracles;
}

// C ref: rumors.c:640 outoracle(special, delphi).  The one draw is
// rnd(oracle_cnt - 1) for a non-special oracularity; the chosen slot is then
// overwritten by the last one and the count shrinks, so repeat consultations
// never repeat text.
export async function outoracle(special, delphi) {
    const o = init_oracles();
    if (o.cnt === 0) return;
    if (o.cnt <= 1 && !special) return;

    const oracle_idx = special ? 0 : rnd(o.cnt - 1);
    const start = o.loc[oracle_idx];
    if (!special) o.loc[oracle_idx] = o.loc[--o.cnt];

    await update_topl(delphi
        ? (special ? 'The Oracle scornfully takes all your gold and says:'
                   : 'The Oracle meditates for a moment and then intones:')
        : 'The message reads:');
    await update_topl('');

    let pos = start;
    for (;;) {
        const r = dlb_fgets(ORACLES_DATA, pos, COLNO);
        if (!r.line.length || r.line === '---\n') break;
        pos = r.next;
        let line = r.line;
        const nl = line.indexOf('\n');
        if (nl >= 0) line = line.slice(0, nl);
        await update_topl(xcrypt(line));
    }
}

// C ref: rumors.c:529 outrumor()'s BY_ORACLE arm — the adverb costs rn2(4),
// then rn2(3), then rn2(2), short-circuited left to right.
async function oracle_says(truth) {
    const line = outrumor(truth, BY_ORACLE);
    const adverb = !rn2(4) ? 'offhandedly '
                 : (!rn2(3) ? 'casually '
                            : (rn2(2) ? 'nonchalantly ' : ''));
    await update_topl(`True to her word, the Oracle ${adverb}says: `);
    await update_topl(`"${line}"`);
}

// C ref: rumors.c:696 doconsult(oracl) — #chat with the Oracle.
export async function doconsult(oracl) {
    const u = game.u;
    const { money_cnt_invent } = await import('./shk.js');
    const { ynq, currency } = await import('./invent.js');
    const { y_n } = await import('./display.js');
    const { money2mon } = await import('./shk.js');
    const { Monnam } = await import('./uhitm.js');
    const { exercise } = await import('./attrib.js');
    const minor_cost = 50, major_cost = 500 + 50 * (u.ulevel | 0);
    let u_pay;

    game.multi = 0;
    const umoney = money_cnt_invent();

    if (!oracl) {
        await update_topl('There is no one here to consult.');
        return ECMD_OK;
    } else if (!oracl.mpeaceful) {
        await update_topl(`${Monnam(oracl)} is in no mood for consultations.`);
        return ECMD_OK;
    } else if (!umoney) {
        await update_topl('You have no gold.');
        return ECMD_OK;
    }

    const o = init_oracles();
    const c = await ynq(`"Wilt thou settle for a minor consultation?" (${
        minor_cost} ${currency(minor_cost)})`);
    if (c === 'y') {
        if (umoney < minor_cost) {
            await update_topl("You don't even have enough gold for that!");
            return ECMD_OK;
        }
        u_pay = minor_cost;
    } else if (c === 'n') {
        if (umoney <= minor_cost || o.cnt === 1) return ECMD_OK;
        const c2 = await y_n(`"Then dost thou desire a major one?" (${
            major_cost} ${currency(major_cost)})`);
        if (c2 !== 'y') return ECMD_OK;
        u_pay = (umoney < major_cost) ? umoney : major_cost;
    } else {
        return ECMD_OK;                                   /* 'q' */
    }

    await money2mon(oracl, u_pay);
    game.disp = game.disp || {};
    game.disp.botl = true;
    u.uevent = u.uevent || {};
    let add_xpts = 0;
    if (u_pay === minor_cost) {
        await oracle_says(1);
        if (!u.uevent.minor_oracle)
            add_xpts = Math.trunc(u_pay / (u.uevent.major_oracle ? 25 : 10));
        u.uevent.minor_oracle = true;
    } else {
        const cheapskate = u_pay < major_cost;
        await outoracle(cheapskate, true);
        if (!cheapskate && !u.uevent.major_oracle)
            add_xpts = Math.trunc(u_pay / (u.uevent.minor_oracle ? 25 : 10));
        u.uevent.major_oracle = true;
        exercise(2 /*A_WIS*/, !cheapskate);
    }
    if (add_xpts) {
        const { more_experienced, newexplevel } = await import('./exper.js');
        more_experienced(add_xpts, Math.trunc(u_pay / 50));
        await newexplevel();
    }
    return ECMD_TIME;
}

// ===========================================================================
// rumors.c: the remaining top-level functions, translated.  APPEND-ONLY —
// nothing above this line calls anything below it.
//
// Three of the seven are wizard-mode / save-file plumbing (rumor_check,
// others_check, save_oracles/restore_oracles) and two build the CapMons[]
// table that the() consults for capitalized monster names.
// ===========================================================================

import { RUMORS_B64, ENGRAVE_B64 } from './rumors_data.js';
import { EPITAPH_B64 } from './epitaph_data.js';
import { BOGUSMON_B64 } from './bogusmon_data.js';
import { monster_by_pmidx } from './makemon.js';
import { mflags2_of, M2_PNAME } from './monflags_data.js';
import { bogon_is_pname } from './do_name.js';

// C ref: global.h:19-32 — the makedefs-built dlb data files.  dlb_fopen(fname)
// becomes a lookup into the embedded copy of the very bytes the C recorder read.
const RUMORFILE = 'rumors', ORACLEFILE = 'oracles', EPITAPHFILE = 'epitaph',
      ENGRAVEFILE = 'engrave', BOGUSMONFILE = 'bogusmon';
const DLB_FILES = {
    [RUMORFILE]: () => decodeBase64(RUMORS_B64),
    [ORACLEFILE]: () => ORACLES_DATA,
    [ENGRAVEFILE]: () => decodeBase64(ENGRAVE_B64),
    [EPITAPHFILE]: () => decodeBase64(EPITAPH_B64),
    [BOGUSMONFILE]: () => decodeBase64(BOGUSMON_B64),
};
const _dlb_cache = new Map();
// C ref: dlb.c dlb_fopen(name, "r") — returns 0 when the file is missing.
function dlb_fopen(fname) {
    if (!(fname in DLB_FILES)) return null;
    if (!_dlb_cache.has(fname)) _dlb_cache.set(fname, DLB_FILES[fname]());
    return { data: _dlb_cache.get(fname), pos: 0 };
}
function dlb_fclose(_fh) { /* nothing to release */ }
// C ref: dlb.c dlb_fgets(buf, len, fh) — returns 0 at EOF.
function dlb_fgets_fh(fh, max = BUFSZ) {
    if (!fh || fh.pos >= fh.data.length) return null;
    const r = dlb_fgets(fh.data, fh.pos, max);
    fh.pos = r.next;
    return r.line;
}
function dlb_fseek(fh, offset) { fh.pos = offset; }
function dlb_ftell(fh) { return fh.pos; }

// C ref: win/tty/wintty.c create_nhwindow/putstr/display_nhwindow/
// destroy_nhwindow — text sinks, exactly as js/end.js:1375 models them
// (frozen/terminal.js owns the grid; coverage.mjs marks wintty.c N/A).
const NHW_TEXT = 5, WIN_ERR = -1;
function create_nhwindow(type) { return { type, lines: [] }; }
function putstr(win, _attr, str) {
    if (win && win !== WIN_ERR && Array.isArray(win.lines)) win.lines.push(str);
}
function display_nhwindow(_win, _blocking) { /* wiring pass renders win.lines */ }
function destroy_nhwindow(_win) { }

// C ref: rumors.c:85 init_rumors(fp) — the true/false region header.  The
// faithful port is PRIVATE at js/engrave.js:126 (its _rumorMeta memo); the fix
// is to export that one rather than keep a second parse alive, so this reads
// the same header with the same regex and is used only by rumor_check().
function init_rumors_meta() {
    const data = dlb_fopen(RUMORFILE)?.data;
    if (!data) return null;
    const { next: p1 } = dlb_fgets(data, 0, BUFSZ);     /* "don't edit" */
    const { line: header } = dlb_fgets(data, p1, BUFSZ);
    const m = header.match(
        /^(\d+),(\d+),([0-9a-fA-F]+);(\d+),(\d+),([0-9a-fA-F]+);0,0,([0-9a-fA-F]+)/);
    if (!m) return null;
    const true_size = parseInt(m[2], 10), true_start = parseInt(m[3], 16);
    const false_size = parseInt(m[5], 10), false_start = parseInt(m[6], 16);
    return {
        true_rumor_start: true_start, true_rumor_size: true_size,
        true_rumor_end: true_start + true_size,
        false_rumor_start: false_start, false_rumor_size: false_size,
        false_rumor_end: false_start + false_size,
    };
}

// C ref: rumors.c:196 rumor_check() — the wizard-mode '#wizrumorcheck'
// diagnostic: dump the true/false rumor boundaries plus the first two and the
// very last entry of engrave / epitaph / bogusmon.
export async function rumor_check() {
    const winbox = { value: WIN_ERR };      /* C: winid tmpwin; &tmpwin below */
    let rumor_buf = '', line, endp;

    const meta = init_rumors_meta();
    const rumors = meta ? dlb_fopen(RUMORFILE) : null;
    let no_rumors = false;
    if (rumors) {
        let ftell_rumor_start = 0;

        winbox.value = create_nhwindow(NHW_TEXT);
        const tmpwin = winbox.value;

        /* reveal the values. */
        putstr(tmpwin, 0, `T start=${pad6(meta.true_rumor_start)} (${
            hex6(meta.true_rumor_start)}), end=${pad6(meta.true_rumor_end)} (${
            hex6(meta.true_rumor_end)}), size=${pad6(meta.true_rumor_size)} (${
            hex6(meta.true_rumor_size)})`);
        putstr(tmpwin, 0, `F start=${pad6(meta.false_rumor_start)} (${
            hex6(meta.false_rumor_start)}), end=${pad6(meta.false_rumor_end)} (${
            hex6(meta.false_rumor_end)}), size=${pad6(meta.false_rumor_size)} (${
            hex6(meta.false_rumor_size)})`);

        /*
         * check the first rumor (start of true rumors) by skipping the first
         * two lines, then seek to the start of the false rumors and show it.
         */
        dlb_fseek(rumors, meta.true_rumor_start);
        ftell_rumor_start = dlb_ftell(rumors);
        line = dlb_fgets_fh(rumors) || '';
        if ((endp = line.indexOf('\n')) >= 0) line = line.slice(0, endp);
        putstr(tmpwin, 0, `T ${pad6(ftell_rumor_start)} ${xcrypt(line)}`);
        /* find last true rumor */
        for (;;) {
            const nxt = dlb_fgets_fh(rumors);
            if (!nxt || dlb_ftell(rumors) >= meta.true_rumor_end) break;
            line = nxt;
        }
        if ((endp = line.indexOf('\n')) >= 0) line = line.slice(0, endp);
        putstr(tmpwin, 0, `  ${' '.repeat(6)} ${xcrypt(line)}`);

        dlb_fseek(rumors, meta.false_rumor_start);
        ftell_rumor_start = dlb_ftell(rumors);
        line = dlb_fgets_fh(rumors) || '';
        if ((endp = line.indexOf('\n')) >= 0) line = line.slice(0, endp);
        putstr(tmpwin, 0, `F ${pad6(ftell_rumor_start)} ${xcrypt(line)}`);
        /* find last false rumor */
        for (;;) {
            const nxt = dlb_fgets_fh(rumors);
            if (!nxt || dlb_ftell(rumors) >= meta.false_rumor_end) break;
            line = nxt;
        }
        if ((endp = line.indexOf('\n')) >= 0) line = line.slice(0, endp);
        putstr(tmpwin, 0, `  ${' '.repeat(6)} ${xcrypt(line)}`);

        dlb_fclose(rumors);
    } else if (meta === null && dlb_fopen(RUMORFILE)) {
        /* file could be opened but init_rumors() didn't like it */
        no_rumors = true;
    } else {
        /* first attempt to open file has just failed */
        await couldnt_open_file(RUMORFILE);
    }
    if (no_rumors) {
        await update_topl('rumors not accessible.');
        /* engravings, epitaphs, and bogus monsters will still be shown */
        display_nhwindow(/*WIN_MESSAGE*/ null, true); /* --more-- */
    }

    /* initial implementation of default epitaph/engraving/bogusmon
       contained an error; check those along with rumors */
    await others_check('Engravings:', ENGRAVEFILE, winbox);
    await others_check('Epitaphs:', EPITAPHFILE, winbox);
    await others_check('Bogus monsters:', BOGUSMONFILE, winbox);

    if (winbox.value !== WIN_ERR) {
        display_nhwindow(winbox.value, true);
        destroy_nhwindow(winbox.value);
    }
    return winbox.value;   /* C is void; returned so a caller can render it */
}

// C's "%06ld" / "%06lx" for the boundary dump.
function pad6(n) { return String(n).padStart(6, '0'); }
function hex6(n) { return (n >>> 0).toString(16).padStart(6, '0'); }

// C ref: rumors.c:308 others_check(ftype, fname, winptr) — show the first two
// and the last entry of one of the plain (no true/false split) data files.
// `winptr` is C's `winid *`: a { value } box, mirroring steal.c's objnambuf
// convention already used in js/steal.js.
export async function others_check(ftype, fname, winptr) {
    const errfmt = (f, m) => `others_check("${f}"): ${m}`;
    let tmpwin = winptr.value;
    let entrycount = 0;
    let line, xbuf = '', endp;

    const fh = dlb_fopen(fname);
    if (fh) {
        if (tmpwin === WIN_ERR) {
            winptr.value = tmpwin = create_nhwindow(NHW_TEXT);
            if (tmpwin === WIN_ERR) {
                /* should panic, but won't for wizard mode check operation */
                await impossible_r(errfmt(fname, "can't create temporary window"));
                dlb_fclose(fh);
                return;
            }
        }
        putstr(tmpwin, 0, '');
        putstr(tmpwin, 0, ftype);
        /* "don't edit" comment */
        line = dlb_fgets_fh(fh);
        if (!line) {
            putstr(tmpwin, 0, errfmt(fname, "error; can't read comment line"));
            dlb_fclose(fh);
            return;
        }
        if (line[0] !== '#') {
            putstr(tmpwin, 0,
                   errfmt(fname,
                          'malformed; first line is not a comment line:'));
            /* show the bad line; we don't know whether it has been
               encrypted via xcrypt() so show it both ways */
            if ((endp = line.indexOf('\n')) >= 0) line = line.slice(0, endp);
            putstr(tmpwin, 0, '- first line, as is');
            putstr(tmpwin, 0, line);
            putstr(tmpwin, 0, '- xcrypt of first line');
            putstr(tmpwin, 0, xcrypt(line));
            dlb_fclose(fh);
            return;
        }
        /* first line; should be the default one inserted by makedefs */
        line = dlb_fgets_fh(fh);
        if (!line || line === '\n') {
            putstr(tmpwin, 0,
                   errfmt(fname, !line ? "can't read first non-comment line"
                                       : 'first non-comment line is empty'));
            dlb_fclose(fh);
            return;
        }
        ++entrycount;
        if ((endp = line.indexOf('\n')) >= 0) line = line.slice(0, endp);
        xbuf = xcrypt(line);
        putstr(tmpwin, 0, xbuf);
        line = dlb_fgets_fh(fh);
        if (!line) {
            putstr(tmpwin, 0, '(no second entry)');
        } else {
            ++entrycount;
            if ((endp = line.indexOf('\n')) >= 0) line = line.slice(0, endp);
            xbuf = xcrypt(line);
            putstr(tmpwin, 0, xbuf);
            for (;;) {
                line = dlb_fgets_fh(fh);
                if (!line) break;
                ++entrycount;
                if ((endp = line.indexOf('\n')) >= 0) line = line.slice(0, endp);
                xbuf = xcrypt(line);
            }
            /* count will be 2 if the default entry and the first ordinary
               entry are the only ones present */
            if (entrycount === 2) {
                putstr(tmpwin, 0, '(only two entries)');
            } else {
                /* showing an ellipsis avoids ambiguity about whether there
                   are other lines */
                if (entrycount > 3)
                    putstr(tmpwin, 0, ' ...');
                putstr(tmpwin, 0, xbuf); /* already decrypted */
            }
        }
        dlb_fclose(fh);
    } else {
        /* since this comes out via impossible(), it won't be integrated with
           the text window of values, but it shouldn't ever happen */
        await couldnt_open_file(fname);
    }
}

// C ref: rumors.c:770 couldnt_open_file(filename) — impossible() with the
// "saving and restoring might fix this" hint suppressed, because a missing data
// file is not a corrupt-state problem.
export async function couldnt_open_file(filename) {
    game.program_state = game.program_state || {};
    const save_something = game.program_state.something_worth_saving;

    if (!game.iflags?.debug_fuzzer)
        game.program_state.something_worth_saving = 0;

    await impossible_r(`Can't open '${filename}' file.`);
    game.program_state.something_worth_saving = save_something;
}

// C ref: pline.c impossible() — js/display.js:2664 owns it.  Loaded lazily:
// display.js is a heavy module and rumors.js is imported from the Oracle path.
async function impossible_r(msg) {
    const { impossible } = await import('./display.js');
    await impossible(msg);
}

// hack.h:964-972 NHFILE mode bits and the sfbase.c Sfo_/Sfi_ marshalling
// (coverage.mjs marks sfbase.c/sfstruct.c N/A); mirrors js/end.js:1960.
const COUNTING = 1, WRITING = 2, FREEING = 8;
function update_file(nhfp) { return ((nhfp?.mode | 0) & (COUNTING | WRITING)); }
function release_data(nhfp) { return ((nhfp?.mode | 0) & FREEING); }
function Sfo_ulong(nhfp, val, _tag) {
    if (nhfp && Array.isArray(nhfp.records)) nhfp.records.push(val);
}
function Sfi_ulong(nhfp, _tag) {
    if (!nhfp || !Array.isArray(nhfp.records)) return 0;
    const v = nhfp.records.shift();
    return v == null ? 0 : v;
}

// C ref: rumors.c:598 save_oracles(nhfp) — svo.oracle_cnt then that many
// svo.oracle_loc[] offsets; the FREEING pass drops the table and clears
// go.oracle_flg so a later outoracle() re-runs init_oracles().
export function save_oracles(nhfp) {
    const o = init_oracles();

    if (update_file(nhfp)) {
        Sfo_ulong(nhfp, o.cnt, 'oracle-oracle_cnt');
        if (o.cnt) {
            for (let i = 0; i < o.cnt; ++i)
                Sfo_ulong(nhfp, o.loc[i], 'oracle-oracle_loc');
        }
    }
    if (release_data(nhfp)) {
        if (o.cnt) {
            o.cnt = 0;
            game.oracle_flg = 0;
        }
        if (o.loc) o.loc.length = 0;
    }
}

// C ref: rumors.c:623 restore_oracles(nhfp) — reload the table and set
// go.oracle_flg so init_oracles() is not called again.
export function restore_oracles(nhfp) {
    const cnt = Sfi_ulong(nhfp, 'oracle-oracle_cnt') | 0;
    const loc = [];

    if (cnt) {
        for (let i = 0; i < cnt; ++i)
            loc.push(Sfi_ulong(nhfp, 'oracle-oracle_loc'));
        game.oracle_flg = 1; /* no need to call init_oracles() */
    }
    _oracles = { cnt, loc };
    return _oracles;
}

// ── CapMons[]: the capitalized-monster-name list the() consults ─────────────
// C ref: rumors.c:801 CapitalMon()'s lazily-built table.  Module state mirrors
// decl.c's CapMons / CapMonSiz / CapMonstCnt / CapBogonCnt.
let CapMons = null, CapMonSiz = 0, CapMonstCnt = 0, CapBogonCnt = 0;

// C ref: monflag.h:194 G_UNIQ, mondata.h:135 type_is_pname(ptr),
// mondata.h the_unique_pm(ptr) = G_UNIQ && !type_is_pname.
const G_UNIQ = 0x1000;
function type_is_pname_r(ptr) { return (mflags2_of(ptr) & M2_PNAME) !== 0; }
function the_unique_pm_r(ptr) {
    return ((ptr?.geno | 0) & G_UNIQ) !== 0 && !type_is_pname_r(ptr);
}
// C ref: do_name.c:1365 bogon_codes[] — the per-line classification prefixes.
const bogon_codes = '-_+|=';
// C ref: monflag.h:215 enum mgender { MALE, FEMALE, NEUTRAL, NUM_MGENDERS }.
const MALE = 0, FEMALE = 1, NEUTRAL = 2, NUM_MGENDERS = 3;
// C ref: mons[].pmnames[] — this port stores pmnames[NEUTRAL] as MONS[].name
// and the 15 NAMS() gendered pairs in a private table in js/makemon.js, so the
// MALE/FEMALE slots are recovered by name lookup (an unpaired species has NULL
// in both, exactly like C).
const PMNAMES_GENDERED = new Map([
    ['dwarf leader', ['dwarf lord', 'dwarf lady']],
    ['dwarf ruler', ['dwarf king', 'dwarf queen']],
    ['kobold leader', ['kobold lord', 'kobold lady']],
    ['gnome leader', ['gnome lord', 'gnome lady']],
    ['gnome ruler', ['gnome king', 'gnome queen']],
    ['ogre leader', ['ogre lord', 'ogre lady']],
    ['ogre tyrant', ['ogre king', 'ogre queen']],
    ['vampire leader', ['vampire lord', 'vampire lady']],
    ['elf-noble', ['elf-lord', 'elf-lady']],
    ['elven monarch', ['Elvenking', 'Elvenqueen']],
    ['aligned cleric', ['priest', 'priestess']],
    ['high cleric', ['high priest', 'high priestess']],
    ['amorous demon', ['incubus', 'succubus']],
    ['cave dweller', ['caveman', 'cavewoman']],
    ['cleric', ['priest', 'priestess']],
]);
function pmnames_of(ptr, mgend) {
    if (mgend === NEUTRAL) return ptr?.name || null;
    const pair = PMNAMES_GENDERED.get(ptr?.name);
    return pair ? pair[mgend] : null;
}
// C ref: hacklib.c lowc(c) — is the first character already lower case?
function is_capitalized(nam) { return !!nam && nam[0] !== nam[0].toLowerCase(); }

// C ref: rumors.c:829 init_CapMons() — one-time build of the capitalized
// monster-name list: mons[].pmnames[] entries that start with a capital (for
// non-unique species and for uniques whose "name" is a title), followed by the
// same from the hallucinatory 'bogusmon' file.  C makes two passes because it
// has to size the allocation first; both passes are kept so CapMonstCnt /
// CapBogonCnt / CapMonSiz end up with C's values.
export function init_CapMons() {
    const bogonfile = dlb_fopen(BOGUSMONFILE);

    if (CapMons) /* sanity precaution */
        free_CapMons();

    /* first pass: count; second pass: populate */
    for (let pass = 1; pass <= 2; ++pass) {
        CapMonstCnt = CapBogonCnt = 0;

        /* gather applicable actual monsters */
        for (let mndx = LOW_PM_R; mndx < NUMMONS_R(); ++mndx) {
            const mptr = monster_by_pmidx(mndx);
            if (!mptr) continue;
            if (((mptr.geno | 0) & G_UNIQ) !== 0 && !the_unique_pm_r(mptr))
                continue;
            for (let mgend = MALE; mgend < NUM_MGENDERS; ++mgend) {
                const nam = pmnames_of(mptr, mgend);
                if (nam && is_capitalized(nam)) {
                    if (pass === 2) CapMons[CapMonstCnt] = nam;
                    ++CapMonstCnt;
                }
            }
        }

        /* now gather applicable hallucinatory monsters */
        if (bogonfile) {
            /* rewind; effectively a no-op for pass 1, essential for pass 2 */
            dlb_fseek(bogonfile, 0);
            /* skip "don't edit" comment (first line of file) */
            dlb_fgets_fh(bogonfile);

            for (;;) {
                let hline = dlb_fgets_fh(bogonfile);
                if (!hline) break;
                const nl = hline.indexOf('\n');
                if (nl >= 0) hline = hline.slice(0, nl); /* strip newline */
                const xbuf = unpadline_r(xcrypt(hline));

                let code, startp;
                if (!xbuf[0] || !bogon_codes.includes(xbuf[0]))
                    code = '', startp = xbuf;              /* ordinary */
                else
                    code = xbuf[0], startp = xbuf.slice(1); /* special */

                if (is_capitalized(startp) && !bogon_is_pname(code)) {
                    if (pass === 2)
                        CapMons[CapMonstCnt + CapBogonCnt] = startp;
                    ++CapBogonCnt;
                }
            }
        }

        /* finish the current pass */
        if (pass === 1) {
            CapMonSiz = CapMonstCnt + CapBogonCnt + 1; /* +1: terminator */
            CapMons = new Array(CapMonSiz);
        } else { /* pass == 2 */
            CapMons[CapMonSiz - 1] = null;  /* terminator; not strictly needed */
            if (bogonfile) dlb_fclose(bogonfile);
        }
    }
    return CapMons;
}

// C ref: rumors.c:939 free_CapMons() — release the table.  In C the bogon half
// is dupstr()'d and must be freed while the mons[] half is string literals;
// there is nothing to free here, only the state to clear.
export function free_CapMons() {
    if (CapMons) {
        /* C: free CapMons[CapMonstCnt .. CapMonSiz-2], then CapMons itself */
        CapMons = null;
    }
    CapMonSiz = 0;
}

// C ref: rumors.c:791 CapitalMon(word) — the reader of the table above.  Not in
// coverage.mjs's work list (its regex only matches lower-case-initial C names),
// but init_CapMons()/free_CapMons() are meaningless without it.
export function CapitalMon(word) {
    if (!word || !word.length || word[0] === word[0].toLowerCase())
        return false; /* 'word' is not a capitalized monster name */

    if (!CapMons)
        init_CapMons();

    const wln = word.length;
    for (let i = 0; i < CapMonSiz - 1; ++i) {
        const nam = CapMons[i];
        if (!nam) continue;
        const nln = nam.length;
        if (wln < nln) continue;
        /*
         * Unlike name_to_mon(), we don't need the longest match.  We do check
         * full words though: "Foo" matches "Foo" and "Foo bar" and "Foo's bar"
         * but not "Foobar".  Case-sensitive matching.
         */
        if (word.startsWith(nam)
            && (!word[nln] || word[nln] === ' ' || word[nln] === "'"))
            return true;
    }
    return false;
}

// C ref: rumors.c:67 unpadline(line) — strip the trailing '_' padding (the
// newline is already gone by the time init_CapMons() calls it).  js/engrave.js:66
// holds the private original; the fix is to export that one.
function unpadline_r(line) {
    let p = line.length;
    if (p > 0 && line[p - 1] === '\n') --p;
    while (p > 0 && line[p - 1] === '_') --p;
    return line.slice(0, p);
}

// C ref: const.js LOW_PM (0) and mons[] length.  NUMMONS is resolved off the
// live MONS table so a mons[] extension can't leave this loop short.
const LOW_PM_R = 0;
function NUMMONS_R() {
    let n = 0;
    while (monster_by_pmidx(n)) ++n;
    return n;
}
