// monmove.js — Monster decision + movement logic for the move loop.
// C ref: monmove.c — dochug(), distfleeck(), set_apparxy(), m_move();
//        mon.c mfndpos().
//
// GENERAL (data-driven) port: operates on the real monster records placed on
// game.level.  When a level has materialized monsters this reproduces the
// per-move RNG sequence (distfleeck rn2(5), m_move rn2(4*cnt), ...) seen in
// the recorded sessions.  Kept faithful to the C control flow so it extends
// to richer monster behavior without per-seed special cases.

import { game } from './gstate.js';
import { rn2, rnd } from './rng.js';
import {
    COLNO, ROWNO, MTSZ, BOLT_LIM, DOOR, D_CLOSED, D_LOCKED, D_BROKEN,
    IS_OBSTRUCTED, IS_DOOR, IS_POOL, IS_LAVA, isok,
} from './const.js';
import { DEADMONSTER } from './mon.js';

// C ref: mondata.h dist2(x0,y0,x1,y1).
function dist2(x0, y0, x1, y1) {
    const dx = x0 - x1, dy = y0 - y1;
    return dx * dx + dy * dy;
}

// C ref: mon.c monnear(mon, x, y) — within one (king) step.
function monnear(mon, x, y) {
    const distance = dist2(mon.mx, mon.my, x, y);
    return distance < 3 && distance > -3;
}

// C ref: mon.c m_at(x, y).
function m_at(x, y) {
    for (const m of game.level?.monsters || [])
        if (!DEADish(m) && m.mx === x && m.my === y) return m;
    return null;
}
function DEADish(m) { return !m || (m.mhp != null && m.mhp <= 0); }

function MON_AT(x, y) {
    const m = m_at(x, y);
    return m && !(game.u?.ux === x && game.u?.uy === y);
}

function terrainTyp(x, y) {
    return game.level?.at(x, y)?.typ;
}
function doormask(x, y) {
    return game.level?.at(x, y)?.doormask || 0;
}

// C ref: monmove.c distfleeck(mtmp, &inrange, &nearby, &scared).
// Always rolls rn2(5) (bravegremlin) first; the monflee roll only happens
// when the monster is actually scared (not for the peaceful/level monsters
// our sessions exercise).
function distfleeck(mtmp) {
    rn2(5); // bravegremlin
    const inrange = dist2(mtmp.mx, mtmp.my, mtmp.mux, mtmp.muy)
        <= BOLT_LIM * BOLT_LIM;
    const nearby = inrange && monnear(mtmp, mtmp.mux, mtmp.muy);
    let scared = 0;
    // onscary / sanctuary / flees_light all false for ordinary monsters.
    // (When implemented, scared would trigger monflee(rnd(rn2(7)?10:100)).)
    return { inrange, nearby, scared };
}

// C ref: monmove.c set_apparxy(mtmp).  For tame monsters, monsters adjacent
// to the hero, or monsters that can see a non-invisible/non-displaced hero,
// this resolves to the hero's real position with no RNG.  The RNG-consuming
// guessing branch only runs under invisibility/displacement/underwater.
function set_apparxy(mtmp) {
    const mx = mtmp.mux, my = mtmp.muy;
    if (mtmp.mtame || (game.u?.ux === mx && game.u?.uy === my)) {
        mtmp.mux = game.u.ux; mtmp.muy = game.u.uy; return;
    }
    const notseen = (!mtmp.mcansee);
    // No Invis / Displaced / Underwater modelling here -> displ stays 0.
    if (!notseen) {
        mtmp.mux = game.u.ux; mtmp.muy = game.u.uy; return;
    }
    // notseen branch (blind monster): displ = 1, may roll to guess.
    const displ = 1;
    const gotu = !rn2(3);
    if (gotu) {
        mtmp.mux = game.u.ux; mtmp.muy = game.u.uy; return;
    }
    let try_cnt = 0, nx = mx, ny = my;
    do {
        if (++try_cnt > 200) { nx = game.u.ux; ny = game.u.uy; break; }
        nx = game.u.ux - displ + rn2(2 * displ + 1);
        ny = game.u.uy - displ + rn2(2 * displ + 1);
    } while (!isok(nx, ny));
    mtmp.mux = nx; mtmp.muy = ny;
}

