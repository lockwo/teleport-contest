// doset.js — the interactive 'O' options menu (options.c doset()).
//
// C ref: src/options.c doset() (line ~8758) — "changing options via menu by
// Per Liboriussen".  Builds an NHW_MENU listing every option:
//   * non-modifiable booleans (indented, no accelerator)
//   * modifiable booleans (a..z accelerators, selecting toggles)
//   * compound options ("selecting will prompt for new value")
//   * "Other settings:" (autopickup exceptions, bind keys, &c.)
// then select_menu(PICK_ANY).  On confirm, each picked boolean is toggled
// (parseoptions -> "'NAME' option toggled on.") and each picked compound runs
// its handler (pickup_types pops the object-class "Autopickup what?" menu).
//
// The tty menu is full-screen (offx=0): a leading space at column 0 and the
// item body at column 1.  Selectable items render as "<accel> <-|+> <body>".
// Section titles/headings carry ATR_INVERSE (menu_headings = no-color&inverse).
// The page footer is "(N of M)" (or "(end) " on a single page), with the
// cursor placed one past it.  Pagination is (rows-1) = 23 entries per page.
//
// This module is data-driven from the exact option list NetHack emits for a
// fresh game (defaults plus this run's role/race/gender for the compounds).
// It consumes no PRNG, matching C: opening/navigating the options menu never
// touches the dungeon RNG.

import { game } from './gstate.js';
import { nhgetch } from './input.js';
import { update_topl, topl_more, render_map_to_grid, docrt, rogue_symset } from './display.js';
import { NO_COLOR, ATR_INVERSE, ATR_BOLD, ATR_UNDERLINE } from './terminal.js';
import { OPT_MENU_DRIVER, handler_number_pad,
         handler_autounlock, autounlock_val, handler_autopickup_exception,
         handler_menu_colors, handler_statuslines } from './options.js';
import { count_status_hilites, count_cond } from './botl.js';

// C ref: dat/symbols "Handling:" lines per symset `start:` block — game.symset
// (jsmain.js) stores only the selected symset NAME (no handling struct, unlike
// symbols.c's gs.symset[PRIMARYSET]), so this mirrors the file's per-set
// Handling: value for the "handler=" suffix optfn_symset() prints (get_val,
// options.c:4200-4209).  Names without a Handling: line (plain/Blank/
// AmigaFont) correctly have no entry here -> no handler= suffix, matching C's
// handling==H_UNK(0) skip.
const SYMSET_HANDLING = {
    ibmgraphics: 'IBM', ibmgraphics_1: 'IBM', ibmgraphics_2: 'IBM',
    rogueibm: 'IBM', rogueepyx: 'IBM', roguewindows: 'IBM',
    curses: 'DEC', decgraphics: 'DEC',
    macgraphics: 'MAC',
    enhanced1: 'UTF8', enhanced2: 'UTF8',
};

// C ref: symbols.c:938-1005. The tty build excludes MAC handling and filters
// primary/rogue restrictions before assigning the menu's automatic letters.
const SYMBOL_SETS = [
    { name: 'plain', desc: "same as default symbols, except '+' for corner walls" },
    { name: 'Blank', desc: 'completely blank symbols' },
    { name: 'IBMgraphics', desc: 'special line-drawing characters used for walls' },
    { name: 'IBMGraphics_1' },
    { name: 'IBMGraphics_2' },
    { name: 'RogueIBM', rogue: true },
    { name: 'RogueEpyx', rogue: true, desc: 'rogue level color symbol set like Epyx Rogue' },
    { name: 'RogueWindows', rogue: true },
    { name: 'curses', primary: true, desc: 'approximation of IBMgraphics using DECgraphics' },
    { name: 'DECgraphics', primary: true, desc: 'special line-drawing characters used for walls' },
    { name: 'Enhanced1', primary: true, desc: 'Enhanced with Unicode glyphs and 24-bit color' },
    { name: 'Enhanced2', primary: true, desc: 'Enhanced with more Unicode glyphs and 24-bit color' },
    { name: 'AmigaFont', desc: 'Amiga hack.font line-drawing and effect characters' },
];

async function runSymbolSetHandler(rogue = false) {
    const { select_command_menu, dismiss_invent_screen } = await import('./invent.js');
    const { PICK_ONE } = await import('./const.js');
    const sets = SYMBOL_SETS.filter(set => rogue ? !set.primary : !set.rogue);
    const name = (rogue ? game.roguesymset : game.symset) || '';
    const width = Math.max('Default Symbols'.length, ...sets.map(set => set.name.length)) + 2;
    const entries = [
        { text: `Select ${rogue ? 'rogue level ' : ''}symbol set:`, attr: ATR_INVERSE },
        { text: '' },
        { text: 'Default Symbols', item: { value: '', selected: !name } },
        ...sets.map(set => ({
            text: set.name.padEnd(width) + ' ' + (set.desc || ''),
            item: { value: set.name, selected: set.name.toLowerCase() === name.toLowerCase() },
        })),
    ];
    const committed = await select_command_menu(entries, { how: PICK_ONE, blankStatus: true });
    await dismiss_invent_screen();
    if (!committed) return;
    const picks = entries.filter(entry => entry.item?.selected);
    // PICK_ONE may return both the preselection and a newly selected entry.
    const pick = picks.find(entry => entry.item.value.toLowerCase() !== name.toLowerCase())
        || picks[0];
    if (rogue) game.roguesymset = pick?.item.value ?? name;
    else game.symset = pick?.item.value ?? name;
    await docrt();
}

const COLS = 80;
const ROWS = 24;
const PER_PAGE = ROWS - 1; // process_menu_window: lmax = min(52, rows-1)

// ---------------------------------------------------------------------------
// doset_simple() — the user-friendly '#options' / 'O' menu (options.c
// doset_simple_menu(), line ~8535).  Unlike doset() (#optionsfull), this is a
// PICK_ONE menu titled "Options" that groups options by section
// (General/Behavior/Map/Status; OptS_Advanced is excluded).  Picking a boolean
// toggles it; picking a compound with a handler runs the handler (pickup_types
// pops the "Autopickup what?" object-class menu); after each pick the menu is
// torn down and immediately re-shown with updated values (the do/while loop in
// doset_simple()).  <return>/ESC with no pick returns 0 and exits to the map.
//
// Layout (offx == 0 full-screen menu): leading space at col 0, item body at
// col 1.  Selectable lines render " <accel> - <body>"; the body is
// "<name padded to NAMEW> [<value>]" with optional "  (for autopickup)" suffix
// on pickup_types/pickup_thrown/pickup_stolen/dropped_nopick.  Section headings
// are " %-30s " (32 wide) carrying ATR_INVERSE.  Footer is "(N of M)" / "(end)".
//
// NAMEW = longest_option_name(set_gameview, set_in_game) for this build = 23;
// the fmtstr is "%-23s [%s]" so the value column begins at body offset 24.
const NAMEW = 23;

// The Options-menu option list for a fresh game, in section order, exactly as
// NetHack 5.0 emits for this build (DECgraphics, tty).  Values are read live
// where they change during the recorded run (autopickup booleans, pickup_types).
// `kind`: 'bool' toggles; 'compound' runs a handler (only pickup_types is
// exercised); 'other' compound-like (autopickup exceptions &c.).  `apsuffix`
// adds "  (for autopickup)".  Page 1 (a..p) is the only page the sessions show.
// C ref: options.c allopt[] default values — booleans, keyed by option name.
// TRUE = "X" (on) by default, FALSE = " " (off).  Used by both the display
// (boolStr) and the toggle logic (toggleSimpleBool) so they stay consistent.
const SIMPLE_BOOL_DEFAULT = {
    // off by default
    price_quotes: false, autodig: false, autoquiver: false, pushweapon: false,
    hilite_pet: false, hilite_pile: false, showrace: false, showexp: false,
    time: false, hitpointbar: false,
    // on by default
    autoopen: true, cmdassist: true, dropped_nopick: true, fireassist: true,
    pickup_stolen: true, pickup_thrown: true,
    bgcolors: true, color: true, customcolors: true, customsymbols: true,
    sparkle: true,
    // autopickup (&flags.pickup) is handled specially (defaults Off)
};

// C ref: options.c set_option's opt_need_redraw cases — toggling one of these
// map-display booleans forces flush_screen(1)/docrt() to redraw the level, so a
// stationary pet or object pile picks up (or drops) its highlight immediately.
const REDRAW_ON_TOGGLE = new Set([
    'hilite_pet', 'hilite_pile', 'showrace', 'sparkle',
    'color', 'bgcolors', 'customcolors', 'customsymbols',
]);

