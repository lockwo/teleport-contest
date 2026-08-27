// glyphs.js — port of src/glyphs.c (NetHack 5.0): the symbol/colour
// customization layer behind SYMBOLS= and OPTIONS=symset:.
//
// STATUS: INERT.  Nothing in the tree imports this module.  Symset handling
// currently lives scattered across js/const.js, js/display.js, js/doset.js and
// js/symbols.js (itself inert); wiring any of this in would change the
// character and colour of every map cell on every scored screen, so it has to
// be measured one call site at a time.
//
// Two clusters glyphs.c reads live in OTHER C files and have no JS owner yet,
// so they are declared here rather than imported:
//   * glyphmap[MAX_GLYPH]  — display.c's array (lazy: MAX_GLYPH is 9624).
//   * sym_customizations   — decl.c's gs.sym_customizations[][]; symbols.js's
//     `gs` predates this file and has no such field.  Wiring means moving this
//     onto that `gs`, not growing a second copy.
//
// NOT an ATR_* consumer: the only wintype.h/color.h scalar glyphs.c uses is
// NH_BASIC_COLOR, declared below with color.h's real value.  (js/wintty.js:38
// has a private NH_BASIC_COLOR = 1; do not reuse it here.)

import { BUFSZ, QBUFSZ, WARNCOUNT, NH_BASIC_COLOR, TRAPNUM,
         PRIMARYSET, ROGUESET, SYM_PCHAR, SYM_OC, SYM_MON } from './const.js';
import { CLR_BLACK } from './terminal.js';
import {
    loadsyms, gs, gc, MAXPCHARS,
    S_stone, S_vwall, S_trwall, S_ndoor, S_brdnladder, S_altar, S_grave,
    S_arrow_trap, S_vbeam, S_digbeam, S_goodpos, S_sw_tl, S_sw_br,
    S_expl_tl, S_expl_br,
} from './symbols.js';
import {
    objects, CORPSE, STATUE, SCR_BLANK_PAPER, SPE_BLANK_PAPER, SLIME_MOLD,
    SCR_ENCHANT_ARMOR, POT_WATER, WAN_LIGHT, WAN_LIGHTNING, GOLD_PIECE,
} from './mkobj.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
import { NUMMONS } from './disprng.js';
import { monster_by_pmidx } from './makemon.js';
import { rgbstr_to_int32, set_map_customcolor } from './coloratt.js';
import { config_error_add } from './options.js';
import { game } from './gstate.js';

/* onames.h values the recorder build produced; the siblings mkobj.js already
   exports are imported above.  Each is objects[<n>].name. */
const POT_GAIN_ABILITY = 297;   /* "gain ability" */
const RIN_ADORNMENT = 173;      /* "adornment" */
const RIN_PROTECTION_FROM_SHAPE_CHAN = 200; /* "protection from shape changers" */
const LAND_MINE = 243;          /* "land mine" */
const SCR_STINKING_CLOUD = 343; /* "stinking cloud" */
const SCR_MAIL = 364;           /* "mail"; objects.h guards it with
                                   MAIL_STRUCTURES, which glyphs.c requires */
const SPE_DIG = 366;            /* "dig" */
const FIRST_OBJECT = 18;        /* objects.h MARKER(FIRST_OBJECT, LAST_GENERIC+1) */
const NUM_OBJECTS = objects.length;

/* sym.h:125 enum graphics_sets */
const NUM_GRAPHICS = 2, UNICODESET = NUM_GRAPHICS;
/* sym.h:132 enum do_customizations — apply_customizations() ANDs these, so
   they are used as a 2-bit mask even though C declares a plain enum. */
const do_custom_none = 0, do_custom_colors = 1, do_custom_symbols = 2;
/* sym.h:137 enum customization_types */
const custom_none = 0, custom_symbols = 1, custom_ureps = 2,
      custom_nhcolor = 3, custom_count = 4;
/* display.h:346 enum altar_types */
const altar_unaligned = 0, altar_chaotic = 1, altar_neutral = 2,
      altar_lawful = 3, altar_other = 4;
/* display.h:359 */
const NUM_ZAP = 8;
/* sym.h:92-95 */
const MAXTCHARS = TRAPNUM - 1, MAXEXPCHARS = 9;
/* sym.h:174 */
const H_UTF8 = 5;

/* glyphs.c:22 enum reserved_activities */
const res_nothing = 0, res_dump_glyphids = 1, res_fill_cache = 2;
/* glyphs.c:23 enum things_to_find */
const find_nothing = 0, find_pm = 1, find_oc = 2, find_cmap = 3,
      find_glyph = 4;

/* glyphs.c:37 */
const nonzero_black = CLR_BLACK | NH_BASIC_COLOR;

// A cross-file C function with no JS port yet.  These throw rather than no-op
// (same convention as js/symbols.js): a silent no-op would let a wired-up
// caller look correct while quietly skipping C behaviour.
function unported(what) {
    throw new Error(`glyphs.js: ${what} has no JS port yet`);
}
const nyi = {};
nyi.unicode_val = (s) => unported(`utf8map.c unicode_val("${s}")`);
nyi.unicodeval_to_utf8str = (uval, buf, n) =>
    unported(`utf8map.c unicodeval_to_utf8str(${uval})`);
nyi.add_custom_urep_entry = (nm, gi, u32, u8, ws) =>
    unported('utf8map.c add_custom_urep_entry()');
nyi.set_map_u = (gm, u32, u8) => unported('utf8map.c set_map_u()');
nyi.wizcustom_callback = (win, glyphnum, id) =>
    unported('wizcustom.c wizcustom_callback()');

/* hacklib.c dupstr(); alloc()+strcpy in C, a value copy here. */
function dupstr(s) { return String(s ?? ''); }
/* C strcmpi()/strcmp() == 0 */
const strcmpi_eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const strcmp_eq = (a, b) => String(a) === String(b);
/* panic() — js/ has three private copies; this is a fourth by the same rule. */
function panic(msg) { throw new Error(`glyphs.js: ${msg}`); }
/* topten.js's FILE shim: fp is { out: "" }. */
function Fprintf(fp, s) { fp.out += s; }
/* flag.h iflags, on the shared game object (the js/cmd.js idiom). */
function iflags_of() { return game.iflags || (game.iflags = {}); }

// ==========================================================================
// display.h:497 enum glyph_offsets.  Evaluated in the enum's own order so a
// changed NUMMONS/NUM_OBJECTS propagates the way the C enum does.
// ==========================================================================
const GLYPH_MON_OFF = 0;
const GLYPH_MON_MALE_OFF = GLYPH_MON_OFF;
const GLYPH_MON_FEM_OFF = NUMMONS + GLYPH_MON_MALE_OFF;
const GLYPH_PET_OFF = NUMMONS + GLYPH_MON_FEM_OFF;
const GLYPH_PET_MALE_OFF = GLYPH_PET_OFF;
const GLYPH_PET_FEM_OFF = NUMMONS + GLYPH_PET_MALE_OFF;
const GLYPH_INVIS_OFF = NUMMONS + GLYPH_PET_FEM_OFF;
const GLYPH_DETECT_OFF = 1 + GLYPH_INVIS_OFF;
const GLYPH_DETECT_MALE_OFF = GLYPH_DETECT_OFF;
const GLYPH_DETECT_FEM_OFF = NUMMONS + GLYPH_DETECT_MALE_OFF;
const GLYPH_BODY_OFF = NUMMONS + GLYPH_DETECT_FEM_OFF;
const GLYPH_RIDDEN_OFF = NUMMONS + GLYPH_BODY_OFF;
const GLYPH_RIDDEN_MALE_OFF = GLYPH_RIDDEN_OFF;
const GLYPH_RIDDEN_FEM_OFF = NUMMONS + GLYPH_RIDDEN_MALE_OFF;
const GLYPH_OBJ_OFF = NUMMONS + GLYPH_RIDDEN_FEM_OFF;
const GLYPH_CMAP_OFF = NUM_OBJECTS + GLYPH_OBJ_OFF;
const GLYPH_CMAP_STONE_OFF = GLYPH_CMAP_OFF;
const GLYPH_CMAP_MAIN_OFF = 1 + GLYPH_CMAP_STONE_OFF;
const GLYPH_CMAP_MINES_OFF = ((S_trwall - S_vwall) + 1) + GLYPH_CMAP_MAIN_OFF;
const GLYPH_CMAP_GEH_OFF = ((S_trwall - S_vwall) + 1) + GLYPH_CMAP_MINES_OFF;
const GLYPH_CMAP_KNOX_OFF = ((S_trwall - S_vwall) + 1) + GLYPH_CMAP_GEH_OFF;
const GLYPH_CMAP_SOKO_OFF = ((S_trwall - S_vwall) + 1) + GLYPH_CMAP_KNOX_OFF;
const GLYPH_CMAP_A_OFF = ((S_trwall - S_vwall) + 1) + GLYPH_CMAP_SOKO_OFF;
const GLYPH_ALTAR_OFF = ((S_brdnladder - S_ndoor) + 1) + GLYPH_CMAP_A_OFF;
const GLYPH_CMAP_B_OFF = 5 + GLYPH_ALTAR_OFF;
const GLYPH_ZAP_OFF = (S_arrow_trap + MAXTCHARS - S_grave) + GLYPH_CMAP_B_OFF;
const GLYPH_CMAP_C_OFF = (NUM_ZAP << 2) + GLYPH_ZAP_OFF;
const GLYPH_SWALLOW_OFF = ((S_goodpos - S_digbeam) + 1) + GLYPH_CMAP_C_OFF;
const GLYPH_EXPLODE_OFF = (NUMMONS << 3) + GLYPH_SWALLOW_OFF;
const GLYPH_EXPLODE_DARK_OFF = GLYPH_EXPLODE_OFF;
const GLYPH_EXPLODE_NOXIOUS_OFF = MAXEXPCHARS + GLYPH_EXPLODE_DARK_OFF;
const GLYPH_EXPLODE_MUDDY_OFF = MAXEXPCHARS + GLYPH_EXPLODE_NOXIOUS_OFF;
const GLYPH_EXPLODE_WET_OFF = MAXEXPCHARS + GLYPH_EXPLODE_MUDDY_OFF;
const GLYPH_EXPLODE_MAGICAL_OFF = MAXEXPCHARS + GLYPH_EXPLODE_WET_OFF;
const GLYPH_EXPLODE_FIERY_OFF = MAXEXPCHARS + GLYPH_EXPLODE_MAGICAL_OFF;
const GLYPH_EXPLODE_FROSTY_OFF = MAXEXPCHARS + GLYPH_EXPLODE_FIERY_OFF;
const GLYPH_WARNING_OFF = MAXEXPCHARS + GLYPH_EXPLODE_FROSTY_OFF;
const GLYPH_STATUE_OFF = WARNCOUNT + GLYPH_WARNING_OFF;
const GLYPH_STATUE_MALE_OFF = GLYPH_STATUE_OFF;
const GLYPH_STATUE_FEM_OFF = NUMMONS + GLYPH_STATUE_MALE_OFF;
const GLYPH_PILETOP_OFF = NUMMONS + GLYPH_STATUE_FEM_OFF;
const GLYPH_OBJ_PILETOP_OFF = GLYPH_PILETOP_OFF;
const GLYPH_BODY_PILETOP_OFF = NUM_OBJECTS + GLYPH_OBJ_PILETOP_OFF;
const GLYPH_STATUE_MALE_PILETOP_OFF = NUMMONS + GLYPH_BODY_PILETOP_OFF;
const GLYPH_STATUE_FEM_PILETOP_OFF = NUMMONS + GLYPH_STATUE_MALE_PILETOP_OFF;
const GLYPH_UNEXPLORED_OFF = NUMMONS + GLYPH_STATUE_FEM_PILETOP_OFF;
const GLYPH_NOTHING_OFF = GLYPH_UNEXPLORED_OFF + 1;
export const MAX_GLYPH = GLYPH_NOTHING_OFF + 1;

