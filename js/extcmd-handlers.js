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
import { pline, topl_more, update_topl, y_n, flush_screen, m_at, vobj_at, render_map_to_grid, render_map_row_to_grid, putStatusRow, newsym, remember_topl, yn_prompt_history, msghist } from './display.js';
import { NO_COLOR, ATR_INVERSE } from './terminal.js';
import {
    obj_doname, sortloot, SORTLOOT_LOOT, SORTLOOT_INVLET, SORTLOOT_PACK, mergable,
    name_inventory_object, call_inventory_object, doorganize, docall, call_ok, GETOBJ_EXCLUDE,
    addinv, prinv, prinv_fmt, let_to_name, report_merge_discovery,
    wiz_identify, renderWindowScreen, renderMenuLines, select_command_menu, useup, xname,
    doattributes, dodrop, doremring, dotravel_target, dopay, doperminv,
    dopickup, doputon, dowieldquiver, dothrow, dotravel, dowear, dowield,
    doprinuse, dofire, ddoinv, dotypeinv, dodiscovered, dolook, doswapweapon,
    dotakeoff, doprring, doprtool, doprwep, doprgold, dovspell, dopramulet,
    doprarm, near_capacity,
} from './invent.js';
import { pluslvl, losexp, rank_of } from './exper.js';
import { MAXULEV, IS_WALL, SDOOR, BOLT_LIM, STRAT_WAITMASK,
         IS_FOUNTAIN, IS_SINK, IS_THRONE, IS_ALTAR, COLNO, ROWNO,
         QBUFSZ, VIBRATING_SQUARE, D_NODOOR, D_BROKEN, D_ISOPEN,
         D_CLOSED, D_LOCKED, D_TRAPPED, IS_GRAVE, TIMEOUT } from './const.js';
import { mon_mr } from './monmr_data.js';
import { is_undead_flag, is_demon_flag, humanoid, nohands, hides_under_flag } from './monflags_data.js';
import { couldsee, Blind } from './vision.js';
import { align_gname, halu_gname } from './role.js';
import { map_invisible, doredraw } from './display.js';
import { STATUE, objects, place_object, weight, COIN_CLASS, CORPSE, STRANGE_OBJECT } from './mkobj.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
import { delobj, stackobj, doddrop, yname, ysimple_name,
         flush_addinv_plines } from './invent.js';
import { count_unpaid, is_worn, wearing_armor, inventoryArray, select_off,
         dismiss_invent_screen } from './invent.js';
import { exercise } from './attrib.js';
import { livelog_printf, LL_WISH, LL_CONDUCT, LL_ARTIFACT } from './livelog.js';
import { rn2 } from './rng.js';
import { A_STR, A_WIS, A_DEX, POLY_CONTROLLED, UNENCUMBERED } from './const.js';
import { getpos, get_valid_jump_position, set_jumping_is_magic, is_valid_jump_pos, getpos_render, jump_landing, jump_hilite_first_cursor, do_run, do_run_prefixed, do_look_full, do_farlook } from './hack.js';
import { dotwoweapon } from './wield.js';
import { doride } from './steed.js';
import { doenhance } from './enhance.js';
import { dorub, dowipe, doapply, ECMD as APPLY_ECMD } from './apply.js';
import { readobjnam } from './readobjnam.js';
import { hold_another_object, encumber_msg, objects_at, otense, will_feel_cockatrice,
         feel_cockatrice, obj_extract_self } from './invent.js';
import { cxname, The, thesimpleoname, simpleonames } from './objnam.js';
import { artifact_origin } from './artifact.js';
import { ONAME_WISH, ONAME_KNOW_ARTI, IRONBARS, ICE, Is_airlevel,
         Is_waterlevel, PICK_ONE } from './const.js';
import { begin_burn } from './timeout.js';
import { rn1 } from './rng.js';
import { HORN_OF_PLENTY, TALLOW_CANDLE, WAX_CANDLE, POT_OIL, OIL_LAMP, MAGIC_LAMP,
         CAN_OF_GREASE, FOOD_RATION, CRAM_RATION, LEMBAS_WAFER, VENOM_CLASS,
         POTION_CLASS } from './mkobj.js';
import { getobj, GETOBJ_PROMPT, consume_obj_charge, ansimpleoname, count_buc,
         BUC_BLESSED, BUC_CURSED, BUC_UNCURSED, BUC_UNKNOWN } from './invent.js';
// query_category's BUC menu tokens -> pickup.c BUC_* classes (count_buc() types).
const BUC_OF_TOKEN = { get B() { return BUC_BLESSED; }, get C() { return BUC_CURSED; },
    get U() { return BUC_UNCURSED; }, get X() { return BUC_UNKNOWN; } };
import { container_at, able_to_loot, tipcontainer, tip_ok, menu_style,
         u_handsy, add_valid_menu_class, allow_category } from './pickup.js';
import { MENU_TRADITIONAL, EXT_ENCUMBER, OBJ_FREE, OBJ_FLOOR } from './const.js';
import { is_pool, is_lava } from './dbridge.js';
import { vtense } from './dothrow.js';
import { tiphat } from './sounds.js';
import { dopray as pray_dopray, dosacrifice } from './pray.js';
import { dosit } from './sit.js';
import { do_mgivenname, bogusmon, roguename, rndmonnam } from './do_name.js';
import { rn2_on_display_rng } from './disprng.js';
import { glyph_at, Hallucination_u } from './display.js';
import { object_from_map } from './pager.js';
import { dodip, dodrink } from './potion.js';
import { dogenocided, do_gamelog, doconduct, dovanquished, doborn } from './insight.js';
import { isok } from './hacklib.js';
import { Monnam, canspotmon, mon_nam, oc_wldam, killed } from './uhitm.js';
import { domonnoise } from './sounds.js';
import { build_overview_lines, surface, ceiling, print_dungeon_lines } from './dungeon.js';
import { doextversion, doversion } from './version.js';
import { name_to_pmidx, monster_by_pmidx } from './makemon.js';
import { polyok_flag } from './monflags_data.js';
import { polymon, newman, domonability, PM_HUMAN } from './polyself.js';
import { obj_resists, dozap, wishcmdassist, wish_history_add } from './zap.js';
import { timed_prop, wiz_timeout_queue } from './timeout.js';
import { dobugreport } from './report.js';
import { docast, dowizcast } from './spell.js';
import { dodown, doup } from './do.js';
import { doengrave } from './engrave.js';
import { dotogglepickup } from './options.js';
import { doclassdisco, rename_disco } from './o_init.js';
import { doread } from './read.js';
import { dotelecmd } from './teleport.js';
import { doset, dosetSimple } from './doset.js';
import { wiz_light_sources } from './light.js';
import { wiz_debug_cmd_bury } from './dig.js';
import { doeat } from './eat.js';
import { dohelp, hmenu_dohistory } from './pager.js';
import { dokick } from './dokick.js';
import { invoke_ok as artifact_invoke_ok } from './artifact.js';
import { doextlist } from './cmd.js';
import { mon_beside, loot_mon, reverse_loot, removed_from_icebox } from './pickup.js';

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

// The extended-command table.  C ref: cmd.c extcmdlist[]: [ef_txt, flagbits,
// ef_desc].  Only the matching-relevant flag bits are kept (AUTOCOMPLETE/
// WIZMODECMD/CMD_NOT_AVAILABLE/INTERNALCMD); order mirrors C so matchlist
// indexes stay stable.  ef_desc is null for INTERNALCMD entries, as in C.
// Recorder build defines DEBUG, so every #ifdef DEBUG/NH_DEVEL_STATUS entry is present.
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

