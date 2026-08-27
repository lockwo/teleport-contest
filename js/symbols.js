// symbols.js — port of src/symbols.c (NetHack 5.0), plus the sym.h /
// include/defsym.h / drawing.c data tables that file reads.
//
// STATUS: INERT.  Nothing in the tree imports this module yet.  It is a
// straight translation so a later measured pass can wire the symbol-set
// machinery up one call site at a time; changing WHEN these run reorders the
// shared RNG draw stream and forfeits every screen after that point.
//
// DAG position (see const.js's header): symbols.js <- const.js, terminal.js.
// The only other import is options.js, for the three helpers whose single
// existing port lives there (config_error_add, match_sym, sym_val) — the same
// dependency direction cfgfiles.js already uses.
//
// ---------------------------------------------------------------------------
// SYMSET STATE IS SPLIT — read this before wiring anything up.
//
// const.js:2594-2612 holds autotranslated debris for this subsystem: `gs`/`gp`
// (and a private `gr`) whose sym arrays are SCALARS, and the matching
// `update_primary_symset()` / `update_rogue_symset()` bodies that assign
// `gp.primary_syms = val` instead of `primary_syms[symp.idx] = val`.
// const.js's own comment admits it ("init functions lost array indices in
// autotranslation ... Functional but imprecise").
//
// This module keeps the FAITHFUL, array-backed cluster below.  It does not
// redefine those two C names — the tree keeps exactly one definition of each —
// so parse_sym_line() below calls const.js's copies, which land in the
// degenerate globals.  Wiring symbols.js up therefore means: delete const.js's
// gs/gp/gr stubs, repoint update_primary_symset/update_rogue_symset at this
// file's gp/gr, and only then hook parse_sym_line into the rc reader.
// set_symhandling() (also const.js's) writes gs.symset[which_set].handling,
// which is shape-compatible; only the two sym-array setters are degenerate.
// ---------------------------------------------------------------------------

import {
    CLR_BLACK, CLR_BLUE, CLR_BRIGHT_BLUE, CLR_BRIGHT_GREEN, CLR_BRIGHT_MAGENTA,
    CLR_BROWN, CLR_CYAN, CLR_GRAY, CLR_GREEN, CLR_MAGENTA, CLR_ORANGE, CLR_RED,
    CLR_WHITE, CLR_YELLOW, NO_COLOR, ATR_NONE,
} from './terminal.js';
import {
    HI_GOLD, HI_METAL, HI_WOOD, HI_ZAP,
    DEF_NOTHING, WARNCOUNT, def_warnsyms,
    SYM_INVALID, SYM_CONTROL, SYM_PCHAR, SYM_OC, SYM_MON, SYM_OTH,
    SYM_NOTHING, SYM_UNEXPLORED, SYM_BOULDER, SYM_INVISIBLE,
    SYM_PET_OVERRIDE, SYM_HERO_OVERRIDE, MAXOTHER,
    SYM_OFF_P, H_UNK, H_DEC, H_MAC, H_UTF8,
    PRIMARYSET, ROGUESET, Is_rogue_level,
    NHW_MENU, PICK_ONE, MENU_BEHAVE_STANDARD,
    MENU_ITEMFLAGS_NONE, MENU_ITEMFLAGS_SELECTED,
    update_primary_symset, update_rogue_symset, set_symhandling,
} from './const.js';
import { config_error_add, match_sym, sym_val } from './options.js';

const BUFSZ = 256;              /* global.h */
const SYMBOLS = "symbols";      /* global.h:29 — replacement symbol sets */
const WC2_U_UTF8STR = 0x020000; /* winprocs.h:262 */
const NO_GLYPH = -1;            /* display.h */

/* enum do_customizations — sym.h:132 */
const do_custom_none = 0, do_custom_colors = 1, do_custom_symbols = 2;
/* enum glyphmap_change_triggers — display.h:356 */
const gm_symchange = 4;

// A cross-file C function with no JS port yet.  These throw rather than no-op
// on purpose (same convention as cfgfiles.js): a silent no-op would let a
// wired-up caller look correct while quietly skipping C behaviour.
function unported(what) {
    throw new Error(`symbols.js: ${what} has no JS port yet`);
}
// Assigned onto `nyi` rather than declared as `const <cname>` on purpose:
// swarm/bin/coverage.mjs counts any `const NAME`/`NAME:` as a JS definition, so
// naming these directly would credit glyphs.c, display.c and utf8map.c with
// ports they do not have and steer a later breadth lane away from them.
const nyi = {};
nyi.reset_glyphmap = (trigger) => unported(`display.c:2739 reset_glyphmap(${trigger})`);
nyi.purge_custom_entries = (which_set) => unported(`glyphs.c:761 purge_custom_entries(${which_set})`);
nyi.clear_all_glyphmap_colors = () => unported('glyphs.c:1167 clear_all_glyphmap_colors()');
nyi.free_all_glyphmap_u = () => unported('utf8map.c:59 free_all_glyphmap_u()');
nyi.glyphrep_to_custom_map_entries = (buf, ref) => unported('glyphs.c:112 glyphrep_to_custom_map_entries()');
nyi.apply_customizations = (which_set, which) => unported('glyphs.c:531 apply_customizations()');
nyi.fill_glyphid_cache = () => unported('glyphs.c:303 fill_glyphid_cache()');
nyi.free_glyphid_cache = () => unported('glyphs.c:355 free_glyphid_cache()');
nyi.glyphid_cache_status = () => unported('glyphs.c:452 glyphid_cache_status()');
/* options.js has a private match_glyph() over a different table */
nyi.match_glyph = (buf) => unported('glyphs.c:458 match_glyph()');
/* options.js's private read_sym_file(name) is a different signature: it only
   tests a name against the shipped symset list. */
nyi.read_sym_file = (which_set) => unported(`files.c:2631 read_sym_file(${which_set})`);
nyi.preference_update = (pref) => unported(`options.c preference_update("${pref}")`);
/* the tty window layer: invent.js has private no-op stubs, unexported */
nyi.create_nhwindow = (type) => unported('create_nhwindow()');
nyi.destroy_nhwindow = (win) => unported('destroy_nhwindow()');
nyi.start_menu = (win, behave) => unported('start_menu()');
nyi.add_menu = (...a) => unported('add_menu()');
nyi.end_menu = (win, query) => unported('end_menu()');
nyi.select_menu = (win, how, picks) => unported('select_menu()');
nyi.pline = (msg) => unported('pline()');
nyi.There = (msg) => unported('There()');

/* hacklib.c mungspaces() — collapse runs of whitespace to one space and strip
   leading/trailing.  Seven private copies already exist across js/. */
function mungspaces(bp) {
    return String(bp).replace(/\s+/g, ' ').replace(/^ | $/g, '');
}
/* C strcmpi()/strncmpi() == 0 */
const strcmpi_eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const strncmpi_eq = (a, b, n) =>
    String(a).slice(0, n).toLowerCase() === String(b).slice(0, n).toLowerCase();

// ==========================================================================
// sym.h / defsym.h / drawing.c data tables symbols.c reads.
// Generated from include/defsym.h; do not hand-edit an index.
// ==========================================================================

// C ref: sym.h `enum cmap_symbols` (defsym.h under PCHAR_S_ENUM).
export const S_stone = 0;
export const S_vwall = 1;
export const S_hwall = 2;
export const S_tlcorn = 3;
export const S_trcorn = 4;
export const S_blcorn = 5;
export const S_brcorn = 6;
export const S_crwall = 7;
export const S_tuwall = 8;
export const S_tdwall = 9;
export const S_tlwall = 10;
export const S_trwall = 11;
export const S_ndoor = 12;
export const S_vodoor = 13;
export const S_hodoor = 14;
export const S_vcdoor = 15;
export const S_hcdoor = 16;
export const S_bars = 17;
export const S_tree = 18;
export const S_room = 19;
export const S_darkroom = 20;
export const S_engroom = 21;
export const S_corr = 22;
export const S_litcorr = 23;
export const S_engrcorr = 24;
export const S_upstair = 25;
export const S_dnstair = 26;
export const S_upladder = 27;
export const S_dnladder = 28;
export const S_brupstair = 29;
export const S_brdnstair = 30;
export const S_brupladder = 31;
export const S_brdnladder = 32;
export const S_altar = 33;
export const S_grave = 34;
export const S_throne = 35;
export const S_sink = 36;
export const S_fountain = 37;
export const S_pool = 38;
export const S_ice = 39;
export const S_lava = 40;
export const S_lavawall = 41;
export const S_vodbridge = 42;
export const S_hodbridge = 43;
export const S_vcdbridge = 44;
export const S_hcdbridge = 45;
export const S_air = 46;
export const S_cloud = 47;
export const S_water = 48;
export const S_arrow_trap = 49;
export const S_dart_trap = 50;
export const S_falling_rock_trap = 51;
export const S_squeaky_board = 52;
export const S_bear_trap = 53;
export const S_land_mine = 54;
export const S_rolling_boulder_trap = 55;
export const S_sleeping_gas_trap = 56;
export const S_rust_trap = 57;
export const S_fire_trap = 58;
export const S_pit = 59;
export const S_spiked_pit = 60;
export const S_hole = 61;
export const S_trap_door = 62;
export const S_teleportation_trap = 63;
export const S_level_teleporter = 64;
export const S_magic_portal = 65;
export const S_web = 66;
export const S_statue_trap = 67;
export const S_magic_trap = 68;
export const S_anti_magic_trap = 69;
export const S_polymorph_trap = 70;
export const S_vibrating_square = 71;
export const S_trapped_door = 72;
export const S_trapped_chest = 73;
export const S_vbeam = 74;
export const S_hbeam = 75;
export const S_lslant = 76;
export const S_rslant = 77;
export const S_digbeam = 78;
export const S_flashbeam = 79;
export const S_boomleft = 80;
export const S_boomright = 81;
export const S_ss1 = 82;
export const S_ss2 = 83;
export const S_ss3 = 84;
export const S_ss4 = 85;
export const S_poisoncloud = 86;
export const S_goodpos = 87;
export const S_sw_tl = 88;
export const S_sw_tc = 89;
export const S_sw_tr = 90;
export const S_sw_ml = 91;
export const S_sw_mr = 92;
export const S_sw_bl = 93;
export const S_sw_bc = 94;
export const S_sw_br = 95;
export const S_expl_tl = 96;
export const S_expl_tc = 97;
export const S_expl_tr = 98;
export const S_expl_ml = 99;
export const S_expl_mc = 100;
export const S_expl_mr = 101;
export const S_expl_bl = 102;
export const S_expl_bc = 103;
export const S_expl_br = 104;
export const MAXPCHARS = 105;

