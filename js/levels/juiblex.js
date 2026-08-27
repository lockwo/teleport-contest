// levels/juiblex.js — makemaz_juiblex(), Juiblex's swamp (dat/juiblex.lua).
// C ref: mklev.c makelevel() -> makemaz("juiblex") -> load_special().
//
// A "relaxed blockwise maze" swamp (lvlfill_swamp) with three des.map() overlays:
// two 8x5 dry patches that guarantee stair placement and the 51x18 lair.  The
// level carries "noflip", so lspo_finalize_level()'s flip_level_rnd draws
// NOTHING here (`(flp & 1) && rn2(2)` short-circuits on allow_flips == 0).

import {
    ANTI_MAGIC, COLNO, FOUNTAIN, MAGIC_TRAP, MOAT, ROOM, ROWNO, SLP_GAS_TRAP,
    SWAMP,
} from '../const.js';
import { game } from '../gstate.js';
import { BOULDER, FOOD_CLASS, GEM_CLASS, POTION_CLASS } from '../mkobj.js';
import { rn2 } from '../rng.js';
import { selection_new, selection_rndcoord, selection_setpoint } from '../selvar.js';
import {
    bigrm_wallification, gx, gy, lspo_map, remove_boundary_syms,
    reset_xystart_size, shuffle, splev_create_monster, splev_feature,
    splev_map_reset, splev_object_at, vly_object, vly_region, vly_trap,
} from '../sp_lev.js';
import {
    GEH_MONSYM, LR_BRANCH, LR_DOWNSTAIR, LR_DOWNTELE, LR_UPSTAIR, LR_UPTELE,
    geh_lvlfill_solid, geh_place_lregions,
} from './gehennom.js';

// "guarantee at least one open spot to ensure successful stair placement"
const JUIBLEX_MAP1 = [
    'xxxxxxxx',
    'xx...xxx',
    'xxx...xx',
    'xxxx.xxx',
    'xxxxxxxx',
].join('\n');

const JUIBLEX_MAP2 = [
    'xxxxxxxx',
    'xxxx.xxx',
    'xxx...xx',
    'xx...xxx',
    'xxxxxxxx',
].join('\n');

const JUIBLEX_LAIR = [
    'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'xxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxx',
    'xxx...xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...xxx',
    'xxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxx',
    'xxxxxxxxxxxxxxxxxxxxxxxx}}}xxxxxxxxxxxxxxx}}}}}xxxx',
    'xxxxxxxxxxxxxxxxxxxxxxx}}}}}xxxxxxxxxxxxx}.....}xxx',
    'xxxxxxxxxxxxxxxxxxxxxx}}...}}xxxxxxxxxxx}..P.P..}xx',
    'xxxxxxxxxxxxxxxxxxxxx}}..P..}}xxxxxxxxxxx}.....}xxx',
    'xxxxxxxxxxxxxxxxxxxxx}}.P.P.}}xxxxxxxxxxxx}...}xxxx',
    'xxxxxxxxxxxxxxxxxxxxx}}..P..}}xxxxxxxxxxxx}...}xxxx',
    'xxxxxxxxxxxxxxxxxxxxxx}}...}}xxxxxxxxxxxxxx}}}xxxxx',
    'xxxxxxxxxxxxxxxxxxxxxxx}}}}}xxxxxxxxxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxxxxxxxxxx}}}xxxxxxxxxxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'xxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxx',
    'xxx...xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...xxx',
    'xxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxx',
    'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
].join('\n');