// C ref: options.c doset_simple_menu() — the four displayed sections
// (OptS_General..OptS_Status; OptS_Advanced is excluded), each option in
// allopt[] order.  Accelerators are NOT fixed here: process_menu_window /
// tty_end_menu assigns a..z fresh on every page, so a page-2 option starts at
// 'a' again.  See buildSimpleFlat()/paginateSimple().
const SIMPLE_SECTIONS = [
    { name: 'General', items: [
        { name: 'fruit',        kind: 'compound', val: () => fruitStr() },
        { name: 'number_pad',   kind: 'compound', val: () => numberPadStr() },
        { name: 'price_quotes', kind: 'bool',     val: () => boolStr('price_quotes', false) },
    ] },
    { name: 'Behavior', items: [
        { name: 'autodig',               kind: 'bool',     val: () => boolStr('autodig', false) },
        { name: 'autoopen',              kind: 'bool',     val: () => boolStr('autoopen', true) },
        { name: 'autopickup',            kind: 'bool',     val: () => boolStr('autopickup', autopickupOn()) },
        { name: 'autopickup exceptions', kind: 'other',    val: () => currentlySet((game.apelist || []).length) },
        { name: 'autoquiver',            kind: 'bool',     val: () => boolStr('autoquiver', false) },
        { name: 'autounlock',            kind: 'compound', val: autounlock_val },
        { name: 'cmdassist',             kind: 'bool',     val: () => boolStr('cmdassist', true) },
        { name: 'dropped_nopick',        kind: 'bool',     val: () => boolStr('dropped_nopick', true), apsuffix: true },
        { name: 'fireassist',            kind: 'bool',     val: () => boolStr('fireassist', true) },
        { name: 'pickup_stolen',         kind: 'bool',     val: () => boolStr('pickup_stolen', true), apsuffix: true },
        { name: 'pickup_thrown',         kind: 'bool',     val: () => boolStr('pickup_thrown', true), apsuffix: true },
        { name: 'pickup_types',          kind: 'compound', val: () => pickupTypesStr(), apsuffix: true },
        { name: 'pushweapon',            kind: 'bool',     val: () => boolStr('pushweapon', false) },
    ] },
    { name: 'Map', items: [
        { name: 'bgcolors',      kind: 'bool',     val: () => boolStr('bgcolors', true) },
        { name: 'color',         kind: 'bool',     val: () => boolStr('color', true) },
        { name: 'customcolors',  kind: 'bool',     val: () => boolStr('customcolors', true) },
        { name: 'customsymbols', kind: 'bool',     val: () => boolStr('customsymbols', true) },
        { name: 'hilite_pet',    kind: 'bool',     val: () => boolStr('hilite_pet', false) },
        { name: 'hilite_pile',   kind: 'bool',     val: () => boolStr('hilite_pile', false) },
        { name: 'showrace',      kind: 'bool',     val: () => boolStr('showrace', false) },
        { name: 'sparkle',       kind: 'bool',     val: () => boolStr('sparkle', true) },
        { name: 'symset',        kind: 'compound', val: () => symsetStr() },
    ] },
    { name: 'Status', items: [
        { name: 'hitpointbar',             kind: 'bool',     val: () => boolStr('hitpointbar', false) },
        { name: 'menu colors',             kind: 'other',    val: () => `(${(game.menucolors || []).length} currently set)` },
        { name: 'showexp',                 kind: 'bool',     val: () => boolStr('showexp', false) },
        { name: 'status condition fields', kind: 'other',    val: () => `(${count_cond()} currently set)` },
        { name: 'status highlight rules',  kind: 'other',    val: () => `(${count_status_hilites()} currently set)` },
        { name: 'statuslines',             kind: 'compound', val: () => ((game.iflags?.wc2_statuslines | 0) < 3 ? '2' : '3') },
        { name: 'time',                    kind: 'bool',     val: () => boolStr('time', false) },
    ] },
];

// C ref: optlist.h allopt[].descr, shown by options.c:8635-8638.
const SIMPLE_DESCRIPTIONS = {
    fruit: 'name of a fruit you enjoy eating',
    number_pad: 'use the number pad for movement',
    price_quotes: 'display prices you have seen for unidentified objects',
    autodig: 'dig if moving and wielding a digging tool',
    autoopen: 'walking into a door attempts to open it',
    autopickup: 'automatically pick up objects',
    'autopickup exceptions': 'edit autopickup exceptions',
    autoquiver: 'fill empty quiver automatically when firing',
    autounlock: 'action to take when encountering locked door or chest',
    cmdassist: 'give help for errors on direction input',
    dropped_nopick: "don't autopickup dropped items",
    fireassist: 'fire-command tries to be helpful',
    pickup_stolen: 'autopickup stolen items',
    pickup_thrown: 'autopickup thrown items',
    pickup_types: 'types of objects to pick up automatically',
    pushweapon: 'previous weapon goes to secondary slot',
    bgcolors: 'use background color for some map hilighting',
    color: 'use color in map',
    customcolors: 'use custom colors in map',
    customsymbols: 'use custom utf8 symbols in map',
    hilite_pet: 'use highlight for pets',
    hilite_pile: 'highlight piles of items',
    showrace: 'show your character by race rather than role',
    sparkle: 'display sparkly effect when resisting magic',
    symset: 'load a set of display symbols from symbols file',
    hitpointbar: 'show colored bar for hit points',
    'menu colors': 'change colors used in menus',
    showexp: 'show experience points in status line',
    'status condition fields': 'change status condition highlighting',
    'status highlight rules': 'change status line highlighting',
    statuslines: '2 or 3 lines for status display',
    time: 'display game turns in status line',
};

// The storage key a boolean option's value actually lives under, when it
// isn't just game.flags[name].  C ref: options.c set_bool_via_field() &c —
// the same handful of names js/options.js's set_boolean() (options.js:1421)
// redirects to a different field for.  Shared by doset_simple's boolStr
// below and doset()'s full-menu live values so both menus read the one
// place an rc line or a prior toggle actually wrote.
function rawBoolValue(name) {
    game.flags = game.flags || {};
    switch (name) {
    case 'autopickup': return game.flags.pickup;
    case 'fixinv':     return game.flags.invlet_constant;
    case 'cmdassist':  return game.iflags?.cmdassist;
    case 'altmeta':    return game.iflags?.altmeta;
    default:           return game.flags[name];
    }
}

// Boolean display value: "X" when on, " " when off.  Tracks any toggles made
// during this menu session via game.flags.
function boolStr(name, dflt) {
    let v = rawBoolValue(name);
    if (v === undefined) v = dflt;
    return v ? 'X' : ' ';
}

// C ref: options.c optfn_symset()/optfn_roguesymset() get_val.
function symsetStr(rogue = false) {
    const name = (rogue ? game.roguesymset : game.symset) || '';
    let s = name || 'default';
    if (name) {
        if (rogue === rogue_symset()) s += ', active';
        const h = SYMSET_HANDLING[name.toLowerCase()];
        if (!rogue && h) s += `, handler=${h}`;
    }
    return s;
}

// C ref: options.c optfn_fruit() get_val — the live svp.pl_fruit, which
// initoptions()/fruitadd() seeds from the rc's `fruit:` value (jsmain.js) and
// runFruitHandler() replaces when the player retypes it.
function fruitStr() {
    return game.svp?.pl_fruit || 'slime mold';
}

// C ref: options.c optfn_number_pad() get_val — numpadmodes[] indexed off
// gc.Cmd.num_pad / phone_layout / pcHack_compat / swap_yz, which optfn's
// do_set half derives from iflags.num_pad + iflags.num_pad_mode (bit 0 =
// MSDOS/PC-Hack compatibility, bit 1 = phone layout; with num_pad off, a
// nonzero mode means the German y/z swap).
function numberPadStr() {
    const ifl = game.iflags || {};
    const mode = ifl.num_pad_mode | 0;
    if (ifl.num_pad)
        return (mode & 2) ? ((mode & 1) ? '4=on, phone layout, MSDOS compatible'
                                        : '3=on, phone-style layout')
                          : ((mode & 1) ? '2=on, MSDOS compatible' : '1=on');
    return mode ? '-1=off, y & z swapped' : '0=off';
}

function autopickupOn() {
    game.flags = game.flags || {};
    // C ref: optlist.h NHOPTB(autopickup, ..., Off, ...) — the autopickup
    // boolean (&flags.pickup) defaults to Off.  Movement/pickup already treats
    // an unset game.flags.pickup as falsy; match that in the menu display too.
    return game.flags.pickup === undefined ? false : !!game.flags.pickup;
}

// The pickup_types value string: "all" when unrestricted, else the selected
// class symbols in canonical class order (e.g. '$"?+!=/').
function pickupTypesStr() {
    game.flags = game.flags || {};
    const s = game.flags.pickup_types;
    return (s && s.length) ? s : 'all';
}

