// mkobj.js - Object creation.
// C refs: mkobj.c, objects.h, o_init.c object probability setup.

import { game } from './gstate.js';
import { rn2, rnd, rn1, rnz, rne } from './rng.js';
import { depth as depth_of_level } from './hacklib.js';
import { builds_up, In_hell, level_difficulty_c } from './dungeon.js';
import {
    Is_rogue_level,
    CORPSTAT_FEMALE, CORPSTAT_MALE, CORPSTAT_NEUTER,
    CORPSTAT_INIT, CORPSTAT_SPE_VAL,
    ROT_AGE, TAINT_AGE, TROLL_REVIVE_CHANCE,
    TIMER_OBJECT, ROT_CORPSE, REVIVE_MON, ZOMBIFY_MON, HATCH_EGG,
    FIG_TRANSFORM, SHRINK_GLOB,
    OBJ_FREE, OBJ_FLOOR, OBJ_CONTAINED, OBJ_INVENT, OBJ_MINVENT,
    OBJ_MIGRATING, OBJ_BURIED, OBJ_ONBILL, OBJ_LUAFREE, OBJ_DELETED,
    ICE, DRAWBRIDGE_UP, DB_UNDER, DB_ICE, MAX_OIL_IN_FLASK,
    COLNO, ROWNO, LUCKADD,
    ONAME, has_oname, OMONST, Has_contents, ismnum, isok,
} from './const.js';
import {
    rndmonst_adj, monster_by_pmidx, can_be_hatched, dead_species,
    undead_to_corpse, mon_has_cnutrit, mon_nocorpse, mon_cwt, mon_msize,
    mon_cnutrit, name_to_pmidx,
} from './makemon.js';
import { set_tin_variety, SPINACH_TIN, RANDOM_TIN, food_nutrit } from './eat.js';
import { is_human_flag } from './monflags_data.js';

export const RANDOM_CLASS = 0;
export const ILLOBJ_CLASS = 1;
export const WEAPON_CLASS = 2;
export const ARMOR_CLASS = 3;
export const RING_CLASS = 4;
export const AMULET_CLASS = 5;
export const TOOL_CLASS = 6;
export const FOOD_CLASS = 7;
export const POTION_CLASS = 8;
export const SCROLL_CLASS = 9;
export const SPBOOK_CLASS = 10;
export const WAND_CLASS = 11;
export const COIN_CLASS = 12;
export const GEM_CLASS = 13;
export const ROCK_CLASS = 14;
export const BALL_CLASS = 15;
export const CHAIN_CLASS = 16;
export const VENOM_CLASS = 17;
// C ref: mkobj.c:828 dknowns[] — object classes whose APPEARANCE has to be
// seen before it is known.  clear_dknown() gives these dknown=0 at creation.
const DKNOWNS_OCLASS = new Set([WAND_CLASS, RING_CLASS, POTION_CLASS,
    SCROLL_CLASS, GEM_CLASS, SPBOOK_CLASS, WEAPON_CLASS, TOOL_CLASS,
    VENOM_CLASS]);
export const MAXOCLASSES = 18;
export const SPBOOK_no_NOVEL = -SPBOOK_CLASS;

export const STRANGE_OBJECT = 0;
export const ARROW = 18;
export const DART = 24;
export const WORM_TOOTH = 42;
export const CORPSE = 265;
export const EGG = 266;
export const TIN = 296;
export const SLIME_MOLD = 285;
export const KELP_FROND = 275;
export const CANDY_BAR = 288;
export const MEAT_RING = 270;
export const GLOB_OF_GRAY_OOZE = 271;
export const GLOB_OF_BROWN_PUDDING = 272;
export const GLOB_OF_GREEN_SLIME = 273;
export const GLOB_OF_BLACK_PUDDING = 274;
export const LEMBAS_WAFER = 291;
export const CRAM_RATION = 292;
export const FOOD_RATION = 293;
export const POT_OIL = 321;
export const POT_FRUIT_JUICE = 319;
export const POT_CONFUSION = 299;
export const POT_PARALYSIS = 301;
export const POT_WATER = 322;
export const POT_HEALING = 307;
export const POT_EXTRA_HEALING = 308;
export const POT_GAIN_LEVEL = 309;
export const POT_SPEED = 302;
export const POT_GAIN_ENERGY = 313;
export const POT_BOOZE = 317;
export const POT_SICKNESS = 318;
export const SCR_ENCHANT_WEAPON = 328;
export const SCR_ENCHANT_ARMOR = 323;
export const SCR_DESTROY_ARMOR = 324;
export const SCR_CONFUSE_MONSTER = 325;
export const SCR_SCARE_MONSTER = 326;
export const SCR_REMOVE_CURSE = 327;
export const SCR_TELEPORTATION = 333;
export const SCR_EARTH = 340;
export const SCR_BLANK_PAPER = 365;
export const SPE_HEALING = 374;
export const SPE_NOVEL = 408;
export const SPE_BLANK_PAPER = 407;
export const WAN_DIGGING = 428;
export const WAN_WISHING = 414;
export const WAN_STASIS = 415;
export const WAN_FIRE = 430;
export const WAN_CANCELLATION = 423;
export const WAN_LIGHT = 410;
export const WAN_LIGHTNING = 434;
export const RIN_TELEPORTATION = 194;
export const RIN_POLYMORPH = 196;
export const RIN_AGGRAVATE_MONSTER = 185;
export const RIN_HUNGER = 184;
export const AMULET_OF_YENDOR = 213;
export const AMULET_OF_STRANGULATION = 203;
export const AMULET_OF_CHANGE = 206;
export const AMULET_OF_RESTFUL_SLEEP = 204;
export const LARGE_BOX = 214;
export const CHEST = 215;
export const ICE_BOX = 216;
export const SACK = 217;
export const OILSKIN_SACK = 218;
export const BAG_OF_HOLDING = 219;
export const BAG_OF_TRICKS = 220;
export const TALLOW_CANDLE = 224;
export const WAX_CANDLE = 225;
export const BRASS_LANTERN = 226;
export const OIL_LAMP = 227;
export const MAGIC_LAMP = 228;
export const EXPENSIVE_CAMERA = 229;
export const TINNING_KIT = 238;
export const MAGIC_MARKER = 242;
export const CAN_OF_GREASE = 240;
export const CRYSTAL_BALL = 231;
export const HORN_OF_PLENTY = 252;
export const FIGURINE = 241;
export const BELL = 255;
export const BELL_OF_OPENING = 263;
export const CANDELABRUM_OF_INVOCATION = 262;
export const SPE_BOOK_OF_THE_DEAD = 409;
export const MAGIC_FLUTE = 248;
export const MAGIC_HARP = 254;
export const FROST_HORN = 250;
export const FIRE_HORN = 251;
export const DRUM_OF_EARTHQUAKE = 258;
export const UNICORN_HORN = 261;
export const LEASH = 236;
export const LUMP_OF_ROYAL_JELLY = 286;
export const SPEED_BOOTS = 166;
export const WATER_WALKING_BOOTS = 167;
export const JUMPING_BOOTS = 168;
export const ELVEN_BOOTS = 169;
export const KICKING_BOOTS = 170;
export const FUMBLE_BOOTS = 171;
export const LEVITATION_BOOTS = 172;
export const HELM_OF_OPPOSITE_ALIGNMENT = 99;
export const GAUNTLETS_OF_FUMBLING = 160;
export const SPLINT_MAIL = 124;
export const DILITHIUM_CRYSTAL = 439;
export const FIRST_REAL_GEM = 439;
export const LAST_REAL_GEM = 460;
export const LUCKSTONE = 470;
export const LOADSTONE = 471;
export const ROCK = 474;
export const GOLD_PIECE = 438;
export const BOULDER = 475;
export const STATUE = 476;
export const HEAVY_IRON_BALL = 477;
export const IRON_CHAIN = 478;
export const BLINDING_VENOM = 479;
export const ACID_VENOM = 480;

const F_CHARGED = 1;
const F_MULTIGEN = 2;
const F_POISONABLE = 4;
const F_CONTAINER = 8;
const F_WEPTOOL = 16;
const F_MERGE = 32;
const F_UNIQUE = 64;

const NO_MATERIAL = 0;
const LIQUID = 1;
const WAX = 2;
const VEGGY = 3;
const FLESH = 4;
const PAPER = 5;
const CLOTH = 6;
const LEATHER = 7;
const WOOD = 8;
const BONE = 9;
const DRAGON_HIDE = 10;
const IRON = 11;
const METAL = 12;
const COPPER = 13;
const SILVER = 14;
const GOLD = 15;
const PLATINUM = 16;
const MITHRIL = 17;
const PLASTIC = 18;
const GLASS = 19;
const GEMSTONE = 20;
const MINERAL = 21;
const MZ_SMALL = 1; /* monflag.h MZ_SMALL; verysmall() == msize < MZ_SMALL */
const NODIR = 1;
const NON_PM = -1;

// C ref: monsters.h PM_* species indices.  Resolved from the species NAME at
// first use rather than written as literals: mons[] indices shift whenever the
// table changes, and stale literals fail silently.  (They had drifted 5-8
// entries: PM_LIZARD read 333, which is really the healer player-monster, so
// every healer corpse skipped its rot timer and lost a whole rnz() from the
// stream.)  Lazy, so the makemon.js <-> mkobj.js import cycle has settled by
// the time the lookup runs.
const _pmidx_cache = new Map();
function PM(name) {
    if (!_pmidx_cache.has(name)) _pmidx_cache.set(name, name_to_pmidx(name));
    return _pmidx_cache.get(name);
}