// C ref: sym.h `enum mon_syms` (defsym.h under MONSYMS_S_ENUM).  Index 0 is
// unused: def_monsyms[0] is a placeholder, so MAXMCLASSES is count + 1.
export const S_ANT = 1;
export const S_BLOB = 2;
export const S_COCKATRICE = 3;
export const S_DOG = 4;
export const S_EYE = 5;
export const S_FELINE = 6;
export const S_GREMLIN = 7;
export const S_HUMANOID = 8;
export const S_IMP = 9;
export const S_JELLY = 10;
export const S_KOBOLD = 11;
export const S_LEPRECHAUN = 12;
export const S_MIMIC = 13;
export const S_NYMPH = 14;
export const S_ORC = 15;
export const S_PIERCER = 16;
export const S_QUADRUPED = 17;
export const S_RODENT = 18;
export const S_SPIDER = 19;
export const S_TRAPPER = 20;
export const S_UNICORN = 21;
export const S_VORTEX = 22;
export const S_WORM = 23;
export const S_XAN = 24;
export const S_LIGHT = 25;
export const S_ZRUTY = 26;
export const S_ANGEL = 27;
export const S_BAT = 28;
export const S_CENTAUR = 29;
export const S_DRAGON = 30;
export const S_ELEMENTAL = 31;
export const S_FUNGUS = 32;
export const S_GNOME = 33;
export const S_GIANT = 34;
export const S_invisible = 35;
export const S_JABBERWOCK = 36;
export const S_KOP = 37;
export const S_LICH = 38;
export const S_MUMMY = 39;
export const S_NAGA = 40;
export const S_OGRE = 41;
export const S_PUDDING = 42;
export const S_QUANTMECH = 43;
export const S_RUSTMONST = 44;
export const S_SNAKE = 45;
export const S_TROLL = 46;
export const S_UMBER = 47;
export const S_VAMPIRE = 48;
export const S_WRAITH = 49;
export const S_XORN = 50;
export const S_YETI = 51;
export const S_ZOMBIE = 52;
export const S_HUMAN = 53;
export const S_GHOST = 54;
export const S_GOLEM = 55;
export const S_DEMON = 56;
export const S_EEL = 57;
export const S_LIZARD = 58;
export const S_WORM_TAIL = 59;
export const S_MIMIC_DEF = 60;
export const MAXMCLASSES = 61;

// C ref: sym.h `enum mon_defchars` (defsym.h under MONSYMS_DEFCHAR_ENUM).
export const DEF_ANT = 'a';
export const DEF_BLOB = 'b';
export const DEF_COCKATRICE = 'c';
export const DEF_DOG = 'd';
export const DEF_EYE = 'e';
export const DEF_FELINE = 'f';
export const DEF_GREMLIN = 'g';
export const DEF_HUMANOID = 'h';
export const DEF_IMP = 'i';
export const DEF_JELLY = 'j';
export const DEF_KOBOLD = 'k';
export const DEF_LEPRECHAUN = 'l';
export const DEF_MIMIC = 'm';
export const DEF_NYMPH = 'n';
export const DEF_ORC = 'o';
export const DEF_PIERCER = 'p';
export const DEF_QUADRUPED = 'q';
export const DEF_RODENT = 'r';
export const DEF_SPIDER = 's';
export const DEF_TRAPPER = 't';
export const DEF_UNICORN = 'u';
export const DEF_VORTEX = 'v';
export const DEF_WORM = 'w';
export const DEF_XAN = 'x';
export const DEF_LIGHT = 'y';
export const DEF_ZRUTY = 'z';
export const DEF_ANGEL = 'A';
export const DEF_BAT = 'B';
export const DEF_CENTAUR = 'C';
export const DEF_DRAGON = 'D';
export const DEF_ELEMENTAL = 'E';
export const DEF_FUNGUS = 'F';
export const DEF_GNOME = 'G';
export const DEF_GIANT = 'H';
export const DEF_INVISIBLE = 'I';
export const DEF_JABBERWOCK = 'J';
export const DEF_KOP = 'K';
export const DEF_LICH = 'L';
export const DEF_MUMMY = 'M';
export const DEF_NAGA = 'N';
export const DEF_OGRE = 'O';
export const DEF_PUDDING = 'P';
export const DEF_QUANTMECH = 'Q';
export const DEF_RUSTMONST = 'R';
export const DEF_SNAKE = 'S';
export const DEF_TROLL = 'T';
export const DEF_UMBER = 'U';
export const DEF_VAMPIRE = 'V';
export const DEF_WRAITH = 'W';
export const DEF_XORN = 'X';
export const DEF_YETI = 'Y';
export const DEF_ZOMBIE = 'Z';
export const DEF_HUMAN = '@';
export const DEF_GHOST = ' ';
export const DEF_GOLEM = "'";
export const DEF_DEMON = '&';
export const DEF_EEL = ';';
export const DEF_LIZARD = ':';
export const DEF_WORM_TAIL = '~';
export const DEF_MIMIC_DEF = ']';

// C ref: objclass.h `enum objclass_syms` (defsym.h under OBJCLASS_S_ENUM).
// The same idx also names basename##_CLASS (OBJCLASS_CLASS_ENUM), which is
// how get_othersym() indexes def_oc_syms[] by ROCK_CLASS.
export const S_strange_obj = 1;
export const S_weapon = 2;
export const S_armor = 3;
export const S_ring = 4;
export const S_amulet = 5;
export const S_tool = 6;
export const S_food = 7;
export const S_potion = 8;
export const S_scroll = 9;
export const S_book = 10;
export const S_wand = 11;
export const S_coin = 12;
export const S_gem = 13;
export const S_rock = 14;
export const S_ball = 15;
export const S_chain = 16;
export const S_venom = 17;
export const MAXOCLASSES = 18;
const ROCK_CLASS = 14; /* objclass.h; live copy is mkobj.js */

