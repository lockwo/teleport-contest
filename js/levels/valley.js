// levels/valley.js - special level builder makemaz_valley(), split out of js/sp_lev.js.
// sp_lev.js re-exports makemaz_valley so existing importers are unaffected; the
// shared special-level machinery still lives there and is imported below.

import { AM_NONE, COLNO, CROSSWALL, FILL_NORMAL, HWALL, MORGUE, ROWNO, VWALL } from '../const.js';
import { game } from '../gstate.js';
import { monster_by_pmidx, name_to_pmidx } from '../makemon.js';
import {
    ARMOR_CLASS, CORPSE, GEM_CLASS, POTION_CLASS, RING_CLASS, SCROLL_CLASS, SPBOOK_CLASS,
    TOOL_CLASS, WAND_CLASS, WEAPON_CLASS,
} from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    TEMPLE_RTYPE, VLY_S_LICH, VLY_S_MUMMY, VLY_S_VAMPIRE, VLY_S_ZOMBIE, bigrm_load_map,
    bigrm_wallification, flip_level, percent, quest_flip_branch, quest_level_init_solidfill,
    quest_place_stair, quest_register_branch, quest_set_door, remove_boundary_syms, shuffle,
    vly_altar, vly_flip_dndest, vly_monster_class, vly_non_diggable, vly_object,
    vly_place_monster, vly_region, vly_teleport_region, vly_terrain_at, vly_terrain_line,
    vly_trap,
} from '../sp_lev.js';

// ════════════════════════════════════════════════════════════════════════
// Valley of the Dead loader (dat/valley.lua) — the first Gehennom level.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("valley")
// -> load_special("valley.lua"), executed by the des.* engine in sp_lev.c.
// Loading nhlib.lua first runs `align = {...}; shuffle(align)` at module top
// level (rn2(3), rn2(2)); then the des.* program runs in file order consuming
// the PRNG exactly.  Hand-ported so the stream matches C's recorded trace.
//
// The level is a fixed 76x20 map: Moloch's shrine (a temple region whose
// des.altar spawns the priest), three irregular morgue regions filled at level
// finalize, 22 named player corpses, a pile of random loot, eleven traps and a
// crowd of undead.
// ════════════════════════════════════════════════════════════════════════

const VALLEY_MAP = [
    '----------------------------------------------------------------------------',
    '|...S.|..|.....|  |.....-|      |................|   |...............| |...|',
    '|---|.|.--.---.|  |......--- ----..........-----.-----....---........---.-.|',
    '|   |.|.|..| |.| --........| |.............|   |.......---| |-...........--|',
    '|   |...S..| |.| |.......-----.......------|   |--------..---......------- |',
    '|----------- |.| |-......| |....|...-- |...-----................----       |',
    '|.....S....---.| |.......| |....|...|  |..............-----------          |',
    '|.....|.|......| |.....--- |......---  |....---.......|                    |',
    '|.....|.|------| |....--   --....-- |-------- ----....---------------      |',
    '|.....|--......---BBB-|     |...--  |.......|    |..................|      |',
    '|..........||........-|    --...|   |.......|    |...||.............|      |',
    '|.....|...-||-........------....|   |.......---- |...||.............--     |',
    '|.....|--......---...........--------..........| |.......---------...--    |',
    '|.....| |------| |--.......--|   |..B......----- -----....| |.|  |....---  |',
    '|.....| |......--| ------..| |----..B......|       |.--------.-- |-.....---|',
    '|------ |........|  |.|....| |.....----BBBB---------...........---.........|',
    '|       |........|  |...|..| |.....|  |-.............--------...........---|',
    '|       --.....-----------.| |....-----.....----------     |.........----  |',
    '|        |..|..B...........| |.|..........|.|              |.|........|    |',
    '----------------------------------------------------------------------------',
].join('\n');

