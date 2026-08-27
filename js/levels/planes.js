// levels/planes.js — machinery shared by the five endgame planes
// (dat/earth.lua, air.lua, fire.lua, water.lua, astral.lua).  These scripts are
// nearly all des.monster()/des.trap()/des.object() calls plus one levregion
// portal apiece, so the helpers here are the plane-flavoured create_monster,
// the levregion registry and place_lregions().
//
// This file exports no makemaz_*; the five per-plane modules import it.

import {
    AIR, COLNO, CORR, IS_FURNITURE, IS_LAVA, MOAT, POOL, ROOM, ROWNO, WATER, isok,
    Is_airlevel, Is_waterlevel,
} from '../const.js';
import { setup_waterlevel } from '../mkmaze.js';
import { game } from '../gstate.js';
import {
    MGEND_NEUTRAL, enexto_spawn, makemon, mkclass, mm_mon_at, monster_by_pmidx,
    name_gender_hint, name_to_pmidx,
} from '../makemon.js';
import { rn1, rn2 } from '../rng.js';
import {
    LOC_DRY, gx, gy, pm_to_humidity, reset_xystart_size, splev_get_location_rnd,
} from '../sp_lev.js';

// des.* coordinates are relative to the last des.map() origin.
export function plane_abs(mx, my) { return { x: mx + gx.xstart, y: my + gy.ystart }; }

// C ref: sp_lev.c sp_level_coder_init() — every script starts with the
// whole-level origin and an empty levregion list.  gl.lregions is level-global
// in this port, so a plane that skipped the reset would inherit (and place)
// whatever the previous special level registered.
export function plane_coder_init() {
    reset_xystart_size();
    game.lregions = [];
    game.lev_message = null;
}

// C ref: sp_lev.c lspo_message() -> gl.lev_message.  No RNG.  Nothing in this
// port reads it yet (questpgr.js's deliver_splev_message() is unported), but
// storing it is what a future arrival message would read.
export function plane_message(msg) {
    game.lev_message = game.lev_message ? `${game.lev_message}\n${msg}` : msg;
}

// C ref: sp_lev.c lspo_level_flags() for the flag names the planes use.  No RNG.
export function plane_level_flags(...flags) {
    const lf = game.level?.flags;
    if (!lf) return;
    for (const f of flags) {
        switch (f) {
        case 'mazelevel': lf.is_maze_lev = true; break;
        case 'noteleport': lf.noteleport = true; break;
        case 'hardfloor': lf.hardfloor = true; break;
        case 'shortsighted': lf.shortsighted = true; break;
        case 'nommap': lf.nommap = true; break;
        case 'stormy': lf.stormy = true; break;
        case 'hot': lf.temperature = 1; break;
        case 'fumaroles': lf.fumaroles = true; break;
        case 'solidify': game._splev_solidify = true; break;
        default: break;
        }
    }
}

// C ref: sp_lev.c create_monster().  `spec` mirrors the Lua table:
//   name     des.monster("stone giant", x, y) / {id="fire elemental"}
//   cls      des.monster("D") — a monster-class char, resolved by mkclass()
//   x,y      map-relative coords; omitted means a random get_location
//   peaceful 0/1, or null for "leave whatever makemon decided"
// Draw order, all before makemon(): the id form's find_montype() gender rn2(2)
// (sp_lev.c:3156, skipped for a fixed-gender species or a gendered name), then
// sp_amask_to_amask()'s induced_align rn2(3) (dungeon.c:2012) — the planes never
// pass `align`, so that arm always runs — then the humidity-aware location.
export function plane_monster(spec = {}) {
    const { name = null, cls = null, x = null, y = null, peaceful = null } = spec;
    let ptr = null;
    if (name) {
        const pmidx = name_to_pmidx(name);
        ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
        if (ptr && ptr.gcode !== 1 && ptr.gcode !== 2
            && name_gender_hint(name) === MGEND_NEUTRAL)
            rn2(2);                               // find_montype (sp_lev.c:3156)
    }
    rn2(3);                                       // induced_align (dungeon.c:2012)
    if (cls != null) ptr = mkclass(cls, 0x0200 /* G_NOGEN */);

    let mx, my;
    if (x != null) {
        const c = plane_abs(x, y);
        mx = c.x; my = c.y;
    } else if (ptr) {
        // C: water-likers get one try WITHOUT the DRY bit, then a DRY retry.
        const hum = pm_to_humidity(ptr);
        let p = splev_get_location_rnd(hum, true);
        if (p.x === -1 && p.y === -1) p = splev_get_location_rnd(hum | LOC_DRY);
        mx = p.x; my = p.y;
    } else {
        const p = splev_get_location_rnd(LOC_DRY);
        mx = p.x; my = p.y;
    }
    if (mm_mon_at(mx, my)) {
        const cc = enexto_spawn(mx, my, ptr);
        if (cc) { mx = cc.x; my = cc.y; }
    }
    const mtmp = makemon(ptr, mx, my, 0 /* NO_MM_FLAGS */);
    if (mtmp && peaceful != null) mtmp.mpeaceful = peaceful ? 1 : 0;
    return mtmp;
}