// C ref: drawing.c:63 defsyms[MAXPCHARS + 1] (defsym.h under PCHAR_DRAWING).
// { sym, explanation, color }.  A PCHAR2 entry's 4th macro arg is the tile
// name, not the explanation, so explanation comes from the 5th.
export const defsyms = [
    { sym: ' ', explanation: "stone", color: NO_COLOR }, // S_stone
    { sym: '|', explanation: "wall", color: CLR_GRAY }, // S_vwall
    { sym: '-', explanation: "wall", color: CLR_GRAY }, // S_hwall
    { sym: '-', explanation: "wall", color: CLR_GRAY }, // S_tlcorn
    { sym: '-', explanation: "wall", color: CLR_GRAY }, // S_trcorn
    { sym: '-', explanation: "wall", color: CLR_GRAY }, // S_blcorn
    { sym: '-', explanation: "wall", color: CLR_GRAY }, // S_brcorn
    { sym: '-', explanation: "wall", color: CLR_GRAY }, // S_crwall
    { sym: '-', explanation: "wall", color: CLR_GRAY }, // S_tuwall
    { sym: '-', explanation: "wall", color: CLR_GRAY }, // S_tdwall
    { sym: '|', explanation: "wall", color: CLR_GRAY }, // S_tlwall
    { sym: '|', explanation: "wall", color: CLR_GRAY }, // S_trwall
    { sym: '.', explanation: "doorway", color: CLR_GRAY }, // S_ndoor
    { sym: '-', explanation: "open door", color: CLR_BROWN }, // S_vodoor
    { sym: '|', explanation: "open door", color: CLR_BROWN }, // S_hodoor
    { sym: '+', explanation: "closed door", color: CLR_BROWN }, // S_vcdoor
    { sym: '+', explanation: "closed door", color: CLR_BROWN }, // S_hcdoor
    { sym: '#', explanation: "iron bars", color: HI_METAL }, // S_bars
    { sym: '#', explanation: "tree", color: CLR_GREEN }, // S_tree
    { sym: '.', explanation: "floor of a room", color: CLR_GRAY }, // S_room
    { sym: '.', explanation: "dark part of a room", color: CLR_BLACK }, // S_darkroom
    { sym: '`', explanation: "engraving", color: CLR_BRIGHT_BLUE }, // S_engroom
    { sym: '#', explanation: "corridor", color: CLR_GRAY }, // S_corr
    { sym: '#', explanation: "lit corridor", color: CLR_GRAY }, // S_litcorr
    { sym: '#', explanation: "engraving", color: CLR_BRIGHT_BLUE }, // S_engrcorr
    { sym: '<', explanation: "staircase up", color: CLR_GRAY }, // S_upstair
    { sym: '>', explanation: "staircase down", color: CLR_GRAY }, // S_dnstair
    { sym: '<', explanation: "ladder up", color: CLR_BROWN }, // S_upladder
    { sym: '>', explanation: "ladder down", color: CLR_BROWN }, // S_dnladder
    { sym: '<', explanation: "branch staircase up", color: CLR_YELLOW }, // S_brupstair
    { sym: '>', explanation: "branch staircase down", color: CLR_YELLOW }, // S_brdnstair
    { sym: '<', explanation: "branch ladder up", color: CLR_YELLOW }, // S_brupladder
    { sym: '>', explanation: "branch ladder down", color: CLR_YELLOW }, // S_brdnladder
    { sym: '_', explanation: "altar", color: CLR_GRAY }, // S_altar
    { sym: '|', explanation: "grave", color: CLR_WHITE }, // S_grave
    { sym: '\\', explanation: "opulent throne", color: HI_GOLD }, // S_throne
    { sym: '{', explanation: "sink", color: CLR_WHITE }, // S_sink
    { sym: '{', explanation: "fountain", color: CLR_BRIGHT_BLUE }, // S_fountain
    { sym: '}', explanation: "water", color: CLR_BLUE }, // S_pool
    { sym: '.', explanation: "ice", color: CLR_CYAN }, // S_ice
    { sym: '}', explanation: "molten lava", color: CLR_RED }, // S_lava
    { sym: '}', explanation: "wall of lava", color: CLR_ORANGE }, // S_lavawall
    { sym: '.', explanation: "lowered drawbridge", color: CLR_BROWN }, // S_vodbridge
    { sym: '.', explanation: "lowered drawbridge", color: CLR_BROWN }, // S_hodbridge
    { sym: '#', explanation: "raised drawbridge", color: CLR_BROWN }, // S_vcdbridge
    { sym: '#', explanation: "raised drawbridge", color: CLR_BROWN }, // S_hcdbridge
    { sym: ' ', explanation: "air", color: CLR_CYAN }, // S_air
    { sym: '#', explanation: "cloud", color: CLR_GRAY }, // S_cloud
    { sym: '}', explanation: "water", color: CLR_BRIGHT_BLUE }, // S_water
    { sym: '^', explanation: "arrow trap", color: HI_METAL }, // S_arrow_trap
    { sym: '^', explanation: "dart trap", color: HI_METAL }, // S_dart_trap
    { sym: '^', explanation: "falling rock trap", color: CLR_GRAY }, // S_falling_rock_trap
    { sym: '^', explanation: "squeaky board", color: CLR_BROWN }, // S_squeaky_board
    { sym: '^', explanation: "bear trap", color: HI_METAL }, // S_bear_trap
    { sym: '^', explanation: "land mine", color: CLR_RED }, // S_land_mine
    { sym: '^', explanation: "rolling boulder trap", color: CLR_GRAY }, // S_rolling_boulder_trap
    { sym: '^', explanation: "sleeping gas trap", color: HI_ZAP }, // S_sleeping_gas_trap
    { sym: '^', explanation: "rust trap", color: CLR_BLUE }, // S_rust_trap
    { sym: '^', explanation: "fire trap", color: CLR_ORANGE }, // S_fire_trap
    { sym: '^', explanation: "pit", color: CLR_BLACK }, // S_pit
    { sym: '^', explanation: "spiked pit", color: CLR_BLACK }, // S_spiked_pit
    { sym: '^', explanation: "hole", color: CLR_BROWN }, // S_hole
    { sym: '^', explanation: "trap door", color: CLR_BROWN }, // S_trap_door
    { sym: '^', explanation: "teleportation trap", color: CLR_MAGENTA }, // S_teleportation_trap
    { sym: '^', explanation: "level teleporter", color: CLR_MAGENTA }, // S_level_teleporter
    { sym: '^', explanation: "magic portal", color: CLR_BRIGHT_MAGENTA }, // S_magic_portal
    { sym: '"', explanation: "web", color: CLR_GRAY }, // S_web
    { sym: '^', explanation: "statue trap", color: CLR_GRAY }, // S_statue_trap
    { sym: '^', explanation: "magic trap", color: HI_ZAP }, // S_magic_trap
    { sym: '^', explanation: "anti-magic field", color: HI_ZAP }, // S_anti_magic_trap
    { sym: '^', explanation: "polymorph trap", color: CLR_BRIGHT_GREEN }, // S_polymorph_trap
    { sym: '~', explanation: "vibrating square", color: CLR_MAGENTA }, // S_vibrating_square
    { sym: '^', explanation: "trapped door", color: CLR_ORANGE }, // S_trapped_door
    { sym: '^', explanation: "trapped chest", color: CLR_ORANGE }, // S_trapped_chest
    { sym: '|', explanation: "", color: CLR_GRAY }, // S_vbeam
    { sym: '-', explanation: "", color: CLR_GRAY }, // S_hbeam
    { sym: '\\', explanation: "", color: CLR_GRAY }, // S_lslant
    { sym: '/', explanation: "", color: CLR_GRAY }, // S_rslant
    { sym: '*', explanation: "", color: CLR_WHITE }, // S_digbeam
    { sym: '!', explanation: "", color: CLR_WHITE }, // S_flashbeam
    { sym: ')', explanation: "", color: HI_WOOD }, // S_boomleft
    { sym: '(', explanation: "", color: HI_WOOD }, // S_boomright
    { sym: '0', explanation: "", color: HI_ZAP }, // S_ss1
    { sym: '#', explanation: "", color: HI_ZAP }, // S_ss2
    { sym: '@', explanation: "", color: HI_ZAP }, // S_ss3
    { sym: '*', explanation: "", color: HI_ZAP }, // S_ss4
    { sym: '#', explanation: "poison cloud", color: CLR_BRIGHT_GREEN }, // S_poisoncloud
    { sym: '$', explanation: "valid position", color: HI_ZAP }, // S_goodpos
    { sym: '/', explanation: "", color: CLR_GREEN }, // S_sw_tl
    { sym: '-', explanation: "", color: CLR_GREEN }, // S_sw_tc
    { sym: '\\', explanation: "", color: CLR_GREEN }, // S_sw_tr
    { sym: '|', explanation: "", color: CLR_GREEN }, // S_sw_ml
    { sym: '|', explanation: "", color: CLR_GREEN }, // S_sw_mr
    { sym: '\\', explanation: "", color: CLR_GREEN }, // S_sw_bl
    { sym: '-', explanation: "", color: CLR_GREEN }, // S_sw_bc
    { sym: '/', explanation: "", color: CLR_GREEN }, // S_sw_br
    { sym: '/', explanation: "", color: CLR_ORANGE }, // S_expl_tl
    { sym: '-', explanation: "", color: CLR_ORANGE }, // S_expl_tc
    { sym: '\\', explanation: "", color: CLR_ORANGE }, // S_expl_tr
    { sym: '|', explanation: "", color: CLR_ORANGE }, // S_expl_ml
    { sym: ' ', explanation: "", color: CLR_ORANGE }, // S_expl_mc
    { sym: '|', explanation: "", color: CLR_ORANGE }, // S_expl_mr
    { sym: '\\', explanation: "", color: CLR_ORANGE }, // S_expl_bl
    { sym: '-', explanation: "", color: CLR_ORANGE }, // S_expl_bc
    { sym: '/', explanation: "", color: CLR_ORANGE }, // S_expl_br
    { sym: 0, explanation: null, color: NO_COLOR }, // C fence post
];

