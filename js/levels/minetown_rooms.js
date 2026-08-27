// levels/minetown_rooms.js — the three ROOMS-AND-CORRIDORS Mine Town variants:
//   makemaz_minetown2()  dat/minetn-2.lua  "Town Square"
//   makemaz_minetown3()  dat/minetn-3.lua  "Alley Town"   (Kelly Bailey)
//   makemaz_minetown7()  dat/minetn-7.lua  "Bazaar Town"  (Kelly Bailey)
//
// They share minetn-4's shape exactly: one big centred des.room holding a set
// of nested subrooms (shops, a temple, gnome homes), four fully random rooms
// and des.random_corridors().  minetn-4 is already ported inside js/mklev.js
// (makemaz_minetown4), and the engine pieces all four need — create_room /
// create_subroom / topologize / create_door / makecorridors — live there.
//
// mklev.js is a shared file this lane may not edit, so those pieces are reached
// through the `_minetn_room_api` bundle it exports.  The import is a NAMESPACE
// import on purpose: if that one line is ever missing, `MKLEV._minetn_room_api`
// is simply undefined and each builder returns false instead of throwing, so
// makelevel() falls through to the ordinary generator exactly as it does today.
//
// C ref: mkmaze.c:1136 makemaz("minetn") -> load_special("minetn-<N>.lua"),
// sp_lev.c lspo_room()/build_room()/create_door()/create_monster().

import {
    COLNO, FILL_NONE, FILL_NORMAL, FOUNTAIN, IS_FURNITURE, OROOM, ROWNO, SHOPBASE,
    SINK, TEMPLE,
} from '../const.js';
import { game } from '../gstate.js';
import { mkclass } from '../makemon.js';
import * as MKLEV from '../mklev.js';
import { rn2 } from '../rng.js';
import { roles } from '../roles.js';
import {
    DOORSTATES, WALLDIRS, add_doors_to_room, create_door, flip_level, percent,
} from '../sp_lev.js';

// C ref: mkroom.h — SHOPBASE 14, FOODSHOP 19, WANDSHOP 21, TOOLSHOP 22,
// BOOKSHOP 23, FODDERSHOP 24, CANDLESHOP 25.  sp_lev.c room_types[] names them.
const MT_RTYPE = {
    'ordinary': OROOM, 'temple': TEMPLE, 'shop': SHOPBASE,
    'food shop': SHOPBASE + 5, 'wand shop': SHOPBASE + 7,
    'tool shop': SHOPBASE + 8, 'book shop': SHOPBASE + 9,
    'health food shop': SHOPBASE + 10, 'candle shop': SHOPBASE + 11,
};

// monsym.h monsterclass enum: lowercase a..z are 1..26, uppercase restarts at
// S_ANGEL 27, so 'G' == S_GNOME 33 and 'n' == S_NYMPH 14.
const MT_CLASS_CHAR = { G: 33, n: 14 };
const G_NOGEN = 0x0200;                       // include/monflag.h

// C ref: dat/nhlib.lua:47 monkfoodshop() — role-dependent, no RNG.
function mt_monkfoodshop() {
    return (roles[game.initrole]?.name === 'Monk')
        ? 'health food shop' : 'food shop';
}

function api() { return MKLEV._minetn_room_api || null; }

// des.altar({x,y,align=align[1],type="shrine"}) inside a temple subroom.
async function mt_altar(A, sub, rx, ry, alignName) {
    if (!sub) return;
    await A.mt4_altar(sub, rx, ry, alignName);
}

