// mkroom.js - Room helper functions.
// C ref: mkroom.c - somex, somey, somexy, somexyspace, inside_room.

import { game } from './gstate.js';
import { rn1, rnd } from './rng.js';
import {
    ROOM, CORR, ICE, SDOOR, ROOMOFFSET,
    IS_DOOR, IS_FURNITURE, IS_POOL, IS_WALL,
    isok, LAVAPOOL, LAVAWALL, POOL, MOAT, WATER,
} from './const.js';

// C ref: trap.c:6502 t_at — return the trap at (x,y), or null.
export function t_at(x, y) {
    for (const trap of game.level?.traps ?? [])
        if (trap.tx === x && trap.ty === y) return trap;
    return null;
}

// C ref: dbridge.c:46 is_pool — POOL/MOAT/WATER (and moats).
// Drawbridge-under-water is not modeled in this port; covered by IS_POOL.
function is_pool(x, y) {
    if (!isok(x, y)) return false;
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    const ltyp = loc.typ;
    return ltyp === POOL || ltyp === MOAT || ltyp === WATER || IS_POOL(ltyp);
}

// C ref: dbridge.c:62 is_lava — LAVAPOOL/LAVAWALL.
// Drawbridge-under-lava is not modeled in this port.
function is_lava(x, y) {
    if (!isok(x, y)) return false;
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    const ltyp = loc.typ;
    return ltyp === LAVAPOOL || ltyp === LAVAWALL;
}

export function nexttodoor(sx, sy) {
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (!isok(sx + dx, sy + dy)) continue;
            const loc = game.level?.at(sx + dx, sy + dy);
            if (loc && (IS_DOOR(loc.typ) || loc.typ === SDOOR))
                return true;
        }
    }
    return false;
}

export function has_dnstairs(sroom) {
    for (let st = game.stairs; st; st = st.next)
        if (!st.up && inside_room(sroom, st.sx, st.sy)) return true;
    return false;
}

export function has_upstairs(sroom) {
    for (let st = game.stairs; st; st = st.next)
        if (st.up && inside_room(sroom, st.sx, st.sy)) return true;
    return false;
}

export function somex(croom) {
    return rn1(croom.hx - croom.lx + 1, croom.lx);
}

export function somey(croom) {
    return rn1(croom.hy - croom.ly + 1, croom.ly);
}

export function inside_room(croom, x, y) {
    if (!croom) return false;
    if (croom.irregular) {
        const idx = game.level?.rooms?.indexOf(croom) ?? -1;
        const roomno = idx + ROOMOFFSET;
        const loc = game.level?.at(x, y);
        return !!(loc && !loc.edge && loc.roomno === roomno);
    }

    return x >= croom.lx - 1 && x <= croom.hx + 1
        && y >= croom.ly - 1 && y <= croom.hy + 1;
}

export function somexy(croom, c) {
    let try_cnt = 0;
    let i;

    if (croom.irregular) {
        // C: `i = (int) ((croom - svr.rooms) + ROOMOFFSET)` — a SUBROOM lives in
        // svr.rooms[MAXNROFROOMS+1..], so indexOf() over level.rooms answers -1
        // for it and every irregular-subroom placement compared the wrong roomno.
        i = (croom.roomnoidx ?? -1) + ROOMOFFSET;
        while (try_cnt++ < 100) {
            c.x = somex(croom);
            c.y = somey(croom);
            const loc = game.level?.at(c.x, c.y);
            if (loc && !loc.edge && loc.roomno === i)
                return true;
        }
        for (c.x = croom.lx; c.x <= croom.hx; c.x++)
            for (c.y = croom.ly; c.y <= croom.hy; c.y++) {
                const loc = game.level?.at(c.x, c.y);
                if (loc && !loc.edge && loc.roomno === i)
                    return true;
            }
        return false;
    }

    if (!(croom.nsubrooms ?? 0)) {
        c.x = somex(croom);
        c.y = somey(croom);
        return true;
    }

    while (try_cnt++ < 100) {
        c.x = somex(croom);
        c.y = somey(croom);
        const loc = game.level?.at(c.x, c.y);
        if (loc && IS_WALL(loc.typ)) continue;

        let in_subroom = false;
        for (i = 0; i < croom.nsubrooms; i++) {
            if (inside_room(croom.sbrooms?.[i], c.x, c.y)) {
                in_subroom = true;
                break;
            }
        }
        if (in_subroom) continue;
        return true;
    }
    return false;
}

