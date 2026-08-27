// worm.js — long worm tail segments.
// C ref: src/worm.c.  A long worm occupies more than one square: the monster
// itself is the head, and `wormno` indexes a per-level chain of tail segments
// held in wtails[]/wheads[].  The creation side (get_wormno/initworm/
// place_worm_tail_randomly) is what makemon() calls at level-generation time
// and is the only part wired up; everything below the divider is translated
// but INERT until a measured pass wires each call site.

import { game } from './gstate.js';
import { rn2, rnd, rn1, d } from './rng.js';
import { isok, COLNO, ROWNO, NORMAL_SPEED, MHPMAX, MCORPSENM } from './const.js';
import { newsym, m_at, show_glyph_cell, Hallucination_u, pline } from './display.js';
import { NO_COLOR, ATR_INVERSE } from './terminal.js';
import { random_monster } from './disprng.js';
import { monster_by_pmidx } from './makemon.js';
import { mon_nam, Monnam } from './do_name.js';
import { cansee } from './vision.js';
import { dist2 } from './hacklib.js';
// mon.js (mcalcmove), monmove.js (mattacku) and uhitm.js (canspotmon) cannot be
// static imports here: makemon.js imports this file, so each of those three
// closes a cycle that dies with "Cannot access 'objects'/'WEAPON_CLASS' before
// initialization" at module-evaluation time.  They are pulled in lazily at the
// call site, the way apply.js/attrib.js do — which is also why worm_move() is
// async even though C's is not.

// C ref: include/decl.h MAX_NUM_WORMS.
const MAX_NUM_WORMS = 32;

// C ref: worm.c xdir/ydir come from decl.c — the 8 compass directions in the
// canonical order used by every dirs[] shuffle.
const XDIR = [-1, -1, 0, 1, 1, 1, 0, -1];
const YDIR = [0, -1, -1, -1, 0, 1, 1, 1];
const N_DIRS = 8;

function worm_state() {
    const lev = game.level;
    if (!lev) return null;
    if (!lev.wtails) {
        lev.wtails = new Array(MAX_NUM_WORMS).fill(null);
        lev.wheads = new Array(MAX_NUM_WORMS).fill(null);
        lev.wgrowtime = new Array(MAX_NUM_WORMS).fill(0);
    }
    return lev;
}

// C ref: worm.c get_wormno() — the lowest free wtails[] slot, or 0 when the
// level is already full of worms.
export function get_wormno() {
    const lev = worm_state();
    if (!lev) return 0;
    for (let n = 1; n < MAX_NUM_WORMS; n++)
        if (!lev.wheads[n]) return n;
    return 0;
}

function newseg() { return { nseg: null, wx: 0, wy: 0 }; }

// C ref: worm.c create_worm_tail() — a chain of (num_segs + 1) segments, or
// NULL when num_segs is 0.  No RNG.
function create_worm_tail(num_segs) {
    if (!num_segs) return null;
    const new_tail = newseg();
    let curr = new_tail;
    for (let i = 0; i < num_segs; i++) {
        curr.nseg = newseg();
        curr = curr.nseg;
    }
    return new_tail;
}

// C ref: worm.c initworm() — hand the worm its tail chain and put the head
// segment on the worm's own square.  No RNG.
export function initworm(worm, wseg_count) {
    const lev = worm_state();
    if (!lev) return;
    const wnum = worm.wormno;
    const new_tail = create_worm_tail(wseg_count);
    let seg;
    if (new_tail) {
        lev.wtails[wnum] = new_tail;
        for (seg = new_tail; seg.nseg; seg = seg.nseg) continue;
        lev.wheads[wnum] = seg;
    } else {
        seg = newseg();
        lev.wtails[wnum] = lev.wheads[wnum] = seg;
    }
    seg.wx = worm.mx;
    seg.wy = worm.my;
    lev.wgrowtime[wnum] = 0;
}

// C ref: worm.c count_wsegs() — segments BEHIND the tail's first one.
export function count_wsegs(mtmp) {
    const lev = worm_state();
    if (!lev || !mtmp.wormno || !lev.wtails[mtmp.wormno]) return 0;
    let i = 0;
    for (let curr = lev.wtails[mtmp.wormno].nseg; curr; curr = curr.nseg) i++;
    return i;
}

// C ref: trap.c rnd_nextto_goodpos() — shuffle the 8 compass directions
// (one rn2(i) per i from N_DIRS down to 1) and take the first goodpos()
// neighbour.  The shuffle draws happen up front, unconditionally.
export function rnd_nextto_goodpos(pos, mtmp, goodposfn) {
    const dirs = [];
    for (let i = 0; i < N_DIRS; i++) dirs.push(i);
    for (let i = N_DIRS; i > 0; --i) {
        const j = rn2(i);
        const k = dirs[j];
        dirs[j] = dirs[i - 1];
        dirs[i - 1] = k;
    }
    for (let i = 0; i < N_DIRS; i++) {
        const nx = pos.x + XDIR[dirs[i]];
        const ny = pos.y + YDIR[dirs[i]];
        if (isok(nx, ny) && goodposfn(nx, ny, mtmp)) {
            pos.x = nx; pos.y = ny;
            return true;
        }
    }
    return false;
}

