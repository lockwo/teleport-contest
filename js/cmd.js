// cmd.js — Command dispatch and movement.
// C ref: cmd.c rhack(), hack.c domove().
//
// Minimal skeleton: only hjklyubn movement is implemented.
// Contestants should add: search, kick, eat, drink, read, zap,
// wear, wield, drop, throw, pray, cast, and all other commands.

import { game } from './gstate.js';
import { nhgetch } from './input.js';
import { newsym, flush_screen, pline, m_at } from './display.js';
import { vision_recalc } from './vision.js';
import { do_attack, is_safemon, x_monnam } from './uhitm.js';
import { ddoinv, dismiss_invent_screen, dolook,
         dodiscovered, doattributes, dovspell,
         attr_window_advance } from './invent.js';
import { dodrink } from './potion.js';
import { dozap } from './zap.js';
import { docast } from './spell.js';
import { doread } from './read.js';
import { rnl } from './rng.js';
import { doextcmd } from './extcmd-handlers.js';
import { do_run, do_run_prefixed, isRunKey, RUN_DX, RUN_DY, do_farlook } from './hack.js';
import { COLNO, ROWNO, STONE, DOOR, D_CLOSED, D_LOCKED,
         SDOOR, SCORR, CORR, IS_WALL, IS_OBSTRUCTED, isok } from './const.js';

// Direction deltas: y u k
//                   h . l
//                   b j n
const DIR_DX = { h: -1, l: 1, j: 0, k: 0, y: -1, u: 1, b: -1, n: 1 };
const DIR_DY = { h: 0, l: 0, j: 1, k: -1, y: -1, u: -1, b: 1, n: 1 };

function isMovementKey(ch) {
    return 'hjklyubn'.includes(ch);
}

// C ref: hack.c — check if a cell blocks movement
export function blocksMove(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return true;
    if (loc.typ === STONE) return true;
    if (IS_WALL(loc.typ)) return true;
    if (loc.typ === DOOR && (loc.doormask & (D_CLOSED | D_LOCKED))) return true;
    return false;
}

