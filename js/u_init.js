// u_init.js - Initial inventory and attributes.
// C ref: u_init.c

import { game } from './gstate.js';
import { skill_init_snapshot } from './enhance.js';
import { rn2, rnd, rne, rn1 } from './rng.js';
import { addinv as invent_addinv, bimanual, near_capacity } from './invent.js';
import { initialspell, num_spells, skill_based_spellbook_id } from './spell.js';
import {
    ARMOR_CLASS,
    BAG_OF_HOLDING,
    COIN_CLASS,
    FOOD_CLASS,
    GEM_CLASS,
    GOLD_PIECE,
    LARGE_BOX,
    MAGIC_MARKER,
    STATUE,
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
import { monster_by_pmidx } from './makemon.js';
import { knows_class, knows_object, discover_object } from './o_init.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';

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
const POT_OIL = 321; // C ref: include/onames.h POT_OIL — pre-ID'd by an oil lamp
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
const SPE_HEALING = 374;
const SPE_CONFUSE_MONSTER = 377;
const SPE_EXTRA_HEALING = 391;
const SPE_PROTECTION = 403;
const SPE_STONE_TO_FLESH = 405;
const WAN_SLEEP = 432;
const LUCKSTONE = 470;
const LOADSTONE = 471;
const TOUCHSTONE = 472;
const FLINT = 473;
const ROCK = 474;
// C ref: obj.h is_graystone(o) — LUCKSTONE/LOADSTONE/FLINT/TOUCHSTONE.
function is_graystone(obj) {
    const t = obj?.otyp;
    return t === LUCKSTONE || t === LOADSTONE || t === FLINT || t === TOUCHSTONE;
}
const POT_HALLUCINATION = 304;
const POT_POLYMORPH = 316;
const POT_ACID = 320;
const SCR_ENCHANT_WEAPON = 328;
const SCR_AMNESIA = 338;
const SCR_FIRE = 339;
const SCR_BLANK_PAPER = 365;
const SPE_FORCE_BOLT = 376;
const SPE_POLYMORPH = 399;
const SPE_BLANK_PAPER = 407;
const SPE_NOVEL = 408;
const WAN_WISHING = 414;
const WAN_NOTHING = 416;
const WAN_POLYMORPH = 422;
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

// C ref: u_init.c Wishing[] = { { WAN_WISHING, 3, WAND_CLASS, 1, 1, 0 }, ... }.
// u_init_inventory_attrs() runs `if (discover) ini_inv(Wishing)` in explore
// (discover) mode.  The WAND_CLASS mksobj emits next_ident rnd(2) + the
// WAND_CLASS blessorcurse rn2(17); WAN_WISHING takes the spe=1 branch so no
// rn1 spe roll happens.  This precedes ini_inv(Money) in the stream.
const Wishing = [
    { trotyp: WAN_WISHING, trspe: 3, trclass: WAND_CLASS, trquan_min: 1, trquan_max: 1, trbless: 0 },
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

// C ref: objnam.c Japanese_items[] — the otyps that get a Japanese name for a
// Samurai, in ascending otyp order (the order u_init.c's NUM_OBJECTS scan
// visits them).  MAGIC_HARP (254) is present in C's table but is filtered out
// there by the oc_magic test, so it is filtered at the call site here too.
const JAPANESE_ITEM_OTYPS = [
    40,  // KNIFE          "shito"
    46,  // SHORT_SWORD    "wakizashi"
    52,  // BROADSWORD     "ninja-to"
    62,  // GLAIVE         "naginata"
    81,  // FLAIL          "nunchaku"
    97,  // HELMET         "kabuto"
    121, // PLATE_MAIL     "tanko"
    159, // LEATHER_GLOVES "yugake"
    222, // LOCK_PICK      "osaku"
    253, // WOODEN_HARP    "koto"
    254, // MAGIC_HARP     "magic koto"  (oc_magic -> skipped)
    293, // FOOD_RATION    "gunyoki"
    317, // POT_BOOZE      "sake"
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
// Race advancement (role.c races[]).  Only the level-0 infix/inrnd fields are
// used at chargen.  C ref: role.c races[] hpadv/enadv {infix,inrnd,...}.
//   human  HP {2,0,...} EN {1,0,...}
//   elf    HP {1,0,...} EN {2,0,...}
//   dwarf  HP {4,0,...} EN {0,0,...}
//   gnome  HP {1,0,...} EN {2,0,...}
//   orc    HP {1,0,...} EN {1,0,...}
const RACE_ADV = new Map([
    [PM_HUMAN, { hpadv: { infix: 2, inrnd: 0 }, enadv: { infix: 1, inrnd: 0 } }],
    [PM_ELF, { hpadv: { infix: 1, inrnd: 0 }, enadv: { infix: 2, inrnd: 0 } }],
    [PM_DWARF, { hpadv: { infix: 4, inrnd: 0 }, enadv: { infix: 0, inrnd: 0 } }],
    [PM_GNOME, { hpadv: { infix: 1, inrnd: 0 }, enadv: { infix: 2, inrnd: 0 } }],
    [PM_ORC, { hpadv: { infix: 1, inrnd: 0 }, enadv: { infix: 1, inrnd: 0 } }],
]);
// Human race advance (default when race lookup misses).
const RACE_ADV_HUMAN = RACE_ADV.get(PM_HUMAN);
function current_race_adv() {
    return RACE_ADV.get(current_race_mnum()) || RACE_ADV_HUMAN;
}

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
    // Racial armor variants (ini_inv_obj_substitution).  a_ac = 10 - macro ac
    // arg.  C ref: include/objects.h CLOAK/HELM/SHIELD/ARMOR entries.
    [139, 1],   // ELVEN_CLOAK        (ac 9)
    [140, 0],   // ORCISH_CLOAK       (ac 10)
    [141, 0],   // DWARVISH_CLOAK     (ac 10)
    [89, 1],    // ELVEN_LEATHER_HELM (ac 9)
    [90, 1],    // ORCISH_HELM        (ac 9)
    [91, 2],    // DWARVISH_IRON_HELM (ac 8)
    [155, 1],   // ORCISH_SHIELD      (ac 9)
    [129, 4],   // ORCISH_CHAIN_MAIL  (ac 6)
    [133, 2],   // ORCISH_RING_MAIL   (ac 8)
    // C ref: include/objects.h "other suits" ARMOR() block (otyp 121..131,
    // excluding orcish chain/ring mail and leather armor already listed above):
    // a_ac = 10 - macro ac arg, same derivation as the racial variants above.
    [121, 7],   // PLATE_MAIL            (ac 3)
    [122, 7],   // CRYSTAL_PLATE_MAIL    (ac 3)
    [123, 6],   // BRONZE_PLATE_MAIL     (ac 4)
    [125, 6],   // BANDED_MAIL           (ac 4)
    [126, 6],   // DWARVISH_MITHRIL_COAT (ac 4)
    [127, 5],   // ELVEN_MITHRIL_COAT    (ac 5)
    [128, 5],   // CHAIN_MAIL            (ac 5)
    [130, 4],   // SCALE_MAIL            (ac 6)
    [131, 3],   // STUDDED_LEATHER_ARMOR (ac 7)
]);
// C ref: include/objects.h DRGN_ARMR — dragon scale mail (otyp 101..110) has
// macro ac arg 1 so a_ac = 10 - 1 = 9; dragon scales (111..120) have ac 7 so
// a_ac = 3.  (a_ac = 10 - macro ac arg.)
for (let otyp = 101; otyp <= 110; otyp++) ARMOR_A_AC.set(otyp, 9);
for (let otyp = 111; otyp <= 120; otyp++) ARMOR_A_AC.set(otyp, 3);
// C ref: include/objects.h BOOTS(...) — footwear a_ac = 10 - macro ac arg.
// Most boots have ac 9 (a_ac 1); iron shoes/high boots have ac 8 (a_ac 2).
// Donning speed boots improves the hero's AC by 1 (seed0360 step-136 AC:7->6).
for (let otyp = 163; otyp <= 172; otyp++) ARMOR_A_AC.set(otyp, 1);
ARMOR_A_AC.set(164, 2); // iron shoes (ac 8)
ARMOR_A_AC.set(165, 2); // high boots (ac 8)
// The rest of include/objects.h's HELM/CLOAK/SHIELD/GLOVES entries (a_ac =
// 10 - macro ac arg).  Until these landed the map covered only the armor the
// covered heroes START with, so buying and wearing a shield of reflection left
// the status line's AC untouched (seed0002 step 363: AC:3 for C's AC:1).
// Every ARMOR_CLASS otyp now has an entry; ARM_BONUS()'s `|| 0` fallback no
// longer silently prices a whole armor family at zero.
ARMOR_A_AC.set(93, 0);   // cornuthaum                (ac 10)
ARMOR_A_AC.set(94, 0);   // dunce cap                 (ac 10)
ARMOR_A_AC.set(95, 1);   // dented pot                (ac 9)
ARMOR_A_AC.set(96, 1);   // helm of brilliance        (ac 9)
ARMOR_A_AC.set(98, 1);   // helm of caution           (ac 9)
ARMOR_A_AC.set(99, 1);   // helm of opposite alignment(ac 9)
ARMOR_A_AC.set(100, 1);  // helm of telepathy         (ac 9)
ARMOR_A_AC.set(137, 0);  // T-shirt                   (ac 10)
ARMOR_A_AC.set(138, 0);  // mummy wrapping            (ac 10)
ARMOR_A_AC.set(142, 1);  // oilskin cloak             (ac 9)
ARMOR_A_AC.set(144, 1);  // alchemy smock             (ac 9)
ARMOR_A_AC.set(145, 1);  // leather cloak             (ac 9)
ARMOR_A_AC.set(146, 3);  // cloak of protection       (ac 7)
ARMOR_A_AC.set(147, 1);  // cloak of invisibility     (ac 9)
ARMOR_A_AC.set(151, 1);  // shield of drain resistance(ac 9)
ARMOR_A_AC.set(152, 1);  // shield of shock resistance(ac 9)
ARMOR_A_AC.set(153, 2);  // elven shield              (ac 8)
ARMOR_A_AC.set(154, 1);  // Uruk-hai shield           (ac 9)
ARMOR_A_AC.set(156, 2);  // large shield              (ac 8)
ARMOR_A_AC.set(157, 2);  // dwarvish roundshield      (ac 8)
ARMOR_A_AC.set(158, 2);  // shield of reflection      (ac 8)
ARMOR_A_AC.set(160, 1);  // gauntlets of fumbling     (ac 9)
ARMOR_A_AC.set(161, 1);  // gauntlets of power        (ac 9)
ARMOR_A_AC.set(162, 1);  // gauntlets of dexterity    (ac 9)

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

// C ref: objclass.h armor-category predicates (is_cloak/is_helmet/...).  The C
// macros test objects[].oc_armcat; the JS table lacks oc_armcat, so list otyps
// explicitly.  Racial variants (produced by ini_inv_obj_substitution) MUST be
// included so a substituted starting cloak/helm/shield/suit is still recognised
// and worn — otherwise the hero's AC is computed without it.
//   racial cloaks  139=ELVEN 140=ORCISH 141=DWARVISH
//   racial helms    89=ELVEN_LEATHER 90=ORCISH 91=DWARVISH_IRON
//   racial shield  155=ORCISH
//   racial mail    129=ORCISH_CHAIN 133=ORCISH_RING
// The hand-listed otyp sets these replaced covered only the armor the public
// starts actually wear, so any other cloak/helm/shield fell through to nothing.
// Ranges are objects.h's contiguous blocks (== js/objnam.js o_ranges).
function is_armor_range(obj, lo, hi) {
    const t = obj?.otyp;
    return obj?.oclass === ARMOR_CLASS && t >= lo && t <= hi;
}
function is_cloak(obj) { return is_armor_range(obj, 138, 149); }
function is_helmet(obj) { return is_armor_range(obj, 89, 100); }
function is_gloves(obj) { return is_armor_range(obj, 159, 162); }
function is_shield(obj) { return is_armor_range(obj, 150, 158); }
function is_shirt(obj) { return is_armor_range(obj, 136, 137); }
function is_suit(obj) { return is_armor_range(obj, 101, 135); }

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
        // C ref: u_init.c ini_inv_use_obj — a shield is not donned while a
        // two-handed weapon is already wielded (no stock role hits this, but
        // the guard is what C tests).
        if (is_shield(obj) && !game.uarms
            && !(game.uwep && bimanual(game.uwep))) setworn(obj, W_ARMS);
        else if (is_helmet(obj) && !game.uarmh) setworn(obj, W_ARMH);
        else if (is_gloves(obj) && !game.uarmg) setworn(obj, W_ARMG);
        else if (is_shirt(obj) && !game.uarmu) setworn(obj, W_ARMU);
        else if (is_cloak(obj) && !game.uarmc) setworn(obj, W_ARMC);
        else if (is_suit(obj) && !game.uarm) setworn(obj, W_ARM);
    }

    // C ref: u_init.c ini_inv_use_obj — wield the starting weapon(s).  The
    // outer class check also special-cases FLINT/ROCK (GEM_CLASS sling ammo)
    // so a Caveman's starting stones get quivered like any other ammo, plus
    // is_weptool() and TIN_OPENER: an Archeologist's pick-axe (TOOL_CLASS with
    // oc_skill P_PICK_AXE) becomes the alternate weapon behind the bullwhip,
    // and a Tourist who rolls the 1-in-25 tin opener wields it (no other
    // starting weapon survives the dart stack going to the quiver).
    if (obj.oclass === WEAPON_CLASS || ini_is_weptool(obj)
        || obj.otyp === TIN_OPENER
        || obj.otyp === FLINT || obj.otyp === ROCK) {
        if (ini_is_ammo(obj)) {
            if (!game.uquiver) { obj.owornmask = (obj.owornmask || 0) | W_QUIVER; game.uquiver = obj; }
        } else if (!game.uwep && (!game.uarms || !bimanual(obj))) {
            obj.owornmask = (obj.owornmask || 0) | W_WEP; game.uwep = obj;
        } else if (!game.uswapwep) {
            obj.owornmask = (obj.owornmask || 0) | W_SWAPWEP; game.uswapwep = obj;
        }
    }
}

