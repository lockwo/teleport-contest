// levels/quest_home_common.js — machinery shared by the quest "home" (start) level
// builders (Val/Kni/Sam/Mon/Tou/Wiz/Rog/Ran/Hea/Cav-strt.lua).  Everything here
// is a des.* primitive that the three already-landed quest homes (Bar/Arc/Pri)
// did not need; the primitives they DID need still live in js/sp_lev.js.

import { COLNO, CROSSWALL, DRAWBRIDGE_UP, HWALL, IS_AIR, IS_FURNITURE, IS_LAVA,
         IS_POOL, IS_ROOM, LADDER, LR_BRANCH, MAGIC_PORTAL, MOAT, NO_ROOM,
         POOL, ROOM, ROWNO, STAIRS, STONE, TRAPPED_CHEST, TRAPPED_DOOR,
         VIBRATING_SQUARE, VWALL, WATER } from '../const.js';
import { game } from '../gstate.js';
import { mkclass } from '../makemon.js';
import { rn2, rnd } from '../rng.js';
import { maketrap, t_at } from '../trap.js';
import {
    LOC_ANY, LOC_DRY, SET_LIT_NOCHANGE, bigrm_wallification, flip_level, gx, gy,
    quest_flip_branch, set_levltyp_lit, shuffle,
    splev_create_monster, splev_get_location_rnd, splev_traptype_rnd,
} from '../sp_lev.js';

// C ref: monsym.h def_char_to_monclass() for the class letters these ten
// levels use.  The value is the S_* index mkclass() switches on.
export const S_SPIDER = 19, S_CENTAUR = 29, S_DRAGON = 30, S_SNAKE = 45,
             S_BAT = 28, S_WRAITH = 49, S_IMP = 9, S_EEL = 57;

// C ref: trap.h — the trap types create_trap() is asked for by name here.
export const DART_TRAP = 2, ARROW_TRAP = 1, PIT = 11, SPIKED_PIT = 12,
             BEAR_TRAP = 5, FIRE_TRAP = 10, SLP_GAS_TRAP = 8, NO_TRAP = 0,
             HOLE = 13, TRAPDOOR = 14, ROCKTRAP = 3;

// C ref: rm.h W_* wall directions, as selection_do_grow()/random_wdir() use them.
export const W_NORTH = 1, W_SOUTH = 2, W_EAST = 4, W_WEST = 8,
             W_ANY = (W_NORTH | W_SOUTH | W_EAST | W_WEST), W_RANDOM = -2;

// C ref: load_special() loads nhlib.lua first, whose top level runs
// shuffle(align) over a 3-element table: rn2(3) then rn2(2).
export function quest_align_shuffle() {
    shuffle(['law', 'neutral', 'chaos']);
}

// C ref: sp_lev.c splev_initlev() LVLINIT_SOLIDFILL with no explicit `lit`
// (BOOL_RANDOM -> one rn2(2)), then lvlfill_solid(filling, lit).  `filling`
// defaults to `fg` (sp_lev.c lspo_level_init), so the quest homes that pass
// fg="." fill with ROOM and the ones that pass fg=" " fill with STONE.
export function quest_level_init_fill(filling) {
    const lit = rn2(2);                              // sp_lev.c:2992
    for (let y = 0; y < ROWNO; y++)
        for (let x = 0; x < COLNO; x++) {
            const loc = game.level?.at(x, y);
            if (loc) { loc.typ = filling; loc.lit = !!lit; loc.roomno = NO_ROOM; }
        }
    return lit;
}

