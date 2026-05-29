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
import { parseNethackrc } from './options.js';
import { flush_screen } from './display.js';
import { GameDisplay } from './game_display.js';
import { PICK_RIGID, ROLE_NONE } from './const.js';
import { ATR_INVERSE, NO_COLOR } from './terminal.js';
import {
    aligns, apply_selection, first_valid_align, genders, ok_align, ok_gend,
    ok_race, pick_align, races, random_player_selection, rigid_role_checks,
    roleName, roles, selectionIsComplete, str2align, str2gend, str2race, str2role,
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

function pickAlignIfRigid(sel) {
    return pick_align(sel.role, sel.race, sel.gender, PICK_RIGID);
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
            screen: term?.serialize ? term.serialize() : '',
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

        // Parse nethackrc
        const opts = parseNethackrc(this._nethackrc);
        g.plname = opts.name || '';
        g.flags = { verbose: true, ...opts.flags };
        g.iflags = { ...opts.iflags };
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

        // C prompts for a name before role/race selection when OPTIONS
        // does not supply one.  That selection can consume RNG before
        // o_init/newgame startup begins.
        await this._startupCharacterSelection(optsel);

        // Run game startup
        await newgame();
    }

    _renderStartupScreen(name = game.plname || '', topLine = '') {
        const disp = game.nhDisplay;
        if (!disp?.clearScreen) return;
        disp.clearScreen();
        if (topLine) disp.putstr(0, 0, topLine, NO_COLOR);
        disp.putstr(0, 4, 'NetHack, Copyright 1985-2026', NO_COLOR);
        disp.putstr(9, 5, 'By Stichting Mathematisch Centrum and M. Stephenson.', NO_COLOR);
        disp.putstr(9, 6, 'Version 5.0.0 MacOS, built May  2 2026 12:00:00.', NO_COLOR);
        disp.putstr(9, 7, 'See license for details.', NO_COLOR);
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

    _renderSelectionOk(sel) {
        const disp = game.nhDisplay;
        if (!disp?.putstr) return;
        this._renderStartupScreen(game.plname || '');
        const col = 41;
        const female = sel.gender === 1;
        const role = roleName(sel.role, female);
        const race = races[sel.race]?.adj || 'human';
        const gender = genders[sel.gender]?.adj || 'male';
        const align = aligns[sel.align]?.adj || 'neutral';
        disp.putstr(col, 0, 'Is this ok? [ynaq]', NO_COLOR, ATR_INVERSE);
        disp.putstr(col, 2, `${game.plname || 'Hero'} the ${align} ${gender} ${race} ${role}`, NO_COLOR);
        disp.putstr(col, 4, 'y * Yes; start game', NO_COLOR);
        disp.putstr(col, 5, 'n - No; choose role again', NO_COLOR);
        disp.putstr(col, 6, 'a - Not yet; choose another name', NO_COLOR);
        disp.putstr(col, 7, 'q - Quit', NO_COLOR);
        disp.putstr(col, 8, '(end)', NO_COLOR);
        disp.setCursor(col + 6, 8);
    }

    _renderRolePrompt(sel, prompt) {
        const disp = game.nhDisplay;
        if (!disp?.putstr) return;
        disp.clearScreen();
        disp.putstr(1, 0, prompt, NO_COLOR, ATR_INVERSE);
        const desc = [
            sel.role >= 0 ? roleName(sel.role, sel.gender === 1) : '<role>',
            sel.race >= 0 ? `<${races[sel.race].noun}>` : '<race>',
            sel.gender >= 0 ? genders[sel.gender].adj : '<gender>',
            sel.align >= 0 ? aligns[sel.align].adj : '<alignment>',
        ].join(' ');
        disp.putstr(1, 2, desc, NO_COLOR);
        disp.setCursor(Math.min(prompt.length + 1, 79), 0);
    }

    async _readPromptKey() {
        return keyChar(await nhgetch());
    }

    async _promptForName() {
        let name = '';
        this._renderStartupScreen(name);
        for (;;) {
            const code = await nhgetch();
            if (code === 13 || code === 10) break;
            if (code === 8 || code === 127) {
                name = name.slice(0, -1);
            } else if (code >= 32 && code < 127) {
                name += String.fromCharCode(code);
            }
            this._renderStartupScreen(name);
        }
        game.plname = name || 'Hero';
    }

    _nextManualPrompt(sel) {
        if (sel.role < 0) return 'role';
        if (sel.race < 0) return 'race';
        if (sel.gender < 0) return 'gender';
        if (sel.align < 0) return 'align';
        return 'ok';
    }

    _renderManualPrompt(sel) {
        const prompt = this._nextManualPrompt(sel);
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

    _completeDeterministicTail(sel) {
        if (sel.role >= 0 && sel.race >= 0 && sel.gender >= 0 && sel.align < 0) {
            const a = first_valid_align(sel.role, sel.race, sel.gender);
            if (a >= 0) sel.align = a;
        }
    }

    async _manualCharacterSelection(sel) {
        this._renderManualPrompt(sel);
        for (;;) {
            const ch = await this._readPromptKey();
            const prompt = this._nextManualPrompt(sel);
            const lower = ch.toLowerCase();

            if (prompt === 'ok') {
                if (lower === 'y' || ch === '\r' || ch === '\n') return true;
                if (lower === 'n') {
                    sel.role = sel.race = sel.gender = sel.align = ROLE_NONE;
                } else if (lower === 'a') {
                    await this._promptForName();
                } else if (lower === 'q') {
                    return false;
                }
                this._renderManualPrompt(sel);
                continue;
            }

            if (prompt === 'role') {
                const role = roleKey(ch);
                if (role !== undefined) {
                    sel.role = role;
                    rigid_role_checks(sel);
                }
            } else if (prompt === 'race') {
                const race = raceKey(ch);
                if (race !== undefined && ok_race(sel.role, race, sel.gender, sel.align)) {
                    sel.race = race;
                    if (sel.align === ROLE_NONE && sel.gender === ROLE_NONE)
                        sel.align = pickAlignIfRigid(sel);
                }
            } else if (prompt === 'gender') {
                const gender = genderKey(ch);
                if (gender !== undefined && ok_gend(sel.role, sel.race, gender, sel.align))
                    sel.gender = gender;
            } else if (prompt === 'align') {
                const align = alignKey(ch);
                if (align !== undefined && ok_align(sel.role, sel.race, sel.gender, align))
                    sel.align = align;
            }

            this._completeDeterministicTail(sel);
            this._renderManualPrompt(sel);
        }
    }

    async _startupCharacterSelection(optsel) {
        // C ref: src/files.c / role.c — NetHack prompts "Who are you?"
        // for the player name whenever OPTIONS supplied no name:, even
        // when role/race/gender/align are all pre-pinned. Only after the
        // name is entered does it proceed (skipping any selection prompts
        // that the rc already answered).
        if (!game.plname)
            await this._promptForName();

        const sel = { ...optsel };
        if (selectionIsComplete(sel)) {
            apply_selection(sel);
            return;
        }

        this._renderStartupScreen(
            game.plname || '',
            "Shall I pick character's race, role, gender and alignment for you? [ynaq]",
        );
        const ch = await this._readPromptKey();
        if (ch.toLowerCase() === 'y' || ch === '\r' || ch === '\n') {
            random_player_selection(sel);
            this._renderSelectionOk(sel);
            for (;;) {
                const answer = await this._readPromptKey();
                const lower = answer.toLowerCase();
                if (lower === 'y' || answer === '\r' || answer === '\n') {
                    game._startup_selected_character = true;
                    apply_selection(sel);
                    return;
                }
                if (lower === 'n') {
                    sel.role = sel.race = sel.gender = sel.align = ROLE_NONE;
                    if (await this._manualCharacterSelection(sel)) {
                        game._startup_selected_character = true;
                        apply_selection(sel);
                        return;
                    }
                    return;
                }
                if (lower === 'a') {
                    await this._promptForName();
                    this._renderSelectionOk(sel);
                }
                if (lower === 'q') return;
            }
        } else if (ch.toLowerCase() === 'n') {
            if (await this._manualCharacterSelection(sel)) {
                game._startup_selected_character = true;
                apply_selection(sel);
            }
        }
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
            nhGame._screens.push(term?.serialize ? term.serialize() : '');
            nhGame._rngSlices.push(slice);

            const cursor = disp ? [disp.cursorCol ?? 0, disp.cursorRow ?? 0, 1] : null;
            nhGame._cursors.push(cursor);

            // Commit animation frames accumulated since the previous
            // input boundary as belonging to this step.  Frames are
            // captured by animationFrame() into _pendingAnimFrames; we
            // snapshot and reset here so the next step starts empty.
            nhGame._animFramesByStep.push(nhGame._pendingAnimFrames);
            nhGame._pendingAnimFrames = [];
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

    await nhGame.start();

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
