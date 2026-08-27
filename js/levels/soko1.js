// levels/soko1.js - special level builder makemaz_soko1(), split out of js/sp_lev.js.
// sp_lev.js re-exports makemaz_soko1 so existing importers are unaffected; the
// shared special-level machinery still lives there and is imported below.

import { BURN, COLNO, DOOR, FILL_NORMAL, ROOMOFFSET, ROWNO, SDOOR, ZOO } from '../const.js';
import { premap_detect } from '../detect.js';
import { Is_special } from '../dungeon.js';
import { make_engr_at } from '../engrave.js';
import { game } from '../gstate.js';
import { dist2, distmin } from '../hacklib.js';
import { MM_ASLEEP, MM_NOGRP, level_difficulty_ext, makemon } from '../makemon.js';
import {
    BAG_OF_HOLDING, BOULDER, FOOD_CLASS, RING_CLASS, SCR_SCARE_MONSTER, WAND_CLASS, curse,
    mkgold, mksobj_at, uncurse,
} from '../mkobj.js';
import { rn1, rn2, rnd } from '../rng.js';
import {
    add_sp_room, bigrm_get_level_extends, bigrm_level_init_solidfill, bigrm_load_map,
    bigrm_wallification, flip_level, flood_fill_room, gx, gy, percent, q_absx, q_absy,
    quest_create_monster_randpos, quest_place_stair, quest_set_door, shuffle,
    soko_create_object_class_random, soko_mktrap, soko_region_lit_grow,
    soko_solidify_and_nondig,
} from '../sp_lev.js';

// ════════════════════════════════════════════════════════════════════════
// Sokoban entrance level loader (dat/soko1-1.lua, dat/soko1-2.lua).
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("soko1") ->
// rnd(sp->rndlevs) picks the variant file, then load_special("soko1-N.lua").
// BOTH variants are ported: the two files differ only in map, coordinates and
// the percent() threshold on the prize, so one des.* program driven by a data
// table covers them.  (soko1-1 was the "never reached, so not ported" half
// until seed0360 stepped onto it — rnd(2) is a coin flip per game.)
// ════════════════════════════════════════════════════════════════════════

const SOKO1_1_MAP =
    '--------------------------\n' +
    '|........................|\n' +
    '|.......|---------------.|\n' +
    '-------.------         |.|\n' +
    ' |...........|         |.|\n' +
    ' |...........|         |.|\n' +
    '--------.-----         |.|\n' +
    '|............|         |.|\n' +
    '|............|         |.|\n' +
    '-----.--------   ------|.|\n' +
    ' |..........|  --|.....|.|\n' +
    ' |..........|  |.+.....|.|\n' +
    ' |.........|-  |-|.....|.|\n' +
    '-------.----   |.+.....+.|\n' +
    '|........|     |-|.....|--\n' +
    '|........|     |.+.....|  \n' +
    '|...|-----     --|.....|  \n' +
    '-----            -------  ';

const SOKO1_2_MAP =
    '  ------------------------\n' +
    '  |......................|\n' +
    '  |..-------------------.|\n' +
    '----.|    -----        |.|\n' +
    '|..|.--  --...|        |.|\n' +
    '|.....|--|....|        |.|\n' +
    '|.....|..|....|        |.|\n' +
    '--....|......--        |.|\n' +
    ' |.......|...|   ------|.|\n' +
    ' |....|..|...| --|.....|.|\n' +
    ' |....|--|...| |.+.....|.|\n' +
    ' |.......|..-- |-|.....|.|\n' +
    ' ----....|.--  |.+.....+.|\n' +
    '    ---.--.|   |-|.....|--\n' +
    '     |.....|   |.+.....|  \n' +
    '     |..|..|   --|.....|  \n' +
    '     -------     -------  ';

