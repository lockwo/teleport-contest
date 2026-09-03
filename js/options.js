// options.js — Parse .nethackrc options.
// C ref: options.c — handles OPTIONS=, BIND=, etc.

import { game } from './gstate.js';
import { nhgetch } from './input.js';
import { NO_COLOR } from './terminal.js';
import { ere_compile } from './pickup.js';
import { EXTCMD_TABLE } from './cmd_data.js';
// role.c str2role()/str2race()/str2gend()/str2align() and the races/genders/
// aligns tables: optfn_role() &c validate their value with these, and
// setrolefilter() builds gr.rfilter out of the same masks.
import { str2role, str2race, str2gend, str2align,
         races, genders, aligns } from './role.js';
import { ROLE_NONE, ROLE_RANDOM } from './const.js';
// For fruitadd() only (the appended "not yet reached" section at the bottom of
// this file).  All three modules are already evaluated before this one's body
// runs -- pickup.js above imports makesingular, objects and makemon.js -- so
// these edges add no module and change no evaluation order.
import { makesingular } from './objnam.js';
import { objects } from './mkobj.js';
import { name_to_pmidx } from './makemon.js';
// pline()/impossible() for the same section: C's interactive option handlers
// report through them.  display.js is likewise already evaluated (pickup.js).
import { pline, impossible } from './display.js';
import { makeplural } from './invent.js';
// fruitadd()'s 127-fruit overflow fallback is `return rnd(127)`.
import { rnd } from './rng.js';

// ---------------------------------------------------------------------------
// option_help() — the "List of game options." help topic ('?g').
//
// C ref: options.c option_help() builds a full-screen NHW_TEXT window listing
// the intro blurb, every Boolean option name (comma-wrapped by next_opt()), the
// Compound options with their descriptions ("%-20s - %s"), the "Other settings"
// names, and a trailing epilog, then pages it with "--More--".  The data below
// is the (already build/interface-filtered, non-wizard) allopt[] table this tty
// build presents: the survivors of option_help()'s BoolOpt / CompOpt / OthrOpt
// loops with their setwhere and is_wc/wc2 filters applied.  It's static (no
// seed/game state), so it reproduces C's window for every session identically.

// get_configfile(): the run-time configuration file path substituted into the
// intro line.  It comes from the RECORDING ENVIRONMENT rather than from the
// game.  docs/recording-environment.md (upstream, 2026-08-18) documents that
// environment and rules that "Hard-coding them is fine": the harness set HOME
// to its own results directory and wrote each session's nethackrc to
// $HOME/.nethackrc before every launch, so NetHack reports this same path for
// EVERY session — held-out included.  tty_putstr()'s line-break-on-overflow
// (ported below as wput()) splits on the string's exact length, so it has to
// be verbatim.
const OPT_CONFIGFILE =
    '/Users/davidbau/git/mazesofmenace/teleport/maud/test/comparison/c-harness/results/.nethackrc';

// Boolean option names, in allopt[] order (option_help() BoolOpt loop output).
const OPT_BOOL = [
    'accessiblemsg', 'acoustics', 'altmeta', 'armorstatus', 'autodescribe',
    'autodig', 'autoopen', 'autopickup', 'autoquiver', 'bgcolors', 'blind',
    'bones', 'checkpoint', 'cmdassist', 'color', 'confirm', 'customcolors',
    'customsymbols', 'dark_room', 'deaf', 'dropped_nopick', 'eight_bit_tty',
    'extmenu', 'female', 'fireassist', 'fixinv', 'force_invmenu', 'goldX',
    'help', 'herecmd_menu', 'hilite_pet', 'hilite_pile', 'hitpointbar',
    'idlecheckpoint', 'ignintr', 'implicit_uncursed', 'legacy', 'lit_corridor',
    'lootabc', 'mail', 'mention_decor', 'mention_map', 'mention_walls',
    'menu_overlay', 'menucolors', 'mon_movement', 'news', 'nudist', 'null',
    'pauper', 'pickup_stolen', 'pickup_thrown', 'price_quotes', 'pushweapon',
    'query_menu', 'quick_farsight', 'reroll', 'rest_on_space', 'safe_pet',
    'safe_wait', 'selectsaved', 'showdamage', 'showexp', 'showrace', 'showvers',
    'silent', 'sortpack', 'sounds', 'sparkle', 'spot_monsters', 'standout',
    'status_updates', 'terrainstatus', 'time', 'tips', 'tombstone', 'toptenwin',
    'travel', 'tutorial', 'use_darkgray', 'use_inverse', 'use_truecolor',
    'verbose', 'voices', 'weaponstatus', 'whatis_menu', 'whatis_moveskip',
];

// Compound option [name, description] pairs, in allopt[] order (option_help()
// CompOpt loop; descriptions are allopt[].descr).
const OPT_COMPOUND = [
    ['windowtype', 'windowing system to use (should be specified first)'],
    ['playmode', 'normal play, non-scoring explore mode, or debug mode'],
    ['name', "your character's name (e.g., name:Merlin-W)"],
    ['role', 'your starting role (e.g., Barbarian, Valkyrie)'],
    ['race', 'your starting race (e.g., Human, Elf)'],
    ['gender', 'your starting gender (male or female)'],
    ['alignment', 'your starting alignment (lawful, neutral, or chaotic)'],
    ['altkeyhandling', '(not applicable)'],
    ['autounlock', 'action to take when encountering locked door or chest'],
    ['boulder', 'deprecated (use S_boulder in sym file instead)'],
    ['catname', 'name of your starting pet if it is a kitten'],
    ['crash_email', 'email address for reporting'],
    ['crash_name', 'your name for reporting'],
    ['crash_urlmax', 'length of longest url we can generate'],
    ['DECgraphics', 'load DECGraphics display symbols into symset'],
    ['disclose', 'the kinds of information to disclose at end of game'],
    ['dogname', 'name of your starting pet if it is a little dog'],
    ['dungeon', 'list of symbols to use in drawing the dungeon map'],
    ['effects', 'list of symbols to use in drawing special effects'],
    ['fruit', 'name of a fruit you enjoy eating'],
    ['glyph', 'set representation of a glyph to a unicode value and color'],
    ['hilite_status', 'a status highlighting rule (can occur multiple times)'],
    ['horsename', 'name of your starting pet if it is a pony'],
    ['IBMgraphics', 'load IBMGraphics display symbols into symset'],
    ['menu_deselect_all', 'deselect all items in a menu'],
    ['menu_deselect_page', 'deselect all items on this page of a menu'],
    ['menu_first_page', 'jump to the first page in a menu'],
    ['menu_headings', 'display style for menu headings'],
    ['menu_invert_all', 'invert all items in a menu'],
    ['menu_invert_page', 'invert all items on this page of a menu'],
    ['menu_last_page', 'jump to the last page in a menu'],
    ['menu_next_page', 'go to the next menu page'],
    ['menu_objsyms', 'show object symbols in menus'],
    ['menu_previous_page', 'go to the previous menu page'],
    ['menu_search', 'search for a menu item'],
    ['menu_select_all', 'select all items in a menu'],
    ['menu_select_page', 'select all items on this page of a menu'],
    ['menu_shift_left', 'pan current menu page left'],
    ['menu_shift_right', 'pan current menu page right'],
    ['menuinvertmode', 'experimental behavior of menu inverts'],
    ['menustyle', 'user interface for object selection'],
    ['monsters', 'list of symbols to use for monsters'],
    ['msg_window', 'control of "view previous message(s)" (^P) behavior'],
    ['msghistory', 'number of top line messages to save'],
    ['number_pad', 'use the number pad for movement'],
    ['objects', 'list of symbols to use for objects'],
    ['packorder', 'the inventory order of the items in your pack'],
    ['paranoid_confirmation', 'extra prompting in certain situations'],
    ['petattr', 'attributes for highlighting pets'],
    ['pettype', 'your preferred initial pet type'],
    ['pickup_burden', 'maximum burden picked up before prompt'],
    ['pickup_types', 'types of objects to pick up automatically'],
    ['pile_limit', 'threshold for "there are many objects here"'],
    ['roguesymset', 'load a set of rogue display symbols from symbols file'],
    ['runmode', "display frequency when `running' or `travelling'"],
    ['scores', 'the parts of the score list you wish to see'],
    ['sortdiscoveries', 'preferred order when displaying discovered objects'],
    ['sortloot', 'sort object selection lists by description'],
    ['sortvanquished', 'preferred order when displaying vanquished monsters'],
    ['soundlib', 'soundlib interface to use (if any)'],
    ['statushilites', '0=no status highlighting, N=show highlights for N turns'],
    ['statuslines', '2 or 3 lines for status display'],
    ['suppress_alert', 'suppress alerts about version-specific features'],
    ['symset', 'load a set of display symbols from symbols file'],
    ['traps', 'list of symbols to use in drawing traps'],
    ['versinfo', "extra information for 'showvers'"],
    ['warnings', 'display characters for warnings'],
    ['whatis_coord', 'show coordinates when auto-describing cursor position'],
    ['whatis_filter', 'filter coordinate locations when targeting next or previous'],
    ['cond_', 'prefix for cond_ options'],
    ['font', 'prefix for font options'],
];

// "Other settings" names, in allopt[] order (option_help() OthrOpt loop).
const OPT_OTHER = [
    'autocompletions', 'autopickup exceptions', 'bind keys', 'menu colors',
    'message types', 'status condition fields', 'status highlight rules',
];

// opt_epilog[] (options.c).
const OPT_EPILOG = [
    '',
    'Some of the options can only be set before the game is started;',
    "those items will not be selectable in the 'O' command's menu.",
    "Some options are stored in a game's save file, and will keep saved",
    'values when restoring that game even if you have updated your config-',
    'uration file to change them.  Such changes will matter for new games.',
    'The "other settings" can be set with \'O\', but when set within the',
    'configuration file they use their own directives rather than OPTIONS.',
    'See NetHack\'s "Guidebook" for details.',
];

const OPT_CO = 80; // CO / COLNO (terminal columns)

// C ref: win/tty/wintty.c compress_str() — when a text/menu-window line is at
// least CO chars long (or has a newline), collapse each run of spaces to one
// (and drop leading/trailing space) so the wrap below doesn't split it.
function compress_str(str) {
    if (str.length < OPT_CO && str.indexOf('\n') < 0) return str;
    let out = '';
    let was = true; // discards leading spaces
    for (let k = 0; k < str.length; k++) {
        let c = str[k];
        if (c === '\n') c = ' ';
        if (was && c === ' ') continue;
        out += c;
        was = (c === ' ');
    }
    if (was && out.length > 0) out = out.slice(0, -1);
    return out;
}

// C ref: win/tty/wintty.c tty_putstr() NHW_TEXT branch — add one putstr()'d
// line to a text window: compress_str() it, then if it's still longer than CO
// break it at the last space at/under column CO-1 and recurse on the tail.
function wput(lines, str) {
    str = compress_str(str);
    for (;;) {
        if (str.length + 1 > OPT_CO) {
            let i = OPT_CO - 1;
            while (i > 0 && str[i] !== ' ' && str[i] !== '\n') i--;
            if (i > 0) {
                lines.push(str.slice(0, i + 1));
                str = str.slice(i + 1);
                continue;
            }
        }
        lines.push(str);
        break;
    }
}

// C ref: options.c option_help() — produce the ordered list of putstr() lines
// (already tty_putstr-wrapped) that the "List of game options." text window
// shows.  Returned to pager.js, which pages it through display_text_window().
export function option_help_lines() {
    const L = [];
    // opt_intro[] with opt_intro[CONFIG_SLOT] = "Set options as ... in <cfg>".
    wput(L, '');
    wput(L, '                 NetHack Options Help:');
    wput(L, '');
    wput(L, 'Set options as OPTIONS=<options> in');
    wput(L, OPT_CONFIGFILE);
    wput(L, 'or use `NETHACKOPTIONS="<options>"\' in your environment');
    wput(L, '(<options> is a list of options separated by commas)');
    wput(L, 'or press "O" while playing and use the menu.');
    wput(L, '');
    wput(L, 'Boolean options (which can be negated by prefixing them with \'!\' or "no"):');

    // Boolean options via next_opt(): accumulate "opt, opt, " and flush a line
    // whenever adding the next name would exceed COLNO-2; final next_opt("")
    // turns the trailing ", " into "." and emits a blank line.
    let buf = '';
    for (const nm of OPT_BOOL) {
        if (buf.length + nm.length + 2 > OPT_CO - 2) { wput(L, buf); buf = ''; }
        buf += nm + ', ';
    }
    if (buf.length >= 2 && buf.slice(-2) === ', ') buf = buf.slice(0, -2) + '.';
    wput(L, buf);
    wput(L, '');

    // Compound options: "%-20s - %s%c" with ',' between and '.' after the last.
    wput(L, 'Compound options:');
    for (let i = 0; i < OPT_COMPOUND.length; i++) {
        const [nm, descr] = OPT_COMPOUND[i];
        let buf2 = '`' + nm + "'";
        if (buf2.length < 20) buf2 = buf2 + ' '.repeat(20 - buf2.length);
        wput(L, `${buf2} - ${descr}${i + 1 < OPT_COMPOUND.length ? ',' : '.'}`);
    }
    wput(L, '');

    // Other settings: " <name>" per line.
    wput(L, 'Other settings:');
    for (const nm of OPT_OTHER) wput(L, ' ' + nm);
    wput(L, '');

    for (const e of OPT_EPILOG) wput(L, e);
    return L;
}

// ---------------------------------------------------------------------------
// hacklib.c / options.c string primitives that the config parsers below need.

// C ref: hacklib.c highc().
function highc(c) {
    return (c >= 'a' && c <= 'z') ? String.fromCharCode(c.charCodeAt(0) - 32) : c;
}

// C ref: <ctype.h> via hack.h digit()/letter() — ASCII-only, like the C build.
function digit(c) { return c >= '0' && c <= '9'; }
function letter(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }

// C ref: hacklib.c trimspaces() — strips leading AND trailing whitespace.
function trimspaces(s) {
    let a = 0, b = s.length;
    while (a < b && isspace(s[a])) a++;
    while (b > a && isspace(s[b - 1])) b--;
    return s.slice(a, b);
}

// C ref: hacklib.c visctrl() — how a key is spelled inside an error message.
function visctrl(c) {
    const code = typeof c === 'number' ? c : c.charCodeAt(0);
    if (code < 32) return '^' + String.fromCharCode(code + 64);
    if (code === 127) return '^?';
    if (code >= 128) {
        const inner = code - 128;
        if (inner < 32) return 'M-^' + String.fromCharCode(inner + 64);
        if (inner === 127) return 'M-^?';
        return 'M-' + String.fromCharCode(inner);
    }
    return String.fromCharCode(code);
}

// C ref: hacklib.c fuzzymatch() — equality after dropping every character of
// 'ignore_chars' from BOTH strings.  This is what lets "light blue",
// "lightblue" and "l i-gh_t---b l u e" all name CLR_BRIGHT_BLUE.
function fuzzymatch(s1, s2, ignore_chars, caseblind) {
    let i = 0, j = 0;
    for (;;) {
        let c1 = '\0', c2 = '\0';
        while (i < s1.length) { const c = s1[i++]; if (!ignore_chars.includes(c)) { c1 = c; break; } }
        while (j < s2.length) { const c = s2[j++]; if (!ignore_chars.includes(c)) { c2 = c; break; } }
        if (c1 === '\0' || c2 === '\0') return c1 === '\0' && c2 === '\0';
        if (caseblind) { c1 = lowc(c1); c2 = lowc(c2); }
        if (c1 !== c2) return false;
    }
}

// C ref: options.c escapes() — expand `\M`/meta, `^X`, decimal, `\o` octal,
// `\x` hex and the C-style `\n`/`\t`/`\b`/`\r`/`\\` forms in place.  Load
// bearing for txt2key(), sym_val() and warning_opts().
const HEXDD = '0123456789aAbBcCdDeEfF';
function escapes(cp) {
    let out = '';
    let i = 0;
    while (i < cp.length) {
        const meta = (cp[i] === '\\' && (cp[i + 1] === 'm' || cp[i + 1] === 'M')
                      && i + 2 < cp.length);
        if (meta) i += 2;
        let cval = 0, dcount = 0;
        const c = cp[i];
        if ((c !== '\\' && c !== '^') || i + 1 >= cp.length) {
            cval = cp.charCodeAt(i); i++;
        } else if (c === '^') {
            i++;
            cval = cp.charCodeAt(i) & 0x1f;
            i++;
        } else if (digit(cp[i + 1])) {
            i++;
            do {
                cval = cval * 10 + (cp.charCodeAt(i) - 48);
                i++;
            } while (i < cp.length && digit(cp[i]) && ++dcount < 3);
        } else if ((cp[i + 1] === 'o' || cp[i + 1] === 'O') && i + 2 < cp.length
                   && '01234567'.includes(cp[i + 2])) {
            i += 2;
            do {
                cval = cval * 8 + (cp.charCodeAt(i) - 48);
                i++;
            } while (i < cp.length && '01234567'.includes(cp[i]) && ++dcount < 3);
        } else if ((cp[i + 1] === 'x' || cp[i + 1] === 'X') && i + 2 < cp.length
                   && HEXDD.indexOf(cp[i + 2]) >= 0) {
            i += 2;
            let dp = HEXDD.indexOf(cp[i]);
            do {
                cval = cval * 16 + ((dp / 2) | 0);
                i++;
                dp = i < cp.length ? HEXDD.indexOf(cp[i]) : -1;
            } while (dp >= 0 && ++dcount < 2);
        } else {
            i++;
            switch (cp[i]) {
            case '\\': cval = 92; break;
            case 'n': cval = 10; break;
            case 't': cval = 9; break;
            case 'b': cval = 8; break;
            case 'r': cval = 13; break;
            default: cval = cp.charCodeAt(i); break;
            }
            i++;
        }
        if (meta) cval |= 0x80;
        out += String.fromCharCode(cval & 0xff);
    }
    return out;
}

// C ref: options.c txt2key() — turn a BIND / menu-accelerator key spec into
// the raw key it names.  Returns '' for C's '\0' ("not a key").
const KEY_M = (c) => String.fromCharCode((c.charCodeAt(0) | 0x80) & 0xff);
const KEY_C = (c) => String.fromCharCode(c.charCodeAt(0) & 0x1f);

function txt2key(txtIn) {
    let txt = trimspaces(txtIn);
    if (!txt) return '';
    if (txt.length === 1) return txt;

    if (txt === '<enter>') return '\n';
    if (txt === '<space>') return ' ';
    if (txt === '<esc>') return '\x1b';

    /* things like \b and \7 and \mX */
    if (txt[0] === '\\') {
        const t = escapes(txt);
        return t.length ? t[0] : '';
    }

    let makemeta = false;
    if (highc(txt[0]) === 'M') {
        if (txt.length < 2) return txt[0];
        txt = txt.slice(1);
        if (txt[0] === '-' && txt.length > 1) txt = txt.slice(1);
        if (txt.length < 2) return KEY_M(txt[0]);
        makemeta = true;
    }
    if (txt[0] === '^' || highc(txt[0]) === 'C') {
        const uc = txt[0];
        if (txt.length < 2) return makemeta ? KEY_M(uc) : uc;
        txt = txt.slice(1);
        if (txt[0] === '-' && txt.length > 1) txt = txt.slice(1);
        /* ^? is rubout/delete even though it is not a control character */
        if (txt[0] === '?') return makemeta ? '\xff' : '\x7f';
        const cc = KEY_C(txt[0]);
        return makemeta ? KEY_M(cc) : cc;
    }
    if (makemeta && txt.length) return KEY_M(txt[0]);

    /* ascii codes: must be three-digit decimal */
    if (digit(txt[0])) {
        let key = 0;
        for (let i = 0; i < 3; i++) {
            if (i >= txt.length || !digit(txt[i])) return '';
            key = 10 * key + (txt.charCodeAt(i) - 48);
        }
        return String.fromCharCode(key & 0xff);
    }
    return '';
}

// C ref: options.c sym_val() — reduce a SYMBOLS= value string to the single
// display character it names.  Returns '' for C's 0 ("nothing named").
export function sym_val(strval) {
    let buf = '';
    if (!strval || strval.length < 2) {
        /* empty, or single character; a lone space or tab names nothing */
        if (strval && !isspace(strval[0])) buf = strval[0];
    } else if (strval[0] === "'") {
        if (strval[2] === "'" && strval.length === 3) {
            buf = strval[1];
        } else if (strval[1] === '\\' && strval.length >= 4 && strval[3] === "'"
                   && '\'"\\'.includes(strval[2]) && strval.length === 4) {
            buf = strval[2];
        } else {
            const tmp = strval.slice(1);
            const p = tmp.lastIndexOf("'");
            if (p >= 0) buf = escapes(tmp.slice(0, p));
        }
    } else {
        buf = escapes(strval);
    }
    return buf ? buf[0] : '';
}

// C ref: include/defsym.h under PCHAR_PARSE / MONSYMS_PARSE / OBJCLASS_PARSE
// plus the SYM_CONTROL head of symbols.c loadsyms[] — every name a SYMBOLS= or
// ROGUESYMBOLS= line may set.  A name that is NOT here is what makes
// parsesymbols() fail, and cnf_line_SYMBOLS() then reports
// "Error in SYMBOLS definition", which is a SCREEN.
const SYM_CONTROL = 1, SYM_PCHAR = 2, SYM_OC = 3, SYM_MON = 4, SYM_OTH = 5;
const LOADSYMS_CONTROL = ['start', 'begin', 'finish', 'handling', 'description',
                          'color', 'colour', 'restrictions'];
const LOADSYMS_PCHAR = `S_stone S_vwall S_hwall S_tlcorn S_trcorn S_blcorn
S_brcorn S_crwall S_tuwall S_tdwall S_tlwall S_trwall S_ndoor S_vodoor
S_hodoor S_vcdoor S_hcdoor S_bars S_tree S_room S_darkroom S_engroom S_corr
S_litcorr S_engrcorr S_upstair S_dnstair S_upladder S_dnladder S_brupstair
S_brdnstair S_brupladder S_brdnladder S_altar S_grave S_throne S_sink
S_fountain S_pool S_ice S_lava S_lavawall S_vodbridge S_hodbridge S_vcdbridge
S_hcdbridge S_air S_cloud S_water S_arrow_trap S_dart_trap
S_falling_rock_trap S_squeaky_board S_bear_trap S_land_mine
S_rolling_boulder_trap S_sleeping_gas_trap S_rust_trap S_fire_trap S_pit
S_spiked_pit S_hole S_trap_door S_teleportation_trap S_level_teleporter
S_magic_portal S_web S_statue_trap S_magic_trap S_anti_magic_trap
S_polymorph_trap S_vibrating_square S_trapped_door S_trapped_chest S_vbeam
S_hbeam S_lslant S_rslant S_digbeam S_flashbeam S_boomleft S_boomright S_ss1
S_ss2 S_ss3 S_ss4 S_poisoncloud S_goodpos S_sw_tl S_sw_tc S_sw_tr S_sw_ml
S_sw_mr S_sw_bl S_sw_bc S_sw_br S_expl_tl S_expl_tc S_expl_tr S_expl_ml
S_expl_mc S_expl_mr S_expl_bl S_expl_bc S_expl_br`.split(/\s+/);
const LOADSYMS_OC = `S_strange_obj S_weapon S_armor S_ring S_amulet S_tool
S_food S_potion S_scroll S_book S_wand S_coin S_gem S_rock S_ball S_chain
S_venom`.split(/\s+/);
const LOADSYMS_MON = `S_ANT S_BLOB S_COCKATRICE S_DOG S_EYE S_FELINE S_GREMLIN
S_HUMANOID S_IMP S_JELLY S_KOBOLD S_LEPRECHAUN S_MIMIC S_NYMPH S_ORC S_PIERCER
S_QUADRUPED S_RODENT S_SPIDER S_TRAPPER S_UNICORN S_VORTEX S_WORM S_XAN
S_LIGHT S_ZRUTY S_ANGEL S_BAT S_CENTAUR S_DRAGON S_ELEMENTAL S_FUNGUS S_GNOME
S_GIANT S_invisible S_JABBERWOCK S_KOP S_LICH S_MUMMY S_NAGA S_OGRE S_PUDDING
S_QUANTMECH S_RUSTMONST S_SNAKE S_TROLL S_UMBER S_VAMPIRE S_WRAITH S_XORN
S_YETI S_ZOMBIE S_HUMAN S_GHOST S_GOLEM S_DEMON S_EEL S_LIZARD S_WORM_TAIL
S_MIMIC_DEF`.split(/\s+/);

// C ref: symbols.c loadsyms[] tail — the SYM_OTH block (sym.h SYM_OFF_X).
const LOADSYMS_OTH = ['S_nothing', 'S_unexplored', 'S_boulder', 'S_invisible',
                      'S_pet_override', 'S_hero_override'];

/* loadsyms[] order: the SYM_CONTROL head, then PCHAR, OBJCLASS and MONSYM
   (symbols.c includes defsym.h in that order), then the SYM_OTH tail. */
const LOADSYMS = [
    ...LOADSYMS_CONTROL.map((name) => ({ range: SYM_CONTROL, name })),
    ...LOADSYMS_PCHAR.map((name) => ({ range: SYM_PCHAR, name })),
    ...LOADSYMS_OC.map((name) => ({ range: SYM_OC, name })),
    ...LOADSYMS_MON.map((name) => ({ range: SYM_MON, name })),
    ...LOADSYMS_OTH.map((name) => ({ range: SYM_OTH, name })),
];

// C ref: symbols.c match_sym() alternates[].
const SYM_ALTERNATES = [
    ['S_armour', 'S_armor'],
    ['S_explode1', 'S_expl_tl'], ['S_explode2', 'S_expl_tc'],
    ['S_explode3', 'S_expl_tr'], ['S_explode4', 'S_expl_ml'],
    ['S_explode5', 'S_expl_mc'], ['S_explode6', 'S_expl_mr'],
    ['S_explode7', 'S_expl_bl'], ['S_explode8', 'S_expl_bc'],
    ['S_explode9', 'S_expl_br'],
];

// C ref: symbols.c match_sym().  The caller has already mungspaces()'d buf, so
// at most one space can sit in front of the separator.  `len >= strlen(name)`
// combined with strncmpi over len characters is exact case-insensitive
// equality once C's NUL terminator is accounted for.
export function match_sym(buf) {
    if ((buf[0] === 'G' || buf[0] === 'g') && buf[1] === '_') return null;
    let p = buf.indexOf(':');
    const q = buf.indexOf('=');
    if (p < 0 || (q >= 0 && q < p)) p = q;
    let len = buf.length;
    if (p >= 0) {
        if (p > 0 && buf[p - 1] === ' ') p--;
        len = p;
    }
    const name = buf.slice(0, len);
    for (const sp of LOADSYMS)
        if (len >= sp.name.length && strcmpi_eq(name, sp.name)) return sp;
    for (const [altnm, nm] of SYM_ALTERNATES)
        if (len >= altnm.length && strcmpi_eq(name, altnm))
            return LOADSYMS.find((sp) => sp.name === nm) || null;
    return null;
}

// C ref: symbols.c parsesymbols() — "S_name:char[,S_name2:char2,...]", split
// right-to-left on the first UNQUOTED comma (so `S_boulder:','` works), each
// element validated with match_sym().  Returns FALSE the moment one element
// names nothing, which is what produces the SYMBOLS/ROGUESYMBOLS error line.
function parsesymbols(opts, which_set, result, ref) {
    let firstComma = -1, firstColon = -1;
    for (let k = 1; k + 1 < opts.length; k++) {
        const ch = opts[k], prech = opts[k - 1], postch = opts[k + 1];
        if (ch === ',') {
            if (prech === "'" && postch === "'") continue;
            if (prech === '\\') continue;
        }
        if (ch === ':') {
            if (prech === "'" && postch === "'") continue;
        }
        if (ch === ',' && firstComma < 0) firstComma = k;
        if (ch === ':' && firstColon < 0) firstColon = k;
    }
    if (firstComma >= 0) {
        /* C: `*first_unquoted_comma++ = '\0'` truncates the CALLER's buffer
           before recursing, which is what a later element's failure reports. */
        opts = (() => { const head = opts.slice(0, firstComma),
                              tail = opts.slice(firstComma + 1);
                        if (ref) ref.buf = head;
                        if (!parsesymbols(tail, which_set, result, null)) return null;
                        return head; })();
        if (opts === null) return false;
        if (firstColon > firstComma) firstColon = -1;
    }

    let sep = firstColon;
    if (sep < 0) sep = opts.indexOf('=');
    if (sep < 0) return false;
    /* C: `*strval++ = '\0'` — from here on the caller's buffer ends at the
       separator, so its error message names only the symbol. */
    if (ref) ref.buf = opts.slice(0, sep);
    const symname = mungspaces(opts.slice(0, sep));
    const strval = mungspaces(opts.slice(sep + 1));

    const symp = match_sym(symname);
    /* a G_ name is handled by match_glyph(); our renderer has no custom glyph
       map, so treat it as accepted-and-ignored rather than an error */
    const is_glyph = !symp && (symname[0] === 'G' || symname[0] === 'g')
                     && symname[1] === '_';
    if (!symp && !is_glyph) return false;
    if (symp && symp.range && symp.range !== SYM_CONTROL) {
        const val = sym_val(strval);
        /* ROGUESET targets the rogue-level symbol table, which the renderer
           does not model; PRIMARYSET is the one display.js reads. */
        if (val && which_set !== ROGUESET) result.symoverride[symp.name] = val;
    }
    return true;
}
const PRIMARYSET = 0, ROGUESET = 1;

// ---------------------------------------------------------------------------
// AUTOPICKUP_EXCEPTION= and the config-error machinery.
//
// C ref: cfgfiles.c config_error_init()/config_error_nextline()/config_erradd()
// /config_error_done().  Every message goes through pline(), which this early
// (iflags.window_inited still FALSE) is raw_print() — so the "errors" are
// SCREEN CONTENT written by the recorder's raw shadow-buffer writer, and the
// dismissal is a getret() that eats input.  Both are modelled here.

const BUFSZ = 256;     /* global.h */
const PL_NSIZ = 32;    /* global.h — name of player */
const PL_PSIZ = 63;    /* global.h — name of pet */
const WARNCOUNT = 6;   /* sym.h — number of warning levels */

// The frame is per-parse rather than a stack: parseNethackrc reads one file.
let config_error_data = null;

// The ordered stream of everything the raw writer emitted while the file was
// read, so the boundaries fall where C's do: a string is one raw_print() line,
// WAIT_SYNCH is one wait_synch() -> getret().  get_uchars() calls both in the
// MIDDLE of the file, so the pauses cannot be inferred from the text.
let raw_stream = null;
const WAIT_SYNCH = Object.freeze({ wait_synch: true });

function raw_print(str) {
    if (raw_stream) raw_stream.push(str);
}

// C ref: hack.h wait_synch() -> wintty.c getret(): the reader below eats input
// until Return, and each eaten key is one captured input boundary.
function wait_synch() {
    if (raw_stream) raw_stream.push(WAIT_SYNCH);
}

function config_error_init(sourcename) {
    config_error_data = {
        line_num: 0, num_errors: 0, origline_shown: false,
        source: sourcename || '', origline: '',
    };
}

// Called for EVERY physical line, comments and blanks included — which is why
// "Line 5" can name a line parse_config_line() never sees.
function config_error_nextline(line) {
    const ced = config_error_data;
    if (!ced) return;
    ced.line_num++;
    ced.origline_shown = false;
    ced.origline = line || '';
}

// C ref: cfgfiles.c config_erradd().  The period is added to the MESSAGE, not
// to buf[], and only when buf doesn't already end in one of ".!?".
function config_error_add(buf) {
    const ced = config_error_data;
    if (!buf) buf = 'Unknown error';
    const punct = '.!?'.includes(buf[buf.length - 1]) ? '' : '.';
    if (!ced) return;
    ced.num_errors++;
    if (!ced.origline_shown) {
        raw_print('\n' + ced.origline);
        ced.origline_shown = true;
    }
    const lineno = ced.line_num > 0 ? `Line ${ced.line_num}: ` : '';
    raw_print(` * ${lineno}${buf}${punct}`);
}

// C ref: cfgfiles.c config_error_done() — the trailing count line, then
// wait_synch().  `configfile` here is the RESOLVED $HOME/.nethackrc, the same
// string option_help() prints; docs/recording-environment.md fixes $HOME for
// every recording and rules that hard-coding what NetHack printed from it is
// fine, so OPT_CONFIGFILE is the value C reported.
function config_error_done() {
    const ced = config_error_data;
    config_error_data = null;
    if (!ced || !ced.num_errors) return 0;
    const n = ced.num_errors;
    raw_print(`\n${n} error${n === 1 ? '' : 's'} `
              + `${ced.source === 'command line' ? 'on' : 'in'} `
              + `${ced.source || OPT_CONFIGFILE}.\n`);
    wait_synch();
    return n;
}

// C ref: cfgfiles.c get_uchars() — read a list of decimal numbers into a uchar
// array.  Only digits and blanks are legal, so the comma that looks natural in
// a config file ("WARNINGS=0,1,2") is a syntax error — and the complaint is a
// raw_printf() + wait_synch() DURING the read, not a config_error_add(), so it
// neither shows the offending line nor counts toward config_error_done()'s
// total.  With modlist set a zero leaves the list entry alone.
function get_uchars(bufp, list, modlist, size, name) {
    let num = 0, count = 0, havenum = false, i = 0;

    for (;;) {
        const c = i < bufp.length ? bufp[i] : '\0';
        switch (c) {
        case ' ': case '\0': case '\t': case '\n':
            if (havenum) {
                if (num || !modlist) list[count] = num & 0xff;
                count++;
                num = 0;
                havenum = false;
            }
            if (count === size || c === '\0') return count;
            i++;
            break;
        case '0': case '1': case '2': case '3': case '4':
        case '5': case '6': case '7': case '8': case '9':
            havenum = true;
            num = num * 10 + (c.charCodeAt(0) - 0x30);
            i++;
            break;
        default:
            raw_print(`Syntax error in ${name}`);
            wait_synch();
            return count;
        }
    }
}

// C ref: options.c assign_warnings() — a zero entry leaves gw.warnsyms alone.
function assign_warnings(graph_chars, result) {
    for (let i = 0; i < WARNCOUNT; i++)
        if (graph_chars[i]) result.warnsyms[i] = String.fromCharCode(graph_chars[i]);
}

// C ref: options.c add_autopickup_exception() — one sscanf per accepted form.
// This mimics `sscanf(mapping, "\"<%253[^\"]\" %c", text, &end)`: the literal
// quote, an optional grab/nograb marker, a non-empty run of up to 253
// non-quote characters, the closing quote, then (after optional whitespace)
// one trailing character.  Returns the number of fields assigned, so a
// half-matched pattern reports 0 and the caller falls through, exactly as C's
// short-circuited || chain does.
function sscanf_ape(mapping, lead) {
    let i = 0;
    if (mapping[i] !== '"') return { n: 0 };
    i++;
    if (lead) {
        if (mapping[i] !== lead) return { n: 0 };
        i++;
    }
    const start = i;
    while (i < mapping.length && mapping[i] !== '"' && i - start < 253) i++;
    if (i === start) return { n: 0 };           /* scanset matched nothing */
    const text = mapping.slice(start, i);
    if (mapping[i] !== '"') return { n: 0 };    /* literal '"' unmatched */
    i++;
    while (i < mapping.length && isspace(mapping[i])) i++;
    if (i >= mapping.length) return { n: 1, text };
    return { n: 2, text, end: mapping[i] };
}

// C ref: options.c add_autopickup_exception().  ape->pattern is a POSIX
// EXTENDED regex (sys/share/posixregex.c regex_compile passes REG_EXTENDED)
// matched unanchored against the object description, NOT a glob.
function add_autopickup_exception(mapping, result) {
    const APE_regex_error = 'regex error in AUTOPICKUP_EXCEPTION';
    const APE_syntax_error = 'syntax error in AUTOPICKUP_EXCEPTION';
    let grab = false;

    let r = sscanf_ape(mapping, '<');
    if (r.n === 1 || (r.n === 2 && r.end === '#')) {
        grab = true;
    } else {
        r = sscanf_ape(mapping, '>');
        /* C's `||` chain reassigns n (and end) from the bare-quote sscanf
           whenever the '>' one didn't return exactly 1, so `">pat" #` is
           accepted by the third form with '>' left INSIDE the pattern. */
        if (r.n !== 1) r = sscanf_ape(mapping, '');
        if (!(r.n === 1 || (r.n === 2 && r.end === '#'))) {
            config_error_add(APE_syntax_error);
            return 0;
        }
        grab = false;
    }

    /* C ref: options.c add_autopickup_exception() — regex_compile() failing
       reports regerror()'s text, not V8's.  ere_compile() classifies the
       pattern the way Darwin's regcomp(REG_EXTENDED) does and hands back a
       JS-safe source for the ones it accepts (ERE-literal ')' and '{', POSIX
       character classes). */
    const ere = ere_compile(r.text);
    if (ere.error) {
        config_error_add(`${APE_regex_error}: ${ere.error}`);
        return 0;
    }
    let re;
    try {
        re = new RegExp(ere.jsSource);
    } catch (e) {
        config_error_add(`${APE_regex_error}: ${e.message}`);
        return 0;
    }
    /* ape->next = ga.apelist: newest first, which is the order
       check_autopickup_exceptions() walks */
    result.apelist.unshift({ pattern: r.text, grab, regex: re });
    return 1;
}

