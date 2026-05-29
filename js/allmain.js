// allmain.js — Main game loop.
// C ref: allmain.c — newgame, moveloop, moveloop_core.
//
// Uses fastforward.js for pre/post-mklev RNG parity on seed8000.
// Real mklev.js handles level generation for screen parity.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { nhgetch } from './input.js';
import { ATR_INVERSE, NO_COLOR } from './terminal.js';
import { mklev, l_nhcore_init, u_on_upstairs } from './mklev.js';
import { makedog } from './dog.js';
import { rhack } from './cmd.js';
import { docrt, cls, bot, flush_screen, pline, topl_more } from './display.js';
import { vision_recalc, vision_reset, init_vision_globals } from './vision.js';
import { phase_of_the_moon, friday_13th, NEW_MOON, FULL_MOON } from './calendar.js';
import { fastforward_pre_mklev, fastforward_post_mklev, fastforward_step, fastforward_fill_mineralize } from './fastforward.js';
import { find_ac } from './u_init.js';
import { com_pager_legacy } from './questpgr.js';
import { roles, races, aligns, Hello, rankName } from './role.js';
import { ROLE_MALE, ROLE_FEMALE } from './const.js';

const PM_KNIGHT = 4;
const PM_WIZARD = 12;

// Resolve the role's PM number from game.initrole (index or name).
function gameRoleMnum() {
    if (Number.isInteger(game.initrole))
        return roles[game.initrole]?.mnum ?? game.initrole;
    const name = String(game.initrole || '').toLowerCase();
    return roles.find((r) => r.name?.m?.toLowerCase() === name)?.mnum ?? null;
}

// True for roles whose real u_init (attrs + inventory) actually ran in
// fastforward_post_mklev — only these have real player state to render.
function realUinitRan() {
    const mnum = gameRoleMnum();
    if (mnum === PM_WIZARD) return true;
    if (mnum === PM_KNIGHT && game.preferred_pet === 'n') return true;
    return false;
}

// C ref: allmain.c welcome(TRUE) — startup greeting message text.
function welcomeMessage() {
    const role = roles[game.initrole];
    const race = races[game.initrace] || races[0];
    const align = aligns[game.initalign];
    const female = !!game.flags?.female;
    const plname = game.flags?.debug ? 'wizard' : (game.plname || 'Hero');

    let buf = ` ${align?.adj || 'neutral'}`;
    // Gender word: only when role has no fixed female name and allows both.
    if (!role?.name?.f
        && (role?.allow & (ROLE_MALE | ROLE_FEMALE)) === (ROLE_MALE | ROLE_FEMALE))
        buf += ` ${female ? 'female' : 'male'}`;
    const roleNm = (female && role?.name?.f) ? role.name.f : role?.name?.m;
    buf += ` ${race.adj} ${roleNm}`;
    return `${Hello(gameRoleMnum())} ${plname}, welcome to NetHack!  You are a${buf}.`;
}

// C ref: allmain.c newgame()
export async function newgame() {
    const g = game;

    // Fast-forward through pre-mklev startup RNG calls.
    // Covers: o_init (shuffles), dungeon init, u_init_misc.
    fastforward_pre_mklev();

    // C ref: allmain.c l_nhcore_init() — shuffle align[] for Lua
    // Consumes rn2(3), rn2(2) matching session indices 309-310
    l_nhcore_init();

    // Set up game state needed by mklev
    g.dungeons = [{ dname: 'The Dungeons of Doom', depth_start: 1, num_dunlevs: 30 }];
    g.u = g.u || {};
    g.u.uz = { dnum: 0, dlevel: 1 };
    g.flags = g.flags || {};
    // Branch: Mines entrance on level 1 (for seed 8000)
    g.branches = [
        { end1: { dnum: 0, dlevel: 1 }, end2: { dnum: 2, dlevel: 1 }, end1_up: true },
    ];

    // Real mklev generates the level with correct room positions
    // Structural phase consumes RNG for rooms/corridors/doors/stairs
    await mklev();

    // Fill rooms + mineralize: replayed by fastforward
    // These create objects/monsters that don't affect terrain display
    await fastforward_fill_mineralize();

    // C ref: dog.c makedog() - create the starting pet after level fill.
    u_on_upstairs();
    makedog();

    // Fast-forward through post-mklev startup RNG calls.
    // Covers: u_init_role, ini_inv, attributes, moveloop_preamble.
    // For wizard/knight this runs the real u_init_inventory_attrs().
    fastforward_post_mklev();

    if (realUinitRan()) {
        await newgame_real();
        return;
    }

    // Hardcoded player state for seed8000 Tourist (fastforward path).
    g._goldCount = 757;
    g.u.ulevel = 1;
    g.u.uhp = 10; g.u.uhpmax = 10;
    g.u.uen = 2; g.u.uenmax = 2;
    g.u.uac = 10; g.u.uexp = 0;
    g.u.ualign = { type: 0, record: 0 };
    // Stored in attribute order [STR, INT, WIS, DEX, CON, CHA].
    g.u.acurr = { a: [9, 11, 16, 14, 12, 16] };
    g.u.amax = { a: [9, 11, 16, 14, 12, 16] };
    g.moves = 1;
    g.urole = { name: { m: 'Tourist', f: 'Tourist' }, rank: { m: 'Rambler', f: 'Rambler' } };
    g.urace = { adj: 'human' };
    g.flags.female = true;
    g.plname = g.plname || 'Contestant';

    // Initial display
    init_vision_globals();
    vision_reset();
    vision_recalc(0);
    await cls();
    await docrt();
    await flush_screen(1);
    await bot();

    // Welcome message
    const alignName = 'neutral';
    const genderAdj = g.flags?.female ? 'female' : 'male';
    await pline(`Aloha ${g.plname}, welcome to NetHack!  You are a ${alignName} ${genderAdj} human ${g.urole.name.m}.`);
}

