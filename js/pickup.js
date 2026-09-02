// pickup.js - picking objects up, and container use.
// C ref: src/pickup.c
//
// One JS function per C function.  Where a routine's window half needs the tty
// menu code that js/invent.js owns, the selection is delegated there and the
// branch/count logic stays here, on C's line order.

import { game } from './gstate.js';
import { Blind } from './vision.js';
import { rn2, rnd, d } from './rng.js';
import { pline, bot, m_at, newsym, flush_screen, y_n, update_topl } from './display.js';
import {
    isok, is_pit, is_hole, TT_PIT,
    SLT_ENCUMBER, MOD_ENCUMBER, HVY_ENCUMBER, EXT_ENCUMBER,
    UNENCUMBERED, OVERLOADED,
    IS_ALTAR, IS_GRAVE, IS_THRONE, STONE, POOL, MOAT, WATER, LAVAPOOL,
    MENU_TRADITIONAL, MENU_COMBINATION, MENU_FULL, MENU_PARTIAL,
} from './const.js';
import {
    COIN_CLASS, MAXOCLASSES, CORPSE, STATUE, BOULDER, LOADSTONE, GOLD_PIECE,
    SCR_SCARE_MONSTER, WAN_CANCELLATION, AMULET_OF_YENDOR, BELL_OF_OPENING,
    LARGE_BOX, CHEST, ICE_BOX, BAG_OF_HOLDING, BAG_OF_TRICKS, HORN_OF_PLENTY,
    objects, weight, add_to_container, place_object, start_corpse_timeout,
} from './mkobj.js';
import {
    invlet_basic, inventoryArray, near_capacity, inv_weight, xname,
    obj_doname as doname, otense, currency, merge_choice, addinv, freeinv,
    obj_here, prinv, is_worn, count_unpaid, count_buc, look_here, tally_BUCX,
    ansimpleoname, display_inventory_interactive,
    describe_decor, sortloot, unsortloot, will_feel_cockatrice, feel_cockatrice,
    SORTLOOT_LOOT, SORTLOOT_INVLET, SORTLOOT_PACK, SORTLOOT_PETRIFY,
    GETOBJ_EXCLUDE, GETOBJ_EXCLUDE_SELECTABLE, GETOBJ_DOWNPLAY, GETOBJ_SUGGEST,
    ECMD_OK, ECMD_TIME, objects_at, pickup_menu_select, splitobj,
    obj_extract_self, obfree, makeknown, ynq, newsym_force, encumber_msg,
    stackobj, touch_artifact, trycall, useup, useupf, hold_another_object,
    remove_worn_item, g_at, renderWindowScreen, bimanual, is_weptool,
    W_ARMOR_WORN, W_ACCESSORY_WORN, W_WEAPONS_WORN,
} from './invent.js';
import { monster_by_pmidx } from './makemon.js';
import { mflags1_of, mflags2_of, M1_NOTAKE, M1_NOHANDS, M1_NOLIMBS,
         M2_ROCKTHROW } from './monflags_data.js';
import { makesingular } from './objnam.js';
import { costly_spot } from './shkroom.js';
import { hliquid } from './dungeon.js';

/* pickup.c:12 */
export const CONTAINED_SYM = '>';

/* pickup.c:59-62 */
function GOLD_WT(n) { return Math.trunc((n + 50) / 100); }
function GOLD_CAPACITY(w, n) { return (w * -100) - (n + 50) - 1; }

/* pickup.c:66-70 */
const slightloadpfx = 'You have a little trouble',
    moderateloadpfx = 'You have trouble',
    nearloadpfx = 'You have much trouble',
    overloadpfx = 'You have extreme difficulty';

/* hack.h query_objlist() flags */
export const BY_NEXTHERE = 0x01;
export const INCLUDE_VENOM = 0x02;
export const AUTOSELECT_SINGLE = 0x04;
export const USE_INVLET = 0x08;
export const INVORDER_SORT = 0x10;
export const SIGNAL_NOMENU = 0x20;
export const SIGNAL_ESCAPE = 0x40;
export const FEEL_COCKATRICE = 0x80;
export const INCLUDE_HERO = 0x100;

/* hack.h query_category() flags (BY_NEXTHERE/INCLUDE_VENOM's 0x01/0x02 are
   deliberately skipped -- C combines both flag spaces into one qflags int). */
export const ALL_TYPES = 0x20;
export const ALL_TYPES_SELECTED = -2;
export const UNPAID_TYPES = 0x04;
export const WORN_TYPES = 0x10;
export const BILLED_TYPES = 0x40;
export const CHOOSE_ALL = 0x80;
export const BUC_BLESSED_F = 0x100;
export const BUC_CURSED_F = 0x200;
export const BUC_UNCURSED_F = 0x400;
export const BUC_UNKNOWN_F = 0x800;
export const BUCX_TYPES = BUC_BLESSED_F | BUC_CURSED_F | BUC_UNCURSED_F
    | BUC_UNKNOWN_F;
export const JUSTPICKED = 0x1000;

/* obj.h u_safe_from_fatal_corpse() test bits */
export const st_gloves = 1, st_corpse = 2, st_petrifies = 4, st_resists = 8;
export const st_all = st_gloves | st_corpse | st_petrifies | st_resists;

/* pickup.c:3676 tipping_check_values */
export const TIPCHECK_OK = 0, TIPCHECK_LOCKED = 1, TIPCHECK_TRAPPED = 2,
    TIPCHECK_CANNOT = 3, TIPCHECK_EMPTY = 4;

export const PICK_NONE = 0, PICK_ONE = 1, PICK_ANY = 2;

/* invent.c count_buc() type codes */
const BUC_BLESSED = 1, BUC_UNCURSED = 2, BUC_CURSED = 3, BUC_UNKNOWN = 4;

/* obj.h how_lost values */
const LOST_THROWN = 1, LOST_DROPPED = 2, LOST_STOLEN = 3, LOST_EXPLODING = 4;

/* invent.c look_here() flags */
const LOOKHERE_NOFLAGS = 0, LOOKHERE_PICKED_SOME = 1,
    LOOKHERE_SKIP_DFEATURE = 2;

/* ── the C globals this file owns ──────────────────────────────────────── */

function flags() { game.flags = game.flags || {}; return game.flags; }
function iflags() { game.iflags = game.iflags || {}; return game.iflags; }
function ustate() { game.u = game.u || {}; return game.u; }
/* gv.valid_menu_classes, gc.class_filter, gb.bucx_filter, gs.shop_filter,
   gp.picked_filter, gv.val_for_n_or_more, ga.abort_looting,
   gc.current_container, gs.sellobj_first, gl.loot_reset_justpicked */
function P() {
    if (!game._pickup) {
        game._pickup = {
            valid_menu_classes: '', vmc_count: 0,
            class_filter: false, bucx_filter: false, shop_filter: false,
            picked_filter: false, val_for_n_or_more: 0,
            abort_looting: false, current_container: null,
            sellobj_first: true, loot_reset_justpicked: false,
        };
    }
    return game._pickup;
}
/* gp.pickup_encumbrance already lives on game as _pickup_encumbrance (set by
   js/invent.js's pick_one_obj); keep the single copy. */
function pickup_encumbrance() { return game._pickup_encumbrance || 0; }
function set_pickup_encumbrance(v) { game._pickup_encumbrance = v; }

/* an object chain that may be a JS array (invent, cobj, floor pile) or a real
   nobj/nexthere linked list */
function* objchain(list, by_nexthere = false) {
    if (!list) return;
    if (Array.isArray(list)) { for (const o of list) if (o) yield o; return; }
    for (let o = list; o; o = by_nexthere ? o.nexthere : o.nobj) yield o;
}
function chain_to_array(list, by_nexthere = false) {
    return Array.from(objchain(list, by_nexthere));
}

function Has_contents(obj) { return !!(obj?.cobj && obj.cobj.length); }
function Is_container(obj) {
    const t = obj?.otyp;
    return t >= LARGE_BOX && t <= BAG_OF_TRICKS;
}
function Is_box(obj) {
    const t = obj?.otyp;
    return t === LARGE_BOX || t === CHEST || t === ICE_BOX;
}
function Is_mbag(obj) {
    return obj?.otyp === BAG_OF_HOLDING || obj?.otyp === BAG_OF_TRICKS;
}
/* objclass.h SchroedingersBox(o) */
function SchroedingersBox(obj) {
    return obj?.otyp === LARGE_BOX && (obj?.spe | 0) === 1;
}
function carried(obj) {
    return !!obj && (obj.where === 'invent' || inventoryArray().includes(obj));
}
function money_cnt(list) {
    let sum = 0;
    for (const obj of objchain(list)) {
        if (obj.oclass === COIN_CLASS) sum += obj.quan || 0;
        if (Has_contents(obj)) sum += money_cnt(obj.cobj);
    }
    return sum;
}
/* hack.c max_capacity() — inv_weight() also refreshes gw.wc (game._wc). */
function max_capacity() {
    const wt = inv_weight();
    return wt - (2 * (game._wc || 1));
}
/* hack.c calc_capacity(xtra_wt) */
function calc_capacity(xtra_wt) {
    const wt = inv_weight() + (xtra_wt || 0);
    if (wt <= 0) return UNENCUMBERED;
    const wc = game._wc;
    if (wc <= 1) return OVERLOADED;
    return Math.min(Math.trunc((wt * 2) / wc) + 1, OVERLOADED);
}
/* hack.c inv_cnt(incl_gold) */
function inv_cnt(incl_gold) {
    let n = 0;
    for (const obj of inventoryArray())
        if (incl_gold || obj.oclass !== COIN_CLASS) ++n;
    return n;
}
/* objnam.c the() */
function the(s) {
    const str = String(s ?? '');
    if (/^(the |The |a |an |A |An |your |Your |his |her |its |their )/.test(str))
        return str;
    if (/^[A-Z]/.test(str)) return str;
    return `the ${str}`;
}
function The(s) { const t = the(s); return t.charAt(0).toUpperCase() + t.slice(1); }
function upstart(s) {
    const str = String(s ?? '');
    return str.charAt(0).toUpperCase() + str.slice(1);
}
function plur(n) { return Number(n) === 1 ? '' : 's'; }
function thesimpleoname(obj) { return the(xname(obj)); }

/* objclass.h def_oc_syms[].sym, indexed by oclass */
const def_oc_syms = [
    '\0', ']', ')', '[', '=', '"', '(', '%', '!', '?',
    '+', '/', '$', '*', '`', '0', '_', '.',
];
export function def_char_to_objclass(sym) {
    const ix = def_oc_syms.indexOf(sym);
    return ix < 0 ? MAXOCLASSES : ix;
}
/* options.c def_inv_order[] */
const def_inv_order = [12, 5, 2, 3, 7, 9, 10, 8, 4, 11, 6, 13, 14, 15, 16];
function inv_order() { return flags().inv_order || def_inv_order; }

/* ── mondata.h predicates this file needs ──────────────────────────────── */

/* gy.youmonst.data.  u.umonnum holds the 0-based ROLE index when not
   polymorphed (same convention as js/invent.js and js/hack.js:579);
   PM_ARCHEOLOGIST == 331. */
function youmonst_data() {
    const u = ustate();
    if (u.Upolyd) return monster_by_pmidx(u.umonnum) || u.data || null;
    return monster_by_pmidx(331 + (u.umonnum ?? 0)) || u.data || null;
}
/* mondata.h touch_petrifies(ptr) — cockatrice / chickatrice (Medusa is only
   flesh_petrifies).  Matched against the generated mons[] table, as in
   js/mon.js and js/dogmove.js. */
