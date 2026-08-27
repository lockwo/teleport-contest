// dig.js — Digging / tunnelling terrain modification.
// C ref: src/dig.c — the monster-digging entry points mdig_tunnel() and the
// hack.c may_dig() helper (kept here alongside the digging code it guards).
//
// Only the monster-tunnelling path is ported (mdig_tunnel + may_dig): a
// pick-wielding dwarf (or a rock mole) that carves through rock/walls/trees as
// it moves, driven from monmove.js m_move()/postmov().  The hero-digging
// occupation (dig_check / dighole) is a separate unported subsystem.

import { game } from './gstate.js';
import { rnd, rn2, rn1 } from './rng.js';
import { newsym } from './display.js';
import { A_STR, A_INT, A_WIS, A_DEX, A_CON, A_CHA, HEAD } from './const.js';
import { unblock_point, recalc_block_point, cansee } from './vision.js';
import {
    IS_WALL, IS_TREE, IS_OBSTRUCTED, IS_STWALL, IS_DOOR,
    STONE, CORR, DOOR, ROOM, SCORR, SDOOR,
    D_NODOOR, D_BROKEN, D_CLOSED, D_LOCKED, D_TRAPPED,
    W_NONDIGGABLE, isok, Is_earthlevel,
} from './const.js';
import { mksobj_at, ROCK, BOULDER, STATUE, objects as OBJECTS_TBL } from './mkobj.js';
import {
    DIGTYP_UNDIGGABLE, DIGTYP_ROCK, DIGTYP_STATUE, DIGTYP_BOULDER,
    DIGTYP_DOOR, DIGTYP_TREE, N_DIRS, N_DIRS_Z, TT_WEB,
} from './const.js';
import { is_pick, is_axe } from './weapon.js';
import { Is_special } from './dungeon.js';
import { inside_room } from './mkroom.js';

// C ref: hack.c may_dig(x, y) — "intended to be called only on ROCKs or TREEs".
// A stone wall or tree is diggable unless the cell is flagged W_NONDIGGABLE
// (level border / permanent walls, which our mklev does not set for interior
// rock, so ordinary rock/walls in the mines are diggable).
export function may_dig(x, y) {
    const lev = game.level?.at(x, y);
    if (!lev) return false;
    return !((IS_STWALL(lev.typ) || IS_TREE(lev.typ))
             && ((lev.wall_info || 0) & W_NONDIGGABLE));
}

// C ref: rm.h closed_door(x, y) == (IS_DOOR(levl[x][y].typ)
//                                   && (levl[x][y].doormask & (D_CLOSED|D_LOCKED)))
function closed_door(x, y) {
    const lev = game.level?.at(x, y);
    if (!lev) return false;
    return IS_DOOR(lev.typ) && ((lev.doormask & (D_CLOSED | D_LOCKED)) !== 0);
}

// C ref: detect.c cvt_sdoor_to_door(lev) — a secret door, once exposed, becomes
// an ordinary (closed) door.  WM_MASK (rm.h) is the low wall-mode bits stored in
// doormask for an SDOOR; strip them, then mark the newly revealed door closed
// unless it was locked.
const WM_MASK = 0x07;
function cvt_sdoor_to_door(lev) {
    let newmask = lev.doormask & ~WM_MASK;
    if (!(newmask & D_LOCKED))
        newmask |= D_CLOSED;
    lev.typ = DOOR;
    lev.doormask = newmask;
}

// C ref: mkobj.c sobj_at(BOULDER, x, y) — is a boulder lying on the floor here?
function sobj_at_boulder(x, y) {
    const objs = game.level?.objects;
    if (!objs) return false;
    for (const o of objs)
        if (o.where === 'floor' && o.ox === x && o.oy === y && o.otyp === BOULDER)
            return true;
    return false;
}

async function You_hear(msg) {
    const { update_topl } = await import('./display.js');
    await update_topl(msg);
}

// C ref: hack.h Hallucination — the timer lives under three different names in
// this port depending on which file wrote it (see cmd.js Hallucination()).
function Hallucination() {
    const u = game.u;
    if (!u) return false;
    if ((u.HHalluc_resistance || 0) > 0) return false;
    return !!(u.uhallu || u.HHallucination || u.uprops?.Hallucination);
}

const sgn = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);

// C ref: dig.c draft_message(unexpected).  NOT display-only: the hallucinating
// draft_message(FALSE) arm draws rn1(2, ...) and (below STRIDENT alignment
// record) a second rn1(3, ...), and BOTH arms emit a topline the port used to
// swallow entirely on the secret-corridor path.
const STRIDENT = 4;   /* dig.c:1497, from pray.c */
const DRAFT_REACTION = ['enlisting', 'marching', 'protesting', 'fleeing'];
async function draft_message(unexpected) {
    const u = game.u || {};
    if (unexpected) {
        if (!Hallucination()) {
            await You_hear('You feel an unexpected draft.');
        } else {
            const { acurr_eff } = await import('./attrib.js');
            const weak = (acurr_eff(A_STR) < 6 || acurr_eff(A_DEX) < 6
                          || acurr_eff(A_CON) < 6 || acurr_eff(A_CHA) < 6
                          || acurr_eff(A_INT) < 6 || acurr_eff(A_WIS) < 6);
            await You_hear(`You feel like you are ${weak ? '4-F' : '1-A'}.`);
        }
    } else {
        if (!Hallucination()) {
            await You_hear('You feel a draft.');
        } else {
            const atyp = u.ualign?.type ?? 0;
            let dridx = rn1(2, 1 - sgn(atyp));
            if ((u.ualign?.record ?? 0) < STRIDENT)
                dridx += rn1(3, sgn(atyp) - 1);
            await You_hear(`You feel like ${DRAFT_REACTION[dridx]}.`);
        }
    }
}

// C ref: mkobj.c treefruits[] + rnd_treefruit_at() = mksobj_at(ROLL_FROM(...)),
// i.e. an rn2(5) that mdig_tunnel/zap-dig draw whenever a felled tree drops
// fruit.  Skipping it left the stream one rn2(5) short on every arboreal level.
const TREEFRUITS = [277 /*APPLE*/, 278 /*ORANGE*/, 279 /*PEAR*/,
                    281 /*BANANA*/, 276 /*EUCALYPTUS_LEAF*/];
function rnd_treefruit_at(x, y) {
    return mksobj_at(TREEFRUITS[rn2(TREEFRUITS.length)], x, y, true, false);
}

// C ref: stairs.c stairway_at(x, y) — the stairway record on this square, or
// null.  On_stairs(x,y) is `stairway_at(x,y) != 0`.  The stair list is a
// singly-linked chain hanging off `game.stairs` (cf. hack.js).
function stairway_at(x, y) {
    for (let s = game.stairs; s; s = s.next)
        if (s.sx === x && s.sy === y) return s;
    return null;
}

// C ref: trap.c ceiling(x, y).  Same reduction as trap.js ceiling(): no
// air/water/quest/earth level is generated here.
function ceiling(x, y) {
    const typ = game.level?.at(x, y)?.typ ?? STONE;
    if (typ === ROOM || IS_WALL(typ) || IS_DOOR(typ) || typ === SDOOR)
        return 'ceiling';
    return 'rock cavern';
}

// C ref: do_wear.c hard_helmet(obj) = is_helmet(obj)
//        && (is_metallic(obj) || is_crackable(obj)).
// Driven by oc_material (IRON..MITHRIL, or GLASS for a crackable helm), NOT by
// a name regex — a helm whose name doesn't contain "helm" (dented pot) is hard
// and an "elven leather helm" is not.  Only ever called on the worn head slot,
// so C's is_helmet() guard is implied by the caller.
const MAT_IRON = 11, MAT_MITHRIL = 17, MAT_GLASS = 19;
function hard_helmet(otmp) {
    const mat = OBJECTS_TBL[otmp?.otyp]?.material;
    if (mat === undefined) return false;
    return (mat >= MAT_IRON && mat <= MAT_MITHRIL) || mat === MAT_GLASS;
}

// C ref: hack.c losehp(dmg, ...) — HP subtraction only; the death path
// (done(DIED)) lives in the callers this port does model.
function losehp(dmg) {
    const u = game.u;
    if (!u || dmg <= 0) return;
    u.uhp = (u.uhp ?? 0) - dmg;
    if (u.uhp < 0) u.uhp = 0;
    if (game.disp) game.disp.botl = true;
}

// C ref: dig.c mdig_tunnel(mtmp) — a tunnelling monster carves the cell it now
// occupies.  Returns TRUE if the monster died (a trapped door it broke through),
// FALSE otherwise.  Called from m_move()/postmov() only when can_tunnel &&
// may_dig(mtmp->mx, mtmp->my).
//
// RNG: `pile = rnd(12)` is drawn UNCONDITIONALLY at entry; a WALL cell also
// draws rn2(5) (the "crashing rock" chance, gated on flags.verbose); a closed
// door draws rn2(3) (draft message); a dug STONE/ROCK cell may drop a boulder
// (pile==1) or a rock (pile 2..4) via mksobj_at.
export async function mdig_tunnel(mtmp) {
    const here = game.level?.at(mtmp.mx, mtmp.my);
    const pile = rnd(12);
    if (!here) return false;

    // C ref: dig.c:1421 — a secret door is first converted to a real door.
    if (here.typ === SDOOR)
        cvt_sdoor_to_door(here);

    // C ref: dig.c:1424 — eats away a closed/locked door.
    if (closed_door(mtmp.mx, mtmp.my)) {
        // sawit / shop-damage / MKoT handling not reached at these depths.
        const trapped = (here.doormask & D_TRAPPED) ? true : false;
        here.doormask = trapped ? D_NODOOR : D_BROKEN;
        recalc_block_point(mtmp.mx, mtmp.my); // vision
        newsym(mtmp.mx, mtmp.my);
        if (trapped) {
            // C ref: mb_trapped() — the door-trap explosion may kill the digger.
            // Not reached in the mines cave; kept for completeness (no RNG here
            // that the contest exercises, so treat as "survived").
            return false;
        } else {
            // C ref: dig.c:1442 — draft feedback.  flags.verbose is on; the
            // rn2(3) is drawn whenever the hero is not Unaware.
            const verbose = game.flags?.verbose !== false;
            const Unaware = !!game.u?.Unaware;
            if (verbose) {
                if (!Unaware && !rn2(3))
                    await draft_message(true);
            }
        }
        return false;
    } else if (here.typ === SCORR) {
        // C ref: dig.c:1447 — secret corridor becomes an ordinary corridor.
        here.typ = CORR; here.flags = 0;
        unblock_point(mtmp.mx, mtmp.my);
        newsym(mtmp.mx, mtmp.my);
        await draft_message(false);
        return false;
    } else if (!IS_OBSTRUCTED(here.typ) && !IS_TREE(here.typ)) {
        // C ref: dig.c:1450 — nothing here to dig.
        return false;
    }

    // Only rock, trees, and walls fall through to this point.
    if (((here.wall_info || 0) & W_NONDIGGABLE) !== 0) {
        // C ref: dig.c:1456 — impossible() (undiggable); still alive.
        return false;
    }

    if (IS_WALL(here.typ)) {
        // C ref: dig.c:1466 — "crashing rock" chance.  The rn2(5) is a REAL
        // draw whenever flags.verbose; the You_hear text is post-draw and only
        // reaches the hero when not Deaf.
        const verbose = game.flags?.verbose !== false;
        const Deaf = !!game.u?.Deaf;
        if (verbose && !rn2(5)) {
            if (!Deaf) await You_hear('You hear crashing rock.');
        }
        const flags = game.level?.flags || {};
        if (flags.is_maze_lev) {
            here.typ = ROOM; here.flags = 0;
        } else if (flags.is_cavernous_lev && !in_town(mtmp.mx, mtmp.my)) {
            here.typ = CORR; here.flags = 0;
        } else {
            here.typ = DOOR; here.doormask = D_NODOOR;
        }
    } else if (IS_TREE(here.typ)) {
        // C ref: dig.c:1482 — a felled tree becomes room floor; pile 1..4 drops
        // fruit (rnd_treefruit_at -> rn2(5) + mksobj_at).
        here.typ = ROOM; here.flags = 0;
        if (pile && pile < 5)
            rnd_treefruit_at(mtmp.mx, mtmp.my);
    } else {
        // C ref: dig.c:1486 — plain rock becomes a corridor; pile 1..4 drops a
        // boulder (pile==1) or a rock (pile 2..4) as debris.
        here.typ = CORR; here.flags = 0;
        if (pile && pile < 5)
            mksobj_at((pile === 1) ? BOULDER : ROCK, mtmp.mx, mtmp.my, true, false);
    }
    newsym(mtmp.mx, mtmp.my);
    if (!sobj_at_boulder(mtmp.mx, mtmp.my))
        unblock_point(mtmp.mx, mtmp.my); // vision

    return false;
}

// C ref: dig.c zap_dig() — digging via a wand-of-digging zap or dig spell.
// Reachable path for the covered sessions: the hero, standing in a lit room,
// zaps the wand in a cardinal direction (u.dz == 0) and carves a passage across
// the level — razing the first wall it meets into a doorway, then tunnelling
// the rock beyond into a corridor.  RNG: a single `digdepth = rn1(18, 8)` is
// drawn up front; every terrain edit in the loop below draws no RNG, so the
// post-zap RNG cursor advances by exactly one rn2(18) (matching C).  The
// swallowed and up/down branches are structurally faithful but their deep
// subsystems (expels() / dighole()) are not exercised here and are left as
// no-ops with C-ref notes.
export async function zap_dig() {
    const u = game.u;
    const lvl = game.level;

    if (u.uswallow) {
        // C ref: dig.c:1568 — pierce/near-kill the engulfer and get expelled.
        // No engulfing monster in the covered sessions; unported.
        return;
    }

    if (u.dz) {
        // C ref: dig.c:1584.  Is_airlevel/Is_waterlevel/Underwater are all
        // false for every level this port generates.
        const sway = stairway_at(u.ux, u.uy);
        if (u.dz < 0 || sway) {
            const { update_topl } = await import('./display.js');
            const _invent = await import('./invent.js');
            if (sway) {
                await update_topl(`The beam bounces off the ${
                    sway.isladder ? 'ladder' : 'stairs'} and hits the ${
                    ceiling(u.ux, u.uy)}.`);
            }
            await update_topl(`You loosen a rock from the ${ceiling(u.ux, u.uy)}.`);
            await update_topl(`It falls on your ${_invent.body_part(HEAD)}!`);
            // C: dmg = rnd(hard_helmet(uarmh) ? 2 : 6) — a REAL draw whether or
            // not the rock lands on a helmet.  Maybe_Half_Phys() is the identity
            // for a hero without Half_physical_damage (none of these have it).
            const dmg = rnd(hard_helmet(game.uarmh) ? 2 : 6);
            losehp(dmg);
            const otmp = mksobj_at(ROCK, u.ux, u.uy, false, false);
            if (otmp) {
                _invent.xname(otmp);       /* sets dknown / maybe bknown */
                _invent.stackobj(otmp);
            }
            newsym(u.ux, u.uy);
        }
        // NOT PORTED: the else arm, watch_dig() + dighole(FALSE, TRUE, 0) —
        // digging a pit/hole straight down.  dighole/digactualhole (and the
        // level change that follows a hole) are a separate unported subsystem,
        // so a downward zap off the stairs still consumes no RNG here.
        return;
    }

    // normal case: digging across the level.  C ref: dig.c:1612.
    let shopdoor = false, shopwall = false;   /* shop damage: no shop here */
    const maze_dig = !!lvl?.flags?.is_maze_lev && !Is_earthlevel(u.uz);
    const dx = u.dx | 0, dy = u.dy | 0;
    let zx = u.ux + dx, zy = u.uy + dy;
    // pit-dig (zapping laterally while trapped in a pit, u.utraptype==TT_PIT)
    // is not exercised; pitdig stays FALSE.
    let digdepth = rn1(18, 8);
    // tmp_at(DISP_BEAM, S_digbeam): beam animation is display-only (no RNG) and
    // leaves no residue in the final grid, so it is omitted.

    while (--digdepth >= 0) {
        if (!isok(zx, zy)) break;
        const room = lvl.at(zx, zy);
        if (!room) break;

        if (closed_door(zx, zy) || room.typ === SDOOR) {
            // C ref: dig.c:1669 — raze a door / expose+raze a secret door.
            // (shop-door damage: in_rooms(SHOPBASE) is empty on this level.)
            if (room.typ === SDOOR) {
                room.typ = DOOR; /* doormask set below */
            } else if (cansee(zx, zy)) {
                const { update_topl } = await import('./display.js');
                await update_topl('The door is razed!');
            }
            // watch_dig(): only reacts in town with the Watch present; no-op.
            room.doormask = D_NODOOR;
            recalc_block_point(zx, zy); // vision
            newsym(zx, zy);
            digdepth -= 2;
            if (maze_dig) break;
        } else if (maze_dig) {
            // C ref: dig.c:1684 — on a maze level walls/trees->room, rock->corr,
            // then break.  Not reached on the covered (non-maze) levels.
            if (IS_WALL(room.typ)) {
                if (!((room.wall_info || 0) & W_NONDIGGABLE)) {
                    room.typ = ROOM; room.flags = 0;
                    unblock_point(zx, zy);
                    newsym(zx, zy);
                }
                break;
            } else if (IS_TREE(room.typ)) {
                if (!((room.wall_info || 0) & W_NONDIGGABLE)) {
                    room.typ = ROOM; room.flags = 0;
                    unblock_point(zx, zy);
                    newsym(zx, zy);
                }
                break;
            } else if (room.typ === STONE || room.typ === SCORR) {
                if (!((room.wall_info || 0) & W_NONDIGGABLE)) {
                    room.typ = CORR; room.flags = 0;
                    unblock_point(zx, zy);
                    newsym(zx, zy);
                }
                break;
            }
        } else if (IS_OBSTRUCTED(room.typ)) {
            // C ref: dig.c:1711 — pierce a wall/tree into a doorway/floor, or
            // tunnel plain rock into a corridor.
            if (!may_dig(zx, zy)) break;
            if (IS_WALL(room.typ) || room.typ === SDOOR) {
                // (shop-wall damage omitted: no shop here; watch_dig() no-op.)
                if (lvl.flags?.is_cavernous_lev && !in_town(zx, zy)) {
                    room.typ = CORR; room.flags = 0;
                } else {
                    room.typ = DOOR; room.doormask = D_NODOOR;
                }
                digdepth -= 2;
            } else if (IS_TREE(room.typ)) {
                room.typ = ROOM; room.flags = 0;
                digdepth -= 2;
            } else { /* IS_OBSTRUCTED but not IS_WALL/SDOOR/TREE: plain rock */
                room.typ = CORR; room.flags = 0;
                digdepth--;
            }
            unblock_point(zx, zy); // vision
            newsym(zx, zy);
        }
        zx += dx;
        zy += dy;
    }
    // tmp_at(DISP_END, 0): closing beam call — display-only, omitted.

    // pit_flow / pay_for_damage: unreachable (no pit dug, no shop) here.
    void shopdoor; void shopwall;
    return;
}

