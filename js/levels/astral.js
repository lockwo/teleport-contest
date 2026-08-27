// levels/astral.js — makemaz_astral(), the Astral Plane (C ref: dat/astral.lua).
// Three alignment temples with their high altars, Moloch's horde, the aligned
// horde, the three Riders, and a 60%-per-side chance of opening the bottom
// wings into big halls full of extra Angels.

import {
    AM_CHAOTIC, AM_LAWFUL, AM_NEUTRAL, A_CHAOTIC, A_LAWFUL, A_NEUTRAL, A_NONE,
    COLNO, CROSSWALL, HWALL, IRONBARS, IS_STWALL, IS_TREE, ROOM, ROWNO, STONE, VWALL,
    W_NONDIGGABLE, W_NONPASSWALL,
} from '../const.js';
import { game } from '../gstate.js';
import {
    MGEND_NEUTRAL, MM_EMIN, enexto_spawn, makemon, mm_mon_at, monster_by_pmidx,
    name_gender_hint, name_to_pmidx,
} from '../makemon.js';
import { rn2 } from '../rng.js';
import {
    SET_LIT_NOCHANGE, TEMPLE_RTYPE, bigrm_load_map, bigrm_wallification, flip_level,
    percent, quest_floodfill_match, quest_level_init_solidfill, quest_rndcoord,
    quest_set_door, set_levltyp_lit, shuffle, splev_map_at, vly_abs, vly_altar,
    vly_region,
} from '../sp_lev.js';
import {
    S_DRAGON, S_LICH, S_VAMPIRE, plane_coder_init, plane_level_flags, plane_message,
    plane_monster, plane_place_lregions, plane_teleport_region,
} from './planes.js';

const ASTRAL_MAP = [
    '                              ---------------                              ',
    '                              |.............|                              ',
    '                              |..---------..|                              ',
    '                              |..|.......|..|                              ',
    '---------------               |..|.......|..|               ---------------',
    '|.............|               |..|.......|..|               |.............|',
    '|..---------..-|   |-------|  |..|.......|..|  |-------|   |-..---------..|',
    '|..|.......|...-| |-.......-| |..|.......|..| |-.......-| |-...|.......|..|',
    '|..|.......|....-|-.........-||..----+----..||-.........-|-....|.......|..|',
    '|..|.......+.....+...........||.............||...........+.....+.......|..|',
    '|..|.......|....-|-.........-|--|.........|--|-.........-|-....|.......|..|',
    '|..|.......|...-| |-.......-|   -|---+---|-   |-.......-| |-...|.......|..|',
    '|..---------..-|   |---+---|    |-.......-|    |---+---|   |-..---------..|',
    '|.............|      |...|-----|-.........-|-----|...|      |.............|',
    '---------------      |.........|...........|.........|      ---------------',
    '                     -------...|-.........-|...-------                     ',
    '                           |....|-.......-|....|                           ',
    '                           ---...|---+---|...---                           ',
    '                             |...............|                             ',
    '                             -----------------                             ',
].join('\n');

// C ref: sp_lev.c create_monster() for an entry that carries an explicit
// `align`: sp_amask is then a plain mask, so induced_align's rn2(3) does NOT
// run and creation goes through mk_roamer() (priest.c:724) with MM_EMIN — which
// is what stops makemon()'s aligned-cleric minion block drawing its own two
// rn2(3)s.  Same shape as sanctum.js's sanc_monster().
function astral_monster(name, mx, my, opts = {}) {
    const { sp_align = null, peaceful = null, coord = null } = opts;
    const pmidx = name_to_pmidx(name);
    const ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    if (!ptr) return null;
    if (ptr.gcode !== 1 && ptr.gcode !== 2 && name_gender_hint(name) === MGEND_NEUTRAL)
        rn2(2);                                   // find_montype (sp_lev.c:3156)
    if (sp_align === null) rn2(3);                // induced_align (dungeon.c:2012)
    let x, y;
    if (coord) { x = coord.x; y = coord.y; }      // already absolute (rndcoord)
    else { const c = vly_abs(mx, my); x = c.x; y = c.y; }
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, ptr);
        if (cc) { x = cc.x; y = cc.y; }
    }
    const mtmp = makemon(ptr, x, y, sp_align !== null ? MM_EMIN : 0);
    if (!mtmp) return null;
    if (sp_align !== null) {
        mtmp.emin = mtmp.emin || {};
        mtmp.emin.min_align = sp_align;
        mtmp.emin.renegade = ((game.u?.ualign?.type ?? A_NONE) === sp_align) && !peaceful;
        mtmp.ispriest = 0;
        mtmp.isminion = 1;
        mtmp.mtrapseen = ~0;
        mtmp.msleeping = 0;
    }
    if (peaceful != null) mtmp.mpeaceful = peaceful ? 1 : 0;
    return mtmp;
}