function touch_petrifies_pm(corpsenm) {
    const nm = monster_by_pmidx(corpsenm)?.name;
    return nm === 'cockatrice' || nm === 'chickatrice';
}
/* mondata.h is_rider(ptr) — Death / Famine / Pestilence. */
function is_rider_pm(corpsenm) {
    const nm = monster_by_pmidx(corpsenm)?.name;
    return nm === 'Death' || nm === 'Famine' || nm === 'Pestilence';
}
function bigmonst_pm(corpsenm) {
    const MZ_LARGE = 3;
    return (monster_by_pmidx(corpsenm)?.msize ?? 0) >= MZ_LARGE;
}
function notake_hero() { return (mflags1_of(youmonst_data()) & M1_NOTAKE) !== 0; }
function nohands_hero() { return (mflags1_of(youmonst_data()) & M1_NOHANDS) !== 0; }
function nolimbs_hero() {
    return (mflags1_of(youmonst_data()) & M1_NOLIMBS) === M1_NOLIMBS;
}
function throws_rocks_hero() {
    return (mflags2_of(youmonst_data()) & M2_ROCKTHROW) !== 0;
}
/* engrave.c freehand():473 */
function freehand() {
    const uwep = game.uwep;
    return !uwep || !welded(uwep)
        || (!bimanual(uwep) && (!game.uarms || !game.uarms.cursed));
}
/* wield.c welded():1051 -> will_weld():68 — a cursed erodeable weapon (or tin
   opener) in the wielded slot.  welded() also sets bknown. */
const HEAVY_IRON_BALL = 474, IRON_CHAIN = 473, TIN_OPENER = 250;
function welded(obj) {
    if (obj && obj === game.uwep && obj.cursed
        && (obj.oclass === WEAPON_CLASS_P || is_weptool(obj)
            || obj.otyp === HEAVY_IRON_BALL || obj.otyp === IRON_CHAIN
            || obj.otyp === TIN_OPENER)) {
        obj.bknown = 1;
        return true;
    }
    return false;
}
const WEAPON_CLASS_P = 2;   /* objclass.h WEAPON_CLASS */
/* engrave.c can_reach_floor(check_pit) */
function can_reach_floor(_check_pit) {
    const u = ustate();
    if (u.uswallow) return false;
    if (u.uprops?.Levitation) return false;
    return true;
}
function t_at(x, y) {
    for (const t of (game.level?.traps || [])) if (t.tx === x && t.ty === y) return t;
    return null;
}
/* trap.c uteetering_at_seen_pit():6648 / uescaped_shaft():6660 */
function uteetering_at_seen_pit(trap) {
    const u = ustate();
    return !!(trap && is_pit(trap.ttyp) && trap.tseen
              && u.ux === trap.tx && u.uy === trap.ty
              && !(u.utrap && u.utraptype === TT_PIT));
}
function uescaped_shaft(trap) {
    const u = ustate();
    return !!(trap && is_hole(trap.ttyp)
              && trap.tseen && u.ux === trap.tx && u.uy === trap.ty);
}
function is_pool(x, y) {
    const typ = game.level?.at?.(x, y)?.typ;
    return typ === POOL || typ === MOAT || typ === WATER;
}
function is_lava(x, y) { return game.level?.at?.(x, y)?.typ === LAVAPOOL; }
/* hack.c losehp() reduced to the hp arithmetic, matching the other per-file
   copies in this port.  C's `disp.botl = TRUE` is omitted for the reason
   js/trap.js:864 records (an extra botl release point costs a screen). */
async function losehp(n, _knam) {
    const u = ustate();
    u.uhp = (u.uhp || 0) - n;
    if (u.uhp < 1) u.uhp = 0;
}
/* hack.h Maybe_Half_Phys(dmg) */
function Maybe_Half_Phys(dmg) {
    return (game.u?.HHalf_physical_damage || game.u?.EHalf_physical_damage)
        ? Math.trunc((dmg + 1) / 2) : dmg;
}
/* obj.h age_is_relative(o) — only lit/burnable tools track relative age. */
const TALLOW_CANDLE = 224, WAX_CANDLE = 225, BRASS_LANTERN = 226,
    OIL_LAMP = 227, MAGIC_LAMP = 228, POT_OIL = 297, LEASH = 236,
    CANDELABRUM_OF_INVOCATION = 262, SPE_BOOK_OF_THE_DEAD = 409;
function age_is_relative(obj) {
    const t = obj?.otyp;
    return t === TALLOW_CANDLE || t === WAX_CANDLE || t === BRASS_LANTERN
        || t === OIL_LAMP || t === MAGIC_LAMP || t === POT_OIL;
}

/* ═══════════════════════════════════════════════════════════════════════
   pickup.c:76 simple_look()
   ═══════════════════════════════════════════════════════════════════════ */
export async function simple_look(otmp, here) {
    if (!otmp) return;
    if (!(here ? otmp.nexthere : otmp.nobj)) {
        await pline(doname(otmp));
        return;
    }
    const lines = [''];
    for (let o = otmp; o; o = here ? o.nexthere : o.nobj) lines.push(doname(o));
    renderWindowScreen(lines);
}

/* pickup.c:101 collect_obj_classes() — ilets[] gets each distinct class
   symbol; *itemcount counts EVERY object, filtered or not (that is what puts
   'm' in query_classes()'s prompt). */
export function collect_obj_classes(ilets, otmp, here, filter, itemcount) {
    let iletct = 0;
    let out = '';
    if (itemcount) itemcount.count = 0;
    for (const o of objchain(otmp, here)) {
        const c = def_oc_syms[o.oclass];
        if (!out.includes(c) && (!filter || filter(o))) { out += c; iletct++; }
        if (itemcount) itemcount.count += 1;
    }
    if (Array.isArray(ilets)) ilets.splice(0, ilets.length, ...out.split(''));
    else if (ilets && typeof ilets === 'object') ilets.buf = out;
    return iletct;
}

/* pickup.c:141 query_classes() — the menustyle:Traditional/Combination class
   prompt, "What kinds of thing do you want to <action>? [<ilets>]".
   oclasses.buf collects object-class NUMBERS (C's strchr(oclasses,
   obj->oclass)); valid_menu_classes collects class SYMBOLS, because that is
   what this port's allow_category() compares against. */
export async function query_classes(oclasses, one_at_a_time, everything, action,
                                    objs, here, menu_on_demand) {
    const iletsArr = [];
    const itemcount = { count: 0 };
    let oclassct = 0, m_seen = false;
    oclasses.buf = '';
    one_at_a_time.value = everything.value = false;
    if (menu_on_demand) menu_on_demand.value = 0;
    const iletct = collect_obj_classes(iletsArr, objs, here, null, itemcount);
    if (iletct === 0) return false;
    let ilets = iletsArr.join('');

    if (iletct === 1) {
        oclasses.buf = String.fromCharCode(def_char_to_objclass(ilets));
    } else {
        /* C: objs == gi.invent picks 'i', anything else ':'.  A pointer
           compare there; here the chain's own where field says the same. */
        ilets += ' aA' + (chain_to_array(objs, here)[0]?.where === 'invent' ? 'i' : ':');
    }
    if (itemcount.count && menu_on_demand) ilets += 'm';
    if (count_unpaid(objs)) ilets += 'u';
    const bc = { value: 0 }, uc = { value: 0 }, cc = { value: 0 },
          xc = { value: 0 }, oc = { value: 0 }, jc = { value: 0 };
    tally_BUCX(objs, here, bc, uc, cc, xc, oc, jc);
    if (bc.value) ilets += 'B';
    if (uc.value) ilets += 'U';
    if (cc.value) ilets += 'C';
    if (xc.value) ilets += 'X';
    if (jc.value) ilets += 'P';

    if (ilets.length > 1) {
        let where = null;
        ask_again:
        for (;;) {
            oclasses.buf = ''; oclassct = 0;
            one_at_a_time.value = everything.value = false;
            let not_everything = false, filtered = false;
            const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
            const inbuf = await hooked_tty_getlin(
                `What kinds of thing do you want to ${action}? [${ilets}]`, null);
            if (String(inbuf).charAt(0) === '\x1b') return false;

            for (const sym of String(inbuf)) {
                if (sym === ' ') {
                    continue;
                } else if (sym === 'A') {
                    one_at_a_time.value = true;
                } else if (sym === 'a') {
                    everything.value = true;
                } else if (sym === ':') {
                    await simple_look(objs, here); /* dumb if objs==invent */
                    const head = chain_to_array(objs, here)[0];
                    if (head?.where === 'contained' && head.ocontainer)
                        head.ocontainer.cknown = 1;
                    continue ask_again;
                } else if (sym === 'i') {
                    await display_inventory_interactive(null);
                    continue ask_again;
                } else if (sym === 'm') {
                    m_seen = true;
                } else if ('uBUCXP'.includes(sym)) {
                    add_valid_menu_class(sym);
                    filtered = true;
                } else {
                    const oc_of_sym = def_char_to_objclass(sym);
                    if (ilets.includes(sym)) {
                        add_valid_menu_class(sym);
                        oclasses.buf += String.fromCharCode(oc_of_sym);
                        oclassct++;
                    } else {
                        if (where === null)
                            where = (action === 'pick up') ? 'here'
                                : (action === 'take out') ? 'inside' : '';
                        /* update_topl, not pline: these accumulate onto one
                           topline (C's pline concat rule) — "There are no #'s
                           here.  There are no l's here. ..." for a typed
                           "#loot" — and page it when the next one won't fit. */
                        await update_topl(where ? `There are no ${sym}'s ${where}.`
                                                : `You have no ${sym}'s.`);
                        not_everything = true;
                    }
                }
            }
            if (m_seen && menu_on_demand) {
                menu_on_demand.value = ((everything.value || !oclassct) && !filtered)
                    ? -2 : -3;
                return false;
            }
            if (!oclassct && (!everything.value || not_everything)) {
                one_at_a_time.value = true;  /* force 'A' */
                everything.value = false;    /* inhibit 'a' */
            }
            break;
        }
    }
    return true;
}

/* objnam.c safe_qbuf() — "<prefix><object name><suffix>", falling back to a
   shorter name (then to `lastR`) when the whole thing would not fit in
   QBUFSZ-1.  short_oname()'s intermediate forms are not needed here: every
   caller's doname() is far shorter than the 127-character budget. */
const QBUFSZ = 128;
const something = 'something';
function safe_qbuf(qprefix, qsuffix, obj, func, altfunc, lastR) {
    const lenlimit = QBUFSZ - 1;
    const budget = lenlimit - qprefix.length - qsuffix.length;
    let name = String(func(obj));
    if (name.length > budget) name = String(altfunc(obj));
    if (name.length > budget) name = lastR;
    return qprefix + name + qsuffix;
}

/* hack.h ynaq()/ynNaq() — yn_function(query, "ynaq"/"yn#aq", 'y').  The '#'
   count entry needs tty_yn_function's digit-collection mode, which js/display's
   y_n() does not have, so a digit is ignored rather than starting a count. */
/* win/tty/topl.c tty_yn_function():398 — a NEED_MORE topline is paged before
   the prompt is drawn (unless a previous --More-- was ESC'd, i.e. WIN_STOP).
   js/display's y_n() keys that off its own _yn_need_more flag, so the
   pline-pending case is handled here. */
async function yn_pending_more() {
    if (game._toplin === 1 && !game._winStop) {
        const { topl_more } = await import('./display.js');
        await topl_more();
        game._pending_message = '';
        game._toplin = 0;
    }
}
async function ynaq(query) { await yn_pending_more(); return await y_n(query, 'ynaq\x1b', 'y'); }
async function ynNaq(query) { await yn_pending_more(); return await y_n(query, 'yn#aq\x1b', 'y'); }

/* pickup.c:273 u_safe_from_fatal_corpse() */
export function u_safe_from_fatal_corpse(obj, tests) {
    if (((tests & st_gloves) && game.uarmg)
        || ((tests & st_corpse) && obj?.otyp !== CORPSE)
        || ((tests & st_petrifies) && !touch_petrifies_pm(obj?.corpsenm))
        || ((tests & st_resists) && game.Stone_resistance))
        return true;
    return false;
}

