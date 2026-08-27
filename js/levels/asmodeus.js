// levels/asmodeus.js — makemaz_asmodeus(), Asmodeus' lair (dat/asmodeus.lua).
// C ref: mklev.c makelevel() -> makemaz("asmodeus") -> load_special().
//
// A mazegrid level with two des.map() fragments: the keep (asmo1, 21x12, whose
// contents function carries everything the demon lord owns) and an east-west
// corridor (asmo2, 33x5) whose des.mazewalk carves the rest of the maze.  The
// two maps plus the outer border are the "protected" selection handed to
// nhlib.lua's hell_tweaks(), which then floods the remainder with lava.
//
// Each des.map() is loaded WITHOUT lspo_map's `contents` callback and its body
// run inline: the callback is synchronous but the bodies await maketrap().  C's
// lspo_map only differs by calling reset_xystart_size() after the callback,
// which is done explicitly below, so the PRNG order is identical.

import {
    ANTI_MAGIC, COLNO, FIRE_TRAP, HWALL, MAGIC_TRAP, ROWNO, SLP_GAS_TRAP,
    SPIKED_PIT,
} from '../const.js';
import { game } from '../gstate.js';
import {
    ARMOR_CLASS, GEM_CLASS, POTION_CLASS, SCROLL_CLASS, WEAPON_CLASS,
} from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    l_selection_negate, l_selection_or, selection_getbounds,
} from '../selvar.js';
import {
    VLY_S_LICH, VLY_S_VAMPIRE, bigrm_wallification, flip_level, lspo_map,
    quest_place_stair, quest_set_door, remove_boundary_syms, reset_xystart_size,
    selection_match, shuffle, splev_map_reset, splev_region_lit,
    vly_monster_class, vly_non_diggable, vly_object, vly_trap,
} from '../sp_lev.js';
import {
    LR_BRANCH, LR_TELE, LR_UPSTAIR, W_EAST, geh_flip_lregions, geh_hell_tweaks,
    geh_lvlfill_maze_grid, geh_mazewalk, geh_monster_at, geh_place_lregions,
    geh_sel_area, geh_sel_from_points,
} from './gehennom.js';

const ASMO1_MAP = [
    '---------------------',
    '|.............|.....|',
    '|.............S.....|',
    '|---+------------...|',
    '|.....|.........|-+--',
    '|..---|.........|....',
    '|..|..S.........|....',
    '|..|..|.........|....',
    '|..|..|.........|-+--',
    '|..|..-----------...|',
    '|..S..........|.....|',
    '---------------------',
].join('\n');

const ASMO2_MAP = [
    '---------------------------------',
    '................................|',
    '................................+',
    '................................|',
    '---------------------------------',
].join('\n');

// C ref: asmodeus.lua "Some random weapons and armor", in file order.
const ASMO_LOOT = [
    ARMOR_CLASS, ARMOR_CLASS, WEAPON_CLASS, WEAPON_CLASS, GEM_CLASS,
    POTION_CLASS, POTION_CLASS, SCROLL_CLASS, SCROLL_CLASS, SCROLL_CLASS,
];

// monsym.h S_DEMON — des.monster("&").
const S_DEMON = 56;

// The levregions, in file order (stair-up, branch, teleport).  All are
// whole-level (region_islev/exclude_islev).  Rebuilt per call because
// flip_level() mutates them in place.
function asmo_lregions() {
    const box = { lx: 1, ly: 0, hx: 6, hy: 20,
                  nlx: 6, nly: 1, nhx: 70, nhy: 16 };
    return [
        { ...box, rtype: LR_UPSTAIR },
        { ...box, rtype: LR_BRANCH },
        { ...box, rtype: LR_TELE },
    ];
}

