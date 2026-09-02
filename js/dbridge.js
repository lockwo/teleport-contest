// dbridge.js — C ref: src/dbridge.c (drawbridge create/open/close/destroy, plus
// the terrain-class predicates that live in this file).
//
// The is_pool()/is_lava()/is_ice()/is_moat() family is defined HERE in C, not in
// rm.h: each one resolves a raised drawbridge (DRAWBRIDGE_UP) to the terrain
// stored in drawbridgemask & DB_UNDER.  Eight modules in js/ carry a private
// copy that drops that arm (js/dungeon.js:1189, js/mkroom.js:21, js/muse.js:1060,
// js/polyself.js:953, js/teleport.js:51, js/sit.js:37, js/mhitm.js:674,
// js/ball.js:46); js/cmd.js:156 and js/monmove.js:928 have the full version.
// These are the canonical ones — see `deferred` for the consolidation list.
//
// RNG: dbridge.c draws in exactly three places — e_missed() rnd(8),
// e_jumps() rnd(10), and destroy_drawbridge()'s debris loop
// `for (i = rn2(6); i > 0; --i) mksobj_at(IRON_CHAIN, rn2(2)?x:x2, rn2(2)?y:y2)`.
// No recorded C stream in sessions/, heldout-wave3/ or heldout-proxy/ contains a
// single draw attributed to dbridge.c, so none of the three is confirmed by a
// trace; they are transcribed straight from the C.

import { game } from './gstate.js';
import { hliquid } from './do_name.js';
import {
    STONE, DBWALL, POOL, MOAT, WATER, DRAWBRIDGE_UP, LAVAPOOL,
    LAVAWALL, DOOR, ROOM, ICE, DRAWBRIDGE_DOWN, D_NODOOR, W_NONDIGGABLE,
    ICED_MOAT, DB_NORTH, DB_SOUTH, DB_EAST, DB_WEST, DB_DIR, DB_MOAT, DB_LAVA,
    DB_ICE, DB_UNDER, IS_WALL, IS_DRAWBRIDGE, IS_WATERWALL, isok,
    Is_juiblex_level, Is_stronghold,
    KILLED_BY_AN, NO_KILLER_PREFIX, CRUSHING, DROWNING, BURNING,
    XKILL_GIVEMSG, XKILL_NOMSG, XKILL_NOCORPSE, XKILL_NOCONDUCT,
} from './const.js';
import { rn2, rnd } from './rng.js';
import { m_at, newsym, pline, canseemon_shared } from './display.js';
import { block_point, unblock_point, does_block, vision_recalc, cansee } from './vision.js';
import { t_at, deltrap, spoteffects } from './trap.js';
import { mksobj_at, objects } from './mkobj.js';
import { DEADMONSTER, mmove_of } from './mon.js';
import { killed, mon_nam, Monnam } from './uhitm.js';
import { update_monster_region } from './region.js';
import { wake_nearto } from './cmd.js';
import { mflags1_of, M1_FLY, M1_SWIM, M1_WALLWALK } from './monflags_data.js';
import { name_to_pmidx, monster_by_pmidx } from './makemon.js';

const OTYP = new Map(objects.map((o) => [o.sym, o.otyp]));
const IRON_CHAIN = OTYP.get('IRON_CHAIN');
const BOULDER = OTYP.get('BOULDER');

// C ref: dbridge.c:290 ENTITIES — occupants[0] is the span, occupants[1] the
// portcullis.  C keeps them in go.occupants.
const ENTITIES = 2;
function occupants() {
    if (!game.occupants)
        game.occupants = [
            { emon: null, isu: false, ex: 0, ey: 0, edata: null },
            { emon: null, isu: false, ex: 0, ey: 0, edata: null },
        ];
    return game.occupants;
}

function levl(x, y) { return game.level?.at(x, y) || null; }
function levl_typ(x, y) { return levl(x, y)?.typ; }
function u_at(x, y) { return game.u?.ux === x && game.u?.uy === y; }
// C ref: hacklib.c distu(x, y) — squared distance from the hero.
function distu(x, y) {
    const u = game.u;
    return (x - (u?.ux ?? 0)) ** 2 + (y - (u?.uy ?? 0)) ** 2;
}

function impossible(...args) {
    if (game.debugImpossible) console.warn('impossible:', ...args);
}

// ── terrain-class predicates (dbridge.c:37-128) ──

// C ref: dbridge.c:37 is_waterwall(x, y).
export function is_waterwall(x, y) {
    return !!(isok(x, y) && IS_WATERWALL(levl_typ(x, y)));
}

// C ref: dbridge.c:45 is_pool(x, y).  `ltyp == MOAT` is NOT redundant with
// is_moat(): the Juiblex level has MOATs that are not moats.
export function is_pool(x, y) {
    if (!isok(x, y)) return false;
    const ltyp = levl_typ(x, y);
    return ltyp === POOL || ltyp === MOAT || ltyp === WATER || is_moat(x, y);
}

// C ref: dbridge.c:61 is_lava(x, y).
export function is_lava(x, y) {
    if (!isok(x, y)) return false;
    const loc = levl(x, y);
    if (!loc) return false;
    const ltyp = loc.typ;
    return ltyp === LAVAPOOL || ltyp === LAVAWALL
        || (ltyp === DRAWBRIDGE_UP && ((loc.drawbridgemask | 0) & DB_UNDER) === DB_LAVA);
}

