// hack.js — multi-turn movement: run (capital HJKL / 'G' prefix), rush ('g'
// prefix) and travel ('_' / #travel).  Mirrors the run/travel machinery that
// is spread across hack.c (domove_core, lookaround, end_running,
// findtravelpath) and the moveloop_core() run continuation in allmain.c.
//
// In the C engine a run command sets svc.context.run and gm.multi, performs
// the first domove() in rhack(), and then allmain.c moveloop_core() keeps
// calling lookaround()+domove() while gm.multi stays positive.  The recorded
// tty session only captures a screen at each tty_nhgetch(); during a run no
// nhgetch() happens, so the whole run renders as a *single* recorded screen
// (the state after the run stops).  We therefore execute the entire run inline
// here — first move plus every continuation move, with the once-per-turn
// machinery (moveloop_turn) run between moves — so that the next nhgetch()
// capture sees the final post-run state with the exact cumulative RNG.

import { game } from './gstate.js';
import { domove, blocksMove } from './cmd.js';
import { moveloop_turn } from './allmain.js';
import { m_at, flush_screen } from './display.js';
import { nhgetch } from './input.js';
import { is_safemon, canspotmon } from './uhitm.js';
import { dist2 } from './hacklib.js';
import { NO_COLOR } from './terminal.js';
import { COLNO, ROWNO, STONE, ROOM, CORR, DOOR, ICE, STAIRS, FOUNTAIN,
         D_CLOSED, D_LOCKED, D_ISOPEN, D_BROKEN,
         IS_WALL, IS_DOOR, IS_OBSTRUCTED, IS_FURNITURE, IS_AIR, IS_POOL, IS_LAVA,
         isok } from './const.js';

// Run direction deltas for the capital-letter run commands (and the
// 'G'/'g' prefix followed by a movement key).  C: xdir[]/ydir[].
//   y u    \ | /
//   h l  =  - . -
//   b n    / | \
const RUN_DX = { H: -1, L: 1, J: 0, K: 0, Y: -1, U: 1, B: -1, N: 1 };
const RUN_DY = { H: 0, L: 0, J: 1, K: -1, Y: -1, U: -1, B: 1, N: 1 };

export function isRunKey(ch) {
    return 'HJKLYUBN'.includes(ch);
}

// C ref: monmove.c closed_door() — a door that is shut or locked.
function closed_door(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    return IS_DOOR(loc.typ) && (loc.doormask & (D_CLOSED | D_LOCKED));
}

// C ref: rm.h is_pool_or_lava — water/lava terrain.
function is_pool_or_lava(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    return IS_POOL(loc.typ) || IS_LAVA(loc.typ);
}

// C ref: hack.c avoid_moving_on_trap() — true when <x,y> holds a seen trap
// (other than the vibrating square).  The starter levels have no seen traps
// along the recorded run paths, but the check is preserved for faithfulness.
function avoid_moving_on_trap(x, y) {
    const traps = game.level?.traps || [];
    for (const t of traps) {
        if (t.tx === x && t.ty === y && t.tseen && t.ttyp !== /*VIBRATING_SQUARE*/ undefined)
            return true;
    }
    return false;
}

// C ref: hack.c end_running() — stop a run/travel: clear context.run and
// (for travel) context.travel / context.mv; cancel gm.multi.
function end_running(and_travel) {
    const c = game.context;
    if (c.run) c.run = 0;
    if (and_travel) {
        c.travel = c.travel1 = c.mv = 0;
    }
    if (game.multi > 0) game.multi = 0;
}

// C ref: hack.c nomul() — interrupt a multi-turn action.  We only need the
// gm.multi reset side-effect (no helplessness messages on the run paths).
function nomul(_nval) {
    game.multi = 0;
    game.context.travel = game.context.travel1 = game.context.mv = 0;
}