// C ref: worm.c place_worm_seg() — a tail segment occupies its square just
// like a monster does, so m_at() finds the worm there.  No RNG.
function place_worm_seg(worm, x, y) {
    const lev = game.level;
    if (!lev) return;
    if (!lev.wormsegs) lev.wormsegs = [];
    lev.wormsegs.push({ worm, x, y });
}

// C ref: worm.c place_worm_tail_randomly() — lay the tail out on squares
// adjacent to the head, walking backwards; truncate when there is no room.
export function place_worm_tail_randomly(worm, x, y, goodposfn) {
    const lev = worm_state();
    if (!lev) return;
    const wnum = worm.wormno;
    let curr = lev.wtails[wnum];
    if (!wnum || !lev.wtails[wnum] || !lev.wheads[wnum]) return;

    if (lev.wtails[wnum] === lev.wheads[wnum]) {
        curr.wx = worm.mx; curr.wy = worm.my;
        return;
    }
    // The old head segment leaves the map; it becomes the new final tail.
    lev.wheads[wnum].wx = lev.wheads[wnum].wy = 0;

    let new_tail = curr;
    lev.wheads[wnum] = new_tail;
    curr = curr.nseg;
    new_tail.nseg = null;
    new_tail.wx = x;
    new_tail.wy = y;

    const o = { x, y };
    while (curr) {
        const pos = { x: o.x, y: o.y };
        if (rnd_nextto_goodpos(pos, worm, goodposfn)) {
            place_worm_seg(worm, pos.x, pos.y);
            curr.wx = (o.x = pos.x);
            curr.wy = (o.y = pos.y);
            lev.wtails[wnum] = curr;
            curr = curr.nseg;
            lev.wtails[wnum].nseg = new_tail;
            new_tail = lev.wtails[wnum];
        } else {
            // No room for the rest of the tail — truncate it.
            curr = null;
        }
    }
}

// The worm-tail segment standing on (x,y), if any.  Used by the display: a
// tail square renders as S_wormtail ('~'), not as the worm's own letter.
export function worm_seg_at(x, y) {
    for (const s of game.level?.wormsegs || [])
        if (s.x === x && s.y === y) return s.worm;
    return null;
}

// ───────────────────────────────────────────────────────────────────────────
// The rest of src/worm.c, translated but NOT yet wired into any call site.
//
// Representation note that every function below depends on: C keeps ONE grid,
// svl.level.monsters[x][y], and worm.c's place_worm_seg() writes the worm's
// own pointer into it for each TAIL square (the hidden head segment is never
// placed — the head square is owned by place_monster()).  This port splits
// that grid in two: a real monster carries its own mx/my and is found by
// display.js m_at(), while tail segments live in the level's `wormsegs` side
// list (see place_worm_seg above / worm_seg_at below).  grid_mon_at() and
// remove_monster() below re-unify the two halves so the C reads and writes
// translate one-for-one.

// C ref: rm.h m_at(x,y) == svl.level.monsters[x][y] — including a worm TAIL
// square, which holds the worm itself.  Segments are checked first because
// place_worm_seg() is what wrote them.
function grid_mon_at(x, y) {
    return worm_seg_at(x, y) || m_at(x, y);
}

// C ref: rm.h remove_monster(x,y) == svl.level.monsters[x][y] = 0.  One grid
// slot, so exactly one of the two halves is cleared: a tail segment leaves the
// side list, otherwise the monster leaves the map grid (mx/my = 0, the same
// thing vault.js's local copy does).
function remove_monster(x, y) {
    const segs = game.level?.wormsegs;
    if (segs) {
        const i = segs.findIndex((s) => s.x === x && s.y === y);
        if (i >= 0) { segs.splice(i, 1); return; }
    }
    const mon = m_at(x, y);
    if (mon) { mon.mx = 0; mon.my = 0; }
}

function impossible(...args) {
    if (game.debugImpossible) console.warn('impossible:', ...args);
}

// C ref: hacklib.c distu(x, y) — SQUARED distance from the hero.
function distu(x, y) { return dist2(x, y, game.u?.ux ?? 0, game.u?.uy ?? 0); }

function s_suffix(s) { return /s$/.test(s) ? `${s}'` : `${s}'s`; }
// C ref: hack.h plur(x) — "" for 1, "s" otherwise.
function plur(x) { return x === 1 ? '' : 's'; }

