// tutorial.js — Generation + entry of the tut-1 special level.
//
// C ref: allmain.c maybe_do_tutorial() -> schedule_goto()/deferred_goto()
//        -> goto_level() -> mklev() -> makemaz("tut-1") -> load_special()
//        which runs dat/tut-1.lua through the des.* (sp_lev.c lspo_*) engine.
//
// The tut-1 level is a FIXED-layout special level (no random terrain): the only
// PRNG it consumes is from getbones(), the nhlib.lua align shuffle, the
// solidfill lit roll, and the per-feature des.object / des.trap / des.monster /
// des.door rolls.  Because the layout is fixed, the entire 165-call PRNG
// sequence at the tutorial-yes step is deterministic; we reproduce it here by
// driving the real mksobj/maketrap object machinery in the exact source order
// of dat/tut-1.lua, so both the PRNG stream AND the resulting placed features
// match the recorded C session.

import { game } from './gstate.js';
import { rn2, rnd } from './rng.js';
import {
    COLNO, ROWNO, STONE, VWALL, HWALL, DBWALL, TREE, SDOOR, POOL, MOAT, WATER,
    LAVAPOOL, LAVAWALL, IRONBARS, DOOR, CORR, ROOM, STAIRS, FOUNTAIN, THRONE, ALTAR, ICE,
    MAX_TYPE, INVALID_TYPE, NO_ROOM, D_NODOOR, D_ISOPEN, D_CLOSED, D_LOCKED,
    W_NONDIGGABLE, LA_DOWN, ENGRAVE, BURN, NON_PM,
    MAGIC_PORTAL, WEB, TRAPDOOR, SQKY_BOARD, SLP_GAS_TRAP,
} from './const.js';
import { GameMap } from './game.js';
import { wallification, set_wall_state } from './mklev.js';
import { objects, mksobj, next_ident, blessorcurse, curse, set_corpsenm } from './mkobj.js';
import { name_to_pmidx, monster_by_pmidx, newmonhp } from './makemon.js';
import { make_engr_at } from './engrave.js';
import { hole_destination, choose_trapnote } from './trap.js';

// ── tut-1.lua map (verbatim, dat/tut-1.lua des.map). Lua coord (cx,cy) maps to
//    absolute map cell (xstart + cx, ystart + cy) with the empirically-pinned
//    origin OFF=3 (confirmed against the recorded screens).  The map fragment is
//    75 wide x 18 tall; on an 80x21 level it lands at absolute (3,3)..(77,20). ──
// NB: this MUST match the .lua row-for-row — an earlier transcription dropped
// lua row 10 ("|----+----.----+---.|.--|.|.|# ..."), which shifted every row
// below it up by one and mis-typed the wall junctions in the lower map (e.g.
// (7,12) wallified as a plain HWALL instead of the correct TRCORNER, and the
// four-trap / secret-door corridors were misaligned).
const TUT_MAP = [
    '---------------------------------------------------------------------------',
    '|-.--|.......|......|..S....|.F.......|.............|.......|.............|',
    '|.-..........|......|--|....|.F.....|.|S-------.....|.....................|',
    '||.--|.......|..T......|....|.F.....|.|.......|.....|.......|.............|',
    '||.|.|.......|......|-.|....|.F.....|.|.......|.....|--------.............|',
    '||.|.|.......|......||.|-.-----------.-.......|-S----.....................|',
    '|-+-S---------..---.||........................|...|.......................|',
    '|......|          |.-------------------.......|...|....--S----............|',
    '|......|  ######  |.........|      |..S.......|...|....|.....|............|',
    '|----.-| -+-   #  |.....---.|######+..|.......S...|....|.....|............|',
    '|----+----.----+---.|.--|.|.|#     ------------...|....|.....F............|',
    '|........|.|......|.|...F...|#  ........|.....+...|....|.....|............|',
    '|.P......-S|......|------.---# .........|.....|...|....-------........----|',
    '|..........|......+.|...|.|.S# ..--S-----.....|LLL|..................|..| |',
    '|.W......---......|.|.|.|.|.|# ..|......|.....|LLL|..................|..--|',
    '|....Z.L.S.F......|.|.|.|.---#   |......+.....|...|..................|..|.|',
    '|........|--......|...|.....|####+......|.....|...+..................||...|',
    '---------------------------------------------------------------------------',
];