// C ref: sp_lev.c lspo_wallify() with no args -> wallify_map over the whole
// level: STONE next to a room becomes HWALL (vertical neighbour) or VWALL.
function astral_wallify() {
    const map = game.level;
    for (let y = 0; y <= ROWNO - 1; y++) {
        const loYY = (y > 0) ? y - 1 : 0;
        const hiYY = (y < ROWNO - 1) ? y + 1 : ROWNO - 1;
        for (let x = 1; x <= COLNO - 1; x++) {
            if (map.at(x, y)?.typ !== STONE) continue;
            const loXX = (x > 1) ? x - 1 : 1;
            const hiXX = (x < COLNO - 1) ? x + 1 : COLNO - 1;
            let done = false;
            for (let yy = loYY; yy <= hiYY && !done; yy++)
                for (let xx = loXX; xx <= hiXX; xx++) {
                    const t = map.at(xx, yy)?.typ;
                    if (t === ROOM || t === CROSSWALL) {
                        map.at(x, y).typ = (yy !== y) ? HWALL : VWALL;
                        done = true; break;
                    }
                }
        }
    }
}

function astral_terrain_area(x1, y1, x2, y2, typ) {
    const a = vly_abs(x1, y1), b = vly_abs(x2, y2);
    for (let x = a.x; x <= b.x; x++)
        for (let y = a.y; y <= b.y; y++)
            set_levltyp_lit(x, y, typ, SET_LIT_NOCHANGE);
}

function astral_wall_property(mx1, my1, mx2, my2, bits) {
    const a = vly_abs(mx1, my1), b = vly_abs(mx2, my2);
    for (let x = Math.max(a.x, 1); x <= Math.min(b.x, COLNO - 1); x++)
        for (let y = Math.max(a.y, 0); y <= Math.min(b.y, ROWNO - 1); y++) {
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            if (IS_STWALL(loc.typ) || IS_TREE(loc.typ) || loc.typ === IRONBARS)
                loc.wall_info = (loc.wall_info || 0) | bits;
        }
}

// "Moloch's horde" — the three round rooms, in file order.  All noaligned.
const MOLOCH_HORDE = [
    ['aligned cleric', 18, 9], ['aligned cleric', 19, 8], ['aligned cleric', 19, 9],
    ['aligned cleric', 19, 10], ['Angel', 20, 9], ['Angel', 20, 10],
    ['RIDER', 'Pestilence'],
    ['aligned cleric', 36, 12], ['aligned cleric', 37, 12], ['aligned cleric', 38, 12],
    ['aligned cleric', 36, 13], ['Angel', 38, 13], ['Angel', 37, 13],
    ['RIDER', 'Death'],
    ['aligned cleric', 56, 9], ['aligned cleric', 55, 8], ['aligned cleric', 55, 9],
    ['aligned cleric', 55, 10], ['Angel', 54, 9], ['Angel', 54, 10],
    ['RIDER', 'Famine'],
];

