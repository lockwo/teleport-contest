// jsmain.js — Game engine: NethackGame class + per-segment runner.
// C ref: unixmain.c — nethack_main() initialization and game setup.
//
// Contest contract: the judge orchestrates sessions (load JSON,
// normalize v4/v5, loop segments, aggregate scores). It calls
// runSegment(segment, prevGame) for each game segment and reads back
// game.getScreens() / getRngLog() / getCursors() to compare with
// C-recorded session data.
//
// For browser play, see nethack.js (uses NethackGame directly).

import { game, resetGame } from './gstate.js';
import { initRng, enableRngLog, getRngLog } from './rng.js';
import { pushKey, nhgetch } from './input.js';
import { newgame, moveloop_core } from './allmain.js';
import { parseNethackrc, config_error_report } from './options.js';
import { flush_screen } from './display.js';
import { GameDisplay } from './game_display.js';
import {
    ROLE_NONE, ROLE_RANDOM, ROLE_RACEMASK, ROLE_GENDMASK, ROLE_ALIGNMASK,
    ROLE_MALE, ROLE_FEMALE, ROLE_LAWFUL, ROLE_NEUTRAL, ROLE_CHAOTIC,
    PICK_RANDOM, PL_NSIZ,
} from './const.js';
import { bail } from './wintty.js';
import { ATR_INVERSE, NO_COLOR } from './terminal.js';
import { serializeGrid } from './screen_serialize.js';
import './light.js';   // registers game.lightsources_hook for vision_recalc
import {
    aligns, apply_selection, build_plselection_prompt, count_ok_race,
    count_ok_gend, count_ok_align, genders, gotrolefilter, ok_align, ok_gend,
    ok_race, ok_role, pick_align, pick_gend, pick_race, pick_role, races,
    randalign, randgend, randrace, randrole, rigid_role_checks, roleName,
    roles, str2align, str2gend, str2race, str2role, validalign, validgend,
    validrace,
} from './role.js';

function initialSelectionFromOptions(opts) {
    return {
        role: str2role(opts.role),
        race: str2race(opts.race),
        gender: str2gend(opts.gender),
        align: str2align(opts.align),
    };
}

function roleKey(ch) {
    const c = ch.toLowerCase();
    const map = {
        a: 0, b: 1, c: 2, h: 3, k: 4, m: 5, p: 6,
        r: 7, R: 8, s: 9, t: 10, v: 11, w: 12,
    };
    return Object.prototype.hasOwnProperty.call(map, ch) ? map[ch] : map[c];
}

function raceKey(ch) {
    return { h: 0, e: 1, d: 2, g: 3, o: 4 }[ch.toLowerCase()];
}

function genderKey(ch) {
    return { m: 0, f: 1 }[ch.toLowerCase()];
}

function alignKey(ch) {
    return { l: 0, n: 1, c: 2 }[ch.toLowerCase()];
}

function keyChar(code) {
    return String.fromCharCode(code);
}

// ── NethackGame ──
// Wraps a single game session with replay infrastructure.
export class NethackGame {
    constructor(opts = {}) {
        this._seed = opts.seed || 0;
        this._datetime = opts.datetime || null;
        this._nethackrc = opts.nethackrc || '';
        // Cross-segment persistence handle. The judge sandbox passes a
        // shared Web-Storage-shaped object here so save / record /
        // bones survive across segments of a session; the browser
        // /play/<owner>/ page passes a localStorage-backed view so
        // those files also survive page reloads. If a port doesn't
        // need persistence (no save/restore implemented yet), it can
        // ignore this; the field just sits unused.
        this._storage = opts.storage || null;
        this._screens = [];
        this._cursors = [];
        this._rngSlices = [];
        // Animation frames captured during each step.  Outer index
        // matches _screens (one entry per input boundary); inner array
        // is the frames that fired between this boundary and the
        // previous one, in emit order.  Populated by animationFrame()
        // calls; committed at each input boundary.
        this._animFramesByStep = [];
        this._pendingAnimFrames = [];
        this._lastRngIdx = 0;
        this._nhgetchCount = 0;
        // Differential-oracle state dumps, parallel to _screens (one entry
        // per input boundary).  Populated ONLY when process.env.NHJSDUMP is
        // set (Node-side diagnosis); a complete no-op otherwise so the judge
        // run (no NHJSDUMP) has zero overhead and zero behaviour change.
        this._stateDumps = [];
        this._nhjsdump = (typeof process !== 'undefined'
                          && process.env && process.env.NHJSDUMP
                          && process.env.NHJSDUMP !== '0') ? true : false;
    }

    // Snapshot the full game state at an input boundary into a plain object
    // mirroring the C recorder's .state.jsonl record (seq/rng/moves/ux/uy/
    // dlevel/uhp/uhpmax/multi + the fmon chain in iteration order).  Called
    // ONLY when NHJSDUMP is set.  `rngCount` is the number of logged RNG
    // calls so far (== getRngLog().length), which equals the C recorder's
    // rng_call_count at the same boundary (both count one entry per
    // top-level rn2/rnd/d/rne/rnz/rnl call), so dumps align by rng#.
    _captureStateDump(rngCount) {
        const u = game.u || {};
        const mons = (game.level && game.level.monsters) || game.fmon || [];
        const out = [];
        for (let i = 0; i < mons.length; i++) {
            const m = mons[i];
            if (!m) continue;
            const d = m.data || {};
            // Normalize JS booleans / undefined to the 0/1 ints C emits.
            const b = (v) => (v ? 1 : 0);
            const n = (v) => (v == null ? 0 : (v | 0));
            out.push({
                i,
                m_id: n(m.m_id),
                pm: (d.pmidx == null ? -1 : (d.pmidx | 0)),
                name: d.name != null ? String(d.name) : '(null)',
                mx: n(m.mx),
                my: n(m.my),
                mhp: n(m.mhp),
                mhpmax: n(m.mhpmax),
                mflee: b(m.mflee),
                mfleetim: n(m.mfleetim),
                mfrozen: n(m.mfrozen),
                mtame: n(m.mtame),
                mpeaceful: b(m.mpeaceful),
                msleeping: b(m.msleeping),
                mcanmove: (m.mcanmove == null ? 1 : b(m.mcanmove)),
                // C recorder's NHOBJDUMP emits these too; without them a
                // position divergence can't be told apart from a movement-point
                // phase offset (mon.c mcalcmove) or a stale mux/muy belief
                // (monmove.c set_apparxy).
                movement: n(m.movement),
                mux: n(m.mux),
                muy: n(m.muy),
                mcansee: (m.mcansee == null ? 1 : b(m.mcansee)),
                mundetected: b(m.mundetected),
                dead: (n(m.mhp) < 1) ? 1 : 0,
            });
        }
        // The C recorder's NHOBJDUMP line also carries the floor-object list
        // (otyp/oclass/ox/oy/quan).  Monster movement goals depend on it
        // (monmove.c m_search_items redirects a monster toward loot it wants),
        // so a position divergence cannot be told apart from a floor-object
        // divergence without it.  Same NHJSDUMP gate as the monster list.
        const fobjs = [];
        for (const o of ((game.level && game.level.objects) || [])) {
            if (!o) continue;
            fobjs.push({
                otyp: (o.otyp | 0),
                oclass: (o.oclass | 0),
                ox: (o.ox | 0),
                oy: (o.oy | 0),
                quan: (o.quan == null ? 1 : (o.quan | 0)),
            });
        }
        // NHJSDUMP=map adds levl[][].typ in the C dump's NHMAPDUMP encoding
        // (ROWNO strings of COLNO hex byte pairs).  Terrain never reaches the
        // scored screen for an unlit square, but it sets mfndpos()'s cnt, which
        // IS the modulus of m_move's rn2(4*(cnt-j)).
        let map;
        if (process.env.NHJSDUMP === 'map') {
            map = [];
            for (let y = 0; y < 21; y++) {
                let s = '';
                for (let x = 0; x < 80; x++)
                    s += ((game.level?.at(x, y)?.typ ?? 0) | 0).toString(16).padStart(2, '0');
                map.push(s);
            }
        }
        this._stateDumps.push({
            seq: this._stateDumps.length + 1,
            map,
            rng: rngCount | 0,
            moves: (game.moves == null ? 0 : (game.moves | 0)),
            ux: (u.ux == null ? 0 : (u.ux | 0)),
            uy: (u.uy == null ? 0 : (u.uy | 0)),
            dlevel: (u.uz && u.uz.dlevel != null)
                    ? (u.uz.dlevel | 0)
                    : (game.dlevel == null ? -1 : (game.dlevel | 0)),
            uhp: (u.uhp == null ? 0 : (u.uhp | 0)),
            uhpmax: (u.uhpmax == null ? 0 : (u.uhpmax | 0)),
            multi: (game.multi == null ? 0 : (game.multi | 0)),
            mons: out,
            nmon: out.length,
            objs: fobjs,
        });
    }