// C ref: mklev.c:1806 occupied
//   return (t_at(x,y) || IS_FURNITURE(levl[x][y].typ) || is_lava(x,y)
//           || is_pool(x,y) || invocation_pos(x,y));
// invocation_pos is always false outside the invocation level (never at
// game start) and is not modeled here.
export function occupied(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    return !!(t_at(x, y) || IS_FURNITURE(loc.typ) || is_lava(x, y) || is_pool(x, y));
}

export function somexyspace(croom, c) {
    let trycnt = 0;
    let okay;
    do {
        okay = somexy(croom, c) && isok(c.x, c.y) && !occupied(c.x, c.y);
        if (okay) {
            const loc = game.level?.at(c.x, c.y);
            okay = loc && (loc.typ === ROOM || loc.typ === CORR || loc.typ === ICE);
        }
    } while (trycnt++ < 100 && !okay);
    return okay;
}

// ═══════════════════════════════════════════════════════════════════════════
// The rest of mkroom.c: mkundead() plus the room save/restore walkers.
// ADDITIVE ONLY — nothing above this line calls any of it.
//
// This file is imported by js/mklev.js, js/sp_lev.js, js/makemon.js,
// js/hack.js, js/dig.js, js/fountain.js, js/vault.js and js/mhitu.js, so it
// must not grow a static import of any of those (or of anything that reaches
// them): an sp_lev -> mklev style edge flips ESM evaluation order and the whole
// program fails to load.  rn2/rnd come from the rng.js leaf; every other callee
// arrives through a trailing `deps` argument.
// ═══════════════════════════════════════════════════════════════════════════

// C ref: mkroom.c:455 mkundead(mm, revive_corpses, mm_flags) — "make a swarm of
// undead around mm".  Used by the drawbridge/graveyard scripts, the Book of the
// Dead, and scroll/spell-of-summon paths (js/spell.js:1354 and js/apply.js:1691
// both note it as unported).
//
// RNG order, which is the whole point of a faithful port here:
//   rnd(5)                                   the swarm size
//   then, per member:  morguemon()           rn2(100) + rn2(level_difficulty())
//                                            (+ mkclass()/ndemon() draws)
//                      enexto()              the placement walk
//                      revive() / makemon()  only if enexto() succeeded
// C's `&&` chain is what makes revive()/makemon() conditional, and morguemon()
// is called BEFORE enexto() every iteration even when placement then fails.
//
// deps: level_difficulty, morguemon, enexto, sobj_at, revive, makemon.
// morguemon() has a faithful port at js/sp_lev.js:1410 but it is module-private
// there; the fix is to export that one, not to write a second.
export async function mkundead(mm, revive_corpses, mm_flags, deps = {}) {
    const level_difficulty = deps.level_difficulty || (() => 0);
    let cnt = Math.trunc((level_difficulty() + 1) / 10) + rnd(5);

    // C: `while (cnt--)` — post-decrement, so the body runs `cnt` times.
    while (cnt-- > 0) {
        const mdat = deps.morguemon?.();
        let cc = null;
        if (mdat) cc = deps.enexto?.(mm.x, mm.y, mdat);
        if (mdat && cc) {
            let otmp;
            if (!revive_corpses
                || !(otmp = deps.sobj_at?.(deps.CORPSE ?? 265, cc.x, cc.y))
                || !(await deps.revive?.(otmp, false)))
                deps.makemon?.(mdat, cc.x, cc.y, mm_flags);
        }
    }
    // C: svl.level.flags.graveyard = TRUE — "reduced chance for undead corpse"
    if (game.level) {
        game.level.flags = game.level.flags || {};
        game.level.flags.graveyard = true;
    }
}

