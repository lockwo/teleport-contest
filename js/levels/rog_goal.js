// levels/rog_goal.js — Rogue quest "goal" level (dat/Rog-goal.lua): the
// Master Assassin's guild hideout, ringed by a shark-infested moat.
// sp_lev.js re-exports makemaz_rog_goal.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Rog-goal")
// -> load_special("Rog-goal.lua").  nhlib.lua's top-level shuffle(align)
// (rn2(3),rn2(2)) runs first; level_init solidfill draws one rn2(2); the
// des.* program then runs in file order.
//
// `des.levregion({ region={01,00,15,20}, region_islev=1,
// exclude={01,18,04,20}, type="stair-up" })` only REGISTERS the region —
// an explicit, absolute (region_islev=1) rectangle draws no RNG at that
// point.  Its actual placement happens at mkmaze.c fixup_special(), which
// load_special() runs AFTER wallification and flip_level_rnd (sp_lev.c:
// 6479-6491) — i.e. at the very end, after every object/trap/monster draw in
// this file.  None of the other already-landed quest "goal"/"loca" builders
// register a *stair* levregion (only the "-strt" homes register a branch, via
// quest_place_branch()/game._quest_lregion), so that placement logic isn't
// shared anywhere else in this port; it is transcribed below from mkmaze.c
// place_lregion()/put_lregion_here()/mkstairs() (also mirrored, unexported,
// as js/mklev.js's castle_place_stair_lregion() and
// js/levels/wiz_common.js's wiz_mkstairs() — neither is importable/reusable
// here: the former is a private function in a protected file, the latter is
// private in a file scoped to the Wizard tower levels).
//
// `exclude_islev` is NOT set on the levregion table, so (unlike `region`) the
// exclude rectangle IS map-relative and needs the des.map() origin added.

import {
    AIR, COLNO, CORR, LA_UP, ROOM, ROWNO, SPIKED_PIT, STAIRS,
} from '../const.js';
import { game } from '../gstate.js';
import { TIN } from '../mkobj.js';
import { occupied } from '../mkroom.js';
import { rn1, rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, map_cleanup,
    quest_create_monster, quest_level_init_solidfill, quest_region_light,
    remove_boundary_syms, shuffle, splev_link_doors_rooms, splev_object_at,
    vly_abs, vly_non_diggable,
} from '../sp_lev.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_named_object_at,
    quest_object_rnd, quest_trap_random, quest_trap_typed_at,
} from './quest_common.js';

// C ref: monsym.h def_char_to_monclass() — 'l' = leprechaun, 'N' = naga.
const ROG_S_LEPRECHAUN = 12, ROG_S_NAGA = 40;

// objects.h SKELETON_KEY has no named JS export; OBJDATA row 221 ("skeleton
// key") confirms the index.
const SKELETON_KEY = 221;

const ROG_GOAL_MAP = [
    "-----      -------.......................................|-----------------|",
    "|...|  -----.....|.......................................|.................|",
    "|...----...|.....|.......................................|....---------....|",
    "|.---......---..--.................................------------.......|....|",
    "|...............|..................................|..|...|...----........-|",
    "|.....-----....--.................................|-..--..-|.....----S----| ",
    "|--S---...|....|.................................|-........-|....|........| ",
    "|.........---------.............................|-....}}....-|...|...|....| ",
    "|....|.....S......|............................|-.....}}.....-|..--.------| ",
    "|-----.....--.....|...........................|-...}}}}}}}}...-|....|.....--",
    "|...........--....------S-----...............|-....}}}}}}}}....-|..........|",
    "|............--........|...| |..............--.....}}.}}........----------S-",
    "|.............|........|...| |..............|......}}}}}}}}......|...|.....|",
    "|S-.---.---.---.---.---|...| ------------...--........}}.}}.....--..---....|",
    "|.---.---.---.---.-S-..----- |....|.....|....|-....}}}}}}}}....---..S.|--..|",
    "|...|.......|..........|...---....---...S.....|-...}}}}}}}}...-|.S..|...|..|",
    "|...|..|....|..........|............|..--..----|-.....}}.....-|..----...-S--",
    "|...|---....----.......|----- ......|...---|    |-....}}....-|...|..--.--..|",
    "-----.....---.....--.---....--...--------..|     |-........-|....|.........|",
    "    |.............|..........|.............S...   |S-------|.....|..-----..|",
    "    ----------------------------------------  ......       ----------   ----",
].join('\n');

// C ref: mkmaze.c bad_location() — occupied, inside the excluded rectangle, or
// not a ROOM/(CORR on a maze)/AIR square.
function rog_goal_bad_location(x, y, nlx, nly, nhx, nhy) {
    const loc = game.level?.at(x, y);
    if (!loc) return true;
    if (occupied(x, y)) return true;
    if (nlx && x >= nlx && x <= nhx && y >= nly && y <= nhy) return true;
    const is_maze = !!game.level?.flags?.is_maze_lev;
    return !((loc.typ === CORR && is_maze) || loc.typ === ROOM || loc.typ === AIR);
}

// C ref: mklev.c mkstairs(x, y, up=1, croom=NULL) — this level only ever
// registers an UP levregion, so the down-stair arm is not needed here.
function rog_goal_mkstairs(x, y) {
    const g = game;
    if ((g.u?.uz?.dlevel ?? 1) === 1) return;    // no stair above dlevel 1
    const loc = g.level?.at(x, y);
    if (loc) { loc.typ = STAIRS; loc.ladder = LA_UP; }
    g.stairs = { sx: x, sy: y, up: true, isladder: false,
                 tolev: { dnum: g.u?.uz?.dnum ?? 0, dlevel: (g.u?.uz?.dlevel ?? 1) - 1 },
                 next: g.stairs };
    if (g.level) g.level.upstair = { x, y };
}

