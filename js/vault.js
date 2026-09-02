// vault.js — the vault guard subsystem.
// C ref: src/vault.c (all 25 functions).  Guard creation (invault), the
// "Please follow me" escort (gd_move), the temporary corridor the guard digs
// and later erases (clear_fcorr / restfakecorr), gold accounting (paygd,
// hidden_gold) and the wall repair (wallify_vault).
//
// RNG inventory for this file (modulus + guard, in C's order):
//   invault()               rn2(vgdeathcount * vgdeathcount)  [only when
//                             2 <= mvitals[PM_GUARD].died < 50]
//                           then makemon(&mons[PM_GUARD], ...) and, per
//                             boulder on the guard's square, fracture_rock's
//                             rn1(60, 7)
//   move_gold()             rn2(2), rn2(2)          (vault corner jitter)
//   paygd()                 rn2(2), rn2(2)          (same, for the grave)
//   gd_move()               rn2(10)                 ("Move along!", vault.c:1067)
//   gd_pick_corridor_gold() enexto()'s collect_coords shuffle, ten times
//   clear_fcorr()/gd_move()/wallify_vault()/gd_mv_monaway()  rloc()'s
//                           rnd(COLNO-1)+rn2(ROWNO) placement loop
//   paygd()/invault()       currency()'s rn2 while hallucinating
//
// INTEGRATION: nothing imports this module yet; the call sites C has (and the
// file that owns each) are listed at the bottom.

import { game } from './gstate.js';
import { rn2, rn1 } from './rng.js';
import {
    COLNO, ROWNO, STONE, VWALL, HWALL, TLCORNER, TRCORNER, BLCORNER, BRCORNER,
    CROSSWALL, TUWALL, TDWALL, TLWALL, TRWALL, SDOOR, SCORR, DOOR, CORR, ROOM,
    POOL, DRAWBRIDGE_UP, D_NODOOR, FAINTED,
    IS_WALL, IS_STWALL, IS_ROOM, IS_OBSTRUCTED, ACCESSIBLE,
    ROOMOFFSET, VAULT, VAULT_GUARD_TIME, FCSIZ, GD_EATGOLD, GD_DESTROYGOLD,
    SV0, SV1, SV7, SVALL, COULD_SEE, IN_SIGHT, A_LAWFUL, NEED_HTH_WEAPON,
    EGD, u_at, Upolyd,
} from './const.js';
import { ATR_INVERSE } from './terminal.js';
import {
    newsym, update_topl, m_at, background_glyph, show_glyph_cell, map_invisible,
} from './display.js';
import { cansee, couldsee, block_point, unblock_point, recalc_block_point } from './vision.js';
import { Monnam, mon_nam, canspotmon, setmangry, relobj } from './uhitm.js';
import { noit_Monnam, noit_mon_nam } from './do_name.js';
import { m_carrying, m_canseeu, mon_wield_item } from './monmove.js';
import { rloc, rloc_to, RLOC_MSG, RLOC_ERR } from './teleport.js';
import { makemon, set_malign, monster_by_pmidx, enexto_spawn } from './makemon.js';
import { place_object, objects, weight, COIN_CLASS, BOULDER, ROCK } from './mkobj.js';
import { stackobj, makeplural, xname, currency } from './invent.js';
import { money_cnt_invent, hidden_gold as shk_hidden_gold } from './shk.js';
import { in_rooms } from './shkroom.js';
import { t_at } from './mkroom.js';
import { deltrap } from './trap.js';
import { make_grave } from './engrave.js';
import { stop_occupation, nomul } from './hack.js';
import { adjalign } from './attrib.js';
import { dist2 } from './hacklib.js';
import { msound_of } from './monflags_data.js';
import { attacktype, dmgtype, AT_HUGS, AD_STCK, AD_WRAP } from './monattk_data.js';
import { unfaint } from './eat.js';

// C ref: monsters.h — mons[] indices in this port's MONS_NAMES order.
const PM_GUARD = 272;
const PM_CROESUS = 286;
// C ref: objects.h TIN_WHISTLE, for gd_letknow's whistle line.
const TIN_WHISTLE = 245;
// C ref: objects.h GEM_CLASS (fracture_rock turns a boulder into rocks).
const GEM_CLASS = 9;
// C ref: hack.h MM_EGD (:1154) and MM_NOMSG (:1164).
const MM_EGD = 0x00000080;
const MM_NOMSG = 0x00020000;
// C ref: monflag.h MS_SILENT / the msound values yelp() switches on.
const MS_SILENT = 0, MS_BARK = 1, MS_MEW = 2, MS_ROAR = 3, MS_GROWL = 5,
    MS_SQEEK = 6, MS_SQAWK = 7, MS_WAIL = 14;
// C ref: obj.h OBJ_FLOOR / OBJ_MINVENT.  js/mkobj.js place_object() writes the
// string form of "on the floor"; js/dogmove.js mpickobj() writes the numeric
// OBJ_MINVENT.  Both spellings are used verbatim so the shared readers agree.
const OBJ_FLOOR = 'floor';
const OBJ_MINVENT = 4;

/* ------------------------------------------------------------------ *
 * house-local helpers (the shape the rest of js/ uses)
 * ------------------------------------------------------------------ */