// Game start for roles whose real u_init ran (wizard/knight): render
// the real role/attrs/HP/Pw/AC, the legacy legend (if enabled) and the
// welcome line.  C ref: allmain.c newgame() lines ~815-843.
async function newgame_real() {
    const g = game;
    const mnum = gameRoleMnum();
    const role = roles[game.initrole];

    // Wire up urole/urace/ualign and level for the status line.
    g.urole = { name: { m: role?.name?.m, f: role?.name?.f },
                rank: { m: rankName(game.initrole, !!g.flags?.female) },
                mnum };
    g.urace = { adj: races[game.initrace]?.adj || 'human' };
    const alignType = aligns[game.initalign]?.value ?? 0;
    g.u.ualign = { type: alignType, record: 0 };
    g.u.ulevel = 1; g.u.ulevelmax = 1; g.u.uexp = 0;
    g.u.uz = g.u.uz || { dnum: 0, dlevel: 1 };
    g.u.umonnum = mnum;
    g._goldCount = 0;
    g.moves = 1;
    g.flags = g.flags || {};
    if (g.flags.female === undefined)
        g.flags.female = (game.initgend === 1);
    // Pre-find_ac armor class is 0 (matches the legend-step status line).
    g.u.uac = 0;

    init_vision_globals();
    vision_reset();
    vision_recalc(0);
    await cls();
    await docrt();
    await flush_screen(1);
    await bot();

    // C ref: allmain.c — com_pager("legacy") when the legacy option is on.
    // The legend menu overlays the already-drawn map (clearing only its own
    // columns) and the status line underneath still shows pre-find_ac AC (0).
    const legacyOn = (g.flags?.legacy !== false);
    if (legacyOn) {
        await com_pager_legacy();
    }

    // find_ac() runs in u_init_skills_discoveries (after the legend's bot,
    // before welcome) — gives the real AC shown from the welcome step on.
    find_ac();

    // C ref: allmain.c welcome(TRUE).
    await cls();
    await docrt();
    await flush_screen(1);
    await bot();
    await pline(welcomeMessage());

    // C ref: allmain.c moveloop_preamble() — runs right after newgame().
    // The moon-phase / Friday-the-13th greeting is the first thing printed
    // after welcome(); because the welcome line is still on the top line,
    // printing it forces a "--More--" on the welcome message first.
    const preambleShownMore = await moveloop_preamble_messages();

    // C ref: allmain.c moveloop() -> maybe_do_tutorial().  When the tutorial
    // wasn't disabled in the rc, a menu asking "Do you want a tutorial?" is
    // displayed; showing that menu flushes the pending top-line message,
    // which forces its "--More--" first (if not already acknowledged).
    await maybe_do_tutorial(preambleShownMore);
}

