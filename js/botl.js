// botl.js — the status lines and the STATUS HILITES subsystem.  C ref: botl.c.
//
// INERT BY DESIGN: nothing imports this module.  The live status line is still
// rendered by js/display.js's own _botFields()/bot() path; rows 22/23 appear on
// EVERY scored screen, so switching the renderer over is a separate, measured
// change.  bot() itself lives in display.js and is deliberately not duplicated
// here (nor are rank/rank_of/xlev_to_rank/rank_to_xlev, status_initialize,
// stat_cap_indx, repad_with_dashes, count_status_hilites, or the
// parse_status_hl1/hl2/fldname_to_bl_indx/splitsubfields/is_ltgt_percentnumber/
// has_ltgt_percentnumber/parse_cond_option group that options.js already owns).
//
// The status line is a SNAPSHOT, not live state: rows 22/23 only change when
// bot() runs, and bot() SKIPS while u.uhp == -1 (dosave()'s "game over"
// sentinel).  Nothing here tries to improve on that.

import { game } from './gstate.js';
import {
    ANY_INT, ANY_UINT, ANY_LONG, ANY_ULONG, ANY_STR, ANY_MASK32,
    ANY_IPTR, ANY_UPTR, ANY_LPTR, ANY_ULPTR,
    CLR_MAX, LARGEST_INT, MAX_TYPE, NON_PM,
    A_STR, A_DEX, A_CON, A_INT, A_WIS, A_CHA,
    A_CHAOTIC, A_NEUTRAL,
    UNENCUMBERED, SLT_ENCUMBER, OVERLOADED,
    SATIATED, NOT_HUNGRY, STARVED,
    SICK_VOMITABLE, SICK_NONVOMITABLE, TT_LAVA, TT_BURIEDBALL,
    NHW_MENU, NHW_TEXT, PICK_ONE, PICK_ANY, MENU_BEHAVE_STANDARD,
    MENU_ITEMFLAGS_NONE, MENU_ITEMFLAGS_SELECTED, MENU_ITEMFLAGS_SKIPINVERT,
    In_quest, In_endgame, Is_knox_level, COLNO,
} from './const.js';
import { NO_COLOR } from './terminal.js';
import { GOLD_PIECE, COIN_CLASS, WEAPON_CLASS } from './mkobj.js';
import { roles } from './role.js';
import { acurr_eff } from './attrib.js';
import { newuexp } from './exper.js';
import { near_capacity, is_sword, bimanual, is_weptool } from './invent.js';
import { hidden_gold, money_cnt_invent } from './shk.js';
import { weapon_type, weapon_descr } from './weapon.js';
import { helm_simple_name } from './do_wear.js';
import { humanoid } from './monflags_data.js';
import { endgamelevelname } from './dungeon.js';
import { depth } from './hacklib.js';
import { fuzzymatch, strstri } from './objnam.js';
import { clr2colorname, query_color, query_attr } from './coloratt.js';
import { pline, impossible } from './display.js';
import { pmname_of_pmidx } from './makemon.js';
import {
    tty_create_nhwindow, tty_destroy_nhwindow, tty_start_menu, tty_add_menu,
    tty_end_menu, tty_select_menu, tty_putstr, tty_display_nhwindow,
} from './wintty.js';
import { hooked_tty_getlin } from './extcmd-handlers.js';

/* ==================================================================== */
/*  botl.h                                                              */
/* ==================================================================== */

/* C ref: botl.h — MAXCO must hold the longest uncompressed status line. */
export const MAXCO = (COLNO <= 160) ? 200 : (COLNO + 40);
/* limit of the player's name in the status window */
export const BOTL_NSIZ = 16;
/* actually less, but C uses 80 to allocate title and leveldesc */
export const MAXVALWIDTH = 80;
export const QBUFSZ = 128, BUFSZ = 256;

/* C ref: botl.h enum statusfields */
export const BL_CHARACTERISTICS = -3, BL_RESET = -2, BL_FLUSH = -1;
export const BL_TITLE = 0,
    BL_STR = 1, BL_DX = 2, BL_CO = 3, BL_IN = 4, BL_WI = 5, BL_CH = 6,
    BL_ALIGN = 7, BL_SCORE = 8, BL_CAP = 9, BL_GOLD = 10,
    BL_ENE = 11, BL_ENEMAX = 12, BL_XP = 13, BL_AC = 14, BL_HD = 15,
    BL_TIME = 16, BL_HUNGER = 17, BL_HP = 18, BL_HPMAX = 19,
    BL_LEVELDESC = 20, BL_EXP = 21, BL_CONDITION = 22,
    BL_WEAPON = 23, BL_ARMOR = 24, BL_TERRAIN = 25, BL_VERS = 26,
    MAXBLSTATS = 27;

/* C ref: botl.h enum relationships */
export const NO_LTEQGT = -1, EQ_VALUE = 0, LT_VALUE = 1, LE_VALUE = 2,
             GE_VALUE = 3, GT_VALUE = 4, TXT_VALUE = 5;

/* C ref: botl.h enum blconditions */
export const bl_bareh = 0, bl_blind = 1, bl_busy = 2, bl_conf = 3,
    bl_deaf = 4, bl_elf_iron = 5, bl_fly = 6, bl_foodpois = 7,
    bl_glowhands = 8, bl_grab = 9, bl_hallu = 10, bl_held = 11,
    bl_icy = 12, bl_inlava = 13, bl_lev = 14, bl_parlyz = 15,
    bl_ride = 16, bl_sleeping = 17, bl_slime = 18, bl_slippery = 19,
    bl_stone = 20, bl_strngl = 21, bl_stun = 22, bl_submerged = 23,
    bl_termill = 24, bl_tethered = 25, bl_trapped = 26, bl_unconsc = 27,
    bl_woundedl = 28, bl_holding = 29, CONDITION_COUNT = 30;

/* C ref: botl.h BL_MASK_* — 30 condition bits. */
export const BL_MASK_BAREH = 0x00000001, BL_MASK_BLIND = 0x00000002,
    BL_MASK_BUSY = 0x00000004, BL_MASK_CONF = 0x00000008,
    BL_MASK_DEAF = 0x00000010, BL_MASK_ELF_IRON = 0x00000020,
    BL_MASK_FLY = 0x00000040, BL_MASK_FOODPOIS = 0x00000080,
    BL_MASK_GLOWHANDS = 0x00000100, BL_MASK_GRAB = 0x00000200,
    BL_MASK_HALLU = 0x00000400, BL_MASK_HELD = 0x00000800,
    BL_MASK_ICY = 0x00001000, BL_MASK_INLAVA = 0x00002000,
    BL_MASK_LEV = 0x00004000, BL_MASK_PARLYZ = 0x00008000,
    BL_MASK_RIDE = 0x00010000, BL_MASK_SLEEPING = 0x00020000,
    BL_MASK_SLIME = 0x00040000, BL_MASK_SLIPPERY = 0x00080000,
    BL_MASK_STONE = 0x00100000, BL_MASK_STRNGL = 0x00200000,
    BL_MASK_STUN = 0x00400000, BL_MASK_SUBMERGED = 0x00800000,
    BL_MASK_TERMILL = 0x01000000, BL_MASK_TETHERED = 0x02000000,
    BL_MASK_TRAPPED = 0x04000000, BL_MASK_UNCONSC = 0x08000000,
    BL_MASK_WOUNDEDL = 0x10000000, BL_MASK_HOLDING = 0x20000000;

/* C ref: botl.h BL_TH_* threshold behaviors */
export const BL_TH_NONE = 0, BL_TH_VAL_PERCENTAGE = 100,
    BL_TH_VAL_ABSOLUTE = 101, BL_TH_UPDOWN = 102, BL_TH_CONDITION = 103,
    BL_TH_TEXTMATCH = 104, BL_TH_ALWAYS_HILITE = 105, BL_TH_CRITICALHP = 106;

/* C ref: botl.h HL_ATTCLR_* — attribute pseudo-colors past CLR_MAX. */
export const HL_ATTCLR_NONE = CLR_MAX + 1, HL_ATTCLR_BOLD = CLR_MAX + 2,
    HL_ATTCLR_DIM = CLR_MAX + 3, HL_ATTCLR_ITALIC = CLR_MAX + 4,
    HL_ATTCLR_ULINE = CLR_MAX + 5, HL_ATTCLR_BLINK = CLR_MAX + 6,
    HL_ATTCLR_INVERSE = CLR_MAX + 7, BL_ATTCLR_MAX = CLR_MAX + 8;

/* C ref: botl.h enum hlattribs */
export const HL_UNDEF = 0x00, HL_NONE = 0x01, HL_BOLD = 0x02, HL_DIM = 0x04,
    HL_ITALIC = 0x08, HL_ULINE = 0x10, HL_BLINK = 0x20, HL_INVERSE = 0x40;

/* C ref: wintype.h ATR_* ("the same as the ANSI value").  js/terminal.js and
   js/const.js each carry a DIFFERENT, mutually inconsistent ATR_ set (see
   worn-mask-remap-collision for the same hazard in invent.js), so use the real
   C values locally rather than importing either. */
const ATR_NONE = 0, ATR_BOLD = 1, ATR_DIM = 2, ATR_ITALIC = 3,
      ATR_ULINE = 4, ATR_BLINK = 5, ATR_INVERSE = 7;

/* config.h ships SCORE_ON_BOTL commented out (see display.js), so botl_score()
   never reaches the status line; the function itself is still real. */
const SCORE_ON_BOTL = false;

/* C ref: display.h objnum_to_glyph(onum) = onum + GLYPH_OBJ_OFF, and the
   glyph_offsets enum chain reduces GLYPH_OBJ_OFF to 9*NUMMONS + 1.  NUMMONS is
   383 with MAIL_STRUCTURES defined (see mons-table-missing-mail-daemon). */
const NUMMONS = 383;
const GLYPH_OBJ_OFF = 9 * NUMMONS + 1;

/* object types / artifacts read by weapon_status() and armor_status() */
const AKLYS = 80, CREAM_PIE = 287, CLOAK_OF_PROTECTION = 146,
      RIN_PROTECTION = 178, AMULET_OF_GUARDING = 210;
const ART_MITRE_OF_HOLINESS = 27, ART_TSURUGI_OF_MURAMASA = 30;
/* C ref: skills.h — the weapon_type() values weapon_status() shortens. */
const P_QUARTERSTAFF = 15, P_POLEARMS = 18, P_LANCE = 19,
      P_MORNING_STAR = 12, P_UNICORN_HORN = 21;
/* C ref: monsym.h S_EEL */
const S_EEL = 57;
/* C ref: rm.h ICE */
const ICE = 33;

/* ==================================================================== */
/*  local hacklib.c / objnam.c / windows.c helpers                      */
/*                                                                      */
/*  The port's convention is a per-file copy of these (readobjnam.js,    */
/*  end.js, topten.js, ... all carry their own); they are not imported   */
/*  so that this module stays leaf-ward in the graph.                    */
/* ==================================================================== */

/* C ref: hacklib.c highc()/lowc() */
function highc(c) { return c >= 'a' && c <= 'z' ? c.toUpperCase() : c; }
function lowc(c) { return c >= 'A' && c <= 'Z' ? c.toLowerCase() : c; }
function digit(c) { return c >= '0' && c <= '9'; }
/* C ref: hacklib.c sgn() */
function sgn(n) { return n < 0 ? -1 : n > 0 ? 1 : 0; }
/* C ref: hacklib.c upstart() — capitalize in place, return the buffer. */
function upstart(s) { return s ? highc(s.charAt(0)) + s.slice(1) : s; }
/* C ref: hacklib.c strkitten() — append one character. */
function strkitten(s, c) { return s + c; }
/* C ref: hacklib.c strcmpi()/strncmpi() — caseblind compares. */
function strcmpi(a, b) {
    const x = String(a ?? '').toLowerCase(), y = String(b ?? '').toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
}
function strncmpi(a, b, n) {
    return strcmpi(String(a ?? '').slice(0, n), String(b ?? '').slice(0, n));
}
/* C ref: hacklib.c str_start_is(str, chkstr, caseblind) */
function str_start_is(str, chkstr, caseblind) {
    if (!chkstr) return false;
    return caseblind
        ? String(str ?? '').toLowerCase().startsWith(chkstr.toLowerCase())
        : String(str ?? '').startsWith(chkstr);
}
/* C ref: hacklib.c strsubst() — replace the FIRST occurrence only. */
function strsubst(bp, orig, repl) {
    const i = bp.indexOf(orig);
    return i < 0 ? bp : bp.slice(0, i) + repl + bp.slice(i + orig.length);
}
/* C ref: hacklib.c strNsubst(inoutbuf, orig, replacement, n) — n==0 means
   "every occurrence". */