// C ref: win/tty/termcap.c nomux_enter_raw_mode()/nomux_raw_putch() driving
// wintty.c getret() via wait_synch().  Two recorder facts make this load
// bearing far past the error screen itself:
//   - nomux_raw_active is never cleared, so from the first pre-window-init
//     raw_print onward the CAPTURED cursor is this writer's row/col, whatever
//     the game later draws.  jsmain's capture hook and js/save.js read
//     game._nomux_raw for that.
//   - xputs() (getret()'s "Hit return to continue: ") was never hooked by the
//     capture patch, so it is absent from the recorded screen and must not be
//     drawn here.
export async function config_error_report(result) {
    const raw = result?.config_error_raw;
    if (!raw || !raw.length) return;
    const disp = game.nhDisplay;
    const rows = disp?.rows ?? 24, cols = disp?.cols ?? 80;
    /* nomux_enter_raw_mode() clears the shadow buffer ONCE, on the first
       raw_print: exit_nhwindows/settty switch off the alt screen, so the
       visible terminal is blank first.  Its row/col then only ever advance,
       which is why a later wait_synch() finds the earlier text still there. */
    if (disp?.clearScreen) disp.clearScreen();
    let row = 0, col = 0;
    const putch = (ch) => {
        if (ch === '\n') { row++; col = 0; return; }
        if (ch.charCodeAt(0) < 32) return;
        if (row >= 0 && row < rows && col >= 0 && col < cols)
            disp?.putstr?.(col, row, ch, NO_COLOR, 0);
        col++;
    };
    for (const item of raw) {
        if (typeof item === 'string') {
            for (const ch of item) putch(ch);
            putch('\n'); /* puts() / tty_raw_print_bold both append one */
            game._nomux_raw = { row, col };
            if (disp?.setCursor) disp.setCursor(col, row);
            continue;
        }
        /* getline.c xwaitforspace(): iflags.cbreak is still FALSE this early
           (setftty() runs from tty_init_nhwindows), so the entire cbreak
           branch is skipped — neither space nor ESC dismisses this, ONLY '\n'
           or '\r'.  Every key before that is one captured input boundary with
           an unchanged screen. */
        for (;;) {
            const c = await nhgetch();
            if (c === 10 || c === 13) break;
        }
    }
}

// ---------------------------------------------------------------------------
// BINDINGS= / AUTOCOMPLETE= / the menu_* accelerator options.

// C ref: include/wintype.h MENU_* — the internal menu command characters.
const MENU_FIRST_PAGE = '^', MENU_LAST_PAGE = '|', MENU_NEXT_PAGE = '>',
      MENU_PREVIOUS_PAGE = '<', MENU_SHIFT_RIGHT = '}', MENU_SHIFT_LEFT = '{',
      MENU_SELECT_ALL = '.', MENU_UNSELECT_ALL = '-', MENU_INVERT_ALL = '@',
      MENU_SELECT_PAGE = ',', MENU_UNSELECT_PAGE = '\\', MENU_INVERT_PAGE = '~',
      MENU_SEARCH = ':';

// C ref: options.c default_menu_cmd_info[].
const DEFAULT_MENU_CMD_INFO = [
    ['menu_next_page', MENU_NEXT_PAGE],
    ['menu_previous_page', MENU_PREVIOUS_PAGE],
    ['menu_first_page', MENU_FIRST_PAGE],
    ['menu_last_page', MENU_LAST_PAGE],
    ['menu_select_all', MENU_SELECT_ALL],
    ['menu_invert_all', MENU_INVERT_ALL],
    ['menu_deselect_all', MENU_UNSELECT_ALL],
    ['menu_select_page', MENU_SELECT_PAGE],
    ['menu_invert_page', MENU_INVERT_PAGE],
    ['menu_deselect_page', MENU_UNSELECT_PAGE],
    ['menu_search', MENU_SEARCH],
    ['menu_shift_right', MENU_SHIFT_RIGHT],
    ['menu_shift_left', MENU_SHIFT_LEFT],
];

// C ref: cmd.c spkeys_binds[] — the "getdir.self", "getpos.pick", "count" ...
// pseudo-commands a BIND= line may name instead of an extended command.  They
// rebind an internal prompt key rather than a command, so bind_specialkey()
// accepts them and parsebindings() must not report them as unknown.
const SPKEYS_BINDS = `getdir.self getdir.self2 getdir.help getdir.mouse count
getpos.self getpos.pick getpos.pick.quick getpos.pick.once getpos.pick.verbose
getpos.valid getpos.autodescribe getpos.mon.next getpos.mon.prev
getpos.obj.next getpos.obj.prev getpos.door.next getpos.door.prev
getpos.unexplored.next getpos.unexplored.prev getpos.valid.next
getpos.valid.prev getpos.all.next getpos.all.prev getpos.help getpos.filter
getpos.moveskip getpos.menu`.split(/\s+/);

// C ref: options.c illegal_menu_cmd_key().
function illegal_menu_cmd_key(c) {
    if (c === '' || c === '\r' || c === '\n' || c === '\x1b' || c === ' '
        || digit(c) || (letter(c) && c !== '@')) {
        config_error_add(`Reserved menu command key '${visctrl(c || 0)}'`);
        return true;
    }
    /* reject default object class symbols (drawing.c def_oc_syms[1..]) */
    for (let j = 1; j < DEF_OC_SYMS.length; j++) {
        if (c === DEF_OC_SYMS[j]) {
            config_error_add(`Menu command key '${visctrl(c)}' is an object class`);
            return true;
        }
    }
    return false;
}

// C ref: options.c add_menu_cmd_alias() — gm.mapped_menu_cmds/op.
const MAX_MENU_MAPPED_CMDS = 32;
function add_menu_cmd_alias(from_ch, to_ch, result) {
    if (result.menu_cmd_alias.length >= MAX_MENU_MAPPED_CMDS) return;
    result.menu_cmd_alias.push([from_ch, to_ch]);
}

// C ref: options.c check_misc_menu_command() — is `opts` one of the
// menu_<something> accelerator option names?  Matched at the name's FULL
// length, so "menu_sea" does not reach menu_search here.
function check_misc_menu_command(opts) {
    for (let i = 0; i < DEFAULT_MENU_CMD_INFO.length; i++) {
        const nm = DEFAULT_MENU_CMD_INFO[i][0];
        if (match_optname(opts, nm, nm.length, true)) return i;
    }
    return -1;
}

// C ref: options.c spcfn_misc_menu_cmd().
function spcfn_misc_menu_cmd(midx, negated, opts, result) {
    if (negated) {
        bad_negation(DEFAULT_MENU_CMD_INFO[midx][0], false);
        return OPTN_ERR;
    }
    const op = string_for_opt(opts, false);
    if (op !== '') {
        const c = txt2key(op);
        if (illegal_menu_cmd_key(c)) return OPTN_ERR;
        add_menu_cmd_alias(c, DEFAULT_MENU_CMD_INFO[midx][1], result);
    }
    return OPTN_OK;
}

// C ref: cmd.c bind_key() — resolve a BIND= command name to an extended
// command.  "nothing" unbinds; an INTERNALCMD entry is skipped, so naming one
// is the same as naming nothing at all.  Returns false when no command matches,
// which is what makes parsebindings() report "Unknown key binding command".
function bind_key(key, command, result) {
    if (strcmpi_eq(command, 'nothing')) {
        delete result.keybind[key];
        result.keyunbind.push(key);
        return true;
    }
    let buf = command, param = null;
    const lp = buf.indexOf('('), rp = buf.lastIndexOf(')');
    if (lp >= 0 && rp > lp) {
        param = buf.slice(lp + 1, rp);
        buf = buf.slice(0, lp);
    }
    for (const e of EXTCMD_TABLE) {
        if (!strcmpi_eq(buf, e.txt)) continue;
        if (String(e.flags).includes('INTERNALCMD')) continue;
        result.keybind[key] = e.txt;
        if (String(e.flags).includes('CMD_PARAM')) {
            if (param === null) config_error_add(`'${buf}' requires a parameter`);
            else if (!param.length) config_error_add('Required parameter cannot be empty');
            else result.keybind_param[key] = param.slice(0, 30);
        } else if (param !== null && param.length > 0) {
            config_error_add(`'${buf}' does not take a parameter`);
        }
        return true;
    }
    return false;
}

// C ref: cmd.c bind_specialkey().
function bind_specialkey(key, command, result) {
    for (const nm of SPKEYS_BINDS) {
        if (nm !== command) continue;
        result.spkeys[nm] = key;
        return true;
    }
    return false;
}

// C ref: cmd.c bind_mousebtn() — the tty build has no mouse, but naming
// "mouse1"/"mouse2" still has to be ACCEPTED (or rejected) the way C does.
const MOUSEBTN_NAMES = ['mouse1', 'mouse2'];
function bind_mousebtn(btn, command, result) {
    if (strcmpi_eq(command, 'nothing')) { delete result.mousebtn[btn]; return true; }
    for (const e of EXTCMD_TABLE) {
        if (!strcmpi_eq(command, e.txt)) continue;
        if (!String(e.flags).includes('MOUSECMD')) continue;
        result.mousebtn[btn] = e.txt;
        return true;
    }
    return false;
}

// C ref: options.c parsebindings() — "key:command[,key2:command2,...]", split
// RIGHT TO LEFT so the leftmost binding is applied last, with the escaped
// forms "\,:cmd" and "',':cmd" recognised so a comma can itself be bound.
function parsebindings(bindings, result) {
    let ret = true;

    let bind = bindings.indexOf(',');
    if (bind >= 0) {
        if (bind === 0) bind = bindings.indexOf(',', 1);
        else if (bindings[bind - 1] === '\\'
                 || (bindings[bind - 1] === "'" && bindings[bind + 1] === "'"))
            bind = bindings.indexOf(',', bind + 2);
    }
    if (bind >= 0) {
        if (!parsebindings(bindings.slice(bind + 1), result)) ret = false;
        bindings = bindings.slice(0, bind);
    }

    const colon = bindings.indexOf(':');
    if (colon < 0) return false;   /* it's not a binding */
    const keytxt = bindings.slice(0, colon);
    const cmd = trimspaces(bindings.slice(colon + 1));

    for (let i = 0; i < MOUSEBTN_NAMES.length; i++) {
        if (keytxt === MOUSEBTN_NAMES[i]) {
            if (!bind_mousebtn(i + 1, cmd, result))
                config_error_add(`Error binding mouse button ${i + 1}`);
            else
                return ret;
        }
    }

    const key = txt2key(keytxt);
    if (!key) {
        config_error_add(`Unknown key binding key '${keytxt}'`);
        return false;
    }
    if (bind_specialkey(key, cmd, result)) return ret;

    for (let i = 0; i < DEFAULT_MENU_CMD_INFO.length; i++) {
        if (DEFAULT_MENU_CMD_INFO[i][0] === cmd) {
            if (illegal_menu_cmd_key(key)) {
                config_error_add(`Bad menu key ${visctrl(key)}:${cmd}`);
                return false;
            }
            add_menu_cmd_alias(key, DEFAULT_MENU_CMD_INFO[i][1], result);
            return ret;
        }
    }

    if (!bind_key(key, cmd, result)) {
        config_error_add(`Unknown key binding command '${cmd}'`);
        return false;
    }
    return ret;
}

// C ref: cmd.c parseautocomplete() — right-to-left over a comma OR colon
// separated list.  A name that is not an extended command is reported with
// raw_printf() + wait_synch(), NOT config_error_add(): it prints immediately
// and blocks for Return without counting toward config_error_done()'s total.
function parseautocomplete(autocomplete, condition, result) {
    let cut = autocomplete.indexOf(',');
    if (cut < 0) cut = autocomplete.indexOf(':');
    if (cut >= 0) {
        parseautocomplete(autocomplete.slice(cut + 1), condition, result);
        autocomplete = autocomplete.slice(0, cut);
    }
    autocomplete = trimspaces(autocomplete);
    if (!autocomplete) return;

    /* unlike most options a leading "no" might be part of the command name,
       so only '!' negates */
    if (autocomplete[0] === '!') {
        autocomplete = trimspaces(autocomplete.slice(1));
        condition = !condition;
    }
    for (const e of EXTCMD_TABLE) {
        if (autocomplete === e.txt) {
            result.autocomplete[e.txt] = condition;
            return;
        }
    }
    raw_print(`Bad autocomplete: invalid extended command '${autocomplete}'.`);
    wait_synch();
}

// ---------------------------------------------------------------------------
// C ref: include/optlist.h allopt[] — every NHOPTB/NHOPTC/NHOPTP/NHOPTO entry
// in table order, with this build's #ifdefs resolved (recorder CFLAGS are
// `-DNOTPARMDECL -DNO_TIMED_DELAY`, hints file macosx-minimal).  Table order is
// load-bearing twice over: parseoptions() stops at the FIRST match, so
// `font_map` is found before the trailing `font` prefix entry, and
// determine_ambiguities() needs every name present or the minmatch lengths all
// come out too short.  Columns are `name|alias|type|flags`:
//   type   B = BoolOpt, C = CompOpt, O = OthrOpt
//   flags  n = negateok, v = valok, d = dupeok, p = pfx (an NHOPTP prefix
//          option, matched with str_start_is() instead of by minmatch),
//          0 = allopt[].addr is NULL in this build so optfn_boolean() takes its
//          "silent retreat" and sets nothing, w = setwhere is set_wiznofuz,
//          which optfn_boolean() rejects when go.opt_initial (i.e. from a
//          config file).
const ALLOPT_DATA = `windowtype||C|v
playmode||C|v
name||C|v
role|character|C|nvd
race||C|nvd
gender||C|nvd
alignment|align|C|nvd
accessiblemsg||B|n
acoustics||B|n
align_message||C|nv
align_status||C|v
altkeyhandling|altkeyhandler|C|v
altmeta||B|n
armorstatus||B|n
ascii_map||B|n
autocompletions||O|v
autodescribe||B|n
autodig||B|n
autoopen||B|n
autopickup||B|n
autopickup exceptions||O|v
autoquiver||B|n
autounlock||C|nv
bgcolors||B|n
bind keys||O|v
BIOS||B|0
blind|permablind|B|n
bones||B|n
boulder||C|v
catname||C|v
checkpoint||B|n
cmdassist||B|n
color|colour|B|n
confirm||B|n
crash_email||C|v
crash_name||C|v
crash_urlmax||C|v
customcolors|customcolours|B|n
customsymbols|customsymbols|B|n
dark_room||B|n
deaf|permadeaf|B|n
DECgraphics||C|nv
debug_hunger||B|nw
debug_mongen||B|nw
debug_overwrite_stairs||B|nw
disclose||C|nv
dogname||C|v
dropped_nopick||B|n
dungeon||C|v
effects||C|v
eight_bit_tty||B|n
extmenu||B|n
female|male|B|n
fireassist||B|n
fixinv||B|n
font_map||C|nvd
font_menu||C|nvd
font_message||C|nvd
font_size_map||C|nvd
font_size_menu||C|nvd
font_size_message||C|nvd
font_size_status||C|nvd
font_size_text||C|nvd
font_status||C|nvd
font_text||C|nvd
force_invmenu||B|n
fruit||C|v
fullscreen||B|n
glyph||C|vd
goldX||B|n
guicolor||B|n
help||B|n
herecmd_menu||B|n
hilite_pet||B|n
hilite_pile||B|n
hilite_status||C|nvd
hitpointbar||B|n
horsename||C|v
IBMgraphics||C|nv
idlecheckpoint||B|n
ignintr||B|n
implicit_uncursed||B|n
legacy||B|n
lit_corridor||B|n
lootabc||B|n
mail||B|n
map_mode||C|nv
mention_decor||B|n
mention_map||B|n
mention_walls||B|n
menu_deselect_all||C|v
menu_deselect_page||C|v
menu_first_page||C|v
menu_headings||C|nv
menu_invert_all||C|v
menu_invert_page||C|v
menu_last_page||C|v
menu_next_page||C|v
menu_objsyms|use_menu_glyphs|C|nv
menu_overlay||B|n
menu_previous_page||C|v
menu_search||C|v
menu_select_all||C|v
menu_select_page||C|v
menu_shift_left||C|v
menu_shift_right||C|v
menu_tab_sep||B|n
menucolors||B|nv
menu colors||O|v
menuinvertmode||C|v
menustyle||C|nv
message types||O|v
mon_movement||B|n
monpolycontrol||B|n
montelecontrol||B|n
monsters||C|v
mouse_support||C|v
msg_window||C|nv
msghistory||C|nv
news||B|n
nudist||B|n
null||B|n
number_pad||C|v
objects||C|v
packorder||C|v
paranoid_confirmation|prayconfirm|C|nvd
pauper||B|n
perm_invent||B|n
perminv_mode||C|nv
petattr||C|v
pettype|pet|C|nv
pickup_burden||C|v
pickup_stolen||B|n
pickup_thrown||B|n
pickup_types||C|v
pile_limit||C|nv
player_selection||C|v
popup_dialog||B|n
preload_tiles||B|n
price_quotes||B|n
pushweapon||B|n
query_menu||B|n
quick_farsight||B|n
rawio||B|0
reroll||B|n
rest_on_space||B|n
roguesymset||C|v
runmode||C|nv
safe_pet||B|n
safe_wait||B|n
sanity_check||B|n
scores||C|v
scroll_amount||C|nv
scroll_margin||C|nv
selectsaved||B|n
showdamage||B|n
showexp||B|n
showrace||B|n
showscore||B|n0
showvers||B|n
silent||B|n
softkeyboard||B|n
sortdiscoveries||C|nv
sortloot||C|v
sortpack||B|n
sortvanquished||C|nv
soundlib||C|v
sounds||B|n
sparkle||B|n
spot_monsters||B|n
splash_screen||B|n
standout||B|n
status_updates||B|n
status condition fields||O|v
statushilites||C|nvd
status highlight rules||O|v
statuslines||C|v
suppress_alert||C|vd
symset||C|v
term_cols|termcolumns|C|v
term_rows||C|v
terrainstatus||B|n
tile_file||C|v
tile_height||C|nv
tile_width||C|nv
tiled_map||B|n
time||B|n
timed_delay||B|0
tips||B|n
tombstone||B|n
toptenwin||B|n
traps||C|v
travel||B|n
travel_debug||B|n
tutorial||B|n
use_darkgray||B|n
use_inverse||B|n
use_truecolor|use_truecolour|B|n
vary_msgcount||C|v
verbose||B|n
versinfo||C|v
voices||B|n
vt_tiledata||B|n0
vt_sounddata||B|n0
warnings||C|v
weaponstatus||B|n
whatis_coord||C|nv
whatis_filter||C|nv
whatis_menu||B|n
whatis_moveskip||B|n
windowborders||C|nv
windowcolors||C|vd
wizmgender||B|n
wizweight||B|n
wraptext||B|n
cond_||C|ndp
font||C|nvdp`;

const ALLOPT = ALLOPT_DATA.split('\n').map((line) => {
    const [name, alias, typ, f] = line.split('|');
    return {
        name, alias: alias || null, typ,
        negateok: f.includes('n'), valok: f.includes('v'),
        dupeok: f.includes('d'), pfx: f.includes('p'),
        noaddr: f.includes('0'), wiznofuz: f.includes('w'),
        minmatch: 0,
    };
});

// C ref: hacklib.c lowc() — ASCII-only, so JS toLowerCase() (which also folds
// e.g. U+0130) is not a substitute.
function lowc(c) {
    return (c >= 'A' && c <= 'Z') ? String.fromCharCode(c.charCodeAt(0) + 32) : c;
}

function isspace(c) {
    return c === ' ' || c === '\t' || c === '\n' || c === '\v' || c === '\f' || c === '\r';
}

// strncmpi(a, b, n) == 0.  Both operands are NUL-terminated in C, so a run that
// reaches the end of one string but not the other is a mismatch.
function strncmpi_eq(a, b, n) {
    for (let i = 0; i < n; i++) {
        const ea = i >= a.length, eb = i >= b.length;
        if (ea || eb) return ea && eb;
        if (lowc(a[i]) !== lowc(b[i])) return false;
    }
    return true;
}

function strcmpi_eq(a, b) {
    return a.length === b.length && strncmpi_eq(a, b, a.length);
}

// C ref: options.c length_without_val() — the length of the option name part,
// i.e. up to the first ':' or '=' (whichever comes first) with any whitespace
// in front of it backed over.
function length_without_val(user_string, len) {
    let p = user_string.indexOf(':');
    const q = user_string.indexOf('=');
    if (p < 0 || (q >= 0 && q < p)) p = q;
    if (p >= 0) {
        while (p > 0 && isspace(user_string[p - 1])) p--;
        return p;
    }
    return len;
}

// C ref: options.c match_optname() — the user's text, minus any ":value", must
// be a case-insensitive leading substring of the option name and at least
// min_length characters long.
function match_optname(user_string, optn_name, min_length, val_allowed) {
    let len = user_string.length;
    if (val_allowed) len = length_without_val(user_string, len);
    return len >= min_length && strncmpi_eq(optn_name, user_string, len);
}

// C ref: hacklib.c str_start_is().
function str_start_is(str, chkstr, caseblind) {
    for (let i = 0; ; i++) {
        if (i >= str.length) return i >= chkstr.length;
        if (i >= chkstr.length) return true;
        const t1 = caseblind ? lowc(str[i]) : str[i];
        const t2 = caseblind ? lowc(chkstr[i]) : chkstr[i];
        if (t1 !== t2) return false;
    }
}

// C ref: options.c determine_ambiguities() — for each option, the length of its
// longest shared leading prefix with any other option name, plus one; floored
// at 3 and capped at the name's own length.  Run once at startup in C
// (initoptions_init), once at module load here.
function determine_ambiguities() {
    const needed = ALLOPT.map(() => 0);
    for (let i = 0; i < ALLOPT.length; i++) {
        for (let j = 0; j < ALLOPT.length; j++) {
            if (j === i) continue;
            const p1 = ALLOPT[i].name, p2 = ALLOPT[j].name;
            let tmpneeded = 1, k = 0;
            while (k < p1.length && k < p2.length && lowc(p1[k]) === lowc(p2[k])) {
                tmpneeded++; k++;
            }
            if (tmpneeded > needed[i]) needed[i] = tmpneeded;
            if (tmpneeded > needed[j]) needed[j] = tmpneeded;
        }
    }
    for (let i = 0; i < ALLOPT.length; i++) {
        const len = ALLOPT[i].name.length;
        ALLOPT[i].minmatch = (needed[i] < 3) ? 3 : (needed[i] <= len) ? needed[i] : len;
    }
}
determine_ambiguities();

// C ref: options.c string_for_opt() — everything past the first ':' or '='.
// Leading spaces are NOT stripped; each optfn decides what to do with them.
// When val_optional is FALSE a missing value is an ERROR — that message is a
// screen, so the flag has to be threaded per option exactly as C does.
function string_for_opt(opts, val_optional) {
    let colon = opts.indexOf(':');
    const equals = opts.indexOf('=');
    if (colon < 0 || (equals >= 0 && equals < colon)) colon = equals;
    if (colon < 0 || colon + 1 >= opts.length) {
        if (!val_optional) config_error_add(`Missing parameter for '${opts}'`);
        return '';
    }
    return opts.slice(colon + 1);
}

// C ref: options.c string_for_env_opt() — identical during config-file reading
// (go.opt_initial is TRUE); rejectoption() is only reachable from the 'O' menu.
function string_for_env_opt(optname, opts, val_optional) {
    return string_for_opt(opts, val_optional);
}

// C ref: options.c bad_negation().
function bad_negation(optname, with_parameter) {
    config_error_add(`The ${optname} option may not `
                     + `${with_parameter ? 'both have a value and ' : ''}be negated.`);
}

// C ref: options.c nmcpy() — copy up to maxlen-1 chars, stopping at a comma.
function nmcpy(src, maxlen) {
    const comma = src.indexOf(',');
    return (comma >= 0 ? src.slice(0, comma) : src).slice(0, maxlen - 1);
}

// The boolean option names our engine reads under a different field than the C
// option name.  Everything else lands on result.flags[<C option name>], which
// is the stable key the number_pad / status-line / autopickup lanes read.
function set_boolean(name, value, result) {
    switch (name) {
    case 'autopickup': result.flags.pickup = value; break;      // C: flags.pickup
    case 'fixinv': result.flags.invlet_constant = value; break; // C: flags.invlet_constant
    case 'cmdassist': result.iflags.cmdassist = value; break;
    case 'splash_screen': result.iflags.wc_splash_screen = value; break;
    case 'tutorial':
        result.flags.tutorial = value;
        // allmain.js gates the "Do you want a tutorial?" prompt on this, which
        // is C's opt_set_in_config[opt_tutorial] — set for either polarity.
        result.tutorial_set = true;
        break;
    default: result.flags[name] = value; break;
    }
}

// C ref: options.c optfn_boolean().  The two config_error_add() calls here are
// SCREENS: a boolean with a value C cannot read as a truth value (or a negated
// boolean with any value at all) prints and then blocks for Return.
function optfn_boolean(o, negated, opts, op, result) {
    if (o.noaddr) return OPTN_OK;   /* silent retreat */
    if (o.wiznofuz) return OPTN_ERR; /* go.opt_initial && set_wiznofuz */

    let ln = 0;
    op = string_for_opt(opts, true);
    if (op !== '') {
        if (negated) {
            config_error_add(`Negated boolean '${o.name}' should not have a parameter`);
            return OPTN_SILENTERR;
        }
        ln = op.length;
        if (strncmpi_eq(op, 'true', ln) || strncmpi_eq(op, 'yes', ln)
            || strcmpi_eq(op, 'on')
            || (digit(op[0]) && parseInt(op, 10) === 1)) {
            negated = false;
        } else if (strncmpi_eq(op, 'false', ln) || strncmpi_eq(op, 'no', ln)
                   || strcmpi_eq(op, 'off')
                   || (digit(op[0]) && parseInt(op, 10) === 0)) {
            negated = true;
        } else if (!o.valok) {
            config_error_add(`'${opts}' is not valid for a boolean`);
            return OPTN_SILENTERR;
        }
    }

    // "Before the change": opt_female is reached under either its own name or
    // its "male" alias, and which one the user typed flips the sense.
    if (o.name === 'female') {
        const n = Math.max(ln, 3);
        if (strncmpi_eq(opts, 'female', n)) { result.gender = negated ? 'male' : 'female'; return OPTN_OK; }
        if (strncmpi_eq(opts, 'male', n)) { result.gender = negated ? 'female' : 'male'; return OPTN_OK; }
    }

    set_boolean(o.name, !negated, result);

    // "After the change".
    if (o.name === 'pauper') set_boolean('nudist', !negated, result);
    else if (o.name === 'ascii_map') result.iflags.wc_tiled_map = negated;
    else if (o.name === 'tiled_map') result.iflags.wc_ascii_map = negated;
    return OPTN_OK;
}

// ---------------------------------------------------------------------------
// options.c optfn_<name>() — the per-option compound handlers.
//
// Every one of these is reachable from a config file, and every
// config_error_add() below is a SCREEN plus a blocking Return, so the
// accept/reject decision and the exact message text both matter.  The value
// itself is still recorded verbatim under result.flags[<C option name>]: that
// is the storage contract js/pickup.js, js/invent.js, js/end.js and js/cmd.js
// were written against (each converts on read).
const OPTN_OK = 0, OPTN_ERR = 1, OPTN_SILENTERR = 2;

/* remember the value the way the rest of js/ expects to read it */
function keep(o, op, result) { result.flags[o.name] = op; }

// C ref: options.c optfn_align_message()/optfn_align_status() via
// ALIGN_LEFT/TOP/RIGHT/BOTTOM.
const ALIGN_NAMES = ['left', 'top', 'right', 'bottom'];
function optfn_align_misc(o, negated, opts, op, result) {
    op = string_for_opt(opts, negated);
    if (op !== '' && !negated) {
        for (const nm of ALIGN_NAMES)
            if (strncmpi_eq(op, nm, nm.length)) {
                result.iflags[`wc_${o.name}`] = nm;
                keep(o, op, result);
                return OPTN_OK;
            }
        config_error_add(`Unknown ${o.name} parameter '${op}'`);
        return OPTN_ERR;
    } else if (negated) {
        bad_negation(o.name, true);
        return OPTN_ERR;
    }
    return OPTN_OK;
}

// C ref: options.c optfn_autounlock() + unlocktypes[].  AUTOUNLOCK_* are
// lock.h bits; flags.autounlock is what cmd.js/extcmd-handlers.js test.
const AUTOUNLOCK_UNTRAP = 1, AUTOUNLOCK_APPLY_KEY = 2,
      AUTOUNLOCK_KICK = 4, AUTOUNLOCK_FORCE = 8;
const UNLOCKTYPES = ['untrap', 'apply-key', 'kick', 'force'];
function optfn_autounlock(o, negated, opts, op, result) {
    op = string_for_opt(opts, true);
    if (op === '') {
        result.flags.autounlock = negated ? 0 : AUTOUNLOCK_APPLY_KEY;
        return OPTN_OK;
    }
    let newflags = 0;
    const sep = op.includes('+') ? '+' : ' ';
    let rest = op;
    while (rest !== null) {
        let matched = false;
        let cur = trimspaces(rest);
        const nxt = cur.indexOf(sep);
        let after = null;
        if (nxt >= 0) { after = cur.slice(nxt + 1); cur = trimspaces(cur.slice(0, nxt)); }
        if (str_start_is('none', cur, true)) { negated = true; matched = true; }
        for (let i = 0; i < UNLOCKTYPES.length && !matched; i++) {
            if (str_start_is(UNLOCKTYPES[i], cur, true)
                || fuzzymatch(cur, UNLOCKTYPES[i], ' -_', true)) {
                matched = true;
                switch (cur[0]) {
                case 'u': newflags |= AUTOUNLOCK_UNTRAP; break;
                case 'a': newflags |= AUTOUNLOCK_APPLY_KEY; break;
                case 'k': newflags |= AUTOUNLOCK_KICK; break;
                case 'f': newflags |= AUTOUNLOCK_FORCE; break;
                default: matched = false; break;
                }
            }
        }
        if (!matched) {
            config_error_add(`Invalid value for "${o.name}": "${cur}"`);
            return OPTN_SILENTERR;
        }
        rest = after;
    }
    if (negated && newflags !== 0) {
        config_error_add(`Invalid value combination for "${o.name}": 'none' with some`);
        return OPTN_SILENTERR;
    }
    result.flags.autounlock = newflags;
    return OPTN_OK;
}

// C ref: drawing.c def_oc_syms[].sym, indexed by object class.  Needed by
// change_inv_order(), optfn_pickup_types() and illegal_menu_cmd_key().
const DEF_OC_SYMS = ['\0', ']', ')', '[', '=', '"', '(', '%', '!', '?', '+',
                     '/', '$', '*', '`', '0', '_', '.'];
const MAXOCLASSES = DEF_OC_SYMS.length;
function def_char_to_objclass(sym) {
    const i = DEF_OC_SYMS.indexOf(sym);
    return i > 0 ? i : MAXOCLASSES;
}

// C ref: drawing.c def_monsyms[].sym via def_char_to_monclass() — the monster
// class letters, used by optfn_boulder()'s clash test.
const DEF_MONSYMS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ@ '&;:~]";
const MAXMCLASSES = DEF_MONSYMS.length + 1;
function def_char_to_monclass(sym) {
    const i = DEF_MONSYMS.indexOf(sym);
    return i >= 0 ? i + 1 : MAXMCLASSES;
}

// C ref: options.c optfn_boulder() (BACKWARD_COMPAT is defined in optlist.h),
// the deprecated spelling of SYMBOLS=S_boulder:c.  A symbol that a monster or
// a warning level already owns is REJECTED with its own message.
function optfn_boulder(o, negated, opts, op, result) {
    op = string_for_opt(opts, false);
    if (op === '') return OPTN_ERR;
    op = escapes(op);
    let clash = 0;
    if (def_char_to_monclass(op[0]) !== MAXMCLASSES) clash = op[0] ? 1 : 0;
    else if (op[0] >= '1' && op[0] < String.fromCharCode(WARNCOUNT + 48)) clash = 2;
    if (op.charCodeAt(0) < 32) {
        config_error_add('boulder symbol cannot be a control character');
        return OPTN_OK;
    } else if (clash) {
        config_error_add(`Badoption - boulder symbol '${visctrl(op[0])}' would`
                         + ` conflict with a ${clash === 1 ? 'monster' : 'warning'} symbol`);
    } else {
        result.symoverride.S_boulder = op[0];
        keep(o, op, result);
    }
    return OPTN_OK;
}

// C ref: options.c petname_optfn() — shared by catname/dogname/horsename.
// "none" clears the name.  dog.c makedog() reads these before falling back to
// the per-role default dog names.
function petname_optfn(o, negated, opts, op, result) {
    if (op === '' && !negated) return OPTN_ERR;
    if (negated || op === 'none' || op === 'None') op = '';
    result.flags[o.name] = sanitize_name(nmcpy(op, PL_PSIZ));
    return OPTN_OK;
}

// C ref: files.c sanitize_name() — a name that reaches a file or the topline
// keeps only printable characters.
function sanitize_name(s) {
    let out = '';
    for (const c of s) {
        const k = c.charCodeAt(0);
        if (k >= 32 && k < 127) out += c;
    }
    return out;
}

// C ref: options.c optfn_crash_urlmax() (CRASHREPORT is on for this build).
function optfn_crash_urlmax(o, negated, opts, op, result) {
    op = string_for_opt(opts, false);
    if (op === '') return OPTN_ERR;
    const temp = parseInt(op, 10) || 0;
    if (temp < 75) {
        config_error_add(`Invalid value ${temp} for crash_urlmax.  Minimum value is 75.`);
        return OPTN_ERR;
    }
    keep(o, op, result);
    return OPTN_OK;
}

// C ref: dat/symbols "start:" names — the symbol sets read_sym_file() can find.
// "default" (and "Default symbols") is accepted and means "no symset".  Any
// other name fails to load, and optfn_symset() then reports it, which is a
// screen; that is why this list has to be the file's, not the renderer's.
const SYMSET_NAMES = ['plain', 'Blank', 'IBMgraphics', 'IBMGraphics_1',
                      'IBMGraphics_2', 'RogueIBM', 'RogueEpyx', 'RogueWindows',
                      'curses', 'DECgraphics', 'MACgraphics', 'Enhanced1',
                      'Enhanced2', 'AmigaFont'];

// C ref: files.c read_sym_file() — TRUE when the name names a symset in the
// symbols file, or is the "default" spelling that clears the entry.
function read_sym_file(name) {
    if (!name) return true;
    for (const nm of SYMSET_NAMES) if (strcmpi_eq(name, nm)) return true;
    return fuzzymatch(name, 'Default symbols', ' -_', true)
           || strcmpi_eq(name, 'default');
}

// C ref: options.c optfn_symset() / optfn_roguesymset().
function optfn_symset(o, negated, opts, op, result) {
    if (op === '') return OPTN_ERR;
    if (!read_sym_file(op)) {
        config_error_add(`Unable to load symbol set "${op}" from "symbols"`);
        return OPTN_ERR;
    }
    if (o.name === 'symset') result.symset = op;
    return OPTN_OK;
}

// C ref: options.c optfn_DECgraphics()/optfn_IBMgraphics() — deprecated
// spellings of symset:<name> that refuse to load over an existing symset.
function optfn_graphics_compat(o, negated, opts, result) {
    if (!negated) {
        let badflag = false;
        if (result.symset) badflag = true;
        else if (!read_sym_file(o.name)) badflag = true;
        else result.symset = o.name;
        if (badflag) {
            config_error_add(`Failure to load symbol set ${o.name}.`);
            return OPTN_ERR;
        }
    }
    return OPTN_OK;
}

// C ref: flag.h DISCLOSE_* and decl.c disclosure_options[].
const DISCLOSURE_OPTIONS = 'iavgco';
const DISCLOSE_VALID = 'yn?+-#';
function optfn_disclose(o, negated, opts, op, result) {
    op = string_for_opt(opts, true);
    if (op !== '' && negated) { bad_negation(o.name, true); return OPTN_ERR; }
    keep(o, negated && op === '' ? false : (op === '' ? true : op), result);
    if (op === '' || strcmpi_eq(op, 'all') || strcmpi_eq(op, 'none')) return OPTN_OK;
    let prefix_val = null;
    for (let i = 0; i < op.length; i++) {
        let c = lowc(op[i]);
        if (c === 'k') c = 'v';
        if (c === 'd') c = 'o';
        if (DISCLOSURE_OPTIONS.includes(c)) {
            prefix_val = null;
        } else if (DISCLOSE_VALID.includes(c)) {
            prefix_val = c;
        } else if (c === ' ') {
            /* do nothing */
        } else {
            config_error_add(`Unknown ${o.name} parameter '${op[i]}'`);
            return OPTN_ERR;
        }
    }
    return OPTN_OK;
}

// C ref: options.c optfn_fruit() — mungspaces()'d, and an empty value defaults
// to "slime mold".  During config reading the 100-fruit cap cannot be hit.
function optfn_fruit(o, negated, opts, op, result) {
    op = string_for_opt(opts, negated);
    if (negated) {
        if (op !== '') { bad_negation('fruit', true); return OPTN_ERR; }
        op = '';
    } else if (op === '') {
        return OPTN_ERR;
    }
    op = mungspaces(op);
    let fruit = sanitize_name(nmcpy(op, PL_FSIZ));
    if (!fruit) fruit = 'slime mold';
    result.flags.fruit = fruit;
    result.pl_fruit = fruit;
    return OPTN_OK;
}

// C ref: options.c optfn_menu_headings() -> coloratt.c color_attr_parse_str().
function optfn_menu_headings(o, negated, opts, op, result) {
    if (op === '') {
        result.iflags.menu_headings = { attr: negated ? ATR_NONE : ATR_INVERSE,
                                       color: NO_COLOR_IDX };
        keep(o, negated ? false : true, result);
        return OPTN_OK;
    } else if (negated) {
        bad_negation(o.name, true);
        return OPTN_SILENTERR;
    }
    const ca = color_attr_parse_str(op);
    if (!ca) return OPTN_ERR;
    result.iflags.menu_headings = ca;
    keep(o, op, result);
    return OPTN_OK;
}

// C ref: options.c optfn_menu_objsyms() + objsymvals[].
const OBJSYMVALS = ['none', 'headers', 'entries', 'both', 'conditional',
                    'one-or-other'];
function optfn_menu_objsyms(o, negated, opts, op, result) {
    let osyms;
    if (negated) {
        osyms = 0;
    } else if (op === '') {
        osyms = opts.startsWith('use_menu_glyphs') ? 2 : 1;
    } else if (digit(op[0])) {
        const i = parseInt(op, 10) || 0;
        if (i >= OBJSYMVALS.length) {
            config_error_add(`Illegal ${o.name} parameter '${op}'`);
            return OPTN_ERR;
        }
        osyms = i;
    } else {
        osyms = 0;
        const k = op.length;
        for (let i = 0; i < OBJSYMVALS.length; i++) {
            let l = OBJSYMVALS[i].length;
            if (k >= 4) l = k;
            if (strncmpi_eq(OBJSYMVALS[i], op, l)
                || (i === 5 && strncmpi_eq('one-or-the-other', op, 16))) {
                osyms = i;
                break;
            }
        }
    }
    set_menuobjsyms_flags(osyms, result);
    keep(o, op === '' ? !negated : op, result);
    return OPTN_OK;
}