const OPT_MENU_ENTRIES = [
    {"t":"x","text":" Set what options?","inv":true},
    {"t":"x","text":""},
    {"t":"x","text":"     For a brief explanation of how this works, type '?' to select"},
    {"t":"x","text":"     the next menu choice, then press <enter> or <return>."},
    {"t":"a","a":"?","body":"view help for options menu","kind":"help"},
    {"t":"x","text":"     [To suppress this menu help, toggle off the 'cmdassist' option.]"},
    {"t":"x","text":""},
    {"t":"x","text":" Booleans (selecting will toggle value):","inv":true},
    {"t":"x","text":"     blind                   [false]","name":"blind"},
    {"t":"x","text":"     bones                   [true]","name":"bones"},
    {"t":"x","text":"     deaf                    [false]","name":"deaf"},
    {"t":"x","text":"     legacy                  [true]","name":"legacy"},
    {"t":"x","text":"     news                    [false]","name":"news"},
    {"t":"x","text":"     nudist                  [false]","name":"nudist"},
    {"t":"x","text":"     pauper                  [false]","name":"pauper"},
    {"t":"x","text":"     reroll                  [false]","name":"reroll"},
    {"t":"x","text":"     selectsaved             [true]","name":"selectsaved"},
    {"t":"x","text":"     status_updates          [true]","name":"status_updates"},
    {"t":"x","text":"     tutorial                [true]","name":"tutorial"},
    {"t":"x","text":"     use_darkgray            [true]","name":"use_darkgray"},
    {"t":"x","text":"     use_truecolor           [false]","name":"use_truecolor"},
    {"t":"x","text":"     voices                  [excluded from build]"},
    {"t":"a","a":"a","body":"accessiblemsg           [false]","name":"accessiblemsg","kind":"bool"},
    {"t":"a","a":"a","body":"acoustics               [true]","name":"acoustics","kind":"bool"},
    {"t":"a","a":"b","body":"altmeta                 [false]","name":"altmeta","kind":"bool"},
    {"t":"a","a":"c","body":"armorstatus             [false]","name":"armorstatus","kind":"bool"},
    {"t":"a","a":"d","body":"autodescribe            [true]","name":"autodescribe","kind":"bool"},
    {"t":"a","a":"e","body":"autodig                 [false]","name":"autodig","kind":"bool"},
    {"t":"a","a":"f","body":"autoopen                [true]","name":"autoopen","kind":"bool"},
    {"t":"a","a":"g","body":"autopickup              [false]","name":"autopickup","kind":"bool"},
    {"t":"a","a":"h","body":"autoquiver              [false]","name":"autoquiver","kind":"bool"},
    {"t":"a","a":"i","body":"bgcolors                [on]","name":"bgcolors","kind":"bool"},
    {"t":"a","a":"j","body":"checkpoint              [true]","name":"checkpoint","kind":"bool"},
    {"t":"a","a":"k","body":"cmdassist               [true]","name":"cmdassist","kind":"bool"},
    {"t":"a","a":"l","body":"color                   [true]","name":"color","kind":"bool"},
    {"t":"a","a":"m","body":"confirm                 [true]","name":"confirm","kind":"bool"},
    {"t":"a","a":"n","body":"customcolors            [true]","name":"customcolors","kind":"bool"},
    {"t":"a","a":"o","body":"customsymbols           [true]","name":"customsymbols","kind":"bool"},
    {"t":"a","a":"p","body":"dark_room               [true]","name":"dark_room","kind":"bool"},
    {"t":"a","a":"q","body":"dropped_nopick          [true]","name":"dropped_nopick","kind":"bool"},
    {"t":"a","a":"r","body":"eight_bit_tty           [false]","name":"eight_bit_tty","kind":"bool"},
    {"t":"a","a":"s","body":"extmenu                 [false]","name":"extmenu","kind":"bool"},
    {"t":"a","a":"t","body":"fireassist              [true]","name":"fireassist","kind":"bool"},
    {"t":"a","a":"u","body":"fixinv                  [true]","name":"fixinv","kind":"bool"},
    {"t":"a","a":"v","body":"force_invmenu           [false]","name":"force_invmenu","kind":"bool"},
    {"t":"a","a":"w","body":"goldX                   [false]","name":"goldX","kind":"bool"},
    {"t":"a","a":"a","body":"help                    [true]","name":"help","kind":"bool"},
    {"t":"a","a":"b","body":"herecmd_menu            [false]","name":"herecmd_menu","kind":"bool"},
    {"t":"a","a":"c","body":"hilite_pet              [false]","name":"hilite_pet","kind":"bool"},
    {"t":"a","a":"d","body":"hilite_pile             [false]","name":"hilite_pile","kind":"bool"},
    {"t":"a","a":"e","body":"hitpointbar             [false]","name":"hitpointbar","kind":"bool"},
    {"t":"a","a":"f","body":"idlecheckpoint          [off]","name":"idlecheckpoint","kind":"bool"},
    {"t":"a","a":"g","body":"ignintr                 [false]","name":"ignintr","kind":"bool"},
    {"t":"a","a":"h","body":"implicit_uncursed       [true]","name":"implicit_uncursed","kind":"bool"},
    {"t":"a","a":"i","body":"lit_corridor            [false]","name":"lit_corridor","kind":"bool"},
    {"t":"a","a":"j","body":"lootabc                 [false]","name":"lootabc","kind":"bool"},
    {"t":"a","a":"k","body":"mail                    [true]","name":"mail","kind":"bool"},
    {"t":"a","a":"l","body":"mention_decor           [false]","name":"mention_decor","kind":"bool"},
    {"t":"a","a":"m","body":"mention_map             [false]","name":"mention_map","kind":"bool"},
    {"t":"a","a":"n","body":"mention_walls           [false]","name":"mention_walls","kind":"bool"},
    {"t":"a","a":"o","body":"menu_overlay            [true]","name":"menu_overlay","kind":"bool"},
    {"t":"a","a":"p","body":"menucolors              [false]","name":"menucolors","kind":"bool"},
    {"t":"a","a":"q","body":"mon_movement            [false]","name":"mon_movement","kind":"bool"},
    {"t":"a","a":"r","body":"null                    [true]","name":"null","kind":"bool"},
    {"t":"a","a":"s","body":"pickup_stolen           [true]","name":"pickup_stolen","kind":"bool"},
    {"t":"a","a":"t","body":"pickup_thrown           [true]","name":"pickup_thrown","kind":"bool"},
    {"t":"a","a":"u","body":"price_quotes            [false]","name":"price_quotes","kind":"bool"},
    {"t":"a","a":"v","body":"pushweapon              [false]","name":"pushweapon","kind":"bool"},
    {"t":"a","a":"w","body":"query_menu              [false]","name":"query_menu","kind":"bool"},
    {"t":"a","a":"a","body":"quick_farsight          [false]","name":"quick_farsight","kind":"bool"},
    {"t":"a","a":"b","body":"rest_on_space           [false]","name":"rest_on_space","kind":"bool"},
    {"t":"a","a":"c","body":"safe_pet                [true]","name":"safe_pet","kind":"bool"},
    {"t":"a","a":"d","body":"safe_wait               [true]","name":"safe_wait","kind":"bool"},
    {"t":"a","a":"e","body":"showdamage              [false]","name":"showdamage","kind":"bool"},
    {"t":"a","a":"f","body":"showexp                 [false]","name":"showexp","kind":"bool"},
    {"t":"a","a":"g","body":"showrace                [false]","name":"showrace","kind":"bool"},
    {"t":"a","a":"h","body":"showvers                [false]","name":"showvers","kind":"bool"},
    {"t":"a","a":"i","body":"silent                  [true]","name":"silent","kind":"bool"},
    {"t":"a","a":"j","body":"sortpack                [true]","name":"sortpack","kind":"bool"},
    {"t":"a","a":"k","body":"sounds                  [off]","name":"sounds","kind":"bool"},
    {"t":"a","a":"l","body":"sparkle                 [true]","name":"sparkle","kind":"bool"},
    {"t":"a","a":"m","body":"spot_monsters           [false]","name":"spot_monsters","kind":"bool"},
    {"t":"a","a":"n","body":"standout                [false]","name":"standout","kind":"bool"},
    {"t":"a","a":"o","body":"terrainstatus           [false]","name":"terrainstatus","kind":"bool"},
    {"t":"a","a":"p","body":"time                    [false]","name":"time","kind":"bool"},
    {"t":"a","a":"q","body":"tips                    [true]","name":"tips","kind":"bool"},
    {"t":"a","a":"r","body":"tombstone               [true]","name":"tombstone","kind":"bool"},
    {"t":"a","a":"s","body":"toptenwin               [false]","name":"toptenwin","kind":"bool"},
    {"t":"a","a":"t","body":"travel                  [true]","name":"travel","kind":"bool"},
    {"t":"a","a":"u","body":"use_inverse             [true]","name":"use_inverse","kind":"bool"},
    {"t":"a","a":"v","body":"verbose                 [true]","name":"verbose","kind":"bool"},
    {"t":"a","a":"w","body":"weaponstatus            [false]","name":"weaponstatus","kind":"bool"},
    {"t":"a","a":"a","body":"whatis_menu             [false]","name":"whatis_menu","kind":"bool"},
    {"t":"a","a":"b","body":"whatis_moveskip         [false]","name":"whatis_moveskip","kind":"bool"},
    {"t":"x","text":""},
    {"t":"x","text":" Compounds (selecting will prompt for new value):","inv":true},
    {"t":"x","text":"     windowtype              [tty]"},
    {"t":"x","text":"     playmode                [normal]","name":"playmode"},
    {"t":"x","text":"     name                    [Septor]","name":"name"},
    {"t":"x","text":"     role                    [Rogue]","name":"role"},
    {"t":"x","text":"     race                    [orc]","name":"race"},
    {"t":"x","text":"     gender                  [male]","name":"gender"},
    {"t":"x","text":"     alignment               [chaotic]","name":"alignment"},
    {"t":"x","text":"     catname                 [(none)]","name":"catname"},
    {"t":"x","text":"     dogname                 [(none)]","name":"dogname"},
    {"t":"x","text":"     horsename               [(none)]","name":"horsename"},
    {"t":"x","text":"     msghistory              [20]","name":"msghistory"},
    {"t":"x","text":"     pettype                 [random]","name":"pettype"},
    {"t":"x","text":"     soundlib                [nosound]"},
    {"t":"a","a":"c","body":"autounlock              [apply-key]","name":"autounlock","kind":"compound"},
    {"t":"a","a":"d","body":"boulder                 [`]","name":"boulder","kind":"compound"},
    {"t":"a","a":"e","body":"crash_email             [unknown]","name":"crash_email","kind":"compound"},
    {"t":"a","a":"f","body":"crash_name              [unknown]","name":"crash_name","kind":"compound"},
    {"t":"a","a":"g","body":"crash_urlmax            [-1]","name":"crash_urlmax","kind":"compound"},
    {"t":"a","a":"h","body":"disclose                [ni na nv ng nc no]","name":"disclose","kind":"compound"},
    {"t":"a","a":"a","body":"fruit                   [slime mold]","name":"fruit","kind":"compound"},
    {"t":"a","a":"b","body":"glyph                   [(to be done)]","name":"glyph","kind":"compound"},
    {"t":"a","a":"c","body":"hilite_status           [(none)]","name":"hilite_status","kind":"compound"},
    {"t":"a","a":"d","body":"menu_headings           [no-color&inverse]","name":"menu_headings","kind":"compound"},
    {"t":"a","a":"e","body":"menu_objsyms            [conditional]","name":"menu_objsyms","kind":"compound"},
    {"t":"a","a":"f","body":"menuinvertmode          [1]","name":"menuinvertmode","kind":"compound"},
    {"t":"a","a":"g","body":"menustyle               [full]","name":"menustyle","kind":"compound"},
    {"t":"a","a":"h","body":"msg_window              [single]","name":"msg_window","kind":"compound"},
    {"t":"a","a":"i","body":"number_pad              [0=off]","name":"number_pad","kind":"compound"},
    {"t":"a","a":"j","body":"packorder               [$\")[%?+!=/(*`0_]","name":"packorder","kind":"compound"},
    {"t":"a","a":"k","body":"paranoid_confirmation   [pray trap swim]","name":"paranoid_confirmation","kind":"compound"},
    {"t":"a","a":"l","body":"petattr                 [inverse]","name":"petattr","kind":"compound"},
    {"t":"a","a":"m","body":"pickup_burden           [stressed]","name":"pickup_burden","kind":"compound"},
    {"t":"a","a":"n","body":"pickup_types            [all]","name":"pickup_types","kind":"compound"},
    {"t":"a","a":"o","body":"pile_limit              [5]","name":"pile_limit","kind":"compound"},
    {"t":"a","a":"p","body":"roguesymset             [default]","name":"roguesymset","kind":"compound"},
    {"t":"a","a":"q","body":"runmode                 [run]","name":"runmode","kind":"compound"},
    {"t":"a","a":"r","body":"scores                  [3 top/2 around]","name":"scores","kind":"compound"},
    {"t":"a","a":"s","body":"sortdiscoveries         [by order of discovery within each class]","name":"sortdiscoveries","kind":"compound"},
    {"t":"a","a":"t","body":"sortloot                [loot]","name":"sortloot","kind":"compound"},
    {"t":"a","a":"u","body":"sortvanquished          [t: traditional: by monster level]","name":"sortvanquished","kind":"compound"},
    {"t":"a","a":"v","body":"statushilites           [0 (off: don't highlight status fields)]","name":"statushilites","kind":"compound"},
    {"t":"a","a":"w","body":"statuslines             [2]","name":"statuslines","kind":"compound"},
    {"t":"a","a":"a","body":"suppress_alert          [(none)]","name":"suppress_alert","kind":"compound"},
    {"t":"a","a":"b","body":"symset                  [DECgraphics, active, handler=DEC]","name":"symset","kind":"compound"},
    {"t":"a","a":"c","body":"versinfo                [1: number (5.0.0)]","name":"versinfo","kind":"compound"},
    {"t":"a","a":"d","body":"whatis_coord            [none]","name":"whatis_coord","kind":"compound"},
    {"t":"a","a":"e","body":"whatis_filter           [none]","name":"whatis_filter","kind":"compound"},
    {"t":"x","text":""},
    {"t":"x","text":" Other settings:","inv":true},
    {"t":"a","a":"f","body":"autocompletions         [(0 currently set)]","name":"autocompletions","kind":"other"},
    {"t":"a","a":"g","body":"autopickup exceptions   [(0 currently set)]","name":"autopickup exceptions","kind":"other"},
    {"t":"a","a":"h","body":"bind keys               [(0 currently set)]","name":"bind keys","kind":"other"},
    {"t":"a","a":"i","body":"menu colors             [(0 currently set)]","name":"menu colors","kind":"other"},
    {"t":"a","a":"j","body":"message types           [(0 currently set)]","name":"message types","kind":"other"},
    {"t":"a","a":"k","body":"status condition fields [(16 currently set)]","name":"status condition fields","kind":"other"},
    {"t":"a","a":"l","body":"status highlight rules  [(0 currently set)]","name":"status highlight rules","kind":"other"},
];