// C ref: mkmaze.c place_lregion() + put_lregion_here() for the ONE registered
// LR_UPSTAIR — the probabilistic loop draws rn1((hx-lx)+1,lx)/rn1((hy-ly)+1,ly)
// per attempt, falling back to a deterministic x/y scan after 200 tries.
function rog_goal_place_upstair(lx, ly, hx, hy, nlx, nly, nhx, nhy) {
    lx = Math.max(lx, 1); hx = Math.min(hx, COLNO - 1);
    ly = Math.max(ly, 0); hy = Math.min(hy, ROWNO - 1);
    for (let trycnt = 0; trycnt < 200; trycnt++) {
        const x = rn1((hx - lx) + 1, lx);
        const y = rn1((hy - ly) + 1, ly);
        if (!rog_goal_bad_location(x, y, nlx, nly, nhx, nhy)) {
            rog_goal_mkstairs(x, y);
            return;
        }
    }
    for (let x = lx; x <= hx; x++)
        for (let y = ly; y <= hy; y++)
            if (!rog_goal_bad_location(x, y, nlx, nly, nhx, nhy)) {
                rog_goal_mkstairs(x, y);
                return;
            }
}

export async function makemaz_rog_goal() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    quest_level_init_solidfill();
    // des.level_flags("mazelevel", "noteleport") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
    }
    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).
    bigrm_load_map(ROG_GOAL_MAP, false);

    // des.region(selection.area(00,00,75,20), "lit") — no RNG, no room.
    quest_region_light(0, 0, 75, 20, true);
    // des.levregion({ region={01,00,15,20}, region_islev=1,
    //                 exclude={01,18,04,20}, type="stair-up" }) — REGISTER
    // only; placement happens at fixup_special() time, below.  The exclude
    // rectangle is map-relative (exclude_islev defaults false).
    const upEx1 = vly_abs(1, 18), upEx2 = vly_abs(4, 20);
    // -- Doors: none (Rog-goal.lua has no des.door() calls; every 'S'/'+' on
    // the map is either a plain secret door or nonexistent here).
    // des.non_diggable(selection.area(00,00,75,20)) — no RNG.
    vly_non_diggable(0, 0, 75, 20);
    // des.trap("spiked pit",37,07) — fixed type + fixed coord, before Objects.
    await quest_trap_typed_at(SPIKED_PIT, 37, 7);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.object({ id="skeleton key", x=38,y=10, buc="blessed", spe=0,
        //              name="The Master Key of Thievery" }) — the quest
        // artifact.
        quest_named_object_at(SKELETON_KEY, 38, 10,
                              { spe: 0, buc: 'blessed', name: 'The Master Key of Thievery' });
        // des.object({ id="tin", x=26,y=12, montype="chameleon" }) — a plain
        // typed object at a fixed coord, no buc/spe/name.
        splev_object_at({ otyp: TIN, montype: 'chameleon' }, 26, 12);
        // des.object() x14 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 14; i++) quest_object_rnd();
        // des.trap() x11 — random type at a random DRY spot.
        for (let i = 0; i < 11; i++) await quest_trap_random();
        // des.monster({ id="Master Assassin", x=38,y=10, peaceful=0 }).
        quest_create_monster('Master Assassin', 38, 10, false);
        // des.monster({ id="leprechaun", peaceful=0 }) x16 — random locations.
        for (let i = 0; i < 16; i++) quest_monster_named_rnd('leprechaun', false);
        // des.monster({ class="l", peaceful=0 }) x2.
        for (let i = 0; i < 2; i++) quest_monster_class_rnd(ROG_S_LEPRECHAUN, false);
        // des.monster({ id="guardian naga", peaceful=0 }) x8.
        for (let i = 0; i < 8; i++) quest_monster_named_rnd('guardian naga', false);
        // des.monster({ class="N", peaceful=0 }) x3.
        for (let i = 0; i < 3; i++) quest_monster_class_rnd(ROG_S_NAGA, false);
        // des.monster({ id="chameleon", peaceful=0 }) x5.
        for (let i = 0; i < 5; i++) quest_monster_named_rnd('chameleon', false);
        // des.monster({ id="shark", x=.., y=.., peaceful=0 }) x4 — explicit
        // coords in the moat.
        quest_create_monster('shark', 51, 14, false);
        quest_create_monster('shark', 53, 9, false);
        quest_create_monster('shark', 55, 15, false);
        quest_create_monster('shark', 58, 10, false);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: load_special()'s tail (sp_lev.c:6464-6491) — link_doors_rooms(),
    // remove_boundary_syms(), map_cleanup(), wallification(1,0,COLNO-1,
    // ROWNO-1), then flip_level_rnd(allow_flips=3, FALSE): one rn2(2) per
    // axis, and ONLY THEN fixup_special() places the registered up-stair.
    splev_link_doors_rooms();
    remove_boundary_syms();
    map_cleanup();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
    // fixup_special(): place the registered LR_UPSTAIR (region_islev=1, so
    // the main rectangle is used as-is; the exclude corners were already
    // converted to absolute above).
    rog_goal_place_upstair(1, 0, 15, 20, upEx1.x, upEx1.y, upEx2.x, upEx2.y);
}