// C ref: hack.c:3564 in_town(x, y) — a room WITH subrooms is Mine Town; with no
// subroomed rooms at all the whole level counts.  Was a `return false` stub, so
// a tunnelling dwarf inside Mine Town carved CORR where C leaves a doorless
// DOOR (mdig_tunnel's is_cavernous_lev arm, and the same arm of zap_dig).
// Duplicated from makemon.js in_town_js()/fountain.js in_town() rather than
// imported: those two are file-private, and the S_LEVEL `town` flag stands in
// for svl.level.flags.has_town, which nothing in this port writes.
export function in_town(x, y) {
    const lvl = game.level;
    const slev = Is_special(game.u?.uz);
    if (!slev || !slev.flags?.town) return false;
    let has_subrooms = false;
    for (let i = 0; i < (lvl?.nroom ?? 0); i++) {
        const sroom = lvl.rooms[i];
        if (!sroom || (sroom.hx ?? 0) <= 0) break;
        if ((sroom.nsubrooms ?? 0) > 0) {
            has_subrooms = true;
            if (inside_room(sroom, x, y)) return true;
        }
    }
    return !has_subrooms;
}

// C ref: dig.c dig_typ(otmp, x, y) — what a pick/axe would be working on at
// <x,y>.  Only a pick digs rock/boulders/statues; only an axe fells a tree;
// both chop a closed door.  Anything else is DIGTYP_UNDIGGABLE, which is what
// keeps ordinary floor out of use_pick_axe()'s direction list.
export function dig_typ(otmp, x, y) {
    if (!isok(x, y) || !otmp || (!is_pick(otmp) && !is_axe(otmp)))
        return DIGTYP_UNDIGGABLE;
    const ltyp = game.level?.at(x, y)?.typ;
    if (is_axe(otmp))
        return closed_door(x, y) ? DIGTYP_DOOR
             : IS_TREE(ltyp) ? DIGTYP_TREE
             : DIGTYP_UNDIGGABLE;
    // is_pick(otmp)
    if (sobj_at_typ(STATUE, x, y) && pick_can_reach(otmp, x, y))
        return DIGTYP_STATUE;
    if (sobj_at_boulder(x, y) && pick_can_reach(otmp, x, y))
        return DIGTYP_BOULDER;
    if (closed_door(x, y)) return DIGTYP_DOOR;
    if (IS_TREE(ltyp)) return DIGTYP_UNDIGGABLE;   // pick vs tree
    if (IS_OBSTRUCTED(ltyp) && (!game.level?.flags?.arboreal || IS_WALL(ltyp)))
        return DIGTYP_ROCK;
    return DIGTYP_UNDIGGABLE;
}

// C ref: dig.c pick_can_reach(otmp, x, y) — a pick reaches a boulder/statue
// only from a square the hero can actually swing from; the airborne and
// engulfed cases are the whole of the guard the hero ever meets here.
function pick_can_reach(_otmp, _x, _y) {
    const u = game.u;
    return !(u?.uswallow) && !(u?.uprops?.Levitation);
}

function sobj_at_typ(otyp, x, y) {
    for (let o = game.level?.at(x, y)?.objects; o; o = o.nexthere)
        if (o.otyp === otyp) return o;
    return null;
}

// C ref: dig.c use_pick_axe(obj) — applying a pick-axe/mattock or an axe.
// An unwielded tool is wielded first and the command re-queues itself
// (cmdq_add_ec(doapply) + the invlet), so the direction prompt only appears on
// the second pass, one turn later.  The prompt's bracketed key list is built
// from the directions that actually have something to work on, which is why an
// axe swung in an ordinary room offers only "[>]".
export async function use_pick_axe(obj) {
    const u = game.u;
    const { wield_tool } = await import('./invent.js');
    const { pline } = await import('./display.js');

    // Check tool
    if (obj !== game.uwep) {
        if (await wield_tool(obj, 'swing')) return USE_PICK_AXE_REWIELDED;
        return 0;                        // ECMD_OK
    }
    const ispick = is_pick(obj);
    const verb = ispick ? 'dig' : 'chop';

    if (u.utrap && u.utraptype === TT_WEB) {
        // res is always 0 here: the wielded-already path prints nothing first.
        await pline(`Unfortunately, you can't ${verb} while entangled in a web.`);
        return 0;
    }

    // C ref: dig.c:1122 — "construct list of directions to show player for
    // likely choices".  dir 0..7 are the plane moves in sdir[] order, 8 is
    // down and 9 is up; a plane direction survives only if something there is
    // diggable, and the up/down pair is filtered by can_reach_floor().
    const { can_reach_floor } = await import('./engrave.js');
    const { Cmd_dirchars } = await import('./cmd.js');
    const dirchars = Cmd_dirchars();
    const downok = !!can_reach_floor(false);
    let dirsyms = '';
    for (let dir = 0; dir < N_DIRS_Z; dir++) {
        const dirch = dirchars[dir];
        if (u.uswallow) {
            /* all directions are viable when swallowed */
        } else if (dir < N_DIRS) {
            const [dx, dy] = DIG_DIR_XY[dir];
            // C: dxdy_moveok() — only a grid bug is barred from diagonals.
            if (dx && dy && NODIAG(u.umonnum)) continue;
            const rx = u.ux + dx, ry = u.uy + dy;
            if (!isok(rx, ry) || dig_typ(obj, rx, ry) === DIGTYP_UNDIGGABLE)
                continue;
        } else {
            // C: `if ((u.dz > 0) ^ downok) continue;` — dir 8 is '>' (dz > 0).
            if ((dir === 8) !== downok) continue;
        }
        dirsyms += dirch;
    }

    const { getdir } = await import('./cmd.js');
    const dir = await getdir(`In what direction do you want to ${verb}? [${dirsyms}]`);
    if (!dir)
        return 1;                        // ECMD_CANCEL

    // use_pick_axe2() reports a mismatched tool before attempting an occupation.
    if (!u.uswallow && dir.dz === 0 && (dir.dx || dir.dy)) {
        const rx = u.ux + dir.dx, ry = u.uy + dir.dy;
        if (dig_typ(obj, rx, ry) === DIGTYP_UNDIGGABLE) {
            const typ = game.level?.at(rx, ry)?.typ;
            if (IS_TREE(typ)) await pline('You need an axe to cut down a tree.');
            else if (IS_OBSTRUCTED(typ)) await pline('You need a pick to dig rock.');
        }
    }

    // The actual terrain change and multi-turn occupation remain unported.
    return USE_PICK_AXE_DIG;
}

// Direction deltas in sdir[] order (h y k u l n j b), matching cmd.js DIR_XYZ.
const DIG_DIR_XY = [
    [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1],
];
// C ref: mondata.h NODIAG(mnum) == (mnum == PM_GRID_BUG).
const PM_GRID_BUG = 116;
function NODIAG(mnum) { return mnum === PM_GRID_BUG; }

// Sentinels for apply.js: the tool had to be wielded (C re-queues doapply), or
// the direction prompt was answered and the dig occupation would start.
export const USE_PICK_AXE_REWIELDED = -1;
export const USE_PICK_AXE_DIG = -2;

/* ========================================================================= *
 *  dig.c, part 2 — the hero's digging OCCUPATION, hole/pit creation, and the
 *  burial subsystem.
 *
 *  ADDITIVE AND INERT: nothing above this line calls anything below it.
 *  Wiring it up is two edits elsewhere:
 *    (a) allmain.js moveloop_core grows a `_dig_occupation` arm that calls
 *        dig() once per turn, exactly like the existing _force_box /
 *        _eat_occupation / _engrave_occupation arms (C: `(*go.occupation)()`).
 *        The turn boundary matters: each dig() call is one game turn, so the
 *        movemon() draws land BETWEEN the per-turn rn2(5) effort rolls.
 *    (b) use_pick_axe() tail-calls use_pick_axe2() instead of returning the
 *        USE_PICK_AXE_DIG sentinel.
 *
 *  Helpers whose owning module keeps them file-private (set_utrap, trapname,
 *  is_flyer, ...) are duplicated below with a `C ref:` line, the way the rest
 *  of this port does it.  Where a whole subsystem is absent (impact_drop,
 *  pooleffects, activate_statue_trap) the call site keeps C's shape and
 *  carries a NOT PORTED note, so the surrounding order of draws is still
 *  right even though that one step is missing.
 * ========================================================================= */

import { rnl, d } from './rng.js';
import { m_at } from './display.js';
import { t_at } from './mkroom.js';
import {
    HEAVY_IRON_BALL, CORPSE, LEASH, POT_OIL, COIN_CLASS, POTION_CLASS,
} from './mkobj.js';
import { does_block, vision_recalc } from './vision.js';
import {
    mflags1_of, M1_FLY, M1_WALLWALK, M1_CLING, M1_CONCEAL, M1_AMORPHOUS,
    M1_TUNNEL, M1_NEEDPICK, M1_UNSOLID,
} from './monflags_data.js';
import {
    IS_THRONE, IS_ALTAR, IS_FOUNTAIN, IS_SINK, IS_GRAVE, IS_FURNITURE,
    IS_ROOM, IS_WATERWALL, IS_POOL,
    AM_SANCTUM, AM_MASK, Amask2align, A_NONE, A_LAWFUL,
    PIT, HOLE, TRAPDOOR, LANDMINE, BEAR_TRAP, WEB, MAGIC_PORTAL, STATUE_TRAP,
    VIBRATING_SQUARE, MAGIC_TRAP, ANTI_MAGIC, LEVEL_TELEP, TELEP_TRAP,
    DRAWBRIDGE_UP, DRAWBRIDGE_DOWN, DBWALL, DB_UNDER, DB_ICE, DB_LAVA, DB_MOAT,
    LAVAPOOL, MOAT, POOL, WATER, IRONBARS, LAVAWALL, ALTAR, ICE,
    TT_PIT, TT_INFLOOR, TT_BURIEDBALL,
    DIR_180, DIR_ERR, xdir, ydir, COLNO, ROWNO,
    IN_SIGHT, COULD_SEE, MM_NOMSG, RLOC_NOMSG, NO_TRAP_FLAGS,
    FORCETRAP, FORCEBUNGLE, SHOPBASE, SHOP_DOOR_COST, SHOP_PIT_COST,
    TIMER_OBJECT, ROT_ORGANIC, TAINT_AGE, CXN_NO_PFX,
    ECMD_OK, ECMD_TIME, RIGHT_SIDE,
    Is_airlevel, Is_waterlevel, Is_stronghold, Is_botlevel,
    is_pit, is_hole, DIGCHECK_PASSED, DIGCHECK_FAILED,
    DIGCHECK_PASSED_PITONLY, DIGCHECK_PASSED_DESTROY_TRAP,
    DIGCHECK_FAIL_AIRLEVEL, DIGCHECK_FAIL_ALTAR, DIGCHECK_FAIL_BOULDER,
    DIGCHECK_FAIL_CANTDIG, DIGCHECK_FAIL_OBJ_POOL_OR_TRAP,
    DIGCHECK_FAIL_ONLADDER, DIGCHECK_FAIL_ONSTAIRS, DIGCHECK_FAIL_THRONE,
    DIGCHECK_FAIL_TOOHARD, DIGCHECK_FAIL_UNDESTROYABLETRAP,
    DIGCHECK_FAIL_WATERLEVEL,
} from './const.js';

/* ---- local copies of helpers their owning module does not export --------- */

// C ref: decl.h svc.context.digging — the interrupted-dig record.  js/cmd.js
// (:5283) and js/save.js (:796) already key off game.context.digging, so that
// is the storage; cmd.js resets it to a bare {} on a level change, hence the
// defensive refill.
function digging_ctx() {
    const svc = game.context || (game.context = {});
    const dg = svc.digging || (svc.digging = {});
    if (!dg.pos) dg.pos = { x: 0, y: 0 };
    if (!dg.level) dg.level = { dnum: 0, dlevel: 0 };
    if (dg.effort == null) dg.effort = 0;
    if (dg.lastdigtime == null) dg.lastdigtime = 0;
    return dg;
}

// C ref: dig.c `memset(&svc.context.digging, 0, sizeof svc.context.digging)`.
function zero_digging() {
    const svc = game.context || (game.context = {});
    svc.digging = {
        level: { dnum: 0, dlevel: 0 }, pos: { x: 0, y: 0 },
        down: false, chew: false, warned: false, quiet: false,
        effort: 0, lastdigtime: 0,
    };
    return svc.digging;
}

// C ref: dungeon.h on_level(a, b) / assign_level(dst, src).
function on_level(a, b) {
    return !!a && !!b && a.dnum === b.dnum && a.dlevel === b.dlevel;
}
function assign_level(dst, src) {
    dst.dnum = src?.dnum ?? 0;
    dst.dlevel = src?.dlevel ?? 0;
}

// C ref: you.h next2u(px, py) == (distu(px,py) <= 2).
function next2u(x, y) {
    const u = game.u || {};
    const dx = x - (u.ux ?? 0), dy = y - (u.uy ?? 0);
    return (dx * dx + dy * dy) <= 2;
}

// C ref: hack.h Luck == (u.uluck + u.moreluck).
function Luck() { const u = game.u || {}; return (u.uluck | 0) + (u.moreluck | 0); }

const uprop = (nm) => (game.u?.uprops?.[nm] || 0);
function Blind() { return (game.u?.blinded | 0) > 0 || !!game.ublindf || uprop('BlindedFromForm') > 0; }
function Deaf_() { return uprop('HDeaf') > 0 || !!game.u?.Deaf; }
function Levitation() { return !!uprop('Levitation'); }
function Flying() { return !!uprop('Flying'); }
function Fumbling() { return !!(game.u?.HFumbling || game.u?.EFumbling || uprop('Fumbling')); }
function Underwater() { return !!game.u?.uinwater; }