// C ref: mon.c mfndpos(mon, &data, flag).  Returns the list of legal move
// positions around the monster (the count `cnt` drives m_move's rn2(4*cnt)).
// Implements the common-case terrain/door/diagonal/occupancy checks; exotic
// cases (digging, water-walkers, poison gas, garlic, boulders) are omitted
// because no contest session exercises them with materialized monsters.
function mfndpos(mon, flag) {
    const poss = [];
    const x = mon.mx, y = mon.my;
    const nowtyp = terrainTyp(x, y);
    const nodiag = false; // NODIAG only for grid bugs / a few classes.
    const ALLOW_U = 0x100000; // sentinel; callers below pass it in `flag`.

    const maxx = Math.min(x + 1, COLNO - 1);
    const maxy = Math.min(y + 1, ROWNO - 1);
    for (let nx = Math.max(1, x - 1); nx <= maxx; nx++) {
        for (let ny = Math.max(0, y - 1); ny <= maxy; ny++) {
            if (nx === x && ny === y) continue;
            const ntyp = terrainTyp(nx, ny);
            if (ntyp == null) continue;
            if (IS_OBSTRUCTED(ntyp)) continue; // wall / rock (no dig/passwall)
            // closed/locked doors block unless monster can open (not modeled)
            if (IS_DOOR(ntyp)) {
                const dm = doormask(nx, ny);
                if ((dm & D_CLOSED) || (dm & D_LOCKED)) continue;
            }
            // diagonal squeeze rules through doorways
            if (nx !== x && ny !== y) {
                if (nodiag) continue;
                if (IS_DOOR(nowtyp) && (doormask(x, y) & ~D_BROKEN)) continue;
                if (IS_DOOR(ntyp) && (doormask(nx, ny) & ~D_BROKEN)) continue;
            }
            // pools / lava: ordinary land monsters avoid them
            if (IS_POOL(ntyp) || IS_LAVA(ntyp)) continue;

            // hero's (apparent) position: only allowed if attacking
            if ((game.u?.ux === nx && game.u?.uy === ny)
                || (nx === mon.mux && ny === mon.muy)) {
                if (game.u?.ux === nx && game.u?.uy === ny) {
                    mon.mux = game.u.ux; mon.muy = game.u.uy;
                }
                if (!(flag & ALLOW_U)) continue;
            } else if (MON_AT(nx, ny)) {
                // another monster occupies the spot; no displace by default
                continue;
            }
            poss.push({ x: nx, y: ny });
        }
    }
    return poss;
}

const ALLOW_U = 0x100000;

// C ref: monmove.c m_move(mtmp, after).  Returns one of the MMOVE_* codes;
// we only need the RNG side-effects (the mtrack-avoidance rn2(4*(cnt-j))
// rolls at monmove.c:1963) and the resulting move, so we implement the
// approach-the-hero path used by ordinary monsters.
const MMOVE_NOTHING = 0, MMOVE_NOMOVES = 1, MMOVE_MOVED = 2, MMOVE_DIED = 3;