    // Universal animation-frame hook.  Call once per intermediate
    // animation state — typically inside whatever your port writes as
    // the equivalent of NetHack's nh_delay_output() (zap beams, thrown
    // objects, hurtle steps, explosion expansions).
    //
    // Same call, same code, in every runtime:
    //   * Browser /play/  — your writes to the Terminal already update
    //                        the visible DOM cells; we yield via
    //                        requestAnimationFrame so the browser
    //                        actually paints between frames.
    //   * Judge sandbox    — the Terminal is a pure data structure;
    //                        we yield a microtask, effectively
    //                        immediate.
    //   * Local score.sh   — same as judge sandbox.
    //
    // The yield mechanism is the only environment-sensitive bit, and
    // it is invisible to contestant code: every caller writes the same
    // `await game.animationFrame()`.
    //
    // Frames are scored as a SUPPLEMENTAL metric (see API.md).  Not
    // implementing animation frames doesn't penalise your official
    // RNG / screen score in any way.
    async animationFrame() {
        const disp = game?.nhDisplay;
        const term = disp?.terminal || disp;
        this._pendingAnimFrames.push({
            screen: term ? serializeGrid(term) : '',
            cursor: disp ? [disp.cursorCol ?? 0, disp.cursorRow ?? 0, 1] : null,
        });
        if (typeof requestAnimationFrame === 'function') {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        } else {
            await null;
        }
    }

    async start() {
        const g = resetGame();

        // Fixed in-game datetime "YYYYMMDDHHMMSS" — drives the moon-phase /
        // Friday-the-13th game-start messages.  C ref: calendar.c getnow.
        g.datetime = this._datetime || null;

        // Cross-segment persistence handle (save.c/restore.c): the sandbox
        // shares one Web-Storage-shaped object across a session's segments, so
        // a save written by the 'S' command survives into the next segment's
        // restore.  Expose it on `game` so the deep-in-the-command-loop save
        // path can reach it.
        g.storage = this._storage || null;

        // Parse nethackrc
        const opts = parseNethackrc(this._nethackrc);
        g.plname = opts.name || '';
        g.flags = { verbose: true, invlet_constant: true, dark_room: true, ...opts.flags };
        // C ref: options.c set_playmode() — when wizard (debug) mode is requested
        // (OPTIONS=playmode:debug) and authorize_wizard_mode() succeeds (the
        // contest sysconf carries WIZARDS=*, so it always does), the player name
        // is forced to "wizard", overriding any OPTIONS=name:.  This is invisible
        // on the status line (it shows the role title) but surfaces wherever
        // svp.plname is printed, e.g. the stethoscope self-probe "Status of
        // wizard ..." (insight.c:3485).
        if (g.flags.debug) g.plname = 'wizard';
        // C initializes cmdassist enabled; an explicit !cmdassist in the rc
        // is applied below through opts.iflags.
        g.iflags = { cmdassist: true, ...opts.iflags };
        // C ref: cmd.c parsebindings()/reset_commands() — custom key bindings
        // from nethackrc BIND= lines (key char -> command name).  cmd.js rhack()
        // remaps a bound key to the command's default key before dispatch.
        g.keybind = opts.keybind || {};
        // symset selects the drawing glyph table; DECgraphics uses VT100
        // line-drawing for walls/floor, otherwise the default ASCII symbols.
        g.symset = opts.symset || '';
        // C ref: symbols.c parsesymbols()/update_ov_primary_symset() — a
        // SYMBOLS= rc line overrides one cmap glyph's display character,
        // independent of (and layered on top of) the base symset.
        g.symoverride = opts.symoverride || {};
        // C ref: options.c ga.apelist — the AUTOPICKUP_EXCEPTION list, read by
        // pickup.c check_autopickup_exceptions().
        g.apelist = opts.apelist || [];
        const optsel = initialSelectionFromOptions(opts);
        g.initrole = optsel.role;
        g.initrace = optsel.race;
        g.initgend = optsel.gender;
        g.initalign = optsel.align;
        if (opts.preferred_pet) g.preferred_pet = opts.preferred_pet;
        if (opts.tutorial_set) g.tutorial_set_in_config = true;

        // Initialize hero struct
        g.u = { ux: 0, uy: 0, ux0: 0, uy0: 0 };
        g.context = { move: 0 };
        g.program_state = {};
        g.moves = 1;

        // Initialize PRNG
        initRng(this._seed);
        enableRngLog();

        // Install display
        if (this._pendingDisplay) {
            g.nhDisplay = this._pendingDisplay;
            this._pendingDisplay = null;
        }

        // Install capture hook
        this._installCaptureHook();

        // C ref: cfgfiles.c config_error_done() — a rejected rc line is
        // raw_print()ed BEFORE init_nhwindows and then dismissed by a getret()
        // that eats input (each eaten key is a captured boundary).  It runs
        // here rather than at parse time because the boundaries only exist once
        // the display and the capture hook are installed.
        await config_error_report(opts);

        // C prompts for a name before role/race selection when OPTIONS
        // does not supply one.  That selection can consume RNG before
        // o_init/newgame startup begins.
        await this._startupCharacterSelection(optsel);

        // C ref: unixmain.c — if this player already has a save file, restore it
        // instead of starting a new game (restore_saved_game() -> dorecover()).
        const { have_saved_game, dorestore } = await import('./restore.js');
        if (have_saved_game()) {
            await dorestore();
            return;
        }

        // Run game startup
        await newgame();
    }