const GLYPH_INVISIBLE = GLYPH_INVIS_OFF;
const GLYPH_UNEXPLORED = GLYPH_UNEXPLORED_OFF;
const GLYPH_NOTHING = GLYPH_NOTHING_OFF;
const NO_GLYPH = MAX_GLYPH;

// display.h:676-978 glyph predicates/accessors.  Macros in C, so they belong
// to no .c file; only the ones glyphs.c expands are here.
const glyph_is_cmap_main = (g) =>
    g >= GLYPH_CMAP_MAIN_OFF && g < ((S_trwall - S_vwall) + 1) + GLYPH_CMAP_MAIN_OFF;
const glyph_is_cmap_mines = (g) =>
    g >= GLYPH_CMAP_MINES_OFF && g < ((S_trwall - S_vwall) + 1) + GLYPH_CMAP_MINES_OFF;
const glyph_is_cmap_gehennom = (g) =>
    g >= GLYPH_CMAP_GEH_OFF && g < ((S_trwall - S_vwall) + 1) + GLYPH_CMAP_GEH_OFF;
const glyph_is_cmap_knox = (g) =>
    g >= GLYPH_CMAP_KNOX_OFF && g < ((S_trwall - S_vwall) + 1) + GLYPH_CMAP_KNOX_OFF;
const glyph_is_cmap_sokoban = (g) =>
    g >= GLYPH_CMAP_SOKO_OFF && g < ((S_trwall - S_vwall) + 1) + GLYPH_CMAP_SOKO_OFF;
const glyph_is_cmap_a = (g) =>
    g >= GLYPH_CMAP_A_OFF && g < ((S_brdnladder - S_ndoor) + 1) + GLYPH_CMAP_A_OFF;
const glyph_is_cmap_altar = (g) =>
    g >= GLYPH_ALTAR_OFF && g < 5 + GLYPH_ALTAR_OFF;
const glyph_is_cmap_b = (g) =>
    g >= GLYPH_CMAP_B_OFF
    && g < (S_arrow_trap + MAXTCHARS - S_grave) + GLYPH_CMAP_B_OFF;
const glyph_is_cmap_zap = (g) =>
    g >= GLYPH_ZAP_OFF && g < (NUM_ZAP << 2) + GLYPH_ZAP_OFF;
const glyph_is_cmap_c = (g) =>
    g >= GLYPH_CMAP_C_OFF && g < ((S_goodpos - S_digbeam) + 1) + GLYPH_CMAP_C_OFF;
const glyph_is_swallow = (g) =>
    g >= GLYPH_SWALLOW_OFF && g < (NUMMONS << 3) + GLYPH_SWALLOW_OFF;
const glyph_is_explosion = (g) =>
    g >= GLYPH_EXPLODE_OFF && g < MAXEXPCHARS + GLYPH_EXPLODE_FROSTY_OFF;
/* display.h:722 — the coarse range test, not the precise #if 0 disjunction */
const glyph_is_cmap = (g) =>
    g >= GLYPH_CMAP_STONE_OFF
    && g < GLYPH_CMAP_C_OFF + ((S_goodpos - S_digbeam) + 1);
const glyph_to_swallow = (g) =>
    glyph_is_swallow(g) ? ((g - GLYPH_SWALLOW_OFF) & 0x7) : 0;
const glyph_to_explosion = (g) =>
    glyph_is_explosion(g)
        ? ((g - GLYPH_EXPLODE_OFF) % (S_expl_br - S_expl_tl + 1)) : 0;

const glyph_is_normal_male_monster = (g) =>
    g >= GLYPH_MON_MALE_OFF && g < GLYPH_MON_MALE_OFF + NUMMONS;
const glyph_is_normal_female_monster = (g) =>
    g >= GLYPH_MON_FEM_OFF && g < GLYPH_MON_FEM_OFF + NUMMONS;
const glyph_is_normal_monster = (g) =>
    glyph_is_normal_male_monster(g) || glyph_is_normal_female_monster(g);
const glyph_is_female_pet = (g) =>
    g >= GLYPH_PET_FEM_OFF && g < GLYPH_PET_FEM_OFF + NUMMONS;
const glyph_is_male_pet = (g) =>
    g >= GLYPH_PET_MALE_OFF && g < GLYPH_PET_MALE_OFF + NUMMONS;
const glyph_is_pet = (g) => glyph_is_male_pet(g) || glyph_is_female_pet(g);
const glyph_is_ridden_female_monster = (g) =>
    g >= GLYPH_RIDDEN_FEM_OFF && g < GLYPH_RIDDEN_FEM_OFF + NUMMONS;
const glyph_is_ridden_male_monster = (g) =>
    g >= GLYPH_RIDDEN_MALE_OFF && g < GLYPH_RIDDEN_MALE_OFF + NUMMONS;
const glyph_is_ridden_monster = (g) =>
    glyph_is_ridden_male_monster(g) || glyph_is_ridden_female_monster(g);
const glyph_is_detected_female_monster = (g) =>
    g >= GLYPH_DETECT_FEM_OFF && g < GLYPH_DETECT_FEM_OFF + NUMMONS;
const glyph_is_detected_male_monster = (g) =>
    g >= GLYPH_DETECT_MALE_OFF && g < GLYPH_DETECT_MALE_OFF + NUMMONS;
const glyph_is_detected_monster = (g) =>
    glyph_is_detected_male_monster(g) || glyph_is_detected_female_monster(g);
const glyph_is_monster = (g) =>
    glyph_is_normal_monster(g) || glyph_is_pet(g)
    || glyph_is_ridden_monster(g) || glyph_is_detected_monster(g);
const glyph_is_invisible = (g) => g === GLYPH_INVISIBLE;
/* the final NUMMONS is a legal mons[] index in C (trailing fencepost row) */
const glyph_to_mon = (g) =>
    glyph_is_normal_female_monster(g) ? g - GLYPH_MON_FEM_OFF
    : glyph_is_normal_male_monster(g) ? g - GLYPH_MON_MALE_OFF
    : glyph_is_female_pet(g) ? g - GLYPH_PET_FEM_OFF
    : glyph_is_male_pet(g) ? g - GLYPH_PET_MALE_OFF
    : glyph_is_detected_female_monster(g) ? g - GLYPH_DETECT_FEM_OFF
    : glyph_is_detected_male_monster(g) ? g - GLYPH_DETECT_MALE_OFF
    : glyph_is_ridden_female_monster(g) ? g - GLYPH_RIDDEN_FEM_OFF
    : glyph_is_ridden_male_monster(g) ? g - GLYPH_RIDDEN_MALE_OFF
    : NUMMONS;

const glyph_is_body_piletop = (g) =>
    g >= GLYPH_BODY_PILETOP_OFF && g < GLYPH_BODY_PILETOP_OFF + NUMMONS;
const glyph_is_body = (g) =>
    (g >= GLYPH_BODY_OFF && g < GLYPH_BODY_OFF + NUMMONS)
    || glyph_is_body_piletop(g);
const glyph_is_fem_statue_piletop = (g) =>
    g >= GLYPH_STATUE_FEM_PILETOP_OFF
    && g < GLYPH_STATUE_FEM_PILETOP_OFF + NUMMONS;