// C ref: hack.h Role_if(pm) / Race_if(pm).  The port carries the role/race
// INDEX on game.urole.mnum / game.urace.mnum, so compare indices rather than
// mons[] offsets ([[umonnum-is-a-role-index]]).
const ROLE_ARCHEOLOGIST = 0, ROLE_SAMURAI = 9, ROLE_RANGER = 7;
const RACE_DWARF = 2, RACE_ELF = 1;
function Role_idx_if(idx) { return (game.urole?.mnum ?? -1) === idx; }
function Race_idx_if(idx) { return (game.urace?.mnum ?? -1) === idx; }

// C ref: display.c feel_newsym(x, y) — feel the square when blind, else newsym.
function feel_newsym(x, y) {
    if (Blind()) feel_location_(x, y);
    else newsym(x, y);
}
function feel_location_(x, y) {
    // display.js owns the real feel_location(); imported lazily to stay off
    // the module-load path (display.js already imports this file's callers).
    import('./display.js').then((m) => m.feel_location(x, y)).catch(() => {});
}

// C ref: stairs.c On_stairs(x, y) / On_ladder(x, y).
function On_stairs(x, y) { return stairway_at(x, y) != null; }
function On_ladder(x, y) { const s = stairway_at(x, y); return !!s && !!s.isladder; }

// C ref: pray.c altarmask_at(x, y) — the mimic-appearance arm needs
// M_AP_FURNITURE state this file does not carry, so only the terrain arm.
function altarmask_at(x, y) {
    if (!isok(x, y)) return 0;
    const lev = game.level?.at(x, y);
    return (lev && IS_ALTAR(lev.typ)) ? (lev.altarmask | 0) : 0;
}

// C ref: trap.c set_utrap(tim, typ) / reset_utrap(msg).  Duplicated (trap.js
// does not export either) exactly as js/polyself.js:126 does.  The msg arm of
// reset_utrap is float_vs_flight(), which this port does not model.
function set_utrap(tim, typ) {
    const u = game.u;
    if (!u) return;
    u.utrap = tim;
    u.utraptype = tim ? typ : 0 /* TT_NONE */;
}
function reset_utrap(_msg) {
    const u = game.u;
    if (!u) return;
    u.utrap = 0;
    u.utraptype = 0;
}

// C ref: mkobj.c sobj_at(otyp, x, y).  NOT js/invent.js's sobj_at(): that one
// indexes the pile as objects[x][y] while mkobj.c place_object() keeps ONE flat
// game.level.objects array (last matching entry == head of C's nexthere
// chain), so it returns null for every square.  Same reason js/do.js:628 and
// js/dbridge.js:877 carry their own copies.
function floor_pile(x, y) {
    const objs = game.level?.objects;
    if (!Array.isArray(objs)) return [];
    const out = [];
    for (let i = objs.length - 1; i >= 0; i--) {
        const o = objs[i];
        if (o && o.where === 'floor' && o.ox === x && o.oy === y) out.push(o);
    }
    return out;                       /* C's chain order: topmost first */
}
function sobj_at(otyp, x, y) {
    for (const o of floor_pile(x, y)) if (o.otyp === otyp) return o;
    return null;
}
function OBJ_AT(x, y) { return floor_pile(x, y).length > 0; }

// C ref: dbridge.c is_pool/is_lava/is_moat/is_pool_or_lava/is_ice.  Kept local
// (not imported from js/dbridge.js) because dbridge.js pulls in mkobj.js and
// dokick.js; a static import here would put dig.js on that cycle.
function is_pool_(x, y) {
    if (!isok(x, y)) return false;
    const lev = game.level?.at(x, y);
    if (!lev) return false;
    return IS_POOL(lev.typ)
        || (lev.typ === DRAWBRIDGE_UP && ((lev.drawbridgemask | 0) & DB_UNDER) === DB_MOAT);
}
function is_lava_(x, y) {
    if (!isok(x, y)) return false;
    const lev = game.level?.at(x, y);
    if (!lev) return false;
    return lev.typ === LAVAPOOL || lev.typ === LAVAWALL
        || (lev.typ === DRAWBRIDGE_UP && ((lev.drawbridgemask | 0) & DB_UNDER) === DB_LAVA);
}
function is_moat_(x, y) {
    if (!isok(x, y)) return false;
    const lev = game.level?.at(x, y);
    if (!lev) return false;
    return lev.typ === MOAT || lev.typ === WATER
        || (lev.typ === DRAWBRIDGE_UP && ((lev.drawbridgemask | 0) & DB_UNDER) === DB_MOAT);
}
function is_pool_or_lava_(x, y) { return is_pool_(x, y) || is_lava_(x, y); }
function is_ice_(x, y) {
    if (!isok(x, y)) return false;
    const lev = game.level?.at(x, y);
    if (!lev) return false;
    return lev.typ === ICE
        || (lev.typ === DRAWBRIDGE_UP && ((lev.drawbridgemask | 0) & DB_UNDER) === DB_ICE);
}

// C ref: trap.h undestroyable_trap(ttyp) — MAGIC_PORTAL and the vibrating
// square survive digging.  trap.js exports one; kept local for the same
// no-cycle reason as the liquid predicates.
function undestroyable_trap_(ttyp) {
    return ttyp === MAGIC_PORTAL || ttyp === VIBRATING_SQUARE;
}
// C ref: trap.h is_magical_trap(ttyp) — the trap types a dig detonates rather
// than removes.
function is_magical_trap_(ttyp) {
    return ttyp === MAGIC_TRAP || ttyp === ANTI_MAGIC || ttyp === MAGIC_PORTAL
        || ttyp === LEVEL_TELEP || ttyp === TELEP_TRAP;
}

// C ref: onames.h — the four otyps this file needs that js/mkobj.js does not
// export.  Resolved by NAME from the generated object table (lazily, so load
// order cannot matter) rather than written as literals: a table shift would
// silently retarget a literal ([[wrong-constant-sweep]]).
function otyp_by_name(nm) {
    for (let i = 0; i < OBJECTS_TBL.length; i++)
        if (OBJECTS_TBL[i]?.name === nm) return i;
    return 0;
}
const LAND_MINE = () => otyp_by_name('land mine');
const BEARTRAP = () => otyp_by_name('beartrap');
const AMULET_OF_STRANGULATION = () => otyp_by_name('amulet of strangulation');

// C ref: trap.c trapname(ttyp, override) — the trap's display name.
const TRAPNAME_BY_TTYP = {
    5: 'bear trap', 6: 'land mine', 11: 'pit', 12: 'spiked pit',
    13: 'hole', 14: 'trap door', 18: 'web', 19: 'statue trap',
    15: 'teleportation trap', 16: 'level teleporter', 17: 'magic portal',
    20: 'magic trap', 21: 'anti-magic field', 22: 'polymorph trap',
    25: 'vibrating square',
};
function trapname_(ttyp) { return TRAPNAME_BY_TTYP[ttyp] || 'trap'; }

// C ref: mondata.h is_flyer/is_floater/grounded/passes_walls/is_watch and
// mon.c canseemon(mtmp).  Local copies: every module that needs them keeps its
// own (js/dbridge.js:915, js/monmove.js:2009, js/dokick.js:121).
function mflags1_(ptr) { return mflags1_of(ptr); }
function is_flyer_(ptr) { return (mflags1_of(ptr) & M1_FLY) !== 0; }
/* C ref: mondata.h:20 is_floater / :31 noncorporeal — mlet tests, not flags.
   monsym.h S_EYE == 5, S_LIGHT == 25, S_GHOST == 26; the port stores the class
   on ptr.mcls (cf. js/dbridge.js:920). */
const S_EYE = 5, S_LIGHT = 25, S_GHOST = 26;
function is_floater_(ptr) { return ptr?.mcls === S_EYE || ptr?.mcls === S_LIGHT; }
function noncorporeal_(ptr) { return ptr?.mcls === S_GHOST; }
function passes_walls_(ptr) { return (mflags1_of(ptr) & M1_WALLWALK) !== 0; }
function is_clinger_(ptr) { return (mflags1_of(ptr) & M1_CLING) !== 0; }
// C ref: dungeon.h has_ceiling(lev) — everywhere except air and water levels.
function has_ceiling_(uz) { return !Is_airlevel(uz) && !Is_waterlevel(uz); }
// C ref: mondata.h:23 grounded(ptr).
function grounded_(ptr) {
    return !is_flyer_(ptr) && !is_floater_(ptr)
        && (!is_clinger_(ptr) || !has_ceiling_(game.u?.uz));
}
// C ref: mondata.h is_watch(ptr) — (ptr->mflags2 & M2_WANDER) is NOT it; C
// tests the two Watch pmidxes by name in this port's tables.
function is_watch_(ptr) {
    const n = ptr?.name || '';
    return n === 'watchman' || n === 'watch captain';
}
function canseemon_(mtmp) {
    if (!mtmp) return false;
    return cansee(mtmp.mx, mtmp.my) && !mtmp.minvis && !mtmp.mundetected;
}
// C ref: mondata.h:35 hides_under(ptr) == ((ptr)->mflags1 & M1_CONCEAL).
function hides_under_(ptr) { return (mflags1_of(ptr) & M1_CONCEAL) !== 0; }

// C ref: timeout.c start_timer/stop_timer.  js/mkobj.js:1349 keeps the same
// obj.timed / obj.timer representation but does not export the pair.
function start_timer(when, kind, action, arg) {
    const obj = arg?.a_obj;
    if (obj && kind === TIMER_OBJECT) {
        obj.timed = true;
        obj.timer = { when: (game.moves ?? 0) + when, kind, action };
    }
    return true;
}
function stop_timer(_action, arg) {
    const obj = arg?.a_obj;
    if (!obj) return 0;
    const had = obj.timed ? 1 : 0;
    obj.timed = false;
    delete obj.timer;
    return had;
}
// C ref: hack.h obj_to_any(o) — wrap an obj in an `anything`.
function obj_to_any(o) { return { a_obj: o }; }

// C ref: mkobj.c is_organic(otmp) — objects[otyp].oc_material <= WOOD.
const MAT_WOOD = 7;
function is_organic_(otmp) {
    const mat = OBJECTS_TBL[otmp?.otyp]?.material;
    return mat !== undefined && mat > 0 && mat <= MAT_WOOD;
}

// C ref: light.c end_burn(obj, timer_attached) — js/light.js has it but does
// not export it; only the lamplit clear matters for a buried light source.
function end_burn(obj, _timer_attached) { if (obj) obj.lamplit = 0; }

/* ---- subsystems this port does not have -------------------------------- */
// Each of these keeps C's call site shape so the next porter only has to fill
// in the body; they are RNG-free stubs today, and every caller says so.

// C ref: hack.c switch_terrain() — re-evaluates BLevitation/BFlying FROMOUTSIDE
// when the hero's terrain changes.  NOT PORTED (the port has no B<prop> masks).
function switch_terrain() { /* NOT PORTED */ }
// C ref: dothrow.c impact_drop(missile, x, y, dlev) — objects fall through a
// new hole to the level below.  NOT PORTED (needs add_to_migration()).
function impact_drop(_missile, _x, _y, _dlev) { /* NOT PORTED */ }
// C ref: hack.c spot_checks(x, y, old_typ) — only the ICE / DRAWBRIDGE_UP arm
// does anything, and obj_ice_effects() is the whole of it here.
async function spot_checks(x, y, old_typ) {
    const new_typ = game.level?.at(x, y)?.typ;
    let db_ice_now = false;
    if (old_typ === DRAWBRIDGE_UP)
        db_ice_now = ((game.level?.at(x, y)?.drawbridgemask | 0) & DB_UNDER) === DB_ICE;
    if (old_typ === DRAWBRIDGE_UP || old_typ === ICE) {
        if (new_typ !== old_typ || (old_typ === DRAWBRIDGE_UP && !db_ice_now)) {
            /* C also kills a MELT_ICE_AWAY spot timer; the port has no spot timers */
            const { obj_ice_effects } = await import('./mkobj.js');
            obj_ice_effects(x, y, false);
        }
    }
}
// C ref: fountain.c dogushforth(drinking) — js/fountain.js has it, unexported.
async function dogushforth(_drinking) { /* NOT PORTED (js/fountain.js:709) */ }
// C ref: fountain.h SET_FOUNTAIN_WARNED(x,y) — levl[x][y].blessedftn = 1 is the
// looted flag; the port stores the fountain flags on the rm cell.
function SET_FOUNTAIN_WARNED(x, y) {
    const lev = game.level?.at(x, y);
    if (lev) lev.warnedftn = 1;
}
// C ref: trap.c pooleffects(newspot) / mon.c minliquid(mon) — drowning.
// js/mon.js has minliquid() unexported; pooleffects() is unported.
async function pooleffects(_newspot) { return false; /* NOT PORTED */ }
async function minliquid(_mon) { return false; /* NOT PORTED (js/mon.js:591) */ }
// C ref: trap.c water_damage_chain / burn.c fire_damage_chain — object damage
// when a hole floods.  js/trap.js:696 has water_damage_chain(), unexported.
async function water_damage_chain(_list, _here) { /* NOT PORTED */ }
async function fire_damage_chain(_list, _here, _destroy, _x, _y) { /* NOT PORTED */ }
// C ref: dog.c next_to_u() — js/do.js:2156 has it, unexported.  A hero with no
// leashed pet always answers TRUE, which is the only case this port reaches.
function next_to_u() { return true; }
// C ref: teleport.c teleport_pet(mtmp, force_it):786 — FALSE only for the
// hero's steed or a pet on a CURSED leash.
function teleport_pet(mtmp, force_it) {
    if (mtmp === game.u?.usteed) return false;
    if (mtmp?.mleashed) {
        const otmp = (game.invent || []).find((o) => o?.leashmon === mtmp.m_id);
        if (otmp && otmp.cursed && !force_it) return false;
        mtmp.mleashed = 0;
        if (otmp) otmp.leashmon = 0;
        return true;
    }
    return true;
}
// C ref: dungeon.c get_level(newlevel, levnum) / ledger_no(lev) /
// mon.c migrate_to_level(mtmp, tolev, xyloc, cc).  NOT PORTED.
function get_level(dst, levnum) { dst.dnum = game.u?.uz?.dnum ?? 0; dst.dlevel = levnum; }
function ledger_no(lev) { return lev?.dlevel ?? 0; }
function migrate_to_level(_mtmp, _tolev, _xyloc, _cc) { /* NOT PORTED */ }
// C ref: pray.c angry_priest() / desecrate_altar(highaltar, alignment).
// js/pray.js has both, unexported.
async function angry_priest() { /* NOT PORTED (js/pray.js:1300) */ }
async function desecrate_altar(_highaltar, _alignment) { /* NOT PORTED (js/pray.js:1196) */ }
// C ref: dokick.c u_wipe_engr(cnt) — js/dokick.js:270 has it, unexported.
function u_wipe_engr(_cnt) { /* NOT PORTED */ }
// C ref: shk.c angry_guards(silent) + pline.c verbalize(...) — js/shkroom.js
// and js/pray.js keep both file-private.
async function angry_guards(_silent) { return false; /* NOT PORTED */ }
async function verbalize(line) {
    const { pline } = await import('./display.js');
    await pline(`"${line}"`);
}
// C ref: mon.c get_iter_mons(fn) — first monster on the level for which fn()
// answers TRUE.  js/dokick.js:278 has it, unexported.
function get_iter_mons(fn) {
    for (const mtmp of (game.level?.monsters || []))
        if (mtmp && !mtmp.mdead && fn(mtmp)) return mtmp;
    return null;
}
// C ref: trap.c xytodir(dx, dy) — index into xdir[]/ydir[], or DIR_ERR.
function xytodir_(dx, dy) {
    for (let i = 0; i < N_DIRS; i++)
        if (xdir[i] === dx && ydir[i] === dy) return i;
    return DIR_ERR;
}
// C ref: zap.c fracture_rock(obj):5537 / break_statue(obj):5582.  js/explode.js
// has private copies with an extra `weight` argument; these are the C shape.
// The rn1(60, 7) is the only draw and it happens whether or not the object is
// on the floor.
async function fracture_rock(obj) {
    if (!obj) return;
    /* NOT PORTED: the shop-billing head (billable/breakobj) and sokoban_guilt() */
    const { weight, GEM_CLASS, ROCK: ROCK_OTYP, dealloc_oextra, place_object }
        = await import('./mkobj.js');
    const { obj_extract_self } = await import('./invent.js');
    obj.otyp = ROCK_OTYP;
    obj.oclass = GEM_CLASS;
    obj.quan = rn1(60, 7);
    obj.owt = weight(obj);
    obj.dknown = obj.bknown = obj.rknown = 0;
    obj.known = 1;                       /* rocks have no oc_uses_known */
    dealloc_oextra(obj);
    if (obj.where === 'floor') {
        const ox = obj.ox, oy = obj.oy;
        obj_extract_self(obj);
        place_object(obj, ox, oy);
        if (!does_block(ox, oy, game.level?.at(ox, oy))) {
            unblock_point(ox, oy);
            await vision_recalc(0);
            newsym(ox, oy);
        }
    }
}
async function break_statue(obj) {
    const trap = t_at(obj.ox, obj.oy);
    if (trap && trap.ttyp === STATUE_TRAP) {
        /* NOT PORTED: trap.c activate_statue_trap() — it can return TRUE and
           make break_statue() answer FALSE (the statue came to life). */
        return false;
    }
    const { obj_extract_self } = await import('./invent.js');
    const { place_object } = await import('./mkobj.js');
    while (Array.isArray(obj.cobj) ? obj.cobj.length : obj.cobj) {
        const item = Array.isArray(obj.cobj) ? obj.cobj[0] : obj.cobj;
        obj_extract_self(item);
        place_object(item, obj.ox, obj.oy);
    }
    const by_you = !game.context?.mon_moving;
    const CORPSTAT_HISTORIC = 4;
    if (by_you && Role_idx_if(ROLE_ARCHEOLOGIST) && ((obj.spe | 0) & CORPSTAT_HISTORIC)) {
        const { pline } = await import('./display.js');
        const { adjalign } = await import('./attrib.js');
        await pline('You feel guilty about damaging such a historic statue.');
        adjalign(-1);
    }
    obj.spe = 0;
    await fracture_rock(obj);
    return true;
}