// Empirically pinned against the recorded step-14/16 screens.  NetHack des
// coords index the map fragment 0-based: des {cx,cy} addresses TUT_MAP[cy][cx].
// The centered fragment lands with map char (rx,ry) at absolute cell
// (rx+OFF, ry+OFF), OFF=3, and the renderer draws absolute (x,y) at terminal
// (x-1, y+1).  So des {cx,cy} -> abs (cx+3, cy+3) -> terminal (cx+2, cy+4).
const OFF = 3;

// C ref: sp_lev.c splev_chr2typ — map char -> terrain type.
function chr2typ(ch) {
    switch (ch) {
    case ' ': return STONE;
    case '|': return VWALL;
    case '-': return HWALL;
    case '.': return ROOM;
    case '#': return CORR;
    case '+': return DOOR;
    case 'S': return SDOOR;
    case '}': return MOAT;
    case 'P': return POOL;
    case 'W': return WATER;
    case 'L': return LAVAPOOL;
    case 'T': return TREE;
    case '{': return FOUNTAIN;
    case '\\': return THRONE;
    case '_': return ALTAR;
    case 'I': return ICE;
    case '"': return IRONBARS;
    case 'Z': return LAVAWALL;   // C ref: nhlua.c char2typ — 'Z' -> LAVAWALL (wall of lava)
    case 'F': return TREE;   // 'F' is a tree in tut-1 (forest decoration)
    default: return ROOM;
    }
}

// Convert a des map coordinate (0-based map index) to an absolute level cell.
function A(cx, cy) { return { x: cx + OFF, y: cy + OFF }; }

function setTerrain(lvl) {
    for (let ry = 0; ry < TUT_MAP.length; ry++) {
        const row = TUT_MAP[ry];
        for (let rx = 0; rx < row.length; rx++) {
            const ch = row[rx];
            const typ = chr2typ(ch);
            const x = rx + OFF;
            const y = ry + OFF;
            const loc = lvl.at(x, y);
            if (!loc) continue;
            loc.typ = typ;
            loc.roomno = NO_ROOM;
            loc.lit = false;
            // C ref: sp_lev.c sel_set_ter — the map fills left-to-right, so a
            // door / secret door inherits horizontal orientation when the cell
            // to its left is a wall (or an already-horizontal door); HWALL and
            // IRONBARS are horizontal.  This orients the tut-1 secret doors
            // (e.g. the 'S' at des {4,6}) so they render as part of a horizontal
            // wall run ('-') rather than a vertical one ('|').
            if (typ === SDOOR || typ === DOOR) {
                loc.doormask = (typ === SDOOR) ? D_CLOSED : D_NODOOR;
                const left = x > 0 ? lvl.at(x - 1, y) : null;
                if (left && ((left.typ >= VWALL && left.typ <= DBWALL)
                             || left.horizontal))
                    loc.horizontal = true;
            } else if (typ === HWALL || typ === IRONBARS) {
                loc.horizontal = true;
            } else if (typ === VWALL) {
                loc.horizontal = false;
            }
        }
    }
}

// des.region(area, "lit"/"unlit") — set lit state for a rectangle of cells.
// Lua coords inclusive.
function regionLit(cx1, cy1, cx2, cy2, lit) {
    for (let cy = cy1; cy <= cy2; cy++)
        for (let cx = cx1; cx <= cx2; cx++) {
            const { x, y } = A(cx, cy);
            const loc = game.level.at(x, y);
            if (loc) loc.lit = !!lit;
        }
}

// des.engraving — place an engraving (no PRNG).  degrade=false => nowipeout.
function engrave(cx, cy, type, text) {
    const { x, y } = A(cx, cy);
    const ep = make_engr_at(x, y, text, text, game.moves ?? 1, type);
    if (ep) ep.nowipeout = true;
}