// C ref: drawing.c:25 def_oc_syms[MAXOCLASSES] (defsym.h under OBJCLASS_DRAWING).
// { sym, name, explain } — slot 0 is C's "random class" placeholder.
export const def_oc_syms = [
    { sym: 0, name: "", explain: "" },
    { sym: ']', name: "illegal objects", explain: "strange object" }, // S_strange_obj
    { sym: ')', name: "weapons", explain: "weapon" }, // S_weapon
    { sym: '[', name: "armor", explain: "suit or piece of armor" }, // S_armor
    { sym: '=', name: "rings", explain: "ring" }, // S_ring
    { sym: '"', name: "amulets", explain: "amulet" }, // S_amulet
    { sym: '(', name: "tools", explain: "useful item (pick-axe, key, lamp...)" }, // S_tool
    { sym: '%', name: "food", explain: "piece of food" }, // S_food
    { sym: '!', name: "potions", explain: "potion" }, // S_potion
    { sym: '?', name: "scrolls", explain: "scroll" }, // S_scroll
    { sym: '+', name: "spellbooks", explain: "spellbook" }, // S_book
    { sym: '/', name: "wands", explain: "wand" }, // S_wand
    { sym: '$', name: "coins", explain: "pile of coins" }, // S_coin
    { sym: '*', name: "rocks", explain: "gem or rock" }, // S_gem
    { sym: '`', name: "large stones", explain: "boulder or statue" }, // S_rock
    { sym: '0', name: "iron balls", explain: "iron ball" }, // S_ball
    { sym: '_', name: "chains", explain: "iron chain" }, // S_chain
    { sym: '.', name: "venoms", explain: "splash of venom" }, // S_venom
];

// C ref: drawing.c:33 def_monsyms[MAXMCLASSES] (defsym.h under MONSYMS_DRAWING).
export const def_monsyms = [
    { sym: 0, name: "", explain: "" },
    { sym: DEF_ANT, name: "", explain: "ant or other insect" }, // S_ANT
    { sym: DEF_BLOB, name: "", explain: "blob" }, // S_BLOB
    { sym: DEF_COCKATRICE, name: "", explain: "cockatrice" }, // S_COCKATRICE
    { sym: DEF_DOG, name: "", explain: "dog or other canine" }, // S_DOG
    { sym: DEF_EYE, name: "", explain: "eye or sphere" }, // S_EYE
    { sym: DEF_FELINE, name: "", explain: "cat or other feline" }, // S_FELINE
    { sym: DEF_GREMLIN, name: "", explain: "gremlin" }, // S_GREMLIN
    { sym: DEF_HUMANOID, name: "", explain: "humanoid" }, // S_HUMANOID
    { sym: DEF_IMP, name: "", explain: "imp or minor demon" }, // S_IMP
    { sym: DEF_JELLY, name: "", explain: "jelly" }, // S_JELLY
    { sym: DEF_KOBOLD, name: "", explain: "kobold" }, // S_KOBOLD
    { sym: DEF_LEPRECHAUN, name: "", explain: "leprechaun" }, // S_LEPRECHAUN
    { sym: DEF_MIMIC, name: "", explain: "mimic" }, // S_MIMIC
    { sym: DEF_NYMPH, name: "", explain: "nymph" }, // S_NYMPH
    { sym: DEF_ORC, name: "", explain: "orc" }, // S_ORC
    { sym: DEF_PIERCER, name: "", explain: "piercer" }, // S_PIERCER
    { sym: DEF_QUADRUPED, name: "", explain: "quadruped" }, // S_QUADRUPED
    { sym: DEF_RODENT, name: "", explain: "rodent" }, // S_RODENT
    { sym: DEF_SPIDER, name: "", explain: "arachnid or centipede" }, // S_SPIDER
    { sym: DEF_TRAPPER, name: "", explain: "trapper or lurker above" }, // S_TRAPPER
    { sym: DEF_UNICORN, name: "", explain: "unicorn or horse" }, // S_UNICORN
    { sym: DEF_VORTEX, name: "", explain: "vortex" }, // S_VORTEX
    { sym: DEF_WORM, name: "", explain: "worm" }, // S_WORM
    { sym: DEF_XAN, name: "", explain: "xan or other mythical/fantastic insect" }, // S_XAN
    { sym: DEF_LIGHT, name: "", explain: "light" }, // S_LIGHT
    { sym: DEF_ZRUTY, name: "", explain: "zruty" }, // S_ZRUTY
    { sym: DEF_ANGEL, name: "", explain: "angelic being" }, // S_ANGEL
    { sym: DEF_BAT, name: "", explain: "bat or bird" }, // S_BAT
    { sym: DEF_CENTAUR, name: "", explain: "centaur" }, // S_CENTAUR
    { sym: DEF_DRAGON, name: "", explain: "dragon" }, // S_DRAGON
    { sym: DEF_ELEMENTAL, name: "", explain: "elemental" }, // S_ELEMENTAL
    { sym: DEF_FUNGUS, name: "", explain: "fungus or mold" }, // S_FUNGUS
    { sym: DEF_GNOME, name: "", explain: "gnome" }, // S_GNOME
    { sym: DEF_GIANT, name: "", explain: "giant humanoid" }, // S_GIANT
    { sym: DEF_INVISIBLE, name: "", explain: "invisible monster" }, // S_invisible
    { sym: DEF_JABBERWOCK, name: "", explain: "jabberwock" }, // S_JABBERWOCK
    { sym: DEF_KOP, name: "", explain: "Keystone Kop" }, // S_KOP
    { sym: DEF_LICH, name: "", explain: "lich" }, // S_LICH
    { sym: DEF_MUMMY, name: "", explain: "mummy" }, // S_MUMMY
    { sym: DEF_NAGA, name: "", explain: "naga" }, // S_NAGA
    { sym: DEF_OGRE, name: "", explain: "ogre" }, // S_OGRE
    { sym: DEF_PUDDING, name: "", explain: "pudding or ooze" }, // S_PUDDING
    { sym: DEF_QUANTMECH, name: "", explain: "quantum mechanic" }, // S_QUANTMECH
    { sym: DEF_RUSTMONST, name: "", explain: "rust monster or disenchanter" }, // S_RUSTMONST
    { sym: DEF_SNAKE, name: "", explain: "snake" }, // S_SNAKE
    { sym: DEF_TROLL, name: "", explain: "troll" }, // S_TROLL
    { sym: DEF_UMBER, name: "", explain: "umber hulk" }, // S_UMBER
    { sym: DEF_VAMPIRE, name: "", explain: "vampire" }, // S_VAMPIRE
    { sym: DEF_WRAITH, name: "", explain: "wraith" }, // S_WRAITH
    { sym: DEF_XORN, name: "", explain: "xorn" }, // S_XORN
    { sym: DEF_YETI, name: "", explain: "apelike creature" }, // S_YETI
    { sym: DEF_ZOMBIE, name: "", explain: "zombie" }, // S_ZOMBIE
    { sym: DEF_HUMAN, name: "", explain: "human or elf" }, // S_HUMAN
    { sym: DEF_GHOST, name: "", explain: "ghost" }, // S_GHOST
    { sym: DEF_GOLEM, name: "", explain: "golem" }, // S_GOLEM
    { sym: DEF_DEMON, name: "", explain: "major demon" }, // S_DEMON
    { sym: DEF_EEL, name: "", explain: "sea monster" }, // S_EEL
    { sym: DEF_LIZARD, name: "", explain: "lizard" }, // S_LIZARD
    { sym: DEF_WORM_TAIL, name: "", explain: "long worm tail" }, // S_WORM_TAIL
    { sym: DEF_MIMIC_DEF, name: "", explain: "mimic" }, // S_MIMIC_DEF
];

// C ref: objclass.h `enum objclass_defchars` (defsym.h under
// OBJCLASS_DEFCHAR_ENUM) — the *_SYM names def_r_oc_syms[] is written with.
const ILLOBJ_SYM = ']';
const WEAPON_SYM = ')';
const ARMOR_SYM = '[';
const RING_SYM = '=';
const AMULET_SYM = '"';
const TOOL_SYM = '(';
const FOOD_SYM = '%';
const POTION_SYM = '!';
const SCROLL_SYM = '?';
const SPBOOK_SYM = '+';
const WAND_SYM = '/';
const GOLD_SYM = '$';
const GEM_SYM = '*';
const ROCK_SYM = '`';
const BALL_SYM = '0';
const CHAIN_SYM = '_';
const VENOM_SYM = '.';

// C ref: drawing.c:72 def_r_oc_syms[MAXOCLASSES] — the rogue-level object
// class chars.  Hand-written in C, not generated from defsym.h.
export const def_r_oc_syms = [
/* 0*/ 0, ILLOBJ_SYM, WEAPON_SYM, ']', /* armor */
       RING_SYM,
/* 5*/ ',',                     /* amulet */
       TOOL_SYM, ':',           /* food */
       POTION_SYM, SCROLL_SYM,
/*10*/ SPBOOK_SYM, WAND_SYM,
       GEM_SYM,                /* gold -- yes it's the same as gems */
       GEM_SYM, ROCK_SYM,
/*15*/ BALL_SYM, CHAIN_SYM, VENOM_SYM,
];

