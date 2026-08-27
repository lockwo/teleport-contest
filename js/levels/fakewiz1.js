// levels/fakewiz1.js - special level builder makemaz_fakewiz1(), dat/fakewiz1.lua.
// The first decoy Wizard's tower: a nine-square moated keep with the magic
// portal back to wizard3 at its centre.

import {
    COLNO, HWALL, LR_BRANCH, LR_DOWNSTAIR, LR_PORTAL, LR_TELE, LR_UPSTAIR,
    OROOM, ROWNO, SQKY_BOARD,
} from '../const.js';
import { find_level } from '../dungeon.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import {
    l_selection_fillrect, l_selection_negate, l_selection_or,
    selection_getbounds,
} from '../selvar.js';
import {
    flip_level, lspo_map, remove_boundary_syms, reset_xystart_size,
    selection_match, shuffle, splev_create_monster, splev_link_doors_rooms,
    tower_wallification, vly_region, vly_trap,
} from '../sp_lev.js';
import {
    WIZ_MONSYM, WIZ_W_EAST, wiz_flip_lregions, wiz_hell_tweaks,
    wiz_level_flags, wiz_level_init_mazegrid, wiz_level_reset, wiz_levregion_add, wiz_mazewalk,
    wiz_place_lregions, wiz_sel_from_points,
} from './wiz_common.js';

// ════════════════════════════════════════════════════════════════════════
// C ref: makemaz("fakewiz1") -> load_special("fakewiz1.lua").
// Same skeleton as the real tower but only "mazelevel" is set — a decoy tower
// is NOT noteleport and NOT hardfloor, which changes what rndtrap() may roll
// inside fill_empty_maze() (TRAPDOOR and the two teleporters become legal).
// ════════════════════════════════════════════════════════════════════════

const FAKEWIZ1_MAP = [
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

export async function makemaz_fakewiz1() {
    const g = game;
    wiz_level_reset();          // load_special: SpLev_Map + lregion list
    shuffle(['law', 'neutral', 'chaos']);          // nhlib.lua prelude
    wiz_level_init_mazegrid(HWALL);
    wiz_level_flags(['mazelevel']);

    const bnds = selection_getbounds(selection_match('-'));
    const bounds2 = l_selection_fillrect(null, bnds.lx + 1, bnds.ly + 1,
                                         bnds.hx - 2 + 1, bnds.hy - 1);

    const fw1 = lspo_map({
        map: FAKEWIZ1_MAP, halign: 'center', valign: 'center',
        in_themerooms: false,
    });
    await fakewiz1_contents();
    reset_xystart_size();

    wiz_hell_tweaks(l_selection_or(l_selection_negate(bounds2),
                                   wiz_sel_from_points(fw1)));

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

async function fakewiz1_contents() {
    const REG = [1, 0, 79, 20], EXC = [0, 0, 8, 8];
    wiz_levregion_add(LR_UPSTAIR, REG, EXC, { region_islev: true });
    wiz_levregion_add(LR_DOWNSTAIR, REG, EXC, { region_islev: true });
    wiz_levregion_add(LR_BRANCH, REG, EXC, { region_islev: true });
    wiz_levregion_add(LR_TELE, REG, [2, 2, 6, 6], { region_islev: true });
    // The way back into the real tower.
    wiz_levregion_add(LR_PORTAL, [4, 4, 4, 4], null,
                      { toLevel: find_level('wizard3')?.dlevel || null });

    await wiz_mazewalk(8, 5, WIZ_W_EAST);
    // The keep's interior, irregular so the flood stops at the moat.
    vly_region(4, 3, 6, 6, 0, OROOM, 0, true, null);

    splev_create_monster({ cls: WIZ_MONSYM.L, mx: 4, my: 4 });
    splev_create_monster({ name: 'vampire lord', mx: 3, my: 4 });
    splev_create_monster({ name: 'kraken', mx: 6, my: 6 });

    // And to make things a little harder.
    await vly_trap(SQKY_BOARD, 4, 3);
    await vly_trap(SQKY_BOARD, 4, 5);
    await vly_trap(SQKY_BOARD, 3, 4);
    await vly_trap(SQKY_BOARD, 5, 4);
}