// C ref: sp_lev.c create_monster — named species ("giant mimic"), no coord
// (get_location_coord DRY), align=random/peaceful=random (default table
// fields) -> straight makemon(); appear_as="obj:boulder" is a no-RNG name
// lookup, applied to the mimic after placement.
function soko_create_mimic_boulder() {
    const mtmp = quest_create_monster_randpos('giant mimic', null);
    if (mtmp) {
        mtmp.m_ap_type = 'obj';
        mtmp.mappearance = BOULDER;
    }
    return mtmp;
}

// C ref: sp_lev.c:5498 lspo_exclusion — des.exclusion({ type =
// "monster-generation", region = {x1,y1,x2,y2} }) registers an LR_MONGEN zone
// at MAP-relative coords run through get_location_coord.
//
// Not cosmetic: goodpos() rejects the whole rectangle whenever the caller
// passes GP_AVOID_MONPOS (teleport.c:180), and makemon_rnd_goodpos() always
// sets that flag (makemon.c:1085).  So in C every random monster that rolls a
// cell on the filled hole/pit row is REJECTED and the rn1(COLNO-3,2)/rn2(ROWNO)
// pair is drawn again — up to 50 times.  Registration itself draws nothing.
export function soko_exclusion_mongen(x1, y1, x2, y2) {
    const g = game;
    if (!g.level) return;
    (g.level.exclusions || (g.level.exclusions = [])).push({
        type: 'monster-generation',
        lx: q_absx(x1), ly: q_absy(y1), hx: q_absx(x2), hy: q_absy(y2),
    });
}

// C ref: sp_lev.c:876 flip_level() — exclusion zones are mirrored with the map
// and then re-sorted, because FlipX/FlipY turn a lo/hi pair into hi/lo.
export function soko_flip_exclusions(flp) {
    const zones = game.level?.exclusions;
    if (!zones || !zones.length) return;
    const { minx, maxx, miny, maxy } = bigrm_get_level_extends();
    for (const ez of zones) {
        if (flp & 1) {
            ez.ly = miny + maxy - ez.ly;
            ez.hy = miny + maxy - ez.hy;
            if (ez.ly > ez.hy) { const t = ez.ly; ez.ly = ez.hy; ez.hy = t; }
        }
        if (flp & 2) {
            ez.lx = minx + maxx - ez.lx;
            ez.hx = minx + maxx - ez.hx;
            if (ez.lx > ez.hx) { const t = ez.lx; ez.lx = ez.hx; ez.hx = t; }
        }
    }
}

// C ref: sp_lev.c create_object — explicit id + coord (no location RNG) +
// buc override ("not-cursed" -> uncurse(); "cursed" -> curse()).
function soko_create_object_coord(otyp, mx, my, buc) {
    const x = q_absx(mx), y = q_absy(my);
    const otmp = mksobj_at(otyp, x, y, true, true);
    if (buc === 'not-cursed') uncurse(otmp);
    else if (buc === 'cursed') curse(otmp);
    return otmp;
}

// C ref: sp_lev.c lspo_region table form, irregular=true, type="zoo" ->
// flood_fill_rm from the given seed point + add_room; needfill is stored and
// actually populated later, at level finalize (fill_special_room()).
function soko_region_zoo(x1, y1) {
    const dx1 = x1 + gx.xstart, dy1 = y1 + gy.ystart;
    const roomno = game.level.nroom + ROOMOFFSET;
    const flood = flood_fill_room(dx1, dy1, roomno, true);
    if (!flood.cells.length) return null;
    return add_sp_room(flood.minx, flood.miny, flood.maxx, flood.maxy,
                        true, ZOO, true, FILL_NORMAL, true);
}