// C ref: monsters.h — PM_LONG_WORM is the species wormgone() unflags, and
// PM_LONG_WORM_TAIL (== makemon.js SPECIAL_PM) is the segment glyph species.
const PM_LONG_WORM = 114;
const PM_LONG_WORM_TAIL = 330;

// C ref: config.h:637 — EXTRA_SANITY_CHECKS *is* defined in the recorder's
// build, so wormno_sanity_check() has a live body.
const EXTRA_SANITY_CHECKS = true;

// C ref: monst.h struct wseg = { struct wseg *nseg; coordxy wx, wy; } with
// coordxy == int16_t (global.h:71): 8-byte pointer + 2 + 2, padded to 16 on
// the recorder's LP64 build.  Only #stats reads this.
const SIZEOF_WSEG = 16;

/*
 *  toss_wsegs()
 *
 *  Get rid of all worm segments on and following the given pointer curr.
 *  The display may or may not need to be updated as we free the segments.
 */
// C ref: worm.c:139 toss_wsegs(curr, display_update).  `dealloc_seg` has no
// JS analogue — dropping the chain reference is what frees it.  The `curr->wx`
// test is C's genocided-while-migrating_mon guard: a segment that is not on
// the map has wx == 0 and must not clear grid slot column 0.
export function toss_wsegs(curr, display_update) {
    let nxtseg;

    while (curr) {
        nxtseg = curr.nseg;

        /* remove from level.monsters[][];
           need to check curr->wx for genocided while migrating_mon */
        if (curr.wx) {
            remove_monster(curr.wx, curr.wy);

            /* update screen before deallocation */
            if (display_update)
                newsym(curr.wx, curr.wy);
        }

        curr = nxtseg;
    }
}

/*
 *  shrink_worm()
 *
 *  Remove the tail segment of the worm (the starting segment of the list).
 */
// C ref: worm.c:165 shrink_worm(wnum).
export function shrink_worm(wnum) {
    const lev = worm_state();
    if (!lev) return;

    if (lev.wtails[wnum] === lev.wheads[wnum])
        return; /* no tail */

    const seg = lev.wtails[wnum];
    lev.wtails[wnum] = seg.nseg;
    seg.nseg = null;
    toss_wsegs(seg, true);
}

/*
 *  worm_move()
 *
 *  Check for mon->wormno before calling this function!
 *
 *  Move the worm.  Maybe grow.
 */
// C ref: worm.c:185 worm_move(worm).  RNG order in the growth arm, exactly as
// C's comma-separated declarators evaluate it: mcalcmove(worm, FALSE) FIRST,
// then rn1(10, 2), then d(2, 2) for the HP gain.  A brand-new worm
// (wgrowtime == 0) takes the rnd(5) arm instead and never reaches the rn1.
export async function worm_move(worm) {
    const lev = worm_state();
    if (!lev) return;
    const wnum = worm.wormno;

    /*
     *  Place a segment at the old worm head.  The head has already moved.
     */
    const seg = lev.wheads[wnum];
    place_worm_seg(worm, seg.wx, seg.wy);
    newsym(seg.wx, seg.wy); /* display the new segment */

    /*
     *  Create a new dummy segment head and place it at the end of the list.
     */
    const new_seg = newseg();
    new_seg.wx = worm.mx;
    new_seg.wy = worm.my;
    new_seg.nseg = null;
    seg.nseg = new_seg;        /* attach it to the end of the list */
    lev.wheads[wnum] = new_seg; /* move the end pointer */

    if (lev.wgrowtime[wnum] <= (game.moves || 0)) {
        let whplimit, whpcap, prev_mhp, wsegs = count_wsegs(worm);

        /* first set up for the next time to grow */
        if (!lev.wgrowtime[wnum]) {
            /* new worm; usually grow a tail segment on its next turn */
            lev.wgrowtime[wnum] = (game.moves || 0) + rnd(5);
        } else {
            const { mcalcmove } = await import('./mon.js');
            const mmove = mcalcmove(worm, false);
            /* prior to 5.0.0, next-grow increment was 3..17 but since it got
               checked every 4th turn when the speed 3 worm got to move, it was
               effectively 0..5 */
            let incr = rn1(10, 2); /* 2..12; after adjusting for long worm
                                    * speed of 3, effective value is 8..48 */

            incr = Math.trunc((incr * NORMAL_SPEED) / Math.max(mmove, 1));
            lev.wgrowtime[wnum] = (game.moves || 0) + incr;
        }

        /* increase HP based on number of segments; if it has shrunk, it
           won't gain new HP until regaining previous peak segment count */
        whplimit = !worm.m_lev ? 4 : (8 * worm.m_lev);
        /* note: wsegs includes the hidden segment co-located with the head */
        if (wsegs > 33) { whplimit += 2 * (wsegs - 33); wsegs = 33; }
        if (wsegs > 22) { whplimit += 4 * (wsegs - 22); wsegs = 22; }
        if (wsegs > 11) { whplimit += 6 * (wsegs - 11); wsegs = 11; }
        whplimit += 8 * wsegs;
        if (whplimit > MHPMAX)
            whplimit = MHPMAX;

        prev_mhp = worm.mhp;
        worm.mhp += d(2, 2); /* 2..4, average 3 */
        whpcap = Math.max(whplimit, worm.mhpmax);
        if (worm.mhp < whpcap) {
            /* can't exceed segment-derived limit unless level increase after
               peak tail growth has already done so */
            if (worm.mhp > whplimit)
                worm.mhp = Math.max(prev_mhp, whplimit);
            if (worm.mhp > worm.mhpmax)
                worm.mhpmax = worm.mhp;
        } else {
            if (worm.mhp > worm.mhpmax)
                worm.mhp = worm.mhpmax;
        }
    } else {
        /* The worm doesn't grow, so the last segment goes away. */
        shrink_worm(wnum);
    }
}

