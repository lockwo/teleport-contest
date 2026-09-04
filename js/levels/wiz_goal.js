// levels/wiz_goal.js — Wizard quest "goal" level (dat/Wiz-goal.lua): the Dark
// One's twin-keep prison compound, with eight captive monsters (two of them
// full player-role NPCs) locked in cages between the keeps.  sp_lev.js
// re-exports makemaz_wiz_goal.  Wiz-goal's "loca" sibling (js/levels/
// wiz_loca.js) and its filler are already ported; only this "goal" builder
// was missing.
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("Wiz-goal")
// -> load_special("Wiz-goal.lua").  nhlib.lua's top-level shuffle(align)
// (rn2(3),rn2(2)) runs first; level_init solidfill draws one rn2(2); the
// des.* program then runs in file order.  No levregion, so fixup_special()
// places nothing.
//
// sp_lev.js's generic lspo_altar()/lspo_monster() (backed by create_altar()/
// create_monster()) are NOT usable here: any monster/altar with no explicit
// `align` field resolves to AM_SPLEV_RANDOM, which routes through
// sp_amask_to_amask() -> EXT.induced_align(), and EXT is sp_lev.js's late-
// binding bridge to js/mklev.js (see sp_lev.js:4020-4061) — `bind_sp_lev_
// externs()` is never called anywhere in this port, so EXT.induced_align
// (and EXT.mkstairs, EXT.mk_roamer, EXT.mk_mplayer, ...) all throw "is not
// wired up yet".  This is exactly why every already-landed quest goal/loca
// builder inlines its own `rn2(3); // induced_align` instead of calling the
// generic engine — it is a hard requirement, not a style choice.  The two
// helpers below do the same for this file's harder cases (a captive that
// needs mk_mplayer()/christen_monst(), and an explicit-coord stairway that
// needs the real linked-list game.stairs shape every consumer in js/ walks
// via `.next`, not the one-off array sp_lev.js's quest_place_stair() pushes).
//
// Two upstream .lua quirks worth flagging, both faithfully reproduced rather
// than "corrected":
//   * `des.altar({ coord={16,11}, aligned="noncoaligned", type="altar" })`
//     misspells the field as "aligned", not "align".  get_table_align() only
//     ever reads "align", so this altar's alignment is NOT noncoaligned — it
//     silently falls back to the "random" default (AM_SPLEV_RANDOM), which
//     costs a very different RNG draw (induced_align's rn2(3) instead of
//     noncoalignment's rn2(2)).
//   * `des.monster({ class = "B", random, peaceful = 0 })` (and the "i" one)
//     carry a bare `random` token as an unnamed positional table entry.  The
//     Lua sandbox only exposes an nh.random() function, not a global
//     `random`, so this identifier evaluates to nil and the resulting table
//     slot is empty — get_table_montype()/get_table_monclass() never look at
//     positional entries, so it changes nothing.  Treated as a no-op.

import {
    COLNO, LA_UP, ROWNO, STAIRS,
} from '../const.js';
import { christen_monst } from '../do_name.js';
import { dunlevs_in_dungeon } from '../dungeon.js';
import { game } from '../gstate.js';
import {
    enexto_spawn, makemon, mm_mon_at, monster_by_pmidx, name_to_pmidx,
    set_malign,
} from '../makemon.js';
import { mk_mplayer } from '../mplayer.js';
import { rn2 } from '../rng.js';
import {
    bigrm_load_map, bigrm_wallification, flip_level, map_cleanup,
    quest_create_monster, quest_level_init_solidfill, quest_region_light,
    quest_set_door, remove_boundary_syms, shuffle, splev_link_doors_rooms,
    vly_abs, vly_altar, vly_non_diggable, vly_region, TEMPLE_RTYPE,
} from '../sp_lev.js';
import {
    quest_monster_class_rnd, quest_monster_named_rnd, quest_named_object_at,
    quest_object_rnd, quest_trap_random,
} from './quest_common.js';

