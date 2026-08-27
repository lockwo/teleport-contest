// levels/wizard3.js - special level builder makemaz_wizard3(), dat/wizard3.lua.
// The bottom level of the Wizard of Yendor's tower: a second moated keep, a
// beehive, and the magic portal out to the first decoy tower.

import {
    BEEHIVE, COLNO, FILL_NORMAL, HWALL, LR_BRANCH, LR_DOWNSTAIR, LR_PORTAL,
    LR_TELE, LR_UPSTAIR, MORGUE, OROOM, ROWNO, SQKY_BOARD,
} from '../const.js';
import { find_level } from '../dungeon.js';
import { game } from '../gstate.js';
import {
    AMULET_CLASS, POTION_CLASS, SCROLL_CLASS, TOOL_CLASS, WEAPON_CLASS,
} from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    l_selection_fillrect, l_selection_negate, l_selection_or,
    selection_getbounds,
} from '../selvar.js';
import {
    flip_level, lspo_door_relative, lspo_map, percent, remove_boundary_syms,
    reset_xystart_size, selection_match, shuffle, splev_create_monster,
    splev_link_doors_rooms, splev_object_at, quest_set_door,
    tower_wallification, vly_monster_class, vly_object, vly_region, vly_trap,
} from '../sp_lev.js';
import {
    WIZ_MONSYM, WIZ_W_EAST, wiz_flip_lregions, wiz_hell_tweaks, wiz_ladder,
    wiz_level_flags, wiz_level_init_mazegrid, wiz_level_reset, wiz_levregion_add, wiz_mazewalk,
    wiz_non_diggable, wiz_non_passwall, wiz_place_lregions, wiz_sel_area,
    wiz_sel_from_points,
} from './wiz_common.js';

// ════════════════════════════════════════════════════════════════════════
// C ref: makemaz("wizard3") -> load_special("wizard3.lua").
//
// Two things here are unlike wizard1/2:
//   * a des.levregion({type="portal", name="fakewiz1"}) whose region is NOT
//     region_islev, so its single cell is map-relative; place_lregions()
//     resolves the name through find_level() and mkportal()s the destination.
//   * the arrival room's contents() runs `if percent(50) then w = "west" end`,
//     so the level draws one rn2(100) BEFORE its create_door() loop.
// ════════════════════════════════════════════════════════════════════════

const WIZARD3_MAP = [
    '----------------------------x',
    '|..|............S..........|x',
    '|..|..------------------S--|x',
    '|..|..|.........|..........|x',
    '|..S..|.}}}}}}}.|..........|x',
    '|..|..|.}}---}}.|-S--------|x',
    '|..|..|.}--.--}.|..|.......|x',
    '|..|..|.}|...|}.|..|.......|x',
    '|..---|.}--.--}.|..|.......|x',
    '|.....|.}}---}}.|..|.......|x',
    '|.....S.}}}}}}}.|..|.......|x',
    '|.....|.........|..|.......|x',
    '----------------------------x',
].join('\n');

// "Some surrounding horrors" — the moat dwellers, in file order.
const WIZ3_MOAT = [
    ['kraken', 8, 5], ['giant eel', 8, 8],
    ['kraken', 14, 5], ['giant eel', 14, 8],
];

// "Some loot" — des.object(")"), ("!"), ("?"), ("?"), ("(").
const WIZ3_LOOT = [
    WEAPON_CLASS, POTION_CLASS, SCROLL_CLASS, SCROLL_CLASS, TOOL_CLASS,
];

export async function makemaz_wizard3() {
    const g = game;
    wiz_level_reset();          // load_special: SpLev_Map + lregion list
    shuffle(['law', 'neutral', 'chaos']);          // nhlib.lua prelude
    wiz_level_init_mazegrid(HWALL);
    wiz_level_flags(['mazelevel', 'noteleport', 'hardfloor']);

    const bnds = selection_getbounds(selection_match('-'));
    const bounds2 = l_selection_fillrect(null, bnds.lx + 1, bnds.ly + 1,
                                         bnds.hx - 2 + 1, bnds.hy - 1);

    const wiz3 = lspo_map({
        map: WIZARD3_MAP, halign: 'center', valign: 'center',
        in_themerooms: false,
    });
    await wizard3_contents();
    reset_xystart_size();

    wiz_hell_tweaks(l_selection_or(l_selection_negate(bounds2),
                                   wiz_sel_from_points(wiz3)));

    splev_link_doors_rooms();
    remove_boundary_syms();
    tower_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;
    if (rn2(2)) flp |= 2;
    if (flp) { flip_level(flp); wiz_flip_lregions(flp); }

    await wiz_place_lregions();
    if (g.level) g.level._splev_fullmon = true;
}