// C ref: dbridge.c:76 is_pool_or_lava(x, y).
export function is_pool_or_lava(x, y) {
    return is_pool(x, y) || is_lava(x, y);
}

// C ref: dbridge.c:85 is_ice(x, y).
export function is_ice(x, y) {
    if (!isok(x, y)) return false;
    const loc = levl(x, y);
    if (!loc) return false;
    const ltyp = loc.typ;
    return ltyp === ICE
        || (ltyp === DRAWBRIDGE_UP && ((loc.drawbridgemask | 0) & DB_UNDER) === DB_ICE);
}

// C ref: dbridge.c:99 is_moat(x, y).
export function is_moat(x, y) {
    if (!isok(x, y)) return false;
    const loc = levl(x, y);
    if (!loc) return false;
    const ltyp = loc.typ;
    return !Is_juiblex_level(game.u?.uz)
        && (ltyp === MOAT
            || (ltyp === DRAWBRIDGE_UP
                && ((loc.drawbridgemask | 0) & DB_UNDER) === DB_MOAT));
}

// C ref: dbridge.c:115 db_under_typ(mask) — the terrain a raised drawbridge
// covers.  DB_FLOOR falls through to STONE, exactly as in C.
export function db_under_typ(mask) {
    switch (mask & DB_UNDER) {
    case DB_ICE:
        return ICE;
    case DB_LAVA:
        return LAVAPOOL;
    case DB_MOAT:
        return MOAT;
    default:
        return STONE;
    }
}

// C ref: dbridge.c:136 is_drawbridge_wall(x, y) — is this wall/door the
// portcullis of a drawbridge?  Returns the drawbridge's direction, or -1.
export function is_drawbridge_wall(x, y) {
    if (!isok(x, y)) return -1;

    const lev = levl(x, y);
    if (!lev || (lev.typ !== DOOR && lev.typ !== DBWALL)) return -1;

    if (isok(x + 1, y) && IS_DRAWBRIDGE(levl_typ(x + 1, y))
        && ((levl(x + 1, y).drawbridgemask | 0) & DB_DIR) === DB_WEST)
        return DB_WEST;
    if (isok(x - 1, y) && IS_DRAWBRIDGE(levl_typ(x - 1, y))
        && ((levl(x - 1, y).drawbridgemask | 0) & DB_DIR) === DB_EAST)
        return DB_EAST;
    if (isok(x, y - 1) && IS_DRAWBRIDGE(levl_typ(x, y - 1))
        && ((levl(x, y - 1).drawbridgemask | 0) & DB_DIR) === DB_SOUTH)
        return DB_SOUTH;
    if (isok(x, y + 1) && IS_DRAWBRIDGE(levl_typ(x, y + 1))
        && ((levl(x, y + 1).drawbridgemask | 0) & DB_DIR) === DB_NORTH)
        return DB_NORTH;

    return -1;
}

// C ref: dbridge.c:169 is_db_wall(x, y) — the drawbridge "wall" is UP here.
export function is_db_wall(x, y) {
    return levl_typ(x, y) === DBWALL;
}

// C ref: dbridge.c:179 find_drawbridge(&x, &y) — C moves the caller's <x,y> onto
// the drawbridge square; JS returns { ok, x, y } with <x,y> unchanged on miss.
export function find_drawbridge(x, y) {
    if (IS_DRAWBRIDGE(levl_typ(x, y))) return { ok: true, x, y };
    const dir = is_drawbridge_wall(x, y);
    if (dir >= 0) {
        switch (dir) {
        case DB_NORTH: y++; break;
        case DB_SOUTH: y--; break;
        case DB_EAST:  x--; break;
        case DB_WEST:  x++; break;
        default: break;
        }
        return { ok: true, x, y };
    }
    return { ok: false, x, y };
}

// C ref: dbridge.c:210 get_wall_for_db(&x, &y) — the portcullis square of the
// drawbridge at <x,y>.
function get_wall_for_db(x, y) {
    switch ((levl(x, y)?.drawbridgemask | 0) & DB_DIR) {
    case DB_NORTH: y--; break;
    case DB_SOUTH: y++; break;
    case DB_EAST:  x++; break;
    case DB_WEST:  x--; break;
    default: break;
    }
    return { x, y };
}

// C ref: dbridge.c:234 create_drawbridge(x, y, dir, flag) — flag TRUE means the
// bridge starts open (lowered).  js/mklev.js:4471 hf_drawbridge() is a second
// copy of this used by the castle / hell-prefab level loaders; that copy has
// DB_LAVA = 0x40 where rm.h says 4 (see `deferred`).
export function create_drawbridge(x, y, dir, flag) {
    let x2 = x, y2 = y;
    let horiz;
    if (!levl(x, y)) return false;
    const lava = levl_typ(x, y) === LAVAPOOL; /* assume initialized map */

    switch (dir) {
    case DB_NORTH:
        horiz = true;
        y2--;
        break;
    case DB_SOUTH:
        horiz = true;
        y2++;
        break;
    case DB_EAST:
        horiz = false;
        x2++;
        break;
    default:
        impossible('bad direction in create_drawbridge');
        /* FALLTHRU */
    case DB_WEST:
        horiz = false;
        x2--;
        break;
    }
    if (!IS_WALL(levl_typ(x2, y2))) return false;
    if (flag) { /* We want the bridge open */
        levl(x, y).typ = DRAWBRIDGE_DOWN;
        levl(x2, y2).typ = DOOR;
        levl(x2, y2).doormask = D_NODOOR;
    } else {
        levl(x, y).typ = DRAWBRIDGE_UP;
        levl(x2, y2).typ = DBWALL;
        /* Drawbridges are non-diggable. */
        levl(x2, y2).wall_info = W_NONDIGGABLE;
    }
    levl(x, y).horizontal = !horiz;
    levl(x2, y2).horizontal = horiz;
    levl(x, y).drawbridgemask = dir;
    if (lava) levl(x, y).drawbridgemask |= DB_LAVA;
    return true;
}

