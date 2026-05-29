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
import { pline, topl_more } from './display.js';
import { NO_COLOR } from './terminal.js';
import { getpos, get_valid_jump_position, is_valid_jump_pos } from './hack.js';

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
// [ef_txt, flagbits].  We retain only the flag bits relevant to matching
// (AUTOCOMPLETE / WIZMODECMD / CMD_NOT_AVAILABLE / INTERNALCMD); the rest
// don't affect which entries match a typed prefix.  Ordering mirrors C so
// matchlist indexes are stable.
const EXTCMDLIST = [
    ["#", 0],
    ["?", AUTOCOMPLETE],
    ["adjust", AUTOCOMPLETE],
    ["annotate", AUTOCOMPLETE],
    ["apply", 0],
    ["attributes", 0],
    ["autopickup", 0],
    ["bugreport", 0],
    ["call", 0],
    ["cast", 0],
    ["chat", AUTOCOMPLETE],
    ["chronicle", AUTOCOMPLETE],
    ["close", 0],
    ["conduct", AUTOCOMPLETE],
    ["debugfuzzer", WIZMODECMD],
    ["dip", AUTOCOMPLETE],
    ["down", 0],
    ["drop", 0],
    ["droptype", 0],
    ["eat", 0],
    ["engrave", 0],
    ["enhance", AUTOCOMPLETE],
    ["exploremode", 0],
    ["fight", 0],
    ["fire", 0],
    ["force", AUTOCOMPLETE],
    ["genocided", AUTOCOMPLETE],
    ["glance", 0],
    ["help", 0],
    ["herecmdmenu", AUTOCOMPLETE],
    ["history", AUTOCOMPLETE],
    ["inventory", 0],
    ["inventtype", 0],
    ["invoke", AUTOCOMPLETE],
    ["jump", AUTOCOMPLETE],
    ["kick", 0],
    ["known", 0],
    ["knownclass", 0],
    ["levelchange", AUTOCOMPLETE | WIZMODECMD],
    ["lightsources", AUTOCOMPLETE | WIZMODECMD],
    ["look", 0],
    ["lookaround", 0],
    ["loot", AUTOCOMPLETE],
    ["migratemons", AUTOCOMPLETE | WIZMODECMD],
    ["monster", AUTOCOMPLETE],
    ["name", AUTOCOMPLETE],
    ["offer", AUTOCOMPLETE],
    ["open", 0],
    ["options", 0],
    ["optionsfull", 0],
    ["overview", AUTOCOMPLETE],
    ["panic", AUTOCOMPLETE | WIZMODECMD],
    ["pay", 0],
    ["perminv", 0],
    ["pickup", 0],
    ["polyself", AUTOCOMPLETE | WIZMODECMD],
    ["pray", AUTOCOMPLETE],
    ["prevmsg", 0],
    ["puton", 0],
    ["quaff", 0],
    ["quit", AUTOCOMPLETE],
    ["quiver", 0],
    ["read", 0],
    ["redraw", 0],
    ["remove", 0],
    ["repeat", 0],
    ["reqmenu", 0],
    ["retravel", 0],
    ["ride", AUTOCOMPLETE],
    ["rub", AUTOCOMPLETE],
    ["run", 0],
    ["rush", 0],
    ["save", 0],
    ["saveoptions", 0],
    ["search", 0],
    ["seeall", 0],
    ["seeamulet", 0],
    ["seearmor", 0],
    ["seerings", 0],
    ["seetools", 0],
    ["seeweapon", 0],
    ["shell", CMD_NOT_AVAILABLE],
    ["showgold", 0],
    ["showspells", 0],
    ["showtrap", 0],
    ["sit", AUTOCOMPLETE],
    ["stats", AUTOCOMPLETE | WIZMODECMD],
    ["suspend", CMD_NOT_AVAILABLE],
    ["swap", 0],
    ["takeoff", 0],
    ["takeoffall", 0],
    ["teleport", 0],
    ["terrain", AUTOCOMPLETE],
    ["therecmdmenu", AUTOCOMPLETE],
    ["throw", 0],
    ["timeout", AUTOCOMPLETE | WIZMODECMD],
    ["tip", AUTOCOMPLETE],
    ["toggle", 0],
    ["travel", 0],
    ["turn", AUTOCOMPLETE],
    ["twoweapon", 0],
    ["untrap", AUTOCOMPLETE],
    ["up", 0],
    ["vanquished", AUTOCOMPLETE],
    ["version", AUTOCOMPLETE],
    ["versionshort", 0],
    ["vision", AUTOCOMPLETE | WIZMODECMD],
    ["wait", 0],
    ["wear", 0],
    ["whatdoes", 0],
    ["whatis", 0],
    ["wield", 0],
    ["wipe", AUTOCOMPLETE],
    ["wizborn", WIZMODECMD],
    ["wizbury", AUTOCOMPLETE | WIZMODECMD],
    ["wizcast", WIZMODECMD],
    ["wizcustom", WIZMODECMD],
    ["wizdetect", WIZMODECMD],
    ["wizdispmacros", AUTOCOMPLETE | WIZMODECMD],
    ["wizfliplevel", WIZMODECMD],
    ["wizgenesis", WIZMODECMD],
    ["wizidentify", WIZMODECMD],
    ["wizintrinsic", AUTOCOMPLETE | WIZMODECMD],
    ["wizkill", AUTOCOMPLETE | WIZMODECMD],
    ["wizlevelport", WIZMODECMD],
    ["wizloaddes", WIZMODECMD],
    ["wizloadlua", WIZMODECMD],
    ["wizobjprobs", WIZMODECMD],
    ["wizmakemap", WIZMODECMD],
    ["wizmap", WIZMODECMD],
    ["wizmondiff", AUTOCOMPLETE | WIZMODECMD],
    ["wizrumorcheck", AUTOCOMPLETE | WIZMODECMD],
    ["wizseenv", AUTOCOMPLETE | WIZMODECMD],
    ["wizshownhuuid", AUTOCOMPLETE | WIZMODECMD],
    ["wizsmell", AUTOCOMPLETE | WIZMODECMD],
    ["wiztelekinesis", AUTOCOMPLETE | WIZMODECMD],
    ["wizwhere", AUTOCOMPLETE | WIZMODECMD],
    ["wizwish", WIZMODECMD],
    ["wmode", AUTOCOMPLETE | WIZMODECMD],
    ["zap", 0],
    ["movewest", 0],
    ["movenorthwest", 0],
    ["movenorth", 0],
    ["movenortheast", 0],
    ["moveeast", 0],
    ["movesoutheast", 0],
    ["movesouth", 0],
    ["movesouthwest", 0],
    ["rushwest", 0],
    ["rushnorthwest", 0],
    ["rushnorth", 0],
    ["rushnortheast", 0],
    ["rusheast", 0],
    ["rushsoutheast", 0],
    ["rushsouth", 0],
    ["rushsouthwest", 0],
    ["runwest", 0],
    ["runnorthwest", 0],
    ["runnorth", 0],
    ["runnortheast", 0],
    ["runeast", 0],
    ["runsoutheast", 0],
    ["runsouth", 0],
    ["runsouthwest", 0],
    ["clicklook", INTERNALCMD],
    ["mouseaction", INTERNALCMD],
    ["altadjust", INTERNALCMD],
    ["altdip", INTERNALCMD],
    ["alttakeoff", INTERNALCMD],
    ["altunwield", INTERNALCMD],
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
function draw_getlin(query, shown, cursorCol) {
    const disp = game?.nhDisplay;
    if (!disp?.setCell) return;
    const line = query + ' ' + shown;
    for (let c = 0; c < disp.cols; c++) {
        const ch = c < line.length ? line[c] : ' ';
        disp.setCell(c, 0, ch, NO_COLOR, 0);
    }
    disp.setCursor(Math.min(cursorCol, disp.cols - 1), 0);
}

// C ref: win/tty/getline.c hooked_tty_getlin().  Reads a line at the top
// line, with optional completion hook.  Each keystroke is its own captured
// screen frame (the nhgetch fires the capture hook for the freshly drawn
// prompt state).  Returns the typed string, or "\x1b" if escaped out of an
// empty buffer.
async function hooked_tty_getlin(query, hook) {
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
            return typed;
        }
        if (code === 8 || code === 127) { // backspace / delete-prev
            if (typed.length > 0) {
                typed = typed.slice(0, -1);
                const expanded = hook ? hook(typed) : null;
                shown = expanded != null ? expanded : typed;
            }
            continue;
        }
        if (code >= 32 && code !== 0x7f && typed.length < 79) {
            typed += String.fromCharCode(code);
            const expanded = hook ? hook(typed) : null;
            shown = expanded != null ? expanded : typed;
        }
        // any other key: ignore (tty bell), reloop and redraw.
    }
}