/* pickup.c:285 fatal_corpse_mistake() — bare-handed touch of a cockatrice
   corpse.  poly_when_stoned()/polymon() (polyself.c) covers only golem forms,
   which no hero in this port takes. */
export async function fatal_corpse_mistake(obj, remotely) {
    if (u_safe_from_fatal_corpse(obj, st_all) || remotely) return false;
    await pline(`Touching ${corpse_article_name(obj)} is a fatal mistake.`);
    await instapetrify(killer_name(obj));
    return true;
}
function corpse_article_name(obj) {
    /* corpse_xname(obj, NULL, CXN_SINGULAR | CXN_ARTICLE) */
    const nm = xname(obj);
    return /^[aeiouAEIOU]/.test(nm) ? `an ${nm}` : `a ${nm}`;
}
function killer_name(obj) { return xname(obj); }
/* polyself.c instapetrify() */
async function instapetrify(str) {
    if (game.Stone_resistance) return;
    await pline('You turn to stone...');
    game.killer = { format: 1 /* KILLED_BY */, name: str || '' };
    const end = await import('./end.js');
    const STONING = 8;
    if (typeof end.done === 'function') await end.done(STONING);
}

/* pickup.c:303 rider_corpse_revival() */
export async function rider_corpse_revival(obj, remotely) {
    if (!obj || obj.otyp !== CORPSE || !is_rider_pm(obj.corpsenm)) return false;
    await pline(`At your ${remotely ? 'attempted acquisition' : 'touch'}, `
                + 'the corpse suddenly moves...');
    /* revive_corpse() is timeout.c and is not ported. */
    const { exercise } = await import('./attrib.js');
    exercise(3 /* A_WIS */, false);
    return true;
}

/* pickup.c:317 force_decor() — wand of probing zapped down. */
export async function force_decor(via_probing) {
    game._decor_fumble_override = true;
    game._decor_levitate_override = !!via_probing;
    iflags().prev_decor = STONE;
    await describe_decor();
    game._decor_fumble_override = game._decor_levitate_override = false;
    const u = ustate();
    const loc = game.level?.at?.(u.ux, u.uy);
    if (loc && Array.isArray(game.level?.lastseentyp))
        game.level.lastseentyp[u.ux + u.uy * 80] = loc.typ;
}

/* pickup.c:337 deferred_decor() */
export async function deferred_decor(setup) {
    if (!flags().mention_decor) {
        iflags().defer_decor = false;
    } else if (setup) {
        iflags().defer_decor = true;
    } else {
        await describe_decor();
        iflags().defer_decor = false;
    }
}

/* pickup.c:430 check_here() — look at the objects here (uchain excluded from
   the count), else read the engraving. */
export async function check_here(picked_some) {
    const u = ustate();
    let lhflags = picked_some ? LOOKHERE_PICKED_SOME : LOOKHERE_NOFLAGS;

    if (flags().mention_decor) {
        if (await describe_decor()) lhflags |= LOOKHERE_SKIP_DFEATURE;
    }
    let ct = 0;
    for (const obj of objects_at(u.ux, u.uy)) if (obj !== u.uchain) ct++;

    if (ct) {
        if (game.context?.run) {
            const { nomul } = await import('./hack.js');
            nomul(0);
        }
        await flush_screen(1);
        await look_here(ct, lhflags);
    } else {
        await read_engr_at(u.ux, u.uy);
    }
}
async function read_engr_at(x, y) {
    const inv = await import('./invent.js');
    if (typeof inv.read_engr_at === 'function') await inv.read_engr_at(x, y);
}

/* pickup.c:460 n_or_more() */
export function n_or_more(obj) {
    if (obj === game.u?.uchain) return false;
    return (obj.quan || 0) >= P().val_for_n_or_more;
}

/* pickup.c:469 menu_class_present() */
export function menu_class_present(c) {
    const ch = typeof c === 'number' ? String.fromCharCode(c) : c;
    return !!(c && P().valid_menu_classes.includes(ch));
}

/* pickup.c:475 add_valid_menu_class() — c == 0 resets. */
export function add_valid_menu_class(c) {
    const p = P();
    if (c === 0) {
        p.vmc_count = 0;
        p.valid_menu_classes = '';
        p.class_filter = p.bucx_filter = p.shop_filter = false;
        p.picked_filter = false;
        return;
    }
    if (!menu_class_present(c)) {
        const ch = typeof c === 'number' ? String.fromCharCode(c) : c;
        p.valid_menu_classes += ch;
        p.vmc_count++;
        switch (ch) {
        case 'B': case 'U': case 'C': case 'X': p.bucx_filter = true; break;
        case 'P': p.picked_filter = true; break;
        case 'u': p.shop_filter = true; break;
        default: p.class_filter = true; break;
        }
    }
}

/* pickup.c:509 all_but_uchain() */
export function all_but_uchain(obj) { return obj !== game.u?.uchain; }

/* pickup.c:517 allow_all() */
export function allow_all(_obj) { return true; }

/* pickup.c:523 allow_category() — with more than one filter TYPE active an
   object must match one entry of EACH type, not any entry of any type. */
export function allow_category(obj) {
    const p = P();
    if (!p.class_filter && !p.shop_filter && !p.bucx_filter
        && !p.picked_filter && !ParanoidAutoAll())
        return false;

    if (obj.oclass === COIN_CLASS && p.class_filter)
        return p.valid_menu_classes.includes(def_oc_syms[COIN_CLASS]);

    if (Role_if_CLERIC() && !obj.bknown) obj.bknown = 1;

    if (p.class_filter
        && !p.valid_menu_classes.includes(def_oc_syms[obj.oclass]))
        return false;
    if (p.shop_filter && !obj.unpaid
        && !(Has_contents(obj) && count_unpaid(obj.cobj) > 0))
        return false;
    if (p.bucx_filter) {
        let bucx;
        if (obj.oclass === COIN_CLASS) {
            bucx = flags().goldX ? 'X' : 'U';
        } else {
            bucx = !obj.bknown ? 'X'
                : obj.blessed ? 'B'
                    : obj.cursed ? 'C'
                        : 'U';
        }
        if (!p.valid_menu_classes.includes(bucx)) return false;
    }
    if (p.picked_filter && !obj.pickup_prev) return false;
    return true;
}
function ParanoidAutoAll() {
    return /autoall/i.test(String(flags().paranoid_confirmation || ''));
}
function Role_if_CLERIC() {
    const PM_CLERIC = 6;
    return (game.urole?.mnum ?? game.u?.umonnum) === PM_CLERIC;
}

/* pickup.c:597 allow_cat_no_uchain() — #if 0 in C; kept for parity. */
export function allow_cat_no_uchain(obj) {
    const p = P();
    return obj !== game.u?.uchain
        && ((p.valid_menu_classes.includes('u') && obj.unpaid)
            || p.valid_menu_classes.includes(def_oc_syms[obj.oclass]));
}

/* pickup.c:609 is_worn_by_type() */
export function is_worn_by_type(otmp) {
    return is_worn(otmp) && allow_category(otmp);
}

/* pickup.c:616 reset_justpicked() */
export function reset_justpicked(olist) {
    for (const otmp of objchain(olist)) otmp.pickup_prev = 0;
}

/* pickup.c:635 count_justpicked() */
export function count_justpicked(olist) {
    let cnt = 0;
    for (const otmp of objchain(olist)) if (otmp.pickup_prev) cnt++;
    return cnt;
}

/* pickup.c:648 find_justpicked() */
export function find_justpicked(olist) {
    for (const otmp of objchain(olist)) if (otmp.pickup_prev) return otmp;
    return null;
}

/* ═══════════════════════════════════════════════════════════════════════
   pickup.c:672 pickup()
     what > 0 autopickup;  == 0 interactive;  < 0 pick -what of something.
   Returns 1 if a pickup was attempted.
   ═══════════════════════════════════════════════════════════════════════ */
export async function pickup(what) {
    const u = ustate();
    let n = 0, n_tried = 0, n_picked = 0;
    let pick_list = null;
    const autopickup = what > 0;

    if (autopickup && (game.multi ?? 0) < 0 && unconscious()) {
        iflags().prev_decor = STONE;
        return 0;
    }
    set_pickup_encumbrance(0);
    const count = what < 0 ? -what : 0;

    if (!u.uswallow) {
        const here = objects_at(u.ux, u.uy);
        const OBJ_AT = here.length > 0;
        if (autopickup && (game.context?.nopick || !OBJ_AT
                           || (is_pool(u.ux, u.uy) && !game.Underwater)
                           || is_lava(u.ux, u.uy))) {
            if (flags().mention_decor) await describe_decor();
            await read_engr_at(u.ux, u.uy);
            return 0;
        }
        const t = t_at(u.ux, u.uy);
        if (!can_reach_floor(!!(t && is_pit(t.ttyp)))) {
            await describe_decor(); /* even when !flags.mention_decor */
            if (((game.multi ?? 0) && !game.context?.run)
                || (autopickup && !flags().pickup)
                || (t && (uteetering_at_seen_pit(t) || uescaped_shaft(t))))
                await read_engr_at(u.ux, u.uy);
            return 0;
        }
        if (((game.multi ?? 0) && !game.context?.run)
            || (autopickup && !flags().pickup)
            || notake_hero()) {
            await check_here(false);
            if (notake_hero() && OBJ_AT(u.ux, u.uy) && (autopickup || flags().pickup))
                await pline('You are physically incapable of picking anything up.');
            return 0;
        }
        if (OBJ_AT && game.context?.run && game.context.run !== 8
            && !game.context.nopick) {
            const { nomul } = await import('./hack.js');
            nomul(0);
        }
    }

    add_valid_menu_class(0); /* reset */
    const objchain_p = u.uswallow ? (u.ustuck?.minvent || [])
        : objects_at(u.ux, u.uy);
    let traverse_how = u.uswallow ? 0 : BY_NEXTHERE;

    /* C's `goto menu_pickup` / `goto pickupdone` */
    let menu_pickup = false, pickupdone = false;

    if (autopickup) {
        const picked = { list: null };
        n = autopick(objchain_p, traverse_how, picked);
        pick_list = picked.list;
        menu_pickup = true;
    } else if (menu_style() !== MENU_TRADITIONAL || iflags().menu_requested) {
        traverse_how |= AUTOSELECT_SINGLE
            | (flags().sortpack !== false ? INVORDER_SORT : 0);
        const picked = { list: null };
        if (count) {
            P().val_for_n_or_more = count;
            n = await query_objlist(`Pick ${count} of what?`, objchain_p,
                                    traverse_how, picked, PICK_ONE, n_or_more);
            for (let i = 0; i < n; i++) picked.list[i].count = count;
        } else {
            n = await query_objlist('Pick up what?', objchain_p,
                                    traverse_how | FEEL_COCKATRICE,
                                    picked, PICK_ANY, all_but_uchain);
        }
        pick_list = picked.list;
        menu_pickup = true;
    } else {
        /* pickup.c:786 "old style interface" — menustyle:Traditional without
           the 'm' prefix: a class prompt, then one y/n per object. */
        const chain = chain_to_array(objchain_p, (traverse_how & BY_NEXTHERE) !== 0);
        const oclasses = { buf: '' };       /* types to consider (empty for all) */
        const all_of_a_type = { value: true };  /* take all of considered types */
        const selective = { value: false };     /* ask for each item */
        const ct = chain.length;
        let end_query = false;

        if (ct === 1 && count) {
            /* if only one thing, then pick it */
            const obj = chain[0];
            const lcount = Math.min(obj.quan, count);
            n_tried++;
            reset_justpicked(inventoryArray());
            if ((await pickup_object(obj, lcount, false)) > 0) n_picked++;
            end_query = true;
        } else if (ct >= 2) {
            const via_menu = { value: 0 };
            /* update_topl, not pline: C's pline() leaves toplin == NEED_MORE,
               which is what makes getline.c page this line before drawing
               query_classes()'s prompt. */
            await update_topl(`There are ${ct <= 10 ? 'several' : 'many'} objects here.`);
            if (!(await query_classes(oclasses, selective, all_of_a_type, 'pick up',
                                      objchain_p, (traverse_how & BY_NEXTHERE) !== 0,
                                      via_menu))) {
                if (!via_menu.value) {
                    pickupdone = true;
                } else {
                    if (selective.value) traverse_how |= INVORDER_SORT;
                    const picked = { list: null };
                    n = await query_objlist('Pick up what?', objchain_p, traverse_how,
                                            picked, PICK_ANY,
                                            via_menu.value === -2 ? allow_all
                                                                  : allow_category);
                    pick_list = picked.list;
                    menu_pickup = true;
                }
            }
        }

        if (!pickupdone && !menu_pickup && !end_query) {
            const bycat = menu_class_present('B') || menu_class_present('U')
                || menu_class_present('C') || menu_class_present('X');
            for (const obj of chain) {
                if (bycat ? !allow_category(obj)
                          : (!selective.value && oclasses.buf
                             && !oclasses.buf.includes(String.fromCharCode(obj.oclass))))
                    continue;

                let lcount = -1;
                if (!all_of_a_type.value) {
                    const qbuf = safe_qbuf('Pick up ', '?', obj, doname,
                                           ansimpleoname, something);
                    const ans = (obj.quan < 2) ? await ynaq(qbuf) : await ynNaq(qbuf);
                    if (ans === 'q') break;      /* end_query: out 2 levels */
                    if (ans === 'n') continue;
                    if (ans === 'a') {
                        all_of_a_type.value = true;
                        if (selective.value) {
                            selective.value = false;
                            oclasses.buf = String.fromCharCode(obj.oclass);
                        }
                    }
                    /* '#' (count entry) can't be answered; see ynNaq() */
                }
                if (lcount === -1) lcount = obj.quan;

                if (!n_tried) reset_justpicked(inventoryArray());
                n_tried++;
                const res = await pickup_object(obj, lcount, false);
                if (res < 0) break;
                n_picked += res;
            }
        }
    }

    if (menu_pickup) {
        if (n > 0) reset_justpicked(inventoryArray());
        n_tried = n;
        for (let i = 0; i < n; i++) {
            /* C's pline() chaining: each prinv line accumulates onto the same
               topline (CO-8 rule) rather than replacing the previous one. */
            const prior = i > 0 ? (game._pending_message || '') : '';
            const res = await pickup_object(pick_list[i].obj, pick_list[i].count,
                                            false);
            if (i > 0 && prior) {
                const line = game._pending_message || '';
                if (line !== prior) {
                    game._pending_message = prior;
                    game._toplin = 1; /* TOPLIN_NEED_MORE */
                    await update_topl(line);
                }
            }
            if (res < 0) break;
            n_picked += res;
        }
    }

    if (!pickupdone && !u.uswallow) {
        if (n_picked) newsym_force(u.ux, u.uy);
        if (autopickup) await check_here(n_picked > 0);
    }
    set_pickup_encumbrance(0);
    add_valid_menu_class(0); /* reset */
    return n_tried > 0 ? 1 : 0;
}