// C ref: options.c optfn_menuinvertmode().
function optfn_menuinvertmode(o, negated, opts, op, result) {
    if (op !== '') {
        const mode = parseInt(op, 10) || 0;
        if (mode < 0 || mode > 2) {
            config_error_add(`Illegal ${o.name} parameter '${op}'`);
            return OPTN_ERR;
        }
        result.iflags.menuinvertmode = mode;
        keep(o, op, result);
    }
    return OPTN_OK;
}

// C ref: options.c optfn_menustyle() — only the value's first letter matters,
// but a missing value on the full spelling is an error.
function optfn_menustyle(o, negated, opts, op, result) {
    const val_required = (opts.length > 5 && !negated);
    op = string_for_opt(opts, !val_required);
    let tmp;
    if (op === '') {
        if (val_required) return OPTN_ERR;  /* string_for_opt gave feedback */
        tmp = negated ? 'n' : 'f';
    } else {
        tmp = lowc(op[0]);
    }
    switch (tmp) {
    case 'n': case 't': case 'c': case 'f': case 'p':
        keep(o, op === '' ? (negated ? 'n' : 'f') : op, result);
        return OPTN_OK;
    default:
        config_error_add(`Unknown ${o.name} parameter '${op}'`);
        return OPTN_ERR;
    }
}

// C ref: options.c optfn_mouse_support().
function optfn_mouse_support(o, negated, opts, op, result) {
    const compat = (opts.length <= 13);
    op = string_for_opt(opts, compat);
    if (op === '') {
        if (compat || negated) result.iflags.wc_mouse_support = negated ? 0 : 1;
    } else {
        const mode = parseInt(op, 10) || 0;
        if (mode < 0 || mode > 2 || (mode === 0 && op[0] !== '0')) {
            config_error_add(`Illegal ${o.name} parameter '${op}'`);
            return OPTN_ERR;
        }
        result.iflags.wc_mouse_support = mode;
    }
    keep(o, op === '' ? !negated : op, result);
    return OPTN_OK;
}

// C ref: options.c optfn_msg_window() (PREV_MSGS is on for tty).
function optfn_msg_window(o, negated, opts, op, result) {
    let tmp;
    if (op === '') {
        tmp = negated ? 's' : 'f';
    } else {
        if (negated) { bad_negation(o.name, true); return OPTN_ERR; }
        tmp = lowc(op[0]);
    }
    switch (tmp) {
    case 's': case 'c': case 'f': case 'r':
        result.iflags.prevmsg_window = op === '' ? tmp : op;
        keep(o, op === '' ? tmp : op, result);
        return OPTN_OK;
    default:
        config_error_add(`Unknown ${o.name} parameter '${op}'`);
        return OPTN_ERR;
    }
}

// C ref: options.c optfn_msghistory().
function optfn_msghistory(o, negated, opts, op, result) {
    op = string_for_env_opt(o.name, opts, negated);
    if ((negated && op === '') || (!negated && op !== '')) {
        result.iflags.msg_history = negated ? 0 : (parseInt(op, 10) || 0);
        keep(o, negated ? 0 : op, result);
    } else if (negated) {
        bad_negation(o.name, true);
        return OPTN_ERR;
    }
    return OPTN_OK;
}

// C ref: options.c optfn_number_pad().
function optfn_number_pad(o, negated, opts, op, result) {
    const compat = (opts.length <= 10);
    op = string_for_opt(opts, compat);
    if (op === '') {
        if (compat || negated) {
            result.iflags.num_pad = !negated;
            result.iflags.num_pad_mode = 0;
            keep(o, !negated, result);
        }
    } else if (negated) {
        bad_negation(o.name, true);
        return OPTN_ERR;
    } else {
        const mode = parseInt(op, 10) || 0;
        if (mode < -1 || mode > 4 || (mode === 0 && op[0] !== '0')) {
            config_error_add(`Illegal ${o.name} parameter '${op}'`);
            return OPTN_ERR;
        } else if (mode <= 0) {
            result.iflags.num_pad = false;
            result.iflags.num_pad_mode = (mode < 0) ? 1 : 0;
        } else {
            result.iflags.num_pad = true;
            let m = 0;
            if (mode === 2 || mode === 4) m |= 1;
            if (mode === 3 || mode === 4) m |= 2;
            result.iflags.num_pad_mode = m;
        }
        keep(o, op, result);
    }
    return OPTN_OK;
}

// C ref: options.c change_inv_order() — every character must name an object
// class that is already in flags.inv_order, and none may repeat.
const DEF_INV_ORDER = [12, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14, 16, 17, 15];
function change_inv_order(op, result) {
    let retval = 1;
    const buf = [];
    const inv_order = result.flags.inv_order_oc || DEF_INV_ORDER;
    if (!op.includes('$')) buf.push(12 /* COIN_CLASS */);
    for (let i = 0; i < op.length; i++) {
        const ch = op[i];
        let fail = false;
        const oc_sym = def_char_to_objclass(ch);
        if (oc_sym === MAXOCLASSES) {
            config_error_add(`Not an object class '${ch}'`);
            retval = 0; fail = true;
        } else if (!inv_order.includes(oc_sym)) {
            config_error_add(`Object class '${ch}' not allowed`);
            retval = 0; fail = true;
        } else if (op.indexOf(ch, i + 1) >= 0) {
            config_error_add(`Duplicate object class '${ch}'`);
            retval = 0; fail = true;
        }
        if (!fail) buf.push(oc_sym);
    }
    for (const oc of inv_order) if (!buf.includes(oc)) buf.push(oc);
    result.flags.inv_order_oc = buf.slice(0, MAXOCLASSES - 1);
    return retval;
}

// C ref: options.c optfn_packorder().
function optfn_packorder(o, negated, opts, op, result) {
    if (op === '') return OPTN_ERR;
    if (!change_inv_order(op, result)) return OPTN_ERR;
    keep(o, op, result);
    return OPTN_OK;
}

// C ref: options.c paranoia[] — {flagmask, argname, argMinLen, synonym,
// synMinLen}.  flag.h PARANOID_* bits; flags.paranoia_bits is what
// js/invent.js ParanoidRemove() and js/cmd.js's trap gate test.
const PARANOIA = [
    [0x0001, 'Confirm', 1, 'Paranoia', 2],
    [0x0002, 'quit', 1, 'explore', 2],
    [0x0004, 'die', 1, 'death', 2],
    [0x0008, 'bones', 1, null, 0],
    [0x0010, 'attack', 1, 'hit', 1],
    [0x0080, 'wand-break', 2, 'break-wand', 2],
    [0x0100, 'eat', 1, 'continue', 4],
    [0x0200, 'Were-change', 2, null, 0],
    [0x0400, 'pray', 1, null, 0],
    [0x0800, 'trap', 1, 'move-trap', 1],
    [0x1000, 'Autoall', 2, 'autoselect-all', 2],
    [0x2000, 'swim', 1, null, 0],
    [0x0040, 'Remove', 1, 'Takeoff', 1],
    [0, 'none', 4, null, 0],
    [~0, 'all', 3, null, 0],
];
function optfn_paranoid_confirmation(o, opt_negated, opts, op, result) {
    let plus_or_minus = false;
    let bits = result.flags.paranoia_bits | 0;

    if (strncmpi_eq(opts, 'prayconfirm', 4)) {
        if (op !== '') {
            config_error_add(`deprecated ${opt_negated ? '!' : ''}prayconfirm`
                             + ` option takes no parameters (found '${op}')`);
            return OPTN_SILENTERR;
        }
        op = (opt_negated ? '-' : '+') + 'pray';
        opt_negated = false;
    } else if (opt_negated) {
        if (op === '') { result.flags.paranoia_bits = 0; keep(o, false, result); return OPTN_OK; }
        config_error_add(`!${o.name} does not accept a value`);
        return OPTN_SILENTERR;
    } else if (op === '') {
        config_error_add(`${o.name} requires a value; use 'none' to cancel all`);
        return OPTN_SILENTERR;
    }

    const raw = op;
    op = mungspaces(op);
    if (op[0] !== '+' && op[0] !== '-') {
        bits = 0;
    } else {
        plus_or_minus = true;
        opt_negated = (op[0] === '-');
        op = op.slice(1);
        if (op[0] === ' ') op = op.slice(1);
    }

    for (;;) {
        let fld_negated = (op[0] === '!');
        if (fld_negated) {
            op = op.slice(1);
            if (op[0] === ' ') op = op.slice(1);
        } else if (lowc(op[0]) === 'n' && lowc(op[1]) === 'o'
                   && op[2] !== undefined && lowc(op[2]) !== 'n') {
            fld_negated = true;
            op = op.slice(2);
        }
        const sp = op.indexOf(' ');
        const token = sp >= 0 ? op.slice(0, sp) : op;
        let i = 0;
        for (; i < PARANOIA.length; i++) {
            const [mask, argname, argMinLen, synonym, synMinLen] = PARANOIA[i];
            if (match_optname(token, argname, argMinLen, false)
                || (synonym && match_optname(token, synonym, synMinLen, false))) {
                if (!mask) {
                    if (!plus_or_minus) bits = 0;
                } else if (opt_negated || fld_negated) {
                    bits &= ~mask;
                } else {
                    bits |= mask;
                }
                break;
            }
        }
        if (i === PARANOIA.length) {
            config_error_add(`Unknown ${o.name} parameter '${token}'`);
            result.flags.paranoia_bits = bits;
            return OPTN_SILENTERR;
        }
        if (sp < 0) break;
        op = op.slice(sp + 1);
    }
    result.flags.paranoia_bits = bits;
    keep(o, raw, result);
    return OPTN_OK;
}

// C ref: options.c perminv_modes[].
const PERMINV_MODES = [['none', 'off'], ['all', 'on'], ['full', 'gold'],
                       null, null, null, null, null,
                       ['in-use', 'inuse-only']];
function optfn_perminv_mode(o, negated, opts, op, result) {
    op = string_for_opt(opts, negated);
    if (op !== '' && negated) { bad_negation(o.name, true); return OPTN_SILENTERR; }
    if (op !== '') {
        const ln = op.length;
        let i = 0;
        for (; i < PERMINV_MODES.length; i++) {
            const m = PERMINV_MODES[i];
            if (!m) continue;
            if (strncmpi_eq(op, m[0], ln) || strncmpi_eq(op, m[1], ln)
                || op[0] === String.fromCharCode(48 + i)) {
                result.iflags.perminv_mode = i;
                result.iflags.perm_invent = true;
                break;
            }
        }
        if (i === PERMINV_MODES.length) {
            config_error_add(`Unknown ${o.name} parameter '${op}'`);
            result.iflags.perminv_mode = 0;
            result.iflags.perm_invent = false;
            return OPTN_SILENTERR;
        }
        keep(o, op, result);
    } else if (negated) {
        result.iflags.perminv_mode = 0;
        result.iflags.perm_invent = false;
        keep(o, false, result);
    }
    return OPTN_OK;
}

// C ref: options.c optfn_petattr() -> coloratt.c match_str2attr().
function optfn_petattr(o, negated, opts, op, result) {
    op = string_for_opt(opts, negated);
    let retval = OPTN_OK;
    if (op !== '' && negated) {
        bad_negation(o.name, true);
        retval = OPTN_ERR;
    } else if (op !== '') {
        const itmp = match_str2attr(op, false);
        if (itmp === -1) {
            config_error_add(`Unknown ${o.name} parameter '${opts}'`);
            retval = OPTN_ERR;
        } else {
            result.iflags.wc2_petattr = itmp;
            keep(o, op, result);
        }
    } else if (negated) {
        result.iflags.wc2_petattr = ATR_NONE;
        keep(o, false, result);
    }
    if (retval !== OPTN_ERR)
        result.flags.hilite_pet = (result.iflags.wc2_petattr !== ATR_NONE);
    return retval;
}

// C ref: options.c optfn_pettype() — one letter decides, and a bare "!pettype"
// with no value means "no pet".  An unrecognized value is an ERROR.
function optfn_pettype(o, negated, opts, op, result) {
    op = string_for_env_opt(o.name, opts, negated);
    if (op !== '') {
        result.flags.pettype = op;
        switch (lowc(op[0])) {
        case 'd': result.preferred_pet = 'd'; break;
        case 'c': case 'f': result.preferred_pet = 'c'; break;
        case 'h': case 'q': result.preferred_pet = 'h'; break;
        case 'n': result.preferred_pet = 'n'; break;
        case 'r': case '*': result.preferred_pet = ''; break; /* gp.preferred_pet = '\0' */
        default:
            config_error_add(`Unrecognized pet type '${op}'.`);
            return OPTN_ERR;
        }
    } else if (negated) {
        result.preferred_pet = 'n';
    }
    return OPTN_OK;
}

// C ref: options.c optfn_pickup_burden() + burdentype[].
function optfn_pickup_burden(o, negated, opts, op, result) {
    op = string_for_env_opt(o.name, opts, false);
    if (op === '') return OPTN_ERR;
    switch (lowc(op[0])) {
    case 'u': case 'b': case 's': case 'n': case 'o': case 't': case 'l':
        keep(o, op, result);
        return OPTN_OK;
    default:
        config_error_add(`Unknown ${o.name} parameter '${op}'`);
        return OPTN_ERR;
    }
}

// C ref: options.c optfn_pickup_types().  Note C's error message prints the
// walked-to-the-end `op`, i.e. an empty string.
function optfn_pickup_types(o, negated, opts, op, result) {
    const compat = (opts.length <= 6);
    op = string_for_opt(opts, compat);
    if (op === '') {
        if (compat || negated) {
            result.flags.pickup = !negated;
            return OPTN_OK;
        }
        return OPTN_OK; /* interactive prompt; unreachable from a config file */
    }
    if (negated) { bad_negation(o.name, true); return OPTN_ERR; }
    let i = 0;
    while (i < op.length && op[i] === ' ') i++;
    const rest = op.slice(i);
    if (rest[0] !== 'a' && rest[0] !== 'A') {
        let badopt = false;
        const seen = [];
        for (const ch of rest) {
            const oc_sym = def_char_to_objclass(ch);
            if (oc_sym !== MAXOCLASSES && !seen.includes(oc_sym)) seen.push(oc_sym);
            else badopt = true;
        }
        if (badopt) {
            config_error_add(`Unknown ${o.name} parameter ''`);
            return OPTN_ERR;
        }
    }
    keep(o, rest, result);
    return OPTN_OK;
}

// C ref: options.c optfn_pile_limit().
const PILE_LIMIT_DFLT = 5;
function optfn_pile_limit(o, negated, opts, op, result) {
    op = string_for_opt(opts, negated);
    let v;
    if ((negated && op === '') || (!negated && op !== '')) {
        v = negated ? 0 : (parseInt(op, 10) || 0);
    } else if (negated) {
        bad_negation(o.name, true);
        return OPTN_ERR;
    } else {
        v = PILE_LIMIT_DFLT;
    }
    if (v < 0) v = PILE_LIMIT_DFLT;
    result.flags.pile_limit = v;
    return OPTN_OK;
}

// C ref: options.c optfn_player_selection().
function optfn_player_selection(o, negated, opts, op, result) {
    op = string_for_opt(opts, negated);
    if (op !== '' && !negated) {
        if (strncmpi_eq(op, 'dialog', 6)) result.iflags.wc_player_selection = 0;
        else if (strncmpi_eq(op, 'prompt', 6)) result.iflags.wc_player_selection = 1;
        else {
            config_error_add(`Unknown ${o.name} parameter '${op}'`);
            return OPTN_ERR;
        }
        keep(o, op, result);
    }
    return OPTN_OK;
}

// C ref: options.c optfn_playmode() — a duplicate or a negation is rejected
// SILENTLY (complain_about_duplicate() has already spoken for the duplicate).
function optfn_playmode(o, negated, opts, op, result, duplicate) {
    if (duplicate || negated) return OPTN_ERR;
    if (op === '') return OPTN_ERR;
    if (strncmpi_eq(op, 'normal', 6) || strcmpi_eq(op, 'play')) {
        set_playmode('normal', result);
    } else if (strncmpi_eq(op, 'explore', 6) || strncmpi_eq(op, 'discovery', 6)) {
        set_playmode('explore', result);
    } else if (strncmpi_eq(op, 'debug', 5) || strncmpi_eq(op, 'wizard', 6)) {
        set_playmode('debug', result);
    } else {
        config_error_add(`Invalid value for "${o.name}":${op}`);
        return OPTN_ERR;
    }
    return OPTN_OK;
}

// C ref: options.c optfn_runmode() + runmodes[].
function optfn_runmode(o, negated, opts, op, result) {
    if (negated) {
        result.flags.runmode = 'teleport';
    } else if (op !== '') {
        if (str_start_is('teleport', op, true)) result.flags.runmode = 'teleport';
        else if (str_start_is('run', op, true)) result.flags.runmode = 'run';
        else if (str_start_is('walk', op, true)) result.flags.runmode = 'walk';
        else if (str_start_is('crawl', op, true)) result.flags.runmode = 'crawl';
        else {
            config_error_add(`Unknown ${o.name} parameter '${op}'`);
            return OPTN_ERR;
        }
    } else {
        config_error_add(`Value is mandatory for ${o.name}`);
        return OPTN_ERR;
    }
    return OPTN_OK;
}

// C ref: options.c optfn_scores() — "5t[op] 5a[round] o[wn]".
function optfn_scores(o, negated, opts, op, result) {
    op = string_for_opt(opts, false);
    if (op === '') return OPTN_ERR;
    if (negated) op = '';
    let i = 0;
    while (i < op.length) {
        let neg = (op[i] === '!') || strncmpi_eq(op.slice(i), 'no', 2);
        if (neg) i += (op[i] === '!') ? 1 : (op[i + 2] !== '-') ? 2 : 3;
        if (digit(op[i])) while (i < op.length && digit(op[i])) i++;
        while (op[i] === ' ') i++;
        switch (lowc(op[i] || '\0')) {
        case 't': case 'a': case 'o': case 'n':
            break;
        case '-':
            if (digit(op[i + 1])) {
                config_error_add(`Values for ${o.name}:top and ${o.name}:around`
                                 + ' must not be negative');
                return OPTN_SILENTERR;
            }
            /* FALLTHRU */
        default:
            config_error_add(`Unknown ${o.name} parameter '${op.slice(i)}'`);
            return OPTN_SILENTERR;
        }
        while (i < op.length && letter(op[i])) i++;
        while (op[i] === ' ') i++;
        if (op[i] === '/') i++;
    }
    keep(o, op, result);
    return OPTN_OK;
}

// C ref: options.c optfn_scroll_amount()/optfn_scroll_margin()/
// optfn_tile_height()/optfn_tile_width()/optfn_vary_msgcount() — the shared
// "numeric, negation resets to the default" shape.
function optfn_numeric_wc(o, negated, opts, op, result, negDflt, field) {
    op = string_for_opt(opts, negated);
    if ((negated && op === '') || (!negated && op !== '')) {
        result.iflags[field] = negated ? negDflt : (parseInt(op, 10) || 0);
        keep(o, negated ? negDflt : op, result);
    } else if (negated) {
        bad_negation(o.name, true);
        return OPTN_ERR;
    }
    return OPTN_OK;
}

// C ref: options.c optfn_sortdiscoveries().
function optfn_sortdiscoveries(o, negated, opts, op, result) {
    op = string_for_env_opt(o.name, opts, false);
    if (negated) { result.flags.discosort = 'o'; return OPTN_OK; }
    if (op === '') return OPTN_ERR;
    switch (lowc(op[0])) {
    case '0': case 'o': result.flags.discosort = 'o'; break;
    case '1': case 's': result.flags.discosort = 's'; break;
    case '2': case 'c': result.flags.discosort = 'c'; break;
    case '3': case 'a': result.flags.discosort = 'a'; break;
    default:
        config_error_add(`Unknown ${o.name} parameter '${op}'`);
        return OPTN_SILENTERR;
    }
    keep(o, op, result);
    return OPTN_OK;
}

// C ref: options.c optfn_sortloot().
function optfn_sortloot(o, negated, opts, op, result) {
    op = string_for_env_opt(o.name, opts, false);
    if (op === '') return OPTN_ERR;
    const c = lowc(op[0]);
    if (c !== 'n' && c !== 'l' && c !== 'f') {
        config_error_add(`Unknown ${o.name} parameter '${op}'`);
        return OPTN_ERR;
    }
    /* C: `flags.sortloot = c` — the single CHARACTER, which is what
       js/invent.js query_objlist() tests ('f' / 'l' / 'n'). */
    result.flags.sortloot = c;
    return OPTN_OK;
}

// C ref: options.c optfn_sortvanquished() + insight.c vanqorders[].
const VANQMODES = 'tdaACcnz';
function optfn_sortvanquished(o, negated, opts, op, result) {
    op = string_for_env_opt(o.name, opts, false);
    if (negated) { result.flags.vanq_sortmode = 0; return OPTN_OK; }
    if (op === '') return OPTN_ERR;
    let vndx;
    if (VANQMODES.indexOf(op[0]) >= 0) vndx = VANQMODES.indexOf(op[0]);
    else if ('01234567'.includes(op[0])) vndx = op.charCodeAt(0) - 48;
    else {
        config_error_add(`Unknown ${o.name} parameter '${op}'`);
        return OPTN_SILENTERR;
    }
    result.flags.vanq_sortmode = vndx;
    keep(o, op, result);
    return OPTN_OK;
}

// C ref: options.c optfn_statushilites() (STATUS_HILITES is defined).
function optfn_statushilites(o, negated, opts, op, result) {
    if (negated) {
        result.iflags.hilite_delta = 0;
    } else {
        op = string_for_opt(opts, true);
        let d = (op === '') ? 3 : (parseInt(op, 10) || 0);
        if (d < 0) d = 1;
        result.iflags.hilite_delta = d;
        keep(o, op === '' ? 3 : op, result);
    }
    return OPTN_OK;
}

// C ref: options.c optfn_statuslines() — 2 or 3, and nothing else.
function optfn_statuslines(o, negated, opts, op, result) {
    op = string_for_opt(opts, negated);
    let itmp = 0, retval = OPTN_OK;
    if (negated) {
        bad_negation(o.name, true);
        itmp = 2;
        retval = OPTN_ERR;
    } else if (op !== '') {
        itmp = parseInt(op, 10) || 0;
    }
    if (itmp < 2 || itmp > 3) {
        config_error_add(`'${o.name}:${op}' is invalid; must be 2 or 3`);
        retval = OPTN_SILENTERR;
    } else {
        result.iflags.wc2_statuslines = itmp;
        keep(o, op, result);
    }
    return retval;
}

// C ref: version.c get_feature_notice_ver() — strictly "maj.min.patch".
function get_feature_notice_ver(str) {
    const parts = [];
    let cur = '';
    for (const c of str) {
        if (c === '.') {
            parts.push(cur); cur = '';
            if (parts.length === 2) { parts.push(str.slice(str.indexOf('.', str.indexOf('.') + 1) + 1)); break; }
        } else if (digit(c)) {
            cur += c;
        } else {
            return 0;
        }
    }
    if (parts.length !== 3) return 0;
    const [a, b, c] = parts;
    if (!/^[0-9]*$/.test(c)) return 0;
    return ((parseInt(a, 10) || 0) << 24) | ((parseInt(b, 10) || 0) << 16)
           | ((parseInt(c, 10) || 0) << 8);
}

// C ref: version.c get_current_feature_ver() — FEATURE_NOTICE_VER of the
// running binary (VERSION_MAJOR.VERSION_MINOR.PATCHLEVEL == 5.0.0).
const CURRENT_FEATURE_VER = (5 << 24) | (0 << 16) | (0 << 8);

// C ref: options.c feature_alert_opts().
function feature_alert_opts(op, optn, result) {
    const fnv = get_feature_notice_ver(op);
    if (fnv === 0) return 0;
    if (fnv > CURRENT_FEATURE_VER) {
        config_error_add(`${optn}=${op} Invalid reference to a future version ignored`);
        return 0;
    }
    result.flags.suppress_alert = op;
    return 1;
}

// C ref: options.c optfn_suppress_alert().
function optfn_suppress_alert(o, negated, opts, op, result) {
    if (negated) { bad_negation(o.name, false); return OPTN_ERR; }
    if (op !== '') feature_alert_opts(op, o.name, result);
    return OPTN_OK;
}

// C ref: options.c optfn_term_cols()/optfn_term_rows().
const LARGEST_INT = 32767;
function optfn_term_dim(o, negated, opts, op, result, field) {
    op = string_for_opt(opts, negated);
    if (op !== '') {
        const ltmp = parseInt(op, 10) || 0;
        if (ltmp <= 0 || ltmp >= LARGEST_INT) {
            config_error_add(`Invalid ${o.name}: ${ltmp}`);
            return OPTN_ERR;
        }
        result.iflags[field] = ltmp;
        keep(o, op, result);
    }
    return OPTN_OK;
}

// C ref: options.c optfn_versinfo() — 1, 2, 4 or a sum of them.
function optfn_versinfo(o, negated, opts, op, result) {
    if (negated) { bad_negation(o.name, true); return OPTN_SILENTERR; }
    op = string_for_opt(opts, false);
    if (op === '') {
        config_error_add(`'${o.name}' requires a value; defaulting to 1`);
        return OPTN_SILENTERR;
    }
    const val = parseInt(op, 10) || 0;
    if (!val || (val & ~7) !== 0) {
        config_error_add(`'${o.name}' must be one of 1, 2, 4, or the sum of`
                         + ' two or all three of those');
        return OPTN_SILENTERR;
    }
    result.flags.versinfo = val;
    return OPTN_OK;
}

// C ref: options.c warning_opts() — the value's characters ARE the warning
// symbols, after escapes(); a 0 byte leaves that level's default.
function warning_opts(opts, optype, result) {
    let s = string_for_env_opt(optype, opts, false);
    if (s === '') return false;
    s = escapes(s);
    const translate = [];
    for (let i = 0; i < WARNCOUNT; i++)
        translate[i] = (i >= s.length) ? 0 : s.charCodeAt(i);
    assign_warnings(translate, result);
    return true;
}

// C ref: options.c optfn_whatis_coord() — GPCOORDS_* are 'n','c','C','m','s'.
function optfn_whatis_coord(o, negated, opts, op, result) {
    if (negated) { result.iflags.getpos_coords = 'n'; return OPTN_OK; }
    op = string_for_env_opt(o.name, opts, false);
    if (op === '') return OPTN_ERR;
    /* getpos.c GPCOORDS_NONE/COMPASS/COMFULL/MAP/SCREEN; lowc() means the
       upper-case COMFULL spelling can never be selected, exactly as in C */
    const c = lowc(op[0]);
    if (c && 'ncCms'.includes(c)) {
        result.iflags.getpos_coords = c;
        keep(o, op, result);
        return OPTN_OK;
    }
    config_error_add(`Unknown ${o.name} parameter '${op}'`);
    return OPTN_ERR;
}

// C ref: options.c optfn_whatis_filter().
function optfn_whatis_filter(o, negated, opts, op, result) {
    if (negated) { result.iflags.getloc_filter = 'n'; return OPTN_OK; }
    op = string_for_env_opt(o.name, opts, false);
    if (op === '') return OPTN_ERR;
    switch (lowc(op[0])) {
    case 'n': case 'v': case 'a':
        result.iflags.getloc_filter = lowc(op[0]);
        keep(o, op, result);
        return OPTN_OK;
    default:
        config_error_add(`Unknown ${o.name} parameter '${op}'`);
        return OPTN_ERR;
    }
}

// C ref: options.c optfn_windowborders() — 0..4.
function optfn_windowborders(o, negated, opts, op, result) {
    op = string_for_opt(opts, negated);
    if (negated && op !== '') { bad_negation(o.name, true); return OPTN_ERR; }
    const itmp = negated ? 0 : (op === '' ? 1 : (parseInt(op, 10) || 0));
    if (itmp < 0 || itmp > 4) {
        config_error_add(`Invalid ${o.name} (should be within 0 to 4): ${opts}`);
        return OPTN_SILENTERR;
    }
    result.iflags.wc2_windowborders = itmp;
    keep(o, op === '' ? itmp : op, result);
    return OPTN_OK;
}

// C ref: options.c optfn_map_mode().
const MAP_MODES = ['tiles', 'ascii4x6', 'ascii6x8', 'ascii8x8', 'ascii16x8',
                   'ascii7x12', 'ascii8x12', 'ascii16x12', 'ascii12x16',
                   'ascii10x18', 'fit_to_screen', 'ascii_fit_to_screen',
                   'tiles_fit_to_screen'];
function optfn_map_mode(o, negated, opts, op, result) {
    op = string_for_opt(opts, negated);
    if (op !== '' && !negated) {
        if (strcmpi_eq(op, 'tiles')) { keep(o, op, result); return OPTN_OK; }
        for (const nm of MAP_MODES) {
            if (nm === 'tiles') continue;
            if (strncmpi_eq(op, nm, nm.length)) { keep(o, op, result); return OPTN_OK; }
        }
        config_error_add(`Unknown ${o.name} parameter '${op}'`);
        return OPTN_ERR;
    } else if (negated) {
        bad_negation(o.name, true);
        return OPTN_ERR;
    }
    return OPTN_OK;
}

// C ref: options.c pfxfn_font() — a font_<known suffix> is accepted, anything
// else under the `font` prefix is "Unknown font parameter".
const FONT_OPTS = ['font_map', 'font_menu', 'font_message', 'font_status',
                   'font_text', 'font_size_map', 'font_size_menu',
                   'font_size_message', 'font_size_status', 'font_size_text'];
function pfxfn_font(o, negated, opts, op, result) {
    if (!FONT_OPTS.includes(o.name)) {
        config_error_add(`Unknown font parameter '${opts}'`);
        return OPTN_ERR;
    }
    op = string_for_opt(opts, false);
    if (op !== '') { keep(o, op, result); return OPTN_OK; }
    if (negated) { bad_negation(o.name, true); return OPTN_ERR; }
    return OPTN_OK;
}

// C ref: botl.c condtests[].useroption — the suffix a cond_ option names.
// Table ORDER decides: parse_cond_option() returns on the FIRST match.
const CONDTESTS_USEROPTION = `barehanded blind busy conf deaf iron fly foodPois
glowhands grab hallucinat held ice lava levitate paralyzed ride sleep slime slip
stone strngl stun submerged termIll tethered trap unconscious woundedlegs
holding`.split(/\s+/);

// C ref: botl.c parse_cond_option() — 0 ok, 1 unknown, 2 nothing after the
// prefix.  match_optname() is called with val_allowed FALSE, so a cond_ option
// carrying a ":value" matches NOTHING and is reported as unknown.
function parse_cond_option(negated, opts, result) {
    const PREFIX = 'cond_';
    if (!opts || opts.length <= PREFIX.length) return 2;
    const uniqpart = opts.slice(PREFIX.length);
    for (const compareto of CONDTESTS_USEROPTION) {
        const sl = compareto.length;
        if (match_optname(uniqpart, compareto, sl >= 4 ? 4 : sl, false)) {
            result.conds[compareto] = !negated;
            return 0;
        }
    }
    return 1;
}

// C ref: options.c pfxfn_cond_().
function pfxfn_cond_(o, negated, opts, op, result) {
    const reslt = parse_cond_option(negated, opts, result);
    if (reslt === 3) config_error_add(`Ambiguous condition option ${opts}`);
    else if (reslt !== 0)
        config_error_add(`Unknown condition option ${opts} (${reslt})`);
    return reslt === 0 ? OPTN_OK : OPTN_ERR;
}

// C ref: options.c optfn_hilite_status().
function optfn_hilite_status(o, negated, opts, op, result) {
    op = string_for_opt(opts, true);
    if (op !== '' && negated) { result.status_hilites = []; return OPTN_OK; }
    if (op === '') {
        config_error_add('Value is mandatory for hilite_status');
        return OPTN_ERR;
    }
    if (!parse_status_hl1(op, true, result)) return OPTN_ERR;
    return OPTN_OK;
}

// C ref: options.c optfn_glyph() -> utf8map.c glyphrep_to_custom_map_entries().
// Our renderer has no custom glyph map; the parse still has to reject a value
// that C rejects, and C requires at least "G_name:U+NNNN".
function optfn_glyph(o, negated, opts, op, result) {
    if (negated) {
        if (op !== '') { bad_negation('glyph', true); return OPTN_ERR; }
    }
    if (op === '') return OPTN_ERR;
    return OPTN_OK;
}

// The remaining compound options whose do_set does nothing at all but which
// must still MATCH so that no error is reported: optfn_dungeon(),
// optfn_effects(), optfn_monsters(), optfn_objects(), optfn_traps() and
// optfn_altkeyhandling() on a non-WIN32 build.
function optfn_noop(o, negated, opts, op, result) {
    if (op !== '') keep(o, op, result);
    return OPTN_OK;
}

// C ref: options.c optfn_name()/optfn_soundlib()/optfn_windowtype()/
// optfn_tile_file()/optfn_crash_email()/optfn_crash_name() — "value required,
// then keep it".
function optfn_string_required(o, negated, opts, op, result, envOpt) {
    op = envOpt ? string_for_env_opt(o.name, opts, false)
                : string_for_opt(opts, false);
    if (op === '') return OPTN_ERR;
    if (o.name === 'name') {
        // optn_name is what the recording harness reads back out of the rc to
        // build its '-u' argument, so it is the value that survives into the
        // game (see parseNethackrc()).
        result.optname = nmcpy(op, PL_NSIZ);
        return OPTN_OK;   /* svp.plname, not flags[] */
    }
    keep(o, op, result);
    return OPTN_OK;
}

// C ref: options.c optfn_windowcolors() -> wc_set_window_colors().
function optfn_windowcolors(o, negated, opts, op, result) {
    op = string_for_opt(opts, false);
    if (op !== '') {
        if (!wc_set_window_colors(op)) {
            config_error_add(`Could not set ${o.name} '${op}'`);
            return OPTN_ERR;
        }
        keep(o, op, result);
    }
    return OPTN_OK;
}

// C ref: coloratt.c wc_set_window_colors() — "menu fg/bg message fg/bg ...";
// each window name must be one of menu/message/status/text and each colour a
// known colour name.
const WCNAMES = ['menu', 'message', 'status', 'text'];
function wc_set_window_colors(op) {
    let s = mungspaces(op);
    while (s.length) {
        const sp = s.indexOf(' ');
        if (sp < 0) return false;
        const wn = s.slice(0, sp);
        let i = 0;
        for (; i < WCNAMES.length; i++) if (strcmpi_eq(wn, WCNAMES[i])) break;
        if (i === WCNAMES.length) return false;
        s = s.slice(sp + 1);
        let end = s.indexOf(' ');
        const pair = end < 0 ? s : s.slice(0, end);
        s = end < 0 ? '' : s.slice(end + 1);
        const slash = pair.indexOf('/');
        if (slash < 0) return false;
        for (const part of [pair.slice(0, slash), pair.slice(slash + 1)]) {
            if (!part || strcmpi_eq(part, 'default')) continue;
            if (match_str2clr(part, true) >= CLR_MAX) return false;
        }
    }
    return true;
}

// C ref: options.c optfn_role()/optfn_race()/optfn_gender()/optfn_alignment().
// The `!value` forms are role FILTERS (setrolefilter()), which change what
// chargen offers; the positive forms are validated by str2role() &c and an
// unknown one is a config error.
function optfn_roleopt(o, negated, opts, op, result) {
    const r = parse_role_opt(o, negated, o.name, opts, result);
    if (!r.ok) return OPTN_SILENTERR;
    if (r.op !== '!') {
        const which = o.name;
        const idx = (which === 'role') ? str2role(r.op)
                    : (which === 'race') ? str2race(r.op)
                    : (which === 'gender') ? str2gend(r.op)
                    : str2align(r.op);
        if (idx === ROLE_NONE) {
            config_error_add(`Unknown ${o.name} '${r.op}'`);
            return OPTN_ERR;
        }
        if (which === 'alignment') result.align = r.op;
        else result[which] = r.op;
    }
    return OPTN_OK;
}

// C ref: role.c clearrolefilter()/setrolefilter().  gr.rfilter is a GLOBAL set
// during config parsing, and js/role.js reads it off `game.rfilter`, so the
// filter is published there the way C publishes it.
const RS_ROLE = 0, RS_RACE = 1, RS_GENDER = 2, RS_ALGNMNT = 3;
function rolefilter(result) {
    if (!result.rfilter) result.rfilter = { roles: [], mask: 0 };
    return result.rfilter;
}
function clearrolefilter(which, result) {
    const f = rolefilter(result);
    if (which === RS_ROLE) f.roles = [];
    else if (which === RS_RACE) for (const r of races) f.mask &= ~r.selfmask;
    else if (which === RS_GENDER) for (const g of genders) f.mask &= ~g.allow;
    else if (which === RS_ALGNMNT) for (const a of aligns) f.mask &= ~a.allow;
}
function setrolefilter(bufp, result) {
    const f = rolefilter(result);
    let i;
    if ((i = str2role(bufp)) !== ROLE_NONE && i !== ROLE_RANDOM) f.roles[i] = true;
    else if ((i = str2race(bufp)) !== ROLE_NONE && i !== ROLE_RANDOM) f.mask |= races[i].selfmask;
    else if ((i = str2gend(bufp)) !== ROLE_NONE && i !== ROLE_RANDOM) f.mask |= genders[i].allow;
    else if ((i = str2align(bufp)) !== ROLE_NONE && i !== ROLE_RANDOM) f.mask |= aligns[i].allow;
    else return false;
    return true;
}

// C ref: options.c parse_role_opt() — accepts "role:priest", "race:!orc",
// "!role:tou rog wiz"; rejects mixed negation and a positive list.
function parse_role_opt(o, negated, fullname, opts, result) {
    const which = (o.name === 'role') ? RS_ROLE
                  : (o.name === 'race') ? RS_RACE
                  : (o.name === 'gender') ? RS_GENDER
                  : (o.name === 'alignment') ? RS_ALGNMNT : -1;
    let raw = string_for_env_opt(fullname, opts, false);
    if (raw === '') return { ok: false, op: '' };

    let op = mungspaces(raw);
    let prev_negated = false, first = true, retop = '';
    let i = 0;
    while (i < op.length) {
        if (op[i] === ' ') i++;
        let val_negated = false;
        while (op[i] === '!' || strncmpi_eq(op.slice(i), 'no', 2)) {
            val_negated = !val_negated;
            i += (op[i] === '!') ? 1 : (op[i + 2] !== '-') ? 2 : 3;
        }
        if (i >= op.length || op[i] === ' ') {
            config_error_add(`Negated nothing for '${fullname}'`);
            return { ok: false, op: '' };
        }
        if (!first) {
            if ((val_negated !== prev_negated) || (negated && val_negated)) {
                config_error_add(`Invalid mixed negation for '${negated ? '!' : ''}${fullname}'`);
                return { ok: false, op: '' };
            } else if (!negated && !val_negated) {
                config_error_add('Multiple role values only allowed when list is negated');
                return { ok: false, op: '' };
            }
        }
        first = false;
        prev_negated = val_negated;

        const sp = op.indexOf(' ', i);
        const token = sp >= 0 ? op.slice(i, sp) : op.slice(i);
        if (val_negated || negated) {
            clearrolefilter(which, result);
            if (!setrolefilter(token, result)) {
                config_error_add(`Invalid ${fullname} '${token}'`);
                return { ok: false, op: '' };
            }
            retop = '!';
        } else {
            retop = token;
        }
        if (sp >= 0) i = sp + 1; else break;
    }
    return { ok: true, op: retop };
}

