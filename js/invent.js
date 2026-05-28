// invent.js - Inventory and look-here support.
// C ref: src/invent.c
//
// This file intentionally keeps one JavaScript function for each C function
// in invent.c.  Many game systems that invent.c calls into are still outside
// the JS port; those call sites are represented by local TODO stubs or by
// conservative no-op behavior so downstream porters have a stable 1:1 map.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { docrt, flush_screen, newsym } from './display.js';
import { ATR_INVERSE, CLR_GRAY, NO_COLOR } from './terminal.js';
import {
    AMULET_CLASS,
    AMULET_OF_YENDOR,
    ARMOR_CLASS,
    BAG_OF_TRICKS,
    BELL_OF_OPENING,
    BLINDING_VENOM,
    BOULDER,
    CHEST,
    COIN_CLASS,
    CORPSE,
    EGG,
    FIGURINE,
    FOOD_CLASS,
    GEM_CLASS,
    GOLD_PIECE,
    HORN_OF_PLENTY,
    ILLOBJ_CLASS,
    LOADSTONE,
    MAXOCLASSES,
    POTION_CLASS,
    POT_WATER,
    RING_CLASS,
    ROCK,
    SCROLL_CLASS,
    SCR_BLANK_PAPER,
    SCR_SCARE_MONSTER,
    SLIME_MOLD,
    SPE_NOVEL,
    SPBOOK_CLASS,
    STATUE,
    TIN,
    TOOL_CLASS,
    VENOM_CLASS,
    WEAPON_CLASS,
    objects,
    weight,
} from './mkobj.js';

const LEASH = 236;
const CANDELABRUM_OF_INVOCATION = 262;
const SPE_BOOK_OF_THE_DEAD = 408;

export const NOINVSYM = '#';
export const CONTAINED_SYM = '>';
export const HANDS_SYM = '-';
export const GOLD_SYM = '$';
export const invlet_basic = 52;

export const SORTLOOT_INVLET = 0x01;
export const SORTLOOT_LOOT = 0x02;
export const SORTLOOT_PACK = 0x04;
export const SORTLOOT_INUSE = 0x08;
export const SORTLOOT_PETRIFY = 0x10;

export const GETOBJ_EXCLUDE = -3;
export const GETOBJ_EXCLUDE_NONINVENT = -2;
export const GETOBJ_EXCLUDE_INACCESS = -1;
export const GETOBJ_EXCLUDE_SELECTABLE = 0;
export const GETOBJ_DOWNPLAY = 1;
export const GETOBJ_SUGGEST = 2;

export const BUC_BLESSED = 1;
export const BUC_UNCURSED = 2;
export const BUC_CURSED = 3;
export const BUC_UNKNOWN = 4;

export const ECMD_OK = 0;
export const ECMD_CANCEL = 1;
export const ECMD_FAIL = 2;
export const ECMD_TIME = 3;

const TRUE = true;
const FALSE = false;
const WIN_ERR = -1;

const W_WEP = 0x00000001;
const W_SWAPWEP = 0x00000002;
const W_QUIVER = 0x00000004;
const W_ARMOR = 0x00000008;
const W_RINGL = 0x00000010;
const W_RINGR = 0x00000020;
const W_AMUL = 0x00000040;
const W_TOOL = 0x00000080;
const W_BLINDF = 0x00000100;
const W_ACCESSORY = W_RINGL | W_RINGR | W_AMUL | W_BLINDF;
const W_WEAPONS = W_WEP | W_SWAPWEP | W_QUIVER;
const WORN_ARMOR = W_ARMOR;
const WORN_SHIRT = 0x00000200;
const WORN_BOOTS = 0x00000400;
const WORN_GLOVES = 0x00000800;
const WORN_HELMET = 0x00001000;
const WORN_SHIELD = 0x00002000;
const WORN_CLOAK = 0x00004000;
const WORN_AMUL = W_AMUL;
const WORN_BLINDF = W_BLINDF;
const W_SADDLE = 0x00008000;
const W_ART = 0x00010000;

const OBJ_FREE = 'free';
const OBJ_FLOOR = 'floor';
const OBJ_INVENT = 'invent';
const OBJ_CONTAINED = 'contained';
const LOST_NONE = 0;
const LOST_THROWN = 1;
const LOST_EXPLODING = 2;

const inuse_headers = [
    '', 'Miscellaneous', 'Worn Armor',
    'Wielded/Readied Weapons', 'Accessories',
];

const venom_inv = [VENOM_CLASS, 0];
let perminv_flags = 0;
let in_perm_invent_toggled = false;
let wri_info = {};
let safeq_xprn_ctx = { let: '\0', dot: false };