const glyph_is_male_statue_piletop = (g) =>
    g >= GLYPH_STATUE_MALE_PILETOP_OFF
    && g < GLYPH_STATUE_MALE_PILETOP_OFF + NUMMONS;
const glyph_is_fem_statue = (g) =>
    (g >= GLYPH_STATUE_FEM_OFF && g < GLYPH_STATUE_FEM_OFF + NUMMONS)
    || glyph_is_fem_statue_piletop(g);
const glyph_is_male_statue = (g) =>
    (g >= GLYPH_STATUE_MALE_OFF && g < GLYPH_STATUE_MALE_OFF + NUMMONS)
    || glyph_is_male_statue_piletop(g);
const glyph_is_statue = (g) =>
    glyph_is_male_statue(g) || glyph_is_fem_statue(g);
const glyph_is_normal_generic_obj = (g) =>
    g > GLYPH_OBJ_OFF && g < GLYPH_OBJ_OFF + FIRST_OBJECT - 1;
const glyph_is_piletop_generic_obj = (g) =>
    g > GLYPH_OBJ_PILETOP_OFF
    && g < GLYPH_OBJ_PILETOP_OFF + FIRST_OBJECT - 1;
const glyph_is_generic_object = (g) =>
    glyph_is_normal_generic_obj(g) || glyph_is_piletop_generic_obj(g);
const glyph_is_normal_piletop_obj = (g) =>
    g === GLYPH_OBJ_PILETOP_OFF
    || (g > GLYPH_OBJ_PILETOP_OFF + FIRST_OBJECT - 1
        && g < GLYPH_OBJ_PILETOP_OFF + NUM_OBJECTS);
const glyph_is_normal_object = (g) =>
    g === GLYPH_OBJ_OFF
    || (g >= GLYPH_OBJ_OFF + FIRST_OBJECT - 1
        && g < GLYPH_OBJ_OFF + NUM_OBJECTS)
    || glyph_is_normal_piletop_obj(g);
const glyph_is_object = (g) =>
    glyph_is_normal_object(g) || glyph_is_generic_object(g)
    || glyph_is_statue(g) || glyph_is_body(g);
const glyph_to_obj = (g) =>
    glyph_is_body(g) ? CORPSE
    : glyph_is_statue(g) ? STATUE
    : glyph_is_generic_object(g)
        ? g - (glyph_is_piletop_generic_obj(g) ? GLYPH_OBJ_PILETOP_OFF
                                               : GLYPH_OBJ_OFF)
    : glyph_is_normal_object(g)
        ? g - (glyph_is_normal_piletop_obj(g) ? GLYPH_OBJ_PILETOP_OFF
                                              : GLYPH_OBJ_OFF)
    : NUM_OBJECTS;
const glyph_to_body_corpsenm = (g) =>
    glyph_is_body_piletop(g) ? g - GLYPH_BODY_PILETOP_OFF
                             : g - GLYPH_BODY_OFF;
const glyph_to_statue_corpsenm = (g) =>
    glyph_is_fem_statue_piletop(g) ? g - GLYPH_STATUE_FEM_PILETOP_OFF
    : glyph_is_male_statue_piletop(g) ? g - GLYPH_STATUE_MALE_PILETOP_OFF
    : glyph_is_fem_statue(g) ? g - GLYPH_STATUE_FEM_OFF
    : glyph_is_male_statue(g) ? g - GLYPH_STATUE_MALE_OFF
    : NO_GLYPH;
const glyph_is_warning = (g) =>
    g >= GLYPH_WARNING_OFF && g < GLYPH_WARNING_OFF + WARNCOUNT;
const glyph_is_unexplored = (g) => g === GLYPH_UNEXPLORED;
const glyph_is_nothing = (g) => g === GLYPH_NOTHING;

// ==========================================================================
// earlyarg.c:628 monsdump[] — the PM_ enum BAREWORDS, not mons[].pmname.
// Transcribed from include/monsters.h with this build's guards applied
// (MAIL_STRUCTURES on; CHARON, the "#if 0 DEFERRED" and the "#if 0 OBSOLETE"
// entries off) -> exactly NUMMONS rows, in js/makemon.js's pmidx order, plus
// the five UNPREFIXED_COUNT tail rows C appends.
//
// The bareword is NOT interchangeable with the display name: rows 261-263 are
// HUMAN_WERERAT/HUMAN_WEREJACKAL/HUMAN_WEREWOLF where mons[].pmname is
// "wererat"/"werejackal"/"werewolf", so deriving these from a name table would
// mis-key three glyph IDs.
const monsdump_nm = [
    "GIANT_ANT", "KILLER_BEE", "SOLDIER_ANT", "FIRE_ANT", "GIANT_BEETLE",
    "QUEEN_BEE", "ACID_BLOB", "QUIVERING_BLOB", "GELATINOUS_CUBE",
    "CHICKATRICE", "COCKATRICE", "PYROLISK", "JACKAL", "FOX", "COYOTE",
    "WEREJACKAL", "LITTLE_DOG", "DINGO", "DOG", "LARGE_DOG", "WOLF",
    "WEREWOLF", "WINTER_WOLF_CUB", "WARG", "WINTER_WOLF", "HELL_HOUND_PUP",
    "HELL_HOUND", "GAS_SPORE", "FLOATING_EYE", "FREEZING_SPHERE",
    "FLAMING_SPHERE", "SHOCKING_SPHERE", "KITTEN", "HOUSECAT", "JAGUAR",
    "LYNX", "PANTHER", "LARGE_CAT", "TIGER", "DISPLACER_BEAST", "GREMLIN",
    "GARGOYLE", "WINGED_GARGOYLE", "HOBBIT", "DWARF", "BUGBEAR",
    "DWARF_LEADER", "DWARF_RULER", "MIND_FLAYER", "MASTER_MIND_FLAYER",
    "MANES", "HOMUNCULUS", "IMP", "LEMURE", "QUASIT", "TENGU", "BLUE_JELLY",
    "SPOTTED_JELLY", "OCHRE_JELLY", "KOBOLD", "LARGE_KOBOLD", "KOBOLD_LEADER",
    "KOBOLD_SHAMAN", "LEPRECHAUN", "SMALL_MIMIC", "LARGE_MIMIC",
    "GIANT_MIMIC", "WOOD_NYMPH", "WATER_NYMPH", "MOUNTAIN_NYMPH", "GOBLIN",
    "HOBGOBLIN", "ORC", "HILL_ORC", "MORDOR_ORC", "URUK_HAI", "ORC_SHAMAN",
    "ORC_CAPTAIN", "ROCK_PIERCER", "IRON_PIERCER", "GLASS_PIERCER", "ROTHE",
    "MUMAK", "LEOCROTTA", "WUMPUS", "TITANOTHERE", "BALUCHITHERIUM",
    "MASTODON", "SEWER_RAT", "GIANT_RAT", "RABID_RAT", "WERERAT", "ROCK_MOLE",
    "WOODCHUCK", "CAVE_SPIDER", "CENTIPEDE", "GIANT_SPIDER", "SCORPION",
    "LURKER_ABOVE", "TRAPPER", "PONY", "WHITE_UNICORN", "GRAY_UNICORN",
    "BLACK_UNICORN", "HORSE", "WARHORSE", "FOG_CLOUD", "DUST_VORTEX",
    "ICE_VORTEX", "ENERGY_VORTEX", "STEAM_VORTEX", "FIRE_VORTEX",
    "BABY_LONG_WORM", "BABY_PURPLE_WORM", "LONG_WORM", "PURPLE_WORM",
    "GRID_BUG", "XAN", "YELLOW_LIGHT", "BLACK_LIGHT", "ZRUTY", "COUATL",
    "ALEAX", "ANGEL", "KI_RIN", "ARCHON", "BAT", "GIANT_BAT", "RAVEN",
    "VAMPIRE_BAT", "PLAINS_CENTAUR", "FOREST_CENTAUR", "MOUNTAIN_CENTAUR",
    "BABY_GRAY_DRAGON", "BABY_GOLD_DRAGON", "BABY_SILVER_DRAGON",
    "BABY_RED_DRAGON", "BABY_WHITE_DRAGON", "BABY_ORANGE_DRAGON",
    "BABY_BLACK_DRAGON", "BABY_BLUE_DRAGON", "BABY_GREEN_DRAGON",
    "BABY_YELLOW_DRAGON", "GRAY_DRAGON", "GOLD_DRAGON", "SILVER_DRAGON",
    "RED_DRAGON", "WHITE_DRAGON", "ORANGE_DRAGON", "BLACK_DRAGON",
    "BLUE_DRAGON", "GREEN_DRAGON", "YELLOW_DRAGON", "STALKER",
    "AIR_ELEMENTAL", "FIRE_ELEMENTAL", "EARTH_ELEMENTAL", "WATER_ELEMENTAL",
    "LICHEN", "BROWN_MOLD", "YELLOW_MOLD", "GREEN_MOLD", "RED_MOLD",
    "SHRIEKER", "VIOLET_FUNGUS", "GNOME", "GNOME_LEADER", "GNOMISH_WIZARD",
    "GNOME_RULER", "GIANT", "STONE_GIANT", "HILL_GIANT", "FIRE_GIANT",
    "FROST_GIANT", "ETTIN", "STORM_GIANT", "TITAN", "MINOTAUR", "JABBERWOCK",
    "KEYSTONE_KOP", "KOP_SERGEANT", "KOP_LIEUTENANT", "KOP_KAPTAIN", "LICH",
    "DEMILICH", "MASTER_LICH", "ARCH_LICH", "KOBOLD_MUMMY", "GNOME_MUMMY",
    "ORC_MUMMY", "DWARF_MUMMY", "ELF_MUMMY", "HUMAN_MUMMY", "ETTIN_MUMMY",
    "GIANT_MUMMY", "RED_NAGA_HATCHLING", "BLACK_NAGA_HATCHLING",
    "GOLDEN_NAGA_HATCHLING", "GUARDIAN_NAGA_HATCHLING", "RED_NAGA",
    "BLACK_NAGA", "GOLDEN_NAGA", "GUARDIAN_NAGA", "OGRE", "OGRE_LEADER",
    "OGRE_TYRANT", "GRAY_OOZE", "BROWN_PUDDING", "GREEN_SLIME",
    "BLACK_PUDDING", "QUANTUM_MECHANIC", "GENETIC_ENGINEER", "RUST_MONSTER",
    "DISENCHANTER", "GARTER_SNAKE", "SNAKE", "WATER_MOCCASIN", "PYTHON",
    "PIT_VIPER", "COBRA", "TROLL", "ICE_TROLL", "ROCK_TROLL", "WATER_TROLL",
    "OLOG_HAI", "UMBER_HULK", "VAMPIRE", "VAMPIRE_LEADER", "VLAD_THE_IMPALER",
    "BARROW_WIGHT", "WRAITH", "NAZGUL", "XORN", "MONKEY", "APE", "OWLBEAR",
    "YETI", "CARNIVOROUS_APE", "SASQUATCH", "KOBOLD_ZOMBIE", "GNOME_ZOMBIE",
    "ORC_ZOMBIE", "DWARF_ZOMBIE", "ELF_ZOMBIE", "HUMAN_ZOMBIE",
    "ETTIN_ZOMBIE", "GHOUL", "GIANT_ZOMBIE", "SKELETON", "STRAW_GOLEM",
    "PAPER_GOLEM", "ROPE_GOLEM", "GOLD_GOLEM", "LEATHER_GOLEM", "WOOD_GOLEM",
    "FLESH_GOLEM", "CLAY_GOLEM", "STONE_GOLEM", "GLASS_GOLEM", "IRON_GOLEM",
    "HUMAN", "HUMAN_WERERAT", "HUMAN_WEREJACKAL", "HUMAN_WEREWOLF", "ELF",
    "WOODLAND_ELF", "GREEN_ELF", "GREY_ELF", "ELF_NOBLE", "ELVEN_MONARCH",
    "DOPPELGANGER", "SHOPKEEPER", "GUARD", "PRISONER", "ORACLE",
    "ALIGNED_CLERIC", "HIGH_CLERIC", "SOLDIER", "SERGEANT", "NURSE",
    "LIEUTENANT", "CAPTAIN", "WATCHMAN", "WATCH_CAPTAIN", "MEDUSA",
    "WIZARD_OF_YENDOR", "CROESUS", "GHOST", "SHADE", "WATER_DEMON",
    "AMOROUS_DEMON", "HORNED_DEVIL", "ERINYS", "BARBED_DEVIL", "MARILITH",
    "VROCK", "HEZROU", "BONE_DEVIL", "ICE_DEVIL", "NALFESHNEE", "PIT_FIEND",
    "SANDESTIN", "BALROG", "JUIBLEX", "YEENOGHU", "ORCUS", "GERYON",
    "DISPATER", "BAALZEBUB", "ASMODEUS", "DEMOGORGON", "DEATH", "PESTILENCE",
    "FAMINE", "MAIL_DAEMON", "DJINNI", "JELLYFISH", "PIRANHA", "SHARK",
    "GIANT_EEL", "ELECTRIC_EEL", "KRAKEN", "NEWT", "GECKO", "IGUANA",
    "BABY_CROCODILE", "LIZARD", "CHAMELEON", "CROCODILE", "SALAMANDER",
    "LONG_WORM_TAIL", "ARCHEOLOGIST", "BARBARIAN", "CAVE_DWELLER", "HEALER",
    "KNIGHT", "MONK", "CLERIC", "RANGER", "ROGUE", "SAMURAI", "TOURIST",
    "VALKYRIE", "WIZARD", "LORD_CARNARVON", "PELIAS", "SHAMAN_KARNOV",
    "HIPPOCRATES", "KING_ARTHUR", "GRAND_MASTER", "ARCH_PRIEST", "ORION",
    "MASTER_OF_THIEVES", "LORD_SATO", "TWOFLOWER", "NORN",
    "NEFERET_THE_GREEN", "MINION_OF_HUHETOTL", "THOTH_AMON",
    "CHROMATIC_DRAGON", "CYCLOPS", "IXOTH", "MASTER_KAEN", "NALZOK",
    "SCORPIUS", "MASTER_ASSASSIN", "ASHIKAGA_TAKAUJI", "LORD_SURTUR",
    "DARK_ONE", "STUDENT", "CHIEFTAIN", "NEANDERTHAL", "ATTENDANT", "PAGE",
    "ABBOT", "ACOLYTE", "HUNTER", "THUG", "NINJA", "ROSHI", "GUIDE",
    "WARRIOR", "APPRENTICE", "NUMMONS", "NON_PM", "LOW_PM", "HIGH_PM",
    "SPECIAL_PM",
];