/* C ref: options.c optfn_menustyle() — flags.menu_style.  Only the value's
   FIRST letter matters ('n'/'t' Traditional, 'c' Combination, 'f' Full,
   'p' Partial), and a negated "!menustyle" selects Traditional too.  Converted
   here rather than in the parser for the same reason as pickup_types(). */
export function menu_style() {
    const raw = flags().menustyle;
    if (typeof raw === 'number') return raw;
    if (raw === false) return MENU_TRADITIONAL;
    switch (String(raw ?? '').charAt(0).toLowerCase()) {
    case 'n': case 't': return MENU_TRADITIONAL;
    case 'c': return MENU_COMBINATION;
    case 'p': return MENU_PARTIAL;
    default: return MENU_FULL;   /* optlist.h initial value */
    }
}
function unconscious() {
    const u = ustate();
    return !!(u.usleep || u.uprops?.Unconscious);
}

/* C ref: options.c optfn_pickup_types() — flags.pickup_types holds object
   CLASS CODES, not the symbols the user typed: each character goes through
   def_char_to_objclass(), duplicates and unrecognized symbols are dropped, and
   a leading 'a'/'A' (after any spaces) means "all classes", i.e. an empty list.
   Converted here rather than in the parser because js/options.js records every
   compound option's value verbatim under its C option name. */
let pickup_types_src = null, pickup_types_oc = [];
function pickup_types() {
    const raw = flags().pickup_types;
    const src = (raw == null) ? '' : String(raw);
    if (src === pickup_types_src) return pickup_types_oc;
    pickup_types_src = src;
    let op = 0;
    while (op < src.length && src[op] === ' ') op++;
    const out = [];
    if (src[op] !== 'a' && src[op] !== 'A') {
        for (; op < src.length; op++) {
            const oc_sym = def_char_to_objclass(src[op]);
            if (oc_sym !== MAXOCLASSES && !out.includes(oc_sym)) out.push(oc_sym);
        }
    }
    pickup_types_oc = out;
    return out;
}

/* C ref: options.c optfn_pickup_burden() — the value's FIRST character,
   lowercased, selects the level ("streSsed"/"straiNed"/"overTaxed" are picked
   by their capitalized letter, not their initial); anything else is a config
   error that leaves the previous value.  Converted here for the same reason as
   pickup_types: js/options.js records compound values verbatim. */
export function pickup_burden() {
    const raw = flags().pickup_burden;
    if (typeof raw === 'number') return raw;
    switch (String(raw ?? '').charAt(0).toLowerCase()) {
    case 'u': return UNENCUMBERED;
    case 'b': return SLT_ENCUMBER;
    case 's': return MOD_ENCUMBER;
    case 'n': return HVY_ENCUMBER;
    case 'o': case 't': return EXT_ENCUMBER;
    case 'l': return OVERLOADED;
    default: return MOD_ENCUMBER; /* options.c:7207 initial value */
    }
}

/* pickup.c:912 check_autopickup_exceptions() — ga.apelist, newest entry first,
   matched against makesingular(doname(obj)) as an unanchored POSIX ERE. */
export function check_autopickup_exceptions(obj) {
    const apelist = game.apelist;
    if (!apelist || !apelist.length) return null;
    const objdesc = makesingular(String(doname(obj)));
    for (const ape of apelist) if (ape.regex.test(objdesc)) return ape;
    return null;
}

/* pickup.c:930 autopick_testobj() — 'costly' is computed once per autopickup
   run (calc_costly on the first object only), exactly as in C. */
let autopick_costly = false;
export function autopick_testobj(otmp, calc_costly) {
    const otypes = pickup_types();

    if (calc_costly)
        autopick_costly = (otmp.where === 'floor'
                           && !!costly_spot(otmp.ox, otmp.oy));

    /* an unpaid item in a shop is never auto-picked */
    if (autopick_costly && !otmp.no_charge) return false;

    /* pickup_thrown/pickup_stolen/dropped_nopick override BOTH pickup_types
       and the exception list.  All three default ON in C (optlist.h Term_False
       + initoptions' On), and js/options.js keys them by C OPTION name — so
       'dropped_nopick', not the flags.nopick_dropped field it feeds. */
    if ((flags().pickup_thrown !== false && otmp.how_lost === LOST_THROWN)
        || (flags().pickup_stolen !== false && otmp.how_lost === LOST_STOLEN))
        return true;
    if (flags().dropped_nopick !== false && otmp.how_lost === LOST_DROPPED)
        return false;
    if (otmp.how_lost === LOST_EXPLODING) return false;

    let pickit = !otypes.length || otypes.includes(otmp.oclass);

    const ape = check_autopickup_exceptions(otmp);
    if (ape) pickit = !!ape.grab;

    return pickit;
}

/* pickup.c:975 autopick() */
export function autopick(olist, follow, pick_list) {
    let n = 0;
    let check_costly = true;
    const chain = chain_to_array(olist, (follow & BY_NEXTHERE) !== 0);
    for (const curr of chain) {
        if (autopick_testobj(curr, check_costly)) ++n;
        check_costly = false;
    }
    if (n) {
        const pi = [];
        for (const curr of chain)
            if (autopick_testobj(curr, false))
                pi.push({ obj: curr, count: curr.quan });
        pick_list.list = pi;
        return pi.length;
    }
    return 0;
}

/* ═══════════════════════════════════════════════════════════════════════
   pickup.c:1025 query_objlist()
   The menu build/selection is js/invent.js's pickup_menu_select(); the
   counting, AUTOSELECT_SINGLE shortcut, cockatrice bail-out and count
   fix-ups are C's.
   ═══════════════════════════════════════════════════════════════════════ */
export async function query_objlist(qstr, olist_p, qflags, pick_list, how,
                                    allow) {
    pick_list.list = null;
    const by_nexthere = (qflags & BY_NEXTHERE) !== 0;
    const olist = chain_to_array(olist_p, by_nexthere);
    const engulfer = (qflags & INCLUDE_HERO) !== 0;
    if (!olist.length && !engulfer) return 0;

    let n = 0, last = null;
    for (const curr of olist) if (allow(curr)) { last = curr; n++; }

    const engulfer_minvent = olist.length > 0 && olist[0].where === 'minvent';
    if (engulfer_minvent && n === 1 && olist[0].owornmask)
        qflags &= ~AUTOSELECT_SINGLE;
    if (engulfer) { ++n; qflags &= ~AUTOSELECT_SINGLE; }

    if (n === 0) return (qflags & SIGNAL_NOMENU) ? -1 : 0;

    if (n === 1 && (qflags & AUTOSELECT_SINGLE)) {
        pick_list.list = [{ obj: last, count: last.quan }];
        return 1;
    }

    const sortflags =
        (((flags().sortloot === 'f'
           || (flags().sortloot === 'l' && !(qflags & USE_INVLET)))
            ? SORTLOOT_LOOT
            : ((qflags & USE_INVLET) ? SORTLOOT_INVLET : 0))
         | (flags().sortpack !== false ? SORTLOOT_PACK : 0)
         | ((qflags & FEEL_COCKATRICE) ? SORTLOOT_PETRIFY : 0));
    const sortedolist = sortloot(olist, sortflags, by_nexthere, allow);

    /* the cockatrice bail-out happens during the menu build, i.e. AFTER the
       AUTOSELECT_SINGLE shortcut and BEFORE anything is displayed */
    for (const sli of sortedolist) {
        const curr = sli.obj;
        if (!curr) break;
        if ((qflags & FEEL_COCKATRICE) && curr.otyp === CORPSE
            && will_feel_cockatrice(curr, false)) {
            unsortloot(sortedolist);
            await look_here(0, LOOKHERE_NOFLAGS);
            return 0;
        }
    }
    unsortloot(sortedolist);

    const chosen = await pickup_menu_select(olist.filter(allow), qstr);
    if (!chosen || !chosen.length) return 0;

    const picked = [];
    for (const mi of chosen) {
        const curr = mi.obj;
        if (engulfer_minvent && curr.owornmask) continue;
        let cnt = mi.count;
        if (cnt === -1 || cnt > curr.quan) cnt = curr.quan;
        picked.push({ obj: curr, count: cnt });
    }
    if (!picked.length) return 0;
    pick_list.list = picked;
    return picked.length;
}

/* ═══════════════════════════════════════════════════════════════════════
   pickup.c:1226 query_category() — the menustyle:Full class menu.  The
   single-category shortcut (which is what the recorded take-out/take-off
   flows hit) is C's; the multi-category menu is rendered by the callers in
   js/extcmd-handlers.js.
   ═══════════════════════════════════════════════════════════════════════ */
