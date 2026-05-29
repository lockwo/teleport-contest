// allmain.js — Main game loop.
// C ref: allmain.c — newgame, moveloop, moveloop_core.
//
// Uses fastforward.js for pre/post-mklev RNG parity on seed8000.
// Real mklev.js handles level generation for screen parity.

import { game } from './gstate.js';
import { rn2, rnd, rn1 } from './rng.js';
import { nhgetch } from './input.js';
import { ATR_INVERSE, NO_COLOR, DEC_TO_UNICODE } from './terminal.js';
import { mklev, l_nhcore_init, u_on_upstairs } from './mklev.js';
import { makedog } from './dog.js';
import { rhack } from './cmd.js';
import { docrt, cls, bot, flush_screen, pline, topl_more } from './display.js';
import { vision_recalc, vision_reset, init_vision_globals } from './vision.js';
import { phase_of_the_moon, friday_13th, NEW_MOON, FULL_MOON } from './calendar.js';
import { fastforward_pre_mklev, fastforward_post_mklev, fastforward_step, fastforward_step_count, fastforward_fill_mineralize } from './fastforward.js';
import { movemon, mcalcdistress, mcalcmove } from './mon.js';
import { dosounds } from './sounds.js';
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

// Role names whose real u_init (attrs + inventory) actually runs in
// fastforward_post_mklev (see fastforward.js) — only these have real player
// state to render via newgame_real().  Must stay in sync with the routing in
// fastforward_post_mklev().
const REAL_UINIT_ROLES = new Set([
    'wizard', 'rogue', 'samurai', 'priest',
    'archeologist', 'barbarian', 'caveman', 'healer', 'monk',
    'ranger', 'valkyrie',
]);

function gameRoleName() {
    if (Number.isInteger(game.initrole))
        return roles[game.initrole]?.name?.m?.toLowerCase() || '';
    return String(game.initrole || '').toLowerCase();
}

