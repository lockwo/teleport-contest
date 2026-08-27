// extcmd-handlers.js — Extended commands (#-commands).
//
// C ref: cmd.c doextcmd()/extcmdlist[]/extcmds_match(), win/tty/getline.c
// tty_get_ext_cmd()/hooked_tty_getlin(), win/tty/topl.c tty_yn_function().
//
// Implements the '#' extended-command entry: the "#" prompt, command-line
// completion echo (autocomplete), and a faithful subset of the individual
// extended commands the recorded sessions exercise (#jump, #twoweapon,
// #levelchange, #pray, #enhance, #chat, #sit).

import { game } from './gstate.js';
import { nhgetch } from './input.js';
import { pline, topl_more, update_topl, y_n, flush_screen, m_at, vobj_at, render_map_to_grid, statusLine1Text, statusLine2Text } from './display.js';
import { NO_COLOR, ATR_INVERSE } from './terminal.js';
import {
    obj_doname, sortloot, SORTLOOT_LOOT, SORTLOOT_INVLET, SORTLOOT_PACK, mergable,
    name_inventory_object, call_inventory_object, doorganize,
    addinv, prinv, prinv_fmt, let_to_name, report_merge_discovery,
    wiz_identify, renderWindowScreen, renderMenuLines, useup, xname,
} from './invent.js';
import { pluslvl, losexp } from './exper.js';
import { MAXULEV, IS_WALL, SDOOR, MM_NOEXCLAM, BOLT_LIM, STRAT_WAITMASK,
         IS_FOUNTAIN, IS_SINK, IS_THRONE, IS_ALTAR, COLNO, ROWNO,
         QBUFSZ } from './const.js';
import { create_particular_monster } from './makemon.js';
import { mon_mr } from './monmr_data.js';
import { is_undead_flag, is_demon_flag, humanoid } from './monflags_data.js';
import { couldsee, Blind } from './vision.js';
import { align_gname } from './role.js';
import { newsym, map_invisible } from './display.js';
import { STATUE, objects, place_object, weight, COIN_CLASS } from './mkobj.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
import { delobj, stackobj } from './invent.js';
import { count_unpaid, is_worn, wearing_armor, inventoryArray, takeoff_worn_obj,
         dismiss_invent_screen } from './invent.js';
import { exercise } from './attrib.js';
import { livelog_printf, LL_WISH, LL_CONDUCT } from './livelog.js';
import { rn2 } from './rng.js';
import { A_STR, A_WIS, A_DEX, POLY_CONTROLLED } from './const.js';
import { getpos, get_valid_jump_position, is_valid_jump_pos, getpos_render, jump_landing, jump_hilite_first_cursor } from './hack.js';
import { dotwoweapon } from './wield.js';
import { doride } from './steed.js';
import { doenhance } from './enhance.js';
import { dorub, dowipe, ECMD as APPLY_ECMD } from './apply.js';
import { readobjnam } from './readobjnam.js';
import { hold_another_object, encumber_msg, objects_at, otense } from './invent.js';
import { rn1 } from './rng.js';
import { dopray as pray_dopray, dosacrifice } from './pray.js';
import { dosit } from './sit.js';
import { dodip } from './potion.js';
import { dogenocided, do_gamelog, doconduct, dovanquished } from './insight.js';
import { isok } from './hacklib.js';
import { Monnam, canspotmon, x_monnam, mon_nam, oc_wldam } from './uhitm.js';
import { domonnoise } from './sounds.js';
import { build_overview_lines, surface, print_dungeon_lines } from './dungeon.js';
import { doextversion } from './version.js';
import { name_to_pmidx, monster_by_pmidx } from './makemon.js';
import { polyok_flag } from './monflags_data.js';
import { polymon, newman, domonability, PM_HUMAN } from './polyself.js';
import { obj_resists } from './zap.js';
import { timed_prop } from './timeout.js';

// ── extcmd flag bits (only the ones we filter on) ──
// C ref: hack.h AUTOCOMPLETE / WIZMODECMD / CMD_NOT_AVAILABLE / INTERNALCMD.
const AUTOCOMPLETE = 0x1;
const WIZMODECMD = 0x2;
const CMD_NOT_AVAILABLE = 0x4;
const INTERNALCMD = 0x8;

// extcmds_match flag args (C: ECM_* in hack.h)
const ECM_NOFLAGS = 0;
const ECM_IGNOREAC = 0x1;   // ignore the AUTOCOMPLETE requirement
const ECM_EXACTMATCH = 0x2; // require exact (full) name match

// The extended-command table.  C ref: cmd.c extcmdlist[].  Each entry is
// [ef_txt, flagbits, ef_desc].  We retain only the flag bits relevant to
// matching (AUTOCOMPLETE / WIZMODECMD / CMD_NOT_AVAILABLE / INTERNALCMD); the
// rest don't affect which entries match a typed prefix.  Ordering mirrors C so
// matchlist indexes are stable.  ef_desc is what extcmd_via_menu() shows (null
// for the INTERNALCMD entries, which C also leaves NULL).
// The recorder build defines DEBUG (its binary carries "bury objs under and
// around you"), so the #ifdef DEBUG / NH_DEVEL_STATUS entries are all present.
const EXTCMDLIST = [
    ["#", 0, "enter and perform an extended command"],
    ["?", AUTOCOMPLETE, "list all extended commands"],
    ["adjust", AUTOCOMPLETE, "adjust inventory letters"],
    ["annotate", AUTOCOMPLETE, "name current level"],
    ["apply", 0, "apply (use) a tool (pick-axe, key, lamp...)"],
    ["attributes", 0, "show your attributes"],
    ["autopickup", 0, "toggle the 'autopickup' option on/off"],
    ["bugreport", 0, "file a bug report"],
    ["call", 0, "name a monster, specific object, or type of object"],
    ["cast", 0, "zap (cast) a spell"],
    ["chat", AUTOCOMPLETE, "talk to someone"],
    ["chronicle", AUTOCOMPLETE, "show journal of major events"],
    ["close", 0, "close a door"],
    ["conduct", AUTOCOMPLETE, "list voluntary challenges you have maintained"],
    ["debugfuzzer", WIZMODECMD, "start the fuzz tester"],
    ["dip", AUTOCOMPLETE, "dip an object into something"],
    ["down", 0, "go down a staircase"],
    ["drop", 0, "drop an item"],
    ["droptype", 0, "drop specific item types"],
    ["eat", 0, "eat something"],
    ["engrave", 0, "engrave writing on the floor"],
    ["enhance", AUTOCOMPLETE, "advance or check weapon and spell skills"],
    ["exploremode", 0, "enter explore (discovery) mode"],
    ["fight", 0, "prefix: force fight even if you don't see a monster"],
    ["fire", 0, "fire ammunition from quiver"],
    ["force", AUTOCOMPLETE, "force a lock"],
    ["genocided", AUTOCOMPLETE, "list monsters that have been genocided or become extinct"],
    ["glance", 0, "show what type of thing a map symbol corresponds to"],
    ["help", 0, "give a help message"],
    ["herecmdmenu", AUTOCOMPLETE, "show menu of commands you can do here"],
    ["history", AUTOCOMPLETE, "show a summary of the game's development"],
    ["inventory", 0, "show your inventory"],
    ["inventtype", 0, "show inventory of one specific item class"],
    ["invoke", AUTOCOMPLETE, "invoke an object's special powers"],
    ["jump", AUTOCOMPLETE, "jump to another location"],
    ["kick", 0, "kick something"],
    ["known", 0, "show what object types have been discovered"],
    ["knownclass", 0, "show discovered types for one class of objects"],
    ["levelchange", AUTOCOMPLETE | WIZMODECMD, "change experience level"],
    ["lightsources", AUTOCOMPLETE | WIZMODECMD, "show mobile light sources"],
    ["look", 0, "look at what is here"],
    ["lookaround", 0, "describe what you can see"],
    ["loot", AUTOCOMPLETE, "loot a box on the floor"],
    ["migratemons", AUTOCOMPLETE | WIZMODECMD, "show migrating monsters and migrate N random ones"],
    ["monster", AUTOCOMPLETE, "use monster's special ability"],
    ["name", AUTOCOMPLETE, "same as call; name a monster or object or object type"],
    ["offer", AUTOCOMPLETE, "offer a sacrifice to the gods"],
    ["open", 0, "open a door"],
    ["options", 0, "show option settings"],
    ["optionsfull", 0, "show all option settings, possibly change them"],
    ["overview", AUTOCOMPLETE, "show a summary of the explored dungeon"],
    ["panic", AUTOCOMPLETE | WIZMODECMD, "test panic routine (fatal to game)"],
    ["pay", 0, "pay your shopping bill"],
    ["perminv", 0, "scroll persistent inventory display"],
    ["pickup", 0, "pick up things at the current location"],
    ["polyself", AUTOCOMPLETE | WIZMODECMD, "polymorph self"],
    ["pray", AUTOCOMPLETE, "pray to the gods for help"],
    ["prevmsg", 0, "view recent game messages"],
    ["puton", 0, "put on an accessory (ring, amulet, etc)"],
    ["quaff", 0, "quaff (drink) something"],
    ["quit", AUTOCOMPLETE, "exit without saving current game"],
    ["quiver", 0, "select ammunition for quiver"],
    ["read", 0, "read a scroll or spellbook"],
    ["redraw", 0, "redraw screen"],
    ["remove", 0, "remove an accessory (ring, amulet, etc)"],
    ["repeat", 0, "repeat a previous command"],
    ["reqmenu", 0, "prefix: request menu or modify command"],
    ["retravel", 0, "travel to previously selected travel location"],
    ["ride", AUTOCOMPLETE, "mount or dismount a saddled steed"],
    ["rub", AUTOCOMPLETE, "rub a lamp or a stone"],
    ["run", 0, "prefix: run until something interesting is seen"],
    ["rush", 0, "prefix: rush until something interesting is seen"],
    ["save", 0, "save the game and exit"],
    ["saveoptions", 0, "save the game configuration"],
    ["search", 0, "search for traps and secret doors"],
    ["seeall", 0, "show all equipment in use"],
    ["seeamulet", 0, "show the amulet currently worn"],
    ["seearmor", 0, "show the armor currently worn"],
    ["seerings", 0, "show the ring(s) currently worn"],
    ["seetools", 0, "show the tools currently in use"],
    ["seeweapon", 0, "show the weapon currently wielded"],
    ["shell", CMD_NOT_AVAILABLE, "leave game to enter a sub-shell ('exit' to come back)"],
    ["showgold", 0, "show gold, possibly shop credit or debt"],
    ["showspells", 0, "list and reorder known spells"],
    ["showtrap", 0, "describe an adjacent, discovered trap"],
    ["sit", AUTOCOMPLETE, "sit down"],
    ["stats", AUTOCOMPLETE | WIZMODECMD, "show memory statistics"],
    ["suspend", CMD_NOT_AVAILABLE, "push game to background ('fg' to come back)"],
    ["swap", 0, "swap wielded and secondary weapons"],
    ["takeoff", 0, "take off one piece of armor"],
    ["takeoffall", 0, "remove all armor"],
    ["teleport", 0, "teleport around the level"],
    ["terrain", AUTOCOMPLETE, "view map without monsters or objects obstructing it"],
    ["therecmdmenu", AUTOCOMPLETE, "menu of commands you can do from here to adjacent spot"],
    ["throw", 0, "throw something"],
    ["timeout", AUTOCOMPLETE | WIZMODECMD, "look at timeout queue and hero's timed intrinsics"],
    ["tip", AUTOCOMPLETE, "empty a container"],
    ["toggle", 0, "toggle boolean option"],
    ["travel", 0, "travel to a specific location on the map"],
    ["turn", AUTOCOMPLETE, "turn undead away"],
    ["twoweapon", 0, "toggle two-weapon combat"],
    ["untrap", AUTOCOMPLETE, "untrap something"],
    ["up", 0, "go up a staircase"],
    ["vanquished", AUTOCOMPLETE, "list vanquished monsters"],
    ["version", AUTOCOMPLETE, "list compile time options for this version of NetHack"],
    ["versionshort", 0, "show version and date+time program was built"],
    ["vision", AUTOCOMPLETE | WIZMODECMD, "show vision array"],
    ["wait", 0, "rest one move while doing nothing"],
    ["wear", 0, "wear a piece of armor"],
    ["whatdoes", 0, "tell what a command does"],
    ["whatis", 0, "show what type of thing a symbol corresponds to"],
    ["wield", 0, "wield (put in use) a weapon"],
    ["wipe", AUTOCOMPLETE, "wipe off your face"],
    ["wizborn", WIZMODECMD, "show stats of monsters created"],
    ["wizbury", AUTOCOMPLETE | WIZMODECMD, "bury objs under and around you"],
    ["wizcast", WIZMODECMD, "cast any spell"],
    ["wizcustom", WIZMODECMD, "show customized glyphs"],
    ["wizdetect", WIZMODECMD, "reveal hidden things within a small radius"],
    ["wizdispmacros", AUTOCOMPLETE | WIZMODECMD, "validate the display macro ranges"],
    ["wizfliplevel", WIZMODECMD, "flip the level"],
    ["wizgenesis", WIZMODECMD, "create a monster"],
    ["wizidentify", WIZMODECMD, "identify all items in inventory"],
    ["wizintrinsic", AUTOCOMPLETE | WIZMODECMD, "set an intrinsic"],
    ["wizkill", AUTOCOMPLETE | WIZMODECMD, "slay a monster"],
    ["wizlevelport", WIZMODECMD, "teleport to another level"],
    ["wizloaddes", WIZMODECMD, "load and execute a des-file lua script"],
    ["wizloadlua", WIZMODECMD, "load and execute a lua script"],
    ["wizobjprobs", WIZMODECMD, "list object generation probabilities"],
    ["wizmakemap", WIZMODECMD, "recreate the current level"],
    ["wizmap", WIZMODECMD, "map the level"],
    ["wizmondiff", AUTOCOMPLETE | WIZMODECMD, "validate the difficulty ratings of monsters"],
    ["wizrumorcheck", AUTOCOMPLETE | WIZMODECMD, "verify rumor boundaries"],
    ["wizseenv", AUTOCOMPLETE | WIZMODECMD, "show map locations' seen vectors"],
    ["wizshownhuuid", AUTOCOMPLETE | WIZMODECMD, "show NHUUID for this game"],
    ["wizsmell", AUTOCOMPLETE | WIZMODECMD, "smell monster"],
    ["wiztelekinesis", AUTOCOMPLETE | WIZMODECMD, "telekinesis"],
    ["wizwhere", AUTOCOMPLETE | WIZMODECMD, "show locations of special levels"],
    ["wizwish", WIZMODECMD, "wish for something"],
    ["wmode", AUTOCOMPLETE | WIZMODECMD, "show wall modes"],
    ["zap", 0, "zap a wand"],
    ["movewest", 0, "move west (screen left)"],
    ["movenorthwest", 0, "move northwest (screen upper left)"],
    ["movenorth", 0, "move north (screen up)"],
    ["movenortheast", 0, "move northeast (screen upper right)"],
    ["moveeast", 0, "move east (screen right)"],
    ["movesoutheast", 0, "move southeast (screen lower right)"],
    ["movesouth", 0, "move south (screen down)"],
    ["movesouthwest", 0, "move southwest (screen lower left)"],
    ["rushwest", 0, "rush west (screen left)"],
    ["rushnorthwest", 0, "rush northwest (screen upper left)"],
    ["rushnorth", 0, "rush north (screen up)"],
    ["rushnortheast", 0, "rush northeast (screen upper right)"],
    ["rusheast", 0, "rush east (screen right)"],
    ["rushsoutheast", 0, "rush southeast (screen lower right)"],
    ["rushsouth", 0, "rush south (screen down)"],
    ["rushsouthwest", 0, "rush southwest (screen lower left)"],
    ["runwest", 0, "run west (screen left)"],
    ["runnorthwest", 0, "run northwest (screen upper left)"],
    ["runnorth", 0, "run north (screen up)"],
    ["runnortheast", 0, "run northeast (screen upper right)"],
    ["runeast", 0, "run east (screen right)"],
    ["runsoutheast", 0, "run southeast (screen lower right)"],
    ["runsouth", 0, "run south (screen down)"],
    ["runsouthwest", 0, "run southwest (screen lower left)"],
    ["clicklook", INTERNALCMD, null],
    ["mouseaction", INTERNALCMD, null],
    ["altadjust", INTERNALCMD, null],
    ["altdip", INTERNALCMD, null],
    ["alttakeoff", INTERNALCMD, null],
    ["altunwield", INTERNALCMD, null],
];

function isWizard() { return !!game.flags?.debug; }

// C ref: cmd.c extcmds_match().  Returns the list of matching extcmdlist
// indexes for `findstr` under the given flags.
function extcmds_match(findstr, ecmflags) {
    const ignoreac = (ecmflags & ECM_IGNOREAC) !== 0;
    const exactmatch = (ecmflags & ECM_EXACTMATCH) !== 0;
    const fslen = findstr ? findstr.length : 0;
    const out = [];
    for (let i = 0; i < EXTCMDLIST.length; i++) {
        const [txt, flags] = EXTCMDLIST[i];
        if (flags & (CMD_NOT_AVAILABLE | INTERNALCMD)) continue;
        if (!isWizard() && (flags & WIZMODECMD)) continue;
        if (!ignoreac && !(flags & AUTOCOMPLETE)) continue;
        if (findstr == null) {
            out.push(i);
        } else if (exactmatch) {
            if (findstr.toLowerCase() === txt.toLowerCase()) out.push(i);
        } else {
            if (txt.slice(0, fslen).toLowerCase() === findstr.toLowerCase()) out.push(i);
        }
    }
    return out;
}

// C ref: win/tty/getline.c ext_cmd_getlin_hook() — if the typed prefix
// uniquely identifies an AUTOCOMPLETE command, expand it to the full name.
// Returns the expanded string, or null when there is no unique expansion.
function ext_cmd_getlin_hook(base) {
    const matches = extcmds_match(base, ECM_NOFLAGS);
    if (matches.length === 1)
        return EXTCMDLIST[matches[0]][0];
    return null;
}

// mungspaces: collapse runs of whitespace and trim.  C ref: hacklib.c.
function mungspaces(s) {
    return s.replace(/\s+/g, ' ').replace(/^ | $/g, '');
}

// Render the top-line getline prompt: clear row 0, draw "<query> <buf>",
// place the cursor right after the typed text (the autocompleted tail is
// drawn but the cursor is parked at the end of what was actually typed).
// C ref: win/tty/getline.c hooked_tty_getlin() display behavior.
// C ref: win/tty/topl.c topl_putsym() — `if (ttyDisplay->curx == CO - 1)
// topl_putsym('\n')`, i.e. a top-line row holds cols 0..CO-2 (79 chars) and the
// next character starts the following screen row at col 0, overwriting the map.
// This is a HARD wrap; display.js wrap_topl() is the word wrap for update_topl
// and must not be reused here.  A getlin whose query + buffer stays under 79
// chars (every ordinary one) is unaffected.
const TOPL_CO = 80;
const TOPL_WRAP = TOPL_CO - 1;
function draw_getlin(query, shown, cursorCol) {
    const disp = game?.nhDisplay;
    if (!disp?.setCell) return;
    const line = query + ' ' + shown;
    const rows = Math.max(1, Math.ceil(line.length / TOPL_WRAP));
    // C ref: tty_clear_nhwindow(NHW_MESSAGE) -> docorner(1, cury+1, 0) blanks
    // the rows the previous (longer) top line spilled onto.
    const clearRows = Math.max(rows, game._getlin_rows || 1);
    for (let r = 0; r < clearRows && r < disp.rows; r++)
        for (let c = 0; c < disp.cols; c++) disp.setCell(c, r, ' ', NO_COLOR, 0);
    for (let i = 0; i < line.length; i++) {
        const r = Math.floor(i / TOPL_WRAP);
        if (r >= disp.rows) break;
        disp.setCell(i % TOPL_WRAP, r, line[i], NO_COLOR, 0);
    }
    game._getlin_rows = rows;
    // The newline is emitted lazily (only when the NEXT char would land on
    // col CO-1), so a cursor sitting exactly at col CO-1 stays on its row.
    const cr = cursorCol === 0 ? 0 : Math.floor((cursorCol - 1) / TOPL_WRAP);
    const cc = cursorCol - cr * TOPL_WRAP;
    disp.setCursor(Math.min(cc, disp.cols - 1), Math.min(cr, disp.rows - 1));
}

// C ref: win/tty/getline.c hooked_tty_getlin().  Reads a line at the top
// line, with optional completion hook.  Each keystroke is its own captured
// screen frame (the nhgetch fires the capture hook for the freshly drawn
// prompt state).  Returns the typed string, or "\x1b" if escaped out of an
// empty buffer.
export async function hooked_tty_getlin(query, hook) {
    // C ref: win/tty/getline.c hooked_tty_getlin():53-54 — if a top-line message
    // is still awaiting acknowledgment (toplin == NEED_MORE), page it with
    // --More-- (its own captured frame) before drawing the getlin prompt.  This
    // fires for e.g. a confused scroll's "Being confused, ..." line preceding the
    // level-teleport prompt; ordinary command-initiated getlins start with a
    // cleared top line, so it is a no-op for them.
    if (game._toplin === 1) {
        await topl_more();
        game._pending_message = '';
        game._toplin = 0;
    }

    let typed = '';   // what the user actually typed (obufp/bufp content)
    let shown = '';   // what is displayed (typed, possibly autocompleted)
    const base = (query + ' ').length; // column of first input char

    for (;;) {
        // Cursor sits one past the typed characters.
        draw_getlin(query, shown, base + typed.length);
        const code = await nhgetch();

        if (code === 27) { // ESC
            if (typed.length > 0) {
                // Clear current contents and keep prompting from the start.
                typed = '';
                shown = '';
                continue;
            }
            return '\x1b';
        }
        if (code === 13 || code === 10) { // newline: done
            // C ref: ext_cmd_getlin_hook() writes the unique completion into the
            // buffer (obufp), so Return returns the completed command name, not
            // just what was typed (e.g. "l" -> "loot").  `shown` already holds
            // that completion (or the raw typed text when none applies).
            return shown;
        }
        if (code === 8 || code === 127) { // backspace / delete-prev
            if (typed.length > 0) {
                typed = typed.slice(0, -1);
                const expanded = hook ? hook(typed) : null;
                shown = expanded != null ? expanded : typed;
            }
            continue;
        }
        // C ref: getline.c:168 `bufp - obufp < BUFSZ - 1 && bufp - obufp < COLNO`
        // — the cap is COLNO (80) typed characters, not 79; the 80th character
        // is what pushes the echo onto a second screen row.
        if (code >= 32 && code !== 0x7f && typed.length < TOPL_CO) {
            typed += String.fromCharCode(code);
            const expanded = hook ? hook(typed) : null;
            shown = expanded != null ? expanded : typed;
        }
        // any other key: ignore (tty bell), reloop and redraw.
    }
}