export function query_category(qstr, olist, qflags, pick_list, how) {
    void qstr; void how;
    pick_list.list = null;
    const chain = chain_to_array(olist, (qflags & BY_NEXTHERE) !== 0);
    if (!chain.length) return 0;

    let do_unpaid = false, do_usedup = false, num_buc_types = 0;
    let ofilter = null;

    if ((qflags & UNPAID_TYPES) && count_unpaid(chain)) do_unpaid = true;
    if (qflags & BILLED_TYPES) do_usedup = true;
    if (qflags & WORN_TYPES) ofilter = is_worn;
    if ((qflags & BUC_BLESSED_F) && count_buc(chain, BUC_BLESSED, ofilter))
        num_buc_types++;
    if ((qflags & BUC_CURSED_F) && count_buc(chain, BUC_CURSED, ofilter))
        num_buc_types++;
    if ((qflags & BUC_UNCURSED_F) && count_buc(chain, BUC_UNCURSED, ofilter))
        num_buc_types++;
    if ((qflags & BUC_UNKNOWN_F) && count_buc(chain, BUC_UNKNOWN, ofilter))
        num_buc_types++;

    const ccount = count_categories(chain, qflags);
    if (ccount === 1 && !do_unpaid && !do_usedup && num_buc_types <= 1) {
        let curr = null;
        for (const o of chain) {
            if (ofilter && !ofilter(o)) continue;
            curr = o; break;
        }
        if (curr) { pick_list.list = [{ a_int: curr.oclass }]; return 1; }
        return 0;
    }
    return 0;
}

/* pickup.c:1511 count_categories() */
export function count_categories(olist, qflags) {
    const chain = chain_to_array(olist, (qflags & BY_NEXTHERE) !== 0);
    const do_worn = (qflags & WORN_TYPES) !== 0;
    let ccount = 0;
    for (const pk of inv_order()) {
        let counted_category = false;
        for (const curr of chain) {
            if (curr.oclass === pk) {
                if (do_worn
                    && !((curr.owornmask || 0)
                         & (W_ARMOR_WORN | W_ACCESSORY_WORN | W_WEAPONS_WORN)))
                    continue;
                if (!counted_category) { ccount++; counted_category = true; }
            }
        }
    }
    return ccount;
}

/* pickup.c:1544 delta_cwt() — how much lighter the container gets when obj
   leaves it.  Only a bag of holding compresses. */
export function delta_cwt(container, obj) {
    if (container.otyp !== BAG_OF_HOLDING) return obj.owt;
    const owt = container.owt;
    const cobj = container.cobj || [];
    const ix = cobj.indexOf(obj);
    if (ix < 0) return owt;   /* C panics here */
    cobj.splice(ix, 1);
    const nwt = weight(container);
    cobj.splice(ix, 0, obj);
    return owt - nwt;
}

/* pickup.c:1570 carry_count() — how many of obj can be lifted; fills
   wts.before / wts.after. */
export async function carry_count(obj, container, count, telekinesis, wts) {
    const adjust_wt = !!container && carried(container);
    const is_gold = obj.oclass === COIN_CLASS;
    let wt, iw, ow, oow, qq;

    /* mkobj.c keeps obj->owt == weight(obj) at all times; restore the
       invariant for any object this port created as a bare literal, or the
       arithmetic below goes NaN and refuses every lift. */
    if (obj.owt == null) obj.owt = weight(obj);
    const savequan = obj.quan;
    const saveowt = obj.owt;
    const umoney = money_cnt(inventoryArray());
    iw = max_capacity();

    if (count !== savequan) { obj.quan = count; obj.owt = weight(obj); }
    wt = iw + obj.owt;
    if (adjust_wt) wt -= delta_cwt(container, obj);
    if (is_gold)
        wt -= (GOLD_WT(umoney) + GOLD_WT(count) - GOLD_WT(umoney + count));
    if (count !== savequan) { obj.quan = savequan; obj.owt = saveowt; }
    wts.before = iw;
    wts.after = wt;

    if (wt < 0) return count;

    if (is_gold) {
        iw -= GOLD_WT(umoney);
        if (!adjust_wt) {
            qq = GOLD_CAPACITY(iw, umoney);
        } else {
            oow = 0;
            qq = 50 - (umoney % 100) - 1;
            if (qq < 0) qq += 100;
            for (; qq <= count; qq += 100) {
                obj.quan = qq;
                obj.owt = GOLD_WT(qq);
                ow = GOLD_WT(umoney + qq);
                ow -= delta_cwt(container, obj);
                if (iw + ow >= 0) break;
                oow = ow;
            }
            iw -= oow;
            qq -= 100;
        }
        if (qq < 0) qq = 0;
        else if (qq > count) qq = count;
        wt = iw + GOLD_WT(umoney + qq);
    } else if (count > 1 || count < obj.quan) {
        for (qq = 1; qq <= count; qq++) {
            obj.quan = qq;
            ow = weight(obj);
            obj.owt = ow;
            if (adjust_wt) ow -= delta_cwt(container, obj);
            if (iw + ow >= 0) break;
            wt = iw + ow;
        }
        --qq;
    } else {
        qq = 0;   /* only one, and we can't lift it */
    }
    obj.quan = savequan;
    obj.owt = saveowt;

    let obj_nambuf = '', where = '', verb = '';
    if (qq < count) {
        obj_nambuf = doname(obj);
        if (container) {
            where = `in ${the(xname(container))}`;
            verb = 'carry';
        } else {
            where = 'lying here';
            verb = telekinesis ? 'acquire' : 'lift';
        }
    }
    if (qq > 0) {
        if (qq < count)
            await pline(`You can only ${verb} ${qq === 1 ? 'one' : 'some'}`
                        + ` of the ${obj_nambuf} ${where}.`);
        wts.after = wt;
        return qq;
    }

    if (!container) where = 'here';
    let prefx1, prefx2, suffx;
    if (inventoryArray().length || umoney) {
        prefx1 = 'you cannot '; prefx2 = ''; suffx = ' any more';
    } else {
        prefx1 = (obj.quan === 1) ? 'it ' : 'even one ';
        prefx2 = 'is too heavy for you to '; suffx = '';
    }
    await pline(`There ${otense(obj, 'are')} ${obj_nambuf} ${where},`
                + ` but ${prefx1}${prefx2}${verb}${suffx}.`);
    return 0;
}

/* pickup.c:1705 lift_object() — able AND willing?  1 lift, 0 decline,
   -1 stop the whole pickup loop. */
export async function lift_object(obj, container, cnt_p, telekinesis) {
    if (obj.otyp === BOULDER && game.Sokoban) {
        await pline('You cannot get your hands around this boulder.');
        return -1;
    }
    if (obj.otyp === LOADSTONE
        || (obj.otyp === BOULDER && throws_rocks_hero())) {
        if (inv_cnt(false) < invlet_basic || !carrying_otyp(obj.otyp)
            || merge_choice(inventoryArray(), obj))
            return 1;   /* lift regardless of current situation */
        await pline('You are carrying too much stuff to pick up '
                    + `${obj.quan === 1 ? 'another' : 'more'} ${xname(obj)}.`);
        return -1;
    }

    const wts = { before: 0, after: 0 };
    cnt_p.value = await carry_count(obj, container, cnt_p.value, telekinesis,
                                    wts);
    let result;
    if (cnt_p.value < 1) {
        result = -1;
    } else if (obj.oclass !== COIN_CLASS
               && inv_cnt(false) >= invlet_basic
               && !merge_choice(inventoryArray(), obj)) {
        await pline('Your knapsack cannot accommodate any more items'
                    + `${nxtobj_gold(obj) ? ' (except gold)' : ''}.`);
        result = -1;
    } else {
        result = 1;
        let prev_encumbr = near_capacity();
        const burden_limit = pickup_burden();
        if (prev_encumbr < burden_limit) prev_encumbr = burden_limit;
        const next_encumbr = calc_capacity(wts.after - wts.before);
        if (next_encumbr > prev_encumbr) {
            if (telekinesis) {
                result = 0;
            } else {
                const savequan = obj.quan;
                obj.quan = cnt_p.value;
                const pfx = (next_encumbr >= EXT_ENCUMBER) ? overloadpfx
                    : (next_encumbr >= HVY_ENCUMBER) ? nearloadpfx
                        : (next_encumbr >= MOD_ENCUMBER) ? moderateloadpfx
                            : slightloadpfx;
                const qbuf = `${pfx} ${!container ? 'lifting' : 'removing'} `
                    + `${doname(obj)}.  Continue?`;
                obj.quan = savequan;
                switch (await ynq(qbuf)) {
                case 'q': result = -1; break;
                case 'n': result = 0; break;
                default: break;   /* 'y' => result == 1 */
                }
            }
        }
    }

    if (obj.otyp === SCR_SCARE_MONSTER && result <= 0 && !container) obj.spe = 0;
    return result;
}
function carrying_otyp(otyp) {
    for (const o of inventoryArray()) if (o.otyp === otyp) return true;
    return false;
}
/* invent.c nxtobj(obj, GOLD_PIECE, obj->where == OBJ_FLOOR) */
function nxtobj_gold(obj) {
    if (obj.where === 'floor') {
        for (const o of objects_at(obj.ox, obj.oy))
            if (o !== obj && o.otyp === GOLD_PIECE) return true;
        return false;
    }
    for (let o = obj.nobj; o; o = o.nobj) if (o.otyp === GOLD_PIECE) return true;
    return false;
}

/* ═══════════════════════════════════════════════════════════════════════
   pickup.c:1803 pickup_object()
   -1 caller should break out of its loop, 0 nothing picked up, 1 otherwise.
   ═══════════════════════════════════════════════════════════════════════ */
export async function pickup_object(obj, count, telekinesis) {
    if (obj.quan < count) return 0;

    // C ref: pickup.c:1817 `if (!Blind) observe_object(obj)`.  This read
    // `game.Blind`, which no module ever sets, so a BLIND hero still learned
    // every picked-up object's appearance ("o - a brilliant blue potion."
    // where C prints "o - a potion.").
    if (!Blind()) obj.dknown = 1;   /* observe_object() */

    if (obj === game.u?.uchain) {
        return 0;   /* do not pick up attached chain */
    } else if (obj.where === 'minvent' && obj.owornmask) {
        await pline(`You can't pick ${xname(obj)} up.`);
        return 0;
    } else if (obj.oartifact && !touch_artifact(obj, game.u)) {
        return 0;
    } else if (obj.otyp === CORPSE) {
        if ((await fatal_corpse_mistake(obj, telekinesis))
            || (await rider_corpse_revival(obj, telekinesis)))
            return -1;
    } else if (obj.otyp === SCR_SCARE_MONSTER) {
        /* process the count before altering/deleting scrolls */
        const wts = { before: 0, after: 0 };
        count = await carry_count(obj, null, count ? count : obj.quan, false,
                                  wts);
        if (count < 1) return -1;
        if (count > 0 && count < obj.quan) obj = splitobj(obj, count);

        if (obj.blessed) {
            obj.blessed = 0;
        } else if (!obj.spe && !obj.cursed) {
            obj.spe = 1;
        } else {
            await pline(`The scroll${plur(obj.quan)} ${otense(obj, 'turn')} to`
                        + ` dust as you ${telekinesis ? 'raise' : 'pick'}`
                        + ` ${obj.quan === 1 ? 'it' : 'them'} up.`);
            await trycall(obj);
            useupf(obj, obj.quan);
            return 1;   /* tried and failed, but don't end the pickup loop */
        }
    }

    const cnt_p = { value: count };
    const res = await lift_object(obj, null, cnt_p, telekinesis);
    if (res <= 0) return res;
    count = cnt_p.value;

    /* C ref: pickup.c pick_obj caller — `if (obj->oclass == COIN_CLASS)
       disp.botl = TRUE;` ($ field changes). */
    if (obj.oclass === COIN_CLASS) game.botl = true;
    if (obj.quan !== count && obj.otyp !== LOADSTONE) obj = splitobj(obj, count);

    /* pick_obj() + pickup_prinv(obj, count, "lifting"): js/invent.js's
       pick_one_obj() is that pair — it owns the shop billing and the topline
       chaining the recorded frames depend on. */
    const inv = await import('./invent.js');
    await inv.pick_one_obj(obj, count);
    return 1;
}