// C ref: symbols.c loadsyms[] — the three defsym.h expansions, in the order
// symbols.c includes them (PCHAR_PARSE, OBJCLASS_PARSE, MONSYMS_PARSE).
const LOADSYMS_PCHAR_NAMES = [
    "S_stone", "S_vwall", "S_hwall", "S_tlcorn", "S_trcorn",
    "S_blcorn", "S_brcorn", "S_crwall", "S_tuwall", "S_tdwall",
    "S_tlwall", "S_trwall", "S_ndoor", "S_vodoor", "S_hodoor",
    "S_vcdoor", "S_hcdoor", "S_bars", "S_tree", "S_room",
    "S_darkroom", "S_engroom", "S_corr", "S_litcorr", "S_engrcorr",
    "S_upstair", "S_dnstair", "S_upladder", "S_dnladder", "S_brupstair",
    "S_brdnstair", "S_brupladder", "S_brdnladder", "S_altar", "S_grave",
    "S_throne", "S_sink", "S_fountain", "S_pool", "S_ice",
    "S_lava", "S_lavawall", "S_vodbridge", "S_hodbridge", "S_vcdbridge",
    "S_hcdbridge", "S_air", "S_cloud", "S_water", "S_arrow_trap",
    "S_dart_trap", "S_falling_rock_trap", "S_squeaky_board", "S_bear_trap", "S_land_mine",
    "S_rolling_boulder_trap", "S_sleeping_gas_trap", "S_rust_trap", "S_fire_trap", "S_pit",
    "S_spiked_pit", "S_hole", "S_trap_door", "S_teleportation_trap", "S_level_teleporter",
    "S_magic_portal", "S_web", "S_statue_trap", "S_magic_trap", "S_anti_magic_trap",
    "S_polymorph_trap", "S_vibrating_square", "S_trapped_door", "S_trapped_chest", "S_vbeam",
    "S_hbeam", "S_lslant", "S_rslant", "S_digbeam", "S_flashbeam",
    "S_boomleft", "S_boomright", "S_ss1", "S_ss2", "S_ss3",
    "S_ss4", "S_poisoncloud", "S_goodpos", "S_sw_tl", "S_sw_tc",
    "S_sw_tr", "S_sw_ml", "S_sw_mr", "S_sw_bl", "S_sw_bc",
    "S_sw_br", "S_expl_tl", "S_expl_tc", "S_expl_tr", "S_expl_ml",
    "S_expl_mc", "S_expl_mr", "S_expl_bl", "S_expl_bc", "S_expl_br",
];
const LOADSYMS_OC_NAMES = [
    "S_strange_obj", "S_weapon", "S_armor", "S_ring", "S_amulet",
    "S_tool", "S_food", "S_potion", "S_scroll", "S_book",
    "S_wand", "S_coin", "S_gem", "S_rock", "S_ball",
    "S_chain", "S_venom",
];
const LOADSYMS_MON_NAMES = [
    "S_ANT", "S_BLOB", "S_COCKATRICE", "S_DOG", "S_EYE",
    "S_FELINE", "S_GREMLIN", "S_HUMANOID", "S_IMP", "S_JELLY",
    "S_KOBOLD", "S_LEPRECHAUN", "S_MIMIC", "S_NYMPH", "S_ORC",
    "S_PIERCER", "S_QUADRUPED", "S_RODENT", "S_SPIDER", "S_TRAPPER",
    "S_UNICORN", "S_VORTEX", "S_WORM", "S_XAN", "S_LIGHT",
    "S_ZRUTY", "S_ANGEL", "S_BAT", "S_CENTAUR", "S_DRAGON",
    "S_ELEMENTAL", "S_FUNGUS", "S_GNOME", "S_GIANT", "S_invisible",
    "S_JABBERWOCK", "S_KOP", "S_LICH", "S_MUMMY", "S_NAGA",
    "S_OGRE", "S_PUDDING", "S_QUANTMECH", "S_RUSTMONST", "S_SNAKE",
    "S_TROLL", "S_UMBER", "S_VAMPIRE", "S_WRAITH", "S_XORN",
    "S_YETI", "S_ZOMBIE", "S_HUMAN", "S_GHOST", "S_GOLEM",
    "S_DEMON", "S_EEL", "S_LIZARD", "S_WORM_TAIL", "S_MIMIC_DEF",
];

// ==========================================================================
// hack.h symbol-array offsets.  const.js parks these in
// DEFERRED_HEADER_CONST_MACRO_DETAILS with ownerHint "symbols.js" because they
// need MAXPCHARS/MAXOCLASSES/MAXMCLASSES, which live here.
// ==========================================================================

export const SYM_OFF_O = SYM_OFF_P + MAXPCHARS;
export const SYM_OFF_M = SYM_OFF_O + MAXOCLASSES;
export const SYM_OFF_W = SYM_OFF_M + MAXMCLASSES;
export const SYM_OFF_X = SYM_OFF_W + WARNCOUNT;
export const SYM_MAX = SYM_OFF_X + MAXOTHER;

// C ref: symbols.c:376 known_handling[] — must match sym.h's
// enum symset_handling_types offsets.  Externally referenced from files.c,
// options.c and utf8map.c.  const.js:2620 has a 5-entry copy that is MISSING
// "CURS" and "MAC", so its set_symhandling() maps "UTF8" to H_CURS(3).
export const known_handling = [
    "UNKNOWN", /* H_UNK  */
    "IBM",     /* H_IBM  */
    "DEC",     /* H_DEC  */
    "CURS",    /* H_CURS */
    "MAC",     /* H_MAC  -- pre-OSX MACgraphics */
    "UTF8",    /* H_UTF8 */
    null,
];

// C ref: symbols.c:399 known_restrictions[] — accepted symset restriction
// keywords; the index selects which symsetentry bit parse_sym_line() sets.
export const known_restrictions = ["primary", "rogue", null];

// C ref: symbols.c:402 loadsyms[].  The SYM_CONTROL head, then the PCHAR,
// OBJCLASS and MONSYM defsym.h expansions in that order, then the SYM_OTH
// tail and the fence post.  options.js carries a private, idx-less copy of
// this table for its own match_sym().
export const loadsyms = [
    { range: SYM_CONTROL, idx: 0, name: "start" },
    { range: SYM_CONTROL, idx: 0, name: "begin" },
    { range: SYM_CONTROL, idx: 1, name: "finish" },
    { range: SYM_CONTROL, idx: 2, name: "handling" },
    { range: SYM_CONTROL, idx: 3, name: "description" },
    { range: SYM_CONTROL, idx: 4, name: "color" },
    { range: SYM_CONTROL, idx: 4, name: "colour" },
    { range: SYM_CONTROL, idx: 5, name: "restrictions" },
    /* PCHAR_PARSE:    { SYM_PCHAR, sym, #sym } — sym is already SYM_OFF_P-based */
    ...LOADSYMS_PCHAR_NAMES.map((name, i) => ({ range: SYM_PCHAR, idx: i, name })),
    /* OBJCLASS_PARSE: { SYM_OC, sym + SYM_OFF_O, #sym } */
    ...LOADSYMS_OC_NAMES.map((name, i) => ({ range: SYM_OC, idx: (i + 1) + SYM_OFF_O, name })),
    /* MONSYMS_PARSE:  { SYM_MON, sym + SYM_OFF_M, #sym } */
    ...LOADSYMS_MON_NAMES.map((name, i) => ({ range: SYM_MON, idx: (i + 1) + SYM_OFF_M, name })),
    { range: SYM_OTH, idx: SYM_NOTHING + SYM_OFF_X, name: "S_nothing" },
    { range: SYM_OTH, idx: SYM_UNEXPLORED + SYM_OFF_X, name: "S_unexplored" },
    { range: SYM_OTH, idx: SYM_BOULDER + SYM_OFF_X, name: "S_boulder" },
    { range: SYM_OTH, idx: SYM_INVISIBLE + SYM_OFF_X, name: "S_invisible" },
    { range: SYM_OTH, idx: SYM_PET_OVERRIDE + SYM_OFF_X, name: "S_pet_override" },
    { range: SYM_OTH, idx: SYM_HERO_OVERRIDE + SYM_OFF_X, name: "S_hero_override" },
    { range: SYM_INVALID, idx: 0, name: null }, /* fence post */
];

// ==========================================================================
// decl.c global clusters, restricted to the fields symbols.c touches.
// See the SYMSET STATE IS SPLIT note at the top of this file.
// ==========================================================================

/* struct symsetentry, sym.h:70 — one per graphics set */
function new_symsetentry() {
    return {
        next: null, name: null, desc: null, idx: 0, handling: H_UNK,
        nocolor: 0, primary: 0, rogue: 0, explicitly: 0,
    };
}

/* gs — the symbols cluster */
export const gs = {
    showsyms: new Array(SYM_MAX).fill(0),
    symset: [new_symsetentry(), new_symsetentry()], /* [PRIMARYSET], [ROGUESET] */
    symset_list: null,      /* linked list built by read_sym_file() */
    symset_count: 0,
    symset_which_set: PRIMARYSET,
};
/* gp — primary graphics set */
export const gp = { primary_syms: new Array(SYM_MAX).fill(0) };
/* gr — rogue graphics set */
export const gr = { rogue_syms: new Array(SYM_MAX).fill(0) };
/* go — the SYMBOLS=/ROGUESYMBOLS= overrides that outrank a loaded symset */
export const go = {
    ov_primary_syms: new Array(SYM_MAX).fill(0),
    ov_rogue_syms: new Array(SYM_MAX).fill(0),
};
/* gc — current graphics set plus read_sym_file()'s parse cursor */
export const gc = {
    currentgraphics: PRIMARYSET,
    chosen_symset_start: false,
    chosen_symset_end: false,
};