// C ref: sp_lev.c lspo_region "filled" — 2 is the "level flags only" value:
// fill_special_room() skips its switch entirely and only sets has_temple.
const FILL_LVLFLAGS_ONLY = 2;

// C ref: monsym.h def_char_to_monclass() — 'B' = bat or bird, 'i' = imp.
const WIZ_GOAL_S_BAT = 28, WIZ_GOAL_S_IMP = 9;

// objects.h AMULET_OF_ESP has no named JS export; OBJDATA row 201
// ("amulet of ESP") confirms the index.
const AMULET_OF_ESP = 201;

const WIZ_GOAL_MAP = [
    "                                                                            ",
    "                                                                            ",
    "                                                                            ",
    "                   -------------                 -------------              ",
    "                   |...........|                 |...........|              ",
    "            -------|...........-------------------...........|              ",
    "            |......S...........|..|..|..|..|..|..|...........|              ",
    "            |......|...........|..|..|..|..|..|..|...........|              ",
    "            |......|...........-F+-F+-F+-F+-F+-F+-...........|              ",
    "            --S----|...........S.................+...........|              ",
    "            |......|...........-F+-F+-F+-F+-F+-F+-...........|              ",
    "            |......|...........|..|..|..|..|..|..|...........|              ",
    "            |......|...........|..|..|..|..|..|..|...........|              ",
    "            -------|...........-------------------...........|              ",
    "                   |...........|                 |...........|              ",
    "                   -------------                 -------------              ",
    "                                                                            ",
    "                                                                            ",
    "                                                                            ",
    "                                                                            ",
].join('\n');

// C ref: dungeon.c induced_align(80), as sp_amask_to_amask() calls it for any
// AM_SPLEV_RANDOM table (every des.monster()/des.altar() here that carries no
// `align` field).  The two rn2(100) gates in the real function only fire when
// this special level or its dungeon has a fixed alignment flag, which the
// Wizard quest branch does not (every other quest builder in this port makes
// the same simplification — see e.g. js/levels/quest_common.js's
// quest_monster_class_rnd()) — so this is the unconditional rn2(3) tail alone.
function wiz_goal_induced_align() {
    const al = rn2(3) - 1;                                // dungeon.c:2012
    if (al === 0) return 0x02 /* AM_NEUTRAL */;
    return al < 0 ? 0x01 /* AM_CHAOTIC */ : 0x04 /* AM_LAWFUL */;
}

// C ref: sp_lev.c create_monster() (sp_lev.c:1924), reached from lspo_monster()
// for each captive des.monster({id=...}) table.  None of the eight carry an
// `align` field, so create_monster()'s `sp_amask !== AM_SPLEV_RANDOM` /
// EXT.mk_roamer() arm is never taken; the only two branches that matter are
// EXT.mk_mplayer() (unwired, but fully ported at js/mplayer.js — imported
// directly here) for an `id` in the player-role pmidx range, and plain
// makemon() otherwise.  christen_monst()/peaceful/asleep are applied last,
// exactly matching create_monster()'s post-make tail.
function wiz_goal_captive({ id, mx, my, peaceful = null, asleep = null, name = null }) {
    const pmidx = name_to_pmidx(id);
    const pm = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    if (!pm) return null;
    wiz_goal_induced_align();                             // induced_align rn2(3), always drawn
    const { x: ax, y: ay } = vly_abs(mx, my);
    let x = ax, y = ay;
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, pm);
        if (cc) { x = cc.x; y = cc.y; }
    }
    const roleLo = name_to_pmidx('archeologist'), roleHi = name_to_pmidx('wizard');
    const mtmp = (roleLo <= pmidx && pmidx <= roleHi)
        ? mk_mplayer(pm, x, y, false)
        : makemon(pm, x, y, 0 /* NO_MM_FLAGS */);
    if (!mtmp) return null;
    let mon = mtmp;
    if (name) mon = christen_monst(mon, name);
    if (peaceful != null) { mon.mpeaceful = peaceful ? 1 : 0; set_malign(mon); }
    if (asleep != null) mon.msleeping = asleep ? 1 : 0;
    return mon;
}