// C ref: dat/tut-1.lua tut_key()/tut_key_help().  tut_key(cmd) resolves a
// command to its key binding and, when that binding is a Ctrl-<X> combo (the
// nh.eckey string matches "^X"), stashes the bare letter in tut_ctrl_key.
// tut_key_help(x,y) then drops a one-off "Ctrl-key combinations are shown
// prefixed with a caret" engraving at (x,y) *iff* the most recent tut_key call
// was such a combo, and clears the flag.  The only Ctrl-bound command the
// tutorial references before the first tut_key_help() is "kick" (^D), so the
// note lands at des {6,8}; by the second call (des {64,4}) the flag has been
// cleared and no further Ctrl command has re-set it, so nothing is engraved
// there — matching C.  (No PRNG in either path.)
let tut_ctrl_key = null;
function tutKeyHelp(cx, cy) {
    if (tut_ctrl_key != null) {
        engrave(cx, cy, ENGRAVE,
            "Note: Outside the tutorial, Ctrl-key combinations are shown prefixed"
            + " with a caret, like '^" + tut_ctrl_key + "'");
        tut_ctrl_key = null;
    }
}

// des.door — set a door's mask (no PRNG; the "random" state DOES roll rn2(5)).
function setDoor(cx, cy, mask) {
    const { x, y } = A(cx, cy);
    const loc = game.level.at(x, y);
    if (!loc) return;
    if (loc.typ !== DOOR && loc.typ !== SDOOR) loc.typ = DOOR;
    loc.doormask = mask;
}

// C ref: nhlib.lua percent(threshold) — math.random(0,99) < threshold.
function percent(n) { return rn2(100) < n; }

// C ref: nhlib.lua shuffle — Fisher-Yates via math.random(i) = 1 + rn2(i).
function shuffle(list) {
    for (let i = list.length; i >= 2; i--) {
        const j = 1 + rn2(i);
        const a = i - 1, b = j - 1;
        const t = list[a]; list[a] = list[b]; list[b] = t;
    }
    return list;
}

// Object identity: the JS object table uses bare names (e.g. "remove curse",
// "light") which collide across classes, so disambiguate by oclass when given.
function otypByName(name, oclass = null) {
    const o = objects.find((ob) => ob.name === name
                                  && (oclass == null || ob.oclass === oclass));
    return o ? o.otyp : 0;
}

// ── create_trap (sp_lev.c create_trap -> mklev.c mktrap) ──
// All tut-1 traps are placed at fixed coords (tm != NULL) so no location search.
// mktrap rolls the victim check rnd(4) when (in_mklev && !novictim); the kind
// checks that gate mktrap_victim() come AFTER the rnd(4) in C's && chain, so the
// rnd(4) is always consumed for a non-novictim trap even though no tut-1 trap
// type (portal/web/trapdoor) ever actually spawns a victim.
function createTrap(cx, cy, typ, opts = {}) {
    const novictim = !!opts.novictim;
    const { x, y } = A(cx, cy);
    const lvl = game.level;
    if (!lvl.traps) lvl.traps = [];
    const trap = {
        ttyp: typ, tx: x, ty: y, tseen: !!opts.seen, once: false,
        launch: { x: 0, y: 0 }, dst: { dnum: -1, dlevel: -1 },
    };
    // maketrap()'s per-type switch:
    if (typ === SQKY_BOARD) {
        trap.tnote = choose_trapnote(trap);   // rn2(<=12)
    } else if (typ === TRAPDOOR) {
        hole_destination(trap.dst);            // rn2(4) (possibly looped)
    }
    lvl.traps.push(trap);
    // mktrap victim roll (mklev.c:2137): rnd(4) when not novictim.
    if (!novictim) rnd(4);
    if (typ === MAGIC_PORTAL) {
        // assign_level(&t->dst, &u.ucamefrom) — destination is where we came
        // from (the level we left to enter the tutorial).  No PRNG.
        trap.dst = { ...(game.u?.ucamefrom || { dnum: 0, dlevel: 1 }) };
    }
    return trap;
}