/*
 *  worm_nomove()
 *
 *  Check for mon->wormno before calling this function!
 *
 *  The worm doesn't move, so it should shrink.
 */
// C ref: worm.c:270 worm_nomove(worm).  The d(2,2) is drawn only when the
// current HP still exceeds the (already shrunk) segment count.
export function worm_nomove(worm) {
    shrink_worm(worm.wormno); /* shrink */

    if (worm.mhp > count_wsegs(worm)) {
        worm.mhp -= d(2, 2); /* 2..4, average 3; note: mhpmax not changed! */
        if (worm.mhp < 1)
            worm.mhp = 1;
    }
}

/*
 *  wormgone()
 *
 *  Kill a worm tail.  Also takes the head off the map.  Caller needs to
 *  keep track of what its coordinates were if planning to put it back.
 *
 *  Should only be called when mon->wormno is non-zero.
 */
// C ref: worm.c:290 wormgone(worm).  Note that C *continues* after the
// impossible() when wormno is 0 ("runs to completion"), so the guard must not
// return early.  No RNG.
export function wormgone(worm) {
    const lev = worm_state();
    if (!lev) return;
    const wnum = worm.wormno;

    if (!wnum) /* note: continuing with wnum==0 runs to completion */
        impossible('wormgone: wormno is 0');

    worm.wormno = 0; /* still a long worm but doesn't grow/shrink anymore */
    /*
     *  This will also remove the real monster (ie 'w') from its
     *  position in level.monsters[][].  (That happens when removing
     *  the hidden tail segment which is co-located with the head.)
     */
    toss_wsegs(lev.wtails[wnum], true);

    lev.wheads[wnum] = lev.wtails[wnum] = null;
    lev.wgrowtime[wnum] = 0;

    /* when a long worm gets created by a polymorph zap, it gets flagged with
       MCORPSENM()==PM_LONG_WORM so that the same zap won't trigger another
       polymorph if it hits the new tail */
    if (worm.data?.pmidx === PM_LONG_WORM && has_mcorpsenm(worm))
        set_mcorpsenm(worm, NON_PM); /* no longer polymorph-proof */
}

// C ref: mextra.h:225/234 MCORPSENM(mon) / has_mcorpsenm(mon).  const.js
// exports the reader; this port keeps the value on mon.mextra.mcorpsenm and
// makemon.js also mirrors it as mon.mcorpsenm, so both are written.
const NON_PM = -1;
function has_mcorpsenm(mon) { return !!mon?.mextra && MCORPSENM(mon) !== NON_PM; }
function set_mcorpsenm(mon, v) {
    if (mon.mextra) mon.mextra.mcorpsenm = v;
    mon.mcorpsenm = v;
}

/*
 *  wormhitu()
 *
 *  Check for mon->wormno before calling this function!
 *
 *  If the hero is near any part of the worm, the worm will try to attack.
 *  Returns 1 if the worm dies (poly'd hero with passive counter-attack)
 *  or 0 if it doesn't.
 */
// C ref: worm.c:337 wormhitu(worm).  The loop stops BEFORE wheads[] on
// purpose: the dummy segment sharing the head's square has already had its
// chance to attack.  async because the port's mattacku() is.
export async function wormhitu(worm) {
    const lev = worm_state();
    if (!lev) return 0;
    const wnum = worm.wormno;
    const { mattacku } = await import('./monmove.js');

    for (let seg = lev.wtails[wnum]; seg !== lev.wheads[wnum]; seg = seg.nseg)
        if (distu(seg.wx, seg.wy) < 3)
            if (await mattacku(worm))
                return 1; /* your passive ability killed the worm */
    return 0;
}

/*  cutworm()
 *
 *  Check for mon->wormno before calling this function!
 *
 *  When hitting a worm (worm) at position x, y, with a weapon (weap),
 *  there is a chance that the worm will be cut in half, and a chance
 *  that both halves will survive.
 */