// C ref: sp_lev.c create_monster() at a RANDOM location, for a monster given by
// SPECIES NAME.  lspo_monster's single-string form resolves the name through
// find_montype() (one rn2(2) unless the species has a fixed gender) while
// parsing; create_monster then does sp_amask_to_amask -> induced_align rn2(3),
// the pm_to_humidity get_location (retried with DRY added if the first,
// NO_LOC_WARN pass finds nothing), the MON_AT/enexto relocate, and makemon.
function vly_monster_named(name) {
    const pmidx = name_to_pmidx(name);
    const ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    if (!ptr) return null;
    if (ptr.gcode !== 1 && ptr.gcode !== 2) rn2(2);   // find_montype gender
    rn2(3);                                           // induced_align
    return vly_place_monster(ptr);
}

// C ref: mkroom.h TEMPLE room type + include/align.h AM_SHRINE, plus the
// trap-type and monster-class numbers valley.lua names by string.
const VLY_SPIKED_PIT = 12, VLY_SLP_GAS = 8, VLY_SQKY_BOARD = 4,
      VLY_DART = 2, VLY_MAGIC_TRAP = 20, VLY_ANTI_MAGIC = 21;

// C ref: valley.lua's `des.object({id="corpse",montype=...})` roster — "**LOTS**
// of dead bodies (all human)", in file order.
const VALLEY_CORPSE_MONTYPES = [
    'archeologist', 'archeologist', 'barbarian', 'barbarian',
    'caveman', 'cavewoman', 'healer', 'healer', 'knight', 'knight',
    'ranger', 'ranger', 'rogue', 'rogue', 'samurai', 'samurai',
    'tourist', 'tourist', 'valkyrie', 'valkyrie', 'wizard', 'wizard',
];

// C ref: objclass.h def_char_to_objclass() for the class chars valley.lua uses.
const VALLEY_LOOT_CLASSES = [
    ARMOR_CLASS, ARMOR_CLASS, ARMOR_CLASS, ARMOR_CLASS,
    WEAPON_CLASS, WEAPON_CLASS, WEAPON_CLASS, WEAPON_CLASS,
];

const VALLEY_LOOT_TAIL = [
    GEM_CLASS, GEM_CLASS,
    POTION_CLASS, POTION_CLASS, POTION_CLASS,
    SCROLL_CLASS, SCROLL_CLASS, SCROLL_CLASS,
    WAND_CLASS, WAND_CLASS,
    RING_CLASS, RING_CLASS,
    SPBOOK_CLASS, SPBOOK_CLASS,
    TOOL_CLASS, TOOL_CLASS, TOOL_CLASS,
];

// C ref: objects.c GEM order — DILITHIUM_CRYSTAL 439, DIAMOND 440, RUBY 441.
// Was 440 (=DIAMOND): a stale value from the pre-mail-daemon numbering where
// DILITHIUM_CRYSTAL was 438.  valley.lua:117 des.object("ruby").
const RUBY_OTYP = 441;