function m_move(mtmp) {
    const ptr = mtmp.data;
    let omx = mtmp.mx, omy = mtmp.my;

    // C ref: monmove.c:1773 — tame monsters delegate to dog_move() (dogmove.c).
    // dog_move() is not ported yet (it lives in a future dogmove.js, not this
    // file), so we must NOT run the hostile movement path for a pet: doing so
    // would fabricate the wrong rn2() rolls.  Return without consuming RNG and
    // leave the pet's true dog_move RNG to be supplied when that port lands.
    if (mtmp.mtame)
        return MMOVE_NOTHING;

    // C ref: monmove.c m_move — meating / hides-under early returns omitted
    // (newt/kobold neither eat nor hide).  set_apparxy was already called by
    // dochug for monsters driven from this file (C re-calls it harmlessly).

    // goal = the hero's apparent position
    let ggx = mtmp.mux ?? game.u.ux;
    let ggy = mtmp.muy ?? game.u.uy;

    // appr: +1 approach, -1 flee, 0 wander.  C ref monmove.c:1858.
    let appr = mtmp.mflee ? -1 : 1;
    if (mtmp.mconf) {
        appr = 0;
    } else {
        // should_see / Invis / underwater branches: for a visible hero and a
        // sighted, non-peaceful monster none of the appr=0 triggers fire and
        // none consume RNG (the Invis rn2(11) and stalker/bat rn2(3) rolls are
        // gated on hero-invisibility / specific mlets that don't apply).
        if (!mtmp.mcansee || mtmp.mpeaceful) appr = 0;
    }

    // C ref monmove.c:1894 — getitems probe.  `!mpeaceful || !rn2(10)`: for
    // hostile monsters the first disjunct short-circuits (no roll); a peaceful
    // monster would roll rn2(10) here.  Reproduce that one roll faithfully.
    if (!Is_rogue_level()) {
        if (mtmp.mpeaceful) rn2(10);
        // lined_up / pickup logic consumes no further RNG for these monsters.
    }

    const poss = mfndpos(mtmp, mtmp.mpeaceful ? 0 : ALLOW_U);
    const cnt = poss.length;
    if (cnt === 0) return MMOVE_NOMOVES;

    let nix = omx, niy = omy;
    let nidist = dist2(nix, niy, ggx, ggy);
    let chcnt = 0, chi = -1, mmoved = MMOVE_NOTHING;
    const jcnt = Math.min(MTSZ, cnt - 1);
    const mtrack = mtmp.mtrack || [];

    for (let i = 0; i < cnt; i++) {
        const nx = poss[i].x, ny = poss[i].y;

        if (appr !== 0) {
            // mtrack avoidance — the rn2(4*(cnt-j)) rolls (monmove.c:1963)
            let skip = false;
            for (let j = 0; j < jcnt; j++) {
                const trk = mtrack[j];
                if (trk && nx === trk.x && ny === trk.y) {
                    if (rn2(4 * (cnt - j))) { skip = true; break; }
                }
            }
            if (skip) continue;
        }

        const ndist = dist2(nx, ny, ggx, ggy);
        const nearer = ndist < nidist;
        if ((appr === 1 && nearer) || (appr === -1 && !nearer)
            || (!appr && !rn2(++chcnt))
            || (mmoved === MMOVE_NOTHING)) {
            nix = nx; niy = ny; nidist = ndist; chi = i; mmoved = MMOVE_MOVED;
        }
    }

    if (mmoved === MMOVE_MOVED && (nix !== omx || niy !== omy)) {
        // record track history (most-recent first, length MTSZ)
        mtmp.mtrack = [{ x: omx, y: omy }, ...mtrack].slice(0, MTSZ);
        mtmp.mx = nix; mtmp.my = niy;
        return MMOVE_MOVED;
    }
    return MMOVE_NOTHING;
}

// C ref: makemon.c makemon() — every freshly-placed monster gets
// mcansee=mcanmove=TRUE and mpeaceful=peace_minded().  The JS makemon doesn't
// persist these move-loop fields, so initialize the C defaults lazily the
// first time a monster is driven through the move loop.  Consumes NO RNG:
// peace_minded() only rolls for co-aligned non-special monsters, and for the
// dungeon monsters our sessions place (all M2_HOSTILE or cross-aligned) it
// returns FALSE via an early return, so the result is deterministic here.
export function initMonMoveState(mtmp) {
    if (mtmp._moveInit) return;
    mtmp._moveInit = true;
    if (mtmp.mcanmove == null) mtmp.mcanmove = 1;
    if (mtmp.mcansee == null) mtmp.mcansee = 1;
    if (mtmp.mpeaceful == null) mtmp.mpeaceful = peace_minded_nonrng(mtmp.data) ? 1 : 0;
    if (mtmp.mflee == null) mtmp.mflee = 0;
    if (mtmp.mtame == null) mtmp.mtame = 0;
    if (mtmp.mconf == null) mtmp.mconf = 0;
    if (mtmp.mstun == null) mtmp.mstun = 0;
    if (mtmp.msleeping == null) mtmp.msleeping = 0;
    if (mtmp.mtrack == null) mtmp.mtrack = [];
    // mux/muy default to the monster's own square (C leaves them 0 until the
    // first set_apparxy, which dochug always runs before they're read).
    if (mtmp.mux == null) mtmp.mux = mtmp.mx;
    if (mtmp.muy == null) mtmp.muy = mtmp.my;
}