/* pickup.c:1897 pick_obj() — detach otmp from the floor (or an engulfer),
   bill it, and add it to inventory.  Returns the merged inventory object. */
export async function pick_obj(otmp) {
    const u = ustate();
    const fromfloor = otmp.where === 'floor';
    const ox = otmp.ox, oy = otmp.oy;
    const robshop = !u.uswallow && otmp !== u.uball && !!costly_spot(ox, oy);

    obj_extract_self(otmp);
    if (fromfloor) newsym(ox, oy);
    if (robshop) {
        const { addtobill } = await import('./shkroom.js');
        await addtobill(otmp, true, false, false);
    }
    return addinv(otmp);
}

/* pickup.c:1948 pickup_prinv() — the added-to-invent message, with the
   encumbrance prefix limited to the first item that changes the level. */
export function pickup_prinv_prefix(verb) {
    const nearload = near_capacity();
    if (nearload === pickup_encumbrance()) return null;
    const prefix = (nearload >= EXT_ENCUMBER) ? overloadpfx
        : (nearload >= HVY_ENCUMBER) ? nearloadpfx
            : (nearload >= MOD_ENCUMBER) ? moderateloadpfx
                : (nearload >= SLT_ENCUMBER) ? slightloadpfx
                    : null;
    set_pickup_encumbrance(nearload);
    return prefix ? `${prefix} ${verb}` : null;
}
export function pickup_prinv(obj, count, verb) {
    prinv(pickup_prinv_prefix(verb), obj, count);
}

/* pickup.c:1978 encumber_msg() lives in js/invent.js (it is the one piece of
   pickup.c the rest of the port already imported from there). */
export { encumber_msg };

/* pickup.c:2024 container_at() */
export function container_at(x, y, countem) {
    let container_count = 0;
    for (const cobj of objects_at(x, y)) {
        if (Is_container(cobj)) {
            container_count++;
            if (!countem) break;
        }
    }
    return container_count;
}

/* pickup.c:2041 able_to_loot() */
export async function able_to_loot(x, y, looting) {
    const verb = looting ? 'loot' : 'tip';
    const t = t_at(x, y);
    if (!can_reach_floor(!!(t && is_pit(t.ttyp)))) {
        await pline('You cannot reach the floor.');
        return false;
    } else if ((is_pool(x, y) && (looting || !game.Underwater)) || is_lava(x, y)) {
        await pline(`You cannot ${verb} things that are deep in the `
                    + `${hliquid(is_lava(x, y) ? 'lava' : 'water')}.`);
        return false;
    } else if (nolimbs_hero()) {
        await pline(`Without limbs, you cannot ${verb} anything.`);
        return false;
    } else if (looting && !freehand()) {
        await pline('Without a free hand, you cannot loot anything.');
        return false;
    }
    return true;
}

/* pickup.c:2072 mon_beside() */
export function mon_beside(x, y) {
    for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
            const nx = x + i, ny = y + j;
            if (isok(nx, ny) && m_at(nx, ny)) return true;
        }
    return false;
}

/* pickup.c:2088 do_loot_cont() — one container of a #loot.  cobjp.obj is
   cleared when the container is destroyed mid-attempt. */
export async function do_loot_cont(cobjp, cindex, ccount) {
    const cobj = cobjp.obj;
    if (!cobj) return ECMD_OK;
    if (cobj.olocked) {
        if (cobj.lknown) await pline(`${The(xname(cobj))} is locked.`);
        else await pline(`Hmmm, ${the(xname(cobj))} turns out to be locked.`);
        cobj.lknown = 1;
        /* flags.autounlock's pick_lock()/doforce() path is driven by the #loot
           handler in js/extcmd-handlers.js, which owns the lock tooling. */
        return ECMD_OK;
    }
    cobj.lknown = 1;

    if (cobj.otyp === BAG_OF_TRICKS) {
        await pline(`You carefully open ${the(xname(cobj))}...`);
        await pline('It develops a huge set of teeth and bites you!');
        const tmp = rnd(10);
        await losehp(Maybe_Half_Phys(tmp), 'carnivorous bag');
        makeknown(BAG_OF_TRICKS);
        P().abort_looting = true;
        return ECMD_TIME;
    }
    return await use_container(cobjp, false, cindex < ccount);
}

/* pickup.c:2166 doloot() — the #loot extended command. */
export async function doloot() {
    P().loot_reset_justpicked = true;
    const res = await doloot_core();
    P().loot_reset_justpicked = false;
    return res;
}

/* pickup.c:2178 doloot_core() */
export async function doloot_core() {
    const u = ustate();
    let c = -1;
    let timepassed = 0;
    const dont_find_anything = "don't find anything";

    P().abort_looting = false;

    if (near_capacity() >= EXT_ENCUMBER) {
        await pline("You can't do that while carrying so much stuff.");
        return ECMD_OK;
    }
    if (nohands_hero()) {
        await pline('You have no hands!');
        return ECMD_OK;
    }
    if (game.Confusion) {
        if (rn2(6) && await reverse_loot()) return ECMD_TIME;
        if (rn2(2)) {
            await pline('Being confused, you find nothing to loot.');
            return ECMD_TIME;   /* costs a turn */
        }
    }
    const cc = { x: u.ux, y: u.uy };

    const num_conts = container_at(cc.x, cc.y, true);
    if (num_conts > 0) {
        let anyfound = false;
        if (!(await able_to_loot(cc.x, cc.y, true))) return ECMD_OK;

        if (Blind() && !game.uarmg) {
            for (const nobj of objects_at(cc.x, cc.y))
                if (nobj.otyp === CORPSE && will_feel_cockatrice(nobj, false)) {
                    feel_cockatrice(nobj, false);
                    return ECMD_TIME;
                }
        }
        /* the >1 container "Loot which containers?" menu is rendered by
           js/extcmd-handlers.js's #loot handler */
        for (const cobj of objects_at(cc.x, cc.y)) {
            if (Is_container(cobj)) {
                anyfound = true;
                const boxp = { obj: cobj };
                timepassed |= await do_loot_cont(boxp, 1, num_conts);
                if (P().abort_looting)
                    return timepassed ? ECMD_TIME : ECMD_OK;
            }
        }
        if (anyfound) c = 'y';
    } else if (IS_GRAVE(game.level?.at?.(cc.x, cc.y)?.typ)) {
        await pline('You need to dig up the grave to effectively loot it...');
    }

    if (c !== 'y' && mon_beside(u.ux, u.uy)) {
        /* directional looting needs get_adjacent_loc() (cmd.c); the
           saddle-removal target is loot_mon() below */
        await pline(`You ${dont_find_anything} here to loot.`);
        return timepassed ? ECMD_TIME : ECMD_OK;
    } else if (c !== 'y' && c !== 'n') {
        await pline(`You ${dont_find_anything} here to loot.`);
    }
    return timepassed ? ECMD_TIME : ECMD_OK;
}

/* pickup.c:2350 reverse_loot() — called when #looting while confused. */
export async function reverse_loot() {
    const u = ustate();
    const x = u.ux, y = u.uy;
    const invent = inventoryArray();

    if (!rn2(3)) {
        /* n objects: 1/(n+1) chance per object, 1/(n+1) to fall off the end */
        let n = inv_cnt(true);
        for (const otmp of [...invent]) {
            if (!rn2(n + 1)) {
                prinv('You find old loot:', otmp, 0);
                return true;
            }
            --n;
        }
        return false;
    }

    let goldob = null;
    for (const o of [...invent]) {
        if (o.oclass === COIN_CLASS) {
            const contribution = Math.trunc((rnd(5) * o.quan + 4) / 5);
            goldob = (contribution < o.quan) ? splitobj(o, contribution) : o;
            break;
        }
    }
    if (!goldob) return false;

    await remove_worn_item(goldob, false);

    /* the throne-room coffers branch needs boxlock()/courtmon() (lock.c,
       mkroom.c); an ordinary square just drops the gold. */
    freeinv(goldob);
    dropx(goldob);
    if (!IS_THRONE(game.level?.at?.(x, y)?.typ)) {
        if (g_at(x, y)) await pline('Ok, now there is loot here.');
    } else {
        await pline(`You drop ${doname(goldob)}.`);
    }
    return true;
}
/* do.c dropx()/dropy() reduced to the floor placement + pile merge. */
function dropx(obj) {
    const u = ustate();
    place_object(obj, u.ux, u.uy);
    stackobj(obj);
    newsym(u.ux, u.uy);
}

/* pickup.c:2431 loot_mon() — returns the amount of time that passed. */
export async function loot_mon(mtmp, passed_info, prev_loot) {
    let timepassed = 0;
    const u = ustate();
    const W_SADDLE = 0x00100000; /* prop.h W_SADDLE */
    const otmp = (mtmp && mtmp !== u.usteed)
        ? (mtmp.minvent || []).find((o) => (o.owornmask || 0) & W_SADDLE)
        : null;
    if (otmp) {
        if (passed_info) passed_info.value = 1;
        const c = await ynq(
            `Do you want to remove the saddle from ${mon_nam(mtmp)}?`);
        if (c === 'y') {
            if (nolimbs_hero()) {
                await pline("You can't do that without limbs.");
                return 0;
            }
            if (otmp.cursed) {
                await pline('You can\'t.  The saddle seems to be stuck to '
                            + `${mon_nam(mtmp)}.`);
                return 1;   /* the attempt costs you time */
            }
            const ix = mtmp.minvent.indexOf(otmp);
            if (ix >= 0) mtmp.minvent.splice(ix, 1);
            otmp.owornmask = 0;
            await pline(`You take ${the(xname(otmp))} off of ${mon_nam(mtmp)}.`);
            await hold_another_object(otmp, 'You drop %s!', doname(otmp), null);
            timepassed = rnd(3);
            if (prev_loot) prev_loot.value = true;
        } else if (c === 'q') {
            return 0;
        }
    }
    if (u.uswallow) {
        const count = passed_info ? passed_info.value : 0;
        timepassed = await pickup(count);
    }
    return timepassed;
}
function mon_nam(mtmp) {
    return `the ${mtmp?.data?.name || mtmp?.name || 'monster'}`;
}

/* pickup.c:2488 mbag_explodes() — odds 1/1, 2/2, 3/4, 4/8, 5/16, ... */
export function mbag_explodes(obj, depthin) {
    if ((obj.otyp === WAN_CANCELLATION || obj.otyp === BAG_OF_TRICKS)
        && (obj.spe | 0) <= 0)
        return false;

    if ((Is_mbag(obj) || obj.otyp === WAN_CANCELLATION)
        && (rn2(1 << (depthin > 7 ? 7 : depthin)) <= depthin))
        return true;
    if (Has_contents(obj)) {
        for (const otmp of objchain(obj.cobj))
            if (mbag_explodes(otmp, depthin + 1)) return true;
    }
    return false;
}

/* pickup.c:2510 is_boh_item_gone() */
export function is_boh_item_gone() { return !rn2(13); }

/* pickup.c:2537 boh_loss() — a cursed magic bag tosses some of its contents. */
export async function boh_loss(container, held) {
    if (Is_mbag(container) && container.cursed && Has_contents(container)) {
        let loss = 0;
        for (const curr of [...container.cobj]) {
            if (is_boh_item_gone()) {
                obj_extract_self(curr);
                loss += await mbag_item_gone(held, curr, false);
            }
        }
        return loss;
    }
    return 0;
}