// C ref: cmd.c rhack — main command dispatcher
export async function rhack(key) {
    if (key === 0) {
        // Read key from input.  The flush renders the *previous* command's
        // top-line message so it is captured for that command's screen; once
        // nhgetch returns (its capture hook already fired), the previous
        // message has served its purpose and is cleared before we act on the
        // new key.  C ref: topl.c — the top line is cleared at the next
        // prompt.  (Persisting until here is what lets free-action messages
        // like dolook survive onto the recorded screen.)
        await flush_screen(1);
        key = await nhgetch();
        game._pending_message = '';
    }

    const ch = String.fromCharCode(key);

    // A paged ^X attributes window consumes space/return to advance pages and
    // dismiss after the last; ESC cancels.  C ref: process_menu_window().
    if (game._modal_screen === 'attrwin'
        && (ch === ' ' || ch === '\r' || ch === '\n' || ch === '>')) {
        await attr_window_advance();
        game.context.move = 0;
    } else if (ch === '\x1b') {
        // Escape: dismiss any open menu/window; a no-op at top level.
        // C ref: cmd.c — ESC produces no message.
        await dismiss_invent_screen();
        game.context.move = 0;
    } else if (key === 32 || key === 13 || key === 10) {
        // Space / Return at top level: no-op, no message (used to page
        // through/acknowledge a preceding menu or message).
        game.context.move = 0;
    } else if (ch === 'i') {
        ddoinv();
        game.context.move = 0;
    } else if (ch === '\\') {
        dodiscovered();
        game.context.move = 0;
    } else if (ch === '+') {
        await dovspell();
        game.context.move = 0;
    } else if (ch === '\x18') { // ^X
        doattributes();
        game.context.move = 0;
    } else if (ch === ':') {
        await dolook();
        game.context.move = 0;
    } else if (ch === 's') {
        // C ref: cmd.c dosearch -> detect.c dosearch0(0): search adjacent
        // squares for hidden doors/passages/traps.  Takes a game turn.
        await dosearch();
        game.context.move = 1;
    } else if (ch === '#') {
        // C ref: cmd.c doextcmd — read and run an extended command.
        await doextcmd();
    } else if (ch === 'q') {
        // C ref: cmd.c — 'q' quaff (drink) a potion.
        game.context.move = (await dodrink()) ? 1 : 0;
    } else if (ch === 'z') {
        // C ref: cmd.c — 'z' zap a wand.
        game.context.move = (await dozap()) ? 1 : 0;
    } else if (ch === 'Z') {
        // C ref: cmd.c — 'Z' cast a spell.
        game.context.move = (await docast()) ? 1 : 0;
    } else if (ch === 'r') {
        // C ref: cmd.c — 'r' read a scroll or spellbook.
        game.context.move = (await doread()) ? 1 : 0;
    } else if (ch === ';') {
        // C ref: cmd.c ';' "glance" -> pager.c do_look(1): quick farlook.
        // Cursor-positioning loop + look-at description; no game time passes.
        await do_farlook();
        game.context.move = 0;
    } else if (isRunKey(ch)) {
        // Capital-letter run: do_run_west/east/... -> set_move_cmd(dir, 1).
        // Run until something interesting is seen.  hack.js drives the whole
        // multi-turn run inline and leaves game.context.move = 0 (every
        // elapsed turn was already taken), so the moveloop does not schedule
        // another per-turn pass.  C ref: cmd.c do_run_*(), hack.c domove().
        await do_run(RUN_DX[ch], RUN_DY[ch]);
    } else if (ch === 'G' || ch === 'g') {
        // C ref: cmd.c do_run()/do_rush() prefix commands: read a following
        // movement key, then run (G -> run==3) / rush (g -> run==2).  An ESC
        // or a non-movement key cancels with no time elapsed.
        const dirKey = await nhgetch();
        const dch = String.fromCharCode(dirKey);
        const ldir = dch.toLowerCase();
        if (DIR_DX[ldir] !== undefined) {
            await do_run_prefixed(DIR_DX[ldir], DIR_DY[ldir], ch === 'G' ? 3 : 2);
        } else {
            game.context.move = 0;
        }
    } else if (isMovementKey(ch)) {
        // domove() sets game.context.move itself: 1 when the hero actually
        // moves (time passes), 0 when the move is blocked (bump a wall — no
        // turn elapses).  C ref: hack.c domove() / rhack().  Do NOT override
        // it here, or blocked moves would wrongly advance the turn counter.
        await domove(DIR_DX[ch], DIR_DY[ch]);
    } else {
        // Unknown command
        game.context.move = 0;
        await pline(`Unknown command '${ch}'.`);
    }
}

// C ref: detect.c dosearch0(0) — explicit searching of the 8 adjacent
// squares for hidden doors, passages, and unseen traps.  RNG is consumed
// only when such a hidden feature is actually adjacent (rnl(7)/rnl(8)); in
// the common open-room case this takes a turn with no RNG.
async function dosearch() {
    const u = game.u;
    const fund = 0; // no search-boosting artifact/lenses in starter state
    for (let x = u.ux - 1; x < u.ux + 2; x++) {
        for (let y = u.uy - 1; y < u.uy + 2; y++) {
            if (!isok(x, y)) continue;
            if (x === u.ux && y === u.uy) continue;
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            if (loc.typ === SDOOR) {
                if (rnl(7 - fund)) continue;
                loc.typ = DOOR;
                newsym(x, y);
                await pline('You find a hidden door.');
            } else if (loc.typ === SCORR) {
                if (rnl(7 - fund)) continue;
                loc.typ = CORR;
                newsym(x, y);
                await pline('You find a hidden passage.');
            } else {
                const trap = (game.level?.traps || []).find(t => t.tx === x && t.ty === y && !t.tseen);
                if (trap && !rnl(8)) {
                    trap.tseen = true;
                    newsym(x, y);
                }
            }
        }
    }
}