// C ref: options.c doset() — allopt[] rows whose setwhere is set_wizonly or
// set_wiznofuz are skipped entirely in a normal game (`endpass = wizard ?
// set_wiznofuz : set_in_game`, plus the two explicit `continue`s), so in
// wizard/debug mode ten extra modifiable booleans join the list in allopt[]'s
// alphabetical order.  Second field = the option this one sorts in front of
// (null = after the last boolean, i.e. just before the "Compounds" heading).
const WIZ_ONLY_BOOLS = [
    ['debug_hunger', 'dropped_nopick'],
    ['debug_mongen', 'dropped_nopick'],
    ['debug_overwrite_stairs', 'dropped_nopick'],
    ['menu_tab_sep', 'menucolors'],
    ['monpolycontrol', 'null'],
    ['montelecontrol', 'null'],
    ['sanity_check', 'showdamage'],
    ['travel_debug', 'use_inverse'],
    ['wizmgender', null],
    ['wizweight', null],
];

// doset()'s fmtstr_doset is "%s%-*s [%s]" with the width from
// longest_option_name(), 23 for this build ("status condition fields").
function fmtOptBody(name, value) { return name.padEnd(NAMEW, ' ') + ` [${value}]`; }

function flagStr(name, dflt) {
    const v = game.flags?.[name];
    return (v === undefined || v === null || v === '') ? dflt : String(v);
}

// C ref: options.c the per-option `get_val` arms.  Each entry answers what the
// menu's "[...]" shows for one compound/other option in THIS game; anything not
// listed keeps the value baked into OPT_MENU_ENTRIES (which is already the
// build default).
const OPT_VALUE = {
    // optfn_playmode(): wizard -> "debug", discover -> "explore", else "normal"
    playmode: () => (game.flags?.debug ? 'debug'
                     : game.flags?.explore ? 'explore' : 'normal'),
    name: () => game.plname || '',
    role: () => game.urole?.name?.m || '',
    race: () => game.urace?.noun || '',
    gender: () => (game.flags?.female ? 'female' : 'male'),
    alignment: () => ({ 1: 'lawful', 0: 'neutral', '-1': 'chaotic' })[game.u?.ualign?.type] || 'neutral',
    catname: () => flagStr('catname', '(none)'),
    dogname: () => flagStr('dogname', '(none)'),
    horsename: () => flagStr('horsename', '(none)'),
    // optfn_msghistory(): "%u" of iflags.msg_history (default 20).
    msghistory: () => String(game.iflags?.msg_history ?? 20),
    // optfn_pettype(): gp.preferred_pet 'c'/'d'/'h'/'n', else "random".
    pettype: () => ({ c: 'cat', d: 'dog', h: 'horse', n: 'none' })[game.preferred_pet] || 'random',
    fruit: () => fruitStr(),
    number_pad: () => numberPadStr(),
    autounlock: autounlock_val,
    symset: () => symsetStr(),
    roguesymset: () => symsetStr(true),
    // optfn_suppress_alert(): "(none)" when flags.suppress_alert is 0.
    suppress_alert: () => flagStr('suppress_alert', '(none)'),
    pickup_types: () => pickupTypesStr(),
    // optfn_msg_window(): iflags.prevmsg_window s/c/f, anything else reversed.
    msg_window: () => ({ s: 'single', c: 'combination', f: 'full' }
        [lowFirst(game.iflags?.prevmsg_window, 's')] || 'reversed'),
    // optfn_menustyle(): menutype[flags.menu_style][0]; 'n' means traditional.
    menustyle: () => ({ n: 'traditional', t: 'traditional', c: 'combination',
                        f: 'full', p: 'partial' }[lowFirst(game.flags?.menustyle, 'f')] || 'full'),
    // optfn_runmode(): runmodes[flags.runmode].
    runmode: () => flagStr('runmode', 'run'),
    // optfn_pickup_burden(): burdentype[flags.pickup_burden].
    pickup_burden: () => pickupBurdenStr(),
    // optfn_sortloot(): sortltype[] entry whose first letter matches.
    sortloot: () => ({ n: 'none', l: 'loot', f: 'full' }[lowFirst(game.flags?.sortloot, 'l')] || 'loot'),
    // optfn_statushilites() get_val.
    statushilites: () => {
        const d = game.iflags?.hilite_delta | 0;
        return d ? `${d} (on: highlight status for ${d} turns)`
                 : "0 (off: don't highlight status fields)";
    },
    statuslines: () => ((game.iflags?.wc2_statuslines | 0) < 3 ? '2' : '3'),
    pile_limit: () => String(game.flags?.pile_limit ?? 5),
    menuinvertmode: () => String(game.iflags?.menuinvertmode ?? 1),
    // optfn_whatis_coord()/optfn_whatis_filter() get_val.
    whatis_coord: () => ({ m: 'map', c: 'compass', f: 'full compass', s: 'screen' }
        [game.iflags?.getpos_coords] || 'none'),
    whatis_filter: () => ({ v: 'view', a: 'area' }[game.iflags?.getloc_filter] || 'none'),
    // optfn_disclose() get_val: each flags.end_disclose[] setting followed by
    // its disclosure_options[] letter, space separated.
    disclose: () => {
        const letters = 'iavgco';
        const end = game.flags?.end_disclose || letters.split('').map(() => 'n');
        return letters.split('').map((c, i) => `${end[i] || 'n'}${c}`).join(' ');
    },
    // optfn_packorder() get_val: oc_to_str(flags.inv_order).
    packorder: () => (game.flags?.inv_order || DEF_INV_ORDER_OC)
        .map((oc) => OC_SYMS[oc] || '').join(''),
    // optfn_boulder() get_val: the override symbol, else the ROCK class symbol.
    boulder: () => flagStr('boulder', '`'),
    // The "Other settings:" rows all read "(N currently set)".
    autocompletions: () => currentlySet((game.autocomplete || []).length),
    'autopickup exceptions': () => currentlySet((game.apelist || []).length),
    'bind keys': () => currentlySet(Object.keys(game.keybind || {}).length),
    'menu colors': () => currentlySet((game.menucolors || []).length),
    'message types': () => currentlySet((game.msgtypes || []).length),
    'status condition fields': () => currentlySet(count_cond()),
    'status highlight rules': () => currentlySet(count_status_hilites()),
};

function currentlySet(n) { return `(${n} currently set)`; }
function lowFirst(v, dflt) {
    const s = (v === undefined || v === null || v === '') ? dflt : String(v);
    return s[0].toLowerCase();
}
// C ref: options.c burdentype[] indexed by flags.pickup_burden; the rc parser
// keeps the typed word, so map either form.
const BURDENTYPE = ['unencumbered', 'burdened', 'stressed', 'strained',
                    'overtaxed', 'overloaded'];
function pickupBurdenStr() {
    const v = game.flags?.pickup_burden;
    if (typeof v === 'number') return BURDENTYPE[v] || 'stressed';
    if (!v) return 'stressed';
    const idx = { u: 0, b: 1, s: 2, n: 3, o: 4, t: 4, l: 5 }[String(v)[0].toLowerCase()];
    return BURDENTYPE[idx ?? 2];
}
// C ref: options.c def_inv_order[] + drawing.c def_oc_syms[].sym.
const DEF_INV_ORDER_OC = [12, 5, 2, 3, 7, 9, 10, 8, 4, 11, 6, 13, 14, 15, 16];
const OC_SYMS = ['\0', ']', ')', '[', '=', '"', '(', '%', '!', '?',
                 '+', '/', '$', '*', '`', '0', '_', '.'];

