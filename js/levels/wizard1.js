// levels/wizard1.js - special level builder makemaz_wizard1(), dat/wizard1.lua.
// The top (real) level of the Wizard of Yendor's tower: the moated keep that
// holds the Book of the Dead.

import {
    ANTI_MAGIC, COLNO, HWALL, LR_BRANCH, LR_DOWNSTAIR, LR_TELE, LR_UPSTAIR,
    MAGIC_TRAP, MORGUE, OROOM, ROWNO, SLP_GAS_TRAP, SPIKED_PIT, SQKY_BOARD,
} from '../const.js';
import { game } from '../gstate.js';
import { POTION_CLASS, SCROLL_CLASS, SPBOOK_CLASS } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    l_selection_fillrect, l_selection_negate, l_selection_or,
    selection_getbounds,
} from '../selvar.js';
import {
    flip_level, lspo_door_relative, lspo_map, remove_boundary_syms,
    reset_xystart_size, selection_match, shuffle, splev_create_monster,
    splev_link_doors_rooms, splev_object_at, tower_wallification,
    vly_monster_class, vly_object, vly_region, vly_trap,
} from '../sp_lev.js';
import {
    WIZ_MONSYM, WIZ_W_EAST, wiz_flip_lregions, wiz_hell_tweaks, wiz_ladder,
    wiz_level_flags, wiz_level_init_mazegrid, wiz_level_reset, wiz_levregion_add, wiz_mazewalk,
    wiz_mrandom, wiz_non_diggable, wiz_non_passwall, wiz_place_lregions,
    wiz_sel_area, wiz_sel_from_points,
} from './wiz_common.js';

// ════════════════════════════════════════════════════════════════════════
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("wizard1") ->
// load_special("wizard1.lua").  Loading nhlib.lua first runs shuffle(align)
// (rn2(3), rn2(2)); then the wizard1 body runs in file order.
//
// Draw shape, verified call-for-call against C's recorded trace at seed0360
// flat step 330 (2974 calls):
//   shuffle(align)                        rn2(3), rn2(2)
//   morgue contents door                  math.random(1,3) + create_door
//   des.mazewalk(28,5,"east")             walkfrom + fill_empty_maze
//   fixed monsters / Book of the Dead / boards / random traps / loot
//   hell_tweaks()                         4 x rn2(100)
//   flip_level_rnd(3)                     2 x rn2(2)
//   place_lregions()                      stair-up, stair-down, branch
//
// des.map's contents() is driven by hand rather than through lspo_map's
// callback: this port's create_trap/mazewalk are async, and lspo_map calls
// reset_xystart_size() the moment its callback returns, which would move the
// map origin out from under an awaited body.
// ════════════════════════════════════════════════════════════════════════

const WIZARD1_MAP = [
    '----------------------------x',
    '|.......|..|.........|.....|x',
    '|.......S..|.}}}}}}}.|.....|x',
    '|..--S--|..|.}}---}}.|---S-|x',
    '|..|....|..|.}--.--}.|..|..|x',
    '|..|....|..|.}|...|}.|..|..|x',
    '|..--------|.}--.--}.|..|..|x',
    '|..|.......|.}}---}}.|..|..|x',
    '|..S.......|.}}}}}}}.|..|..|x',
    '|..|.......|.........|..|..|x',
    '|..|.......|-----------S-S-|x',
    '|..|.......S...............|x',
    '----------------------------x',
].join('\n');

// objects.c GEM order — DILITHIUM_CRYSTAL 439, DIAMOND 440, RUBY 441.
const RUBY_OTYP = 441;
// mkobj.js SPE_BOOK_OF_THE_DEAD.
const BOOK_OF_THE_DEAD = 409;

// "Surrounding terror" — the moat dwellers, in wizard1.lua file order.
const WIZ1_MOAT = [
    ['kraken', 14, 2], ['giant eel', 17, 2],
    ['kraken', 13, 4], ['giant eel', 13, 6],
    ['kraken', 19, 4], ['giant eel', 19, 6],
    ['kraken', 15, 8], ['giant eel', 17, 8],
    ['piranha', 15, 2], ['piranha', 19, 8],
];

// "Some random loot" after the ruby.
const WIZ1_LOOT = [
    POTION_CLASS, POTION_CLASS, SCROLL_CLASS, SCROLL_CLASS,
    SPBOOK_CLASS, SPBOOK_CLASS, SPBOOK_CLASS,
];

