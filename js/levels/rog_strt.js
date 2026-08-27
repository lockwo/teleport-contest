// levels/rog_strt.js - special level builder makemaz_rog_strt() (dat/Rog-strt.lua).
// sp_lev.js re-exports it; the shared special-level machinery is imported below.

import { game } from '../gstate.js';
import { CHEST } from '../mkobj.js';
import {
    bigrm_load_map, quest_create_monster, quest_create_monster_at,
    quest_create_object, quest_drop_default_invent, quest_floodfill_match,
    quest_place_stair, quest_register_branch, quest_rndcoord, quest_set_door,
    shuffle,
    reset_xystart_size,
} from '../sp_lev.js';
import {
    quest_align_shuffle, quest_finalize, quest_level_init_fill,
    quest_lua_random, quest_monster, quest_trap,
} from './quest_home_common.js';

// ════════════════════════════════════════════════════════════════════════
// Rogue quest "home" level loader (dat/Rog-strt.lua) — the Master of Thieves'
// warren, a full-level warren of rooms and streets.
//
// C ref: mklev.c makelevel() -> makemaz("Rog-strt") -> load_special.
// The distinctive bit is the exits: `shuffle(place)` over a FOUR-entry table
// (rn2(4), rn2(3), rn2(2)) picks which of the four map edges gets the real
// down staircase; the other three get mimics wearing "ter:staircase down".
// makemon() already rolls set_mimic_sym() for any S_MIMIC it creates, and
// create_monster then overwrites that appearance without further RNG.
// ════════════════════════════════════════════════════════════════════════

const ROG_STRT_MAP = [
    '---------------------------------.------------------------------------------',
    '|.....|.||..........|....|......|.|.........|.......+............---.......|',
    '|.....|..+..........+....---....S.|...-S-----.-----.|............+.+.......|',
    '|.....+.||........---......|....|.|...|.....|.|...|.---.....------.--------|',
    '|-----|.-------|..|........------.-----.....|.--..|...-------..............|',
    '|.....|........------+------..........+.....|..--S---.........------.-----..',
    '|.....|.------...............-----.}}.--------.|....-------.---....|.+...--|',
    '|..-+--.|....|-----.--------.|...|.....+.....|.|....|.....+.+......|.--....|',
    '|..|....|....|....+.|......|.|...-----.|.....|.--...|.....|.|......|..|....|',
    '|..|.-----S----...|.+....-----...|...|.----..|..|.---....--.---S-----.|----|',
    '|..|.|........|...------.|.S.....|...|....-----.+.|......|..|.......|.|....|',
    '|---.-------..|...|....|.|.|.....|...----.|...|.|---.....|.|-.......|.---..|',
    '...........|..S...|....---.----S----..|...|...+.|..-------.---+-....|...--+|',
    '|---------.---------...|......|....S..|.---...|.|..|...........----.---....|',
    '|........|.........|...+.------....|---.---...|.--+-.----.----....|.+...--+|',
    '|........|.---+---.|----.--........|......-----......|..|..|.--+-.|.-S-.|..|',
    '|........|.|.....|........----------.----.......---.--..|-.|....|.-----.|..|',
    '|----....+.|.....----+---............|..|--------.+.|...SS.|....|.......|..|',
    '|...--+-----.....|......|.------------............---...||.------+--+----..|',
    '|..........S.....|......|.|..........S............|.....||...|.....|....|..|',
    '-------------------------.--------------------------------------------------',
].join('\n');

// C ref: defsym.h — the defsyms index create_monster() looks up for the
// appear_as string "staircase down" (js/hack.js FURNITURE_EXPLANATION keys).
const S_DNSTAIR = 26;