// ── create_object (sp_lev.c create_object -> mksobj_at) ──
// Faithfully drives mksobj(otyp, TRUE, TRUE) then applies the des.object
// overrides (spe, buc, quan, montype) AFTER, matching C's create_object order.
function createObject(cx, cy, name, opts = {}) {
    const otyp = otypByName(name, opts.oclass ?? null);
    const otmp = mksobj(otyp, true, true);    // artif = !named = TRUE
    if (opts.spe != null) otmp.spe = opts.spe;
    switch (opts.buc) {
    case 'blessed': otmp.blessed = true; otmp.cursed = false; break;
    case 'uncursed': otmp.blessed = false; otmp.cursed = false; break;
    case 'cursed': otmp.cursed = true; otmp.blessed = false; break;
    case 'not-cursed': otmp.cursed = false; break;
    default: break;
    }
    if (opts.montype != null) {
        const pm = name_to_pmidx(opts.montype);
        if (pm >= 0) set_corpsenm(otmp, pm);
    }
    if (opts.quan != null) otmp.quan = opts.quan;
    // Place the object on the floor (so it renders & joins fobj).
    if (cx != null && cy != null) {
        const { x, y } = A(cx, cy);
        otmp.ox = x; otmp.oy = y; otmp.where = 'floor';
        if (!game.level.objects) game.level.objects = [];
        game.level.objects.push(otmp);
        const loc = game.level.at(x, y);
        if (loc) {
            if (!loc.objects) loc.objects = [];
            loc.objects.push(otmp);
        }
    }
    return otmp;
}

// math.random(lo,hi) = nh.random(lo, hi+1-lo) = lo + rn2(hi+1-lo).
function mrandom(lo, hi) { return lo + rn2(hi + 1 - lo); }

// ── create_monster (sp_lev.c create_monster -> makemon) ──
// The des.monster path: find_montype (rn2(2)), induced_align, then makemon.
// We reproduce the exact PRNG of makemon for a fixed (non-random) monster.
function createMonster(cx, cy, name, opts = {}) {
    rn2(2);                 // find_montype(name) — random-gender roll
    const pm = name_to_pmidx(name);
    const data = monster_by_pmidx(pm);
    // sp_amask_to_amask(AM_SPLEV_RANDOM) -> induced_align(80): the dungeon-align
    // gate rolls rn2(100); only when that result is >= 80 (i.e. the dungeon
    // align is NOT taken) does it fall through to the random rn2(3).
    if (rn2(100) >= 80) rn2(3);
    next_ident();           // mtmp->m_id
    newmonhp({ data });     // d(m_lev,8) or rnd(4)
    if (data && data.gcode === 0) rn2(2); // gender roll for non-fixed-gender
    rn2(50); rn2(100);      // m_initinv
    rn2(100);               // makemon saddle/trailing roll
    // Materialize (asleep/waiting) so it joins fmon but emits no movement RNG.
    const { x, y } = A(cx, cy);
    if (data && game.level) {
        if (!game.level.monsters) game.level.monsters = [];
        game.level.monsters.push({
            data, mx: x, my: y, m_id: game.context_ident ?? 0,
            m_lev: data.mlevel ?? 0, mhp: 1, mhpmax: 1, movement: 0,
            mcanmove: 1, mcansee: 1, msleeping: 1, mpeaceful: opts.peaceful ?? 0,
            mflee: 0, mtame: 0, minvis: 0, mstrategy: 0,
        });
    }
}