export async function makemaz_wizard1() {
    const g = game;
    wiz_level_reset();          // load_special: SpLev_Map + lregion list
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="mazegrid", bg="-" }) — no RNG (the MAZEGRID arm
    // of splev_initlev never touches linit->lit).
    wiz_level_init_mazegrid(HWALL);
    // des.level_flags("mazelevel", "noteleport", "hardfloor")
    wiz_level_flags(['mazelevel', 'noteleport', 'hardfloor']);

    // local tmpbounds = selection.match("-"); local bnds = tmpbounds:bounds();
    // local bounds2 = selection.fillrect(bnds.lx, bnds.ly+1, bnds.hx-2, bnds.hy-1)
    // fillrect's corners go through get_location_coord, and at this point the
    // map origin is still load_special's reset (xstart 1, ystart 0).
    const bnds = selection_getbounds(selection_match('-'));
    const bounds2 = l_selection_fillrect(null, bnds.lx + 1, bnds.ly + 1,
                                         bnds.hx - 2 + 1, bnds.hy - 1);

    // des.map({ halign="center", valign="center", map=[[...]] }) — the table
    // form; `lit` defaults to FALSE (sp_lev.c:6121) and draws no rn2(2).
    const wiz1 = lspo_map({
        map: WIZARD1_MAP, halign: 'center', valign: 'center',
        in_themerooms: false,
    });
    await wizard1_contents();
    reset_xystart_size();                 // lspo_map's post-contents reset

    // local protected = bounds2:negate() | wiz1;  hell_tweaks(protected);
    wiz_hell_tweaks(l_selection_or(l_selection_negate(bounds2),
                                   wiz_sel_from_points(wiz1)));

    // lspo_finalize_level(): link_doors_rooms + remove_boundary_syms +
    // map_cleanup (no RNG), wallification (no RNG), flip_level_rnd(3).
    splev_link_doors_rooms();
    remove_boundary_syms();
    tower_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) { flip_level(flp); wiz_flip_lregions(flp); }

    // fixup_special() -> place_lregions(): stair-up, stair-down, branch.
    await wiz_place_lregions();
    if (g.level) g.level._splev_fullmon = true;
}

// The whole level body lives in des.map's contents(), so every coordinate is
// map-relative and every random location draws rn2(29)/rn2(13).
async function wizard1_contents() {
    // Stairs / branch arrive as levregions placed at fixup_special().  The
    // region is region_islev (absolute); the exclusion is map-relative.
    const REG = [1, 0, 79, 20], EXC = [0, 0, 28, 12];
    wiz_levregion_add(LR_UPSTAIR, REG, EXC, { region_islev: true });
    wiz_levregion_add(LR_DOWNSTAIR, REG, EXC, { region_islev: true });
    wiz_levregion_add(LR_BRANCH, REG, EXC, { region_islev: true });
    // des.teleport_region({...}) — dir defaults to "both" (LR_TELE).  Its
    // exclusion is 27 wide, one narrower than the levregions'.
    wiz_levregion_add(LR_TELE, REG, [0, 0, 27, 12], { region_islev: true });

    // The morgue inside the moat.  filled=2 is FILL_LVLFLAGS_ONLY: no fill_zoo,
    // only the level's graveyard flag.  Its contents() makes the one door.
    vly_region(12, 1, 20, 9, 0, MORGUE, 2, false, (croom) => {
        const sdwall = ['south', 'west', 'east'];
        const w = sdwall[wiz_mrandom(1, sdwall.length) - 1];
        lspo_door_relative({ wall: w, state: 'secret' }, croom);
    });
    // "another region to constrain monster arrival" — arrival_room forces a
    // real room to exist even though the type is ordinary.
    vly_region(1, 1, 10, 11, 0, OROOM, 0, false, null);

    // des.mazewalk(28,05,"east") — 3-arg form: stocked defaults TRUE, so
    // walkfrom() is followed by fill_empty_maze().
    await wiz_mazewalk(28, 5, WIZ_W_EAST);
    // des.ladder("down", 06,05)
    wiz_ladder(false, 6, 5);

    // Non diggable walls (walls inside the moat stay diggable).
    wiz_non_diggable(wiz_sel_area(0, 0, 11, 12));
    wiz_non_diggable(wiz_sel_area(11, 0, 21, 0));
    wiz_non_diggable(wiz_sel_area(11, 10, 27, 12));
    wiz_non_diggable(wiz_sel_area(21, 0, 27, 10));
    // Non passable walls.
    wiz_non_passwall(wiz_sel_area(0, 0, 11, 12));
    wiz_non_passwall(wiz_sel_area(11, 0, 21, 0));
    wiz_non_passwall(wiz_sel_area(11, 10, 27, 12));
    wiz_non_passwall(wiz_sel_area(21, 0, 27, 10));

    // The wizard and his guards.
    splev_create_monster({ name: 'Wizard of Yendor', mx: 16, my: 5, asleep: 1 });
    splev_create_monster({ name: 'hell hound', mx: 15, my: 5 });
    splev_create_monster({ name: 'vampire lord', mx: 17, my: 5 });
    // The local treasure.
    splev_object_at({ otyp: BOOK_OF_THE_DEAD }, 16, 5);
    // Surrounding terror.
    for (const [nm, mx, my] of WIZ1_MOAT)
        splev_create_monster({ name: nm, mx, my });
    // Random monsters.
    vly_monster_class(WIZ_MONSYM.D);
    vly_monster_class(WIZ_MONSYM.H);
    for (let i = 0; i < 4; i++) vly_monster_class(WIZ_MONSYM['&']);

    // And to make things a little harder.
    await vly_trap(SQKY_BOARD, 16, 4);
    await vly_trap(SQKY_BOARD, 16, 6);
    await vly_trap(SQKY_BOARD, 15, 5);
    await vly_trap(SQKY_BOARD, 17, 5);
    // Random traps.
    await vly_trap(SPIKED_PIT);
    await vly_trap(SLP_GAS_TRAP);
    await vly_trap(ANTI_MAGIC);
    await vly_trap(MAGIC_TRAP);
    // Some random loot.
    vly_object({ otyp: RUBY_OTYP });
    for (const oc of WIZ1_LOOT) vly_object({ oclass: oc });
}