// ── entities (dbridge.c:285-551) ──

// C ref: dbridge.c:285 e_at(x, y).
function e_at(x, y) {
    const occ = occupants();
    let entitycnt;
    for (entitycnt = 0; entitycnt < ENTITIES; entitycnt++)
        if (occ[entitycnt].edata
            && occ[entitycnt].ex === x
            && occ[entitycnt].ey === y)
            break;
    return (entitycnt === ENTITIES) ? null : occ[entitycnt];
}

// C ref: dbridge.c:303 m_to_e(mtmp, x, y, etmp).
function m_to_e(mtmp, x, y, etmp) {
    etmp.emon = mtmp;
    etmp.isu = false;
    if (mtmp) {
        etmp.ex = x;
        etmp.ey = y;
        if (mtmp.wormno && (x !== mtmp.mx || y !== mtmp.my))
            etmp.edata = monster_by_pmidx(name_to_pmidx('long worm tail'));
        else
            etmp.edata = mtmp.data;
    } else {
        etmp.edata = null;
        etmp.ex = etmp.ey = 0;
    }
}

// C ref: dbridge.c:320 u_to_e(etmp).  This port has no youmonst struct; the
// hero is game.u, flagged by etmp.isu (C's `etmp->emon == &gy.youmonst`).
function u_to_e(etmp) {
    etmp.emon = null;
    etmp.isu = true;
    etmp.ex = game.u?.ux;
    etmp.ey = game.u?.uy;
    etmp.edata = youmonst_data();
}

// C ref: monst.h gy.youmonst.data == &mons[u.umonnum].
function youmonst_data() {
    const idx = game.u?.umonnum ?? game.urole?.malenum ?? game.urole?.mnum;
    return idx == null ? null : monster_by_pmidx(idx);
}

// C ref: dbridge.c:329 set_entity(x, y, etmp).
function set_entity(x, y, etmp) {
    if (u_at(x, y)) u_to_e(etmp);
    else /* m_at() might yield Null; that's ok */
        m_to_e(m_at(x, y), x, y, etmp);
}

// C ref: dbridge.c:340-341.
function is_u(etmp) { return !!etmp.isu; }
function e_canseemon(etmp) { return is_u(etmp) || canseemon_shared(etmp.emon); }

// C ref: dbridge.c:350 e_nam(etmp).
function e_nam(etmp) {
    return is_u(etmp) ? 'you' : mon_nam(etmp.emon);
}

// C ref: dbridge.c:360 E_phrase(etmp, verb) — capitalized entity name with a
// 2nd->3rd person verb conversion where necessary.
function E_phrase(etmp, verb) {
    let wholebuf = is_u(etmp) ? 'You' : Monnam(etmp.emon);
    if (!verb) return wholebuf;
    wholebuf += ' ';
    wholebuf += is_u(etmp) ? verb : vtense(null, verb);
    return wholebuf;
}

// C ref: dbridge.c:379 e_survives_at(etmp, x, y) — simple-minded "can it be
// here?".
function e_survives_at(etmp, x, y) {
    if (noncorporeal(etmp.edata)) return true;
    if (is_pool(x, y))
        return (is_u(etmp) && (Wwalking() || Amphibious() || Breathless()
                               || Swimming() || Flying() || Levitation()))
            || is_swimmer(etmp.edata)
            || is_flyer(etmp.edata)
            || is_floater(etmp.edata);
    /* must force call to lava_effects in e_died if is_u */
    if (is_lava(x, y))
        return (is_u(etmp) && (Levitation() || Flying()))
            || likes_lava(etmp.edata)
            || is_flyer(etmp.edata);
    if (is_db_wall(x, y))
        return is_u(etmp) ? Passes_walls() : passes_walls(etmp.edata);
    return true;
}

