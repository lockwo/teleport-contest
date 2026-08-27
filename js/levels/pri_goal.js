// levels/pri_goal.js - special level builder makemaz_pri_goal() (dat/Pri-goal.lua).

import { COLNO, FIRE_TRAP, LAVAPOOL, ROOM, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import { bless, mksobj_at } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, quest_place_stair, shuffle,
    splev_create_monster, splev_region_lit, vly_abs, vly_object,
} from '../sp_lev.js';
import { mkmap_mines, pri_create_trap } from './pri_loca.js';

// ════════════════════════════════════════════════════════════════════════
// Priest quest "goal" level (dat/Pri-goal.lua) — Nalzok's lava cavern, and
// the Mitre of Holiness.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Pri-goal")
// -> load_special("Pri-goal.lua").  nhlib.lua's top-level shuffle(align)
// (rn2(3), rn2(2)) runs first, then the des.* program in file order.
//
// The level_init is a mines-style mkmap with fg=LAVAPOOL over a ROOM
// background — the whole 80x21 grid is cavern floor spattered with lava, and
// only then is the 26x11 des.map stamped over the middle of it.
// ════════════════════════════════════════════════════════════════════════

const PRI_GOAL_MAP = [
    'xxxxxx..xxxxxx...xxxxxxxxx',
    'xxxx......xx......xxxxxxxx',
    'xx.xx.............xxxxxxxx',
    'x....................xxxxx',
    '......................xxxx',
    '......................xxxx',
    'xx........................',
    'xxx......................x',
    'xxx................xxxxxxx',
    'xxxx.....x.xx.......xxxxxx',
    'xxxxx...xxxxxx....xxxxxxxx',
].join('\n');

const HELM_OF_BRILLIANCE = 96;
// artilist.h index of "The Mitre of Holiness" (0 = the STRANGE_OBJECT sentinel,
// 1 = Excalibur, 21..34 the quest artifacts).  Load-bearing for RNG, not just
// for naming: oname(ONAME_LEVEL_DEF) marks the artifact as existing, and every
// later mksobj_init() weapon rolls rn2(20 + 10 * nartifact_exist()) — 30, not
// 20, from the very next des.object() on this level.
const ART_MITRE_OF_HOLINESS = 28;

export async function makemaz_pri_goal() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);

    // des.level_init({ style="solidfill", fg=" " }) — rn2(2), then STONE fill.
    // (Overwritten wholesale by the mines init below; only the draw matters.)
    rn2(2);                                              // sp_lev.c:2992

    // des.level_flags("mazelevel") — note: NO "noflip", so the finalize flip
    // rolls two rn2(2), and no "hardfloor", so Can_fall_thru() stays true and
    // mktrap keeps holes as holes.
    if (g.level?.flags) g.level.flags.is_maze_lev = true;

    // des.level_init({ style="mines", fg="L", bg=".", smoothed=false,
    //                  joined=false, lit=0, walled=false })
    mkmap_mines(ROOM, LAVAPOOL, false, false, 0, false);

    // des.map([[...]]) — 26x11, SPLEV_CENTER.  Bare string => lit = FALSE.
    // 'x' is MAX_TYPE ("leave whatever is there"), so the lava field shows
    // through the map's ragged edges.
    bigrm_load_map(PRI_GOAL_MAP, false);

    // local place = { {14,04}, {13,07} }; placeidx = math.random(1, #place)
    // nhlib.lua's shim turns the 2-arg form into nh.random(1,2) == 1 + rn2(2).
    const place = [[14, 4], [13, 7]];
    const placeidx = rn2(2);                             // Pri-goal.lua:27

    // des.region(selection.area(00,00,25,10), "unlit") — 2-arg form: no room,
    // no RNG, and lava stays lit whatever is asked for.
    splev_region_lit(0, 0, 25, 10, 0);

    // des.stair("up", 20,05) — no down stairs; this is the quest's last level.
    quest_place_stair(20, 5, true);

    g._quest_gen = true;
    g._full_mon_gen = true;
    if (g.level) g.level._splev_fullmon = true;
    try {
        // The Mitre of Holiness.  A `name` is supplied, so create_object passes
        // artif=FALSE to mksobj_at; buc="blessed" -> bless(), spe=0,
        // eroded=-1 -> oerodeproof.  Explicit coord: no get_location draw.
        {
            const c = vly_abs(place[placeidx][0], place[placeidx][1]);
            const otmp = mksobj_at(HELM_OF_BRILLIANCE, c.x, c.y, true, false);
            if (otmp) {
                otmp.spe = 0;
                bless(otmp);
                // C ref: sp_lev.c create_object() -> oname(otmp, name,
                // ONAME_LEVEL_DEF) -> artifact_exists(otmp, name, TRUE).  No RNG.
                otmp.oname = 'The Mitre of Holiness';
                otmp.oartifact = ART_MITRE_OF_HOLINESS;
                if (!g.artiexist) g.artiexist = new Set();
                g.artiexist.add(ART_MITRE_OF_HOLINESS);
                // eroded=-1 comes AFTER the naming in create_object.
                otmp.oerodeproof = 1;
            }
        }
        // 14 x des.object() — fully random class at a random DRY square.
        for (let i = 0; i < 14; i++) vly_object({});

        // 4 x des.trap("fire") then 2 x des.trap() (random type).
        for (let i = 0; i < 4; i++) await pri_create_trap(FIRE_TRAP, null, null);
        for (let i = 0; i < 2; i++) await pri_create_trap(0, null, null);

        // Nalzok stands on the Mitre.  A unique male monster, so find_montype
        // draws no gender roll; the table carries no `align`, so
        // sp_amask_to_amask still draws induced_align's rn2(3).
        splev_create_monster({ name: 'Nalzok',
                               mx: place[placeidx][0], my: place[placeidx][1] });
        for (let i = 0; i < 16; i++) splev_create_monster({ name: 'human zombie' });
        for (let i = 0; i < 2; i++) splev_create_monster({ cls: 52 /* S_ZOMBIE */ });
        for (let i = 0; i < 8; i++) splev_create_monster({ name: 'wraith' });
        splev_create_monster({ cls: 49 /* S_WRAITH */ });
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // lspo_finalize_level: wallification, then flip_level_rnd(3, FALSE) —
    // one rn2(2) per axis (sp_lev.c:975/977).
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                                 // sp_lev.c:975
    if (rn2(2)) flp |= 2;                                 // sp_lev.c:977
    if (flp) flip_level(flp);
}
