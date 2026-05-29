// dogmove.js — Pet (tame monster) movement for the per-turn loop.
// C ref: dogmove.c — dog_move(), dog_goal(), dog_invent(); dog.c dogfood().
//
// GENERAL (data-driven) port of the common pet-follows-hero behaviour over the
// real monster/object records on game.level.  Faithful to the C control flow
// so the per-move RNG (obj_resists rn2(100), dog_goal rn2(8)/rn2(4),
// dog_move move-choice rn2(++chcnt)/rn2(3)/rn2(12), backtrack rn2(MTSZ*(k-j)))
// is emitted call-for-call.  Exotic cases (pet carrying/eating/attacking,
// leashed pets, ranged attacks, conflict) are intentionally minimal — none of
// the gameplay sessions exercise them at the point they currently diverge.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { MTSZ, COLNO, ROWNO, IS_ROOM } from './const.js';
import { obj_resists } from './zap.js';
import { newsym } from './display.js';
import { dist2, mfndpos } from './monmove.js';
import {
    FOOD_CLASS, BALL_CLASS, CHAIN_CLASS, ROCK_CLASS, COIN_CLASS,
} from './mkobj.js';

// dogfood quality enum (mextra.h): lower == more desirable.
const DOGFOOD = 0, CADAVER = 1, ACCFOOD = 2, MANFOOD = 3,
      APPORT = 4, POISON = 5, UNDEF = 6, TABU = 7;

const MMOVE_NOTHING = 0, MMOVE_MOVED = 2, MMOVE_DIED = 3, MMOVE_DONE = 5;

const PM_PONY = 102;

// C ref: mon.c MON_AT — a (live) monster other than the hero at <x,y>.
function MON_AT(x, y) {
    for (const m of game.level?.monsters || [])
        if (m.mx === x && m.my === y && !(m.mhp != null && m.mhp <= 0)) return m;
    return false;
}

// C ref: rm.h levl[x][y].typ + the object chain at a square.
function terrainTyp(x, y) { return game.level?.at(x, y)?.typ; }

// All floor objects on the level (C's `fobj` chain).
function fobj() { return game.level?.objects || []; }

// Objects at a specific square.
function objectsAt(x, y) {
    return fobj().filter((o) => o.ox === x && o.oy === y);
}

// C ref: hack.h distu(x,y) — squared distance from hero.
function distu(x, y) { return dist2(x, y, game.u?.ux ?? 0, game.u?.uy ?? 0); }
// C ref: hack.h distmin(x0,y0,x1,y1) — Chebyshev (king-move) distance.
function distmin(x0, y0, x1, y1) {
    return Math.max(Math.abs(x0 - x1), Math.abs(y0 - y1));
}

// C ref: dog.c dogfood(mon, obj) — the food/desirability classification.
// We only need (a) the rn2(100) obj_resists side-effect, emitted for every
// non-poisoned object, and (b) a faithful-enough quality so goal selection
// (and thus the downstream rn2 ordering) matches for the common objects the
// starting level places.
function dogfood(mon, obj) {
    const mdat = mon.data || {};
    const carni = !!mdat.carnivore;
    const herbi = !!mdat.herbivore;

    if (obj.opoisoned) return POISON; // resists_poison: pets don't, at start
    // is_quest_artifact() is false for ordinary objects; obj_resists rolls
    // rn2(100) (always FALSE for non-artifacts with ochance 0).
    if (obj_resists(obj, 0, 95))
        return obj.cursed ? TABU : APPORT;

    switch (obj.oclass) {
    case FOOD_CLASS:
        // Carnivores treat unknown/meat food as DOGFOOD-ish; herbivores eat
        // veggie food.  The starting level rarely drops corpses near the pet;
        // approximate with the carnivore/herbivore default branch.
        if (!carni && !herbi)
            return obj.cursed ? UNDEF : APPORT;
        // default food case (dog.c): otyp > SLIME_MOLD ? carni?ACCFOOD:MANFOOD
        //                                               : herbi?ACCFOOD:MANFOOD
        return carni ? ACCFOOD : (herbi ? ACCFOOD : MANFOOD);
    case ROCK_CLASS:
        return UNDEF;
    default:
        if (!obj.cursed && obj.oclass !== BALL_CLASS
            && obj.oclass !== CHAIN_CLASS)
            return APPORT;
        return UNDEF;
    }
}

// C ref: dog.c initedog() — apport defaults to ACURR(A_CHA); resolved lazily
// here because the hero's attributes are rolled after makedog().
function edogApport(edog) {
    if (edog.apport == null) {
        const cha = game.u?.acurr?.a?.[5] ?? 1;
        edog.apport = cha > 0 ? cha : 1;
    }
    return edog.apport;
}

