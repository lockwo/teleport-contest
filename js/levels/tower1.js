// levels/tower1.js - special level builder makemaz_tower1(), split out of js/sp_lev.js.
// sp_lev.js re-exports makemaz_tower1 so existing importers are unaffected; the
// shared special-level machinery still lives there and is imported below.

import { COLNO, ROWNO } from '../const.js';
import { game } from '../gstate.js';
import {
    enexto_spawn, makemon, mkclass, mm_mon_at, monster_by_pmidx, newcham_vamp,
} from '../makemon.js';
import { CHEST, TALLOW_CANDLE, WAX_CANDLE, mksobj, mksobj_at } from '../mkobj.js';
import { rn2 } from '../rng.js';
import {
    S_VAMPIRE_CLASS, bigrm_get_location_dry, flip_level, q_absx, q_absy, quest_create_monster,
    quest_create_object, quest_level_init_solidfill, quest_set_door, shuffle, tower1_load_map,
    tower_place_ladder, tower_wallification,
} from '../sp_lev.js';

// ════════════════════════════════════════════════════════════════════════
// Vlad's Tower upper stage (dat/tower1.lua).
//
// C ref: mklev.c makelevel() -> Is_special(&u.uz) -> makemaz("tower1") ->
// load_special("tower1.lua").  Loading nhlib.lua first runs shuffle(align)
// (rn2(3), rn2(2)); then the tower1 body: level_init solidfill (rn2(2)),
// a fixed map (halign="half-left", valign="center"), shuffle(niches) over the
// six niche cells, a down-ladder, Vlad + three random vampires + three named
// vampire "ladies" (waiting -> shift back to vampire form), doors, seven chests
// (two carrying candles), non_diggable, then wallification + flip_level_rnd.
// We hand-port it calling the same RNG primitives in the same order.
// ════════════════════════════════════════════════════════════════════════

const TOWER1_MAP = [
    '  --- --- ---  ',
    '  |.| |.| |.|  ',
    '---S---S---S---',
    '|.......+.+...|',
    '---+-----.-----',
    '  |...\\.|.+.|  ',
    '---+-----.-----',
    '|.......+.+...|',
    '---S---S---S---',
    '  |.| |.| |.|  ',
    '  --- --- ---  ',
].join('\n');

// C ref: sp_lev.c create_monster for a class ("V"): amask induced_align rn2(3),
// pm = mkclass(S_VAMPIRE, G_NOGEN), get_location (explicit coord, no RNG),
// makemon.  makemon (with _tower_gen set) shifts the vampire via newcham.
const G_NOGEN_TOWER = 0x0200;

function tower_create_V(mx, my) {
    rn2(3);                                          // induced_align
    const ptr = mkclass(S_VAMPIRE_CLASS, G_NOGEN_TOWER);
    if (!ptr) return null;
    let x = q_absx(mx), y = q_absy(my);
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, ptr);
        if (cc) { x = cc.x; y = cc.y; }
    }
    return makemon(ptr, x, y, 0);
}

// C ref: sp_lev.c create_monster for { id="vampire lady", name, waiting=1 }.
// find_montype("vampire lady") -> PM_VAMPIRE_LEADER, female (no gender rn2).
// amask induced_align rn2(3); makemon (shifts via newcham); create_monster then
// sets female, christens with `name`, sets STRAT_WAITFORU and (since it shifted)
// reverts to vampire form via newcham(&mons[cham]) — mgender rn2(10)+newmonhp.
const PM_VAMPIRE_LEADER_IDX = 227;

function tower_create_vampire_lady(name, mx, my) {
    rn2(3);                                          // induced_align
    const ptr = monster_by_pmidx(PM_VAMPIRE_LEADER_IDX);
    if (!ptr) return null;
    let x = q_absx(mx), y = q_absy(my);
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, ptr);
        if (cc) { x = cc.x; y = cc.y; }
    }
    const mtmp = makemon(ptr, x, y, 0);
    if (!mtmp) return null;
    mtmp.female = 1;                                 // "lady" -> female (no RNG)
    if (name) mtmp.mname = name;                     // christen (no RNG)
    // C ref: monst.h:177 STRAT_WAITFORU — tower1.lua's waiting=1.  decide_to_
    // shapeshift() tests !(mstrategy & STRAT_WAITFORU); with STRAT_ARRIVE here
    // instead, all three vampire ladies drew an rn2(6) C never draws.
    mtmp.mstrategy = (mtmp.mstrategy || 0) | 0x20000000; /* STRAT_WAITFORU */
    // vampshifted (cham is a vampire and current form differs) -> revert.
    if (mtmp.cham === PM_VAMPIRE_LEADER_IDX
        && mtmp.data && mtmp.data.pmidx !== PM_VAMPIRE_LEADER_IDX) {
        newcham_vamp(mtmp, monster_by_pmidx(PM_VAMPIRE_LEADER_IDX));
    }
    return mtmp;
}