// C ref: hack.c lookaround() — examine the 8 cells around the hero after a
// run/travel step and decide whether to stop (nomul) or keep going, possibly
// turning to follow a corridor.  Only the run==1 / run==3 / travel(run==8)
// corridor-following and stop behaviour exercised by the owned sessions is
// implemented; hostile-monster and trap stops are preserved structurally.
function lookaround() {
    const u = game.u;
    const c = game.context;
    let x0 = 0, y0 = 0, m0 = 1, i0 = 9;
    let corrct = 0, noturn = 0;
    let i;
    let stop = false;

    if (c.run === 0) return;

    // Mirror C's `goto stop` / `goto bcorr` with labelled loops: STOP breaks
    // the whole scan and ends the run; bcorr is the corridor-accounting block
    // entered by several terrain cases.
    outer:
    for (let x = u.ux - 1; x <= u.ux + 1; x++) {
        for (let y = u.uy - 1; y <= u.uy + 1; y++) {
            const infront = (x === u.ux + u.dx && y === u.uy + u.dy);

            if (!isok(x, y) || (x === u.ux && y === u.uy)) continue;

            const loc = game.level?.at(x, y);
            const typ = loc ? loc.typ : STONE;
            const mtmp = m_at(x, y);

            // can we see a monster there?
            if (mtmp && canspotmon(mtmp)) {
                if ((c.run !== 1 && !is_safemon(mtmp))
                    || (infront && !c.travel)) {
                    stop = true; break outer;
                }
            }

            // stone is never interesting
            if (typ === STONE) continue;
            // ignore the square we're moving away from
            if (x === u.ux - u.dx && y === u.uy - u.dy) continue;

            // bcorr flag: whether this cell should be handled as a corridor
            let bcorr = false;

            // stop for seen traps, sometimes
            if (avoid_moving_on_trap(x, y)) {
                if (c.run === 1) {
                    bcorr = true; // "if you must"
                } else if (infront) {
                    stop = true; break outer;
                }
            }

            if (!bcorr) {
                if (IS_OBSTRUCTED(typ) || typ === ROOM || IS_AIR(typ) || typ === ICE) {
                    continue;
                } else if (closed_door(x, y)) {
                    if (x !== u.ux && y !== u.uy) continue; // ignore if diagonal
                    if (c.run !== 1 && !c.travel) { stop = true; break outer; }
                    bcorr = true; // orthogonal to a closed door -> corridor
                } else if (typ === CORR) {
                    bcorr = true;
                } else if (is_pool_or_lava(x, y)) {
                    continue;
                } else {
                    // e.g. objects or trap or stairs
                    if (c.run === 1) {
                        bcorr = true;
                    } else if (c.run === 8) {
                        continue;
                    } else {
                        if (mtmp) continue;
                        if (((x === u.ux - u.dx) && (y !== u.uy + u.dy))
                            || ((y === u.uy - u.dy) && (x !== u.ux + u.dx)))
                            continue;
                        stop = true; break outer;
                    }
                }
            }

            // ---- bcorr: corridor accounting ----
            const here = game.level?.at(u.ux, u.uy);
            if (here && here.typ !== ROOM) {
                if (c.run === 1 || c.run === 3 || c.run === 8) {
                    i = dist2(x, y, u.ux + u.dx, u.uy + u.dy);
                    if (i > 2) continue; // not on/adjacent to where we're going
                    if (corrct === 1 && dist2(x, y, x0, y0) !== 1) noturn = 1;
                    if (i < i0) {
                        i0 = i;
                        x0 = x;
                        y0 = y;
                        m0 = mtmp ? 1 : 0;
                    }
                }
                corrct++;
            }
        }
    }

    if (stop) { nomul(0); return; }

    if (corrct > 1 && c.run === 2) {
        nomul(0); return;
    }
    if ((c.run === 1 || c.run === 3 || c.run === 8)
        && !noturn && !m0 && i0
        && (corrct === 1 || (corrct === 2 && i0 === 1))) {
        // make sure that we do not turn too far
        if (i0 === 2) {
            if (u.dx === y0 - u.uy && u.dy === u.ux - x0) i = 2;       // turn right
            else i = -2;                                              // turn left
        } else if (u.dx && u.dy) {
            if ((u.dx === u.dy && y0 === u.uy) || (u.dx !== u.dy && y0 !== u.uy)) i = -1;
            else i = 1;
        } else {
            if ((x0 - u.ux === y0 - u.uy && !u.dy) || (x0 - u.ux !== y0 - u.uy && u.dy)) i = 1;
            else i = -1;
        }

        i += (u.last_str_turn || 0);
        if (i <= 2 && i >= -2) {
            u.last_str_turn = i;
            u.dx = x0 - u.ux;
            u.dy = y0 - u.uy;
        }
    }
}