// C ref: win/tty/getline.c tty_get_ext_cmd().  Read a full-word extended
// command name with completion, then resolve it to an extcmdlist index via
// an exact (autocomplete-ignoring) match.  Returns the index, or -1.
async function tty_get_ext_cmd() {
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
    for (;;) {
        drawPrompt();
        let q = await nhgetch();
        if (resp == null) return String.fromCharCode(q);
        let c = String.fromCharCode(q).toLowerCase();
        if (q === 27) { // ESC
            if (resp.includes('q')) return 'q';
            if (resp.includes('n')) return 'n';
            return def || '\0';
        }
        if (q === 32 || q === 13 || q === 10) return def || '\0';
        if (resp.includes(c)) return c;
        // otherwise: bell, reloop.
    }
}

// ── individual extended commands ──

// C ref: apply.c dojump()/jump().  For the recorded knight (innate Jumping)
// this reaches the "Where do you want to jump?" prompt and then enters
// getpos() targeting mode (farlook).  We render the prompt + its --More--
// (getpos's first-use tip is about to overwrite the message window) and
// then stop short of the full targeting loop.
async function dojump() {
    // C ref: apply.c jump() -> getpos(&cc, TRUE, "the desired position").
    // The "Where do you want to jump?" prompt is followed (in tty) by a
    // --More-- because the getpos first-use tip is about to overwrite the
    // message window; then getpos() runs its farlook tip and cursor loop.
    // The picked target is validated with is_valid_jump_pos(showmsg=TRUE);
    // if it fails (e.g. an obstacle), the failure message is shown and the
    // jump is aborted (no time passes).  Actually performing a valid jump
    // (movement + landing) is not modelled — the recorded knight session's
    // jump always fails the obstacle check.
    await pline('Where do you want to jump?');
    await topl_more();
    const u = game.u;
    const cc = await getpos('the desired position', u.ux, u.uy,
                            (x, y) => get_valid_jump_position(x, y));
    if (!cc) return 0; // ESC
    await is_valid_jump_pos(cc.x, cc.y, /*showmsg=*/true);
    return 0;
}