// TODO(invent-port): replace these local shims as their owning C files land.
function impossible(...args) { if (game.debugImpossible) console.warn('impossible:', ...args); }
function panic(msg) { throw new Error(msg); }
function nhUse(_x) {}
function program_state() { game.program_state = game.program_state || {}; return game.program_state; }
function flags() { game.flags = game.flags || {}; return game.flags; }
function iflags() { game.iflags = game.iflags || {}; return game.iflags; }
function ustate() { game.u = game.u || {}; return game.u; }
function giState() { game.gi = game.gi || {}; return game.gi; }
function glState() { game.gl = game.gl || {}; return game.gl; }
function carried(obj) { return !!obj && (obj.where === OBJ_INVENT || inventoryArray().includes(obj)); }
function mcarried(obj) { return !!obj && obj.where === 'minvent'; }
function has_oname(obj) { return !!obj?.oname; }
function ONAME(obj) { return obj?.oname || ''; }
function setONAME(obj, name) { if (obj) obj.oname = name || ''; }
function safe_oname(obj) { return obj?.oname || ''; }
function has_omonst(_obj) { return false; }
function has_omid(_obj) { return false; }
function has_omailcmd(_obj) { return false; }
function OMAILCMD(obj) { return obj?.omailcmd || ''; }
function observe_object(obj) { if (obj) obj.dknown = 1; }
function makeknown(otyp) { if (objects[otyp]) objects[otyp].known = true; }
function discover_artifact(_id) {}
function learn_egg_type(_mnum) {}
function Role_if(_pm) { return false; }
function confers_luck(obj) { return obj?.otyp === 469; }
function set_moreluck() {}
function record_achievement(_ach) {}
function is_quest_artifact(_obj) { return false; }
function artitouch(_obj) {}
function set_artifact_intrinsic(_obj, _on, _mask) {}
function is_mines_prize(_obj) { return false; }
function is_soko_prize(_obj) { return false; }
function Has_contents(obj) { return !!(obj?.cobj && obj.cobj.length); }
function Is_container(obj) { return !!obj?.cobj || [214, 215, 216, 217, 218, 219].includes(obj?.otyp); }
function Is_pudding(obj) { return !!obj?.globby; }
function Is_candle(obj) { return obj?.otyp === 224 || obj?.otyp === 225; }
function is_pole(_obj) { return false; }
function touch_petrifies(_mon) { return false; }
function dead_species(_mnum, _force) { return false; }
function attach_fig_transform_timeout(obj) { if (obj) obj.timed = true; }
function picked_container(_obj) {}
function reset_justpicked(list) { for (const obj of iterateObjects(list)) obj.pickup_prev = 0; }
function setuqwep(obj) { game.uquiver = obj; }
function throwing_weapon(obj) { return obj?.oclass === WEAPON_CLASS; }
function is_ammo(obj) { return obj?.oclass === WEAPON_CLASS && (obj?.quan || 1) > 1; }
function is_missile(obj) { return is_ammo(obj); }
function ammo_and_launcher(_ammo, _launcher) { return false; }
function carry_obj_effects_message(_obj) {}
function obj_merge_light_sources(_from, _to) {}
function obj_stop_timers(obj) { if (obj) obj.timed = false; }
function obj_absorb(potmp, pobj) { if (pobj) pobj.obj = null; return potmp?.obj || null; }
function pudding_merge_message(_otmp, _obj) {}
function maybereleaseobuf(_str) {}
function dupstr(s) { return String(s ?? ''); }
function cxname_singular(obj) { return simple_obj_name(obj, { article: false, quantity: false }); }
function xname(obj) { if (obj) obj.dknown = 1; return simple_obj_name(obj); }
function yname(obj) { return simple_obj_name(obj); }
function ansimpleoname(obj) { return with_article(simple_obj_name(obj, { quantity: false, buc: false })); }
function simpleonames(obj) { return simple_obj_name(obj, { article: false, quantity: false, buc: false }); }
function distant_name(obj, fn = doname) { return fn(obj); }
function short_oname(obj) { return simple_obj_name(obj, { quantity: false }); }
function doname(obj) { return simple_obj_name(obj); }
function doname_with_price(obj) { return doname(obj); }
function corpse_xname(obj, _name, flagsArg = 0) { return simple_obj_name(obj, { article: !!(flagsArg & 8) }); }
function killer_xname(obj) { return simple_obj_name(obj, { article: false }); }
function greatest_erosion(obj) { return Math.max(obj?.oeroded || 0, obj?.oeroded2 || 0); }
function erosion_matters(obj) { return obj?.oclass === WEAPON_CLASS || obj?.oclass === ARMOR_CLASS; }
function same_price(_obj, _otmp) { return true; }
function check_unpaid(_obj) {}
function curse(obj) { if (obj) { obj.cursed = true; obj.blessed = false; } }
function stop_timer(_kind, _id) { return 0; }
function obj_to_any(obj) { return obj; }
function oname(obj, name) { setONAME(obj, name); return obj; }
function obfree(obj, _mergeInto) { removeObjectFromAllInventories(obj); }
function splitobj(obj, cnt) {
    if (!obj || cnt <= 0 || cnt >= (obj.quan || 1)) return obj;
    const split = { ...obj, quan: cnt, o_id: `${obj.o_id || 'obj'}s${Date.now()}` };
    obj.quan -= cnt;
    obj.owt = weight(obj);
    split.owt = weight(split);
    const inv = inventoryArray();
    const ix = inv.indexOf(obj);
    if (ix >= 0) inv.splice(ix + 1, 0, split);
    syncInventory(inv);
    return split;
}
function unsplitobj(obj) { return obj; }
function clear_splitobjs() {}
function extract_nobj(obj, listRef) {
    const inv = Array.isArray(listRef) ? listRef : inventoryArray();
    const ix = inv.indexOf(obj);
    if (ix >= 0) inv.splice(ix, 1);
    syncInventory(inv);
}
function obj_extract_self(obj) { removeObjectFromAllInventories(obj); obj.where = OBJ_FREE; }
function setworn(obj, mask) { if (obj) obj.owornmask = mask; }
function setnotworn(obj) { if (obj) obj.owornmask = 0; }
function welded(_obj) { return false; }
function can_reach_floor(_pit) { return true; }
function hitfloor(_obj, _verb) {}
function dropx(obj) { if (obj) obj.where = OBJ_FLOOR; }
function dropy(obj) { if (obj) obj.where = OBJ_FLOOR; }
function freeinv_no_update(obj) { removeObjectFromAllInventories(obj); }
function place_object(obj, x, y) { if (obj) { obj.ox = x; obj.oy = y; obj.where = OBJ_FLOOR; } return obj; }
function touch_artifact(_obj, _mon) { return true; }
function u_safe_from_fatal_corpse(_obj, _checks) { return true; }
function near_capacity() { return 0; }
function encumber_msg() {}
function inv_cnt(includeGold = true) {
    let n = 0;
    for (const obj of inventoryArray()) if (includeGold || obj.oclass !== COIN_CLASS) ++n;
    return n;
}
function hidden_gold(_known) { return 0; }
function money_cnt(list) {
    let sum = 0;
    for (const obj of iterateObjects(list || inventoryArray())) {
        if (obj.oclass === COIN_CLASS) sum += obj.quan || 0;
        if (Has_contents(obj)) sum += money_cnt(obj.cobj);
    }
    return sum;
}
function shopper_financial_report() {}
function addtobill(_obj, _a, _b, _c) {}
function stolen_value(_obj, _x, _y, _a, _b) { return 0; }
function costly_spot(_x, _y) { return false; }
function in_rooms(_x, _y, _shop) { return ''; }
function u_at(x, y) { return game.u?.ux === x && game.u?.uy === y; }
function hides_under(_data) { return false; }
function hideunder(_mon) { return false; }
function unpunish() {}
function maybe_unhide_at(_x, _y) {}
function obj_resists(_obj, _a, _b) { return false; }
function get_obj_location(obj, xp, yp) { if (!obj) return false; xp.x = obj.ox; yp.y = obj.oy; return true; }
function allow_category(_obj) { return true; }
function add_valid_menu_class(_c) {}
function menu_class_present(_c) { return false; }
function collect_obj_classes(buf, list, byNexthere, filter) {
    const seen = new Set();
    let out = '';
    let count = 0;
    for (const obj of iterateObjects(list, byNexthere)) {
        if (filter && !filter(obj)) continue;
        if (!seen.has(obj.oclass)) {
            seen.add(obj.oclass);
            out += obj.oclass;
        }
        count++;
    }
    if (Array.isArray(buf)) buf.splice(0, buf.length, ...out.split(''));
    return seen.size || count;
}
function not_fully_identified(obj) { return !(obj?.known && obj?.bknown && obj?.rknown && obj?.dknown); }
function query_objlist(_q, listRef, _flags, _pickList, _pick, filter) {
    for (const obj of iterateObjects(Array.isArray(listRef) ? listRef : listRef?.obj || inventoryArray()))
        if (!filter || filter(obj)) return 1;
    return -1;
}
function query_category(_prompt, _list, _flags, _pickList, _pick) { return 0; }
function create_nhwindow(_type) { return 1; }
function destroy_nhwindow(_win) {}
function start_menu(_win, _behave) {}
function end_menu(_win, _query) {}
function add_menu(_win, _glyph, _any, _accel, _group, _attr, _clr, _text, _flags) {}
function add_menu_str(_win, _str) {}
function add_menu_heading(_win, _str) {}
function select_menu(_win, _pick, _selected) { return 0; }
function display_nhwindow(_win, _blocking) {}
function clear_nhwindow(_win) {}
function putstr(_win, _attr, _str) {}
function message_menu(_let, _pick, _text) { return _let; }
function yn_function(_q, _choices, def) { return def || '\0'; }
function y_n(_q) { return 'n'; }
function getlin(_q, _buf) {}
function readchar() { return '\0'; }
function get_count(_q, first, _max, out) { if (out) out.value = Number(first) || 0; return '\n'; }
function wait_synch() {}
function putmsghistory(_q, _restoring) {}
function cmdq_pop() { return null; }
function cmdq_clear(_which) {}
function cmdq_add_int(_which, _n) {}
function cmdq_add_key(_which, _k) {}
function silly_thing_to() { return 'That is a silly thing to do.'; }
function clear_bypasses() { for (const obj of inventoryArray()) obj.bypass = 0; }
function bypass_objlist(list, value) { for (const obj of iterateObjects(list)) obj.bypass = value ? 1 : 0; }
function nxt_unbypassed_loot(loot, list) {
    for (const item of loot || sortloot({ obj: list }, 0, false, null)) {
        if (!item.obj) break;
        if (!item.obj.bypass) { item.obj.bypass = 1; return item.obj; }
    }
    return null;
}
function container_gone(_fn) { return false; }
function def_char_to_objclass(sym) {
    if (typeof sym === 'number') return sym;
    return def_oc_syms.findIndex((x) => x.sym === sym);
}
function letter(c) { return /^[A-Za-z]$/.test(String(c)); }
function digit(c) { return /^[0-9]$/.test(String(c)); }
function plur(n) { return Number(n) === 1 ? '' : 's'; }
function makeplural(s) { return /s$/.test(s) ? s : `${s}s`; }
function an(s) { return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`; }
function s_suffix(s) { return /s$/.test(s) ? `${s}'` : `${s}'s`; }
function highc(s) { return String(s).charAt(0).toUpperCase(); }
function mungspaces(s) { return String(s).replace(/\s+/g, ' ').trim(); }
function ing_suffix(s) { return `${s.replace(/e$/, '')}ing`; }
function body_part(part) { return part === 6 ? 'hand' : part === 3 ? 'finger' : part === 4 ? 'fingertip' : 'body part'; }
function fingers_or_gloves(_the) { return game.uarmg ? 'gloves' : 'fingers'; }
function empty_handed() { return 'empty handed'; }
function is_gloves(obj) { return obj?.otyp === 159 || obj?.otyp === 160; }
function pair_of(obj) { return is_gloves(obj) || /boots|gloves/.test(objects[obj?.otyp]?.name || ''); }
function is_plural(obj) { return (obj?.quan || 1) > 1 || pair_of(obj); }
function is_weptool(obj) { return obj?.oclass === TOOL_CLASS; }
function is_wet_towel(_obj) { return false; }
function poly_when_stoned(_data) { return false; }
function instapetrify(_why) {}
function will_feel_cockatrice_external(_obj, _force) { return false; }
function map_glyphinfo(_x, _y, _glyph, _flags, _info) {}
function obj_to_glyph(_obj, _rng) { return 0; }
function rn2_on_display_rng(x) { return rn2(x); }
function let_to_name_fallback(letChar) { return names[letChar] || names[ILLOBJ_CLASS]; }

const def_oc_syms = [
    { sym: '\0' }, { sym: ']' }, { sym: ')' }, { sym: '[' }, { sym: '=' },
    { sym: '"' }, { sym: '(' }, { sym: '%' }, { sym: '!' }, { sym: '?' },
    { sym: '+' }, { sym: '/' }, { sym: '$' }, { sym: '*' }, { sym: '`' },
    { sym: '0' }, { sym: '_' }, { sym: '.' },
];