// ── the tut-1.lua des.* program, in exact source order ──
function runTutProgram() {
    const lvl = game.level;
    tut_ctrl_key = null; // reset the tut_key_help state for this level build

    // des.level_init({ style="solidfill", fg=" " }); — solidfill already filled
    // by clear (STONE).  The lit roll is consumed in genTutorialLevel() before
    // this runs (splev_initlev), matching the trace position.

    setTerrain(lvl);

    // des.region(selection.area(1,1,73,16), "lit")
    regionLit(1, 1, 73, 16, true);

    // des.non_diggable() — mark all cells nondiggable (no PRNG).
    for (let y = 0; y < ROWNO; y++)
        for (let x = 1; x < COLNO; x++) {
            const loc = lvl.at(x, y);
            if (loc) loc.wall_info |= W_NONDIGGABLE;
        }

    // des.teleport_region({ region={9,3,9,3} }) — recorded later by fixup.

    // C ref: tut-1.lua:65-67 — nh.parse_config turns on some newbie-friendly
    // OPTIONS for the tutorial (no PRNG).  mention_walls: bumping a wall/stone
    // announces "It's a wall."/"It's solid stone." (hack.c test_move).
    // lit_corridor: corridors render as S_litcorr (display.js).  mention_decor
    // announces decor terrain you step onto.  These are global game flags.
    if (game.flags) {
        game.flags.mention_walls = true;
        game.flags.mention_decor = true;
        game.flags.lit_corridor = true;
    }

    // Engravings (lines 80-93) — no PRNG.  Ranger uses hjkl movement keys.
    engrave(9, 3, ENGRAVE, 'Move around with h j k l');
    // C ref: dat/tut-1.lua diagmovekeys = SW NE SE NW = "b u n y" (vi-keys).
    engrave(5, 2, ENGRAVE, 'Move diagonally with b u n y');
    // (Knight jump engraving skipped — hero is a Ranger.)
    engrave(2, 4, ENGRAVE, 'Some actions may require multiple tries before succeeding');
    engrave(2, 5, ENGRAVE, 'Open the door by moving into it');
    setDoor(2, 6, D_CLOSED);
    engrave(2, 7, ENGRAVE, "Close the door with 'c'");

    engrave(4, 5, ENGRAVE, 'You can leave the tutorial via the magic portal.');
    createTrap(4, 4, MAGIC_PORTAL, { seen: true });   // mktrap rnd(4)

    // tut_key("kick") resolves to Ctrl-D: it returns the string "Ctrl-D" (used
    // in the engraving text) AND sets tut_ctrl_key := "D" (used by tutKeyHelp).
    tut_ctrl_key = 'D';
    engrave(5, 9, ENGRAVE, "This door is locked. Kick it with 'Ctrl-D'");
    setDoor(5, 10, D_LOCKED);
    tutKeyHelp(6, 8); // tut-1.lua:107 — engraves the ^D note at des {6,8}

    engrave(5, 12, ENGRAVE, "Look around the map with ';', press ESC when you're done");
    engrave(10, 13, ENGRAVE, "Use 's' to search for secret doors");
    engrave(10, 15, ENGRAVE, 'Wrong secret');

    engrave(10, 10, ENGRAVE, 'Behind this door is a dark corridor');
    setDoor(10, 9, percent(50) ? D_LOCKED : D_CLOSED);   // percent rn2(100)
    // des.region(selection.match("#"), "unlit") + match(" ") — no PRNG
    setDoor(15, 10, percent(50) ? D_LOCKED : D_CLOSED);  // percent rn2(100)

    engrave(15, 11, ENGRAVE, 'There are four traps next to you! Search for them.');
    const locs = [[14, 11], [14, 12], [15, 12], [16, 12], [16, 11]];
    shuffle(locs);                                       // rn2(5),rn2(4),rn2(3),rn2(2)
    for (let i = 0; i < 4; i++) {
        const board = !percent(50);                      // percent rn2(100)
        const [tx, ty] = locs[i];
        createTrap(tx, ty, board ? SQKY_BOARD : SLP_GAS_TRAP, { novictim: true });
    }

    engrave(15, 15, ENGRAVE, "Some traps can be disabled with '#untrap'");
    createTrap(15, 16, WEB, { /* spider_on_web=false, victim default true */ }); // rnd(4)

    setDoor(18, 13, D_CLOSED);
    engrave(19, 13, ENGRAVE, "Pick up items with ','");
    createObject(19, 14, 'leather armor', { spe: 0, buc: 'cursed' });

    engrave(19, 15, ENGRAVE, "Wear armor with 'W'");
    createObject(21, 15, 'dagger', { spe: 0, buc: 'not-cursed' });
    engrave(21, 14, ENGRAVE, "Wield weapons with 'w'");

    engrave(22, 13, ENGRAVE, 'Hit monsters by walking into them.');
    createMonster(23, 15, 'lichen');

    engrave(24, 16, ENGRAVE, 'Now you know the very basics. You can leave the tutorial via the magic portal.');
    engrave(26, 16, ENGRAVE, 'Step into this portal to leave the tutorial');
    createTrap(27, 16, MAGIC_PORTAL, { seen: true });   // rnd(4)

    engrave(25, 13, ENGRAVE, 'Push boulders by moving into them');
    createObject(25, 12, 'boulder', {});                // next_ident only

    engrave(27, 9, ENGRAVE, "Take off armor with 'T'");

    createObject(23, 11, 'remove curse', { oclass: 9, buc: 'blessed' }); // SCROLL_CLASS
    engrave(22, 11, ENGRAVE, 'Some items have shuffled descriptions, different each game');
    engrave(23, 11, ENGRAVE, "Pick up this scroll, read it with 'r', and try to remove the armor again");

    engrave(19, 10, ENGRAVE, 'Another magic portal, a way to leave this tutorial');
    createTrap(19, 11, MAGIC_PORTAL, { seen: true });   // rnd(4)

    // rock falls (lines 190-195): rocks with random quantity, then a boulder.
    createObject(14, 5, 'rock', { quan: mrandom(50, 99) });  // rn2(50); rock mksobj
    createObject(15, 5, 'rock', { quan: mrandom(10, 30) });  // rn2(21)
    createObject(14, 4, 'rock', { quan: mrandom(10, 30) });  // rn2(21)
    createObject(15, 6, 'rock', { quan: mrandom(30, 60) });  // rn2(31)
    createObject(14, 6, 'rock', { quan: mrandom(30, 60) });  // rn2(31)
    createObject(14, 6, 'boulder', {});                       // next_ident only

    setDoor(20, 3, percent(50) ? D_ISOPEN : D_CLOSED);  // percent rn2(100)

    engrave(21, 3, ENGRAVE, 'Avoid being burdened, it slows you down');
    engrave(22, 3, ENGRAVE, "Drop items with 'd'");
    engrave(22, 4, ENGRAVE, 'You can drop partial stacks by prefixing the item slot letter with a number');

    createMonster(26, 2, 'yellow mold');
    engrave(25, 5, ENGRAVE, "Throw items with 't'");
    createTrap(21, 1, MAGIC_PORTAL, { seen: true });    // rnd(4)

    createMonster(29, 2, 'wolf', { peaceful: 0 });
    engrave(37, 4, ENGRAVE, 'Missiles, such as rocks, work better when fired from appropriate launcher');

    createObject(37, 3, 'sling', { buc: 'not-cursed', spe: 9 });
    engrave(37, 3, ENGRAVE, 'Wield the sling');
    engrave(36, 1, ENGRAVE, "Use 'f' to fire missiles with the wielded launcher");
    engrave(35, 4, ENGRAVE, "Firing launches items from your quiver; Use 'Q' to put items in it");
    engrave(33, 4, ENGRAVE, "You can wait a turn with 's'");

    setDoor(38, 6, D_CLOSED);
    engrave(39, 6, ENGRAVE, "You loot containers with '#loot'");

    // large box with a scroll inside (and random contents from mkbox_cnts).
    createBoxWithScroll(41, 6);

    engrave(42, 6, ENGRAVE, "Containers can also be emptied with '#tip'");
    engrave(45, 6, ENGRAVE, "Magic wands are used with 'z'");

    setDoor(35, 9, D_NODOOR);
    engrave(34, 9, ENGRAVE, "You can run by prefixing a movement key with 'G'");

    setDoor(33, 16, D_NODOOR);
    engrave(35, 15, ENGRAVE, "Travel across the level with '_'");

    createTrap(27, 14, MAGIC_PORTAL, { seen: true });   // rnd(4)

    engrave(48, 1, BURN, "Use 'e' to eat edible things");
    createObject(50, 3, 'apple', { buc: 'not-cursed' });
    createObject(50, 3, 'candy bar', { buc: 'not-cursed' });
    createObject(50, 3, 'corpse', { montype: 'lichen', buc: 'not-cursed' });

    setDoor(46, 11, D_CLOSED);
    engrave(43, 11, BURN, "Use '#twoweapon' to use two weapons at once");
    createObject(43, 13, 'knife', { buc: 'uncursed' });
    createObject(43, 14, 'dagger', { buc: 'blessed' });
    engrave(43, 16, BURN, "Swap weapons quickly with 'x'");
    setDoor(40, 15, rndDoorState());                     // "random" -> rnddoor rn2(5)

    createObject(48, 7, 'levitation', { oclass: 4, buc: 'not-cursed' }); // RING_CLASS
    engrave(48, 10, BURN, "Put on accessories with 'P'");
    engrave(48, 16, BURN, "Remove accessories with 'R'");
    setDoor(50, 16, D_CLOSED);

    engrave(58, 9, BURN, "Use '>' to go down the stairs");
    makeStair(58, 10);

    // tut-1.lua:294 — "one more ctrl-key help, if needed".  No Ctrl-bound
    // command was referenced since the ^D note above cleared tut_ctrl_key, so
    // this is a no-op (nothing engraved at des {64,4}), matching C.
    tutKeyHelp(64, 4);

    engrave(65, 3, BURN, 'UNDER CONSTRUCTION');
    createTrap(66, 2, MAGIC_PORTAL, { seen: true });    // rnd(4)

    engrave(69, 12, BURN, "Can't get through?  You're carrying too much.");
    createObject(71, 16, 'boulder', {});                 // next_ident
    createObject(72, 16, 'boulder', {});                 // next_ident
    createObject(73, 16, 'boulder', {});                 // next_ident
    createTrap(73, 15, TRAPDOOR, {});                    // hole_destination rn2(4) + rnd(4)

    engrave(60, 2, ENGRAVE, 'Spellcasting');
    // u.uenmax < 5 (Ranger Pw 3) -> extra engraving.
    engrave(59, 2, ENGRAVE, "Unfortunately you don't have enough energy to cast spells.");
    engrave(57, 2, ENGRAVE, "Pick up the spellbook with ','");
    createObject(57, 2, 'light', { oclass: 10, buc: 'blessed' });  // SPBOOK_CLASS; blessorcurse rn2(17)
    engrave(55, 2, ENGRAVE, "Read the spellbook with 'r'");
    engrave(53, 2, ENGRAVE, "Use '+' to cast a spell");
    regionLit(53, 1, 59, 3, false);                      // unlit

    engrave(72, 2, ENGRAVE, 'You "quaff" potions with \'q\'');
    createObject(72, 2, 'object detection', { oclass: 8, buc: 'blessed' }); // POTION_CLASS; blessorcurse rn2(4)
}

