// panic.js - end.c panic(): the program-ending error path (leaf module so
// dungeon.js/dog.js and friends can reach it without an import cycle).
//
// C ref: end.c:394 panic().  With the tty window port up it raw_print()s
// "\r\nOops...", tears the windows down and exits, so the recorded session
// shows a cleared screen holding only "Oops..." on row 1 (cursor on row 2) and
// every later keystroke is swallowed by a dead process.  C never returns from
// panic(); this port throws NetHackPanic so the caller unwinds to the top-level
// driver (runSegment / moveloop), which stops running game code.
import { game } from './gstate.js';
import { NO_COLOR } from './terminal.js';
import { rawPrintBias, setFinalCursor } from './rawprint.js';

export class NetHackPanic extends Error {
    constructor(msg) {
        super(`panic: ${msg}`);
        this.name = 'NetHackPanic';
    }
}

// C ref: end.c done()/really_done() ends in nh_terminate(): the process exits
// and no code after the fatal done() call runs.  done() throws this once the
// hero has really died (after the tombstone/topten display, bones, etc.); the
// outermost moveloop_core() absorbs it.  NEVER catch it in game code.
export class NetHackGameOver extends Error {
    constructor() {
        super('game over');
        this.name = 'NetHackGameOver';
    }
}

export function panic(msg) {
    const ps = (game.program_state = game.program_state || {});
    /* avoid loops - this should never happen */
    if (ps.panicking) throw new NetHackPanic(msg);
    ps.panicking = 1;
    game.bot_disabled = true;
    const disp = game.nhDisplay;
    if (disp?.putstr) {
        disp.clearScreen();
        const bias = rawPrintBias();
        disp.putstr(0, 1 + bias, 'Oops...', NO_COLOR, 0);
        setFinalCursor(disp, 2 + bias);
    }
    ps.gameover = true;
    throw new NetHackPanic(msg);
}