// C ref: dbridge.c:401 e_died(etmp, xkill_flags, how).
async function e_died(etmp, xkill_flags, how) {
    if (is_u(etmp)) {
        // DEFERRED (end.c done(), trap.c drown()/lava_effects()): the hero-death
        // path needs end.c's done(), which js/end.js keeps private, and the
        // drown()/lava_effects() pair, which js/trap.js also keeps private.  All
        // three consume RNG (bones/attribute rolls, crawl-out-of-water rolls);
        // calling a partial version would emit a different stream, so the hero
        // branch stops at recording the killer, exactly the state C has when it
        // enters done().  See `deferred`.
        if (how !== DROWNING && how !== BURNING) {
            if (!killer_name()) {
                set_killer('falling drawbridge', KILLED_BY_AN);
            }
        } else {
            set_killer('', 0); /* drown()/lava_effects() set their own killer */
        }
        /* we might have crawled out of the moat to survive */
        etmp.ex = game.u?.ux; etmp.ey = game.u?.uy;
        return;
    }

    set_killer('', 0);
    /* fake "digested to death" damage-type suppresses corpse */
    const mk_message = (dest) => ((dest & XKILL_NOMSG) !== 0 ? null : '');
    const mk_corpse = (dest) => ((dest & XKILL_NOCORPSE) !== 0);

    // C: `if (svc.context.mon_moving) monkilled(...) else xkilled(...)`.
    // js/uhitm.js killed() is the shared xkilled(); the only monkilled() in the
    // port is private to js/muse.js:626.  Using killed() for the mon_moving arm
    // too is the one KNOWN divergence in this function: monkilled() prints
    // "<Monster> is killed!" instead of "You kill <monster>!" and awards the
    // hero no experience.  Both arms end in mondead(), so the monster dies and
    // the corpse rolls happen either way.  See `deferred`.
    await killed(etmp.emon, { nomsg: mk_message(xkill_flags) === null,
                              nocorpse: mk_corpse(xkill_flags) });

    /* if etmp gets life-saved, kill it again; otherwise we might end up
       trying to place another monster on the same spot */
    if (!DEADMONSTER(etmp.emon)) {
        const seeit = canspotmon(etmp.emon);

        xkill_flags |= XKILL_NOMSG | XKILL_NOCONDUCT;
        await killed(etmp.emon, { nomsg: true, nocorpse: mk_corpse(xkill_flags) });

        if (DEADMONSTER(etmp.emon)) {
            if (seeit)
                await pline(`Unfortunately for ${mon_nam(etmp.emon)}, `
                            + `${mhe(etmp.emon)} is still crushed.`);
        }
    }
    etmp.edata = null;

    /* dead long worm handling */
    const occ = occupants();
    for (let entitycnt = 0; entitycnt < ENTITIES; entitycnt++) {
        if (etmp !== occ[entitycnt] && etmp.emon === occ[entitycnt].emon)
            occ[entitycnt].edata = null;
    }
}

// C ref: dbridge.c:485 automiss(etmp) — never directly affected by a bridge or
// portcullis.
function automiss(etmp) {
    return (is_u(etmp) ? Passes_walls() : passes_walls(etmp.edata))
        || noncorporeal(etmp.edata);
}

// C ref: dbridge.c:495 e_missed(etmp, chunks) — does the falling drawbridge or
// portcullis miss?  Draws rnd(8).
function e_missed(etmp, chunks) {
    let misses;

    if (automiss(etmp)) return true;

    if (is_flyer(etmp.edata)
        && (is_u(etmp) ? !Unaware() : !helpless(etmp.emon)))
        /* flying requires mobility */
        misses = 5; /* out of 8 */
    else if (is_floater(etmp.edata)
             || (is_u(etmp) && Levitation())) /* doesn't require mobility */
        misses = 3;
    else if (chunks && is_pool(etmp.ex, etmp.ey))
        misses = 2; /* sitting ducks */
    else
        misses = 0;

    if (is_db_wall(etmp.ex, etmp.ey))
        misses -= 3; /* less airspace */

    return (misses >= rnd(8));
}

// C ref: dbridge.c:530 e_jumps(etmp) — can it jump clear?  Draws rnd(10), but
// only after the leading disqualifiers pass.
function e_jumps(etmp) {
    let tmp = 4; /* out of 10 */

    if (is_u(etmp) ? (Unaware() || Fumbling())
                   : (helpless(etmp.emon)
                      || !mmove_of(etmp.edata) || etmp.emon.wormno))
        return false;

    if (is_u(etmp) ? Confusion() : etmp.emon.mconf) tmp -= 2;

    if (is_u(etmp) ? Stunned() : etmp.emon.mstun) tmp -= 3;

    if (is_db_wall(etmp.ex, etmp.ey))
        tmp -= 2; /* less room to maneuver */

    return (tmp >= rnd(10));
}