    _renderStartupScreen(name = game.plname || '', topLine = '') {
        const disp = game.nhDisplay;
        if (!disp?.clearScreen) return;
        // The startup banner ("NetHack, Copyright ...") is on screen until a
        // full-screen chargen menu (the role list, offx=0) clears it.
        this._bannerOnScreen = true;
        this._renameTextRow = null;
        disp.clearScreen();
        if (topLine) disp.putstr(0, 0, topLine, NO_COLOR);
        disp.putstr(0, 4, 'NetHack, Copyright 1985-2026', NO_COLOR);
        disp.putstr(9, 5, 'By Stichting Mathematisch Centrum and M. Stephenson.', NO_COLOR);
        disp.putstr(9, 6, 'Version 5.0.0 MacOS, built May  2 2026 12:00:00.', NO_COLOR);
        disp.putstr(9, 7, 'See license for details.', NO_COLOR);
        // C ref: wintty.c tty_askname() tryct > 1 — the retry hint is written to
        // the BASE window one row above the prompt, so it stays on screen under
        // every later chargen menu (the confirmation overlay starts at col 31).
        if (this._asknameRetry)
            disp.putstr(0, 11, 'Enter a name for your character...', NO_COLOR);
        const prompt = `Who are you? ${name || ''}`;
        disp.putstr(0, 12, prompt, NO_COLOR);
        // The topLine is a tty yn_function prompt ("...? [ynaq]"). C's
        // yn_function prints the prompt followed by a space and leaves
        // the cursor after that space, i.e. one column past the text.
        // The name prompt (getlin) leaves the cursor right after the
        // typed text with no trailing space.
        if (topLine) disp.setCursor(Math.min(topLine.length + 1, 79), 0);
        else disp.setCursor(Math.min(prompt.length, 79), 12);
    }

    // Clear the screen and redraw whatever C left on the BASE window beneath
    // the chargen menus: the startup banner (random 'y' path, before any
    // full-screen menu), the leftover "Who are you? <name>" getlin line (after
    // a "choose another name" rename), or nothing (after a full-screen role
    // menu).  C ref: the menu windows overlay the persistent BASE_WINDOW.
    _drawChargenBase(disp) {
        if (this._bannerOnScreen) {
            this._renderStartupScreen(game.plname || '');
        } else if (this._renameTextRow != null) {
            this._renderRenameScreen(game.plname || '', this._renameTextRow);
        } else {
            disp.clearScreen();
        }
    }

    _renderSelectionOk(sel) {
        const disp = game.nhDisplay;
        if (!disp?.putstr) return;
        // The confirmation is a corner-overlay menu drawn on the persistent base
        // layer (banner / rename line / blank).
        this._drawChargenBase(disp);
        const female = sel.gender === 1;
        const role = roleName(sel.role, female);
        const race = races[sel.race]?.adj || 'human';
        const gender = genders[sel.gender]?.adj || 'male';
        const align = aligns[sel.align]?.adj || 'neutral';
        const nameLine = `${game.plname || 'Hero'} the ${align} ${gender} ${race} ${role}`;
        // C ref: role.c genl_player_setup() getconfirmation loop — the
        // confirmation NHW_MENU: title + blank + unselectable name line + blank
        // + y/n/[a]/q items + "(end)".  The rename entry (and the 'a' in the
        // title) exist only when iflags.renameallowed, which C sets in
        // tty_askname() alone: a name pinned by OPTIONS=name: gives "[ynq]".
        const renameallowed = !!game.iflags?.renameallowed;
        const lines = [
            { text: `Is this ok? [yn${renameallowed ? 'a' : ''}q]`, attr: ATR_INVERSE },
            { text: '' },
            { text: nameLine },
            { text: '' },
            { sel: 'y', text: 'Yes; start game', preselect: true },
            { sel: 'n', text: 'No; choose role again' },
            ...(renameallowed
                ? [{ sel: 'a', text: 'Not yet; choose another name' }] : []),
            { sel: 'q', text: 'Quit' },
            { text: '(end)' },
        ];
        // Row where a subsequent rename getlin would draw (docorner leaves the
        // cursor one row past the menu's last line).
        this._okMenuRenameRow = lines.length + 1;
        // Overlay on the background just prepared above (banner / rename text /
        // blank); never re-clear it.
        this._renderCornerMenu(disp, lines, /*allowOverlay=*/true);
    }

    // Render an NHW_MENU on the existing screen.  `lines` is an array of
    // { text, attr?, sel?, preselect? }.  Computes the H2344_BROKEN offx; a
    // full-screen menu (offx=0, too tall to overlay) first clears the whole
    // screen, while a corner menu (offx>0) just overlays — clearing each menu
    // row from offx to EOL and drawing the leading space + text at offx+1.
    // The `allowOverlay` arg is false for the very first menu of a fresh screen
    // (so it always clears).  C ref: win/tty/wintty.c tty_display_nhwindow
    // NHW_MENU + process_menu_window (H2344_BROKEN corner-menu overlay).
    _renderCornerMenu(disp, lines, allowOverlay = true) {
        const cols = 80, rows = 24;
        let maxcol = 0;
        for (const l of lines) {
            const w = (l.sel ? 4 + l.text.length : l.text.length) + 2;
            if (w > maxcol) maxcol = w;
        }
        let offx = Math.min(Math.min(82, Math.floor(cols / 2)), cols - maxcol - 1);
        if (offx < 0) offx = 0;
        if (lines.length >= rows) offx = 0;
        // Full-screen menus (offx=0) clear everything; corner menus overlay.
        if (offx === 0 || !allowOverlay) {
            disp.clearScreen();
            this._bannerOnScreen = false;
            // A full-screen role menu also wipes any leftover rename getlin line.
            if (offx === 0) this._renameTextRow = null;
        }
        for (let r = 0; r < lines.length; r++) {
            const l = lines[r];
            for (let c = offx; c < cols; c++) disp.setCell(c, r, ' ', NO_COLOR, 0);
            const text = l.sel ? `${l.sel} ${l.preselect ? '*' : '-'} ${l.text}` : l.text;
            if (text) disp.putstr(offx + 1, r, text, NO_COLOR, l.attr || 0);
        }
        disp.setCursor(offx + 7, lines.length - 1);
    }

    // C ref: role.c plsel_startmenu() qbuf — the unselectable "role info so
    // far" preview line.  With name unset or any facet unchosen it reads
    // "<role> <race.noun> <gender.adj> <align.adj>" (placeholders for unset
    // facets); otherwise "<name> the <align> <gender> <race.adj> <role>".
    _plselectionPreview(sel) {
        const rolename = sel.role >= 0 ? roleName(sel.role, sel.gender === 1) : '<role>';
        if (!game.plname || sel.role < 0 || sel.race < 0 || sel.gender < 0 || sel.align < 0) {
            return [
                rolename,
                sel.race >= 0 ? races[sel.race].noun : '<race>',
                sel.gender >= 0 ? genders[sel.gender].adj : '<gender>',
                sel.align >= 0 ? aligns[sel.align].adj : '<alignment>',
            ].join(' ');
        }
        return [
            game.plname, 'the', aligns[sel.align].adj, genders[sel.gender].adj,
            races[sel.race].adj, rolename,
        ].join(' ');
    }