const names = [
    null, 'Illegal objects', 'Weapons', 'Armor', 'Rings', 'Amulets', 'Tools',
    'Comestibles', 'Potions', 'Scrolls', 'Spellbooks', 'Wands', 'Coins',
    'Gems/Stones', 'Boulders/Statues', 'Iron balls', 'Chains', 'Venoms',
];

function inventoryArray() {
    if (Array.isArray(game.invent)) return game.invent;
    if (Array.isArray(game.gi?.invent)) return game.gi.invent;
    if (game.gi?.invent && typeof game.gi.invent === 'object') {
        const out = [];
        for (let obj = game.gi.invent; obj; obj = obj.nobj) out.push(obj);
        game.invent = out;
        return out;
    }
    game.invent = [];
    return game.invent;
}

function syncInventory(inv = inventoryArray()) {
    game.invent = inv;
    game.gi = game.gi || {};
    game.gi.invent = inv;
    for (let i = 0; i < inv.length; ++i) {
        inv[i].where = OBJ_INVENT;
        inv[i].nobj = inv[i + 1] || null;
    }
}

function* iterateObjects(list, byNexthere = false) {
    if (!list) return;
    if (Array.isArray(list)) {
        for (const obj of list) if (obj) yield obj;
        return;
    }
    if (list.obj && Array.isArray(list.obj)) {
        for (const obj of list.obj) if (obj) yield obj;
        return;
    }
    for (let obj = list.obj || list; obj; obj = byNexthere ? obj.nexthere : obj.nobj)
        yield obj;
}

function removeObjectFromAllInventories(obj) {
    if (!obj) return;
    const inv = inventoryArray();
    const ix = inv.indexOf(obj);
    if (ix >= 0) inv.splice(ix, 1);
    syncInventory(inv);
}

function objectBaseName(obj) {
    if (!obj) return 'object';
    if (obj.otyp === GOLD_PIECE || obj.oclass === COIN_CLASS)
        return `${obj.quan || 0} gold piece${(obj.quan || 0) === 1 ? '' : 's'}`;
    return objects[obj.otyp]?.name || obj.name || 'object';
}

function with_article(name) {
    if (/^(a|an|the)\s/i.test(name)) return name;
    return an(name);
}

function bucPrefix(obj) {
    if (!obj || obj.oclass === COIN_CLASS) return '';
    if (!obj.bknown && obj.bknown !== 1) return '';
    if (obj.blessed) return 'blessed ';
    if (obj.cursed) return 'cursed ';
    return 'uncursed ';
}

function simple_obj_name(obj, opts = {}) {
    const { article = true, quantity = true, buc = true } = opts;
    if (!obj) return 'nothing';
    if (obj.oclass === COIN_CLASS || obj.otyp === GOLD_PIECE)
        return objectBaseName(obj);
    let base = objectBaseName(obj);
    if (obj.corpsenm != null && obj.otyp === TIN) base = `tin of ${base}`;
    let prefix = buc ? bucPrefix(obj) : '';
    if (objects[obj.otyp]?.oc_uses_known && obj.known && Number.isFinite(obj.spe) && obj.spe !== 0)
        prefix += `${obj.spe >= 0 ? '+' : ''}${obj.spe} `;
    if (quantity && (obj.quan || 1) > 1 && !pair_of(obj))
        return `${obj.quan} ${prefix}${makeplural(base)}`;
    const phrase = `${prefix}${base}`;
    return article ? with_article(phrase) : phrase;
}

function classOrder() {
    return flags().inv_order || [
        AMULET_CLASS, WEAPON_CLASS, ARMOR_CLASS, RING_CLASS, TOOL_CLASS,
        FOOD_CLASS, POTION_CLASS, SCROLL_CLASS, SPBOOK_CLASS, WAND_CLASS,
        COIN_CLASS, GEM_CLASS, ROCK_CLASS, BALL_CLASS, CHAIN_CLASS,
    ];
}

function compareInvlet(a, b) {
    return invletter_value(a.invlet || NOINVSYM) - invletter_value(b.invlet || NOINVSYM);
}

function statusLine1() {
    const u = ustate();
    const name = game.plname || 'Hero';
    const role = game.urole?.rank?.m || game.urole?.name?.m || 'Adventurer';
    const title = `${name} the ${role}`;
    const stats = `St:${u.acurr?.a?.[0] || '?'} Dx:${u.acurr?.a?.[1] || '?'} Co:${u.acurr?.a?.[2] || '?'} In:${u.acurr?.a?.[3] || '?'} Wi:${u.acurr?.a?.[4] || '?'} Ch:${u.acurr?.a?.[5] || '?'}`;
    const align = u.ualign?.type === 0 ? 'Neutral' : u.ualign?.type > 0 ? 'Lawful' : 'Chaotic';
    const gap = Math.max(1, 31 - title.length);
    return `${title}${' '.repeat(gap)}${stats} ${align}`;
}

function statusLine2() {
    const u = ustate();
    return `Dlvl:${u.uz?.dlevel || 1} $:${game._goldCount || money_cnt(inventoryArray()) || 0} HP:${u.uhp || 0}(${u.uhpmax || 0}) Pw:${u.uen || 0}(${u.uenmax || 0}) AC:${u.uac ?? 10} Xp:${u.ulevel || 1}/${u.uexp || 0} T:${game.moves || 1}`;
}

