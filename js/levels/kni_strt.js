// levels/kni_strt.js - special level builder makemaz_kni_strt() (dat/Kni-strt.lua).
// sp_lev.js re-exports it; the shared special-level machinery is imported below.

import { artifact_exists } from '../artifact.js';
import { ONAME_LEVEL_DEF, ROOM } from '../const.js';
import { game } from '../gstate.js';
import {
    MGEND_NEUTRAL, makemon, mongets_pub, monster_by_pmidx, name_gender_hint,
    name_to_pmidx, set_malign,
} from '../makemon.js';
import { CHEST, mksobj } from '../mkobj.js';
import { mk_mplayer } from '../mplayer.js';
import {
    bigrm_get_location_dry, bigrm_load_map, lspo_region, percent,
    quest_create_object, quest_drop_default_invent, quest_place_stair,
    quest_region_light, quest_register_branch, quest_set_door,
    reset_xystart_size, vly_abs,
} from '../sp_lev.js';
import { rn2 } from '../rng.js';
import {
    SLP_GAS_TRAP, quest_align_shuffle, quest_finalize, quest_level_init_fill,
    quest_level_init_mines_flat, quest_monster, quest_trap,
} from './quest_home_common.js';

// C ref: sp_lev.c create_object() passes `artif = !named` to mksobj_at, so a
// des.object() with an explicit `name` (Excalibur) gets artif=FALSE and
// mksobj_init's WEAPON_CLASS re-roll (mkobj.c:2007 `if (artif && !rn2(20 +
// 10*nartifact_exist())) mk_artifact(otmp);`) never fires — the weapon is
// about to be renamed into an artifact by hand, not randomly promoted into
// one first.  quest_create_object() hardcodes artif=true, which is right for
// every OTHER object this level creates (none of them are named), so
// Excalibur alone needs this direct call instead of going through it.
function quest_create_named_weapon(otyp, spe, carryingMon) {
    bigrm_get_location_dry();               // get_location_coord(DRY) draw
    const otmp = mksobj(otyp, true, false);
    if (spe != null) otmp.spe = spe;
    if (!carryingMon.minvent) carryingMon.minvent = [];
    carryingMon.minvent.unshift(otmp);
    return otmp;
}

// C ref: sp_lev.c create_monster() (sp_lev.c:1983-1988): a des.monster()
// whose resolved species index falls in the PM_ARCHEOLOGIST..PM_WIZARD row
// range of mons[] (the thirteen role-lookalike "class NPC" species — plain
// "knight" IS that row, not a subclass of it) is built via mk_mplayer(),
// never plain makemon().  quest_monster()/splev_create_monster()
// (quest_home_common.js, shared by every quest-home builder) has no such
// dispatch and always calls makemon(), so a knight guard's whole inventory
// -- a completely different shape and length of RNG draws in mplayer.c --
// desyncs the instant it is rolled.  This level's other monsters (King
// Arthur is the unique PM, pages/quasits/warhorses are ordinary species)
// never land in that row range, so only the four knight guards need this.
const PM_ARCHEOLOGIST_IDX = name_to_pmidx('archeologist');
const PM_WIZARD_IDX = name_to_pmidx('wizard');
function quest_knight_guard(mx, my, peaceful) {
    const pmidx = name_to_pmidx('knight');
    const ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    if (!ptr) return null;
    if (ptr.gcode !== 1 && ptr.gcode !== 2
        && name_gender_hint('knight') === MGEND_NEUTRAL)
        rn2(2);                                        // find_montype sp_lev.c:3156
    rn2(3);                                             // induced_align dungeon.c:2012
    const { x, y } = vly_abs(mx, my);
    // No mm_mon_at/enexto check: the four guard squares are fixed and empty
    // at this point in generation (nothing else is placed there first).
    const mtmp = (pmidx >= PM_ARCHEOLOGIST_IDX && pmidx <= PM_WIZARD_IDX)
        ? mk_mplayer(ptr, x, y, false, { mongets: mongets_pub })
        : makemon(ptr, x, y, 0);
    if (mtmp && peaceful != null) {
        mtmp.mpeaceful = peaceful ? 1 : 0;
        set_malign(mtmp);           // sp_lev.c:2129 — mpeaceful changed again
    }
    return mtmp;
}

// ════════════════════════════════════════════════════════════════════════
// Knight quest "home" level loader (dat/Kni-strt.lua) — King Arthur's keep,
// besieged by quasits.
//
// C ref: mklev.c makelevel() -> makemaz("Kni-strt") -> load_special.
// The .lua runs level_init TWICE: a solidfill with fg="." and then, as its own
// comment says, "a kludge to init the level as a lit field" — style="mines"
// with fg == bg == "." and lit=1.  That second call is not decorative: mkmap()'s
// init_fill draws a fixed 1248 PRNG calls there (see
// quest_level_init_mines_flat).  The throne room is filled=2
// (FILL_LVLFLAGS_ONLY), so it only sets svl.level.flags.has_court — fill_zoo()
// never runs and the room stays as the .lua drew it.
// ════════════════════════════════════════════════════════════════════════