// Entry point.  C ref: makemaz("valley") -> load_special("valley.lua").
export async function makemaz_valley() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    const lit = quest_level_init_solidfill();
    // des.level_flags("mazelevel","noteleport","hardfloor","nommap","temperate")
    // — no RNG.  "temperate" is temperature 0, which zeroes rndmonst_adj's
    // temperature_shift() for every species on this level.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
        g.level.flags.nommap = true;
        g.level.flags.temperature = 0;
    }
    // des.map([[...]]) — full-level 76x20 map, SPLEV_CENTER offset.  No RNG.
    // valley.lua:12 is `des.map([[...]])` — the bare-string form. C's lspo_map
    // declares `boolean lit = FALSE` and that arm never assigns it (sp_lev.c:6102),
    // so every mapped cell is unlit and NO rn2(2) is drawn. Passing the caller's
    // `lit` renders the whole level lit on any seed where it is true.
    bigrm_load_map(VALLEY_MAP, false);

    // "Make the path somewhat unpredictable" — three independent percent(50)
    // blocks, each one rn2(100).  The terrain edits themselves draw nothing.
    // valley.lua's 'B' is nhlua.c char2typ's "hack: boundary location" =
    // CROSSWALL, not iron bars; remove_boundary_syms() at finalize turns every
    // one of them back into ROOM.
    if (percent(50)) {
        vly_terrain_line(50, 8, 53, 8, HWALL);
        vly_terrain_line(40, 8, 43, 8, CROSSWALL);
    }
    if (percent(50)) {
        vly_terrain_at(27, 12, VWALL);
        vly_terrain_line(27, 3, 29, 3, CROSSWALL);
        vly_terrain_at(28, 2, HWALL);
    }
    if (percent(50)) {
        vly_terrain_line(16, 10, 16, 11, VWALL);
        vly_terrain_line(9, 13, 14, 13, CROSSWALL);
    }

    // The shrine to Moloch: filled=2 is FILL_LVLFLAGS_ONLY, so the temple gets
    // no fill_special_room() body — only the has_temple level flag.  The priest
    // arrives with des.altar below.
    vly_region(1, 6, 5, 14, 1, TEMPLE_RTYPE, 2, false);
    // The Morgues — irregular, unlit, filled at level finalize.
    const morgues = [
        vly_region(19, 1, 24, 8, 0, MORGUE, FILL_NORMAL, true),
        vly_region(9, 14, 16, 18, 0, MORGUE, FILL_NORMAL, true),
        vly_region(37, 9, 43, 14, 0, MORGUE, FILL_NORMAL, true),
    ];
    // Stairs / branch / arrival region — no RNG.
    quest_place_stair(1, 1, false);
    quest_register_branch(66, 17);
    vly_teleport_region(58, 9, 72, 18, false, 'down');
    // Secret Doors — no RNG (explicit state).
    quest_set_door(4, 1, 'locked');
    quest_set_door(8, 4, 'locked');
    quest_set_door(6, 6, 'locked');
    // The altar of Moloch — align="noalign", type="shrine" -> priestini().
    g._full_mon_gen = true;
    try {
        vly_altar(3, 10, AM_NONE, 1);
    } finally {
        g._full_mon_gen = false;
    }
    // Non diggable walls - everywhere!  No RNG.
    vly_non_diggable(0, 0, 75, 19);

    g._full_mon_gen = true;
    try {
        // Objects: the corpses, then random armor/weapons, then random loot.
        for (const mt of VALLEY_CORPSE_MONTYPES)
            vly_object({ otyp: CORPSE, montype: mt });
        for (const oc of VALLEY_LOOT_CLASSES) vly_object({ oclass: oc });
        vly_object({ otyp: RUBY_OTYP });
        for (const oc of VALLEY_LOOT_TAIL) vly_object({ oclass: oc });

        // (Not so) Random traps.
        await vly_trap(VLY_SPIKED_PIT, 5, 2);
        await vly_trap(VLY_SPIKED_PIT, 14, 5);
        await vly_trap(VLY_SLP_GAS, 3, 1);
        await vly_trap(VLY_SQKY_BOARD, 21, 12);
        await vly_trap(VLY_SQKY_BOARD);
        await vly_trap(VLY_DART, 60, 1);
        await vly_trap(VLY_DART, 26, 17);
        await vly_trap(VLY_ANTI_MAGIC);
        await vly_trap(VLY_ANTI_MAGIC);
        await vly_trap(VLY_MAGIC_TRAP);
        await vly_trap(VLY_MAGIC_TRAP);

        // Random monsters: the ghosts, a few bats, a lich, and undead nasties.
        for (let i = 0; i < 6; i++) vly_monster_named('ghost');
        for (let i = 0; i < 3; i++) vly_monster_named('vampire bat');
        vly_monster_class(VLY_S_LICH);
        for (let i = 0; i < 3; i++) vly_monster_class(VLY_S_VAMPIRE);
        for (let i = 0; i < 4; i++) vly_monster_class(VLY_S_ZOMBIE);
        for (let i = 0; i < 4; i++) vly_monster_class(VLY_S_MUMMY);
    } finally {
        g._full_mon_gen = false;
    }

    // C ref: lspo_finalize_level() — link_doors_rooms/remove_boundary_syms/
    // map_cleanup (no RNG), wallification (no RNG), then
    // flip_level_rnd(allow_flips=3): one rn2(2) per axis.  remove_boundary_syms
    // runs BEFORE wallification, so the 'B' cells are already ROOM by the time
    // the wall modes are computed.
    remove_boundary_syms();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) {
        flip_level(flp);
        quest_flip_branch(flp);
        vly_flip_dndest(flp);
    }
    return morgues;
}