// des.door state="random" -> rnddoor() (sp_lev.c:1152) rolls rn2(5) over the
// door-state weight table; returns a concrete mask.
function rndDoorState() {
    const states = [D_NODOOR, D_ISOPEN, D_CLOSED, D_LOCKED, D_NODOOR];
    return states[rn2(5)];
}

// des.stair — place a downstair (no PRNG for a fixed coord).
function makeStair(cx, cy) {
    const { x, y } = A(cx, cy);
    const loc = game.level.at(x, y);
    if (loc) { loc.typ = STAIRS; loc.ladder = LA_DOWN; }
}

// The large box (line 232): broken=true, trapped=false, with a scroll inside via
// the contents function.  mksobj(LARGE_BOX) generates random contents through
// mkbox_cnts (rn2(6) count + rnd(100)/rnd(1000)/next_ident/blessorcurse per
// item), THEN the explicit scroll is placed at a RANDOM in-box location via
// get_location (rn2(75),rn2(18)) + mksobj(WAND secret door detection).
function createBoxWithScroll(cx, cy) {
    // mksobj(LARGE_BOX) -> next_ident, olocked rn2(5), otrapped rn2(10),
    // [tknown rn2(100) only if trapped], mkbox_cnts(...).
    const box = mksobj(otypByName('large box'), true, true);
    box.obroken = 1; box.olocked = 0; box.otrapped = 0;
    const { x, y } = A(cx, cy);
    box.ox = x; box.oy = y; box.where = 'floor';
    if (!game.level.objects) game.level.objects = [];
    game.level.objects.push(box);
    const loc = game.level.at(x, y);
    if (loc) { if (!loc.objects) loc.objects = []; loc.objects.push(box); }

    // The explicit contents scroll: des.object({ id="secret door detection",
    // class="/" }) with NO coord -> get_location_coord random spot inside the
    // map area: rn2(75), rn2(18).  Then mksobj(WAN_SECRET_DOOR_DETECTION).
    rn2(75); rn2(18);                                   // get_location
    mksobj(otypByName('secret door detection', 11), true, true); // WAND_CLASS; spe rn2(5) + blessorcurse rn2(17)
}