// ==========================================================================
// State glyphs.c shares with other C files but that has no JS owner yet.
// ==========================================================================

/* display.c: glyph_map glyphmap[MAX_GLYPH].  Allocated on first touch —
   MAX_GLYPH is 9624 and this module is inert. */
let glyphmap_storage = null;
export function glyphmap() {
    if (!glyphmap_storage) {
        glyphmap_storage = new Array(MAX_GLYPH);
        for (let i = 0; i < MAX_GLYPH; ++i)
            glyphmap_storage[i] = {
                glyphflags: 0, sym: { color: 0, symidx: 0 },
                customcolor: 0, color256idx: 0, tileidx: 0, u: null,
            };
    }
    return glyphmap_storage;
}

/* decl.h:860 gs.sym_customizations[NUM_GRAPHICS + 1][custom_count].  Kept
   here, not on symbols.js's `gs`, so wiring is one deliberate move. */
export const sym_customizations = [];
for (let ws = 0; ws < NUM_GRAPHICS + 1; ++ws) {
    const row = [];
    for (let ct = 0; ct < custom_count; ++ct)
        row.push({ customization_name: null, count: 0, custtype: custom_none,
                   details: null, details_end: null });
    sym_customizations.push(row);
}

/* glyphs.c:28 struct find_struct + `static const struct find_struct
   zero_find = { 0 }`; a factory because C copies the whole struct. */
function zero_find() {
    return {
        findtype: find_nothing, val: 0, loadsyms_offset: 0, loadsyms_count: 0,
        extraval: null,      /* int * -> a { val } ref */
        color: 0,
        unicode_val: null,   /* "U+NNNN" */
        callback: null,
        restype: res_nothing,
        reserved: null,
    };
}

/* glyphs.c:31 struct glyphid_cache_t *glyphid_cache + its two sizes */
let glyphid_cache = null;
let glyphid_cache_lsize = 0;
let glyphid_cache_size = 0;
/* glyphs.c:36 the two file-static find_structs */
let glyphcache_find = zero_find();
let to_custom_symbol_find = zero_find();

// ==========================================================================
// src/glyphs.c
// ==========================================================================

/* function-static nag counters inside to_custom_symset_entry_callback() */
let glyphnag = 0, colornag = 0;

/* C ref: glyphs.c:53 */
export function to_custom_symset_entry_callback(glyph, findwhat) {
    const idx = gs.symset_which_set;
    const utf8str = [0, 0, 0, 0, 0, 0];
    let uval = 0;

    if (findwhat.extraval)
        findwhat.extraval.val = glyph;

    if (!(idx >= 0 && idx < NUM_GRAPHICS))
        panic('to_custom_symset_entry_callback: bad symset_which_set');
    if (findwhat.unicode_val)
        uval = nyi.unicode_val(findwhat.unicode_val);
    if (uval && nyi.unicodeval_to_utf8str(uval, utf8str, utf8str.length)) {
        /* customizations are affiliated with one symset; with no symset
           context C nags once and drops the entry rather than segfaulting */
        if (gs.symset[idx].name) {
            nyi.add_custom_urep_entry(gs.symset[idx].name, glyph, uval,
                                      utf8str, gs.symset_which_set);
        } else {
            if (!glyphnag++)
                config_error_add('Unimplemented customization feature,'
                                 + ' ignoring for now');
        }
    }
    if (findwhat.color) {
        if (gs.symset[idx].name) {
            add_custom_nhcolor_entry(gs.symset[idx].name, glyph,
                                     findwhat.color, gs.symset_which_set);
        } else {
            if (!colornag++)
                config_error_add('Unimplemented customization feature,'
                                 + ' ignoring for now');
        }
    }
}

/* C ref: glyphs.c:112.  `glyphptr` is C's `int *`: pass a { val } ref.
   Returns 1 on success, 0 on failure. */