// C ref: mkmap.c mkmap() reached from splev_initlev()'s LVLINIT_MINES arm, for
// the two quest homes that use it as "a kludge to init the level as a lit
// field" (Kni-strt.lua:14, Ran-strt.lua:16).  Both pass fg == bg == "." and
// lit=1, walled=false, so:
//   * lit is explicit -> litstate_rnd() draws nothing;
//   * lvlfill_solid(filling=fg=ROOM, 0) and init_map(bg=ROOM) both blank the
//     map to ROOM;
//   * init_fill's `while (count < limit)` test is `levl[x][y].typ == bg_typ`,
//     which with bg == fg is true on EVERY iteration — so the loop runs exactly
//     limit == (WIDTH*HEIGHT*2)/5 times and draws 2 calls each, a fixed 1248;
//   * pass_one/pass_two/pass_three count neighbours == fg_typ and so see 8
//     everywhere, leaving the map unchanged, and draw nothing;
//   * join_map (Ran only) flood-fills the single all-ROOM region into one room
//     and its pairwise corridor loop never runs (nroom == 1), then
//     join_map_cleanup() resets nroom to 0 — no RNG either way;
//   * finish_map(lit=TRUE, walled=FALSE) lights every fg/bg square.
// Net effect: 1248 PRNG draws and a fully lit ROOM field.
export function quest_level_init_mines_flat() {
    const WIDTH = COLNO - 2, HEIGHT = ROWNO - 1;
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const loc = game.level?.at(x, y);
            if (loc) { loc.typ = ROOM; loc.lit = false; loc.roomno = NO_ROOM; }
        }
    const limit = Math.trunc((WIDTH * HEIGHT * 2) / 5);
    for (let count = 0; count < limit; count++) {
        rn2(WIDTH - 1);                              // rn1(WIDTH-1, 2) mkmap.c:45
        rnd(HEIGHT - 1);                             // rnd(HEIGHT-1)  mkmap.c:46
    }
    for (let x = 1; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const loc = game.level?.at(x, y);
            if (loc) loc.lit = true;                 // finish_map() lit arm
        }
}

// C ref: mkmap.c wallify_map() — des.wallify()'s worker (NOT mklev.c's
// wallification(), which lspo_finalize_level runs afterwards anyway).  Any
// STONE square with a ROOM/CROSSWALL neighbour becomes a wall; the H/V choice
// is "did the match come from a different row".  No RNG.
export function quest_wallify_map(x1, y1, x2, y2) {
    if (x1 < 1) x1 = 1;
    if (y1 < 0) y1 = 0;
    if (x2 >= COLNO) x2 = COLNO - 1;
    if (y2 >= ROWNO) y2 = ROWNO - 1;
    for (let y = y1; y <= y2; y++) {
        const loYY = (y > y1) ? y - 1 : y1;
        const hiYY = (y < y2) ? y + 1 : y2;
        for (let x = x1; x <= x2; x++) {
            const loc = game.level?.at(x, y);
            if (!loc || loc.typ !== STONE) continue;
            const loXX = (x > x1) ? x - 1 : x1;
            const hiXX = (x < x2) ? x + 1 : x2;
            let done = false;
            for (let yy = loYY; yy <= hiYY && !done; yy++)
                for (let xx = loXX; xx <= hiXX; xx++) {
                    const t = game.level?.at(xx, yy)?.typ;
                    if (IS_ROOM(t) || t === CROSSWALL) {
                        loc.typ = (yy !== y) ? HWALL : VWALL;
                        done = true;
                        break;
                    }
                }
        }
    }
}

// C ref: sp_lev.c lspo_terrain() single-coordinate form des.terrain({x,y}, "c").
export function quest_terrain_at(mx, my, typ) {
    set_levltyp_lit(mx + gx.xstart, my + gy.ystart, typ, SET_LIT_NOCHANGE);
}

// C ref: sp_lev.c create_monster(), via the generic splev_create_monster().
// The only thing added here is makemon.c's S_EEL mklev hook: an eel generated
// on water during level creation hides under it (mundetected), so the square
// renders as plain water rather than as a ';'.
export function quest_monster(spec) {
    const mtmp = splev_create_monster(spec);
    if (mtmp && mtmp.data?.mcls === S_EEL) {
        const t = game.level?.at(mtmp.mx, mtmp.my)?.typ;
        if (t === POOL || t === MOAT || t === WATER)
            mtmp.mundetected = true;
    }
    return mtmp;
}