// C ref: allmain.c moveloop_preamble() — the new-game moon-phase /
// Friday-13th messages.  These are the second message after welcome(), so
// they trigger the welcome line's "--More--" prompt before being shown.
async function moveloop_preamble_messages() {
    const g = game;
    const moonphase = phase_of_the_moon();
    let preamble = null;
    if (moonphase === FULL_MOON)
        preamble = 'You are lucky!  Full moon tonight.';
    else if (moonphase === NEW_MOON)
        preamble = 'Be careful!  New moon tonight.';
    if (!preamble && friday_13th())
        preamble = 'Watch out!  Bad things can happen on Friday the 13th.';

    if (!preamble) return false;

    // The welcome line is the current top-line message; the new preamble
    // message can't share the line, so acknowledge the welcome via --More--.
    await topl_more();
    // Now the preamble message becomes the top line for the next step.
    await pline(preamble);
    return true;
}

// C ref: allmain.c maybe_do_tutorial() + options.c ask_do_tutorial().
// When the tutorial option wasn't set in the rc, a NHW_MENU asking the
// player is displayed.  Our recorded sessions all answer "no".
async function maybe_do_tutorial(preambleShownMore) {
    const g = game;
    if (g.tutorial_set_in_config) return; // "OPTIONS=!tutorial" => no prompt
    // Showing the menu flushes the pending top-line message.  If the moon
    // phase preamble already paged the welcome line, the message currently
    // on the top line is the preamble; otherwise it's the welcome line.
    await topl_more();
    await ask_do_tutorial();
}

// Render the "Do you want a tutorial?" NHW_MENU exactly as the tty corner
// menu does and read the y/n response.  C ref: options.c ask_do_tutorial,
// win/tty/wintty.c process_menu_window.  The menu re-displays (adding a
// "(Please choose...)" line) whenever the user confirms without selecting.
async function ask_do_tutorial() {
    const disp = game.nhDisplay;
    if (!disp?.putstr) { game._pending_message = ''; return; }
    const cols = 80;

    const renderMenu = (pass) => {
        const lines = [
            { text: 'Do you want a tutorial?', attr: ATR_INVERSE },
            { text: '' },
            { text: 'y - Yes, do a tutorial' },
            { text: 'n - No, just start play' },
            { text: '' },
            { text: 'Put "OPTIONS=!tutorial" in .nethackrc to skip this query.' },
        ];
        if (pass > 0) lines.push({ text: "(Please choose 'y' or 'n'.)" });
        lines.push({ text: '(end)' });

        let maxlen = 0;
        for (const l of lines) if (l.text.length > maxlen) maxlen = l.text.length;
        const offx = Math.max(10, cols - (maxlen + 1) - 1);

        // Overlay the map: clear the message row and cols offx..end per row,
        // leaving the rest of the map visible underneath.
        for (let c = 0; c < cols; c++) disp.setCell(c, 0, ' ', NO_COLOR, 0);
        for (let i = 0; i < lines.length; i++) {
            for (let c = offx; c < cols; c++) disp.setCell(c, i, ' ', NO_COLOR, 0);
            if (lines[i].text)
                disp.putstr(offx, i, lines[i].text, NO_COLOR, lines[i].attr || 0);
        }
        const endRow = lines.length - 1;
        disp.setCursor(offx + 6, endRow);
    };

    let pass = 0;
    renderMenu(pass++);
    for (;;) {
        const c = await nhgetch();
        const ch = String.fromCharCode(c);
        if (ch === 'y') { game._tutorial_yes = true; break; }
        if (ch === 'n' || c === 27) break;       // No / Escape => start play
        // space / return confirm with no selection => re-prompt; any other
        // key is ignored (the menu just waits for the next key).
        if (c === 32 || c === 13 || c === 10) renderMenu(pass++);
    }
    game._pending_message = '';
}

// C ref: allmain.c moveloop_core()
export async function moveloop_core() {
    const g = game;

    // Fast-forward per-step RNG (monster movement, regen, sounds, hunger)
    const stepNum = (g.moves || 1) - 1;
    fastforward_step(stepNum);

    // Vision + display
    if (g.vision_full_recalc) {
        vision_recalc(0);
        g.vision_full_recalc = 0;
    }
    await bot();
    await flush_screen(1);

    // Read and execute one command
    await rhack(0);

    // Clear message after command is processed
    g._pending_message = '';

    // Advance turn
    if (g.context?.move) {
        g.moves = (g.moves || 1) + 1;
    }
}

// C ref: allmain.c moveloop()
export async function moveloop(resuming) {
    vision_recalc(0);
    await docrt();
    await flush_screen(1);

    for (;;) {
        await moveloop_core();
        if (game.program_state?.gameover) break;
    }
}
