// levels/pri_strt.js - special level builder makemaz_pri_strt(), split out of js/sp_lev.js.
// sp_lev.js re-exports makemaz_pri_strt so existing importers are unaffected; the
// shared special-level machinery still lives there and is imported below.

import { ALTAR, COLNO, ROOM, ROWNO, TREE } from '../const.js';
import { game } from '../gstate.js';
import { CHEST } from '../mkobj.js';
import { rn2, rnd } from '../rng.js';
import { maketrap } from '../trap.js';
import {
    TEMPLE_RTYPE, bigrm_load_map, bigrm_wallification, flip_level, q_absx, q_absy,
    quest_create_monster, quest_create_monster_at, quest_create_object,
    quest_create_trap_random, quest_drop_default_invent, quest_flip_branch,
    quest_floodfill_match, quest_level_init_solidfill, quest_place_stair, quest_region_light,
    quest_register_branch, quest_replace_terrain, quest_rndcoord, quest_set_door, shuffle,
    vly_region,
} from '../sp_lev.js';

// ════════════════════════════════════════════════════════════════════════
// Priest quest "home" level loader (dat/Pri-strt.lua) — the Great Temple.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Pri-strt")
// -> load_special("Pri-strt.lua").  Same splev engine as Bar-strt/Arc-strt:
// loading nhlib.lua first runs shuffle(align) (rn2(3),rn2(2)); level_init
// solidfill draws one rn2(2); then the des.* program runs in file order
// consuming the PRNG exactly.
//
// The temple room (des.region{type="temple"}) draws no RNG: lspo_region's
// add_room() is called with special=TRUE (the walls are already stamped by
// the ASCII map) so it only mutates the room list (in_rooms/engrave/priest-AI
// bookkeeping), never levl[][].typ.  This port skips that bookkeeping — it
// has no bearing on the RNG stream or the rendered screen.  The altar is
// explicit-coord, type="altar" (shrine=0), so create_altar() returns before
// reaching priestini()/has_temple — matching the .lua's own "Unattended Altar
// - unaligned due to conflict" comment.
// ════════════════════════════════════════════════════════════════════════

const PRI_STRT_MAP = [
    '............................................................................',
    '............................................................................',
    '............................................................................',
    '....................------------------------------------....................',
    '....................|................|.....|.....|.....|....................',
    '....................|..------------..|--+-----+-----+--|....................',
    '....................|..|..........|..|.................|....................',
    '....................|..|..........|..|+---+---+-----+--|....................',
    '..................---..|..........|......|...|...|.....|....................',
    '..................+....|..........+......|...|...|.....|....................',
    '..................+....|..........+......|...|...|.....|....................',
    '..................---..|..........|......|...|...|.....|....................',
    '....................|..|..........|..|+-----+---+---+--|....................',
    '....................|..|..........|..|.................|....................',
    '....................|..------------..|--+-----+-----+--|....................',
    '....................|................|.....|.....|.....|....................',
    '....................------------------------------------....................',
    '............................................................................',
    '............................................................................',
    '............................................................................',
].join('\n');

// C ref: sp_lev.c lspo_altar/create_altar for an explicit coord, type="altar"
// (shrine=0, so the `if (a->shrine<0) a->shrine=rn2(2)` random case never
// triggers — no RNG).  With no enclosing room context, get_location_coord on
// an explicit coord is a direct passthrough (no RNG); set_levltyp(ALTAR) then
// stamps the terrain and altarmask.  shrine==0 short-circuits before
// priestini()/has_temple.
function quest_create_altar(mx, my, amask) {
    const loc = game.level?.at(q_absx(mx), q_absy(my));
    if (!loc) return;
    loc.typ = ALTAR;
    loc.altarmask = amask;
}