// C ref: hack.c domove_core() run-stop checks that the shared cmd.js domove()
// does not perform: while running, if the destination holds a non-safe
// monster we can see, stop *without* moving (nomul, context.move = 0).
function senseHostileAtDest() {
    const u = game.u;
    const mtmp = m_at(u.ux + u.dx, u.uy + u.dy);
    if (mtmp && !is_safemon(mtmp) && canspotmon(mtmp)) {
        nomul(0);
        game.context.move = 0;
        return true;
    }
    return false;
}

// C ref: hack.c domove_core() tail — after a run move onto a door /
// obstruction / furniture (when run < 8), nomul(0) so the run ends after this
// step (its once-per-turn work still runs, then the loop stops).
function runOntoStopTerrain() {
    const u = game.u;
    const c = game.context;
    if (!c.run || c.run >= 8) return false;
    const loc = game.level?.at(u.ux, u.uy);
    if (!loc) return false;
    if (IS_DOOR(loc.typ) || IS_OBSTRUCTED(loc.typ) || IS_FURNITURE(loc.typ)) {
        nomul(0);
        return true;
    }
    return false;
}

// Run the per-turn machinery for the step that just elapsed.  C: the top of
// allmain.c moveloop_core() runs this when svc.context.move is set.
function takeTurn() {
    moveloop_turn();
}

// Drive an entire run/travel.  `run` is the C svc.context.run value (1 = run
// via capital-letter / shift-dir, 2 = rush 'g', 3 = run 'G', 8 = travel).
// On entry u.dx/u.dy already hold the initial direction.  Returns nothing;
// game.context.move is left at 0 (all elapsed turns were taken inline, so the
// moveloop must NOT schedule another).
async function run_movement(run) {
    const u = game.u;
    const c = game.context;
    c.run = run;
    c.mv = true;
    u.last_str_turn = 0;
    if (!game.multi) game.multi = Math.max(COLNO, ROWNO);

    // First move (C: performed in rhack()).  If we sense a hostile monster at
    // the destination while running, we stop without moving.
    if (senseHostileAtDest()) {
        end_running(true);
        c.move = 0;
        return;
    }
    await domove(u.dx, u.dy);

    // Continuation loop (C: allmain.c moveloop_core while gm.multi > 0).
    for (;;) {
        if (!c.move) break;            // blocked move: no turn, stop running

        // The move happened: run its once-per-turn machinery.
        runOntoStopTerrain();          // may set game.multi = 0 (door etc.)
        takeTurn();

        if (game.multi <= 0) break;    // nomul triggered -> stop after this turn

        lookaround();                  // may stop (multi=0) or turn the path
        if (game.multi <= 0) break;

        // C: `if (gm.multi < COLNO && !--gm.multi) end_running(TRUE);`
        if (game.multi < COLNO) {
            game.multi -= 1;
            if (game.multi === 0) { end_running(true); break; }
        } else {
            game.multi -= 1;
        }

        if (senseHostileAtDest()) break;
        await domove(u.dx, u.dy);
    }

    end_running(true);
    // Every elapsed turn was processed inline above; tell the moveloop no
    // further per-turn work is owed for this command.
    c.move = 0;
    game.multi = 0;
}

// C ref: cmd.c do_run_*()/set_move_cmd(dir, 1) reached via the capital-letter
// run keys (and via the 'G' run prefix).  Run until something interesting.
export async function do_run(dx, dy) {
    const u = game.u;
    u.dx = dx;
    u.dy = dy;
    u.dz = 0;
    await run_movement(1);
}

// C ref: cmd.c do_rush_*()/set_move_cmd(dir, 3) — the 'G' run prefix uses
// run==3; the 'g' rush prefix uses run==2.
export async function do_run_prefixed(dx, dy, runval) {
    const u = game.u;
    u.dx = dx;
    u.dy = dy;
    u.dz = 0;
    await run_movement(runval);
}