// Render the top-line getline prompt: clear row 0, draw "<query> <buf>", cursor
// parked right after the typed text (the autocompleted tail draws, but the
// cursor sits at the end of what was actually typed).
// C ref: win/tty/getline.c hooked_tty_getlin(); topl.c topl_putsym() wraps HARD
// at col 79 (`curx==CO-1 -> topl_putsym('\n')`), distinct from display.js's
// wrap_topl() word-wrap for update_topl — don't reuse that here.  Unaffected
// when query+buffer stays under 79 chars (the ordinary case).
const TOPL_CO = 80;
const TOPL_WRAP = TOPL_CO - 1;
function draw_getlin(query, shown, cursorCol) {
    const disp = game?.nhDisplay;
    if (!disp?.setCell) return;
    const line = query + ' ' + shown;
    const rows = Math.max(1, Math.ceil(line.length / TOPL_WRAP));
    // C ref: tty_clear_nhwindow(NHW_MESSAGE) -> docorner(1, cury+1, 0) blanks
    // the rows the previous (longer) top line spilled onto and redraws the map
    // cells on them (row_refresh).
    const clearRows = Math.max(rows, game._getlin_rows || 1);
    for (let r = 0; r < clearRows && r < disp.rows; r++)
        for (let c = 0; c < disp.cols; c++) disp.setCell(c, r, ' ', NO_COLOR, 0);
    for (let r = Math.max(rows, 1); r < clearRows && r < disp.rows; r++)
        render_map_row_to_grid(r);
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

// C ref: win/tty/getline.c hooked_tty_getlin() — reads a line at the top line
// with an optional completion hook; each keystroke is its own captured screen
// frame.  Returns the typed string, or "\x1b" if escaped from an empty buffer.
export async function hooked_tty_getlin(query, hook) {
    // C ref: win/tty/getline.c hooked_tty_getlin():53-54 — a pending top-line
    // message (toplin==NEED_MORE) is paged with --More-- before the getlin
    // prompt draws; ordinary command-initiated getlins already start with a
    // cleared top line, so this is a no-op for them (e.g. a confused scroll's
    // message before a level-teleport prompt, or #migratemons' "No monsters
    // currently migrating." before its own prompt).  pline() marks pending only
    // "softly" (game._toplinSoft, not _toplin — see pline()'s own comment); C's
    // toplin is unified and getline.c checks it unconditionally, so this reader
    // must catch both.
    const cur = game._pending_message || '';
    const softPending = !!cur && game._toplinSoft === cur;
    if ((game._toplin === 1 || softPending) && !game._winStop) {
        await topl_more();
    }
    if (game._toplin === 1 || softPending) {
        game._pending_message = '';
        game._toplin = 0;
        game._toplinSoft = null;
    }
    game._winStop = false;
    // C ref: getline.c:67 — the prompt is a SUPPRESS_HISTORY line, which
    // remember_topl()s whatever was on the top line.
    remember_topl();
    // C ref: getline.c:67 custompline(OVERRIDE_MSGTYPE | SUPPRESS_HISTORY,
    // "%s ", query) — vpline() still copies the prompt into gp.prevmsg, so a
    // Norep() message identical to the one before this getlin is shown again.
    game._prevmsg = `${query} `;

    // C ref: getline.c: tty_get_ext_cmd() sets suppress_history, so only that
    // prompt leaves nothing in the ^P history; any other getlin leaves
    // "<query> <typed text>" as the current message.
    const suppress_hist = hook === ext_cmd_getlin_hook;
    remember_topl();
    let typed = '';   // what the user actually typed (obufp/bufp content)
    let shown = '';   // what is displayed (typed, possibly autocompleted)
    let doprev = false;
    const base = (query + ' ').length; // column of first input char

    for (;;) {
        // Cursor sits one past the typed characters.
        if (!doprev) draw_getlin(query, shown, base + typed.length);
        // C ref: getline.c:81 — recall includes the current query and answer.
        game._toplines = query + ' ' + shown;
        const code = await nhgetch();

        if (code === 27) { // ESC
            if (typed.length > 0) {
                // Clear current contents and keep prompting from the start.
                typed = '';
                shown = '';
                doprev = false;
                msghist().maxcol = msghist().maxrow;
                game._pending_message = '';
                game._toplin = 0;
                game._toplinSoft = null;
                continue;
            }
            if (!suppress_hist) yn_prompt_history(`${query} `, '');
            else game._toplines = ''; // C getline.c:217-220
            return '\x1b';
        }
        // C ref: getline.c:106-140 — temporarily leave the reader for ^P.
        if (code === 16) {
            const { doprev_message } = await import('./cmd.js');
            const mode = String(game.iflags?.prevmsg_window ?? 's')[0].toLowerCase();
            if (mode === 's' || (mode === 'c' && !doprev)) {
                if (!doprev) await doprev_message(); /* need two initially */
                await doprev_message();
                doprev = true;
            } else {
                await doprev_message();
                doprev = false;
                msghist().maxcol = msghist().maxrow;
            }
            continue;
        }
        if (doprev) {
            // Unlike yn_function(), getlin processes the key ending recall.
            doprev = false;
            msghist().maxcol = msghist().maxrow;
            game._pending_message = '';
            game._toplin = 0;
            game._toplinSoft = null;
        }
        if (code === 13 || code === 10) { // newline: done
            // C ref: ext_cmd_getlin_hook() writes the unique completion into the
            // buffer (obufp), so Return returns the completed command name, not
            // just what was typed (e.g. "l" -> "loot").  `shown` already holds
            // that completion (or the raw typed text when none applies).
            if (!suppress_hist) yn_prompt_history(`${query} `, shown);
            else game._toplines = ''; // C getline.c:217-220
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
        // C ref: getline.c:196 `c == kill_char || c == '\177'` — the pty's
        // VKILL is ^U (unixtty.c kill_char = inittyb.kill_sym); it erases the
        // whole typed line, echoing "\b \b" per character.
        if (code === 21) {
            typed = '';
            shown = '';
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
// C ref: cmd.c extcmd_via_menu(), reached from getline.c tty_get_ext_cmd() when
// iflags.extmenu is set: '#' shows a PICK_ONE menu of AUTOCOMPLETE commands
// instead of the type-in prompt.  Each pick appends its accelerator to cbuf and
// re-filters until exactly one command remains — that's the selection.

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
    // end_menu(win, (char *) 0) — no prompt, so no blank + prompt entries.
    const body = items.map((it) => ({ ...it, text: (it.sel ? it.sel + ' - ' : '') + it.text,
                                      sel: it.sel }));
    const flat = promptStr == null ? body : [
        { text: promptStr, attr: ATR_INVERSE },
        { text: '' },
        ...body,
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
    renderMenuLines(page, null);   // null: cursor parks after "(end)", as tty does
    // C ref: wintty.c erase_menu_or_text() — the previous (full-screen) menu was
    // torn down by docrt(), whose cls() blanked the status window and only set
    // disp.botlx; no bot() runs before this overlay is drawn, so rows 22-23
    // stay blank until the command finishes.
    if (m.statusBlank) {
        const disp = game.nhDisplay;
        for (const r of [22, 23])
            for (let c = 0; c < (disp.cols ?? 80); c++) disp.setCell(c, r, ' ', NO_COLOR, 0);
    }
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
    let ret = 0, cbuf = '', matchlevel = 0, biggest = 0, statusBlank = false;
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
        m.statusBlank = statusBlank;
        const picked = await extcmd_select_menu(m);
        // destroy_nhwindow() -> erase_menu_or_text(): a full-screen menu
        // docrt()s the map back before the chosen command runs.
        await dismiss_invent_screen();
        statusBlank = statusBlank || !!m.fullscreen;   // docorner() of a later overlay doesn't repaint it
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
    // docrt()'s cls() blanked the status window; the next bot() (flush_screen)
    // repaints it, which a command's own getlin prompt does not trigger.
    if (statusBlank) {
        game._statusClsBlank = true;
        game.botlx = true;
        const disp = game.nhDisplay;
        for (const r of [22, 23])
            for (let c = 0; c < (disp.cols ?? 80); c++) disp.setCell(c, r, ' ', NO_COLOR, 0);
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
    // resp == null (free-form prompt): any single key is accepted and returned.
    return await y_n(query, resp, def);
}

// ── individual extended commands ──

// C ref: zap.c resist(mtmp, oclass, damage, tell) — generic magic-resistance
// check: `oclass` sets the attack level, monster m_lev is the defense level,
// draw is rn2(100 + alev - dlev) < mtmp->data->mr (mr 0 still costs a draw).
// Ported here for #turn; damage is always 0 there so the kill tail is a no-op.
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

// C ref: pray.c doturn() — the #turn command (Knights/Priests; other roles
// fall back to the turn-undead spell).  Was entirely unimplemented: seed4500's
// `#turn` drew none of C's stream (exercise(A_WIS,TRUE) rn2(19) at step 643,
// per-monster iteration cost, nomul(-(5-(ulevel-1)/6)) paralysis spanning turns).
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

    u.uconduct ||= {};
    u.uconduct.gnostic |= 0; // `undefined++` is NaN, which would stay falsy forever
    if (!u.uconduct.gnostic++)
        livelog_printf(LL_CONDUCT, 'rejected atheism by turning undead');

    // halu_gname(): the hero's god, or a hallucinatory one (display rng).
    const Gname = halu_gname(u?.ualign?.type ?? 0);

    // C ref: pray.c doturn(). A lawful or neutral hero in demon, undead or
    // vampshifter form, or one whose god is very angry, is ignored: aggravate()
    // and abuse wisdom, using a move.
    const ydata = u?.Upolyd ? (u.data || null) : null;
    const { is_vampshifter, aggravate, monflee } = await import('./monmove.js');
    if (((u?.ualign?.type ?? 0) !== -1 /* A_CHAOTIC */
         && ((ydata && (is_demon_flag(ydata) || is_undead_flag(ydata)))
             || (g.youmonst && is_vampshifter(g.youmonst))))
        || (u?.ugangr | 0) > 6) {
        await pline(`For some reason, ${Gname} seems to ignore you.`);
        aggravate();
        exercise(A_WIS, false);
        return 1;
    }
    const { In_hell } = await import('./dungeon.js');
    if (In_hell(u?.uz)) {
        await update_topl(`Since you are in Gehennom, ${Gname} ${
            Gname === 'Moloch' ? "won't" : "can't"} help you.`);
        aggravate();
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
                    // C: killed(mtmp) destroys the undead outright — uhitm.js's
                    // killed() is the real xkilled() port (js/mon.js has neither
                    // name); its "You destroy the %s!" update_topl() triggers the
                    // mid-xkilled() --More-- against doturn()'s pending
                    // "Calling upon..." line.
                    await killed(mtmp);
                }
            } else {
                // C ref: pray.c:2405 — includes flee feedback and track reset.
                await monflee(mtmp, 0, false, true);
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

// C ref: apply.c dojump()/jump(). The recorded knight (innate Jumping) reaches
// "Where do you want to jump?" then getpos() targeting; a pick is validated
// with is_valid_jump_pos(showmsg=TRUE) (fail -> message, no time, ECMD_FAIL); a
// valid non-self target hurtles the hero (teleds), rolls morehungry(rnd(25)),
// and costs a turn (ECMD_TIME).
// C ref: youprop.h `Jumping = HJumping || EJumping`. HJumping is set
// FROMOUTSIDE for knights (u_init.c:691); the only extrinsic source is
// objects[JUMPING_BOOTS].oc_oprop == JUMPING, which js/mkobj.js DOES carry and
// js/invent.js worn_extrinsics_on() now installs into the extrinsic word, so
// this should become `worn_extrinsic(JUMPING)` when the accessor conversion
// lands.  Until then the worn item stands in.
function Jumping() {
    const u = game.u;
    if (u?.uprops?.Jumping || u?.HJumping || u?.EJumping) return true;
    const PM_KNIGHT_ROLE = 4;                          // roles[] index
    if ((game.urole?.mnum ?? -1) === PM_KNIGHT_ROLE) return true;
    const JUMPING_BOOTS_OTYP = 168;                    // js/mkobj.js:137
    return game.uarmf?.otyp === JUMPING_BOOTS_OTYP;
}

async function dojump() {
    /* Physical jump */
    return await jump(0);
}

// C ref: apply.c jump(magic) — magic 0 = physical, otherwise the skill level
// of the jumping spell.  Returns 1 (ECMD_TIME) when a turn passes, else 0.
export async function jump(magic) {
    // C ref: apply.c jump():1990 — attempt the "jumping" spell if the hero has
    // no innate jumping ability.
    if (!magic && !Jumping()) {
        const { known_spell, spe_Fresh, spelleffects_ext } = await import('./spell.js');
        const SPE_JUMPING = 404;
        if (known_spell(SPE_JUMPING) >= spe_Fresh)
            return (await spelleffects_ext(SPE_JUMPING)) & 1; /* ECMD_TIME */
    }
    // C ref: apply.c jump():2001 `else if (!magic && !Jumping) { You_cant("jump
    // very far"); return ECMD_OK; }` — without innate/worn jumping the prompt
    // never appears. (The nolimbs/slithy check needs polymorph state this port
    // doesn't carry.)
    if (!magic && !Jumping()) {
        await pline("You can't jump very far.");
        return 0;                                      // ECMD_OK
    }
    if (game.u?.uswallow) {
        if (magic) { await pline('You bounce around a little.'); return 1; }
        await pline("You've got to be kidding!");
        return 0;
    }
    if (game.u?.uinwater) {
        if (magic) { await pline('You swish around a little.'); return 1; }
        await pline('This calls for swimming, not jumping!');
        return 0;
    }
    if (game.u?.uprops?.Levitation || Is_airlevel(game.u?.uz) || Is_waterlevel(game.u?.uz)) {
        if (magic) { await pline('You flail around a little.'); return 1; }
        await pline("You don't have enough traction to jump.");
        return 0;
    }
    if (!magic && near_capacity() > UNENCUMBERED) {
        await pline('You are carrying too much to jump!');
        return 0;
    }
    // C ref: apply.c jump():  pline("Where do you want to jump?"); cc = <u>;
    // getpos_sethilite(...); getpos(&cc, TRUE, "the desired position").
    // C places the cursor on the hero (curs WIN_MAP) and flush_screen()s with
    // the prompt before getpos()'s first readchar blocks.  There is NO --More--:
    // handle_tip(TIP_GETPOS) only fires a (no-op) Lua hook, it does not page.
    const u = game.u;
    await pline('Where do you want to jump?');
    // C ref: getpos() -> handle_tip(TIP_GETPOS): the FIRST getpos() use shows a
    // tty NHW_TEXT tip window, which pages the pending message first (a trailing
    // --More--) then renders the tip text via getpos_tip(); every later use
    // suppresses both (no --More--, no tip text — cursor goes straight to the
    // hero).  Gated here with the TIP_GETPOS flag (1<<4) so only the first
    // #jump pages the prompt.
    const TIP_GETPOS = 1 << 4;
    const tipPending = !((game.context?.tips || 0) & TIP_GETPOS);
    if (tipPending) {
        await topl_more();
    } else {
        await getpos_render('Where do you want to jump?', u.ux, u.uy);
        // C's pline() left toplin == NEED_MORE, so getpos()'s "(For
        // instructions type a '?')" MERGES onto this line (see dotravel()).
        game._toplin = 1; // TOPLIN_NEED_MORE
        // C ref: getpos.c getpos() opening `curs(WIN_MAP,u.ux,u.uy);
        // flush_screen(0)`. jump()'s getpos_sethilite() marks every valid jump
        // position gnew (selection_force_newsyms -> newsym_force); the opening
        // flush redraws those cells, leaving the cursor one past the last
        // (row-major) one rather than on the hero.  Reproduce that first-frame
        // placement (later frames track <cx,cy>).
        const hc = jump_hilite_first_cursor();
        if (hc) { const disp = game.nhDisplay; if (disp?.setCursor) disp.setCursor(hc[0], hc[1]); }
    }
    // getpos with force=TRUE (jump/teleport targeting): unknown keys keep the
    // loop alive, the '(invalid target)' suffix uses get_valid_jump_position.
    set_jumping_is_magic(magic);
    const cc = await getpos('the desired position', u.ux, u.uy,
                            (x, y) => get_valid_jump_position(x, y), /*force=*/true,
                            /*verbose=*/game.flags?.verbose !== false);
    if (!cc) return 0; // ESC -> ECMD_CANCEL (no time)

    // is_valid_jump_pos(showmsg=TRUE): emits "Illegal move!" / "Too far!" /
    // "There is an obstacle preventing that jump." on failure -> ECMD_FAIL.
    if (!(await is_valid_jump_pos(cc.x, cc.y, /*showmsg=*/true, magic))) {
        return 0;
    }
    // (no steed: the "isn't capable of jumping in place" branch is N/A)
    // Jumping onto the hero's own spot in the recorded sessions never happens
    // when not trapped (an in-place jump on empty floor is free, ECMD_OK), and
    // the knight here is never trapped.  Treat a same-spot pick as a free no-op.
    if (cc.x === u.ux && cc.y === u.uy) {
        await pline(u.uhallu ? 'You hop up and down a bit.' : 'You decide not to jump after all.');
        return 0;
    }
    // Perform the jump: walk_path/hurtle (RNG-inert over open floor) then
    // teleds(cc) relocates the hero; morehungry(rnd(25)) is then rolled.
    await jump_landing(cc.x, cc.y);
    return 1; // ECMD_TIME — the move loop advances a turn (monsters move).
}

// C ref: wizcmds.c wiz_level_change(): getlin a target level, then drive
// pluslvl()/losexp() to reach it.  Each level gain prints "You feel more
// experienced."+"Welcome to experience level N." (plus adjabil messages);
// the topline accumulates two per line, --More--ing via update_topl when full.
// pluslvl/losexp roll the per-level newhp()/newpw() RNG.
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

// C ref: sounds.c dochat() — the #chat command.  Starter heroes can speak and
// never stand on shop merchandise, so the modelled path is getdir("Talk to
// whom?...") then, for an adjacent square, talk to a monster (domonnoise) /
// statue / wall / empty air.  getdir draws no RNG; domonnoise() costs a turn
// (ECMD_TIME) only when it talks to a real monster.
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
    // C ref: sounds.c dochat():1912 — `if (!Deaf && !Blind && (otmp =
    // shop_object(u.ux, u.uy)) != 0) { price_quote(otmp); return ECMD_TIME; }`.
    // Standing on shop merchandise makes the shopkeeper quote the price INSTEAD
    // of asking for a direction, and it costs a turn.  shop_object() already
    // screens for "inside a shop, shopkeeper present, not angry, not asleep,
    // not mute, and something here other than gold".
    if (!Deaf_hero_chat() && !Blind()) {
        const { shop_object, price_quote } = await import('./shk.js');
        const otmp = shop_object(u.ux, u.uy);
        if (otmp) {
            await price_quote(otmp);
            return 1; /* ECMD_TIME */
        }
    }
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
            // C guards the message with !Blind; a hallucinating hero sees a
            // rndmonnam() (display rng) instead of "statue".
            if (!Blind())
                await update_topl(`The ${Hallucination_u() ? rndmonnam().name : 'statue'} seems not to notice you.`);
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
    // Costs 2 public steps on seed0367 (chatting to the Arch Priest un-freezes
    // the quest leader, whose freed m_move then diverges from C's).  Restore
    // once a freed STRAT_CLOSE leader moves the way C's does — a real
    // omission, not a no-op.
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
// C ref: wizcmds.c:32 wiz_wish() sets flags.verbose=FALSE (suppressing "You may
// wish for an object.") then calls makewish() (zap.c:6314): prompts "For what
// do you wish?", parses with readobjnam(), creates+holds the object, then rolls
// u.ublesscnt += rn1(100, 50) (recorded as rn2(100) @ makewish(zap.c:6421)).
// readobjnam()'s own draw is rn2(maxprob) @ rnd_otyp_by_namedesc, plus
// rn2(nartifact_exist()) for an artifact wish; mksobj() supplies creation RNG.
const MAXWISHTRY = 5;
// Exported so cmd.js can bind the C('w') keymap entry (cmd.c:2000-2001) in
// addition to the '#wizwish' extended command both route here.
export async function wiz_wish() {
    if (!isWizard()) return 0;
    // C ref: wizcmds.c:33-39 — wiz_wish() saves flags.verbose, clears it for
    // the duration of makewish(), then restores it.  Besides suppressing the
    // "You may wish for an object." line (which makewish() itself prints under
    // flags.verbose), this silences every other verbose-gated message the wish
    // reaches, most visibly xprname()'s " (<N> in total)." suffix when the
    // wished stack merges into one already carried (invent.c prinv/xprname).
    const flags = (game.flags ||= {});
    const save_verbose = flags.verbose;
    flags.verbose = false;
    try {
        await makewish();
    } finally {
        flags.verbose = save_verbose;
    }
    // C ref: wizcmds.c:40 — wiz_wish() calls encumber_msg() itself right after
    // makewish() returns.  The wish costs no game time, so the moveloop's own
    // encumber_msg() (allmain.c:208, inside `if (context.move)`) never runs for
    // it; without this call, a wish crossing a capacity threshold would defer
    // its load message to whichever later command finally consumes a move.
    await encumber_msg();
    // C ref: wizcmds.c:43 returns ECMD_OK; cmd.c:3814 rhack() then runs
    // reset_cmd_vars(), whose `gm.multi = 0` cancels the multi = -1 a
    // declined death (end.c:730 savelife) left behind, so no turn passes and
    // the "You survived..." nomovemsg is never announced.
    const { reset_cmd_vars } = await import('./cmd.js');
    reset_cmd_vars(false);
    return 0;
}

// Exported for zap.js's WAN_WISHING zap, potion.js's djinni and allmain.js's
// Amulet wish, which all reach the same C function.
// C ref: zap.c:6314 makewish().
export async function makewish() {
    const u = game.u || {};
    const uc = (u.uconduct ||= {});
    const oldwisharti = uc.wisharti || 0;
    const cmdassist = game.iflags?.cmdassist !== false;   /* C default on */
    let tries = 0;
    let r = null, bufcpy = '';

    if (game.flags?.verbose !== false)
        await pline('You may wish for an object.');
    for (;;) {
        const prompt = (cmdassist && tries > 0)
            ? 'For what do you wish (enter \'help\' for assistance)?'
            : 'For what do you wish?';
        let buf = mungspaces(await getlin_top(prompt));
        if (buf.length && buf[0] === '\x1b') {
            buf = '';
        } else if (strcmpi_eq(buf, 'help')) {
            await wishcmdassist(MAXWISHTRY - tries);
            continue;
        }
        bufcpy = buf;
        r = readobjnam(buf);
        if (!r || r.kind == null) {
            await pline('Nothing fitting that description exists in the game.');
            if (++tries < MAXWISHTRY) continue;
            await pline("That's enough tries!");
            r = readobjnam(null);
            if (!r || r.kind !== 'obj') return; /* for safety; should never happen */
        } else if (r.kind === 'nothing') {
            /* explicitly wished for "nothing", presumably attempting
               to retain wishless conduct */
            livelog_printf(LL_WISH, 'declined to make a wish');
            return;
        } else if (r.kind === 'hands') {
            // C ref: zap.c makewish() `else if (otmp == &hands_obj)` — a
            // wizard-mode trap/terrain wish or a denied artifact: no object,
            // so no hold and no ublesscnt bump.  readobjnam() is synchronous,
            // so its pline()s come back as a list.
            for (const m of r.messages || [])
                if (typeof m === 'function') await m(); /* deferred effect (pooleffects) */
                else await pline(m);
            wish_history_add(bufcpy);
            return;
        }
        break;
    }
    wish_history_add(bufcpy);
    const otmp = r.obj;

    // The two readobjnam() steps that need input or async work here; both
    // are RNG-free and silent, so performing them right after the parse keeps
    // C's message and RNG order.
    // C ref: objnam.c:5062-5066 — y_n("Override glob weight limit?").
    if (r.globweight && await y_n('Override glob weight limit?') === 'y')
        otmp.owt = r.globweight.base_owt * r.globweight.cnt;
    // C ref: objnam.c:5086-5092 — a wished-for lit light source is placed on
    // the hero's square so begin_burn() can attach its light source and burn
    // timer, then extracted again for the caller.
    if (r.lightit) {
        place_object(otmp, u.ux, u.uy);
        await begin_burn(otmp, false);
        obj_extract_self(otmp);
    }

    if (otmp.oartifact) {
        /* update artifact bookkeeping; doesn't produce a livelog event */
        artifact_origin(otmp, ONAME_WISH | ONAME_KNOW_ARTI);
    }

    // C ref: zap.c makewish() — the wish is chronicled BEFORE the object is
    // held: request echoed verbatim, result rendered by doname() (an unheld,
    // letter-less object).  uhis() is genders[flags.female].his (you.h).
    {
        const maybe_LL_arti = (oldwisharti < (uc.wisharti || 0)) ? LL_ARTIFACT : 0;
        const wish = `"${bufcpy}", got "${obj_doname(otmp)}"`;
        const uhis = game.flags?.female ? 'her' : 'his';
        if (!(uc.wishes || 0))
            livelog_printf(LL_CONDUCT | LL_WISH | maybe_LL_arti,
                           `made ${uhis} first wish - ${wish}`);
        else if (!oldwisharti && uc.wisharti)
            livelog_printf(LL_CONDUCT | LL_WISH | LL_ARTIFACT,
                           `made ${uhis} first artifact wish - ${wish}`);
        else
            livelog_printf(LL_WISH | maybe_LL_arti, `wished for ${wish}`);
        uc.wishes = (uc.wishes || 0) + 1;
    }

    // readobjnam() already set otmp.wishedfor for an unsafe corpse (C does it
    // here; the result is the same since nothing in between reads it).
    const airlevel = Is_airlevel(u.uz);
    const corpse_wished = otmp.otyp === CORPSE && !!otmp.wishedfor;
    const verb = (airlevel || u.uinwater) ? 'slip'
        : corpse_wished ? 'materialize' : 'drop';
    const typ = game.level?.at(u.ux, u.uy)?.typ;
    const oops_msg = u.uswallow ? 'Oops!  %s out of your reach!'
        : (airlevel || Is_waterlevel(u.uz) || typ == null
           || typ < IRONBARS || typ >= ICE)
            ? 'Oops!  %s away from you!'
            : !corpse_wished ? 'Oops!  %s to the floor!'
                : 'Careful! %s on the floor!';
    /* The(aobjnam()) is safe since otmp is unidentified -dlc */
    let bp = cxname(otmp);
    if ((otmp.quan ?? 1) !== 1) bp = `${otmp.quan} ${bp}`;
    bp = `${bp} ${otense(otmp, verb)}`;
    await hold_another_object(otmp, oops_msg, The(bp), null);

    if (game.u) game.u.ublesscnt = (game.u.ublesscnt || 0) + rn1(100, 50);
    else rn1(100, 50); /* the gods take notice */
}

function strcmpi_eq(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }

// ── #wizgenesis / ^G (wizcmds.c wiz_genesis -> read.c create_particular) ──
//
// C ref: wizcmds.c:203 wiz_genesis() — create_particular() (read.js owns the
// getlin loop, parse and creation; create_critters() shares it).
export async function wiz_genesis() {
    if (!isWizard()) return 0;
    const { create_particular } = await import('./read.js');
    await create_particular();
    return 0;
}

// ── #polyself (wizcmds.c wiz_polyself -> polyself.c polyself(POLY_CONTROLLED)) ──
//
// C ref: wizcmds.c:568 wiz_polyself() — the whole body is polyself(POLY_CONTROLLED).
// This used to be a hand-rolled getlin loop here, diverging from polyself.c: it
// resolved names via bare exact-match name_to_pmidx() only, skipping the
// is_placeholder() orc/elf/giant substitution and mkclass_poly()'s by-class
// path, never printed "That's enough tries!", and never reverted a poly'd
// wizard who named their own role.  js/polyself.js's polyself() is the
// faithful port; delegate to it instead.
export async function wiz_polyself() {
    if (!isWizard()) return 0;
    const { polyself } = await import('./polyself.js');
    await polyself(POLY_CONTROLLED);
    // C ref: wizcmds.c:571 returns ECMD_OK -> cmd.c:3814 reset_cmd_vars()
    // (see wiz_wish above).
    const { reset_cmd_vars } = await import('./cmd.js');
    reset_cmd_vars(false);
    return 0;
}

// ── #name / #call (do_name.c docallcmd) ──
//
// Builds the "What do you want to name?" PICK_ONE menu as a tty corner-overlay
// NHW_MENU, then dispatches the chosen sub-action (unmodelled ones are no-ops).
// C ref: do_name.c docallcmd + win/tty/wintty.c tty_display_nhwindow
// (H2344_BROKEN corner-menu offx) + process_menu_window item/morestr layout.

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
    const abc = !!game.flags?.lootabc;
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

    const groups = { m: 'C', i: 'y', o: 'n', f: ',', d: '\\', a: 'l' };
    const entries = [
        { text: 'What do you want to name?', attr: ATR_INVERSE },
        { text: '' },
        ...items.map(it => ({
            text: it.desc,
            item: { value: it.ch, sel: abc ? undefined : it.ch, gsel: groups[it.ch] },
        })),
    ];
    const committed = await select_command_menu(entries, { how: PICK_ONE });
    const ch = committed ? entries.find(entry => entry.item?.selected)?.item.value : 'q';
    await dismiss_invent_screen();

    switch (ch) {
    case 'q':
    default:
        break;
    case 'm': // name a visible monster
        await do_mgivenname();
        break;
    case 'f': // name a type of object on the floor
        await namefloorobj();
        break;
    case 'd': // rename a discovered type
        await rename_disco();
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

// C ref: do_name.c namefloorobj() — the #name/'C' "the type of an object upon
// the floor" choice: pick a map square with getpos(), find the object shown
// there (or under the hero) and offer to call its type.
async function namefloorobj() {
    const u = game.u;
    const hides = u.uundetected && game.youmonst?.data
        && hides_under_flag(game.youmonst.data);
    const buf0 = `object on map (or '.' for one ${hides ? 'over' : 'under'} you)`;
    const cc = await getpos(buf0, u.ux, u.uy, null, /*force=*/false,
                            game.flags?.verbose !== false);
    if (!cc || cc.x <= 0) return;
    let obj = null, fakeobj = false;
    if (cc.x === u.ux && cc.y === u.uy) {
        obj = vobj_at(u.ux, u.uy);
    } else {
        const glyph = glyph_at(cc.x, cc.y);
        if (glyph?.kind === 'object') ({ fakeobj, obj } = object_from_map(glyph, cc.x, cc.y));
    }
    if (!obj) {
        await pline(`There doesn't seem to be any object ${
            cc.x === u.ux && cc.y === u.uy ? 'under you' : 'there'}.`);
        return;
    }
    /* 'obj' might be an instance of STRANGE_OBJECT if target is a mimic */
    const buf = (obj.otyp !== STRANGE_OBJECT)
        ? simpleonames(obj) : (objects[STRANGE_OBJECT]?.name ?? 'strange object');
    const use_plural = (obj.quan ?? 1) > 1;
    if (Hallucination_u()) {
        const female = !!(u.upolyd ? u.mfemale : game.flags?.female);
        const unames = [
            (female && game.urole?.name?.f) ? game.urole.name.f : game.urole?.name?.m,
            rank_of(rn2_on_display_rng(30) + 1, game.urole?.mnum, female),
        ];
        unames[2] = bogusmon().name;
        unames[3] = unames[2];
        unames[4] = roguename();
        unames[5] = 'Wibbly Wobbly';
        await pline(`${The(buf)} ${use_plural ? 'decide' : 'decides'} to call you "${
            unames[rn2_on_display_rng(unames.length)]}."`);
    } else if (call_ok(obj) === GETOBJ_EXCLUDE) {
        await pline(`${use_plural ? 'Those' : 'That'} ${buf} can't be assigned a type name.`);
    } else if (!obj.dknown) {
        await pline(`You don't know ${use_plural ? 'those' : 'that'} ${buf} well enough to name ${
            use_plural ? 'them' : 'it'}.`);
    } else {
        await docall(obj);
    }
    if (fakeobj) obj.where = OBJ_FREE;
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
        (o) => o.where === OBJ_FLOOR && o.ox === u.ux && o.oy === u.uy && pred(o.otyp));
    return objs.length ? objs[0] : null;
}
// Return every floor container at the hero's square (in floor-chain order),
// for #loot's container_at()-driven single-container / multi-container-menu
// split.  C ref: container_at()/do_loot_cont() iterate the floor object list
// at (u.ux, u.uy), testing Is_container().
function floor_boxes_here() {
    const u = game.u;
    if (!u) return [];
    return (game.level?.objects || []).filter(
        (o) => o.where === OBJ_FLOOR && o.ox === u.ux && o.oy === u.uy && is_container_otyp(o.otyp));
}
// C ref: pickup.c doloot_core() lootmon: label — container_at(cc.x, cc.y,
// FALSE) at an arbitrary (not-necessarily-hero) square, used to decide
// whether directional looting found a container instead of a monster.
function has_container_at(x, y) {
    return (game.level?.objects || []).some(
        (o) => o.where === OBJ_FLOOR && o.ox === x && o.oy === y && is_container_otyp(o.otyp));
}
// C ref: lock.c doforce() — scans for Is_box() (large box/chest) only.
function floor_lockbox_here() { return floor_obj_here(is_lockbox_otyp); }
// C ref: lock.c doforce() iterates svl.level.objects[u.ux][u.uy] via nexthere
// and asks about EVERY Is_box() there, not just the first one ('n' continues to
// the next box).  Order matches the floor object chain.
function floor_lockboxes_here() {
    const u = game.u;
    if (!u) return [];
    return (game.level?.objects || []).filter(
        (o) => o.where === OBJ_FLOOR && o.ox === u.ux && o.oy === u.uy && is_lockbox_otyp(o.otyp));
}

// (the status rows of the modal container renders go through putStatusRow())

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
export function draw_corner_window(lines, maxcol, morestr, curPad) {
    const disp = game?.nhDisplay;
    if (!disp?.clearScreen) return;
    const cols = disp.cols || 80;
    // H2344_BROKEN: offx = min(min(82, cols/2), cols - maxcol - 1); text at offx+1.
    let offx = Math.min(Math.min(82, Math.floor(cols / 2)), cols - maxcol - 1);
    if (offx < 0) offx = 0;
    const textCol = offx + 1;
    const moreRow = lines.length;
    // C ref: wintty.c erase_menu_or_text(): dismissal is docorner() (no docrt,
    // no vision_recalc) unless offx == 0; invent.js dismiss_invent_screen() reads this.
    game._menuOffx = offx;
    // C ref: win/tty/wintty.c erase_menu_or_text() -> docorner() — dismissing a
    // taller corner window (content reaching row 22) sweeps cl_end() through
    // the status window, wiping the tail of row 22/23 even though this window's
    // own content never touches them.  invent.js's putStatusLines records that
    // cutoff in game._statusTruncCol; a short window opened right after must
    // inherit it, not draw a freshly recomputed FULL status the real terminal
    // never redrew.
    const carried = game._statusTruncCol;
    disp.clearScreen();
    render_map_to_grid();
    for (let r = 0; r <= moreRow && r < 22; r++)
        for (let c = offx; c < cols; c++) disp.setCell(c, r, ' ', NO_COLOR, 0);
    for (let r = 0; r < lines.length; r++) {
        const ln = lines[r];
        if (ln && ln.text) disp.putstr(textCol, r, ln.text, NO_COLOR, ln.attr || 0);
    }
    disp.putstr(textCol, moreRow, morestr, NO_COLOR, 0);
    // the status rows are redrawn through putStatusRow() below
    // render_map_to_grid() already laid down a FULL fresh status (its own
    // renderStatusLines() call); putstr() never clears past what it writes,
    // so a truncated re-write below must blank the tail itself or the full
    // text it's replacing keeps showing through past the cutoff.
    let cut = null;
    if (moreRow >= 22) {
        // This window's own content reaches into the status rows: truncate at
        // its own left edge (same as invent.js's putStatusLines for the tall
        // single-page menu), combined with any cutoff already inherited.
        cut = (carried != null) ? Math.min(offx, carried) : offx;
        game._statusTruncCol = cut;
    } else if (carried != null) {
        cut = carried;
    }
    putStatusRow(disp, 1, 22, cut);
    putStatusRow(disp, 2, 23, cut);
    if (cut != null) {
        for (let c = cut; c < cols; c++) { disp.setCell(c, 22, ' ', NO_COLOR, 0); disp.setCell(c, 23, ' ', NO_COLOR, 0); }
    }
    disp.setCursor(textCol + morestr.length + (curPad || 0), moreRow);
    game._modal_screen = 'container';
}

// C ref: hacklib.c upstart().
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// C ref: objnam.c safe_qbuf() — "<prefix><name><suffix>", falling back to the
// shorter name and then `lastR` when the result would not fit in QBUFSZ - 1.
function loot_safe_qbuf(qprefix, qsuffix, obj, func, altfunc, lastR) {
    const budget = QBUFSZ - 1 - qprefix.length - qsuffix.length;
    let name = func(obj);
    if (name.length > budget) name = altfunc(obj);
    if (name.length > budget) name = lastR;
    return qprefix + name + qsuffix;
}

// C ref: pickup.c in_or_out_menu().  Build and render the "Do what with <box>?"
// PICK_ONE corner menu.  The menu always offers ':' (look inside) and 'q'
// (quit, pre-selected default when there is no next container); 'o'/'b' appear
// when the container has contents (outokay) and 'i'/'r'/'s' when the hero
// carries other inventory (inokay).
function render_in_or_out_menu(box, outokay, inokay, alreadyused, more_containers,
                               deselected = false) {
    // C ref: in_or_out_menu()'s entries name the box with thesimpleoname().
    const name = thesimpleoname(box);
    // C ref: use_container():3075-3082 — the prompt is safe_qbuf() over
    // yname()/ysimple_name() ("Do what with <the/your/Shk's box>?"), or, when
    // nothing can be taken out and contents are already known (`outmaybe`,
    // which also hides the o/b entries), Yname2()/Ysimple_name2() with " is
    // empty.  Do what with it?" (two spaces after the period).
    const title = outokay
        ? loot_safe_qbuf('Do what with ', '?', box, yname, ysimple_name, 'it')
        : loot_safe_qbuf('', ' is empty.  Do what with it?', box,
                         (o) => capitalize(yname(o)),
                         (o) => capitalize(ysimple_name(o)), 'This');
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


// C ref: end.c container_contents(box, FALSE, FALSE, TRUE) + win/tty
// process_text_window().  Render "Contents of <box>:", a blank line, then the
// sorted content stacks (each with two leading spaces), as a corner window with
// a "--More--" footer.  Sets cknown (we're looking at the contents now).
function render_container_contents(box) {
    box.cknown = 1;
    const name = `the ${box_basename(box.otyp)}`;
    const lines = [{ text: `Contents of ${name}:` }, { text: '' }];
    // sortflags mirror the default options (sortloot=loot, sortpack=on).
    const sorted = sortloot(box.cobj || [], SORTLOOT_LOOT | SORTLOOT_PACK, false, null);
    for (const sli of sorted) {
        if (!sli.obj) break;
        lines.push({ text: '  ' + obj_doname(sli.obj) });
    }
    // putstr width convention: cw.maxcol = max(str.length + 1).
    let maxcol = 0;
    for (const ln of lines) maxcol = Math.max(maxcol, ln.text.length + 1);
    draw_corner_window(lines, maxcol, '--More--', 0);
}

// C ref: pickup.c use_container().  Loot an unlocked, untrapped floor container:
// loop the in/out menu — ':' shows contents (costs a turn), 'q'/ESC quits.
// Take-out and put-in use the class/item menus; stash-one uses getobj with a
// count allowance.  Returns 1 (ECMD_TIME) iff a turn elapsed, else 0.
async function use_container(box, more_containers) {
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
    // selectors of the entries ACTUALLY on the page, plus " 0123456789\033\n\r"
    // + default_menu_cmds; dmore()->xwaitforspace() bells and re-reads for
    // anything outside it.  So a stray key over an open loot menu neither
    // closes it nor leaks into rhack() as a command — the screen just doesn't
    // change.
    let respsel = sel[1]; // ':' look inside is always present
    if (outmaybe) respsel += sel[2] + sel[4];
    if (inokay) respsel += sel[3] + sel[5] + sel[6];
    if (more_containers) respsel += sel[7];
    respsel += sel[8];
    // wintype.h MENU_FIRST_PAGE/LAST/NEXT/PREVIOUS, SELECT_ALL/UNSELECT_ALL/
    // INVERT_ALL, SELECT_PAGE/UNSELECT_PAGE/INVERT_PAGE, SEARCH.
    const MENU_CMDS = '^|><.-@,\\~:';
    // C ref: wintty.c tty_display_nhwindow() NHW_MENU, corner (offx != 0) arm —
    // an unacknowledged top line is paged first, then tty_clear_nhwindow
    // (WIN_MESSAGE) blanks the message window outright: the getobj/#loot
    // prompt that preceded the menu is GONE once it closes; without this the
    // next flush_screen() repainted it.
    if (game._toplin === 1) await topl_more();
    game._pending_message = '';
    game._toplin = 0;
    let deselected = false;
    let c = 'q';
    for (;;) { // repeats iff ':' (look inside) gets chosen
        render_in_or_out_menu(box, outmaybe, inokay, used !== 0, !!more_containers,
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
    // carried container, "The chest" (or "<Shk>'s chest") for one on the floor.
    const emptymsg = `${capitalize(ysimple_name(box))} is empty.`;
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
    else if (action === 's') {
        // C ref: pickup.c:3174-3184 — stash a selected stack (or count), undoing
        // a split if the container rejects it without consuming a turn.
        delete game._modal_screen;
        const { stash_ok, in_container } = await import('./pickup.js');
        const { GETOBJ_ALLOWCNT, unsplitobj } = await import('./invent.js');
        game._pickup = game._pickup || {};
        const saved = game._pickup.current_container;
        game._pickup.current_container = box;
        const obj = await getobj('stash', stash_ok, GETOBJ_PROMPT | GETOBJ_ALLOWCNT);
        if (obj) {
            if (await in_container(obj)) used = 1;
            else unsplitobj(obj);
        }
        game._pickup.current_container = saved;
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
// indicator is '-' (off), '+' (on), or '#' (counted).
// C ref: wintty.c tty_add_menu "%c - " + set_item_state.
function menuItemLine(it) {
    return `${it.letter} ${it.selected ? (it.count > 0 ? '#' : '+') : '-'} ${it.desc}`;
}


// Shared PICK_ANY selection loop for the loot menus: render selection state,
// read one key, apply a menu command (invert/select/deselect all) or toggle
// the matching accelerator, repeat until <return>/space (confirm) or ESC
// (cancel).  Returns the selected items, or null on cancel.  C ref: wintty.c
// process_menu_window() + set_all/unset_all/invert_all under the default
// menuinvertmode 1 (SKIPINVERT entries never bulk-select, only deselect).
async function run_pickany_menu(items, buildLines) {
    // menuitem_invert_test(mode 0) under menuinvertmode 1: non-SKIPINVERT items
    // always toggle; SKIPINVERT items toggle only when already selected.
    const invert_ok = (it) => !it.skipinvert || it.selected;
    let searchBlankTop = false;
    let count = 0, counting = false;
    const toggle = (it, counted, n) => {
        it.selected = counted ? n > 0 : !it.selected;
        it.count = it.selected && counted ? n : -1;
    };
    for (;;) {
        const lines = buildLines();
        let maxcol = '(end) '.length;
        for (const ln of lines) maxcol = Math.max(maxcol, ln.text.length + 2);
        if (searchBlankTop) lines[0] = { text: '' };
        draw_corner_window(lines, maxcol, '(end)', 1);
        const gacc = new Set();
        for (const it of items)
            if (it.groupacc && (it.groupacc !== it.letter || it.groupacc === '$'))
                gacc.add(it.groupacc);
        const key = await nhgetch();
        const ch = String.fromCharCode(key);
        if (!items.some((it) => it.letter === ch) && !gacc.has(ch)
            && !" 0123456789\x1b\r\n><^|@~.,-\\:".includes(ch)) continue;
        // C ref: wintty.c:1563-1615 — Escape stops a pending count first.
        if (ch >= '0' && ch <= '9' && (counting || !gacc.has(ch))) {
            count = count * 10 + key - 48;
            counting = count !== 0;
            continue;
        }
        if (key === 27 && counting) { count = 0; counting = false; continue; }
        const useCount = counting, useN = count;
        count = 0; counting = false;
        if (key === 27) return null;
        if (key === 13 || key === 10) break;
        if (ch === ' ') break;                   // single-page: space confirms
        if (ch === ':') {
            // C ref: wintty.c:1700-1732 — search toggles matching selectable
            // rows, including SKIPINVERT entries, using their stored text.
            const reply = await hooked_tty_getlin('Search for:', null);
            searchBlankTop = true;
            if (reply && reply[0] !== '\x1b') {
                for (const it of items)
                    if (pmatchi(`*${reply}*`, `${it.letter} - ${it.desc}`))
                        toggle(it, useCount, useN);
            }
            continue;
        }
        if (ch === '@' || ch === '~') {           // invert all / current page
            for (const it of items) if (invert_ok(it)) toggle(it, false, -1);
            continue;
        }
        if (ch === '.' || ch === ',') {           // select all / current page
            for (const it of items) if (!it.skipinvert) { it.selected = true; it.count = -1; }
            continue;
        }
        if (ch === '-' || ch === '\\') {          // unselect all / current page
            for (const it of items) { it.selected = false; it.count = -1; }
            continue;
        }
        // C ref: wintty.c process_menu_window() — the gacc[] test runs BEFORE
        // the per-item selector scan, so a key matching some item's GROUP
        // accelerator inverts that whole group (invert_all(acc)); a group
        // accelerator equal to its own item's selector is excluded from gacc,
        // except GOLD_SYM.  Without this, '$' on the "Put in what type of
        // objects?" menu (selector 'b', group '$') selected nothing.
        if (gacc.has(ch)) {
            for (const it of items) if (it.groupacc === ch) {
                it.selected = !it.selected;
                it.count = it.selected && useCount ? useN : -1;
            }
            continue;
        }
        const hit = items.find((it) => it.letter === ch);
        if (hit) toggle(hit, useCount, useN);
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
    const bucCount = (type) => count_buc(cobj, BUC_OF_TOKEN[type]);
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
    let invlet = show_a ? 'b' : 'a';
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
// BUCX_TYPES), called from do_wear.c menu_remarm() — the 'A' class filter.
// WORN_TYPES sets ofilter = is_worn, so only worn/wielded items contribute to
// the class list AND the BUC counts.  CHOOSE_ALL is NOT passed, so there's no
// 'A' auto-select entry or hint line.
async function query_category_takeoff() {
    const worn = inventoryArray().filter(is_worn);
    const order = game?.flags?.inv_order || DEFAULT_INV_ORDER;
    const presentClasses = order.filter((oc) => worn.some((o) => o.oclass === oc));
    const ccount = presentClasses.length;

    const bucCount = (type) => count_buc(worn, BUC_OF_TOKEN[type]);
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

// C ref: do_wear.c:3022 doddoremarm() — select removable slots, then start
// or resume the take_off occupation; the occupation accounts for game time.
export async function doddoremarm() {
    const g = game;
    const { takeoff_ctx, take_off } = await import('./do_wear.js');
    const doff = takeoff_ctx();
    if (doff.what || doff.mask) {
        await pline(`You continue ${doff.disrobing}.`);
        g._takeoff_occupation = true;
        return 0;
    }
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
    for (const obj of chosen) await select_off(obj);
    if (doff.mask) {
        doff.disrobing = (doff.mask & ~WEAPON_SLOT_MASK) ? 'disrobing' : 'disarming';
        g._takeoff_occupation = !!(await take_off());
    }
    return 0; /* ECMD_OK: take_off() accounts for the time itself */
}
// Worn-mask bits for the three weapon slots (js/invent.js QW_* convention).
const WEAPON_SLOT_MASK = 0x100 | 0x200 | 0x400;

// C ref: pickup.c menu_loot(retry=0, put_in=FALSE) for menustyle:Full — pick the
// object classes ("Take out what type of objects?"), then the items ("Take out
// what?"), then out_container() each.  Returns the number removed (>0 => a turn
// elapsed).
async function menu_loot_out(box) {
    const picks = await query_category_take_out(box);
    if (!picks || picks.length === 0) return 0;

    // C ref: pickup.c menu_loot() — the picks feed add_valid_menu_class(), and
    // allow_category() then ANDs the class / BUC filter types together.
    let autopick = false, all_categories = false, loot_everything = false;
    add_valid_menu_class(0);
    for (const p of picks) {
        if (p === 'A') loot_everything = autopick = true;
        else if (p === 'ALL') all_categories = true;
        else {
            add_valid_menu_class(typeof p === 'number' ? DEF_OC_SYMS[p] : p);
            loot_everything = false;
        }
    }
    const allow = (o) => loot_everything || all_categories || allow_category(o);

    let chosen;
    if (autopick) {
        box.cknown = 1;   // C: menu_loot(): !put_in -> current_container->cknown = 1
        chosen = (box.cobj || []).filter(allow);
    } else {
        box.cknown = 1;   // C: set just before query_objlist() on the take-out side
        chosen = await query_objlist_take_out(box, all_categories ? () => true : allow);
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
        obj.where = OBJ_FREE;
        box.owt = weight(box);
        if (box.otyp === ICE_BOX_OTYP) removed_from_icebox(obj);
        const otmp = addinv(obj);
        await flush_addinv_plines();
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

    const bucCount = (type) => count_buc(inv, BUC_OF_TOKEN[type]);
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
    let invlet = show_a ? 'b' : 'a';
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

    // C ref: pickup.c menu_loot() pick handling (see menu_loot_out).
    let autopick = false, all_categories = false, loot_justpicked = false;
    let loot_everything = false;
    add_valid_menu_class(0);
    for (const p of picks) {
        if (p === 'A') loot_everything = autopick = true;
        else if (p === 'P') {
            loot_justpicked = true;
            add_valid_menu_class('P');
            loot_everything = false;
        } else if (p === 'ALL') all_categories = true;
        else {
            add_valid_menu_class(typeof p === 'number' ? DEF_OC_SYMS[p] : p);
            loot_everything = false;
        }
    }
    const allow = (o) => loot_everything || all_categories || allow_category(o);

    let chosen;
    if (autopick) {
        chosen = inventoryArray().filter(allow);
    } else if (loot_justpicked
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
    return await use_container(obj, false);
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

// C ref: lock.c pick_lock() — autounlock box branch (rx/container supplied, so
// no direction prompt).  Default AUTOUNLOCK_APPLY_KEY prompts "Unlock it with
// <yname(tool)>?"; on 'y' it starts the lock-picking occupation.  Success
// chance (box branch): LOCK_PICK 4*DEX+25*rogue, SKELETON_KEY 75+DEX,
// CREDIT_CARD DEX+20*rogue, halved if cursed.  Returns 1 (PICKLOCK_DID_
// SOMETHING) on 'y', else 0 (PICKLOCK_DID_NOTHING, no time passes).
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

// C ref: pickup.c doloot_core():2088 do_loot_cont() — one container: locked ->
// announce the lock, then attempt the default autounlock (AUTOUNLOCK_APPLY_KEY):
// pick an unlocking tool and run pick_lock(); unlocked -> use_container().
async function do_loot_one(box, more_containers) {
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
    return await use_container(box, more_containers);
}

// C ref: pickup.c doloot_core():2237 — the ">1 container" PICK_ANY "Loot which
// containers?" menu.  Returns the picked {letter,obj,...} items, [] when
// confirmed with nothing picked, or null on ESC.
async function loot_containers_menu(boxes) {
    const items = [];
    let menu_ch = 'a';
    for (const box of boxes) {
        items.push({ letter: menu_ch, obj: box, selected: false, skipinvert: false,
                     desc: obj_doname(box) });
        menu_ch = nextMenuCh(menu_ch);
    }
    const buildLines = () => {
        const lines = [{ text: 'Loot which containers?', attr: ATR_INVERSE }, { text: '' }];
        for (const it of items) lines.push({ text: menuItemLine(it) });
        return lines;
    };
    return await run_pickany_menu(items, buildLines);
}

// C ref: pickup.c doloot()/doloot_core().  Floor container(s) under the hero:
// locked -> announce the lock, then attempt the default autounlock
// (AUTOUNLOCK_APPLY_KEY): pick an unlocking tool and run pick_lock(); unlocked
// -> use_container().  A Confused hero instead drops old loot (reverse_loot)
// or simply fumbles; Blind and gloveless, a cockatrice corpse here is fatal
// before any container prompt; a grave here (with no container on it) can't
// be looted without digging it up; failing all of that, an adjacent monster
// may still be looted directionally (loot_mon(), e.g. saddle removal).
async function doloot() {
    // C ref: pickup.c doloot_core():2194 — check_capacity((char *) 0) runs
    // FIRST: an Overtaxed hero "can't do that while carrying so much stuff"
    // and no turn passes (so the container prompts never appear).
    {
        const { check_capacity_throw } = await import('./invent.js');
        if (await check_capacity_throw()) return 0; // ECMD_OK
    }
    // C ref: pickup.c doloot():2198 — a handless polyform can't loot at all;
    // skipping this opened the container menu and ate keystrokes C hands to
    // the command parser.  Only consult the form while polymorphed: an
    // unpolymorphed hero's u.umonnum is this port's ROLE index, not a mons[]
    // pmidx (every player monster has hands anyway, so C's answer is FALSE
    // either way).
    const ydata = game.u?.Upolyd ? (game.u?.data || null) : null;
    if (ydata && nohands(ydata)) {
        await pline('You have no hands!');
        return 0; // ECMD_OK
    }
    const u = game.u;
    // C ref: pickup.c doloot_core():2202 — a Confused hero either "loots" old
    // dropped items (reverse_loot) or the whole attempt fizzles; both cost the
    // turn ordinary looting would.
    if ((u?.uprops?.Confusion || 0) > 0) {
        if (rn2(6) && await reverse_loot()) return 1; // ECMD_TIME
        if (rn2(2)) {
            await pline('Being confused, you find nothing to loot.');
            return 1; // ECMD_TIME (costs a turn)
        }
        // else fall through to normal looting
    }

    let timepassed = 0;
    let c = -1;
    const boxes = floor_boxes_here();
    if (boxes.length > 0) {
        // C ref: pickup.c doloot_core():2223 — blind and gloveless, touching a
        // cockatrice corpse here is fatal before any container prompt appears.
        if (Blind() && !game.uarmg) {
            for (const nobj of objects_at(u.ux, u.uy)) {
                if (nobj.otyp === CORPSE && will_feel_cockatrice(nobj, false)) {
                    feel_cockatrice(nobj, false);
                    return 1; // ECMD_TIME
                }
            }
        }
        if (boxes.length > 1) {
            const picks = await loot_containers_menu(boxes);
            if (picks === null) {
                // ESC: C's select_menu returns -1 here, which is `!= 0`, so C
                // still sets c = 'y' and skips the "nothing to loot" fallback.
                c = 'y';
            } else if (picks.length > 0) {
                const n = picks.length;
                for (let i = 0; i < n; i++)
                    timepassed |= await do_loot_one(picks[i].obj, i + 1 < n);
                c = 'y';
            }
            // confirmed with nothing picked (picks === []): c stays -1, C
            // falls through to the mon_beside/"nothing to loot" tail below.
        } else {
            timepassed |= await do_loot_one(boxes[0], false);
            c = 'y';
        }
    } else if (IS_GRAVE(game.level?.at?.(u.ux, u.uy)?.typ)) {
        await pline('You need to dig up the grave to effectively loot it...');
    }

    if (c === 'y') return timepassed ? 1 : 0;

    // C ref: pickup.c doloot_core():2295 lootmon: — "3.3.1 introduced
    // directional looting for some things."  mon_beside() finds a monster in
    // the 3x3 box; get_adjacent_loc()'s getdir() EATS the following keystroke
    // regardless of what's found there.
    if (mon_beside(u.ux, u.uy) || game.iflags?.menu_requested) {
        const { getdir } = await import('./cmd.js');
        const dir = await getdir('Loot in what direction?');
        if (!dir) { await pline('Never mind.'); return 0; }
        const cx = u.ux + dir.dx, cy = u.uy + dir.dy;
        if (!isok(cx, cy)) { await pline('Invalid loot location'); return 0; }
        const underfoot = (dir.dx === 0 && dir.dy === 0);
        // C ref: pickup.c:2304-2307. Looking for loot overhead spends a
        // turn even when there is nothing there, before testing monsters.
        if (dir.dz < 0) {
            await pline(`You don't find anything to loot on the ${ceiling(cx, cy)}.`);
            return 1;
        }

        const mtmp = m_at(cx, cy);
        let looted_mon = false;
        let mon_timepassed = 0;
        const passed_info = { value: 0 };
        const prev_loot = { value: false };
        if (mtmp) {
            mon_timepassed = await loot_mon(mtmp, passed_info, prev_loot);
            if (mon_timepassed) looted_mon = true;
        }
        const stunned = (u?.uprops?.Stun || 0) > 0;
        const confused = (u?.uprops?.Confusion || 0) > 0;
        if (confused || stunned) mon_timepassed = 1;

        if (looted_mon) return mon_timepassed ? 1 : 0;

        if (!underfoot && has_container_at(cx, cy)) {
            if (mtmp) {
                await pline(`You can't loot anything ${passed_info.value ? 'else ' : ''}`
                            + `there with ${mon_nam(mtmp)} in the way.`);
                return mon_timepassed ? 1 : 0;
            }
            await pline('You have to be at a container to loot it.');
            return mon_timepassed ? 1 : 0;
        }
        await pline(`You don't find anything ${(passed_info.value || prev_loot.value) ? 'else ' : ''}`
                    + `${!underfoot ? 't' : ''}here to loot.`);
        return mon_timepassed ? 1 : 0;
    }
    await pline("You don't find anything here to loot.");
    return 0;
}

// C ref: lock.c picklock() — the lock-picking occupation, run each turn from the
// move loop (do_occupation).  Returns 1 while still busy (keep the occupation),
// 0 when finished (success, give-up, or the target/hero moved).
export async function picklock() {
    const u = game.u;
    const xl = game.xlock;
    if (!xl || (!xl.box && !xl.door)) {
        game._picklock_box = null;
        game.xlock = null;
        return 0;
    }

    if (xl.box) {
        // C lock.c:70-74 — you or the floor box moved.
        if (xl.box.where !== OBJ_FLOOR || xl.box.ox !== u.ux || xl.box.oy !== u.uy) {
            game._picklock_box = null;
            game.xlock = null;
            return 0;
        }
    } else {
        // C lock.c:75-90 — this occupation remains attached to the same
        // adjacent door, and stops before drawing when the door is no longer
        // valid for locking.
        const door = xl.door;
        const dx = u.dx | 0, dy = u.dy | 0;
        if (game.level?.at(u.ux + dx, u.uy + dy) !== door) {
            game._picklock_box = null;
            game.xlock = null;
            return 0;
        }
        switch (door.doormask) {
        case D_NODOOR:
            await pline('This doorway has no door.');
            game._picklock_box = null;
            game.xlock = null;
            return 0;
        case D_ISOPEN:
            await pline('You cannot lock an open door.');
            game._picklock_box = null;
            game.xlock = null;
            return 0;
        case D_BROKEN:
            await pline('This door is broken.');
            game._picklock_box = null;
            game.xlock = null;
            return 0;
        }
    }

    // C lock.c:92-96.  `nohands()` only applies to a polymorphed hero here:
    // without polymorph this port's u.umonnum is a role index, not mons[] data.
    const ydata = u?.Upolyd ? (u.data || null) : null;
    if (xl.usedtime++ >= 50 || (ydata && nohands(ydata))) {
        await update_topl(`You give up your attempt at ${lock_action(xl)}.`);
        exercise(A_DEX, true); // even if you don't succeed
        game._picklock_box = null;
        game.xlock = null;
        return 0;
    }

    // C lock.c:98 — every occupation turn rolls this percentage check.
    if (rn2(100) >= xl.chance)
        return 1;

    // C lock.c:101-136's Master Key trap-disarm branch is not modeled: none of
    // the scheduled tools is the quest artifact, and the recorded targets are
    // untrapped.  The ordinary success arm follows.
    await pline(`You succeed in ${lock_action(xl)}.`);
    if (xl.door) {
        const door = xl.door;
        const x = u.ux + (u.dx | 0), y = u.uy + (u.dy | 0);
        if (door.doormask & D_TRAPPED) {
            await (await import('./cmd.js')).b_trapped('door', true);
            door.doormask = D_NODOOR;
        } else if (door.doormask & D_LOCKED) {
            door.doormask = D_CLOSED;
        } else {
            door.doormask = D_LOCKED;
        }
        newsym(x, y);
    } else {
        xl.box.olocked = !xl.box.olocked;
        xl.box.lknown = 1;
        // C lock.c:154-155 chest_trap() is not modeled; scheduled boxes are
        // untrapped, so this has no effect on the covered path.
    }
    exercise(A_DEX, true);
    game._picklock_box = null;
    game.xlock = null;
    return 0;
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
// P_DAGGER..P_SABER is the blade span of skills.h; a pick-axe is excluded (it's
// a separate WEAPON/TOOL test), even though its oc_skill falls outside that
// range anyway.  Used to be hardcoded to 0 because the one recorded #force
// wielded a dwarvish spear; every blade-wielding hero took the wrong forcelock
// branch.
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

// C ref: lock.c chest_shatter_msg(otmp) — message for a forced-open chest's
// destroyed contents.  Disposition depends on oc_material (a PAPER spellbook
// "is torn to shreds"); the name is the *blind* unidentified singular, e.g.
// "spellbook".  Potions instead announce "You see a <potion> shatter!".
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

// C ref: lock.c breakchestlock(box, destroyit):172-211 — destroy-it path only
// (forcelock success on a non-blade weapon with !rn2(3)).  Spills contents at
// the hero's feet; every potion and a 1/3 chance of each other item are
// destroyed (chest_shatter_msg), the rest land on the floor.  No shop on the
// starting level, so no costly_alteration.
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
        // turn (before the cursed/obj_resists short-circuits), so a blade
        // wielder's force draws one more call per turn than a blunt one;
        // obj_resists() adds its own rn2(100) only when the first two tests
        // pass.  For a +0 weapon, P(survive 50 tries) = .992^50.
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
        // blunt weapon: hammering wakes nearby monsters (lock.c forcelock()).
        const { wake_nearby } = await import('./cmd.js');
        await wake_nearby(false);
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
// PICK_NONE, ...): a plain display, dismissed by ESC/space/return.  Afterwards
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
    const lines = await build_overview_lines(final, how);
    if (!lines.length) return;
    // C ref: wintty.c tty_display_nhwindow() — a menu whose maxrow reaches the
    // screen height (23+ entries, or several pages) takes the whole screen
    // (offx == 0) and is torn down with docrt() instead of docorner().
    const m = extcmd_end_menu(lines, null);
    if (m.fullscreen) {
        await extcmd_select_menu(m);
        await dismiss_invent_screen();
        return;
    }
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

// C ref: win/tty/wintty.c process_text_window() with cw->offx==0, the
// full-screen arm tty_display_nhwindow() picks once the window has at least
// ttyDisplay->rows lines.  Text starts at column 0, a page holds rows-1 lines,
// and dmore() prints "--More--" at column 1 on the row after the last text
// line.  Each page break does term_clear_screen() before the next page.
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
    // C ref: cmd.c EXTCMDLIST's self-referential `{ '#', "#", ..., doextcmd,
    // ... }` row — typing "#" as the extended-command name recurses into
    // doextcmd() again (a fresh "enter an extended command" prompt) instead
    // of no-oping.
    '#': doextcmd,
    // C ref: cmd.c EXTCMDLIST's `{ M('?'), "?", ..., doextlist, ... }` row —
    // typing "?" as the extended-command name (or "#?") shows the "Extended
    // Commands List" menu.  Was entirely missing from HANDLERS: the "?" name
    // resolved via extcmds_match() fine, but the undefined `fn` lookup made
    // doextcmd() silently no-op, so the answering keystroke(s) meant for the
    // menu leaked into rhack() as fresh commands and desynced everything
    // after.
    '?': doextlist,
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
    wizcast: dowizcast,
    overview: dooverview,
    version: doextversion,
    versionshort: doversion,
    quit: doquit_extcmd,
    polyself: wiz_polyself,
    monster: domonability_extcmd,
    turn: doturn,
    wait: dowait_extcmd,
    terrain: doterrain_extcmd,
    wizmap: wiz_map_extcmd,
    herecmdmenu: doherecmdmenu,
    wizwhere: wiz_where,
    wizmondiff: wizmondiff_extcmd,
    wizlevelport: wizlevelport_extcmd,
    droptype: doddrop_extcmd,
    movewest: () => domove_extcmd(-1, 0), movenorthwest: () => domove_extcmd(-1, -1),
    movenorth: () => domove_extcmd(0, -1), movenortheast: () => domove_extcmd(1, -1),
    moveeast: () => domove_extcmd(1, 0), movesoutheast: () => domove_extcmd(1, 1),
    movesouth: () => domove_extcmd(0, 1), movesouthwest: () => domove_extcmd(-1, 1),
    rushwest: () => runrush_extcmd(-1, 0, true), rushnorthwest: () => runrush_extcmd(-1, -1, true),
    rushnorth: () => runrush_extcmd(0, -1, true), rushnortheast: () => runrush_extcmd(1, -1, true),
    rusheast: () => runrush_extcmd(1, 0, true), rushsoutheast: () => runrush_extcmd(1, 1, true),
    rushsouth: () => runrush_extcmd(0, 1, true), rushsouthwest: () => runrush_extcmd(-1, 1, true),
    runwest: () => runrush_extcmd(-1, 0, false), runnorthwest: () => runrush_extcmd(-1, -1, false),
    runnorth: () => runrush_extcmd(0, -1, false), runnortheast: () => runrush_extcmd(1, -1, false),
    runeast: () => runrush_extcmd(1, 0, false), runsoutheast: () => runrush_extcmd(1, 1, false),
    runsouth: () => runrush_extcmd(0, 1, false), runsouthwest: () => runrush_extcmd(-1, 1, false),

    // Bare references: the underlying function's own return convention
    // already matches doextcmd()'s `res === 1 ? 1 : 0` rule with no
    // translation (either it's always 0/ECMD_OK, or its own numbers happen
    // to already be plain {0,1}).
    attributes: doattributes,
    autopickup: dotogglepickup,
    bugreport: dobugreport,
    cast: docast,
    down: dodown,
    drop: dodrop,
    engrave: doengrave,
    // C ref: cmd.c { ';', "glance", ..., doquickwhatis } -> pager.c do_look(1).
    // pager.js's own doquickwhatis()/do_look() depends on _pg.getpos, which
    // set_pager_deps() never wires up (a dead injection point, zero call
    // sites): it prints only "Pick a monster, object or location." and never
    // enters a cursor-selection loop, so the answering keystroke leaks into
    // the top-level dispatcher as a fresh command.  The raw ';' key
    // (js/cmd.js:1658) already uses the working hack.js do_farlook()/getpos()
    // for this same quick-farlook command; route "#glance" to it too, matching
    // how the sibling "whatis" entry below uses do_look_full instead of
    // pager.js's dowhatis().
    glance: do_farlook,
    help: dohelp,
    history: hmenu_dohistory,
    inventtype: dotypeinv,
    kick: dokick,
    known: dodiscovered,
    knownclass: doclassdisco,
    look: dolook,
    options: dosetSimple,
    optionsfull: doset,
    perminv: doperminv,
    pickup: dopickup,
    quaff: dodrink,
    read: doread,
    redraw: doredraw,
    seeamulet: dopramulet,
    seearmor: doprarm,
    seerings: doprring,
    seetools: doprtool,
    seeweapon: doprwep,
    showgold: doprgold,
    showspells: dovspell,
    takeoffall: doddoremarm,
    teleport: dotelecmd,
    timeout: wiz_timeout_queue,
    up: doup,
    whatis: do_look_full,
    wizborn: doborn,
    wizbury: wiz_debug_cmd_bury,
    zap: dozap,

    // Wrapped: the function's own ECMD_* convention needs translating to
    // doextcmd()'s res===1 rule, or it needs an argument (getdir/getlin) not
    // available to a bare zero-arg call.
    apply: doapply_extcmd,
    close: doclose_extcmd,
    eat: doeat_extcmd,
    exploremode: exploremode_extcmd,
    fight: fight_extcmd,
    fire: fire_extcmd,
    inventory: inventory_extcmd,
    lookaround: lookaround_extcmd,
    open: open_extcmd,
    pay: pay_extcmd,
    puton: puton_extcmd,
    quiver: quiver_extcmd,
    remove: doremring_extcmd,
    repeat: do_repeat_extcmd,
    reqmenu: do_reqmenu_extcmd,
    retravel: dotravel_target_extcmd,
    run: do_run_extcmd,
    rush: do_rush_extcmd,
    save: dosave_extcmd,
    search: dosearch_extcmd,
    seeall: doprinuse_extcmd,
    showtrap: doidtrap_extcmd,
    swap: doswapweapon_extcmd,
    takeoff: dotakeoff_extcmd,
    therecmdmenu: dotherecmdmenu_extcmd,
    throw: dothrow_extcmd,
    toggle: dotoggleoption_extcmd,
    travel: dotravel_extcmd,
    wear: dowear_extcmd,
    whatdoes: dowhatdoes_extcmd,
    wield: dowield_extcmd,
    prevmsg: prevmsg_extcmd,

    // Wizard-mode-only (WIZMODECMD; doextcmd() already refuses these outside
    // game.flags.debug before HANDLERS is consulted).  All live in wizcmds.js:
    // a static top-level import of that file throws a TDZ error at load (same
    // class as wizmondiff_extcmd below), so each reaches its real
    // implementation via a dynamic import instead.
    debugfuzzer: debugfuzzer_extcmd,
    lightsources: lightsources_extcmd,
    migratemons: migratemons_extcmd,
    panic: panic_extcmd,
    stats: stats_extcmd,
    vision: vision_extcmd,
    wizcustom: wizcustom_extcmd,
    wizdetect: wizdetect_extcmd,
    wizdispmacros: wizdispmacros_extcmd,
    wizfliplevel: wizfliplevel_extcmd,
    wizkill: wizkill_extcmd,
    wizloaddes: wizloaddes_extcmd,
    wizloadlua: wizloadlua_extcmd,
    wizobjprobs: wizobjprobs_extcmd,
    wizmakemap: wizmakemap_extcmd,
    wizrumorcheck: wizrumorcheck_extcmd,
    wizseenv: wizseenv_extcmd,
    wizshownhuuid: wizshownhuuid_extcmd,
    wizsmell: wizsmell_extcmd,
    wiztelekinesis: wiztelekinesis_extcmd,
    wmode: wmode_extcmd,
};

// C ref: teleport.c wiz_level_tele() / js/do.js wiz_level_tele() — fully
// implemented and correctly wired to the raw ^V keypress (js/cmd.js:1418), but
// never wired into HANDLERS, so "#wizlevelport<Enter>" silently no-oped: no
// prompt drawn, and its answering keystrokes leaked into rhack() as fresh
// top-level commands.  Dynamic import of do.js: same TDZ-avoidance reason as
// wizmondiff_extcmd below.  hooked_tty_getlin is this file's own getlin hook,
// already in scope, matching the raw-key call site exactly.
async function wizlevelport_extcmd() {
    const { wiz_level_tele } = await import('./do.js');
    return await wiz_level_tele((q) => hooked_tty_getlin(q, null));
}

// ── #apply .. #zap: the ~90-entry HANDLERS/EXTCMDLIST gap, found by an 8-agent
// audit of every EXTCMDLIST name absent from HANDLERS (only wizlevelport,
// droptype and the move/rush/run family above had already been fixed).  Same
// bug shape throughout: each command's real handler is fully ported and
// already exercised by its bound raw key, but was never added to this file's
// dispatch table, so "#<name><Enter>" silently no-oped and any follow-up
// keystrokes (a getobj/getdir/getlin answer) leaked into rhack() as fresh
// top-level commands.  Each wrapper mirrors its raw-key site's own ECMD_*->res
// translation exactly — the numeric ECMD_* values are NOT uniform across
// files, so read each home file's own constants, never assume.  Anything in
// js/cmd.js is reached via dynamic import only: cmd.js statically imports FROM
// this file, so the reverse static import throws a TDZ error at load (see
// wizmondiff_extcmd above); pager.js/wizcmds.js get the same treatment for
// the same reason (their own indirect edges back to cmd.js).

// C ref: apply.c doapply() — apply.js's own ECMD_TIME is 2, not 1.
async function doapply_extcmd() {
    const res = await doapply();
    return res === APPLY_ECMD.ECMD_TIME ? 1 : 0;
}

// C ref: lock.c doclose() — cmd.js's own LOCAL ECMD_TIME for doclose is 2,
// distinct from cmd.js's module-level ECMD_TIME=1 used elsewhere in that file.
async function doclose_extcmd() {
    const { doclose } = await import('./cmd.js');
    const res = await doclose();
    return res === 2 ? 1 : 0;
}

// C ref: eat.c doeat() — eat.js's doeat() returns a JS boolean, not a numeric
// ECMD code (true/false, not 1/0).
async function doeat_extcmd() {
    return (await doeat()) ? 1 : 0;
}

// C ref: cmd.c:952 enter_explore_mode() — cmd.js's own ECMD_TIME=1; the
// function itself only ever returns ECMD_OK(0) in this port (its 'yes'
// confirmation path is unreachable, a pre-existing separate limitation).
async function exploremode_extcmd() {
    const { enter_explore_mode } = await import('./cmd.js');
    return (await enter_explore_mode()) === 1 ? 1 : 0;
}

// C ref: cmd.c do_fight() — the 'F' fight prefix; never returns ECMD_TIME.
async function fight_extcmd() {
    const { do_fight } = await import('./cmd.js');
    const res = await do_fight();
    return res === 1 ? 1 : 0;
}

// C ref: dothrow.c dofire() — mirrors js/cmd.js's 'f' key translation
// exactly. getdir lives in cmd.js, reached via dynamic import.
async function fire_extcmd() {
    const { getdir } = await import('./cmd.js');
    return (await dofire(getdir)) === 3 ? 1 : 0;
}

// C ref: invent.c ddoinv() — mirrors js/cmd.js's 'i' key translation exactly.
async function inventory_extcmd() {
    const { getdir } = await import('./cmd.js');
    return (await ddoinv(getdir)) === 3 ? 1 : 0;
}

// C ref: cmd.c dolookaround() — lives in cmd.js; own ECMD_TIME=1, but
// dolookaround() itself only ever returns ECMD_OK(0).
async function lookaround_extcmd() {
    const { dolookaround } = await import('./cmd.js');
    const res = await dolookaround();
    return res === 1 ? 1 : 0;
}

// C ref: lock.c doopen_indir(0,0) — the #open command, identical to the 'o'
// key (cmd.js:1311); doopen_indir already returns plain 1/0.
async function open_extcmd() {
    const { doopen_indir } = await import('./cmd.js');
    return await doopen_indir(0, 0);
}

// C ref: shk.c dopay() — mirrors js/cmd.js's 'p' key translation exactly
// (invent.js's own ECMD_TIME is 3, not 1).
async function pay_extcmd() {
    return (await dopay()) === 3 ? 1 : 0;
}

// C ref: do_wear.c doputon() — mirrors js/cmd.js's 'P' key translation
// (invent.js's own ECMD_TIME is 3, not 1); doputon() can no longer return
// ECMD_NOTHANDLED (that raw-key guard is dead code), so no such branch here.
async function puton_extcmd() {
    return (await doputon()) === 3 ? 1 : 0;
}

// C ref: wield.c doquiver_core('ready') via dowieldquiver() — mirrors
// js/cmd.js's 'Q' key translation (invent.js's own ECMD_TIME is 3).
async function quiver_extcmd() {
    return (await dowieldquiver()) === 3 ? 1 : 0;
}

// C ref: do_wear.c doremring() — mirrors js/cmd.js's 'R' key translation
// (invent.js's own ECMD_TIME is 3; its ECMD_CANCEL is literally 1, so a bare
// reference would misreport a cancelled prompt as a turn spent).
async function doremring_extcmd() {
    return (await doremring()) === 3 ? 1 : 0;
}

// C ref: cmd.c do_repeat() (^A) — lives in cmd.js; own ECMD_TIME=1.
async function do_repeat_extcmd() {
    const { do_repeat } = await import('./cmd.js');
    const res = await do_repeat();
    return res === 1 ? 1 : 0;
}

// C ref: cmd.c do_reqmenu() — a PREFIXCMD, never returns ECMD_TIME(1); the
// raw 'm' key instead reimplements the same logic inline (a pre-existing,
// separate duplicate-reimplementation gap, out of scope here).
async function do_reqmenu_extcmd() {
    const { do_reqmenu } = await import('./cmd.js');
    const res = await do_reqmenu();
    return res === 1 ? 1 : 0;
}

// C ref: hack.c dotravel_target() — invent.js's own ECMD_TIME is 3. No
// raw-key call site exists (Ctrl+_ has no dispatch arm), so the translation
// is read from dotravel_target()'s own return convention.
async function dotravel_target_extcmd() {
    const res = await dotravel_target();
    return res === 3 ? 1 : 0;
}

// C ref: cmd.c:1606 do_run() (the #run prefix, 'G') — never ported before
// this pass; js/cmd.js's do_run_prefix() (added alongside this fix) mirrors
// its sibling do_rush() exactly. Own ECMD_TIME=1, never actually returned.
async function do_run_extcmd() {
    const { do_run_prefix } = await import('./cmd.js');
    const res = await do_run_prefix();
    // Same pending-prefix state the 'G' key arms (cmd.js rhack): the next key
    // is the direction, or a bad key that leaves the prefix pending.
    if (res === 0) game.context.run_prefix = 3;
    return res === 1 ? 1 : 0;
}

// C ref: cmd.c:1590 do_rush() (the #rush prefix, 'g') — already a faithful
// port in cmd.js, just never wired into HANDLERS; own ECMD_TIME=1, never
// actually returned (do_rush is a PREFIXCMD).
async function do_rush_extcmd() {
    const { do_rush } = await import('./cmd.js');
    const res = await do_rush();
    // Same pending-prefix state the 'g' key arms (cmd.js rhack).
    if (res === 0) game.context.run_prefix = 2;
    return res === 1 ? 1 : 0;
}

// C ref: save.c dosave() — mirrors the 'S' raw-key site exactly: dosave()
// sets game.context.move itself (always to 0, since a successful save exits
// the process) and never signals time via its return value.
async function dosave_extcmd() {
    const { dosave } = await import('./save.js');
    await dosave();
    return 0;
}

// C ref: hack.c dosearch() — lives in cmd.js as a local (now exported)
// wrapper returning a JS boolean, not a numeric ECMD code; mirrors the 's'
// raw-key site's occupation-arming side effect exactly.
async function dosearch_extcmd() {
    const { dosearch } = await import('./cmd.js');
    // C ref: cmd.c:3728 — the occupation is armed before the command runs.
    const counted = (game.multi ?? 0) > 0;
    const searched = await dosearch();
    if (searched && counted)
        game._search_occupation = true;
    return searched ? 1 : 0;
}

// C ref: invent.c doprinuse() — real C discards its return value and never
// spends a turn; mirrors the '*' raw-key site's unconditional move=0 exactly
// rather than translating doprinuse()'s own (unused) return value.
async function doprinuse_extcmd() {
    const { getdir } = await import('./cmd.js');
    await doprinuse(getdir);
    return 0;
}

// C ref: pager.c doidtrap() — no raw-key call site exists for '^' at all.
// doidtrap()'s own CANCEL value happens to be the literal 1 (doextcmd()'s
// "time used" sentinel), but this command never spends a turn, so its result
// must be discarded, not passed through.  Dynamic import: pager.js has its own
// static import FROM cmd.js, which would otherwise close a new cycle back
// through this file.
async function doidtrap_extcmd() {
    const { doidtrap } = await import('./pager.js');
    await doidtrap();
    return 0;
}

// C ref: wield.c doswapweapon() — mirrors js/cmd.js's 'x' key translation
// (invent.js's own ECMD_TIME is 3).
async function doswapweapon_extcmd() {
    return (await doswapweapon()) === 3 ? 1 : 0;
}

// C ref: do_wear.c dotakeoff() — mirrors js/cmd.js's 'T' key translation
// (invent.js's own ECMD_TIME is 3; its ECMD_CANCEL is literally 1).
async function dotakeoff_extcmd() {
    return (await dotakeoff()) === 3 ? 1 : 0;
}

// C ref: cmd.c:4343 dotherecmdmenu() — lives in cmd.js; own ECMD_TIME(1)
// already matches doextcmd()'s convention, so this is a pure pass-through.
async function dotherecmdmenu_extcmd() {
    const { dotherecmdmenu } = await import('./cmd.js');
    return await dotherecmdmenu();
}

// C ref: dothrow.c dothrow() — mirrors js/cmd.js's 't' key translation
// exactly (invent.js's own ECMD_TIME is 3; its ECMD_CANCEL is literally 1).
async function dothrow_extcmd() {
    const { getdir } = await import('./cmd.js');
    return (await dothrow(getdir)) === 3 ? 1 : 0;
}

// C ref: cmd.c dotoggleoption() — lives in cmd.js; reachable via '#toggle'
// only bare (no BIND-macro param populated by this path), so it always
// returns ECMD_OK(0) — a pure pass-through wrapper.
async function dotoggleoption_extcmd() {
    const { dotoggleoption } = await import('./cmd.js');
    return await dotoggleoption();
}

// C ref: hack.c dotravel() — invent.js's own ECMD_TIME is 3.  No raw-key
// translation to mirror: cmd.js's '_' site hardcodes move=0 unconditionally
// (the tested public sessions all cancel at the destination prompt), so this
// is read from dotravel()'s own declared return convention instead.
async function dotravel_extcmd() {
    return (await dotravel()) === 3 ? 1 : 0;
}

// C ref: do_wear.c dowear() — mirrors js/cmd.js's 'W' key translation
// exactly (invent.js's own ECMD_TIME is 3).
async function dowear_extcmd() {
    return (await dowear()) === 3 ? 1 : 0;
}

// C ref: pager.c dowhatdoes() — always returns 0 (prompts for one key,
// prints its description, never spends time); pager.js has its own static
// import FROM cmd.js, so this is reached dynamically to avoid a new cycle.
async function dowhatdoes_extcmd() {
    const { dowhatdoes } = await import('./pager.js');
    return await dowhatdoes();
}

// C ref: wield.c dowield() — mirrors js/cmd.js's 'w' key translation exactly
// (invent.js's own ECMD_TIME is 3).
async function dowield_extcmd() {
    return (await dowield()) === 3 ? 1 : 0;
}

// C ref: topl.c nh_doprev_message() (^P) — js/cmd.js doprev_message() ports
// the default prevmsg_window='s' single-press case (redisplay the last
// message); a repeated ^P recalling further history needs a real message-
// history ring this port doesn't implement.
async function prevmsg_extcmd() {
    const { doprev_message } = await import('./cmd.js');
    return doprev_message();
}

// C ref: wizcmds.c wiz_fuzzer() — #debugfuzzer.
async function debugfuzzer_extcmd() {
    const { wiz_fuzzer } = await import('./wizcmds.js');
    return await wiz_fuzzer();
}

// C ref: light.c:934 wiz_light_sources() — `win = create_nhwindow(NHW_MENU)`
// filled by putstr() (a corner text window, not a full-screen NHW_TEXT).  The
// function only builds the lines; invent.js tty_text_window() draws the
// NHW_MENU overlay with its "--More--" prompt.
async function lightsources_extcmd() {
    const lines = wiz_light_sources();
    const { tty_text_window } = await import('./invent.js');
    await tty_text_window(lines);
    return 0;
}

// C ref: wizcmds.c:1873 wiz_migrate_mons() — #migratemons.
async function migratemons_extcmd() {
    const { wiz_migrate_mons } = await import('./wizcmds.js');
    return await wiz_migrate_mons();
}

// C ref: wizcmds.c:534 wiz_panic() — #panic.
async function panic_extcmd() {
    const { wiz_panic } = await import('./wizcmds.js');
    return await wiz_panic();
}

// C ref: wizcmds.c:1616 wiz_show_stats() — #stats.
async function stats_extcmd() {
    const { wiz_show_stats } = await import('./wizcmds.js');
    return await wiz_show_stats();
}

// C ref: wizcmds.c:621 wiz_show_vision() — #vision.
async function vision_extcmd() {
    const { wiz_show_vision } = await import('./wizcmds.js');
    return await wiz_show_vision();
}

// C ref: wizcmds.c:1934 wiz_custom() — #wizcustom.
async function wizcustom_extcmd() {
    const { wiz_custom } = await import('./wizcmds.js');
    return await wiz_custom();
}

// C ref: wizcmds.c:229 wiz_detect() — #wizdetect (independent of the
// already-fixed raw ^E key, which uses its own static cmd.js->wizcmds.js
// import — that direction is fine; the hazard is only extcmd-handlers.js
// importing FROM wizcmds.js while cmd.js imports FROM extcmd-handlers.js).
async function wizdetect_extcmd() {
    const { wiz_detect } = await import('./wizcmds.js');
    return await wiz_detect();
}

// C ref: wizcmds.c:1705 wiz_display_macros() — #wizdispmacros.
async function wizdispmacros_extcmd() {
    const { wiz_display_macros } = await import('./wizcmds.js');
    return await wiz_display_macros();
}

// C ref: wizcmds.c:412 wiz_flip_level() — #wizfliplevel.
async function wizfliplevel_extcmd() {
    const { wiz_flip_level } = await import('./wizcmds.js');
    return await wiz_flip_level();
}

// C ref: wizcmds.c:243 wiz_kill() — #wizkill.
async function wizkill_extcmd() {
    const { wiz_kill } = await import('./wizcmds.js');
    return await wiz_kill();
}

// C ref: wizcmds.c wiz_load_splua() — #wizloaddes.
async function wizloaddes_extcmd() {
    const { wiz_load_splua } = await import('./wizcmds.js');
    return await wiz_load_splua();
}

// C ref: wizcmds.c wiz_load_lua() — #wizloadlua.
async function wizloadlua_extcmd() {
    const { wiz_load_lua } = await import('./wizcmds.js');
    return await wiz_load_lua();
}

// C ref: wizcmds.c:1498 wiz_objprobs() — #wizobjprobs.
async function wizobjprobs_extcmd() {
    const { wiz_objprobs } = await import('./wizcmds.js');
    return await wiz_objprobs();
}

// C ref: wizcmds.c wiz_makemap() — #wizmakemap.
async function wizmakemap_extcmd() {
    const { wiz_makemap } = await import('./wizcmds.js');
    return await wiz_makemap();
}

// C ref: wizcmds.c:1102 wiz_rumor_check() — the paged rumor-boundary diagnostic.
async function wizrumorcheck_extcmd() {
    const { wiz_rumor_check } = await import('./wizcmds.js');
    return await wiz_rumor_check();
}

// C ref: wizcmds.c:616 wiz_show_seenv() — #wizseenv.
async function wizseenv_extcmd() {
    const { wiz_show_seenv } = await import('./wizcmds.js');
    return await wiz_show_seenv();
}

// C ref: wizcmds.c:1438 wiz_show_nhuuid() — #wizshownhuuid.
async function wizshownhuuid_extcmd() {
    const { wiz_show_nhuuid } = await import('./wizcmds.js');
    return await wiz_show_nhuuid();
}

// C ref: wizcmds.c wiz_smell() — #wizsmell.
async function wizsmell_extcmd() {
    const { wiz_smell } = await import('./wizcmds.js');
    return await wiz_smell();
}

// C ref: wizcmds.c wiz_telekinesis() — #wiztelekinesis. Its mhurtle/hurtle
// effect is backed by inert nyi_* stand-ins (a separate, pre-existing gap);
// the position/direction-picking prompts and cancels are fully real, so
// wiring this still closes the keystroke-leak bug regardless.
async function wiztelekinesis_extcmd() {
    const { wiz_telekinesis } = await import('./wizcmds.js');
    return await wiz_telekinesis();
}

// C ref: wizcmds.c:671 wiz_show_wmodes() — #wmode.
async function wmode_extcmd() {
    const { wiz_show_wmodes } = await import('./wizcmds.js');
    return await wiz_show_wmodes();
}

// C ref: do.c doddrop() — fully implemented in invent.js and correctly wired
// to the raw 'D' key (js/cmd.js:1502, `(await doddrop()) ? 1 : 0`), but absent
// from HANDLERS so "#droptype<Enter>" silently no-oped and its menu-answer
// keystrokes leaked into rhack().  invent.js's own ECMD_TIME is 3, not 1, so
// (unlike cmd.js's truthy check) doextcmd()'s strict `res === 1` needs it
// translated here.
async function doddrop_extcmd() {
    return (await doddrop()) ? 1 : 0;
}

// C ref: cmd.c rhack():3775-3801 — a MOVEMENTCMD (do_move_west() etc., js/cmd.js
// :5640-5670) calls set_move_cmd() to STAGE u.dx/u.dy/domove_attempting, and
// rhack() itself then calls domove() (WALK) or drives the run/rush engine
// (RUSH).  js/cmd.js's set_move_cmd()/do_move_*()/do_rush_*()/do_run_*() are a
// faithful but ORPHANED port: nothing in this file (the only dispatcher for
// '#movewest' etc.) ever consumed domove_attempting, so the command silently
// no-oped and its keystrokes ran as fresh top-level commands.  Reimplemented
// directly against dx/dy here (skipping the staging indirection) rather than
// calling do_move_west(), since domove() (dynamic import, same TDZ hazard as
// wizmondiff_extcmd) takes dx/dy directly — mirrors the raw isMovementKey
// branch (js/cmd.js ~1688) exactly, nopick/menu_requested reset included.
async function domove_extcmd(dx, dy) {
    const { domove } = await import('./cmd.js');
    game.context.nopick = game.iflags?.menu_requested ? 1 : 0;
    if (game.iflags) game.iflags.menu_requested = false;
    await domove(dx, dy);
    return game.context.move === 1 ? 1 : 0;
}

// C ref: cmd.c rhack():3792-3799 — the RUSH/RUN half of the same dead-end;
// mirrors the raw isRunKey/CTRL_RUSH_DIR branches (js/cmd.js ~1620/1636),
// which already drive the whole multi-turn run/rush inline via hack.js's
// do_run()/do_run_prefixed() and leave context.move=0 (every elapsed turn was
// already taken via the moveloop calls inside run_movement()).
async function runrush_extcmd(dx, dy, rush) {
    game.context.nopick = game.iflags?.menu_requested ? 1 : 0;
    if (game.iflags) game.iflags.menu_requested = false;
    if (rush) await do_run_prefixed(dx, dy, 3);
    else await do_run(dx, dy);
    return 0;
}

// C ref: wizcmds.c:1790 wiz_mon_diff() — was fully implemented in wizcmds.js
// but never wired into HANDLERS, so #wizmondiff silently no-opped (fn
// undefined): no window opened, and the keystrokes C's real window would have
// absorbed instead leaked into the live game, permanently desyncing the
// session.  Dynamic import, not static: a static `import { wiz_mon_diff }
// from './wizcmds.js'` here flips this file's ESM evaluation order relative
// to the options.js/cfgfiles.js cycle and throws "Cannot access
// 'CONFIG_LINE_STMT' before initialization" at load — see
// [[mktrap-victim-tdz-is-real]], same hazard class, a different edge.
async function wizmondiff_extcmd() {
    const { wiz_mon_diff } = await import('./wizcmds.js');
    return await wiz_mon_diff();
}

// C ref: cmd.c:4332 doherecmdmenu() -> here_cmd_menu() -> there_cmd_menu(u.ux,
// u.uy, CLICK_1).  Only the u_at(x,y) arm (there_cmd_menu_self) is reachable
// from '#herecmdmenu'; MCMD_* dispatch goes through act_on_act()'s cmdq, and
// only the no-op ESC path is exercised, so a selection is accepted then
// dropped.  With no HANDLERS entry the menu never drew AND the dismissing key
// fell through to rhack() as a fresh command.
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
// engraving, then do_mapping(), whose tail (exercise(A_WIS, TRUE)) draws one
// rn2(19).  With no HANDLERS entry this fell through to the no-op, so the map
// stayed dark.  do_mapping() takes C's hero_memory branch here, so there's no
// browse_map() getpos loop and no extra keystroke consumed.
export async function wiz_map_extcmd() {
    const { do_mapping } = await import('./detect.js');
    // C ref: wizcmds.c:181-195 — `save_Hconf = HConfusion, save_Hhallu =
    // HHallucination; HConfusion = HHallucination = 0L; ...; do_mapping();
    // ...restore`.  The mapping pass therefore redraws every square with
    // plain glyphs (no hallucinatory display-RNG draws, no confusion skips).
    // This port keeps those timers in several u / u.uprops fields.
    const u = game.u;
    const slots = [[u, 'uhallu'], [u, 'HHallucination'], [u, 'Hallucination'],
                   [u, 'uconf'], [u, 'HConfusion'],
                   [u?.uprops, 'Hallucination'], [u?.uprops, 'HHallucination'],
                   [u?.uprops, 'Confusion']].filter(([o, k]) => o && o[k]);
    const saved = slots.map(([o, k]) => o[k]);
    for (const [o, k] of slots) o[k] = typeof o[k] === 'boolean' ? false : 0;
    try {
        for (const t of (game.level?.traps || [])) t.tseen = 1;
        // C ref: wizcmds.c:189-191 `map_engraving(ep, TRUE)` — maps and shows the
        // engraving glyph; it never sets ep->erevealed (only seeing or feeling
        // the square does), so a later out-of-sight redraw still shows floor.
        const { engraving_glyph, show_glyph_cell, bg_attr } = await import('./display.js');
        for (const ep of (game.level?.engravings || [])) {
            const lev = game.level.at(ep.engr_x, ep.engr_y);
            if (!lev) continue;
            const g = engraving_glyph(lev);
            if (game.level.flags?.hero_memory)
                lev.remembered_glyph = { ch: g.ch, color: g.color, decgfx: g.dec,
                                         bwEngr: g.bwEngr };
            show_glyph_cell(ep.engr_x, ep.engr_y, g.ch, g.color, g.dec, bg_attr(g));
        }
        await do_mapping();
    } finally {
        slots.forEach(([o, k], i) => { o[k] = saved[i]; });
    }
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
async function wiz_identify_extcmd() {
    await wiz_identify();
    return 0;
}

// C ref: timeout.c propertynames[] — the ordered property list #wizintrinsic
// (and #timeout) walks, "ordered by interest".  Entries are [prop-id, display
// name, u.uprops timeout field]; prop-id is the include/prop.h name.  Only two
// are load-bearing here: HALLUC_RES is skipped, and FIRE_RES gets a "--"
// separator ahead of it marking properties only ever timed in wizard mode.
// The timeout field names the u.uprops key this port already reads, so e.g. a
// timed FAST really does make Very_fast true in u_calc_moveamt.
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
    // C ref: wizcmds.c:967 — command assistance, independent of verbose.
    if (game.iflags?.cmdassist !== false)
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

// C ref: wizcmds.c wiz_intrinsic() — a PICK_ANY menu of every timeable
// property; each pick adds DEFAULT_TIMEOUT_INCR to its intrinsic timeout and
// plines "Timeout for <prop> set to/increased by N.".
async function wiz_intrinsic() {
    const entries = wizIntrinsicEntries();
    const committed = await select_command_menu(entries);
    await dismiss_invent_screen();
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
        const amount = it.count == null || it.count === -1 ? DEFAULT_TIMEOUT_INCR : it.count | 0;
        if (amount <= 0) continue;
        let newtimeout = Math.min(oldtimeout + amount, TIMEOUT);
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
        if (it.propId === 'BLINDED') {
            const { make_blinded_hero } = await import('./potion.js');
            await make_blinded_hero(newtimeout, true);
            continue;
        }
        const potion = await import('./potion.js');
        switch (it.propId) {
        case 'DEAF':
            await potion.make_deaf(newtimeout, true);
            continue;
        case 'SICK':
            await potion.make_sick(newtimeout, '#wizintrinsic', true, rn2(2) ? 2 : 1);
            continue;
        case 'SLIMED':
            await potion.make_slimed(newtimeout, `You are${oldtimeout ? ' still' : ''} turning into slime.`);
            continue;
        case 'STONED': {
            const { KILLED_BY } = await import('./const.js');
            await potion.make_stoned(newtimeout, `You are${oldtimeout ? ' still' : ''} turning into stone.`,
                                     KILLED_BY, '#wizintrinsic');
            continue;
        }
        case 'STUNNED':
            await (await import('./mhitu.js')).make_stunned_u(newtimeout, true);
            continue;
        case 'VOMITING':
            await potion.make_vomiting(newtimeout, false);
            await update_topl(`You are${oldtimeout ? ' still' : ''} vomiting.`);
            continue;
        case 'GLIB':
            await potion.make_glib(newtimeout);
            break;
        default:
            if (slot) slot.set(u, newtimeout); else u.uprops[it.key] = newtimeout;
            break;
        }
        game.botl = true;
        // update_topl, not pline: the two "Timeout for ..." lines share one
        // topline (C update_topl appends with two spaces while it fits).
        await update_topl(`Timeout for ${it.name} ${oldtimeout ? 'increased by' : 'set to'} ${amount}.`);
        // C ref: wizcmds.c:1081-1088 — after the timeout change.
        if (it.propId === 'LEVITATION' || it.propId === 'FLYING')
            (await import('./polyself.js')).float_vs_flight();
        else if (it.propId === 'PROT_FROM_SHAPE_CHANGERS')
            await (await import('./mon.js')).rescham();
        if ((it.propId === 'WWALKING' || it.propId === 'LEVITATION' || it.propId === 'FLYING')
            && u.uinwater) {
            await (await import('./trap.js')).pooleffects(false);
            if (game.program_state?.gameover) return 0;
        }
    }
    // C ref: display.c docrt():1727 — `if (u.uswallow) { swallowed(1); goto
    // post_map; }`, skipping cls()/the message flush entirely.  This is a
    // SECOND full stomach repaint after make_hallucinated()'s own, and while
    // hallucinating each repaint spends eight more display-RNG picks, so
    // skipping it leaves every later frame one batch behind (seed0383 step 165).
    if (game.u?.uswallow) {
        if (game._pending_message) await topl_more();
        game._pending_message = '';
        const { swallowed } = await import('./display.js');
        await swallowed(1);
    } else {
        // C ref: display.c docrt_flags() non-swallow path — cls() (flush the
        // pending topline through its OWN --More--), vision_recalc(2), repaint
        // remembered glyphs, then vision_recalc(0)+see_monsters() to re-see
        // everything visible.  This whole pass was OUTRIGHT MISSING (only
        // flush_screen(1) ran after), so a hallucinating hero's map kept
        // showing make_hallucinated()'s own see_monsters()/see_objects() draw
        // instead of docrt()'s full second pass — every later screen one whole
        // redraw's worth of display-rng picks behind (heldout-mirror44
        // seed0383-wizard-hallucinate, step 165: C 40 more draws here, ours 0).
        // js/display.js's docrt() already ports this sequence faithfully
        // (message flush included); call it directly rather than also
        // flushing the message here — a duplicate EARLY flush closed this
        // step's capture before docrt()'s own redraw ran, pushing all 40
        // draws into the WRONG step.
        const { docrt } = await import('./display.js');
        await docrt();
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
// dispatch it.  The `do { ... } while (func == doextlist)` wrapper matters:
// after "#?" runs the extended-commands-list menu (doextlist), C re-prompts
// "#" for another extended command name instead of returning — without it,
// the keystrokes the recording sends to that second "#" prompt (and any
// prompt after it, for as long as the answer keeps being "?") leak into
// rhack() as fresh top-level commands and desync the rest of the session.
export async function doextcmd() {
    let fn, res = 0;
    for (;;) {
        const idx = await tty_get_ext_cmd();
        if (idx < 0) {
            game.context.move = 0;
            return 0;
        }
        const [txt, flags] = EXTCMDLIST[idx];
        // C ref: cmd.c:463 can_do_extcmd() — a WIZMODECMD command must be
        // refused outside wizard mode even when typed by its FULL NAME (not
        // just via an unbound raw key); this check was entirely missing, so
        // e.g. "#wizidentify<Enter>" ran the real debug-identify menu in a
        // normal game.  cmd.js has its own can_do_extcmd(), but it's dead
        // code (never called) and operates on a different extcmdlist shape,
        // so this re-implements just the WIZMODECMD half against THIS file's
        // EXTCMDLIST, matching the message wizcmds.js's unavail() already
        // uses.
        if ((flags & WIZMODECMD) && !game.flags?.debug) {
            game.context.move = 0;
            await pline(`Unavailable command '${txt}'.`);
            return 0;
        }
        // C ref: cmd.c:507-511. An unsupported m-prefix on a #command
        // warns and is cleared, but the extended command still executes.
        if (game.iflags?.menu_requested) {
            const { extcmdlist, accept_menu_prefix, cmd_from_func, cmd_visctrl } = await import('./cmd.js');
            const command = extcmdlist.find(ec => ec.ef_txt === txt);
            if (!accept_menu_prefix(command)) {
                const prefix = cmd_visctrl(cmd_from_func('do_reqmenu'));
                await pline(`'${prefix}' prefix has no effect for the ${txt} command.`);
                game.iflags.menu_requested = false;
            }
        }
        fn = HANDLERS[txt];
        res = 0;
        if (fn) {
            res = await fn();
        }
        if (fn !== doextlist) break;
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

// C ref: artifact.c:1727 invoke_ok().  js/artifact.js already ports the real
// check (obj.oartifact || objects[].flags & F_UNIQUE || unidentified fake
// Amulet, plus the crystal-ball synonym-for-apply case) — F_UNIQUE is this
// port's own object-table bit (js/mkobj.js), correctly set for the
// Candelabrum/Bell, unlike the oc_unique field o_init.js only ever populates
// for the Amulet of Yendor and the Book of the Dead.  Its return codes are
// scoped to artifact.js's own local GETOBJ_EXCLUDE(-3)/GETOBJ_SUGGEST(1)
// pair though, and that SUGGEST(1) collides with invent.js's real
// GETOBJ_DOWNPLAY(1) — the getobj() below would silently omit a suggested
// otyp from the prompt instead of highlighting it, so remap it to invent.js's
// real GETOBJ_SUGGEST(2).
function invoke_ok(obj) {
    return artifact_invoke_ok(obj) === GETOBJ_EXCLUDE_X ? GETOBJ_EXCLUDE_X : GETOBJ_SUGGEST_X;
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

// C ref: pickup.c:3505 choose_tip_container_menu() — PICK_ONE over the floor
// containers here, plus a preselected "tip something being carried" entry.
// Returns 1 (ECMD_TIME) after tipping a floor container, 0 (ECMD_OK) to fall
// through to the inventory getobj(), or -1 (ECMD_CANCEL) on ESC.
async function choose_tip_container_menu() {
    const dummyobj = {};
    const entries = [];
    let menu_ch = 'a';
    for (const otmp of objects_at(game.u.ux, game.u.uy)) {
        if (!is_container_otyp(otmp.otyp)) continue;
        entries.push({ sel: menu_ch, text: obj_doname(otmp), value: otmp });
        menu_ch = nextMenuCh(menu_ch);
    }
    if (inventoryArray().length) {
        entries.push({ sel: null, text: '' });
        /* use 'i' for inventory unless there are so many
           containers that it's already being used */
        const n_boxes = entries.length - 1;
        const ch = (n_boxes <= 'i'.charCodeAt(0) - 'a'.charCodeAt(0)
                    && !game.flags?.lootabc) ? 'i' : menu_ch;
        entries.push({ sel: ch, text: 'tip something being carried', value: dummyobj,
                       selected: true });
    }
    const picks = await run_pickone_corner_menu('Tip which container?', entries);
    const n = picks ? picks.length : -1;
    let otmp = (n <= 0) ? null : picks[0];
    if (n > 1 && otmp === dummyobj) otmp = picks[1];
    if (otmp && otmp !== dummyobj) {
        await tipcontainer_c(otmp);
        return 1;
    }
    return n === -1 ? -1 : 0;
}

// C ref: pickup.c:3871 tipcontainer_gettarget(). The "Where to tip the
// contents of <box>" menu: the preselected '-' floor entry, then every other
// carried container (indented and unselectable when hands are unavailable or
// it is known to be locked).  Returns { target, cancelled }.
async function tipcontainer_gettarget(box) {
    const dummyobj = {};
    /* tip to floor does not require free hands */
    const entries = [{ sel: '-', text: 'on the floor', value: dummyobj, selected: true },
                     { sel: null, text: '' }];
    let n_conts = 0, hands_available = true;
    for (const otmp of inventoryArray()) {
        if (otmp === box) continue;
        /* bag of tricks passes Is_container(); only include it if it isn't
           known to be a bag of tricks */
        if (!is_container_otyp(otmp.otyp)
            || (otmp.otyp === BAG_OF_TRICKS_OTYP && otmp.dknown
                && objects[otmp.otyp]?.oc_name_known))
            continue;
        if (!n_conts++) hands_available = await u_handsy(); /* might issue message */
        /* container-to-container tip requires free hands; exclude a
           container known to be locked */
        const exclude_it = !hands_available || (otmp.olocked && otmp.lknown);
        entries.push(exclude_it ? { sel: null, text: `    ${obj_doname(otmp)}` }
                                : { sel: otmp.invlet, text: obj_doname(otmp), value: otmp });
    }
    const picks = await run_pickone_corner_menu(
        `Where to tip the contents of ${obj_doname(box)}`, entries);
    const n = picks ? picks.length : -1;
    let target = null;
    if (n > 0) {
        target = picks[0];
        /* PICK_ONE with a preselected item might return 2; if so, choose
           the one that wasn't preselected */
        if (n > 1 && target === dummyobj) target = picks[1];
        if (target === dummyobj) target = null;
    }
    return { target, cancelled: n === -1 };
}

// C ref: win/tty/wintty.c process_menu_window()/tty_select_menu() for a
// single-page PICK_ONE corner menu whose entries may be preselected.
// entries: { sel (null for a non-selectable line), text, value, selected }.
// The first paint marks a preselected entry '*'.  An explicit selector
// toggles that entry and finishes, return/space finish, ESC cancels,
// '-'/'\\' (when not selectors) clear every selection, other keys ring the
// bell.  Returns the selected values in menu order, or null when cancelled.
async function run_pickone_corner_menu(title, entries) {
    if (game._toplin === 1 || game._yn_need_more) await topl_more();
    game._yn_need_more = false;
    game._pending_message = '';
    game._toplin = 0;
    const sels = entries.filter((e) => e.sel).map((e) => e.sel).join('');
    let result;
    for (;;) {
        const lines = [{ text: title, attr: ATR_INVERSE }, { text: '' }];
        for (const e of entries)
            lines.push({ text: e.sel ? `${e.sel} ${e.selected ? '*' : '-'} ${e.text}` : e.text });
        let maxcol = '(end) '.length;
        for (const ln of lines) maxcol = Math.max(maxcol, ln.text.length + 2);
        draw_corner_window(lines, maxcol, '(end)', 1);
        let redraw = false;
        for (;;) {
            const key = await nhgetch();
            const ch = key === 27 ? '\x1b' : String.fromCharCode(key);
            if (sels.includes(ch)) {                     /* explicit choice */
                const e = entries.find((x) => x.sel === ch);
                e.selected = !e.selected;
                result = entries.filter((x) => x.sel && x.selected).map((x) => x.value);
                break;
            }
            if (ch === '\x1b') { result = null; break; }
            if (ch === '\n' || ch === '\r' || ch === ' ') {
                result = entries.filter((x) => x.sel && x.selected).map((x) => x.value);
                break;
            }
            if ((ch === '-' || ch === '\\') && entries.some((x) => x.selected)) {
                for (const x of entries) x.selected = false;
                redraw = true;
                break;
            }
            /* digits start a count; anything else is tty_nhbell() */
        }
        if (!redraw) break;
    }
    delete game._modal_screen;
    return result;
}

// C ref: pickup.c:3688 tipcontainer(). The destination menu comes first,
// then js/pickup.js tipcontainer() runs the checks and the spill.
async function tipcontainer_c(box) {
    const { target, cancelled } = await tipcontainer_gettarget(box);
    if (cancelled) return;
    await tipcontainer(box, target);
}

// C ref: pickup.c:3562 dotip() — tip a floor container here (asking about each
// one, or via a menu when there are several), otherwise fall through to
// getobj("tip") for a carried container or some other tippable item.
export async function dotip() {
    const u = game.u;
    /* check floor container(s) first; at most one will be accessed */
    const boxes = container_at(u.ux, u.uy, true);
    if (boxes > 0
        && (!game.iflags?.menu_requested
            || (menu_style() === MENU_TRADITIONAL && boxes > 1))) {
        const buf = `You can't tip ${game.flags?.verbose === false ? 'a container'
            : boxes > 1 ? 'one' : 'it'} while carrying so much.`;
        /* hack.c check_capacity(str) */
        const overloaded = near_capacity() >= EXT_ENCUMBER;
        if (overloaded) await pline(buf);
        if (!overloaded && await able_to_loot(u.ux, u.uy, false)) {
            if (boxes > 1) {
                /* pick one container via menu or ... */
                const res = await choose_tip_container_menu();
                if (res !== 0) return res > 0 ? 1 : 0;
                /* else pick-from-invent below */
            } else {
                for (const cobj of objects_at(u.ux, u.uy)) {
                    if (!is_container_otyp(cobj.otyp)) continue;
                    const c = await yn_function(
                        loot_safe_qbuf('There is ', ' here, tip it?', cobj,
                                       obj_doname, ansimpleoname, 'container'),
                        'ynq', 'q');
                    if (c === 'q') return 0;                 // ECMD_OK
                    if (c === 'n') continue;
                    await tipcontainer_c(cobj);
                    /* can only tip one container at a time */
                    return 1;                                // ECMD_TIME
                }
            }
        }
    }

    /* either no floor container(s) or 'm' prefix was used to ignore such
       or couldn't tip one or didn't tip any */
    const cobj = await getobj('tip', tip_ok, GETOBJ_PROMPT);
    if (!cobj) return 0;                                     // ECMD_CANCEL

    /* normal case */
    if (is_container_otyp(cobj.otyp) || cobj.otyp === HORN_OF_PLENTY) {
        await tipcontainer_c(cobj);
        return 1;
    }
    /* assorted other cases */
    let spillage = null;
    const otyp = cobj.otyp;
    if ((otyp === TALLOW_CANDLE || otyp === WAX_CANDLE) && cobj.lamplit) {
        /* note "wax" even for tallow candles to avoid giving away info */
        spillage = 'wax';
    } else if ((otyp === POT_OIL && cobj.lamplit)
               || (otyp === OIL_LAMP && (cobj.age | 0) !== 0)
               || (otyp === MAGIC_LAMP && (cobj.spe | 0) !== 0)) {
        spillage = 'oil';
    } else if (otyp === CAN_OF_GREASE && cobj.spe > 0) {
        /* charge consumed below */
        spillage = 'grease';
    } else if (otyp === FOOD_RATION || otyp === CRAM_RATION
               || otyp === LEMBAS_WAFER) {
        spillage = 'crumbs';
    } else if (cobj.oclass === VENOM_CLASS) {
        spillage = 'venom';
    }
    if (spillage) {
        let buf = '';
        if (is_pool(u.ux, u.uy))
            buf = ` and gradually ${vtense(spillage, 'dissipate')}`;
        else if (is_lava(u.ux, u.uy))
            buf = ` and immediately ${vtense(spillage, 'burn')} away`;
        await pline(`Some ${spillage} ${vtense(spillage, 'spill')} onto the `
                    + `${surface(u.ux, u.uy)}${buf}.`);
        /* shop usage message comes after the spill message */
        if (otyp === CAN_OF_GREASE && cobj.spe > 0)
            consume_obj_charge(cobj, true);
        /* something [useless] happened */
        return 1;
    }
    /* anything not covered yet */
    if (cobj.oclass === POTION_CLASS) /* can't pour potions... */
        await pline(`The ${xname(cobj)} ${otense(cobj, 'are')} securely sealed.`);
    else if (game.uarmh && cobj === game.uarmh)
        return await tiphat() ? 1 : 0;
    else if (otyp === STATUE)
        await pline('Nothing interesting happens.');
    else
        await pline('Nothing happens.');
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
    // x = u.ux+u.dx, y = u.uy+u.dy.  getdir draws "In what direction?" and
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
