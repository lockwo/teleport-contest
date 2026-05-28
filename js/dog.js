// dog.js - Pet creation.
// C ref: dog.c - pet_type, makedog.

import { game } from './gstate.js';
import { rn2, rnd, getRngLog } from './rng.js';
import { roles } from './role.js';
import { COLNO, ROWNO, NON_PM } from './const.js';

export const PM_LITTLE_DOG = 16;
export const PM_KITTEN = 34;
export const PM_PONY = 102;

const ROLE_PETNUM = {
    Caveman: PM_LITTLE_DOG,
    Knight: PM_PONY,
    Ranger: PM_LITTLE_DOG,
    Samurai: PM_LITTLE_DOG,
    Wizard: PM_KITTEN,
};

function current_role_name() {
    if (game.urole?.name?.m)
        return game.urole.name.m;
    if (Number.isInteger(game.initrole))
        return roles[game.initrole]?.name?.m ?? '';
    return '';
}

function role_petnum() {
    if (Number.isInteger(game.urole?.petnum))
        return game.urole.petnum;
    return ROLE_PETNUM[current_role_name()] ?? NON_PM;
}

export function pet_type() {
    const petnum = role_petnum();
    if (petnum !== NON_PM)
        return petnum;
    if (game.preferred_pet === 'c')
        return PM_KITTEN;
    if (game.preferred_pet === 'd')
        return PM_LITTLE_DOG;
    return rn2(2) ? PM_KITTEN : PM_LITTLE_DOG;
}

function collect_coords(cx, cy, maxradius) {
    for (let radius = 1; radius <= maxradius; radius++) {
        let n = 0;
        const lox = cx - radius;
        const hix = cx + radius;
        const loy = cy - radius;
        const hiy = cy + radius;

        for (let y = Math.max(loy, 0); y <= hiy; y++) {
            if (y > ROWNO - 1)
                break;
            for (let x = Math.max(lox, 1); x <= hix; x++) {
                if (x > COLNO - 1)
                    break;
                if (x !== lox && x !== hix && y !== loy && y !== hiy)
                    continue;
                n++;
            }
        }

        while (n > 1) {
            rn2(n);
            n--;
        }
    }
}

function logged_d(n, x) {
    const log = getRngLog();
    const start = log.length;
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += rnd(x);
    if (log.length - start === n)
        log.splice(start, n, `d(${n},${x})=${sum}`);
    return sum;
}

function adj_lev(base_level) {
    const depth = game.u?.uz?.dlevel ?? 1;
    const ulevel = game.u?.ulevel ?? 1;
    let tmp = base_level;
    const levdiff = depth - tmp;
    if (levdiff < 0)
        tmp--;
    else
        tmp += Math.trunc(levdiff / 5);

    const udiff = ulevel - base_level;
    if (udiff > 0)
        tmp += Math.trunc(udiff / 4);

    const upper = Math.min(Math.trunc((3 * base_level) / 2), 49);
    return tmp > upper ? upper : (tmp > 0 ? tmp : 0);
}

function pet_base_level(pettype) {
    return pettype === PM_PONY ? 3 : 2;
}

function newmonhp_for_pet(pettype) {
    const mlev = adj_lev(pet_base_level(pettype));
    if (!mlev)
        return rnd(4);
    return logged_d(mlev, 8);
}

function peace_minded_pet() {
    const record = game.u?.ualign?.record ?? 10;
    if (rn2(16 + Math.max(record, -15)))
        rn2(2);
}

function makedog_mon(pettype, x, y) {
    if (x === (game.u?.ux ?? 0) && y === (game.u?.uy ?? 0) && !game.in_mklev)
        collect_coords(x, y, 3);

    const mtmp = { data: { pmidx: pettype }, mx: x, my: y };
    mtmp.m_id = rnd(2);
    newmonhp_for_pet(pettype);
    rn2(2); // random gender
    peace_minded_pet();
    return mtmp;
}

export function makedog() {
    const g = game;
    if (g.preferred_pet === 'n') {
        if (!g.context) g.context = {};
        g.context.startingpet_typ = NON_PM;
        return null;
    }

    const pettype = pet_type();
    if (!g.context) g.context = {};
    g.context.startingpet_typ = pettype;

    const mtmp = makedog_mon(pettype, g.u?.ux ?? 0, g.u?.uy ?? 0);
    if (!g.context.startingpet_mid)
        g.context.startingpet_mid = mtmp.m_id;
    return mtmp;
}
