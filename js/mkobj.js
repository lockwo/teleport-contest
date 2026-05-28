// mkobj.js - Object creation.
// C refs: mkobj.c, objects.h, o_init.c object probability setup.

import { game } from './gstate.js';
import { rn2, rnd, rn1 } from './rng.js';
import { depth as depth_of_level } from './hacklib.js';
import { Is_rogue_level, GEHENNOM } from './const.js';
import { rndmonst_adj } from './makemon.js';

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
export const POT_WATER = 322;
export const POT_HEALING = 307;
export const POT_EXTRA_HEALING = 308;
export const POT_SPEED = 302;
export const POT_GAIN_ENERGY = 313;
export const SCR_ENCHANT_WEAPON = 328;
export const SCR_ENCHANT_ARMOR = 323;
export const SCR_CONFUSE_MONSTER = 325;
export const SCR_SCARE_MONSTER = 326;
export const SCR_TELEPORTATION = 333;
export const SCR_BLANK_PAPER = 364;
export const SPE_HEALING = 373;
export const SPE_NOVEL = 407;
export const SPE_BLANK_PAPER = 406;
export const WAN_DIGGING = 427;
export const WAN_WISHING = 413;
export const WAN_STASIS = 414;
export const WAN_FIRE = 429;
export const WAN_CANCELLATION = 422;
export const WAN_LIGHT = 409;
export const WAN_LIGHTNING = 433;
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
export const MAGIC_FLUTE = 248;
export const MAGIC_HARP = 254;
export const FROST_HORN = 250;
export const FIRE_HORN = 251;
export const DRUM_OF_EARTHQUAKE = 258;
export const UNICORN_HORN = 261;
export const FUMBLE_BOOTS = 171;
export const LEVITATION_BOOTS = 172;
export const HELM_OF_OPPOSITE_ALIGNMENT = 99;
export const GAUNTLETS_OF_FUMBLING = 160;
export const SPLINT_MAIL = 124;
export const DILITHIUM_CRYSTAL = 438;
export const FIRST_REAL_GEM = 438;
export const LAST_REAL_GEM = 459;
export const LUCKSTONE = 469;
export const LOADSTONE = 470;
export const ROCK = 473;
export const GOLD_PIECE = 437;
export const BOULDER = 474;
export const STATUE = 475;
export const HEAVY_IRON_BALL = 476;
export const IRON_CHAIN = 477;
export const BLINDING_VENOM = 478;
export const ACID_VENOM = 479;

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
const NODIR = 1;

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
  [364, "SCR_BLANK_PAPER", 9, 28, 32, 5, 0, "blank paper"],
  [365, "SPE_DIG", 10, 20, 0, 5, 3, "dig"],
  [366, "SPE_MAGIC_MISSILE", 10, 45, 0, 5, 3, "magic missile"],
  [367, "SPE_FIREBALL", 10, 20, 0, 5, 3, "fireball"],
  [368, "SPE_CONE_OF_COLD", 10, 10, 0, 5, 3, "cone of cold"],
  [369, "SPE_SLEEP", 10, 30, 0, 5, 3, "sleep"],
  [370, "SPE_FINGER_OF_DEATH", 10, 5, 0, 5, 3, "finger of death"],
  [371, "SPE_LIGHT", 10, 45, 0, 5, 1, "light"],
  [372, "SPE_DETECT_MONSTERS", 10, 43, 0, 5, 1, "detect monsters"],
  [373, "SPE_HEALING", 10, 40, 0, 5, 2, "healing"],
  [374, "SPE_KNOCK", 10, 25, 0, 5, 2, "knock"],
  [375, "SPE_FORCE_BOLT", 10, 30, 0, 5, 2, "force bolt"],
  [376, "SPE_CONFUSE_MONSTER", 10, 49, 0, 5, 2, "confuse monster"],
  [377, "SPE_CURE_BLINDNESS", 10, 25, 0, 5, 2, "cure blindness"],
  [378, "SPE_DRAIN_LIFE", 10, 10, 0, 5, 2, "drain life"],
  [379, "SPE_SLOW_MONSTER", 10, 30, 0, 5, 2, "slow monster"],
  [380, "SPE_WIZARD_LOCK", 10, 25, 0, 5, 2, "wizard lock"],
  [381, "SPE_CREATE_MONSTER", 10, 35, 0, 5, 1, "create monster"],
  [382, "SPE_DETECT_FOOD", 10, 30, 0, 5, 1, "detect food"],
  [383, "SPE_CAUSE_FEAR", 10, 25, 0, 5, 1, "cause fear"],
  [384, "SPE_CLAIRVOYANCE", 10, 15, 0, 5, 1, "clairvoyance"],
  [385, "SPE_CURE_SICKNESS", 10, 32, 0, 5, 1, "cure sickness"],
  [386, "SPE_CHARM_MONSTER", 10, 20, 0, 5, 2, "charm monster"],
  [387, "SPE_HASTE_SELF", 10, 33, 0, 5, 1, "haste self"],
  [388, "SPE_DETECT_UNSEEN", 10, 20, 0, 5, 1, "detect unseen"],
  [389, "SPE_LEVITATION", 10, 20, 0, 5, 1, "levitation"],
  [390, "SPE_EXTRA_HEALING", 10, 27, 0, 5, 2, "extra healing"],
  [391, "SPE_RESTORE_ABILITY", 10, 25, 0, 5, 1, "restore ability"],
  [392, "SPE_INVISIBILITY", 10, 20, 0, 5, 1, "invisibility"],
  [393, "SPE_DETECT_TREASURE", 10, 20, 0, 5, 1, "detect treasure"],
  [394, "SPE_REMOVE_CURSE", 10, 25, 0, 5, 1, "remove curse"],
  [395, "SPE_MAGIC_MAPPING", 10, 18, 0, 5, 1, "magic mapping"],
  [396, "SPE_IDENTIFY", 10, 20, 0, 5, 1, "identify"],
  [397, "SPE_TURN_UNDEAD", 10, 16, 0, 5, 2, "turn undead"],
  [398, "SPE_POLYMORPH", 10, 10, 0, 5, 2, "polymorph"],
  [399, "SPE_TELEPORT_AWAY", 10, 15, 0, 5, 2, "teleport away"],
  [400, "SPE_CREATE_FAMILIAR", 10, 10, 0, 5, 1, "create familiar"],
  [401, "SPE_CANCELLATION", 10, 15, 0, 5, 2, "cancellation"],
  [402, "SPE_PROTECTION", 10, 18, 0, 5, 1, "protection"],
  [403, "SPE_JUMPING", 10, 20, 0, 5, 2, "jumping"],
  [404, "SPE_STONE_TO_FLESH", 10, 15, 0, 5, 2, "stone to flesh"],
  [405, "SPE_CHAIN_LIGHTNING", 10, 25, 0, 5, 1, "chain lightning"],
  [406, "SPE_BLANK_PAPER", 10, 18, 0, 5, 0, "blank paper"],
  [407, "SPE_NOVEL", 10, 1, 0, 5, 0, "novel"],
  [408, "SPE_BOOK_OF_THE_DEAD", 10, 0, 64, 5, 0, "Book of the Dead"],
  [409, "WAN_LIGHT", 11, 95, 1, 19, 1, "light"],
  [410, "WAN_SECRET_DOOR_DETECTION", 11, 50, 1, 8, 1, "secret door detection"],
  [411, "WAN_ENLIGHTENMENT", 11, 15, 1, 19, 1, "enlightenment"],
  [412, "WAN_CREATE_MONSTER", 11, 50, 1, 8, 1, "create monster"],
  [413, "WAN_WISHING", 11, 5, 1, 8, 1, "wishing"],
  [414, "WAN_STASIS", 11, 45, 1, 8, 1, "stasis"],
  [415, "WAN_NOTHING", 11, 25, 1, 8, 2, "nothing"],
  [416, "WAN_STRIKING", 11, 30, 1, 8, 2, "striking"],
  [417, "WAN_MAKE_INVISIBLE", 11, 45, 1, 21, 2, "make invisible"],
  [418, "WAN_SLOW_MONSTER", 11, 50, 1, 12, 2, "slow monster"],
  [419, "WAN_SPEED_MONSTER", 11, 50, 1, 13, 2, "speed monster"],
  [420, "WAN_UNDEAD_TURNING", 11, 50, 1, 13, 2, "undead turning"],
  [421, "WAN_POLYMORPH", 11, 45, 1, 14, 2, "polymorph"],
  [422, "WAN_CANCELLATION", 11, 45, 1, 16, 2, "cancellation"],
  [423, "WAN_TELEPORTATION", 11, 45, 1, 12, 2, "teleportation"],
  [424, "WAN_OPENING", 11, 30, 1, 12, 2, "opening"],
  [425, "WAN_LOCKING", 11, 30, 1, 12, 2, "locking"],
  [426, "WAN_PROBING", 11, 30, 1, 12, 2, "probing"],
  [427, "WAN_DIGGING", 11, 40, 1, 11, 3, "digging"],
  [428, "WAN_MAGIC_MISSILE", 11, 50, 1, 11, 3, "magic missile"],
  [429, "WAN_FIRE", 11, 40, 1, 11, 3, "fire"],
  [430, "WAN_COLD", 11, 40, 1, 11, 3, "cold"],
  [431, "WAN_SLEEP", 11, 50, 1, 11, 3, "sleep"],
  [432, "WAN_DEATH", 11, 5, 1, 11, 3, "death"],
  [433, "WAN_LIGHTNING", 11, 40, 1, 11, 3, "lightning"],
  [434, "WAN1", 11, 0, 1, 8, 0, ""],
  [435, "WAN2", 11, 0, 1, 11, 0, ""],
  [436, "WAN3", 11, 0, 1, 11, 0, ""],
  [437, "GOLD_PIECE", 12, 1000, 32, 15, 0, "gold piece"],
  [438, "DILITHIUM_CRYSTAL", 13, 2, 32, 20, 0, "dilithium crystal"],
  [439, "DIAMOND", 13, 3, 32, 20, 0, "diamond"],
  [440, "RUBY", 13, 4, 32, 20, 0, "ruby"],
  [441, "JACINTH", 13, 3, 32, 20, 0, "jacinth"],
  [442, "SAPPHIRE", 13, 4, 32, 20, 0, "sapphire"],
  [443, "BLACK_OPAL", 13, 3, 32, 20, 0, "black opal"],
  [444, "EMERALD", 13, 5, 32, 20, 0, "emerald"],
  [445, "TURQUOISE", 13, 6, 32, 20, 0, "turquoise"],
  [446, "CITRINE", 13, 4, 32, 20, 0, "citrine"],
  [447, "AQUAMARINE", 13, 6, 32, 20, 0, "aquamarine"],
  [448, "AMBER", 13, 8, 32, 20, 0, "amber"],
  [449, "TOPAZ", 13, 10, 32, 20, 0, "topaz"],
  [450, "JET", 13, 6, 32, 20, 0, "jet"],
  [451, "OPAL", 13, 12, 32, 20, 0, "opal"],
  [452, "CHRYSOBERYL", 13, 8, 32, 20, 0, "chrysoberyl"],
  [453, "GARNET", 13, 12, 32, 20, 0, "garnet"],
  [454, "AMETHYST", 13, 14, 32, 20, 0, "amethyst"],
  [455, "JASPER", 13, 15, 32, 20, 0, "jasper"],
  [456, "FLUORITE", 13, 15, 32, 20, 0, "fluorite"],
  [457, "OBSIDIAN", 13, 9, 32, 20, 0, "obsidian"],
  [458, "AGATE", 13, 12, 32, 20, 0, "agate"],
  [459, "JADE", 13, 10, 32, 20, 0, "jade"],
  [460, "WORTHLESS_WHITE_GLASS", 13, 77, 32, 19, 0, "worthless piece of white glass"],
  [461, "WORTHLESS_BLUE_GLASS", 13, 77, 32, 19, 0, "worthless piece of blue glass"],
  [462, "WORTHLESS_RED_GLASS", 13, 77, 32, 19, 0, "worthless piece of red glass"],
  [463, "WORTHLESS_YELLOWBROWN_GLASS", 13, 77, 32, 19, 0, "worthless piece of yellowish brown glass"],
  [464, "WORTHLESS_ORANGE_GLASS", 13, 76, 32, 19, 0, "worthless piece of orange glass"],
  [465, "WORTHLESS_YELLOW_GLASS", 13, 77, 32, 19, 0, "worthless piece of yellow glass"],
  [466, "WORTHLESS_BLACK_GLASS", 13, 76, 32, 19, 0, "worthless piece of black glass"],
  [467, "WORTHLESS_GREEN_GLASS", 13, 77, 32, 19, 0, "worthless piece of green glass"],
  [468, "WORTHLESS_VIOLET_GLASS", 13, 77, 32, 19, 0, "worthless piece of violet glass"],
  [469, "LUCKSTONE", 13, 10, 32, 21, 0, "luckstone"],
  [470, "LOADSTONE", 13, 10, 32, 21, 0, "loadstone"],
  [471, "TOUCHSTONE", 13, 8, 32, 21, 0, "touchstone"],
  [472, "FLINT", 13, 10, 32, 21, 0, "flint"],
  [473, "ROCK", 13, 100, 32, 21, 0, "rock"],
  [474, "BOULDER", 14, 100, 0, 21, 0, "boulder"],
  [475, "STATUE", 14, 900, 8, 21, 0, "statue"],
  [476, "HEAVY_IRON_BALL", 15, 1000, 0, 11, 0, "heavy iron ball"],
  [477, "IRON_CHAIN", 16, 1000, 0, 11, 0, "iron chain"],
  [478, "BLINDING_VENOM", 17, 500, 32, 1, 0, "splash of blinding venom"],
  [479, "ACID_VENOM", 17, 500, 32, 1, 0, "splash of acid venom"],
];