// C ref: dbridge.c:553 do_entity(etmp).
async function do_entity(etmp) {
    let must_jump = false, relocates = false;

    if (!etmp.edata) return;

    let e_inview = e_canseemon(etmp);
    const oldx = etmp.ex, oldy = etmp.ey;
    const at_portcullis = is_db_wall(oldx, oldy);
    const crm = levl(oldx, oldy);

    if (automiss(etmp) && e_survives_at(etmp, oldx, oldy)) {
        if (e_inview && (at_portcullis || IS_DRAWBRIDGE(crm?.typ)))
            await pline(`The ${at_portcullis ? 'portcullis' : 'drawbridge'}`
                        + ` passes through ${e_nam(etmp)}!`);
        if (is_u(etmp)) await spoteffects(null);
        return;
    }
    if (e_missed(etmp, false)) {
        if (at_portcullis)
            await pline(`The portcullis misses ${e_nam(etmp)}!`);
        if (e_survives_at(etmp, oldx, oldy)) {
            return;
        } else {
            if (at_portcullis)
                must_jump = true;
            else
                relocates = true; /* just ride drawbridge in */
        }
    } else {
        if (crm?.typ === DRAWBRIDGE_DOWN) {
            if (is_u(etmp))
                set_killer('crushed to death underneath a drawbridge',
                           NO_KILLER_PREFIX);
            await pline(`${E_phrase(etmp, 'are')} crushed underneath the drawbridge.`);
            await e_died(etmp,
                         XKILL_NOCORPSE | (e_inview ? XKILL_GIVEMSG : XKILL_NOMSG),
                         CRUSHING); /* no corpse */
            return;       /* Note: Beyond this point, we know we're  */
        }                 /* not at an opened drawbridge, since all  */
        must_jump = true; /* *missable* creatures survive on the     */
    }                     /* square, and all the unmissed ones die.  */
    if (must_jump) {
        if (at_portcullis) {
            if (e_jumps(etmp)) {
                relocates = true;
            } else {
                if (e_inview) {
                    await pline(`${E_phrase(etmp, 'are')} crushed by the falling portcullis!`);
                } else if (!Deaf()) {
                    await You_hear('a crushing sound.');
                }
                await e_died(etmp,
                             XKILL_NOCORPSE | (e_inview ? XKILL_GIVEMSG : XKILL_NOMSG),
                             CRUSHING);
                /* no corpse */
                return;
            }
        } else { /* tries to jump off bridge to original square */
            relocates = !e_jumps(etmp);
        }
    }

    /*
     * Relocation.  etmp cannot be arriving at the portcullis square while the
     * drawbridge is falling, so the square is either inaccessible or
     * unnecessary in that situation.
     */
    let newx = oldx, newy = oldy;
    {
        const fd = find_drawbridge(newx, newy);
        newx = fd.x; newy = fd.y;
    }
    if ((newx === oldx) && (newy === oldy)) {
        const w = get_wall_for_db(newx, newy);
        newx = w.x; newy = w.y;
    }
    if (relocates && e_at(newx, newy)) {
        /*
         * Standoff problem: one or both entities must die, and/or both switch
         * places.  Avoid infinite recursion by checking first whether the
         * other entity is staying put.
         */
        const other = e_at(newx, newy);
        if (e_survives_at(other, newx, newy) && automiss(other)) {
            relocates = false; /* "other" won't budge */
        } else {
            while ((e_at(newx, newy) !== null) && (e_at(newx, newy) !== etmp))
                await do_entity(other);
            if (e_at(oldx, oldy) !== etmp) {
                /* moved or died in recursion somewhere */
                return;
            }
        }
    }
    if (relocates && !e_at(newx, newy)) { /* if e_at() entity = worm tail */
        if (!is_u(etmp)) {
            // C: remove_monster(ex,ey); place_monster(emon,newx,newy).  Neither
            // helper is exported by this port (js/monmove.js assigns mx/my
            // directly); they belong in mon.c's module.
            etmp.emon.mx = newx;
            etmp.emon.my = newy;
            update_monster_region(etmp.emon);
        } else {
            game.u.ux = newx;
            game.u.uy = newy;
        }
        etmp.ex = newx;
        etmp.ey = newy;
        e_inview = e_canseemon(etmp);
    }
    if (is_db_wall(etmp.ex, etmp.ey)) {
        if (e_inview) {
            if (is_u(etmp)) {
                await pline('You tumble towards the closed portcullis!');
                if (automiss(etmp))
                    await pline('You pass through it!');
                else
                    await pline('The drawbridge closes in...');
            } else {
                await pline(`${E_phrase(etmp, 'disappear')} behind the drawbridge.`);
            }
        }
        if (!e_survives_at(etmp, etmp.ex, etmp.ey)) {
            set_killer('closing drawbridge', KILLED_BY_AN);
            await e_died(etmp, XKILL_NOMSG, CRUSHING);
            return;
        }
    } else {
        if (is_pool(etmp.ex, etmp.ey) && !e_inview)
            if (!Deaf()) await You_hear('a splash.');
        if (e_survives_at(etmp, etmp.ex, etmp.ey)) {
            if (e_inview && !is_flyer(etmp.edata) && !is_floater(etmp.edata))
                await pline(`${E_phrase(etmp, 'fall')} from the bridge.`);
            return;
        }
        if (is_pool(etmp.ex, etmp.ey) || is_lava(etmp.ex, etmp.ey))
            if (e_inview && !is_u(etmp)) {
                /* drown() will supply msgs if nec. */
                const lava = is_lava(etmp.ex, etmp.ey);

                if (Hallucination())
                    await pline(`${E_phrase(etmp, 'drink')} the ${lava ? 'lava' : 'moat'}`
                                + ' and disappears.');
                else
                    await pline(`${E_phrase(etmp, 'fall')} into the `
                                + `${lava ? hliquid('lava') : 'moat'}.`);
            }
        set_killer('fell from a drawbridge', NO_KILLER_PREFIX);
        await e_died(etmp, /* CRUSHING is arbitrary */
                     XKILL_NOCORPSE | (e_inview ? XKILL_GIVEMSG : XKILL_NOMSG),
                     is_pool(etmp.ex, etmp.ey) ? DROWNING
                       : is_lava(etmp.ex, etmp.ey) ? BURNING
                         : CRUSHING); /* no corpse */
    }
}

// C ref: dbridge.c:762 nokiller() — clear the stale reason for death and both
// 'entities' before returning.
function nokiller() {
    set_killer('', 0);
    const occ = occupants();
    m_to_e(null, 0, 0, occ[0]);
    m_to_e(null, 0, 0, occ[1]);
}

// ── the three drawbridge operations (dbridge.c:774-1019) ──