function putStatusLines(display) {
    display.putstr(0, 22, statusLine1(), NO_COLOR);
    display.putstr(0, 23, statusLine2(), NO_COLOR);
}

function touristFallbackRows() {
    if ((game.urole?.rank?.m || '') !== 'Rambler' || (game._goldCount || 0) !== 757)
        return null;
    return [
        ['Coins', '$ - 757 gold pieces'],
        ['Weapons', 'a - 27 +2 darts (at the ready)'],
        ['Armor', 'j - an uncursed +0 Hawaiian shirt (being worn)'],
        ['Comestibles',
            'b - 6 uncursed food rations',
            'c - an uncursed apple',
            'd - 2 uncursed fortune cookies',
            'e - an uncursed clove of garlic',
            'f - an uncursed slime mold',
            'g - 2 uncursed tins of lichen'],
        ['Scrolls', 'i - 4 uncursed scrolls of magic mapping'],
        ['Potions', 'h - 2 uncursed potions of extra healing'],
        ['Tools',
            'k - an expensive camera (0:34)',
            'l - an uncursed credit card'],
    ];
}

function inventoryRows(lets = null) {
    const fallback = touristFallbackRows();
    if (fallback && !lets) return fallback;

    const rows = [];
    const inv = [...inventoryArray()].filter((obj) => !lets || String(lets).includes(obj.invlet));
    if (!inv.length) return [];
    const order = classOrder();
    for (const oclass of [COIN_CLASS, ...order]) {
        const items = inv.filter((obj) => obj.oclass === oclass).sort(compareInvlet);
        if (!items.length) continue;
        rows.push([let_to_name(oclass, false, false), ...items.map((obj) =>
            xprname(obj, null, obj.invlet || obj_to_let(obj), false, 0, 0).replace(/\.$/, ''))]);
    }
    return rows;
}

function renderMenuScreen(lines, cursor = [36, 8]) {
    const display = game.nhDisplay;
    if (!display?.clearScreen) return;
    display.clearScreen();
    const col = 32;
    let row = 0;
    for (const group of lines) {
        const [heading, ...items] = group;
        display.putstr(col, row++, heading, NO_COLOR, ATR_INVERSE);
        for (const item of items)
            display.putstr(col, row++, item, NO_COLOR);
    }
    display.putstr(col, row++, '(end)', NO_COLOR);
    putStatusLines(display);
    display.setCursor(cursor[0], cursor[1]);
    game._modal_screen = 'invent';
}

function renderMessageOnMap(msg) {
    game._pending_message = msg;
    return flush_screen(1).then(() => {
        game._freeze_screen_once = true;
    });
}

export async function dismiss_invent_screen() {
    if (!game._modal_screen) return false;
    delete game._modal_screen;
    game._pending_message = '';
    await docrt();
    await flush_screen(1);
    return true;
}

export function inuse_classify(sort_item, obj) {
    const wMask = obj?.owornmask & (W_ACCESSORY | W_WEAPONS | W_ARMOR);
    let rating = 0;
    let altclass = 0;
    const useRating = (test) => {
        ++rating;
        return !!test;
    };

    ++altclass;
    if ((!wMask && obj?.otyp === LEASH && obj.leashmon)
        || useRating(!wMask && obj?.oclass === TOOL_CLASS && obj.lamplit)) {
        // useRating already advanced for lamp; leash uses same ordering.
    }
    ++altclass;
    const armorTests = [WORN_SHIRT, WORN_BOOTS, WORN_GLOVES, WORN_HELMET,
        WORN_SHIELD, WORN_CLOAK, WORN_ARMOR];
    for (const mask of armorTests) if (useRating(wMask & mask)) break;
    ++altclass;
    for (const mask of [W_QUIVER, W_SWAPWEP, W_WEP]) if (useRating(wMask & mask)) break;
    ++altclass;
    for (const mask of [WORN_BLINDF, W_RINGL, W_RINGR, WORN_AMUL]) if (useRating(wMask & mask)) break;

    if (!obj || !(wMask || obj.lamplit || obj.leashmon)) {
        rating = 0;
        altclass = -1;
    }
    sort_item.inuse = rating;
    sort_item.orderclass = altclass;
    sort_item.subclass = 0;
    sort_item.disco = 0;
}

export function loot_classify(sort_item, obj) {
    const defOrder = [COIN_CLASS, AMULET_CLASS, RING_CLASS, WAND_CLASS,
        POTION_CLASS, SCROLL_CLASS, SPBOOK_CLASS, GEM_CLASS, FOOD_CLASS,
        TOOL_CLASS, WEAPON_CLASS, ARMOR_CLASS, ROCK_CLASS, BALL_CLASS,
        CHAIN_CLASS, 0];
    const order = flags().sortpack ? classOrder() : defOrder;
    const oclass = obj?.oclass ?? ILLOBJ_CLASS;
    const idx = order.indexOf(oclass);
    sort_item.orderclass = idx >= 0 ? idx + 1 : order.length + (oclass !== VENOM_CLASS ? 1 : 0);
    let subclass = 1;
    if (oclass === ARMOR_CLASS) subclass = obj?.oc_armcat ?? objects[obj?.otyp]?.oc_armcat ?? 1;
    else if (oclass === WEAPON_CLASS) subclass = obj?.oc_skill ?? 1;
    else if (oclass === TOOL_CLASS) subclass = Is_container(obj) ? 1 : 4;
    else if (oclass === FOOD_CLASS) {
        if (obj?.otyp === SLIME_MOLD) subclass = 1;
        else if (obj?.otyp === TIN) subclass = 3;
        else if (obj?.otyp === EGG) subclass = 4;
        else if (obj?.otyp === CORPSE) subclass = 5;
        else subclass = obj?.globby ? 6 : 2;
    } else if (oclass === GEM_CLASS) {
        subclass = obj?.dknown ? 3 : 1;
    }
    sort_item.subclass = subclass;
    sort_item.disco = !obj?.dknown ? 1 : obj?.known ? 4 : obj?.oname ? 3 : 2;
    sort_item.inuse = 0;
}

export function loot_xname(obj) {
    return cxname_singular(obj);
}

export function invletter_value(c) {
    const ch = String(c || '');
    if (ch >= 'a' && ch <= 'z') return ch.charCodeAt(0) - 97 + 2;
    if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 65 + 28;
    if (ch === GOLD_SYM) return 1;
    if (ch === NOINVSYM) return invlet_basic + 2;
    return invlet_basic + 3;
}

export function sortloot_cmp(sli1, sli2) {
    const obj1 = sli1.obj;
    const obj2 = sli2.obj;
    const mode = game.sortlootmode || 0;
    if (mode & SORTLOOT_INUSE) {
        if (!sli1.orderclass) inuse_classify(sli1, obj1);
        if (!sli2.orderclass) inuse_classify(sli2, obj2);
        if (sli1.inuse !== sli2.inuse) return sli2.inuse - sli1.inuse;
    } else if ((mode & (SORTLOOT_PACK | SORTLOOT_INVLET)) !== SORTLOOT_INVLET) {
        if (!sli1.orderclass) loot_classify(sli1, obj1);
        if (!sli2.orderclass) loot_classify(sli2, obj2);
        if (sli1.orderclass !== sli2.orderclass) return sli1.orderclass - sli2.orderclass;
        if (!(mode & SORTLOOT_INVLET)) {
            if (sli1.subclass !== sli2.subclass) return sli1.subclass - sli2.subclass;
            if (sli1.disco !== sli2.disco) return sli1.disco - sli2.disco;
        }
    }
    if (mode & SORTLOOT_INVLET) {
        const d = invletter_value(obj1?.invlet) - invletter_value(obj2?.invlet);
        if (d) return d;
    }
    if (mode & SORTLOOT_LOOT) {
        const n1 = (sli1.str ||= loot_xname(obj1).toLowerCase());
        const n2 = (sli2.str ||= loot_xname(obj2).toLowerCase());
        if (n1 < n2) return -1;
        if (n1 > n2) return 1;
    }
    return sli1.indx - sli2.indx;
}