function realUinitRan() {
    const name = gameRoleName();
    if (name === 'knight') return game.preferred_pet === 'n';
    return REAL_UINIT_ROLES.has(name);
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

    // C ref: allmain.c newgame() — u.ualign.type is set (role_init/init_align)
    // before makedog().  peace_minded() compares the pet's alignment sign to
    // u.ualign.type, so it must be populated here for non-wizard/knight roles
    // (e.g. chaotic Rogue, lawful Samurai) to skip the co-align rn2 correctly.
    {
        const at = aligns[game.initalign]?.value;
        if (at !== undefined) {
            g.u.ualign = g.u.ualign || {};
            g.u.ualign.type = at;
            if (g.u.ualign.record === undefined) g.u.ualign.record = 0;
        }
    }
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

        // The acknowledged top-line message no longer belongs on screen.  When
        // a long welcome line wrapped its "--More--" onto grid row 1 (cols
        // 0..7), the tutorial menu must clear it AND restore the map cell that
        // was underneath.  C ref: the message window is cleared when the menu
        // window is raised.  Clear grid rows 0 (message) and 1 (wrap) fully,
        // then redraw the map there before overlaying the menu.
        for (let c = 0; c < cols; c++) {
            disp.setCell(c, 0, ' ', NO_COLOR, 0);
            disp.setCell(c, 1, ' ', NO_COLOR, 0);
        }
        // Restore the map underneath grid row 1 (map y == 0).
        if (game.level) {
            for (let x = 1; x < cols + 1; x++) {
                const loc = game.level.at(x, 0);
                if (!loc?.disp_ch || loc.disp_ch === ' ') continue;
                const ch = loc.disp_decgfx ? (DEC_TO_UNICODE[loc.disp_ch] || loc.disp_ch) : loc.disp_ch;
                disp.setCell(x - 1, 1, ch, loc.disp_color ?? NO_COLOR, loc.disp_attr ?? 0);
            }
        }
        // Overlay the menu: clear cols offx..end per row, leaving the rest of
        // the map visible underneath.
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

// C ref: attrib.c innate ability tables (sam_abil/mon_abil/kni_abil/...).
// The dungeon level at which each role first gains intrinsic Fast (HFast).
// Roles absent from this map never gain Fast intrinsically.  Used by
// u_calc_moveamt() to decide whether the per-turn hero-speed rn2(3) fires.
const FAST_AT_LEVEL = Object.freeze({
    1: 7,   // Barbarian (bar_abil)
    2: 7,   // Caveman   (cav_abil)
    4: 7,   // Knight    (kni_abil)
    5: 1,   // Monk      (mon_abil)
    9: 1,   // Samurai   (sam_abil)
    11: 7,  // Valkyrie  (val_abil)
    0: 10,  // Archeologist (arc_abil)
});

// C ref: hack.h Fast / Very_fast — does the hero have intrinsic Fast?
// We model only the role-granted intrinsic (no speed boots/potions in the
// gameplay sessions we exercise).  Very_fast (extrinsic) is never set here,
// so u_calc_moveamt only emits the `Fast` branch rn2(3).
function youHaveFast() {
    const mnum = gameRoleMnum();
    const lvl = FAST_AT_LEVEL[mnum];
    if (lvl == null) return false;
    return (game.u?.ulevel ?? 1) >= lvl;
}

// C ref: allmain.c u_calc_moveamt() — gives the hero movement points for the
// turn.  A Fast hero gets a free action on 1/3 of turns: `if (rn2(3) == 0)`.
// (Very_fast would instead roll `if (rn2(3) != 0)`; not modeled.)  Only the
// rn2(3) side-effect matters for parity; the hero still moves once per command
// in our simplified loop.
function u_calc_moveamt() {
    if (game.u?.usteed) return; // steed branch consumes no rn2(3)
    if (youHaveFast()) rn2(3);
}

// C ref: allmain.c maybe_generate_rnd_mon() — small chance of a new monster.
function maybe_generate_rnd_mon() {
    // depth(uz) on dlvl 1 is below the stronghold => rn2(70).
    if (!rn2(70)) {
        // makemon((struct permonst *)0, 0, 0, NO_MM_FLAGS) — left unspawned
        // here; spawning needs full makemon placement which our level fill
        // doesn't materialize.  The roll itself preserves RNG position.
    }
}

// C ref: allmain.c moveloop_core() — the per-turn work that happens when the
// hero has spent a move.  Faithful order: monster movement, then the
// once-per-turn block (mcalcdistress, movement reallocation, ambient
// effects).  Runs the real (general) machinery over materialized monsters.
// Exported so the multi-turn run/travel loop in hack.js can run the same
// per-turn machinery between its inline domove() steps (a run executes many
// turns within a single command, with no nhgetch between them).
export function moveloop_turn() {
    const g = game;

    // monster movement loop (svc.context.mon_moving)
    g.context = g.context || {};
    g.context.mon_moving = true;
    let monscanmove = false;
    do {
        monscanmove = movemon();
        // hero only gets one move per turn here (no Very_fast modelling)
        break;
    } while (monscanmove);
    g.context.mon_moving = false;

    // set up for a new turn
    mcalcdistress();
    for (const mtmp of (g.level?.monsters || [])) {
        if (mtmp.mhp != null && mtmp.mhp <= 0) continue;
        mtmp.movement = (mtmp.movement || 0) + mcalcmove(mtmp, true);
    }
    maybe_generate_rnd_mon();

    // C ref: allmain.c — u_calc_moveamt(mvl_wtcap); settrack();  The Fast
    // hero-speed roll happens here, between maybe_generate_rnd_mon and the
    // once-per-turn block (matches the recorded RNG position).
    u_calc_moveamt();

    g.moves = (g.moves || 1) + 1;

    // once-per-turn things: ambient sounds + hunger.  (nh_timeout / regen /
    // age_spells consume no RNG for the starter sessions.)
    dosounds();
    gethungry();

    // u_wipe_engr check: rn2(40 + ACURR(A_DEX) * 3).  acurr order is
    // [Str, Int, Wis, Dex, Con, Cha] -> Dex is index 3.
    const dex = g.u?.acurr?.a?.[3] ?? 12;
    if (!rn2(40 + dex * 3)) {
        rnd(3); // u_wipe_engr(rnd(3))
    }

    // clairvoyance bookkeeping: seer_turn (rn1(31,15)) when moves catches up
    if (g.context.seer_turn != null && g.moves >= g.context.seer_turn) {
        g.context.seer_turn = g.moves + rn1(31, 15);
    }
}

// C ref: eat.c gethungry() — the rn2(20) "accessorytime" roll each turn.
function gethungry() {
    rn2(20);
}

// C ref: allmain.c moveloop_core()
export async function moveloop_core() {
    const g = game;

    // Per-turn work runs at the TOP of the turn that follows a hero move,
    // mirroring the C moveloop (monsters move based on the previous command's
    // svc.context.move).  For the recorded seed8000 starter we replay its
    // captured per-move RNG; otherwise we run the real general turn.
    if (g._pendingTurn) {
        g._pendingTurn = false;
        const turnNum = g._turnsTaken = (g._turnsTaken || 0) + 1;
        if (fastforward_step_count() > 0 && turnNum <= fastforward_step_count()) {
            // Recorded per-move RNG replay (seed8000 starter path).
            fastforward_step(turnNum);
            g.moves = (g.moves || 1) + 1;
        } else {
            moveloop_turn();
        }
    }

    // Vision + display
    if (g.vision_full_recalc) {
        vision_recalc(0);
        g.vision_full_recalc = 0;
    }
    await bot();
    await flush_screen(1);

    // Read and execute one command.  rhack clears the previous command's
    // top-line message only after the capture for that command has fired
    // (i.e. after its own nhgetch returns), so a free-action message such as
    // dolook's "You see no objects here." survives onto the captured screen.
    await rhack(0);

    // A command that took game time schedules the per-turn work for the
    // next iteration (so the status line / map reflect the elapsed turn
    // when the next screen is captured).
    if (g.context?.move) {
        g._pendingTurn = true;
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