// ---------------------------------------------------------------------------
// coloratt.c — the colour and attribute names MENUCOLOR=, HILITE_STATUS=,
// menu_headings: and petattr: are matched against.

// C ref: include/color.h CLR_*.
const CLR_MAX = 16, NO_COLOR_IDX = 8;
// C ref: coloratt.c colornames[]; everything after the NULL entry is an alias.
const COLORNAMES = [
    ['black', 0], ['red', 1], ['green', 2], ['brown', 3], ['blue', 4],
    ['magenta', 5], ['cyan', 6], ['gray', 7], ['orange', 9],
    ['light green', 10], ['yellow', 11], ['light blue', 12],
    ['light magenta', 13], ['light cyan', 14], ['white', 15], ['no color', 8],
    ['transparent', 8], ['purple', 5], ['light purple', 13],
    ['bright purple', 13], ['grey', 7], ['bright red', 9],
    ['bright green', 10], ['bright blue', 12], ['bright magenta', 13],
    ['bright cyan', 14],
];
// C ref: include/color.h ATR_*, coloratt.c attrnames[].
const ATR_NONE = 0, ATR_BOLD = 1, ATR_DIM = 2, ATR_ITALIC = 3, ATR_ULINE = 4,
      ATR_BLINK = 5, ATR_INVERSE = 6;
const ATTRNAMES = [
    ['none', ATR_NONE], ['bold', ATR_BOLD], ['dim', ATR_DIM],
    ['italic', ATR_ITALIC], ['underline', ATR_ULINE], ['blink', ATR_BLINK],
    ['inverse', ATR_INVERSE],
    ['normal', ATR_NONE], ['uline', ATR_ULINE], ['reverse', ATR_INVERSE],
];

// C ref: coloratt.c match_str2clr() — fuzzymatch over " -_", then a bare
// number.  Returns CLR_MAX for "none of the above".
function match_str2clr(str, suppress_msg) {
    let c = CLR_MAX, found = false;
    for (const [name, color] of COLORNAMES)
        if (fuzzymatch(str, name, ' -_', true)) { c = color; found = true; break; }
    if (!found && digit(str[0])) c = parseInt(str, 10) || 0;
    if (c < 0 || c >= CLR_MAX) {
        if (!suppress_msg) config_error_add(`Unknown color '${str.slice(0, 60)}'`);
        c = CLR_MAX;
    }
    return c;
}

// C ref: coloratt.c match_str2attr().
function match_str2attr(str, complain) {
    let a = -1;
    for (const [name, attr] of ATTRNAMES)
        if (fuzzymatch(str, name, ' -_', true)) { a = attr; break; }
    if (a === -1 && complain)
        config_error_add(`Unknown text attribute '${str.slice(0, 50)}'`);
    return a;
}

// C ref: coloratt.c color_attr_parse_str() — "color", "attr", "color&attr" or
// "attr&color".  Returns null on failure (the messages were already added).
function color_attr_parse_str(str) {
    const amp = str.indexOf('&');
    let c = NO_COLOR_IDX, a = ATR_NONE;
    if (amp >= 0) {
        const buf = str.slice(0, amp), tail = str.slice(amp + 1);
        c = match_str2clr(buf, false);
        a = match_str2attr(tail, true);
        if (c >= CLR_MAX && a === -1) {
            c = match_str2clr(tail, false);
            a = match_str2attr(buf, true);
        }
        if (c >= CLR_MAX || a === -1) return null;
    } else {
        const tmp = match_str2attr(str, false);
        if (tmp === -1) {
            const cc = match_str2clr(str, false);
            if (cc >= CLR_MAX) return null;
            c = cc;
        } else {
            a = tmp;
        }
    }
    return { attr: a, color: c };
}

// ---------------------------------------------------------------------------
// MENUCOLOR= — coloratt.c add_menu_coloring().

// C ref: coloratt.c add_menu_coloring_parsed().
function add_menu_coloring_parsed(str, c, a, result) {
    const ere = ere_compile(str);
    if (ere.error) {
        config_error_add(`Menucolor regex error: ${ere.error}`);
        return false;
    }
    let re;
    try { re = new RegExp(ere.jsSource); }
    catch (e) { config_error_add(`Menucolor regex error: ${e.message}`); return false; }
    /* tmp->next = gm.menu_colorings: newest first, which is the order
       get_menu_coloring() walks */
    result.menucolors.unshift({ origstr: str, regex: re, color: c, attr: a });
    result.flags.menucolors = true;
    return true;
}

// C ref: coloratt.c add_menu_coloring() — '"regex"=color&attr'.
function add_menu_coloring(tmpstr, result) {
    let str = tmpstr.slice(0, 255);
    let cs = str.indexOf('=');
    if (cs < 0) {
        config_error_add('Malformed MENUCOLOR');
        return false;
    }
    let tmps = mungspaces(str.slice(cs + 1));
    const amp = tmps.indexOf('&');
    let attrpart = null;
    if (amp >= 0) { attrpart = tmps.slice(amp + 1); tmps = tmps.slice(0, amp); }

    const c = match_str2clr(tmps, false);
    if (c >= CLR_MAX) return false;
    let a = ATR_NONE;
    if (attrpart !== null) {
        a = match_str2attr(attrpart, true);
        if (a === -1) return false;
    }

    /* the regexp portion has NOT been condensed by mungspaces() */
    let pat = str.slice(0, cs);
    if (pat[0] === '"' || pat[0] === "'") {
        let end = pat.length - 1;
        while (end > 0 && isspace(pat[end])) end--;
        if (pat[end] === pat[0]) pat = pat.slice(1, end);
    }
    return add_menu_coloring_parsed(pat, c, a, result);
}

// ---------------------------------------------------------------------------
// MSGTYPE= — options.c msgtype_parse_add()/msgtype_add()/msgtype_type().

// C ref: options.c msgtype_names[]; MSGTYP_* from include/hack.h.
const MSGTYP_NORMAL = 0, MSGTYP_NOREP = 1, MSGTYP_NOSHOW = 2, MSGTYP_STOP = 3;
const MSGTYPE_NAMES = [
    ['show', MSGTYP_NORMAL], ['hide', MSGTYP_NOSHOW], ['noshow', MSGTYP_NOSHOW],
    ['stop', MSGTYP_STOP], ['more', MSGTYP_STOP], ['norep', MSGTYP_NOREP],
];

// C ref: options.c msgtype_add().
function msgtype_add(typ, pattern, result) {
    const ere = ere_compile(pattern);
    if (ere.error) {
        config_error_add(`MSGTYPE regex error: ${ere.error}`);
        return false;
    }
    let re;
    try { re = new RegExp(ere.jsSource); }
    catch (e) { config_error_add(`MSGTYPE regex error: ${e.message}`); return false; }
    /* tmp->next = gp.plinemsg_types: newest first */
    result.msgtypes.unshift({ msgtype: typ, pattern, regex: re });
    return true;
}

// C ref: options.c msgtype_parse_add() — `sscanf(str, "%10s \"%255[^\"]\"")`,
// so the type is the first whitespace-delimited word (at most 10 characters)
// and the pattern is what sits between the next pair of double quotes.
function msgtype_parse_add(str, result) {
    let i = 0;
    while (i < str.length && isspace(str[i])) i++;
    let word = '';
    while (i < str.length && !isspace(str[i]) && word.length < 10) word += str[i++];
    /* %10s stops after 10 characters but the following " \"" still has to
       match, so a longer word makes the whole sscanf fail */
    let j = i;
    while (j < str.length && isspace(str[j])) j++;
    const haveQuote = word.length > 0 && str[j] === '"';
    let pattern = '';
    if (haveQuote) {
        j++;
        while (j < str.length && str[j] !== '"' && pattern.length < 255) pattern += str[j++];
    }
    if (!haveQuote || j >= str.length || str[j] !== '"' || !pattern.length) {
        config_error_add('Malformed MSGTYPE');
        return false;
    }
    for (const [name, typ] of MSGTYPE_NAMES)
        if (str_start_is(name, word, true)) return msgtype_add(typ, pattern, result);
    config_error_add(`Unknown message type '${word}'`);
    return false;
}

// C ref: options.c msgtype_type() — the first MSGTYPE whose regex matches wins.
// Exported so the topline writer can consult it; the list is on `game`.
export function msgtype_type(msg, norepeat) {
    const list = game.msgtypes;
    if (list) {
        for (const t of list)
            if (t.regex.test(msg)) return t.msgtype;
    }
    return norepeat ? MSGTYP_NOREP : MSGTYP_NORMAL;
}

// C ref: options.c msgtype_count().
export function msgtype_count() {
    return game.msgtypes ? game.msgtypes.length : 0;
}

// C ref: options.c count_apes().
export function count_apes() {
    return game.apelist ? game.apelist.length : 0;
}

// C ref: coloratt.c count_menucolors().
export function count_menucolors() {
    return game.menucolors ? game.menucolors.length : 0;
}

// C ref: botl.c count_cond().
export function count_cond() {
    const c = game.conds;
    if (!c) return 0;
    let n = 0;
    for (const k of Object.keys(c)) if (c[k]) n++;
    return n;
}

// C ref: botl.c count_status_hilites().
export function count_status_hilites() {
    return game.status_hilites ? game.status_hilites.length : 0;
}

// ---------------------------------------------------------------------------
// HILITE_STATUS= — botl.c parse_status_hl1()/parse_status_hl2().

// C ref: botl.c initblstats[] — [fldname, anytype, percent_capable].
const ANY_STR = 's', ANY_INT = 'i', ANY_LONG = 'l', ANY_MASK32 = 'm';
const INITBLSTATS = [
    ['title', ANY_STR, false], ['strength', ANY_INT, false],
    ['dexterity', ANY_INT, false], ['constitution', ANY_INT, false],
    ['intelligence', ANY_INT, false], ['wisdom', ANY_INT, false],
    ['charisma', ANY_INT, false], ['alignment', ANY_STR, false],
    ['score', ANY_LONG, false], ['carrying-capacity', ANY_INT, false],
    ['gold', ANY_LONG, false], ['power', ANY_INT, true],
    ['power-max', ANY_INT, false], ['experience-level', ANY_INT, true],
    ['armor-class', ANY_INT, false], ['HD', ANY_INT, false],
    ['time', ANY_LONG, false], ['hunger', ANY_INT, false],
    ['hitpoints', ANY_INT, true], ['hitpoints-max', ANY_INT, false],
    ['dungeon-level', ANY_STR, false], ['experience', ANY_LONG, true],
    ['condition', ANY_MASK32, false], ['version', ANY_STR, false],
    ['weapon', ANY_STR, false], ['armor', ANY_STR, false],
    ['terrain', ANY_STR, false],
];
// C ref: botl.c fieldids_alias[].
const FIELDIDS_ALIAS = [
    ['characteristics', 'characteristics'], ['encumbrance', 'carrying-capacity'],
    ['experience-points', 'experience'], ['dx', 'dexterity'],
    ['co', 'constitution'], ['con', 'constitution'], ['points', 'score'],
    ['cap', 'carrying-capacity'], ['pw', 'power'], ['pw-max', 'power-max'],
    ['xl', 'experience-level'], ['xplvl', 'experience-level'],
    ['ac', 'armor-class'], ['hit-dice', 'HD'], ['turns', 'time'],
    ['hp', 'hitpoints'], ['hp-max', 'hitpoints-max'],
    ['dgn', 'dungeon-level'], ['xp', 'experience'], ['exp', 'experience'],
    ['flags', 'condition'],
];
// C ref: botl.c enc_stat[] and the hutxt[] copy of eat.c hu_stat[].
const ENC_STAT = ['', 'Burdened', 'Stressed', 'Strained', 'Overtaxed', 'Overloaded'];
const HU_TXT = ['Satiated', '', 'Hungry', 'Weak', 'Fainting', 'Fainted', 'Starved'];
const ALIGNTXT = ['chaotic', 'neutral', 'lawful'];

// C ref: botl.c fldname_to_bl_indx() — canonical names, then aliases, then
// leading-substring matches; ambiguity means "no match".
function fldname_to_bl_indx(name) {
    if (!name) return null;
    let nmatches = 0, fld = null;
    for (const row of INITBLSTATS)
        if (fuzzymatch(row[0], name, ' -_', true)) { fld = row[0]; nmatches++; }
    if (!nmatches)
        for (const [alias, canon] of FIELDIDS_ALIAS)
            if (fuzzymatch(alias, name, ' -_', true)) { fld = canon; nmatches++; }
    if (!nmatches)
        for (const row of INITBLSTATS)
            if (strncmpi_eq(name, row[0], name.length)) { fld = row[0]; nmatches++; }
    return nmatches === 1 ? fld : null;
}

// C ref: botl.c is_ltgt_percentnumber() / has_ltgt_percentnumber().
function is_ltgt_percentnumber(str) {
    let i = 0;
    if (str[i] === '<' || str[i] === '>') i++;
    if (str[i] === '=') i++;
    if (str[i] === '-' || str[i] === '+') i++;
    if (!digit(str[i] || '')) return false;
    while (i < str.length && digit(str[i])) i++;
    if (str[i] === '%') i++;
    return i >= str.length;
}
function has_ltgt_percentnumber(str) {
    for (const c of str) if (!'<>=-+0123456789%'.includes(c)) return false;
    return true;
}

// C ref: botl.c splitsubfields() — '&' or '+' separated, at most 16 pieces.
function splitsubfields(str) {
    if (!str.includes('&') && !str.includes('+')) return [str];
    const out = str.split(/[&+]/);
    if (out.length > 16) return null;
    return out;
}

// C ref: botl.c parse_status_hl1() — the tokenizer: '/' starts a new subfield,
// a space (outside a title) commits the accumulated rule and restarts.
function parse_status_hl1(op, from_configfile, result) {
    const MAX_THRESH = 21;
    let hsbuf = new Array(MAX_THRESH).fill('');
    let fldnum = 0, ccount = 0, badopt = false;
    let i = 0;
    while (i < op.length && fldnum < MAX_THRESH && ccount < 126) {
        const c = lowc(op[i]);
        if (c === ' ') {
            if (fldnum >= 1) {
                if (fldnum === 1 && strcmpi_eq(hsbuf[0], 'title')) {
                    hsbuf[fldnum] += c;
                    ccount++;
                    i++;
                    continue;
                }
                if (!parse_status_hl2(hsbuf, from_configfile, result)) { badopt = true; break; }
            }
            hsbuf = new Array(MAX_THRESH).fill('');
            fldnum = 0;
            ccount = 0;
        } else if (c === '/') {
            fldnum++;
            ccount = 0;
        } else {
            hsbuf[fldnum] += c;
            ccount++;
        }
        i++;
    }
    if (fldnum >= 1 && !badopt)
        if (!parse_status_hl2(hsbuf, from_configfile, result)) badopt = true;
    if (badopt) return false;
    if (!result.iflags.hilite_delta) result.iflags.hilite_delta = 3;
    return true;
}

// C ref: botl.c parse_status_hl2() — validate one "field/behaviour/colour..."
// rule.  Only the accept/reject decision and the error text are modelled; the
// renderer does not colour status fields.
function parse_status_hl2(s, from_configfile, result) {
    let sidx = 0;
    const fld = fldname_to_bl_indx(s[sidx]);

    if (fld === 'characteristics') {
        for (const nm of ['strength', 'dexterity', 'constitution',
                          'intelligence', 'wisdom', 'charisma']) {
            const copy = s.slice();
            copy[0] = nm;
            if (!parse_status_hl2(copy, from_configfile, result)) return false;
        }
        return true;
    }
    if (fld === null) {
        config_error_add(`Unknown status field '${s[sidx]}'`);
        return false;
    }
    const row = INITBLSTATS.find((r) => r[0] === fld);
    if (fld === 'condition') {
        /* C hands this to parse_condition(); a condition name list is a
           different grammar and our renderer has no condition highlights, so
           accept it rather than invent an error C would not print */
        return true;
    }

    let successes = 0;
    sidx++;
    while (s[sidx]) {
        let percent = false, numeric = false, txtval = false;
        let value = 0, rel = 'lt';

        if (!s[sidx + 1] || strcmpi_eq(s[sidx], 'always')) {
            if (!s[sidx + 1]) sidx--;
        } else if (strcmpi_eq(s[sidx], 'up') || strcmpi_eq(s[sidx], 'down')) {
            /* accepted for every field type */
        } else if (fld === 'carrying-capacity'
                   && ENC_STAT.slice(1).some((t) => strcmpi_eq(s[sidx], t))) {
            txtval = true;
        } else if (fld === 'alignment' && ALIGNTXT.some((t) => strcmpi_eq(s[sidx], t))) {
            txtval = true;
        } else if (fld === 'hunger' && HU_TXT.some((t) => t && strcmpi_eq(s[sidx], t))) {
            txtval = true;
        } else if (strcmpi_eq(s[sidx], 'changed')) {
            /* accepted */
        } else if (fld === 'hitpoints' && strcmpi_eq(s[sidx], 'criticalhp')) {
            /* accepted */
        } else if (is_ltgt_percentnumber(s[sidx])) {
            const tmp = s[sidx];
            percent = tmp.includes('%');
            if (tmp[0] === '<') rel = (tmp[1] === '=') ? 'le' : 'lt';
            else if (tmp[0] === '>') rel = (tmp[1] === '=') ? 'ge' : 'gt';
            else rel = 'eq';
            const stripped = tmp.replace(/[%<>=+]/g, '');
            value = parseInt(stripped, 10) || 0;
            numeric = true;
            const dt = percent ? ANY_INT : row[1];
            const opTxt = rel === 'gt' ? '>' : rel === 'ge' ? '>=' :
                          rel === 'lt' ? '<' : rel === 'le' ? '<=' : '=';
            if (dt === ANY_INT
                && (value < ((fld === 'armor-class') ? -128 : rel === 'gt' ? -1 : rel === 'lt' ? 1 : 0)
                    || value > (percent ? (rel === 'lt' ? 101 : 100) : LARGEST_INT))) {
                config_error_add(`Threshold value ${opTxt}${value}${percent ? '%' : ''}`
                                 + ' is out of range');
                return false;
            } else if (dt === ANY_LONG && value < (rel === 'gt' ? -1 : rel === 'lt' ? 1 : 0)) {
                config_error_add(`Threshold value ${opTxt}${value} is out of range`);
                return false;
            }
        } else if (row[1] === ANY_STR) {
            txtval = true;
        } else {
            config_error_add(has_ltgt_percentnumber(s[sidx])
                ? `Wrong format '${s[sidx]}', expected a threshold number or percent`
                : `Unknown behavior '${s[sidx]}'`);
            return false;
        }

        if (row[1] === ANY_STR && (percent || numeric)) {
            config_error_add(`Field '${fld}' does not support numeric values`);
            return false;
        }
        if (percent) {
            if (!row[2]) {
                config_error_add(`Cannot use percent with '${fld}'`);
                return false;
            }
            if (value < -1 || (value === 0 && rel === 'lt')
                || (value === 100 && rel === 'gt') || value > 101) {
                const opTxt = rel === 'lt' ? '<' : rel === 'le' ? '<=' :
                              rel === 'gt' ? '>' : rel === 'ge' ? '>=' : '=';
                config_error_add(`hilite_status: invalid percentage value '${opTxt}${value}%'`);
                return false;
            }
        }

        sidx++;
        const how = s[sidx];
        if (how === undefined && !successes) return false;
        const subfields = splitsubfields(how || '');
        if (!subfields || subfields.length < 1) return false;

        let coloridx = -1;
        for (const sub of subfields) {
            const a = match_str2attr(sub, false);
            if (a !== -1) continue;
            const c = match_str2clr(sub, false);
            if (c >= CLR_MAX || coloridx !== -1) {
                config_error_add(`bad color '${c} ${coloridx}'`);
                return false;
            }
            coloridx = c;
        }
        result.status_hilites.push({ fld, rel, value, percent, txtval,
                                     color: coloridx < 0 ? NO_COLOR_IDX : coloridx });
        successes++;
        sidx++;
    }
    return successes > 0;
}

// ---------------------------------------------------------------------------
// options.c allopt[].optfn — one entry per option, same names as the C
// functions.  Several C functions are one-line forwarders (optfn_font_map() ->
// pfxfn_font(), optfn_catname() -> petname_optfn(), the thirteen menu_*
// accelerators -> shared_menu_optfn()); they are kept as forwarders here so the
// table below reads like allopt[] does.

function optfn_align_message(o, negated, opts, op, result) {
    return optfn_align_misc(o, negated, opts, op, result);
}
function optfn_align_status(o, negated, opts, op, result) {
    return optfn_align_misc(o, negated, opts, op, result);
}
// C ref: optfn_altkeyhandling() — the WIN32CON body is compiled out.
function optfn_altkeyhandling(o, negated, opts, op, result) {
    return optfn_noop(o, negated, opts, op, result);
}
function optfn_alignment(o, negated, opts, op, result) {
    return optfn_roleopt(o, negated, opts, op, result);
}
function optfn_role(o, negated, opts, op, result) {
    return optfn_roleopt(o, negated, opts, op, result);
}
function optfn_race(o, negated, opts, op, result) {
    return optfn_roleopt(o, negated, opts, op, result);
}
function optfn_gender(o, negated, opts, op, result) {
    return optfn_roleopt(o, negated, opts, op, result);
}
function optfn_catname(o, negated, opts, op, result) {
    return petname_optfn(o, negated, opts, op, result);
}
function optfn_dogname(o, negated, opts, op, result) {
    return petname_optfn(o, negated, opts, op, result);
}
function optfn_horsename(o, negated, opts, op, result) {
    return petname_optfn(o, negated, opts, op, result);
}
function optfn_crash_email(o, negated, opts, op, result) {
    return optfn_string_required(o, negated, opts, op, result, false);
}
function optfn_crash_name(o, negated, opts, op, result) {
    return optfn_string_required(o, negated, opts, op, result, false);
}
function optfn_DECgraphics(o, negated, opts, op, result) {
    return optfn_graphics_compat(o, negated, opts, result);
}
function optfn_IBMgraphics(o, negated, opts, op, result) {
    return optfn_graphics_compat(o, negated, opts, result);
}
// The five "list of symbols to use in drawing ..." options: C's do_set arm is
// `return optn_ok` — they must MATCH (so no error) and do nothing.
function optfn_dungeon(o, negated, opts, op, result) {
    return optfn_noop(o, negated, opts, op, result);
}
function optfn_effects(o, negated, opts, op, result) {
    return optfn_noop(o, negated, opts, op, result);
}
function optfn_monsters(o, negated, opts, op, result) {
    return optfn_noop(o, negated, opts, op, result);
}
function optfn_objects(o, negated, opts, op, result) {
    return optfn_noop(o, negated, opts, op, result);
}
function optfn_traps(o, negated, opts, op, result) {
    return optfn_noop(o, negated, opts, op, result);
}
function optfn_font_map(o, negated, opts, op, result) { return pfxfn_font(o, negated, opts, op, result); }
function optfn_font_menu(o, negated, opts, op, result) { return pfxfn_font(o, negated, opts, op, result); }
function optfn_font_message(o, negated, opts, op, result) { return pfxfn_font(o, negated, opts, op, result); }
function optfn_font_status(o, negated, opts, op, result) { return pfxfn_font(o, negated, opts, op, result); }
function optfn_font_text(o, negated, opts, op, result) { return pfxfn_font(o, negated, opts, op, result); }
function optfn_font_size_map(o, negated, opts, op, result) { return pfxfn_font(o, negated, opts, op, result); }
function optfn_font_size_menu(o, negated, opts, op, result) { return pfxfn_font(o, negated, opts, op, result); }
function optfn_font_size_message(o, negated, opts, op, result) { return pfxfn_font(o, negated, opts, op, result); }
function optfn_font_size_status(o, negated, opts, op, result) { return pfxfn_font(o, negated, opts, op, result); }
function optfn_font_size_text(o, negated, opts, op, result) { return pfxfn_font(o, negated, opts, op, result); }
function optfn_name(o, negated, opts, op, result) {
    return optfn_string_required(o, negated, opts, op, result, true);
}
function optfn_soundlib(o, negated, opts, op, result) {
    return optfn_string_required(o, negated, opts, op, result, true);
}
function optfn_windowtype(o, negated, opts, op, result) {
    return optfn_string_required(o, negated, opts, op, result, true);
}
function optfn_tile_file(o, negated, opts, op, result) {
    return optfn_string_required(o, negated, opts, op, result, false);
}
function optfn_roguesymset(o, negated, opts, op, result) {
    return optfn_symset(o, negated, opts, op, result);
}
function optfn_scroll_amount(o, negated, opts, op, result) {
    return optfn_numeric_wc(o, negated, opts, op, result, 1, 'wc_scroll_amount');
}
function optfn_scroll_margin(o, negated, opts, op, result) {
    return optfn_numeric_wc(o, negated, opts, op, result, 5, 'wc_scroll_margin');
}
function optfn_tile_height(o, negated, opts, op, result) {
    return optfn_numeric_wc(o, negated, opts, op, result, 0, 'wc_tile_height');
}
function optfn_tile_width(o, negated, opts, op, result) {
    return optfn_numeric_wc(o, negated, opts, op, result, 0, 'wc_tile_width');
}
function optfn_vary_msgcount(o, negated, opts, op, result) {
    return optfn_numeric_wc(o, negated, opts, op, result, 0, 'wc_vary_msgcount');
}
function optfn_term_cols(o, negated, opts, op, result) {
    return optfn_term_dim(o, negated, opts, op, result, 'wc2_term_cols');
}
function optfn_term_rows(o, negated, opts, op, result) {
    return optfn_term_dim(o, negated, opts, op, result, 'wc2_term_rows');
}
function optfn_warnings(o, negated, opts, op, result) {
    return warning_opts(opts, o.name, result) ? OPTN_OK : OPTN_ERR;
}

// C ref: options.c shared_menu_optfn() — the thirteen menu_<command> options
// all resolve to check_misc_menu_command() + spcfn_misc_menu_cmd().
function shared_menu_optfn(o, negated, opts, op, result) {
    const res = check_misc_menu_command(opts);
    if (res < 0) return OPTN_ERR;
    return spcfn_misc_menu_cmd(res, negated, opts, result);
}
function optfn_menu_deselect_all(o, n, s, p, r) { return shared_menu_optfn(o, n, s, p, r); }
function optfn_menu_deselect_page(o, n, s, p, r) { return shared_menu_optfn(o, n, s, p, r); }
function optfn_menu_first_page(o, n, s, p, r) { return shared_menu_optfn(o, n, s, p, r); }
function optfn_menu_invert_all(o, n, s, p, r) { return shared_menu_optfn(o, n, s, p, r); }
function optfn_menu_invert_page(o, n, s, p, r) { return shared_menu_optfn(o, n, s, p, r); }
function optfn_menu_last_page(o, n, s, p, r) { return shared_menu_optfn(o, n, s, p, r); }
function optfn_menu_next_page(o, n, s, p, r) { return shared_menu_optfn(o, n, s, p, r); }
function optfn_menu_previous_page(o, n, s, p, r) { return shared_menu_optfn(o, n, s, p, r); }
function optfn_menu_search(o, n, s, p, r) { return shared_menu_optfn(o, n, s, p, r); }
function optfn_menu_select_all(o, n, s, p, r) { return shared_menu_optfn(o, n, s, p, r); }
function optfn_menu_select_page(o, n, s, p, r) { return shared_menu_optfn(o, n, s, p, r); }
function optfn_menu_shift_left(o, n, s, p, r) { return shared_menu_optfn(o, n, s, p, r); }
function optfn_menu_shift_right(o, n, s, p, r) { return shared_menu_optfn(o, n, s, p, r); }

// The OthrOpt entries: C's do_set arm is empty (their values come from their own
// config STATEMENTS, not from OPTIONS=), so naming one in OPTIONS= is accepted
// and does nothing.
function optfn_o_autopickup_exceptions() { return OPTN_OK; }
function optfn_o_bind_keys() { return OPTN_OK; }
function optfn_o_autocomplete() { return OPTN_OK; }
function optfn_o_menu_colors() { return OPTN_OK; }
function optfn_o_message_types() { return OPTN_OK; }
function optfn_o_status_cond() { return OPTN_OK; }
function optfn_o_status_hilites() { return OPTN_OK; }

// C ref: include/optlist.h allopt[].optfn, resolved for this build.  Table
// ORDER is already fixed by ALLOPT_DATA; this is the function column.
const OPTFN = {
    align_message: optfn_align_message, align_status: optfn_align_status,
    alignment: optfn_alignment, altkeyhandling: optfn_altkeyhandling,
    autounlock: optfn_autounlock, boulder: optfn_boulder,
    catname: optfn_catname, crash_email: optfn_crash_email,
    crash_name: optfn_crash_name, crash_urlmax: optfn_crash_urlmax,
    DECgraphics: optfn_DECgraphics, disclose: optfn_disclose,
    dogname: optfn_dogname, dungeon: optfn_dungeon, effects: optfn_effects,
    font_map: optfn_font_map, font_menu: optfn_font_menu,
    font_message: optfn_font_message, font_size_map: optfn_font_size_map,
    font_size_menu: optfn_font_size_menu,
    font_size_message: optfn_font_size_message,
    font_size_status: optfn_font_size_status,
    font_size_text: optfn_font_size_text, font_status: optfn_font_status,
    font_text: optfn_font_text, fruit: optfn_fruit, gender: optfn_gender,
    glyph: optfn_glyph, hilite_status: optfn_hilite_status,
    horsename: optfn_horsename, IBMgraphics: optfn_IBMgraphics,
    map_mode: optfn_map_mode,
    menu_deselect_all: optfn_menu_deselect_all,
    menu_deselect_page: optfn_menu_deselect_page,
    menu_first_page: optfn_menu_first_page,
    menu_invert_all: optfn_menu_invert_all,
    menu_invert_page: optfn_menu_invert_page,
    menu_last_page: optfn_menu_last_page,
    menu_next_page: optfn_menu_next_page,
    menu_previous_page: optfn_menu_previous_page,
    menu_search: optfn_menu_search,
    menu_select_all: optfn_menu_select_all,
    menu_select_page: optfn_menu_select_page,
    menu_shift_left: optfn_menu_shift_left,
    menu_shift_right: optfn_menu_shift_right,
    menu_headings: optfn_menu_headings, menu_objsyms: optfn_menu_objsyms,
    menuinvertmode: optfn_menuinvertmode, menustyle: optfn_menustyle,
    monsters: optfn_monsters, mouse_support: optfn_mouse_support,
    msg_window: optfn_msg_window, msghistory: optfn_msghistory,
    name: optfn_name, number_pad: optfn_number_pad, objects: optfn_objects,
    packorder: optfn_packorder,
    paranoid_confirmation: optfn_paranoid_confirmation,
    perminv_mode: optfn_perminv_mode, petattr: optfn_petattr,
    pettype: optfn_pettype, pickup_burden: optfn_pickup_burden,
    pickup_types: optfn_pickup_types, pile_limit: optfn_pile_limit,
    player_selection: optfn_player_selection, playmode: optfn_playmode,
    race: optfn_race, roguesymset: optfn_roguesymset, role: optfn_role,
    runmode: optfn_runmode, scores: optfn_scores,
    scroll_amount: optfn_scroll_amount, scroll_margin: optfn_scroll_margin,
    soundlib: optfn_soundlib, sortdiscoveries: optfn_sortdiscoveries,
    sortloot: optfn_sortloot, sortvanquished: optfn_sortvanquished,
    statushilites: optfn_statushilites, statuslines: optfn_statuslines,
    suppress_alert: optfn_suppress_alert, symset: optfn_symset,
    term_cols: optfn_term_cols, term_rows: optfn_term_rows,
    tile_file: optfn_tile_file, tile_height: optfn_tile_height,
    tile_width: optfn_tile_width, traps: optfn_traps,
    vary_msgcount: optfn_vary_msgcount, versinfo: optfn_versinfo,
    warnings: optfn_warnings, whatis_coord: optfn_whatis_coord,
    whatis_filter: optfn_whatis_filter, windowborders: optfn_windowborders,
    windowcolors: optfn_windowcolors, windowtype: optfn_windowtype,
    cond_: pfxfn_cond_, font: pfxfn_font,
    autocompletions: optfn_o_autocomplete,
    'autopickup exceptions': optfn_o_autopickup_exceptions,
    'bind keys': optfn_o_bind_keys,
    'menu colors': optfn_o_menu_colors,
    'message types': optfn_o_message_types,
    'status condition fields': optfn_o_status_cond,
    'status highlight rules': optfn_o_status_hilites,
};

// The `pfx` and OthrOpt entries take (o, negated, opts, result); the rest of
// the forwarders above take C's (optidx, req, negated, opts, op) shape reduced
// to what a config-file do_set needs.
function optfn_compound(o, negated, opts, op, result, duplicate) {
    const fn = OPTFN[o.name];
    if (!fn) return optfn_noop(o, negated, opts, op, result);
    if (o.name === 'playmode')
        return optfn_playmode(o, negated, opts, op, result, duplicate);
    return fn(o, negated, opts, op, result);
}

// C ref: options.c set_playmode() — wizard/discover, and authorize_wizard_mode()
// always succeeds because the recorder's sysconf carries WIZARDS=*.
function set_playmode(mode, result) {
    result.flags.playmode = mode;
    if (mode === 'debug') result.flags.debug = true;
}

// C ref: options.c set_menuobjsyms_flags().
function set_menuobjsyms_flags(osyms, result) {
    result.iflags.menuobjsyms = osyms;
    result.iflags.menu_head_objsym = (osyms === 1 || osyms === 3 || osyms === 5);
    result.iflags.use_menu_glyphs = (osyms === 2 || osyms === 3 || osyms === 4
                                     || osyms === 5);
}

// C ref: options.c duplicate_opt_detection()/reset_duplicate_opt_detection().
function duplicate_opt_detection(optidx) {
    return dupdetected[optidx]++ > 0;
}
function reset_duplicate_opt_detection() {
    dupdetected = new Array(ALLOPT.length).fill(0);
}

// C ref: options.c msgtype2name().
function msgtype2name(typ) {
    for (const [name, t] of MSGTYPE_NAMES) if (t === typ) return name;
    return null;
}

// C ref: options.c msgtype_free() / free_one_msgtype().
function msgtype_free(result) { result.msgtypes.length = 0; }
function free_one_msgtype(idx, result) { result.msgtypes.splice(idx, 1); }

// C ref: options.c hide_unhide_msgtypes() — a NEGATIVE msgtype is not
// recognised by pline(), which is how "hide these types for now" works.
function hide_unhide_msgtypes(hide, hide_mask, list) {
    for (const t of list) {
        let mt = t.msgtype;
        if (!hide) mt = -mt;
        if (mt > 0 && ((1 << mt) & hide_mask)) t.msgtype = -t.msgtype;
    }
}

// C ref: options.c test_regex_pattern() — compile a pattern only to find out
// whether it is valid; the caller re-parses it after validating the rest.
function test_regex_pattern(str, errmsg) {
    if (!str) return false;
    const ere = ere_compile(str);
    if (ere.error) {
        config_error_add(`${errmsg || 'NHregex error'}: ${ere.error}`);
        return false;
    }
    try { new RegExp(ere.jsSource); } catch (e) {
        config_error_add(`${errmsg || 'NHregex error'}: ${e.message}`);
        return false;
    }
    return true;
}

// C ref: options.c oc_to_str() — object CLASS numbers back to their symbols.
function oc_to_str(src) {
    let out = '';
    for (const oc of src || []) out += DEF_OC_SYMS[oc] || '';
    return out;
}

// C ref: options.c free_autopickup_exceptions()/remove_autopickup_exception().
function free_autopickup_exceptions(result) { result.apelist.length = 0; }
function remove_autopickup_exception(ape, result) {
    const i = result.apelist.indexOf(ape);
    if (i >= 0) result.apelist.splice(i, 1);
}

// C ref: cmd.c count_autocompletions() / options.c count_bind_keys().
export function count_autocompletions() {
    const a = game.autocomplete;
    return a ? Object.keys(a).length : 0;
}
export function count_bind_keys() {
    return game.keybind ? Object.keys(game.keybind).length : 0;
}

// C ref: options.c allopt[].dupdetected, reset per config FILE by
// reset_duplicate_opt_detection(), and go.using_alias.
let dupdetected = [];
let using_alias = false;

