// u_init.js - Initial inventory and attributes.
// C ref: u_init.c

import { game } from './gstate.js';
import { rn2, rnd, rne, rn1 } from './rng.js';
import { addinv as invent_addinv } from './invent.js';
import { initialspell } from './spell.js';
import {
    ARMOR_CLASS,
    COIN_CLASS,
    FOOD_CLASS,
    GEM_CLASS,
    GOLD_PIECE,
    MAGIC_MARKER,
    POTION_CLASS,
    RING_CLASS,
    SCROLL_CLASS,
    SPBOOK_CLASS,
    TOOL_CLASS,
    WAND_CLASS,
    WEAPON_CLASS,
    mkobj,
    mksobj,
    objects,
    weight,
} from './mkobj.js';
import { roles, races } from './role.js';

export const UNDEF_TYP = 0;
export const UNDEF_SPE = 0x7f;
export const UNDEF_BLESS = 2;

const PM_ARCHEOLOGIST = 0;
const PM_BARBARIAN = 1;
const PM_CAVE_DWELLER = 2;
const PM_HEALER = 3;
const PM_KNIGHT = 4;
const PM_MONK = 5;
const PM_CLERIC = 6; // Priest/Priestess
const PM_RANGER = 7;
const PM_ROGUE = 8;
const PM_SAMURAI = 9;
const PM_TOURIST = 10;
const PM_VALKYRIE = 11;
const PM_WIZARD = 12;
const A_CHAOTIC = -1;

// C ref: include/monsters.h player-race monster numbers (urace.mnum).
const PM_HUMAN = 0;
const PM_ELF = 1;
const PM_DWARF = 2;
const PM_GNOME = 3;
const PM_ORC = 4;

// C ref: u_init.c Xtra_food[] — orc compensation: 2 random food items.
const XTRA_FOOD_TRQUAN = 2;

const YA = 22;
const ARROW = 18;
const DART = 24;
const SPEAR = 27;
const DAGGER = 34;
const SCALPEL = 39;
const AXE = 44;
const BATTLE_AXE = 45;
const SHORT_SWORD = 46;
const LONG_SWORD = 54;
const TWO_HANDED_SWORD = 55;
const KATANA = 56;
const LANCE = 72;
const MACE = 73;
const CLUB = 77;
const QUARTERSTAFF = 79;
const BULLWHIP = 82;
const BOW = 83;
const YUMI = 86;
const SLING = 87;
const FEDORA = 92;
const HELMET = 97;
const SPLINT_MAIL = 124;
const RING_MAIL = 132;
const LEATHER_ARMOR = 134;
const LEATHER_JACKET = 135;
const HAWAIIAN_SHIRT = 136;
const ROBE = 143;
const CLOAK_OF_MAGIC_RESISTANCE = 148;
const CLOAK_OF_DISPLACEMENT = 149;
const SMALL_SHIELD = 150;
const LEATHER_GLOVES = 159;
const SACK = 217;
const LOCK_PICK = 222;
const CREDIT_CARD = 223;
const OIL_LAMP = 227;
const EXPENSIVE_CAMERA = 229;
const BLINDFOLD = 233;
const TOWEL = 234;
const LEASH = 236;
const STETHOSCOPE = 237;
const TINNING_KIT = 238;
const TIN_OPENER = 239;
const PICK_AXE = 259;
const ORANGE = 278;
const FORTUNE_COOKIE = 289;
const SPRIG_OF_WOLFSBANE = 283;
const CLOVE_OF_GARLIC = 284;
const POT_SICKNESS = 318;
const POT_WATER = 322;
const APPLE = 277;
const CARROT = 282;
const PANCAKE = 290;
const CRAM_RATION = 292;
const FOOD_RATION = 293;
const POT_HEALING = 307;
const POT_EXTRA_HEALING = 308;
const SCR_MAGIC_MAPPING = 337;
const SPE_HEALING = 373;
const SPE_CONFUSE_MONSTER = 376;
const SPE_EXTRA_HEALING = 390;
const SPE_PROTECTION = 402;
const SPE_STONE_TO_FLESH = 404;
const WAN_SLEEP = 431;
const TOUCHSTONE = 471;
const FLINT = 472;
const ROCK = 473;
const POT_HALLUCINATION = 304;
const POT_POLYMORPH = 316;
const POT_ACID = 320;
const SCR_ENCHANT_WEAPON = 328;
const SCR_AMNESIA = 338;
const SCR_FIRE = 339;
const SCR_BLANK_PAPER = 364;
const SPE_FORCE_BOLT = 375;
const SPE_POLYMORPH = 398;
const SPE_BLANK_PAPER = 406;
const SPE_NOVEL = 407;
const WAN_WISHING = 413;
const WAN_NOTHING = 415;
const WAN_POLYMORPH = 421;
const RIN_LEVITATION = 183;
const RIN_HUNGER = 184;
const RIN_AGGRAVATE_MONSTER = 185;
const RIN_POISON_RESISTANCE = 188;
const RIN_POLYMORPH = 196;
const RIN_POLYMORPH_CONTROL = 197;

// C ref: include/objects.h — non-magic instruments for the elf race start.
const WOODEN_FLUTE = 247;
const TOOLED_HORN = 249;
const WOODEN_HARP = 253;
const BELL = 255;
const BUGLE = 256;
const LEATHER_DRUM = 257;

const F_CHARGED = 1;