// C ref: sp_lev.c:5544 add_doors_to_room(croom) — run at region-creation time —
// followed by sp_lev.c:6022 link_doors_rooms() at level finalize.  Both funnel
// into mklev.c:574 add_door(), and THAT is the load-bearing part: add_door
// INSERTS each new door at svd.doors[aroom->fdoor], shifting the rest up, so
// `fdoor` names the door added LAST, not first.
//
// The two scans also disagree on order — add_doors_to_room walks the room's
// bounding box x-outer/y-inner, link_doors_rooms walks the whole map
// y-outer/x-inner — and the last door the pair adds is the one fill_zoo()
// measures dist2 from.  Getting this wrong scales every gold pile in the zoo
// (seed0360 step 211: rn1(676,10) / rn1(2500,10) instead of C's rn1(100,10)).
function soko_link_doors_to_room(croom) {
    const rmno = croom.roomnoidx + ROOMOFFSET;
    const seen = new Set();
    let fdoor = null;
    const maybe_add_door = (x, y) => {
        const loc = game.level?.at(x, y);
        if (!loc || !(loc.typ === DOOR || loc.typ === SDOOR)) return;
        if (loc.roomno !== rmno) return;   /* == maybe_add_door's roomno test */
        const key = x + ',' + y;
        if (seen.has(key)) return;         /* add_door dedups per room */
        seen.add(key);
        fdoor = { x, y };                  /* inserted AT fdoor: last wins */
    };
    // add_doors_to_room: x outer, y inner, over the bounding box grown by 1.
    for (let x = croom.lx - 1; x <= croom.hx + 1; x++)
        for (let y = croom.ly - 1; y <= croom.hy + 1; y++) maybe_add_door(x, y);
    // link_doors_rooms: whole map, y outer, x inner.
    for (let y = 0; y < ROWNO; y++)
        for (let x = 0; x < COLNO; x++) maybe_add_door(x, y);
    croom.doorct = seen.size;
    croom.fdoor = fdoor;
}

// C ref: mkroom.c fill_zoo() ZOO case — makemon(NULL,...) (random monster)
// per eligible cell (x outer, y inner), each carrying gold scaled by
// (dist2 to the first door)^2, capped by a per-room gold budget.
function soko_fill_zoo(croom) {
    if (!croom.fdoor && croom.doorct == null) soko_link_doors_to_room(croom);
    if (process.env.NH_DEBUG_ZOO) console.error('DEBUG zoo', JSON.stringify({ lx: croom.lx, ly: croom.ly, hx: croom.hx, hy: croom.hy, doorct: croom.doorct, fdoor: croom.fdoor }));
    const rmno = croom.roomnoidx + ROOMOFFSET;
    const lvl = level_difficulty_ext();
    let goldlim = 500 * lvl;
    for (let sx = croom.lx; sx <= croom.hx; sx++) {
        for (let sy = croom.ly; sy <= croom.hy; sy++) {
            const loc = game.level?.at(sx, sy);
            if (!loc || loc.roomno !== rmno || loc.edge) continue;
            if (croom.doorct && distmin(sx, sy, croom.fdoor.x, croom.fdoor.y) <= 1)
                continue;
            const mon = makemon(null, sx, sy, MM_ASLEEP | MM_NOGRP);
            if (mon) mon.msleeping = 1;
            let i;
            if (croom.doorct) {
                const distval = dist2(sx, sy, croom.fdoor.x, croom.fdoor.y);
                i = distval * distval;
            } else {
                i = goldlim;
            }
            if (i >= goldlim) i = 5 * lvl;
            goldlim -= i;
            mkgold(rn1(i, 10), sx, sy);
        }
    }
    // This function IS the ZOO arm of C's fill_special_room() loop, run inline
    // at the point lspo_finalize_level() would run it (it needs soko's own
    // fdoor-as-coord bookkeeping, which the generic path does not have).
    // Downgrade needfill to FILL_LVLFLAGS_ONLY so the generic fill_special_room
    // pass that follows only applies has_zoo instead of stocking it twice.
    croom.needfill = 2; /* FILL_LVLFLAGS_ONLY */
}