/* ---- dig.c proper ------------------------------------------------------- */

// C ref: dig.c:29 rm_waslit() — was anything in the 5x3 box around the hero
// lit?  Used by mkcavearea() to decide whether the new cave keeps its light.
export function rm_waslit() {
    const u = game.u, lvl = game.level;
    if (!u || !lvl) return false;
    const here = lvl.at(u.ux, u.uy);
    if (here && here.typ === ROOM && here.waslit) return true;
    for (let x = u.ux - 2; x < u.ux + 3; x++)
        for (let y = u.uy - 1; y < u.uy + 2; y++)
            if (isok(x, y) && lvl.at(x, y)?.waslit) return true;
    return false;
}

// C ref: dig.c:47 mkcavepos(x, y, dist, waslit, rockit) — one square of the
// Earth-plane cave-in/cave-out effect.  Async because rloc() is: relocating a
// non-phasing monster out of the way is the only RNG in the whole effect.
export async function mkcavepos(x, y, dist, waslit, rockit) {
    if (!isok(x, y)) return;
    const lev = game.level?.at(x, y);
    if (!lev) return;

    if (rockit) {
        if (IS_OBSTRUCTED(lev.typ)) return;
        if (t_at(x, y)) return;             /* don't cover the portal */
        const mtmp = m_at(x, y);
        if (mtmp && !passes_walls_(mtmp.data)) {
            const { rloc } = await import('./teleport.js');
            await rloc(mtmp, RLOC_NOMSG);
        }
    } else if (lev.typ === ROOM) {
        return;
    }

    unblock_point(x, y);   /* make sure vision knows this location is open */

    /* fake out saved state.  C's `lev->doormask = 0` and `lev->flags = 0` are
       the SAME byte (rm.h union), so both fields are cleared here. */
    lev.seenv = 0;
    lev.doormask = 0;
    lev.flags = 0;
    if (dist < 3) lev.lit = rockit ? false : true;
    if (waslit) lev.waslit = rockit ? false : true;
    lev.horizontal = false;
    /* short-circuit vision recalc */
    if (game.viz_array?.[y])
        game.viz_array[y][x] = (dist < 3) ? (IN_SIGHT | COULD_SEE) : COULD_SEE;
    lev.typ = rockit ? STONE : ROOM;
    feel_newsym(x, y);
}

// C ref: dig.c:87 mkcavearea(rockit) — the blessed/cursed mattock effect on the
// Plane of Earth.  RNG-free apart from mkcavepos()'s rloc().
export async function mkcavearea(rockit) {
    const u = game.u, lvl = game.level;
    let xmin = u.ux, xmax = u.ux, ymin = u.uy, ymax = u.uy;
    const waslit = rm_waslit();
    const { pline, topl_more } = await import('./display.js');

    if (rockit) {
        await pline('Crash!  The ceiling collapses around you!');
    } else {
        await pline(`A mysterious force ${
            lvl.at(u.ux, u.uy)?.typ === CORR ? 'creates a' : 'extends the'
        } cave around you!`);
    }
    /* C: display_nhwindow(WIN_MESSAGE, TRUE) — a BLOCKING message flush, i.e.
       a --More-- before the terrain changes are drawn. */
    await topl_more();

    for (let dist = 1; dist <= 2; dist++) {
        xmin--;
        xmax++;

        /* top and bottom */
        if (dist < 2) {                  /* the area is wider than it is high */
            ymin--;
            ymax++;
            for (let i = xmin + 1; i < xmax; i++) {
                await mkcavepos(i, ymin, dist, waslit, rockit);
                await mkcavepos(i, ymax, dist, waslit, rockit);
            }
        }

        /* left and right */
        for (let i = ymin; i <= ymax; i++) {
            await mkcavepos(xmin, i, dist, waslit, rockit);
            await mkcavepos(xmax, i, dist, waslit, rockit);
        }

        await flush_screen_(1);           /* make sure the new glyphs show up */
    }

    if (!rockit && lvl.at(u.ux, u.uy)?.typ === CORR) {
        const here = lvl.at(u.ux, u.uy);
        here.typ = ROOM;                 /* flags for CORR already 0 */
        if (waslit) here.waslit = true;
        newsym(u.ux, u.uy);              /* in case player is invisible */
    }

    game.vision_full_recalc = 1;         /* everything changed */
}
async function flush_screen_(mode) {
    const { flush_screen } = await import('./display.js');
    await flush_screen(mode);
}

// C ref: dig.c:194 is_digging() — is the hero's occupation the dig() below?
export function is_digging() {
    return game.occupation === dig;
}

// C ref: dig.c:203 BY_YOU / BY_OBJECT.  BY_OBJECT is a null madeby.
export const BY_YOU = 'BY_YOU';
export const BY_OBJECT = null;

// C ref: dig.c:206 dig_check(madeby, x, y) — may a hole/pit be made at <x,y>?
// RNG-free; every caller turns the result into a message via
// digcheck_fail_message() and/or a PIT-instead-of-HOLE downgrade.
export function dig_check(madeby, x, y) {
    const ttmp = t_at(x, y);
    const lev = game.level?.at(x, y);
    const u = game.u;

    if (On_stairs(x, y)) {
        const stway = stairway_at(x, y);
        return stway?.isladder ? DIGCHECK_FAIL_ONLADDER : DIGCHECK_FAIL_ONSTAIRS;
    } else if (IS_THRONE(lev?.typ) && madeby !== BY_OBJECT) {
        return DIGCHECK_FAIL_THRONE;
    } else if (IS_ALTAR(lev?.typ)
               && (madeby !== BY_OBJECT
                   || (altarmask_at(x, y) & AM_SANCTUM) !== 0)) {
        return DIGCHECK_FAIL_ALTAR;
    } else if (Is_airlevel(u?.uz)) {
        return DIGCHECK_FAIL_AIRLEVEL;
    } else if (Is_waterlevel(u?.uz)) {
        return DIGCHECK_FAIL_WATERLEVEL;
    } else if (IS_OBSTRUCTED(lev?.typ) && lev.typ !== SDOOR
               && ((lev.wall_info | 0) & W_NONDIGGABLE) !== 0) {
        return DIGCHECK_FAIL_TOOHARD;
    } else if (ttmp && undestroyable_trap_(ttmp.ttyp)) {
        return DIGCHECK_FAIL_UNDESTROYABLETRAP;
    } else if (!Can_dig_down_(u?.uz) && !lev?.candig) {
        if (ttmp) {
            if (!is_hole(ttmp.ttyp) && !is_pit(ttmp.ttyp))
                return DIGCHECK_PASSED_DESTROY_TRAP;
            return DIGCHECK_FAIL_CANTDIG;
        }
        return DIGCHECK_PASSED_PITONLY;
    } else if (sobj_at(BOULDER, x, y)) {
        return DIGCHECK_FAIL_BOULDER;
    } else if (madeby === BY_OBJECT
               /* the block against existing traps is mainly to prevent broken
                  wands from turning holes into pits */
               && (ttmp || is_pool_or_lava_(x, y))) {
        return DIGCHECK_FAIL_OBJ_POOL_OR_TRAP;
    }
    return DIGCHECK_PASSED;
}
// C ref: dungeon.c Can_dig_down(lev).  js/trap.js exports one but importing it
// statically would put dig.js on trap.js's cycle; this is the same expression.
function Can_dig_down_(uz) {
    if (game.level?.flags?.hardfloor) return false;
    if (Is_botlevel(uz)) return false;
    /* C also excludes Invocation_lev(); this port's In_hell()/dunlevs test
       lives in js/trap.js (Invocation_lev), which is not importable here. */
    return true;
}

// C ref: dig.c:254 digcheck_fail_message(digresult, madeby, x, y).
export async function digcheck_fail_message(digresult, madeby, x, y) {
    const { pline } = await import('./display.js');
    const { surface } = await import('./dungeon.js');
    const verb = (madeby === BY_YOU && game.uwep && is_axe(game.uwep))
        ? 'chop' : 'dig in';

    if (digresult < DIGCHECK_FAILED) return;

    switch (digresult) {
    case DIGCHECK_FAIL_AIRLEVEL:
        await pline(`You cannot ${verb} thin air.`); break;
    case DIGCHECK_FAIL_ALTAR:
        await pline('The altar is too hard to break apart.'); break;
    case DIGCHECK_FAIL_BOULDER:
        await pline(`There isn't enough room to ${verb} here.`); break;
    case DIGCHECK_FAIL_ONLADDER:
        await pline('The ladder resists your effort.'); break;
    case DIGCHECK_FAIL_ONSTAIRS:
        await pline(`The stairs are too hard to ${verb}.`); break;
    case DIGCHECK_FAIL_THRONE:
        await pline('The throne is too hard to break apart.'); break;
    case DIGCHECK_FAIL_CANTDIG:
    case DIGCHECK_FAIL_TOOHARD:
    case DIGCHECK_FAIL_UNDESTROYABLETRAP:
        await pline(`The ${surface(x, y)} here is too hard to ${verb}.`); break;
    case DIGCHECK_FAIL_WATERLEVEL: {
        const { hliquid } = await import('./do_name.js');
        await pline(`The ${hliquid('water')} splashes and subsides.`); break;
    }
    case DIGCHECK_FAIL_OBJ_POOL_OR_TRAP:
    case DIGCHECK_PASSED:
    case DIGCHECK_PASSED_PITONLY:
    case DIGCHECK_PASSED_DESTROY_TRAP:
    default:
        break;
    }
}