// C ref: options.c parseoptions() — one element of a comma-separated OPTIONS
// list, or the whole list (it splits and recurses itself).
function parseoptions(optstr, tinitial, result) {
    let opts = optstr;

    using_alias = false;

    // Elements are processed RIGHT TO LEFT: split at the first comma and
    // recurse on the rest before handling the current element.  So with a
    // duplicated option the LEFTMOST occurrence is applied last and wins.
    if (tinitial) {
        const comma = opts.indexOf(',');
        if (comma >= 0) {
            parseoptions(opts.slice(comma + 1), tinitial, result);
            opts = opts.slice(0, comma);
        }
    }
    if (opts.length > BUFSZ / 2) {
        config_error_add(`Option too long, max length is ${BUFSZ / 2} characters`);
        return;
    }

    while (opts.length && isspace(opts[0])) opts = opts.slice(1);
    while (opts.length && isspace(opts[opts.length - 1])) opts = opts.slice(0, -1);
    if (!opts) {
        config_error_add('Empty statement');
        return;
    }

    // options.c:540 — a LOOP, so "!no", "nono" and the "no-" spelling all work.
    // Note there is no re-trim afterwards, so "no legacy" does NOT parse.
    let negated = false;
    while (opts[0] === '!' || strncmpi_eq(opts, 'no', 2)) {
        opts = opts.slice(opts[0] === '!' ? 1 : (opts[2] !== '-') ? 2 : 3);
        negated = !negated;
    }

    let optlen = opts.length;
    const optlen_wo_val = length_without_val(opts, optlen);
    if (optlen_wo_val < optlen) optlen = optlen_wo_val;

    let matchidx = -1, got_match = false, pfx_match = false;
    for (let i = 0; i < ALLOPT.length; i++) {
        const o = ALLOPT[i];
        got_match = false;
        if (o.pfx && str_start_is(opts, o.name, true)) {
            matchidx = i;
            got_match = pfx_match = true;
        }
        if (!got_match) got_match = match_optname(opts, o.name, o.minmatch, true);
        if (got_match) {
            if (!o.pfx && optlen < o.minmatch) {
                /* matchidx deliberately left alone, as C leaves it: an
                   ambiguous option reports once and sets nothing. */
                config_error_add(`Ambiguous option ${opts}, ${o.minmatch}`
                                 + ' characters are needed to differentiate');
                break;
            }
            matchidx = i;
            break;
        }
    }

    // Second pass over the aliases, which must match at their full length.
    if (!got_match) {
        for (let i = 0; i < ALLOPT.length; i++) {
            const o = ALLOPT[i];
            if (!o.alias) continue;
            if (match_optname(opts, o.alias, o.alias.length, true)) {
                matchidx = i;
                got_match = true;
                using_alias = true;
                break;
            }
        }
    }

    let optresult = OPTN_ERR;
    if (got_match && matchidx >= 0) {
        const o = ALLOPT[matchidx];
        // C ref: options.c duplicate_opt_detection()/complain_about_duplicate()
        // — the counter is per allopt[] entry and is reset per config FILE, so
        // the same option on two different lines complains too.  OthrOpt
        // entries print "boolean" along with the Boolean ones.
        const duplicate = duplicate_opt_detection(matchidx);
        if (duplicate && !o.dupeok) complain_about_duplicate(o);
        if (negated && !o.negateok) {
            bad_negation(o.name, true);
            return;
        }
        const op = string_for_opt(opts, true);
        if (o.typ === 'B') optresult = optfn_boolean(o, negated, opts, op, result);
        else if (o.typ === 'C')
            optresult = optfn_compound(o, negated, opts, op, result, duplicate);
        else optresult = OPTN_OK; /* OthrOpt: do_set does nothing */
    }

    if (!got_match) {
        // Is it a symbol?  C requires BOTH the "S_" prefix and a successful
        // parsesymbols(); a name loadsyms[] does not carry falls through to
        // "Unknown option", which is a screen.
        if (opts.startsWith('S_') && parsesymbols(opts, PRIMARYSET, result))
            optresult = OPTN_OK;
    }

    if (optresult === OPTN_SILENTERR
        || (got_match && ALLOPT[matchidx].disregarded)) return;
    // C ref: options.c parseoptions() — a PREFIX option whose suffix its
    // pfxfn() rejected names the suffix rather than reporting nothing.
    if (pfx_match && optresult === OPTN_ERR) {
        let pfxbuf = opts;
        const colon = pfxbuf.indexOf(':');
        if (colon >= 0) pfxbuf = pfxbuf.slice(0, colon);
        config_error_add(`bad option suffix variation '${pfxbuf}'`);
        return;
    }
    if (got_match && optresult === OPTN_ERR) return;
    if (optresult === OPTN_OK) return;

    // C ref: options.c parseoptions() falling off the end.  Only an option
    // name that matched NOTHING lands here: a matched option with a bad value
    // reports its own complaint from inside its optfn and returns first.
    config_error_add(`Unknown option '${opts}'`);
}

// C ref: options.c complain_about_duplicate().
function complain_about_duplicate(o) {
    const via = using_alias ? ` (via alias: ${o.alias})` : '';
    config_error_add(`${o.typ === 'C' ? 'compound' : 'boolean'}`
                     + ` option specified multiple times: ${o.name}${via}`);
}

// C ref: cfgfiles.c config_line_stmt[] — [directive name, minimum number of
// characters that must match].  Matched with match_varname(), which is just
// match_optname(..., val_allowed=TRUE): the text before the '=' or ':' must be
// a case-insensitive leading substring of the name and at least that long, so
// "BIND=" reaches BINDINGS and "SYMB=" reaches SYMBOLS.  Table order breaks ties
// (ROGUESYMBOLS is listed ahead of SYMBOLS).  The syscnf_only entries are left
// out because parse_config_line() skips them unless it is reading sysconf, and
// the USER_SOUNDS pair is absent from this build.
// ---------------------------------------------------------------------------
// cfgfiles.c — one cnf_line_<STATEMENT>() per config statement.

// C ref: hacklib.c mungspaces() — tab to space, runs of spaces to one,
// leading/trailing space dropped; a newline ends the string.
function mungspaces(bp) {
    let out = '', was_space = true;
    for (let i = 0; i < bp.length; i++) {
        let c = bp[i];
        if (c === '\n') break;
        if (c === '\t') c = ' ';
        if (c !== ' ' || !was_space) out += c;
        was_space = (c === ' ');
    }
    if (was_space && out.length) out = out.slice(0, -1);
    return out;
}

// C ref: cfgfiles.c find_optparam() — index of the first '=' or ':'.
function find_optparam(buf) {
    let bufp = buf.indexOf('=');
    const altp = buf.indexOf(':');
    if (bufp < 0 || (altp >= 0 && altp < bufp)) bufp = altp;
    return bufp;
}

// C ref: cfgfiles.c cnf_line_OPTIONS().  config_line_stmt[].origbuf is TRUE
// only for OPTIONS, so the separator is re-found in the UNMUNGED line and the
// rest is handed to parseoptions() (which does its own space handling).
function cnf_line_OPTIONS(origbuf, result) {
    parseoptions(origbuf.slice(find_optparam(origbuf) + 1), true, result);
    return true;
}
function cnf_line_AUTOPICKUP_EXCEPTION(bufp, result) {
    add_autopickup_exception(bufp, result);
    return true;
}
function cnf_line_BINDINGS(bufp, result) { return parsebindings(bufp, result); }
function cnf_line_AUTOCOMPLETE(bufp, result) {
    parseautocomplete(bufp, true, result);
    return true;
}
function cnf_line_MSGTYPE(bufp, result) { return msgtype_parse_add(bufp, result); }
// The directory statements are all `nhUse(bufp)` without NOCWD_ASSUMPTIONS,
// but they must MATCH so that no "Unknown config statement" is reported.
function cnf_line_HACKDIR() { return true; }
function cnf_line_LEVELDIR() { return true; }
function cnf_line_SAVEDIR() { return true; }
function cnf_line_BONESDIR() { return true; }
function cnf_line_DATADIR() { return true; }
function cnf_line_SCOREDIR() { return true; }
function cnf_line_LOCKDIR() { return true; }
function cnf_line_CONFIGDIR() { return true; }
function cnf_line_TROUBLEDIR() { return true; }
// C ref: cnf_line_NAME() — strncpy(svp.plname, ...).  The recorded games never
// show it: process_options() runs AFTER initoptions(), and the recording
// harness always passes '-u <name>', so unixmain.c's case 'u' overwrites plname
// with the command-line value (empty when the rc has no OPTIONS=name:).  See
// the override in parseNethackrc().
function cnf_line_NAME(bufp, result) {
    result.plname = bufp.slice(0, PL_NSIZ - 1);
    return true;
}
// C ref: cnf_line_ROLE() — `if ((len = str2role(bufp)) >= 0) initrole = len`,
// so an unrecognised role is silently ignored rather than reported.
function cnf_line_ROLE(bufp, result) {
    if (str2role(bufp) >= 0) result.role = bufp;
    return true;
}
function cnf_line_dogname(bufp, result) {
    result.flags.dogname = bufp.slice(0, PL_PSIZ - 1);
    return true;
}
function cnf_line_catname(bufp, result) {
    result.flags.catname = bufp.slice(0, PL_PSIZ - 1);
    return true;
}
// C ref: cnf_line_BOULDER() — get_uchars() into ov_primary_syms[], one entry,
// in place: a 0 (or a syntax error) leaves the default symbol.
function cnf_line_BOULDER(bufp, result) {
    const list = [];
    get_uchars(bufp, list, true, 1, 'BOULDER');
    if (list[0]) result.symoverride.S_boulder = String.fromCharCode(list[0]);
    return true;
}
function cnf_line_MENUCOLOR(bufp, result) { return add_menu_coloring(bufp, result); }
function cnf_line_HILITE_STATUS(bufp, result) {
    return parse_status_hl1(bufp, true, result);
}
function cnf_line_WARNINGS(bufp, result) {
    const translate = new Array(WARNCOUNT).fill(0);
    get_uchars(bufp, translate, false, WARNCOUNT, 'WARNINGS');
    assign_warnings(translate, result);
    return true;
}
function cnf_line_ROGUESYMBOLS(bufp, result) {
    const ref = { buf: bufp };
    if (parsesymbols(bufp, ROGUESET, result, ref)) return true;
    config_error_add(`Error in ROGUESYMBOLS definition '${ref.buf}'`);
    return false;
}
function cnf_line_SYMBOLS(bufp, result) {
    const ref = { buf: bufp };
    if (parsesymbols(bufp, PRIMARYSET, result, ref)) return true;
    config_error_add(`Error in SYMBOLS definition '${ref.buf}'`);
    return false;
}
function cnf_line_WIZKIT(bufp, result) {
    result.wizkit = bufp.slice(0, 127 /* WIZKIT_MAX - 1, hack.h */);
    return true;
}
// QT_* are `nhUse(bufp)` without QT_GRAPHICS.
function cnf_line_QT_TILEWIDTH() { return true; }
function cnf_line_QT_TILEHEIGHT() { return true; }
function cnf_line_QT_FONTSIZE() { return true; }
function cnf_line_QT_COMPACT() { return true; }

// C ref: cfgfiles.c config_line_stmt[] — [name, minimum matching length,
// origbuf, handler].  Matched with match_varname(), which is just
// match_optname(..., val_allowed=TRUE): the text before the '=' or ':' must be
// a case-insensitive leading substring of the name and at least that long, so
// "BIND=" reaches BINDINGS and "SYMB=" reaches SYMBOLS.  Table order breaks ties
// (ROGUESYMBOLS is listed ahead of SYMBOLS).  The syscnf_only entries are left
// out because parse_config_line() skips them unless it is reading sysconf, and
// the USER_SOUNDS pair is absent from this build.
const CONFIG_LINE_STMT = [
    ['OPTIONS', 4, true, cnf_line_OPTIONS],
    ['AUTOPICKUP_EXCEPTION', 5, false, cnf_line_AUTOPICKUP_EXCEPTION],
    ['BINDINGS', 4, false, cnf_line_BINDINGS],
    ['AUTOCOMPLETE', 5, false, cnf_line_AUTOCOMPLETE],
    ['MSGTYPE', 7, false, cnf_line_MSGTYPE],
    ['HACKDIR', 4, false, cnf_line_HACKDIR],
    ['LEVELDIR', 4, false, cnf_line_LEVELDIR],
    ['LEVELS', 4, false, cnf_line_LEVELDIR],
    ['SAVEDIR', 4, false, cnf_line_SAVEDIR],
    ['BONESDIR', 5, false, cnf_line_BONESDIR],
    ['DATADIR', 4, false, cnf_line_DATADIR],
    ['SCOREDIR', 4, false, cnf_line_SCOREDIR],
    ['LOCKDIR', 4, false, cnf_line_LOCKDIR],
    ['CONFIGDIR', 4, false, cnf_line_CONFIGDIR],
    ['TROUBLEDIR', 4, false, cnf_line_TROUBLEDIR],
    ['NAME', 4, false, cnf_line_NAME],
    ['ROLE', 4, false, cnf_line_ROLE],
    ['CHARACTER', 4, false, cnf_line_ROLE],
    ['dogname', 3, false, cnf_line_dogname],
    ['catname', 3, false, cnf_line_catname],
    ['BOULDER', 3, false, cnf_line_BOULDER],
    ['MENUCOLOR', 9, false, cnf_line_MENUCOLOR],
    ['HILITE_STATUS', 6, false, cnf_line_HILITE_STATUS],
    ['WARNINGS', 5, false, cnf_line_WARNINGS],
    ['ROGUESYMBOLS', 4, false, cnf_line_ROGUESYMBOLS],
    ['SYMBOLS', 4, false, cnf_line_SYMBOLS],
    ['WIZKIT', 6, false, cnf_line_WIZKIT],
    ['QT_TILEWIDTH', 12, false, cnf_line_QT_TILEWIDTH],
    ['QT_TILEHEIGHT', 13, false, cnf_line_QT_TILEHEIGHT],
    ['QT_FONTSIZE', 11, false, cnf_line_QT_FONTSIZE],
    ['QT_COMPACT', 10, false, cnf_line_QT_COMPACT],
];

// C ref: cfgfiles.c parse_config_line().  A line that names no statement in
// the table is an ERROR, not a silent skip: config_error_add() puts it on the
// screen and config_error_done() then blocks for a Return, so one unsupported
// rc line costs a whole session's worth of boundaries if it is not modelled.
function parse_config_line(origbuf, result) {
    while (origbuf[0] === ' ' || origbuf[0] === '\t') origbuf = origbuf.slice(1);
    const buf = mungspaces(origbuf);
    const sep = find_optparam(buf);
    if (sep < 0) {
        config_error_add("Not a config statement, missing '='");
        return;
    }
    let bufp = buf.slice(sep + 1);
    if (bufp[0] === ' ') bufp = bufp.slice(1);

    for (const [nm, len, useOrigbuf, fn] of CONFIG_LINE_STMT) {
        if (!match_optname(buf, nm, len, true)) continue;
        fn(useOrigbuf ? origbuf : bufp, result);
        return;
    }

    config_error_add('Unknown config statement');
}

// C ref: cfgfiles.c is_config_section() — " [ section ] # comment", spaces
// optional; returns the section name, or null when the line is not one.
function is_config_section(str) {
    const a = str.trim();
    if (a[0] !== '[') return null;
    const z = a.indexOf(']', 1);
    if (z < 0) return null;
    let c = z + 1;
    while (a[c] === ' ') c++;
    if (c < a.length && a[c] !== '#') return null;
    return a.slice(1, z).trim();
}

// C ref: cfgfiles.c handle_config_section() — returns true when the caller
// should skip the line, either because it IS a section header or because it
// falls inside a section that CHOOSE did not pick.
//
// CHOOSE picks its section with rn2() (choose_random_part()), the first draw of
// the game; jsmain.js seeds the PRNG only after the rc has been read, so the
// pick is left unresolved and section_chosen holds a sentinel that matches no
// header.  That keeps a CHOOSE file off the "without CHOOSE" error path — the
// only part of it that would otherwise cost screens the file has not lost
// already to the missing draw.
const SECTION_UNRESOLVED = '\0unresolved';

function handle_config_section(buf, st) {
    const sect = is_config_section(buf);
    if (sect !== null) {
        st.section_current = null;
        if (!st.section_chosen) {
            config_error_add(`Section "[${sect}]" without CHOOSE`);
            return true;
        }
        if (sect) st.section_current = sect;
        else st.section_chosen = null; /* free_config_sections() */
        return true;
    }
    if (st.section_current) {
        if (!st.section_chosen) return true;
        return st.section_chosen !== st.section_current;
    }
    return false;
}

export function parseNethackrc(rc) {
    const result = {
        name: '', role: -1, race: -1, gender: -1, align: -1,
        flags: {}, iflags: {}, keybind: {}, symoverride: {}, apelist: [],
        warnsyms: [],
        // C globals the config statements below fill in: gm.mapped_menu_cmds /
        // gm.mapped_menu_op, gc.Cmd.spkeys, gc.Cmd.mousebtn, extcmdlist[].flags
        // AUTOCOMPLETE bit, gp.plinemsg_types, gm.menu_colorings, the
        // 'thresholds' lists and condtests[].enabled.
        menu_cmd_alias: [], keybind_param: {}, keyunbind: [], spkeys: {},
        mousebtn: {}, autocomplete: {}, msgtypes: [], menucolors: [],
        status_hilites: [], conds: {},
    };
    if (!rc) return result;

    raw_stream = [];
    reset_duplicate_opt_detection();
    config_error_init('');
    // C ref: cfgfiles.c parse_conf_buf() — trailing spaces/CR are stripped, a
    // trailing '\\' continues onto the next physical line (merged with one
    // space between), and blank / '#' comment lines never reach
    // parse_config_line().  But config_error_nextline() runs for EVERY
    // physical line, so the line number an error reports counts them too.
    const st = { section_current: null, section_chosen: null };
    let pending = null;
    for (const rawLine of rc.split('\n')) {
        let line = rawLine.replace(/[\r]+$/, '');
        const morelines = line.endsWith('\\');
        if (morelines) line = line.slice(0, -1);
        line = line.replace(/[ \t\r]+$/, '');
        config_error_nextline(line);
        const ep = line.replace(/^[ \t]+/, '');
        const ignoreline = !ep || ep[0] === '#';
        const oldline = pending !== null;
        if (!ignoreline) pending = (pending !== null) ? pending + ' ' + ep : ep;
        if (morelines || (ignoreline && !oldline)) continue;
        const buf = pending;
        pending = null;
        if (handle_config_section(buf, st)) continue;
        // C ref: cfgfiles.c parse_conf_buf() CHOOSE branch.
        if (match_optname(buf, 'CHOOSE', 6, true)) {
            if (find_optparam(buf) < 0)
                config_error_add('Format is CHOOSE=section1,section2,...');
            else
                st.section_chosen = SECTION_UNRESOLVED;
            continue;
        }
        parse_config_line(buf, result);
    }
    config_error_done();
    // C ref: sys/unix/unixmain.c process_options() case 'u', which runs after
    // initoptions(): the command line overrides whatever the rc set.  The
    // recording harness derives it from the rc's OPTIONS=name: value and
    // passes an empty string when there is none, so plname ends up being
    // exactly that value and a NAME= statement never reaches the game.
    result.name = result.optname || '';
    if (raw_stream.length) result.config_error_raw = raw_stream;
    raw_stream = null;
    // C ref: options.c gp.plinemsg_types / gm.menu_colorings / gr.rfilter are
    // GLOBALS that parseoptions() fills in as the file is read, and the topline
    // writer, the menu renderer and js/role.js read them from there rather than
    // from a return value.  Publish them the same way.
    if (result.msgtypes.length) {
        game.msgtypes = result.msgtypes;
        game.msgtype_type = msgtype_type;
    }
    if (result.menucolors.length) game.menucolors = result.menucolors;
    if (result.status_hilites.length) game.status_hilites = result.status_hilites;
    if (Object.keys(result.conds).length) game.conds = result.conds;
    if (result.rfilter) game.rfilter = result.rfilter;
    return result;
}

// ---------------------------------------------------------------------------
// Re-exports for js/cfgfiles.js, which continues this file's port of
// cfgfiles.c (the syscnf-only statements, the C-shaped parser, rcfile()).
// Declaration-only: adding names to a module's export list has no effect on
// anything already running here.
export {
    raw_print, wait_synch,
    config_error_init, config_error_add, config_error_done,
    config_error_nextline,
    find_optparam, match_optname, handle_config_section, parse_config_line,
    parseoptions, reset_duplicate_opt_detection,
    CONFIG_LINE_STMT,
    // The coloratt.c helpers that landed here first, for js/coloratt.js (which
    // continues that file's port and must not grow a second copy).
    match_str2clr, match_str2attr, add_menu_coloring_parsed,
};

// ===========================================================================
// options.c functions the port does not reach yet.
//
// Everything below this line is a faithful translation of an options.c
// function that no js/ code calls: the interactive 'O'/#optionsfull handlers,
// the #saveoptions config-file writer, the option-value query API, the
// windowport-capability predicates, and the option-string save/restore used by
// #saveoptions after a role was picked.  They are exported (C names verbatim)
// but DELIBERATELY UNREFERENCED -- js/options.js parses the nethackrc, and an
// rc-parsing change costs a whole session from chargen onward, so nothing above
// may start calling these without being measured on its own.
//
// The C in this section reads and writes `allopt[]` fields that ALLOPT (the
// parsing table, above) does not carry: setwhere, section, opttyp+addr,
// termpref, disregarded.  Those live in the parallel ALLOPT_META below rather
// than in ALLOPT itself.
// ===========================================================================

// C ref: include/optlist.h allopt[].setwhere / .section, with this build's
// #ifdefs resolved -- `name|<setwhere><section>`, setwhere from global.h's
// optset_restrictions (1 sysconf, 2 config, 3 gameview, 4 in_game, 5 wizonly,
// 6 wiznofuz, 7 hidden) and section from OptSection (G/B/M/S/A).  The dozen
// names that appear twice in optlist.h resolve to: WIN32 off (altkeyhandling
// -> set_in_config), ALTMETA on, INSURANCE on, STATUS_HILITES on (hilite_status
// /statushilites -> set_in_game), MACOS9 off, TTY_GRAPHICS on (menu_overlay),
// PREV_MSGS 1 (msg_window), SCORE_ON_BOTL off (showscore -> set_in_config),
// TIMED_DELAY on (config1.h defines MACOS on Apple), SND_SPEECH off (voices ->
// set_gameview/Term_Excluded), CHANGE_COLOR off (palette absent entirely).
// Cross-checked: filtering this table the way option_help() does reproduces
// OPT_BOOL (87) and OPT_COMPOUND (71) exactly.
const ALLOPT_META_DATA = `
    windowtype|3A,playmode|3A,name|3A,role|3A,race|3A,gender|3A,alignment|3A,
    accessiblemsg|4A,acoustics|4A,align_message|3A,align_status|3A,
    altkeyhandling|2A,altmeta|4A,armorstatus|4A,ascii_map|4A,
    autocompletions|4A,autodescribe|4A,autodig|4B,autoopen|4B,autopickup|4B,
    autopickup exceptions|4B,autoquiver|4B,autounlock|4B,bgcolors|4M,
    bind keys|4A,BIOS|2A,blind|2A,bones|2A,boulder|4A,catname|3A,
    checkpoint|4A,cmdassist|4B,color|4M,confirm|4A,crash_email|4A,
    crash_name|4A,crash_urlmax|4A,customcolors|4M,customsymbols|4M,
    dark_room|4A,deaf|2A,DECgraphics|2A,debug_hunger|6A,debug_mongen|6A,
    debug_overwrite_stairs|6A,disclose|4A,dogname|3A,dropped_nopick|4B,
    dungeon|2A,effects|2A,eight_bit_tty|4A,extmenu|4A,female|2A,
    fireassist|4B,fixinv|4A,font_map|3A,font_menu|3A,font_message|3A,
    font_size_map|3A,font_size_menu|3A,font_size_message|3A,
    font_size_status|3A,font_size_text|3A,font_status|3A,font_text|3A,
    force_invmenu|4A,fruit|4G,fullscreen|2A,glyph|4A,goldX|4A,guicolor|4A,
    help|4A,herecmd_menu|4A,hilite_pet|4M,hilite_pile|4M,hilite_status|4A,
    hitpointbar|4S,horsename|3A,IBMgraphics|2A,idlecheckpoint|4A,ignintr|4A,
    implicit_uncursed|4A,legacy|2A,lit_corridor|4A,lootabc|4A,mail|4A,
    map_mode|3A,mention_decor|4A,mention_map|4A,mention_walls|4A,
    menu_deselect_all|2A,menu_deselect_page|2A,menu_first_page|2A,
    menu_headings|4A,menu_invert_all|2A,menu_invert_page|2A,
    menu_last_page|2A,menu_next_page|2A,menu_objsyms|4A,menu_overlay|4A,
    menu_previous_page|2A,menu_search|2A,menu_select_all|2A,
    menu_select_page|2A,menu_shift_left|2A,menu_shift_right|2A,
    menu_tab_sep|5A,menucolors|4A,menu colors|4S,menuinvertmode|4A,
    menustyle|4A,message types|4A,mon_movement|4A,monpolycontrol|5A,
    montelecontrol|5A,monsters|2A,mouse_support|4A,msg_window|4A,
    msghistory|3A,news|2A,nudist|2A,null|4A,number_pad|4G,objects|2A,
    packorder|4A,paranoid_confirmation|4A,pauper|2A,perm_invent|4A,
    perminv_mode|4A,petattr|4A,pettype|3A,pickup_burden|4A,pickup_stolen|4B,
    pickup_thrown|4B,pickup_types|4B,pile_limit|4A,player_selection|3A,
    popup_dialog|4A,preload_tiles|2A,price_quotes|4G,pushweapon|4B,
    query_menu|4A,quick_farsight|4A,rawio|2A,reroll|2A,rest_on_space|4A,
    roguesymset|4A,runmode|4A,safe_pet|4A,safe_wait|4A,sanity_check|5A,
    scores|4A,scroll_amount|3A,scroll_margin|3A,selectsaved|2A,showdamage|4A,
    showexp|4S,showrace|4M,showscore|2S,showvers|4A,silent|4A,
    softkeyboard|2A,sortdiscoveries|4A,sortloot|4A,sortpack|4A,
    sortvanquished|4A,soundlib|3A,sounds|4A,sparkle|4M,spot_monsters|4A,
    splash_screen|2A,standout|4A,status_updates|2A,
    status condition fields|4S,statushilites|4A,status highlight rules|4S,
    statuslines|4S,suppress_alert|4A,symset|4M,term_cols|2A,term_rows|2A,
    terrainstatus|4A,tile_file|3A,tile_height|3A,tile_width|3A,tiled_map|4A,
    time|4S,timed_delay|4M,tips|4A,tombstone|4A,toptenwin|4A,traps|2A,
    travel|4A,travel_debug|5A,tutorial|2A,use_darkgray|2A,use_inverse|4A,
    use_truecolor|2A,vary_msgcount|3A,verbose|4A,versinfo|4A,voices|3A,
    vt_tiledata|2A,vt_sounddata|2A,warnings|2A,weaponstatus|4A,
    whatis_coord|4A,whatis_filter|4A,whatis_menu|4A,whatis_moveskip|4A,
    windowborders|4A,windowcolors|3A,wizmgender|5A,wizweight|5A,wraptext|4A,
    cond_|7A,font|7A`;

// C ref: include/global.h enum optset_restrictions.
const SET_IN_SYSCONF = 1, SET_IN_CONFIG = 2, SET_GAMEVIEW = 3,
      SET_IN_GAME = 4, SET_WIZONLY = 5, SET_WIZNOFUZ = 6, SET_HIDDEN = 7;
// C ref: include/global.h SET__IS_VALUE_VALID() -- note the macro is inverted
// relative to its name: it is TRUE for an OUT-of-range status, which is what
// set_option_mod_status() &c test before complaining.
function SET__IS_VALUE_VALID(s) { return (s < SET_IN_SYSCONF) || (s > SET_WIZNOFUZ); }

// C ref: include/optlist.h enum OptSection.
const OPT_SECTIONS = { G: 0, B: 1, M: 2, S: 3, A: 4 };
// C ref: include/optlist.h enum menu_terminology_preference; every entry in
// this build is Term_False except these five.
const TERM_FALSE = 0, TERM_OFF = 1, TERM_DISABLED = 2, TERM_EXCLUDED = 3;
const ALLOPT_TERMPREF = {
    bgcolors: TERM_OFF, idlecheckpoint: TERM_OFF, perm_invent: TERM_OFF,
    sounds: TERM_OFF, voices: TERM_EXCLUDED,
};

// name -> { setwhere, section, termpref }.  setwhere is writable:
// set_option_mod_status() mutates allopt[].setwhere at run time.
const ALLOPT_META = (() => {
    const m = new Map();
    for (const ent of ALLOPT_META_DATA.split(',')) {
        const t = ent.trim();
        if (!t) continue;
        const bar = t.lastIndexOf('|');
        const name = t.slice(0, bar), sw = t.slice(bar + 1);
        m.set(name, { setwhere: Number(sw[0]), section: OPT_SECTIONS[sw[1]],
                      termpref: ALLOPT_TERMPREF[name] || TERM_FALSE });
    }
    return m;
})();

// C ref: include/optlist.h OPTCOUNT (SIZE(allopt) - 1, the NULL sentinel
// excluded).  ALLOPT holds exactly the same names in the same order.
const OPTCOUNT = ALLOPT.length;

// allopt[optidx].setwhere, for an index into ALLOPT.
function opt_setwhere(optidx) {
    const o = ALLOPT[optidx];
    const meta = o && ALLOPT_META.get(o.name);
    return meta ? meta.setwhere : SET_HIDDEN;
}

// C ref: options.c set_option_mod_status() -- js/wintty.js carries the no-op
// stub the windowport calls; the table mutation it is supposed to perform
// belongs here, next to the table.  str_start_is(name, optnam, TRUE) means the
// FIRST option whose name starts with optnam wins, and the loop then returns.
function allopt_set_setwhere(optnam, status) {
    for (let k = 0; k < OPTCOUNT; k++) {
        if (str_start_is(ALLOPT[k].name, optnam, true)) {
            const meta = ALLOPT_META.get(ALLOPT[k].name);
            if (meta) meta.setwhere = status;
            return;
        }
    }
}

// C ref: options.c allopt[].disregarded -- cfgfiles.c's #saveoptions path turns
// every option off, re-enables just windowtype+soundlib, reads the file, then
// turns them all back on.
let allopt_disregarded = new Array(OPTCOUNT).fill(false);

// C ref: options.c heed_all_options().
export function heed_all_options() {
    for (let i = 0; i < OPTCOUNT; i++) allopt_disregarded[i] = false;
}

// C ref: options.c disregard_all_options().
export function disregard_all_options() {
    for (let i = 0; i < OPTCOUNT; i++) allopt_disregarded[i] = true;
}

// C ref: options.c heed_this_option().
export function heed_this_option(optidx) {
    if (optidx >= 0 && optidx < OPTCOUNT) allopt_disregarded[optidx] = false;
}

// C ref: options.c disregard_this_option().
export function disregard_this_option(optidx) {
    if (optidx >= 0 && optidx < OPTCOUNT) allopt_disregarded[optidx] = true;
}

// ---------------------------------------------------------------------------
// windowport capabilities.  C ref: options.c wc_options[]/wc2_options[] plus
// include/winprocs.h WC_*/WC2_*; the two masks below are win/tty/wintty.c's
// tty_procs.wincap/.wincap2 with this build's #ifdefs resolved (TTY_PERM_INVENT
// off, MSDOS/WIN32CON off, SELECTSAVED on, STATUS_HILITES on, NO_TERMS off).

const WC_COLOR = 0x00000001, WC_HILITE_PET = 0x00000002,
      WC_ASCII_MAP = 0x00000004, WC_TILED_MAP = 0x00000008,
      WC_PRELOAD_TILES = 0x00000010, WC_TILE_WIDTH = 0x00000020,
      WC_TILE_HEIGHT = 0x00000040, WC_TILE_FILE = 0x00000080,
      WC_INVERSE = 0x00000100, WC_ALIGN_MESSAGE = 0x00000200,
      WC_ALIGN_STATUS = 0x00000400, WC_VARY_MSGCOUNT = 0x00000800,
      WC_FONT_MAP = 0x00001000, WC_FONT_MESSAGE = 0x00002000,
      WC_FONT_STATUS = 0x00004000, WC_FONT_MENU = 0x00008000,
      WC_FONT_TEXT = 0x00010000, WC_FONTSIZ_MAP = 0x00020000,
      WC_FONTSIZ_MESSAGE = 0x00040000, WC_FONTSIZ_STATUS = 0x00080000,
      WC_FONTSIZ_MENU = 0x00100000, WC_FONTSIZ_TEXT = 0x00200000,
      WC_SCROLL_MARGIN = 0x00400000, WC_SPLASH_SCREEN = 0x00800000,
      WC_POPUP_DIALOG = 0x01000000, WC_SCROLL_AMOUNT = 0x02000000,
      WC_EIGHT_BIT_IN = 0x04000000, WC_PERM_INVENT = 0x08000000,
      WC_MAP_MODE = 0x10000000, WC_WINDOWCOLORS = 0x20000000,
      WC_PLAYER_SELECTION = 0x40000000, WC_MOUSE_SUPPORT = 0x80000000;

const WC2_FULLSCREEN = 0x0001, WC2_SOFTKEYBOARD = 0x0002,
      WC2_WRAPTEXT = 0x0004, WC2_HILITE_STATUS = 0x0008,
      WC2_SELECTSAVED = 0x0010, WC2_DARKGRAY = 0x0020,
      WC2_HITPOINTBAR = 0x0040, WC2_FLUSH_STATUS = 0x0080,
      WC2_RESET_STATUS = 0x0100, WC2_TERM_SIZE = 0x0200,
      WC2_STATUSLINES = 0x0400, WC2_WINDOWBORDERS = 0x0800,
      WC2_PETATTR = 0x1000, WC2_GUICOLOR = 0x2000,
      WC2_URGENT_MESG = 0x4000, WC2_SUPPRESS_HIST = 0x8000,
      WC2_MENU_SHIFT = 0x010000, WC2_U_UTF8STR = 0x020000,
      WC2_EXTRACOLORS = 0x040000, WC2_EXTRASTATUS = 0x080000;

// C ref: win/tty/wintty.c tty_procs.wincap / .wincap2.
const TTY_WINCAP = WC_COLOR | WC_HILITE_PET | WC_INVERSE | WC_EIGHT_BIT_IN;
const TTY_WINCAP2 = WC2_SELECTSAVED
                  | WC2_HILITE_STATUS | WC2_HITPOINTBAR | WC2_FLUSH_STATUS
                  | WC2_RESET_STATUS
                  | WC2_DARKGRAY | WC2_SUPPRESS_HIST | WC2_URGENT_MESG
                  | WC2_STATUSLINES | WC2_U_UTF8STR | WC2_PETATTR
                  | WC2_EXTRACOLORS | WC2_EXTRASTATUS;

// C ref: options.c wc_options[].
const WC_OPTIONS = [
    ['ascii_map', WC_ASCII_MAP], ['color', WC_COLOR],
    ['eight_bit_tty', WC_EIGHT_BIT_IN], ['hilite_pet', WC_HILITE_PET],
    ['perm_invent', WC_PERM_INVENT],
    ['perminv_mode', WC_PERM_INVENT],   /* shares WC_PERM_INVENT */
    ['popup_dialog', WC_POPUP_DIALOG],
    ['player_selection', WC_PLAYER_SELECTION],
    ['preload_tiles', WC_PRELOAD_TILES], ['tiled_map', WC_TILED_MAP],
    ['tile_file', WC_TILE_FILE], ['tile_width', WC_TILE_WIDTH],
    ['tile_height', WC_TILE_HEIGHT], ['align_message', WC_ALIGN_MESSAGE],
    ['align_status', WC_ALIGN_STATUS], ['font_map', WC_FONT_MAP],
    ['font_menu', WC_FONT_MENU], ['font_message', WC_FONT_MESSAGE],
    ['font_size_map', WC_FONTSIZ_MAP], ['font_size_menu', WC_FONTSIZ_MENU],
    ['font_size_message', WC_FONTSIZ_MESSAGE],
    ['font_size_status', WC_FONTSIZ_STATUS],
    ['font_size_text', WC_FONTSIZ_TEXT], ['font_status', WC_FONT_STATUS],
    ['font_text', WC_FONT_TEXT], ['map_mode', WC_MAP_MODE],
    ['scroll_amount', WC_SCROLL_AMOUNT], ['scroll_margin', WC_SCROLL_MARGIN],
    ['splash_screen', WC_SPLASH_SCREEN], ['use_inverse', WC_INVERSE],
    ['vary_msgcount', WC_VARY_MSGCOUNT], ['windowcolors', WC_WINDOWCOLORS],
    ['mouse_support', WC_MOUSE_SUPPORT],
];

// C ref: options.c wc2_options[].
const WC2_OPTIONS = [
    ['armorstatus', WC2_EXTRASTATUS], ['fullscreen', WC2_FULLSCREEN],
    ['guicolor', WC2_GUICOLOR], ['hilite_status', WC2_HILITE_STATUS],
    ['hitpointbar', WC2_HITPOINTBAR], ['menu_shift', WC2_MENU_SHIFT],
    ['petattr', WC2_PETATTR], ['softkeyboard', WC2_SOFTKEYBOARD],
    /* name shown in 'O' menu is different */
    ['status hilite rules', WC2_HILITE_STATUS],
    /* statushilites doesn't have its own bit */
    ['statushilites', WC2_HILITE_STATUS], ['statuslines', WC2_STATUSLINES],
    ['term_cols', WC2_TERM_SIZE], ['term_rows', WC2_TERM_SIZE],
    ['terrainstatus', WC2_EXTRASTATUS], ['use_darkgray', WC2_DARKGRAY],
    ['weaponstatus', WC2_EXTRASTATUS], ['windowborders', WC2_WINDOWBORDERS],
    ['wraptext', WC2_WRAPTEXT],
];

// C ref: options.c set_wc_option_mod_status().
export function set_wc_option_mod_status(optmask, status) {
    let k = 0;

    if (SET__IS_VALUE_VALID(status)) {
        impossible(`set_wc_option_mod_status: status out of range ${status}.`);
        return;
    }
    while (k < WC_OPTIONS.length) {
        if (optmask & WC_OPTIONS[k][1])
            allopt_set_setwhere(WC_OPTIONS[k][0], status);
        k++;
    }
}

// C ref: options.c set_wc2_option_mod_status().  NOTE js/wintty.js also has a
// `set_wc2_option_mod_status` -- a FILE-LOCAL no-op stub for the windowport's
// own init calls, next to its set_option_mod_status stub.  This is the real
// options.c function; nothing reaches across, but do not "dedupe" them.
export function set_wc2_option_mod_status(optmask, status) {
    let k = 0;

    if (SET__IS_VALUE_VALID(status)) {
        impossible(`set_wc2_option_mod_status: status out of range ${status}.`);
        return;
    }
    while (k < WC2_OPTIONS.length) {
        if (optmask & WC2_OPTIONS[k][1])
            allopt_set_setwhere(WC2_OPTIONS[k][0], status);
        k++;
    }
}

// C ref: options.c is_wc_option().
export function is_wc_option(optnam) {
    let k = 0;
    while (k < WC_OPTIONS.length) {
        if (WC_OPTIONS[k][0] === optnam) return true;
        k++;
    }
    return false;
}

// C ref: options.c wc_supported().
export function wc_supported(optnam) {
    for (let k = 0; k < WC_OPTIONS.length; ++k)
        if (WC_OPTIONS[k][0] === optnam)
            return (TTY_WINCAP & WC_OPTIONS[k][1]) ? true : false;
    return false;
}

// C ref: options.c is_wc2_option().
export function is_wc2_option(optnam) {
    let k = 0;
    while (k < WC2_OPTIONS.length) {
        if (WC2_OPTIONS[k][0] === optnam) return true;
        k++;
    }
    return false;
}

