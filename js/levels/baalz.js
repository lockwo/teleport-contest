// levels/baalz.js — makemaz_baalz(), Baalzebub's lair (dat/baalz.lua).
// C ref: mklev.c makelevel() -> makemaz("baalz") -> load_special("baalz.lua").
//
// The "insect" level: one 49x13 map of a beetle-shaped keep, a corridor maze
// walked west out of its left door, and the demon lord's court.  corrmaze is
// set, which is what keeps lspo_finalize_level()'s wallification from cleaning
// the bug legs away (sp_lev.c:6013 `if (!svl.level.flags.corrmaze)`).

import {
    ANTI_MAGIC, BLCORNER, BRCORNER, COLNO, FIRE_TRAP, HWALL, IRONBARS, MAGIC_TRAP,
    POOL, RLOC_ERR, RLOC_NOMSG, ROWNO, SLP_GAS_TRAP, SPIKED_PIT, STONE, TDWALL,
    TLCORNER, TLWALL, TRCORNER, TRWALL, TUWALL, W_NONDIGGABLE, isok,
} from '../const.js';
import { game } from '../gstate.js';
import {
    ARMOR_CLASS, GEM_CLASS, POTION_CLASS, SCROLL_CLASS, WEAPON_CLASS,
} from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    VLY_S_LICH, VLY_S_VAMPIRE, flip_level, lspo_map, quest_place_stair,
    quest_set_door, remove_boundary_syms, map_cleanup, reset_xystart_size, shuffle,
    splev_link_doors_rooms, splev_map_reset, vly_monster_class, vly_non_diggable, vly_object, vly_trap,
} from '../sp_lev.js';
import {
    LR_BRANCH, LR_TELE, LR_UPSTAIR, W_WEST, geh_flip_lregions, geh_lvlfill_solid,
    geh_mazewalk, geh_monster_at, geh_place_lregions,
} from './gehennom.js';

// baalz.lua:15 — "the two pools are fakes used to mark spots which need special
// wall fixups; the two iron bars are eyes and spots to their left will be made
// diggable".  'F' is nhlua.c char2typ's IRONBARS, 'P' is POOL.
const BAALZ_MAP = [
    '-------------------------------------------------',
    '|                   ----               ----      ',
    '|          ----     |     -----------  |         ',
    '| ------      |  ---------|.........|--P         ',
    '| F....|  -------|...........--------------      ',
    '---....|--|..................S............|----  ',
    '+...--....S..----------------|............S...|  ',
    '---....|--|..................|............|----  ',
    '| F....|  -------|...........-----S--------      ',
    '| ------      |  ---------|.........|--P         ',
    '|          ----     |     -----------  |         ',
    '|                   ----               ----      ',
    '-------------------------------------------------',
].join('\n');

// C ref: baalz.lua's random loot roster, in file order.
const BAALZ_LOOT = [
    ARMOR_CLASS, ARMOR_CLASS, WEAPON_CLASS, WEAPON_CLASS, GEM_CLASS,
    POTION_CLASS, POTION_CLASS, SCROLL_CLASS, SCROLL_CLASS, SCROLL_CLASS,
];

const BAALZ_TRAPS = [
    SPIKED_PIT, FIRE_TRAP, SLP_GAS_TRAP, ANTI_MAGIC, FIRE_TRAP,
    MAGIC_TRAP, MAGIC_TRAP,
];

// The levregions baalz.lua registers, in registration order.  region_islev /
// exclude_islev make both rectangles absolute level coordinates.  Rebuilt per
// call because flip_level() mutates them in place.
function baalz_lregions() {
    const box = { lx: 1, ly: 0, hx: 15, hy: 20,
                  nlx: 15, nly: 1, nhx: 70, nhy: 16 };
    return [
        { ...box, rtype: LR_UPSTAIR },
        { ...box, rtype: LR_BRANCH },
        { ...box, rtype: LR_TELE },
    ];
}

export async function makemaz_baalz() {
    const g = game;
    // C ref: sp_lev.c load_special() memsets SpLev_Map before running the script.
    splev_map_reset();
    reset_xystart_size();              // C: load_special() sp_lev.c:6373
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({style="solidfill", fg=" ", lit=0}) — an EXPLICIT lit, so
    // splev_initlev()'s BOOL_RANDOM rn2(2) is NOT drawn.
    geh_lvlfill_solid(STONE, 0);
    // des.level_flags("mazelevel", "corrmaze") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.corrmaze = true;
    }
    // des.map({halign="right", valign="center", ...}) — no contents function, so
    // lspo_map does NOT reset_xystart_size(): every coordinate below stays
    // relative to this map's origin.  No RNG (lit defaults to FALSE).
    lspo_map({ map: BAALZ_MAP, halign: 'right', valign: 'center',
               in_themerooms: false });
    // des.levregion x2 + des.teleport_region — registered here, flipped and
    // consumed by fixup_special() below.
    const lregions = baalz_lregions();
    // "this actually leaves the farthest right column diggable"
    vly_non_diggable(0, 0, 47, 12);
    // des.mazewalk(00,06,"west") — carves the corridor maze and, because the
    // 3-argument form leaves stocked=TRUE, runs fill_empty_maze().
    await geh_mazewalk(0, 6, W_WEST);
    // des.stair("down", 44,06) / des.door("locked",00,06) — no RNG.
    quest_place_stair(44, 6, false);
    quest_set_door(0, 6, 'locked');

    g._full_mon_gen = true;
    try {
        // The fellow in residence.
        geh_monster_at('Baalzebub', 35, 6);
        // Some random weapons and armor, then the loot.
        for (const oc of BAALZ_LOOT) vly_object({ oclass: oc });
        // Some traps.
        for (const tt of BAALZ_TRAPS) await vly_trap(tt);
        // Random monsters.
        geh_monster_at('ghost', 37, 7);
        geh_monster_at('horned devil', 32, 5);
        geh_monster_at('barbed devil', 38, 7);
        // des.monster("L") — a class char with NO coordinate: random location.
        vly_monster_class(VLY_S_LICH);
        // Some Vampires for good measure.
        vly_monster_class(VLY_S_VAMPIRE);
        vly_monster_class(VLY_S_VAMPIRE);
        vly_monster_class(VLY_S_VAMPIRE);
    } finally {
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level() — link_doors_rooms/remove_boundary_syms/
    // map_cleanup, then wallification ONLY when !corrmaze (skipped here), then
    // flip_level_rnd(allow_flips=3), then fixup_special().
    splev_link_doors_rooms();   // set/clear .horizontal for the map's 'S'/'+' doors
    remove_boundary_syms();
    map_cleanup();
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) { flip_level(flp); geh_flip_lregions(flp, lregions); }
    // fixup_special(): place the registered levregions in registration order.
    geh_place_lregions(lregions);
    // ...then the baalzebub_level arm, mkmaze.c baalz_fixup().  No RNG.
    await baalz_fixup();
}

