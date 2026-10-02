// levels/mon_goal.js — Monk quest "goal" level (dat/Mon-goal.lua): Master
// Kaen's earth-elemental lair, carved out of a lava cavern.  sp_lev.js
// re-exports makemaz_mon_goal.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Mon-goal")
// -> load_special("Mon-goal.lua").  nhlib.lua's top-level shuffle(align)
// (rn2(3),rn2(2)) runs first.  UNLIKE Arc-goal/Bar-goal/Pri-goal, the leading
// `des.level_init({style="solidfill", fg=" "})` line is COMMENTED OUT in
// Mon-goal.lua (a literal `-- des.level_init(...)`), so this level draws NO
// rn2(2) for a solidfill lit bit before the "mines" init runs.  The map,
// mines init and object/trap/monster counts are otherwise byte-identical to
// Pri-goal's (same 26x11 lava cavern; see js/levels/pri_loca.js for the
// shared mkmap_mines() engine).

import {
    COLNO, FIRE_TRAP, LA_UP, LAVAPOOL, ROOM, ROWNO, STAIRS,
} from '../const.js';
import { dunlevs_in_dungeon } from '../dungeon.js';
import { game } from '../gstate.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, map_cleanup,
    quest_create_monster, quest_region_light, remove_boundary_syms, shuffle,
    splev_link_doors_rooms, vly_abs, vly_altar,
} from '../sp_lev.js';
import {
    quest_monster_named_rnd, quest_named_object_at, quest_object_rnd,
    quest_trap_random, quest_trap_typed_random,
} from './quest_common.js';
import { mkmap_mines } from './pri_loca.js';

const MON_GOAL_MAP = [
    "xxxxxx..xxxxxx...xxxxxxxxx",
    "xxxx......xx......xxxxxxxx",
    "xx.xx.............xxxxxxxx",
    "x....................xxxxx",
    "......................xxxx",
    "......................xxxx",
    "xx........................",
    "xxx......................x",
    "xxx................xxxxxxx",
    "xxxx.....x.xx.......xxxxxx",
    "xxxxx...xxxxxx....xxxxxxxx",
].join('\n');

// objects.h LENSES has no named JS export; OBJDATA row 232 ("lenses")
// confirms the index.
const LENSES = 232;

// C ref: mklev.c mkstairs(x, y, up, croom, force) for an EXPLICIT coord
// (force=TRUE: the terrain is forced to ROOM first).  sp_lev.js's own
// quest_place_stair() pushes onto a plain ARRAY, but every real consumer
// (stairway_find_dir() and friends, all over js/) walks the singly-linked
// `.next` chain js/mklev.js's stairway_add() actually builds; an array is
// invisible to them.  Reproduced locally rather than through that helper
// (also mirrored, unexported, as js/levels/wiz_common.js's wiz_mkstairs()).
function mon_goal_mkstairs(mx, my, up) {
    const g = game;
    if ((g.u?.uz?.dlevel ?? 1) === (up ? 1 : dunlevs_in_dungeon(g.u?.uz))) return;
    const { x, y } = vly_abs(mx, my);
    const loc = g.level?.at(x, y);
    if (loc) { loc.typ = STAIRS; loc.ladder = LA_UP; }
    g.stairs = { sx: x, sy: y, up: true, isladder: false,
                 tolev: { dnum: g.u?.uz?.dnum ?? 0, dlevel: (g.u?.uz?.dlevel ?? 1) - 1 },
                 next: g.stairs };
    if (g.level) g.level.upstair = { x, y };
}

export async function makemaz_mon_goal() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_flags("mazelevel") — no RNG.  No "noflip", so the finalize
    // flip below still draws its two rn2(2).
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    // des.level_init({ style="mines", fg="L", bg=".", smoothed=false,
    //                  joined=false, lit=0, walled=false }) — NO preceding
    // solidfill rn2(2) on this level (see file header).
    mkmap_mines(ROOM, LAVAPOOL, false, false, 0, false);
    // des.map([[...]]) — 26x11, SPLEV_CENTER.  Bare string => lit = FALSE.
    // 'x' is MAX_TYPE ("leave whatever is there"), so the lava field shows
    // through the map's ragged edges.
    bigrm_load_map(MON_GOAL_MAP, false);

    // local place = { {14,04}, {13,07} }; placeidx = math.random(1,#place)
    // -> nhlib's shim is 1 + rn2(2); only the INDEX (0/1) matters here.
    const place = [[14, 4], [13, 7]];
    const placeidx = rn2(2);                              // Mon-goal.lua:27

    // des.region(selection.area(00,00,25,10), "unlit") — 2-arg form: no room,
    // no RNG, and lava stays lit whatever is asked for.
    quest_region_light(0, 0, 25, 10, false);
    // des.stair("up", 20,05) — no down stairs; this is the quest's last level.
    mon_goal_mkstairs(20, 5, true);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.object({ id="lenses", coord=place[placeidx], buc="blessed",
        //              spe=0, name="The Eyes of the Overworld" }) — the quest
        // artifact.  No `eroded` field (unlike Pri-goal's Mitre), so the plain
        // named-object helper covers it exactly.
        quest_named_object_at(LENSES, place[placeidx][0], place[placeidx][1],
                              { spe: 0, buc: 'blessed', name: 'The Eyes of the Overworld' });
        // des.object() x14 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 14; i++) quest_object_rnd();
        // des.trap("fire") x4, then des.trap() x2 (random type).
        for (let i = 0; i < 4; i++) await quest_trap_typed_random(FIRE_TRAP);
        for (let i = 0; i < 2; i++) await quest_trap_random();
        // des.monster("Master Kaen", place[placeidx]) — BEFORE the altar, per
        // file order.  The 2-arg string+coord form carries no `peaceful` key,
        // so makemon's own answer stands (hostile: the nemesis is never
        // peaceful).
        quest_create_monster('Master Kaen', place[placeidx][0], place[placeidx][1], null);
        // des.altar({ coord=place[placeidx], align="noalign", type="altar" })
        // — shrine==0 (type="altar"), so no priestini/no RNG.  align="noalign"
        // is AM_NONE (0), a literal, not a random draw.
        vly_altar(place[placeidx][0], place[placeidx][1], 0 /* AM_NONE */, 0);
        // des.monster("earth elemental") x9 / "xorn" x9 — random locations, no
        // `peaceful` field (makemon's own answer stands).
        for (let i = 0; i < 9; i++) quest_monster_named_rnd('earth elemental', null);
        for (let i = 0; i < 9; i++) quest_monster_named_rnd('xorn', null);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: load_special()'s tail (sp_lev.c:6464-6491, shared with
    // lspo_finalize_level) — link_doors_rooms(), remove_boundary_syms(),
    // map_cleanup(), wallification(1,0,COLNO-1,ROWNO-1), then
    // flip_level_rnd(allow_flips=3, FALSE): one rn2(2) per axis.
    splev_link_doors_rooms();
    remove_boundary_syms();
    map_cleanup();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