// Main executor.  C ref: makemaz("Rog-strt") -> load_special.
export async function makemaz_rog_strt() {
    const g = game;
    quest_align_shuffle();
    reset_xystart_size();                 // sp_level_coder_init (sp_lev.c:6373)
    quest_level_init_fill(0 /* STONE */);
    // des.level_flags("mazelevel", "noteleport", "hardfloor", "nommap").
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
        g.level.flags.nommap = true;
    }
    bigrm_load_map(ROG_STRT_MAP, false);   // des.map bare string -> lit=FALSE
    // local streets = selection.floodfill(0,12) — no RNG.
    const streets = quest_floodfill_match(0, 12);

    g._quest_gen = true;
    g._full_mon_gen = true;
    try {
        // The down stairs is at one of the 4 "exits"; the others are mimics.
        const place = [[33, 0], [0, 12], [25, 20], [75, 5]];
        shuffle(place);
        quest_place_stair(place[0][0], place[0][1], false);
        const mimics = ['giant mimic', 'large mimic', 'small mimic'];
        for (let i = 0; i < 3; i++) {
            const m = quest_create_monster(mimics[i], place[i + 1][0], place[i + 1][1], null);
            if (m) { m.m_ap_type = 'furniture'; m.mappearance = S_DNSTAIR; }
        }
        quest_register_branch(19, 9);
        for (const [dx, dy] of [[32, 2], [63, 9], [27, 10], [31, 12], [35, 13],
                                [69, 15], [56, 17], [57, 17], [11, 19], [37, 19],
                                [39, 2], [49, 5], [10, 9], [14, 12]])
            quest_set_door(dx, dy, 'locked');
        // des.door("closed",23,14) really is listed twice in the .lua; both
        // calls are replayed (setting the same mask twice draws nothing).
        for (const [dx, dy] of [[52, 1], [9, 2], [20, 2], [65, 2], [67, 2], [6, 3],
                                [21, 5], [38, 5], [69, 6], [4, 7], [39, 7], [58, 7],
                                [60, 7], [18, 8], [20, 9], [48, 10], [46, 12],
                                [62, 12], [74, 12], [23, 14], [23, 14], [50, 14],
                                [68, 14], [74, 14], [14, 15], [63, 15], [9, 17],
                                [21, 17], [50, 17], [6, 18], [65, 18], [68, 18]])
            quest_set_door(dx, dy, 'closed');
        // Master of Thieves + custom inventory.
        const master = quest_create_monster('Master of Thieves', 36, 11, null);
        quest_drop_default_invent(master);
        quest_create_object(134 /*LEATHER_ARMOR*/, null, null, 5, master);
        quest_create_object(37 /*SILVER_DAGGER*/, null, null, 4, master);
        // quantity = d(2,4): nhlib's d() is two math.random(1,4) draws, made
        // while the table is being read — i.e. before the object is created.
        const daggerquan = quest_lua_random(1, 4) + quest_lua_random(1, 4);
        const daggers = quest_create_object(34 /*DAGGER*/, null, null, 2, master);
        if (daggers) { daggers.quan = daggerquan; daggers.cursed = 0; }
        quest_create_object(CHEST, 36, 11, null, null);
        const thugs = [[28, 10], [29, 11], [30, 9], [31, 7],
                       [31, 13], [33, 14], [30, 15], [35, 9], [36, 13]];
        for (const [tx, ty] of thugs) quest_create_monster('thug', tx, ty, null);
        // des.non_diggable — no RNG.
        for (let i = 0; i < 16; i++) await quest_trap();
        // Monsters to get in the way, one pair per exit.
        const guards = [['leprechaun', 1, 12], ['water nymph', 2, 12],
                        ['water nymph', 33, 1], ['leprechaun', 33, 2],
                        ['water nymph', 74, 5], ['leprechaun', 74, 4],
                        ['leprechaun', 25, 19], ['water nymph', 25, 18]];
        for (const [nm, gx2, gy2] of guards)
            quest_monster({ name: nm, mx: gx2, my: gy2, peaceful: 0 });
        // Wandering the streets.
        const npairs = quest_lua_random(4, 7);
        for (let i = 0; i < npairs; i++) {
            let c = quest_rndcoord(streets);
            if (c) quest_create_monster_at('water nymph', c.x, c.y, false);
            c = quest_rndcoord(streets);
            if (c) quest_create_monster_at('leprechaun', c.x, c.y, false);
        }
        const nchams = quest_lua_random(7, 10);
        for (let i = 0; i < nchams; i++) {
            const c = quest_rndcoord(streets);
            if (c) quest_create_monster_at('chameleon', c.x, c.y, false);
        }
    } finally {
        g._quest_gen = false;
        g._full_mon_gen = false;
    }

    quest_finalize();
}