export const objects = OBJECT_DATA.map(([otyp, sym, oclass, prob, flags, material, dir, name]) => ({
    otyp, sym, oclass, oc_class: oclass, oc_prob: prob, flags, material, dir, name,
}));

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

function Inhell() {
    const dnum = game.u?.uz?.dnum ?? 0;
    return dnum === (game.gehennom_dnum ?? GEHENNOM);
}

function level_difficulty() {
    return depth_of_level(game.u?.uz);
}

function gem_probability(obj) {
    if (obj.otyp < DILITHIUM_CRYSTAL || obj.otyp > LAST_REAL_GEM)
        return obj.oc_prob;
    const lev = Math.max(0, level_difficulty() || 0);
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

function rnd_class(first, last) {
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

export function next_ident() {
    return rnd(2);
}

function rne(x) {
    const ulevel = game.u?.ulevel || 1;
    const utmp = ulevel < 15 ? 5 : Math.trunc(ulevel / 3);
    let tmp = 1;
    while (tmp < utmp && !rn2(x))
        tmp++;
    return tmp;
}

export function curse(otmp) {
    if (otmp) { otmp.cursed = true; otmp.blessed = false; }
}

function bless(otmp) {
    if (otmp) { otmp.blessed = true; otmp.cursed = false; }
}

function bcsign(otmp) {
    return (otmp?.blessed ? 1 : 0) - (otmp?.cursed ? 1 : 0);
}

export function blessorcurse(otmp, chance) {
    if (!otmp || otmp.blessed || otmp.cursed) return;
    if (!rn2(chance)) {
        if (!rn2(2)) curse(otmp);
        else bless(otmp);
    }
}

function hasFlag(otmp, flag) {
    return !!(objects[otmp.otyp]?.flags & flag);
}

function is_damageable(otmp) {
    const obj = objects[otmp.otyp];
    if (!obj) return false;
    const mat = obj.material;
    const rust = mat === IRON;
    const crack = mat === GLASS && otmp.oclass === ARMOR_CLASS;
    const corrode = mat === COPPER || mat === IRON;
    const flame = obj.otyp !== TALLOW_CANDLE && obj.otyp !== WAX_CANDLE
        && obj.otyp !== WAN_FIRE && ((mat <= WOOD && mat !== LIQUID) || mat === PLASTIC);
    const rot = ((mat <= WOOD && mat !== LIQUID) || mat === DRAGON_HIDE);
    return rust || crack || corrode || flame || rot;
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

function is_flammable(otmp) {
    const obj = objects[otmp.otyp];
    const mat = obj?.material ?? NO_MATERIAL;
    return otmp.otyp !== TALLOW_CANDLE && otmp.otyp !== WAX_CANDLE
        && otmp.otyp !== WAN_FIRE && ((mat <= WOOD && mat !== LIQUID) || mat === PLASTIC);
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

export function weight(otmp) {
    if (!otmp) return 0;
    const obj = objects[otmp.otyp];
    if (otmp.oclass === COIN_CLASS) return Math.max(Math.trunc(((otmp.quan || 1) + 50) / 100), 1);
    return Math.max(1, (obj?.weight ?? otmp.owt ?? 1) * (otmp.quan || 1));
}

export function place_object(otmp, x, y) {
    if (!otmp) return otmp;
    otmp.ox = x; otmp.oy = y; otmp.where = 'floor';
    if (game.level) {
        if (!game.level.objects) game.level.objects = [];
        game.level.objects.push(otmp);
    }
    return otmp;
}

export function add_to_container(container, otmp) {
    if (!container || !otmp) return otmp;
    if (!container.cobj) container.cobj = [];
    container.cobj.push(otmp);
    otmp.where = 'contained';
    return otmp;
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
            otmp.age = 0;
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
                if (otmp.otyp === BAG_OF_HOLDING) {
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
        if (artif && !rn2(20)) otmp.oartifact = 1;
        break;
    case FOOD_CLASS:
        otmp.oeaten = 0;
        switch (otmp.otyp) {
        case CORPSE: otmp.corpsenm = rndmonnum(); break;
        case EGG:
            if (!rn2(3)) otmp.corpsenm = rndmonnum();
            break;
        case TIN:
            if (!rn2(6)) {
                otmp.spe = 1;
            } else {
                otmp.corpsenm = rndmonnum();
            }
            blessorcurse(otmp, 10);
            break;
        case KELP_FROND:
            otmp.quan = rnd(2);
            break;
        case CANDY_BAR:
            otmp.spe = 1 + rn2(12);
            break;
        default:
            break;
        }
        if (otmp.otyp !== CORPSE && otmp.otyp !== MEAT_RING
            && otmp.otyp !== KELP_FROND && !rn2(6))
            otmp.quan = 2;
        break;
    case GEM_CLASS:
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
        case FIGURINE:
            otmp.corpsenm = rndmonnum_adj(5, 10);
            blessorcurse(otmp, 4);
            break;
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
        blessorcurse(otmp, 4);
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
        if (artif && !rn2(40)) otmp.oartifact = 1;
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
            if (rn2(Math.trunc(level_difficulty() / 2) + 10) > 10)
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

export function mksobj(otyp, init = true, artif = false) {
    const obj = objects[otyp] || objects[STRANGE_OBJECT];
    const otmp = {
        otyp, oclass: obj.oclass, ox: 0, oy: 0, quan: 1, owt: 1, cursed: false,
        blessed: false, olocked: false, otrapped: false, spe: 0, age: Math.max(game.moves ?? 1, 1),
    };
    otmp.o_id = next_ident();
    if (init) mksobj_init(otmp, artif);

    switch ((otmp.oclass === POTION_CLASS && otmp.otyp !== POT_OIL) ? POT_WATER : otmp.otyp) {
    case POT_OIL:
        otmp.age = 400;
        break;
    case SPE_NOVEL:
        otmp.novelidx = -1;
        break;
    default:
        break;
    }
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

export function mkgold(amount, x, y) {
    if (amount <= 0) {
        const d = depth_of_level(game.u?.uz);
        const mul = rnd(Math.trunc(30 / Math.max(12 - d, 2)));
        amount = 1 + rnd(level_difficulty() + 2) * mul;
    }
    const gold = mksobj_at(GOLD_PIECE, x, y, true, false);
    gold.quan = amount;
    gold.owt = weight(gold);
    return gold;
}