// C ref: options.c wc2_supported().
export function wc2_supported(optnam) {
    for (let k = 0; k < WC2_OPTIONS.length; ++k)
        if (WC2_OPTIONS[k][0] === optnam)
            return (TTY_WINCAP2 & WC2_OPTIONS[k][1]) ? true : false;
    return false;
}

// C ref: include/winprocs.h MAP_OPTION &c, the wc_set_font_name() selector.
const MAP_OPTION = 0, MESSAGE_OPTION = 1, STATUS_OPTION = 2, TEXT_OPTION = 3,
      MENU_OPTION = 4;

// C ref: options.c wc_set_font_name().  No tty font is settable, so the fields
// only ever feed all_options_strbuf()'s font_* lines back out again.
export function wc_set_font_name(opttype, fontname) {
    let fn = null;

    if (!fontname) return;
    game.iflags = game.iflags || {};
    switch (opttype) {
    case MAP_OPTION:     fn = 'wc_font_map'; break;
    case MESSAGE_OPTION: fn = 'wc_font_message'; break;
    case TEXT_OPTION:    fn = 'wc_font_text'; break;
    case MENU_OPTION:    fn = 'wc_font_menu'; break;
    case STATUS_OPTION:  fn = 'wc_font_status'; break;
    default:
        return;
    }
    if (fn) game.iflags[fn] = fontname;
}

// C ref: options.c options_free_window_colors() -- iflags.wcolors[][fg,bg] and
// the options_set_window_colors_flag that wc_set_window_colors() sets.
export function options_free_window_colors() {
    const wc = game.iflags && game.iflags.wcolors;
    for (let j = 0; j < WCNAMES.length; ++j) {
        if (!wc || !wc[j]) continue;
        if (wc[j].fg) wc[j].fg = null;
        if (wc[j].bg) wc[j].bg = null;
    }
    if (game.iflags) game.iflags.options_set_window_colors_flag = 0;
}

// ---------------------------------------------------------------------------
// roleoptvals[][] -- the unparsed role/race/gender/alignment strings, kept per
// option phase so #saveoptions can write out what the player actually typed
// ("Valkyrie", "random", "@") rather than the resolved index.
// C ref: options.c:110 `enum { MAX_ROLEOPT = 4 }` and roleoptvals[4][7].

const MAX_ROLEOPT = 4;
// C ref: include/global.h enum option_phases.  phase_not_set is 0, so the
// array has num_opt_phases (7) slots and slot 0 is never used.
const PHASE_NOT_SET = 0, BUILTIN_OPT = 1, SYSCF_OPT = 2, RC_FILE_OPT = 3,
      ENVIRON_OPT = 4, CMDLINE_OPT = 5, PLAY_OPT = 6, NUM_OPT_PHASES = 7;

// C ref: decl.h go.opt_phase -- which source is being parsed right now.
let opt_phase = PHASE_NOT_SET;

const roleoptvals = Array.from({ length: MAX_ROLEOPT },
                              () => new Array(NUM_OPT_PHASES).fill(null));

// C ref: options.c roleopt2opt[4].
const roleopt2opt = ['role', 'race', 'gender', 'alignment'];

// C ref: options.c opt2roleopt() -- role => 0, race => 1, gender => 2,
// alignment => 3.  `optidx` is an option NAME here: ALLOPT is indexed by
// position, and the C enum values are not reproduced in this port.
export function opt2roleopt(roleopt) {
    switch (roleopt) {
    case 'role':      return 0;
    case 'race':      return 1;
    case 'gender':    return 2;
    case 'alignment': return 3;
    default:          break;
    }
    return 0;
}

// C ref: options.c getoptstr() -- fetch the saved string for one phase, or for
// ophase == num_opt_phases the highest-priority non-Null one.
export function getoptstr(optidx, ophase) {
    const roleoptindx = opt2roleopt(optidx);

    if (ophase === NUM_OPT_PHASES) { /* any source */
        /* find non-Null, in order optvals[][play_opt], [cmdline_opt],
           [environ_opt], [rc_file_opt], [syscf_opt], [builtin_opt] */
        for (let phase = NUM_OPT_PHASES - 1; phase >= 0; --phase)
            if (roleoptvals[roleoptindx][phase]) {
                ophase = phase;
                break;
            }
    }
    if (roleoptindx >= 0 && roleoptindx < MAX_ROLEOPT
        && ophase >= 0 && ophase < NUM_OPT_PHASES)
        return roleoptvals[roleoptindx][ophase];
    panic(`bad index roleoptvals[${roleoptindx}][${ophase}]`);
    /*NOTREACHED*/
    return null;
}

// C ref: options.c saveoptstr() -- strips "optname:" (or "optname=", whichever
// comes first) off the front and keeps the rest for go.opt_phase.
export function saveoptstr(optidx, optstr) {
    const phase = opt_phase, roleoptindx = opt2roleopt(optidx);
    let p = optstr.indexOf(':');
    const q = optstr.indexOf('=');

    if (p < 0 || (q >= 0 && q < p)) p = q;
    if (p >= 0) optstr = optstr.slice(p + 1);

    roleoptvals[roleoptindx][phase] = optstr;
}

// C ref: options.c unsaveoptstr().
export function unsaveoptstr(optidx, ophase) {
    const roleoptindx = opt2roleopt(optidx);

    if (roleoptvals[roleoptindx][ophase])
        roleoptvals[roleoptindx][ophase] = null;
}

// C ref: options.c freeroleoptvals().
export function freeroleoptvals() {
    for (let i = 0; i < 4; ++i)
        for (let j = 0; j < NUM_OPT_PHASES; ++j)
            unsaveoptstr(roleopt2opt[i], j);
}

// C ref: options.c saveoptvals() -- inside `#if 0 /* not needed */`, kept for
// the day #saveoptions can run after a restore.  js/storage.js owns the save
// format, so this writes the same [4][num_opt_phases] shape into the caller's
// record instead of emitting Sfo_ fields.
export function saveoptvals(nhfp) {
    if (update_file(nhfp)) {
        for (let i = 0; i < 4; ++i)
            for (let j = 0; j < NUM_OPT_PHASES; ++j) {
                const val = roleoptvals[i][j];
                const len = val ? val.length + 1 : 0;
                nhfp.optvals = nhfp.optvals || [];
                nhfp.optvals.push(len);
                if (val) nhfp.optvals.push(val);
            }
    }
    if (release_data(nhfp)) freeroleoptvals();
}

// C ref: options.c restoptvals() -- the read side of the above.
export function restoptvals(nhfp) {
    if (nhfp.structlevel) {
        const src = nhfp.optvals || [];
        let k = 0;
        for (let i = 0; i < 4; ++i)
            for (let j = 0; j < NUM_OPT_PHASES; ++j) {
                /* len includes terminating '\0' for non-Null values */
                const len = src[k++];
                if (len) roleoptvals[i][j] = src[k++];
                else roleoptvals[i][j] = null;
            }
    }
}

// C ref: options.c get_cnf_role_opt() -- the value to write into a new config
// file: skip the command line, the environment and the compiled-in default,
// highest phase first.
export function get_cnf_role_opt(optidx) {
    let op = null;

    for (let phase = NUM_OPT_PHASES - 1; phase >= 0 && !op; --phase) {
        if (phase === CMDLINE_OPT || phase === ENVIRON_OPT
            || phase === BUILTIN_OPT)
            continue;
        op = getoptstr(optidx, phase);
    }
    return op;
}

// C ref: sfstruct.c update_file()/release_data() -- the NHFILE mode tests
// saveoptvals() gates on.  js/storage.js owns the real save file; these read
// the same two mode flags off whatever record the caller passes.
function update_file(nhfp) { return !!(nhfp && nhfp.mode & 0x02 /* WRITING */); }
function release_data(nhfp) { return !!(nhfp && nhfp.mode & 0x04 /* FREEING */); }

// C ref: panic.c panic() -- unrecoverable; the port has no equivalent, so
// report through raw_print() and throw rather than continuing with bad state.
function panic(msg) {
    raw_print(`panic: ${msg}`);
    throw new Error(`panic: ${msg}`);
}

// ---------------------------------------------------------------------------
// A menu collector for the handler_*() ports below.
//
// C ref: the windowport menu API (create_nhwindow(), start_menu(), add_menu(),
// end_menu(), select_menu(), destroy_nhwindow()).  js/ has no windowport
// abstraction -- every ported menu drives frozen/terminal.js directly, see
// js/doset.js -- so these build the exact item list C would have built and
// hand it to OPT_MENU_DRIVER.  With no driver installed select_menu() reports
// -1, "player hit ESC", which is the one answer that changes nothing.

const NHW_MENU = 4, NHW_TEXT = 5;                 /* wintype.h */
const PICK_NONE = 0, PICK_ONE = 1, PICK_ANY = 2;  /* wintype.h */
const MENU_BEHAVE_STANDARD = 0;                   /* wintype.h */
const MENU_ITEMFLAGS_NONE = 0x0, MENU_ITEMFLAGS_SELECTED = 0x1,
      MENU_ITEMFLAGS_SKIPINVERT = 0x2;

// Install `select` (win, how) -> array of picked `any` values, or null/-1 for
// ESC; `getlin` (prompt) -> string ('\033' for ESC) to drive these for real.
export const OPT_MENU_DRIVER = { select: null, getlin: null };

function create_nhwindow(type) {
    return { type, items: [], query: '', lines: [] };
}
function destroy_nhwindow(_win) { }
function start_menu(win, behave) { win.items.length = 0; win.behave = behave; }
function add_menu(win, _glyphinfo, any, accel, gacc, attr, clr, str, itemflags) {
    win.items.push({ any, accel, gacc, attr, clr, str, itemflags,
                     selectable: any !== null && any !== undefined });
}
function add_menu_str(win, str) {
    win.items.push({ any: null, str, selectable: false });
}
function add_menu_heading(win, str) {
    win.items.push({ any: null, str, heading: true, selectable: false });
}
function end_menu(win, query) { win.query = query; }
function putstr(win, _attr, str) { win.lines.push(str); }

// Returns C's select_menu() count: >0 picked, 0 picked-nothing-but-confirmed,
// -1 cancelled.  `picks` is the menu_item** out-param.
async function select_menu(win, how, picks) {
    if (!OPT_MENU_DRIVER.select) return -1;
    const got = await OPT_MENU_DRIVER.select(win, how);
    if (!got || got === -1) return -1;
    for (const g of got) picks.push(g);
    return picks.length;
}

// C ref: getlin() -- returns the typed line, or "\033" when ESC'd.
async function getlin(prompt) {
    if (!OPT_MENU_DRIVER.getlin) return '\x1b';
    return await OPT_MENU_DRIVER.getlin(prompt);
}

// The port's stand-ins for the side effects C's handlers trigger.  Each is a
// genuine no-op FOR THIS BUILD, not a deferral:
//   update_inventory()          -- TTY_PERM_INVENT is undefined, so there is
//                                  no persistent inventory window to refresh.
//   adjust_menu_promptstyle()   -- ditto (it restyles WIN_INVEN's header).
//   perm_invent_toggled()       -- ditto.
//   check_tty_wincap()          -- tty_procs.wincap lacks WC_PERM_INVENT.
//   number_pad()/reset_commands() -- js/cmd.js owns key dispatch and rebuilds
//                                  it from game.flags on the next command.
function update_inventory() { }
function adjust_menu_promptstyle(_win, _ca) { }
function perm_invent_toggled(_negated) { }
function check_tty_wincap(_bit) { return false; }
function number_pad(_state) { }
function reset_commands(_initial) { }

// ---------------------------------------------------------------------------
// The static tables options.c's handlers display.  ALLOPT and the optfn_*
// parsers above only needed the option NAMES; the menus also need the
// per-choice explanations, so those columns live here.

// C ref: options.c menutype[][3] -- 'menustyle' settings.
const MENUTYPE = [
    ['traditional', '[prompt for object class(es), then',
                    ' ask y/n for each item in those classes]'],
    ['combination', '[prompt for object class(es), then',
                    ' use menu for items in those classes]'],
    ['full',        '[use menu to choose class(es), then',
                    ' use another menu for items in those]'],
    ['partial',     '[skip class filtering; always',
                    ' use menu of all available items]'],
];

// C ref: options.c msgwind[][3] -- 'msg_window' settings (PREV_MSGS is 1 for
// tty, which supports all four).
const MSGWIND = [
    ['single',      '[show one old message at a time,',
                    ' most recent first]'],
    ['combination', '[for consecutive ^P requests, use',
                    " 'single' for first two, then 'full']"],
    ['full',        '[show all available messages,',
                    ' oldest first and most recent last]'],
    ['reversed',    '[show all available messages,',
                    ' most recent first]'],
];

// C ref: options.c unlocktypes[][2] -- the second column UNLOCKTYPES lacks.
const UNLOCKTYPE_DESCR = ['(might fail)', '', '(doors only)',
                          '(chests/boxes only)'];

// C ref: options.c burdentype[], runmodes[], sortltype[].
const BURDENTYPE = ['unencumbered', 'burdened', 'stressed',
                    'strained', 'overtaxed', 'overloaded'];
const RUNMODES = ['teleport', 'run', 'walk', 'crawl'];
const SORTLTYPE = ['none', 'loot', 'full'];

// C ref: options.c perminv_modes[][2] (the third column; PERMINV_MODES above
// carries the name and its alias).  Entries 5/6 are TTY_PERM_INVENT-only and
// so are NULL in this build.
const PERMINV_MODE_DESCR = [
    'no permanent inventory window', 'all inventory except for gold',
    'full inventory including gold', null, null, null, null, null,
    'subset: items currently in use',
];

// C ref: options.c objsymvals[].descr (OBJSYMVALS above is the .nam column).
const OBJSYMVAL_DESCR = [
    "don't show object symbols in menus",
    'show object symbols in menu header lines',
    'show object symbols in individual menu entries',
    'show object symbols in headers and menu entries',
    'show objsyms in entries if no headers are shown',
    'show objsyms in header, in entries if no header',
];

// C ref: options.c paranoia[].explain (PARANOIA above stops at synMinLen).
const PARANOIA_EXPLAIN = [
    'for "yes" confirmations, require "no" to reject',
    'yes vs y to quit or to enter explore mode',
    'yes vs y to die (explore mode or debug mode)',
    'yes vs y to save bones data when dying in debug mode',
    'yes vs y to attack a peaceful monster',
    'yes vs y to break a wand via (a)pply',
    'yes vs y to continue eating after first bite when satiated',
    'yes vs y to change form when lycanthropy is controllable',
    'y required to pray (supersedes old "prayconfirm" option)',
    'y required to enter known trap unless considered harmless',
    "y required to pick filter choice 'A' for menustyle:Full",
    "'m' prefix necessary to deliberately walk into lava or water",
    'always pick from inventory for Remove and Takeoff',
    null, null,   /* "none" and "all": config-file only, no menu entry */
];
const PARANOID_BONES = 0x0008; /* flag.h; handler skips it outside wizard mode */

// C ref: options.c default_menu_cmd_info[].desc (DEFAULT_MENU_CMD_INFO above
// is the .name/.cmd columns).
const DEFAULT_MENU_CMD_DESC = [
    'Go to next page', 'Go to previous page', 'Go to first page',
    'Go to last page', 'Select all items in entire menu',
    'Invert selection for all items', 'Unselect all items in entire menu',
    'Select all items on current page', "Invert current page's selections",
    'Unselect all items on current page', 'Search and invert matching items',
    'Pan current page to right (perm_invent only)',
    'Pan current page to left (perm_invent only)',
];

// C ref: include/flag.h DISCLOSE_*, NUM_DISCLOSURE_OPTIONS.
const NUM_DISCLOSURE_OPTIONS = 6;
const DISCLOSE_PROMPT_DEFAULT_YES = 'y', DISCLOSE_PROMPT_DEFAULT_NO = 'n',
      DISCLOSE_PROMPT_DEFAULT_SPECIAL = '?', DISCLOSE_YES_WITHOUT_PROMPT = '+',
      DISCLOSE_NO_WITHOUT_PROMPT = '-', DISCLOSE_SPECIAL_WITHOUT_PROMPT = '#';
// C ref: include/winprocs.h ALIGN_*.
const ALIGN_LEFT = 1, ALIGN_RIGHT = 2, ALIGN_TOP = 3, ALIGN_BOTTOM = 4;
// C ref: include/flag.h GPCOORDS_*, GFILTER_*.
const GPCOORDS_NONE = 'n', GPCOORDS_MAP = 'm', GPCOORDS_COMPASS = 'c',
      GPCOORDS_COMFULL = 'f', GPCOORDS_SCREEN = 's';
const GFILTER_NONE = 0, GFILTER_VIEW = 1, GFILTER_AREA = 2;
// C ref: include/flag.h VI_*.
const VI_NUMBER = 1, VI_NAME = 2, VI_BRANCH = 4;
// C ref: include/wintype.h InvOpt* / InvSparse.
const InvOptNone = 0, InvOptOn = 1, InvSparse = 4;
// C ref: include/global.h COLNO/ROWNO.
const COLNO = 80, ROWNO = 21;

// C ref: options.c:108 `static boolean give_opt_msg = TRUE` -- doset_simple()
// clears it around its handler calls so the simple menu stays quiet.
let give_opt_msg = true;

// ---------------------------------------------------------------------------
// handler_*() -- the per-option interactive setters the 'O' menus dispatch to.
// Each is async because the port's input is: C's select_menu()/getlin() block,
// ours awaits.  All return optn_ok (or the sub-handler's result).

// C ref: options.c handler_menustyle().  flags.menu_style is a 0..3 index in C;
// the port keeps the same setting as game.flags.menustyle, the option value's
// first letter, which js/pickup.js menu_style() maps to MENU_*.
export async function handler_menustyle() {
    let tmpwin, chngd, i, n;
    game.flags = game.flags || {};
    const old_menu_style = menustyle_index();
    let buf, sep = (game.iflags && game.iflags.menu_tab_sep) ? '\t' : ' ';
    const style_pick = [];
    const clr = NO_COLOR;

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    for (i = 0; i < MENUTYPE.length; i++) {
        buf = `${padtrunc(MENUTYPE[i][0], 12)}${sep}${MENUTYPE[i][1].slice(0, 60)}`;
        add_menu(tmpwin, null, { a_int: i + 1 }, buf[0], 0, ATR_NONE, clr, buf,
                 (i === old_menu_style) ? MENU_ITEMFLAGS_SELECTED
                                        : MENU_ITEMFLAGS_NONE);
        /* second line is prefixed by spaces that "c - " would use */
        buf = `${' '.repeat(4)}${' '.repeat(12)}${sep}${MENUTYPE[i][2].slice(0, 60)}`;
        add_menu_str(tmpwin, buf);
    }
    end_menu(tmpwin, 'Select menustyle:');
    n = await select_menu(tmpwin, PICK_ONE, style_pick);
    if (n > 0) {
        i = style_pick[0].a_int - 1;
        /* if there are two picks, use the one that wasn't pre-selected */
        if (n > 1 && i === old_menu_style) i = style_pick[1].a_int - 1;
        game.flags.menustyle = MENUTYPE[i][0][0];
    }
    destroy_nhwindow(tmpwin);
    chngd = (menustyle_index() !== old_menu_style);
    if (chngd || game.flags.verbose)
        await pline(`'menustyle' ${chngd ? 'changed to' : 'is still'} `
                    + `"${MENUTYPE[menustyle_index()][0]}".`);
    return OPTN_OK;
}

// flags.menu_style as C sees it, recovered from the port's letter.  Default is
// MENU_FULL (initoptions_init(): `flags.menu_style = MENU_FULL`).
function menustyle_index() {
    const c = lowc(String((game.flags && game.flags.menustyle) || 'f')[0]);
    switch (c) {
    case 't': return 0;
    case 'c': return 1;
    case 'f': return 2;
    case 'p': return 3;
    default:  return 2;
    }
}

// C's "%-N.Ns": pad to n, truncate at n.
function padtrunc(s, n) { return String(s).slice(0, n).padEnd(n, ' '); }

// C ref: options.c handler_align_misc() -- shared by align_message and
// align_status; `optidx` is the option NAME in this port.
export async function handler_align_misc(optidx) {
    let tmpwin, abuf;
    const window_pick = [];
    const clr = NO_COLOR;

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    add_menu(tmpwin, null, { a_int: ALIGN_TOP }, 't', 0, ATR_NONE, clr, 'top',
             MENU_ITEMFLAGS_NONE);
    add_menu(tmpwin, null, { a_int: ALIGN_BOTTOM }, 'b', 0, ATR_NONE, clr,
             'bottom', MENU_ITEMFLAGS_NONE);
    add_menu(tmpwin, null, { a_int: ALIGN_LEFT }, 'l', 0, ATR_NONE, clr, 'left',
             MENU_ITEMFLAGS_NONE);
    add_menu(tmpwin, null, { a_int: ALIGN_RIGHT }, 'r', 0, ATR_NONE, clr,
             'right', MENU_ITEMFLAGS_NONE);
    abuf = 'Select ' + ((optidx === 'align_message') ? 'message' : 'status')
           + ' window placement relative to the map:';
    end_menu(tmpwin, abuf);
    if (await select_menu(tmpwin, PICK_ONE, window_pick) > 0) {
        game.iflags = game.iflags || {};
        if (optidx === 'align_message')
            game.iflags.wc_align_message = window_pick[0].a_int;
        else
            game.iflags.wc_align_status = window_pick[0].a_int;
    }
    destroy_nhwindow(tmpwin);
    return OPTN_OK;
}