// Main executor.  C ref: makemaz("Pri-strt") -> load_special.
export async function makemaz_pri_strt() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_flags("mazelevel", "noteleport", "hardfloor") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
    }
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    const lit = quest_level_init_solidfill();
    // des.map([[...]]) — full-level map, SPLEV_CENTER offset.  No RNG.
    bigrm_load_map(PRI_STRT_MAP, false);  // des.map bare string -> lit=FALSE
    // des.region(selection.area(00,00,75,19), "lit") — no RNG.
    quest_region_light(0, 0, 75, 19, true);
    // des.region({ region={24,06,33,13}, lit=1, type="temple", filled=2 }) —
    // add_room(special=TRUE) draws nothing, but filled=2 (FILL_LVLFLAGS_ONLY)
    // makes lspo_finalize_level's fill_special_room() loop set
    // svl.level.flags.has_temple, and THAT steers dosounds(): sounds.c:330 is
    // `has_temple && !rn2(200)`, one extra draw on EVERY turn spent here.
    vly_region(24, 6, 33, 13, 1, TEMPLE_RTYPE, 2 /* FILL_LVLFLAGS_ONLY */, false);
    // des.replace_terrain x2 (floor -> tree, both edge columns, chance=10).
    quest_replace_terrain(0, 0, 10, 19, ROOM, TREE, 10);
    quest_replace_terrain(65, 0, 75, 19, ROOM, TREE, 10);
    // des.terrain({05,04}, ".") — force the portal arrival cell to floor.
    { const loc = g.level?.at(q_absx(5), q_absy(4)); if (loc) loc.typ = ROOM; }
    // local spacelocs = selection.floodfill(05,04) — no RNG.
    const spacelocs = quest_floodfill_match(5, 4);
    // des.levregion({ region={05,04,05,04}, type="branch" }) — register, no RNG.
    quest_register_branch(5, 4);
    // des.stair("down", 52,09) — no RNG.
    quest_place_stair(52, 9, false);
    // des.door(...) x18 — explicit states, no RNG.
    quest_set_door(18, 9, 'locked'); quest_set_door(18, 10, 'locked');
    quest_set_door(34, 9, 'closed'); quest_set_door(34, 10, 'closed');
    quest_set_door(40, 5, 'closed'); quest_set_door(46, 5, 'closed'); quest_set_door(52, 5, 'closed');
    quest_set_door(38, 7, 'locked'); quest_set_door(42, 7, 'closed');
    quest_set_door(46, 7, 'closed'); quest_set_door(52, 7, 'closed');
    quest_set_door(38, 12, 'locked'); quest_set_door(44, 12, 'closed');
    quest_set_door(48, 12, 'closed'); quest_set_door(52, 12, 'closed');
    quest_set_door(40, 14, 'closed'); quest_set_door(46, 14, 'closed'); quest_set_door(52, 14, 'closed');
    // des.altar({ x=28, y=09, align="noalign", type="altar" }) — unaligned,
    // shrine=0 (create_altar returns before priestini/has_temple).  No RNG.
    quest_create_altar(28, 9, 0 /* AM_NONE */);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // High Priest (Arch Priest) + custom inventory (robe+4, mace+4).
        const archpriest = quest_create_monster('Arch Priest', 28, 10, null);
        quest_drop_default_invent(archpriest);
        quest_create_object(143 /*ROBE*/, null, null, 4, archpriest);
        quest_create_object(73 /*MACE*/, null, null, 4, archpriest);
        // The treasure of the Arch Priest.
        quest_create_object(CHEST, 27, 10, null, null);
        // acolyte guards for the audience chamber.
        const acolytes = [[32, 7], [32, 8], [32, 11], [32, 12],
                          [33, 7], [33, 8], [33, 11], [33, 12]];
        for (const [ax, ay] of acolytes) quest_create_monster('acolyte', ax, ay, null);
        // des.non_diggable — no RNG.
        // Two dart traps at a random spot in the open siege field (already an
        // absolute coord from spacelocs:rndcoord(1), so no further RNG in
        // get_location — see quest_create_trap's header comment).
        for (let i = 0; i < 2; i++) {
            const c = quest_rndcoord(spacelocs);
            if (c) { await maketrap(c.x, c.y, 2 /*DART_TRAP*/); rnd(4); }
        }
        // Four random traps.
        for (let i = 0; i < 4; i++) await quest_create_trap_random();
        // Monsters on siege duty: 12 human zombies in the open field.
        for (let i = 0; i < 12; i++) {
            const c = quest_rndcoord(spacelocs);
            if (!c) continue;
            quest_create_monster_at('human zombie', c.x, c.y, null);
        }
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level -> wallification(1,0,COLNO-1,ROWNO-1) then
    // flip_level_rnd(allow_flips=3, FALSE): one rn2(2) per enabled axis.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) { flip_level(flp); quest_flip_branch(flp); }
}