// C ref: objclass.h is_weptool(o) — a TOOL_CLASS object whose oc_skill is not
// P_NONE (pick-axe, unicorn horn, grappling hook, ...).  The C flag, not a
// hardcoded otyp list.
function ini_is_weptool(obj) {
    return obj?.oclass === TOOL_CLASS
        && (objects?.[obj.otyp]?.oc_skill ?? P_NONE) !== P_NONE;
}

// C ref: obj.h is_ammo(obj) || is_missile(obj) — the starting quiver takes only
// launcher ammunition (arrows/bolts, oc_skill in [-P_CROSSBOW, -P_BOW]) and
// thrown missiles (darts/shuriken/boomerangs, [-P_BOOMERANG, -P_DART]).  Both
// have a NEGATIVE oc_skill; a melee weapon such as a dagger (P_DAGGER, a
// positive skill) is neither, so a stack of starting daggers becomes the
// wielded/alternate weapon (uwep/uswapwep), not the quiver — the earlier
// quan>1 heuristic wrongly quivered them.
function ini_is_ammo(obj) {
    const sk = objects?.[obj.otyp]?.oc_skill ?? 0;
    // is_ammo: WEAPON_CLASS or GEM_CLASS (sling stones), -P_CROSSBOW..-P_BOW.
    if ((obj.oclass === WEAPON_CLASS || obj.oclass === GEM_CLASS) && sk >= -22 && sk <= -20)
        return true;
    // is_missile: WEAPON_CLASS only here (TOOL_CLASS missiles don't occur in
    // starting inventories), -P_BOOMERANG..-P_DART.
    return obj.oclass === WEAPON_CLASS && sk >= -25 && sk <= -23;
}