// C ref: mklev.c mkstairs(x, y, up, croom, force) for an EXPLICIT coord
// (force=TRUE: the terrain is forced to ROOM first).  sp_lev.js's own
// quest_place_stair() pushes onto a plain ARRAY, but every real consumer
// (stairway_find_dir() and friends, all over js/) walks the singly-linked
// `.next` chain js/mklev.js's stairway_add() actually builds; an array is
// invisible to them.  Reproduced locally rather than through that helper.
function wiz_goal_mkstairs(mx, my, up) {
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

export async function makemaz_wiz_goal() {
    const g = game;
    // load_special -> load nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) — rn2(2) + fill STONE.
    quest_level_init_solidfill();
    // des.level_flags("mazelevel") — no RNG.  No "noflip", so the finalize
    // flip below still draws its two rn2(2).
    if (g.level?.flags) g.level.flags.is_maze_lev = true;
    // des.map([[...]]) — bare string form: lit is FALSE, no rn2(2).
    bigrm_load_map(WIZ_GOAL_MAP, false);

    // des.region({region={13,10,18,12}, lit=0, type="temple", filled=2}) —
    // the ONE table-form region: it creates a real room (do_room_or_subroom
    // always does, regardless of `filled`), unlike the sixteen plain
    // selection.area(...) calls below.
    vly_region(13, 10, 18, 12, 0, TEMPLE_RTYPE, FILL_LVLFLAGS_ONLY, false);
    // des.region(selection.area(...), "lit"/"unlit") x16 — 2-arg form: no
    // room, no RNG.
    quest_region_light(13, 6, 18, 8, true);
    quest_region_light(20, 4, 30, 14, false);
    quest_region_light(32, 6, 33, 7, false);
    quest_region_light(35, 6, 36, 7, false);
    quest_region_light(38, 6, 39, 7, false);
    quest_region_light(41, 6, 42, 7, false);
    quest_region_light(44, 6, 45, 7, false);
    quest_region_light(47, 6, 48, 7, false);
    quest_region_light(32, 9, 48, 9, false);
    quest_region_light(32, 11, 33, 12, false);
    quest_region_light(35, 11, 36, 12, false);
    quest_region_light(38, 11, 39, 12, false);
    quest_region_light(41, 11, 42, 12, false);
    quest_region_light(44, 11, 45, 12, false);
    quest_region_light(47, 11, 48, 12, false);
    quest_region_light(50, 4, 60, 14, true);

    // des.door("locked", x, y) x16 — explicit states over map-drawn '+' cells.
    quest_set_door(19, 6, 'locked');
    quest_set_door(14, 9, 'locked');
    quest_set_door(31, 9, 'locked');
    quest_set_door(33, 8, 'locked');
    quest_set_door(36, 8, 'locked');
    quest_set_door(39, 8, 'locked');
    quest_set_door(42, 8, 'locked');
    quest_set_door(45, 8, 'locked');
    quest_set_door(48, 8, 'locked');
    quest_set_door(33, 10, 'locked');
    quest_set_door(36, 10, 'locked');
    quest_set_door(39, 10, 'locked');
    quest_set_door(42, 10, 'locked');
    quest_set_door(45, 10, 'locked');
    quest_set_door(48, 10, 'locked');
    quest_set_door(49, 9, 'locked');

    // des.stair("up", 55,05) — no down stairs: this is the quest's last level.
    wiz_goal_mkstairs(55, 5, true);
    // des.non_diggable(selection.area(00,00,75,19)) — no RNG.
    vly_non_diggable(0, 0, 75, 19);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // des.altar({ coord={16,11}, aligned="noncoaligned", type="altar" }) —
        // "aligned" is a typo (see file header); real "align" is unset, so
        // this resolves to "random" (AM_SPLEV_RANDOM), i.e. one plain rn2(3).
        // type="altar" is shrine==0, so no priestini either way.
        vly_altar(16, 11, wiz_goal_induced_align(), 0);
        // des.object({ id="amulet of ESP", x=16,y=11, buc="blessed", spe=0,
        //              name="The Eye of the Aethiopica" }) — the quest
        // artifact, on the altar.
        quest_named_object_at(AMULET_OF_ESP, 16, 11,
                              { spe: 0, buc: 'blessed', name: 'The Eye of the Aethiopica' });
        // des.object() x14 — mkobj_at(RANDOM_CLASS) at a random DRY spot.
        for (let i = 0; i < 14; i++) quest_object_rnd();
        // des.trap() x6 — random type at a random DRY spot.
        for (let i = 0; i < 6; i++) await quest_trap_random();

        // des.monster("Dark One", 16, 11) — the nemesis, on the altar.  The
        // 3-arg string+coord form carries no `peaceful` key, so makemon's own
        // answer stands (hostile).
        quest_create_monster('Dark One', 16, 11, null);
        // des.monster({ class="B", random, peaceful=0 }) x11 — the trailing
        // `random` positional entry is a no-op (see file header).
        for (let i = 0; i < 11; i++) quest_monster_class_rnd(WIZ_GOAL_S_BAT, false);
        // des.monster({ class="i", random, peaceful=0 }) x7.
        for (let i = 0; i < 7; i++) quest_monster_class_rnd(WIZ_GOAL_S_IMP, false);
        // des.monster("vampire bat") x8 — the multi-char string form goes
        // through find_montype()'s real gender rn2(2).
        for (let i = 0; i < 8; i++) quest_monster_named_rnd('vampire bat', null);
        // des.monster({ class="i", random, peaceful=0 }) x1, trailing.
        quest_monster_class_rnd(WIZ_GOAL_S_IMP, false);

        // Captive monsters.  Two of them ("rogue" Pug, "wizard" Newt) are
        // player-ROLE pmidx values, so wiz_goal_captive() routes them through
        // mk_mplayer() (a fully-equipped NPC) instead of plain makemon() — a
        // real behavioural difference this port's smaller create-monster
        // helpers (quest_create_monster/splev_create_monster) do not
        // implement.  Both also need a custom display `name`.
        wiz_goal_captive({ id: 'rogue', mx: 35, my: 6, peaceful: 1, name: 'Pug' });
        wiz_goal_captive({ id: 'owlbear', mx: 47, my: 6, peaceful: 1, asleep: 1 });
        wiz_goal_captive({ id: 'wizard', mx: 32, my: 11, peaceful: 1, asleep: 1, name: 'Newt' });
        wiz_goal_captive({ id: 'Grey-elf', mx: 44, my: 11, peaceful: 1 });
        wiz_goal_captive({ id: 'hill giant', mx: 47, my: 11, peaceful: 1, asleep: 1 });
        wiz_goal_captive({ id: 'gnomish wizard', mx: 38, my: 6, peaceful: 1 });
        wiz_goal_captive({ id: 'prisoner', mx: 35, my: 11, peaceful: 1 });
        wiz_goal_captive({ id: 'prisoner', mx: 41, my: 11, peaceful: 1, asleep: 1 });
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    // C ref: load_special()'s tail (sp_lev.c:6464-6491) — link_doors_rooms(),
    // remove_boundary_syms(), map_cleanup(), wallification(1,0,COLNO-1,
    // ROWNO-1), then flip_level_rnd(allow_flips=3, FALSE): one rn2(2) per axis.
    splev_link_doors_rooms();
    remove_boundary_syms();
    map_cleanup();
    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
