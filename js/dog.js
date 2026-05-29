// dog.js - Pet creation.
// C ref: dog.c - pet_type, makedog.

import { game } from './gstate.js';
import { rn2, rnd, getRngLog } from './rng.js';
import { roles } from './role.js';
import { COLNO, ROWNO, NON_PM, DOOR } from './const.js';

// Per-pet display info (class symbol + color).  C ref: include/monsters.h
// (the starting pets).  Pets are drawn in HI_DOMESTIC = CLR_WHITE.
const PET_DATA = {
    16: { name: 'little dog', mlet: 'd', mcolor: 15 }, // PM_LITTLE_DOG
    34: { name: 'kitten', mlet: 'f', mcolor: 15 },     // PM_KITTEN
    102: { name: 'pony', mlet: 'u', mcolor: 3 },        // PM_PONY (brown)
};

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

// C ref: mon.c m_at — monster at <x,y>.
function m_at(x, y) {
    for (const m of game.level?.monsters || [])
        if (m.mx === x && m.my === y) return m;
    return null;
}

// C ref: teleport.c goodpos — minimal version for starting-pet placement:
// accessible terrain, not the hero, no monster already there.
function goodpos(x, y) {
    if (x < 1 || x >= COLNO || y < 0 || y >= ROWNO) return false;
    if (game.u?.ux === x && game.u?.uy === y) return false;
    if (m_at(x, y)) return false;
    const typ = game.level?.at(x, y)?.typ;
    return typ != null && typ >= DOOR; // ACCESSIBLE(typ)
}

// C ref: teleport.c collect_coords — gather candidate spots in expanding
// rings around <cx,cy>, each ring shuffled (consuming RNG identically to
// the C engine), and return them in collection order.  maxradius 0 means
// the whole map.
function collect_coords(cx, cy, maxradius) {
    const out = [];
    const rowrange = (cy < ROWNO / 2) ? (ROWNO - 1 - cy) : cy;
    const colrange = (cx < COLNO / 2) ? (COLNO - 1 - cx) : cx;
    const k = Math.max(rowrange, colrange);
    maxradius = maxradius ? Math.min(maxradius, k) : k;

    for (let radius = 1; radius <= maxradius; radius++) {
        const ringStart = out.length;
        const lox = cx - radius, hix = cx + radius;
        const loy = cy - radius, hiy = cy + radius;
        for (let y = Math.max(loy, 0); y <= hiy; y++) {
            if (y > ROWNO - 1) break;
            for (let x = Math.max(lox, 1); x <= hix; x++) {
                if (x > COLNO - 1) break;
                if (x !== lox && x !== hix && y !== loy && y !== hiy) continue;
                out.push({ x, y });
            }
        }
        // Shuffle this ring's entries (Fisher-Yates), matching C exactly.
        let n = out.length - ringStart;
        let base = ringStart;
        while (n > 1) {
            const kk = rn2(n);
            if (kk) {
                const tmp = out[base];
                out[base] = out[base + kk];
                out[base + kk] = tmp;
            }
            base++;
            n--;
        }
    }
    return out;
}

// C ref: teleport.c enexto_core — first goodpos spot, nearest rings first
// (1-3 steps), then whole map.  Returns {x,y} or null.
function enexto(xx, yy) {
    const near = collect_coords(xx, yy, 3);
    for (const c of near)
        if (goodpos(c.x, c.y)) return c;
    const all = collect_coords(xx, yy, 0);
    for (let i = near.length; i < all.length; i++)
        if (goodpos(all[i].x, all[i].y)) return all[i];
    return null;
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
    // C ref: makemon.c peace_minded — co-aligned check first. A starting
    // pet (dog/cat/pony) is neutral (mal=0); if the player's alignment
    // sign differs, the function returns early with NO rng.
    const ual = game.u?.ualign?.type ?? 0;
    const mal = 0; // dog/cat/pony are neutral
    if (Math.sign(mal) !== Math.sign(ual))
        return; // hostile, no roll (academic for forced-tame pet)
    // C ref: u_init.c u_init_misc -> newhp() sets u.ualign.record =
    // gu.urole.initrecord BEFORE makedog(); peace_minded() rolls
    // rn2(16 + record).  initrecord (role.c) is 10 for Archeologist/
    // Barbarian/Healer/Knight/Monk/Ranger/Rogue/Samurai, 0 for Caveman/
    // Priest/Tourist/Valkyrie/Wizard.  Indexed by role.js array position.
    const ROLE_INITRECORD = [10, 10, 0, 10, 10, 10, 0, 10, 10, 10, 0, 0, 0];
    const record = ROLE_INITRECORD[game.initrole] ?? (game.u?.ualign?.record ?? 0);
    if (rn2(16 + (record < -15 ? -15 : record)))
        rn2(2);
}

function makedog_mon(pettype, x, y) {
    // C ref: makemon.c — when the requested spot is the hero's (byyou) and
    // we're past mklev, relocate to the nearest good position via enexto.
    let mx = x, my = y;
    if (x === (game.u?.ux ?? 0) && y === (game.u?.uy ?? 0) && !game.in_mklev) {
        const cc = enexto(x, y);
        if (cc) { mx = cc.x; my = cc.y; }
    }

    const petinfo = PET_DATA[pettype] || { name: 'pet', mlet: 'd', mcolor: 15 };
    const mtmp = {
        data: { pmidx: pettype, name: petinfo.name, mlet: petinfo.mlet,
                mcolor: petinfo.mcolor,
                // carnivore/herbivore flags drive dogfood() classification.
                carnivore: pettype !== PM_PONY,
                herbivore: pettype === PM_PONY },
        // C ref: makemon.c / dog.c initedog() — a tamed monster is peaceful
        // (all mtame are mpeaceful).  is_safemon() in the hero's bump-to-swap
        // path keys off mpeaceful, so set it explicitly at creation (before
        // initMonMoveState would otherwise default it to hostile).
        mx, my, mtame: 10, mpeaceful: 1,
        // C ref: dog.c initedog() — edog structure for a freshly-tamed pet.
        // apport = ACURR(A_CHA); the hero's attributes aren't rolled until
        // u_init runs (just after makedog), so leave apport null and resolve it
        // lazily on first use (dogmove.js), once acurr is populated.
        edog: {
            droptime: 0, dropdist: 10000,
            apport: null, // resolved lazily from ACURR(A_CHA)
            whistletime: 0,
            hungrytime: (game.moves || 1) + 1000,
            mhpmax_penalty: 0,
        },
    };
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

    // C ref: dog.c makedog() — default pet names (dogs only): Slasher
    // (Caveman), Hachi (Samurai), Idefix (Barbarian), Sirius (Ranger).
    // christen_monst() stores the name in mtmp->mextra->mgivenname, which
    // x_monnam() then renders standalone (no article).
    if (mtmp && pettype === PM_LITTLE_DOG) {
        const role = current_role_name();
        const DOG_NAMES = { 'Caveman': 'Slasher', 'Samurai': 'Hachi',
                            'Barbarian': 'Idefix', 'Ranger': 'Sirius' };
        const petname = DOG_NAMES[role];
        if (petname)
            mtmp.mgivenname = petname;
    }
    // Place the pet on the level so the renderer can draw it.
    if (mtmp && mtmp.mx > 0 && mtmp.my >= 0 && g.level) {
        if (!g.level.monsters) g.level.monsters = [];
        g.level.monsters.push(mtmp);
    }
    return mtmp;
}