// C ref: sp_lev.c lspo_region() 2-arg form `des.region(selection, "lit")`: it
// clones the selection, grows it by one cell (W_ANY) and sets `lit` on every
// point — no room is registered.  Coordinates are map-relative.  No RNG.
export function plane_region_lit(x1, y1, x2, y2, lit = true) {
    const a = plane_abs(x1, y1), b = plane_abs(x2, y2);
    const g = lit ? 1 : 0;
    for (let x = Math.max(0, a.x - g); x <= Math.min(COLNO - 1, b.x + g); x++)
        for (let y = Math.max(0, a.y - g); y <= Math.min(ROWNO - 1, b.y + g); y++) {
            const loc = game.level?.at(x, y);
            if (loc) loc.lit = !!(IS_LAVA(loc.typ) || lit);
        }
}

// C ref: sp_lev.c lspo_levregion() -> levregion_add().  Registration only; the
// placement happens in fixup_special() once the script has finished.
// `islev` marks the region coords as whole-level absolute (air.lua's
// region_islev=1); otherwise they are map-relative.
export function plane_levregion_add(rtype, region, exclude, islev = false) {
    const g = game;
    if (!g.lregions) g.lregions = [];
    const a = islev ? { x: region[0], y: region[1] } : plane_abs(region[0], region[1]);
    const b = islev ? { x: region[2], y: region[3] } : plane_abs(region[2], region[3]);
    let e1 = { x: 0, y: 0 }, e2 = { x: 0, y: 0 };
    if (exclude) {
        e1 = islev ? { x: exclude[0], y: exclude[1] } : plane_abs(exclude[0], exclude[1]);
        e2 = islev ? { x: exclude[2], y: exclude[3] } : plane_abs(exclude[2], exclude[3]);
    }
    g.lregions.push({ rtype, lx: a.x, ly: a.y, hx: b.x, hy: b.y,
                      nlx: e1.x, nly: e1.y, nhx: e2.x, nhy: e2.y });
}

// C ref: sp_lev.c lspo_teleport_region() -> the LR_DOWNTELE arm of
// fixup_special(), which copies the region into svd.dndest.  No RNG.
export function plane_teleport_region(region, exclude = null, islev = false, dir = 'both') {
    const a = islev ? { x: region[0], y: region[1] } : plane_abs(region[0], region[1]);
    const b = islev ? { x: region[2], y: region[3] } : plane_abs(region[2], region[3]);
    let e1 = { x: 0, y: 0 }, e2 = { x: 0, y: 0 };
    if (exclude) {
        e1 = islev ? { x: exclude[0], y: exclude[1] } : plane_abs(exclude[0], exclude[1]);
        e2 = islev ? { x: exclude[2], y: exclude[3] } : plane_abs(exclude[2], exclude[3]);
    }
    // C ref: sp_lev.c lspo_teleport_region():5452 — `dir` DEFAULTS to "both"
    // (LR_TELE), and mkmaze.c fixup_special()'s LR_TELE arm fills svu.updest AND
    // svd.dndest.  Filling only dndest left u_on_rndspot(up=1) with no region, so
    // the hero's arrival ran a whole-level rn1 loop instead of C's 1x1 pick
    // (seed0373 step 99, Plane of Fire).
    const rgn = { lx: a.x, ly: a.y, hx: b.x, hy: b.y,
                  nlx: e1.x, nly: e1.y, nhx: e2.x, nhy: e2.y };
    if (dir === 'both' || dir === 'up') game.updest = { ...rgn };
    if (dir === 'both' || dir === 'down') game.dndest = { ...rgn };
}

