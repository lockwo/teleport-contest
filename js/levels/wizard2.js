// levels/wizard2.js - special level builder makemaz_wizard2(), dat/wizard2.lua.
// The middle level of the Wizard of Yendor's tower: a warren of rooms around a
// zoo, reached by the ladder from wizard1.

import {
    ANTI_MAGIC, COLNO, FILL_NORMAL, HWALL, LR_BRANCH, LR_DOWNSTAIR, LR_TELE,
    LR_UPSTAIR, MAGIC_TRAP, OROOM, ROWNO, SLP_GAS_TRAP, SPIKED_PIT, ZOO,
} from '../const.js';
import { game } from '../gstate.js';
import {
    AMULET_CLASS, POTION_CLASS, SCROLL_CLASS, SPBOOK_CLASS,
} from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    l_selection_fillrect, l_selection_negate, l_selection_or,
    selection_getbounds,
} from '../selvar.js';
import {
    flip_level, lspo_map, remove_boundary_syms, reset_xystart_size,
    selection_match, shuffle, splev_link_doors_rooms, splev_object_at,
    quest_set_door, tower_wallification, vly_object, vly_region, vly_trap,
} from '../sp_lev.js';
import {
    WIZ_W_EAST, wiz_flip_lregions, wiz_hell_tweaks, wiz_ladder,
    wiz_level_flags, wiz_level_init_mazegrid, wiz_level_reset, wiz_levregion_add, wiz_mazewalk,
    wiz_non_diggable, wiz_non_passwall, wiz_place_lregions, wiz_sel_area,
    wiz_sel_from_points,
} from './wiz_common.js';

// ════════════════════════════════════════════════════════════════════════
// C ref: makemaz("wizard2") -> load_special("wizard2.lua").  Same skeleton as
// wizard1 (mazegrid + centered submap + stocked mazewalk + hell_tweaks), but
// the only room that costs RNG here is the zoo, which is filled=1 and therefore
// stocked by fill_zoo() in lspo_finalize_level's fill_special_room() pass.
// wizard2.lua contains no math.random/percent of its own.
// ════════════════════════════════════════════════════════════════════════

const WIZARD2_MAP = [
    '----------------------------x',
    '|.....|.S....|.............|x',
    '|.....|.-------S--------S--|x',
    '|.....|.|.........|........|x',
    '|..-S--S|.........|........|x',
    '|..|....|.........|------S-|x',
    '|..|....|.........|.....|..|x',
    '|-S-----|.........|.....|..|x',
    '|.......|.........|S--S--..|x',
    '|.......|.........|.|......|x',
    '|-----S----S-------.|......|x',
    '|............|....S.|......|x',
    '----------------------------x',
].join('\n');

const WIZ2_LOOT = [
    POTION_CLASS, POTION_CLASS, SCROLL_CLASS, SCROLL_CLASS, SPBOOK_CLASS,
];

export async function makemaz_wizard2() {
    const g = game;
    wiz_level_reset();          // load_special: SpLev_Map + lregion list
    shuffle(['law', 'neutral', 'chaos']);          // nhlib.lua prelude
    wiz_level_init_mazegrid(HWALL);                // style="mazegrid", bg="-"
    wiz_level_flags(['mazelevel', 'noteleport', 'hardfloor']);

    const bnds = selection_getbounds(selection_match('-'));
    const bounds2 = l_selection_fillrect(null, bnds.lx + 1, bnds.ly + 1,
                                         bnds.hx - 2 + 1, bnds.hy - 1);

    const wiz2 = lspo_map({
        map: WIZARD2_MAP, halign: 'center', valign: 'center',
        in_themerooms: false,
    });
    await wizard2_contents();
    reset_xystart_size();

    wiz_hell_tweaks(l_selection_or(l_selection_negate(bounds2),
                                   wiz_sel_from_points(wiz2)));

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

async function wizard2_contents() {
    const REG = [1, 0, 79, 20], EXC = [0, 0, 28, 12];
    wiz_levregion_add(LR_UPSTAIR, REG, EXC, { region_islev: true });
    wiz_levregion_add(LR_DOWNSTAIR, REG, EXC, { region_islev: true });
    wiz_levregion_add(LR_BRANCH, REG, EXC, { region_islev: true });
    wiz_levregion_add(LR_TELE, REG, [0, 0, 27, 12], { region_islev: true });

    // "entire tower in a region, constrains monster migration"
    vly_region(1, 1, 26, 11, 0, OROOM, 0, false, null);
    // The zoo — filled=1, so fill_zoo() stocks it at level finalize.
    vly_region(9, 3, 17, 9, 0, ZOO, FILL_NORMAL, false, null);
    // Explicit door states on map-drawn door cells — no RNG.
    quest_set_door(15, 2, 'closed');
    quest_set_door(11, 10, 'closed');

    await wiz_mazewalk(28, 5, WIZ_W_EAST);
    wiz_ladder(true, 12, 1);
    wiz_ladder(false, 14, 11);

    // Non diggable / non passable walls everywhere.
    wiz_non_diggable(wiz_sel_area(0, 0, 27, 12));
    wiz_non_passwall(wiz_sel_area(0, 0, 27, 12));

    // Random traps.
    await vly_trap(SPIKED_PIT);
    await vly_trap(SLP_GAS_TRAP);
    await vly_trap(ANTI_MAGIC);
    await vly_trap(MAGIC_TRAP);
    // Some random loot.
    for (const oc of WIZ2_LOOT) vly_object({ oclass: oc });
    // treasures — des.object("\"", 04, 06)
    splev_object_at({ oclass: AMULET_CLASS }, 4, 6);
}