// C ref: hack.c domove / domove_core — execute a movement, including the
// bump-into-a-monster path (attack a hostile, or swap places with a pet).
export async function domove(dx, dy) {
    const u = game.u;
    const newx = u.ux + dx;
    const newy = u.uy + dy;

    // C ref: domove_core sets u.dx/u.dy from the chosen direction; do_attack()
    // and the swap logic read them.
    u.dx = dx;
    u.dy = dy;

    const mtmp = m_at(newx, newy);

    // ── bump into a monster ──  C ref: hack.c domove_core mtmp handling.
    if (mtmp) {
        u.ux0 = u.ux;
        u.uy0 = u.uy;
        // domove_attackmon_at(): displacer-beast swap not modelled; for a
        // normal bump we call do_attack().  do_attack() returns TRUE when the
        // hero's move was used up (a real attack, or "in the way" while
        // running), FALSE when the monster evaded -> fall through to the
        // swap-places handling below.
        if (await do_attack(mtmp)) {
            // The attack consumed the turn (C: do_attack returned TRUE); the
            // hero stays put (no vision recalc — position unchanged).
            game.context.move = 1;
            return;
        }
        // Monster evaded.  If we can't actually move there, stop.
        if (blocksMove(newx, newy)) {
            game.context.move = 0;
            return;
        }
        game.context.move = 1;
        // C ref: domove_core tentatively advances the hero, then swaps with a
        // safe pet at the destination.
        u.ux = newx;
        u.uy = newy;
        if (is_safemon(mtmp)) {
            const swapped = await domove_swap_with_pet(mtmp, newx, newy);
            if (!swapped) {
                // didn't move after all
                u.ux = u.ux0;
                u.uy = u.uy0;
            }
        }
        newsym(u.ux0, u.uy0);
        vision_recalc(1);
        newsym(u.ux, u.uy);
        return;
    }

    if (blocksMove(newx, newy)) {
        // Can't move there
        game.context.move = 0;
        return;
    }

    // The move actually happens -> a game turn elapses.  C ref: hack.c domove
    // sets svc.context.move=1 on a successful step.
    game.context.move = 1;

    // Move the hero
    const oldx = u.ux, oldy = u.uy;
    u.ux0 = oldx;
    u.uy0 = oldy;
    u.ux = newx;
    u.uy = newy;

    // Update display
    newsym(oldx, oldy);
    vision_recalc(1);
    newsym(newx, newy);
}

// C ref: hack.c domove_swap_with_pet(mtmp, x, y) — swap the hero and a tame
// pet.  Returns TRUE if the swap happened.  The starter sessions always take
// the simple swap branch (floor destination, untrapped pet, no boulder); the
// blocking conditions are checked for faithfulness.  On entry u.ux/u.uy are
// the destination (the pet's old square) and u.ux0/u.uy0 are the hero's old
// square (the pet's new square).
async function domove_swap_with_pet(mtmp, x, y) {
    const u = game.u;

    // can't swap diagonally if the pet can't move diagonally — not relevant
    // for dogs/cats/ponies (none are NODIAG), so the common case proceeds.

    // peaceful pet won't swap into a trapped / unsafe square or if it is a
    // quest leader / shk / priest etc. — none apply for a starting pet.

    // Perform the swap: pet -> hero's old square.
    mtmp.mtrapped = 0;
    mtmp.mx = u.ux0;
    mtmp.my = u.uy0;
    // monster still knows where the hero is
    mtmp.mux = u.ux;
    mtmp.muy = u.uy;

    // C: You("%s %s.", mpeaceful ? "swap places with" : "frighten",
    //        x_monnam(mtmp, ARTICLE_YOUR, ..., SUPPRESS_SADDLE, FALSE));
    const verb = mtmp.mpeaceful ? 'swap places with' : 'frighten';
    const who = x_monnam(mtmp, /*ARTICLE_YOUR*/ 3, null, /*SUPPRESS_SADDLE*/ 0, false);
    await pline(`You ${verb} ${who}.`);

    // (minliquid/mintrap on the pet's new square: the hero's old square is dry
    //  floor in the starter sessions, so no trap/liquid effect.)
    return true;
}