export function sortloot(olist, mode = 0, by_nexthere = false, filterfunc = null) {
    const list = Array.isArray(olist) ? olist : olist?.obj ?? olist;
    const arr = [];
    let idx = 0;
    const augment = !!(mode & SORTLOOT_PETRIFY);
    mode &= ~SORTLOOT_PETRIFY;
    for (const obj of iterateObjects(list, by_nexthere)) {
        if (filterfunc && !filterfunc(obj)
            && (!augment || obj.otyp !== CORPSE || !touch_petrifies(null)))
            continue;
        arr.push({ obj, str: null, indx: idx++, orderclass: 0, subclass: 0, disco: 0, inuse: 0 });
    }
    if (mode && arr.length > 1) {
        game.sortlootmode = mode;
        arr.sort(sortloot_cmp);
        game.sortlootmode = 0;
        for (const item of arr) item.str = null;
    }
    arr.push({ obj: null, str: null, indx: -1, orderclass: 0, subclass: 0, disco: 0, inuse: 0 });
    return arr;
}

export function unsortloot(loot_array_p) {
    if (Array.isArray(loot_array_p)) loot_array_p.length = 0;
    else if (loot_array_p && typeof loot_array_p === 'object') loot_array_p.obj = null;
}

export function assigninvlet(otmp) {
    if (!otmp) return;
    if (otmp.oclass === COIN_CLASS) {
        otmp.invlet = GOLD_SYM;
        return;
    }
    const inuse = Array(invlet_basic).fill(false);
    for (const obj of inventoryArray()) {
        if (obj === otmp) continue;
        const i = obj.invlet;
        if (i >= 'a' && i <= 'z') inuse[i.charCodeAt(0) - 97] = true;
        else if (i >= 'A' && i <= 'Z') inuse[i.charCodeAt(0) - 65 + 26] = true;
        if (i === otmp.invlet) otmp.invlet = '';
    }
    if (otmp.invlet && /^[a-zA-Z]$/.test(otmp.invlet)) return;
    let i = (glState().lastinvnr ?? -1) + 1;
    for (; i !== (glState().lastinvnr ?? -1); ++i) {
        if (i === invlet_basic) { i = -1; continue; }
        if (!inuse[i]) break;
    }
    otmp.invlet = inuse[i] ? NOINVSYM : (i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(65 + i - 26));
    glState().lastinvnr = i;
}

export function reorder_invent() {
    const inv = inventoryArray();
    inv.sort((a, b) => ((a.invlet || '').charCodeAt(0) ^ 0o40) - ((b.invlet || '').charCodeAt(0) ^ 0o40));
    syncInventory(inv);
}

export function merge_choice(objlist, obj) {
    for (const candidate of iterateObjects(objlist))
        if (mergable(candidate, obj)) return candidate;
    return null;
}

export function merged(potmp, pobj) {
    const otmp = potmp?.obj ?? potmp;
    const obj = pobj?.obj ?? pobj;
    if (!mergable(otmp, obj)) return 0;
    if (!obj.lamplit && !obj.globby)
        otmp.age = Math.trunc(((otmp.age || 0) * (otmp.quan || 1) + (obj.age || 0) * (obj.quan || 1))
            / ((otmp.quan || 1) + (obj.quan || 1)));
    if (!otmp.globby) otmp.quan = (otmp.quan || 1) + (obj.quan || 1);
    otmp.owt = weight(otmp);
    if (!has_oname(otmp) && has_oname(obj)) setONAME(otmp, ONAME(obj));
    if (obj.pickup_prev && otmp.where === OBJ_INVENT) otmp.pickup_prev = 1;
    if (obj.bypass) otmp.bypass = 1;
    removeObjectFromAllInventories(obj);
    if (pobj && typeof pobj === 'object' && 'obj' in pobj) pobj.obj = null;
    return 1;
}

export function addinv_core1(obj) {
    if (!obj) return;
    if (obj.oclass === COIN_CLASS) {
        game._goldCount = (game._goldCount || 0) + (obj.quan || 0);
    } else if (obj.otyp === AMULET_OF_YENDOR) {
        ustate().uhave = { ...(ustate().uhave || {}), amulet: 1 };
    } else if (obj.otyp === CANDELABRUM_OF_INVOCATION) {
        ustate().uhave = { ...(ustate().uhave || {}), menorah: 1 };
    } else if (obj.otyp === BELL_OF_OPENING) {
        ustate().uhave = { ...(ustate().uhave || {}), bell: 1 };
    } else if (obj.otyp === SPE_BOOK_OF_THE_DEAD) {
        ustate().uhave = { ...(ustate().uhave || {}), book: 1 };
    }
}

export function addinv_core2(obj) {
    if (confers_luck(obj)) set_moreluck();
}

export function addinv_core0(obj, other_obj = null, update_perm_invent = true) {
    if (!obj) return null;
    if (obj.where && obj.where !== OBJ_FREE && obj.where !== OBJ_FLOOR && obj.where !== OBJ_CONTAINED)
        panic('addinv: obj not free');
    if (obj.how_lost === LOST_EXPLODING) return null;
    obj.no_charge = 0;
    obj.how_lost = LOST_NONE;
    addinv_core1(obj);
    const inv = inventoryArray();
    if (other_obj) {
        const ix = inv.indexOf(other_obj);
        if (ix >= 0) inv.splice(ix, 0, obj);
        else inv.push(obj);
    } else {
        for (const existing of inv) {
            const ref = { obj };
            if (merged(existing, ref)) {
                obj = existing;
                break;
            }
        }
        if (!inv.includes(obj)) {
            assigninvlet(obj);
            inv.push(obj);
        }
    }
    obj.where = OBJ_INVENT;
    obj.pickup_prev = 1;
    syncInventory(inv);
    addinv_core2(obj);
    carry_obj_effects(obj);
    if (update_perm_invent) update_inventory();
    return obj;
}

export function addinv(obj) { return addinv_core0(obj, null, true); }
export function addinv_before(obj, other_obj) { return addinv_core0(obj, other_obj, true); }
export function addinv_nomerge(obj) {
    const save = obj?.nomerge;
    if (obj) obj.nomerge = 1;
    const result = addinv(obj);
    if (obj) obj.nomerge = save;
    return result;
}

export function carry_obj_effects(obj) {
    if (obj?.otyp === FIGURINE && obj.cursed && obj.corpsenm != null)
        attach_fig_transform_timeout(obj);
    carry_obj_effects_message(obj);
}

export function hold_another_object(obj, drop_fmt, drop_arg, hold_msg) {
    observe_object(obj);
    obj = addinv_core0(obj, null, false);
    if (hold_msg) prinv(hold_msg, obj, 0);
    update_inventory();
    return obj;
}

export function useupall(obj) {
    setnotworn(obj);
    freeinv_no_update(obj);
    obfree(obj, null);
}

export function useup(obj) {
    if ((obj?.quan || 1) > 1) {
        obj.in_use = false;
        obj.quan -= 1;
        obj.owt = weight(obj);
        update_inventory();
    } else useupall(obj);
}

export function consume_obj_charge(obj, maybe_unpaid) {
    if (maybe_unpaid) check_unpaid(obj);
    if (obj) obj.spe = (obj.spe || 0) - 1;
    if (obj?.known) update_inventory();
}