// C ref: dbridge.c:774 close_drawbridge(x, y).
export async function close_drawbridge(x, y) {
    const lev1 = levl(x, y);
    if (!lev1 || lev1.typ !== DRAWBRIDGE_DOWN) return;
    const { x: x2, y: y2 } = get_wall_for_db(x, y);
    if (cansee(x, y) || cansee(x2, y2)) {
        await pline('You see a drawbridge '
                    + (((game.u.ux === x || game.u.uy === y) && !Underwater())
                       || distu(x2, y2) < distu(x, y) ? 'coming' : 'going')
                    + ' up!');
    } else { /* "5 gears turn" for castle drawbridge tune */
        await You_hear('chains rattling and gears turning.');
    }
    lev1.typ = DRAWBRIDGE_UP;
    const lev2 = levl(x2, y2);
    lev2.typ = DBWALL;
    switch ((lev1.drawbridgemask | 0) & DB_DIR) {
    case DB_NORTH:
    case DB_SOUTH:
        lev2.horizontal = true;
        break;
    case DB_WEST:
    case DB_EAST:
        lev2.horizontal = false;
        break;
    default:
        break;
    }
    lev2.wall_info = W_NONDIGGABLE;
    const occ = occupants();
    set_entity(x, y, occ[0]);
    set_entity(x2, y2, occ[1]);
    await do_entity(occ[0]);          /* Do set_entity after first */
    set_entity(x2, y2, occ[1]);       /* do_entity for worm tail */
    await do_entity(occ[1]);
    if (OBJ_AT(x, y) && !Deaf())
        await You_hear('smashing and crushing.');
    // DEFERRED (hack.c revive_nasty): C calls revive_nasty(x,y,0) and
    // revive_nasty(x2,y2,0) here, which revive() any Rider/troll corpses about
    // to be crushed.  revive() draws RNG (montraits/makemon) and neither it nor
    // revive_nasty exists anywhere in js/; see `deferred`.
    delallobj(x, y);
    delallobj(x2, y2);
    let t = t_at(x, y);
    if (t) deltrap(t);
    t = t_at(x2, y2);
    if (t) deltrap(t);
    del_engr_at(x, y);
    del_engr_at(x2, y2);
    newsym(x, y);
    newsym(x2, y2);
    block_point(x2, y2); /* vision */
    nokiller();
}

// C ref: dbridge.c:839 open_drawbridge(x, y).
export async function open_drawbridge(x, y) {
    const lev1 = levl(x, y);
    if (!lev1 || lev1.typ !== DRAWBRIDGE_UP) return;
    const { x: x2, y: y2 } = get_wall_for_db(x, y);
    if (cansee(x, y) || cansee(x2, y2)) {
        await pline('You see a drawbridge '
                    + ((distu(x2, y2) < distu(x, y)) ? 'going' : 'coming')
                    + ' down!');
    } else { /* "5 gears turn" for castle drawbridge tune */
        await You_hear('gears turning and chains rattling.');
    }
    lev1.typ = DRAWBRIDGE_DOWN;
    const lev2 = levl(x2, y2);
    lev2.typ = DOOR;
    lev2.doormask = D_NODOOR;
    const occ = occupants();
    set_entity(x, y, occ[0]);
    set_entity(x2, y2, occ[1]);
    await do_entity(occ[0]);          /* do set_entity after first */
    set_entity(x2, y2, occ[1]);       /* do_entity for worm tails */
    await do_entity(occ[1]);
    // DEFERRED (hack.c revive_nasty): C calls revive_nasty(x, y, 0) here.
    delallobj(x, y);
    let t = t_at(x, y);
    if (t) deltrap(t);
    t = t_at(x2, y2);
    if (t) deltrap(t);
    del_engr_at(x, y);
    del_engr_at(x2, y2);
    newsym(x, y);
    newsym(x2, y2);
    unblock_point(x2, y2); /* vision */
    if (Is_stronghold(game.u?.uz)) uevent().uopened_dbridge = true;
    nokiller();
}