// Build doset()'s live entry list: the baked skeleton plus wizard-only
// booleans, with every bracketed value refreshed from this game's state and
// fresh per-page a..z/A..Z accelerators (tty_end_menu() assigns them at
// display time, so inserting entries renumbers everything after them).
function buildFullEntries() {
    const list = OPT_MENU_ENTRIES.map((e) => ({ ...e }));
    if (game.flags?.debug) {
        const compoundsAt = () =>
            list.findIndex((e) => e.t === 'x' && e.inv && /^ Compounds/.test(e.text));
        for (const [name, before] of WIZ_ONLY_BOOLS) {
            const idx = before ? list.findIndex((e) => e.name === before)
                               : compoundsAt() - 1;
            if (idx >= 0) list.splice(idx, 0, { t: 'a', name, kind: 'bool',
                                                body: fmtOptBody(name, 'false') });
        }
    }
    for (const e of list) {
        const live = e.name && OPT_VALUE[e.name];
        if (!live) continue;
        const body = fmtOptBody(e.name, live());
        if (e.t === 'a') e.body = body;
        else e.text = '     ' + body;
    }
    // C ref: options.c doset() — with iflags.menu_tab_sep, fmtstr_doset is
    // "%s%s\t[%s]" (no name padding) and the non-selectable Booleans lose their
    // 4-space indent.  The raw tab is dropped by the capture but still advances
    // the cursor one column, so render a single space (see the simple menu).
    if (game.iflags?.menu_tab_sep) {
        let inBooleans = false;
        for (const e of list) {
            if (e.t === 'x' && e.inv) inBooleans = /^ Booleans/.test(e.text);
            const src = e.t === 'a' ? e.body : e.text;
            const m = e.t === 'a' || (e.t === 'x' && !e.inv)
                ? /^ *(\S+) +(\[.*)$/.exec(src || '') : null;
            if (!m) continue;
            const body = `${m[1]} ${m[2]}`;
            if (e.t === 'a') e.body = body;
            else e.text = (inBooleans ? ' ' : '     ') + body;
        }
    }
    // tty_end_menu(): menu_ch resets to 'a' on every page and only advances
    // for selectable items that have no explicit selector (the '?' help row).
    let menu_ch = 'a';
    for (let i = 0; i < list.length; i++) {
        if (i % PER_PAGE === 0) menu_ch = 'a';
        const e = list[i];
        if (e.t !== 'a' || e.kind === 'help') continue;
        e.a = menu_ch;
        menu_ch = nextMenuCh(menu_ch);
    }
    return list;
}

// "Autopickup what?" object-class menu (options.c oc_to_str()/wildcard menu used
// by the pickup_types handler).  Each item: accelerator, class symbol, label.
// Both the accelerator letter and the class symbol toggle the item.
const PICKUP_CLASSES = [
    {a:'a', sym:'$', label:'pile of coins'},
    {a:'b', sym:'"', label:'amulet'},
    {a:'c', sym:')', label:'weapon'},
    {a:'d', sym:'[', label:'suit or piece of armor'},
    {a:'e', sym:'%', label:'piece of food'},
    {a:'f', sym:'?', label:'scroll'},
    {a:'g', sym:'+', label:'spellbook'},
    {a:'h', sym:'!', label:'potion'},
    {a:'i', sym:'=', label:'ring'},
    {a:'j', sym:'/', label:'wand'},
    {a:'k', sym:'(', label:'useful item (pick-axe, key, lamp...)'},
    {a:'l', sym:'*', label:'gem or rock'},
    {a:'m', sym:'`', label:'boulder or statue'},
    {a:'n', sym:'0', label:'iron ball'},
    {a:'o', sym:'_', label:'iron chain'},
];
const WIZARD_PICKUP_CLASSES = [...PICKUP_CLASSES,
    {a:'p', sym:'.', label:'splash of venom'}];
// C ref: options.c:3358-3359 adds VENOM_SYM only for wizard mode.
function pickupClasses() {
    return game.flags?.debug ? WIZARD_PICKUP_CLASSES : PICKUP_CLASSES;
}

// OPT_MENU_ENTRIES's bracketed value for every plain-boolean line (both the
// non-modifiable "Booleans" list and the a..z-accelerated ones) is a snapshot
// baked from ONE authoring game (name Septor, role Rogue, race orc, legacy
// and tutorial both explicitly on) — see the module comment.  A boolean whose
// value that authoring run happened to share with a true optlist.h default is
// still right for any other run today; one it set non-default (legacy,
// tutorial — and anything a different session's own rc/menu touches) is not.
// Recompute the bracket from this run's actual game.flags/iflags (falling
// back to the baked word when this run never touched the option), reusing
// rawBoolValue so both this and doset_simple's boolStr read the identical
// storage location per name.  Only rewrites a trailing "[true]"/"[false]"/
// "[on]"/"[off]" — anything else (e.g. voices' "[excluded from build]") is
// left verbatim.
function liveOptValue(name, bakedText) {
    const m = bakedText.match(/\[(true|false|on|off)\]\s*$/);
    if (!m) return { text: bakedText, on: null };
    const onWord = (m[1] === 'true' || m[1] === 'false') ? 'true' : 'on';
    const offWord = (m[1] === 'true' || m[1] === 'false') ? 'false' : 'off';
    const bakedOn = (m[1] === onWord);
    let v = name ? rawBoolValue(name) : undefined;
    if (v === undefined) v = bakedOn;
    const word = v ? onWord : offWord;
    const text = bakedText.slice(0, m.index) + `[${word}]` + bakedText.slice(m.index + m[0].length);
    return { text, on: !!v };
}

function disp() { return game.nhDisplay; }

// Clear a row from `from` to end of line.
function clearRow(d, from, row) {
    for (let c = from; c < COLS; c++) d.setCell(c, row, ' ', NO_COLOR, 0);
}

// Render a single full-screen options-menu page (offx == 0).
// `entries` is the flat menu list; `page` is the 0-based page index;
// `npages` the page count; `selected` is a Set of entry indices.
function renderOptionsPage(entries, page, npages, selected) {
    const d = disp();
    if (!d) return { row: 0 };
    d.clearScreen();
    const start = page * PER_PAGE;
    const end = Math.min(start + PER_PAGE, entries.length);
    let r = 0;
    for (let i = start; i < end; i++, r++) {
        clearRow(d, 0, r);
        const e = entries[i];
        if (e.t === 'x') {
            // Verbatim line; headings/title carry ATR_INVERSE on the text only
            // (the leading space stays plain — C draws the inversion over the
            // option text via menu_headings = no-color&inverse).
            const text = e.name ? liveOptValue(e.name, e.text).text : e.text;
            if (text) {
                const lead = text.match(/^ */)[0].length;
                d.putstr(0, r, text.slice(0, lead), NO_COLOR, 0);
                d.putstr(lead, r, text.slice(lead), NO_COLOR, e.inv ? ATR_INVERSE : 0);
            }
        } else {
            // Selectable: " <accel> <-|+> <body>" at col 0 (leading space + text
            // at col 1).  '?' help item is never selectable-marked here.
            const mark = selected.has(i) ? '+' : '-';
            const body = e.kind === 'bool' ? liveOptValue(e.name, e.body).text : e.body;
            d.putstr(0, r, ` ${e.a} ${mark} ${body}`, NO_COLOR, 0);
        }
    }
    // Page footer (morestr): "(N of M)" with no trailing space when paged,
    // "(end) " (trailing space) on a single page.  Cursor is placed one past
    // the full footer string.  C ref: process_menu_window().
    clearRow(d, 0, r);
    const morestr = npages > 1 ? `(${page + 1} of ${npages})` : '(end) ';
    d.putstr(1, r, morestr, NO_COLOR, 0);
    d.setCursor(1 + morestr.length, r);
    return { row: r };
}

// Build the "Autopickup what?" object-class menu line list, in tty display
// order (prompt, blank, class rows, blank, "All classes", note, toggle-hint).
// C ref: windows.c choose_classes_menu() — the trailing hint line depends on
// flags.pickup ("Toggle off ... to not pick up anything." when autopickup is
// on, else "Toggle on ... to automatically pick these things up.").
function buildPickupLines(selected, preselected) {
    const lines = [];
    lines.push({ text: 'Autopickup what?', inv: true });
    lines.push({ text: '' });
    for (const cls of pickupClasses()) {
        const mark = selected.has(cls.a) ? (preselected.has(cls.a) ? '*' : '+') : '-';
        lines.push({ text: `${cls.a} ${mark} ${cls.sym}  ${cls.label}` });
    }
    lines.push({ text: '' });
    lines.push({ text: `A ${selected.has('A') ? '+' : '-'}    All classes of objects` });
    lines.push({ text: 'Note: when no choices are selected, "all" is implied.' });
    lines.push({ text: autopickupOn()
        ? "Toggle off 'autopickup' to not pick up anything."
        : "Toggle on 'autopickup' to automatically pick these things up." });
    return lines;
}

// C ref: wintty.c tty_end_menu() + tty_display_nhwindow() — a menu window's
// overlay column is  offx = max(10, COLNO - maxcol - 1)  where maxcol is the
// widest item (strlen+2, "extra space at beg & end") or the "(end) " morestr.
// offx == 10, a full-height menu (maxrow >= rows), or !menu_overlay all force
// full-screen (offx 0).  The pickup menu's width — and thus its column — grows
// when the longer "Toggle on ..." hint is shown (autopickup off), shifting the
// overlay left from col 25 (offx 24) to col 17 (offx 16).
function pickupMenuOffx(lines) {
    let maxcol = '(end) '.length;
    for (const l of lines) { const len = l.text.length + 2; if (len > maxcol) maxcol = len; }
    let offx = Math.max(10, 80 - maxcol - 1);
    if (offx < 0) offx = 0;
    if (offx === 10 || (lines.length + 1) >= 24) offx = 0;
    return offx;
}

// Render the centered "Autopickup what?" object-class menu (offx > 0 overlay).
function renderPickupMenu(selected, preselected, searchBlankTop, blankStatus) {
    const d = disp();
    if (!d) return;
    const lines = buildPickupLines(selected, preselected);
    const offx = pickupMenuOffx(lines);
    const morestr = '(end) ';
    // Parent dismissal restores the map. A preceding pline/More can have
    // republished status, which the child menu then leaves intact.
    if (blankStatus) d.clearScreen();
    else for (let r = 0; r < 22; r++) clearRow(d, 0, r);
    render_map_to_grid();
    if (blankStatus) {
        for (let c = 0; c < COLS; c++) {
            d.setCell(c, 22, ' ', NO_COLOR, 0);
            d.setCell(c, 23, ' ', NO_COLOR, 0);
        }
    }
    for (let r = 0; r < lines.length; r++) {
        clearRow(d, offx, r);
        const l = lines[r];
        if (l.text) d.putstr(offx + 1, r, l.text, NO_COLOR, l.inv ? ATR_INVERSE : 0);
    }
    if (searchBlankTop) clearRow(d, 0, 0);
    const footRow = lines.length;
    clearRow(d, offx, footRow);
    d.putstr(offx + 1, footRow, morestr, NO_COLOR, 0);
    d.setCursor(offx + 1 + morestr.length, footRow);
}

// PICK_ANY object-class menu for pickup_types.  Returns the set of selected
// class symbols (or 'all' when none / 'A' chosen), or null on ESC cancel.
async function pickupTypesMenu(blankStatus) {
    // offx is computed per-render from the menu width (see pickupMenuOffx).
    // C ref: windows.c:1696-1704 — preserve the current pickup class choices.
    const selected = new Set(pickupClasses()
        .filter(cls => (game.flags?.pickup_types || '').includes(cls.sym))
        .map(cls => cls.a));
    const preselected = new Set(selected);
    let searchBlankTop = false;
    const byAccel = new Map(pickupClasses().map(c => [c.a, c]));
    const menuClasses = [...pickupClasses(),
        { a: 'A', sym: ' ', label: 'All classes of objects' }];
    const bySym = new Map(pickupClasses().map(c => [c.sym, c]));
    for (;;) {
        renderPickupMenu(selected, preselected, searchBlankTop, blankStatus);
        game._modal_screen = 'optmenu';
        const c = await nhgetch();
        delete game._modal_screen;
        const ch = String.fromCharCode(c);
        if (c === 27) return null;                 // ESC: cancel
        if (c === 13 || c === 10 || ch === ' ') break; // confirm
        if (ch === ':') {
            // C ref: wintty.c process_menu_window(), MENU_SEARCH.
            const { hooked_tty_getlin, pmatchi } = await import('./extcmd-handlers.js');
            const reply = await hooked_tty_getlin('Search for:', null);
            searchBlankTop = true;
            if (!reply || reply[0] === '\x1b') continue;
            for (const cls of menuClasses) {
                if (!pmatchi(`*${reply}*`, `${cls.a} - ${cls.sym}  ${cls.label}`)) continue;
                if (selected.has(cls.a)) selected.delete(cls.a);
                else selected.add(cls.a);
                preselected.delete(cls.a);
            }
            continue;
        }
        if (ch === 'A') {
            if (selected.has('A')) selected.delete('A');
            else selected.add('A');
            continue;
        }
        const cls = byAccel.get(ch) || bySym.get(ch);
        if (cls) {
            if (selected.has(cls.a)) selected.delete(cls.a);
            else selected.add(cls.a);
            preselected.delete(cls.a);
            continue;
        }
        // C ref: wintty.c:1650-1698; windows.c:1562,1715 — bulk changes
        // obey the All classes entry's SKIPINVERT flag.
        if ([',', '.', '\\', '-', '~', '@'].includes(ch)) {
            for (const cls of menuClasses) {
                const wasSelected = selected.has(cls.a);
                const mode = game.iflags?.menuinvertmode ?? 1;
                if (cls.a === 'A' && (mode === 2 || (mode === 1 && !wasSelected)))
                    continue;
                const nowSelected = ch === ',' || ch === '.' ? true
                    : ch === '\\' || ch === '-' ? false : !wasSelected;
                if (wasSelected === nowSelected) continue;
                if (nowSelected) selected.add(cls.a);
                else selected.delete(cls.a);
                preselected.delete(cls.a);
            }
        }
    }
    if (selected.has('A') || selected.size === 0) return 'all';
    return new Set(selected);
}

// Run the "Autopickup what?" menu and commit the result into
// game.flags.pickup_types as the canonical class-symbol string ('' = all).
// C ref: optfn_pickup_types() do_handler path.
async function runPickupTypesHandler(blankStatus = true) {
    const result = await pickupTypesMenu(blankStatus);
    game.flags = game.flags || {};
    if (result === null) return;          // ESC: leave value unchanged
    if (result === 'all') {
        game.flags.pickup_types = '';
    } else {
        const syms = pickupClasses().filter(c => result.has(c.a)).map(c => c.sym).join('');
        game.flags.pickup_types = syms;
    }
}

// Run the fruit compound option: a `compound`-without-handler entry, so
// doset_simple_menu() prompts "Set %s to what?" via getlin() and passes the
// answer back through parseoptions ("fruit:mango").  C ref: options.c
// doset_simple_menu() lines 8663-8683.
//
// Before the top-line getlin prompt is drawn, the full-screen "Options" menu is
// torn down and the map is restored (tty repaints the glyph/map window); the
// status line is NOT repainted here (bot() is not called), so it stays blank
// until the menu fully exits.  We reproduce that: clear the menu, redraw just
// the map rows from the current glyph buffer (no dungeon RNG, no state change),
// blank the status rows, then run getlin() over the top line.
async function runFruitHandler() {
    const d = disp();
    if (d?.setCell) {
        d.clearScreen();
        render_map_to_grid();
        // The getlin-over-menu redraw restores the map only; the status window
        // is left blank (see step-237 capture: rows 22-23 are empty).
        for (let c = 0; c < COLS; c++) {
            d.setCell(c, 22, ' ', NO_COLOR, 0);
            d.setCell(c, 23, ' ', NO_COLOR, 0);
        }
    }
    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    const ans = await hooked_tty_getlin('Set fruit to what?', null);
    if (ans !== '\x1b') {
        // parseoptions("fruit:<name>") -> optfn_fruit() do_set: mungspaces,
        // sanitize_name, store in svp.pl_fruit (empty -> "slime mold"), then
        // fruitadd() registers the named fruit.  doset_simple() runs with
        // give_opt_msg FALSE, so C prints no "Fruit is now ..." line here.
        const { set_pl_fruit } = await import('./options.js');
        set_pl_fruit(ans);
    }
}

// C ref: options.c do_handler runs after tty dismisses the parent menu.
export async function runOptionsHandler(handler) {
    const { select_command_menu, dismiss_invent_screen } = await import('./invent.js');
    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    if (game._toplin === 1 || game._yn_need_more) await topl_more();
    game._pending_message = '';
    game._toplin = 0;
    game._yn_need_more = false;
    // The simple/full options menus have already returned their selection.
    game._modal_screen = 'optmenu';
    await dismiss_invent_screen();
    const savedSelect = OPT_MENU_DRIVER.select;
    const savedGetlin = OPT_MENU_DRIVER.getlin;
    const savedError = OPT_MENU_DRIVER.error;
    let blankStatus = true;
    OPT_MENU_DRIVER.select = async (win, how) => {
        // tty_display_nhwindow acknowledges a pending pline before a menu.
        if (game._toplin === 1 || game._yn_need_more) {
            await topl_more();
            game._toplin = 0;
            game._pending_message = '';
            game._yn_need_more = false;
            blankStatus = false;
        }
        const entries = [
            ...(win.query ? [{ text: win.query, attr: ATR_INVERSE }, { text: '' }] : []),
            ...win.items.map((it) => ({
                text: it.str,
                attr: it.heading ? ATR_INVERSE
                    : it.attr === 1 ? ATR_BOLD : it.attr === 4 ? ATR_UNDERLINE
                        : it.attr === 7 ? ATR_INVERSE : undefined,
                bodyStyle: it.selectable ? (() => {
                    const coloring = game.flags?.menucolors
                        ? game.menucolors?.find((rule) => rule.regex.test(it.str)) : null;
                    const attr = coloring?.attr ?? it.attr;
                    const color = coloring?.color ?? it.clr ?? NO_COLOR;
                    return {
                        color: color === 7 ? NO_COLOR : color,
                        attr: attr === 1 ? ATR_BOLD : attr === 4 ? ATR_UNDERLINE
                            : attr === 7 ? ATR_INVERSE : 0,
                    };
                })() : undefined,
                item: it.selectable && Object.values(it.any).some(Boolean) ? {
                    value: it.any,
                    sel: it.accel || undefined,
                    gsel: it.gacc || undefined,
                    selected: !!(it.itemflags & 1),
                    count: -1,
                } : undefined,
            })),
        ];
        // docrt() erases the full-screen parent's status window; bot()
        // does not repaint it while options.c remains in its handler.
        const committed = await select_command_menu(entries, { how, blankStatus });
        const picks = committed
            ? entries.filter((e) => e.item?.selected).map((e) => e.item.value)
            : null;
        await dismiss_invent_screen();
        return picks;
    };
    OPT_MENU_DRIVER.getlin = (prompt) => {
        if (blankStatus) {
            for (let x = 0; x < COLS; x++) {
                disp().setCell(x, 22, ' ', NO_COLOR, 0);
                disp().setCell(x, 23, ' ', NO_COLOR, 0);
            }
        }
        return hooked_tty_getlin(prompt, null);
    };
    OPT_MENU_DRIVER.error = async (message) => {
        const punct = '.!?'.includes(message.at(-1)) ? '' : '.';
        await update_topl(message + punct);
        await topl_more();
        blankStatus = false; // pline() republished the status window.
    };
    try {
        return await handler();
    } finally {
        OPT_MENU_DRIVER.select = savedSelect;
        OPT_MENU_DRIVER.getlin = savedGetlin;
        OPT_MENU_DRIVER.error = savedError;
    }
}

// --- doset_simple() "Options" menu rendering ---------------------------------

// Build the flat menu-item list exactly as C assembles it: doset_simple_menu()
// adds the help entry then, per section, a blank + inverse heading + the option
// lines; tty_end_menu() then reverses and prepends a blank and the "Options"
// title.  So the final order is: title, blank, help, then for each section
// (blank, heading, items...).  Each entry:
//   { type:'title'|'blank'|'heading'|'item', ... }
// selectable items carry {selectable:true, kind, name, item, body}; the help
// entry is selectable with an explicit '?' selector.  Bodies are recomputed on
// each build so toggled booleans / pickup_types show current values.
function buildSimpleFlat() {
    const items = [];
    const showHelp = !!game._simple_options_help;
    if (showHelp)
        items.push({ type: 'text', body: "Use command '#optionsfull' to get the complete options list." });
    // help '?': explicit selector (never auto-lettered).
    items.push({ type: 'item', selectable: true, sel: '?', explicit: true,
                 kind: 'help', body: showHelp ? 'hide help' : 'show help' });
    for (const sec of SIMPLE_SECTIONS) {
        items.push({ type: 'blank' });
        items.push({ type: 'heading', name: sec.name });
        for (const it of sec.items) {
            // C ref: options.c doset_simple_menu() -- fmtstr is "%-Ns [%s]"
            // normally but literally "%s\t[%s]" (no padding) when
            // iflags.menu_tab_sep is set.  Verified against a real recorder
            // build (patches/006-nomux-capture.patch's nomux_putch(): "if
            // (... ch < 32) return;" -- a raw tab byte is < 32, so it is
            // silently dropped by the shadow-buffer writer while wintty's
            // own per-char loop still advances curx by one; the net visible
            // effect on the 80x24 capture is exactly ONE blank column, never
            // a real tab stop jump) -- so render one literal space here,
            // not '\t', to match the captured screen byte-for-byte.
            const rogueSymbols = it.name === 'symset' && rogue_symset();
            const optName = rogueSymbols ? 'roguesymset' : it.name;
            const value = rogueSymbols ? symsetStr(true) : it.val();
            let body = game.iflags?.menu_tab_sep
                ? `${optName} [${value}]`
                : optName.padEnd(NAMEW, ' ') + ' [' + value + ']';
            if (it.apsuffix) body += '  (for autopickup)';
            items.push({ type: 'item', selectable: true, kind: it.kind,
                         name: it.name, item: it, body });
            if (showHelp && SIMPLE_DESCRIPTIONS[it.name]) {
                items.push({ type: 'text', body: '    ' + SIMPLE_DESCRIPTIONS[it.name] });
                items.push({ type: 'blank' });
            }
        }
    }
    // tty_end_menu(): prepend a blank, then the title (added in that order so
    // the reversed-then-prepended list starts with the title).
    items.unshift({ type: 'blank' });
    items.unshift({ type: 'title', name: 'Options' });
    return items;
}

// process_menu_window's accelerator for the next auto-lettered item: 'a'..'z'
// then 'A'..'Z'.  C ref: tty_end_menu() menu_ch advance.
function nextMenuCh(ch) {
    if (ch === 'z') return 'A';
    return String.fromCharCode(ch.charCodeAt(0) + 1);
}

// Split the flat item list into tty pages and assign fresh a..z accelerators
// per page to auto-lettered (non-explicit) selectable items.  C ref:
// tty_end_menu(): lmax = min(52, rows-1); npages = (nitems + lmax-1)/lmax;
// menu_ch resets to 'a' at each page boundary and only advances for selectable
// items whose selector isn't already set (so the explicit '?' is skipped).
function paginateSimple(items) {
    const lmax = ROWS - 1; // min(52, 24-1) = 23
    const pages = [];
    let menu_ch = 'a';
    for (let n = 0; n < items.length; n++) {
        const pageIdx = Math.floor(n / lmax);
        if (n % lmax === 0) { menu_ch = 'a'; pages[pageIdx] = { items: [] }; }
        const it = items[n];
        if (it.selectable && !it.explicit) {
            it.sel = menu_ch;
            menu_ch = nextMenuCh(menu_ch);
        }
        pages[pageIdx].items.push(it);
    }
    return pages;
}

// Render one full-screen (offx == 0) "Options" page.  PICK_ONE draws no
// selection markers, so option lines are " <accel> - <body>".  The footer is
// "(N of M)" (or "(end) " for a single page), drawn at col 1 with a plain
// leading space at col 0, and the cursor placed one past it.  C ref:
// process_menu_window() line drawing + dmore() morestr placement.
function renderSimpleMenuPage(page, pageIdx, npages) {
    const d = disp();
    if (!d) return;
    d.clearScreen();
    let r = 0;
    for (const it of page.items) {
        clearRow(d, 0, r);
        if (it.type === 'title') {
            // "Options" title: no leading space, inverse, at col 1.
            d.putstr(0, r, ' ', NO_COLOR, 0);
            d.putstr(1, r, it.name, NO_COLOR, ATR_INVERSE);
        } else if (it.type === 'heading') {
            // Section heading: C only paints " <name>" inverse (ESC[7m General
            // ESC[24C ESC[0m — the 24-column pad to the 32-wide field is a
            // cursor-forward past cells the earlier clearRow() already left
            // default, never a rewrite), not the whole 32-wide padded field.
            // col 0 is the plain menu leading space.
            const head = ' ' + it.name;
            d.putstr(0, r, ' ', NO_COLOR, 0);
            d.putstr(1, r, head, NO_COLOR, ATR_INVERSE);
        } else if (it.type === 'item') {
            d.putstr(0, r, ` ${it.sel} - ${it.body}`, NO_COLOR, 0);
        } else if (it.type === 'text') {
            d.putstr(0, r, ' ' + it.body, NO_COLOR, 0);
        }
        // 'blank' rows need no drawing (already cleared).
        r++;
    }
    // Footer at row = number of item lines on this page.
    clearRow(d, 0, r);
    const morestr = npages > 1 ? `(${pageIdx + 1} of ${npages})` : '(end) ';
    d.putstr(0, r, ' ' + morestr, NO_COLOR, 0);
    d.setCursor(1 + morestr.length, r);
}

// C ref: options.c doset_simple()/doset_simple_menu() — the 'O' command.
// PICK_ONE loop: build+show the "Options" menu, act on one pick (toggle bool /
// run compound handler), then tear it down and re-build+re-show with updated
// values until the player exits with <return>/ESC or space past the last page
// (no pick).  Each select_menu round starts on page 1; the player pages with
// space/'>' (forward) and '<' (back); a letter picks that page's option and
// ends the round.  Consumes no dungeon RNG.
export async function dosetSimple() {
    for (;;) { // doset_simple_menu() loop — one select_menu round per iteration
        // tty_display_nhwindow() clears WIN_MESSAGE when raising the parent
        // menu, including any error a compound option just acknowledged.
        game._pending_message = '';
        game._toplin = 0;
        game._yn_need_more = false;
        const items = buildSimpleFlat();
        const pages = paginateSimple(items);
        const npages = pages.length;
        let page = 0;
        let pick = null;
        let cancelled = false;
        let count = 0;
        let blankTop = false;

        // select_menu(PICK_ONE): show the current page and read one response.
        for (;;) {
            renderSimpleMenuPage(pages[page], page, npages);
            if (blankTop) clearRow(disp(), 0, 0);
            game._modal_screen = 'optmenu';
            const c = await nhgetch();
            delete game._modal_screen;
            const ch = String.fromCharCode(c);
            // C ref: wintty.c:1563-1615 — ESC cancels a numeric menu count
            // before it can cancel the menu.  Invalid input is swallowed by
            // xwaitforspace(), so it leaves that count pending.
            if (ch >= '0' && ch <= '9') {
                count = count * 10 + (c - 48);
                continue;
            }
            if (c === 27 && count) { count = 0; continue; }
            const hit = pages[page].items.find(it => it.selectable && it.sel === ch);
            if (!hit && !' \r\n\x1b^|><.-@,\\~:'.includes(ch)) continue;
            count = 0;

            if (c === 27) { cancelled = true; break; }    // ESC: cancel
            if (c === 13 || c === 10) break;              // <return>: finish, no pick
            if (ch === ' ') {                             // space: next page, else finish
                if (page < npages - 1) { page++; blankTop = false; continue; }
                break;
            }
            if (ch === '>') { if (page < npages - 1) { page++; blankTop = false; } continue; }
            if (ch === '<') { if (page > 0) { page--; blankTop = false; } continue; }
            // C ref: wintty.c:1700-1730 — PICK_ONE searches every menu page
            // and immediately selects the first matching entry.
            if (ch === ':') {
                const { hooked_tty_getlin, pmatchi } = await import('./extcmd-handlers.js');
                const reply = await hooked_tty_getlin('Search for:', null);
                blankTop = true;
                if (!reply || reply[0] === '\x1b') continue;
                pick = items.find(it => it.selectable
                    && pmatchi(`*${reply}*`, `${it.sel} - ${it.body}`));
                if (pick) break;
                continue;
            }
            // A letter selects that page's option (PICK_ONE ends the round).
            if (hit) { pick = hit; break; }
            // unknown accelerator: ignore (tty rings the bell)
        }

        if (cancelled) return 0;
        if (!pick) return 0;                              // no pick: exit menu

        if (pick.kind === 'help') {
            game._simple_options_help = !game._simple_options_help;
            continue;
        }
        const it = pick.item;
        if (it.kind === 'bool') {
            // PICK_ONE boolean: parseoptions toggles it.  The simple menu emits
            // no top-line "toggled" message (give_opt_msg is FALSE) — the menu
            // simply re-renders with the new value.
            toggleSimpleBool(it.name);
            // C ref: options.c doset_simple() — after each pick, if the toggled
            // option set go.opt_need_redraw (hilite_pet & other map-display
            // options), flush_screen(1) redraws the map.  Recompute the cell
            // glyph state now so the post-menu map reflects e.g. hilite_pet on a
            // stationary pet (newsym alone only refreshes cells that change).
            if (REDRAW_ON_TOGGLE.has(it.name)) await docrt();
        } else if (it.name === 'pickup_types') {
            await runPickupTypesHandler();
        } else if (it.name === 'fruit') {
            await runFruitHandler();
        } else if (it.name === 'number_pad') {
            await runOptionsHandler(handler_number_pad);
        } else if (it.name === 'autounlock') {
            await runOptionsHandler(() => handler_autounlock('autounlock', false));
        } else if (it.name === 'autopickup exceptions') {
            await runOptionsHandler(handler_autopickup_exception);
        } else if (it.name === 'menu colors') {
            await runOptionsHandler(handler_menu_colors);
        } else if (it.name === 'status highlight rules') {
            const { status_hilite_menu } = await import('./botl.js');
            await runOptionsHandler(status_hilite_menu);
        } else if (it.name === 'status condition fields') {
            const { cond_menu } = await import('./botl.js');
            await runOptionsHandler(cond_menu);
        } else if (it.name === 'symset') {
            await runOptionsHandler(() => runSymbolSetHandler(rogue_symset()));
        } else if (it.name === 'statuslines') {
            if (await runOptionsHandler(handler_statuslines)) await docrt();
        }
        // Rebuild the parent menu with the updated option values.
    }
}

// Toggle a boolean tracked in game.flags for the simple menu, using the shared
// SIMPLE_BOOL_DEFAULT table so display (boolStr) and toggle agree.
function toggleSimpleBool(name) {
    game.flags = game.flags || {};
    if (name === 'autopickup') {
        // C ref: optlist.h autopickup defaults Off; toggling an unset value on.
        const cur = game.flags.pickup === undefined ? false : !!game.flags.pickup;
        game.flags.pickup = !cur;
        return;
    }
    if (name === 'cmdassist') {
        game.iflags = game.iflags || {};
        const cur = game.iflags.cmdassist === undefined
            ? SIMPLE_BOOL_DEFAULT.cmdassist : !!game.iflags.cmdassist;
        game.iflags.cmdassist = !cur;
        return;
    }
    const dflt = SIMPLE_BOOL_DEFAULT[name] ?? false;
    const cur = game.flags[name] === undefined ? dflt : !!game.flags[name];
    game.flags[name] = !cur;
    if (name === 'color')
        (game.iflags = game.iflags || {}).use_color = !cur;
}

// C ref: options.c doset() — the 'O' command.  Runs the full options menu,
// applies the picks, and reports toggled booleans / runs compound handlers.
export async function doset() {
    const entries = buildFullEntries();
    const npages = Math.ceil(entries.length / PER_PAGE);
    const selected = new Set(); // entry indices

    // Map of accelerator char -> entry index for the *current* page only.
    let page = 0;
    let cancelled = false;
    // tty_getlin("Search for:") ends with clear_nhwindow(WIN_MESSAGE), wiping the
    // menu's own title row; only a page change repaints it.
    let blankTop = false;
    let count = 0, counting = false;
    for (;;) {
        renderOptionsPage(entries, page, npages, selected);
        if (blankTop) for (let x = 0; x < COLS; x++) disp().setCell(x, 0, ' ', NO_COLOR, 0);
        game._modal_screen = 'optmenu';
        const c = await nhgetch();
        delete game._modal_screen;
        const ch = String.fromCharCode(c);
        // C ref: process_menu_window() count prefix: digits accumulate and ESC
        // while counting only abandons the count; any other key consumes it.
        if (ch >= '0' && ch <= '9') { count = count * 10 + (c - 48); if (count) counting = true; continue; }
        if (c === 27 && counting) { count = 0; counting = false; continue; }
        // xwaitforspace(resp) bells on anything outside the page selectors and
        // menu commands without returning, so a pending count survives it.
        if (!entries.slice(page * PER_PAGE, (page + 1) * PER_PAGE).some(e => e.t === 'a' && e.a === ch)
            && !' \r\n\x1b^|><.-@,\\~:'.includes(ch)) continue;
        const useCount = counting, useN = count;
        counting = false; count = 0;
        if (c === 27) { cancelled = true; break; }    // ESC: cancel whole menu
        if (c === 13 || c === 10) break;               // confirm
        // C ref: wintty.c process_menu_window() case ' '/MENU_NEXT_PAGE —
        // both advance a page, but only ' ' finishes the menu once there is
        // no next page ("' ' finishes menus here, but stop '>' doing the
        // same"), so '>' on the last page is a no-op.
        if (ch === ' ' || ch === '>') {
            if (page < npages - 1) { page++; blankTop = false; continue; }
            if (ch === ' ') break;
            continue;
        }
        if (ch === '<') { if (page > 0) { page--; blankTop = false; } continue; }
        if (ch === '^') { page = 0; blankTop = false; continue; }
        if (ch === '|') { page = npages - 1; blankTop = false; continue; }
        // C ref: wintty.c process_menu_window() MENU_SELECT_PAGE ',',
        // MENU_UNSELECT_PAGE '\\', MENU_INVERT_PAGE '~', MENU_SELECT_ALL '.',
        // MENU_UNSELECT_ALL '-', MENU_INVERT_ALL '@'.  Every options.c entry is
        // MENU_ITEMFLAGS_SKIPINVERT and menuinvertmode defaults to 1
        // (windows.c menuitem_invert_test): bulk select never turns an entry On,
        // while invert/deselect may only turn a selected entry Off.
        if (',\\~.-@'.includes(ch)) {
            if (ch === ',' || ch === '.') continue;
            const pageOnly = ch === '\\' || ch === '~';
            const from = pageOnly ? page * PER_PAGE : 0;
            const to = pageOnly ? Math.min(from + PER_PAGE, entries.length) : entries.length;
            for (let i = from; i < to; i++) selected.delete(i);
            continue;
        }
        // C ref: process_menu_window() MENU_SEARCH — getlin "Search for:", then
        // toggle every selectable entry whose "<sel> - <text>" matches "*pat*".
        if (ch === ':') {
            const { hooked_tty_getlin, pmatchi } = await import('./extcmd-handlers.js');
            const reply = await hooked_tty_getlin('Search for:', null);
            blankTop = true;
            if (!reply || reply[0] === '\x1b') continue;
            // (searches every page, not just the displayed one)
            for (let i = 0; i < entries.length; i++) {
                const e = entries[i];
                if (e.t !== 'a' || e.kind === 'help') continue;
                const body = e.kind === 'bool' ? liveOptValue(e.name, e.body).text : e.body;
                if (!pmatchi(`*${reply}*`, `${e.a} - ${body}`)) continue;
                if (selected.has(i)) selected.delete(i); else selected.add(i);
            }
            continue;
        }
        // Toggle the entry on this page whose accelerator matches.
        const start = page * PER_PAGE;
        const end = Math.min(start + PER_PAGE, entries.length);
        for (let i = start; i < end; i++) {
            const e = entries[i];
            if (e.t === 'a' && e.a === ch && e.kind !== 'help') {
                if (useCount ? useN > 0 : !selected.has(i)) selected.add(i);
                else selected.delete(i);
                break;
            }
        }
    }

    if (cancelled) return 0;

    // Apply picks in menu order (select_menu returns picks in menu order).
    const picks = [...selected].sort((a, b) => a - b).map(i => entries[i]);
    for (const e of picks) {
        if (e.kind === 'bool') {
            // parseoptions toggles the boolean; the displayed value is the
            // pre-toggle one, so a [false]/[off] option turns "on".  Read
            // that pre-toggle value LIVE (liveOptValue), not off the entry's
            // static baked body — the body can be stale for any run whose
            // rc/menu already set this option away from the snapshot's value.
            const wasOff = !liveOptValue(e.name, e.body).on;
            applyBooleanToggle(e.name, wasOff);
            await update_topl(`'${e.name}' option toggled ${wasOff ? 'on' : 'off'}.`);
        } else if (e.name === 'pickup_types') {
            // The pickup_types handler pops the "Autopickup what?" menu.  C ref:
            // any pending top-line message ("'time' option toggled on.") is
            // acknowledged with --More-- before the new menu replaces it.
            const blankStatus = !game._toplin;
            if (game._toplin) {
                await topl_more();
                game._toplin = 0;
                game._pending_message = '';
            }
            await runPickupTypesHandler(blankStatus);
        } else if (e.name === 'number_pad') {
            await runOptionsHandler(handler_number_pad);
        } else if (e.name === 'autounlock') {
            await runOptionsHandler(() => handler_autounlock('autounlock', true));
        } else if (e.name === 'autopickup exceptions') {
            await runOptionsHandler(handler_autopickup_exception);
        } else if (e.name === 'menu colors') {
            await runOptionsHandler(handler_menu_colors);
        } else if (e.name === 'status highlight rules' || e.name === 'hilite_status') {
            const { status_hilite_menu } = await import('./botl.js');
            await runOptionsHandler(status_hilite_menu);
        } else if (e.name === 'status condition fields') {
            const { cond_menu } = await import('./botl.js');
            await runOptionsHandler(cond_menu);
        } else if (e.name === 'symset' || e.name === 'roguesymset') {
            await runOptionsHandler(() => runSymbolSetHandler(e.name === 'roguesymset'));
        } else if (e.name === 'statuslines') {
            if (await runOptionsHandler(handler_statuslines)) await docrt();
        }
        // Other compound/other selections aren't exercised by the recorded
        // sessions; left unhandled (no prompt) on purpose.
    }
    if (picks.some((e) => e.kind === 'bool' && e.name === 'color'))
        await docrt();
    return 0;
}

// Mirror the gameplay-affecting side of the toggled booleans we model.  Most
// boolean options are pure display/UI; the ones that change the recorded
// screens are showexp/time (status line) and autopickup (auto-lift on move).
function applyBooleanToggle(name, turnOn) {
    game.flags = game.flags || {};
    switch (name) {
    case 'autopickup': game.flags.pickup = turnOn; break;
    // C ref: js/options.js:1421 set_boolean() — the same two names that
    // land under a different field than game.flags[name] when set from an
    // rc line; the interactive menu must write the same place.
    case 'fixinv': game.flags.invlet_constant = turnOn; break;
    case 'altmeta': (game.iflags = game.iflags || {}).altmeta = turnOn; break;
    case 'cmdassist':  (game.iflags = game.iflags || {}).cmdassist = turnOn; break;
    case 'color':
        game.flags.color = turnOn;
        (game.iflags = game.iflags || {}).use_color = turnOn;
        break;
    case 'showexp':
    case 'showvers':
    case 'time':
        game.flags[name] = turnOn;
        game.botl = true;
        break;
    case 'verbose':    game.flags.verbose = turnOn; break;
    default:
        game.flags[name] = turnOn;
        break;
    }
}