// [otyp, enum-name, object-class, base oc_prob, flags, material, oc_dir, name]
const OBJECT_DATA = [
  [0, "STRANGE_OBJECT", 1, 0, 0, 0, 0, "strange object"],
  [1, "GENERIC_ILLOBJ", 1, 0, 0, 0, 0, "generic strange"],
  [2, "GENERIC_WEAPON", 2, 0, 0, 0, 0, "generic weapon"],
  [3, "GENERIC_ARMOR", 3, 0, 0, 0, 0, "generic armor"],
  [4, "GENERIC_RING", 4, 0, 0, 0, 0, "generic ring"],
  [5, "GENERIC_AMULET", 5, 0, 0, 0, 0, "generic amulet"],
  [6, "GENERIC_TOOL", 6, 0, 0, 0, 0, "generic tool"],
  [7, "GENERIC_FOOD", 7, 0, 0, 0, 0, "generic food"],
  [8, "GENERIC_POTION", 8, 0, 0, 0, 0, "generic potion"],
  [9, "GENERIC_SCROLL", 9, 0, 0, 0, 0, "generic scroll"],
  [10, "GENERIC_SPBOOK", 10, 0, 0, 0, 0, "generic spellbook"],
  [11, "GENERIC_WAND", 11, 0, 0, 0, 0, "generic wand"],
  [12, "GENERIC_COIN", 12, 0, 0, 0, 0, "generic coin"],
  [13, "GENERIC_GEM", 13, 0, 0, 0, 0, "generic gem"],
  [14, "GENERIC_ROCK", 14, 0, 0, 0, 0, "generic large rock"],
  [15, "GENERIC_BALL", 15, 0, 0, 0, 0, "generic iron ball"],
  [16, "GENERIC_CHAIN", 16, 0, 0, 0, 0, "generic iron chain"],
  [17, "GENERIC_VENOM", 17, 0, 0, 0, 0, "generic venom"],
  [18, "ARROW", 2, 55, 39, 11, 0, "arrow"],
  [19, "ELVEN_ARROW", 2, 20, 39, 8, 0, "elven arrow"],
  [20, "ORCISH_ARROW", 2, 20, 39, 11, 0, "orcish arrow"],
  [21, "SILVER_ARROW", 2, 12, 39, 14, 0, "silver arrow"],
  [22, "YA", 2, 15, 39, 12, 0, "ya"],
  [23, "CROSSBOW_BOLT", 2, 55, 39, 11, 0, "crossbow bolt"],
  [24, "DART", 2, 60, 39, 11, 0, "dart"],
  [25, "SHURIKEN", 2, 35, 39, 11, 0, "shuriken"],
  [26, "BOOMERANG", 2, 15, 33, 8, 0, "boomerang"],
  [27, "SPEAR", 2, 50, 33, 11, 0, "spear"],
  [28, "ELVEN_SPEAR", 2, 10, 33, 8, 0, "elven spear"],
  [29, "ORCISH_SPEAR", 2, 13, 33, 11, 0, "orcish spear"],
  [30, "DWARVISH_SPEAR", 2, 12, 33, 11, 0, "dwarvish spear"],
  [31, "SILVER_SPEAR", 2, 2, 33, 14, 0, "silver spear"],
  [32, "JAVELIN", 2, 10, 33, 11, 0, "javelin"],
  [33, "TRIDENT", 2, 8, 1, 11, 0, "trident"],
  [34, "DAGGER", 2, 30, 33, 11, 0, "dagger"],
  [35, "ELVEN_DAGGER", 2, 10, 33, 8, 0, "elven dagger"],
  [36, "ORCISH_DAGGER", 2, 12, 33, 11, 0, "orcish dagger"],
  [37, "SILVER_DAGGER", 2, 3, 33, 14, 0, "silver dagger"],
  [38, "ATHAME", 2, 0, 33, 11, 0, "athame"],
  [39, "SCALPEL", 2, 0, 33, 12, 0, "scalpel"],
  [40, "KNIFE", 2, 20, 33, 11, 0, "knife"],
  [41, "STILETTO", 2, 5, 33, 11, 0, "stiletto"],
  [42, "WORM_TOOTH", 2, 0, 33, 9, 0, "worm tooth"],
  [43, "CRYSKNIFE", 2, 0, 33, 9, 0, "crysknife"],
  [44, "AXE", 2, 40, 1, 11, 0, "axe"],
  [45, "BATTLE_AXE", 2, 10, 1, 11, 0, "battle-axe"],
  [46, "SHORT_SWORD", 2, 8, 1, 11, 0, "short sword"],
  [47, "ELVEN_SHORT_SWORD", 2, 2, 1, 8, 0, "elven short sword"],
  [48, "ORCISH_SHORT_SWORD", 2, 3, 1, 11, 0, "orcish short sword"],
  [49, "DWARVISH_SHORT_SWORD", 2, 2, 1, 11, 0, "dwarvish short sword"],
  [50, "SCIMITAR", 2, 15, 1, 11, 0, "scimitar"],
  [51, "SILVER_SABER", 2, 6, 1, 14, 0, "silver saber"],
  [52, "BROADSWORD", 2, 8, 1, 11, 0, "broadsword"],
  [53, "ELVEN_BROADSWORD", 2, 4, 1, 8, 0, "elven broadsword"],
  [54, "LONG_SWORD", 2, 50, 1, 11, 0, "long sword"],
  [55, "TWO_HANDED_SWORD", 2, 22, 1, 11, 0, "two-handed sword"],
  [56, "KATANA", 2, 4, 1, 11, 0, "katana"],
  [57, "TSURUGI", 2, 0, 1, 12, 0, "tsurugi"],
  [58, "RUNESWORD", 2, 0, 1, 11, 0, "runesword"],
  [59, "PARTISAN", 2, 5, 1, 11, 0, "partisan"],
  [60, "RANSEUR", 2, 5, 1, 11, 0, "ranseur"],
  [61, "SPETUM", 2, 5, 1, 11, 0, "spetum"],
  [62, "GLAIVE", 2, 8, 1, 11, 0, "glaive"],
  [63, "HALBERD", 2, 8, 1, 11, 0, "halberd"],
  [64, "BARDICHE", 2, 4, 1, 11, 0, "bardiche"],
  [65, "VOULGE", 2, 4, 1, 11, 0, "voulge"],
  [66, "FAUCHARD", 2, 6, 1, 11, 0, "fauchard"],
  [67, "GUISARME", 2, 6, 1, 11, 0, "guisarme"],
  [68, "BILL_GUISARME", 2, 4, 1, 11, 0, "bill-guisarme"],
  [69, "LUCERN_HAMMER", 2, 5, 1, 11, 0, "lucern hammer"],
  [70, "BEC_DE_CORBIN", 2, 4, 1, 11, 0, "bec de corbin"],
  [71, "DWARVISH_MATTOCK", 2, 13, 1, 11, 0, "dwarvish mattock"],
  [72, "LANCE", 2, 4, 1, 11, 0, "lance"],
  [73, "MACE", 2, 40, 1, 11, 0, "mace"],
  [74, "SILVER_MACE", 2, 2, 1, 14, 0, "silver mace"],
  [75, "MORNING_STAR", 2, 12, 1, 11, 0, "morning star"],
  [76, "WAR_HAMMER", 2, 15, 1, 11, 0, "war hammer"],
  [77, "CLUB", 2, 12, 1, 8, 0, "club"],
  [78, "RUBBER_HOSE", 2, 0, 1, 18, 0, "rubber hose"],
  [79, "QUARTERSTAFF", 2, 11, 1, 8, 0, "quarterstaff"],
  [80, "AKLYS", 2, 8, 1, 11, 0, "aklys"],
  [81, "FLAIL", 2, 40, 1, 11, 0, "flail"],
  [82, "BULLWHIP", 2, 2, 1, 7, 0, "bullwhip"],
  [83, "BOW", 2, 24, 1, 8, 0, "bow"],
  [84, "ELVEN_BOW", 2, 12, 1, 8, 0, "elven bow"],
  [85, "ORCISH_BOW", 2, 12, 1, 8, 0, "orcish bow"],
  [86, "YUMI", 2, 0, 1, 8, 0, "yumi"],
  [87, "SLING", 2, 40, 1, 7, 0, "sling"],
  [88, "CROSSBOW", 2, 45, 1, 8, 0, "crossbow"],
  [89, "ELVEN_LEATHER_HELM", 3, 6, 1, 7, 0, "elven leather helm"],
  [90, "ORCISH_HELM", 3, 6, 1, 11, 0, "orcish helm"],
  [91, "DWARVISH_IRON_HELM", 3, 6, 1, 11, 0, "dwarvish iron helm"],
  [92, "FEDORA", 3, 0, 1, 6, 0, "fedora"],
  [93, "CORNUTHAUM", 3, 5, 1, 6, 0, "cornuthaum"],
  [94, "DUNCE_CAP", 3, 5, 1, 6, 0, "dunce cap"],
  [95, "DENTED_POT", 3, 2, 1, 11, 0, "dented pot"],
  [96, "HELM_OF_BRILLIANCE", 3, 6, 1, 19, 0, "helm of brilliance"],
  [97, "HELMET", 3, 10, 1, 11, 0, "helmet"],
  [98, "HELM_OF_CAUTION", 3, 6, 1, 11, 0, "helm of caution"],
  [99, "HELM_OF_OPPOSITE_ALIGNMENT", 3, 10, 1, 11, 0, "helm of opposite alignment"],
  [100, "HELM_OF_TELEPATHY", 3, 4, 1, 11, 0, "helm of telepathy"],
  [101, "GRAY_DRAGON_SCALE_MAIL", 3, 0, 1, 10, 0, "gray dragon scale mail"],
  [102, "GOLD_DRAGON_SCALE_MAIL", 3, 0, 1, 10, 0, "gold dragon scale mail"],
  [103, "SILVER_DRAGON_SCALE_MAIL", 3, 0, 1, 10, 0, "silver dragon scale mail"],
  [104, "RED_DRAGON_SCALE_MAIL", 3, 0, 1, 10, 0, "red dragon scale mail"],
  [105, "WHITE_DRAGON_SCALE_MAIL", 3, 0, 1, 10, 0, "white dragon scale mail"],
  [106, "ORANGE_DRAGON_SCALE_MAIL", 3, 0, 1, 10, 0, "orange dragon scale mail"],
  [107, "BLACK_DRAGON_SCALE_MAIL", 3, 0, 1, 10, 0, "black dragon scale mail"],
  [108, "BLUE_DRAGON_SCALE_MAIL", 3, 0, 1, 10, 0, "blue dragon scale mail"],
  [109, "GREEN_DRAGON_SCALE_MAIL", 3, 0, 1, 10, 0, "green dragon scale mail"],
  [110, "YELLOW_DRAGON_SCALE_MAIL", 3, 0, 1, 10, 0, "yellow dragon scale mail"],
  [111, "GRAY_DRAGON_SCALES", 3, 0, 1, 10, 0, "gray dragon scales"],
  [112, "GOLD_DRAGON_SCALES", 3, 0, 1, 10, 0, "gold dragon scales"],
  [113, "SILVER_DRAGON_SCALES", 3, 0, 1, 10, 0, "silver dragon scales"],
  [114, "RED_DRAGON_SCALES", 3, 0, 1, 10, 0, "red dragon scales"],
  [115, "WHITE_DRAGON_SCALES", 3, 0, 1, 10, 0, "white dragon scales"],
  [116, "ORANGE_DRAGON_SCALES", 3, 0, 1, 10, 0, "orange dragon scales"],
  [117, "BLACK_DRAGON_SCALES", 3, 0, 1, 10, 0, "black dragon scales"],
  [118, "BLUE_DRAGON_SCALES", 3, 0, 1, 10, 0, "blue dragon scales"],
  [119, "GREEN_DRAGON_SCALES", 3, 0, 1, 10, 0, "green dragon scales"],
  [120, "YELLOW_DRAGON_SCALES", 3, 0, 1, 10, 0, "yellow dragon scales"],
  [121, "PLATE_MAIL", 3, 40, 1, 11, 0, "plate mail"],
  [122, "CRYSTAL_PLATE_MAIL", 3, 10, 1, 19, 0, "crystal plate mail"],
  [123, "BRONZE_PLATE_MAIL", 3, 23, 1, 13, 0, "bronze plate mail"],
  [124, "SPLINT_MAIL", 3, 57, 1, 11, 0, "splint mail"],
  [125, "BANDED_MAIL", 3, 66, 1, 11, 0, "banded mail"],
  [126, "DWARVISH_MITHRIL_COAT", 3, 10, 1, 17, 0, "dwarvish mithril-coat"],
  [127, "ELVEN_MITHRIL_COAT", 3, 15, 1, 17, 0, "elven mithril-coat"],
  [128, "CHAIN_MAIL", 3, 66, 1, 11, 0, "chain mail"],
  [129, "ORCISH_CHAIN_MAIL", 3, 19, 1, 11, 0, "orcish chain mail"],
  [130, "SCALE_MAIL", 3, 66, 1, 11, 0, "scale mail"],
  [131, "STUDDED_LEATHER_ARMOR", 3, 66, 1, 7, 0, "studded leather armor"],
  [132, "RING_MAIL", 3, 66, 1, 11, 0, "ring mail"],
  [133, "ORCISH_RING_MAIL", 3, 19, 1, 11, 0, "orcish ring mail"],
  [134, "LEATHER_ARMOR", 3, 75, 1, 7, 0, "leather armor"],
  [135, "LEATHER_JACKET", 3, 11, 1, 7, 0, "leather jacket"],
  [136, "HAWAIIAN_SHIRT", 3, 8, 1, 6, 0, "Hawaiian shirt"],
  [137, "T_SHIRT", 3, 2, 1, 6, 0, "T-shirt"],
  [138, "MUMMY_WRAPPING", 3, 0, 1, 6, 0, "mummy wrapping"],
  [139, "ELVEN_CLOAK", 3, 8, 1, 6, 0, "elven cloak"],
  [140, "ORCISH_CLOAK", 3, 8, 1, 6, 0, "orcish cloak"],
  [141, "DWARVISH_CLOAK", 3, 8, 1, 6, 0, "dwarvish cloak"],
  [142, "OILSKIN_CLOAK", 3, 8, 1, 6, 0, "oilskin cloak"],
  [143, "ROBE", 3, 6, 1, 6, 0, "robe"],
  [144, "ALCHEMY_SMOCK", 3, 11, 1, 6, 0, "alchemy smock"],
  [145, "LEATHER_CLOAK", 3, 8, 1, 7, 0, "leather cloak"],
  [146, "CLOAK_OF_PROTECTION", 3, 11, 1, 6, 0, "cloak of protection"],
  [147, "CLOAK_OF_INVISIBILITY", 3, 12, 1, 6, 0, "cloak of invisibility"],
  [148, "CLOAK_OF_MAGIC_RESISTANCE", 3, 6, 1, 6, 0, "cloak of magic resistance"],
  [149, "CLOAK_OF_DISPLACEMENT", 3, 12, 1, 6, 0, "cloak of displacement"],
  [150, "SMALL_SHIELD", 3, 6, 1, 8, 0, "small shield"],
  [151, "SHIELD_OF_DRAIN_RESISTANCE", 3, 12, 1, 8, 0, "shield of drain resistance"],
  [152, "SHIELD_OF_SHOCK_RESISTANCE", 3, 12, 1, 8, 0, "shield of shock resistance"],
  [153, "ELVEN_SHIELD", 3, 2, 1, 8, 0, "elven shield"],
  [154, "URUK_HAI_SHIELD", 3, 2, 1, 11, 0, "Uruk-hai shield"],
  [155, "ORCISH_SHIELD", 3, 2, 1, 11, 0, "orcish shield"],
  [156, "LARGE_SHIELD", 3, 4, 1, 11, 0, "large shield"],
  [157, "DWARVISH_ROUNDSHIELD", 3, 3, 1, 11, 0, "dwarvish roundshield"],
  [158, "SHIELD_OF_REFLECTION", 3, 7, 1, 14, 0, "shield of reflection"],
  [159, "LEATHER_GLOVES", 3, 15, 1, 7, 0, "leather gloves"],
  [160, "GAUNTLETS_OF_FUMBLING", 3, 8, 1, 7, 0, "gauntlets of fumbling"],
  [161, "GAUNTLETS_OF_POWER", 3, 8, 1, 11, 0, "gauntlets of power"],
  [162, "GAUNTLETS_OF_DEXTERITY", 3, 8, 1, 7, 0, "gauntlets of dexterity"],
  [163, "LOW_BOOTS", 3, 23, 1, 7, 0, "low boots"],
  [164, "IRON_SHOES", 3, 7, 1, 11, 0, "iron shoes"],
  [165, "HIGH_BOOTS", 3, 14, 1, 7, 0, "high boots"],
  [166, "SPEED_BOOTS", 3, 12, 1, 7, 0, "speed boots"],
  [167, "WATER_WALKING_BOOTS", 3, 12, 1, 7, 0, "water walking boots"],
  [168, "JUMPING_BOOTS", 3, 12, 1, 7, 0, "jumping boots"],
  [169, "ELVEN_BOOTS", 3, 12, 1, 7, 0, "elven boots"],
  [170, "KICKING_BOOTS", 3, 12, 1, 11, 0, "kicking boots"],
  [171, "FUMBLE_BOOTS", 3, 12, 1, 7, 0, "fumble boots"],
  [172, "LEVITATION_BOOTS", 3, 12, 1, 7, 0, "levitation boots"],
  [173, "RIN_ADORNMENT", 4, 1, 1, 8, 0, "adornment"],
  [174, "RIN_GAIN_STRENGTH", 4, 1, 1, 21, 0, "gain strength"],
  [175, "RIN_GAIN_CONSTITUTION", 4, 1, 1, 21, 0, "gain constitution"],
  [176, "RIN_INCREASE_ACCURACY", 4, 1, 1, 21, 0, "increase accuracy"],
  [177, "RIN_INCREASE_DAMAGE", 4, 1, 1, 21, 0, "increase damage"],
  [178, "RIN_PROTECTION", 4, 1, 1, 21, 0, "protection"],
  [179, "RIN_REGENERATION", 4, 1, 0, 21, 0, "regeneration"],
  [180, "RIN_SEARCHING", 4, 1, 0, 20, 0, "searching"],
  [181, "RIN_STEALTH", 4, 1, 0, 20, 0, "stealth"],
  [182, "RIN_SUSTAIN_ABILITY", 4, 1, 0, 13, 0, "sustain ability"],
  [183, "RIN_LEVITATION", 4, 1, 0, 20, 0, "levitation"],
  [184, "RIN_HUNGER", 4, 1, 0, 20, 0, "hunger"],
  [185, "RIN_AGGRAVATE_MONSTER", 4, 1, 0, 20, 0, "aggravate monster"],
  [186, "RIN_CONFLICT", 4, 1, 0, 20, 0, "conflict"],
  [187, "RIN_WARNING", 4, 1, 0, 20, 0, "warning"],
  [188, "RIN_POISON_RESISTANCE", 4, 1, 0, 9, 0, "poison resistance"],
  [189, "RIN_FIRE_RESISTANCE", 4, 1, 0, 11, 0, "fire resistance"],
  [190, "RIN_COLD_RESISTANCE", 4, 1, 0, 13, 0, "cold resistance"],
  [191, "RIN_SHOCK_RESISTANCE", 4, 1, 0, 13, 0, "shock resistance"],
  [192, "RIN_FREE_ACTION", 4, 1, 0, 11, 0, "free action"],
  [193, "RIN_SLOW_DIGESTION", 4, 1, 0, 11, 0, "slow digestion"],
  [194, "RIN_TELEPORTATION", 4, 1, 0, 14, 0, "teleportation"],
  [195, "RIN_TELEPORT_CONTROL", 4, 1, 0, 15, 0, "teleport control"],
  [196, "RIN_POLYMORPH", 4, 1, 0, 9, 0, "polymorph"],
  [197, "RIN_POLYMORPH_CONTROL", 4, 1, 0, 20, 0, "polymorph control"],
  [198, "RIN_INVISIBILITY", 4, 1, 0, 11, 0, "invisibility"],
  [199, "RIN_SEE_INVISIBLE", 4, 1, 0, 11, 0, "see invisible"],
  [200, "RIN_PROTECTION_FROM_SHAPE_CHAN", 4, 1, 0, 11, 0, "protection from shape changers"],
  [201, "AMULET_OF_ESP", 5, 120, 0, 0, 0, "amulet of ESP"],
  [202, "AMULET_OF_LIFE_SAVING", 5, 75, 0, 0, 0, "amulet of life saving"],
  [203, "AMULET_OF_STRANGULATION", 5, 115, 0, 0, 0, "amulet of strangulation"],
  [204, "AMULET_OF_RESTFUL_SLEEP", 5, 115, 0, 0, 0, "amulet of restful sleep"],
  [205, "AMULET_VERSUS_POISON", 5, 115, 0, 0, 0, "amulet versus poison"],
  [206, "AMULET_OF_CHANGE", 5, 115, 0, 0, 0, "amulet of change"],
  [207, "AMULET_OF_UNCHANGING", 5, 60, 0, 0, 0, "amulet of unchanging"],
  [208, "AMULET_OF_REFLECTION", 5, 75, 0, 0, 0, "amulet of reflection"],
  [209, "AMULET_OF_MAGICAL_BREATHING", 5, 75, 0, 0, 0, "amulet of magical breathing"],
  [210, "AMULET_OF_GUARDING", 5, 75, 0, 0, 0, "amulet of guarding"],
  [211, "AMULET_OF_FLYING", 5, 60, 0, 0, 0, "amulet of flying"],
  [212, "FAKE_AMULET_OF_YENDOR", 5, 0, 0, 18, 0, "cheap plastic imitation of the Amulet of Yendor"],
  [213, "AMULET_OF_YENDOR", 5, 0, 64, 17, 0, "Amulet of Yendor"],
  [214, "LARGE_BOX", 6, 40, 8, 8, 0, "large box"],
  [215, "CHEST", 6, 35, 8, 8, 0, "chest"],
  [216, "ICE_BOX", 6, 5, 8, 18, 0, "ice box"],
  [217, "SACK", 6, 35, 8, 6, 0, "sack"],
  [218, "OILSKIN_SACK", 6, 5, 8, 6, 0, "oilskin sack"],
  [219, "BAG_OF_HOLDING", 6, 20, 8, 6, 0, "bag of holding"],
  [220, "BAG_OF_TRICKS", 6, 20, 9, 6, 0, "bag of tricks"],
  [221, "SKELETON_KEY", 6, 80, 0, 11, 0, "skeleton key"],
  [222, "LOCK_PICK", 6, 60, 0, 11, 0, "lock pick"],
  [223, "CREDIT_CARD", 6, 15, 0, 18, 0, "credit card"],
  [224, "TALLOW_CANDLE", 6, 20, 32, 2, 0, "tallow candle"],
  [225, "WAX_CANDLE", 6, 5, 32, 2, 0, "wax candle"],
  [226, "BRASS_LANTERN", 6, 30, 0, 13, 0, "brass lantern"],
  [227, "OIL_LAMP", 6, 45, 0, 13, 0, "oil lamp"],
  [228, "MAGIC_LAMP", 6, 15, 0, 13, 0, "magic lamp"],
  [229, "EXPENSIVE_CAMERA", 6, 15, 1, 18, 0, "expensive camera"],
  [230, "MIRROR", 6, 45, 0, 19, 0, "mirror"],
  [231, "CRYSTAL_BALL", 6, 15, 1, 19, 0, "crystal ball"],
  [232, "LENSES", 6, 5, 0, 19, 0, "lenses"],
  [233, "BLINDFOLD", 6, 50, 0, 6, 0, "blindfold"],
  [234, "TOWEL", 6, 50, 0, 6, 0, "towel"],
  [235, "SADDLE", 6, 5, 0, 7, 0, "saddle"],
  [236, "LEASH", 6, 65, 0, 7, 0, "leash"],
  [237, "STETHOSCOPE", 6, 25, 0, 11, 0, "stethoscope"],
  [238, "TINNING_KIT", 6, 15, 1, 11, 0, "tinning kit"],
  [239, "TIN_OPENER", 6, 35, 0, 11, 0, "tin opener"],
  [240, "CAN_OF_GREASE", 6, 15, 1, 11, 0, "can of grease"],
  [241, "FIGURINE", 6, 25, 0, 21, 0, "figurine"],
  [242, "MAGIC_MARKER", 6, 15, 1, 18, 0, "magic marker"],
  [243, "LAND_MINE", 6, 0, 0, 11, 0, "land mine"],
  [244, "BEARTRAP", 6, 0, 0, 11, 0, "beartrap"],
  [245, "TIN_WHISTLE", 6, 100, 0, 12, 0, "tin whistle"],
  [246, "MAGIC_WHISTLE", 6, 30, 0, 12, 0, "magic whistle"],
  [247, "WOODEN_FLUTE", 6, 4, 0, 8, 0, "wooden flute"],
  [248, "MAGIC_FLUTE", 6, 2, 1, 8, 0, "magic flute"],
  [249, "TOOLED_HORN", 6, 5, 0, 9, 0, "tooled horn"],
  [250, "FROST_HORN", 6, 2, 1, 9, 0, "frost horn"],
  [251, "FIRE_HORN", 6, 2, 1, 9, 0, "fire horn"],
  [252, "HORN_OF_PLENTY", 6, 2, 1, 9, 0, "horn of plenty"],
  [253, "WOODEN_HARP", 6, 4, 0, 8, 0, "wooden harp"],
  [254, "MAGIC_HARP", 6, 2, 1, 8, 0, "magic harp"],
  [255, "BELL", 6, 2, 0, 13, 0, "bell"],
  [256, "BUGLE", 6, 4, 0, 13, 0, "bugle"],
  [257, "LEATHER_DRUM", 6, 4, 0, 7, 0, "leather drum"],
  [258, "DRUM_OF_EARTHQUAKE", 6, 2, 1, 7, 0, "drum of earthquake"],
  [259, "PICK_AXE", 6, 20, 17, 11, 0, "pick-axe"],
  [260, "GRAPPLING_HOOK", 6, 5, 17, 11, 0, "grappling hook"],
  [261, "UNICORN_HORN", 6, 0, 17, 9, 0, "unicorn horn"],
  [262, "CANDELABRUM_OF_INVOCATION", 6, 0, 64, 15, 0, "Candelabrum of Invocation"],
  [263, "BELL_OF_OPENING", 6, 0, 65, 14, 0, "Bell of Opening"],
  [264, "TRIPE_RATION", 7, 140, 32, 4, 0, "tripe ration"],
  [265, "CORPSE", 7, 0, 32, 4, 0, "corpse"],
  [266, "EGG", 7, 85, 32, 4, 0, "egg"],
  [267, "MEATBALL", 7, 0, 32, 4, 0, "meatball"],
  [268, "MEAT_STICK", 7, 0, 32, 4, 0, "meat stick"],
  [269, "ENORMOUS_MEATBALL", 7, 0, 32, 4, 0, "enormous meatball"],
  [270, "MEAT_RING", 7, 0, 0, 4, 0, "meat ring"],
  [271, "GLOB_OF_GRAY_OOZE", 7, 0, 32, 4, 0, "glob of gray ooze"],
  [272, "GLOB_OF_BROWN_PUDDING", 7, 0, 32, 4, 0, "glob of brown pudding"],
  [273, "GLOB_OF_GREEN_SLIME", 7, 0, 32, 4, 0, "glob of green slime"],
  [274, "GLOB_OF_BLACK_PUDDING", 7, 0, 32, 4, 0, "glob of black pudding"],
  [275, "KELP_FROND", 7, 0, 32, 3, 0, "kelp frond"],
  [276, "EUCALYPTUS_LEAF", 7, 3, 32, 3, 0, "eucalyptus leaf"],
  [277, "APPLE", 7, 15, 32, 3, 0, "apple"],
  [278, "ORANGE", 7, 10, 32, 3, 0, "orange"],
  [279, "PEAR", 7, 10, 32, 3, 0, "pear"],
  [280, "MELON", 7, 10, 32, 3, 0, "melon"],
  [281, "BANANA", 7, 10, 32, 3, 0, "banana"],
  [282, "CARROT", 7, 15, 32, 3, 0, "carrot"],
  [283, "SPRIG_OF_WOLFSBANE", 7, 7, 32, 3, 0, "sprig of wolfsbane"],
  [284, "CLOVE_OF_GARLIC", 7, 7, 32, 3, 0, "clove of garlic"],
  [285, "SLIME_MOLD", 7, 75, 32, 3, 0, "slime mold"],
  [286, "LUMP_OF_ROYAL_JELLY", 7, 0, 32, 3, 0, "lump of royal jelly"],
  [287, "CREAM_PIE", 7, 25, 32, 3, 0, "cream pie"],
  [288, "CANDY_BAR", 7, 13, 32, 3, 0, "candy bar"],
  [289, "FORTUNE_COOKIE", 7, 55, 32, 3, 0, "fortune cookie"],
  [290, "PANCAKE", 7, 25, 32, 3, 0, "pancake"],
  [291, "LEMBAS_WAFER", 7, 20, 32, 3, 0, "lembas wafer"],
  [292, "CRAM_RATION", 7, 20, 32, 3, 0, "cram ration"],
  [293, "FOOD_RATION", 7, 380, 32, 3, 0, "food ration"],
  [294, "K_RATION", 7, 0, 32, 3, 0, "K-ration"],
  [295, "C_RATION", 7, 0, 32, 3, 0, "C-ration"],
  [296, "TIN", 7, 75, 32, 12, 0, "tin"],
  [297, "POT_GAIN_ABILITY", 8, 40, 32, 19, 0, "gain ability"],
  [298, "POT_RESTORE_ABILITY", 8, 40, 32, 19, 0, "restore ability"],
  [299, "POT_CONFUSION", 8, 40, 32, 19, 0, "confusion"],
  [300, "POT_BLINDNESS", 8, 30, 32, 19, 0, "blindness"],
  [301, "POT_PARALYSIS", 8, 40, 32, 19, 0, "paralysis"],
  [302, "POT_SPEED", 8, 40, 32, 19, 0, "speed"],
  [303, "POT_LEVITATION", 8, 40, 32, 19, 0, "levitation"],
  [304, "POT_HALLUCINATION", 8, 30, 32, 19, 0, "hallucination"],
  [305, "POT_INVISIBILITY", 8, 40, 32, 19, 0, "invisibility"],
  [306, "POT_SEE_INVISIBLE", 8, 40, 32, 19, 0, "see invisible"],
  [307, "POT_HEALING", 8, 115, 32, 19, 0, "healing"],
  [308, "POT_EXTRA_HEALING", 8, 45, 32, 19, 0, "extra healing"],
  [309, "POT_GAIN_LEVEL", 8, 20, 32, 19, 0, "gain level"],
  [310, "POT_ENLIGHTENMENT", 8, 20, 32, 19, 0, "enlightenment"],
  [311, "POT_MONSTER_DETECTION", 8, 40, 32, 19, 0, "monster detection"],
  [312, "POT_OBJECT_DETECTION", 8, 40, 32, 19, 0, "object detection"],
  [313, "POT_GAIN_ENERGY", 8, 40, 32, 19, 0, "gain energy"],
  [314, "POT_SLEEPING", 8, 40, 32, 19, 0, "sleeping"],
  [315, "POT_FULL_HEALING", 8, 10, 32, 19, 0, "full healing"],
  [316, "POT_POLYMORPH", 8, 10, 32, 19, 0, "polymorph"],
  [317, "POT_BOOZE", 8, 40, 32, 19, 0, "booze"],
  [318, "POT_SICKNESS", 8, 40, 32, 19, 0, "sickness"],
  [319, "POT_FRUIT_JUICE", 8, 40, 32, 19, 0, "fruit juice"],
  [320, "POT_ACID", 8, 10, 32, 19, 0, "acid"],
  [321, "POT_OIL", 8, 30, 32, 19, 0, "oil"],
  [322, "POT_WATER", 8, 80, 32, 19, 0, "water"],
  [323, "SCR_ENCHANT_ARMOR", 9, 63, 32, 5, 0, "enchant armor"],
  [324, "SCR_DESTROY_ARMOR", 9, 45, 32, 5, 0, "destroy armor"],
  [325, "SCR_CONFUSE_MONSTER", 9, 53, 32, 5, 0, "confuse monster"],
  [326, "SCR_SCARE_MONSTER", 9, 35, 32, 5, 0, "scare monster"],
  [327, "SCR_REMOVE_CURSE", 9, 65, 32, 5, 0, "remove curse"],
  [328, "SCR_ENCHANT_WEAPON", 9, 80, 32, 5, 0, "enchant weapon"],
  [329, "SCR_CREATE_MONSTER", 9, 45, 32, 5, 0, "create monster"],
  [330, "SCR_TAMING", 9, 15, 32, 5, 0, "taming"],
  [331, "SCR_GENOCIDE", 9, 15, 32, 5, 0, "genocide"],
  [332, "SCR_LIGHT", 9, 90, 32, 5, 0, "light"],
  [333, "SCR_TELEPORTATION", 9, 55, 32, 5, 0, "teleportation"],
  [334, "SCR_GOLD_DETECTION", 9, 33, 32, 5, 0, "gold detection"],
  [335, "SCR_FOOD_DETECTION", 9, 25, 32, 5, 0, "food detection"],
  [336, "SCR_IDENTIFY", 9, 180, 32, 5, 0, "identify"],
  [337, "SCR_MAGIC_MAPPING", 9, 45, 32, 5, 0, "magic mapping"],
  [338, "SCR_AMNESIA", 9, 35, 32, 5, 0, "amnesia"],
  [339, "SCR_FIRE", 9, 30, 32, 5, 0, "fire"],
  [340, "SCR_EARTH", 9, 18, 32, 5, 0, "earth"],
  [341, "SCR_PUNISHMENT", 9, 15, 32, 5, 0, "punishment"],
  [342, "SCR_CHARGING", 9, 15, 32, 5, 0, "charging"],
  [343, "SCR_STINKING_CLOUD", 9, 15, 32, 5, 0, "stinking cloud"],
  [344, "SC01", 9, 0, 32, 5, 0, ""],
  [345, "SC02", 9, 0, 32, 5, 0, ""],
  [346, "SC03", 9, 0, 32, 5, 0, ""],
  [347, "SC04", 9, 0, 32, 5, 0, ""],
  [348, "SC05", 9, 0, 32, 5, 0, ""],
  [349, "SC06", 9, 0, 32, 5, 0, ""],
  [350, "SC07", 9, 0, 32, 5, 0, ""],
  [351, "SC08", 9, 0, 32, 5, 0, ""],
  [352, "SC09", 9, 0, 32, 5, 0, ""],
  [353, "SC10", 9, 0, 32, 5, 0, ""],
  [354, "SC11", 9, 0, 32, 5, 0, ""],
  [355, "SC12", 9, 0, 32, 5, 0, ""],
  [356, "SC13", 9, 0, 32, 5, 0, ""],
  [357, "SC14", 9, 0, 32, 5, 0, ""],
  [358, "SC15", 9, 0, 32, 5, 0, ""],
  [359, "SC16", 9, 0, 32, 5, 0, ""],
  [360, "SC17", 9, 0, 32, 5, 0, ""],
  [361, "SC18", 9, 0, 32, 5, 0, ""],
  [362, "SC19", 9, 0, 32, 5, 0, ""],
  [363, "SC20", 9, 0, 32, 5, 0, ""],
  [364, "SCR_MAIL", 9, 0, 32, 5, 0, "mail"],
  [365, "SCR_BLANK_PAPER", 9, 28, 32, 5, 0, "blank paper"],
  [366, "SPE_DIG", 10, 20, 0, 5, 3, "dig"],
  [367, "SPE_MAGIC_MISSILE", 10, 45, 0, 5, 3, "magic missile"],
  [368, "SPE_FIREBALL", 10, 20, 0, 5, 3, "fireball"],
  [369, "SPE_CONE_OF_COLD", 10, 10, 0, 5, 3, "cone of cold"],
  [370, "SPE_SLEEP", 10, 30, 0, 5, 3, "sleep"],
  [371, "SPE_FINGER_OF_DEATH", 10, 5, 0, 5, 3, "finger of death"],
  [372, "SPE_LIGHT", 10, 45, 0, 5, 1, "light"],
  [373, "SPE_DETECT_MONSTERS", 10, 43, 0, 5, 1, "detect monsters"],
  [374, "SPE_HEALING", 10, 40, 0, 5, 2, "healing"],
  [375, "SPE_KNOCK", 10, 25, 0, 5, 2, "knock"],
  [376, "SPE_FORCE_BOLT", 10, 30, 0, 5, 2, "force bolt"],
  [377, "SPE_CONFUSE_MONSTER", 10, 49, 0, 5, 2, "confuse monster"],
  [378, "SPE_CURE_BLINDNESS", 10, 25, 0, 5, 2, "cure blindness"],
  [379, "SPE_DRAIN_LIFE", 10, 10, 0, 5, 2, "drain life"],
  [380, "SPE_SLOW_MONSTER", 10, 30, 0, 5, 2, "slow monster"],
  [381, "SPE_WIZARD_LOCK", 10, 25, 0, 5, 2, "wizard lock"],
  [382, "SPE_CREATE_MONSTER", 10, 35, 0, 5, 1, "create monster"],
  [383, "SPE_DETECT_FOOD", 10, 30, 0, 5, 1, "detect food"],
  [384, "SPE_CAUSE_FEAR", 10, 25, 0, 5, 1, "cause fear"],
  [385, "SPE_CLAIRVOYANCE", 10, 15, 0, 5, 1, "clairvoyance"],
  [386, "SPE_CURE_SICKNESS", 10, 32, 0, 5, 1, "cure sickness"],
  [387, "SPE_CHARM_MONSTER", 10, 20, 0, 5, 2, "charm monster"],
  [388, "SPE_HASTE_SELF", 10, 33, 0, 5, 1, "haste self"],
  [389, "SPE_DETECT_UNSEEN", 10, 20, 0, 5, 1, "detect unseen"],
  [390, "SPE_LEVITATION", 10, 20, 0, 5, 1, "levitation"],
  [391, "SPE_EXTRA_HEALING", 10, 27, 0, 5, 2, "extra healing"],
  [392, "SPE_RESTORE_ABILITY", 10, 25, 0, 5, 1, "restore ability"],
  [393, "SPE_INVISIBILITY", 10, 20, 0, 5, 1, "invisibility"],
  [394, "SPE_DETECT_TREASURE", 10, 20, 0, 5, 1, "detect treasure"],
  [395, "SPE_REMOVE_CURSE", 10, 25, 0, 5, 1, "remove curse"],
  [396, "SPE_MAGIC_MAPPING", 10, 18, 0, 5, 1, "magic mapping"],
  [397, "SPE_IDENTIFY", 10, 20, 0, 5, 1, "identify"],
  [398, "SPE_TURN_UNDEAD", 10, 16, 0, 5, 2, "turn undead"],
  [399, "SPE_POLYMORPH", 10, 10, 0, 5, 2, "polymorph"],
  [400, "SPE_TELEPORT_AWAY", 10, 15, 0, 5, 2, "teleport away"],
  [401, "SPE_CREATE_FAMILIAR", 10, 10, 0, 5, 1, "create familiar"],
  [402, "SPE_CANCELLATION", 10, 15, 0, 5, 2, "cancellation"],
  [403, "SPE_PROTECTION", 10, 18, 0, 5, 1, "protection"],
  [404, "SPE_JUMPING", 10, 20, 0, 5, 2, "jumping"],
  [405, "SPE_STONE_TO_FLESH", 10, 15, 0, 5, 2, "stone to flesh"],
  [406, "SPE_CHAIN_LIGHTNING", 10, 25, 0, 5, 1, "chain lightning"],
  [407, "SPE_BLANK_PAPER", 10, 18, 0, 5, 0, "blank paper"],
  [408, "SPE_NOVEL", 10, 1, 0, 5, 0, "novel"],
  [409, "SPE_BOOK_OF_THE_DEAD", 10, 0, 64, 5, 0, "Book of the Dead"],
  [410, "WAN_LIGHT", 11, 95, 1, 19, 1, "light"],
  [411, "WAN_SECRET_DOOR_DETECTION", 11, 50, 1, 8, 1, "secret door detection"],
  [412, "WAN_ENLIGHTENMENT", 11, 15, 1, 19, 1, "enlightenment"],
  [413, "WAN_CREATE_MONSTER", 11, 50, 1, 8, 1, "create monster"],
  [414, "WAN_WISHING", 11, 5, 1, 8, 1, "wishing"],
  [415, "WAN_STASIS", 11, 45, 1, 8, 1, "stasis"],
  [416, "WAN_NOTHING", 11, 25, 1, 8, 2, "nothing"],
  [417, "WAN_STRIKING", 11, 30, 1, 8, 2, "striking"],
  [418, "WAN_MAKE_INVISIBLE", 11, 45, 1, 21, 2, "make invisible"],
  [419, "WAN_SLOW_MONSTER", 11, 50, 1, 12, 2, "slow monster"],
  [420, "WAN_SPEED_MONSTER", 11, 50, 1, 13, 2, "speed monster"],
  [421, "WAN_UNDEAD_TURNING", 11, 50, 1, 13, 2, "undead turning"],
  [422, "WAN_POLYMORPH", 11, 45, 1, 14, 2, "polymorph"],
  [423, "WAN_CANCELLATION", 11, 45, 1, 16, 2, "cancellation"],
  [424, "WAN_TELEPORTATION", 11, 45, 1, 12, 2, "teleportation"],
  [425, "WAN_OPENING", 11, 30, 1, 12, 2, "opening"],
  [426, "WAN_LOCKING", 11, 30, 1, 12, 2, "locking"],
  [427, "WAN_PROBING", 11, 30, 1, 12, 2, "probing"],
  [428, "WAN_DIGGING", 11, 40, 1, 11, 3, "digging"],
  [429, "WAN_MAGIC_MISSILE", 11, 50, 1, 11, 3, "magic missile"],
  [430, "WAN_FIRE", 11, 40, 1, 11, 3, "fire"],
  [431, "WAN_COLD", 11, 40, 1, 11, 3, "cold"],
  [432, "WAN_SLEEP", 11, 50, 1, 11, 3, "sleep"],
  [433, "WAN_DEATH", 11, 5, 1, 11, 3, "death"],
  [434, "WAN_LIGHTNING", 11, 40, 1, 11, 3, "lightning"],
  [435, "WAN1", 11, 0, 1, 8, 0, ""],
  [436, "WAN2", 11, 0, 1, 11, 0, ""],
  [437, "WAN3", 11, 0, 1, 11, 0, ""],
  [438, "GOLD_PIECE", 12, 1000, 32, 15, 0, "gold piece"],
  [439, "DILITHIUM_CRYSTAL", 13, 2, 32, 20, 0, "dilithium crystal"],
  [440, "DIAMOND", 13, 3, 32, 20, 0, "diamond"],
  [441, "RUBY", 13, 4, 32, 20, 0, "ruby"],
  [442, "JACINTH", 13, 3, 32, 20, 0, "jacinth"],
  [443, "SAPPHIRE", 13, 4, 32, 20, 0, "sapphire"],
  [444, "BLACK_OPAL", 13, 3, 32, 20, 0, "black opal"],
  [445, "EMERALD", 13, 5, 32, 20, 0, "emerald"],
  [446, "TURQUOISE", 13, 6, 32, 20, 0, "turquoise"],
  [447, "CITRINE", 13, 4, 32, 20, 0, "citrine"],
  [448, "AQUAMARINE", 13, 6, 32, 20, 0, "aquamarine"],
  [449, "AMBER", 13, 8, 32, 20, 0, "amber"],
  [450, "TOPAZ", 13, 10, 32, 20, 0, "topaz"],
  [451, "JET", 13, 6, 32, 20, 0, "jet"],
  [452, "OPAL", 13, 12, 32, 20, 0, "opal"],
  [453, "CHRYSOBERYL", 13, 8, 32, 20, 0, "chrysoberyl"],
  [454, "GARNET", 13, 12, 32, 20, 0, "garnet"],
  [455, "AMETHYST", 13, 14, 32, 20, 0, "amethyst"],
  [456, "JASPER", 13, 15, 32, 20, 0, "jasper"],
  [457, "FLUORITE", 13, 15, 32, 20, 0, "fluorite"],
  [458, "OBSIDIAN", 13, 9, 32, 20, 0, "obsidian"],
  [459, "AGATE", 13, 12, 32, 20, 0, "agate"],
  [460, "JADE", 13, 10, 32, 20, 0, "jade"],
  [461, "WORTHLESS_WHITE_GLASS", 13, 77, 32, 19, 0, "worthless piece of white glass"],
  [462, "WORTHLESS_BLUE_GLASS", 13, 77, 32, 19, 0, "worthless piece of blue glass"],
  [463, "WORTHLESS_RED_GLASS", 13, 77, 32, 19, 0, "worthless piece of red glass"],
  [464, "WORTHLESS_YELLOWBROWN_GLASS", 13, 77, 32, 19, 0, "worthless piece of yellowish brown glass"],
  [465, "WORTHLESS_ORANGE_GLASS", 13, 76, 32, 19, 0, "worthless piece of orange glass"],
  [466, "WORTHLESS_YELLOW_GLASS", 13, 77, 32, 19, 0, "worthless piece of yellow glass"],
  [467, "WORTHLESS_BLACK_GLASS", 13, 76, 32, 19, 0, "worthless piece of black glass"],
  [468, "WORTHLESS_GREEN_GLASS", 13, 77, 32, 19, 0, "worthless piece of green glass"],
  [469, "WORTHLESS_VIOLET_GLASS", 13, 77, 32, 19, 0, "worthless piece of violet glass"],
  [470, "LUCKSTONE", 13, 10, 32, 21, 0, "luckstone"],
  [471, "LOADSTONE", 13, 10, 32, 21, 0, "loadstone"],
  [472, "TOUCHSTONE", 13, 8, 32, 21, 0, "touchstone"],
  [473, "FLINT", 13, 10, 32, 21, 0, "flint"],
  [474, "ROCK", 13, 100, 32, 21, 0, "rock"],
  [475, "BOULDER", 14, 100, 0, 21, 0, "boulder"],
  [476, "STATUE", 14, 900, 8, 21, 0, "statue"],
  [477, "HEAVY_IRON_BALL", 15, 1000, 0, 11, 0, "heavy iron ball"],
  [478, "IRON_CHAIN", 16, 1000, 0, 11, 0, "iron chain"],
  [479, "BLINDING_VENOM", 17, 500, 32, 1, 0, "splash of blinding venom"],
  [480, "ACID_VENOM", 17, 500, 32, 1, 0, "splash of acid venom"],
];