// C ref: worm.c:363 cutworm(worm, x, y, cuttier).  RNG order: rnd(20) is drawn
// BEFORE the segment is located and before any early return past the head/
// wormno checks; then rn2(3) only when m_lev >= 3 (C short-circuits the &&);
// then clone_mon()'s own draws; then d(m_lev, 8) for the new worm followed by
// d(m_lev, 8) for the old one, both AFTER the m_lev decrement.
//
// mon.c clone_mon() is not ported yet, so it arrives as `clone_monfn` the way
// place_worm_tail_randomly() above takes `goodposfn`.  Without it the call
// takes C's own "clone_mon() failed" arm, which draws nothing extra.
export async function cutworm(worm, x, y, cuttier, clone_monfn) {
    const lev = worm_state();
    if (!lev) return;
    const wnum = worm.wormno;

    if (!wnum)
        return; /* bullet-proofing */

    if (x === worm.mx && y === worm.my)
        return; /* hit on head */

    /* cutting goes best with a cuttier weapon */
    let cut_chance = rnd(20); /* Normally     1-16 does not cut, 17-20 does, */
    if (cuttier)
        cut_chance += 10;     /* with a blade 1- 6 does not cut,  7-20 does. */

    if (cut_chance < 17)
        return; /* not good enough */

    /* Find the segment that was attacked. */
    let curr = lev.wtails[wnum];

    while ((curr.wx !== x) || (curr.wy !== y)) {
        curr = curr.nseg;
        if (!curr) {
            impossible('cutworm: no segment at (%d,%d)', x, y);
            return;
        }
    }

    /* If this is the tail segment, then the worm just loses it. */
    if (curr === lev.wtails[wnum]) {
        shrink_worm(wnum);
        return;
    }

    /*
     *  Split the worm.  The tail for the new worm is the old worm's tail.
     *  The tail for the old worm is the segment that follows "curr",
     *  and "curr" becomes the dummy segment under the new head.
     */
    const new_tail = lev.wtails[wnum];
    lev.wtails[wnum] = curr.nseg;
    curr.nseg = null; /* split the worm */

    /*
     *  At this point, the old worm is correct.  Any new worm will have
     *  its head at "curr" and its tail at "new_tail".  The old worm
     *  must be at least level 3 in order to produce a new worm.
     */
    let new_worm = null;
    const new_wnum = (worm.m_lev >= 3 && !rn2(3)) ? get_wormno() : 0;
    if (new_wnum) {
        remove_monster(x, y); /* clone_mon puts new head here */
        /* clone_mon() will fail if enough long worms have been created to
           have them be marked as extinct or if the hit that cut the current
           one has dropped it down to 1 HP */
        new_worm = clone_monfn ? await clone_monfn(worm, x, y) : null;
    }

    /* Sometimes the tail end dies. */
    if (!new_worm) {
        place_worm_seg(worm, x, y); /* place the "head" segment back */
        if (game.context?.mon_moving) {
            const { canspotmon } = await import('./uhitm.js');
            if (canspotmon(worm))
                await pline(`Part of ${s_suffix(mon_nam(worm))} tail has been cut off.`);
        } else
            await pline(`You cut part of the tail off of ${mon_nam(worm)}.`);
        toss_wsegs(new_tail, true);
        if (worm.mhp > 1)
            worm.mhp = Math.trunc(worm.mhp / 2);
        return;
    }

    new_worm.wormno = new_wnum; /* affix new worm number */
    new_worm.mcloned = 0;       /* treat second worm as a normal monster */

    /* Devalue the monster level of both halves of the worm.
       Note: m_lev is always at least 3 in order to get this far. */
    worm.m_lev = Math.max(worm.m_lev - 2, 3);
    new_worm.m_lev = worm.m_lev;

    /* Calculate the lower-level mhp; use <N>d8 for long worms.
       Can't use newmonhp() here because it would reset m_lev. */
    new_worm.mhpmax = new_worm.mhp = d(new_worm.m_lev, 8);
    worm.mhpmax = d(worm.m_lev, 8); /* new maxHP for old worm */
    if (worm.mhpmax < worm.mhp)
        worm.mhp = worm.mhpmax;

    lev.wtails[new_wnum] = new_tail; /* We've got all the info right now */
    lev.wheads[new_wnum] = curr;     /* so we can do this faster than    */
    lev.wgrowtime[new_wnum] = 0;     /* trying to call initworm().       */

    /* Place the new monster at all the segment locations. */
    place_wsegs(new_worm, worm);

    if (game.context?.mon_moving)
        await pline(`${Monnam(worm)} is cut in half.`);
    else
        await pline(`You cut ${mon_nam(worm)} in half.`);
}