async function wizard3_contents() {
    const REG = [1, 0, 79, 20], EXC = [0, 0, 28, 12];
    wiz_levregion_add(LR_UPSTAIR, REG, EXC, { region_islev: true });
    wiz_levregion_add(LR_DOWNSTAIR, REG, EXC, { region_islev: true });
    wiz_levregion_add(LR_BRANCH, REG, EXC, { region_islev: true });
    wiz_levregion_add(LR_TELE, REG, [0, 0, 27, 12], { region_islev: true });
    // des.levregion({ region={25,11,25,11}, type="portal", name="fakewiz1" }) —
    // no region_islev, so the cell IS map-relative.  place_lregions() resolves
    // the name with find_level() before calling place_lregion().
    wiz_levregion_add(LR_PORTAL, [25, 11, 25, 11], null,
                      { toLevel: find_level('fakewiz1')?.dlevel || null });

    // des.mazewalk(28,09,"east") — 3-arg form, stocked.
    await wiz_mazewalk(28, 9, WIZ_W_EAST);

    // The morgue (filled=2: level flags only) and the beehive (filled=1).
    vly_region(7, 3, 15, 11, 0, MORGUE, 2, false, null);
    vly_region(17, 6, 18, 11, 0, BEEHIVE, FILL_NORMAL, false, null);
    // "make the entry chamber a real room; it affects monster arrival"
    vly_region(20, 6, 26, 11, 0, OROOM, 0, false, (croom) => {
        let w = 'north';
        if (percent(50)) w = 'west';
        lspo_door_relative({ state: 'secret', wall: w }, croom);
    });
    quest_set_door(18, 5, 'closed');
    wiz_ladder(true, 11, 7);

    // Non diggable walls (walls inside the moat stay diggable).
    wiz_non_diggable(wiz_sel_area(0, 0, 6, 12));
    wiz_non_diggable(wiz_sel_area(6, 0, 27, 2));
    wiz_non_diggable(wiz_sel_area(16, 2, 27, 12));
    wiz_non_diggable(wiz_sel_area(6, 12, 16, 12));
    wiz_non_passwall(wiz_sel_area(0, 0, 6, 12));
    wiz_non_passwall(wiz_sel_area(6, 0, 27, 2));
    wiz_non_passwall(wiz_sel_area(16, 2, 27, 12));
    wiz_non_passwall(wiz_sel_area(6, 12, 16, 12));

    // The guards.
    splev_create_monster({ cls: WIZ_MONSYM.L, mx: 10, my: 7 });
    splev_create_monster({ name: 'vampire lord', mx: 12, my: 7 });
    for (const [nm, mx, my] of WIZ3_MOAT)
        splev_create_monster({ name: nm, mx, my });
    // Other monsters.
    vly_monster_class(WIZ_MONSYM.L);
    vly_monster_class(WIZ_MONSYM.D);
    splev_create_monster({ cls: WIZ_MONSYM.D, mx: 26, my: 9 });
    for (let i = 0; i < 3; i++) vly_monster_class(WIZ_MONSYM['&']);

    // And to make things a little harder.
    await vly_trap(SQKY_BOARD, 10, 7);
    await vly_trap(SQKY_BOARD, 12, 7);
    await vly_trap(SQKY_BOARD, 11, 6);
    await vly_trap(SQKY_BOARD, 11, 8);
    // Some loot.
    for (const oc of WIZ3_LOOT) vly_object({ oclass: oc });
    // treasures — des.object("\"", 11, 07)
    splev_object_at({ oclass: AMULET_CLASS }, 11, 7);
}