// C ref: mkmaze.c baalz_fixup() — custom wallification of the "beetle" portion
// of the level.  The two POOL cells are markers for post-wallify corner fixes
// and the two IRONBARS "eyes" make the squares to their left diggable.
// lspo_finalize_level() skips its level-wide wallification on a corrmaze level
// (so these legs are not cleaned away); this is the only wallification the
// insect gets, with bughack.inarea steering wall_cleanup()/fix_wall_spines().
export async function baalz_fixup() {
    const lvl = game.level;
    if (!lvl) return;
    const { wallification, bughack, bughack_reset } = await import('../mklev.js');
    const nondig = (x, y) => !!(lvl.at(x, y)?.wall_info & W_NONDIGGABLE);
    bughack_reset();
    const bug0 = bughack.inarea, del0 = bughack.delarea;

    let y = Math.trunc(ROWNO / 2), x, lastx = 0, lasty = 0;
    for (x = 0; x < COLNO; ++x)
        if (nondig(x, y)) { if (!lastx) bug0.x1 = x + 1; lastx = x; }
    bug0.x2 = ((lastx > bug0.x1) ? lastx : x) - 1;
    x = bug0.x1;
    for (y = 0; y < ROWNO; ++y)
        if (nondig(x, y)) { if (!lasty) bug0.y1 = y + 1; lasty = y; }
    bug0.y2 = ((lasty > bug0.y1) ? lasty : y) - 1;

    for (x = bug0.x1; x <= bug0.x2; ++x)
        for (y = bug0.y1; y <= bug0.y2; ++y) {
            const loc = lvl.at(x, y);
            if (!loc) continue;
            if (loc.typ === POOL) {
                loc.typ = HWALL;
                if (del0.x1 === COLNO) { del0.x1 = x; del0.y1 = y; }
                else { del0.x2 = x; del0.y2 = y; }
            } else if (loc.typ === IRONBARS) {
                // novelty effect; allow digging in front of the 'eyes'
                if (isok(x - 1, y) && nondig(x - 1, y)) {
                    lvl.at(x - 1, y).wall_info &= ~W_NONDIGGABLE;
                    if (isok(x - 2, y)) lvl.at(x - 2, y).wall_info &= ~W_NONDIGGABLE;
                } else if (isok(x + 1, y) && nondig(x + 1, y)) {
                    lvl.at(x + 1, y).wall_info &= ~W_NONDIGGABLE;
                    if (isok(x + 2, y)) lvl.at(x + 2, y).wall_info &= ~W_NONDIGGABLE;
                }
            }
        }

    wallification(Math.max(bug0.x1 - 2, 1), Math.max(bug0.y1 - 2, 0),
                  Math.min(bug0.x2 + 2, COLNO - 1), Math.min(bug0.y2 + 2, ROWNO - 1));

    // bughack hack for the rear-most legs: the first joint on both top and
    // bottom gets a bogus extra connection to the room area, producing unwanted
    // rectangles; change back to separated legs.
    const { rloc } = await import('../teleport.js');
    const m_at_ = async (px, py) => {
        const { m_at } = await import('../display.js');
        return m_at(px, py);
    };
    x = del0.x1; y = del0.y1;
    if (isok(x, y) && (lvl.at(x, y).typ === TLWALL || lvl.at(x, y).typ === TRWALL)
        && isok(x, y + 1) && lvl.at(x, y + 1).typ === TUWALL) {
        lvl.at(x, y).typ = (lvl.at(x, y).typ === TLWALL) ? BRCORNER : BLCORNER;
        lvl.at(x, y + 1).typ = HWALL;
        const mtmp = await m_at_(x, y);   /* something at temporary pool... */
        if (mtmp) await rloc(mtmp, RLOC_ERR | RLOC_NOMSG);
    }

    x = del0.x2; y = del0.y2;
    if (isok(x, y) && (lvl.at(x, y).typ === TLWALL || lvl.at(x, y).typ === TRWALL)
        && isok(x, y - 1) && lvl.at(x, y - 1).typ === TDWALL) {
        lvl.at(x, y).typ = (lvl.at(x, y).typ === TLWALL) ? TRCORNER : TLCORNER;
        lvl.at(x, y - 1).typ = HWALL;
        const mtmp = await m_at_(x, y);
        if (mtmp) await rloc(mtmp, RLOC_ERR | RLOC_NOMSG);
    }

    /* reset bughack region so later levels' wall_cleanup()/fix_wall_spines()
       fail within_bounded_area() on its first test */
    bughack_reset();
}