// C ref: sp_lev.c build_room() for a NESTED room with explicit geometry.
// `chance` defaults to 100 in lspo_room, so the rn2(100) is drawn for EVERY
// room even when it can never fail; a `lit` of -1 is litstate_rnd's
// rnd(1+depth) (+ rn2(77)) inside create_subroom.
function mt_subroom(A, parent, x, y, w, h, typeName, lit, chance = 100) {
    const wanted = MT_RTYPE[typeName] ?? OROOM;
    const rtype = (!chance || rn2(100) < chance) ? wanted : OROOM;
    const ok = A.create_subroom(parent, x, y, w, h, rtype, lit);
    if (!ok) return null;
    // lspo_room:5644 — the parent only goes irregular once a subroom actually
    // landed, and on failure C skips the whole contents function, which is why
    // every helper below is a no-op on a null room rather than drawing.
    parent.irregular = true;
    const sub = parent.sbrooms[parent.nsubrooms - 1];
    A.topologize(sub);
    // lspo_room's `filled` defaults to 1 outside themerooms; fill_special_room
    // ignores OROOM anyway, and FILL_NONE keeps our fill_ordinary_room loop
    // (which C's des finalize does not run) off the plain rooms.
    sub.needfill = (rtype === OROOM) ? FILL_NONE : FILL_NORMAL;
    sub.needjoining = true;
    return sub;
}

// C ref: sp_lev.c lspo_door() table form -> create_door().  An explicit
// `state` fixes the mask and an explicit `wall` fixes the wall, so the only
// draws are the trycnt loop's rn2(4) plus one rn2(span) per accepted wall —
// unless `pos` is given (minetn-7's bazaar), which removes that second draw.
function mt_door(croom, state, wall, pos = -1) {
    if (!croom) return;
    create_door({ secret: 0, mask: DOORSTATES[state], pos,
                  wall: WALLDIRS[wall] }, croom);
}

// C ref: sp_lev.c lspo_feature() with croom coords — get_location_coord()
// offsets by croom->lx/ly and sel_set_feature() leaves furniture alone.
function mt_feature(croom, rx, ry, typ) {
    if (!croom) return;
    const loc = game.level?.at(croom.lx + rx, croom.ly + ry);
    if (!loc || IS_FURNITURE(loc.typ)) return;
    loc.typ = typ;
    if (typ === FOUNTAIN && game.level?.flags)
        game.level.flags.nfountains = (game.level.flags.nfountains || 0) + 1;
}

// des.monster("name") / des.monster({id="name", peaceful=1}) inside a room.
function mt_monster(A, name, croom, peaceful) {
    if (!croom) return null;
    // mk_find_montype returns { data, mgend }; passing the WRAPPER through left
    // permonst fields undefined, so adj_lev() read mlevel as 0 and newmonhp drew
    // rnd(4) where C draws d(m_lev,8), and mk_mines_race_suppress's rn2(3) never
    // fired for a gnome/dwarf hero.
    const { data, mgend } = A.mk_find_montype(name); // find_montype gender roll
    A.oracle_induced_align();                        // sp_amask_to_amask
    const mtmp = A.mt4_place_monster(A.mk_mines_race_suppress(data), croom, peaceful);
    if (mtmp) mtmp.female = mgend;                   // create_monster: mtmp->female
    return mtmp;
}

// des.monster("G"/"n") — a monster CLASS inside a room.
function mt_monster_class(A, classChar, croom, peaceful) {
    if (!croom) return null;
    const klass = MT_CLASS_CHAR[classChar] ?? 0;
    A.oracle_induced_align();                        // amask computed first
    const data = A.mk_mines_race_suppress(mkclass(klass, G_NOGEN));
    return A.mt4_place_monster(data, croom, peaceful);
}

// C ref: sp_lev.c lspo_room() for a fully random TOP-LEVEL room.
async function mt_room(A, contents) {
    rn2(100);                                        // build_room chance
    const ok = A.create_room(-1, -1, -1, -1, -1, -1, OROOM, -1);
    if (!ok) return;
    const croom = game.level.rooms[game.level.nroom - 1];
    if (!croom) return;
    A.topologize(croom);
    croom.needfill = FILL_NONE;
    if (contents) await contents(croom);
    add_doors_to_room(croom);
}

// The four trailing random rooms every minetn room-script ends with, then
// des.random_corridors().  Identical in minetn-2/3/4/7.
async function mt_outer_rooms(A) {
    await mt_room(A, async (croom) => { await A.oracle_stair(croom, true); });
    await mt_room(A, async (croom) => {
        await A.oracle_stair(croom, false);
        await A.oracle_trap(croom);
        mt_monster(A, 'gnome', croom);
        mt_monster(A, 'gnome', croom);
    });
    await mt_room(A, async (croom) => { mt_monster(A, 'dwarf', croom); });
    await mt_room(A, async (croom) => {
        await A.oracle_trap(croom);
        mt_monster(A, 'gnome', croom);
    });
    A.makecorridors();               // des.random_corridors()
}

