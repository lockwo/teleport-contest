// levels/bar_strt.js - special level builder makemaz_bar_strt(), split out of js/sp_lev.js.
// sp_lev.js re-exports makemaz_bar_strt so existing importers are unaffected; the
// shared special-level machinery still lives there and is imported below.

import { COLNO, INVALID_TYPE, MAX_TYPE, ROOM, ROWNO, TREE } from '../const.js';
import { game } from '../gstate.js';
import { CHEST } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, q_absx, q_absy, quest_create_monster,
    quest_create_monster_at, quest_create_object, quest_create_trap, quest_flip_branch,
    quest_floodfill_match, quest_level_init_solidfill, quest_place_stair, quest_region_light,
    quest_register_branch, quest_replace_terrain, quest_rndcoord, quest_set_door, shuffle,
} from '../sp_lev.js';

// ════════════════════════════════════════════════════════════════════════
// Barbarian quest "home" level loader (dat/Bar-strt.lua).
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Bar-strt")
// -> load_special("Bar-strt.lua") executes the splev engine.  Loading
// nhlib.lua first runs `shuffle(align)` at module top level (rn2(3), rn2(2)),
// exactly as the Big Room path does.  We hand-port Bar-strt.lua to JS calling
// the same RNG-consuming primitives in the same order so the PRNG stream
// matches C exactly (verified against the recorded rng trace).
//
// Only the Barbarian start level is ported here (the other roles' quest homes
// and the locate/goal/filler levels fall through to the regular generator).
// ════════════════════════════════════════════════════════════════════════

const BAR_STRT_MAP = [
    '..................................PP........................................',
    '...................................PP.......................................',
    '...................................PP.......................................',
    '....................................PP......................................',
    '........--------------......-----....PPP....................................',
    '........|...S........|......+...|...PPP.....................................',
    '........|----........|......|...|....PP.....................................',
    '........|.\\..........+......-----...........................................',
    '........|----........|...............PP.....................................',
    '........|...S........|...-----.......PPP....................................',
    '........--------------...+...|......PPPPP...................................',
    '.........................|...|.......PPP....................................',
    '...-----......-----......-----........PP....................................',
    '...|...+......|...+..--+--.............PP...................................',
    '...|...|......|...|..|...|..............PP..................................',
    '...-----......-----..|...|.............PPPP.................................',
    '.....................-----............PP..PP................................',
    '.....................................PP...PP................................',
    '....................................PP...PP.................................',
    '....................................PP....PP................................',
].join('\n');

// C ref: selvar.c selection_do_randline (rec=12 from nhlsel.c l_selection_randline).
// Recursive midpoint displacement: each level with rough>=2 draws rn2(rough)
// twice; rough shrinks by *2/3 each recursion until <2.  We build a set of the
// carved points; the RNG draw count is independent of the exact midpoints (they
// never leave the map for these coords), so this matches the recorded stream.
function quest_do_randline(x1, y1, x2, y2, rough, rec, pts) {
    if (rec < 1 || (x2 === x1 && y2 === y1)) return;
    let r = rough;
    const span = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    if (r > span) r = span;
    let mx, my;
    if (r < 2) {
        mx = Math.trunc((x1 + x2) / 2);
        my = Math.trunc((y1 + y2) / 2);
    } else {
        do {
            const dx = rn2(r) - Math.trunc(r / 2);
            const dy = rn2(r) - Math.trunc(r / 2);
            mx = Math.trunc((x1 + x2) / 2) + dx;
            my = Math.trunc((y1 + y2) / 2) + dy;
        } while (mx > COLNO - 1 || mx < 0 || my < 0 || my > ROWNO - 1);
    }
    pts.add(mx + ',' + my);
    r = Math.trunc((r * 2) / 3);
    rec--;
    quest_do_randline(x1, y1, mx, my, r, rec, pts);
    quest_do_randline(mx, my, x2, y2, r, rec, pts);
    pts.add(x2 + ',' + y2);
}

// C ref: des.terrain(selection.randline(new(), x1,y1, x2,y2, rough), ".") —
// carve a rough line of ROOM cells.  Corners are offset via get_location_coord.
function quest_terrain_randline(x1, y1, x2, y2, rough, totyp) {
    const ax1 = q_absx(x1), ay1 = q_absy(y1);
    const ax2 = q_absx(x2), ay2 = q_absy(y2);
    const pts = new Set();
    quest_do_randline(ax1, ay1, ax2, ay2, rough, 12, pts);
    for (const k of pts) {
        const [x, y] = k.split(',').map(Number);
        const loc = game.level?.at(x, y);
        if (loc && totyp !== INVALID_TYPE && totyp < MAX_TYPE) loc.typ = totyp;
    }
}