// dat/soko1-N.lua as data.  Everything here is in FILE ORDER — the des.*
// program is executed top to bottom and several of the steps draw, so a
// reordered list is a silent PRNG desync.
const SOKO1_VARIANTS = {
    1: {
        map: SOKO1_1_MAP,
        place: [{ x: 16, y: 11 }, { x: 16, y: 13 }, { x: 16, y: 15 }],
        stair: [1, 1],
        area: [0, 0, 25, 17],
        boulders: [
            [3, 5], [5, 5], [7, 5], [9, 5], [11, 5],
            [4, 7], [4, 8], [6, 7], [9, 7], [11, 7],
            [3, 12], [4, 10], [5, 12], [6, 10], [7, 11], [8, 10], [9, 12],
            [3, 14],
        ],
        exclusions: [[7, 1, 23, 1]],
        // soko1-1 leads with a hole, then the rolling boulder, then holes.
        traps: [[7, 1, 'hole'], [8, 1, 'rolling boulder']]
            .concat(Array.from({ length: 15 }, (_, i) => [9 + i, 1, 'hole'])),
        doors: [[23, 13, 'locked'], [17, 11, 'closed'], [17, 13, 'closed'], [17, 15, 'closed']],
        zoo: [18, 10],
        prize_pct: 75,
    },
    2: {
        map: SOKO1_2_MAP,
        place: [{ x: 16, y: 10 }, { x: 16, y: 12 }, { x: 16, y: 14 }],
        stair: [6, 15],
        area: [0, 0, 25, 16],
        boulders: [
            [4, 4], [2, 6], [3, 6], [4, 7], [5, 7], [2, 8], [5, 8], [3, 9],
            [4, 9], [3, 10], [5, 10], [6, 12], [7, 14],
            [11, 5], [12, 6], [10, 7], [11, 7], [10, 8], [12, 9], [11, 10],
        ],
        exclusions: [[5, 1, 23, 1]],
        traps: [[5, 1, 'rolling boulder']]
            .concat(Array.from({ length: 18 }, (_, i) => [6 + i, 1, 'hole'])),
        doors: [[23, 12, 'locked'], [17, 10, 'closed'], [17, 12, 'closed'], [17, 14, 'closed']],
        zoo: [18, 9],
        prize_pct: 25,
    },
};