    // C ref: role.c setup_rolemenu() — "an Archeologist", "a Barbarian", &c.
    // Female-distinct names append "/female" while gender is unchosen, or use
    // the female name once a female gender is selected.
    _roleMenuLabel(i, gend) {
        let nm = roles[i].name.m;
        if (roles[i].name.f) {
            if (gend === 1) nm = roles[i].name.f;
            else if (gend < 0) nm = nm + '/' + roles[i].name.f;
        }
        return /^[aeiou]/i.test(nm) ? 'an ' + nm : 'a ' + nm;
    }

    // Build the full chargen menu line list (matching C's add_menu/add_menu_str
    // order) for the facet named by `kind`, then render it right-aligned exactly
    // like win/tty/wintty.c's corner menu (offx = max(10, cols-maxcol-1), each
    // row cleared from offx to EOL, text at offx+1).  C ref: role.c
    // genl_player_setup() makepicks loop + tty_display_nhwindow NHW_MENU.
    _renderRolePrompt(sel, prompt) {
        const disp = game.nhDisplay;
        if (!disp?.putstr) return;
        const cols = 80;
        const rows = 24;

        // Determine which facet we're choosing.
        const kind = prompt.startsWith('Pick a role') ? 'role'
            : prompt.startsWith('Pick a race') ? 'race'
            : prompt.startsWith('Pick a gender') ? 'gender' : 'align';

        // Build the body menu items (selectable, with "x - " prefix) and any
        // unselectable "forces" / preview / blank lines, in C's add order.
        // Each entry: { text, attr?, sel? }.  sel present => selectable item.
        const items = [];
        if (kind === 'role') {
            for (let i = 0; roles[i]; i++) {
                if (!(ok_role(i, sel.race, sel.gender, sel.align)
                      && ok_race(i, sel.race, sel.gender, sel.align)
                      && ok_gend(i, sel.race, sel.gender, sel.align)
                      && ok_align(i, sel.race, sel.gender, sel.align)))
                    continue;
                items.push({ sel: this._roleSelectorChar(i), text: this._roleMenuLabel(i, sel.gender) });
            }
        } else if (kind === 'race') {
            for (let i = 0; races[i]; i++) {
                if (!(ok_race(sel.role, i, sel.gender, sel.align)
                      && ok_role(sel.role, i, sel.gender, sel.align)
                      && ok_align(sel.role, i, sel.gender, sel.align)))
                    continue;
                items.push({ sel: races[i].noun[0], text: races[i].noun });
            }
        } else if (kind === 'gender') {
            for (let i = 0; i < genders.length; i++) {
                if (!(ok_gend(sel.role, sel.race, i, sel.align)
                      && ok_role(sel.role, sel.race, i, sel.align)
                      && ok_race(sel.role, sel.race, i, sel.align)))
                    continue;
                items.push({ sel: genders[i].adj[0], text: genders[i].adj });
            }
        } else {
            for (let i = 0; i < aligns.length; i++) {
                if (!(ok_align(sel.role, sel.race, sel.gender, i)
                      && ok_role(sel.role, sel.race, sel.gender, i)
                      && ok_race(sel.role, sel.race, sel.gender, i)))
                    continue;
                items.push({ sel: aligns[i].adj[0], text: aligns[i].adj });
            }
        }
        // Random (preselected — '*' selector).
        items.push({ sel: '*', text: 'Random', preselect: true });

        // role_menu_extra "constrainer" lines: a single forced facet shows an
        // unselectable "X forces Y" line instead of a "Pick Y first" entry.
        const extras = this._roleMenuExtrasWithForces(sel, kind);

        // Assemble the displayed lines.  end_menu() prepends title + blank;
        // plsel_startmenu() adds the preview line then (maybe) a blank; the
        // role aspect can drop separators to fit (maybe_skip_seps).
        const excess = this._maybeSkipSeps(kind, sel, rows);
        const lines = [];
        lines.push({ text: prompt, attr: ATR_INVERSE }); // title
        lines.push({ text: '' });                         // sep after title
        lines.push({ text: this._plselectionPreview(sel) }); // preview
        if (!(kind === 'role' && excess === 2))
            lines.push({ text: '' });                     // sep after preview
        for (const it of items.slice(0, -1)) lines.push(it); // body items
        lines.push(items[items.length - 1]);                  // Random
        if (!(kind === 'role' && excess >= 1 && excess <= 2))
            lines.push({ text: '' });                     // sep before extras
        for (const e of extras) lines.push(e);
        lines.push({ text: '(end)' });

        // The facet menus (role/race/gender/align) always render on a freshly
        // cleared screen — the full-screen role menu wipes the startup banner
        // and the corner facet menus follow on that blank background, so force
        // a clear (allowOverlay=false) to drop any prior menu's footprint.
        void cols; void rows;
        this._renderCornerMenu(disp, lines, /*allowOverlay=*/false);
    }

    // C ref: role.c setup_rolemenu() — selector is lowercase first letter, but
    // when two roles share a first letter the second uses the uppercase form
    // (Rogue 'r' then Ranger 'R').
    _roleSelectorChar(i) {
        const ch = roles[i].name.m[0].toLowerCase();
        // Find whether an earlier role already used this lowercase letter.
        for (let j = 0; j < i; j++)
            if (roles[j].name.m[0].toLowerCase() === ch
                && ok_role(j, -1, -1, -1)) {
                return ch.toUpperCase();
            }
        return ch;
    }

    // C ref: role.c maybe_skip_seps() — returns excess line count for RS_ROLE
    // so the role menu can drop one or two blank separators to fit `rows`.
    _maybeSkipSeps(kind, sel, rows) {
        if (kind !== 'role') return 0;
        let n = 4; // title+sep, preview+sep
        for (let i = 0; roles[i]; i++)
            if (ok_role(i, sel.race, sel.gender, sel.align)
                && ok_race(i, sel.race, sel.gender, sel.align)
                && ok_gend(i, sel.race, sel.gender, sel.align)
                && ok_align(i, sel.race, sel.gender, sel.align))
                n++;
        n += 2; // random + sep
        n += 5; // race/gender/align first, reset filter, quit
        n += 1; // footer
        return (rows > 0 && n > rows) ? n - rows : 0;
    }