export { RUN_DX, RUN_DY };

// ─────────────────────────────────────────────────────────────────────────
// getpos() — the cursor-positioning loop shared by ';' farlook, travel ('_')
// and any command that selects a map location (e.g. #jump).
// C ref: getpos.c getpos(); the first-use farlook tip is hack.c handle_tip()
// -> dat/nhcore.lua show_getpos_tip() -> a tty NHW_TEXT window.
// ─────────────────────────────────────────────────────────────────────────

// dat/nhcore.lua show_getpos_tip() text, verbatim (the leading/trailing blank
// lines from the [[...]] block are stripped by the tty text-window code).
const GETPOS_TIP = [
    'Tip: Farlooking or selecting a map location',
    '',
    'You are now in a "farlook" mode - the movement keys move the cursor,',
    'not your character.  Game time does not advance.  This mode is used',
    'to look around the map, or to select a location on it.',
    '',
    'When in this mode, you can press ESC to return to normal game mode,',
    'and pressing ? will show the key help.',
];

// Render a tty NHW_TEXT window as an overlay (the map/status drawn by the
// previous flush_screen show through outside the window's column band).
// C ref: wintty.c tty_display_nhwindow + process_text_window.  offx follows
// the recorder build's H2344_BROKEN form used by com_pager_legacy():
//   offx = min(min(82, cols/2), cols - maxcol - 1), maxcol = max(len)+1.
// A NHW_TEXT window prints each line at column offx (no leading space, unlike
// NHW_MENU); the "(end)" pager sits on the row after the content at offx and
// the cursor parks at offx + len("(end)") + 1.
function render_getpos_tip() {
    const disp = game.nhDisplay;
    if (!disp?.putstr) return;

    const lines = GETPOS_TIP;
    let maxcol = 0;
    for (const l of lines) if (l.length + 1 > maxcol) maxcol = l.length + 1;

    const cols = 80;
    let offx = Math.min(Math.min(82, Math.floor(cols / 2)), cols - maxcol - 1);
    if (offx < 0) offx = 0;

    const blankCols = (row) => {
        for (let c = offx; c < cols; c++) disp.setCell(c, row, ' ', NO_COLOR, 0);
    };
    for (let c = 0; c < cols; c++) disp.setCell(c, 0, ' ', NO_COLOR, 0); // WIN_MESSAGE

    for (let i = 0; i < lines.length; i++) {
        blankCols(i);
        if (lines[i]) disp.putstr(offx, i, lines[i], NO_COLOR, 0);
    }
    const endRow = lines.length;
    blankCols(endRow);
    disp.putstr(offx, endRow, '(end)', NO_COLOR, 0);
    disp.setCursor(offx + '(end)'.length + 1, endRow);
}

// C ref: hack.c handle_tip(TIP_GETPOS): show the farlook tip the first time
// getpos() is used.  A tty NHW_TEXT window blocks until a window-dismiss key
// (space/return/escape); other keys redraw and wait again.  Each redraw is a
// recorded screen because every readchar fires the capture hook.  Returns
// TRUE if the tip was shown (so the caller forces the goal message).
async function getpos_tip() {
    const c = game.context;
    c.tips = c.tips || 0;
    const TIP_GETPOS = 1 << 4;
    if (c.tips & TIP_GETPOS) return false;
    c.tips |= TIP_GETPOS;

    for (;;) {
        render_getpos_tip();
        const k = await nhgetch();
        if (k === 32 || k === 13 || k === 10 || k === 27) break;
    }
    return true;
}

// getpos movement keys: hjkl + diagonals (lower and upper case both move the
// cursor here; rush/run prefixes handled separately).  C: movecmd().
const GP_DX = { h: -1, l: 1, j: 0, k: 0, y: -1, u: 1, b: -1, n: 1 };
const GP_DY = { h: 0, l: 0, j: 1, k: -1, y: -1, u: -1, b: 1, n: 1 };

// C ref: include/hack.h distu(x,y) = dist2(x,y,u.ux,u.uy).
function distu(x, y) { return dist2(x, y, game.u.ux, game.u.uy); }