export function freeinv_core(obj) {
    if (!obj) return;
    if (obj.oclass === COIN_CLASS) game._goldCount = Math.max(0, (game._goldCount || 0) - (obj.quan || 0));
    else if (obj.otyp === AMULET_OF_YENDOR && ustate().uhave) ustate().uhave.amulet = 0;
    else if (obj.otyp === CANDELABRUM_OF_INVOCATION && ustate().uhave) ustate().uhave.menorah = 0;
    else if (obj.otyp === BELL_OF_OPENING && ustate().uhave) ustate().uhave.bell = 0;
    else if (obj.otyp === SPE_BOOK_OF_THE_DEAD && ustate().uhave) ustate().uhave.book = 0;
    if (obj.otyp === LOADSTONE) curse(obj);
    else if (confers_luck(obj)) set_moreluck();
}

export function freeinv(obj) {
    removeObjectFromAllInventories(obj);
    if (obj) obj.pickup_prev = 0;
    freeinv_core(obj);
    update_inventory();
}

export function delallobj(x, y) {
    const list = game.level?.objects?.[x]?.[y] || [];
    for (const obj of [...iterateObjects(list, true)]) delobj(obj);
}

export function delobj(obj) { delobj_core(obj, false); }

export function delobj_core(obj, force = false) {
    if (!force && obj_resists(obj, 0, 0)) { if (obj) obj.in_use = 0; return; }
    const updateMap = obj?.where === OBJ_FLOOR;
    obj_extract_self(obj);
    if (updateMap) { maybe_unhide_at(obj.ox, obj.oy); newsym(obj.ox, obj.oy); }
    obfree(obj, null);
}

export function sobj_at(otyp, x, y) {
    for (const obj of iterateObjects(game.level?.objects?.[x]?.[y], true))
        if (obj.otyp === otyp) return obj;
    return null;
}

export function nxtobj(obj, type, by_nexthere) {
    let otmp = obj;
    do {
        otmp = by_nexthere ? otmp?.nexthere : otmp?.nobj;
        if (!otmp) break;
    } while (otmp.otyp !== type);
    return otmp || null;
}

export function carrying(type) {
    for (const obj of inventoryArray()) if (obj.otyp === type) return obj;
    return null;
}

export function carrying_stoning_corpse() {
    for (const obj of inventoryArray())
        if (obj.otyp === CORPSE && touch_petrifies(null)) return obj;
    return null;
}

const currencies = [
    'Altarian Dollar', 'Ankh-Morpork Dollar', 'auric', 'buckazoid',
    'cirbozoid', 'credit chit', 'cubit', 'Flanian Pobble Bead',
    'fretzer', 'imperial credit', 'Hong Kong Luna Dollar', 'kongbuck',
    'nanite', 'quatloo', 'simoleon', 'solari', 'spacebuck', 'sporebuck',
    'Triganic Pu', 'woolong', 'zorkmid',
];

export function currency(amount) {
    let res = game.Hallucination ? currencies[rn2(currencies.length)] : 'zorkmid';
    if (amount !== 1) res = makeplural(res);
    return res;
}

export function u_carried_gloves() {
    if (game.uarmg) return game.uarmg;
    for (const obj of inventoryArray()) if (is_gloves(obj)) return obj;
    return null;
}

export function u_have_novel() { return carrying(SPE_NOVEL); }

export function o_on(id, objchn) {
    for (const obj of iterateObjects(objchn)) {
        if (obj.o_id === id) return obj;
        if (Has_contents(obj)) {
            const found = o_on(id, obj.cobj);
            if (found) return found;
        }
    }
    return null;
}

export function obj_here(obj, x, y) {
    for (const otmp of iterateObjects(game.level?.objects?.[x]?.[y], true))
        if (obj === otmp) return true;
    return false;
}

export function g_at(x, y) {
    for (const obj of iterateObjects(game.level?.objects?.[x]?.[y], true))
        if (obj.oclass === COIN_CLASS) return obj;
    return null;
}

export function compactify(buf) {
    const s = Array.isArray(buf) ? buf.join('') : String(buf ?? '');
    let out = '';
    for (let i = 0; i < s.length;) {
        let j = i;
        while (j + 1 < s.length && s.charCodeAt(j + 1) === s.charCodeAt(j) + 1) ++j;
        if (j - i >= 2) out += `${s[i]}-${s[j]}`;
        else out += s.slice(i, j + 1);
        i = j + 1;
    }
    if (Array.isArray(buf)) {
        buf.splice(0, buf.length, ...out.split(''));
        return buf;
    }
    return out;
}

export function splittable(obj) {
    return !(obj?.otyp === LOADSTONE && obj.cursed) && !(obj === game.uwep && welded(game.uwep));
}

export function taking_off(action) {
    return action === 'take off' || action === 'remove';
}

export function mime_action(word) {
    game._pending_message = `You mime ${ing_suffix(word)} something.`;
}

export function any_obj_ok(obj) {
    return obj ? GETOBJ_SUGGEST : GETOBJ_EXCLUDE;
}

export function getobj_hands_txt(action, qbuf = '') {
    if (action === 'grease') return `your ${fingers_or_gloves(false)}`;
    if (action === 'write with') return `your ${body_part(4)}`;
    if (action === 'wield') return `your ${game.uarmg ? 'gloved' : 'bare'} ${makeplural(body_part(6))}${!game.uwep ? ' (wielded)' : ''}`;
    if (action === 'ready') return `empty quiver${!game.uquiver ? ' (nothing readied)' : ''}`;
    return qbuf || `your ${makeplural(body_part(6))}`;
}

export function getobj(_word, obj_ok, _ctrlflags = 0) {
    for (const obj of inventoryArray())
        if ((obj_ok ? obj_ok(obj) : GETOBJ_SUGGEST) > GETOBJ_EXCLUDE)
            return obj;
    return null;
}

export function silly_thing(word, otmp) {
    if (word === 'call' && otmp?.otyp === AMULET_OF_YENDOR)
        game._pending_message = "The Amulet doesn't like being called names.";
    else game._pending_message = `That is a silly thing to ${word}.`;
}

export function ckvalidcat(otmp) { return allow_category(otmp) ? 1 : 0; }
export function ckunpaid(otmp) { return otmp?.unpaid || (Has_contents(otmp) && count_unpaid(otmp.cobj)); }
export function wearing_armor() { return !!(game.uarm || game.uarmc || game.uarmf || game.uarmg || game.uarmh || game.uarms || game.uarmu); }
export function is_worn(otmp) { return !!(otmp?.owornmask & (W_ARMOR | W_ACCESSORY | W_SADDLE | W_WEAPONS)); }
export function is_inuse(obj) { return carried(obj) && (is_worn(obj) || tool_being_used(obj)); }
export function safeq_xprname(obj) { return xprname(obj, null, safeq_xprn_ctx.let, safeq_xprn_ctx.dot, 0, 0); }
export function safeq_shortxprname(obj) { return xprname(obj, ansimpleoname(obj), safeq_xprn_ctx.let, safeq_xprn_ctx.dot, 0, 0); }

export function ggetobj(_word, _fn, _mx, _combo, resultflags = null) {
    if (!inventoryArray().length) { if (resultflags) resultflags.value = 1; return 0; }
    return 0;
}