    // C ref: role.c role_menu_extra() — emits either a selectable "Pick X
    // first" entry or, when a facet is forced to a single value by the chosen
    // role/race, an unselectable "<constrainer> forces <value>" line (padded
    // with four leading spaces).  Mirrors the per-facet constrainer logic.
    _roleMenuExtrasWithForces(sel, kind) {
        const out = [];
        const MH_HUMAN = 0x0008;
        const role = sel.role >= 0 ? roles[sel.role] : null;
        // role facet-switch only appears on non-role menus (added first by C).
        if (kind !== 'role')
            out.push({ sel: '?', text: `Pick${sel.role >= 0 ? ' another' : ''} role first` });
        // race
        if (kind !== 'race') {
            let forced = null;
            if (role && (role.allow & ROLE_RACEMASK) === MH_HUMAN)
                forced = { by: 'role', val: 'human' };
            if (forced) out.push({ text: `    ${forced.by} forces ${forced.val}` });
            else out.push({ sel: '/', text: `Pick${sel.race >= 0 ? ' another' : ''} race first` });
        }
        // gender
        if (kind !== 'gender') {
            let forced = null;
            if (role) {
                const m = role.allow & ROLE_GENDMASK;
                if (m === ROLE_MALE) forced = { by: 'role', val: 'male' };
                else if (m === ROLE_FEMALE) forced = { by: 'role', val: 'female' };
            }
            if (forced) out.push({ text: `    ${forced.by} forces ${forced.val}` });
            else out.push({ sel: '"', text: `Pick${sel.gender >= 0 ? ' another' : ''} gender first` });
        }
        // alignment — forced by role first, else by race.
        if (kind !== 'align') {
            let forced = null;
            if (role) {
                const m = role.allow & ROLE_ALIGNMASK;
                if (m === ROLE_LAWFUL) forced = { by: 'role', val: 'lawful' };
                else if (m === ROLE_NEUTRAL) forced = { by: 'role', val: 'neutral' };
                else if (m === ROLE_CHAOTIC) forced = { by: 'role', val: 'chaotic' };
            }
            if (!forced && sel.race >= 0) {
                const m = races[sel.race].allow & ROLE_ALIGNMASK;
                if (m === ROLE_LAWFUL) forced = { by: 'race', val: 'lawful' };
                else if (m === ROLE_NEUTRAL) forced = { by: 'race', val: 'neutral' };
                else if (m === ROLE_CHAOTIC) forced = { by: 'race', val: 'chaotic' };
            }
            if (forced) out.push({ text: `    ${forced.by} forces ${forced.val}` });
            else out.push({ sel: '[', text: `Pick${sel.align >= 0 ? ' another' : ''} alignment first` });
        }
        out.push({ sel: '~', text: (gotrolefilter() ? 'Reset' : 'Set') + ' role/race/&c filtering' });
        out.push({ sel: 'q', text: 'Quit' });
        return out;
    }

    async _readPromptKey() {
        return keyChar(await nhgetch());
    }

    // Render the "Who are you?" getlin re-prompt used by the "choose another
    // name" ('a') path: after the confirmation menu is dismissed C's getlin
    // draws on a blank screen at the row just past the menu (docorner leaves the
    // cursor at cw->maxrow+1).  C ref: win/tty/wintty.c tty_getlin via askname.
    _renderRenameScreen(name, row) {
        const disp = game.nhDisplay;
        if (!disp?.clearScreen) return;
        this._bannerOnScreen = false;
        disp.clearScreen();
        if (this._asknameRetry && row > 0)
            disp.putstr(0, row - 1, 'Enter a name for your character...', NO_COLOR);
        const prompt = `Who are you? ${name || ''}`;
        disp.putstr(0, row, prompt, NO_COLOR);
        disp.setCursor(Math.min(prompt.length, 79), row);
    }

    // C ref: win/tty/wintty.c tty_askname() — NOT getlin(): it echoes each key
    // itself, and on UNIX forces every character other than [A-Za-z-@] (plus
    // digits once ct > 0) to '_', so a stray space or ESC-sequence byte lands
    // on screen as an underscore.  ESC discards the whole response and retries
    // with the hint line one row up; ten empty tries give up.
    async _promptForName(renameRow = -1) {
        let name = '', tryct = 0;
        this._asknameRetry = false;
        const render = (n) => renameRow >= 0
            ? this._renderRenameScreen(n, renameRow)
            : this._renderStartupScreen(n);
        do {
            if (++tryct > 1) {
                if (tryct > 10) {
                    bail('Giving up after 10 tries.\n');
                    return;
                }
                this._asknameRetry = true;
            }
            name = '';
            render(name);
            for (;;) {
                const code = await nhgetch();
                if (code === 10 || code === 13) break;
                if (code === 27) { name = ''; break; } /* continue outer loop */
                if (code === 8 || code === 127) {
                    if (name.length) name = name.slice(0, -1);
                    render(name);
                    continue;
                }
                let c = String.fromCharCode(code);
                if (c !== '-' && c !== '@'
                    && !(c >= 'a' && c <= 'z') && !(c >= 'A' && c <= 'Z')
                    /* a leading digit is rejected, later ones are kept */
                    && !(c >= '0' && c <= '9' && name.length > 0))
                    c = '_';
                if (name.length < PL_NSIZ - 1) name += c;
                render(name);
            }
        } while (!name.length);
        game.plname = name;
        // Remember a rename line so a following confirmation menu overlays it.
        this._renameTextRow = renameRow >= 0 ? renameRow : null;
        // C: "since we let user pick an arbitrary name now, he/she can pick
        // another one during role selection" — this is what puts the 'a' entry
        // in the "Is this ok?" menu.
        game.iflags = game.iflags || {};
        game.iflags.renameallowed = true;
    }

    _nextManualPrompt(sel) {
        if (sel.role < 0) return 'role';
        if (sel.race < 0) return 'race';
        if (sel.gender < 0) return 'gender';
        if (sel.align < 0) return 'align';
        return 'ok';
    }

    _renderManualPrompt(sel, forcePrompt) {
        const prompt = forcePrompt || this._nextManualPrompt(sel);
        if (prompt === 'ok') {
            this._renderSelectionOk(sel);
        } else if (prompt === 'role') {
            this._renderRolePrompt(sel, 'Pick a role or profession');
        } else if (prompt === 'race') {
            this._renderRolePrompt(sel, 'Pick a race or species');
        } else if (prompt === 'gender') {
            this._renderRolePrompt(sel, 'Pick a gender or sex');
        } else {
            this._renderRolePrompt(sel, 'Pick an alignment or creed');
        }
    }

    // C ref: role.c tty_player_selection() makepicks loop (pick4u=='n').
    // Resolve every facet that has only a single valid option WITHOUT showing
    // a menu and WITHOUT consuming a keystroke, advancing facet-by-facet in the
    // C order role->race->gender->alignment. Before a facet whose option count
    // is > 1 (the point where C opens a menu via plsel_startmenu), run the real
    // rigid_role_checks() once — this is the only place chargen consumes RNG
    // (pick_*(PICK_RIGID) emits rn2(1) for any other still-forced facet, e.g.
    // a Rogue's forced chaotic alignment). Returns the prompt the player must
    // answer next ('role'/'race'/'gender'/'align'/'ok'), or null if everything
    // resolved to a single choice.
    _advanceForcedFacets(sel) {
        for (;;) {
            if (sel.role < 0)
                return 'role'; // role always offered via a menu
            if (sel.race < 0) {
                const { n, k } = count_ok_race(sel.role, sel.gender, sel.align);
                if (n > 1) { rigid_role_checks(sel); if (sel.race < 0) return 'race'; else continue; }
                sel.race = k; continue;
            }
            if (sel.gender < 0) {
                const { n, k } = count_ok_gend(sel.role, sel.race, sel.align);
                if (n > 1) { rigid_role_checks(sel); if (sel.gender < 0) return 'gender'; else continue; }
                sel.gender = k; continue;
            }
            if (sel.align < 0) {
                const { n, k } = count_ok_align(sel.role, sel.race, sel.gender);
                if (n > 1) { rigid_role_checks(sel); if (sel.align < 0) return 'align'; else continue; }
                sel.align = k; continue;
            }
            return 'ok';
        }
    }

