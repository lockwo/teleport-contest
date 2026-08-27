// levels/baalz.js — makemaz_baalz(), Baalzebub's lair (dat/baalz.lua).
// C ref: mklev.c makelevel() -> makemaz("baalz") -> load_special("baalz.lua").
//
// The "insect" level: one 49x13 map of a beetle-shaped keep, a corridor maze
// walked west out of its left door, and the demon lord's court.  corrmaze is
// set, which is what keeps lspo_finalize_level()'s wallification from cleaning
// the bug legs away (sp_lev.c:6013 `if (!svl.level.flags.corrmaze)`).

import {
    ANTI_MAGIC, COLNO, FIRE_TRAP, HWALL, IRONBARS, MAGIC_TRAP, POOL, ROWNO,
    SLP_GAS_TRAP, SPIKED_PIT, STONE, W_NONDIGGABLE, isok,
} from '../const.js';
import { game } from '../gstate.js';
import {
    ARMOR_CLASS, GEM_CLASS, POTION_CLASS, SCROLL_CLASS, WEAPON_CLASS,
} from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    VLY_S_LICH, VLY_S_VAMPIRE, flip_level, lspo_map, quest_place_stair,
    quest_set_door, remove_boundary_syms, reset_xystart_size, shuffle,
    splev_map_reset, vly_monster_class, vly_non_diggable, vly_object, vly_trap,
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
    remove_boundary_syms();
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) { flip_level(flp); geh_flip_lregions(flp, lregions); }
    // fixup_special(): place the registered levregions in registration order.
    geh_place_lregions(lregions);
    // ...then the baalzebub_level arm, mkmaze.c baalz_fixup().  No RNG.
    baalz_fixup();
}

// C ref: mkmaze.c baalz_fixup() — custom wallification of the "beetle" portion
// of the level.  The two POOL cells are markers for post-wallify corner fixes
// and the two IRONBARS "eyes" make the squares to their left diggable.
//
// KNOWN GAP: js/mklev.js level_finalize_topology() runs an unconditional
// wallification(1, 0, COLNO-1, ROWNO-1) after every builder, which C skips on a
// corrmaze level; the bug legs are therefore still cleaned afterwards.  No RNG
// either way, so this is a rendering difference only.
export function baalz_fixup() {
    const lvl = game.level;
    if (!lvl) return;
    const nondig = (x, y) => !!(lvl.at(x, y)?.wall_info & W_NONDIGGABLE);
    const bug = { x1: COLNO, y1: ROWNO, x2: 0, y2: 0 };
    const del = { x1: COLNO, y1: ROWNO, x2: 0, y2: 0 };

    let y = Math.trunc(ROWNO / 2), x, lastx = 0, lasty = 0;
    for (x = 0; x < COLNO; ++x)
        if (nondig(x, y)) { if (!lastx) bug.x1 = x + 1; lastx = x; }
    bug.x2 = ((lastx > bug.x1) ? lastx : x) - 1;
    x = bug.x1;
    for (y = 0; y < ROWNO; ++y)
        if (nondig(x, y)) { if (!lasty) bug.y1 = y + 1; lasty = y; }
    bug.y2 = ((lasty > bug.y1) ? lasty : y) - 1;

    for (x = bug.x1; x <= bug.x2; ++x)
        for (y = bug.y1; y <= bug.y2; ++y) {
            const loc = lvl.at(x, y);
            if (!loc) continue;
            if (loc.typ === POOL) {
                loc.typ = HWALL;
                if (del.x1 === COLNO) { del.x1 = x; del.y1 = y; }
                else { del.x2 = x; del.y2 = y; }
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
}