export function glyphrep_to_custom_map_entries(op, glyphptr) {
    to_custom_symbol_find = zero_find();
    let c_glyphid, c_unicode, c_colorval, cp;
    let reslt = 0;
    let rgb = 0;
    let slash = false, colon = false;

    /* glyphs.c:119 — a debugger-only assignment; nhUse() discards it */
    if (!glyphid_cache)
        reslt = 1;

    /* Snprintf(buf, sizeof buf, "%s", op) then walk it, NUL-terminating at
       each separator; cp advances PAST the NUL, so the scan sees the whole
       original string and the LAST ':'/'/' wins. */
    const buf = String(op ?? '').slice(0, BUFSZ - 1).split('');
    buf.push('\0');
    const cstr = (start) => {
        let s = '';
        for (let k = start; k < buf.length && buf[k] !== '\0'; k++) s += buf[k];
        return s;
    };
    c_unicode = c_colorval = -1;
    c_glyphid = cp = 0;
    while (buf[cp] !== '\0') {
        if (buf[cp] === ':' || buf[cp] === '/') {
            if (buf[cp] === ':') { colon = true; buf[cp] = '\0'; }
            if (buf[cp] === '/') { slash = true; buf[cp] = '\0'; }
        }
        cp++;
        if (colon) { c_unicode = cp; colon = false; }
        if (slash) { c_colorval = cp; slash = false; }
    }
    /* some sanity checks */
    if (buf[c_glyphid] === ' ')
        c_glyphid++;
    if (c_colorval >= 0 && buf[c_colorval] === ' ')
        c_colorval++;
    if (c_unicode >= 0 && buf[c_unicode] === ' ') {
        while (buf[c_unicode] === ' ')
            c_unicode++;
    }
    if (c_unicode >= 0 && buf[c_unicode] === '\0')
        c_unicode = -1;

    if ((c_colorval >= 0 && (rgb = rgbstr_to_int32(cstr(c_colorval))) !== -1)
        || c_colorval < 0) {
        /* a marker bit outside the 24-bit range distinguishes "colour 0" from
           "not set", so a plain !color test still means "not set" */
        to_custom_symbol_find.color =
            (rgb === -1 || c_colorval < 0) ? 0
            : (rgb === 0) ? nonzero_black : rgb;
    }
    if (c_unicode >= 0)
        to_custom_symbol_find.unicode_val = cstr(c_unicode);
    to_custom_symbol_find.extraval = glyphptr;
    to_custom_symbol_find.callback = to_custom_symset_entry_callback;
    reslt = glyph_find_core(cstr(c_glyphid), to_custom_symbol_find);
    return reslt;
}

/* C ref: glyphs.c:184.  C lowercases in place and returns str. */
export function fix_glyphname(str) {
    let out = '';
    for (const c of String(str)) {
        if (c >= 'A' && c <= 'Z')
            out += c.toLowerCase();
        else if (c >= '0' && c <= '9')
            out += c;
        else if (c < 'a' || c > 'z')
            out += '_';
        else
            out += c;
    }
    return out;
}

/* C ref: glyphs.c:200 */
export function glyph_to_cmap(glyph) {
    if (glyph === GLYPH_CMAP_STONE_OFF)
        return S_stone;
    else if (glyph_is_cmap_main(glyph))
        return (glyph - GLYPH_CMAP_MAIN_OFF) + S_vwall;
    else if (glyph_is_cmap_mines(glyph))
        return (glyph - GLYPH_CMAP_MINES_OFF) + S_vwall;
    else if (glyph_is_cmap_gehennom(glyph))
        return (glyph - GLYPH_CMAP_GEH_OFF) + S_vwall;
    else if (glyph_is_cmap_knox(glyph))
        return (glyph - GLYPH_CMAP_KNOX_OFF) + S_vwall;
    else if (glyph_is_cmap_sokoban(glyph))
        return (glyph - GLYPH_CMAP_SOKO_OFF) + S_vwall;
    else if (glyph_is_cmap_a(glyph))
        return (glyph - GLYPH_CMAP_A_OFF) + S_ndoor;
    else if (glyph_is_cmap_altar(glyph))
        return S_altar;
    else if (glyph_is_cmap_b(glyph))
        return (glyph - GLYPH_CMAP_B_OFF) + S_grave;
    else if (glyph_is_cmap_c(glyph))
        return (glyph - GLYPH_CMAP_C_OFF) + S_digbeam;
    else if (glyph_is_cmap_zap(glyph))
        return ((glyph - GLYPH_ZAP_OFF) % 4) + S_vbeam;
    else if (glyph_is_swallow(glyph))
        return glyph_to_swallow(glyph) + S_sw_tl;
    else if (glyph_is_explosion(glyph))
        return glyph_to_explosion(glyph) + S_expl_tl;
    else
        return MAXPCHARS;   /* legal defsyms[] index: trailing fencepost */
}

/* C ref: glyphs.c:234 */
export function glyph_find_core(id, findwhat) {
    let glyph, do_callback, end_find = false;

    if (parse_id(id, findwhat)) {
        if (findwhat.findtype === find_glyph) {
            findwhat.callback(findwhat.val, findwhat);
        } else {
            for (glyph = 0; glyph < MAX_GLYPH; ++glyph) {
                do_callback = false;
                switch (findwhat.findtype) {
                case find_cmap:
                    if (glyph_to_cmap(glyph) === findwhat.val)
                        do_callback = true;
                    break;
                case find_pm: {
                    /* C: mons[glyph_to_mon(glyph)].mlet is the S_* CLASS
                       index, which js/makemon.js calls .mcls (its .mlet is
                       the display character). */
                    const ptr = glyph_is_monster(glyph)
                                ? monster_by_pmidx(glyph_to_mon(glyph)) : null;
                    if (ptr && ptr.mcls === findwhat.val)
                        do_callback = true;
                    break;
                }
                case find_oc:
                    if (glyph_is_object(glyph)
                        && glyph_to_obj(glyph) === findwhat.val)
                        do_callback = true;
                    break;
                case find_glyph:
                    /* unreachable: handled above */
                    if (glyph === findwhat.val) {
                        do_callback = true;
                        end_find = true;
                    }
                    break;
                case find_nothing:
                default:
                    end_find = true;
                    break;
                }
                if (do_callback)
                    findwhat.callback(glyph, findwhat);
                if (end_find)
                    break;
            }
        }
        return 1;
    }
    return 0;
}

/*
 When we start to process a config file or a symbol file, that might have G_
 entries, generating all 9000+ glyphids for comparison repeatedly each time we
 encounter a G_ entry to decipher is extremely performance-poor, so generate
 them once up front and free them when the bulk parsing is over.
*/

/* C ref: glyphs.c:303 */
export function fill_glyphid_cache() {
    let reslt = 0;

    if (!glyphid_cache) {
        init_glyph_cache();
    }
    if (glyphid_cache) {
        glyphcache_find = zero_find();
        glyphcache_find.findtype = find_nothing;
        glyphcache_find.reserved = glyphid_cache;
        glyphcache_find.restype = res_fill_cache;
        reslt = parse_id(null, glyphcache_find);
        if (!reslt) {
            free_glyphid_cache();
            glyphid_cache = null;
        }
    }
}

/*
 * The glyph ID cache is a simple double-hash table.  The cache size is a power
 * of two and two hashes come out of the ID: the first is a location in the
 * table, the second an offset added on every collision.  The second hash is
 * odd, which is necessary and sufficient to traverse the whole table.
 */

/* C ref: glyphs.c:334 */
export function init_glyph_cache() {
    let glyph;

    /* Cache size of power of 2 not less than 2*MAX_GLYPH */
    glyphid_cache_lsize = 0;
    glyphid_cache_size = 1;
    while (glyphid_cache_size < 2 * MAX_GLYPH) {
        ++glyphid_cache_lsize;
        glyphid_cache_size <<= 1;
    }

    glyphid_cache = new Array(glyphid_cache_size);
    for (glyph = 0; glyph < glyphid_cache_size; ++glyph) {
        glyphid_cache[glyph] = { glyphnum: 0, id: null };
    }
}

/* C ref: glyphs.c:355 */
export function free_glyphid_cache() {
    let idx;

    if (!glyphid_cache)
        return;
    for (idx = 0; idx < glyphid_cache_size; ++idx) {
        if (glyphid_cache[idx].id) {
            glyphid_cache[idx].id = null;
        }
    }
    glyphid_cache = null;
}

/* C ref: glyphs.c:372 */
export function add_glyph_to_cache(glyphnum, id) {
    const hash = glyph_hash(id);
    const hash1 = hash & (glyphid_cache_size - 1);
    const hash2 = ((hash >>> glyphid_cache_lsize) & (glyphid_cache_size - 1)) | 1;
    let i = hash1;

    do {
        if (glyphid_cache[i].id === null) {
            /* Empty bucket found */
            glyphid_cache[i].id = dupstr(id);
            glyphid_cache[i].glyphnum = glyphnum;
            return;
        }
        /* For speed, assume that no ID occurs twice */
        i = (i + hash2) & (glyphid_cache_size - 1);
    } while (i !== hash1);
    /* This should never happen */
    panic('glyphid_cache full');
}

/* C ref: glyphs.c:395 */
export function find_glyph_in_cache(id) {
    const hash = glyph_hash(id);
    const hash1 = hash & (glyphid_cache_size - 1);
    const hash2 = ((hash >>> glyphid_cache_lsize) & (glyphid_cache_size - 1)) | 1;
    let i = hash1;

    do {
        if (glyphid_cache[i].id === null) {
            /* Empty bucket found */
            return -1;
        }
        if (strcmpi_eq(id, glyphid_cache[i].id)) {
            /* Match found */
            return glyphid_cache[i].glyphnum;
        }
        i = (i + hash2) & (glyphid_cache_size - 1);
    } while (i !== hash1);
    return -1;
}