// ── OPTIONS=extmenu — the '#' extended-command MENU ────────────────────────
// C ref: cmd.c extcmd_via_menu(), reached from win/tty/getline.c
// tty_get_ext_cmd() when iflags.extmenu is set: '#' shows a PICK_ONE menu of
// the AUTOCOMPLETE commands instead of the type-in prompt.  Each pick appends
// its accelerator to cbuf and the list is re-filtered on that longer prefix
// until exactly one command is left; that one is the selection.

// C ref: win/tty/wintty.c default_menu_cmds[] (wintype.h MENU_*).  These are
// accepted alongside the current page's selector letters, the digits and the
// quitchars.  gm.mapped_menu_cmds is empty unless a menu_* option rebinds one,
// which makes map_menu_cmd() the identity, so it is not modelled.
const MENU_FIRST_PAGE = '^', MENU_LAST_PAGE = '|';
const MENU_NEXT_PAGE = '>', MENU_PREVIOUS_PAGE = '<';
const MENU_SEARCH = ':';
const DEFAULT_MENU_CMDS = MENU_FIRST_PAGE + MENU_LAST_PAGE + MENU_NEXT_PAGE
    + MENU_PREVIOUS_PAGE + '.' + '-' + '@' + ',' + '\\' + '~' + MENU_SEARCH;

// C ref: strutil.c pmatch_internal(..., ci=TRUE) — '*' matches zero or more
// characters, '?' matches exactly one.
export function pmatchi(patrn, strng) {
    if (!patrn.length) return !strng.length;
    const p = patrn[0];
    if (p === '*')
        return patrn.length === 1
            || pmatchi(patrn.slice(1), strng)
            || (strng.length > 0 && pmatchi(patrn, strng.slice(1)));
    if (!strng.length) return false;
    if (p !== '?' && p.toLowerCase() !== strng[0].toLowerCase()) return false;
    return pmatchi(patrn.slice(1), strng.slice(1));
}

// C ref: win/tty/wintty.c tty_end_menu() — the prompt is PREPENDED as two
// entries (a blank, then the prompt itself, which lands first), pages hold
// min(52, rows-1) entries, an entry needing the last screen column is cut to
// cols-2, and cw->cols is the widest entry + 2 but never below the morestr.
// Then tty_display_nhwindow(NHW_MENU): a menu whose maxrow reaches the screen
// height takes the whole screen, anything shorter floats as an overlay.
function extcmd_end_menu(items, promptStr) {
    const rows = game.nhDisplay?.rows ?? 24;
    const cols = game.nhDisplay?.cols ?? 80;
    // tty_menu_promptstyle is iflags.menu_headings (allmain.c:728), whose
    // default is no-color&inverse.
    const flat = [
        { text: promptStr, attr: ATR_INVERSE },
        { text: '' },
        ...items.map((it) => ({ text: (it.sel ? it.sel + ' - ' : '') + it.text,
                                sel: it.sel })),
    ];
    const lmax = Math.min(52, rows - 1);
    const npages = Math.ceil(flat.length / lmax);
    let maxcol = 0;
    for (const ln of flat) {
        if (ln.text.length + 2 > cols) ln.text = ln.text.slice(0, cols - 2);
        if (ln.text.length + 2 > maxcol) maxcol = ln.text.length + 2;
    }
    // C measures the paging morestr from its widest "(M of M) " form.
    const morelen = npages > 1 ? `(${npages} of ${npages}) `.length : 6;
    if (morelen > maxcol) maxcol = morelen;
    const maxrow = npages > 1 ? lmax + 1 : flat.length + 1;
    const pages = [];
    for (let i = 0; i < flat.length; i += lmax) pages.push(flat.slice(i, i + lmax));
    return { flat, pages, npages, maxrow, fullscreen: maxrow >= rows };
}

// C ref: win/tty/wintty.c process_menu_window() page paint + dmore().  The
// morestr sits on the row just past the page's last entry, indented one column,
// with the cursor parked immediately after it.
function render_extcmd_page(m, idx) {
    const page = m.pages[idx];
    if (m.fullscreen) {
        renderWindowScreen(page, {
            menu: true,
            footer: m.npages > 1 ? `(${idx + 1} of ${m.npages})` : '(end) ',
            footerRow: page.length,
            footerCol: 1,
            modal: 'extcmdwin',
        });
        return;
    }
    // Only a single-page menu can be an overlay (npages > 1 forces maxrow to
    // the screen height), so renderMenuLines' "(end)" footer is always right.
    renderMenuLines(page);
    game._modal_screen = 'extcmdwin';
}

// C ref: win/tty/getline.c xwaitforspace() — read until the key is listed in
// `s`; '\n'/'\r' break with morc still 0 and ESC forces morc = '\033'.  Any
// other key is a tty_nhbell() and another read, with no redraw in between (so
// each rejected key is captured showing the unchanged menu).
async function xwaitforspace(s) {
    for (;;) {
        const c = await nhgetch();
        if (c === 10 || c === 13) return '\0';
        if (c === 27) return '\x1b';
        const ch = String.fromCharCode(c);
        if (s.indexOf(ch) >= 0) return ch;
    }
}

// C ref: win/tty/wintty.c process_menu_window()/tty_select_menu() for one
// PICK_ONE round.  Returns the picked entry's accelerator, or null when the
// menu was cancelled or committed with nothing selected (C's n == -1 / n == 0,
// which extcmd_via_menu() handles identically).
async function extcmd_select_menu(m) {
    // tty_display_nhwindow(): an unacknowledged top line is --More--'d before
    // the menu paints over it.
    if (game._toplin === 1) {
        await topl_more();
        game._toplin = 0;
    }
    game._pending_message = '';
    let curr_page = 0, counting = false, count = 0, reset_count = true;
    for (;;) {
        if (reset_count) { counting = false; count = 0; } else reset_count = true;
        render_extcmd_page(m, curr_page);
        const page = m.pages[curr_page];
        const sels = page.filter((it) => it.sel).map((it) => it.sel).join('');
        const morc = await xwaitforspace(sels + ' 0123456789\x1b\n\r'
                                        + DEFAULT_MENU_CMDS);
        // An explicit menu choice is never re-read as a menu command; with no
        // menu_* rebinding map_menu_cmd() is the identity for everything else.
        if (sels.indexOf(morc) >= 0) return morc;
        if (morc >= '0' && morc <= '9') {
            count = count * 10 + (morc.charCodeAt(0) - 48);
            if (count !== 0) { counting = true; reset_count = false; }
            continue;
        }
        switch (morc) {
        case '\x1b':                            // cancel, or just stop a count
            if (!counting) return null;
            break;
        case '\0':                              // commit
            return null;
        case ' ':
        case MENU_NEXT_PAGE:
            if (curr_page !== m.npages - 1) curr_page++;
            else if (morc === ' ') return null; // ' ' finishes, '>' does not
            break;
        case MENU_PREVIOUS_PAGE:
            if (curr_page !== 0) curr_page--;
            break;
        case MENU_FIRST_PAGE:
            curr_page = 0;
            break;
        case MENU_LAST_PAGE:
            curr_page = m.npages - 1;
            break;
        case MENU_SEARCH: {
            const tmpbuf = await hooked_tty_getlin('Search for:', null);
            if (!tmpbuf || tmpbuf[0] === '\x1b') break;
            const searchbuf = '*' + tmpbuf + '*';
            // PICK_ONE finishes on the first hit, matched against the whole
            // rendered entry (accelerator prefix included), not just the page.
            for (const it of m.flat)
                if (it.sel && pmatchi(searchbuf, it.text)) return it.sel;
            break;
        }
        default:
            // MENU_SELECT_*/MENU_INVERT_* are PICK_ANY-only, and nothing is
            // ever selected here for MENU_UNSELECT_* to clear.
            break;
        }
    }
}

// C ref: cmd.c extcmd_via_menu().
async function extcmd_via_menu() {
    let ret = 0, cbuf = '', matchlevel = 0, biggest = 0;
    while (ret === 0) {
        const choices = [];
        for (let i = 0; i < EXTCMDLIST.length; i++) {
            const [txt, flags, desc] = EXTCMDLIST[i];
            if ((flags & (CMD_NOT_AVAILABLE | INTERNALCMD))
                || !(flags & AUTOCOMPLETE)
                || (!isWizard() && (flags & WIZMODECMD))) continue;
            if (!matchlevel
                || txt.slice(0, matchlevel) === cbuf.slice(0, matchlevel)) {
                choices.push(i);
                if (desc.length > biggest) biggest = desc.length;
            }
        }
        const nchoices = choices.length;
        // "if we're down to one, we have our selection"
        if (nchoices <= 1) { ret = nchoices === 1 ? choices[0] : -1; break; }

        // Group the choices by their matchlevel'th character: one line per
        // command while the list is short enough, otherwise one line per
        // accelerator holding "cmd or cmd or cmd" for that letter.
        const width = biggest + 15;             // C: fmtstr = "%-*s"
        const one_per_line = nchoices < ROWNO - 3;
        const items = [];
        let prompt = '', acount = 0, prevaccelerator = '', wastoolong = false;
        for (let i = 0; i < nchoices; i++) {
            const [txt, , desc] = EXTCMDLIST[choices[i]];
            const accelerator = matchlevel < txt.length ? txt[matchlevel] : '';
            if (accelerator !== prevaccelerator || one_per_line) wastoolong = false;
            if (accelerator !== prevaccelerator || one_per_line
                // +4: sizeof " or "; -6: 1 space margin + "%c - " + 1 margin
                || (acount >= 2
                    && prompt.length + 4 + txt.length
                       >= Math.min(QBUFSZ, COLNO - 6))) {
                if (acount) {
                    items.push({ sel: prevaccelerator, text: prompt.padEnd(width) });
                    acount = 0;
                    if (!(accelerator !== prevaccelerator || one_per_line))
                        wastoolong = true;
                }
            }
            prevaccelerator = accelerator;
            if (!acount || one_per_line)
                prompt = (wastoolong ? 'or ' : '') + txt + ' [' + desc + ']';
            else if (acount === 1)
                prompt = (wastoolong ? 'or ' : '')
                    + EXTCMDLIST[choices[i - 1]][0] + ' or ' + txt;
            else
                prompt = prompt + ' or ' + txt;
            ++acount;
        }
        if (acount) items.push({ sel: prevaccelerator, text: prompt.padEnd(width) });

        const m = extcmd_end_menu(items, 'Extended Command: ' + cbuf);
        const picked = await extcmd_select_menu(m);
        // destroy_nhwindow() -> erase_menu_or_text(): a full-screen menu
        // docrt()s the map back before the chosen command runs.
        await dismiss_invent_screen();
        if (picked == null) {
            // C leaves cbuf alone here, so a cancelled sub-menu returns to the
            // top level with its stale text still in the "Extended Command:"
            // prompt; only matchlevel is reset.
            if (matchlevel) { ret = 0; matchlevel = 0; } else ret = -1;
        } else if (matchlevel > QBUFSZ - 2) {
            ret = -1;
        } else {
            cbuf = cbuf.slice(0, matchlevel) + picked;
            matchlevel++;
        }
    }
    return ret;
}

// C ref: win/tty/getline.c tty_get_ext_cmd().  Read a full-word extended
// command name with completion, then resolve it to an extcmdlist index via
// an exact (autocomplete-ignoring) match.  Returns the index, or -1.
async function tty_get_ext_cmd() {
    if (game.flags?.extmenu)
        return await extcmd_via_menu();

    let buf = await hooked_tty_getlin('#', ext_cmd_getlin_hook);
    buf = mungspaces(buf);

    if (buf === '' || buf[0] === '\x1b') return -1;
    const matches = extcmds_match(buf, ECM_IGNOREAC | ECM_EXACTMATCH);
    if (matches.length !== 1) {
        await pline(`#${buf}: unknown extended command.`);
        return -1;
    }
    return matches[0];
}

// C ref: win/tty/topl.c tty_yn_function() — prompt "query [resp] (def) " on
// the top line and read a single allowed key.  `def` is returned for
// space/return; ESC maps to 'q' (if allowed) else 'n' (if allowed) else def.
export async function yn_function(query, resp, def) {
    // C ref: win/tty/topl.c tty_yn_function() clean_up:418 — the answered prompt
    // is LEFT on the top line (the addtopl(rtmp) echo is commented out upstream);
    // only gt.toplines' history copy is rewritten.  Routing through display.js
    // y_n() keeps it in game._pending_message so the next frame still shows it.
    if (resp != null) return await y_n(query, resp, def);
    let prompt = query;
    if (resp != null) {
        prompt += ` [${resp}]`;
        if (def) prompt += ` (${def})`;
        prompt += ' ';
    } else {
        prompt += ' ';
    }
    const disp = game?.nhDisplay;
    const drawPrompt = () => {
        if (!disp?.setCell) return;
        for (let c = 0; c < disp.cols; c++) {
            const ch = c < prompt.length ? prompt[c] : ' ';
            disp.setCell(c, 0, ch, NO_COLOR, 0);
        }
        disp.setCursor(Math.min(prompt.length, disp.cols - 1), 0);
    };
    // C ref: win/tty/topl.c — an answered y/n prompt is LEFT on the top line
    // (tty_yn_function only updates gt.toplines bookkeeping; the message window
    // is not cleared).  This wrote the prompt straight onto the grid, so the
    // next flush_screen() repainted row 0 from the (empty) pending message and
    // the answered prompt vanished a frame early.
    const done = (r) => { game._pending_message = prompt.trimEnd(); game._toplin = 0; return r; };
    for (;;) {
        drawPrompt();
        let q = await nhgetch();
        if (resp == null) return done(String.fromCharCode(q));
        let c = String.fromCharCode(q).toLowerCase();
        if (q === 27) { // ESC
            if (resp.includes('q')) return done('q');
            if (resp.includes('n')) return done('n');
            return done(def || '\0');
        }
        if (q === 32 || q === 13 || q === 10) return done(def || '\0');
        if (resp.includes(c)) return done(c);
        // otherwise: bell, reloop.
    }
}

// ── individual extended commands ──

// C ref: zap.c resist(mtmp, oclass, damage, tell) — the generic
// magic-resistance check.  `oclass` picks the attack level, the monster's m_lev
// is the defense level, and the single draw is
//     rn2(100 + alev - dlev) < mtmp->data->mr
// so a monster with mr 0 still costs a draw.  Ported here because #turn needs
// it; damage is always 0 for #turn so the damage/kill tail is a no-op.
function resist(mtmp, oclass, damage, tell) {
    let alev;
    switch (oclass) {
    case 'wand':   alev = 12; break;
    case 'tool':   alev = 10; break;   /* instrument */
    case 'weapon': alev = 10; break;   /* artifact */
    case 'scroll': alev = 9; break;
    case 'potion': alev = 6; break;
    case 'ring':   alev = 5; break;
    default:       alev = game.u?.ulevel ?? 1; break;   /* spell / '\0' */
    }
    let dlev = mtmp.m_lev | 0;
    if (dlev > 50) dlev = 50;
    else if (dlev < 1) dlev = 1;       /* is_mplayer would use u.ulevel */
    // permonst.mr — the magic-resistance PERCENTAGE from monsters.h's LVL(), NOT
    // makemon.js's MONS[].mresists, which is the MR_* bitmask (a wraith's
    // mresists is 166 while its mr is 15).
    const resisted = rn2(100 + alev - dlev) < mon_mr(mtmp.data);
    void damage; void tell;             /* #turn passes 0 / TELL only */
    return resisted;
}

// C ref: pray.c doturn() — the #turn command (Knights and Priests; other roles
// fall back to the turn-undead spell).  Was entirely unimplemented, so
// seed4500's `#turn` drew none of C's stream: the exercise(A_WIS, TRUE) rn2(19)
// at step 643, plus whatever the per-monster iteration costs, plus the
// nomul(-(5 - (ulevel-1)/6)) paralysis that makes the command span turns.
async function doturn() {
    const g = game, u = g.u;
    const roleMnum = g.urole?.mnum ?? -1;
    const PM_CLERIC_ROLE = 6, PM_KNIGHT_ROLE = 4;   // roles[] indices
    if (roleMnum !== PM_CLERIC_ROLE && roleMnum !== PM_KNIGHT_ROLE) {
        // C ref: pray.c doturn():1712 — 3.7 bases this on the spell being IN THE
        // SPELLBOOK (the scan stops at the first NO_SPELL slot), not on knowing
        // it well enough to cast; spelleffects() then applies the usual
        // retention/energy/skill checks.
        const sp = await import('./spell.js');
        const SPE_TURN_UNDEAD = 398;
        for (let i = 0; i < 25; i++) {
            const id = sp.spellid_at(i);
            if (id === 0) break;                       /* NO_SPELL */
            if (id === SPE_TURN_UNDEAD)
                return await sp.spelleffects_ext(SPE_TURN_UNDEAD);
        }
        await pline("You don't know how to turn undead!");
        return 0;
    }

    // halu_gname(): the hero's god, or a hallucinatory one.  align_gname reads
    // the role's deity names; no RNG while not hallucinating.
    const Gname = align_gname(g.urole?.mnum ?? 0, u?.ualign?.type ?? 0);

    // can_chant(): only a Strangled hero fails, which none of these do.
    // The demon/undead-self and ugangr > 6 "seems to ignore you" arms and the
    // Inhell arm all end the command early; Inhell is the reachable one.
    const { In_hell } = await import('./dungeon.js');
    if (In_hell(u?.uz)) {
        await update_topl(`Since you are in Gehennom, ${Gname} can't help you.`);
        // aggravate() wakes every monster on the level; no RNG.
        for (const m of g.level?.monsters || []) m.msleeping = 0;
        return 1;
    }

    await update_topl(`Calling upon ${Gname}, you chant an arcane formula.`);
    exercise(A_WIS, true);

    // turn_undead_range = (BOLT_LIM + ulevel/5) squared — 8..14 before squaring.
    let range = BOLT_LIM + Math.trunc((u?.ulevel ?? 1) / 5);
    range *= range;
    let msg_cnt = 0;
    const confused = (u?.uprops?.Confusion || 0) > 0;
    const MAXULEV_HALF = Math.trunc(MAXULEV / 2);

    // C ref: iter_mons(maybe_turn_mon_iter) — walks fmon in list order, so the
    // per-monster resist() draws happen in that order.
    for (const mtmp of [...(g.level?.monsters || [])]) {
        if (mtmp.mhp != null && mtmp.mhp <= 0) continue;
        // "used to use cansee() here but the purpose is to prevent #turn
        // operating through walls, not to require that the hero be able to see"
        if (!couldsee(mtmp.mx, mtmp.my)) continue;
        const dx = mtmp.mx - u.ux, dy = mtmp.my - u.uy;
        if (dx * dx + dy * dy > range) continue;
        const isUndead = is_undead_flag(mtmp.data);
        const isDemon = is_demon_flag(mtmp.data);
        if (mtmp.mpeaceful) continue;
        if (!(isUndead || (isDemon && (u.ulevel ?? 1) > MAXULEV_HALF))) continue;

        mtmp.msleeping = 0;
        if (confused) {
            if (!msg_cnt++) await update_topl('Unfortunately, your voice falters.');
            mtmp.mflee = 0; mtmp.mfrozen = 0; mtmp.mcanmove = 1;
        } else if (!resist(mtmp, '\0', 0, 1)) {
            // Class-keyed threshold: zombie 6, mummy 8, wraith 10, vampire 12,
            // ghost 14, lich 16 (C's cascading FALLTHROUGHs).
            const xlev = turn_xlev(mtmp.data?.mcls);
            if (xlev != null && (u.ulevel ?? 1) >= xlev
                && !resist(mtmp, '\0', 0, 0)) {
                if ((u.ualign?.type ?? 0) === -1 /* A_CHAOTIC */) {
                    mtmp.mpeaceful = 1;
                } else {
                    // C: killed(mtmp) — the hero destroys the undead outright.
                    const mon = await import('./mon.js');
                    const kill = mon.killed || mon.xkilled;
                    if (kill) await kill(mtmp);
                }
            } else {
                // monflee(mtmp, 0, FALSE, TRUE): untimed scare, no RNG.
                mtmp.mflee = 1; mtmp.mfleetim = 0;
            }
        }
    }

    // C ref: nomul(-(5 - ((u.ulevel - 1) / 6))) — -5 at level 1 up to -1 at 25+.
    const dur = -(5 - Math.trunc(((u?.ulevel ?? 1) - 1) / 6));
    if ((g.multi ?? 0) >= dur) g.multi = dur;
    g.multi_reason = 'trying to turn the monsters';
    g.nomovemsg = 'You can move again.';
    return 1;
}