// C ref: monst.h DEADMONSTER(mon).
const DEADMONSTER = (mon) => !mon || (mon.mhp != null && mon.mhp < 1);
// C ref: youprop.h Deaf.
const Deaf = () => ((game.u?.uprops?.HDeaf ?? 0) > 0) || !!game.u?.Deaf;
// C ref: youprop.h Blind.
const Blind_hero = () => (game.u?.blinded || 0) > 0 || !!game.u?.ublindf;
// C ref: youprop.h Strangled — u.uprops[STRANGLED].
const Strangled = () => (game.u?.uprops?.Strangled || 0) > 0;
// C ref: pline.c verbalize() / You() / Your() / You_hear() / pline_The().
const verbalize = (line) => update_topl(`"${line}"`);
const You = (s) => update_topl(`You ${s}`);
const Your = (s) => update_topl(`Your ${s}`);
const You_hear = (s) => update_topl(`You hear ${s}`);
const pline_The = (s) => update_topl(`The ${s}`);
// C ref: hacklib.c an() / upstart() / mungspaces().
const an = (s) => (/^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`);
const upstart = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const mungspaces = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/^ | $/g, '');
// C ref: do_name.c noit_Monnam / noit_mon_nam — SUPPRESS_IT, i.e. a guard is
// named even when the hero cannot spot it.  The shim used to be mon_nam(),
// which was indistinguishable only while x_monnam() ignored canspotmon().
const mhe = (m) => (m?.female ? 'she' : 'he');
const noit_mhis = (m) => (m?.female ? 'her' : 'his');
// C ref: do_name.c Some_Monnam(mon) — "Someone" when the hero can't spot it.
const Some_Monnam = (mon) => (canspotmon(mon) ? Monnam(mon) : 'Someone');
// C ref: hack.h um_dist(x,y,n) — further than n from the hero on EITHER axis.
const um_dist = (x, y, n) => Math.abs(x - (game.u?.ux ?? 0)) > n
    || Math.abs(y - (game.u?.uy ?? 0)) > n;
// C ref: hack.h distu(x,y).
const distu = (x, y) => dist2(x, y, game.u?.ux ?? 0, game.u?.uy ?? 0);
// C ref: dungeon.c on_level() / assign_level().
const on_level = (a, b) => !!a && !!b && a.dnum === b.dnum && a.dlevel === b.dlevel;
const assign_level = (dest, src) => { dest.dnum = src?.dnum ?? 0; dest.dlevel = src?.dlevel ?? 0; };
// C ref: hack.h levl[x][y] / isok(x,y).
const levl_at = (x, y) => game.level?.at(x, y) || null;
const isok = (x, y) => x >= 1 && x < COLNO && y >= 0 && y < ROWNO;
// C ref: mkroom.h svr.rooms[i].
const roomAt = (i) => game.level?.rooms?.[i] || null;
// C ref: monst.h helpless(mon).
const mon_helpless = (m) => !!(m && (m.msleeping || !m.mcanmove));
// C ref: rm.h IS_POOL(typ).
const IS_POOL_TYP = (typ) => typ >= POOL && typ <= DRAWBRIDGE_UP;
// C ref: mon.h MON_WEP(mon).
const MON_WEP = (mon) => (mon?.mw || null);
// C ref: display.h mon_visible(mon).
const mon_visible = (mon) => !mon?.minvis || !!game.u?.uprops?.See_invisible;
// C ref: eat.c is_fainted() — u.uhs == FAINTED.
const is_fainted = () => (game.u?.uhs ?? 0) === FAINTED;

// The hero's current monster form.  u.umonnum holds the ROLE index in this
// port unless polymorphed (see js/eat.js:1328, js/end.js:295), so the mons[]
// lookup is only meaningful while Upolyd; without it the caller falls back to
// the player-monster answer, which is what every role's PM_ entry gives.
function youmonst_data() {
    const u = game.u;
    if (!u || !Upolyd(u)) return null;
    return monster_by_pmidx(u.umonnum) || null;
}
// C ref: mondata.h is_silent(ptr) — msound == MS_SILENT.
const is_silent_hero = () => {
    const d = youmonst_data();
    return d ? msound_of(d) === MS_SILENT : false;
};
// C ref: mondata.h sticks(ptr) — AD_STCK / AD_WRAP damage or an AT_HUGS attack.
const sticks_hero = () => {
    const d = youmonst_data();
    if (!d) return false;
    return !!(dmgtype(d, AD_STCK) || dmgtype(d, AD_WRAP) || attacktype(d, AT_HUGS));
};

// The level's floor objects.  js/mkobj.js place_object() keeps them in ONE
// flat array with ox/oy/where; js/invent.js's g_at()/sobj_at() instead index
// `game.level.objects[x][y]`, a shape that representation never has, so they
// cannot be reused here (noted in this port's deferred list).
function floorObjsAt(x, y) {
    const objs = game.level?.objects;
    if (!Array.isArray(objs)) return [];
    return objs.filter((o) => o && o.where === OBJ_FLOOR && o.ox === x && o.oy === y);
}
// C ref: mkobj.c g_at(x,y) — the gold pile at <x,y>.
function g_at(x, y) {
    for (const o of floorObjsAt(x, y)) if (o.oclass === COIN_CLASS) return o;
    return null;
}
// C ref: invent.c sobj_at(otyp,x,y).
function sobj_at(otyp, x, y) {
    for (const o of floorObjsAt(x, y)) if (o.otyp === otyp) return o;
    return null;
}
// C ref: mkobj.c obj_extract_self(obj) / remove_object(obj) / obfree(obj,mrg)
// for an object lying on the floor.
function obj_extract_self(obj) {
    const objs = game.level?.objects;
    if (Array.isArray(objs)) {
        const i = objs.indexOf(obj);
        if (i >= 0) objs.splice(i, 1);
    }
    return obj;
}
const remove_object = obj_extract_self;
const obfree = obj_extract_self;
// C ref: mon.c add_to_minv(mon, obj).
function add_to_minv(mon, obj) {
    mon.minvent = mon.minvent || [];
    obj.where = OBJ_MINVENT;
    mon.minvent.push(obj);
}
// C ref: engrave.c del_engr_at(x,y).
function del_engr_at(x, y) {
    if (!game.level?.engravings) return;
    game.level.engravings = game.level.engravings.filter(
        (ep) => ep.engr_x !== x || ep.engr_y !== y);
}
// C ref: invent.c freeinv(obj).
function freeinv(obj) {
    const inv = game.invent;
    if (Array.isArray(inv)) {
        const i = inv.indexOf(obj);
        if (i >= 0) inv.splice(i, 1);
    }
}

// C ref: mon.c place_monster(mon, x, y) / remove_monster(x, y).  This port
// keys monsters off their own mx/my instead of a grid, so the pair is a
// coordinate write plus list membership.
function place_monster(mon, x, y) {
    mon.mx = x; mon.my = y;
    const list = game.level?.monsters;
    if (list && !list.includes(mon)) list.push(mon);
}
function remove_monster(x, y) {
    const mon = m_at(x, y);
    if (mon) { mon.mx = 0; mon.my = 0; }
}
// C ref: mon.c relmon() — unlink from the level's monster chain.
function relmon(mon) {
    const list = game.level?.monsters;
    if (!list) return;
    const i = list.indexOf(mon);
    if (i >= 0) list.splice(i, 1);
    if (game.u?.ustuck === mon) game.u.ustuck = null;
    mon.mtrapped = 0;
}
// C ref: mon.c mongone(mdef) — the monster leaves the game without dying.
// The guard arm is why this is not just relmon(): a guard whose temporary
// corridor is still on the map gets parked instead of removed.
async function mongone(mdef) {
    mdef.mhp = 0;
    if (mdef.isgd && !(await grddead(mdef))) return;
    const mx = mdef.mx, my = mdef.my;
    mdef.minvent = [];              /* discard_minvent(mdef, FALSE) */
    relmon(mdef);
    newsym(mx, my);
}
// C ref: mon.c m_into_limbo(mtmp) -> migrate_mon(..., MIGR_APPROX_XY).  There
// is no migrating-monster queue in js/ yet, so the monster is unlinked from
// this level; either way it can no longer appear on a screen of this level.
function m_into_limbo(mtmp) {
    const mx = mtmp.mx, my = mtmp.my;
    relmon(mtmp);
    newsym(mx, my);
}
// C ref: mon.c mpickgold(mtmp).  `flags.verbose && !mtmp->isgd` suppresses the
// pickup line for a guard, so only the newsym fires; gd_pick_corridor_gold
// prints its own message.
function mpickgold(mtmp) {
    const gold = g_at(mtmp.mx, mtmp.my);
    if (!gold) return;
    obj_extract_self(gold);
    add_to_minv(mtmp, gold);
    if (cansee(mtmp.mx, mtmp.my)) newsym(mtmp.mx, mtmp.my);
}

// C ref: sounds.c yelp(mtmp) — a tame monster shoved aside by the guard yelps.
// wake_nearto() only clears msleeping; the hallucinatory ROLL_FROM(h_sounds)
// needs pline.c's hallucination sound table, which js/ has not ported.
async function yelp(mtmp) {
    if (mon_helpless(mtmp) || !mtmp.data?.msound) return;
    const deaf = Deaf();
    let verb = null;
    switch (mtmp.data.msound) {
    case MS_MEW: verb = !deaf ? 'yowl' : 'arch'; break;
    case MS_BARK:
    case MS_GROWL: verb = !deaf ? 'yelp' : 'recoil'; break;
    case MS_ROAR: verb = !deaf ? 'snarl' : 'bluff'; break;
    case MS_SQEEK: verb = !deaf ? 'squeal' : 'quiver'; break;
    case MS_SQAWK: verb = !deaf ? 'screak' : 'thrash'; break;
    case MS_WAIL: verb = !deaf ? 'wail' : 'cringe'; break;
    default: verb = null; break;
    }
    if (!verb) return;
    await update_topl(`${Monnam(mtmp)} ${verb}s!`);
    if (game.context?.run) nomul(0);
    const range = (mtmp.data.mlevel || 0) * 12;
    for (const m of (game.level?.monsters || []))   /* wake_nearto */
        if (dist2(m.mx, m.my, mtmp.mx, mtmp.my) < range * range) m.msleeping = 0;
}

// C ref: zap.c fracture_rock(obj) — a boulder in the guard's way becomes a
// pile of rocks.  rn1(60, 7) is the one draw.  The shop-billing arm needs a
// costly_spot (a vault wall is not one) and sokoban_guilt() needs Sokoban.
function fracture_rock(obj) {
    obj.otyp = ROCK;
    obj.oclass = GEM_CLASS;
    obj.quan = rn1(60, 7);
    obj.owt = weight(obj);
    obj.dknown = 0; obj.bknown = 0; obj.rknown = 0;
    obj.known = objects?.[ROCK]?.oc_uses_known ? 0 : 1;
    obj.oextra = null;              /* dealloc_oextra */
    if (obj.where === OBJ_FLOOR) {
        const ox = obj.ox, oy = obj.oy;
        obj_extract_self(obj);      /* move rocks back on top */
        place_object(obj, ox, oy);
        unblock_point(ox, oy);
        if (cansee(ox, oy)) newsym(ox, oy);
    }
}

// C ref: display.c map_location(x, y, show) -> _map_location: draw and
// remember the topmost thing at <x,y>, bypassing vision.  vault.c calls it
// with show=1 as each corridor square reverts.
function map_location(x, y, show) {
    const loc = levl_at(x, y);
    if (!loc) return;
    const bg = background_glyph(loc, x, y);
    loc.remembered_glyph = { ch: bg.ch, color: bg.color, decgfx: bg.dec, pile: !!bg.pile };
    if (show) {
        const attr = (bg.pile && game.flags?.hilite_pile
            && game.flags?.use_inverse !== false) ? ATR_INVERSE : 0;
        show_glyph_cell(x, y, bg.ch, bg.color, bg.dec, attr);
    }
}

// C ref: display.c seenv_matrix[3][3] + unset_seenv(lev, x0, y0, x1, y1).
const SV2 = 0x04, SV3 = 0x08, SV4 = 0x10, SV5 = 0x20, SV6 = 0x40;
const SEENV_MATRIX = [
    [SV2, SV1, SV0],
    [SV3, SVALL, SV7],
    [SV4, SV5, SV6],
];
function unset_seenv(lev, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y0 - y1;
    lev.seenv = (lev.seenv | 0) & ~SEENV_MATRIX[dy + 1][dx + 1];
}

/* -- wall-mode recomputation --------------------------------------------- *
 * C ref: display.c check_pos / set_wall / set_twall / set_corn /
 * set_crosswall / xy_set_wall_state.  js/mklev.js carries the same code but
 * keeps it file-private, so this is a copy; consolidating it means exporting
 * mklev.js's xy_set_wall_state (see the deferred list).                     */
const WM_MASK = 0x07;
const WM_W_LEFT = 1, WM_W_RIGHT = 2, WM_W_TOP = 1, WM_W_BOTTOM = 2;
const WM_T_LONG = 1, WM_T_BL = 2, WM_T_BR = 3;
const WM_C_OUTER = 1, WM_C_INNER = 2;
const WM_X_TL = 1, WM_X_TR = 2, WM_X_BL = 3, WM_X_BR = 4,
    WM_X_TLBR = 5, WM_X_BLTR = 6;

function check_pos(x, y, which) {
    if (!isok(x, y)) return which;
    const type = levl_at(x, y)?.typ ?? STONE;
    if (IS_STWALL(type) || type === CORR || type === SCORR || type === SDOOR)
        return which;
    return 0;
}
function more_than_one(a, b, c) {
    return ((a && (b | c)) || (b && (a | c)) || (c && (a | b)));
}
function set_wall(x, y, horiz) {
    let is_1, is_2;
    if (horiz) {
        is_1 = check_pos(x, y - 1, WM_W_TOP);
        is_2 = check_pos(x, y + 1, WM_W_BOTTOM);
    } else {
        is_1 = check_pos(x - 1, y, WM_W_LEFT);
        is_2 = check_pos(x + 1, y, WM_W_RIGHT);
    }
    return more_than_one(is_1, is_2, 0) ? 0 : (is_1 + is_2);
}
function set_twall(x1, y1, x2, y2, x3, y3) {
    const is_1 = check_pos(x1, y1, WM_T_LONG);
    const is_2 = check_pos(x2, y2, WM_T_BL);
    const is_3 = check_pos(x3, y3, WM_T_BR);
    return more_than_one(is_1, is_2, is_3) ? 0 : (is_1 + is_2 + is_3);
}
function set_corn(x1, y1, x2, y2, x3, y3, x4, y4) {
    const is_1 = check_pos(x1, y1, 1);
    const is_2 = check_pos(x2, y2, 1);
    const is_3 = check_pos(x3, y3, 1);
    const is_4 = check_pos(x4, y4, 1); /* inner location */
    if (is_4) return WM_C_INNER;
    if (is_1 && is_2 && is_3) return WM_C_OUTER;
    return 0;
}
function set_crosswall(x, y) {
    const is_1 = check_pos(x - 1, y - 1, 1);
    const is_2 = check_pos(x + 1, y - 1, 1);
    const is_3 = check_pos(x + 1, y + 1, 1);
    const is_4 = check_pos(x - 1, y + 1, 1);
    let wmode = is_1 + is_2 + is_3 + is_4;
    if (wmode > 1) {
        if (is_1 && is_3 && (is_2 + is_4 === 0)) wmode = WM_X_TLBR;
        else if (is_2 && is_4 && (is_1 + is_3 === 0)) wmode = WM_X_BLTR;
        else wmode = 0;
    } else if (is_1) wmode = WM_X_TL;
    else if (is_2) wmode = WM_X_TR;
    else if (is_3) wmode = WM_X_BR;
    else if (is_4) wmode = WM_X_BL;
    return wmode;
}
function xy_set_wall_state(x, y) {
    const lev = levl_at(x, y);
    if (!lev) return;
    let wmode;
    switch (lev.typ) {
    case SDOOR: wmode = set_wall(x, y, lev.horizontal ? 1 : 0); break;
    case VWALL: wmode = set_wall(x, y, 0); break;
    case HWALL: wmode = set_wall(x, y, 1); break;
    case TDWALL: wmode = set_twall(x, y - 1, x - 1, y + 1, x + 1, y + 1); break;
    case TUWALL: wmode = set_twall(x, y + 1, x + 1, y - 1, x - 1, y - 1); break;
    case TLWALL: wmode = set_twall(x + 1, y, x - 1, y - 1, x - 1, y + 1); break;
    case TRWALL: wmode = set_twall(x - 1, y, x + 1, y + 1, x + 1, y - 1); break;
    case TLCORNER: wmode = set_corn(x - 1, y - 1, x, y - 1, x - 1, y, x + 1, y + 1); break;
    case TRCORNER: wmode = set_corn(x, y - 1, x + 1, y - 1, x + 1, y, x - 1, y + 1); break;
    case BLCORNER: wmode = set_corn(x, y + 1, x - 1, y + 1, x - 1, y, x + 1, y - 1); break;
    case BRCORNER: wmode = set_corn(x + 1, y, x + 1, y + 1, x, y + 1, x - 1, y - 1); break;
    case CROSSWALL: wmode = set_crosswall(x, y); break;
    default: wmode = -1; break;     /* don't set wall info */
    }
    if (wmode >= 0)
        lev.wall_info = ((lev.wall_info | 0) & ~WM_MASK) | wmode;
}

// C ref: eat.c reset_faint() — `if (ga.afternmv == unfaint) unmul("You
// revive.")`.  js/eat.js parks the same callback in game.afternmv.
async function reset_faint() {
    if (game.afternmv === unfaint) await unmul('You revive.');
}

// C ref: hack.c unmul(msg) — release the hero from a multi-turn occupation and
// run the pending afternmv.
async function unmul(msg) {
    game.multi = 0;
    if (game.context) game.context.travel = game.context.travel1 = game.context.mv = 0;
    const nmsg = msg || game.nomovemsg;
    game.nomovemsg = null;
    if (nmsg) await update_topl(nmsg);
    const fn = game.afternmv;
    if (fn) { game.afternmv = null; await fn(); }
}

// C ref: win/tty/getline.c tty_getlin(query, buf).
async function getlin(query) {
    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    const s = await hooked_tty_getlin(query, null);
    return (typeof s === 'string') ? s : '';
}

// C ref: mon.c mnexto(mtmp, rlocflags) — relocate next to the hero via
// enexto(); on failure the monster goes off-map.  js/do.js keeps a private
// copy of this for level arrival; vault.c needs the rloc_to form.
async function mnexto(mtmp) {
    const u = game.u;
    const cc = enexto_spawn(u.ux, u.uy, mtmp.data);
    if (!cc) { m_into_limbo(mtmp); return; }
    await rloc_to(mtmp, cc.x, cc.y);
}

// C ref: timeout.c spot_stop_timers(x, y, MELT_ICE_AWAY) — cancel the pending
// timer on the guard's entry square.  js/ models only per-object ROT_CORPSE
// timers (js/mkobj.js run_object_timers); the level timer queue that carries
// MELT_ICE_AWAY does not exist, so there is nothing to walk until timeout.c's
// timer_element list is ported (see this port's deferred list).
function spot_stop_timers(_x, _y) { /* needs timeout.c's timer_element list */ }

/* ------------------------------------------------------------------ *
 * vault.c
 * ------------------------------------------------------------------ */

// C ref: vault.c newegd(mtmp).  No RNG.  js/makemon.js does not act on MM_EGD,
// so invault() calls this straight after makemon() — the same point in the
// sequence C allocates the struct (makemon.c:1237).
export function newegd(mtmp) {
    if (!mtmp.mextra) mtmp.mextra = {};
    if (!mtmp.mextra.egd) {
        mtmp.mextra.egd = {
            fakecorr: [],           /* struct fakecorridor fakecorr[FCSIZ] */
            fcbeg: 0, fcend: 0,
            gdx: 0, gdy: 0, ogx: 0, ogy: 0,
            gdlevel: { dnum: 0, dlevel: 0 },
            warncnt: 0, dropgoldcnt: 0, gddone: 0, witness: 0,
            vroom: 0,
            parentmid: mtmp.m_id,
        };
    }
}

// C ref: vault.c free_egd(mtmp).
export function free_egd(mtmp) {
    if (mtmp.mextra && mtmp.mextra.egd) mtmp.mextra.egd = null;
    mtmp.isgd = 0;
}

// C ref: vault.c clear_fcorr(grd, forceshow) — try to erase the temporary
// corridor; returns FALSE (leaving the rest for a later turn) as soon as a
// square is still occupied or visible.  RNG: rloc() per displaced monster.
export async function clear_fcorr(grd, forceshow) {
    const egrd = EGD(grd);
    const u = game.u;
    let sawcorridor = false;
    const silently = !!game.program_state?.stopprint;

    if (!egrd || !on_level(egrd.gdlevel, u?.uz)) return true;

    // The guard stays on the monster list (alive or dead, at off-map <0,0>)
    // until the temporary corridor back to civilization has been removed.
    let fcbeg;
    while ((fcbeg = egrd.fcbeg) < egrd.fcend) {
        const fc = egrd.fakecorr[fcbeg];
        const fcx = fc.fx, fcy = fc.fy;
        if ((DEADMONSTER(grd) || !in_fcorridor(grd, u.ux, u.uy)) && egrd.gddone)
            forceshow = true;
        // C: Punished && !carried(uball) && uball->ox == fcx && uball->oy == fcy
        const uball = u.uball;
        if ((u_at(fcx, fcy) && !DEADMONSTER(grd))
            || (!forceshow && couldsee(fcx, fcy))
            || ((u.uprops?.Punished || 0) > 0 && uball && uball.where !== 'invent'
                && uball.ox === fcx && uball.oy === fcy))
            return false;

        const mtmp = m_at(fcx, fcy);
        if (mtmp) {
            if (mtmp.isgd) return false;
            if (mtmp.mtame) await yelp(mtmp);
            if (!(await rloc(mtmp, RLOC_MSG))) m_into_limbo(mtmp);
        }
        const lev = levl_at(fcx, fcy);
        if (lev.typ === CORR && cansee(fcx, fcy)) sawcorridor = true;
        lev.typ = fc.ftyp;
        lev.flags = fc.flags;
        if (IS_STWALL(lev.typ)) {
            // Destroy any trap here when the spot reverts to stone, and undo a
            // scroll/wand/spell of light that lit it.
            const trap = t_at(fcx, fcy);
            if (trap) deltrap(trap);
            if (lev.typ === STONE) blackout(fcx, fcy);
        }
        del_engr_at(fcx, fcy);
        map_location(fcx, fcy, 1);  /* bypass vision */
        recalc_block_point(fcx, fcy);
        game.vision_full_recalc = 1;
        egrd.fcbeg++;
    }
    if (sawcorridor && !silently) await pline_The('corridor disappears.');
    // Only give the encased message while the hero is alive: paygd() ->
    // mongone() -> grddead() also lands here at game end (died: no message,
    // quit: message).
    const hp = Upolyd(u) ? u.mh : u.uhp;
    if (IS_OBSTRUCTED(levl_at(u.ux, u.uy)?.typ ?? STONE) && hp > 0 && !silently)
        await You('are encased in rock.');
    return true;
}

// C ref: vault.c blackout(x, y) — as a corridor square reverts to stone, mark
// it and its neighbours unlit so light cast inside the corridor does not
// reappear when a later tunnel reuses the area.  No RNG.
export function blackout(x, y) {
    for (let i = x - 1; i <= x + 1; ++i)
        for (let j = y - 1; j <= y + 1; ++j) {
            if (!isok(i, j)) continue;
            const lev = levl_at(i, j);
            if (!lev) continue;
            if (lev.typ === STONE) { lev.lit = false; lev.waslit = false; }
            unset_seenv(lev, x, y, i, j);
        }
}

// C ref: vault.c restfakecorr(grd).
export async function restfakecorr(grd) {
    if (await clear_fcorr(grd, false)) {
        grd.isgd = 0;               /* dmonsfree() should delete this mon */
        await mongone(grd);
    }
}

// C ref: vault.c parkguard(grd) — move the guard (dead or alive) to <0,0>
// until the temporary corridor is gone.  No RNG.
export function parkguard(grd) {
    if (grd === game.context?.polearm?.hitmon) game.context.polearm.hitmon = 0;
    if (grd.mx) {
        remove_monster(grd.mx, grd.my);
        newsym(grd.mx, grd.my);
    }
    if (m_at(0, 0) !== grd) place_monster(grd, 0, 0);
    // place_monster() just set grd->mx,my to 0,0, so this sets ogx,ogy to 0,0
    // too — C flags the oddity in a comment and keeps the behaviour.
    EGD(grd).ogx = grd.mx;
    EGD(grd).ogy = grd.my;
}

// C ref: vault.c grddead(grd) — called from mon.c mondead()/mongone().
export async function grddead(grd) {
    let dispose = await clear_fcorr(grd, true);

    if (!dispose) {
        /* destroy guard's gold; drop any other inventory */
        relobj(grd, grd.mx, grd.my);
        grd.mhp = 0;
        parkguard(grd);
        dispose = await clear_fcorr(grd, true);
    }
    if (dispose) grd.isgd = 0;      /* for dmonsfree() */
    return dispose;
}

// C ref: vault.c in_fcorridor(grd, x, y).
export function in_fcorridor(grd, x, y) {
    const egrd = EGD(grd);
    if (!egrd) return false;
    for (let fci = egrd.fcbeg; fci < egrd.fcend; fci++) {
        const fc = egrd.fakecorr[fci];
        if (fc && x === fc.fx && y === fc.fy) return true;
    }
    return false;
}

// C ref: vault.c findgd() — the guard on this level, if any.  C walks fmon,
// which makemon PREPENDS to, so it sees the newest monster first; this port's
// array is in creation order, hence the reverse walk.
export function findgd() {
    const u = game.u;
    const list = game.level?.monsters || [];
    for (let i = list.length - 1; i >= 0; i--) {
        const mtmp = list[i];
        if (mtmp.isgd && on_level(EGD(mtmp)?.gdlevel, u?.uz)) {
            if (!mtmp.mx && !EGD(mtmp).gddone) mtmp.mhp = mtmp.mhpmax;
            return mtmp;
        }
    }
    // Not on the level's list: look for a guard waiting to migrate here.
    const mig = game.migrating_mons;
    if (Array.isArray(mig)) {
        for (let i = 0; i < mig.length; i++) {
            const mtmp = mig[i];
            if (mtmp.isgd && on_level(EGD(mtmp)?.gdlevel, u?.uz)) {
                // Simplified mon_arrive(): take it out of migrating_mons and
                // park it at <0,0>.  mon_arrive proper would send it to limbo
                // when no regular map spot is available; C avoids that here.
                mig.splice(i, 1);
                game.level.monsters = game.level.monsters || [];
                game.level.monsters.push(mtmp);
                mtmp.mtrack = [];   /* mon_track_clear */
                mtmp.mux = u.ux; mtmp.muy = u.uy;
                mtmp.mx = 0; mtmp.my = 0;
                parkguard(mtmp);
                return mtmp;
            }
        }
    }
    return null;
}

// C ref: vault.c vault_summon_gd().
export function vault_summon_gd() {
    if (vault_occupied(game.u?.urooms) && !findgd())
        game.u.uinvault = (VAULT_GUARD_TIME - 1);
}

// C ref: vault.c vault_occupied(array) — the first room number in `array`
// whose rtype is VAULT, else '\0'.  js/shkroom.js in_rooms() returns C's
// buffer as an ARRAY of room numbers, which is what u.urooms holds here, so
// the "no vault" answer is 0 rather than '\0'.
export function vault_occupied(array) {
    for (const rno of (array || []))
        if (roomAt(rno - ROOMOFFSET)?.rtype === VAULT) return rno;
    return 0;
}

// C ref: vault.c uleftvault(grd) — the hero teleported out of the vault while
// a guard was active.  RNG: gd_move()'s.
export async function uleftvault(grd) {
    // Only called once the caller has checked vault_occupied() and findgd().
    if (!grd || !grd.isgd || DEADMONSTER(grd)) return;  /* C: impossible() */
    // Carrying gold and arriving anywhere but next to the guard sets him loose.
    if ((money_cnt_invent() || shk_hidden_gold(true))
        && um_dist(grd.mx, grd.my, 1)) {
        if (grd.mpeaceful) {
            if (canspotmon(grd))    /* see or sense via telepathy */
                await update_topl(`${Monnam(grd)} becomes irate.`);
            grd.mpeaceful = 0;      /* bypass setmangry() */
        }
        // Arriving outside the guard's temporary corridor gives him an extra
        // move to deliver his message and tear the corridor down.
        if (!in_fcorridor(grd, game.u.ux, game.u.uy)) await gd_move(grd);
    }
}

// C ref: vault.c find_guard_dest(guard, rx, ry) — the nearest corridor square
// (expanding square rings around the hero) the guard can escort to.  `out` is
// C's <*rx,*ry> pair.  No RNG on the success path.
export function find_guard_dest(guard, out) {
    const u = game.u;
    for (let dd = 2; (dd < ROWNO || dd < COLNO); dd++) {
        let incr_radius = false;
        for (let y = u.uy - dd; y <= u.uy + dd && !incr_radius; y++) {
            if (y < 0 || y > ROWNO - 1) continue;
            for (let x = u.ux - dd; x <= u.ux + dd; x++) {
                if (y !== u.uy - dd && y !== u.uy + dd && x !== u.ux - dd)
                    x = u.ux + dd;
                if (x < 1 || x > COLNO - 1) continue;
                if (guard && ((x === guard.mx && y === guard.my)
                              || (guard.isgd && in_fcorridor(guard, x, y))))
                    continue;
                if (levl_at(x, y)?.typ === CORR) {
                    const lx = (x < u.ux) ? x + 1 : (x > u.ux) ? x - 1 : x;
                    const ly = (y < u.uy) ? y + 1 : (y > u.uy) ? y - 1 : y;
                    const lt = levl_at(lx, ly)?.typ;
                    if (lt !== STONE && lt !== CORR) { incr_radius = true; break; }
                    out.x = x;
                    out.y = y;
                    return true;
                }
            }
        }
    }
    // C ref: vault.c:313 — impossible("Not a single corridor on this level?")
    // then tele().  The hero-teleport half is teleport.c's tele()/safe_teleds()
    // and js/teleport.js carries only the monster rloc half, so the relocation
    // is not performed here; see this port's deferred list.
    return false;
}

// C ref: vault.c invault() — called once per turn from the move loop.  Creates
// the guard, breaches the vault wall into a doorway, and interrogates the hero.
export async function invault() {
    const u = game.u;
    let vaultroom = vault_occupied(u.urooms) | 0;

    if (!vaultroom) { u.uinvault = 0; return; }
    u.uinvault = u.uinvault | 0;    /* C's you.h field is zero-initialised */

    // After a couple of guards fail to come back from the vault, future guards
    // become reluctant to turn up (even when summoned by whistle).
    const vgdeathcount = game.mvitals?.[PM_GUARD]?.died ?? 0;
    if (vgdeathcount < 2
        || (vgdeathcount < 50 && !rn2(vgdeathcount * vgdeathcount)))
        u.uinvault += 1;
    if (u.uinvault < VAULT_GUARD_TIME
        || (u.uinvault % Math.trunc(VAULT_GUARD_TIME / 2)) !== 0)
        return;

    let guard = findgd();
    if (guard) return;              /* only act "if time ok and no guard now" */

    let x, y, gdx, gdy, typ;
    const rc = { x: 0, y: 0 };

    /* first find the goal for the guard */
    if (!find_guard_dest(null, rc)) return;
    gdx = rc.x; gdy = rc.y;
    vaultroom -= ROOMOFFSET;

    /* next find a good place for a door in the wall */
    x = u.ux; y = u.uy;
    if (levl_at(x, y)?.typ !== ROOM) { /* player dug a door and is in it */
        if (levl_at(x + 1, y)?.typ === ROOM) x = x + 1;
        else if (levl_at(x, y + 1)?.typ === ROOM) y = y + 1;
        else if (levl_at(x - 1, y)?.typ === ROOM) x = x - 1;
        else if (levl_at(x, y - 1)?.typ === ROOM) y = y - 1;
        else if (levl_at(x + 1, y + 1)?.typ === ROOM) { x = x + 1; y = y + 1; }
        else if (levl_at(x - 1, y - 1)?.typ === ROOM) { x = x - 1; y = y - 1; }
        else if (levl_at(x + 1, y - 1)?.typ === ROOM) { x = x + 1; y = y - 1; }
        else if (levl_at(x - 1, y + 1)?.typ === ROOM) { x = x - 1; y = y + 1; }
    }
    while (levl_at(x, y)?.typ === ROOM) {
        const dx = (gdx > x) ? 1 : (gdx < x) ? -1 : 0;
        const dy = (gdy > y) ? 1 : (gdy < y) ? -1 : 0;
        if (Math.abs(gdx - x) >= Math.abs(gdy - y)) x += dx;
        else y += dy;
    }
    if (u_at(x, y)) {
        if (levl_at(x + 1, y)?.typ === HWALL || levl_at(x + 1, y)?.typ === DOOR)
            x = x + 1;
        else if (levl_at(x - 1, y)?.typ === HWALL || levl_at(x - 1, y)?.typ === DOOR)
            x = x - 1;
        else if (levl_at(x, y + 1)?.typ === VWALL || levl_at(x, y + 1)?.typ === DOOR)
            y = y + 1;
        else if (levl_at(x, y - 1)?.typ === VWALL || levl_at(x, y - 1)?.typ === DOOR)
            y = y - 1;
        else return;
    }

    /* make something interesting happen */
    // js/makemon.js has no MM_EGD arm, so newegd() runs here instead — the same
    // point in the sequence C allocates it (makemon.c:1237), no RNG either way.
    guard = makemon(monster_by_pmidx(PM_GUARD), x, y, MM_EGD | MM_NOMSG);
    if (!guard) return;
    newegd(guard);
    guard.isgd = 1;
    guard.mpeaceful = 1;
    set_malign(guard);
    const egrd = EGD(guard);
    egrd.gddone = 0;
    egrd.ogx = x;
    egrd.ogy = y;
    assign_level(egrd.gdlevel, u.uz);
    egrd.vroom = vaultroom;
    egrd.warncnt = 0;

    /* ensure the guard doesn't respawn next turn if killed immediately */
    u.uinvault++;

    await reset_faint();            /* if fainted - wake up */
    // Any boulder in the guard's way is destroyed, otherwise the hero could not
    // push one to follow him out of the vault.
    let otmp = sobj_at(BOULDER, guard.mx, guard.my);
    if (otmp) {
        const bname = xname(otmp);
        let bcnt = 0;
        do {
            ++bcnt;
            fracture_rock(otmp);
            otmp = sobj_at(BOULDER, guard.mx, guard.my);
        } while (otmp);
        const what = (bcnt === 1) ? an(bname) : makeplural(bname);
        // C: func = !Blind ? You_see : You_hear (You_hear handles Deaf itself).
        if (!Blind_hero()) await You(`see ${what} shatter.`);
        else await You_hear(`${what} shatter.`);
    }
    const spotted = canspotmon(guard);
    if (spotted) {
        await update_topl(`Suddenly one of the Vault's ${
            makeplural(guard.data?.name || 'guard')} enters!`);
        newsym(guard.mx, guard.my);
    } else {
        await update_topl('Someone else has entered the Vault.');
        // Make sure a hero who can't see the guard still learns where the wall
        // was breached, otherwise he could not follow the guard out.
        map_invisible(guard.mx, guard.my);
    }

    if (u.uswallow) {
        /* can't interrogate the hero, don't interrogate the engulfer */
        if (!Deaf()) await verbalize("What's going on here?");
        if (!spotted) await pline_The('other presence vanishes.');
        await mongone(guard);
        return;
    }
    const ap_obj = game.youmonst?.m_ap_type === 'obj';
    if (ap_obj || u.uundetected) {
        if (ap_obj && game.youmonst.mappearance !== 'gold piece') {
            if (!Deaf())
                await verbalize(`Hey!  Who left that ${
                    game.youmonst.mappearance || 'thing'} in here?`);
        }
        /* You're mimicking some object or you're hidden. */
        await update_topl(`Puzzled, ${mhe(guard)} turns around and leaves.`);
        await mongone(guard);
        return;
    }
    if (Strangled() || is_silent_hero() || (game.multi ?? 0) < 0) {
        if (Deaf())
            await update_topl(`${noit_Monnam(guard)} huffs and turns to leave.`);
        else
            await verbalize("I'll be back when you're ready to speak to me!");
        await mongone(guard);
        return;
    }

    await stop_occupation();        /* if occupied, stop it *now* */
    if ((game.multi ?? 0) > 0) { nomul(0); await unmul(null); }
    let buf = '';
    let trycount = 5;
    do {
        buf = mungspaces(await getlin(Deaf()
            ? 'You are required to supply your name. -'
            : '"Hello stranger, who are you?" -'));
    } while (!buf && --trycount > 0);

    const plname = game.plname || '';
    if (u.ualign?.type === A_LAWFUL
        /* ignore trailing text, in case the player includes a rank */
        && buf.slice(0, plname.length).toLowerCase() !== plname.toLowerCase())
        adjalign(-1);               /* Liar! */

    const eqi = (a, b) => a.toLowerCase() === b.toLowerCase();
    if (eqi(buf, 'Croesus') || eqi(buf, 'Kroisos') || eqi(buf, 'Creosote')) {
        if (!(game.mvitals?.[PM_CROESUS]?.died)) {
            if (Deaf()) {
                if (!Blind_hero())
                    await update_topl(`${noit_Monnam(guard)} waves goodbye.`);
            } else {
                await verbalize('Oh, yes, of course.  Sorry to have disturbed you.');
            }
            await mongone(guard);
        } else {
            await setmangry(guard, false);
            if (Deaf()) {
                if (!Blind_hero())
                    await update_topl(
                        `${noit_Monnam(guard)} mouths something and looks very angry!`);
            } else {
                await verbalize("Back from the dead, are you?  I'll remedy that!");
            }
            /* don't want the guard to waste next turn wielding a weapon */
            if (!MON_WEP(guard)) {
                guard.weapon_check = NEED_HTH_WEAPON;
                await mon_wield_item(guard);
            }
        }
        return;
    }
    if (Deaf())
        await update_topl(`${noit_Monnam(guard)} doesn't ${
            Blind_hero() ? '' : 'appear to '}recognize you.`);
    else
        await verbalize("I don't know you.");

    const umoney = money_cnt_invent();
    if (!umoney && !shk_hidden_gold(true)) {
        if (Deaf())
            await update_topl(`${noit_Monnam(guard)} stomps${
                Blind_hero() ? '' : ' and beckons'}.`);
        else
            await verbalize('Please follow me.');
    } else {
        if (!umoney) {
            if (Deaf()) {
                if (!Blind_hero())
                    await update_topl(`${noit_Monnam(guard)} glares at you${
                        (game.invent || []).length ? 'r stuff' : ''}.`);
            } else {
                await verbalize('You have hidden gold.');
            }
        }
        if (Deaf()) {
            if (!Blind_hero())
                await update_topl(`${noit_Monnam(guard)} holds out ${
                    noit_mhis(guard)} palm and beckons with ${
                    noit_mhis(guard)} other hand.`);
        } else {
            await verbalize('Most likely all your gold was stolen from this vault.');
            await verbalize('Please drop that gold and follow me.');
        }
        egrd.dropgoldcnt++;
    }
    egrd.gdx = gdx;
    egrd.gdy = gdy;
    egrd.fcbeg = 0;
    egrd.fakecorr[0] = { fx: x, fy: y, ftyp: 0, flags: 0 };
    typ = levl_at(x, y).typ;
    if (!IS_WALL(typ)) {
        // A guard arriving at a non-wall implies a door: the vault wall was dug
        // into an empty doorway (which locking magic could later have plugged).
        const rm = roomAt(egrd.vroom);
        const lowx = rm.lx, hix = rm.hx, lowy = rm.ly, hiy = rm.hy;

        if (x === lowx - 1 && y === lowy - 1) typ = TLCORNER;
        else if (x === hix + 1 && y === lowy - 1) typ = TRCORNER;
        else if (x === lowx - 1 && y === hiy + 1) typ = BLCORNER;
        else if (x === hix + 1 && y === hiy + 1) typ = BRCORNER;
        else if (y === lowy - 1 || y === hiy + 1) typ = HWALL;
        else if (x === lowx - 1 || x === hix + 1) typ = VWALL;

        // The original wall_info bit mask for this former wall is gone, so
        // recreate it.
        levl_at(x, y).typ = typ;    /* wall; changed to door below */
        levl_at(x, y).wall_info = 0;
        xy_set_wall_state(x, y);
    }
    egrd.fakecorr[0].ftyp = typ;
    egrd.fakecorr[0].flags = levl_at(x, y).flags;
    /* the guard's entry point, where the confrontation takes place */
    spot_stop_timers(x, y);
    levl_at(x, y).typ = DOOR;
    levl_at(x, y).doormask = D_NODOOR;
    unblock_point(x, y);            /* empty doorway doesn't block light */
    egrd.fcend = 1;
    egrd.warncnt = 1;
}

// C ref: vault.c move_gold(gold, vroom).  RNG: rn2(2), rn2(2).
export function move_gold(gold, vroom) {
    remove_object(gold);
    newsym(gold.ox, gold.oy);
    const rm = roomAt(vroom);
    const nx = rm.lx + rn2(2);
    const ny = rm.ly + rn2(2);
    place_object(gold, nx, ny);
    stackobj(gold);
    newsym(nx, ny);
}

// C ref: vault.c wallify_vault(grd) — restore the vault's walls, sweeping
// monsters/gold/rocks out of them.  RNG: rloc() per displaced monster and
// move_gold()'s two rn2(2) per displaced pile.
export async function wallify_vault(grd) {
    const rm = roomAt(EGD(grd).vroom);
    const lox = rm.lx - 1, hix = rm.hx + 1, loy = rm.ly - 1, hiy = rm.hy + 1;
    let fixed = false, movedgold = false;

    for (let x = lox; x <= hix; x++)
        for (let y = loy; y <= hiy; y++) {
            /* if not on the room boundary, skip ahead */
            if (x !== lox && x !== hix && y !== loy && y !== hiy) continue;

            const loc = levl_at(x, y);
            if (!loc) continue;
            if ((!IS_WALL(loc.typ) || g_at(x, y)
                 || sobj_at(ROCK, x, y) || sobj_at(BOULDER, x, y))
                && !in_fcorridor(grd, x, y)) {
                const mon = m_at(x, y);
                if (mon && mon !== grd) {
                    if (mon.mtame) await yelp(mon);
                    if (!(await rloc(mon, RLOC_MSG))) m_into_limbo(mon);
                }
                /* move gold at wall locations into the vault */
                const gold = g_at(x, y);
                if (gold) { move_gold(gold, EGD(grd).vroom); movedgold = true; }
                /* destroy rocks and boulders (subsume them into the walls);
                   other objects present stay intact and become embedded */
                let rocks;
                while ((rocks = sobj_at(ROCK, x, y)) != null) {
                    obj_extract_self(rocks);
                    obfree(rocks);
                }
                while ((rocks = sobj_at(BOULDER, x, y)) != null) {
                    obj_extract_self(rocks);
                    obfree(rocks);
                }
                const trap = t_at(x, y);
                if (trap) deltrap(trap);

                let typ;
                if (x === lox)
                    typ = (y === loy) ? TLCORNER : (y === hiy) ? BLCORNER : VWALL;
                else if (x === hix)
                    typ = (y === loy) ? TRCORNER : (y === hiy) ? BRCORNER : VWALL;
                else /* not left or right side, must be top or bottom */
                    typ = HWALL;

                loc.typ = typ;
                loc.wall_info = 0;
                xy_set_wall_state(x, y);
                del_engr_at(x, y);
                // hack: the player knows the walls are restored because of the
                // message below, so show this on the screen.
                const viz = game.viz_array;
                const tmp_viz = viz?.[y]?.[x];
                if (viz?.[y]) viz[y][x] = IN_SIGHT | COULD_SEE;
                newsym(x, y);
                if (viz?.[y]) viz[y][x] = tmp_viz;
                block_point(x, y);
                fixed = true;
            }
        }

    if (movedgold || fixed) {
        if (in_fcorridor(grd, grd.mx, grd.my) || cansee(grd.mx, grd.my))
            await update_topl(`${noit_Monnam(grd)} whispers an incantation.`);
        else
            await You_hear('a distant chant.');
        if (movedgold)
            await update_topl('A mysterious force moves the gold into the vault.');
        if (fixed)
            await pline_The("damaged vault's walls are magically restored!");
    }
}

// C ref: vault.c gd_mv_monaway(grd, nx, ny) — shove whoever is in the guard's
// way.  RNG: rloc().
export async function gd_mv_monaway(grd, nx, ny) {
    const mtmp = m_at(nx, ny);
    if (mtmp && mtmp !== grd) {
        if (!Deaf()) await verbalize('Out of my way, scum!');
        if (!(await rloc(mtmp, RLOC_ERR | RLOC_MSG)) || m_at(nx, ny))
            m_into_limbo(mtmp);
        recalc_block_point(nx, ny);
    }
}

// C ref: vault.c gd_pick_corridor_gold(grd, goldx, goldy) — the guard picks
// gold off the corridor floor, stepping to it for the message and back after.
// RNG: ten enexto() calls (tryct starts at 9 and the loop is do/while
// --tryct >= 0), only when the gold is under the hero, the guard is 3+ away,
// and the player can see the square.
export async function gd_pick_corridor_gold(grd, goldx, goldy) {
    const guardx = grd.mx, guardy = grd.my;
    const under_u = u_at(goldx, goldy);
    const see_it = cansee(goldx, goldy);

    if (under_u) {
        // Grab the gold from between the hero's feet.  If the guard is two or
        // more steps away, bring him closer first.
        const gold = g_at(goldx, goldy);
        if (!gold) return;          /* C: impossible("no gold at hero's feet?") */
        const gdelta = distu(guardx, guardy);
        if (gdelta > 2 && see_it) { /* skip if the player won't see it */
            let bestdelta = gdelta;
            const bestcc = { x: guardx, y: guardy };
            let tryct = 9;
            do {
                // Pick an available spot nearest the hero, and among those the
                // one nearest the guard's current location.
                const newcc = enexto_spawn(goldx, goldy, grd.data);
                if (newcc) {
                    const newdelta = distu(newcc.x, newcc.y);
                    if (newdelta < bestdelta
                        || (newdelta === bestdelta
                            && dist2(newcc.x, newcc.y, guardx, guardy)
                               < dist2(bestcc.x, bestcc.y, guardx, guardy))) {
                        bestdelta = newdelta;
                        bestcc.x = newcc.x; bestcc.y = newcc.y;
                    }
                }
            } while (--tryct >= 0);

            if (bestdelta < gdelta) {
                remove_monster(guardx, guardy);
                newsym(guardx, guardy);
                place_monster(grd, bestcc.x, bestcc.y);
                newsym(grd.mx, grd.my);
            }
        }
        obj_extract_self(gold);
        add_to_minv(grd, gold);
        newsym(goldx, goldy);

    /* guard is already at the gold's location */
    } else if (goldx === guardx && goldy === guardy) {
        mpickgold(grd);             /* does a newsym */

    /* gold is at some third spot, neither guard's nor hero's */
    } else {
        /* just for insurance... */
        await gd_mv_monaway(grd, goldx, goldy);  /* make room for the guard */
        if (see_it) {               /* skip if the player won't see the message */
            remove_monster(grd.mx, grd.my);
            newsym(grd.mx, grd.my);
            place_monster(grd, goldx, goldy);    /* sets <grd->mx, grd->my> */
        }
        mpickgold(grd);             /* does a newsym */
    }

    if (see_it) {                   /* cansee(goldx, goldy) */
        await update_topl(`${Some_Monnam(grd)}${
            (grd.mpeaceful && EGD(grd).warncnt > 5) ? ' calms down and' : ''
        } picks up the gold${under_u ? ' from beneath you' : ''}.`);
    }

    /* if the guard was moved to get the gold, move him back */
    if (grd.mx !== guardx || grd.my !== guardy) {
        remove_monster(grd.mx, grd.my);
        newsym(grd.mx, grd.my);
        place_monster(grd, guardx, guardy);
        newsym(guardx, guardy);
    }
}

// C ref: vault.c gd_move_cleanup(grd, semi_dead, disappear_msg_seen).
// return 1: guard moved, -2: died.
export async function gd_move_cleanup(grd, semi_dead, disappear_msg_seen) {
    // C's kludge: the guard has to stay around so the fake corridor can be
    // erased as the hero walks out of it, but must also be out of the way, so
    // he is sent to never-never land with ogx/ogy set to mx/my.  He is finally
    // killed in restfakecorr().
    const x = grd.mx, y = grd.my;
    const see_guard = canspotmon(grd);
    parkguard(grd);                 /* move to <0,0> */
    await wallify_vault(grd);
    await restfakecorr(grd);
    if (!semi_dead && (in_fcorridor(grd, game.u.ux, game.u.uy) || cansee(x, y))) {
        if (!disappear_msg_seen && see_guard)
            await update_topl(`Suddenly, ${noit_mon_nam(grd)} disappears.`);
        return 1;
    }
    return -2;
}

// C ref: vault.c gd_letknow(grd).
export async function gd_letknow(grd) {
    if (!cansee(grd.mx, grd.my) || !mon_visible(grd)) {
        await You_hear(`${m_carrying(grd, TIN_WHISTLE)
            ? "the shrill sound of a guard's whistle" : 'angry shouting'}.`);
    } else {
        // x_monnam(grd, ARTICLE_A, "angry", 0, FALSE) == "an angry guard"
        const nm = an(`angry ${grd.data?.name || 'guard'}`);
        await You(um_dist(grd.mx, grd.my, 2)
            ? `see ${nm} approaching.`
            : `are confronted by ${nm}.`);
    }
}

// C ref: vault.c gd_move(grd).
// return  1: guard moved,  0: guard didn't,  -1: let m_move do it,  -2: died.
export async function gd_move(grd) {
    const u = game.u;
    const egrd = EGD(grd);
    let nx = 0, ny = 0, m, n, ex, ey, dx = 0, dy = 0, ggx = 0, ggy = 0;
    let typ = STONE, crm = null;
    let goldincorridor = false, newspot = false;
    const semi_dead = DEADMONSTER(grd);

    if (!on_level(egrd.gdlevel, u.uz)) return -1;

    if (semi_dead || !grd.mx || egrd.gddone) {
        egrd.gddone = 1;
        return await gd_move_cleanup(grd, semi_dead, false);
    }

    const u_in_vault = vault_occupied(u.urooms) ? true : false;
    const grd_in_vault = in_rooms(grd.mx, grd.my, VAULT).length > 0;
    if (!u_in_vault && !grd_in_vault) await wallify_vault(grd);

    if (!grd.mpeaceful) {
        if (!u_in_vault
            && (grd_in_vault || (in_fcorridor(grd, grd.mx, grd.my)
                                 && !in_fcorridor(grd, u.ux, u.uy)))) {
            await rloc(grd, RLOC_MSG);
            await wallify_vault(grd);
            if (!in_fcorridor(grd, grd.mx, grd.my)) await clear_fcorr(grd, true);
            await gd_letknow(grd);
            return -1;
        }
        if (!in_fcorridor(grd, grd.mx, grd.my)) await clear_fcorr(grd, true);
        return -1;
    }
    if (Math.abs(egrd.ogx - grd.mx) > 1 || Math.abs(egrd.ogy - grd.my) > 1)
        return -1;                  /* teleported guard - treat as monster */

    if (egrd.witness) {
        if (!Deaf())
            await verbalize(`How dare you ${
                (egrd.witness & GD_EATGOLD) ? 'consume' : 'destroy'
            } that gold, scoundrel!`);
        egrd.witness = 0;
        grd.mpeaceful = 0;
        return -1;
    }

    const umoney = money_cnt_invent();
    const u_carry_gold = (umoney > 0 || shk_hidden_gold(true) > 0);
    if (egrd.fcend === 1) {
        if (u_in_vault && (u_carry_gold || um_dist(grd.mx, grd.my, 1))) {
            if (egrd.warncnt === 3 && !Deaf()) {
                const b = `${u_carry_gold
                    ? (!umoney ? 'drop that hidden gold and ' : 'drop that gold and ')
                    : ''}follow me!`;
                if (egrd.dropgoldcnt || !u_carry_gold)
                    await verbalize(`I repeat, ${b}`);
                else
                    await verbalize(upstart(b));
                if (u_carry_gold) egrd.dropgoldcnt++;
            }
            if (egrd.warncnt === 7) {
                m = grd.mx;
                n = grd.my;
                if (!Deaf()) await verbalize("You've been warned, knave!");
                grd.mpeaceful = 0;
                await mnexto(grd);
                levl_at(m, n).typ = egrd.fakecorr[0].ftyp;
                levl_at(m, n).flags = egrd.fakecorr[0].flags;
                recalc_block_point(m, n);
                del_engr_at(m, n);
                newsym(m, n);
                return -1;
            }
            /* not fair to get mad when (s)he's fainted or paralyzed */
            if (!is_fainted() && (game.multi ?? 0) >= 0) egrd.warncnt++;
            return 0;
        }

        if (!u_in_vault) {
            if (u_carry_gold) {     /* player teleported */
                m = grd.mx;
                n = grd.my;
                await rloc(grd, RLOC_MSG);
                levl_at(m, n).typ = egrd.fakecorr[0].ftyp;
                levl_at(m, n).flags = egrd.fakecorr[0].flags;
                recalc_block_point(m, n);   /* guard corridor goes away */
                del_engr_at(m, n);
                newsym(m, n);
                grd.mpeaceful = 0;
                await gd_letknow(grd);
                return -1;
            } else {
                if (!Deaf()) await verbalize('Well, begone.');
                egrd.gddone = 1;
                return await gd_move_cleanup(grd, semi_dead, false);
            }
        }
    }

    if (egrd.fcend > 1) {
        if (egrd.fcend > 2 && in_fcorridor(grd, grd.mx, grd.my)
            && !egrd.gddone && !in_fcorridor(grd, u.ux, u.uy)
            && (levl_at(egrd.fakecorr[0].fx, egrd.fakecorr[0].fy).typ
                === egrd.fakecorr[0].ftyp)) {
            await update_topl(`${noit_Monnam(grd)}, confused, disappears.`);
            return await gd_move_cleanup(grd, semi_dead, true);
        }
        if (u_carry_gold && (in_fcorridor(grd, u.ux, u.uy)
                             /* cover a 'blind' spot */
                             || (egrd.fcend > 1 && u_in_vault))) {
            if (!grd.mx) {
                await restfakecorr(grd);
                return -2;
            }
            if (egrd.warncnt < 6) {
                egrd.warncnt = 6;
                if (Deaf()) {
                    if (!Blind_hero())
                        await update_topl(`${noit_Monnam(grd)} holds out ${
                            noit_mhis(grd)} palm demandingly!`);
                } else {
                    await verbalize('Drop all your gold, scoundrel!');
                }
                return 0;
            } else {
                if (Deaf()) {
                    if (!Blind_hero())
                        await update_topl(`${noit_Monnam(grd)} rubs ${
                            noit_mhis(grd)} hands with enraged delight!`);
                } else {
                    await verbalize('So be it, rogue!');
                }
                grd.mpeaceful = 0;
                return -1;
            }
        }
    }
    m = 0; n = 0;
    for (let fci = egrd.fcbeg; fci < egrd.fcend; fci++) {
        const fc = egrd.fakecorr[fci];
        if (g_at(fc.fx, fc.fy)) {
            m = fc.fx;
            n = fc.fy;
            goldincorridor = true;
            break;
        }
    }
    // New gold can appear if it was embedded in stone and the hero kicks it
    // (or even via wish and drop), so don't assume the hero has been warned.
    if (goldincorridor && !egrd.gddone) {
        await gd_pick_corridor_gold(grd, m, n);
        if (!grd.mpeaceful) return -1;
        egrd.warncnt = 5;
        return 0;
    }
    if (um_dist(grd.mx, grd.my, 1) || egrd.gddone) {
        // C ref: vault.c:1067 — the one rn2(10) this function draws.
        if (!egrd.gddone && !rn2(10) && !Deaf() && !u.uswallow
            && !(u.ustuck && !sticks_hero()))
            await verbalize('Move along!');
        await restfakecorr(grd);
        return 0;                   /* didn't move */
    }
    const x = grd.mx, y = grd.my;

    // C's control flow here is four labels (nextnxy / nextpos / proceed /
    // newpos); `state` reproduces the gotos exactly.
    let state = u_in_vault ? 'nextpos' : 'search';

    if (state === 'search') {
        /* look around (hor & vert only) for accessible places */
        state = 'nextpos';          /* fall through when the scan finds nothing */
        scan:
        for (nx = x - 1; nx <= x + 1; nx++) {
            for (ny = y - 1; ny <= y + 1; ny++) {
                if ((nx === x || ny === y) && (nx !== x || ny !== y)
                    && isok(nx, ny)) {
                    crm = levl_at(nx, ny);
                    typ = crm.typ;
                    if (!IS_STWALL(typ) && !IS_POOL_TYP(typ)) {
                        if (in_fcorridor(grd, nx, ny)) continue;  /* nextnxy */
                        if (in_rooms(nx, ny, VAULT).length > 0) continue;

                        /* seems we found a good place to leave him alone */
                        egrd.gddone = 1;
                        if (ACCESSIBLE(typ)) { state = 'newpos'; break scan; }
                        crm.typ = (typ === SCORR) ? CORR : DOOR;
                        if (crm.typ === DOOR) crm.doormask = D_NODOOR;
                        else crm.flags = 0;
                        del_engr_at(nx, ny);
                        state = 'proceed';
                        break scan;
                    }
                }
            }
        }
    }

    while (state === 'nextpos' || state === 'proceed') {
        if (state === 'nextpos') {
            nx = x;
            ny = y;
            ggx = egrd.gdx;
            ggy = egrd.gdy;
            dx = (ggx > x) ? 1 : (ggx < x) ? -1 : 0;
            dy = (ggy > y) ? 1 : (ggy < y) ? -1 : 0;
            if (Math.abs(ggx - x) >= Math.abs(ggy - y)) nx += dx;
            else ny += dy;

            let jumped = false;
            for (;;) {
                crm = levl_at(nx, ny);
                typ = crm.typ;
                if (typ === STONE) break;
                ex = nx + nx - x;
                ey = ny + ny - y;
                // Given the above we must have IS_WALL(typ) or typ == POOL.
                if (isok(ex, ey) && IS_ROOM(levl_at(ex, ey).typ)) {
                    crm.typ = DOOR;
                    crm.doormask = D_NODOOR;
                    del_engr_at(ex, ey);
                    jumped = true;
                    break;
                }
                if (dy && nx !== x) { nx = x; ny = y + dy; continue; }
                if (dx && ny !== y) { ny = y; nx = x + dx; dy = 0; continue; }
                /* I don't like this, but ... */
                if (IS_ROOM(typ)) {
                    crm.typ = DOOR;
                    crm.doormask = D_NODOOR;
                    del_engr_at(ex, ey);
                    jumped = true;
                    break;
                }
                break;
            }
            if (!jumped) { crm.typ = CORR; crm.flags = 0; }
            state = 'proceed';
        }

        /* proceed: */
        newspot = true;
        unblock_point(nx, ny);      /* doesn't block light */
        if (cansee(nx, ny)) newsym(nx, ny);

        if ((nx !== ggx || ny !== ggy) || (grd.mx !== ggx || grd.my !== ggy)) {
            const fcp = { fx: 0, fy: 0, ftyp: 0, flags: 0 };
            egrd.fakecorr[egrd.fcend] = fcp;
            // C: `if (egrd->fcend++ == FCSIZ) panic("fakecorr overflow")` —
            // the array is sized FCSIZ, so this is the overflow guard.
            if (egrd.fcend++ === FCSIZ) return -1;
            fcp.fx = nx;
            fcp.fy = ny;
            fcp.ftyp = typ;
            fcp.flags = crm.flags;
            state = 'newpos';
        } else if (!egrd.gddone) {
            /* We're stuck, so try to find a new destination. */
            const rc = { x: egrd.gdx, y: egrd.gdy };
            const found = find_guard_dest(grd, rc);
            egrd.gdx = rc.x;
            egrd.gdy = rc.y;
            if (!found || (egrd.gdx === ggx && egrd.gdy === ggy)) {
                await update_topl(`${Monnam(grd)}, confused, disappears.`);
                return await gd_move_cleanup(grd, semi_dead, true);
            }
            state = 'nextpos';
        } else {
            state = 'newpos';
        }
    }

    /* newpos: */
    await gd_mv_monaway(grd, nx, ny);
    if (egrd.gddone) return await gd_move_cleanup(grd, semi_dead, false);
    egrd.ogx = grd.mx;              /* update old positions */
    egrd.ogy = grd.my;
    remove_monster(grd.mx, grd.my);
    place_monster(grd, nx, ny);
    if (newspot && g_at(nx, ny)) {
        // Gold already here (most likely from mineralize()): pick it up now so
        // the guard doesn't later think the hero dropped it and give an
        // inappropriate message.
        mpickgold(grd);
        if (canspotmon(grd))
            await update_topl(`${Monnam(grd)} picks up some gold.`);
    } else {
        newsym(grd.mx, grd.my);
    }
    await restfakecorr(grd);
    return 1;
}

// C ref: vault.c paygd(silently) — dying or quitting with a vault guard
// around.  RNG: rn2(2), rn2(2) for the grave spot on the hostile path, plus
// currency()'s hallucination roll.
export async function paygd(silently) {
    const u = game.u;
    const grd = findgd();
    const umoney = money_cnt_invent();
    let gdx = 0, gdy = 0;

    if (!umoney || !grd) return;

    let deposit = true;
    if (u.uinvault) {
        if (!silently)
            await Your(`${umoney} ${currency(umoney)
            } goes into the Magic Memory Vault.`);
        gdx = u.ux;
        gdy = u.uy;
    } else if (grd.mpeaceful) {
        /* peaceful guard has no "right" to your gold */
        deposit = false;            /* C: goto remove_guard */
    } else {
        await mnexto(grd);
        if (!silently)
            await update_topl(`${Monnam(grd)} remits your gold to the vault.`);
        const rm = roomAt(EGD(grd).vroom);
        gdx = rm.lx + rn2(2);
        gdy = rm.ly + rn2(2);
        make_grave(gdx, gdy,
            `To Croesus: here's the gold recovered from ${game.plname} the ${
                hero_pmname()}.`);
    }
    if (deposit) {
        for (const coins of [...(game.invent || [])]) {
            if ((objects?.[coins.otyp]?.oc_class ?? coins.oclass) === COIN_CLASS) {
                freeinv(coins);
                place_object(coins, gdx, gdy);
                stackobj(coins);
            }
        }
    }
    /* remove_guard: */
    await mongone(grd);
}

// C ref: vault.c hidden_gold(even_if_unknown) — gold in carried containers.
// js/shk.js already carries the faithful copy, so it is re-exported here
// rather than forked; there is one implementation.
export const hidden_gold = shk_hidden_gold;

// C ref: vault.c gd_sound() — prevent "You hear footsteps..." when
// inappropriate.
export function gd_sound() {
    return !(vault_occupied(game.u?.urooms) || findgd());
}

// C ref: vault.c vault_gd_watching(activity).
export function vault_gd_watching(activity) {
    const guard = findgd();
    if (guard && guard.mx && guard.mcansee && m_canseeu(guard)) {
        if (activity === GD_EATGOLD || activity === GD_DESTROYGOLD)
            EGD(guard).witness = activity;
    }
}

// C ref: pmname(&mons[u.umonster], flags.female ? FEMALE : MALE) — the hero's
// own player-monster name, for paygd()'s grave epitaph.  u.umonster is not
// tracked separately here, so the role's player monster is looked up by name.
function hero_pmname() {
    const nm = monster_by_pmidx(game.u?.umonster)?.name;
    return nm || (game.u?.female ? 'woman' : 'man');
}

/*
 * ---------------------------------------------------------------------------
 * CALL SITES C HAS THAT OTHER FILES MUST STILL WIRE UP.  Each is a one-line
 * hook in a file outside this module's write lease:
 *
 *   allmain.c moveloop_core   -> invault()          [js/allmain.js, after
 *                                                    exerchk(), before the
 *                                                    u_wipe_engr roll]
 *   monmove.c:1808            -> gd_move()          [js/monmove.js, in the
 *                                                    isshk/isgd/ispriest arm]
 *   mon.c:1236                -> gd_move()          [js/mon.js movemon, for a
 *                                                    guard parked at <0,0>]
 *   mon.c:3109 / :3273        -> grddead()          [mondead() / mongone()]
 *   end.c done()              -> paygd()            [js/end.js]
 *   sounds.c dosounds()       -> gd_sound()         [js/sounds.js has local
 *                                                    stubs that always answer
 *                                                    "no guard"]
 *   read.c scare-monster      -> vault_summon_gd()  [js/read.js:1001]
 *   teleport.c teleds()       -> uleftvault()       [js/teleport.js]
 *   trap.c tele_trap()        -> vault_tele()       [teleport.c's; it needs
 *                                                    search_special(VAULT) +
 *                                                    somexy(), which is the
 *                                                    rn2(2)/rn2(2) at
 *                                                    seed0012 step 237]
 *   eat.c / zap.c gold gone   -> vault_gd_watching(GD_EATGOLD/GD_DESTROYGOLD)
 * ---------------------------------------------------------------------------
 */