const KNI_STRT_MAP = [
    '..................................................',
    '.-----......................................-----.',
    '.|...|......................................|...|.',
    '.--|+-------------------++-------------------+|--.',
    '...|...................+..+...................|...',
    '...|.|-----------------|++|-----------------|.|...',
    '...|.|.................|..|.........|.......|.|...',
    '...|.|...\\.............+..+.........|.......|.|...',
    '...|.|.................+..+.........+.......|.|...',
    '...|.|.................|..|.........|.......|.|...',
    '...|.|--------------------------------------|.|...',
    '...|..........................................|...',
    '.--|+----------------------------------------+|--.',
    '.|...|......................................|...|.',
    '.-----......................................-----.',
    '..................................................',
].join('\n');

// Main executor.  C ref: makemaz("Kni-strt") -> load_special.
export async function makemaz_kni_strt() {
    const g = game;
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)
    // des.level_init({ style="solidfill", fg="." }) — rn2(2) + fill ROOM
    // (`filling` defaults to `fg`, so this is floor, not stone).
    quest_level_init_fill(ROOM);
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
    }
    quest_level_init_mines_flat();
    bigrm_load_map(KNI_STRT_MAP, false);   // des.map bare string -> lit=FALSE
    quest_region_light(0, 0, 49, 15, true);
    quest_region_light(4, 4, 45, 11, false);
    lspo_region({ region: [6, 6, 22, 9], lit: 1, type: 'throne', filled: 2 });
    quest_region_light(27, 6, 43, 9, true);
    quest_register_branch(20, 14);
    quest_place_stair(40, 7, false);
    // Outside doors.
    quest_set_door(24, 3, 'locked'); quest_set_door(25, 3, 'locked');
    // Inside doors.
    quest_set_door(23, 4, 'closed'); quest_set_door(26, 4, 'closed');
    quest_set_door(24, 5, 'locked'); quest_set_door(25, 5, 'locked');
    quest_set_door(23, 7, 'closed'); quest_set_door(26, 7, 'closed');
    quest_set_door(23, 8, 'closed'); quest_set_door(26, 8, 'closed');
    quest_set_door(36, 8, 'closed');
    // Watchroom doors.
    quest_set_door(4, 3, 'closed'); quest_set_door(45, 3, 'closed');
    quest_set_door(4, 12, 'closed'); quest_set_door(45, 12, 'closed');

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        const arthur = quest_monster({ name: 'King Arthur', mx: 9, my: 7 });
        quest_drop_default_invent(arthur);
        const excalibur = quest_create_named_weapon(54 /*LONG_SWORD*/, 4, arthur);
        if (excalibur) {
            excalibur.blessed = 1; excalibur.cursed = 0; excalibur.oname = 'Excalibur';
            // C ref: mkobj.c create_object() -> oname(otmp, "Excalibur", ONAME_LEVEL_DEF)
            // -> artifact_exists(): registers artiexist[ART_EXCALIBUR], which
            // mksobj_init's later `rn2(40 + 10*nartifact_exist())` artif rolls
            // (plate mail, then every other object this level creates) read.
            artifact_exists(excalibur, 'Excalibur', 1, ONAME_LEVEL_DEF);
        }
        quest_create_object(121 /*PLATE_MAIL*/, null, null, 4, arthur);
        quest_create_object(CHEST, 9, 7, null, null);
        for (const [kx, ky] of [[4, 2], [4, 13], [45, 2], [45, 13]])
            quest_knight_guard(kx, ky, 1);
        for (const [px, py] of [[16, 6], [18, 6], [20, 6], [16, 9], [18, 9], [20, 9]])
            quest_monster({ name: 'page', mx: px, my: py });
        // des.non_diggable — no RNG.
        await quest_trap(SLP_GAS_TRAP, 24, 4);
        await quest_trap(SLP_GAS_TRAP, 25, 4);
        for (let i = 0; i < 4; i++) await quest_trap();
        for (let qx = 14; qx <= 36; qx += 2)
            quest_monster({ name: 'quasit', mx: qx, my: 0, peaceful: 0 });
        // Some warhorses: `for i = 1, 2 + nh.rn2(3)`, each with a CUSTOM
        // inventory function (so makemon's default invent is dropped first) that
        // rolls percent(50) for a saddle.
        const nhorses = 2 + rn2(3);
        for (let i = 0; i < nhorses; i++) {
            const horse = quest_monster({ name: 'warhorse', peaceful: 1 });
            quest_drop_default_invent(horse);
            if (percent(50)) quest_create_object(235 /*SADDLE*/, null, null, null, horse);
        }
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    quest_finalize();
}