    // C ref: role.c genl_player_setup() makepicks loop with `nextpick`.  Each
    // facet menu lets the player choose that facet's value, pick Random ('*' /
    // space / return — the preselected entry), switch to another facet
    // ('?'/'/'/'"'/'[' => "Pick X first"), toggle filtering ('~'), or quit.
    // Facet-switching resets that facet (and clears any already-forced facets
    // C re-derives) so the chosen menu reappears.  When all four facets resolve,
    // the "Is this ok?" confirmation is shown.
    async _manualCharacterSelection(sel) {
        let prompt = this._advanceForcedFacets(sel);
        this._renderManualPrompt(sel);
        for (;;) {
            const ch = await this._readPromptKey();
            const lower = ch.toLowerCase();

            if (prompt === 'ok') {
                if (lower === 'y' || ch === '\r' || ch === '\n') return true;
                if (lower === 'n') {
                    sel.role = sel.race = sel.gender = sel.align = ROLE_NONE;
                } else if (lower === 'a' && game.iflags?.renameallowed) {
                    await this._promptForName(this._okMenuRenameRow);
                } else if (lower === 'q') {
                    return false;
                }
                prompt = this._advanceForcedFacets(sel);
                this._renderManualPrompt(sel);
                continue;
            }

            // Quit / escape from any facet menu aborts selection.
            if (lower === 'q' || ch === '\x1b') return false;

            // Filtering menu (multi-select unacceptable roles/races/&c).
            if (ch === '~') {
                await this._filterMenu(sel);
                // After (re)filtering, C restarts the role pick from scratch.
                sel.role = sel.race = sel.gender = sel.align = ROLE_NONE;
                prompt = this._advanceForcedFacets(sel);
                this._renderManualPrompt(sel);
                continue;
            }

            // Facet-switch keys: jump to picking a different facet.  C clears
            // that facet (and, since a later facet may have been auto-forced,
            // re-resolves forced facets afterward).
            const switchTo = { '?': 'role', '/': 'race', '"': 'gender', '[': 'align' }[ch];
            if (switchTo && switchTo !== prompt) {
                // C ref: makepicks sets nextpick = RS_<facet> and jumps straight
                // to that facet's menu, leaving any earlier-but-unchosen facets
                // alone.  Reset the requested facet (so its menu reappears) and
                // run rigid_role_checks() to fill any single-option facets the
                // current partial selection now forces.
                if (switchTo === 'role') sel.role = ROLE_NONE;
                else if (switchTo === 'race') sel.race = ROLE_NONE;
                else if (switchTo === 'gender') sel.gender = ROLE_NONE;
                else if (switchTo === 'align') sel.align = ROLE_NONE;
                rigid_role_checks(sel);
                if (sel.role < 0) sel.role = ROLE_NONE; // pick_role rigid may set
                prompt = switchTo;
                this._renderManualPrompt(sel, prompt);
                continue;
            }

            // Random ('*' or space/return select the preselected entry).
            if (ch === '*' || ch === '\r' || ch === '\n' || ch === ' ') {
                this._pickRandomFacet(sel, prompt);
                prompt = this._advanceForcedFacets(sel);
                this._renderManualPrompt(sel);
                continue;
            }

            if (prompt === 'role') {
                const role = roleKey(ch);
                if (role !== undefined)
                    sel.role = role;
            } else if (prompt === 'race') {
                const race = raceKey(ch);
                if (race !== undefined && ok_race(sel.role, race, sel.gender, sel.align))
                    sel.race = race;
            } else if (prompt === 'gender') {
                const gender = genderKey(ch);
                if (gender !== undefined && ok_gend(sel.role, sel.race, gender, sel.align))
                    sel.gender = gender;
            } else if (prompt === 'align') {
                const align = alignKey(ch);
                if (align !== undefined && ok_align(sel.role, sel.race, sel.gender, align))
                    sel.align = align;
            }

            prompt = this._advanceForcedFacets(sel);
            this._renderManualPrompt(sel);
        }
    }

    // Resolve forced single-option facets but stop at `target` so its menu is
    // shown even if it happens to have a single valid value (the player asked
    // for it explicitly via a "Pick X first" entry).
    _advanceToFacet(sel, target) {
        const order = ['role', 'race', 'gender', 'align'];
        const tIdx = order.indexOf(target);
        for (;;) {
            const p = this._nextManualPrompt(sel);
            if (p === 'ok') return 'ok';
            if (order.indexOf(p) >= tIdx) {
                // At or past the requested facet: show it without auto-forcing.
                return p;
            }
            // Earlier unresolved facet: resolve as the normal loop would.
            const adv = this._advanceForcedFacets(sel);
            if (adv === p) return adv; // can't resolve further; show it
        }
    }

    // C ref: the ROLE_RANDOM menu entry — pick a random value for the facet
    // currently being chosen (pick_role/race/gend/align(PICK_RANDOM)).
    _pickRandomFacet(sel, prompt) {
        const r = { role: sel.role, race: sel.race, gender: sel.gender, align: sel.align };
        if (prompt === 'role') {
            const tmp = { ...r, role: ROLE_RANDOM };
            rigid_role_checks(tmp);
            sel.role = tmp.role;
        } else if (prompt === 'race') {
            const tmp = { ...r, race: ROLE_RANDOM };
            rigid_role_checks(tmp);
            sel.race = tmp.race;
        } else if (prompt === 'gender') {
            const tmp = { ...r, gender: ROLE_RANDOM };
            rigid_role_checks(tmp);
            sel.gender = tmp.gender;
        } else if (prompt === 'align') {
            const tmp = { ...r, align: ROLE_RANDOM };
            rigid_role_checks(tmp);
            sel.align = tmp.align;
        }
    }

