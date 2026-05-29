// cmd.js — Command dispatch and movement.
// C ref: cmd.c rhack(), hack.c domove().
//
// Minimal skeleton: only hjklyubn movement is implemented.
// Contestants should add: search, kick, eat, drink, read, zap,
// wear, wield, drop, throw, pray, cast, and all other commands.

import { game } from './gstate.js';
import { nhgetch } from './input.js';
import { newsym, flush_screen, pline } from './display.js';
import { vision_recalc } from './vision.js';
import { ddoinv, dismiss_invent_screen, dolook } from './invent.js';
import { rnl } from './rng.js';
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
function blocksMove(x, y) {
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

    if (ch === '\x1b') {
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
    } else if (ch === ':') {
        await dolook();
        game.context.move = 0;
    } else if (ch === 's') {
        // C ref: cmd.c dosearch -> detect.c dosearch0(0): search adjacent
        // squares for hidden doors/passages/traps.  Takes a game turn.
        await dosearch();
        game.context.move = 1;
    } else if (ch === '+') {
        // C ref: cmd.c docast -> spell.c getspell.  With no known spells
        // (a starting Tourist) this just reports and takes no game time.
        await docast();
        game.context.move = 0;
    } else if (isMovementKey(ch)) {
        await domove(DIR_DX[ch], DIR_DY[ch]);
        game.context.move = 1;
    } else {
        // Unknown command
        game.context.move = 0;
        await pline(`Unknown command '${ch}'.`);
    }
}

// C ref: spell.c docast/getspell — list/select a spell to cast.  num_spells
// is the count of known spells in spl_book; with none known we just report.
function num_spells() {
    const book = game.spl_book || game.u?.spl_book || [];
    return book.filter(s => s && s.sp_id != null && s.sp_id >= 0).length;
}

async function docast() {
    if (num_spells() === 0) {
        await pline("You don't know any spells right now.");
        return;
    }
    // (Spell selection menu / casting not needed for the starter sessions.)
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

// C ref: hack.c domove — execute a movement
async function domove(dx, dy) {
    const u = game.u;
    const newx = u.ux + dx;
    const newy = u.uy + dy;

    if (blocksMove(newx, newy)) {
        // Can't move there
        game.context.move = 0;
        return;
    }

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