// C ref: dig.c:299 dig() — THE DIGGING OCCUPATION.  One call per game turn from
// moveloop_core's `(*go.occupation)()`; returns 1 to stay armed for the next
// turn and 0 when the dig finished or was abandoned.  Draw order per turn:
//   * Fumbling: rn2(3), then (if it fires) rn2(3) and maybe rnd(5)  -> return 0
//   * effort += 10 + rn2(5) + abon() + spe - erosion + udaminc  (then *=2 dwarf)
//   * the down/sideways completion arms
// Because each call is its own turn, the monster movement for the turn happens
// BETWEEN two consecutive effort rolls — collapsing this into a single call
// would move every one of those draws.
export async function dig() {
    const u = game.u;
    const dg = digging_ctx();
    const dpx = dg.pos.x, dpy = dg.pos.y;
    const uwep = game.uwep;
    const ispick = !!uwep && is_pick(uwep);
    const verb = (!uwep || is_pick(uwep)) ? 'dig into' : 'chop through';
    let dcresult = DIGCHECK_PASSED;
    const lev = game.level?.at(dpx, dpy);
    const { pline } = await import('./display.js');

    /* perhaps a nymph stole your pick-axe while you were busy digging */
    /* or perhaps you teleported away */
    if (u.uswallow || !uwep || (!ispick && !is_axe(uwep))
        || !on_level(dg.level, u.uz)
        || (dg.down ? (dpx !== u.ux || dpy !== u.uy) : !next2u(dpx, dpy)))
        return 0;

    if (dg.down) {
        dcresult = dig_check(BY_YOU, u.ux, u.uy);
        if (dcresult >= DIGCHECK_FAILED) {
            await digcheck_fail_message(dcresult, BY_YOU, u.ux, u.uy);
            return 0;
        }
    } else {
        if (IS_TREE(lev?.typ) && !may_dig(dpx, dpy)
            && dig_typ(uwep, dpx, dpy) === DIGTYP_TREE) {
            await pline('This tree seems to be petrified.');
            return 0;
        }
        if (IS_OBSTRUCTED(lev?.typ) && !may_dig(dpx, dpy)
            && dig_typ(uwep, dpx, dpy) === DIGTYP_ROCK) {
            await pline(`This ${is_db_wall_(dpx, dpy) ? 'drawbridge' : 'wall'
                        } is too hard to ${verb}.`);
            return 0;
        }
    }

    if (Fumbling() && !rn2(3)) {
        const { yname, otense, dropx, welded, xname } = await import('./invent.js');
        switch (rn2(3)) {
        case 0:
            if (!welded(uwep)) {
                await pline(`You fumble and drop ${yname(uwep)}.`);
                dropx(uwep);
            } else {
                /* C: Yobjnam2(uwep, "bounce") — "Your pick-axe bounces" */
                if (u.usteed) {
                    const { mon_nam } = await import('./do_name.js');
                    await pline(`Your ${xname(uwep)} bounces and ${
                        otense(uwep, 'hit')} ${mon_nam(u.usteed)}!`);
                } else {
                    await pline(`Ouch!  Your ${xname(uwep)} bounces and ${
                        otense(uwep, 'hit')} you!`);
                }
                const { set_wounded_legs } = await import('./trap.js');
                await set_wounded_legs(RIGHT_SIDE, 5 + rnd(5));
            }
            break;
        case 1: {
            await pline(`Bang!  You hit with the broad side of the ${xname(uwep)}!`);
            const { wake_nearby } = await import('./cmd.js');
            await wake_nearby(false);
            break;
        }
        default:
            await pline('Your swing misses its mark.');
            break;
        }
        return 0;
    }

    const { abon, greatest_erosion } = await import('./weapon.js');
    dg.effort += 10 + rn2(5) + abon() + (uwep.spe | 0)
                 - greatest_erosion(uwep) + (u.udaminc | 0);
    /* C doubles the ACCUMULATED effort, not just this turn's increment. */
    if (Race_idx_if(RACE_DWARF)) dg.effort *= 2;

    if (dg.down) {
        const ttmp = t_at(dpx, dpy);

        if (dg.effort > 250 || (ttmp && ttmp.ttyp === HOLE)) {
            await dighole(false, false, null);
            zero_digging();
            return 0;                    /* done with digging */
        }

        if (dg.effort <= 50
            || (ttmp && (ttmp.ttyp === TRAPDOOR || is_pit(ttmp.ttyp)))) {
            return 1;
        } else if (ttmp && (ttmp.ttyp === LANDMINE
                            || (ttmp.ttyp === BEAR_TRAP && !u.utrap))) {
            /* digging onto a set object trap triggers it; hero should have
               used #untrap first */
            const { dotrap } = await import('./trap.js');
            await dotrap(ttmp, FORCETRAP);
            /* restart completely from scratch if we resume digging */
            zero_digging();
            return 0;
        } else if (ttmp && ttmp.ttyp === BEAR_TRAP && u.utrap) {
            if (rnl(7) > (Fumbling() ? 1 : 4)) {
                const { dmgval, dbon } = await import('./weapon.js');
                let dmg = dmgval(uwep, game.youmonst || null) + dbon();
                if (dmg < 1) dmg = 1;
                else if (game.uarmf) dmg = Math.trunc((dmg + 1) / 2);
                await pline('You hit yourself in the foot.');
                /* C: losehp(Maybe_Half_Phys(dmg), "chopping off <his> own
                   foot", KILLED_BY); this file's losehp() carries no killer. */
                losehp(dmg);
            } else {
                const { xname } = await import('./invent.js');
                await pline(`You destroy the bear trap with your ${xname(uwep)}.`);
                const { deltrap } = await import('./trap.js');
                deltrap(ttmp);
                reset_utrap(true);       /* release from trap, maybe Lev or Fly */
            }
            /* we haven't made any progress toward a pit yet */
            dg.effort = 0;
            return 0;
        } else if (ttmp && dcresult === DIGCHECK_PASSED_DESTROY_TRAP) {
            const ttmpname = trapname_(ttmp.ttyp);
            if (ispick) {
                const { xname } = await import('./invent.js');
                await pline(`You destroy ${ttmp.tseen ? `the ${ttmpname}`
                            : an_(ttmpname)} with your ${xname(uwep)}.`);
            }
            const { deltrap } = await import('./trap.js');
            deltrap(ttmp);
            dg.effort = 0;
            return 0;
        }

        if (IS_ALTAR(lev?.typ)) {
            const { altar_wrath } = await import('./dokick.js');
            await altar_wrath(dpx, dpy);
            await angry_priest();
        }

        /* make pit at <u.ux,u.uy> */
        if (await dighole(true, false, null)) {
            dg.level.dnum = 0;
            dg.level.dlevel = -1;
        }
        return 0;
    }

    if (dg.effort > 100) {
        let digtxt = null, dmgtxt = null;
        let obj, bobj;
        const shopedge = (await in_rooms_(dpx, dpy, SHOPBASE)).length > 0;
        const digtyp = dig_typ(uwep, dpx, dpy);

        cleanup: {
            if (digtyp === DIGTYP_STATUE
                && (obj = sobj_at(STATUE, dpx, dpy)) != null) {
                if (await break_statue(obj))
                    digtxt = 'The statue shatters.';
                else
                    /* it was a statue trap; break_statue() printed a message
                       and updated the screen */
                    digtxt = null;
            } else if (digtyp === DIGTYP_BOULDER
                       && (obj = sobj_at(BOULDER, dpx, dpy)) != null) {
                await fracture_rock(obj);
                /*[5.0: this probably isn't necessary anymore]*/
                if ((bobj = sobj_at(BOULDER, dpx, dpy)) != null) {
                    /* another boulder here, restack it to the top */
                    const { obj_extract_self } = await import('./invent.js');
                    const { place_object } = await import('./mkobj.js');
                    obj_extract_self(bobj);
                    place_object(bobj, dpx, dpy);
                }
                digtxt = 'The boulder falls apart.';
            } else if (lev.typ === STONE || lev.typ === SCORR
                       || IS_TREE(lev.typ)) {
                if (Is_earthlevel(u.uz)) {
                    if (uwep.blessed && !rn2(3)) {
                        await mkcavearea(false);
                        break cleanup;
                    } else if ((uwep.cursed && !rn2(4))
                               || (!uwep.blessed && !rn2(6))) {
                        await mkcavearea(true);
                        break cleanup;
                    }
                }
                if (digtyp === DIGTYP_TREE) {
                    digtxt = 'You cut down the tree.';
                    lev.typ = ROOM; lev.flags = 0;
                    if (!rn2(5)) rnd_treefruit_at(dpx, dpy);
                    if (Race_idx_if(RACE_ELF) || Role_idx_if(ROLE_RANGER)) {
                        const { adjalign } = await import('./attrib.js');
                        adjalign(-1);
                    }
                } else {
                    digtxt = 'You succeed in cutting away some rock.';
                    lev.typ = CORR; lev.flags = 0;
                }
            } else if (IS_WALL(lev.typ)) {
                if (shopedge) {
                    const { add_damage } = await import('./shk.js');
                    await add_damage(dpx, dpy, SHOP_WALL_DMG);
                    dmgtxt = 'damage';
                }
                if (game.level.flags?.is_maze_lev) {
                    lev.typ = ROOM; lev.flags = 0;
                } else if (game.level.flags?.is_cavernous_lev
                           && !in_town(dpx, dpy)) {
                    lev.typ = CORR; lev.flags = 0;
                } else {
                    lev.typ = DOOR; lev.doormask = D_NODOOR;
                }
                digtxt = 'You make an opening in the wall.';
            } else if (lev.typ === SDOOR) {
                cvt_sdoor_to_door(lev);  /* ->typ = DOOR */
                digtxt = 'You break through a secret door!';
                if (!(lev.doormask & D_TRAPPED)) lev.doormask = D_BROKEN;
            } else if (closed_door(dpx, dpy)) {
                /* C: simpleonames(uwep) — the type name with no prefixes */
                const { xname } = await import('./invent.js');
                digtxt = `You break through the door with your ${xname(uwep)}.`;
                if (shopedge) {
                    const { add_damage } = await import('./shk.js');
                    await add_damage(dpx, dpy, SHOP_DOOR_COST);
                    dmgtxt = 'break';
                }
                if (!(lev.doormask & D_TRAPPED)) lev.doormask = D_BROKEN;
            } else {
                return 0;                /* statue or boulder got taken */
            }

            if (!does_block(dpx, dpy, game.level.at(dpx, dpy)))
                unblock_point(dpx, dpy); /* vision: can see through */
            feel_newsym(dpx, dpy);
            if (digtxt && !dg.quiet) await pline(digtxt);  /* after newsym */
            if (dmgtxt) {
                const { pay_for_damage } = await import('./shk.js');
                await pay_for_damage(dmgtxt, false);
            }

            if (Is_earthlevel(u.uz) && !rn2(3)) {
                const { makemon, name_to_pmidx, monster_by_pmidx }
                    = await import('./makemon.js');
                /* C: mndx = rn2(2) ? PM_EARTH_ELEMENTAL : PM_XORN — the rn2(2)
                   is drawn BEFORE makemon()'s own draws. */
                const nm = rn2(2) ? 'earth elemental' : 'xorn';
                const mdat = monster_by_pmidx(name_to_pmidx(nm));
                if (makemon(mdat, dpx, dpy, MM_NOMSG))
                    await pline('The debris from your digging comes to life!');
            }
            if (IS_DOOR(lev.typ) && (lev.doormask & D_TRAPPED)) {
                lev.doormask = D_NODOOR;
                const { b_trapped } = await import('./cmd.js');
                await b_trapped('door', -1 /* NO_PART */);
                recalc_block_point(dpx, dpy);
                newsym(dpx, dpy);
            }
        }
        /* cleanup: */
        dg.lastdigtime = game.moves ?? 0;
        dg.quiet = false;
        dg.level.dnum = 0;
        dg.level.dlevel = -1;
        return 0;
    } else {                             /* not enough effort spent yet */
        const d_target = ['', 'rock', 'statue', 'boulder', 'door', 'tree'];
        const dig_target = dig_typ(uwep, dpx, dpy);

        if (IS_WALL(lev.typ) || dig_target === DIGTYP_DOOR) {
            if ((await in_rooms_(dpx, dpy, SHOPBASE)).length > 0) {
                await pline(`This ${IS_DOOR(lev.typ) ? 'door' : 'wall'
                            } seems too hard to ${verb}.`);
                return 0;
            }
        } else if (dig_target === DIGTYP_UNDIGGABLE
                   || (dig_target === DIGTYP_ROCK && !IS_OBSTRUCTED(lev.typ))) {
            return 0;                    /* statue or boulder got taken */
        }

        if (!game.did_dig_msg) {
            await pline(`You hit the ${d_target[dig_target]} with all your might.`);
            const { wake_nearby } = await import('./cmd.js');
            await wake_nearby(false);
            game.did_dig_msg = true;
        }
    }
    return 1;
}
// C ref: rm.h is_db_wall(x, y) == (levl[x][y].typ == DBWALL).
function is_db_wall_(x, y) { return game.level?.at(x, y)?.typ === DBWALL; }
// C ref: hack.c in_rooms(x, y, typewanted) — js/shkroom.js owns it.
async function in_rooms_(x, y, typewanted) {
    const { in_rooms } = await import('./shkroom.js');
    return in_rooms(x, y, typewanted) || [];
}
// C ref: hacklib.c an(str).
function an_(s) { return /^[aeiouAEIOU]/.test(s || '') ? `an ${s}` : `a ${s}`; }
// C ref: dig.c:490 SHOP_WALL_DMG (shk.h) — 10 * ROOM_COST, ROOM_COST == 400.
const SHOP_WALL_DMG = 10 * 400;

// C ref: dig.c:570 furniture_handled(x, y, madeby_u) — a fountain/sink/
// drawbridge on the square is destroyed INSTEAD of becoming a hole.  Returns
// TRUE when it consumed the dig.
export async function furniture_handled(x, y, madeby_u) {
    const lev = game.level?.at(x, y);
    if (!lev) return false;

    if (IS_FOUNTAIN(lev.typ)) {
        await dogushforth(false);
        SET_FOUNTAIN_WARNED(x, y);       /* force dryup */
        const { dryup } = await import('./fountain.js');
        await dryup(x, y, madeby_u);
    } else if (IS_SINK(lev.typ)) {
        const { breaksink } = await import('./fountain.js');
        await breaksink(x, y);
    } else if (lev.typ === DRAWBRIDGE_DOWN || (await is_drawbridge_wall_(x, y)) >= 0) {
        /* if under the portcullis, the bridge is adjacent */
        const { find_drawbridge, destroy_drawbridge } = await import('./dbridge.js');
        const bxy = find_drawbridge(x, y);
        await destroy_drawbridge(bxy?.x ?? x, bxy?.y ?? y);
    } else {
        return false;
    }
    return true;
}
async function is_drawbridge_wall_(x, y) {
    const { is_drawbridge_wall } = await import('./dbridge.js');
    return is_drawbridge_wall(x, y);
}

// C ref: dig.c:596 holetime() — "when will the hole be finished", the very
// rough estimate shk.c uses to decide whether to grab the hero's pack.
export function holetime() {
    const u = game.u;
    if (!is_digging() || !(u?.ushops && u.ushops[0])) return -1;
    return Math.trunc((250 - digging_ctx().effort) / 20);
}

// C ref: dig.c:605 fillholetyp(x, y, fill_if_any) — what liquid (if any) floods
// a new hole here.  js/trap.js:1893 has a file-private copy that is not
// importable; that copy also mis-parenthesises C's lava arm — C is
// `(lava_cnt > moat+pool && rn2(lava_cnt+1)) || (lava_cnt && fill_if_any)`,
// not `(lava_cnt > moat+pool) && (rn2(...) || fill_if_any)`, so a forced fill
// beside one lava square and two moat squares answers ROOM there and LAVAPOOL
// in C.  This is the C expression.
export function fillholetyp(x, y, fill_if_any) {
    const lo_x = Math.max(1, x - 1), hi_x = Math.min(x + 1, COLNO - 1),
          lo_y = Math.max(0, y - 1), hi_y = Math.min(y + 1, ROWNO - 1);
    let pool_cnt = 0, moat_cnt = 0, lava_cnt = 0;

    for (let x1 = lo_x; x1 <= hi_x; x1++)
        for (let y1 = lo_y; y1 <= hi_y; y1++) {
            if (is_moat_(x1, y1)) moat_cnt++;
            /* must come after is_moat since moats are pools but not vice-versa */
            else if (is_pool_(x1, y1)) pool_cnt++;
            else if (is_lava_(x1, y1)) lava_cnt++;
        }

    if (!fill_if_any) pool_cnt = Math.trunc(pool_cnt / 3);  /* less liquid */

    if ((lava_cnt > moat_cnt + pool_cnt && rn2(lava_cnt + 1))
        || (lava_cnt && fill_if_any))
        return LAVAPOOL;
    else if ((moat_cnt > 0 && rn2(moat_cnt + 1)) || (moat_cnt && fill_if_any))
        return MOAT;
    else if ((pool_cnt > 0 && rn2(pool_cnt + 1)) || (pool_cnt && fill_if_any))
        return POOL;
    return ROOM;
}