/*
 *  see_wsegs()
 *
 *  Refresh all of the segments of the given worm.  This is only called
 *  from see_monster() in display.c or when a monster goes minvis.
 */
// C ref: worm.c:519 see_wsegs(worm) — stops at wheads[], so the hidden
// head-square segment is not redrawn (newsym() on the head is the caller's).
export function see_wsegs(worm) {
    const lev = worm_state();
    if (!lev) return;
    let curr = lev.wtails[worm.wormno];

    while (curr !== lev.wheads[worm.wormno]) {
        newsym(curr.wx, curr.wy);
        curr = curr.nseg;
    }
}

/*
 *  detect_wsegs()
 *
 *  Display all of the segments of the given worm for detection.
 */
// C ref: worm.c:536 detect_wsegs(worm, use_detection_glyph).  The
// what_mon(PM_LONG_WORM_TAIL, newsym_rn2) draw happens ONCE, before the loop,
// so while Hallucination every segment of this worm shows the SAME re-rolled
// species — exactly one rn2_on_display_rng(NUMMONS) per call, not one per
// segment.
//
// C's three glyph macros (display.h:639/642/648) differ only in the GLYPH_*
// offset, i.e. in the mgflags the tty then sees; the species and colour are
// identical.  win/tty/wintty.c:3927-3936 turns MG_PET into iflags.wc2_petattr
// when hilite_pet is set and MG_DETECT into ATR_INVERSE when use_inverse is
// set.  The gender term only selects between two glyph offsets that render
// the same in tty, so it does not appear below.
//
// The pet arm here is NOT gated on Hallucination the way display.js's
// display_monster() pet highlight is: detect_wsegs() picks petnum_to_glyph()
// off worm->mtame alone, so a hallucinated detected pet worm keeps its
// highlight even though its species was re-rolled.
export function detect_wsegs(worm, use_detection_glyph) {
    const lev = worm_state();
    if (!lev) return;
    let curr = lev.wtails[worm.wormno];
    const what_tail = Hallucination_u() ? random_monster() : PM_LONG_WORM_TAIL;
    const row = monster_by_pmidx(what_tail);
    const ch = row?.mlet || 'x';
    const color = row?.mcolor ?? NO_COLOR;
    const attr = use_detection_glyph
        ? ((game.flags?.use_inverse !== false) ? ATR_INVERSE : 0)
        : (worm.mtame && game.flags?.hilite_pet) ? ATR_INVERSE : 0;

    while (curr !== lev.wheads[worm.wormno]) {
        show_glyph_cell(curr.wx, curr.wy, ch, color, false, attr);
        curr = curr.nseg;
    }
}

/*
 *  save_worm()
 *
 *  Save the worm information for later use.  The count is the number
 *  of segments, including the dummy.  Called from save.c.
 */
// C ref: worm.c:565 save_worm(nhfp).  js/storage.js is frozen and owns the
// wire format, so this follows track.js save_track()'s convention: return the
// record, let the caller store it.  `release` is C's release_data(nhfp) — the
// arm that frees the segments and zeroes the arrays on a level change.
export function save_worm(release = true) {
    const lev = worm_state();
    if (!lev) return { segs: [], wgrowtime: [] };

    const segs = [];
    for (let i = 1; i < MAX_NUM_WORMS; i++) {
        let count = 0;
        for (let curr = lev.wtails[i]; curr; curr = curr.nseg) count++;
        /* Save number of segments, then the segment locations */
        const pts = [];
        if (count)
            for (let curr = lev.wtails[i]; curr; curr = curr.nseg)
                pts.push({ wx: curr.wx, wy: curr.wy });
        segs[i] = pts;
    }
    const wgrowtime = [];
    for (let i = 0; i < MAX_NUM_WORMS; ++i) wgrowtime[i] = lev.wgrowtime[i];

    if (release) {
        /* Free the segments only.  savemonchn() will take care of the
         * monsters. */
        for (let i = 1; i < MAX_NUM_WORMS; i++) {
            if (!lev.wtails[i])
                continue;
            lev.wheads[i] = lev.wtails[i] = null;
            lev.wgrowtime[i] = 0;
        }
    }
    return { segs, wgrowtime };
}

/*
 *  rest_worm()
 *
 *  Restore the worm information from the save file.  Called from restore.c
 */
