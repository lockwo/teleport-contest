// levels/kni_loca.js — Knight quest "locate" level (dat/Kni-loca.lua): the
// Isle of Glass, a Tor rising out of the swamps around it, guarded by a
// neutral shrine and magic traps on every approach but the east.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Kni-loca")
// -> load_special("Kni-loca.lua").  Loading nhlib.lua first runs the
// top-level shuffle(align) (rn2(3), rn2(2)).  Like Val-loca (and unlike
// Arc-loca/Bar-loca/Pri-loca's bare STONE solidfill), the SECOND level_init
// runs the real mkmap.c cellular-automaton cave generator (fg="." floor,
// bg="P" swamp pool, joined=true) before des.map draws the 40x12 Tor on top;
// des.map's "x" cells are MAX_TYPE and leave the generated swamp showing
// outside the Tor's footprint.  No levregion is registered, so
// fixup_special() places nothing and finalize is wallification + a bare
// flip_level_rnd (no quest_flip_branch).

import { game } from '../gstate.js';
import { AM_NEUTRAL, ANTI_MAGIC, COLNO, MAGIC_TRAP, POOL, ROOM, ROWNO } from '../const.js';
import { mkmap } from '../mkmap.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, lspo_region,
    quest_level_init_solidfill, quest_place_stair, quest_region_light, shuffle,
    vly_altar,
} from '../sp_lev.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_object_rnd,
    quest_trap_typed_at, quest_trap_typed_random,
} from './quest_common.js';

const S_IMP = 9;
const S_JELLY = 10;

// dat/Kni-loca.lua's 40x12 des.map.  "x" is MAX_TYPE (no-op — the swamp cave
// mkmap() already drew shows through), "." is untouched (already floor from
// the map's own init_fill/pass_one/two/three, which never touches these
// squares' typ since they read back as ROOM already).
const KNI_LOCA_MAP = [
    'xxxxxxxxx......xxxx...........xxxxxxxxxx',
    'xxxxxxx.........xxx.............xxxxxxxx',
    'xxxx..............................xxxxxx',
    'xx.................................xxxxx',
    '....................................xxxx',
    '.......................................x',
    '........................................',
    'xx...................................xxx',
    'xxxx..............................xxxxxx',
    'xxxxxx..........................xxxxxxxx',
    'xxxxxxxx.........xx..........xxxxxxxxxxx',
    'xxxxxxxxx.......xxxxxx.....xxxxxxxxxxxxx',
].join('\n');

export async function makemaz_kni_loca() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);

    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    quest_level_init_solidfill();

    // des.level_flags("mazelevel", "hardfloor") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.hardfloor = true;
    }

    // des.level_init({ style="mines", fg=".", bg="P", smoothed=false,
    //                  joined=true, lit=1, walled=false }) — the full mkmap.c
    // cellular-automaton cave generator, joined into one region.
    await mkmap({
        bg: POOL, fg: ROOM, smoothed: false, joined: true, lit: 1, walled: false,
    });

    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).  "x"
    // cells are MAX_TYPE and skip, leaving the mkmap() swamp outside the
    // Tor's footprint intact.
    bigrm_load_map(KNI_LOCA_MAP, false);

    // des.region(selection.area(00,00,39,11), "lit") — no RNG.
    quest_region_light(0, 0, 39, 11, true);

    // des.region({ region={09,02, 27,09}, lit=1, type="temple", filled=2 }).
    // filled=2 (FILL_LVLFLAGS_ONLY): fill_special_room() runs generically
    // post-mklev and only sets level.flags.has_temple (TEMPLE falls to the
    // default: no-RNG case, same as kni_strt.js's throne room).
    lspo_region({ region: [9, 2, 27, 9], lit: 1, type: 'temple', filled: 2 });

    // des.stair("up", 38,0) / des.stair("down", 18,05) — no RNG.
    quest_place_stair(38, 0, true);
    quest_place_stair(18, 5, false);

    // des.altar({ x=17, y=05, align="neutral", type="shrine" }) — the square
    // is inside the temple region, so create_altar() reaches priestini()
    // (shrine=1: a plain shrine, not a sanctum).
    vly_altar(17, 5, AM_NEUTRAL, 1);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.object() x15 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 15; i++) quest_object_rnd();

        // Random traps: every avenue but the East is magic-trapped.
        // South (two runs, 8..16 and 20..28 at y=11).
        for (let x = 8; x <= 16; x++) await quest_trap_typed_at(MAGIC_TRAP, x, 11);
        for (let x = 20; x <= 28; x++) await quest_trap_typed_at(MAGIC_TRAP, x, 11);
        // West (x=0, y=3..6).
        for (let y = 3; y <= 6; y++) await quest_trap_typed_at(MAGIC_TRAP, 0, y);
        // North (two runs, 6..14 and 19..32 at y=0).
        for (let x = 6; x <= 14; x++) await quest_trap_typed_at(MAGIC_TRAP, x, 0);
        for (let x = 19; x <= 32; x++) await quest_trap_typed_at(MAGIC_TRAP, x, 0);
        // Magic "sinkholes" scattered around, fully random spot.
        for (let i = 0; i < 7; i++) await quest_trap_typed_random(ANTI_MAGIC);

        // Random monsters.
        for (let i = 0; i < 17; i++) quest_monster_named_rnd('quasit', false);
        quest_monster_class_rnd(S_IMP, false);
        quest_monster_class_rnd(S_JELLY, false);
        for (let i = 0; i < 7; i++) quest_monster_named_rnd('ochre jelly', false);
        quest_monster_class_rnd(S_JELLY, false);
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // lspo_finalize_level: wallification then independent vertical/horizontal
    // flip rolls.  No branch levregion is registered on this level, so
    // (unlike Kni-strt) there is nothing to flip alongside the map.
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;
    if (rn2(2)) flp |= 2;
    if (flp) flip_level(flp);
}