// C ref: pager.c do_screen_description() — the (firstmatch) description of the
// terrain shown at <x,y>.  Only the cmap terrain descriptions the owned
// farlook/jump sessions surface are reproduced; unexplored squares read as
// "solid stone" (C: hack.c:1063 / the S_stone "dark area" handling).
function terrain_description(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return 'solid stone';
    const typ = loc.typ;
    // unexplored / never-seen rock reads as solid stone
    if (typ === STONE) {
        return (loc.seenv || loc.disp_ch && loc.disp_ch !== ' ')
            ? 'dark part of a room' : 'solid stone';
    }
    if (IS_WALL(typ)) return 'wall';
    if (typ === DOOR) {
        if (loc.doormask & (D_CLOSED | D_LOCKED)) return 'closed door';
        if (loc.doormask & D_ISOPEN) return 'open door';
        return loc.doormask & D_BROKEN ? 'broken door' : 'doorway';
    }
    if (typ === CORR) return loc.lit ? 'lit corridor' : 'corridor';
    if (typ === ROOM) return loc.lit ? 'floor of a room' : 'dark part of a room';
    if (typ === ICE) return 'ice';
    if (typ === STAIRS) return 'staircase';
    if (typ === FOUNTAIN) return 'fountain';
    return 'floor of a room';
}

// C ref: dothrow.c walk_path() — Bresenham line from src to dest, calling
// check() at each intermediate cell; returns false (blocked) at the first
// cell where check() fails.  Used by the jump validity test.
function walk_path(sx, sy, dx0, dy0, check) {
    let dx = dx0 - sx, dy = dy0 - sy;
    let x = sx, y = sy;
    let xchg = dx < 0 ? -1 : 1; if (dx < 0) dx = -dx;
    let ychg = dy < 0 ? -1 : 1; if (dy < 0) dy = -dy;
    let i = 0, err = 0;
    let keep = true;
    if (dx < dy) {
        while (i++ < dy) {
            y += ychg; err += dx << 1;
            if (err > dy) { x += xchg; err -= dy << 1; }
            if (!(keep = check(x, y))) break;
        }
    } else {
        while (i++ < dx) {
            x += xchg; err += dy << 1;
            if (err > dx) { y += ychg; err -= dx << 1; }
            if (!(keep = check(x, y))) break;
        }
    }
    return keep;
}

// C ref: apply.c check_jump() callback — a non-passable cell (wall / closed
// door / boulder) blocks the jump trajectory.  Open-door trajectory rules are
// omitted (no open doors on the owned jump path).
function check_jump(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    const typ = loc.typ;
    if (IS_OBSTRUCTED(typ)) return false; // includes walls / stone
    if (typ === DOOR && (loc.doormask & (D_CLOSED | D_LOCKED))) return false;
    return true;
}

// C ref: apply.c is_valid_jump_pos(x, y, magic=0, showmsg).  Knight (innate
// Jumping only) may jump exactly distu==5, within range, to a visible cell,
// with a clear Bresenham path.  Emits the failure message when showmsg.
async function is_valid_jump_pos(x, y, showmsg) {
    const u = game.u;
    if (distu(x, y) !== 5) {
        if (showmsg) { game._pending_message = 'Illegal move!'; }
        return false;
    }
    if (distu(x, y) > 9) {
        if (showmsg) { game._pending_message = 'Too far!'; }
        return false;
    }
    if (!isok(x, y)) {
        if (showmsg) { game._pending_message = 'You cannot jump there!'; }
        return false;
    }
    // cansee check omitted (targets on the recorded path are all seen)
    if (!walk_path(u.ux, u.uy, x, y, check_jump)) {
        if (showmsg) { game._pending_message = 'There is an obstacle preventing that jump.'; }
        return false;
    }
    return true;
}

// C ref: apply.c get_valid_jump_position() — used by getpos autodescribe to
// flag "(invalid target)".
function get_valid_jump_position(x, y) {
    const loc = game.level?.at(x, y);
    if (!isok(x, y) || !loc) return false;
    if (!(loc.typ >= DOOR)) return false; // ACCESSIBLE(typ) == typ >= DOOR
    return distu(x, y) === 5 && distu(x, y) <= 9 && walk_path(game.u.ux, game.u.uy, x, y, check_jump);
}