// C ref: worm.c:606 rest_worm(nhfp).  Faithful to two C quirks: wtails[i] is
// only assigned when the slot has at least one segment (a zero count leaves a
// stale tail pointer alone), while wheads[i] is ALWAYS assigned — to NULL when
// the count was zero.
export function rest_worm(saved) {
    const lev = worm_state();
    if (!lev) return;
    const segs = saved?.segs || [];

    for (let i = 1; i < MAX_NUM_WORMS; i++) {
        const pts = segs[i] || [];
        const count = pts.length;

        /* Get the segments. */
        let curr = null;
        for (let j = 0; j < count; j++) {
            const temp = newseg();
            temp.nseg = null;
            temp.wx = pts[j].wx | 0;
            temp.wy = pts[j].wy | 0;
            if (curr)
                curr.nseg = temp;
            else
                lev.wtails[i] = temp;
            curr = temp;
        }
        lev.wheads[i] = curr;
    }
    const wgt = saved?.wgrowtime || [];
    for (let i = 0; i < MAX_NUM_WORMS; ++i) lev.wgrowtime[i] = wgt[i] | 0;
}

/*
 *  place_wsegs()
 *
 *  Place the segments of the given worm.  Called from restore.c
 *  and from replmon() in mon.c.
 *  If oldworm is not NULL, assumes the oldworm segments are on map
 *  in the same location as worm segments
 */
// C ref: worm.c:645 place_wsegs(worm, oldworm).  No RNG.
export function place_wsegs(worm, oldworm) {
    const lev = worm_state();
    if (!lev) return;
    let curr = lev.wtails[worm.wormno];

    while (curr !== lev.wheads[worm.wormno]) {
        const x = curr.wx, y = curr.wy;
        const mtmp = grid_mon_at(x, y);

        if (oldworm && mtmp === oldworm)
            remove_monster(x, y);
        else if (mtmp)
            impossible('placing worm seg <%d,%d> over another mon', x, y);
        else if (oldworm)
            impossible('replacing worm seg <%d,%d> on empty spot', x, y);

        place_worm_seg(worm, x, y);
        curr = curr.nseg;
    }
    /* head segment is co-located with worm itself so not placed on the map */
    curr.wx = worm.mx; curr.wy = worm.my;
}

// C ref: worm.c:670 sanity_check_worm(worm) — called from mon_sanity_check()
// in mon.c.  Diagnostics only; no RNG, no state change.
export function sanity_check_worm(worm) {
    const lev = worm_state();
    if (!lev) return;
    let curr;
    let wnum, x, y;

    if (!worm) {
        impossible('worm_sanity: null monster!');
        return;
    }
    /* wormno can't be negative (unsigned bit field) and can't exceed
       MAX_NUM_WORMS - 1, so checking for 0 is all we can manage */
    if (!worm.wormno) {
        impossible('worm_sanity: not a worm!');
        return;
    }

    wnum = worm.wormno;
    if (!lev.wtails[wnum] || !lev.wheads[wnum]) {
        impossible('wormno %d is set without proper tail', wnum);
        return;
    }
    /* if worm is migrating, we can't check its segments against the map */
    if (!worm.mx)
        return;

    curr = lev.wtails[wnum];
    while (curr !== lev.wheads[wnum]) {
        x = curr.wx; y = curr.wy;
        if (!isok(x, y))
            impossible('worm seg not isok <%d,%d>', x, y);
        else if (grid_mon_at(x, y) !== worm)
            impossible('mon (%s) at seg location is not worm (%s)',
                       grid_mon_at(x, y), worm);

        curr = curr.nseg;
    }
}

// C ref: worm.c:706 wormno_sanity_check() — called from mon_sanity_check() in
// mon.c.  The whole body is under #ifdef EXTRA_SANITY_CHECKS, which config.h
// DOES define for this build.  C prints raw pointers via fmt_ptr(); this
// reports presence instead, which is the only part that is actionable.
export function wormno_sanity_check() {
    if (!EXTRA_SANITY_CHECKS) return;
    const lev = worm_state();
    if (!lev) return;
    let seg;
    let wh = 0, wt = 0;

    /* wormno==0 means 'not a worm', so wheads[0] and wtails[0] should always
       be empty; a non-Null one would include the extra head segment that
       isn't shown on the map */
    for (seg = lev.wheads[0]; seg; seg = seg.nseg) ++wh;
    for (seg = lev.wtails[0]; seg; seg = seg.nseg) ++wt;
    if (wh || wt) {
        impossible(
            'phantom worm tail #0 [head=%s, %d segment%s; tail=%s, %d segment%s]',
            lev.wheads[0] ? 'set' : '(nil)', wh, plur(wh),
            lev.wtails[0] ? 'set' : '(nil)', wt, plur(wt));
    }
}

/*
 *  remove_worm()
 *
 *  This function is equivalent to the remove_monster #define in
 *  rm.h, only it will take the worm *and* tail out of the levels array.
 *  It does not get rid of (dealloc) the worm tail structures, and it does
 *  not remove the mon from the fmon chain.
 */