/* sym.h:176 SYMHANDLING(ht) */
export function SYMHANDLING(ht) {
    return gs.symset[gc.currentgraphics].handling === ht;
}

// The tty interface parks these in term_start_screen(); they stay null until a
// windowport assigns one.  Only H_DEC and H_UTF8 are reachable in the
// recorder's build (TERMLIB via tcap.h, ENHANCED_SYMBOLS; no PC9800, no
// CURSES_GRAPHICS, no WIN32).
export let decgraphics_mode_callback = null;   /* symbols.c:14, TERMLIB */
export let utf8graphics_mode_callback = null;  /* symbols.c:28, ENHANCED_SYMBOLS */

// ==========================================================================
// src/symbols.c
// ==========================================================================

// C ref: symbols.c:85 init_symbols() — set the current display symbols and the
// loadable symbols to the NetHack defaults, discarding any external symbol set.
export function init_symbols() {
    init_ov_primary_symbols();
    init_ov_rogue_symbols();
    init_primary_symbols();
    init_showsyms();
    init_rogue_symbols();
}

// C ref: symbols.c:95 init_showsyms()
export function init_showsyms() {
    let i;

    for (i = 0; i < MAXPCHARS; i++)
        gs.showsyms[i + SYM_OFF_P] = defsyms[i].sym;
    for (i = 0; i < MAXOCLASSES; i++)
        gs.showsyms[i + SYM_OFF_O] = def_oc_syms[i].sym;
    for (i = 0; i < MAXMCLASSES; i++)
        gs.showsyms[i + SYM_OFF_M] = def_monsyms[i].sym;
    for (i = 0; i < WARNCOUNT; i++)
        /* const.js's def_warnsyms[] spells struct symdef's `sym` as `ch` */
        gs.showsyms[i + SYM_OFF_W] = def_warnsyms[i].ch;
    for (i = 0; i < MAXOTHER; i++)
        gs.showsyms[i + SYM_OFF_X] = get_othersym(i, PRIMARYSET);
}

// C ref: symbols.c:113 init_ov_rogue_symbols() — defaults for the overrides to
// the rogue symset.
export function init_ov_rogue_symbols() {
    for (let i = 0; i < SYM_MAX; i++)
        go.ov_rogue_syms[i] = 0;
}

// C ref: symbols.c:122 init_ov_primary_symbols() — defaults for the overrides
// to the primary symset.
export function init_ov_primary_symbols() {
    for (let i = 0; i < SYM_MAX; i++)
        go.ov_primary_syms[i] = 0;
}

// C ref: symbols.c:131 get_othersym()
export function get_othersym(idx, which_set) {
    let sym = 0;
    const oidx = idx + SYM_OFF_X;

    if (which_set === ROGUESET)
        sym = go.ov_rogue_syms[oidx] ? go.ov_rogue_syms[oidx]
                                     : gr.rogue_syms[oidx];
    else
        sym = go.ov_primary_syms[oidx] ? go.ov_primary_syms[oidx]
                                       : gp.primary_syms[oidx];
    if (!sym) {
        switch (idx) {
        case SYM_NOTHING:
        case SYM_UNEXPLORED:
            sym = DEF_NOTHING;
            break;
        case SYM_BOULDER:
            sym = def_oc_syms[ROCK_CLASS].sym;
            break;
        case SYM_INVISIBLE:
            sym = DEF_INVISIBLE;
            break;
        /* C ref: symbols.c:155 `#if 0` — SYM_PET_OVERRIDE and
           SYM_HERO_OVERRIDE intentionally have no defaults. */
        }
    }
    return sym;
}

// C ref: symbols.c:167 init_primary_symbols() — defaults for the primary symset
export function init_primary_symbols() {
    let i;

    for (i = 0; i < MAXPCHARS; i++)
        gp.primary_syms[i + SYM_OFF_P] = defsyms[i].sym;
    for (i = 0; i < MAXOCLASSES; i++)
        gp.primary_syms[i + SYM_OFF_O] = def_oc_syms[i].sym;
    for (i = 0; i < MAXMCLASSES; i++)
        gp.primary_syms[i + SYM_OFF_M] = def_monsyms[i].sym;
    for (i = 0; i < WARNCOUNT; i++)
        gp.primary_syms[i + SYM_OFF_W] = def_warnsyms[i].ch;
    for (i = 0; i < MAXOTHER; i++)
        gp.primary_syms[i + SYM_OFF_X] = get_othersym(i, PRIMARYSET);

    clear_symsetentry(PRIMARYSET, false);
}

// C ref: symbols.c:187 init_rogue_symbols() — defaults for the rogue symset,
// which the roguesymbols option can then overwrite.
export function init_rogue_symbols() {
    let i;

    for (i = 0; i < MAXPCHARS; i++)
        gr.rogue_syms[i + SYM_OFF_P] = defsyms[i].sym;
    gr.rogue_syms[S_vodoor] = gr.rogue_syms[S_hodoor] =
        gr.rogue_syms[S_ndoor] = '+';
    gr.rogue_syms[S_upstair] = gr.rogue_syms[S_dnstair] = '%';

    for (i = 0; i < MAXOCLASSES; i++)
        gr.rogue_syms[i + SYM_OFF_O] = def_r_oc_syms[i];
    for (i = 0; i < MAXMCLASSES; i++)
        gr.rogue_syms[i + SYM_OFF_M] = def_monsyms[i].sym;
    for (i = 0; i < WARNCOUNT; i++)
        gr.rogue_syms[i + SYM_OFF_W] = def_warnsyms[i].ch;
    for (i = 0; i < MAXOTHER; i++)
        gr.rogue_syms[i + SYM_OFF_X] = get_othersym(i, ROGUESET);

    clear_symsetentry(ROGUESET, false);
    /* default on the Rogue level is no color, but a symbol set can override */
    gs.symset[ROGUESET].nocolor = 1;
}

// C ref: symbols.c:217 assign_graphics() — toggle in and out of the rogue
// level's display mode.  The MSDOS/TILES_IN_GLYPHMAP tileview() calls are not
// in the recorder's build.
export function assign_graphics(whichset) {
    let i;

    switch (whichset) {
    case ROGUESET:
        /* Adjust graphics display characters on Rogue levels */
        for (i = 0; i < SYM_MAX; i++)
            gs.showsyms[i] = go.ov_rogue_syms[i] ? go.ov_rogue_syms[i]
                                                 : gr.rogue_syms[i];
        gc.currentgraphics = ROGUESET;
        break;

    case PRIMARYSET:
    default:
        for (i = 0; i < SYM_MAX; i++)
            gs.showsyms[i] = go.ov_primary_syms[i] ? go.ov_primary_syms[i]
                                                   : gp.primary_syms[i];
        gc.currentgraphics = PRIMARYSET;
        break;
    }
    nyi.reset_glyphmap(gm_symchange);
}

// C ref: symbols.c:253 switch_symbols() — swap showsyms in from either the
// loaded symbols (nondefault) or the compiled-in defaults.
export function switch_symbols(nondefault) {
    let i;

    if (nondefault) {
        for (i = 0; i < SYM_MAX; i++)
            gs.showsyms[i] = go.ov_primary_syms[i] ? go.ov_primary_syms[i]
                                                   : gp.primary_syms[i];
        /* PC9800's H_IBM/H_UNK and WIN32's H_IBM arms are not in this build. */
        /* TERMLIB: curses assigns no dec..._callback but does the equivalent
           initialization under the hood for DECgraphics-capable terminals. */
        if (SYMHANDLING(H_DEC) && decgraphics_mode_callback)
            decgraphics_mode_callback();
        /* CURSES_GRAPHICS' H_CURS arm is not in this build. */
        if (SYMHANDLING(H_UTF8) && utf8graphics_mode_callback)
            utf8graphics_mode_callback();
    } else {
        init_primary_symbols();
        init_showsyms();
    }
}

// C ref: symbols.c:295 update_ov_primary_symset() — a SYMBOLS= rc line's
// override for the primary set.
export function update_ov_primary_symset(symp, val) {
    go.ov_primary_syms[symp.idx] = val;
}

// C ref: symbols.c:301 update_ov_rogue_symset()
export function update_ov_rogue_symset(symp, val) {
    go.ov_rogue_syms[symp.idx] = val;
}

/* symbols.c:307 update_primary_symset() and symbols.c:313
   update_rogue_symset() are NOT redefined here — const.js:2606/2611 already
   holds the tree's only copies.  See the SYMSET STATE IS SPLIT note above. */