// C ref: pray.c maybe_turn_mon_iter()'s switch — the minimum hero level needed
// to destroy (rather than merely scare) each undead class, built by C's
// cascading FALLTHROUGHs from S_ZOMBIE upward.  monsym.h class indices.
function turn_xlev(mcls) {
    switch (mcls) {
    case 38: return 16;  // S_LICH    (defsym.h MONSYM(38, 'L', ...))
    case 54: return 14;  // S_GHOST   (MONSYM(54, ' ', ...))
    case 48: return 12;  // S_VAMPIRE (MONSYM(48, 'V', ...))
    case 49: return 10;  // S_WRAITH  (MONSYM(49, 'W', ...))
    case 39: return 8;   // S_MUMMY   (MONSYM(39, 'M', ...))
    case 52: return 6;   // S_ZOMBIE  (MONSYM(52, 'Z', ...))
    default: return null; /* C's `default: monflee()` arm */
    }
}

// C ref: apply.c dojump()/jump().  For the recorded knight (innate Jumping)
// this reaches the "Where do you want to jump?" prompt and then enters
// getpos() targeting mode.  A picked target is validated with
// is_valid_jump_pos(showmsg=TRUE); on failure the failure message is shown
// and no time passes (ECMD_FAIL).  On a valid, non-self target the hero
// hurtles to the landing spot (teleds) and morehungry(rnd(25)) is rolled —
// the command then costs a turn (ECMD_TIME) so monsters move once.
// C ref: youprop.h `#define Jumping (HJumping || EJumping)`.  HJumping is set
// FROMOUTSIDE for knights at u_init.c:691; the only extrinsic source is
// objects[JUMPING_BOOTS].oc_oprop, and this port has no oc_oprop column, so the
// worn item stands in for it the way js/do_wear.js derives its extrinsics.
function Jumping() {
    const u = game.u;
    if (u?.uprops?.Jumping || u?.HJumping || u?.EJumping) return true;
    const PM_KNIGHT_ROLE = 4;                          // roles[] index
    if ((game.urole?.mnum ?? -1) === PM_KNIGHT_ROLE) return true;
    const JUMPING_BOOTS_OTYP = 168;                    // js/mkobj.js:137
    return game.uarmf?.otyp === JUMPING_BOOTS_OTYP;
}

async function dojump() {
    // C ref: apply.c jump():2001 `else if (!magic && !Jumping) {
    // You_cant("jump very far"); return ECMD_OK; }` — without innate or worn
    // jumping the command never reaches the targeting prompt.  (The two arms
    // ahead of it, the SPE_JUMPING recast and the nolimbs/slithy form check,
    // need known_spell()/polymorph state this port doesn't carry here.)
    if (!Jumping()) {
        await pline("You can't jump very far.");
        return 0;                                      // ECMD_OK
    }
    // C ref: apply.c jump():  pline("Where do you want to jump?"); cc = <u>;
    // getpos_sethilite(...); getpos(&cc, TRUE, "the desired position").
    // C places the cursor on the hero (curs WIN_MAP) and flush_screen()s with
    // the prompt before getpos()'s first readchar blocks.  There is NO --More--:
    // handle_tip(TIP_GETPOS) only fires a (no-op) Lua hook, it does not page.
    const u = game.u;
    await pline('Where do you want to jump?');
    // C ref: getpos() -> handle_tip(TIP_GETPOS) shows a tty NHW_TEXT window the
    // FIRST time getpos is used.  Displaying that window pages the pending
    // message window first, so the prompt is shown with a trailing --More--;
    // the tip text is then rendered by getpos_tip() inside getpos().  On every
    // later getpos use the tip is suppressed (no --More--, no tip text): the
    // cursor goes straight onto the map at the hero.  Mirror that gating with
    // the TIP_GETPOS flag (1 << 4) so only the first #jump pages the prompt.
    const TIP_GETPOS = 1 << 4;
    const tipPending = !((game.context?.tips || 0) & TIP_GETPOS);
    if (tipPending) {
        await topl_more();
    } else {
        await getpos_render('Where do you want to jump?', u.ux, u.uy);
        // C ref: getpos.c getpos() opening "curs(WIN_MAP,u.ux,u.uy);
        // flush_screen(0)".  jump()'s getpos_sethilite() marked every valid
        // jump position gnew (selection_force_newsyms -> newsym_force); the
        // opening flush redraws those cells and leaves the tty cursor one past
        // the last (row-major) one rather than on the hero.  Reproduce that
        // first-frame cursor placement (subsequent frames track <cx,cy>).
        const hc = jump_hilite_first_cursor();
        if (hc) { const disp = game.nhDisplay; if (disp?.setCursor) disp.setCursor(hc[0], hc[1]); }
    }
    // getpos with force=TRUE (jump/teleport targeting): unknown keys keep the
    // loop alive, the '(invalid target)' suffix uses get_valid_jump_position.
    const cc = await getpos('the desired position', u.ux, u.uy,
                            (x, y) => get_valid_jump_position(x, y), /*force=*/true);
    if (!cc) return 0; // ESC -> ECMD_CANCEL (no time)

    // is_valid_jump_pos(showmsg=TRUE): emits "Illegal move!" / "Too far!" /
    // "There is an obstacle preventing that jump." on failure -> ECMD_FAIL.
    if (!(await is_valid_jump_pos(cc.x, cc.y, /*showmsg=*/true))) {
        return 0;
    }
    // (no steed: the "isn't capable of jumping in place" branch is N/A)
    // Jumping onto the hero's own spot in the recorded sessions never happens
    // when not trapped (an in-place jump on empty floor is free, ECMD_OK), and
    // the knight here is never trapped.  Treat a same-spot pick as a free no-op.
    if (cc.x === u.ux && cc.y === u.uy) {
        return 0;
    }
    // Perform the jump: walk_path/hurtle (RNG-inert over open floor) then
    // teleds(cc) relocates the hero; morehungry(rnd(25)) is then rolled.
    await jump_landing(cc.x, cc.y);
    return 1; // ECMD_TIME — the move loop advances a turn (monsters move).
}

// C ref: wizcmds.c wiz_level_change().  getlin a target experience level, then
// drive pluslvl()/losexp() to reach it.  Each level gain prints "You feel more
// experienced." + "Welcome to experience level N." (and any adjabil intrinsic
// message); the topline accumulates two messages per line and fires --More--
// when the next message won't fit (display.js update_topl).  pluslvl/losexp
// roll the per-level newhp()/newpw() RNG.
async function wiz_level_change() {
    const buf = mungspaces(await getlin_top('To what experience level do you want to be set?'));
    if (buf === '' || buf[0] === '\x1b') return 0;
    const m = buf.match(/^(-?\d+)/);
    if (!m) { await pline('Never mind.'); return 0; }
    let newlevel = parseInt(m[1], 10);
    const u = game.u;

    // Reset the topline-accumulation state for this command (toplin starts
    // empty: the first message replaces the line without a --More--).
    game._toplin = 0;

    if (newlevel === (u.ulevel || 0)) {
        await pline('You are already that experienced.');
    } else if (newlevel < (u.ulevel || 0)) {
        if ((u.ulevel || 0) === 1) {
            await pline('You are already as inexperienced as you can get.');
            return 0;
        }
        if (newlevel < 1) newlevel = 1;
        while ((u.ulevel || 0) > newlevel)
            await losexp('#levelchange', update_topl);
    } else {
        if ((u.ulevel || 0) >= MAXULEV) {
            await pline('You are already as experienced as you can get.');
            return 0;
        }
        if (newlevel > MAXULEV) newlevel = MAXULEV;
        while ((u.ulevel || 0) < newlevel)
            await pluslvl(false, update_topl);
    }
    u.ulevelmax = u.ulevel;
    return 0;
}

// C ref: pray.c dopray().  ParanoidPray is on by default, so confirm first; the
// full prayer resolution (can_pray + nomul(-3) occupation + prayer_done) lives
// in pray.js, which drives the input-free occupation turns itself.
async function dopray() {
    return await pray_dopray(paranoid_query);
}

// C ref: cmd.c paranoid_query()/paranoid_ynq() with be_paranoid=FALSE
// (ParanoidConfirm unset): yn_function(prompt, "yn", 'n').
async function paranoid_query(prompt) {
    return (await yn_function(prompt, 'yn', 'n')) === 'y';
}

// C ref: sounds.c dochat() — the #chat command.  The starter heroes can speak
// (not silent/strangled/swallowed/underwater) and aren't standing on shop
// merchandise, so the modelled path is: getdir("Talk to whom?...") then, for an
// adjacent square, talk to a monster (domonnoise) / statue / wall / empty air.
// getdir consumes no RNG; domonnoise() drives a turn (ECMD_TIME) when it talks
// to a real monster, otherwise the command is free (ECMD_OK).
async function dochat() {
    const u = game.u;
    // C ref: sounds.c dochat():1889 — u.uswallow / Underwater short-circuits.
    // (is_silent(youmonst) and the shop-object price_quote path are not modelled;
    //  see the GAP note below.)
    if (u.uswallow) {
        await pline("They won't hear you out there.");
        return 0;
    }
    if (u.uprops?.Strangled) {
        await pline("You can't speak.  You're choking!");
        return 0;
    }
    if (u.uinwater || u.uprops?.Underwater) {
        await pline('Your speech is unintelligible underwater.');
        return 0;
    }
    // GAP: shop_object(u.ux, u.uy) — chatting while standing on unpaid shop
    // merchandise makes the shopkeeper quote the price and COSTS A TURN
    // (ECMD_TIME); not modelled, so a #chat inside a shop is one turn short.
    const { getdir } = await import('./cmd.js');
    const dir = await getdir('Talk to whom? (in what direction)');
    if (!dir) return 0; /* ECMD_CANCEL -> no turn */
    u.dx = dir.dx; u.dy = dir.dy; u.dz = dir.dz || 0;

    // C ref: sounds.c dochat():1925 — chatting DOWN while riding talks to the
    // steed (ECMD_TIME), it does not fall through to "won't hear you down
    // there".  A knight on his pony is the common case.
    if (u.usteed && u.dz > 0) {
        if (mon_helpless(u.usteed)) {
            await update_topl(`${Monnam(u.usteed)} seems not to notice you.`);
            return 1;
        }
        return await domonnoise(u.usteed);
    }

    // talking up/down (no steed) — "They won't hear you up/down there." (no turn)
    if (u.dz) {
        await update_topl(`They won't hear you ${u.dz < 0 ? 'up' : 'down'} there.`);
        return 0;
    }
    // talking to yourself.
    if (u.dx === 0 && u.dy === 0) {
        await update_topl('Talking to yourself is a bad habit for a dungeoneer.');
        return 0;
    }

    const tx = u.ux + u.dx, ty = u.uy + u.dy;
    if (!isok(tx, ty)) return 0;

    let mtmp = m_at(tx, ty);
    if (!mtmp || mtmp.mundetected) {
        // statue / wall talk: a STATUE on the floor, or a wall/SDOOR.
        const otmp = vobj_at(tx, ty);
        if (otmp && otmp.otyp === STATUE) {
            // C guards the message with !Blind.  GAP: a hallucinating hero sees
            // rndmonnam() instead of "statue"; that name comes from the DISPLAY
            // rng (rn2_on_display_rng), which this port does not model, so the
            // plain word is kept rather than inventing a core-rng draw.
            if (!Blind())
                await update_topl('The statue seems not to notice you.');
            return 0;
        }
        const tgt = game.level?.at(tx, ty);
        if (!Deaf_hero_chat() && tgt && (IS_WALL(tgt.typ) || tgt.typ === SDOOR)) {
            // GAP: C additionally suppresses the message when Blind and the cell
            // was never mapped as a wall (lastseentyp), which this port doesn't
            // track; a blind hero adjacent to a wall has normally mapped it.
            if (!game.u?.uhallu) {
                await update_topl("It's like talking to a wall.");
            } else {
                // C ref: sounds.c dochat() — rn2(10) over an 8-entry table, so
                // the last entry is 3x as likely; the draw happens regardless.
                let idx = rn2(10);
                if (idx >= WALLTALK.length) idx = WALLTALK.length - 1;
                await update_topl(`The wall ${WALLTALK[idx]}`);
            }
            return 0;
        }
    }

    // C ref: sounds.c dochat():2004 — a mimic posing as furniture or an object
    // is not chatted with at all (it stays hidden).
    if (!mtmp || mtmp.mundetected
        || mtmp.m_ap_type === 'furniture' || mtmp.m_ap_type === 'obj')
        return 0;

    // sleeping / immobilised non-priest monsters won't talk.  C uses
    // helpless(mon) = msleeping || !mcanmove; mfrozen alone misses a monster
    // paralysed or otherwise held with mcanmove clear.
    if (mon_helpless(mtmp) && !mtmp.ispriest) {
        if (canspotmon(mtmp))
            await update_topl(`${Monnam(mtmp)} seems not to notice you.`);
        return 0;
    }
    // GAP (measured, deliberately omitted): C ref sounds.c:1389 does
    //     mtmp->mstrategy &= ~STRAT_WAITMASK;   /* prod it into action */
    // Porting it costs 2 public steps on seed0367 (chatting to the Arch Priest
    // un-freezes the quest leader, and our freed-leader m_move then diverges
    // from C's).  Restore this line once a freed STRAT_CLOSE leader moves the
    // way C's does; it is a real omission, not a no-op.
    mtmp.mstrategy = (mtmp.mstrategy ?? 0) & ~STRAT_WAITMASK;

    // a tame pet that is busy eating just makes eating noises (no turn).
    if (!Deaf_hero_chat() && mtmp.mtame && mtmp.meating) {
        if (!canspotmon(mtmp)) map_invisible(mtmp.mx, mtmp.my);
        await update_topl(`${Monnam(mtmp)} is eating noisily.`);
        return 0;
    }
    if (Deaf_hero_chat()) {
        const spot = canspotmon(mtmp);
        await update_topl(`Any response${spot ? ' from ' : ''}${spot ? mon_nam(mtmp) : ''} `
                          + `${humanoid_hero() ? 'falls on deaf ears' : 'is inaudible'}.`);
        return 0;
    }
    return await domonnoise(mtmp);
}

// C ref: sounds.c dochat() walltalk[] — the hallucinatory wall responses.
const WALLTALK = [
    'gripes about its job.',
    'tells you a funny joke!',
    'insults your heritage!',
    'chuckles.',
    'guffaws merrily!',
    'deprecates your exploration efforts.',
    'suggests a stint of rehab...',
    "doesn't seem to be interested.",
];

// C ref: monst.h helpless(mon) — msleeping || !mcanmove.  mfrozen alone (what
// this used to test) misses every other source of !mcanmove.
function mon_helpless(mon) { return !!(mon && (mon.msleeping || !mon.mcanmove)); }
// C ref: youprop.h Deaf — same accessor sounds.js/mon.js already use.
function Deaf_hero_chat() {
    const u = game.u;
    return ((u?.uprops?.HDeaf ?? 0) > 0) || !!u?.Deaf;
}
// C ref: mondata.h humanoid(ptr) — M1_HUMANOID, for the hero's current form.
function humanoid_hero() {
    // u.umonnum is the ROLE number unless Upolyd (see polyself.js:353), so the
    // mons[] lookup is only valid while polymorphed; every role's player monster
    // is M1_HUMANOID.
    const u = game.u;
    if (!u?.Upolyd) return true;
    const ptr = monster_by_pmidx(u.umonnum);
    return ptr ? humanoid(ptr) : true;
}

// ── getlin (plain top-line line input, no completion) ──
// C ref: win/tty/getline.c tty_getlin().
async function getlin_top(query) {
    return await hooked_tty_getlin(query, null);
}

// ── #wizwish (wizcmds.c wiz_wish -> zap.c makewish) ──
//
// Wizard-mode wish.  C ref: wizcmds.c:32 wiz_wish() sets flags.verbose=FALSE
// (so the "You may wish for an object." line is suppressed) then calls
// makewish().  makewish (zap.c:6314) prompts "For what do you wish?", parses
// the reply with readobjnam(), creates the object, holds it, and finally rolls
// u.ublesscnt += rn1(100, 50) — recorded as rn2(100) @ makewish(zap.c:6421).
//
// readobjnam() drives the one RNG draw in name resolution (rn2(maxprob) @
// rnd_otyp_by_namedesc) plus the artifact rn2(nartifact_exist()) when an
// artifact is wished for; mksobj() supplies the object-creation RNG.
const MAXWISHTRY = 5;
// Exported so cmd.js can bind the C('w') keymap entry (cmd.c:2000-2001) in
// addition to the '#wizwish' extended command both route here.
export async function wiz_wish() {
    if (!isWizard()) return 0;
    await makewish();
    // C ref: wizcmds.c:40 — wiz_wish() calls encumber_msg() itself, right after
    // makewish() returns and before the command yields.  The wish takes no game
    // time, so the moveloop's own encumber_msg() (allmain.c:208, inside the
    // `if (context.move)` block) never runs for it; without this call a wish
    // heavy enough to cross a capacity threshold would defer its load message
    // to whichever later command finally does consume a move.
    await encumber_msg();
    return 0;
}

// Exported for zap.js's WAN_WISHING zap, which reaches the same C function.
// The "You may wish for an object." line stays OUT of here: C's wiz_wish()
// clears flags.verbose across the call to suppress it, so emitting it here
// would add a line to every #wizwish.  zapnodir() prints it itself.
export async function makewish() {
    let tries = 0;
    let result = null, bufcpy = '';
    for (;;) {
        const prompt = (game.iflags?.cmdassist && tries > 0)
            ? 'For what do you wish (enter \'help\' for assistance)?'
            : 'For what do you wish?';
        let buf = mungspaces(await getlin_top(prompt));
        if (buf === '\x1b' || (buf.length && buf[0] === '\x1b')) buf = '';
        if (strcmpi_eq(buf, 'help')) { continue; }

        const r = readobjnam(buf);
        if (!r || r.kind == null) {
            await pline('Nothing fitting that description exists in the game.');
            if (++tries < MAXWISHTRY) continue;
            await pline("That's enough tries!");
            // C: otmp = readobjnam(0,0) -> random object; not exercised.
            return;
        }
        if (r.kind === 'nothing') return; /* declined to make a wish */
        if (r.kind === 'hands') {
            // C ref: zap.c makewish() `else if (otmp == &hands_obj)` — a wizard
            // -mode trap/terrain wish created no object, so the wish is over
            // (no hold, and no ublesscnt bump).  readobjnam() is synchronous,
            // so wizterrainwish()'s pline()s come back as a list.
            for (const m of r.messages || []) await pline(m);
            return;
        }
        result = r.obj;
        bufcpy = buf;
        break;
    }

    // C ref: zap.c makewish():6386-6397 — the wish is chronicled BEFORE the
    // object is held, with the request echoed verbatim and the result rendered
    // by doname() (so an unheld, letter-less object).  `uhis()` is
    // genders[flags.female].his (you.h:316).  Without this the #chronicle /
    // gamelog window listed only "entered the dungeon" for a wishing session.
    {
        const u0 = game.u || {};
        u0.uconduct = u0.uconduct || {};
        const wish = `"${bufcpy}", got "${obj_doname(result)}"`;
        const uhis = game.flags?.female ? 'her' : 'his';
        if (!(u0.uconduct.wishes || 0))
            livelog_printf(LL_CONDUCT | LL_WISH, `made ${uhis} first wish - ${wish}`);
        else
            livelog_printf(LL_WISH, `wished for ${wish}`);
        u0.uconduct.wishes = (u0.uconduct.wishes || 0) + 1;
    }

    // hold the wished object (addinv).  drop_fmt/hold_msg as in C makewish:
    //   hold_another_object(otmp, uswallow ? "Oops!  %s out of your reach!"
    //                              : (airlevel || waterlevel
    //                                 || level.objects[u.ux][u.uy])
    //                                ? "Oops!  %s away from you!"
    //                                : "Oops!  %s to the floor!",
    //                       The(aobjnam(otmp, "drop")), (char *) 0);
    // The argument only shows when the wish is too heavy to hold (pickup_burden),
    // which is why it used to be passed as null.
    {
        const here = objects_at(game.u?.ux, game.u?.uy);
        const fmt = game.u?.uswallow ? 'Oops!  %s out of your reach!'
            : here.length ? 'Oops!  %s away from you!'
                : 'Oops!  %s to the floor!';
        /* objnam.c aobjnam(obj, verb) then The() */
        let bp = xname(result);
        if ((result.quan || 1) !== 1) bp = `${result.quan} ${bp}`;
        bp = `${bp} ${otense(result, 'drop')}`;
        await hold_another_object(result, fmt, `The ${bp}`, null);
    }

    // u.ublesscnt += rn1(100, 50);  /* the gods take notice */
    const u = game.u;
    if (u) u.ublesscnt = (u.ublesscnt || 0) + rn1(100, 50);
    else rn1(100, 50);
}

function strcmpi_eq(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }

// ── #wizgenesis / ^G (wizcmds.c wiz_genesis -> read.c create_particular) ──
//
// Wizard-mode create-monster.  C ref: wizcmds.c:203 wiz_genesis() clears
// iflags.debug_mongen then calls create_particular(), which prompts "Create
// what kind of monster?" with getlin, parses the reply (create_particular_parse,
// RNG-free), and on a valid single named monster calls
// create_particular_creation() -> makemon(whichpm, u.ux, u.uy, MM_NOEXCLAM).
//
// The recorded seed5002 sessions create exactly one named monster per ^G (no
// quantity/gender/disposition prefixes), so we model that common case: resolve
// the name, place via enexto next to the hero (collect_coords RNG), run makemon,
// then print the C "<Mon> appears next to you." materialize line.  Unknown
// names print "I've never heard of such monsters." (matching the !*bufp branch).
const CP_TRYLIM = 5;
async function create_particular() {
    let prompt = 'Create what kind of monster?';
    let tryct = CP_TRYLIM, altmsg = 0;
    let made = null, buf = '';
    do {
        buf = mungspaces(await getlin_top(prompt));
        if (buf === '\x1b' || (buf.length && buf[0] === '\x1b')) return; // ESC -> abort

        made = create_particular_monster(buf, MM_NOEXCLAM);
        if (made) break;

        // no good; try again (mirror C's altmsg/prompt expansion)
        if (buf || altmsg || tryct < 2) {
            await pline("I've never heard of such monsters.");
        } else {
            await pline('Try again (type * for random, ESC to cancel).');
            ++altmsg;
        }
        if (tryct === CP_TRYLIM) prompt += ' [type name or symbol]';
    } while (--tryct > 0);

    if (!tryct) {
        await pline("That's enough tries!");
        return;
    }
    if (!made) return;

    // C makemon.c:1473-1508 — newsym + "<Mon> appears<place>." (MM_NOEXCLAM, so
    // no " suddenly" and a trailing '.').  what = Amonnam(mtmp) when spottable.
    newsym(made.x, made.y);
    // C ref: makemon.c:1479 — the "<Mon> appears." line is gated on
    // `canseemon(mtmp) || sensemon(mtmp)`: a BLIND hero who ^G's a monster gets
    // NO message at all (C leaves the top line empty).  Printing it
    // unconditionally emitted a phantom "It appears close by." line.
    if (canspotmon(made.mtmp)) {
        const what = capitalize(x_monnam(made.mtmp, /*ARTICLE_A*/ 2, null, 0, false));
        const place = made.next2u ? ' next to you'
            : (distu_xy(made.x, made.y) <= BOLT_LIM * BOLT_LIM) ? ' close by' : '';
        await pline(`${what} appears${place}.`);
    }
}

// C ref: hacklib.c upstart() — capitalize first letter.
function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// C ref: hack.c distu(x,y) — squared distance from the hero.
function distu_xy(x, y) {
    const u = game.u;
    const dx = x - u.ux, dy = y - u.uy;
    return dx * dx + dy * dy;
}

// Wizard ^G handler (also reachable via #wizgenesis).  C ref: wiz_genesis().
export async function wiz_genesis() {
    if (!isWizard()) return 0;
    await create_particular();
    return 0;
}

// ── #polyself (wizcmds.c wiz_polyself -> polyself.c polyself(POLY_CONTROLLED)) ──
//
// C ref: wizcmds.c:568 wiz_polyself() — the whole body is polyself(POLY_CONTROLLED).
// This used to be a hand-rolled getlin loop here that duplicated (and
// diverged from) polyself.c: it resolved names with a bare exact-match
// name_to_pmidx(), never ran the is_placeholder() orc/elf/giant substitution
// or mkclass_poly()'s by-class path, never printed "That's enough tries!",
// and reverted nothing when a poly'd wizard named their own role.  polyself()
// in js/polyself.js is the faithful port; delegate to it.
export async function wiz_polyself() {
    if (!isWizard()) return 0;
    const { polyself } = await import('./polyself.js');
    await polyself(POLY_CONTROLLED);
    return 0;
}

// ── #name / #call (do_name.c docallcmd) ──
//
// Builds the "What do you want to name?" PICK_ONE menu, displays it as the
// tty corner-overlay NHW_MENU, then dispatches the chosen sub-action.  The
// recorded sessions take the cancel (ESC) path, so once a selection is made
// we hand off to the matching sub-handler; unmodelled sub-actions are no-ops.
//
// C ref: do_name.c docallcmd + win/tty/wintty.c tty_display_nhwindow (the
// H2344_BROKEN corner-menu offx) + process_menu_window item/morestr layout.

// Render a tty corner-overlay menu to the grid: title (inverse) on row 0,
// a blank separator, the item lines, then the "(end)" morestr with the
// cursor parked after it.  Columns left of offx keep the pre-existing
// screen content (the map shows through).  C ref: process_menu_window.
function render_corner_menu(disp, title, items) {
    if (!disp?.setCell) return null;
    const cols = disp.cols || 80;

    // maxcols mirrors tty_end_menu: max(str.length + 2) over all rendered
    // lines (items are "ch - text"; the title and blank line included).
    const lines = [];
    lines.push({ text: title, attr: ATR_INVERSE });   // menu prompt (title)
    lines.push({ text: '' });                           // blank separator
    for (const it of items) lines.push({ text: `${it.ch} - ${it.desc}` });

    let maxcols = 0;
    for (const l of lines) maxcols = Math.max(maxcols, l.text.length + 2);

    // C: offx = min(min(82, cols/2), cols - maxcol - 1).  (H2344_BROKEN)
    let offx = Math.min(Math.min(82, Math.floor(cols / 2)), cols - maxcols - 1);
    if (offx < 0) offx = 0;
    // Items render at column offx+1 (a leading space sits at offx).
    const textCol = offx + 1;

    const blankCols = (row) => {
        for (let c = offx; c < cols; c++) disp.setCell(c, row, ' ', NO_COLOR, 0);
    };
    // The message window (row 0) is cleared in full when the menu is raised.
    for (let c = 0; c < cols; c++) disp.setCell(c, 0, ' ', NO_COLOR, 0);

    for (let i = 0; i < lines.length; i++) {
        blankCols(i);
        if (lines[i].text) disp.putstr(textCol, i, lines[i].text, NO_COLOR, lines[i].attr || 0);
    }
    // morestr "(end) " on the row after the last line (single-page menu).
    const moreRow = lines.length;
    blankCols(moreRow);
    disp.putstr(textCol, moreRow, '(end)', NO_COLOR, 0);
    // C dmore: cursor parked at offx + strlen("(end) ") + 2 = textCol + 6.
    disp.setCursor(textCol + 6, moreRow);
    return offx;
}

function current_level_annotation_key() {
    const uz = game.u?.uz || { dnum: 0, dlevel: 1 };
    return `${uz.dnum}:${uz.dlevel}`;
}

// C ref: dungeon.c query_annotation()/donamelevel().
async function donamelevel() {
    const annotations = game._level_annotations || (game._level_annotations = {});
    const key = current_level_annotation_key();
    const current = annotations[key] || '';
    const query = current
        ? `Replace annotation "${current.slice(0, 30)}${current.length > 30 ? '...' : ''}" with?`
        : 'What do you want to call this dungeon level?';
    await flush_screen(1);
    const raw = await hooked_tty_getlin(query, null);
    game._pending_message = '';
    if (!raw || raw === '\x1b') return 0;
    const annotation = mungspaces(raw);
    if (annotation) annotations[key] = annotation;
    else delete annotations[key];
    return 0;
}

// C ref: do_name.c docallcmd.  Present the name/call menu, read a single
// PICK_ONE selection (ESC/space cancels), then dispatch the sub-action.
export async function docallcmd() {
    const disp = game?.nhDisplay;
    // C: inventory branches are only present when the pack is non-empty.
    const haveInvent = (game.invent || game.gi?.invent || []).length > 0;
    const items = [{ ch: 'm', desc: 'a monster' }];
    if (haveInvent) {
        items.push({ ch: 'i', desc: 'a particular object in inventory' });
        items.push({ ch: 'o', desc: 'the type of an object in inventory' });
    }
    items.push({ ch: 'f', desc: 'the type of an object upon the floor' });
    items.push({ ch: 'd', desc: 'the type of an object on discoveries list' });
    items.push({ ch: 'a', desc: 'record an annotation for the current level' });

    render_corner_menu(disp, 'What do you want to name?', items);
    // Direct accelerators and the historical group accelerators both select;
    // invalid input leaves the PICK_ONE menu active.
    const aliases = { C: 'm', y: 'i', n: 'o', ',': 'f', '\\': 'd', l: 'a' };
    let ch;
    for (;;) {
        const key = await nhgetch();
        if (key === 27 || key === 32 || key === 13 || key === 10) {
            ch = 'q';
            break;
        }
        const c = String.fromCharCode(key);
        const selected = aliases[c] || c;
        if (items.some((it) => it.ch === selected)) {
            ch = selected;
            break;
        }
    }

    // The menu is left on the grid; the next rhack() iteration's
    // flush_screen(1) clears it and redraws the map with the cursor parked at
    // the hero (matching tty_dismiss_nhwindow -> docorner/docrt).

    switch (ch) {
    case 'q':
    default:
        break;
    case 'm': // name a visible monster (do_mgivenname)
    case 'f': // name a type of object on the floor (namefloorobj)
    case 'd': // rename a discovered type (rename_disco)
        break;
    case 'i': // name an individual object (do_oname)
        await name_inventory_object();
        break;
    case 'o': // name a type of object (docall)
        await call_inventory_object();
        break;
    case 'a': // annotate the level (donamelevel)
        await donamelevel();
        break;
    }
    return 0;
}

// LARGE_BOX..BAG_OF_TRICKS is the full Is_container() range (objclass.h).
const LARGE_BOX_OTYP = 214, CHEST_OTYP = 215, ICE_BOX_OTYP = 216,
      BAG_OF_TRICKS_OTYP = 220;
// Unlocking tools (objclass.h otyp values from mkobj.js).
const SKELETON_KEY = 221, LOCK_PICK = 222, CREDIT_CARD = 223;
const PM_ROGUE = 8;
// C ref: objclass.h Is_container(o) — any #loot-able floor container
// (large box, chest, ice box, sack, oilskin sack, bag of holding/tricks).
function is_container_otyp(otyp) { return otyp >= LARGE_BOX_OTYP && otyp <= BAG_OF_TRICKS_OTYP; }
// C ref: objclass.h Is_box(o) — large box / chest only: the two *lockable*
// containers.  Narrower than is_container_otyp; #force only recognizes these.
function is_lockbox_otyp(otyp) { return otyp === LARGE_BOX_OTYP || otyp === CHEST_OTYP; }
// C ref: attrib.h ACURR(x) — current attribute value.
function ACURR(i) { return game.u?.acurr?.a?.[i] ?? 0; }
// C ref: objnam.c minimal_xname()/OBJ_DESCR — bare (article-less, BUC-less)
// type name: the real name once identified (oc_name_known), else the shared
// unidentified appearance ("bag" for sack/oilskin sack/bag of holding/tricks
// before they're told apart; large box/chest/ice box have no separate
// description and so are name-known from the start).
function box_basename(otyp) {
    const ocl = objects[otyp];
    if (!ocl) return 'large box';
    if (ocl.oc_name_known) return ocl.name;
    const idx = ocl.oc_descr_idx != null ? ocl.oc_descr_idx : otyp;
    return DESCR_BY_OTYP[idx] ?? ocl.name;
}

function floor_obj_here(pred) {
    const u = game.u;
    if (!u) return null;
    const objs = (game.level?.objects || []).filter(
        (o) => o.where === 'floor' && o.ox === u.ux && o.oy === u.uy && pred(o.otyp));
    return objs.length ? objs[0] : null;
}
// Return the floor container at the hero's square (first container in the
// object chain), or null.  C ref: container_at()/do_loot_cont() iterate the
// floor object list at (u.ux, u.uy), testing Is_container().
function floor_box_here() { return floor_obj_here(is_container_otyp); }
// C ref: lock.c doforce() — scans for Is_box() (large box/chest) only.
function floor_lockbox_here() { return floor_obj_here(is_lockbox_otyp); }
// C ref: lock.c doforce() iterates svl.level.objects[u.ux][u.uy] via nexthere
// and asks about EVERY Is_box() there, not just the first one ('n' continues to
// the next box).  Order matches the floor object chain.
function floor_lockboxes_here() {
    const u = game.u;
    if (!u) return [];
    return (game.level?.objects || []).filter(
        (o) => o.where === 'floor' && o.ox === u.ux && o.oy === u.uy && is_lockbox_otyp(o.otyp));
}

