// lock.js — the lock.c context accessors (gx.xlock) that other C files read.
//
// picking_lock()/picking_at() are what monmove.c's watch_on_duty(), shk.c and
// zap.c use to notice that the hero is picking a lock; reset_pick() /
// maybe_reset_pick() are what cmd.c, do.c, mkobj.c and shk.c call to drop that
// context when the target stops being valid.  js/extcmd-handlers.js owns the
// picklock()/forcelock() occupations and writes game.xlock; this file is the
// read side, so nothing has to reach into that module's state by hand.
import { game } from './gstate.js';

// C ref: lock.c:17 picking_lock(&x, &y) — TRUE while the picklock occupation is
// armed against a DOOR; the coordinates are the square the hero is facing.
// Returns { x, y } or null (C writes through pointers and returns a boolean).
export function picking_lock() {
    const xl = game.xlock;
    const u = game.u;
    if (!xl || !game._picklock_box || !u) return null;
    return { x: (u.ux | 0) + (u.dx | 0), y: (u.uy | 0) + (u.dy | 0) };
}

// C ref: lock.c:30 picking_at(x, y) — is the armed picklock occupation aimed at
// exactly this door square?
export function picking_at(x, y) {
    const xl = game.xlock;
    if (!xl || !game._picklock_box || !xl.door) return false;
    return xl.cx === x && xl.cy === y;
}

// C ref: lock.c:259 reset_pick() — clear the whole xlock context.
export function reset_pick() {
    game.xlock = null;
    game._picklock_box = null;
}

// C ref: lock.c:269 maybe_reset_pick(container) — passed a specific container,
// only clear when it is THAT container (other level objects stay valid); passed
// null (level change), clear unless the box is being carried along.
export function maybe_reset_pick(container) {
    const xl = game.xlock;
    if (!xl) return;
    if (container ? (container === xl.box)
                  : (!xl.box || !carried(xl.box)))
        reset_pick();
}

// C ref: hack.h carried(obj) — obj->where == OBJ_INVENT.
function carried(obj) {
    if (!obj) return false;
    if (obj.where === 'invent' || obj.where === 3) return true;
    const inv = game.invent || game.gi?.invent;
    return Array.isArray(inv) && inv.includes(obj);
}

// ── wand / spell effects on locks (lock.c:1056 / :1103) ──
// Both are RNG-free state changes, but they decide whether a door is passable
// and whether a box can still be opened, which feeds every later pathing and
// container decision.  Neither had an implementation anywhere in js/.
// mkobj.js otyps (verified against OBJECT_DATA).
const WAN_LOCKING = 426, WAN_OPENING = 425, WAN_STRIKING = 417,
      WAN_POLYMORPH = 422;
const SPE_KNOCK = 375, SPE_WIZARD_LOCK = 381, SPE_FORCE_BOLT = 376,
      SPE_POLYMORPH = 399;
const PM_WIZARD = 12;   // u_init.c role mnum

// C ref: rm.h door masks.
const D_NODOOR = 0, D_BROKEN = 1, D_ISOPEN = 2, D_CLOSED = 4, D_LOCKED = 8,
      D_TRAPPED = 16;
// C ref: rm.h typ values.
const SDOOR = 13, DOOR = 15;

function Role_if_WIZARD() { return game.urole?.mnum === PM_WIZARD; }

// C ref: lock.c:1056 boxlock(obj, otmp) — obj IS a box.  Returns TRUE when
// something happened.  Messages are returned rather than printed so the caller
// (zap.js) keeps its own topline ordering.
export function boxlock(obj, otmp) {
    let res = false, msg = null;
    switch (otmp?.otyp) {
    case WAN_LOCKING:
    case SPE_WIZARD_LOCK:
        if (!obj.olocked) {          /* lock it; fix if broken */
            msg = 'Klunk!';
            obj.olocked = 1;
            obj.obroken = 0;
            obj.lknown = Role_if_WIZARD() ? 1 : 0;
            res = true;
        }
        break;
    case WAN_OPENING:
    case SPE_KNOCK:
        if (obj.olocked) {
            msg = 'Klick!';
            obj.olocked = 0;
            res = true;
            obj.lknown = Role_if_WIZARD() ? 1 : 0;
        } else {
            obj.obroken = 0;         /* silently fix if broken */
        }
        break;
    case WAN_POLYMORPH:
    case SPE_POLYMORPH:
        // Avoid resuming an interrupted unlock of a box that just polymorphed.
        if (game.xlock && game.xlock.box === obj) reset_pick();
        break;
    default:
        break;
    }
    return { res, msg };
}

// C ref: lock.c:1103 doorlock(otmp, x, y) — a door or secret door was hit by a
// wand/spell.  Returns { res, msg, loudness, broke } so the caller owns the
// pline()/wake_nearto()/add_damage() tail (those live in other modules).
// The Rogue-level "no real locks" arm and the trapped-door explosion arm are
// modelled as state; mb_trapped()/b_trapped() themselves belong to trap.js.
export function doorlock(otmp, x, y) {
    const door = game.level?.at ? game.level.at(x, y) : null;
    if (!door) return { res: false, msg: null, loudness: 0 };
    let res = true, msg = null, loudness = 0;

    if (door.typ === SDOOR) {
        switch (otmp?.otyp) {
        case WAN_OPENING: case SPE_KNOCK:
        case WAN_STRIKING: case SPE_FORCE_BOLT:
            door.typ = DOOR;
            door.doormask = D_CLOSED | (door.doormask & D_TRAPPED);
            if (otmp.otyp === WAN_OPENING || otmp.otyp === SPE_KNOCK)
                return { res: true, msg: 'A door appears in the wall!', loudness: 0 };
            msg = 'A door appears in the wall!';
            break;  /* striking: fall through to the door handling below */
        default:
            return { res: false, msg: null, loudness: 0 };
        }
    }

    switch (otmp?.otyp) {
    case WAN_LOCKING:
    case SPE_WIZARD_LOCK:
        // obstructed(x, y) and the "don't close a door over a trap" guard need
        // m_at()/t_at(); the caller checks those before calling in this port.
        switch (door.doormask & ~D_TRAPPED) {
        case D_CLOSED: msg = 'The door locks!'; break;
        case D_ISOPEN: msg = 'The door swings shut, and locks!'; break;
        case D_BROKEN: msg = 'The broken door reassembles and locks!'; break;
        case D_NODOOR:
            msg = 'A cloud of dust springs up and assembles itself into a door!';
            break;
        default: res = false; break;
        }
        door.doormask = D_LOCKED | (door.doormask & D_TRAPPED);
        break;
    case WAN_OPENING:
    case SPE_KNOCK:
        if (door.doormask & D_LOCKED) {
            msg = 'The door unlocks!';
            door.doormask = D_CLOSED | (door.doormask & D_TRAPPED);
        } else {
            res = false;
        }
        break;
    case WAN_STRIKING:
    case SPE_FORCE_BOLT:
        if (door.doormask & (D_LOCKED | D_CLOSED)) {
            if (door.doormask & D_TRAPPED) {
                door.doormask = D_NODOOR;
                loudness = 40;
                msg = 'KABOOM!!  You see a door explode.';
            } else {
                door.doormask = D_BROKEN;
                loudness = 20;
                msg = 'The door crashes open!';
            }
        } else {
            res = false;
        }
        break;
    default:
        break;
    }

    // C: `if (res && picking_at(x, y)) { stop_occupation(); reset_pick(); }` —
    // an unseen monster zapping the door you are picking ends the attempt.
    if (res && picking_at(x, y)) reset_pick();
    return { res, msg, loudness };
}
