// livelog.js — turn-tagged event chronicle.
// C ref: src/pline.c gamelog_add()/livelog_printf() — CHRONICLE build appends
// every livelog_printf() call to the linked list `gg.gamelog` (turn = svm.moves,
// flags = the LL_* call site, text = the formatted message).  livelog_printf()
// also writes to an external livelog file; that's a side effect with no screen
// impact and isn't modeled here.

import { game } from './gstate.js';

// C ref: include/global.h LL_* bitfield.
export const LL_NONE       = 0x0000;
export const LL_WISH       = 0x0001;
export const LL_ACHIEVE    = 0x0002;
export const LL_UMONST     = 0x0004;
export const LL_DIVINEGIFT = 0x0008;
export const LL_LIFESAVE   = 0x0010;
export const LL_CONDUCT    = 0x0020;
export const LL_ARTIFACT   = 0x0040;
export const LL_GENOCIDE   = 0x0080;
export const LL_KILLEDPET  = 0x0100;
export const LL_ALIGNMENT  = 0x0200;
export const LL_DUMP_ASC   = 0x0400;
export const LL_DUMP_ALL   = 0x0800;
export const LL_MINORAC    = 0x1000;
export const LL_SPOILER    = 0x2000;
export const LL_DUMP       = 0x4000;
export const LL_DEBUG      = 0x8000;

// C ref: pline.c livelog_printf(ll_type, line, ...) -> gamelog_add(ll_type,
// svm.moves, buf).
export function livelog_printf(ll_type, text) {
    if (!game.gamelog) game.gamelog = [];
    game.gamelog.push({ turn: game.moves || 1, flags: ll_type, text });
}