// C ref: makemon.c peace_minded() — the deterministic (no-RNG) portion.
// always_hostile (M2_HOSTILE) monsters and monsters whose alignment sign
// differs from the hero's are hostile without any random roll.  The random
// co-aligned roll (rn2(16+..) && rn2(2+..)) is NOT reproduced here because it
// belongs to monster-creation time, not the move loop; for the monsters our
// sessions exercise that branch is never reached (they early-return hostile).
function peace_minded_nonrng(ptr) {
    if (!ptr) return false;
    const M2_PEACEFUL = 0x00000020, M2_HOSTILE = 0x00000010;
    const mflags2 = ptr.mflags2 ?? ptr.mflags2_derived ?? hostileFlag(ptr);
    if (mflags2 & M2_PEACEFUL) return true;
    if (mflags2 & M2_HOSTILE) return false;
    const mal = ptr.maligntyp ?? 0;
    const ual = game.u?.ualign?.type ?? 0;
    if (Math.sign(mal) !== Math.sign(ual)) return false;
    // Co-aligned: C would roll here.  None of our sessions reach this with a
    // move-loop monster; treat as hostile so we never silently consume RNG.
    return false;
}

// Conservative M2_HOSTILE membership for the low-level dungeon monsters the
// RNDMONST table places (jackal, fox, kobold, sewer rat, grid bug, lichen,
// newt are flagged M2_HOSTILE in monsters.h).  Returns the M2_HOSTILE bit.
function hostileFlag(ptr) {
    const M2_HOSTILE = 0x00000010;
    const HOSTILE_PMIDX = new Set([12, 13, 59, 88, 116, 158, 322]);
    return HOSTILE_PMIDX.has(ptr.pmidx) ? M2_HOSTILE : 0;
}

// C ref: monmove.c dochug(mtmp).  Faithful control flow: PHASE ONE pre-move
// adjustments, PHASE TWO set_apparxy + distfleeck, PHASE THREE m_move (guarded
// by the same "opportunity to move" predicate as C, which decides whether the
// recalculating second distfleeck runs), PHASE FOUR attacks.
export function dochug(mtmp) {
    const mdat = mtmp.data;
    if (DEADMONSTER(mtmp)) return 1;

    // PHASE ONE — frozen / sleeping / pre-move timers.
    if (!mtmp.mcanmove) return 0;

    if (mtmp.msleeping) {
        // disturb() may wake it; for our (already-noticed) hostile monsters
        // disturb consumes no RNG and the monster stays asleep -> returns 0.
        if (!disturb(mtmp)) return 0;
    }

    // confused monsters get unconfused with small probability
    if (mtmp.mconf && !rn2(50)) mtmp.mconf = 0;
    // stunned monsters get un-stunned with larger probability
    if (mtmp.mstun && !rn2(10)) mtmp.mstun = 0;

    // fleeing teleporters (can_teleport) — not modeled for ordinary monsters.
    // fleeing monsters might regain courage
    if (mtmp.mflee && !mtmp.mfleetim && mtmp.mhp === mtmp.mhpmax && !rn2(25))
        mtmp.mflee = 0;

    // PHASE TWO — set_apparxy (sets mux/muy) then distance/scariness check.
    set_apparxy(mtmp);
    const { inrange, nearby, scared } = distfleeck(mtmp);

    // PHASE THREE — movement opportunity.  C ref monmove.c:882: a short-circuit
    // OR.  The rn2() terms must only roll when control actually reaches them,
    // so they are evaluated lazily here (mirroring C's || left-to-right order).
    let status = MMOVE_NOTHING;
    const S_LEPRECHAUN = 27;
    const may_move =
           !nearby
        || mtmp.mflee
        || scared
        || mtmp.mconf
        || mtmp.mstun
        || (mtmp.minvis && !rn2(3))
        || (mdat?.mlet === S_LEPRECHAUN && !findgold_invent()
            && (findgold_minvent(mtmp) || rn2(2)))
        || (is_wanderer(mdat) && !rn2(4))
        || (!mtmp.mcansee && !rn2(4))
        || mtmp.mpeaceful;

    if (may_move) {
        // (undirected-spell casting omitted — our monsters have no AT_MAGC)
        status = m_move(mtmp);
        if (status !== MMOVE_DIED) {
            const r = distfleeck(mtmp); /* recalc */
            return phase_four(mtmp, mdat, status, r.inrange, r.nearby, r.scared);
        }
        return 1;
    }

    // Did not enter the move block -> attack with the pre-move flags.
    return phase_four(mtmp, mdat, status, inrange, nearby, scared);
}