export async function makemaz_asmodeus() {
    const g = game;
    splev_map_reset();                 // C: load_special() memsets SpLev_Map
    reset_xystart_size();              // C: load_special() sp_lev.c:6373
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({style="mazegrid", bg="-"}) — no RNG.  It runs BEFORE
    // des.level_flags, so level.flags.corrmaze is still false here.
    geh_lvlfill_maze_grid(HWALL);
    // des.level_flags("mazelevel") — no RNG.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;

    // local bounds2 = selection.fillrect(bnds.lx, bnds.ly+1, bnds.hx-2, bnds.hy-1)
    // over selection.match("-"):bounds().  nhlsel.c l_selection_getbounds()
    // returns ABSOLUTE coordinates but l_selection_fillrect() runs its corners
    // back through get_location_coord(), so the rect is shifted by the map
    // origin a second time (xstart 1, ystart 0 here).  No RNG.
    const bnds = selection_getbounds(selection_match('-'));
    const bounds2 = geh_sel_area(bnds.lx, bnds.ly + 1,
                                 bnds.hx - 2, bnds.hy - 1);

    // ── First part: the keep ────────────────────────────────────────────
    const asmo1 = geh_sel_from_points(lspo_map({
        map: ASMO1_MAP, halign: 'half-left', valign: 'center',
        in_themerooms: false }));
    g._full_mon_gen = true;
    try {
        // Doors / stairs / non-diggable / the unlit region — no RNG.
        quest_set_door(4, 3, 'closed');
        quest_set_door(18, 4, 'locked');
        quest_set_door(18, 8, 'closed');
        quest_place_stair(13, 7, false);
        vly_non_diggable(0, 0, 20, 11);
        // des.region(selection.area(01,01,20,10),"unlit") — the two-argument
        // form: sets lit only, builds no room.
        splev_region_lit(1, 1, 20, 10, 0);
        // The fellow in residence.
        geh_monster_at('Asmodeus', 12, 7);
        // Some random weapons and armor.
        for (const oc of ASMO_LOOT) vly_object({ oclass: oc });
        // Some traps — two at fixed coordinates, five at random ones.
        await vly_trap(SPIKED_PIT, 5, 2);
        await vly_trap(FIRE_TRAP, 8, 6);
        await vly_trap(SLP_GAS_TRAP);
        await vly_trap(ANTI_MAGIC);
        await vly_trap(FIRE_TRAP);
        await vly_trap(MAGIC_TRAP);
        await vly_trap(MAGIC_TRAP);
        // Random monsters.
        geh_monster_at('ghost', 11, 7);
        geh_monster_at('horned devil', 10, 5);
        vly_monster_class(VLY_S_LICH);
        // Some Vampires for good measure.
        vly_monster_class(VLY_S_VAMPIRE);
        vly_monster_class(VLY_S_VAMPIRE);
        vly_monster_class(VLY_S_VAMPIRE);
    } finally {
        g._full_mon_gen = false;
    }
    reset_xystart_size();              // C: lspo_map's has_contents tail

    // des.levregion x2 + des.teleport_region — registered here, flipped and
    // consumed by fixup_special() below.  No RNG.
    const lregions = asmo_lregions();

    // ── Second part: the corridor whose mazewalk carves the rest ────────
    const asmo2 = geh_sel_from_points(lspo_map({
        map: ASMO2_MAP, halign: 'half-right', valign: 'center',
        in_themerooms: false }));
    g._full_mon_gen = true;
    try {
        // The 3-argument des.mazewalk leaves stocked=TRUE, so fill_empty_maze()
        // stocks whatever the two maps did not claim.
        await geh_mazewalk(32, 2, W_EAST);
        vly_non_diggable(0, 0, 32, 4);
        quest_set_door(32, 2, 'closed');
        vly_monster_class(S_DEMON);
        vly_monster_class(S_DEMON);
        vly_monster_class(S_DEMON);
        await vly_trap(ANTI_MAGIC);
        await vly_trap(FIRE_TRAP);
        await vly_trap(MAGIC_TRAP);
    } finally {
        g._full_mon_gen = false;
    }
    reset_xystart_size();              // C: lspo_map's has_contents tail

    // local protected = bounds2:negate() | asmo1 | asmo2; hell_tweaks(protected)
    const protectedSel = l_selection_or(
        l_selection_or(l_selection_negate(bounds2), asmo1), asmo2);
    g._full_mon_gen = true;
    try {
        geh_hell_tweaks(protectedSel);
    } finally {
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level() — remove_boundary_syms, then wallification
    // (this level is NOT corrmaze), then flip_level_rnd(allow_flips=3), then
    // fixup_special()'s levregion placement.
    remove_boundary_syms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) { flip_level(flp); geh_flip_lregions(flp, lregions); }
    geh_place_lregions(lregions);
}