// C ref: hack.h ARM_BONUS(obj) — a_ac + spe - min(greatest_erosion(obj), a_ac).
function greatest_erosion(obj) { return Math.max(obj?.oeroded || 0, obj?.oeroded2 || 0); }
function ARM_BONUS(obj) {
    const a_ac = ARMOR_A_AC.get(obj.otyp) || 0;
    return a_ac + (obj.spe || 0) - Math.min(greatest_erosion(obj), a_ac);
}

// C ref: do_wear.c find_ac — current armor class from worn gear.  C: `int uac
// = mons[u.umonnum].ac;` — the current FORM's base AC, not always the human
// default; only observable while Upolyd (mons[urole/urace].ac == 10 for every
// starter human form).
export function find_ac() {
    const u = game.u;
    const base = u?.Upolyd ? (monster_by_pmidx(u.umonnum)?.ac ?? PLAYER_BASE_AC_DEFAULT) : PLAYER_BASE_AC_DEFAULT;
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
    const radv = current_race_adv();
    let hp = adv.hpadv.infix + radv.hpadv.infix;
    if (adv.hpadv.inrnd > 0) hp += rnd(adv.hpadv.inrnd);
    if (radv.hpadv.inrnd > 0) hp += rnd(radv.hpadv.inrnd);
    // C ref: attrib.c newhp():1116 — `u.uhpinc[u.ulevel] = (xint16) hp`.
    // newman() subtracts these per-level increments back out of uhpmax.
    game.u = game.u || {};
    if (!game.u.uhpinc) game.u.uhpinc = [];
    game.u.uhpinc[game.u.ulevel || 0] = hp;
    return hp;
}