    // Placeholder filtering menu — populated below.
    // C ref: role.c reset_role_filtering() — the "Pick all that apply" PICK_ANY
    // menu listing every role/race/gender/alignment under section headers, used
    // to mark facets as unacceptable.  Selectable entries toggle a '+'; on
    // confirm the chosen entries become the new filter (gr.rfilter).  The menu
    // is full-screen (offx=0, leading space, text at col 1) and paginates at
    // (rows-1) items per page.  Returns true if any filter was set.
    async _filterMenu(sel) {
        void sel;
        const disp = game.nhDisplay;
        const cols = 80, rows = 24;

        // Build the item list in C's add order.  Each entry: section header
        // (unselectable) or a selectable { sel, text, kind, idx, selected }.
        const items = [];
        items.push({ header: 'Unacceptable roles' });
        for (let i = 0; roles[i]; i++)
            items.push({ sel: this._roleSelectorChar(i), text: this._roleMenuLabel(i, -1),
                kind: 'role', idx: i, selected: false });
        items.push({ blank: true });
        items.push({ header: 'Unacceptable races' });
        for (let i = 0; races[i]; i++)
            items.push({ sel: races[i].noun[0].toUpperCase(), text: races[i].noun,
                kind: 'race', idx: i, selected: false });
        items.push({ blank: true });
        items.push({ header: 'Unacceptable genders' });
        for (let i = 0; i < genders.length; i++)
            items.push({ sel: genders[i].adj[0].toUpperCase(), text: genders[i].adj,
                kind: 'gender', idx: i, selected: false });
        items.push({ blank: true });
        items.push({ header: 'Unacceptable alignments' });
        for (let i = 0; i < aligns.length; i++)
            items.push({ sel: aligns[i].adj[0].toUpperCase(), text: aligns[i].adj,
                kind: 'align', idx: i, selected: false });

        // Prepend title + blank (end_menu).
        const prompt = 'Pick all that apply'
            + (gotrolefilter() ? ' and/or unpick any that no longer apply' : '');
        const all = [{ title: prompt }, { blank: true }, ...items];

        // Paginate at lmax = min(52, rows-1) items per page.
        const lmax = Math.min(52, rows - 1);
        const npages = Math.ceil(all.length / lmax);

        let page = 0;
        const render = () => {
            disp.clearScreen();
            this._bannerOnScreen = false;
            const start = page * lmax;
            const end = Math.min(start + lmax, all.length);
            let r = 0;
            for (let i = start; i < end; i++, r++) {
                const it = all[i];
                // cl_end from offx(0) to EOL.
                for (let c = 0; c < cols; c++) disp.setCell(c, r, ' ', NO_COLOR, 0);
                let text;
                if (it.title) text = it.title;
                else if (it.header) text = it.header;
                else if (it.blank) text = '';
                else text = `${it.sel} ${it.selected ? '+' : '-'} ${it.text}`;
                // Leading space at col 0, text at col 1.
                if (text) disp.putstr(1, r, text, NO_COLOR, it.title ? ATR_INVERSE : 0);
            }
            // morestr footer.
            const morestr = npages > 1 ? `(${page + 1} of ${npages})` : '(end) ';
            for (let c = 0; c < cols; c++) disp.setCell(c, r, ' ', NO_COLOR, 0);
            disp.putstr(1, r, morestr, NO_COLOR);
            disp.setCursor(1 + morestr.replace(/ $/, '').length, r);
        };
        render();

        for (;;) {
            const ch = await this._readPromptKey();
            if (ch === 'q' || ch === '\x1b') break; // cancel (no filter change)
            if (ch === '\r' || ch === '\n') break;  // confirm
            if (ch === ' ' || ch === '>') {          // next page
                if (page < npages - 1) page++; else break;
                render();
                continue;
            }
            if (ch === '<') { if (page > 0) page--; render(); continue; }
            // Toggle a selectable entry by its selector letter.
            const it = all.find(x => x.sel === ch);
            if (it) { it.selected = !it.selected; render(); }
        }

        // Apply the new filter: clear and set from the selected entries.
        const sel2 = all.filter(x => x.selected);
        game.rfilter = { roles: [], mask: 0 };
        for (const it of sel2) {
            if (it.kind === 'role') game.rfilter.roles[it.idx] = true;
            else if (it.kind === 'race') game.rfilter.mask |= races[it.idx].selfmask;
            else if (it.kind === 'gender') game.rfilter.mask |= genders[it.idx].allow;
            else if (it.kind === 'align') game.rfilter.mask |= aligns[it.idx].allow;
        }
        return sel2.length > 0;
    }

    // C ref: role.c genl_player_setup() makepicks loop.  Facet order is role ->
    // race -> gender -> alignment, and a facet is only (re)resolved when it is
    // unset or INVALID for the facets before it (rc-pinned "Valkyrie male" lands
    // here).  Within a facet, 'y'/'a' (and an explicit ROLE_RANDOM) pick at
    // random, while any other pick4u -- including the '\0' of a config that
    // pinned everything -- counts the valid choices instead and assigns silently
    // when exactly one is left, drawing NO RNG.  Returns 'menu' when C would
    // open a selection menu (more than one choice, or a missing role), which is
    // the manual-selection path.
    _makepicks(sel, pick4u) {
        const rnd = (facet) => (pick4u === 'y' || pick4u === 'a'
                                || facet === ROLE_RANDOM);
        let k;
        if (sel.role < 0) {
            if (!rnd(sel.role)) return 'menu'; /* role is always menu-picked */
            k = pick_role(sel.race, sel.gender, sel.align, PICK_RANDOM);
            if (k < 0) k = randrole(false);
            sel.role = k;
        }
        if (sel.race < 0 || !validrace(sel.role, sel.race)) {
            if (rnd(sel.race)) {
                k = pick_race(sel.role, sel.gender, sel.align, PICK_RANDOM);
                if (k < 0) k = randrace(sel.role);
            } else {
                const cnt = count_ok_race(sel.role, sel.gender, sel.align);
                if (cnt.n > 1) return 'menu';
                k = cnt.k;
            }
            sel.race = k;
        }
        if (sel.gender < 0 || !validgend(sel.role, sel.race, sel.gender)) {
            if (rnd(sel.gender)) {
                k = pick_gend(sel.role, sel.race, sel.align, PICK_RANDOM);
                if (k < 0) k = randgend(sel.role, sel.race);
            } else {
                const cnt = count_ok_gend(sel.role, sel.race, sel.align);
                if (cnt.n > 1) return 'menu';
                k = cnt.k;
            }
            sel.gender = k;
        }
        if (sel.align < 0 || !validalign(sel.role, sel.race, sel.align)) {
            if (rnd(sel.align)) {
                k = pick_align(sel.role, sel.race, sel.gender, PICK_RANDOM);
                if (k < 0) k = randalign(sel.role, sel.race);
            } else {
                const cnt = count_ok_align(sel.role, sel.race, sel.gender);
                if (cnt.n > 1) return 'menu';
                k = cnt.k;
            }
            sel.align = k;
        }
        return null;
    }

    // C ref: role.c genl_player_setup() — askname (when no name is pinned),
    // rigid_role_checks(), the "Shall I pick ... for you? [ynaq]" question, the
    // makepicks loop and the "Is this ok?" confirmation, in that order.
    async _startupCharacterSelection(optsel) {
        // C ref: src/files.c / role.c — NetHack prompts "Who are you?"
        // for the player name whenever OPTIONS supplied no name:, even
        // when role/race/gender/align are all pre-pinned. Only after the
        // name is entered does it proceed (skipping any selection prompts
        // that the rc already answered).
        if (!game.plname)
            await this._promptForName();

        const sel = { ...optsel };
        // Sampled BEFORE rigid_role_checks(): a facet that only gets filled in
        // because the role forces it still counts as "something was picked", and
        // that is what gates the confirmation menu below.
        const picksomething = (sel.role === ROLE_NONE || sel.race === ROLE_NONE
                               || sel.gender === ROLE_NONE
                               || sel.align === ROLE_NONE);
        let pick4u = '\0';

        // Skip prompting for what a pinned facet already implies: role forces
        // race (samurai) or gender (valkyrie) or alignment (rogue), race forces
        // alignment (orc).  Each still-forced facet costs one rn2(1).
        rigid_role_checks(sel);

        if (sel.role === ROLE_NONE || sel.race === ROLE_NONE
            || sel.gender === ROLE_NONE || sel.align === ROLE_NONE) {
            // C names only the facets that are still open, and passes
            // choices=NULL to yn_function so that it can carry its own
            // "[ynaq]"; the answer is validated here instead, which means any
            // unrecognized key silently re-asks.
            const prompt = build_plselection_prompt(sel.role, sel.race,
                                                    sel.gender, sel.align).trim();
            for (;;) {
                this._renderStartupScreen(game.plname || '', prompt);
                pick4u = (await this._readPromptKey()).toLowerCase();
                if (pick4u === '\x1b' || pick4u === 'q') return; /* [q] */
                if (pick4u === ' ' || pick4u === '\n' || pick4u === '\r')
                    pick4u = 'y'; /* default */
                else if (pick4u === '@' || pick4u === '*')
                    pick4u = 'a'; /* similar to '-@' on the command line */
                if (pick4u === 'y' || pick4u === 'n' || pick4u === 'a') break;
            }
        }

        if (pick4u === 'n' || this._makepicks(sel, pick4u) === 'menu') {
            if (await this._manualCharacterSelection(sel)) {
                game._startup_selected_character = true;
                apply_selection(sel);
            }
            return;
        }

        // C: getconfirmation = (picksomething && pick4u != 'a' && !randomall);
        // 'a' means "pick for me and just start", and nothing was open at all
        // when the rc pinned every facet.
        while (picksomething && pick4u !== 'a') {
            this._renderSelectionOk(sel);
            const answer = await this._readPromptKey();
            const lower = answer.toLowerCase();
            // A PICK_ONE menu with a preselected entry returns it for <space>,
            // <return> and for explicitly re-picking it.
            if (lower === 'y' || answer === ' ' || answer === '\r'
                || answer === '\n')
                break;
            if (lower === 'n') {
                // Start fresh with the menus, discarding any partial selection.
                sel.role = sel.race = sel.gender = sel.align = ROLE_NONE;
                if (await this._manualCharacterSelection(sel)) {
                    game._startup_selected_character = true;
                    apply_selection(sel);
                }
                return;
            }
            if (lower === 'a' && game.iflags?.renameallowed) {
                await this._promptForName();
                continue;
            }
            if (lower === 'q' || answer === '\x1b') return;
        }
        game._startup_selected_character = true;
        apply_selection(sel);
    }