// Per-object declared display color (oc_color), ported verbatim from the
// object macros in include/objects.h (each macro's penultimate argument; HI_*
// material aliases resolved via include/color.h).  Indexed by otyp.  C ref:
// display.c reset_glyphmap obj_color(n) = objects[n].oc_color.  This is the
// object's *declared* color, which for many objects (e.g. apple=CLR_RED on a
// VEGGY body) differs from the bare material default — so it must override any
// material-derived fallback.  Value 8 = NO_COLOR (generic placeholders only).
const OC_COLOR = [8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,6,3,0,7,6,6,6,6,3,6,3,0,6,7,6,6,6,3,0,7,6,6,6,6,15,15,6,6,6,3,0,6,6,7,6,3,6,6,6,6,0,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7,6,6,3,3,3,6,6,3,3,3,0,3,3,3,3,0,6,3,4,4,0,15,6,2,6,6,7,11,14,1,15,9,0,4,2,11,7,11,14,1,15,9,0,4,2,11,6,15,11,6,6,7,7,6,0,6,3,6,0,3,0,5,15,7,0,0,3,3,1,15,3,3,13,15,3,3,3,3,2,6,1,6,6,7,3,3,3,3,3,6,3,3,3,3,3,3,3,3,3,7,7,1,9,15,7,3,2,11,3,6,4,1,15,15,6,11,11,6,6,14,11,7,10,3,5,14,6,6,6,6,6,6,6,6,6,6,6,6,6,3,3,15,3,3,3,3,6,6,15,15,15,11,11,11,0,7,14,14,0,5,3,3,6,6,6,6,7,1,1,6,6,6,3,3,15,15,15,15,3,3,11,11,3,3,6,6,15,11,7,3,3,15,3,3,3,3,7,3,2,0,2,2,1,9,10,10,11,9,2,15,3,11,15,12,11,11,15,3,3,3,3,6,1,3,9,11,10,2,3,6,3,5,15,2,15,14,15,7,15,7,0,7,3,6,0,15,3,6,15,15,9,15,15,15,3,15,15,14,14,15,15,11,15,15,6,15,15,15,15,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,15,15,3,6,15,15,6,15,14,3,15,13,1,9,11,5,6,2,3,6,12,4,4,5,5,5,3,2,3,3,7,15,15,11,11,7,11,15,15,15,15,15,7,15,12,15,14,3,14,3,3,1,3,3,7,6,11,11,7,15,14,6,6,6,6,6,6,6,6,6,6,8,8,8,11,15,15,1,9,4,0,2,2,11,2,3,3,0,15,11,1,5,1,5,0,9,2,15,4,1,3,9,11,0,2,5,7,7,7,7,7,7,15,6,6,3,3];

// Per-weapon skill subtype (oc_skill == oc_subtyp), ported from the WEAPON/
// PROJECTILE/BOW macros in include/objects.h.  Ammunition uses the negative of
// its launcher's skill (e.g. arrow == -P_BOW), which drives is_ammo/is_launcher/
// matching_launcher (include/obj.h).  Sparse map by otyp; all other objects'
// oc_skill is P_NONE (0).  C ref: skills.h P_DAGGER..P_CROSSBOW.
const OC_SKILL = {
    18: -20, 19: -20, 20: -20, 21: -20, 22: -20, 23: -22, 24: -23, 25: -24,
    26: -25, 27: 17, 28: 17, 29: 17, 30: 17, 31: 17, 32: 17, 33: 18, 34: 1,
    35: 1, 36: 1, 37: 1, 38: 1, 39: 2, 40: 2, 41: 2, 42: 2, 43: 2, 44: 3,
    45: 3, 46: 5, 47: 5, 48: 5, 49: 5, 50: 9, 51: 9, 52: 6, 53: 6, 54: 7,
    55: 8, 56: 7, 57: 8, 58: 6, 59: 16, 60: 16, 61: 16, 62: 16, 63: 16,
    64: 16, 65: 16, 66: 16, 67: 16, 68: 16, 69: 16, 70: 16, 71: 4, 72: 19,
    73: 11, 74: 11, 75: 12, 76: 14, 77: 10, 78: 26, 79: 15, 80: 10, 81: 13,
    82: 26, 83: 20, 84: 20, 85: 20, 86: 20, 87: 21, 88: 22,
    // Tool-class weapon-tools (WEPTOOL in objects.h): these have a real
    // oc_skill so is_weptool() recognises them.  P_PICK_AXE=4, P_FLAIL=13,
    // P_UNICORN_HORN=27.
    259: 4 /*pick-axe*/, 260: 13 /*grappling hook*/, 261: 27 /*unicorn horn*/,
};
// GEM_CLASS entries (dilithium crystal..rock, otyp 439-474) all carry
// oc_skill = -P_SLING(-21) via the GEM()/ROCK() macros in objects.h — any real
// gem, stone, or rock is valid sling ammo (is_ammo/find_launcher).  The
// otyp==13 "generic gem" placeholder uses the GENERIC() macro instead and
// keeps oc_skill 0 (not a real, throwable object), so it's excluded here.
for (let otyp = 439; otyp <= 474; otyp++) OC_SKILL[otyp] = -21;

export const objects = OBJECT_DATA.map(([otyp, sym, oclass, prob, flags, material, dir, name]) => ({
    otyp, sym, oclass, oc_class: oclass, oc_prob: prob, flags, material, dir, name,
    oc_color: OC_COLOR[otyp] != null ? OC_COLOR[otyp] : 8,
    oc_skill: OC_SKILL[otyp] != null ? OC_SKILL[otyp] : 0,
    oc_subtyp: OC_SKILL[otyp] != null ? OC_SKILL[otyp] : 0,
    oc_magic: 0,
    oc_can: 0,
}));

// C ref: include/objects.h ARMOR()/HELM()/CLOAK() `can` field -> a_can, the
// armor's magic-cancellation (MC).  Only armor pieces have a nonzero a_can;
// magic_negation() (mhitu.c) reads the max a_can over the wearer's worn armor.
// Extracted verbatim from the per-armor macros (every unlisted otyp is 0):
//   can 1: ring/scale/chain/banded/splint/bronze-plate/studded/leather suits,
//          most cloaks, cornuthaum;  can 2: plate/crystal-plate/mithril suits,
//          oilskin cloak, robe;  can 3: cloak of protection.
const OC_CAN = {
    93: 1,                                   // cornuthaum (helm)
    121: 2, 122: 2, 123: 1, 124: 1, 125: 1,  // plate/crystal 2; bronze/splint/banded 1
    126: 2, 127: 2,                          // dwarvish/elven mithril-coat
    128: 1, 129: 1, 130: 1, 131: 1,          // chain/orcish-chain/scale/studded
    132: 1, 133: 1, 134: 1,                  // ring mail/orcish ring mail/leather armor
    138: 1, 139: 1, 140: 1, 141: 1,          // mummy wrapping/elven/orcish/dwarvish cloak
    142: 2, 143: 2, 144: 1, 145: 1,          // oilskin cloak/robe 2; alchemy smock/leather cloak 1
    146: 3, 147: 1, 148: 1, 149: 1,          // cloak of protection 3; invis/magic-res/displacement 1
};
for (const otyp in OC_CAN)
    if (objects[otyp]) objects[otyp].oc_can = OC_CAN[otyp];

// C ref: include/objects.h — the COMPLETE set of items whose oc_oprop is
// ANTIMAGIC (objects.h:502, :530, :645); no other object grants it.  Keyed by
// NAME because the JS otyp numbering diverges from C after 363.
const ANTIMAGIC_PROP = 12; // prop.h ANTIMAGIC
for (const o of objects)
    if (o && (o.name === 'gray dragon scale mail' || o.name === 'gray dragon scales'
              || o.name === 'cloak of magic resistance'))
        o.oc_oprop = ANTIMAGIC_PROP;

// C ref: include/objects.h:486 HELM_OF_TELEPATHY — the only non-amulet row with
// oc_oprop TELEPAT, which worn.c recalc_telepat_range() counts.
const TELEPAT_PROP = 30; // prop.h TELEPAT
for (const o of objects)
    if (o && o.name === 'helm of telepathy')
        o.oc_oprop = TELEPAT_PROP;

// C ref: include/objects.h RING()/AMULET() `power` argument — the oc_oprop of
// every ring and amulet, i.e. the prop.h property the item confers while worn.
// Keyed by NAME for the same reason as above.  Enlightenment reads this to
// report extrinsics ("You have teleport control because of your ivory ring").
// Rings whose power is 0 (gain strength/constitution, increase accuracy/damage,
// amulet of change) are absent by design.
const OC_OPROP_BY_NAME = {
    // rings — objects.h:741-826
    'adornment': 39 /*ADORNED*/, 'protection': 59 /*PROTECTION*/,
    'regeneration': 57, 'searching': 34, 'stealth': 42,
    'sustain ability': 67 /*FIXED_ABIL*/, 'levitation': 48, 'hunger': 28,
    'aggravate monster': 43, 'conflict': 44, 'warning': 31,
    'poison resistance': 6, 'fire resistance': 1, 'cold resistance': 3,
    'shock resistance': 5, 'free action': 66, 'slow digestion': 54,
    'teleportation': 46, 'teleport control': 47, 'polymorph': 61,
    'polymorph control': 62, 'invisibility': 40, 'see invisible': 29,
    'protection from shape changers': 60,
    // amulets — objects.h:835-859
    'amulet of ESP': 30 /*TELEPAT*/, 'amulet of life saving': 68 /*LIFESAVED*/,
    'amulet of strangulation': 19, 'amulet of restful sleep': 27 /*SLEEPY*/,
    'amulet versus poison': 6, 'amulet of unchanging': 63,
    'amulet of reflection': 65, 'amulet of magical breathing': 52,
    'amulet of guarding': 59 /*PROTECTION*/, 'amulet of flying': 49,
};
const RING_CLASS_OC = 4, AMULET_CLASS_OC = 5;
for (const o of objects)
    if (o && (o.oc_class === RING_CLASS_OC || o.oc_class === AMULET_CLASS_OC)) {
        const p = OC_OPROP_BY_NAME[o.name];
        if (p) o.oc_oprop = p;
    }

// C ref: include/objects.h:513/540 DRGN_ARMR("red dragon scale mail"/"red
// dragon scales", ..., FIRE_RES, ...) — the only NON-ring/amulet rows whose
// oc_oprop is FIRE_RES, which mkobj.c is_flammable() tests directly.
const FIRE_RES_PROP = 1; // prop.h FIRE_RES
for (const o of objects)
    if (o && (o.name === 'red dragon scale mail' || o.name === 'red dragon scales'))
        o.oc_oprop = FIRE_RES_PROP;

// C ref: include/objects.h BITS() mgc field — oc_magic, the "magic" flag used
// by poly_obj() (zap.c) to keep a polymorphed object's magic-or-not status the
// same as the source, and by obj_shuffle_range().  Extracted from the per-class
// object macros (WAND/POTION/SCROLL/RING/AMULET/TOOL/CONTAINER/WEPTOOL/SPELL,
// ARMOR family, ROCK) where the mgc argument is 1; WEAPON/PROJECTILE/BOW/FOOD/
// GEM/EYEWEAR are always non-magic.  (o_init.js also sets a subset of these at
// init time for the shuffle-range boundary; keeping the full table here makes
// poly_obj() faithful for every class that can land on a polymorph pile.)
const OC_MAGIC_RANGES = [
    [93, 94], [96, 96], [98, 100], [139, 139], [143, 144], [146, 149],
    [151, 152], [158, 158], [160, 162], [166, 211], [219, 220], [228, 228],
    [231, 231], [241, 242], [246, 246], [248, 248], [250, 252], [254, 254],
    [258, 258], [261, 261], [297, 316], [323, 343], [366, 406], [410, 415],
    [417, 437], [470, 472],
];
for (const [lo, hi] of OC_MAGIC_RANGES)
    for (let i = lo; i <= hi; i++)
        if (objects[i]) objects[i].oc_magic = 1;

// C ref: include/objects.h BITS() uskn field — oc_uses_known, "obj->known
// affects the full description" (objclass.h:53).  Reading every macro's BITS
// arguments shows uskn is IDENTICAL to chrg (already carried here as F_CHARGED)
// for WEAPON / PROJECTILE / BOW / ARMOR family / RING / TOOL / CONTAINER /
// WEPTOOL / WAND, and 0 for every class whose chrg is 0 (AMULET, EYEWEAR,
// POTION, SCROLL, SPELL, COIN, GEM, ROCK, the raw ball/chain/venom/statue
// rows).  FOOD is the single exception: its uskn comes from the `unk` argument
// and only "egg" and "tin" pass 1 there while chrg is always 0.  Deriving it
// this way rather than listing the otyps that happen to matter here keeps it
// right for every object the held-out corpus can reach.
for (const o of objects) {
    if (!o) continue;
    o.oc_uses_known = (o.oclass === FOOD_CLASS)
        ? ((o.otyp === EGG || o.otyp === TIN) ? 1 : 0)
        : ((o.flags & F_CHARGED) ? 1 : 0);
}

const objectsByClass = Array.from({ length: MAXOCLASSES + 1 }, () => []);
for (const obj of objects) {
    if (obj && obj.oclass >= 0) objectsByClass[obj.oclass].push(obj);
}
const classBases = Array.from({ length: MAXOCLASSES + 1 }, (_, oclass) => {
    const real = (objectsByClass[oclass] || []).find(obj => obj.otyp >= MAXOCLASSES);
    return real?.otyp ?? objects.length;
});

const mkobjprobs = [
    [10, WEAPON_CLASS], [11, ARMOR_CLASS], [20, FOOD_CLASS], [8, TOOL_CLASS],
    [7, GEM_CLASS], [16, POTION_CLASS], [16, SCROLL_CLASS], [4, SPBOOK_CLASS],
    [4, WAND_CLASS], [3, RING_CLASS], [1, AMULET_CLASS],
];
const rogueprobs = [
    [12, WEAPON_CLASS], [12, ARMOR_CLASS], [22, FOOD_CLASS],
    [22, POTION_CLASS], [22, SCROLL_CLASS], [5, WAND_CLASS], [5, RING_CLASS],
];
const hellprobs = [
    [20, WEAPON_CLASS], [20, ARMOR_CLASS], [16, FOOD_CLASS], [12, TOOL_CLASS],
    [10, GEM_CLASS], [1, POTION_CLASS], [1, SCROLL_CLASS], [8, WAND_CLASS],
    [8, RING_CLASS], [4, AMULET_CLASS],
];
const boxiprobs = [
    [18, GEM_CLASS], [15, FOOD_CLASS], [18, POTION_CLASS], [18, SCROLL_CLASS],
    [12, SPBOOK_CLASS], [7, COIN_CLASS], [6, WAND_CLASS], [5, RING_CLASS],
    [1, AMULET_CLASS],
];

// C ref: dungeon.h Inhell == In_hell(&u.uz) == dungeons[u.uz.dnum].flags.hellish.
// The dungeon NUMBER is not a fixed constant — it comes out of dungeon.lua's
// order at init_dungeons() time — so the flag has to be read off the dungeon.
function Inhell() {
    return In_hell(game.u?.uz);
}

// C ref: dungeon.c level_difficulty() — depth(&u.uz), plus a compensating
// bump in a "builds up" branch (Vlad's Tower, Sokoban); see makemon.js's copy
// of this same C function for the full rationale.
function level_difficulty() { return level_difficulty_c(); }

// C ref: o_init.c:53 setgemprobs(dlev), reached from oinit() with &u.uz.  Its
// `lev` is the LEDGER number (dungeon.c ledger_no: dlevel + the dungeon's
// ledger_start), capped at maxledgerno() — NOT depth(): every Gnomish Mines
// level sits ~25 ledger entries below its depth, so a depth-based lev zeroed
// seven gems C leaves generatable and reweighted the rest (seed0014's mined
// obsidian came out as agate).
function gem_lev() {
    const dgns = game.dungeons, uz = game.u?.uz;
    if (!dgns || !uz) return 0;
    const n = game.n_dgns ?? dgns.length;
    const ledger = (dgns[uz.dnum ?? 0]?.ledger_start ?? 0) + (uz.dlevel ?? 1);
    const maxledger = n
        ? (dgns[n - 1]?.ledger_start ?? 0) + (dgns[n - 1]?.num_dunlevs ?? 0) : 0;
    return Math.min(ledger, maxledger);
}

function gem_probability(obj) {
    if (obj.otyp < DILITHIUM_CRYSTAL || obj.otyp > LAST_REAL_GEM)
        return obj.oc_prob;
    const lev = Math.max(0, gem_lev());
    let first = DILITHIUM_CRYSTAL + Math.max(0, 9 - Math.trunc(lev / 3));
    if (first > LAST_REAL_GEM) first = LAST_REAL_GEM + 1;
    if (obj.otyp < first) return 0;
    return Math.trunc((171 + obj.otyp - first) / (LAST_REAL_GEM + 1 - first));
}

function object_probability(obj) {
    return obj.oclass === GEM_CLASS ? gem_probability(obj) : obj.oc_prob;
}

function class_probability_total(oclass) {
    let sum = 0;
    for (const obj of objectsByClass[oclass] || [])
        sum += object_probability(obj);
    return sum;
}

function select_from_class(oclass) {
    const entries = objectsByClass[oclass] || [];
    const total = class_probability_total(oclass);
    let prob = rnd(total);
    for (const obj of entries) {
        prob -= object_probability(obj);
        if (prob <= 0) return obj.otyp;
    }
    return entries[0]?.otyp ?? STRANGE_OBJECT;
}

export function rnd_class(first, last) {
    if (last > first) {
        let sum = 0;
        for (let i = first; i <= last; i++)
            sum += object_probability(objects[i]);
        if (!sum)
            return rn1(last - first + 1, first);
        let x = rnd(sum);
        for (let i = first; i <= last; i++) {
            x -= object_probability(objects[i]);
            if (x <= 0) return i;
        }
    }
    return first === last ? first : STRANGE_OBJECT;
}

/* C ref: makemon.c mvitals[] mvflags — G_GENOD | G_EXTINCT. */
const G_GONE = 0x03;
function mvitals_flags(mndx) { return game.mvitals?.[mndx]?.mvflags ?? 0; }

// C ref: gu.urole.mnum — the mons[] index of the hero's role monster.
// js/roles.js numbers roles 0..12 in mons[] order starting at PM_ARCHEOLOGIST
// ([[umonnum-is-a-role-index]]: u.umonnum is that same role index, NOT a
// mons[] index), so resolve it from the species name rather than a literal.
function urole_mnum() {
    const base = PM('archeologist');
    const m = game.urole?.mnum;
    return (base >= 0 && Number.isInteger(m)) ? base + m : base;
}