// C ref: des.object({ id="chest", coord, contents=function() ... end }).
// The chest is created with auto-filled contents (mkbox_cnts RNG), which are
// then discarded (SP_OBJ_CONTAINER -> delete_contents, no RNG); the contents
// callback creates one candle: math.random(4,8) [rn2(5)] for quantity, then
// create_object -> get_location DRY (rn2(xsize)/rn2(ysize)) + mksobj(candle).
function tower_content_chest(mx, my, candleType) {
    const x = q_absx(mx), y = q_absy(my);
    const chest = mksobj_at(CHEST, x, y, true, true);   // init + mkbox_cnts
    // delete_contents: drop the auto-generated contents (no RNG).
    if (chest) chest.cobj = null;
    const qty = 4 + rn2(5);                              // math.random(4,8)
    bigrm_get_location_dry();                            // get_location DRY
    const candle = mksobj(candleType, true, false);      // next_ident + init
    if (candle) candle.quan = qty;
    // add to container (no RNG); keep off the floor.
    if (chest) { if (!chest.cobj) chest.cobj = []; if (Array.isArray(chest.cobj)) chest.cobj.push(candle); }
    return chest;
}

// Main executor.  C ref: makemaz("tower1") -> load_special.
export async function makemaz_tower1() {
    const g = game;
    // load_special -> nhlib.lua top-level shuffle(align): rn2(3), rn2(2).
    shuffle(['law', 'neutral', 'chaos']);
    // des.level_init({ style="solidfill", fg=" " }) -> rn2(2) + fill STONE.
    quest_level_init_solidfill();          // splev_initlev rn2(2)
    // des.level_flags("mazelevel","noteleport","hardfloor","solidify") — no RNG.
    if (g.level?.flags) {
        g.level.flags.is_maze_lev = true;
        g.level.flags.noteleport = true;
        g.level.flags.hardfloor = true;
    }
    // des.map({ halign="half-left", valign="center", map=[[...]] }) — no RNG.
    tower1_load_map(TOWER1_MAP, false);   // des.map has no "lit" option

    // local niches = {...}; shuffle(niches) — rn2(6),rn2(5),rn2(4),rn2(3),rn2(2).
    const niches = [[3, 1], [3, 9], [7, 1], [7, 9], [11, 1], [11, 9]];
    shuffle(niches);

    // des.ladder("down", 11,05) — no RNG.
    tower_place_ladder(11, 5);

    g._tower_gen = true;
    g._full_mon_gen = true;
    try {
        // The lord and his court.
        quest_create_monster('Vlad the Impaler', 6, 5, null);
        tower_create_V(niches[0][0], niches[0][1]);
        tower_create_V(niches[1][0], niches[1][1]);
        tower_create_V(niches[2][0], niches[2][1]);
        // The brides (waiting vampires); names only when vampire isn't genocided.
        const Vgenod = false;
        const Vnames = Vgenod ? [null, null, null] : ['Madame', 'Marquise', 'Countess'];
        tower_create_vampire_lady(Vnames[0], niches[3][0], niches[3][1]);
        tower_create_vampire_lady(Vnames[1], niches[4][0], niches[4][1]);
        tower_create_vampire_lady(Vnames[2], niches[5][0], niches[5][1]);
    } finally {
        g._tower_gen = false;
        g._full_mon_gen = false;
    }

    // des.door(...) x7 — explicit states on existing DOOR cells, no RNG.
    quest_set_door(8, 3, 'closed'); quest_set_door(10, 3, 'closed');
    quest_set_door(3, 4, 'closed');
    quest_set_door(10, 5, 'locked'); quest_set_door(8, 7, 'locked');
    quest_set_door(10, 7, 'locked'); quest_set_door(3, 6, 'closed');

    g._full_mon_gen = true;
    try {
        // treasures — five plain chests then two candle-bearing chests.
        quest_create_object(CHEST, 7, 5, null, null);
        quest_create_object(CHEST, niches[5][0], niches[5][1], null, null);
        quest_create_object(CHEST, niches[0][0], niches[0][1], null, null);
        quest_create_object(CHEST, niches[1][0], niches[1][1], null, null);
        quest_create_object(CHEST, niches[2][0], niches[2][1], null, null);
        tower_content_chest(niches[3][0], niches[3][1], WAX_CANDLE);
        tower_content_chest(niches[4][0], niches[4][1], TALLOW_CANDLE);
    } finally {
        g._full_mon_gen = false;
    }

    // des.non_diggable(selection.area(0,0,14,10)) — no RNG.

    // C ref: lspo_finalize_level -> wallification then flip_level_rnd(3, FALSE).
    tower_wallification(1, 0, COLNO - 1, ROWNO - 1);
    let flp = 0;
    if (rn2(2)) flp |= 1;                 // flip_level_rnd sp_lev.c:975
    if (rn2(2)) flp |= 2;                 // flip_level_rnd sp_lev.c:977
    if (flp) flip_level(flp);
}