// C ref: dbridge.c:887 destroy_drawbridge(x, y).
export async function destroy_drawbridge(x, y) {
    const lev1 = levl(x, y);
    if (!lev1 || !IS_DRAWBRIDGE(lev1.typ)) return;
    const { x: x2, y: y2 } = get_wall_for_db(x, y);
    const lev2 = levl(x2, y2);
    const occ = occupants();
    const etmp1 = occ[0], etmp2 = occ[1];
    let e_inview;

    if ((lev1.drawbridgemask & DB_UNDER) === DB_MOAT
        || (lev1.drawbridgemask & DB_UNDER) === DB_LAVA) {
        const lava = (lev1.drawbridgemask & DB_UNDER) === DB_LAVA;

        if (lev1.typ === DRAWBRIDGE_UP) {
            if (cansee(x2, y2) || u_at(x2, y2))
                await pline('The portcullis of the drawbridge falls into the '
                            + `${lava ? hliquid('lava') : 'moat'}!`);
            else
                await You_hear('a loud *SPLASH*!');
        } else {
            if (cansee(x, y) || u_at(x, y))
                await pline('The drawbridge collapses into the '
                            + `${lava ? hliquid('lava') : 'moat'}!`);
            else
                await You_hear('a loud *SPLASH*!');
        }
        lev1.typ = lava ? LAVAPOOL : MOAT;
        lev1.drawbridgemask = 0;
        const otmp2 = sobj_at(BOULDER, x, y);
        if (otmp2) {
            // DEFERRED (do.c flooreffects): C does obj_extract_self(otmp2) then
            // flooreffects(otmp2, x, y, "fall") — the boulder fills the moat and
            // that path draws RNG.  js/ has no flooreffects().
        }
    } else {
        /* no moat beneath */
        if (cansee(x, y) || u_at(x, y))
            await pline('The drawbridge disintegrates!');
        else
            await You_hear('a loud *CRASH*!');
        lev1.typ = ((lev1.drawbridgemask & DB_ICE) ? ICE : ROOM);
        lev1.icedpool = ((lev1.drawbridgemask & DB_ICE) ? ICED_MOAT : 0);
    }
    await wake_nearto(x, y, 500);
    lev2.typ = DOOR;
    lev2.doormask = D_NODOOR;
    let t = t_at(x, y);
    if (t) deltrap(t);
    t = t_at(x2, y2);
    if (t) deltrap(t);
    del_engr_at(x, y);
    del_engr_at(x2, y2);
    for (let i = rn2(6); i > 0; --i) { /* scatter some debris */
        /* it doesn't matter if we pick <x,y2> or <x2,y>: drawbridges are never
           placed diagonally, so those pairings always match <x,y> or <x2,y2> */
        /* C's argument evaluation order is unspecified, and both draws are
           rn2(2) so the STREAM is the same either way — but which result lands
           on x vs y is not.  Probed the recorder's compiler (clang, -O0 and
           -O2, macOS arm64): arguments evaluate LEFT TO RIGHT, i.e. the x draw
           comes first, which is what this line does. */
        mksobj_at(IRON_CHAIN, rn2(2) ? x : x2, rn2(2) ? y : y2, true, false);
        // DEFERRED (explode.c:721 scatter): C follows each chain with
        // scatter(otmp->ox, otmp->oy, 1, MAY_HIT, otmp), which draws RNG per
        // scattered object.  js/ has no scatter(); see `deferred`.
    }
    newsym(x, y);
    newsym(x2, y2);
    if (!does_block(x2, y2))
        unblock_point(x2, y2); /* vision */
    vision_recalc(0);
    if (Is_stronghold(game.u?.uz)) uevent().uopened_dbridge = true;

    set_entity(x2, y2, etmp2); /* currently only automissers can be here */
    if (etmp2.edata) {
        e_inview = e_canseemon(etmp2);
        if (!automiss(etmp2)) {
            if (e_inview)
                await pline(`${E_phrase(etmp2, 'are')} blown apart by flying debris.`);
            set_killer('exploding drawbridge', KILLED_BY_AN);
            await e_died(etmp2,
                         XKILL_NOCORPSE | (e_inview ? XKILL_GIVEMSG : XKILL_NOMSG),
                         CRUSHING); /* no corpse */
        } /* nothing which is vulnerable can survive this */
    }
    set_entity(x, y, etmp1);
    if (etmp1.edata) {
        e_inview = e_canseemon(etmp1);
        if (e_missed(etmp1, true)) {
            /* if there is water or lava here, fall in now */
            if (is_u(etmp1)) {
                await spoteffects(null);
            } else {
                // DEFERRED (mon.c minliquid): js/mon.js:555 has minliquid() but
                // keeps it private, and its pool/lava death arms are themselves
                // deferred there.
            }
        } else {
            if (e_inview) {
                if (!is_u(etmp1) && Hallucination())
                    await pline(`${E_phrase(etmp1, 'get')} into some heavy metal!`);
                else
                    await pline(`${E_phrase(etmp1, 'are')} hit by a huge chunk of metal!`);
            } else {
                if (!Deaf() && !is_u(etmp1) && !is_pool(x, y))
                    await You_hear('a crushing sound.');
            }
            set_killer('collapsing drawbridge', KILLED_BY_AN);
            await e_died(etmp1,
                         XKILL_NOCORPSE | (e_inview ? XKILL_GIVEMSG : XKILL_NOMSG),
                         CRUSHING); /* no corpse */
            if (levl_typ(etmp1.ex, etmp1.ey) === MOAT)
                await do_entity(etmp1);
        }
    }
    nokiller();
    if (Is_stronghold(game.u?.uz))
        uevent().uheard_tune = 3; /* bridge is gone so tune is now useless */
}

// ── leaves that belong to other C files ──

function uevent() {
    if (!game.u.uevent) game.u.uevent = {};
    return game.u.uevent;
}

// C ref: decl.h svk.killer.
function set_killer(name, format) {
    if (!game.killer) game.killer = { name: '', format: 0 };
    game.killer.name = name;
    game.killer.format = format;
}
function killer_name() { return game.killer?.name || ''; }

// C ref: engrave.c:461 del_engr_at(x, y).  js/fountain.js:674 has the same
// private copy; it belongs in an engrave.js module.
function del_engr_at(x, y) {
    const engr = game.level?.engravings;
    if (!engr) return;
    for (let i = engr.length - 1; i >= 0; i--)
        if (engr[i].engr_x === x && engr[i].engr_y === y) engr.splice(i, 1);
}

// C ref: rm.h OBJ_AT(x, y) — is there a floor object here?
function OBJ_AT(x, y) {
    return floor_pile(x, y).length > 0;
}

// The level's floor pile at <x,y>.  game.level.objects is a FLAT array of
// objects carrying .ox/.oy (js/mkobj.js place_object pushes onto it,
// js/display.js vobj_at scans it that way); C's svl.level.objects[x][y] chain is
// newest-first, which for a push-ordered array is the reverse of insertion.
// NOTE: js/invent.js's delallobj()/sobj_at()/(:2890,:2896) index that flat array
// as `objects[x][y]`, so they match nothing and silently do nothing — a real bug
// in a file outside this lease (see `deferred`), which is why the two helpers
// below are local rather than imported.
function floor_pile(x, y) {
    const out = [];
    for (const o of (game.level?.objects || []))
        if (o.where === 'floor' && o.ox === x && o.oy === y) out.unshift(o);
    return out;
}