export function next_ident() {
    // C mkobj.c:508 next_ident(): returns the current context.ident, then
    // advances it by rnd(2) (so half the potential ids are skipped). The
    // single rnd(2) is the only RNG consumed; we also track the running id so
    // o_id values match C (some code keys on the low bits of o_id).
    if (game.context_ident == null) game.context_ident = 2; /* allmain.c:773 */
    const res = game.context_ident;
    game.context_ident += rnd(2);
    if (!game.context_ident) game.context_ident = rnd(2) + 1; /* id 1 reserved */
    return res;
}

// C ref: eat.c eaten_stat(base, obj) — scale `base` by the fraction of the
// item's nutrition that is still left, never below 1.
function eaten_stat(base, obj) {
    const full = (obj.otyp === CORPSE)
        ? mon_cnutrit(obj.corpsenm)
        : food_nutrit(obj.otyp);
    let uneaten = obj.oeaten | 0;
    if (full && uneaten > full) uneaten = full;
    const v = full ? Math.trunc(base * uneaten / full) : 0;
    return v < 1 ? 1 : v;
}

// C ref: artifact.c confers_luck(obj) — a luckstone, or an artifact with
// SPFX_LUCK.  Only the luckstone arm can be answered from this file (artifact
// data lives in artifact.js), and it is the arm that matters for the objects
// mkobj.c creates.
function confers_luck(obj) {
    return obj?.otyp === LUCKSTONE || !!(obj?.oartifact && obj?.spfx_luck);
}

// C ref: attrib.c stone_luck(include_uncursed) / set_moreluck() — u.moreluck is
// +-LUCKADD while a luck-conferring stone is carried, and Luck (= u.uluck +
// u.moreluck) is the modulus-shifting input to every rnl() call.  gi.invent is
// game.invent in this port; nothing else reads it here.
function set_moreluck() {
    const u = game.u;
    if (!u) return;
    let bonchance = 0, carrying_luckstone = false;
    for (const o of (Array.isArray(game.invent) ? game.invent : [])) {
        if (o.otyp === LUCKSTONE) carrying_luckstone = true;
        if (confers_luck(o)) {
            if (o.cursed) bonchance -= (o.quan || 1);
            else bonchance += (o.quan || 1);        /* include_uncursed */
        }
    }
    const luckbon = Math.sign(bonchance);
    if (!luckbon && !carrying_luckstone) u.moreluck = 0;
    else if (luckbon >= 0) u.moreluck = LUCKADD;
    else u.moreluck = -LUCKADD;
}

function carried(obj) { return obj?.where === 'invent' || obj?.where === OBJ_INVENT; }

// C ref: artifact.c arti_light_radius(obj) — only artifacts light up, and the
// radius varies with bless/curse state.  Returns 0 for everything mkobj.c can
// create by itself, which makes maybe_adjust_light() a no-op for them.
function arti_light_radius(obj) {
    if (!obj?.oartifact || !obj?.lamplit) return 0;
    return obj.cursed ? 1 : obj.blessed ? 3 : 2;
}

// C ref: mkobj.c maybe_adjust_light(obj, old_range) — an artifact light source
// whose radius changed with its bless/curse state re-registers and reports
// "shines brighter"/"less brightly".  light.js owns the light-source list, so
// this records the new radius and leaves the (RNG-free) message to the caller.
export function maybe_adjust_light(obj, old_range) {
    if (!obj) return;
    const new_range = arti_light_radius(obj);
    if (new_range !== old_range) obj.light_radius = new_range;
}

/*
 *      bless(), curse(), unbless(), uncurse() -- any relevant message
 *      about glowing amber/black/&c should be delivered prior to calling
 *      these routines to make the actual curse/bless state change.
 */

// C ref: mkobj.c bless(otmp).
export function bless(otmp) {
    if (!otmp) return;
    if (otmp.oclass === COIN_CLASS) return;
    const old_light = otmp.lamplit ? arti_light_radius(otmp) : 0;
    otmp.cursed = false;
    otmp.blessed = true;
    if (carried(otmp) && confers_luck(otmp)) set_moreluck();
    else if (otmp.otyp === BAG_OF_HOLDING) otmp.owt = weight(otmp);
    else if (otmp.otyp === FIGURINE && otmp.timed)
        stop_object_timer(otmp, FIG_TRANSFORM);
    if (otmp.lamplit) maybe_adjust_light(otmp, old_light);
}

// C ref: mkobj.c unbless(otmp) — no COIN_CLASS early-out (unlike bless).
export function unbless(otmp) {
    if (!otmp) return;
    const old_light = otmp.lamplit ? arti_light_radius(otmp) : 0;
    otmp.blessed = false;
    if (carried(otmp) && confers_luck(otmp)) set_moreluck();
    else if (otmp.otyp === BAG_OF_HOLDING) otmp.owt = weight(otmp);
    if (otmp.lamplit) maybe_adjust_light(otmp, old_light);
}

// C ref: mkobj.c curse(otmp).  The two-handed-weapon reset_remarm() and the
// twoweapon drop_uswapwep() arms live in wield.c/do_wear.c; the parts that
// change object state (and so the hero's weight/luck/timers) are here.
export function curse(otmp) {
    if (!otmp) return;
    if (otmp.oclass === COIN_CLASS) return;
    const old_light = otmp.lamplit ? arti_light_radius(otmp) : 0;
    const already_cursed = otmp.cursed;
    otmp.blessed = false;
    otmp.cursed = true;
    if (carried(otmp) && confers_luck(otmp)) {
        set_moreluck();
    } else if (otmp.otyp === BAG_OF_HOLDING) {
        otmp.owt = weight(otmp);
    } else if (otmp.otyp === FIGURINE) {
        // C: a cursed figurine of a still-living species gets a transform timer.
        if (otmp.corpsenm != null && otmp.corpsenm !== NON_PM
            && !dead_species(otmp.corpsenm, true)
            && (carried(otmp) || otmp.where === 'minvent'
                || otmp.where === OBJ_MINVENT))
            attach_fig_transform_timeout(otmp);
    } else if (otmp.oclass === SPBOOK_CLASS) {
        // C: `if (!already_cursed) book_cursed(otmp);` — read.c interrupts the
        // hero's study; the interrupt itself belongs to read.js.
        if (!already_cursed) otmp.book_just_cursed = 1;
    }
    if (otmp.lamplit) maybe_adjust_light(otmp, old_light);
}

// C ref: mkobj.c uncurse(otmp).
export function uncurse(otmp) {
    if (!otmp) return;
    const old_light = otmp.lamplit ? arti_light_radius(otmp) : 0;
    otmp.cursed = false;
    if (carried(otmp) && confers_luck(otmp)) set_moreluck();
    else if (otmp.otyp === BAG_OF_HOLDING) otmp.owt = weight(otmp);
    else if (otmp.otyp === FIGURINE && otmp.timed)
        stop_object_timer(otmp, FIG_TRANSFORM);
    if (otmp.lamplit) maybe_adjust_light(otmp, old_light);
}

// C ref: mkobj.c bcsign(otmp) — !!blessed - !!cursed.
export function bcsign(otmp) {
    return (otmp?.blessed ? 1 : 0) - (otmp?.cursed ? 1 : 0);
}

// C ref: mkobj.c set_bknown(obj, onoff) — the bless/curse-state-known flag,
// which is what makes doname() print "blessed"/"cursed"/"uncursed"; a change to
// an inventory object refreshes the open inventory window (but not during
// startup, moves <= 1).
export function set_bknown(obj, onoff) {
    if (!obj) return;
    const v = onoff ? 1 : 0;
    if ((obj.bknown ? 1 : 0) !== v) {
        obj.bknown = v;
        if ((obj.where === 'invent' || obj.where === OBJ_INVENT)
            && (game.moves ?? 0) > 1)
            game._invent_dirty = true;   /* update_inventory() */
    }
}

export function blessorcurse(otmp, chance) {
    if (!otmp || otmp.blessed || otmp.cursed) return;
    if (!rn2(chance)) {
        if (!rn2(2)) curse(otmp);
        else bless(otmp);
    }
}

// Artifact list (C: artilist.h). Only the fields mk_artifact()/nartifact_exist()
// need for RNG parity: the artifact index m (1-based, matching artiexist[]), its
// base object otyp, whether SPFX_NOGEN is set, the gift_value, and the role it is
// a first choice for. The quest artifacts and Excalibur carry SPFX_NOGEN so they
// are never random-generated; they are omitted because nogen entries are skipped
// before they can be selected and they do not contribute to the eligible list.
// (They DO count toward artiexist once created by other means, but in the early
// game covered by the parity sessions none are created, and nartifact_exist()
// only matters via the random-generation path implemented here.)
// [m, otyp, gift_value, role(PM_ or -1)]
const ARTIFACTS = [
    [2, 58 /*RUNESWORD*/, 9, -1],        // Stormbringer
    [3, 76 /*WAR_HAMMER*/, 8, -1],       // Mjollnir (PM_VALKYRIE; first-choice only matters for by_align)
    [4, 45 /*BATTLE_AXE*/, 8, -1],       // Cleaver
    [5, 36 /*ORCISH_DAGGER*/, 5, -1],    // Grimtooth
    [6, 53 /*ELVEN_BROADSWORD*/, 4, -1], // Orcrist
    [7, 35 /*ELVEN_DAGGER*/, 1, -1],     // Sting
    [8, 38 /*ATHAME*/, 7, -1],           // Magicbane
    [9, 54 /*LONG_SWORD*/, 9, -1],       // Frost Brand
    [10, 54 /*LONG_SWORD*/, 5, -1],      // Fire Brand
    [11, 52 /*BROADSWORD*/, 5, -1],      // Dragonbane
    [12, 74 /*SILVER_MACE*/, 3, -1],     // Demonbane
    [13, 51 /*SILVER_SABER*/, 4, -1],    // Werebane
    [14, 51 /*SILVER_SABER*/, 10, -1],   // Grayswandir
    [15, 54 /*LONG_SWORD*/, 4, -1],      // Giantslayer
    [16, 76 /*WAR_HAMMER*/, 1, -1],      // Ogresmasher
    [17, 75 /*MORNING_STAR*/, 1, -1],    // Trollsbane
    [18, 54 /*LONG_SWORD*/, 5, -1],      // Vorpal Blade
    [19, 56 /*KATANA*/, 8, -1],          // Snickersnee
    [20, 54 /*LONG_SWORD*/, 6, -1],      // Sunsword
];

function nartifact_exist() {
    const set = game.artiexist;
    if (!set) return 0;
    return set.size;
}

// C artifact.c:172 mk_artifact() restricted to the A_NONE / random-generation
// case used by mksobj_init (by_align == FALSE). For an object whose otyp has
// unused non-NOGEN artifacts, picks one with rn2(n) and marks it created. For a
// generic item with no matching artifact (the common case) it consumes no RNG
// and leaves the object unchanged. Returns the (possibly artifacted) obj.
function mk_artifact(otmp) {
    const o_typ = otmp.otyp;
    const oc_unique = !!(objects[o_typ]?.flags & F_UNIQUE);
    if (oc_unique) return otmp; // unique base items never become random artifacts
    if (!game.artiexist) game.artiexist = new Set();
    const eligible = [];
    for (const [m, otyp /*, gv, role*/] of ARTIFACTS) {
        if (game.artiexist.has(m)) continue;       // artiexist[m].exists
        // gift_value > 99 never happens (max 12); role first-choice only used by_align
        if (otyp === o_typ) eligible.push(m);
    }
    const n = eligible.length;
    if (n) {
        const m = eligible[rn2(n)];
        otmp.oeroded = 0;
        otmp.oeroded2 = 0;
        otmp.oartifact = m;
        game.artiexist.add(m);                     // artifact_origin -> exists
    }
    return otmp;
}

function hasFlag(otmp, flag) {
    return !!(objects[otmp.otyp]?.flags & flag);
}

// C ref: objclass.h:209 is_damageable(otmp) — the OR of the five erosion
// predicates.  It used to re-derive all five inline, which is how the
// is_flammable FIRE_RES arm came to be missing from one copy and not the other.
function is_damageable(otmp) {
    if (!objects[otmp.otyp]) return false;
    return is_rustprone(otmp) || is_flammable(otmp) || is_rottable(otmp)
        || is_corrodeable(otmp) || is_crackable(otmp);
}

function erosion_matters(otmp) {
    return otmp.oclass === WEAPON_CLASS || otmp.oclass === ARMOR_CLASS
        || otmp.oclass === BALL_CLASS || otmp.oclass === CHAIN_CLASS
        || (otmp.oclass === TOOL_CLASS && hasFlag(otmp, F_WEPTOOL));
}

function may_generate_eroded(otmp) {
    const moves = game.moves ?? 1;
    if (moves <= 1 && !game.in_mklev) return false;
    if (otmp.oerodeproof || !erosion_matters(otmp) || !is_damageable(otmp)) return false;
    if (otmp.otyp === WORM_TOOTH || otmp.otyp === UNICORN_HORN) return false;
    if (otmp.oartifact) return false;
    return true;
}

// C ref: mkobj.c is_flammable(otmp):2269.  Candles burn but are not "flammable"
// (they can't take fire damage and can't be fireproofed), and neither is
// anything whose oc_oprop is FIRE_RES -- the arm the old copy dropped, so a red
// dragon scale mail / ring of fire resistance answered by material alone.
function is_flammable(otmp) {
    const obj = objects[otmp.otyp];
    const mat = obj?.material ?? NO_MATERIAL;
    if (otmp.otyp === TALLOW_CANDLE || otmp.otyp === WAX_CANDLE) return false;
    if (obj?.oc_oprop === 1 /* FIRE_RES */ || otmp.otyp === WAN_FIRE) return false;
    return (mat <= WOOD && mat !== LIQUID) || mat === PLASTIC;
}
function is_rottable(otmp) {
    const mat = objects[otmp.otyp]?.material ?? NO_MATERIAL;
    return ((mat <= WOOD && mat !== LIQUID) || mat === DRAGON_HIDE);
}
function is_rustprone(otmp) { return objects[otmp.otyp]?.material === IRON; }
function is_corrodeable(otmp) {
    const mat = objects[otmp.otyp]?.material;
    return mat === COPPER || mat === IRON;
}
function is_crackable(otmp) {
    return objects[otmp.otyp]?.material === GLASS && otmp.oclass === ARMOR_CLASS;
}

function mkobj_erosions(otmp) {
    if (!may_generate_eroded(otmp)) return;
    if (!rn2(100)) {
        otmp.oerodeproof = 1;
    } else {
        if (!rn2(80) && (is_flammable(otmp) || is_rustprone(otmp) || is_crackable(otmp))) {
            do { otmp.oeroded = (otmp.oeroded || 0) + 1; }
            while (otmp.oeroded < 3 && !rn2(9));
        }
        if (!rn2(80) && (is_rottable(otmp) || is_corrodeable(otmp))) {
            do { otmp.oeroded2 = (otmp.oeroded2 || 0) + 1; }
            while (otmp.oeroded2 < 3 && !rn2(9));
        }
    }
    if (!rn2(1000)) otmp.greased = 1;
}

function rndmonnum() {
    return rndmonst_adj(0, 0)?.pmidx ?? 0;
}

function rndmonnum_adj(minadj = 0, maxadj = 0) {
    return rndmonst_adj(minadj, maxadj)?.pmidx ?? 0;
}

function mkcorpstat_spe(corpsenm) {
    const ptr = monster_by_pmidx(corpsenm);
    if (ptr?.gender === 'neuter') return CORPSTAT_NEUTER;
    if (ptr?.gender === 'female') return CORPSTAT_FEMALE;
    if (ptr?.gender === 'male') return CORPSTAT_MALE;
    return rn2(2) ? CORPSTAT_FEMALE : CORPSTAT_MALE;
}

function corpse_mon_name(corpsenm) {
    return monster_by_pmidx(corpsenm)?.name ?? '';
}

// C ref: mkobj.c start_corpse_timeout() — "lizards and lichen don't rot or
// revive".
function is_lizard_or_lichen(corpsenm) {
    return corpsenm === PM('lizard') || corpsenm === PM('lichen');
}

// C ref: mondata.h is_rider(ptr) — Death / Pestilence / Famine.  Exported so
// zap.c's obj_resists() can apply its Rider-corpse exemption.
// Body is the branch's PM()-based lookup: this merge dropped the corpse_mon_name
// / PM_DEATH helpers the previous implementation relied on, so keeping the old
// body crashed level generation (makeniche -> mkcorpstat -> start_corpse_timeout)
// and took 7 sessions to 0 matched. `export` is retained because zap.js's
// obj_resists() imports it for the Rider-corpse exemption.
export function is_rider_pm(corpsenm) {
    return corpsenm === PM('Death') || corpsenm === PM('Pestilence')
        || corpsenm === PM('Famine');
}

function is_troll_pm(corpsenm) {
    const ptr = monster_by_pmidx(corpsenm);
    return ptr?.mlet === 'T' || /\btroll\b/.test(ptr?.name ?? '');
}

function zombie_form_pm(corpsenm) {
    const ptr = monster_by_pmidx(corpsenm);
    if (!ptr) {
        if (corpsenm >= PM('archeologist') && corpsenm <= PM('wizard'))
            return 0;
        return NON_PM;
    }
    switch (ptr.mlet) {
    case 'k':
    case 'o':
    case 'G':
    case '@':
    case 'K':
        return 0;
    case 'h':
        return ptr.name === 'dwarf' ? 0 : NON_PM;
    default:
        return NON_PM;
    }
}

function special_corpse(corpsenm) {
    return is_lizard_or_lichen(corpsenm)
        || is_troll_pm(corpsenm)
        || is_rider_pm(corpsenm);
}

function start_timer(when, kind, action, obj) {
    if (obj && kind === TIMER_OBJECT) {
        obj.timed = true;
        // C ref: timeout.c start_timer() — gnu->timeout = svm.moves + when
        // (the caller's `when` is turns-from-now; the timer fires at that
        // absolute turn).
        obj.timer = { when: (game.moves ?? 0) + when, kind, action };
    }
    return true;
}

function obj_stop_timers(obj) {
    if (!obj) return;
    obj.timed = false;
    delete obj.timer;
}

// C ref: timeout.c run_timers() — dispatch expired TIMER_OBJECT timers.
// ROT_CORPSE on a floor object (dig.c rot_corpse() -> rot_organic() silently
// frees it; no message, no RNG) and SHRINK_GLOB, whose handler mkobj.c
// shrink_glob() is ported below and DOES draw (start_glob_timeout's rn2(5)) each
// time it reschedules.  REVIVE_MON / ZOMBIFY_MON / FIG_TRANSFORM need
// makemon()-side handlers that live outside this file and stay unfired.
export function run_object_timers() {
    const moves = game.moves ?? 0;
    // Globs can be anywhere; collect the timed ones from every list mkobj.c
    // maintains so a glob in a pack or a container keeps shrinking as in C.
    const globs = [];
    const scan = (list) => {
        if (!Array.isArray(list)) return;
        for (const o of list) {
            if (o.timed && o.timer?.action === SHRINK_GLOB && o.timer.when <= moves)
                globs.push(o);
            if (Array.isArray(o.cobj)) scan(o.cobj);
        }
    };
    scan(game.level?.objects);
    scan(game.invent);
    scan(game.level?.buriedobjlist);
    scan(game.migrating_objs);
    for (const mon of (Array.isArray(game.level?.monsters) ? game.level.monsters : []))
        scan(mon.minvent);
    for (const g of globs) shrink_glob(g, g.timer?.when ?? moves);

    const objs = game.level?.objects;
    if (!Array.isArray(objs)) return;
    for (let i = objs.length - 1; i >= 0; i--) {
        const obj = objs[i];
        if (obj.timed && obj.timer && obj.timer.action === ROT_CORPSE
            && obj.timer.when <= moves) {
            objs.splice(i, 1);
        }
    }
}

function rider_revival_time(body, retry = false) {
    const minturn = retry ? 3 : body.corpsenm === PM('Death') ? 6 : 12;
    for (let when = minturn; when < 67; when++) {
        if (!rn2(3))
            return when;
    }
    return 67;
}

export function start_corpse_timeout(body) {
    if (!body || is_lizard_or_lichen(body.corpsenm))
        return;

    let action = ROT_CORPSE;
    const rot_adjust = game.in_mklev ? 25 : 10;
    const age = Math.max(game.moves ?? 1, 1) - (body.age ?? 0);
    let when = age > ROT_AGE ? rot_adjust : ROT_AGE - age;
    when += rnz(rot_adjust) - rot_adjust;

    if (is_rider_pm(body.corpsenm)) {
        action = REVIVE_MON;
        when = rider_revival_time(body, false);
    } else if (is_troll_pm(body.corpsenm)) {
        for (let reviveAge = 2; reviveAge <= TAINT_AGE; reviveAge++) {
            if (!rn2(TROLL_REVIVE_CHANCE)) {
                action = REVIVE_MON;
                when = reviveAge;
                break;
            }
        }
    } else if ((game.gz?.zombify || game.zombify)
        && zombie_form_pm(body.corpsenm) !== NON_PM && !body.norevive) {
        action = ZOMBIFY_MON;
        when = rn1(15, 5);
    }

    start_timer(when, TIMER_OBJECT, action, body);
}

// C ref: obj.h MAX_EGG_HATCH_TIME — longest an egg can remain unhatched.
const MAX_EGG_HATCH_TIME = 200;

// C ref: timeout.c stop_timer(func_index, arg) — remove the object's timer of
// this action and return its REMAINING turns (`timeout - svm.moves`), or 0 when
// there was none.  Consumes no RNG.
function stop_object_timer(obj, action) {
    if (!obj?.timed || obj.timer?.action !== action) return 0;
    const remaining = obj.timer.when - (game.moves ?? 0);
    obj.timed = false;
    delete obj.timer;
    return remaining;
}

// C ref: timeout.c attach_fig_transform_timeout(figurine):1204 — replace any
// existing FIG_TRANSFORM timer with one that fires in rnd(9000)+200 turns.
// The draw is rnd(9000), NOT rn1(9000,1000).
function attach_fig_transform_timeout(figurine) {
    if (!figurine) return;
    stop_object_timer(figurine, FIG_TRANSFORM);
    const i = rnd(9000) + 200;
    start_timer(i, TIMER_OBJECT, FIG_TRANSFORM, figurine);
}

// C ref: timeout.c attach_egg_hatch_timeout(egg, when) — decide if and when a
// typed egg hatches.  `when` is non-zero only when re-creating an existing
// hatch timer; for a fresh egg it is 0 and the schedule is rolled here.  This
// mimics the old hatch_it(), which tried once a turn from age 151 to 200
// inclusive and hatched on a roll of rnd(age) exceeding 150 — so the loop draws
// rnd(151), rnd(152), ... until one exceeds 150 (chance of hatching > 99.999%).
function attach_egg_hatch_timeout(egg, when) {
    stop_object_timer(egg, HATCH_EGG); /* stop previous timer, if any */
    if (!when) {
        for (let i = (MAX_EGG_HATCH_TIME - 50) + 1; i <= MAX_EGG_HATCH_TIME; i++) {
            if (rnd(i) > 150) {
                when = i; /* egg will hatch */
                break;
            }
        }
    }
    if (when)
        start_timer(when, TIMER_OBJECT, HATCH_EGG, egg);
}

// C ref: do_name.c sir_Terry_novels[] — the 41 Discworld titles a "novel"
// (SPE_NOVEL, the Tribute book) can carry, verbatim and in C's order.
const SIR_TERRY_NOVELS = [
    'The Colour of Magic', 'The Light Fantastic', 'Equal Rites',
    'Mort', 'Sourcery', 'Wyrd Sisters',
    'Pyramids', 'Guards! Guards!', 'Eric',
    'Moving Pictures', 'Reaper Man', 'Witches Abroad',
    'Small Gods', 'Lords and Ladies', 'Men at Arms',
    'Soul Music', 'Interesting Times', 'Maskerade',
    'Feet of Clay', 'Hogfather', 'Jingo',
    'The Last Continent', 'Carpe Jugulum', 'The Fifth Elephant',
    'The Truth', 'Thief of Time', 'The Last Hero',
    'The Amazing Maurice and His Educated Rodents', 'Night Watch', 'The Wee Free Men',
    'Monstrous Regiment', 'A Hat Full of Sky', 'Going Postal',
    'Thud!', 'Wintersmith', 'Making Money',
    'Unseen Academicals', 'I Shall Wear Midnight', 'Snuff',
    'Raising Steam', 'The Shepherd\'s Crown',
];

// C ref: do_name.c noveltitle(novidx) — ALWAYS draws rn2(SIZE(sir_Terry_novels))
// == rn2(41), then keeps an already-assigned index if the caller has one.  mksobj
// calls this for every novel it creates (mkobj.c:1248
// `otmp = oname(otmp, noveltitle(&otmp->novelidx), ONAME_NO_FLAGS)`), so the draw
// happens once per novel — a shop that stocks one consumed it and we did not.
function noveltitle(obj) {
    const k = SIR_TERRY_NOVELS.length;   // 41
    let j = rn2(k);
    if (obj) {
        if (obj.novelidx === -1 || obj.novelidx == null) obj.novelidx = j;
        else if (obj.novelidx >= 0 && obj.novelidx < k) j = obj.novelidx;
    }
    return SIR_TERRY_NOVELS[j];
}

