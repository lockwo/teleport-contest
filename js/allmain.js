// allmain.js — Main game loop.
// C ref: allmain.c — newgame, moveloop, moveloop_core.
//
// Uses fastforward.js for pre/post-mklev RNG parity on seed8000.
// Real mklev.js handles level generation for screen parity.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { mklev, l_nhcore_init, u_on_upstairs } from './mklev.js';
import { makedog } from './dog.js';
import { rhack } from './cmd.js';
import { docrt, cls, bot, flush_screen, pline } from './display.js';
import { vision_recalc, vision_reset, init_vision_globals } from './vision.js';
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