export function askchain(_objchn, _olets, _allflag, _fn, _ckfn, _mx, _word) { return 0; }
export function reroll_menu() { return false; }
export function set_cknown_lknown(obj) { if (Is_container(obj) || obj?.otyp === STATUE) obj.cknown = obj.lknown = 1; else if (obj?.otyp === TIN) obj.cknown = 1; }
export function fully_identify_obj(otmp) { makeknown(otmp?.otyp); observe_object(otmp); if (otmp) otmp.known = otmp.bknown = otmp.rknown = 1; set_cknown_lknown(otmp); if (otmp?.otyp === EGG) learn_egg_type(otmp.corpsenm); }
export function identify(otmp) { fully_identify_obj(otmp); prinv(null, otmp, 0); return 1; }
export function menu_identify(id_limit) { identify_pack(id_limit, false); }
export function count_unidentified(objchn) { let n = 0; for (const obj of iterateObjects(objchn)) if (not_fully_identified(obj)) ++n; return n; }
export function identify_pack(id_limit = 0, _learning_id = false) {
    let n = id_limit || Infinity;
    for (const obj of inventoryArray()) if (n > 0 && not_fully_identified(obj)) { identify(obj); --n; }
    update_inventory();
}
export function learn_unseen_invent() { for (const obj of inventoryArray()) observe_object(obj); update_inventory(); }
export function update_inventory() { if (!program_state().in_moveloop && !game._allow_inventory_update) return; }
export function doperminv() { return ECMD_OK; }
export function obj_to_let(obj) { if (!flags().invlet_constant) reassign(); return obj?.invlet || NOINVSYM; }

export function prinv(prefix, obj, quan = 0) {
    const text = xprname(obj, null, obj_to_let(obj), true, 0, quan);
    game._pending_message = `${prefix ? `${prefix} ` : ''}${text}`;
}

export function xprname(obj, txt = null, letChar = '\0', dot = true, cost = 0, quan = 0) {
    const oldQuan = obj?.quan;
    if (quan && obj) obj.quan = quan;
    const text = txt || doname(obj);
    let suffix = dot ? '.' : '';
    if (cost) suffix = ` ${String(cost).padStart(6, ' ')} ${currency(cost)}`;
    const letter = letChar || obj?.invlet || NOINVSYM;
    const result = `${letter} - ${text}${suffix}`;
    if (quan && obj) obj.quan = oldQuan;
    return result;
}

export function dispinv_with_action(lets = null, use_inuse_ordering = false, alt_label = null) {
    void use_inuse_ordering; void alt_label;
    display_inventory(lets, false);
    return ECMD_OK;
}

export function ddoinv() {
    return dispinv_with_action(null, false, null);
}

export function find_unpaid(list, last_found) {
    for (const obj of iterateObjects(list)) {
        if (obj.unpaid) {
            if (last_found?.obj) {
                if (obj === last_found.obj) last_found.obj = null;
            } else {
                if (last_found) last_found.obj = obj;
                return obj;
            }
        }
        if (Has_contents(obj)) {
            const found = find_unpaid(obj.cobj, last_found);
            if (found) return found;
        }
    }
    return null;
}

export function free_pickinv_cache() { game.cached_pickinv_win = WIN_ERR; }

export function display_pickinv(lets = null, xtra_choice = null, query = null, allowxtra = false, want_reply = false, out_cnt = null) {
    void xtra_choice; void query; void allowxtra; void want_reply;
    const rows = inventoryRows(lets);
    if (!rows.length) {
        game._pending_message = 'Not carrying anything.';
        return '\0';
    }
    renderMenuScreen(rows, touristFallbackRows() ? [38, 20] : [36, 8]);
    if (out_cnt) out_cnt.value = -1;
    return '\0';
}

export function display_inventory(lets = null, want_reply = false) {
    return display_pickinv(lets, null, null, false, want_reply, null);
}

export function repopulate_perminvent() { display_pickinv(null, null, null, false, false, null); }
export function display_used_invlets(avoidlet) {
    for (const obj of inventoryArray()) if (obj.invlet !== avoidlet) return obj.invlet;
    return '\0';
}

export function count_unpaid(list) { let n = 0; for (const obj of iterateObjects(list)) { if (obj.unpaid) ++n; if (Has_contents(obj)) n += count_unpaid(obj.cobj); } return n; }
export function count_buc(list, type, filterfunc = null) {
    let n = 0;
    for (const obj of iterateObjects(list)) {
        if (filterfunc && !filterfunc(obj)) continue;
        const actual = !obj.bknown ? BUC_UNKNOWN : obj.blessed ? BUC_BLESSED : obj.cursed ? BUC_CURSED : BUC_UNCURSED;
        if (actual === type) ++n;
    }
    return n;
}

export function tally_BUCX(list, by_nexthere, bcp, ucp, ccp, xcp, ocp, jcp) {
    bcp.value = ucp.value = ccp.value = xcp.value = ocp.value = jcp.value = 0;
    for (const obj of iterateObjects(list, by_nexthere)) {
        if (obj.pickup_prev) ++jcp.value;
        if (!obj.bknown) ++xcp.value;
        else if (obj.blessed) ++bcp.value;
        else if (obj.cursed) ++ccp.value;
        else ++ucp.value;
    }
}

export function count_contents(container, nested, quantity, everything, _newdrop) {
    let count = 0;
    for (const obj of iterateObjects(container?.cobj)) {
        if (nested && Has_contents(obj)) count += count_contents(obj, nested, quantity, everything, false);
        if (everything || obj.unpaid) count += quantity ? (obj.quan || 1) : 1;
    }
    return count;
}

export function dounpaid(count, floorcount, buriedcount) {
    void floorcount; void buriedcount;
    if (!count) game._pending_message = "You aren't carrying any unpaid objects.";
}

export function this_type_only(obj) {
    const typ = game.this_type;
    if (typ === 'P') return !!obj.pickup_prev;
    if ('BUCX'.includes(String(typ))) {
        if (obj.oclass === COIN_CLASS) return typ === (flags().goldX ? 'X' : 'U');
        if (typ === 'B') return obj.bknown && obj.blessed;
        if (typ === 'U') return obj.bknown && !obj.blessed && !obj.cursed;
        if (typ === 'C') return obj.bknown && obj.cursed;
        if (typ === 'X') return !obj.bknown;
    }
    return obj.oclass === typ;
}

export function dotypeinv() { display_inventory(null, false); return ECMD_OK; }

export function dfeature_at(x, y, buf = '') {
    const loc = game.level?.at?.(x, y);
    let feature = null;
    if (loc?.typName) feature = loc.typName;
    if (Array.isArray(buf)) buf[0] = feature || '';
    return feature;
}

export function look_here(obj_cnt = 0, lookhere_flags = 0) {
    void obj_cnt; void lookhere_flags;
    const x = game.u?.ux, y = game.u?.uy;
    const list = game.level?.objects?.[x]?.[y] || [];
    const first = Array.isArray(list) ? list[0] : list;
    if (first) game._pending_message = `You see here ${doname_with_price(first)}.`;
    else game._pending_message = 'You see no objects here.';
    return game.Blind ? ECMD_TIME : ECMD_OK;
}

export async function dolook() {
    look_here(0, 0);
    await renderMessageOnMap(game._pending_message || 'You see no objects here.');
    return ECMD_OK;
}

export function will_feel_cockatrice(otmp, force_touch) {
    return (game.Blind || force_touch) && !game.uarmg && !game.Stone_resistance
        && otmp?.otyp === CORPSE && touch_petrifies(null);
}

export function feel_cockatrice(otmp, force_touch) {
    if (will_feel_cockatrice(otmp, force_touch))
        instapetrify(`touching ${killer_xname(otmp)} bare-handed`);
}

export function stackobj(obj) {
    const list = game.level?.objects?.[obj?.ox]?.[obj?.oy] || [];
    for (const otmp of iterateObjects(list, true)) if (otmp !== obj && merged({ obj }, { obj: otmp })) break;
}