// C ref: sp_lev.c lvlfill_swamp() — lvlfill_solid(bg) then a "relaxed blockwise
// maze" (Jamis Buck): every other cell becomes fg, and where all three of its
// east/south/south-east neighbours are still bg one of them is opened, chosen
// by an rn2(3).  des.level_init({style="swamp", lit=0}) leaves fg at its ROOM
// default and bg at the swamp-specific MOAT (sp_lev.c:6446).
function juiblex_lvlfill_swamp(fg, bg, lit) {
    geh_lvlfill_solid(bg, lit);
    const xmax = Math.min(78, COLNO - 2), ymax = Math.min(20, ROWNO - 2);
    for (let x = 2; x <= xmax; x += 2)
        for (let y = 0; y <= ymax; y += 2) {
            let c = 0;
            set_typ(x, y, fg, lit);
            if (game.level?.at(x + 1, y)?.typ === bg) ++c;
            if (game.level?.at(x, y + 1)?.typ === bg) ++c;
            if (game.level?.at(x + 1, y + 1)?.typ === bg) ++c;
            if (c === 3) {
                switch (rn2(3)) {                 // sp_lev.c:410
                case 0: set_typ(x + 1, y, fg, lit); break;
                case 1: set_typ(x, y + 1, fg, lit); break;
                case 2: set_typ(x + 1, y + 1, fg, lit); break;
                default: break;
                }
            }
        }
}

function set_typ(x, y, typ, lit) {
    const loc = game.level?.at(x, y);
    if (!loc) return;
    loc.typ = typ;
    loc.lit = !!lit;
}

// "And lots of blobby monsters" — the fixed-coordinate ring around Juiblex uses
// the SHUFFLED class list, so the shuffle's three draws must happen first and
// the indices (Lua 1-based) be read from the shuffled array.
const JUIBLEX_RING = [
    [4, 25, 6], [1, 24, 7], [2, 26, 7], [3, 23, 8],
    [3, 27, 8], [2, 24, 9], [1, 26, 9], [4, 25, 10],
];

const JUIBLEX_FILLER = [
    'j', 'j', 'j', 'j', 'P', 'P', 'P', 'P', 'b', 'b', 'b', 'F', 'F', 'F',
    'm', 'm',
];

function juiblex_lregions() {
    // exclude={0,0,50,17} has NO exclude_islev, so levregion_add() runs it
    // through get_location(ANY_LOC): the lair map's origin (15,3) is added.
    const ex = { nlx: 15, nly: 3, nhx: 65, nhy: 20 };
    const left = { lx: 1, ly: 0, hx: 11, hy: 20, ...ex };
    const right = { lx: 69, ly: 0, hx: 79, hy: 20, ...ex };
    return [
        { ...left, rtype: LR_DOWNSTAIR },
        { ...right, rtype: LR_UPSTAIR },
        { ...left, rtype: LR_BRANCH },
        { ...left, rtype: LR_UPTELE },
        { ...right, rtype: LR_DOWNTELE },
    ];
}

