// mkroom.js - Room helper functions.
// C ref: mkroom.c - somex, somey, somexy, somexyspace, inside_room.

import { game } from './gstate.js';
import { rn1 } from './rng.js';
import {
    ROOM, CORR, ICE, SDOOR, ROOMOFFSET,
    IS_DOOR, IS_FURNITURE, IS_POOL, IS_WALL,
    isok, LAVAPOOL,
} from './const.js';

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

export function occupied(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    return !!(IS_FURNITURE(loc.typ) || loc.typ === LAVAPOOL || IS_POOL(loc.typ));
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