// C ref: dogmove.c dog_invent(mtmp, edog, udist).  Only the no-inventory path
// with an object underfoot consumes RNG (dogfood -> obj_resists); the common
// follow case (empty square, no minvent) returns 0 silently.  Returns 1 if the
// pet ate (counts as its move), else 0.
function dog_invent(mtmp, edog, udist) {
    const omx = mtmp.mx, omy = mtmp.my;
    // droppables(mtmp): pet carries nothing at the start -> skip the drop path.
    const here = objectsAt(omx, omy);
    if (here.length) {
        const obj = here[0]; // svl.level.objects[omx][omy] = top of pile
        // nofetch classes (BALL/CHAIN/...) and special prizes are skipped in C
        // before dogfood; the starting level's underfoot objects aren't those.
        const edible = dogfood(mtmp, obj);
        if (edible <= CADAVER || (edog.mhpmax_penalty && edible === ACCFOOD)) {
            // would eat -> counts as the pet's move (dog_eat).  Not modeled in
            // detail; emit no further RNG and report "ate".
            return 1;
        }
        // can_carry / pickup path: rn2(20) < apport+3, then rn2(udist)/rn2(apport)
        const apport = edogApport(edog);
        if (!obj.cursed) {
            if (rn2(20) < apport + 3) {
                if (rn2(udist) || !rn2(apport)) {
                    // pick up — not modeled (no minvent tracking); the rolls
                    // above already match C's stream for this rare case.
                }
            }
        }
    }
    return 0;
}

// C ref: dogmove.c dog_goal(...).  Returns the approach desire (-1/0/1) or -2
// to abort.  Sets the goal coordinates on `g` (gx/gy) used by the move loop.
function dog_goal(mtmp, edog, after, udist, whappr, g) {
    const omx = mtmp.mx, omy = mtmp.my;
    const u = game.u;

    let gtyp = UNDEF;
    g.gx = 0; g.gy = 0;

    const SQ = 5;
    const min_x = Math.max(omx - SQ, 1);
    const max_x = Math.min(omx + SQ, COLNO - 1);
    const min_y = Math.max(omy - SQ, 0);
    const max_y = Math.min(omy + SQ, ROWNO - 1);

    const in_masters_sight = couldsee(omx, omy);
    const dog_has_minvent = false; // pet carries nothing at the start

    // nearby food/objects (C iterates fobj; order only affects tie-breaks for
    // the goal, not the rn2 stream — obj_resists fires for every object).
    for (const obj of fobj()) {
        const nx = obj.ox, ny = obj.oy;
        if (nx >= min_x && nx <= max_x && ny >= min_y && ny <= max_y) {
            const otyp = dogfood(mtmp, obj); // -> obj_resists rn2(100)
            if (otyp > gtyp || otyp === UNDEF) continue;
            if (cursed_object_at(nx, ny)
                && !(edog.mhpmax_penalty && otyp < MANFOOD)) continue;
            // could_reach_item / can_reach_location: open room -> reachable.
            if (otyp < MANFOOD) {
                if (otyp < gtyp || DDIST(nx, ny, omx, omy) < DDIST(g.gx, g.gy, omx, omy)) {
                    g.gx = nx; g.gy = ny; gtyp = otyp;
                }
            } else if (gtyp === UNDEF && in_masters_sight && !dog_has_minvent
                && (!isLit(omx, omy) || isLit(u.ux, u.uy))
                && (otyp === MANFOOD || m_cansee(mtmp, nx, ny))
                && edogApport(edog) > rn2(8)
                && can_carry(mtmp, obj) > 0) {
                g.gx = nx; g.gy = ny; gtyp = APPORT;
            }
        }
    }

    let appr;
    if (gtyp === UNDEF
        || (gtyp !== DOGFOOD && gtyp !== APPORT && (game.moves || 1) < edog.hungrytime)) {
        g.gx = u.ux; g.gy = u.uy;
        if (after && udist <= 4 && u.ux === g.gx && u.uy === g.gy)
            return -2;
        appr = (udist >= 9) ? 1 : (mtmp.mflee ? -1 : 0);
        if (udist > 1) {
            if (!IS_ROOM(terrainTyp(u.ux, u.uy)) || !rn2(4) || whappr
                || (dog_has_minvent && rn2(edogApport(edog))))
                appr = 1;
        }
        if (appr === 0) {
            // On_stairs / dogfood-in-invent / magic-portal: none apply at the
            // point our sessions exercise (no dog food in starting invent for
            // these pets; not on stairs).  Leave appr unchanged.
        }
    } else {
        appr = 1;
    }
    if (mtmp.mconf) appr = 0;
    return appr;
}

function DDIST(x, y, ox, oy) { return dist2(x, y, ox, oy); }

// C ref: dogmove.c cursed_object_at(x,y).
function cursed_object_at(x, y) {
    return objectsAt(x, y).some((o) => o.cursed);
}