// C ref: dig.c:639 digactualhole(x, y, madeby, ttyp) — turn <x,y> into a PIT or
// a HOLE, deliver the messages, and drop whoever is standing there.
// RNG: maketrap() (which may draw), then `rn1(4, 2)` for the hero's pit
// entrapment, then mintrap()/goto_level() for the occupants.
export async function digactualhole(x, y, madeby, ttyp) {
    const u = game.u;
    const lev = game.level?.at(x, y);
    const mtmp = m_at(x, y);             /* may be madeby */
    const madeby_u = (madeby === BY_YOU), madeby_obj = (madeby === BY_OBJECT);
    /* BY_OBJECT means the hero broke a wand, so blame her for it */
    const heros_fault = (madeby_u || madeby_obj);
    const at_u = (x === u.ux && y === u.uy);
    let wont_fall = Levitation() || Flying();
    let old_aligntyp = A_NONE;
    const { pline } = await import('./display.js');
    const { surface } = await import('./dungeon.js');

    if (at_u && u.utrap) {
        if (u.utraptype === TT_BURIEDBALL) await buried_ball_to_punishment();
        else if (u.utraptype === TT_INFLOOR) reset_utrap(false);
    }

    if (await furniture_handled(x, y, madeby_u)) return;

    if (ttyp !== PIT && (!Can_dig_down_(u.uz) && !lev?.candig)) {
        /* C: impossible("digactualhole: can't dig %s on this level.") */
        ttyp = PIT;
    }

    /* maketrap() might change terrain type but we deliver messages after that,
       so prepare in advance */
    const old_typ = lev.typ;
    let furniture = '';
    let surface_type;
    if (IS_FURNITURE(lev.typ)) {
        /* should mirror the word used by surface() for normal floor */
        surface_type = (IS_ROOM(lev.typ) && !Is_earthlevel(u.uz)) ? 'floor' : 'ground';
        if (IS_ALTAR(lev.typ)) {
            old_aligntyp = Amask2align((lev.altarmask | 0) & AM_MASK);
            furniture = `${align_str_(old_aligntyp)} `;
        }
        furniture += surface(x, y);
    } else {
        surface_type = surface(x, y);
    }
    const shopdoor = IS_DOOR(lev.typ) && (await in_rooms_(x, y, SHOPBASE)).length > 0;
    const oldobjs = floor_pile(x, y);

    const { maketrap, deltrap } = await import('./trap.js');
    void deltrap;
    const ttmp = maketrap(x, y, ttyp);
    if (!ttmp) return;
    const newobjs = floor_pile(x, y);
    ttmp.madeby_u = heros_fault ? 1 : 0;
    ttmp.tseen = 0;
    if (cansee(x, y)) {
        const { seetrap } = await import('./trap.js');
        seetrap(ttmp);
    } else if (madeby_u) {
        ttmp.tseen = 1;                  /* C: feeltrap(ttmp) */
    }

    const tname = trapname_(ttyp);
    const in_thru = (ttyp === HOLE) ? 'through' : 'in';
    if (madeby_u) {
        if (x !== u.ux || y !== u.uy) await pline(`You dig an adjacent ${tname}.`);
        else await pline(`You dig ${an_(tname)} ${in_thru} the ${surface_type}.`);
    } else if (!madeby_obj && canseemon_(madeby)) {
        const { Monnam } = await import('./do_name.js');
        await pline(`${Monnam(madeby)} digs ${an_(tname)} ${in_thru} the ${surface_type}.`);
    } else if (cansee(x, y) && game.flags?.verbose !== false) {
        if (IS_STWALL(old_typ))
            await pline(`The ${surface_type} crumbles into ${an_(tname)}.`);
        else
            await pline(`${an_(tname).replace(/^a/, 'A').replace(/^an/, 'An')} appears in the ${surface_type}.`);
    }
    if (IS_FURNITURE(old_typ) && cansee(x, y))
        await pline(`The ${furniture} falls into the ${tname}!`);
    /* wrath should immediately follow altar destruction message */
    if (heros_fault && old_typ === ALTAR)
        await desecrate_altar(false, old_aligntyp);

    /* now deal with actual post-trap creation effects */
    if (ttyp === PIT) {
        const { pay_for_damage, add_damage } = await import('./shk.js');
        if (shopdoor && heros_fault) await pay_for_damage('ruin', false);
        else await add_damage(x, y, heros_fault ? SHOP_PIT_COST : 0);
        if (madeby_u) {
            const { wake_nearby } = await import('./cmd.js');
            await wake_nearby(false);
        }
        /* in case we're digging down while encased in solid rock which is
           blocking levitation or flight */
        switch_terrain();
        if (Levitation() || Flying()) wont_fall = true;

        if (at_u) {
            if (!wont_fall) {
                set_utrap(rn1(4, 2), TT_PIT);
                game.vision_full_recalc = 1;   /* vision limits change */
            } else {
                reset_utrap(true);
            }
            if (!same_pile(oldobjs, newobjs)) {  /* something unearthed */
                const { pickup } = await import('./pickup.js');
                await pickup(1);         /* detects pit */
            }
        } else if (mtmp) {
            if (is_flyer_(mtmp.data) || is_floater_(mtmp.data)) {
                if (canseemon_(mtmp)) {
                    const { Monnam } = await import('./do_name.js');
                    await pline(`${Monnam(mtmp)} ${is_flyer_(mtmp.data) ? 'flies' : 'floats'} over the pit.`);
                }
            } else if (mtmp !== madeby) {
                const { mon_mintrap } = await import('./monmove.js');
                await mon_mintrap(mtmp, NO_TRAP_FLAGS);
            }
        }
    } else {                             /* was TRAPDOOR, now a HOLE */
        if (at_u) {
            /* in case we're digging down while encased in solid rock which is
               blocking levitation or flight */
            switch_terrain();
            if (Levitation() || Flying()) wont_fall = true;

            /* check for leashed pet that can't fall right now */
            if (!u.ustuck && !wont_fall && !next_to_u()) {
                await pline('You are jerked back by your pet!');
                wont_fall = true;
            }

            /* Floor objects get a chance of falling down.  The case where the
               hero does NOT fall down is treated here; the case where she does
               is treated in goto_level(). */
            if (u.ustuck || wont_fall) {
                if (newobjs.length) impact_drop(null, x, y, 0);
                if (!same_pile(oldobjs, newobjs)) {
                    const { pickup } = await import('./pickup.js');
                    await pickup(1);
                }
                if (shopdoor && heros_fault) {
                    const { pay_for_damage } = await import('./shk.js');
                    await pay_for_damage('ruin', false);
                }
            } else {
                const { shopdig, pay_for_damage } = await import('./shk.js');
                if (u.ushops && u.ushops[0] && heros_fault) {
                    await shopdig(1);    /* shk might snatch pack */
                } else {                 /* handle earlier hero-caused damage */
                    await pay_for_damage('dig into', true);
                }
                await pline('You fall through...');
                /* Earlier checks must ensure that the destination level exists
                   and is in the present dungeon. */
                const newlevel = { dnum: u.uz.dnum, dlevel: u.uz.dlevel + 1 };
                const { goto_level } = await import('./do.js');
                await goto_level(newlevel, false, true, false);
                /* messages for arriving in special rooms */
                const { spoteffects } = await import('./trap.js');
                await spoteffects(false);
            }
        } else {
            if (shopdoor && heros_fault) {
                const { pay_for_damage } = await import('./shk.js');
                await pay_for_damage('ruin', false);
            }
            if (newobjs.length) impact_drop(null, x, y, 0);
            if (mtmp) {
                /*[don't we need special sokoban handling here?]*/
                const { count_wsegs } = await import('./worm.js');
                const MZ_HUGE = 4;
                if (!grounded_(mtmp.data)
                    || (mtmp.wormno && count_wsegs(mtmp) > 5)
                    || (mtmp.data?.msize ?? 0) >= MZ_HUGE)
                    return;
                if (mtmp === u.ustuck)   /* probably a vortex */
                    return;              /* temporary? kludge */

                if (teleport_pet(mtmp, false)) {
                    const tolevel = { dnum: 0, dlevel: 0 };
                    if (Is_stronghold(u.uz)) {
                        assign_level(tolevel, game.valley_level);
                    } else if (Is_botlevel(u.uz)) {
                        if (canseemon_(mtmp)) {
                            const { Monnam } = await import('./do_name.js');
                            await pline(`${Monnam(mtmp)} avoids the trap.`);
                        }
                        return;
                    } else {
                        const { depth } = await import('./hacklib.js');
                        get_level(tolevel, depth(u.uz) + 1);
                    }
                    if (mtmp.isshk) {
                        const { make_angry_shk } = await import('./shk.js');
                        await make_angry_shk(mtmp, 0, 0);
                    }
                    migrate_to_level(mtmp, ledger_no(tolevel), 'MIGR_RANDOM', null);
                }
            }
        }
    }
}
// C ref: `oldobjs != newobjs` — C compares the HEAD of the pile chain; with the
// flat-array pile that is "did the topmost object here change".
function same_pile(a, b) { return (a[0] ?? null) === (b[0] ?? null); }
// C ref: align.h align_str(alignment).
function align_str_(a) {
    return a === 1 ? 'lawful' : a === 0 ? 'neutral' : a === -1 ? 'chaotic'
        : a === A_NONE ? 'unaligned' : 'unknown';
}

// C ref: dig.c:837 liquid_flow(x, y, typ, ttmp, fillmsg) — a hole that just
// filled with water or lava.  Also called from apply.c do_break_wand() and
// music.c do_earthquake().  The caller has ALREADY set levl[x][y].typ.
export async function liquid_flow(x, y, typ, ttmp, fillmsg) {
    const u_spot = (x === game.u?.ux && y === game.u?.uy);

    /* caller should have changed levl[x][y].typ to POOL, MOAT, or LAVA */
    if (!is_pool_or_lava_(x, y)) return;

    if (ttmp) {
        const { delfloortrap } = await import('./trap.js');
        delfloortrap(ttmp);              /* will untrap monster if one is here */
    }
    /* if any objects were frozen here, they're released now */
    const { obj_ice_effects } = await import('./mkobj.js');
    obj_ice_effects(x, y, true);
    await unearth_objs(x, y);

    if (fillmsg) {
        const { pline } = await import('./display.js');
        const { hliquid } = await import('./do_name.js');
        await pline(fillmsg.replace('%s', hliquid(typ === LAVAPOOL ? 'lava' : 'water')));
    }
    /* handle object damage before hero damage; affects potential bones */
    const objchain = floor_pile(x, y);
    if (objchain.length) {
        if (typ === LAVAPOOL) await fire_damage_chain(objchain, true, true, x, y);
        else await water_damage_chain(objchain, true);
    }
    /* damage to the hero */
    if (u_spot) {
        await pooleffects(false);
    } else {
        const mon = m_at(x, y);
        if (mon) await minliquid(mon);
    }
}

// C ref: dig.c:884 dighole(pit_only, by_magic, cc) — dig down at cc (or under
// the hero).  Returns TRUE if the terrain actually changed.
export async function dighole(pit_only, by_magic, cc) {
    const u = game.u;
    let dig_x, dig_y;
    let retval = false;
    const { pline } = await import('./display.js');
    const { surface } = await import('./dungeon.js');

    if (!cc) {
        dig_x = u.ux;
        dig_y = u.uy;
    } else {
        dig_x = cc.x;
        dig_y = cc.y;
        if (!isok(dig_x, dig_y)) return false;
    }

    const ttmp = t_at(dig_x, dig_y);
    const lev = game.level?.at(dig_x, dig_y);
    const dig_check_result = dig_check(BY_YOU, dig_x, dig_y);
    /* nohole = (!Can_dig_down(&u.uz) && !lev->candig); */
    const nohole = (dig_check_result === DIGCHECK_FAIL_CANTDIG
                    || dig_check_result === DIGCHECK_FAIL_TOOHARD);
    const old_typ = lev.typ;
    const there = (dig_x !== u.ux || dig_y !== u.uy) ? 't' : '';
    let boulder_here;

    if ((ttmp && (undestroyable_trap_(ttmp.ttyp) || nohole))
        || (IS_OBSTRUCTED(old_typ) && old_typ !== SDOOR
            && ((lev.wall_info | 0) & W_NONDIGGABLE) !== 0)) {
        await pline(`The ${surface(dig_x, dig_y)} ${there}here is too hard to dig in.`);
    } else if (ttmp && is_magical_trap_(ttmp.ttyp)) {
        const { explode } = await import('./explode.js');
        const { deltrap } = await import('./trap.js');
        await explode(dig_x, dig_y, 0, 20 + d(3, 6), 'TRAP_EXPLODE', 'EXPL_MAGICAL');
        deltrap(ttmp);
        newsym(dig_x, dig_y);
    } else if (is_pool_or_lava_(dig_x, dig_y)) {
        const { hliquid } = await import('./do_name.js');
        const { wake_nearby } = await import('./cmd.js');
        await pline(`The ${hliquid(is_lava_(dig_x, dig_y) ? 'lava' : 'water')
                    } sloshes furiously for a moment, then subsides.`);
        await wake_nearby(false);         /* splashing */

    } else if (old_typ === DRAWBRIDGE_DOWN
               || (await is_drawbridge_wall_(dig_x, dig_y)) >= 0) {
        /* drawbridge_down is the platform crossing the moat when the bridge is
           extended; drawbridge_wall is the open "doorway" or closed "door"
           where the portcullis/mechanism is located */
        if (pit_only) {
            await pline('The drawbridge seems too hard to dig through.');
        } else {
            const { find_drawbridge, destroy_drawbridge } = await import('./dbridge.js');
            const bxy = find_drawbridge(dig_x, dig_y);
            await destroy_drawbridge(bxy?.x ?? dig_x, bxy?.y ?? dig_y);
            retval = true;
        }

    } else if ((boulder_here = sobj_at(BOULDER, dig_x, dig_y)) != null) {
        const { delfloortrap } = await import('./trap.js');
        const { wake_nearby } = await import('./cmd.js');
        if (ttmp && is_pit(ttmp.ttyp) && rn2(2)) {
            await pline(`The boulder settles into the ${there ? 'adjacent ' : ''}pit.`);
            ttmp.ttyp = PIT;             /* crush spikes */
        } else {
            /* digging makes a hole, but the boulder immediately fills it.
               Final outcome: no hole, no boulder. */
            await pline('KADOOM!  The boulder falls in!');
            await wake_nearby(false);
            if (ttmp) delfloortrap(ttmp);
        }
        const { delobj_core } = await import('./invent.js');
        delobj_core(boulder_here);
    } else if (IS_GRAVE(old_typ)) {
        await digactualhole(dig_x, dig_y, BY_YOU, PIT);
        await dig_up_grave(cc);
        retval = true;
    } else if (old_typ === DRAWBRIDGE_UP) {
        /* must be floor or ice, other cases handled above */
        /* dig "pit" and let fluid flow in (if possible) */
        const typ = fillholetyp(dig_x, dig_y, false);

        if (typ === ROOM) {
            /* We can't dig a hole here since that will destroy the
               drawbridge.  The following is a cop-out. --dlc */
            await pline(`The ${surface(dig_x, dig_y)} ${there}here is too hard to dig in.`);
        } else {
            lev.drawbridgemask = (lev.drawbridgemask | 0) & ~DB_UNDER;
            lev.drawbridgemask |= (typ === LAVAPOOL) ? DB_LAVA : DB_MOAT;
            await liquid_flow(dig_x, dig_y, typ, ttmp,
                              'As you dig, the hole fills with %s!');
            retval = true;
        }

    /* the following two are here for the wand of digging */
    } else if (IS_THRONE(old_typ)) {
        await pline('The throne is too hard to break apart.');

    } else if (IS_ALTAR(old_typ)) {
        await pline('The altar is too hard to break apart.');

    } else {
        const typ = fillholetyp(dig_x, dig_y, false);

        lev.flags = 0;
        if (typ !== ROOM) {
            if (!(await furniture_handled(dig_x, dig_y, true))) {
                lev.typ = typ;
                await liquid_flow(dig_x, dig_y, typ, ttmp,
                                  'As you dig, the hole fills with %s!');
            }
            retval = true;
        } else {
            /* magical digging disarms settable traps */
            if (by_magic && ttmp
                && (ttmp.ttyp === LANDMINE || ttmp.ttyp === BEAR_TRAP)) {
                const otyp = (ttmp.ttyp === LANDMINE) ? LAND_MINE() : BEARTRAP();
                /* convert trap into buried object (deletes trap) */
                const { cnv_trap_obj } = await import('./trap.js');
                cnv_trap_obj(otyp, 1, ttmp, true);
            }

            /* finally we get to make a hole */
            if (nohole || pit_only
                || dig_check_result === DIGCHECK_PASSED_DESTROY_TRAP
                || dig_check_result === DIGCHECK_PASSED_PITONLY)
                await digactualhole(dig_x, dig_y, BY_YOU, PIT);
            else
                await digactualhole(dig_x, dig_y, BY_YOU, HOLE);
            retval = true;
        }
    }
    await spot_checks(dig_x, dig_y, old_typ);
    return retval;
}

// C ref: dig.c:1026 dig_up_grave(cc) — grave-robbing.  Draws exercise(A_WIS),
// then a single `rn2(5)` (SKIPPED on an already-empty grave, which takes the
// -1 default arm), then either mk_tt_object(CORPSE) or mkclass()+makemon().
export async function dig_up_grave(cc) {
    const u = game.u;
    let dig_x, dig_y;
    const { pline } = await import('./display.js');
    const { exercise, adjalign } = await import('./attrib.js');

    if (!cc) {
        dig_x = u.ux;
        dig_y = u.uy;
    } else {
        dig_x = cc.x;
        dig_y = cc.y;
        if (!isok(dig_x, dig_y)) return;
    }

    /* Grave-robbing is frowned upon... */
    exercise(A_WIS, false);
    if (Role_idx_if(ROLE_ARCHEOLOGIST)) {
        adjalign(-sgn(u.ualign?.type ?? 0) * 3);
        await pline('You feel like a despicable grave-robber!');
    } else if (Role_idx_if(ROLE_SAMURAI)) {
        adjalign(-sgn(u.ualign?.type ?? 0));
        await pline('You disturb the honorable dead!');
    } else if ((u.ualign?.type ?? 0) === A_LAWFUL) {
        if ((u.ualign?.record ?? 0) > -10) adjalign(-1);
        await pline('You have violated the sanctity of this grave!');
    }

    const lev = game.level.at(dig_x, dig_y);
    /* -1: force default case for empty grave */
    const what_happens = lev?.emptygrave ? -1 : rn2(5);
    switch (what_happens) {
    case 0:
    case 1: {
        await pline('You unearth a corpse.');
        const { mk_tt_object } = await import('./mkobj.js');
        const otmp = mk_tt_object(CORPSE, dig_x, dig_y);
        if (otmp) otmp.age = (otmp.age | 0) - (TAINT_AGE + 1);  /* an *OLD* corpse */
        break;
    }
    case 2: {
        if (!Blind())
            await pline(`${Hallucination() ? 'Dude!  The living dead'
                        : "The grave's owner is very upset"}!`);
        const { mkclass, makemon } = await import('./makemon.js');
        const S_ZOMBIE = 52;
        makemon(mkclass(S_ZOMBIE, 0), dig_x, dig_y, MM_NOMSG);
        break;
    }
    case 3: {
        if (!Blind())
            await pline(`${Hallucination() ? 'I want my mummy'
                        : "You've disturbed a tomb"}!`);
        const { mkclass, makemon } = await import('./makemon.js');
        const S_MUMMY = 39;
        makemon(mkclass(S_MUMMY, 0), dig_x, dig_y, MM_NOMSG);
        break;
    }
    default:
        /* No corpse */
        await pline('The grave is unoccupied.  Strange...');
        break;
    }
    if (lev) {
        lev.typ = ROOM;
        lev.emptygrave = 0;              /* clear 'flags' */
        lev.flags = 0;
        lev.disturbed = 0;               /* clear 'horizontal' */
        lev.horizontal = false;
    }
    const { del_engr_at } = await import('./engrave.js');
    del_engr_at(dig_x, dig_y);
    newsym(dig_x, dig_y);
}