// "The aligned horde" — [name, x, y, align, peaceful] in file order.
const ALIGNED_HORDE = [
    ['aligned cleric', 12, 7, A_CHAOTIC, 0], ['aligned cleric', 13, 7, A_CHAOTIC, 1],
    ['aligned cleric', 14, 7, A_LAWFUL, 0], ['aligned cleric', 12, 11, A_LAWFUL, 1],
    ['aligned cleric', 13, 11, A_NEUTRAL, 0], ['aligned cleric', 14, 11, A_NEUTRAL, 1],
    ['Angel', 11, 5, A_CHAOTIC, 0], ['Angel', 12, 5, A_CHAOTIC, 1],
    ['Angel', 13, 5, A_LAWFUL, 0], ['Angel', 11, 13, A_LAWFUL, 1],
    ['Angel', 12, 13, A_NEUTRAL, 0], ['Angel', 13, 13, A_NEUTRAL, 1],
    ['aligned cleric', 32, 9, A_CHAOTIC, 0], ['aligned cleric', 33, 9, A_CHAOTIC, 1],
    ['aligned cleric', 34, 9, A_LAWFUL, 0], ['aligned cleric', 40, 9, A_LAWFUL, 1],
    ['aligned cleric', 41, 9, A_NEUTRAL, 0], ['aligned cleric', 42, 9, A_NEUTRAL, 1],
    ['Angel', 31, 8, A_CHAOTIC, 0], ['Angel', 32, 8, A_CHAOTIC, 1],
    ['Angel', 31, 9, A_LAWFUL, 0], ['Angel', 42, 8, A_LAWFUL, 1],
    ['Angel', 43, 8, A_NEUTRAL, 0], ['Angel', 43, 9, A_NEUTRAL, 1],
    ['aligned cleric', 60, 7, A_CHAOTIC, 0], ['aligned cleric', 61, 7, A_CHAOTIC, 1],
    ['aligned cleric', 62, 7, A_LAWFUL, 0], ['aligned cleric', 60, 11, A_LAWFUL, 1],
    ['aligned cleric', 61, 11, A_NEUTRAL, 0], ['aligned cleric', 62, 11, A_NEUTRAL, 1],
    ['Angel', 61, 5, A_CHAOTIC, 0], ['Angel', 62, 5, A_CHAOTIC, 1],
    ['Angel', 63, 5, A_LAWFUL, 0], ['Angel', 61, 13, A_LAWFUL, 1],
    ['Angel', 62, 13, A_NEUTRAL, 0], ['Angel', 63, 13, A_NEUTRAL, 1],
];

const ALIGN_MASK = { law: AM_LAWFUL, neutral: AM_NEUTRAL, chaos: AM_CHAOTIC };

