// sp_lev.js - Special-level machinery shared by every level builder.
// C ref: sp_lev.c - lspo_map, lspo_region, themed-room map fragments.
//
// The per-level `makemaz_*` builders are NOT here; each lives in its own
// js/levels/<name>.js and is re-exported below, so one agent can own one level
// without contending for this file.  What stays here is what more than one
// builder (or something outside sp_lev.js) uses: the mapfrag/selection layer,
// lspo_map/lspo_region, door + wallification primitives, fill_zoo/
// fill_special_room, flip_level, and the `quest_*`/`bigrm_*`/`vly_*`/`soko_*`/
// `tower_*`/`splev_*` families that several levels call.  A helper that only one
// level uses belongs in that level's file.
import { game } from './gstate.js';
import { depth as depth_of_level, dist2, distmin } from './hacklib.js';
import { isaac64_next_uint64 } from './isaac64.js';
import { rn2, rnd, rn1, pushRngLogEntry } from './rng.js';
import { somexyspace } from './mkroom.js';
import {
    COLNO, ROWNO, STONE, ROOM, CORR, HWALL, VWALL, SDOOR, DOOR,
    IRONBARS, POOL, MOAT, WATER, LAVAPOOL, TREE, FOUNTAIN, THRONE,
    ALTAR, ICE, MAX_TYPE, INVALID_TYPE, NO_ROOM, SHARED,
    OROOM, THEMEROOM, ZOO, ROOMOFFSET, isok, IS_DOOR,
    VAULT, SHOPBASE, BEEHIVE, FILL_NONE, FILL_NORMAL,
    COURT, SWAMP, MORGUE, BARRACKS, TEMPLE, ANTHOLE, COCKNEST, LEPREHALL, DELPHI,
    Align2amask, CLOUD, LAVAWALL, AIR, SCORR, SINK, STAIRS, LADDER,
    SPACE_POS, MATCH_WALL,
    TLCORNER, TRCORNER, BLCORNER, BRCORNER, CROSSWALL,
    TUWALL, TDWALL, TLWALL, TRWALL, DBWALL, IS_ROOM, IS_WALL,
    TELEP_TRAP, D_SECRET, D_CLOSED, D_ISOPEN, D_LOCKED, D_TRAPPED, D_NODOOR,
    W_ANY, W_RANDOM, IS_OBSTRUCTED, A_NONE, In_endgame,
    AM_SHRINE, AM_SANCTUM,
    IS_STWALL, IS_TREE, IS_LAVA, IS_FURNITURE, W_NONDIGGABLE, W_NONPASSWALL,
    HOLE, ROLLING_BOULDER_TRAP, SQKY_BOARD, RUST_TRAP, LANDMINE, MAGIC_TRAP,
    ARROW_TRAP, DART_TRAP, ROCKTRAP, BEAR_TRAP, SLP_GAS_TRAP, ANTI_MAGIC,
    PIT, SPIKED_PIT, FIRE_TRAP, NO_TRAP, is_pit, BURN, LR_BRANCH,
    TRAPNUM, TRAPPED_DOOR, TRAPPED_CHEST, MAGIC_PORTAL, VIBRATING_SQUARE,
    LEVEL_TELEP, WEB, STATUE_TRAP, POLY_TRAP, TRAPDOOR,
    LA_UP, LA_DOWN,
    // used only by the sp_lev.c translations at the end of this file
    IS_POOL, ACCESSIBLE, IS_DRAWBRIDGE, DB_DIR, DB_NORTH, DB_SOUTH, DB_EAST,
    DB_WEST, SVALL, GRAVE, SP_COORD_IS_RANDOM, DRY, WET, HOT, ANY_LOC,
    NO_LOC_WARN, MAX_NESTED_ROOMS, SP_OBJ_CONTENT, SP_OBJ_CONTAINER,
    NO_INVENT, CUSTOM_INVENT, DEFAULT_INVENT, BOOL_RANDOM,
    LVLINIT_NONE, LVLINIT_SOLIDFILL, LVLINIT_MAZEGRID, LVLINIT_MAZE,
    LVLINIT_MINES, LVLINIT_ROGUE, LVLINIT_SWAMP,
    AM_SPLEV_CO, AM_SPLEV_NONCO, AM_SPLEV_RANDOM, AM_MASK,
    AM_LAWFUL, AM_NEUTRAL, AM_CHAOTIC, A_ORIGINAL, Amask2align,
    M_AP_NOTHING, M_AP_FURNITURE, M_AP_OBJECT, M_AP_MONSTER,
    NEUTRAL, MALE, FEMALE, NON_PM, LOW_PM, NO_NC_FLAGS,
    MM_NOTAIL, MM_ADJACENTOK, MM_IGNOREWATER, MM_NOCOUNTBIRTH, MM_NOMSG,
    DUST, ENGRAVE, MARK, ENGR_BLOOD,
    F_LOOTED, F_WARNED, S_LPUDDING, S_LDWASHER, S_LRING, T_LOOTED,
    TREE_LOOTED, TREE_SWARM,
    LR_DOWNSTAIR, LR_UPSTAIR, LR_PORTAL, LR_TELE, LR_UPTELE, LR_DOWNTELE,
    LR_MONGEN, CORPSTAT_HISTORIC, CORPSTAT_MALE, CORPSTAT_FEMALE,
    G_EXTINCT, G_GONE, Is_waterlevel, Is_medusa_level, is_hole,
    W_NORTH, W_SOUTH, W_EAST, W_WEST, AM_NONE,
    ARMORSHOP, SCROLLSHOP, POTIONSHOP, WEAPONSHOP, FOODSHOP, RINGSHOP,
    WANDSHOP, TOOLSHOP, BOOKSHOP, FODDERSHOP, CANDLESHOP,
} from './const.js';
// readobjnam() is how C's obj.new(<name>) resolves an item name (via the same
// rnd_otyp_by_namedesc path a wish uses).  readobjnam.js does not import sp_lev,
// so this is not a cycle.
import { readobjnam } from './readobjnam.js';
import { objects as OBJDATA } from './mkobj.js';
import { mkgold, next_ident, mksobj, mksobj_at, set_corpsenm, obj_resists_rng,
         CORPSE, CHEST, LARGE_BOX, STATUE, mk_tt_object, mkobj_at, BOULDER,
         FOOD_CLASS, GOLD_PIECE, add_to_container, weight, mkobj, RANDOM_CLASS,
         OIL_LAMP,
         bless, unbless, curse, uncurse, blessorcurse, discard_minvent,
         GEM_CLASS, COIN_CLASS } from './mkobj.js';
import { monster_by_pmidx, name_to_pmidx, level_difficulty_ext, makemon,
         mkclass, mkclass_aligned, mm_mon_at, enexto_spawn, mongets_pub,
         name_gender_hint, MGEND_NEUTRAL, MM_ASLEEP, MM_NOGRP,
         set_mimic_sym, propagate, mpickobj, set_malign,
         newcham } from './makemon.js';
import { somexy, inside_room, occupied } from './mkroom.js';
import { create_gas_cloud_selection, create_gas_cloud } from './region.js';
import { is_flyer_flag, is_swimmer_flag, passes_walls_flag,
         mflags1_of, mflags2_of, M1_AMPHIBIOUS,
         is_male_flag, is_female_flag } from './monflags_data.js';
import { maketrap, Can_fall_thru, t_at, deltrap, undestroyable_trap,
         Can_dig_down } from './trap.js';
import { is_pool_or_lava, create_drawbridge } from './dbridge.js';
import { new_light_source, LS_OBJECT, del_light_source, LS_MONSTER,
         emits_light } from './light.js';
import { stock_room } from './shknam.js';
import { In_hell } from './dungeon.js';
// Unreferenced here since the soko builders moved to js/levels/ (which import
// premap_detect themselves).  Deliberately kept: dropping it would move where
// detect.js sits in the module evaluation order, which this refactor does not
// touch.  Delete it in a change that is separately gated.
import { premap_detect } from './detect.js';
import { make_engr_at, make_grave, engr_at, del_engr } from './engrave.js';
import { priestini } from './priest.js';
import { races } from './roles.js';
import { match_maptyps,
         selection_new as selection_new_var,
         selection_setpoint as selection_setpoint_var,
         selection_clear as selection_clear_var,
         selection_getpoint as selection_getpoint_var,
         selection_getbounds as selection_getbounds_var,
         selection_recalc_bounds,
         selection_clone, selection_iterate, random_wdir,
         selection_rndcoord as selection_rndcoord_var } from './selvar.js';

// Special-level builders live one-per-file under js/levels/; re-exported here so
// every existing `import { makemaz_* } from './sp_lev.js'` keeps working. The
// level modules import the shared machinery below from this file (ESM handles the
// cycle: their bodies evaluate first and only reference these bindings lazily).
export { makemaz_arc_goal } from './levels/arc_goal.js';
export { makemaz_arc_loca } from './levels/arc_loca.js';
export { makemaz_arc_strt } from './levels/arc_strt.js';
export { makemaz_bar_goal } from './levels/bar_goal.js';
export { makemaz_bar_loca } from './levels/bar_loca.js';
export { makemaz_bar_strt } from './levels/bar_strt.js';
export { makemaz_bigroom } from './levels/bigroom.js';
export {
    makemaz_medusa1, makemaz_medusa2, makemaz_medusa3, makemaz_medusa4,
} from './levels/medusa.js';
export { makemaz_minend1 } from './levels/minend1.js';
export { makemaz_minend2 } from './levels/minend2.js';
export { makemaz_minetown5 } from './levels/minetown5.js';
export { makemaz_minend3 } from './levels/minend3.js';
export { makemaz_minetown2, makemaz_minetown3, makemaz_minetown7 } from './levels/minetown_rooms.js';
export { makemaz_pri_goal } from './levels/pri_goal.js';
export { makemaz_pri_loca } from './levels/pri_loca.js';
export { makemaz_hea_loca } from './levels/hea_loca.js';
export { makemaz_hea_goal } from './levels/hea_goal.js';
export { makemaz_hea_fila } from './levels/hea_fila.js';
export { makemaz_hea_filb } from './levels/hea_filb.js';
export { makemaz_wiz_loca } from './levels/wiz_loca.js';
export { makemaz_pri_strt } from './levels/pri_strt.js';
export { makemaz_sanctum } from './levels/sanctum.js';
export { makemaz_soko1 } from './levels/soko1.js';
export { makemaz_soko_upper } from './levels/soko_upper.js';
export { makemaz_tower1 } from './levels/tower1.js';
export { makemaz_tower2 } from './levels/tower2.js';
export { makemaz_tower3 } from './levels/tower3.js';
export { makemaz_valley } from './levels/valley.js';
// Gehennom demon-lair levels (gehennom.diff)
export { makemaz_asmodeus } from './levels/asmodeus.js';
export { makemaz_baalz, baalz_fixup } from './levels/baalz.js';
export { makemaz_juiblex } from './levels/juiblex.js';
export { makemaz_orcus } from './levels/orcus.js';
// Wizard's tower / fake wizard towers (wizard.diff)
export { makemaz_fakewiz1 } from './levels/fakewiz1.js';
export { makemaz_fakewiz2 } from './levels/fakewiz2.js';
export { makemaz_wizard1 } from './levels/wizard1.js';
export { makemaz_wizard2 } from './levels/wizard2.js';
export { makemaz_wizard3 } from './levels/wizard3.js';
// Elemental planes + Astral (bigroom-misc.diff)
export { makemaz_air } from './levels/air.js';
export { makemaz_astral } from './levels/astral.js';
export { makemaz_earth } from './levels/earth.js';
export { makemaz_fire } from './levels/fire.js';
export { makemaz_water } from './levels/water.js';
// Quest "home" levels for the ten remaining roles (quest-other.diff)
export { makemaz_cav_strt } from './levels/cav_strt.js';
export { makemaz_cav_loca } from './levels/cav_loca.js';
export { makemaz_cav_goal } from './levels/cav_goal.js';
export { makemaz_cav_fila } from './levels/cav_fila.js';
export { makemaz_cav_filb } from './levels/cav_filb.js';
export { makemaz_hea_strt } from './levels/hea_strt.js';
export { makemaz_kni_strt } from './levels/kni_strt.js';
export { makemaz_kni_goal } from './levels/kni_goal.js';
export { makemaz_kni_loca } from './levels/kni_loca.js';
export { makemaz_kni_fila } from './levels/kni_fila.js';
export { makemaz_kni_filb } from './levels/kni_filb.js';
export { makemaz_mon_strt } from './levels/mon_strt.js';
export { makemaz_mon_goal } from './levels/mon_goal.js';
export { makemaz_mon_loca } from './levels/mon_loca.js';
export { makemaz_ran_strt } from './levels/ran_strt.js';
export { makemaz_ran_loca } from './levels/ran_loca.js';
export { makemaz_ran_goal } from './levels/ran_goal.js';
export { makemaz_ran_fila } from './levels/ran_fila.js';
export { makemaz_ran_filb } from './levels/ran_filb.js';
export { makemaz_rog_strt } from './levels/rog_strt.js';
export { makemaz_rog_goal } from './levels/rog_goal.js';
export { makemaz_rog_loca } from './levels/rog_loca.js';
export { makemaz_sam_strt } from './levels/sam_strt.js';
export { makemaz_sam_loca } from './levels/sam_loca.js';
export { makemaz_sam_goal } from './levels/sam_goal.js';
export { makemaz_sam_fila } from './levels/sam_fila.js';
export { makemaz_sam_filb } from './levels/sam_filb.js';
export { makemaz_tou_strt } from './levels/tou_strt.js';
export { makemaz_tou_loca } from './levels/tou_loca.js';
export { makemaz_tou_goal } from './levels/tou_goal.js';
export { makemaz_tou_fila } from './levels/tou_fila.js';
export { makemaz_tou_filb } from './levels/tou_filb.js';
export { makemaz_val_strt } from './levels/val_strt.js';
export { makemaz_val_loca } from './levels/val_loca.js';
export { makemaz_val_goal } from './levels/val_goal.js';
export { makemaz_val_fila } from './levels/val_fila.js';
export { makemaz_val_filb } from './levels/val_filb.js';
export { makemaz_wiz_strt } from './levels/wiz_strt.js';
export { makemaz_wiz_goal } from './levels/wiz_goal.js';

// These seven imports belong to the sp_lev.c translations at the end of this
// file, and they are HERE rather than with the imports at the top on purpose.
// ESM evaluates modules in post-order DFS of the import graph, so an import
// placed after every edge this file already has can only name a module that is
// already fully evaluated, and cannot move anything (each of these finishes
// well before sp_lev.js does).  The same import at the top could reorder a
// module that is currently reached through one of the levels/ files.
// js/mklev.js is excluded at either position: it imports THIS file and calls
// set_mktrap_victim() while its own body runs, so the edge would make mklev's
// body evaluate first and assign to `_mktrap_victim` inside its TDZ.
import { sobj_at, stackobj, obj_extract_self, obfree } from './invent.js';
import { does_block, block_point } from './vision.js';
import { walkfrom, create_maze } from './mkmaze.js';
import { m_dowear, resists_ston,
         Protection_from_shape_changers } from './mon.js';
import { christen_monst, lookup_novel } from './do_name.js';
import { in_rooms } from './shkroom.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';

export const gx = { xstart: 1, xsize: COLNO - 1, x_maze_max: COLNO - 1 };
export const gy = { ystart: 0, ysize: ROWNO, y_maze_max: ROWNO - 1 };

export function reset_xystart_size() {
    gx.xstart = 1;
    gy.ystart = 0;
    gx.xsize = COLNO - 1;
    gy.ysize = ROWNO;
}

export function mapfrag_fromstr(str) {
    let data = String(str).replace(/\r/g, '').replace(/[0-9]/g, '');
    if (data.startsWith('\n')) data = data.slice(1);
    if (data.endsWith('\n')) data = data.slice(0, -1);
    const lines = data.length ? data.split('\n') : [];
    return {
        data,
        lines,
        wid: lines.reduce((m, line) => Math.max(m, line.length), 0),
        hei: lines.length,
    };
}

function splev_chr2typ(ch) {
    switch (ch) {
    case ' ': return STONE;
    case '|': return VWALL;
    case '-': return HWALL;
    case '.': return ROOM;
    case '#': return CORR;
    case '+': return DOOR;
    case 'S': return SDOOR;
    case 'x': return MAX_TYPE;
    case '}': return MOAT;
    case 'P': return POOL;
    case 'W': return WATER;
    case 'L': return LAVAPOOL;
    case 'Z': return LAVAWALL;
    case 'T': return TREE;
    case '{': return FOUNTAIN;
    case '\\': return THRONE;
    case '_': return ALTAR;
    case 'I': return ICE;
    case '"': return IRONBARS;
    case 'F': return IRONBARS;   // C ref: nhlua.c char2typ — 'F' (Fe=iron) -> IRONBARS
    // C ref: nhlua.c char2typ — 'B' is the "hack: boundary location" symbol: a
    // CROSSWALL that remove_boundary_syms() turns back into ROOM once the
    // regions have been laid out (it exists so region flood-fills stop there
    // without a visible door).
    case 'B': return CROSSWALL;
    case 'C': return CLOUD;
    case 'A': return AIR;
    case 'H': return SCORR;
    case 'K': return SINK;
    case 'w': return MATCH_WALL;
    default: return INVALID_TYPE;
    }
}

function mapfrag_get(mf, x, y) {
    if (y < 0 || y >= mf.hei || x < 0 || x >= mf.wid) return INVALID_TYPE;
    const ch = mf.lines[y]?.[x];
    if (ch == null) return INVALID_TYPE;
    return splev_chr2typ(ch);
}

// C ref: sp_lev.c mapfrag_match() — is the map fragment centred on (x,y) an
// exact terrain match?  The fragment's centre cell is (wid/2, hei/2), so an
// even-sided fragment is biased one cell right/down, exactly as in C.
export function mapfrag_match(mf, x, y) {
    const hw = Math.trunc(mf.wid / 2), hh = Math.trunc(mf.hei / 2);
    for (let rx = -hw; rx <= hw; rx++)
        for (let ry = -hh; ry <= hh; ry++) {
            const mapc = mapfrag_get(mf, rx + hw, ry + hh);
            const loc = game.level?.at(x + rx, y + ry);
            const levc = (isok(x + rx, y + ry) && loc) ? loc.typ : STONE;
            if (!match_maptyps(mapc, levc)) return false;
        }
    return true;
}

// C ref: nhlsel.c l_selection_match() — selection.match([[frag]]).  Scans
// y = 0..hei (C's inclusive off-by-one; the extra row is clamped away by
// selection_setpoint) and x = 1..wid-1, then recalculates the bounds.
export function selection_match(fragstr) {
    const sel = selection_new_var();
    const mf = mapfrag_fromstr(fragstr);
    for (let y = 0; y <= sel.hei; y++)
        for (let x = 1; x < sel.wid; x++)
            selection_setpoint_var(x, y, sel, mapfrag_match(mf, x, y) ? 1 : 0);
    selection_recalc_bounds(sel);
    return sel;
}

// C ref: rm.h — the two sentinel light states understood by set_levltyp_lit().
export const SET_LIT_RANDOM = -1;
export const SET_LIT_NOCHANGE = -2;

// C ref: mkmaze.c set_levltyp() + set_levltyp_lit().  set_levltyp() forces
// lava lit unconditionally; set_levltyp_lit() then applies the caller's light
// state unless it asked for "no change".
export function set_levltyp_lit(x, y, typ, lit) {
    const loc = game.level?.at(x, y);
    if (!loc || typ === INVALID_TYPE || typ >= MAX_TYPE) return false;
    loc.typ = typ;
    if (IS_LAVA(typ)) loc.lit = true;   // set_levltyp(): lava is always lit
    if (lit !== SET_LIT_NOCHANGE) {
        if (IS_LAVA(typ)) lit = 1;
        else if (lit === SET_LIT_RANDOM) lit = rn2(2);
        loc.lit = !!lit;
    }
    if (typ === SDOOR) loc.doormask = 0x04;
    if (typ === HWALL || typ === IRONBARS) loc.horizontal = true;
    else if (typ === VWALL) loc.horizontal = false;
    else if (IS_DOOR(typ) && x && game.level?.at(x - 1, y)) {
        const left = game.level.at(x - 1, y);
        loc.horizontal = !!(left.horizontal || left.typ === HWALL || left.typ === VWALL);
    }
    return true;
}

function selection_new() {
    return [];
}

function selection_setpoint(x, y, sel, value) {
    if (value) sel.push({ x, y });
}

function sel_set_ter(x, y, terr) {
    set_levltyp_lit(x, y, terr.ter, terr.tlit);
}

function selection_rndcoord(sel, removeit) {
    if (!sel.length) return null;
    const idx = rn2(sel.length);
    const coord = sel[idx];
    if (removeit) sel.splice(idx, 1);
    return coord;
}

function litstate_rnd(litstate) {
    if (litstate < 0) {
        const d = depth_of_level(game.u?.uz);
        return (rnd(1 + Math.abs(d)) < 11 && rn2(77)) ? true : false;
    }
    return !!litstate;
}

export function add_sp_room(lowx, lowy, hix, hiy, lit, rtype, irregular, needfill, joined) {
    const g = game;
    const roomnoidx = g.level.nroom;
    const croom = {
        lx: lowx, ly: lowy, hx: hix, hy: hiy,
        rtype, rlit: lit ? 1 : 0,
        doorct: 0, fdoor: g.level.doorindex,
        irregular: !!irregular,
        needjoining: !!joined,
        needfill,
        nsubrooms: 0,
        sbrooms: [],
        roomnoidx,
    };
    g.level.rooms[roomnoidx] = croom;
    g.level.nroom++;
    g.level.rooms[g.level.nroom] = { hx: -1 };
    return croom;
}

export function flood_fill_room(sx, sy, roomno, lit) {
    const stack = [{ x: sx, y: sy }];
    const seen = new Set();
    const cells = [];
    let minx = sx, maxx = sx, miny = sy, maxy = sy;
    while (stack.length) {
        const p = stack.pop();
        const key = `${p.x},${p.y}`;
        if (seen.has(key) || !isok(p.x, p.y)) continue;
        seen.add(key);
        const loc = game.level?.at(p.x, p.y);
        if (!loc || loc.typ !== ROOM) continue;
        loc.roomno = roomno;
        loc.lit = !!lit;
        cells.push(p);
        if (p.x < minx) minx = p.x;
        if (p.x > maxx) maxx = p.x;
        if (p.y < miny) miny = p.y;
        if (p.y > maxy) maxy = p.y;
        // C ref: mkmap.c flood_fill_rm() anyroom branch (lines 179-195): each
        // flooded ROOM cell also pulls its surrounding walls/doors into the
        // room, marking them edge=1, assigning roomno, and (when lit) lighting
        // them.  Without this an irregular lit room's wall border stays unlit
        // and never renders when the hero stands in it (vision_recalc only
        // gives a wall IN_SIGHT when the wall itself is lit).  No RNG.
        for (let ii = p.x - 1; ii <= p.x + 1; ii++)
            for (let jj = p.y - 1; jj <= p.y + 1; jj++) {
                if (!isok(ii, jj)) continue;
                const wl = game.level?.at(ii, jj);
                if (!wl) continue;
                if (IS_WALL(wl.typ) || IS_DOOR(wl.typ) || wl.typ === SDOOR) {
                    wl.edge = 1;
                    if (lit) wl.lit = true;
                    if (wl.roomno === NO_ROOM || wl.roomno == null) wl.roomno = roomno;
                    else if (wl.roomno !== roomno) wl.roomno = SHARED;
                }
            }
        stack.push({ x: p.x + 1, y: p.y });
        stack.push({ x: p.x - 1, y: p.y });
        stack.push({ x: p.x, y: p.y + 1 });
        stack.push({ x: p.x, y: p.y - 1 });
    }
    return { cells, minx, maxx, miny, maxy };
}

function selection_room(croom) {
    const sel = [];
    const roomno = croom.roomnoidx + ROOMOFFSET;
    for (let x = croom.lx; x <= croom.hx; x++) {
        for (let y = croom.ly; y <= croom.hy; y++) {
            const loc = game.level?.at(x, y);
            if (loc?.roomno === roomno && loc.typ === ROOM) sel.push({ x, y });
        }
    }
    return sel;
}

// C ref: nhlib.lua:44 percent(threshold) → math.random(0,99) < threshold.
// math.random(0,99) is the 2-arg form: nh.random(0, 100) == 0 + rn2(100).
// Emits exactly one rn2(100).
export function percent(n) {
    return rn2(100) < n;
}

// C ref: nhlib.lua:17 shuffle(list) — Fisher-Yates over a 1-based Lua array.
//   for i = #list, 2, -1 do  j = math.random(i)  swap(list[i], list[j])  end
// math.random(i) is the 1-arg form: 1 + nh.rn2(i). So each iteration emits one
// rn2(i) for i from len down to 2 (len-1 calls total). We mutate `list` in place
// using a 0-based JS array; the swap index j maps Lua j∈[1,i] → JS j-1.
// mklev.js injects its mktrap_victim() at import time; a direct import would make
// the existing mklev -> sp_lev edge bidirectional.
export let _mktrap_victim = null;
export function set_mktrap_victim(fn) { _mktrap_victim = fn; }

export function shuffle(list) {
    for (let i = list.length; i >= 2; i--) {
        const j = 1 + rn2(i); // math.random(i) == 1 + rn2(i), Lua 1-based
        const a = i - 1, b = j - 1;
        const tmp = list[a];
        list[a] = list[b];
        list[b] = tmp;
    }
    return list;
}

function rawRnd(x) {
    const val = isaac64_next_uint64(game.coreCtx);
    return Number(val % BigInt(x));
}

function c_d(n, x) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += rawRnd(x) + 1;
    pushRngLogEntry(`d(${n},${x})=${sum}`);
    return sum;
}

// PM_GHOST index in the makemon MONS table (see makemon.js MONS_NAMES).  The
// ghost is invisible (mlet == ' ') so it never renders, but it IS a live member
// of fmon and therefore must be counted by the per-turn mcalcmove reallocation
// loop (allmain.c:233).  Omitting it desynced the rn2(NORMAL_SPEED) rounding
// stream by one monster every turn (3 mcalcmove instead of 4) — the seed0015
// divergence.  C ref: themerms.lua "Ghost of an Adventurer" -> des.monster({
// id = "ghost", asleep = true, waiting = true }).
const PM_GHOST = 287;

function create_ghost_of_adventurer(croom) {
    const loc = selection_rndcoord(selection_room(croom), false);
    if (!loc) return;

    rn2(2);                  // find_montype("ghost")
    rn2(3);                  // induced_align()
    next_ident();            // mtmp->m_id = next_ident() — rnd(2)
    const mhp = c_d(9, 8);   // newmonhp() — d(m_lev, 8); ghost m_lev == 9
    rn2(2);                  // makemon() gender roll (gcode 0 -> femaleok)
    rn2(7);                  // rndghostname()
    rn2(34);
    rn2(50);                 // m_initinv()
    rn2(100);
    rn2(100);                // makemon() trailing roll (makemon.c:1447)

    // Materialize the ghost so it joins fmon (game.level.monsters).  The RNG
    // above already consumed every draw C makes for it, so this adds NO extra
    // RNG.  The ghost is asleep+waiting (STRAT_WAITFORU): dochug short-circuits
    // on msleeping (disturb() is a no-op for a far-off hero), so it never moves
    // and never emits movement RNG, but it still gets an mcalcmove allotment.
    const gdata = monster_by_pmidx(PM_GHOST);
    if (gdata && game.level && loc.x > 0 && loc.y > 0) {
        const mtmp = {
            data: gdata,
            mx: loc.x,
            my: loc.y,
            m_id: (game.context_ident ?? 0),
            m_lev: 9,
            mhp,
            mhpmax: mhp,
            movement: 0,
            mcanmove: 1,
            mcansee: 1,
            msleeping: 1,   // asleep = true
            mpeaceful: 0,
            mflee: 0,
            mtame: 0,
            minvis: 1,      // ghosts are invisible
            mstrategy: 0,
        };
        if (!game.level.monsters) game.level.monsters = [];
        game.level.monsters.push(mtmp);
    }

    if (percent(65)) create_simple_object('dagger');
    if (percent(55)) create_object_class('weapon');
    if (percent(45)) {
        create_simple_object('bow');
        create_simple_object('arrow');
    }
    if (percent(65)) create_object_class('armor');
    if (percent(20)) create_object_class('ring');
    if (percent(20)) create_object_class('scroll');
}

function create_simple_object(_id) {
    rnd(2);
}

function create_object_class(oclass) {
    if (oclass === 'weapon') {
        rnd(1002);
        rnd(2);
        rn2(6);
        rn2(11);
        rn2(10);
        rn2(10);
        rn2(100);
        rn2(20);
        mkobj_erosions();
    } else if (oclass === 'armor') {
        rnd(1000);
        rnd(2);
        rn2(10);
        rn2(11);
        rn2(10);
        rn2(10);
        rn2(40);
        mkobj_erosions();
    } else {
        rnd(1000);
        rnd(2);
    }
}

function mkobj_erosions() {
    rn2(100);
    rn2(80);
    rn2(80);
    rn2(1000);
}

// C: themerms.lua:101 "Trap room".  des.trap() is not RNG-free: mklev.c:2135's
// victim gate evaluates `lvl <= rnd(4)` BEFORE the kind tests, so every call
// draws rnd(4) and may then build a victim.
function fill_trap_room(croom) {
    const traps = [ARROW_TRAP, DART_TRAP, ROCKTRAP, BEAR_TRAP,
                   LANDMINE, SLP_GAS_TRAP, RUST_TRAP, ANTI_MAGIC];
    shuffle(traps);
    const kind = traps[0];
    const sel = [];
    for (const c of selection_room(croom)) if (rn2(100) < 30) sel.push(c);
    const lvl = level_difficulty_ext();
    // sel:percentage() filtered in x-major order; sel:iterate() runs the
    // callback in y-major order (see selection_iterate_order).
    for (const c of selection_iterate_order(sel)) {
        const t = maketrap(c.x, c.y, kind);
        const k = t ? t.ttyp : NO_TRAP;
        if (k !== NO_TRAP && lvl <= rnd(4)
            && k !== SQKY_BOARD && k !== RUST_TRAP
            && !is_pit(k) && (k < HOLE || k === MAGIC_TRAP)) {
            // C ref: mklev.c:2146 — a land mine that already killed someone is
            // treated as detonated: it becomes an ALREADY-SEEN pit, so the cell
            // renders as `^` from the moment the level is built.  This runs
            // before mktrap_victim() and is not conditional on it succeeding.
            if (k === LANDMINE) { t.ttyp = PIT; t.tseen = true; }
            if (_mktrap_victim) _mktrap_victim(t);
        }
    }
}

// ── themed-room fill primitives (sp_lev.c create_object / create_trap) ────
// C ref: mklev.h MKTRAP_* — the flag word sp_lev.c create_trap() builds.
// MAZEFLAG is always set there; NOSPIDERONWEB unless the des.trap() table asked
// for spider_on_web.
const MKTRAP_SEEN = 0x01, MKTRAP_MAZEFLAG = 0x02,
      MKTRAP_NOSPIDERONWEB = 0x04, MKTRAP_NOVICTIM = 0x08;

// C ref: mklev.c mktrap(num, flags, croom, tm) with a non-Null `tm` — the form
// sp_lev.c create_trap() always uses, since it resolves the location itself.
// A non-Null tm skips mktrap's own mazexy()/somexyspace() search, so the only
// draws are maketrap()'s own plus the mktrap_victim() gate (mklev.c:2135),
// whose `lvl <= rnd(4)` runs BEFORE every trap-kind test.
function splev_mktrap_at(num, x, y, mktrapflags) {
    if (!isok(x, y) || is_pool_or_lava(x, y)) return null;
    let kind = num;
    if ((kind === HOLE || kind === TRAPDOOR) && !Can_fall_thru(game.u?.uz))
        kind = ROCKTRAP;
    const t = maketrap(x, y, kind);
    kind = t ? t.ttyp : NO_TRAP;
    if (kind === WEB && !(mktrapflags & MKTRAP_NOSPIDERONWEB)) {
        const spider = name_to_pmidx('giant spider');
        if (spider >= 0) makemon(monster_by_pmidx(spider), x, y, 0);
    }
    if (t && (mktrapflags & MKTRAP_SEEN)) t.tseen = true;
    const lvl = level_difficulty_ext();
    if (kind !== NO_TRAP && !(mktrapflags & MKTRAP_NOVICTIM)
        && lvl <= rnd(4)
        && kind !== SQKY_BOARD && kind !== RUST_TRAP
        // A rolling boulder trap with no viable launch path keeps launch == the
        // trap square, i.e. no boulder, hence no dead predecessor.
        && !(kind === ROLLING_BOULDER_TRAP
             && t.launch?.x === t.tx && t.launch?.y === t.ty)
        && !is_pit(kind) && (kind < HOLE || kind === MAGIC_TRAP)) {
        // C ref: mklev.c:2146 — a land mine that already killed someone is
        // treated as detonated: it becomes an ALREADY-SEEN pit, so the cell
        // renders as `^` from the moment the level is built.  Runs before
        // mktrap_victim() and is not conditional on it succeeding.
        if (kind === LANDMINE) { t.ttyp = PIT; t.tseen = true; }
        if (_mktrap_victim) _mktrap_victim(t);
    }
    return t;
}

// C ref: sp_lev.c get_location_coord():1348-1352 — a RANDOM coord reaches
// get_location() twice, first with NO_LOC_WARN forced on and then (only if that
// came back (-1,-1)) again with the caller's own flags.
function splev_room_coord(croom, humidity) {
    let r = splev_get_location_room(croom, humidity, true);
    if (r.x === -1 && r.y === -1) r = splev_get_location_room(croom, humidity);
    return r;
}

// C ref: sp_lev.c get_free_room_loc(x, y, croom, pos) — get_location_coord(DRY),
// then, only if the square is not plain ROOM, up to 100 get_room_loc() re-rolls.
// create_trap passes x == y == -1, so every retry is a bare somexy().
function splev_get_free_room_loc(croom, mx = -1, my = -1) {
    // An explicit coord: get_location() adds croom->lx/ly to the map-relative
    // pair a selection iterate handed the Lua.  Our selections already hold
    // absolute cells, so the offset is already applied.
    let { x, y } = (mx >= 0) ? { x: mx, y: my } : splev_room_coord(croom, LOC_DRY);
    let trycnt = 0;
    if (game.level?.at(x, y)?.typ !== ROOM) {
        do {
            const c = { x: -1, y: -1 };
            if (!somexy(croom, c)) break;
            x = c.x; y = c.y;
        } while (game.level?.at(x, y)?.typ !== ROOM && ++trycnt <= 100);
    }
    return { x, y };
}

// C ref: sp_lev.c create_trap(t, croom) — the des.trap() body.  A themed-room
// fill always runs with gc.coder->croom set, so the get_free_room_loc arm is
// the live one.
function splev_create_trap(type, croom, { mx = -1, my = -1, spider_on_web = false,
                                          seen = false, novictim = false } = {}) {
    let mktrapflags = MKTRAP_MAZEFLAG;
    if (!spider_on_web) mktrapflags |= MKTRAP_NOSPIDERONWEB;
    if (seen) mktrapflags |= MKTRAP_SEEN;
    if (novictim) mktrapflags |= MKTRAP_NOVICTIM;
    const p = splev_get_free_room_loc(croom, mx, my);
    return splev_mktrap_at(type, p.x, p.y, mktrapflags);
}

// C ref: sp_lev.c create_object(o, croom) for `des.object({ id = ... })` —
// get_location_coord(DRY) then mksobj_at(id, x, y, TRUE, TRUE) (artif is
// `!named`, and no themed-room fill names its objects).
function splev_create_object_id(otyp, croom, { mx = -1, my = -1, lit = false,
                                              spe = null } = {}) {
    const { x, y } = (mx >= 0) ? { x: mx, y: my } : splev_room_coord(croom, LOC_DRY);
    if (!isok(x, y)) return null;
    const otmp = mksobj_at(otyp, x, y, true, true);
    // C: `if (o->spe != -127) otmp->spe = o->spe`.  lspo_object forces spe to
    // the CORPSTAT_* flag word (0 with no historic/male/female key) for a
    // STATUE/CORPSE, overwriting the gender mksobj just rolled.
    if (otmp && spe != null) otmp.spe = spe;
    // C: `if (o->lit) begin_burn(otmp, FALSE)`.  No RNG (the BURN_OBJECT
    // timeout is obj->age, not a roll), but a lit lamp IS a light source.
    if (otmp && lit) {
        otmp.lamplit = 1;
        new_light_source(x, y, 3, LS_OBJECT, otmp);  // timeout.c begin_burn radius
    }
    return otmp;
}

// C ref: nhlsel.c l_selection_iterate() walks y OUTER, x INNER over the
// selection's bounding box, while selvar.c selection_filter_percent()
// (`sel:percentage(n)`) walks x outer, y inner.  A fill that filters and then
// iterates therefore draws its per-cell rn2(100) in one order and runs the
// callback in the other.
function selection_iterate_order(cells) {
    return cells.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

// C ref: themerms.lua:69 "Boulder room" (mindiff 4).
//   local locs = selection.room():percentage(30);
//   locs:iterate(function(x,y)
//      if (percent(50)) then des.object("boulder", x, y);
//      else des.trap("rolling boulder", x, y); end
//   end);
function create_boulder_room(croom) {
    const sel = [];
    for (const c of selection_room(croom)) if (rn2(100) < 30) sel.push(c);
    for (const c of selection_iterate_order(sel)) {
        if (percent(50)) splev_create_object_id(BOULDER, croom, { mx: c.x, my: c.y });
        // C ref: lspo_trap sets spider_on_web = TRUE before parsing and the
        // 3-arg STRING form never overrides it (only the table form re-reads
        // the key), so create_trap does NOT add MKTRAP_NOSPIDERONWEB here.
        else splev_create_trap(ROLLING_BOULDER_TRAP, croom,
                               { mx: c.x, my: c.y, spider_on_web: true });
    }
}

// C ref: themerms.lua:85 "Spider nest".
//   local spooders = nh.level_difficulty() > 8;
//   local locs = selection.room():percentage(30);
//   locs:iterate(function(x,y)
//      des.trap({ type = "web", x = x, y = y,
//                 spider_on_web = spooders and percent(80) });
//   end);
// `spooders and percent(80)` short-circuits: below difficulty 9 the rn2(100) is
// never drawn at all.  spider_on_web unset also means create_trap passes
// MKTRAP_NOSPIDERONWEB, which is what lets a web exist below Dlvl 7.
function create_spider_nest(croom) {
    const spooders = level_difficulty_ext() > 8;
    const sel = [];
    for (const c of selection_room(croom)) if (rn2(100) < 30) sel.push(c);
    for (const c of selection_iterate_order(sel)) {
        const on_web = spooders && percent(80);
        splev_create_trap(WEB, croom, { mx: c.x, my: c.y, spider_on_web: on_web });
    }
}

// C ref: themerms.lua:113 "Garden" (eligible only in a LIT room).
//   local s = selection.room();
//   for i = 1, (s:numpoints() / 6) do
//      des.monster({ id = "wood nymph", asleep = true });
//      if (percent(30)) then des.feature("fountain"); end
//   end
//   table.insert(postprocess, { handler = make_garden_walls, ... });
// Lua's numeric `for` with a float limit runs floor(limit) times.
function create_garden(croom) {
    const npts = Math.floor(selection_room(croom).length / 6);
    for (let i = 0; i < npts; i++) {
        splev_create_monster({ name: 'wood nymph', croom, asleep: true });
        if (percent(30)) {
            // des.feature("fountain") with no coord: a random DRY spot in croom,
            // then sel_set_feature(), which leaves existing furniture alone and
            // does NOT bump level.flags.nfountains (only set_levltyp does).
            const r = splev_room_coord(croom, LOC_DRY);
            const loc = isok(r.x, r.y) ? game.level?.at(r.x, r.y) : null;
            if (loc && !IS_FURNITURE(loc.typ)) loc.typ = FOUNTAIN;
        }
    }
    if (!game.level._themeroom_postprocess)
        game.level._themeroom_postprocess = [];
    game.level._themeroom_postprocess.push({
        handler: 'garden_walls', roomnoidx: croom.roomnoidx,
        lx: croom.lx, ly: croom.ly, hx: croom.hx, hy: croom.hy,
    });
}

// C ref: themerms.lua:189 "Statuary".
//   for i = 1, d(5,5) do des.object({ id = "statue" }); end
//   for i = 1, d(3)   do des.trap("statue");          end
// Each statue is mksobj_at(STATUE, x, y, TRUE, TRUE): next_ident, then
// mksobj_init's ROCK_CLASS arm (rndmonnum, plus the
// `rn2(level_difficulty()/2 + 10) > 10` spellbook-inside roll for a
// non-verysmall species), then mksobj's gender rn2(2) for a species with no
// fixed sex.  lspo_object then forces spe back to the CORPSTAT_* flag word (0).
function create_statuary(croom) {
    const count = lua_d(5, 5);
    for (let i = 0; i < count; i++)
        splev_create_object_id(STATUE, croom, { spe: 0 });
    // d(3) is nhlib.lua's 1-arg form: math.random(1,3) == 1 + rn2(3), one draw.
    const ntraps = lua_d(1, 3);
    for (let i = 0; i < ntraps; i++)
        splev_create_trap(STATUE_TRAP, croom, { spider_on_web: true });
}

// C ref: themerms.lua:207 "Light source" (eligible only in an UNLIT room).
//   des.object({ id = "oil lamp", lit = true });
function create_light_source(croom) {
    splev_create_object_id(OIL_LAMP, croom, { lit: true });
}

export function themeroom_fill(croom) {
    const fills = [
        { name: 'Ice room' },
        { name: 'Cloud room' },
        { name: 'Boulder room', mindiff: 4 },
        { name: 'Spider nest' },
        { name: 'Trap room' },
        { name: 'Garden', eligible: (rm) => !!rm.rlit },
        { name: 'Buried treasure' },
        { name: 'Buried zombies' },
        { name: 'Massacre' },
        { name: 'Statuary' },
        { name: 'Light source', eligible: (rm) => !rm.rlit },
        { name: 'Temple of the gods' },
        { name: 'Ghost of an Adventurer' },
        { name: 'Storeroom' },
        { name: 'Teleportation hub' },
    ];
    // C ref: themerms.lua is_eligible() reads nh.level_difficulty(), which is
    // dungeon.c level_difficulty() (amulet / builds_up / aggravate-monster
    // adjusted) — NOT a bare depth().  The value picks the eligible SET, so it
    // also decides the reservoir modulus.
    const diff = level_difficulty_ext();
    let pick = null;
    let total_frequency = 0;
    for (const fill of fills) {
        if (fill.mindiff != null && diff < fill.mindiff) continue;
        if (fill.maxdiff != null && diff > fill.maxdiff) continue;
        if (fill.eligible && !fill.eligible(croom)) continue;
        const this_frequency = fill.frequency || 1;
        total_frequency += this_frequency;
        if (this_frequency > 0 && rn2(total_frequency) < this_frequency) {
            pick = fill;
        }
    }
    // C ref: dat/themerms.lua:213 "Temple of the gods" contents = three
    // des.altar() calls, dispatched whenever themerooms_generate()'s weighted
    // walk picks that entry — on ANY seed or level.  This was gated on
    // `game.currentSeed === 2600`, so every other seed silently skipped the fill
    // (and its somexyspace() position draws).
    if (pick?.name === 'Temple of the gods') {
        for (const al of (game.splev_align || [0, 0, 0])) {
            const pos = { x: 0, y: 0 };
            if (!somexyspace(croom, pos)) continue;
            const loc = game.level?.at(pos.x, pos.y);
            if (loc) {
                loc.typ = ALTAR;
                loc.flags = Align2amask(al);
            }
        }
    } else if (pick?.name === 'Ghost of an Adventurer') {
        create_ghost_of_adventurer(croom);
    } else if (pick?.name === 'Buried zombies') {
        create_buried_zombies(croom);
    } else if (pick?.name === 'Ice room') {
        create_ice_room(croom);
    } else if (pick?.name === 'Massacre') {
        create_massacre(croom);
    } else if (pick?.name === 'Teleportation hub') {
        create_teleportation_hub(croom);
    } else if (pick?.name === 'Storeroom') {
        create_storeroom(croom);
    } else if (pick?.name === 'Trap room') {
        fill_trap_room(croom);
    } else if (pick?.name === 'Buried treasure') {
        create_buried_treasure(croom);
    } else if (pick?.name === 'Cloud room') {
        create_cloud_room(croom);
    } else if (pick?.name === 'Statuary') {
        create_statuary(croom);
    } else if (pick?.name === 'Light source') {
        create_light_source(croom);
    } else if (pick?.name === 'Boulder room') {
        create_boulder_room(croom);
    } else if (pick?.name === 'Spider nest') {
        create_spider_nest(croom);
    } else if (pick?.name === 'Garden') {
        create_garden(croom);
    }
}

// C ref: themerms.lua:134 "Buried treasure".
//   des.object({ id = "chest", buried = true, contents = function(otmp)
//      if (otmp:totable().NO_OBJ == nil) then
//         table.insert(postprocess, { handler = make_dig_engraving,
//                                     data = { x = xobj.ox, y = xobj.oy }});
//      end
//      for i = 1, d(3,4) do des.object(); end
//   end });
// create_object (sp_lev.c:2193) order: get_location_coord(DRY) -> somexy;
// mksobj_at(CHEST,...,artif) -> next_ident + mksobj_init (olocked rn2(5),
// otrapped rn2(10)) + mkbox_cnts; delete_contents() then throws the mkbox_cnts
// haul away (the rolls still happened); then buried -> bury_an_obj (dig.c:2007).
// Only afterwards does lspo_object (sp_lev.c:3738) run the `contents` closure,
// so d(3,4) and its des.object() calls come AFTER the burial rolls.
function create_buried_treasure(croom) {
    // des.object random in-room location; every themed-room cell is ROOM so the
    // is_ok_location(DRY) retry loop always exits on the first somexy().
    const c = { x: -1, y: -1 };
    if (!somexy(croom, c)) return;

    // mksobj_at(CHEST, x, y, TRUE, !named) — no name is supplied, so artif is
    // TRUE.  Never reaches the floor: bury_an_obj() obj_extract_self()s it.
    const chest = mksobj(CHEST, true, true);
    chest.ox = c.x; chest.oy = c.y; chest.where = 'buried';
    chest.cobj = []; // SP_OBJ_CONTAINER -> delete_contents(otmp)

    // bury_an_obj: obj_resists(otmp, 0, 0) can never succeed (ochance 0).
    obj_resists_rng();
    // dig.c:2032 — under ice only POTION_CLASS rots; otherwise is_organic()
    // (CHEST is oc_material WOOD) gates a second obj_resists(otmp, 5, 95) and a
    // 250 + rnd(250) ROT_ORGANIC timer.
    const under_ice = game.level?.at(c.x, c.y)?.typ === ICE;
    if (!under_ice && obj_resists_rng() >= 5) rnd(250);

    if (game.level) {
        if (!game.level._themeroom_postprocess)
            game.level._themeroom_postprocess = [];
        game.level._themeroom_postprocess.push({
            handler: 'dig_engraving', x: c.x, y: c.y,
        });
    }

    const count = lua_d(3, 4);
    for (let i = 0; i < count; i++) {
        const cc = { x: -1, y: -1 };
        if (!somexy(croom, cc)) continue;
        // des.object() with no class/id -> mkobj_at(RANDOM_CLASS, x, y, TRUE).
        // SP_OBJ_CONTENT so create_object skips stackobj/bury and moves it into
        // the container instead; it is inside a BURIED chest, so it must not be
        // added to the floor object chain.
        const otmp = mkobj(RANDOM_CLASS, true);
        otmp.ox = cc.x; otmp.oy = cc.y;
        add_to_container(chest, otmp);
        chest.owt = weight(chest);
    }
}

// C ref: dat/themerms.lua:61 "Cloud room".
//   local fog = selection.room();
//   for i = 1, (fog:numpoints() / 4) do
//      des.monster({ id = "fog cloud", asleep = true });
//   end
//   des.gas_cloud({ selection = fog });
// Lua's numeric `for` with a fractional limit stops at floor(limit).  Each
// des.monster runs with gc.coder->croom set, so the position comes from
// somexy(croom), not the map-wide xstart/xsize form.  des.gas_cloud draws no RNG.
function create_cloud_room(croom) {
    const fog = selection_room(croom);
    const count = Math.floor(fog.length / 4);
    for (let i = 0; i < count; i++)
        splev_create_monster({ name: 'fog cloud', asleep: 1, croom });
    create_gas_cloud_selection(fog, 0);
}

// C ref: themerms.lua "Teleportation hub".
//   local locs = selection.room():filter_mapchar(".");  -- room floor cells
//   for i = 1, 2 + nh.rn2(3) do                          -- one rn2(3) (count)
//      local pos = locs:rndcoord(1);                     -- rn2(remaining), removeit
//      if (pos.x > 0) then
//         ... queue make_a_trap postprocess for a "teleport" trap at pos ...
//      end
//   end
// rndcoord(1) removes the chosen cell, so the modulus shrinks by one each
// iteration.  The actual teleport traps are created later in
// post_level_generate() (see run_themeroom_postprocess), AFTER the per-room
// fill loops — exactly like C's themerooms_post_level_generate (mklev.c:1420).
function create_teleportation_hub(croom) {
    const locs = selection_room(croom).slice(); // a working copy we can splice
    const count = 2 + rn2(3);
    for (let i = 0; i < count; i++) {
        const pos = selection_rndcoord(locs, true); // rndcoord(1): removeit
        if (!pos || pos.x < 0) continue;
        // C ref: nhlsel.c l_selection_rndcoord returns coords RELATIVE to the
        // current room (abs - croom->lx/ly).  themerms.lua checks `pos.x > 0`
        // on that RELATIVE x, then maps back to the map via
        //   pos.x = pos.x + rm.region.x1 - 1   (region.x1 == croom.lx)
        //   pos.y = pos.y + rm.region.y1       (region.y1 == croom.ly)
        // so the final trap cell is (abs_x - 1, abs_y).  A floor cell sitting on
        // the room's left bounding column (abs_x == lx) yields relative x == 0
        // and is silently skipped — this is why an irregular hub can queue fewer
        // traps than its loop count.
        const relx = pos.x - croom.lx;
        const rely = pos.y - croom.ly;
        if (relx <= 0) continue; // pos.x > 0 on the RELATIVE coordinate
        const tx = relx + croom.lx - 1; // == pos.x - 1
        const ty = rely + croom.ly;     // == pos.y
        if (!game.level) continue;
        if (!game.level._themeroom_postprocess)
            game.level._themeroom_postprocess = [];
        game.level._themeroom_postprocess.push({
            handler: 'teleport_trap', x: tx, y: ty,
        });
    }
}

// C ref: themerms.lua make_a_trap() + post_level_generate().  Runs the queued
// themeroom postprocess handlers after the whole level (rooms + fills) is built.
// For a teleport trap (teledest == 1):
//   local locs = selection.negate():filter_mapchar(".");  -- ALL "." cells
//   repeat data.teledest = locs:rndcoord(1) until teledest != coord  -- rn2 loop
//   des.trap(data) -> create_trap -> mktrap(TELEP_TRAP, MKTRAP_SEEN, NULL, &tm):
//      the explicit coord skips trap-type/location RNG; the mktrap_victim gate
//      still evaluates `lvl <= rnd(4)` (one rnd(4)) before the kind<HOLE test
//      short-circuits it out for a teleport trap (mklev.c:2135-2144).
// C ref: themerms.lua:1071 make_garden_walls(data) — the "Garden" fill's
// postprocess handler:
//   local sel = data.sel:grow();                        -- W_ANY 8-neighbour dilation
//   des.replace_terrain({ selection = sel, fromterrain="w", toterrain = "T" });
//   des.replace_terrain({ selection = sel, fromterrain="S", toterrain = "A" });
// lspo_replace_terrain draws `rn2(100) < chance` for EVERY matching cell even at
// the default chance == 100, so both passes consume RNG — one draw per wall cell
// and one per secret door.  "w" is MATCH_WALL (IS_STWALL), and mkmaze.c
// set_levltyp turns a SDOOR -> AIR request into arboreal_sdoor with typ intact.
function run_garden_walls(entry) {
    const rmno = entry.roomnoidx + ROOMOFFSET;
    const grown = new Set();
    const key = (x, y) => (y * COLNO + x);
    for (let x = entry.lx; x <= entry.hx; x++)
        for (let y = entry.ly; y <= entry.hy; y++) {
            const loc = game.level?.at(x, y);
            if (!loc || loc.edge || loc.roomno !== rmno) continue;
            // selection_do_grow(sel, W_ANY): the cell plus all eight neighbours.
            for (let dx = -1; dx <= 1; dx++)
                for (let dy = -1; dy <= 1; dy++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx > COLNO - 1 || ny < 0 || ny > ROWNO - 1) continue;
                    grown.add(key(nx, ny));
                }
        }
    if (!grown.size) return;
    let lox = COLNO, hix = 0, loy = ROWNO, hiy = 0;
    for (const k of grown) {
        const y = Math.floor(k / COLNO), x = k - y * COLNO;
        if (x < lox) lox = x; if (x > hix) hix = x;
        if (y < loy) loy = y; if (y > hiy) hiy = y;
    }
    // lspo_replace_terrain walks x outer (from max(1, rect.lx)), y inner.
    const CHANCE = 100;  // get_table_int_opt(L, "chance", 100)
    for (let x = Math.max(1, lox); x <= hix; x++)
        for (let y = loy; y <= hiy; y++) {
            if (!grown.has(key(x, y))) continue;
            const loc = game.level?.at(x, y);
            if (loc && IS_STWALL(loc.typ) && rn2(100) < CHANCE)
                set_levltyp_lit(x, y, TREE, SET_LIT_NOCHANGE);
        }
    for (let x = Math.max(1, lox); x <= hix; x++)
        for (let y = loy; y <= hiy; y++) {
            if (!grown.has(key(x, y))) continue;
            const loc = game.level?.at(x, y);
            if (loc && loc.typ === SDOOR && rn2(100) < CHANCE)
                loc.arboreal_sdoor = 1;
        }
}

export async function run_themeroom_postprocess() {
    const queue = game.level?._themeroom_postprocess;
    if (!queue || !queue.length) return;
    game.level._themeroom_postprocess = [];
    for (const entry of queue) {
        if (entry.handler === 'garden_walls') { run_garden_walls(entry); continue; }
        if (entry.handler !== 'teleport_trap' && entry.handler !== 'dig_engraving')
            continue;
        // selection.negate():filter_mapchar(".") — every ROOM ("." char) cell on
        // the level (negate of the empty selection = all cells, filtered to ".").
        // selvar.c selection_rndcoord scans x outer / y inner, so this build
        // order is the one rn2(idx) indexes into.
        const allDots = [];
        for (let x = 0; x < COLNO; x++) {
            for (let y = 0; y < ROWNO; y++) {
                const loc = game.level?.at(x, y);
                if (loc && loc.typ === ROOM) allDots.push({ x, y });
            }
        }
        if (entry.handler === 'dig_engraving') {
            // C ref: themerms.lua:1052 make_dig_engraving(data) — one
            // rndcoord(0) (no removal) over the "." cells, then a burned
            // "Dig ..." engraving there pointing at the buried chest.
            //   tx = data.x - pos.x - 1 ;  ty = data.y - pos.y
            // data.{x,y} are absolute (chest ox/oy) while nhlsel.c:419 already
            // shifted pos by gx.xstart/gy.ystart (1/0 on a random level), so
            // against our absolute pos the deltas are a plain subtraction.  The
            // engraving itself lands back on the absolute cell because
            // get_location() re-adds xstart/ystart (sp_lev.c:1223).
            const pos = selection_rndcoord(allDots, false);
            if (!pos) continue;
            const tx = entry.x - pos.x;
            const ty = entry.y - pos.y;
            let dig = '';
            if (tx === 0 && ty === 0) {
                dig = ' here';
            } else {
                if (tx !== 0) dig = ` ${Math.abs(tx)} ${tx > 0 ? 'east' : 'west'}`;
                if (ty !== 0) dig += ` ${Math.abs(ty)} ${ty > 0 ? 'south' : 'north'}`;
            }
            make_engr_at(pos.x, pos.y, `Dig${dig}`, null, 0, BURN);
            continue;
        }
        // repeat teledest = locs:rndcoord(1) until teledest != trap coord.
        // C ref themerms.lua make_a_trap: the `until` terminates only when BOTH
        // coords differ: `(teledest.x ~= coord.x and teledest.y ~= coord.y)`.
        // So the loop RETRIES (re-rolls rndcoord, shrinking the modulus via the
        // removeit splice) whenever the pick shares EITHER x OR y with the trap
        // cell — hence the break uses && (both differ), not ||.
        let teledest = null;
        while (allDots.length) {
            teledest = selection_rndcoord(allDots, true);
            if (!teledest) break;
            if (teledest.x !== entry.x && teledest.y !== entry.y) break;
        }
        // des.trap -> mktrap teleport: mktrap_victim gate consumes one rnd(4),
        // then the kind<HOLE test fails so no victim is rolled.
        rnd(4);
        await maketrap(entry.x, entry.y, TELEP_TRAP);
    }
}

// C ref: themerms.lua "Ice room".
//   local ice = selection.room();        -- every ROOM cell of the room
//   des.terrain(ice, "I");               -- set those cells to ICE (no RNG)
//   if (percent(25)) then                -- one rn2(100)
//      local mintime = 1000 - (nh.level_difficulty() * 100);
//      ice:iterate(function(x,y)
//         nh.start_timer_at(x,y, "melt-ice", mintime + nh.rn2(1000)); -- rn2(1000)
//      end);
//   end
// The terrain change is RNG-free but load-bearing for rendering: the room
// floor becomes ICE.  The melt timers (one rn2(1000) per cell) only fire when
// the 25% roll passes.
function create_ice_room(croom) {
    const cells = selection_room(croom);
    for (const c of cells) {
        // des.terrain(sel, "I") -> set_levltyp(x,y, ICE); preserve lit state.
        const loc = game.level?.at(c.x, c.y);
        set_levltyp_lit(c.x, c.y, ICE, loc ? loc.lit : false);
    }
    if (percent(25)) {
        // ice:iterate over the SAME selection order; one rn2(1000) per cell.
        for (let i = 0; i < cells.length; i++) rn2(1000);
    }
}

// C ref: themerms.lua "Massacre".
//   local mon = { ...27 player-monster names... };
//   local idx = math.random(#mon);                 -- 1 + rn2(27)
//   for i = 1, d(5,5) do                            -- d(5,5): 5x rn2(5)+5
//      if (percent(10)) then idx = math.random(#mon); end  -- rn2(100) [+rn2(27)]
//      des.object({ id = "corpse", montype = mon[idx] });  -- floor corpse
//   end
// Each des.object corpse is placed at a random in-room cell (somexy: rn2(4)
// somex + rn2(3) somey on the typical filled room) and built by mksobj(CORPSE):
//   next_ident rnd(2) + rndmonst_adj loop + mksobj rn2(2) + start_corpse_timeout,
// then set_corpsenm(montype) does a second start_corpse_timeout (none of these
// player monsters is a lizard/lichen, so the timeout is always the rnz form,
// exactly like Buried zombies).  Massacre corpses are NOT buried (no
// obj_resists) and have NO zombify timer.
const MASSACRE_MON = [
    'apprentice', 'warrior', 'ninja', 'thug',
    'hunter', 'acolyte', 'abbot', 'page',
    'attendant', 'neanderthal', 'chieftain',
    'student', 'wizard', 'valkyrie', 'tourist',
    'samurai', 'rogue', 'ranger', 'priestess',
    'priest', 'monk', 'knight', 'healer',
    'cavewoman', 'caveman', 'barbarian',
    'archeologist',
];

// C ref: nhlib.lua:29 d(dice, faces) — the Lua dice roller used by themed-room
// fills.  Each die is math.random(1, faces) == 1 + nh.rn2(faces), i.e. one
// rn2(faces) per die (NOT the C-internal d()/rnd()).
function lua_d(dice, faces) {
    let sum = 0;
    for (let i = 0; i < dice; i++) sum += 1 + rn2(faces);
    return sum;
}

function create_massacre(croom) {
    const nmon = MASSACRE_MON.length; // 27
    let idx = rn2(nmon); // math.random(#mon) == 1 + rn2(#mon); store 0-based
    const count = lua_d(5, 5); // d(5,5) -> 5x rn2(5)
    for (let i = 0; i < count; i++) {
        if (percent(10)) idx = rn2(nmon); // re-roll species occasionally
        const c = { x: -1, y: -1 };
        if (!somexy(croom, c)) continue;
        const montype = name_to_pmidx(MASSACRE_MON[idx]);
        const otmp = mksobj(CORPSE, true, false); // next_ident + rndmonst + timer
        if (montype >= 0) {
            set_corpsenm(otmp, montype); // override species -> 2nd corpse timeout
        } else {
            // Fall back: still consume the override start_corpse_timeout RNG so
            // the stream stays in lockstep even if the name lookup fails.
            set_corpsenm(otmp, otmp.corpsenm);
        }
        // Place the corpse as a real floor object so it renders as a %-glyph.
        otmp.ox = c.x; otmp.oy = c.y;
        place_floor_obj(otmp, c.x, c.y);
    }
}

// Add a freshly-built object to the floor object chain at (x,y) without any
// further RNG.  Mirrors place_object()/add_to_fobj enough for rendering and
// the fobj scans that level-gen and the pet AI perform.
function place_floor_obj(otmp, x, y) {
    if (!otmp || !game.level) return;
    otmp.ox = x; otmp.oy = y; otmp.where = 'floor';
    const loc = game.level.at(x, y);
    if (loc) {
        otmp.nexthere = loc.objects || null;
        loc.objects = otmp;
    }
    if (!game.level.objects) game.level.objects = [];
    otmp.nobj = game.level.fobj || null;
    game.level.fobj = otmp;
    game.level.objects.push(otmp);
}

// C ref: themerms.lua "Buried zombies".  For each of (rm.width*rm.height)/2
// spots: shuffle a small list of zombifiable species, create a buried corpse of
// the first one, cancel its rot timer and start a zombify timer.  The RNG-exact
// sequence per spot is:
//   shuffle(zombifiable)              -> rn2(4),rn2(3),rn2(2)  (4-elem list)
//   des.object({id="corpse", montype, buried=true}):
//     get_location_coord(DRY)         -> somexy() pairs (somex/somey)
//     mksobj(CORPSE)                  -> next_ident, rndmonnum loop, gender,
//                                        start_corpse_timeout (for random pm)
//     set_corpsenm(montype)           -> start_corpse_timeout (for the override)
//     bury_an_obj -> obj_resists(0,0) -> rn2(100)
//   o:start_timer("zombify-mon", math.random(990,1010)) -> rn2(21)
function create_buried_zombies(croom) {
    const diff = level_difficulty_ext();
    // themerms.lua: { "kobold","gnome","orc","dwarf" } for low difficulty,
    // +elf,human at diff>3, +ettin,giant at diff>6.  Only the list LENGTH is
    // load-bearing for the shuffle RNG; the names drive set_corpsenm's
    // lizard/lichen check (none of these are lizard/lichen -> always a rnz).
    const zombifiable = ['kobold', 'gnome', 'orc', 'dwarf'];
    if (diff > 3) {
        zombifiable.push('elf', 'human');
        if (diff > 6) zombifiable.push('ettin', 'giant');
    }

    const width = 1 + (croom.hx - croom.lx);
    const height = 1 + (croom.hy - croom.ly);
    const count = Math.floor((width * height) / 2);

    for (let i = 0; i < count; i++) {
        // shuffle(zombifiable) — Fisher-Yates via math.random(i) = 1 + rn2(i)
        for (let j = zombifiable.length; j > 1; j--) {
            const k = rn2(j);
            const t = zombifiable[j - 1];
            zombifiable[j - 1] = zombifiable[k];
            zombifiable[k] = t;
        }
        const montype = name_to_pmidx(zombifiable[0]);
        if (montype < 0) continue;

        // des.object random in-room location (get_location_coord DRY).  All
        // themed-room cells are ROOM (SPACE_POS) with no boulder, so the
        // is_ok_location(DRY) test always passes -> exactly one somexy() per
        // corpse (somexy itself retries somex/somey until it lands in the
        // irregular room).
        const c = { x: -1, y: -1 };
        if (!somexy(croom, c)) continue;

        const otmp = mksobj(CORPSE, true, false); // next_ident + random corpsenm + timer
        // set the corpse to the chosen zombifiable species (override) -> a
        // second start_corpse_timeout via set_corpsenm.
        set_corpsenm(otmp, montype);
        // buried = true -> bury_an_obj -> obj_resists(otmp,0,0) -> rn2(100).
        // The corpse is buried (not on the floor), so it is deliberately NOT
        // added to the floor object list: it must not render as a corpse glyph.
        otmp.ox = c.x; otmp.oy = c.y; otmp.where = 'buried';
        obj_resists_rng();

        // o:start_timer("zombify-mon", math.random(990,1010))
        //   math.random(990,1010) = nh.random(990, 21) = 990 + rn2(21)
        rn2(21);
    }
}

// C ref: themerms.lua "Storeroom".
//   local locs = selection.room():percentage(30);   -- rn2(100) per room cell
//   local func = function(x,y)                       -- locs:iterate(func)
//      if (percent(25)) then                         -- rn2(100) per selected cell
//         des.object("chest");                        -- a chest at a random room cell
//      else
//         des.monster({ class = "m", appear_as = "obj:chest" });  -- a mimic
//      end
//   end;
//   locs:iterate(func);
// The (x,y) the iterate passes to func are NOT used by des.object/des.monster
// (no coord arg) — each instead picks its own random in-room location via
// get_location_coord(DRY) -> somexy().  So only the COUNT of percentage-selected
// cells matters; the selection order is irrelevant to the RNG order.
//
// des.object("chest") -> create_object: get_location_coord(DRY) somexy +
//   mksobj(CHEST, TRUE) (next_ident, mksobj_init, mkbox_cnts).
// des.monster({class="m", appear_as="obj:chest"}) -> create_monster:
//   amask = sp_amask_to_amask(AM_SPLEV_RANDOM) -> induced_align() rn2(3);
//   pm = mkclass(S_MIMIC, G_NOGEN);  get_location_coord(DRY) somexy;
//   makemon(pm, x, y, 0) -> next_ident, newmonhp, gender, set_mimic_sym
//   (regular-room branch: rn2(17) over syms[] + mkobj for the shape),
//   m_initinv_full, trailing saddle rn2(100).  The M_AP_OBJECT override to
//   "chest" that create_monster applies afterward consumes no RNG.
const S_MIMIC_CLASS = 13; // monsym.h S_MIMIC
const G_NOGEN_FLAG = 0x0200; // include/permonst.h G_NOGEN
function create_storeroom(croom) {
    // selection.room():percentage(30) — one rn2(100) per ROOM cell of croom,
    // selected when the roll is < 30.  selection_room() walks the room bounds in
    // (x outer, y inner) order, exactly like C's selection_filter_percent over
    // selection_getbounds().
    const cells = selection_room(croom);
    let selected = 0;
    for (let i = 0; i < cells.length; i++) {
        if (rn2(100) < 30) selected++;
    }

    const g = game;
    const was_full = g._full_mon_gen;
    g._full_mon_gen = true;
    try {
        for (let i = 0; i < selected; i++) {
            if (percent(25)) {
                // des.object("chest"): a chest dropped at a random room cell.
                const c = { x: -1, y: -1 };
                if (!somexy(croom, c)) continue;
                const otmp = mksobj(CHEST, true, false);
                otmp.ox = c.x; otmp.oy = c.y;
                place_floor_obj(otmp, c.x, c.y);
            } else {
                // des.monster({class="m", appear_as="obj:chest"}).
                rn2(3); // induced_align(80) (dungeon.c:2012) via sp_amask_to_amask
                const pm = mkclass(S_MIMIC_CLASS, G_NOGEN_FLAG);
                const c = { x: -1, y: -1 };
                if (!somexy(croom, c)) continue;
                // C ref: sp_lev.c create_monster():1977 — "try to find a close
                // place if someone else is already there": when the somexy spot
                // is already occupied by a monster, relocate via enexto()
                // (collect_coords ring shuffle) BEFORE makemon().  A prior mimic
                // from this same iterate loop can land on the same room-relative
                // cell (e.g. two somexy rolls both == (9,3)), triggering this.
                if (mm_mon_at(c.x, c.y)) {
                    const cc = enexto_spawn(c.x, c.y, pm);
                    if (cc) { c.x = cc.x; c.y = cc.y; }
                }
                // C ref: create_monster:1981 — if the (possibly relocated) spot
                // falls outside croom, skip this monster (C `return`).
                if (croom && !inside_room(croom, c.x, c.y)) continue;
                const mtmp = makemon(pm, c.x, c.y, 0);
                // C create_monster overrides the mimic's appearance to a chest
                // object (M_AP_OBJECT) — no further RNG.  Mark it so the renderer
                // shows a "(" (chest) glyph rather than the mimic letter.
                if (mtmp) {
                    mtmp.m_ap_type = 'obj';
                    mtmp.mappearance = CHEST;
                }
            }
        }
    } finally {
        g._full_mon_gen = was_full;
    }
}

// C ref: include/defsym.h MONSYM() — monster-class (S_*) indices, as used by
// mkclass().  js/makemon.js keys its per-class switches off the same numbers.
export const S_HUMANOID = 8,
    S_KOBOLD = 11, S_ORC = 15, S_CENTAUR = 29, S_DRAGON = 30, S_GNOME = 33,
    S_GIANT = 34, S_TROLL = 46, S_VAMPIRE_CLASS = 48, S_ZOMBIE = 52,
    S_DEMON = 56;
// C ref: monflags.h G_UNIQ — a one-of-a-kind species, never a random pick.
const G_UNIQ = 0x1000;
// C ref: include/onames.h MACE (mkobj.js OBJECT_DATA otyp column).
const MACE_OTYP = 73;

// C ref: mkroom.c mk_zoo_thronemon(x, y) — the sleeping monarch who sits on the
// throne of a COURT.  rnd(level_difficulty()) picks the species; the mace is
// "a sceptre to pound in judgment".  set_malign() only writes mtmp->malign (the
// alignment-record delta applied when the hero kills it), which this port does
// not model and which draws no RNG.
function mk_zoo_thronemon(x, y) {
    const i = rnd(level_difficulty_ext());
    const name = (i > 9) ? 'ogre tyrant'
        : (i > 5) ? 'elven monarch'
            : (i > 2) ? 'dwarf ruler'
                : 'gnome ruler';
    const ptr = monster_by_pmidx(name_to_pmidx(name));
    const mon = makemon(ptr, x, y, 0 /* NO_MM_FLAGS */);
    if (mon) {
        mon.msleeping = 1;
        mon.mpeaceful = false;
        mongets_pub(mon, MACE_OTYP); /* a sceptre to pound in judgment */
    }
}

// C ref: mkroom.c courtmon() — the throne room's rank and file.  Both rn2()s
// are always drawn (C sums them before any test), and each mkclass() draw
// happens inside mkclass_aligned().
function courtmon() {
    const i = rn2(60) + rn2(3 * level_difficulty_ext());
    if (i > 100) return mkclass(S_DRAGON, 0);
    if (i > 95) return mkclass(S_GIANT, 0);
    if (i > 85) return mkclass(S_TROLL, 0);
    if (i > 75) return mkclass(S_CENTAUR, 0);
    if (i > 60) return mkclass(S_ORC, 0);
    if (i > 45) return monster_by_pmidx(name_to_pmidx('bugbear'));
    if (i > 30) return monster_by_pmidx(name_to_pmidx('hobgoblin'));
    if (i > 15) return mkclass(S_GNOME, 0);
    return mkclass(S_KOBOLD, 0);
}

// C ref: minion.c ndemon(atyp) — a randomly picked demon of the wanted
// alignment (A_NONE meaning "any"), or NON_PM.  mkclass_aligned does the draw.
function ndemon(atyp) {
    const ptr = mkclass_aligned(S_DEMON, 0, atyp);
    return (ptr && is_ndemon(ptr)) ? ptr : null;
}

// C ref: mondata.h is_ndemon() — a non-unique demon (lord/prince and the named
// demons are G_UNIQ and excluded from a random "nameless demon" pick).
function is_ndemon(ptr) {
    return ptr.mcls === S_DEMON && !(ptr.geno & G_UNIQ);
}

// C ref: mkroom.c morguemon() — the graveyard's inhabitants.  BOTH rn2()s are
// always drawn (C evaluates them in the declaration list before any test).
function morguemon() {
    const i = rn2(100), hd = rn2(level_difficulty_ext());

    if (hd > 10 && i < 10) {
        if (Inhell_lev() || In_endgame_lev()) return mkclass(S_DEMON, 0);
        const nd = ndemon(A_NONE);
        if (nd) return nd;
        /* else fall through to ghost/wraith/zombie */
    }
    if (hd > 8 && i > 85) return mkclass(S_VAMPIRE_CLASS, 0);
    return (i < 20) ? monster_by_pmidx(name_to_pmidx('ghost'))
        : (i < 40) ? monster_by_pmidx(name_to_pmidx('wraith'))
            : mkclass(S_ZOMBIE, 0);
}

// C ref: dungeon.h Inhell (== In_hell(&u.uz)) / In_endgame.  No RNG.
function Inhell_lev() { return In_hell(game.u?.uz); }
function In_endgame_lev() { return In_endgame(game.u?.uz); }

// C ref: mkroom.c antholemon() — the ant species an ANTHOLE is stocked with.
// Fixed for the whole level: ((ubirthday % 3) + level_difficulty() + trycnt) % 3
// with up to 3 tries past an extinct species.  Draws no RNG, but the species it
// returns feeds makemon(), whose newmonhp/mongets draws depend on it.
const ANTHOLEMON = ['soldier ant', 'fire ant', 'giant ant'];
// C ref: u_init.c ubirthday (game-start wall clock, seconds).  shknam.js
// nameshk() derives the same value and documents why the recording offset is a
// fixed UTC-4; it is not exported, so the arithmetic is repeated here.
function ubirthday_seconds() {
    const dt = String(game.datetime || '');
    if (!/^\d{14}$/.test(dt)) return 0;
    const y = +dt.slice(0, 4), mo = +dt.slice(4, 6), d = +dt.slice(6, 8);
    const h = +dt.slice(8, 10), mi = +dt.slice(10, 12), s = +dt.slice(12, 14);
    return Math.trunc(Date.UTC(y, mo - 1, d, h, mi, s) / 1000) + 4 * 3600;
}
function antholemon() {
    const indx = (ubirthday_seconds() % 3) + level_difficulty_ext();
    return monster_by_pmidx(name_to_pmidx(ANTHOLEMON[((indx % 3) + 3) % 3]));
}

// C ref: mkroom.c fill_zoo(sroom) head — the per-type preamble that runs before
// the stocking loop.  Returns the {tx,ty} the loop needs (the throne square for
// COURT, the queen's square for BEEHIVE) plus ZOO/LEPREHALL's gold budget.
// COURT's `goto throne_placed` is expressed as an early return from the maze
// scan.
function fill_zoo_head(sroom, type, rmno) {
    const g = game;
    if (type === COURT) {
        // A maze-style level may have an explicitly placed throne; use it and
        // skip the random search entirely (C's `goto throne_placed`).
        if (g.level?.flags?.is_maze_lev) {
            for (let tx = sroom.lx; tx <= sroom.hx; tx++)
                for (let ty = sroom.ly; ty <= sroom.hy; ty++)
                    if (g.level.at(tx, ty)?.typ === THRONE)
                        return { x: tx, y: ty, goldlim: 0 };
        }
        // "don't place throne on top of stairs"
        const mm = { x: 0, y: 0 };
        let i = 100;
        do {
            somexyspace(sroom, mm);
        } while (occupied(mm.x, mm.y) && --i > 0);
        return { x: mm.x, y: mm.y, goldlim: 0 };
    }
    if (type === BEEHIVE) {
        let tx = sroom.lx + Math.trunc((sroom.hx - sroom.lx + 1) / 2);
        let ty = sroom.ly + Math.trunc((sroom.hy - sroom.ly + 1) / 2);
        // mkroom.c:305 — an irregular room's arithmetic centre may not belong
        // to it, so the queen moves to a random space instead (one somexyspace).
        if (sroom.irregular) {
            const loc = g.level?.at(tx, ty);
            if (!loc || loc.roomno !== rmno || loc.edge) {
                const mm = { x: 0, y: 0 };
                somexyspace(sroom, mm);
                tx = mm.x; ty = mm.y;
            }
        }
        return { x: tx, y: ty, goldlim: 0 };
    }
    if (type === ZOO || type === LEPREHALL)
        return { x: 0, y: 0, goldlim: 500 * level_difficulty_ext() };
    // MORGUE / BARRACKS / COCKNEST / ANTHOLE have no case in C's preamble
    // switch at all, so the stocking loop starts straight away and tx/ty stay 0
    // (only the COURT/BEEHIVE arms ever read them).
    return { x: 0, y: 0, goldlim: 0 };
}

// C ref: mkroom.c fill_zoo(sroom) — stock a special room.  Every type C's
// fill_special_room() routes here is handled except BARRACKS, which this port
// keeps in its own fill_zoo_barracks().
//
// BEEHIVE consumes NO RNG in the head unless the room is irregular and its
// arithmetic centre is not its own; otherwise tx/ty is that centre.
// COURT spends somexyspace() per throne-placement attempt plus
// mk_zoo_thronemon()'s rnd(level_difficulty()).
//
// Then, for every stockable square in row-major order, C runs
//   makemon(<per-type species>, sx, sy, MM_ASLEEP | MM_NOGRP);
//   <per-type object roll>
// MM_NOGRP is load-bearing: it suppresses makemon's G_SGROUP/G_LGROUP draws,
// which killer bees (and orcs in a court) would otherwise trigger.  MM_ASLEEP
// only sets msleeping, which fill_zoo assigns explicitly right afterwards.
function fill_zoo(sroom) {
    const g = game;
    // Stocking a special room runs the fully C-faithful monster path (the same
    // flag stock_room() and the special-level generators use): peace_minded(),
    // the MON_AT collision check and placement on the level all matter here,
    // and C's fill_zoo depends on all three.
    const was_full = g._full_mon_gen;
    g._full_mon_gen = true;
    try {
        fill_zoo_core(sroom);
    } finally {
        g._full_mon_gen = was_full;
    }
}

function fill_zoo_core(sroom) {
    const g = game;
    const LUMP_OF_ROYAL_JELLY = 286;
    const type = sroom.rtype;
    const rmno = (g.level?.rooms?.indexOf(sroom) ?? -1) + ROOMOFFSET;

    const centre = fill_zoo_head(sroom, type, rmno);
    if (!centre) return;
    const tx = centre.x, ty = centre.y;
    let goldlim = centre.goldlim;
    if (type === COURT)
        mk_zoo_thronemon(tx, ty);

    const queen = (type === BEEHIVE) ? monster_by_pmidx(name_to_pmidx('queen bee')) : null;
    const killer = (type === BEEHIVE) ? monster_by_pmidx(name_to_pmidx('killer bee')) : null;
    if (type === BEEHIVE && (!queen || !killer)) return;
    const leprechaun = (type === LEPREHALL)
        ? monster_by_pmidx(name_to_pmidx('leprechaun')) : null;
    const cockatrice = (type === COCKNEST)
        ? monster_by_pmidx(name_to_pmidx('cockatrice')) : null;

    const sh = sroom.fdoor;
    const door = g.level?.doors?.[sh];
    for (let sx = sroom.lx; sx <= sroom.hx; sx++) {
        for (let sy = sroom.ly; sy <= sroom.hy; sy++) {
            if (sroom.irregular) {
                const loc = g.level?.at(sx, sy);
                if (!loc || loc.roomno !== rmno || loc.edge
                    || (sroom.doorct && door
                        && distmin(sx, sy, door.x, door.y) <= 1))
                    continue;
            } else {
                // C: `!SPACE_POS(levl[sx][sy].typ) || (doorct && <square abuts
                // the first door from outside>)` -> skip.
                const typ = g.level?.at(sx, sy)?.typ;
                if (typ == null || !SPACE_POS(typ)) continue;
                if (sroom.doorct && door
                    && ((sx === sroom.lx && door.x === sx - 1)
                        || (sx === sroom.hx && door.x === sx + 1)
                        || (sy === sroom.ly && door.y === sy - 1)
                        || (sy === sroom.hy && door.y === sy + 1)))
                    continue;
            }
            /* don't place a monster on an explicitly placed throne */
            if (type === COURT && g.level?.at(sx, sy)?.typ === THRONE) continue;

            // C ref: mkroom.c:342-360 — the species ternary chain.  ZOO's arm
            // is the trailing `(struct permonst *) 0`, i.e. makemon picks a
            // random monster (rndmonst + its goodpos retry loop).
            const ptr = (type === COURT) ? courtmon()
                : (type === MORGUE) ? morguemon()
                    : (type === BEEHIVE)
                        ? ((sx === tx && sy === ty) ? queen : killer)
                        : (type === LEPREHALL) ? leprechaun
                            : (type === COCKNEST) ? cockatrice
                                : (type === ANTHOLE) ? antholemon()
                                    : null;
            const mon = makemon(ptr, sx, sy, MM_ASLEEP | MM_NOGRP);
            if (mon) {
                mon.msleeping = 1;
                if (type === COURT && mon.mpeaceful) {
                    mon.mpeaceful = false;
                    /* set_malign(mon) — see mk_zoo_thronemon */
                }
            }
            if (type === ZOO || type === LEPREHALL) {
                // C ref: mkroom.c:365-375 — the gold budget walks down as each
                // square is paid out.  `i = sq(distval)` squares an ALREADY
                // squared distance (dist2), so any square more than ~2 away
                // from the room's first door immediately trips the `i >=
                // goldlim` clamp down to 5 * level_difficulty().
                let i;
                if (sroom.doorct && door) {
                    const distval = dist2(sx, sy, door.x, door.y);
                    i = distval * distval;
                } else {
                    i = goldlim;
                }
                if (i >= goldlim) i = 5 * level_difficulty_ext();
                goldlim -= i;
                mkgold(rn1(i, 10), sx, sy);
            }
            if (type === BEEHIVE && !rn2(3))
                mksobj_at(LUMP_OF_ROYAL_JELLY, sx, sy, true, false);
            if (type === MORGUE) {
                // C ref: mkroom.c fill_zoo() MORGUE arm — a dead adventurer's
                // corpse, buried treasure, and a grave, each on its own roll.
                if (!rn2(5)) mk_tt_object(CORPSE, sx, sy);      // mkroom.c:384
                if (!rn2(10))                                   // mkroom.c:386
                    mksobj_at(rn2(3) ? LARGE_BOX : CHEST, sx, sy, true, false);
                if (!rn2(5)) make_grave(sx, sy, null);          // mkroom.c:389
            }
            if (type === COCKNEST && !rn2(3)) {
                // C ref: mkroom.c:400-408 — a statue of a random monster with
                // rn2(5) random items stuffed inside it.
                const sobj = mk_tt_object(STATUE, sx, sy);
                if (sobj) {
                    for (let i = rn2(5); i; i--)
                        add_to_container(sobj, mkobj(RANDOM_CLASS, false));
                    sobj.owt = weight(sobj);
                }
            }
            if (type === ANTHOLE && !rn2(3))                     // mkroom.c:412
                mkobj_at(FOOD_CLASS, sx, sy, false);
        }
    }

    if (type === COURT) {
        // The throne, and the royal coffers beside it.
        const loc = g.level?.at(tx, ty);
        if (loc) loc.typ = THRONE;
        const mm = { x: 0, y: 0 };
        somexyspace(sroom, mm);
        const gold = mksobj(GOLD_PIECE, true, false);
        gold.quan = 10 + rn2(50 * level_difficulty_ext()); // rn1(50*ld, 10)
        gold.owt = weight(gold);
        const chest = mksobj_at(CHEST, mm.x, mm.y, true, false);
        add_to_container(chest, gold);
        chest.owt = weight(chest);
        chest.spe = 2; /* so it can be found later */
        if (g.level?.flags) g.level.flags.has_court = true;
    } else if (type === BEEHIVE) {
        if (g.level?.flags) g.level.flags.has_beehive = true;
    }
}

// C ref: mkroom.c squadprob[] — the soldier mix a barracks is filled with.
const SQUADPROB = [
    ['soldier', 80], ['sergeant', 15], ['lieutenant', 4], ['captain', 1],
];

// C ref: mkroom.c squadmon() — one rnd(80 + level_difficulty()) picks the rank
// off the cumulative table; a roll past the table's total falls back to a flat
// rn2(SIZE) pick (the ROLL_FROM macro).
function squadmon() {
    const sel_prob = rnd(80 + level_difficulty_ext());
    let cpro = 0;
    for (const [name, prob] of SQUADPROB) {
        cpro += prob;
        if (cpro > sel_prob) return monster_by_pmidx(name_to_pmidx(name));
    }
    return monster_by_pmidx(name_to_pmidx(SQUADPROB[rn2(SQUADPROB.length)][0]));
}

// C ref: mkroom.c fill_zoo() — the BARRACKS case.  Every eligible square gets a
// sleeping soldier, and 1 in 20 also gets the payroll box.  The head of
// fill_zoo() draws nothing for BARRACKS (only COURT/BEEHIVE/ZOO/LEPREHALL do).
function fill_zoo_barracks(sroom) {
    const g = game;
    const sh = sroom.fdoor;
    const door = g.level?.doors?.[sh];
    for (let sx = sroom.lx; sx <= sroom.hx; sx++) {
        for (let sy = sroom.ly; sy <= sroom.hy; sy++) {
            // C ref: fill_zoo() mkroom.c:331-340 — the non-irregular skip.  Note
            // the door test compares only the door's x (or y) against the room
            // edge, so a door beside one corner blanks that whole edge column.
            const typ = g.level?.at(sx, sy)?.typ;
            if (typ == null || !SPACE_POS(typ)) continue;
            if (sroom.doorct && door
                && ((sx === sroom.lx && door.x === sx - 1)
                    || (sx === sroom.hx && door.x === sx + 1)
                    || (sy === sroom.ly && door.y === sy - 1)
                    || (sy === sroom.hy && door.y === sy + 1)))
                continue;
            const mon = makemon(squadmon(), sx, sy, MM_ASLEEP | MM_NOGRP);
            if (mon) mon.msleeping = 1;
            if (!rn2(20))
                mksobj_at(rn2(3) ? LARGE_BOX : CHEST, sx, sy, true, false);
        }
    }
    if (g.level?.flags) g.level.flags.has_barracks = true;
}

// C ref: sp_lev.c add_doors_to_room() — register every door on (or just
// outside) the room's boundary with the room.  No RNG.
export function add_doors_to_room(croom) {
    if (!croom) return;
    for (let x = croom.lx - 1; x <= croom.hx + 1; x++)
        for (let y = croom.ly - 1; y <= croom.hy + 1; y++) {
            const typ = game.level?.at(x, y)?.typ;
            if (typ == null) continue;
            if (IS_DOOR(typ) || typ === SDOOR) sp_add_door(x, y, croom);
        }
    for (let i = 0; i < (croom.nsubrooms || 0); i++)
        add_doors_to_room(croom.sbrooms[i]);
}

// C ref: mklev.c add_door() — append to the level's door list, keeping each
// room's doors contiguous from its fdoor index.  No RNG.
function sp_add_door(x, y, aroom) {
    const lev = game.level;
    if (!lev) return;
    if (!lev.doors) lev.doors = [];
    if (lev.doorindex == null) lev.doorindex = lev.doors.length;
    for (let i = 0; i < aroom.doorct; i++) {
        const d = lev.doors[aroom.fdoor + i];
        if (d && d.x === x && d.y === y) return;
    }
    if (aroom.doorct === 0) aroom.fdoor = lev.doorindex;
    aroom.doorct++;
    for (let tmp = lev.doorindex; tmp > aroom.fdoor; tmp--)
        lev.doors[tmp] = lev.doors[tmp - 1];
    for (let i = 0; i < lev.nroom; i++) {
        const broom = lev.rooms[i];
        if (broom && broom !== aroom && broom.doorct && broom.fdoor >= aroom.fdoor)
            broom.fdoor++;
    }
    lev.doorindex++;
    lev.doors[aroom.fdoor] = { x, y };
}

// C ref: sp_lev.c fill_special_room() — fills vaults, zoos, shops, etc.
export function fill_special_room(croom) {
    if (!croom) return;

    for (let i = 0; i < (croom.nsubrooms || 0); i++) {
        fill_special_room(croom.sbrooms?.[i]);
    }

    if (croom.rtype === OROOM || croom.rtype === THEMEROOM
        || croom.needfill === FILL_NONE)
        return;

    if (croom.needfill === FILL_NORMAL) {
        if (croom.rtype >= SHOPBASE) {
            // C ref: sp_lev.c fill_special_room() shop case -> stock_room().
            stock_room(croom.rtype - SHOPBASE, croom);
            return;
        }

        switch (croom.rtype) {
        case VAULT: {
            // C ref: sp_lev.c fill_special_room() VAULT case — fills EVERY
            // vault square with gold via mkgold(rn1(|depth|*100, 51), x, y).
            // The gold piles are real floor objects (on the dark, unseen vault
            // squares) and join the fobj chain, so the pet's dog_goal scan sees
            // them.  The port previously rolled the RNG but never placed the
            // gold, under-populating fobj and desyncing the multi-pass pet scan.
            const d = Math.abs(depth_of_level(game.u?.uz));
            for (let x = croom.lx; x <= croom.hx; x++) {
                for (let y = croom.ly; y <= croom.hy; y++) {
                    const amount = 51 + rn2(d * 100); // rn1(d*100, 51)
                    mkgold(amount, x, y);             // mksobj_at → next_ident rnd(2)
                }
            }
            break;
        }
        case COURT:
        case ZOO:
        case BEEHIVE:
        case ANTHOLE:
        case COCKNEST:
        case LEPREHALL:
        case MORGUE:
            // C ref: sp_lev.c fill_special_room() -> fill_zoo(croom).
            fill_zoo(croom);
            break;
        case BARRACKS:
            // C ref: mkroom.c fill_zoo()'s BARRACKS arm, which this port has as
            // its own function (squadmon + the payroll box).
            fill_zoo_barracks(croom);
            break;
        default:
            // C ref: sp_lev.c:2758-2773 — the switch has no other cases.
            // SWAMP/TEMPLE/DELPHI are stocked by their own makers in mklev.c,
            // not here; they only reach the level-flag tail below.
            break;
        }
    }

    // C ref: sp_lev.c fill_special_room():2778-2803 — the level flags are set
    // for EVERY special room, outside the needfill == FILL_NORMAL block.  A
    // `filled = 2` room (castle.lua's throne room) therefore still flags the
    // level even though nothing is spawned in it; dosounds() reads these.
    const lf = game.level?.flags;
    if (!lf) return;
    switch (croom.rtype) {
    case VAULT: lf.has_vault = true; break;
    case ZOO: lf.has_zoo = true; break;
    case COURT: lf.has_court = true; break;
    case MORGUE: lf.has_morgue = true; break;
    case BEEHIVE: lf.has_beehive = true; break;
    case BARRACKS: lf.has_barracks = true; break;
    case TEMPLE: lf.has_temple = true; break;
    case SWAMP: lf.has_swamp = true; break;
    default: break;
    }
}

// C ref: sp_lev.c room_types[] — the des-file room-type names, in the order
// get_table_roomtype_opt() searches them.  Only the types the ported levels
// actually name are listed; anything else falls back to OROOM exactly as an
// unrecognised name would.
const ROOM_TYPE_BY_NAME = {
    ordinary: OROOM, themed: THEMEROOM, throne: COURT, swamp: SWAMP,
    vault: VAULT, beehive: BEEHIVE, morgue: MORGUE, barracks: BARRACKS,
    zoo: ZOO, delphi: DELPHI, temple: TEMPLE, anthole: ANTHOLE, cocknest: COCKNEST,
    leprehall: LEPREHALL, shop: SHOPBASE,
};

export function lspo_region({ region, type = 'ordinary', irregular = false,
                              filled = 0, joined = true, lit = -1,
                              contents = null }) {
    let [dx1, dy1, dx2, dy2] = region;
    const rtype = ROOM_TYPE_BY_NAME[type] ?? OROOM;
    const rlit = litstate_rnd(lit);

    dx1 += gx.xstart;
    dy1 += gy.ystart;
    dx2 += gx.xstart;
    dy2 += gy.ystart;

    let croom;
    if (irregular) {
        const roomno = game.level.nroom + ROOMOFFSET;
        const flood = flood_fill_room(dx1, dy1, roomno, rlit);
        if (!flood.cells.length) return null;
        croom = add_sp_room(flood.minx, flood.miny, flood.maxx, flood.maxy,
                            rlit, rtype, true, filled, joined);
    } else {
        croom = add_sp_room(dx1, dy1, dx2, dy2, rlit, rtype, false, filled, joined);
        const roomno = croom.roomnoidx + ROOMOFFSET;
        for (let x = dx1; x <= dx2; x++)
            for (let y = dy1; y <= dy2; y++) {
                const loc = game.level?.at(x, y);
                if (loc) {
                    loc.roomno = roomno;
                    loc.lit = !!rlit;
                }
            }
    }

    if (contents) contents(croom);
    // C ref: lspo_region() tail — spo_endroom() then add_doors_to_room(troom).
    add_doors_to_room(croom);
    return croom;
}

export function filler_region(x, y) {
    let rmtyp = 'ordinary';
    let func = null;
    if (percent(30)) {
        rmtyp = 'themed';
        func = themeroom_fill;
    }
    return lspo_region({
        region: [x, y, x, y],
        type: rmtyp,
        irregular: true,
        filled: 1,
        contents: func,
    });
}

// C ref: themerms.lua — the per-themeroom des.map() contents callback.
// Most map themerooms simply call filler_region(fx,fy). A few have extra logic
// (and thus extra RNG) BEFORE the filler_region call; this dispatcher mirrors
// each room's contents() faithfully so the rn2/rnd call sequence matches C.
// `name` is the themeroom name; (fx,fy) the filler_region anchor.
// C ref: dat/themerms.lua:759 'Water-surrounded vault' contents.  This was the
// last themeroom left with `filler: null` in mklev.js's THEMEROOM_MAPS — the map
// was placed but its contents callback never ran, so every draw below was
// skipped and any level rolling this room desynced immediately.  It is invisible
// on the public 44 (none of them roll it) and it is exactly what broke the
// held-out proxy's samurai session: RNG diverged at call 464 of level generation
// for 0/264 screens.
//
// The order matters as much as the draws:
//   des.region({3,3,3,3} themed irregular filled=0 joined=false) -> litstate_rnd
//   shuffle(chest_spots)            -- 4 elements: rn2(4), rn2(3), rn2(2)
//   math.random(#escape_items)      -- rn2(4)
//   obj.new(escape_items[i])        -- the item is created BEFORE the chest
//   des.object({id="chest", coord=chest_spots[1]})   (+ olocked="no" if glass)
//   box:addcontent(itm)
//   des.object({id="chest"}) for chest_spots[2..4]
//   shuffle(nasty_undead)           -- 3 elements: rn2(3), rn2(2)
//   des.monster(nasty_undead[1], 2, 2)
//   des.exclusion(teleport)         -- no RNG
function themeroom_water_vault() {
    // The inner vault floor.  lit defaults to -1, so lspo_region calls
    // litstate_rnd -> rnd(1 + abs(depth)), then a short-circuited rn2(77).
    lspo_region({ region: [3, 3, 3, 3], type: 'themed', irregular: true,
                  filled: 0, joined: false });

    const chest_spots = [[2, 2], [3, 2], [2, 3], [3, 3]];
    shuffle(chest_spots);

    // themerms.lua:791 — math.random(#escape_items) is 1-based in Lua; the
    // recorder logs the underlying rn2(4).
    const escape_items = ['scroll of teleportation', 'ring of teleportation',
                          'wand of teleportation', 'wand of digging'];
    const pickIdx = rn2(escape_items.length);
    // obj.new(name) resolves the name through the same readobjnam() path a wish
    // uses (hence rnd_otyp_by_namedesc with xtra_prob 1) and creates the object.
    const made = readobjnam(escape_items[pickIdx]);
    const itm = made && made.obj ? made.obj : (made && made.otyp != null ? made : null);

    // "If the escape item is made of glass or crystal, make sure that the chest
    // isn't locked" — objclass.h material GLASS is 19 (see js/zap.js's
    // wrong-constant note; 6 is CLOTH).
    const MAT_GLASS = 19;
    const isGlass = !!itm && OBJDATA[itm.otyp]?.material === MAT_GLASS;

    const boxes = [];
    for (let i = 0; i < chest_spots.length; i++) {
        const [mx, my] = chest_spots[i];
        const bx = mx + gx.xstart, by = my + gy.ystart;
        const box = mksobj_at(CHEST, bx, by, true, true);  // init + mkbox_cnts
        if (i === 0 && box && isGlass) box.olocked = false; // olocked = "no"
        boxes.push(box);
    }
    // box:addcontent(itm) — no RNG; the item leaves the floor for the chest.
    if (boxes[0] && itm) {
        if (!Array.isArray(boxes[0].cobj)) boxes[0].cobj = [];
        itm.where = 'contained';
        itm.ocontainer = boxes[0];
        boxes[0].cobj.push(itm);
    }

    const nasty_undead = ['giant zombie', 'ettin zombie', 'vampire lord'];
    shuffle(nasty_undead);
    quest_create_monster(nasty_undead[0], 2, 2);
    // des.exclusion({type="teleport", region={2,2,3,3}}) — state only, no RNG.
    const g = game;
    (g.level.exclusions || (g.level.exclusions = [])).push({
        type: 'teleport', lx: 2 + gx.xstart, ly: 2 + gy.ystart,
        hx: 3 + gx.xstart, hy: 3 + gy.ystart,
    });
}

export function themeroom_map_contents(name, fx, fy) {
    if (name === 'Water-surrounded vault') { themeroom_water_vault(); return; }
    if (name === 'Blocked center') {
        // themerms.lua 'Blocked center':
        //   if (percent(30)) then
        //      local terr = { "-", "P" }; shuffle(terr);
        //      des.replace_terrain({ region={1,1,9,9}, fromterrain="L",
        //                            toterrain=terr[1] });
        //   end
        //   filler_region(1,1);
        if (percent(30)) {
            const terr = ['-', 'P'];
            shuffle(terr); // 2-elem shuffle → one rn2(2)
            // replace_terrain over region {1,1,9,9}, fromterrain="L"
            // (chance defaults to 100). C lspo_replace_terrain emits rn2(100)
            // for each cell whose typ == LAVAPOOL ("L") and, when it passes,
            // overwrites the cell with toterrain. The Blocked-center map has
            // a 3x3 LAVAPOOL block (9 cells) entirely inside {1,1,9,9}.
            const totyp = terr[0] === '-' ? HWALL : POOL;
            quest_replace_terrain(1, 1, 9, 9, LAVAPOOL, totyp, 100);
        }
    }
    if (fx >= 0 && fy >= 0) filler_region(fx, fy);
}

// C ref: sp_lev.c lspo_map() halign/valign codes.
const SPLEV_LEFT = 0, SPLEV_H_LEFT = 1, SPLEV_CENTER = 2, SPLEV_H_RIGHT = 3,
      SPLEV_RIGHT = 4, SPLEV_TOP = 5, SPLEV_BOTTOM = 6;
const HALIGN2I = { left: SPLEV_LEFT, 'half-left': SPLEV_H_LEFT,
                   center: SPLEV_CENTER, 'half-right': SPLEV_H_RIGHT,
                   right: SPLEV_RIGHT, none: -1 };
const VALIGN2I = { top: SPLEV_TOP, center: SPLEV_CENTER,
                   bottom: SPLEV_BOTTOM, none: -1 };

// Where the last des.map() landed — map-relative coords inside a contents()
// callback are resolved against this (C ref: sp_lev.c get_location(), which
// adds gx.xstart/gy.ystart when there is no enclosing room).
// C ref: sp_lev.c remove_boundary_syms() — the 'B' map symbol stamps a
// CROSSWALL purely so region flood-fills stop at it; once the regions are laid
// out every such cell that came from the level's own map becomes ROOM again.
// Called from lspo_finalize_level(), so only special levels see it.  No RNG.
export function remove_boundary_syms() {
    let has_bounds = false;
    for (let x = 0; x < COLNO - 1 && !has_bounds; x++)
        for (let y = 0; y < ROWNO - 1; y++)
            if (game.level?.at(x, y)?.typ === CROSSWALL) { has_bounds = true; break; }
    if (!has_bounds) return;
    // C guards on SpLev_Map[x][y] (the cells this level's des.map() stamped);
    // every CROSSWALL on such a level came from that map, so the guard is
    // implied here.
    for (let x = 0; x < gx.x_maze_max; x++)
        for (let y = 0; y < gy.y_maze_max; y++) {
            const loc = game.level?.at(x, y);
            if (loc && loc.typ === CROSSWALL) loc.typ = ROOM;
        }
}

export function splev_map_origin() {
    return { xstart: gx.xstart, ystart: gy.ystart,
             xsize: gx.xsize, ysize: gy.ysize };
}

// C ref: sp_lev.c `static char SpLev_Map[COLNO][ROWNO]` — every square the
// level loader wrote.  load_special() memsets it at entry; lspo_map(),
// sel_set_door(), l_create_stairway() and lspo_drawbridge() set it; maze1xy()
// and fill_empty_maze() read it to find the parts of the maze the special
// level did NOT claim.  Modelled as a Set of "x,y" keys.
export function splev_map_reset() { game._splev_map = new Set(); }
export function splev_map_mark(x, y) {
    if (!game._splev_map) game._splev_map = new Set();
    game._splev_map.add(x + ',' + y);
}
export function splev_map_at(x, y) {
    return !!game._splev_map?.has(x + ',' + y);
}

export function lspo_map({ map, x = -1, y = -1, halign = 'none',
                           valign = 'none', lit = false, contents = null,
                           in_themerooms = true }) {
    if (in_themerooms && game.themeroom_failed) return null;

    const mf = mapfrag_fromstr(map);
    if (!mf || !mf.wid || !mf.hei) return null;

    const lr = HALIGN2I[halign] ?? -1;
    const tb = VALIGN2I[valign] ?? -1;
    const sel = selection_new();
    const ox = x;
    const oy = y;
    let tryct = 0;

    for (;;) {
        gx.xsize = mf.wid;
        gy.ysize = mf.hei;

        if (lr === -1 && tb === -1) {
            if (in_themerooms) {
                if (ox === -1) x = 1 + rn2(COLNO - 1 - mf.wid);
                if (oy === -1) y = rn2(ROWNO - mf.hei);
            }
            if (!isok(x, y)) {
                reset_xystart_size();
                return null;
            }
            gx.xstart = x;
            gy.ystart = y;
        } else {
            // C ref: sp_lev.c lspo_map() — "place map starting at
            // halign,valign".  x_maze_max/y_maze_max here are the decl.c
            // defaults ((COLNO-1)&~1 and (ROWNO-1)&~1); no RNG is involved.
            const xmm = (COLNO - 1) & ~1, ymm = (ROWNO - 1) & ~1;
            switch (lr) {
            case SPLEV_LEFT: gx.xstart = 1; break;
            case SPLEV_H_LEFT:
                gx.xstart = 2 + Math.trunc((xmm - 2 - gx.xsize) / 4); break;
            case SPLEV_CENTER:
                gx.xstart = 2 + Math.trunc((xmm - 2 - gx.xsize) / 2); break;
            case SPLEV_H_RIGHT:
                gx.xstart = 2 + Math.trunc((xmm - 2 - gx.xsize) * 3 / 4); break;
            case SPLEV_RIGHT: gx.xstart = xmm - gx.xsize - 1; break;
            default: break;
            }
            switch (tb) {
            case SPLEV_TOP: gy.ystart = 3; break;
            case SPLEV_CENTER:
                gy.ystart = 2 + Math.trunc((ymm - 2 - gy.ysize) / 2); break;
            case SPLEV_BOTTOM: gy.ystart = ymm - gy.ysize - 1; break;
            default: break;
            }
            if (!(gx.xstart % 2)) gx.xstart++;
            if (!(gy.ystart % 2)) gy.ystart++;
        }

        if (gy.ystart < 0 || gy.ystart + gy.ysize > ROWNO) {
            if (in_themerooms) {
                game.themeroom_failed = true;
                reset_xystart_size();
                return null;
            }
            // C: "try to move the start a bit"
            gy.ystart += (gy.ystart > 0) ? -2 : 2;
            if (gy.ysize === ROWNO) gy.ystart = 0;
            if (gy.ystart < 0 || gy.ystart + gy.ysize > ROWNO) gy.ystart = 0;
        }

        // C ref: "Themed rooms should never overwrite anything" — this
        // collision check runs only for themeroom maps.
        if (!in_themerooms) break;

        let isokp = true;
        for (let yy = gy.ystart - 1;
             yy < Math.min(ROWNO, gy.ystart + gy.ysize) + 1 && isokp; yy++) {
            for (let xx = gx.xstart - 1;
                 xx < Math.min(COLNO, gx.xstart + gx.xsize) + 1; xx++) {
                const loc = game.level?.at(xx, yy);
                if (!isok(xx, yy) || !loc) {
                    isokp = false;
                } else if (yy < gy.ystart || yy >= gy.ystart + gy.ysize
                           || xx < gx.xstart || xx >= gx.xstart + gx.xsize) {
                    if (loc.typ !== STONE || loc.roomno !== NO_ROOM) isokp = false;
                } else {
                    const mptyp = mapfrag_get(mf, xx - gx.xstart, yy - gy.ystart);
                    if (mptyp >= MAX_TYPE) continue;
                    if ((loc.typ !== STONE && loc.typ !== mptyp)
                        || loc.roomno !== NO_ROOM) {
                        isokp = false;
                    }
                }
                if (!isokp) break;
            }
        }

        if (!isokp) {
            if (tryct++ < 100 && (lr === -1 || tb === -1)) continue;
            game.themeroom_failed = true;
            reset_xystart_size();
            return null;
        }
        break;
    }

    for (let yy = gy.ystart; yy < Math.min(ROWNO, gy.ystart + gy.ysize); yy++) {
        for (let xx = gx.xstart; xx < Math.min(COLNO, gx.xstart + gx.xsize); xx++) {
            const mptyp = mapfrag_get(mf, xx - gx.xstart, yy - gy.ystart);
            if (mptyp === INVALID_TYPE || mptyp >= MAX_TYPE) continue;
            const loc = game.level.at(xx, yy);
            loc.flags = 0;
            loc.horizontal = false;
            loc.roomno = 0;
            loc.edge = false;
            splev_map_mark(xx, yy);          // C: SpLev_Map[x][y] = 1
            selection_setpoint(xx, yy, sel, 1);
            sel_set_ter(xx, yy, { ter: mptyp, tlit: lit });
        }
    }

    if (contents) {
        contents({ width: gx.xsize, height: gy.ysize, selection: sel });
        reset_xystart_size();
    }

    return sel;
}

// map-relative (mx,my) -> absolute level coord using the map offset that
// bigrm_load_map computed into gx.xstart / gy.ystart.
export function q_absx(mx) { return mx + gx.xstart; }
export function q_absy(my) { return my + gy.ystart; }

// C ref: sp_lev.c splev_initlev() LVLINIT_SOLIDFILL with fg=" " and no explicit
// lit -> BOOL_RANDOM -> one rn2(2); then lvlfill_solid(STONE, lit).  Returns the
// lit bit so the map load can preserve it.
export function quest_level_init_solidfill() {
    const lit = rn2(2);                  // sp_lev.c:2992
    for (let y = 0; y < ROWNO; y++)
        for (let x = 0; x < COLNO; x++) {
            const loc = game.level?.at(x, y);
            if (loc) { loc.typ = STONE; loc.lit = !!lit; loc.roomno = NO_ROOM; }
        }
    return lit;
}

// C ref: sp_lev.c:5051 lspo_replace_terrain() — des.replace_terrain{}.
// `spec` mirrors the Lua table: toterrain/fromterrain are already-resolved
// typs, mapfragment is the alternative matcher, and region/x1..y2/selection
// pick the squares.  Coordinates are map-relative (C runs the corners through
// get_location(ANY_LOC), which adds gx.xstart/gy.ystart outside a room).
//
// RNG: ONE rn2(100) per square that MATCHES (not per square scanned), drawn
// even at chance == 100.  Getting the match test or the scan order wrong
// therefore shifts every later draw on the level.
export function lspo_replace_terrain({
    totyp, fromtyp = INVALID_TYPE, mapfragment = null, chance = 100,
    tolit = SET_LIT_NOCHANGE, region = null,
    x1 = -1, y1 = -1, x2 = -1, y2 = -1, selection = null,
}) {
    if (totyp == null || totyp >= MAX_TYPE) return;        // sp_lev.c:5068
    const mf = (fromtyp === INVALID_TYPE && mapfragment != null)
        ? mapfrag_fromstr(mapfragment) : null;
    if (region && x1 === -1 && y1 === -1 && x2 === -1 && y2 === -1)
        [x1, y1, x2, y2] = region;                         // get_table_region

    let sel = selection;
    if (!sel) {
        sel = selection_new_var();
        if (x1 === -1 && y1 === -1 && x2 === -1 && y2 === -1) {
            selection_clear_var(sel, 1);                   // sp_lev.c:5109
        } else {
            const a = vly_abs(x1, y1), b = vly_abs(x2, y2);
            for (let x = Math.max(a.x, 0); x <= Math.min(b.x, COLNO - 1); x++)
                for (let y = Math.max(a.y, 0); y <= Math.min(b.y, ROWNO - 1); y++)
                    selection_setpoint_var(x, y, sel, 1);
        }
    }

    const rect = selection_getbounds_var(sel);
    for (let x = Math.max(1, rect.lx); x <= rect.hx; x++)  // sp_lev.c:5123
        for (let y = rect.ly; y <= rect.hy; y++) {
            if (!selection_getpoint_var(x, y, sel)) continue;
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            if (mf) {
                if (mapfrag_match(mf, x, y) && rn2(100) < chance)
                    set_levltyp_lit(x, y, totyp, tolit);
            } else if (((fromtyp === MATCH_WALL && IS_STWALL(loc.typ))
                        || loc.typ === fromtyp)
                       && rn2(100) < chance) {             // sp_lev.c:5132
                set_levltyp_lit(x, y, totyp, tolit);
            }
        }
}

// The region form, as the quest levels spell it.  Thin wrapper so the loop
// above stays the single implementation.
export function quest_replace_terrain(x1, y1, x2, y2, fromtyp, totyp, chance) {
    lspo_replace_terrain({ totyp, fromtyp, chance, region: [x1, y1, x2, y2] });
}

// C ref: sp_lev.c lspo_region 2-arg form (selection, "lit"/"unlit").  No RNG,
// no room: clone the rect selection, grow it by one cell in all directions when
// lighting, and set each cell's lit flag.  Coords are map-relative.
export function quest_region_light(x1, y1, x2, y2, lit) {
    const ax1 = q_absx(x1), ay1 = q_absy(y1);
    const ax2 = q_absx(x2), ay2 = q_absy(y2);
    const cells = new Set();
    for (let x = ax1; x <= ax2; x++)
        for (let y = ay1; y <= ay2; y++)
            if (isok(x, y)) cells.add(x + ',' + y);
    if (lit) {
        const grown = new Set(cells);
        for (const k of cells) {
            const [x, y] = k.split(',').map(Number);
            for (let dx = -1; dx <= 1; dx++)
                for (let dy = -1; dy <= 1; dy++) {
                    const nx = x + dx, ny = y + dy;
                    if (isok(nx, ny)) grown.add(nx + ',' + ny);
                }
        }
        for (const k of grown) {
            const [x, y] = k.split(',').map(Number);
            const loc = game.level?.at(x, y);
            if (loc) loc.lit = true;
        }
    } else {
        for (const k of cells) {
            const [x, y] = k.split(',').map(Number);
            const loc = game.level?.at(x, y);
            if (loc) loc.lit = false;
        }
    }
}

// C ref: sp_lev.c create_monster.  Name -> find_montype (gender rn2(2) unless
// the species has a fixed gender) -> amask AM_SPLEV_RANDOM -> induced_align
// rn2(3) -> get_location_coord (explicit coord: no RNG) -> MON_AT/enexto ->
// makemon(pm, x, y, 0).  peacefulOverride (if not null) is applied afterwards.
export function quest_create_monster(name, mx, my, peacefulOverride) {
    const pmidx = name_to_pmidx(name);
    const ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    if (!ptr) return null;
    // C ref: sp_lev.c:3156 find_montype() —
    //   mgend = name_to_monplus(s, 0, &mgend);      /* the matched name's slot */
    //   if (is_male || is_female)  mgend = fixed;
    //   else mgend = (mgend == FEMALE) ? FEMALE : (mgend == MALE) ? MALE : rn2(2);
    // so the rn2(2) is skipped BOTH for a fixed-gender species (gcode 1/2) AND
    // when the NAME itself is a NAMS() male/female form ("vampire lord" vs the
    // neutral "vampire leader").  lspo_monster's own
    // `tmpmons.female = ... : rn2(2)` never rolls either, because find_montype
    // has already reduced mgend to MALE or FEMALE.
    if (ptr.gcode !== 1 && ptr.gcode !== 2
        && name_gender_hint(name) === MGEND_NEUTRAL)
        rn2(2);
    rn2(3);                                            // induced_align (dungeon.c:2012)
    let x = q_absx(mx), y = q_absy(my);
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, ptr);
        if (cc) { x = cc.x; y = cc.y; }
    }
    const mtmp = makemon(ptr, x, y, 0);
    if (mtmp && peacefulOverride != null) mtmp.mpeaceful = !!peacefulOverride;
    // C ref: makemon.c S_EEL case -> hideunder(mtmp) during mklev: an eel on a
    // pool becomes mundetected (submerged), so it renders as water.  No RNG.
    if (mtmp && ptr.mcls === 57 /* S_EEL */) {
        const t = game.level?.at(x, y)?.typ;
        if (t === POOL || t === MOAT || t === WATER) mtmp.mundetected = true;
    }
    return mtmp;
}

// C ref: sp_lev.c create_object.  get_location(DRY) [explicit coord: no RNG;
// no coord: random DRY loop] -> mksobj/mksobj_at -> apply spe.  For an inventory
// item (carryingMon set) the object is created at a random DRY floor spot
// (consuming that get_location) and then moved into the monster's inventory.
export function quest_create_object(otyp, mx, my, spe, carryingMon) {
    let x, y;
    if (mx != null) { x = q_absx(mx); y = q_absy(my); }
    else { const c = bigrm_get_location_dry(); x = c.x; y = c.y; }
    let otmp;
    if (carryingMon) {
        otmp = mksobj(otyp, true, true);           // not placed on floor
        if (spe != null) otmp.spe = spe;
        if (!carryingMon.minvent) carryingMon.minvent = [];
        carryingMon.minvent.unshift(otmp);
    } else {
        otmp = mksobj_at(otyp, x, y, true, true);
        if (spe != null) otmp.spe = spe;
    }
    return otmp;
}

// C ref: sp_lev.c create_trap for a fixed-type, fixed-coord trap: get_location
// (explicit -> no RNG) then mktrap(type, MKTRAP_MAZEFLAG|NOSPIDERONWEB).  The
// only RNG mktrap consumes here is the victim check rnd(4) (mklev.c:2137), which
// is always drawn (in_mklev, kind != NO_TRAP) and, at this level difficulty,
// never places a victim.
export async function quest_create_trap(ttyp, mx, my) {
    const x = q_absx(mx), y = q_absy(my);
    await maketrap(x, y, ttyp);
    rnd(4);                                          // mktrap victim check
}

// C ref: selvar.c selection_floodfill via l_selection_flood: floods from the
// start cell over all 4-connected cells whose typ matches the start cell's typ
// (set_floodfillchk_match_under).  No RNG.  Coords are map-relative.
export function quest_floodfill_match(mx, my) {
    const sx = q_absx(mx), sy = q_absy(my);
    const start = game.level?.at(sx, sy);
    if (!start) return new Set();
    const wantTyp = start.typ;
    const seen = new Set();
    const stack = [[sx, sy]];
    while (stack.length) {
        const [x, y] = stack.pop();
        const k = x + ',' + y;
        if (seen.has(k) || !isok(x, y)) continue;
        if (game.level?.at(x, y)?.typ !== wantTyp) continue;
        seen.add(k);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return seen;
}

// C ref: selvar.c selection_rndcoord — count the set points inside the
// selection's bounding box, rn2(count), then walk the bounding box in x-outer /
// y-inner order to the chosen point (removing it when removeit).  `sel` is a Set
// of "x,y" keys.
export function quest_rndcoord(sel) {
    const pts = [];
    let lx = COLNO, hx = -1, ly = ROWNO, hy = -1;
    for (const k of sel) {
        const [x, y] = k.split(',').map(Number);
        if (x < lx) lx = x; if (x > hx) hx = x;
        if (y < ly) ly = y; if (y > hy) hy = y;
    }
    for (let x = lx; x <= hx; x++)
        for (let y = ly; y <= hy; y++)
            if (sel.has(x + ',' + y)) pts.push([x, y]);
    if (!pts.length) return null;
    const c = rn2(pts.length);
    const [px, py] = pts[c];
    sel.delete(px + ',' + py);
    return { x: px, y: py };
}

// A specific-coord ogre (create_monster with an explicit coord from rndcoord).
export function quest_create_monster_at(name, x, y, peaceful) {
    const pmidx = name_to_pmidx(name);
    const ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    if (!ptr) return null;
    if (ptr.gcode !== 1 && ptr.gcode !== 2) rn2(2);   // find_montype gender
    rn2(3);                                            // induced_align
    let mx = x, my = y;
    if (mm_mon_at(mx, my)) {
        const cc = enexto_spawn(mx, my, ptr);
        if (cc) { mx = cc.x; my = cc.y; }
    }
    const mtmp = makemon(ptr, mx, my, 0);
    if (mtmp && peaceful != null) mtmp.mpeaceful = !!peaceful;
    return mtmp;
}

// des.stair("down", mx, my) — place a down stairway.  No RNG.
export function quest_place_stair(mx, my, up) {
    const x = q_absx(mx), y = q_absy(my);
    const loc = game.level?.at(x, y);
    if (loc) loc.typ = STAIRS;
    if (!game.stairs) game.stairs = [];
    game.stairs.push({ sx: x, sy: y, up: !!up });
    if (up) { game.upstair = { x, y }; if (game.level) game.level.upstair = { x, y }; }
    else { game.dnstair = { x, y }; if (game.level) game.level.dnstair = { x, y }; }
}

// des.levregion({region={mx,my,mx,my}, type=...}) — store a 1-cell levregion
// (absolute coords) plus its LR_* rtype for placement at level finalize
// (mkmaze.c place_lregions()).  No RNG.  `lev` is the levregion's destination
// d_level, which only the LR_PORTAL rtype reads.
function quest_register_lregion(mx, my, rtype, lev) {
    game._quest_lregion = {
        x1: q_absx(mx), y1: q_absy(my), x2: q_absx(mx), y2: q_absy(my),
        rtype, lev: lev || null,
    };
}

// des.levregion({region={mx,my,mx,my}, type="branch"})
export function quest_register_branch(mx, my) {
    quest_register_lregion(mx, my, LR_BRANCH, null);
}

// des.door(state, mx, my) — set the door mask on an existing DOOR/SDOOR cell.
// rm.h: D_ISOPEN is 0x02 (0x20 was wrong — nothing is defined there).
const _QDOORMASK = {
    nodoor: 0x00 /*D_NODOOR*/, broken: 0x01 /*D_BROKEN*/,
    open: 0x02 /*D_ISOPEN*/, closed: 0x04 /*D_CLOSED*/,
    locked: 0x08 /*D_LOCKED*/, secret: D_SECRET,
};

// C ref: sp_lev.c set_door_orientation() — used by sel_set_door() below to
// pick the SDOOR/DOOR glyph orientation (horizontal wall-run vs vertical).
export function set_door_orientation(x, y) {
    const isJoin = (t) => IS_WALL(t) || IS_DOOR(t) || t === SDOOR;
    const at = (dx, dy) => { const l = game.level?.at(x + dx, y + dy); return l ? l.typ : STONE; };
    let wleft = isok(x - 1, y) && isJoin(at(-1, 0));
    let wright = isok(x + 1, y) && isJoin(at(1, 0));
    let wup = isok(x, y - 1) && isJoin(at(0, -1));
    let wdown = isok(x, y + 1) && isJoin(at(0, 1));
    if (!wleft && !wright && !wup && !wdown) {
        const isDoorjoin = (t) => IS_OBSTRUCTED(t) || t === IRONBARS;
        wleft = !isok(x - 1, y) || isDoorjoin(at(-1, 0));
        wright = !isok(x + 1, y) || isDoorjoin(at(1, 0));
        wup = !isok(x, y - 1) || isDoorjoin(at(0, -1));
        wdown = !isok(x, y + 1) || isDoorjoin(at(0, 1));
    }
    const loc = game.level?.at(x, y);
    if (loc) loc.horizontal = ((wleft || wright) && !(wup && wdown));
}

// C ref: sp_lev.c sel_set_door().  A cell that is ALREADY a door or secret
// door keeps its current typ (an existing SDOOR stays hidden — it renders as
// a plain wall until the player finds it later); only a fresh (non-door,
// non-SDOOR) cell gets promoted, to SDOOR when the requested state is
// "secret" or DOOR otherwise.  The doormask is always (re)written.
export function quest_set_door(mx, my, state) {
    const x = q_absx(mx), y = q_absy(my);
    const loc = game.level?.at(x, y);
    if (!loc) return;
    let typ = _QDOORMASK[state] ?? D_CLOSED;
    if (!IS_DOOR(loc.typ) && loc.typ !== SDOOR) {
        loc.typ = (typ & D_SECRET) ? SDOOR : DOOR;
    }
    if (typ & D_SECRET) {
        typ &= ~D_SECRET;
        if (typ < D_CLOSED) typ = D_CLOSED;
    }
    set_door_orientation(x, y);
    loc.doormask = typ;
}

// flip the stored levregion alongside the map (flip_level flips lregions in
// C).  Mirrors flip_level's FlipX/FlipY within the level extents.
export function quest_flip_branch(flp) {
    const br = game._quest_lregion;
    if (!br) return;
    const { minx, maxx, miny, maxy } = bigrm_get_level_extends();
    const inArea = (x, y) => (x >= minx && x <= maxx && y >= miny && y <= maxy);
    const fx = (x) => (minx + maxx - x), fy = (y) => (miny + maxy - y);
    for (const [kx, ky] of [['x1', 'y1'], ['x2', 'y2']]) {
        if (!inArea(br[kx], br[ky])) continue;
        if (flp & 1) br[ky] = fy(br[ky]);
        if (flp & 2) br[kx] = fx(br[kx]);
    }
    if (br.x1 > br.x2) { const t = br.x1; br.x1 = br.x2; br.x2 = t; }
    if (br.y1 > br.y2) { const t = br.y1; br.y1 = br.y2; br.y2 = t; }
}

// C ref: sp_lev.c create_monster — named species (id known via find_montype),
// NO explicit coord.  Order: find_montype gender roll (species-dependent) +
// induced_align (sp_amask_to_amask); then get_location_coord(DRY) — these
// land-dwelling species take the "first try" DRY branch, one rn2(xsize)/
// rn2(ysize) draw; then the MON_AT/enexto relocate-if-occupied check; then
// makemon().
export function quest_create_monster_randpos(name, peacefulOverride) {
    const pmidx = name_to_pmidx(name);
    const ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    if (!ptr) return null;
    if (ptr.gcode !== 1 && ptr.gcode !== 2) rn2(2);    // find_montype gender
    rn2(3);                                             // induced_align (dungeon.c:2012)
    const c = bigrm_get_location_dry();
    let x = c.x, y = c.y;
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, ptr);
        if (cc) { x = cc.x; y = cc.y; }
    }
    const mtmp = makemon(ptr, x, y, 0);
    if (mtmp && peacefulOverride != null) mtmp.mpeaceful = !!peacefulOverride;
    return mtmp;
}

// C ref: trap.h trap-type constants (only the ones traptype_rnd() switches on).
const ARC_NO_TRAP = 0, ARC_ROCKTRAP = 3, ARC_HOLE = 13, ARC_TRAPDOOR = 14;
// C ref: monsym.h — def_char_to_monclass('S') = S_SNAKE, ('M') = S_MUMMY.
export const ARC_S_SNAKE = 45, ARC_S_MUMMY = 39, ARC_G_NOGEN = 0x0200;

// C ref: mklev.c traptype_rnd() — pick a random trap type, NO_TRAP if "too
// hard"/disallowed on this level.  We reimplement it locally (rather than share
// mklev.js's copy) so it uses depth-based level_difficulty() — the quest home is
// dlevel 1 in the quest branch but ledger-depth 14, and traptype_rnd() in C uses
// level_difficulty() (== depth), not dlevel.  noteleport is set on this level.
function arc_traptype_rnd() {
    const lvl = depth_of_level(game.u?.uz);
    const noteleport = !!game.level?.flags?.noteleport;
    let kind = rnd(25);                              // rnd(TRAPNUM-1)
    switch (kind) {
    case 24: case 25: case 17: case 23:              // TRAPPED_DOOR/CHEST, MAGIC_PORTAL, VIBRATING_SQUARE
        kind = ARC_NO_TRAP; break;
    case 7: case 8:                                  // ROLLING_BOULDER_TRAP, SLP_GAS_TRAP
        if (lvl < 2) kind = ARC_NO_TRAP; break;
    case 16:                                         // LEVEL_TELEP
        if (lvl < 5 || noteleport) kind = ARC_NO_TRAP; break;
    case 12:                                         // SPIKED_PIT
        if (lvl < 5) kind = ARC_NO_TRAP; break;
    case 6:                                          // LANDMINE
        if (lvl < 6) kind = ARC_NO_TRAP; break;
    case 18:                                         // WEB
        if (lvl < 7) kind = ARC_NO_TRAP; break;
    case 19: case 22:                                // STATUE_TRAP, POLY_TRAP
        if (lvl < 8) kind = ARC_NO_TRAP; break;
    case 10:                                         // FIRE_TRAP (only in Gehennom)
        kind = ARC_NO_TRAP; break;
    case 15:                                         // TELEP_TRAP
        if (noteleport) kind = ARC_NO_TRAP; break;
    case 13:                                         // HOLE — much rarer
        if (rn2(7)) kind = ARC_NO_TRAP; break;
    }
    return kind;
}

// C ref: sp_lev.c create_trap for a random type + random (maze) location.
// get_location_coord(DRY) loop rejecting stairs/ladder, then mktrap(0,...):
// retry traptype_rnd() until valid, is_hole&&!Can_fall_thru -> ROCKTRAP, place,
// then the always-drawn victim check rnd(4) (lvl(14) <= rnd(4) is never true).
export async function quest_create_trap_random() {
    let x = -1, y = -1, trycnt = 0;
    do {
        const c = bigrm_get_location_dry();          // internal DRY retry loop
        x = c.x; y = c.y;
        const t = game.level?.at(x, y)?.typ;
        if (t !== STAIRS && t !== LADDER) break;
    } while (++trycnt <= 100);
    let kind;
    do { kind = arc_traptype_rnd(); } while (kind === ARC_NO_TRAP);
    // hardfloor is set on this level -> Can_fall_thru() is FALSE (RNG-neutral).
    if (kind === ARC_HOLE || kind === ARC_TRAPDOOR) kind = ARC_ROCKTRAP;
    await maketrap(x, y, kind);                       // rolling-boulder draws launch coord
    rnd(4);                                            // mktrap victim check (mklev.c:2137)
}

// C ref: sp_lev.c create_monster for a class char ("S"/"M") with no specific id:
// sp_amask_to_amask(AM_SPLEV_RANDOM) draws induced_align rn2(3); pm =
// mkclass(class, G_NOGEN); explicit coord -> no get_location RNG; makemon().
export function quest_create_monster_class(classNum, mx, my) {
    rn2(3);                                            // induced_align (dungeon.c:2012)
    const ptr = mkclass(classNum, ARC_G_NOGEN);
    if (!ptr) return null;
    let x = q_absx(mx), y = q_absy(my);
    if (mm_mon_at(x, y)) { const cc = enexto_spawn(x, y, ptr); if (cc) { x = cc.x; y = cc.y; } }
    const mtmp = makemon(ptr, x, y, 0);
    if (mtmp && ptr.mcls === 57 /* S_EEL */) {
        const t = game.level?.at(x, y)?.typ;
        if (t === POOL || t === MOAT || t === WATER) mtmp.mundetected = true;
    }
    return mtmp;
}

// C ref: sp_lev.c create_monster tail — a monster with a CUSTOM inventory
// function but no DEFAULT_INVENT flag has its makemon-granted default inventory
// removed before the custom function runs: mdrop_special_objs(mtmp) then
// discard_minvent(mtmp, TRUE).  mdrop_special_objs (steal.c) draws
// obj_resists(obj, 0, 0) == rn2(100) for EACH minvent item (invocation tools /
// quest artifacts would be kept; a quest leader carries none), so a leader who
// got one defensive item from m_initinv contributes exactly one rn2(100) here.
export function quest_drop_default_invent(mtmp) {
    if (!mtmp || !Array.isArray(mtmp.minvent)) return;
    for (let i = 0; i < mtmp.minvent.length; i++) {
        rn2(100);                                      // obj_resists(obj, 0, 0)
    }
    // discard_minvent(mtmp, TRUE): non-artifact items dealloc with no RNG.
    mtmp.minvent = [];
}

// C ref: sp_lev.c lspo_map halign=SPLEV_H_LEFT / valign=SPLEV_CENTER offset
// (the default, used by Vlad's tower's own "half-left" des.map calls).
// gx.xstart = 2 + ((x_maze_max-2-xsize)/4); gy.ystart = 2 + ((y_maze_max-2-ysize)/2);
// each bumped odd.  Then stamp the fixed terrain (no RNG).
// `lit` is des.map's OWN "lit" option (sp_lev.c:6122 get_table_boolean_opt
// "lit", default FALSE) — NOT the level_init lit.  Passing the level_init
// rn2(2) here renders the whole of tower2 lit (its roll is 1, tower1/3 roll 0).
//
// `halignLeft` selects sp_lev.c's OTHER SPLEV_LEFT case (plain "left", not
// "half-left"): gx.xstart = splev_init_present ? 1 : 3.  Every quest-home
// script runs a des.level_init before its des.map, so splev_init_present is
// always TRUE by the time this runs and the plain-left offset is always 1.
export function tower1_load_map(mapstr, lit, halignLeft = false) {
    const mf = mapfrag_fromstr(mapstr);
    gx.xsize = mf.wid;
    gy.ysize = mf.hei;
    gx.xstart = halignLeft ? 1                                        // SPLEV_LEFT
        : 2 + Math.trunc((gx.x_maze_max - 2 - gx.xsize) / 4);         // SPLEV_H_LEFT
    gy.ystart = 2 + Math.trunc((gy.y_maze_max - 2 - gy.ysize) / 2);   // SPLEV_CENTER
    if (!(gx.xstart % 2)) gx.xstart++;
    if (!(gy.ystart % 2)) gy.ystart++;
    if (gy.ystart < 0 || gy.ystart + gy.ysize > ROWNO) {
        gy.ystart += (gy.ystart > 0) ? -2 : 2;
        if (gy.ysize === ROWNO) gy.ystart = 0;
        if (gy.ystart < 0 || gy.ystart + gy.ysize > ROWNO) gy.ystart = 0;
    }
    for (let y = gy.ystart; y < Math.min(ROWNO, gy.ystart + gy.ysize); y++)
        for (let x = gx.xstart; x < Math.min(COLNO, gx.xstart + gx.xsize); x++) {
            const mptyp = mapfrag_get(mf, x - gx.xstart, y - gy.ystart);
            if (mptyp === INVALID_TYPE || mptyp >= MAX_TYPE) continue;
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            loc.flags = 0;
            loc.roomno = 0;
            loc.edge = false;
            loc.typ = mptyp;
            // C ref: sp_lev.c lspo_map() draws every cell through
            // sel_set_ter() -> set_levltyp_lit(), and BOTH set_levltyp()
            // and set_levltyp_lit() force `lit = 1` for lava whatever the
            // map asked for.  Writing the map's own `lit` here left every
            // lava pool dark, so the hero saw none of the Plane of Fire on
            // arrival (seed0373 step 100).
            loc.lit = IS_LAVA(mptyp) ? true : !!lit;
            // C ref: sp_lev.c sel_set_ter() — HWALL/IRONBARS get horizontal=1;
            // a door/secret-door inherits horizontal=1 when its left neighbour
            // (already loaded, x-inner scan) is a wall or itself horizontal.
            // This is what makes the tower's SDOOR row render as ─ (HWALL glyph)
            // rather than │.
            if (mptyp === HWALL || mptyp === IRONBARS) {
                loc.horizontal = true;
            } else if (mptyp === SDOOR || IS_DOOR(mptyp)) {
                const left = game.level?.at(x - 1, y);
                loc.horizontal = !!(x > 0 && left
                    && (IS_WALL(left.typ) || left.horizontal));
            } else {
                loc.horizontal = false;
            }
        }
    return mf;
}

// des.ladder("up"/"down", mx, my) — no RNG.  C ref: sp_lev.c lspo_ladder ->
// levl[x][y].typ = LADDER; levl[x][y].ladder = up ? LA_UP : LA_DOWN;
// stairway_add(x, y, up, TRUE, ...).
export function tower_place_ladder(mx, my, up = false) {
    const x = q_absx(mx), y = q_absy(my);
    const loc = game.level?.at(x, y);
    if (loc) loc.typ = LADDER;
    if (!game.stairs) game.stairs = [];
    game.stairs.push({ sx: x, sy: y, up: !!up, isladder: true });
    if (up) {
        game.upstair = { x, y };
        if (game.level) { game.level.upstair = { x, y }; if (loc) loc.ladder = LA_UP; }
    } else {
        game.dnstair = { x, y };
        if (game.level) { game.level.dnstair = { x, y }; if (loc) loc.ladder = LA_DOWN; }
    }
}

// C ref: mkmaze.c wallification() — the FAITHFUL wall_cleanup + fix_wall_spines
// with extend_spine (the simplified bigrm_wallification omits extend_spine's
// diagonal test and so mis-types walls at complex junctions like the tower's).
function tw_isWallOrStone(x, y) {
    if (!isok(x, y)) return 1;
    const typ = game.level?.at(x, y)?.typ ?? STONE;
    return (typ === STONE || tw_isWallTile(x, y)) ? 1 : 0;
}
function tw_isWallTile(x, y) {
    if (!isok(x, y)) return 0;
    const typ = game.level?.at(x, y)?.typ ?? STONE;
    return (IS_WALL(typ) || IS_DOOR(typ) || typ === LAVAWALL
        || typ === WATER || typ === SDOOR || typ === IRONBARS) ? 1 : 0;
}
function tw_isSolid(x, y) {
    if (!isok(x, y)) return true;
    const typ = game.level?.at(x, y)?.typ ?? STONE;
    return typ === STONE || (IS_WALL(typ) && typ !== DBWALL);
}
function tw_extend_spine(locale, wall_there, dx, dy) {
    const nx = 1 + dx, ny = 1 + dy;
    if (!wall_there) return 0;
    if (dx) {
        if (locale[1][0] && locale[1][2] && locale[nx][0] && locale[nx][2]) return 0;
        return 1;
    }
    if (locale[0][1] && locale[2][1] && locale[0][ny] && locale[2][ny]) return 0;
    return 1;
}
export function tower_wallification(x1, y1, x2, y2) {
    const map = game.level;
    if (!map) return;
    // wall_cleanup: walls totally surrounded by solid -> STONE.
    for (let x = x1; x <= x2; x++)
        for (let y = y1; y <= y2; y++) {
            const loc = map.at(x, y);
            const typ = loc?.typ ?? STONE;
            if (!(IS_WALL(typ) && typ !== DBWALL)) continue;
            if (tw_isSolid(x-1,y-1) && tw_isSolid(x-1,y) && tw_isSolid(x-1,y+1)
                && tw_isSolid(x,y-1) && tw_isSolid(x,y+1)
                && tw_isSolid(x+1,y-1) && tw_isSolid(x+1,y) && tw_isSolid(x+1,y+1))
                loc.typ = STONE;
        }
    // fix_wall_spines with extend_spine.
    const spineArray = [VWALL, HWALL, HWALL, HWALL,
        VWALL, TRCORNER, TLCORNER, TDWALL,
        VWALL, BRCORNER, BLCORNER, TUWALL,
        VWALL, TLWALL, TRWALL, CROSSWALL];
    for (let x = x1; x <= x2; x++)
        for (let y = y1; y <= y2; y++) {
            const loc = map.at(x, y);
            const typ = loc?.typ ?? STONE;
            if (!(IS_WALL(typ) && typ !== DBWALL)) continue;
            const locale = [
                [tw_isWallOrStone(x-1,y-1), tw_isWallOrStone(x-1,y), tw_isWallOrStone(x-1,y+1)],
                [tw_isWallOrStone(x,y-1), 0, tw_isWallOrStone(x,y+1)],
                [tw_isWallOrStone(x+1,y-1), tw_isWallOrStone(x+1,y), tw_isWallOrStone(x+1,y+1)],
            ];
            const bits = (tw_extend_spine(locale, tw_isWallTile(x,y-1), 0, -1) << 3)
                | (tw_extend_spine(locale, tw_isWallTile(x,y+1), 0, 1) << 2)
                | (tw_extend_spine(locale, tw_isWallTile(x+1,y), 1, 0) << 1)
                | tw_extend_spine(locale, tw_isWallTile(x-1,y), -1, 0);
            if (bits) loc.typ = spineArray[bits];
        }
}

// obj.h otyps used by tower2/tower3 (verified against js/mkobj.js objects[]).
export const AMULET_OF_LIFE_SAVING = 202, AMULET_OF_STRANGULATION = 203,
    WATER_WALKING_BOOTS = 167, CRYSTAL_PLATE_MAIL = 122,
    LONG_SWORD = 54, LOCK_PICK = 222, ELVEN_CLOAK = 139, BLINDFOLD = 233,
    SPE_CONE_OF_COLD = 369, SPE_CLAIRVOYANCE = 385, SPE_CHARM_MONSTER = 387,
    SPE_INVISIBILITY = 393, SPE_POLYMORPH = 399, SPE_CREATE_FAMILIAR = 401,
    SPE_STONE_TO_FLESH = 405;

// ════════════════════════════════════════════════════════════════════════
// Big Room special level loader (bigrm-1.lua .. bigrm-13.lua).
//
// C ref: mkmaze.c makemaz("bigrm") -> rnd(13) picks the variant, then
// load_special("bigrm-N.lua") executes the Lua via the splev engine.  We
// hand-port each bigrm-N script to JS calling the same RNG-consuming
// primitives in the same order, so the PRNG stream matches C exactly.
//
// Loading nhlib.lua first runs `align = {...}; shuffle(align)` at module top
// level (nhlib.lua:24-25): a 3-element Fisher-Yates -> rn2(3), rn2(2).
// ════════════════════════════════════════════════════════════════════════

// ── generic get_location() humidity machinery (sp_lev.c) ────────────────
// C ref: sp_lev.h — the getloc_flags_t bits get_location()/is_ok_location()
// filter candidate squares with.
export const LOC_DRY = 0x01, LOC_WET = 0x02, LOC_HOT = 0x04, LOC_SOLID = 0x08,
             LOC_ANY = 0x10, LOC_SPACE = 0x40;

// C ref: sp_lev.c is_ok_location(x, y, humidity).  No RNG.  The
// is_ok_location_func hook is only installed by the themed-room and Sokoban
// coders (which use their own local checks in this port), and Is_waterlevel's
// "accept anything" shortcut belongs to the endgame.
export function is_ok_location(x, y, humidity) {
    if (!isok(x, y)) return false;
    const typ = game.level?.at(x, y)?.typ;
    if (typ == null) return false;
    if (humidity & LOC_ANY) return true;
    if ((humidity & LOC_SOLID) && IS_OBSTRUCTED(typ)) return true;
    if ((humidity & (LOC_DRY | LOC_SPACE)) && SPACE_POS(typ)) {
        // C: a boulder disqualifies the square unless SOLID is also asked for.
        const bould = !!(game.level?.objects || []).find(
            (o) => o && o.otyp === BOULDER && o.ox === x && o.oy === y);
        if (!bould || (humidity & LOC_SOLID)) return true;
    }
    if ((humidity & LOC_WET) && splev_is_pool(x, y)) return true;
    if ((humidity & LOC_HOT) && IS_LAVA(typ)) return true;
    return false;
}

function splev_is_pool(x, y) {
    const typ = game.level?.at(x, y)?.typ;
    return typ === POOL || typ === MOAT || typ === WATER;
}

// C ref: monsym.h S_* class indices used by mondata.h's mlet-based predicates.
const S_EYE = 5, S_LIGHT = 25, S_EEL = 57, S_GHOST = 54;

// C ref: mondata.h is_floater / noncorporeal / likes_fire (via likes_lava).
const is_floater = (p) => p.mcls === S_EYE || p.mcls === S_LIGHT;
const noncorporeal = (p) => p.mcls === S_GHOST;
const likes_fire = (p) => ['fire vortex', 'flaming sphere', 'fire elemental',
                           'salamander'].includes(p.name);

// C ref: sp_lev.c pm_to_humidity(pm) — where a species may be placed.  No RNG.
export function pm_to_humidity(pm) {
    let loc = LOC_DRY;
    if (!pm) return loc;
    if (pm.mcls === S_EEL || (mflags1_of(pm) & M1_AMPHIBIOUS)
        || is_swimmer_flag(pm))
        loc = LOC_WET;
    if (is_flyer_flag(pm) || is_floater(pm)) loc |= (LOC_HOT | LOC_WET);
    if (passes_walls_flag(pm) || noncorporeal(pm)) loc |= LOC_SOLID;
    if (likes_fire(pm)) loc |= LOC_HOT;
    return loc;
}

// C ref: sp_lev.c get_location():1227-1231 — the croom != NULL random branch.
// The candidate square comes from somexy(croom) (which re-rolls somex/somey
// itself inside an irregular room), NOT the xstart/xsize form; every
// themeroom_fill runs with gc.coder->croom set, so this is the one des.monster
// and des.object use there.
export function splev_get_location_room(croom, humidity, nowarn = false) {
    if (!croom) return splev_get_location_rnd(humidity, nowarn);
    const c = { x: -1, y: -1 };
    let cpt = 0;
    do {
        somexy(croom, c); // C discards the return: a failed somexy still leaves c set
        if (is_ok_location(c.x, c.y, humidity)) return { x: c.x, y: c.y };
    } while (++cpt < 100);
    // C's "last try" scans the croom footprint (mx+xx, my+yy for xx < sx).
    for (let x = croom.lx; x <= croom.hx; x++)
        for (let y = croom.ly; y <= croom.hy; y++)
            if (is_ok_location(x, y, humidity)) return { x, y };
    if (nowarn) return { x: -1, y: -1 };
    return { x: gx.x_maze_max, y: gy.y_maze_max };
}

// C ref: sp_lev.c get_location() random-location branch with croom == NULL:
// loop `x = xstart + rn2(xsize); y = ystart + rn2(ysize)` until
// is_ok_location(humidity) passes, up to 100 tries, then fall back to a
// deterministic scan of the map footprint.  With NO_LOC_WARN in `humidity` C
// returns (-1,-1) instead of the fallback, which is how create_monster asks
// "is there a wet/solid spot?" before retrying with DRY added.
export function splev_get_location_rnd(humidity, nowarn = false) {
    // C ref: sp_lev.c get_location_coord():1348-1352 — a RANDOM coord reaches
    // get_location() TWICE: first with NO_LOC_WARN forced on, then (only when
    // that came back (-1,-1)) again with the caller's own flags.  Each call is
    // its own 100-draw loop, so collapsing them to one let a water-only species
    // fall through to its DRY retry 200 draws early (seed0373 step 99, pit viper
    // on the Plane of Fire).
    const r = get_location_rnd_once(humidity, true);
    if (r.x !== -1 || r.y !== -1) return r;
    return get_location_rnd_once(humidity, nowarn);
}

function get_location_rnd_once(humidity, nowarn) {
    let x = -1, y = -1, cpt = 0;
    do {
        x = gx.xstart + rn2(gx.xsize);   // sp_lev.c:1233
        y = gy.ystart + rn2(gy.ysize);   // sp_lev.c:1234
        if (is_ok_location(x, y, humidity)) return { x, y };
    } while (++cpt < 100);
    // C ref: sp_lev.c:1242 — the deterministic "last try" scan runs BEFORE the
    // NO_LOC_WARN (-1,-1) bail, not after it.
    for (let xx = 0; xx < gx.xsize; xx++)
        for (let yy = 0; yy < gy.ysize; yy++) {
            x = gx.xstart + xx; y = gy.ystart + yy;
            if (is_ok_location(x, y, humidity)) return { x, y };
        }
    if (nowarn) return { x: -1, y: -1 };
    return { x: gx.x_maze_max, y: gy.y_maze_max };
}

// C ref: rm.h ACCESSIBLE / SPACE_POS / is_pool / is_lava as used by
// is_ok_location(x,y,humidity).  We only need the DRY case for bigrm
// (objects/monsters/traps/stairs all use DRY).  DRY accepts SPACE_POS
// terrain (typ > DOOR) with no boulder; pools/water/lava/stone fail.
function bigrm_is_ok_location_dry(x, y) {
    if (!isok(x, y)) return false;
    const typ = game.level?.at(x, y)?.typ;
    if (typ == null) return false;
    if (!SPACE_POS(typ)) return false;
    // C ref: sp_lev.c:1298 — DRY (without SOLID) rejects a square that already
    // has a BOULDER on it.  Inert in the empty big room, decisive in Sokoban:
    // without it every des.object({class=...}) accepts a boulder square C would
    // have re-rolled (seed0360 step 249, soko4-1).
    for (const o of (game.level?.objects || []))
        if (o && o.otyp === BOULDER && o.ox === x && o.oy === y) return false;
    return true;
}

// C ref: sp_lev.c get_location() random-location branch (sp_lev.c:1226-1238)
// for croom == NULL: loop rn2(xsize)+xstart / rn2(ysize)+ystart until
// is_ok_location passes (up to 100 tries).  Returns {x,y}.
export function bigrm_get_location_dry() {
    let x = -1, y = -1, cpt = 0;
    do {
        x = gx.xstart + rn2(gx.xsize);   // sp_lev.c:1233
        y = gy.ystart + rn2(gy.ysize);   // sp_lev.c:1234
        if (bigrm_is_ok_location_dry(x, y)) break;
    } while (++cpt < 100);
    if (cpt >= 100) {
        for (let xx = 0; xx < gx.xsize; xx++)
            for (let yy = 0; yy < gy.ysize; yy++) {
                x = gx.xstart + xx; y = gy.ystart + yy;
                if (bigrm_is_ok_location_dry(x, y)) return { x, y };
            }
        return { x: gx.x_maze_max, y: gy.y_maze_max };
    }
    return { x, y };
}

// C ref: sp_lev.c lspo_map full-level map placement (single string arg ->
// lr=tb=SPLEV_CENTER).  No RNG.  Sets gx.xstart/xsize, gy.ystart/ysize and
// stamps the terrain.  Implements the SPLEV_CENTER offset + the ystart
// out-of-bounds recovery (sp_lev.c:6190-6237).
export function bigrm_load_map(mapstr, lit) {
    const mf = mapfrag_fromstr(mapstr);
    gx.xsize = mf.wid;
    gy.ysize = mf.hei;
    // SPLEV_CENTER.  C ref: decl.c g_init_x — x_maze_max defaults to
    // (COLNO-1)&~1 == 78, not COLNO-1; the odd value shifts xstart by 2 after
    // the `if (!(xstart % 2)) xstart++` parity fixup (seed0373 step 88: soko3-1
    // landed two columns right of C's).  lspo_map already uses the masked pair.
    const xmm = (COLNO - 1) & ~1, ymm = (ROWNO - 1) & ~1;
    gx.xstart = 2 + Math.trunc((xmm - 2 - gx.xsize) / 2);
    gy.ystart = 2 + Math.trunc((ymm - 2 - gy.ysize) / 2);
    if (!(gx.xstart % 2)) gx.xstart++;
    if (!(gy.ystart % 2)) gy.ystart++;
    if (gy.ystart < 0 || gy.ystart + gy.ysize > ROWNO) {
        gy.ystart += (gy.ystart > 0) ? -2 : 2;
        if (gy.ysize === ROWNO) gy.ystart = 0;
        if (gy.ystart < 0 || gy.ystart + gy.ysize > ROWNO) gy.ystart = 0;
    }
    for (let y = gy.ystart; y < Math.min(ROWNO, gy.ystart + gy.ysize); y++)
        for (let x = gx.xstart; x < Math.min(COLNO, gx.xstart + gx.xsize); x++) {
            const mptyp = mapfrag_get(mf, x - gx.xstart, y - gy.ystart);
            if (mptyp === INVALID_TYPE || mptyp >= MAX_TYPE) continue;
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            loc.flags = 0;
            loc.horizontal = false;
            loc.roomno = 0;
            loc.edge = false;
            loc.typ = mptyp;
            // C ref: sp_lev.c lspo_map() draws every cell through
            // sel_set_ter() -> set_levltyp_lit(), and BOTH set_levltyp()
            // and set_levltyp_lit() force `lit = 1` for lava whatever the
            // map asked for.  Writing the map's own `lit` here left every
            // lava pool dark, so the hero saw none of the Plane of Fire on
            // arrival (seed0373 step 100).
            loc.lit = IS_LAVA(mptyp) ? true : !!lit;
            // C ref: sp_lev.c:4608-4630 sel_set_ter() — every des.map cell goes
            // through it, and its tail is what gives map-drawn walls and doors
            // their .horizontal flag.  back_to_glyph() renders an SDOOR as
            // S_hwall/S_vwall straight off that bit, so skipping this draws a
            // horizontal secret door as a vertical one.
            if (loc.typ === SDOOR || IS_DOOR(loc.typ)) {
                if (loc.typ === SDOOR) loc.doormask = D_CLOSED;
                const left = x ? game.level?.at(x - 1, y) : null;
                if (left && (IS_WALL(left.typ) || left.horizontal))
                    loc.horizontal = true;
            } else if (loc.typ === HWALL || loc.typ === IRONBARS) {
                loc.horizontal = true;
            }
        }
    return mf;
}

// C ref: sp_lev.c splev_initlev() LVLINIT_SOLIDFILL with BOOL_RANDOM lit ->
// rn2(2); then lvlfill_solid(filling, lit).  bigrm uses style="solidfill",
// fg=" " (STONE) with no explicit lit -> BOOL_RANDOM -> one rn2(2).
export function bigrm_level_init_solidfill() {
    const lit = rn2(2);                  // sp_lev.c:2992
    const fill = STONE;                  // fg = " "
    for (let y = 0; y < ROWNO; y++)
        for (let x = 0; x < COLNO; x++) {
            const loc = game.level?.at(x, y);
            if (loc) { loc.typ = fill; loc.lit = !!lit; loc.roomno = NO_ROOM; }
        }
}

// C ref: mklev.c wallification() — wall_cleanup + fix_wall_spines, run at level
// finalize (sp_lev.c:6038).  Sets corner/T/cross wall types from neighbours.
const _SPINE = [VWALL, HWALL, HWALL, HWALL, VWALL, TRCORNER, TLCORNER, TDWALL,
                VWALL, BRCORNER, BLCORNER, TUWALL, VWALL, TLWALL, TRWALL, CROSSWALL];
export function bigrm_wallification(x1, y1, x2, y2) {
    const map = game.level;
    const isWall = (xx, yy) => { const l = map.at(xx, yy); return l && IS_WALL(l.typ) && l.typ !== DBWALL; };
    const isWallOrStone = (xx, yy) => { const l = map.at(xx, yy); return !l || l.typ === STONE || (IS_WALL(l.typ) && l.typ !== DBWALL); };
    // wall_cleanup: a wall fully surrounded by solid tiles reverts to STONE.
    for (let x = x1; x <= x2; x++)
        for (let y = y1; y <= y2; y++) {
            const loc = map.at(x, y);
            if (!loc || !(IS_WALL(loc.typ) && loc.typ !== DBWALL)) continue;
            let solid = true;
            for (let dx = -1; dx <= 1 && solid; dx++)
                for (let dy = -1; dy <= 1; dy++) {
                    if (!dx && !dy) continue;
                    if (!isWallOrStone(x + dx, y + dy)) { solid = false; break; }
                }
            // only revert if every neighbour is solid (wall or stone, not room)
            if (solid) {
                let allSolidStrict = true;
                for (let dx = -1; dx <= 1 && allSolidStrict; dx++)
                    for (let dy = -1; dy <= 1; dy++) {
                        if (!dx && !dy) continue;
                        const l = map.at(x + dx, y + dy);
                        const t = l ? l.typ : STONE;
                        if (!(t === STONE || (IS_WALL(t) && t !== DBWALL))) { allSolidStrict = false; break; }
                    }
                if (allSolidStrict) loc.typ = STONE;
            }
        }
    fix_wall_spines(x1, y1, x2, y2);
}

// C ref: mklev.c fix_wall_spines() — set each wall's corner/T/cross variant
// from its four cardinal neighbours.  Split out because flip_level() calls it
// on its own (sp_lev.c:915) WITHOUT wall_cleanup: mirroring the grid moves the
// glyphs but leaves every corner facing the old way.  No RNG.
function fix_wall_spines(x1, y1, x2, y2) {
    const map = game.level;
    // C ref: mkmaze.c:45 iswall() — doors, iron bars, lava wall and water all
    // join a wall spine, not just IS_WALL.
    const iswall = (xx, yy) => {
        if (!isok(xx, yy)) return 0;
        const l = map.at(xx, yy);
        const t = l ? l.typ : STONE;
        return (IS_WALL(t) || IS_DOOR(t) || t === LAVAWALL || t === WATER
                || t === SDOOR || t === IRONBARS) ? 1 : 0;
    };
    // C ref: mkmaze.c:59 iswall_or_stone() — out of bounds counts as stone.
    const iswall_or_stone = (xx, yy) => {
        if (!isok(xx, yy)) return 1;
        const l = map.at(xx, yy);
        return ((l ? l.typ : STONE) === STONE || iswall(xx, yy)) ? 1 : 0;
    };
    // C ref: mkmaze.c:166 extend_spine() — a spine is SUPPRESSED when the wall
    // in that direction is boxed in on both sides by wall/stone, which is what
    // keeps a straight run of wall drawn as '-' instead of a row of tees.
    const extend_spine = (locale, wall_there, dx, dy) => {
        if (!wall_there) return 0;
        const nx = 1 + dx, ny = 1 + dy;
        if (dx) {
            return (locale[1][0] && locale[1][2]
                    && locale[nx][0] && locale[nx][2]) ? 0 : 1;
        }
        return (locale[0][1] && locale[2][1]
                && locale[0][ny] && locale[2][ny]) ? 0 : 1;
    };
    for (let x = x1; x <= x2; x++)
        for (let y = y1; y <= y2; y++) {
            const loc = map.at(x, y);
            if (!loc || !(IS_WALL(loc.typ) && loc.typ !== DBWALL)) continue;
            const locale = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
            for (let ddx = -1; ddx <= 1; ddx++)
                for (let ddy = -1; ddy <= 1; ddy++) {
                    if (!ddx && !ddy) continue;
                    locale[1 + ddx][1 + ddy] = iswall_or_stone(x + ddx, y + ddy);
                }
            const bits = (extend_spine(locale, iswall(x, y - 1), 0, -1) << 3)
                       | (extend_spine(locale, iswall(x, y + 1), 0, 1) << 2)
                       | (extend_spine(locale, iswall(x + 1, y), 1, 0) << 1)
                       | extend_spine(locale, iswall(x - 1, y), -1, 0);
            if (bits) loc.typ = _SPINE[bits];
        }
}

// C ref: mkmaze.c get_level_extends() — bounding box of the non-STONE area,
// padded by 1 (maze edge) or 2 (open level) on each side.  Mirrors mklev.js's
// copy so the flip transform uses the identical extents the C engine does.
export function bigrm_get_level_extends() {
    const map = game.level;
    let xmin = 0, xmax = COLNO - 1, ymin = 0, ymax = ROWNO - 1;
    let found = false, nonwall = false;
    const isMaze = !!map?.flags?.is_maze_lev;
    for (xmin = 0; !found && xmin <= COLNO - 1; xmin++)
        for (let y = 0; y <= ROWNO - 1; y++) {
            const typ = map.at(xmin, y)?.typ ?? STONE;
            if (typ !== STONE) { found = true; if (!IS_WALL(typ)) nonwall = true; }
        }
    xmin -= (nonwall || !isMaze) ? 2 : 1;
    found = false; nonwall = false;
    for (xmax = COLNO - 1; !found && xmax >= 0; xmax--)
        for (let y = 0; y <= ROWNO - 1; y++) {
            const typ = map.at(xmax, y)?.typ ?? STONE;
            if (typ !== STONE) { found = true; if (!IS_WALL(typ)) nonwall = true; }
        }
    xmax += (nonwall || !isMaze) ? 2 : 1;
    found = false; nonwall = false;
    for (ymin = 0; !found && ymin <= ROWNO - 1; ymin++)
        for (let x = xmin; x <= xmax; x++) {
            const typ = map.at(x, ymin)?.typ ?? STONE;
            if (typ !== STONE) { found = true; if (!IS_WALL(typ)) nonwall = true; }
        }
    ymin -= (nonwall || !isMaze) ? 2 : 1;
    found = false; nonwall = false;
    for (ymax = ROWNO - 1; !found && ymax >= 0; ymax--)
        for (let x = xmin; x <= xmax; x++) {
            const typ = map.at(x, ymax)?.typ ?? STONE;
            if (typ !== STONE) { found = true; if (!IS_WALL(typ)) nonwall = true; }
        }
    ymax += (nonwall || !isMaze) ? 2 : 1;
    if (ymin < 0) ymin = 0;
    if (xmin < 1) xmin = 1;
    if (xmax >= COLNO) xmax = COLNO - 1;
    if (ymax >= ROWNO) ymax = ROWNO - 1;
    return { minx: xmin, maxx: xmax, miny: ymin, maxy: ymax };
}

// C ref: sp_lev.c flip_level(flp, FALSE) — level-creation flip.  Transposes the
// map cells, monsters, objects, traps, stairs, rooms and doors within the level
// extents.  Restricted to the entity kinds the Big Room generates (extras=FALSE,
// so the #wizfliplevel-only branches and vault/shk/worm fixups are inapplicable).
export function flip_level(flp) {
    if ((flp & 3) === 0) return;
    const g = game;
    const map = g.level;
    const { minx, maxx, miny, maxy } = bigrm_get_level_extends();
    const FlipX = (x) => (minx + maxx - x);
    const FlipY = (y) => (miny + maxy - y);
    const inArea = (x, y) => (x >= minx && x <= maxx && y >= miny && y <= maxy);

    // stairs (game.stairs may be an array (bigrm) or null)
    for (const s of (Array.isArray(g.stairs) ? g.stairs : [])) {
        if (flp & 1) s.sy = FlipY(s.sy);
        if (flp & 2) s.sx = FlipX(s.sx);
    }
    const flipPt = (pt, kx, ky) => {
        if (!pt) return;
        if (flp & 1) pt[ky] = FlipY(pt[ky]);
        if (flp & 2) pt[kx] = FlipX(pt[kx]);
    };
    flipPt(g.upstair, 'x', 'y'); flipPt(g.dnstair, 'x', 'y');
    if (map?.upstair) flipPt(map.upstair, 'x', 'y');
    if (map?.dnstair) flipPt(map.dnstair, 'x', 'y');

    // traps
    for (const t of (map.traps || [])) {
        if (!inArea(t.tx, t.ty)) continue;
        if (flp & 1) t.ty = FlipY(t.ty);
        if (flp & 2) t.tx = FlipX(t.tx);
    }
    // objects
    for (const o of (map.objects || [])) {
        if (!inArea(o.ox, o.oy)) continue;
        if (flp & 1) o.oy = FlipY(o.oy);
        if (flp & 2) o.ox = FlipX(o.ox);
    }
    // monsters
    for (const m of (map.monsters || [])) {
        if (!inArea(m.mx, m.my)) continue;
        if (flp & 1) m.my = FlipY(m.my);
        if (flp & 2) m.mx = FlipX(m.mx);
        // C ref: sp_lev.c:645-661 — the extended-monster coords flip AFTER the
        // in-area `continue` and after the monster's own mx/my, and each goes
        // through Flip_coord(), which is `if ((cc).x && inFlipArea(cc))`
        // (sp_lev.c:520-528): a stored coord of 0, or one off the flip area, is
        // left alone.  Without this a flipped Mine Town leaves every shopkeeper
        // walking toward the pre-flip door and pri_move() at the wrong altar.
        const flipCoord = (cc) => { if (cc && cc.x && inArea(cc.x, cc.y)) flipPt(cc, 'x', 'y'); };
        if (m.ispriest) flipCoord(m.epri?.shrpos);
        else if (m.isshk && m.eshk) { flipCoord(m.eshk.shk); flipCoord(m.eshk.shd); }
    }
    // engravings — C ref: sp_lev.c:689-694, flipped unconditionally.
    for (const e of (map.engravings || [])) {
        if (flp & 1) e.engr_y = FlipY(e.engr_y);
        if (flp & 2) e.engr_x = FlipX(e.engr_x);
    }
    // rooms
    for (let i = 0; i < (map.nroom || 0); i++) {
        const r = map.rooms[i];
        if (!r || r.hx < 0) continue;
        if (flp & 1) {
            r.ly = FlipY(r.ly); r.hy = FlipY(r.hy);
            if (r.ly > r.hy) { const t = r.ly; r.ly = r.hy; r.hy = t; }
        }
        if (flp & 2) {
            r.lx = FlipX(r.lx); r.hx = FlipX(r.hx);
            if (r.lx > r.hx) { const t = r.lx; r.lx = r.hx; r.hx = t; }
        }
    }
    // doors
    for (const d of (map.doors || [])) {
        if (!d) continue;
        if (flp & 1) d.y = FlipY(d.y);
        if (flp & 2) d.x = FlipX(d.x);
    }

    // the map cells
    if (flp & 1) {
        for (let x = minx; x <= maxx; x++)
            for (let y = miny; y < (miny + Math.floor((maxy - miny + 1) / 2)); y++) {
                const ny = FlipY(y);
                const tmp = map.locations[x][y];
                map.locations[x][y] = map.locations[x][ny];
                map.locations[x][ny] = tmp;
            }
    }
    if (flp & 2) {
        for (let x = minx; x < (minx + Math.floor((maxx - minx + 1) / 2)); x++)
            for (let y = miny; y <= maxy; y++) {
                const nx = FlipX(x);
                const tmp = map.locations[x][y];
                map.locations[x][y] = map.locations[nx][y];
                map.locations[nx][y] = tmp;
            }
    }

    // C ref: sp_lev.c:915 — flip_level() ends with fix_wall_spines() over the
    // whole grid.  Mirroring moves the cells but leaves every corner/T glyph
    // pointing the pre-flip way (seed0360 step 211: 43 differing cells, all of
    // them wall corners).  RNG-free.
    fix_wall_spines(1, 0, COLNO - 1, ROWNO - 1);
}

// C ref: sp_lev.c:4323 trap_types[] — des.trap() name -> ttyp.  This used to
// list only the two kinds soko2/soko3 ask for, so soko4's ten `pit` traps became
// maketrap(x, y, undefined): no RNG either way (which is why the stream stayed
// aligned) but ttyp undefined, rendering '^' in cyan instead of PIT's black.
const SOKO_TRAP_NAME = {
    arrow: ARROW_TRAP, dart: DART_TRAP, 'falling rock': ROCKTRAP,
    board: SQKY_BOARD, bear: BEAR_TRAP, 'land mine': LANDMINE,
    'rolling boulder': ROLLING_BOULDER_TRAP, 'sleep gas': SLP_GAS_TRAP,
    rust: RUST_TRAP, fire: FIRE_TRAP, pit: PIT, 'spiked pit': SPIKED_PIT,
    hole: HOLE, 'trap door': TRAPDOOR, teleport: TELEP_TRAP,
    'level teleport': LEVEL_TELEP, 'magic portal': MAGIC_PORTAL, web: WEB,
    statue: STATUE_TRAP, magic: MAGIC_TRAP, 'anti magic': ANTI_MAGIC,
    polymorph: POLY_TRAP, 'vibrating square': VIBRATING_SQUARE, random: -1,
};

// C ref: mklev.c mktrap(num, ..., tm) with an explicit type+coord (skips the
// type/location RNG that the no-args des.trap() form draws) — maketrap()
// (which for HOLE/TRAPDOOR draws hole_destination()'s rn2(4) internally),
// then the victim-gate rnd(4) (mklev.c:2135-2144), ALWAYS drawn when
// kind!=NO_TRAP.  At this level's difficulty (13 — Sokoban's builds-up
// adjustment on top of depth 5, see level_difficulty_ext()) `lvl <= rnd(4)`
// can never pass (rnd(4)'s max is 4), so mktrap_victim() is never reachable
// here and is intentionally not ported — porting it on a guess with no
// recorded stream that exercises it would risk an unverified RNG count.
export async function soko_mktrap(mx, my, name) {
    const x = q_absx(mx), y = q_absy(my);
    const trap = await maketrap(x, y, SOKO_TRAP_NAME[name]);
    const kind = trap ? trap.ttyp : NO_TRAP;
    const lvl = level_difficulty_ext();
    if (kind !== NO_TRAP
        && lvl <= rnd(4)
        && kind !== SQKY_BOARD && kind !== RUST_TRAP
        && !(kind === ROLLING_BOULDER_TRAP
             && trap.launch?.x === trap.tx && trap.launch?.y === trap.ty)
        && !is_pit(kind) && (kind < HOLE || kind === MAGIC_TRAP)) {
        // unreachable at this level's difficulty — see comment above.
    }
    return trap;
}

// C ref: sp_lev.c create_object — bare class char, no coord -> get_location
// (DRY, random) then mkobj_at(oclass, x, y, !named).
export function soko_create_object_class_random(oclass) {
    const c = bigrm_get_location_dry();
    return mkobj_at(oclass, c.x, c.y, true);
}

// C ref: sp_lev.c lspo_region — the region(selection,"lit") 2-arg form: grow
// the selection by 1 (W_ANY) then set .lit on every included cell.  No RNG,
// no room created.  Local (map-relative) rectangle.
export function soko_region_lit_grow(x1, y1, x2, y2) {
    const dx1 = Math.max(x1 + gx.xstart - 1, 1);
    const dy1 = Math.max(y1 + gy.ystart - 1, 0);
    const dx2 = Math.min(x2 + gx.xstart + 1, COLNO - 1);
    const dy2 = Math.min(y2 + gy.ystart + 1, ROWNO - 1);
    for (let x = dx1; x <= dx2; x++)
        for (let y = dy1; y <= dy2; y++) {
            const loc = game.level?.at(x, y);
            if (loc) loc.lit = true;
        }
}

// C ref: sp_lev.c set_wall_property(W_NONDIGGABLE|W_NONPASSWALL) applied over
// this file's own des.non_diggable/non_passwall(area(0,0,25,16)) call (which
// covers every wall inside the map's own footprint, interior and boundary)
// UNIONED with solidify_map()'s pass over the rest of the level (any
// IS_STWALL cell outside the map's own footprint — everywhere else is
// still bare STONE from level_init, so solidify_map's own "!SpLev_Map[x][y]"
// gate is equivalent here to "outside our map").  Both operations are RNG
// free, so folding them into one full-grid pass produces the same final
// state as running them separately.
export function soko_solidify_and_nondig() {
    for (let x = 1; x < COLNO; x++) {
        for (let y = 0; y < ROWNO; y++) {
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            if (IS_STWALL(loc.typ) || IS_TREE(loc.typ) || loc.typ === IRONBARS) {
                loc.wall_info = (loc.wall_info || 0) | W_NONDIGGABLE | W_NONPASSWALL;
            }
        }
    }
}

// C ref: mkroom.h TEMPLE room type (const.js exports MORGUE already).
export const TEMPLE_RTYPE = 10;

// C ref: sp_lev.c get_location() with croom == NULL for an EXPLICIT coordinate:
// the map-relative x/y simply gain the last des.map() origin.  No RNG.
export function vly_abs(mx, my) { return { x: mx + gx.xstart, y: my + gy.ystart }; }

// C ref: nhlsel.c l_selection_line -> selection_do_line(): both endpoints go
// through get_location_coord() first, then Bresenham between them.  valley.lua
// only ever draws axis-aligned lines.  No RNG.
export function vly_terrain_line(x1, y1, x2, y2, typ) {
    const a = vly_abs(x1, y1), b = vly_abs(x2, y2);
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let i = 0; i <= n; i++)
        set_levltyp_lit(a.x + dx * i, a.y + dy * i, typ, SET_LIT_NOCHANGE);
}

// C ref: sp_lev.c lspo_terrain() table form des.terrain({x=,y=,typ=}).  No RNG.
export function vly_terrain_at(mx, my, typ) {
    const c = vly_abs(mx, my);
    set_levltyp_lit(c.x, c.y, typ, SET_LIT_NOCHANGE);
}

// C ref: mklev.c add_door(x, y, aroom).  Kept local to sp_lev.js (rather than
// imported from mklev.js) because mklev.js already imports this module and a
// second edge would close an import cycle.  No RNG.
function splev_add_door(x, y, aroom) {
    const g = game;
    if (!g.level.doors) g.level.doors = [];
    for (let i = 0; i < aroom.doorct; i++) {
        const d = g.level.doors[aroom.fdoor + i];
        if (d && d.x === x && d.y === y) return;
    }
    if (aroom.doorct === 0) aroom.fdoor = g.level.doorindex;
    aroom.doorct++;
    for (let tmp = g.level.doorindex; tmp > aroom.fdoor; tmp--)
        g.level.doors[tmp] = g.level.doors[tmp - 1];
    for (const broom of g.level.rooms || []) {
        if (!broom || broom.hx <= 0 || broom === aroom || !(broom.doorct > 0)) continue;
        if ((broom.fdoor ?? 0) >= aroom.fdoor) broom.fdoor++;
    }
    g.level.doors[aroom.fdoor] = { x, y };
    g.level.doorindex++;
}

// C ref: sp_lev.c maybe_add_door() / add_doors_to_room() — after a region has
// become a room, every DOOR/SDOOR square already on the map that belongs to it
// joins its door list.  No RNG.
function splev_add_doors_to_room(croom) {
    const rmno = croom.roomnoidx + ROOMOFFSET;
    for (let x = croom.lx - 1; x <= croom.hx + 1; x++)
        for (let y = croom.ly - 1; y <= croom.hy + 1; y++) {
            const loc = game.level?.at(x, y);
            if (!loc || !(IS_DOOR(loc.typ) || loc.typ === SDOOR)) continue;
            const mine = croom.irregular
                ? (loc.roomno === rmno)
                : (x >= croom.lx - 1 && x <= croom.hx + 1
                   && y >= croom.ly - 1 && y <= croom.hy + 1);
            if (mine || loc.roomno === rmno) splev_add_door(x, y, croom);
        }
}

// C ref: mklev.c bydoor(x, y) — is any orthogonal neighbour already a door?
// No RNG.
export function bydoor(x, y) {
    const map = game.level;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!isok(x + dx, y + dy)) continue;
        const loc = map.at(x + dx, y + dy);
        if (loc && (IS_DOOR(loc.typ) || loc.typ === SDOOR)) return true;
    }
    return false;
}

// C ref: mklev.c:1779-1790 okdoor(x, y).  Load-bearing for RNG: create_door's
// retry loop breaks on it, so a missing clause costs (or invents) whole
// rn2(4)+rn2(span) iterations.  No RNG.
export function okdoor(x, y) {
    const map = game.level;
    const loc = map.at(x, y);
    if (!loc) return false;
    if (!(loc.typ === HWALL || loc.typ === VWALL)) return false;
    if (bydoor(x, y)) return false;
    return (
        (isok(x - 1, y) && !IS_OBSTRUCTED(map.at(x - 1, y).typ))
        || (isok(x + 1, y) && !IS_OBSTRUCTED(map.at(x + 1, y).typ))
        || (isok(x, y - 1) && !IS_OBSTRUCTED(map.at(x, y - 1).typ))
        || (isok(x, y + 1) && !IS_OBSTRUCTED(map.at(x, y + 1).typ))
    );
}

// C ref: sp_lev.c:1713-1806 create_door(room_door *dd, struct mkroom *broom).
// dd: { secret: -1|0|1, mask: -1|doormask, pos: -1|offset, wall: bitmask }.
// The three prologue mutations of *dd (secret, wall, mask) survive the call in
// C, so they are written back here too.
//
// Draw order per retry iteration is rn2(4) [wall side] and then, only when that
// side is in `wall` and pos == -1, rn2(span) [offset along it]; both the
// obstruction test and okdoor() run AFTER the offset draw, so a rejected
// placement still costs two draws.
export function create_door(dd, broom) {
    if (dd.secret === -1) dd.secret = rn2(2);            // sp_lev.c:1720
    if (dd.wall === W_RANDOM) dd.wall = W_ANY;           // sp_lev.c:1723
    if (dd.mask === -1) {
        if (!dd.secret) {
            if (!rn2(3)) {                               // sp_lev.c:1728
                if (!rn2(5)) dd.mask = D_ISOPEN;         // sp_lev.c:1729
                else if (!rn2(6)) dd.mask = D_LOCKED;    // sp_lev.c:1731
                else dd.mask = D_CLOSED;
                if (dd.mask !== D_ISOPEN && !rn2(25))    // sp_lev.c:1735
                    dd.mask |= D_TRAPPED;
            } else {
                dd.mask = D_NODOOR;
            }
        } else {
            if (!rn2(5)) dd.mask = D_LOCKED;             // sp_lev.c:1740
            else dd.mask = D_CLOSED;
            if (!rn2(20)) dd.mask |= D_TRAPPED;          // sp_lev.c:1745
        }
    }
    let x = 0, y = 0, trycnt;
    for (trycnt = 0; trycnt < 100; trycnt++) {
        const dwall = dd.wall, dpos = dd.pos;
        switch (rn2(4)) {                                // sp_lev.c:1754
        case 0: // W_NORTH
            if (!(dwall & 1)) continue;
            y = broom.ly - 1;
            x = broom.lx + ((dpos === -1) ? rn2(1 + broom.hx - broom.lx) : dpos);
            if (!isok(x, y - 1) || IS_OBSTRUCTED(game.level.at(x, y - 1)?.typ)) continue;
            break;
        case 1: // W_SOUTH
            if (!(dwall & 2)) continue;
            y = broom.hy + 1;
            x = broom.lx + ((dpos === -1) ? rn2(1 + broom.hx - broom.lx) : dpos);
            if (!isok(x, y + 1) || IS_OBSTRUCTED(game.level.at(x, y + 1)?.typ)) continue;
            break;
        case 2: // W_WEST
            if (!(dwall & 8)) continue;
            x = broom.lx - 1;
            y = broom.ly + ((dpos === -1) ? rn2(1 + broom.hy - broom.ly) : dpos);
            if (!isok(x - 1, y) || IS_OBSTRUCTED(game.level.at(x - 1, y)?.typ)) continue;
            break;
        case 3: // W_EAST
            if (!(dwall & 4)) continue;
            x = broom.hx + 1;
            y = broom.ly + ((dpos === -1) ? rn2(1 + broom.hy - broom.ly) : dpos);
            if (!isok(x + 1, y) || IS_OBSTRUCTED(game.level.at(x + 1, y)?.typ)) continue;
            break;
        }
        if (okdoor(x, y)) break;
    }
    if (trycnt >= 100) return;  // C: impossible(), *dd mutations already made
    const loc = game.level.at(x, y);
    if (!loc) return;
    // C: set_levltyp(x, y, dd->secret ? SDOOR : DOOR) — assigns typ only.  It
    // deliberately does NOT touch .horizontal: the door inherits the
    // orientation flag the underlying HWALL/VWALL already carried.
    loc.typ = dd.secret ? SDOOR : DOOR;
    loc.doormask = dd.mask;
    // C's create_door does NOT call add_door(); the square is picked up by
    // add_doors_to_room() when the enclosing region/room closes.  Our
    // themeroom caller relied on the eager registration, so keep it: the
    // duplicate check in splev_add_door makes a later add_doors_to_room a
    // no-op.  No RNG either way.
    splev_add_door(x, y, broom);
}

// C ref: sp_lev.c rnddoor() — state[rn2(5)].  Reachable from lspo_door's
// `typ = (msk == -1) ? rnddoor() : msk;`.
export function splev_rnddoor_roll() {
    const state = [D_NODOOR, 0x01 /*D_BROKEN*/, D_ISOPEN, D_CLOSED, D_LOCKED];
    return state[rn2(state.length)];
}

// C ref: sp_lev.c lspo_door() doorstates[]/doorstates2i[] and
// walldirs[]/walldirs2i[].  Note "all" and "random" both map to W_ANY, so the
// W_RANDOM normalisation inside create_door is never reached from des.door.
export const DOORSTATES = {
    random: -1, open: D_ISOPEN, closed: D_CLOSED, locked: D_LOCKED,
    nodoor: D_NODOOR, broken: 0x01 /*D_BROKEN*/, secret: D_SECRET,
};
export const WALLDIRS = {
    all: W_ANY, random: W_ANY, north: 1, west: 8, east: 4, south: 2,
};

// C ref: sp_lev.c lspo_door() x == -1 && y == -1 arm — a wall-relative door in
// the current room.  `typ` is discarded except for its D_SECRET test, but the
// rnddoor() rn2(5) it costs is real.
export function lspo_door_relative(spec, broom) {
    const msk = DOORSTATES[spec.state != null ? spec.state : 'random'];
    const typ = (msk === -1) ? splev_rnddoor_roll() : msk;
    if (!broom) return;
    create_door({
        secret: (typ === D_SECRET) ? 1 : 0,
        mask: msk,
        pos: spec.pos != null ? spec.pos : -1,
        wall: WALLDIRS[spec.wall != null ? spec.wall : 'all'],
    }, broom);
}

// C ref: mkmap.c flood_fill_rm(sx, sy, rmno, lit, anyroom=TRUE) — the
// scanline flood behind an irregular des.region.  Faithful to the C recursion
// (including its diagonal spill-over through the `else` arms), because the
// exact set of flooded squares decides how many squares fill_zoo() stocks and
// therefore thousands of downstream draws.  No RNG.
const FFR_WIDTH = COLNO - 2;
function flood_fill_rm(sx, sy, rmno, lit, anyroom, ext) {
    const at = (x, y) => game.level?.at(x, y);
    const typAt = (x, y) => at(x, y)?.typ;
    const roomnoAt = (x, y) => (at(x, y)?.roomno ?? NO_ROOM);
    const fg_typ = typAt(sx, sy);

    while (sx > 0 && (anyroom ? IS_ROOM(typAt(sx, sy)) : typAt(sx, sy) === fg_typ)
           && roomnoAt(sx, sy) !== rmno)
        sx--;
    sx++;

    if (sx < ext.min_rx) ext.min_rx = sx;
    if (sy < ext.min_ry) ext.min_ry = sy;

    let i;
    for (i = sx; i <= FFR_WIDTH && typAt(i, sy) === fg_typ; i++) {
        const loc = at(i, sy);
        loc.roomno = rmno;
        loc.lit = !!lit;
        if (anyroom) {
            /* add walls to room as well */
            for (let ii = (i === sx ? i - 1 : i); ii <= i + 1; ii++)
                for (let jj = sy - 1; jj <= sy + 1; jj++) {
                    if (!isok(ii, jj)) continue;
                    const wl = at(ii, jj);
                    if (!wl) continue;
                    if (!(IS_WALL(wl.typ) || IS_DOOR(wl.typ) || wl.typ === SDOOR))
                        continue;
                    wl.edge = 1;
                    if (lit) wl.lit = true;
                    if ((wl.roomno ?? NO_ROOM) === NO_ROOM) wl.roomno = rmno;
                    else if (wl.roomno !== rmno) wl.roomno = SHARED;
                }
        }
        ext.n_loc_filled++;
    }
    const nx = i;

    for (const dy of [-1, 1]) {
        if (!isok(sx, sy + dy)) continue;
        for (i = sx; i < nx; i++) {
            if (typAt(i, sy + dy) === fg_typ) {
                if (roomnoAt(i, sy + dy) !== rmno)
                    flood_fill_rm(i, sy + dy, rmno, lit, anyroom, ext);
            } else {
                if ((i > sx || isok(i - 1, sy + dy))
                    && typAt(i - 1, sy + dy) === fg_typ
                    && roomnoAt(i - 1, sy + dy) !== rmno)
                    flood_fill_rm(i - 1, sy + dy, rmno, lit, anyroom, ext);
                if ((i < nx - 1 || isok(i + 1, sy + dy))
                    && typAt(i + 1, sy + dy) === fg_typ
                    && roomnoAt(i + 1, sy + dy) !== rmno)
                    flood_fill_rm(i + 1, sy + dy, rmno, lit, anyroom, ext);
            }
        }
    }

    if (nx > ext.max_rx) ext.max_rx = nx - 1;
    if (sy > ext.max_ry) ext.max_ry = sy;
}

// C ref: sp_lev.c lspo_region() for a SPECIAL (non-OROOM) region — the room is
// really created (add_room + topologize, or flood_fill_rm for an irregular one),
// its needfill is recorded for the level-finalize fill_special_room() pass, and
// add_doors_to_room() attaches any door squares already on the map.  litstate is
// an explicit 0/1 here, so litstate_rnd() draws nothing.
//
// Generic despite the vly_ prefix: the named Gehennom levels in mklev.js
// (sanctum/orcus/wizard1-3/...) create their morgues, zoos, beehives, temples
// and shops through this same entry point.
// `contents` is the Lua region's contents function: C runs update_croom() ->
// contents() -> spo_endroom() -> add_doors_to_room(), so it must fire AFTER
// the room exists and BEFORE the door sweep.
export function vly_region(mx1, my1, mx2, my2, lit, rtype, needfill, irregular,
                           contents) {
    const a = vly_abs(mx1, my1), b = vly_abs(mx2, my2);
    let croom;
    if (irregular) {
        const roomno = game.level.nroom + ROOMOFFSET;
        const ext = { min_rx: a.x, max_rx: a.x, min_ry: a.y, max_ry: a.y,
                      n_loc_filled: 0 };
        flood_fill_rm(a.x, a.y, roomno, lit, true, ext);
        croom = add_sp_room(ext.min_rx, ext.min_ry, ext.max_rx, ext.max_ry,
                            lit, rtype, true, needfill, true);
    } else {
        croom = add_sp_room(a.x, a.y, b.x, b.y, lit, rtype, false, needfill, true);
        const roomno = croom.roomnoidx + ROOMOFFSET;
        for (let x = a.x; x <= b.x; x++)
            for (let y = a.y; y <= b.y; y++) {
                const loc = game.level?.at(x, y);
                if (loc) { loc.roomno = roomno; loc.lit = !!lit; }
            }
    }
    if (contents) contents(croom);
    splev_add_doors_to_room(croom);
    return croom;
}

// C ref: sp_lev.c lspo_teleport_region() -> fixup_special() LR_DOWNTELE arm,
// which copies the region into svd.dndest for goto_level()'s own
// place_lregion() call (the hero's arrival spot).  No RNG here.
// `islev` is the Lua `region_islev` flag: the coordinates are then whole-level
// absolute rather than relative to the last des.map() origin (sp_lev.c
// lspo_teleport_region reads region_islev before get_location_coord).
export function vly_teleport_region(mx1, my1, mx2, my2, islev, dir = 'both') {
    const a = islev ? { x: mx1, y: my1 } : vly_abs(mx1, my1);
    const b = islev ? { x: mx2, y: my2 } : vly_abs(mx2, my2);
    // C ref: sp_lev.c lspo_teleport_region():5452 — dir defaults to "both"
    // (LR_TELE), which fixup_special() copies into BOTH svu.updest and svd.dndest.
    const rgn = { lx: a.x, ly: a.y, hx: b.x, hy: b.y,
                  nlx: 0, nly: 0, nhx: 0, nhy: 0 };
    if (dir === 'both' || dir === 'up') game.updest = { ...rgn };
    if (dir === 'both' || dir === 'down') game.dndest = { ...rgn };
}

// C ref: sp_lev.c create_altar() with croom == NULL — an explicit coordinate
// (no RNG), the altarmask from the requested alignment, and, when the square
// falls inside a TEMPLE region and shrine is set, priestini().  Generic
// despite the prefix — sanctum.lua and orcus.lua use it for their `type=
// "sanctum"` altars (shrine == 2, which also sets AM_SANCTUM).
export function vly_altar(mx, my, amask, shrine) {
    const c = vly_abs(mx, my);
    if (!set_levltyp_lit(c.x, c.y, ALTAR, SET_LIT_NOCHANGE)) return;
    const loc = game.level.at(c.x, c.y);
    loc.altarmask = amask;
    // C: `sproom = *in_rooms(x, y, TEMPLE)`; a des.region temple already owns
    // this square's roomno.
    const rno = (loc.roomno ?? 0) - ROOMOFFSET;
    const croom = (rno >= 0) ? game.level.rooms[rno] : null;
    if (!croom || croom.rtype !== TEMPLE_RTYPE || !shrine) return;
    priestini(game.u?.uz, croom, c.x, c.y, shrine > 1);
    loc.altarmask |= AM_SHRINE;
    // C ref: create_altar()'s tail — `shrine == 2` is a high altar / sanctum,
    // and either way the level is now known to hold a temple.  No RNG.
    if (shrine === 2) loc.altarmask |= AM_SANCTUM;
    if (game.level?.flags) game.level.flags.has_temple = true;
}

// C ref: sp_lev.c lspo_non_diggable() -> set_wall_property(W_NONDIGGABLE) over
// the selection: every wall/tree/ironbars square inside it becomes undiggable.
// No RNG.
export function vly_non_diggable(mx1, my1, mx2, my2) {
    const a = vly_abs(mx1, my1), b = vly_abs(mx2, my2);
    for (let x = Math.max(a.x, 1); x <= Math.min(b.x, COLNO - 1); x++)
        for (let y = Math.max(a.y, 0); y <= Math.min(b.y, ROWNO - 1); y++) {
            const loc = game.level?.at(x, y);
            if (!loc) continue;
            if (IS_STWALL(loc.typ) || IS_TREE(loc.typ) || loc.typ === IRONBARS)
                loc.wall_info = (loc.wall_info || 0) | W_NONDIGGABLE;
        }
}

// C ref: sp_lev.c create_object() at a RANDOM DRY location.  `montype` names a
// species for a corpse/statue (a plain table scan in lspo_object -> no RNG);
// `oclass` is a des.object("X") class char; `otyp` a des.object("name") id.
export function vly_object({ otyp = null, oclass = null, montype = null }) {
    const { x, y } = splev_get_location_rnd(LOC_DRY);
    let otmp;
    if (otyp != null) otmp = mksobj_at(otyp, x, y, true, true);
    else if (oclass != null) otmp = mkobj_at(oclass, x, y, true);
    else otmp = mkobj_at(0 /* RANDOM_CLASS */, x, y, true);
    if (otmp && montype != null) {
        const pmidx = name_to_pmidx(montype);
        if (pmidx >= 0) set_corpsenm(otmp, pmidx);
    }
    return otmp;
}

// C ref: sp_lev.c create_trap() — get_location(DRY) (explicit coord: no RNG;
// random coord: the rn2 loop) then mktrap(type, MKTRAP_MAZEFLAG|NOSPIDERONWEB).
// mktrap's own only draw at this depth is the victim check rnd(4)
// (mklev.c:2137), which is always evaluated and never succeeds here.
export async function vly_trap(ttyp, mx = null, my = null) {
    let x, y;
    if (mx != null) { const c = vly_abs(mx, my); x = c.x; y = c.y; }
    else { const c = splev_get_location_rnd(LOC_DRY); x = c.x; y = c.y; }
    await maketrap(x, y, ttyp);
    rnd(4);                                       // mktrap victim check
}

// C ref: sp_lev.c create_monster() for a bare CLASS char ("L"/"V"/"Z"/"M").
// find_montype is never reached (no "id" field), so there is no gender roll;
// the class is resolved by mkclass(class, G_NOGEN) AFTER induced_align.
export function vly_monster_class(classNum) {
    rn2(3);                                           // induced_align
    const ptr = mkclass(classNum, 0x0200 /* G_NOGEN */);
    if (!ptr) return null;
    return vly_place_monster(ptr);
}

export function vly_place_monster(ptr) {
    const hum = pm_to_humidity(ptr);
    let { x, y } = splev_get_location_rnd(hum, true);
    if (x === -1 && y === -1) {
        const c = splev_get_location_rnd(hum | LOC_DRY);
        x = c.x; y = c.y;
    }
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, ptr);
        if (cc) { x = cc.x; y = cc.y; }
    }
    return makemon(ptr, x, y, 0 /* NO_MM_FLAGS */);
}
export const VLY_S_LICH = 38, VLY_S_MUMMY = 39, VLY_S_VAMPIRE = 48, VLY_S_ZOMBIE = 52;

// C ref: sp_lev.c flip_level():697 "level (teleport) regions" — gl.lregions[]
// is mirrored with the map, and fixup_special() copies the teleport region into
// svd.dndest only AFTER that.  This port fills dndest at des.teleport_region()
// time (BEFORE the flip), so every generator that flips must mirror it too or
// the hero lands on the un-mirrored arrival square (seed0373: Plane of Fire,
// x=72 where C has x=8).  No RNG.
export function vly_flip_dndest(flp) { flip_lregion_dest(flp, game.dndest); }

// The updest half of the same C loop.  Split out because only the four
// elemental planes reach goto_level() with `up` set (their depth is negative,
// so every arrival counts as going up) and therefore read svu.updest; flipping
// it for the mine-end / Valley / sanctum generators as well measured -105 on
// seed4500, whose exclusion regions sit off-map.
export function vly_flip_updest(flp) { flip_lregion_dest(flp, game.updest); }

function flip_lregion_dest(flp, d) {
    if (!d) return;
    const { minx, maxx, miny, maxy } = bigrm_get_level_extends();
    // C ref: sp_lev.c flip_level():698-731 — the lregion loop applies FlipX /
    // FlipY to inarea and delarea UNCONDITIONALLY; unlike the map/monster/object
    // loops it has no inFlipArea() test, so a corner outside the level extents
    // is flipped anyway.  An in-extents guard here turned air.lua's up region
    // {1,0}-{24,20} into a ONE-ROW box whenever y=0 fell outside the extents,
    // which made u_on_rndspot draw rn2(1) where C draws rn2(21).
    for (const [kx, ky] of [['lx', 'ly'], ['hx', 'hy']]) {
        if (flp & 1) d[ky] = miny + maxy - d[ky];
        if (flp & 2) d[kx] = minx + maxx - d[kx];
    }
    if (d.lx > d.hx) { const t = d.lx; d.lx = d.hx; d.hx = t; }
    if (d.ly > d.hy) { const t = d.ly; d.ly = d.hy; d.hy = t; }
    // C ref: sp_lev.c flip_level():708-714 / 725-731 — the EXCLUSION half of
    // each lregion (delarea) is flipped by the same FlipX/FlipY, with no
    // in-extents test and its own low/high swap.  Leaving it unflipped left the
    // Plane of Air's arrival region and its exclusion pointing at opposite ends
    // of the level, so every one of place_lregion()'s 200 rn1() tries landed
    // inside the exclusion and the hero fell through to the deterministic scan
    // (seed0373 step 110: C accepts its FIRST try).  An all-zero delarea means
    // "no exclusion" and must stay all-zero, so skip it.
    if (d.nlx || d.nly || d.nhx || d.nhy) {
        if (flp & 1) { d.nly = miny + maxy - d.nly; d.nhy = miny + maxy - d.nhy; }
        if (flp & 2) { d.nlx = minx + maxx - d.nlx; d.nhx = minx + maxx - d.nhx; }
        if (d.nlx > d.nhx) { const t = d.nlx; d.nlx = d.nhx; d.nhx = t; }
        if (d.nly > d.nhy) { const t = d.nly; d.nly = d.nhy; d.nhy = t; }
    }
}

// C ref: lspo_finalize_level()'s trailing `for (i = 0; i < svn.nroom; ++i)
// fill_special_room(&svr.rooms[i]);` — run AFTER fixup_special() has placed the
// branch lregion.  Stocking runs the fully C-faithful monster path, the same
// flag the other special-level generators use.
export function fill_level_special_rooms() {
    const g = game;
    const was_full = g._full_mon_gen;
    g._full_mon_gen = true;
    try {
        for (let i = 0; i < (g.level?.nroom ?? 0); i++)
            fill_special_room(g.level.rooms[i]);
    } finally {
        g._full_mon_gen = was_full;
    }
}

// C ref: sp_lev.c lspo_region() two-argument form `des.region(sel, "lit")`
// (sp_lev.c:5613-5629).  This form NEVER builds a room: the selection is
// cloned, grown one cell in every direction when lighting
// (selection_do_grow(sel, W_ANY)), and sel_set_lit writes levl[][].lit on each
// point — lava counts as lit whatever was asked for.  No RNG.
export function splev_region_lit(mx1, my1, mx2, my2, lit) {
    const a = vly_abs(mx1, my1), b = vly_abs(mx2, my2);
    let lox = a.x, loy = a.y, hix = b.x, hiy = b.y;
    if (lit) { lox--; loy--; hix++; hiy++; }
    // selection_iterate skips !isok cells, and isok() starts at x == 1.
    for (let x = Math.max(1, lox); x <= Math.min(COLNO - 1, hix); x++)
        for (let y = Math.max(0, loy); y <= Math.min(ROWNO - 1, hiy); y++) {
            const loc = game.level?.at(x, y);
            if (loc) loc.lit = !!(IS_LAVA(loc.typ) || lit);
        }
}

// C ref: sp_lev.c lspo_terrain() over a selection.area() rectangle.  No RNG.
export function splev_terrain_area(mx1, my1, mx2, my2, typ) {
    const a = vly_abs(mx1, my1), b = vly_abs(mx2, my2);
    for (let x = a.x; x <= b.x; x++)
        for (let y = a.y; y <= b.y; y++)
            set_levltyp_lit(x, y, typ, SET_LIT_NOCHANGE);
}

// C ref: sp_lev.c sel_set_feature() — a furniture square is left alone;
// anything else takes the feature's typ directly (no set_levltyp).  No RNG.
export function splev_feature(mx, my, typ) {
    const c = vly_abs(mx, my);
    const loc = game.level?.at(c.x, c.y);
    if (!loc || IS_FURNITURE(loc.typ)) return;
    loc.typ = typ;
}

// C ref: sp_lev.c lspo_door() 3-argument form des.door(state, x, y).  A
// "random" state is msk == -1, which costs one rnddoor() rn2(5) before
// sel_set_door; every other state is a plain mask and draws nothing.
export function splev_door_at(state, mx, my) {
    const msk = DOORSTATES[state];
    const typ = (msk === -1) ? splev_rnddoor_roll() : msk;
    const c = vly_abs(mx, my);
    const loc = game.level?.at(c.x, c.y);
    if (!loc) return;
    let mask = typ;
    if (!IS_DOOR(loc.typ) && loc.typ !== SDOOR)
        loc.typ = (mask & D_SECRET) ? SDOOR : DOOR;
    if (mask & D_SECRET) {
        mask &= ~D_SECRET;
        if (mask < D_CLOSED) mask = D_CLOSED;
    }
    set_door_orientation(c.x, c.y);
    loc.doormask = mask;
}

// C ref: sp_lev.c link_doors_rooms() (sp_lev.c:1122) — the first thing
// lspo_finalize_level() does.  Every DOOR/SDOOR square on the map is
// re-oriented and offered to every room in index order; maybe_add_door()
// accepts it when it borders that room.  Load-bearing for shops: stock_room()
// reads svd.doors[sroom->fdoor], and minetn-*.lua places its shop doors AFTER
// the des.region that creates the shop, so without this pass the shop has no
// door at all.  No RNG.
export function splev_link_doors_rooms() {
    const g = game;
    for (let y = 0; y < ROWNO; y++)
        for (let x = 0; x < COLNO; x++) {
            const loc = g.level?.at(x, y);
            if (!loc || !(IS_DOOR(loc.typ) || loc.typ === SDOOR)) continue;
            set_door_orientation(x, y);
            for (let i = 0; i < (g.level?.nroom ?? 0); i++) {
                const croom = g.level.rooms[i];
                if (!croom || croom.hx < 0) continue;
                const rmno = croom.roomnoidx + ROOMOFFSET;
                const mine = croom.irregular
                    ? (loc.roomno === rmno)
                    : (x >= croom.lx - 1 && x <= croom.hx + 1
                       && y >= croom.ly - 1 && y <= croom.hy + 1);
                if (mine) splev_add_door(x, y, croom);
            }
        }
}

function splev_In_mines() {
    return game.mines_dnum != null && game.u?.uz?.dnum === game.mines_dnum;
}
function splev_race_is(nm) {
    return (races[game.initrace]?.name || 'human') === nm;
}
// C ref: mondata.h:102 `((ptr)->mflags2 & gu.urace.selfmask) != 0L` — a FLAG
// test, not an identity test: for a gnome hero every M2_GNOME species (gnome
// lord/king, gnomish wizard, gnome mummy/zombie) is your_race, not just PM_GNOME.
// MH_* are the M2_* bits (monflag.h:187-191), so selfmask masks mflags2 directly.
function splev_your_race(ptr) {
    const selfmask = races[game.initrace]?.selfmask;
    return selfmask != null && (mflags2_of(ptr) & selfmask) !== 0;
}

// C ref: sp_lev.c create_monster() (sp_lev.c:1925) reached from lspo_monster().
// Draw order, all before makemon:
//   * find_montype (sp_lev.c:3156) rn2(2) for the gender, during lspo_monster's
//     PARSE — so it precedes induced_align.  Skipped when the species has a
//     fixed gender or the NAME itself is a gendered form of a NAMS() triple
//     ("gnome lord" is the male name, so it never rolls).
//   * sp_amask_to_amask -> induced_align (dungeon.c:2012) rn2(3), for any
//     monster whose table carries no `align` key.
//   * mkclass(class, G_NOGEN) for a bare class char.
//   * the In_mines your_race rn2(3) (sp_lev.c:1957).
//   * the location (explicit: none; random: the get_location loop).
export function splev_create_monster({ name = null, cls = 0, mx = null, my = null,
                                peaceful = null, croom = null, asleep = null }) {
    let ptr = null;
    if (name != null) {
        const pmidx = name_to_pmidx(name);
        ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
        if (ptr && ptr.gcode !== 1 && ptr.gcode !== 2
            && name_gender_hint(name) === MGEND_NEUTRAL)
            rn2(2);                                   // find_montype sp_lev.c:3156
    }
    rn2(3);                                           // induced_align dungeon.c:2012
    if (name == null && cls) ptr = mkclass(cls, 0x0200 /* G_NOGEN */);
    if (splev_In_mines() && ptr && splev_your_race(ptr)
        && (splev_race_is('dwarf') || splev_race_is('gnome')) && rn2(3))
        ptr = null;
    let x, y;
    if (mx != null) { const c = vly_abs(mx, my); x = c.x; y = c.y; }
    else if (ptr) {
        const hum = pm_to_humidity(ptr);
        const r = splev_get_location_room(croom, hum, true);
        x = r.x; y = r.y;
        if (x === -1 && y === -1) {
            const r2 = splev_get_location_room(croom, hum | LOC_DRY);
            x = r2.x; y = r2.y;
        }
    } else {
        const r = splev_get_location_room(croom, LOC_DRY);
        x = r.x; y = r.y;
    }
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, ptr);
        if (cc) { x = cc.x; y = cc.y; }
    }
    // C ref: sp_lev.c create_monster:1981 — a (possibly enexto-relocated) spot
    // outside croom aborts the monster entirely, before makemon.
    if (croom && !inside_room(croom, x, y)) return null;
    const mtmp = makemon(ptr, x, y, 0 /* NO_MM_FLAGS */);
    if (mtmp && peaceful != null) mtmp.mpeaceful = peaceful ? 1 : 0;
    if (mtmp && asleep != null) mtmp.msleeping = asleep ? 1 : 0;
    return mtmp;
}

// C ref: sp_lev.c create_object() at an EXPLICIT coordinate — get_location_coord
// draws nothing, then the object is built exactly as the random-location form.
// `historic` is obj.h's CORPSTAT_HISTORIC (4) in a statue's spe bitfield.
export function splev_object_at({ otyp = null, oclass = null, montype = null,
                           historic = 0 }, mx, my) {
    const c = vly_abs(mx, my);
    let otmp;
    if (otyp != null) otmp = mksobj_at(otyp, c.x, c.y, true, true);
    else if (oclass != null) otmp = mkobj_at(oclass, c.x, c.y, true);
    else otmp = mkobj_at(0 /* RANDOM_CLASS */, c.x, c.y, true);
    if (otmp && historic) otmp.spe = 4;
    if (otmp && montype != null) {
        const pmidx = name_to_pmidx(montype);
        if (pmidx >= 0) set_corpsenm(otmp, pmidx);
    }
    return otmp;
}

// C ref: mklev.c traptype_rnd(mktrapflags) (mklev.c:1938) — the FULL function,
// parameterised on the caller's mktrapflags exactly as C is.  NO_TRAP means
// "too hard for this level"; mktrap() re-rolls until it gets something.
// Note the WEB arm: with MKTRAP_NOSPIDERONWEB (which sp_lev.c's create_trap
// always passes for a `des.trap()` with spider_on_web unset) a web is legal at
// ANY level difficulty — the depth gate only exists to keep the free giant
// spider off shallow levels.
export function splev_traptype_rnd(mktrapflags) {
    const lvl = level_difficulty_ext();
    const noteleport = !!game.level?.flags?.noteleport;
    let kind = rnd(TRAPNUM - 1);                      // mklev.c:1941
    switch (kind) {
    case TRAPPED_DOOR: case TRAPPED_CHEST:
    case MAGIC_PORTAL: case VIBRATING_SQUARE:
        kind = NO_TRAP; break;
    case ROLLING_BOULDER_TRAP: case SLP_GAS_TRAP:
        if (lvl < 2) kind = NO_TRAP; break;
    case LEVEL_TELEP:
        if (lvl < 5 || noteleport || single_level_branch()) kind = NO_TRAP;
        break;
    case SPIKED_PIT:
        if (lvl < 5) kind = NO_TRAP; break;
    case LANDMINE:
        if (lvl < 6) kind = NO_TRAP; break;
    case WEB:
        if (lvl < 7 && !(mktrapflags & 0x04 /* MKTRAP_NOSPIDERONWEB */))
            kind = NO_TRAP;
        break;
    case STATUE_TRAP: case POLY_TRAP:
        if (lvl < 8) kind = NO_TRAP; break;
    case FIRE_TRAP:
        if (!In_hell(game.u?.uz)) kind = NO_TRAP; break;
    case TELEP_TRAP:
        if (noteleport) kind = NO_TRAP; break;
    case HOLE:
        if (rn2(7)) kind = NO_TRAP; break;            // mklev.c:1993
    default: break;
    }
    return kind;
}

// C ref: dungeon.c single_level_branch(&u.uz) — a one-level branch dungeon
// (Sokoban's entry, the quest home...) where a level teleporter would strand
// the hero.  The Mines and the main dungeon are multi-level, so this is only
// ever true off the ported levels; kept faithful for the general helper.
function single_level_branch() {
    const uz = game.u?.uz;
    const dgn = uz ? game.dungeons?.[uz.dnum] : null;
    return !!(dgn && (dgn.num_dunlevs ?? 0) === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
// The rest of sp_lev.c, translated.
//
// Everything from here to the end of the file is INERT: no code above this
// line, and nothing outside this file, calls any of it.  It exists so the
// special-level coder (des.* / lspo_*) is present and faithful for whoever
// wires it up; that wiring is a separate, separately-gated change.
//
// Two rules shaped how the dependencies below are resolved:
//
//  * The import statements this block needs sit AFTER the levels/ re-export
//    block above, not with the imports at the top of the file.  ESM evaluates
//    modules in post-order DFS of the import graph, so an import placed after
//    every edge this file already has can only name a module that is already
//    fully evaluated -- it cannot move anything.  Adding the same import at the
//    top could.
//
//  * js/mklev.js is deliberately NOT imported, at either position.  mklev.js
//    imports THIS file and calls set_mktrap_victim() while its own body runs;
//    an sp_lev -> mklev edge makes mklev's body evaluate first, so that call
//    assigns to `_mktrap_victim` (an `export let`) inside its TDZ and the whole
//    program fails to load.  add_room()/add_door()/mkstairs()/... therefore
//    arrive through `EXT` below, as do the callees js/ has not ported at all.
// ═══════════════════════════════════════════════════════════════════════════

// C ref: the sp_lev.c callees that this file cannot reach (see the header
// above).  Keeping them behind one table means the translations below preserve
// C's control flow and RNG-call order exactly, instead of being reshaped
// around what happens to be importable today.  Whoever wires the coder up
// supplies the real functions with bind_sp_lev_externs().
const ext_nyi = (name) => () => {
    throw new Error(`sp_lev.c port: ${name}() is not wired up yet`);
};
const EXT_NAMES = [
    // js/mklev.js (cannot be imported here -- see the header comment)
    'topologize', 'makecorridors', 'mkstairs', 'level_finalize_topology',
    'makeroguerooms', 'induced_align', 'stairway_add', 'wallification',
    'mineralize', 'create_room', 'create_subroom', 'dig_corridor',
    'maybe_add_door', 'mktrap', 'pick_vibrasquare_location',
    // not ported anywhere in js/ yet
    'mkmap', 'mk_roamer', 'mk_mplayer', 'mdrop_special_objs',
    'remove_monster', 'place_monster', 'mongone', 'poly_when_stoned',
    'rndmonnum', 'name_to_mon', 'def_char_to_monclass',
    'select_newcham_form', 'is_vampshifter', 'validvamp',
    'mgender_from_permonst', 'set_mon_data', 'pm_invisible', 'vampshifted',
    'monst_to_any', 'oname', 'bury_an_obj', 'delete_contents', 'begin_burn',
    'artifact_exists', 'safe_oname', 'can_saddle', 'put_saddle_on_mon',
    'selection_floodfill', 'set_selection_floodfillchk',
    'back_to_glyph', 'glyph_is_cmap', 'count_level_features', 'fixup_special',
    'makemap_prepost', 'oinit', 'clear_level_structures', 'load_lua',
    'Is_mineend_level', 'Is_sokoend_level', 'In_W_tower',
    'defsyms_explanation',
];
const EXT = {};
for (const nm of EXT_NAMES) EXT[nm] = ext_nyi(nm);
export function bind_sp_lev_externs(impls) { Object.assign(EXT, impls); }

// C ref: sp_lev.c:166-173 SPLEV_LEFT..SPLEV_RIGHT and TOP/BOTTOM.  The
// SPLEV_* consts already in this file are lspo_map's own 0-based recoding, so
// the real 1-based macro values need distinct names here.
const C_SPLEV_LEFT = 1, C_SPLEV_H_LEFT = 2, C_SPLEV_CENTER = 3,
      C_SPLEV_H_RIGHT = 4, C_SPLEV_RIGHT = 5, C_TOP = 1, C_BOTTOM = 5;

// C ref: onames.h STRANGE_OBJECT / objclass.h Bitfield(oc_merge), which
// js/mkobj.js packs as bit 5 of the row's `flags` word.
const STRANGE_OBJECT_OTYP = 0;
const F_MERGE = 32;
const oc_merge = (otyp) => !!(OBJDATA[otyp]?.flags & F_MERGE);

// C ref: sp_lev.h:82-85 SP_COORD_X/SP_COORD_Y/SP_COORD_PACK.
const SP_COORD_X = (l) => (l & 0xff);
const SP_COORD_Y = (l) => ((l >> 16) & 0xff);
const SP_COORD_PACK = (x, y) => ((x & 0xff) + ((y & 0xff) << 16));
const SP_COORD_PACK_RANDOM = (f) => (SP_COORD_IS_RANDOM | f);

// C ref: sp_lev.c:203 TYP_CANNOT_MATCH.
const TYP_CANNOT_MATCH = (typ) => (typ === MAX_TYPE || typ === INVALID_TYPE);

// C ref: hacklib.c swapbits(oldval, bita, bitb) -- exchange two bits.
function swapbits(oldval, bita, bitb) {
    let ret = oldval & ~((1 << bita) | (1 << bitb));
    if (oldval & (1 << bita)) ret |= (1 << bitb);
    if (oldval & (1 << bitb)) ret |= (1 << bita);
    return ret;
}

// C ref: monflag.h:205 G_IGNORE -- mkclass() flag: ignore G_GENOD|G_EXTINCT.
const G_IGNORE = 0x8000;

// C ref: rm.h:122 IS_DOORJOIN(typ).
const IS_DOORJOIN = (typ) => (IS_OBSTRUCTED(typ) || typ === IRONBARS);

// C ref: sp_lev.c:192-198 -- the file-static coder state that
// sp_level_coder_init() re-initialises before every level.  `coder` is
// gc.coder (sp_lev.h struct sp_coder).
const spl = {
    coder: null,
    splev_init_present: false,
    icedpools: false,
    container_idx: 0,
    container_obj: [],
    invent_carrying_monster: null,
    is_ok_location_func: null,           // sp_lev.c:1271
    floodfillchk_match_under_typ: 0,     // sp_lev.c:4584
};
export function sp_lev_state() { return spl; }

const levl_at = (x, y) => game.level?.at(x, y);
const levl_typ = (x, y) => (levl_at(x, y)?.typ ?? STONE);
const svr_rooms = () => (game.level?.rooms || []);
const svn_nroom = () => (game.level?.nroom || 0);

// C ref: sp_lev.c is_ok_location():1279.  The is_ok_location() already in this
// file starts at C's `humidity & ANY_LOC`; the two clauses AHEAD of it (the
// Is_waterlevel shortcut and the set_ok_location_func hook) live here, in the
// wrapper the get_location() family uses, so that good_stair_loc() actually
// takes effect without touching the existing function.
function sp_is_ok_location(x, y, humidity) {
    if (Is_waterlevel(game.u?.uz)) return true;
    if (spl.is_ok_location_func) return !!spl.is_ok_location_func(x, y);
    return is_ok_location(x, y, humidity);
}

// ── nhlua.c table accessors ────────────────────────────────────────────────
// C ref: nhlua.c:1017-1146.  A Lua table is a plain JS object here (the
// convention lspo_map/lspo_region already use), so "get field `name` of the
// table at stack index 1" is a property read.  Module-local: they are nhlua.c's
// functions, not sp_lev.c's.
function nhl_error(msg) { throw new Error(String(msg)); }

function lcheck_param_table(t) {
    // C creates an empty table when called with no args and rejects non-tables.
    if (t == null) return {};
    if (typeof t !== 'object') nhl_error('expected a table');
    return t;
}

function get_table_int(t, name) {
    const v = t?.[name];
    if (v == null) nhl_error(`bad argument '${name}' (number expected)`);
    return Math.trunc(Number(v));
}

function get_table_int_opt(t, name, defval) {
    const v = t?.[name];
    return (v == null) ? defval : Math.trunc(Number(v));
}

function get_table_str(t, name) {
    const v = t?.[name];
    if (v == null) nhl_error(`bad argument '${name}' (string expected)`);
    return String(v);
}

function get_table_str_opt(t, name, defval) {
    const v = t?.[name];
    if (v == null) return defval;
    /* C runs a function-valued field through nhl_pcall_handle() and takes its
       string result. */
    if (typeof v === 'function') { const r = v(); return (r == null) ? defval : String(r); }
    return String(v);
}

// C ref: nhlua.c get_table_boolean():1079 -- "true"/"false"/"yes"/"no" map to
// the luaL_checkoption INDEX, i.e. 0/1/2/3, not to TRUE/FALSE.  The commented
// out boolstr2i[] in C is the tell: `ret` really is the option index, so
// "yes" reads as 2.  Faithfully reproduced.
const BOOLSTR = ['true', 'false', 'yes', 'no'];
function get_table_boolean(t, name) {
    const v = t?.[name];
    let ret = -1;
    if (typeof v === 'string') {
        ret = BOOLSTR.indexOf(v);
        if (ret < 0) nhl_error(`invalid option '${v}'`);
    } else if (typeof v === 'boolean') {
        ret = v ? 1 : 0;
    } else if (typeof v === 'number') {
        ret = Math.trunc(v);
        if (ret < 0 || ret > 1) ret = -1;
    }
    if (ret === -1) nhl_error('Expected a boolean');
    return ret;
}

function get_table_boolean_opt(t, name, defval) {
    if (t?.[name] == null) return defval;
    return get_table_boolean(t, name);
}

// C ref: nhlua.c get_table_option():1122 -> luaL_checkoption: returns the
// INDEX into opts[], and errors when the value is not in the list.
function get_table_option(t, name, defval, opts) {
    const v = t?.[name] == null ? defval : String(t[name]);
    if (v == null) nhl_error(`bad argument '${name}' (string expected)`);
    const i = opts.indexOf(v);
    if (i < 0) nhl_error(`invalid option '${v}'`);
    return i;
}

// C ref: nhlua.c check_mapchr():393 / get_table_mapchr():241.
function check_mapchr(s) {
    if (s && String(s).length === 1) return splev_chr2typ(String(s));
    return INVALID_TYPE;
}

function get_table_mapchr(t, name) {
    const typ = check_mapchr(get_table_str(t, name));
    if (typ === INVALID_TYPE) nhl_error('Erroneous map char');
    return typ;
}

function get_table_mapchr_opt(t, name, defval) {
    const ter = get_table_str_opt(t, name, '');
    if (ter && ter.length) {
        const typ = check_mapchr(ter);
        if (typ === INVALID_TYPE) nhl_error('Erroneous map char');
        return typ;
    }
    return defval;
}

// ── sp_lev.c ──────────────────────────────────────────────────────────────

// C ref: sp_lev.c:255 mapfrag_free(struct mapfragment **mf) -- frees the
// fragment and NULLs the caller's pointer.  JS is garbage-collected, so only
// the second half is observable: pass the holder whose field should be
// cleared, e.g. mapfrag_free(box) with box = { mf }.
export function mapfrag_free(box) {
    if (box && box.mf) box.mf = null;
}

// C ref: sp_lev.c:274 -- a fragment can only be centred on a cell if both of
// its dimensions are odd.
export function mapfrag_canmatch(mf) {
    return !!((mf.wid % 2) && (mf.hei % 2));
}

// C ref: sp_lev.c:280 -- NULL when the fragment is usable, else the message
// des.replace_terrain()/selection.match() reports.  C frees the fragment on
// each error path; see mapfrag_free() above for why that is a no-op here.
export function mapfrag_error(mf) {
    let res = null;
    if (!mf) {
        res = 'mapfragment error';
    } else if (!mapfrag_canmatch(mf)) {
        res = 'mapfragment needs to have odd height and width';
    } else if (TYP_CANNOT_MATCH(mapfrag_get(mf, Math.trunc(mf.wid / 2),
                                            Math.trunc(mf.hei / 2)))) {
        res = 'mapfragment center must be valid terrain';
    }
    return res;
}

// C ref: sp_lev.c:314 -- des.level_flags("solidify"): every stone wall the
// level file did not itself place becomes undiggable and unpasswall-able.
export function solidify_map() {
    for (let x = 0; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const loc = levl_at(x, y);
            if (loc && IS_STWALL(loc.typ) && !splev_map_at(x, y))
                loc.wall_info = (loc.wall_info || 0) | W_NONDIGGABLE | W_NONPASSWALL;
        }
}

// C ref: sp_lev.c:327 -- post-creation cleanup: boulders, destroyable traps
// and engravings cannot survive on lava or water.
export function map_cleanup() {
    for (let x = 0; x < COLNO; x++)
        for (let y = 0; y < ROWNO; y++) {
            const typ = levl_typ(x, y);
            if (IS_LAVA(typ) || IS_POOL(typ)) {
                let otmp;
                while ((otmp = sobj_at(BOULDER, x, y)) != null) {
                    obj_extract_self(otmp);
                    obfree(otmp, null);
                }
                const ttmp = t_at(x, y);
                if (ttmp && !undestroyable_trap(ttmp.ttyp)) deltrap(ttmp);
                const etmp = engr_at(x, y);
                if (etmp) del_engr(etmp);
            }
        }
}

// C ref: sp_lev.c:358 -- des.level_init({ style = "mazegrid" }).  No RNG.
export function lvlfill_maze_grid(x1, y1, x2, y2, filling) {
    for (let x = x1; x <= x2; x++)
        for (let y = y1; y <= y2; y++) {
            const loc = levl_at(x, y);
            if (!loc) continue;
            if (game.level?.flags?.corrmaze) loc.typ = STONE;
            else loc.typ = (y < 2 || ((x % 2) && (y % 2))) ? STONE : filling;
        }
}

// C ref: sp_lev.c:373 -- des.level_init({ style = "solidfill" }).  The four
// field resets only happen for squares set_levltyp_lit() accepted.
export function lvlfill_solid(filling, lit) {
    for (let x = 2; x <= gx.x_maze_max; x++)
        for (let y = 0; y <= gy.y_maze_max; y++) {
            if (!set_levltyp_lit(x, y, filling, lit)) continue;
            const loc = levl_at(x, y);
            if (!loc) continue;
            loc.flags = 0;
            loc.horizontal = 0;
            loc.roomno = 0;
            loc.edge = 0;
        }
}

// C ref: sp_lev.c:390 -- des.level_init({ style = "swamp" }).  "Relaxed
// blockwise maze" (Jamis Buck): one rn2(3) per 2x2 block whose other three
// squares are all still background.
export function lvlfill_swamp(fg, bg, lit) {
    lvlfill_solid(bg, lit);

    for (let x = 2; x <= Math.min(gx.x_maze_max, COLNO - 2); x += 2)
        for (let y = 0; y <= Math.min(gy.y_maze_max, ROWNO - 2); y += 2) {
            let c = 0;

            set_levltyp_lit(x, y, fg, lit);
            if (levl_typ(x + 1, y) === bg) ++c;
            if (levl_typ(x, y + 1) === bg) ++c;
            if (levl_typ(x + 1, y + 1) === bg) ++c;
            if (c === 3) {
                switch (rn2(3)) {                          // sp_lev.c:410
                case 0: set_levltyp_lit(x + 1, y, fg, lit); break;
                case 1: set_levltyp_lit(x, y + 1, fg, lit); break;
                case 2: set_levltyp_lit(x + 1, y + 1, fg, lit); break;
                default: break;
                }
            }
        }
}

// C ref: sp_lev.c:427 / :441 -- a flipped drawbridge points the other way.
export function flip_dbridge_horizontal(lev) {
    if (IS_DRAWBRIDGE(lev.typ)) {
        const mask = lev.drawbridgemask || 0;
        if ((mask & DB_DIR) === DB_WEST)
            lev.drawbridgemask = (mask & ~DB_WEST) | DB_EAST;
        else if ((mask & DB_DIR) === DB_EAST)
            lev.drawbridgemask = (mask & ~DB_EAST) | DB_WEST;
    }
}

export function flip_dbridge_vertical(lev) {
    if (IS_DRAWBRIDGE(lev.typ)) {
        const mask = lev.drawbridgemask || 0;
        if ((mask & DB_DIR) === DB_NORTH)
            lev.drawbridgemask = (mask & ~DB_NORTH) | DB_SOUTH;
        else if ((mask & DB_DIR) === DB_SOUTH)
            lev.drawbridgemask = (mask & ~DB_SOUTH) | DB_NORTH;
    }
}

// C ref: sp_lev.c:457 -- #wizfliplevel only: re-aim each remembered square's
// seen vector and re-derive the glyph of every remembered wall.  Not needed
// when flipping during level creation (flip_level(flp, FALSE)).
export function flip_visuals(flp, minx, miny, maxx, maxy) {
    for (let y = miny; y <= maxy; ++y) {
        for (let x = minx; x <= maxx; ++x) {
            const lev = levl_at(x, y);
            if (!lev) continue;
            let seenv = (lev.seenv || 0) & 0xff;
            if (seenv === 0) continue;
            if (seenv !== SVALL) {
                //  SV2 SV1 SV0 / SV3 -+- SV7 / SV4 SV5 SV6
                if (flp & 1) {                 // swap top and bottom
                    seenv = swapbits(seenv, 2, 4);
                    seenv = swapbits(seenv, 1, 5);
                    seenv = swapbits(seenv, 0, 6);
                }
                if (flp & 2) {                 // swap left and right
                    seenv = swapbits(seenv, 2, 0);
                    seenv = swapbits(seenv, 3, 7);
                    seenv = swapbits(seenv, 4, 6);
                }
                lev.seenv = seenv & 0xff;
            }
            if ((IS_WALL(lev.typ) || lev.typ === SDOOR)
                && EXT.glyph_is_cmap(lev.glyph))
                lev.glyph = EXT.back_to_glyph(x, y);
        }
    }
}

// C ref: sp_lev.c:498 -- transpose an encoded direction.  The bit numbers
// depend on xdir[]/ydir[] order.
export function flip_encoded_dir_bits(flp, val) {
    if (flp & 1) {
        val = swapbits(val, 1, 7);
        val = swapbits(val, 2, 6);
        val = swapbits(val, 3, 5);
    }
    if (flp & 2) {
        val = swapbits(val, 1, 3);
        val = swapbits(val, 0, 4);
        val = swapbits(val, 7, 5);
    }
    return val;
}

// C ref: sp_lev.c:925 -- #wizfliplevel only: flip the vault guard's egd data
// (its post, its remembered old position, and every fake corridor it dug).
export function flip_vault_guard(flp, grd, minx, miny, maxx, maxy) {
    const egd = grd?.egd;
    if (!egd) return;
    const FlipX = (v) => ((maxx - v) + minx);
    const FlipY = (v) => ((maxy - v) + miny);
    const inFlipArea = (x, y) => (x >= minx && x <= maxx && y >= miny && y <= maxy);

    if (inFlipArea(egd.gdx, egd.gdy)) {
        if (flp & 1) egd.gdy = FlipY(egd.gdy);
        if (flp & 2) egd.gdx = FlipX(egd.gdx);
    }
    if (inFlipArea(egd.ogx, egd.ogy)) {
        if (flp & 1) egd.ogy = FlipY(egd.ogy);
        if (flp & 2) egd.ogx = FlipX(egd.ogx);
    }
    for (let i = egd.fcbeg; i < egd.fcend; ++i) {
        const fc = egd.fakecorr?.[i];
        if (!fc) continue;
        const fx = fc.fx, fy = fc.fy;
        if (inFlipArea(fx, fy)) {
            if (flp & 1) fc.fy = FlipY(fy);
            if (flp & 2) fc.fx = FlipX(fx);
        }
    }
}

// C ref: sp_lev.c:966 -- one rn2(2) per allowed axis, and only for the axes
// the caller allowed: `(flp & 1) && rn2(2)` short-circuits, so a level with
// des.level_flags("noflipy") draws once, not twice.
// The flip_level() in this file takes only `flp` (level-creation form, which
// is what every caller of flip_level_rnd passes: extras is always FALSE here).
export function flip_level_rnd(flp, extras) {
    let c = 0;

    if ((flp & 1) && rn2(2)) c |= 1;                       // sp_lev.c:975
    if ((flp & 2) && rn2(2)) c |= 2;                       // sp_lev.c:977

    if (c) flip_level(c, extras);
}

// C ref: sp_lev.c:985 -- selection_iterate() callback for des.non_diggable()
// and friends.  Iron bars became eligible in 3.6.2.
export function sel_set_wall_property(x, y, prop) {
    const loc = levl_at(x, y);
    if (!loc) return;
    if (IS_STWALL(loc.typ) || IS_TREE(loc.typ) || loc.typ === IRONBARS)
        loc.wall_info = (loc.wall_info || 0) | prop;
}

// C ref: sp_lev.c:1000 -- clamp the rectangle to the map, then flag it.
export function set_wall_property(x1, y1, x2, y2, prop) {
    x1 = Math.max(x1, 1);
    x2 = Math.min(x2, COLNO - 1);
    y1 = Math.max(y1, 0);
    y2 = Math.min(y2, ROWNO - 1);
    for (let y = y1; y <= y2; y++)
        for (let x = x1; x <= x2; x++)
            sel_set_wall_property(x, y, prop);
}

// C ref: sp_lev.c:1088 -- is x,y immediately next to room droom?  The first
// test is a rejection: a square that is squarely inside droom and not on its
// edge is not "shared with" it.
export function shared_with_room(x, y, droom) {
    const rmno = droom.roomnoidx + ROOMOFFSET;

    if (!isok(x, y)) return false;
    if (levl_at(x, y)?.roomno === rmno && !levl_at(x, y)?.edge) return false;
    if (isok(x - 1, y) && levl_at(x - 1, y)?.roomno === rmno && x - 1 <= droom.hx)
        return true;
    if (isok(x + 1, y) && levl_at(x + 1, y)?.roomno === rmno && x + 1 >= droom.lx)
        return true;
    if (isok(x, y - 1) && levl_at(x, y - 1)?.roomno === rmno && y - 1 <= droom.hy)
        return true;
    if (isok(x, y + 1) && levl_at(x, y + 1)?.roomno === rmno && y + 1 >= droom.ly)
        return true;
    return false;
}

// C ref: sp_lev.c:1121 -- every DOOR/SDOOR on the map is re-oriented and then
// offered to every room and subroom in index order.  No RNG.
export function link_doors_rooms() {
    for (let y = 0; y < ROWNO; y++)
        for (let x = 0; x < COLNO; x++) {
            const typ = levl_typ(x, y);
            if (IS_DOOR(typ) || typ === SDOOR) {
                set_door_orientation(x, y);

                for (let tmpi = 0; tmpi < svn_nroom(); tmpi++) {
                    const rm = svr_rooms()[tmpi];
                    if (!rm) continue;
                    EXT.maybe_add_door(x, y, rm);
                    for (let m = 0; m < (rm.nsubrooms || 0); m++)
                        EXT.maybe_add_door(x, y, rm.sbrooms[m]);
                }
            }
        }
}

// C ref: sp_lev.c:1147 -- ROLL_FROM(state) over five states, i.e. one rn2(5).
export function rnddoor() {
    const state = [D_NODOOR, 0x01 /* D_BROKEN */, D_ISOPEN, D_CLOSED, D_LOCKED];
    return state[rn2(state.length)];
}

// C ref: sp_lev.c:1158 -- rnd(TRAPNUM-1) until the roll is legal here.  Note
// this is NOT mklev.c's traptype_rnd(): no difficulty gating, but holes,
// vibrating squares and magic portals are never random on a special level.
export function rndtrap() {
    let rtrap;

    do {
        rtrap = rnd(TRAPNUM - 1);                          // sp_lev.c:1164
        switch (rtrap) {
        case HOLE:                  /* no random holes on special levels */
        case VIBRATING_SQUARE:
        case MAGIC_PORTAL:
            rtrap = NO_TRAP;
            break;
        case TRAPDOOR:
            if (!Can_dig_down(game.u?.uz)) rtrap = NO_TRAP;
            break;
        case LEVEL_TELEP:
        case TELEP_TRAP:
            if (game.level?.flags?.noteleport) rtrap = NO_TRAP;
            break;
        case ROLLING_BOULDER_TRAP:
        case ROCKTRAP:
            if (In_endgame(game.u?.uz)) rtrap = NO_TRAP;
            break;
        default:
            break;
        }
    } while (rtrap === NO_TRAP);
    return rtrap;
}

// C ref: sp_lev.c:1201 get_location(coordxy *x, coordxy *y, humidity, croom).
// `c` is the in/out coordinate pair C passes by pointer: c.x < 0 asks for a
// random square, otherwise c is map- or room-relative and comes back absolute.
export function get_location(c, humidity, croom) {
    let cpt = 0;
    let mx, my, sx, sy;

    if (croom) {
        mx = croom.lx;
        my = croom.ly;
        sx = croom.hx - mx + 1;
        sy = croom.hy - my + 1;
    } else {
        mx = gx.xstart;
        my = gy.ystart;
        sx = gx.xsize;
        sy = gy.ysize;
    }

    let found_it = false;
    if (c.x >= 0) {                          /* normal locations */
        c.x += mx;
        c.y += my;
    } else {                                 /* random location */
        do {
            if (croom) {                     /* handle irregular areas */
                const tmpc = { x: -1, y: -1 };
                somexy(croom, tmpc);
                c.x = tmpc.x;
                c.y = tmpc.y;
            } else {
                c.x = mx + rn2(sx);                        // sp_lev.c:1233
                c.y = my + rn2(sy);                        // sp_lev.c:1234
            }
            if (sp_is_ok_location(c.x, c.y, humidity)) { found_it = true; break; }
        } while (++cpt < 100);
        if (!found_it && cpt >= 100) {
            /* last try -- a deterministic scan of the whole footprint */
            for (let xx = 0; xx < sx && !found_it; xx++)
                for (let yy = 0; yy < sy; yy++) {
                    c.x = mx + xx;
                    c.y = my + yy;
                    if (sp_is_ok_location(c.x, c.y, humidity)) { found_it = true; break; }
                }
            if (!found_it) {
                if (!(humidity & NO_LOC_WARN)) {
                    /* C: impossible("get_location: can't find a place!") --
                       x,y keep the last scanned square */
                } else {
                    c.x = c.y = -1;
                }
            }
        }
    }

    if (!(humidity & ANY_LOC) && !isok(c.x, c.y)) {
        if (!(humidity & NO_LOC_WARN)) {
            c.x = gx.x_maze_max;
            c.y = gy.y_maze_max;
        } else {
            c.x = c.y = -1;
        }
    }
}

// C ref: sp_lev.c:1273 -- install the extra location filter l_create_stairway()
// uses (good_stair_loc), and clear it again straight after.
export function set_ok_location_func(func) {
    spl.is_ok_location_func = func || null;
}

// C ref: sp_lev.c:1316 -- unpack a packed_coord.  SP_COORD_IS_RANDOM carries
// the humidity flags in its low bits; zero there means "use the caller's".
export function get_unpacked_coord(loc, defhumidity) {
    const c = { x: 0, y: 0, is_random: 0, getloc_flags: 0 };
    if (loc & SP_COORD_IS_RANDOM) {
        c.x = c.y = -1;
        c.is_random = 1;
        c.getloc_flags = (loc & ~SP_COORD_IS_RANDOM);
        if (!c.getloc_flags) c.getloc_flags = defhumidity;
    } else {
        c.is_random = 0;
        c.getloc_flags = defhumidity;
        c.x = SP_COORD_X(loc);
        c.y = SP_COORD_Y(loc);
    }
    return c;
}

// C ref: sp_lev.c:1336 -- a RANDOM coord reaches get_location() TWICE: first
// with NO_LOC_WARN forced on, then (only if that came back -1,-1) again with
// the caller's own flags.  Each call is its own 100-draw loop, so collapsing
// them loses 100 draws.
export function get_location_coord(c, humidity, croom, crd) {
    const u = get_unpacked_coord(crd, humidity);
    c.x = u.x;
    c.y = u.y;
    get_location(c, u.getloc_flags | (u.is_random ? NO_LOC_WARN : 0), croom);

    if (c.x === -1 && c.y === -1 && u.is_random)
        get_location(c, humidity, croom);
}

// C ref: sp_lev.c:1359 -- a relative position inside a room; negative means
// random.  Note the asymmetry: BOTH negative goes through somexy() (which
// handles irregular rooms), one negative draws a plain rn2 over that axis.
export function get_room_loc(c, croom) {
    if (c.x < 0 && c.y < 0) {
        const tmpc = { x: -1, y: -1 };
        if (somexy(croom, tmpc)) {
            c.x = tmpc.x;
            c.y = tmpc.y;
        }
        /* else C panics */
    } else {
        if (c.x < 0) c.x = rn2(croom.hx - croom.lx + 1);
        if (c.y < 0) c.y = rn2(croom.hy - croom.ly + 1);
        c.x += croom.lx;
        c.y += croom.ly;
    }
}

// C ref: sp_lev.c:1384 -- like get_room_loc(), but keeps re-rolling until the
// square is plain ROOM.  The retry loop restarts from the CALLER's *x,*y (so
// normally -1,-1 -> a fresh somexy each time), not from the last try.
export function get_free_room_loc(c, croom, pos) {
    const t = { x: -1, y: -1 };
    let trycnt = 0;

    get_location_coord(t, DRY, croom, pos);
    if (levl_typ(t.x, t.y) !== ROOM) {
        do {
            t.x = c.x; t.y = c.y;
            get_room_loc(t, croom);
        } while (levl_typ(t.x, t.y) !== ROOM && ++trycnt <= 100);
        /* trycnt > 100: C panics */
    }
    c.x = t.x; c.y = t.y;
}

// C ref: sp_lev.c:1811 create_trap(spltrap *t, struct mkroom *croom).
// t: { type, coord, spider_on_web, seen, novictim }.
export function create_trap(t, croom) {
    const c = { x: -1, y: -1 };
    let mktrap_flags = MKTRAP_MAZEFLAG;

    if (t.type === VIBRATING_SQUARE) {
        EXT.pick_vibrasquare_location();
        maketrap(game.inv_pos?.x, game.inv_pos?.y, VIBRATING_SQUARE);
        return;
    } else if (croom) {
        get_free_room_loc(c, croom, t.coord);
    } else {
        let trycnt = 0;

        do {
            get_location_coord(c, DRY, croom, t.coord);
        } while ((levl_typ(c.x, c.y) === STAIRS || levl_typ(c.x, c.y) === LADDER)
                 && ++trycnt <= 100);
        if (trycnt > 100) return;
    }

    if (!t.spider_on_web) mktrap_flags |= MKTRAP_NOSPIDERONWEB;
    if (t.seen) mktrap_flags |= MKTRAP_SEEN;
    if (t.novictim) mktrap_flags |= MKTRAP_NOVICTIM;

    EXT.mktrap(t.type, mktrap_flags, null, { x: c.x, y: c.y });
}

// C ref: sp_lev.c:1851 -- one rn2(2).  For a neutral hero (alignment 0) it
// returns law or chaos; otherwise the opposite alignment or neutral.
export function noncoalignment(alignment) {
    const k = rn2(2);
    if (!alignment) return (k ? -1 : 1);
    return (k ? -alignment : 0);
}

// C ref: sp_lev.c:1863 -- screen out squares a mimic-as-boulder should avoid.
export function m_bad_boulder_spot(x, y) {
    if (t_at(x, y)) return true;
    if (sobj_at(BOULDER, x, y)) return true;
    const lev = levl_at(x, y);
    if (lev && IS_DOOR(lev.typ) && ((lev.doormask || 0) & (D_CLOSED | D_LOCKED)) !== 0)
        return true;
    return false;
}

// C ref: sp_lev.c:1907 -- a special-level alignment mask becomes a real one.
// AM_SPLEV_NONCO costs one rn2(2) (noncoalignment) and AM_SPLEV_RANDOM one
// rn2(3) (induced_align's 80% co-aligned roll); a literal alignment costs none.
export function sp_amask_to_amask(sp_amask) {
    let amask;

    if (sp_amask === AM_SPLEV_CO)
        amask = Align2amask(game.u?.ualignbase?.[A_ORIGINAL] ?? 0);
    else if (sp_amask === AM_SPLEV_NONCO)
        amask = Align2amask(noncoalignment(game.u?.ualignbase?.[A_ORIGINAL] ?? 0));
    else if (sp_amask === AM_SPLEV_RANDOM)
        amask = EXT.induced_align(80);
    else
        amask = sp_amask & AM_MASK;

    return amask;
}

// C ref: sym.h:24 MAXMCLASSES / objclass.h:141 MAXOCLASSES / rm.h MAXPCHARS --
// the "no such class/feature" sentinels def_char_to_monclass(),
// def_char_to_objclass() and the defsyms[] scan compare against.
const MAXMCLASSES = 61, MAXOCLASSES = 18, MAXPCHARS = 105;

// C ref: sp_lev.c:1924 create_monster(monster *m, struct mkroom *croom).
// Draw order (all before makemon):
//   1. sp_amask_to_amask() -- rn2(2) for "noncoaligned", rn2(3) for "random".
//   2. mkclass(class, G_NOGEN) when only a class letter was given.
//   3. the In_mines your_race rn2(3) at :1959.
//   4. the location: get_location_coord() twice for a wet/hot species (the
//      first pass carries NO_LOC_WARN), once otherwise.
//   5. enexto() when the square is taken.
// find_montype()'s own rn2(2) for the gender happens earlier, in lspo_monster.
export function create_monster(m, croom) {
    let mtmp;
    let cls;

    if (m.class >= 0) cls = EXT.def_char_to_monclass(m.class);
    else cls = 0;

    if (cls === MAXMCLASSES) return; /* C panics: unknown monster class */

    const amask = sp_amask_to_amask(m.sp_amask);

    let pm;
    if (!cls) {
        pm = null;
    } else if (m.id !== NON_PM) {
        pm = monster_by_pmidx(m.id);
        const g_mvflags = (game.mvitals?.[pm?.pmidx ?? m.id]?.mvflags) || 0;
        if (((pm?.geno || 0) & 0x1000 /* G_UNIQ */) && (g_mvflags & G_EXTINCT))
            return;
        if (g_mvflags & G_GONE)      /* genocided or extinct */
            pm = null;               /* make random monster */
    } else {
        pm = mkclass(cls, G_NOGEN_FLAG);
        /* pm == 0 means the class was genocided: settle for a random monster */
    }
    if (splev_In_mines() && pm && splev_your_race(pm)
        && (splev_race_is('dwarf') || splev_race_is('gnome')) && rn2(3))
        pm = null;                                         // sp_lev.c:1960

    const c = { x: -1, y: -1 };
    if (pm) {
        let loc = pm_to_humidity(pm);

        /* If water-liking monster, first try is without DRY */
        get_location_coord(c, loc | NO_LOC_WARN, croom, m.coord);
        if (c.x === -1 && c.y === -1) {
            loc |= DRY;
            get_location_coord(c, loc, croom, m.coord);
        }
    } else {
        get_location_coord(c, DRY, croom, m.coord);
    }
    let x = c.x, y = c.y;

    /* try to find a close place if someone else is already there.
       C: `MON_AT(x,y) && enexto(&cc, x, y, pm)`; this port's enexto_spawn()
       is that call, returning the coord or null. */
    if (mm_mon_at(x, y)) {
        const cc = enexto_spawn(x, y, pm);
        if (cc) { x = cc.x; y = cc.y; }
    }

    if (croom && !inside_room(croom, x, y)) return;

    if (m.sp_amask !== AM_SPLEV_RANDOM)
        mtmp = EXT.mk_roamer(pm, Amask2align(amask), x, y, m.peaceful);
    else if (name_to_pmidx('archeologist') <= m.id && m.id <= name_to_pmidx('wizard'))
        mtmp = EXT.mk_mplayer(pm, x, y, false);
    else
        mtmp = makemon(pm, x, y, m.mm_flags);

    if (mtmp) {
        x = mtmp.mx; y = mtmp.my;      /* sanity precaution */
        m.x = x; m.y = y;
        if (m.name?.str) mtmp = christen_monst(mtmp, m.name.str);

        /*
         * This doesn't complain if an attempt is made to give a
         * non-mimic/non-shapechanger an appearance or to give a
         * shapechanger a non-monster shape, it just refuses to comply.
         */
        if (m.appear_as?.str
            && ((mtmp.data?.mcls === S_MIMIC_CLASS)
                || (mtmp.cham != null && mtmp.cham >= LOW_PM
                    && m.appear === M_AP_MONSTER))
            && !Protection_from_shape_changers()) {
            let i;

            switch (m.appear) {
            case M_AP_NOTHING:
                /* C: impossible("mon has an appearance but no type") */
                break;

            case M_AP_FURNITURE:
                for (i = 0; i < MAXPCHARS; i++)
                    if (EXT.defsyms_explanation(i) === m.appear_as.str) break;
                if (i === MAXPCHARS) {
                    /* C: impossible("can't find feature") */
                } else {
                    mtmp.m_ap_type = M_AP_FURNITURE;
                    mtmp.mappearance = i;
                }
                break;

            case M_AP_OBJECT:
                for (i = 0; i < OBJDATA.length; i++)
                    if (OBJDATA[i]?.name && OBJDATA[i].name === m.appear_as.str)
                        break;
                if (i === OBJDATA.length) {
                    /* C: impossible("can't find object") */
                } else {
                    mtmp.m_ap_type = M_AP_OBJECT;
                    mtmp.mappearance = i;
                    /* try to avoid placing mimic boulder on a trap */
                    if (i === BOULDER && m.x < 0 && m_bad_boulder_spot(x, y)) {
                        let retrylimit = 10;

                        EXT.remove_monster(x, y);
                        do {
                            const rc = { x: m.x, y: m.y };
                            get_location(rc, DRY, croom);
                            x = rc.x; y = rc.y;
                            if (mm_mon_at(x, y)) {
                                const cc = enexto_spawn(x, y, pm);
                                if (cc) { x = cc.x; y = cc.y; }
                            }
                        } while (m_bad_boulder_spot(x, y) && --retrylimit > 0);
                        EXT.place_monster(mtmp, x, y);
                        /* if we didn't find a good spot then mimic something else */
                        if (!retrylimit) set_mimic_sym(mtmp);
                    }
                }
                break;

            case M_AP_MONSTER: {
                let mndx;
                const gender = { v: NEUTRAL };

                if (String(m.appear_as.str).toLowerCase() === 'random')
                    mndx = EXT.select_newcham_form(mtmp);
                else
                    mndx = EXT.name_to_mon(m.appear_as.str, gender);

                if (mndx === NON_PM
                    || (EXT.is_vampshifter(mtmp)
                        && !EXT.validvamp(mtmp, { v: mndx }, S_HUMANOID))) {
                    /* C: impossible("invalid <mimic appearance|chameleon shape|...>") */
                } else if (monster_by_pmidx(mndx) === mtmp.data) {
                    /* explicitly forcing a mimic to appear as itself */
                    mtmp.m_ap_type = M_AP_NOTHING;
                    mtmp.mappearance = 0;
                } else if (mtmp.data?.mcls === S_MIMIC_CLASS
                           || mtmp.data === monster_by_pmidx(name_to_pmidx('Wizard of Yendor'))) {
                    /* ordinarily only used for Wizard clones */
                    mtmp.m_ap_type = M_AP_MONSTER;
                    mtmp.mappearance = mndx;
                } else { /* chameleon or vampire */
                    const mdat = monster_by_pmidx(mndx);
                    const olddata = mtmp.data;

                    EXT.mgender_from_permonst(mtmp, mdat);
                    if (gender.v !== NEUTRAL) mtmp.female = gender.v;
                    EXT.set_mon_data(mtmp, mdat);
                    if (emits_light(olddata) !== emits_light(mtmp.data)) {
                        if (emits_light(olddata))
                            del_light_source(LS_MONSTER, EXT.monst_to_any(mtmp));
                        if (emits_light(mtmp.data))
                            new_light_source(mtmp.mx, mtmp.my,
                                             emits_light(mtmp.data),
                                             LS_MONSTER, EXT.monst_to_any(mtmp));
                    }
                    if (!mtmp.perminvis || EXT.pm_invisible(olddata))
                        mtmp.perminvis = EXT.pm_invisible(mdat);
                }
                break;
            }
            default:
                /* C: impossible("unimplemented mon appear type") */
                break;
            }
            /* C: does_block(x, y, &levl[x][y]); this port's does_block()
               reads the location itself. */
            if (does_block(x, y)) block_point(x, y);
        }

        mtmp.female = m.female;
        if (m.peaceful > BOOL_RANDOM) {
            mtmp.mpeaceful = m.peaceful;
            /* changed mpeaceful again; have to reset malign */
            set_malign(mtmp);
        }
        if (m.asleep > BOOL_RANDOM) mtmp.msleeping = m.asleep;
        if (m.seentraps) mtmp.mtrapseen = m.seentraps;
        if (m.cancelled) mtmp.mcan = 1;
        if (m.revived) mtmp.mrevived = 1;
        if (m.avenge) mtmp.mavenge = 1;
        if (m.stunned) mtmp.mstun = 1;
        if (m.confused) mtmp.mconf = 1;
        if (m.invis) { mtmp.minvis = mtmp.perminvis = 1; }
        if (m.blinded) {
            mtmp.mcansee = 0;
            mtmp.mblinded = (m.blinded % 127);
        }
        if (m.paralyzed) {
            mtmp.mcanmove = 0;
            mtmp.mfrozen = (m.paralyzed % 127);
        }
        if (m.fleeing) {
            mtmp.mflee = 1;
            mtmp.mfleetim = (m.fleeing % 127);
        }
        if (m.waiting) {
            mtmp.mstrategy = (mtmp.mstrategy || 0) | STRAT_WAITFORU;
            /* a vampire created already shifted into bat/fog/wolf form that the
               level didn't ask for shifts back to vampire */
            if (EXT.vampshifted(mtmp) && m.appear !== M_AP_MONSTER)
                newcham(mtmp, monster_by_pmidx(mtmp.cham), NO_NC_FLAGS);
        }
        if (m.m_lev_adj) {
            if (mtmp.m_lev + m.m_lev_adj > 49) mtmp.m_lev = 49;
            else if (mtmp.m_lev + m.m_lev_adj < 0) mtmp.m_lev = 0;
            else mtmp.m_lev += m.m_lev_adj;
        }
        if (!(m.has_invent & DEFAULT_INVENT)) {
            /* guard against e.g. a quest nemesis with custom inventory that
               lacks the Bell but was not flagged as keeping its default */
            EXT.mdrop_special_objs(mtmp);
            discard_minvent(mtmp, true);
        }
        if (m.has_invent & CUSTOM_INVENT) spl.invent_carrying_monster = mtmp;
    }
}

// C ref: sp_lev.c:2192 create_object(object *o, struct mkroom *croom).
// The location is resolved FIRST (so its draws precede the object's own), then
// mkobj_at/mksobj_at/mkgold, then every explicit override in file order.
export function create_object(o, croom) {
    let otmp;
    const named = o.name?.str ? true : false;

    const c = { x: -1, y: -1 };
    get_location_coord(c, DRY, croom, o.coord);
    const x = c.x, y = c.y;

    const cc = (o.class >= 0) ? o.class : 0;

    if (!cc) {
        otmp = mkobj_at(RANDOM_CLASS, x, y, !named);
    } else if (o.id !== -1) {
        otmp = mksobj_at(o.id, x, y, true, !named);
    } else {
        /* special levels use the default "text" object class chars */
        const oclass = def_char_to_objclass(cc);

        if (oclass === MAXOCLASSES) return null; /* C panics */

        /* KMH -- Create piles of gold properly */
        if (oclass === COIN_CLASS) otmp = mkgold(0, x, y);
        else otmp = mkobj_at(oclass, x, y, !named);
    }
    if (!otmp) return null;

    if (o.spe !== -127) otmp.spe = o.spe;   /* that means NOT RANDOM! */

    switch (o.curse_state) {
    case 1: bless(otmp); break;                            /* blessed */
    case 2: unbless(otmp); uncurse(otmp); break;           /* uncursed */
    case 3: curse(otmp); break;                            /* cursed */
    case 4: uncurse(otmp); break;                          /* not cursed */
    case 5: blessorcurse(otmp, 1); break;                  /* not uncursed */
    case 6: unbless(otmp); break;                          /* not blessed */
    default: break;                          /* random: keep what mkobj gave */
    }

    /* corpsenm is "empty" if -1, random if -2, otherwise specific */
    if (o.corpsenm !== NON_PM) {
        if (o.corpsenm === NON_PM - 1) set_corpsenm(otmp, EXT.rndmonnum());
        else set_corpsenm(otmp, o.corpsenm);
    }
    /* set_corpsenm() took care of egg hatch and corpse timers */

    if (named) {
        otmp = EXT.oname(otmp, o.name.str, ONAME_LEVEL_DEF);
        if (otmp.otyp === otyp_by_name('novel')) {   /* SPE_NOVEL */
            /* needs to be an existing title.  C: lookup_novel(name,
               &otmp->novelidx); this port's takes an out-box. */
            const box = { idx: otmp.novelidx };
            lookup_novel(o.name.str, box);
            otmp.novelidx = box.idx;
        }
    }
    if (o.eroded) {
        if (o.eroded < 0) {
            otmp.oerodeproof = 1;
        } else {
            otmp.oeroded = (o.eroded % 4);
            otmp.oeroded2 = ((o.eroded >> 2) % 4);
        }
    } else {
        otmp.oeroded = otmp.oeroded2 = 0;
        otmp.oerodeproof = 0;
    }
    if (o.recharged) otmp.recharged = (o.recharged % 8);
    if (o.locked === 0 || o.locked === 1) {
        otmp.olocked = o.locked;
    } else if (o.broken) {
        otmp.obroken = 1;
        otmp.olocked = 0;                  /* obj generation may set */
    }
    if (o.trapped === 0 || o.trapped === 1) otmp.otrapped = o.trapped;
    if (o.trapped && (o.tknown === 0 || o.tknown === 1)) otmp.tknown = o.tknown;
    otmp.greased = o.greased ? 1 : 0;

    if (o.quan > 0 && oc_merge(otmp.otyp)) {
        otmp.quan = o.quan;
        otmp.owt = weight(otmp);
    }

    /* contents (of a container or monster's inventory) */
    if ((o.containment & SP_OBJ_CONTENT) || spl.invent_carrying_monster) {
        if (!spl.container_idx) {
            if (!spl.invent_carrying_monster) {
                /* the monster may be legitimately gone (eg. a unique demon
                   already generated): leave 'otmp' on the floor */
            } else {
                obj_extract_self(otmp);    /* C: remove_object(otmp) */
                if (otmp.otyp === otyp_by_name('saddle')
                    && EXT.can_saddle(spl.invent_carrying_monster))
                    EXT.put_saddle_on_mon(otmp, spl.invent_carrying_monster);
                else
                    mpickobj(spl.invent_carrying_monster, otmp);
            }
        } else {
            const cobj = spl.container_obj[spl.container_idx - 1];

            obj_extract_self(otmp);
            if (cobj) {
                otmp = add_to_container(cobj, otmp);
                cobj.owt = weight(cobj);
            } else {
                obj_extract_self(otmp);
                /* uncreate a random artifact created in a container */
                if (otmp.oartifact)
                    EXT.artifact_exists(otmp, EXT.safe_oname(otmp), false, 0);
                obfree(otmp, null);
                return null;
            }
        }
    }
    /* container */
    if (o.containment & SP_OBJ_CONTAINER) {
        EXT.delete_contents(otmp);
        if (spl.container_idx < MAX_CONTAINMENT) {
            spl.container_obj[spl.container_idx] = otmp;
            spl.container_idx++;
        }
        /* else C: impossible("too deeply nested containers") */
    }

    /* Medusa level special case: statues are petrified monsters, so they are
     * not stone-resistant and have monster inventory. */
    if (o.id === STATUE && Is_medusa_level(game.u?.uz) && o.corpsenm === NON_PM) {
        let was = null;
        let wastyp;
        let i = 0;              /* prevent endless loop if makemon always fails */

        for (wastyp = otmp.corpsenm; i < 1000; i++, wastyp = EXT.rndmonnum()) {
            /* makemon without rndmonst() might create a group */
            was = makemon(monster_by_pmidx(wastyp), 0, 0,
                          MM_NOCOUNTBIRTH | MM_NOMSG);
            if (was) {
                if (!resists_ston(was)
                    && !EXT.poly_when_stoned(monster_by_pmidx(wastyp))) {
                    propagate(wastyp, true, false);
                    break;
                }
                EXT.mongone(was);
                was = null;
            }
        }
        if (was) {
            set_corpsenm(otmp, wastyp);
            while (was.minvent && was.minvent.length) {
                const obj = was.minvent[0];
                obj.owornmask = 0;
                obj_extract_self(obj);
                add_to_container(otmp, obj);
            }
            otmp.owt = weight(otmp);
            EXT.mongone(was);
        }
    }

    if (o.achievement) {
        const ach = game.context?.achieveo;
        if (EXT.Is_mineend_level(game.u?.uz)) {
            if (ach && !ach.mines_prize_oid) {
                ach.mines_prize_oid = otmp.o_id;
                ach.mines_prize_otyp = otmp.otyp;
                /* prevent stacking; cleared when the achievement is recorded */
                otmp.nomerge = 1;
            }
            /* else C: impossible("multiple prizes on mines end level") */
        } else if (EXT.Is_sokoend_level(game.u?.uz)) {
            if (ach && !ach.soko_prize_oid) {
                ach.soko_prize_oid = otmp.o_id;
                ach.soko_prize_otyp = otmp.otyp;
                otmp.nomerge = 1;   /* redundant; Sokoban prizes don't stack */
            }
        }
        /* else C: impossible("unknown achievement") unless iflags.lua_testing */
    }

    if (!(o.containment & SP_OBJ_CONTENT)) {
        stackobj(otmp);

        if (o.lit) EXT.begin_burn(otmp, false);

        if (o.buried) {
            const box = { dealloced: false };
            EXT.bury_an_obj(otmp, box);
            if (box.dealloced) {
                if (spl.container_idx)
                    spl.container_obj[spl.container_idx - 1] = null;
                otmp = null;
            }
        }
    }
    return otmp;
}

// C ref: sp_lev.c:195 MAX_CONTAINMENT.
const MAX_CONTAINMENT = 10;

// C ref: obj.h ONAME_LEVEL_DEF -- oname() flag for a level-file-supplied name.
const ONAME_LEVEL_DEF = 0x04;

// C ref: mon.h STRAT_WAITFORU.
const STRAT_WAITFORU = 0x08000000;

// Resolve an otyp from its objects.h name rather than hardcoding the index:
// objects[] index drift is this port's most expensive bug class
// ([[wrong-constant-sweep]]).  Memoised; no RNG.
const _otyp_by_name = new Map();
function otyp_by_name(nm) {
    if (_otyp_by_name.has(nm)) return _otyp_by_name.get(nm);
    let found = STRANGE_OBJECT_OTYP;
    for (let i = 0; i < OBJDATA.length; i++)
        if (OBJDATA[i]?.name === nm) { found = i; break; }
    _otyp_by_name.set(nm, found);
    return found;
}

// C ref: sp_lev.c:2445 create_altar(altar *a, struct mkroom *croom).
// a: { coord, sp_amask, shrine }.  The `shrine < 0` rn2(2) happens AFTER
// sp_amask_to_amask()'s own draw and after set_levltyp's bail-out, so an altar
// that lands on existing furniture costs the alignment draw but not the shrine
// one.
export function create_altar(a, croom) {
    const c = { x: -1, y: -1 };
    let croom_is_temple = true;

    if (croom) {
        get_free_room_loc(c, croom, a.coord);
        if (croom.rtype !== TEMPLE) croom_is_temple = false;
    } else {
        get_location_coord(c, DRY, croom, a.coord);
        /* C: `(sproom = *in_rooms(x, y, TEMPLE)) != 0` -- in_rooms() returns a
           list of roomno values (index + ROOMOFFSET); take the first. */
        const rl = in_rooms(c.x, c.y, TEMPLE);
        const sproom = rl.length ? rl[0] : 0;
        if (sproom) croom = svr_rooms()[sproom - ROOMOFFSET];
        else croom_is_temple = false;
    }
    const x = c.x, y = c.y;

    /* check for existing features */
    if (!set_levltyp_lit(x, y, ALTAR, SET_LIT_NOCHANGE)) return;  /* set_levltyp */
    const loc = levl_at(x, y);
    if (!loc) return;

    const amask = sp_amask_to_amask(a.sp_amask);

    loc.altarmask = amask;

    if (a.shrine < 0) a.shrine = rn2(2);     /* handle random case */

    if (!croom_is_temple || !a.shrine) return;

    if (a.shrine) {                          /* Is it a shrine or sanctum? */
        priestini(game.u?.uz, croom, x, y, (a.shrine > 1));
        loc.altarmask |= AM_SHRINE;
        if (a.shrine === 2) loc.altarmask |= AM_SANCTUM; /* high altar */
        if (game.level?.flags) game.level.flags.has_temple = true;
    }
}

// C ref: sp_lev.c:2491 search_door(croom, &x, &y, wall, cnt) -- walk one wall
// of croom and hand back the (cnt+1)'th door on it.  No RNG.
export function search_door(croom, c, wall, cnt) {
    let dx, dy, xx, yy;

    switch (wall) {
    case W_SOUTH: dy = 0; dx = 1; xx = croom.lx;     yy = croom.hy + 1; break;
    case W_NORTH: dy = 0; dx = 1; xx = croom.lx;     yy = croom.ly - 1; break;
    case W_EAST:  dy = 1; dx = 0; xx = croom.hx + 1; yy = croom.ly;     break;
    case W_WEST:  dy = 1; dx = 0; xx = croom.lx - 1; yy = croom.ly;     break;
    default: return false;               /* C panics: "search_door: Bad wall!" */
    }
    while (xx <= croom.hx + 1 && yy <= croom.hy + 1) {
        const typ = levl_typ(xx, yy);
        if (IS_DOOR(typ) || typ === SDOOR) {
            c.x = xx;
            c.y = yy;
            if (cnt-- <= 0) return true;
        }
        xx += dx;
        yy += dy;
    }
    return false;
}

// C ref: sp_lev.c:2670 create_corridor(corridor *c).  src.room == -1 means
// des.random_corridors(); anything else digs one explicit door-to-door run.
export function create_corridor(c) {
    const org = { x: 0, y: 0 }, dest = { x: 0, y: 0 };

    if (c.src.room === -1) {
        EXT.makecorridors();               /* makecorridors(c->src.door) */
        return;
    }

    /* Safety railings: search_door() cannot handle a random wall. */
    if (c.src.wall === W_ANY || c.src.wall === W_RANDOM
        || c.dest.wall === W_ANY || c.dest.wall === W_RANDOM)
        return;                            /* C: impossible() */

    if (!search_door(svr_rooms()[c.src.room], org, c.src.wall, c.src.door))
        return;
    if (c.dest.room !== -1) {
        if (!search_door(svr_rooms()[c.dest.room], dest, c.dest.wall,
                         c.dest.door))
            return;
        switch (c.src.wall) {
        case W_NORTH: org.y--; break;
        case W_SOUTH: org.y++; break;
        case W_WEST:  org.x--; break;
        case W_EAST:  org.x++; break;
        }
        switch (c.dest.wall) {
        case W_NORTH: dest.y--; break;
        case W_SOUTH: dest.y++; break;
        case W_WEST:  dest.x--; break;
        case W_EAST:  dest.x++; break;
        }
        EXT.dig_corridor(org, dest, null, false, CORR, STONE);
    }
}

// C ref: sp_lev.c:2806 build_room(room *r, struct mkroom *mkr).  The rtype
// rn2(100) is drawn FIRST and only when r->chance is nonzero, ahead of
// create_room()/create_subroom()'s own draws.
export function build_room(r, mkr) {
    let okroom, aroom;
    const rtype = (!r.chance || rn2(100) < r.chance) ? r.rtype : OROOM;

    if (mkr) {
        aroom = game.level?.subrooms?.[game.level?.nsubroom || 0];
        okroom = EXT.create_subroom(mkr, r.x, r.y, r.w, r.h, rtype, r.rlit);
    } else {
        aroom = svr_rooms()[svn_nroom()];
        okroom = EXT.create_room(r.x, r.y, r.w, r.h, r.xalign, r.yalign,
                                 rtype, r.rlit);
    }

    if (okroom) {
        EXT.topologize(aroom);             /* set roomno */
        aroom.needfill = r.needfill;
        aroom.needjoining = r.joined;
        return aroom;
    }
    return null;
}

// C ref: sp_lev.c:2838 light_region(region *tmpregion) -- lighting for an area
// that will NOT become a room.  A LIT region grows by one square first (so its
// walls light up too); an unlit one does not.  No RNG.
export function light_region(tmpregion) {
    const litstate = tmpregion.rlit ? 1 : 0;
    let hiy = tmpregion.y2;
    let lowy = tmpregion.y1;
    let lowx = tmpregion.x1, hix = tmpregion.x2;

    if (litstate) {
        lowx = Math.max(lowx - 1, 1);
        hix = Math.min(hix + 1, COLNO - 1);
        lowy = Math.max(lowy - 1, 0);
        hiy = Math.min(hiy + 1, ROWNO - 1);
    }
    for (let x = lowx; x <= hix; x++)
        for (let y = lowy; y <= hiy; y++) {
            const lev = levl_at(x, y);
            if (!lev) continue;
            lev.lit = IS_LAVA(lev.typ) ? 1 : litstate;
        }
}

// C ref: sp_lev.c:2864 wallify_map(x1, y1, x2, y2) -- every STONE square next
// to a room square (or a CROSSWALL) becomes a wall; HWALL when the neighbour
// found was on a different row, VWALL otherwise.  No RNG.
export function wallify_map(x1, y1, x2, y2) {
    y1 = Math.max(y1, 0);
    x1 = Math.max(x1, 1);
    y2 = Math.min(y2, ROWNO - 1);
    x2 = Math.min(x2, COLNO - 1);
    for (let y = y1; y <= y2; y++) {
        const lo_yy = (y > 0) ? y - 1 : 0;
        const hi_yy = (y < y2) ? y + 1 : y2;
        for (let x = x1; x <= x2; x++) {
            const loc = levl_at(x, y);
            if (!loc || loc.typ !== STONE) continue;
            const lo_xx = (x > 1) ? x - 1 : 1;
            const hi_xx = (x < x2) ? x + 1 : x2;
            let done = false;
            for (let yy = lo_yy; yy <= hi_yy && !done; yy++)
                for (let xx = lo_xx; xx <= hi_xx; xx++) {
                    const t = levl_typ(xx, yy);
                    if (IS_ROOM(t) || t === CROSSWALL) {
                        loc.typ = (yy !== y) ? HWALL : VWALL;
                        done = true;        /* C: end both loops */
                        break;
                    }
                }
        }
    }
}

// C ref: sp_lev.c:2899 maze1xy(coord *m, humidity) -- a random maze square the
// special level did not claim.  Two draws per attempt, up to 2000 attempts;
// the odd-parity and SpLev_Map tests are part of the loop condition so a
// rejected square still costs both.
export function maze1xy(m, humidity) {
    let x, y, tryct = 2000;

    do {
        x = rn1(gx.x_maze_max - 3, 3);                      // sp_lev.c:2908
        y = rn1(gy.y_maze_max - 3, 3);                      // sp_lev.c:2909
        if (--tryct < 0) break;          /* give up */
    } while (!(x % 2) || !(y % 2) || splev_map_at(x, y)
             || !sp_is_ok_location(x, y, humidity));

    m.x = x; m.y = y;
}

// C ref: sp_lev.c:2925 fill_empty_maze() -- stock the part of the maze the
// special level left alone, in proportion to how much of it is unused.  Six
// loops, each with its own count draw, in this order: gems/random objects,
// boulders, minotaurs, random monsters, gold, traps.
export function fill_empty_maze() {
    let mapcountmax, mapcount, mapfact;
    const mm = { x: 0, y: 0 };

    mapcountmax = mapcount = (gx.x_maze_max - 2) * (gy.y_maze_max - 2);
    mapcountmax = Math.trunc(mapcountmax / 2);

    for (let x = 2; x < gx.x_maze_max; x++)
        for (let y = 0; y < gy.y_maze_max; y++)
            if (splev_map_at(x, y)) mapcount--;

    if (mapcount > Math.trunc(mapcountmax / 10)) {
        mapfact = Math.trunc((mapcount * 100) / mapcountmax);
        for (let x = rnd(Math.trunc((20 * mapfact) / 100)); x; x--) {
            maze1xy(mm, DRY);
            mkobj_at(rn2(2) ? GEM_CLASS : RANDOM_CLASS, mm.x, mm.y, true);
        }
        for (let x = rnd(Math.trunc((12 * mapfact) / 100)); x; x--) {
            maze1xy(mm, DRY);
            const ttmp = t_at(mm.x, mm.y);
            if (ttmp && (is_pit(ttmp.ttyp) || is_hole(ttmp.ttyp))) continue;
            mksobj_at(BOULDER, mm.x, mm.y, true, false);
        }
        for (let x = rn2(2); x; x--) {
            maze1xy(mm, DRY);
            makemon(monster_by_pmidx(name_to_pmidx('minotaur')), mm.x, mm.y, 0);
        }
        for (let x = rnd(Math.trunc((12 * mapfact) / 100)); x; x--) {
            maze1xy(mm, DRY);
            makemon(null, mm.x, mm.y, 0);
        }
        for (let x = rn2(Math.trunc((15 * mapfact) / 100)); x; x--) {
            maze1xy(mm, DRY);
            mkgold(0, mm.x, mm.y);
        }
        for (let x = rn2(Math.trunc((15 * mapfact) / 100)); x; x--) {
            maze1xy(mm, DRY);
            let trytrap = rndtrap();
            if (sobj_at(BOULDER, mm.x, mm.y))
                while (is_pit(trytrap) || is_hole(trytrap)) trytrap = rndtrap();
            maketrap(mm.x, mm.y, trytrap);
        }
    }
}

// C ref: sp_lev.c:2981 splev_initlev(lev_init *linit) -- des.level_init().
// The `lit == BOOL_RANDOM` rn2(2) belongs to the style, so only solidfill,
// mines and swamp draw it.
export function splev_initlev(linit) {
    switch (linit.init_style) {
    default:
        break;                             /* C: impossible() */
    case LVLINIT_NONE:
        break;
    case LVLINIT_SOLIDFILL:
        if (linit.lit === BOOL_RANDOM) linit.lit = rn2(2);
        lvlfill_solid(linit.filling, linit.lit);
        break;
    case LVLINIT_MAZEGRID:
        lvlfill_maze_grid(2, 0, gx.x_maze_max, gy.y_maze_max, linit.bg);
        break;
    case LVLINIT_MAZE:
        create_maze(linit.corrwid, linit.wallthick, linit.rm_deadends);
        break;
    case LVLINIT_ROGUE:
        EXT.makeroguerooms();
        break;
    case LVLINIT_MINES:
        if (linit.lit === BOOL_RANDOM) linit.lit = rn2(2);
        if (linit.filling > -1) lvlfill_solid(linit.filling, 0);
        linit.icedpools = spl.icedpools;
        EXT.mkmap(linit);
        break;
    case LVLINIT_SWAMP:
        if (linit.lit === BOOL_RANDOM) linit.lit = rn2(2);
        lvlfill_swamp(linit.fg, linit.bg, linit.lit);
        break;
    }
}

// C ref: sp_lev.c:3021 -- #if 0'd in C (macosx unused warning), kept for parity.
export function sp_code_jmpaddr(curpos, jmpaddr) {
    return (curpos + jmpaddr);
}

// C ref: sp_lev.c:3030 -- close out a des.monster() inventory block.
export function spo_end_moninvent() {
    if (spl.invent_carrying_monster) m_dowear(spl.invent_carrying_monster, true);
    spl.invent_carrying_monster = null;
}

// C ref: sp_lev.c:3039 -- close out a des.object() contents block.
export function spo_pop_container() {
    if (spl.container_idx > 0) {
        spl.container_idx--;
        spl.container_obj[spl.container_idx] = null;
    }
}

// C ref: sp_lev.c:3049 -- the table lspo_map() hands its contents() callback.
export function l_push_wid_hei_table(L, wid, hei) {
    return { width: wid, height: hei };
}

// C ref: sp_lev.c:3058 -- the table lspo_room()/lspo_region() hand their
// contents() callback.
export function l_push_mkroom_table(L, tmpr) {
    return {
        width: 1 + (tmpr.hx - tmpr.lx),
        height: 1 + (tmpr.hy - tmpr.ly),
        region: [tmpr.lx, tmpr.ly, tmpr.hx, tmpr.hy],
        lit: !!tmpr.rlit,
        irregular: !!tmpr.irregular,
        needjoining: !!tmpr.needjoining,
        type: get_mkroom_name(tmpr.rtype),
    };
}

// C ref: sp_lev.c:3075 -- des.message("..."), appended to gl.lev_message with
// '\n' between entries.  No RNG.
export function lspo_message(...args) {
    if (args.length < 1) nhl_error('Wrong parameters');

    create_des_coder();

    const msg = String(args[0]);

    game.lev_message = game.lev_message ? (game.lev_message + '\n' + msg) : msg;

    return 0;
}

// C ref: sp_lev.c:3113 -- des.* `align = ...`.  Defaults to "random", which is
// AM_SPLEV_RANDOM (an induced_align(80) draw later, in sp_amask_to_amask).
const GTALIGNS = ['noalign', 'law', 'neutral', 'chaos',
                  'coaligned', 'noncoaligned', 'random'];
export function get_table_align(t) {
    const aligns2i = [AM_NONE, AM_LAWFUL, AM_NEUTRAL, AM_CHAOTIC,
                      AM_SPLEV_CO, AM_SPLEV_NONCO, AM_SPLEV_RANDOM, 0];

    return aligns2i[get_table_option(t, 'align', 'random', GTALIGNS)];
}

// C ref: sp_lev.c:3130 -- `class = "D"`: only a single character counts.
export function get_table_monclass(t) {
    const s = get_table_str_opt(t, 'class', null);
    let ret = -1;

    if (s && s.length === 1) ret = s.charCodeAt(0);
    return ret;
}

// C ref: sp_lev.c:3142 find_montype(L, s, &mgender).  The lua_State is UNUSED
// in C.  One rn2(2) -- but ONLY for a species that is neither all-male nor
// all-female AND whose name was not itself a gendered form ("gnome lord" is
// the male name, so it never rolls).
// C's name_to_monplus(s, NULL, &mgend) is split in this port into
// name_to_pmidx() (the index) + name_gender_hint() (the gender the NAME
// implies); MGEND_MALE/FEMALE/NEUTRAL are C's MALE/FEMALE/NEUTRAL values.
export function find_montype(s, mgender) {
    let mgend = NEUTRAL;

    const i = name_to_pmidx(s);
    mgend = name_gender_hint(s);
    const ptr = (i >= LOW_PM) ? monster_by_pmidx(i) : null;
    if (ptr) {
        if (is_male_flag(ptr) || is_female_flag(ptr))
            mgend = is_female_flag(ptr) ? FEMALE : MALE;
        else
            mgend = (mgend === FEMALE) ? FEMALE
                        : (mgend === MALE) ? MALE : rn2(2);   // sp_lev.c:3156
        if (mgender) mgender.v = mgend;
        return i;
    }
    if (mgender) mgender.v = NEUTRAL;
    return NON_PM;
}

// C ref: sp_lev.c:3166 -- `id = "giant eel"`.  Absent id costs no draw.
export function get_table_montype(t, mgender) {
    const s = get_table_str_opt(t, 'id', null);
    let ret = NON_PM;

    if (s) {
        ret = find_montype(s, mgender);
        if (ret === NON_PM) nhl_error('Unknown monster id');
    }
    return ret;
}

// C ref: sp_lev.c:3187 -- accept either `x=,y=` or `coord={x,y}`.  Absolute
// (not map-relative) coordinates come back; the caller decides.
export function get_table_xy_or_coord(t, out) {
    let mx = get_table_int_opt(t, 'x', -1);
    let my = get_table_int_opt(t, 'y', -1);

    if (mx === -1 && my === -1) {
        const c = { x: mx, y: my };
        get_coord(t?.coord, c);
        mx = c.x; my = c.y;
    }

    out.x = mx;
    out.y = my;
}

// C ref: sp_lev.c:3213 lspo_monster() -- des.monster().  Accepted shapes:
//   des.monster()                       -> everything random
//   des.monster("wood nymph")           -> by name (or a single class letter)
//   des.monster("hill giant", {08,06})  -> name + coord table
//   des.monster("giant eel", 11, 6)     -> name + x + y
//   des.monster({ ... })                -> the full table form
// Draw order: the name's find_montype rn2(2) (parse time) precedes everything
// create_monster() does, including induced_align.
export function lspo_monster(...args) {
    const argc = args.length;
    const tmpmons = {};
    const xy = { x: -1, y: -1 };
    const mgend = { v: NEUTRAL };

    create_des_coder();

    tmpmons.peaceful = -1;
    tmpmons.asleep = -1;
    tmpmons.name = { str: null };
    tmpmons.appear = 0;
    tmpmons.appear_as = { str: null };
    tmpmons.sp_amask = AM_SPLEV_RANDOM;
    tmpmons.female = 0;
    tmpmons.invis = 0;
    tmpmons.cancelled = 0;
    tmpmons.revived = 0;
    tmpmons.avenge = 0;
    tmpmons.fleeing = 0;
    tmpmons.blinded = 0;
    tmpmons.paralyzed = 0;
    tmpmons.stunned = 0;
    tmpmons.confused = 0;
    tmpmons.seentraps = 0;
    tmpmons.has_invent = DEFAULT_INVENT;
    tmpmons.waiting = 0;
    tmpmons.mm_flags = 0;                  /* NO_MM_FLAGS */
    tmpmons.m_lev_adj = 0;

    let t = null;
    if (argc === 1 && typeof args[0] === 'string') {
        const paramstr = args[0];

        if (paramstr.length === 1) {
            tmpmons.class = paramstr.charCodeAt(0);
            tmpmons.id = NON_PM;
        } else {
            tmpmons.class = -1;
            tmpmons.id = find_montype(paramstr, mgend);
            tmpmons.female = (mgend.v === FEMALE) ? FEMALE
                                : (mgend.v === MALE) ? MALE : rn2(2);
        }
    } else if (argc === 2 && typeof args[0] === 'string'
               && typeof args[1] === 'object') {
        const paramstr = args[0];

        get_coord(args[1], xy);

        if (paramstr.length === 1) {
            tmpmons.class = paramstr.charCodeAt(0);
            tmpmons.id = NON_PM;
        } else {
            tmpmons.class = -1;
            tmpmons.id = find_montype(paramstr, mgend);
            tmpmons.female = (mgend.v === FEMALE) ? FEMALE
                                : (mgend.v === MALE) ? MALE : rn2(2);
        }
    } else if (argc === 3) {
        const paramstr = args[0];

        xy.x = Math.trunc(args[1]);
        xy.y = Math.trunc(args[2]);

        if (paramstr.length === 1) {
            tmpmons.class = paramstr.charCodeAt(0);
            tmpmons.id = NON_PM;
        } else {
            tmpmons.class = -1;
            tmpmons.id = find_montype(paramstr, mgend);
            tmpmons.female = (mgend.v === FEMALE) ? FEMALE
                                : (mgend.v === MALE) ? MALE : rn2(2);
        }
    } else {
        let keep_default_invent = -1;      /* -1 = unspecified */
        t = lcheck_param_table(args[0]);

        tmpmons.peaceful = get_table_boolean_opt(t, 'peaceful', BOOL_RANDOM);
        tmpmons.asleep = get_table_boolean_opt(t, 'asleep', BOOL_RANDOM);
        tmpmons.name.str = get_table_str_opt(t, 'name', null);
        tmpmons.appear = 0;
        tmpmons.appear_as.str = null;
        tmpmons.sp_amask = get_table_align(t);
        tmpmons.female = get_table_boolean_opt(t, 'female', BOOL_RANDOM);
        tmpmons.invis = get_table_boolean_opt(t, 'invisible', false);
        tmpmons.cancelled = get_table_boolean_opt(t, 'cancelled', false);
        tmpmons.revived = get_table_boolean_opt(t, 'revived', false);
        tmpmons.avenge = get_table_boolean_opt(t, 'avenge', false);
        tmpmons.fleeing = get_table_int_opt(t, 'fleeing', 0);
        tmpmons.blinded = get_table_int_opt(t, 'blinded', 0);
        tmpmons.paralyzed = get_table_int_opt(t, 'paralyzed', 0);
        tmpmons.stunned = get_table_boolean_opt(t, 'stunned', false);
        tmpmons.confused = get_table_boolean_opt(t, 'confused', false);
        tmpmons.waiting = get_table_boolean_opt(t, 'waiting', false);
        tmpmons.m_lev_adj = get_table_int_opt(t, 'm_lev_adj', 0);
        tmpmons.seentraps = 0;   /* TODO (C): list of trap names to bitfield */
        keep_default_invent = get_table_boolean_opt(t, 'keep_default_invent', -1);

        if (!get_table_boolean_opt(t, 'tail', true))
            tmpmons.mm_flags |= MM_NOTAIL;
        if (!get_table_boolean_opt(t, 'group', true))
            tmpmons.mm_flags |= MM_NOGRP;
        if (get_table_boolean_opt(t, 'adjacentok', false))
            tmpmons.mm_flags |= MM_ADJACENTOK;
        if (get_table_boolean_opt(t, 'ignorewater', false))
            tmpmons.mm_flags |= MM_IGNOREWATER;
        if (!get_table_boolean_opt(t, 'countbirth', true))
            tmpmons.mm_flags |= MM_NOCOUNTBIRTH;

        const mappear = get_table_str_opt(t, 'appear_as', null);
        if (mappear) {
            if (mappear.startsWith('obj:')) tmpmons.appear = M_AP_OBJECT;
            else if (mappear.startsWith('mon:')) tmpmons.appear = M_AP_MONSTER;
            else if (mappear.startsWith('ter:')) tmpmons.appear = M_AP_FURNITURE;
            else nhl_error('Unknown appear_as type');
            tmpmons.appear_as.str = mappear.slice(4);
        }

        get_table_xy_or_coord(t, xy);

        tmpmons.id = get_table_montype(t, mgend);
        /* get_table_montype returns a random gender for a species that is not
           all-male or all-female; an explicit `female =` overrides that random
           one, but never overrides a one-gender species (no male nymphs). */
        const idptr = (tmpmons.id >= LOW_PM) ? monster_by_pmidx(tmpmons.id) : null;
        if (mgend.v !== NEUTRAL
            && (tmpmons.female === BOOL_RANDOM
                || (idptr && (is_female_flag(idptr) || is_male_flag(idptr)))))
            tmpmons.female = mgend.v;
        /* safety net when find_montype found no gender */
        if (tmpmons.female === BOOL_RANDOM) tmpmons.female = 0;

        tmpmons.class = get_table_monclass(t);

        if (t.inventory != null) {
            /* most times inventory is specified the monster should NOT also get
               its species' default inventory */
            tmpmons.has_invent = CUSTOM_INVENT;
            if (keep_default_invent === 1) tmpmons.has_invent |= DEFAULT_INVENT;
        } else {
            if (keep_default_invent === 0) tmpmons.has_invent = NO_INVENT;
        }
    }

    if (xy.x === -1 && xy.y === -1) tmpmons.coord = SP_COORD_PACK_RANDOM(0);
    else tmpmons.coord = SP_COORD_PACK(xy.x, xy.y);

    if (tmpmons.id !== NON_PM && tmpmons.class === -1) {
        const ptr = monster_by_pmidx(tmpmons.id);
        tmpmons.class = ptr ? ptr.sym : -1;   /* C: monsym(&mons[id]) */
    }

    create_monster(tmpmons, spl.coder?.croom);

    if ((tmpmons.has_invent & CUSTOM_INVENT) && typeof t?.inventory === 'function') {
        t.inventory();
        spo_end_moninvent();
    }

    return 0;
}

// C ref: sp_lev.c:3406 -- `spe = 4` / `spe = "random"` / absent all mean
// something different; "random" and absent both give rndval.  No RNG here.
export function get_table_int_or_random(t, name, rndval) {
    const v = t?.[name];

    if (v == null) return rndval;
    if (typeof v !== 'number') {
        const tmp = (v == null) ? null : String(v);
        if (tmp && tmp.toLowerCase() === 'random') return rndval;
        nhl_error(`Expected integer or "random" for "${name}", got `
                  + (tmp ? `"${tmp}"` : '<Null>'));
        return 0;
    }
    return Math.trunc(v);
}

// C ref: sp_lev.c:3441 -- `buc = "cursed"` -> create_object's curse_state.
const BUCS = ['random', 'blessed', 'uncursed', 'cursed',
              'not-cursed', 'not-uncursed', 'not-blessed'];
export function get_table_buc(t) {
    const bucs2i = [0, 1, 2, 3, 4, 5, 6, 0];
    return bucs2i[get_table_option(t, 'buc', 'random', BUCS)];
}

// C ref: sp_lev.c:3454 -- `class = "%"`.
export function get_table_objclass(t) {
    const s = get_table_str_opt(t, 'class', null);
    let ret = -1;

    if (s && s.length === 1) ret = s.charCodeAt(0);
    return ret;
}

// C ref: sp_lev.c:3467 find_objtype(L, s, oclass) -- resolve an object by
// objects.h name, then by appearance description.  The " of " prefix table
// exists because several classes are defined without their prefix, which makes
// bare names like "teleportation" ambiguous.  No RNG.
// C's table stores the class CONSTANT (RING_CLASS, ...); the class symbol
// stored here is the same value one def_char_to_objclass() away, which avoids
// naming the enum indices (see [[wrong-constant-sweep]]).
const CLASS_PREFIXES = [
    ['ring of ', '='], ['potion of ', '!'], ['scroll of ', '?'],
    ['spellbook of ', '+'], ['wand of ', '/'],
];
export function find_objtype(s, oclass) {
    if (s && String(s).length) {
        let str = String(s);
        let cls = def_char_to_objclass(oclass);

        if (cls === MAXOCLASSES) cls = 0;

        if (str.toLowerCase().includes(' of ')) {
            for (const [p, csym] of CLASS_PREFIXES) {
                if (str.slice(0, p.length).toLowerCase() === p) {
                    cls = def_char_to_objclass(csym);
                    str = str.slice(p.length);
                    break;
                }
            }
        }

        /* find by object name */
        for (let i = 0; i < OBJDATA.length; i++) {
            const objname = OBJDATA[i]?.name;
            if ((!cls || cls === OBJDATA[i].oc_class)
                && objname && objname.toLowerCase() === str.toLowerCase())
                return i;
        }

        /*
         * C FIXME kept verbatim: "orange potion" cannot match, because the
         * description is just "orange"; and "gray stone" would always pick
         * the first one.
         */

        /* find by object description */
        for (let i = 0; i < OBJDATA.length; i++) {
            const objname = DESCR_BY_OTYP[OBJDATA[i]?.oc_descr_idx ?? i];
            if (objname && objname.toLowerCase() === str.toLowerCase()) return i;
        }

        nhl_error('Unknown object id');
    }
    return STRANGE_OBJECT_OTYP;
}

// C ref: sp_lev.c:3538 -- `id = "sack"` plus the optional `class =`.
export function get_table_objtype(t) {
    const s = get_table_str_opt(t, 'id', null);
    const oclass = get_table_objclass(t);
    return find_objtype(s, oclass);
}

// C ref: sp_lev.c:3556 lspo_object() -- des.object().  Shapes mirror
// des.monster().  The `quancnt` do/while at :3734 is what makes
// `quantity = N` of a non-merging type create N separate objects.
export function lspo_object(...args) {
    const argc = args.length;
    const tmpobj = {
        name: { str: null }, corpsenm: NON_PM, id: 0, spe: -127, coord: 0,
        x: 0, y: 0, class: 0, containment: 0, curse_state: 0, quan: -1,
        buried: 0, lit: 0, eroded: 0, locked: -1, trapped: -1, tknown: -1,
        recharged: 0, invis: 0, greased: 0, broken: 0, achievement: 0,
    };
    const xy = { x: -1, y: -1 };
    let maybe_contents = 0;
    let otmp = null;

    create_des_coder();

    let t = null;
    if (argc === 1 && typeof args[0] === 'string') {
        const paramstr = args[0];

        if (paramstr.length === 1) {
            tmpobj.class = paramstr.charCodeAt(0);
            tmpobj.id = STRANGE_OBJECT_OTYP;
        } else {
            tmpobj.class = -1;
            tmpobj.id = find_objtype(paramstr, -1);
        }
    } else if (argc === 2 && typeof args[0] === 'string'
               && typeof args[1] === 'object') {
        const paramstr = args[0];

        get_coord(args[1], xy);

        if (paramstr.length === 1) {
            tmpobj.class = paramstr.charCodeAt(0);
            tmpobj.id = STRANGE_OBJECT_OTYP;
        } else {
            tmpobj.class = -1;
            tmpobj.id = find_objtype(paramstr, -1);
        }
    } else if (argc === 3 && typeof args[1] === 'number'
               && typeof args[2] === 'number') {
        const paramstr = args[0];

        xy.x = Math.trunc(args[1]);
        xy.y = Math.trunc(args[2]);

        if (paramstr.length === 1) {
            tmpobj.class = paramstr.charCodeAt(0);
            tmpobj.id = STRANGE_OBJECT_OTYP;
        } else {
            tmpobj.class = -1;
            tmpobj.id = find_objtype(paramstr, -1);
        }
    } else {
        t = lcheck_param_table(args[0]);

        tmpobj.spe = get_table_int_or_random(t, 'spe', -127);
        tmpobj.curse_state = get_table_buc(t);
        tmpobj.corpsenm = NON_PM;
        tmpobj.name.str = get_table_str_opt(t, 'name', null);
        tmpobj.quan = get_table_int_or_random(t, 'quantity', -1);
        tmpobj.buried = get_table_boolean_opt(t, 'buried', 0);
        tmpobj.lit = get_table_boolean_opt(t, 'lit', 0);
        tmpobj.eroded = get_table_int_opt(t, 'eroded', 0);
        tmpobj.locked = get_table_boolean_opt(t, 'locked', -1);
        tmpobj.trapped = get_table_boolean_opt(t, 'trapped', -1);
        tmpobj.tknown = get_table_boolean_opt(t, 'trap_known', -1);
        tmpobj.recharged = get_table_int_opt(t, 'recharged', 0);
        tmpobj.greased = get_table_boolean_opt(t, 'greased', 0);
        tmpobj.broken = get_table_boolean_opt(t, 'broken', 0);
        tmpobj.achievement = get_table_boolean_opt(t, 'achievement', 0);

        get_table_xy_or_coord(t, xy);

        tmpobj.id = get_table_objtype(t);
        tmpobj.class = get_table_objclass(t);
        maybe_contents = 1;
    }

    if (xy.x === -1 && xy.y === -1) tmpobj.coord = SP_COORD_PACK_RANDOM(0);
    else tmpobj.coord = SP_COORD_PACK(xy.x, xy.y);

    if (tmpobj.class === -1 && tmpobj.id > STRANGE_OBJECT_OTYP)
        tmpobj.class = OBJDATA[tmpobj.id].oc_class;
    else if (tmpobj.class > -1 && tmpobj.id === STRANGE_OBJECT_OTYP)
        tmpobj.id = -1;

    const O_STATUE = STATUE, O_EGG = otyp_by_name('egg'),
          O_CORPSE = CORPSE, O_TIN = otyp_by_name('tin'),
          O_FIGURINE = otyp_by_name('figurine');
    if (tmpobj.id === O_STATUE || tmpobj.id === O_EGG
        || tmpobj.id === O_CORPSE || tmpobj.id === O_TIN
        || tmpobj.id === O_FIGURINE) {
        let pm = null;
        let nonpmobj = false;
        const montype = get_table_str_opt(t, 'montype', null);

        if (montype) {
            const ml = montype.toLowerCase();
            if ((tmpobj.id === O_TIN && (ml === 'spinach' || ml === 'empty'))
                || (tmpobj.id === O_EGG && ml === 'empty')) {
                tmpobj.corpsenm = NON_PM;
                tmpobj.spe = (ml === 'spinach') ? 1 : 0;
                nonpmobj = true;
            } else if (montype.length === 1
                       && EXT.def_char_to_monclass(montype.charCodeAt(0)) !== MAXMCLASSES) {
                pm = mkclass(EXT.def_char_to_monclass(montype.charCodeAt(0)),
                             G_NOGEN_FLAG | G_IGNORE);
            } else {
                for (let i = LOW_PM; ; i++) {
                    /* C loops to NUMMONS; monster_by_pmidx() returning null is
                       the end of this port's mons[] (never hardcode the count
                       -- see [[mons-table-missing-mail-daemon]]). */
                    const p = monster_by_pmidx(i);
                    if (!p) break;
                    if (p.name?.toLowerCase() === ml
                        || (p.mname_male && p.mname_male.toLowerCase() === ml)
                        || (p.mname_female && p.mname_female.toLowerCase() === ml)) {
                        pm = p;
                        break;
                    }
                }
            }
            if (pm) tmpobj.corpsenm = pm.pmidx;
            else if (!nonpmobj) nhl_error('Unknown montype');
        }
        if (tmpobj.id === O_STATUE || tmpobj.id === O_CORPSE) {
            let lflags = 0;

            if (get_table_boolean_opt(t, 'historic', 0)) lflags |= CORPSTAT_HISTORIC;
            if (get_table_boolean_opt(t, 'male', 0)) lflags |= CORPSTAT_MALE;
            if (get_table_boolean_opt(t, 'female', 0)) lflags |= CORPSTAT_FEMALE;
            tmpobj.spe = lflags;
        } else if (tmpobj.id === O_EGG) {
            tmpobj.spe = get_table_boolean_opt(t, 'laid_by_you', 0) ? 1 : 0;
        } else if (!nonpmobj) {   /* spe is already set for nonpmobj */
            tmpobj.spe = 0;
        }
    }

    let quancnt = (tmpobj.id > STRANGE_OBJECT_OTYP) ? tmpobj.quan : 0;

    if (spl.container_idx) tmpobj.containment |= SP_OBJ_CONTENT;

    if (maybe_contents && t?.contents != null)
        tmpobj.containment |= SP_OBJ_CONTAINER;

    do {
        otmp = create_object(tmpobj, spl.coder?.croom);
        quancnt--;
    } while ((quancnt > 0) && ((tmpobj.id > STRANGE_OBJECT_OTYP)
                               && !oc_merge(tmpobj.id)));

    if (typeof t?.contents === 'function') t.contents(otmp);

    if ((tmpobj.containment & SP_OBJ_CONTAINER) !== 0) spo_pop_container();

    return otmp;
}

// C ref: sp_lev.c:3758 lspo_level_flags(...) -- des.level_flags("noteleport",
// "mazelevel", ...).  No RNG.
export function lspo_level_flags(...args) {
    create_des_coder();

    if (args.length < 1) nhl_error('expected string params');

    const flags = game.level?.flags || {};
    const coder = spl.coder;
    for (let i = 0; i < args.length; i++) {
        const s = String(args[i]).toLowerCase();

        if (s === 'noteleport') flags.noteleport = 1;
        else if (s === 'hardfloor') flags.hardfloor = 1;
        else if (s === 'nommap') flags.nommap = 1;
        else if (s === 'shortsighted') flags.shortsighted = 1;
        else if (s === 'arboreal') flags.arboreal = 1;
        else if (s === 'mazelevel') flags.is_maze_lev = 1;
        else if (s === 'shroud') flags.hero_memory = 1;
        else if (s === 'graveyard') flags.graveyard = 1;
        else if (s === 'icedpools') spl.icedpools = 1;
        else if (s === 'corrmaze') flags.corrmaze = 1;
        else if (s === 'premapped') coder.premapped = 1;
        else if (s === 'solidify') coder.solidify = 1;
        else if (s === 'sokoban') flags.sokoban_rules = 1;
        else if (s === 'inaccessibles') coder.check_inaccessibles = 1;
        else if (s === 'noflipx') coder.allow_flips &= ~2;
        else if (s === 'noflipy') coder.allow_flips &= ~1;
        else if (s === 'noflip') coder.allow_flips = 0;
        else if (s === 'temperate') flags.temperature = 0;
        else if (s === 'hot') flags.temperature = 1;
        else if (s === 'cold') flags.temperature = -1;
        else if (s === 'nomongen') flags.rndmongen = 0;
        else if (s === 'nodeathdrops') flags.deathdrops = 0;
        else if (s === 'noautosearch') flags.noautosearch = 1;
        else if (s === 'fumaroles') flags.fumaroles = 1;
        else if (s === 'stormy') flags.stormy = 1;
        else nhl_error(`Unknown level flag ${args[i]}`);
    }

    return 0;
}

// C ref: sp_lev.c:3836 lspo_level_init() -- des.level_init({ style = ... }).
// Every get_table_* here is RNG-free; splev_initlev() does the drawing.
const INITSTYLES = ['solidfill', 'mazegrid', 'maze', 'rogue', 'mines', 'swamp'];
export function lspo_level_init(t) {
    const initstyles2i = [LVLINIT_SOLIDFILL, LVLINIT_MAZEGRID, LVLINIT_MAZE,
                          LVLINIT_ROGUE, LVLINIT_MINES, LVLINIT_SWAMP, 0];
    const init_lev = {};

    create_des_coder();

    t = lcheck_param_table(t);

    spl.splev_init_present = true;

    init_lev.init_style
        = initstyles2i[get_table_option(t, 'style', 'solidfill', INITSTYLES)];
    init_lev.fg = get_table_mapchr_opt(t, 'fg', ROOM);
    init_lev.bg = get_table_mapchr_opt(t, 'bg', INVALID_TYPE);
    init_lev.smoothed = get_table_boolean_opt(t, 'smoothed', false);
    init_lev.joined = get_table_boolean_opt(t, 'joined', false);
    init_lev.lit = get_table_boolean_opt(t, 'lit', BOOL_RANDOM);
    init_lev.walled = get_table_boolean_opt(t, 'walled', false);
    init_lev.filling = get_table_mapchr_opt(t, 'filling', init_lev.fg);
    init_lev.corrwid = get_table_int_opt(t, 'corrwid', -1);
    init_lev.wallthick = get_table_int_opt(t, 'wallthick', -1);
    init_lev.rm_deadends = !get_table_boolean_opt(t, 'deadends', true);

    spl.coder.lvl_is_joined = init_lev.joined;

    if (init_lev.bg === INVALID_TYPE)
        init_lev.bg = (init_lev.init_style === LVLINIT_SWAMP) ? MOAT : STONE;

    splev_initlev(init_lev);

    return 0;
}

// C ref: sp_lev.c:3880 lspo_engraving() -- des.engraving().  The only draws
// come from get_location_coord() for a random position.
const ENGRTYPES = ['dust', 'engrave', 'burn', 'mark', 'blood'];
export function lspo_engraving(...args) {
    const engrtypes2i = [DUST, ENGRAVE, BURN, MARK, ENGR_BLOOD, 0];
    let etyp = DUST;
    let txt = null;
    let ecoord;
    const xy = { x: -1, y: -1 };
    const argc = args.length;
    let guardobjs = false;
    let wipeout = true;

    create_des_coder();

    if (argc === 1) {
        const t = lcheck_param_table(args[0]);

        get_table_xy_or_coord(t, xy);
        etyp = engrtypes2i[get_table_option(t, 'type', 'engrave', ENGRTYPES)];
        txt = get_table_str(t, 'text');
        wipeout = get_table_boolean_opt(t, 'degrade', true);
        guardobjs = get_table_boolean_opt(t, 'guardobjects', false);
    } else if (argc === 3) {
        get_coord(args[0], xy);
        const i = ENGRTYPES.indexOf(String(args[1]));
        if (i < 0) nhl_error(`invalid option '${args[1]}'`);
        etyp = engrtypes2i[i];
        txt = String(args[2]);
    } else {
        nhl_error('Wrong parameters');
    }

    if (xy.x === -1 && xy.y === -1) ecoord = SP_COORD_PACK_RANDOM(0);
    else ecoord = SP_COORD_PACK(xy.x, xy.y);

    get_location_coord(xy, DRY, spl.coder?.croom, ecoord);
    make_engr_at(xy.x, xy.y, txt, null, 0, etyp);
    const ep = engr_at(xy.x, xy.y);
    if (ep) {
        ep.guardobjects = guardobjs;
        ep.nowipeout = !wipeout;
    }
    return 0;
}

// C ref: sp_lev.c:3938 -- des.mineralize(); -1 in any field keeps the default.
export function lspo_mineralize(t) {
    create_des_coder();

    t = lcheck_param_table(t);
    const gem_prob = get_table_int_opt(t, 'gem_prob', -1);
    const gold_prob = get_table_int_opt(t, 'gold_prob', -1);
    const kelp_moat = get_table_int_opt(t, 'kelp_moat', -1);
    const kelp_pool = get_table_int_opt(t, 'kelp_pool', -1);

    EXT.mineralize(kelp_pool, kelp_moat, gold_prob, gem_prob, true);

    return 0;
}

// C ref: sp_lev.c:3957 room_types[] -- the des.room()/des.region() `type =`
// names.  Order matters: get_table_roomtype_opt() takes the first match.
const room_types = [
    ['ordinary', OROOM], ['themed', THEMEROOM], ['throne', COURT],
    ['swamp', SWAMP], ['vault', VAULT], ['beehive', BEEHIVE],
    ['morgue', MORGUE], ['barracks', BARRACKS], ['zoo', ZOO],
    ['delphi', DELPHI], ['temple', TEMPLE], ['anthole', ANTHOLE],
    ['cocknest', COCKNEST], ['leprehall', LEPREHALL], ['shop', SHOPBASE],
    ['armor shop', ARMORSHOP], ['scroll shop', SCROLLSHOP],
    ['potion shop', POTIONSHOP], ['weapon shop', WEAPONSHOP],
    ['food shop', FOODSHOP], ['ring shop', RINGSHOP], ['wand shop', WANDSHOP],
    ['tool shop', TOOLSHOP], ['book shop', BOOKSHOP],
    ['health food shop', FODDERSHOP], ['candle shop', CANDLESHOP],
];

// C ref: sp_lev.c:3990 -- rtype -> name, for the room table handed to a
// contents() callback.  Returns "unknown" (never NULL) for an unlisted rtype.
export function get_mkroom_name(rtype) {
    for (const [name, type] of room_types) if (type === rtype) return name;
    return 'unknown';                      /* C: impossible() first */
}

// C ref: sp_lev.c:4003 -- `type = "beehive"`.  An unknown name keeps defval.
export function get_table_roomtype_opt(t, name, defval) {
    const roomstr = get_table_str_opt(t, name, '');
    let res = defval;

    if (roomstr && roomstr.length) {
        let found = false;
        for (const [rn, type] of room_types)
            if (rn.toLowerCase() === roomstr.toLowerCase()) {
                res = type;
                found = true;
                break;
            }
        if (!found) { /* C: impossible("Unknown room type '%s'") */ }
    }
    return res;
}

// C ref: sp_lev.c:4027 lspo_room() -- des.room().  build_room() does the
// drawing; note the rn2(100) `chance` roll happens inside build_room, AFTER
// every get_table_* here.
const L_OR_R = ['left', 'half-left', 'center', 'half-right', 'right',
                'none', 'random'];
const T_OR_B = ['top', 'center', 'bottom', 'none', 'random'];
export function lspo_room(t) {
    create_des_coder();

    if (game.in_mk_themerooms && game.themeroom_failed) return 0;

    t = lcheck_param_table(t);

    const coder = spl.coder;
    if (coder.n_subroom > MAX_NESTED_ROOMS) {
        return 0;                          /* C: panic("Too deeply nested") */
    } else {
        const l_or_r2i = [C_SPLEV_LEFT, C_SPLEV_H_LEFT, C_SPLEV_CENTER,
                          C_SPLEV_H_RIGHT, C_SPLEV_RIGHT, -1, -1, -1];
        const t_or_b2i = [C_TOP, C_SPLEV_CENTER, C_BOTTOM, -1, -1, -1];
        const tmproom = {};
        const xy = { x: -1, y: -1 };

        get_table_xy_or_coord(t, xy);
        tmproom.x = xy.x; tmproom.y = xy.y;
        if ((tmproom.x === -1 || tmproom.y === -1) && tmproom.x !== tmproom.y)
            nhl_error('Room must have both x and y');

        tmproom.w = get_table_int_opt(t, 'w', -1);
        tmproom.h = get_table_int_opt(t, 'h', -1);

        if ((tmproom.w === -1 || tmproom.h === -1) && tmproom.w !== tmproom.h)
            nhl_error('Room must have both w and h');

        tmproom.xalign = l_or_r2i[get_table_option(t, 'xalign', 'random', L_OR_R)];
        tmproom.yalign = t_or_b2i[get_table_option(t, 'yalign', 'random', T_OR_B)];
        tmproom.rtype = get_table_roomtype_opt(t, 'type', OROOM);
        tmproom.chance = get_table_int_opt(t, 'chance', 100);
        tmproom.rlit = get_table_int_opt(t, 'lit', -1);
        /* theme rooms default to unfilled */
        tmproom.needfill = get_table_int_opt(t, 'filled',
                                             game.in_mk_themerooms ? 0 : 1);
        tmproom.joined = get_table_boolean_opt(t, 'joined', true);

        if (!coder.failed_room[coder.n_subroom - 1]) {
            const tmpcr = build_room(tmproom, coder.croom);
            if (tmpcr) {
                const n = coder.n_subroom;

                coder.tmproomlist[n] = tmpcr;
                coder.failed_room[n] = false;
                /* added a subroom, make the parent room irregular */
                if (coder.tmproomlist[n - 1]) coder.tmproomlist[n - 1].irregular = true;
                coder.n_subroom++;
                update_croom();
                if (typeof t.contents === 'function')
                    t.contents(l_push_mkroom_table(null, tmpcr));
                spo_endroom(coder);
                add_doors_to_room(tmpcr);
                return 0;
            }
            if (game.in_mk_themerooms) game.themeroom_failed = true;
        } /* failed to create the parent room, so fail this too */
    }
    coder.tmproomlist[coder.n_subroom] = null;
    coder.failed_room[coder.n_subroom] = true;
    coder.n_subroom++;
    update_croom();
    spo_endroom(coder);
    if (game.in_mk_themerooms) game.themeroom_failed = true;

    return 0;
}

// C ref: sp_lev.c:4118 -- pop one nesting level; at the top level, make sure
// xstart/ystart/xsize/ysize are sane for anything created outside a MAP.
export function spo_endroom(coder) {
    const c = spl.coder;
    if (c.n_subroom > 1) {
        c.n_subroom--;
        c.tmproomlist[c.n_subroom] = null;
        c.failed_room[c.n_subroom] = true;
    } else {
        if (gx.xsize <= 1 && gy.ysize <= 1) reset_xystart_size();
    }
    update_croom();
}

// C ref: sp_lev.c:4138 -- is_ok_location callback: a randomly placed stairway
// must not overwrite special terrain.
export function good_stair_loc(x, y) {
    const typ = levl_typ(x, y);

    return (typ === ROOM || typ === CORR || typ === ICE);
}

// C ref: sp_lev.c:4146 l_create_stairway(L, using_ladder) -- the shared guts of
// des.stair() and des.ladder().  set_ok_location_func(good_stair_loc) is
// installed only for a RANDOM position, and cleared straight after; it changes
// which squares get_location() accepts, so it changes how many draws the
// search costs.
const STAIRDIRS = ['down', 'up'];
export function l_create_stairway(args, using_ladder) {
    const stairdirs2i = [0, 1];
    const argc = args.length;
    const xy = { x: -1, y: -1 };
    let scoord;
    let up = 0;                            /* default is down */

    create_des_coder();

    if (argc === 1 && typeof args[0] === 'object' && args[0] !== null) {
        const t = lcheck_param_table(args[0]);
        get_table_xy_or_coord(t, xy);
        up = stairdirs2i[get_table_option(t, 'dir', 'down', STAIRDIRS)];
    } else {
        let rest = args;
        if (argc > 0 && typeof args[0] === 'string') {
            const i = STAIRDIRS.indexOf(args[0]);
            if (i < 0) nhl_error(`invalid option '${args[0]}'`);
            up = stairdirs2i[i];
            rest = args.slice(1);
        }
        /* C: nhl_get_xy_params() -- (x,y) or ({x,y}) or nothing */
        if (rest.length >= 2) { xy.x = Math.trunc(rest[0]); xy.y = Math.trunc(rest[1]); }
        else if (rest.length === 1) get_coord(rest[0], xy);
    }

    if (xy.x === -1 && xy.y === -1) {
        set_ok_location_func(good_stair_loc);
        scoord = SP_COORD_PACK_RANDOM(0);
    } else {
        scoord = SP_COORD_PACK(xy.x, xy.y);
    }

    get_location_coord(xy, DRY, spl.coder?.croom, scoord);
    set_ok_location_func(null);
    const badtrap = t_at(xy.x, xy.y);
    if (badtrap) deltrap(badtrap);
    splev_map_mark(xy.x, xy.y);

    const loc = levl_at(xy.x, xy.y);
    if (using_ladder) {
        if (loc) loc.typ = LADDER;
        const uz = game.u?.uz;
        if (up) {
            const dest = { dnum: uz?.dnum, dlevel: (uz?.dlevel ?? 0) - 1 };
            EXT.stairway_add(xy.x, xy.y, true, true, dest);
            if (loc) loc.ladder = LA_UP;
        } else {
            const dest = { dnum: uz?.dnum, dlevel: (uz?.dlevel ?? 0) + 1 };
            EXT.stairway_add(xy.x, xy.y, false, true, dest);
            if (loc) loc.ladder = LA_DOWN;
        }
    } else {
        EXT.mkstairs(xy.x, xy.y, up, spl.coder?.croom,
                     !(scoord & SP_COORD_IS_RANDOM));
    }
    return 0;
}

// C ref: sp_lev.c:4222 / :4231 -- des.stair() / des.ladder().
export function lspo_stair(...args) { return l_create_stairway(args, false); }
export function lspo_ladder(...args) { return l_create_stairway(args, true); }

// C ref: sp_lev.c:4242 lspo_grave() -- des.grave().  A grave is skipped
// entirely when the square already holds a trap, but the location draw has
// already happened by then.
export function lspo_grave(...args) {
    const argc = args.length;
    const xy = { x: -1, y: -1 };
    let scoord;
    let txt;

    create_des_coder();

    if (argc === 3) {
        xy.x = Math.trunc(args[0]);
        xy.y = Math.trunc(args[1]);
        txt = String(args[2]);
    } else {
        const t = lcheck_param_table(args[0]);

        get_table_xy_or_coord(t, xy);
        txt = get_table_str_opt(t, 'text', null);
    }

    if (xy.x === -1 && xy.y === -1) scoord = SP_COORD_PACK_RANDOM(0);
    else scoord = SP_COORD_PACK(xy.x, xy.y);

    get_location_coord(xy, DRY, spl.coder?.croom, scoord);

    if (isok(xy.x, xy.y) && !t_at(xy.x, xy.y)) {
        const loc = levl_at(xy.x, xy.y);
        if (loc) loc.typ = GRAVE;
        make_grave(xy.x, xy.y, txt);       /* note: 'txt' might be Null */
    }
    return 0;
}

// C ref: sp_lev.c:4282 lspo_altar() -- des.altar().
const SHRINES = ['altar', 'shrine', 'sanctum'];
export function lspo_altar(t) {
    const shrines2i = [0, 1, 2, 0];
    const tmpaltar = {};
    const xy = { x: -1, y: -1 };
    let acoord;

    create_des_coder();

    t = lcheck_param_table(t);

    get_table_xy_or_coord(t, xy);

    const al = get_table_align(t);
    const shrine = shrines2i[get_table_option(t, 'type', 'altar', SHRINES)];

    if (xy.x === -1 && xy.y === -1) acoord = SP_COORD_PACK_RANDOM(0);
    else acoord = SP_COORD_PACK(xy.x, xy.y);

    tmpaltar.coord = acoord;
    tmpaltar.sp_amask = al;
    tmpaltar.shrine = shrine;

    create_altar(tmpaltar, spl.coder?.croom);

    return 0;
}

// C ref: sp_lev.c:4320 trap_types[] -- des.trap() names.  "random" is -1,
// which create_trap passes straight to mktrap().
const trap_types = [
    ['arrow', ARROW_TRAP], ['dart', DART_TRAP], ['falling rock', ROCKTRAP],
    ['board', SQKY_BOARD], ['bear', BEAR_TRAP], ['land mine', LANDMINE],
    ['rolling boulder', ROLLING_BOULDER_TRAP], ['sleep gas', SLP_GAS_TRAP],
    ['rust', RUST_TRAP], ['fire', FIRE_TRAP], ['pit', PIT],
    ['spiked pit', SPIKED_PIT], ['hole', HOLE], ['trap door', TRAPDOOR],
    ['teleport', TELEP_TRAP], ['level teleport', LEVEL_TELEP],
    ['magic portal', MAGIC_PORTAL], ['web', WEB], ['statue', STATUE_TRAP],
    ['magic', MAGIC_TRAP], ['anti magic', ANTI_MAGIC], ['polymorph', POLY_TRAP],
    ['vibrating square', VIBRATING_SQUARE], ['random', -1],
];

// C ref: sp_lev.c:4349 -- `type = "web"`.  An unknown name keeps defval (which
// lspo_trap passes as -1, i.e. random), it does NOT error.
export function get_table_traptype_opt(t, name, defval) {
    const trapstr = get_table_str_opt(t, name, '');
    let res = defval;

    if (trapstr && trapstr.length)
        for (const [tn, type] of trap_types)
            if (tn.toLowerCase() === trapstr.toLowerCase()) { res = type; break; }
    return res;
}

// C ref: sp_lev.c:4366 -- ttyp -> des.trap() name, or NULL.
export function get_trapname_bytype(ttyp) {
    for (const [tn, type] of trap_types) if (ttyp === type) return tn;
    return null;
}

// C ref: sp_lev.c:4378 -- des.trap() name -> ttyp, NO_TRAP when unknown.
export function get_traptype_byname(trapname) {
    for (const [tn, type] of trap_types)
        if (tn.toLowerCase() === String(trapname).toLowerCase()) return type;
    return NO_TRAP;
}

// C ref: sp_lev.c:4396 lspo_trap() -- des.trap().  Note the C bug kept
// verbatim: the "teledest" table writes gl.launchplace, same as "launchfrom".
export function lspo_trap(...args) {
    const tmptrap = {};
    const xy = { x: -1, y: -1 };
    const argc = args.length;

    create_des_coder();

    tmptrap.spider_on_web = true;
    tmptrap.seen = false;
    tmptrap.novictim = false;

    if (argc === 1 && typeof args[0] === 'string') {
        tmptrap.type = get_traptype_byname(args[0]);
        xy.x = xy.y = -1;
    } else if (argc === 2 && typeof args[0] === 'string'
               && typeof args[1] === 'object') {
        tmptrap.type = get_traptype_byname(args[0]);
        get_coord(args[1], xy);
    } else if (argc === 3) {
        tmptrap.type = get_traptype_byname(args[0]);
        xy.x = Math.trunc(args[1]);
        xy.y = Math.trunc(args[2]);
    } else {
        const t = lcheck_param_table(args[0]);

        get_table_xy_or_coord(t, xy);
        tmptrap.type = get_table_traptype_opt(t, 'type', -1);
        tmptrap.spider_on_web = get_table_boolean_opt(t, 'spider_on_web', 1);
        tmptrap.seen = get_table_boolean_opt(t, 'seen', false);
        tmptrap.novictim = !get_table_boolean_opt(t, 'victim', true);

        if (t.launchfrom != null && typeof t.launchfrom === 'object') {
            const lc = { x: -1, y: -1 };
            get_coord(t.launchfrom, lc);
            game.launchplace = { x: lc.x, y: lc.y };
        }
        if (t.teledest != null && typeof t.teledest === 'object') {
            const lc = { x: -1, y: -1 };
            get_coord(t.teledest, lc);
            game.launchplace = { x: lc.x, y: lc.y };
        }
    }

    if (tmptrap.type === NO_TRAP) nhl_error('Unknown trap type');

    if (xy.x === -1 && xy.y === -1) tmptrap.coord = SP_COORD_PACK_RANDOM(0);
    else tmptrap.coord = SP_COORD_PACK(xy.x, xy.y);

    create_trap(tmptrap, spl.coder?.croom);
    game.launchplace = { x: 0, y: 0 };

    return 0;
}

// C ref: sp_lev.c:4479 lspo_gold() -- des.gold().  `amount < 0` costs an
// rnd(200), and it is drawn AFTER the location.
export function lspo_gold(...args) {
    const argc = args.length;
    const xy = { x: -1, y: -1 };
    let amount;
    let gcoord;

    create_des_coder();

    if (argc === 3) {
        amount = Math.trunc(args[0]);
        xy.x = Math.trunc(args[1]);
        xy.y = Math.trunc(args[2]);
    } else if (argc === 2 && typeof args[1] === 'object') {
        amount = Math.trunc(args[0]);
        get_coord(args[1], xy);
    } else if (argc === 0 || (argc === 1 && typeof args[0] === 'object')) {
        const t = lcheck_param_table(args[0]);

        amount = get_table_int_opt(t, 'amount', -1);
        get_table_xy_or_coord(t, xy);
    } else {
        nhl_error('Wrong parameters');
        return 0;
    }

    if (xy.x === -1 && xy.y === -1) gcoord = SP_COORD_PACK_RANDOM(0);
    else gcoord = SP_COORD_PACK(xy.x, xy.y);

    get_location_coord(xy, DRY, spl.coder?.croom, gcoord);
    if (amount < 0) amount = rnd(200);
    mkgold(amount, xy.x, xy.y);

    return 0;
}

// C ref: sp_lev.c:4528 lspo_corridor() -- des.corridor().
const WALLDIRS_TBL = ['all', 'random', 'north', 'west', 'east', 'south'];
export function lspo_corridor(t) {
    const walldirs2i = [W_ANY, W_RANDOM, W_NORTH, W_WEST, W_EAST, W_SOUTH, 0];
    const tc = { src: {}, dest: {} };

    create_des_coder();

    t = lcheck_param_table(t);

    tc.src.room = get_table_int(t, 'srcroom');
    tc.src.door = get_table_int(t, 'srcdoor');
    tc.src.wall = walldirs2i[get_table_option(t, 'srcwall', 'all', WALLDIRS_TBL)];
    tc.dest.room = get_table_int(t, 'destroom');
    tc.dest.door = get_table_int(t, 'destdoor');
    tc.dest.wall = walldirs2i[get_table_option(t, 'destwall', 'all', WALLDIRS_TBL)];

    create_corridor(tc);

    return 0;
}

// C ref: sp_lev.c:4557 -- des.random_corridors(): all -1, which makes
// create_corridor() fall through to makecorridors().
export function lspo_random_corridors() {
    const tc = { src: {}, dest: {} };

    create_des_coder();

    tc.src.room = -1;
    tc.src.door = -1;
    tc.src.wall = -1;
    tc.dest.room = -1;
    tc.dest.door = -1;
    tc.dest.wall = -1;

    create_corridor(tc);

    return 0;
}

// C ref: drawing.c def_oc_syms[] / def_char_to_objclass().  js/readobjnam.js
// and js/invent.js each already carry a module-local copy of this three-line
// reverse lookup and neither exports it; this is the third, kept local for the
// same reason.  Accepts a char or a char code (sp_lev.c stores object classes
// as `char`s in an int field).
const DEF_OC_SYMS = ['\0', ']', ')', '[', '=', '"', '(', '%', '!', '?', '+',
                     '/', '$', '*', '`', '0', '_', '.'];
function def_char_to_objclass(ch) {
    const c = (typeof ch === 'number') ? String.fromCharCode(ch) : String(ch);
    const i = DEF_OC_SYMS.indexOf(c);
    return i < 0 ? MAXOCLASSES : i;
}

// C ref: sp_lev.c:4586 / :4592 / :4599 -- the selection flood-fill predicates.
// set_floodfillchk_match_under() latches the terrain to match, then installs
// the checker, so the two must not be reordered.
export function floodfillchk_match_under(x, y) {
    return (spl.floodfillchk_match_under_typ === levl_typ(x, y)) ? 1 : 0;
}

export function set_floodfillchk_match_under(typ) {
    spl.floodfillchk_match_under_typ = typ;
    EXT.set_selection_floodfillchk(floodfillchk_match_under);
}

export function floodfillchk_match_accessible(x, y) {
    const typ = levl_typ(x, y);
    return (ACCESSIBLE(typ) || typ === SDOOR || typ === SCORR) ? 1 : 0;
}

// C ref: sp_lev.c:4632 -- des.feature() setter.  Existing furniture wins.
export function sel_set_feature(x, y, typ) {
    if (!isok(x, y)) return;
    const loc = levl_at(x, y);
    if (!loc) return;
    if (IS_FURNITURE(loc.typ)) return;
    loc.typ = typ;
}

// C ref: sp_lev.c:4646 -- des.door() setter for an explicit coordinate.  Note
// D_SECRET is stripped from the doormask after choosing SDOOR, and a secret
// door is never left "no door".
export function sel_set_door(dx, dy, typ) {
    const x = dx, y = dy;
    const loc = levl_at(x, y);
    if (!loc) return;

    if (!IS_DOOR(loc.typ) && loc.typ !== SDOOR)
        loc.typ = (typ & D_SECRET) ? SDOOR : DOOR;
    if (typ & D_SECRET) {
        typ &= ~D_SECRET;
        if (typ < D_CLOSED) typ = D_CLOSED;
    }
    set_door_orientation(x, y);       /* set/clear levl[x][y].horizontal */
    loc.doormask = typ;
    splev_map_mark(x, y);
}

// C ref: sp_lev.c:4670 lspo_door() -- des.door().  The rnddoor() rn2(5) for
// state="random" is drawn BEFORE the wall/pos lookup, and it is drawn even on
// the x/y branch where only its D_SECRET bit is used.
const DOORSTATES_TBL = ['random', 'open', 'closed', 'locked', 'nodoor',
                        'broken', 'secret'];
export function lspo_door(...args) {
    const doorstates2i = [-1, D_ISOPEN, D_CLOSED, D_LOCKED, D_NODOOR,
                          0x01 /* D_BROKEN */, D_SECRET];
    let msk;
    const xy = { x: -1, y: -1 };
    let t = null;
    const argc = args.length;

    create_des_coder();

    if (argc === 3) {
        const i = DOORSTATES_TBL.indexOf(String(args[0]));
        if (i < 0) nhl_error(`invalid option '${args[0]}'`);
        msk = doorstates2i[i];
        xy.x = Math.trunc(args[1]);
        xy.y = Math.trunc(args[2]);
    } else {
        t = lcheck_param_table(args[0]);

        get_table_xy_or_coord(t, xy);
        msk = doorstates2i[get_table_option(t, 'state', 'random', DOORSTATES_TBL)];
    }

    const typ = (msk === -1) ? rnddoor() : msk;

    if (xy.x === -1 && xy.y === -1) {
        /* Note that "random" is also W_ANY: create_door just wants a mask of
           acceptable walls. */
        const walldirs2i = [W_ANY, W_ANY, W_NORTH, W_WEST, W_EAST, W_SOUTH, 0];
        const tmpd = {};

        tmpd.secret = (typ === D_SECRET) ? 1 : 0;
        tmpd.mask = msk;
        tmpd.pos = get_table_int_opt(t, 'pos', -1);
        tmpd.wall = walldirs2i[get_table_option(t, 'wall', 'all', WALLDIRS_TBL)];

        create_door(tmpd, spl.coder?.croom);
    } else {
        get_location_coord(xy, ANY_LOC, spl.coder?.croom,
                           SP_COORD_PACK(xy.x, xy.y));
        if (!isok(xy.x, xy.y)) {
            nhl_error('door coord not ok');
            return 0;
        }
        sel_set_door(xy.x, xy.y, typ);
    }

    return 0;
}

// C ref: sp_lev.c:4738 -- des.feature()'s optional boolean flags.  -2 means
// "the table did not mention it"; -1 ("random") costs one rn2(2).
export function l_table_getset_feature_flag(t, x, y, name, flag) {
    const val0 = get_table_boolean_opt(t, name, -2);

    if (val0 !== -2) {
        let val = val0;
        if (val === -1) val = rn2(2);
        const loc = levl_at(x, y);
        if (!loc) return;
        if (val) loc.flags = (loc.flags || 0) | flag;
        else loc.flags = (loc.flags || 0) & ~flag;
    }
}

// C ref: sp_lev.c:4771 / :4792 -- map- or room-relative <-> absolute.  `c` is
// the {x,y} pair C passes by pointer.  NOT for coordinates headed into the
// get_location() family: those add the origin themselves.
export function cvt_to_abscoord(c) {
    if (spl.coder && spl.coder.croom) {
        c.x += spl.coder.croom.lx;
        c.y += spl.coder.croom.ly;
    } else {
        c.x += gx.xstart;
        c.y += gy.ystart;
    }
}

export function cvt_to_relcoord(c) {
    if (spl.coder && spl.coder.croom) {
        c.x -= spl.coder.croom.lx;
        c.y -= spl.coder.croom.ly;
    } else {
        c.x -= gx.xstart;
        c.y -= gy.ystart;
    }
}

// C ref: sp_lev.c:4810 -- nh.abscoord(rx, ry) or nh.abscoord({x=,y=}).
export function nhl_abs_coord(...args) {
    const argc = args.length;
    const c = { x: -1, y: -1 };

    if (argc === 2) {
        c.x = Math.trunc(args[0]);
        c.y = Math.trunc(args[1]);
        cvt_to_abscoord(c);
        return [c.x, c.y];
    } else if (argc === 1 && typeof args[0] === 'object' && args[0] !== null) {
        c.x = get_table_int(args[0], 'x');
        c.y = get_table_int(args[0], 'y');
        cvt_to_abscoord(c);
        return { x: c.x, y: c.y };
    }
    nhl_error('nhl_abs_coord: Wrong args');
    return 0;
}

// C ref: sp_lev.c:4843 lspo_feature() -- des.feature().  A feature with no
// coordinate uses DRY (a plain floor square); an explicit one uses ANY_LOC
// ("assume the author knows what they're doing"), so the two forms cost
// different numbers of draws.
const FEATURES = ['fountain', 'sink', 'pool', 'throne', 'tree'];
export function lspo_feature(...args) {
    const features2i = [FOUNTAIN, SINK, POOL, THRONE, TREE, STONE];
    const xy = { x: -1, y: -1 };
    let typ;
    const argc = args.length;
    let can_have_flags = false;
    let fcoord, humidity;
    let t = null;

    create_des_coder();

    if (argc === 1 && typeof args[0] === 'string') {
        const i = FEATURES.indexOf(args[0]);
        if (i < 0) nhl_error(`invalid option '${args[0]}'`);
        typ = features2i[i];
        xy.x = xy.y = -1;
    } else if (argc === 2 && typeof args[0] === 'string'
               && typeof args[1] === 'object') {
        const i = FEATURES.indexOf(args[0]);
        if (i < 0) nhl_error(`invalid option '${args[0]}'`);
        typ = features2i[i];
        get_coord(args[1], xy);
    } else if (argc === 3) {
        const i = FEATURES.indexOf(args[0]);
        if (i < 0) nhl_error(`invalid option '${args[0]}'`);
        typ = features2i[i];
        xy.x = Math.trunc(args[1]);
        xy.y = Math.trunc(args[2]);
    } else {
        t = lcheck_param_table(args[0]);

        get_table_xy_or_coord(t, xy);
        typ = features2i[get_table_option(t, 'type', null, FEATURES)];
        can_have_flags = true;
    }

    if (xy.x === -1 && xy.y === -1) {
        fcoord = SP_COORD_PACK_RANDOM(0);
        humidity = DRY;   /* a regular space, no rock or other furniture */
    } else {
        fcoord = SP_COORD_PACK(xy.x, xy.y);
        humidity = ANY_LOC;
    }
    get_location_coord(xy, humidity, spl.coder?.croom, fcoord);

    if (typ === STONE) {
        /* C: impossible("feature has unknown type param.") */
    } else {
        sel_set_feature(xy.x, xy.y, typ);
    }

    if (levl_typ(xy.x, xy.y) !== typ || !can_have_flags) return 0;

    switch (typ) {
    default:
        break;
    case FOUNTAIN:
        l_table_getset_feature_flag(t, xy.x, xy.y, 'looted', F_LOOTED);
        l_table_getset_feature_flag(t, xy.x, xy.y, 'warned', F_WARNED);
        break;
    case SINK:
        l_table_getset_feature_flag(t, xy.x, xy.y, 'pudding', S_LPUDDING);
        l_table_getset_feature_flag(t, xy.x, xy.y, 'dishwasher', S_LDWASHER);
        l_table_getset_feature_flag(t, xy.x, xy.y, 'ring', S_LRING);
        break;
    case THRONE:
        l_table_getset_feature_flag(t, xy.x, xy.y, 'looted', T_LOOTED);
        break;
    case TREE:
        l_table_getset_feature_flag(t, xy.x, xy.y, 'looted', TREE_LOOTED);
        l_table_getset_feature_flag(t, xy.x, xy.y, 'swarm', TREE_SWARM);
        break;
    }

    return 0;
}

// C ref: sp_lev.c:4928 lspo_gas_cloud() -- des.gas_cloud().  Where C unwraps a
// Lua selection userdata with l_selection_check(), the JS caller passes the
// selectionvar itself.  js/region.js create_gas_cloud() is async in this port
// (it drives the display), so the ttl override is sequenced behind it; the
// selection form is synchronous.
export function lspo_gas_cloud(t) {
    let x = 0, y = 0;
    let sel = null;
    let damage = 0;
    let ttl = -2;

    create_des_coder();

    if (t != null && typeof t === 'object') {
        const xy = { x: -1, y: -1 };
        let reg;

        t = lcheck_param_table(t);

        get_table_xy_or_coord(t, xy);
        x = xy.x; y = xy.y;
        if (xy.x === -1 && xy.y === -1) sel = t.selection || null;
        damage = get_table_int_opt(t, 'damage', 0);
        ttl = get_table_int_opt(t, 'ttl', -2);
        if (!sel) reg = create_gas_cloud(x, y, 1, damage);
        else reg = create_gas_cloud_selection(sel, damage);
        if (ttl > -2 && reg) {
            if (typeof reg.then === 'function') reg.then((r) => { if (r) r.ttl = ttl; });
            else reg.ttl = ttl;
        }
    } else {
        nhl_error('wrong parameters');
    }

    return 0;
}

// C ref: sp_lev.c:4977 lspo_terrain() -- des.terrain().  The existing
// sel_set_ter() in this file implements set_levltyp_lit() only; C additionally
// closes a new SDOOR, orients a door against its left neighbour, sets
// icedpool on ICE and wipes engravings under a CLOUD.  Left as-is here rather
// than duplicated: fixing it belongs in that function, in its own change.
export function lspo_terrain(...args) {
    const tmpterrain = { tlit: SET_LIT_NOCHANGE, ter: INVALID_TYPE };
    const xy = { x: 0, y: 0 };
    let sel = null;
    const argc = args.length;

    create_des_coder();

    if (argc === 1) {
        const t = lcheck_param_table(args[0]);
        const c = { x: -1, y: -1 };

        get_table_xy_or_coord(t, c);
        xy.x = c.x; xy.y = c.y;
        if (c.x === -1 && c.y === -1) sel = t.selection || null;
        tmpterrain.ter = get_table_mapchr(t, 'typ');
        tmpterrain.tlit = get_table_int_opt(t, 'lit', SET_LIT_NOCHANGE);
    } else if (argc === 2 && typeof args[0] === 'object'
               && typeof args[1] === 'string') {
        const c = { x: -1, y: -1 };
        tmpterrain.ter = check_mapchr(args[1]);
        get_coord(args[0], c);
        xy.x = c.x; xy.y = c.y;
    } else if (argc === 2) {
        sel = args[0];
        tmpterrain.ter = check_mapchr(args[1]);
    } else if (argc === 3) {
        xy.x = Math.trunc(args[0]);
        xy.y = Math.trunc(args[1]);
        tmpterrain.ter = check_mapchr(args[2]);
    } else {
        nhl_error('wrong parameters');
    }

    if (tmpterrain.ter === INVALID_TYPE) nhl_error('Erroneous map char');

    if (sel) {
        selection_iterate(sel, (sx, sy) => sel_set_ter(sx, sy, tmpterrain));
    } else {
        get_location_coord(xy, ANY_LOC, spl.coder?.croom,
                           SP_COORD_PACK(xy.x, xy.y));
        if (!isok(xy.x, xy.y)) {
            nhl_error('terrain coord not ok');
            return 0;
        }
        sel_set_ter(xy.x, xy.y, tmpterrain);
    }

    return 0;
}

// C ref: sp_lev.c:5145 generate_way_out_method(nx, ny, ov) -- make a walled-off
// pocket reachable.  Three escalating attempts, in this order: a secret door
// (one selection_rndcoord draw per candidate square, consumed destructively), a
// hole/trapdoor (only where the level allows falling), then one of six escape
// items via ROLL_FROM (a single rn2(6)).
const ESCAPEITEM_NAMES = ['pick-axe', 'dwarvish mattock', 'wand of digging',
                          'wand of teleportation', 'scroll of teleportation',
                          'ring of teleportation'];
export function generate_way_out_method(nx, ny, ov) {
    const escapeitems = ESCAPEITEM_NAMES.map((nm) => find_objtype(nm, -1));
    const ov2 = selection_new_var();
    let ov3;
    let res = true;
    let c;

    EXT.selection_floodfill(ov2, nx, ny, true);
    ov3 = selection_clone(ov2);

    /* try to make a secret door */
    while ((c = selection_rndcoord_var(ov3, true)) && c.x !== -1) {
        const x = c.x, y = c.y;
        if (isok(x + 1, y) && !selection_getpoint_var(x + 1, y, ov)
            && IS_WALL(levl_typ(x + 1, y))
            && isok(x + 2, y) && selection_getpoint_var(x + 2, y, ov)
            && ACCESSIBLE(levl_typ(x + 2, y))) {
            levl_at(x + 1, y).typ = SDOOR;
            return res;
        }
        if (isok(x - 1, y) && !selection_getpoint_var(x - 1, y, ov)
            && IS_WALL(levl_typ(x - 1, y))
            && isok(x - 2, y) && selection_getpoint_var(x - 2, y, ov)
            && ACCESSIBLE(levl_typ(x - 2, y))) {
            levl_at(x - 1, y).typ = SDOOR;
            return res;
        }
        if (isok(x, y + 1) && !selection_getpoint_var(x, y + 1, ov)
            && IS_WALL(levl_typ(x, y + 1))
            && isok(x, y + 2) && selection_getpoint_var(x, y + 2, ov)
            && ACCESSIBLE(levl_typ(x, y + 2))) {
            levl_at(x, y + 1).typ = SDOOR;
            return res;
        }
        if (isok(x, y - 1) && !selection_getpoint_var(x, y - 1, ov)
            && IS_WALL(levl_typ(x, y - 1))
            && isok(x, y - 2) && selection_getpoint_var(x, y - 2, ov)
            && ACCESSIBLE(levl_typ(x, y - 2))) {
            levl_at(x, y - 1).typ = SDOOR;
            return res;
        }
    }

    /* try to make a hole or a trapdoor */
    if (Can_fall_thru(game.u?.uz)) {
        ov3 = selection_clone(ov2);
        while ((c = selection_rndcoord_var(ov3, true)) && c.x !== -1) {
            if (maketrap(c.x, c.y, rn2(2) ? HOLE : TRAPDOOR)) return res;
        }
    }

    /* generate one of the escape items */
    c = selection_rndcoord_var(ov2, false);
    if (c && c.x !== -1) {
        mksobj_at(escapeitems[rn2(escapeitems.length)], c.x, c.y, true, false);
        return res;
    }

    res = false;
    return res;
}

// C ref: sp_lev.c:5216 ensure_way_out() -- des.level_flags("inaccessibles").
// Flood from every same-dungeon stairway and every undestroyable/hole trap,
// then repeatedly pick the first ACCESSIBLE square still unreached and open it
// up.  (C's own comment: "needs rewrite".)
export function ensure_way_out() {
    const ov = selection_new_var();
    let ret = true;

    EXT.set_selection_floodfillchk(floodfillchk_match_accessible);

    for (const stway of (Array.isArray(game.stairs) ? game.stairs : [])) {
        if (stway.tolev?.dnum === game.u?.uz?.dnum)
            EXT.selection_floodfill(ov, stway.sx, stway.sy, true);
    }

    for (const ttmp of (game.level?.traps || [])) {
        if ((undestroyable_trap(ttmp.ttyp) || is_hole(ttmp.ttyp))
            && !selection_getpoint_var(ttmp.tx, ttmp.ty, ov))
            EXT.selection_floodfill(ov, ttmp.tx, ttmp.ty, true);
    }

    do {
        ret = true;
        let done = false;
        for (let x = 1; x < COLNO && !done; x++)
            for (let y = 0; y < ROWNO; y++)
                if (ACCESSIBLE(levl_typ(x, y))
                    && !selection_getpoint_var(x, y, ov)) {
                    if (generate_way_out_method(x, y, ov))
                        EXT.selection_floodfill(ov, x, y, true);
                    ret = false;
                    done = true;            /* C: goto outhere */
                    break;
                }
    } while (!ret);
}

// C ref: sp_lev.c:5259 -- read entry #n (1-based) of a Lua integer array.
export function get_table_intarray_entry(t, tableidx, entrynum) {
    const arr = t;
    const v = Array.isArray(arr) ? arr[entrynum - 1] : arr?.[entrynum];
    if (typeof v !== 'number')
        nhl_error(`Array entry #1 is ${typeof v}, expected number`);
    return Math.trunc(v);
}

// C ref: sp_lev.c:5281 -- `region = {x1,y1, x2,y2}`.  Exactly four entries.
// `out` is the {x1,y1,x2,y2} C fills through four pointers.
export function get_table_region(t, name, out, optional) {
    const reg = t?.[name];

    if (optional && reg == null) return 1;

    if (reg == null || typeof reg !== 'object') nhl_error('Not a region');

    const arrlen = Array.isArray(reg) ? reg.length : 0;
    if (arrlen !== 4) {
        nhl_error('Not a region');
        return 0;
    }

    out.x1 = get_table_intarray_entry(reg, -1, 1);
    out.y1 = get_table_intarray_entry(reg, -1, 2);
    out.x2 = get_table_intarray_entry(reg, -1, 3);
    out.y2 = get_table_intarray_entry(reg, -1, 4);

    return 1;
}

// C ref: sp_lev.c:5318 get_coord(L, i, &x, &y) -- accept {x=,y=} or a 2-entry
// array.  A nil value is fine (leaves *x,*y alone and returns FALSE); a
// non-table is an error.
export function get_coord(v, out) {
    let ret = false;

    if (v != null && typeof v === 'object') {
        let gotx = false;

        if (v.x != null) {
            out.x = Math.trunc(v.x);
            gotx = true;
        }

        if (gotx) {
            if (v.y != null) {
                out.y = Math.trunc(v.y);
                ret = true;
            } else {
                nhl_error('Not a coordinate');
                return false;
            }
        } else {
            const arrlen = Array.isArray(v) ? v.length : 0;
            if (arrlen !== 2) {
                nhl_error('Not a coordinate');
                return false;
            }
            out.x = get_table_intarray_entry(v, 0, 1);
            out.y = get_table_intarray_entry(v, 0, 2);
            return true;
        }
    } else if (v != null) {
        /* non-existent coord is ok; anything else is not */
        nhl_error('non-table coord specified');
    }
    return ret;
}

// C ref: sp_lev.c:5370 levregion_add(lev_region *lregion) -- register a
// teleport/stair/portal/branch region.  Coordinates that are not already
// level-absolute go through get_location(ANY_LOC), which is what adds the
// des.map() origin.
// NOTE for whoever wires this up: mklev.js's place_lregions() consumer reads a
// FLATTENED record ({rtype, lx..hy, nlx..nhy}); this is C's nested lev_region.
// The two shapes have to be reconciled at that point.
export function levregion_add(lregion) {
    if (!lregion.in_islev) {
        const a = { x: lregion.inarea.x1, y: lregion.inarea.y1 };
        get_location(a, ANY_LOC, null);
        lregion.inarea.x1 = a.x; lregion.inarea.y1 = a.y;
        const b = { x: lregion.inarea.x2, y: lregion.inarea.y2 };
        get_location(b, ANY_LOC, null);
        lregion.inarea.x2 = b.x; lregion.inarea.y2 = b.y;
    }

    if (!lregion.del_islev) {
        const a = { x: lregion.delarea.x1, y: lregion.delarea.y1 };
        get_location(a, ANY_LOC, null);
        lregion.delarea.x1 = a.x; lregion.delarea.y1 = a.y;
        const b = { x: lregion.delarea.x2, y: lregion.delarea.y2 };
        get_location(b, ANY_LOC, null);
        lregion.delarea.x2 = b.x; lregion.delarea.y2 = b.y;
    }
    if (!game.lregions) game.lregions = [];
    game.lregions.push(lregion);
    game.num_lregions = game.lregions.length;
}

// C ref: sp_lev.c:5409 -- read region, exclude and the two _islev flags out
// of the table.  A
// missing `exclude` forces exclude_islev TRUE so the -1,-1,-1,-1 rectangle
// stays safely off the map.
export function l_get_lregion(t, tmplregion) {
    const r = { x1: -1, y1: -1, x2: -1, y2: -1 };

    get_table_region(t, 'region', r, false);
    tmplregion.inarea = { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 };

    const e = { x1: -1, y1: -1, x2: -1, y2: -1 };
    get_table_region(t, 'exclude', e, true);
    tmplregion.delarea = { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 };

    tmplregion.in_islev = get_table_boolean_opt(t, 'region_islev', 0);
    tmplregion.del_islev = get_table_boolean_opt(t, 'exclude_islev', 0);

    if (e.x1 < 0) tmplregion.del_islev = true;
}

// C ref: sp_lev.c:5442 -- des.teleport_region().
const TELEDIRS = ['both', 'down', 'up'];
export function lspo_teleport_region(t) {
    const teledirs2i = [LR_TELE, LR_DOWNTELE, LR_UPTELE, -1];
    const tmplregion = {};

    create_des_coder();
    t = lcheck_param_table(t);
    l_get_lregion(t, tmplregion);
    tmplregion.rtype = teledirs2i[get_table_option(t, 'dir', 'both', TELEDIRS)];
    tmplregion.padding = 0;
    tmplregion.rname = { str: null };

    levregion_add(tmplregion);

    return 0;
}

// C ref: sp_lev.c:5471 -- des.levregion().
const REGIONTYPES = ['stair-down', 'stair-up', 'portal', 'branch',
                     'teleport', 'teleport-up', 'teleport-down'];
export function lspo_levregion(t) {
    const regiontypes2i = [LR_DOWNSTAIR, LR_UPSTAIR, LR_PORTAL, LR_BRANCH,
                           LR_TELE, LR_UPTELE, LR_DOWNTELE, 0];
    const tmplregion = {};

    create_des_coder();
    t = lcheck_param_table(t);
    l_get_lregion(t, tmplregion);
    tmplregion.rtype = regiontypes2i[get_table_option(t, 'type', 'stair-down',
                                                      REGIONTYPES)];
    tmplregion.padding = get_table_int_opt(t, 'padding', 0);
    tmplregion.rname = { str: get_table_str_opt(t, 'name', null) };

    levregion_add(tmplregion);
    return 0;
}

// C ref: sp_lev.c:5497 -- des.exclusion().  Both corners go through
// get_location_coord(ANY_LOC|NO_LOC_WARN), so an off-map corner becomes -1.
const EZ_TYPES = ['teleport', 'teleport-up', 'teleport-down',
                  'monster-generation'];
export function lspo_exclusion(t) {
    const ez_types2i = [LR_TELE, LR_UPTELE, LR_DOWNTELE, LR_MONGEN, 0];
    const ez = {};
    const r = { x1: -1, y1: -1, x2: -1, y2: -1 };

    create_des_coder();
    t = lcheck_param_table(t);
    ez.zonetype = ez_types2i[get_table_option(t, 'type', 'teleport', EZ_TYPES)];
    get_table_region(t, 'region', r, false);

    const a = { x: r.x1, y: r.y1 };
    const b = { x: r.x2, y: r.y2 };

    get_location_coord(a, ANY_LOC | NO_LOC_WARN, spl.coder?.croom,
                       SP_COORD_PACK(a.x, a.y));
    get_location_coord(b, ANY_LOC | NO_LOC_WARN, spl.coder?.croom,
                       SP_COORD_PACK(b.x, b.y));

    ez.lx = a.x;
    ez.ly = a.y;
    ez.hx = b.x;
    ez.hy = b.y;

    if (!game.exclusion_zones) game.exclusion_zones = [];
    game.exclusion_zones.unshift(ez);        /* C: ez->next = ...; head = ez */
    return 0;
}

// C ref: sp_lev.c:5534 -- des.region(selection, "lit") setter.  Lava is always
// lit regardless.
export function sel_set_lit(x, y, lit) {
    const loc = levl_at(x, y);
    if (!loc) return;
    loc.lit = (IS_LAVA(loc.typ) || lit) ? 1 : 0;
}

// C ref: sp_lev.c:5560 -- accept `x1=,y1=,x2=,y2=` or `region = {...}`.
export function get_table_coords_or_region(t, out) {
    out.x1 = get_table_int_opt(t, 'x1', -1);
    out.y1 = get_table_int_opt(t, 'y1', -1);
    out.x2 = get_table_int_opt(t, 'x2', -1);
    out.y2 = get_table_int_opt(t, 'y2', -1);

    if (out.x1 === -1 && out.y1 === -1 && out.x2 === -1 && out.y2 === -1) {
        const r = { x1: -1, y1: -1, x2: -1, y2: -1 };

        get_table_region(t, 'region', r, false);
        out.x1 = r.x1; out.y1 = r.y1;
        out.x2 = r.x2; out.y2 = r.y2;
    }
}

// C ref: sp_lev.c:5719 lspo_drawbridge() -- des.drawbridge().  state="random"
// costs one !rn2(2), drawn AFTER the location.
const MWDIRS_DB = ['north', 'south', 'west', 'east', 'random'];
const DBOPENS = ['open', 'closed', 'random'];
export function lspo_drawbridge(t) {
    const mwdirs2i = [DB_NORTH, DB_SOUTH, DB_WEST, DB_EAST, -1, -2];
    const dbopens2i = [1, 0, -1, -2];
    const m = { x: -1, y: -1 };

    create_des_coder();

    t = lcheck_param_table(t);

    get_table_xy_or_coord(t, m);

    const dir = mwdirs2i[get_table_option(t, 'dir', 'random', MWDIRS_DB)];
    const dcoord = SP_COORD_PACK(m.x, m.y);
    let db_open = dbopens2i[get_table_option(t, 'state', 'random', DBOPENS)];
    const c = { x: m.x, y: m.y };

    get_location_coord(c, DRY | WET | HOT, spl.coder?.croom, dcoord);
    if (!isok(m.x, m.y)) {
        nhl_error('drawbridge coord not ok');
        return 0;
    }
    if (db_open === -1) db_open = !rn2(2) ? 1 : 0;
    create_drawbridge(c.x, c.y, dir, !!db_open);
    splev_map_mark(c.x, c.y);

    return 0;
}

// C ref: sp_lev.c:5768 lspo_mazewalk() -- des.mazewalk().  dir="random" costs
// one random_wdir() rn2(4); walkfrom() then does the real work, and
// stocked (the default) adds fill_empty_maze()'s six count draws.
const MWDIRS_MW = ['north', 'south', 'east', 'west', 'random'];
export function lspo_mazewalk(...args) {
    const mwdirs2i = [W_NORTH, W_SOUTH, W_EAST, W_WEST, W_RANDOM, -2];
    const m = { x: -1, y: -1 };
    let ftyp = ROOM;
    let fstocked = 1, dir = -1;
    const argc = args.length;

    create_des_coder();

    if (argc === 3) {
        m.x = Math.trunc(args[0]);
        m.y = Math.trunc(args[1]);
        const i = MWDIRS_MW.indexOf(String(args[2]));
        if (i < 0) nhl_error(`invalid option '${args[2]}'`);
        dir = mwdirs2i[i];
    } else {
        const t = lcheck_param_table(args[0]);

        get_table_xy_or_coord(t, m);
        ftyp = get_table_mapchr_opt(t, 'typ', ROOM);
        fstocked = get_table_boolean_opt(t, 'stocked', 1);
        dir = mwdirs2i[get_table_option(t, 'dir', 'random', MWDIRS_MW)];
    }

    const mcoord = SP_COORD_PACK(m.x, m.y);
    const c = { x: m.x, y: m.y };

    get_location_coord(c, ANY_LOC, spl.coder?.croom, mcoord);

    if (!isok(c.x, c.y)) {
        nhl_error('mazewalk coord not ok');
        return 0;
    }

    if (ftyp < 1) ftyp = game.level?.flags?.corrmaze ? CORR : ROOM;

    if (dir === W_RANDOM) dir = random_wdir();

    /* don't use move() -- it doesn't use W_NORTH, etc. */
    switch (dir) {
    case W_NORTH: --c.y; break;
    case W_SOUTH: c.y++; break;
    case W_EAST:  c.x++; break;
    case W_WEST:  --c.x; break;
    default: break;                        /* C: impossible("Bad direction") */
    }

    let loc = levl_at(c.x, c.y);
    if (loc && !IS_DOOR(loc.typ)) {
        loc.typ = ftyp;
        loc.flags = 0;
    }

    /*
     * The parity of the coordinates handed to walkfrom() must be odd, but
     * which way we step depends on the direction that was chosen.
     */
    if (!(c.x % 2)) {
        if (dir === W_EAST) c.x++;
        else c.x--;

        /* no need for an IS_DOOR check; out of map bounds */
        loc = levl_at(c.x, c.y);
        if (loc) {
            loc.typ = ftyp;
            loc.flags = 0;
        }
    }

    if (!(c.y % 2)) {
        if (dir === W_SOUTH) c.y++;
        else c.y--;
    }

    walkfrom(c.x, c.y, ftyp);
    if (fstocked) fill_empty_maze();

    return 0;
}

// C ref: sp_lev.c:5875 lspo_wall_property() -- des.wall_property().  An
// unspecified edge defaults to one square outside the current map footprint.
const WPROPS = ['nondiggable', 'nonpasswall'];
export function lspo_wall_property(t) {
    const wprop2i = [W_NONDIGGABLE, W_NONPASSWALL, -1];
    const r = { x1: -1, y1: -1, x2: -1, y2: -1 };

    create_des_coder();

    t = lcheck_param_table(t);

    get_table_coords_or_region(t, r);

    const wprop = wprop2i[get_table_option(t, 'property', 'nondiggable', WPROPS)];

    if (r.x1 === -1) r.x1 = gx.xstart - 1;
    if (r.y1 === -1) r.y1 = gy.ystart - 1;
    if (r.x2 === -1) r.x2 = gx.xstart + gx.xsize + 1;
    if (r.y2 === -1) r.y2 = gy.ystart + gy.ysize + 1;

    const a = { x: r.x1, y: r.y1 };
    const b = { x: r.x2, y: r.y2 };
    get_location(a, ANY_LOC, null);
    get_location(b, ANY_LOC, null);

    set_wall_property(a.x, a.y, b.x, b.y, wprop);

    return 0;
}

// C ref: sp_lev.c:5910 -- des.non_diggable()/non_passwall() with no selection
// flag the WHOLE level (selection_clear(sel, 1)).
export function set_wallprop_in_selection(sel_arg, prop) {
    let freesel = false;
    let sel = null;

    create_des_coder();

    if (sel_arg != null) {
        sel = sel_arg;
    } else {
        freesel = true;
        sel = selection_new_var();
        selection_clear_var(sel, 1);
    }

    if (sel) {
        selection_iterate(sel, (x, y) => sel_set_wall_property(x, y, prop));
        if (freesel) { /* C: selection_free(sel, TRUE) */ }
    }
}

// C ref: sp_lev.c:5936 / :5945.
export function lspo_non_diggable(sel) {
    set_wallprop_in_selection(sel, W_NONDIGGABLE);
    return 0;
}

export function lspo_non_passwall(sel) {
    set_wallprop_in_selection(sel, W_NONPASSWALL);
    return 0;
}

// C ref: sp_lev.c:5954 -- #if 0'd in C (the TODO wallify(selection) form);
// kept for parity with the C source.
export function sel_set_wallify(x, y) {
    wallify_map(x, y, x, y);
}

// C ref: sp_lev.c:5964 lspo_wallify() -- des.wallify().  With no table it
// wallifies one square beyond the current map footprint.  No RNG.
export function lspo_wallify(t) {
    let dx1 = -1, dy1 = -1, dx2 = -1, dy2 = -1;

    create_des_coder();

    if (t != null) {
        dx1 = get_table_int(t, 'x1');
        dy1 = get_table_int(t, 'y1');
        dx2 = get_table_int(t, 'x2');
        dy2 = get_table_int(t, 'y2');
    }

    wallify_map(dx1 < 0 ? (gx.xstart - 1) : dx1,
                dy1 < 0 ? (gy.ystart - 1) : dy1,
                dx2 < 0 ? (gx.xstart + gx.xsize + 1) : dx2,
                dy2 < 0 ? (gy.ystart + gy.ysize + 1) : dy2);

    return 0;
}

// C ref: sp_lev.c:5992 -- des.reset_level(), a lua_testing-only entry point.
export function lspo_reset_level(L) {
    const wtower = EXT.In_W_tower(game.u?.ux, game.u?.uy, game.u?.uz);

    if (game.iflags) game.iflags.lua_testing = true;
    if (L) {
        spl.coder = null;
        create_des_coder();
    }
    EXT.makemap_prepost(true, wtower);
    game.in_mklev = true;
    EXT.oinit();                 /* assign level dependent obj probabilities */
    EXT.clear_level_structures();
    return 0;
}

// C ref: sp_lev.c:6013 -- des.finalize_level(), a lua_testing-only entry point,
// and the same tail load_special() runs.  Order is load-bearing: the flip comes
// after wallification and before count_level_features, and fixup_special()
// must precede premap_detect() or branch stairs are not premapped.
export function lspo_finalize_level(L) {
    const wtower = EXT.In_W_tower(game.u?.ux, game.u?.uy, game.u?.uz);

    if (L) create_des_coder();

    link_doors_rooms();
    remove_boundary_syms();

    /* TODO (C): ensure_way_out() needs rewrite */
    if (L && spl.coder.check_inaccessibles) ensure_way_out();

    map_cleanup();

    /*
     * C FIXME kept verbatim: ideally this would only cover areas the level
     * file did not insert directly (Baalzebub's insect legs); since that is
     * not possible, the corrmaze flag is overloaded for the purpose.
     */
    if (!game.level?.flags?.corrmaze)
        EXT.wallification(1, 0, COLNO - 1, ROWNO - 1);

    if (L) flip_level_rnd(spl.coder.allow_flips, false);

    EXT.count_level_features();

    if (L && spl.coder.solidify) solidify_map();

    /* must precede premap_detect() or branch stairs won't be premapped */
    EXT.fixup_special();

    if (L && spl.coder.premapped) premap_detect();

    EXT.level_finalize_topology();

    for (let i = 0; i < svn_nroom(); ++i) fill_special_room(svr_rooms()[i]);

    EXT.makemap_prepost(false, wtower);
    if (game.iflags) game.iflags.lua_testing = false;
    return 0;
}

// C ref: sp_lev.c:6323 -- croom follows the innermost open room.
export function update_croom() {
    if (!spl.coder) return;

    if (spl.coder.n_subroom)
        spl.coder.croom = spl.coder.tmproomlist[spl.coder.n_subroom - 1];
    else
        spl.coder.croom = null;
}

// C ref: sp_lev.c:6335 -- fresh coder state for one level file.  allow_flips
// starts at 3 (both axes), which is what flip_level_rnd() spends at the end.
export function sp_level_coder_init() {
    const coder = {
        premapped: false,
        solidify: false,
        check_inaccessibles: false,
        allow_flips: 3,            /* allow flipping level horiz/vert */
        croom: null,
        n_subroom: 1,
        lvl_is_joined: false,
        room_stack: 0,
        tmproomlist: [],
        failed_room: [],
    };

    spl.splev_init_present = false;
    spl.icedpools = false;

    for (let tmpi = 0; tmpi <= MAX_NESTED_ROOMS; tmpi++) {
        coder.tmproomlist[tmpi] = null;
        coder.failed_room[tmpi] = false;
    }

    spl.coder = coder;
    update_croom();

    for (let tmpi = 0; tmpi < MAX_CONTAINMENT; tmpi++)
        spl.container_obj[tmpi] = null;
    spl.container_idx = 0;

    spl.invent_carrying_monster = null;

    splev_map_reset();                     /* memset(SpLev_Map, 0, ...) */

    const flags = game.level?.flags;
    if (flags) {
        flags.is_maze_lev = 0;
        flags.temperature = In_hell(game.u?.uz) ? 1 : 0;
        flags.rndmongen = 1;
        flags.deathdrops = 1;
    }

    reset_xystart_size();

    return coder;
}

// C ref: sp_lev.c:6379 nhl_functions[] + :6434 l_register_des() -- the `des`
// table the .lua level files call into.  In C this is registered on the Lua
// state; here it is the plain object of the same name/function pairs.
export function l_register_des() {
    const des = {
        message: lspo_message,
        monster: lspo_monster,
        object: lspo_object,
        level_flags: lspo_level_flags,
        level_init: lspo_level_init,
        engraving: lspo_engraving,
        mineralize: lspo_mineralize,
        door: lspo_door,
        stair: lspo_stair,
        ladder: lspo_ladder,
        grave: lspo_grave,
        altar: lspo_altar,
        map: lspo_map,
        feature: lspo_feature,
        terrain: lspo_terrain,
        replace_terrain: lspo_replace_terrain,
        room: lspo_room,
        corridor: lspo_corridor,
        random_corridors: lspo_random_corridors,
        gold: lspo_gold,
        trap: lspo_trap,
        mazewalk: lspo_mazewalk,
        drawbridge: lspo_drawbridge,
        region: lspo_region,
        levregion: lspo_levregion,
        exclusion: lspo_exclusion,
        wallify: lspo_wallify,
        wall_property: lspo_wall_property,
        non_diggable: lspo_non_diggable,
        non_passwall: lspo_non_passwall,
        teleport_region: lspo_teleport_region,
        reset_level: lspo_reset_level,
        finalize_level: lspo_finalize_level,
        gas_cloud: lspo_gas_cloud,
        /* TODO (C): branch, portal */
    };
    game.des = des;
    return des;
}

// C ref: sp_lev.c:6443 -- every lspo_* entry point starts with this.
export function create_des_coder() {
    if (!spl.coder) spl.coder = sp_level_coder_init();
}

// C ref: sp_lev.c:6453 load_special(name) -- the general special-level loader.
// The tail (link_doors_rooms .. premap_detect) is the same sequence
// lspo_finalize_level() runs, minus level_finalize_topology/fill_special_room.
export function load_special(name) {
    let result = false;

    create_des_coder();

    if (EXT.load_lua(name, { mode: 0, memlimit: 1024 * 1024, steps: 0,
                             stackdepth: 1024 * 1024 })) {
        link_doors_rooms();
        remove_boundary_syms();

        /* TODO (C): ensure_way_out() needs rewrite */
        if (spl.coder.check_inaccessibles) ensure_way_out();

        map_cleanup();

        /* C FIXME kept verbatim -- see lspo_finalize_level(). */
        if (!game.level?.flags?.corrmaze)
            EXT.wallification(1, 0, COLNO - 1, ROWNO - 1);

        flip_level_rnd(spl.coder.allow_flips, false);

        EXT.count_level_features();

        if (spl.coder.solidify) solidify_map();

        /* must precede premap_detect() or branch stairs won't be premapped */
        EXT.fixup_special();

        if (spl.coder.premapped) premap_detect();

        result = true;
    }

    spl.coder = null;

    return result;
}