// C ref: mkmaze.c occupied().
function plane_occupied(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return true;
    if ((game.level?.traps || []).some((t) => t.tx === x && t.ty === y)) return true;
    if (IS_FURNITURE(loc.typ)) return true;
    if (IS_LAVA(loc.typ)) return true;
    if (loc.typ === POOL || loc.typ === MOAT || loc.typ === WATER) return true;
    return false;
}

// C ref: mkmaze.c bad_location() — AIR counts as placeable, which is what makes
// the Plane of Air's rn1 loop terminate on its first try instead of burning all
// 200 iterations.
function plane_bad_location(x, y, nlx, nly, nhx, nhy) {
    const loc = game.level?.at(x, y);
    if (!loc) return true;
    if (plane_occupied(x, y)) return true;
    if (nlx && x >= nlx && x <= nhx && y >= nly && y <= nhy) return true;
    return !((loc.typ === CORR && !!game.level?.flags?.is_maze_lev)
             || loc.typ === ROOM || loc.typ === AIR);
}

// C ref: mkmaze.c place_lregion() — up to 200 rn1() pairs looking for a square
// put_lregion_here() accepts, then a deterministic scan.  Only the portal type
// is registered by a plane, and this port cannot build the portal trap from a
// levels/ module (mkportal lives behind mklev.js), so the accepted square is
// recorded on the lregion instead.  Returning "accepted" at the same moment C
// does is what keeps the rn1 loop the right length, which is the part of this
// the RNG stream can see.
export async function plane_place_lregions() {
    // C ref: mkmaze.c fixup_special():580 — "water level is an odd beast, it has
    // to be set up before calling place_lregions etc."  setup_waterlevel() turns
    // the script's solid element into the AIR/CLOUD (or WATER/AIR) mix the
    // portal's levregion then has to find an accessible square in, so its
    // bubbles are what decide how many rn1() tries place_lregion() burns.
    if (Is_waterlevel(game.u?.uz) || Is_airlevel(game.u?.uz)) {
        if (game.level?.flags) game.level.flags.hero_memory = false;
        await setup_waterlevel();
    }
    for (const lr of (game.lregions || [])) {
        let { lx, ly, hx, hy } = lr;
        if (!lx) { lx = 1; hx = COLNO - 1; ly = 0; hy = ROWNO - 1; }
        if (lx < 1) lx = 1;
        if (hx > COLNO - 1) hx = COLNO - 1;
        if (ly < 0) ly = 0;
        if (hy > ROWNO - 1) hy = ROWNO - 1;
        const oneshot = (lx === hx && ly === hy);
        let placed = false;
        for (let trycnt = 0; trycnt < 200 && !placed; trycnt++) {
            const x = rn1((hx - lx) + 1, lx);
            const y = rn1((hy - ly) + 1, ly);
            if (!plane_bad_location(x, y, lr.nlx, lr.nly, lr.nhx, lr.nhy) || oneshot) {
                lr.px = x; lr.py = y; placed = true;
            }
        }
        if (!placed) {
            for (let x = lx; x <= hx && !placed; x++)
                for (let y = ly; y <= hy && !placed; y++)
                    if (isok(x, y)) { lr.px = x; lr.py = y; placed = true; }
        }
    }
    game.lregions = [];
}

// C ref: monsym.h MONSYM indices for the class characters the planes use.
export const S_DRAGON = 30, S_ELEMENTAL = 31, S_JABBERWOCK = 36, S_LICH = 38,
             S_VAMPIRE = 48, S_DEMON = 56, S_EEL = 57;
