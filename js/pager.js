// pager.js — help/pager commands (pager.c).
//
// C ref: src/pager.c dohelp() (the '?' command) and the shared display_file()
// path.  dohelp() pops a PICK_ONE menu of help topics ("Select one item:") and
// runs the chosen topic's handler; most handlers display a full-screen NHW_TEXT
// window (version info, the long-description help file, the license, etc.).
//
// The menu is an overlay NHW_MENU (offx > 0): the columns to its left and the
// rows below it keep showing the underlying map, exactly like C's tty
// tty_display_nhwindow() which repaints only the window's own cells.  The topic
// windows are full-screen NHW_TEXT windows paged with "--More--".
//
// No dungeon RNG is consumed and no game time elapses (dohelp returns ECMD_OK).

import { game } from './gstate.js';
import { nhgetch } from './input.js';
import { render_map_to_grid, pline, topl_more, flush_screen } from './display.js';
import { renderWindowScreen, dismiss_invent_screen } from './invent.js';
import { doextversion } from './version.js';
import { option_help_lines } from './options.js';
import { NO_COLOR, ATR_INVERSE } from './terminal.js';
import { HELP, SHELP, HISTORY, OPTIONFILE, OPTMENUHELP, USAGEHELP, LICENSE }
    from './pager_data.js';
import { EXTCMD_TABLE } from './cmd_data.js';
// cmd.js <-> pager.js is a static cycle (cmd.js imports dohelp); both names
// crossing it are hoisted `export function` declarations, so it resolves.
import { Cmd_dirchars, Cmd_num_pad, Cmd_pcHack_compat } from './cmd.js';

const COLS = 80;
const ROWS = 24;

function disp() { return game.nhDisplay; }

