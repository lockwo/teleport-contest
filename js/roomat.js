// roomat.js - roomno -> struct mkroom lookup (leaf module: imports only
// gstate/const, so any file may import it without a cycle).
//
// C ref: decl.c `struct mkroom svr.rooms[(MAXNROFROOMS + 1) * 2]` with
// `gs.subrooms = &svr.rooms[MAXNROFROOMS + 1]` -- rooms and SUBrooms share one
// array, so C's `svr.rooms[rno - ROOMOFFSET]` resolves a subroom's roomno too
// (Mine Town's temple and shops are subrooms).  This port keeps them in two
// arrays, so every `rooms[rno - ROOMOFFSET]` read has to go through here.
import { game } from './gstate.js';
import { ROOMOFFSET, MAXNROFROOMS } from './const.js';

export function roomAt(rno) {
    const idx = rno - ROOMOFFSET;
    if (idx < 0) return null;
    if (idx > MAXNROFROOMS)
        return (game.level?.subrooms || [])[idx - (MAXNROFROOMS + 1)] || null;
    return game.level?.rooms?.[idx] || null;
}