// nhlib.lua's top-level `shuffle(align)`: rn2(3), rn2(2).
function mt_shuffle_align() {
    const align = ['law', 'neutral', 'chaos'];
    for (let i = align.length; i >= 2; i--) {
        const j = 1 + rn2(i);
        const a = i - 1, b = j - 1;
        const t = align[a]; align[a] = align[b]; align[b] = t;
    }
    return align;
}

// lspo_finalize_level(): wallification, then flip_level_rnd(allow_flips).
function mt_finalize(A) {
    MKLEV.wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                            // sp_lev.c:975
    if (rn2(2)) flp |= 2;                            // sp_lev.c:977
    if (flp) { flip_level(flp); A.mt4_flip_subrooms(flp); }
    MKLEV.set_wall_state();
}

// The shared prologue/epilogue every one of these three builders wants.
// `body(A, town, align)` runs inside the big centred room.
async function mt_build(mainW, body) {
    const A = api();
    if (!A) return false;                            // dispatch falls through
    const g = game;
    const align = mt_shuffle_align();

    const was_full = g._full_mon_gen;
    g._full_mon_gen = true;
    const was_mklev = g.in_mklev;
    g.in_mklev = true;
    if (g.level) g.level._splev_fullmon = true;
    try {
        rn2(100);                                    // build_room chance
        const okmain = A.create_room(3, 3, mainW, 15, 3 /*CENTER*/,
                                     3 /*CENTER*/, OROOM, 1);
        const town = okmain ? g.level.rooms[g.level.nroom - 1] : null;
        if (town) {
            A.topologize(town);
            town.needfill = FILL_NONE;
            await body(A, town, align);
            add_doors_to_room(town);
        }
        await mt_outer_rooms(A);
    } finally {
        g._full_mon_gen = was_full;
        g.in_mklev = was_mklev;
    }
    mt_finalize(A);
    return true;
}

// The Town Watch block that closes every minetn town room.
function mt_town_watch(A, town) {
    for (let i = 0; i < 4; i++) mt_monster(A, 'watchman', town, 1);
    mt_monster(A, 'watch captain', town, 1);
}

// ============================================================
// minetn-2 — "Town Square".
// ============================================================
export async function makemaz_minetown2() {
    return mt_build(31, async (A, town, align) => {
        mt_feature(town, 17, 5, FOUNTAIN);
        mt_feature(town, 13, 8, FOUNTAIN);

        // Nine percent(75)-gated gnome homes around the square.  The rn2(100)
        // of the gate is drawn first; only when it passes does build_room's
        // own rn2(100) follow.
        let sub;
        if (percent(75)) {
            sub = mt_subroom(A, town, 2, 0, 2, 2, 'ordinary', -1);
            mt_door(sub, 'closed', 'west');
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 5, 0, 2, 2, 'ordinary', 0);
            mt_door(sub, 'closed', 'south');
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 8, 0, 2, 2, 'ordinary', -1);
            mt_door(sub, 'closed', 'east');
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 16, 0, 2, 2, 'ordinary', 1);
            mt_door(sub, 'closed', 'west');
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 19, 0, 2, 2, 'ordinary', 0);
            mt_door(sub, 'closed', 'south');
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 22, 0, 2, 2, 'ordinary', -1);
            mt_door(sub, 'closed', 'south');
            mt_monster(A, 'gnome', sub);
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 25, 0, 2, 2, 'ordinary', 0);
            mt_door(sub, 'closed', 'east');
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 2, 5, 2, 2, 'ordinary', 1);
            mt_door(sub, 'closed', 'north');
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 5, 5, 2, 2, 'ordinary', 1);
            mt_door(sub, 'closed', 'south');
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 8, 5, 2, 2, 'ordinary', -1);
            mt_door(sub, 'locked', 'north');
            mt_monster(A, 'gnome', sub);
            if (sub) add_doors_to_room(sub);
        }

        sub = mt_subroom(A, town, 2, 10, 4, 3, 'shop', 1, 90);
        mt_door(sub, 'closed', 'west');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 23, 10, 4, 3, 'tool shop', 1, 90);
        mt_door(sub, 'closed', 'east');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 24, 5, 3, 4, mt_monkfoodshop(), 1, 90);
        mt_door(sub, 'closed', 'north');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 11, 10, 4, 3, 'candle shop', 1);
        mt_door(sub, 'closed', 'east');
        if (sub) add_doors_to_room(sub);

        if (percent(75)) {
            sub = mt_subroom(A, town, 7, 10, 3, 3, 'ordinary', 0);
            mt_door(sub, 'locked', 'north');
            mt_monster(A, 'gnome', sub);
            if (sub) add_doors_to_room(sub);
        }

        sub = mt_subroom(A, town, 19, 5, 4, 4, 'temple', 1);
        mt_door(sub, 'closed', 'north');
        await mt_altar(A, sub, 2, 2, align[0]);
        mt_monster(A, 'gnomish wizard', sub);
        mt_monster(A, 'gnomish wizard', sub);
        if (sub) add_doors_to_room(sub);

        if (percent(75)) {
            sub = mt_subroom(A, town, 18, 10, 4, 3, 'ordinary', 1);
            mt_door(sub, 'locked', 'west');
            mt_monster(A, 'gnome lord', sub);
            if (sub) add_doors_to_room(sub);
        }

        mt_town_watch(A, town);
    });
}