// ---------------------------------------------------------------------------
// Shared full-screen text-window pager.
//
// C ref: win/tty/wintty.c process_text_window() — a full-screen NHW_TEXT window
// shows (rows-1) = 23 content lines per page, with "--More--" parked at row
// (rows-1) = 23; every page (including the last) shows "--More--" because dmore
// falls back to defmorestr for text windows.  The --More-- prompt is
// xwaitforspace(quitchars) with quitchars = " \r\n\033": <space>/<return>
// advance to the next page (and dismiss after the last), <esc> cancels the rest
// of the document, and any OTHER key rings the bell and is ignored — the same
// page stays shown and is re-read.  On dismissal tty tears the window down and
// the map is redrawn (docrt), which dismiss_invent_screen() reproduces.
//
// C ref: win/tty/wintty.c compress_str() — a menu/text-window line that is at
// least CO chars long (or holds a newline) has newlines turned into spaces and
// every run of spaces collapsed to one; was_space starts TRUE, so leading
// spaces are dropped entirely, and a trailing space is trimmed.
function compress_str(str) {
    if (str.length < COLS && str.indexOf('\n') < 0) return str;
    let out = '', was = true;
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

// C ref: win/tty/wintty.c tty_putstr() NHW_MENU/NHW_TEXT branch — after
// compress_str(), a line with strlen()+1 > CO is broken at the last space at or
// before index CO-1 (`data[++i] = '\0'` nulls the space, so it is dropped) and
// the tail is tty_putstr()'d again with the same attr.  With no such space the
// scan runs down to i == 0 and the over-long line is stored whole, to be
// truncated at display time by process_text_window().
function tty_putstr_text(out, ln) {
    const isStr = typeof ln === 'string';
    const mk = (t) => (isStr ? t : { ...ln, text: t });
    let str = compress_str(String(isStr ? ln : (ln?.text ?? '')));
    for (;;) {
        if (str.length + 1 > COLS) {
            let i = COLS - 1;
            while (i && str[i] !== ' ' && str[i] !== '\n') i--;
            if (i) {
                out.push(mk(str.slice(0, i)));
                str = str.slice(i + 1);
                continue;
            }
        }
        out.push(mk(str));
        break;
    }
}

// `lines` may be plain strings (ATR_NONE) or {text, attr} objects.
export async function display_text_window(lines) {
    // C ref: win/tty/wintty.c tty_putstr() — every string reaching a text
    // window is compress_str()'d and line-broken before it is ever paged.
    const wrapped = [];
    for (const ln of lines) tty_putstr_text(wrapped, ln);
    const perPage = ROWS - 1; // 23 content lines; footer on row 23
    const pages = [];
    for (let i = 0; i < wrapped.length; i += perPage)
        pages.push(wrapped.slice(i, i + perPage));
    if (pages.length === 0) pages.push([]);

    let pi = 0;
    while (pi < pages.length) {
        renderWindowScreen(pages[pi], {
            menu: false,
            footer: '--More--',
            footerRow: ROWS - 1,
            footerCol: 0,
            modal: 'textwin',
        });
        const c = await nhgetch();
        if (c === 27) break;                       // ESC: cancel remaining pages
        if (c === 32 || c === 13 || c === 10) { pi++; continue; } // advance
        // any other key: ignored (bell) — re-render the same page and re-read
    }
    // Tear the window down and restore the map (docrt + flush_screen).
    await dismiss_invent_screen();
}

// C ref: pager.c display_file(fname, complain) -> win/tty/wintty.c
// tty_display_file(): read the named help/data file line by line (newline
// stripped, tabs expanded) into a full-screen NHW_TEXT window and page it with
// "--More--".  The file contents are build-constant, embedded in pager_data.js.
export async function display_file(lines) {
    await display_text_window(lines);
}

// ---------------------------------------------------------------------------
// dohelp() — the '?' help menu.

// C ref: pager.c help_menu_items[] — the ordered list of help topics.  Each
// entry has a display string and a handler.  dispfile_debughelp ("List of
// wizard-mode commands.") is only shown in debug/wizard mode; the '%s' text
// slot is the "Using the ... command to set options." line, whose %s is filled
// by setopt_cmd() — for this build (O bound to doset_simple, #optionsfull with
// no key) that expands to "'#optionsfull' or 'm O'".
const HELP_MENU_ITEMS = [
    { text: 'About NetHack (version information).', fn: hmenu_doextversion },
    { text: 'Long description of the game and commands.', fn: dispfile_help },
    { text: 'List of game commands.', fn: dispfile_shelp },
    { text: 'Concise history of NetHack.', fn: dohistory },
    { text: 'Info on a character in the game display.', fn: hmenu_dowhatis },
    { text: 'Info on what a given key does.', fn: dowhatdoes },
    { text: 'List of game options.', fn: option_help },
    { text: 'Longer explanation of game options.', fn: dispfile_optionfile },
    { text: "Using the '#optionsfull' or 'm O' command to set options.", fn: dispfile_optmenu },
    { text: 'Full list of keyboard commands.', fn: dokeylist },
    { text: 'List of extended commands.', fn: null },
    { text: 'List menu control keys.', fn: domenucontrols },
    { text: "Description of NetHack's command line.", fn: dispfile_usagehelp },
    { text: 'The NetHack license.', fn: dispfile_license },
    { text: 'Support information.', fn: docontact },
    { text: 'List of wizard-mode commands.', fn: null, wizonly: true },
];

// C ref: pager.c hmenu_dowhatis() — `do_look(0, (coord *) 0)`, the same full
// whatis the '/' command runs.  Dynamic import: hack.js imports this file.
async function hmenu_dowhatis() {
    const { do_look_full } = await import('./hack.js');
    await do_look_full();
}

// C ref: pager.c hmenu_doextversion()/dispfile_*()/dohistory() — thin wrappers
// that each display one help/data file (or the version info) full-screen.
async function hmenu_doextversion() { await doextversion(); }
// C ref: options.c option_help() — full-screen text window listing all options.
async function option_help() { await display_text_window(option_help_lines()); }
async function dispfile_help() { await display_file(HELP); }
async function dispfile_shelp() { await display_file(SHELP); }
async function dohistory() { await display_file(HISTORY); }
async function dispfile_optionfile() { await display_file(OPTIONFILE); }
async function dispfile_optmenu() { await display_file(OPTMENUHELP); }
async function dispfile_usagehelp() { await display_file(USAGEHELP); }
async function dispfile_license() { await display_file(LICENSE); }

// C ref: pager.c docontact() — "Support information." full-screen text window.
// The sysopt.support / SYSCF-WIZARDS branches print a "local support" line only
// when the build's sysconf sets them; this build sets neither, so only the
// development-team lines show.  DEVTEAM_EMAIL / DEVTEAM_URL are build-constant
// macros from include/hack.h.
const DEVTEAM_EMAIL = 'devteam@nethack.org';
const DEVTEAM_URL = 'https://www.nethack.org/';
async function docontact() {
    await display_text_window([
        'To contact the NetHack development team directly,',
        `see the 'Contact' form on our website or email <${DEVTEAM_EMAIL}>.`,
        '',
        'For more information on NetHack, or to report a bug,',
        `visit our website "${DEVTEAM_URL}".`,
    ]);
}

// ---------------------------------------------------------------------------
// dowhatdoes() — the "Info on what a given key does" help choice ('?f'), also
// the #whatdoes extended command.  C ref: pager.c dowhatdoes().

// C ref: hacklib.c visctrl() — printable representation of a key: M- prefix for
// the meta bit, ^X for control chars, ^? for DEL, else the character itself.
function visctrl(c) {
    let out = '';
    if (c & 0x80) out += 'M-';
    c &= 0x7f;
    if (c < 0o40) out += '^' + String.fromCharCode(c | 0o100);
    else if (c === 0o177) out += '^' + String.fromCharCode(c & ~0o100);
    else out += String.fromCharCode(c);
    return out;
}

// C ref: cmd.c key2txt() — like visctrl() but with word forms for the keys
// whose visctrl form would be ambiguous/unreadable in a help listing.
function key2txt(c) {
    if (c === 0x20) return '<space>';
    if (c === 0o33) return '<esc>';
    if (c === 0x0a) return '<enter>';
    if (c === 0o177) return '<del>';
    return visctrl(c);
}

// Default rogue-like movement keys (number_pad off): walk = h j k l y u b n,
// run = the capitalized forms, rush = the Ctrl forms.  C ref: cmd.c movecmd()
// against the default gc.Cmd movement keymap.
function movecmd(key, mode) {
    // C ref: cmd.c reset_commands() — with number_pad the run key is M(digit)
    // and there is no per-direction rush key at all.
    const dirs = Cmd_dirchars().slice(0, 8);
    const ch = String.fromCharCode(key & 0xff);
    if (mode === 'walk') return dirs.includes(ch);
    if (Cmd_num_pad())
        return mode === 'run' && dirs.includes(String.fromCharCode(key & 0x7f));
    if (mode === 'run') return dirs.toUpperCase().includes(ch);
    if (mode === 'rush') {
        for (const d of dirs) if ((d.charCodeAt(0) & 0x1f) === key) return true;
        return false;
    }
    return false;
}

// key -> extcmdlist entry, from the default key bindings (cmd.c reset_commands
// binds each extcmdlist entry's default key; later entries override earlier).
const KEY2CMD = (() => {
    const m = new Map();
    for (const e of EXTCMD_TABLE)
        if (e.key !== null && e.key !== 0) m.set(e.key, e);
    return m;
})();

// C ref: cmd.c key2extcmddesc() — describe the command bound to a key.  Checks
// movement (walk/run/rush) and count digits and the ESC prefix before the
// extended-command binding, then formats "<desc> (#<txt>)" with the reqmenu
// two-line and "(##)" special cases.  Returns null when the key is unbound.
function key2extcmddesc(key) {
    if (movecmd(key, 'walk')) return 'move';
    if (movecmd(key, 'rush')) return 'rush';
    if (movecmd(key, 'run')) return 'run';
    const ch = String.fromCharCode(key & 0xff);
    // C ref: cmd.c key2extcmddesc() digit block — with number_pad the digits
    // are movement, so only '5'/M-5 (the run|rush prefix, swapped by
    // pcHack_compat) and '0'/M-0 describe themselves; the rest fall through to
    // the command table.  Without number_pad every digit starts a count.
    if ((ch >= '0' && ch <= '9')
        || (Cmd_num_pad() && (key & 0x7f) >= 0x30 && (key & 0x7f) <= 0x39)) {
        const M_5 = 0x80 | 0x35, M_0 = 0x80 | 0x30;
        if (!Cmd_num_pad()) return 'start of, or continuation of, a count';
        if (key === 0x35 || key === M_5)
            return `${(!!Cmd_pcHack_compat() !== (key === M_5)) ? 'run' : 'rush'} prefix`;
        if (key === 0x30 || (Cmd_pcHack_compat() && key === M_0))
            return "synonym for 'i'";
    }
    if (key === 0o33) return 'cancel current prompt or pending prefix';
    const e = KEY2CMD.get(key);
    if (e && e.txt) {
        let buf = `${e.desc} (#${e.txt})`;
        if (/^prefix:/i.test(buf) && /^reqmenu$/i.test(e.txt))
            buf = buf.replace(/prefix:/i,
                'movement prefix: move without autopickup and without attacking'
                + '\nnon-movement prefix:');
        return buf.replace(' (##)', '');
    }
    return null;
}

// C ref: pager.c dowhatdoes_core() — build the one-line "<key padded to 8><desc>."
// description for key q, or null if it is not a command.
function dowhatdoes_core(q) {
    const ec_desc = key2extcmddesc(q & 0xff);
    if (ec_desc !== null) {
        const kt = key2txt(q & 0xff);
        return kt.padEnd(8, ' ') + ec_desc + '.';
    }
    return null;
}

// C ref: pager.c dowhatdoes() — "Ask about '&' or '?'..." shown once, then the
// bare "What command? " prompt (yn_function with NULL resp: reads any single
// key), then the key's description is plined.  Returns ECMD_OK (no game time).
export async function dowhatdoes() {
    let needMore = false;
    if (!game._dowhatdoes_once) {
        await pline("Ask about '&' or '?' to get more info.");
        game._dowhatdoes_once = true;
        needMore = true;
    }
    // yn_function("What command?", NULL, '\0', TRUE): more() the pending
    // top-line message, then show "What command? " and read one raw key.
    if (needMore) await topl_more();
    const full = 'What command? ';
    game._pending_message = full;
    game._toplines = full;
    await flush_screen(1);
    const d = disp();
    game._modal_screen = 'topl';
    if (d?.setCursor) d.setCursor(Math.min(full.length, COLS - 1), 0);
    const q = await nhgetch();
    delete game._modal_screen;

    const reslt = dowhatdoes_core(q);
    if (reslt !== null) {
        // No embedded newline for a single key (the '\n' path is only for the
        // 'm' reqmenu prefix, which isn't queried here).
        await pline(reslt);
    } else {
        const uq = q & 0xff;
        await pline(`No such command '${visctrl(uq)}', char code ${uq} (0${uq.toString(8).padStart(3, '0')} or 0x${uq.toString(16).padStart(2, '0')}).`);
    }
    return 0; // ECMD_OK
}

// ---------------------------------------------------------------------------
// dokeylist() — "Full list of keyboard commands." ('?k').  C ref: cmd.c
// dokeylist(): a full-screen NHW_TEXT window that lists every key and the
// command bound to it (like dat/hh but generated from the live key bindings),
// grouped into Directional keys / Miscellaneous keys / Menu control keys /
// General commands / Game commands (/ Debug mode commands in wizard mode).
//
// The listing is entirely build-constant here: it derives from the command
// table (cmd_data.js EXTCMD_TABLE == cmd.c extcmdlist[]) and the default key
// bindings that cmd.c commands_init()/reset_commands() install.  No RNG and no
// game state (other than wizard mode) affect it.

// ANSI control / meta transforms (cmd.c C()/M() macros).
function ctrlKey(ch) { return ch.charCodeAt(0) & 0x1f; }
function metaKey(ch) { return (typeof ch === 'string' ? ch.charCodeAt(0) : ch) | 0x80; }
function padRight(s, n) { return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padLeft(s, n) { return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
// The command's raw C flag expression is kept verbatim in cmd_data.js, so a
// flag test is a substring match on that expression.
function cmdHasFlag(e, f) { return !!e.flags && e.flags.includes(f); }

// cmd.c reset_commands() movement layout: sdir[] = "hykulnjb><"; the first 8
// chars are the direction keys W,NW,N,NE,E,SE,S,SW.
const NHKF_COUNT_KEY = 0x6e;   // cmd.c spkeys_binds[] NHKF_COUNT == 'n'

// Build the default key -> command map exactly as cmd.c installs it:
//   commands_init(): bind every extcmdlist entry with a non-zero default key
//   (later duplicates overwrite the binding), then the explicit bind_key()
//   overrides; reset_commands(): the movement keys (h/y/k/u/l/n/j/b and their
//   Shift and Ctrl forms) are then rebound to movement commands, overwriting
//   whatever those keys held.
function buildKeymap() {
    const map = new Map(); // key code -> extcmd entry
    for (const e of EXTCMD_TABLE) if (e.key) map.set(e.key, e);
    const byTxt = (t) => EXTCMD_TABLE.find((e) => e.txt === t);
    const overrides = [
        [ctrlKey('l'), 'redraw'], ['h'.charCodeAt(0), 'help'],
        ['j'.charCodeAt(0), 'jump'], ['k'.charCodeAt(0), 'kick'],
        ['l'.charCodeAt(0), 'loot'], [ctrlKey('n'), 'annotate'],
        ['N'.charCodeAt(0), 'name'], ['u'.charCodeAt(0), 'untrap'],
        ['5'.charCodeAt(0), 'run'], [metaKey('5'), 'rush'],
        ['-'.charCodeAt(0), 'fight'], [metaKey('O'), 'overview'],
        [metaKey('2'), 'twoweapon'], [metaKey('N'), 'name'],
    ];
    for (const [k, t] of overrides) { const e = byTxt(t); if (e) map.set(k, e); }
    // Movement rebind (MOVEMENTCMD) overwrites the movement keys; which keys
    // those are follows Cmd.dirchars, and with number_pad only the walk digit
    // and its Meta form are claimed (digits have no Shift/Ctrl form).
    const moveMarker = { txt: '', desc: '', flags: 'MOVEMENTCMD' };
    const num_pad = Cmd_num_pad();
    for (const ch of Cmd_dirchars().slice(0, 8)) {
        const lc = ch.charCodeAt(0);
        map.set(lc, moveMarker);                                  // walk
        if (num_pad) {
            map.set(0x80 | lc, moveMarker);                       // run (Meta)
        } else {
            map.set(ch.toUpperCase().charCodeAt(0), moveMarker);  // run (Shift)
            map.set(lc & 0x1f, moveMarker);                       // rush (Ctrl)
        }
    }
    return map;
}

// cmd.c keylist_func_has_key(): TRUE if extcmd is bound to some key that is
// not already flagged used.
function keylistFuncHasKey(keymap, extcmd, keysAlreadyUsed) {
    for (let i = 0; i < 256; i++) {
        if (keysAlreadyUsed[i]) continue;
        if (keymap.get(i) === extcmd) return true;
    }
    return false;
}

// cmd.c keylist_putcmds(): list (or, when docount, count) commands whose flags
// satisfy incl/excl.  Keyed commands come first (ascending key), then keyless
// commands in table order.  Mutates keysUsed only on the emit pass.
function keylistPutcmds(lines, keymap, keysUsed, docount, incl, excl) {
    const keysAlreadyUsed = keysUsed.slice();
    let count = 0;
    const inclOk = (e) => !incl.length || incl.some((f) => cmdHasFlag(e, f));
    const exclBad = (e) => excl.length && excl.some((f) => cmdHasFlag(e, f));
    for (let i = 0; i < 256; i++) {
        if (keysUsed[i]) continue;
        if (i === 0x20) continue; // ' ' unbound unless rest_on_space (default off)
        const b = keymap.get(i);
        if (b) {
            if (!inclOk(b) || exclBad(b)) continue;
            if (docount) { count++; continue; }
            lines.push(padRight(key2txt(i), 7) + ' ' + padRight(b.txt, 13) + ' ' + b.desc);
            keysUsed[i] = true;
        }
    }
    for (const e of EXTCMD_TABLE) {
        if (!inclOk(e) || exclBad(e)) continue;
        if (keylistFuncHasKey(keymap, e, keysAlreadyUsed)) continue;
        if (docount) { count++; continue; }
        lines.push('#' + padRight(e.txt, 20) + ' ' + e.desc);
    }
    return count;
}

// options.c default_menu_cmd_info[] with the default menu command keys (the
// MENU_* constant chars) and options.c show_menu_controls(win, TRUE) layout.
const MENU_CMD_INFO = [
    ['>', 'Go to next page'], ['<', 'Go to previous page'],
    ['^', 'Go to first page'], ['|', 'Go to last page'],
    ['.', 'Select all items in entire menu'], ['@', 'Invert selection for all items'],
    ['-', 'Unselect all items in entire menu'], [',', 'Select all items on current page'],
    ['~', "Invert current page's selections"], ['\\', 'Unselect all items on current page'],
    [':', 'Search and invert matching items'],
];
const MENU_CTRL_HARDCODED = [
    ['Return', 'Accept current choice(s) and dismiss menu'],
    ['Enter', 'Same as Return'],
    ['Space', 'If not on last page, advance one page;'],
    ['     ', 'when on last page, treat like Return'],
    ['Escape', 'Cancel menu without making any choice(s)'],
];

async function dokeylist() {
    const wizard = !!game.flags?.debug;
    const keymap = buildKeymap();
    const lines = [];
    const dirchars = Cmd_dirchars();
    const num_pad = Cmd_num_pad();
    const dc = (i) => dirchars[i];

    lines.push('');
    lines.push(padLeft('', 7) + ' ' + '    Full Current Key Bindings List');
    lines.push(padLeft('', 7) + ' ' + '(also commands with no key assignment)');

    // Directional keys — show_direction_keys(win, '.', FALSE).
    lines.push('');
    lines.push('Directional keys:');
    lines.push('          ' + dc(1) + '  ' + dc(2) + '  ' + dc(3));
    lines.push('           \\ | / ');
    lines.push('          ' + dc(0) + '- . -' + dc(4));
    lines.push('           / | \\ ');
    lines.push('          ' + dc(7) + '  ' + dc(6) + '  ' + dc(5));
    lines.push('');
    // C ref: cmd.c dokeylist() — with number_pad the Ctrl rush paragraph is
    // dropped entirely and the run modifier is "Meta" rather than "Shift".
    if (!num_pad) {
        lines.push('Ctrl+<direction> will run in specified direction until something very');
        lines.push(padLeft('', 7) + ' ' + 'interesting is seen.');
    }
    lines.push((num_pad ? 'Meta' : 'Shift')
               + '+<direction> will run in specified direction until you encounter');
    lines.push(padLeft('', 7) + ' ' + 'an obstacle.');

    // Miscellaneous keys — misc_keys[]: <esc> always, the count prefix only
    // when number_pad is on (cmd.c misc_keys[].numpad) + the SIGINT line for ^C.
    lines.push('');
    lines.push('Miscellaneous keys:');
    lines.push(padRight(key2txt(0o33), 7) + ' ' + 'cancel current prompt or pending prefix');
    if (num_pad)
        lines.push(padRight(key2txt(NHKF_COUNT_KEY), 7)
                   + ' ' + 'Prefix: for digits when preceding a command with a count');
    lines.push(padRight(key2txt(ctrlKey('c')), 7) + ' interrupt: break out of NetHack (SIGINT)');

    // Menu control keys — show_menu_controls(win, TRUE).
    lines.push('');
    lines.push('Menu control keys:');
    for (const [k, d] of MENU_CMD_INFO)
        lines.push(padRight(visctrl(k.charCodeAt(0)), 7) + ' ' + d);
    for (const [k, d] of MENU_CTRL_HARDCODED)
        lines.push('' + padRight(k, 7) + ' ' + d);

    // keys_used: ^C reserved (NO_SIGNAL) + <esc> (the one active misc_key).
    const keysUsed = new Array(256).fill(false);
    keysUsed[ctrlKey('c')] = true;
    keysUsed[0o33] = true;
    if (num_pad) keysUsed[NHKF_COUNT_KEY] = true;   // misc_keys[] NHKF_COUNT

    const IGNORE = ['WIZMODECMD', 'INTERNALCMD', 'MOVEMENTCMD'];
    if (keylistPutcmds(lines, keymap, keysUsed, true, ['GENERALCMD'], IGNORE)) {
        lines.push('');
        lines.push('General commands:');
        keylistPutcmds(lines, keymap, keysUsed, false, ['GENERALCMD'], IGNORE);
    }
    if (keylistPutcmds(lines, keymap, keysUsed, true, [], ['GENERALCMD', ...IGNORE])) {
        lines.push('');
        lines.push('Game commands:');
        keylistPutcmds(lines, keymap, keysUsed, false, [], ['GENERALCMD', ...IGNORE]);
    }
    if (wizard && keylistPutcmds(lines, keymap, keysUsed, true, ['WIZMODECMD'], ['INTERNALCMD'])) {
        lines.push('');
        lines.push('Debug mode commands:');
        keylistPutcmds(lines, keymap, keysUsed, false, ['WIZMODECMD'], ['INTERNALCMD']);
    }

    await display_text_window(lines);
}

// domenucontrols() — "List menu control keys." ('?l').  C ref: pager.c
// domenucontrols() -> options.c show_menu_controls(win, FALSE): a two-column
// "Whole Menu / Current Page" table of the default menu command keys, then the
// hardcoded Return/Enter/Space/Escape entries.  All keys are the get_menu_cmd_key
// defaults (the MENU_* constant chars); has_menu_shift is off for tty so the
// "Pan view" rows are omitted.
async function domenucontrols() {
    const lines = [];
    const mcFmt = (a, b, c) => padLeft(a, 8) + '     ' + padRight(b, 6) + ' ' + c;
    const mcAlt = (a, b, c) => padLeft(a, 9) + '  ' + padRight(b, 6) + ' ' + c;
    const vc = (ch) => visctrl(ch.charCodeAt(0));

    lines.push('Menu control keys:');
    lines.push('');
    lines.push(mcAlt('', 'Whole', 'Current'));
    lines.push(mcAlt('', ' Menu', ' Page'));
    lines.push(mcFmt('Select', vc('.'), vc(',')));
    lines.push(mcFmt('Invert', vc('@'), vc('~')));
    lines.push(mcFmt('Deselect', vc('-'), vc('\\')));
    lines.push('');
    lines.push(mcFmt('Go to', vc('>'), 'Next page'));
    lines.push(mcFmt('', vc('<'), 'Previous page'));
    lines.push(mcFmt('', vc('^'), 'First page'));
    lines.push(mcFmt('', vc('|'), 'Last page'));
    lines.push('');
    lines.push(mcFmt('Search', vc(':'),
        'Exter a target string and invert all matching entries'));
    lines.push('');
    // hardcoded[]: fmt "%9s  %-8s %s"; first row prefixed "Other ", then blank.
    let arg = 'Other ';
    for (const [k, d] of MENU_CTRL_HARDCODED) {
        lines.push(padLeft(arg, 9) + '  ' + padRight(k, 8) + ' ' + d);
        arg = '';
    }
    await display_text_window(lines);
}

// Build the visible menu item list for this run (skip the wizard-mode-only
// entry outside debug mode), assigning a..z accelerators in order.
function buildHelpItems() {
    const wizard = !!game.flags?.debug;
    const items = [];
    let ch = 'a';
    for (const it of HELP_MENU_ITEMS) {
        if (it.wizonly && !wizard) continue;
        items.push({ accel: ch, text: it.text, fn: it.fn });
        ch = ch === 'z' ? 'A' : String.fromCharCode(ch.charCodeAt(0) + 1);
    }
    return items;
}

// C ref: win/tty/wintty.c tty_end_menu()/tty_display_nhwindow() — a single-page
// NHW_MENU overlay.  The window width cw->cols = max over items of
// (strlen(item)+2) [item = "<accel> - <body>"] and of the "(end) " morestr; the
// overlay column offx = max(10, COLNO - cols - 1).  The prompt "Select one
// item:" is prepended as a blank line + the title (both non-selectable).  Each
// row is drawn as a leading space at column offx followed by the item text at
// offx+1; the "(end) " footer sits on the row just past the last item with the
// cursor parked strlen("(end) ") past its start.  Columns left of offx and rows
// below the footer keep the underlying map.
export async function dohelp() {
    const items = buildHelpItems();

    // Menu line list, in display order: title, blank, then one line per item.
    // The prompt/title carries iflags.menu_headings (default "no-color&inverse")
    // via tty_menu_promptstyle, so it renders ATR_INVERSE; the rest are plain.
    const lines = [];
    lines.push({ text: 'Select one item:', attr: ATR_INVERSE });
    lines.push({ text: '', attr: 0 });
    for (const it of items) lines.push({ text: `${it.accel} - ${it.text}`, attr: 0 });

    // Window width and overlay column (see tty_end_menu()).
    let maxcol = 0;
    for (const ln of lines) maxcol = Math.max(maxcol, ln.text.length + 2);
    maxcol = Math.max(maxcol, '(end) '.length);
    let offx = Math.max(10, COLS - maxcol - 1);
    if (offx < 0) offx = 0;

    // Read one PICK_ONE selection.  A matching accelerator selects and ends the
    // menu; <esc>/<return>/<space> exit with no pick; other keys ring the bell
    // (re-read).  dohelp runs the chosen handler once and returns (no loop).
    let picked = -1;
    for (;;) {
        renderHelpMenu(offx, lines);
        game._modal_screen = 'menu';
        const c = await nhgetch();
        delete game._modal_screen;
        if (c === 27 || c === 13 || c === 10 || c === 32) break; // cancel / no pick
        const ch = String.fromCharCode(c);
        const idx = items.findIndex((it) => it.accel === ch);
        if (idx >= 0) { picked = idx; break; }
        // else: unknown accelerator, re-render and re-read
    }

    if (picked >= 0 && items[picked].fn) {
        // C ref: pager.c dohelp() — destroy_nhwindow(tmpwin) runs BEFORE the
        // chosen handler, and tty_dismiss_nhwindow()'s corner path repaints the
        // area the menu covered.  Without it the next handler's own overlay
        // (e.g. hmenu_dowhatis()'s "What do you want to look at:") was drawn on
        // top of a help menu C had already taken down.
        {
            const d0 = disp();
            if (d0?.clearScreen) { d0.clearScreen(); render_map_to_grid(); }
        }
        await items[picked].fn();
    } else if (picked >= 0) {
        // Chosen topic not yet ported: dismiss the menu overlay back to the map
        // so the display is left in a consistent state (no window handler ran).
        game._modal_screen = 'menu';
        await dismiss_invent_screen();
    }
    return 0; // ECMD_OK
}

// Render the single-page help menu as an overlay: rebuild the map underneath
// (so the columns/rows the menu does not cover show the current level), clear
// the message line, then paint the menu on columns offx..79.
function renderHelpMenu(offx, lines) {
    const d = disp();
    if (!d?.setCell) return;
    d.clearScreen();          // blanks the grid incl. the message line (row 0)
    render_map_to_grid();     // map rows 1-21 + status rows 22-23 underneath

    for (let r = 0; r < lines.length; r++) {
        for (let c = offx; c < COLS; c++) d.setCell(c, r, ' ', NO_COLOR, 0);
        const ln = lines[r];
        if (ln && ln.text) d.putstr(offx + 1, r, ln.text, NO_COLOR, ln.attr || 0);
    }
    const footRow = lines.length;
    for (let c = offx; c < COLS; c++) d.setCell(c, footRow, ' ', NO_COLOR, 0);
    const morestr = '(end) ';
    d.putstr(offx + 1, footRow, morestr, NO_COLOR, 0);
    d.setCursor(offx + 1 + morestr.length, footRow);
}

// ---------------------------------------------------------------------------
// The tty PICK_ONE menu response loop, and do_look()'s "What do you want to
// look at:" menu that uses it.
//
// C ref: win/tty/wintty.c process_menu_window() (cw->how == PICK_ONE) plus
// win/tty/getline.c xwaitforspace(resp), which does the accept/bell filtering
// BEFORE the menu switch ever sees the key.  The port previously read a single
// key and treated anything unrecognised as a cancel; C rings the bell and
// re-reads with the menu still on screen, so every stray keystroke over an open
// menu left our display a whole command out of step.

// wintype.h MENU_* menu-window keyboard commands, in win/tty/wintty.c
// default_menu_cmds[] order.  MENUCOMMAND bindings would populate
// gm.mapped_menu_cmds/gm.mapped_menu_op; with none set map_menu_cmd() is the
// identity, which is the only case reachable from a config-less recording.
const MENU_FIRST_PAGE = '^', MENU_LAST_PAGE = '|', MENU_NEXT_PAGE = '>',
      MENU_PREVIOUS_PAGE = '<', MENU_SELECT_ALL = '.', MENU_UNSELECT_ALL = '-',
      MENU_INVERT_ALL = '@', MENU_SELECT_PAGE = ',', MENU_UNSELECT_PAGE = '\\',
      MENU_INVERT_PAGE = '~', MENU_SEARCH = ':';
const DEFAULT_MENU_CMDS =
    MENU_FIRST_PAGE + MENU_LAST_PAGE + MENU_NEXT_PAGE + MENU_PREVIOUS_PAGE
    + MENU_SELECT_ALL + MENU_UNSELECT_ALL + MENU_INVERT_ALL + MENU_SELECT_PAGE
    + MENU_UNSELECT_PAGE + MENU_INVERT_PAGE + MENU_SEARCH;
const GOLD_SYM = '$';

// C ref: getline.c xwaitforspace(s) — read keys until one is acceptable,
// ringing the bell for the rest.  Returns C's `morc`: '\0' for return/newline,
// '\033' for escape, else the accepted character.  ttyDisplay->dismiss_more is
// 0 outside topl.c's --More--, so the `c == x` arm never fires here.
async function xwaitforspace(s) {
    for (;;) {
        const c = await nhgetch();
        if (c === 10 || c === 13) return '\0';
        if (c === 27) return '\x1b';
        const ch = String.fromCharCode(c);
        if (s.indexOf(ch) >= 0) return ch;
        // tty_nhbell(): the key is discarded, nothing is redrawn, read again.
    }
}

// C ref: process_menu_window() gacc[] collection.  A group accelerator only
// enters gacc when it differs from its own entry's selector (or is GOLD_SYM),
// and for PICK_ONE only when exactly one entry claims it.
function menu_group_accels(items, pick_one) {
    const gcnt = new Map();
    let n = 0;
    for (const it of items)
        if (it.gsel && it.gsel !== it.ch) {
            n++;
            gcnt.set(it.gsel, (gcnt.get(it.gsel) || 0) + 1);
        }
    let gacc = '';
    if (n > 0)
        for (const it of items)
            if (it.gsel && (it.gsel !== it.ch || it.gsel === GOLD_SYM)
                && gacc.indexOf(it.gsel) < 0
                && (!pick_one || gcnt.get(it.gsel) === 1))
                gacc += it.gsel;
    return gacc;
}

// C ref: process_menu_window() with cw->how == PICK_ONE, for a menu that fits
// on one page (cw->npages == 1, which is every menu this drives).  `items` is
// the add_menu() order; entries with no `ch` are add_menu_str() headers.
// `render` redraws the window and parks the cursor after the morestr, which is
// what C's "just put the cursor back" else-branch does on every re-read.
// Returns the selected entry's a_char, or null when the menu was cancelled or
// committed with nothing picked.
export async function menu_select_pick_one(items, render) {
    const gacc = menu_group_accels(items, /*pick_one=*/true);

    // resp[]: the page's selectors, then gacc, then the always-accepted keys.
    // resp_len covers selectors+gacc: a key inside it is an explicit choice and
    // is NOT re-read as a mapped menu command.
    let resp = '';
    for (const it of items) if (it.ch) resp += it.ch;
    resp += gacc;
    const resp_len = resp.length;
    resp += ' ' + '0123456789\x1b\n\r' + DEFAULT_MENU_CMDS;

    let counting = false, count = 0, reset_count = true;
    for (;;) {
        if (reset_count) { counting = false; count = 0; } else reset_count = true;

        render(items);
        const raw = await xwaitforspace(resp);

        // MENU_EXPLICIT_CHOICE: a selector/group key keeps its own meaning even
        // when it also happens to be a menu command (':' vs a ':' selector).
        const explicit = raw !== '\0' && resp.indexOf(raw) >= 0
                         && resp.indexOf(raw) < resp_len;
        const morc = explicit ? raw : map_menu_cmd(raw);

        if (!explicit && morc >= '0' && morc <= '9') {
            // '0'..'9' start/extend a count unless the digit is a group accel.
            if (!counting && gacc.indexOf(morc) >= 0) {
                const hit = items.find((it) => it.gsel === morc);
                if (hit) return hit.ch;
                continue;
            }
            count = count * 10 + (morc.charCodeAt(0) - 48);
            if (count !== 0) { counting = true; reset_count = false; }
            continue;
        }
        if (!explicit && morc === '\x1b') {
            // ESC while counting only stops the count; otherwise it cancels.
            if (!counting) return null;
            continue;
        }
        if (!explicit && (morc === '\0')) return null;   // committed, no pick
        if (!explicit && morc === ' ') return null;      // single page: finish
        if (!explicit && (morc === MENU_NEXT_PAGE || morc === MENU_PREVIOUS_PAGE
                          || morc === MENU_FIRST_PAGE || morc === MENU_LAST_PAGE))
            continue;                                    // single page: no-op
        if (!explicit && (morc === MENU_SELECT_PAGE || morc === MENU_UNSELECT_PAGE
                          || morc === MENU_INVERT_PAGE || morc === MENU_SELECT_ALL
                          || morc === MENU_UNSELECT_ALL || morc === MENU_INVERT_ALL))
            continue;                    // PICK_ANY-only, or nothing selected
        if (!explicit && morc === MENU_SEARCH) {
            const picked = await menu_search_pick_one(items);
            if (picked) return picked;
            continue;
        }

        // default: an explicit choice (or an unmapped key that reached here).
        if (gacc.indexOf(morc) >= 0) {
            // invert_all(..., morc): for PICK_ONE gacc holds only keys that
            // match exactly one entry, so this selects that entry and finishes.
            const hit = items.find((it) => it.gsel === morc);
            if (hit) return hit.ch;
            continue;
        }
        const sel = items.find((it) => it.ch === morc);
        if (sel) return sel.ch;
        // Not in resp at all cannot happen (xwaitforspace filtered); anything
        // else falls through as C's tty_nhbell() no-op.
    }
}

// C ref: options.c map_menu_cmd() — identity without MENUCOMMAND bindings.
function map_menu_cmd(ch) { return ch; }

// C ref: process_menu_window() case MENU_SEARCH — tty_getlin("Search for:"),
// then the first entry whose displayed string matches "*<reply>*" (pmatchi, so
// case-insensitively) is selected and PICK_ONE finishes.
async function menu_search_pick_one(items) {
    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    const reply = await hooked_tty_getlin('Search for:', null);
    if (!reply || reply[0] === '\x1b') return null;
    const needle = reply.toLowerCase();
    for (const it of items)
        if (it.ch && (it.str || '').toLowerCase().indexOf(needle) >= 0)
            return it.ch;
    return null;
}

// C ref: pager.c do_look() — the "What do you want to look at:" menu entries,
// in add_menu() order.  add_menu()'s 4th/5th arguments are the selector and the
// group accelerator; with flags.lootabc unset the selector is the entry's own
// a_char and the group accelerators preserve the original y|n question ('y' =>
// the map, 'n' => by symbol/name) plus '^'/'"'/'`'/'|' for the list choices.
// The second block is suppressed while swallowed or hallucinating, exactly as
// in C, because the screen then can't show what those choices scan for.
export function whatis_menu_items() {
    const lootabc = !!game?.flags?.lootabc;
    const u = game?.u;
    const Hallucination = ((u?.uprops?.Hallucination || 0) > 0)
                          || !!u?.HHallucination || !!u?.uhallu;
    const at = (ch, gsel, desc) =>
        ({ ch, gsel: lootabc ? 0 : gsel, desc, str: `${ch} - ${desc}` });

    const items = [
        at('/', 'y', 'something on the map'),
        // [don't use 'i' as lootabc group accelerator because it will make the
        // regular 'i' choice inaccessible]
        at('i', 0, "something you're carrying"),
        at('?', 'n', 'something else (by symbol or name)'),
    ];
    if (!u?.uswallow && !Hallucination) {
        items.push({ blank: true });   // add_menu_str(win, "")
        items.push(at('m', 0, 'nearby monsters'));
        items.push(at('M', 0, 'all monsters shown on map'));
        items.push(at('o', 0, 'nearby objects'));
        items.push(at('O', 0, 'all objects shown on map'));
        items.push(at('t', '^', 'nearby traps'));
        items.push(at('T', '"', 'all seen or remembered traps'));
        // [don't use 'e' as lootabc group accelerator]
        items.push(at('e', '`', 'nearby engravings'));
        items.push(at('E', '|', 'all seen or remembered engravings'));
    }
    if (lootabc) {
        // flags.lootabc relabels the entries a/b/c/... and the group
        // accelerators become '/', '?' and each list entry's own letter.
        const abc = 'abcdefghijklmnopqrstuvwxyz';
        let n = 0;
        for (const it of items) {
            if (it.blank) continue;
            const gsel = it.ch === 'i' ? 0 : it.ch === '/' ? '/'
                       : it.ch === '?' ? '?' : it.ch === 'e' ? 0 : it.ch;
            it.gsel = gsel;
            it.sel = abc[n++];
            it.str = `${it.sel} - ${it.desc}`;
        }
        // The a_char stays the mnemonic; only the typed selector changes.
        for (const it of items) if (!it.blank) { it.a_char = it.ch; it.ch = it.sel; }
    }
    return items;
}

// C ref: pager.c do_look() — build the menu, run select_menu(PICK_ONE) and hand
// back the chosen a_char (C's `i`, which stays '\0' -> the `default:`/'q' arm
// when nothing was picked).
export async function whatis_menu_pick(render) {
    const items = whatis_menu_items();
    const picked = await menu_select_pick_one(items, render);
    if (!picked) return 'q';
    const hit = items.find((it) => it.ch === picked);
    return (hit && hit.a_char) ? hit.a_char : picked;
}

// ===========================================================================
// pager.c, remainder.
//
// STATUS: INERT.  Nothing below this banner is called from any existing code
// path in js/; each function is a faithful translation waiting for its call
// site to be wired one at a time.  js/hack.js already carries call-site
// specialised derivatives of several of these under different names
// (self_lookat, terrain_description, look_at_object_here,
// look_at_monster_desc, mon_hidden_suffix, do_look_all, do_look_engrs,
// count_seen_traps, do_look_full, do_farlook, checkfile); those remain the
// live code.  The versions here are the general C shape.
//
// Conventions this block uses, because C passes `char *` out-parameters that
// JS strings cannot model:
//   * a function whose C signature fills one buffer RETURNS the string
//     (trap_description, look_at_object, mhidden_description, monhealthdescr,
//     setopt_cmd, trap_description);
//   * a function that APPENDS to a caller-owned buffer takes a box `{ s }`
//     (append_str, add_cmap_descr, add_quoted_engraving, do_screen_description);
//   * a function that fills two buffers returns `{ buf, monbuf }`
//     (look_at_monster, lookat).
// BUFSZ truncation is modelled where C's strncat can actually clip.
//
// GLYPHS: as in js/detect.js, C's integer glyph per cell is recovered here
// from the cell's live state, because this port stores {ch,color,decgfx}
// descriptors with no kind tag.

import { COLNO, ROWNO, BOLT_LIM, BUFSZ, isok, STONE, SCORR, SDOOR, ROOM, CORR,
         DOOR, ICE, POOL, MOAT, WATER, LAVAPOOL, LAVAWALL, TREE, CLOUD,
         IS_WALL, IS_DOOR, IS_TREE, IS_GRAVE, D_BROKEN,
         D_TRAPPED, D_CLOSED, D_LOCKED, D_ISOPEN,
         NO_TRAP, BEAR_TRAP, TRAPPED_DOOR, TRAPPED_CHEST, ROCKTRAP, HOLE, PIT,
         WEB, VIBRATING_SQUARE, STRAT_WAITMASK, I_SPECIAL,
         MHID_PREFIX, MHID_ARTICLE, MHID_ALTMON, MHID_REGION,
         GPCOORDS_NONE, GPCOORDS_MAP, GPCOORDS_SCREEN, GPCOORDS_COMPASS,
         GPCOORDS_COMFULL, WARNCOUNT, TRAPNUM, def_warnsyms, Is_waterlevel,
         Is_airlevel, SYM_OFF_P, SYM_NOTHING, SYM_UNEXPLORED, SYM_BOULDER,
         AM_MASK, AM_SANCTUM, Amask2align, A_CHAOTIC,
         A_NEUTRAL, A_LAWFUL, A_NONE } from './const.js';
import { defsyms, def_oc_syms, def_monsyms, MAXPCHARS, MAXMCLASSES,
         MAXOCLASSES, DEF_INVISIBLE, S_stone, S_room, S_darkroom, S_corr,
         S_litcorr, S_ndoor, S_altar, S_grave, S_cloud, S_ice, S_pool,
         S_water, S_lava, S_lavawall, S_engroom, S_engrcorr, S_arrow_trap,
         S_vodbridge, S_hcdbridge, S_vibrating_square, S_invisible, S_HUMAN,
         S_sw_tl, S_sw_br, SYM_OFF_O, SYM_OFF_M, SYM_OFF_W, SYM_OFF_X, gs }
    from './symbols.js';
import { m_at, vobj_at, covers_objects, object_glyph, trap_glyph,
         update_topl, Hallucination_u, impossible as pg_impossible_async }
    from './display.js';
import { cansee, couldsee, Blind } from './vision.js';
import { engr_at } from './engrave.js';
import { t_at, trap_explanation } from './trap.js';
import { trapped_chest_at, trapped_door_at } from './detect.js';
import { objects, BOULDER, CHEST, LARGE_BOX, STRANGE_OBJECT, ROCK_CLASS,
         VENOM_CLASS, COIN_CLASS } from './mkobj.js';
import { monster_by_pmidx } from './makemon.js';
import { distant_monnam, ARTICLE_NONE, mon_nam } from './do_name.js';
import { visible_region_at } from './region.js';
import { doextlist, cmd_from_func } from './cmd.js';
import { rn2 } from './rng.js';
import { NUMMONS } from './disprng.js';

// ── the two hack.js-owned dependencies do_look() needs ─────────────────────
//
// js/hack.js owns getpos() (a 200-line cursor loop with its own tip window and
// autodescribe) and checkfile() (the data.base lookup and its y/n gate) but
// exports neither.  do_look() below is the only thing here that needs them, so
// the dependency is a one-line injection point: wiring do_look() means
// exporting those from hack.js and calling set_pager_deps() once at startup.
let _pg = { getpos: null, checkfile: null, display_inventory: null,
            getlin: null, render_whatis_menu: null };
export function set_pager_deps(deps) { _pg = { ..._pg, ...deps }; }

/* getpos.c LOOK_* return codes for getpos() */
const LOOK_QUICK = 1, LOOK_ONCE = 2, LOOK_VERBOSE = 3;

// C's impossible() is synchronous; js/display.js's is async because it plines.
// The callers below are sync (append_str, add_cmap_descr, whatdoes_cond), so
// the report is fire-and-forget.
function pg_impossible(msg) { void pg_impossible_async(msg).catch(() => {}); }

// C ref: pager.c:63 — the two "remembered, unseen creature" strings.
const invisexplain = 'remembered, unseen, creature';
const altinvisexplain = 'unseen creature';          /* for clairvoyance */

// dat/wizhelp and dat/keyhelp are not transcribed into js/pager_data.js yet.
// An empty list is C's dlb_fopen() failure, which is exactly what
// dispfile_debughelp()/whatdoes_help() have to cope with.
const DEBUGHELP = [];
const KEYHELP = [];

// ── local helpers ──────────────────────────────────────────────────────────

function pg_iflags() { return (game.iflags = game.iflags || {}); }
function pg_u() { return game.u || {}; }
function pg_u_at(x, y) { return x === game.u?.ux && y === game.u?.uy; }
function pg_distu(x, y) {
    const dx = x - (game.u?.ux ?? 0), dy = y - (game.u?.uy ?? 0);
    return dx * dx + dy * dy;
}
function pg_next2u(x, y) { return pg_distu(x, y) <= 2; }
function pg_an(s) {
    if (!s) return s;
    return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`;
}
function pg_the(s) { return s ? `the ${s}` : s; }
function pg_upstart(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function pg_strstri(hay, needle) { return String(hay).includes(String(needle)); }
function pg_Has_contents(o) { return !!(o && Array.isArray(o.cobj) && o.cobj.length); }
function pg_objs_at(x, y) {
    return (game.level?.objects || []).filter(
        (o) => o.where === 'floor' && o.ox === x && o.oy === y);
}
function pg_sobj_at(otyp, x, y) {
    for (const o of pg_objs_at(x, y)) if (o.otyp === otyp) return o;
    return null;
}
function pg_closed_door(x, y) {
    const lev = game.level?.at(x, y);
    return !!lev && IS_DOOR(lev.typ)
        && ((lev.doormask | 0) & (D_LOCKED | D_CLOSED)) !== 0;
}
function pg_is_pool(x, y) {
    const t = game.level?.at(x, y)?.typ;
    return t === POOL || t === MOAT || t === WATER;
}
function pg_is_lava(x, y) {
    const t = game.level?.at(x, y)?.typ;
    return t === LAVAPOOL || t === LAVAWALL;
}
// C ref: sym.h:92 MAXTCHARS == TRAPNUM - 1, and sym.h:98-108 —
//   is_cmap_trap(i)        i >= S_arrow_trap && i < S_arrow_trap + MAXTCHARS
//   is_cmap_drawbridge(i)  S_vodbridge .. S_hcdbridge
// The trap range REACHES S_trapped_door and S_trapped_chest (they sit right
// after S_vibrating_square), which is why hit_trap collapses a typed '^' to a
// bare "a trap" instead of listing all three.
const MAXTCHARS = TRAPNUM - 1;
function is_cmap_trap(i) {
    return i >= S_arrow_trap && i < S_arrow_trap + MAXTCHARS;
}
function is_cmap_drawbridge(i) { return i >= S_vodbridge && i <= S_hcdbridge; }
function is_cmap_engraving(i) { return i === S_engroom || i === S_engrcorr; }

// C ref: symbols.c gs.showsyms[] — falls back to the compiled-in default when
// init_showsyms() has not run (no SYMBOLS= in the rc).
function showsym(idx, fallback) {
    const v = gs?.showsyms?.[idx];
    return (v && v !== 0) ? v : fallback;
}

// C ref: display.h glyph_at(x,y).  See the banner: a tagged descriptor, not an
// int.  `kind` is 'monster' | 'object' | 'trap' | 'invisible' | 'warning' |
// 'cmap' | 'nothing' | 'unexplored'.
function pg_glyph_at(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return { kind: 'unexplored', x, y };
    const sym = (loc.disp_ch != null) ? loc.disp_ch : ' ';
    if (loc.invisMon && sym === DEF_INVISIBLE) return { kind: 'invisible', sym, x, y };
    if (pg_u_at(x, y)) return { kind: 'monster', mon: null, isyou: true, sym, x, y };
    const mon = m_at(x, y);
    if (mon && sym === (mon.data?.mlet ?? '\0'))
        return { kind: 'monster', mon, sym, x, y };
    if (loc.mapped_trap_ttyp)
        return { kind: 'trap', trap: null, ttyp: loc.mapped_trap_ttyp, sym, x, y };
    const otmp = vobj_at(x, y);
    if (otmp && !covers_objects(loc)) {
        const og = object_glyph(otmp);
        if (og && og.ch === sym)
            return { kind: 'object', obj: otmp, otyp: otmp.otyp,
                     corpsenm: otmp.corpsenm, sym, x, y };
    }
    const tr = t_at(x, y);
    if (tr && tr.tseen && !covers_objects(loc)) {
        const tg = trap_glyph(tr);
        if (tg && tg.ch === sym)
            return { kind: 'trap', trap: tr, ttyp: tr.ttyp, sym, x, y };
    }
    if (!loc.seenv && loc.remembered_glyph == null)
        return { kind: 'unexplored', sym: ' ', x, y };
    if (sym === ' ') return { kind: 'nothing', sym, x, y };
    return { kind: 'cmap', sym, cmap: cmap_index_for(loc, x, y), x, y };
}
function pg_glyph_is_monster(g) { return g?.kind === 'monster'; }
function pg_glyph_is_object(g) { return g?.kind === 'object'; }
function pg_glyph_is_trap(g) { return g?.kind === 'trap'; }
function pg_glyph_is_invisible(g) { return g?.kind === 'invisible'; }
function pg_glyph_is_warning(g) { return g?.kind === 'warning'; }
function pg_glyph_is_cmap(g) { return g?.kind === 'cmap'; }
function pg_glyph_is_nothing(g) { return g?.kind === 'nothing'; }
function pg_glyph_is_unexplored(g) { return g?.kind === 'unexplored'; }
function pg_glyph_to_obj(g) { return g?.otyp ?? STRANGE_OBJECT; }
function pg_glyph_to_trap(g) { return g?.ttyp ?? NO_TRAP; }
function pg_glyph_to_cmap(g) { return pg_glyph_is_cmap(g) ? g.cmap : SYM_NOTHING; }
function pg_glyph_is_statue(g) {
    return pg_glyph_is_object(g) && g.otyp === 481 /* objects.h STATUE */;
}
function pg_glyph_is_body(g) {
    return pg_glyph_is_object(g) && g.otyp === 259 /* objects.h CORPSE */;
}

// The cmap index a cell's terrain draws as — C reads it back out of the glyph;
// here it comes from levl[][].typ, which is the same thing for every cmap glyph
// back_to_glyph() can produce.
function cmap_index_for(loc, x, y) {
    const t = loc.typ;
    if (t === STONE || t === SCORR) return S_stone;
    if (IS_WALL(t) || t === SDOOR) return 1;        /* S_vwall; "wall" */
    if (t === DOOR) {
        if ((loc.doormask | 0) & (D_CLOSED | D_LOCKED)) return 15;  /* S_vcdoor */
        if ((loc.doormask | 0) & D_ISOPEN) return 13;               /* S_vodoor */
        return S_ndoor;
    }
    if (t === CORR) return cansee(x, y) && loc.waslit ? S_litcorr : S_corr;
    if (t === ROOM) return cansee(x, y) ? S_room : S_darkroom;
    if (t === ICE) return S_ice;
    if (t === POOL || t === MOAT) return S_pool;
    if (t === WATER) return S_water;
    if (t === LAVAPOOL) return S_lava;
    if (t === LAVAWALL) return S_lavawall;
    if (t === CLOUD) return S_cloud;
    if (t === TREE) return 18;                     /* S_tree */
    if (IS_GRAVE(t)) return S_grave;
    if (t === 32 /* ALTAR */) return S_altar;
    return S_room;
}

// C ref: getpos.c coord_desc(x, y, buf, cmode).
function coord_desc(x, y, cmode) {
    switch (cmode) {
    case GPCOORDS_COMFULL:
    case GPCOORDS_COMPASS: {
        const dx = x - (game.u?.ux ?? 0), dy = y - (game.u?.uy ?? 0);
        return `(${dxdy_to_dist_descr(dx, dy, cmode === GPCOORDS_COMFULL)})`;
    }
    case GPCOORDS_MAP:
        /* upper left corner of the map is <1,0> */
        return `<${x},${y}>`;
    case GPCOORDS_SCREEN: {
        /* map line 0 is screen row 2; map column 1 is screen column 1 */
        const pad = (n) => String(n).padStart(2, '0');
        return `[${pad(y + 2)},${pad(x)}]`;
    }
    default:
        return '';
    }
}
// C ref: getpos.c dxdy_to_dist_descr(dx, dy, fulldir) — "east", "3s", "2n,4w".
function dxdy_to_dist_descr(dx, dy, fulldir) {
    const NS = ['north', 'south'], EW = ['west', 'east'];
    if (!dx && !dy) return 'here';
    if (!dx || !dy || Math.abs(dx) === Math.abs(dy)) {
        const ns = dy ? (dy < 0 ? NS[0] : NS[1]) : '';
        const ew = dx ? (dx < 0 ? EW[0] : EW[1]) : '';
        const dir = `${ns}${ew}`;
        if (fulldir) return dir;
        return `${Math.max(Math.abs(dx), Math.abs(dy))}${dir[0]}${ew && ns ? ew[0] : ''}`;
    }
    const nsp = dy ? `${Math.abs(dy)}${(dy < 0 ? 'n' : 's')}` : '';
    const ewp = dx ? `${Math.abs(dx)}${(dx < 0 ? 'w' : 'e')}` : '';
    return fulldir ? `${Math.abs(dy)} ${dy < 0 ? NS[0] : NS[1]},`
                     + `${Math.abs(dx)} ${dx < 0 ? EW[0] : EW[1]}`
                   : `${nsp}${nsp && ewp ? ',' : ''}${ewp}`;
}

// C ref: mkmaze.c/pager.c waterbody_name(x, y) — js/cmd.js:596 and
// js/trap.js:3280 each carry a private copy; this is the non-hallucinating
// core of the same table.
function pg_waterbody_name(x, y) {
    if (!isok(x, y)) return 'drink';
    const ltyp = game.level?.at(x, y)?.typ;
    if (ltyp === POOL) return 'pool of water';
    if (ltyp === MOAT) return 'moat';
    if (ltyp === WATER)
        return Is_waterlevel(game.u?.uz) ? 'limitless water' : 'wall of water';
    if (ltyp === LAVAPOOL) return 'molten lava';
    if (ltyp === LAVAWALL) return 'wall of lava';
    if (ltyp === ICE) return 'ice';
    return 'water';
}
// C ref: pager.c ice_descr(x, y, outbuf) — js/wizterrainwish.js:406 owns the
// canonical port; the thaw-timer wording is what it is used for.
function pg_ice_descr(x, y) {
    const loc = game.level?.at(x, y);
    return (loc && loc.icedpool) ? 'solid ice' : 'ice';
}
// C ref: pager.c self_lookat(outbuf) — js/hack.js:1356 owns the canonical port
// (role/race/plname assembly plus the ball and trap suffixes).
function pg_self_lookat() {
    const u = pg_u();
    const nm = game.flags?.debug ? 'wizard' : (game.plname || 'Player');
    const pm = monster_by_pmidx(u.umonnum)?.name || 'human';
    return `${pm} called ${nm}`;
}

// C ref: pager.c look_all/look_traps/look_engrs use create_nhwindow(NHW_TEXT)
// + putstr/putmixed + display_nhwindow(win, TRUE).  windows.c/wintty.c are N/A
// for this port (frozen/terminal.js owns the grid), so the window is a text
// sink and display_nhwindow hands its lines to display_text_window().
function create_nhwindow_text() { return { lines: [] }; }
function putstr(win, _attr, str) { if (win) win.lines.push(str); }
const putmixed = putstr;    /* the encglyph escape decodes to the bare char */
function encglyph(glyph) { return glyph?.sym ?? ' '; }
async function display_nhwindow_text(win, _blocking) {
    if (win && win.lines.length) await display_text_window(win.lines);
}

// ── pager.c ────────────────────────────────────────────────────────────────

// C ref: pager.c:67 is_swallow_sym(c) — "characters that could represent a
// monster's stomach", i.e. the S_sw_tl..S_sw_br cmap block.
export function is_swallow_sym(c) {
    for (let i = S_sw_tl; i <= S_sw_br; i++)
        if (showsym(i + SYM_OFF_P, defsyms[i]?.sym) === c) return true;
    return false;
}

// C ref: pager.c:81 append_str(buf, new_str) — append " or "+new_str unless
// new_str is already a substring of buf.  Returns 1 if anything was appended.
// `buf` is a box (see the banner) because C mutates the caller's char[BUFSZ].
export function append_str(buf, new_str) {
    const sep = ' or ';

    if (pg_strstri(buf.s, new_str)) return 0;      /* already present */

    const oldlen = buf.s.length;
    if (oldlen >= BUFSZ - 1) {
        if (oldlen > BUFSZ - 1)
            pg_impossible(`append_str: 'buf' contains ${oldlen} characters.`);
        return 0;                                   /* no space available */
    }
    /* some space available, but not necessarily enough for a full append */
    const space_left = BUFSZ - 1 - oldlen;
    buf.s += sep.slice(0, space_left);
    if (space_left > sep.length)
        buf.s += new_str.slice(0, space_left - sep.length);
    return 1;
}

// C ref: pager.c:138 monhealthdescr(mon, addspace, outbuf) — DISABLED in C
// (`#if 0`), so it always yields the empty string; the live percentage-based
// wording behind the #if is kept here in the comment so a future enable is a
// one-line change rather than a re-translation.
//   mhp >= mhpmax                 -> "uninjured"
//   mhp <= 1 || pct < 5           -> "[nearly ]deceased"/"defunct" (nonliving)
//   else                          -> "[barely |slightly |heavily ]wounded"
//   addspace                      -> a trailing space
export function monhealthdescr(_mon, _addspace) {
    return '';
}

// C ref: pager.c:166 trap_description(outbuf, tnum, x, y) — the trapped chest /
// trapped door names take precedence over trapname(), because both are "semi-
// real traps now (defined trap types but not part of the ftrap chain)".
export function trap_description(tnum, x, y) {
    if (trapped_chest_at(tnum, x, y))
        return 'trapped chest';                     /* might be a large box */
    if (trapped_door_at(tnum, x, y))
        return 'trapped door';                      /* not "trap door"... */
    return trap_explanation(tnum);
}

// C ref: pager.c:186 mhidden_description(mon, mhid_flags, outbuf) — the
// ", mimicking a chest" / ", hiding under a boulder" / ", in a cloud of poison
// gas" suffix.  Also used for probing and for looking at self.
export function mhidden_description(mon, mhid_flags) {
    const incl_prefix = (mhid_flags & MHID_PREFIX) !== 0;
    const incl_article = (mhid_flags & MHID_ARTICLE) !== 0;
    const show_altmon = (mhid_flags & MHID_ALTMON) !== 0;
    const force_region = (mhid_flags & MHID_REGION) !== 0;
    const isyou = mon === game.u || mon?.isyou;
    const x = isyou ? game.u.ux : mon.mx, y = isyou ? game.u.uy : mon.my;
    // "remembered glyph, not glyph_at() which is 'mon'"
    const loc = game.level?.at(x, y);
    const glyph = (game.level?.flags?.hero_memory && !isyou && loc?.remembered_glyph)
        ? pg_remembered_glyph(x, y) : pg_glyph_at(x, y);
    let out = '';
    const objfrommap = () => {
        const r = object_from_map(glyph, x, y);
        const otmp = r.obj;
        let what = (otmp && otmp.otyp !== STRANGE_OBJECT)
            ? simpleonames(otmp) : objects[STRANGE_OBJECT]?.name || 'strange object';
        if (incl_article && (!otmp || otmp.quan === 1)) what = pg_an(what);
        out += what;
        /* C dealloc_obj()s the fake object here; nothing to do in JS. */
    };

    if (mon.m_ap_type === 'furniture' || mon.m_ap_type === 'obj') {
        if (incl_prefix) out = ', mimicking ';
        if (mon.m_ap_type === 'furniture') {
            let what = defsyms[mon.mappearance]?.explanation || 'something';
            if (incl_article) what = pg_an(what);
            out += what;
        } else if (mon.m_ap_type === 'obj' && pg_glyph_is_object(glyph)) {
            objfrommap();
        } else {
            out += 'something';
        }
    } else if (mon.m_ap_type === 'monster') {
        if (show_altmon) {
            if (incl_prefix) out += ', masquerading as ';
            let what = monster_by_pmidx(mon.mappearance)?.name || 'creature';
            if (incl_prefix) what = pg_an(what);
            out += what;
        }
    } else if (isyou ? game.u.uundetected : mon.mundetected) {
        out = ', hiding';
        const data = mon.data || {};
        if (pg_hides_under(data)) {
            out += ' under ';
            if (pg_glyph_is_object(glyph)) { objfrommap(); return out; }
            out += 'something';
        } else if (pg_is_hider(data)) {
            out += ` on the ${pg_ceiling_hider(data) ? 'ceiling' : pg_surface(x, y)}`;
        } else if (data.mlet === ';' && pg_is_pool(x, y)) {
            out += ' in murky water';               /* S_EEL */
        }
    }

    /* FIXME (C's own): <x,y> isn't right when looking at long worm tails */
    const reg = visible_region_at(x, y);
    if (reg && out.length < BUFSZ - 1) {
        const r = ((game.u?.xray_range ?? 0) > 1) ? game.u.xray_range : 1;
        if (pg_distu(x, y) <= r * (r + 1) || force_region) {
            const poison_gas = reg.glyph_is_poisoncloud === true;
            out += `, in a cloud of ${poison_gas ? 'poison gas' : 'vapor'}`;
            out = out.slice(0, BUFSZ - 1);
        }
    }
    return out;
}

// The REMEMBERED glyph at <x,y> (levl[x][y].glyph), which "will never be a
// monster (unless it is the invisible monster glyph)".
function pg_remembered_glyph(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return { kind: 'unexplored', sym: ' ', x, y };
    if (loc.invisMon) return { kind: 'invisible', sym: DEF_INVISIBLE, x, y };
    const rg = loc.remembered_glyph;
    if (!rg) return { kind: 'unexplored', sym: ' ', x, y };
    if (loc.mapped_trap_ttyp)
        return { kind: 'trap', trap: null, ttyp: loc.mapped_trap_ttyp, sym: rg.ch, x, y };
    const otmp = vobj_at(x, y);
    if (otmp && !covers_objects(loc)) {
        const og = object_glyph(otmp);
        if (og && og.ch === rg.ch && og.color === rg.color)
            return { kind: 'object', obj: otmp, otyp: otmp.otyp,
                     corpsenm: otmp.corpsenm, sym: rg.ch, x, y };
    }
    const tr = t_at(x, y);
    if (tr && tr.tseen) {
        const tg = trap_glyph(tr);
        if (tg && tg.ch === rg.ch)
            return { kind: 'trap', trap: tr, ttyp: tr.ttyp, sym: rg.ch, x, y };
    }
    if (rg.ch === ' ') return { kind: 'nothing', sym: ' ', x, y };
    return { kind: 'cmap', sym: rg.ch, cmap: cmap_index_for(loc, x, y), x, y };
}

/* mondata.h hides_under/is_hider/ceiling_hider; dungeon.c surface() */
function pg_hides_under(data) { return !!data?.mhides_under; }
function pg_is_hider(data) { return !!data?.mhider; }
function pg_ceiling_hider(data) { return !!data?.mceiling_hider; }
function pg_surface(x, y) {
    const t = game.level?.at(x, y)?.typ;
    if (t === POOL || t === MOAT || t === WATER) return 'water';
    if (t === LAVAPOOL || t === LAVAWALL) return 'lava';
    if (t === ICE) return 'ice';
    return 'floor';
}
/* objnam.c simpleonames(obj) */
function simpleonames(obj) {
    return objects[obj?.otyp]?.name || objects[obj?.otyp]?.desc || 'something';
}

// C ref: pager.c:284 object_from_map(glyph, x, y, &obj_p) — "extracted from
// lookat(); also used by namefloorobj()".  Returns { fakeobj, obj }: when
// fakeobj is TRUE, C's caller has to dealloc obj.
export function object_from_map(glyph, x, y) {
    let fakeobj = false, mimic_obj = false;
    const glyphotyp = pg_glyph_is_object(glyph) ? pg_glyph_to_obj(glyph)
        /* if not an object, probably a detected chest trap */
        : pg_glyph_is_cmap(glyph)
            ? (pg_sobj_at(CHEST, x, y) ? CHEST : LARGE_BOX)
            : STRANGE_OBJECT;

    let otmp = pg_sobj_at(glyphotyp, x, y);
    if (!otmp)
        for (const o of [...(game.level?.buriedobjlist || []),
                         ...(game.level?.buriedobjs || [])])
            if (o.ox === x && o.oy === y && o.otyp === glyphotyp) { otmp = o; break; }

    /* there might be a mimic here posing as an object */
    let mtmp = m_at(x, y);
    if (mtmp && mtmp.m_ap_type === 'obj' && mtmp.mappearance === glyphotyp) {
        otmp = null;
        mimic_obj = true;
    } else {
        mtmp = null;
    }

    if (!otmp || otmp.otyp !== glyphotyp) {
        // C mksobj()s (or mkobj()s, for a class placeholder otyp) a temporary
        // object to name.  Both consume RNG, which is why C stops the timers
        // and frees it again; this port synthesises a plain descriptor instead,
        // so a wiring pass has to decide whether the RNG draws matter here.
        otmp = { otyp: glyphotyp, oclass: objects[glyphotyp]?.oc_class,
                 quan: 1, spe: 0, corpsenm: -1, dknown: 0, where: 'floor',
                 ox: x, oy: y };
        fakeobj = true;
        if (otmp.oclass === COIN_CLASS) otmp.quan = 2;   /* force pluralization */
        else if (otmp.otyp === 419 /* SLIME_MOLD */)
            otmp.spe = game.context?.current_fruit ?? 0;
        if (mtmp && mtmp.mcorpsenm != null && mtmp.mcorpsenm >= 0) {
            if (otmp.otyp === 419) otmp.spe = mtmp.mcorpsenm;
            else otmp.corpsenm = mtmp.mcorpsenm;
        } else if (otmp.otyp === 259 /* CORPSE */ && pg_glyph_is_body(glyph)) {
            otmp.corpsenm = glyph.corpsenm;
        } else if (otmp.otyp === 481 /* STATUE */ && pg_glyph_is_statue(glyph)) {
            otmp.corpsenm = glyph.corpsenm;
        }
        if (otmp.otyp === 218 /* LEASH */) otmp.leashmon = 0;
        otmp.no_charge = (otmp.otyp === STRANGE_OBJECT) && costly_spot(x, y);
    }
    /* mark an adjacent object as having been seen up close */
    if (otmp && pg_next2u(x, y) && !Blind() && !Hallucination_u()
        && (fakeobj || otmp.where === 'floor')
        && !pg_iflags().terrainmode)
        observe_object_pg(otmp);
    if (fakeobj && mtmp && mimic_obj
        && (otmp.dknown || mtmp.m_ap_dknown)) {
        mtmp.m_ap_dknown = 1;
        observe_object_pg(otmp);
    }
    return { fakeobj, obj: otmp };
}
function observe_object_pg(obj) { if (obj) obj.dknown = 1; }
/* shk.c costly_spot(x, y) — inside a shop the hero has not paid in. */
function costly_spot(_x, _y) { return false; }

// C ref: pager.c:379 look_at_object(buf, x, y, glyph) — the object's name plus
// the terrain suffix that says where it is stuck.
export function look_at_object(x, y, glyph) {
    const { fakeobj, obj: otmp } = object_from_map(glyph, x, y);
    let buf;

    if (otmp) {
        buf = (otmp.otyp !== STRANGE_OBJECT)
            ? distant_name_pg(otmp)
            : (objects[STRANGE_OBJECT]?.name || 'strange object');
    } else {
        buf = 'something';                          /* sanity precaution */
    }

    const typ = game.level?.at(x, y)?.typ;
    if (otmp && !fakeobj && otmp.where === 'buried') buf += ' (buried)';
    /* check TREE before STONE due to level.flags.arboreal */
    else if (IS_TREE(typ))
        buf += ` ${(otmp && is_treefruit(otmp)) ? 'dangling' : 'stuck'} in a tree`;
    else if (typ === STONE || typ === SCORR) buf += ' embedded in stone';
    else if (IS_WALL(typ) || typ === SDOOR) buf += ' embedded in a wall';
    else if (pg_closed_door(x, y)) buf += ' embedded in a door';
    else if (pg_is_pool(x, y)) buf += ' in water';
    else if (pg_is_lava(x, y)) buf += ' in molten lava';
    return buf.slice(0, BUFSZ - 1);
}
/* objnam.c distant_name(otmp, otmp->dknown ? doname_with_price : doname_vague_quan) */
function distant_name_pg(otmp) {
    const nm = objects[otmp.otyp]?.name || objects[otmp.otyp]?.desc || 'object';
    return (otmp.quan > 1) ? `${otmp.quan} ${nm}s` : pg_an(nm);
}
/* mkobj.c is_treefruit(obj) */
function is_treefruit(obj) {
    return obj?.otyp === 415 /* APPLE */ || obj?.otyp === 416 /* ORANGE */;
}

// C ref: pager.c:421 look_at_monster(buf, monbuf, mtmp, x, y) — the farlook
// name of a monster plus the "[seen: ...]" how-seen list.  Returns
// { buf, monbuf }; monbuf is '' when the caller passed NULL in C.
export function look_at_monster(mtmp, x, y, wantMonbuf = true) {
    const accurate = !Hallucination_u();
    const data = mtmp.data || {};
    const name = (data.name === 'coyote' && accurate)
        ? coyotename(mtmp) : distant_monnam(mtmp, ARTICLE_NONE);
    let buf = `${(mtmp.mx !== x || mtmp.my !== y)
                    ? ((mtmp.isshk && accurate) ? 'tail of ' : 'tail of a ') : ''}`
            + `${accurate ? monhealthdescr(mtmp, true) : ''}`
            + `${(mtmp.mtame && accurate) ? 'tame '
                 : (mtmp.mpeaceful && accurate) ? 'peaceful ' : ''}`
            + `${name}`;
    if (game.u?.ustuck === mtmp) {
        if (game.u.uswallow || pg_iflags().save_uswallow)
            buf += pg_digests(data) ? ', swallowing you' : ', engulfing you';
        else
            buf += ', holding you';
    }
    /* "if mtmp isn't able to move ... say so" */
    if (mtmp.mfrozen) buf += ", can't move (paralyzed or sleeping or busy)";
    else if (mtmp.msleeping) buf += ', asleep';
    else if (((mtmp.mstrategy | 0) & STRAT_WAITMASK) !== 0) buf += ', meditating';

    if (mtmp.mleashed) buf += ', leashed to you';
    if (mtmp.mtrapped && cansee(mtmp.mx, mtmp.my)) {
        const t = t_at(mtmp.mx, mtmp.my);
        const tt = t ? t.ttyp : NO_TRAP;
        /* newsym lets you know of the trap, so mention it here */
        if (tt === BEAR_TRAP || pg_is_pit(tt) || tt === WEB) {
            buf += `, trapped in ${pg_an(trap_explanation(tt))}`;
            t.tseen = 1;
        }
    }

    /* the hero sees a monster here, but persistent detection may be showing
       something else on the remembered map */
    if (mtmp.mundetected || mtmp.m_ap_type || visible_region_at(x, y))
        buf += mhidden_description(mtmp, MHID_PREFIX | MHID_ARTICLE | MHID_REGION);

    let monbuf = '';
    if (wantMonbuf) {
        const how_seen = howmonseen(mtmp);
        const MONSEEN_NORMAL = 1, MONSEEN_SEEINVIS = 2, MONSEEN_INFRAVIS = 4,
              MONSEEN_TELEPAT = 8, MONSEEN_XRAYVIS = 16, MONSEEN_DETECT = 32,
              MONSEEN_WARNMON = 64;
        let hs = how_seen;
        const push = (s) => { monbuf += s; };
        if (hs !== 0 && hs !== MONSEEN_NORMAL) {
            const step = (bit, txt) => {
                if (hs & bit) { push(txt); hs &= ~bit; if (hs) push(', '); }
            };
            step(MONSEEN_NORMAL, 'normal vision');
            step(MONSEEN_SEEINVIS, 'see invisible');
            step(MONSEEN_INFRAVIS, 'infravision');
            step(MONSEEN_TELEPAT, 'telepathy');
            step(MONSEEN_XRAYVIS, 'astral vision');   /* Eyes of the Overworld */
            step(MONSEEN_DETECT, 'monster detection');
            if (hs & MONSEEN_WARNMON) {
                if (Hallucination_u()) push('paranoid delusion');
                else push(`warned of ${pg_makeplural(data.name || 'creature')}`);
                hs &= ~MONSEEN_WARNMON;
                if (hs) push(', ');
            }
            if (hs) {
                pg_impossible('lookat: unknown method of seeing monster');
                push(`(${hs})`);
            }
        }
    }
    return { buf: buf.slice(0, BUFSZ - 1), monbuf };
}
// C ref: do_name.c rndmonnam(adjective) — a random monster name off the CORE
// rng (rn2), used when hallucinating.  C rerolls until it gets a non-unique,
// non-placeholder species; this keeps the single draw and the reroll loop.
function rndmonnam() {
    for (let tries = 0; tries < 100; tries++) {
        const mon = monster_by_pmidx(rn2(NUMMONS));
        if (mon && mon.name && !(mon.mflags2 & 0x00000010 /* M2_PNAME */))
            return mon.name;
    }
    return 'creature';
}

/* do_name.c coyotename(mtmp, buf) */
function coyotename(mtmp) {
    const names = ['Wile E.', 'Ralph', 'Road Runner', 'Coyote Kid'];
    return `coyote called ${names[(mtmp.m_id | 0) % names.length]}`;
}
/* mondata.h digests(ptr) == attacktype(ptr, AT_ENGL) */
function pg_digests(ptr) {
    return (ptr?.mattk || []).some((a) => a && a.aatyp === 12 /* AT_ENGL */);
}
/* trap.h is_pit(ttyp) */
function pg_is_pit(tt) { return tt === PIT || tt === (PIT + 1) /* SPIKED_PIT */; }
/* objnam.c makeplural() — the general port lives in js/invent.js. */
function pg_makeplural(s) { return /s$/.test(s) ? s : `${s}s`; }
/* display.c howmonseen(mon) — the bitmask lookat() decodes. */
function howmonseen(mtmp) {
    let how = 0;
    if (cansee(mtmp.mx, mtmp.my) && !mtmp.minvis) how |= 1;   /* NORMAL */
    return how;
}

// C ref: pager.c:656 lookat(x, y, buf, monbuf) — the "(firstmatch)" detail
// do_screen_description() appends in parentheses.  Returns
// { pm, buf, monbuf }; pm is the permonst for the data.base lookup, and is
// suppressed while hallucinating.
export function lookat(x, y) {
    let mtmp = null, pm = null, buf = '', monbuf = '';
    const u = pg_u();
    const glyph = pg_glyph_at(x, y);
    const iflags = pg_iflags();

    if (pg_u_at(x, y) && canspotself_pg()
        && !(iflags.save_uswallow && pg_glyph_is_monster(glyph) && !glyph.isyou)
        && (!iflags.terrainmode || (iflags.terrainmode & 0x08 /* TER_MON */) !== 0)) {
        buf = pg_self_lookat();
        // C forces the general "wizard" data.base entry for a gnomish Wizard so
        // the lookup doesn't land on the "gnomish wizard" MONSTER entry.
        if (game.urole?.mnum === 12 /* PM_WIZARD */ && !u.Upolyd
            && game.urace?.mnum === 42 /* PM_GNOME */)
            pm = monster_by_pmidx(12);
        if ((u.uinvis || u.uundetected) && !Blind()
            && !(u.uswallow || iflags.save_uswallow)) {
            let how = 0;
            if (u.uinfravision) how |= 1;
            if (u.utelepat && !Blind()) how |= 2;
            if (u.udetect_monsters) how |= 4;
            if (how)
                buf += ` [seen: ${(how & 1) ? 'infravision' : ''}`
                     + `${((how & 3) > 2) ? ', ' : ''}`
                     + `${(how & 2) ? 'telepathy' : ''}`
                     + `${((how & 7) > 4) ? ', ' : ''}`
                     + `${(how & 4) ? 'monster detection' : ''}]`;
        }
    } else if (u.uswallow) {
        /* only called for spots adjacent to the hero when swallowed, and
           blindness doesn't stop the hero feeling what holds him */
        buf = `interior of ${mon_nam(u.ustuck)}`;
        pm = u.ustuck?.data || null;
    } else if (pg_glyph_is_monster(glyph)) {
        mtmp = m_at(x, y);
        if (mtmp) {
            const r = look_at_monster(mtmp, x, y, true);
            buf = r.buf; monbuf = r.monbuf;
            pm = mtmp.data;
        } else if (Hallucination_u()) {
            /* 'monster' must actually be a statue */
            buf = rndmonnam();
        }
    } else if (pg_glyph_is_object(glyph)) {
        buf = look_at_object(x, y, glyph);
    } else if (pg_glyph_is_trap(glyph)) {
        buf = trap_description(pg_glyph_to_trap(glyph), x, y);
    } else if (pg_glyph_is_warning(glyph)) {
        buf = def_warnsyms[glyph.warnindx]?.desc || '';
    } else if (pg_glyph_is_invisible(glyph)) {
        buf = invisexplain;                         /* redundant; caller handles */
    } else if (pg_glyph_is_nothing(glyph)) {
        buf = 'dark part of a room';
    } else if (pg_glyph_is_unexplored(glyph)) {
        buf = 'unexplored area';
    } else if (pg_glyph_is_cmap(glyph)) {
        const loc = game.level?.at(x, y);
        const symidx = pg_glyph_to_cmap(glyph);
        switch (symidx) {
        case S_altar: {
            const amsk = (loc?.altarmask ?? loc?.flags ?? 0);
            const algn = Amask2align(amsk & AM_MASK);
            const an_ = algn === A_CHAOTIC ? 'chaotic' : algn === A_NEUTRAL ? 'neutral'
                      : algn === A_LAWFUL ? 'lawful' : algn === A_NONE ? 'unaligned'
                      : 'aligned';
            buf = `${an_} ${(amsk & AM_SANCTUM) ? 'high ' : ''}altar`;
            break;
        }
        case S_ndoor:
            if (((loc?.doormask | 0) & ~D_TRAPPED) === D_BROKEN) buf = 'broken door';
            else buf = 'doorway';
            break;
        case S_cloud:
            buf = Is_airlevel(game.u?.uz) ? 'cloudy area' : 'fog/vapor cloud';
            break;
        case S_pool: case S_water: case S_lava: case S_lavawall: case S_ice:
            buf = pg_waterbody_name(x, y);
            break;
        case S_engroom: case S_engrcorr:
            buf = 'engraving';
            break;
        case S_stone:
            // C ref: pager.c:779 — defsym.h's PCHAR2 row makes
            // defsyms[S_stone].explanation "stone"; the "dark part of a room"
            // string in that row is the TILE NAME, not the explanation.
            if (!loc?.seenv) { buf = 'unexplored'; break; }
            if (loc.typ === STONE || loc.typ === SCORR) { buf = 'stone'; break; }
            /* FALLTHROUGH to defsyms[] */
            buf = defsyms[symidx]?.explanation || '';
            break;
        default:
            buf = defsyms[symidx]?.explanation || '';
            break;
        }
    } else {                                        /* not mon, obj, trap, cmap */
        buf = 'unexplored area';
    }
    return { pm: (pm && !Hallucination_u()) ? pm : null, buf, monbuf };
}
/* display.h canspotself() */
function canspotself_pg() {
    const u = pg_u();
    return !u.uinvis || !!u.useeinvis || !!u.uswallow;
}

// C ref: pager.c:1132 add_cmap_descr(...) — add one defsyms[] possibility to
// the "can be many things" list, with the pool/lava/water/ice descriptions
// re-derived from waterbody_name() and the trap-collapsing rules.
// `out_str` and `hit_trap` are boxes; returns the new `found` count.
export function add_cmap_descr(found, idx, glyph, article, cc, x_str, prefix,
                               hit_trap, firstmatch, out_str) {
    let mbuf = null;
    const absidx = Math.abs(idx);
    const NO_GLYPH = null;

    if (glyph === NO_GLYPH) {
        /* use x_str [almost] as-is */
        if (x_str === 'water') {
            /* duplicate some transformations performed by waterbody_name() */
            if (idx === S_pool) x_str = 'pool of water';
            else if (idx === S_water)
                x_str = !Is_waterlevel(game.u?.uz) ? 'wall of water'
                                                   : 'limitless water';
        }
        if (absidx === S_pool) idx = S_pool;
    } else if (absidx === S_pool || idx === S_water || idx === S_lava
               || idx === S_lavawall || idx === S_ice) {
        /* replace some descriptions (x_str) with waterbody_name() */
        const loc = game.level?.at(cc.x, cc.y);
        const save_ltyp = loc ? loc.typ : 0;

        if (absidx === S_pool) {
            if (loc) loc.typ = (idx === S_pool) ? POOL : MOAT;
            idx = S_pool;         /* force fake negative moat value positive */
        } else if (loc) {
            loc.typ = (idx === S_water) ? WATER
                      : (idx === S_lava) ? LAVAPOOL
                        : (idx === S_lavawall) ? LAVAWALL : ICE;
        }
        /* EHalluc_resistance = 1 around the call: never hallucinated here */
        mbuf = pg_waterbody_name(cc.x, cc.y);
        if (loc) loc.typ = save_ltyp;

        /* shorten the feedback for farlook/quicklook: "pool or ..." */
        if (mbuf === 'pool of water') mbuf = 'pool';
        else if (mbuf === 'molten lava') mbuf = 'lava';
        x_str = mbuf;
        /* avoid "an ice" and so forth */
        const noArt = ['water', 'ice', 'pool', 'moat', 'lava', 'swamp', 'molten',
                       'shallow', 'limitless', 'wall of lava', 'wall of water',
                       'frozen'];
        article = (noArt.some((p) => x_str.startsWith(p))
                   || / ice$/i.test(x_str)) ? 0 : 1;
    }

    if (!found) {
        /* this is the first match */
        if (is_cmap_trap(idx) && idx !== S_vibrating_square) {
            out_str.s = `${prefix}a trap`;
            hit_trap.v = true;
        } else {
            out_str.s = `${prefix}${(article === 2) ? pg_the(x_str)
                                    : (article === 1) ? pg_an(x_str) : x_str}`;
        }
        firstmatch.s = x_str;
        found = 1;
    } else if (!(hit_trap.v && is_cmap_trap(idx))
               && !(found >= 3 && is_cmap_drawbridge(idx))
               /* don't mention the vibrating square outside Gehennom unless
                  this happens to be one (hallucination?) */
               && (idx !== S_vibrating_square || pg_Inhell()
                   || (pg_glyph_is_trap(glyph)
                       && pg_glyph_to_trap(glyph) === VIBRATING_SQUARE))) {
        /* append unless out_str already contains the string to append */
        found += append_str(out_str, (article === 2) ? pg_the(x_str)
                                    : (article === 1) ? pg_an(x_str) : x_str);
        if (is_cmap_trap(idx) && idx !== S_vibrating_square) hit_trap.v = true;
    }
    return found;
}
/* dungeon.h In_hell(&u.uz) */
function pg_Inhell() { return game.u?.uz?.dnum === (game.dungeon_topology?.d_hell_dnum ?? -1); }

// C ref: pager.c:1247 do_screen_description(cc, looked, sym, out_str,
// &firstmatch, &for_supplement) — the whole "^ a trap or a doorway ..." /
// "(floor of a room)" assembly.  Returns the match count; `out_str`,
// `firstmatch` and `for_supplement` are boxes.
export function do_screen_description(cc, looked, sym, out_str, firstmatch,
                                      for_supplement) {
    const mon_interior = 'the interior of a monster';
    const unreconnoitered = 'unreconnoitered';
    const iflags = pg_iflags();
    const u = pg_u();
    let glyph = null, prefix, found = 0, skipped_venom = 0;
    let need_to_look = false;
    const submerged = false;      /* Underwater is not modelled by this port */
    const hallucinate = Hallucination_u();
    const hit_trap = { v: false };
    let x_str = null;

    if (looked) {
        glyph = pg_glyph_at(cc.x, cc.y);
        sym = glyph.sym;
        prefix = `${encglyph(glyph)}        `;
    } else {
        prefix = `${sym}        `;
    }

    // Restricted-vision cases first: swallowed/underwater limits the hero to
    // adjacent spots, and a detection display shows mostly background.
    if (!looked) {
        /* skip special handling */
    } else if (((u.uswallow || submerged) && !pg_next2u(cc.x, cc.y))
               || (((iflags.terrainmode | 0) & (0x20 /* TER_DETECT */ | 0x01 /* TER_MAP */))
                   === 0x20 && pg_glyph_is_cmap(glyph)
                   && pg_glyph_to_cmap(glyph) === S_stone)) {
        x_str = unreconnoitered;
        need_to_look = false;
    } else if (is_swallow_sym(sym)) {
        x_str = mon_interior;
        need_to_look = true;                        /* for specific monster type */
    }
    if (x_str) {
        if (!found) {
            out_str.s = `${prefix}${x_str}`;
            firstmatch.s = x_str;
            found++;
        } else {
            found += append_str(out_str, x_str);    /* not 'an(x_str)' */
        }
        // For is_swallow_sym() we still want the symbol's other possibilities
        // (wand for '/', throne for '\\'), so only unreconnoitered jumps out.
        if (x_str === unreconnoitered)
            return didlook(cc, looked, found, need_to_look, out_str, firstmatch,
                           for_supplement);
    }

    /* Check for monsters */
    if (!iflags.terrainmode || (iflags.terrainmode & 0x08) !== 0) {
        for (let i = 1; i < MAXMCLASSES; i++) {
            if (i === S_invisible) continue;        /* avoid matching on this */
            const s = looked ? showsym(i + SYM_OFF_M, def_monsyms[i]?.sym)
                             : def_monsyms[i]?.sym;
            const ex = def_monsyms[i]?.explain;
            if (sym === s && ex) {
                need_to_look = true;
                if (!found) {
                    out_str.s = `${prefix}${pg_an(ex)}`;
                    firstmatch.s = ex;
                    found++;
                } else {
                    found += append_str(out_str, pg_an(ex));
                }
            }
        }
        /* '@' when it refers to a hero not normally displayed by that symbol */
        const humanSym = looked ? showsym(S_HUMAN + SYM_OFF_M, def_monsyms[S_HUMAN]?.sym)
                                : def_monsyms[S_HUMAN]?.sym;
        if ((looked ? (sym === humanSym && pg_u_at(cc.x, cc.y))
                    : (sym === humanSym && !game.flags?.showrace))
            && !(game.urace?.mnum === 0 /* PM_HUMAN */
                 || game.urace?.mnum === 5 /* PM_ELF */) && !u.Upolyd)
            found += append_str(out_str, 'you');    /* tack on "or you" */
    }

    /* Now check for objects */
    if (!iflags.terrainmode || (iflags.terrainmode & 0x04) !== 0) {
        const bouldersym = showsym(SYM_BOULDER + SYM_OFF_X,
                                   def_oc_syms[ROCK_CLASS]?.sym);
        for (let i = 1; i < MAXOCLASSES; i++) {
            const match = (i !== ROCK_CLASS)
                ? (sym === (looked ? showsym(i + SYM_OFF_O, def_oc_syms[i]?.sym)
                                   : def_oc_syms[i]?.sym))
                /* ROCK_CLASS is complicated: statues show as the monster they
                   depict, boulders may use a custom symbol */
                : (pg_glyph_is_statue(glyph) || sym === bouldersym);
            if (!match) continue;
            let oc_ptr = def_oc_syms[i]?.explain;
            /* engravings share S_rock's symbol, so shorten this */
            if (i === ROCK_CLASS && oc_ptr === 'boulder or statue') {
                if (sym === bouldersym) oc_ptr = 'boulder';       /* drop "or statue" */
                else if (pg_glyph_is_statue(glyph)) oc_ptr = 'statue';
                else if (looked) continue;                        /* drop both */
            }
            need_to_look = true;
            if (looked && i === VENOM_CLASS) { skipped_venom++; continue; }
            if (!found) {
                out_str.s = `${prefix}${pg_an(oc_ptr)}`;
                firstmatch.s = oc_ptr;
                found++;
            } else {
                found += append_str(out_str, pg_an(oc_ptr));
            }
        }
    }

    if (sym === DEF_INVISIBLE) {
        /* for active clairvoyance, use the alternate "unseen creature" */
        const usealt = ((game.u?.uprops?.EDetect_monsters | 0) & I_SPECIAL) !== 0;
        const unseen_explain = (usealt || Blind()) ? altinvisexplain : invisexplain;
        if (!found) {
            out_str.s = `${prefix}${pg_an(unseen_explain)}`;
            firstmatch.s = unseen_explain;
            found++;
        } else {
            found += append_str(out_str, pg_an(unseen_explain));
        }
    }
    if ((glyph && pg_glyph_is_nothing(glyph))
        || (looked && sym === showsym(SYM_NOTHING + SYM_OFF_X, ' '))) {
        x_str = 'the dark part of a room';
        if (!found) {
            out_str.s = `${prefix}${x_str}`;
            firstmatch.s = x_str;
            found++;
        } else {
            found += append_str(out_str, x_str);
        }
    }
    if ((glyph && pg_glyph_is_unexplored(glyph))
        || (looked && sym === showsym(SYM_UNEXPLORED + SYM_OFF_X, ' '))) {
        x_str = submerged ? 'land' : 'unexplored';
        if (!found) {
            out_str.s = `${prefix}${x_str}`;
            firstmatch.s = x_str;
            found++;
        } else {
            found += append_str(out_str, x_str);
        }
    }

    /* Now check for graphics symbols */
    for (let i = 0; i < MAXPCHARS; i++) {
        // Index hackery (C's own comment): we want "pool or moat or wall of
        // water or lava or wall of lava", so water rotates to the front of
        // (lava, lavawall, water), lava to the middle, lavawall to last.
        const alt_i = (i === S_lava) ? S_water
                    : (i === S_lavawall) ? S_lava
                      : (i === S_water) ? S_lavawall : i;
        x_str = defsyms[alt_i]?.explanation;
        /* cmap includes beams, shield effects, swallow boundaries and
           explosions; skip all of those */
        if (!x_str) continue;

        if (sym === (looked ? showsym(alt_i + SYM_OFF_P, defsyms[alt_i].sym)
                            : defsyms[alt_i].sym)) {
            /* check if dark part of a room was already included above */
            if (alt_i === S_darkroom && glyph && pg_glyph_is_nothing(glyph)) continue;

            /* avoid "an unexplored", "an stone", "an air",
               "a floor of a room", "a dark part of a room" */
            const article = pg_strstri(x_str, ' of a room') ? 2
                          : !(alt_i === S_stone || x_str === 'air' || x_str === 'land')
                            ? 1 : 0;

            found = add_cmap_descr(found, alt_i, glyph, article, cc, x_str, prefix,
                                   hit_trap, firstmatch, out_str);
            if (alt_i === S_pool) {
                // "pool of water" and "moat" share symbol and glyph but have
                // different descriptions; add the second one without bumping
                // 'found', to avoid "can be many things".
                add_cmap_descr(found, -S_pool, glyph, 1, cc, 'moat', prefix,
                               hit_trap, firstmatch, out_str);
                need_to_look = true;
            }

            if (alt_i === S_altar || is_cmap_trap(alt_i)
                || (hallucinate && (alt_i === S_water || alt_i === S_lava
                                    || alt_i === S_lavawall || alt_i === S_ice))
                || alt_i === S_engroom || alt_i === S_engrcorr
                || alt_i === S_grave)   /* 'need_to_look' to report engraving */
                need_to_look = true;
        }
    }

    /* Now check for warning symbols */
    for (let i = 1; i < WARNCOUNT; i++) {
        x_str = def_warnsyms[i]?.desc;
        if (sym === (looked ? showsym(i + SYM_OFF_W, def_warnsyms[i]?.ch)
                            : def_warnsyms[i]?.ch)) {
            if (!found) {
                out_str.s = `${prefix}${x_str}`;
                firstmatch.s = x_str;
                found++;
            } else {
                found += append_str(out_str, x_str);
            }
            /* Kludge: warning trumps boulders on the display.  Reveal the
               boulder too or the player can get confused. */
            if (looked && pg_sobj_at(BOULDER, cc.x, cc.y))
                out_str.s += ' co-located with a boulder';
            break;
        }
    }

    /* if we ignored venom and the list turned out to be short, put it back */
    if (skipped_venom && found < 2) {
        x_str = def_oc_syms[VENOM_CLASS]?.explain;
        if (!found) {
            out_str.s = `${prefix}${pg_an(x_str)}`;
            firstmatch.s = x_str;
            found++;
        } else {
            found += append_str(out_str, pg_an(x_str));
        }
    }

    // C's final "optional overriding symbols" loop re-enters check_monsters for
    // SYM_PET_OVERRIDE / SYM_HERO_OVERRIDE.  go.ov_primary_syms[] is only
    // populated by a SYMBOLS= line in the rc, so the loop finds nothing unless
    // one is set; the goto-based re-entry is the one piece of do_screen_description
    // this translation does not reproduce.

    if (found > 4)
        /* 3.6.3 reinstated the prefix so this stays a punctuated sentence */
        out_str.s = `${prefix}can be many things`;

    return didlook(cc, looked, found, need_to_look, out_str, firstmatch,
                   for_supplement);
}

// C ref: pager.c `didlook:` label — the "follow multiple possibilities or an
// ambiguous explanation by something more detailed" tail.
function didlook(cc, looked, found, need_to_look, out_str, firstmatch,
                 for_supplement) {
    if (looked && (found > 1 || need_to_look)) {
        const r = lookat(cc.x, cc.y);
        let look_buf = r.buf;
        if (r.pm && for_supplement) for_supplement.pm = r.pm;
        if (look_buf === 'ice') look_buf = pg_ice_descr(cc.x, cc.y);
        if (look_buf === 'staircase down' && on_qstart_level_pg() && !ok_to_quest_pg())
            look_buf = 'blocked staircase down';

        if (look_buf) firstmatch.s = look_buf;
        if (firstmatch.s) {
            const temp_buf = { s: ` (${firstmatch.s}` };
            add_quoted_engraving(cc.x, cc.y, temp_buf, false);
            temp_buf.s += ')';
            out_str.s = (out_str.s + temp_buf.s).slice(0, BUFSZ - 1);
            found = 1;                              /* we have something to look up */
        }
        if (r.monbuf)
            out_str.s = (out_str.s + ` [seen: ${r.monbuf}]`).slice(0, BUFSZ - 1);
    }
    return found;
}
/* quest.c on_level(&u.uz, &qstart_level) / ok_to_quest() */
function on_qstart_level_pg() { return false; }
function ok_to_quest_pg() { return true; }

// C ref: pager.c:1630 add_quoted_engraving(x, y, buf, force) — when farlook is
// reporting on an engraving, include its text.  `buf` is a box; the caller
// supplies the closing paren.
export function add_quoted_engraving(x, y, buf, force) {
    const ep = engr_at(x, y);
    const floorengr = buf.s === ' (engraving';
    const headstone = buf.s === ' (grave';

    if (!ep) return false;
    if (!floorengr && !headstone && !force) return false;

    const temp_buf = ep.eread
        ? ` with ${headstone ? 'headstone reading' : 'remembered text'}: `
          + `"${ep.rememberedText ?? ep.engr_txt ?? ''}"`
        : ` ${headstone ? 'whose headstone' : 'that'} you haven't read`;

    buf.s = (buf.s + temp_buf).slice(0, BUFSZ - 1);
    return true;
}

// C ref: pager.c:1670 `const char what_is_a_location[]` — "also used by getpos
// hack in getpos.c".
export const what_is_a_location = 'a monster, object or location';

// C ref: pager.c:1673 do_look(mode, click_cc) — the '/' whatis (mode 0), the
// ';' glance (mode 1) and the right-click look (mode 2).  Needs getpos() and
// checkfile(), which live in js/hack.js; see set_pager_deps() above.
export async function do_look(mode, click_cc) {
    const quick = (mode === 1);       /* use cursor; don't search for more info */
    const clicklook = (mode === 2);   /* right mouse-click method */
    const out_str = { s: '' };
    const firstmatch = { s: '' };
    const for_supplement = { pm: null };
    const u = pg_u();
    let i = '\0', ans = 0, sym = 0, found;
    const cc = { x: 0, y: 0 };
    let from_screen = false;

    if (!clicklook) {
        if (quick) {
            i = 'y';
        } else {
            // The PICK_ONE "What do you want to look at:" menu.  Accelerators:
            // '/', 'i', '?' (with 'y'/'n' kept as unshown group accelerators for
            // backwards compatibility when lootabc is off), then the
            // m/M/o/O/t/T/e/E block, which is suppressed while swallowed or
            // hallucinating.  whatis_menu_items()/whatis_menu_pick() above own
            // the live version of this menu.
            if (!_pg.render_whatis_menu) return 0;  /* ECMD_OK; see set_pager_deps */
            i = await whatis_menu_pick(_pg.render_whatis_menu);
            if (!i) return 0;                       /* ECMD_OK */
        }
    } else {
        cc.x = click_cc.x; cc.y = click_cc.y;
        sym = 0;
        from_screen = false;
    }

    if (!clicklook) {
        switch (i) {
        default:
        case 'q':
            return 0;
        case 'y': case '/':
            from_screen = true;
            sym = 0;
            cc.x = u.ux; cc.y = u.uy;
            break;
        case 'i': {
            const invlet = _pg.display_inventory
                ? await _pg.display_inventory(null, true) : null;
            if (!invlet || invlet === '\x1b') return 0;
            let name = '';
            for (const invobj of (game.invent || []))
                if (invobj.invlet === invlet) {
                    name = objects[invobj.otyp]?.name || '';
                    break;
                }
            if (name && _pg.checkfile)
                await _pg.checkfile(name, /* chkfilUsrTyped|chkfilDontAsk */ 3);
            return 0;
        }
        case '?': {
            from_screen = false;
            // getlin("Specify what? (type the word)") then mungspaces();
            // js/hack.js do_look_full() owns the live getlin path.
            const typed = _pg.getlin ? await _pg.getlin('Specify what? (type the word)')
                                     : '';
            const word = (typed === ' ') ? typed
                : String(typed || '').replace(/\s+/g, ' ').replace(/^ | $/g, '');
            if (!word || word[0] === '\x1b') return 0;
            if (word.length > 1) {                  /* a complete string */
                if (_pg.checkfile) await _pg.checkfile(word, 3);
                return 0;
            }
            sym = word[0];
            break;
        }
        case 'm': await look_all(true, true); return 0;
        case 'M': await look_all(false, true); return 0;
        case 'o': await look_all(true, false); return 0;
        case 'O': await look_all(false, false); return 0;
        case 't': await look_traps(true); return 0;
        case 'T': await look_traps(false); return 0;
        case 'e': await look_engrs(true); return 0;
        case 'E': await look_engrs(false); return 0;
        }
    }

    // C ref: pager.c:1892 — flags.verbose is SNAPSHOTTED here and restored at
    // :1961, so the :1911 clear is per-command.  Clearing the real flag
    // globally measured -99 on seed2200; keep the save/restore.
    const save_verbose = game.flags?.verbose;
    let verbose = !!save_verbose && !quick;

    do {
        for_supplement.pm = null;
        out_str.s = '';

        if (from_screen || clicklook) {
            if (from_screen) {
                await update_topl(verbose
                    ? `Please move the cursor to ${what_is_a_location}.`
                    : `Pick ${what_is_a_location}.`);
                const got = _pg.getpos ? await _pg.getpos(cc, quick, what_is_a_location)
                                       : null;
                if (got == null || got.ans < 0 || got.cc.x < 0) break;   /* done */
                ans = got.ans; cc.x = got.cc.x; cc.y = got.cc.y;
                verbose = false;                    /* only ask the long question once */
            }
        }

        found = do_screen_description(cc, (from_screen || clicklook), sym,
                                      out_str, firstmatch, for_supplement);

        if (found) {
            /* putmixed(WIN_MESSAGE, 0, out_str) — tty routes it through
               update_topl(), so an over-wide description wraps on --More--. */
            await update_topl(out_str.s);

            /* check the data file for information about this thing */
            if (found === 1 && ans !== LOOK_QUICK && ans !== LOOK_ONCE
                && (ans === LOOK_VERBOSE || (game.flags?.help && !quick))
                && !clicklook) {
                const supplemental_name = { s: '' };
                if (_pg.checkfile)
                    await _pg.checkfile(firstmatch.s,
                                        (ans === LOOK_VERBOSE) ? 2 /* chkfilDontAsk */ : 0,
                                        supplemental_name);
                if (for_supplement.pm)
                    await do_supplemental_info(supplemental_name.s, for_supplement.pm,
                                               ans === LOOK_VERBOSE);
            }
        } else {
            await update_topl("I've never heard of such things.");
        }
    } while (from_screen && !quick && ans !== LOOK_ONCE && !clicklook);

    if (game.flags) game.flags.verbose = save_verbose;
    return 0;                                       /* ECMD_OK */
}

// C ref: pager.c:1965 look_region_nearby(&lo_x, &lo_y, &hi_x, &hi_y, nearby) —
// nearby means a BOLT_LIM box around the hero, else the whole map.
export function look_region_nearby(nearby) {
    const u = pg_u();
    return {
        lo_y: nearby ? Math.max(u.uy - BOLT_LIM, 0) : 0,
        lo_x: nearby ? Math.max(u.ux - BOLT_LIM, 1) : 1,
        hi_y: nearby ? Math.min(u.uy + BOLT_LIM, ROWNO - 1) : ROWNO - 1,
        hi_x: nearby ? Math.min(u.ux + BOLT_LIM, COLNO - 1) : COLNO - 1,
    };
}

// C ref: pager.c:1978 look_all(nearby, do_mons) — the /m /M /o /O listings.
export async function look_all(nearby, do_mons) {
    const win = create_nhwindow_text();
    const u = pg_u();
    let count = 0;
    const { lo_x, lo_y, hi_x, hi_y } = look_region_nearby(nearby);

    for (let y = lo_y; y <= hi_y; y++) {
        for (let x = lo_x; x <= hi_x; x++) {
            let lookbuf = '';
            let glyph = pg_glyph_at(x, y);
            if (do_mons) {
                if (pg_glyph_is_monster(glyph)) {
                    if (pg_u_at(x, y) && canspotself_pg()) {
                        lookbuf = pg_self_lookat();
                        ++count;
                    } else {
                        const mtmp = m_at(x, y);
                        if (mtmp) {
                            lookbuf = look_at_monster(mtmp, x, y, false).buf;
                            ++count;
                        }
                    }
                } else if (pg_glyph_is_invisible(glyph)) {
                    lookbuf = invisexplain;         /* remembered, unseen, creature */
                    ++count;
                } else if (pg_glyph_is_warning(glyph)) {
                    lookbuf = def_warnsyms[glyph.warnindx]?.desc || '';
                    ++count;
                }
            } else if (pg_glyph_is_object(glyph)) {
                lookbuf = look_at_object(x, y, glyph);
                ++count;
            }
            if (lookbuf) {
                const cmode = (pg_getpos_coords() !== GPCOORDS_NONE)
                    ? pg_getpos_coords() : GPCOORDS_MAP;
                if (count === 1) {
                    const which = do_mons ? 'monsters' : 'objects';
                    putstr(win, 0, nearby
                        ? `${pg_upstart(which)} currently shown near `
                          + `${(cmode !== GPCOORDS_COMPASS)
                                ? coord_desc(u.ux, u.uy, cmode)
                                : !canspotself_pg() ? 'your position' : 'you'}:`
                        : `All ${which} currently shown on the map:`);
                    /* hack alert (C's): Qt renders a text window in a
                       fixed-width font if any line has 4 consecutive spaces */
                    putstr(win, 0, '    ');
                }
                let coordbuf = coord_desc(x, y, cmode);
                // this format wrinkle makes the commas of <x,y> line up
                if (cmode === GPCOORDS_MAP && y < 10) coordbuf += ' ';
                const pad = (cmode === GPCOORDS_SCREEN) ? 0
                          : (cmode === GPCOORDS_MAP) ? 8 : 12;
                let outbuf = `${coordbuf.padStart(pad)}  ${encglyph(glyph)}  `;
                putmixed(win, 0, outbuf + lookbuf.slice(0, BUFSZ - 1 - outbuf.length));
            }
        }
    }
    if (count) await display_nhwindow_text(win, true);
    else await update_topl(`No ${do_mons ? 'monsters' : 'objects'} are currently `
                           + `shown ${nearby ? 'nearby' : 'on the map'}.`);
}
/* iflags.getpos_coords */
function pg_getpos_coords() { return pg_iflags().getpos_coords || GPCOORDS_NONE; }

// C ref: pager.c:2077 look_traps(nearby) — "a /M style display of discovered
// traps, even when they're covered".
export async function look_traps(nearby) {
    const win = create_nhwindow_text();
    let count = 0;
    const { lo_x, lo_y, hi_x, hi_y } = look_region_nearby(nearby);

    for (let y = lo_y; y <= hi_y; y++) {
        for (let x = lo_x; x <= hi_x; x++) {
            let lookbuf = '';
            let glyph = pg_glyph_at(x, y);
            if (pg_glyph_is_trap(glyph)) {
                lookbuf = trap_description(pg_glyph_to_trap(glyph), x, y);
                ++count;
            } else {
                const t = t_at(x, y);
                // can't use /" to track traps moved by bubbles or clouds
                // except when the hero has direct line of sight
                if (t && t.tseen
                    && ((!Is_waterlevel(game.u?.uz) && !Is_airlevel(game.u?.uz))
                        || couldsee(x, y))) {
                    lookbuf = `${trap_explanation(t.ttyp)}`
                            + `, obscured by ${encglyph(glyph)}`;
                    glyph = { kind: 'trap', trap: t, ttyp: t.ttyp,
                              sym: trap_glyph(t).ch };
                    ++count;
                }
            }
            if (lookbuf) {
                const cmode = (pg_getpos_coords() !== GPCOORDS_NONE)
                    ? pg_getpos_coords() : GPCOORDS_MAP;
                if (count === 1) {
                    putstr(win, 0, pg_upstart(`${nearby ? 'nearby ' : ''}`
                        + `seen or remembered traps${nearby ? '' : ' on this level'}:`));
                    putstr(win, 0, '    ');         /* separator */
                }
                const pad = (cmode === GPCOORDS_SCREEN) ? 0
                          : (cmode === GPCOORDS_MAP) ? 8 : 12;
                const outbuf = `${coord_desc(x, y, cmode).padStart(pad)}  `
                             + `${encglyph(glyph)}  `;
                putmixed(win, 0, outbuf + lookbuf.slice(0, BUFSZ - 1 - outbuf.length));
            }
        }
    }
    if (count) await display_nhwindow_text(win, true);
    else await update_topl(`No traps seen or remembered${nearby ? ' nearby' : ''}.`);
}

// C ref: pager.c:2143 look_engrs(nearby) — discovered engravings including
// headstones, even when covered, provided they have been read.
export async function look_engrs(nearby) {
    const win = create_nhwindow_text();
    let count = 0;
    const { lo_x, lo_y, hi_x, hi_y } = look_region_nearby(nearby);

    for (let y = lo_y; y <= hi_y; y++) {
        for (let x = lo_x; x <= hi_x; x++) {
            const loc = game.level?.at(x, y);
            if (!loc?.seenv) continue;
            // this won't find remembered engravings which aren't there anymore
            // (scuffed away by monster movement, or deleted during shop or
            // vault wall repair)
            const e = engr_at(x, y);
            if (!e) continue;
            const is_headstone = IS_GRAVE(pg_lastseentyp(x, y));
            const lookbuf = { s: ` (${is_headstone ? 'grave' : 'engraving'}` };
            add_quoted_engraving(x, y, lookbuf, true);
            // the paren is what add_quoted_engraving() keys on; strip it here
            if (is_headstone) {
                lookbuf.s = lookbuf.s.replace('(grave with ', '')
                                     .replace('(grave whose ', '');
            } else {
                lookbuf.s = lookbuf.s.replace('(engraving with ', '')
                                     .replace('(engraving ', 'engraving ');
            }

            let glyph = pg_glyph_at(x, y);
            const sym = pg_glyph_is_cmap(glyph) ? pg_glyph_to_cmap(glyph) : SYM_NOTHING;
            if (is_cmap_engraving(sym) || sym === S_grave) {
                ++count;                            /* shown on the map */
            } else {
                lookbuf.s += `, obscured by ${encglyph(glyph)}`;
                glyph = { kind: 'cmap', sym: is_headstone ? defsyms[S_grave].sym
                                                          : defsyms[S_engroom].sym,
                          cmap: is_headstone ? S_grave : S_engroom, x, y };
                ++count;
            }
            const cmode = (pg_getpos_coords() !== GPCOORDS_NONE)
                ? pg_getpos_coords() : GPCOORDS_MAP;
            if (count === 1) {
                putstr(win, 0, pg_upstart(`${nearby ? 'nearby ' : ''}`
                    + `seen or remembered engravings${nearby ? '' : ' on this level'}:`));
                putstr(win, 0, '    ');             /* separator */
            }
            const pad = (cmode === GPCOORDS_SCREEN) ? 0
                      : (cmode === GPCOORDS_MAP) ? 8 : 12;
            const outbuf = `${coord_desc(x, y, cmode).padStart(pad)}  `
                         + `${encglyph(glyph)} `;
            putmixed(win, 0, outbuf + lookbuf.s.slice(0, BUFSZ - 1 - outbuf.length));
        }
    }
    if (count) await display_nhwindow_text(win, true);
    else await update_topl(`No engravings seen or remembered${nearby ? ' nearby' : ''}.`);
}
/* svl.lastseentyp[x][y] — flat COLNO*ROWNO array where the level graph keeps it */
function pg_lastseentyp(x, y) {
    const arr = game.level?.lastseentyp;
    if (Array.isArray(arr)) {
        const v = arr[x + y * 80];
        if (v != null) return v;
    }
    return game.level?.at(x, y)?.typ;
}

/* pager.c:2216 suptext1[] / suptext2[] */
const suptext1 = [
    '%s is a member of a marauding horde of orcs',
    'rumored to have brutally attacked and plundered',
    'the ordinarily sheltered town that is located ',
    'deep within The Gnomish Mines.',
    '',
    'The members of that vicious horde proudly and ',
    'defiantly acclaim their allegiance to their',
    'leader %s in their names.',
];
const suptext2 = [
    '"%s" is the common dungeon name of',
    'a nefarious orc who is known to acquire property',
    'from thieves and sell it off for profit.',
    '',
    'The perpetrator was last seen hanging around the',
    'stairs leading to the Gnomish Mines.',
];

// C ref: pager.c:2252 do_supplemental_info(name, pm, without_asking) — the
// in-game mythology blurb for an orctown marauder / the Fence.
export async function do_supplemental_info(name, pm, without_asking) {
    const is_marauder = pg_is_orc(pm);
    if (!(is_marauder && String(name || '').length < BUFSZ - 1)) return;

    const bpIdx = String(name).indexOf(' of ');
    const bp2Idx = String(name).indexOf(' the Fence');
    if (bpIdx < 0 && bp2Idx < 0) return;

    const fullname = String(name);
    let yes_to_moreinfo = false;
    if (!without_asking) {
        let question = 'More info about "';
        question += fullname.slice(0, BUFSZ - 1 - (question.length + 2));
        question += '"?';
        const { y_n } = await import('./display.js');
        if (await y_n(question) === 'y') yes_to_moreinfo = true;
    }
    if (!yes_to_moreinfo) return;

    let textp, gang;
    let head = fullname;
    if (bpIdx >= 0) {
        textp = suptext1;
        gang = fullname.slice(bpIdx + 4);
        head = fullname.slice(0, bpIdx);
    } else {
        textp = suptext2;
        gang = '';
    }
    const lines = [];
    let subs = 0;
    for (const t of textp)
        lines.push(pg_strstri(t, '%s') ? t.replace('%s', subs++ ? gang : head) : t);
    await display_text_window(lines);
}
/* mondata.h is_orc(ptr) */
function pg_is_orc(pm) { return !!pm && pm.mlet === 'o'; }

// C ref: pager.c:2322 dowhatis() — the '/' command.
export async function dowhatis() { return do_look(0, null); }

// C ref: pager.c:2329 doquickwhatis() — the ';' #glance command.
export async function doquickwhatis() { return do_look(1, null); }

// C ref: pager.c:2336 doidtrap() — the '^' #showtrap command.  Trapped doors
// and chests used to be shown as fake bear traps; they have their own trap
// types now but aren't part of the ftrap chain, so a blind hero using '^' can
// still see them.
export async function doidtrap() {
    const u = pg_u();
    const { getdir } = await import('./cmd.js');
    if (!await getdir('^')) return 1;               /* ECMD_CANCEL */
    const x = u.ux + u.dx, y = u.uy + u.dy;

    const glyph = pg_glyph_at(x, y);
    if (pg_glyph_is_trap(glyph)) {
        const tt = pg_glyph_to_trap(glyph);
        if (tt === BEAR_TRAP || tt === TRAPPED_DOOR || tt === TRAPPED_CHEST) {
            const chesttrap = trapped_chest_at(tt, x, y);
            if (chesttrap || trapped_door_at(tt, x, y)) {
                await update_topl(`That is a trapped ${chesttrap ? 'chest' : 'door'}.`);
                return 0;                           /* ID'd, but no time elapses */
            }
        }
    }

    for (const trap of (game.level?.traps || []))
        if (trap.tx === x && trap.ty === y) {
            if (!trap.tseen) break;
            const tt = trap.ttyp;
            if (u.dz) {
                if (u.dz < 0 ? pg_is_hole(tt) : tt === ROCKTRAP) break;
            }
            await update_topl(`That is ${pg_an(trap_explanation(tt))}`
                + `${!trap.madeby_u ? ''
                    : (tt === WEB) ? ' woven'
                    /* trap doors and spiked pits can't be player-made, and are
                       at least as much "set" as "dug" anyway */
                    : (tt === HOLE || tt === PIT) ? ' dug' : ' set'}`
                + `${!trap.madeby_u ? '' : ' by you'}.`);
            return 0;
        }
    await update_topl("I can't see a trap there.");
    return 0;
}
/* trap.h is_hole(ttyp) */
function pg_is_hole(tt) { return tt === HOLE || tt === (HOLE + 1) /* TRAPDOOR */; }

// C ref: pager.c:2420 whatdoes_help() — the dat/keyhelp text window shown when
// dowhatdoes() is asked about '&' or '?'.  dat/keyhelp is not transcribed into
// js/pager_data.js yet, so KEYHELP is empty, which is C's dlb_fopen() failure.
export async function whatdoes_help() {
    if (!KEYHELP.length) {
        await update_topl('Cannot open "keyhelp" data file!');
        return;
    }
    const win = create_nhwindow_text();
    for (const raw of KEYHELP) {
        if (raw[0] === '#') continue;
        putstr(win, 0, raw.replace(/^[ \t]+/, ''));
    }
    await display_nhwindow_text(win, true);
}

// C ref: pager.c:2457 whatdoes_cond(buf, stack, depth, lnum) — the
// if/elif/else/endif interpreter for dat/cmdhelp conditionals.  C compiles this
// out (`#if 0` around the whole block, including WD_STACKLIMIT and struct
// wd_stack_frame), because dowhatdoes_core() now answers from
// key2extcmddesc() instead of the data file; it is translated here so that
// re-enabling the data-file path is a one-line change.
//
// `buf` is a box; `stack` is an array of { active, been_true, else_seen };
// `depth` is a box `{ v }`.  Returns whether the current frame is active.
export function whatdoes_cond(buf, stack, depth, lnum) {
    const WD_STACKLIMIT = 5;
    const badstackfmt = (c, n) => `cmdhlp: too many &${c} directives at line ${n}.`;
    const act = buf.s[1];
    let newcond = (act === '?' || !stack[depth.v].been_true);
    let s = buf.s.slice(2).replace(/\s+/g, ' ').replace(/^ | $/g, '');
    let neg = false, gotopt, valpart = null;

    if (act === '#' || s[0] === '#' || !s || !newcond) {
        gotopt = !!(s && s[0] !== '#');
        s = '';
    } else {
        gotopt = true;
        if ((neg = (s[0] === '!'))) {
            s = s.slice(1);
            if (s[0] === ' ') s = s.slice(1);
        }
        let p = s.indexOf('='), q = s.indexOf(':');
        if (p < 0 || (q >= 0 && q < p)) p = q;
        if (p >= 0) {                               /* a value is specified */
            let kw = s.slice(0, p);
            if (kw.endsWith(' ')) kw = kw.slice(0, -1);
            valpart = s.slice(p + 1);
            if (valpart[0] === ' ') valpart = valpart.slice(1);
            s = kw;
        }
    }
    if (s && (act === '?' || act === ':')) {
        const iflags = pg_iflags();
        if (s.toLowerCase() === 'number_pad') {
            if (valpart == null) {
                newcond = !!iflags.num_pad;
            } else {
                /* convert internal encoding (separate yes/no and 0..3) back to
                   the user-visible one (-1..4) */
                const np = iflags.num_pad ? (1 + (iflags.num_pad_mode | 0))
                                          : (-1 * (iflags.num_pad_mode | 0));
                newcond = valpart.split(',').some((v) => parseInt(v, 10) === np);
            }
        } else if (s.toLowerCase() === 'rest_on_space') {
            newcond = !!game.flags?.rest_on_space;
        } else if (s.toLowerCase() === 'debug' || s.toLowerCase() === 'wizard') {
            newcond = !!game.flags?.debug;          /* == wizard */
        } else if (s.toLowerCase() === 'shell') {
            newcond = true;                         /* #ifdef SHELL */
        } else if (s.toLowerCase() === 'suspend') {
            newcond = true;                         /* #ifdef SUSPEND */
        } else {
            pg_impossible(`cmdhelp: unrecognized &${act} conditional at line `
                          + `${lnum}: "${s.slice(0, 20)}"`);
            neg = false;
        }
        /* works for number_pad too: `&? !number_pad:-1,0` is true for 1..4 */
        if (neg) newcond = !newcond;
    }
    switch (act) {
    default:
    case '#':                                       /* comment */
        break;
    case '.':                                       /* endif */
        if (--depth.v < 0) { pg_impossible(badstackfmt('.', lnum)); depth.v = 0; }
        break;
    case ':':                                       /* else or elif */
        if (depth.v === 0 || stack[depth.v].else_seen) {
            pg_impossible(badstackfmt(':', lnum));
            depth.v = 1;   /* so that stack[depth-1] is a valid access */
        }
        if (stack[depth.v].active || stack[depth.v].been_true
            || !stack[depth.v - 1].active)
            stack[depth.v].active = 0;
        else if (newcond)
            stack[depth.v].active = stack[depth.v].been_true = 1;
        if (!gotopt) stack[depth.v].else_seen = 1;
        break;
    case '?':                                       /* if */
        if (++depth.v >= WD_STACKLIMIT) {
            pg_impossible(badstackfmt('?', lnum));
            depth.v = WD_STACKLIMIT - 1;
        }
        stack[depth.v] = stack[depth.v] || {};
        stack[depth.v].active = (newcond && stack[depth.v - 1].active) ? 1 : 0;
        stack[depth.v].been_true = stack[depth.v].active;
        stack[depth.v].else_seen = 0;
        break;
    }
    return !!stack[depth.v].active;
}

// C ref: pager.c:2778 dispfile_debughelp() — display_file(DEBUGHELP, TRUE), the
// "List of wizard-mode commands." help topic (shown only in debug mode).
// dat/wizhelp is not transcribed into js/pager_data.js yet.
export async function dispfile_debughelp() {
    if (!DEBUGHELP.length) {
        await update_topl('Cannot open data file!');
        return;
    }
    await display_file(DEBUGHELP);
}

// C ref: pager.c:2796 hmenu_dohistory() — `(void) dohistory()`.
export async function hmenu_dohistory() { await display_file(HISTORY); }

// C ref: pager.c:2808 hmenu_dowhatdoes() — `(void) dowhatdoes()`.
export async function hmenu_dowhatdoes() { await dowhatdoes(); }

// C ref: pager.c:2814 hmenu_doextlist() — `(void) doextlist()`, the "#" list.
export async function hmenu_doextlist() { await doextlist(); }

// C ref: pager.c:2905 setopt_cmd(outbuf) — format the key or extended-command
// name of the command used to set options for the "Using the %s command to set
// options." help line.  Normally 'O', but 'O' is #options (doset_simple) and
// the full options command is #optionsfull (doset) with no key, so the result
// is usually "'#optionsfull' or 'm O'".
export function setopt_cmd() {
    let out = "'";
    // C tests `if (key)` on a char, so cmd_from_func()'s no-key answer ('\0')
    // is FALSE there; in JS that same one-char string is truthy.
    const bound = (k) => !!k && k !== '\0';
    let key = cmd_from_func('doset');               /* #optionsfull */
    if (bound(key)) {
        out += visctrl(keycode_of(key));
    } else {
        let cmdnm = 'optionsfull';
        out += `#${cmdnm.slice(0, 31)}`;

        /* no key is bound to #optionsfull, so include 'm O' */
        out += "' or '";
        key = cmd_from_func('do_reqmenu');          /* the 'm' prefix */
        if (bound(key)) out += visctrl(keycode_of(key));
        else out += `#${'reqmenu'.slice(0, 31)}`;
        // slightly iffy (C says so too): the user shouldn't type <space>, but
        // it improves readability
        out += ' ';
        key = cmd_from_func('doset_simple');        /* #options, normally 'O' */
        if (bound(key)) out += visctrl(keycode_of(key));
        else out += `#${'options'.slice(0, 31)}`;
    }
    out += "'";
    return out;
}
function keycode_of(k) {
    return (typeof k === 'string') ? k.charCodeAt(0) : (k | 0);
}