    _installCaptureHook() {
        const nhGame = this;
        game._preNhgetchHook = async () => {
            const keyIdx = nhGame._nhgetchCount++;

            // Capture RNG slice since last capture
            const fullLog = getRngLog() || [];
            const slice = fullLog.slice(nhGame._lastRngIdx);
            nhGame._lastRngIdx = fullLog.length;

            // Capture screen from the terminal grid. The fixture for
            // screen scoring is the Terminal: contestants drive it
            // however they like, judge reads back terminal.serialize()
            // and compares to the C session's recorded screen.
            const disp = game?.nhDisplay;
            const term = disp?.terminal || disp;
            nhGame._screens.push(term ? serializeGrid(term) : '');
            nhGame._rngSlices.push(slice);
            // Step boundary for the display-prng trace (js/disprng.js); inert
            // unless swarm/bin/dispdiff.mjs armed it.
            if (globalThis.__DISPLOG) globalThis.__DISPLOG.push('---STEP---');

            // termcap.c nomux_get_cursor() reports the RAW writer's row/col
            // whenever nomux_raw_active, and that flag is never cleared once a
            // raw_print has happened — so an rc error freezes the recorded
            // cursor for the whole session.
            const cursor = game._nomux_raw
                ? [game._nomux_raw.col, game._nomux_raw.row, 1]
                : (disp ? [disp.cursorCol ?? 0, disp.cursorRow ?? 0, 1] : null);
            nhGame._cursors.push(cursor);

            // Commit animation frames accumulated since the previous
            // input boundary as belonging to this step.  Frames are
            // captured by animationFrame() into _pendingAnimFrames; we
            // snapshot and reset here so the next step starts empty.
            nhGame._animFramesByStep.push(nhGame._pendingAnimFrames);
            nhGame._pendingAnimFrames = [];

            // Differential-oracle state snapshot (gated; no-op when unset).
            // fullLog.length is the logged-RNG-call count at this boundary,
            // which equals the C recorder's rng_call_count for the same
            // step (see _captureStateDump).  Use it so the JS and C dumps
            // align on the SAME rng# even when an earlier divergence has
            // already shifted the step<->rng mapping.
            if (nhGame._nhjsdump) nhGame._captureStateDump(fullLog.length);
        };
    }

    getScreens() { return this._screens; }
    getCursors() { return this._cursors; }
    getRngLog() { return getRngLog(); }
    // Per-step PRNG slices, parallel to getScreens(). Each entry is the
    // log of PRNG calls that fired since the previous capture (i.e.
    // since the previous nhgetch). Useful for tooling like the PS
    // visualizer that wants to attribute calls to individual keystrokes;
    // the judge ignores this and uses getRngLog() flat.
    getRngSlices() { return this._rngSlices; }
    // Per-step animation frames, parallel to getScreens().  Each entry
    // is the array of frames captured (via animationFrame()) between
    // the previous input boundary and this one — i.e. the intermediate
    // display states for that step's animation.  Empty inner arrays
    // for steps that didn't animate.  SUPPLEMENTAL metric — not part
    // of the official ranking; see API.md.
    getAnimationFramesByStep() { return this._animFramesByStep; }
    // Per-step full game-state snapshots, parallel to getScreens().  One
    // entry per input boundary, each mirroring the C recorder's
    // .state.jsonl record (hero + fmon chain + rng#).  Populated ONLY when
    // process.env.NHJSDUMP is set — empty array (zero overhead) otherwise.
    // Consumed by scripts/oracle.mjs to pinpoint the first state divergence
    // from C.  NOT part of scoring.
    getStateDumps() { return this._stateDumps; }
}

// ── Per-segment runner — the contest contract ──
//
// The judge calls this once per segment. Input is a clean replay
// descriptor with up to five fields (NO recorded answers):
//
//   { seed: number,        // PRNG seed
//     datetime: string,    // fixed datetime "YYYYMMDDHHMMSS"
//     nethackrc: string,   // game-options rc text
//     moves: string,       // raw key sequence to replay from launch
//     storage: object }    // Web-Storage-shaped (getItem/setItem/...)
//                          //   handle for cross-segment persistence —
//                          //   shared across all segments of a
//                          //   session. The browser passes a
//                          //   localStorage-backed view so save files
//                          //   survive page reload too.
//
// Each call returns a self-contained game whose getScreens() /
// getRngLog() / getCursors() / getAnimationFramesByStep() cover ONLY
// this segment. The harness concatenates them itself. Cross-segment
// C-side state (bones, record file, save) lives in `input.storage`.
export async function runSegment(input) {
    const { seed, nethackrc, storage, datetime } = input;
    const moves = input.moves || '';

    const nhGame = new NethackGame({ seed, nethackrc, storage, datetime });

    const display = new GameDisplay(null);
    display.onEmptyQueue = () => { throw new Error('Input queue empty - test may be missing keystrokes'); };
    nhGame._pendingDisplay = display;

    for (const ch of moves) display.pushKey(ch.charCodeAt(0));

    // Startup/chargen can run out of recorded keystrokes when the C session
    // used a tty selection feature the port doesn't model (e.g. the '~'
    // role-filter sub-menu). Treat that like the moveloop does: stop driving
    // input and keep whatever screens were captured up to that point, rather
    // than letting the whole segment fail.
    try {
        await nhGame.start();
    } catch (e) {
        if (!String(e?.message || '').includes('Input queue empty'))
            throw e;
    }

    // Drive the game loop until input is exhausted. The judge looks
    // at game.getScreens() afterwards; whatever the contestant
    // captured is what gets compared.
    const maxIter = Math.max(moves.length * 8, 1024);
    for (let iter = 0; iter < maxIter; iter++) {
        try {
            await moveloop_core();
        } catch (e) {
            if (String(e?.message || '').includes('Input queue empty')) break;
            throw e;
        }
    }

    return nhGame;
}