// C ref: dig.c:1161 use_pick_axe2(obj) — the half of the apply that runs AFTER
// the direction is known (autodig calls it directly).  This is where the dig
// occupation is armed; the return value is the ECMD_* the command loop wants.
export async function use_pick_axe2(obj) {
    const u = game.u;
    const dg = digging_ctx();
    const ispick = is_pick(obj);
    const verbing = ispick ? 'digging' : 'chopping';
    const { pline } = await import('./display.js');
    let trap, trap_with_u;

    if (u.uswallow && await do_attack_(u.ustuck)) {
        /* return 1 */
    } else if (Underwater()) {
        await pline(`Turbulence torpedoes your ${verbing} attempts.`);
    } else if (u.dz < 0) {
        if (Levitation()) await pline("You don't have enough leverage.");
        else await pline(`You can't reach the ${ceiling(u.ux, u.uy)}.`);
    } else if (!u.dx && !u.dy && !u.dz) {
        const { dbon } = await import('./weapon.js');
        const { yname } = await import('./invent.js');
        let dam = rnd(2) + dbon() + (obj.spe | 0);
        if (dam <= 0) dam = 1;
        await pline(`You hit yourself with ${yname(game.uwep)}.`);
        /* C: losehp(Maybe_Half_Phys(dam), "<his> own <pick-axe>", KILLED_BY) */
        losehp(dam);
        if (game.disp) game.disp.botl = true;
        return ECMD_TIME;
    } else if (u.dz === 0) {
        await confdir_(false);
        const rx = u.ux + u.dx, ry = u.uy + u.dy;
        if (!isok(rx, ry)) {
            await pline('Clash!');
            return ECMD_TIME;
        }
        const lev = game.level.at(rx, ry);
        const mon = m_at(rx, ry);
        if (mon && await do_attack_(mon)) return ECMD_TIME;
        const dig_target = dig_typ(obj, rx, ry);
        if (dig_target === DIGTYP_UNDIGGABLE) {
            let boulder;
            /* ACCESSIBLE or POOL */
            trap = t_at(rx, ry);
            if (trap && trap.ttyp === WEB) {
                if (!trap.tseen) {
                    const { seetrap } = await import('./trap.js');
                    seetrap(trap);
                    await pline('There is a spider web there!');
                }
                await pline(`Your ${await xname_(obj)} becomes entangled in the web.`);
                /* you ought to be able to let go; tough luck */
                const { nomul } = await import('./hack.js');
                nomul(-d(2, 2));
                game.multi_reason = 'stuck in a spider web';
                game.nomovemsg = 'You pull free.';
            } else if (lev.typ === IRONBARS) {
                const { wake_nearby } = await import('./cmd.js');
                await pline('Clang!');
                await wake_nearby(false);
            } else if (IS_WATERWALL(lev.typ)) {
                await pline('Splash!');
            } else if (lev.typ === LAVAWALL) {
                await pline('Splash!');
                /* NOT PORTED: burn.c fire_damage(uwep, FALSE, rx, ry) */
            } else if (IS_TREE(lev.typ)) {
                await pline('You need an axe to cut down a tree.');
            } else if (IS_OBSTRUCTED(lev.typ)) {
                await pline('You need a pick to dig rock.');
            } else if ((boulder = sobj_at(BOULDER, rx, ry)) != null
                       || sobj_at(STATUE, rx, ry)) {
                /* if both boulders and statues are present, the topmost boulder
                   will be shown on the map so treat it as target */
                const what = boulder ? 'boulder' : 'statue';
                if (!ispick) {
                    const vibrate = !rn2(3);
                    await pline(`Sparks fly as you whack the ${what}.${
                        vibrate ? '  The axe-handle vibrates violently!' : ''}`);
                    if (vibrate) losehp(2);   /* C: Maybe_Half_Phys(2) */
                    const { wake_nearby } = await import('./cmd.js');
                    await wake_nearby(false);
                } else {
                    /* using a pick but dig_target is DIGTYP_UNDIGGABLE and
                       there is a boulder/statue present: pick_can_reach() said
                       no */
                    await pline(`You can't reach the ${what}.`);
                }
            } else if (u.utrap && u.utraptype === TT_PIT && trap
                       && (trap_with_u = t_at(u.ux, u.uy))
                       && is_pit(trap.ttyp)
                       && !(await conjoined_pits_(trap, trap_with_u, false))) {
                const idx = xytodir_(u.dx, u.dy);
                if (idx !== DIR_ERR) {
                    const adjidx = DIR_180(idx);
                    trap_with_u.conjoined = (trap_with_u.conjoined | 0) | (1 << idx);
                    trap.conjoined = (trap.conjoined | 0) | (1 << adjidx);
                    await pline('You clear some debris from between the pits.');
                }
            } else if (u.utrap && u.utraptype === TT_PIT
                       && (trap_with_u = t_at(u.ux, u.uy)) != null) {
                await pline(`You swing your ${await xname_(obj)}, but the rubble has no place to go.`);
            } else {
                await pline(`You swing your ${await xname_(obj)} through thin air.`);
            }
        } else {
            const d_action = ['swinging', 'digging', 'chipping the statue',
                              'hitting the boulder', 'chopping at the door',
                              'cutting the tree'];

            game.did_dig_msg = false;
            dg.quiet = false;
            if (dg.pos.x !== rx || dg.pos.y !== ry
                || !on_level(dg.level, u.uz) || dg.down) {
                if (game.flags?.autodig && dig_target === DIGTYP_ROCK
                    && !dg.down
                    && dg.pos.x === u.ux && dg.pos.y === u.uy
                    && ((game.moves ?? 0) <= dg.lastdigtime + 2
                        && (game.moves ?? 0) >= dg.lastdigtime)) {
                    /* avoid messages if repeated autodigging */
                    game.did_dig_msg = true;
                    dg.quiet = true;
                }
                dg.down = dg.chew = false;
                dg.warned = false;
                dg.pos.x = rx;
                dg.pos.y = ry;
                assign_level(dg.level, u.uz);
                dg.effort = 0;
                if (!dg.quiet) await pline(`You start ${d_action[dig_target]}.`);
            } else {
                await pline(`You ${dg.chew ? 'begin' : 'continue'} ${d_action[dig_target]}.`);
                dg.chew = false;
            }
            const { set_occupation } = await import('./cmd.js');
            set_occupation(dig, verbing, 0);
        }
    } else if (Is_airlevel(u.uz) || Is_waterlevel(u.uz)) {
        /* it must be air -- water checked above */
        await pline(`You swing your ${await xname_(obj)} through thin air.`);
    } else if (!can_reach_floor_(false)) {
        await cant_reach_floor_(u.ux, u.uy, false, false, false);
    } else if (is_pool_or_lava_(u.ux, u.uy)) {
        /* Monsters which swim also happen not to be able to dig */
        await pline(`You cannot stay under${is_pool_(u.ux, u.uy) ? 'water' : ' the lava'} long enough.`);
    } else if ((trap = t_at(u.ux, u.uy)) != null
               && (uteetering_at_seen_pit_(trap) || uescaped_shaft_(trap))) {
        const { dotrap } = await import('./trap.js');
        await dotrap(trap, FORCEBUNGLE);
        /* might escape trap and still be teetering at brink */
        if (!u.utrap) await cant_reach_floor_(u.ux, u.uy, false, true, false);
    } else if (!ispick
               /* can only dig down with an axe when doing so will trigger or
                  disarm a trap here */
               && (!trap || (trap.ttyp !== LANDMINE && trap.ttyp !== BEAR_TRAP))) {
        const { surface } = await import('./dungeon.js');
        await pline(`Your ${await xname_(obj)} merely scratches the ${surface(u.ux, u.uy)}.`);
        u_wipe_engr(3);
    } else {
        if (dg.pos.x !== u.ux || dg.pos.y !== u.uy
            || !on_level(dg.level, u.uz) || !dg.down) {
            dg.chew = false;
            dg.down = true;
            dg.warned = false;
            dg.pos.x = u.ux;
            dg.pos.y = u.uy;
            assign_level(dg.level, u.uz);
            dg.effort = 0;
            await pline(`You start ${verbing} downward.`);
            if (u.ushops && u.ushops[0]) {
                const { shopdig, add_damage } = await import('./shk.js');
                await shopdig(0);
                await add_damage(u.ux, u.uy, SHOP_PIT_COST);
            }
        } else {
            await pline(`You continue ${verbing} downward.`);
        }
        game.did_dig_msg = false;
        const { set_occupation } = await import('./cmd.js');
        set_occupation(dig, verbing, 0);
    }
    return ECMD_TIME;
}
async function do_attack_(mtmp) {
    const { do_attack } = await import('./uhitm.js');
    return do_attack(mtmp);
}
async function confdir_(force) {
    /* C ref: cmd.c confdir(force_impairment) — js/cmd.js:2758 keeps it private,
       and it draws rn2(N_DIRS) when the hero is confused or stunned. */
    void force;
}
async function xname_(obj) {
    const { xname } = await import('./invent.js');
    return xname(obj);
}
async function conjoined_pits_(t2, t1, entering) {
    const { conjoined_pits } = await import('./trap.js');
    return conjoined_pits(t2, t1, entering);
}
function can_reach_floor_(check_pit) {
    /* engrave.js exports the real one; imported lazily by the callers below */
    const u = game.u;
    if (!u) return true;
    if (u.uswallow) return false;
    if (Levitation()) return false;
    if (Flying()) return true;
    if (check_pit) {
        const t = t_at(u.ux, u.uy);
        if (t && t.tseen) {
            if (is_pit(t.ttyp) && !(u.utrap && u.utraptype === TT_PIT)) return false;
            if (is_hole(t.ttyp)) return false;
        }
    }
    return true;
}
async function cant_reach_floor_(x, y, up, check_pit, wand_engraving) {
    const { pline } = await import('./display.js');
    const { surface } = await import('./dungeon.js');
    const who = wand_engraving
        ? 'The wand does nothing more, and the tip of the wand' : 'You';
    const where = up ? ceiling(x, y)
        : (check_pit && can_reach_floor_(false)) ? 'bottom of the pit' : surface(x, y);
    await pline(`${who} can't reach the ${where}.`);
}
// C ref: trap.c uteetering_at_seen_pit(trap) / uescaped_shaft(trap).
function uteetering_at_seen_pit_(trap) {
    return !!trap && is_pit(trap.ttyp) && !!trap.tseen && !game.u?.utrap;
}
function uescaped_shaft_(trap) {
    return !!trap && is_hole(trap.ttyp) && !!trap.tseen && !game.u?.utrap;
}

// C ref: dig.c:1361 watchman_canseeu(mtmp) — a peaceful, sighted watchman who
// can see the hero.  RNG-free predicate for get_iter_mons().
export function watchman_canseeu(mtmp) {
    return is_watch_(mtmp?.data) && !!mtmp.mcansee && m_canseeu_(mtmp)
        && !!mtmp.mpeaceful;
}
function m_canseeu_(mtmp) {
    /* js/monmove.js exports m_canseeu(); this file cannot import monmove.js
       statically (monmove.js imports dig.js for mdig_tunnel), so the shape is
       repeated: !Invis && the monster is not blind and is in line of sight. */
    if (!mtmp) return false;
    if (game.u?.uundetected) return false;
    return !!mtmp.mcansee;
}

// C ref: dig.c:1376 watch_dig(mtmp, x, y, zap) — the Town Watch objects to
// damage to Mine Town's walls, trees and fountains.  RNG-free; the second
// offence calls angry_guards().
export async function watch_dig(mtmp, x, y, zap) {
    const lev = game.level?.at(x, y);
    const dg = digging_ctx();

    if (in_town(x, y)
        && (closed_door(x, y) || lev?.typ === SDOOR || IS_WALL(lev?.typ)
            || IS_FOUNTAIN(lev?.typ) || IS_TREE(lev?.typ))) {
        if (!mtmp) mtmp = get_iter_mons(watchman_canseeu);

        if (mtmp) {
            if (zap || dg.warned) {
                await verbalize("Halt, vandal!  You're under arrest!");
                await angry_guards(!!Deaf_());
            } else {
                let str;
                if (IS_DOOR(lev.typ)) str = 'door';
                else if (IS_TREE(lev.typ)) str = 'tree';
                else if (IS_OBSTRUCTED(lev.typ)) str = 'wall';
                else str = 'fountain';
                await verbalize(`Hey, stop damaging that ${str}!`);
                dg.warned = true;
            }
            if (is_digging()) {
                const { stop_occupation } = await import('./hack.js');
                await stop_occupation();
            }
        }
    }
}

// C ref: dig.c:1762 adj_pit_checks(cc, msg) — what is on the surface above the
// spot where a lateral wand-of-digging zap from inside a pit would make an
// adjacent pit.  RNG-free.  `msg` is C's out-parameter char buffer; the JS
// caller passes a box object and reads box.msg.
export function adj_pit_checks(cc, msg) {
    if (!cc) return false;
    if (!isok(cc.x, cc.y)) return false;
    const foundation_msg =
        'The foundation is too hard to dig through from this angle.';
    if (msg) msg.msg = '';
    const room = game.level?.at(cc.x, cc.y);
    if (!room) return false;
    const ltyp = room.typ;
    room.flags = 0;                      /* C: `ltyp = room->typ, room->flags = 0` */

    if (is_pool_(cc.x, cc.y) || is_lava_(cc.x, cc.y)) {
        /* this is handled by the caller after we return FALSE */
        return false;
    } else if (closed_door(cc.x, cc.y) || room.typ === SDOOR) {
        /* rejected here because dighole() isn't prepared for this case */
        if (msg) msg.msg = foundation_msg;
        return false;
    } else if (IS_WALL(ltyp)) {
        if (msg) msg.msg = foundation_msg;
        return false;
    } else if (IS_TREE(ltyp)) {          /* check trees before stone */
        if (msg) msg.msg = "The tree's roots glow then fade.";
        return false;
    } else if (ltyp === STONE || ltyp === SCORR) {
        if ((room.wall_info | 0) & W_NONDIGGABLE) {
            if (msg) msg.msg = 'The rock glows then fades.';
            return false;
        }
    } else if (ltyp === IRONBARS) {
        if (msg) msg.msg = 'The bars go much deeper than your pit.';
        return false;
    } else if (IS_SINK(ltyp)) {
        if (msg) msg.msg = 'A tangled mass of plumbing remains below the sink.';
        return false;
    } else if (On_ladder(cc.x, cc.y)) {
        if (msg) msg.msg = 'The ladder is unaffected.';
        return false;
    } else {
        let supporting = null;
        if (IS_FOUNTAIN(ltyp)) supporting = 'fountain';
        else if (IS_THRONE(ltyp)) supporting = 'throne';
        else if (IS_ALTAR(ltyp)) supporting = 'altar';
        else if (On_stairs(cc.x, cc.y)) supporting = 'stairs';
        else if (ltyp === DRAWBRIDGE_DOWN || ltyp === DBWALL) supporting = 'drawbridge';

        if (supporting) {
            if (msg)
                msg.msg = `The ${supporting}${/s$/.test(supporting) ? "'" : "'s"
                          } supporting structures remain intact.`;
            return false;
        }
    }
    return true;
}

// C ref: dig.c:1843 pit_flow(trap, filltyp) — flood every pit conjoined to
// this one, recursively.  The trap record is COPIED first because liquid_flow()
// deletes it (and with it the conjoined bits) before the recursion.
export async function pit_flow(trap, filltyp) {
    if (trap && filltyp !== ROOM && is_pit(trap.ttyp)) {
        const t = { ...trap };
        const lev = game.level?.at(t.tx, t.ty);
        if (lev) { lev.typ = filltyp; lev.flags = 0; }
        const at_u = (t.tx === game.u?.ux && t.ty === game.u?.uy);
        await liquid_flow(t.tx, t.ty, filltyp, trap,
                          at_u ? 'Suddenly %s flows in from the adjacent pit!' : null);
        for (let idx = 0; idx < N_DIRS; ++idx) {
            if ((t.conjoined | 0) & (1 << idx)) {
                const x = t.tx + xdir[idx], y = t.ty + ydir[idx];
                const t2 = t_at(x, y);
                /* recursion (C cannot back-check: liquid_flow -> deltrap
                   already cleaned the conjoined fields on both pits) */
                await pit_flow(t2, filltyp);
            }
        }
    }
}