export function newpw() {
    const adv = ROLE_ADV.get(current_role_mnum());
    if (!adv) return 0;
    const radv = current_race_adv();
    let en = adv.enadv.infix + radv.enadv.infix;
    if (adv.enadv.inrnd > 0) en += rnd(adv.enadv.inrnd);
    if (radv.enadv.inrnd > 0) en += rnd(radv.enadv.inrnd);
    if (en <= 0) en = 1;
    // C ref: exper.c newpw() — `u.ueninc[u.ulevel] = (xint16) en`.
    game.u = game.u || {};
    if (!game.u.ueninc) game.u.ueninc = [];
    game.u.ueninc[game.u.ulevel || 0] = en;
    return en;
}

const A_MAX = 6;
const HUMAN_ATTRMIN = [3, 3, 3, 3, 3, 3];
const HUMAN_ATTRMAX = [118, 18, 18, 18, 18, 18]; // STR18(100), then plain 18s.

// C ref: role.c races[].attrmin / .attrmax — per-race attribute bounds (order
// [Str,Int,Wis,Dex,Con,Cha]; STR18(x)==18+x so STR18(100)=118, STR18(50)=68).
// ATTRMAX(x)/ATTRMIN(x) read gu.urace.attr{max,min}[x], NOT the human values,
// so init_attr's point redistribution accept/reject must use the race caps.
const RACE_ATTRMIN = {
    [PM_HUMAN]: [3, 3, 3, 3, 3, 3],
    [PM_ELF]: [3, 3, 3, 3, 3, 3],
    [PM_DWARF]: [3, 3, 3, 3, 3, 3],
    [PM_GNOME]: [3, 3, 3, 3, 3, 3],
    [PM_ORC]: [3, 3, 3, 3, 3, 3],
};
const RACE_ATTRMAX = {
    [PM_HUMAN]: [118, 18, 18, 18, 18, 18],
    [PM_ELF]: [18, 20, 20, 18, 16, 18],
    [PM_DWARF]: [118, 16, 16, 20, 20, 16],
    [PM_GNOME]: [68, 19, 18, 18, 18, 18],
    [PM_ORC]: [68, 16, 16, 18, 18, 16],
};

export function race_attrmin() {
    return RACE_ATTRMIN[current_race_mnum()] || HUMAN_ATTRMIN;
}
export function race_attrmax() {
    return RACE_ATTRMAX[current_race_mnum()] || HUMAN_ATTRMAX;
}

// C ref: role.c character_race(pmindex) — races[] entry for an ARBITRARY monster
// index (not necessarily the hero's current race), or undefined if pmindex isn't
// one of the player races.  Used by polyself.c uasmon_maxStr().
export function race_attrmax_of(pmidx) {
    return RACE_ATTRMAX[pmidx];
}

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

// C ref: u_init.c inv_subs[] — race-based substitutions for initial inventory.
// Each entry maps {race monster-number, base item otyp} -> racial-variant otyp.
// Applied to every created starting-inventory object (including randomly
// generated food) when the hero's race is non-human.  No RNG.  Otyps are the
// objects.h ordinals (see mkobj.js OBJECT_DATA).
const INV_SUBS = [
    [PM_ELF, 34 /*DAGGER*/, 35 /*ELVEN_DAGGER*/],
    [PM_ELF, 27 /*SPEAR*/, 28 /*ELVEN_SPEAR*/],
    [PM_ELF, 46 /*SHORT_SWORD*/, 47 /*ELVEN_SHORT_SWORD*/],
    [PM_ELF, 83 /*BOW*/, 84 /*ELVEN_BOW*/],
    [PM_ELF, 18 /*ARROW*/, 19 /*ELVEN_ARROW*/],
    [PM_ELF, 97 /*HELMET*/, 89 /*ELVEN_LEATHER_HELM*/],
    [PM_ELF, 149 /*CLOAK_OF_DISPLACEMENT*/, 139 /*ELVEN_CLOAK*/],
    [PM_ELF, 292 /*CRAM_RATION*/, 291 /*LEMBAS_WAFER*/],
    [PM_ORC, 34 /*DAGGER*/, 36 /*ORCISH_DAGGER*/],
    [PM_ORC, 27 /*SPEAR*/, 29 /*ORCISH_SPEAR*/],
    [PM_ORC, 46 /*SHORT_SWORD*/, 48 /*ORCISH_SHORT_SWORD*/],
    [PM_ORC, 83 /*BOW*/, 85 /*ORCISH_BOW*/],
    [PM_ORC, 18 /*ARROW*/, 20 /*ORCISH_ARROW*/],
    [PM_ORC, 97 /*HELMET*/, 90 /*ORCISH_HELM*/],
    [PM_ORC, 150 /*SMALL_SHIELD*/, 155 /*ORCISH_SHIELD*/],
    [PM_ORC, 132 /*RING_MAIL*/, 133 /*ORCISH_RING_MAIL*/],
    [PM_ORC, 128 /*CHAIN_MAIL*/, 129 /*ORCISH_CHAIN_MAIL*/],
    [PM_ORC, 292 /*CRAM_RATION*/, 264 /*TRIPE_RATION*/],
    [PM_ORC, 291 /*LEMBAS_WAFER*/, 264 /*TRIPE_RATION*/],
    [PM_DWARF, 27 /*SPEAR*/, 30 /*DWARVISH_SPEAR*/],
    [PM_DWARF, 46 /*SHORT_SWORD*/, 49 /*DWARVISH_SHORT_SWORD*/],
    [PM_DWARF, 97 /*HELMET*/, 91 /*DWARVISH_IRON_HELM*/],
    [PM_DWARF, 291 /*LEMBAS_WAFER*/, 292 /*CRAM_RATION*/],
    [PM_GNOME, 83 /*BOW*/, 88 /*CROSSBOW*/],
    [PM_GNOME, 18 /*ARROW*/, 23 /*CROSSBOW_BOLT*/],
];