// C ref: sp_lev.c create_trap() with croom == NULL.  A `des.trap()` with no
// coordinate runs get_location_coord(DRY) in a loop that rejects stairs and
// ladders; mktrap() then re-rolls traptype_rnd() until it yields a legal type
// (only when the .lua asked for a random type) and always ends with the
// victim check rnd(4) (mklev.c:2137), which never fires at quest-home depth.
// mktrapflags is MKTRAP_MAZEFLAG|MKTRAP_NOSPIDERONWEB for every des.trap()
// on these levels (none of them set spider_on_web).
export async function quest_trap(ttyp = null, mx = null, my = null) {
    let x, y;
    if (mx != null) { x = mx + gx.xstart; y = my + gy.ystart; }
    else {
        let trycnt = 0;
        do {
            const c = splev_get_location_rnd(LOC_DRY);
            x = c.x; y = c.y;
            const t = game.level?.at(x, y)?.typ;
            if (t !== STAIRS && t !== LADDER) break;
        } while (++trycnt <= 100);
    }
    let kind = ttyp;
    if (kind == null) {
        do { kind = splev_traptype_rnd(0x04 /* MKTRAP_NOSPIDERONWEB */); }
        while (kind === NO_TRAP);
        // hardfloor is set on every quest home, so Can_fall_thru() is FALSE and
        // mktrap() rewrites a hole/trapdoor into a falling-rock trap.  No RNG.
        if (kind === HOLE || kind === TRAPDOOR) kind = ROCKTRAP;
    }
    // C ref: mklev.c:2099-2101 `t = maketrap(...); kind = t ? t->ttyp : NO_TRAP;`
    // and then mklev.c:2136 `&& kind != NO_TRAP` guards the rnd(4) at :2137.
    // trap.c maketrap() refuses several squares outright, and a refused square
    // means BOTH no trap and no victim draw.  Measured on the recorded C trace
    // for Wiz-strt (seed0360 step 373, call 1600): a des.trap() that rolled a
    // cloud square emits its traptype rolls and then nothing at all.
    if (quest_trap_placeable(x, y, kind)) {
        await maketrap(x, y, kind);
        rnd(4);                                      // mktrap victim (mklev.c:2137)
    }
}

// C ref: trap.c maketrap()'s early `return (struct trap *) 0` paths.  An
// existing trap is normally REPLACED (so it is still placeable); only an
// undestroyable one blocks.
function quest_trap_placeable(x, y, typ) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    if (typ === TRAPPED_DOOR || typ === TRAPPED_CHEST) return false;
    const old = t_at(x, y);
    if (old) return !(old.ttyp === MAGIC_PORTAL || old.ttyp === VIBRATING_SQUARE);
    if (loc.typ === LADDER || loc.typ === STAIRS) return false;
    if (IS_POOL(loc.typ) || IS_LAVA(loc.typ)) return false;
    if (IS_FURNITURE(loc.typ) && typ !== PIT && typ !== HOLE) return false;
    if (loc.typ === DRAWBRIDGE_UP && typ === MAGIC_PORTAL) return false;
    if (IS_AIR(loc.typ) && typ !== MAGIC_PORTAL) return false;
    return true;
}

// C ref: sp_lev.c lspo_finalize_level() tail shared by every quest home:
// wallification(1, 0, COLNO-1, ROWNO-1) (no level sets corrmaze) then
// flip_level_rnd(allow_flips = 3, FALSE) — one rn2(2) per enabled axis.
export function quest_finalize() {
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                            // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                            // flip_level_rnd sp_lev.c:977
    if (flp) { flip_level(flp); quest_flip_branch(flp); }
}

// ── selection primitives (Val-strt.lua's lava/water pools) ──────────────────
// A selection is a Set of "x,y" keys, matching js/sp_lev.js's quest_floodfill_
// match()/quest_rndcoord() convention.