// C ref: options.c handler_autounlock() -- PICK_ANY over unlocktypes[]; n == 0
// (everything deselected) means 'none'.
export async function handler_autounlock(optidx) {
    let tmpwin, chngd, i, n, presel, buf;
    game.flags = game.flags || {};
    const oldflags = game.flags.autounlock | 0;
    const optname = optidx;
    const sep = (game.iflags && game.iflags.menu_tab_sep) ? '\t' : ' ';
    const window_pick = [];
    const res = OPTN_OK;
    const clr = NO_COLOR;

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    for (i = 0; i < UNLOCKTYPES.length; ++i) {
        buf = `${padtrunc(UNLOCKTYPES[i], 10)}${sep}`
              + UNLOCKTYPE_DESCR[i].slice(0, 40);
        presel = (game.flags.autounlock & (1 << i));
        add_menu(tmpwin, null, { a_int: i + 1 }, UNLOCKTYPES[i][0], 0,
                 ATR_NONE, clr, buf,
                 presel ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
    }
    end_menu(tmpwin, `Select '${optname.slice(0, 20)}' actions:`);
    n = await select_menu(tmpwin, PICK_ANY, window_pick);
    if (n > 0) {
        let newflags = 0;

        for (i = 0; i < n; ++i) newflags |= (1 << (window_pick[i].a_int - 1));
        game.flags.autounlock = newflags;
    } else if (n === 0) { /* nothing was picked but menu wasn't cancelled */
        /* something that was preselected got unselected, leaving nothing;
           treat that as picking 'none' (even though 'none' is no longer
           among the choices) */
        game.flags.autounlock = 0;
    }
    destroy_nhwindow(tmpwin);
    chngd = (game.flags.autounlock !== oldflags);
    if ((chngd || game.flags.verbose) && give_opt_msg) {
        /* C: optfn_autounlock(optidx, get_val, ...) -- the port's optfn_*()
           have no get_val mode, so build the same comma list here. */
        buf = autounlock_val();
        await pline(`'${optname}' ${chngd ? 'changed to' : 'is still'} `
                    + `'${buf}'.`);
    }
    return res;
}

// C ref: options.c optfn_autounlock()'s get_val arm: "none" or the enabled
// unlocktypes[] names joined with '+'.
function autounlock_val() {
    const bits = (game.flags && game.flags.autounlock) | 0;
    if (!bits) return 'none';
    const parts = [];
    for (let i = 0; i < UNLOCKTYPES.length; ++i)
        if (bits & (1 << i)) parts.push(UNLOCKTYPES[i]);
    return parts.join('+');
}

// C ref: options.c handler_disclose() -- a category menu, then one sub-menu per
// picked category.  disclosure_names[] order matches decl.c
// disclosure_options[] ("iavgco").
export async function handler_disclose() {
    let tmpwin, i, n, buf;
    const disclosure_names = ['inventory', 'attributes', 'vanquished',
                              'genocides', 'conduct', 'overview'];
    const disc_cat = new Array(NUM_DISCLOSURE_OPTIONS).fill(0);
    let pick_cnt, pick_idx, opt_idx, c;
    let disclosure_pick = [];
    const clr = NO_COLOR;
    game.flags = game.flags || {};
    const end_disclose = (game.flags.end_disclose = game.flags.end_disclose
        || new Array(NUM_DISCLOSURE_OPTIONS).fill(DISCLOSE_PROMPT_DEFAULT_NO));

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    for (i = 0; i < NUM_DISCLOSURE_OPTIONS; i++) {
        buf = `${String(disclosure_names[i]).padEnd(12, ' ')}`
              + `[${end_disclose[i]}${DISCLOSURE_OPTIONS[i]}]`;
        add_menu(tmpwin, null, { a_int: i + 1 }, DISCLOSURE_OPTIONS[i],
                 0, ATR_NONE, clr, buf, MENU_ITEMFLAGS_NONE);
        disc_cat[i] = 0;
    }
    end_menu(tmpwin, 'Change which disclosure options categories:');
    pick_cnt = await select_menu(tmpwin, PICK_ANY, disclosure_pick);
    if (pick_cnt > 0) {
        for (pick_idx = 0; pick_idx < pick_cnt; ++pick_idx) {
            opt_idx = disclosure_pick[pick_idx].a_int - 1;
            disc_cat[opt_idx] = 1;
        }
        disclosure_pick = [];
    }
    destroy_nhwindow(tmpwin);

    for (i = 0; i < NUM_DISCLOSURE_OPTIONS; i++) {
        if (disc_cat[i]) {
            c = end_disclose[i];
            buf = `Disclosure options for ${disclosure_names[i]}:`;
            tmpwin = create_nhwindow(NHW_MENU);
            start_menu(tmpwin, MENU_BEHAVE_STANDARD);
            /* 'y','n',and '+' work as alternate selectors; '-' doesn't */
            add_menu(tmpwin, null, { a_char: DISCLOSE_NO_WITHOUT_PROMPT }, 0,
                     DISCLOSE_NO_WITHOUT_PROMPT, ATR_NONE, clr,
                     'Never disclose, without prompting',
                     (c === DISCLOSE_NO_WITHOUT_PROMPT)
                         ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
            add_menu(tmpwin, null, { a_char: DISCLOSE_YES_WITHOUT_PROMPT }, 0,
                     DISCLOSE_YES_WITHOUT_PROMPT, ATR_NONE, clr,
                     'Always disclose, without prompting',
                     (c === DISCLOSE_YES_WITHOUT_PROMPT)
                         ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
            if (disclosure_names[i][0] === 'v'
                || disclosure_names[i][0] === 'g') {
                add_menu(tmpwin, null,
                         { a_char: DISCLOSE_SPECIAL_WITHOUT_PROMPT }, 0,
                         DISCLOSE_SPECIAL_WITHOUT_PROMPT, ATR_NONE, clr,
                         'Always disclose, pick sort order from menu',
                         (c === DISCLOSE_SPECIAL_WITHOUT_PROMPT)
                             ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
            }
            add_menu(tmpwin, null, { a_char: DISCLOSE_PROMPT_DEFAULT_NO }, 0,
                     DISCLOSE_PROMPT_DEFAULT_NO, ATR_NONE, clr,
                     'Prompt, with default answer of "No"',
                     (c === DISCLOSE_PROMPT_DEFAULT_NO)
                         ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
            add_menu(tmpwin, null, { a_char: DISCLOSE_PROMPT_DEFAULT_YES }, 0,
                     DISCLOSE_PROMPT_DEFAULT_YES, ATR_NONE, clr,
                     'Prompt, with default answer of "Yes"',
                     (c === DISCLOSE_PROMPT_DEFAULT_YES)
                         ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
            if (disclosure_names[i][0] === 'v'
                || disclosure_names[i][0] === 'g') {
                add_menu(tmpwin, null,
                         { a_char: DISCLOSE_PROMPT_DEFAULT_SPECIAL }, 0,
                         DISCLOSE_PROMPT_DEFAULT_SPECIAL, ATR_NONE, clr,
                         'Prompt, with default answer of "Ask" to request sort menu',
                         (c === DISCLOSE_PROMPT_DEFAULT_SPECIAL)
                             ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
            }
            end_menu(tmpwin, buf);
            disclosure_pick = [];
            n = await select_menu(tmpwin, PICK_ONE, disclosure_pick);
            if (n > 0) {
                end_disclose[i] = disclosure_pick[0].a_char;
                if (n > 1 && end_disclose[i] === c)
                    end_disclose[i] = disclosure_pick[1].a_char;
            }
            destroy_nhwindow(tmpwin);
        }
    }
    return OPTN_OK;
}

// C ref: options.c handler_menu_headings().  query_color_attr() lives in
// js/coloratt.js, which imports THIS file, so it is pulled in on demand.
export async function handler_menu_headings() {
    game.iflags = game.iflags || {};
    const ca = game.iflags.menu_headings
        || (game.iflags.menu_headings = { attr: ATR_INVERSE,
                                          color: NO_COLOR_IDX });
    const { query_color_attr } = await import('./coloratt.js');
    const gotca = await query_color_attr(ca, 'How to highlight menu headings:');

    if (gotca) {
        /* header highlighting affects persistent inventory display */
        if (game.iflags.perm_invent) update_inventory();
    }
    adjust_menu_promptstyle(null, ca);
    return OPTN_OK;
}

// C ref: options.c handler_menu_objsyms().
export async function handler_menu_objsyms() {
    let tmpwin, buf, i, j, n;
    const picklist = [];
    const sep = (game.iflags && game.iflags.menu_tab_sep) ? '\t' : ' ';
    const clr = NO_COLOR;
    game.iflags = game.iflags || {};

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    for (i = 0; i < OBJSYMVALS.length; ++i) {
        buf = `${padtrunc(OBJSYMVALS[i], 12)}${sep}`
              + OBJSYMVAL_DESCR[i].slice(0, 60);
        j = i; /* objsymvals[i].num == i for every row */
        add_menu(tmpwin, null, { a_int: i + 1 },
                 String.fromCharCode(48 + i), buf[0], ATR_NONE, clr, buf,
                 (j === game.iflags.menuobjsyms) ? MENU_ITEMFLAGS_SELECTED
                                                 : MENU_ITEMFLAGS_NONE);
    }
    end_menu(tmpwin, 'Set object symbols in menus to what?');
    n = await select_menu(tmpwin, PICK_ONE, picklist);
    if (n > 0) {
        i = picklist[0].a_int - 1;
        /* if there are two picks, use the one that wasn't pre-selected */
        if (n > 1 && i === game.iflags.menuobjsyms) i = picklist[1].a_int - 1;
        set_menuobjsyms_flags(i, { iflags: game.iflags });
    }
    destroy_nhwindow(tmpwin);
    return OPTN_OK;
}

// C ref: options.c handler_msg_window() -- PREV_MSGS is 1 and this is the tty,
// so the "not supported" arm is unreachable here.  Note C's loop bound is
// SIZE(menutype), not SIZE(msgwind) (they are both 4).
export async function handler_msg_window() {
    let tmpwin;
    const is_curses = false, is_tty = true;   /* WINDOWPORT(tty) */
    const clr = NO_COLOR;

    if (is_tty || is_curses) {
        /* by Christian W. Cooper */
        let chngd, i, n, buf, c;
        const sep = (game.iflags && game.iflags.menu_tab_sep) ? '\t' : ' ';
        game.iflags = game.iflags || {};
        const old_prevmsg_window = game.iflags.prevmsg_window;
        const window_pick = [];

        tmpwin = create_nhwindow(NHW_MENU);
        start_menu(tmpwin, MENU_BEHAVE_STANDARD);

        for (i = 0; i < MENUTYPE.length; i++) {
            if (i < 2 && is_curses) continue;
            buf = `${padtrunc(MSGWIND[i][0], 12)}${sep}`
                  + MSGWIND[i][1].slice(0, 60);
            c = MSGWIND[i][0][0];
            add_menu(tmpwin, null, { a_char: c }, buf[0], 0,
                     ATR_NONE, clr, buf,
                     (c === game.iflags.prevmsg_window)
                         ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
            /* second line is prefixed by spaces that "c - " would use */
            buf = `${' '.repeat(4)}${' '.repeat(12)}${sep}`
                  + MSGWIND[i][2].slice(0, 60);
            add_menu_str(tmpwin, buf);
        }
        end_menu(tmpwin, 'Select message history display type:');
        n = await select_menu(tmpwin, PICK_ONE, window_pick);
        if (n > 0) {
            c = window_pick[0].a_char;
            /* if there are two picks, use the one that wasn't pre-selected */
            if (n > 1 && c === old_prevmsg_window) c = window_pick[1].a_char;
            game.iflags.prevmsg_window = c;
        }
        destroy_nhwindow(tmpwin);
        chngd = (game.iflags.prevmsg_window !== old_prevmsg_window);
        if (chngd || (game.flags && game.flags.verbose)) {
            /* C: optfn_msg_window(..., get_val, ...); the value is the full
               msgwind[] name for the stored letter. */
            buf = msg_window_val();
            await pline(`'msg_window' ${chngd ? 'changed to' : 'is still'} `
                        + `"${buf.slice(0, 20)}".`);
        }
    }
    return OPTN_OK;
}

// C ref: options.c optfn_msg_window()'s get_val arm.
function msg_window_val() {
    const c = (game.iflags && game.iflags.prevmsg_window) || 's';
    for (const row of MSGWIND) if (row[0][0] === c) return row[0];
    return 'single';
}

// C ref: options.c handler_number_pad().
export async function handler_number_pad() {
    let tmpwin, i;
    const npchoices = [
        ' 0 (off)', ' 1 (on)', ' 2 (on, MSDOS compatible)',
        ' 3 (on, phone-style digit layout)',
        ' 4 (on, phone-style layout, MSDOS compatible)',
        "-1 (off, 'z' to move upper-left, 'y' to zap wands)",
    ];
    const mode_pick = [];
    const clr = NO_COLOR;
    game.iflags = game.iflags || {};
    game.flags = game.flags || {};

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    for (i = 0; i < npchoices.length; i++)
        add_menu(tmpwin, null, { a_int: i + 1 },
                 String.fromCharCode(97 + i), String.fromCharCode(48 + i),
                 ATR_NONE, clr, npchoices[i], MENU_ITEMFLAGS_NONE);
    end_menu(tmpwin, 'Select number_pad mode:');
    if (await select_menu(tmpwin, PICK_ONE, mode_pick) > 0) {
        // C ref: options.c:2574 optfn_number_pad()'s do_set path stores this
        // same mode number into iflags.num_pad/num_pad_mode AND is the value
        // reset_commands()/js/cmd.js's numpad_iflags() decodes back out of
        // `flags.number_pad` (js/cmd.js:361).  The rc-file path (optfn_number_pad
        // above, via keep()) already writes game.flags.number_pad verbatim; this
        // interactive handler was only writing game.iflags, leaving
        // game.flags.number_pad — the value js/cmd.js's numpad_cmd() actually
        // keys its (memoised) rebuild on — stale, so the movement-key rebind
        // never took effect ([[duplicate-reimplementation-shadows-faithful-port]]
        // family: reset_commands()/number_pad() below are genuine no-ops for
        // this build per the comment at their definition, but calling them was
        // never enough without this write).
        const NUMPAD_MODE = [0, 1, 2, 3, 4, -1];
        switch (mode_pick[0].a_int - 1) {
        case 0:
            game.iflags.num_pad = false;
            game.iflags.num_pad_mode = 0;
            break;
        case 1:
            game.iflags.num_pad = true;
            game.iflags.num_pad_mode = 0;
            break;
        case 2:
            game.iflags.num_pad = true;
            game.iflags.num_pad_mode = 1;
            break;
        case 3:
            game.iflags.num_pad = true;
            game.iflags.num_pad_mode = 2;
            break;
        case 4:
            game.iflags.num_pad = true;
            game.iflags.num_pad_mode = 3;
            break;
        /* last menu choice: number_pad == -1 */
        case 5:
            game.iflags.num_pad = false;
            game.iflags.num_pad_mode = 1;
            break;
        }
        game.flags.number_pad = NUMPAD_MODE[mode_pick[0].a_int - 1];
        reset_commands(false);
        number_pad(game.iflags.num_pad ? 1 : 0);
    }
    destroy_nhwindow(tmpwin);
    return OPTN_OK;
}

// C ref: options.c handler_paranoid_confirmation().  The 'm'-prefix substitution
// in the 'swim' explanation needs cmd_from_func(do_reqmenu), which js/cmd.js
// keeps private; 'm' is its default binding and nothing in the port rebinds it,
// so the text is used as-is.
export async function handler_paranoid_confirmation() {
    let tmpwin, i;
    let explain;
    const paranoia_picks = [];
    const clr = NO_COLOR;
    game.flags = game.flags || {};

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    for (i = 0; PARANOIA[i][0] !== 0; ++i) {
        /* C `wizard`; js/readobjnam.js spells the same test this way */
        if (PARANOIA[i][0] === PARANOID_BONES
            && !((game.flags && game.flags.debug) || game.wizard)) continue;
        explain = PARANOIA_EXPLAIN[i];
        add_menu(tmpwin, null, { a_int: PARANOIA[i][0] }, PARANOIA[i][1][0],
                 0, ATR_NONE, clr, explain,
                 ((game.flags.paranoia_bits | 0) & PARANOIA[i][0])
                     ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
    }
    end_menu(tmpwin, 'Actions requiring extra confirmation:');
    i = await select_menu(tmpwin, PICK_ANY, paranoia_picks);
    if (i >= 0) {
        /* player didn't cancel; we reset all the paranoia options
           here even if there were no items picked, since user
           could have toggled off preselected ones to end up with 0 */
        game.flags.paranoia_bits = 0;
        if (i > 0) {
            /* at least 1 item set, either preselected or newly picked */
            while (--i >= 0)
                game.flags.paranoia_bits |= paranoia_picks[i].a_int;
        }
    }
    destroy_nhwindow(tmpwin);
    return OPTN_OK;
}

// C ref: options.c handler_perminv_mode().  TTY_PERM_INVENT is undefined, so
// the "+grid" rows are NULL and the tty re-toggle FIXME does not apply.
export async function handler_perminv_mode() {
    let tmpwin, let_, buf, sepbuf, pi0, pi1, i, n;
    const pi_pick = [];
    game.iflags = game.iflags || {};
    const old_perm_invent = game.iflags.perm_invent;
    const old_pi = game.iflags.perminv_mode | 0;
    let new_pi = old_pi;
    const widest = 11; /* WINDOWPORT(tty): "full+grid__" */

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    for (i = 0; i < PERMINV_MODES.length; ++i) {
        if (!PERMINV_MODES[i] || !(pi0 = PERMINV_MODES[i][0])) continue;
        pi1 = PERMINV_MODES[i][1];
        if (!game.iflags.menu_tab_sep) {
            const numspaces = widest - pi0.length;

            sepbuf = ' '.repeat(Math.max(numspaces, 1));
        } else {
            sepbuf = '\t';
        }
        buf = `${pi0}${sepbuf}${PERMINV_MODE_DESCR[i]}`;
        let_ = ((i & InvSparse) !== 0) ? highc(pi1[0]) : pi0[0];
        add_menu(tmpwin, null, { a_int: i + 1 }, let_,
                 String.fromCharCode(48 + i), ATR_NONE, NO_COLOR,
                 buf, (i === old_pi) ? MENU_ITEMFLAGS_SELECTED
                                     : MENU_ITEMFLAGS_NONE);
    }
    end_menu(tmpwin, 'Choose permanent inventory mode:');
    n = await select_menu(tmpwin, PICK_ONE, pi_pick);
    destroy_nhwindow(tmpwin);
    if (n > 0) {
        new_pi = pi_pick[0].a_int - 1;
        if (n > 1 && new_pi === old_pi) new_pi = pi_pick[1].a_int - 1;
        game.iflags.perminv_mode = new_pi;
    }
    if (n >= 0) { /* not ESC */
        /* C: optfn_perminv_mode(..., get_val, ...) -> the mode's alias name */
        buf = (PERMINV_MODES[new_pi] || ['none', 'off'])[1];
        await pline(`'perminv_mode' `
                    + `${(new_pi !== old_pi) ? 'changed to' : 'is still'} `
                    + `'${PERMINV_MODES[new_pi][0]}' (${buf}).`);
        if (new_pi !== InvOptNone && !old_perm_invent)
            game.iflags.perm_invent = can_set_perm_invent();
        else if (new_pi === InvOptNone && old_perm_invent)
            game.iflags.perm_invent = false;

        if (new_pi !== old_pi
            || game.iflags.perm_invent !== old_perm_invent)
            opt_need_redraw = true;
    }
    return OPTN_OK;
}

// C ref: options.c handler_pickup_burden() + burdentype[].
export async function handler_pickup_burden() {
    let tmpwin, i;
    let burden_name;
    const burden_letters = 'ubsntl';
    const burden_pick = [];
    const clr = NO_COLOR;
    game.flags = game.flags || {};

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    for (i = 0; i < BURDENTYPE.length; i++) {
        burden_name = BURDENTYPE[i];
        add_menu(tmpwin, null, { a_int: i + 1 }, burden_letters[i],
                 0, ATR_NONE, clr, burden_name, MENU_ITEMFLAGS_NONE);
    }
    end_menu(tmpwin, 'Select encumbrance level:');
    if (await select_menu(tmpwin, PICK_ONE, burden_pick) > 0)
        game.flags.pickup_burden = burden_pick[0].a_int - 1;
    destroy_nhwindow(tmpwin);
    return OPTN_OK;
}

// C ref: options.c handler_pickup_types() -- parseoptions() itself prompts for
// the list of object classes.
export async function handler_pickup_types() {
    /* parseoptions will prompt for the list of types */
    parseoptions('pickup_types', false, opt_result_shim());
    return OPTN_OK;
}

// C ref: options.c handler_runmode() + runmodes[].
export async function handler_runmode() {
    let tmpwin, i;
    let mode_name;
    const mode_pick = [];
    const clr = NO_COLOR;
    game.flags = game.flags || {};

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    for (i = 0; i < RUNMODES.length; i++) {
        mode_name = RUNMODES[i];
        add_menu(tmpwin, null, { a_int: i + 1 }, mode_name[0],
                 0, ATR_NONE, clr, mode_name, MENU_ITEMFLAGS_NONE);
    }
    end_menu(tmpwin, 'Select run/travel display mode:');
    if (await select_menu(tmpwin, PICK_ONE, mode_pick) > 0)
        /* C stores the index; the port keeps flags.runmode as the name (see
           optfn_runmode() above), which js/hack.c's runmode tests read. */
        game.flags.runmode = RUNMODES[mode_pick[0].a_int - 1];
    destroy_nhwindow(tmpwin);
    return OPTN_OK;
}

// C ref: options.c handler_petattr().
export async function handler_petattr() {
    game.iflags = game.iflags || {};
    const { query_attr } = await import('./coloratt.js');
    const tmp = await query_attr('Select pet highlight attribute',
                                 game.iflags.wc2_petattr);

    if (tmp !== -1) {
        game.iflags.wc2_petattr = tmp;
        game.iflags.hilite_pet = (game.iflags.wc2_petattr !== ATR_NONE);
        if (!opt_initial) opt_need_redraw = true;
    }
    return OPTN_OK;
}

// C ref: options.c handler_sortloot() + sortltype[].
export async function handler_sortloot() {
    let tmpwin, i, n;
    let sortl_name;
    const sortl_pick = [];
    const clr = NO_COLOR;
    game.flags = game.flags || {};

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    for (i = 0; i < SORTLTYPE.length; i++) {
        sortl_name = SORTLTYPE[i];
        add_menu(tmpwin, null, { a_char: sortl_name[0] }, sortl_name[0],
                 0, ATR_NONE, clr, sortl_name,
                 (game.flags.sortloot === sortl_name[0])
                     ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
    }
    end_menu(tmpwin, 'Select loot sorting type:');
    n = await select_menu(tmpwin, PICK_ONE, sortl_pick);
    if (n > 0) {
        let c = sortl_pick[0].a_char;

        if (n > 1 && c === game.flags.sortloot) c = sortl_pick[1].a_char;
        game.flags.sortloot = c;
        /* changing to or from 'f' affects persistent inventory display */
        if (game.iflags && game.iflags.perm_invent) update_inventory();
    }
    destroy_nhwindow(tmpwin);
    return OPTN_OK;
}

// C ref: options.c handler_whatis_coord().
export async function handler_whatis_coord() {
    let tmpwin, buf;
    const window_pick = [];
    let pick_cnt;
    game.iflags = game.iflags || {};
    const gpc = game.iflags.getpos_coords;
    const clr = NO_COLOR;
    const verbose = !!(game.flags && game.flags.verbose);

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    add_menu(tmpwin, null, { a_char: GPCOORDS_COMPASS }, GPCOORDS_COMPASS,
             0, ATR_NONE, clr, "compass ('east' or '3s' or '2n,4w')",
             (gpc === GPCOORDS_COMPASS) ? MENU_ITEMFLAGS_SELECTED
                                        : MENU_ITEMFLAGS_NONE);
    add_menu(tmpwin, null, { a_char: GPCOORDS_COMFULL }, GPCOORDS_COMFULL,
             0, ATR_NONE, clr,
             "full compass ('east' or '3south' or '2north,4west')",
             (gpc === GPCOORDS_COMFULL) ? MENU_ITEMFLAGS_SELECTED
                                        : MENU_ITEMFLAGS_NONE);
    add_menu(tmpwin, null, { a_char: GPCOORDS_MAP }, GPCOORDS_MAP,
             0, ATR_NONE, clr, 'map <x,y>',
             (gpc === GPCOORDS_MAP) ? MENU_ITEMFLAGS_SELECTED
                                    : MENU_ITEMFLAGS_NONE);
    add_menu(tmpwin, null, { a_char: GPCOORDS_SCREEN }, GPCOORDS_SCREEN,
             0, ATR_NONE, clr, 'screen [row,column]',
             (gpc === GPCOORDS_SCREEN) ? MENU_ITEMFLAGS_SELECTED
                                       : MENU_ITEMFLAGS_NONE);
    add_menu(tmpwin, null, { a_char: GPCOORDS_NONE }, GPCOORDS_NONE,
             0, ATR_NONE, clr, 'none (no coordinates displayed)',
             (gpc === GPCOORDS_NONE) ? MENU_ITEMFLAGS_SELECTED
                                     : MENU_ITEMFLAGS_NONE);
    add_menu_str(tmpwin, '');
    buf = `map: upper-left: <${1},${0}>, lower-right: <${COLNO - 1},`
          + `${ROWNO - 1}>`
          + (verbose ? '; column 0 unused, off left edge' : '');
    add_menu_str(tmpwin, buf);
    /* `if (strcmp(windowprocs.name, "tty"))` -- this IS tty, so the
       "screen: row is offset ..." note is not added */
    buf = `screen: upper-left: [${String(0 + 2).padStart(2, '0')},`
          + `${String(1).padStart(2, '0')}], lower-right: `
          + `[${ROWNO - 1 + 2},${COLNO - 1}]`
          + (verbose ? '; column 80 is not used' : ''); /* COLNO == 80 */
    add_menu_str(tmpwin, buf);
    add_menu_str(tmpwin, '');
    end_menu(tmpwin,
        'Select coordinate display when auto-describing a map position:');
    if ((pick_cnt = await select_menu(tmpwin, PICK_ONE, window_pick)) > 0) {
        game.iflags.getpos_coords = window_pick[0].a_char;
        /* PICK_ONE doesn't unselect preselected entry when
           selecting another one */
        if (pick_cnt > 1 && game.iflags.getpos_coords === gpc)
            game.iflags.getpos_coords = window_pick[1].a_char;
    }
    destroy_nhwindow(tmpwin);
    return OPTN_OK;
}

// C ref: options.c handler_whatis_filter() -- note the a_char values are
// GFILTER_* PLUS ONE, because a_char 0 would make the entry unselectable.
export async function handler_whatis_filter() {
    let tmpwin;
    const window_pick = [];
    let pick_cnt;
    game.iflags = game.iflags || {};
    const gfilt = game.iflags.getloc_filter | 0;
    const clr = NO_COLOR;

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    add_menu(tmpwin, null, { a_char: GFILTER_NONE + 1 }, 'n',
             0, ATR_NONE, clr, 'no filtering',
             (gfilt === GFILTER_NONE) ? MENU_ITEMFLAGS_SELECTED
                                      : MENU_ITEMFLAGS_NONE);
    add_menu(tmpwin, null, { a_char: GFILTER_VIEW + 1 }, 'v',
             0, ATR_NONE, clr, 'in view only',
             (gfilt === GFILTER_VIEW) ? MENU_ITEMFLAGS_SELECTED
                                      : MENU_ITEMFLAGS_NONE);
    add_menu(tmpwin, null, { a_char: GFILTER_AREA + 1 }, 'a',
             0, ATR_NONE, clr, 'in same area',
             (gfilt === GFILTER_AREA) ? MENU_ITEMFLAGS_SELECTED
                                      : MENU_ITEMFLAGS_NONE);
    end_menu(tmpwin,
      'Select location filtering when going for next/previous map position:');
    if ((pick_cnt = await select_menu(tmpwin, PICK_ONE, window_pick)) > 0) {
        game.iflags.getloc_filter = window_pick[0].a_char - 1;
        /* PICK_ONE doesn't unselect preselected entry when
           selecting another one */
        if (pick_cnt > 1 && game.iflags.getloc_filter === gfilt)
            game.iflags.getloc_filter = window_pick[1].a_char - 1;
    }
    destroy_nhwindow(tmpwin);
    return OPTN_OK;
}

// C ref: options.c handler_symset() -- symbols.c do_symset() lives in
// js/symbols.js, which imports this file, so load it on demand.
export async function handler_symset(optidx) {
    let reslt;

    const { do_symset } = await import('./symbols.js');
    reslt = await do_symset(optidx === 'roguesymset');   /* symbols.c */
    opt_need_redraw = true;
    return reslt;
}

// C ref: decl.h go.opt_initial / go.opt_need_redraw / the other
// go.opt_* visual-reset flags reset_needed_visuals() consumes.
let opt_initial = false, opt_need_redraw = false, opt_need_glyph_reset = false,
    opt_reset_customcolors = false, opt_reset_customsymbols = false,
    opt_update_basic_palette = false, opt_need_promptstyle = false;

// C ref: parseoptions()'s third argument -- the accumulator parseNethackrc()
// builds for a whole config file.  handler_pickup_types() reaches parseoptions()
// from the 'O' menu, where C writes straight into flags/iflags, so give it a
// throw-away accumulator with the same shape.
function opt_result_shim() {
    return {
        name: '', role: -1, race: -1, gender: -1, align: -1,
        flags: {}, iflags: {}, keybind: {}, symoverride: {}, apelist: [],
        warnsyms: [],
        menu_cmd_alias: [], keybind_param: {}, keyunbind: [], spkeys: {},
        mousebtn: {}, autocomplete: {}, msgtypes: [], menucolors: [],
        status_hilites: [], conds: {},
    };
}

// C ref: options.c handler_autopickup_exception() -- add/list/remove loop.
export async function handler_autopickup_exception() {
    let tmpwin, i;
    let opt_idx, numapes = 0;
    let apebuf;
    let ape;
    const clr = NO_COLOR;
    const result = { apelist: (game.apelist = game.apelist || []) };

    for (;;) {                                          /* ape_again: */
        numapes = count_apes();
        opt_idx = await handle_add_list_remove('autopickup exception', numapes);
        if (opt_idx === 3) { /* done */
            return true;
        } else if (opt_idx === 0) { /* add new */
            /* EDIT_GETLIN:  assume user doesn't user want previous
               exception used as default input string for this one... */
            apebuf = await getlin('What new autopickup exception pattern?');
            apebuf = mungspaces(apebuf); /* regularize whitespace */
            if (apebuf[0] === '\x1b') return true;
            if (apebuf) {
                /* guarantee room for \" prefix and \"\0 suffix */
                add_autopickup_exception(`"${apebuf}"`, result);
            }
            continue;
        } else { /* list (1) or remove (2) */
            let pick_idx, pick_cnt;
            const pick_list = [];

            tmpwin = create_nhwindow(NHW_MENU);
            start_menu(tmpwin, MENU_BEHAVE_STANDARD);
            if (numapes) {
                add_menu_heading(tmpwin,
                                 "Always pickup '<'; never pickup '>'");
                for (i = 0; i < numapes && (ape = result.apelist[i]); i++) {
                    /* length of pattern plus quotes (plus '<'/'>') is
                       less than BUFSZ */
                    apebuf = `"${ape.grab ? '<' : '>'}${ape.pattern}"`;
                    add_menu(tmpwin, null,
                             { a_void: (opt_idx === 1) ? null : ape }, 0, 0,
                             ATR_NONE, clr, apebuf, MENU_ITEMFLAGS_NONE);
                }
            }
            apebuf = `${(opt_idx === 1) ? 'List of' : 'Remove which'}`
                     + ' autopickup exceptions';
            end_menu(tmpwin, apebuf);
            pick_cnt = await select_menu(tmpwin,
                                         (opt_idx === 1) ? PICK_NONE : PICK_ANY,
                                         pick_list);
            if (pick_cnt > 0) {
                for (pick_idx = 0; pick_idx < pick_cnt; ++pick_idx)
                    remove_autopickup_exception(pick_list[pick_idx].a_void,
                                                result);
            }
            destroy_nhwindow(tmpwin);
            if (pick_cnt >= 0) continue;
        }
        break;
    }
    return OPTN_OK;
}

// C ref: options.c handler_menu_colors().  free_one_menu_coloring() is
// coloratt.c's; the port keeps the list in game.menucolors, so splice it here
// (the same thing free_one_msgtype() does for message types above).
export async function handler_menu_colors() {
    let tmpwin, buf;
    let opt_idx, nmc, mcclr, mcattr;
    let mcbuf;
    const clr = NO_COLOR;
    const colorings = (game.menucolors = game.menucolors || []);

    for (;;) {                                      /* menucolors_again: */
        nmc = count_menucolors();
        opt_idx = await handle_add_list_remove('menucolor', nmc);
        if (opt_idx === 3) { /* done */
            /* menucolors_done: in case we've made a change which impacts
               current persistent inventory window; we don't track whether an
               actual change occurred, so just assume there was one */
            if (game.iflags && game.iflags.use_menu_color) {
                if (game.iflags.perm_invent) update_inventory();
            }
            return OPTN_OK;
        } else if (opt_idx === 0) { /* add new */
            mcbuf = await getlin('What new menucolor pattern?');
            if (mcbuf[0] === '\x1b') {
                if (game.iflags && game.iflags.use_menu_color
                    && game.iflags.perm_invent) update_inventory();
                return OPTN_OK;                     /* goto menucolors_done */
            }
            const { query_color, query_attr } = await import('./coloratt.js');
            if (mcbuf
                && test_regex_pattern(mcbuf, 'MENUCOLORS regex')
                && (mcclr = await query_color(null, NO_COLOR_IDX)) !== -1
                && (mcattr = await query_attr(null, ATR_NONE)) !== -1
                && !add_menu_coloring_parsed(mcbuf, mcclr, mcattr,
                                             { menucolors: colorings })) {
                await pline('Error adding the menu color.');
                wait_synch();
            }
            continue;
        } else { /* list (1) or remove (2) */
            let pick_idx, pick_cnt, mc_idx, ln, sattr, sclr;
            const pick_list = [];
            let ti = 0;

            tmpwin = create_nhwindow(NHW_MENU);
            start_menu(tmpwin, MENU_BEHAVE_STANDARD);
            mc_idx = 0;
            while (ti < colorings.length) {
                const tmp = colorings[ti++];
                sattr = opt_attr2attrname(tmp.attr);
                sclr = strNsubst(opt_clr2colorname(tmp.color), ' ', '-', 0);
                /* construct suffix */
                buf = `""=${sclr}${(tmp.attr !== ATR_NONE) ? '&' : ''}`
                      + `${(tmp.attr !== ATR_NONE) ? sattr : ''}`;
                /* now main string */
                ln = BUFSZ - buf.length - 1; /* length available */
                mcbuf = '"';
                if (tmp.origstr.length > ln)
                    mcbuf += tmp.origstr.slice(0, ln - 3) + '...';
                else
                    mcbuf += tmp.origstr;
                /* combine main string and suffix */
                mcbuf += buf.slice(1); /* skip buf[]'s initial quote */
                add_menu(tmpwin, null, { a_int: ++mc_idx }, 0, 0,
                         ATR_NONE, clr, mcbuf, MENU_ITEMFLAGS_NONE);
            }
            mcbuf = `${(opt_idx === 1) ? 'List of' : 'Remove which'}`
                    + ' menu colors';
            end_menu(tmpwin, mcbuf);
            pick_cnt = await select_menu(tmpwin,
                                         (opt_idx === 1) ? PICK_NONE : PICK_ANY,
                                         pick_list);
            if (pick_cnt > 0) {
                for (pick_idx = 0; pick_idx < pick_cnt; ++pick_idx)
                    colorings.splice(pick_list[pick_idx].a_int - 1 - pick_idx,
                                     1);
            }
            destroy_nhwindow(tmpwin);
            if (pick_cnt >= 0) continue;
        }
        break;
    }
    return OPTN_OK;
}

// C ref: options.c handler_msgtype().
export async function handler_msgtype() {
    let tmpwin;
    let opt_idx, nmt, mttyp;
    let mtbuf;
    const types = (game.msgtypes = game.msgtypes || []);

    for (;;) {                                      /* msgtypes_again: */
        nmt = msgtype_count();
        opt_idx = await handle_add_list_remove('message type', nmt);
        if (opt_idx === 3) { /* done */
            return true;
        } else if (opt_idx === 0) { /* add new */
            mtbuf = await getlin('What new message pattern?');
            if (mtbuf[0] === '\x1b') return true;
            if (mtbuf
                && test_regex_pattern(mtbuf, 'MSGTYPE regex')
                && (mttyp = await query_msgtype()) !== -1
                && !msgtype_add(mttyp, mtbuf, { msgtypes: types })) {
                await pline('Error adding the message type.');
                wait_synch();
            }
            continue;
        } else { /* list (1) or remove (2) */
            let pick_idx, pick_cnt, mt_idx, ln, mtype;
            const pick_list = [];
            let ti = 0;
            const clr = NO_COLOR;

            tmpwin = create_nhwindow(NHW_MENU);
            start_menu(tmpwin, MENU_BEHAVE_STANDARD);
            mt_idx = 0;
            while (ti < types.length) {
                const tmp = types[ti++];
                mtype = msgtype2name(tmp.msgtype);
                mtbuf = `${String(mtype).padEnd(5, ' ')} "`;
                ln = BUFSZ - mtbuf.length - 2 /* sizeof "\"" */;
                if (tmp.pattern.length > ln)
                    mtbuf += tmp.pattern.slice(0, ln - 3) + '..."';
                else
                    mtbuf += tmp.pattern + '"';
                add_menu(tmpwin, null, { a_int: ++mt_idx }, 0, 0,
                         ATR_NONE, clr, mtbuf, MENU_ITEMFLAGS_NONE);
            }
            mtbuf = `${(opt_idx === 1) ? 'List of' : 'Remove which'}`
                    + ' message types';
            end_menu(tmpwin, mtbuf);
            pick_cnt = await select_menu(tmpwin,
                                         (opt_idx === 1) ? PICK_NONE : PICK_ANY,
                                         pick_list);
            if (pick_cnt > 0) {
                for (pick_idx = 0; pick_idx < pick_cnt; ++pick_idx)
                    free_one_msgtype(pick_list[pick_idx].a_int - 1 - pick_idx,
                                     { msgtypes: types });
            }
            destroy_nhwindow(tmpwin);
            if (pick_cnt >= 0) continue;
        }
        break;
    }
    return OPTN_OK;
}

// C ref: options.c handler_versinfo().  nomakedefs.git_branch is empty in a
// released build, so the third entry reads "(not applicable)"
// (NH_DEVEL_STATUS == NH_STATUS_RELEASED).
export async function handler_versinfo() {
    let tmpwin, n;
    const vi_pick = [];
    const have_branch = false;
    game.flags = game.flags || {};
    const vi = game.flags.versinfo | 0;

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);

    n = VI_NUMBER; /* 1 */
    add_menu(tmpwin, null, { a_int: n }, 'n', String.fromCharCode(n + 48),
             ATR_NONE, NO_COLOR, 'version number',
             (vi & n) ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
    n = VI_NAME; /* 2 */
    add_menu(tmpwin, null, { a_int: n }, 'g', String.fromCharCode(n + 48),
             ATR_NONE, NO_COLOR, 'game name',
             (vi & n) ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
    n = VI_BRANCH; /* 4 */
    add_menu(tmpwin, null, { a_int: n }, 'b', String.fromCharCode(n + 48),
             ATR_NONE, NO_COLOR,
             have_branch ? 'development branch' : '(not applicable)',
             (vi & n) ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);

    end_menu(tmpwin, 'Select version information flags:');
    n = await select_menu(tmpwin, PICK_ANY, vi_pick);
    if (n > 0) {
        let i, newval = 0;

        for (i = 0; i < n; ++i) newval |= vi_pick[i].a_int;
        newval &= 7;
        if (newval) game.flags.versinfo = newval;
    }
    destroy_nhwindow(tmpwin);
    return OPTN_OK;
}

// C ref: options.c handler_windowborders() -- curses-only setting, but the
// menu is built the same way for every port.
export async function handler_windowborders() {
    let tmpwin, i;
    let mode_name;
    const mode_pick = [];
    const clr = NO_COLOR;
    const windowborders_text = [
        'Off, never show borders',
        'On, always show borders',
        'Auto, on if display is at least (24+2)x(80+2)',
        'On, except forced off for perm_invent',
        'Auto, except forced off for perm_invent',
    ];

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    for (i = 0; i < windowborders_text.length; i++) {
        mode_name = windowborders_text[i];
        /* index 'i' matches the numeric setting for windowborders,
           so allow corresponding digit as group accelerator */
        add_menu(tmpwin, null, { a_int: i + 1 }, String.fromCharCode(97 + i),
                 String.fromCharCode(48 + i), ATR_NONE, clr, mode_name,
                 MENU_ITEMFLAGS_NONE);
    }
    end_menu(tmpwin, 'Select window borders mode:');
    if (await select_menu(tmpwin, PICK_ONE, mode_pick) > 0) {
        game.iflags = game.iflags || {};
        game.iflags.wc2_windowborders = mode_pick[0].a_int - 1;
    }
    destroy_nhwindow(tmpwin);
    return OPTN_OK;
}

// C ref: options.c query_msgtype() -- msgtype_names[] rows that have a .descr.
export async function query_msgtype() {
    let tmpwin, i, pick_cnt;
    const picks = [];
    const clr = NO_COLOR;

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    for (i = 0; i < MSGTYPE_NAMES.length; i++)
        if (MSGTYPE_DESCR[i])
            add_menu(tmpwin, null, { a_int: MSGTYPE_NAMES[i][1] + 1 }, 0, 0,
                     ATR_NONE, clr, MSGTYPE_DESCR[i], MENU_ITEMFLAGS_NONE);
    end_menu(tmpwin, 'How to show the message');
    pick_cnt = await select_menu(tmpwin, PICK_ONE, picks);
    destroy_nhwindow(tmpwin);
    if (pick_cnt > 0) return picks[0].a_int - 1;
    return -1;
}

// C ref: options.c msgtype_names[].descr (MSGTYPE_NAMES above is name+type; the
// "norep" alias row has a NULL descr and so is skipped by query_msgtype()).
const MSGTYPE_DESCR = [
    'Show message normally',                /* show */
    'Hide message',                         /* hide */
    null,                                   /* noshow (alias) */
    'Prompt for more after the message',     /* stop */
    null,                                   /* more (alias) */
    'Do not repeat the message',            /* norep */
];

// C ref: options.c handle_add_list_remove() -- common to msg-types,
// menu-colors and autopickup-exceptions.  Returns 0 add / 1 list / 2 remove /
// 3 exit.
export async function handle_add_list_remove(optname, numtotal) {
    let tmpwin, i, pick_cnt, opt_idx;
    const pick_list = [];
    const action_titles = [
        ['a', 'add new %s'],         /* [0] */
        ['l', 'list %s'],            /* [1] */
        ['r', 'remove existing %s'], /* [2] */
        ['x', 'exit this menu'],     /* [3] */
    ];
    const clr = NO_COLOR;
    let a_int = 0;

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    for (i = 0; i < action_titles.length; i++) {
        a_int++;
        /* omit list and remove if there aren't any yet */
        if (!numtotal && (i === 1 || i === 2)) continue;
        const tmpbuf = action_titles[i][1].replace('%s',
            (i === 1) ? makeplural(optname) : optname);
        add_menu(tmpwin, null, { a_int }, action_titles[i][0],
                 0, ATR_NONE, clr, tmpbuf,
                 (i === 3) ? MENU_ITEMFLAGS_SELECTED : MENU_ITEMFLAGS_NONE);
    }
    end_menu(tmpwin, 'Do what?');
    if ((pick_cnt = await select_menu(tmpwin, PICK_ONE, pick_list)) > 0) {
        opt_idx = pick_list[0].a_int - 1;
        if (pick_cnt > 1 && opt_idx === 3) opt_idx = pick_list[1].a_int - 1;
    } else {
        opt_idx = 3; /* none selected, exit menu */
    }
    destroy_nhwindow(tmpwin);
    return opt_idx;
}

// C ref: coloratt.c clr2colorname()/attr2attrname().  js/coloratt.js exports
// both, but it imports THIS file, so a static import would be a cycle; these
// read the same COLORNAMES/ATTRNAMES tables that live here.  First match wins,
// which is why the aliases appended after each primary name never surface.
function opt_clr2colorname(clr) {
    for (const [name, color] of COLORNAMES) if (color === clr) return name;
    return null;
}
function opt_attr2attrname(attr) {
    for (const [name, a] of ATTRNAMES) if (a === attr) return name;
    return null;
}

// C ref: hacklib.c strNsubst() -- replace occurrences of `orig` with `replacement`;
// n == 0 means every occurrence, otherwise only the n'th one.
function strNsubst(bp, orig, replacement, n) {
    if (!bp || !orig) return bp;
    let out = '', i = 0, count = 0;
    for (;;) {
        const at = bp.indexOf(orig, i);
        if (at < 0) { out += bp.slice(i); break; }
        ++count;
        if (n === 0 || n === count) {
            out += bp.slice(i, at) + replacement;
            i = at + orig.length;
            if (n !== 0) { out += bp.slice(i); break; }
        } else {
            out += bp.slice(i, at + orig.length);
            i = at + orig.length;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// doset()/#optionsfull support.

// C ref: options.c can_set_perm_invent() -- called only when perm_invent is
// False and about to become True.  tty_procs.wincap lacks WC_PERM_INVENT in
// this build (TTY_PERM_INVENT undefined) and check_tty_wincap() agrees, so this
// always refuses: 'perm_invent' cannot be turned on here at all.
export function can_set_perm_invent() {
    game.iflags = game.iflags || {};
    const old_perminv_mode = game.iflags.perminv_mode;

    if (!(TTY_WINCAP & WC_PERM_INVENT)) {
        /* check tty, not necessarily the active window port;
           windows early startup can still be set to safeprocs */
        if (!check_tty_wincap(WC_PERM_INVENT)) return false;
    }

    if (game.iflags.perminv_mode === InvOptNone)
        game.iflags.perminv_mode = InvOptOn;

    /* #else arm of TTY_PERM_INVENT: nhUse(old_perminv_mode) */
    void old_perminv_mode;
    return true;
}

// C ref: options.c check_perm_invent_again() -- inside #ifdef TTY_PERM_INVENT,
// so it is not compiled in this build; kept for the ports that do define it.
export function check_perm_invent_again() {
    game.iflags = game.iflags || {};
    if (game.iflags.perm_invent_pending) {
        game.iflags.perm_invent = false;
        if (can_set_perm_invent()) game.iflags.perm_invent = true;
        game.iflags.perm_invent_pending = false;
    }
}

// C ref: options.c term_for_boolean() -- the word doset() shows for a boolean's
// value, chosen by allopt[].termpref.  booleanterms[][] has num_terms (4)
// columns, so C's `i < num_terms && i < SIZE(booleanterms[0])` lets all four
// through; only 'voices' (Term_Excluded) reaches the last one in this build.
export function term_for_boolean(idx, b) {
    const f_t = b ? 1 : 0;
    const booleanterms = [
        ['false', 'off', 'disabled', 'excluded from build'],
        ['true', 'on', 'enabled', 'included'],
    ];
    let boolean_term = booleanterms[f_t][0];
    const meta = ALLOPT[idx] && ALLOPT_META.get(ALLOPT[idx].name);
    const i = meta ? meta.termpref : TERM_FALSE;

    if (i > TERM_FALSE && i < 4 /* num_terms */
        && i < booleanterms[0].length)
        boolean_term = booleanterms[f_t][i];
    return boolean_term;
}

// C ref: options.c longest_option_name() -- doset()'s column width.  pass 0
// counts the Boolean options with an addr, pass 1 the rest; both are filtered
// by setwhere range and windowport capability.
export function longest_option_name(startpass, endpass) {
    /* spin through the options to find the longest name */
    let longest_name_len = 0;
    let i, pass, optflags, name;

    for (pass = 0; pass < 2; pass++)
        for (i = 0; i < OPTCOUNT && (name = ALLOPT[i].name); i++) {
            if (pass === 0 && (ALLOPT[i].typ !== 'B' || ALLOPT[i].noaddr))
                continue;
            optflags = opt_setwhere(i);
            if (optflags < startpass || optflags > endpass) continue;
            if ((is_wc_option(name) && !wc_supported(name))
                || (is_wc2_option(name) && !wc2_supported(name)))
                continue;

            const len = name.length;
            if (len > longest_name_len) longest_name_len = len;
        }
    return longest_name_len;
}

// C ref: options.c get_option_value() -- "Currently handles only boolean and
// compound options."  The port's optfn_*() have no get_val/get_cnf_val mode, so
// the compound arm reads the value the parser recorded on game.flags (keep()'s
// destination) instead of asking the option function to format it.
export function get_option_value(optname, cnfvalid) {
    let i;

    for (i = 0; i < OPTCOUNT && ALLOPT[i].name; i++)
        if (optname === ALLOPT[i].name) {
            if (ALLOPT[i].typ === 'B' && !ALLOPT[i].noaddr) {
                const v = game.flags && game.flags[optname];
                return v ? 'true' : 'false';
            } else if (ALLOPT[i].typ === 'C') {
                const v = game.flags && game.flags[optname];
                if (v !== undefined && v !== null && v !== ''
                    && v !== false)
                    return (v === true) ? optname : String(v);
                return null;
            }
        }
    return null;
}

// C ref: options.c doset_add_menu() -- one compound-option line in the
// #optionsfull menu.  indexoffset 0 makes the entry unselectable, which is how
// doset() greys out an option that cannot be changed now.
export function doset_add_menu(win, option, fmtstr, idx, indexoffset) {
    let value = 'unknown'; /* current value */
    let indent, buf, buf2 = '';
    const any = {};
    const i = idx;
    const clr = NO_COLOR;

    if (i >= 0 && i < OPTCOUNT && ALLOPT[i] && ALLOPT[i].name) {
        any.a_int = (indexoffset === 0) ? 0 : i + 1 + indexoffset;
        const v = get_option_value(ALLOPT[i].name, false);
        if (v) buf2 = v;
        if (buf2) value = buf2;
    } else {
        /* We are trying to add an option not found in allopt[].
           This is almost certainly bad, but we'll let it through anyway
           (with a zero value, so it can't be selected). */
        any.a_int = 0;
        if (!buf2) buf2 = 'unknown';
        value = buf2;
    }

    /* "    " replaces "a - " -- assumes menus follow that style */
    indent = !any.a_int ? '    ' : '';
    buf = opt_sprintf3(fmtstr, indent, option, value);
    add_menu(win, null, any, 0, 0, ATR_NONE, clr, buf,
             MENU_ITEMFLAGS_SKIPINVERT);
}

// doset()'s fmtstr is "%s%-*s [%s]" pre-baked with the column width, or the
// tab-separated "%s%s\t[%s]".  Only those two shapes reach here.
function opt_sprintf3(fmtstr, a, b, c) {
    const m = /^%s%-(\d+)s \[%s\]/.exec(fmtstr);
    if (m) return a + String(b).padEnd(Number(m[1]), ' ') + ' [' + c + ']';
    return a + b + '\t[' + c + ']';
}

// C ref: options.c enhance_menu_text() -- the whole body is inside
// `#if 0 /*#ifdef TTY_PERM_INVENT*/`, so it appends nothing in any build.
export function enhance_menu_text(buf, sz, whichpass, bool_p, thisopt) {
    if (!buf) return buf;
    const nowsz = buf.length + 1;
    const availsz = sz - nowsz;

    void availsz; void bool_p; void thisopt; void whichpass;
    return buf;
}

// C ref: options.c reset_needed_visuals() -- run after a doset() round to apply
// whatever the picks invalidated.  reset_glyphmap()/reset_customcolors()/
// reset_customsymbols()/check_gold_symbol() live in js/symbols.js and
// js/display.js, both of which are on the far side of an import cycle from
// here, so they load on demand.
export async function reset_needed_visuals() {
    if (opt_need_glyph_reset) {
        const sym = await import('./symbols.js');
        if (sym.reset_glyphmap) sym.reset_glyphmap('gm_optionchange');
    }
    if (opt_reset_customcolors || opt_update_basic_palette
        || opt_reset_customsymbols || opt_need_redraw) {
        if (opt_update_basic_palette) {
            /* #ifdef CHANGE_COLOR change_palette() -- not this build */
            opt_update_basic_palette = false;
        }
        const sym = await import('./symbols.js');
        if (opt_reset_customcolors && sym.reset_customcolors)
            sym.reset_customcolors();
        if (opt_reset_customsymbols && sym.reset_customsymbols)
            sym.reset_customsymbols();
        if (opt_need_redraw) {
            if (sym.check_gold_symbol) sym.check_gold_symbol();
            const disp = await import('./display.js');
            if (disp.reglyph_darkroom) disp.reglyph_darkroom();
        }
        const disp = await import('./display.js');
        if (disp.docrt) await disp.docrt();
    }
    if (opt_need_promptstyle)
        adjust_menu_promptstyle(null, game.iflags && game.iflags.menu_headings);
    if (game.disp && (game.disp.botl || game.disp.botlx)) {
        const disp = await import('./display.js');
        if (disp.bot) await disp.bot();
    }
    opt_need_redraw = false;
    opt_need_glyph_reset = false;
    opt_reset_customcolors = false;
    opt_reset_customsymbols = false;
    opt_update_basic_palette = false;
}

// C ref: options.c toggle_bool_option() -- '#optionsfull's shortcut and the
// only caller of reset_needed_visuals() outside doset().  Matches on a PREFIX
// (strncmpi over strlen(p)) and keeps going, so an ambiguous prefix toggles
// every match.
export async function toggle_bool_option(p) {
    let i;
    let ret = ECMD_FAIL;

    for (i = 0; i < OPTCOUNT; i++)
        if (strncmpi_eq(ALLOPT[i].name, p, p.length)
            && ALLOPT[i].typ === 'B'
            && opt_setwhere(i) === SET_IN_GAME
            && !ALLOPT[i].noaddr) {
            const cur = !!(game.flags && game.flags[ALLOPT[i].name]);
            const buf = `${cur ? '!' : ''}${ALLOPT[i].name}`;

            if (parseoptions(buf, false, opt_result_shim())) ret = ECMD_OK;

            await reset_needed_visuals();
        }
    return ret;
}

// C ref: include/hack.h ECMD_* -- the command-return bits.
const ECMD_OK = 0x00, ECMD_FAIL = 0x04;

// C ref: options.c get_menu_cmd_key() -- the reverse of map_menu_cmd(): given
// an internal MENU_* char, the key the player must press for it.
export function get_menu_cmd_key(ch) {
    const alias = game.menu_cmd_alias || [];
    /* gm.mapped_menu_op holds the internal commands, gm.mapped_menu_cmds the
       user's keys; add_menu_cmd_alias(from_ch=key, to_ch=command) appends to
       both in lockstep, so a pair here is [key, command]. */
    for (const [key, cmd] of alias) if (cmd === ch) return key;
    return ch;
}

// C ref: options.c collect_menu_keys() -- the scrolling keys to offer in a
// prompt (printable) or to a yn_function (raw).
export function collect_menu_keys(outbuf, scrollmask, printable) {
    const scroll_keys = [
        [MENU_FIRST_PAGE, 1],
        [MENU_PREVIOUS_PAGE, 1],
        [MENU_NEXT_PAGE, 2],
        [MENU_LAST_PAGE, 2],
        [MENU_SHIFT_LEFT, 4],
        [MENU_SHIFT_RIGHT, 8],
    ];
    let i;

    outbuf = '';
    for (i = 0; i < scroll_keys.length; ++i) {
        if (scrollmask & scroll_keys[i][1]) {
            const c = get_menu_cmd_key(scroll_keys[i][0]);

            if (printable) outbuf += visctrl(c);
            else outbuf += c;
        }
    }
    return outbuf;
}

// C ref: options.c rejectoption() -- MICRO is undefined, so the #else text.
export async function rejectoption(optname) {
    await pline(`${optname} can be set only from NETHACKOPTIONS or `
                + `${OPT_CONFIGFILE}.`);
}

// C ref: options.c next_opt() -- prints the next boolean option name, on the
// same line if it fits, on a new line if not; next_opt(win, "") flushes.  The
// buffer is static in C, so a sequence of calls builds one wrapped list.
// (option_help_lines() above inlines this loop for its own single use.)
let next_opt_buf = null;
export function next_opt(datawin, str) {
    let i, s;

    if (next_opt_buf === null) next_opt_buf = '';

    if (!str) {
        s = next_opt_buf.length;
        if (s > 1 && next_opt_buf.slice(s - 2) === ', ')
            /* replace ending ", " with "." */
            next_opt_buf = next_opt_buf.slice(0, s - 2) + '.';
        i = COLNO;              /* (greater than COLNO - 2) */
    } else {
        i = next_opt_buf.length + str.length + 2;
    }

    if (i > COLNO - 2) { /* rule of thumb */
        putstr(datawin, 0, next_opt_buf);
        next_opt_buf = '';
    }
    if (str) {
        next_opt_buf += str;
        next_opt_buf += ', ';
    } else {
        putstr(datawin, 0, str);
        next_opt_buf = null;
    }
}

// C ref: options.c show_menu_controls() -- used by cmd.c '?i' (dolist TRUE) and
// pager.c '?k' (dolist FALSE).  js/pager.js domenucontrols() renders the '?k'
// half directly into its own line list; this is the options.c function itself,
// writing through putstr() into a window.
export function show_menu_controls(win, dolist) {
    const hardcoded = [
        ['Return', 'Accept current choice(s) and dismiss menu'],
        ['Enter',  'Same as Return'],
        ['Space',  'If not on last page, advance one page;'],
        ['     ',  'when on last page, treat like Return'],
        ['Escape', 'Cancel menu without making any choice(s)'],
    ];
    const mc_fmt = (a, b, c) => `${String(a).padStart(8, ' ')}     `
                                + `${String(b).padEnd(6, ' ')} ${c}`;
    const mc_altfmt = (a, b, c) => `${String(a).padStart(9, ' ')}  `
                                   + `${String(b).padEnd(6, ' ')} ${c}`;
    let buf, arg, fmt;
    const has_menu_shift = wc2_supported('menu_shift');

    /*
     * Relies on spaces to line things up in columns, so must be rendered
     * with a fixed-width font or will look dreadful.
     */

    putstr(win, 0, 'Menu control keys:');
    if (dolist) { /* key bindings help: '?i' */
        let i, ch;

        for (i = 0; i < DEFAULT_MENU_CMD_INFO.length; i++) {
            ch = DEFAULT_MENU_CMD_INFO[i][1];
            if ((ch === MENU_SHIFT_RIGHT || ch === MENU_SHIFT_LEFT)
                && !has_menu_shift)
                continue;
            buf = `${visctrl(get_menu_cmd_key(ch)).padEnd(7, ' ')} `
                  + DEFAULT_MENU_CMD_DESC[i];
            putstr(win, 0, buf);
        }
        /* no separator before hardcoded */
        fmt = 1;  /* "%s%-7s %s" -- extra specifier absorbs 'arg' */
        arg = ''; /* no extra prefix for 'dolist' */
    } else { /* menu controls help: '?k' */
        putstr(win, 0, '');
        putstr(win, 0, mc_altfmt('', 'Whole', 'Current'));
        putstr(win, 0, mc_altfmt('', ' Menu', ' Page'));
        putstr(win, 0, mc_fmt('Select',
                              visctrl(get_menu_cmd_key(MENU_SELECT_ALL)),
                              visctrl(get_menu_cmd_key(MENU_SELECT_PAGE))));
        putstr(win, 0, mc_fmt('Invert',
                              visctrl(get_menu_cmd_key(MENU_INVERT_ALL)),
                              visctrl(get_menu_cmd_key(MENU_INVERT_PAGE))));
        putstr(win, 0, mc_fmt('Deselect',
                              visctrl(get_menu_cmd_key(MENU_UNSELECT_ALL)),
                              visctrl(get_menu_cmd_key(MENU_UNSELECT_PAGE))));
        putstr(win, 0, '');
        putstr(win, 0, mc_fmt('Go to',
                              visctrl(get_menu_cmd_key(MENU_NEXT_PAGE)),
                              'Next page'));
        putstr(win, 0, mc_fmt('',
                              visctrl(get_menu_cmd_key(MENU_PREVIOUS_PAGE)),
                              'Previous page'));
        putstr(win, 0, mc_fmt('',
                              visctrl(get_menu_cmd_key(MENU_FIRST_PAGE)),
                              'First page'));
        putstr(win, 0, mc_fmt('',
                              visctrl(get_menu_cmd_key(MENU_LAST_PAGE)),
                              'Last page'));
        if (has_menu_shift) {
            putstr(win, 0, mc_fmt('Pan view',
                                  visctrl(get_menu_cmd_key(MENU_SHIFT_RIGHT)),
                                  'Right (perm_invent only)'));
            putstr(win, 0, mc_fmt('',
                                  visctrl(get_menu_cmd_key(MENU_SHIFT_LEFT)),
                                  'Left'));
        }
        putstr(win, 0, '');
        putstr(win, 0, mc_fmt('Search',
                              visctrl(get_menu_cmd_key(MENU_SEARCH)),
            'Exter a target string and invert all matching entries'));
        /* separator before hardcoded */
        putstr(win, 0, '');
        fmt = 2;  /* "%9s  %-8s %s" */
        arg = 'Other '; /* prefix for first hardcoded[] entry, then reset */
    }
    for (const xcp of hardcoded) {
        buf = (fmt === 1) ? `${arg}${xcp[0].padEnd(7, ' ')} ${xcp[1]}`
                          : `${String(arg).padStart(9, ' ')}  `
                            + `${xcp[0].padEnd(8, ' ')} ${xcp[1]}`;
        putstr(win, 0, buf);
        arg = '';
    }
}

// C ref: options.c dotogglepickup() -- the '@' command.  (js/cmd.js inlines the
// same three lines inside its '@' arm.)
export async function dotogglepickup() {
    let buf, ocl;

    game.flags = game.flags || {};
    game.flags.pickup = !game.flags.pickup;
    if (game.flags.pickup) {
        /* C: oc_to_str(flags.pickup_types, ocl) turns the stored CLASS NUMBERS
           into symbols; the port's optfn_pickup_types() keeps the symbol string
           itself (js/cmd.js's '@' arm prints it raw), so no conversion. */
        ocl = game.flags.pickup_types || '';
        buf = `ON, for ${ocl ? ocl : 'all'} objects`
              + ((game.apelist && game.apelist.length)
                 ? ((count_apes() === 1) ? ', with one exception'
                                         : ', with some exceptions')
                 : '');
    } else {
        buf = 'OFF';
    }
    await pline(`Autopickup: ${buf}.`);
    return ECMD_OK;
}

// ---------------------------------------------------------------------------
// #saveoptions -- all_options_strbuf() and its helpers.  C accumulates into a
// strbuf_t; here `sbuf` is { str: '' } and strbuf_append() concatenates.
// js/cfgfiles.js's write_config_file() path is what would call this.

function strbuf_init(sbuf) { sbuf.str = ''; }
function strbuf_append(sbuf, s) { sbuf.str += s; }

// C ref: options.c all_options_conds() -- one OPTIONS=cond_foo,!cond_bar entry,
// wrapped with backslash+newline at 75 columns.  botl.c opt_next_cond() IS
// ported (js/botl.js exports it), but botl.js -> coloratt.js -> options.js is a
// cycle, so it loads on demand; that is the only reason this is async.
export async function all_options_conds(sbuf) {
    let buf = '', nextcond;
    let idx = 0;
    let gotone = false;
    const { opt_next_cond } = await import('./botl.js');
    const out = { buf: '' };

    while (opt_next_cond(idx, out) && (nextcond = out.buf) !== null) {
        /* 75: room for about 5 conditions, with enough space for player
           to edit resulting file manually and insert '!' in front of them */
        if (idx === 0) {
            buf = 'OPTIONS=';
        } else if (buf.length + 1 + nextcond.length >= 75) {
            /* finish off previous line */
            buf += ',\\\n'; /* comma and backslash+newline */
            strbuf_append(sbuf, buf);
            /* indent continuation line */
            buf = ' '.repeat(8); /* 8: strlen("OPTIONS=") */
        } else if (nextcond && gotone) {
            buf += ',';
        }
        if (nextcond) {
            gotone = true;
            buf += nextcond;
        }
        ++idx;
    }
    /* finish off final line; value might be empty if one or more cond_xyz
       options were changed in such a manner that they're all back to their
       default values--which will produce "OPTIONS=" with nothing after the
       equals sign; only add to the output when there is more present */
    if (buf !== 'OPTIONS=') {
        buf += '\n';
        strbuf_append(sbuf, buf);
    }
}

// C ref: options.c all_options_menucolors() -- emitted in REVERSE list order,
// because add_menu_coloring() prepends.
export function all_options_menucolors(sbuf) {
    let i = 0;
    const ncolors = count_menucolors();
    let buf;

    if (!ncolors) return;

    /* reverse the order */
    const arr = [];
    for (const mc of (game.menucolors || [])) arr[i++] = mc;

    for (i = ncolors; i > 0; i--) {
        const tmp = arr[i - 1];
        const sattr = opt_attr2attrname(tmp.attr);
        const sclr = opt_clr2colorname(tmp.color);
        buf = `MENUCOLOR="${tmp.origstr}"=${sclr}`
              + `${(tmp.attr !== ATR_NONE) ? '&' : ''}`
              + `${(tmp.attr !== ATR_NONE) ? sattr : ''}\n`;
        strbuf_append(sbuf, buf);
    }
}

// C ref: options.c all_options_msgtypes().
export function all_options_msgtypes(sbuf) {
    let buf;

    for (const tmp of (game.msgtypes || [])) {
        const mtype = msgtype2name(tmp.msgtype);
        buf = `MSGTYPE=${mtype} "${tmp.pattern}"\n`;
        strbuf_append(sbuf, buf);
    }
}

// C ref: options.c all_options_apes().
export function all_options_apes(sbuf) {
    let buf;

    for (const tmp of (game.apelist || [])) {
        buf = `autopickup_exception="${tmp.grab ? '<' : '>'}${tmp.pattern}"\n`;
        strbuf_append(sbuf, buf);
    }
}

// C ref: options.c all_options_palette() -- inside #ifdef CHANGE_COLOR, so it
// is not compiled in this build (ga.altpalette[] is never populated either).
export function all_options_palette(sbuf) {
    const altpalette = (game.altpalette || []);
    let clr, buf;
    const n = altpalette.filter((v) => v).length; /* count_alt_palette() */

    if (!n) return;

    for (clr = 0; clr < CLR_MAX; ++clr) {
        if (altpalette[clr]) {
            const hex = (altpalette[clr] & 0xffffff).toString(16)
                            .padStart(6, '0');
            buf = `OPTIONS=palette:${opt_clr2colorname(clr)}/#${hex}\n`;
            strbuf_append(sbuf, buf);
        }
    }
}

// C ref: options.c all_options_strbuf() -- the whole new config file.
// opt_set_in_config[] is C's "this option was actually set in the RC file"
// bitmap; the port records the same thing as the presence of a key on
// game.flags/game.iflags, so `optset` below stands in for it.
export async function all_options_strbuf(sbuf) {
    let name, tmp, buf2, i;

    strbuf_init(sbuf);
    tmp = `# NetHack config, saved ${yyyymmddhhmmss(0)}\n#\n`;
    strbuf_append(sbuf, tmp);

    const optset = (nm) => (game.flags && Object.hasOwn(game.flags, nm))
                        || (game.iflags && Object.hasOwn(game.iflags, nm));

    for (i = 0; i < OPTCOUNT && (name = ALLOPT[i].name); i++) {
        if (!optset(name)) continue;
        switch (ALLOPT[i].typ) {
        case 'B': {
            if (ALLOPT[i].noaddr || name === 'female')
                break; /* obsolete */
            const val = !!(game.flags && game.flags[name]);
            /* allopt[].initval; the parser only records a boolean it saw, so
               anything present here differs from the compiled-in default */
            tmp = `OPTIONS=${val ? '' : '!'}${name}\n`;
            strbuf_append(sbuf, tmp);
            break;
        }
        case 'C': {
            const sw = opt_setwhere(i);
            if (!(sw === SET_IN_CONFIG || sw === SET_GAMEVIEW
                  || sw === SET_IN_GAME))
                break;
            /* FIXME: get_option_value for:
               - menu_deselect_all &c menu control keys,
               - term_cols, term_rows */
            buf2 = get_option_value(name, true);
            if (buf2) {
                tmp = `OPTIONS=${name}:${buf2}`.slice(0, BUFSZ - 1);
                tmp += '\n'; /* guaranteed to fit */
                strbuf_append(sbuf, tmp);
            }
            break;
        }
        case 'O':
            break;
        }
    }

    /* cond_xyz are closer to regular options than the other 'other opts'
       so put them next; [pfx_cond_] will be set if any cond_Foo were
       present when RC file was read in or if player made any changes via
       status conditions menu; ignore opt_set_in_config[opt_o_status_cond] */
    if (game.conds && Object.keys(game.conds).length)
        await all_options_conds(sbuf);

    /* #ifdef CHANGE_COLOR all_options_palette(sbuf) -- not this build */
    /* cmd.c get_changed_key_binds() and symbols.c savedsym_strbuf() have no
       port; the rest of the file is written below. */
    all_options_menucolors(sbuf);
    all_options_msgtypes(sbuf);
    all_options_apes(sbuf);
    /* cmd.c all_options_autocomplete() has no port either */
    /* #ifdef STATUS_HILITES all_options_statushilites(sbuf) -- botl.c */

    if (game.wizkit) {
        tmp = `WIZKIT=${game.wizkit}\n`;
        strbuf_append(sbuf, tmp);
    }
}

// C ref: hacklib.c yyyymmddhhmmss(0) -- "now", as 14 digits of local time.
function yyyymmddhhmmss(when) {
    const d = when ? new Date(when * 1000) : new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`
           + `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// optfn_*() / pfxfn_*() that this build compiles OUT.  They are here for
// completeness -- the option names they serve are absent from ALLOPT, so
// parseoptions() can never reach them and no OPTFN entry points at them.
//   optfn_cursesgraphics  #ifdef CURSES_GRAPHICS  (config.h: commented out)
//   optfn_palette         #ifdef CHANGE_COLOR     (windconf/amiconf only)
//   optfn_videocolors,
//   optfn_videoshades     #ifdef VIDEOSHADES      (MSDOS)
//   optfn_video_width,
//   optfn_video_height,
//   optfn_video           #ifdef MSDOS [+ NO_TERMS]
//   optfn_windowchain     #ifdef WINCHAIN
//   optfn_subkeyvalue     #ifdef WIN32CON
//   pfxfn_IBM_            #if defined(MICRO) && !defined(AMIGA)
// C's five request modes are do_init / do_set / get_val / get_cnf_val; the
// port's optfn_*() are do_set-only, so these keep the same shape.

// C ref: options.c optfn_cursesgraphics() -- with BACKWARD_COMPAT defined (it
// is, unconditionally, in optlist.h) this is "symset:cursesgraphics".
export function optfn_cursesgraphics(o, negated, opts, op, result) {
    let badflag = false;

    if (!negated) {
        /* There is no rogue level cursesgraphics-specific set */
        if (result.symset) {
            badflag = true;
        } else if (!read_sym_file(o.name)) {
            badflag = true;
        } else {
            result.symset = o.name;
        }
        if (badflag) {
            config_error_add(`Failure to load symbol set ${o.name}.`);
            return OPTN_ERR;
        }
    }
    return OPTN_OK;
}

// C ref: options.c optfn_palette() -- the non-MACOS9 variant; the OS9 one is
// inside `#if 0`.  alternative_palette() is coloratt.c's "color/#RRGGBB" parser,
// which has no port, so the value is validated only for shape here.
export function optfn_palette(o, negated, opts, op, result) {
    if (op === '') return OPTN_ERR;

    if (match_optname(opts, 'palette', 3, true)) {
        /*
         *  palette (adjust an RGB color in palette (color/R-G-B)
         */
        if (!alternative_palette(op, result)) {
            config_error_add(`Error in palette parameter '${op}'`);
            return OPTN_ERR;
        }
        if (!opt_initial) opt_update_basic_palette = true;
    }
    return OPTN_OK;
}

// C ref: coloratt.c alternative_palette() -- "<colorname>/#rrggbb" (or
// "/r-g-b"); stores into ga.altpalette[clr] with COLORVAL packing.
function alternative_palette(op, result) {
    const slash = op.indexOf('/');
    if (slash < 0) return false;
    const clr = match_str2clr(op.slice(0, slash), true);
    if (clr < 0 || clr >= CLR_MAX) return false;
    let spec = op.slice(slash + 1);
    let rgb = -1;
    if (spec[0] === '#') {
        if (!/^[0-9a-fA-F]{6}$/.test(spec.slice(1))) return false;
        rgb = parseInt(spec.slice(1), 16);
    } else {
        const parts = spec.split('-');
        if (parts.length !== 3) return false;
        const v = parts.map((p) => parseInt(p, 10));
        if (v.some((x) => !(x >= 0 && x <= 255))) return false;
        rgb = (v[0] << 16) | (v[1] << 8) | v[2];
    }
    const tgt = result || game;
    tgt.altpalette = tgt.altpalette || new Array(CLR_MAX).fill(0);
    /* COLORVAL() keeps the low 24 bits; the high bit marks "set" */
    tgt.altpalette[clr] = rgb | 0x1000000;
    return true;
}

// C ref: options.c optfn_videocolors() -- MSDOS ttycolors[] remap.
export function optfn_videocolors(o, negated, opts, op, result) {
    opts = string_for_env_opt(o.name, opts, false);
    if (opts === '') return OPTN_ERR;
    if (!assign_videocolors(opts, result)) {
        config_error_add(`Unknown error handling '${o.name}'`);
        return OPTN_ERR;
    }
    return OPTN_OK;
}

// C ref: options.c optfn_videoshades().
export function optfn_videoshades(o, negated, opts, op, result) {
    opts = string_for_env_opt(o.name, opts, false);
    if (opts === '') return OPTN_ERR;
    if (!assign_videoshades(opts, result)) {
        config_error_add(`Unknown error handling '${o.name}'`);
        return OPTN_ERR;
    }
    return OPTN_OK;
}

// C ref: sys/share/pcvideo.c assign_videocolors()/assign_videoshades() -- the
// MSDOS-only "-"-separated remaps; nothing outside MSDOS ever calls them.
function assign_videocolors(op, result) {
    const parts = String(op).split('-');
    if (parts.length !== 12) return false;
    const v = parts.map((p) => parseInt(p, 10));
    if (v.some((x) => !(x >= 0 && x < CLR_MAX))) return false;
    (result || game).ttycolors = v;
    return true;
}
function assign_videoshades(op, result) {
    const parts = String(op).split('-');
    if (parts.length !== 3) return false;
    (result || game).shade = parts;
    return true;
}

// C ref: options.c optfn_video_width()/optfn_video_height() -- note both pass
// `negated` as string_for_opt()'s val_optional, so "!video_width" is accepted
// and silently sets nothing.
export function optfn_video_width(o, negated, opts, op, result) {
    op = string_for_opt(opts, negated);
    if (op !== '') result.iflags.wc_video_width = parseInt(op, 10) || 0;
    else return OPTN_ERR;
    return OPTN_OK;
}
export function optfn_video_height(o, negated, opts, op, result) {
    op = string_for_opt(opts, negated);
    if (op !== '') result.iflags.wc_video_height = parseInt(op, 10) || 0;
    else return OPTN_ERR;
    return OPTN_OK;
}

// C ref: options.c optfn_video() -- #ifdef NO_TERMS inside #ifdef MSDOS.
export function optfn_video(o, negated, opts, op, result) {
    opts = string_for_env_opt(o.name, opts, false);
    if (opts === '') return OPTN_ERR;
    if (!assign_video(opts, result)) {
        config_error_add(`Unknown error handling '${o.name}'`);
        return OPTN_ERR;
    }
    return OPTN_OK;
}

// C ref: sys/share/pcvideo.c assign_video() -- "autodetect", "default" or "vga".
function assign_video(op, result) {
    for (const nm of ['autodetect', 'default', 'vga'])
        if (strcmpi_eq(op, nm)) { (result || game).video = nm; return true; }
    return false;
}

// C ref: options.c optfn_windowchain() -- #ifdef WINCHAIN; addto_windowchain()
// is win/win32/winchain.c's and has no port.
export function optfn_windowchain(o, negated, opts, op, result) {
    op = string_for_env_opt(o.name, opts, false);
    if (op !== '') {
        const WINTYPELEN = 16;
        const buf = nmcpy(op, WINTYPELEN);
        result.windowchain = (result.windowchain || []).concat([buf]);
    } else {
        return OPTN_ERR;
    }
    return OPTN_OK;
}

// C ref: options.c optfn_subkeyvalue() -- #ifdef WIN32CON; map_subkeyvalue()
// is a Windows console scancode remap.
export function optfn_subkeyvalue(o, negated, opts, op, result) {
    if (op === '') return OPTN_ERR;
    /* #ifdef TTY_GRAPHICS map_subkeyvalue(op) -- WIN32CON only */
    return OPTN_OK;
}

// C ref: options.c pfxfn_IBM_() -- the "IBM_" prefix option; every request mode
// is a no-op, it exists only so the name matches instead of erroring.
export function pfxfn_IBM_(o, negated, opts, op, result) {
    return OPTN_OK;
}

// ---------------------------------------------------------------------------
// fruitadd() -- register the player's named fruit (or a fruit name arriving
// from a bones file / orctown loot) and return its fid.

const PL_FSIZ = 32;   /* global.h -- fruit name */
const FOOD_CLASS = 7; /* objclass.h */

// C ref: objnam.c fruit_from_name(fname, exact, &highest_fid).  js/objnam.js
// has no port of it yet, so this private copy keeps fruitadd() faithful;
// delete it in favour of an objnam.js export when that lands.  Returns
// { f, highest_fid }.
function fruit_from_name_local(fname, exact) {
    let f, tentativef, altfname, k;
    let highest_fid = 0;
    const chain = () => {
        const out = [];
        for (let p = game.ffruit; p; p = p.nextf) out.push(p);
        return out;
    };

    /* note: named fruits are case-sensitive... */
    /* first try for an exact match */
    for (f of chain()) {
        if (f.fname === fname) return { f, highest_fid };
        else if (f.fid > highest_fid) highest_fid = f.fid;
    }

    /* didn't match as-is; if caller is willing to accept a prefix match, try
       to find one; we want the LONGEST prefix that matches, not the first */
    f = null;
    if (!exact) {
        tentativef = null;
        for (const g of chain()) {
            k = g.fname.length;
            if (fname.slice(0, k) === g.fname
                && (!fname[k] || fname[k] === ' ')
                && (!tentativef || k > tentativef.fname.length))
                tentativef = g;
        }
        f = tentativef;
    }
    /* if we still don't have a match, try singularizing the target */
    if (!f) {
        altfname = makesingular(fname);
        for (const g of chain()) if (g.fname === altfname) { f = g; break; }
    }
    if (!f && !exact) {
        const fname_k = fname.length; /* length of assumed plural fname */

        tentativef = null;
        for (const g of chain()) {
            k = g.fname.length;
            let fnamebuf = fname;
            /* bug? if singular of fname is longer than plural, failing the
               'fname_k > k' test could skip a viable candidate ... compromise
               and use 'fname_k >= k' */
            const sp = fnamebuf.indexOf(' ', k);
            if (fname_k >= k && sp >= 0) {
                fnamebuf = fnamebuf.slice(0, sp);
                altfname = makesingular(fnamebuf);
                k = altfname.length; /* actually revised 'fname_k' */
                if (g.fname === altfname
                    && (!tentativef || k > tentativef.fname.length))
                    tentativef = g;
            }
        }
        f = tentativef;
    }
    return { f: f || null, highest_fid };
}

// C ref: objclass.h svb.bases[FOOD_CLASS] -- where fruitadd()'s "is this the
// name of a real food?" scan starts.  init_objects() fills bases[] in, so the
// call from initoptions_finish() (which runs BEFORE init_objects()) sees 0,
// objects[0] is STRANGE_OBJECT/ILLOBJ_CLASS, and the scan does nothing -- which
// is exactly why the default "slime mold" is not renamed to "candied slime
// mold".  js/o_init.js and js/objnam.js each keep a PRIVATE bases[]; when one
// of them publishes it (as game.svb.bases), this reads the real value and the
// post-init_objects behaviour follows with no other change.
function svb_bases_food() {
    return (game.svb && game.svb.bases && game.svb.bases[FOOD_CLASS]) || 0;
}

// C ref: options.c fruitadd().  `str === game.svp.pl_fruit` is C's
// `user_specified` test: the option's own buffer, not a copy.
export function fruitadd(str, replace_fruit) {
    let i, f;
    let highest_fruit_id = 0, globpfx;
    let buf, altname = '';
    game.svp = game.svp || {};
    game.flags = game.flags || {};
    const user_specified = (str === game.svp.pl_fruit);
    /* if not user-specified, then it's a fruit name for a fruit on
     * a bones level or from orctown raider's loot...
     */

    /* Note: every fruit has an id (kept in obj->spe) of at least 1;
     * 0 is an error.
     */
    if (user_specified) {
        let found = false, numeric = false;

        /* force fruit to be singular; this handling is not needed--or
           wanted--for fruits from bones because they already received it in
           their original game */
        game.svp.pl_fruit = nmcpy(makesingular(str), PL_FSIZ);

        /* disallow naming after other foods (since it'd be impossible
         * to tell the difference); globs might have a size prefix which
         * needs to be skipped in order to match the object type name
         */
        const pf = () => game.svp.pl_fruit;
        globpfx = (pf().startsWith('small ') || pf().startsWith('large ')) ? 6
                  : pf().startsWith('medium ') ? 7
                  : pf().startsWith('very large ') ? 11
                  : 0;
        for (i = svb_bases_food(); objects[i]
                                   && objects[i].oc_class === FOOD_CLASS; i++) {
            if (objects[i].name === pf()
                || (globpfx > 0 && objects[i].name === pf().slice(globpfx))) {
                found = true;
                break;
            }
        }
        if (!found) {
            let c = 0;
            while (c < pf().length && pf()[c] >= '0' && pf()[c] <= '9') c++;
            if (c >= pf().length || isspace(pf()[c])) numeric = true;
        }
        if (found || numeric
            /* these checks for applying food attributes to actual items
               are case sensitive; "glob of foo" is caught by 'found'
               if 'foo' is a valid glob; when not valid, allow it as-is */
            || pf().startsWith('cursed ')
            || pf().startsWith('uncursed ')
            || pf().startsWith('blessed ')
            || pf().startsWith('partly eaten ')
            || (pf().startsWith('tin of ')
                && (pf().slice(7) === 'spinach'
                    || name_to_pmidx(pf().slice(7)) >= 0))
            || pf() === 'empty tin'
            || (pf() === 'glob'
                || (globpfx > 0 && 'glob' === pf().slice(globpfx)))
            || ((pf().endsWith(' corpse') || pf().endsWith(' egg'))
                && name_to_pmidx(pf()) >= 0)) {
            buf = pf();
            game.svp.pl_fruit = 'candied ' + nmcpy(buf, PL_FSIZ - 8);
        }
        altname = '';
        /* This flag indicates that a fruit has been made since the
         * last time the user set the fruit.  If it hasn't, we can
         * safely overwrite the current fruit, preventing the user from
         * setting many fruits in a row and overflowing.
         */
        game.flags.made_fruit = false;
        if (replace_fruit) {
            /* replace_fruit is already part of the fruit chain;
               update it in place rather than looking it up again */
            f = replace_fruit;
            f.fname = game.svp.pl_fruit.slice(0, PL_FSIZ - 1);
            return fruitadd_nonew(f, user_specified);
        }
    } else {
        /* not user_supplied, so assumed to be from bones (or orc gang) */
        altname = sanitize_name(String(str).slice(0, PL_FSIZ - 1));
        game.flags.made_fruit = true; /* for safety.  Any fruit name added
                                       * from a bones level should exist. */
    }
    /* C's `str` IS svp.pl_fruit when user_specified (the caller passes that
       buffer), so the nmcpy()s above are visible through it -- e.g. "apples"
       has become "candied apple" by now.  JS strings don't alias, so read the
       buffer back instead of the argument. */
    const lookup = user_specified ? game.svp.pl_fruit : str;
    const found = fruit_from_name_local(altname ? altname : lookup, false);
    f = found.f;
    highest_fruit_id = found.highest_fid;
    if (f) return fruitadd_nonew(f, user_specified);

    /* Maximum number of named fruits is 127, even if obj->spe can
       handle bigger values.  If adding another fruit would overflow,
       use a random fruit instead... we've got a lot to choose from.
       current_fruit remains as is. */
    if (highest_fruit_id >= 127) return rnd(127);

    f = { fname: String(altname ? altname : lookup).slice(0, PL_FSIZ - 1),
          fid: ++highest_fruit_id, nextf: null };
    /* we used to go out of our way to add it at the end of the list,
       but the order is arbitrary so use simpler insertion at start */
    f.nextf = game.ffruit || null;
    game.ffruit = f;
    return fruitadd_nonew(f, user_specified);
}

// C ref: options.c fruitadd()'s `nonew:` label.
function fruitadd_nonew(f, user_specified) {
    if (user_specified) {
        game.context = game.context || {};
        game.context.current_fruit = f.fid;
    }
    return f.fid;
}

// ---------------------------------------------------------------------------
// initoptions() and friends.  The port does this work at module load (see
// determine_ambiguities() above) and in js/cfgfiles.js rcfile(); these are the
// C functions themselves, for the day the startup sequence is driven from here.

// C ref: options.c allopt_array_init() -- copy allopt_init[] over allopt[],
// compute the minmatch lengths, apply every initval, then give each option
// function its do_init call.  Runs once per process.
let options_array_inited_already = false;
export function allopt_array_init() {
    let i;

    if (!options_array_inited_already) {
        /* memcpy(allopt, allopt_init, sizeof(allopt)): ALLOPT is built from
           ALLOPT_META_DATA once, at module load, so there is nothing to copy */
        determine_ambiguities();
        for (i = 0; i < OPTCOUNT; i++) {
            /* `if (allopt[i].addr) *(allopt[i].addr) = allopt[i].initval` --
               the port has no addr column; parseNethackrc() starts from an
               empty flags/iflags and every reader supplies the same default. */
            void i;
        }
        heed_all_options();
        /*
         * Call each option function with an init flag and give it a chance
         * to make any preparations that it might require.  We do this
         * whether or not the option itself is ever specified.
         *
         * Every optfn_*()'s do_init arm in options.c is `return optn_ok`, so
         * the port's do_set-only option functions lose nothing by skipping it.
         */
        options_array_inited_already = true;
    }
}

// C ref: options.c initoptions_init() -- the compiled-in defaults, before any
// config file is read.  Steps with no counterpart in this port are named in the
// comments rather than silently dropped.
export function initoptions_init() {
    let i;
    const have_branch = false; /* nomakedefs.git_branch is empty when released */

    opt_phase = BUILTIN_OPT;    /* Did I need to move this here? */
    /* sf_init() -- js/storage.js owns the save format */
    allopt_array_init();
    /* gc.cmdline_windowsys: the harness never passes -windowtype */
    /* fill_glyphid_cache() -- js/symbols.js builds its caches lazily */
    /* reset_commands(TRUE) -- js/cmd.js builds its dispatch from game.flags */
    /* init_random(rn2)/init_random(rn2_on_display_rng) -- frozen/rng.js */

    opt_phase = BUILTIN_OPT;
    game.flags = game.flags || {};
    game.iflags = game.iflags || {};
    const flags = game.flags, iflags = game.iflags;

    flags.end_own = false;
    flags.end_top = 3;
    flags.end_around = 2;
    /* PARANOID_PRAY | PARANOID_SWIM | PARANOID_TRAP */
    flags.paranoia_bits = 0x0400 | 0x2000 | 0x0800;
    flags.versinfo = have_branch ? 4 : 1;
    flags.pile_limit = PILE_LIMIT_DFLT;  /* 5 */
    flags.runmode = 'teleport';          /* RUN_LEAP; port stores the name */
    iflags.msg_history = 20;

    /* msg_window has conflicting defaults for multi-interface binary */
    iflags.prevmsg_window = 's';         /* #ifdef TTY_GRAPHICS */

    iflags.menu_headings = { attr: ATR_INVERSE, color: NO_COLOR_IDX };
    iflags.getpos_coords = GPCOORDS_NONE;

    /* hero's role, race, &c haven't been chosen yet */
    flags.initrole = flags.initrace = flags.initgend = flags.initalign
        = ROLE_NONE;

    /* init_ov_primary_symbols()/init_ov_rogue_symbols()/init_symbols() and
       gw.warnsyms[] -- js/symbols.js */

    flags.inv_order = DEF_INV_ORDER.slice();
    flags.pickup_types = '';
    flags.pickup_burden = 2;             /* MOD_ENCUMBER */
    flags.sortloot = 'l'; /* sort only loot by default */

    flags.end_disclose = new Array(NUM_DISCLOSURE_OPTIONS)
        .fill(DISCLOSE_PROMPT_DEFAULT_NO);
    /* switch_symbols(FALSE)/init_rogue_symbols() -- js/symbols.js */
    /* the UNIX TERM=AT / TERM=vt* symset autodetection: the recorder's TERM is
       neither, so neither load_symset() runs */

    flags.menustyle = 'f';               /* MENU_FULL; port stores the letter */

    iflags.wc_align_message = ALIGN_TOP;
    iflags.wc_align_status = ALIGN_BOTTOM;
    /* used by tty and curses */
    iflags.wc2_statuslines = 2;
    iflags.wc2_petattr = ATR_INVERSE;
    /* only used by curses */
    iflags.wc2_windowborders = 2; /* 'Auto' */

    /*
     * 'menuinvertmode' controls how 'skip-invert' menu items behave:
     * 0: ignore the flag; 1: don't toggle them On for set-all/set-page/
     * invert-all/invert-page but do toggle Off if already set (default);
     * 2: don't toggle them either way.
     */
    iflags.menuinvertmode = 1;

    /* since this is done before init_objects(), do partial init here */
    game.svp = game.svp || {};
    game.svp.pl_fruit = nmcpy(objects[SLIME_MOLD()]
                              ? objects[SLIME_MOLD()].name : 'slime mold',
                              PL_FSIZ);

    /* #ifdef SYSCF_FILE read_config_file(SYSCF_FILE, set_in_sysconf):
       js/cfgfiles.js owns the sysconf pass */
    void i;
}

// C ref: objects[SLIME_MOLD] -- the fruit's default name comes from the object
// whose name initoptions_finish() then overrides with "fruit".  Resolved on
// first use, not at module load: `objects` is an imported binding and this file
// is on a cycle with js/coloratt.js and js/symbols.js.
let slime_mold_otyp = -2;
function SLIME_MOLD() {
    if (slime_mold_otyp === -2)
        slime_mold_otyp = objects.findIndex((o) => o && o.name === 'slime mold');
    return slime_mold_otyp;
}

// C ref: options.c initoptions_finish() -- runs the RC file, then the
// after-the-fact fixups.
export function initoptions_finish() {
    /* rcfile() -- js/cfgfiles.js */

    fruitadd(game.svp && game.svp.pl_fruit, null);
    /*
     * Remove "slime mold" from list of object names.  This will
     * prevent it from being wished unless it's actually present
     * as a named (or default) fruit.  Wishing for "fruit" will
     * result in the player's preferred fruit.
     */
    if (objects[SLIME_MOLD()]) game.obj_descr_fruit_override = 'fruit';

    /* get_othersym(SYM_BOULDER, ...)/reglyph_darkroom()/reset_glyphmap() --
       js/symbols.js and js/display.js */

    /* #ifdef STATUS_HILITES: a multi-interface binary might not support status
       highlighting for the active interface */
    if (game.iflags && game.iflags.hilite_delta
        && !wc2_supported('statushilites')) {
        raw_print('Status highlighting not supported for tty interface.');
        game.iflags.hilite_delta = 0;
    }
    /* update_rest_on_space() -- js/cmd.js */

    /* these can't rely on compile-time initialization for their defaults
       because a multi-interface binary might need different values for
       different interfaces; if neither tiled_map nor ascii_map pass the
       wc_supported() test, assume ascii_map */
    const iflags = (game.iflags = game.iflags || {});
    if (iflags.wc_tiled_map && !wc_supported('tiled_map')) {
        iflags.wc_tiled_map = false; iflags.wc_ascii_map = true;
    } else if (iflags.wc_ascii_map && !wc_supported('ascii_map')
               && wc_supported('tiled_map')) {
        iflags.wc_ascii_map = false; iflags.wc_tiled_map = true;
    }

    /* #ifdef ENHANCED_SYMBOLS apply_customizations() -- js/symbols.js */
    opt_initial = false;
    return;
}

// C ref: options.c initoptions() -- initoptions_init() unless it has already
// run, then the sysconf pass, then initoptions_finish().
export function initoptions() {
    /*
     * Most places that call initoptions_init()/initoptions() would
     * have the calls next to each other, so instead of adding
     * initoptions_init() everywhere, just add it where it's needed in
     * a non-adjacent place and call it here for all the other cases.
     */
    if (opt_phase !== BUILTIN_OPT) initoptions_init();
    /* #ifdef SYSCF_FILE: assure_syscf_file() + read_config_file(SYSCF_FILE,
       set_in_sysconf) -- js/cfgfiles.js owns that pass */
    /* gd.deferred_showpaths: -showpaths is never passed by the harness */
    initoptions_finish();
}