// Main executor.  C ref: makemaz("Bar-strt") -> load_special.
export async function makemaz_bar_strt() {
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
    // sp_lev.c:6122: lit is des.map's OWN option (default FALSE); the bare
    // string form never sets it, so it is NOT the level_init rn2(2).
    bigrm_load_map(BAR_STRT_MAP, false);
    // replace_terrain x3 (floor -> tree with per-region chance).
    quest_replace_terrain(37, 0, 59, 19, ROOM, TREE, 5);
    quest_replace_terrain(60, 0, 64, 19, ROOM, TREE, 10);
    quest_replace_terrain(65, 0, 75, 19, ROOM, TREE, 20);
    // guarantee a path + free spot for the portal.
    quest_terrain_randline(37, 7, 62, 2, 7, ROOM);
    { const loc = g.level?.at(q_absx(62), q_absy(2)); if (loc) loc.typ = ROOM; }
    // region lighting (whole level lit, a few unlit sub-rooms) — no RNG.
    quest_region_light(0, 0, 75, 19, true);
    quest_region_light(9, 5, 11, 5, false);
    quest_region_light(9, 7, 11, 7, true);
    quest_region_light(9, 9, 11, 9, false);
    quest_region_light(13, 5, 20, 9, true);
    quest_region_light(29, 5, 31, 6, true);
    quest_region_light(26, 10, 28, 11, true);
    quest_region_light(4, 13, 6, 14, true);
    quest_region_light(15, 13, 17, 14, true);
    quest_region_light(22, 14, 24, 15, true);
    // des.stair("down", 9, 9) — no RNG.
    quest_place_stair(9, 9, false);
    // des.levregion({ region={62,2,62,2}, type="branch" }) — register, no RNG.
    quest_register_branch(62, 2);
    // des.door(...) x8 — explicit states, no RNG.
    quest_set_door(12, 5, 'locked'); quest_set_door(12, 9, 'locked');
    quest_set_door(21, 7, 'closed');
    quest_set_door(7, 13, 'open'); quest_set_door(18, 13, 'open');
    quest_set_door(23, 13, 'open'); quest_set_door(25, 10, 'open');
    quest_set_door(28, 5, 'open');

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // Elder Pelias + custom inventory (runesword+5, chain mail+5).
        const pelias = quest_create_monster('Pelias', 10, 7, null);
        quest_create_object(58 /*RUNESWORD*/, null, null, 5, pelias);
        quest_create_object(128 /*CHAIN_MAIL*/, null, null, 5, pelias);
        // The treasure of Pelias.
        quest_create_object(CHEST, 9, 5, null, null);
        // chieftain guards for the audience chamber.
        const chieftains = [[10, 5], [10, 9], [11, 5], [11, 9],
                            [14, 5], [14, 9], [16, 5], [16, 9]];
        for (const [cx, cy] of chieftains) quest_create_monster('chieftain', cx, cy, null);
        // des.non_diggable — no RNG.
        // One trap to keep the ogres at bay.
        await quest_create_trap(12 /*SPIKED_PIT*/, 37, 7);
        // Eels in the river.
        quest_create_monster('giant eel', 36, 1, null);
        quest_create_monster('giant eel', 37, 9, null);
        quest_create_monster('giant eel', 39, 15, null);
        // Monsters on siege duty: floodfill(37,7) & area(40,3, 45,20), 12 ogres.
        const flood = quest_floodfill_match(37, 7);
        const ax1 = q_absx(40), ay1 = q_absy(3), ax2 = q_absx(45), ay2 = q_absy(20);
        const ogrelocs = new Set();
        for (const k of flood) {
            const [x, y] = k.split(',').map(Number);
            if (x >= ax1 && x <= ax2 && y >= ay1 && y <= ay2) ogrelocs.add(k);
        }
        for (let i = 0; i < 12; i++) {
            const c = quest_rndcoord(ogrelocs);
            if (!c) { rn2(1); continue; }
            quest_create_monster_at('ogre', c.x, c.y, false);
        }
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level -> wallification(1,0,COLNO-1,ROWNO-1) (!corrmaze)
    // then flip_level_rnd(allow_flips=3, FALSE): one rn2(2) per enabled axis.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) { flip_level(flp); quest_flip_branch(flp); }
}