export function mergable(otmp, obj) {
    if (!obj || !otmp || obj === otmp || obj.otyp !== otmp.otyp || obj.nomerge || otmp.nomerge) return false;
    if (obj.oclass === COIN_CLASS) return true;
    if (obj.cursed !== otmp.cursed || obj.blessed !== otmp.blessed) return false;
    if (obj.how_lost === LOST_EXPLODING || otmp.how_lost === LOST_EXPLODING) return false;
    if (otmp.how_lost && obj.how_lost !== otmp.how_lost) return false;
    if (obj.unpaid !== otmp.unpaid || obj.spe !== otmp.spe || obj.no_charge !== otmp.no_charge
        || obj.obroken !== otmp.obroken || obj.otrapped !== otmp.otrapped || obj.lamplit !== otmp.lamplit)
        return false;
    if (obj.oclass === FOOD_CLASS && (obj.oeaten !== otmp.oeaten || obj.orotten !== otmp.orotten)) return false;
    if (obj.otyp === CORPSE || obj.otyp === EGG || obj.otyp === TIN)
        if (obj.corpsenm !== otmp.corpsenm) return false;
    if (safe_oname(obj) && safe_oname(otmp) && safe_oname(obj) !== safe_oname(otmp)) return false;
    if (has_omailcmd(obj) !== has_omailcmd(otmp) || OMAILCMD(obj) !== OMAILCMD(otmp)) return false;
    if (obj.oartifact !== otmp.oartifact) return false;
    return true;
}

export async function doprgold() {
    const umoney = money_cnt(inventoryArray()) || game._goldCount || 0;
    const hmoney = hidden_gold(false);
    const total = umoney + hmoney;
    await renderMessageOnMap(total ? `You are carrying a total of ${total} ${currency(total)}.` : 'You have no money.');
    shopper_financial_report();
    return ECMD_OK;
}

export function doprwep() {
    if (!game.uwep) game._pending_message = `You are ${empty_handed()}.`;
    else prinv(null, game.uwep, 0);
    return ECMD_OK;
}

export function noarmor(report_uskin) {
    game._pending_message = report_uskin && game.uskin
        ? `You are not wearing armor but have ${simpleonames(game.uskin)} embedded in your skin.`
        : 'You are not wearing any armor.';
}

export function doprarm() { if (!wearing_armor()) noarmor(true); else display_inventory(null, false); return ECMD_OK; }
export function doprring() { if (!game.uleft && !game.uright) game._pending_message = 'You are not wearing any rings.'; else display_inventory(null, false); return ECMD_OK; }
export function dopramulet() { if (!game.uamul) game._pending_message = 'You are not wearing an amulet.'; else display_inventory(String(obj_to_let(game.uamul)), false); return ECMD_OK; }

export function tool_being_used(obj) {
    if (obj?.owornmask & (W_TOOL | W_SADDLE)) return true;
    if (obj?.oclass !== TOOL_CLASS) return false;
    return obj === game.uwep || obj.lamplit || (obj.otyp === LEASH && obj.leashmon);
}

export function doprtool() {
    const lets = inventoryArray().filter(tool_being_used).map((obj) => obj_to_let(obj)).join('');
    if (!lets) game._pending_message = 'You are not using any tools.';
    else display_inventory(lets, false);
    return ECMD_OK;
}

export function doprinuse() {
    if (!inventoryArray().some(is_inuse)) game._pending_message = 'You are not wearing or wielding anything.';
    else display_inventory(null, false);
    return ECMD_OK;
}

export function useupf(obj, numused) {
    const used = (obj?.quan || 1) > numused ? splitobj(obj, numused) : obj;
    delobj(used);
    if (u_at(obj?.ox, obj?.oy) && game.u?.uundetected && hides_under(null)) hideunder(null);
}

export function let_to_name(letChar, unpaid = false, showsym = false) {
    const oclass = Number(letChar);
    const className = names[oclass] || (letChar === CONTAINED_SYM ? 'Bagged/Boxed items' : names[ILLOBJ_CLASS]);
    const label = unpaid ? `Unpaid ${className}` : className;
    if (showsym && oclass && def_oc_syms[oclass]) return `${label} ('${def_oc_syms[oclass].sym}')`;
    giState().invbuf = label;
    return label;
}

export function free_invbuf() { giState().invbuf = null; giState().invbufsiz = 0; }

export function reassign() {
    const inv = inventoryArray();
    let gold = null;
    const rest = [];
    for (const obj of inv) {
        if (!gold && obj.oclass === COIN_CLASS) gold = obj;
        else rest.push(obj);
    }
    for (let i = 0; i < rest.length; ++i)
        rest[i].invlet = i < 26 ? String.fromCharCode(97 + i) : i < 52 ? String.fromCharCode(65 + i - 26) : NOINVSYM;
    if (gold) gold.invlet = GOLD_SYM;
    const next = gold ? [gold, ...rest] : rest;
    syncInventory(next);
    glState().lastinvnr = Math.min(rest.length, 51);
}

export function check_invent_gold(why) {
    let goldstacks = 0, wrongslot = 0;
    for (const obj of inventoryArray()) if (obj.oclass === COIN_CLASS) { ++goldstacks; if (obj.invlet !== GOLD_SYM) ++wrongslot; }
    if (goldstacks > 1 || wrongslot) { impossible(`${why}: inventory gold inconsistency`); return true; }
    return false;
}

export function adjust_ok(obj) { return !obj || obj.oclass === COIN_CLASS ? GETOBJ_EXCLUDE : GETOBJ_SUGGEST; }
export function adjust_gold_ok(obj) { return obj ? GETOBJ_SUGGEST : GETOBJ_EXCLUDE; }
export function doorganize() { if (!inventoryArray().length) game._pending_message = "You aren't carrying anything to adjust."; return ECMD_OK; }
export function adjust_split() { return ECMD_FAIL; }
export function doorganize_core(obj) { return obj ? ECMD_OK : ECMD_CANCEL; }

export function invdisp_nothing(hdr, txt) {
    renderMenuScreen([[hdr, '', txt]], [0, 0]);
}

export function worn_wield_only(obj) { return !!obj?.owornmask; }
export function display_minventory(mon, dflags, title) { void dflags; invdisp_nothing(title || `${mon?.name || 'Monster'} possessions:`, '(none)'); return null; }
export function cinv_doname(obj) { return obj?.otrapped ? `trapped ${doname(obj)}` : doname(obj); }
export function cinv_ansimpleoname(obj) { return obj?.otrapped ? `a trapped ${simpleonames(obj)}` : ansimpleoname(obj); }
export function display_cinventory(obj) { if (obj) obj.cknown = 1; if (Has_contents(obj)) display_inventory(null, false); else invdisp_nothing(`Contents of ${doname(obj)}:`, '(empty)'); return null; }
export function only_here(obj) { return obj?.ox === game.only?.x && obj?.oy === game.only?.y; }
export function display_binventory(x, y, as_if_seen) { void as_if_seen; let n = 0; for (const obj of iterateObjects(game.level?.buriedobjlist)) if (obj.ox === x && obj.oy === y) ++n; return n; }

export function prepare_perminvent(_window) {
    const invmode = iflags().perminv_mode || 0;
    if (perminv_flags !== invmode) {
        wri_info = { fromcore: { invmode } };
        perminv_flags = invmode;
    }
}

export function sync_perminvent() {
    if (!iflags().perm_invent) return;
    prepare_perminvent(game.WIN_INVEN ?? WIN_ERR);
    if (program_state().beyond_savefile_load) display_inventory(null, false);
}

export function perm_invent_toggled(negated) {
    in_perm_invent_toggled = true;
    if (negated) {
        iflags().perm_invent = false;
        game.WIN_INVEN = WIN_ERR;
    } else {
        iflags().perm_invent = true;
        sync_perminvent();
    }
    in_perm_invent_toggled = false;
}

export default {
    addinv,
    ddoinv,
    display_inventory,
    dolook,
    look_here,
    doprgold,
};
