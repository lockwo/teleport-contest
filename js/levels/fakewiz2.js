// levels/fakewiz2.js - special level builder makemaz_fakewiz2(), dat/fakewiz2.lua.
// The second decoy Wizard's tower.  Identical to fakewiz1 except it has NO
// portal and NO arrival region, and an amulet sits at the keep's centre.

import {
    COLNO, HWALL, LR_BRANCH, LR_DOWNSTAIR, LR_TELE, LR_UPSTAIR, ROWNO,
    SQKY_BOARD,
} from '../const.js';
import { game } from '../gstate.js';
import { AMULET_CLASS } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    l_selection_fillrect, l_selection_negate, l_selection_or,
    selection_getbounds,
} from '../selvar.js';
import {
    flip_level, lspo_map, remove_boundary_syms, reset_xystart_size,
    selection_match, shuffle, splev_create_monster, splev_link_doors_rooms,
    splev_object_at, tower_wallification, vly_trap,
} from '../sp_lev.js';
import {
    WIZ_MONSYM, WIZ_W_EAST, wiz_flip_lregions, wiz_hell_tweaks,
    wiz_level_flags, wiz_level_init_mazegrid, wiz_level_reset, wiz_levregion_add, wiz_mazewalk,
    wiz_place_lregions, wiz_sel_from_points,
} from './wiz_common.js';

const FAKEWIZ2_MAP = [
    '.........',
    '.}}}}}}}.',
    '.}}---}}.',
    '.}--.--}.',
    '.}|...|}.',
    '.}--.--}.',
    '.}}---}}.',
    '.}}}}}}}.',
    '.........',
].join('\n');

export async function makemaz_fakewiz2() {
    const g = game;
    wiz_level_reset();          // load_special: SpLev_Map + lregion list
    shuffle(['law', 'neutral', 'chaos']);          // nhlib.lua prelude
    wiz_level_init_mazegrid(HWALL);
    wiz_level_flags(['mazelevel']);

    const bnds = selection_getbounds(selection_match('-'));
    const bounds2 = l_selection_fillrect(null, bnds.lx + 1, bnds.ly + 1,
                                         bnds.hx - 2 + 1, bnds.hy - 1);

    const fw2 = lspo_map({
        map: FAKEWIZ2_MAP, halign: 'center', valign: 'center',
        in_themerooms: false,
    });
    await fakewiz2_contents();
    reset_xystart_size();

    wiz_hell_tweaks(l_selection_or(l_selection_negate(bounds2),
                                   wiz_sel_from_points(fw2)));

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

async function fakewiz2_contents() {
    const REG = [1, 0, 79, 20], EXC = [0, 0, 8, 8];
    wiz_levregion_add(LR_UPSTAIR, REG, EXC, { region_islev: true });
    wiz_levregion_add(LR_DOWNSTAIR, REG, EXC, { region_islev: true });
    wiz_levregion_add(LR_BRANCH, REG, EXC, { region_islev: true });
    wiz_levregion_add(LR_TELE, REG, [2, 2, 6, 6], { region_islev: true });

    await wiz_mazewalk(8, 5, WIZ_W_EAST);

    splev_create_monster({ cls: WIZ_MONSYM.L, mx: 4, my: 4 });
    splev_create_monster({ name: 'vampire lord', mx: 3, my: 4 });
    splev_create_monster({ name: 'kraken', mx: 6, my: 6 });

    // And to make things a little harder.
    await vly_trap(SQKY_BOARD, 4, 3);
    await vly_trap(SQKY_BOARD, 4, 5);
    await vly_trap(SQKY_BOARD, 3, 4);
    await vly_trap(SQKY_BOARD, 5, 4);
    // treasures — des.object("\"",04,04)
    splev_object_at({ oclass: AMULET_CLASS }, 4, 4);
}