export async function makemaz_astral() {
    const g = game;
    // nhlib.lua's top-level `shuffle(align)` — astral.lua is the one script that
    // actually reads the result, for its three high altars.
    plane_coder_init();
    const align = ['law', 'neutral', 'chaos'];
    shuffle(align);
    quest_level_init_solidfill();
    plane_level_flags('mazelevel', 'noteleport', 'hardfloor', 'nommap',
                      'shortsighted', 'solidify');
    plane_message('You arrive on the Astral Plane!');
    plane_message('Here the High Temple of %d is located.');
    plane_message('You sense alarm, hostility, and excitement in the air!');
    bigrm_load_map(ASTRAL_MAP, false);

    g._full_mon_gen = true;
    try {
        // 60% per side to open the bottom wing into a hall, each with its own
        // 4..9 Angels and a coin-flip extra random monster apiece.
        for (let i = 1; i <= 2; i++) {
            if (!percent(60)) continue;
            let hall;
            if (i === 1) {
                astral_terrain_area(17, 14, 30, 18, ROOM);
                astral_wallify();
                // temporarily close the wing off so the flood stops at the entry
                const c = vly_abs(33, 18);
                set_levltyp_lit(c.x, c.y, VWALL, SET_LIT_NOCHANGE);
                hall = quest_floodfill_match(30, 16);
                set_levltyp_lit(c.x, c.y, ROOM, SET_LIT_NOCHANGE);
            } else {
                astral_terrain_area(44, 14, 57, 18, ROOM);
                astral_wallify();
                const c = vly_abs(41, 18);
                set_levltyp_lit(c.x, c.y, VWALL, SET_LIT_NOCHANGE);
                hall = quest_floodfill_match(44, 16);
                set_levltyp_lit(c.x, c.y, ROOM, SET_LIT_NOCHANGE);
            }
            const n = 4 + rn2(6);                 // math.random(4,9)
            for (let j = 0; j < n; j++) {
                // Lua builds the table before lspo_monster sees it, so
                // hall:rndcoord(1) draws BEFORE the monster's own rolls.
                const c1 = quest_rndcoord(hall);
                if (c1) astral_monster('Angel', 0, 0,
                                       { sp_align: A_NONE, peaceful: 0, coord: c1 });
                if (percent(50)) {
                    const c2 = quest_rndcoord(hall);
                    if (c2) {
                        rn2(3);                   // induced_align (no id, no align)
                        let { x, y } = c2;
                        if (mm_mon_at(x, y)) {
                            const cc = enexto_spawn(x, y, null);
                            if (cc) { x = cc.x; y = cc.y; }
                        }
                        const mt = makemon(null, x, y, 0);
                        if (mt) mt.mpeaceful = 0;
                    }
                }
            }
        }

        // The three Rider slots.
        const place = new Set([
            `${vly_abs(23, 9).x},${vly_abs(23, 9).y}`,
            `${vly_abs(37, 14).x},${vly_abs(37, 14).y}`,
            `${vly_abs(51, 9).x},${vly_abs(51, 9).y}`,
        ]);

        plane_teleport_region([29, 15, 45, 15], [30, 15, 44, 15]);
        // Lit courts (irregular) then the three temples (filled = FILL_LVLFLAGS_ONLY).
        vly_region(1, 5, 16, 14, 1, 0 /* OROOM */, 0, true);
        vly_region(31, 1, 44, 10, 1, 0, 0, true);
        vly_region(61, 5, 74, 14, 1, 0, 0, true);
        vly_region(4, 7, 10, 11, 1, TEMPLE_RTYPE, 2, false);
        vly_region(34, 3, 40, 7, 1, TEMPLE_RTYPE, 2, false);
        vly_region(64, 7, 70, 11, 1, TEMPLE_RTYPE, 2, false);
        // type="sanctum" => shrine == 2 => priestini() makes the high priest.
        vly_altar(7, 9, ALIGN_MASK[align[0]], 2);
        vly_altar(37, 5, ALIGN_MASK[align[1]], 2);
        vly_altar(67, 9, ALIGN_MASK[align[2]], 2);
        for (const [dx, dy, st] of [[11, 9, 'closed'], [17, 9, 'closed'],
                                    [23, 12, 'locked'], [37, 8, 'locked'],
                                    [37, 11, 'closed'], [37, 17, 'closed'],
                                    [51, 12, 'locked'], [57, 9, 'locked'],
                                    [63, 9, 'closed']])
            quest_set_door(dx, dy, st);
        astral_wall_property(0, 0, 74, 19, W_NONDIGGABLE);
        astral_wall_property(0, 0, 74, 19, W_NONPASSWALL);

        for (const entry of MOLOCH_HORDE) {
            if (entry[0] === 'RIDER') {
                const c = quest_rndcoord(place);
                if (c) astral_monster(entry[1], 0, 0, { peaceful: 0, coord: c });
            } else {
                astral_monster(entry[0], entry[1], entry[2],
                               { sp_align: A_NONE, peaceful: 0 });
            }
        }
        for (const [name, mx, my, al, pc] of ALIGNED_HORDE)
            astral_monster(name, mx, my, { sp_align: al, peaceful: pc });
        // Assorted nasties: three each of class L, V and D.
        for (const cls of [S_LICH, S_LICH, S_LICH, S_VAMPIRE, S_VAMPIRE, S_VAMPIRE,
                           S_DRAGON, S_DRAGON, S_DRAGON])
            plane_monster({ cls, peaceful: 0 });
    } finally {
        g._full_mon_gen = false;
    }

    bigrm_wallification(1, 0, COLNO - 1, ROWNO - 1);
    // C ref: sp_lev.c solidify_map(), run at finalize because astral.lua's
    // level_flags carry "solidify": every solid-stone wall the script did NOT
    // draw explicitly becomes both undiggable and unphaseable.
    for (let x = 0; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const loc = g.level?.at(x, y);
            if (loc && IS_STWALL(loc.typ) && !splev_map_at(x, y))
                loc.wall_info = (loc.wall_info || 0) | W_NONDIGGABLE | W_NONPASSWALL;
        }
    let flp = 0;
    if (rn2(2)) flp |= 1;
    if (rn2(2)) flp |= 2;
    if (flp) flip_level(flp);
    await plane_place_lregions();
}