/* pickup.c:2803 mbag_item_gone() — an object inside a cursed bag of holding
   is destroyed.  stolen_value() (shk.c) is not ported, so a shop loss is 0. */
export async function mbag_item_gone(held, item, silent) {
    void held;
    if (!silent) {
        if (item.dknown)
            await pline(`${upstart(doname(item))} ${otense(item, 'have')} vanished!`);
        else
            await pline(`You ${Blind() ? 'notice' : 'see'} ${doname(item)} disappear!`);
    }
    obfree(item, null);
    return 0;
}

/* pickup.c:2781 removed_from_icebox() — a corpse taken out of an ice box
   resumes rotting (or, for an ice troll, starts a revive timer). */
export function removed_from_icebox(obj) {
    if (!age_is_relative(obj)) {
        obj.age = (game.moves || 0) - (obj.age || 0);
        if (obj.otyp === CORPSE) {
            const iceT = monster_by_pmidx(obj.corpsenm)?.name === 'ice troll';
            obj.norevive = iceT ? 0 : 1;
            start_corpse_timeout(obj);
        }
    }
}

/* pickup.c:2826 observe_quantum_cat() */
export async function observe_quantum_cat(box, makecat, givemsg) {
    const sc = "Schroedinger's Cat";
    const itsalive = !rn2(2);
    const u = ustate();
    if (box.where !== 'floor') { box.ox = u.ux; box.oy = u.uy; }

    const deadcat = (box.cobj || [])[0] || null;
    if (itsalive) {
        let livecat = null;
        if (makecat) {
            const mk = await import('./makemon.js');
            const PM_HOUSECAT = pmidx_by_name('housecat');
            const NO_MINVENT = 0x01, MM_ADJACENTOK = 0x10, MM_NOMSG = 0x20000;
            livecat = mk.makemon(monster_by_pmidx(PM_HOUSECAT), box.ox, box.oy,
                                 NO_MINVENT | MM_ADJACENTOK | MM_NOMSG);
        }
        if (livecat) {
            livecat.mpeaceful = 1;
            if (givemsg)
                await pline(`${upstart(mon_nam(livecat))} inside the box is still alive!`);
            livecat.mname = sc;
            if (deadcat) { obj_extract_self(deadcat); obfree(deadcat, null); }
            box.owt = weight(box);
            box.spe = 0;
        }
    } else {
        box.spe = 0;   /* now an ordinary box with a cat corpse inside */
        if (givemsg) await pline('The housecat inside the box is dead!');
        if (deadcat) {
            deadcat.age = game.moves || 0;
            deadcat.corpsenm = pmidx_by_name('housecat');
            deadcat.oname = sc;
        }
    }
}
function pmidx_by_name(nm) {
    for (let i = 0; i < 400; i++)
        if (monster_by_pmidx(i)?.name === nm) return i;
    return -1;
}

/* pickup.c:2903 container_gone() — TRUE once a magic-bag explosion has
   destroyed the container use_container() is working on. */
export function container_gone(fn) {
    return (fn === in_container || fn === out_container)
        && !P().current_container;
}

/* pickup.c:2911 explain_container_prompt() */
export const CONTAINER_HELP_TEXT = [
    'Container actions:', '',
    ' : -- Look: examine contents',
    ' o -- Out: take things out',
    ' i -- In: put things in',
    ' b -- Both: first take things out, then put things in',
    ' r -- Reversed: put things in, then take things out',
    ' s -- Stash: put one item in', '',
    ' n -- Next: loot next selected container',
    ' q -- Quit: finished',
    ' ? -- Help: display this text.', '',
];
export function explain_container_prompt(more_containers) {
    renderWindowScreen(CONTAINER_HELP_TEXT.filter(
        (t) => more_containers || t.slice(0, 3) !== ' n '));
}

/* pickup.c:2943 u_handsy() */
export async function u_handsy() {
    if (nohands_hero()) { await pline('You have no hands!'); return false; }
    if (!freehand()) { await pline('You have no free hand.'); return false; }
    return true;
}

/* pickup.c:2720 ck_bag() — askchain()/getobj() filter. */
export function ck_bag(obj) {
    return !!P().current_container && obj !== P().current_container;
}

/* pickup.c:2957 stash_ok() — getobj callback. */
export function stash_ok(obj) {
    if (!obj) return GETOBJ_EXCLUDE;
    if (!ck_bag(obj)) return GETOBJ_EXCLUDE_SELECTABLE;
    return GETOBJ_SUGGEST;
}

/* pickup.c:2558 in_container() — -1 stop, 1 inserted, 0 not inserted. */
export async function in_container(obj) {
    const p = P();
    const cc = p.current_container;
    const u = ustate();
    if (!cc) return 0;
    const floor_container = !carried(cc);
    const Icebox = cc.otyp === ICE_BOX;

    if (obj === u.uball || obj === u.uchain) {
        await pline('You must be kidding.');
        return 0;
    } else if (obj === cc) {
        await pline('That would be an interesting topological exercise.');
        return 0;
    } else if ((obj.owornmask || 0) & (W_ARMOR_WORN | W_ACCESSORY_WORN)) {
        await pline(`You cannot ${Icebox ? 'refrigerate' : 'stash'}`
                    + ' something you are wearing.');
        return 0;
    } else if (obj.otyp === LOADSTONE && obj.cursed) {
        obj.bknown = 1;
        await pline(`The stone${plur(obj.quan)} won't leave your person.`);
        return 0;
    } else if (obj.otyp === AMULET_OF_YENDOR
               || obj.otyp === CANDELABRUM_OF_INVOCATION
               || obj.otyp === BELL_OF_OPENING
               || obj.otyp === SPE_BOOK_OF_THE_DEAD) {
        await pline(`${The(xname(obj))} cannot be confined in such trappings.`);
        return 0;
    } else if (obj.otyp === LEASH && obj.leashmon) {
        await pline(`${upstart(xname(obj))} ${otense(obj, 'are')} attached`
                    + ' to your pet.');
        return 0;
    } else if (obj === game.uwep) {
        if (welded(obj)) return 0;
        game.uwep = null;
        obj.owornmask = 0;
    }

    if (await fatal_corpse_mistake(obj, false)) return -1;

    /* boxes, boulders and big statues fit into nothing */
    if (obj.otyp === ICE_BOX || Is_box(obj) || obj.otyp === BOULDER
        || (obj.otyp === STATUE && bigmonst_pm(obj.corpsenm))) {
        await pline(`You cannot fit ${the(xname(obj))} into ${the(xname(cc))}.`);
        return 0;
    }

    freeinv(obj);

    if (Icebox && !age_is_relative(obj)) {
        obj.age = (game.moves || 0) - (obj.age || 0);
        if (obj.otyp === CORPSE) obj.timed = false;   /* stop_timer(ROT_CORPSE) */
    } else if (Is_mbag(cc) && mbag_explodes(obj, 0)) {
        await pline(`As you put ${doname(obj)} inside, you are blasted by`
                    + ' a magical explosion!');
        /* do_boh_explosion() needs scatter() (dothrow.c), which is not ported;
           the trigger item and the bag are still consumed. */
        obfree(obj, null);
        if (!floor_container) useup(cc);
        else if (obj_here(cc, u.ux, u.uy)) useupf(cc, cc.quan);
        await losehp(d(6, 6), 'magical explosion');
        p.current_container = null;
    }

    if (p.current_container) {
        await pline(`You put ${doname(obj)} into `
                    + `${the(xname(p.current_container))}.`);
        add_to_container(p.current_container, obj);
        p.current_container.owt = weight(p.current_container);
    }
    await bot();
    return p.current_container ? 1 : -1;
}

/* pickup.c:2727 out_container() — -1 stop, 1 removed, 0 not removed. */
export async function out_container(obj) {
    const p = P();
    const cc = p.current_container;
    if (!cc) return -1;
    const is_gold = obj.oclass === COIN_CLASS;
    if (is_gold) obj.owt = weight(obj);

    if (obj.oartifact && !touch_artifact(obj, game.u)) return 0;
    if (await fatal_corpse_mistake(obj, false)) return -1;

    const cnt_p = { value: obj.quan };
    const res = await lift_object(obj, cc, cnt_p, false);
    if (res <= 0) return res;
    const count = cnt_p.value;

    if (obj.quan !== count && obj.otyp !== LOADSTONE) obj = splitobj(obj, count);

    obj_extract_self(obj);
    cc.owt = weight(cc);

    if (cc.otyp === ICE_BOX) removed_from_icebox(obj);

    if (!obj.unpaid && !carried(cc) && costly_spot(cc.ox, cc.oy)) {
        obj.ox = cc.ox; obj.oy = cc.oy;
        const { addtobill } = await import('./shkroom.js');
        await addtobill(obj, false, false, false);
    }

    const otmp = addinv(obj);
    pickup_prinv(otmp, count, 'removing');

    if (is_gold) await bot();
    return 1;
}

/* pickup.c:2972 use_container() — the "Do what with <container>?" driver.
   The :oibrsnq prompt/menu is rendered by js/extcmd-handlers.js's #loot
   handler; the preamble (lock/trap/quantum-cat/cursed-bag) is C's. */
export async function use_container(objp, held, more_containers) {
    const p = P();
    const obj = objp.obj;
    let used = ECMD_OK;

    p.abort_looting = false;
    p.sellobj_first = true;

    if (!(await u_handsy())) return ECMD_OK;

    if (!obj.lknown) obj.lknown = 1;
    if (obj.olocked) {
        await pline(`${upstart(xname(obj))} ${otense(obj, 'are')} locked.`);
        if (held) await pline('You must put it down to unlock.');
        return ECMD_OK;
    } else if (obj.otrapped) {
        /* chest_trap() (trap.c) is not ported. */
        p.abort_looting = true;
        return ECMD_TIME;
    }

    p.current_container = obj;

    if (SchroedingersBox(p.current_container)) {
        await observe_quantum_cat(p.current_container, true, true);
        used = ECMD_TIME;
    }
    if (Is_mbag(p.current_container) && p.current_container.cursed
        && Has_contents(p.current_container)) {
        const loss = await boh_loss(p.current_container, held);
        if (loss) {
            used = ECMD_TIME;
            await pline(`You owe ${loss} ${currency(loss)} for lost merchandise.`);
            p.current_container.owt = weight(p.current_container);
        }
    }
    void more_containers;
    objp.obj = p.current_container;
    return used;
}

/* pickup.c:3230 traditional_loot() — needs query_classes()'s getlin() and
   askchain(); query_classes() answers 'm', which is C's route to menu_loot. */
export async function traditional_loot(put_in) {
    return (await menu_loot(-2, put_in)) > ECMD_OK ? ECMD_TIME : ECMD_OK;
}

/* pickup.c:3265 menu_loot() */
export async function menu_loot(retry, put_in) {
    const p = P();
    let n_looted = 0;
    let all_categories = true;
    set_pickup_encumbrance(0);

    if (retry) all_categories = (retry === -2);

    const firstobj = put_in ? inventoryArray()
        : (p.current_container?.cobj || []);
    if (!put_in && p.current_container) p.current_container.cknown = 1;

    for (const otmp of [...firstobj]) {
        if (!p.current_container) break;
        if (all_categories || allow_category(otmp)) {
            const res = put_in ? await in_container(otmp)
                : await out_container(otmp);
            if (res < 0) break;
            n_looted += res;
        }
    }
    return n_looted ? ECMD_TIME : ECMD_OK;
}

/* pickup.c:3397 in_or_out_menu() — the accelerator tables; the menu itself is
   rendered by js/extcmd-handlers.js. */
export const LOOTCHARS = '_:oibrsnq';
export const LOOT_ABC_CHARS = '_:abcdenq';

