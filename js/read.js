// read.js — reading scrolls and spellbooks.
// C ref: read.c.  Ports the 'r' command entry (doread), the scroll dispatch
// (seffects) for the magic-mapping case, and spellbook reading (study_book)
// for the "already know it well" branch exercised by the gameplay sessions.

import { game } from './gstate.js';
import { rnd } from './rng.js';
import { pline, topl_more } from './display.js';
import { getobj, makeknown, useup, GETOBJ_SUGGEST, GETOBJ_DOWNPLAY,
         GETOBJ_EXCLUDE, GETOBJ_PROMPT } from './invent.js';
import { exercise } from './attrib.js';
import { do_mapping } from './detect.js';
import { study_book } from './spell.js';
import { SCROLL_CLASS, SPBOOK_CLASS, SCR_BLANK_PAPER, objects } from './mkobj.js';
import { A_WIS } from './const.js';

const ECMD_CANCEL = 0;
const ECMD_OK = 0;
const ECMD_TIME = 1;

const SCR_MAGIC_MAPPING = 337;

// C ref: topl.c — within a single turn, consecutive plines concatenate on the
// top line (separated by two spaces) until it would overflow.  pline() itself
// replaces, so this helper appends to whatever is already pending.
async function pline_append(msg) {
    const cur = game._pending_message || '';
    if (cur && (cur.length + 2 + msg.length) <= 80)
        game._pending_message = `${cur}  ${msg}`;
    else
        await pline(msg);
}

// C ref: objects.h — inherently-magical scrolls (oc_magic bit).  The JS object
// table doesn't carry oc_magic separately, so the magic scroll types that gate
// seffects' "exercise A_WIS for trying" are listed here.  (Non-magic scrolls:
// blank paper, mail.)
const NONMAGIC_SCROLLS = new Set([SCR_BLANK_PAPER]);
function scroll_is_magic(otyp) { return !NONMAGIC_SCROLLS.has(otyp); }

// C ref: read.c read_ok — getobj callback: scrolls and spellbooks suggested;
// anything else is downplayed (selectable but not listed).
function read_ok(obj) {
    if (!obj)
        return GETOBJ_EXCLUDE;
    if (obj.oclass === SCROLL_CLASS || obj.oclass === SPBOOK_CLASS)
        return GETOBJ_SUGGEST;
    return GETOBJ_DOWNPLAY;
}

// C ref: read.c seffects — apply a scroll (or fake-spellbook) effect.  Magic
// scrolls exercise Wisdom "just for trying" (rn2(19) via exercise) before the
// per-type effect.  Returns true if the object was consumed inside seffects.
async function seffects(sobj) {
    const otyp = sobj.otyp;
    if (scroll_is_magic(otyp))
        exercise(A_WIS, true);

    switch (otyp) {
    case SCR_MAGIC_MAPPING:
        game.known = true;
        // C tty concatenates same-turn toplines: "...disappears.  A map ...".
        await pline_append('A map coalesces in your mind!');
        await do_mapping();
        break;
    default:
        // Uncovered scroll effects: no-op (object still consumed by doread).
        break;
    }
    return false;
}

// C ref: read.c doread — the 'r' command.  Pick a scroll or spellbook, then
// read it.  Only the scroll and spellbook branches are ported; exotic readables
// (cookies, shirts, cards, ...) are not exercised.
export async function doread() {
    const scroll = await getobj('read', read_ok, GETOBJ_PROMPT);
    if (!scroll)
        return ECMD_CANCEL;
    const otyp = scroll.otyp;

    if (scroll.oclass !== SCROLL_CLASS && scroll.oclass !== SPBOOK_CLASS) {
        await pline('That is a silly thing to read.');
        return ECMD_OK;
    }

    // literate conduct bookkeeping is score-only (no RNG), omitted.

    if (scroll.oclass === SPBOOK_CLASS) {
        return (await study_book(scroll)) ? ECMD_TIME : ECMD_OK;
    }

    scroll.in_use = true;
    if (otyp !== SCR_BLANK_PAPER) {
        // Not blind / not confused on the covered starts.
        await pline('As you read the scroll, it disappears.');
    }

    if (!(await seffects(scroll))) {
        if (!objects[otyp]?.known) {
            if (game.known) makeknown(otyp);
            // trycall(scroll): naming prompt, not modeled.
        }
        scroll.in_use = false;
        if (otyp !== SCR_BLANK_PAPER)
            useup(scroll);
    }
    return ECMD_TIME;
}