// C ref: mkobj.c set_corpsenm() — change a corpse/statue/figurine's monster id
// and (re)start its decay/revive timer.  Only the CORPSE branch is reachable
// for the themed-room buried-corpse fill; the old timer stop and weight recalc
// consume no RNG, so the only RNG side-effect is start_corpse_timeout().
export function set_corpsenm(obj, id) {
    if (!obj) return;
    // C: `long when = 0L; if (obj->otyp == EGG) when = stop_timer(HATCH_EGG,
    // obj_to_any(obj));` — a re-typed egg hands its remaining hatch time to
    // attach_egg_hatch_timeout so it keeps the original schedule instead of
    // rolling a fresh one.  A newly created egg has no timer, so when stays 0.
    const old_id = obj.corpsenm;
    let when = 0;
    if (obj.timed) {
        if (obj.otyp === EGG) when = stop_object_timer(obj, HATCH_EGG);
        else obj_stop_timers(obj);              /* corpse or figurine */
    }
    // C ref: mkobj.c:1334 — oeaten is "nutrition left" AND the basis for the
    // HP a monster revived from a partly eaten corpse gets, so re-typing a
    // partly eaten corpse rescales it by the ratio of the two species' cnutrit
    // (a <foo> corpse revived as a <foo> zombie can have a different cnutrit).
    if (obj.otyp === CORPSE && (obj.oeaten | 0) !== 0) {
        const oldn = mon_cnutrit(old_id), newn = mon_cnutrit(id);
        if (oldn && oldn !== newn)
            obj.oeaten = Math.trunc((obj.oeaten | 0) * newn / oldn);
    }
    obj.corpsenm = id;
    if (obj.otyp === CORPSE) {
        start_corpse_timeout(obj);
        obj.owt = weight(obj);
    } else if (obj.otyp === FIGURINE) {
        // C ref: mkobj.c:1353 — a figurine of a still-living species that the
        // hero or a monster is CARRYING gets a transform timer (rnd(9000)+200).
        if (id != null && id !== NON_PM && !dead_species(id, true)
            && (obj.where === 'invent' || obj.where === OBJ_INVENT
                || obj.where === 'minvent' || obj.where === OBJ_MINVENT))
            attach_fig_transform_timeout(obj);
        obj.owt = weight(obj);
    } else if (obj.otyp === EGG) {
        // C: only a typed egg of a still-living species gets a hatch timer.
        // Note C does NOT recompute owt in this branch (an egg's weight does
        // not depend on its species), so neither do we.
        if (id != null && id !== NON_PM && !dead_species(id, true))
            attach_egg_hatch_timeout(obj, when);
    } else {
        obj.owt = weight(obj);
    }
}

// C ref: zap.c obj_resists(obj, ochance, achance) — burying a non-artifact,
// non-special corpse via bury_an_obj() consumes a single rn2(100).  We expose
// this minimal form (the only callsite that matters for level-gen RNG parity is
// bury_an_obj's obj_resists(otmp, 0, 0) on a buried themed-room corpse).
export function obj_resists_rng() {
    return rn2(100);
}

// C ref: objects.h oc_weight — the base weight of a single object of each
// otyp.  The JS object table (OBJECT_DATA) omits the weight column, so weight()
// historically returned 1 for everything except coins, leaving floor objects
// with owt==1.  That broke mon.c can_carry()/curr_mon_load() for pets: a
// container (chest base 600, ice box 900, large box 350) was treated as
// weightless.  BASE_OC_WEIGHT supplies the C oc_weight for the object types
// whose true weight is load-bearing for the carry decision (every container so
// the contents recursion has a real base, plus heavy single items so a small
// pet rejects them).
const BASE_OC_WEIGHT = Object.freeze({
    // containers (objects.h CONTAINER wt column)
    [LARGE_BOX]: 350, [CHEST]: 600, [ICE_BOX]: 900,
    [SACK]: 15, [OILSKIN_SACK]: 15, [BAG_OF_HOLDING]: 15, [BAG_OF_TRICKS]: 15,
    // heavy / structural single items
    [CRYSTAL_BALL]: 150, [TINNING_KIT]: 100,
    [BOULDER]: 6000, [STATUE]: 2500, [HEAVY_IRON_BALL]: 480, [IRON_CHAIN]: 120,
});

// C ref: objects.h objects[].oc_weight — the per-otyp base encumbrance, dumped
// byte-for-byte from the recorder's compiled obj_init[] table and re-keyed by
// JS otyp via object NAME (the JS otyp numbering shifts by +1 relative to C
// after otyp 363 because C carries an extra SCR_MAIL entry, so a raw C-index
// copy would be off-by-one for boulders/gems/etc).  Used by base_oc_weight()
// so mon.c can_carry()/curr_mon_load() see real weights: a RING_MAIL (250) or
// other heavy armor on the floor is now correctly rejected by a small pet,
// matching C's dog_goal APPORT scan (the rn2(8)/obj_resists stream).  Zero
// entries (generic dummies, corpse — computed by species) fall through to the
// existing per-class / dynamic logic.  Class-uniform items (rings, amulets,
// potions, scrolls, books, wands) are intentionally omitted here and resolved
// by CLASS_OC_WEIGHT; coins/corpses/containers/statues keep their special
// cases in weight() regardless of this table.
const OC_WEIGHT = Object.freeze({
    364:5, /* SCR_MAIL */
    18:1, 19:1, 20:1, 21:1, 22:1, 23:1, 24:1, 25:1, 26:5, 27:30,
    28:30, 29:30, 30:35, 31:36, 32:20, 33:25, 34:10, 35:10, 36:10, 37:12, 38:10, 39:5, 40:5, 41:5,
    42:20, 43:20, 44:60, 45:120, 46:30, 47:30, 48:30, 49:30, 50:40, 51:40, 52:70, 53:70, 54:40, 55:150,
    56:40, 57:60, 58:40, 59:80, 60:50, 61:50, 62:75, 63:150, 64:120, 65:125, 66:60, 67:80, 68:120, 69:150,
    70:100, 71:120, 72:180, 73:30, 74:36, 75:120, 76:50, 77:30, 78:20, 79:40, 80:15, 81:15, 82:20, 83:30,
    84:30, 85:30, 86:30, 87:3, 88:50, 89:3, 90:30, 91:40, 92:3, 93:4, 94:4, 95:10, 96:40, 97:30,
    98:50, 99:50, 100:50, 101:40, 102:40, 103:40, 104:40, 105:40, 106:40, 107:40, 108:40, 109:40, 110:40, 111:40,
    112:40, 113:40, 114:40, 115:40, 116:40, 117:40, 118:40, 119:40, 120:40, 121:450, 122:415, 123:450, 124:400, 125:350,
    126:150, 127:150, 128:300, 129:300, 130:250, 131:200, 132:250, 133:250, 134:150, 135:30, 136:5, 137:5, 138:3, 139:10,
    140:10, 141:10, 142:10, 143:15, 144:10, 145:15, 146:10, 147:10, 148:10, 149:10, 150:30, 151:30, 152:30, 153:40,
    154:50, 155:50, 156:100, 157:100, 158:50, 159:10, 160:10, 161:30, 162:10, 163:10, 164:50, 165:20, 166:20, 167:15,
    168:20, 169:15, 170:50, 171:20, 172:15, 173:3, 174:3, 175:3, 176:3, 177:3, 178:50, 179:3, 180:3, 181:3,
    182:3, 183:50, 184:3, 185:3, 186:3, 187:3, 188:3, 189:3, 190:3, 191:3, 192:3, 193:3, 194:7, 195:3,
    196:7, 197:3, 198:50, 199:20, 200:3, 201:20, 202:20, 203:20, 204:20, 205:20, 206:20, 207:20, 208:20, 209:20,
    210:20, 211:20, 212:20, 213:20, 214:350, 215:600, 216:900, 217:15, 218:15, 219:15, 220:15, 221:3, 222:4, 223:1,
    224:2, 225:2, 226:30, 227:20, 228:20, 229:12, 230:13, 231:150, 232:3, 233:2, 234:5, 235:200, 236:12, 237:4,
    238:100, 239:4, 240:15, 241:50, 242:2, 243:200, 244:200, 245:3, 246:3, 247:5, 248:5, 249:18, 250:18, 251:18,
    252:18, 253:30, 254:30, 255:30, 256:10, 257:25, 258:25, 259:100, 260:30, 261:20, 262:10, 263:10, 264:10,
    266:1, 267:1, 268:1, 269:400, 270:5, 271:20, 272:20, 273:20, 274:20, 275:1, 276:1, 277:2, 278:2, 279:2,
    280:5, 281:2, 282:2, 283:1, 284:1, 285:5, 286:2, 287:10, 288:2, 289:1, 290:2, 291:5, 292:15, 293:20,
    294:10, 295:10, 296:10, 297:20, 298:50, 299:20, 300:20, 301:20, 302:20, 303:50, 304:20, 305:50, 306:20, 307:50,
    308:50, 309:20, 310:7, 311:20, 312:20, 313:20, 314:20, 315:20, 316:7, 317:20, 318:20, 319:20, 320:20, 321:20,
    322:20, 323:5, 324:5, 325:50, 326:5, 327:50, 328:5, 329:7, 330:5, 331:5, 332:7, 333:7, 334:5, 335:5,
    336:50, 337:50, 338:5, 339:7, 340:5, 341:5, 342:5, 343:5, 365:50, 366:50, 367:7, 368:50, 369:50, 370:7,
    371:50, 372:7, 373:50, 374:50, 375:50, 376:50, 377:50, 378:50, 379:50, 380:7, 381:50, 382:7, 383:50, 384:50,
    385:50, 386:50, 387:50, 388:50, 389:50, 390:50, 391:50, 392:50, 393:50, 394:50, 395:50, 396:50, 397:50, 398:50,
    399:7, 400:50, 401:50, 402:7, 403:50, 404:50, 405:50, 406:50, 407:50, 408:10, 409:50, 410:7, 411:7, 412:7,
    413:7, 414:7, 415:7, 416:7, 417:7, 418:7, 419:7, 420:7, 421:7, 422:7, 423:7, 424:7, 425:7, 426:7,
    427:7, 428:7, 429:7, 430:7, 431:7, 432:7, 433:7, 434:7, 438:1, 439:1, 440:1, 441:1, 442:1, 443:1,
    444:1, 445:1, 446:1, 447:1, 448:1, 449:1, 450:1, 451:1, 452:1, 453:1, 454:1, 455:1, 456:1, 457:1,
    458:1, 459:1, 460:1, 461:1, 462:1, 463:1, 464:1, 465:1, 466:1, 467:1, 468:1, 469:1, 470:10, 471:500,
    472:10, 473:10, 474:10, 475:6000, 476:2500, 477:480, 478:120, 479:1, 480:1,
});

// C ref: objclass.h Is_container(otmp) — LARGE_BOX..BAG_OF_TRICKS.
// C ref: obj.h:327 Is_pudding(o) — the four pudding globs.
export function Is_pudding(obj) {
    return obj?.otyp >= GLOB_OF_GRAY_OOZE && obj?.otyp <= GLOB_OF_BLACK_PUDDING;
}

// C ref: obj.h:339 Is_mbag(o) — a "magic bag", i.e. one that can eat items.
export function Is_mbag(obj) {
    return obj?.otyp === BAG_OF_HOLDING || obj?.otyp === BAG_OF_TRICKS;
}

function Is_container(otyp) {
    return otyp >= LARGE_BOX && otyp <= BAG_OF_TRICKS;
}

// Class-uniform base weights from objects.h (the class macros hard-code these
// rather than carrying a per-item wt argument).
const CLASS_OC_WEIGHT = Object.freeze({
    [RING_CLASS]: 3,
    [AMULET_CLASS]: 20,
    [POTION_CLASS]: 20,
    [SCROLL_CLASS]: 5,
    [SPBOOK_CLASS]: 50,
    [WAND_CLASS]: 7,
});

// C ref: objects.h objects[].oc_cost — the base list price of one unit of each
// otyp, dumped from the recorder's compiled obj_init[] table and re-keyed by
// object NAME + class (C and JS agree on every otyp today, but the name key is
// what makes that verifiable rather than assumed).  The JS object table
// (OBJECT_DATA) omits the cost column, so shk.c getprice()/get_cost() had no
// prices at all and every shop item was silently free.  Zero-cost entries
// (generic dummies, rocks) are omitted; base_oc_cost() reads 0 for those.
const OC_COST = Object.freeze({
    18: 2, 19: 2, 20: 2, 21: 5, 22: 4, 23: 2, 24: 2, 25: 5, 26: 20, 27: 3,
    28: 3, 29: 3, 30: 3, 31: 40, 32: 3, 33: 5, 34: 4, 35: 4, 36: 4, 37: 40,
    38: 4, 39: 6, 40: 4, 41: 4, 42: 2, 43: 100, 44: 8, 45: 40, 46: 10, 47: 10,
    48: 10, 49: 10, 50: 15, 51: 75, 52: 10, 53: 10, 54: 15, 55: 50, 56: 80,
    57: 500, 58: 300, 59: 10, 60: 6, 61: 5, 62: 6, 63: 10, 64: 7, 65: 5,
    66: 5, 67: 5, 68: 7, 69: 7, 70: 8, 71: 50, 72: 10, 73: 5, 74: 60, 75: 10,
    76: 5, 77: 3, 78: 3, 79: 5, 80: 4, 81: 4, 82: 4, 83: 60, 84: 60, 85: 60,
    86: 60, 87: 20, 88: 40, 89: 8, 90: 10, 91: 20, 92: 1, 93: 80, 94: 1,
    95: 8, 96: 50, 97: 10, 98: 50, 99: 50, 100: 50, 101: 1200, 102: 900,
    103: 1200, 104: 900, 105: 900, 106: 900, 107: 1200, 108: 900, 109: 900,
    110: 900, 111: 700, 112: 500, 113: 700, 114: 500, 115: 500, 116: 500,
    117: 700, 118: 500, 119: 500, 120: 500, 121: 600, 122: 820, 123: 400,
    124: 80, 125: 90, 126: 240, 127: 240, 128: 75, 129: 75, 130: 45, 131: 15,
    132: 100, 133: 80, 134: 5, 135: 10, 136: 3, 137: 2, 138: 2, 139: 60,
    140: 40, 141: 50, 142: 50, 143: 50, 144: 50, 145: 40, 146: 50, 147: 60,
    148: 60, 149: 50, 150: 3, 151: 50, 152: 50, 153: 7, 154: 7, 155: 7,
    156: 10, 157: 10, 158: 50, 159: 8, 160: 50, 161: 50, 162: 50, 163: 8,
    164: 16, 165: 12, 166: 50, 167: 50, 168: 50, 169: 8, 170: 8, 171: 30,
    172: 30, 173: 100, 174: 150, 175: 150, 176: 150, 177: 150, 178: 100,
    179: 200, 180: 200, 181: 100, 182: 100, 183: 200, 184: 100, 185: 150,
    186: 300, 187: 100, 188: 150, 189: 200, 190: 150, 191: 150, 192: 200,
    193: 200, 194: 200, 195: 300, 196: 300, 197: 300, 198: 150, 199: 150,
    200: 100, 201: 150, 202: 150, 203: 150, 204: 150, 205: 150, 206: 150,
    207: 150, 208: 150, 209: 150, 210: 150, 211: 150, 213: 30000, 214: 8,
    215: 16, 216: 42, 217: 2, 218: 100, 219: 100, 220: 100, 221: 10, 222: 20,
    223: 10, 224: 10, 225: 20, 226: 12, 227: 10, 228: 50, 229: 200, 230: 10,
    231: 60, 232: 80, 233: 20, 234: 50, 235: 150, 236: 20, 237: 75, 238: 30,
    239: 30, 240: 20, 241: 80, 242: 50, 243: 180, 244: 60, 245: 10, 246: 10,
    247: 12, 248: 36, 249: 15, 250: 50, 251: 50, 252: 50, 253: 50, 254: 50,
    255: 50, 256: 15, 257: 25, 258: 25, 259: 50, 260: 50, 261: 100, 262: 5000,
    263: 5000, 264: 15, 265: 5, 266: 9, 267: 5, 268: 5, 269: 105, 270: 1,
    271: 6, 272: 6, 273: 6, 274: 6, 275: 6, 276: 5, 277: 7, 278: 9, 279: 7,
    280: 10, 281: 9, 282: 7, 283: 7, 284: 7, 285: 17, 286: 15, 287: 10,
    288: 10, 289: 7, 290: 15, 291: 45, 292: 35, 293: 45, 294: 25, 295: 20,
    296: 5, 297: 300, 298: 100, 299: 100, 300: 150, 301: 300, 302: 200,
    303: 200, 304: 100, 305: 150, 306: 50, 307: 20, 308: 100, 309: 300,
    310: 200, 311: 150, 312: 150, 313: 150, 314: 100, 315: 200, 316: 200,
    317: 50, 318: 50, 319: 50, 320: 250, 321: 250, 322: 100, 323: 80,
    324: 100, 325: 100, 326: 100, 327: 80, 328: 60, 329: 200, 330: 200,
    331: 300, 332: 50, 333: 100, 334: 100, 335: 100, 336: 20, 337: 100,
    338: 200, 339: 100, 340: 200, 341: 300, 342: 300, 343: 300, 365: 60,
    366: 500, 367: 200, 368: 400, 369: 400, 370: 300, 371: 700, 372: 100,
    373: 100, 374: 100, 375: 100, 376: 100, 377: 100, 378: 200, 379: 200,
    380: 200, 381: 200, 382: 200, 383: 200, 384: 300, 385: 300, 386: 300,
    387: 500, 388: 300, 389: 300, 390: 400, 391: 300, 392: 400, 393: 400,
    394: 400, 395: 300, 396: 500, 397: 300, 398: 600, 399: 600, 400: 600,
    401: 600, 402: 700, 403: 100, 404: 100, 405: 300, 406: 200, 408: 20,
    409: 10000, 410: 100, 411: 150, 412: 150, 413: 200, 414: 500, 415: 150,
    416: 100, 417: 150, 418: 150, 419: 150, 420: 150, 421: 150, 422: 200,
    423: 200, 424: 200, 425: 150, 426: 150, 427: 150, 428: 150, 429: 150,
    430: 175, 431: 175, 432: 175, 433: 500, 434: 175, 438: 1, 439: 4500,
    440: 4000, 441: 3500, 442: 3250, 443: 3000, 444: 2500, 445: 2500,
    446: 2000, 447: 1500, 448: 1500, 449: 1000, 450: 900, 451: 850, 452: 800,
    453: 700, 454: 700, 455: 600, 456: 500, 457: 400, 458: 200, 459: 200,
    460: 300, 470: 60, 471: 1, 472: 45, 473: 1, 477: 10,
});

// C ref: shk.c getprice() reads objects[obj->otyp].oc_cost directly.
export function base_oc_cost(otyp) {
    return OC_COST[otyp] || 0;
}

// C ref: objnam.c:98 GemStone(typ) — the gem types whose *name* carries a
// " stone" suffix ("flint stone", "jade stone").  The seven flashy gems are
// excluded, as is every non-GEMSTONE material except FLINT itself.
// NOTE: the OBJECT_DATA column is `material`, not `oc_material` — reading
// `oc_material` off these records silently yields undefined.
export function GemStone(typ) {
    const GEMSTONE = 20, FLINT = 473;
    /* DILITHIUM_CRYSTAL, DIAMOND, RUBY, SAPPHIRE, BLACK_OPAL, EMERALD, OPAL */
    const EXC = GemStone._exc || (GemStone._exc = new Set([439, 440, 441, 443, 444, 445, 452]));
    return typ === FLINT || (objects[typ]?.material === GEMSTONE && !EXC.has(typ));
}

// C ref: mkobj.c — base weight of one unit of `otmp`'s otyp (objects[].oc_weight).
export function base_oc_weight(otmp) {
    const b = BASE_OC_WEIGHT[otmp.otyp];
    if (b != null) return b;
    // C ref: objects.h — the RING/AMULET/POTION/SCROLL/SPBOOK/WAND class macros
    // hard-code a single class-uniform oc_weight (3/20/20/5/50/7) for every
    // member.  Resolve these from CLASS_OC_WEIGHT *before* the per-otyp OC_WEIGHT
    // table, whose class-uniform entries are unreliable (e.g. POT_HEALING/
    // POT_EXTRA_HEALING listed as 50 rather than the correct 20), which would
    // otherwise over-weight starting inventories and mis-trigger encumbrance.
    const cu = CLASS_OC_WEIGHT[otmp.oclass];
    if (cu != null) return cu;
    // Authoritative per-otyp oc_weight from objects.h (nonzero entries only;
    // zero entries — dummies / corpse — fall through to the dynamic logic).
    const ocw = OC_WEIGHT[otmp.otyp];
    if (ocw != null && ocw > 0) return ocw;
    const tableWt = objects[otmp.otyp]?.weight;
    if (tableWt != null) return tableWt;
    const cls = CLASS_OC_WEIGHT[otmp.oclass];
    if (cls != null) return cls;
    return otmp.owt != null && otmp.owt > 0 && (otmp.quan || 1) === 1
        ? otmp.owt : 1;
}

// C ref: mkobj.c weight(struct obj *obj).  Containers and statues add (a
// modified sum of) their contents' weight; corpses scale by the species cwt;
// coins use the (quan+50)/100 formula; the heavy iron ball and candelabrum
// have their kludges; everything else is wt*quan (or (quan+1)>>1 when the
// unit weight is 0).
export function weight(otmp) {
    if (!otmp) return 0;
    if ((otmp.quan || 1) < 1) return 0;
    // globby objects carry a precomputed owt (mksobj manages it).
    if (otmp.globby) return otmp.owt | 0;

    let wt = base_oc_weight(otmp);

    if (Is_container(otmp.otyp) || otmp.otyp === STATUE) {
        // C: statue weight is 1.5x its corpse weight, floored by msize.
        if (otmp.otyp === STATUE && otmp.corpsenm != null && otmp.corpsenm >= 0) {
            const cwt = mon_cwt(otmp.corpsenm);
            const msize = mon_msize(otmp.corpsenm);
            if (cwt != null && msize != null) {
                const minwt = (msize + msize + 1) * 100;
                wt = Math.trunc(3 * cwt / 2);
                if (wt < minwt) wt = minwt;
                wt *= (otmp.quan || 1);
            }
        }
        let cwt = 0;
        for (const c of (otmp.cobj || [])) cwt += weight(c);
        if (otmp.otyp === BAG_OF_HOLDING) {
            cwt = otmp.cursed ? (cwt * 2)
                : otmp.blessed ? Math.trunc((cwt + 3) / 4)
                    : Math.trunc((cwt + 1) / 2);
        }
        return wt + cwt;
    }
    if (otmp.otyp === CORPSE && otmp.corpsenm != null && otmp.corpsenm >= 0) {
        const cwt = mon_cwt(otmp.corpsenm);
        // C ref: mkobj.c weight() — `if (obj->oeaten) wt = eaten_stat(wt, obj)`.
        // A partly eaten corpse/food weighs only the remaining fraction; without
        // this a half-eaten food ration still counted its full 20 units, which
        // shifts near_capacity() and so the "Burdened" word on the status row.
        if (cwt != null) {
            const w = (otmp.quan || 1) * cwt;
            return otmp.oeaten ? eaten_stat(w, otmp) : w;
        }
    }
    if (otmp.oclass === FOOD_CLASS && otmp.oeaten) {
        return eaten_stat((otmp.quan || 1) * wt, otmp);
    }
    if (otmp.oclass === COIN_CLASS) {
        return Math.max(Math.trunc(((otmp.quan || 1) + 50) / 100), 1);
    }
    if (otmp.otyp === HEAVY_IRON_BALL && otmp.owt) {
        return otmp.owt | 0; // kludge for "very" heavy iron ball
    }
    if (otmp.otyp === CANDELABRUM_OF_INVOCATION && otmp.spe) {
        return wt + otmp.spe * (BASE_OC_WEIGHT[TALLOW_CANDLE] ?? objects[TALLOW_CANDLE]?.weight ?? 2);
    }
    return wt ? wt * (otmp.quan || 1) : ((otmp.quan || 1) + 1) >> 1;
}