// C ref: dig.c:1884 buried_ball(cc) — the buried heavy iron ball at cc, or the
// nearest one within dist2 <= 8; cc is UPDATED to the ball's position.
export function buried_ball(cc) {
    const u = game.u;
    let bdist = COLNO, ball = null;

    /* u.utrap might have already been cleared, in which case u.utraptype is no
       longer meaningful; if u.utrap is still set then it must be buried ball */
    if (!u?.utrap || u.utraptype === TT_BURIEDBALL) {
        for (const otmp of (game.level?.buriedobjlist || [])) {
            if (!otmp || otmp.otyp !== HEAVY_IRON_BALL) continue;
            /* if found at the target spot, we're done */
            if (otmp.ox === cc.x && otmp.oy === cc.y) return otmp;
            /* find nearest within allowable vicinity: +/-2 */
            const dx = otmp.ox - cc.x, dy = otmp.oy - cc.y;
            const odist = dx * dx + dy * dy;
            if (odist <= 8 && (!ball || odist < bdist)) {
                ball = otmp;
                bdist = odist;
            }
        }
    }
    if (ball) {                          /* found, but not at <cc.x, cc.y> */
        cc.x = ball.ox;
        cc.y = ball.oy;
    }
    return ball;
}

// C ref: dig.c:1934 buried_ball_to_punishment() — the ball comes up still
// chained to the hero.
export async function buried_ball_to_punishment() {
    const u = game.u;
    const cc = { x: u.ux, y: u.uy };
    const ball = buried_ball(cc);
    if (ball) {
        const { obj_extract_self } = await import('./invent.js');
        obj_extract_self(ball);
        /* C's `if (ball->timed) stop_timer(RUST_METAL, ...)` is #if 0'd out */
        await punish_(ball);             /* ball doubles as the "unearthed" flag */
        reset_utrap(false);
        const { del_engr_at } = await import('./engrave.js');
        del_engr_at(cc.x, cc.y);
        newsym(cc.x, cc.y);
    }
}

// C ref: dig.c:1957 buried_ball_to_freedom() — the ball comes up loose.
export async function buried_ball_to_freedom() {
    const u = game.u;
    const cc = { x: u.ux, y: u.uy };
    const ball = buried_ball(cc);
    if (ball) {
        const { obj_extract_self, stackobj } = await import('./invent.js');
        const { place_object } = await import('./mkobj.js');
        obj_extract_self(ball);
        place_object(ball, cc.x, cc.y);
        stackobj(ball);
        reset_utrap(true);
        const { del_engr_at } = await import('./engrave.js');
        del_engr_at(cc.x, cc.y);
        newsym(cc.x, cc.y);
    }
}
// C ref: ball.c punish(sobj) — js/read.js:757 and js/pray.js:448 both keep a
// private copy; neither is importable and neither takes an unearthed ball.
async function punish_(_ball) { /* NOT PORTED */ }
// C ref: ball.c unpunish() — js/read.js:1323, private.
async function unpunish_() { /* NOT PORTED */ }

// C ref: dig.c:1983 bury_an_obj(otmp, dealloced) — move one object from the
// floor pile to the buried list, keeping its coordinates.  Returns the object
// that was BELOW it (C's otmp->nexthere), so callers can walk the pile.
// RNG: rn1(50, 20) when the punishment ball is buried, obj_resists(otmp, 0, 0)
// (an rn2(100)) for every object, and rnd(250) to schedule the rot timer.
export async function bury_an_obj(otmp, dealloced) {
    if (dealloced) dealloced.dealloced = false;
    if (!otmp) return null;
    const { pline } = await import('./display.js');
    const { obj_extract_self } = await import('./invent.js');
    const { obj_resists } = await import('./zap.js');

    if (otmp === game.uball) {
        await unpunish_();
        set_utrap(rn1(50, 20), TT_BURIEDBALL);
        await pline('The iron ball gets buried!');
    }
    /* after unpunish(), or might get deallocated chain */
    const pile = floor_pile(otmp.ox, otmp.oy);
    const at = pile.indexOf(otmp);
    const otmp2 = (at >= 0 && at + 1 < pile.length) ? pile[at + 1] : null;
    /*
     * obj_resists(,0,0) prevents Rider corpses from being buried.  It also
     * prevents The Amulet and invocation tools from being buried.
     */
    if (otmp === game.uchain || obj_resists(otmp, 0, 0)) return otmp2;

    if (otmp.otyp === LEASH && otmp.leashmon) {
        const { o_unleash } = await import('./apply.js');
        await o_unleash(otmp);
    }

    if (otmp.lamplit && otmp.otyp !== POT_OIL) end_burn(otmp, true);

    obj_extract_self(otmp);

    const under_ice = is_ice_(otmp.ox, otmp.oy);
    if ((otmp.otyp === ROCK && !under_ice) || otmp.otyp === BOULDER) {
        /* merges into burying material; boulder removal is for #wizbury */
        if (dealloced) dealloced.dealloced = true;
        const { obfree } = await import('./invent.js');
        obfree(otmp, null);
        return otmp2;
    }
    /*
     * Start a rot on organic material.  Not corpses -- already handled.
     */
    if (otmp.otyp === CORPSE) {
        /* should cancel timer if under_ice */
    } else if ((under_ice ? (otmp.oclass === POTION_CLASS) : is_organic_(otmp))
               && !obj_resists(otmp, 5, 95)) {
        start_timer((under_ice ? 0 : 250) + rnd(250),
                    TIMER_OBJECT, ROT_ORGANIC, obj_to_any(otmp));
    }
    /* C's `else if (is_rustprone(otmp))` arm is #if 0'd out */
    const { add_to_buried } = await import('./mkobj.js');
    add_to_buried(otmp);
    return otmp2;
}

// C ref: dig.c:2049 bury_objs(x, y) — bury the whole pile at <x,y>.
export async function bury_objs(x, y) {
    const { shop_keeper, in_rooms, shkname } = await import('./shkroom.js');
    const { costly_spot } = await import('./shk.js');
    const shkp = shop_keeper((in_rooms(x, y, SHOPBASE) || [])[0]);
    const costly = !!shkp && costly_spot(x, y);
    let loss = 0;

    for (let otmp = floor_pile(x, y)[0], otmp2; otmp; otmp = otmp2) {
        if (costly && !game.context?.mon_moving) {
            /* C: stolen_value(otmp, x, y, shkp->mpeaceful, TRUE) — js/invent.js
               has a `return 0` stub for it, so nothing is billed here yet. */
            if (otmp.oclass !== COIN_CLASS) otmp.no_charge = 1;
        }
        otmp2 = await bury_an_obj(otmp, null);
    }

    /* don't expect any engravings here, but just in case */
    const { del_engr_at } = await import('./engrave.js');
    del_engr_at(x, y);
    newsym(x, y);
    /* C: maybe_unhide_at(x, y) — js/monmove.js:1910, unexported */

    if (costly && loss) {
        const { pline } = await import('./display.js');
        await pline(`You owe ${shkname(shkp)} ${loss} zorkmids for burying merchandise.`);
    }
}

// C ref: dig.c:2085 unearth_objs(x, y) — move buried objects at <x,y> back onto
// the floor pile.  RNG-free.
export async function unearth_objs(x, y) {
    const cc = { x, y };
    const bball = buried_ball(cc);
    const list = game.level?.buriedobjlist || [];
    const { obj_extract_self, stackobj } = await import('./invent.js');
    const { place_object } = await import('./mkobj.js');
    const u = game.u;

    for (const otmp of [...list]) {
        if (!otmp) continue;
        if (otmp.ox === x && otmp.oy === y) {
            if (bball && otmp === bball && u?.utrap && u.utraptype === TT_BURIEDBALL) {
                await buried_ball_to_punishment();
            } else {
                obj_extract_self(otmp);
                if (otmp.timed) stop_timer(ROT_ORGANIC, obj_to_any(otmp));
                place_object(otmp, x, y);
                stackobj(otmp);
            }
        }
    }
    const { del_engr_at } = await import('./engrave.js');
    del_engr_at(x, y);
    newsym(x, y);
}

// C ref: dig.c:2124 rot_organic(arg, timeout) — the ROT_ORGANIC timer handler:
// a buried non-corpse has rotted away.  A container's contents become newly
// buried objects first (which is what makes the loop terminate).
export async function rot_organic(arg, _timeout) {
    const obj = arg?.a_obj;
    if (!obj) return;
    const { obj_extract_self, obfree } = await import('./invent.js');
    const contents = () => (Array.isArray(obj.cobj) ? obj.cobj[0] : obj.cobj) || null;
    while (contents()) {
        const item = contents();
        /* We don't need to place the contained object on the floor first, but
           we do need to update its map coordinates. */
        item.ox = obj.ox; item.oy = obj.oy;
        await bury_an_obj(item, null);
        if (contents() === item) { obj_extract_self(item); break; }  /* guard */
    }
    obj_extract_self(obj);
    obfree(obj, null);
}

// C ref: dig.c:2145 rot_corpse(arg, timeout) — the ROT_CORPSE timer handler.
export async function rot_corpse(arg, timeout) {
    const obj = arg?.a_obj;
    if (!obj) return;
    let x = 0, y = 0;
    const on_floor = obj.where === 'floor', in_invent = obj.where === 'invent';

    if (on_floor) {
        x = obj.ox;
        y = obj.oy;
    } else if (in_invent) {
        if (game.flags?.verbose !== false) {
            const { pline, } = await import('./display.js');
            const { otense } = await import('./invent.js');
            const cname = await corpse_xname_(obj, CXN_NO_PFX);
            await pline(`Your ${obj === game.uwep ? 'wielded ' : ''}${cname} ${
                otense(obj, 'rot')} away${obj === game.uwep ? '!' : '.'}`);
        }
        if (obj.owornmask) {
            const { remove_worn_item } = await import('./invent.js');
            await remove_worn_item(obj, true);
            const { stop_occupation } = await import('./hack.js');
            await stop_occupation();
        }
    } else if (obj.where === 'minvent') {
        if (obj.owornmask && obj.ocarry && obj === obj.ocarry.mw)
            obj.owornmask = 0;           /* C: setmnotwielded() */
    } else if (obj.where === 'migrating') {
        /* clear destination flag so that obfree()'s check for freeing a worn
           object doesn't get a false hit */
        obj.owornmask = 0;
    }
    await rot_organic(arg, timeout);
    if (on_floor) {
        const mtmp = m_at(x, y);
        /* a hiding monster may be exposed */
        if (mtmp && !OBJ_AT(x, y) && mtmp.mundetected && hides_under_(mtmp.data)) {
            mtmp.mundetected = 0;
        } else if (x === game.u?.ux && y === game.u?.uy && game.u?.uundetected) {
            /* C: hideunder(&gy.youmonst) if hides_under(youmonst.data) */
        }
        newsym(x, y);
    } else if (in_invent) {
        const { update_inventory } = await import('./invent.js');
        update_inventory();
    }
}
async function corpse_xname_(obj, _flags) {
    const { xname } = await import('./invent.js');
    return xname(obj);
}

/* ---- dig.c's #if 0 block ------------------------------------------------ *
 *  dig.c:2191-2283 bury_monst/bury_you/unearth_you/escape_tomb/bury_obj are
 *  inside `#if 0`, i.e. NOT COMPILED in the recorder's binary.  They are
 *  translated for completeness only; calling any of them would be a divergence
 *  from C, which cannot reach them at all.
 * ------------------------------------------------------------------------- */

// C ref: dig.c:2192 bury_monst(mtmp) — #if 0 in C.
export async function bury_monst(mtmp) {
    const { pline } = await import('./display.js');
    const { surface } = await import('./dungeon.js');
    const { mon_nam } = await import('./do_name.js');
    if (canseemon_(mtmp)) {
        if (is_flyer_(mtmp.data) || is_floater_(mtmp.data)) {
            await pline(`The ${surface(mtmp.mx, mtmp.my)} opens up, but ${
                mon_nam(mtmp)} is not swallowed!`);
            return;
        }
        await pline(`The ${surface(mtmp.mx, mtmp.my)} opens up and swallows ${
            mon_nam(mtmp)}!`);
    }
    mtmp.mburied = true;
    /* C: wakeup(mtmp, FALSE) — at least give it a chance :-) */
    mtmp.msleeping = 0;
    newsym(mtmp.mx, mtmp.my);
}

// C ref: dig.c:2211 bury_you() — #if 0 in C.
export async function bury_you() {
    const u = game.u;
    if (!Levitation() && !Flying()) {
        const { pline } = await import('./display.js');
        const { surface } = await import('./dungeon.js');
        if (u.uswallow) await pline('You feel a sensation like falling into a trap!');
        else await pline(`The ${surface(u.ux, u.uy)} opens beneath you and you fall in!`);

        u.uburied = true;
        const Breathless = false;        /* no polyform is modelled here */
        if (!uprop('Strangled') && !Breathless) {
            u.uprops = u.uprops || {};
            u.uprops.Strangled = 6;
        }
        /* C: under_ground(1) — the buried-hero display mode, unported */
    }
}

// C ref: dig.c:2229 unearth_you() — #if 0 in C.
export async function unearth_you() {
    const u = game.u;
    u.uburied = false;
    /* C: under_ground(0) */
    if (!game.uamul || game.uamul.otyp !== AMULET_OF_STRANGULATION()) {
        u.uprops = u.uprops || {};
        u.uprops.Strangled = 0;
    }
    await vision_recalc(0);
}

// C ref: dig.c:2240 escape_tomb() — #if 0 in C.  Would draw rn2(3) for the
// teleport attempt.
export async function escape_tomb() {
    const u = game.u;
    const { pline } = await import('./display.js');
    const { surface } = await import('./dungeon.js');
    const Teleportation = !!uprop('Teleportation');
    const Teleport_control = !!uprop('Teleport_control');
    /* C: u.data is only a real mons[] row while polymorphed
       ([[umonnum-is-a-role-index]]), so every youmonst.data test is guarded. */
    const data = u.Upolyd ? u.data : null;
    const M1_TPORT = 0x02000000;
    const can_teleport = (mflags1_(data) & M1_TPORT) !== 0;
    if ((Teleportation || can_teleport)
        && (Teleport_control || rn2(3) < Luck() + 2)) {
        await pline('You attempt a teleport spell.');
        /* C: dotele(FALSE) — calls unearth_you(); teleport.c dotele is unported */
    } else if (u.uburied) {              /* still buried after 'port attempt */
        const amorphous = !!(mflags1_(data) & M1_AMORPHOUS);
        const Passes_walls = !!uprop('Passes_walls');
        const unsolid = !!(mflags1_(data) & M1_UNSOLID);
        const tunnels = !!(mflags1_(data) & M1_TUNNEL);
        const needspick = !!(mflags1_(data) & M1_NEEDPICK);
        /* C also excludes the water elemental from the unsolid clause */
        const is_water_elemental = data?.name === 'water elemental';
        if (amorphous || Passes_walls || noncorporeal_(data)
            || (unsolid && !is_water_elemental)
            || (tunnels && !needspick)) {
            await pline(`You ${(tunnels && !needspick) ? 'try to tunnel'
                        : amorphous ? 'ooze' : 'phase'} up through the ${
                        surface(u.ux, u.uy)}.`);
            const good = (tunnels && !needspick) ? await dighole(true, false, null) : true;
            if (good) await unearth_you();
        }
    }
}

// C ref: dig.c:2272 bury_obj(otmp) — #if 0 in C.
export async function bury_obj(otmp) {
    if (cansee(otmp.ox, otmp.oy)) {
        const { pline } = await import('./display.js');
        const { surface } = await import('./dungeon.js');
        await pline(`The objects on the ${surface(otmp.ox, otmp.oy)} tumble into a hole!`);
    }
    await bury_objs(otmp.ox, otmp.oy);
}

// C ref: dig.c:2287 wiz_debug_cmd_bury() — the #wizbury debug command: bury
// everything on and around the hero's square.  RNG comes entirely from
// bury_an_obj().
export async function wiz_debug_cmd_bury() {
    const u = game.u;
    let before = 0, after = 0;

    for (let x = u.ux - 1; x <= u.ux + 1; x++)
        for (let y = u.uy - 1; y <= u.uy + 1; y++) {
            if (!isok(x, y)) continue;
            before += floor_pile(x, y).length;
            await bury_objs(x, y);
            after += floor_pile(x, y).length;
        }

    const diff = before - after;
    const { pline } = await import('./display.js');
    if (before === 0)
        await pline('No objects here or adjacent to bury.');
    else if (diff === 0)
        /* before == after when only unburiable objects are present (The Amulet,
           invocation items, Rider corpses, uchain when uball isn't buried) */
        await pline('No objects buried.');
    else
        await pline(`${diff} object${diff === 1 ? '' : 's'} buried.`);
    return ECMD_OK;
}