// C ref: symbols.c:319 clear_symsetentry()
export function clear_symsetentry(which_set, name_too) {
    /* ENHANCED_SYMBOLS */
    const other_set = (which_set === PRIMARYSET) ? ROGUESET : PRIMARYSET;
    const old_handling = gs.symset[which_set].handling;

    gs.symset[which_set].desc = null;

    gs.symset[which_set].handling = H_UNK;
    gs.symset[which_set].nocolor = 0;
    /* initialize restriction bits */
    gs.symset[which_set].primary = 0;
    gs.symset[which_set].rogue = 0;

    if (name_too) {
        gs.symset[which_set].name = null;
    }
    /* if 'which_set' was using UTF8, it isn't anymore; if the other set
       isn't using UTF8, discard the data for that */
    if (old_handling === H_UTF8 && gs.symset[other_set].handling !== H_UTF8)
        nyi.free_all_glyphmap_u();
    nyi.purge_custom_entries(which_set);
    nyi.clear_all_glyphmap_colors();
}

// C ref: symbols.c:353 symset_is_compatible() — called from windmain.c.
export function symset_is_compatible(handling, wincap2) {
    /* ENHANCED_SYMBOLS */
    const WC2_utf8_bits = WC2_U_UTF8STR;

    if (handling === H_UTF8 && ((wincap2 & WC2_utf8_bits) !== WC2_utf8_bits))
        return false;
    return true;
}

// C ref: symbols.c:431 proc_symset_line() — read_sym_file()'s per-line hook.
export function proc_symset_line(buf) {
    /* C: !((boolean) parse_sym_line(...)) — TRUE means the line FAILED */
    return !parse_sym_line(buf, gs.symset_which_set);
}

// C ref: symbols.c:438 parse_sym_line() — one line of a symbol set file.
// Returns 0 on error.
//
// The caller's buffer is truncated in place by C (the trailing-comment cut and
// the `*bufp = '\0'` at the separator); JS strings are values, so `buf` and
// `bufp` are separate slices here and nothing propagates back to the caller.
export function parse_sym_line(buf, which_set) {
    let val, i;
    let symp = null;
    let bufp, commentp, altp;
    const glyph = { idx: NO_GLYPH };
    let enhanced_unavailable = false, is_glyph = false;

    if (buf.length >= BUFSZ)
        buf = buf.slice(0, BUFSZ - 1);
    /* convert each instance of whitespace (tabs, consecutive spaces)
       into a single space; leading and trailing spaces are stripped */
    buf = mungspaces(buf);

    /* remove trailing comment, if any (this isn't strictly needed for
       individual symbols, and it won't matter if "X#comment" without
       separating space slips through; for handling or set description,
       symbol set creator is responsible for preceding '#' with a space
       and that comment itself doesn't contain " #") */
    /* C tests commentp[-1] whenever strrchr() found a '#'; at index 0 that
       reads the byte before the buffer, so `> 0` is the defined equivalent. */
    commentp = buf.lastIndexOf('#');
    if (commentp > 0 && buf[commentp - 1] === ' ')
        buf = buf.slice(0, commentp - 1);

    /* find the '=' or ':' */
    let bufi = buf.indexOf('=');
    altp = buf.indexOf(':');

    if (bufi < 0 || (altp >= 0 && altp < bufi))
        bufi = altp;

    if (bufi < 0) {
        if (strncmpi_eq(buf, "finish", 6)) {
            /* end current graphics set */
            if (gc.chosen_symset_start)
                gc.chosen_symset_end = true;
            gc.chosen_symset_start = false;
            return 1;
        }
        config_error_add("No \"finish\"");
        return 0;
    }
    /* skip '=' and space which follows, if any */
    ++bufi;
    if (buf[bufi] === ' ')
        ++bufi;
    bufp = buf.slice(bufi);

    symp = match_sym_loadsyms(buf);
    if (!symp && buf[0] === 'G' && buf[1] === '_') {
        if (gc.chosen_symset_start) {
            is_glyph = nyi.match_glyph(buf);
        } else {
            is_glyph = true; /* report error only once */
        }
        /* ENHANCED_SYMBOLS is defined in this build */
        enhanced_unavailable = false;
    }
    if (!symp && !is_glyph && !enhanced_unavailable) {
        config_error_add("Unknown sym keyword");
        return 0;
    }
    if (symp) {
        if (!gs.symset[which_set].name) {
            /* A null symset name indicates that we're just
               building a pick-list of possible symset
               values from the file, so only do that */
            if (symp.range === SYM_CONTROL) {
                let tmpsp, lastsp;

                for (lastsp = gs.symset_list; lastsp; lastsp = lastsp.next)
                    if (!lastsp.next)
                        break;
                switch (symp.idx) {
                case 0:
                    tmpsp = new_symsetentry();
                    tmpsp.next = null;
                    if (!lastsp)
                        gs.symset_list = tmpsp;
                    else
                        lastsp.next = tmpsp;
                    tmpsp.idx = gs.symset_count++;
                    tmpsp.name = bufp;
                    tmpsp.desc = null;
                    tmpsp.handling = H_UNK;
                    /* initialize restriction bits */
                    tmpsp.nocolor = 0;
                    tmpsp.primary = 0;
                    tmpsp.rogue = 0;
                    break;
                case 2:
                    /* handler type identified */
                    tmpsp = lastsp; /* most recent symset */
                    for (i = 0; known_handling[i]; ++i)
                        if (strcmpi_eq(known_handling[i], bufp)) {
                            if (tmpsp)
                                tmpsp.handling = i;
                            break; /* for loop */
                        }
                    break;
                case 3:
                    /* description:something */
                    tmpsp = lastsp; /* most recent symset */
                    if (tmpsp && !tmpsp.desc)
                        tmpsp.desc = bufp;
                    break;
                case 5:
                    /* restrictions: xxxx*/
                    tmpsp = lastsp; /* most recent symset */
                    for (i = 0; known_restrictions[i]; ++i) {
                        if (strcmpi_eq(known_restrictions[i], bufp)) {
                            if (tmpsp) {
                                switch (i) {
                                case 0:
                                    tmpsp.primary = 1;
                                    break;
                                case 1:
                                    tmpsp.rogue = 1;
                                    break;
                                }
                            }
                            break; /* while loop */
                        }
                    }
                    break;
                }
            }
            return 1;
        }
        if (symp.range && symp.range === SYM_CONTROL) {
            switch (symp.idx) {
            case 0:
                /* start of symset */
                if (strcmpi_eq(bufp, gs.symset[which_set].name)) {
                    /* matches desired one */
                    gc.chosen_symset_start = true;
                    /* these init_*() functions clear symset fields too */
                    if (which_set === ROGUESET)
                        init_rogue_symbols();
                    else if (which_set === PRIMARYSET)
                        init_primary_symbols();
                }
                break;
            case 1:
                /* finish symset */
                if (gc.chosen_symset_start)
                    gc.chosen_symset_end = true;
                gc.chosen_symset_start = false;
                break;
            case 2:
                /* handler type identified */
                if (gc.chosen_symset_start)
                    set_symhandling(bufp, which_set);
                break;
            /* case 3: (description) is ignored here */
            case 4: /* color:off */
                if (gc.chosen_symset_start) {
                    if (bufp) {
                        if (strcmpi_eq(bufp, "true") || strcmpi_eq(bufp, "yes")
                            || strcmpi_eq(bufp, "on"))
                            gs.symset[which_set].nocolor = 0;
                        else if (strcmpi_eq(bufp, "false")
                                 || strcmpi_eq(bufp, "no")
                                 || strcmpi_eq(bufp, "off"))
                            gs.symset[which_set].nocolor = 1;
                    }
                }
                break;
            case 5: /* restrictions: xxxx*/
                if (gc.chosen_symset_start) {
                    let n = 0;

                    while (known_restrictions[n]) {
                        if (strcmpi_eq(known_restrictions[n], bufp)) {
                            switch (n) {
                            case 0:
                                gs.symset[which_set].primary = 1;
                                break;
                            case 1:
                                gs.symset[which_set].rogue = 1;
                                break;
                            }
                            break; /* while loop */
                        }
                        n++;
                    }
                }
                break;
            }
        } else {
            /* Not SYM_CONTROL */
            if (gs.symset[which_set].handling !== H_UTF8) {
                if (gc.chosen_symset_start) {
                    val = sym_val(bufp);
                    if (which_set === PRIMARYSET) {
                        update_primary_symset(symp, val);
                    } else if (which_set === ROGUESET) {
                        update_rogue_symset(symp, val);
                    }
                }
            } else {
                /* ENHANCED_SYMBOLS */
                if (gc.chosen_symset_start) {
                    nyi.glyphrep_to_custom_map_entries(buf, glyph);
                }
            }
        }
    } else if (gc.chosen_symset_start) {
        /* glyph, not symbol */
        nyi.glyphrep_to_custom_map_entries(buf, glyph);
    }
    return 1;
}

// C ref: symbols.c:673 load_symset() — bundle the common usage into one call.
export function load_symset(s, which_set) {
    clear_symsetentry(which_set, true);

    gs.symset[which_set].name = s;

    if (read_sym_file(which_set)) {
        switch_symbols(true);
        nyi.apply_customizations(gc.currentgraphics,
                             do_custom_symbols | do_custom_colors);
    } else {
        clear_symsetentry(which_set, true);
        return 0;
    }
    return 1;
}