// Render the farlook/getpos frame: base map + status (already on the grid via
// flush_screen) with the message line set and the cursor on the map at the
// targeting location <cx,cy> (display column cx-1, row cy+1).
async function getpos_render(message, cx, cy) {
    game._pending_message = message || '';
    await flush_screen(1);
    const disp = game.nhDisplay;
    if (disp?.setCursor) disp.setCursor(cx - 1, cy + 1);
}

// C ref: getpos.c getpos(ccp, force, goal) — cursor-positioning loop.
// `validfn(x,y)` flags invalid targets for the "(invalid target)" suffix.
// Returns the picked {x,y} or null on ESC.  Lowercase hjkl/diagonals move
// the cursor one step (auto-describing the new cell); '.'/','/';'/':' select;
// a leading 'G'/'g' rush/run prefix multiplies the step (×8) — used by the
// fast-move targeting that some recorded sessions exercise.
async function getpos(goalText, startx, starty, validfn) {
    let cx = startx, cy = starty;

    const tipShown = await getpos_tip();
    let showGoal = tipShown;
    let mult = 1;

    for (;;) {
        if (showGoal) {
            await getpos_render(`Move cursor to ${goalText}:`, cx, cy);
            showGoal = false;
        }
        const k = await nhgetch();
        const ch = String.fromCharCode(k);

        if (k === 27) { // ESC
            return null;
        }
        if (ch === 'G' || ch === 'g') { mult = 8; continue; } // rush/run prefix
        const ldir = ch.toLowerCase();
        if (GP_DX[ldir] !== undefined) {
            // capital letters rush (×8); a 'G'/'g' prefix did the same
            const step = ('HJKLYUBN'.includes(ch) ? 8 : mult);
            mult = 1;
            let nx = cx + GP_DX[ldir] * step, ny = cy + GP_DY[ldir] * step;
            // truncate_to_map: clamp into the playable map bounds
            if (nx < 1) nx = 1; if (nx > COLNO - 1) nx = COLNO - 1;
            if (ny < 0) ny = 0; if (ny > ROWNO - 1) ny = ROWNO - 1;
            cx = nx; cy = ny;
            // auto_describe
            let desc = terrain_description(cx, cy);
            if (validfn && !validfn(cx, cy)) desc += ' (invalid target)';
            await getpos_render(desc, cx, cy);
            continue;
        }
        if (ch === '.' || ch === ',' || ch === ';' || ch === ':') {
            return { x: cx, y: cy };
        }
        // any other key: ignore, keep targeting
    }
}

// C ref: pager.c do_look(mode=1) reached by the ';' "glance" command.  A quick
// farlook: prompt, getpos() to choose a cell, then describe what is there on
// the top line.  Read-only — no game time passes (context.move stays 0).
export async function do_farlook() {
    const u = game.u;
    // C: flags.verbose is off in our rc-less default, and quick suppresses the
    // verbose form, so the prompt is "Pick <what>." (custompline NHKF path).
    const WHAT = 'a monster, object or location';
    game._pending_message = `Pick ${WHAT}.`;
    await flush_screen(1);

    const cc = await getpos(WHAT, u.ux, u.uy, null);
    if (!cc) { game.context.move = 0; return; }

    // do_screen_description: describe the chosen cell.  Monster/object naming
    // is not modelled here; the terrain description covers the recorded cases.
    const mtmp = m_at(cc.x, cc.y);
    let desc;
    if (mtmp && canspotmon(mtmp)) {
        desc = mtmp.data?.mname || mtmp.data?.pmname || 'a monster';
    } else {
        desc = terrain_description(cc.x, cc.y);
    }
    game._pending_message = desc;
    await flush_screen(1);
    const disp = game.nhDisplay;
    if (disp?.setCursor) disp.setCursor(cc.x - 1, cc.y + 1);
    game.context.move = 0;
}

export { getpos_tip, getpos, is_valid_jump_pos, get_valid_jump_position, distu };