// C ref: worm.c:734 remove_worm(worm).  Walks the WHOLE chain (the head's
// hidden segment included, which is what takes the worm itself off the grid)
// and marks each segment off-map with wx = 0.  No RNG.
export function remove_worm(worm) {
    const lev = worm_state();
    if (!lev) return;
    let curr = lev.wtails[worm.wormno];

    while (curr) {
        if (curr.wx) {
            remove_monster(curr.wx, curr.wy);
            newsym(curr.wx, curr.wy);
            curr.wx = 0;
        }
        curr = curr.nseg;
    }
}

/*
 * Given a coordinate x, y.
 * return in *nx, *ny, the coordinates of one of the <= 8 squares adjoining.
 */
// C ref: worm.c:794 random_dir(x, y, nx, ny).  NOTE: the whole function is
// inside `#if 0` in worm.c (its only caller was replaced by
// rnd_nextto_goodpos()), so it draws nothing in the reference build.  Kept
// faithful anyway: nx is resolved FIRST and its outcome decides whether ny
// gets a free choice (rn2(3)/rn2(2)) or is forced to change.
export function random_dir(x, y) {
    const nx = x + (x > 1                  /* extreme left ? */
                    ? (x < COLNO - 1       /* extreme right ? */
                       ? (rn2(3) - 1)      /* neither, so +1, 0, or -1 */
                       : -rn2(2))          /* right edge, use -1 or 0 */
                    : rn2(2));             /* left edge, use 0 or 1 */
    let ny;
    if (nx !== x) /* if x has changed, do same thing with y */
        ny = y + (y > 0                    /* y==0 is ok (x==0 is not) */
                  ? (y < ROWNO - 1
                     ? (rn2(3) - 1)
                     : -rn2(2))
                  : rn2(2));
    else /* when x has remained the same, force y to change */
        ny = y + (y > 0
                  ? (y < ROWNO - 1
                     ? (rn2(2) ? 1 : -1)   /* not at edge, so +1 or -1 */
                     : -1)                 /* bottom, use -1 */
                  : 1);                    /* top, use +1 */
    return { nx, ny };
}

// C ref: worm.c:823 size_wseg(worm) — for size_monst(wizcmds.c) to support
// #stats.  A byte total, so it needs sizeof(struct wseg); see SIZEOF_WSEG.
export function size_wseg(worm) {
    return count_wsegs(worm) * SIZEOF_WSEG;
}

/*  worm_known()
 *  Is any segment of this worm in viewing range?  Note: caller must check
 *  invisibility and telepathy (which should only show the head anyway).
 *  Mostly used in the canseemon() macro.
 */
// C ref: worm.c:864 worm_known(worm).  Unlike see_wsegs()/detect_wsegs(), the
// loop runs to the END of the chain, so the head's hidden segment counts too.
export function worm_known(worm) {
    const lev = worm_state();
    if (!lev) return false;
    let curr = lev.wtails[worm.wormno];

    while (curr) {
        if (cansee(curr.wx, curr.wy))
            return true;
        curr = curr.nseg;
    }
    return false;
}

// C ref: worm.c:938 wseg_at(worm, x, y) — construct an index number for a worm
// tail segment (insight.c probe_monster uses it to name the segment hit).
// Counts from the queried segment to the end of the chain.
export function wseg_at(worm, x, y) {
    const lev = worm_state();
    let res = 0;

    if (lev && worm && worm.wormno && grid_mon_at(x, y) === worm) {
        let curr;
        let i, n;
        const wx = x, wy = y;

        for (i = 0, curr = lev.wtails[worm.wormno]; curr; curr = curr.nseg) {
            if (curr.wx === wx && curr.wy === wy)
                break;
            ++i;
        }
        for (n = i; curr; curr = curr.nseg)
            ++n;
        res = n - i;
    }
    return res;
}

// C ref: worm.c:960 flip_worm_segs_vertical(worm, miny, maxy) — mkmaze.c
// flip_level() mirrors every segment along with the map.  No RNG.
export function flip_worm_segs_vertical(worm, miny, maxy) {
    const lev = worm_state();
    if (!lev) return;
    let curr = lev.wtails[worm.wormno];

    while (curr) {
        curr.wy = (maxy - curr.wy + miny);
        curr = curr.nseg;
    }
}

// C ref: worm.c:972 flip_worm_segs_horizontal(worm, minx, maxx).  No RNG.
export function flip_worm_segs_horizontal(worm, minx, maxx) {
    const lev = worm_state();
    if (!lev) return;
    let curr = lev.wtails[worm.wormno];

    while (curr) {
        curr.wx = (maxx - curr.wx + minx);
        curr = curr.nseg;
    }
}

// C ref: worm.c:984 redraw_worm(worm) — newsym() over the WHOLE chain, head
// square included (that is what distinguishes it from see_wsegs()).
export function redraw_worm(worm) {
    const lev = worm_state();
    if (!lev) return;
    let curr = lev.wtails[worm.wormno];

    while (curr) {
        newsym(curr.wx, curr.wy);
        curr = curr.nseg;
    }
}