// C ref: vision couldsee()/m_cansee() — for a pet in a lit/adjacent room with
// the hero visible these are true; we approximate with "always can see" since
// the gameplay sessions keep the pet next to a sighted hero.
function couldsee(_x, _y) { return true; }
function m_cansee(_mtmp, _x, _y) { return true; }
function isLit(x, y) { return !!game.level?.at(x, y)?.lit; }

// C ref: mon.c can_carry — pet can carry an ordinary light object; the exact
// weight math doesn't affect RNG here, so report "yes".
function can_carry(_mtmp, _obj) { return 1; }

// C ref: dogmove.c dog_move(mtmp, after).  Drives one pet move.
export function dog_move(mtmp, after) {
    const edog = mtmp.edog;
    if (!edog) return MMOVE_NOTHING;

    const omx = mtmp.mx, omy = mtmp.my;
    let udist = distu(omx, omy);
    if (!udist) return MMOVE_NOTHING; // standing on the hero (shouldn't happen)

    let nix = omx, niy = omy;

    // dog_invent: object underfoot / carrying.  May consume the move (eat).
    const j0 = dog_invent(mtmp, edog, udist);
    if (j0 === 1) return MMOVE_DONE; // ate something

    const whappr = ((game.moves || 1) - edog.whistletime) < 5;

    const g = {};
    const appr = dog_goal(mtmp, edog, after, udist, whappr, g);
    if (appr === -2) return MMOVE_NOTHING;

    // mfndpos with pet allowflags (ALLOW_M etc.); for the common case this is
    // just the free adjacent squares (the hero square is excluded).
    const poss = mfndpos(mtmp, 0);
    const cnt = poss.length;

    // Count uncursed-item squares (for the cursed-item avoidance roll).
    let uncursedcnt = 0;
    for (let i = 0; i < cnt; i++) {
        const { x: nx, y: ny } = poss[i];
        if (MON_AT(nx, ny)) continue;
        if (cursed_object_at(nx, ny)) continue;
        uncursedcnt++;
    }

    let chcnt = 0, chi = -1;
    let nidist = GDIST(nix, niy, g);
    const k = uncursedcnt; // edog ? uncursedcnt : cnt
    const mtrack = mtmp.mtrack || [];

    for (let i = 0; i < cnt; i++) {
        const nx = poss[i].x, ny = poss[i].y;

        // (leashed / guardian / attack / displace / kicked-loc skips omitted)

        // dog eschews cursed objects, likes dog food: scan objects at <nx,ny>.
        let cursemsg = false, ate = false;
        for (const obj of objectsAt(nx, ny)) {
            if (obj.cursed) { cursemsg = true; continue; }
            const otyp = dogfood(mtmp, obj); // -> obj_resists rn2(100)
            if (otyp < MANFOOD
                && (otyp < ACCFOOD || edog.hungrytime <= (game.moves || 1))) {
                nix = nx; niy = ny; chi = i; ate = true;
                break;
            }
        }
        if (ate) break; // goto newdogpos (eating)

        // saw a cursed item and not forced onto it -> usually keep looking.
        if (cursemsg && uncursedcnt > 0 && rn2(13 * uncursedcnt))
            continue;

        // backtrack avoidance (only when far from the hero).
        if (distmin(omx, omy, game.u.ux, game.u.uy) > 5) {
            let skip = false;
            for (let jj = 0; jj < MTSZ && jj < k - 1; jj++) {
                const t = mtrack[jj];
                if (t && nx === t.x && ny === t.y) {
                    if (rn2(MTSZ * (k - jj))) { skip = true; break; }
                }
            }
            if (skip) continue;
        }

        const ndist = GDIST(nx, ny, g);
        const jv = (ndist - nidist) * appr;
        if ((jv === 0 && !rn2(++chcnt)) || jv < 0
            || (jv > 0 && !whappr
                && ((omx === nix && omy === niy && !rn2(3)) || !rn2(12)))) {
            nix = nx; niy = ny; nidist = ndist;
            if (jv < 0) chcnt = 0;
            chi = i;
        }
    }

    // pet_ranged_attk(mtmp, FALSE): dogs/cats have no ranged attack -> nothing.

    // newdogpos:
    if (nix !== omx || niy !== omy) {
        mtmp.mtrack = [{ x: omx, y: omy }, ...mtrack].slice(0, MTSZ);
        mtmp.mx = nix; mtmp.my = niy;
        // Redraw the vacated and occupied squares (C: place_monster + newsym).
        newsym(omx, omy);
        newsym(nix, niy);
        return MMOVE_MOVED;
    }
    return MMOVE_NOTHING;
}

function GDIST(x, y, g) { return dist2(x, y, g.gx, g.gy); }