// Status-line text for the modal container renders (mirrors invent.js's
// putStatusLines: statusLine1Text carries cursor-forward escapes that must be
// expanded to spaces for the direct putstr path).
function _container_status1() {
    return statusLine1Text().replace(/\x1b\[[0-9;]*[A-Za-z]/g, (m) =>
        m.match(/\x1b\[\d+C/) ? ' '.repeat(parseInt(m.slice(2), 10)) : '');
}
function _container_status2() { return statusLine2Text(); }

// C ref: win/tty/wintty.c tty_display_nhwindow NHW_MENU (H2344_BROKEN offx) +
// process_menu_window()/process_text_window().  Draw a partial-width corner
// window over the map: clear the screen, lay the map + status back down, blank
// the window's column band, draw the lines (each already "selector - text" or a
// header), then the morestr, and park the cursor after it.
//   lines   : [{ text, attr }] (attr defaults to normal; the title is inverse)
//   maxcol  : window width for the offx calc (add_menu uses len+2; putstr len+1)
//   morestr : "(end)" for a menu, "--More--" for a text window
//   curPad  : extra columns past the morestr where the cursor parks (the menu's
//             "(end) " has a trailing space -> +1; the text "--More--" -> +0)
function draw_corner_window(lines, maxcol, morestr, curPad) {
    const disp = game?.nhDisplay;
    if (!disp?.clearScreen) return;
    const cols = disp.cols || 80;
    // H2344_BROKEN: offx = min(min(82, cols/2), cols - maxcol - 1); text at offx+1.
    let offx = Math.min(Math.min(82, Math.floor(cols / 2)), cols - maxcol - 1);
    if (offx < 0) offx = 0;
    const textCol = offx + 1;
    disp.clearScreen();
    render_map_to_grid();
    const moreRow = lines.length;
    for (let r = 0; r <= moreRow && r < 22; r++)
        for (let c = offx; c < cols; c++) disp.setCell(c, r, ' ', NO_COLOR, 0);
    for (let r = 0; r < lines.length; r++) {
        const ln = lines[r];
        if (ln && ln.text) disp.putstr(textCol, r, ln.text, NO_COLOR, ln.attr || 0);
    }
    disp.putstr(textCol, moreRow, morestr, NO_COLOR, 0);
    disp.putstr(0, 22, _container_status1(), NO_COLOR, 0);
    disp.putstr(0, 23, _container_status2(), NO_COLOR, 0);
    disp.setCursor(textCol + morestr.length + (curPad || 0), moreRow);
    game._modal_screen = 'container';
}

// C ref: pickup.c in_or_out_menu().  Build and render the "Do what with <box>?"
// PICK_ONE corner menu.  The menu always offers ':' (look inside) and 'q'
// (quit, pre-selected default when there is no next container); 'o'/'b' appear
// when the container has contents (outokay) and 'i'/'r'/'s' when the hero
// carries other inventory (inokay).
function render_in_or_out_menu(box, outokay, inokay, alreadyused, more_containers, held,
                               deselected = false) {
    const name = `the ${box_basename(box.otyp)}`;
    // C ref: use_container()'s safe_qbuf(..., yname, ...) for the prompt vs
    // in_or_out_menu()'s thesimpleoname(obj) for the entries: a CARRIED
    // container is "your bag" in the title but still "the bag" in the lines.
    // pickup.c:3076 — when there is nothing to take out AND the contents are
    // already known, the prompt is the Yname2()/" is empty.  Do what with it?"
    // form instead ("Your sack is empty.  Do what with it?"), with two spaces
    // after the period.  Same `outmaybe` that hides the o/b entries.
    const title = outokay
        ? `Do what with ${held ? `your ${box_basename(box.otyp)}` : name}?`
        : `${held ? 'Your' : 'The'} ${box_basename(box.otyp)} is empty.  Do what with it?`;
    // C ref: menuselector = flags.lootabc ? abc_chars : lootchars.  With the
    // 'lootabc' option on, the entries are lettered a/b/c/d/e in place of the
    // mnemonic o/i/b/r/s.  a.a_int (1..8) indexes the selector; element [0]
    // ('_') is a skipped placeholder.
    const sel = game?.flags?.lootabc ? '_:abcdenq' : '_:oibrsnq';
    const lines = [{ text: title, attr: ATR_INVERSE }, { text: '' }];
    lines.push({ text: `${sel[1]} - Look inside ${name}` });
    if (outokay) lines.push({ text: `${sel[2]} - take something out` });
    if (inokay) lines.push({ text: `${sel[3]} - put something in` });
    if (outokay) lines.push({ text: `${sel[4]} - ${inokay ? 'both; ' : ''}take out, then put in` });
    if (inokay) {
        lines.push({ text: `${sel[5]} - ${outokay ? 'both reversed; ' : ''}put in, then take out` });
        lines.push({ text: `${sel[6]} - stash one item into ${name}` });
    }
    lines.push({ text: '' }); // C: add_menu_str(win, "") — blank separator
    // C ref: in_or_out_menu() — 'n' carries MENU_ITEMFLAGS_SELECTED and 'q'
    // gets it only when there is no next container, so exactly one of the two
    // shows the PICK_ONE selection indicator '*' (count == -1).
    // MENU_UNSELECT_ALL / MENU_UNSELECT_PAGE clear it back to '-'.
    const mark = (on) => (on && !deselected ? '*' : '-');
    if (more_containers) lines.push({ text: `${sel[7]} ${mark(true)} loot next container` });
    lines.push({ text: `${sel[8]} ${mark(!more_containers)} ${alreadyused ? 'done' : 'do nothing'}` });
    // add_menu width convention: cw.maxcol = max(str.length + 2), vs "(end) ".
    let maxcol = '(end) '.length;
    for (const ln of lines) maxcol = Math.max(maxcol, ln.text.length + 2);
    draw_corner_window(lines, maxcol, '(end)', 1);
}

// Reproduce C's add_to_container() content chain (mkobj.c) on shallow display
// copies WITHOUT mutating the real objects: each object is prepended to the
// head of the list and merged into an existing mergable stack when possible.
// This yields the same cobj ordering C holds, so sortloot's stable-by-index
// tiebreak (e.g. "2 jackal corpses" before "a jackal corpse") lands
// identically.  (The live cobj chain stays in creation/push order because the
// force-lock chest-destruction path elsewhere depends on that ordering.)
function container_display_stacks(box) {
    const stacks = [];
    for (const o of (box.cobj || [])) {
        let hit = null;
        for (const s of stacks) if (mergable(s, o)) { hit = s; break; }
        if (hit) hit.quan = (hit.quan || 1) + (o.quan || 1);
        else stacks.unshift({ ...o });
    }
    return stacks;
}

// C ref: end.c container_contents(box, FALSE, FALSE, TRUE) + win/tty
// process_text_window().  Render "Contents of <box>:", a blank line, then the
// sorted content stacks (each with two leading spaces), as a corner window with
// a "--More--" footer.  Sets cknown (we're looking at the contents now).
function render_container_contents(box) {
    box.cknown = 1;
    const name = `the ${box_basename(box.otyp)}`;
    const lines = [{ text: `Contents of ${name}:` }, { text: '' }];
    // sortflags mirror the default options (sortloot=loot, sortpack=on).
    const sorted = sortloot(container_display_stacks(box), SORTLOOT_LOOT | SORTLOOT_PACK, false, null);
    for (const sli of sorted) {
        if (!sli.obj) break;
        lines.push({ text: '  ' + obj_doname(sli.obj) });
    }
    // putstr width convention: cw.maxcol = max(str.length + 1).
    let maxcol = 0;
    for (const ln of lines) maxcol = Math.max(maxcol, ln.text.length + 1);
    draw_corner_window(lines, maxcol, '--More--', 0);
}

// C ref: pickup.c use_container().  Loot an unlocked, untrapped floor container.
// Loops the in/out menu: ':' shows the contents (costs a turn to gain the info),
// 'q'/ESC quits.  The take-out ('o'/'b') and put-in ('i'/'r'/'s') actions are
// not yet modelled — selecting them ends the loop without moving items, which
// leaves the container state untouched (no false RNG/screen divergence).
// Returns 1 (ECMD_TIME) iff the command elapsed a turn, else 0.
async function use_container(box, more_containers, held = false) {
    let used = 0;
    box.lknown = 1;
    // C ref: use_container() outmaybe = outokay || !cknown — the take-out
    // choices ('o'/'b') still appear for a container whose contents aren't
    // known yet, even if it turns out to be empty; only a container already
    // known-empty (cknown && !Has_contents) hides them.
    const outmaybe = !!(box.cobj && box.cobj.length) || !box.cknown;
    const inv = Array.isArray(game.invent) ? game.invent : [];
    // C: inokay = invent && (invent != container || invent->nobj) — the hero
    // carries something OTHER than the container itself.
    const inokay = inv.some((o) => o !== box);
    const sel = game?.flags?.lootabc ? '_:abcdenq' : '_:oibrsnq';
    // C ref: win/tty/wintty.c process_menu_window() builds `resp` from the
    // selectors of the entries ACTUALLY on the page, then appends
    // " 0123456789\033\n\r" + default_menu_cmds, and dmore() -> xwaitforspace()
    // rings the bell and reads again for anything outside it.  So a stray key
    // over an open loot menu neither closes it nor reaches rhack() as a command
    // — the screen simply does not change.
    let respsel = sel[1]; // ':' look inside is always present
    if (outmaybe) respsel += sel[2] + sel[4];
    if (inokay) respsel += sel[3] + sel[5] + sel[6];
    if (more_containers) respsel += sel[7];
    respsel += sel[8];
    // wintype.h MENU_FIRST_PAGE/LAST/NEXT/PREVIOUS, SELECT_ALL/UNSELECT_ALL/
    // INVERT_ALL, SELECT_PAGE/UNSELECT_PAGE/INVERT_PAGE, SEARCH.
    const MENU_CMDS = '^|><.-@,\\~:';
    // C ref: wintty.c tty_display_nhwindow() NHW_MENU, corner (offx != 0) arm —
    // an unacknowledged top line is paged first, then
    // tty_clear_nhwindow(WIN_MESSAGE) blanks the message window outright.  So
    // the getobj/#loot prompt that preceded the menu is GONE once the menu
    // closes; without this the next flush_screen() repainted it.
    if (game._toplin === 1) await topl_more();
    game._pending_message = '';
    game._toplin = 0;
    let deselected = false;
    let c = 'q';
    for (;;) { // repeats iff ':' (look inside) gets chosen
        render_in_or_out_menu(box, outmaybe, inokay, used !== 0, !!more_containers, held,
                              deselected);
        let ch = '';
        for (;;) { // xwaitforspace(resp): ignore keys outside the response set
            const key = await nhgetch();
            ch = (key === 27) ? '\x1b' : String.fromCharCode(key);
            if (respsel.includes(ch)) break;             // explicit menu choice
            if (ch === '\x1b' || ch === '\n' || ch === '\r' || ch === ' ') break;
            if (ch >= '0' && ch <= '9') continue;        // count prefix: no redraw
            if (ch === '-' || ch === '\\') {             // deselect the default
                if (!deselected) { deselected = true; break; }
                continue;
            }
            if (MENU_CMDS.includes(ch)) continue;       // no-op on a 1-page PICK_ONE
            // not in resp: tty_nhbell() and read the next key
        }
        if (ch === '-' || ch === '\\') continue;         // redraw with '-' marker
        if (ch === sel[1]) { // ':' look inside
            if (!box.cknown) used = 1; // gaining info costs a turn
            render_container_contents(box);
            // C ref: process_text_window() -> dmore(cw, quitchars): only
            // " \r\n\033" dismiss the contents window.
            for (;;) {
                const k = await nhgetch();
                const kc = (k === 27) ? '\x1b' : String.fromCharCode(k);
                if (kc === ' ' || kc === '\r' || kc === '\n' || kc === '\x1b') break;
            }
            continue;
        }
        // C ref: '\033' cancels (select_menu -> -1 -> 'q'); ' ', '\n' and '\r'
        // commit the pre-selected default entry, which is 'n' when there is
        // another container and 'q' otherwise.
        if (ch === '\x1b') c = 'q';
        else if (ch === ' ' || ch === '\n' || ch === '\r') c = more_containers ? sel[7] : sel[8];
        else c = ch;
        break;
    }
    // Map the chosen accelerator back to the canonical loot action.  The menu is
    // rendered with the same accelerators (lootabc's a/b/c/d/e or the mnemonic
    // o/i/b/r/s), and the picked slot maps to lootchars[slot].  C ref: pickup.c
    // in_or_out_menu() return -> use_container() c.
    const lootchars = '_:oibrsnq';
    const idx = sel.indexOf(c);
    const action = idx >= 1 ? lootchars[idx] : 'q';
    // C ref: use_container() loot_out/loot_in/loot_in_first.  'r' is "both
    // reversed", so its put-in half runs FIRST.
    const loot_out = (action === 'o' || action === 'b' || action === 'r');
    const loot_in = (action === 'i' || action === 'b' || action === 'r');
    const loot_in_first = (action === 'r');
    // C ref: use_container() emptymsg — Ysimple_name2(): "Your bag" for a
    // carried container, "The chest" for one on the floor.
    const emptymsg = `${held ? 'Your' : 'The'} ${box_basename(box.otyp)} is empty.`;
    const do_out = async () => {
        if (box.cobj && box.cobj.length) {
            if (await menu_loot_out(box)) used = 1;
        } else {
            // C ref: use_container() — Has_contents() false: pline1(emptymsg)
            // ("The <box> is empty."); gaining that info costs a turn the first
            // time (cknown was false), then cknown is set.
            if (!box.cknown) used = 1;
            await pline(emptymsg);
            box.cknown = 1;
        }
    };
    if (loot_out && !loot_in_first) await do_out();
    if (loot_in) {
        if (await menu_loot_in(box)) used = 1;
    }
    if (loot_out && loot_in_first) await do_out();
    // C ref: use_container() `containerdone:` — anything actually done reveals
    // the contents, which is what makes doname() start saying "containing N".
    if (used) box.cknown = 1;
    delete game._modal_screen;
    return used ? 1 : 0;
}

// C ref: options.c def_inv_order[] — the default packorder (sortpack) sequence
// used to group objects by class in loot/inventory menus.
const DEFAULT_INV_ORDER = [12, 5, 2, 3, 7, 9, 10, 8, 4, 11, 6, 13, 14, 15, 16];

// C ref: drawing.c def_oc_syms[].sym, indexed by oclass — every add_menu() in
// pickup.c's class/item menus passes this as the entry's GROUP accelerator.
const DEF_OC_SYMS = [
    '\0', ']', ')', '[', '=', '"', '(', '%', '!', '?',
    '+', '/', '$', '*', '`', '0', '_', '.',
];

// process_menu_window auto-accelerator advance: 'a'..'z' then 'A'..'Z'.
function nextMenuCh(ch) {
    if (ch === 'z') return 'A';
    if (ch === 'Z') return 'a';
    return String.fromCharCode(ch.charCodeAt(0) + 1);
}

// A PICK_ANY menu item line: "<accel> <sel> <text>", where the selection
// indicator is '-' (off) or '+' (on; C uses '#' for a counted pick, not reached
// here).  C ref: wintty.c tty_add_menu "%c - " + set_item_state.
function menuItemLine(it) {
    return `${it.letter} ${it.selected ? '+' : '-'} ${it.desc}`;
}

// C ref: mkobj.c add_to_container() merges compatible stacks as items are placed;
// the JS container fill leaves them separate.  Fold mergeable stacks (e.g. two
// gold piles) so the item menu and take-out messages present one stack per type.
function consolidate_container(box) {
    const src = box.cobj || [];
    const out = [];
    for (const o of src) {
        let hit = null;
        for (const s of out) if (mergable(s, o)) { hit = s; break; }
        if (hit) { hit.quan = (hit.quan || 1) + (o.quan || 1); hit.owt = weight(hit); }
        else out.push(o);
    }
    box.cobj = out;
}

// Shared PICK_ANY selection loop for the loot menus.  Renders the current
// selection state, reads one key, applies a menu command (invert/select/deselect
// all) or toggles the matching accelerator, and repeats until <return>/space
// (confirm) or ESC (cancel).  Returns the selected items, or null on cancel.
// C ref: wintty.c process_menu_window() + set_all/unset_all/invert_all with the
// default menuinvertmode 1 (SKIPINVERT entries never bulk-select, only deselect).
async function run_pickany_menu(items, buildLines) {
    // menuitem_invert_test(mode 0) under menuinvertmode 1: non-SKIPINVERT items
    // always toggle; SKIPINVERT items toggle only when already selected.
    const invert_ok = (it) => !it.skipinvert || it.selected;
    for (;;) {
        const lines = buildLines();
        let maxcol = '(end) '.length;
        for (const ln of lines) maxcol = Math.max(maxcol, ln.text.length + 2);
        draw_corner_window(lines, maxcol, '(end)', 1);
        const key = await nhgetch();
        if (key === 27) return null;             // ESC: cancel
        if (key === 13 || key === 10) break;     // <return>: confirm
        const ch = String.fromCharCode(key);
        if (ch === ' ') break;                   // single-page: space confirms
        if (ch === '@') {                        // menu_invert_all
            for (const it of items) if (invert_ok(it)) it.selected = !it.selected;
            continue;
        }
        if (ch === '.') {                        // menu_select_all
            for (const it of items) if (!it.skipinvert) it.selected = true;
            continue;
        }
        if (ch === '-') {                        // menu_deselect_all
            for (const it of items) it.selected = false;
            continue;
        }
        // C ref: wintty.c process_menu_window() — the gacc[] test runs BEFORE
        // the per-item selector scan, so a key that is some item's GROUP
        // accelerator inverts that whole group (invert_all(acc)).  A group
        // accelerator equal to its own item's selector is excluded from gacc,
        // except GOLD_SYM.  Without this, '$' on the "Put in what type of
        // objects?" menu (selector 'b', group '$') selected nothing.
        const gacc = new Set();
        for (const it of items)
            if (it.groupacc && (it.groupacc !== it.letter || it.groupacc === '$'))
                gacc.add(it.groupacc);
        if (gacc.has(ch)) {
            for (const it of items) if (it.groupacc === ch) it.selected = !it.selected;
            continue;
        }
        const hit = items.find((it) => it.letter === ch);
        if (hit) hit.selected = !hit.selected;   // accelerator toggle
        // any other key: ignored (PICK_ANY keeps waiting)
    }
    return items.filter((it) => it.selected);
}

// C ref: pickup.c query_category() for menustyle:Full — the "Take out what type
// of objects?" class-filter menu.  Returns the picked tokens ('A' auto, 'ALL'
// all-types, or oclass numbers / 'B'/'C'/'U'/'X' BUC classes), or null on ESC.
async function query_category_take_out(box) {
    const cobj = box.cobj || [];
    const order = game?.flags?.inv_order || DEFAULT_INV_ORDER;
    const presentClasses = order.filter((oc) => cobj.some((o) => o.oclass === oc));
    const ccount = presentClasses.length;

    // C count_buc(): gold counts as Uncursed (or Unknown when goldX), other
    // items by bknown/blessed/cursed.
    const goldX = !!(game?.flags?.goldX);
    const bucCount = (type) => {
        let n = 0;
        for (const o of cobj) {
            if (o.oclass === COIN_CLASS) { if (type === (goldX ? 'X' : 'U')) n++; continue; }
            const actual = !o.bknown ? 'X' : o.blessed ? 'B' : o.cursed ? 'C' : 'U';
            if (actual === type) n++;
        }
        return n;
    };
    const do_blessed = bucCount('B') > 0, do_cursed = bucCount('C') > 0;
    const do_uncursed = bucCount('U') > 0, do_unknown = bucCount('X') > 0;
    const anyBUC = do_blessed || do_cursed || do_uncursed || do_unknown;
    const num_buc_types = [do_blessed, do_cursed, do_uncursed, do_unknown].filter(Boolean).length;

    // C query_category(): "no point in actually showing a menu for a single
    // category" — when the container holds exactly one object class (and no
    // unpaid items / ambiguous BUC split), silently pick that class without
    // drawing the type-selection menu at all.
    if (ccount === 1 && count_unpaid(cobj) === 0 && num_buc_types <= 1) {
        return [presentClasses[0]];
    }
    const show_a = ccount > 1; // ALL_TYPES entry only when >1 class

    const items = []; // {letter, token, skipinvert, selected, desc}
    items.push({ letter: 'A', token: 'A', skipinvert: true, selected: false,
                 desc: 'Auto-select every relevant item' });
    if (show_a) items.push({ letter: 'a', token: 'ALL', skipinvert: true, selected: false,
                             desc: 'All types' });
    let invlet = 'b';
    for (const oc of presentClasses) {
        items.push({ letter: invlet, token: oc, skipinvert: false, selected: false,
                     groupacc: DEF_OC_SYMS[oc], desc: let_to_name(oc, false, false) });
        invlet = nextMenuCh(invlet);
    }
    if (do_blessed) items.push({ letter: 'B', token: 'B', skipinvert: true, selected: false, desc: 'Items known to be Blessed' });
    if (do_cursed) items.push({ letter: 'C', token: 'C', skipinvert: true, selected: false, desc: 'Items known to be Cursed' });
    if (do_uncursed) items.push({ letter: 'U', token: 'U', skipinvert: true, selected: false, desc: 'Items known to be Uncursed' });
    if (do_unknown) items.push({ letter: 'X', token: 'X', skipinvert: true, selected: false, desc: 'Items of unknown Bless/Curse status' });

    const buildLines = () => {
        const lines = [{ text: 'Take out what type of objects?', attr: ATR_INVERSE }, { text: '' }];
        let k = 0;
        lines.push({ text: menuItemLine(items[k++]) }); // 'A'
        // The hint always shows (cmdassist defaults On); C: A_first_hint/cmdassist.
        lines.push({ text: '    (ignored unless some other choices are also picked)' });
        lines.push({ text: '' });
        if (show_a) lines.push({ text: menuItemLine(items[k++]) });         // 'a'
        for (let c = 0; c < presentClasses.length; c++) lines.push({ text: menuItemLine(items[k++]) });
        if (anyBUC) lines.push({ text: '' });                              // blank before B/C/U/X
        for (; k < items.length; k++) lines.push({ text: menuItemLine(items[k]) });
        return lines;
    };

    const picked = await run_pickany_menu(items, buildLines);
    if (picked === null) return null;
    return picked.map((it) => it.token);
}

// C ref: pickup.c query_objlist() (via menu_loot) — the "Take out what?" item
// menu, grouped by class with inverse headings.  Gold takes the '$' accelerator;
// the rest auto-letter a,b,c...  Returns the chosen objects (menu order), or null
// on ESC.
async function query_objlist_take_out(box, allow) {
    const cobj = box.cobj || [];
    const items = [];      // {letter, obj, selected, skipinvert, desc}
    const linePlan = [];   // {type:'header'|'item', ...}
    let menu_ch = 'a', first = true;
    // C ref: pickup.c query_objlist() sortflags = INVORDER_SORT with the
    // default sortloot='loot'/sortpack=on options -> sortloot(SORTLOOT_LOOT |
    // SORTLOOT_PACK) — group by class in packorder, alphabetized within class
    // (not raw cobj/creation order).
    const sorted = sortloot(cobj, SORTLOOT_LOOT | SORTLOOT_PACK, false, allow);
    let curClass = null;
    for (const sli of sorted) {
        if (!sli.obj) break;
        const o = sli.obj;
        if (o.oclass !== curClass) {
            curClass = o.oclass;
            linePlan.push({ type: 'header', text: let_to_name(curClass, false, false) });
        }
        let letter;
        if (first && o.oclass === COIN_CLASS) letter = '$';        // C: first && COIN -> '$'
        else { letter = menu_ch; menu_ch = nextMenuCh(menu_ch); }
        first = false;
        const it = { letter, obj: o, selected: false, skipinvert: false,
                     groupacc: DEF_OC_SYMS[o.oclass], desc: obj_doname(o) };
        items.push(it);
        linePlan.push({ type: 'item', item: it });
    }
    const buildLines = () => {
        const lines = [{ text: 'Take out what?', attr: ATR_INVERSE }, { text: '' }];
        for (const p of linePlan) {
            if (p.type === 'header') lines.push({ text: p.text, attr: ATR_INVERSE });
            else lines.push({ text: menuItemLine(p.item) });
        }
        return lines;
    };
    const picked = await run_pickany_menu(items, buildLines);
    if (picked === null) return null;
    return picked.map((it) => it.obj);
}

// C ref: pickup.c query_category(qflags = WORN_TYPES|ALL_TYPES|UNPAID_TYPES|
// BUCX_TYPES) as called by do_wear.c menu_remarm() — the 'A' class filter.
// WORN_TYPES sets ofilter = is_worn, so only worn/wielded items contribute the
// class list AND the BUC counts.  CHOOSE_ALL is NOT passed, so there is no 'A'
// auto-select entry and no hint line.
async function query_category_takeoff() {
    const worn = inventoryArray().filter(is_worn);
    const order = game?.flags?.inv_order || DEFAULT_INV_ORDER;
    const presentClasses = order.filter((oc) => worn.some((o) => o.oclass === oc));
    const ccount = presentClasses.length;

    const goldX = !!(game?.flags?.goldX);
    const bucCount = (type) => worn.filter((o) => (o.oclass === COIN_CLASS)
        ? type === (goldX ? 'X' : 'U')
        : type === (!o.bknown ? 'X' : o.blessed ? 'B' : o.cursed ? 'C' : 'U')).length;
    const do_blessed = bucCount('B') > 0, do_cursed = bucCount('C') > 0;
    const do_uncursed = bucCount('U') > 0, do_unknown = bucCount('X') > 0;
    const num_buc_types = [do_blessed, do_cursed, do_uncursed, do_unknown].filter(Boolean).length;
    // pickup.c query_category: `(qflags & UNPAID_TYPES) && count_unpaid(olist)`
    // — count_unpaid is NOT passed the ofilter, so it scans the WHOLE pack, not
    // just the worn subset.
    const do_unpaid = count_unpaid(inventoryArray()) > 0;

    // C: "no point in actually showing a menu for a single category".
    if (ccount === 1 && !do_unpaid && num_buc_types <= 1)
        return [presentClasses[0]];

    const show_a = ccount > 1;
    const items = [];
    if (show_a) items.push({ letter: 'a', token: 'ALL', skipinvert: true, selected: false,
                             desc: 'All worn and wielded types' });
    let invlet = show_a ? 'b' : 'a';
    for (const oc of presentClasses) {
        items.push({ letter: invlet, token: oc, skipinvert: false, selected: false,
                     groupacc: DEF_OC_SYMS[oc], desc: let_to_name(oc, false, false) });
        invlet = nextMenuCh(invlet);
    }
    // pickup.c: the unpaid entry precedes the b/u/c/unknown cluster, and the
    // blank separator is emitted when ANY of them is present.
    const bucItems = [];
    if (do_unpaid) bucItems.push(['u', 'Unpaid items']);
    if (do_blessed) bucItems.push(['B', 'Items known to be Blessed']);
    if (do_cursed) bucItems.push(['C', 'Items known to be Cursed']);
    if (do_uncursed) bucItems.push(['U', 'Items known to be Uncursed']);
    if (do_unknown) bucItems.push(['X', 'Items of unknown Bless/Curse status']);
    for (const [ltr, desc] of bucItems)
        items.push({ letter: ltr, token: ltr, skipinvert: true, selected: false, desc });

    const nClassEntries = items.length - bucItems.length;
    const buildLines = () => {
        const lines = [{ text: 'What type of things do you want to take off?', attr: ATR_INVERSE },
                       { text: '' }];
        for (let k = 0; k < nClassEntries; k++) lines.push({ text: menuItemLine(items[k]) });
        if (bucItems.length) lines.push({ text: '' });
        for (let k = nClassEntries; k < items.length; k++) lines.push({ text: menuItemLine(items[k]) });
        return lines;
    };
    const picked = await run_pickany_menu(items, buildLines);
    if (picked === null) return null;
    return picked.map((it) => it.token);
}

// C ref: pickup.c query_objlist("What do you want to take off?", invent,
// SIGNAL_NOMENU|USE_INVLET|INVORDER_SORT, PICK_ANY, filter).  USE_INVLET means
// the accelerators are the objects' own inventory letters.
async function query_objlist_takeoff(allow) {
    const items = [], linePlan = [];
    const sorted = sortloot(inventoryArray(), SORTLOOT_INVLET | SORTLOOT_PACK, false, allow);
    let curClass = null;
    for (const sli of sorted) {
        if (!sli.obj) break;
        const o = sli.obj;
        if (o.oclass !== curClass) {
            curClass = o.oclass;
            linePlan.push({ type: 'header', text: let_to_name(curClass, false, false) });
        }
        const it = { letter: o.invlet, obj: o, selected: false, skipinvert: false, desc: obj_doname(o) };
        items.push(it);
        linePlan.push({ type: 'item', item: it });
    }
    if (!items.length) return [];
    const buildLines = () => {
        const lines = [{ text: 'What do you want to take off?', attr: ATR_INVERSE }, { text: '' }];
        for (const p of linePlan) {
            if (p.type === 'header') lines.push({ text: p.text, attr: ATR_INVERSE });
            else lines.push({ text: menuItemLine(p.item) });
        }
        return lines;
    };
    const picked = await run_pickany_menu(items, buildLines);
    if (picked === null) return null;
    return picked.map((it) => it.obj);
}

// C ref: do_wear.c doddoremarm() — the 'A' (#takeoffall) command with the
// default menustyle:Full, i.e. menu_remarm(0): a class-filter menu, then an item
// menu, then take_off().  NOT ported: take_off()'s multi-turn disrobing
// occupation (per-item oc_delay) — the selected items come off on this command's
// own turn instead.  Rendering both menus is what keeps their keystrokes out of
// the command parser.
export async function doddoremarm() {
    const g = game;
    if (!g.uwep && !g.uswapwep && !g.uquiver && !g.uamul && !g.ublindf
        && !g.uleft && !g.uright && !wearing_armor()) {
        await pline('You are not wearing anything.');
        return 0;
    }
    const picks = await query_category_takeoff();
    if (!picks || !picks.length) { await dismiss_invent_screen(); return 0; }

    let all_worn_categories = false;
    const validClasses = new Set(), bucFilters = new Set();
    for (const p of picks) {
        if (p === 'ALL') all_worn_categories = true;
        else if (typeof p === 'number') validClasses.add(p);
        else bucFilters.add(p);
    }
    // C: a BUC pick clears all_worn_categories (is_worn_by_type applies both).
    if (bucFilters.size) all_worn_categories = false;
    const bucOf = (o) => (o.oclass === COIN_CLASS ? (game?.flags?.goldX ? 'X' : 'U')
        : !o.bknown ? 'X' : o.blessed ? 'B' : o.cursed ? 'C' : 'U');
    const allow = (o) => is_worn(o)
        && (all_worn_categories
            || ((!validClasses.size || validClasses.has(o.oclass))
                && (!bucFilters.size || bucFilters.has(bucOf(o)))));

    const chosen = await query_objlist_takeoff(allow);
    if (chosen === null || !chosen.length) { await dismiss_invent_screen(); return 0; }
    await dismiss_invent_screen();
    for (const obj of chosen) await takeoff_worn_obj(obj);
    // C: takeoff.disrobing is "disarming" when only weapon slots are involved.
    await pline(`You finish ${chosen.some((o) => !((o.owornmask || 0) & WEAPON_SLOT_MASK))
        ? 'disrobing' : 'disarming'}.`);
    return 0; /* ECMD_OK: take_off() accounts for the time itself */
}
// Worn-mask bits for the three weapon slots (js/invent.js QW_* convention).
const WEAPON_SLOT_MASK = 0x100 | 0x200 | 0x400;

// C ref: pickup.c menu_loot(retry=0, put_in=FALSE) for menustyle:Full — pick the
// object classes ("Take out what type of objects?"), then the items ("Take out
// what?"), then out_container() each.  Returns the number removed (>0 => a turn
// elapsed).
async function menu_loot_out(box) {
    consolidate_container(box);

    const picks = await query_category_take_out(box);
    if (!picks || picks.length === 0) return 0;

    let autopick = false, all_categories = false;
    const validClasses = new Set();
    for (const p of picks) {
        if (p === 'A') autopick = true;
        else if (p === 'ALL') all_categories = true;
        else if (typeof p === 'number') validClasses.add(p);
        // 'B'/'C'/'U'/'X' BUC filters are not reached by the recorded sessions;
        // treat them as no additional class filter (fall through to item menu).
    }
    const allow = (autopick || all_categories)
        ? () => true
        : (o) => validClasses.has(o.oclass);

    let chosen;
    if (autopick) {
        chosen = (box.cobj || []).filter(allow);
    } else {
        chosen = await query_objlist_take_out(box, allow);
        if (chosen === null) return 0; // ESC cancelled
    }
    if (!chosen.length) return 0;

    // Take-out messages page with --More-- over the MAP (not the menu), so drop
    // the corner-menu overlay and start the topline fresh.  C ref: out_container
    // -> pickup_prinv -> prinv -> pline (update_topl accumulation + more()).
    delete game._modal_screen;
    game._pending_message = '';
    game._toplin = 0;
    let n = 0;
    for (const obj of chosen) {
        const i = (box.cobj || []).indexOf(obj);
        if (i < 0) continue;
        const count = obj.quan;
        box.cobj.splice(i, 1);
        obj.where = 'free';
        box.owt = weight(box);
        const otmp = addinv(obj);
        await report_merge_discovery();
        // No encumbrance change here, so pickup_prinv's load prefix is absent.
        // prinv_fmt() renders "<letter> - <name>." without touching the topline
        // state; update_topl does the emit so successive lines accumulate/page.
        await update_topl(prinv_fmt(null, otmp, count));
        n++;
    }
    return n;
}

// C ref: pickup.c query_category() for menustyle:Full, put_in side — the "Put
// in what type of objects?" class menu over INVENTORY.  menu_loot() passes
// ALL_TYPES|UNPAID_TYPES|BUCX_TYPES|CHOOSE_ALL|JUSTPICKED, so this one also
// carries the trailing 'P' ("Just picked up: ...") entry that the take-out side
// has no flag for.  Returns the picked tokens, or null on ESC.
async function query_category_put_in() {
    const inv = inventoryArray();
    const order = game?.flags?.inv_order || DEFAULT_INV_ORDER;
    const presentClasses = order.filter((oc) => inv.some((o) => o.oclass === oc));
    const ccount = presentClasses.length;

    const goldX = !!(game?.flags?.goldX);
    const bucCount = (type) => {
        let n = 0;
        for (const o of inv) {
            if (o.oclass === COIN_CLASS) { if (type === (goldX ? 'X' : 'U')) n++; continue; }
            const actual = !o.bknown ? 'X' : o.blessed ? 'B' : o.cursed ? 'C' : 'U';
            if (actual === type) n++;
        }
        return n;
    };
    const do_blessed = bucCount('B') > 0, do_cursed = bucCount('C') > 0;
    const do_uncursed = bucCount('U') > 0, do_unknown = bucCount('X') > 0;
    const anyBUC = do_blessed || do_cursed || do_uncursed || do_unknown;
    const num_buc_types = [do_blessed, do_cursed, do_uncursed, do_unknown].filter(Boolean).length;
    // C ref: pickup.c count_justpicked()/find_justpicked() — obj->pickup_prev.
    const justpicked = inv.filter((o) => o.pickup_prev);

    if (ccount === 1 && count_unpaid(inv) === 0 && num_buc_types <= 1
        && justpicked.length === 0) {
        return [presentClasses[0]];
    }
    const show_a = ccount > 1;

    const items = [];
    items.push({ letter: 'A', token: 'A', skipinvert: true, selected: false,
                 desc: 'Auto-select every relevant item' });
    if (show_a) items.push({ letter: 'a', token: 'ALL', skipinvert: true, selected: false,
                             desc: 'All types' });
    let invlet = 'b';
    for (const oc of presentClasses) {
        items.push({ letter: invlet, token: oc, skipinvert: false, selected: false,
                     groupacc: DEF_OC_SYMS[oc], desc: let_to_name(oc, false, false) });
        invlet = nextMenuCh(invlet);
    }
    if (do_blessed) items.push({ letter: 'B', token: 'B', skipinvert: true, selected: false, desc: 'Items known to be Blessed' });
    if (do_cursed) items.push({ letter: 'C', token: 'C', skipinvert: true, selected: false, desc: 'Items known to be Cursed' });
    if (do_uncursed) items.push({ letter: 'U', token: 'U', skipinvert: true, selected: false, desc: 'Items known to be Uncursed' });
    if (do_unknown) items.push({ letter: 'X', token: 'X', skipinvert: true, selected: false, desc: 'Items of unknown Bless/Curse status' });
    if (justpicked.length) {
        items.push({ letter: 'P', token: 'P', skipinvert: true, selected: false,
                     desc: justpicked.length === 1
                         ? `Just picked up: ${obj_doname(justpicked[0])}`
                         : 'Items you just picked up' });
    }

    const buildLines = () => {
        const lines = [{ text: 'Put in what type of objects?', attr: ATR_INVERSE }, { text: '' }];
        let k = 0;
        lines.push({ text: menuItemLine(items[k++]) }); // 'A'
        lines.push({ text: '    (ignored unless some other choices are also picked)' });
        lines.push({ text: '' });
        if (show_a) lines.push({ text: menuItemLine(items[k++]) });
        for (let c = 0; c < presentClasses.length; c++) lines.push({ text: menuItemLine(items[k++]) });
        if (anyBUC || justpicked.length) lines.push({ text: '' });
        for (; k < items.length; k++) lines.push({ text: menuItemLine(items[k]) });
        return lines;
    };

    const picked = await run_pickany_menu(items, buildLines);
    if (picked === null) return null;
    return picked.map((it) => it.token);
}

// C ref: pickup.c query_objlist() (via menu_loot put_in) — the "Put in what?"
// item menu over inventory.  menu_loot passes USE_INVLET with the default
// invlet_constant option, so the accelerator IS the object's inventory letter
// (gold's '$'), not a fresh a,b,c... run.
async function query_objlist_put_in(allow) {
    const inv = inventoryArray();
    const items = [];
    const linePlan = [];
    const sorted = sortloot(inv, SORTLOOT_LOOT | SORTLOOT_PACK, false, allow);
    let curClass = null;
    for (const sli of sorted) {
        if (!sli.obj) break;
        const o = sli.obj;
        if (o.oclass !== curClass) {
            curClass = o.oclass;
            linePlan.push({ type: 'header', text: let_to_name(curClass, false, false) });
        }
        const it = { letter: o.invlet, obj: o, selected: false, skipinvert: false,
                     groupacc: DEF_OC_SYMS[o.oclass], desc: obj_doname(o) };
        items.push(it);
        linePlan.push({ type: 'item', item: it });
    }
    const buildLines = () => {
        const lines = [{ text: 'Put in what?', attr: ATR_INVERSE }, { text: '' }];
        for (const p of linePlan) {
            if (p.type === 'header') lines.push({ text: p.text, attr: ATR_INVERSE });
            else lines.push({ text: menuItemLine(p.item) });
        }
        return lines;
    };
    const picked = await run_pickany_menu(items, buildLines);
    if (picked === null) return null;
    return picked.map((it) => it.obj);
}

// C ref: pickup.c menu_loot(retry=0, put_in=TRUE) for menustyle:Full — the
// class menu, then the item menu, then in_container() each.  Returns the number
// inserted (>0 => the command elapses a turn).
async function menu_loot_in(box) {
    const picks = await query_category_put_in();
    if (!picks || picks.length === 0) return 0;

    let autopick = false, all_categories = false, loot_justpicked = false;
    const validClasses = new Set();
    for (const p of picks) {
        if (p === 'A') autopick = true;
        else if (p === 'P') { loot_justpicked = true; autopick = false; }
        else if (p === 'ALL') all_categories = true;
        else if (typeof p === 'number') { validClasses.add(p); autopick = false; }
    }
    const allow = (autopick || all_categories)
        ? () => true
        : (o) => validClasses.has(o.oclass) || (loot_justpicked && !!o.pickup_prev);

    let chosen;
    if (autopick) {
        chosen = inventoryArray().filter(allow);
    } else if (loot_justpicked && validClasses.size === 0
               && inventoryArray().filter((o) => o.pickup_prev).length === 1) {
        // C: the lone just-picked item goes in without an item menu.
        chosen = inventoryArray().filter((o) => o.pickup_prev);
    } else {
        chosen = await query_objlist_put_in(allow);
        if (chosen === null) return 0;
    }
    if (!chosen.length) return 0;

    // The put-in messages page over the MAP, not the menu.
    delete game._modal_screen;
    game._pending_message = '';
    game._toplin = 0;
    const { in_container } = await import('./pickup.js');
    game._pickup = game._pickup || {};
    const saved = game._pickup.current_container;
    game._pickup.current_container = box;
    let n = 0;
    for (const obj of chosen) {
        if (!game._pickup.current_container) break;
        const res = await in_container(obj);
        if (res < 0) break;
        n += res;
    }
    game._pickup.current_container = saved;
    return n;
}

// C ref: apply.c doapply()'s SACK/OILSKIN_SACK/BAG_OF_HOLDING arm —
// use_container(&obj, TRUE, FALSE) on a CARRIED container.
export async function use_container_held(obj) {
    return await use_container(obj, false, true);
}

// C ref: lock.c autokey(opening=TRUE) — pick an unlocking tool from inventory:
// skeleton key, else lock pick, else credit card.  (The quest-artifact
// preference ordering is irrelevant for the starter inventory.)
function autokey_unlock() {
    const inv = Array.isArray(game.invent) ? game.invent : [];
    let key = null, pick = null, card = null;
    for (const o of inv) {
        if (o.otyp === SKELETON_KEY && !key) key = o;
        else if (o.otyp === LOCK_PICK && !pick) pick = o;
        else if (o.otyp === CREDIT_CARD && !card) card = o;
    }
    return key || pick || card || null;
}

// C ref: lock.c lock_action() — the "-ing" phrase naming the current lock
// activity, chosen from the target's state and the tool.  A locked box picked
// with a lock pick / credit card yields "picking the lock".
function lock_action(xl) {
    const box = xl.box;
    if (box && !box.olocked)
        return box.otyp === CHEST_OTYP ? 'locking the chest' : 'locking the box';
    if (xl.picktyp === LOCK_PICK || xl.picktyp === CREDIT_CARD)
        return 'picking the lock';
    if (box)
        return box.otyp === CHEST_OTYP ? 'unlocking the chest' : 'unlocking the box';
    return 'picking the lock';
}

// C ref: lock.c pick_lock() — the autounlock box branch (rx/container supplied,
// so no direction prompt).  Under the default AUTOUNLOCK_APPLY_KEY it prompts
// "Unlock it with <yname(tool)>?" and, on 'y', sets up the lock-picking
// occupation.  The success chance (box branch): LOCK_PICK 4*DEX+25*rogue,
// SKELETON_KEY 75+DEX, CREDIT_CARD DEX+20*rogue, halved if the box is cursed.
// Returns 1 (PICKLOCK_DID_SOMETHING, occupation started) on 'y', else 0
// (PICKLOCK_DID_NOTHING, declined -> no time passes).
async function pick_lock_box(pick, box) {
    const picktyp = pick.otyp;
    // yname(uncursed lock pick) -> "your lock pick"; skeleton key -> "your key".
    const toolname = picktyp === LOCK_PICK ? 'your lock pick'
                   : picktyp === SKELETON_KEY ? 'your key'
                   : picktyp === CREDIT_CARD ? 'your credit card'
                   : 'your tool';
    // ynq(): the "Hmmm... turns out to be locked." topline is still pending, so
    // it is paged with --More-- before the prompt is drawn.
    game._yn_need_more = true;
    const c = await y_n(`Unlock it with ${toolname}?`, 'ynq\x1b', 'q');
    if (c !== 'y')
        return 0; // PICKLOCK_DID_NOTHING (c == 'q'/'n'/ESC)

    const isRogue = (game.urole?.mnum === PM_ROGUE);
    let ch;
    switch (picktyp) {
    case CREDIT_CARD:  ch = ACURR(A_DEX) + 20 * (isRogue ? 1 : 0); break;
    case LOCK_PICK:    ch = 4 * ACURR(A_DEX) + 25 * (isRogue ? 1 : 0); break;
    case SKELETON_KEY: ch = 75 + ACURR(A_DEX); break;
    default:           ch = 0;
    }
    if (box.cursed) ch = Math.trunc(ch / 2);

    // C: svc.context.move = 0; gx.xlock.{box,chance,picktyp,usedtime,magic_key}.
    // The move loop then runs picklock() each turn (do_occupation).
    game.xlock = {
        box,
        door: null,
        chance: ch,
        picktyp,
        usedtime: 0,
        magic_key: false, // is_magic_key(): a plain lock pick is not the MKoT
    };
    game._picklock_box = box;
    return 1; // PICKLOCK_DID_SOMETHING — a turn elapses
}

// C ref: pickup.c doloot()/do_loot_cont().  Floor container under the hero:
// locked -> announce the lock, then attempt the default autounlock
// (AUTOUNLOCK_APPLY_KEY): pick an unlocking tool and run pick_lock(); unlocked
// -> use_container().
async function doloot() {
    // C ref: pickup.c doloot_core():2194 — check_capacity((char *) 0) runs
    // FIRST: an Overtaxed hero "can't do that while carrying so much stuff"
    // and no turn passes (so the container prompts never appear).
    {
        const { check_capacity_throw } = await import('./invent.js');
        if (await check_capacity_throw()) return 0; // ECMD_OK
    }
    // C ref: pickup.c doloot():2198 — a handless polyform can't loot at all.
    // Skipping this opened the container menu, which then ate the keystrokes
    // C hands to the command parser.
    // Only consult the form while polymorphed: an unpolymorphed hero's
    // u.umonnum is this port's ROLE index, not a mons[] pmidx (every player
    // monster has hands anyway, so C's answer is FALSE either way).
    const { nohands } = await import('./monflags_data.js');
    const ydata = game.u?.Upolyd ? (game.u?.data || null) : null;
    if (ydata && nohands(ydata)) {
        await pline('You have no hands!');
        return 0; // ECMD_OK
    }
    const box = floor_box_here();
    if (!box) {
        // C ref: pickup.c:2295-2341 doloot_core(), label `lootmon:` — when
        // mon_beside() finds a monster in the 3x3 box (pickup.c:2071) C prompts
        // "Loot in what direction?" via get_adjacent_loc() and that getdir()
        // EATS the following keystrokes.  Skipping the branch let them fall
        // through to rhack() and run a phantom command (a whole game turn).
        const u = game.u;
        let beside = false;
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
            const nx = u.ux + i, ny = u.uy + j;
            if (isok(nx, ny) && m_at(nx, ny)) beside = true;
        }
        if (beside) {
            const { getdir } = await import('./cmd.js');
            const dir = await getdir('Loot in what direction?');
            if (!dir) { await pline('Never mind.'); return 0; }
            const cx = u.ux + dir.dx, cy = u.uy + dir.dy;
            if (!isok(cx, cy)) { await pline('Invalid loot location'); return 0; }
            const underfoot = (cx === u.ux && cy === u.uy);
            await pline(`You don't find anything ${!underfoot ? 't' : ''}here to loot.`);
            return 0;
        }
        await pline("You don't find anything here to loot.");
        return 0;
    }
    if (box.olocked) {
        const name = box_basename(box.otyp);
        if (box.lknown) await pline(`The ${name} is locked.`);
        else await pline(`Hmmm, the ${name} turns out to be locked.`);
        box.lknown = 1;
        // flags.autounlock defaults to AUTOUNLOCK_APPLY_KEY: find an unlocking
        // tool (autokey) and, if one is carried, attempt pick_lock() at the
        // hero's square (coords supplied -> no direction prompt).
        const unlocktool = autokey_unlock();
        if (unlocktool) {
            const r = await pick_lock_box(unlocktool, box);
            return r ? 1 : 0;
        }
        // no unlocking tool -> nothing further; no time passes.
        return 0;
    }
    box.lknown = 1;
    return await use_container(box, false);
}

// C ref: lock.c picklock() — the lock-picking occupation, run each turn from the
// move loop (do_occupation).  Returns 1 while still busy (keep the occupation),
// 0 when finished (success, give-up, or the box/hero moved).
export async function picklock() {
    const u = game.u;
    const xl = game.xlock;
    if (!xl || !xl.box) { game._picklock_box = null; game.xlock = null; return 0; }

    // you or the box moved -> abort (usedtime = 0), no message.
    if (xl.box.where !== 'floor' || xl.box.ox !== u.ux || xl.box.oy !== u.uy) {
        game._picklock_box = null; game.xlock = null; return 0;
    }
    // give-up check (usedtime >= 50 || nohands).  The starter hero has hands.
    if (xl.usedtime++ >= 50) {
        await update_topl(`You give up your attempt at ${lock_action(xl)}.`);
        exercise(A_DEX, true); // even if you don't succeed
        game._picklock_box = null; game.xlock = null; return 0;
    }

    // rn2(100) >= chance -> still busy (re-roll next turn).  C ref: lock.c:98.
    if (rn2(100) >= xl.chance)
        return 1;

    // (The Master-Key-of-Thievery trap-disarm branch is skipped: a plain lock
    // pick is not a magic key and the starter box is untrapped.)

    await pline(`You succeed in ${lock_action(xl)}.`);
    xl.box.olocked = !xl.box.olocked;
    xl.box.lknown = 1;
    // if (xl.box.otrapped) chest_trap(...) — chest traps are not modeled; the
    // starter box is untrapped so this path is inert.
    exercise(A_DEX, true); // -> rn2(19)
    game._picklock_box = null;
    game.xlock = null;
    return 0; // usedtime = 0
}

// C ref: obj.h is_weptool() / lock.c:660 u_have_forceable_weapon().
const WEAPON_CLASS_OC = 2, TOOL_CLASS_OC = 6, ROCK_CLASS_OC = 14;
const P_DAGGER_SK = 1, P_FLAIL_SK = 13, P_LANCE_SK = 19; // skills.h
function is_weptool_obj(o) {
    return !!o && o.oclass === TOOL_CLASS_OC && (objects[o.otyp]?.oc_skill ?? 0) !== 0;
}
function u_have_forceable_weapon() {
    const uwep = game.uwep;
    if (!uwep) return false;
    const sk = objects[uwep.otyp]?.oc_skill ?? 0;
    if ((uwep.oclass === WEAPON_CLASS_OC || is_weptool_obj(uwep))
        ? (sk < P_DAGGER_SK || sk === P_FLAIL_SK || sk > P_LANCE_SK)
        : uwep.oclass !== ROCK_CLASS_OC)
        return false;
    return true;
}

// C ref: include/obj.h is_blade()/is_pick() — the picktyp selector for #force.
// P_DAGGER..P_SABER is the blade span of skills.h; a pick-axe is excluded even
// though its oc_skill is inside no blade range (it is a WEAPON/TOOL test of its
// own).  Used to be hardcoded to 0 because the one recorded #force wielded a
// dwarvish spear; every blade-wielding hero took the wrong forcelock branch.
const P_SABER_SK = 9, P_PICK_AXE_SK = 4; // skills.h
function is_blade_obj(o) {
    if (!o || o.oclass !== WEAPON_CLASS_OC) return false;
    const sk = objects[o.otyp]?.oc_skill ?? 0;
    return sk >= P_DAGGER_SK && sk <= P_SABER_SK;
}
function is_pick_obj(o) {
    if (!o || (o.oclass !== WEAPON_CLASS_OC && o.oclass !== TOOL_CLASS_OC)) return false;
    return (objects[o.otyp]?.oc_skill ?? 0) === P_PICK_AXE_SK;
}
// C ref: include/obj.h greatest_erosion(otmp) — max(oeroded, oeroded2).
function greatest_erosion(o) {
    const a = o?.oeroded | 0, b = o?.oeroded2 | 0;
    return a > b ? a : b;
}

// C ref: lock.c doforce().  Prompts "There is <a locked box> here; force its
// lock? [ynq] (q)" for each Is_box() on the square; on 'y' announces the
// pry/bash line and begins the forcelock occupation (which elapses game turns
// via the move loop).
async function doforce() {
    const uwep = game.uwep;
    // C ref: lock.c doforce():684 — u.uswallow short-circuit.
    if (game.u?.uswallow) {
        await pline("You can't force anything from inside here.");
        return 0;
    }
    // C ref: lock.c:694 — the You_cant() phrase depends on WHY the weapon is
    // unusable; the no-weapon case reads "when not wielding a" (this always
    // said "without a proper", which is only the wrong-object-class wording).
    if (!u_have_forceable_weapon()) {
        const use_plural = !!(uwep && (uwep.quan || 1) > 1);
        const why = !uwep ? 'when not wielding a'
            : (uwep.oclass !== WEAPON_CLASS_OC && !is_weptool_obj(uwep))
                ? (use_plural ? 'without proper' : 'without a proper')
                : (use_plural ? 'with those' : 'with that');
        await pline(`You can't force anything ${why} weapon${use_plural ? 's' : ''}.`);
        return 0;
    }
    // C ref: lock.c doforce():706 — !can_reach_floor(TRUE) -> cant_reach_floor()
    // and no turn: a levitating hero can't get at a box on the floor.
    if (game.u?.uprops?.Levitation) {
        await pline(`You can't reach the ${surface(game.u.ux, game.u.uy)}.`);
        return 0;
    }

    const picktyp = (is_blade_obj(uwep) && !is_pick_obj(uwep)) ? 1 : 0;
    // C ref: lock.c doforce():726 — an interrupted force resumes where it left
    // off (same weapon kind) instead of re-prompting; the accumulated usedtime
    // carries over, so the 50-turn give-up budget is shared.
    const xl = game.xlock;
    if (xl && xl.usedtime && xl.box && picktyp === xl.picktyp) {
        await update_topl('You resume your attempt to force the lock.');
        game._force_box = xl.box;
        return 1;
    }
    game.xlock = null;

    let chosen = null;
    for (const box of floor_lockboxes_here()) {
        if (box.obroken || !box.olocked) {
            // C forces lknown=0 across doname() so the message isn't worded
            // redundantly ("a locked large box ... already unlocked"), then sets
            // it: the player has now learned the lock state either way.
            box.lknown = 0;
            await pline(`There is ${obj_doname(box)} here, but its lock is already ${box.obroken ? 'broken' : 'unlocked'}.`);
            box.lknown = 1;
            continue;
        }
        // C ref: lock.c doforce() — safe_qbuf(..., otmp, doname, ...) is built
        // BEFORE `otmp->lknown = 1`, so a box whose lock state the hero has not
        // learned yet is still just "a chest" in the question; only a box that
        // was already lknown reads "a locked chest".
        const qbuf = `There is ${obj_doname(box)} here; force its lock?`;
        box.lknown = 1;   /* set before ynq(), so 'n'/'q' still learns it */
        const c = await yn_function(qbuf, 'ynq', 'q');
        if (c === 'q') return 0;
        if (c === 'n') continue;
        // update_topl (not plain pline) so the message is left in NEED_MORE
        // state — the forcelock occupation's first message then pages it with
        // "--More--".
        await update_topl(picktyp
            ? `You force ${force_yname(uwep)} into a crack and pry.`
            : `You start bashing it with ${force_yname(uwep)}.`);
        // Begin the forcelock occupation (set_occupation(forcelock,...)).  C
        // ref: lock.c doforce(): chance = objects[uwep->otyp].oc_wldam * 2.
        // The forcelock() occupation then runs each turn from the move loop
        // (do_occupation), which checks rn2(100) >= chance.
        game.xlock = { box, chance: oc_wldam(uwep.otyp) * 2, picktyp, usedtime: 0, magic_key: false };
        chosen = box;
        break;
    }
    if (chosen) game._force_box = chosen;
    else await pline('You decide not to force the issue.');
    return 1; // ECMD_TIME — a turn elapses (the move loop advances monsters)
}

// yname for the wielded weapon in the force message: "your <weapon>".  The
// base type name comes from the objects table (objclass.h oc_name).
function force_yname(uwep) {
    // objects[].name is the bare oc_name; C's yname() -> xname() carries the
    // artifact/called name ("your Sting", "your +1 war hammer").
    if (uwep == null) return 'your weapon';
    return `your ${xname(uwep)}`;
}

// C ref: mon.c wake_nearby(FALSE) -> wake_nearto_core(u.ux, u.uy, ulevel*20,
// FALSE).  Wakes nearby monsters without angering them: clears msleeping and the
// 'meditation' STRAT_WAITMASK strategy.  No RNG.  (wake_msg prints "X wakes up."
// only for a *sleeping*, visible monster; the goblin here is already awake.)
function wake_nearby_force() {
    const u = game.u;
    if (!u) return;
    const dist = (u.ulevel || 1) * 20;
    const dist2 = (x1, y1, x2, y2) => (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
    for (const mtmp of (game.level?.monsters || [])) {
        if (mtmp.mhp != null && mtmp.mhp <= 0) continue;
        if (dist === 0 || dist2(mtmp.mx, mtmp.my, u.ux, u.uy) < dist) {
            mtmp.msleeping = 0;
            // wake 'meditation' (STRAT_WAITMASK) unless G_UNIQ; the starter
            // goblin/sewer rat are not unique.  mstrategy isn't otherwise
            // modelled; clearing a wait flag if present is harmless.
            if (mtmp.mstrategy != null) mtmp.mstrategy &= ~0x00ff0000; /* STRAT_WAITMASK */
        }
    }
}

// C ref: lock.c chest_shatter_msg(otmp) — the message when a forced-open chest's
// contents are destroyed.  The disposition depends on oc_material; a spellbook
// (PAPER) "is torn to shreds".  The name is the *blind* (unidentified) singular,
// e.g. "spellbook".  Potions instead announce "You see a <potion> shatter!".
// C ref: objclass.h material enum — WAX=2 VEGGY=3 FLESH=4 PAPER=5 WOOD=8 GLASS=19.
const MAT_WAX = 2, MAT_VEGGY = 3, MAT_FLESH = 4, MAT_PAPER = 5, MAT_WOOD = 8, MAT_GLASS = 19;
function chest_shatter_disposition(material) {
    switch (material) {
    case MAT_PAPER: return 'is torn to shreds';
    case MAT_WAX:   return 'is crushed';
    case MAT_VEGGY: return 'is pulped';
    case MAT_FLESH: return 'is mashed';
    case MAT_GLASS: return 'shatters';
    case MAT_WOOD:  return 'splinters to fragments';
    default:        return 'is destroyed';
    }
}
async function chest_shatter_msg(otmp) {
    const ocl = objects[otmp.otyp];
    // Blind/unidentified singular name (HBlinded=1 in C): a spellbook of an
    // undiscovered type reads simply "spellbook".
    let thing;
    if (otmp.oclass === 10 /*SPBOOK_CLASS*/) thing = 'spellbook';
    else if (otmp.oclass === 8 /*POTION_CLASS*/) thing = 'potion';
    else if (otmp.oclass === 9 /*SCROLL_CLASS (objclass.h); 7 is FOOD_CLASS*/) thing = 'scroll';
    else thing = ocl?.name || 'object';
    const disposition = chest_shatter_disposition(ocl?.material);
    // An()/An(thing): capitalised indefinite article.
    const an = /^[aeiou]/i.test(thing) ? 'An' : 'A';
    await update_topl(`${an} ${thing} ${disposition}!`);
}

// C ref: lock.c breakchestlock(box, destroyit) — destroy-it path only (the
// forcelock success on a non-blade weapon with !rn2(3)).  Spills the contents at
// the hero's feet; each non-potion item has a 1/3 chance (and every potion) of
// being destroyed (chest_shatter_msg), the rest land on the floor.  No shop on
// the starting level, so no costly_alteration.  C ref: lock.c:172-211.
async function breakchestlock(box, destroyit) {
    if (!destroyit) {
        // C ref: lock.c:162 breakchestlock() — the lock breaks, the box stays,
        // and NOTHING is printed.  The caller passes !picktyp && !rn2(3).
        box.olocked = 0; box.obroken = 1; box.lknown = 1;
        return;
    }
    await update_topl(`In fact, you've totally destroyed the ${box_basename(box.otyp)}.`);
    const contents = box.cobj || [];
    box.cobj = [];
    for (const otmp of contents) {
        const isPotion = otmp.oclass === 8 /*POTION_CLASS*/;
        if (!rn2(3) || isPotion) {
            await chest_shatter_msg(otmp);
            // single-quantity item is freed (destroyed); no shop loss here.
            if (otmp.quan === 1) {
                continue; // obfree: gone
            }
            // multi-quantity: useup one, the rest fall to the floor.
            otmp.quan -= 1;
            otmp.owt = weight(otmp);
        }
        place_object(otmp, game.u.ux, game.u.uy);
        stackobj(otmp);
    }
    delobj(box);
}

// C ref: lock.c forcelock() — the #force occupation, run each turn from the move
// loop.  Returns 1 while still busy (keep the occupation), 0 when finished.
export async function forcelock() {
    const u = game.u;
    const xl = game.xlock;
    if (!xl || !xl.box) { game._force_box = null; game.xlock = null; return 0; }

    // you or the box moved -> abort (usedtime = 0).
    if (xl.box.ox !== u.ux || xl.box.oy !== u.uy) {
        game._force_box = null; game.xlock = null; return 0;
    }
    // give-up check (usedtime >= 50 || no weapon).
    if (xl.usedtime++ >= 50 || !game.uwep) {
        await update_topl('You give up your attempt to force the lock.');
        if (xl.usedtime >= 50) exercise(xl.picktyp ? A_DEX : A_STR, true);
        game._force_box = null; game.xlock = null; return 0;
    }

    if (xl.picktyp) { /* blade */
        // C ref: lock.c forcelock():238.  rn2(1000 - spe) is drawn EVERY blade
        // turn (before the cursed/obj_resists tests short-circuit), so a
        // blade-wielding hero's force draws one more call per turn than a
        // blunt one; obj_resists() adds its own rn2(100) only when the first
        // two tests pass.  For a +0 weapon P(survive 50 tries) = .992^50.
        const uwep = game.uwep;
        if (rn2(1000 - (uwep.spe | 0)) > (992 - greatest_erosion(uwep) * 10)
            && !uwep.cursed && !obj_resists(uwep, 0, 99)) {
            await pline(`${(uwep.quan || 1) > 1 ? 'One of y' : 'Y'}our ${xname(uwep)} broke!`);
            useup(uwep);
            await pline('You give up your attempt to force the lock.');
            exercise(A_DEX, true);
            game._force_box = null; game.xlock = null;
            return 0;
        }
    } else {
        wake_nearby_force(); // blunt weapon: hammering wakes nearby monsters.
    }

    // rn2(100) >= chance -> still busy.  C ref: lock.c:244.
    if (rn2(100) >= xl.chance) return 1;

    await update_topl('You succeed in forcing the lock.');
    exercise(xl.picktyp ? A_DEX : A_STR, true); // -> rn2(19)
    // breakchestlock(box, !picktyp && !rn2(3)).  C ref: lock.c:252.
    const destroyit = !xl.picktyp && !rn2(3);
    await breakchestlock(xl.box, destroyit);
    game._force_box = null;
    game.xlock = null;
    return 0;
}

// ── #overview (C ref: dungeon.c dooverview()/show_overview(), win/tty/wintty.c
// process_menu_window's H2344_BROKEN corner-menu layout) ──
//
// Renders the plain-text (non-selectable) overview menu at the corner offset,
// waits for the dismissal key, then restores the screen the menu covered.
function render_overview_menu(lines) {
    const disp = game?.nhDisplay;
    if (!disp?.setCell) return;
    const cols = disp.cols || 80;
    let maxcol = '(end) '.length;
    for (const l of lines) maxcol = Math.max(maxcol, l.text.length + 2);
    let offx = Math.min(Math.min(82, Math.floor(cols / 2)), cols - maxcol - 1);
    if (offx < 0) offx = 0;
    const textCol = offx + 1;
    // The message window (row 0) is cleared in full when the menu is raised.
    for (let c = 0; c < cols; c++) disp.setCell(c, 0, ' ', NO_COLOR, 0);
    const moreRow = lines.length;
    for (let r = 0; r <= moreRow; r++) {
        for (let c = offx; c < cols; c++) disp.setCell(c, r, ' ', NO_COLOR, 0);
    }
    for (let r = 0; r < lines.length; r++) {
        disp.putstr(textCol, r, lines[r].text, NO_COLOR, lines[r].attr || 0);
    }
    disp.putstr(textCol, moreRow, '(end)', NO_COLOR, 0);
    // C dmore: cursor parked at offx + strlen("(end) ") + 2 = textCol + 6.
    disp.setCursor(textCol + 6, moreRow);
}

// C ref: dungeon.c dooverview() -> show_overview(0, 0) -> select_menu(win,
// PICK_NONE, ...): a plain display, dismissed by ESC/space/return (tty
// dismissal keys for a finished, non-counting menu).  Afterwards
// tty_dismiss_nhwindow()'s corner-menu path (docorner) repaints the area the
// menu covered with the real map/status; flush_screen(1) reproduces that.
export async function dooverview() {
    await show_overview_disclosure(0, 0);
    return 0;
}

// C ref: end.c disclose() 'o' query -> show_overview((how>=PANICKED)?1:2, how).
// Same corner-menu rendering as the live command, just with build_overview_lines'
// `final`/`how` params threaded through so it lists every visited level and
// (for a real death) appends the "Final resting place for you, ..." lines.
export async function show_overview_disclosure(final, how) {
    const lines = build_overview_lines(final, how);
    if (!lines.length) return;
    render_overview_menu(lines);
    for (;;) {
        const key = await nhgetch();
        if (key === 27 || key === 13 || key === 10 || key === 32) break;
    }
    await flush_screen(1);
}

// C ref: wizcmds.c:218 wiz_where() — `print_dungeon(FALSE, 0, 0)`, the
// #wizwhere dungeon-overview dump.  No RNG at all: every line is derived from
// the static dungeon model init_dungeons() already built.
export async function wiz_where() {
    if (!game.flags?.debug) {
        // C ref: cmd.c:3092 ecname_from_fn() returns extcmdlist[].ef_txt, which
        // is "wizwhere" (cmd.c:1998) with NO leading '#'.
        await pline("Unavailable command 'wizwhere'.");
        return 0;
    }
    await display_text_fullscreen(print_dungeon_lines());
    return 0;
}

// C ref: win/tty/wintty.c process_text_window() with cw->offx == 0, the
// full-screen arm tty_display_nhwindow() picks whenever the window has at
// least ttyDisplay->rows lines.  Text starts at column 0 (tty_curs(win,1,n)
// with offx 0), a page holds rows-1 lines, and dmore() prints "--More--" at
// (curx + 2) 1-based, i.e. column 1, on the row after the last text line.
// Each page break does term_clear_screen() before the next page.
async function display_text_fullscreen(lines) {
    const disp = game.nhDisplay;
    if (!disp?.setCell) return;
    const rows = disp.rows || 24, cols = disp.cols || 80;
    const clearRow = (r) => { for (let c = 0; c < cols; c++) disp.setCell(c, r, ' ', NO_COLOR, 0); };
    const clearAll = () => { for (let r = 0; r < rows; r++) clearRow(r); };
    // tty_display_nhwindow(): offx == 0 takes the cl_eos()/term_clear_screen()
    // arm, so the map and status rows are gone for the whole window.
    clearAll();
    game._pending_message = '';

    // xwaitforspace(quitchars) — space/return dismiss the page, ESC cancels the
    // rest of the window; any other key is ignored (the frame is unchanged).
    const dmore = async (row) => {
        clearRow(row);
        disp.putstr(1, row, '--More--', NO_COLOR, 0);
        disp.setCursor(1 + '--More--'.length, row);
        for (;;) {
            game._modal_screen = 'textwin';
            const c = await nhgetch();
            if (c === 27) { delete game._modal_screen; return false; }
            if (c === 32 || c === 13 || c === 10) { delete game._modal_screen; return true; }
        }
    };

    let n = 0;
    for (let i = 0; i < lines.length; i++) {
        if (n === rows - 1) {
            if (!(await dmore(n))) { await docrt_after_text(); return; }
            clearAll();
            n = 0;
        }
        clearRow(n);
        disp.putstr(0, n, lines[i], NO_COLOR, 0);
        n++;
    }
    await dmore(n);
    await docrt_after_text();
}

// tty_dismiss_nhwindow(): a window that covered the whole screen is torn down
// with docrt(), which repaints map + status from scratch.
async function docrt_after_text() {
    const { docrt } = await import('./display.js');
    await docrt();
    await flush_screen(1);
}

// Map extcmdlist index -> handler.  Unimplemented commands fall through to
// a no-op (no message), which keeps RNG/state untouched.
const HANDLERS = {
    invoke: doinvoke,
    untrap: dountrap,
    tip: dotip,
    adjust: doorganize_extcmd,
    annotate: donamelevel,
    jump: dojump,
    levelchange: wiz_level_change,
    twoweapon: dotwoweapon,
    pray: dopray,
    chat: dochat,
    name: docallcmd,
    call: docallcmd,
    ride: doride,
    loot: doloot,
    force: doforce,
    wizwish: wiz_wish,
    enhance: doenhance,
    rub: dorub_extcmd,
    wipe: dowipe_extcmd,
    sit: dosit,
    dip: dodip,
    offer: dosacrifice,
    genocided: dogenocided,
    vanquished: dovanquished,
    chronicle: do_gamelog,
    conduct: doconduct,
    wizgenesis: wiz_genesis,
    wizidentify: wiz_identify_extcmd,
    wizintrinsic: wiz_intrinsic,
    overview: dooverview,
    version: doextversion,
    quit: doquit_extcmd,
    polyself: wiz_polyself,
    monster: domonability_extcmd,
    turn: doturn,
    wait: dowait_extcmd,
    terrain: doterrain_extcmd,
    wizmap: wiz_map_extcmd,
    herecmdmenu: doherecmdmenu,
    wizwhere: wiz_where,
};

// C ref: cmd.c:4332 doherecmdmenu() -> here_cmd_menu() -> there_cmd_menu(u.ux,
// u.uy, CLICK_1).  Only the u_at(x,y) arm (there_cmd_menu_self) can be reached
// from '#herecmdmenu'; MCMD_* dispatch is via act_on_act()'s cmdq, and only the
// no-op ESC path is exercised, so a selection is accepted and then dropped.
// With no HANDLERS entry the menu never drew AND the dismissing key fell
// through to rhack() as a fresh command.
async function doherecmdmenu() {
    const disp = game?.nhDisplay;
    const u = game.u;
    const x = u.ux, y = u.uy;
    const typ = game.level?.at?.(x, y)?.typ | 0;
    const items = [];
    const push = (ch, desc) => items.push({ ch, desc });
    // Accelerators are assigned by the tty menu in add order: a, b, c, ...
    const nextCh = () => String.fromCharCode(97 + items.length);

    // C ref: cmd.c:4448 — can_reach_floor(FALSE) is unconditionally true here
    // (js/invent.js can_reach_floor).
    if (IS_FOUNTAIN(typ) || IS_SINK(typ))
        push(nextCh(), `Drink from the ${IS_FOUNTAIN(typ) ? 'fountain' : 'sink'}`);
    if (IS_FOUNTAIN(typ)) push(nextCh(), 'Dip something into the fountain');
    if (IS_THRONE(typ)) push(nextCh(), 'Sit on the throne');
    if (IS_ALTAR(typ)) push(nextCh(), 'Sacrifice something on the altar');

    const stway = herecmd_stairway_at(x, y);
    if (stway && stway.up)
        push(nextCh(), `Go up the ${stway.isladder ? 'ladder' : 'stairs'}`);
    if (stway && !stway.up)
        push(nextCh(), `Go down the ${stway.isladder ? 'ladder' : 'stairs'}`);

    // C ref: cmd.c:4482 OBJ_AT(x,y) — svl.level.objects[x][y] is the raw top of
    // the pile (not vobj_at), and `otmp->nexthere` means "more than one here".
    const { objects_at } = await import('./invent.js');
    const pile = objects_at(x, y) || [];
    const otmp = pile[0];
    if (otmp) {
        push(nextCh(), `Pick up ${pile.length > 1 ? 'items' : obj_doname(otmp)}`);
        if (is_container_otyp(otmp.otyp)) {
            push(nextCh(), `Loot ${obj_doname(otmp)}`);
            push(nextCh(), `Tip ${obj_doname(otmp)}`);
        }
        if (otmp.oclass === FOOD_CLASS_X)
            push(nextCh(), `Eat ${obj_doname(otmp)}`);
    }
    if (inventoryArray().length) {
        push(nextCh(), 'Inventory');
        push(nextCh(), 'Drop items');
    }
    push(nextCh(), 'Rest one turn');
    push(nextCh(), 'Search around you');
    push(nextCh(), 'Look at what is here');
    const { num_spells } = await import('./spell.js');
    if (num_spells() > 0) push(nextCh(), 'Cast a spell');
    const ttmp = herecmd_t_at(x, y);
    const VIBRATING_SQUARE = 24;   // C ref: trap.h trap types
    if (ttmp && ttmp.tseen && ttmp.ttyp !== VIBRATING_SQUARE)
        push(nextCh(), 'Attempt to disarm trap');
    // C ref: cmd.c:4646 there_cmd_menu_common() — for self, "Look at map symbol"
    // only when the square does not show the ordinary hero glyph.
    if (u?.Upolyd) push(nextCh(), 'Look at map symbol');

    // C ref: cmd.c:4880 — K==0 falls through to a move/travel, never a menu.
    if (!items.length) return 0;
    render_corner_menu(disp, 'What do you want to do?', items);
    for (;;) {
        const key = await nhgetch();
        if (key === 27 || key === 32 || key === 13 || key === 10) break;
        if (items.some((it) => it.ch === String.fromCharCode(key))) break;
    }
    return 0;   /* ECMD_OK — the dismissed menu costs no time */
}

// C ref: stairs.c stairway_at(x, y) (js/do.js keeps the other copy private).
function herecmd_stairway_at(x, y) {
    for (let s = game.stairs; s; s = s.next)
        if (s.sx === x && s.sy === y) return s;
    return null;
}
// C ref: trap.c t_at(x, y).
function herecmd_t_at(x, y) {
    for (const t of game.level?.traps ?? [])
        if (t.tx === x && t.ty === y) return t;
    return null;
}
const FOOD_CLASS_X = 7;   // js/mkobj.js object classes

// C ref: wizcmds.c:176 wiz_map() — mark every trap seen, reveal every
// engraving, then do_mapping(), whose tail is exercise(A_WIS, TRUE) => one
// rn2(19).  With no HANDLERS entry this fell through to the table's no-op, so
// the draw went missing and the whole map stayed dark.  do_mapping() takes C's
// hero_memory branch here, so there is no browse_map() getpos loop and no extra
// keystroke is consumed.
export async function wiz_map_extcmd() {
    const { do_mapping } = await import('./detect.js');
    for (const t of (game.level?.traps || [])) t.tseen = 1;
    for (const ep of (game.level?.engravings || [])) ep.erevealed = 1;
    await do_mapping();
    return 0;   /* ECMD_OK — no time passes */
}

// C ref: cmd.c { '\177', "terrain", ..., doterrain } — '#terrain' is the same
// command as the <rubout> key.  It had no HANDLERS entry, so the extended form
// silently did nothing and its menu's keystrokes went to the command parser.
async function doterrain_extcmd() {
    const { doterrain } = await import('./hack.js');
    return await doterrain();
}

// C ref: cmd.c { '.', "wait", donull } — '#wait' is the same command as '.'.
// It had no handler, so the extended form silently cost no turn.
async function dowait_extcmd() {
    const { donull } = await import('./cmd.js');
    return await donull();
}

// C ref: cmd.c domonability() return convention — ECMD_OK(0)/ECMD_TIME(1);
// the extcmd dispatcher's turn convention already treats non-1 as "no turn",
// so this is a direct pass-through (kept as its own wrapper only so the
// HANDLERS table above reads the same way as its neighbors).
async function domonability_extcmd() {
    return await domonability();
}

// C ref: wizcmds.c wiz_identify() returns ECMD_OK (no turn elapses).
function wiz_identify_extcmd() {
    wiz_identify();
    return 0;
}

// C ref: timeout.c propertynames[] — the ordered property list #wizintrinsic
// (and #timeout) walks, "ordered by interest".  Entries are
// [prop-id, display name, u.uprops timeout field].  The prop-id is the
// include/prop.h name; only two of them are load-bearing here (HALLUC_RES is
// skipped, FIRE_RES gets a "--" separator ahead of it, marking the start of the
// properties that only ever hold timed values in wizard mode).  The timeout
// field names the u.uprops key this port already reads for that property, so
// e.g. a timed FAST really does make Very_fast true in u_calc_moveamt.
const WIZINTRINSIC_PROPS = [
    ['INVULNERABLE', 'invulnerable', 'Invulnerable'],
    ['STONED', 'petrifying', 'Stoned'],
    ['SLIMED', 'becoming slime', 'Slimed'],
    ['STRANGLED', 'strangling', 'Strangled'],
    ['SICK', 'fatally sick', 'Sick'],
    ['STUNNED', 'stunned', 'Stun'],
    ['CONFUSION', 'confused', 'Confusion'],
    ['HALLUC', 'hallucinating', 'HHallucination'],
    ['BLINDED', 'blinded', 'Blinded'],
    ['DEAF', 'deafness', 'HDeaf'],
    ['VOMITING', 'vomiting', 'Vomiting'],
    ['GLIB', 'slippery fingers', 'Glib'],
    ['WOUNDED_LEGS', 'wounded legs', 'Wounded_legs'],
    ['SLEEPY', 'sleepy', 'Sleepy'],
    ['TELEPORT', 'teleporting', 'HTeleportation'],
    ['POLYMORPH', 'polymorphing', 'HPolymorph'],
    ['LEVITATION', 'levitating', 'Levitation'],
    ['FAST', 'very fast', 'HFast'],
    ['CLAIRVOYANT', 'clairvoyant', 'HClairvoyant'],
    ['DETECT_MONSTERS', 'monster detection', 'HDetect_monsters'],
    ['SEE_INVIS', 'see invisible', 'HSee_invisible'],
    ['INVIS', 'invisible', 'HInvis'],
    ['ACID_RES', 'acid resistance', 'HAcid_resistance'],
    ['STONE_RES', 'stoning resistance', 'HStone_resistance'],
    ['DISPLACED', 'displaced', 'HDisplaced'],
    ['PASSES_WALLS', 'pass thru walls', 'HPasses_walls'],
    ['MAGICAL_BREATHING', 'magical breathing', 'HMagical_breathing'],
    ['WWALKING', 'water walking', 'HWwalking'],
    ['FIRE_RES', 'fire resistance', 'HFire_resistance'],
    ['COLD_RES', 'cold resistance', 'HCold_resistance'],
    ['SLEEP_RES', 'sleep resistance', 'HSleep_resistance'],
    ['DISINT_RES', 'disintegration resistance', 'HDisint_resistance'],
    ['SHOCK_RES', 'shock resistance', 'HShock_resistance'],
    ['POISON_RES', 'poison resistance', 'HPoison_resistance'],
    ['DRAIN_RES', 'drain resistance', 'HDrain_resistance'],
    ['SICK_RES', 'sickness resistance', 'HSick_resistance'],
    ['ANTIMAGIC', 'magic resistance', 'HAntimagic'],
    ['HALLUC_RES', 'hallucination resistance', 'HHalluc_resistance'],
    ['BLND_RES', 'light-induced blindness resistance', 'HBlnd_resistance'],
    ['FUMBLING', 'fumbling', 'HFumbling'],
    ['HUNGER', 'voracious hunger', 'HHunger'],
    ['TELEPAT', 'telepathic', 'HTelepat'],
    ['WARNING', 'warning', 'HWarning'],
    ['WARN_OF_MON', 'warn: monster type or class', 'HWarn_of_mon'],
    ['WARN_UNDEAD', 'warn: undead', 'HWarn_undead'],
    ['SEARCHING', 'searching', 'HSearching'],
    ['INFRAVISION', 'infravision', 'HInfravision'],
    ['ADORNED', 'adorned (+/- Cha)', 'HAdorned'],
    ['STEALTH', 'stealthy', 'HStealth'],
    ['AGGRAVATE_MONSTER', 'monster aggravation', 'HAggravate_monster'],
    ['CONFLICT', 'conflict', 'HConflict'],
    ['JUMPING', 'jumping', 'HJumping'],
    ['TELEPORT_CONTROL', 'teleport control', 'HTeleport_control'],
    ['FLYING', 'flying', 'Flying'],
    ['SWIMMING', 'swimming', 'HSwimming'],
    ['SLOW_DIGESTION', 'slow digestion', 'HSlow_digestion'],
    ['HALF_SPDAM', 'half spell damage', 'HHalf_spell_damage'],
    ['HALF_PHDAM', 'half physical damage', 'HHalf_physical_damage'],
    ['REGENERATION', 'HP regeneration', 'HRegeneration'],
    ['ENERGY_REGENERATION', 'energy regeneration', 'Energy_regeneration'],
    ['PROTECTION', 'extra protection', 'HProtection'],
    ['PROT_FROM_SHAPE_CHANGERS', 'protection from shape changers', 'HProtection_from_shape_changers'],
    ['POLYMORPH_CONTROL', 'polymorph control', 'HPolymorph_control'],
    ['UNCHANGING', 'unchanging', 'HUnchanging'],
    ['REFLECTING', 'reflecting', 'HReflecting'],
    ['FREE_ACTION', 'free action', 'HFree_action'],
    ['FIXED_ABIL', 'fixed abilities', 'HFixed_abil'],
    ['LIFESAVED', 'life will be saved', 'HLifesaved'],
];

const DEFAULT_TIMEOUT_INCR = 30;   // C ref: wizcmds.c:945

// Build the #wizintrinsic menu entries.  Non-selectable entries (the end_menu()
// prompt, its blank line, the "--" separator) carry no `item`.
// C ref: wizcmds.c wiz_intrinsic() + win/tty/wintty.c tty_end_menu() (the
// prompt and a blank line are prepended, in that order, to the item list).
function wizIntrinsicEntries() {
    const uprops = game.u?.uprops || {};
    const propTimeout = (propId, key) => {
        const t = timed_prop(propId);
        return t ? (t.get(game.u || {}) || 0) : (uprops[key] || 0);
    };
    const entries = [
        { text: 'Which intrinsics?', attr: ATR_INVERSE },
        { text: '', attr: 0 },
    ];
    // C ref: wizcmds.c:965 — a subtitle line added BEFORE any item, so it lands
    // right after tty_end_menu()'s prompt + blank.  The two recorded
    // #wizintrinsic menus DISAGREE about it: seed0383 (verbose on) shows it,
    // seed4500 (`!verbose`) does not, so the recorder's guard is the verbose
    // flag rather than this source snapshot's `iflags.cmdassist`.
    if (game.flags?.verbose !== false)
        entries.push({ text: `[Precede any selection with a count to increment by other than ${DEFAULT_TIMEOUT_INCR}.]`, attr: 0 });
    for (const [propId, name, key] of WIZINTRINSIC_PROPS) {
        // Grayswandir vs hallucination: never offered.
        if (propId === 'HALLUC_RES') continue;
        if (propId === 'FIRE_RES') entries.push({ text: '--', attr: 0 });
        const oldtimeout = propTimeout(propId, key);
        // C: Sprintf(buf, "%-27s [%li]", propname, oldtimeout)
        const label = oldtimeout ? `${name.padEnd(27)} [${oldtimeout}]` : name;
        entries.push({ text: label, attr: 0, item: { propId, name, key, oldtimeout, selected: false } });
    }
    return entries;
}

// C ref: win/tty/wintty.c process_menu_window() — a multi-page NHW_MENU:
// lmax == min(52, rows-1) == 23 lines per page, accelerators restart at 'a' on
// every page and are only spent on selectable entries, the morestr is
// "(N of M)", and a selected entry's '-' marker becomes '+' (set_item_state;
// '#' when a count was given, which this port does not model).
async function wizIntrinsicMenu(entries) {
    const rows = game.nhDisplay?.rows ?? 24;
    const lmax = Math.min(52, rows - 1);
    const npages = Math.ceil(entries.length / lmax) || 1;
    for (let i = 0; i < entries.length; i++) {
        if (i % lmax === 0) var acc = 97;                              // 'a'
        if (entries[i].item) {
            entries[i].item.sel = String.fromCharCode(acc);
            acc = (acc === 122) ? 65 : acc + 1;                        // z -> A
        }
    }
    let page = 0;
    for (;;) {
        const pageEntries = entries.slice(page * lmax, (page + 1) * lmax);
        renderWindowScreen(pageEntries.map((e) => ({
            text: e.item ? `${e.item.sel} ${e.item.selected ? '+' : '-'} ${e.text}` : e.text,
            attr: e.attr,
        })), {
            menu: true,
            footer: npages > 1 ? `(${page + 1} of ${npages})` : '(end)',
            footerRow: pageEntries.length,
            footerCol: 1,
            modal: 'wizintwin',
        });
        const c = await nhgetch();
        const ch = String.fromCharCode(c);
        const hit = pageEntries.find((e) => e.item && e.item.sel === ch);
        if (hit) { hit.item.selected = !hit.item.selected; continue; }
        if (c === 27) return false;                                    // cancel
        if (c === 13 || c === 10) return true;                         // commit
        if (ch === ' ' || ch === '>') {
            if (page < npages - 1) page++;
            else if (ch === ' ') return true;   // ' ' finishes, '>' does not
            continue;
        }
        if (ch === '<') { if (page > 0) page--; continue; }
        if (ch === '^') { page = 0; continue; }
        if (ch === '|') { page = npages - 1; continue; }
        if (ch === ',') { for (const e of pageEntries) if (e.item) e.item.selected = true; continue; }
        if (ch === '\\') { for (const e of pageEntries) if (e.item) e.item.selected = false; continue; }
        if (ch === '~') { for (const e of pageEntries) if (e.item) e.item.selected = !e.item.selected; continue; }
        if (ch === '.') { for (const e of entries) if (e.item) e.item.selected = true; continue; }
        if (ch === '-') { for (const e of entries) if (e.item) e.item.selected = false; continue; }
        if (ch === '@') { for (const e of entries) if (e.item) e.item.selected = !e.item.selected; continue; }
        // Digits start a count (which would override DEFAULT_TIMEOUT_INCR) and
        // ':' opens a search prompt; neither is modelled.  Any other key rings
        // the bell and leaves the page up.
    }
}

// C ref: wizcmds.c wiz_intrinsic() — a PICK_ANY menu of every timeable
// property; each pick adds DEFAULT_TIMEOUT_INCR to that property's intrinsic
// timeout and plines "Timeout for <prop> set to/increased by N.".
// GAP: C routes BLINDED/DEAF/HALLUC/SICK/SLIMED/STONED/STUNNED/VOMITING/GLIB/
// WARN_OF_MON through their make_*() helpers, whose feedback differs from the
// default "Timeout for ..." line; those helpers are inlined per-call-site in
// this port, so every pick currently takes C's `default:` arm.
async function wiz_intrinsic() {
    const entries = wizIntrinsicEntries();
    const committed = await wizIntrinsicMenu(entries);
    delete game._modal_screen;
    if (!committed) {
        // ESC deselects everything and cancels; the map is repainted.
        await flush_screen(1);
        return 0;
    }
    const u = game.u;
    if (!u.uprops) u.uprops = {};
    game._toplin = 0;
    for (const e of entries) {
        const it = e.item;
        if (!it || !it.selected) continue;
        const slot = timed_prop(it.propId);
        const oldtimeout = slot ? (slot.get(u) || 0) : (u.uprops[it.key] || 0);
        let newtimeout = oldtimeout + DEFAULT_TIMEOUT_INCR;
        // C: SICK/SLIMED/STONED never have their existing timeout extended.
        if ((it.propId === 'SICK' || it.propId === 'SLIMED' || it.propId === 'STONED')
            && oldtimeout > 0 && newtimeout > oldtimeout)
            newtimeout = oldtimeout;
        // C ref: wizcmds.c:1032 — HALLUC does NOT take the default
        // "Timeout for ..." arm; it goes through make_hallucinated(), whose own
        // feedback is "Oh wow!  Everything looks so cosmic!" and which refreshes
        // the (now hallucinatory) map first.
        if (it.propId === 'HALLUC') {
            const { make_hallucinated } = await import('./potion.js');
            await make_hallucinated(newtimeout, true, 0);
            continue;
        }
        // C ref: wizcmds.c:1020 `case BLINDED: make_blinded(newtimeout, TRUE)`
        // — also NOT the default arm, so there is no "Timeout for blinded"
        // line.  make_blinded only talks when sight is actually regained, so
        // topping up an already-blind hero is silent (and therefore raises no
        // --More--, which is what kept the following steps misaligned).
        if (it.propId === 'BLINDED') {
            const wasBlind = Blind();
            slot.set(u, newtimeout);
            game.botl = true;
            if (!Blind() && wasBlind) {
                game.vision_full_recalc = 1;
                await update_topl('You can see again.');
            }
            continue;
        }
        if (slot) slot.set(u, newtimeout); else u.uprops[it.key] = newtimeout;
        game.botl = true;
        // update_topl, not pline: the two "Timeout for ..." lines share one
        // topline (C update_topl appends with two spaces while it fits).
        await update_topl(`Timeout for ${it.name} ${oldtimeout ? 'increased by' : 'set to'} ${DEFAULT_TIMEOUT_INCR}.`);
    }
    // C: docrt() — clears the screen (flushing the topline through --More--)
    // and repaints the map.  A pick whose handler prints nothing (BLINDED on an
    // already-blind hero) leaves the topline EMPTY, and C never --More--s an
    // empty topline.
    if (game._pending_message) await topl_more();
    game._pending_message = '';
    // C ref: display.c docrt():1727 — `if (u.uswallow) { swallowed(1); goto
    // post_map; }`.  That is a SECOND full stomach repaint after the one
    // make_hallucinated() already did, and while hallucinating each repaint
    // spends eight more display-RNG picks, so skipping it leaves every later
    // frame one batch behind (seed0383 step 165).
    if (game.u?.uswallow) {
        const { swallowed } = await import('./display.js');
        await swallowed(1);
    }
    await flush_screen(1);
    return 0;
}

// C ref: end.c done2() — '#quit'.  Implemented in end.js (it shares state/
// helpers with done()/disclose()); dynamic import matches this file's
// existing pattern for the other end.js-adjacent commands.
async function doquit_extcmd() {
    const { doquit } = await import('./end.js');
    return await doquit();
}

// C ref: apply.c dorub()/do.c dowipe() return ECMD_* (OK=0/CANCEL=1/TIME=2).
// The extcmd dispatcher's turn convention is "return 1 -> a turn elapses", so
// translate ECMD_TIME into 1 (turn) and everything else into 0 (no turn).
async function dorub_extcmd() {
    const res = await dorub();
    return res === APPLY_ECMD.ECMD_TIME ? 1 : 0;
}
async function doorganize_extcmd() {
    await doorganize();
    return 0;
}
async function dowipe_extcmd() {
    const res = await dowipe();
    return res === APPLY_ECMD.ECMD_TIME ? 1 : 0;
}

// C ref: cmd.c doextcmd().  '#' entry: read an extended command name and
// dispatch it.
export async function doextcmd() {
    const idx = await tty_get_ext_cmd();
    if (idx < 0) {
        game.context.move = 0;
        return 0;
    }
    const txt = EXTCMDLIST[idx][0];
    const fn = HANDLERS[txt];
    let res = 0;
    if (fn) {
        res = await fn();
    }
    // C ref: doextcmd returns the command's ECMD_* result; ECMD_TIME (1)
    // makes the move loop advance a turn.  Commands we don't model return 0.
    game.context.move = res === 1 ? 1 : 0;
    return res;
}

// ── #invoke / #tip / #untrap ────────────────────────────────────────────────
// All three were absent from HANDLERS while their names WERE in EXTCMDLIST, so
// the command echoed and then silently did nothing.  The real cost is not the
// missing message: the answer keystroke falls through to rhack() as a fresh
// command, which desynchronises every later step in the session.

const GETOBJ_EXCLUDE_X = -3, GETOBJ_SUGGEST_X = 2;           // js/invent.js:147,152
const FAKE_AMULET_OF_YENDOR_X = 212, CRYSTAL_BALL_X = 231;   // js/mkobj.js:414,433

// C ref: artifact.c:1727 invoke_ok().
// NOTE objects[].oc_unique is populated for only two otyps in this port
// (js/o_init.js:192,195), so the Bell/Candelabrum are still mis-classified.
function invoke_ok(obj) {
    if (!obj) return GETOBJ_EXCLUDE_X;
    if (obj.oartifact || objects[obj.otyp]?.oc_unique
        || (obj.otyp === FAKE_AMULET_OF_YENDOR_X && !obj.known)) return GETOBJ_SUGGEST_X;
    if (obj.otyp === CRYSTAL_BALL_X) return GETOBJ_SUGGEST_X;
    return GETOBJ_EXCLUDE_X;
}

// C ref: artifact.c:1749 doinvoke() -> retouch_object() -> :2131 arti_invoke().
// An artifact whose inv_prop is 0 (Mjollnir) reaches pline1(nothing_happens).
async function doinvoke() {
    const inv = await import('./invent.js');
    const obj = await inv.getobj('invoke', invoke_ok, inv.GETOBJ_PROMPT);
    if (!obj) return 0;                                  // ECMD_CANCEL
    if (!inv.touch_artifact(obj, null)) return 1;        // ECMD_TIME
    await pline('Nothing happens.');
    return 1;                                            // ECMD_TIME
}

// C ref: pickup.c:3562 dotip() — the floor-container branch.  tipcontainer() is
// not ported; no recorded session answers anything but 'q'/'n' here.
async function dotip() {
    for (const cobj of floor_lockboxes_here()) {
        const nm = `${cobj.obroken ? 'broken ' : (cobj.olocked ? 'locked ' : '')}${box_basename(cobj.otyp)}`;
        const c = await yn_function(`There is a ${nm} here, tip it?`, 'ynq', 'q');
        if (c === 'q') return 0;                         // ECMD_OK
        if (c === 'n') continue;
        return 1;                                        // ECMD_TIME (tipcontainer TODO)
    }
    // C then falls through to getobj("tip", tip_ok, GETOBJ_PROMPT).
    return 0;
}

// C ref: trap.c:5248 dountrap() -> :5258 could_untrap(TRUE, FALSE).
// webmaker() is include/mondata.h:147, a SPECIES test against PM_CAVE_SPIDER /
// PM_GIANT_SPIDER — there is no M1_WEBMAKER bit (0x400000 is M1_OVIPAROUS here,
// and a red dragon has it, which would silence the message).
async function dountrap() {
    const { nohands } = await import('./monflags_data.js');
    const { near_capacity } = await import('./invent.js');
    const { base_mmove } = await import('./mon.js');
    const data = game.u?.data;
    const webmaker = data?.name === 'cave spider' || data?.name === 'giant spider';
    let buf = '';
    if (near_capacity() >= 3 /* HVY_ENCUMBER */)
        buf = "You're too strained to do that.";
    else if ((data && nohands(data) && !webmaker) || !base_mmove({ data }))
        buf = 'And just how do you expect to do that?';
    if (buf) { await pline(buf); return 0; }

    // C ref: trap.c:5253 `untrap(FALSE, 0, 0, (struct obj *) 0)`.  With no rx/ry
    // and no container, untrap() opens with the usual-case prompt
    // (trap.c:5870-5875): `if (!getdir((char *) 0)) return 0;` then
    // x = u.ux + u.dx, y = u.uy + u.dy.  getdir draws "In what direction?" and
    // consumes one key, so skipping it both lost that screen and left the
    // direction key to be re-read as a top-level command.
    const { getdir } = await import('./cmd.js');
    const dir = await getdir(null);
    if (!dir) return 0;
    const u = game.u;
    const x = (u?.ux | 0) + (dir.dx | 0), y = (u?.uy | 0) + (dir.dy | 0);
    if (!isok(x, y)) {
        // C ref: trap.c:5886.
        await pline('The perils lurking there are beyond your grasp.');
        return 0;
    }
    // C ref: trap.c:5886 onwards — the floor-trap / door / box arms.  They live
    // in js/trap.js as untrap_at(x, y, force) because C reads the direction
    // inside untrap() and this port reads it above; `force` is TRUE only for
    // #invoke or a magic key, neither of which reaches dountrap().
    const { untrap_at } = await import('./trap.js');
    return await untrap_at(x, y, false) ? 1 : 0;
}

// C ref: cmd.c rhack() `res = (*func)()` — run an extended command's ef_funct
// straight from its extcmdlist name.  number_pad binds plain letters to
// commands that have no non-'#' key of their own (j/#jump, l/#loot, u/#untrap,
// N/#name, ^N/#annotate), and rhack() dispatches them exactly as doextcmd()
// would.  Returns the ECMD_* result; an unmodelled command is a no-op.
export async function run_extcmd_by_name(txt) {
    const fn = HANDLERS[txt];
    return fn ? await fn() : 0;
}