/* C ref: glyphs.c:418 */
export function find_glyphid_in_cache_by_glyphnum(glyphnum) {
    let idx;

    if (!glyphid_cache)
        return null;
    for (idx = 0; idx < glyphid_cache_size; ++idx) {
        if (glyphid_cache[idx].glyphnum === glyphnum
            && glyphid_cache[idx].id !== null) {
            /* Match found */
            return glyphid_cache[idx].id;
        }
    }
    return null;
}

/* C ref: glyphs.c:435.  uint32 rotate-left-1 then xor; the case fold makes it
   agree with the strcmpi() the lookup uses. */
export function glyph_hash(id) {
    let hash = 0;
    const s = String(id);
    let i;

    for (i = 0; i < s.length; ++i) {
        let ch = s.charCodeAt(i);
        if (0x41 /* 'A' */ <= ch && ch <= 0x5a /* 'Z' */) {
            ch += 0x61 - 0x41;
        }
        hash = (((hash << 1) | (hash >>> 31)) ^ ch) >>> 0;
    }
    return hash;
}

/* C ref: glyphs.c:452 */
export function glyphid_cache_status() {
    return glyphid_cache !== null;
}

/* C ref: glyphs.c:458 */
export function match_glyph(buf) {
    /* buf contains a G_ glyph reference, not an S_ symbol.  There could be an
       R-G-B color attached too.  Let's get a copy to work with. */
    const workbuf = String(buf ?? '').slice(0, BUFSZ - 1);
    return glyphrep(workbuf);
}

/* C ref: glyphs.c:470 */
export function glyphrep(op) {
    let reslt = 0;
    const glyph = { val: NO_GLYPH };

    /* debugger-only assignment; nhUse() discards it */
    if (!glyphid_cache)
        reslt = 1;
    reslt = glyphrep_to_custom_map_entries(op, glyph);
    if (reslt)
        return 1;
    return 0;
}

/* C ref: glyphs.c:484 */
export function add_custom_nhcolor_entry(customization_name, glyphidx,
                                         nhcolor, which_set) {
    const gdc = sym_customizations[which_set][custom_nhcolor];
    let details, newdetails = null;

    if (!gdc.details) {
        gdc.customization_name = dupstr(customization_name);
        gdc.custtype = custom_nhcolor;
        gdc.details = null;
        gdc.details_end = null;
    }
    details = find_matching_customization(customization_name,
                                          custom_nhcolor, which_set);
    if (details) {
        while (details) {
            if (details.content.ccolor.glyphidx === glyphidx) {
                details.content.ccolor.nhcolor = nhcolor;
                return 1;
            }
            details = details.next;
        }
    }
    /* create new details entry.  C's union means the urep.glyphidx store and
       the ccolor.nhcolor store land in the same struct; ccolor.glyphidx and
       urep.glyphidx are the same offset. */
    newdetails = {
        content: {
            sym: { symparse: null, val: 0 },
            urep: { glyphidx: glyphidx, u: { utf32ch: 0, utf8str: null } },
            ccolor: { glyphidx: glyphidx, nhcolor: nhcolor },
        },
        next: null,
    };
    if (gdc.details === null) {
        gdc.details = newdetails;
    } else {
        gdc.details_end.next = newdetails;
    }
    gdc.details_end = newdetails;
    gdc.count++;
    return 1;
}

/* C ref: glyphs.c:531 */
export function apply_customizations(which_set, docustomize) {
    const iflags = iflags_of();
    let gmap, details, sc;
    let at_least_one = false;
    const do_colors = (docustomize & do_custom_colors) !== 0,
          do_symbols = (docustomize & do_custom_symbols) !== 0;
    let custs;

    for (custs = 0; custs < custom_count; ++custs) {
        sc = sym_customizations[which_set][custs];
        if (sc.count && sc.details) {
            at_least_one = true;
            /* These glyph customizations get applied to the glyphmap array,
               not to symset entries */
            details = sc.details;
            while (details) {
                if (iflags.customsymbols && do_symbols) {
                    if (sc.custtype === custom_ureps) {
                        gmap = glyphmap()[details.content.urep.glyphidx];
                        if (gs.symset[which_set].handling === H_UTF8)
                            nyi.set_map_u(gmap,
                                          details.content.urep.u.utf32ch,
                                          details.content.urep.u.utf8str);
                    }
                }
                if (iflags.customcolors && do_colors) {
                    if (sc.custtype === custom_nhcolor) {
                        gmap = glyphmap()[details.content.ccolor.glyphidx];
                        set_map_customcolor(gmap,
                                            details.content.ccolor.nhcolor);
                    }
                }
                details = details.next;
            }
        }
    }
    iflags.pending_customizations = at_least_one;
}

/* Shuffle the customizations to match shuffled object descriptions, so a red
 * potion isn't displayed with a blue customization, and so on.
 */

/* C ref: glyphs.c:581 */
export function maybe_shuffle_customizations() {
    const iflags = iflags_of();

    if (iflags.pending_customizations) {
        shuffle_customizations();
        iflags.pending_customizations = 0;
    }
}

/* C ref: glyphs.c:646 — the live #else body.  glyphs.c:591 holds an older
   #if 0 variant that moves only the unicode_representation pointers. */
export function shuffle_customizations() {
    const offsets = [GLYPH_OBJ_OFF, GLYPH_OBJ_PILETOP_OFF];
    const gm = glyphmap();
    let j;

    for (j = 0; j < offsets.length; j++) {
        const base = offsets[j];              /* glyph_map *obj_glyphs */
        const obj_glyphs = (k) => gm[base + k];
        let i;
        const tmp_u = new Array(NUM_OBJECTS).fill(null);
        const tmp_customcolor = new Array(NUM_OBJECTS).fill(0);
        const tmp_color256idx = new Array(NUM_OBJECTS).fill(0);
        const duplicate = new Array(NUM_OBJECTS).fill(-1);

        for (i = 0; i < NUM_OBJECTS; i++) {
            /* mkobj.js's objects[] omits the field until js/o_init.js:136
               (`o.oc_descr_idx = o.oc_name_idx = i`) runs; C's init_objects()
               always seeds it with i, so fall back the way apply.js does. */
            const idx = objects[i].oc_descr_idx ?? i;

            /*
             * Shuffling gem appearances can cause the same oc_descr_idx to
             * appear more than once.  Detect this condition and ensure that
             * each pointer points to a unique allocation.
             */
            if (duplicate[idx] >= 0) {
                /* Current structure already appears in tmp_u */
                const other = tmp_u[duplicate[idx]];
                const other_customcolor = tmp_customcolor[duplicate[idx]];
                const other_color256idx = tmp_color256idx[duplicate[idx]];

                tmp_customcolor[i] = other_customcolor;
                tmp_color256idx[i] = other_color256idx;
                if (other) {
                    tmp_u[i] = { utf32ch: other.utf32ch, utf8str: null };
                    if (other.utf8str !== null) {
                        tmp_u[i].utf8str = dupstr(other.utf8str);
                    }
                }
            } else {
                tmp_customcolor[i] = obj_glyphs(idx).customcolor;
                tmp_color256idx[i] = obj_glyphs(idx).color256idx;
                tmp_u[i] = obj_glyphs(idx).u;
                if (obj_glyphs(idx).u !== null
                    || obj_glyphs(idx).customcolor !== 0) {
                    duplicate[idx] = i;
                    obj_glyphs(idx).u = null;
                    obj_glyphs(idx).customcolor = 0;
                    obj_glyphs(idx).color256idx = 0;
                }
            }
        }
        for (i = 0; i < NUM_OBJECTS; i++) {
            /* Some glyphmaps may not have been transferred */
            obj_glyphs(i).u = tmp_u[i];
            obj_glyphs(i).customcolor = tmp_customcolor[i];
            obj_glyphs(i).color256idx = tmp_color256idx[i];
        }
    }
}

/* C ref: glyphs.c:736 */
export function find_matching_customization(customization_name, custtype,
                                            which_set) {
    const gdc = sym_customizations[which_set][custtype];

    if (gdc.custtype === custtype && gdc.customization_name
        && strcmp_eq(customization_name, gdc.customization_name))
        return gdc.details;
    return null;
}

/* C ref: glyphs.c:751 */
export function purge_all_custom_entries() {
    let i;

    for (i = 0; i < NUM_GRAPHICS + 1; ++i) {
        purge_custom_entries(i);
    }
}

/* C ref: glyphs.c:761 */
export function purge_custom_entries(which_set) {
    let custtype, gdc, details, next;

    for (custtype = custom_none; custtype < custom_count; ++custtype) {
        gdc = sym_customizations[which_set][custtype];
        details = gdc.details;
        while (details) {
            next = details.next;
            if (gdc.custtype === custom_ureps) {
                details.content.urep.u.utf8str = null;
            } else if (gdc.custtype === custom_symbols) {
                details.content.sym.symparse = null;
                details.content.sym.val = 0;
            } else if (gdc.custtype === custom_nhcolor) {
                details.content.ccolor.nhcolor = 0;
                details.content.ccolor.glyphidx = 0;
            }
            details = next;
        }
        gdc.details = null;
        gdc.details_end = null;
        if (gdc.customization_name) {
            gdc.customization_name = null;
        }
        gdc.count = 0;
    }
}

/* C ref: glyphs.c:797.  `fp` is js/topten.js's FILE shim: { out: "" }. */
export function dump_all_glyphids(fp) {
    const dump_glyphid_find = zero_find();

    dump_glyphid_find.findtype = find_nothing;
    dump_glyphid_find.reserved = fp;
    dump_glyphid_find.restype = res_dump_glyphids;
    parse_id(null, dump_glyphid_find);
}