// C ref: mkobj.c place_object(otmp, x, y) — link the object into the tile's
// nexthere chain and the level's fobj chain.  This port keeps floor objects in
// one flat game.level.objects array in which the LAST entry matching (x,y) is
// the head of C's nexthere chain (what vobj_at draws and what dog_invent
// apports), so "push" == "put on top of the current pile".
//
// The boulder rule is what makes the pile order observable: C deliberately
// slides a NON-boulder underneath any run of boulders already on the tile so
// the map shows the boulder without the display having to walk the chain.
// Without it a rock dropped on a boulder square became the drawn glyph and the
// pet apported it instead of what C picks.
export function place_object(otmp, x, y) {
    if (!otmp) return otmp;
    if (game.level) {
        if (!Array.isArray(game.level.objects)) game.level.objects = [];
        const objs = game.level.objects;
        // indices of the tile's pile, deepest first (== C's chain, reversed)
        const idx = [];
        for (let i = 0; i < objs.length; i++)
            if (objs[i] !== otmp && objs[i].where === 'floor'
                && objs[i].ox === x && objs[i].oy === y) idx.push(i);
        // C: `if (!otmp2 || otmp2->otyp != BOULDER) block_point(x,y)` for a new
        // boulder, and recalc_block_point() in remove_object().  Both are done
        // at this port's call sites (cmd.js moverock, dig.c, dbridge.c) because
        // vision.js cannot be imported here without a module cycle.
        const topIsBoulder = idx.length
            && objs[idx[idx.length - 1]].otyp === BOULDER;
        let at = -1;
        if (topIsBoulder && otmp.otyp !== BOULDER) {
            // C: walk down the run of consecutive boulders, then splice in just
            // BELOW the deepest of them.
            let k = idx.length - 1;
            while (k > 0 && objs[idx[k - 1]].otyp === BOULDER) k--;
            at = idx[k];
        }
        const cur = objs.indexOf(otmp);
        if (cur >= 0) objs.splice(cur, 1);
        if (at >= 0 && cur >= 0 && cur < at) at--;
        if (at >= 0) objs.splice(at, 0, otmp);
        else objs.push(otmp);
    }
    // set the object's new location (after the splice, so the scan above sees
    // the pile as it stood BEFORE this object arrived)
    otmp.ox = x; otmp.oy = y; otmp.where = 'floor';
    otmp.ocarry = null; otmp.ocontainer = null; /* obj_no_longer_held */
    // C: `if (otmp->no_charge && !costly_spot(x,y) && !costly_adjacent(...))
    // otmp->no_charge = 0;`  shk.js owns costly_spot; leaving no_charge set
    // outside a shop is the conservative half of this (it only suppresses a
    // bill), so it is deliberately not guessed at here.
    if (otmp.timed) obj_timer_checks(otmp, x, y, 0);
    return otmp;
}

// C ref: mkobj.c add_to_container(container, obj) — obj must be free; merge
// into an existing stack if possible, else push onto the container's cobj
// chain.  Does NOT update the container's weight (callers do).
export function add_to_container(container, otmp) {
    if (!container || !otmp) return otmp;
    if (!Array.isArray(container.cobj)) container.cobj = [];
    if (container.where !== OBJ_INVENT && container.where !== 'invent'
        && container.where !== OBJ_MINVENT && container.where !== 'minvent') {
        otmp.ocarry = null;                    /* obj_no_longer_held */
    }
    container.cobj.push(otmp);
    otmp.where = 'contained';
    otmp.ocontainer = container;
    return otmp;
}

// C ref: mkobj.c container_weight(object) — recompute owt after the contents
// changed, recursing outward through nested containers.
export function container_weight(object) {
    if (!object) return;
    object.owt = weight(object);
    if (object.where === 'contained' || object.where === OBJ_CONTAINED)
        container_weight(object.ocontainer);
}

function mkbox_cnts(box) {
    box.cobj = [];
    let n;
    switch (box.otyp) {
    case ICE_BOX: n = 20; break;
    case CHEST: n = box.olocked ? 7 : 5; break;
    case LARGE_BOX: n = box.olocked ? 5 : 3; break;
    case SACK:
    case OILSKIN_SACK:
        if ((game.moves ?? 1) <= 1 && !game.in_mklev) { n = 0; break; }
        n = 1; break;
    case BAG_OF_HOLDING: n = 1; break;
    default: n = 0; break;
    }
    for (n = rn2(n + 1); n > 0; n--) {
        let otmp;
        if (box.otyp === ICE_BOX) {
            otmp = mksobj(CORPSE, true, false);
            // C ref: mkobj.c:2340 — "setting age to 0 is correct.  Age has a
            // different from usual meaning for objects stored in ice boxes."
            otmp.age = 0;
            // C ref: mkobj.c:2342 — and the rot/revive/shrink timers are
            // STOPPED: a corpse in an ice box is frozen, so it must not rot
            // away (or revive) while it sits there.
            if (otmp.timed) {
                stop_object_timer(otmp, ROT_CORPSE);
                stop_object_timer(otmp, REVIVE_MON);
                stop_object_timer(otmp, SHRINK_GLOB);
            }
        } else {
            let tprob = rnd(100);
            let oclass = boxiprobs[boxiprobs.length - 1][1];
            for (const [iprob, iclass] of boxiprobs) {
                tprob -= iprob;
                if (tprob <= 0) { oclass = iclass; break; }
            }
            otmp = mkobj(oclass, false);
            if (otmp.oclass === COIN_CLASS) {
                otmp.quan = rnd(level_difficulty() + 2) * rnd(75);
                otmp.owt = weight(otmp);
            } else {
                while (otmp.otyp === ROCK) {
                    otmp.otyp = rnd_class(DILITHIUM_CRYSTAL, LOADSTONE);
                    if (otmp.quan > 2) otmp.quan = 1;
                    otmp.owt = weight(otmp);
                }
            }
            if (box.otyp === BAG_OF_HOLDING) {
                // C ref: obj.h:339 Is_mbag(o) == (BAG_OF_HOLDING ||
                // BAG_OF_TRICKS) — a bag of TRICKS inside a bag of holding is
                // demoted to a plain sack too.  Testing only BAG_OF_HOLDING
                // left a bag of tricks in the loot; the swap draws no RNG, so
                // the mistake is invisible in the call stream and only shows up
                // in the item's name.
                if (Is_mbag(otmp)) {
                    otmp.otyp = SACK; otmp.spe = 0; otmp.owt = weight(otmp);
                } else {
                    while (otmp.otyp === WAN_CANCELLATION)
                        otmp.otyp = rnd_class(WAN_LIGHT, WAN_LIGHTNING);
                }
            }
        }
        add_to_container(box, otmp);
    }
}

function mksobj_init(otmp, artif) {
    switch (otmp.oclass) {
    case WEAPON_CLASS:
        otmp.quan = hasFlag(otmp, F_MULTIGEN) ? rn1(6, 6) : 1;
        if (!rn2(11)) {
            otmp.spe = rne(3);
            otmp.blessed = !!rn2(2);
        } else if (!rn2(10)) {
            curse(otmp);
            otmp.spe = -rne(3);
        } else {
            blessorcurse(otmp, 10);
        }
        if (hasFlag(otmp, F_POISONABLE) && !rn2(100)) otmp.opoisoned = 1;
        if (artif && !rn2(20 + 10 * nartifact_exist())) mk_artifact(otmp);
        break;
    case FOOD_CLASS:
        otmp.oeaten = 0;
        switch (otmp.otyp) {
        case CORPSE: {
            // C mkobj.c:898 — retry up to 50 times to avoid a G_NOCORPSE
            // species, then fall back to an adventurer (PM_HUMAN) corpse.
            let tryct = 50;
            do {
                otmp.corpsenm = undead_to_corpse(rndmonnum());
            } while (mon_nocorpse(otmp.corpsenm) && (--tryct > 0));
            if (tryct === 0) otmp.corpsenm = PM('human');
            break;
        }
        case EGG:
            otmp.corpsenm = NON_PM; /* generic egg */
            // C mkobj.c:913 — up to 200 tries to find a hatchable, viable
            // species; otherwise stays a generic (unhatchable) egg.
            if (!rn2(3)) {
                for (let tryct = 200; tryct > 0; --tryct) {
                    const mndx = can_be_hatched(rndmonnum());
                    if (mndx !== NON_PM && !dead_species(mndx, true)) {
                        otmp.corpsenm = mndx; /* typed egg */
                        break;
                    }
                }
            }
            break;
        case TIN:
            otmp.corpsenm = NON_PM; /* empty (so far) */
            if (!rn2(6)) {
                set_tin_variety(otmp, SPINACH_TIN);
            } else {
                // C mkobj.c:925 — up to 200 tries to find a nourishing,
                // corpse-bearing species for a random tin.
                for (let tryct = 200; tryct > 0; --tryct) {
                    const mndx = undead_to_corpse(rndmonnum());
                    if (mon_has_cnutrit(mndx) && !mon_nocorpse(mndx)) {
                        otmp.corpsenm = mndx;
                        set_tin_variety(otmp, RANDOM_TIN);
                        break;
                    }
                }
            }
            blessorcurse(otmp, 10);
            break;
        case SLIME_MOLD:
            // C ref: mkobj.c:942 — a random slime mold is the CURRENT fruit
            // (spe indexes the fruit-name chain) and flags.made_fruit records
            // that one exists.  Without this a generated slime mold had spe 0,
            // which objnam.c formats as "bad fruit #0".
            otmp.spe = game.context?.current_fruit ?? 0;
            if (game.flags) game.flags.made_fruit = true;
            break;
        case KELP_FROND:
            otmp.quan = rnd(2);
            break;
        case CANDY_BAR:
            // C ref: read.c assign_candy_wrapper() — 1 + rn2(SIZE-1); the
            // candy_wrappers[] table has 13 entries and skips index 0.
            otmp.spe = 1 + rn2(12);
            break;
        default:
            break;
        }
        // C ref: mkobj.c:955 — the pudding globs are their OWN arm and the
        // quan==2 roll below is the ELSE of it.  A glob keeps quantity 1, gets
        // its weight from oc_weight directly, is born dknown/known (to maximise
        // merging), takes a corpsenm from its otyp, and starts a SHRINK_GLOB
        // timer -- which draws rn2(5).  Falling through to the else-branch
        // instead drew rn2(6), so every glob desynced the whole call stream.
        if (Is_pudding(otmp)) {
            otmp.globby = 1;
            otmp.quan = 1;
            otmp.owt = base_oc_weight(otmp);
            otmp.known = otmp.dknown = 1;
            const gray_ooze = PM('gray ooze');
            if (gray_ooze >= 0)
                otmp.corpsenm = gray_ooze + (otmp.otyp - GLOB_OF_GRAY_OOZE);
            start_glob_timeout(otmp, 0);
        } else if (otmp.otyp !== CORPSE && otmp.otyp !== MEAT_RING
                   && otmp.otyp !== KELP_FROND && !rn2(6)) {
            otmp.quan = 2;
        }
        break;
    case GEM_CLASS:
        otmp.corpsenm = 0; /* LOADSTONE hack (C ref: mkobj.c:975) */
        if (otmp.otyp === LOADSTONE) curse(otmp);
        else if (otmp.otyp === ROCK) otmp.quan = rn1(6, 6);
        else if (otmp.otyp !== LUCKSTONE && !rn2(6)) otmp.quan = 2;
        else otmp.quan = 1;
        break;
    case TOOL_CLASS:
        switch (otmp.otyp) {
        case TALLOW_CANDLE:
        case WAX_CANDLE:
            otmp.spe = 1;
            // C ref: mkobj.c:990 — `age = 20L * oc_cost` (400 turns for a
            // tallow candle at cost 20, 200 for wax at 10): how long it burns.
            otmp.age = 20 * base_oc_cost(otmp.otyp);
            otmp.lamplit = 0;
            otmp.quan = 1 + (rn2(2) ? rn2(7) : 0);
            blessorcurse(otmp, 5);
            break;
        case BRASS_LANTERN:
        case OIL_LAMP:
            otmp.spe = 1;
            otmp.age = rn1(500, 1000);
            blessorcurse(otmp, 5);
            break;
        case MAGIC_LAMP:
            otmp.spe = 1;
            blessorcurse(otmp, 2);
            break;
        case CHEST:
        case LARGE_BOX:
            otmp.olocked = !!rn2(5);
            otmp.otrapped = !rn2(10);
            otmp.tknown = otmp.otrapped && !rn2(100);
            mkbox_cnts(otmp);
            break;
        case ICE_BOX:
        case SACK:
        case OILSKIN_SACK:
        case BAG_OF_HOLDING:
            mkbox_cnts(otmp);
            break;
        case EXPENSIVE_CAMERA:
        case TINNING_KIT:
        case MAGIC_MARKER:
            otmp.spe = rn1(70, 30);
            break;
        case CAN_OF_GREASE:
            otmp.spe = rn1(21, 5);
            blessorcurse(otmp, 10);
            break;
        case CRYSTAL_BALL:
            otmp.spe = rn1(5, 3);
            blessorcurse(otmp, 2);
            break;
        case HORN_OF_PLENTY:
        case BAG_OF_TRICKS:
            otmp.spe = rn1(18, 3);
            break;
        case FIGURINE: {
            // C ref: mkobj.c:1041-1045 — the do/while re-rolls while the pick
            // is M2_HUMAN, so a figurine can burn up to 31 whole
            // rndmonst_adj() scans (~133 rn2 each).
            let tryct = 0;
            do
                otmp.corpsenm = rndmonnum_adj(5, 10);
            while (is_human_flag(monster_by_pmidx(otmp.corpsenm)) && tryct++ < 30);
            blessorcurse(otmp, 4);
            break;
        }
        case BELL_OF_OPENING:
            otmp.spe = 3;
            break;
        case MAGIC_FLUTE:
        case MAGIC_HARP:
        case FROST_HORN:
        case FIRE_HORN:
        case DRUM_OF_EARTHQUAKE:
            otmp.spe = rn1(5, 4);
            break;
        default:
            break;
        }
        break;
    case AMULET_CLASS:
        if (otmp.otyp === AMULET_OF_YENDOR) game.made_amulet = true;
        if (rn2(10) && (otmp.otyp === AMULET_OF_STRANGULATION
            || otmp.otyp === AMULET_OF_CHANGE
            || otmp.otyp === AMULET_OF_RESTFUL_SLEEP)) {
            curse(otmp);
        } else {
            blessorcurse(otmp, 10);
        }
        break;
    case POTION_CLASS:
    case SCROLL_CLASS:
        // C ref: mkobj.c:1075 — `if (otmp->otyp != SCR_MAIL) blessorcurse(otmp, 4)`,
        // present only in a MAIL_STRUCTURES build (which the recorder is).
        if (otmp.otyp !== 364 /*SCR_MAIL*/) blessorcurse(otmp, 4);
        break;
    case SPBOOK_CLASS:
        otmp.spestudied = 0;
        blessorcurse(otmp, 17);
        break;
    case ARMOR_CLASS:
        if (rn2(10) && (otmp.otyp === FUMBLE_BOOTS
            || otmp.otyp === LEVITATION_BOOTS
            || otmp.otyp === HELM_OF_OPPOSITE_ALIGNMENT
            || otmp.otyp === GAUNTLETS_OF_FUMBLING || !rn2(11))) {
            curse(otmp);
            otmp.spe = -rne(3);
        } else if (!rn2(10)) {
            otmp.blessed = !!rn2(2);
            otmp.spe = rne(3);
        } else {
            blessorcurse(otmp, 10);
        }
        if (artif && !rn2(40 + 10 * nartifact_exist())) mk_artifact(otmp);
        // C ref: mkobj.c mksobj() — "simulate lacquered armor for samurai".
        // Consumes no RNG.  Role check uses the resolved player monster number
        // (PM_SAMURAI == 9); the splint mail only gets lacquered at game start
        // (svm.moves <= 1) or in the quest, exactly as in C.
        if ((game.u?.umonnum === 9) && otmp.otyp === SPLINT_MAIL
            && (game.moves ?? 1) <= 1) {
            otmp.oerodeproof = true;
            otmp.rknown = 1;
        }
        break;
    case WAND_CLASS:
        if (otmp.otyp === WAN_WISHING) otmp.spe = 1;
        else if (otmp.otyp === WAN_STASIS) otmp.spe = rn1(4, 3);
        else otmp.spe = rn1(5, objects[otmp.otyp]?.dir === NODIR ? 11 : 4);
        blessorcurse(otmp, 17);
        otmp.recharged = 0;
        break;
    case RING_CLASS:
        if (hasFlag(otmp, F_CHARGED)) {
            blessorcurse(otmp, 3);
            if (rn2(10)) {
                if (rn2(10) && bcsign(otmp)) otmp.spe = bcsign(otmp) * rne(3);
                else otmp.spe = rn2(2) ? rne(3) : -rne(3);
            }
            if ((otmp.spe || 0) === 0) otmp.spe = rn2(4) - rn2(3);
            if (otmp.spe < 0 && rn2(5)) curse(otmp);
        } else if (rn2(10) && (otmp.otyp === RIN_TELEPORTATION
            || otmp.otyp === RIN_POLYMORPH
            || otmp.otyp === RIN_AGGRAVATE_MONSTER
            || otmp.otyp === RIN_HUNGER || !rn2(9))) {
            curse(otmp);
        }
        break;
    case ROCK_CLASS:
        if (otmp.otyp === STATUE) {
            otmp.corpsenm = rndmonnum();
            // C ref: mondata.h verysmall(ptr) == (ptr->msize < MZ_SMALL), i.e.
            // MZ_TINY only.  The old `ptr?.verysmall !== true` read a field the
            // monster records do not have, so it answered TRUE for every
            // species and a tiny monster's statue could hold a spellbook.
            if (!(mon_msize(otmp.corpsenm) < MZ_SMALL)
                && rn2(Math.trunc(level_difficulty() / 2) + 10) > 10)
                add_to_container(otmp, mkobj(SPBOOK_no_NOVEL, false));
        }
        break;
    case COIN_CLASS:
    case VENOM_CLASS:
    case CHAIN_CLASS:
    case BALL_CLASS:
        break;
    default:
        break;
    }
    mkobj_erosions(otmp);
}

// C ref: mkobj.c dknowns[]:828 + clear_dknown():835, reached from mksobj() via
// unknow_object():1192.  ARMOR, FOOD, AMULET, COIN, ROCK, BALL and CHAIN are
// NOT in dknowns[], so those objects are born dknown — a plumed helmet lying in
// a shop is never "observed" by see_nearby_objects() (which skips dknown
// objects), and its TYPE only enters the discoveries list when the hero walks
// onto it and xname() runs.  Missing this put seed0002's plumed helmet ahead of
// the shield of reflection in the '\' list.  The three exceptions are the
// shields whose appearance is randomized and every oc_merge type.
const DKNOWNS = new Set([WAND_CLASS, RING_CLASS, POTION_CLASS, SCROLL_CLASS,
    GEM_CLASS, SPBOOK_CLASS, WEAPON_CLASS, TOOL_CLASS, VENOM_CLASS]);
const ELVEN_SHIELD = 153, ORCISH_SHIELD = 155, SHIELD_OF_REFLECTION = 158;

export function clear_dknown(obj) {
    obj.dknown = DKNOWNS.has(obj.oclass) ? 0 : 1;
    if ((obj.otyp >= ELVEN_SHIELD && obj.otyp <= ORCISH_SHIELD)
        || obj.otyp === SHIELD_OF_REFLECTION
        || (objects[obj.otyp]?.flags & F_MERGE))
        obj.dknown = 0;
    // globs keep dknown set to maximize merging
    if (obj.otyp >= GLOB_OF_GRAY_OOZE && obj.otyp <= GLOB_OF_BLACK_PUDDING)
        obj.dknown = 1;
}

export function mksobj(otyp, init = true, artif = false) {
    const obj = objects[otyp] || objects[STRANGE_OBJECT];
    const otmp = {
        // C ref: mksobj() starts from `*otmp = cg.zeroobj`, so owt is 0 here, not
        // 1.  That matters for exactly one object: weight()'s
        //     if (obj->otyp == HEAVY_IRON_BALL && obj->owt) return obj->owt;
        // kludge (which exists so a ball made heavier by a second scroll of
        // punishment keeps its increased weight).  With owt seeded to 1 the
        // kludge fired during mksobj itself and every iron ball weighed 1
        // instead of 480, so it never became a "very heavy iron ball".
        otyp, oclass: obj.oclass, ox: 0, oy: 0, quan: 1, owt: 0, cursed: false,
        blessed: false, olocked: false, otrapped: false, spe: 0, age: Math.max(game.moves ?? 1, 1),
        corpsenm: null,
    };
    otmp.o_id = next_ident();
    // C ref: mkobj.c:1192 `unknow_object(otmp)` — "set up dknown and known:
    // non-0 for some things".  clear_dknown() alone left `known` undefined,
    // which reads as 0 for every otyp; C sets it to 1 whenever the type does
    // NOT use the flag (oc_uses_known == 0), and invent.c merged() compares
    // obj->known between two stacks for the types that DO use it.
    unknow_object(otmp);
    if (init) mksobj_init(otmp, artif);

    switch ((otmp.oclass === POTION_CLASS && otmp.otyp !== POT_OIL) ? POT_WATER : otmp.otyp) {
    case CORPSE:
        // C ref: mkobj.c:1204 — a corpse created with init == FALSE still needs
        // a species: rndmonnum() run through undead_to_corpse(), and if that
        // species can't leave a corpse (or has been genocided/gone extinct) the
        // hero's own role-monster corpse is used instead.  The old code shared
        // the STATUE/FIGURINE line below, which skipped BOTH the
        // undead_to_corpse mapping and the G_NOCORPSE|G_GONE fallback.
        if (otmp.corpsenm == null || otmp.corpsenm === NON_PM) {
            otmp.corpsenm = undead_to_corpse(rndmonnum());
            if (mon_nocorpse(otmp.corpsenm) || (mvitals_flags(otmp.corpsenm) & G_GONE))
                otmp.corpsenm = urole_mnum();
        }
        /* FALLTHROUGH */
    case STATUE:
    case FIGURINE:
        if (otmp.corpsenm == null || otmp.corpsenm === NON_PM)
            otmp.corpsenm = rndmonnum();
        if (otmp.corpsenm != null && otmp.corpsenm !== NON_PM)
            otmp.spe = mkcorpstat_spe(otmp.corpsenm);
        /* FALLTHROUGH — C ref: mkobj.c:1224 falls into `case EGG:` */
        set_corpsenm(otmp, otmp.corpsenm);
        break;
    case BOULDER:
        // C ref: mkobj.c:1231 — next_boulder overloads corpsenm, whose default
        // is NON_PM (non-zero), so xname() would take its "next boulder" arm
        // unless this is cleared explicitly.
        otmp.next_boulder = 0;
        break;
    case LEASH:
        otmp.leashmon = 0;   /* also overloads corpsenm (C ref: mkobj.c:1241) */
        break;
    case EGG:
        // C ref: mkobj.c mksobj() — the CORPSE/STATUE case falls through into
        // `case EGG:` and both run set_corpsenm(otmp, otmp->corpsenm), which is
        // what attaches a typed egg's HATCH_EGG timer (timeout.c
        // attach_egg_hatch_timeout -> the rnd(151..200) hatch-schedule loop).
        // mksobj_init above only chose the species; without this the whole loop
        // was skipped and the PRNG stream ran short by however many rolls it
        // takes to exceed 150.
        set_corpsenm(otmp, otmp.corpsenm);
        break;
    case POT_OIL:
        otmp.age = MAX_OIL_IN_FLASK; /* amount of oil */
        /* FALLTHROUGH */
    case POT_WATER: /* POTION_CLASS */
        otmp.fromsink = 0;   /* overloads corpsenm (C ref: mkobj.c:1240) */
        break;
    case SPE_NOVEL:
        // C ref: mkobj.c:1246-1249 — novelidx starts at "none of the above" and
        // noveltitle() both rolls rn2(41) and fills it in, then onames the book.
        otmp.novelidx = -1;
        otmp.oname = noveltitle(otmp);
        break;
    default:
        break;
    }
    // C ref: mkobj.c:1227 — start_corpse_timeout() is reached THROUGH
    // set_corpsenm() in the CORPSE/STATUE/FIGURINE/EGG fall-through above, not
    // as a separate step; calling it twice would restart the rot timer with a
    // second rnz() draw.
    otmp.owt = weight(otmp);
    return otmp;
}

export function mksobj_at(otyp, x, y, init = true, artif = false) {
    const otmp = mksobj(otyp, init, artif);
    place_object(otmp, x, y);
    return otmp;
}

export function mkobj(oclass = RANDOM_CLASS, artif = false) {
    if (oclass === RANDOM_CLASS) {
        const probs = Is_rogue_level(game.u?.uz) ? rogueprobs : Inhell() ? hellprobs : mkobjprobs;
        let tprob = rnd(100);
        for (const [iprob, iclass] of probs) {
            tprob -= iprob;
            if (tprob <= 0) { oclass = iclass; break; }
        }
    }

    let i;
    if (oclass === SPBOOK_no_NOVEL) {
        i = rnd_class(classBases[SPBOOK_CLASS], SPE_BLANK_PAPER);
        oclass = SPBOOK_CLASS;
    } else {
        i = select_from_class(oclass);
    }
    return mksobj(i, true, artif);
}

export function mkobj_at(oclass, x, y, artif = false) {
    const otmp = mkobj(oclass, artif);
    place_object(otmp, x, y);
    return otmp;
}