export async function makemaz_juiblex() {
    const g = game;
    splev_map_reset();                 // C: load_special() memsets SpLev_Map
    reset_xystart_size();              // C: load_special() sp_lev.c:6373
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_flags("mazelevel","shortsighted","noflip","temperate") — this
    // level declares its flags BEFORE level_init.  "temperate" is temperature 0,
    // which zeroes rndmonst_adj's temperature_shift() for every species here.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.shortsighted = true;
        g.level.flags.temperature = 0;
    }
    // des.level_init({style="swamp", lit=0}) — an explicit lit, so no rn2(2).
    juiblex_lvlfill_swamp(ROOM, MOAT, 0);

    // Two dry patches so the stair levregions always have somewhere to go.
    lspo_map({ map: JUIBLEX_MAP1, halign: 'left', valign: 'bottom',
               in_themerooms: false });
    vly_object({ otyp: BOULDER });
    lspo_map({ map: JUIBLEX_MAP2, halign: 'right', valign: 'top',
               in_themerooms: false });
    vly_object({ otyp: BOULDER });
    // The lair — the BARE des.map([[...]]) form, so lit is FALSE and centered.
    lspo_map({ map: JUIBLEX_LAIR, halign: 'center', valign: 'center',
               in_themerooms: false });

    // Random registers: shuffle(monster) over a 4-element list — rn2(4), rn2(3),
    // rn2(2).  Port the call, never the result.
    const monster = ['j', 'b', 'P', 'F'];
    shuffle(monster);

    // local place = selection.new(); place:set(x,y) x4 — map-relative coords
    // resolved against the lair's origin.  No RNG.
    const place = selection_new();
    for (const [px, py] of [[4, 2], [46, 2], [4, 15], [46, 15]])
        selection_setpoint(px + gx.xstart, py + gy.ystart, place, 1);

    // Dungeon description — the swamp region is filled=2 (FILL_LVLFLAGS_ONLY).
    vly_region(0, 0, 50, 17, 0, SWAMP, 2, false);
    const lregions = juiblex_lregions();

    g._full_mon_gen = true;
    try {
        // des.feature("fountain", place:rndcoord(1)) — one rn2(#points), and the
        // point is consumed.
        let c = selection_rndcoord(place, true);
        splev_feature(c.x - gx.xstart, c.y - gy.ystart, FOUNTAIN);
        // Three giant mimics disguised as fountains, each on another rndcoord.
        for (let i = 0; i < 3; i++) {
            c = selection_rndcoord(place, true);
            const mtmp = splev_create_monster({
                name: 'giant mimic',
                mx: c.x - gx.xstart, my: c.y - gy.ystart,
            });
            if (mtmp) {                 // appear_as = "ter:fountain"
                mtmp.m_ap_type = 'furniture';
                mtmp.mappearance = SMS_S_FOUNTAIN;
            }
        }
        // The demon of the swamp, and a couple of demons.
        splev_create_monster({ name: 'Juiblex', mx: 25, my: 8 });
        splev_create_monster({ name: 'lemure', mx: 43, my: 8 });
        splev_create_monster({ name: 'lemure', mx: 44, my: 8 });
        splev_create_monster({ name: 'lemure', mx: 45, my: 8 });
        // Some liquids and gems.
        splev_object_at({ oclass: GEM_CLASS }, 43, 6);
        splev_object_at({ oclass: GEM_CLASS }, 45, 6);
        splev_object_at({ oclass: POTION_CLASS }, 43, 9);
        splev_object_at({ oclass: POTION_CLASS }, 44, 9);
        splev_object_at({ oclass: POTION_CLASS }, 45, 9);
        // And lots of blobby monsters.
        for (const [idx, mx, my] of JUIBLEX_RING)
            splev_create_monster({ cls: GEH_MONSYM[monster[idx - 1]], mx, my });
        for (const ch of JUIBLEX_FILLER)
            splev_create_monster({ cls: GEH_MONSYM[ch] });
        splev_create_monster({ name: 'jellyfish' });
        splev_create_monster({ name: 'jellyfish' });
        // Some random objects.
        vly_object({ oclass: POTION_CLASS });
        vly_object({ oclass: POTION_CLASS });
        vly_object({ oclass: POTION_CLASS });
        vly_object({ oclass: FOOD_CLASS });
        vly_object({ oclass: FOOD_CLASS });
        vly_object({ oclass: FOOD_CLASS });
        vly_object({ otyp: BOULDER });
        // Some traps.
        await vly_trap(SLP_GAS_TRAP);
        await vly_trap(SLP_GAS_TRAP);
        await vly_trap(ANTI_MAGIC);
        await vly_trap(ANTI_MAGIC);
        await vly_trap(MAGIC_TRAP);
        await vly_trap(MAGIC_TRAP);
    } finally {
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level() — remove_boundary_syms, wallification (not
    // corrmaze), flip_level_rnd(allow_flips == 0 -> NO draws), fixup_special().
    remove_boundary_syms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    geh_place_lregions(lregions);
}

// defsym.h S_fountain — the M_AP_FURNITURE appearance "ter:fountain" resolves to.
const SMS_S_FOUNTAIN = 37;