/* C ref: glyphs.c:808 */
export function wizcustom_glyphids(win) {
    let glyphnum, id;

    if (!glyphid_cache)
        return;
    for (glyphnum = 0; glyphnum < MAX_GLYPH; ++glyphnum) {
        id = find_glyphid_in_cache_by_glyphnum(glyphnum);
        if (id) {
            nyi.wizcustom_callback(win, glyphnum, id);
        }
    }
}

/* C ref: glyphs.c:824.  Returns 1 when findwhat was filled in, else 0. */
export function parse_id(id, findwhat) {
    let fp = null;
    let i = 0, j, mnum, glyph,
        pm_offset = 0, oc_offset = 0, cmap_offset = 0,
        pm_count = 0, oc_count = 0, cmap_count = 0;
    let skip_base = false, skip_this_one = false, dump_ids = false,
        filling_cache = false, is_S = false, is_G = false;
    const buf = ['', '', '', ''];

    if (findwhat.findtype === find_nothing && findwhat.restype) {
        if (findwhat.restype === res_dump_glyphids) {
            if (findwhat.reserved) {
                fp = findwhat.reserved;
                dump_ids = true;
            } else {
                return 0;
            }
        }
        if (findwhat.restype === res_fill_cache) {
            if (findwhat.reserved && findwhat.reserved === glyphid_cache) {
                filling_cache = true;
            } else {
                return 0;
            }
        }
    }

    /* C tests the POINTER for NULL, so `id != null`, not JS truthiness: an
       empty id would take the other branch. */
    is_G = id != null && id[0] === 'G' && id[1] === '_';
    is_S = id != null && id[0] === 'S' && id[1] === '_';

    if ((is_G && !glyphid_cache) || filling_cache || dump_ids || is_S) {
        while (loadsyms[i].range) {
            if (!pm_offset && loadsyms[i].range === SYM_MON)
                pm_offset = i;
            if (!pm_count && pm_offset && loadsyms[i].range !== SYM_MON)
                pm_count = i - pm_offset;
            if (!oc_offset && loadsyms[i].range === SYM_OC)
                oc_offset = i;
            if (!oc_count && oc_offset && loadsyms[i].range !== SYM_OC)
                oc_count = i - oc_offset;
            if (!cmap_offset && loadsyms[i].range === SYM_PCHAR)
                cmap_offset = i;
            if (!cmap_count && cmap_offset && loadsyms[i].range !== SYM_PCHAR)
                cmap_count = i - cmap_offset;
            i++;
        }
    }
    if (is_G || filling_cache || dump_ids) {
        if (!filling_cache && id != null && glyphid_cache) {
            const val = find_glyph_in_cache(id);
            if (val >= 0) {
                findwhat.findtype = find_glyph;
                findwhat.val = val;
                findwhat.loadsyms_offset = 0;
                return 1;
            } else {
                return 0;
            }
        } else {
            let buf2, buf3, buf4;

            /* individual matching glyph entries */
            for (glyph = 0; glyph < MAX_GLYPH; ++glyph) {
                skip_base = false;
                skip_this_one = false;
                buf[0] = buf[1] = buf[2] = buf[3] = '';
                if (glyph_is_monster(glyph)) {
                    /* buf2 will hold the distinguishing prefix */
                    /* buf3 will hold the base name */
                    buf2 = "";
                    buf3 = monsdump_nm[glyph_to_mon(glyph)];

                    if (glyph_is_normal_male_monster(glyph)) {
                        buf2 = "male_";
                    } else if (glyph_is_normal_female_monster(glyph)) {
                        buf2 = "female_";
                    } else if (glyph_is_ridden_male_monster(glyph)) {
                        buf2 = "ridden_male_";
                    } else if (glyph_is_ridden_female_monster(glyph)) {
                        buf2 = "ridden_female_";
                    } else if (glyph_is_detected_male_monster(glyph)) {
                        buf2 = "detected_male_";
                    } else if (glyph_is_detected_female_monster(glyph)) {
                        buf2 = "detected_female_";
                    } else if (glyph_is_male_pet(glyph)) {
                        buf2 = "pet_male_";
                    } else if (glyph_is_female_pet(glyph)) {
                        buf2 = "pet_female_";
                    }
                    buf[0] = "G_" + buf2 + buf3;
                } else if (glyph_is_body(glyph)) {
                    buf2 = glyph_is_body_piletop(glyph) ? "piletop_body_"
                                                        : "body_";
                    buf3 = monsdump_nm[glyph_to_body_corpsenm(glyph)];
                    buf[0] = "G_" + buf2 + buf3;
                } else if (glyph_is_statue(glyph)) {
                    buf2 = glyph_is_fem_statue_piletop(glyph)
                           ? "piletop_statue_of_female_"
                           : glyph_is_fem_statue(glyph)
                             ? "statue_of_female_"
                             : glyph_is_male_statue_piletop(glyph)
                               ? "piletop_statue_of_male_"
                               : glyph_is_male_statue(glyph)
                                 ? "statue_of_male_"
                                 : ""; /* shouldn't happen */
                    buf3 = monsdump_nm[glyph_to_statue_corpsenm(glyph)];
                    buf[0] = "G_" + buf2 + buf3;
                } else if (glyph_is_object(glyph)) {
                    i = glyph_to_obj(glyph);
                    /* the XTRA_SCROLL_LABEL and extra-wand appearance rows
                       have no name of their own */
                    if (((i > SCR_STINKING_CLOUD) && (i < SCR_MAIL))
                        || ((i > WAN_LIGHTNING) && (i < GOLD_PIECE)))
                        skip_this_one = true;
                    if (!skip_this_one) {
                        if ((i >= WAN_LIGHT) && (i <= WAN_LIGHTNING))
                            buf2 = "wand of ";
                        else if ((i >= SPE_DIG) && (i < SPE_BLANK_PAPER))
                            buf2 = "spellbook of ";
                        else if ((i >= SCR_ENCHANT_ARMOR)
                                 && (i <= SCR_STINKING_CLOUD))
                            buf2 = "scroll of ";
                        else if ((i >= POT_GAIN_ABILITY) && (i <= POT_WATER))
                            buf2 = (i === POT_WATER) ? "flask of n"
                                                     : "potion of ";
                        else if ((i >= RIN_ADORNMENT)
                                 && (i <= RIN_PROTECTION_FROM_SHAPE_CHAN))
                            buf2 = "ring of ";
                        else if (i === LAND_MINE)
                            buf2 = "unset ";
                        else
                            buf2 = "";
                        /* obj_descr[i].oc_name, else its oc_descr; js keeps
                           the never-shuffled name on objects[i].name and the
                           appearance in DESCR_BY_OTYP (both keyed by otyp,
                           which is what C indexes here) */
                        buf3 = (i === SCR_BLANK_PAPER) ? "blank scroll"
                               : (i === SPE_BLANK_PAPER) ? "blank spellbook"
                                 : (i === SLIME_MOLD) ? "slime mold"
                                   : objects[i].name
                                     ? objects[i].name
                                     : DESCR_BY_OTYP[i];
                        buf[0] = "G_"
                                 + (glyph_is_normal_piletop_obj(glyph)
                                    ? "piletop_" : "")
                                 + buf2 + buf3;
                    }
                } else if (glyph_is_cmap(glyph) || glyph_is_cmap_zap(glyph)
                           || glyph_is_swallow(glyph)
                           || glyph_is_explosion(glyph)) {
                    let cmap = -1;

                    /* buf2 prefix, buf3 base name, buf4 suffix */
                    buf2 = "";
                    buf3 = "";
                    buf4 = "";
                    if (glyph === GLYPH_CMAP_OFF) {
                        cmap = S_stone;
                        buf3 = "stone substrate";
                        skip_base = true;
                    } else if (glyph_is_cmap_gehennom(glyph)) {
                        cmap = (glyph - GLYPH_CMAP_GEH_OFF) + S_vwall;
                        buf4 = "_gehennom";
                    } else if (glyph_is_cmap_knox(glyph)) {
                        cmap = (glyph - GLYPH_CMAP_KNOX_OFF) + S_vwall;
                        buf4 = "_knox";
                    } else if (glyph_is_cmap_main(glyph)) {
                        cmap = (glyph - GLYPH_CMAP_MAIN_OFF) + S_vwall;
                        buf4 = "_main";
                    } else if (glyph_is_cmap_mines(glyph)) {
                        cmap = (glyph - GLYPH_CMAP_MINES_OFF) + S_vwall;
                        buf4 = "_mines";
                    } else if (glyph_is_cmap_sokoban(glyph)) {
                        cmap = (glyph - GLYPH_CMAP_SOKO_OFF) + S_vwall;
                        buf4 = "_sokoban";
                    } else if (glyph_is_cmap_a(glyph)) {
                        cmap = (glyph - GLYPH_CMAP_A_OFF) + S_ndoor;
                    } else if (glyph_is_cmap_altar(glyph)) {
                        const altar_text = [
                            "unaligned", "chaotic", "neutral",
                            "lawful",    "other",
                        ];

                        j = (glyph - GLYPH_ALTAR_OFF);
                        cmap = S_altar;
                        if (j !== altar_other) {
                            buf[2] = `${altar_text[j]}_`;
                            buf2 = buf[2];
                        } else {
                            buf3 = "altar other";
                            skip_base = true;
                        }
                    } else if (glyph_is_cmap_b(glyph)) {
                        cmap = (glyph - GLYPH_CMAP_B_OFF) + S_grave;
                    } else if (glyph_is_cmap_zap(glyph)) {
                        const zap_texts = [
                            "missile", "fire",      "frost",      "sleep",
                            "death",   "lightning", "poison gas", "acid",
                        ];

                        j = (glyph - GLYPH_ZAP_OFF);
                        cmap = (j % 4) + S_vbeam;
                        buf[2] = loadsyms[cmap + cmap_offset].name.slice(2);
                        buf[2] = fix_glyphname(buf[2]);
                        buf[3] = `${zap_texts[Math.floor(j / 4)]} zap ${buf[2]}`;
                        buf3 = buf[3];
                        buf2 = "";
                        skip_base = true;
                    } else if (glyph_is_cmap_c(glyph)) {
                        cmap = (glyph - GLYPH_CMAP_C_OFF) + S_digbeam;
                    } else if (glyph_is_swallow(glyph)) {
                        const swallow_texts = [
                            "top left",      "top center",   "top right",
                            "middle left",   "middle right", "bottom left",
                            "bottom center", "bottom right",
                        ];

                        j = glyph - GLYPH_SWALLOW_OFF;
                        cmap = glyph_to_swallow(glyph);
                        mnum = Math.floor(j / ((S_sw_br - S_sw_tl) + 1));
                        buf[3] = "swallow " + monsdump_nm[mnum] + " "
                                 + swallow_texts[cmap];
                        buf3 = buf[3];
                        skip_base = true;
                    } else if (glyph_is_explosion(glyph)) {
                        const expl_type_texts = [
                            "dark",    "noxious", "muddy",  "wet",
                            "magical", "fiery",   "frosty",
                        ];
                        const expl_texts = [
                            "tl", "tc", "tr", "ml", "mc",
                            "mr", "bl", "bc", "br",
                        ];
                        let expl;

                        j = glyph - GLYPH_EXPLODE_OFF;
                        expl = Math.floor(j / ((S_expl_br - S_expl_tl) + 1));
                        cmap = glyph_to_explosion(glyph) + S_expl_tl;
                        i = cmap - S_expl_tl;
                        buf[2] = `${expl_type_texts[expl]} `;
                        buf2 = buf[2];
                        buf[3] = `expl_${expl_texts[i]}`;
                        buf3 = buf[3];
                        skip_base = true;
                    }
                    if (!skip_base) {
                        if (cmap >= 0 && cmap < MAXPCHARS) {
                            buf3 = loadsyms[cmap + cmap_offset].name.slice(2);
                        }
                    }
                    buf[0] = "G_" + buf2 + buf3 + buf4;
                } else if (glyph_is_invisible(glyph)) {
                    buf[0] = "G_invisible";
                } else if (glyph_is_nothing(glyph)) {
                    buf[0] = "G_nothing";
                } else if (glyph_is_unexplored(glyph)) {
                    buf[0] = "G_unexplored";
                } else if (glyph_is_warning(glyph)) {
                    j = glyph - GLYPH_WARNING_OFF;
                    buf[0] = `G_warning${j}`;
                }
                /* C: memchr(buf[0], '\0', sizeof buf[0]) == NULL */
                if (buf[0].length >= QBUFSZ)
                    panic('parse_id: buf[0] overflowed');
                if (!skip_this_one) {
                    buf[0] = buf[0].slice(0, 2) + fix_glyphname(buf[0].slice(2));
                    if (dump_ids) {
                        Fprintf(fp, `(${String(glyph).padStart(4, '0')})`
                                    + ` ${buf[0]}\n`);
                    } else if (filling_cache) {
                        add_glyph_to_cache(glyph, buf[0]);
                    } else if (id != null) {
                        if (strcmpi_eq(id, buf[0])) {
                            findwhat.findtype = find_glyph;
                            findwhat.val = glyph;
                            findwhat.loadsyms_offset = 0;
                            return 1;
                        }
                    }
                }
            }
        } /* not glyphid_cache */
    } else if (is_S) {
        /* cmap entries */
        for (i = 0; i < cmap_count; ++i) {
            if (strcmpi_eq(loadsyms[i + cmap_offset].name.slice(2),
                           id.slice(2))) {
                findwhat.findtype = find_cmap;
                findwhat.val = i;
                findwhat.loadsyms_offset = i + cmap_offset;
                return 1;
            }
        }
        /* objclass entries */
        for (i = 0; i < oc_count; ++i) {
            if (strcmpi_eq(loadsyms[i + oc_offset].name.slice(2),
                           id.slice(2))) {
                findwhat.findtype = find_oc;
                findwhat.val = i;
                findwhat.loadsyms_offset = i + oc_offset;
                return 1;
            }
        }
        /* permonst entries.  C's `<=` reads one past the SYM_MON block, so
           the first SYM_OTH name ("S_nothing") also matches here. */
        for (i = 0; i <= pm_count; ++i) {
            if (strcmpi_eq(loadsyms[i + pm_offset].name.slice(2),
                           id.slice(2))) {
                findwhat.findtype = find_pm;
                findwhat.val = i + 1; /* starts at 1 */
                findwhat.loadsyms_offset = i + pm_offset;
                return 1;
            }
        }
    }
    if (dump_ids || filling_cache)
        return 1;
    findwhat.findtype = find_nothing;
    findwhat.val = 0;
    findwhat.loadsyms_offset = 0;
    return 0;
}