export function mkcorpstat(objtype, mtmp, pm, x, y, corpstatflags = 0) {
    const init = !!(corpstatflags & CORPSTAT_INIT);
    const otmp = (x === 0 && y === 0)
        ? mksobj(objtype, init, false)
        : mksobj_at(objtype, x, y, init, false);

    otmp.spe = corpstatflags & CORPSTAT_SPE_VAL;
    otmp.norevive = !!game.mkcorpstat_norevive;

    // C ref: mkobj.c:2091 — when 'mtmp' is given, its whole monster record is
    // saved into the corpse/statue's oextra so a revival (or a statue-to-
    // monster) restores THAT monster (its level, HP, tameness, given name),
    // and it forces the corpse type.  A cancelled non-Rider corpse gets
    // norevive set so a cancelled troll stays dead.
    if (mtmp) {
        save_mtraits(otmp, mtmp);
        if (mtmp.mcan && !is_rider_pm(mtmp.data?.pmidx ?? mtmp.mnum))
            otmp.norevive = true;
    }

    if (mtmp && pm == null)
        pm = mtmp.data?.pmidx ?? mtmp.mnum ?? null;

    if (pm != null) {
        const old_corpsenm = otmp.corpsenm;
        otmp.corpsenm = typeof pm === 'number' ? pm : pm.pmidx;
        otmp.owt = weight(otmp);
        if (otmp.otyp === CORPSE
            && ((game.gz?.zombify || game.zombify)
                || special_corpse(old_corpsenm)
                || special_corpse(otmp.corpsenm))) {
            obj_stop_timers(otmp);
            start_corpse_timeout(otmp);
        }
    }
    return otmp;
}

// C ref: mkobj.c g_at(x, y) — the gold pile already on the floor at (x,y), if
// any.  mkgold() merges into it (quan += amount) instead of creating a second
// gold object, so re-filling a square (e.g. a vault filled in mklev and again
// in the fill loop) doesn't duplicate the pile or emit an extra next_ident.
function g_at(x, y) {
    for (const o of (game.level?.objects || []))
        if (o.where === 'floor' && o.ox === x && o.oy === y
            && o.oclass === COIN_CLASS) return o;
    return null;
}

// C ref: topten.c get_rnd_toptenentry() — pick a random entry out of the
// scoreboard (RECORD) file, biased to the top `sysopt.tt_oname_maxrank` (10)
// ranks.  The rnd(10) is drawn BEFORE the file is read, so it is consumed even
// when the file holds no entries; the read then finds points == 0 on the very
// first entry, retries once at rank 1 (still nothing) and gives up.  This port
// keeps no scoreboard at all — the equivalent of a freshly installed game — so
// the result is always "no entry", but the single rnd() must still happen.
function get_rnd_toptenentry() {
    rnd(10);                       // rnd(sysopt.tt_oname_maxrank)
    return null;
}

// C ref: topten.c tt_oname() — hang a random dead player's name/role on a
// corpse or statue.  With no scoreboard entry available it is a no-op that has
// already spent get_rnd_toptenentry()'s draw.
function tt_oname(otmp) {
    if (!otmp) return null;
    const tt = get_rnd_toptenentry();
    if (!tt) return null;
    return otmp;
}

// C ref: mkobj.c mk_tt_object() — a corpse/statue named after someone from the
// scoreboard.  A statue is created uninitialized ("player statues never contain
// books"); when tt_oname() cannot supply a player the corpsenm is forced to a
// random player-monster role instead, via set_corpsenm() (which restarts the
// corpse rot timer).
export function mk_tt_object(objtype, x, y) {
    const initialize_it = (objtype !== STATUE);
    const otmp = mksobj_at(objtype, x, y, initialize_it, false);
    if (!tt_oname(otmp)) {
        // C: rn1(PM_WIZARD - PM_ARCHEOLOGIST + 1, PM_ARCHEOLOGIST) — the 13
        // player-monster roles, in mons[] order starting at PM_ARCHEOLOGIST.
        const lo = PM('archeologist'), hi = PM('wizard');
        if (lo >= 0 && hi >= lo) set_corpsenm(otmp, rn1(hi - lo + 1, lo));
    }
    return otmp;
}

export function mkgold(amount, x, y) {
    if (amount <= 0) {
        const d = depth_of_level(game.u?.uz);
        const mul = rnd(Math.trunc(30 / Math.max(12 - d, 2)));
        amount = 1 + rnd(level_difficulty() + 2) * mul;
    }
    let gold = g_at(x, y);
    if (gold) {
        gold.quan = (gold.quan || 0) + amount;
    } else {
        gold = mksobj_at(GOLD_PIECE, x, y, true, false);
        gold.quan = amount;
    }
    gold.owt = weight(gold);
    return gold;
}

/* ------------------------------------------------------------------------- *
 *  mkobj.c, part 2 — the oextra side-tables, the object lists (floor pile,
 *  migration, burial, containers), the on-ice corpse timers, glob shrinking
 *  and merging, object teardown, and the wizard-mode sanity checks.
 *
 *  This port keeps floor objects in one flat game.level.objects array where
 *  the LAST entry matching (x,y) is the head of C's nexthere chain, keeps a
 *  container's contents in obj.cobj, a monster's in mon.minvent, and the
 *  hero's in game.invent.  The C list-surgery routines below are written
 *  against that model rather than against nobj/nexthere pointers, so they
 *  are the real thing (callable, with C's side effects) and not dead code.
 * ------------------------------------------------------------------------- */

/* ---- oextra ------------------------------------------------------------- */

// C ref: mkobj.c init_oextra(oex) — `*oex = zerooextra`.
export function init_oextra(oex) {
    if (!oex) return oex;
    oex.oname = null;
    oex.omonst = null;
    oex.omid = 0;
    oex.omailcmd = null;
    return oex;
}

// C ref: mkobj.c newoextra() — allocate a zeroed oextra.
export function newoextra() {
    return init_oextra({});
}

// C ref: mkobj.c OMID(obj) / has_omid(obj) accessors (obj.h).  const.js already
// exports ONAME/has_oname/OMONST; these are the rest of the set.
export function OMID(obj) { return obj?.oextra?.omid || 0; }
export function has_omid(obj) { return !!(obj?.oextra && obj.oextra.omid); }
export function has_omonst(obj) { return !!(obj?.oextra && obj.oextra.omonst); }
export function OMAILCMD(obj) { return obj?.oextra?.omailcmd || null; }
export function has_omailcmd(obj) { return !!(obj?.oextra && obj.oextra.omailcmd); }

// C ref: mkobj.c newomonst(otmp) — attach a zeroed monst record to the object.
export function newomonst(otmp) {
    if (!otmp) return;
    if (!otmp.oextra) otmp.oextra = newoextra();
    if (!otmp.oextra.omonst) otmp.oextra.omonst = {};
}

// C ref: mkobj.c free_omonst(otmp).
export function free_omonst(otmp) {
    if (otmp?.oextra) otmp.oextra.omonst = null;
}

// C ref: mkobj.c newomid(otmp) — OMID(otmp) = 0 (and allocate oextra first).
export function newomid(otmp) {
    if (!otmp) return;
    if (!otmp.oextra) otmp.oextra = newoextra();
    otmp.oextra.omid = 0;
}

// C ref: mkobj.c free_omid(otmp) — OMID(otmp) = 0.
export function free_omid(otmp) {
    if (otmp?.oextra) otmp.oextra.omid = 0;
}

// C ref: mkobj.c new_omailcmd(otmp, response_cmd) — the scroll of mail's
// "respond with this command" string.
export function new_omailcmd(otmp, response_cmd) {
    if (!otmp) return;
    if (!otmp.oextra) otmp.oextra = newoextra();
    if (otmp.oextra.omailcmd) free_omailcmd(otmp);
    otmp.oextra.omailcmd = String(response_cmd ?? '');
}

// C ref: mkobj.c free_omailcmd(otmp).
export function free_omailcmd(otmp) {
    if (otmp?.oextra && otmp.oextra.omailcmd) otmp.oextra.omailcmd = null;
}

// C ref: mkobj.c dealloc_oextra(o) — release oname/omonst/omailcmd and the
// oextra itself.  do_name.js also reads obj.oname directly, so clear both.
export function dealloc_oextra(o) {
    if (!o?.oextra) return;
    if (o.oextra.omonst) free_omonst(o);
    o.oextra.oname = null;
    o.oextra.omailcmd = null;
    o.oextra = null;
    o.oname = null;
}

// C ref: mkobj.c copy_oextra(obj2, obj1) — obj2 inherits obj1's name, saved
// monster traits, mail command and m_id association.  Used by splitobj() and
// bill_dummy_object(); the `OMONST(obj2)->m_id = next_ident()` line is #if 0 in
// C, so the copy shares the original's m_id and draws NO rnd(2).
export function copy_oextra(obj2, obj1) {
    if (!obj2 || !obj1 || !obj1.oextra) return;
    if (!obj2.oextra) obj2.oextra = newoextra();
    if (has_oname(obj1)) {
        obj2.oextra.oname = ONAME(obj1);
        obj2.oname = obj2.oextra.oname;      /* ONAME_SKIP_INVUPD */
    }
    if (has_omonst(obj1)) {
        if (!obj2.oextra.omonst) newomonst(obj2);
        obj2.oextra.omonst = { ...OMONST(obj1) };
        obj2.oextra.omonst.mextra = null;
        obj2.oextra.omonst.nmon = null;
        if (OMONST(obj1).mextra)
            obj2.oextra.omonst.mextra = { ...OMONST(obj1).mextra }; /* copy_mextra */
    }
    if (has_omailcmd(obj1)) new_omailcmd(obj2, OMAILCMD(obj1));
    if (has_omid(obj1)) {
        if (!obj2.oextra.omid) newomid(obj2);
        obj2.oextra.omid = OMID(obj1);
    }
}

// C ref: mkobj.c obj_attach_mid(obj, mid) — lasting object<->monster link.
export function obj_attach_mid(obj, mid) {
    if (!mid || !obj) return null;
    newomid(obj);
    obj.oextra.omid = mid;
    return obj;
}

// C ref: mkobj.c save_mtraits(obj, mtmp) — stash the dead monster's record in
// the corpse/statue so a revival restores the SAME monster (level, HP, tameness,
// name) rather than a fresh one of that species.  Pointers are invalidated and
// mhpmax is forced high enough for the revived monster to survive.
export function save_mtraits(obj, mtmp) {
    if (!obj || !mtmp) return obj;
    if (!has_omonst(obj)) newomonst(obj);
    if (has_omonst(obj)) {
        const baselevel = mtmp.data?.mlevel | 0;
        const m2 = { ...mtmp };
        m2.mextra = mtmp.mextra ? { ...mtmp.mextra } : null; /* copy_mextra */
        m2.mnum = (mtmp.data?.pmidx ?? mtmp.mnum ?? NON_PM);
        /* invalidate pointers; m_id is kept (revived quest leader check) */
        m2.nmon = null;
        m2.data = null;
        m2.minvent = [];
        m2.mw = null;                          /* MON_NOWEP */
        m2.wormno = 0;
        if ((m2.mhpmax | 0) <= baselevel) m2.mhpmax = baselevel + 1;
        if ((m2.mhp | 0) > m2.mhpmax) m2.mhp = m2.mhpmax;
        if ((m2.mhp | 0) < 1) m2.mhp = 0;
        obj.oextra.omonst = m2;
    }
    return obj;
}

// C ref: mkobj.c get_mtraits(obj, copyof) — the saved monster record, with
// ->data resolved from ->mnum.  copyof=FALSE returns the stored object itself
// (never insert that into a monster chain).
export function get_mtraits(obj, copyof) {
    const mtmp = has_omonst(obj) ? OMONST(obj) : null;
    if (!mtmp) return null;
    let mnew = mtmp;
    if (copyof) {
        mnew = { ...mtmp };
        mnew.mextra = mtmp.mextra ? { ...mtmp.mextra } : null;
    }
    mnew.data = monster_by_pmidx(mnew.mnum);
    return mnew;
}

// C ref: mkobj.c corpse_revive_type(obj) — a vampire's human corpse revives as
// the vampire, so the saved traits override obj->corpsenm.
export function corpse_revive_type(obj) {
    let revivetype = obj?.corpsenm;
    if (has_omonst(obj)) {
        const mtmp = get_mtraits(obj, false);
        if (mtmp) revivetype = mtmp.mnum;
    }
    return revivetype;
}

/* ---- object lists ------------------------------------------------------- */

// C ref: mkobj.c extract_nobj(obj, head_ptr) — unlink from a nobj chain and
// mark the object free.  `list` is this port's array standing in for the chain.
export function extract_nobj(obj, list) {
    if (!obj) return;
    if (Array.isArray(list)) {
        const ix = list.indexOf(obj);
        if (ix >= 0) list.splice(ix, 1);
    }
    obj.where = OBJ_FREE;
}

// C ref: mkobj.c extract_nexthere(obj, head_ptr) — unlink from a tile's pile
// chain.  Deliberately does NOT set obj->where (extract_nobj does that); in
// this port the pile and the fobj chain are the same array, so removing the
// entry once covers both and remove_object() does the where update.
export function extract_nexthere(obj, list) {
    if (!obj) return;
    if (Array.isArray(list)) {
        const ix = list.indexOf(obj);
        if (ix >= 0) list.splice(ix, 1);
    }
    obj.nexthere = null;
}

// C ref: mkobj.c remove_object(otmp) — take a floor object off the tile pile
// and the level's object chain, re-checking boulder vision and ice timers.
export function remove_object(otmp) {
    if (!otmp) return;
    const x = otmp.ox, y = otmp.oy;
    const objs = game.level?.objects;
    extract_nexthere(otmp, objs);
    extract_nobj(otmp, null);         /* the pile IS the fobj array here */
    otmp.where = OBJ_FREE;
    // C: `if (otmp->otyp == BOULDER) recalc_block_point(x, y)` — vision.js is
    // not importable from this module (cycle); the port's boulder movers
    // (cmd.js moverock, dig.js, dbridge.js) already do this at their call sites.
    if (otmp.timed) obj_timer_checks(otmp, x, y, 0);
}

// C ref: mkobj.c add_to_migration(obj) — obj travels with the hero to another
// level.  no_charge only means anything inside a shop, and a container being
// migrated invalidates any lock-picking context aimed at it.
export function add_to_migration(obj) {
    if (!obj) return;
    obj.no_charge = 0;
    if (Is_container(obj.otyp) && game.context?.lock?.box === obj)
        game.context.lock = null;              /* maybe_reset_pick(obj) */
    obj.where = OBJ_MIGRATING;
    if (!Array.isArray(game.migrating_objs)) game.migrating_objs = [];
    game.migrating_objs.push(obj);
    obj.omigr_from_dnum = game.u?.uz?.dnum ?? 0;
    obj.omigr_from_dlevel = game.u?.uz?.dlevel ?? 0;
}

// C ref: mkobj.c add_to_buried(obj) — obj joins this level's buried list.
export function add_to_buried(obj) {
    if (!obj || !game.level) return;
    obj.where = OBJ_BURIED;
    if (!Array.isArray(game.level.buriedobjlist)) game.level.buriedobjlist = [];
    game.level.buriedobjlist.push(obj);
}

// C ref: mkobj.c mksobj_migr_to_species(otyp, mflags2, init, artif) — extra
// orctown loot, created straight onto the migration list with the destination
// encoded in the overloaded owornmask field.  MIGR_TO_SPECIES == 10 (dungeon.h).
export function mksobj_migr_to_species(otyp, mflags2, init, artif) {
    const otmp = mksobj(otyp, init, artif);
    add_to_migration(otmp);
    otmp.owornmask = 10;                       /* MIGR_TO_SPECIES */
    otmp.migr_species = mflags2;
    return otmp;
}

// C ref: mkobj.c replace_object(obj, otmp) — an in-place swap: otmp takes over
// obj's slot in whatever list obj is on, keeping the ORDER (which is why C
// avoids obj_extract_self here).
export function replace_object(obj, otmp) {
    if (!obj || !otmp) return;
    otmp.where = obj.where;
    const swapIn = (list) => {
        if (!Array.isArray(list)) return;
        const ix = list.indexOf(obj);
        if (ix >= 0) list.splice(ix, 1, otmp);
    };
    switch (obj.where) {
    case OBJ_FREE:
        break;
    case 'invent': case OBJ_INVENT:
        swapIn(game.invent);
        break;
    case 'contained': case OBJ_CONTAINED:
        otmp.ocontainer = obj.ocontainer;
        swapIn(obj.ocontainer?.cobj);
        break;
    case 'minvent': case OBJ_MINVENT:
        otmp.ocarry = obj.ocarry;
        swapIn(obj.ocarry?.minvent);
        break;
    case 'floor': case OBJ_FLOOR:
        otmp.ox = obj.ox; otmp.oy = obj.oy;
        swapIn(game.level?.objects);
        break;
    default:
        break;
    }
    obj.where = OBJ_FREE;
}

// C ref: mkobj.c recreate_pile_at(x, y) — tear the tile's pile down and rebuild
// it in the same order so place_object()'s boulder rule forces every boulder to
// the top.  Called after a boulder is created under existing objects.
export function recreate_pile_at(x, y) {
    const objs = game.level?.objects;
    if (!Array.isArray(objs)) return;
    /* C walks the nexthere chain top-down into `reversed`, i.e. bottom-up. */
    const pile = [];
    for (const o of objs)
        if (o.where === 'floor' && o.ox === x && o.oy === y) pile.push(o);
    for (const o of pile) remove_object(o);
    for (const o of pile) place_object(o, x, y);
}

// C ref: mkobj.c obj_extract_self(obj) — unlink obj from whatever list holds it.
// The floor case is remove_object(); this port's invent.js owns freeinv() and
// re-exports its own obj_extract_self for hero inventory, so the arms here
// cover the lists mkobj.c itself maintains.
export function obj_extract_self_mkobj(obj) {
    if (!obj) return;
    switch (obj.where) {
    case OBJ_FREE: case OBJ_LUAFREE: case OBJ_DELETED:
        break;
    case 'floor': case OBJ_FLOOR:
        remove_object(obj);
        break;
    case 'contained': case OBJ_CONTAINED: {
        const c = obj.ocontainer;
        extract_nobj(obj, c?.cobj);
        if (c) container_weight(c);
        obj.ocontainer = null;
        break;
    }
    case 'invent': case OBJ_INVENT:
        extract_nobj(obj, game.invent);
        break;
    case 'minvent': case OBJ_MINVENT:
        extract_nobj(obj, obj.ocarry?.minvent);
        obj.ocarry = null;
        break;
    case OBJ_MIGRATING:
        extract_nobj(obj, game.migrating_objs);
        break;
    case OBJ_BURIED:
        extract_nobj(obj, game.level?.buriedobjlist);
        break;
    case OBJ_ONBILL:
        extract_nobj(obj, game.billobjs);
        break;
    default:
        obj.where = OBJ_FREE;
        break;
    }
}

// C ref: mkobj.c dealloc_obj(obj) — mark an object for deletion.  C stages it on
// go.objs_deleted and dobjsfree() releases it later; the staging matters because
// the object must stop being the thrown/kicked/tinning target and must lose its
// timers and light source FIRST.
export function dealloc_obj(obj) {
    if (!obj) return;
    if (obj.otyp === BOULDER) obj.next_boulder = 0;
    if (obj.where === OBJ_DELETED) return;     /* impossible() in C */
    // C ref: mkobj.c:2755 — `panic("dealloc_obj: obj not free")`.  Callers must
    // obj_extract_self() first; record the violation rather than aborting.
    if (obj.where !== OBJ_FREE && obj.where !== OBJ_LUAFREE)
        insane_object(obj, 'ofmt0', 'dealloc_obj: obj not free', null);
    if (obj.timed) obj_stop_timers(obj);
    if (obj.lamplit) obj.lamplit = 0;          /* del_light_source() */
    if (game.thrownobj === obj) game.thrownobj = null;
    if (game.gk_kickedobj === obj) game.gk_kickedobj = null;
    if (game.context?.tin?.tin === obj) {
        game.context.tin.tin = null;
        game.context.tin.o_id = 0;
    }
    // C: inline clear_splitobjs() — obj is no longer eligible for unsplitobj().
    const sp = game.context?.objsplit;
    if (sp && (obj.o_id === sp.parent_oid || obj.o_id === sp.child_oid))
        sp.parent_oid = sp.child_oid = 0;
    obj.where = OBJ_DELETED;
    if (!Array.isArray(game.objs_deleted)) game.objs_deleted = [];
    game.objs_deleted.push(obj);
}

// C ref: mkobj.c dealloc_obj_real(obj) — release the oextra and zero the record
// so a use-after-free shows up as an object-lost panic rather than stale data.
export function dealloc_obj_real(obj) {
    if (!obj) return;
    if (obj.oextra) dealloc_oextra(obj);
    obj.o_id = 0;
    obj.otyp = STRANGE_OBJECT;
    obj.quan = 0;
    obj.where = OBJ_FREE;
    obj.dealloc = true;
}

// C ref: mkobj.c dobjsfree() — free everything queued by dealloc_obj().
export function dobjsfree() {
    const q = game.objs_deleted;
    if (!Array.isArray(q)) return;
    while (q.length) {
        const otmp = q.shift();
        if (otmp.where !== OBJ_DELETED) continue;   /* panic() in C */
        // C ref: mkobj.c:2838 — obj_extract_self() here is a safety net; the
        // object's `where` is OBJ_DELETED so it no-ops.  dealloc_obj() panics
        // unless the caller already unlinked the object, so do NOT rewrite
        // `where` to OBJ_FREE first: that would make the net silently miss a
        // still-linked object instead of leaving it detectable.
        obj_extract_self_mkobj(otmp);
        dealloc_obj_real(otmp);
    }
}

// C ref: mkobj.c discard_minvent(mtmp, uncreate_artifacts) — throw away a
// monster's whole inventory (a monster leaving the game, not dying, so nothing
// drops).  `uncreate_artifacts` releases the artifact-exists reservation so the
// artifact can be generated again.
export function discard_minvent(mtmp, uncreate_artifacts) {
    if (!mtmp) return;
    const inv = mtmp.minvent;
    if (!Array.isArray(inv)) { mtmp.minvent = []; return; }
    while (inv.length) {
        const otmp = inv[0];
        inv.splice(0, 1);
        otmp.where = OBJ_FREE;
        otmp.ocarry = null;
        otmp.owornmask = 0;
        if (uncreate_artifacts && otmp.oartifact) {
            const reg = game.artifact_exists;
            if (reg) delete reg[otmp.oartifact];
        }
        dealloc_obj(otmp);                     /* obfree() in C */
    }
}

/* ---- on-ice corpses ----------------------------------------------------- */

// C ref: dbridge.c is_ice(x, y).  Local so this module stays free of the
// dbridge.js -> mkobj.js import cycle.
function is_ice_at(x, y) {
    if (!isok(x, y)) return false;
    const loc = game.level?.at?.(x, y);
    if (!loc) return false;
    return loc.typ === ICE
        || (loc.typ === DRAWBRIDGE_UP
            && ((loc.drawbridgemask | 0) & DB_UNDER) === DB_ICE);
}

// C ref: mkobj.c item_on_ice(item) — SET_ON_ICE / BURIED_UNDER_ICE / NOT_ON_ICE
// for `item` or, if it is contained, for its outermost container.
export const NOT_ON_ICE = 0, SET_ON_ICE = 1, BURIED_UNDER_ICE = 2;
export function item_on_ice(item) {
    let otmp = item;
    while (otmp && (otmp.where === 'contained' || otmp.where === OBJ_CONTAINED))
        otmp = otmp.ocontainer;
    if (!otmp) return NOT_ON_ICE;
    const ox = otmp.ox, oy = otmp.oy;
    if (otmp.where === 'floor' || otmp.where === OBJ_FLOOR) {
        if (is_ice_at(ox, oy)) return SET_ON_ICE;
    } else if (otmp.where === OBJ_BURIED) {
        if (is_ice_at(ox, oy)) return BURIED_UNDER_ICE;
    }
    return NOT_ON_ICE;
}

/* C ref: mkobj.c ROT_ICE_ADJUSTMENT — rotting on ice takes twice as long. */
const ROT_ICE_ADJUSTMENT = 2;

// C ref: mkobj.c peek_at_iced_corpse_age(otmp) — the obj->age a corpse WOULD
// have if it were lifted off the ice right now, so callers (dogfood(), eat.c's
// freshness tests) can compare against moves without stopping the rot timer.
export function peek_at_iced_corpse_age(otmp) {
    let retval = otmp?.age | 0;
    if (otmp && otmp.otyp === CORPSE && otmp.on_ice) {
        const age = (game.moves ?? 0) - (otmp.age | 0);
        retval += Math.trunc(age * (ROT_ICE_ADJUSTMENT - 1) / ROT_ICE_ADJUSTMENT);
    }
    return retval;
}