// ── room marshalling (C ref: mkroom.c:843-905) ────────────────────────────
//
// C hands the whole `struct mkroom` to Sfo_mkroom()/Sfi_mkroom() and lets the
// sfstruct layer do the field work; the only real content here is the recursive
// subroom walk, the shared gn.nsubroom cursor, the resident pointer being
// dropped, and the two `hx = -1` end-of-array flags.
//
// This port's save format is its own (js/storage.js is frozen; js/save.js:1062
// currently writes `rooms: { unported: 'save_rooms' }`), so the NHFILE argument
// is an object supplying that one primitive pair:
//     nhfp.mkroom(r, "room-mkroom")   /* Sfo_mkroom / Sfi_mkroom */
//     nhfp.int(ref, "room-nroom")     /* Sfo_int    / Sfi_int; ref.value */
// Sfi_mkroom fills `r` in place, which is why rest_room() takes the destination
// room rather than returning one.

// C ref: mkroom.c:843 save_room(nhfp, r) — "a recursive function that saves a
// room and its subrooms (if any)".
export function save_room(nhfp, r) {
    /*
     * Well, I really should write only useful information instead of writing
     * the whole structure.  That is I should not write the gs.subrooms
     * pointers, but who cares ?
     */
    nhfp.mkroom(r, 'room-mkroom');
    for (let i = 0; i < (r.nsubrooms | 0); i++) {
        save_room(nhfp, r.sbrooms[i]);
    }
}

// C ref: mkroom.c:862 save_rooms(nhfp) — "save all the rooms on disk!"
export function save_rooms(nhfp) {
    const rooms = game.level?.rooms || [];
    const nroom = { value: rooms.length };

    /* First, write the number of rooms */
    nhfp.int(nroom, 'room-nroom');
    for (let i = 0; i < nroom.value; i++)
        save_room(nhfp, rooms[i]);
}

// C ref: mkroom.c:874 rest_room(nhfp, r).  `subrooms` is C's gs.subrooms[]
// scratch array and `cursor` its gn.nsubroom write index (a single shared
// counter across the whole recursion, incremented AFTER the recursive call —
// that ordering is what makes a subroom's own subrooms land above it).
export function rest_room(nhfp, r, subrooms, cursor) {
    nhfp.mkroom(r, 'room-mkroom');

    for (let i = 0; i < (r.nsubrooms | 0); i++) {
        subrooms[cursor.value] = subrooms[cursor.value] || {};
        r.sbrooms[i] = subrooms[cursor.value];
        rest_room(nhfp, subrooms[cursor.value], subrooms, cursor);
        subrooms[cursor.value++].resident = null;
    }
}

// C ref: mkroom.c:892 rest_rooms(nhfp) — "that's for restoring rooms.  Read the
// rooms structure from the disk."  The two trailing `hx = -1` writes are the
// sentinels every svr.rooms[]/gs.subrooms[] scan in the game stops on; dropping
// them makes those scans run off the end of the live rooms.
export function rest_rooms(nhfp, subrooms = []) {
    const nroom = { value: 0 };

    nhfp.int(nroom, 'room-nroom');

    const rooms = game.level?.rooms || [];
    const cursor = { value: 0 };            /* gn.nsubroom = 0 */
    for (let i = 0; i < nroom.value; i++) {
        rooms[i] = rooms[i] || {};
        rest_room(nhfp, rooms[i], subrooms, cursor);
        rooms[i].resident = null;
    }
    rooms[nroom.value] = rooms[nroom.value] || {};
    rooms[nroom.value].hx = -1;             /* restore ending flags */
    subrooms[cursor.value] = subrooms[cursor.value] || {};
    subrooms[cursor.value].hx = -1;
    return { nroom: nroom.value, nsubroom: cursor.value };
}