// C ref: invent.c sobj_at(otyp, x, y).
function sobj_at(otyp, x, y) {
    for (const o of floor_pile(x, y)) if (o.otyp === otyp) return o;
    return null;
}

// C ref: invent.c delallobj(x, y) — delete every object on the square.
function delallobj(x, y) {
    const arr = game.level?.objects;
    if (!arr) return;
    for (const o of floor_pile(x, y)) {
        const ix = arr.indexOf(o);
        if (ix >= 0) arr.splice(ix, 1);
        o.where = 'free';
    }
    newsym(x, y);
}

// C ref: do_name.c hliquid(liquidpref) — the preferred word unless the hero is
// hallucinating (which draws off the DISPLAY rng, not the game rng).
// js/do_name.js owns hliquid().

// C ref: pline.c You_hear(...) — suppressed when Deaf.
async function You_hear(msg) {
    if (!Deaf()) await pline(`You hear ${msg}`);
}

// C ref: objnam.c vtense(subj, verb) — 2nd->3rd person for a singular subject.
// (js/trap.js:700 and js/dogmove.js:2028 each have a private copy.)
function vtense(_subj, verb) {
    if (verb === 'are') return 'is';
    if (verb === 'have') return 'has';
    if (/(s|x|z|ch|sh)$/.test(verb)) return verb + 'es';
    if (/[^aeiou]y$/.test(verb)) return verb.slice(0, -1) + 'ies';
    return verb + 's';
}

// C ref: mondata.h — flag predicates, taken from the generated tables.
function is_flyer(ptr) { return (mflags1_of(ptr) & M1_FLY) !== 0; }
function is_swimmer(ptr) { return (mflags1_of(ptr) & M1_SWIM) !== 0; }
function passes_walls(ptr) { return (mflags1_of(ptr) & M1_WALLWALK) !== 0; }
// C ref: mondata.h:20/31 — these two are mlet (monster class) tests, not flags.
// defsym.h MONSYM idx (enum mon_syms in sym.h): S_EYE=5, S_LIGHT=25, S_GHOST=54.
const S_EYE = 5, S_LIGHT = 25, S_GHOST = 54;
function is_floater(ptr) { return ptr?.mcls === S_EYE || ptr?.mcls === S_LIGHT; }
function noncorporeal(ptr) { return ptr?.mcls === S_GHOST; }
// C ref: mondata.h:190 likes_lava(ptr) — fire elemental and salamander, looked
// up by NAME in the generated monster table rather than by a literal pmidx.
const LAVA_LIKERS = new Set([name_to_pmidx('fire elemental'),
                             name_to_pmidx('salamander')]);
function likes_lava(ptr) {
    return ptr?.pmidx != null && LAVA_LIKERS.has(ptr.pmidx);
}
// C ref: include/monst.h:251 helpless(mon) = msleeping || !mcanmove.
function helpless(mon) {
    if (!mon) return false;
    const canmove = (mon.mcanmove == null) ? 1 : mon.mcanmove;
    return !!(mon.msleeping || !canmove);
}
// C ref: do_name.c mhe(mon) — the monster's pronoun.  Gender tracking for a
// crushed monster is objnam.c's; "it" is C's answer for a genderless or
// unseen monster and the only one this port can produce.
function mhe(_mon) { return 'it'; }

// C ref: display.h canspotmon(mon) = canseemon(mon) || sensemon(mon).  Nothing
// in this port grants telepathy/detection yet (js/mon.js:655 documents the same
// state), so sensemon() is the tp_sensemon() half only.
function canspotmon(mon) { return canseemon_shared(mon); }

// ── hero properties (youprop.h) ──

function HProp(...keys) {
    const u = game.u;
    for (const k of keys) {
        const v = u?.uprops?.[k] ?? u?.[k];
        if (v) return typeof v === 'number' ? v : 1;
    }
    return 0;
}
function Levitation() { return HProp('Levitation', 'HLevitation', 'ELevitation') > 0; }
function Flying() { return HProp('Flying', 'HFlying', 'EFlying') > 0; }
function Wwalking() { return HProp('Wwalking', 'HWwalking', 'EWwalking') > 0; }
function Swimming() { return HProp('Swimming', 'HSwimming', 'ESwimming') > 0; }
function Breathless() { return HProp('Breathless', 'HBreathless', 'EBreathless') > 0; }
function Amphibious() { return HProp('Amphibious', 'HAmphibious', 'EAmphibious') > 0; }
function Passes_walls() { return HProp('Passes_walls', 'HPasses_walls', 'EPasses_walls') > 0; }
function Confusion() { return HProp('Confusion', 'HConfusion', 'EConfusion') > 0; }
function Stunned() { return HProp('Stunned', 'HStun', 'EStun') > 0; }
function Fumbling() { return HProp('Fumbling', 'HFumbling', 'EFumbling') > 0; }
function Hallucination() { return HProp('Hallucination', 'HHallucination') > 0 || !!game.u?.uhallu; }
// C ref: youprop.h Unaware — asleep, unconscious or otherwise not perceiving.
function Unaware() { return !!(game.u?.usleep || game.u?.Unaware); }
function Deaf() { return HProp('Deaf', 'HDeaf', 'EDeaf') > 0; }
function Underwater() { return !!(game.u?.uinwater || game.u?.uunderwater); }