// ============================================================
// minetn-3 — "Alley Town".  None of its subrooms are percent()-gated.
// ============================================================
export async function makemaz_minetown3() {
    return mt_build(31, async (A, town, align) => {
        mt_feature(town, 1, 6, FOUNTAIN);
        mt_feature(town, 29, 13, FOUNTAIN);

        let sub;
        sub = mt_subroom(A, town, 2, 2, 2, 2, 'ordinary', -1);
        mt_door(sub, 'closed', 'south');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 5, 3, 2, 3, 'tool shop', 1, 30);
        mt_door(sub, 'closed', 'south');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 2, 10, 2, 3, 'ordinary', -1);
        mt_door(sub, 'locked', 'north');
        mt_monster_class(A, 'G', sub);
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 5, 9, 2, 2, 'ordinary', -1);
        mt_door(sub, 'closed', 'north');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 10, 2, 3, 4, 'temple', 1);
        mt_door(sub, 'closed', 'east');
        await mt_altar(A, sub, 1, 1, align[0]);
        mt_monster(A, 'gnomish wizard', sub);
        mt_monster(A, 'gnomish wizard', sub);
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 11, 7, 2, 2, 'ordinary', -1);
        mt_door(sub, 'closed', 'west');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 10, 10, 3, 3, 'shop', 1);
        mt_door(sub, 'closed', 'west');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 14, 8, 2, 2, 'ordinary', -1);
        mt_door(sub, 'locked', 'north');
        mt_monster_class(A, 'G', sub);
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 14, 11, 2, 2, 'ordinary', -1);
        mt_door(sub, 'closed', 'south');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 17, 10, 3, 3, 'tool shop', 1, 40);
        mt_door(sub, 'closed', 'north');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 21, 11, 2, 2, 'ordinary', -1);
        mt_door(sub, 'locked', 'east');
        mt_monster_class(A, 'G', sub);
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 26, 8, 3, 2, mt_monkfoodshop(), 1, 90);
        mt_door(sub, 'closed', 'west');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 16, 2, 2, 2, 'ordinary', -1);
        mt_door(sub, 'closed', 'west');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 19, 2, 2, 2, 'ordinary', -1);
        mt_door(sub, 'closed', 'north');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 19, 5, 3, 2, 'wand shop', 1, 30);
        mt_door(sub, 'closed', 'west');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 25, 2, 3, 3, 'candle shop', 1);
        mt_door(sub, 'closed', 'south');
        if (sub) add_doors_to_room(sub);

        mt_town_watch(A, town);
    });
}