/* pickup.c:3481 tip_ok() — getobj callback. */
export function tip_ok(obj) {
    if (!obj || obj.oclass === COIN_CLASS) return GETOBJ_EXCLUDE;
    if (Is_container(obj)) return GETOBJ_SUGGEST;
    if (obj.otyp === HORN_OF_PLENTY && obj.dknown
        && objects[obj.otyp]?.oc_name_known)
        return GETOBJ_SUGGEST;
    return GETOBJ_DOWNPLAY;
}

/* pickup.c:3849 count_target_containers() — #if 0 in C; the same skip rules
   tipcontainer_gettarget() applies. */
export function count_target_containers(olist, excludo) {
    let ret = 0;
    for (const o of objchain(olist)) {
        if (o !== excludo && Is_container(o)
            && (o.otyp !== BAG_OF_TRICKS || !o.dknown
                || !objects[o.otyp]?.oc_name_known))
            ret++;
    }
    return ret;
}

/* pickup.c:3954 tipcontainer_checks() */
export async function tipcontainer_checks(box, targetbox, allowempty) {
    if (targetbox && targetbox.otyp === BAG_OF_TRICKS) {
        /* bagotricks() (apply.c) is not ported. */
        return TIPCHECK_CANNOT;
    }
    if (!box.lknown) box.lknown = 1;

    if (box.olocked) {
        await pline(`${upstart(thesimpleoname(box))} is locked.`);
        return TIPCHECK_LOCKED;
    } else if (box.otrapped) {
        /* chest_trap() (trap.c) is not ported. */
        return TIPCHECK_TRAPPED;
    } else if (box.otyp === BAG_OF_TRICKS || box.otyp === HORN_OF_PLENTY) {
        /* bagotricks()/hornoplenty() (apply.c) are not ported. */
        return TIPCHECK_CANNOT;
    } else if (SchroedingersBox(box)) {
        await observe_quantum_cat(box, true, true);
        let empty_it = false;
        if (!Has_contents(box)) await pline('Your box is now empty.');
        else empty_it = true;
        box.cknown = 1;
        return (empty_it || allowempty) ? TIPCHECK_OK : TIPCHECK_EMPTY;
    } else if (!allowempty && !Has_contents(box)) {
        box.cknown = 1;
        await pline(`${upstart(thesimpleoname(box))} is empty.`);
        return TIPCHECK_EMPTY;
    }
    return TIPCHECK_OK;
}

/* pickup.c:3688 tipcontainer() — empty a container onto the floor or into
   another container. */
export async function tipcontainer(box, targetbox = null) {
    const u = ustate();
    let ox = u.ux, oy = u.uy;
    if (box.where === 'floor') { ox = box.ox; oy = box.oy; }
    box.ox = ox; box.oy = oy;

    if ((await tipcontainer_checks(box, targetbox, false)) !== TIPCHECK_OK)
        return;
    if (targetbox
        && (await tipcontainer_checks(targetbox, null, true)) !== TIPCHECK_OK)
        return;

    const srcheld = carried(box);
    const dstheld = !!(targetbox && carried(targetbox));
    const highdrop = !can_reach_floor(true);
    const altarizing = IS_ALTAR(game.level?.at?.(ox, oy)?.typ);
    const cursed_mbag = Is_mbag(box) && box.cursed;
    let terse = !(highdrop || altarizing || costly_spot(box.ox, box.oy));
    let loss = 0;
    box.cknown = 1;

    const contents = [...(box.cobj || [])];
    if (targetbox)
        await pline(`${contents.length > 1 ? 'Objects tumble' : 'An object tumbles'}`
                    + ` into ${the(xname(targetbox))}.`);
    else
        await pline(`${contents.length > 1 ? 'Objects spill' : 'An object spills'}`
                    + ` out${terse ? ':' : '.'}`);

    for (let i = 0; i < contents.length; i++) {
        const otmp = contents[i];
        const nobj = contents[i + 1] || null;
        obj_extract_self(otmp);
        otmp.ox = box.ox; otmp.oy = box.oy;

        if (box.otyp === ICE_BOX) {
            removed_from_icebox(otmp);
        } else if (cursed_mbag && is_boh_item_gone()) {
            loss += await mbag_item_gone(srcheld, otmp, false);
            terse = false;   /* abbreviated drop format no longer applies */
            continue;
        }
        if (targetbox) {
            if (Is_mbag(targetbox) && mbag_explodes(otmp, 0)) {
                await pline(`As ${doname(otmp)} ${otense(otmp, 'tumble')}`
                            + ' inside, you are blasted by a magical explosion!');
                obfree(otmp, null);
                await losehp(d(6, 6), 'magical explosion');
                break;
            }
            add_to_container(targetbox, otmp);
        } else {
            /* hitfloor()/doaltarobj() (do.c) are not ported; a plain drop is
               what the ordinary floor case does. */
            if (!terse)
                await pline(`${upstart(doname(otmp))} ${otense(otmp, 'drop')}`
                            + ' to the floor.');
            else
                await pline(`${doname(otmp)}${nobj ? ',' : '.'}`);
            otmp.how_lost = LOST_DROPPED;
            dropx(otmp);
        }
    }
    if (loss)
        await pline(`You owe ${loss} ${currency(loss)} for lost merchandise.`);
    box.owt = weight(box);
    if (targetbox) targetbox.owt = weight(targetbox);
    if (srcheld || dstheld) await encumber_msg();
}

/* pickup.c:3505 choose_tip_container_menu(), 3562 dotip() and 3871
   tipcontainer_gettarget() are the #tip command's menu halves; they are
   rendered by js/extcmd-handlers.js and drive tipcontainer() above. */

/* ── sys/share/posixregex.c regex_compile() / regerror(3) ─────────────────
   AUTOPICKUP_EXCEPTION patterns are compiled by regcomp(REG_EXTENDED), and a
   failure is reported to the player as "regex error in AUTOPICKUP_EXCEPTION:
   <regerror text>" — a config-error line that then sits on screen for every
   step up to the first Return, so its exact wording is worth as many screens
   as the rest of the session.  JS RegExp neither accepts the same language nor
   produces the same message, so classify the pattern the way Spencer's ERE
   parser (Darwin libc) does and emit its regerror() string.

   Returns { error, jsSource }: `error` is the regerror text (null when regcomp
   would have succeeded) and `jsSource` is the pattern with any construct that
   is literal in ERE but special in JS made literal, so `new RegExp` accepts
   what regcomp accepted. */
const REG_BADRPT_MSG = 'repetition-operator operand invalid';
const REG_EBRACK_MSG = 'brackets ([ ]) not balanced';
const REG_EPAREN_MSG = 'parentheses not balanced';
const REG_EBRACE_MSG = 'braces not balanced';
const REG_EESCAPE_MSG = 'trailing backslash (\\)';
const REG_BADBR_MSG = 'invalid repetition count(s)';
const REG_ERANGE_MSG = 'invalid character range';
const REG_ECTYPE_MSG = 'invalid character class';
const REG_EMPTY_MSG = 'empty (sub)expression';
/* regex(3) POSIX character class names */
const CCLASS_JS = {
    alnum: 'A-Za-z0-9', alpha: 'A-Za-z', blank: ' \\t', cntrl: '\\x00-\\x1f\\x7f',
    digit: '0-9', graph: '\\x21-\\x7e', lower: 'a-z', print: '\\x20-\\x7e',
    punct: '!-\\/:-@\\[-`{-~', space: ' \\t\\n\\v\\f\\r', upper: 'A-Z',
    xdigit: '0-9A-Fa-f',
};
const CCLASS_NAMES = new Set(Object.keys(CCLASS_JS));

/* one bracket expression, starting at the '['; returns the index just past the
   closing ']' or an error */
function ere_bracket(pat, start) {
    let i = start + 1;
    if (pat[i] === '^') i++;
    if (pat[i] === ']') i++;               /* a leading ']' is a literal */
    let prevWasRange = false, prevChar = null;
    for (; i < pat.length; i++) {
        const c = pat[i];
        if (c === ']') return { end: i + 1 };
        if (c === '[' && (pat[i + 1] === ':')) {
            const close = pat.indexOf(':]', i + 2);
            if (close < 0) return { error: REG_ECTYPE_MSG };
            if (!CCLASS_NAMES.has(pat.slice(i + 2, close)))
                return { error: REG_ECTYPE_MSG };
            i = close + 1; prevChar = null; prevWasRange = false;
            continue;
        }
        if (c === '-' && prevChar !== null && pat[i + 1] !== ']'
            && i + 1 < pat.length) {
            if (prevWasRange) return { error: REG_ERANGE_MSG };
            const hi = pat[i + 1];
            if (hi < prevChar) return { error: REG_ERANGE_MSG };
            i++; prevWasRange = true; prevChar = hi;
            continue;
        }
        prevChar = c; prevWasRange = false;
    }
    return { error: REG_EBRACK_MSG };
}

export function ere_compile(pat) {
    const src = String(pat);
    if (!src) return { error: REG_EMPTY_MSG, jsSource: src };
    let out = '', prevAtom = false, branchContent = false;
    /* one entry per open group; sawAlt says whether this group has a '|', which
       is what makes an empty branch an error ("()" compiles, "(a|)" does not) */
    const groups = [{ sawAlt: false }];
    const bad = (error) => ({ error, jsSource: src });
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '\\') {
            if (i + 1 >= src.length) return bad(REG_EESCAPE_MSG);
            out += src[i] + src[i + 1]; i++;
            prevAtom = true; branchContent = true;
            continue;
        }
        if (c === '[') {
            const r = ere_bracket(src, i);
            if (r.error) return bad(r.error);
            out += src.slice(i, r.end); i = r.end - 1;
            prevAtom = true; branchContent = true;
            continue;
        }
        if (c === '(') {
            out += c; groups.push({ sawAlt: false });
            prevAtom = false; branchContent = false;
            continue;
        }
        if (c === ')') {
            if (groups.length > 1) {
                const g = groups.pop();
                if (g.sawAlt && !branchContent) return bad(REG_EMPTY_MSG);
                out += c; prevAtom = true; branchContent = true;
            } else {
                out += '\\)';        /* literal in ERE, special in JS */
                prevAtom = true; branchContent = true;
            }
            continue;
        }
        if (c === '|') {
            if (!branchContent) return bad(REG_EMPTY_MSG);
            groups[groups.length - 1].sawAlt = true;
            out += c; prevAtom = false; branchContent = false;
            continue;
        }
        if (c === '*' || c === '+' || c === '?') {
            if (!prevAtom) return bad(REG_BADRPT_MSG);
            out += c; prevAtom = false;
            continue;
        }
        if (c === '{') {
            if (!(src[i + 1] >= '0' && src[i + 1] <= '9')) {
                out += '\\{';        /* not a bound: literal brace */
                prevAtom = true; branchContent = true;
                continue;
            }
            if (!prevAtom) return bad(REG_BADRPT_MSG);
            const close = src.indexOf('}', i + 1);
            if (close < 0) return bad(REG_EBRACE_MSG);
            const body = src.slice(i + 1, close);
            const m = /^(\d+)(,(\d*)?)?$/.exec(body);
            if (!m) return bad(REG_BADBR_MSG);
            if (m[3] && Number(m[3]) < Number(m[1])) return bad(REG_BADBR_MSG);
            out += src.slice(i, close + 1); i = close;
            prevAtom = false;
            continue;
        }
        if (c === '^' || c === '$') {
            out += c; prevAtom = false; branchContent = true;
            continue;
        }
        out += c; prevAtom = true; branchContent = true;
    }
    if (groups.length > 1) return bad(REG_EPAREN_MSG);
    if (groups[0].sawAlt && !branchContent) return bad(REG_EMPTY_MSG);
    /* JS has no POSIX classes; ere_bracket() has already validated the names */
    out = out.replace(/\[:([a-z]+):\]/g, (_m, nm) => CCLASS_JS[nm] ?? '');
    return { error: null, jsSource: out };
}