const Knight = [
    { trotyp: LONG_SWORD, trspe: 1, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: LANCE, trspe: 1, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: RING_MAIL, trspe: 1, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: HELMET, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: SMALL_SHIELD, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: LEATHER_GLOVES, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: APPLE, trspe: 0, trclass: FOOD_CLASS, trquan_min: 10, trquan_max: 10, trbless: 0 },
    { trotyp: CARROT, trspe: 0, trclass: FOOD_CLASS, trquan_min: 10, trquan_max: 10, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

const Wizard = [
    { trotyp: QUARTERSTAFF, trspe: 1, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: 1 },
    { trotyp: CLOAK_OF_MAGIC_RESISTANCE, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: WAND_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: RING_CLASS, trquan_min: 2, trquan_max: 2, trbless: UNDEF_BLESS },
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: POTION_CLASS, trquan_min: 3, trquan_max: 3, trbless: UNDEF_BLESS },
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: SCROLL_CLASS, trquan_min: 3, trquan_max: 3, trbless: UNDEF_BLESS },
    { trotyp: SPE_FORCE_BOLT, trspe: 0, trclass: SPBOOK_CLASS, trquan_min: 1, trquan_max: 1, trbless: 1 },
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: SPBOOK_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: MAGIC_MARKER, trspe: 19, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Priest[].
const Priest = [
    { trotyp: MACE, trspe: 1, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: 1 },
    { trotyp: ROBE, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: SMALL_SHIELD, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: POT_WATER, trspe: 0, trclass: POTION_CLASS, trquan_min: 4, trquan_max: 4, trbless: 1 }, // holy water
    { trotyp: CLOVE_OF_GARLIC, trspe: 0, trclass: FOOD_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: SPRIG_OF_WOLFSBANE, trspe: 0, trclass: FOOD_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: SPBOOK_CLASS, trquan_min: 2, trquan_max: 2, trbless: UNDEF_BLESS },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Rogue[].
const Rogue = [
    { trotyp: SHORT_SWORD, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: DAGGER, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 6, trquan_max: 15, trbless: 0 },
    { trotyp: LEATHER_ARMOR, trspe: 1, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: POT_SICKNESS, trspe: 0, trclass: POTION_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: LOCK_PICK, trspe: 0, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: SACK, trspe: 0, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Samurai[].
const Samurai = [
    { trotyp: KATANA, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: SHORT_SWORD, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS }, // wakizashi
    { trotyp: YUMI, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: YA, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 26, trquan_max: 45, trbless: UNDEF_BLESS },
    { trotyp: SPLINT_MAIL, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Archeologist[].
const Archeologist = [
    { trotyp: BULLWHIP, trspe: 2, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: LEATHER_JACKET, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: FEDORA, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: FOOD_RATION, trspe: 0, trclass: FOOD_CLASS, trquan_min: 3, trquan_max: 3, trbless: 0 },
    { trotyp: PICK_AXE, trspe: UNDEF_SPE, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: TINNING_KIT, trspe: UNDEF_SPE, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: TOUCHSTONE, trspe: 0, trclass: GEM_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: SACK, trspe: 0, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Barbarian_0[] / Barbarian_1[].
const Barbarian_0 = [
    { trotyp: TWO_HANDED_SWORD, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: AXE, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: RING_MAIL, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: FOOD_RATION, trspe: 0, trclass: FOOD_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];
const Barbarian_1 = [
    { trotyp: BATTLE_AXE, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: SHORT_SWORD, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: RING_MAIL, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: FOOD_RATION, trspe: 0, trclass: FOOD_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Cave_man[].
const Cave_man = [
    { trotyp: CLUB, trspe: 1, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: SLING, trspe: 2, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: FLINT, trspe: 0, trclass: GEM_CLASS, trquan_min: 10, trquan_max: 20, trbless: UNDEF_BLESS },
    { trotyp: ROCK, trspe: 0, trclass: GEM_CLASS, trquan_min: 3, trquan_max: 3, trbless: 0 },
    { trotyp: LEATHER_ARMOR, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Healer[].
const Healer = [
    { trotyp: SCALPEL, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: LEATHER_GLOVES, trspe: 1, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: STETHOSCOPE, trspe: 0, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: POT_HEALING, trspe: 0, trclass: POTION_CLASS, trquan_min: 4, trquan_max: 4, trbless: UNDEF_BLESS },
    { trotyp: POT_EXTRA_HEALING, trspe: 0, trclass: POTION_CLASS, trquan_min: 4, trquan_max: 4, trbless: UNDEF_BLESS },
    { trotyp: WAN_SLEEP, trspe: UNDEF_SPE, trclass: WAND_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: SPE_HEALING, trspe: 0, trclass: SPBOOK_CLASS, trquan_min: 1, trquan_max: 1, trbless: 1 },
    { trotyp: SPE_EXTRA_HEALING, trspe: 0, trclass: SPBOOK_CLASS, trquan_min: 1, trquan_max: 1, trbless: 1 },
    { trotyp: SPE_STONE_TO_FLESH, trspe: 0, trclass: SPBOOK_CLASS, trquan_min: 1, trquan_max: 1, trbless: 1 },
    { trotyp: APPLE, trspe: 0, trclass: FOOD_CLASS, trquan_min: 5, trquan_max: 5, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Monk[].
const Monk = [
    { trotyp: LEATHER_GLOVES, trspe: 2, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: ROBE, trspe: 1, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: SCROLL_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: POT_HEALING, trspe: 0, trclass: POTION_CLASS, trquan_min: 3, trquan_max: 3, trbless: UNDEF_BLESS },
    { trotyp: FOOD_RATION, trspe: 0, trclass: FOOD_CLASS, trquan_min: 3, trquan_max: 3, trbless: 0 },
    { trotyp: APPLE, trspe: 0, trclass: FOOD_CLASS, trquan_min: 5, trquan_max: 5, trbless: UNDEF_BLESS },
    { trotyp: ORANGE, trspe: 0, trclass: FOOD_CLASS, trquan_min: 5, trquan_max: 5, trbless: UNDEF_BLESS },
    { trotyp: FORTUNE_COOKIE, trspe: 0, trclass: FOOD_CLASS, trquan_min: 3, trquan_max: 3, trbless: UNDEF_BLESS },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Ranger[].
const Ranger = [
    { trotyp: DAGGER, trspe: 1, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: BOW, trspe: 1, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: ARROW, trspe: 2, trclass: WEAPON_CLASS, trquan_min: 50, trquan_max: 59, trbless: UNDEF_BLESS },
    { trotyp: ARROW, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 30, trquan_max: 39, trbless: UNDEF_BLESS },
    { trotyp: CLOAK_OF_DISPLACEMENT, trspe: 2, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: CRAM_RATION, trspe: 0, trclass: FOOD_CLASS, trquan_min: 4, trquan_max: 4, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Tourist[].
const Tourist = [
    { trotyp: DART, trspe: 2, trclass: WEAPON_CLASS, trquan_min: 21, trquan_max: 40, trbless: UNDEF_BLESS },
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: FOOD_CLASS, trquan_min: 10, trquan_max: 10, trbless: 0 },
    { trotyp: POT_EXTRA_HEALING, trspe: 0, trclass: POTION_CLASS, trquan_min: 2, trquan_max: 2, trbless: UNDEF_BLESS },
    { trotyp: SCR_MAGIC_MAPPING, trspe: 0, trclass: SCROLL_CLASS, trquan_min: 4, trquan_max: 4, trbless: UNDEF_BLESS },
    { trotyp: HAWAIIAN_SHIRT, trspe: 0, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: EXPENSIVE_CAMERA, trspe: UNDEF_SPE, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: CREDIT_CARD, trspe: 0, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Valkyrie[].
const Valkyrie = [
    { trotyp: SPEAR, trspe: 1, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: DAGGER, trspe: 0, trclass: WEAPON_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: SMALL_SHIELD, trspe: 3, trclass: ARMOR_CLASS, trquan_min: 1, trquan_max: 1, trbless: UNDEF_BLESS },
    { trotyp: FOOD_RATION, trspe: 0, trclass: FOOD_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Monk M_spell[] (Healing_book/Protection_book/Confuse_monster_book).
const Healing_book = [
    { trotyp: SPE_HEALING, trspe: UNDEF_SPE, trclass: SPBOOK_CLASS, trquan_min: 1, trquan_max: 1, trbless: 1 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];
const Protection_book = [
    { trotyp: SPE_PROTECTION, trspe: UNDEF_SPE, trclass: SPBOOK_CLASS, trquan_min: 1, trquan_max: 1, trbless: 1 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];
const Confuse_monster_book = [
    { trotyp: SPE_CONFUSE_MONSTER, trspe: UNDEF_SPE, trclass: SPBOOK_CLASS, trquan_min: 1, trquan_max: 1, trbless: 1 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];
const M_spell = [Healing_book, Protection_book, Confuse_monster_book];

// C ref: u_init.c Tinopener[] / Leash[] / Towel[].
const Tinopener = [
    { trotyp: TIN_OPENER, trspe: 0, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];
const Leash = [
    { trotyp: LEASH, trspe: 0, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];
const Towel = [
    { trotyp: TOWEL, trspe: 0, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

const Blindfold = [
    { trotyp: BLINDFOLD, trspe: 0, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Magicmarker[] / Lamp[] (optional extras).
const Magicmarker = [
    { trotyp: MAGIC_MARKER, trspe: 19, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

const Lamp = [
    { trotyp: OIL_LAMP, trspe: 1, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Money[] = { { GOLD_PIECE, 0, COIN_CLASS, 1, 1, 0 }, ... }.
// u_init_inventory_attrs() runs ini_inv(Money) whenever u.umoney0 > 0 (e.g.
// the Tourist's rnd(1000) starting gold).  ini_inv_adjust_obj sets the coin
// quantity to u.umoney0 directly, but the trobj still emits trquan() (rn2(1))
// plus the GOLD_PIECE mksobj's next_ident rnd(2), so it must run for parity.
const Money = [
    { trotyp: GOLD_PIECE, trspe: 0, trclass: COIN_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c Xtra_food[] — 2 random FOOD_CLASS items (orc compensation).
const Xtra_food = [
    { trotyp: UNDEF_TYP, trspe: UNDEF_SPE, trclass: FOOD_CLASS, trquan_min: XTRA_FOOD_TRQUAN, trquan_max: XTRA_FOOD_TRQUAN, trbless: 0 },
    { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
];

// C ref: u_init.c u_init_race PM_ELF — a single random non-magic instrument
// chosen via ROLL_FROM(trotyp) = trotyp[rn2(6)] (cleric/wizard elves only).
const ELF_INSTRUMENTS = [WOODEN_FLUTE, TOOLED_HORN, WOODEN_HARP, BELL, BUGLE, LEATHER_DRUM];

const ROLE_INVENTORY = new Map([
    [PM_ARCHEOLOGIST, Archeologist],
    [PM_CAVE_DWELLER, Cave_man],
    [PM_HEALER, Healer],
    [PM_KNIGHT, Knight],
    [PM_MONK, Monk],
    [PM_CLERIC, Priest],
    [PM_RANGER, Ranger],
    [PM_ROGUE, Rogue],
    [PM_SAMURAI, Samurai],
    [PM_TOURIST, Tourist],
    [PM_VALKYRIE, Valkyrie],
    [PM_WIZARD, Wizard],
    // Barbarian picks Barbarian_0/Barbarian_1 via rn2 in u_init_role.
]);

// C ref: role.c — hpadv/enadv advance structs {infix,inrnd,lofix,lornd,hifix,hirnd}.
// Only the level-0 (initial) fields infix/inrnd are used here.
// role.c hpadv/enadv {infix,inrnd,...}; only level-0 infix/inrnd are used.
const ROLE_ADV = new Map([
    [PM_ARCHEOLOGIST, { hpadv: { infix: 11, inrnd: 0 }, enadv: { infix: 1, inrnd: 0 } }],
    [PM_BARBARIAN, { hpadv: { infix: 14, inrnd: 0 }, enadv: { infix: 1, inrnd: 0 } }],
    [PM_CAVE_DWELLER, { hpadv: { infix: 14, inrnd: 0 }, enadv: { infix: 1, inrnd: 0 } }],
    [PM_HEALER, { hpadv: { infix: 11, inrnd: 0 }, enadv: { infix: 1, inrnd: 4 } }],
    [PM_KNIGHT, { hpadv: { infix: 14, inrnd: 0 }, enadv: { infix: 1, inrnd: 4 } }],
    [PM_MONK, { hpadv: { infix: 12, inrnd: 0 }, enadv: { infix: 2, inrnd: 2 } }],
    // role.c Priest: hp {12,0,...}, en {4,3,0,2,0,2} -> inrnd=3.
    [PM_CLERIC, { hpadv: { infix: 12, inrnd: 0 }, enadv: { infix: 4, inrnd: 3 } }],
    [PM_RANGER, { hpadv: { infix: 13, inrnd: 0 }, enadv: { infix: 1, inrnd: 0 } }],
    // role.c Rogue: hp {10,0,...}, en {1,0,0,1,0,1} -> inrnd=0.
    [PM_ROGUE, { hpadv: { infix: 10, inrnd: 0 }, enadv: { infix: 1, inrnd: 0 } }],
    // role.c Samurai: hp {13,0,...}, en {1,0,0,1,0,1} -> inrnd=0.
    [PM_SAMURAI, { hpadv: { infix: 13, inrnd: 0 }, enadv: { infix: 1, inrnd: 0 } }],
    [PM_TOURIST, { hpadv: { infix: 8, inrnd: 0 }, enadv: { infix: 1, inrnd: 0 } }],
    [PM_VALKYRIE, { hpadv: { infix: 14, inrnd: 0 }, enadv: { infix: 1, inrnd: 0 } }],
    [PM_WIZARD, { hpadv: { infix: 10, inrnd: 0 }, enadv: { infix: 4, inrnd: 3 } }],
]);
// Human race advance (the only race used by these sessions).
const RACE_ADV_HUMAN = { hpadv: { infix: 2, inrnd: 0 }, enadv: { infix: 1, inrnd: 0 } };

// Player-monster base armor class (mons[].ac).  C ref: include/monsters.h
// — every player-monster (all 13 roles) has base AC 10.
const PLAYER_BASE_AC_DEFAULT = 10;

// a_ac (objects[].a_ac = 10 - macro ac arg) for the starting armor pieces.
// C ref: include/objects.h ARMOR()/HELM()/SHIELD()/GLOVES()/CLOAK().
const ARMOR_A_AC = new Map([
    [RING_MAIL, 3],
    [HELMET, 1],
    [SMALL_SHIELD, 1],
    [LEATHER_GLOVES, 1],
    [CLOAK_OF_MAGIC_RESISTANCE, 1],
    [LEATHER_JACKET, 1],
    [FEDORA, 0],
    [LEATHER_ARMOR, 2],
    [ROBE, 2],
    [SPLINT_MAIL, 6],
    [CLOAK_OF_DISPLACEMENT, 1],
    [HAWAIIAN_SHIRT, 0],
]);

// Worn-armor slot masks (subset of do_wear.c W_ARM*).
const W_ARM = 0x01;
const W_ARMC = 0x02;
const W_ARMH = 0x04;
const W_ARMS = 0x08;
const W_ARMG = 0x10;
const W_ARMF = 0x20;
const W_ARMU = 0x40;
// C ref: prop.h — wielded/quiver/secondary weapon slot masks.
const W_WEP = 0x100;
const W_QUIVER = 0x200;
const W_SWAPWEP = 0x400;

// C ref: objclass.h armor-category predicates (is_cloak/is_helmet/...).
const CLOAK_OTYPS = new Set([CLOAK_OF_MAGIC_RESISTANCE, CLOAK_OF_DISPLACEMENT, ROBE]);
const HELM_OTYPS = new Set([HELMET, FEDORA]);
const GLOVES_OTYPS = new Set([LEATHER_GLOVES]);
const SHIELD_OTYPS = new Set([SMALL_SHIELD]);
const SHIRT_OTYPS = new Set([HAWAIIAN_SHIRT]);
const SUIT_OTYPS = new Set([RING_MAIL, LEATHER_ARMOR, LEATHER_JACKET, SPLINT_MAIL]);
function is_cloak(obj) { return CLOAK_OTYPS.has(obj?.otyp); }
function is_helmet(obj) { return HELM_OTYPS.has(obj?.otyp); }
function is_gloves(obj) { return GLOVES_OTYPS.has(obj?.otyp); }
function is_shield(obj) { return SHIELD_OTYPS.has(obj?.otyp); }
function is_shirt(obj) { return SHIRT_OTYPS.has(obj?.otyp); }
function is_suit(obj) { return SUIT_OTYPS.has(obj?.otyp); }

// C ref: do.c setworn — record a worn armor object on the hero.
function setworn(obj, mask) {
    if (!obj) return;
    obj.owornmask = (obj.owornmask || 0) | mask;
    if (mask === W_ARM) game.uarm = obj;
    else if (mask === W_ARMC) game.uarmc = obj;
    else if (mask === W_ARMH) game.uarmh = obj;
    else if (mask === W_ARMS) game.uarms = obj;
    else if (mask === W_ARMG) game.uarmg = obj;
    else if (mask === W_ARMF) game.uarmf = obj;
    else if (mask === W_ARMU) game.uarmu = obj;
}

// C ref: u_init.c ini_inv_use_obj — auto-wear starting armor and wield
// starting weapon(s).  Ammo/missiles fill the quiver; the first wieldable
// weapon becomes the primary (uwep) and the next the secondary (uswapwep),
// matching the C order so e.g. the Samurai starts katana/short-sword ready
// to two-weapon and the inventory display marks them correctly.
function ini_inv_wear_armor(obj) {
    if (obj.oclass === ARMOR_CLASS) {
        if (is_shield(obj) && !game.uarms) setworn(obj, W_ARMS);
        else if (is_helmet(obj) && !game.uarmh) setworn(obj, W_ARMH);
        else if (is_gloves(obj) && !game.uarmg) setworn(obj, W_ARMG);
        else if (is_shirt(obj) && !game.uarmu) setworn(obj, W_ARMU);
        else if (is_cloak(obj) && !game.uarmc) setworn(obj, W_ARMC);
        else if (is_suit(obj) && !game.uarm) setworn(obj, W_ARM);
    }

    // C ref: u_init.c ini_inv_use_obj — wield the starting weapon(s).
    if (obj.oclass === WEAPON_CLASS) {
        if (ini_is_ammo(obj)) {
            if (!game.uquiver) { obj.owornmask = (obj.owornmask || 0) | W_QUIVER; game.uquiver = obj; }
        } else if (!game.uwep) {
            obj.owornmask = (obj.owornmask || 0) | W_WEP; game.uwep = obj;
        } else if (!game.uswapwep) {
            obj.owornmask = (obj.owornmask || 0) | W_SWAPWEP; game.uswapwep = obj;
        }
    }
}

// C ref: objclass.h is_ammo — a stacked (quan>1) weapon is treated as ammo
// for the starting-quiver decision (matches invent.js is_ammo).
function ini_is_ammo(obj) { return obj.oclass === WEAPON_CLASS && (obj.quan || 1) > 1; }

// C ref: hack.h ARM_BONUS — a_ac + spe (no erosion at game start).
function ARM_BONUS(obj) {
    return (ARMOR_A_AC.get(obj.otyp) || 0) + (obj.spe || 0);
}

// C ref: do_wear.c find_ac — current armor class from worn gear.
export function find_ac() {
    const base = PLAYER_BASE_AC_DEFAULT;
    let uac = base;
    for (const obj of [game.uarm, game.uarmc, game.uarmh, game.uarmf,
        game.uarms, game.uarmg, game.uarmu]) {
        if (obj) uac -= ARM_BONUS(obj);
    }
    game.u = game.u || {};
    game.u.uac = uac;
    return uac;
}

// C ref: attrib.c newhp() / exper.c newpw() — level-0 HP and Pw.
// The single rnd() each role's enadv contributes is emitted here at the
// same RNG position the old fastforward_newpw() used.
export function newhp() {
    const adv = ROLE_ADV.get(current_role_mnum());
    if (!adv) return 0;
    let hp = adv.hpadv.infix + RACE_ADV_HUMAN.hpadv.infix;
    if (adv.hpadv.inrnd > 0) hp += rnd(adv.hpadv.inrnd);
    if (RACE_ADV_HUMAN.hpadv.inrnd > 0) hp += rnd(RACE_ADV_HUMAN.hpadv.inrnd);
    return hp;
}

export function newpw() {
    const adv = ROLE_ADV.get(current_role_mnum());
    if (!adv) return 0;
    let en = adv.enadv.infix + RACE_ADV_HUMAN.enadv.infix;
    if (adv.enadv.inrnd > 0) en += rnd(adv.enadv.inrnd);
    if (RACE_ADV_HUMAN.enadv.inrnd > 0) en += rnd(RACE_ADV_HUMAN.enadv.inrnd);
    if (en <= 0) en = 1;
    return en;
}

const A_MAX = 6;
const HUMAN_ATTRMIN = [3, 3, 3, 3, 3, 3];
const HUMAN_ATTRMAX = [118, 18, 18, 18, 18, 18]; // STR18(100), then plain 18s.

// role.c attrbase/attrdist, order [Str,Int,Wis,Dex,Con,Cha].
const ROLE_ATTRS = new Map([
    [PM_ARCHEOLOGIST, { attrbase: [7, 10, 10, 7, 7, 7], attrdist: [20, 20, 20, 10, 20, 10] }],
    [PM_BARBARIAN, { attrbase: [16, 7, 7, 15, 16, 6], attrdist: [30, 6, 7, 20, 30, 7] }],
    [PM_CAVE_DWELLER, { attrbase: [10, 7, 7, 7, 8, 6], attrdist: [30, 6, 7, 20, 30, 7] }],
    [PM_HEALER, { attrbase: [7, 7, 13, 7, 11, 16], attrdist: [15, 20, 20, 15, 25, 5] }],
    [PM_KNIGHT, {
        attrbase: [13, 7, 14, 8, 10, 17],
        attrdist: [30, 15, 15, 10, 20, 10],
    }],
    [PM_MONK, { attrbase: [10, 7, 8, 8, 7, 7], attrdist: [25, 10, 20, 20, 15, 10] }],
    [PM_CLERIC, {
        attrbase: [7, 7, 10, 7, 7, 7],
        attrdist: [15, 10, 30, 15, 20, 10],
    }],
    [PM_RANGER, { attrbase: [13, 13, 13, 9, 13, 7], attrdist: [30, 10, 10, 20, 20, 10] }],
    [PM_ROGUE, {
        attrbase: [7, 7, 7, 10, 7, 6],
        attrdist: [20, 10, 10, 30, 20, 10],
    }],
    [PM_SAMURAI, {
        attrbase: [10, 8, 7, 10, 17, 6],
        attrdist: [30, 10, 8, 30, 14, 8],
    }],
    [PM_TOURIST, { attrbase: [7, 10, 6, 7, 7, 10], attrdist: [15, 10, 10, 15, 30, 20] }],
    [PM_VALKYRIE, { attrbase: [10, 7, 7, 7, 10, 7], attrdist: [30, 6, 7, 20, 30, 7] }],
    [PM_WIZARD, {
        attrbase: [7, 10, 7, 7, 7, 7],
        attrdist: [10, 30, 10, 20, 20, 10],
    }],
]);

function current_role_mnum() {
    if (Number.isInteger(game.initrole))
        return roles[game.initrole]?.mnum ?? game.initrole;
    const name = String(game.initrole || '').toLowerCase();
    const role = roles.find((r) => r.name?.m?.toLowerCase() === name
        || r.name?.f?.toLowerCase() === name);
    return role?.mnum ?? null;
}

// C ref: urace.mnum — the player race's monster number.  game.initrace is the
// index into races[]; default to human when unset.
function current_race_mnum() {
    if (Number.isInteger(game.initrace))
        return races[game.initrace]?.mnum ?? game.initrace;
    const name = String(game.initrace || '').toLowerCase();
    const race = races.find((r) => r.name?.toLowerCase() === name);
    return race?.mnum ?? PM_HUMAN;
}

/* randomizes the quantity given a trobj description */
export function trquan(trop) {
    if (!trop?.trquan_min)
        return 1;
    return trop.trquan_min + rn2(trop.trquan_max - trop.trquan_min + 1);
}

function addinv(obj) {
    return invent_addinv(obj);
}

function ini_inv_obj_substitution(trop, obj) {
    void trop;
    return obj.otyp;
}

function uinit_nocreate() {
    game.uinit_nocreate = game.uinit_nocreate || [0, 0, 0, 0];
    return game.uinit_nocreate;
}

function reset_uinit_nocreate() {
    game.uinit_nocreate = [0, 0, 0, 0];
}

function role_is(pm) {
    return current_role_mnum() === pm;
}

function race_is(pm) {
    return current_race_mnum() === pm;
}

// C ref: include/skills.h — spell skill-type ids (P_ATTACK_SPELL..P_MATTER_SPELL).
const P_NONE = 0;

// C ref: include/objects.h SPELL(name,desc,sub,prob,delay,level,...) — the
// spell's skill discipline (oc_skill) and spell level (oc_level), keyed by
// otyp.  spell_skilltype(otyp)==objects[otyp].oc_skill (spell.c:856); the JS
// objects table doesn't carry oc_skill/oc_level, so they live here.
export const SPELL_META = new Map([
    [365, { skill: 34, level: 5 }], // SPE_DIG
    [366, { skill: 28, level: 2 }], // SPE_MAGIC_MISSILE
    [367, { skill: 28, level: 4 }], // SPE_FIREBALL
    [368, { skill: 28, level: 4 }], // SPE_CONE_OF_COLD
    [369, { skill: 31, level: 3 }], // SPE_SLEEP
    [370, { skill: 28, level: 7 }], // SPE_FINGER_OF_DEATH
    [371, { skill: 30, level: 1 }], // SPE_LIGHT
    [372, { skill: 30, level: 1 }], // SPE_DETECT_MONSTERS
    [373, { skill: 29, level: 1 }], // SPE_HEALING
    [374, { skill: 34, level: 1 }], // SPE_KNOCK
    [375, { skill: 28, level: 1 }], // SPE_FORCE_BOLT
    [376, { skill: 31, level: 1 }], // SPE_CONFUSE_MONSTER
    [377, { skill: 29, level: 2 }], // SPE_CURE_BLINDNESS
    [378, { skill: 28, level: 2 }], // SPE_DRAIN_LIFE
    [379, { skill: 31, level: 2 }], // SPE_SLOW_MONSTER
    [380, { skill: 34, level: 2 }], // SPE_WIZARD_LOCK
    [381, { skill: 32, level: 2 }], // SPE_CREATE_MONSTER
    [382, { skill: 30, level: 2 }], // SPE_DETECT_FOOD
    [383, { skill: 31, level: 3 }], // SPE_CAUSE_FEAR
    [384, { skill: 30, level: 3 }], // SPE_CLAIRVOYANCE
    [385, { skill: 29, level: 3 }], // SPE_CURE_SICKNESS
    [386, { skill: 31, level: 5 }], // SPE_CHARM_MONSTER
    [387, { skill: 33, level: 3 }], // SPE_HASTE_SELF
    [388, { skill: 30, level: 3 }], // SPE_DETECT_UNSEEN
    [389, { skill: 33, level: 4 }], // SPE_LEVITATION
    [390, { skill: 29, level: 3 }], // SPE_EXTRA_HEALING
    [391, { skill: 29, level: 4 }], // SPE_RESTORE_ABILITY
    [392, { skill: 33, level: 4 }], // SPE_INVISIBILITY
    [393, { skill: 30, level: 4 }], // SPE_DETECT_TREASURE
    [394, { skill: 32, level: 3 }], // SPE_REMOVE_CURSE
    [395, { skill: 30, level: 5 }], // SPE_MAGIC_MAPPING
    [396, { skill: 30, level: 3 }], // SPE_IDENTIFY
    [397, { skill: 32, level: 6 }], // SPE_TURN_UNDEAD
    [398, { skill: 34, level: 6 }], // SPE_POLYMORPH
    [399, { skill: 33, level: 6 }], // SPE_TELEPORT_AWAY
    [400, { skill: 32, level: 6 }], // SPE_CREATE_FAMILIAR
    [401, { skill: 34, level: 7 }], // SPE_CANCELLATION
    [402, { skill: 32, level: 1 }], // SPE_PROTECTION
    [403, { skill: 33, level: 1 }], // SPE_JUMPING
    [404, { skill: 29, level: 3 }], // SPE_STONE_TO_FLESH
    [405, { skill: 28, level: 2 }], // SPE_CHAIN_LIGHTNING
    // SPE_BLANK_PAPER(406)/SPE_NOVEL(407)/SPE_BOOK_OF_THE_DEAD(408): P_NONE, level 0.
]);

// C ref: u_init.c skills_for_role() — the SPELL-discipline skill ids each
// role can train.  Non-spell skill entries are irrelevant to
// restricted_spell_discipline (spell_skilltype only ever returns a spell
// discipline or P_NONE), so only spell disciplines are kept here.
const ROLE_SPELL_SKILLS = new Map([
    [PM_ARCHEOLOGIST, new Set([28, 29, 30, 34])],
    [PM_BARBARIAN, new Set([28, 33])],
    [PM_CAVE_DWELLER, new Set([28, 34])],
    [PM_HEALER, new Set([29])],
    [PM_KNIGHT, new Set([28, 29, 32])],
    [PM_MONK, new Set([28, 29, 30, 31, 32, 33, 34])],
    [PM_CLERIC, new Set([29, 30, 32])],
    [PM_ROGUE, new Set([30, 33, 34])],
    [PM_RANGER, new Set([29, 30, 33])],
    [PM_SAMURAI, new Set([28, 30, 32])],
    [PM_TOURIST, new Set([30, 31, 33])],
    [PM_VALKYRIE, new Set([28, 33])],
    [PM_WIZARD, new Set([28, 29, 30, 31, 32, 33, 34])],
]);

// C ref: spell.c spell_skilltype — objects[booktype].oc_skill.
function spell_skilltype(otyp) {
    return SPELL_META.get(otyp)?.skill ?? P_NONE;
}

// C ref: objects[otyp].oc_level (the SPELL() macro's `level` argument).
function spell_level(otyp) {
    return SPELL_META.get(otyp)?.level ?? 0;
}

// C ref: u_init.c restricted_spell_discipline — TRUE when the spell's
// discipline is not in the role's skill list (skills aren't initialized yet,
// so the role-specific skill list is consulted directly).
function restricted_spell_discipline(otyp) {
    const skills = ROLE_SPELL_SKILLS.get(current_role_mnum());
    const thisSkill = spell_skilltype(otyp);
    // P_NONE never matches any skill-list entry -> restricted, like the C loop.
    if (thisSkill === P_NONE || !skills)
        return true;
    return !skills.has(thisSkill);
}

function is_forbidden_ini_obj(obj, got_level1_spellbook) {
    const otyp = obj.otyp;
    const nocreate = uinit_nocreate();
    return otyp === WAN_WISHING || nocreate.includes(otyp)
        || otyp === RIN_LEVITATION
        || otyp === POT_HALLUCINATION
        || otyp === POT_ACID
        || otyp === SCR_AMNESIA
        || otyp === SCR_FIRE
        || otyp === SCR_BLANK_PAPER
        || otyp === SPE_BLANK_PAPER
        || otyp === RIN_AGGRAVATE_MONSTER
        || otyp === RIN_HUNGER
        || otyp === WAN_NOTHING
        || (otyp === RIN_POISON_RESISTANCE && race_is(4))
        || (otyp === SCR_ENCHANT_WEAPON && role_is(5))
        || (otyp === SPE_FORCE_BOLT && role_is(PM_WIZARD))
        || (obj.oclass === SPBOOK_CLASS
            && (spell_level(otyp) > (got_level1_spellbook ? 3 : 1)
                || restricted_spell_discipline(otyp)))
        || otyp === SPE_NOVEL;
}

function ini_inv_mkobj_filter(oclass, got_level1_spellbook) {
    let obj = mkobj(oclass, false);
    let trycnt = 0;

    while (is_forbidden_ini_obj(obj, got_level1_spellbook)) {
        if (++trycnt > 1000)
            return mksobj(PANCAKE, true, false);
        obj = mkobj(oclass, false);
    }
    return obj;
}

function ini_inv_adjust_obj(trop, obj) {
    let stop = false;

    if (trop.trclass === COIN_CLASS) {
        obj.quan = game.u?.umoney0 ?? 0;
    } else {
        obj.known = obj.dknown = obj.bknown = obj.rknown = 1;
        obj.cursed = false;
        if (obj.opoisoned && ((game.u?.ualign?.type ?? 0) !== A_CHAOTIC))
            obj.opoisoned = 0;

        if (obj.oclass === WEAPON_CLASS || obj.oclass === TOOL_CLASS) {
            obj.quan = trquan(trop);
            stop = true;
        } else if (obj.oclass === GEM_CLASS) {
            obj.quan = obj.quan || 1;
        }

        if (trop.trspe !== UNDEF_SPE) {
            obj.spe = trop.trspe;
            if (trop.trotyp === MAGIC_MARKER && obj.spe < 96)
                obj.spe += rn2(4);
        } else if (obj.oclass === RING_CLASS
            && (objects[obj.otyp]?.flags & F_CHARGED) && obj.spe <= 0) {
            obj.spe = rne(3);
        }
        if (trop.trbless !== UNDEF_BLESS)
            obj.blessed = !!trop.trbless;
    }

    obj.owt = weight(obj);
    return stop;
}

export function ini_inv(tropList) {
    let idx = 0;
    let trop = tropList[idx];
    let quan;
    let got_sp1 = false;

    if (game.u?.uroleplay?.pauper)
        return;

    quan = trquan(trop);
    while (trop?.trclass) {
        let otyp = trop.trotyp;
        let obj;

        if (otyp !== UNDEF_TYP) {
            obj = mksobj(otyp, true, false);
        } else {
            obj = ini_inv_mkobj_filter(trop.trclass, got_sp1);
            otyp = obj.otyp;

            switch (otyp) {
            case WAN_POLYMORPH:
            case RIN_POLYMORPH:
            case POT_POLYMORPH:
                uinit_nocreate()[0] = RIN_POLYMORPH_CONTROL;
                break;
            case RIN_POLYMORPH_CONTROL:
                uinit_nocreate()[0] = RIN_POLYMORPH;
                uinit_nocreate()[1] = SPE_POLYMORPH;
                uinit_nocreate()[2] = POT_POLYMORPH;
                break;
            default:
                break;
            }
            if (obj.oclass === RING_CLASS || obj.oclass === SPBOOK_CLASS)
                uinit_nocreate()[3] = otyp;
        }

        ini_inv_obj_substitution(trop, obj);

        if (game.u?.uroleplay?.nudist && obj.oclass === ARMOR_CLASS) {
            idx++;
            trop = tropList[idx];
            quan = trquan(trop);
            continue;
        }

        if (ini_inv_adjust_obj(trop, obj))
            quan = 1;
        addinv(obj);
        ini_inv_wear_armor(obj);
        // C ref: u_init.c ini_inv_use_obj — a starting (non-blank) spellbook
        // is memorized into spl_book with full retention.
        if (obj.oclass === SPBOOK_CLASS && obj.otyp !== SPE_BLANK_PAPER)
            initialspell(obj);
        if (obj.oclass === SPBOOK_CLASS && spell_level(obj.otyp) === 1)
            got_sp1 = true;

        if (--quan)
            continue;
        idx++;
        trop = tropList[idx];
        quan = trquan(trop);
    }
}

// C ref: u_init.c u_init_race — race-specific startup inventory.  Only the
// RNG-bearing branches matter for parity: elf cleric/wizard get one random
// instrument (ROLL_FROM => rn2(6) inside ini_inv), and non-wizard orcs get
// Xtra_food (2 random FOOD_CLASS items).  knows_object() calls and the
// gnome/dwarf branches consume no RNG.
function u_init_race() {
    const race = current_race_mnum();
    switch (race) {
    case PM_ELF:
        if (role_is(PM_CLERIC) || role_is(PM_WIZARD)) {
            const Instrument = [
                { trotyp: ELF_INSTRUMENTS[rn2(ELF_INSTRUMENTS.length)], trspe: 0, trclass: TOOL_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
                { trotyp: 0, trspe: 0, trclass: 0, trquan_min: 0, trquan_max: 0, trbless: 0 },
            ];
            ini_inv(Instrument);
        }
        break;
    case PM_ORC:
        if (!role_is(PM_WIZARD))
            ini_inv(Xtra_food);
        break;
    default:
        // Human/dwarf/gnome: no random race-specific startup adjustments.
        break;
    }
}

function current_role_attrs() {
    return ROLE_ATTRS.get(current_role_mnum());
}

function ensure_attr_arrays() {
    game.u = game.u || {};
    game.u.acurr = game.u.acurr || { a: Array(A_MAX).fill(0) };
    game.u.amax = game.u.amax || { a: Array(A_MAX).fill(0) };
}

function rnd_attr(roleAttrs) {
    let x = rn2(100);
    for (let i = 0; i < A_MAX; i++) {
        x -= roleAttrs.attrdist[i];
        if (x < 0)
            return i;
    }
    return A_MAX;
}

function init_attr_role_redist(np, addition, roleAttrs) {
    let tryct = 0;
    const adj = addition ? 1 : -1;

    while ((addition ? np > 0 : np < 0) && tryct < 100) {
        const i = rnd_attr(roleAttrs);
        const cur = game.u.acurr.a[i] ?? 0;
        if (i >= A_MAX
            || (addition ? cur >= HUMAN_ATTRMAX[i] : cur <= HUMAN_ATTRMIN[i])) {
            tryct++;
            continue;
        }
        tryct = 0;
        game.u.acurr.a[i] = cur + adj;
        game.u.amax.a[i] = (game.u.amax.a[i] ?? 0) + adj;
        np -= adj;
    }
    return np;
}

export function init_attr(np = 75) {
    const roleAttrs = current_role_attrs();
    if (!roleAttrs)
        return;

    ensure_attr_arrays();
    for (let i = 0; i < A_MAX; i++) {
        game.u.acurr.a[i] = roleAttrs.attrbase[i];
        game.u.amax.a[i] = roleAttrs.attrbase[i];
        np -= roleAttrs.attrbase[i];
    }

    np = init_attr_role_redist(np, true, roleAttrs);
    init_attr_role_redist(np, false, roleAttrs);
}

function adjattrib(ndx, incr) {
    const next = (game.u.acurr.a[ndx] ?? 0) + incr;
    const clamped = Math.max(HUMAN_ATTRMIN[ndx], Math.min(HUMAN_ATTRMAX[ndx], next));
    game.u.acurr.a[ndx] = clamped;
    if (game.u.amax.a[ndx] < clamped)
        game.u.amax.a[ndx] = clamped;
    return true;
}

export function vary_init_attr() {
    ensure_attr_arrays();
    for (let i = 0; i < A_MAX; i++) {
        if (!rn2(20)) {
            const xd = rn2(7) - 2;
            adjattrib(i, xd);
            if (game.u.acurr.a[i] < game.u.amax.a[i])
                game.u.amax.a[i] = game.u.acurr.a[i];
        }
    }
}

function u_init_carry_attr_boost() {
    // Inventory weight boosting has no RNG for the covered startup path.
}

// C ref: u_init.c u_init_role — role switch. The RNG-bearing tails
// (Blindfold/Magicmarker/Lamp extras) are ported faithfully so the call
// sequence matches C exactly. knows_object/knows_class consume no RNG.
export function u_init_role() {
    const role = current_role_mnum();

    game.moves = 1;
    if (game.u) game.u.umoney0 = game.u.umoney0 ?? 0;
    switch (role) {
    case PM_ARCHEOLOGIST:
        ini_inv(Archeologist);
        if (!rn2(10))
            ini_inv(Tinopener);
        else if (!rn2(4))
            ini_inv(Lamp);
        else if (!rn2(5))
            ini_inv(Magicmarker);
        break;
    case PM_BARBARIAN:
        if (rn2(100) >= 50)
            ini_inv(Barbarian_0);
        else
            ini_inv(Barbarian_1);
        if (!rn2(6))
            ini_inv(Lamp);
        break;
    case PM_CAVE_DWELLER:
        ini_inv(Cave_man);
        break;
    case PM_HEALER:
        if (game.u) game.u.umoney0 = rn1(1000, 1001);
        ini_inv(Healer);
        if (!rn2(25))
            ini_inv(Lamp);
        break;
    case PM_KNIGHT:
        ini_inv(Knight);
        break;
    case PM_MONK:
        ini_inv(Monk);
        ini_inv(M_spell[Math.floor(rn2(90) / 30)]); /* [0..2] */
        if (!rn2(4))
            ini_inv(Magicmarker);
        else if (!rn2(10))
            ini_inv(Lamp);
        break;
    case PM_CLERIC: // priest/priestess
        ini_inv(Priest);
        if (!rn2(5))
            ini_inv(Magicmarker);
        else if (!rn2(10))
            ini_inv(Lamp);
        break;
    case PM_RANGER:
        ini_inv(Ranger);
        break;
    case PM_ROGUE:
        if (game.u) game.u.umoney0 = 0;
        ini_inv(Rogue);
        if (!rn2(5))
            ini_inv(Blindfold);
        break;
    case PM_SAMURAI:
        ini_inv(Samurai);
        if (!rn2(5))
            ini_inv(Blindfold);
        break;
    case PM_TOURIST:
        if (game.u) game.u.umoney0 = rnd(1000);
        ini_inv(Tourist);
        if (!rn2(25))
            ini_inv(Tinopener);
        else if (!rn2(25))
            ini_inv(Leash);
        else if (!rn2(25))
            ini_inv(Towel);
        else if (!rn2(20))
            ini_inv(Magicmarker);
        break;
    case PM_VALKYRIE:
        ini_inv(Valkyrie);
        if (!rn2(6))
            ini_inv(Lamp);
        break;
    case PM_WIZARD:
        ini_inv(Wizard);
        if (!rn2(5))
            ini_inv(Blindfold);
        break;
    default: {
        // Roles without a ported inventory table: skip ini_inv (no RNG).
        const inventory = ROLE_INVENTORY.get(role);
        if (inventory)
            ini_inv(inventory);
        break;
    }
    }
    reset_uinit_nocreate();
}

export function u_init_inventory_attrs() {
    const was_log_mkobj_rne = game._log_mkobj_rne;
    game.u = game.u || {};
    game.invent = [];
    game.u.umoney0 = 0;
    game.uarm = game.uarmc = game.uarmh = game.uarmf = null;
    game.uarms = game.uarmg = game.uarmu = null;

    game._log_mkobj_rne = true;
    try {
        u_init_role();
        u_init_race();
        // C ref: u_init.c u_init_inventory_attrs — `if (discover)
        // ini_inv(Wishing);` (wizard-mode only, not exercised by these
        // sessions) then `if (u.umoney0) ini_inv(Money);`.  The Tourist
        // (and Healer) start with rnd()-rolled gold, so the Money trobj
        // must run: it emits trquan() (rn2(1)) plus the GOLD_PIECE
        // next_ident rnd(2) at exactly this stream position.
        if (game.u?.umoney0)
            ini_inv(Money);
        init_attr(75);
        vary_init_attr();
        u_init_carry_attr_boost();
    } finally {
        game._log_mkobj_rne = was_log_mkobj_rne;
    }
}

export function moveloop_preamble_startup() {
    // C ref: allmain.c moveloop_preamble() — new-game-only RNG.
    //   svc.context.rndencode = rnd(9000);
    //   ... set_wear / pickup (no RNG for our starting gear) ...
    //   svc.context.seer_turn = (long) rnd(30);
    //   u.umovement = NORMAL_SPEED; initrack();
    // Store seer_turn so the per-turn clairvoyance bookkeeping fires at the
    // right turn (it re-rolls rn1(31,15) once svm.moves catches up).
    game.context = game.context || {};
    game.context.rndencode = rnd(9000);
    game.context.seer_turn = rnd(30);
}