// C ref: nhlsel.c l_selection_setpoint() with only the selection on the stack:
// x and y stay -1, so the coord packs as SP_COORD_PACK_RANDOM and
// get_location_coord(ANY_LOC) takes the random branch — is_ok_location() is
// unconditionally true for ANY_LOC, so this is exactly two draws.
export function quest_sel_set_random(sel) {
    const { x, y } = splev_get_location_rnd(LOC_ANY);
    sel.add(x + ',' + y);
    return sel;
}

// C ref: sp_lev.c random_wdir() — wdirs[rn2(4)].
function quest_random_wdir() {
    return [W_NORTH, W_SOUTH, W_EAST, W_WEST][rn2(4)];
}

// C ref: selvar.c selection_do_grow(ov, dir) — W_RANDOM first costs one rn2(4).
// The scan runs the selection's bounding box grown by one in each direction and
// adds every square that has a set neighbour on the requested side(s); a
// diagonal is only reachable when both adjacent orthogonals are in the mask.
export function quest_sel_grow(sel, dir = W_ANY) {
    if (dir === W_RANDOM) dir = quest_random_wdir();
    let lx = COLNO, hx = -1, ly = ROWNO, hy = -1;
    for (const k of sel) {
        const [x, y] = k.split(',').map(Number);
        if (x < lx) lx = x; if (x > hx) hx = x;
        if (y < ly) ly = y; if (y > hy) hy = y;
    }
    if (hx < 0) return sel;
    const has = (x, y) => sel.has(x + ',' + y);
    const add = [];
    for (let x = Math.max(0, lx - 1); x <= Math.min(COLNO - 1, hx + 1); x++)
        for (let y = Math.max(0, ly - 1); y <= Math.min(ROWNO - 1, hy + 1); y++) {
            if (((dir & W_WEST) && has(x + 1, y))
                || (((dir & (W_WEST | W_NORTH)) === (W_WEST | W_NORTH)) && has(x + 1, y + 1))
                || ((dir & W_NORTH) && has(x, y + 1))
                || (((dir & (W_NORTH | W_EAST)) === (W_NORTH | W_EAST)) && has(x - 1, y + 1))
                || ((dir & W_EAST) && has(x - 1, y))
                || (((dir & (W_EAST | W_SOUTH)) === (W_EAST | W_SOUTH)) && has(x - 1, y - 1))
                || ((dir & W_SOUTH) && has(x, y - 1))
                || (((dir & (W_SOUTH | W_WEST)) === (W_SOUTH | W_WEST)) && has(x + 1, y - 1)))
                add.push(x + ',' + y);
        }
    for (const k of add) sel.add(k);
    return sel;
}

// C ref: sp_lev.c lspo_terrain() over a selection — sel_set_ter() per point.
export function quest_sel_terrain(sel, typ) {
    for (const k of sel) {
        const [x, y] = k.split(',').map(Number);
        set_levltyp_lit(x, y, typ, SET_LIT_NOCHANGE);
    }
}

// C ref: nhlib.lua:10 math.random(lo, hi) == nh.random(lo, hi + 1 - lo).
export function quest_lua_random(lo, hi) {
    return lo + rn2(hi + 1 - lo);
}

// C ref: sp_lev.c lspo_levregion() type="branch" with a multi-square region.
// quest_place_branch() (js/mklev.js) reads game._quest_lregion and runs C's
// place_lregion() rn1 loop over it.  `islev` is the Lua region_islev flag: the
// coordinates are whole-level absolute rather than relative to des.map's origin.
export function quest_register_branch_region(x1, y1, x2, y2, islev) {
    const ox = islev ? 0 : gx.xstart, oy = islev ? 0 : gy.ystart;
    game._quest_lregion = {
        x1: x1 + ox, y1: y1 + oy, x2: x2 + ox, y2: y2 + oy,
        rtype: LR_BRANCH, lev: null,
    };
}