// C ref: mkobj.c obj_timer_checks(otmp, x, y, force) — a corpse placed on ice
// has its rot/revive timer stretched (and its age back-dated so peeking at it
// is the exact inverse); coming off ice undoes both.  force<0 forces the
// off-ice branch.
export function obj_timer_checks(otmp, x, y, force) {
    if (!otmp) return;
    let tleft = 0;
    let action = ROT_CORPSE;
    let restart_timer = false;
    const on_floor = (otmp.where === 'floor' || otmp.where === OBJ_FLOOR);
    const buried = (otmp.where === OBJ_BURIED);

    if (otmp.otyp === CORPSE && (on_floor || buried) && is_ice_at(x, y)) {
        tleft = stop_object_timer(otmp, action);
        if (tleft === 0) {
            action = REVIVE_MON;
            tleft = stop_object_timer(otmp, action);
        }
        if (tleft !== 0) {
            otmp.on_ice = 1;
            tleft *= ROT_ICE_ADJUSTMENT;
            restart_timer = true;
            const age = (game.moves ?? 0) - (otmp.age | 0);
            otmp.age = (game.moves ?? 0) - (age * ROT_ICE_ADJUSTMENT);
        }
    } else if (force < 0
               || (otmp.otyp === CORPSE && otmp.on_ice
                   && !((on_floor || buried) && is_ice_at(x, y)))) {
        tleft = stop_object_timer(otmp, action);
        if (tleft === 0) {
            action = REVIVE_MON;
            tleft = stop_object_timer(otmp, action);
        }
        if (tleft !== 0) {
            otmp.on_ice = 0;
            tleft = Math.trunc(tleft / ROT_ICE_ADJUSTMENT);
            restart_timer = true;
            const age = (game.moves ?? 0) - (otmp.age | 0);
            otmp.age = (otmp.age | 0)
                + Math.trunc(age * (ROT_ICE_ADJUSTMENT - 1) / ROT_ICE_ADJUSTMENT);
        }
    }
    if (restart_timer) start_timer(tleft, TIMER_OBJECT, action, otmp);
}

// C ref: mkobj.c obj_ice_effects(x, y, do_buried) — re-run the ice checks for
// every timed object at (x,y) after the terrain there froze or melted.
export function obj_ice_effects(x, y, do_buried) {
    for (const otmp of (game.level?.objects || []))
        if (otmp.where === 'floor' && otmp.ox === x && otmp.oy === y && otmp.timed)
            obj_timer_checks(otmp, x, y, 0);
    if (do_buried) {
        for (const otmp of (game.level?.buriedobjlist || []))
            if (otmp.ox === x && otmp.oy === y && otmp.timed)
                obj_timer_checks(otmp, x, y, 0);
    }
}

/* ---- globs -------------------------------------------------------------- */

const LOWEST_GLOB = GLOB_OF_GRAY_OOZE, HIGHEST_GLOB = GLOB_OF_BLACK_PUDDING;

// C ref: mkobj.c start_glob_timeout(obj, when) — a glob loses 1 unit of weight
// every ~25 turns.  when==0 rolls 25+rn2(5)-2 (23..27), which is the ONLY RNG
// in the glob machinery besides obj_meld's tie-break rn2(2).
export function start_glob_timeout(obj, when) {
    if (!obj?.globby) return;
    if (obj.timed) stop_object_timer(obj, SHRINK_GLOB);
    let w = when | 0;
    if (w < 1) w = 25 + rn2(5) - 2;
    start_timer(w, TIMER_OBJECT, SHRINK_GLOB, obj);
}

// C ref: mkobj.c check_glob(obj, mesg) — sanity check for an object whose
// globby flag is set.
export function check_glob(obj, mesg) {
    if (!obj) return;
    if ((obj.quan || 1) !== 1 || !obj.owt
        || obj.otyp < LOWEST_GLOB || obj.otyp > HIGHEST_GLOB)
        insane_object(obj, 'ofmt0', ` glob ${obj.otyp},quan=${obj.quan},owt=${obj.owt} ${mesg}`,
                      (obj.where === OBJ_MINVENT || obj.where === 'minvent') ? obj.ocarry : null);
}

// C ref: mkobj.c shrinking_glob_gone(obj) — the glob shrank to nothing; take it
// off whatever list holds it and delete it.
export function shrinking_glob_gone(obj) {
    if (!obj) return;
    const owhere = obj.where;
    if (owhere === OBJ_MIGRATING) obj.owornmask = 0;
    obj_extract_self_mkobj(obj);
    dealloc_obj(obj);                          /* obfree() in C */
}

// C ref: mkobj.c shrink_glob(arg, expire_time) — the SHRINK_GLOB timer.  Catches
// up for turns spent on another level, skips shrinking while on/under ice or
// while being eaten, then removes one unit of weight (and one unit of remaining
// nutrition when partly eaten), rescheduling or deleting the glob.
export function shrink_glob(obj, expire_time) {
    if (!obj?.globby) return;
    check_glob(obj, 'shrink obj ');
    const moves = game.moves ?? 0;
    const globloc = item_on_ice(obj);
    const contnr = (obj.where === 'contained' || obj.where === OBJ_CONTAINED)
        ? obj.ocontainer : null;

    if (expire_time < moves && globloc !== BURIED_UNDER_ICE) {
        let delta = Math.trunc((moves - expire_time + 24) / 25);
        const moddelta = 25 - (delta % 25);
        if (globloc === SET_ON_ICE) delta = Math.trunc((delta + 2) / 3);
        if (delta >= (obj.owt | 0)) {
            obj.owt = 0;
            shrinking_glob_gone(obj);
        } else {
            obj.owt = (obj.owt | 0) - delta;
            if (contnr) container_weight(contnr);
            start_glob_timeout(obj, moddelta);
        }
        return;
    }

    if (globloc === BURIED_UNDER_ICE
        || (globloc === SET_ON_ICE && (moves % 3) === 1)) {
        start_glob_timeout(obj, 0);
        return;
    }

    if ((obj.owt | 0) > 0) {
        obj.owt = (obj.owt | 0) - 1;
        if ((obj.oeaten | 0) > 1) obj.oeaten = (obj.oeaten | 0) - 1;
    }
    if (!obj.owt) shrinking_glob_gone(obj);
    else {
        if (contnr) container_weight(contnr);
        start_glob_timeout(obj, 0);
    }
}

// C ref: mkobj.c obj_nexto(otmp) — "is there a mergeable twin next to me?"
export function obj_nexto(otmp) {
    if (!otmp) return null;
    return obj_nexto_xy(otmp, otmp.ox, otmp.oy, true);
}

// C ref: mkobj.c obj_nexto_xy(obj, x, y, recurs) — look for a mergeable object
// of obj's type under (x,y) first, then in the 8 surrounding squares scanned in
// a RANDOM order: two rn2(2) rolls pick the scan direction, and those two draws
// happen whether or not anything is found.
export function obj_nexto_xy(obj, x, y, recurs) {
    if (!obj) return null;
    const otyp = obj.otyp;
    for (const otmp of (game.level?.objects || []))
        if (otmp !== obj && otmp.where === 'floor' && otmp.ox === x && otmp.oy === y
            && otmp.otyp === otyp && mergable_glob(otmp, obj))
            return otmp;
    if (!recurs) return null;
    const dx = rn2(2) ? -1 : 1;
    const dy = rn2(2) ? -1 : 1;
    const ex = x - dx, ey = y - dy;
    for (let fx = ex; Math.abs(fx - ex) < 3; fx += dx) {
        for (let fy = ey; Math.abs(fy - ey) < 3; fy += dy) {
            if (isok(fx, fy) && (fx !== x || fy !== y)) {
                const otmp = obj_nexto_xy(obj, fx, fy, false);
                if (otmp) return otmp;
            }
        }
    }
    return null;
}

// C ref: invent.c mergable(otmp, obj) reduced to the glob case: globs of the
// same type always merge (that is why they keep dknown set).
function mergable_glob(otmp, obj) {
    if (!otmp || !obj || otmp.otyp !== obj.otyp) return false;
    if (obj.globby) return true;
    return otmp.oclass === obj.oclass && !otmp.oeaten === !obj.oeaten
        && !!otmp.cursed === !!obj.cursed && !!otmp.blessed === !!obj.blessed
        && (otmp.spe | 0) === (obj.spe | 0);
}

// C ref: mkobj.c obj_absorb(obj1, obj2) — obj1 swallows obj2: weights add,
// quantity stays 1, ages are averaged by weight, and the two shrink timers are
// averaged into a new one.  obj2 is deleted.  Returns obj1.
export function obj_absorb(o1ref, o2ref) {
    const otmp1 = o1ref?.obj, otmp2 = o2ref?.obj;
    if (!otmp1 || !otmp2 || otmp1 === otmp2) return null;
    if (!!otmp1.bknown !== !!otmp2.bknown) otmp1.bknown = otmp2.bknown = 0;
    if (!!otmp1.rknown !== !!otmp2.rknown) otmp1.rknown = otmp2.rknown = 0;
    if (!!otmp1.greased !== !!otmp2.greased) otmp1.greased = otmp2.greased = 0;
    if (otmp1.orotten || otmp2.orotten) otmp1.orotten = otmp2.orotten = 1;
    const o1wt = otmp1.oeaten ? otmp1.oeaten : (otmp1.owt | 0);
    const o2wt = otmp2.oeaten ? otmp2.oeaten : (otmp2.owt | 0);
    const moves = game.moves ?? 0;
    const agetmp = Math.trunc(((moves - (otmp1.age | 0)) * o1wt
                               + (moves - (otmp2.age | 0)) * o2wt) / (o1wt + o2wt));
    otmp1.age = moves - agetmp;
    otmp1.owt = (otmp1.owt | 0) + o2wt;
    if (otmp1.oeaten || otmp2.oeaten) otmp1.oeaten = o1wt + o2wt;
    otmp1.quan = 1;
    if (otmp1.globby && otmp2.globby) {
        let tm1 = stop_object_timer(otmp1, SHRINK_GLOB);
        const tm2 = stop_object_timer(otmp2, SHRINK_GLOB);
        tm1 = Math.trunc(((tm1 || 25) + (tm2 || 25) + 1) / 2);
        start_glob_timeout(otmp1, tm1);
    }
    obj_extract_self_mkobj(otmp2);
    dealloc_obj(otmp2);
    o2ref.obj = null;
    return otmp1;
}

// C ref: mkobj.c obj_meld(obj1, obj2) — the heavier glob absorbs the lighter
// one, except that a floor glob always wins against a free (being-dropped) one.
// The equal-weight tie-break is rn2(2).
export function obj_meld(o1ref, o2ref) {
    const otmp1 = o1ref?.obj, otmp2 = o2ref?.obj;
    if (!otmp1 || !otmp2 || otmp1 === otmp2) return null;
    const isfloor = (o) => o.where === 'floor' || o.where === OBJ_FLOOR;
    const isfree = (o) => o.where === OBJ_FREE;
    if (!(isfloor(otmp2) && isfree(otmp1))
        && ((otmp1.owt | 0) > (otmp2.owt | 0)
            || ((otmp1.owt | 0) === (otmp2.owt | 0) && rn2(2))))
        return obj_absorb(o1ref, o2ref);
    return obj_absorb(o2ref, o1ref);
}

/* ---- name / knowledge -------------------------------------------------- */

// C ref: mkobj.c unknow_object(obj) — the hero loses everything it knew about
// this object (an unseen monster picked it up or used it).
export function unknow_object(obj) {
    if (!obj) return;
    clear_dknown(obj);
    obj.bknown = obj.rknown = 0;
    obj.cknown = obj.lknown = 0;
    obj.tknown = 0;
    obj.known = objects[obj.otyp]?.oc_uses_known ? 0 : 1;
}

// C ref: mkobj.c unknwn_contnr_contents(obj) — the OUTERMOST enclosing
// container whose contents the hero has not seen, or null.
export function unknwn_contnr_contents(obj) {
    let result = null, o = obj;
    while (o && (o.where === 'contained' || o.where === OBJ_CONTAINED)) {
        const parent = o.ocontainer;
        if (!parent) break;
        if (!parent.cknown) result = parent;
        o = parent;
    }
    return result;
}

// C ref: mkobj.c nextoid(oldobj, newobj) — pick an o_id for a split stack that
// keeps the same o_id-based shop price adjustment, then advance context.ident.
// oid_price_adjustment() is shk.js's; with no shop price in play the do-loop
// exits on its first pass, so this is `ident-1 + 1` followed by next_ident().
export function nextoid(oldobj, newobj) {
    let oid = (game.context_ident ?? 2) - 1;
    ++oid;
    if (!oid) ++oid;
    game.context_ident = oid;
    next_ident();
    return oid;
}

// C ref: mkobj.c bill_dummy_object(otmp) — a shop object is about to be altered,
// so put a copy of the ORIGINAL on the bill.  The copy gets a fresh o_id from
// nextoid() (which spends next_ident()'s rnd(2)), inherits the oextra but never
// the m_id association, and is never worn or timed.
export function bill_dummy_object(otmp) {
    if (!otmp) return;
    const dummy = { ...otmp };
    dummy.oextra = null;
    dummy.where = OBJ_FREE;
    dummy.o_id = nextoid(otmp, dummy);
    dummy.timed = 0;
    delete dummy.timer;
    copy_oextra(dummy, otmp);
    if (has_omid(dummy)) free_omid(dummy);
    dummy.owornmask = 0;
    if (!Array.isArray(game.billobjs)) game.billobjs = [];
    dummy.where = OBJ_ONBILL;
    game.billobjs.push(dummy);                 /* addtobill() */
    otmp.no_charge = (otmp.where === 'floor' || otmp.where === OBJ_FLOOR
                      || otmp.where === 'contained' || otmp.where === OBJ_CONTAINED)
        ? 1 : 0;
    otmp.unpaid = 0;
}

/* ---- misc object queries ----------------------------------------------- */

/* C ref: mkobj.c treefruits[] — APPLE, ORANGE, PEAR, BANANA, EUCALYPTUS_LEAF. */
const TREEFRUITS = [277, 278, 279, 281, 276];

// C ref: mkobj.c rnd_treefruit_at(x, y) — what a kicked tree drops.
export function rnd_treefruit_at(x, y) {
    return mksobj_at(TREEFRUITS[rn2(TREEFRUITS.length)], x, y, true, false);
}

// C ref: mkobj.c is_treefruit(otmp) — for describing objects embedded in trees.
export function is_treefruit(otmp) {
    return !!otmp && TREEFRUITS.includes(otmp.otyp);
}

// C ref: mkobj.c stone_object_type(mappearance) — mimic shapes that stone-to-
// flesh should undo.  Wands, rings and gems are deliberately excluded.
export function stone_object_type(mappearance) {
    const otyp = mappearance | 0;
    return otyp === BOULDER || otyp === STATUE || otyp === FIGURINE;
}

// C ref: mkobj.c stone_furniture_type(mappearance) — for FURNITURE the
// mappearance is a DISPLAY SYMBOL (a cmap index), not a terrain type: the two
// staircases, both branch staircases, altar, throne, sink, and every wall.
// defsym.h cmap order (S_vwall == 1 ... S_trwall == 11, S_upstair == 20 ...).
const S_vwall = 1, S_trwall = 11;
const S_upstair = 20, S_dnstair = 21, S_brupstair = 22, S_brdnstair = 23;
const S_altar = 30, S_throne = 31, S_sink = 32;
export function stone_furniture_type(mappearance) {
    const sym = mappearance | 0;
    switch (sym) {
    case S_upstair: case S_dnstair:
    case S_brupstair: case S_brdnstair:
    case S_altar: case S_throne: case S_sink:
        return true;
    default:
        return sym >= S_vwall && sym <= S_trwall;
    }
}

// C ref: mkobj.c fixup_oil(potion, source) — potions of oil use obj->age as
// "amount of burn time remaining" while every other potion uses it as "turn
// created", so any otyp change into or out of POT_OIL has to translate.
export function fixup_oil(potion, source) {
    if (!potion) return;
    if (potion.otyp === POT_OIL) {
        if (source && source.otyp === POT_OIL) potion.age = source.age;
        else potion.age = MAX_OIL_IN_FLASK;
    } else if (source && source.otyp === POT_OIL) {
        if (potion.age === source.age) potion.age = game.moves ?? 0;
        if (source.age < MAX_OIL_IN_FLASK) potion.odiluted = 1;
    }
}

// C ref: mkobj.c mk_named_object(objtype, ptr, x, y, nm) — a corpse or statue of
// `ptr`, named `nm`.  A statue is created uninitialized (no books inside).
export function mk_named_object(objtype, ptr, x, y, nm) {
    const corpstatflags = (objtype !== STATUE) ? CORPSTAT_INIT : 0;
    const otmp = mkcorpstat(objtype, null, ptr, x, y, corpstatflags);
    if (nm && otmp) {
        if (!otmp.oextra) otmp.oextra = newoextra();
        otmp.oextra.oname = nm;
        otmp.oname = nm;
    }
    return otmp;
}

// C ref: mkobj.c init_dummyobj(obj, otyp, oquan) — the throwaway obj used when
// a stethoscope is applied at a mimic pretending to be an object.  `known` is
// suppressed except for amulets, and corpsenm is NON_PM so no statue/figurine
// details leak (with the LEASH / BOULDER / SLIME_MOLD overload exceptions).
export function init_dummyobj(obj, otyp, oquan) {
    if (!obj) return obj;
    for (const k of Object.keys(obj)) delete obj[k];
    obj.otyp = otyp;
    obj.oclass = objects[otyp]?.oclass ?? 0;
    obj.known = (obj.oclass === AMULET_CLASS)
        ? (obj.known ? 1 : 0)
        : (objects[otyp]?.oc_uses_known ? 0 : 1);
    obj.quan = oquan || 1;
    obj.corpsenm = NON_PM;
    if (obj.otyp === LEASH) obj.leashmon = 0;
    if (obj.otyp === BOULDER) obj.next_boulder = 0;
    if (obj.otyp === SLIME_MOLD) obj.spe = game.context?.current_fruit ?? 0;
    return obj;
}

/* ---- wizard-mode sanity checks ----------------------------------------- */

/* C ref: obj.h NOBJ_STATES names, used by insane_object()'s feedback. */
const OBJ_STATE_NAMES = ['free', 'floor', 'contained', 'invent',
                         'minvent', 'migrating', 'buried', 'onbill',
                         'luafree', 'deleted'];

// C ref: mkobj.c where_name(obj).
export function where_name(obj) {
    if (!obj) return 'nowhere';
    const w = obj.where;
    if (typeof w === 'string' && OBJ_STATE_NAMES.includes(w)) return w;
    const i = w | 0;
    if (i < 0 || i >= OBJ_STATE_NAMES.length) return `unknown[${w}]`;
    return OBJ_STATE_NAMES[i];
}

// C ref: mkobj.c nomerge_exception(obj) — mines/Sokoban prize objects legally
// carry the nomerge flag until the hero picks them up.
export function nomerge_exception(obj) {
    return !!(obj && (obj.mines_prize || obj.soko_prize));
}

// C ref: mkobj.c insane_object(obj, fmt, mesg, mon) — report a sanity failure
// via impossible().  Recorded here rather than plined: impossible() writes three
// toplines and none of the sanity checks fire in a consistent game, so raising
// them as toplines would be strictly worse than logging them.
export function insane_object(obj, fmt, mesg, mon) {
    if (!Array.isArray(game._insane_objects)) game._insane_objects = [];
    game._insane_objects.push({ mesg, where: where_name(obj), otyp: obj?.otyp,
                                mon: mon?.m_id ?? null });
}

// C ref: mkobj.c insane_obj_bits(obj, mon) — in_use / bypass / nomerge /
// next_boulder should all be clear between commands.
export function insane_obj_bits(obj, mon) {
    if (!obj || obj.where === OBJ_DELETED) return;
    const o_in_use = !!obj.in_use;
    const o_bypass = !!obj.bypass;
    const o_nomerge = !!(obj.nomerge && !nomerge_exception(obj));
    const o_boulder = (obj.otyp === BOULDER && !!obj.next_boulder);
    if (o_in_use || o_bypass || o_nomerge || o_boulder)
        insane_object(obj, 'ofmt0',
            `flagged${o_in_use ? ' in_use' : ''}${o_bypass ? ' bypass' : ''}`
            + `${o_nomerge ? ' nomerge' : ''}${o_boulder ? ' nxtbldr' : ''}`, mon);
}

// C ref: mkobj.c check_contained(container, mesg) — every object inside
// `container` must be OBJ_CONTAINED and point back at it; recurse into nested
// containers, and panic on a container cycle.
export function check_contained(container, mesg) {
    if (!Has_contents(container)) return;
    let m = mesg;
    if (!String(m).includes('contained')) m = `contained ${m}`;
    for (const obj of (container.cobj || [])) {
        if (obj === container) return;         /* panic() in C */
        if (obj.where !== 'contained' && obj.where !== OBJ_CONTAINED)
            insane_object(obj, 'ofmt0', m, null);
        else if (obj.ocontainer !== container)
            insane_object(obj, 'ofmt0', `${m} wrong container`, null);
        if (obj.globby) check_glob(obj, m);
        if (Has_contents(obj)) {
            if (obj.cobj === container.cobj) return;
            check_contained(obj, `nested ${m}`);
        }
    }
}

// C ref: mkobj.c sanity_check_worn(obj) — only meaningful with the development
// wearbits[] table; the release build compiles it out entirely
// (NH_DEVEL_STATUS == NH_STATUS_RELEASED and DEBUG undefined), and the recorder
// binary is a release build, so this is a no-op there too.
export function sanity_check_worn(_obj) { }

// C ref: mkobj.c objlist_sanity(objlist, wheretype, mesg).
export function objlist_sanity(objlist, wheretype, mesg) {
    for (const obj of (objlist || [])) {
        if (obj.where !== wheretype) insane_object(obj, 'ofmt0', mesg, null);
        if (obj.globby) check_glob(obj, mesg);
        if (Has_contents(obj)) check_contained(obj, mesg);
        if (obj.owornmask) sanity_check_worn(obj);
        insane_obj_bits(obj, null);
    }
}

// C ref: mkobj.c shop_obj_sanity(obj, mesg) — unpaid/no_charge bookkeeping is
// shk.js's; the where-consistency half is checked here.
export function shop_obj_sanity(obj, mesg) {
    if (!obj) return;
    if (obj.unpaid && obj.no_charge)
        insane_object(obj, 'ofmt0', `${mesg} unpaid and no_charge`, null);
}

// C ref: mkobj.c mon_obj_sanity(monlist, mesg).
export function mon_obj_sanity(monlist, mesg) {
    for (const mon of (monlist || [])) {
        for (const obj of (mon.minvent || [])) {
            if (obj.where !== 'minvent' && obj.where !== OBJ_MINVENT)
                insane_object(obj, 'mfmt1', mesg, mon);
            else if (obj.ocarry !== mon)
                insane_object(obj, 'mfmt2', mesg, mon);
            if (obj.globby) check_glob(obj, mesg);
            if (Has_contents(obj)) check_contained(obj, mesg);
            if (obj.owornmask) sanity_check_worn(obj);
            insane_obj_bits(obj, mon);
        }
    }
}

// C ref: mkobj.c obj_sanity_check() — walk every object list the game owns.
export function obj_sanity_check() {
    game._insane_objects = [];
    objlist_sanity(game.level?.objects, 'floor', 'floor sanity');
    objlist_sanity(game.invent, 'invent', 'invent sanity');
    objlist_sanity(game.migrating_objs, OBJ_MIGRATING, 'migrating sanity');
    objlist_sanity(game.level?.buriedobjlist, OBJ_BURIED, 'buried sanity');
    objlist_sanity(game.billobjs, OBJ_ONBILL, 'bill sanity');
    mon_obj_sanity(game.level?.monsters, 'minvent sanity');
    for (const obj of (game.level?.objects || [])) shop_obj_sanity(obj, 'shop sanity');
    return game._insane_objects;
}

/* ---- horn of plenty ---------------------------------------------------- */

// C ref: mkobj.c hornoplenty(horn, tipping, targetbox) — mirrors bagotricks():
// spend a charge, then 1-in-13 a random non-magic potion (magic ones are
// re-rolled into the booze..water range, never sickness, with fixup_oil for
// oil) and otherwise a random comestible (a food ration becomes a lump of royal
// jelly 1-in-7).  The new item inherits the horn's bless/curse state.
// RNG order: consume_obj_charge, rn2(13), mkobj(class), [rnd_class loop | rn2(7)].
// Returns the created object plus the message the caller must print, so the
// (async) drop/put-in-container half stays with the caller in apply.js.
export function hornoplenty(horn) {
    if (!horn || horn.otyp !== HORN_OF_PLENTY) return null;
    let obj, what;
    if (!rn2(13)) {
        obj = mkobj(POTION_CLASS, false);
        if (objects[obj.otyp]?.oc_magic) {
            do {
                obj.otyp = rnd_class(POT_BOOZE, POT_WATER);
            } while (obj.otyp === POT_SICKNESS);
            if (obj.otyp === POT_OIL) fixup_oil(obj, null);
        }
        what = (obj.quan > 1) ? 'Some potions' : 'A potion';
    } else {
        obj = mkobj(FOOD_CLASS, false);
        if (obj.otyp === FOOD_RATION && !rn2(7)) obj.otyp = LUMP_OF_ROYAL_JELLY;
        what = 'Some food';
    }
    obj.blessed = horn.blessed;
    obj.cursed = horn.cursed;
    obj.owt = weight(obj);
    return { obj, what };
}