// ============================================================
// minetn-7 — "Bazaar Town".
// ============================================================
export async function makemaz_minetown7() {
    return mt_build(30, async (A, town, align) => {
        mt_feature(town, 12, 7, FOUNTAIN);
        mt_feature(town, 11, 13, FOUNTAIN);

        let sub;
        if (percent(75)) {
            sub = mt_subroom(A, town, 2, 2, 4, 2, 'ordinary', -1);
            mt_door(sub, 'closed', 'south');
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 7, 2, 2, 2, 'ordinary', -1);
            mt_door(sub, 'closed', 'north');
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 7, 5, 2, 2, 'ordinary', -1);
            mt_door(sub, 'closed', 'south');
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            // NOTE the order: the monkeys come BEFORE the door here.
            sub = mt_subroom(A, town, 10, 2, 3, 4, 'ordinary', 1);
            mt_monster(A, 'gnome', sub);
            mt_monster(A, 'monkey', sub);
            mt_monster(A, 'monkey', sub);
            mt_monster(A, 'monkey', sub);
            mt_door(sub, 'closed', 'south');
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 14, 2, 4, 2, 'ordinary', -1);
            mt_door(sub, 'closed', 'south', 0);      // explicit pos=0
            mt_monster_class(A, 'n', sub);
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 16, 5, 2, 2, 'ordinary', -1);
            mt_door(sub, 'closed', 'south');
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 19, 2, 2, 2, 'ordinary', 0);
            mt_door(sub, 'locked', 'east');
            mt_monster(A, 'gnome king', sub);
            if (sub) add_doors_to_room(sub);
        }

        sub = mt_subroom(A, town, 19, 5, 2, 3, mt_monkfoodshop(), 1, 50);
        mt_door(sub, 'closed', 'south');
        if (sub) add_doors_to_room(sub);

        if (percent(75)) {
            sub = mt_subroom(A, town, 2, 7, 2, 2, 'ordinary', -1);
            mt_door(sub, 'closed', 'east');
            if (sub) add_doors_to_room(sub);
        }

        sub = mt_subroom(A, town, 2, 10, 2, 3, 'tool shop', 1, 50);
        mt_door(sub, 'closed', 'south');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 5, 10, 3, 3, 'candle shop', 1);
        mt_door(sub, 'closed', 'north');
        if (sub) add_doors_to_room(sub);

        if (percent(75)) {
            sub = mt_subroom(A, town, 11, 10, 2, 2, 'ordinary', -1);
            mt_door(sub, 'locked', 'west');
            mt_monster_class(A, 'G', sub);
            if (sub) add_doors_to_room(sub);
        }

        sub = mt_subroom(A, town, 14, 10, 2, 3, 'shop', 1, 60);
        mt_door(sub, 'closed', 'north');
        if (sub) add_doors_to_room(sub);

        if (percent(75)) {
            sub = mt_subroom(A, town, 17, 11, 4, 2, 'ordinary', -1);
            mt_door(sub, 'closed', 'north');
            if (sub) add_doors_to_room(sub);
        }
        if (percent(75)) {
            sub = mt_subroom(A, town, 22, 11, 2, 2, 'ordinary', -1);
            mt_door(sub, 'closed', 'south');
            mt_feature(sub, 0, 0, SINK);
            if (sub) add_doors_to_room(sub);
        }

        sub = mt_subroom(A, town, 25, 11, 3, 2, mt_monkfoodshop(), 1, 50);
        mt_door(sub, 'closed', 'east');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 25, 2, 3, 3, 'tool shop', 1, 30);
        mt_door(sub, 'closed', 'west');
        if (sub) add_doors_to_room(sub);

        sub = mt_subroom(A, town, 24, 6, 4, 4, 'temple', 1);
        mt_door(sub, 'closed', 'west');
        await mt_altar(A, sub, 2, 1, align[0]);
        mt_monster(A, 'gnomish wizard', sub);
        mt_monster(A, 'gnomish wizard', sub);
        if (sub) add_doors_to_room(sub);

        mt_town_watch(A, town);
        mt_monster(A, 'gnome', town);
        mt_monster(A, 'gnome', town);
        mt_monster(A, 'gnome', town);
        mt_monster(A, 'gnome lord', town);
        mt_monster(A, 'monkey', town);
        mt_monster(A, 'monkey', town);
    });
}
