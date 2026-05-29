// mkroom.js - Room helper functions.
// C ref: mkroom.c - somex, somey, somexy, somexyspace, inside_room.

import { game } from './gstate.js';
import { rn1 } from './rng.js';
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
        i = (game.level?.rooms?.indexOf(croom) ?? -1) + ROOMOFFSET;
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