/* C ref: glyphs.c:1167 */
export function clear_all_glyphmap_colors() {
    const gm = glyphmap();
    let glyph;

    for (glyph = 0; glyph < MAX_GLYPH; ++glyph) {
        if (gm[glyph].customcolor)
            gm[glyph].customcolor = 0;
        gm[glyph].color256idx = 0;
    }
}

/* C ref: glyphs.c:1179 */
export function reset_customcolors() {
    clear_all_glyphmap_colors();
    apply_customizations(gc.currentgraphics, do_custom_colors);
}

/* ------------------------------------------------------------------------ *
 * glyphs.c:1191-1247 "not used yet" — the whole block is inside #if 0, so
 * these two never compile.  Ported as written, with the two things that stop
 * them compiling flagged rather than silently corrected.
 * ------------------------------------------------------------------------ */

/* C ref: glyphs.c:1196 */
export function find_display_sym_customization(customization_name, symparse,
                                               which_set) {
    let gdc, symdetails;

    gdc = sym_customizations[which_set][custom_symbols];
    if (gdc.custtype === custom_symbols
        && strcmp_eq(customization_name, gdc.customization_name)) {
        symdetails = gdc.details;
        while (symdetails) {
            if (symdetails.content.sym.symparse === symparse)
                return symdetails;
            symdetails = symdetails.next;
        }
    }
    return null;
}

/* C ref: glyphs.c:1218.  Two C bugs kept visible: the subscript is
   `sym_customizations[which_set]` (a ROW, not a cell — glyphs.c:1224 would not
   compile) and the custtype tested is spelled `custom_reps`, which is not a
   member of enum customization_types; custom_ureps is meant.  The `||` between
   the two tests is also almost certainly a typo for `&&`. */
export function find_display_urep_customization(customization_name, glyphidx,
                                                which_set) {
    const gdc = sym_customizations[which_set][custom_ureps];
    let urepdetails;

    if (gdc.custtype === custom_ureps
        || strcmp_eq(customization_name, gdc.customization_name)) {
        urepdetails = gdc.details;
        while (urepdetails) {
            if (urepdetails.content.urep.glyphidx === glyphidx)
                return urepdetails;
            urepdetails = urepdetails.next;
        }
    }
    return null;
}

/* ------------------------------------------------------------------------ *
 * glyphs.c:1249-1322 #ifdef TEST_GLYPHNAMES — not defined in this build.
 * ------------------------------------------------------------------------ */

/* C ref: glyphs.c:1252 */
export function test_glyphnames() {
    let reslt;

    reslt = find_glyphs("G_potion_of_monster_detection");
    reslt = find_glyphs("G_piletop_body_chickatrice");
    reslt = find_glyphs("G_detected_male_homunculus");
    reslt = find_glyphs("S_pool");
    reslt = find_glyphs("S_dog");
    reslt = glyphs_to_unicode("S_dog", "U+130E6", 0);
    return reslt;
}

/* C ref: glyphs.c:1265 */
export function just_find_callback(glyph, findwhat) {
    return;
}

/* C ref: glyphs.c:1271 */
export function find_glyphs(id) {
    const find_only = zero_find();

    find_only.unicode_val = null;
    find_only.callback = just_find_callback;
    return glyph_find_core(id, find_only);
}

/* C ref: glyphs.c:1281.  The set_map_u() call is itself inside
   #ifdef NO_PARSING_SYMSET, so with that undefined the body computes utf8str
   and drops it. */
export function to_unicode_callback(glyph, findwhat) {
    let uval;
    const utf8str = [0, 0, 0, 0, 0, 0];

    if (!findwhat.unicode_val)
        return;
    uval = nyi.unicode_val(findwhat.unicode_val);
    if (nyi.unicodeval_to_utf8str(uval, utf8str, utf8str.length)) {
        /* #ifdef NO_PARSING_SYMSET: set_map_u(&glyphmap()[glyph], uval,
           utf8str, findwhat.color) */
    }
}

/* C ref: glyphs.c:1303 */
export function glyphs_to_unicode(id, unicode_val, clr) {
    const to_unicode = zero_find();

    to_unicode.unicode_val = unicode_val;
    to_unicode.callback = to_unicode_callback;
    /* the marker bit again: see glyphrep_to_custom_map_entries() */
    to_unicode.color = (clr === -1) ? 0 : (clr === 0) ? nonzero_black : clr;
    return glyph_find_core(id, to_unicode);
}

/* glyphs.js */