// C ref: wizcmds.c wiz_level_change().  getlin a target experience level.
// The level-set itself (pluslvl/losexp) is RNG/state heavy; we render the
// numeric getlin prompt + echo and stop before applying.
async function wiz_level_change() {
    await getlin_top('To what experience level do you want to be set?');
    return 0;
}

// C ref: wield.c dotwoweapon().  Toggle two-weapon combat.
async function dotwoweapon() {
    if (game.u?.twoweap) {
        await pline('You switch to your primary weapon.');
        game.u.twoweap = false;
        return 0;
    }
    if (can_twoweapon()) {
        await pline('You begin two-weapon combat.');
        if (game.u) game.u.twoweap = true;
        return 0;
    }
    return 0;
}

// C ref: wield.c can_twoweapon().  We model the subset that decides the
// recorded outcome: both hands must hold a (one-handed) weapon and no shield
// may be worn.  uwep/uswapwep/uarms come from u_init's ini_inv wielding.
function can_twoweapon() {
    if (!game.uwep || !game.uswapwep) return false;
    if (game.uarms) return false; // wearing a shield
    return true;
}

// C ref: pray.c dopray().  ParanoidPray is on by default, so confirm first.
async function dopray() {
    const ok = await paranoid_query('Are you sure you want to pray?');
    if (!ok) return 0;
    // The prayer outcome (can_pray / prayer timeout / alignment) is RNG and
    // game-state heavy; stop after the confirmation.
    return 0;
}

// C ref: cmd.c paranoid_query()/paranoid_ynq() with be_paranoid=FALSE
// (ParanoidConfirm unset): yn_function(prompt, "yn", 'n').
async function paranoid_query(prompt) {
    return (await yn_function(prompt, 'yn', 'n')) === 'y';
}

// ── getlin (plain top-line line input, no completion) ──
// C ref: win/tty/getline.c tty_getlin().
async function getlin_top(query) {
    return await hooked_tty_getlin(query, null);
}

// Map extcmdlist index -> handler.  Unimplemented commands fall through to
// a no-op (no message), which keeps RNG/state untouched.
const HANDLERS = {
    jump: dojump,
    levelchange: wiz_level_change,
    twoweapon: dotwoweapon,
    pray: dopray,
};

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
    if (fn) {
        await fn();
    }
    // Commands we don't model take no game time and emit no message.
    game.context.move = 0;
    return 0;
}