// C ref: symbols.c:693 free_symsets()
export function free_symsets() {
    clear_symsetentry(PRIMARYSET, true);
    clear_symsetentry(ROGUESET, true);

    /* symset_list is cleaned up as soon as it's used, so we shouldn't
       have to anything about it here */
}

/* symbols.c:701 struct _savedsym { name, val, which_set, next } */
export let saved_symbols = null;

// C ref: symbols.c:712 savedsym_free()
export function savedsym_free() {
    let tmp = saved_symbols, tmp2;

    while (tmp) {
        tmp2 = tmp.next;
        tmp = tmp2;
    }
    /* C frees each node but leaves saved_symbols dangling; keep that so a
       caller sees the same post-state (options.c only calls this at exit). */
}

// C ref: symbols.c:726 savedsym_find() — staticfn in C.
export function savedsym_find(name, which_set) {
    let tmp = saved_symbols;

    while (tmp) {
        if (which_set === tmp.which_set && name === tmp.name)
            return tmp;
        tmp = tmp.next;
    }
    return null;
}

// C ref: symbols.c:739 savedsym_add() — staticfn in C.  Newest node goes to the
// head, so savedsym_strbuf() writes the SYMBOLS lines back in reverse order.
export function savedsym_add(name, val, which_set) {
    let tmp = savedsym_find(name, which_set);

    if (tmp) {
        tmp.val = val;
    } else {
        tmp = { name, val, which_set, next: saved_symbols };
        saved_symbols = tmp;
    }
}

// C ref: symbols.c:757 savedsym_strbuf() — dump the SYMBOLS lines for a
// config-file rewrite.
export function savedsym_strbuf(sbuf) {
    let tmp = saved_symbols;

    /* C appends through strbuf_append(); hacklib.c's strbuf has no JS port, so
       the accumulator is a plain {str} here. */
    while (tmp) {
        const buf = `${(tmp.which_set === ROGUESET) ? "ROGUE" : ""}SYMBOLS=`
                    + `${tmp.name}:${tmp.val}\n`;
        sbuf.str = (sbuf.str || '') + buf;
        tmp = tmp.next;
    }
}

// C ref: symbols.c:851 match_sym().  options.js holds the tree's only port of
// that C name, but its LOADSYMS table carries no idx and parse_sym_line() needs
// symp->idx, so the entry it finds is resolved against loadsyms[] by name here.
// Names are unique across loadsyms[], so this is exact.
function match_sym_loadsyms(buf) {
    const sp = match_sym(buf);
    if (!sp)
        return null;
    return loadsyms.find((e) => e.name === sp.name) || null;
}

// C ref: symbols.c:909 do_symset() — options.c's 'symset'/'roguesymset' menu.
// async because select_menu()/pline() are async in this port; C's is int.
export async function do_symset(rogueflag) {
    let tmpwin;
    const any = { a_int: 0 };
    let n;
    let buf;
    let symset_pick = null;
    let ready_to_switch = false, nothing_to_do = false;
    let symset_name, fmtstr;
    let sl;
    let res, which_set, setcount = 0, chosen = -2, defindx = 0;
    const clr = NO_COLOR;

    which_set = rogueflag ? ROGUESET : PRIMARYSET;
    gs.symset_list = null;
    /* clear symset[].name as a flag to read_sym_file() to build list */
    symset_name = gs.symset[which_set].name;
    gs.symset[which_set].name = null;

    res = nyi.read_sym_file(which_set);
    /* put symset name back */
    gs.symset[which_set].name = symset_name;

    if (res && gs.symset_list) {
        let thissize,
            biggest = "Default Symbols".length,
            big_desc = 0;

        for (sl = gs.symset_list; sl; sl = sl.next) {
            /* check restrictions */
            if (rogueflag ? sl.primary : sl.rogue)
                continue;
            /* !MAC_GRAPHICS_ENV */
            if (sl.handling === H_MAC)
                continue;
            /* ENHANCED_SYMBOLS is defined, so H_UTF8 sets are NOT skipped */
            setcount++;
            /* find biggest name */
            thissize = sl.name ? sl.name.length : 0;
            if (thissize > biggest)
                biggest = thissize;
            thissize = sl.desc ? sl.desc.length : 0;
            if (thissize > big_desc)
                big_desc = thissize;
        }
        if (!setcount) {
            nyi.There(`are no appropriate ${rogueflag ? "rogue level" : "primary"}`
                  + ` symbol sets available.`);
            return true;
        }

        fmtstr = biggest + 2; /* C: Sprintf(fmtstr, "%%-%ds %%s", biggest + 2) */
        tmpwin = nyi.create_nhwindow(NHW_MENU);
        nyi.start_menu(tmpwin, MENU_BEHAVE_STANDARD);
        any.a_int = 1; /* -1 + 2 [see 'if (sl->name) {' below]*/
        if (!symset_name)
            defindx = any.a_int;
        nyi.add_menu(tmpwin, null, any, 0, 0, ATR_NONE,
                 clr, "Default Symbols",
                 (any.a_int === defindx) ? MENU_ITEMFLAGS_SELECTED
                                         : MENU_ITEMFLAGS_NONE);

        for (sl = gs.symset_list; sl; sl = sl.next) {
            /* check restrictions */
            if (rogueflag ? sl.primary : sl.rogue)
                continue;
            if (sl.handling === H_MAC)
                continue;
            if (sl.name) {
                /* +2: sl->idx runs from 0 to N-1 for N symsets;
                   +1 because Defaults are implicitly in slot [0];
                   +1 again so that valid data is never 0 */
                any.a_int = sl.idx + 2;
                if (symset_name && strcmpi_eq(sl.name, symset_name))
                    defindx = any.a_int;
                buf = sl.name.padEnd(fmtstr) + ' ' + (sl.desc ? sl.desc : "");
                nyi.add_menu(tmpwin, null, any, 0, 0,
                         ATR_NONE, clr, buf,
                         (any.a_int === defindx) ? MENU_ITEMFLAGS_SELECTED
                                                 : MENU_ITEMFLAGS_NONE);
            }
        }
        buf = `Select ${rogueflag ? "rogue level " : ""}symbol set:`;
        nyi.end_menu(tmpwin, buf);
        symset_pick = [];
        n = await nyi.select_menu(tmpwin, PICK_ONE, symset_pick);
        if (n > 0) {
            chosen = symset_pick[0].item.a_int;
            /* if picking non-preselected entry yields 2, make sure
               that we're going with the non-preselected one */
            if (n === 2 && chosen === defindx)
                chosen = symset_pick[1].item.a_int;
            chosen -= 2; /* convert menu index to symset index;
                          * "Default symbols" have index -1 */
        } else if (n === 0 && defindx > 0) {
            chosen = defindx - 2;
        }
        nyi.destroy_nhwindow(tmpwin);

        if (chosen > -1) {
            /* chose an actual symset name from file */
            for (sl = gs.symset_list; sl; sl = sl.next)
                if (sl.idx === chosen)
                    break;
            if (sl) {
                /* free the now stale attributes */
                clear_symsetentry(which_set, true);

                /* transfer only the name of the symbol set */
                gs.symset[which_set].name = sl.name;
                ready_to_switch = true;
            }
        } else if (chosen === -1) {
            /* explicit selection of defaults */
            /* free the now stale symset attributes */
            clear_symsetentry(which_set, true);
        } else
            nothing_to_do = true;
    } else if (!res) {
        /* The symbols file could not be accessed */
        await nyi.pline(`Unable to access "${SYMBOLS}" file.`);
        return true;
    } else if (!gs.symset_list) {
        /* The symbols file was empty */
        nyi.There(`were no symbol sets found in "${SYMBOLS}".`);
        return true;
    }

    /* clean up */
    while ((sl = gs.symset_list) !== null) {
        gs.symset_list = sl.next;
        sl.name = null;
        sl.desc = null;
    }

    if (nothing_to_do)
        return true;

    /* Set default symbols and clear the handling value */
    if (rogueflag)
        init_rogue_symbols();
    else
        init_primary_symbols();

    if (gs.symset[which_set].name) {
        /* non-default symbols */
        let ok;
        if (!glyphid_cache_status()) {
            nyi.fill_glyphid_cache();
        }
        ok = nyi.read_sym_file(which_set);
        if (glyphid_cache_status()) {
            nyi.free_glyphid_cache();
        }
        if (ok) {
            ready_to_switch = true;
        } else {
            clear_symsetentry(which_set, true);
            return true;
        }
    }

    if (ready_to_switch)
        switch_symbols(true);

    /* C: Is_rogue_level(&u.uz) — const.js's port defaults to game.u.uz */
    if (Is_rogue_level()) {
        if (rogueflag)
            assign_graphics(ROGUESET);
    } else if (!rogueflag)
        assign_graphics(PRIMARYSET);
    nyi.apply_customizations(rogueflag ? ROGUESET : PRIMARYSET,
                         do_custom_symbols | do_custom_colors);
    nyi.preference_update("symset");
    return true;
}

/*symbols.c*/