function ini_inv_obj_substitution(trop, obj) {
    void trop;
    const mnum = current_race_mnum();
    if (mnum !== PM_HUMAN) {
        for (const [race_pm, item_otyp, subs_otyp] of INV_SUBS) {
            if (race_pm === mnum && obj.otyp === item_otyp) {
                obj.otyp = subs_otyp;
                break;
            }
        }
    }
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
    [366, { skill: 34, level: 5 }], // SPE_DIG
    [367, { skill: 28, level: 2 }], // SPE_MAGIC_MISSILE
    [368, { skill: 28, level: 4 }], // SPE_FIREBALL
    [369, { skill: 28, level: 4 }], // SPE_CONE_OF_COLD
    [370, { skill: 31, level: 3 }], // SPE_SLEEP
    [371, { skill: 28, level: 7 }], // SPE_FINGER_OF_DEATH
    [372, { skill: 30, level: 1 }], // SPE_LIGHT
    [373, { skill: 30, level: 1 }], // SPE_DETECT_MONSTERS
    [374, { skill: 29, level: 1 }], // SPE_HEALING
    [375, { skill: 34, level: 1 }], // SPE_KNOCK
    [376, { skill: 28, level: 1 }], // SPE_FORCE_BOLT
    [377, { skill: 31, level: 1 }], // SPE_CONFUSE_MONSTER
    [378, { skill: 29, level: 2 }], // SPE_CURE_BLINDNESS
    [379, { skill: 28, level: 2 }], // SPE_DRAIN_LIFE
    [380, { skill: 31, level: 2 }], // SPE_SLOW_MONSTER
    [381, { skill: 34, level: 2 }], // SPE_WIZARD_LOCK
    [382, { skill: 32, level: 2 }], // SPE_CREATE_MONSTER
    [383, { skill: 30, level: 2 }], // SPE_DETECT_FOOD
    [384, { skill: 31, level: 3 }], // SPE_CAUSE_FEAR
    [385, { skill: 30, level: 3 }], // SPE_CLAIRVOYANCE
    [386, { skill: 29, level: 3 }], // SPE_CURE_SICKNESS
    [387, { skill: 31, level: 5 }], // SPE_CHARM_MONSTER
    [388, { skill: 33, level: 3 }], // SPE_HASTE_SELF
    [389, { skill: 30, level: 3 }], // SPE_DETECT_UNSEEN
    [390, { skill: 33, level: 4 }], // SPE_LEVITATION
    [391, { skill: 29, level: 3 }], // SPE_EXTRA_HEALING
    [392, { skill: 29, level: 4 }], // SPE_RESTORE_ABILITY
    [393, { skill: 33, level: 4 }], // SPE_INVISIBILITY
    [394, { skill: 30, level: 4 }], // SPE_DETECT_TREASURE
    [395, { skill: 32, level: 3 }], // SPE_REMOVE_CURSE
    [396, { skill: 30, level: 5 }], // SPE_MAGIC_MAPPING
    [397, { skill: 30, level: 3 }], // SPE_IDENTIFY
    [398, { skill: 32, level: 6 }], // SPE_TURN_UNDEAD
    [399, { skill: 34, level: 6 }], // SPE_POLYMORPH
    [400, { skill: 33, level: 6 }], // SPE_TELEPORT_AWAY
    [401, { skill: 32, level: 6 }], // SPE_CREATE_FAMILIAR
    [402, { skill: 34, level: 7 }], // SPE_CANCELLATION
    [403, { skill: 32, level: 1 }], // SPE_PROTECTION
    [404, { skill: 33, level: 1 }], // SPE_JUMPING
    [405, { skill: 29, level: 3 }], // SPE_STONE_TO_FLESH
    [406, { skill: 28, level: 2 }], // SPE_CHAIN_LIGHTNING
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
export function spell_level(otyp) {
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
        // C ref: u_init.c ini_inv_adjust_obj — starting containers/statues have
        // their contents and lock state known (and are never trapped), so they
        // display "empty" once created with no contents.
        if ((obj.otyp >= LARGE_BOX && obj.otyp <= BAG_OF_HOLDING)
            || obj.otyp === STATUE) {
            obj.cknown = obj.lknown = 1;
            obj.otrapped = 0;
        }
        obj.cursed = false;
        if (obj.opoisoned && ((game.u?.ualign?.type ?? 0) !== A_CHAOTIC))
            obj.opoisoned = 0;

        if (obj.oclass === WEAPON_CLASS || obj.oclass === TOOL_CLASS) {
            obj.quan = trquan(trop);
            stop = true;
        } else if (obj.oclass === GEM_CLASS && is_graystone(obj)
            && obj.otyp !== FLINT) {
            // C ref: u_init.c ini_inv_adjust_obj — graystones (other than
            // flint) are forced to a single stone.  mksobj's GEM_CLASS branch
            // rolls `otyp != LUCKSTONE && !rn2(6)` -> quan 2, so 1 in 6
            // Archeologists were starting with "2 touchstones".  The previous
            // `obj.quan = obj.quan || 1` was a no-op (quan is always >= 1) and
            // wrongly also covered non-graystone gems, where C leaves the
            // mksobj quantity alone (a Caveman's rn1(6,6) rocks per iteration).
            obj.quan = 1;
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
            // C ref: u_init.c ini_inv — the nudist skip is `trop++; continue;`
            // with NO trquan() re-roll (the stale `quan` carries into the next
            // trobj; that is what C does).  Rolling one here drew an rn2() the
            // C stream never has.
            idx++;
            trop = tropList[idx];
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
        // C ref: u_init.c u_init_race PM_ELF — elves recognize all elvish
        // objects (no RNG).
        knows_object(47 /*ELVEN_SHORT_SWORD*/);
        knows_object(19 /*ELVEN_ARROW*/);
        knows_object(84 /*ELVEN_BOW*/);
        knows_object(28 /*ELVEN_SPEAR*/);
        knows_object(35 /*ELVEN_DAGGER*/);
        knows_object(53 /*ELVEN_BROADSWORD*/);
        knows_object(127 /*ELVEN_MITHRIL_COAT*/);
        knows_object(89 /*ELVEN_LEATHER_HELM*/);
        knows_object(153 /*ELVEN_SHIELD*/);
        knows_object(169 /*ELVEN_BOOTS*/);
        knows_object(139 /*ELVEN_CLOAK*/);
        break;
    case PM_DWARF:
        // C ref: u_init.c u_init_race PM_DWARF — dwarves recognize all dwarvish
        // objects (no RNG).
        knows_object(30 /*DWARVISH_SPEAR*/);
        knows_object(49 /*DWARVISH_SHORT_SWORD*/);
        knows_object(71 /*DWARVISH_MATTOCK*/);
        knows_object(91 /*DWARVISH_IRON_HELM*/);
        knows_object(126 /*DWARVISH_MITHRIL_COAT*/);
        knows_object(141 /*DWARVISH_CLOAK*/);
        knows_object(157 /*DWARVISH_ROUNDSHIELD*/);
        break;
    case PM_ORC:
        if (!role_is(PM_WIZARD))
            ini_inv(Xtra_food);
        // C ref: u_init.c u_init_race PM_ORC — orcs recognize all orcish
        // objects (no RNG).
        knows_object(48 /*ORCISH_SHORT_SWORD*/);
        knows_object(20 /*ORCISH_ARROW*/);
        knows_object(85 /*ORCISH_BOW*/);
        knows_object(29 /*ORCISH_SPEAR*/);
        knows_object(36 /*ORCISH_DAGGER*/);
        knows_object(129 /*ORCISH_CHAIN_MAIL*/);
        knows_object(133 /*ORCISH_RING_MAIL*/);
        knows_object(90 /*ORCISH_HELM*/);
        knows_object(155 /*ORCISH_SHIELD*/);
        knows_object(154 /*URUK_HAI_SHIELD*/);
        knows_object(140 /*ORCISH_CLOAK*/);
        break;
    default:
        // Human/gnome: no race-specific startup adjustments.
        break;
    }
}

// C ref: explore (discover) mode flag.  The harness records playmode:explore
// in OPTIONS; parseNethackrc stores it as flags.playmode === 'explore' (also
// accept an explicit flags.explore / flags.discover for robustness).
function is_discover_mode() {
    const f = game.flags || {};
    return !!(f.explore || f.discover || f.playmode === 'explore');
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
    const amax = race_attrmax(), amin = race_attrmin();

    while ((addition ? np > 0 : np < 0) && tryct < 100) {
        const i = rnd_attr(roleAttrs);
        const cur = game.u.acurr.a[i] ?? 0;
        if (i >= A_MAX
            || (addition ? cur >= amax[i] : cur <= amin[i])) {
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

// C ref: attrib.c adjattrib(ndx, incr, msgflg) — returns TRUE only when ACURR
// actually moved (FALSE once the race cap ATTRMAX(ndx) is reached).  That
// return value is what terminates u_init_carry_attr_boost's loop.
function adjattrib(ndx, incr) {
    const prev = game.u.acurr.a[ndx] ?? 0;
    const next = prev + incr;
    const clamped = Math.max(race_attrmin()[ndx], Math.min(race_attrmax()[ndx], next));
    game.u.acurr.a[ndx] = clamped;
    if (game.u.amax.a[ndx] < clamped)
        game.u.amax.a[ndx] = clamped;
    return clamped !== prev;
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

// C ref: u_init.c u_init_carry_attr_boost() —
//     while (inv_weight() > 0) {
//         if (adjattrib(A_STR, 1, TRUE)) continue;
//         if (adjattrib(A_CON, 1, TRUE)) continue;
//         break;
//     }
// "make sure you can carry all you have - especially for Tourists".  Consumes
// no RNG, but the boosted Str/Con show on the status line from screen 1 and
// feed weight_cap()/near_capacity() for every later encumbrance test, which in
// turn gates exerper()'s encumbrance exercise() rolls and regen_pw().
// hack.c calc_capacity() returns UNENCUMBERED exactly when inv_weight() <= 0,
// so near_capacity() > UNENCUMBERED is the same predicate without needing
// inv_weight() exported.  The loop terminates because adjattrib() returns
// FALSE once the attribute is pinned at its racial ATTRMAX.
const A_STR_IDX = 0, A_CON_IDX = 4;
function u_init_carry_attr_boost() {
    while (near_capacity() > 0) {
        if (adjattrib(A_STR_IDX, 1)) continue;
        if (adjattrib(A_CON_IDX, 1)) continue;
        break;
    }
}

// C ref: u_init.c u_init_role — role switch. The RNG-bearing tails
// (Blindfold/Magicmarker/Lamp extras) are ported faithfully so the call
// sequence matches C exactly. knows_object/knows_class consume no RNG.
export function u_init_role() {
    const role = current_role_mnum();

    game.moves = 1;
    // C ref: role_init() sets u.umonnum before inventory creation; mksobj's
    // samurai lacquered-armor branch reads Role_if(PM_SAMURAI) via umonnum.
    // C ref: u_init.c:991 u.umonnum = u.umonster = gu.urole.mnum — umonster is
    // the hero's original (non-polymorphed) form; Upolyd = (umonnum != umonster).
    if (game.u && game.u.umonnum == null) game.u.umonnum = game.u.umonster = role;
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
        // C ref: u_init.c — archeologists know sacks and touchstone (no RNG).
        knows_object(217 /*SACK*/);
        knows_object(472 /*TOUCHSTONE*/);
        break;
    case PM_BARBARIAN:
        if (rn2(100) >= 50)
            ini_inv(Barbarian_0);
        else
            ini_inv(Barbarian_1);
        if (!rn2(6))
            ini_inv(Lamp);
        // C ref: u_init.c — barbarians know all weapons (excluding polearms)
        // and all armor (no RNG).
        knows_class(WEAPON_CLASS);
        knows_class(ARMOR_CLASS);
        break;
    case PM_CAVE_DWELLER:
        ini_inv(Cave_man);
        break;
    case PM_HEALER:
        if (game.u) game.u.umoney0 = rn1(1000, 1001);
        ini_inv(Healer);
        if (!rn2(25))
            ini_inv(Lamp);
        // C ref: u_init.c — healers know potions of full healing (no RNG).
        knows_object(315 /*POT_FULL_HEALING*/);
        break;
    case PM_KNIGHT:
        ini_inv(Knight);
        // C ref: u_init.c — knights know all weapons (including polearms) and
        // all armor (no RNG).
        knows_class(WEAPON_CLASS);
        knows_class(ARMOR_CLASS);
        break;
    case PM_MONK:
        ini_inv(Monk);
        ini_inv(M_spell[Math.floor(rn2(90) / 30)]); /* [0..2] */
        if (!rn2(4))
            ini_inv(Magicmarker);
        else if (!rn2(10))
            ini_inv(Lamp);
        // C ref: u_init.c — monks know all armor and shuriken (no RNG).
        knows_class(ARMOR_CLASS);
        knows_object(25 /*SHURIKEN*/);
        break;
    case PM_CLERIC: // priest/priestess
        ini_inv(Priest);
        if (!rn2(5))
            ini_inv(Magicmarker);
        else if (!rn2(10))
            ini_inv(Lamp);
        // C ref: u_init.c — priests know holy/unholy water (no RNG).
        knows_object(322 /*POT_WATER*/);
        break;
    case PM_RANGER:
        ini_inv(Ranger);
        // C ref: u_init.c — rangers pre-discover all launchers, ammo, and spears
        // (bows/arrows/spears), excluding polearms and other weapons.  No RNG.
        knows_class(WEAPON_CLASS);
        break;
    case PM_ROGUE:
        if (game.u) game.u.umoney0 = 0;
        ini_inv(Rogue);
        if (!rn2(5))
            ini_inv(Blindfold);
        // C ref: u_init.c — rogues know sacks and (via knows_class) daggers.
        knows_object(217 /*SACK*/);
        knows_class(WEAPON_CLASS);
        break;
    case PM_SAMURAI:
        ini_inv(Samurai);
        if (!rn2(5))
            ini_inv(Blindfold);
        // C ref: u_init.c — samurai know all weapons and all armor (no RNG).
        knows_class(WEAPON_CLASS);
        knows_class(ARMOR_CLASS);
        // C ref: u_init.c:745-753 —
        //   for (i = MAXOCLASSES; i < NUM_OBJECTS; ++i) {
        //       if (objects[i].oc_magic) continue;
        //       if (Japanese_item_name(i, NULL)) knows_object(i, FALSE);
        //   }
        // "in order to assist non-Japanese speakers, pre-discover items that
        // switch to Japanese names when playing as a Samurai".  knows_class
        // above already covers the weapons/armor in that table; what this adds
        // is the lock pick, the wooden harp, the food ration and the potion of
        // booze — so a samurai who later meets a "smoky potion" sees "potion of
        // booze", and the discoveries window lists them.  Iterated in otyp
        // order, as C does, because discovery order drives the disco[] slots.
        for (const otyp of JAPANESE_ITEM_OTYPS) {
            if (objects[otyp]?.oc_magic) continue; // skips the "magic koto"
            knows_object(otyp);
        }
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
        // C ref: u_init.c — valkyries know all weapons (excluding polearms) and
        // all armor (no RNG).
        knows_class(WEAPON_CLASS);
        knows_class(ARMOR_CLASS);
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
        // ini_inv(Wishing);` then `if (u.umoney0) ini_inv(Money);`.
        // `discover` is the explore-mode flag (playmode:explore); in that
        // mode C grants a wand of wishing, whose creation consumes the
        // WAND_CLASS next_ident rnd(2) + blessorcurse rn2(17) right before
        // the gold.  The Tourist (and Healer) start with rnd()-rolled gold,
        // so the Money trobj also runs: it emits trquan() (rn2(1)) plus the
        // GOLD_PIECE next_ident rnd(2) at exactly this stream position.
        if (is_discover_mode())
            ini_inv(Wishing);
        if (game.u?.umoney0)
            ini_inv(Money);
        init_attr(75);
        vary_init_attr();
        u_init_carry_attr_boost();
    } finally {
        game._log_mkobj_rne = was_log_mkobj_rne;
    }
}

// C ref: u_init.c u_init_skills_discoveries — runs in newgame() AFTER the
// legend/intro is dismissed and BEFORE the welcome status line (alongside
// find_ac).  The only RNG-free side effect that affects parity is the
// starting-Pw floor: a hero who knows at least one spell (e.g. the Healer's
// healing spellbooks) must start with enough power to cast their level-1
// spell, so Pw is forced up to SPELL_LEV_PW(1)==5 when the rolled value is
// lower.  This must NOT run earlier than the legend step, because the legend's
// status line still shows the pre-bump (newpw) Pw value.
const SPELL_LEV_PW_1 = 5;

// C ref: u_init.c ini_inv_use_obj() — the start-of-game side effects of each
// starting inventory item.  Called once per item from u_init_skills_discoveries
// (C: the gi.invent loop at the top of u_init_skills_discoveries).  The only
// parity-relevant side effect (RNG-free) is type-discovery:
//
//   if (OBJ_DESCR(objects[obj->otyp]) && obj->known)
//       discover_object(obj->otyp, TRUE, TRUE, FALSE);
//   if (obj->otyp == OIL_LAMP)
//       discover_object(POT_OIL, TRUE, TRUE, FALSE);
//
// obj->known is 1 for every non-coin starting item: mkobj.c:864 sets
// obj->known = !oc_uses_known when the object is created, and
// ini_inv_adjust_obj() sets obj->known = 1 when oc_uses_known IS set — so both
// cases land on known==1 by the time ini_inv_use_obj runs.  The JS port already
// sets obj.known = 1 for every non-coin starting item (ini_inv_adjust_obj),
// matching that end state, so the discovery condition reduces to "this item has
// a randomized appearance".  That is true exactly when the object is present in
// DESCR_BY_OTYP (OBJ_DESCR != NoDes); NoDes objects are absent.
//
// Net effect: a Valkyrie's small shield ("wooden shield") and a carried oil
// lamp ("lamp") both become type-known at game start (so a starting scroll of
// identify reports "already identified the rest of your possessions" instead of
// stopping to identify them); an oil lamp also pre-discovers POT_OIL.
function ini_inv_use_obj_discover(obj) {
    if (!obj) return;
    const otyp = obj.otyp;
    // Faithful C condition (u_init.c:1257):
    //   if (OBJ_DESCR(objects[obj->otyp]) && obj->known)
    //       discover_object(obj->otyp, TRUE, TRUE, FALSE);
    //   if (obj->otyp == OIL_LAMP)
    //       discover_object(POT_OIL, TRUE, TRUE, FALSE);
    // obj->known is 1 for every non-coin starting item, so the faithful effect
    // is to type-discover *every* appearance-bearing starting item (e.g. a
    // Monk's random scroll of identify and potion of healing; a Valkyrie's
    // small shield; a carried oil lamp).  This consumes no RNG and only affects
    // how items are *named* in the inventory/discoveries displays.
    //
    if (DESCR_BY_OTYP[otyp] != null && obj.known)
        discover_object(otyp, true, true);
    if (otyp === OIL_LAMP)
        discover_object(POT_OIL, true, true);
}

export function u_init_skills_discoveries() {
    game.u = game.u || {};
    // C ref: u_init.c u_init_skills_discoveries — `for (otmp = gi.invent; otmp;
    // otmp = otmp->nobj) ini_inv_use_obj(otmp);` runs before skill_init.  This
    // pre-type-identifies starting items that carry a randomized appearance and
    // whose type the hero recognizes at the start (e.g. a Valkyrie's small
    // shield), so a starting scroll of identify finds them already known.
    if (Array.isArray(game.invent))
        for (const obj of game.invent)
            ini_inv_use_obj_discover(obj);
    skill_init_snapshot();
    skill_based_spellbook_id();
    if (num_spells() && (game.u.uenmax ?? 0) < SPELL_LEV_PW_1) {
        game.u.uen = game.u.uenmax = game.u.uenpeak = SPELL_LEV_PW_1;
        if (Array.isArray(game.u.ueninc) && game.u.ulevel != null)
            game.u.ueninc[game.u.ulevel] = SPELL_LEV_PW_1;
    }
}

export async function moveloop_preamble_startup() {
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

    // C ref: allmain.c:73 `set_wear((struct obj *) 0);` — "for side-effects of
    // starting gear".  u_init's setworn() only sets the worn masks; every
    // don-time side effect (the Archeologist fedora's +1 Luck via Helmet_on(),
    // a cloak of displacement's discovery via Cloak_on(), the extrinsic
    // property toggles) comes from here.  This used to be a single hand-copied
    // special case for the displacement cloak, so an Archeologist played with
    // Luck 0 all game and every rnl() was one rn2(37+|Luck|) short.
    const { set_wear } = await import('./do_wear.js');
    await set_wear(null);
}