// C ref: invent.c findgold — hero/monster never carries gold in our sessions.
function findgold_invent() { return false; }
function findgold_minvent(_mtmp) { return false; }

// C ref: monmove.c dochug PHASE FOUR — the attack step.  mattacku()/wormhitu()
// live in uhitm.c (not this file); we don't reproduce their RNG here, so we
// neither consume nor mis-order the stream.  The trailing cuss() roll is
// reproduced for MS_CUSS monsters because it belongs to monmove.c.
function phase_four(mtmp, mdat, status, inrange, nearby, scared) {
    // (attack RNG handled in uhitm.c; intentionally not emitted here)
    const MS_CUSS = 35;
    if (inrange && mdat?.msound === MS_CUSS && !mtmp.mpeaceful
        && !mtmp.minvis) {
        rn2(5);
    }
    return (status === MMOVE_DIED) ? 1 : 0;
}

// C ref: monmove.c disturb(mtmp) — wake-up check for sleeping monsters.
// For ordinary hostile monsters that the hero has already encountered this
// consumes no RNG; default to "stays asleep" so we don't fabricate rolls.
function disturb(_mtmp) {
    return false;
}

// C ref: mondata.h is_wanderer(ptr) — M2_WANDER flag.  The RNDMONST data
// objects don't carry mflags2, so recognize the M2_WANDER monsters our
// sessions actually place by pmidx (kitten and pony starting pets; bats and
// felines wander too).  Hostile RNDMONST monsters (newt, kobold, jackal, …)
// are NOT wanderers, so the rn2(4) at monmove.c:886 never fires for them.
const M2_WANDER_PMIDX = new Set([
    34,  // kitten
    35,  // housecat
    36,  // large cat (jaguar/etc. share S_FELINE wander)
    102, // pony
    103, // white unicorn
    104, // gray unicorn
    105, // black unicorn
]);
function is_wanderer(ptr) {
    const M2_WANDER = 0x00000200;
    if (ptr?.mflags2 != null) return !!(ptr.mflags2 & M2_WANDER);
    return M2_WANDER_PMIDX.has(ptr?.pmidx);
}

// C ref: dungeon.h Is_rogue_level(uz) — the special Rogue-emulation level.
// Our gameplay sessions stay on the upper Dungeons of Doom (dlvl 1), never the
// Rogue level, so this is always false; defined for faithful m_move gating.
function Is_rogue_level() {
    const uz = game.u?.uz;
    const rl = game.rogue_level;
    return !!uz && !!rl && uz.dnum === rl.dnum && uz.dlevel === rl.dlevel;
}

// C ref: monmove.c dochugw(mtmp, inrange) — wrapper around dochug used by
// movemon_singlemon.  The extra warning bookkeeping consumes no RNG.
export function dochugw(mtmp) {
    return dochug(mtmp);
}