function strNsubst(bp, orig, repl, n) {
    let out = '', rest = bp, cnt = 0;
    for (;;) {
        const i = rest.indexOf(orig);
        if (i < 0) break;
        cnt++;
        if (n !== 0 && cnt !== n) {
            out += rest.slice(0, i + orig.length);
        } else {
            out += rest.slice(0, i) + repl;
            if (n !== 0) { rest = rest.slice(i + orig.length); break; }
        }
        rest = rest.slice(i + orig.length);
    }
    return out + rest;
}
/* C ref: hacklib.c stripchars(bp, stripchars, orig) */
function stripchars(strip, orig) {
    let out = '';
    for (const c of String(orig ?? '')) if (!strip.includes(c)) out += c;
    return out;
}
/* C ref: hacklib.c trimspaces() — strip leading and trailing blanks/tabs. */
function trimspaces(s) { return String(s ?? '').replace(/^[ \t]+|[ \t]+$/g, ''); }
/* C ref: objnam.c mungspaces() — collapse runs of whitespace, then trim. */
function mungspaces(s) { return String(s ?? '').replace(/\s+/g, ' ').replace(/^ | $/g, ''); }
/* C ref: hacklib.c nowrap_add(a, i) — saturating add. */
function nowrap_add(a, i) {
    return (a > 0 && i > 0 && a + i <= 0) ? LARGEST_INT * 65536 : a + i;
}
/* C's atoi()/atol(): leading numeric prefix, 0 when there isn't one. */
function atoi(s) { const n = parseInt(String(s ?? '').trim(), 10); return Number.isNaN(n) ? 0 : n; }
const atol = atoi;
/* C ref: windows.c encglyph(glyph) — "\GXXXXNNNN". */
function encglyph(glyph) {
    const rnd = (game.context?.rndencode | 0) & 0xffff;
    return `\\G${rnd.toString(16).toUpperCase().padStart(4, '0')}`
         + `${(glyph & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}
function objnum_to_glyph(onum) { return onum + GLYPH_OBJ_OFF; }
function min(a, b) { return a < b ? a : b; }
function max(a, b) { return a > b ? a : b; }
/* C's "%-2d" / "%2d" / "%-30s" etc. */
function padr(s, n) { return String(s).padEnd(n); }
function padl(s, n) { return String(s).padStart(n); }

/* ==================================================================== */
/*  the pieces of core state botl.c reads that the port keeps elsewhere  */
/* ==================================================================== */

/* C ref: display.c suppress_map_output() — gi.in_mklev || program_state.saving
   || program_state.restoring (|| done_hup with HANGUPHANDLING). */
function suppress_map_output() {
    return !!(game.in_mklev || game.program_state?.saving
              || game.program_state?.restoring);
}

/* C sets disp.botl/botlx/time_botl; the port writes game.botl in end.js and
   game.disp.botl in rumors.js, so touch whichever exists. */
function set_disp_botl(botl, botlx, time_botl) {
    if (botl !== null) { game.botl = botl; if (game.disp) game.disp.botl = botl; }
    if (botlx !== null) { game.botlx = botlx; if (game.disp) game.disp.botlx = botlx; }
    if (time_botl !== null) {
        game.time_botl = time_botl;
        if (game.disp) game.disp.time_botl = time_botl;
    }
}
function get_disp_botl() { return !!(game.disp?.botl ?? game.botl); }
function get_disp_botlx() { return !!(game.disp?.botlx ?? game.botlx); }

/* C ref: botl.h VIA_WINDOWPORT() — wincap2 & (WC2_HILITE_STATUS |
   WC2_FLUSH_STATUS).  wintty.c sets both, so the tty always takes the
   fielded path. */
function VIA_WINDOWPORT() { return true; }

/* C ref: version.c status_version(buf, bufsz, indent) — private copy so that
   version.c's own symbol is not shadowed by a stub here. */
function status_version_str(indent) {
    const vi = game.flags?.versinfo | 0;
    if (!vi) return '';
    return `${indent ? ' ' : ''}NetHack`;
}

/* C ref: hack.c classify_terrain() — private copy for the same reason.  Only
   the "already classified" fast path matters to bot_via_windowport(). */
function classify_terrain_typ() {
    const t = game.iflags?.terrain_typ;
    return (t === undefined || t === null) ? MAX_TYPE : t;
}

/* C ref: pray.c critically_low_hp(only_if_injured) — private copy (pray.js has
   its own, unexported). */
function critically_low_hp_p(only_if_injured) {
    const u = game.u || {};
    let curhp = u.Upolyd ? u.mh : u.uhp, maxhp = u.Upolyd ? u.mhmax : u.uhpmax;
    curhp |= 0; maxhp |= 0;
    if (only_if_injured && !(curhp < maxhp)) return false;
    const hplim = 15 * (u.ulevel || 1);
    if (maxhp > hplim) maxhp = hplim;
    const rank = xlev_to_rank_p(u.ulevel || 1);
    const divisor = rank <= 1 ? 5 : rank <= 3 ? 6 : rank <= 5 ? 7 : rank <= 7 ? 8 : 9;
    return (curhp <= 5 || curhp * divisor <= maxhp);
}
/* C ref: botl.c xlev_to_rank() — role.js owns the exported one. */
function xlev_to_rank_p(xlev) {
    return (xlev <= 2) ? 0 : (xlev <= 30) ? Math.trunc((xlev + 2) / 4) : 8;
}

/* C ref: dungeon.c deepest_lev_reached(noquest) — dungeon.js has its own
   unexported copy (deepest_lev_reached_dg). */
function deepest_lev_reached_p(noquest) {
    let ret = 0;
    const dgns = game.dungeons || [];
    for (let i = 0; i < dgns.length; i++) {
        if (noquest && i === game.quest_dnum) continue;
        const dlevel = dgns[i]?.dunlev_ureached | 0;
        if (!dlevel) continue;
        const d = depth({ dnum: i, dlevel });
        if (d > ret) ret = d;
    }
    return ret;
}

/* C ref: dungeon.h dunlev(x) / In_tutorial(x) / Is_knox(x) */
function dunlev(uz) { return uz?.dlevel | 0; }
function In_tutorial(uz) {
    return uz != null && game.tutorial_dnum != null && uz.dnum === game.tutorial_dnum;
}
function Is_knox(uz) { return !!Is_knox_level(uz); }
function dname_of(uz) { return game.dungeons?.[uz?.dnum]?.dname || ''; }

/* C ref: botl.c rank() — rank_of(u.ulevel, Role_switch, flags.female). */
function rank_of_hero() {
    const u = game.u || {};
    const monnum = game.urole?.mnum;
    let role = roles.find((r) => r.mnum === monnum) || game.urole || roles[0];
    for (let i = xlev_to_rank_p(u.ulevel || 1); i >= 0; i--) {
        if (game.flags?.female && role.rank?.[i]?.f) return role.rank[i].f;
        if (role.rank?.[i]?.m) return role.rank[i].m;
    }
    if (game.flags?.female && role.name?.f) return role.name.f;
    if (role.name?.m) return role.name.m;
    return 'Player';
}

/* C ref: you.h Ugender = (Upolyd ? u.mfemale : flags.female) */
function Ugender() {
    const u = game.u || {};
    return u.Upolyd ? !!u.mfemale : !!game.flags?.female;
}
/* C ref: mondata.h pmname(&mons[u.umonnum], Ugender) */
function poly_pmname() {
    const u = game.u || {};
    return pmname_of_pmidx(u.umonnum, Ugender());
}

/* youprop.h predicates.  The port stores these as u.uprops.<name> timers; the
   readings mirror js/display.js _botConditions(), which is the measured set. */
const upv = (nm) => (game.u?.uprops?.[nm] || 0);
function Stoned() { return upv('Stoned') > 0; }
function Slimed() { return upv('Slimed') > 0; }
function Strangled() { return upv('Strangled') > 0; }
function Sick() { return upv('Sick') > 0 || !!game.u?.sick; }
function Blind() {
    return (game.u?.blinded | 0) > 0 || !!game.ublindf || upv('BlindedFromForm') > 0;
}
function Deaf() { return upv('HDeaf') > 0 || !!game.u?.Deaf; }
function Stunned() { return upv('Stun') > 0 || !!game.u?.Stunned; }
function Confusion() { return upv('Confusion') > 0; }
function Hallucination() {
    const t = upv('Hallucination') || upv('HHallucination') || (game.u?.uhallu ? 1 : 0);
    return t > 0 && !(upv('HHalluc_resistance') || upv('EHalluc_resistance'));
}
function Levitation() { return !!upv('Levitation'); }
function Flying() { return !!upv('Flying'); }
function Glib() { return upv('Glib') > 0; }
function Wounded_legs() { return upv('Wounded_legs') > 0; }
function Underwater() { return !!game.u?.uinwater; }
/* C ref: allmain.c unconscious() = (gm.multi < 0 && (!gn.nomovemsg || ...)) */
function unconscious() { return (game.multi | 0) < 0; }
/* C ref: mondata.h sticks(ptr) — hero-in-that-form does the holding. */
function sticks(ptr) { return !!ptr?.sticky; }

/* C ref: eat.c hu_stat[] — the trailing blanks are load-bearing for bot2(). */
const hu_stat = ['Satiated', '        ', 'Hungry  ', 'Weak    ',
                 'Fainting', 'Fainted ', 'Starved '];
/* also used in insight.c */
export const enc_stat = ['', 'Burdened', 'Stressed',
                         'Strained', 'Overtaxed', 'Overloaded'];

/* ==================================================================== */
/*  botl.c:21                                                           */
/* ==================================================================== */

/* C ref: botl.c:21 — STR18(100) is 118; 19..117 print as "18/xx". */
export function get_strength_str() {
    const STR18_100 = 118;
    const st = acurr_eff(A_STR);
    if (st > 18) {
        if (st > STR18_100) return padl(st - 100, 2);
        if (st < STR18_100) return `18/${padl(st - 18, 2).replace(/ /g, '0')}`;
        return '18/**';
    }
    return String(st);
}

/* C ref: botl.c:40 — a blank/invisible gold symbol makes bot2() print "$". */
export function check_gold_symbol() {
    const goldch = game.showsyms?.[COIN_CLASS + (game.SYM_OFF_O | 0)];
    game.iflags = game.iflags || {};
    game.iflags.invis_goldsym = (goldch == null || goldch <= ' ');
    return game.iflags.invis_goldsym;
}

/* C ref: botl.c:48 */
export function do_statusline1() {
    if (suppress_map_output()) return '';

    const u = game.u || {};
    let newbot1 = String(game.plname ?? '');
    if (newbot1[0] >= 'a' && newbot1[0] <= 'z')
        newbot1 = newbot1[0].toUpperCase() + newbot1.slice(1);
    newbot1 = newbot1.slice(0, BOTL_NSIZ);       /* newbot1[BOTL_NSIZ] = 0 */
    newbot1 += ' the ';

    if (u.Upolyd) {
        /* capitalize the first letter of every word of the monster name */
        let mbot = poly_pmname() || '';
        let out = '';
        for (let k = 0; k < mbot.length; k++)
            out += (k === 0 || mbot[k - 1] === ' ') ? highc(mbot[k]) : mbot[k];
        newbot1 += out;
    } else {
        newbot1 += rank_of_hero();
    }

    newbot1 += '  ';
    /* C ref: botl.c:81 — pad out to mrank_sz + 15 columns.  'j' is
       strlen(newbot1) computed as (nb + 2) - newbot1. */
    const i = (gm.mrank_sz | 0) + 15;
    const j = newbot1.length;
    if ((i - j) > 0) newbot1 += ' '.repeat(i - j);

    newbot1 += `St:${get_strength_str()} Dx:${acurr_eff(A_DEX)}`
             + ` Co:${acurr_eff(A_CON)} In:${acurr_eff(A_INT)}`
             + ` Wi:${acurr_eff(A_WIS)} Ch:${acurr_eff(A_CHA)}`;
    newbot1 += (u.ualign?.type === A_CHAOTIC) ? '  Chaotic'
               : (u.ualign?.type === A_NEUTRAL) ? '  Neutral' : '  Lawful';
    if (SCORE_ON_BOTL && game.flags?.showscore)
        newbot1 += ` S:${botl_score()}`;
    return newbot1;
}

/* C ref: botl.c:101 */
export function do_statusline2() {
    if (suppress_map_output()) return '';

    const u = game.u || {};
    let money;

    /* dungeon location plus gold */
    const dl = { buf: '' };
    describe_level(dl, 1); /* includes at least one trailing space */
    let dloc = dl.buf;
    if ((money = money_cnt_invent()) < 0) money = 0;
    dloc += `${(game.iflags?.in_dumplog || game.iflags?.invis_goldsym) ? '$'
              : encglyph(objnum_to_glyph(GOLD_PIECE))}:${padr(min(money, 999999), 2)}`;
    const dln = dloc.length;
    /* '$' encoded as \GXXXXNNNN is 9 chars longer than display will need */
    const dx = strstri(dloc, '\\G') ? 9 : 0;

    /* health and armor class (has trailing space for AC 0..9) */
    let hp = u.Upolyd ? u.mh : u.uhp;
    const hpmax = (u.Upolyd ? u.mhmax : u.uhpmax) | 0;
    hp |= 0;
    if (hp < 0) hp = 0;
    const hlth = `HP:${min(hp, 9999)}(${min(hpmax, 9999)})`
               + ` Pw:${min(u.uen | 0, 9999)}(${min(u.uenmax | 0, 9999)})`
               + ` AC:${padr(u.uac | 0, 2)}`;
    const hln = hlth.length;

    /* experience */
    let expr;
    if (u.Upolyd) expr = `HD:${u.data?.mlevel | 0}`;
    else if (game.flags?.showexp) expr = `Xp:${u.ulevel | 0}/${u.uexp | 0}`;
    else expr = `Xp:${u.ulevel | 0}`;
    const xln = expr.length;

    /* time/move counter */
    const tmmv = game.flags?.time ? `T:${game.moves | 0}` : '';
    const tln = tmmv.length;

    /* status conditions; worst ones first.  Once non-empty, cond has a
       leading space. */
    let cond = '';
    if (Stoned()) cond += ' Stone';
    if (Slimed()) cond += ' Slime';
    if (Strangled()) cond += ' Strngl';
    if (Sick()) {
        if (u.usick_type & SICK_VOMITABLE) cond += ' FoodPois';
        if (u.usick_type & SICK_NONVOMITABLE) cond += ' TermIll';
    }
    if ((u.uhs ?? NOT_HUNGRY) !== NOT_HUNGRY) cond += ` ${hu_stat[u.uhs]}`;
    let cap;
    if ((cap = near_capacity()) > UNENCUMBERED) cond += ` ${enc_stat[cap]}`;
    if (Blind()) cond += ' Blind';
    if (Deaf()) cond += ' Deaf';
    if (Stunned()) cond += ' Stun';
    if (Confusion()) cond += ' Conf';
    if (Hallucination()) cond += ' Hallu';
    /* levitation and flying are mutually exclusive; riding is not */
    if (Levitation()) cond += ' Lev';
    if (Flying()) cond += ' Fly';
    if (u.usteed) cond += ' Ride';
    const cln = cond.length;

    /* version on status line, with leading space */
    const vers = game.flags?.showvers ? status_version_str(true) : '';
    const vrn = vers.length;

    /* Put the pieces together.  If they all fit, keep the traditional
       sequence; otherwise move the least important parts to the end. */
    let newbot2;
    if ((dln - dx) + 1 + hln + 1 + xln + 1 + tln + 1 + cln + vrn <= COLNO) {
        newbot2 = `${dloc} ${hlth} ${expr} ${tmmv} ${cond}${vers}`;
    } else {
        if (dln + 1 + hln + 1 + xln + 1 + tln + 1 + cln + vrn > MAXCO) {
            /* C panics here; the port has no panic() so report and carry on */
            newbot2 = `${dloc} ${hlth} ${expr} ${tmmv} ${cond}${vers}`;
            return mungspaces(newbot2);
        } else if ((dln - dx) + 1 + hln + 1 + xln + 1 + cln <= COLNO) {
            newbot2 = `${dloc} ${hlth} ${expr} ${cond} ${tmmv}${vers}`;
        } else if ((dln - dx) + 1 + hln + 1 + cln <= COLNO) {
            newbot2 = `${dloc} ${hlth} ${cond} ${expr} ${tmmv}${vers}`;
        } else {
            newbot2 = `${hlth} ${cond} ${dloc} ${expr} ${tmmv}${vers}`;
        }
        /* only two or three consecutive spaces available to squeeze out */
        newbot2 = mungspaces(newbot2);
    }
    return newbot2;
}

/* C ref: botl.c:275 — special purpose status update: 'time' field only. */
export function timebot() {
    if (game.bot_disabled) return;
    if (game.flags?.time && game.iflags?.status_updates !== false
        && !suppress_map_output()) {
        if (VIA_WINDOWPORT()) stat_update_time();
        /* else the old status display updates everything via bot() */
    }
    set_disp_botl(null, null, false);
}

/* C ref: botl.c:367 — resolve a rank title (or role name) back to its role. */
export function title_to_mon(str, out) {
    for (let i = 0; i < roles.length && roles[i].name?.m; i++) {
        for (let j = 0; j < 9; j++) {
            const rm = roles[i].rank?.[j]?.m, rf = roles[i].rank?.[j]?.f;
            if (rm && str_start_is(str, rm, true)) {
                if (out) { out.rank_indx = j; out.title_length = rm.length; }
                return roles[i].mnum;
            }
            if (rf && str_start_is(str, rf, true)) {
                if (out) { out.rank_indx = j; out.title_length = rf.length; }
                return roles[i].mnum;
            }
        }
    }
    if (out) out.title_length = 0;
    return NON_PM;
}

/* C ref: botl.c:402 — widest rank title of the hero's role; do_statusline1()
   pads with it.  Stored on gm to mirror C's gm.mrank_sz. */
export function max_rank_sz() {
    let maxr = 0;
    const urole = game.urole || roles[0];
    for (let i = 0; i < 9; i++) {
        let r;
        if (urole.rank?.[i]?.m && (r = urole.rank[i].m.length) > maxr) maxr = r;
        if (urole.rank?.[i]?.f && (r = urole.rank[i].f.length) > maxr) maxr = r;
    }
    gm.mrank_sz = maxr;
    if (game.gm) game.gm.mrank_sz = maxr;
    return;
}

/* C ref: botl.c:419 — SCORE_ON_BOTL's running score estimate. */
export function botl_score() {
    const u = game.u || {};
    const deepest = deepest_lev_reached_p(false);
    /* hidden_gold(False): only gold in containers whose contents are known */
    let umoney = money_cnt_invent() + hidden_gold(false);
    /* don't include initial gold; don't impose penalty if it's all gone */
    if ((umoney -= (u.umoney0 | 0)) < 0) umoney = 0;
    const depthbonus = (50 * (deepest - 1))
        + ((deepest > 30) ? 10000 : (deepest > 20) ? (1000 * (deepest - 20)) : 0);
    return nowrap_add(u.urexp | 0, umoney + depthbonus);
}

/* C ref: botl.c:441 — dflgs 1: append trailing space, 2: include branch name.
   'out' is the C 'char *buf' out-parameter: { buf }.  Returns 1 unless the
   plain "Dlvl:n" branch was taken (which returns 0). */
export function describe_level(out, dflgs) {
    const u = game.u || {};
    const addspace = (dflgs & 1) !== 0;
    let addbranch = (dflgs & 2) !== 0;
    let ret = 1, buf;

    if (Is_knox(u.uz)) {
        buf = dname_of(u.uz);
        addbranch = false;
    } else if (In_quest(u.uz)) {
        buf = `Home ${dunlev(u.uz)}`;
    } else if (In_endgame(u.uz)) {
        buf = endgamelevelname(depth(u.uz));
        if (!addbranch) buf = strsubst(buf, 'Plane of ', ''); /* keep <element> */
        addbranch = false;
    } else {
        if (!addbranch)
            buf = `${In_tutorial(u.uz) ? 'Tutorial' : 'Dlvl'}:${padr(depth(u.uz), 2)}`;
        else
            buf = `level ${depth(u.uz)}`;
        ret = 0;
    }
    if (addbranch) {
        buf += `, ${dname_of(u.uz)}`;
        buf = strsubst(buf, 'The ', 'the ');
    }
    if (addspace) buf += ' ';
    if (out) out.buf = buf;
    return ret;
}

/* C ref: botl.c:481 — terser-than-^X wielded weapon description. */
export function weapon_status() {
    const u = game.u || {};
    const uwep = game.uwep, uswapwep = game.uswapwep;
    let outbuf = '';
    let res = null;

    if (!uwep) {
        /* no weapon; gloves imply hands; humanoid also implies hands */
        res = game.uarmg ? 'Empty-hnd'
              : humanoid(u.data) ? 'Bare-hnds' : 'No-weapon';
    } else if (u.twoweap) {
        res = 'Dual-weps';
        /* dual wielding two lances doesn't produce double joust */
        if (u.usteed && (weapon_type(uwep) === P_LANCE
                         || weapon_type(uswapwep) === P_LANCE))
            res = 'Dual+joust';
    } else {
        const skill = weapon_type(uwep);

        if (u.usteed && skill === P_LANCE) {
            res = 'joust';
        } else if (uwep.otyp === AKLYS) {
            /* aklys behaves specially when thrown while wielded */
            res = 'aklys';
        } else if (is_sword(uwep)) {
            res = 'sword';
        } else {
            switch (skill) {
            case P_QUARTERSTAFF: res = 'staff'; break;
            case P_MORNING_STAR: res = 'mrng-star'; break;
            case P_POLEARMS: res = 'pole'; break;
            case P_UNICORN_HORN: res = 'unihorn'; break;
            default:
                res = weapon_descr(uwep);
                if (strcmpi(res, 'food') === 0 && uwep.otyp === CREAM_PIE)
                    res = 'pie';
                break;
            }
        }

        if ((uwep.oclass === WEAPON_CLASS || is_weptool(uwep))
            && bimanual(uwep) && res[0] !== '2' && strncmpi(res, 'two', 3) !== 0)
            outbuf += '2H-';
        const p = outbuf.length;
        outbuf += res;
        outbuf = outbuf.slice(0, p) + highc(outbuf[p]) + outbuf.slice(p + 1);
        /* avoid embedded spaces: this appears inside a space-separated line */
        outbuf = strNsubst(outbuf, ' ', '-', 0);
        return outbuf;
    }
    return res;
}

/* C ref: botl.c:559 — worn-armor summary for the status line. */
export function armor_status() {
    const { uarmg, uarmc, uarm, uarmu, uarmh, uarmf, uarms,
            uright, uleft, uamul, uwep } = game;
    const n = !!uarmg + !!uarmc + !!uarm + !!uarmu + !!uarmh + !!uarmf + !!uarms;
    let armbuf;

    if (n === 0) {
        armbuf = 'naked';
    } else if (n === 1) { /* just one piece; spell it out */
        armbuf = uarmg ? 'gloves'
                 : uarmc ? 'cloak'
                   : uarm ? 'suit'
                     : uarmu ? 'shirt'
                       : uarmh ? helm_simple_name(uarmh)
                         : uarmf ? 'boots'
                           : uarms ? 'shield' : '';
    } else { /* more than one piece */
        /* gloves first since this follows weapon_status(); cloak next */
        armbuf = '';
        if (uarmg) armbuf += 'G';
        if (uarmc) armbuf += 'C';
        if (uarm) armbuf += 'A';  /* suit but 's' is for shield */
        if (uarmu) armbuf += 'U'; /* underwear? => shirt */
        if (uarmh) armbuf += 'H';
        if (uarmf) armbuf += 'B'; /* footwear => boots */
        if (uarms) armbuf += 'S';
    }
    /* append '+' as a hint that MC is augmented */
    if ((uright && uright.otyp === RIN_PROTECTION)
        || (uleft && uleft.otyp === RIN_PROTECTION)
        || (uamul && uamul.otyp === AMULET_OF_GUARDING)
        || (uarmc && uarmc.otyp === CLOAK_OF_PROTECTION)
        || (uarmh && uarmh.oartifact === ART_MITRE_OF_HOLINESS)
        || (uwep && uwep.oartifact === ART_TSURUGI_OF_MURAMASA))
        armbuf = strkitten(armbuf, '+');

    return upstart(armbuf);
}

/* ==================================================================== */
/*  statusnew routines                                                  */
/* ==================================================================== */

/* C ref: decl.c instance_globals — the status engine's globals, kept in
   module scope under their C container names.  gb.blstats[BEFORE|NOW][fld]. */
export const BEFORE = 0, NOW = 1;
const gb = {
    blstats: [[], []],
    blinit: false,
    bl_hilite_moves: 0,
};
const gn = { now_or_before_idx: 0 };
const gv = { valset: new Array(MAXBLSTATS).fill(false) };
const gu = { update_all: false };
const gc = {
    cond_hilites: new Array(BL_ATTCLR_MAX).fill(0),
    condmenu_sortorder: 0,
};
const gm = { mrank_sz: 0 };

/* C ref: botl.c INIT_BLSTAT/INIT_BLSTATP + initblstats[].  Rows are
   [fldname, fldfmt, anytype, valwidth, idxmax, fld]; idxmax -1 means the field
   has no maximum (so 'percentage' rules are rejected for it), and a non-(-1)
   idxmax is what INIT_BLSTATP sets along with percent_matters = TRUE. */
const INITBLSTATS_ROWS = [
    ['title', '%s', ANY_STR, MAXVALWIDTH, -1, BL_TITLE],
    ['strength', ' St:%s', ANY_INT, 10, -1, BL_STR],
    ['dexterity', ' Dx:%s', ANY_INT, 10, -1, BL_DX],
    ['constitution', ' Co:%s', ANY_INT, 10, -1, BL_CO],
    ['intelligence', ' In:%s', ANY_INT, 10, -1, BL_IN],
    ['wisdom', ' Wi:%s', ANY_INT, 10, -1, BL_WI],
    ['charisma', ' Ch:%s', ANY_INT, 10, -1, BL_CH],
    ['alignment', ' %s', ANY_STR, 20, -1, BL_ALIGN],
    ['score', ' S:%s', ANY_LONG, 30, -1, BL_SCORE],
    ['carrying-capacity', ' %s', ANY_INT, 20, -1, BL_CAP],
    ['gold', ' %s', ANY_LONG, 40, -1, BL_GOLD],
    ['power', ' Pw:%s', ANY_INT, 10, BL_ENEMAX, BL_ENE],
    ['power-max', '(%s)', ANY_INT, 10, -1, BL_ENEMAX],
    ['experience-level', ' Xp:%s', ANY_INT, 10, BL_EXP, BL_XP],
    ['armor-class', ' AC:%s', ANY_INT, 10, -1, BL_AC],
    ['HD', ' HD:%s', ANY_INT, 10, -1, BL_HD],
    ['time', ' T:%s', ANY_LONG, 30, -1, BL_TIME],
    /* hunger used to be 'ANY_UINT'; C treats it as plain int */
    ['hunger', ' %s', ANY_INT, 20, -1, BL_HUNGER],
    ['hitpoints', ' HP:%s', ANY_INT, 10, BL_HPMAX, BL_HP],
    ['hitpoints-max', '(%s)', ANY_INT, 10, -1, BL_HPMAX],
    ['dungeon-level', '%s', ANY_STR, MAXVALWIDTH, -1, BL_LEVELDESC],
    ['experience', '/%s', ANY_LONG, 30, BL_EXP, BL_EXP],
    ['condition', '%s', ANY_MASK32, 0, -1, BL_CONDITION],
    /* blstat[][BL_VERS] is an int copy of flags.versinfo (0...7) */
    ['version', ' %s', ANY_STR, MAXVALWIDTH, -1, BL_VERS],
    ['weapon', ' %s', ANY_STR, 20, -1, BL_WEAPON],
    ['armor', ' %s', ANY_STR, 20, -1, BL_ARMOR],
    /* terrain is tracked by a number but 'string' allows text matching */
    ['terrain', ' %s', ANY_STR, 20, -1, BL_TERRAIN],
];
const initblstats = INITBLSTATS_ROWS.map((r) => ({
    fldname: r[0], fldfmt: r[1], time: 0, chg: false,
    percent_matters: r[4] !== -1, percent_value: 0, anytype: r[2],
    a: {}, rawval: {}, val: '', valwidth: r[3], idxmax: r[4], fld: r[5],
    hilite_rule: null, thresholds: null,
}));

/* C ref: botl.c condition_aliases[] */
const condition_aliases = [
    { id: 'strangled', bitmask: BL_MASK_STRNGL },
    { id: 'all', bitmask: BL_MASK_BAREH | BL_MASK_BLIND | BL_MASK_BUSY
        | BL_MASK_CONF | BL_MASK_DEAF | BL_MASK_ELF_IRON
        | BL_MASK_FLY | BL_MASK_FOODPOIS | BL_MASK_GLOWHANDS
        | BL_MASK_GRAB | BL_MASK_HALLU | BL_MASK_HELD
        | BL_MASK_ICY | BL_MASK_INLAVA | BL_MASK_LEV
        | BL_MASK_PARLYZ | BL_MASK_RIDE | BL_MASK_SLEEPING
        | BL_MASK_SLIME | BL_MASK_SLIPPERY | BL_MASK_STONE
        | BL_MASK_STRNGL | BL_MASK_STUN | BL_MASK_SUBMERGED
        | BL_MASK_TERMILL | BL_MASK_TETHERED
        | BL_MASK_TRAPPED | BL_MASK_UNCONSC
        | BL_MASK_WOUNDEDL | BL_MASK_HOLDING },
    { id: 'major_troubles', bitmask: BL_MASK_FOODPOIS | BL_MASK_GRAB
        | BL_MASK_INLAVA | BL_MASK_SLIME | BL_MASK_STONE | BL_MASK_STRNGL
        | BL_MASK_TERMILL },
    { id: 'minor_troubles', bitmask: BL_MASK_BLIND | BL_MASK_CONF
        | BL_MASK_DEAF | BL_MASK_HALLU | BL_MASK_PARLYZ | BL_MASK_SUBMERGED
        | BL_MASK_STUN },
    { id: 'movement', bitmask: BL_MASK_LEV | BL_MASK_FLY | BL_MASK_RIDE },
    { id: 'opt_in', bitmask: BL_MASK_BAREH | BL_MASK_BUSY | BL_MASK_GLOWHANDS
        | BL_MASK_HELD | BL_MASK_ICY | BL_MASK_PARLYZ
        | BL_MASK_SLEEPING | BL_MASK_SLIPPERY
        | BL_MASK_SUBMERGED | BL_MASK_TETHERED | BL_MASK_TRAPPED
        | BL_MASK_UNCONSC | BL_MASK_WOUNDEDL | BL_MASK_HOLDING },
];

/* C ref: botl.c conditions[] — { ranking, mask, c, text[3] }. */
export const conditions = [
    { ranking: 20, mask: BL_MASK_BAREH, c: bl_bareh, text: ['Bare', 'Bar', 'Bh'] },
    { ranking: 10, mask: BL_MASK_BLIND, c: bl_blind, text: ['Blind', 'Blnd', 'Bl'] },
    { ranking: 20, mask: BL_MASK_BUSY, c: bl_busy, text: ['Busy', 'Bsy', 'By'] },
    { ranking: 10, mask: BL_MASK_CONF, c: bl_conf, text: ['Conf', 'Cnf', 'Cf'] },
    { ranking: 10, mask: BL_MASK_DEAF, c: bl_deaf, text: ['Deaf', 'Def', 'Df'] },
    { ranking: 15, mask: BL_MASK_ELF_IRON, c: bl_elf_iron, text: ['Iron', 'Irn', 'Fe'] },
    { ranking: 10, mask: BL_MASK_FLY, c: bl_fly, text: ['Fly', 'Fly', 'Fl'] },
    { ranking: 6, mask: BL_MASK_FOODPOIS, c: bl_foodpois, text: ['FoodPois', 'Fpois', 'Poi'] },
    { ranking: 20, mask: BL_MASK_GLOWHANDS, c: bl_glowhands, text: ['Glow', 'Glo', 'Gl'] },
    { ranking: 2, mask: BL_MASK_GRAB, c: bl_grab, text: ['Grab', 'Grb', 'Gr'] },
    { ranking: 10, mask: BL_MASK_HALLU, c: bl_hallu, text: ['Hallu', 'Hal', 'Hl'] },
    { ranking: 20, mask: BL_MASK_HELD, c: bl_held, text: ['Held', 'Hld', 'Hd'] },
    { ranking: 20, mask: BL_MASK_ICY, c: bl_icy, text: ['Icy', 'Icy', 'Ic'] },
    { ranking: 8, mask: BL_MASK_INLAVA, c: bl_inlava, text: ['InLava', 'Lav', 'La'] },
    { ranking: 10, mask: BL_MASK_LEV, c: bl_lev, text: ['Lev', 'Lev', 'Lv'] },
    { ranking: 20, mask: BL_MASK_PARLYZ, c: bl_parlyz, text: ['Parlyz', 'Para', 'Par'] },
    { ranking: 10, mask: BL_MASK_RIDE, c: bl_ride, text: ['Ride', 'Rid', 'Rd'] },
    { ranking: 20, mask: BL_MASK_SLEEPING, c: bl_sleeping, text: ['Zzz', 'Zzz', 'Zz'] },
    { ranking: 6, mask: BL_MASK_SLIME, c: bl_slime, text: ['Slime', 'Slim', 'Slm'] },
    { ranking: 20, mask: BL_MASK_SLIPPERY, c: bl_slippery, text: ['Slip', 'Slp', 'Sl'] },
    { ranking: 6, mask: BL_MASK_STONE, c: bl_stone, text: ['Stone', 'Ston', 'Sto'] },
    { ranking: 4, mask: BL_MASK_STRNGL, c: bl_strngl, text: ['Strngl', 'Stngl', 'Str'] },
    { ranking: 10, mask: BL_MASK_STUN, c: bl_stun, text: ['Stun', 'Stun', 'St'] },
    { ranking: 15, mask: BL_MASK_SUBMERGED, c: bl_submerged, text: ['Submrg', 'Subm', 'Sm'] },
    { ranking: 6, mask: BL_MASK_TERMILL, c: bl_termill, text: ['TermIll', 'Ill', 'Ill'] },
    { ranking: 20, mask: BL_MASK_TETHERED, c: bl_tethered, text: ['Teth', 'Tth', 'Te'] },
    { ranking: 20, mask: BL_MASK_TRAPPED, c: bl_trapped, text: ['Trap', 'Trp', 'Tr'] },
    { ranking: 20, mask: BL_MASK_UNCONSC, c: bl_unconsc, text: ['Out', 'Out', 'KO'] },
    { ranking: 20, mask: BL_MASK_WOUNDEDL, c: bl_woundedl, text: ['WLegs', 'Leg', 'Lg'] },
    { ranking: 20, mask: BL_MASK_HOLDING, c: bl_holding, text: ['UHold', 'UHld', 'UHd'] },
];

/* C ref: options.h enum optchoice */
const opt_in = 0, opt_out = 1;

/* C ref: botl.c condtests[] — 'enabled' defaults to !opt_in. */
export const condtests = [
    { c: bl_bareh, useroption: 'barehanded', opt: opt_in, enabled: false, choice: false, test: false },
    { c: bl_blind, useroption: 'blind', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_busy, useroption: 'busy', opt: opt_in, enabled: false, choice: false, test: false },
    { c: bl_conf, useroption: 'conf', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_deaf, useroption: 'deaf', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_elf_iron, useroption: 'iron', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_fly, useroption: 'fly', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_foodpois, useroption: 'foodPois', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_glowhands, useroption: 'glowhands', opt: opt_in, enabled: false, choice: false, test: false },
    { c: bl_grab, useroption: 'grab', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_hallu, useroption: 'hallucinat', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_held, useroption: 'held', opt: opt_in, enabled: false, choice: false, test: false },
    { c: bl_icy, useroption: 'ice', opt: opt_in, enabled: false, choice: false, test: false },
    { c: bl_inlava, useroption: 'lava', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_lev, useroption: 'levitate', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_parlyz, useroption: 'paralyzed', opt: opt_in, enabled: false, choice: false, test: false },
    { c: bl_ride, useroption: 'ride', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_sleeping, useroption: 'sleep', opt: opt_in, enabled: false, choice: false, test: false },
    { c: bl_slime, useroption: 'slime', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_slippery, useroption: 'slip', opt: opt_in, enabled: false, choice: false, test: false },
    { c: bl_stone, useroption: 'stone', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_strngl, useroption: 'strngl', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_stun, useroption: 'stun', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_submerged, useroption: 'submerged', opt: opt_in, enabled: false, choice: false, test: false },
    { c: bl_termill, useroption: 'termIll', opt: opt_out, enabled: true, choice: false, test: false },
    { c: bl_tethered, useroption: 'tethered', opt: opt_in, enabled: false, choice: false, test: false },
    { c: bl_trapped, useroption: 'trap', opt: opt_in, enabled: false, choice: false, test: false },
    { c: bl_unconsc, useroption: 'unconscious', opt: opt_in, enabled: false, choice: false, test: false },
    { c: bl_woundedl, useroption: 'woundedlegs', opt: opt_in, enabled: false, choice: false, test: false },
    { c: bl_holding, useroption: 'holding', opt: opt_in, enabled: false, choice: false, test: false },
];
/* condition indexing */
export const cond_idx = new Array(CONDITION_COUNT).fill(0);

const c_Wall = 'Wall';
/* C ref: botl.c terrain_descr[] — simplified def_syms[].name, indexed by
   iflags.terrain_typ; keep in sync with rm.h types. */
export const terrain_descr = [
/* 0*/ 'Stone', c_Wall, c_Wall, c_Wall, c_Wall, c_Wall, c_Wall, c_Wall,
       c_Wall, c_Wall,
/*10*/ c_Wall, c_Wall,
       'Portcullis',    /* dbwall, closed drawbridge 'door' */
       'Tree',
       c_Wall,          /* sdoor: secret door */
       'Stone',         /* scorr: secret corridor */
       'Pool', 'Moat', 'Water',
       '(gap)',         /* drawbridge_up; replaced by whatever is under */
/*20*/ 'Lava', 'LavaWall', 'Bars',
       'Doorway',       /* doorless or broken door */
       'Corridor',      /* replaced by "Floor" */
       'Room',          /* also replaced by "Floor" */
       'Stairs', 'Ladder', 'Fountain', 'Throne',
/*30*/ 'Sink', 'Grave', 'Altar', 'Ice', 'Bridge', 'Air', 'Cloud',
/*37*/ '',              /* MAX_TYPE; skipped rather than overloaded */
/*38*/ c_Wall,          /* MATCH_WALL for special levels */
/*39*/ 'Floor',         /* substituted for room or corridor */
/*40*/ 'Ground',        /* 'room' on Earth level */
       'Open-door', 'Shut-door',
       'Swamp',         /* Juiblex level */
       'Submerged', 'Sea', 'WaterWall',
];

/* cache-related; C ref: botl.c cond_cache_prepA() */
const cache_avail = [false, false, false];
const cache_reslt = [false, false, false];
let cache_nomovemsg = null, cache_multi_reason = null;

/* C ref: botl.c cond_cache_prepA() macro */
function cond_cache_prepA() {
    let clear_cache = false, refresh_cache = false;

    if ((game.multi | 0) < 0) {
        if (game.nomovemsg || game.multi_reason) {
            if (cache_nomovemsg !== game.nomovemsg) refresh_cache = true;
            if (cache_multi_reason !== game.multi_reason) refresh_cache = true;
        } else {
            clear_cache = true;
        }
    } else {
        clear_cache = true;
    }
    if (clear_cache) { cache_nomovemsg = null; cache_multi_reason = null; }
    if (refresh_cache) {
        cache_nomovemsg = game.nomovemsg;
        cache_multi_reason = game.multi_reason;
    }
    if (clear_cache || refresh_cache) {
        cache_reslt[0] = cache_avail[0] = false;
        cache_reslt[1] = cache_avail[1] = false;
    }
}

/* The windowport side of status_update()/status_enablefield().  This module is
   inert: display.js renders rows 22/23 from its own snapshot, so the default
   sink just records what the engine pushed.  Assign to hook it up. */
export const status_update_hook = { fn: null };
function status_update(fld, ptr, chg, percent, color, colormasks) {
    if (status_update_hook.fn) status_update_hook.fn(fld, ptr, chg, percent, color, colormasks);
}
/* C ref: botl.h WC2_RESET_STATUS / WC2_FLUSH_STATUS — wintty.c sets both. */
function wincap2_reset_status() { return true; }
function wincap2_flush_status() { return true; }

/* C ref: decl.c cg.zeroany */
function zeroany() { return { a_void: null, a_int: 0, a_uint: 0, a_long: 0, a_ulong: 0 }; }

/* C ref: botl.c:962 — fill gb.blstats[NOW] and hand the changes to the
   window port. */
export function bot_via_windowport() {
    const u = game.u || {};
    let i, idx, cap, money;

    if (!gb.blinit) { init_blstats(); }   /* C panics "bot before init." */

    /* toggle from previous iteration */
    idx = 1 - gn.now_or_before_idx;
    gn.now_or_before_idx = idx;

    /* clear the "value set" indicators */
    gv.valset.fill(false);

    /*
     *  Player name and title.  min(x,9999) is enforced on hp/maxhp/pw/maxpw
     *  and gold exactly as bot2() does so the two modes agree.
     */
    let buf = String(game.plname ?? '');
    buf = highc(buf.charAt(0)) + buf.slice(1);
    const titl = !u.Upolyd ? rank_of_hero() : poly_pmname();
    i = buf.length + ' the '.length + String(titl).length;
    /* if "Name the Rank/monster" is too long, truncate the name but always
       keep at least BOTL_NSIZ characters of it */
    if (i > 30) {
        i = 30 - (' the '.length + String(titl).length);
        buf = buf.slice(0, max(i, BOTL_NSIZ));
    }
    const nbStart = buf.length + ' the '.length;
    buf += ' the ';
    buf += titl;
    if (u.Upolyd) { /* when poly'd, capitalize monster name */
        let tail = '';
        for (let k = nbStart; k < buf.length; k++)
            tail += (k === nbStart || buf[k - 1] === ' ') ? highc(buf[k]) : buf[k];
        buf = buf.slice(0, nbStart) + tail;
    }
    gb.blstats[idx][BL_TITLE].val = padr(buf, 30);
    gv.valset[BL_TITLE] = true; /* indicate val already set */

    /* Strength */
    gb.blstats[idx][BL_STR].a.a_int = acurr_eff(A_STR);
    gb.blstats[idx][BL_STR].val = get_strength_str();
    gv.valset[BL_STR] = true;

    /*  Dexterity, constitution, intelligence, wisdom, charisma. */
    gb.blstats[idx][BL_DX].a.a_int = acurr_eff(A_DEX);
    gb.blstats[idx][BL_CO].a.a_int = acurr_eff(A_CON);
    gb.blstats[idx][BL_IN].a.a_int = acurr_eff(A_INT);
    gb.blstats[idx][BL_WI].a.a_int = acurr_eff(A_WIS);
    gb.blstats[idx][BL_CH].a.a_int = acurr_eff(A_CHA);

    /* Alignment */
    gb.blstats[idx][BL_ALIGN].val = (u.ualign?.type === A_CHAOTIC) ? 'Chaotic'
        : (u.ualign?.type === A_NEUTRAL) ? 'Neutral' : 'Lawful';

    /* Score */
    gb.blstats[idx][BL_SCORE].a.a_long =
        (SCORE_ON_BOTL && game.flags?.showscore) ? botl_score() : 0;

    /*  Hit points  */
    i = (u.Upolyd ? u.mh : u.uhp) | 0;
    if (i < 0) i = 0; /* gameover sets u.uhp to -1 */
    gb.blstats[idx][BL_HP].rawval.a_int = i;
    gb.blstats[idx][BL_HP].a.a_int = min(i, 9999);
    i = (u.Upolyd ? u.mhmax : u.uhpmax) | 0;
    gb.blstats[idx][BL_HPMAX].rawval.a_int = i;
    gb.blstats[idx][BL_HPMAX].a.a_int = min(i, 9999);

    /*  Dungeon level. */
    {
        const dl = { buf: '' };
        describe_level(dl, 1);
        gb.blstats[idx][BL_LEVELDESC].val = dl.buf;
    }
    gv.valset[BL_LEVELDESC] = true;

    /* Gold */
    if ((money = money_cnt_invent()) < 0) money = 0;
    gb.blstats[idx][BL_GOLD].rawval.a_long = money;
    gb.blstats[idx][BL_GOLD].a.a_long = min(money, 999999);
    /* The tty port needs the current gold symbol as a field header, so pass
       gold with that already included, encoded as \GXXXXNNNN.  The glyph
       portion changes when a new symset loads or on the rogue level. */
    gb.blstats[idx][BL_GOLD].val =
        `${(game.iflags?.in_dumplog || game.iflags?.invis_goldsym) ? '$'
           : encglyph(objnum_to_glyph(GOLD_PIECE))}:${gb.blstats[idx][BL_GOLD].a.a_long}`;
    gv.valset[BL_GOLD] = true;

    /* Power (magical energy) */
    gb.blstats[idx][BL_ENE].rawval.a_int = u.uen | 0;
    gb.blstats[idx][BL_ENE].a.a_int = min(u.uen | 0, 9999);
    gb.blstats[idx][BL_ENEMAX].rawval.a_int = u.uenmax | 0;
    gb.blstats[idx][BL_ENEMAX].a.a_int = min(u.uenmax | 0, 9999);

    /* Armor class */
    gb.blstats[idx][BL_AC].a.a_int = u.uac | 0;

    /* Monster level (if Upolyd) */
    gb.blstats[idx][BL_HD].a.a_int = u.Upolyd ? (u.data?.mlevel | 0) : 0;

    /* Experience */
    gb.blstats[idx][BL_XP].a.a_int = u.ulevel | 0;
    gb.blstats[idx][BL_EXP].a.a_long = u.uexp | 0;

    /* Time (moves) */
    gb.blstats[idx][BL_TIME].a.a_long = game.moves | 0;

    /* Hunger.  u.uhs is unsigned in C but treated as plain int here, exactly
       as botl.c does (there is no ANY_UINT handling at all). */
    gb.blstats[idx][BL_HUNGER].a.a_int = u.uhs | 0;
    gb.blstats[idx][BL_HUNGER].val =
        ((u.uhs ?? NOT_HUNGRY) !== NOT_HUNGRY) ? hu_stat[u.uhs] : '';
    gv.valset[BL_HUNGER] = true;

    /* Carrying capacity */
    cap = near_capacity();
    gb.blstats[idx][BL_CAP].a.a_int = cap;
    gb.blstats[idx][BL_CAP].val = (cap > UNENCUMBERED) ? enc_stat[cap] : '';
    gv.valset[BL_CAP] = true;

    /* Version; unchanging unless 'showvers'/'versinfo' change */
    if (gb.blstats[idx][BL_VERS].a.a_int !== (game.flags?.versinfo | 0)) {
        gb.blstats[idx][BL_VERS].a.a_int = game.flags?.versinfo | 0;
        gv.valset[BL_VERS] = false;
    }
    if (!gv.valset[BL_VERS]) {
        gb.blstats[idx][BL_VERS].val = status_version_str(false);
        gv.valset[BL_VERS] = true;
    }

    /* Conditions.
     *
     * C avoids string comparisons here because bot() is called *extremely*
     * often; unconsc (cache 0) and parlyz (cache 1) are the exceptions and
     * they are cached.
     */
    gb.blstats[idx][BL_CONDITION].a.a_ulong = 0;

    /* C ref: test_if_enabled(c) — only writes .test when .enabled */
    const test_if_enabled = (c, v) => { if (condtests[c].enabled) condtests[c].test = v; };

    condtests[bl_foodpois].test = condtests[bl_termill].test = false;
    if (Sick()) {
        test_if_enabled(bl_foodpois, (u.usick_type & SICK_VOMITABLE) !== 0);
        test_if_enabled(bl_termill, (u.usick_type & SICK_NONVOMITABLE) !== 0);
    }
    condtests[bl_inlava].test = condtests[bl_tethered].test
        = condtests[bl_trapped].test = false;
    if (u.utrap) {
        test_if_enabled(bl_inlava, u.utraptype === TT_LAVA);
        test_if_enabled(bl_tethered, u.utraptype === TT_BURIEDBALL);
        /* if in-lava or tethered is disabled and the condition applies,
           lump it in with trapped */
        test_if_enabled(bl_trapped, !condtests[bl_inlava].test
                                    && !condtests[bl_tethered].test);
    }
    condtests[bl_grab].test = condtests[bl_held].test
        = condtests[bl_holding].test = false;
    if (u.ustuck) {
        /* a hero in sticks() form can be swallowed, so check swallowed first;
           such a hero cannot be held--the sticky hero does the holding */
        if (u.uswallow) {
            /* engulfed/swallowed isn't a tracked condition; "held" looks odd
               for it but beats blank */
            test_if_enabled(bl_held, true);
        } else if (u.Upolyd && sticks(u.data)) {
            test_if_enabled(bl_holding, true);
        } else {
            /* grab == held by a sea monster and about to be drowned */
            test_if_enabled(bl_grab, u.ustuck.data?.mlet === S_EEL
                                     || u.ustuck.data?.mcls === S_EEL);
            test_if_enabled(bl_held, !condtests[bl_grab].test);
        }
    }
    condtests[bl_blind].test = Blind();
    condtests[bl_conf].test = Confusion();
    condtests[bl_deaf].test = Deaf();
    condtests[bl_fly].test = Flying();
    condtests[bl_glowhands].test = !!u.umconf;
    condtests[bl_hallu].test = Hallucination();
    condtests[bl_lev].test = Levitation();
    condtests[bl_ride].test = !!u.usteed;
    condtests[bl_slime].test = Slimed();
    condtests[bl_stone].test = Stoned();
    condtests[bl_strngl].test = Strangled();
    condtests[bl_stun].test = Stunned();
    condtests[bl_submerged].test = Underwater();
    test_if_enabled(bl_elf_iron, false);   /* C ref: botl.c:1204 hardcoded */
    test_if_enabled(bl_bareh, !game.uarmg && !game.uwep);
    test_if_enabled(bl_icy, game.level?.locations?.[u.ux]?.[u.uy]?.typ === ICE);
    test_if_enabled(bl_slippery, Glib());
    test_if_enabled(bl_woundedl, Wounded_legs());

    if ((game.multi | 0) < 0) {
        cond_cache_prepA();
        if (condtests[bl_unconsc].enabled && cache_nomovemsg && !cache_avail[0]) {
            cache_reslt[0] = (!u.usleep && unconscious());
            cache_avail[0] = true;
        }
        if (condtests[bl_parlyz].enabled && cache_multi_reason && !cache_avail[1]) {
            cache_reslt[1] = (String(cache_multi_reason).startsWith('paralyzed')
                              || String(cache_multi_reason).startsWith('frozen'));
            cache_avail[1] = true;
        }
        if (cache_avail[0] && cache_reslt[0]) {
            condtests[bl_unconsc].test = cache_reslt[0];
        } else if (cache_avail[1] && cache_reslt[1]) {
            condtests[bl_parlyz].test = cache_reslt[1];
        } else if (condtests[bl_sleeping].enabled && u.usleep) {
            condtests[bl_sleeping].test = true;
        } else if (condtests[bl_busy].enabled) {
            condtests[bl_busy].test = true;
        }
    } else {
        condtests[bl_unconsc].test = condtests[bl_parlyz].test =
            condtests[bl_sleeping].test = condtests[bl_busy].test = false;
    }

    for (i = 0; i < CONDITION_COUNT; ++i) {
        if (condtests[i].enabled && condtests[i].test)
            gb.blstats[idx][BL_CONDITION].a.a_ulong |= conditions[i].mask;
    }

    /* Optionally displayed weapon(s), armor, and terrain. */
    gb.blstats[idx][BL_WEAPON].val = game.flags?.weaponstatus ? weapon_status() : '';
    gb.blstats[idx][BL_ARMOR].val = game.flags?.armorstatus ? armor_status() : '';

    if (game.flags?.terrainstatus) {
        if (classify_terrain_typ() === MAX_TYPE) {
            /* C calls classify_terrain() to fill iflags.terrain_typ */
        }
        i = classify_terrain_typ();
        if (gb.blstats[idx][BL_TERRAIN].a.a_int !== i) {
            gb.blstats[idx][BL_TERRAIN].val = terrain_descr[i];
            gb.blstats[idx][BL_TERRAIN].a.a_int = i;
        }
    } else {
        gb.blstats[idx][BL_TERRAIN].val = '';
        /* MAX_TYPE is "none of the above" for levl[][].typ */
        gb.blstats[idx][BL_TERRAIN].a.a_int = MAX_TYPE;
    }
    gv.valset[BL_TERRAIN] = true;

    /* now request rendering */
    evaluate_and_notify_windowport(gv.valset, idx);
}

/* C ref: botl.c:1285 — update just the status lines' 'time' field. */
export function stat_update_time() {
    const idx = gn.now_or_before_idx; /* no 0/1 toggle */
    const fld = BL_TIME;

    gb.blstats[idx][fld].a.a_long = game.moves | 0;
    gv.valset[fld] = false;

    eval_notify_windowport_field(fld, gv.valset, idx);
    if (wincap2_flush_status())
        status_update(BL_FLUSH, null, 0, 0, NO_COLOR, null);
    return;
}

/* C ref: botl.c:1303 — apply the player's choice for one condition.  A null
   'addr' is the "init" request: reset choices to defaults and re-sort
   cond_idx[] by severity ranking. */
export function condopt(idx, addr, negated) {
    let i;

    /* sanity check */
    if ((idx < 0 || idx >= CONDITION_COUNT)
        || (addr && addr !== condtests[idx]))
        return;

    if (!addr) {
        gc.condmenu_sortorder = 0;
        for (i = 0; i < CONDITION_COUNT; ++i) {
            cond_idx[i] = i;
            condtests[i].choice = condtests[i].enabled;
        }
        cond_idx.sort(cond_cmp);
    } else {
        /* (addr === &condtests[idx].choice) */
        condtests[idx].enabled = negated ? false : true;
        condtests[idx].choice = condtests[idx].enabled;
        /* avoid lingering false positives if test is no longer run */
        condtests[idx].test = false;
    }
}

/* C ref: botl.c:1333 — qsort callback for the condition index: severity
   ranking, then caseblind alpha on the user-option name. */
export function cond_cmp(vptr1, vptr2) {
    const indx1 = vptr1, indx2 = vptr2;
    const c1 = conditions[indx1].ranking, c2 = conditions[indx2].ranking;

    if (c1 !== c2) return c1 - c2;
    /* tie-breaker - visible alpha by name */
    return strcmpi(condtests[indx1].useroption, condtests[indx2].useroption);
}

/* C ref: botl.c:1346 — qsort callback for alphabetical sorting of index. */
export function menualpha_cmp(vptr1, vptr2) {
    return strcmpi(condtests[vptr1].useroption, condtests[vptr2].useroption);
}

/* C ref: botl.c:1460 — value for the next cond_xyz option so #saveoptions can
   write the set into a new RC file; empty string means "still the default". */
export function opt_next_cond(indx, out) {
    if (out) out.buf = '';
    if (indx >= CONDITION_COUNT) return false;

    /* Entries come back in internal order: 'severity order' isn't feasible
       unless the player used 'mO' on conditions this session. */
    if ((condtests[indx].opt === opt_in && condtests[indx].enabled)
        || (condtests[indx].opt === opt_out && !condtests[indx].enabled)) {
        if (out)
            out.buf = `${condtests[indx].enabled ? '' : '!'}cond_${condtests[indx].useroption}`;
    }
    return true;
}

/* C ref: botl.c:1493 — decide whether one field changed and, if so, push it
   (with its highlight rule's color) to the window port. */
let _oldrndencode = 0, _oldgoldsym = 0;
export function eval_notify_windowport_field(fld, valsetlist, idx) {
    let pc, chg, color = NO_COLOR;
    let updated = false, reset;

    /* Now pass the changed values to window port. */
    const anytype = gb.blstats[idx][fld].anytype;
    const curr = gb.blstats[idx][fld];
    const prev = gb.blstats[1 - idx][fld];
    color = NO_COLOR;

    chg = gu.update_all ? 0 : compare_blstats(prev, curr);
    /*
     * TODO (C): dynamically update 'percent_matters' as rules are added or
     * removed; for now non-Null 'thresholds' is taken to mean percentages
     * must be kept up to date.  [Affects exp_percent_changing() too.]
     */
    if (((chg || gu.update_all || fld === BL_XP)
         && curr.percent_matters && curr.thresholds)
        /* when 'hitpointbar' is On, percent matters even if HP hasn't changed
           and has no percentage rules (HPmax may have changed alone) */
        || (fld === BL_HP && game.iflags?.wc2_hitpointbar)) {
        const fldmax = curr.idxmax;
        pc = (fldmax === BL_EXP) ? exp_percentage()
             : (fldmax >= 0 && fldmax < MAXBLSTATS)
                 ? percentage(curr, gb.blstats[idx][fldmax])
                 : 0; /* bullet proofing; can't get here */
        if (pc !== prev.percent_value)
            chg = (pc < prev.percent_value) ? -1 : 1;
        curr.percent_value = pc;
    } else {
        pc = 0;
    }

    /* Temporary? hack: moveloop()'s new-game prolog sets svc.context.rndencode
     * after the status window is init'd, so $:0 has already been encoded and
     * cached by the window port.  The glyph half of the encoding can also
     * change when a new symset takes effect.
     *
     *  \GXXXXNNNN:25  — XXXX rndencode, NNNN glyph, 25 the amount
     *
     * chg = 2 renders the field but won't honor an initial highlight, so force
     * gu.update_all instead.
     */
    if (fld === BL_GOLD) {
        const goldsym = game.showsyms?.[COIN_CLASS + (game.SYM_OFF_O | 0)];
        if ((game.context?.rndencode | 0) !== _oldrndencode || goldsym !== _oldgoldsym) {
            gu.update_all = true; /* chg = 2; */
            _oldrndencode = game.context?.rndencode | 0;
            _oldgoldsym = goldsym;
        }
    }

    reset = false;
    if (gu.update_all) {
        chg = 0;
        curr.time = prev.time = 0;
    } else if (!chg && curr.time) {
        reset = hilite_reset_needed(prev, gb.bl_hilite_moves);
        if (reset) curr.time = prev.time = 0;
    }

    if (gu.update_all || chg || reset) {
        if (!valsetlist[fld])
            curr.val = anything_to_s(curr.val, curr.a, anytype);

        if (anytype !== ANY_MASK32) {
            if (chg || curr.val) {
                /* if the Xp percentage changed we set chg=1 above; undo that
                   if the Xp value itself didn't change (or went down) */
                if (chg === 1 && fld === BL_XP) chg = compare_blstats(prev, curr);

                const out = { color };
                curr.hilite_rule = get_hilite(idx, fld, curr.a, chg, pc, out);
                color = out.color;
                prev.hilite_rule = curr.hilite_rule;
                if (chg === 2) { color = NO_COLOR; chg = 0; }
            }
            status_update(fld, curr.val, chg, pc, color, null);
        } else {
            /* Color for conditions is done through gc.cond_hilites[] */
            status_update(fld, curr.a.a_ulong, chg, pc, color, gc.cond_hilites);
        }
        curr.chg = prev.chg = true;
        updated = true;
    }
    return updated;
}

/* C ref: botl.c:1621 */
export function evaluate_and_notify_windowport(valsetlist, idx) {
    let i, fld, updated = 0;

    /*  Now pass the changed values to window port. */
    for (i = 0; i < MAXBLSTATS; i++) {
        fld = initblstats[i].fld;
        if (((fld === BL_SCORE) && !game.flags?.showscore)
            || ((fld === BL_EXP) && !game.flags?.showexp)
            || ((fld === BL_TIME) && !game.flags?.time)
            || ((fld === BL_HD) && !game.u?.Upolyd)
            || ((fld === BL_XP || fld === BL_EXP) && game.u?.Upolyd)
            || ((fld === BL_VERS) && !game.flags?.showvers)
            || ((fld === BL_TERRAIN) && !game.flags?.terrainstatus)
            || ((fld === BL_WEAPON) && !game.flags?.weaponstatus)
            || ((fld === BL_ARMOR) && !game.flags?.armorstatus)) {
            continue;
        }
        if (eval_notify_windowport_field(fld, valsetlist, idx)) updated++;
    }
    /*
     * Nothing may have been pushed (nothing changed), and some ports only draw
     * changed fields; either way disp.botlx means every field must be forced,
     * because the core sets it when a menu or text window obliterated the
     * status line.  BL_RESET forces the full redraw; BL_FLUSH just tells the
     * port a bot() round finished.
     */
    if (get_disp_botlx() && wincap2_reset_status())
        status_update(BL_RESET, null, 0, 0, NO_COLOR, null);
    else if ((updated || get_disp_botlx()) && wincap2_flush_status())
        status_update(BL_FLUSH, null, 0, 0, NO_COLOR, null);

    set_disp_botl(false, false, false);
    gu.update_all = false;
}

/* C ref: botl.c:1723 — window-port cleanup, then free the val[] buffers and
   the per-field threshold chains. */
export function status_finish() {
    let i;

    /* call the window port cleanup routine first (win_status_finish) */

    /* free memory that we alloc'd now */
    for (i = 0; i < MAXBLSTATS; ++i) {
        if (gb.blstats[0][i]) gb.blstats[0][i].val = null;
        if (gb.blstats[1][i]) gb.blstats[1][i].val = null;
        /* pointer to an entry in thresholds list; Null it out since that list
           is about to go away */
        if (gb.blstats[0][i]) gb.blstats[0][i].hilite_rule = null;
        if (gb.blstats[1][i]) gb.blstats[1][i].hilite_rule = null;
        if (gb.blstats[0][i]?.thresholds) {
            gb.blstats[0][i].thresholds = null;
            gb.blstats[1][i].thresholds = null;
        }
    }
}

/* C ref: botl.c:1759 — copy initblstats[] into both halves of gb.blstats,
   preserving any threshold chain already parsed from the config file. */
let _initalready = false;
export function init_blstats() {
    let i, j;

    if (_initalready) {
        /* C: impossible("init_blstats called more than once.") */
        return;
    }
    for (i = 0; i <= 1; ++i) {
        for (j = 0; j < MAXBLSTATS; ++j) {
            const keep_hilite_chain = gb.blstats[i][j]?.thresholds ?? null;

            gb.blstats[i][j] = { ...initblstats[j] };
            gb.blstats[i][j].a = zeroany();
            gb.blstats[i][j].rawval = zeroany();
            gb.blstats[i][j].val = gb.blstats[i][j].valwidth ? '' : null;
            gb.blstats[i][j].thresholds = keep_hilite_chain;
        }
    }
    _initalready = true;
    gb.blinit = true;
}

/*
 * C ref: botl.c:1809 — compare the previous stat with the current one:
 *    prev < new  (went up)     ->  1
 *    prev > new  (went down)   -> -1
 *    prev == new (unchanged)   ->  0
 * For bitmasks and strings, 0 = same, 1 = changed.
 */
export function compare_blstats(bl1, bl2) {
    let a1, a2;
    let result = 0;

    if (!bl1 || !bl2) return 0; /* C panics */

    let anytype = bl1.anytype;
    /* cheat; terrain is highlighted as a string but there's a handy int
       reflecting its value to use when checking for changes */
    if (bl1.fld === BL_TERRAIN) anytype = ANY_INT;

    const fld = bl1.fld;
    const use_rawval = (fld === BL_HP || fld === BL_HPMAX
                        || fld === BL_ENE || fld === BL_ENEMAX
                        || fld === BL_GOLD);
    a1 = use_rawval ? bl1.rawval : bl1.a;
    a2 = use_rawval ? bl2.rawval : bl2.a;

    switch (anytype) {
    case ANY_INT:
        result = (a1.a_int < a2.a_int) ? 1 : (a1.a_int > a2.a_int) ? -1 : 0;
        break;
    case ANY_IPTR:
        result = (a1.a_iptr < a2.a_iptr) ? 1 : (a1.a_iptr > a2.a_iptr) ? -1 : 0;
        break;
    case ANY_LONG:
        result = (a1.a_long < a2.a_long) ? 1 : (a1.a_long > a2.a_long) ? -1 : 0;
        break;
    case ANY_LPTR:
        result = (a1.a_lptr < a2.a_lptr) ? 1 : (a1.a_lptr > a2.a_lptr) ? -1 : 0;
        break;
    case ANY_UINT:
        result = (a1.a_uint < a2.a_uint) ? 1 : (a1.a_uint > a2.a_uint) ? -1 : 0;
        break;
    case ANY_UPTR:
        result = (a1.a_uptr < a2.a_uptr) ? 1 : (a1.a_uptr > a2.a_uptr) ? -1 : 0;
        break;
    case ANY_ULONG:
        result = (a1.a_ulong < a2.a_ulong) ? 1 : (a1.a_ulong > a2.a_ulong) ? -1 : 0;
        break;
    case ANY_ULPTR:
        result = (a1.a_ulptr < a2.a_ulptr) ? 1 : (a1.a_ulptr > a2.a_ulptr) ? -1 : 0;
        break;
    case ANY_STR:
        result = sgn(String(bl1.val ?? '') < String(bl2.val ?? '') ? -1
                     : String(bl1.val ?? '') > String(bl2.val ?? '') ? 1 : 0);
        break;
    case ANY_MASK32:
        result = (a1.a_ulong !== a2.a_ulong) ? 1 : 0;
        break;
    default:
        result = 1;
    }
    return result;
}

/* C ref: botl.c:1886 — render one 'anything' into the field's val buffer. */
export function anything_to_s(buf, a, anytype) {
    if (buf === null || buf === undefined) return null;

    switch (anytype) {
    case ANY_ULONG:  return String(a.a_ulong >>> 0);
    case ANY_MASK32: return (a.a_ulong >>> 0).toString(16);
    case ANY_LONG:   return String(a.a_long | 0);
    case ANY_INT:    return String(a.a_int | 0);
    case ANY_UINT:   return String(a.a_uint >>> 0);
    case ANY_IPTR:   return String(a.a_iptr | 0);
    case ANY_LPTR:   return String(a.a_lptr | 0);
    case ANY_ULPTR:  return String(a.a_ulptr >>> 0);
    case ANY_UPTR:   return String(a.a_uptr >>> 0);
    case ANY_STR:    return buf; /* do nothing */
    default:         return '';
    }
}

/* C ref: botl.c:1930 — the inverse, for parsing a threshold value. */
export function s_to_anything(a, buf, anytype) {
    if (!buf || !a) return;

    switch (anytype) {
    case ANY_LONG:   a.a_long = atol(buf); break;
    case ANY_INT:    a.a_int = atoi(buf); break;
    case ANY_UINT:   a.a_uint = atoi(buf) >>> 0; break;
    case ANY_ULONG:  a.a_ulong = atol(buf) >>> 0; break;
    case ANY_IPTR:   if (a.a_iptr !== undefined) a.a_iptr = atoi(buf); break;
    case ANY_UPTR:   if (a.a_uptr !== undefined) a.a_uptr = atoi(buf) >>> 0; break;
    case ANY_LPTR:   if (a.a_lptr !== undefined) a.a_lptr = atol(buf); break;
    case ANY_ULPTR:  if (a.a_ulptr !== undefined) a.a_ulptr = atol(buf) >>> 0; break;
    case ANY_MASK32: a.a_ulong = atol(buf) >>> 0; break;
    default:         a.a_void = 0; break;
    }
    return;
}

/* C ref: botl.c:1977 — integer percentage is 100 * bl->a / maxbl->a. */
export function percentage(bl, maxbl) {
    let result = 0;
    let ival = 0, mval, lval = 0, uval = 0, ulval = 0;

    if (!bl || !maxbl) return 0; /* C: impossible() */

    const fld = bl.fld;
    const use_rawval = (fld === BL_HP || fld === BL_ENE);
    const anytype = bl.anytype;
    if (maxbl.a.a_void !== null || true) {
        switch (anytype) {
        case ANY_INT:
            /* HP and energy are int so this is the only case that cares about
               'rawval'; use it rather than the value truncated to 9999 */
            ival = use_rawval ? bl.rawval.a_int : bl.a.a_int;
            mval = use_rawval ? maxbl.rawval.a_int : maxbl.a.a_int;
            result = mval ? Math.trunc((100 * ival) / mval) : 0;
            break;
        case ANY_LONG:
            lval = bl.a.a_long;
            result = maxbl.a.a_long ? Math.trunc((100 * lval) / maxbl.a.a_long) : 0;
            break;
        case ANY_UINT:
            uval = bl.a.a_uint;
            result = maxbl.a.a_uint ? Math.trunc((100 * uval) / maxbl.a.a_uint) : 0;
            break;
        case ANY_ULONG:
            ulval = bl.a.a_ulong;
            result = maxbl.a.a_ulong ? Math.trunc((100 * ulval) / maxbl.a.a_ulong) : 0;
            break;
        default:
            break;
        }
    }
    /* don't let truncation from integer division produce a zero result from a
       non-zero input */
    if (result === 0 && (ival !== 0 || lval !== 0 || uval !== 0 || ulval !== 0))
        result = 1;

    return result;
}

/* C ref: botl.c:2052 — the percentage for both xp (level) and exp (points) is
   (curr_exp - this_level_start) within (next_level_start - this_level_start). */
export function exp_percentage() {
    const u = game.u || {};
    let res = 0;

    if ((u.ulevel | 0) < 30) {
        const curlvlstart = newuexp((u.ulevel | 0) - 1);
        const exp_val = (u.uexp | 0) - curlvlstart;
        const nxt_exp_val = newuexp(u.ulevel | 0) - curlvlstart;
        if (exp_val === nxt_exp_val - 1) {
            /* Full 100% is unattainable (gaining a level raises the next
               threshold), but (next_level_start - 1) is a key value after
               being level drained, so treat it as a special case. */
            res = 100;
        } else {
            const curval = { anytype: ANY_LONG, a: zeroany(), rawval: zeroany(), fld: BL_EXP };
            const maxval = { anytype: ANY_LONG, a: zeroany(), rawval: zeroany(), fld: BL_EXP };
            curval.a.a_long = exp_val;
            maxval.a.a_long = nxt_exp_val;
            /* max delta between levels is 10000000, so 100 * (1e7 - N) / 1e7
               fits within a 32-bit long */
            res = percentage(curval, maxval);
        }
    }
    return res;
}

/* C ref: botl.c:2090 — experience points changed but the level didn't; is a
   botl update needed because a different Xp highlight rule now applies? */
export function exp_percent_changing() {
    let pc;
    let curr;

    /* if status update is already requested, skip this processing */
    if (!get_disp_botl()) {
        /* warranted iff the percent integer changes AND the new percentage
           selects a different highlighting rule */
        curr = gb.blstats[gn.now_or_before_idx][BL_XP];
        if (curr && curr.percent_matters && curr.thresholds
            && (pc = exp_percentage()) !== curr.percent_value) {
            const a = zeroany();
            a.a_int = game.u?.ulevel | 0;
            const out = { color: NO_COLOR };
            const rule = get_hilite(gn.now_or_before_idx, BL_XP, a, 0, pc, out);
            if (rule !== curr.hilite_rule)
                return true; /* caller should set 'disp.botl' to True */
        }
    }
    return false;
}

/* C ref: botl.c:2146 — callback so the interface can get the hunger index
   rather than reconstructing it from the hunger string. */
export function stat_hunger_indx() {
    return gb.blstats[gn.now_or_before_idx]?.[BL_HUNGER]?.a.a_int ?? (game.u?.uhs | 0);
}

/* C ref: botl.c:2160 — used by X11 for "tty status" even without hilites. */
export function bl_idx_to_fldname(idx) {
    if (idx >= 0 && idx < MAXBLSTATS) return initblstats[idx].fldname;
    return null;
}

/* ==================================================================== */
/*  Core status hiliting support                                        */
/* ==================================================================== */

/* C ref: botl.c has_hilite(i) / Is_Temp_Hilite(rule).  TH_UPDOWN encompasses
   specific 'up'/'down' as well as general 'changed'. */
function has_hilite(i) { return !!gb.blstats[0][i]?.thresholds; }
function Is_Temp_Hilite(rule) { return !!rule && rule.behavior === BL_TH_UPDOWN; }

/* C ref: botl.c threshold_value[] / is_out_of_range[] format fragments */
const threshold_value = 'hilite_status threshold ',
      is_out_of_range = ' is out of range';

/* C ref: files.c config_error_add() — private name so files.c's own symbol is
   not shadowed by a stub here. */
function config_error_add_bl(msg) {
    if (!Array.isArray(game.config_errors)) game.config_errors = [];
    game.config_errors.push(msg);
}

/* C ref: coloratt.c match_str2attr() / match_str2clr().  options.js has its
   own module-private pair; these are the botl.c-side callers' copies. */
const _attrnames = [
    ['none', ATR_NONE], ['bold', ATR_BOLD], ['dim', ATR_DIM],
    ['italic', ATR_ITALIC], ['underline', ATR_ULINE], ['blink', ATR_BLINK],
    ['inverse', ATR_INVERSE],
];
function match_str2attr_bl(str) {
    for (const [nm, val] of _attrnames)
        if (fuzzymatch(nm, str, ' -_', true)) return val;
    for (const [nm, val] of _attrnames)
        if (str && strncmpi(str, nm, String(str).length) === 0) return val;
    return -1;
}
function match_str2clr_bl(str) {
    for (let c = 0; c < CLR_MAX; c++) {
        const nm = clr2colorname(c);
        if (nm && (fuzzymatch(nm, str, ' -_', true)
                   || (str && strncmpi(str, nm, String(str).length) === 0)))
            return c;
    }
    return CLR_MAX;
}

/* C ref: botl.c splitsubfields() — '+' or '&' separated, at most 16 pieces;
   options.js carries its own copy for the option parser. */
function splitsubfields_bl(str, maxsf) {
    const MAX_SUBFIELDS = 16;
    if (!str) return [];
    maxsf = (maxsf === 0 || maxsf == null) ? MAX_SUBFIELDS : min(maxsf, MAX_SUBFIELDS);
    if (!str.includes('+') && !str.includes('&')) return [str];
    const parts = str.split(/[&+]/);
    if (parts.length >= maxsf - 1) return null; /* C returns -1 */
    return parts.filter((p, i) => p !== '' || i < parts.length - 1);
}

/* C ref: botl.c:2257 — has a temporary highlight timed out? */
export function hilite_reset_needed(bl_p, augmented_time) {
    /* This 'multi' handling may need some tuning... */
    if (game.multi) return false;
    if (!Is_Temp_Hilite(bl_p.hilite_rule)) return false;
    if (bl_p.time === 0 || bl_p.time >= augmented_time) return false;
    return true;
}

/* C ref: botl.c:2279 — called from moveloop(); sets disp.botl if temporary
   highlights have timed out. */
export function status_eval_next_unhilite() {
    let i, next_unhilite, this_unhilite;

    /* simplified; C once encoded fractional amounts for multiple moves within
       the same turn */
    gb.bl_hilite_moves = game.moves | 0;
    next_unhilite = 0;
    for (i = 0; i < MAXBLSTATS; ++i) {
        /* blstats[0][*].time == blstats[1][*].time */
        const curr = gb.blstats[0][i];
        if (!curr) continue;

        if (curr.chg) {
            const prev = gb.blstats[1][i];

            if (Is_Temp_Hilite(curr.hilite_rule))
                curr.time = gb.bl_hilite_moves + (game.iflags?.hilite_delta | 0);
            else
                curr.time = 0;
            prev.time = curr.time;

            curr.chg = prev.chg = false;
            set_disp_botl(true, null, null);
        }
        if (get_disp_botl())
            continue; /* just process other gb.blstats[][].time and .chg */

        this_unhilite = curr.time;
        if (this_unhilite > 0
            && (next_unhilite === 0 || this_unhilite < next_unhilite)
            && hilite_reset_needed(curr, this_unhilite + 1)) {
            next_unhilite = this_unhilite;
            if (next_unhilite < gb.bl_hilite_moves) set_disp_botl(true, null, null);
        }
    }
}

/* C ref: botl.c:2321 — called by options handling when 'statushilites' changes. */
export function reset_status_hilites() {
    if (game.iflags?.hilite_delta) {
        for (let i = 0; i < MAXBLSTATS; ++i)
            if (gb.blstats[0][i]) gb.blstats[0][i].time = gb.blstats[1][i].time = 0;
        gu.update_all = true;
    }
    set_disp_botl(null, true, null);
}

/* C ref: botl.c:2336 — does a title rule's text mean "title while
   polymorphed" in the 'textmatch' menu? */
export function noneoftheabove(hl_text) {
    if (fuzzymatch(hl_text, 'none of the above', '" -_', true)
        || fuzzymatch(hl_text, '(polymorphed)', '"()', true)
        || fuzzymatch(hl_text, 'none of the above (polymorphed)', '" -_()', true))
        return true;
    return false;
}

/*
 * C ref: botl.c:2364 — the highlight rule that applies to one field, given
 *   value      (for BL_TH_VAL_ABSOLUTE)
 *   chg        -1/0/1, down/same/up (for BL_TH_UPDOWN or change detection)
 *   pc         current-as-percent-of-max (for BL_TH_VAL_PERCENTAGE)
 * 'out.color' receives rule->coloridx (or NO_COLOR).  Returns null if no rule
 * applies.
 */
export function get_hilite(idx, fldidx, vp, chg, pc, out) {
    let hl, rule = null;
    const value = vp;
    let txtstr;

    if (fldidx < 0 || fldidx >= MAXBLSTATS) return null;

    if (has_hilite(fldidx)) {
        let dt;
        /* min_/max_ are used to track best fit */
        let max_pc = -1, min_pc = 101;
        /* LARGEST_INT isn't INT_MAX but is big enough for every 'int' field */
        let max_ival = -LARGEST_INT, min_ival = LARGEST_INT;
        let max_lval = -Number.MAX_SAFE_INTEGER, min_lval = Number.MAX_SAFE_INTEGER;
        let exactmatch = false, updown = false, changed = false,
            perc_or_abs = false, crit_hp = false;

        for (hl = gb.blstats[0][fldidx].thresholds; hl; hl = hl.next) {
            dt = initblstats[fldidx].anytype; /* only needed for 'absolute' */
            /* for HP, once a critical-hp rule matched, ignore other HP rules
               unless another critical-hp one hits (last one wins): otherwise a
               regenerating hero would always show the up/changed highlight */
            if (crit_hp && hl.behavior !== BL_TH_CRITICALHP) continue;
            /* a matched temporary highlight beats all persistent ones; keep
               processing updown rules to get the last qualifying one */
            if ((updown || changed) && hl.behavior !== BL_TH_UPDOWN) continue;
            /* among persistent highlights, a matched 'percentage' or
               'absolute' rule takes precedence over 'always' */
            if (perc_or_abs && hl.behavior === BL_TH_ALWAYS_HILITE) continue;

            switch (hl.behavior) {
            case BL_TH_VAL_PERCENTAGE: /* percent values are always ANY_INT */
                if (hl.rel === EQ_VALUE && pc === hl.value.a_int) {
                    rule = hl;
                    min_pc = max_pc = hl.value.a_int;
                    exactmatch = perc_or_abs = true;
                } else if (exactmatch) {
                    /* already found best fit, skip lt,ge,&c */
                } else if (hl.rel === LT_VALUE && (pc < hl.value.a_int)
                           && (hl.value.a_int <= min_pc)) {
                    rule = hl; min_pc = hl.value.a_int; perc_or_abs = true;
                } else if (hl.rel === LE_VALUE && (pc <= hl.value.a_int)
                           && (hl.value.a_int <= min_pc)) {
                    rule = hl; min_pc = hl.value.a_int; perc_or_abs = true;
                } else if (hl.rel === GT_VALUE && (pc > hl.value.a_int)
                           && (hl.value.a_int >= max_pc)) {
                    rule = hl; max_pc = hl.value.a_int; perc_or_abs = true;
                } else if (hl.rel === GE_VALUE && (pc >= hl.value.a_int)
                           && (hl.value.a_int >= max_pc)) {
                    rule = hl; max_pc = hl.value.a_int; perc_or_abs = true;
                }
                break;
            case BL_TH_UPDOWN: /* uses 'chg' (set by caller), not 'dt' */
                /* specific 'up' or 'down' beats general 'changed' regardless
                   of their order in the rule set */
                if (chg < 0 && hl.rel === LT_VALUE) {
                    rule = hl; updown = true;
                } else if (chg > 0 && hl.rel === GT_VALUE) {
                    rule = hl; updown = true;
                } else if (chg !== 0 && hl.rel === EQ_VALUE && !updown) {
                    rule = hl; changed = true;
                }
                break;
            case BL_TH_VAL_ABSOLUTE: /* either ANY_INT or ANY_LONG */
                /* the int and long variants are identical aside from the union
                   field and the min_/max_ names; change both together */
                if (dt === ANY_INT) {
                    if (hl.rel === EQ_VALUE && hl.value.a_int === value.a_int) {
                        rule = hl;
                        min_ival = max_ival = hl.value.a_int;
                        exactmatch = perc_or_abs = true;
                    } else if (exactmatch) {
                        /* already found best fit */
                    } else if (hl.rel === LT_VALUE && (value.a_int < hl.value.a_int)
                               && (hl.value.a_int <= min_ival)) {
                        rule = hl; min_ival = hl.value.a_int; perc_or_abs = true;
                    } else if (hl.rel === LE_VALUE && (value.a_int <= hl.value.a_int)
                               && (hl.value.a_int <= min_ival)) {
                        rule = hl; min_ival = hl.value.a_int; perc_or_abs = true;
                    } else if (hl.rel === GT_VALUE && (value.a_int > hl.value.a_int)
                               && (hl.value.a_int >= max_ival)) {
                        rule = hl; max_ival = hl.value.a_int; perc_or_abs = true;
                    } else if (hl.rel === GE_VALUE && (value.a_int >= hl.value.a_int)
                               && (hl.value.a_int >= max_ival)) {
                        rule = hl; max_ival = hl.value.a_int; perc_or_abs = true;
                    }
                } else { /* ANY_LONG */
                    if (hl.rel === EQ_VALUE && hl.value.a_long === value.a_long) {
                        rule = hl;
                        min_lval = max_lval = hl.value.a_long;
                        exactmatch = perc_or_abs = true;
                    } else if (exactmatch) {
                        /* already found best fit */
                    } else if (hl.rel === LT_VALUE && (value.a_long < hl.value.a_long)
                               && (hl.value.a_long <= min_lval)) {
                        rule = hl; min_lval = hl.value.a_long; perc_or_abs = true;
                    } else if (hl.rel === LE_VALUE && (value.a_long <= hl.value.a_long)
                               && (hl.value.a_long <= min_lval)) {
                        rule = hl; min_lval = hl.value.a_long; perc_or_abs = true;
                    } else if (hl.rel === GT_VALUE && (value.a_long > hl.value.a_long)
                               && (hl.value.a_long >= max_lval)) {
                        rule = hl; max_lval = hl.value.a_long; perc_or_abs = true;
                    } else if (hl.rel === GE_VALUE && (value.a_long >= hl.value.a_long)
                               && (hl.value.a_long >= max_lval)) {
                        rule = hl; max_lval = hl.value.a_long; perc_or_abs = true;
                    }
                }
                break;
            case BL_TH_TEXTMATCH: /* ANY_STR */
                txtstr = gb.blstats[idx][fldidx].val ?? '';
                if (fldidx === BL_TITLE)
                    /* "<name> the <rank-title>": skip past "<name> the " */
                    txtstr = txtstr.slice(String(game.plname ?? '').length + ' the '.length);
                if (hl.rel === TXT_VALUE && hl.textmatch && hl.textmatch[0]) {
                    if (fuzzymatch(hl.textmatch, txtstr, '" -_', true)) {
                        rule = hl;
                        exactmatch = true;
                    } else if (exactmatch) {
                        /* already found best fit, skip "noneoftheabove" */
                    } else if (fldidx === BL_TITLE && game.u?.Upolyd
                               && noneoftheabove(hl.textmatch)) {
                        rule = hl;
                    }
                }
                break;
            case BL_TH_ALWAYS_HILITE:
                rule = hl;
                break;
            case BL_TH_CRITICALHP:
                if (fldidx === BL_HP && critically_low_hp_p(false)) {
                    rule = hl;
                    crit_hp = true;
                    updown = changed = perc_or_abs = false;
                }
                break;
            case BL_TH_NONE:
            default:
                break;
            }
        }
    }
    if (out) out.color = rule ? rule.coloridx : NO_COLOR;
    return rule;
}

/* C ref: botl.c:2576 — coloridx packs color in the low byte, attributes in
   the next. */
export function split_clridx(idx, out) {
    if (out) {
        out.coloridx = idx & 0x00FF;
        out.attrib = (idx >> 8) & 0x00FF;
    }
    return out;
}

/* C ref: botl.c:2730 — is 'str' one of arr[arrmin..arrmax)? */
export function is_fld_arrayvalues(str, arr, arrmin, arrmax, out) {
    for (let i = arrmin; i < arrmax; i++)
        if (arr[i] != null && strcmpi(str, arr[i]) === 0) {
            if (out) out.retidx = i;
            return true;
        }
    return false;
}

/* C ref: botl.c:2784 — append a copy of 'hilite' to this field's chain. */
export function status_hilite_add_threshold(fld, hilite) {
    let old_hilite;

    if (!hilite) return;

    /* alloc and initialize a new hilite_s struct */
    const new_hilite = { ...hilite };

    new_hilite.set = true;
    new_hilite.fld = fld;
    new_hilite.next = null;
    /* insert new entry at the end of the list */
    if (!gb.blstats[0][fld].thresholds) {
        gb.blstats[0][fld].thresholds = new_hilite;
    } else {
        for (old_hilite = gb.blstats[0][fld].thresholds; old_hilite.next;
             old_hilite = old_hilite.next)
            continue;
        old_hilite.next = new_hilite;
    }
    /* current and prev must both point at the same hilites */
    gb.blstats[1][fld].thresholds = gb.blstats[0][fld].thresholds;
}

/* C ref: botl.c:3351 */
export function clear_status_hilites() {
    for (let i = 0; i < MAXBLSTATS; ++i) {
        if (!gb.blstats[0][i]) continue;
        gb.blstats[0][i].thresholds = gb.blstats[1][i].thresholds = null;
        /* pointer into thresholds list, now stale */
        gb.blstats[0][i].hilite_rule = gb.blstats[1][i].hilite_rule = null;
    }
}

/* C ref: botl.c:3369 — "bold+inverse" from an hlattribs bitmask. */
export function hlattr2attrname(attrib, buf, bufsz) {
    if (attrib && buf !== null && buf !== undefined) {
        let attbuf = '';
        let first = 0;

        if (attrib === HL_NONE) return 'normal';

        if (attrib & HL_BOLD) attbuf += (first++ ? '+bold' : 'bold');
        if (attrib & HL_DIM) attbuf += (first++ ? '+dim' : 'dim');
        if (attrib & HL_ITALIC) attbuf += (first++ ? '+italic' : 'italic');
        if (attrib & HL_ULINE) attbuf += (first++ ? '+underline' : 'underline');
        if (attrib & HL_BLINK) attbuf += (first++ ? '+blink' : 'blink');
        if (attrib & HL_INVERSE) attbuf += (first++ ? '+inverse' : 'inverse');

        /* C only copies when it fits, otherwise buf keeps its old contents */
        return (attbuf.length < (bufsz - 1)) ? attbuf : buf;
    }
    return null;
}

/* C ref: botl.c:3141 — "stone+slime" (or the alias that covers exactly ul). */
export function conditionbitmask2str(ul) {
    let buf = '';
    let first = true;
    let alias = null;

    if (!ul) return buf;

    /* deliberately starts at 1: entry 0 ("strangled") is a single-condition
       alias and would hide the canonical name */
    for (let i = 1; i < condition_aliases.length; i++)
        if (condition_aliases[i].bitmask === ul) alias = condition_aliases[i].id;

    for (let i = 0; i < conditions.length; i++)
        if ((conditions[i].mask & ul) !== 0) {
            buf += `${first ? '' : '+'}${conditions[i].text[0]}`;
            first = false;
        }

    if (!first && alias) buf = alias;

    return buf;
}

/* C ref: botl.c:3171 — canonical condition names, then aliases, then partial
   matches to aliases. */
export function match_str2conditionbitmask(str) {
    let nmatches = 0;
    let mask = 0;

    if (str && str.length) {
        for (let i = 0; i < conditions.length; i++)
            if (fuzzymatch(conditions[i].text[0], str, ' -_', true)) {
                mask |= conditions[i].mask;
                nmatches++;
            }

        if (!nmatches) {
            for (let i = 0; i < condition_aliases.length; i++)
                if (fuzzymatch(condition_aliases[i].id, str, ' -_', true)) {
                    mask |= condition_aliases[i].bitmask;
                    nmatches++;
                }
        }

        if (!nmatches) {
            const len = str.length;
            for (let i = 0; i < condition_aliases.length; i++)
                if (strncmpi(str, condition_aliases[i].id, len) === 0) {
                    mask |= condition_aliases[i].bitmask;
                    nmatches++;
                }
        }
    }

    return mask;
}

/* C ref: botl.c:3209 */
export function str2conditionbitmask(str) {
    let conditions_bitmask = 0;

    const subfields = splitsubfields_bl(str, conditions.length);

    if (!subfields || subfields.length < 1) return 0;

    for (let i = 0; i < subfields.length; ++i) {
        const bm = match_str2conditionbitmask(subfields[i]);

        if (!bm) {
            config_error_add_bl(`Unknown condition '${subfields[i]}'`);
            return 0;
        }
        conditions_bitmask |= bm;
    }
    return conditions_bitmask;
}

/* C ref: botl.c:3233 — "condition/stone+slime+foodPois/red&inverse".  Unlike
   the other fields, conditions store their color/attribute choice in the
   gc.cond_hilites[] array rather than in a hilite_s chain. */
export function parse_condition(s, sidx) {
    let coloridx = NO_COLOR;
    let conditions_bitmask = 0;
    let result = false;

    if (!s) return false;

    sidx++;
    if (!s[sidx] || !s[sidx][0]) {
        config_error_add_bl('Missing condition(s)');
        return false;
    }
    while (s[sidx] && s[sidx][0]) {
        conditions_bitmask = str2conditionbitmask(s[sidx]);

        if (!conditions_bitmask) return false;

        /* actions */
        sidx++;
        const how = s[sidx];
        if (!how || !how.length) {
            config_error_add_bl('Missing color+attribute');
            return false;
        }

        const subfields = splitsubfields_bl(how, 0) || [];

        /*
         * conditions_bitmask now has bits set for the conditions the player
         * wants represented; parse out *how*.  Only one colour is allowed but
         * potentially multiple attributes are, which is why the attributes get
         * array offsets past CLR_MAX.
         */
        for (let i = 0; i < subfields.length; ++i) {
            const a = match_str2attr_bl(subfields[i]);

            if (a === ATR_BOLD) gc.cond_hilites[HL_ATTCLR_BOLD] |= conditions_bitmask;
            else if (a === ATR_DIM) gc.cond_hilites[HL_ATTCLR_DIM] |= conditions_bitmask;
            else if (a === ATR_ITALIC) gc.cond_hilites[HL_ATTCLR_ITALIC] |= conditions_bitmask;
            else if (a === ATR_ULINE) gc.cond_hilites[HL_ATTCLR_ULINE] |= conditions_bitmask;
            else if (a === ATR_BLINK) gc.cond_hilites[HL_ATTCLR_BLINK] |= conditions_bitmask;
            else if (a === ATR_INVERSE) gc.cond_hilites[HL_ATTCLR_INVERSE] |= conditions_bitmask;
            else if (a === ATR_NONE) {
                gc.cond_hilites[HL_ATTCLR_BOLD] &= ~conditions_bitmask;
                gc.cond_hilites[HL_ATTCLR_DIM] &= ~conditions_bitmask;
                gc.cond_hilites[HL_ATTCLR_ITALIC] &= ~conditions_bitmask;
                gc.cond_hilites[HL_ATTCLR_ULINE] &= ~conditions_bitmask;
                gc.cond_hilites[HL_ATTCLR_BLINK] &= ~conditions_bitmask;
                gc.cond_hilites[HL_ATTCLR_INVERSE] &= ~conditions_bitmask;
            } else {
                const k = match_str2clr_bl(subfields[i]);

                if (k >= CLR_MAX) {
                    config_error_add_bl(`bad color ${k}`);
                    return false;
                }
                coloridx = k;
            }
        }
        /* set the bits in the appropriate member of the condition array
           according to the color chosen as index */
        gc.cond_hilites[coloridx] |= conditions_bitmask;
        result = true;
        sidx++;
    }
    return result;
}

/* C ref: botl.c struct _status_hilite_line_str — the flattened, printable form
   of every currently defined rule; these two don't need to be in 'struct g'. */
let status_hilite_str = null;
let status_hilite_str_id = 0;

/* C ref: botl.c:3417 */
export function status_hilite_linestr_add(fld, hl, mask, str) {
    const tmp = { id: 0, fld: 0, hl: null, mask: 0, str: '', next: null };

    tmp.id = ++status_hilite_str_id;
    tmp.fld = fld;
    tmp.hl = hl;
    tmp.mask = mask;
    /* title values may legitimately contain spaces; everything else is
       squeezed so the RC line round-trips */
    tmp.str = (fld === BL_TITLE) ? String(str) : stripchars(' ', str);

    let nxt = status_hilite_str;
    if (nxt) {
        while (nxt.next) nxt = nxt.next;
        nxt.next = tmp;
    } else {
        status_hilite_str = tmp;
    }
}

/* C ref: botl.c:3448 */
export function status_hilite_linestr_done() {
    status_hilite_str = null;
    status_hilite_str_id = 0;
}

/* C ref: botl.c:3462 — BL_FLUSH counts every field. */
export function status_hilite_linestr_countfield(fld) {
    const countall = (fld === BL_FLUSH);
    let count = 0;

    for (let tmp = status_hilite_str; tmp; tmp = tmp.next)
        if (countall || tmp.fld === fld) count++;
    return count;
}

/* C ref: botl.c:3488 — group the conditions that share a colour+attribute
   into one "condition/<names>/<colour>" line apiece. */
export function status_hilite_linestr_gather_conditions() {
    const cond_maps = [];
    for (let i = 0; i < conditions.length; i++) cond_maps.push({ bm: 0, clratr: 0 });

    for (let i = 0; i < conditions.length; i++) {
        let clr = NO_COLOR;
        let atr = HL_NONE;
        let j;

        for (j = 0; j < CLR_MAX; j++)
            if (gc.cond_hilites[j] & conditions[i].mask) { clr = j; break; }
        if (gc.cond_hilites[HL_ATTCLR_BOLD] & conditions[i].mask) atr |= HL_BOLD;
        if (gc.cond_hilites[HL_ATTCLR_DIM] & conditions[i].mask) atr |= HL_DIM;
        if (gc.cond_hilites[HL_ATTCLR_ITALIC] & conditions[i].mask) atr |= HL_ITALIC;
        if (gc.cond_hilites[HL_ATTCLR_ULINE] & conditions[i].mask) atr |= HL_ULINE;
        if (gc.cond_hilites[HL_ATTCLR_BLINK] & conditions[i].mask) atr |= HL_BLINK;
        if (gc.cond_hilites[HL_ATTCLR_INVERSE] & conditions[i].mask) atr |= HL_INVERSE;
        if (atr !== HL_NONE) atr &= ~HL_NONE;

        if (clr !== NO_COLOR || atr !== HL_NONE) {
            const ca = clr | (atr << 8);
            let added_condmap = false;

            for (j = 0; j < conditions.length; j++)
                if (cond_maps[j].clratr === ca) {
                    cond_maps[j].bm |= conditions[i].mask;
                    added_condmap = true;
                    break;
                }
            if (!added_condmap) {
                for (j = 0; j < conditions.length; j++)
                    if (!cond_maps[j].bm) {
                        cond_maps[j].bm = conditions[i].mask;
                        cond_maps[j].clratr = ca;
                        break;
                    }
            }
        }
    }

    for (let i = 0; i < conditions.length; i++)
        if (cond_maps[i].bm) {
            const sp = split_clridx(cond_maps[i].clratr, { coloridx: NO_COLOR, attrib: HL_NONE });
            const clr = sp.coloridx, atr = sp.attrib;
            if (clr !== NO_COLOR || atr !== HL_NONE) {
                let clrbuf = strNsubst(clr2colorname(clr), ' ', '-', 0);
                const tmpattr = hlattr2attrname(atr, '', BUFSZ);
                if (tmpattr) clrbuf += `&${tmpattr}`;
                const condbuf = `condition/${conditionbitmask2str(cond_maps[i].bm)}/${clrbuf}`;
                status_hilite_linestr_add(BL_CONDITION, null, cond_maps[i].bm, condbuf);
            }
        }
}

/* C ref: botl.c:3570 */
export function status_hilite_linestr_gather() {
    status_hilite_linestr_done();

    for (let i = 0; i < MAXBLSTATS; i++) {
        let hl = gb.blstats[0][i]?.thresholds;
        while (hl) {
            status_hilite_linestr_add(i, hl, 0, status_hilite2str(hl));
            hl = hl.next;
        }
    }

    status_hilite_linestr_gather_conditions();
}

/* C ref: botl.c:3590 — "<field>/<behaviour>/<colour>&<attrs>". */
export function status_hilite2str(hl) {
    let behavebuf = '', clrbuf = '';
    let op;

    if (!hl) return null;

    op = (hl.rel === LT_VALUE) ? '<'
         : (hl.rel === LE_VALUE) ? '<='
           : (hl.rel === GT_VALUE) ? '>'
             : (hl.rel === GE_VALUE) ? '>='
               : (hl.rel === EQ_VALUE) ? '=' : null;

    switch (hl.behavior) {
    case BL_TH_VAL_PERCENTAGE:
        if (op) behavebuf = `${op}${hl.value.a_int}%`;
        break;
    case BL_TH_UPDOWN:
        if (hl.rel === LT_VALUE) behavebuf = 'down';
        else if (hl.rel === GT_VALUE) behavebuf = 'up';
        else if (hl.rel === EQ_VALUE) behavebuf = 'changed';
        break;
    case BL_TH_VAL_ABSOLUTE:
        if (op) behavebuf = `${op}${hl.value.a_int}`;
        break;
    case BL_TH_TEXTMATCH:
        if (hl.rel === TXT_VALUE && hl.textmatch && hl.textmatch[0])
            behavebuf = `${hl.textmatch}`;
        break;
    case BL_TH_CONDITION:
        if (hl.rel === EQ_VALUE)
            behavebuf = `${conditionbitmask2str(hl.value.a_ulong)}`;
        break;
    case BL_TH_ALWAYS_HILITE:
        behavebuf = 'always';
        break;
    case BL_TH_CRITICALHP:
        behavebuf = 'criticalhp';
        break;
    case BL_TH_NONE:
    default:
        break;
    }

    const sp = split_clridx(hl.coloridx, { coloridx: NO_COLOR, attrib: ATR_NONE });
    const clr = sp.coloridx, attr = sp.attrib;
    clrbuf = strNsubst(clr2colorname(clr), ' ', '-', 0);
    if (attr !== HL_UNDEF) {
        const tmpattr = hlattr2attrname(attr, '', BUFSZ);
        if (tmpattr) clrbuf += `&${tmpattr}`;
    }
    return `${initblstats[hl.fld].fldname}/${behavebuf}/${clrbuf}`;
}

/* C ref: botl.c:4305 — drop one gathered rule by its menu id. */
export function status_hilite_remove(id) {
    let hlstr = status_hilite_str;

    while (hlstr && hlstr.id !== id) hlstr = hlstr.next;

    if (!hlstr) return false;

    if (hlstr.fld === BL_CONDITION) {
        for (let i = 0; i < CLR_MAX; i++) gc.cond_hilites[i] &= ~hlstr.mask;
        gc.cond_hilites[HL_ATTCLR_BOLD] &= ~hlstr.mask;
        gc.cond_hilites[HL_ATTCLR_DIM] &= ~hlstr.mask;
        gc.cond_hilites[HL_ATTCLR_ITALIC] &= ~hlstr.mask;
        gc.cond_hilites[HL_ATTCLR_ULINE] &= ~hlstr.mask;
        gc.cond_hilites[HL_ATTCLR_BLINK] &= ~hlstr.mask;
        gc.cond_hilites[HL_ATTCLR_INVERSE] &= ~hlstr.mask;
        return true;
    } else {
        const fld = hlstr.fld;
        let hl, hlprev = null;

        for (hl = gb.blstats[0][fld].thresholds; hl; hl = hl.next) {
            if (hlstr.hl === hl) {
                if (hlprev) {
                    hlprev.next = hl.next;
                } else {
                    gb.blstats[0][fld].thresholds = hl.next;
                    gb.blstats[1][fld].thresholds = gb.blstats[0][fld].thresholds;
                }
                if (gb.blstats[0][fld].hilite_rule === hl) {
                    gb.blstats[0][fld].hilite_rule
                        = gb.blstats[1][fld].hilite_rule = null;
                    gb.blstats[0][fld].time = gb.blstats[1][fld].time = 0;
                }
                return true;
            }
            hlprev = hl;
        }
    }
    return false;
}

/* C ref: botl.c:4477 — #saveoptions writes every rule back out. */
export function all_options_statushilites(sbuf) {
    status_hilite_linestr_done();
    status_hilite_linestr_gather();

    let hlstr = status_hilite_str;

    while (hlstr) {
        const lim = BUFSZ - 'OPTIONS=hilite_status:  '.length - 1;
        sbuf.push(`OPTIONS=hilite_status: ${String(hlstr.str).slice(0, lim)}\n`);
        hlstr = hlstr.next;
    }
    status_hilite_linestr_done();
}

/* ==================================================================== */
/*  windows.c wrappers over the port's tty_* window layer               */
/*                                                                      */
/*  The port has no windows.c abstraction (each module drives wintty.js  */
/*  directly), so botl.c's menu code gets these thin shims.  They are    */
/*  async because tty_select_menu()/tty_getlin() are.                    */
/* ==================================================================== */

/* C ref: decl.c nul_glyphinfo */
const nul_glyphinfo = { glyph: 0, ttychar: ' ', gm: {} };

function create_nhwindow(type) { return tty_create_nhwindow(type); }
function destroy_nhwindow(win) { return tty_destroy_nhwindow(win); }
function start_menu(win, mbehavior) { return tty_start_menu(win, mbehavior); }
function add_menu(win, gi, identifier, ch, gch, attr, clr, str, itemflags) {
    return tty_add_menu(win, gi, identifier, ch, gch, attr, clr, str, itemflags);
}
/* C ref: windows.c add_menu_str() / add_menu_heading() — a non-selectable
   line, the heading form with ATR_SUBTITLE and MENU_ITEMFLAGS_SKIPINVERT. */
function add_menu_str(win, str) {
    return tty_add_menu(win, nul_glyphinfo, zeroany(), 0, 0, ATR_NONE,
                        NO_COLOR, str, MENU_ITEMFLAGS_NONE);
}
function add_menu_heading(win, str) {
    return tty_add_menu(win, nul_glyphinfo, zeroany(), 0, 0, ATR_INVERSE,
                        NO_COLOR, str, MENU_ITEMFLAGS_SKIPINVERT);
}
function end_menu(win, prompt) { return tty_end_menu(win, prompt); }
function select_menu(win, how, picks) { return tty_select_menu(win, how, picks); }
function putstr(win, attr, str) { return tty_putstr(win, attr, str); }
function display_nhwindow(win, blocking) { return tty_display_nhwindow(win, blocking); }
function getlin(query) { return hooked_tty_getlin(query, null); }

/* C ref: botl.c:3109 — pick a set of conditions for one hilite rule. */
export async function query_conditions() {
    let ret = 0;
    const picks = [];

    const tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);

    for (let i = 0; i < conditions.length; i++) {
        const any = zeroany();
        any.a_ulong = conditions[i].mask;
        any.a_void = conditions[i].mask; /* selectability marker */
        add_menu(tmpwin, nul_glyphinfo, any, 0, 0, ATR_NONE,
                 NO_COLOR, conditions[i].text[0], MENU_ITEMFLAGS_NONE);
    }

    end_menu(tmpwin, 'Choose status conditions');

    const res = await select_menu(tmpwin, PICK_ANY, picks);
    destroy_nhwindow(tmpwin);
    if (res > 0)
        for (let i = 0; i < res; i++) ret |= picks[i].item.a_ulong;
    return ret;
}

/* C ref: botl.c:2747 — menu of arr[arrmin..arrmax); returns the chosen index
   or arrmin-1.  The 'adj' dance keeps a_int non-zero (0 is unselectable). */
export async function query_arrayvalue(querystr, arr, arrmin, arrmax) {
    let ret = arrmin - 1;
    const picks = [];
    const adj = (arrmin > 0) ? 1 : arrmax;

    const tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);

    for (let i = arrmin; i < arrmax; i++) {
        if (!arr[i])  /* the hunger status array has a gap ... */
            continue; /* ... set to Null between Satiated and Hungry */
        const any = zeroany();
        any.a_int = i + adj;
        any.a_void = i + adj;
        add_menu(tmpwin, nul_glyphinfo, any, 0, 0, ATR_NONE,
                 NO_COLOR, arr[i], MENU_ITEMFLAGS_NONE);
    }

    end_menu(tmpwin, querystr);

    const res = await select_menu(tmpwin, PICK_ONE, picks);
    destroy_nhwindow(tmpwin);
    if (res > 0) ret = picks[0].item.a_int - adj;

    return ret;
}

/* C ref: botl.c:1376 — the 'mO' conditions menu; True iff anything changed. */
export async function cond_menu() {
    const menutitle = ['alphabetically', 'by ranking'];
    let i, res = 0, idx = 0;
    const sequence = new Array(CONDITION_COUNT).fill(0);
    let mbuf;
    let showmenu = true;
    const clr = NO_COLOR;
    let changed = false;

    do {
        for (i = 0; i < CONDITION_COUNT; ++i) sequence[i] = i;
        sequence.sort(gc.condmenu_sortorder ? cond_cmp : menualpha_cmp);

        const tmpwin = create_nhwindow(NHW_MENU);
        start_menu(tmpwin, MENU_BEHAVE_STANDARD);

        let any = zeroany();
        any.a_int = 1;
        any.a_void = 1;
        mbuf = `change sort order from "${menutitle[gc.condmenu_sortorder]}"`
             + ` to "${menutitle[1 - gc.condmenu_sortorder]}"`;
        add_menu(tmpwin, nul_glyphinfo, any, 'S', 0, ATR_NONE,
                 clr, mbuf, MENU_ITEMFLAGS_SKIPINVERT);
        mbuf = `sorted ${menutitle[gc.condmenu_sortorder]}`;
        add_menu_heading(tmpwin, mbuf);
        for (i = 0; i < condtests.length; i++) {
            idx = sequence[i];
            mbuf = `cond_${padr(condtests[idx].useroption, 14)}`;
            any = zeroany();
            any.a_int = idx + 2; /* avoid zero and the sort change pick */
            any.a_void = idx + 2;
            condtests[idx].choice = false;
            add_menu(tmpwin, nul_glyphinfo, any, 0, 0, ATR_NONE, clr, mbuf,
                     condtests[idx].enabled
                        ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
        }

        end_menu(tmpwin, 'Choose status conditions to toggle');

        const picks = [];
        res = await select_menu(tmpwin, PICK_ANY, picks);
        destroy_nhwindow(tmpwin);
        showmenu = false;
        if (res > 0) {
            for (i = 0; i < res; i++) {
                idx = picks[i].item.a_int;
                if (idx === 1) {
                    /* sort change requested */
                    gc.condmenu_sortorder = 1 - gc.condmenu_sortorder;
                    showmenu = true;
                    break;      /* for loop */
                } else {
                    idx -= 2;
                    condtests[idx].choice = true;
                }
            }
        }
    } while (showmenu);

    if (res >= 0) {
        for (i = 0; i < CONDITION_COUNT; ++i)
            if (condtests[i].enabled !== condtests[i].choice) {
                condtests[i].enabled = condtests[i].choice;
                /* C uses 'idx' here, not 'i' — the last menu index touched */
                condtests[idx].test = false;
                set_disp_botl(true, null, null);
                changed = true;
            }
    }
    return changed;
}

/* C ref: botl.c:3672 */
export async function status_hilite_menu_choose_field() {
    let fld = BL_FLUSH;
    const picks = [];

    const tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);

    for (let i = 0; i < MAXBLSTATS; i++) {
        /* without SCORE_ON_BOTL, 'score' only appears if the config file
           defined rules for it */
        if (!SCORE_ON_BOTL && initblstats[i].fld === BL_SCORE
            && !gb.blstats[0][BL_SCORE]?.thresholds)
            continue;
        const any = zeroany();
        any.a_int = (i + 1);
        any.a_void = i + 1;
        add_menu(tmpwin, nul_glyphinfo, any, 0, 0, ATR_NONE,
                 NO_COLOR, initblstats[i].fldname, MENU_ITEMFLAGS_NONE);
    }

    end_menu(tmpwin, 'Select a hilite field:');

    const res = await select_menu(tmpwin, PICK_ONE, picks);
    destroy_nhwindow(tmpwin);
    if (res > 0) fld = picks[0].item.a_int - 1;
    return fld;
}

/* C ref: botl.c:3707 — which behaviours make sense for this field.  With only
   one candidate C skips the menu entirely and returns it. */
export async function status_hilite_menu_choose_behavior(fld) {
    let res = 0, beh = BL_TH_NONE - 1;
    let buf;
    let onlybeh = BL_TH_NONE, nopts = 0;
    const clr = NO_COLOR;
    const picks = [];

    if (fld < 0 || fld >= MAXBLSTATS) return BL_TH_NONE;

    const at = initblstats[fld].anytype;

    const tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    const addbeh = (val, ch, str) => {
        const any = zeroany();
        any.a_int = onlybeh = val;
        any.a_void = val;
        add_menu(tmpwin, nul_glyphinfo, any, ch, 0, ATR_NONE, clr, str,
                 MENU_ITEMFLAGS_NONE);
        nopts++;
    };

    if (fld !== BL_CONDITION) {
        buf = `Always highlight ${initblstats[fld].fldname}`;
        addbeh(BL_TH_ALWAYS_HILITE, 'a', buf);
    }
    if (fld === BL_CONDITION)
        addbeh(BL_TH_CONDITION, 'b', 'Bitmask of conditions');
    if (fld !== BL_CONDITION && fld !== BL_VERS) {
        buf = `${initblstats[fld].fldname} value changes`;
        addbeh(BL_TH_UPDOWN, 'c', buf);
    }
    if (fld !== BL_CAP && fld !== BL_HUNGER
        && (at === ANY_INT || at === ANY_LONG))
        addbeh(BL_TH_VAL_ABSOLUTE, 'n', 'Number threshold');
    if (initblstats[fld].idxmax >= 0)
        addbeh(BL_TH_VAL_PERCENTAGE, 'p', 'Percentage threshold');
    if (fld === BL_HP) {
        buf = `Highlight critically low ${initblstats[fld].fldname}`;
        addbeh(BL_TH_CRITICALHP, 'C', buf);
    }
    if (initblstats[fld].anytype === ANY_STR
        || fld === BL_CAP || fld === BL_HUNGER) {
        buf = `${initblstats[fld].fldname} text match`;
        addbeh(BL_TH_TEXTMATCH, 't', buf);
    }

    buf = `Select ${initblstats[fld].fldname} field hilite behavior:`;
    end_menu(tmpwin, buf);

    if (nopts > 1) {
        res = await select_menu(tmpwin, PICK_ONE, picks);
        if (res === 0) beh = BL_TH_NONE;            /* none chosen */
        else if (res === -1) beh = (BL_TH_NONE - 1); /* menu cancelled */
    } else if (onlybeh !== BL_TH_NONE) {
        beh = onlybeh;
    }
    destroy_nhwindow(tmpwin);
    if (res > 0) beh = picks[0].item.a_int;
    return beh;
}

/* C ref: botl.c:3811 — the </<=/=/>=/> menu.  'str' null means the UPDOWN
   flavour ("Value goes down" / "Value changes" / "Value goes up"). */
export async function status_hilite_menu_choose_updownboth(fld, str, ltok, gtok) {
    let ret = NO_LTEQGT;
    let buf;
    const clr = NO_COLOR;
    const picks = [];

    const tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    const additem = (rel, text) => {
        const any = zeroany();
        any.a_int = 10 + rel;
        any.a_void = 10 + rel;
        add_menu(tmpwin, nul_glyphinfo, any, 0, 0, ATR_NONE, clr, text,
                 MENU_ITEMFLAGS_NONE);
    };

    if (ltok) {
        buf = str ? `${(fld === BL_AC) ? 'Better (lower)' : 'Less'} than ${str}`
                  : 'Value goes down';
        additem(LT_VALUE, buf);

        if (str) {
            buf = `${str} or ${(fld === BL_AC) ? 'better (lower)' : 'less'}`;
            additem(LE_VALUE, buf);
        }
    }

    buf = str ? `Exactly ${str}` : 'Value changes';
    additem(EQ_VALUE, buf);

    if (gtok) {
        if (str) {
            buf = `${str} or ${(fld === BL_AC) ? 'worse (higher)' : 'more'}`;
            additem(GE_VALUE, buf);
        }
        buf = str ? `${(fld === BL_AC) ? 'Worse (higher)' : 'More'} than ${str}`
                  : 'Value goes up';
        additem(GT_VALUE, buf);
    }
    buf = `Select field ${initblstats[fld].fldname} value:`;
    end_menu(tmpwin, buf);

    const res = await select_menu(tmpwin, PICK_ONE, picks);
    destroy_nhwindow(tmpwin);
    if (res > 0) ret = picks[0].item.a_int - 10;

    return ret;
}

/* C ref: botl.c:3890 — interactively build one rule.  C uses four labels
   (choose_field / choose_behavior / choose_value / choose_color) with backward
   gotos, so this is a state machine over those exact labels rather than
   restructured loops. */
export async function status_hilite_menu_add(origfld) {
    let fld, behavior, lt_gt_eq;
    let clr = NO_COLOR, atr = HL_UNDEF;
    let hilite;
    let cond = 0;
    let colorqry = '', attrqry = '';
    let retry = 0;
    let state = 'choose_field';

    for (;;) {
    if (state === 'choose_field') {
        fld = origfld;
        if (fld === BL_FLUSH) {
            fld = await status_hilite_menu_choose_field();
            /* isn't this redundant given what follows? (C's own comment) */
            if (fld === BL_FLUSH) return false;
        }
        if (fld === BL_FLUSH) return false;

        colorqry = '';
        attrqry = '';

        hilite = {
            fld, set: false, anytype: 0, value: zeroany(), behavior: 0,
            textmatch: '', rel: 0, coloridx: 0, next: null,
        };
        state = 'choose_behavior';
        continue;
    }

    if (state === 'choose_behavior') {
        behavior = await status_hilite_menu_choose_behavior(fld);

        if (behavior === (BL_TH_NONE - 1)) {
            return false;
        } else if (behavior === BL_TH_NONE) {
            if (origfld === BL_FLUSH) { state = 'choose_field'; continue; }
            return false;
        }
        hilite.behavior = behavior;
        state = 'choose_value';
        continue;
    }

    if (state === 'choose_value') {
        if (retry++ > 5) {
            await pline("That's enough tries.");
            return false;
        }
        if (behavior === BL_TH_VAL_PERCENTAGE
            || behavior === BL_TH_VAL_ABSOLUTE) {
            let val, dt;
            let gotnum = false;
            const percent = (behavior === BL_TH_VAL_PERCENTAGE);
            let op;

            lt_gt_eq = NO_LTEQGT; /* not set up yet */
            const buf = `Enter ${percent ? 'percentage ' : ''}value for`
                      + ` ${initblstats[fld].fldname} threshold:`;
            let inbuf = await getlin(buf);
            inbuf = (inbuf == null) ? '\x1b' : inbuf;
            if (inbuf === '' || inbuf[0] === '\x1b') { state = 'choose_behavior'; continue; }

            inbuf = trimspaces(inbuf);
            let inp = inbuf;
            if (!inp) { state = 'choose_behavior'; continue; }

            /* allow "<50%", ">50", "50", "<=50%", ">=50", "=50" */
            let ni = 0;
            if (inp[0] === '>' || inp[0] === '<' || inp[0] === '=') {
                lt_gt_eq = (inp[0] === '>') ? ((inp[1] === '=') ? GE_VALUE : GT_VALUE)
                         : (inp[0] === '<') ? ((inp[1] === '=') ? LE_VALUE : LT_VALUE)
                           : EQ_VALUE;
                ni++;
                if (lt_gt_eq === GE_VALUE || lt_gt_eq === LE_VALUE) ni++;
            }
            let numstart = ni;
            if (inp[ni] === '-') {
                ni++;
            } else if (inp[ni] === '+') {
                ni++;
                numstart++;
            }
            while (ni < inp.length && digit(inp[ni])) { ni++; gotnum = true; }
            if (inp[ni] === '%') {
                if (!percent) {
                    await pline('Not expecting a percentage.');
                    state = 'choose_behavior';
                    continue;
                }
                /* strip '%' [this accepts trailing junk!] */
                inp = inp.slice(0, ni);
            } else if (ni < inp.length) {
                /* some random characters */
                await pline(`"${inp.slice(ni)}" is not a recognized number.`);
                state = 'choose_value';
                continue;
            }
            if (!gotnum) {
                await pline('Is that an invisible number?');
                state = 'choose_value';
                continue;
            }
            op = (lt_gt_eq === LT_VALUE) ? '<'
                 : (lt_gt_eq === LE_VALUE) ? '<='
                   : (lt_gt_eq === GT_VALUE) ? '>'
                     : (lt_gt_eq === GE_VALUE) ? '>='
                       : (lt_gt_eq === EQ_VALUE) ? '=' : '';

            const aval = zeroany();
            dt = percent ? ANY_INT : initblstats[fld].anytype;
            let numtext = inp.slice(numstart);
            s_to_anything(aval, numtext, dt);

            if (percent) {
                val = aval.a_int;
                if (initblstats[fld].idxmax === -1) {
                    await pline(`Field '${initblstats[fld].fldname}' does not`
                                + ' support percentage values.');
                    behavior = BL_TH_VAL_ABSOLUTE;
                    state = 'choose_value';
                    continue;
                }
                /* if the player only typed a number, lt_gt_eq isn't set up yet
                   and the >-1 / <101 exceptions can't be honored */
                if ((val < 0 && (val !== -1 || lt_gt_eq !== GT_VALUE))
                    || (val === 0 && lt_gt_eq === LT_VALUE)
                    || (val === 100 && lt_gt_eq === GT_VALUE)
                    || (val > 100 && (val !== 101 || lt_gt_eq !== LT_VALUE))) {
                    await pline(`'${op}${val}%' is not a valid percent value.`);
                    state = 'choose_value';
                    continue;
                }
                /* restore suffix for use in color and attribute prompts */
                if (!numtext.includes('%')) numtext += '%';
            } else if (dt === ANY_INT
                       && (aval.a_int < ((fld === BL_AC) ? -128
                                         : (lt_gt_eq === GT_VALUE) ? -1
                                           : (lt_gt_eq === LT_VALUE) ? 1 : 0))) {
                await pline(`${threshold_value}'${op}${aval.a_int}'${is_out_of_range}`);
                state = 'choose_value';
                continue;
            } else if (dt === ANY_LONG
                       && (aval.a_long < ((lt_gt_eq === GT_VALUE) ? -1
                                          : (lt_gt_eq === LT_VALUE) ? 1 : 0))) {
                await pline(`${threshold_value}'${op}${aval.a_long}'${is_out_of_range}`);
                state = 'choose_value';
                continue;
            }

            if (lt_gt_eq === NO_LTEQGT) {
                const ltok = (dt === ANY_INT) ? (aval.a_int > 0 || fld === BL_AC)
                                              : (aval.a_long > 0);
                const gtok = (!percent || aval.a_long < 100);

                lt_gt_eq = await status_hilite_menu_choose_updownboth(fld, inbuf,
                                                                     ltok, gtok);
                if (lt_gt_eq === NO_LTEQGT) { state = 'choose_value'; continue; }
            }

            const pre = (lt_gt_eq === LT_VALUE) ? 'less than '
                        : (lt_gt_eq === GT_VALUE) ? 'more than ' : '';
            const post = (lt_gt_eq === LE_VALUE) ? ' or less'
                         : (lt_gt_eq === GE_VALUE) ? ' or more' : '';
            colorqry = `Choose a color for when ${initblstats[fld].fldname}`
                     + ` is ${pre}${numtext}${post}:`;
            attrqry = `Choose attribute for when ${initblstats[fld].fldname}`
                    + ` is ${pre}${numtext}${post}:`;

            hilite.rel = lt_gt_eq;
            hilite.value = aval;
        } else if (behavior === BL_TH_UPDOWN) {
            if (initblstats[fld].anytype !== ANY_STR) {
                const ltok = (fld !== BL_TIME), gtok = true;

                lt_gt_eq = await status_hilite_menu_choose_updownboth(fld, null,
                                                                     ltok, gtok);
                if (lt_gt_eq === NO_LTEQGT) { state = 'choose_behavior'; continue; }
            } else { /* ANY_STR */
                /* LT/GT is pointless for the string fields (title, dungeon
                   level, alignment), so skip the one-choice menu entirely */
                lt_gt_eq = EQ_VALUE;
            }
            const word = (lt_gt_eq === EQ_VALUE) ? 'changes'
                         : (lt_gt_eq === LT_VALUE) ? 'decreases' : 'increases';
            colorqry = `Choose a color for when ${initblstats[fld].fldname} ${word}:`;
            attrqry = `Choose attribute for when ${initblstats[fld].fldname} ${word}:`;
            hilite.rel = lt_gt_eq;
        } else if (behavior === BL_TH_CONDITION) {
            cond = await query_conditions();
            if (!cond) {
                if (origfld === BL_FLUSH) { state = 'choose_field'; continue; }
                return false;
            }
            colorqry = `Choose a color for conditions ${conditionbitmask2str(cond)}:`;
            attrqry = `Choose attribute for conditions ${conditionbitmask2str(cond)}:`;
        } else if (behavior === BL_TH_TEXTMATCH) {
            const qry_buf = `${(fld === BL_CAP || fld === BL_ALIGN
                                || fld === BL_HUNGER || fld === BL_TITLE)
                               ? 'Choose' : 'Enter'}`
                          + ` ${initblstats[fld].fldname} text value to match:`;
            if (fld === BL_CAP) {
                const rv = await query_arrayvalue(qry_buf, enc_stat,
                                                  SLT_ENCUMBER, OVERLOADED + 1);
                if (rv < SLT_ENCUMBER) { state = 'choose_behavior'; continue; }
                hilite.rel = TXT_VALUE;
                hilite.textmatch = enc_stat[rv];
            } else if (fld === BL_ALIGN) {
                const aligntxt = ['chaotic', 'neutral', 'lawful'];
                const rv = await query_arrayvalue(qry_buf, aligntxt, 0, 2 + 1);
                if (rv < 0) { state = 'choose_behavior'; continue; }
                hilite.rel = TXT_VALUE;
                hilite.textmatch = aligntxt[rv];
            } else if (fld === BL_HUNGER) {
                const hutxt = ['Satiated', null, 'Hungry', 'Weak',
                               'Fainting', 'Fainted', 'Starved'];
                const rv = await query_arrayvalue(qry_buf, hutxt, SATIATED, STARVED + 1);
                if (rv < SATIATED) { state = 'choose_behavior'; continue; }
                hilite.rel = TXT_VALUE;
                hilite.textmatch = hutxt[rv];
            } else if (fld === BL_TITLE) {
                const rolelist = [];
                const urole = game.urole || roles[0];
                for (let i = 0; i < 9; i++) {
                    const mbuf = `"${urole.rank?.[i]?.m}"`;
                    let fbuf = '', obuf = '';
                    if (urole.rank?.[i]?.f) {
                        fbuf = `"${urole.rank[i].f}"`;
                        obuf = `${game.flags?.female ? fbuf : mbuf} or `
                             + `${game.flags?.female ? mbuf : fbuf}`;
                    }
                    if (game.flags?.female) {
                        if (fbuf) rolelist.push(fbuf);
                        rolelist.push(mbuf);
                        if (obuf) rolelist.push(obuf);
                    } else {
                        rolelist.push(mbuf);
                        if (fbuf) rolelist.push(fbuf);
                        if (obuf) rolelist.push(obuf);
                    }
                }
                rolelist.push('"none of the above (polymorphed)"');

                const rv = await query_arrayvalue(qry_buf, rolelist, 0, rolelist.length);
                if (rv >= 0) {
                    hilite.rel = TXT_VALUE;
                    hilite.textmatch = rolelist[rv];
                }
                if (rv < 0) { state = 'choose_behavior'; continue; }
            } else {
                let inbuf = await getlin(qry_buf);
                inbuf = (inbuf == null) ? '\x1b' : inbuf;
                if (inbuf === '' || inbuf[0] === '\x1b') { state = 'choose_behavior'; continue; }

                hilite.rel = TXT_VALUE;
                if (inbuf.length < MAXVALWIDTH) hilite.textmatch = inbuf;
                else return false;
            }
            colorqry = `Choose a color for when ${initblstats[fld].fldname}`
                     + ` is '${hilite.textmatch}':`;
            attrqry = `Choose attribute for when ${initblstats[fld].fldname}`
                    + ` is '${hilite.textmatch}':`;
        } else if (behavior === BL_TH_ALWAYS_HILITE) {
            colorqry = `Choose a color to always hilite ${initblstats[fld].fldname}:`;
            attrqry = `Choose attribute to always hilite ${initblstats[fld].fldname}:`;
        }
        state = 'choose_color';
        continue;
    }

    if (state === 'choose_color') {
        clr = await query_color(colorqry, NO_COLOR);
        if (clr === -1) {
            state = (behavior !== BL_TH_ALWAYS_HILITE) ? 'choose_value'
                                                       : 'choose_behavior';
            continue;
        }
        atr = await query_attr(attrqry, ATR_NONE);
        if (atr === -1) { state = 'choose_color'; continue; }

        if (behavior === BL_TH_CONDITION) {
            if (atr & HL_BOLD) gc.cond_hilites[HL_ATTCLR_BOLD] |= cond;
            if (atr & HL_DIM) gc.cond_hilites[HL_ATTCLR_DIM] |= cond;
            if (atr & HL_ITALIC) gc.cond_hilites[HL_ATTCLR_ITALIC] |= cond;
            if (atr & HL_ULINE) gc.cond_hilites[HL_ATTCLR_ULINE] |= cond;
            if (atr & HL_BLINK) gc.cond_hilites[HL_ATTCLR_BLINK] |= cond;
            if (atr & HL_INVERSE) gc.cond_hilites[HL_ATTCLR_INVERSE] |= cond;
            if (atr === HL_NONE) {
                gc.cond_hilites[HL_ATTCLR_BOLD] &= ~cond;
                gc.cond_hilites[HL_ATTCLR_DIM] &= ~cond;
                gc.cond_hilites[HL_ATTCLR_ITALIC] &= ~cond;
                gc.cond_hilites[HL_ATTCLR_ULINE] &= ~cond;
                gc.cond_hilites[HL_ATTCLR_BLINK] &= ~cond;
                gc.cond_hilites[HL_ATTCLR_INVERSE] &= ~cond;
            }
            gc.cond_hilites[clr] |= cond;
            let clrbuf = strNsubst(clr2colorname(clr), ' ', '-', 0);
            const tmpattr = hlattr2attrname(atr, '', BUFSZ);
            if (tmpattr) clrbuf += `&${tmpattr}`;
            await pline(`Added hilite condition/${conditionbitmask2str(cond)}/${clrbuf}`);
        } else {
            hilite.coloridx = clr | (atr << 8);
            hilite.anytype = initblstats[fld].anytype;

            let p;
            if (fld === BL_TITLE && (p = strstri(hilite.textmatch, ' or ')) !== null
                && p !== undefined && hilite.textmatch.includes(' or ')) {
                /* split "male-rank or female-rank" into two identical rules */
                const at = hilite.textmatch.indexOf(' or ');
                const female = hilite.textmatch.slice(at + ' or '.length);
                hilite.textmatch = hilite.textmatch.slice(0, at);
                status_hilite_add_threshold(fld, hilite);
                await pline(`Added hilite ${status_hilite2str(hilite)}`);
                /* transfer female-rank to the start of hilite.textmatch */
                hilite.textmatch = female;
                /* proceed with normal addition of new rule */
            }
            status_hilite_add_threshold(fld, hilite);
            await pline(`Added hilite ${status_hilite2str(hilite)}`);
        }
        reset_status_hilites();
        return true;
    }
    }
}

/* C ref: botl.c:4357 — one field's rules: list, remove, add. */
export async function status_hilite_menu_fld(fld) {
    let i;
    let count = status_hilite_linestr_countfield(fld);
    let hlstr;
    let buf;
    let acted;
    const clr = NO_COLOR;

    if (!count) {
        if (await status_hilite_menu_add(fld)) {
            status_hilite_linestr_done();
            status_hilite_linestr_gather();
            count = status_hilite_linestr_countfield(fld);
        } else {
            return false;
        }
    }

    const tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);

    if (count) {
        hlstr = status_hilite_str;
        while (hlstr) {
            if (hlstr.fld === fld) {
                const any = zeroany();
                any.a_int = hlstr.id;
                any.a_void = hlstr.id;
                add_menu(tmpwin, nul_glyphinfo, any, 0, 0, ATR_NONE,
                         clr, hlstr.str, MENU_ITEMFLAGS_NONE);
            }
            hlstr = hlstr.next;
        }
    } else {
        buf = `No current hilites for ${initblstats[fld].fldname}`;
        add_menu_str(tmpwin, buf);
    }

    /* separator line */
    add_menu_str(tmpwin, '');

    if (count) {
        const any = zeroany();
        any.a_int = -1;
        any.a_void = -1;
        add_menu(tmpwin, nul_glyphinfo, any, 'X', 0, ATR_NONE, clr,
                 'Remove selected hilites', MENU_ITEMFLAGS_NONE);
    }

    /* without SCORE_ON_BOTL, 'score' can be listed and deleted but not added;
       we're only called for it when the config file already defined rules */
    if (SCORE_ON_BOTL || fld !== BL_SCORE) {
        const any = zeroany();
        any.a_int = -2;
        any.a_void = -2;
        add_menu(tmpwin, nul_glyphinfo, any, 'Z', 0, ATR_NONE,
                 clr, 'Add new hilites', MENU_ITEMFLAGS_NONE);
    }

    buf = `Current ${initblstats[fld].fldname} hilites:`;
    end_menu(tmpwin, buf);

    acted = false;
    const picks = [];
    const res = await select_menu(tmpwin, PICK_ANY, picks);
    if (res > 0) {
        let idx;
        let mode = 0;

        for (i = 0; i < res; i++) {
            idx = picks[i].item.a_int;
            if (idx === -1) mode |= 1;      /* delete selected hilites */
            else if (idx === -2) mode |= 2; /* create new hilites */
        }
        if (mode & 1) {
            for (i = 0; i < res; i++) {
                idx = picks[i].item.a_int;
                if (idx > 0 && status_hilite_remove(idx)) acted = true;
            }
        }
        if (mode & 2) {
            while (await status_hilite_menu_add(fld)) acted = true;
        }
    }
    destroy_nhwindow(tmpwin);
    return acted;
}

/* C ref: botl.c:4456 — dump every rule in config-file form. */
export function status_hilites_viewall() {
    let hlstr = status_hilite_str;

    const datawin = create_nhwindow(NHW_TEXT);

    while (hlstr) {
        const lim = BUFSZ - 'OPTIONS=hilite_status: '.length - 1;
        putstr(datawin, 0, `OPTIONS=hilite_status: ${String(hlstr.str).slice(0, lim)}`);
        hlstr = hlstr.next;
    }

    display_nhwindow(datawin, false);
    destroy_nhwindow(datawin);
}

/* C ref: botl.c:4498 — the top-level 'O' -> statushilites menu. */
export async function status_hilite_menu() {
    let i, fld, res;
    let redo;
    let countall;
    const clr = NO_COLOR;

    do { /* C ref: shlmenu_redo: */
        redo = false;

        const tmpwin = create_nhwindow(NHW_MENU);
        start_menu(tmpwin, MENU_BEHAVE_STANDARD);

        status_hilite_linestr_gather();
        countall = status_hilite_linestr_countfield(BL_FLUSH);
        if (countall) {
            const any = zeroany();
            any.a_int = -1;
            any.a_void = -1;
            add_menu(tmpwin, nul_glyphinfo, any, 0, 0, ATR_NONE,
                     clr, 'View all hilites in config format',
                     MENU_ITEMFLAGS_NONE);
            add_menu_str(tmpwin, '');
        }

        for (i = 0; i < MAXBLSTATS; i++) {
            let count;
            let buf;

            fld = initblstats[i].fld;
            count = status_hilite_linestr_countfield(fld);
            /* the config file may define 'score' rules even without
               SCORE_ON_BOTL; if so show them (deletions only) */
            if (!SCORE_ON_BOTL && fld === BL_SCORE && !count) continue;

            const any = zeroany();
            any.a_int = fld + 1;
            any.a_void = fld + 1;
            buf = padr(initblstats[i].fldname, 18);
            if (count) buf += ` (${count} defined)`;
            add_menu(tmpwin, nul_glyphinfo, any, 0, 0, ATR_NONE,
                     clr, buf, MENU_ITEMFLAGS_NONE);
        }

        end_menu(tmpwin, 'Status hilites:');
        const picks = [];
        if ((res = await select_menu(tmpwin, PICK_ONE, picks)) > 0) {
            fld = picks[0].item.a_int - 1;
            if (fld < 0) {
                status_hilites_viewall();
            } else {
                if (await status_hilite_menu_fld(fld)) reset_status_hilites();
            }
            redo = true;
        }

        destroy_nhwindow(tmpwin);
        countall = status_hilite_linestr_countfield(BL_FLUSH);
        status_hilite_linestr_done();

        /* the fuzzer is unlikely to pick anything useful in nested menus, so
           limit it to one try */
        if (redo && game.iflags?.debug_fuzzer) redo = false;
    } while (redo);

    /* hilite_delta == 'statushilites' does double duty: the number of turns a
       temporary highlight stays visible, and (non-zero) the enable flag */
    if (countall > 0 && !game.iflags?.hilite_delta) {
        game.iflags = game.iflags || {};
        game.iflags.hilite_delta = 3;
    }

    return true;
}

/*botl.js*/