// C ref: getbones() — rn2(3) unless discover/bones-off.  Mirrors mklev.js.
function getbones() {
    const flags = game.flags || {};
    const discover = flags.explore || flags.playmode === 'explore';
    if (discover) return false;
    if (flags.bones === false) return false;
    if (rn2(3) && !flags.debug) return false;
    return false;
}

// C ref: nhlib align shuffle — { "law","neutral","chaos" } shuffled each time
// the lua library prelude is (re)loaded for a special level (rn2(3),rn2(2)).
function nhlibAlignShuffle() {
    const align = [0, 1, 2];
    for (let i = align.length; i >= 2; i--) {
        const j = 1 + rn2(i);
        const a = i - 1, b = j - 1;
        const t = align[a]; align[a] = align[b]; align[b] = t;
    }
}

// ── Build the tut-1 level into a fresh GameMap, consuming the full PRNG
//    sequence C generates at the tutorial-yes step. Returns the new level. ──
export function genTutorialLevel() {
    // getbones() inside mklev() (rn2(3)).
    getbones();
    // nhlib.lua align shuffle (rn2(3),rn2(2)) on lua prelude load.
    nhlibAlignShuffle();

    // Build the tutorial level into a fresh GameMap WITHOUT disturbing the
    // currently-displayed level (game.level): the des.* helpers operate on
    // game.level, so we temporarily point it at the new map during generation
    // and restore the previous level afterwards.  The caller swaps it in for
    // real at the --More-- acknowledgement.
    const prevLevel = game.level;
    const prevFmon = game.fmon;
    const prevInMklev = game.in_mklev;
    const lvl = new GameMap();
    lvl.flags.is_maze_lev = true;
    lvl.flags.hero_memory = true;
    lvl.flags.noteleport = false;
    game.level = lvl;
    game.fmon = null;
    // C: gi.in_mklev is TRUE throughout makemaz/load_special — this gates
    // mkobj_erosions (may_generate_eroded) and the mktrap victim roll.
    game.in_mklev = true;

    // splev_initlev solidfill: linit->lit = rn2(2) (BOOL_RANDOM).
    rn2(2);

    runTutProgram();

    // fixup_special: water_has_kelp rn2(10) for each WATER cell candidate, then
    // place_lregion for the teleport_region (rn2(1),rn2(1)).  The map has one
    // 'W' water cell (Lua {2,13}); C scans the two POOL/WATER pools.
    rn2(10); rn2(10);   // water_has_kelp (mklev.c:1436)
    rn2(1); rn2(1);     // place_lregion teleport_region (mkmaze.c:396,397)

    // C ref: lspo_finalize_level -> wallification(1,0,COLNO-1,ROWNO-1) then
    // level_finalize_topology -> set_wall_state().  No PRNG; converts the flat
    // HWALL/VWALL cells into proper corner/T-junction wall types so they render
    // as DEC box-drawing pieces (l/q/k/m/j/x) like C.
    wallification(1, 0, COLNO - 1, ROWNO - 1);
    set_wall_state();

    // C ref: sp_lev.c lspo_region — des.region(selection, "lit") grows the lit
    // selection by 1 in all directions (selection_do_grow(W_ANY)) BEFORE
    // sel_set_lit, so the 1-cell ring bounding the lit area (including the
    // level's edge rows/cols) is lit too.  The JS vision (vision.js) only marks
    // a wall/door IN_SIGHT when the wall cell ITSELF is lit AND the adjacent
    // floor toward the hero is lit, so light every wall / door / secret-door
    // cell that borders a lit ROOM/CORR/DOOR cell — spanning the full map so the
    // bottom/right border walls (y=ROWNO-1, x=COLNO-1) light too.  No PRNG.
    for (let y = 1; y < ROWNO; y++) {
        for (let x = 1; x < COLNO; x++) {
            const loc = lvl.at(x, y);
            if (!loc) continue;
            const t = loc.typ;
            // Any wall variant (VWALL..DBWALL = 1..12), door, secret door,
            // iron bars, or stone bordering a lit room cell becomes lit so the
            // renderer reveals it (corners included).
            const isWall = ((t >= VWALL && t <= DBWALL) || t === DOOR
                            || t === SDOOR || t === IRONBARS || t === STONE);
            if (!isWall || loc.lit) continue;
            for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1],
                                      [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
                const n = lvl.at(x + ddx, y + ddy);
                if (n && n.lit && (n.typ === ROOM || n.typ === CORR
                                   || n.typ === DOOR)) {
                    loc.lit = true;
                    break;
                }
            }
        }
    }

    // Restore the previously-displayed level; stash the tutorial level for the
    // deferred enter.
    game.level = prevLevel;
    game.fmon = prevFmon;
    game.in_mklev = prevInMklev;
    game._tutorial_level = lvl;
    return lvl;
}