// Entry point.  C ref: makemaz("soko1") -> rnd(2) + load_special("soko1-N").
export async function makemaz_soko1() {
    const g = game;
    const slev = Is_special(g.u?.uz);
    const rndlevs = slev?.rndlevs || 2;
    const variant = rnd(rndlevs);            // mkmaze.c:1136 rnd(sp->rndlevs)
    // load_special -> load_lua -> nhlib.lua top-level: shuffle(align)
    shuffle(['law', 'neutral', 'chaos']);    // rn2(3), rn2(2)
    const V = SOKO1_VARIANTS[variant];
    if (!V) return;
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.sokoban_rules = true;
    }
    try {
        // des.level_init({ style="solidfill", fg=" " }) -> splev_initlev
        // BOOL_RANDOM lit -> rn2(2), then fill the whole level STONE.
        bigrm_level_init_solidfill();
        // des.map([[...]]) — single-string arg -> SPLEV_CENTER, no RNG.
        bigrm_load_map(V.map, false);

        // place = selection.new(); place:set(...) x3 — no RNG.
        const PLACE_PTS = V.place;

        // des.stair("down", x, y) — no RNG.
        quest_place_stair(V.stair[0], V.stair[1], false);
        // des.region(selection.area(...),"lit") — grow+set lit, no RNG.
        soko_region_lit_grow(V.area[0], V.area[1], V.area[2], V.area[3]);
        // des.non_diggable/non_passwall(area(...)) folded into the
        // combined finalize pass below (RNG-free either way).

        // Boulders — des.object("boulder", x, y); each draws next_ident's
        // rnd(2) inside mksobj.
        for (const [bx, by] of V.boulders)
            mksobj_at(BOULDER, q_absx(bx), q_absy(by), true, false);

        // des.exclusion({type="monster-generation"}) — suppresses random
        // monster generation over the (filled) holes for the whole game.
        for (const [ex1, ey1, ex2, ey2] of V.exclusions)
            soko_exclusion_mongen(ex1, ey1, ex2, ey2);

        // Traps, in the file's own order.
        for (const [tx, ty, kind] of V.traps) await soko_mktrap(tx, ty, kind);

        // 2x des.monster({id="giant mimic", appear_as="obj:boulder"}).
        soko_create_mimic_boulder();
        soko_create_mimic_boulder();

        // Random-class objects: 4x food, 1x ring, 1x wand.
        soko_create_object_class_random(FOOD_CLASS);
        soko_create_object_class_random(FOOD_CLASS);
        soko_create_object_class_random(FOOD_CLASS);
        soko_create_object_class_random(FOOD_CLASS);
        soko_create_object_class_random(RING_CLASS);
        soko_create_object_class_random(WAND_CLASS);

        // Reward room doors, then the zoo region (fill deferred to finalize).
        for (const [dx, dy, dstate] of V.doors) quest_set_door(dx, dy, dstate);
        const zoo = soko_region_zoo(V.zoo[0], V.zoo[1]);
        // C ref: sp_lev.c:6022 link_doors_rooms() runs BEFORE wallification and
        // flip_level_rnd, so sroom->fdoor names the first door in PRE-flip
        // raster order; flip_level then flips svd.doors[] under it.  Linking
        // after the flip picks the opposite door of a mirrored room and feeds
        // fill_zoo the wrong dist2 (seed0360 step 211: i=676 vs C's 100).
        if (zoo) soko_link_doors_to_room(zoo);

        // Achievement prize: rn2(3) picks the spot, percent(N) picks the item.
        const pt = PLACE_PTS[rn2(PLACE_PTS.length)];
        if (percent(V.prize_pct)) soko_create_object_coord(BAG_OF_HOLDING, pt.x, pt.y, 'not-cursed');
        else soko_create_object_coord(208 /* AMULET_OF_REFLECTION */, pt.x, pt.y, 'not-cursed');
        make_engr_at(q_absx(pt.x), q_absy(pt.y), 'Elbereth', null, 0, BURN);
        soko_create_object_coord(SCR_SCARE_MONSTER, pt.x, pt.y, 'cursed');

        // Finalize: wallification, then flip_level_rnd (2x rn2(2)).
        bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
        let flp = 0;
        if (rn2(2)) flp |= 1;
        if (rn2(2)) flp |= 2;
        if (flp) {
            flip_level(flp);
            soko_flip_exclusions(flp);
            // flip_level flips svd.doors[] too; sroom->fdoor is an INDEX, so
            // the already-chosen door travels with the map.
            if (zoo?.fdoor) {
                const { minx, maxx, miny, maxy } = bigrm_get_level_extends();
                if (flp & 1) zoo.fdoor.y = miny + maxy - zoo.fdoor.y;
                if (flp & 2) zoo.fdoor.x = minx + maxx - zoo.fdoor.x;
            }
        }

        // solidify_map + non_diggable/non_passwall (RNG-free; order vs. the
        // flip above doesn't matter for RNG, only for the final wall_info
        // state, which is order-independent here).
        soko_solidify_and_nondig();

        // premapped: reveal the whole level's background+boulders+traps into
        // hero memory (RNG-free).
        premap_detect();

        // fill_special_room() loop — this level's one special room (the zoo).
        // C-faithful peace_minded/inventory generation for the zoo's random
        // monsters (game._full_mon_gen); NOT enabled around the mimics above
        // — m_initinv_full() doesn't have a correct S_MIMIC case, and a
        // hostile mimic never reaches the peace_minded call anyway, so the
        // plain path is both correct and simpler there.
        if (zoo) {
            g._full_mon_gen = true;
            try {
                soko_fill_zoo(zoo);
            } finally {
                g._full_mon_gen = false;
            }
        }
    } finally {
        g._full_mon_gen = false;
    }
}
