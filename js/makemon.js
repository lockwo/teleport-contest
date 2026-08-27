// makemon.js - Monster creation.
// C ref: makemon.c - rndmonst_adj, rndmonst, mkclass, mkclass_aligned,
//        makemon, newmonhp, m_initweap.

import { game } from './gstate.js';
import { rn2, rnd, d, rn1 } from './rng.js';
import { depth as depth_of_level } from './hacklib.js';
import { builds_up, In_hell, Is_special, level_difficulty_c } from './dungeon.js';
import { roles } from './role.js';
import { DART, mksobj, mkobj, next_ident, mkobj_at, weight, curse, bless,
         rnd_class, objects,
         // Both spellings are imported on purpose: the pre-existing call sites
         // use the *_OTYP aliases while m_initinv_full() (ported later) uses the
         // plain names.  ESM allows binding one export to two local names.
         WAN_DIGGING, WAN_DIGGING as WAN_DIGGING_OTYP,
         DILITHIUM_CRYSTAL, DILITHIUM_CRYSTAL as DILITHIUM_CRYSTAL_OTYP,
         LUCKSTONE, LUCKSTONE as LUCKSTONE_OTYP } from './mkobj.js';
import { get_shop_item, FODDERSHOP, VEGETARIAN_CLASS } from './shtypes.js';
import { get_wormno, initworm, count_wsegs, worm_seg_at,
         place_worm_tail_randomly } from './worm.js';
// Object-class constants inlined (not imported) to avoid a circular-import TDZ:
// mkobj.js's dependency chain reaches makemon.js, so importing these names here
// can hit them before mkobj.js finishes initializing.
const RANDOM_CLASS = 0, COIN_CLASS = 12, MAXOCLASSES = 18;

import {
    A_NONE, A_CHAOTIC, A_NEUTRAL, A_LAWFUL,
    AM_NONE, AM_CHAOTIC, AM_NEUTRAL, AM_LAWFUL,
    DUNGEON_ALIGN_BY_DNUM,
    In_endgame, Is_astralevel, Is_rogue_level, MM_NONAME,
    Is_airlevel, Is_firelevel, Is_earthlevel, Is_waterlevel,
    In_mines, In_sokoban, Is_stronghold, Align2amask,
    PIT, HOLE, TRAPDOOR, ALL_TRAPS,
    COLNO, ROWNO, DOOR, IN_SIGHT, POOL, MOAT, WATER, LAVAPOOL,
    HWALL, TLCORNER, BLCORNER, CROSSWALL, TUWALL, TDWALL, TRWALL, DBWALL,
    SDOOR, SCORR, D_CLOSED, D_LOCKED,
    STRAT_CLOSE, STRAT_WAITFORU, STRAT_APPEARMSG, W_SADDLE,
} from './const.js';
// set_mimic_sym() needs the room/trap/vision helpers.  These modules sit below
// makemon.js in the import graph except vision.js, which imports two function
// declarations from here — a cycle that resolves cleanly because both sides are
// hoisted `function` declarations used only at call time, never at module init.
import { inside_room, t_at as t_at_local } from './mkroom.js';
import { does_block, block_point } from './vision.js';
import { ARM_BONUS, m_dowear } from './worn.js';
import {
    mflags2_of, mflags3_of, msound_of,
    M2_LORD, M2_PRINCE, M2_NASTY, M2_DEMON, M2_STRONG, M2_HOSTILE, M2_PEACEFUL, M2_MINION,
    M2_GNOME, M2_ORC, M2_ELF, M2_DWARF, M2_HUMAN, M2_MERC, M2_DOMESTIC,
    M3_CLOSE, M3_WAITFORU, M3_WAITMASK,
    unsolid_flag,
    MS_LEADER, MS_GUARDIAN, MS_NEMESIS, MS_PRIEST,
    is_undead_flag, is_giant_flag, mindless,
    // set_mimic_sym()/newcham() predicates, read from the real mflags tables
    // rather than species-name sets (see LESSONS: the name-regex bug class).
    is_shapeshifter_flag, humanoid as humanoid_flag, polyok_flag, is_animal,
    is_demon_flag,
    is_swimmer_flag, is_flyer_flag, amorphous_flag, passes_walls_flag,
    throws_rocks_flag, likes_gold_flag,
    MFLAGS1, M1_OVIPAROUS,
    M1_SEE_INVIS, M1_AMPHIBIOUS, M1_FLY, M1_REGEN, M1_TPORT_CNTRL, M1_TPORT,
} from './monflags_data.js';
import { AT_EXPL, attacktype, is_armed, MATTK,
         AT_WEAP, AT_MAGC, AD_DRST, AD_SPEL } from './monattk_data.js';
const MM_NOWAIT = 0x00000002; // C ref: makemon.h MM_NOWAIT — suppress STRAT_WAITFORU/STRAT_CLOSE

const G_UNIQ = 0x1000;
const G_NOHELL = 0x0800;
const G_HELL = 0x0400;
const G_NOGEN = 0x0200;
const G_SGROUP = 0x0080; // appear in small groups normally
const G_LGROUP = 0x0040; // appear in large groups normally
const G_GENO = 0x0020;
const G_NOCORPSE = 0x0010;
const G_FREQ = 0x0007;
export const MM_ASLEEP = 0x00001000; // monsters should be generated asleep
export const MM_NOGRP = 0x00002000; // suppress creation of monster groups
const MM_ANGRY = 0x00000020; // monster is created angry
const MM_ADJACENTOK = 0x00000010; // C ref: makemon.h — ok to displace to an adjacent square
// C ref: hack.h:1155-1163 — the caller-supplied mextra/gender flags.
const MM_EPRI = 0x00000100;
export const MM_EMIN = 0x00000400;
const MM_MALE = 0x00008000, MM_FEMALE = 0x00010000;
const G_IGNORE = 0x8000;
const G_GONE = 0x03; // mvflags G_GENOD | G_EXTINCT
const G_GENOD = 0x02;

// C ref: defsym.h S_BAT / monst.h MFAST.
const S_BAT = 28, MFAST = 2;

const MR_FIRE = 0x01;
const MR_COLD = 0x02;

const NON_PM = -1;
// mons[] index of the Wizard of Yendor (adj_lev's special case).
const PM_WIZARD_OF_YENDOR_JS = 285;
// C ref: global.h:411 — #define ALIGNWEIGHT 4 (generation weight of alignment).
const ALIGNWEIGHT = 4;

// S_* monster-class symbol indices (include/defsym.h MONSYM order).
const S_LICH = 38;
const S_VAMPIRE = 48;
const S_HUMAN = 53;

// C ref: mondata.h quest_mon_represents_role(mptr, role_pm) —
//   mptr->mlet == S_HUMAN && Role_if(role_pm)
//   && (mptr->msound == MS_LEADER || mptr->msound == MS_NEMESIS)
// The role is named by its role.c filecode (e.g. 'Pri' for PM_CLERIC).
function quest_mon_represents_role(ptr, roleFilecode) {
    if (!ptr || ptr.mcls !== S_HUMAN) return false;
    if (roles[game.initrole]?.filecode !== roleFilecode) return false;
    const snd = msound_of(ptr);
    return snd === MS_LEADER || snd === MS_NEMESIS;
}
const MAXMCLASSES = 61;

// PM indices used by the vampire-shapeshift path (Vlad's Tower).  Inlined to
// avoid a circular import; verified against name_to_pmidx at load.
const PM_WOLF = 20;
const PM_FOG_CLOUD = 106;
const PM_VAMPIRE_BAT = 129;
const PM_VAMPIRE = 226;
const PM_VAMPIRE_LEADER = 227; /* also "vampire lord"/"vampire lady" */
// Shapechanger cham values and the two difficulty anchors select_newcham_form
// passes to pick_nasty().  mons[] indices, verified against name_to_pmidx().
const PM_SANDESTIN = 301, PM_DOPPELGANGER = 270, PM_CHAMELEON = 327;
const PM_ARCHON = 125, PM_JABBERWOCK = 178;
// mondata.h is_placeholder(): mons[] entries that exist only so zombie/mummy
// corpses have something to point at.  PM_DWARF and PM_GNOME are NOT among them.
const S_EEL_CLS = 57;            // monsym.h S_EEL
const PM_ORC_PLACEHOLDER = 72, PM_GIANT_PLACEHOLDER = 169,
      PM_ELF_PLACEHOLDER = 264, PM_HUMAN_PLACEHOLDER = 260;
const PM_VLAD_THE_IMPALER = 228;
const CANDELABRUM_OF_INVOCATION = 262;

// is_placeholder() monsters (include/mondata.h): PM indices excluded by
// mkclass()'s mk_gen_ok.  These are abstract class placeholders.
const PM_ORC = 72;
const PM_GIANT = 169;
const PM_ETTIN = 174;
const PM_HUMAN = 260;
const PM_ELF = 264;

// SPECIAL_PM = PM_LONG_WORM_TAIL; mons[] iteration for generation stops here.
const SPECIAL_PM = 330;

// S_* index -> display character (include/defsym.h).  Used for the rogue-level
// isupper(monsym) test and for class symbols.
const SYM_CHAR = [
    '\0', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N',
    'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    '@', ' ', '\'', '&', ';', ':', '~', ']',
];

// Full mons[] generation data, in mngen (array) order, ported from
// src/monst.c / include/monsters.h (the MON() entries).  Tuple layout:
//   [pmidx, mlet(S_* index), mlevel, maligntyp, geno, mresists, gender,
//    difficulty, mcolor]
// gender: 0 = femaleok/random (rn2(2) consumed), 1 = always male,
//         2 = always female, 3 = neuter (no rn2(2)).  Derived from the
//         M2_MALE / M2_FEMALE / M2_NEUTER flags of mflags2.
// Only the fields that influence the RNG-relevant generation paths are kept
// (selection weighting, difficulty filtering, HP roll, gender, color/symbol).
const MONS_RAW = [
    [0,1,2,0,163,0,0,4,3], [1,1,1,0,98,32,2,6,11], [2,1,3,0,162,32,0,7,4],
    [3,1,3,0,161,1,0,6,1], [4,1,5,0,35,32,0,6,0], [5,1,9,0,544,32,2,12,5],
    [6,2,1,0,34,228,3,2,2], [7,2,5,0,34,36,3,6,15], [8,2,6,0,34,247,3,8,6],
    [9,3,4,0,161,160,0,7,3], [10,3,5,0,37,160,0,8,11], [11,3,6,0,33,33,0,8,1],
    [12,4,0,0,163,0,0,1,3], [13,4,0,0,33,0,0,1,1], [14,4,1,0,161,0,0,2,3],
    [15,4,2,-7,528,32,0,4,3], [16,4,2,0,33,0,0,3,15], [17,4,4,0,33,0,0,5,11],
    [18,4,4,0,33,0,0,5,15], [19,4,6,0,33,0,0,7,15], [20,4,5,0,162,0,0,6,7],
    [21,4,5,-7,528,32,0,7,7], [22,4,5,0,2210,2,0,7,6], [23,4,7,-5,162,0,0,8,0],
    [24,4,7,-5,2081,2,0,9,6], [25,4,7,0,1185,1,0,9,1], [26,4,12,-5,1057,1,0,14,1],
    [27,5,1,0,49,0,3,2,7], [28,5,2,0,37,0,3,3,4], [29,5,6,0,2098,2,3,9,15],
    [30,5,6,0,50,1,3,9,1], [31,5,6,0,50,16,3,10,12], [32,6,2,0,33,0,0,3,15],
    [33,6,4,0,33,0,0,5,15], [34,6,4,0,34,0,0,6,3], [35,6,5,0,33,0,0,7,6],
    [36,6,5,0,33,0,0,7,0], [37,6,6,0,33,0,0,7,15], [38,6,6,0,34,0,0,8,11],
    [39,6,12,-3,33,0,0,14,4], [40,7,5,-9,34,32,0,8,2], [41,7,6,-9,34,128,0,8,3],
    [42,7,9,-12,33,128,0,11,5], [43,8,1,6,34,0,0,2,2], [44,8,2,4,35,0,0,4,1],
    [45,8,3,-6,33,0,0,5,3], [46,8,4,5,34,0,0,6,4], [47,8,6,6,33,0,0,8,5],
    [48,8,9,-8,33,0,0,13,13], [49,8,13,-8,33,0,0,19,13], [50,9,1,-7,113,36,0,3,1],
    [51,9,2,-7,34,36,0,3,2], [52,9,3,-7,33,0,0,4,1], [53,9,3,-7,1137,36,3,5,3],
    [54,9,3,-7,34,32,0,7,4], [55,9,6,7,35,32,0,7,6], [56,10,4,0,34,34,3,5,4],
    [57,10,5,0,33,192,3,6,2], [58,10,6,0,34,192,3,8,3], [59,11,0,-2,33,32,0,1,3],
    [60,11,1,-3,33,32,0,2,1], [61,11,2,-4,33,32,0,3,5], [62,11,2,-4,33,32,0,4,12],
    [63,12,5,0,36,0,0,4,2], [64,13,7,0,34,64,0,8,3], [65,13,8,0,33,64,0,9,1],
    [66,13,9,0,33,64,0,11,5], [67,14,3,0,34,0,2,5,2], [68,14,3,0,34,0,2,5,4],
    [69,14,3,0,34,0,2,5,3], [70,15,0,-3,34,0,0,1,7], [71,15,1,-4,34,0,0,3,3],
    [72,15,1,-3,608,32,0,3,1], [73,15,2,-4,98,32,0,4,11], [74,15,3,-5,97,32,0,5,4],
    [75,15,3,-4,97,32,0,5,0], [76,15,3,-5,33,32,0,5,12], [77,15,5,-5,33,32,0,7,5],
    [78,16,3,0,36,0,0,4,7], [79,16,5,0,34,0,0,6,6], [80,16,7,0,33,64,0,9,15],
    [81,17,2,0,164,0,0,4,3], [82,17,5,-2,33,0,0,7,7], [83,17,6,0,34,0,0,8,1],
    [84,17,8,0,33,0,0,9,6], [85,17,12,0,34,0,0,13,7], [86,17,14,0,34,0,0,15,7],
    [87,17,20,0,33,0,0,22,0], [88,18,0,0,161,0,0,1,3], [89,18,1,0,162,0,0,2,3],
    [90,18,2,0,33,32,0,4,3], [91,18,2,-7,528,32,0,4,3], [92,18,3,0,34,0,0,4,7],
    [93,18,3,0,544,0,0,4,3], [94,19,1,0,162,32,0,3,7], [95,19,2,0,33,32,0,4,11],
    [96,19,5,0,33,32,0,7,5], [97,19,5,0,34,32,0,8,1], [98,20,10,0,34,0,0,12,7],
    [99,20,12,0,34,0,0,14,2], [100,21,3,0,34,0,0,4,3], [101,21,4,7,34,32,0,6,15],
    [102,21,4,0,33,32,0,6,7], [103,21,4,-7,33,32,0,6,0], [104,21,5,0,34,0,0,7,3],
    [105,21,7,0,34,0,0,9,3], [106,22,3,0,50,164,3,4,7], [107,22,4,0,50,164,3,6,3],
    [108,22,5,0,2097,166,3,7,6], [109,22,6,0,49,188,3,9,12], [110,22,7,0,1074,165,3,9,4],
    [111,22,8,0,1073,165,3,10,11], [112,23,5,0,32,0,0,6,3], [113,23,8,0,32,0,0,9,5],
    [114,23,9,0,34,0,0,10,3], [115,23,15,0,34,0,0,17,5], [116,24,0,0,179,48,0,1,5],
    [117,24,7,0,35,32,0,9,1], [118,25,3,0,52,255,3,5,11], [119,25,5,0,50,255,3,7,0],
    [120,26,9,0,34,0,0,11,3], [121,27,8,7,2193,32,0,11,2], [122,27,10,7,2065,54,0,12,11],
    [123,27,14,12,2065,54,0,19,15], [124,27,16,15,2065,32,0,21,11], [125,27,19,15,2065,55,0,26,5],
    [126,28,0,0,161,0,0,2,3], [127,28,2,0,34,0,0,3,1], [128,28,4,0,34,0,0,6,0],
    [129,28,5,0,34,36,0,7,0], [130,29,4,0,33,0,0,6,3], [131,29,5,-1,33,0,0,8,2],
    [132,29,6,-3,33,0,0,9,6], [133,30,12,0,32,0,0,13,7], [134,30,12,0,32,0,0,13,11],
    [135,30,12,0,32,0,0,13,14], [136,30,12,0,32,1,0,13,1], [137,30,12,0,32,2,0,13,15],
    [138,30,12,0,32,4,0,13,9], [139,30,12,0,32,8,0,13,0], [140,30,12,0,32,16,0,13,4],
    [141,30,12,0,32,32,0,13,2], [142,30,12,0,32,192,0,13,11], [143,30,15,4,33,0,0,20,7],
    [144,30,15,4,33,1,0,20,11], [145,30,15,4,33,2,0,20,14], [146,30,15,-4,33,1,0,20,1],
    [147,30,15,-5,33,2,0,20,15], [148,30,15,5,33,4,0,20,9], [149,30,15,-6,33,8,0,20,0],
    [150,30,15,-7,33,16,0,20,4], [151,30,15,6,33,32,0,20,2], [152,30,15,7,33,192,0,20,11],
    [153,31,8,0,35,0,0,9,15], [154,31,8,0,17,160,3,10,6], [155,31,8,0,17,161,3,10,11],
    [156,31,8,0,17,163,3,10,3], [157,31,8,0,17,160,3,10,4], [158,32,0,0,36,0,3,1,10],
    [159,32,1,0,33,34,3,2,3], [160,32,1,0,34,32,3,2,11], [161,32,1,0,33,192,3,2,2],
    [162,32,1,0,33,33,3,2,1], [163,32,3,0,33,32,3,2,5], [164,32,3,0,34,32,3,5,5],
    [165,33,1,0,161,0,0,3,3], [166,33,3,0,34,0,0,4,4], [167,33,3,0,33,0,0,5,12],
    [168,33,5,0,33,0,0,6,5], [169,34,6,2,545,0,0,8,1], [170,34,6,2,161,0,0,8,7],
    [171,34,8,-2,161,0,0,10,6], [172,34,9,2,161,1,0,11,11], [173,34,10,-3,2209,2,0,13,15],
    [174,34,10,0,33,0,0,13,3], [175,34,16,-3,161,16,0,19,4], [176,34,16,9,1,0,0,20,5],
    [177,34,15,0,544,0,0,17,3], [178,36,15,0,33,0,0,18,9], [179,37,1,9,608,0,1,3,4],
    [180,37,2,10,672,0,1,4,4], [181,37,3,11,544,0,1,5,6], [182,37,4,12,544,0,1,6,5],
    [183,38,11,-9,49,38,0,14,3], [184,38,14,-12,49,38,0,18,1], [185,38,17,-15,1073,39,0,21,5],
    [186,38,25,-15,1073,55,0,29,5], [187,39,3,-2,49,38,0,4,3], [188,39,4,-3,49,38,0,5,1],
    [189,39,5,-4,49,38,0,6,7], [190,39,5,-4,49,38,0,6,1], [191,39,6,-5,49,38,0,7,2],
    [192,39,6,-5,49,38,0,7,7], [193,39,7,-6,49,38,0,8,4], [194,39,8,-7,49,38,0,10,6],
    [195,40,3,0,32,33,0,4,1], [196,40,3,0,32,224,0,4,0], [197,40,3,0,32,32,0,4,11],
    [198,40,3,0,32,32,0,4,2], [199,40,6,-4,33,33,0,8,1], [200,40,8,4,33,224,0,10,0],
    [201,40,10,5,33,32,0,13,11], [202,40,12,7,33,32,0,17,2], [203,41,5,-3,161,0,0,7,3],
    [204,41,7,-5,34,0,0,9,1], [205,41,9,-7,34,0,0,11,5], [206,42,3,0,50,227,3,4,7],
    [207,42,5,0,49,242,3,6,3], [208,42,6,0,1073,242,3,8,2], [209,42,10,0,49,242,3,12,0],
    [210,43,7,0,35,32,0,9,6], [211,43,12,0,33,32,0,14,2], [212,44,5,0,34,0,0,8,3],
    [213,44,12,-3,1058,0,0,14,4], [214,45,1,0,97,0,0,3,2], [215,45,4,0,34,32,0,6,3],
    [216,45,4,0,608,32,0,7,1], [217,45,6,0,33,0,0,8,5], [218,45,6,0,33,32,0,9,4],
    [219,45,6,0,33,32,0,10,4], [220,46,7,-3,34,0,0,9,3], [221,46,9,-3,2081,2,0,12,15],
    [222,46,9,-3,33,0,0,12,6], [223,46,11,-3,544,0,0,13,4], [224,46,13,-7,33,0,0,16,5],
    [225,47,9,0,34,0,0,12,3], [226,48,10,-8,49,36,0,12,1], [227,48,12,-9,49,36,0,14,4],
    [228,48,28,-10,4624,36,1,32,5], [229,49,3,-3,49,38,0,8,7], [230,49,6,-6,34,166,0,8,0],
    [231,49,13,-17,49,38,1,17,5], [232,50,8,0,33,131,0,11,3], [233,51,2,0,33,0,0,4,7],
    [234,51,4,0,162,0,0,6,3], [235,51,5,0,35,0,0,7,3], [236,51,5,0,34,2,0,7,15],
    [237,51,6,0,33,0,0,8,0], [238,51,7,2,33,0,0,9,7], [239,52,0,-2,49,38,0,1,3],
    [240,52,1,-2,49,38,0,2,3], [241,52,2,-3,177,38,0,3,7], [242,52,2,-3,177,38,0,3,1],
    [243,52,3,-3,177,38,0,4,2], [244,52,4,-3,177,38,0,5,15], [245,52,6,-4,49,38,0,7,4],
    [246,52,3,-2,49,38,0,5,0], [247,52,8,-4,49,38,0,9,6], [248,52,12,0,528,166,0,14,15],
    [249,55,3,0,17,38,3,4,11], [250,55,3,0,17,38,3,4,15], [251,55,4,0,17,36,3,6,3],
    [252,55,5,0,17,100,3,6,11], [253,55,6,0,17,36,3,7,3], [254,55,7,0,17,38,3,8,3],
    [255,55,9,0,1,55,0,10,1], [256,55,11,0,17,36,0,12,3], [257,55,14,0,17,164,0,15,7],
    [258,55,16,0,17,100,0,18,6], [259,55,18,0,17,55,0,22,6], [260,53,0,0,512,0,0,2,15],
    [261,53,2,-7,1,32,0,3,3], [262,53,2,-7,1,32,0,3,1], [263,53,5,-7,1,32,0,6,9],
    [264,53,0,-3,512,4,0,1,15], [265,53,4,-5,162,4,0,6,2], [266,53,5,-6,162,4,0,7,10],
    [267,53,6,-7,162,4,0,8,7], [268,53,8,-9,162,4,0,11,12], [269,53,9,-10,33,4,0,11,5],
    [270,53,9,0,33,4,0,11,15], [271,53,12,0,512,0,0,15,15], [272,53,12,10,512,0,0,14,4],
    [273,53,12,0,512,0,0,14,15], [274,53,12,0,4608,0,2,13,12], [275,53,12,0,512,16,0,15,15],
    [276,53,25,0,4608,53,0,30,15], [277,53,6,-2,161,0,0,8,7], [278,53,8,-3,161,0,0,10,1],
    [279,53,11,0,35,32,0,13,15], [280,53,10,-4,33,0,0,12,2], [281,53,12,-5,33,0,0,14,4],
    [282,53,6,-2,673,0,0,8,7], [283,53,10,-4,545,0,0,12,2], [284,53,20,-15,4608,160,2,25,10],
    [285,53,30,-128,4608,33,1,34,13], [286,53,20,15,4608,0,1,22,5], [287,54,10,-5,528,174,0,12,7],
    [288,54,12,0,528,174,0,14,0], [289,56,8,-7,528,33,0,11,4], [290,56,6,-9,17,33,0,8,7],
    [291,56,6,11,1042,33,0,9,3], [292,56,7,10,1170,33,2,10,1], [293,56,8,8,1170,33,0,11,1],
    [294,56,7,-12,1041,33,2,11,1], [295,56,8,-9,1170,33,0,11,2], [296,56,9,-10,1170,33,0,12,2],
    [297,56,9,-9,1170,33,0,13,7], [298,56,11,-12,1042,35,0,15,15], [299,56,11,-11,1041,33,0,15,1],
    [300,56,13,-13,1042,33,0,16,1], [301,56,13,-5,1041,128,0,15,7], [302,56,16,-14,1041,33,0,20,1],
    [303,56,50,-15,5648,225,1,26,10], [304,56,56,-15,5648,33,1,31,5], [305,56,66,-20,5648,33,1,36,5],
    [306,56,72,15,5648,33,1,36,5], [307,56,78,15,5648,33,1,40,5], [308,56,89,20,5648,33,1,45,5],
    [309,56,105,20,5648,35,1,53,5], [310,56,106,-20,5648,33,1,57,5], [311,56,30,0,4608,183,0,34,13],
    [312,56,30,0,4608,183,0,34,13], [313,56,30,0,4608,183,0,34,13], [314,56,56,0,528,183,0,26,12],
    [315,56,7,0,528,160,0,8,11], [316,57,3,0,544,32,0,5,4], [317,57,5,0,672,0,0,7,1],
    [318,57,7,0,544,0,0,9,7], [319,57,5,0,544,0,0,7,6], [320,57,7,0,544,16,0,10,12],
    [321,57,20,-3,544,0,0,22,1], [322,58,0,0,37,0,0,1,11], [323,58,1,0,37,0,0,2,2],
    [324,58,2,0,37,0,0,3,3], [325,58,3,0,32,0,0,4,3], [326,58,5,0,37,128,0,6,2],
    [327,58,6,0,34,0,0,7,3], [328,58,6,0,33,0,0,7,3], [329,58,8,-9,1025,5,0,12,9],
    [330,59,0,0,4624,0,0,1,3], [331,53,10,3,512,0,0,12,15], [332,53,10,0,512,32,0,12,15],
    [333,53,10,1,512,0,0,12,15], [334,53,10,0,512,32,0,12,15], [335,53,10,3,512,0,0,12,15],
    [336,53,10,0,512,0,0,11,15], [337,53,10,0,512,0,0,12,15], [338,53,10,-3,512,0,0,12,15],
    [339,53,10,-3,512,0,0,12,15], [340,53,10,3,512,0,0,12,15], [341,53,10,0,512,0,0,12,15],
    [342,53,10,1,512,2,2,12,15], [343,53,10,0,512,0,0,12,15], [344,53,20,20,4608,0,1,24,5],
    [345,53,20,0,4608,32,1,24,5], [346,53,20,20,4608,0,1,24,5], [347,53,20,0,4608,32,1,26,5],
    [348,53,20,20,4608,0,1,24,5], [349,53,25,0,4608,53,1,30,0], [350,53,25,0,4608,53,1,30,15],
    [351,53,20,0,4608,0,1,24,5], [352,53,20,-20,4608,128,1,24,5], [353,53,20,20,4608,0,1,24,5],
    [354,53,20,0,4608,0,1,22,15], [355,53,20,0,4608,2,2,24,5], [356,53,20,0,4608,0,2,25,2],
    [357,56,16,-14,4624,161,0,23,9], [358,53,16,-14,4624,160,1,22,5], [359,30,16,-14,4608,255,2,23,5],
    [360,34,18,-15,4608,128,1,23,7], [361,30,15,-14,4608,129,1,22,1], [362,53,25,-20,4608,160,1,31,5],
    [363,56,16,-127,4624,161,1,23,9], [364,19,15,-15,4608,160,1,17,5], [365,53,15,18,4608,128,1,20,5],
    [366,53,15,-13,4624,128,1,19,5], [367,34,15,12,4608,129,1,19,5], [368,53,15,-10,4624,128,0,20,0],
    [369,53,5,3,512,0,0,7,15], [370,53,5,0,512,32,0,7,15], [371,53,5,1,512,0,0,7,15],
    [372,53,5,0,512,32,0,7,15], [373,53,5,3,512,0,0,7,15], [374,53,5,0,512,0,0,8,15],
    [375,53,5,0,512,0,0,8,15], [376,53,5,-7,512,0,0,7,15], [377,53,5,-3,512,0,0,7,15],
    [378,53,5,3,512,0,0,7,15], [379,53,5,3,512,0,0,7,15], [380,53,5,0,512,0,0,8,15],
    [381,53,5,1,512,0,2,7,15], [382,53,5,0,512,0,0,8,15],
];

// Neutral monster names, indexed by pmidx (src/monst.c MON() name fields).
// Consumed by external callers (eat.js corpse names, display); not parity.
const MONS_NAMES = [
    "giant ant", "killer bee", "soldier ant", "fire ant",
    "giant beetle", "queen bee", "acid blob", "quivering blob",
    "gelatinous cube", "chickatrice", "cockatrice", "pyrolisk",
    "jackal", "fox", "coyote", "werejackal",
    "little dog", "dingo", "dog", "large dog",
    "wolf", "werewolf", "winter wolf cub", "warg",
    "winter wolf", "hell hound pup", "hell hound", "gas spore",
    "floating eye", "freezing sphere", "flaming sphere", "shocking sphere",
    "kitten", "housecat", "jaguar", "lynx",
    "panther", "large cat", "tiger", "displacer beast",
    "gremlin", "gargoyle", "winged gargoyle", "hobbit",
    "dwarf", "bugbear", "dwarf leader", "dwarf ruler",
    "mind flayer", "master mind flayer", "manes", "homunculus",
    "imp", "lemure", "quasit", "tengu",
    "blue jelly", "spotted jelly", "ochre jelly", "kobold",
    "large kobold", "kobold leader", "kobold shaman", "leprechaun",
    "small mimic", "large mimic", "giant mimic", "wood nymph",
    "water nymph", "mountain nymph", "goblin", "hobgoblin",
    "orc", "hill orc", "Mordor orc", "Uruk-hai",
    "orc shaman", "orc-captain", "rock piercer", "iron piercer",
    "glass piercer", "rothe", "mumak", "leocrotta",
    "wumpus", "titanothere", "baluchitherium", "mastodon",
    "sewer rat", "giant rat", "rabid rat", "wererat",
    "rock mole", "woodchuck", "cave spider", "centipede",
    "giant spider", "scorpion", "lurker above", "trapper",
    "pony", "white unicorn", "gray unicorn", "black unicorn",
    "horse", "warhorse", "fog cloud", "dust vortex",
    "ice vortex", "energy vortex", "steam vortex", "fire vortex",
    "baby long worm", "baby purple worm", "long worm", "purple worm",
    "grid bug", "xan", "yellow light", "black light",
    "zruty", "couatl", "Aleax", "Angel",
    "ki-rin", "Archon", "bat", "giant bat",
    "raven", "vampire bat", "plains centaur", "forest centaur",
    "mountain centaur", "baby gray dragon", "baby gold dragon", "baby silver dragon",
    "baby red dragon", "baby white dragon", "baby orange dragon", "baby black dragon",
    "baby blue dragon", "baby green dragon", "baby yellow dragon", "gray dragon",
    "gold dragon", "silver dragon", "red dragon", "white dragon",
    "orange dragon", "black dragon", "blue dragon", "green dragon",
    "yellow dragon", "stalker", "air elemental", "fire elemental",
    "earth elemental", "water elemental", "lichen", "brown mold",
    "yellow mold", "green mold", "red mold", "shrieker",
    "violet fungus", "gnome", "gnome leader", "gnomish wizard",
    "gnome ruler", "giant", "stone giant", "hill giant",
    "fire giant", "frost giant", "ettin", "storm giant",
    "titan", "minotaur", "jabberwock", "Keystone Kop",
    "Kop Sergeant", "Kop Lieutenant", "Kop Kaptain", "lich",
    "demilich", "master lich", "arch-lich", "kobold mummy",
    "gnome mummy", "orc mummy", "dwarf mummy", "elf mummy",
    "human mummy", "ettin mummy", "giant mummy", "red naga hatchling",
    "black naga hatchling", "golden naga hatchling", "guardian naga hatchling", "red naga",
    "black naga", "golden naga", "guardian naga", "ogre",
    "ogre leader", "ogre tyrant", "gray ooze", "brown pudding",
    "green slime", "black pudding", "quantum mechanic", "genetic engineer",
    "rust monster", "disenchanter", "garter snake", "snake",
    "water moccasin", "python", "pit viper", "cobra",
    "troll", "ice troll", "rock troll", "water troll",
    "Olog-hai", "umber hulk", "vampire", "vampire leader",
    "Vlad the Impaler", "barrow wight", "wraith", "Nazgul",
    "xorn", "monkey", "ape", "owlbear",
    "yeti", "carnivorous ape", "sasquatch", "kobold zombie",
    "gnome zombie", "orc zombie", "dwarf zombie", "elf zombie",
    "human zombie", "ettin zombie", "ghoul", "giant zombie",
    "skeleton", "straw golem", "paper golem", "rope golem",
    "gold golem", "leather golem", "wood golem", "flesh golem",
    "clay golem", "stone golem", "glass golem", "iron golem",
    "human", "wererat", "werejackal", "werewolf",
    "elf", "Woodland-elf", "Green-elf", "Grey-elf",
    "elf-noble", "elven monarch", "doppelganger", "shopkeeper",
    "guard", "prisoner", "Oracle", "aligned cleric",
    "high cleric", "soldier", "sergeant", "nurse",
    "lieutenant", "captain", "watchman", "watch captain",
    "Medusa", "Wizard of Yendor", "Croesus", "ghost",
    "shade", "water demon", "amorous demon", "horned devil",
    "erinys", "barbed devil", "marilith", "vrock",
    "hezrou", "bone devil", "ice devil", "nalfeshnee",
    "pit fiend", "sandestin", "balrog", "Juiblex",
    "Yeenoghu", "Orcus", "Geryon", "Dispater",
    "Baalzebub", "Asmodeus", "Demogorgon", "Death",
    "Pestilence", "Famine", "mail daemon", "djinni",
    "jellyfish", "piranha", "shark", "giant eel",
    "electric eel", "kraken", "newt", "gecko",
    "iguana", "baby crocodile", "lizard", "chameleon",
    "crocodile", "salamander", "long worm tail", "archeologist",
    "barbarian", "cave dweller", "healer", "knight",
    "monk", "cleric", "ranger", "rogue",
    "samurai", "tourist", "valkyrie", "wizard",
    "Lord Carnarvon", "Pelias", "Shaman Karnov", "Hippocrates",
    "King Arthur", "Grand Master", "Arch Priest", "Orion",
    "Master of Thieves", "Lord Sato", "Twoflower", "Norn",
    "Neferet the Green", "Minion of Huhetotl", "Thoth Amon", "Chromatic Dragon",
    "Cyclops", "Ixoth", "Master Kaen", "Nalzok",
    "Scorpius", "Master Assassin", "Ashikaga Takauji", "Lord Surtur",
    "Dark One", "student", "chieftain", "neanderthal",
    "attendant", "page", "abbot", "acolyte",
    "hunter", "thug", "ninja", "roshi",
    "guide", "warrior", "apprentice",
];

// Build per-monster records from the tuple data.  `mlet` is the DISPLAY
// CHARACTER (so existing display.js / eat.js consumers keep working); `mcls`
// is the numeric S_* class index used internally by rndmonst()/mkclass().
// Map numeric gender code -> the STRING value other modules expect
// (mkobj.js mkcorpstat_spe checks 'neuter'/'female'/'male', else random).
const GENDER_STR = ['random', 'male', 'female', 'neuter'];

// verysmall(ptr) == (msize < MZ_SMALL), i.e. MZ_TINY.  pmidx set ported from
// the SIZ() size field of include/monsters.h.  Consumed by mkobj.js's STATUE
// spellbook-stuffing test (mkobj.c:1154).
const VERYSMALL = new Set([
    0, 1, 2, 3, 5, 6, 9, 51, 52, 63, 88, 89, 90, 91, 94,
    95, 116, 117, 126, 214, 322, 323, 324, 326, 327, 330,
]);

// C ref: monflag.h M1_CARNIVORE / M1_HERBIVORE — per-monster diet flags,
// extracted verbatim from the MON() entries in include/monsters.h.  Indexed by
// pmidx; value is a 2-bit code: bit0 = carnivore, bit1 = herbivore (3 = both,
// the M1_OMNIVORE pair).  Drives dog.c dogfood(), whose return value (DOGFOOD
// for an apple to a herbivore pony, etc.) decides when the pet's invent/fobj
// scans terminate — and therefore how many obj_resists rn2(100) rolls fire.
const MFOOD = [
    1, 0, 1, 1, 1, 0, 0, 0, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 0, 1, 1, 1, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 3, 1, 1, 1, 3, 2, 3, 3, 2, 2, 2, 1, 1, 1, 1, 0, 2, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 3, 3, 3,
    1, 3, 3, 1, 1, 1, 3, 3, 3, 3, 3, 3, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 3, 3, 1, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3, 3, 0, 3, 1, 3, 1, 2, 0, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3, 3, 3,
];

// C ref: include/monsters.h LVL(lvl, mov, ac, mr, aln) — the 3rd field is the
// monster's base armour class, consumed by worn.c find_mac() (which has no worn
// armour to add for these monsters).  Indexed by pmidx, generated from the C
// mons[] table (matched by name; a handful of renamed leaders use their C ac).
const MON_AC = [
    3, -1, 3, 3, 4, -4, 8, 8, 8, 8, 6, 6, 7, 7, 7, 7, 6, 5, 5, 4,
    4, 4, 4, 4, 4, 4, 2, 10, 9, 4, 4, 4, 6, 5, 6, 6, 6, 4, 6, -10,
    2, -4, -2, 10, 10, 5, 10, 10, 5, 0, 7, 6, 2, 7, 2, 5, 8, 8, 8, 10,
    10, 10, 6, 8, 7, 7, 7, 9, 9, 9, 10, 10, 10, 10, 10, 10, 5, 10, 3, 0,
    0, 7, 0, 4, 2, 6, 5, 5, 7, 7, 6, 6, 0, 0, 3, 3, 4, 3, 3, 3,
    6, 2, 2, 2, 5, 4, 0, 2, 2, 2, 2, 2, 5, 5, 5, 6, 9, -4, 0, 0,
    3, 5, 0, -4, -5, -6, 8, 7, 6, 6, 4, 3, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 3, 2, 2, 2, 2, 9, 9,
    9, 9, 9, 7, 7, 10, 10, 4, 10, 0, 0, 6, 4, 3, 3, 3, -3, 6, -2, 10,
    10, 10, 10, 0, -2, -4, -6, 6, 6, 5, 5, 4, 4, 4, 3, 6, 6, 6, 6, 4,
    2, 2, 0, 5, 3, 4, 8, 8, 6, 6, 3, 3, 2, -10, 8, 3, 3, 5, 2, 2,
    4, 2, 0, 4, -4, 2, 1, 0, -6, 5, 4, 0, -2, 6, 6, 5, 6, 6, 6, 10,
    10, 9, 9, 9, 8, 6, 10, 6, 4, 10, 10, 8, 6, 6, 4, 9, 7, 5, 1, 3,
    10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 5, 0, 10, 10, 0, 10, 7, 10, 10, 0,
    10, 10, 10, 10, 2, -8, 0, -5, 10, -4, 0, -5, 2, 0, -6, 0, -2, -1, -4, -1,
    -3, 4, -2, -7, -5, -6, -3, -2, -5, -7, -8, -5, -5, -5, 10, 4, 6, 4, 2, -1,
    -3, 6, 8, 8, 7, 7, 6, 6, 5, -1, 0, 10, 10, 10, 10, 10, 10, 10, 10, 10,
    10, 10, 10, 10, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 10, 0, 0, -2, 0, 0,
    0, -1, -10, -2, 10, 0, 0, 2, 0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
    10, 10, 10,
];

// C ref: include/monsters.h SIZ(wt, nut, snd, siz) — corpse weight (cwt) and
// body size (msize, MZ_*).  Consumed by mkobj.c weight() for CORPSE / STATUE
// objects: a CORPSE weighs quan*cwt, so a missing cwt made every floor corpse
// weigh 1, which lets the pet's can_carry() load check pass spuriously and
// flips dog_goal() from UNDEF to APPORT (skipping the rn2(4) at dogmove.c:575).
// Generated from the C mons[] table, matched by (name, monster-class symbol);
// a handful of renamed leaders/rulers use their C counterpart's SIZ() values
// (dwarf leader=dwarf lord, gnome ruler=gnome king, amorous demon=incubus, ...).
// Indexed by pmidx.
const MON_CWT = [
    10, 1, 20, 30, 200, 1, 30, 200, 600, 10, 30, 30, 300, 300, 300, 300,
    150, 400, 400, 800, 500, 500, 250, 850, 700, 200, 600, 10, 10, 10, 10, 10,
    150, 200, 600, 600, 600, 250, 600, 750, 100, 1000, 1200, 500, 900, 1250, 900, 900,
    1450, 1450, 100, 60, 20, 150, 200, 300, 50, 50, 50, 400, 450, 500, 450, 60,
    300, 600, 800, 600, 600, 600, 400, 1000, 850, 1000, 1200, 1300, 1000, 1350, 200, 400,
    400, 400, 2500, 1200, 2500, 2650, 3800, 3800, 20, 30, 30, 40, 30, 30, 50, 50,
    200, 50, 800, 800, 1300, 1300, 1300, 1300, 1500, 1800, 0, 0, 0, 0, 0, 0,
    600, 600, 1500, 2700, 15, 300, 0, 0, 1200, 900, 1450, 1450, 1450, 1450, 20, 30,
    40, 30, 2500, 2550, 2550, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 4500,
    4500, 4500, 4500, 4500, 4500, 4500, 4500, 4500, 4500, 900, 0, 0, 2500, 2500, 20, 50,
    50, 50, 50, 100, 100, 650, 700, 700, 750, 2250, 2250, 2200, 2250, 2250, 1700, 2250,
    2300, 1500, 1300, 1450, 1450, 1450, 1450, 1200, 1200, 1200, 1200, 400, 650, 850, 900, 800,
    1450, 1700, 2050, 500, 500, 500, 500, 2600, 2600, 2600, 2600, 1600, 1700, 1700, 500, 500,
    400, 900, 1450, 1450, 1000, 750, 50, 100, 150, 250, 100, 250, 800, 1000, 1200, 1200,
    1500, 1200, 1450, 1450, 1450, 1200, 0, 1450, 1200, 100, 1100, 1700, 1600, 1250, 1550, 400,
    650, 850, 900, 800, 1450, 1700, 400, 2050, 300, 400, 400, 450, 450, 800, 900, 1400,
    1550, 1900, 1800, 2000, 1450, 1450, 1450, 1450, 800, 800, 800, 800, 800, 800, 1450, 1450,
    1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450,
    1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1500, 1450, 1500,
    900, 1500, 1500, 1500, 1500, 1500, 1500, 1450, 1450, 1450, 600, 1500, 80, 60, 500, 200,
    200, 1800, 10, 10, 30, 200, 10, 100, 1450, 1500, 0, 1450, 1450, 1450, 1450, 1450,
    1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 2200,
    1450, 1450, 1450, 1800, 1450, 1450, 1450, 4500, 1900, 4500, 1450, 1450, 750, 1450, 1450, 2250,
    1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450,
];

// C ref: include/monsters.h SIZ() nutrition field (cnutrit) — the base
// nutrition of a corpse of this species (eat.c obj_nutrition() for a CORPSE,
// which sets otmp->oeaten before the per-bite lesshungry() delivery).  Indexed
// by pmidx; extracted verbatim from the MON()/SIZ() entries in monsters.h.
const MON_CNUTRIT = [
    10, 5, 5, 10, 50, 5, 10, 100, 150, 10, 30, 30, 250, 250, 250, 250,
    150, 200, 200, 250, 250, 250, 200, 350, 300, 200, 300, 10, 10, 10, 10, 10,
    150, 200, 300, 300, 300, 250, 300, 400, 20, 200, 300, 200, 300, 250, 300, 300,
    400, 400, 100, 100, 10, 100, 200, 200, 20, 20, 20, 100, 150, 200, 150, 30,
    200, 400, 500, 300, 300, 300, 100, 200, 150, 200, 200, 300, 300, 350, 200, 300,
    300, 100, 500, 500, 500, 650, 800, 800, 12, 30, 5, 30, 30, 30, 50, 50,
    100, 100, 350, 350, 250, 300, 300, 300, 300, 350, 0, 0, 0, 0, 0, 0,
    250, 250, 500, 700, 10, 300, 0, 0, 600, 400, 400, 400, 400, 400, 20, 30,
    20, 20, 500, 600, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 1500,
    1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 400, 0, 0, 0, 0, 200, 30,
    30, 30, 30, 100, 100, 100, 120, 120, 150, 750, 750, 700, 750, 750, 500, 750,
    900, 700, 600, 200, 200, 200, 200, 100, 100, 100, 100, 50, 50, 75, 150, 175,
    200, 250, 375, 100, 100, 100, 100, 400, 400, 400, 400, 500, 700, 750, 250, 250,
    150, 250, 20, 20, 250, 200, 60, 80, 80, 100, 60, 100, 350, 300, 300, 350,
    400, 500, 400, 400, 400, 0, 0, 0, 700, 50, 500, 700, 700, 550, 750, 50,
    50, 75, 150, 175, 200, 250, 50, 375, 5, 0, 0, 0, 0, 0, 0, 600,
    0, 0, 0, 0, 400, 400, 400, 400, 350, 350, 350, 350, 350, 350, 400, 400,
    400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 0,
    0, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 0,
    500, 500, 500, 500, 500, 500, 500, 1, 1, 1, 300, 400, 20, 30, 350, 250,
    250, 1000, 20, 20, 30, 200, 40, 100, 400, 400, 0, 400, 400, 400, 400, 400,
    400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 700,
    400, 400, 400, 550, 400, 400, 400, 1700, 700, 1600, 400,
    400, 350, 400, 400, 850, 400, 400, 400, 400, 400, 400,
    400, 400, 400, 400, 400, 400, 400, 400, 400,
];

// C ref: include/monsters.h SIZ() body-size field (MZ_*).  MZ_TINY=0 (this set
// is a superset of VERYSMALL, which only covers the species used by mkobj.js's
// STATUE spellbook test), MZ_SMALL=1, MZ_MEDIUM/MZ_HUMAN=2, MZ_LARGE=3,
// MZ_HUGE=4, MZ_GIGANTIC=7.  Used by mkobj.c weight()'s STATUE minimum-weight
// floor.  Indexed by pmidx.
const MON_MSIZE = [
    0, 0, 0, 0, 3, 0, 0, 1, 3, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 1, 2,
    3, 1, 2, 1, 1, 1, 1, 1, 1, 1, 3, 1, 3, 1, 3, 3, 1, 2, 2, 1, 2, 3, 2, 2,
    2, 2, 1, 0, 0, 2, 1, 1, 2, 2, 2, 1, 1, 1, 1, 0, 2, 3, 3, 2, 2, 2, 1, 2,
    2, 2, 2, 2, 2, 2, 1, 2, 2, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0, 0, 1, 1, 0, 0,
    3, 1, 4, 4, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 3, 3, 7, 7, 0, 0, 1, 1,
    3, 3, 2, 2, 3, 3, 0, 1, 1, 1, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 3, 4, 4, 4, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2,
    2, 4, 4, 3, 3, 3, 3, 4, 4, 4, 4, 3, 3, 3, 2, 2, 3, 3, 2, 2, 2, 3, 0, 1,
    1, 3, 2, 2, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 1, 3, 3, 3, 3, 3, 1,
    1, 2, 2, 2, 2, 4, 1, 4, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 2, 3, 3, 3, 4, 4, 2, 3, 4, 4, 2,
    2, 2, 2, 2, 1, 1, 3, 4, 4, 4, 0, 0, 0, 2, 0, 0, 3, 2, 0, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 4, 2, 3, 2, 7,
    4, 7, 2, 3, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
];

// C ref: include/monsters.h MON() mflags3 field (the third M-flag group),
// indexed by pmidx.  Extracted from monsters.h by matching each MON()/MONS()
// block's (neutral) name against MONS_NAMES and validated against the ported
// mlevel/maligntyp/difficulty tuple for every entry.  Only the two infravision
// bits (M3_INFRAVISION 0x100 / M3_INFRAVISIBLE 0x200) currently have consumers
// (display.c see_with_infrared / newsym), but the whole field is kept so other
// M3_* flags (COVETOUS, WAITMASK, DISPLACES, WANTS*) can be read later.
const MFLAGS3 = [
    0, 0, 0, 512, 0, 0, 0, 0, 0, 512, 512, 512,
    512, 512, 512, 512, 512, 512, 512, 512, 512, 512, 0, 512,
    0, 512, 512, 0, 512, 512, 512, 512, 768, 768, 768, 768,
    768, 768, 768, 1792, 512, 0, 0, 768, 768, 768, 768, 768,
    768, 768, 768, 768, 768, 768, 768, 768, 0, 0, 0, 768,
    768, 768, 768, 512, 0, 0, 0, 512, 512, 512, 768, 768,
    768, 768, 768, 768, 768, 768, 0, 0, 0, 512, 512, 512,
    512, 512, 512, 512, 512, 512, 512, 512, 512, 512, 0, 0,
    0, 0, 0, 0, 512, 512, 512, 512, 512, 512, 0, 0,
    512, 0, 512, 512, 0, 0, 0, 0, 512, 512, 512, 0,
    512, 768, 768, 768, 768, 768, 512, 512, 512, 512, 512, 512,
    512, 0, 512, 0, 512, 0, 0, 0, 0, 0, 0, 0,
    512, 0, 768, 0, 0, 0, 0, 0, 0, 256, 0, 512,
    0, 0, 0, 0, 0, 0, 512, 0, 0, 768, 768, 768,
    768, 768, 768, 768, 768, 768, 768, 768, 768, 768, 512, 512,
    512, 512, 512, 256, 256, 260, 260, 256, 256, 256, 256, 256,
    256, 256, 256, 512, 0, 0, 0, 512, 0, 0, 0, 768,
    768, 768, 0, 0, 0, 0, 512, 512, 512, 512, 0, 0,
    0, 256, 256, 0, 768, 768, 768, 768, 768, 512, 512, 512,
    584, 0, 0, 0, 0, 512, 512, 512, 512, 512, 512, 256,
    256, 256, 256, 256, 256, 256, 256, 256, 256, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 512, 512, 512, 512,
    768, 768, 768, 768, 768, 768, 512, 512, 512, 640, 512, 512,
    512, 512, 512, 512, 512, 512, 512, 512, 576, 607, 512, 256,
    256, 768, 768, 768, 768, 768, 768, 768, 768, 768, 768, 768,
    768, 768, 768, 321, 769, 837, 769, 769, 833, 833, 769, 1792,
    1792, 1792, 768, 512, 0, 0, 0, 512, 512, 512, 0, 0,
    0, 0, 0, 0, 0, 512, 0, 512, 512, 512, 512, 512,
    512, 512, 512, 512, 512, 512, 512, 512, 640, 640, 640, 640,
    640, 640, 640, 896, 640, 640, 640, 640, 640, 848, 592, 848,
    848, 592, 592, 848, 80, 592, 592, 848, 592, 512, 512, 512,
    512, 512, 512, 512, 768, 512, 512, 512, 512, 512, 512,
];

// C ref: include/monflag.h — the M3_* infravision bits.
export const M3_INFRAVISION = 0x0100;  /* has infravision */
export const M3_INFRAVISIBLE = 0x0200; /* visible by infravision */

// C ref: include/monflag.h M1_POIS ("poisonous to eat") / M1_ACID ("acidic to
// eat"), indexed by pmidx.  Extracted verbatim from the flg1 field of every
// MON() entry in include/monsters.h (positional — same order as MONS_NAMES).
// Consumed by eat.c eatcorpse()'s poisonous()/acidic() macros; previously
// eat.js approximated this with a hand-picked species-name set that missed
// ordinary poisonous vermin (e.g. plain kobolds).
const MPOIS = [
    0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
    0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
    0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1,
    0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
const MACID = [
    0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
    0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
    1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

const MONS = MONS_RAW.map((t) => ({
    pmidx: t[0],
    name: MONS_NAMES[t[0]],
    mcls: t[1],                  // numeric S_* class index
    mlet: SYM_CHAR[t[1]] || '?', // display symbol character
    mlevel: t[2],
    maligntyp: t[3],
    geno: t[4],
    mresists: t[5],
    gcode: t[6],                 // 0 femaleok, 1 male, 2 female, 3 neuter
    gender: GENDER_STR[t[6]],    // string form for external consumers
    difficulty: t[7],
    mcolor: t[8],
    mflags3: MFLAGS3[t[0]] ?? 0, // C include/monsters.h MON() flg3 group
    ac: MON_AC[t[0]] ?? 10,      // C LVL() base armour class (find_mac)
    cwt: MON_CWT[t[0]],          // C SIZ() corpse weight (mkobj weight())
    cnutrit: MON_CNUTRIT[t[0]] ?? 0, // C SIZ() corpse nutrition (eat.c)
    msize: MON_MSIZE[t[0]],      // C SIZ() body size MZ_* (mkobj weight())
    verysmall: VERYSMALL.has(t[0]), // MZ_TINY -> true (used by mkobj.js)
    carnivore: ((MFOOD[t[0]] ?? 0) & 1) !== 0, // M1_CARNIVORE
    herbivore: ((MFOOD[t[0]] ?? 0) & 2) !== 0, // M1_HERBIVORE
    poisonous: !!MPOIS[t[0]],    // C mondata.h poisonous() = mflags1 & M1_POIS
    acidic: !!MACID[t[0]],       // C mondata.h acidic() = mflags1 & M1_ACID
}));

export function monster_by_pmidx(pmidx) {
    return MONS[pmidx] ?? null;
}

// C ref: include/mondata.h infravisible(ptr) = (mflags3 & M3_INFRAVISIBLE) —
// TRUE when the creature is warm/visible to heat vision.  `ptr` is a MONS
// record (mon.data).
export function infravisible(ptr) {
    return !!(ptr && (ptr.mflags3 & M3_INFRAVISIBLE));
}

// C ref: include/mondata.h infravision(ptr) = (mflags3 & M3_INFRAVISION) —
// TRUE when the creature itself possesses infravision.  Used for the hero via
// mons[urace.mnum] (polyself.c set_uasmon), and for monsters generally.
export function infravision(ptr) {
    return !!(ptr && (ptr.mflags3 & M3_INFRAVISION));
}

// C ref: include/monflag.h M3_COVETOUS (0x1f) = WANTSAMUL|WANTSBELL|WANTSBOOK
// |WANTSCAND|WANTSARTI ("wants something"); include/mondata.h is_covetous(ptr)
// = (mflags3 & M3_COVETOUS).  A covetous monster (Vlad wants the Candelabrum,
// the Wizard wants the Amulet, &c) bypasses a level's noteleport restriction.
const M3_COVETOUS = 0x001f;
export function is_covetous(ptr) {
    return !!(ptr && (ptr.mflags3 & M3_COVETOUS));
}

// C ref: monsters.h NAMS(male, female, neutral) — the 15 species that carry a
// gendered name pair alongside their neutral one.  mons[].pmnames[] holds all
// three, and every by-name lookup (sp_lev.c's lspo_object montype scan,
// do_name.c name_to_monplus) matches ANY of them, so a level file may equally
// say montype="caveman", "cavewoman" or "cave dweller".  Keyed by the neutral
// name, which is what MONS_NAMES stores.
const MONS_GENDERED_NAMES = [
    ['dwarf leader',      'dwarf lord',        'dwarf lady'],
    ['dwarf ruler',       'dwarf king',        'dwarf queen'],
    ['kobold leader',     'kobold lord',       'kobold lady'],
    ['gnome leader',      'gnome lord',        'gnome lady'],
    ['gnome ruler',       'gnome king',        'gnome queen'],
    ['ogre leader',       'ogre lord',         'ogre lady'],
    ['ogre tyrant',       'ogre king',         'ogre queen'],
    ['vampire leader',    'vampire lord',      'vampire lady'],
    ['elf-noble',         'elf-lord',          'elf-lady'],
    ['elven monarch',     'Elvenking',         'Elvenqueen'],
    ['aligned cleric',    'priest',            'priestess'],
    ['high cleric',       'high priest',       'high priestess'],
    ['amorous demon',     'incubus',           'succubus'],
    ['cave dweller',      'caveman',           'cavewoman'],
    ['cleric',            'priest',            'priestess'],
];
const _GENDERED_BY_NEUTRAL = new Map(
    MONS_GENDERED_NAMES.map(([n, ma, f]) => [n, [ma, f]]));

// C ref: sp_lev.c lspo_object montype scan / do_name.c name_to_monplus — find a
// monster by name, returning its pmidx or NON_PM (-1).  C walks mons[] in index
// order testing pmnames[NEUTRAL], then [MALE], then [FEMALE], and takes the
// first hit; building the map in that same order (first insertion wins) gives
// the same answer for the names two species share ("priest" -> aligned cleric,
// not the player-monster cleric).
const _NAME_TO_PMIDX = (() => {
    const m = new Map();
    for (const mon of MONS) {
        if (!mon.name) continue;
        if (!m.has(mon.name)) m.set(mon.name, mon.pmidx);
        for (const alias of _GENDERED_BY_NEUTRAL.get(mon.name) || [])
            if (alias && !m.has(alias)) m.set(alias, mon.pmidx);
    }
    return m;
})();
// C ref: do_name.c pmname(pm, mgender) — mons[].pmnames[MALE|FEMALE], falling
// back to pmnames[NEUTRAL] (which is what MONS_NAMES stores) for the species
// that carry no gendered pair.  Exported for botl.c's polymorphed status title.
export function pmname_of_pmidx(pmidx, female) {
    const m = MONS[pmidx];
    if (!m) return 'monster';
    const pair = _GENDERED_BY_NEUTRAL.get(m.name);
    return (pair && pair[female ? 1 : 0]) || m.name;
}
export function name_to_pmidx(name) {
    const v = _NAME_TO_PMIDX.get(name);
    return v == null ? -1 : v;
}

// C ref: include/monflag.h enum mgender { MALE, FEMALE, NEUTRAL }.
export const MGEND_MALE = 0, MGEND_FEMALE = 1, MGEND_NEUTRAL = 2;

// C ref: mondata.c name_to_monplus()'s `matchgend` — which pmnames[] SLOT the
// name matched.  monst.c NAM(name) fills only pmnames[NEUTRAL], so a plain
// species name answers NEUTRAL; a NAMS(m,f,n) monster addressed by its male or
// female form answers that gender.  sp_lev.c find_montype() then SKIPS its
// rn2(2) gender roll for a gendered name — so `des.monster("vampire lord",...)`
// draws one fewer random number than `des.monster("giant zombie",...)`.
const _NAME_GENDER = (() => {
    const m = new Map();
    for (const [, male, female] of MONS_GENDERED_NAMES) {
        if (male && !m.has(male)) m.set(male, MGEND_MALE);
        if (female && !m.has(female)) m.set(female, MGEND_FEMALE);
    }
    return m;
})();
export function name_gender_hint(name) {
    const v = _NAME_GENDER.get(name);
    return v == null ? MGEND_NEUTRAL : v;
}

// C ref: dungeon.c level_difficulty() — exported for themed-room fills that
// branch on difficulty (themerms.lua nh.level_difficulty()).
export function level_difficulty_ext() {
    return level_difficulty();
}

// C ref: monsters.h SIZ(wt, nutr, ...) — the per-monster corpse weight (cwt)
// and body size (msize, MZ_*).  mkobj.c weight() uses these for CORPSE and
// STATUE objects.  The full mons[] cwt/msize column is large and only matters
// for the rare floor corpse/statue; we expose accessors here so weight() can
// use real values where known and fall back (to the base statue weight) where
// the species isn't in the slice.  Returns undefined when unavailable.
export function mon_cwt(pmidx) {
    const m = MONS[pmidx];
    return m && m.cwt != null ? m.cwt : undefined;
}
// C ref: mons[pmidx].cnutrit — a corpse's base nutrition (eat.c obj_nutrition).
export function mon_cnutrit(pmidx) {
    const m = MONS[pmidx];
    return m && m.cnutrit != null ? m.cnutrit : 0;
}
export function mon_msize(pmidx) {
    const m = MONS[pmidx];
    return m && m.msize != null ? m.msize : undefined;
}

// ------- per-monster data needed by egg / tin / corpse generation -------
// (ported from include/monsters.h MON() entries: M1_OVIPAROUS bit and the
//  SIZ() cnutrit field; from src/mondata.c grownups[]; from src/mon.c
//  undead_to_corpse()).  All indexed by pmidx.

// PM_* index constants referenced by can_be_hatched().
const PM_KILLER_BEE = 1;
const PM_QUEEN_BEE = 5;
const PM_GARGOYLE = 41;
const PM_WINGED_GARGOYLE = 42;
const PM_SCORPION = 97;
const PM_SCORPIUS = 364;

// lays_eggs() reads M1_OVIPAROUS off the generated mflags1 table.  The old
// hand-transcribed pmidx Set was never put through the mail-daemon (+1 from
// pmidx 315) shift, so it named jellyfish/chameleon/Nalzok as egg-layers and
// missed electric eel/crocodile/Scorpius.


// grownups[] little -> big progression (src/mondata.c), as pmidx pairs.
const GROWNUPS_LITTLE_TO_BIG = new Map([
    [9, 10], [16, 18], [18, 19], [25, 26], [22, 24], [32, 33], [33, 37],
    [100, 104], [104, 105], [59, 60], [60, 61], [165, 166], [166, 168], [44, 46],
    [46, 47], [48, 49], [72, 77], [73, 77], [74, 77], [75, 77], [88, 89],
    [94, 96], [203, 204], [204, 205], [264, 268], [265, 268], [266, 268], [267, 268],
    [268, 269], [183, 184], [184, 185], [185, 186], [226, 227], [126, 127], [133, 143],
    [134, 144], [135, 145], [136, 146], [137, 147], [138, 148], [139, 149], [140, 150],
    [141, 151], [142, 152], [195, 199], [196, 200], [197, 201], [198, 202], [64, 65],
    [65, 66], [112, 114], [113, 115], [325, 328], [277, 278], [278, 280], [280, 281],
    [282, 283], [275, 276], [369, 331], [372, 334], [373, 335], [375, 337], [382, 343],
    [50, 53], [179, 180], [180, 181], [181, 182],
]);

// undead_to_corpse() mapping (src/mon.c): undead pmidx -> living species pmidx.
const UNDEAD_TO_CORPSE = new Map([
    [187, 59], [188, 165], [189, 72], [190, 44], [191, 264], [192, 260],
    [193, 174], [194, 169], [226, 260], [227, 260], [239, 59], [240, 165],
    [241, 72], [242, 44], [243, 264], [244, 260], [245, 174], [247, 169],
]);

// C ref: mondata.c little_to_big() — first matching grownups[] little form.
function little_to_big(mndx) {
    return GROWNUPS_LITTLE_TO_BIG.has(mndx)
        ? GROWNUPS_LITTLE_TO_BIG.get(mndx) : mndx;
}

// C ref: mondata.c big_to_little() — reverse lookup (first little whose big
// matches).  grownups[] order is preserved so the first match wins, mirroring
// the C linear scan.
function big_to_little(mndx) {
    for (const [little, big] of GROWNUPS_LITTLE_TO_BIG)
        if (big === mndx) return little;
    return mndx;
}

function lays_eggs(mndx) {
    return ((MFLAGS1[mndx] || 0) & M1_OVIPAROUS) !== 0;
}

// C ref: mon.c undead_to_corpse() — convert undead pmidx to its living form.
export function undead_to_corpse(mndx) {
    return UNDEAD_TO_CORPSE.has(mndx) ? UNDEAD_TO_CORPSE.get(mndx) : mndx;
}

// C ref: mon.c can_be_hatched() (with BREEDER_EGG == !rn2(77)).  Returns the
// pmidx to use as the egg's corpsenm, or NON_PM if it can't be hatched.  The
// rn2(77) BREEDER_EGG draw is only evaluated when lays_eggs() is true and the
// monster isn't a killer bee / gargoyle (C `||` short-circuit), so the RNG
// side-effect matches C exactly.
export function can_be_hatched(mnum) {
    if (mnum === PM_SCORPIUS) mnum = PM_SCORPION;
    mnum = little_to_big(mnum);
    if (mnum === PM_KILLER_BEE || mnum === PM_GARGOYLE)
        return mnum;
    if (lays_eggs(mnum)) {
        const breeder = (rn2(77) === 0);
        if (breeder || (mnum !== PM_QUEEN_BEE && mnum !== PM_WINGED_GARGOYLE))
            return mnum;
    }
    return NON_PM;
}

// C ref: mon.c dead_species() — egg/tin viability.  At level generation no
// monster has been genocided (mvflags G_GENOD == 0), so this reduces to the
// LOW_PM bounds check; we honour mvflags when present for completeness.
export function dead_species(m_idx, egg) {
    if (m_idx < 0) return true; // m_idx < LOW_PM (generic egg -> unhatchable)
    const altIdx = egg ? big_to_little(m_idx) : m_idx;
    return ((mvflags(m_idx) & G_GENOD) !== 0)
        || ((mvflags(altIdx) & G_GENOD) !== 0);
}

// C ref: a monster's corpse nutrition (mons[mndx].cnutrit).  Returns truthy
// when the species yields a nourishing corpse (used by tin generation).
export function mon_has_cnutrit(mndx) {
    return (MON_CNUTRIT[mndx] ?? 0) !== 0;
}

// G_NOCORPSE flag for a monster (mons[mndx].geno & G_NOCORPSE).
export function mon_nocorpse(mndx) {
    return (MONS[mndx]?.geno & G_NOCORPSE) !== 0;
}

// C ref: dungeon.c level_difficulty() — depth(&u.uz), plus a compensating
// bump in a "builds up" branch (Vlad's Tower, Sokoban): depth() alone would
// make the harder-to-reach levels there look easier since their dlevel counts
// down as you climb, so add 2 per level of extra effort spent reaching them.
function level_difficulty() { return level_difficulty_c(); }

function monmin_difficulty(levdif) {
    return Math.trunc(levdif / 6);
}

function monmax_difficulty(levdif) {
    return Math.trunc((levdif + (game.u?.ulevel || 1)) / 2);
}

function montooweak(mndx, lev) {
    return MONS[mndx].difficulty < lev;
}

function montoostrong(mndx, lev) {
    return MONS[mndx].difficulty > lev;
}

// C ref: dungeon.h Inhell == In_hell(&u.uz) == dungeons[u.uz.dnum].flags.hellish.
// The dungeon NUMBER is not a fixed constant — it comes out of dungeon.lua's
// order at init_dungeons() time — so the flag has to be read off the dungeon.
function Inhell() {
    return In_hell(game.u?.uz);
}

function mvflags(mndx) {
    return game.mvitals?.[mndx]?.mvflags ?? 0;
}

function uncommon(mndx) {
    const ptr = MONS[mndx];
    if (ptr.geno & (G_NOGEN | G_UNIQ)) return true;
    if (mvflags(mndx) & G_GONE) return true;
    if (Inhell()) return ptr.maligntyp > A_NEUTRAL;
    return !!(ptr.geno & G_HELL);
}

function dungeon_alignment() {
    const dnum = game.u?.uz?.dnum ?? 0;
    const dlevel = game.u?.uz?.dlevel ?? 1;
    // C ref: makemon.c align_shift() — uses Is_special(&u.uz)->flags.align if
    // the position is a named special level (e.g. Oracle = neutral), else the
    // dungeon's own align.  Is_special is backed by sp_levchn.
    //
    // The Is_special() lookup is CACHED BEHIND A STATIC in C:
    //     static long oldmoves = 0L;  static s_level *lev;
    //     if (oldmoves != svm.moves) { lev = Is_special(&u.uz); oldmoves = svm.moves; }
    // so a level entered WITHIN a move (level teleport, trapdoor) keeps the
    // PREVIOUS level's s_level until the turn counter next ticks, and the
    // switch then falls through to the dungeon's own align.  Computing it fresh
    // gave chaotic Medusa's weights to a scan C ran unaligned: every
    // rn2(totalweight) modulus in rndmonst_adj came out too large (seed0360
    // step 290).  dnum below is read live, exactly as C reads u.uz.dnum.
    const moves = game.moves ?? 1;
    if (game._align_shift_moves !== moves) {
        game._align_shift_moves = moves;
        game._align_shift_lev = (game.sp_levchn || []).find(
            (l) => l?.dlevel?.dnum === dnum && l?.dlevel?.dlevel === dlevel) || null;
    }
    const slev = game._align_shift_lev;
    // An s_level's flags.align is ALREADY an AM_* mask (dungeon.c stores
    // `(tlevel.flags & D_ALIGN_MASK) >> 4`), so it must NOT be run through the
    // A_* aliases below: AM_CHAOTIC (1) == A_LAWFUL (1), which made every
    // chaotic special level (medusa, Vlad's Tower, tutorial) weight its random
    // monster table as if the level were lawful.
    if (slev && slev.flags && slev.flags.align) {
        const am = slev.flags.align;
        return (am === AM_LAWFUL || am === AM_NEUTRAL || am === AM_CHAOTIC)
            ? am : AM_NONE;
    }
    // C's fallback is `svd.dungeons[u.uz.dnum].flags.align` alone — no second,
    // uncached special-level lookup (game.special_levels does not exist anyway).
    //
    // dungeon.h d_flags packs `align` as a 3-bit field starting at bit 4, and
    // UNCONNECTED is 0x10 — the SAME bit as AM_CHAOTIC's.  C therefore reads
    // any "unconnected" dungeon (the tutorial) back as chaotic; our parser
    // splits the two fields, so re-apply the overlap here or the tutorial's
    // rndmonst weights lose their alignment shift entirely.
    const dgnflags = game.dungeons?.[dnum]?.flags;
    if (dgnflags) {
        const am = (((dgnflags.align | 0) | (dgnflags.unconnected ? AM_CHAOTIC : 0)) & 7);
        return (am === AM_LAWFUL || am === AM_NEUTRAL || am === AM_CHAOTIC)
            ? am : AM_NONE;
    }
    const raw = DUNGEON_ALIGN_BY_DNUM[dnum] ?? A_NONE;

    if (raw === AM_NONE || raw === A_NONE) return AM_NONE;
    if (raw === AM_LAWFUL || raw === A_LAWFUL) return AM_LAWFUL;
    if (raw === AM_NEUTRAL || raw === A_NEUTRAL) return AM_NEUTRAL;
    if (raw === AM_CHAOTIC || raw === A_CHAOTIC) return AM_CHAOTIC;
    return AM_NONE;
}

function align_shift(ptr) {
    switch (dungeon_alignment()) {
    default:
    case AM_NONE:
        return 0;
    case AM_LAWFUL:
        return Math.trunc((ptr.maligntyp + 20) / (2 * ALIGNWEIGHT));
    case AM_NEUTRAL:
        return Math.trunc((20 - Math.abs(ptr.maligntyp)) / ALIGNWEIGHT);
    case AM_CHAOTIC:
        return Math.trunc((-(ptr.maligntyp - 20)) / (2 * ALIGNWEIGHT));
    }
}

function temperature_shift(ptr) {
    const temperature = game.level?.flags?.temperature ?? 0;
    if (temperature && (ptr.mresists & (temperature > 0 ? MR_FIRE : MR_COLD)))
        return 3;
    return 0;
}

// C ref: makemon.c:56 wrong_elem_type() — "true if the given monster cannot
// exist on this elemental level".  Only consulted when rndmonst_adj()'s
// `elemlevel` is set (In_endgame && !Is_astralevel), where returning a blanket
// FALSE let every species into the weighted scan and so changed both the
// candidate set and the number of rn2(totalweight) draws.
const S_TRAPPER_CLS = 20, S_GHOST_CLS = 54;
function wrong_elem_type(ptr) {
    const uz = game.u?.uz;
    if (ptr.mcls === S_ELEMENTAL) {
        return !is_home_elemental(ptr);
    } else if (Is_earthlevel(uz)) {
        /* no restrictions */
    } else if (Is_waterlevel(uz)) {
        if (!is_swimmer_flag(ptr)) return true;
    } else if (Is_firelevel(uz)) {
        // C: pm_resistance(ptr, MR_FIRE) == (ptr->mresists & MR_FIRE)
        if (!((ptr.mresists ?? 0) & MR_FIRE)) return true;
    } else if (Is_airlevel(uz)) {
        // C ref: mondata.h is_whirly(ptr) = mlet == S_VORTEX || air elemental;
        // is_floater = S_EYE || S_LIGHT; noncorporeal = S_GHOST.
        const is_whirly = ptr.mcls === S_VORTEX_CLS
            || ptr.pmidx === PM_AIR_ELEMENTAL;
        const is_floater = ptr.mcls === S_EYE_CLS || ptr.mcls === S_LIGHT_CLS;
        if (!(is_flyer_flag(ptr) && ptr.mcls !== S_TRAPPER_CLS) && !is_floater
            && !amorphous_flag(ptr) && ptr.mcls !== S_GHOST_CLS && !is_whirly)
            return true;
    }
    return false;
}

function isupper_sym(ptr) {
    const c = ptr.mlet;
    return c >= 'A' && c <= 'Z';
}

// C ref: you.h struct Role enemy1num/enemy2num/enemy1sym/enemy2sym — the
// per-role table role.c bakes into gu.urole, keyed here by filecode.  A null
// numN is C's NON_PM ("no specific species for this slot, class only").
// symN is the S_* monster-class index (defsym.h).
const QT_ENEMY = {
    Arc: { num1: null, sym1: 45 /* S_SNAKE */, num2: 'human mummy', sym2: 39 /* S_MUMMY */ },
    Bar: { num1: 'ogre', sym1: 41 /* S_OGRE */, num2: 'troll', sym2: 46 /* S_TROLL */ },
    Cav: { num1: 'bugbear', sym1: 8 /* S_HUMANOID */, num2: 'hill giant', sym2: 34 /* S_GIANT */ },
    Hea: { num1: 'giant rat', sym1: 18 /* S_RODENT */, num2: 'snake', sym2: 51 /* S_YETI */ },
    Kni: { num1: 'quasit', sym1: 9 /* S_IMP */, num2: 'ochre jelly', sym2: 10 /* S_JELLY */ },
    Mon: { num1: 'earth elemental', sym1: 31 /* S_ELEMENTAL */, num2: 'xorn', sym2: 50 /* S_XORN */ },
    Pri: { num1: 'human zombie', sym1: 52 /* S_ZOMBIE */, num2: 'wraith', sym2: 49 /* S_WRAITH */ },
    Rog: { num1: 'leprechaun', sym1: 14 /* S_NYMPH */, num2: 'guardian naga', sym2: 40 /* S_NAGA */ },
    Ran: { num1: 'forest centaur', sym1: 29 /* S_CENTAUR */, num2: 'scorpion', sym2: 19 /* S_SPIDER */ },
    Sam: { num1: 'wolf', sym1: 4 /* S_DOG */, num2: 'stalker', sym2: 31 /* S_ELEMENTAL */ },
    Tou: { num1: 'giant spider', sym1: 19 /* S_SPIDER */, num2: 'forest centaur', sym2: 29 /* S_CENTAUR */ },
    Val: { num1: 'fire ant', sym1: 1 /* S_ANT */, num2: 'fire giant', sym2: 34 /* S_GIANT */ },
    Wiz: { num1: 'vampire bat', sym1: 28 /* S_BAT */, num2: 'xorn', sym2: 49 /* S_WRAITH */ },
};

// C ref: questpgr.c qt_montype() — the quest branch's random-fill substitute:
// a role-specific "enemy" monster (by species, falling back to its class)
// instead of a species out of the general table.
function qt_montype() {
    const enemy = QT_ENEMY[roles[game.initrole]?.filecode];
    if (!enemy) return null;
    if (rn2(5)) {
        const qpm = enemy.num1 != null ? name_to_pmidx(enemy.num1) : NON_PM;
        if (qpm !== NON_PM && rn2(5) && !(mvflags(qpm) & G_GENOD)) return MONS[qpm];
        return mkclass(enemy.sym1, 0);
    }
    const qpm = enemy.num2 != null ? name_to_pmidx(enemy.num2) : NON_PM;
    if (qpm !== NON_PM && rn2(5) && !(mvflags(qpm) & G_GENOD)) return MONS[qpm];
    return mkclass(enemy.sym2, 0);
}

// C ref: rndmonst_adj() (makemon.c:1658).  Weighted reservoir sampling over
// the full mons[] array (LOW_PM .. SPECIAL_PM).
// C ref: mondata.h is_ndemon(ptr) — a nameless (non-unique) major demon.
const S_DEMON_CLS = 56;
function is_ndemon_pm(ptr) {
    // C ref: mondata.h:138 — is_ndemon(ptr) is
    //     is_demon(ptr) && ((mflags2 & (M2_LORD | M2_PRINCE)) == 0)
    // i.e. an ORDINARY demon: one that is neither a demon lord nor a prince.
    // This used to test `!(geno & G_UNIQ)`, which is a different question
    // (uniquely-generated monsters) and gives the wrong answer for every named
    // demon that is not flagged unique.
    if (!ptr || !is_demon_flag(ptr)) return false;
    return (mflags2_of(ptr) & (M2_LORD | M2_PRINCE)) === 0;
}

// C ref: do_name.c ghostnames[] — 34 names, and rndghostname():
//   rn2(7) ? ROLL_FROM(ghostnames) : svp.plname
// so the rn2(7) is always drawn and an rn2(34) follows 6 times out of 7.
const GHOSTNAMES = [
    'Adri', 'Andries', 'Andreas', 'Bert', 'David', 'Dirk',
    'Emile', 'Frans', 'Fred', 'Greg', 'Hether', 'Jay',
    'John', 'Jon', 'Karnov', 'Kay', 'Kenny', 'Kevin',
    'Maud', 'Michiel', 'Mike', 'Peter', 'Robert', 'Ron',
    'Tom', 'Wilmar', 'Nick Danger', 'Phoenix', 'Jiro', 'Mizue',
    'Stephan', 'Lance Braccus', 'Shadowhawk', 'Murphy',
];
function rndghostname() {
    return rn2(7) ? GHOSTNAMES[rn2(GHOSTNAMES.length)] : (game.plname || '');
}

export function rndmonst_adj(minadj = 0, maxadj = 0) {
    // C ref: makemon.c:1666 — `if (u.uz.dnum == quest_dnum && rn2(7)
    // && (ptr = qt_montype()) != 0) return ptr;`.  rn2(7) is drawn only when
    // in the quest branch (short-circuit); when it (and qt_montype) succeed
    // the substitute is returned immediately, otherwise fall through to the
    // general weighted-table pick below exactly as C does.
    if (game.u?.uz?.dnum === game.quest_dnum && rn2(7)) {
        const pm = qt_montype();
        if (pm) return pm;
    }

    const zlevel = level_difficulty();
    const minmlev = monmin_difficulty(zlevel) + minadj;
    const maxmlev = monmax_difficulty(zlevel) + maxadj;
    const upper = Is_rogue_level(game.u?.uz);
    const elemlevel = In_endgame(game.u?.uz) && !Is_astralevel(game.u?.uz);
    const inhell = Inhell();

    let totalweight = 0;
    let selected_mndx = NON_PM;

    for (let mndx = 0; mndx < SPECIAL_PM; ++mndx) {
        const ptr = MONS[mndx];

        if (montooweak(mndx, minmlev) || montoostrong(mndx, maxmlev)) continue;
        if (upper && !isupper_sym(ptr)) continue;
        if (elemlevel && wrong_elem_type(ptr)) continue;
        if (uncommon(mndx)) continue;
        if (inhell && (ptr.geno & G_NOHELL)) continue;

        let weight = (ptr.geno & G_FREQ) + align_shift(ptr);
        weight += temperature_shift(ptr);
        if (weight < 0 || weight > 127) weight = 0;
        if (weight > 0) {
            totalweight += weight;
            if (rn2(totalweight) < weight)
                selected_mndx = mndx;
        }
    }

    if (selected_mndx === NON_PM || uncommon(selected_mndx)) {
        return null;
    }
    return MONS[selected_mndx];
}

export function rndmonst() {
    return rndmonst_adj(0, 0);
}

// ----- mkclass / mkclass_aligned (makemon.c:1870) -----------------------

// mongen_order / mclass_maxf, initialized once (init_mongen_order,
// makemon.c:1801).  mongen_order is mons[] indices sorted by mlet then
// difficulty (stable via the (difficulty | mlet<<8) sort key); mclass_maxf
// is the maximum G_FREQ value seen within each class.
let mongen_order = null;
let mclass_maxf = null;

function init_mongen_order() {
    if (mongen_order) return;
    mclass_maxf = new Array(MAXMCLASSES).fill(0);
    // C iterates LOW_PM..NUMMONS for mclass_maxf, then qsorts SPECIAL_PM
    // entries.  We mirror exactly: maxf over all NUMMONS, order over
    // SPECIAL_PM entries.
    for (let i = 0; i < MONS.length; i++) {
        const freq = MONS[i].geno & G_FREQ;
        const mcls = MONS[i].mcls;
        if (freq > mclass_maxf[mcls]) mclass_maxf[mcls] = freq;
    }
    const order = [];
    for (let i = 0; i < SPECIAL_PM; i++) order.push(i);
    // cmp_init_mongen_order: key = (difficulty | (mcls << 8)); qsort with
    // glibc-style comparison.  JS sort is not guaranteed stable across all
    // engines for >10 elements historically, but V8 (Node) uses TimSort which
    // IS stable; combined with the unique sort key being identical for equal
    // (mcls,difficulty) pairs, a stable sort reproduces qsort's relative
    // ordering for our parity needs (entries within the same class+difficulty
    // keep their mons[] order, matching C's qsort on this data).
    order.sort((a, b) => {
        const ka = (MONS[a].difficulty | (MONS[a].mcls << 8));
        const kb = (MONS[b].difficulty | (MONS[b].mcls << 8));
        if (ka !== kb) return ka - kb;
        return a - b; // tie-break by original index (stable)
    });
    mongen_order = order;
}

function is_placeholder(mndx) {
    return mndx === PM_ORC || mndx === PM_GIANT
        || mndx === PM_ELF || mndx === PM_HUMAN;
}

// C ref: mk_gen_ok() (makemon.c:1733).
function mk_gen_ok(mndx, mvflagsmask, genomask) {
    if (mvflags(mndx) & mvflagsmask) return false;
    if (MONS[mndx].geno & genomask) return false;
    if (is_placeholder(mndx)) return false;
    // MAIL_DAEMON exclusion is gated by MAIL_STRUCTURES, not defined here.
    return true;
}

function sgn(x) {
    return x > 0 ? 1 : (x < 0 ? -1 : 0);
}

// adj_lev() is used by mkclass_aligned's level skew; defined below.

export function mkclass(klass, spc) {
    return mkclass_aligned(klass, spc, A_NONE);
}

// C ref: mkclass_aligned() (makemon.c:1882).  `klass` is the S_* index.
export function mkclass_aligned(klass, spc, atyp = A_NONE) {
    init_mongen_order();
    const MONSi = (i) => mongen_order[i];

    const maxmlev = level_difficulty() >> 1;
    if (klass < 1 || klass >= MAXMCLASSES) {
        return null;
    }

    const zero_freq_for_entire_class = (mclass_maxf[klass] === 0);
    const gehennom = Inhell();

    let first;
    for (first = 0; first < SPECIAL_PM; first++)
        if (MONS[MONSi(first)].mcls === klass) break;
    if (first === SPECIAL_PM) {
        return null;
    }

    let mv_mask = G_GONE;
    if ((spc & G_IGNORE) !== 0) {
        mv_mask = 0;
        spc &= ~G_IGNORE;
    }

    const nums = new Array(SPECIAL_PM + 1).fill(0);
    let num = 0;
    let last;
    for (last = first; last < SPECIAL_PM && MONS[MONSi(last)].mcls === klass;
         last++) {
        if (atyp !== A_NONE && sgn(MONS[MONSi(last)].maligntyp) !== sgn(atyp))
            continue;
        let gn_mask = (G_NOGEN | G_UNIQ);
        if (rn2(9) || klass === S_LICH)
            gn_mask |= (gehennom ? G_NOHELL : G_HELL);
        gn_mask &= ~spc;

        if (mk_gen_ok(MONSi(last), mv_mask, gn_mask)) {
            if (num && montoostrong(MONSi(last), maxmlev)
                && MONS[MONSi(last)].difficulty > MONS[MONSi(last - 1)].difficulty
                && rn2(2))
                break;
            let k = MONS[MONSi(last)].geno & G_FREQ;
            if (k > 0 || (k = (zero_freq_for_entire_class ? 1 : 0)) > 0) {
                nums[MONSi(last)] = k + 1
                    - (adj_lev(MONS[MONSi(last)]) > ((game.u?.ulevel || 1) * 2) ? 1 : 0);
                num += nums[MONSi(last)];
            }
        }
    }
    if (!num) return null;

    for (num = rnd(num); first < last; first++)
        if ((num -= nums[MONSi(first)]) <= 0)
            break;

    return nums[MONSi(first)] ? MONS[MONSi(first)] : null;
}

// C ref: makemon.c:1542 mbirth_limit(mndx).  global.h:415 MAXMONNO 120.
const MAXMONNO = 120, PM_NAZGUL_JS = 231, PM_ERINYS_JS = 292;
function mbirth_limit(mndx) {
    return mndx === PM_NAZGUL_JS ? 9 : mndx === PM_ERINYS_JS ? 3 : MAXMONNO;
}

// C ref: makemon.c:958 propagate(mndx, tally, ghostly) — "once a certain number
// of monsters are created, don't create any more at random".  Every makemon()
// runs this; the port never did, so svm.mvitals[].born stayed 0 forever.  That
// is not cosmetic: potion.c:603 picks its modulus off it
// (POTION_OCCUPANT_CHANCE(mvitals[PM_GHOST].born) == 13 + 2*born), and
// uncommon() drops a species from rndmonst()'s weighted scan — changing the
// number of rn2(totalweight) draws — once it goes extinct.
const G_EXTINCT = 0x01;
export function propagate(mndx, tally, ghostly) {
    const lim = mbirth_limit(mndx);
    const mv = (game.mvitals = game.mvitals || []);
    const e = (mv[mndx] = mv[mndx] || { died: 0, born: 0, mvflags: 0 });
    const geno = MONS[mndx]?.geno ?? 0;
    const gone = (e.mvflags & G_GONE) !== 0;      /* geno'd | extinct */
    const result = ((e.born | 0) < lim && !gone);

    /* if it's unique, don't ever make it again */
    if ((geno & G_UNIQ) !== 0 && mndx !== PM_HIGH_CLERIC)
        e.mvflags |= G_EXTINCT;

    if ((e.born | 0) < 255 && tally && (!ghostly || result))
        e.born = (e.born | 0) + 1;
    if ((e.born | 0) >= lim && !(geno & G_NOGEN) && !(e.mvflags & G_EXTINCT))
        e.mvflags |= G_EXTINCT;
    return result;
}
const MM_NOCOUNTBIRTH = 0x00000004;
const MM_MINVIS = 0x00100000;   // hack.h:1168
const MS_BRIBE = 33;            // monflag.h:48
// C ref: mondata.h is_dprince(ptr) = is_demon(ptr) && (mflags2 & M2_PRINCE).
function is_dprince_pm(ptr) {
    return is_demon_flag(ptr) && (mflags2_of(ptr) & M2_PRINCE) !== 0;
}

// C ref: makemon.c:1251 `mtmp->m_id = next_ident()`.  next_ident() lives in
// mkobj.c and is shared between objects (o_id) and monsters (m_id): it returns
// the current svc.context.ident and then advances it by rnd(2).  We import the
// single shared implementation from mkobj.js (the previous local stub returned
// the rnd(2) increment itself, which produced wrong m_id values and never
// advanced the shared ident counter — same RNG draw, but inconsistent with C's
// interleaved o_id/m_id numbering).

// C ref: mongets() (makemon.c:2181). Creates obj via mksobj and gives it to
// mtmp, then applies the per-recipient fixups.
// C ref: makemon.c mongets() — exported for mkroom.c's fill_zoo(), which hands
// the throne room's monarch a mace.
export function mongets_pub(mtmp, otyp) { return mongets(mtmp, otyp); }

// C ref: mondata.h is_lminion(mon) = mon->isminion && EMIN(mon)->min_align
// == A_LAWFUL.
function is_lminion_mon(mtmp) {
    return !!(mtmp && mtmp.isminion && mtmp.emin
              && mtmp.emin.min_align === A_LAWFUL);
}
// C ref: mondata.h is_mplayer(ptr) = ptr >= &mons[PM_ARCHEOLOGIST]
// && ptr <= &mons[PM_WIZARD] — the player-monster block of mons[].
function is_mplayer_pm(ptr) {
    return !!ptr && ptr.pmidx >= PM_ARCHEOLOGIST_MON
        && ptr.pmidx <= PM_WIZARD_MON;
}
// C ref: objclass.h is_sword(obj) = oclass == WEAPON_CLASS
// && oc_skill in P_DAGGER..P_SABER (skills.h: 1..9).
const P_DAGGER = 1, P_SABER = 9, P_POLEARMS = 16;
function is_sword_obj(o) {
    const oc = objects[o?.otyp];
    return !!oc && oc.oclass === WEAPON_CLASS_MM
        && oc.oc_skill >= P_DAGGER && oc.oc_skill <= P_SABER;
}
const WEAPON_CLASS_MM = 2, ARMOR_CLASS_MM = 3;

function mongets(_mtmp, otyp) {
    if (!otyp) return null;
    const otmp = mksobj(otyp, true, false);
    // C ref: makemon.c:2188-2221 — the recipient-specific fixups.  Only the
    // is_mplayer sword arm draws (rn2(4)); the rest are state, but the flags
    // they write feed later predicates (blessed/cursed gates m_dowear's choice
    // and every "is it safe to wear" test) and the object's rendered name.
    if (otmp) {
        const ptr = _mtmp?.data;
        if (ptr && ptr.mcls === S_DEMON_CLS) {
            /* demons never get blessed objects */
            if (otmp.blessed) curse(otmp);
        } else if (is_lminion_mon(_mtmp)) {
            /* lawful minions don't get cursed, bad, or rusting objects */
            otmp.cursed = false;
            if ((otmp.spe ?? 0) < 0) otmp.spe = 0;
            otmp.oerodeproof = 1;
            otmp.oeroded = otmp.oeroded2 = 0;
        } else if (is_mplayer_pm(ptr) && is_sword_obj(otmp)) {
            otmp.spe = 3 + rn2(4);                        // makemon.c:2200
        }

        if (otmp.otyp === CANDELABRUM_OF_INVOCATION) {
            otmp.spe = 0;
            otmp.age = 0;
            otmp.lamplit = false;
            otmp.blessed = otmp.cursed = false;
        } else if (otmp.otyp === BELL_OF_OPENING_OTYP) {
            otmp.blessed = otmp.cursed = false;
        } else if (otmp.otyp === SPE_BOOK_OF_THE_DEAD_OTYP) {
            otmp.blessed = false;
            otmp.cursed = true;
        }

        /* leaders don't tolerate inferior quality battle gear */
        if (ptr && (mflags2_of(ptr) & M2_PRINCE)) {
            const oc = objects[otmp.otyp];
            if (oc?.oclass === WEAPON_CLASS_MM && (otmp.spe ?? 0) < 1)
                otmp.spe = 1;
            else if (oc?.oclass === ARMOR_CLASS_MM && (otmp.spe ?? 0) < 0)
                otmp.spe = 0;
        }
    }
    // C ref: mpickobj() adds the object to mtmp->minvent.  Track non-empty
    // inventory so the Big Room m_initinv gold uses d(ld, minvent?5:10), and
    // keep the object itself so it can be dropped (relobj) when the monster
    // dies (mon.c m_detach -> relobj drops mtmp->minvent onto the map).
    if (_mtmp) { _mtmp._hasinv = true; mpickobj(_mtmp, otmp); }
    return otmp;   // C mongets() returns the created obj (used by ARM_BONUS math)
}
const BELL_OF_OPENING_OTYP = 263, SPE_BOOK_OF_THE_DEAD_OTYP = 409;
// objects.h otyp for makemon.c:1373's Plane-of-Earth Wizard `mitem`.
const SPE_DIG_OTYP = 366;
// objects.h otyps for makemon.c:1377-1381's `mitem` chain.
const TWO_HANDED_SWORD_OTYP = 55, POT_SICKNESS_OTYP = 318;

function m_initthrow(_mtmp, otyp, oquan) {
    const otmp = mksobj(otyp, true, false);
    // C ref: makemon.c:153 otmp->quan = rn1(oquan, 3) = rn2(oquan) + 3.
    otmp.quan = rn2(oquan) + 3;
    otmp.owt = weight(otmp);
    if (_mtmp) { _mtmp._hasinv = true; mpickobj(_mtmp, otmp); }
}

// C ref: mkobj.c mpickobj() — add an object to a monster's minvent.  The full
// C routine merges stacks and tracks weapon wielding; for the death-drop use
// here we only need the object to live in mtmp.minvent so relobj() can release
// it.  Consumes no RNG.
export function mpickobj(mtmp, otmp) {
    if (!mtmp || !otmp) return;
    if (!mtmp.minvent) mtmp.minvent = [];
    otmp.where = 'minvent';
    otmp.ocarry = mtmp;
    mtmp.minvent.push(otmp);
}

// C ref: makemon.c golemhp(type) — fixed HP per golem species (no RNG).  pmidx
// 249..259 = straw,paper,rope,GOLD,LEATHER,wood,flesh,clay,stone,glass,iron
// (monsters.h order: gold golem precedes leather golem; the values below are
// right, an earlier comment listed the pair the other way round).
const GOLEM_HP = { 249: 20, 250: 20, 251: 30, 252: 60, 253: 40, 254: 50, 255: 40, 256: 70, 257: 100, 258: 80, 259: 120 };
export function golemhp_js(pmidx) { return GOLEM_HP[pmidx] || 0; }

// C ref: adj_lev() (makemon.c:2016). Adjusts a monster's level for the
// current depth and player level.
function adj_lev(ptr) {
    // C ref: makemon.c:2021 — the Wizard of Yendor does not scale with depth;
    // he gets one level per previous death instead.  Omitting the arm made his
    // level (and therefore newmonhp's d(m_lev, 8)) depend on the wrong inputs.
    if (ptr.pmidx === PM_WIZARD_OF_YENDOR_JS) {
        const tmpw = ptr.mlevel + (game.mvitals?.[PM_WIZARD_OF_YENDOR_JS]?.died ?? 0);
        return tmpw > 49 ? 49 : tmpw;
    }
    let tmp = ptr.mlevel;
    if (tmp > 49) return 50;

    let tmp2 = level_difficulty() - tmp;
    if (tmp2 < 0)
        tmp--;
    else
        tmp += Math.trunc(tmp2 / 5);

    tmp2 = (game.u?.ulevel || 1) - ptr.mlevel;
    if (tmp2 > 0)
        tmp += Math.trunc(tmp2 / 4);

    let upper = Math.trunc((3 * ptr.mlevel) / 2);
    if (upper > 49) upper = 49;
    return tmp > upper ? upper : (tmp > 0 ? tmp : 0);
}

// C ref: defsym.h MONSYM() — monster class indices.  Our permonst records carry
// the same numbering in .mcls.
const S_DRAGON = 30, S_ELEMENTAL = 31, S_GOLEM = 55;

// C ref: mondata.h is_rider(ptr) — the three Riders of the Apocalypse, compared
// by identity in C (&mons[PM_DEATH] etc.), so by pmidx here.
const PM_DEATH = name_to_pmidx('Death'),
    PM_FAMINE = name_to_pmidx('Famine'),
    PM_PESTILENCE = name_to_pmidx('Pestilence');
function is_rider(ptr) {
    return ptr.pmidx === PM_DEATH || ptr.pmidx === PM_FAMINE
        || ptr.pmidx === PM_PESTILENCE;
}

// C ref: monsters.h — PM_GRAY_DRAGON is the first ADULT dragon; every baby
// dragon sorts before it, which is exactly what newmonhp()'s
// `mndx >= PM_GRAY_DRAGON` test relies on.
const PM_GRAY_DRAGON = name_to_pmidx('gray dragon');

// C ref: makemon.c is_home_elemental() — an elemental standing on its own
// Elemental Plane.  The endgame is not reachable in the covered sessions, so
// all four predicates are false there; kept faithful for correctness.
const PM_AIR_ELEMENTAL = name_to_pmidx('air elemental'),
    PM_FIRE_ELEMENTAL = name_to_pmidx('fire elemental'),
    PM_EARTH_ELEMENTAL = name_to_pmidx('earth elemental'),
    PM_WATER_ELEMENTAL = name_to_pmidx('water elemental');
export function is_home_elemental(ptr) {
    if (ptr.mcls !== S_ELEMENTAL) return false;
    const uz = game.u?.uz;
    switch (ptr.pmidx) {
    case PM_AIR_ELEMENTAL: return Is_airlevel(uz);
    case PM_FIRE_ELEMENTAL: return Is_firelevel(uz);
    case PM_EARTH_ELEMENTAL: return Is_earthlevel(uz);
    case PM_WATER_ELEMENTAL: return Is_waterlevel(uz);
    default: return false;
    }
}

// C ref: newmonhp() (makemon.c:1012). Sets mon.m_lev / mhp / mhpmax and
// returns mhp.
export function newmonhp(mon) {
    const isMon = mon && mon.data !== undefined;
    const ptr = isMon ? mon.data : mon;
    const out = isMon ? mon : {};
    if (!ptr) return 0;

    // C: `int basehp = 0;` — only the branches that roll dice raise it, and the
    // "all 1s" bump below compares against it, so the no-roll branches (golem,
    // mlevel > 49) can never trigger that bump.
    let basehp = 0;
    out.m_lev = adj_lev(ptr);
    if (ptr.mcls === S_GOLEM) {
        // Golems have a fixed amount of HP, varying by golem type.  No RNG.
        out.mhpmax = out.mhp = golemhp_js(ptr.pmidx);
    } else if (is_rider(ptr)) {
        // Low HP but a high mlevel so they can still attack well.
        basehp = 10;
        out.mhpmax = out.mhp = d(basehp, 8);
    } else if (ptr.mlevel > 49) {
        // "Special" fixed-hp monster (the named demon lords): the hit points
        // are encoded in mlevel above the normal 1..49 range.
        out.mhpmax = out.mhp = 2 * (ptr.mlevel - 6);
        out.m_lev = Math.trunc(out.mhp / 4); // approximation
    } else if (ptr.mcls === S_DRAGON && ptr.pmidx >= PM_GRAY_DRAGON) {
        // Adult dragons: N*(4+rnd(4)) before the endgame, N*8 once there.
        basehp = out.m_lev; // not really applicable; isolates the cast
        out.mhpmax = out.mhp = In_endgame(game.u?.uz) ? (8 * basehp)
            : (4 * basehp + d(basehp, 4));
    } else if (!out.m_lev) {
        basehp = 1; // minimum is 1, increased to 2 below
        out.mhpmax = out.mhp = rnd(4);
    } else {
        basehp = out.m_lev; // minimum possible is one per level
        out.mhpmax = out.mhp = d(basehp, 8);
        if (is_home_elemental(ptr))
            out.mhpmax = (out.mhp *= 3); // leave 'basehp' as-is
    }

    // If d(X,8) rolled a 1 all X times, give a boost; most beneficial for level
    // 0 and level 1 monsters, making mhpmax and mhp always be at least 2.
    if (out.mhpmax === basehp) {
        out.mhpmax += 1;
        out.mhp = out.mhpmax;
    }
    return out.mhp;
}

// C ref: makemon.c m_initweap() S_ANGEL branch (makemon.c:330-360) — a humanoid
// angelic being gets minion gear built directly and handed over with mpickobj,
// bypassing mongets.  RNG order, exactly as the recorded C stream shows it:
//   rn2(3) weapon pick -> mksobj's next_ident -> rn2(20) artifact-promotion roll
//   -> rn2(4) enchantment -> rn2(4) shield pick -> mksobj's next_ident.
// Both rn2(20) and rn2(4) are the LEFT operand of an `||`, so each is always
// drawn even when is_lord(ptr) would have made the test true anyway.
function m_initweap_angel(mtmp, ptr) {
    // C ref: makemon.c:331 `if (humanoid(ptr))` — read M1_HUMANOID directly
    // rather than through a species-name stand-in.
    if (!humanoid_flag(ptr)) return;
    const is_lord = (mflags2_of(ptr) & M2_LORD) !== 0;

    const typ = rn2(3) ? W_LONG_SWORD : W_SILVER_MACE;          // makemon.c:333
    const nam = (typ === W_LONG_SWORD) ? 'Sunsword' : 'Demonbane';
    let otmp = mksobj(typ, false, false);
    // C: `if ((!rn2(20) || is_lord(ptr)) && sgn(...maligntyp) == A_LAWFUL)
    //      otmp = oname(otmp, nam, ONAME_RANDOM);`
    // A non-minion angel uses ptr->maligntyp (we do not model EMIN min_align).
    // Artifact promotion proper is not modelled — C's oname() only attaches the
    // name here and consumes no RNG, so recording the name is RNG-faithful.
    if ((!rn2(20) || is_lord) && Math.sign(ptr.maligntyp ?? 0) === A_LAWFUL)  // makemon.c:338
        otmp.oname = nam;
    bless(otmp);
    otmp.oerodeproof = true;
    // long sword ends up +0..+3, silver mace +3..+6 to offset being much weaker
    // against large opponents.
    otmp.spe = rn2(4);                                          // makemon.c:347
    if (typ === W_SILVER_MACE) otmp.spe += 3;
    mtmp._hasinv = true;
    mpickobj(mtmp, otmp);

    otmp = mksobj((!rn2(4) || is_lord) ? W_SHIELD_OF_REFLECTION                // makemon.c:352
                                       : W_LARGE_SHIELD, false, false);
    otmp.oerodeproof = true;
    otmp.spe = 0;
    mtmp._hasinv = true;
    mpickobj(mtmp, otmp);
}

// C ref: rnd_offensive_item() (muse.c:2035).  Returns the otyp of an offensive
// item for a monster, or 0 (STRANGE_OBJECT) when none.  Exclusion guard matches
// C (animal/exploding/mindless/ghost/Kop never get offensive gear).
function rnd_offensive_item(mtmp) {
    const ptr = mtmp?.data;
    if (!ptr || rnd_item_excluded(ptr)) return 0;
    const difficulty = ptr.difficulty ?? 0;
    if (difficulty > 7 && !rn2(35)) return /*WAN_DEATH*/ 433;
    const roll = rn2(9 - (difficulty < 4 ? 1 : 0) + 4 * (difficulty > 6 ? 1 : 0));
    switch (roll) {
    case 0:
        // C ref: muse.c:2050 — SCR_EARTH when the monster wears a hard helmet
        // or has no solid body.  which_armor(W_ARMH) is Null at creation time
        // (m_dowear runs after m_initweap), and noncorporeal() is S_GHOST which
        // the guard above already rejected, so the live part of the predicate
        // is amorphous/passes_walls/unsolid — true for puddings, xorns, air
        // elementals and every other non-solid armed species, all of which the
        // unconditional FALLTHROUGH handed a wand of striking instead.
        if (amorphous_flag(ptr) || passes_walls_flag(ptr) || unsolid_flag(ptr))
            return /*SCR_EARTH*/ 340;
        /* FALLTHROUGH */
    case 1: return /*WAN_STRIKING*/ 417;
    case 2: return /*POT_ACID*/ 320;
    case 3: return /*POT_CONFUSION*/ 299;
    case 4: return /*POT_BLINDNESS*/ 300;
    case 5: return /*POT_SLEEPING*/ 314;
    case 6: return /*POT_PARALYSIS*/ 301;
    case 7: case 8: return /*WAN_MAGIC_MISSILE*/ 429;
    case 9: return /*WAN_SLEEP*/ 432;
    case 10: return /*WAN_FIRE*/ 430;
    case 11: return /*WAN_COLD*/ 431;
    case 12: return /*WAN_LIGHTNING*/ 434;
    default: return 0;
    }
}

// ════════ Big-Room-only full monster inventory machinery ════════
// These run ONLY during Big Room generation (game._bigrm_gen), so they cannot
// affect the RNG stream of any other session's ordinary level generation.

// m_initweap object-type indices (mkobj.js OBJECT_DATA otyp column).
const W_BOULDER = 475, W_CLUB = 77, W_TWO_HANDED_SWORD = 55, W_BATTLE_AXE = 45,
    W_PARTISAN = 59, W_BEC_DE_CORBIN = 70, W_DAGGER = 34, W_KNIFE = 40,
    W_SPEAR = 27, W_SHORT_SWORD = 46, W_FLAIL = 81, W_MACE = 73,
    W_BROADSWORD = 52, W_LONG_SWORD = 54, W_SILVER_SABER = 51,
    W_SILVER_MACE = 74, W_LARGE_SHIELD = 156, W_SHIELD_OF_REFLECTION = 158,
    W_ELVEN_MITHRIL_COAT = 127, W_ELVEN_CLOAK = 139, W_ELVEN_LEATHER_HELM = 89,
    W_ELVEN_BOOTS = 169, W_ELVEN_DAGGER = 35, W_ELVEN_SHIELD = 153,
    W_ELVEN_SHORT_SWORD = 47, W_ELVEN_BOW = 84, W_ELVEN_ARROW = 19,
    W_ELVEN_BROADSWORD = 53, W_ELVEN_SPEAR = 28, W_PICK_AXE = 259,
    W_AXE = 44, W_DWARVISH_CLOAK = 141, W_DWARVISH_SHORT_SWORD = 49,
    W_DWARVISH_MATTOCK = 71, W_DWARVISH_SPEAR = 30, W_DWARVISH_ROUNDSHIELD = 157,
    W_DWARVISH_IRON_HELM = 91, W_DWARVISH_MITHRIL_COAT = 126, W_IRON_SHOES = 164,
    W_SLING = 87, W_FLINT = 473, W_ROCK = 474, W_CREAM_PIE = 287,
    W_RUBBER_HOSE = 78, W_ORCISH_HELM = 90, W_SCIMITAR = 50, W_ORCISH_SHIELD = 155,
    W_ORCISH_CHAIN_MAIL = 129, W_ORCISH_CLOAK = 140, W_ORCISH_SHORT_SWORD = 48,
    W_ORCISH_BOW = 85, W_ORCISH_ARROW = 20, W_URUK_HAI_SHIELD = 154,
    W_ORCISH_DAGGER = 36, W_CROSSBOW = 88, W_CROSSBOW_BOLT = 23, W_BOW = 83,
    W_ARROW = 18, W_LUCERN_HAMMER = 69, W_AKLYS = 80, W_RANSEUR = 60,
    W_GLAIVE = 62, W_SPETUM = 61, W_DART = 24,
    W_CHAIN_MAIL = 128, W_LEATHER_ARMOR = 134, W_LEATHER_JACKET = 135,
    W_LEATHER_CLOAK = 145, W_LEATHER_GLOVES = 159, W_LOW_BOOTS = 163,
    W_HIGH_BOOTS = 165, W_POT_HEALING = 307, W_SHURIKEN = 25,
    W_TRIDENT = 33, W_BULLWHIP = 82, W_WAN_DEATH = 433,
    W_WAN_STRIKING = 417,
    W_STILETTO = 41, W_CRYSTAL_BALL = 231;

// C ref: mon.c msound MS_GUARDIAN quest-guardian humans (G_NOGEN, so never
// randomly generated — only placed explicitly by a quest home level).
const GUARDIAN_WEAP_NAMES = new Set([
    'student', 'attendant', 'abbot', 'acolyte', 'guide', 'apprentice',
    'chieftain', 'page', 'roshi', 'warrior', 'hunter', 'thug', 'neanderthal',
]);

// PM_* indices in this build's JS mons[] (verified by name lookup).
// is_elf/is_dwarf/is_mercenary are M2_* flag tests in C (mondata.h); the index
// sets they replaced were incomplete (ELF_PM stopped one short of the elven
// monarch), so the flags are read directly now.
const PM_ELVEN_MONARCH_JS = 269, PM_NINJA_JS = 378, PM_SALAMANDER_JS = 329;
// makemon()'s minion block (makemon.c:1411); mons[] indices, name-verified.
const PM_ALIGNED_CLERIC = 275, PM_HIGH_CLERIC = 276, PM_ANGEL = 123;
const PM_MASTER_LICH_JS = 185, PM_ARCH_LICH_JS = 186;
const PM_ICE_DEVIL_JS = 298, PM_ASMODEUS_JS = 309;
const PM_WATCHMAN_JS = 282, PM_SOLDIER_JS = 277, PM_SERGEANT_JS = 278,
    PM_LIEUTENANT_JS = 280, PM_CAPTAIN_JS = 281, PM_WATCH_CAPTAIN_JS = 283;
const PM_GOBLIN_JS = 70, PM_ORC_SHAMAN_JS = 76, PM_ORC_CAPTAIN_JS = 77,
    PM_MORDOR_ORC_JS = 74, PM_URUK_HAI_JS = 75;
const FOREST_CENTAUR_PM = 131;

// C ref: mondata.h is_armed(ptr) == attacktype(ptr, AT_WEAP).  This was a
// species-NAME set, which cannot separate the monsters.h entries that share a
// name: it called the ANIMAL forms of werejackal/werewolf/wererat armed because
// their S_HUMAN namesakes are.  monattk_data is keyed by pmidx, so use it.
function is_armed_pm(pmidx, mcls, name) {
    return is_armed({ pmidx });
}

// C ref: mondata.h:121 strongmonst(ptr) == ((ptr->mflags2 & M2_STRONG) != 0).
// Was a giant/ogre/troll monster-class list, which answers FALSE for every
// other strong species (erinys, marilith, ettin-class demons, dragons...).
function strongmonst_js(ptr) {
    return (mflags2_of(ptr) & M2_STRONG) !== 0;
}

// Full C-faithful m_initweap for Big Room monsters.
// C ref: mondata.h is_lord/is_prince/extra_nasty (M2_LORD/M2_PRINCE/M2_NASTY),
// read straight off mflags2 (js/monflags_data.js).  bias = is_lord +
// is_prince*2 + extra_nasty.
function m_initweap_bias(ptr) {
    const f2 = mflags2_of(ptr);
    let bias = 0;
    if (f2 & M2_LORD) bias += 1;
    if (f2 & M2_PRINCE) bias += 2;
    if (f2 & M2_NASTY) bias += 1;
    return bias;
}

function m_initweap_full(mtmp) {
    const ptr = mtmp?.data;
    if (!ptr || Is_rogue_level(game.u?.uz)) return;
    const mm = ptr.pmidx, mcls = ptr.mcls;
    switch (mcls) {
    case 27: // S_ANGEL (makemon.c:330)
        m_initweap_angel(mtmp, ptr);
        break;
    case 34: // S_GIANT
        // C ref: makemon.c:181 — an ettin gets a CLUB, not a boulder, and is
        // excluded from the second draw entirely.  Both halves used to assume
        // "no PM_ETTIN in slice"; mons[] carries it (174), and giving it a
        // BOULDER swaps mksobj_init's ROCK_CLASS arm in for the WEAPON_CLASS
        // one (seed0360 step 211: rn2(11)/rn2(10) vs our rn2(5)/rn2(75)).
        if (rn2(2)) mongets(mtmp, (mm !== PM_ETTIN) ? W_BOULDER : W_CLUB);
        if ((mm !== PM_ETTIN) && !rn2(5))
            mongets(mtmp, rn2(2) ? W_TWO_HANDED_SWORD : W_BATTLE_AXE);
        break;
    case 53: // S_HUMAN
        if (mflags2_of(ptr) & M2_MERC) {   // C: is_mercenary(ptr)
            let w1 = 0, w2 = 0;
            switch (mm) {
            case PM_WATCHMAN_JS:
            case PM_SOLDIER_JS:
                if (!rn2(3)) {
                    // C ref: makemon.c:188 — `do { w1 = rn1(BEC_DE_CORBIN -
                    // PARTISAN + 1, PARTISAN); } while (objects[w1].oc_skill
                    // != P_POLEARMS);`  The port used to draw the rn1 and then
                    // discard it, handing every soldier a partisan.
                    do { w1 = rn2(W_BEC_DE_CORBIN - W_PARTISAN + 1) + W_PARTISAN; }
                    while (objects[w1]?.oc_skill !== P_POLEARMS);
                    w2 = rn2(2) ? W_DAGGER : W_KNIFE;
                } else w1 = rn2(2) ? W_SPEAR : W_SHORT_SWORD;
                break;
            case PM_SERGEANT_JS: w1 = rn2(2) ? W_FLAIL : W_MACE; break;
            case PM_LIEUTENANT_JS: w1 = rn2(2) ? W_BROADSWORD : W_LONG_SWORD; break;
            case PM_CAPTAIN_JS:
            case PM_WATCH_CAPTAIN_JS: w1 = rn2(2) ? W_LONG_SWORD : W_SILVER_SABER; break;
            default:
                if (!rn2(4)) w1 = W_DAGGER;
                if (!rn2(7)) w2 = W_SPEAR;
                break;
            }
            if (w1) mongets(mtmp, w1);
            if (!w2 && w1 !== W_DAGGER && !rn2(4)) w2 = W_KNIFE;
            if (w2) mongets(mtmp, w2);
        } else if (mflags2_of(ptr) & M2_ELF) {
            // C ref: makemon.c:216 `is_elf(ptr)` == (mflags2 & M2_ELF).  The
            // old ELF_PM index set stopped at elf-noble (268) and so silently
            // excluded the elven monarch (269) — the one elf with a tail branch.
            if (rn2(2)) mongets(mtmp, rn2(2) ? W_ELVEN_MITHRIL_COAT : W_ELVEN_CLOAK);
            if (rn2(2)) mongets(mtmp, W_ELVEN_LEATHER_HELM);
            else if (!rn2(4)) mongets(mtmp, W_ELVEN_BOOTS);
            if (rn2(2)) mongets(mtmp, W_ELVEN_DAGGER);
            switch (rn2(3)) {
            case 0:
                if (!rn2(4)) mongets(mtmp, W_ELVEN_SHIELD);
                if (rn2(3)) mongets(mtmp, W_ELVEN_SHORT_SWORD);
                mongets(mtmp, W_ELVEN_BOW); m_initthrow(mtmp, W_ELVEN_ARROW, 12);
                break;
            case 1:
                mongets(mtmp, W_ELVEN_BROADSWORD);
                if (rn2(2)) mongets(mtmp, W_ELVEN_SHIELD);
                break;
            case 2:
                if (rn2(2)) { mongets(mtmp, W_ELVEN_SPEAR); mongets(mtmp, W_ELVEN_SHIELD); }
                break;
            }
            // C ref: makemon.c:245-250 — the elven monarch's pick-axe (the
            // rn2(3) is the LEFT operand of the `||`, so always drawn) and a
            // 1-in-50 crystal ball.
            if (mm === PM_ELVEN_MONARCH_JS) {
                if (rn2(3) || (game.in_mklev && Is_earthlevel(game.u?.uz)))
                    mongets(mtmp, W_PICK_AXE);
                if (!rn2(50)) mongets(mtmp, W_CRYSTAL_BALL);
            }
        } else if (msound_of(ptr) === MS_PRIEST
                   || quest_mon_represents_role(ptr, 'Pri')) {
            // C ref: makemon.c m_initweap S_HUMAN `msound == MS_PRIEST ||
            // quest_mon_represents_role(ptr, PM_CLERIC)` branch — every temple
            // priest (msound MS_PRIEST: "aligned cleric" and "high cleric") plus
            // the Priest quest's own leader/nemesis.
            const otmp = mksobj(W_MACE, false, false);
            otmp.spe = rnd(3);
            if (!rn2(2)) curse(otmp);
            mtmp._hasinv = true;
            mpickobj(mtmp, otmp);
        } else if (mm === PM_NINJA_JS) {
            // C ref: makemon.c:270 — "extra quest villains".  The Samurai
            // quest's ninjas are S_HUMAN with AT_WEAP, so they DO reach here;
            // skipping the branch dropped both rn2(4) draws and then let the
            // guardian chain (which they are not part of) fall through to the
            // shared m_lev > rn2(75) tail one weapon short.
            mongets(mtmp, rn2(4) ? W_SHURIKEN : W_DART);
            mongets(mtmp, rn2(4) ? W_SHORT_SWORD : W_AXE);
        } else if (msound_of(ptr) === MS_GUARDIAN) {
            // C ref: makemon.c:274 m_initweap S_HUMAN `msound == MS_GUARDIAN`
            // branch — the 13 quest "guardian" humans.
            const nm = ptr.name;
            if (nm === 'student' || nm === 'attendant' || nm === 'abbot'
                || nm === 'acolyte' || nm === 'guide' || nm === 'apprentice') {
                if (rn2(2)) mongets(mtmp, rn2(3) ? W_DAGGER : W_KNIFE);
                if (rn2(5)) mongets(mtmp, rn2(3) ? W_LEATHER_JACKET : W_LEATHER_CLOAK);
                if (rn2(3)) mongets(mtmp, rn2(3) ? W_LOW_BOOTS : W_HIGH_BOOTS);
                if (rn2(3)) mongets(mtmp, W_POT_HEALING);
            } else if (nm === 'chieftain' || nm === 'page' || nm === 'roshi'
                       || nm === 'warrior') {
                mongets(mtmp, rn2(3) ? W_LONG_SWORD : W_SHORT_SWORD);
                mongets(mtmp, rn2(3) ? W_CHAIN_MAIL : W_LEATHER_ARMOR);
                if (rn2(2)) mongets(mtmp, rn2(2) ? W_LOW_BOOTS : W_HIGH_BOOTS);
                if (!rn2(3)) mongets(mtmp, W_LEATHER_CLOAK);
                if (!rn2(3)) { mongets(mtmp, W_BOW); m_initthrow(mtmp, W_ARROW, 12); }
            } else if (nm === 'hunter') {
                mongets(mtmp, rn2(3) ? W_SHORT_SWORD : W_DAGGER);
                if (rn2(2)) mongets(mtmp, rn2(2) ? W_LEATHER_JACKET : W_LEATHER_ARMOR);
                mongets(mtmp, W_BOW); m_initthrow(mtmp, W_ARROW, 12);
            } else if (nm === 'thug') {
                mongets(mtmp, W_CLUB);
                mongets(mtmp, rn2(3) ? W_DAGGER : W_KNIFE);
                if (rn2(2)) mongets(mtmp, W_LEATHER_GLOVES);
                mongets(mtmp, rn2(2) ? W_LEATHER_JACKET : W_LEATHER_ARMOR);
            } else if (nm === 'neanderthal') {
                mongets(mtmp, W_CLUB);
                mongets(mtmp, W_LEATHER_ARMOR);
            }
        }
        break;
    case 8: // S_HUMANOID
        if (mm === 43 /*hobbit*/) {
            switch (rn2(3)) {
            case 0: mongets(mtmp, W_DAGGER); break;
            case 1: mongets(mtmp, W_ELVEN_DAGGER); break;
            case 2: mongets(mtmp, W_SLING); m_initthrow(mtmp, !rn2(4) ? W_FLINT : W_ROCK, 6); break;
            }
            if (!rn2(10)) mongets(mtmp, W_ELVEN_MITHRIL_COAT);
            if (!rn2(10)) mongets(mtmp, W_DWARVISH_CLOAK);
        } else if (mflags2_of(ptr) & M2_DWARF) {   // C: is_dwarf(ptr)
            if (rn2(7)) mongets(mtmp, W_DWARVISH_CLOAK);
            if (rn2(7)) mongets(mtmp, W_IRON_SHOES);
            if (!rn2(4)) {
                mongets(mtmp, W_DWARVISH_SHORT_SWORD);
                if (rn2(2)) mongets(mtmp, W_DWARVISH_MATTOCK);
                else { mongets(mtmp, rn2(2) ? W_AXE : W_DWARVISH_SPEAR); mongets(mtmp, W_DWARVISH_ROUNDSHIELD); }
                mongets(mtmp, W_DWARVISH_IRON_HELM);
                if (!rn2(3)) mongets(mtmp, W_DWARVISH_MITHRIL_COAT);
            } else {
                mongets(mtmp, !rn2(3) ? W_PICK_AXE : W_DAGGER);
            }
        }
        break;
    case 37: // S_KOP
        if (!rn2(4)) m_initthrow(mtmp, W_CREAM_PIE, 2);
        if (!rn2(3)) mongets(mtmp, rn2(2) ? W_CLUB : W_RUBBER_HOSE);
        break;
    case 15: { // S_ORC
        if (rn2(2)) mongets(mtmp, W_ORCISH_HELM);
        let sub = mm;
        if (mm === PM_ORC_CAPTAIN_JS) sub = rn2(2) ? PM_MORDOR_ORC_JS : PM_URUK_HAI_JS;
        if (sub === PM_MORDOR_ORC_JS) {
            if (!rn2(3)) mongets(mtmp, W_SCIMITAR);
            if (!rn2(3)) mongets(mtmp, W_ORCISH_SHIELD);
            if (!rn2(3)) mongets(mtmp, W_KNIFE);
            if (!rn2(3)) mongets(mtmp, W_ORCISH_CHAIN_MAIL);
        } else if (sub === PM_URUK_HAI_JS) {
            if (!rn2(3)) mongets(mtmp, W_ORCISH_CLOAK);
            if (!rn2(3)) mongets(mtmp, W_ORCISH_SHORT_SWORD);
            if (!rn2(3)) mongets(mtmp, W_IRON_SHOES);
            if (!rn2(3)) { mongets(mtmp, W_ORCISH_BOW); m_initthrow(mtmp, W_ORCISH_ARROW, 12); }
            if (!rn2(3)) mongets(mtmp, W_URUK_HAI_SHIELD);
        } else {
            if (mm !== PM_ORC_SHAMAN_JS && rn2(2))
                mongets(mtmp, (mm === PM_GOBLIN_JS || rn2(2) === 0) ? W_ORCISH_DAGGER : W_SCIMITAR);
        }
        break;
    }
    case 41: { // S_OGRE
        // C ref: makemon.c:447 — rn2(OGRE_TYRANT?3 : OGRE_LEADER?6 : 12).
        const ogn = (mm === 205 /*ogre tyrant*/) ? 3 : (mm === 204 /*ogre leader*/) ? 6 : 12;
        if (!rn2(ogn)) mongets(mtmp, W_BATTLE_AXE); else mongets(mtmp, W_CLUB);
        break;
    }
    case 46: // S_TROLL
        if (!rn2(2)) {
            switch (rn2(4)) {
            case 0: mongets(mtmp, W_RANSEUR); break;
            case 1: mongets(mtmp, W_PARTISAN); break;
            case 2: mongets(mtmp, W_GLAIVE); break;
            case 3: mongets(mtmp, W_SPETUM); break;
            }
        }
        break;
    case 11: // S_KOBOLD
        if (!rn2(4)) m_initthrow(mtmp, W_DART, 12);
        break;
    case 29: // S_CENTAUR
        if (rn2(2)) {
            if (mm === FOREST_CENTAUR_PM) { mongets(mtmp, W_BOW); m_initthrow(mtmp, W_ARROW, 12); }
            else { mongets(mtmp, W_CROSSBOW); m_initthrow(mtmp, W_CROSSBOW_BOLT, 12); }
        }
        break;
    case 49: // S_WRAITH
        mongets(mtmp, W_KNIFE); mongets(mtmp, W_LONG_SWORD);
        break;
    case 52: // S_ZOMBIE (makemon.c:487) — reached by PM_SKELETON, the one
        // AT_WEAP member of the class.  Without this case a skeleton fell into
        // `default:` and drew the general rnd(14 - 2*bias) instead of C's two
        // rn2(4)s, so every skeleton desynced the stream from its creation on.
        if (!rn2(4)) mongets(mtmp, W_LEATHER_ARMOR);
        if (!rn2(4)) mongets(mtmp, rn2(3) ? W_KNIFE : W_SHORT_SWORD);
        break;
    case 58: // S_LIZARD (makemon.c:493) — salamanders only; same
        // fell-through-to-default problem as S_ZOMBIE above.
        if (mm === PM_SALAMANDER_JS)
            mongets(mtmp, rn2(7) ? W_SPEAR : (rn2(3) ? W_TRIDENT : W_STILETTO));
        break;
    case 56: // S_DEMON (makemon.c:500)
        // C switches on the pm index; keyed by name here because the JS mons[]
        // numbering is its own scheme.
        switch (ptr.name) {
        case 'balrog':
            mongets(mtmp, W_BULLWHIP); mongets(mtmp, W_BROADSWORD);
            break;
        case 'Orcus':
            mongets(mtmp, W_WAN_DEATH);              // the Wand of Orcus
            break;
        case 'horned devil':
            mongets(mtmp, rn2(4) ? W_TRIDENT : W_BULLWHIP);   // makemon.c:510
            break;
        case 'Dispater':
            mongets(mtmp, W_WAN_STRIKING);
            break;
        case 'Yeenoghu':
            mongets(mtmp, W_FLAIL);
            break;
        default: break;
        }
        // C: `if (!is_demon(ptr)) break;` then FALLTHRU into the general case —
        // this keeps djinn and mail daemons from leaving objects behind.
        if (!(mflags2_of(ptr) & M2_DEMON)) break;
        // FALLTHROUGH
    default: {
        // C ref: makemon.c m_initweap default — bias = is_lord(ptr)
        // + is_prince(ptr)*2 + extra_nasty(ptr).
        const bias = m_initweap_bias(ptr);
        switch (rnd(14 - 2 * bias)) {
        case 1:
            if (strongmonst_js(ptr)) mongets(mtmp, W_BATTLE_AXE); else m_initthrow(mtmp, W_DART, 12);
            break;
        case 2:
            if (strongmonst_js(ptr)) mongets(mtmp, W_TWO_HANDED_SWORD);
            else { mongets(mtmp, W_CROSSBOW); m_initthrow(mtmp, W_CROSSBOW_BOLT, 12); }
            break;
        case 3: mongets(mtmp, W_BOW); m_initthrow(mtmp, W_ARROW, 12); break;
        case 4:
            if (strongmonst_js(ptr)) mongets(mtmp, W_LONG_SWORD); else m_initthrow(mtmp, W_DAGGER, 3);
            break;
        case 5:
            if (strongmonst_js(ptr)) mongets(mtmp, W_LUCERN_HAMMER); else mongets(mtmp, W_AKLYS);
            break;
        default: break;
        }
        break;
    }
    }
    if (mtmp.m_lev > rn2(75)) mongets(mtmp, rnd_offensive_item(mtmp));
}

// Full C-faithful m_initinv for Big Room monsters (generic tail + per-class
// prefixes reachable on dlvl<=~14).
// C ref: mondata.h likes_gold(ptr) == (mflags2 & M2_GREEDY).  Was a hardcoded
// pmidx Set plus a parallel name Set; both disagreed with M2_GREEDY (the pmidx
// one ran one short from 314 up — the mail-daemon splice — and the name one
// added Charon/Goblin King/the shimmering dragons).  Read the flag instead.
// C ref: muse.c rnd_defensive_item()/rnd_misc_item() head — `is_animal(pm) ||
// attacktype(pm, AT_EXPL) || mindless(pm) || mlet == S_GHOST || mlet == S_KOP`.
// These were two hand-written pmidx Sets whose windows had drifted off the real
// M1_ANIMAL membership (jellyfish and Nalzok were in, crocodile and Scorpius
// were out), and AT_EXPL was missing entirely; every disagreement silently
// skipped or added a whole rnd_defensive_item() draw chain.
function rnd_item_excluded(ptr) {
    return is_animal(ptr) || attacktype(ptr, AT_EXPL) || mindless(ptr)
        || ptr.mcls === 54 /*S_GHOST (defsym.h; 51 was wrong)*/ || ptr.mcls === 37 /*S_KOP*/;
}
// C ref: teleport.c:29 noteleport_level(mon).  The level-flag clause alone
// answered FALSE inside Gehennom's demon court, where C blocks teleport for
// everyone who is not a demon lord/prince — and rnd_defensive_item() restarts
// its whole switch on that answer (seed0360 step 307, muse.c:1235).
// GAP: C's third clause `svl.level.flags.stasis_until >= svm.moves` is not
// modelled (no wand of stasis in any covered session).
function mm_noteleport_level(ptr) {
    const dlord = (p) => !!p && is_demon_flag(p)
        && (mflags2_of(p) & (M2_LORD | M2_PRINCE)) !== 0;
    if (In_hell(game.u?.uz) && !dlord(ptr)) {
        for (const m of (game.level?.monsters || [])) {
            if (m.mhp != null && m.mhp <= 0) continue;
            if (dlord(m.data)) return true;
        }
    }
    if (game.level?.flags?.noteleport && !is_covetous(ptr)) return true;
    return false;
}

function rnd_defensive_item(mtmp) {
    const pm = mtmp?.data;
    if (!pm || rnd_item_excluded(pm)) return 0;
    const d = pm.difficulty ?? 0;
    // C ref: muse.c rnd_defensive_item — teleport picks retry once on a
    // noteleport level (unless the monster is covetous, e.g. Vlad wanting the
    // Candelabrum bypasses his own tower's noteleport flag); digging picks
    // retry in Sokoban.
    const noteleport = mm_noteleport_level(pm);
    const inSokoban = (game.sokoban_dnum != null
                       && game.u?.uz?.dnum === game.sokoban_dnum);
    let trycnt = 0;
    for (;;) {
        const roll = rn2(8 + (d > 3 ? 1 : 0) + (d > 6 ? 1 : 0) + (d > 8 ? 1 : 0));
        switch (roll) {
        case 6: case 9:
            if (noteleport && ++trycnt < 2) continue;   // goto try_again
            return (!rn2(3)) ? 424 : 333;
        case 0: case 1: return 333;
        case 8: case 10: return (!rn2(3)) ? 413 : 329;
        case 2: return 329;
        case 3: return 307;
        case 4: return 308;
        // C ref: muse.c:2016 — Pestilence gets sickness, not full healing.
        case 5: return (pm.name !== 'Pestilence') ? 315 : 318;
        case 7:
            if (inSokoban && rn2(4)) continue;          // goto try_again
            // C ref: muse.c:2025 — `is_floater(pm) || isshk || isgd ||
            // ispriest`.  is_floater (mondata.h) is mlet S_EYE or S_LIGHT;
            // dropping it handed floating eyes and yellow lights a wand of
            // digging, whose mongets()/mksobj() draws C never makes.
            if (pm.mcls === S_EYE_CLS || pm.mcls === S_LIGHT_CLS
                || mtmp.isshk || mtmp.isgd || mtmp.ispriest) return 0;
            return 428;
        default: return 0;
        }
    }
}
// C ref: mondata.h nonliving(ptr) = is_undead(ptr) || PM_MANES ||
// weirdnonliving(ptr) [is_golem(ptr) || mlet == S_VORTEX].  No RNG.
const S_VORTEX_CLS = 22, S_GOLEM_CLS = 55;
// defsym.h MONSYM indices used by mondata.h is_floater(ptr).
const S_EYE_CLS = 5, S_LIGHT_CLS = 25;
function nonliving_pm(ptr) {
    if (!ptr) return false;
    return is_undead_flag(ptr) || ptr.name === 'manes'
        || ptr.mcls === S_GOLEM_CLS || ptr.mcls === S_VORTEX_CLS;
}

// C ref: monst.h is_vampshifter(mon) — cham is one of the vampire forms.
function is_vampshifter_mon(mtmp) {
    const cham = mtmp?.cham;
    if (cham == null || cham === NON_PM) return false;
    const nm = MONS[cham]?.name;
    return nm === 'vampire' || nm === 'vampire leader'
        || nm === 'Vlad the Impaler';
}

function rnd_misc_item(mtmp) {
    const pm = mtmp?.data;
    if (!pm || rnd_item_excluded(pm)) return 0;
    const d = pm.difficulty ?? 0;
    // C ref: muse.c rnd_misc_item() — `return rn2(6) ? POT_POLYMORPH : WAN_POLYMORPH;`
    // POT_POLYMORPH is otyp 316 (305 is POT_INVISIBILITY, a different potion);
    // 422 is WAN_POLYMORPH.
    if (d < 6 && !rn2(30)) return rn2(6) ? 316 : 422;
    // C: `if (!rn2(40) && !nonliving(pm) && !is_vampshifter(mtmp))` — the rn2(40)
    // is the LEFT operand so it is always drawn, and an undead/golem/vortex/
    // vampshifter that wins the roll still falls through to the rn2(3) switch
    // below instead of getting the amulet.  AMULET_OF_LIFE_SAVING is 202;
    // 211 is the amulet of flying.
    if (!rn2(40) && !nonliving_pm(pm) && !is_vampshifter_mon(mtmp)) return 202;
    switch (rn2(3)) {
    case 0: if (mtmp.isgd) return 0; return rn2(6) ? 302 : 420;
    // POT_INVISIBILITY is 305 (303 is POT_LEVITATION).  C also lets the item
    // through for a peaceful monster when the hero has See_invisible.
    case 1:
        if (mtmp.mpeaceful && !game.u?.uprops?.See_invisible) return 0;
        return rn2(6) ? 305 : 418;
    case 2: return 309;
    }
    return 0;
}
// C ref: mondata.h is_mercenary(ptr) == (mflags2 & M2_MERC).
function m_is_mercenary(ptr) { return (mflags2_of(ptr) & M2_MERC) !== 0; }

// C ref: hack.h ARM_BONUS(obj).  This used to carry its own 15-entry a_ac map
// covering only the otyps the mercenary branch below can hand out, so any other
// armour scored 0; worn.js tabulates a_ac for the whole 89..172 range.
function merc_arm_bonus(o) { return o ? ARM_BONUS(o) : 0; }

// C ref: makemon.c m_initinv() is_mercenary() branch.  mtmp is the mercenary;
// mm its PM index.  RNG must match C exactly (five armour rounds gated on the
// running AC estimate 'mac', then type-specific whistle/rations).
function m_initinv_mercenary(mtmp, mm) {
    let mac;
    switch (mm) {
    case 272: mac = -1; break;   // PM_GUARD
    case 277: mac = 3; break;    // PM_SOLDIER
    case 278: mac = 0; break;    // PM_SERGEANT
    case 280: mac = -2; break;   // PM_LIEUTENANT
    case 281: mac = -3; break;   // PM_CAPTAIN
    case 282: mac = 3; break;    // PM_WATCHMAN
    case 283: mac = -2; break;   // PM_WATCH_CAPTAIN
    default: mac = 0; break;
    }
    let otmp = null;
    const add_ac = () => { if (otmp) mac += merc_arm_bonus(otmp); otmp = null; };
    // round 1: body armour
    if (mac < -1 && rn2(5)) otmp = mongets(mtmp, rn2(5) ? 121 : 122);           // PLATE_MAIL : CRYSTAL_PLATE_MAIL
    else if (mac < 3 && rn2(5)) otmp = mongets(mtmp, rn2(3) ? 124 : 125);       // SPLINT_MAIL : BANDED_MAIL
    else if (rn2(5)) otmp = mongets(mtmp, rn2(3) ? 132 : 131);                  // RING_MAIL : STUDDED_LEATHER_ARMOR
    else otmp = mongets(mtmp, 134);                                            // LEATHER_ARMOR
    add_ac();
    // round 2: helmets
    if (mac < 10 && rn2(3)) otmp = mongets(mtmp, 97);                           // HELMET
    else if (mac < 10 && rn2(2)) otmp = mongets(mtmp, 95);                      // DENTED_POT
    add_ac();
    // round 3: shields
    if (mac < 10 && rn2(3)) otmp = mongets(mtmp, 150);                          // SMALL_SHIELD
    else if (mac < 10 && rn2(2)) otmp = mongets(mtmp, 156);                     // LARGE_SHIELD
    add_ac();
    // round 4: boots
    if (mac < 10 && rn2(3)) otmp = mongets(mtmp, 163);                          // LOW_BOOTS
    else if (mac < 10 && rn2(2)) otmp = mongets(mtmp, 165);                     // HIGH_BOOTS
    add_ac();
    // round 5: gloves + cloak
    if (mac < 10 && rn2(3)) otmp = mongets(mtmp, 159);                          // LEATHER_GLOVES
    else if (mac < 10 && rn2(2)) otmp = mongets(mtmp, 145);                     // LEATHER_CLOAK
    add_ac();

    if (mm === 283) {
        /* watch captain: better weapon rather than extra gear */
    } else if (mm === 282) {
        if (rn2(3)) mongets(mtmp, 245 /*TIN_WHISTLE*/);   // most watchmen carry a whistle
    } else if (mm === 272) {
        const o = mksobj(245 /*TIN_WHISTLE*/, true, false); // vault guard: cursed whistle
        curse(o); mpickobj(mtmp, o); mtmp._hasinv = true;
    } else { /* soldiers and their officers */
        if (!rn2(3)) mongets(mtmp, 294 /*K_RATION*/);
        if (!rn2(2)) mongets(mtmp, 295 /*C_RATION*/);
        if (mm !== 277 /*PM_SOLDIER*/ && !rn2(3)) mongets(mtmp, 256 /*BUGLE*/);
    }
}

// C ref: steed.c:8 `static const char steeds[] = { S_QUADRUPED, S_UNICORN,
// S_ANGEL, S_CENTAUR, S_DRAGON, S_JABBERWOCK }` — defsym.h MONSYM indices.
const STEED_CLASSES = new Set([17, 21, 27, 29, 30, 36]);
const MZ_MEDIUM = 2;
// C ref: steed.c can_saddle(mtmp).
function can_saddle(mtmp) {
    const ptr = mtmp?.data;
    if (!ptr || !STEED_CLASSES.has(ptr.mcls)) return false;
    if ((ptr.msize ?? MZ_MEDIUM) < MZ_MEDIUM) return false;
    if (humanoid_flag(ptr) && ptr.mcls !== 29 /*S_CENTAUR*/) return false;
    // is_whirly = S_VORTEX or the air elemental; noncorporeal = S_GHOST.
    const whirly = ptr.mcls === S_VORTEX_CLS || ptr.name === 'air elemental';
    return !amorphous_flag(ptr) && ptr.mcls !== S_GHOST_CLS && !whirly
        && !unsolid_flag(ptr);
}
// C ref: worn.c which_armor(mon, W_SADDLE).
function which_armor_saddle(mtmp) {
    for (const o of (mtmp?.minvent || [])) if ((o.owornmask | 0) & W_SADDLE) return o;
    return null;
}
// C ref: steed.c put_saddle_on_mon(NULL, mtmp).  The only RNG is the
// next_ident() inside mksobj(); fully_identify_obj() and mpickobj() draw none.
const SADDLE_OTYP = 235;
function put_saddle_on_mon(mtmp) {
    const saddle = mksobj(SADDLE_OTYP, true, false);
    if (!saddle) return;
    saddle.known = saddle.bknown = saddle.rknown = 1;  // fully_identify_obj
    saddle.dknown = 1;
    mtmp._hasinv = true;
    mpickobj(mtmp, saddle);
    mtmp.misc_worn_check = (mtmp.misc_worn_check | 0) | W_SADDLE;
    saddle.owornmask = W_SADDLE;
    saddle.leashmon = mtmp.m_id;
}

function m_initinv_full(mtmp) {
    const ptr = mtmp?.data;
    if (!ptr || Is_rogue_level(game.u?.uz)) return;
    const mlet = ptr.mcls, mm = ptr.pmidx;
    switch (mlet) {
    case 53: // S_HUMAN
        // C ref: makemon.c m_initinv() S_HUMAN case.  Mercenaries (soldiers,
        // watchmen, ...) get five rounds of armour approximating their AC, plus
        // a whistle/rations depending on type.  Reached by quest-home watchmen
        // (Arc-strt).  Then the shopkeeper branch (skeleton key + wand/potion
        // cascade), reachable from stock_room.
        if (m_is_mercenary(ptr)) {
            m_initinv_mercenary(mtmp, mm);
        } else if (mm === 271 /*PM_SHOPKEEPER*/) {
            mongets(mtmp, 221 /*SKELETON_KEY*/);
            switch (rn2(4)) { // makemon.c:704
            case 0: mongets(mtmp, 429 /*WAN_MAGIC_MISSILE*/); /* FALLTHRU */
            case 1: mongets(mtmp, 308 /*POT_EXTRA_HEALING*/); /* FALLTHRU */
            case 2: mongets(mtmp, 307 /*POT_HEALING*/);       /* FALLTHRU */
            case 3: mongets(mtmp, 417 /*WAN_STRIKING*/);
            }
        } else if (msound_of(ptr) === MS_PRIEST
                   || quest_mon_represents_role(ptr, 'Pri')) {
            // C ref: makemon.c m_initinv() S_HUMAN `msound == MS_PRIEST ||
            // quest_mon_represents_role(ptr, PM_CLERIC)` branch — see the
            // matching m_initweap branch above.
            if (rn2(7)) mongets(mtmp, 143 /*ROBE*/);
            else mongets(mtmp, rn2(3) ? 146 /*CLOAK_OF_PROTECTION*/ : 148 /*CLOAK_OF_MAGIC_RESISTANCE*/);
            mongets(mtmp, 150 /*SMALL_SHIELD*/);
            // C ref: mkmonmoney(mtmp, rn1(10,20)) -> if(amount>0) mksobj(GOLD_PIECE,
            // FALSE, FALSE) (one next_ident rnd(2); no mksobj_init since init==FALSE)
            // + add to minvent — kept (unlike the LIKES_GOLD_NAMES tail case) since
            // quest_drop_default_invent's mdrop_special_objs walk counts it.
            const amt = rn1(10, 20);
            if (amt > 0) {
                const gold = mksobj(438 /*GOLD_PIECE*/, false, false);
                gold.quan = amt;
                gold.owt = weight(gold);
                mtmp._hasinv = true;
                mpickobj(mtmp, gold);
            }
            mtmp._hasgold = true;
        } else if (quest_mon_represents_role(ptr, 'Mon')) {
            // C ref: makemon.c:726 — the Monk quest's leader/nemesis get a
            // robe (or, 1-in-11, a cloak of magic resistance).  The branch was
            // absent, so both lost the rn2(11).
            mongets(mtmp, rn2(11) ? 143 /*ROBE*/ : 148 /*CLOAK_OF_MAGIC_RESISTANCE*/);
        }
        break;
    case 14: // S_NYMPH
        if (!rn2(2)) mongets(mtmp, 230 /*MIRROR*/);
        if (!rn2(2)) mongets(mtmp, 312 /*POT_OBJECT_DETECTION*/);
        break;
    case 39: // S_MUMMY
        if (rn2(7)) mongets(mtmp, 138 /*MUMMY_WRAPPING (armor)*/);
        break;
    case 34: // S_GIANT — C ref: makemon.c:734-751.  The Minotaur may carry a
        // wand of digging (the rn2(8) is the LEFT operand of C's `||`, so it is
        // always drawn); any other true giant carries a few gem/stone stacks.
        // (This case used to appear TWICE in this switch; the second copy was
        // unreachable dead code.)
        if (ptr.name === 'minotaur') {
            if (!rn2(8) || (game.in_mklev && Is_earthlevel(game.u?.uz)))
                mongets(mtmp, WAN_DIGGING);
        } else if (is_giant_flag(ptr)) {
            for (let cnt = rn2(Math.trunc((mtmp.m_lev || 0) / 2)); cnt; cnt--) {
                const otmp = mksobj(rnd_class(DILITHIUM_CRYSTAL, LUCKSTONE - 1),
                                    false, false);
                if (!otmp) continue;
                otmp.quan = rn1(2, 3);
                otmp.owt = weight(otmp);
                mtmp._hasinv = true;
                mpickobj(mtmp, otmp);
            }
        }
        break;
    case 33: { // S_GNOME — C ref: makemon.c:807
        // C creates the candle, sets quan/owt and mpickobj()s it; the port
        // built the object and threw it away, so the gnome carried nothing (and
        // `mtmp->minvent ? 5 : 10` in the gold tail below read the wrong arm).
        if (!rn2((In_mines_js() && game.in_mklev) ? 20 : 60)) {
            const otmp = mksobj(rn2(4) ? 224 /*TALLOW_CANDLE*/ : 225 /*WAX_CANDLE*/,
                                true, false);
            if (otmp) {
                otmp.quan = 1;
                otmp.owt = weight(otmp);
                mtmp._hasinv = true;
                mpickobj(mtmp, otmp);
                /* C: begin_burn() when the square is unlit — display only */
            }
        }
        break;
    }
    case 38: // S_LICH — C ref: makemon.c:766-778.  Absent entirely before, so
        // a master lich lost its rn2(13) and an arch-lich its rn2(3) + tail.
        if (mm === PM_MASTER_LICH_JS && !rn2(13)) {
            mongets(mtmp, rn2(7) ? 38 /*ATHAME*/ : 416 /*WAN_NOTHING*/);
        } else if (mm === PM_ARCH_LICH_JS && !rn2(3)) {
            // C: mksobj(rn2(3) ? ATHAME : QUARTERSTAFF, TRUE, rn2(13) ? FALSE
            // : TRUE).  C leaves argument evaluation order unspecified; taken
            // left-to-right here (otyp roll first, artifact roll second).
            const otyp = rn2(3) ? 38 /*ATHAME*/ : 79 /*QUARTERSTAFF*/;
            const artif = rn2(13) ? false : true;
            const otmp = mksobj(otyp, true, artif);
            if (otmp) {
                if ((otmp.spe ?? 0) < 2) otmp.spe = rnd(3);
                if (!rn2(4)) otmp.oerodeproof = 1;
                mtmp._hasinv = true;
                mpickobj(mtmp, otmp);
            }
        }
        break;
    case 49: // S_WRAITH
        // C ref: makemon.c m_initinv() S_WRAITH — a Nazgul's cursed ring of
        // invisibility (mksobj with init FALSE: next_ident only).
        if (ptr.name === 'Nazgul') {
            const otmp = mksobj(198 /*RIN_INVISIBILITY*/, false, false);
            curse(otmp);
            mtmp._hasinv = true;
            mpickobj(mtmp, otmp);
        }
        break;
    case 43: // S_QUANTMECH — C ref: makemon.c:781.  202 is the AMULET of life
        // saving; LARGE_BOX is 214 (SchroedingersBox, spe=1, cat corpse inside).
        if (!rn2(20) && mm === 210 /*PM_QUANTUM_MECHANIC*/) {
            const box = mksobj(214 /*LARGE_BOX*/, false, false);
            const catcorpse = mksobj(265 /*CORPSE*/, true, false);
            if (box && catcorpse) {
                box.spe = 1;            /* flag for special SchroedingersBox */
                catcorpse.corpsenm = 16 /*PM_HOUSECAT*/;
                if (!box.cobj) box.cobj = [];
                box.cobj.push(catcorpse);
                catcorpse.where = 'contained';
                box.owt = weight(box);
            }
            if (box) { mtmp._hasinv = true; mpickobj(mtmp, box); }
        }
        break;
    case 56: // S_DEMON — C ref: makemon.c:797.  These lack AT_WEAP so
        // m_initweap() never runs for them; C moved their gear here.
        if (mm === PM_ICE_DEVIL_JS) {
            if (!rn2(4)) mongets(mtmp, W_SPEAR);
        } else if (mm === PM_ASMODEUS_JS) {
            mongets(mtmp, 431 /*WAN_COLD*/);
            mongets(mtmp, 430 /*WAN_FIRE*/);
        }
        break;
    case 12: { // S_LEPRECHAUN — mkmonmoney(d(level_difficulty(), 30))
        const amt = d(level_difficulty_ext(), 30);
        if (amt > 0) {
            const gold = mksobj(438 /*GOLD_PIECE*/, false, false); // next_ident rnd(2)
            if (gold) {
                gold.quan = amt;
                gold.owt = weight(gold);
                mtmp._hasinv = true;
                mpickobj(mtmp, gold);
            }
        }
        mtmp._hasgold = true;
        break;
    }
    default: break;
    }
    if (mm === PM_SOLDIER_JS && rn2(13)) return;
    if ((mtmp.m_lev || 0) > rn2(50)) mongets(mtmp, rnd_defensive_item(mtmp));
    if ((mtmp.m_lev || 0) > rn2(100)) mongets(mtmp, rnd_misc_item(mtmp));
    if (likes_gold_flag(ptr) && !mtmp._hasgold && !rn2(5)) {
        // C ref: mkmonmoney(d(level_difficulty(), mtmp->minvent ? 5 : 10)).
        // Use the dice helper d() so it records a single d(n,x) RNG-log entry,
        // matching the C engine (rather than n separate rn2 calls).
        const amt = d(level_difficulty_ext(), mtmp._hasinv ? 5 : 10);
        // C ref: mkmonmoney -> if (amount>0) mksobj(GOLD_PIECE, FALSE, FALSE)
        // (one next_ident rnd(2); no mksobj_init since init==FALSE) followed by
        // add_to_minv(), which is what makes the pile drop on death.
        if (amt > 0) {
            const gold = mksobj(438 /*GOLD_PIECE*/, false, false);
            if (gold) {
                gold.quan = amt;
                gold.owt = weight(gold);
                mtmp._hasinv = true;
                mpickobj(mtmp, gold);
            }
        }
        mtmp._hasgold = true;
    }
}
function In_mines_js() { return game.u?.uz?.dnum === game.mines_dnum; }

// Object/furniture appearance constants used by set_mimic_sym.
const SMS_STATUE = 476, SMS_FIGURINE = 241, SMS_CORPSE = 265, SMS_EGG = 266,
    SMS_TIN = 296, SMS_SLIME_MOLD = 285, SMS_STRANGE_OBJECT = 0,
    SMS_GOLD_PIECE = 438, SMS_BOULDER = 475, SMS_LUMP_OF_ROYAL_JELLY = 286;
const S_MIMIC_DEF = 60;          // monsym.h S_MIMIC_DEF
const ROOMOFFSET_JS = 3;         // rm.h ROOMOFFSET
// mkroom.h room types (enum at mkroom.h:52).  SHOPBASE is the shop threshold.
const VAULT_RT = 4, ZOO_RT = 8, DELPHI_RT = 9, TEMPLE_RT = 10;
const SHOPBASE_RT = 14;          // mkroom.h SHOPBASE
// defsym.h screen-symbol indices used for M_AP_FURNITURE appearances.
const SMS_S_VWALL = 1, SMS_S_HWALL = 2, SMS_S_VCDOOR = 15, SMS_S_HCDOOR = 16,
    SMS_S_ALTAR = 33, SMS_S_FOUNTAIN = 37;
// mons[] indices of the player-monster block (monsters.h, the "archeologist"
// .. "wizard" run), used by the nocorpse-CORPSE fallback and by tt_doppel().
// NOT the role indices: js/exper.js also defines PM_ARCHEOLOGIST/PM_WIZARD as
// 0/12, but those index roles[], while C's PM_* here index mons[].  Getting the
// two confused turns rn1(13, 330) into rn1(13, 0) — same draw, wrong species.
const PM_ARCHEOLOGIST_MON = 331, PM_WIZARD_MON = 343;

// C ref: rm.h IS_WALL(typ) = ((typ) && (typ) <= DBWALL).  STONE is 0, so the
// leading truthiness test is what excludes solid stone from the door/wall arm.
function IS_WALL_TYP(typ) { return typ > 0 && typ <= DBWALL; }

// C ref: hack.c in_town() — the Gnomish Mines town.  A room WITH subrooms is
// the town; if the level has no subroomed rooms at all, the whole level counts.
// Only ever consulted alongside In_mines(), so it costs nothing off the mines
// branch, but it is the real predicate rather than a constant `false`: a mimic
// generated inside Mine Town must NOT take the maze-statue branch.
function in_town_js(x, y) {
    const lvl = game.level;
    // C ref: hack.c:3569 is `if (!svl.level.flags.has_town) return FALSE;` — a
    // PER-LEVEL flag, set at mkmaze.c:698-699 inside fixup_special(), i.e. AFTER
    // the level script has run.  We stand in the S_LEVEL `town` flag because
    // nothing in this port writes has_town yet; that answers the same for shop
    // mimics (created later, in fill_special_room) but is TRUE during the script
    // where C is still FALSE.  Porting fixup_special's has_town is the real fix
    // and needs measuring on its own — it flips this predicate on all seven
    // minetn variants, six of which still run the unported generator.
    const slev = Is_special(game.u?.uz);
    if (!slev || !slev.flags?.town) return false;
    let has_subrooms = false;
    for (let i = 0; i < (lvl.nroom ?? 0); i++) {
        const sroom = lvl.rooms[i];
        if (!sroom || (sroom.hx ?? 0) <= 0) break;
        if ((sroom.nsubrooms ?? 0) > 0) {
            has_subrooms = true;
            if (inside_room(sroom, x, y)) return true;
        }
    }
    return !has_subrooms;
}
// C ref: makemon.c syms[] — class/furniture symbols selected for a mimic
// appearance.  Index 0/1 are MAXOCLASSES (furniture), tail two are S_MIMIC_DEF.
const SMS_SYMS = [
    MAXOCLASSES, MAXOCLASSES, /*RING*/4, /*WAND*/11, /*WEAPON*/2,
    /*FOOD*/7, COIN_CLASS, /*SCROLL*/9, /*POTION*/8, /*ARMOR*/3,
    /*AMULET*/5, /*TOOL*/6, /*ROCK*/14, /*GEM*/13, /*SPBOOK*/10,
    S_MIMIC_DEF, S_MIMIC_DEF,
];

// C ref: makemon.c set_mimic_sym() — the FULL branch chain.
//
// This used to port only the two branches a mines shop reaches (OBJ_AT and
// rt >= SHOPBASE), with everything else falling through to ROLL_FROM(syms).
// That silently mis-drew on every maze level: C's chain reaches
//
//     } else if (svl.level.flags.is_maze_lev
//                && !(In_mines(&u.uz) && in_town(u.ux, u.uy))
//                && !In_sokoban(&u.uz) && rn2(2)) {
//
// BEFORE the ROLL_FROM fallback, so a mimic generated in Gehennom draws rn2(2)
// (and on success becomes a STATUE, whose trailing rndmonnum() then draws a
// whole species scan) where we drew a single rn2(SIZE(syms)).  That was the
// first RNG divergence on seed4500 — step 326, call 4127 of 14047, the Dlvl 40
// level-teleport — and everything after it, 1488 screens across seed4500 and
// seed0360, was downstream of the shifted stream.
//
// Every branch below is now present in C's order, because the order IS the
// semantics: each test can consume RNG, so skipping a branch that C evaluates
// shifts the stream even when the outcome would have been the same.
export function set_mimic_sym(mtmp) {
    // C ref: `if (!mtmp || Protection_from_shape_changers) return;` — extrinsic
    // ring property, read inline rather than importing mon.js (which imports
    // this module).  No RNG either way.
    if (!mtmp || game.u?.uprops?.Protection_from_shape_changers) return;
    const mx = mtmp.mx, my = mtmp.my;
    const loc = game.level?.at(mx, my);
    if (!loc) return;
    const typ = loc.typ ?? 0;
    const roomno = (loc.roomno ?? 0) - ROOMOFFSET_JS;
    // C ref: the #ifdef SPECIALIZATION `else if (IS_ROOM(typ))` arm is dead —
    // global.h:120 ships SPECIALIZATION commented out — so roomno < 0 gives
    // rt = 0 (OROOM) and leaves roomno negative for the BOULDER test below.
    const rt = roomno >= 0 ? (game.level.rooms[roomno]?.rtype ?? 0) : 0;
    const dep = depth_of_level(game.u?.uz);
    const lflags = game.level?.flags || {};

    let ap_type, appear, s_sym;
    let assign = false;   // emulate C goto assign_sym
    let resolved = false; // ap_type/appear resolved by an early branch (no assign)
    // C ref: makemon.c:2416 OBJ_AT(mx, my) — if there is already an object on
    // the mimic's square it mimics that object's type, consuming NO RNG.  Fires
    // for a storeroom mimic (themerms.lua "Storeroom") whose random in-room spot
    // lands on a chest dropped earlier in the same iterate loop.
    // `loc.objects` is only maintained by sp_lev.js place_floor_obj() and
    // tutorial.js; every object from mkobj.c place_object() lives solely in the
    // flat game.level.objects array, where the LAST match is C's pile head
    // (ball.js:36).  Without that fallback a mimic dropped onto an existing pile
    // — minend-1.lua's four gem niches — skipped C's no-RNG arm and fell through
    // to the is_maze_lev rn2(2).
    let topobj = loc.objects || null;
    if (!topobj) {
        const fobj = game.level?.objects;
        if (fobj) {
            for (let i = fobj.length - 1; i >= 0; i--) {
                const o = fobj[i];
                if (o.where === 'floor' && o.ox === mx && o.oy === my) {
                    topobj = o; break;
                }
            }
        }
    }
    if (topobj) {
        ap_type = 'obj';
        appear = topobj.otyp;
        resolved = true;
    } else if (typ === DOOR || IS_WALL_TYP(typ) || typ === SDOOR || typ === SCORR) {
        // C ref: M_AP_FURNITURE — a mimic standing in a doorway or wall square
        // impersonates a closed door (a wall on the rogue level, which has no
        // closed doors).  A wall to the LEFT that connects to this location
        // means a horizontal door; otherwise vertical.  No RNG.
        ap_type = 'furniture';
        const left = mx !== 0 ? (game.level?.at(mx - 1, my)?.typ ?? 0) : 0;
        const connects = mx !== 0 && (left === HWALL || left === TLCORNER
            || left === TRWALL || left === BLCORNER || left === TDWALL
            || left === CROSSWALL || left === TUWALL);
        const rogue = Is_rogue_level(game.u?.uz);
        appear = connects ? (rogue ? SMS_S_HWALL : SMS_S_HCDOOR)
                          : (rogue ? SMS_S_VWALL : SMS_S_VCDOOR);
        resolved = true;
    } else if (lflags.is_maze_lev
               && !(In_mines(game.u?.uz) && in_town_js(game.u?.ux, game.u?.uy))
               && !In_sokoban(game.u?.uz) && rn2(2)) {
        // C ref: on a maze level (all of Gehennom, the big mazes below Medusa,
        // Vlad's, the planes) a mimic is a STATUE half the time.  The rn2(2) is
        // evaluated ONLY after the three cheap non-RNG tests, exactly as C's &&
        // chain orders them — that ordering is why a maze mimic costs one draw
        // here and a mines-town mimic costs none.
        ap_type = 'obj';
        appear = SMS_STATUE;
        resolved = true;
    } else if (roomno < 0 && !t_at_local(mx, my)) {
        // C ref: outside any room and no trap here -> a boulder.  No RNG.
        ap_type = 'obj';
        appear = SMS_BOULDER;
        resolved = true;
    } else if (rt === ZOO_RT || rt === VAULT_RT) {
        // C ref: treasure zoo / vault -> a pile of gold.  No RNG.
        ap_type = 'obj';
        appear = SMS_GOLD_PIECE;
        resolved = true;
    } else if (rt === DELPHI_RT) {
        // C ref: Delphi -> statue or fountain, one rn2(2).
        if (rn2(2)) { ap_type = 'obj'; appear = SMS_STATUE; }
        else { ap_type = 'furniture'; appear = SMS_S_FOUNTAIN; }
        resolved = true;
    } else if (rt === TEMPLE_RT) {
        // C ref: temple -> the altar.  No RNG here; the altar-alignment roll is
        // in the trailing block below, which C reaches for ANY furniture altar.
        ap_type = 'furniture';
        appear = SMS_S_ALTAR;
        resolved = true;
    } else if (rt >= SHOPBASE_RT) {
        if (rn2(10) >= dep) {
            s_sym = S_MIMIC_DEF; // -> STRANGE_OBJECT
            assign = true;
        } else {
            s_sym = get_shop_item(rt - SHOPBASE_RT);
            if (s_sym < 0) {
                ap_type = 'obj'; appear = -s_sym;
            } else if (rt === SHOPBASE_RT + FODDERSHOP && s_sym > MAXOCLASSES) {
                ap_type = 'obj';
                appear = rn2(2) ? SMS_LUMP_OF_ROYAL_JELLY : SMS_SLIME_MOLD;
            } else {
                if (s_sym === RANDOM_CLASS || s_sym >= MAXOCLASSES)
                    s_sym = SMS_SYMS[rn2(SMS_SYMS.length - 2) + 2];
                assign = true;
            }
        }
    } else {
        // C ref: ROLL_FROM(syms) — uniform over the full syms[] table.
        s_sym = SMS_SYMS[rn2(SMS_SYMS.length)];
        assign = true;
    }

    if (assign) {
        if (s_sym === MAXOCLASSES) {
            // C ref: ROLL_FROM(furnsyms) — furnsyms[] = {up,up,dn,dn,altar,
            // grave,throne,sink}; index 4 is the altar (S_altar=33).
            ap_type = 'furniture';
            const FURNSYMS = [25, 25, 26, 26, 33, 34, 35, 36];
            appear = FURNSYMS[rn2(FURNSYMS.length)];
        } else {
            ap_type = 'obj';
            if (s_sym === S_MIMIC_DEF) {
                appear = SMS_STRANGE_OBJECT;
            } else if (s_sym === COIN_CLASS) {
                appear = SMS_GOLD_PIECE;
            } else {
                const otmp = mkobj(s_sym, false);
                appear = otmp ? otmp.otyp : SMS_STRANGE_OBJECT;
            }
        }
    }

    mtmp.m_ap_type = ap_type;
    mtmp.mappearance = appear;
    // C ref: "when appearing as an object based on a monster type, pick a shape"
    // — makemon.c:2515-2545.  Ported in full: each arm's RNG is conditional on
    // the shape, so the STATUE arm a maze mimic now reaches draws rndmonnum()
    // and, for a nocorpse CORPSE, a second rn1().
    if (ap_type === 'obj'
        && (appear === SMS_STATUE || appear === SMS_FIGURINE
            || appear === SMS_CORPSE || appear === SMS_EGG || appear === SMS_TIN)) {
        let mndx = rndmonnum_local();
        // C reads svm.mvitals[mndx].mvflags & G_NOCORPSE.  allmain.c:781 seeds
        // every mvitals[i].mvflags from mons[i].geno & G_NOCORPSE at newgame and
        // nothing clears that bit, so mon_nocorpse() (which reads mons[].geno)
        // is the same predicate without depending on mvitals being populated.
        const nocorpse_ndx = mon_nocorpse(mndx);
        if (appear === SMS_CORPSE && nocorpse_ndx) {
            // rn1(PM_WIZARD - PM_ARCHEOLOGIST + 1, PM_ARCHEOLOGIST): a random
            // player-role human corpse, since the rolled species leaves none.
            mndx = rn1(PM_WIZARD_MON - PM_ARCHEOLOGIST_MON + 1, PM_ARCHEOLOGIST_MON);
        } else if ((appear === SMS_EGG && can_be_hatched(mndx) === NON_PM)
                   || (appear === SMS_TIN && nocorpse_ndx)) {
            // revert to a generic egg or an empty tin.  can_be_hatched() itself
            // draws rn2(77) for an egg-laying species — that draw is C's too.
            mndx = NON_PM;
        }
        mtmp.mcorpsenm = mndx;
    } else if (ap_type === 'obj' && appear === SMS_SLIME_MOLD) {
        // C ref: MCORPSENM = context.current_fruit, and flags.made_fruit = TRUE
        // so the player can no longer re-use that fruit slot.  No RNG.
        mtmp.mcorpsenm = game.context?.current_fruit ?? 0;
        if (game.flags) game.flags.made_fruit = true;
    } else if (ap_type === 'furniture' && appear === SMS_S_ALTAR) {
        // C ref: `int algn = rn2(3) - 1;` then
        //        MCORPSENM = (Inhell && rn2(3)) ? AM_NONE : Align2amask(algn);
        // The second rn2(3) is guarded by Inhell, so it is drawn ONLY in
        // Gehennom — where a mimicked altar is usually Moloch's.
        const algn = rn2(3) - 1;
        mtmp.mcorpsenm = (In_hell(game.u?.uz) && rn2(3)) ? AM_NONE : Align2amask(algn);
    } else if (mtmp.mcorpsenm != null) {
        // C ref: "don't retain stale value from a previously mimicked shape".
        mtmp.mcorpsenm = NON_PM;
    }

    // C ref: `if (does_block(mx, my, &levl[mx][my])) block_point(mx, my);` — a
    // mimic disguised as a boulder or statue blocks line of sight, which changes
    // what the map shows behind it.  No RNG.
    if (does_block(mx, my)) block_point(mx, my);
}

// C ref: makemon.c rndmonnum() — rndmonst() species index, RNG-faithful.
function rndmonnum_local() {
    return rndmonst()?.pmidx ?? 0;
}

// C ref: makemon.c peace_minded() — full version for the Big Room path,
// including the always_hostile (M2_HOSTILE) / always_peaceful (M2_PEACEFUL) /
// msound leader-guardian-nemesis short-circuits that return WITHOUT consuming
// RNG (e.g. a hostile lizard).  Read straight off mflags2/msound
// (js/monflags_data.js) rather than a name-keyed guess.
// C ref: mondata.h is_human(ptr) / is_minion(ptr) — (mflags2 & M2_HUMAN) and
// (mflags2 & M2_MINION).  These were hand-written name Sets; the M2_HUMAN one
// wrongly listed Charon (excluded by this build's #ifdef) and the Ranger quest
// leader's Earendil/Elwing spellings, whose species is M2_ELF.  Derived from
// the flag table so they cannot drift; every NAMS() spelling is included, since
// a by-name caller may use any of the three.
const _names_with_mflag2 = (bit) => {
    const out = new Set();
    for (const mon of MONS) {
        if (!mon.name || !(mflags2_of(mon) & bit)) continue;
        out.add(mon.name);
        const g = _GENDERED_BY_NEUTRAL.get(mon.name);
        if (g) { out.add(g[0]); out.add(g[1]); }
    }
    return out;
};
export const M2_HUMAN_NAMES = _names_with_mflag2(M2_HUMAN);
export const M2_MINION_NAMES = _names_with_mflag2(M2_MINION);

// C ref: role.c races[].lovemask / .hatemask, keyed off gu.urace.  race_hostile
// /race_peaceful (mondata.h) test `ptr->mflags2 & mask` directly, so the masks
// below are transcribed straight from the races[] table (lovemask, hatemask
// fields, in that order) instead of enumerating names per race:
//   human: lovemask 0,                hatemask M2_GNOME|M2_ORC
//   elf:   lovemask M2_ELF,           hatemask M2_ORC
//   dwarf: lovemask M2_DWARF|M2_GNOME, hatemask M2_ORC
//   gnome: lovemask M2_DWARF|M2_GNOME, hatemask M2_HUMAN
//   orc:   lovemask 0,                hatemask M2_HUMAN|M2_ELF|M2_DWARF
function urace_masks() {
    const adj = String(game.urace?.adj || game.urace?.noun || 'human').toLowerCase();
    switch (adj) {
    case 'elven': case 'elf':
        return { lovemask: M2_ELF, hatemask: M2_ORC };
    // roles.js races[].adj for dwarf is 'dwarven', so 'dwarvish' alone never matched.
    case 'dwarvish': case 'dwarven': case 'dwarf':
        return { lovemask: M2_DWARF | M2_GNOME, hatemask: M2_ORC };
    case 'gnomish': case 'gnome':
        return { lovemask: M2_DWARF | M2_GNOME, hatemask: M2_HUMAN };
    case 'orcish': case 'orc':
        return { lovemask: 0, hatemask: M2_HUMAN | M2_ELF | M2_DWARF };
    case 'human': default:
        return { lovemask: 0, hatemask: M2_GNOME | M2_ORC };
    }
}

export function peace_minded_bigrm(ptr) {
    const f2 = mflags2_of(ptr);
    if (f2 & M2_PEACEFUL) return true;   // always_peaceful, no RNG
    if (f2 & M2_HOSTILE) return false;   // always_hostile, no RNG
    // msound leader/guardian -> peaceful; nemesis -> hostile (no RNG).
    const snd = msound_of(ptr);
    if (snd === MS_LEADER || snd === MS_GUARDIAN) return true;
    if (snd === MS_NEMESIS) return false;
    // PM_ERINYS: return !u.ualign.abuse; abuse is 0 in the slice -> peaceful (no RNG).
    if (ptr.name === 'erinys') return !(game.u?.ualign?.abuse);
    // race_peaceful / race_hostile against the hero's race love/hate masks (no RNG).
    const rm = urace_masks();
    if (f2 & rm.lovemask) return true;
    if (f2 & rm.hatemask) return false;
    const mal = ptr.maligntyp ?? 0;
    const ual = game.u?.ualign?.type ?? 0;
    if (sgn(mal) !== sgn(ual)) return false;          // differently aligned, no RNG
    if (mal < 0 && game.u?.uhave?.amulet) return false;
    const record = game.u?.ualign?.record ?? 0;
    // is_minion -> result is record>=0, NO RNG.
    if (f2 & M2_MINION) return record >= 0;
    // C ref: makemon.c:2305-2307 — `rn2(16 + ...) && rn2(2 + abs(mal))`.  The
    // && SHORT-CIRCUITS: when the first roll comes up 0 the second one is never
    // evaluated, so it must not be drawn here either.
    if (!rn2(16 + (record < -15 ? -15 : record))) return false;
    return !!rn2(2 + Math.abs(mal));
}

// C ref: makemon.c:2321 set_malign(mtmp) — the alignment-point value of KILLING
// this monster, banked on the monster at creation time (and re-banked whenever
// its peaceful/tame state changes) because xkilled() reads mtmp->malign long
// after u.ualign.type could have been consulted.  No RNG.  Without it every kill
// left u.ualign.record at gu.urole.initrecord, which silently picks the WRONG
// MODULUS for peace_minded()'s `rn2(16 + u.ualign.record)` on every later
// makemon (seed0030 seg6: C drew rn2(21), we drew rn2(16)).
export function set_malign(mtmp) {
    const ptr = mtmp?.data;
    if (!ptr) return;
    let mal = ptr.maligntyp ?? 0;
    if (mtmp.ispriest || mtmp.isminion) {
        if (mtmp.ispriest && mtmp.epri) mal = mtmp.epri.shralign ?? mal;
        else if (mtmp.isminion && mtmp.emin) mal = mtmp.emin.min_align ?? mal;
        if (mal !== A_NONE) mal *= 5;
    }
    const coaligned = sgn(mal) === sgn(game.u?.ualign?.type ?? 0);
    const absmal = Math.abs(mal);
    const f2 = mflags2_of(ptr);
    if (msound_of(ptr) === MS_LEADER) {
        mtmp.malign = -20;
    } else if (mal === A_NONE) {
        mtmp.malign = mtmp.mpeaceful ? 0 : 20; /* really hostile */
    } else if (f2 & M2_PEACEFUL) {            /* always_peaceful */
        mtmp.malign = (mtmp.mpeaceful ? -3 : 3) * Math.max(5, absmal);
    } else if (f2 & M2_HOSTILE) {             /* always_hostile */
        mtmp.malign = coaligned ? 0 : Math.max(5, absmal);
    } else if (coaligned) {
        mtmp.malign = mtmp.mpeaceful ? -3 * Math.max(3, absmal)
                                     : Math.max(3, absmal); /* renegade */
    } else {
        mtmp.malign = absmal;
    }
}

// C ref: mon.c pickvampshape().  mtmp.cham holds the base vampire pmidx.
// Returns the pmidx of the shape to take.  uppercase_only (rogue level) and
// pool/lava checks are false for Vlad's Tower.
function pickvampshape(mtmp) {
    let mndx = mtmp.cham;
    let wolfchance = 10;
    switch (mndx) {
    case PM_VLAD_THE_IMPALER:
        // mon_has_special: Vlad carries the Candelabrum, so Vlad never reaches
        // here via newcham (handled separately) — keep faithful anyway.
        wolfchance = 3;
        /* FALLTHROUGH */
    case PM_VAMPIRE_LEADER:
        if (!rn2(wolfchance)) { mndx = PM_WOLF; break; }
        /* FALLTHROUGH */
    case PM_VAMPIRE:
        mndx = (!rn2(4)) ? PM_FOG_CLOUD : PM_VAMPIRE_BAT;
        break;
    }
    // C: revert to base if chosen target genocided, or randomly (rn2(4)) if
    // already in an alternate form.  For a fresh vampire mtmp.data === base so
    // the (data != cham) clause is false and no rn2(4) is drawn.
    const base = mtmp.cham;
    if ((mtmp.data && mtmp.data.pmidx !== base) && !rn2(4))
        return base;
    return mndx;
}

// C ref: mon.c mgender_from_permonst().  Draws rn2(10) only when the new form
// isn't fixed-gender/neuter; the gender flip itself is suppressed for
// vampires/vampshifters (but the rn2(10) is still consumed).
function mgender_from_permonst(mtmp, mdat) {
    if (mdat.gcode === 1) { mtmp.female = 0; }
    else if (mdat.gcode === 2) { mtmp.female = 1; }
    else if (mdat.gcode !== 3) { /* femaleok */
        const isVamp = (mdat.mcls === S_VAMPIRE)
            || (mtmp.cham === PM_VAMPIRE || mtmp.cham === PM_VAMPIRE_LEADER
                || mtmp.cham === PM_VLAD_THE_IMPALER);
        if (!rn2(10) && !isVamp) mtmp.female = mtmp.female ? 0 : 1;
    }
}

// ── shapechangers ────────────────────────────────────────────────────────────
// C ref: mon.c pm_to_cham() — "as of 3.6.0 we just check M2_SHAPESHIFTER
// instead of having a big switch statement with hardcoded shapeshifter types".
// The JS port used to test `ptr.mcls === S_VAMPIRE`, which is the same
// name-keyed guess that flag exists to replace: it misses the chameleon, the
// doppelganger and the sandestin, so makemon() left them non-shapechangers and
// skipped the newcham() their creation is supposed to run.
export function pm_to_cham(mndx) {
    const ptr = monster_by_pmidx(mndx);
    return (ptr && is_shapeshifter_flag(ptr)) ? mndx : NON_PM;
}

// C ref: mon.c mon_animal_list()/pick_animal().  animal_list[] is every
// mons[] index below SPECIAL_PM (the long worm tail, the first non-normal
// entry) with M1_ANIMAL set, built once and cached exactly as C caches
// ga.animal_list.  The list's ORDER and LENGTH are load-bearing: pick_animal
// draws rn2(animal_list_count) and indexes straight into it.
let animal_list = null;
function mon_animal_list() {
    if (animal_list) return animal_list;
    animal_list = [];
    for (let i = 0; i < SPECIAL_PM; i++) {
        const p = monster_by_pmidx(i);
        if (p && is_animal(p)) animal_list.push(i);
    }
    return animal_list;
}
function pick_animal() {
    const list = mon_animal_list();
    let res = list[rn2(list.length)];
    // Rogue level wants uppercase symbols; C retries exactly once.
    if (Is_rogue_level(game.u?.uz) && !is_upper_monsym(res))
        res = list[rn2(list.length)];
    return res;
}
function is_upper_monsym(mndx) {
    const c = monster_by_pmidx(mndx)?.mlet || '?';
    return c >= 'A' && c <= 'Z';
}

// C ref: wizard.c nasties[] — 44 entries in the C source order (neutral block,
// then chaotic, then lawful).  ROLL_FROM(nasties) is rn2(44), so both the
// contents and the order matter; resolved by name so a shifted mons[] index
// can't silently corrupt the table.
const NASTY_NAMES = [
    /* neutral */
    'cockatrice', 'ettin', 'stalker', 'minotaur',
    'owlbear', 'purple worm', 'xan', 'umber hulk',
    'xorn', 'zruty', 'leocrotta', 'baluchitherium',
    'carnivorous ape', 'fire elemental', 'jabberwock',
    'iron golem', 'ochre jelly', 'green slime',
    'displacer beast', 'genetic engineer',
    /* chaotic */
    'black dragon', 'red dragon', 'arch-lich', 'vampire lord',
    'master mind flayer', 'disenchanter', 'winged gargoyle',
    'storm giant', 'Olog-hai', 'elf-noble', 'elven monarch',
    'ogre tyrant', 'captain', 'gremlin',
    /* lawful */
    'silver dragon', 'orange dragon', 'green dragon',
    'yellow dragon', 'guardian naga', 'fire giant',
    'Aleax', 'couatl', 'horned devil', 'barbed devil',
];
let nasties_idx = null;
function nasties_table() {
    if (!nasties_idx) nasties_idx = NASTY_NAMES.map((n) => name_to_pmidx(n));
    return nasties_idx;
}

// C ref: wizard.c pick_nasty(difcap).  One ROLL_FROM, an extra ROLL_FROM on the
// rogue level, then a NON-RNG substitution pass (arch-lich -> master lich etc).
export function pick_nasty(difcap) {
    const nasties = nasties_table();
    let res = nasties[rn2(nasties.length)];
    if (Is_rogue_level(game.u?.uz) && !is_upper_monsym(res))
        res = nasties[rn2(nasties.length)];

    // Substitute a lesser form when the pick is genocided, too difficult, or
    // out of place for this half of the dungeon.  No RNG in any of this.
    let alt = res;
    const rp = monster_by_pmidx(res);
    const hell = In_hell(game.u?.uz);
    if ((mvflags(res) & G_GENOD) !== 0
        || (difcap > 0 && (rp?.difficulty ?? 0) >= difcap)
        || ((rp?.geno ?? 0) & (hell ? G_NOHELL : G_HELL)) !== 0)
        alt = big_to_little(res);
    if (alt !== res && (mvflags(alt) & G_GENOD) === 0) {
        const mnam = monster_by_pmidx(alt)?.name || '';
        const lastspace = mnam.lastIndexOf(' ');
        const tail = lastspace < 0 ? '' : mnam.slice(lastspace);
        // only non-juveniles can become the alternate choice
        if (!mnam.startsWith('baby ')
            && (lastspace < 0
                || (tail !== ' hatchling' && tail !== ' pup' && tail !== ' cub')))
            res = alt;
    }
    return res;
}

// C ref: topten.c get_rnd_toptenentry().  Draws rnd(sysopt.tt_oname_maxrank)
// — 10 in the shipped sysconf — and then reads that many entries from the
// score file.  Our port keeps no score file, which is the same state C is in
// for a fresh installation: readentry() yields points == 0 on the first entry,
// so the `rank > 1` retry rewinds, hits points == 0 again, and returns NULL.
// Neither the rewind nor the second scan draws anything, so the whole call is
// worth exactly one rnd(10) regardless of how the file reads.
const TT_ONAME_MAXRANK = 10;    // sysconf `tt_oname_maxrank`
function get_rnd_toptenentry() {
    rnd(TT_ONAME_MAXRANK);
    return null;
}

// C ref: topten.c tt_doppel() — a doppelganger impersonating a past player.
// With no score entries the `!tt` arm always fires, and its rn1() is the second
// of the two rn2(13)-shaped draws C records at topten.c:1446 and :1450.
function tt_doppel(_mon) {
    const tt = rn2(13) ? get_rnd_toptenentry() : null;
    if (!tt)
        return rn1(PM_WIZARD_MON - PM_ARCHEOLOGIST_MON + 1, PM_ARCHEOLOGIST_MON);
    return NON_PM; /* unreachable while the score file is empty */
}

// Quest-guardian pmidx block (monsters.h "student" .. "apprentice").
const PM_STUDENT_MON = 369, PM_APPRENTICE_MON = 382;

// C ref: mon.c select_newcham_form() — the full cham switch.  Every arm's RNG
// is distinct, and this is the function seed4500 diverged on at step 326: a
// doppelganger generated on Dlvl 40 draws rn2(7) then rn2(3) then tt_doppel's
// pair, none of which our port made.
function select_newcham_form(mon) {
    let mndx = NON_PM, tryct;
    switch (mon.cham) {
    case PM_SANDESTIN:
        if (rn2(7))
            mndx = pick_nasty((monster_by_pmidx(PM_ARCHON)?.difficulty ?? 0) - 1);
        break;
    case PM_DOPPELGANGER:
        if (!rn2(7)) {
            mndx = pick_nasty((monster_by_pmidx(PM_JABBERWOCK)?.difficulty ?? 0) - 1);
        } else if (rn2(3)) {            /* role monsters */
            mndx = tt_doppel(mon);
        } else if (!rn2(3)) {           /* quest guardians */
            mndx = rn1(PM_APPRENTICE_MON - PM_STUDENT_MON + 1, PM_STUDENT_MON);
            if (mndx === game.urole?.guardnum) mndx = NON_PM; /* not own role's */
        } else {                        /* general humanoids */
            tryct = 5;
            do {
                mndx = rn1(SPECIAL_PM - 0 /*LOW_PM*/, 0 /*LOW_PM*/);
                const p = monster_by_pmidx(mndx);
                if (p && humanoid_flag(p) && polyok_flag(p)) break;
            } while (--tryct > 0);
            if (!tryct) mndx = NON_PM;
        }
        break;
    case PM_CHAMELEON:
        if (!rn2(3)) mndx = pick_animal();
        break;
    case PM_VLAD_THE_IMPALER:
    case PM_VAMPIRE_LEADER:
    case PM_VAMPIRE:
        mndx = pickvampshape(mon);
        break;
    case NON_PM:                        /* ordinary monster */
        // C consults worn dragon scales/mail here.  A freshly created monster
        // has no armor yet (m_initinv runs later, and newcham disables it), so
        // this arm leaves mndx as NON_PM and draws nothing.
        break;
    }

    // C ref: mon.c:5213 — "if no form was specified above, pick one at random
    // now".  Omitting this made every arm that declines (a chameleon's rn2(3),
    // an ordinary monster) return NON_PM, and newcham's retry loop re-ran the
    // whole switch instead of drawing C's single rn1(SPECIAL_PM-LOW_PM,LOW_PM).
    // The while condition is C's, ANDed: outside the Rogue level it always
    // fails, so exactly one draw happens.
    if (mndx === NON_PM) {
        tryct = 50;
        do {
            mndx = rn1(SPECIAL_PM - 0 /*LOW_PM*/, 0 /*LOW_PM*/);
        } while (--tryct > 0 && !validspecmon(mon, mndx)
                 && (tryct > 40 && Is_rogue_level(game.u?.uz)
                     && !is_upper_monsym(mndx)));
    }
    return mndx;
}

// C ref: mon.c:4993 validspecmon(mon, mndx).
function validspecmon(mon, mndx) {
    if (mndx === NON_PM) return true;
    if (!accept_newcham_form(mon, mndx)) return false;
    // C ref: monst.h isspecmon(mon) — shopkeeper/priest/guard/Wizard; their new
    // form must still be able to take objects and talk (notake/!has_head).
    // No such monster is ever a shapechanger in this port, so the extra
    // rejection never fires; kept so the predicate reads like C's.
    return true;
}

export function pickvampshape_pub(mtmp) { return pickvampshape(mtmp); }

// C ref: mon.c accept_newcham_form().  Pure predicate, no RNG.
function accept_newcham_form(mon, mndx) {
    if (mndx === NON_PM) return null;
    const mdat = monster_by_pmidx(mndx);
    if (!mdat) return null;
    if ((mvflags(mndx) & G_GENOD) !== 0) return null;
    // placeholder entries (orc/giant/elf/human) exist only for corpses
    if (mndx === PM_ORC_PLACEHOLDER || mndx === PM_GIANT_PLACEHOLDER
        || mndx === PM_ELF_PLACEHOLDER || mndx === PM_HUMAN_PLACEHOLDER)
        return null;
    // select_newcham_form() may deliberately pick a player-monster type, which
    // polyok() rejects — C special-cases it, so we must too.
    if (mndx >= PM_ARCHEOLOGIST_MON && mndx <= PM_WIZARD_MON) return mdat;
    // a shapeshifter is allowed back into its own natural form
    if (is_shapeshifter_flag(mdat) && mon.cham !== NON_PM && mndx === mon.cham)
        return mdat;
    return polyok_flag(mdat) ? mdat : null;
}

// C ref: mon.c newcham() — the random-shape path (mdat == 0), which is the one
// makemon.c:1367 uses for every newly created shapechanger.  Returns 1 if the
// form actually changed.  The retry loop is C's: select_newcham_form() can
// return a form accept_newcham_form() rejects, and each retry re-draws.
export function newcham(mtmp, mdat) {
    const olddata = mtmp.data;
    if (mdat == null) {
        let tryct = 20, mndx;
        do {
            mndx = select_newcham_form(mtmp);
            mdat = accept_newcham_form(mtmp, mndx);
            // for the first several tries require upper-case on the rogue level
            if (tryct > 15 && Is_rogue_level(game.u?.uz)
                && mdat && !is_upper_monsym(mdat.pmidx))
                mdat = null;
            if (mdat) break;
        } while (--tryct > 0);
        if (!tryct) return 0;
    } else if ((mvflags(mdat.pmidx) & G_GENOD) !== 0) {
        return 0;
    }
    if (!mdat || mdat === olddata || mdat.pmidx === olddata?.pmidx)
        return 0;                       /* still the same monster */

    mgender_from_permonst(mtmp, mdat);
    // "give the new form the same proportion of HP as its old one had" — no
    // RNG in the arithmetic; newmonhp() draws d(m_lev, 8) for the new form.
    const hpn = mtmp.mhp, hpd = mtmp.mhpmax || 1;
    const tmp = { data: mdat };
    newmonhp(tmp);
    mtmp.m_lev = tmp.m_lev;
    mtmp.mhpmax = tmp.mhpmax;
    let nhp = Math.floor((hpn * tmp.mhp) / hpd);
    if (nhp < 0 || nhp > mtmp.mhpmax) nhp = mtmp.mhpmax;
    mtmp.mhp = nhp || 1;
    mtmp.data = mdat;
    return 1;
}

// Retained name for the Vlad's-Tower call sites; newcham() now covers every
// shapechanger, vampires included.
export function newcham_vamp(mtmp, mdat) { return newcham(mtmp, mdat); }

// C ref: teleport.c goodpos(x, y, worm, 0) as worm.c's
// place_worm_tail_randomly() calls it.  A long worm is not a swimmer, not
// airborne, does not pass walls and is not amorphous, and gpflags is 0 (so
// neither GP_AVOID_MONPOS nor GP_CHECKSCARY applies), which reduces the
// predicate to: in bounds, not the hero's square, no other monster there,
// not water/lava, accessible terrain, no boulder.  (Defined here rather than
// reusing teleport.js's goodpos() to avoid a makemon <-> teleport cycle.)
function worm_goodpos(x, y, worm) {
    if (x < 1 || x >= COLNO || y < 0 || y >= ROWNO) return false;  // !isok
    if (game.u?.ux === x && game.u?.uy === y) return false;
    const mtmp2 = mm_mon_at(x, y);
    if (mtmp2 && mtmp2 !== worm) return false;
    if (mm_is_pool(x, y) || mm_is_lava(x, y)) return false;
    const typ = game.level?.at(x, y)?.typ;
    if (typ == null || typ < DOOR) return false;   // !accessible
    return true;
}

// C ref: mondata.c:1629 mon_learns_traps().  Duplicated rather than imported
// from monmove.js: monmove.js already imports from here, and makemon.js sits
// below it in the graph — importing back would close the cycle at module-init
// time, not just at call time.
function mon_learns_traps_local(mtmp, ttyp) {
    if (ttyp === ALL_TRAPS) { mtmp.mtrapseen = ~0; return; }
    mtmp.mtrapseen = (mtmp.mtrapseen || 0) | (1 << (ttyp - 1));
}

// C ref: makemon.c:1303-1346 `switch (ptr->mlet)` — runs right after
// place_monster()/mpeaceful for EVERY makemon() caller.  Shared with
// makemon_rnd_spawn(), which reimplements makemon() for the x==0,y==0 random
// spawn and used to skip the whole switch: a leprechaun spawned by
// maybe_generate_rnd_mon() came out awake, moved, and desynced m_move's
// rn2(4*(cnt-j)) (w3-elf-wiz-debug step 149).
// S_MIMIC's set_mimic_sym and the S_JABBERWOCK/S_NYMPH rn2(5) DRAW RNG.
function makemon_mlet_switch(mtmp, ptr, x, y) {
    // C ref: makemon.c:1304 — set_mimic_sym() consumes RNG (rn2(17)
    // ROLL_FROM(syms) + the mkobj that follows, rn2(10) + get_shop_item in a
    // shop).  C runs it for EVERY mimic; gating it on the full-monster-gen
    // flags dropped the draws for des.monster()-placed mimics (seed0360
    // step 211: soko1's two "giant mimic" boulders).
    if (ptr.mcls === 13 /* S_MIMIC */ && x && y) {
        set_mimic_sym(mtmp);
    }

    // The S_SPIDER/S_SNAKE and S_EEL cases guard their body on in_mklev and are
    // handled by the level-gen path; the rest run unconditionally.
    switch (ptr.mcls) {
    case 12: // S_LEPRECHAUN
        mtmp.msleeping = true;
        break;
    case 36: // S_JABBERWOCK
    case 14: // S_NYMPH
        if (rn2(5) && !game.u?.uhave?.amulet) mtmp.msleeping = true;
        break;
    case 15: // S_ORC
        if (game.urace?.adj === 'elf') mtmp.mpeaceful = false;
        break;
    case 21: // S_UNICORN
        if (ptr.name && ptr.name.endsWith('unicorn')
            && Math.sign(game.u?.ualign?.type ?? 0) === Math.sign(ptr.maligntyp ?? 0))
            mtmp.mpeaceful = true;
        break;
    case S_BAT:
        // C ref: makemon.c:1343-1346 / mondata.h is_bat().  `is_bat()` is
        // intentionally narrower than the shared S_BAT class: birds share it.
        // mon_adjust_speed() sets both permanent and current speed fields.
        if (In_hell(game.u?.uz) && is_bat(ptr)) {
            mtmp.permspeed = MFAST;
            mtmp.mspeed = MFAST;
        }
        break;
    case 25: // S_LIGHT
    case 31: // S_ELEMENTAL
        if (ptr.name === 'stalker' || ptr.name === 'black light') {
            mtmp.perminvis = true;
            mtmp.minvis = true;
        }
        break;
    }
}

// C ref: mondata.h is_bat().  Keep this by species name instead of generated
// table offsets so a future monster-table regeneration cannot retarget it.
function is_bat(ptr) {
    return ptr?.name === 'bat' || ptr?.name === 'giant bat'
        || ptr?.name === 'vampire bat';
}

export function makemon(mdat = null, x = 0, y = 0, mmflags = 0) {
    let ptr = mdat;
    let allow_minvent = true;

    // C ref: makemon.c:1167 — `if (iflags.debug_mongen || (!svl.level.flags
    // .rndmongen && !ptr)) return 0;`  A level whose script cleared rndmongen
    // (des.level_flags("norandmonst")) never gets a RANDOM monster; a
    // caller-named species still does.  Tested against `=== false` so a level
    // that has not written the flag keeps C's default of TRUE.
    if (!mdat && game.level?.flags?.rndmongen === false) return null;

    // C ref: makemon.c:1194 — "Does monster already exist at the position?"
    // Without MM_ADJACENTOK this is a bare early return that consumes NO RNG,
    // and it is load-bearing for fill_zoo(): C tries to stock every square of a
    // COURT including the one the throne monster already occupies, and that
    // makemon call must fail silently rather than draw next_ident/newmonhp.
    // (x==0,y==0 means "caller wants a random location", which this port
    // resolves in makemon_rnd_spawn() before reaching here.)
    //
    // This runs BEFORE the species roll, as it does in C: for a random monster
    // C has not called rndmonst() yet at this point, so an occupied square
    // costs no RNG at all.
    //
    // C ref: makemon.c:1172 — "if caller wants random location, do it here",
    // i.e. x == 0 && y == 0 resolves through makemon_rnd_goodpos() BEFORE
    // anything else.  makemon_rnd_spawn() is the pre-resolved entry point used
    // by the movemon spawn path, but callers that pass a known species and no
    // position (mk_trap_statue's `makemon(&mons[...], 0, 0, ...)`) reach here
    // with x == y == 0 and must get the position search, which draws
    // rn1(COLNO-3,2)/rn2(ROWNO) per attempt.
    if (x === 0 && y === 0) {
        const pos = makemon_rnd_goodpos(ptr);
        if (!pos) return null;
        x = pos.x; y = pos.y;
    }
    if (x > 0 && mm_mon_at(x, y)) {
        if (!(mmflags & MM_ADJACENTOK)) return null;
        const cc = enexto_spawn(x, y, ptr);
        if (!cc) return null;
        x = cc.x; y = cc.y;
    }

    if (!ptr) {
        // C ref: makemon.c:1218-1231 — "make a random (common) monster that can
        // survive here.  (the special levels ask for random monsters at specific
        // positions, causing mass drowning on the medusa level, for instance.)"
        //
        //     do {
        //         if (!(ptr = rndmonst())) return NULL;
        //         fakemon.data = ptr;
        //     } while (++tryct <= 50
        //              && ((tryct == 1 && throws_rocks(ptr) && In_sokoban(&u.uz))
        //                  || !goodpos(x, y, &fakemon, gpflags)));
        //
        // The re-roll is not cosmetic: each retry is a fresh rndmonst() species
        // scan, ~150 rn2() draws.  Taking the first roll unconditionally is what
        // desynced seed4500 on Dlvl 40 once the earlier mimic/shapechanger bugs
        // were fixed — C rejected its first pick for the square and rolled
        // again while we kept ours.  goodpos() itself can draw (the eel rn2(13)).
        let tryct = 0;
        for (;;) {
            ptr = rndmonst();
            if (!ptr) return null;               /* no more monsters! */
            if (++tryct > 50) break;
            const balks = (tryct === 1 && throws_rocks_flag(ptr)
                           && In_sokoban(game.u?.uz))
                || !goodpos_spawn(x, y, ptr);
            if (!balks) break;
        }
    }
    if (!ptr) return null;
    // C ref: makemon.c:1208 — an explicitly requested species that has been
    // genocided is refused before anything is allocated or rolled.  (The random
    // arm above can't produce one: rndmonst()'s uncommon() already skips
    // G_GONE species.)
    if (mdat && (mvflags(ptr.pmidx) & G_GENOD) !== 0) return null;
    // C ref: makemon.c:1233 `(void) propagate(mndx, countbirth, FALSE);`
    propagate(ptr.pmidx, (mmflags & MM_NOCOUNTBIRTH) === 0, false);

    const mtmp = { data: ptr, mx: x, my: y, mmflags };
    if (globalThis.__NHMONDBG) globalThis.__NHMONDBG.push([globalThis.__NHRNGLEN(), ptr.name, ptr.mcls, ptr.gcode]);
    // C ref: makemon.c:1245 `if (mmflags & MM_ASLEEP) mtmp->msleeping = 1;`.
    // No RNG, but msleeping gates every monster's turn in dochug(), so a caller
    // that asked for a sleeping monster got a wide-awake one instead.
    if (mmflags & MM_ASLEEP) mtmp.msleeping = 1;
    mtmp.m_id = next_ident();
    // C ref: makemon.c:1254 `mtmp->mnum = mndx;` — the species index every
    // monsndx()-shaped consumer reads.
    mtmp.mnum = ptr.pmidx;
    newmonhp(mtmp);
    // C makemon.c:1259-1279: femaleok = (!is_male && !is_neuter).  For monsters
    // that aren't fixed-gender (is_male/is_female) and aren't leader/nemesis
    // (none in this slice), the gender draw rn2(2) happens only when femaleok.
    // gcode: 0 femaleok -> rn2(2); 1 male -> female=0; 2 female -> female=1;
    // 3 neuter -> female=0.  No RNG is consumed for fixed-gender/neuter mons.
    // C ref: makemon.c:1264-1266 — MM_MALE/MM_FEMALE win over the random roll
    // (and consume nothing) when the species allows that gender; the roll only
    // happens on the final `else`.
    if (ptr.gcode === 2) mtmp.female = 1;                       /* is_female */
    else if (ptr.gcode === 1 || ptr.gcode === 3) mtmp.female = 0; /* male/neuter */
    else if (mmflags & MM_FEMALE) mtmp.female = 1;
    else if (mmflags & MM_MALE) mtmp.female = 0;
    // C ref: makemon.c:1270-1273 — a quest leader's/nemesis's gender was already
    // chosen by role_init() (quest_status.ldrgend/nemgend), so makemon does NOT
    // roll rn2(2) for it.  Every leader and every nemesis but Arc's Minion of
    // Huhetotl and Wiz's Dark One is fixed-gender, so those two are the only
    // species this arm actually saves a draw for.
    else if (msound_of(ptr) === MS_LEADER) mtmp.female = game.quest_ldrgend | 0;
    else if (msound_of(ptr) === MS_NEMESIS) mtmp.female = game.quest_nemgend | 0;
    else mtmp.female = rn2(2);

    // C ref: makemon.c:1281-1289 — trap knowledge is granted at CREATION; no
    // RNG here, but mtrapseen was written nowhere on this path (only
    // priest.js:92), so mon_knows_traps() answered FALSE for every generated
    // monster.  mfndpos (mon.c:2365) then kept trapped squares C drops from the
    // candidate list, and cnt is the rn2(4*(cnt-j)) modulus in m_move.
    // mondata.c:1629 mon_learns_traps: bit (ttyp-1), ALL_TRAPS -> ~0.
    // sokoban_dnum guard: In_sokoban() compares dnum to an undefined
    // game.sokoban_dnum, so both-undefined reads as TRUE before the branch exists.
    if (game.sokoban_dnum != null && In_sokoban(game.u?.uz) && !mindless(ptr)) {
        mon_learns_traps_local(mtmp, PIT);
        mon_learns_traps_local(mtmp, HOLE);
    }
    if (Is_stronghold(game.u?.uz) && !mindless(ptr))
        mon_learns_traps_local(mtmp, TRAPDOOR);
    // Leader/nemesis know every trap type — unconditional in C, not gated on
    // mindless.  MSOUND's MS_LEADER/MS_NEMESIS membership re-audited BY NAME
    // against monsters.h (13 leaders / 12 nemeses, exact) after 9321d2b.
    if (msound_of(ptr) === MS_LEADER || msound_of(ptr) === MS_NEMESIS)
        mon_learns_traps_local(mtmp, ALL_TRAPS);

    // C ref: makemon.c:1299 — `mtmp->mpeaceful = (mmflags & MM_ANGRY) ? FALSE
    // : peace_minded(ptr);`, straight-line code with no enclosing guard.  This
    // was gated on `(game._bigrm_gen || game._full_mon_gen)` with a comment
    // pleading that "the JS monster-alignment data isn't C-exact everywhere" —
    // but mflags2/msound now come from the machine-generated, C-verified
    // monflags_data.js, and u.ualign.record (the rn2(16 + record) modulus) is
    // seeded from urole.initrecord.  The gate was a hand-maintained allowlist
    // that grew one recorded session at a time, which is the overfit signature;
    // every ungated caller left mpeaceful unset.
    // C ref: makemon.c:1296 — `mtmp->mcansee = mtmp->mcanmove = TRUE;`, right
    // before mpeaceful.  Neither was ever set here, so every generated monster
    // carried mcanmove === undefined and `!mon.mcanmove` — C's helpless(mon)
    // test — answered TRUE for ALL of them.  Consequences: hack.c
    // monster_nearby() saw no adjacent monster, so dosearch()/donull()'s
    // safe_wait block never fired ("You already found a monster." unprinted, and
    // the turn spent that C does not spend); and escape_from_sticky_mon() picks
    // its rn2 MODULUS off mcanmove (8 for a helpless holder, 40 otherwise).
    mtmp.mcansee = 1;
    mtmp.mcanmove = 1;
    // C ref: makemon.c:1297 — `mtmp->mgenmklev = gi.in_mklev;`.  Read by
    // mon.c mm_2way_aggression() (js/monmove.js) to suppress the zombie-maker
    // attack-on-sight bonus between two monsters both stocked at level
    // creation; that guard was dead until this field was written.
    mtmp.mgenmklev = !!game.in_mklev;
    mtmp.mpeaceful = (mmflags & MM_ANGRY) ? false : !!peace_minded_bigrm(ptr);
    // C ref: makemon.c:1288-1292 — locations whose inhabitants have already met
    // wands, so muse.c doesn't make them re-learn.  No RNG here, but mwandexp
    // gates the "monster knows what this wand does" branch in muse.
    if (Is_stronghold(game.u?.uz) || In_endgame(game.u?.uz)
        || In_hell(game.u?.uz))
        mtmp.mwandexp = true;
    // C ref: makemon.c:1301 — `if (mmflags & MM_MINVIS) mon_set_minvis(mtmp)`,
    // used by #wizgenesis (^G).  mon_set_minvis sets minvis; perminvis is for
    // species that are permanently invisible (the S_LIGHT/S_ELEMENTAL case).
    if (mmflags & MM_MINVIS) mtmp.minvis = 1;

    // C ref: makemon.c:1307-1312 — the per-mlet switch.  S_SPIDER and S_SNAKE
    // monsters generated during level creation (gi.in_mklev) at a real position
    // drop a random object on their square and then hide under it.  This is the
    // giant spider that mktrap() puts on a WEB during Big Room generation: the
    // mkobj_at(RANDOM_CLASS) draw happens AFTER gender/peace_minded and BEFORE
    // m_initinv.  hideunder() consumes no RNG.
    if ((ptr.mcls === 19 /* S_SPIDER */ || ptr.mcls === 45 /* S_SNAKE */)
        && game.in_mklev && x && y) {
        mkobj_at(0 /* RANDOM_CLASS */, x, y, true);
        // C ref: makemon.c:1312 hideunder(mtmp) — a concealing (M1_CONCEAL)
        // hider hides under the object it just dropped.  During in_mklev there's
        // no message and no RNG; the effect is just mundetected=1 (so the square
        // renders as the object, not the monster).  Condition mirrors mon.c
        // hideunder(): concealing species, an object present, dry ground, and
        // not on a non-pit trap (siege snakes here are never on a trap).
        // C ref: mon.c hideunder() gating: a hider can't hide while on a trap
        // that isn't a pit (e.g. the giant spider mktrap() drops onto a WEB stays
        // visible), and can_hide_under_obj() rejects a bare small (<10) coin pile.
        let nonPitTrap = false;
        const trps = game.level?.traps;
        if (trps) for (const t of trps) {
            if (t.tx === x && t.ty === y) { nonPitTrap = (t.ttyp !== 11 /*PIT*/ && t.ttyp !== 12 /*SPIKED_PIT*/); break; }
        }
        const objs = game.level?.objects;
        let hasObj = false, hasNonCoin = false, coinQuan = 0;
        if (objs) for (const o of objs) {
            if (o.where === 'floor' && o.ox === x && o.oy === y) {
                hasObj = true;
                if (o.oclass === COIN_CLASS) coinQuan += (o.quan || 1); else hasNonCoin = true;
            }
        }
        const canHideUnder = hasObj && (hasNonCoin || coinQuan >= 10);
        // Gated to quest- and Big-Room-generation (like peace_minded_bigrm /
        // the eel sleep roll): the ordinary level-gen path keeps the prior
        // conservative behavior (concealing hiders there shifted seed4500's
        // post-divergence frames).  Within a quest home or a Big Room,
        // spiders and snakes hide under the object they just dropped.
        if ((game._quest_gen || game._bigrm_gen) && mm_hides_under_pm(ptr)
            && canHideUnder && !nonPitTrap
            && !mm_is_pool(x, y) && !mm_is_lava(x, y)) {
            mtmp.mundetected = 1;
        }
    }

    // C ref: makemon.c:1304 — S_MIMIC monsters get an appearance via
    // set_mimic_sym(), which consumes RNG (rn2(17) ROLL_FROM(syms) + the mkobj
    // that follows, rn2(10) + get_shop_item in a shop, ...).  C runs it for
    // EVERY mimic; it used to be gated on the full-monster-gen flags here, which
    // silently dropped the draws for des.monster()-placed mimics (seed0360
    // step 211: soko1's two "giant mimic" boulders).
    makemon_mlet_switch(mtmp, ptr, x, y);

    // C ref: makemon.c:1352-1390 — mitem selection + shapechanger handling.
    // Vlad gets the Candelabrum (mongets -> next_ident + mksobj) and stays in
    // normal form; other vampires (mcls S_VAMPIRE, i.e. pm_to_cham != NON_PM)
    // become shapechangers and immediately shift via newcham, which disables
    // their starting inventory (allow_minvent FALSE — skipping m_initweap/
    // m_initinv and the trailing saddle rn2(100)).  A ghost is christened with
    // rndghostname().
    {
        let mitem = 0;
        if (ptr.pmidx === PM_VLAD_THE_IMPALER) mitem = CANDELABRUM_OF_INVOCATION;
        mtmp.cham = NON_PM;                     /* default: not a shapechanger */
        // C ref: makemon.c:1356 `if (!Protection_from_shape_changers
        //   && (mcham = pm_to_cham(mndx)) != NON_PM)`.  pm_to_cham() is the
        // M2_SHAPESHIFTER flag test, so this arm covers the chameleon, the
        // doppelganger and the sandestin as well as the vampires — each of
        // which then immediately picks a shape via newcham().  Restricting it
        // to mcls === S_VAMPIRE skipped that call for the other three, which is
        // where seed4500 lost the stream on Dlvl 40.
        const mcham = game.u?.uprops?.Protection_from_shape_changers
            ? NON_PM : pm_to_cham(ptr.pmidx);
        if (mcham !== NON_PM) {
            mtmp.cham = mcham;
            // Vlad stays in his normal shape so he can carry the Candelabrum.
            if (ptr.pmidx !== PM_VLAD_THE_IMPALER && newcham(mtmp, null))
                allow_minvent = false;
        } else if (ptr.pmidx === PM_WIZARD_OF_YENDOR_JS) {
            // C ref: makemon.c:1369-1373.  This arm was missing entirely, so no
            // monster in this port was ever flagged iswiz: levl_follower()
            // refused to bring the Wizard across a level change (seed0373 step
            // 110 wants a second mon_arrive), and every `mtmp->iswiz` predicate
            // in mcastu/muse/monmove answered FALSE for him.
            mtmp.iswiz = 1;
            game.context.no_of_wizards = (game.context.no_of_wizards | 0) + 1;
            if (game.context.no_of_wizards === 1 && Is_earthlevel(game.u?.uz))
                mitem = SPE_DIG_OTYP;
        } else if (ptr.name === 'ghost' && !(mmflags & MM_NONAME)) {
            // C ref: makemon.c:1374 `christen_monst(mtmp, rndghostname())` —
            // do_name.c rndghostname() is rn2(7) ? ROLL_FROM(ghostnames)
            // : plname, i.e. one rn2(7) plus (usually) one rn2(34).
            mtmp.mnamelth = 1;
            mtmp.mname = rndghostname();
        } else if (ptr.name === 'Croesus') {
            mitem = TWO_HANDED_SWORD_OTYP;                 // makemon.c:1377
        } else if (msound_of(ptr) === MS_NEMESIS) {
            // Every role's quest nemesis carries the Bell of Opening; mongets()
            // draws next_ident, which this chain used to skip entirely.
            mitem = BELL_OF_OPENING_OTYP;                  // makemon.c:1379
        } else if (ptr.name === 'Pestilence') {
            mitem = POT_SICKNESS_OTYP;                     // makemon.c:1381
        }
        if (mitem && allow_minvent) mongets(mtmp, mitem);  // next_ident + mksobj
    }

    // C ref: makemon.c:1386-1390 — during level creation an n-demon / Wumpus /
    // long worm / giant eel that isn't guarding the Amulet has a 4/5 chance of
    // starting asleep, consuming one rn2(5).  This draw sits AFTER the
    // mitem/shapechanger block and BEFORE group spawning / m_initweap.
    if (game.in_mklev && !game.u?.uhave?.amulet) {
        const nm = ptr.name;
        if ((is_ndemon_pm(ptr) || nm === 'giant eel' || nm === 'long worm'
             || nm === 'wumpus')
            && rn2(5))
            mtmp.msleeping = true;
    }

    // C ref: makemon.c:1396-1403 — a bribeable demon prince starts peaceful and
    // invisible (that is how one is met, and minvis changes what the square
    // renders as), and a raven leaves the wielder of a bec de corbin alone.
    if (is_dprince_pm(ptr) && msound_of(ptr) === MS_BRIBE) {
        mtmp.mpeaceful = mtmp.minvis = mtmp.perminvis = 1;
        mtmp.mavenge = 0;
        // C also drops the truce for a hero wielding Excalibur or Demonbane.
        const uwep = game.u?.uwep;
        if (uwep?.oname === 'Excalibur' || uwep?.oname === 'Demonbane')
            mtmp.mpeaceful = mtmp.mtame = false;
    }
    if (ptr.name === 'raven' && game.u?.uwep?.otyp === W_BEC_DE_CORBIN)
        mtmp.mpeaceful = true;

    // C ref: makemon.c:1405-1409 — a long worm gets a tail.  initworm() draws
    // rn2(5) for the segment count (allowtail is TRUE for every caller here),
    // and place_worm_tail_randomly() then spends one rnd_nextto_goodpos()
    // direction shuffle per segment it manages to place.
    if (ptr.name === 'long worm') {
        mtmp.wormno = get_wormno();
        if (mtmp.wormno) {
            initworm(mtmp, rn2(5));
            if (count_wsegs(mtmp))
                place_worm_tail_randomly(mtmp, x, y, worm_goodpos);
        }
    }

    // C ref: makemon.c:1430-1438 group spawning.  anymon (mdat==NULL here means
    // the species was rolled, anymon TRUE) && !(mmflags & MM_NOGRP):
    //   G_SGROUP && rn2(2) -> m_initsgrp (m_initgrp n=3 -> rnd(3))
    //   G_LGROUP -> rn2(3) ? m_initlgrp (n=10) : m_initsgrp (n=3)
    // Members are created (with MM_NOGRP) BEFORE the top monster's inventory.
    //
    // ORDER: C's place_monster() links the leader into fmon at makemon.c:1248,
    // BEFORE this block.  Since C prepends, the chain comes out
    // [last member, ..., first member, LEADER] — leader at the TAIL, visited LAST
    // by the newest-first movemon loop.  Our array is that chain reversed, so the
    // leader must sit immediately BEFORE its members.  Placing it for real here
    // instead is NOT an option: it would also expose the leader to the members'
    // own enexto()/goodpos() during level generation, moving squares and shifting
    // the RNG (measured 6250 -> 1904 screens).  So remember the FIRST MEMBER and
    // let whoever links the leader in splice it ahead of that object — an object
    // anchor rather than an index, because an index goes stale for any monster
    // whose placement happens later (that cost 200 RNG calls when tried).
    // C ref: makemon.c:1411-1425 — an ordinary (caller didn't pass MM_EPRI /
    // MM_EMIN) aligned cleric or high cleric, and one Angel in three, is set up
    // as a roaming minion with its own alignment.  Three rn2(3) draws live here
    // (the Angel gate, min_align, renegade); none of them were made, and
    // set_malign() below reads min_align through mtmp.isminion.
    if ((ptr.pmidx === PM_ALIGNED_CLERIC || ptr.pmidx === PM_HIGH_CLERIC)
        ? !(mmflags & (MM_EPRI | MM_EMIN))
        : (ptr.pmidx === PM_ANGEL && !(mmflags & MM_EMIN) && !rn2(3))) {
        const eminp = { min_align: rn2(3) - 1, renegade: 0 }; /* no A_NONE */
        eminp.renegade = (mmflags & MM_ANGRY) ? 1 : (!rn2(3) ? 1 : 0);
        mtmp.isminion = 1;                  /* make priest be a roamer */
        mtmp.emin = eminp;
        mtmp.mpeaceful = (eminp.min_align === (game.u?.ualign?.type ?? 0))
            ? !eminp.renegade : !!eminp.renegade;
    }
    set_malign(mtmp);   // makemon.c:1429 "having finished peaceful changes"
    const grpFirstIdx = game.level?.monsters?.length ?? 0;
    const anymon = (mdat == null);
    if (anymon && !(mmflags & MM_NOGRP)) {
        if ((ptr.geno & G_SGROUP) && rn2(2)) {
            m_initgrp(mtmp, mtmp.mx, mtmp.my, 3, mmflags);
        } else if (ptr.geno & G_LGROUP) {
            if (rn2(3)) m_initgrp(mtmp, mtmp.mx, mtmp.my, 10, mmflags);
            else m_initgrp(mtmp, mtmp.mx, mtmp.my, 3, mmflags);
        }
    }
    {
        const mons = game.level?.monsters;
        if (mons && mons.length > grpFirstIdx) mtmp._chainBefore = mons[grpFirstIdx];
    }

    // C ref: makemon.c:1441 — the whole block (m_initweap/m_initinv + the
    // saddle rn2(100)) is guarded by allow_minvent, which a shapeshifter's
    // newcham() clears.  For every non-shapeshifter path allow_minvent stays
    // TRUE, so behaviour is unchanged.
    if (allow_minvent) {
        // C ref: makemon.c:1442 — `if (is_armed(ptr)) m_initweap(mtmp);`, one
        // code path for every monster.
        if (is_armed_pm(ptr.pmidx, ptr.mcls, ptr.name)) m_initweap_full(mtmp);
        // C ref: makemon.c:1443 m_initinv(mtmp) — one code path for every
        // monster (per-class branches plus the rnd_defensive_item /
        // rnd_misc_item / likes_gold tail).
        m_initinv_full(mtmp);
        // C ref: makemon.c:1445.  Starting armour is worn before the monster
        // appears on the level, so it receives no wear delay and later combat
        // sees the established object-level worn mask.
        m_dowear(mtmp, true);
        // C ref: makemon.c:1447 — `if (!rn2(100) && is_domestic(ptr)
        // && can_saddle(mtmp) && !which_armor(mtmp, W_SADDLE))
        //     put_saddle_on_mon((struct obj *) 0, mtmp);`
        // The rn2(100) is the LEFT operand so it always draws; the roll was
        // being discarded, so the 1-in-100 domestic quadruped that C saddles
        // never consumed put_saddle_on_mon()'s mksobj(SADDLE) — one missing
        // next_ident draw that desyncs the rest of the level's generation.
        if (!rn2(100) && (mflags2_of(ptr) & M2_DOMESTIC) && can_saddle(mtmp)
            && !which_armor_saddle(mtmp))
            put_saddle_on_mon(mtmp);
    }
    // C ref: makemon.c:1460-1467 — mflags3 STRAT_WAITFORU/STRAT_CLOSE/
    // STRAT_APPEARMSG (no RNG).
    if (!(mmflags & MM_NOWAIT)) {
        const f3 = mflags3_of(ptr);
        if (f3 & M3_WAITFORU) mtmp.mstrategy = (mtmp.mstrategy | STRAT_WAITFORU) >>> 0;
        if (f3 & M3_CLOSE) mtmp.mstrategy = (mtmp.mstrategy | STRAT_CLOSE) >>> 0;
        // Without this, teleport.js rloc_to_core()'s `appearmsg` was dead-false
        // for every covetous/waiting monster, so a rloc'd demon lord or quest
        // nemesis silently skipped its first-appearance message.
        if (f3 & (M3_WAITMASK | M3_COVETOUS))
            mtmp.mstrategy = (mtmp.mstrategy | STRAT_APPEARMSG) >>> 0;
    }
    // C ref: makemon.c:1248 `mtmp->nmon = fmon; fmon = mtmp;` and :1295
    // `place_monster(mtmp, x, y);` — BOTH unconditional, and the link happens even
    // earlier than the placement.  This used to be gated on
    // `(game._bigrm_gen || game._full_mon_gen)`, an opt-in whitelist set only
    // around the special-level builders and shop stocking, so every other caller
    // got a monster that consumed the right RNG and then existed nowhere: the
    // wand and scroll of create monster (muse.js), domagictrap (trap.js), the
    // temple priest (priest.js), mkswamp's eels, and every bare make_monster() in
    // mklev.js.  Because the MON_AT early-out at the top of makemon() scans
    // game.level.monsters, an unplaced monster also made that check answer
    // "square is empty" — the fill_zoo hazard mklev.js:5194 already records
    // having hit once at a single site.
    if (x > 0) placeOnLevel(mtmp, x, y);
    // C ref: makemon.c S_EEL case -> hideunder(mtmp) during mklev; mon.c
    // hideunder() sets `undetected = is_pool(x,y) && !Is_waterlevel(&u.uz)`.
    // js/sp_lev.js already did this for des.monster()-placed eels; mkswamp's
    // eels (mklev.c) went through here instead and stayed VISIBLE, so a
    // sleeping giant eel — which never moves and so never reaches m_move's
    // hideunder tail — kept failing mon.c:1297's `!mundetected` gate and drew
    // an rn2(4) every turn that C never draws (seed4500 Dlvl 24 swamp).
    if (x > 0 && game.in_mklev && ptr.mcls === S_EEL_CLS
        && mm_is_pool(x, y) && !Is_waterlevel(game.u?.uz))
        mtmp.mundetected = 1;
    return mtmp;
}

// ── In-game random spawn: makemon((permonst*)0, 0, 0, NO_MM_FLAGS) ──────────
// C ref: allmain.c maybe_generate_rnd_mon -> makemon.c makemon with a random
// type AND a random good position.  This is the per-turn "occasionally add a
// monster" path (gi.in_mklev == FALSE).  Only seed0103/seed0104 reach an
// in-game spawn with the RNG stream still in parity, so this path's RNG order
// is exercised exactly there; every other spawning session has already
// diverged before its first spawn, so wiring this up cannot regress them.

// C ref: vision.h cansee(x,y) — viz_array[y][x] & IN_SIGHT.
function mm_cansee(x, y) {
    if (y < 0 || y >= ROWNO || x < 0 || x >= COLNO) return false;
    return !!(game.viz_array?.[y]?.[x] & IN_SIGHT);
}

// C ref: mondata.h hides_under(ptr) = (mflags1 & M1_CONCEAL).  The JS MONS slice
// carries no mflags1, so identify the concealing species by pmidx (the 8
// M1_CONCEAL entries in include/monsters.h: cave spider, centipede, scorpion,
// garter snake, snake, water moccasin, pit viper, cobra).  Kept local here to
// avoid a monmove.js import cycle (which breaks module init order).
const MM_M1_CONCEAL_PMIDX = new Set([94, 95, 97, 214, 215, 216, 218, 219]);
function mm_hides_under_pm(ptr) {
    return ptr != null && MM_M1_CONCEAL_PMIDX.has(ptr.pmidx);
}

// C ref: rm.h is_pool / is_lava — terrain type tests used by goodpos().
function mm_is_pool(x, y) {
    const t = game.level?.at(x, y)?.typ;
    return t === POOL || t === MOAT || t === WATER;
}
function mm_is_lava(x, y) {
    return game.level?.at(x, y)?.typ === LAVAPOOL;
}

// C ref: mon.h MON_AT — a (live) monster occupies <x,y>.
export function mm_mon_at(x, y) {
    for (const m of game.level?.monsters || []) {
        if (m.mx === x && m.my === y && (m.mhp == null || m.mhp > 0)) return m;
    }
    // C ref: worm.c place_worm_seg() writes the worm into svl.level.monsters[][]
    // for every tail square, so MON_AT()/m_at() find it there.  This port keeps
    // segments in a side list; without consulting it, makemon()'s RNG-free
    // "already occupied" early return never fired on a tail square and fill_zoo
    // created a monster C skipped (seed0373 step 78).
    return worm_seg_at(x, y);
}

// C ref: teleport.c goodpos(x, y, mtmp, gpflags) for a to-be-created monster
// (fakemon carries the chosen permonst; GP_AVOID_MONPOS|GP_CHECKSCARY set).
//
// teleport.js exports the general goodpos(), but importing it here forms a
// cycle through mkobj.js that dies with a top-level TDZ, so the makemon-side
// predicate lives here.  It is the same C function with the flags makemon
// actually passes folded in, and — unlike the old version — it keeps the
// branches that DRAW: an eel offered a dry square costs rn2(13) whether or not
// it takes it, and the species retry loop calls this once per candidate.
function goodpos_spawn(x, y, ptr) {
    if (x < 1 || x >= COLNO || y < 0 || y >= ROWNO) return false; // !isok
    if (game.u?.ux === x && game.u?.uy === y) return false;       // u_at
    if (mm_mon_at(x, y)) return false;                            // GP_AVOID_MONPOS
    if (ptr) {
        if (mm_is_pool(x, y)) {
            // a swimmer may land in water; anyone else must be airborne, and a
            // freshly rolled monster never is (m_in_air is levitation/flight
            // state it does not have yet).
            return is_swimmer_flag(ptr) || is_flyer_flag(ptr);
        } else if (ptr.mcls === S_EEL_CLS && rn2(13)) {
            // C: an eel out of water usually refuses — and this rn2(13) fires
            // whenever an eel is offered a square, so it must not be skipped.
            return false;
        } else if (mm_is_lava(x, y)) {
            return is_flyer_flag(ptr) || mm_likes_lava(ptr);
        }
        if (passes_walls_flag(ptr) && mm_may_passwall(x, y)) return true;
        if (amorphous_flag(ptr) && mm_closed_door(x, y)) return true;
        // onscary(): Elbereth/scare-monster only exist once the hero has acted;
        // during level generation there is nothing scary on the map.
    }
    const typ = game.level?.at(x, y)?.typ;
    if (typ == null) return false;
    // C ref: monmove.c:2193 accessible() = ACCESSIBLE(SURFACE_AT(x,y))
    // && !closed_door(x, y).  The closed-door term was missing, so a spawn could
    // land inside a shut door (seed4500 medusa-3 raven on the (28,14) door) and
    // mfndpos then offered it a different square set than C's.
    if (typ < DOOR) return false;                                 // !ACCESSIBLE
    if (mm_closed_door(x, y)) return false;
    // C ref: `if (sobj_at(BOULDER, x, y) && !throws_rocks(mdat)) return FALSE;`
    if (!(ptr && throws_rocks_flag(ptr)) && mm_boulder_at(x, y)) return false;
    return true;
}

// C ref: mondata.h likes_lava(ptr) — the fire elemental and the salamander,
// which C spells out as two mons[] pointer comparisons rather than a flag.
function mm_likes_lava(ptr) {
    return ptr?.name === 'fire elemental' || ptr?.name === 'salamander';
}

// C ref: rm.h may_passwall(x,y) — a wall-walker still can't enter solid stone
// that has no room behind it; on the generated levels here the relevant test is
// simply "is this a wall/stone square inside the level".
function mm_may_passwall(x, y) {
    const typ = game.level?.at(x, y)?.typ;
    return typ != null && typ <= DBWALL;
}
// C ref: rm.h closed_door(x,y) — a DOOR whose doormask has D_CLOSED|D_LOCKED.
function mm_closed_door(x, y) {
    const loc = game.level?.at(x, y);
    // const.js: D_ISOPEN 0x02, D_CLOSED 0x04, D_LOCKED 0x08.  This used to test
    // 2|4, i.e. answered TRUE for an OPEN door and never saw D_LOCKED.
    return !!loc && loc.typ === DOOR && ((loc.doormask ?? 0) & (D_CLOSED | D_LOCKED)) !== 0;
}
// C ref: sobj_at(BOULDER, x, y).
function mm_boulder_at(x, y) {
    const objs = game.level?.objects;
    if (!objs) return false;
    for (const o of objs)
        if (o.where === 'floor' && o.ox === x && o.oy === y && o.otyp === SMS_BOULDER)
            return true;
    return false;
}

// C ref: makemon.c makemon_rnd_goodpos() — find a random good position for a
// freshly spawned monster.  Primary loop: up to 50 tries of rn1(COLNO-3,2) /
// rn2(ROWNO), rejecting any square the hero can currently see; fall back to a
// full-map scan (RNG-free except the stairway rn2(2) tie-break) otherwise.
function makemon_rnd_goodpos(ptr) {
    let nx = 0, ny = 0, good = false, tryct = 0;
    do {
        nx = rn2(COLNO - 3) + 2;   // rn1(COLNO-3, 2)
        ny = rn2(ROWNO);           // rn2(ROWNO)
        // C ref: `good = (!gi.in_mklev && cansee(nx,ny)) ? FALSE : goodpos(...)`
        // — during level generation the in-sight rejection does NOT apply, so a
        // statue-trap monster placed inside mklev() accepts visible squares.
        good = (!game.in_mklev && mm_cansee(nx, ny))
            ? false : goodpos_spawn(nx, ny, ptr);
    } while ((++tryct < 50) && !good);

    if (!good) {
        // Full-map scan (twice; the first pass skips in-sight squares).
        // C ref: `int bl = (gi.in_mklev || Blind) ? 1 : 0;` — inside mklev()
        // there is no first pass at all, so a level-generation placement never
        // skips a visible square here either.
        const xofs = nx, yofs = ny;
        for (let bl = game.in_mklev ? 1 : 0; bl < 2 && !good; bl++) {
            for (let dx = 0; dx < COLNO && !good; dx++) {
                for (let dy = 0; dy < ROWNO && !good; dy++) {
                    const cx = ((dx + xofs) % (COLNO - 1)) + 1;
                    const cy = ((dy + yofs) % (ROWNO - 1)) + 1;
                    if (bl === 0 && mm_cansee(cx, cy)) continue;
                    if (goodpos_spawn(cx, cy, ptr)) { nx = cx; ny = cy; good = true; }
                }
            }
            // C ref: makemon.c:1113-1128 — when the first (skip-visible) pass
            // finds nothing, C walks gs.stairs and takes the first same-dungeon
            // stairway that wins an rn2(2), then tests goodpos() there.  The
            // rn2(2) fires PER stairway examined, so skipping the block loses
            // draws (and the fallback position) whenever the whole visible map
            // is rejected.  `mon` is Null for a caller-picked random monster,
            // and C's `!mon || mon->data->mmove` accepts that.
            if (bl === 0 && !good && mon_mmove(ptr)) {
                let cx = nx, cy = ny;
                for (let stway = game.stairs; stway; stway = stway.next) {
                    if (stway.tolev?.dnum === game.u?.uz?.dnum && !rn2(2)) {
                        cx = stway.sx; cy = stway.sy;
                        break;
                    }
                }
                if (goodpos_spawn(cx, cy, ptr)) { nx = cx; ny = cy; good = true; }
            }
        }
        if (!good) return null;
    }
    return { x: nx, y: ny };
}

// C ref: permonst.h mmove (monsters.h LVL()'s 2nd field) — 0 means the species
// never moves.  Exactly eight mons[] entries qualify; transcribed by name from
// monsters.h rather than importing mon.js's MMOVE table, which would close an
// import cycle (mon.js already imports this module).
const MM_IMMOBILE_NAMES = new Set([
    'blue jelly', 'spotted jelly', 'brown mold', 'yellow mold',
    'green mold', 'red mold', 'Oracle', 'long worm tail',
]);
function mon_mmove(ptr) {
    return ptr ? !MM_IMMOBILE_NAMES.has(ptr.name) : true;
}

// C ref: teleport.c collect_coords(candy, cx, cy, maxradius, CC_NO_FLAGS):
// gather candidate squares in expanding rings, each ring (or radius pair —
// here ring_pairs is OFF, so per-ring) shuffled in place via Fisher-Yates,
// consuming rn2(n) exactly as the C engine does.  No skip filters.
function collect_coords_spawn(cx, cy, maxradius) {
    const out = [];
    const rowrange = (cy < ROWNO / 2) ? (ROWNO - 1 - cy) : cy;
    const colrange = (cx < COLNO / 2) ? (COLNO - 1 - cx) : cx;
    const k = Math.max(rowrange, colrange);
    maxradius = maxradius ? Math.min(maxradius, k) : k;

    for (let radius = 1; radius <= maxradius; radius++) {
        const ringStart = out.length;
        const lox = cx - radius, hix = cx + radius;
        const loy = cy - radius, hiy = cy + radius;
        for (let y = Math.max(loy, 0); y <= hiy; y++) {
            if (y > ROWNO - 1) break;
            for (let x = Math.max(lox, 1); x <= hix; x++) {
                if (x > COLNO - 1) break;
                if (x !== lox && x !== hix && y !== loy && y !== hiy) continue;
                out.push({ x, y });
            }
        }
        // Shuffle this ring (scramble && passend, ring_pairs off).
        let n = out.length - ringStart;
        let base = ringStart;
        while (n > 1) {
            const kk = rn2(n);
            if (kk) {
                const tmp = out[base];
                out[base] = out[base + kk];
                out[base + kk] = tmp;
            }
            base++;
            n--;
        }
    }
    return out;
}

// C ref: teleport.c enexto_core(cc, xx, yy, mdat, entflags) — nearest-3-rings
// (CC_NO_FLAGS) candidates first, then the whole map; first goodpos wins.
// enexto_gpflags(GP_CHECKSCARY|flags) then (flags) — but goodpos_spawn ignores
// scary (none on these levels) so the two passes are equivalent; one pass'
// near+full scan reproduces the RNG (collect_coords draws are what matter).
export function enexto_spawn(xx, yy, ptr) {
    const near = collect_coords_spawn(xx, yy, 3);
    for (const c of near) {
        if (goodpos_spawn(c.x, c.y, ptr)) return { x: c.x, y: c.y };
    }
    const all = collect_coords_spawn(xx, yy, 0);
    for (let i = near.length; i < all.length; i++) {
        if (goodpos_spawn(all[i].x, all[i].y, ptr)) return { x: all[i].x, y: all[i].y };
    }
    return null;
}

// C ref: makemon.c m_initgrp(mtmp, x, y, n, mmflags) — make a group like mtmp.
// cnt = rnd(n) / (ulevel<3?4 : ulevel<5?2 : 1); at least 1.  Each non-peaceful
// member is placed via enexto and created by makemon(..., MM_NOGRP).
function m_initgrp(mtmp, x, y, n, mmflags) {
    let cnt = rnd(n);                                  // makemon.c:85
    const ul = game.u?.ulevel || 1;
    cnt = Math.trunc(cnt / (ul < 3 ? 4 : ul < 5 ? 2 : 1));
    if (!cnt) cnt++;
    let mx = x, my = y;
    // C ref: makemon.c:1248 place_monster() runs BEFORE the group block, so each
    // member's enexto()/goodpos() sees the LEADER's square as occupied.  This
    // port defers the leader's real chain insertion to the caller (fmon order is
    // load-bearing, see makemon's _chainBefore note), so stage it on the map for
    // the duration of the loop only and pull it back out afterwards — indices
    // stay as the caller's grpFirstIdx expects.  Without this, members stacked
    // on top of the leader (seed0360 bigrm: an orc zombie and a grid bug each
    // doubled up instead of landing on their own square).
    const mons = game.level?.monsters || (game.level ? (game.level.monsters = []) : null);
    const staged = !!mons && !mons.includes(mtmp);
    if (staged) mons.push(mtmp);
    try {
        while (cnt-- > 0) {
            // C ref: makemon.c:125 — peace_minded(mtmp->data) per member; if
            // peaceful, skip (no enexto/makemon).  One C function, one port.
            if (peace_minded_bigrm(mtmp.data)) continue;
            const spot = enexto_spawn(mx, my, mtmp.data);  // enexto_gpflags
            if (spot) {
                mx = spot.x; my = spot.y;
                const mon = makemon(mtmp.data, spot.x, spot.y, mmflags | MM_NOGRP);
                if (mon) {
                    placeOnLevel(mon, spot.x, spot.y);
                    mon.mpeaceful = false;
                    set_malign(mon);
                }
            }
        }
    } finally {
        if (staged) { const i = mons.indexOf(mtmp); if (i >= 0) mons.splice(i, 1); }
    }
}

// C ref: makemon.c peace_minded() — the only RNG-consuming case is a co-aligned
// monster's hostile chance: rn2(16+record') && rn2(2+abs(mal)).  Differently
// aligned monsters return FALSE with no RNG (the seed0103/0104 spawns).
function peace_minded_spawn(ptr) {
    // C ref: makemon.c:2268 peace_minded().  The full ordered set of early-outs
    // (always_peaceful/always_hostile, leader/guardian/nemesis msounds, erinys,
    // race love/hate) must be applied BEFORE the maligntyp-sign test, because
    // those early-outs consume NO RNG.  In particular always_hostile monsters
    // (M2_HOSTILE) — e.g. the grid bug spawned in seed0030 — return FALSE here
    // with no rn2(16)/rn2(2) draw.  This is identical to peace_minded_bigrm; the
    // two callers (Big Room gen and in-game spawn) share the same C function.
    return peace_minded_bigrm(ptr);
}

// Place a spawned monster on the live level so the renderer and subsequent
// monster turns see it.  C ref: mon.c place_monster + makemon's fmon insert.
export function placeOnLevel(mtmp, x, y) {
    mtmp.mx = x; mtmp.my = y;
    if (!game.level.monsters) game.level.monsters = [];
    if (game.level.monsters.includes(mtmp)) return;
    // A group leader carries a reference to its FIRST MEMBER (set in makemon):
    // C links the leader into fmon before creating the members, so in our
    // reversed-array view it must precede them.  This only reorders the chain; it
    // does not change WHEN the monster becomes visible to enexto()/goodpos(),
    // which is what makes the generation RNG sensitive.
    const before = mtmp._chainBefore;
    if (before !== undefined) delete mtmp._chainBefore;
    if (before) {
        const i = game.level.monsters.indexOf(before);
        if (i >= 0) { game.level.monsters.splice(i, 0, mtmp); return; }
    }
    game.level.monsters.push(mtmp);
}

// C ref: makemon.c makemon((permonst*)0, 0, 0, NO_MM_FLAGS) for an in-game
// random spawn.  Faithful RNG order: makemon_rnd_goodpos -> rndmonst (retry
// loop) -> next_ident -> newmonhp -> gender -> group(m_initgrp) -> m_initweap/
// m_initinv -> saddle, then place on the level.
export function makemon_rnd_spawn() {
    // C ref: allmain.c maybe_generate_rnd_mon() — `makemon((struct permonst *)0,
    // 0, 0, NO_MM_FLAGS)`, i.e. the ordinary makemon() with a random species AND
    // a random position.  This used to be a second, reduced copy of makemon()
    // that stopped after the group block, so an in-game spawn skipped
    // makemon.c:1352-1390 entirely: no mitem, and no cham/newcham(), which is
    // where a chameleon/doppelganger/sandestin picks its initial shape
    // (select_newcham_form -> rn2(3) + pick_animal for a chameleon).  It also
    // skipped the long-worm tail and the cleric/Angel minion rolls.
    return makemon(null, 0, 0, 0);
}

// C ref: read.c create_particular_creation() for the ^G (#wizgenesis) command
// with a single named monster.  wiz_genesis() clears iflags.debug_mongen, then
// create_particular() parses the name and create_particular_creation() loops
// d->quan (==1 here) times calling makemon(whichpm, u.ux, u.uy, mmflags) with
// mmflags = MM_NOEXCLAM (no gender term, no surprise).
//
// makemon(ptr, u.ux, u.uy, ...) takes the `byyou && !gi.in_mklev` branch:
//   enexto_core(&cc, u.ux, u.uy, ptr, GP_CHECKSCARY|GP_AVOID_MONPOS)
// to find a square next to the hero (collect_coords ring shuffle = the RNG),
// then proceeds with next_ident -> newmonhp -> gender -> [no group, ptr given]
// -> m_initweap (if armed) -> m_initinv -> saddle rn2(100).  We reproduce that
// order by running enexto_spawn() first (placement RNG) and then the existing
// makemon() with MM_NOGRP (a specific ptr never spawns a group anyway).
//
// Returns { mtmp, x, y, next2u } so the caller can print the C "appears"
// message; null if no monster could be made (bad name, no good spot, genocided).
export function create_particular_monster(name, mmflags = 0) {
    const pmidx = name_to_pmidx(name);
    if (pmidx < 0) return null;       // name_to_mon() failed -> ismnum FALSE
    const ptr = MONS[pmidx];
    if (!ptr) return null;

    const u = game.u;
    // makemon byyou branch: enexto_core near the hero (collect_coords RNG).
    const spot = enexto_spawn(u.ux, u.uy, ptr);
    if (!spot) return null;

    // The placement RNG has been spent; makemon must not re-run it, so pass the
    // resolved (x,y).  MM_NOGRP keeps it from drawing group RNG (a named ptr is
    // anymon==FALSE in C, which already skips groups).
    // MM_NOWAIT is the one caller flag that still matters past the placement:
    // it suppresses the mflags3 STRAT_WAITFORU/CLOSE/APPEARMSG block, which is
    // what wizard.c resurrect() passes.
    const mtmp = makemon(ptr, spot.x, spot.y, MM_NOGRP | (mmflags & MM_NOWAIT));
    if (!mtmp) return null;
    placeOnLevel(mtmp, spot.x, spot.y);

    // next2u(x,y): chebyshev distance <= 1 from the hero.
    const next2u = Math.max(Math.abs(spot.x - u.ux), Math.abs(spot.y - u.uy)) <= 1;
    return { mtmp, x: spot.x, y: spot.y, next2u, ptr };
}

// ── adj_erinys (C ref: mon.c:5922) ───────────────────────────────────────
// The erinys grows with the hero's alignment abuse: mons[PM_ERINYS] itself is
// mutated, so every erinys made afterwards is stronger.  mlevel is the part
// that reaches the RNG — makemon()'s newmonhp() rolls d(adj_lev(ptr), 8), and
// adj_lev caps at 3*mlevel/2, so seed4500's sanctum erinys is d(13,8) at
// abuse 2 (mlevel 9) where an unmodified mlevel 7 gives d(10,8).
//
// C ORs the flag bits and never clears them, and mons[] is per-process there.
// This port runs many games in one process, so instead of accumulating we
// recompute from a pristine snapshot on every call: for a monotonically
// growing abuse the result is identical to C's, and calling adj_erinys(0) at
// game start restores the table exactly.
let erinys_pristine = null;

function erinys_pm() {
    const idx = name_to_pmidx('erinys');
    return idx >= 0 ? { idx, pm: monster_by_pmidx(idx) } : null;
}

export function adj_erinys(abuse) {
    const e = erinys_pm();
    if (!e || !e.pm) return;
    const { idx, pm } = e;
    if (!erinys_pristine) {
        erinys_pristine = {
            mflags1: MFLAGS1[idx] || 0,
            mattk: (MATTK[idx] || []).map(a => a.slice()),
            mlevel: pm.mlevel, difficulty: pm.difficulty,
        };
    }
    const p = erinys_pristine;
    let f1 = p.mflags1;
    const atk = p.mattk.map(a => a.slice());
    if (abuse > 5) f1 |= M1_SEE_INVIS;
    if (abuse > 10) f1 |= M1_AMPHIBIOUS;
    if (abuse > 15) f1 |= M1_FLY;
    if (abuse > 20 && atk[0]) atk[0][2] = 3;              /* more powerful attack */
    if (abuse > 25) f1 |= M1_REGEN;
    if (abuse > 30) f1 |= M1_TPORT_CNTRL;
    if (abuse > 35) atk[1] = [AT_WEAP, AD_DRST, 3, 4];    /* second attack */
    if (abuse > 40) f1 |= M1_TPORT;
    if (abuse > 50) atk[2] = [AT_MAGC, AD_SPEL, 3, 4];    /* third (spellcasting) attack */
    MFLAGS1[idx] = f1;
    MATTK[idx] = atk;
    pm.mlevel = Math.min(7 + abuse, 50);
    pm.difficulty = Math.min(10 + Math.trunc(abuse / 3), 25);
}

// ═══════════════════════════════════════════════════════════════════════════
// makemon.c — remaining functions.  INERT: nothing above calls into this
// section and none of it is reachable from an existing call site.  The RNG-
// drawing ones (clone_mon, bagotricks, summon_furies) go through the same
// makemon()/rn2() this file already owns, so wiring one up is a measured
// change, not a refactor.
// ═══════════════════════════════════════════════════════════════════════════

// C ref: makemon.c:1058 init_mextra(mex) — `*mex = zeromextra` then the one
// field whose zero value is wrong.  mextra.h:205 lists the members; this port
// keeps mextra as a plain object (js/const.js:2863-2876 EPRI/EMIN/... read it).
export function init_mextra(mex) {
    if (!mex) return mex;
    mex.mgivenname = null;
    mex.egd = null;
    mex.epri = null;
    mex.eshk = null;
    mex.emin = null;
    mex.edog = null;
    mex.ebones = null;
    mex.mcorpsenm = NON_PM;
    return mex;
}

// C ref: makemon.c:1065 newmextra() — alloc + init_mextra.
export function newmextra() {
    return init_mextra({});
}

// C ref: makemon.c:2369 — allocate an mcorpsenm field; only mextra itself is
// needed, the field lives inside it.  MCORPSENM() is js/const.js:2869.
export function newmcorpsenm(mtmp) {
    if (!mtmp.mextra)
        mtmp.mextra = newmextra();
    mtmp.mextra.mcorpsenm = NON_PM; /* not initialized yet */
}

// C ref: makemon.c:2378 — release a monster's mcorpsenm; basically a no-op.
// has_mcorpsenm(mon) is mextra.h `(mon)->mextra` (the field is not a pointer).
export function freemcorpsenm(mtmp) {
    if (mtmp && mtmp.mextra)
        mtmp.mextra.mcorpsenm = NON_PM;
}

// C ref: makemon.c:575 — create a new stack of gold in a monster's inventory.
// mk_mplayer() passes rn2(1000) so the amount can be 0, and then NOTHING is
// created: no mksobj(), hence no next_ident() draw.  C's add_to_minv() is
// mkobj.c's; mpickobj() (makemon.js:1411) is this port's minvent appender.
// mksobj(GOLD_PIECE, FALSE, FALSE) — init FALSE, so one next_ident() only.
export function mkmonmoney(mtmp, amount) {
    if (amount > 0) {
        const gold = mksobj(GOLD_PIECE_OTYP, false, false);
        if (!gold) return;
        gold.quan = amount;
        gold.owt = weight(gold);
        mpickobj(mtmp, gold);
    }
}
const GOLD_PIECE_OTYP = 438; // objects[] index, as used at makemon.js:2330

// C ref: makemon.c:1759 cmp_init_mongen_order(p1, p2) — the qsort comparator
// init_mongen_order() (makemon.js:1154) applies to mongen_order[].  The #if 0
// block that would push G_NOGEN|G_UNIQ species last is NOT compiled, so both
// offsets are 0.  `mons[].mlet` here is C's NUMERIC S_* class index, which is
// `.mcls` in this port — `.mlet` is the display character (makemon.js:620-621).
export function cmp_init_mongen_order(p1, p2) {
    const i1 = p1, i2 = p2;
    const offset1 = 0, offset2 = 0;

    /* incorporate the mlet into the sort values for comparison */
    const difficulty1 = ((MONS[i1].difficulty + offset1) | (MONS[i1].mcls << 8));
    const difficulty2 = ((MONS[i2].difficulty + offset2) | (MONS[i2].mcls << 8));
    return difficulty1 - difficulty2;
}

/* C ref: pline.c debugpline*() — wizard-mode only trace output. */
function debugpline_mongen(_s) { /* no-op: not wizard mode in any session */ }

// C ref: makemon.c:1782 — compiled only when NH_DEVEL_STATUS != RELEASED.  It
// verifies that within each class mongen_order[] is non-decreasing in
// difficulty; init_mongen_order() calls it before AND after the qsort.  Returns
// the count of complaints so a caller can assert on it (C only debugplines).
export function check_mongen_order() {
    let i, diff = 0, complaints = 0;
    /* C's `char mlet = '\0'` is compared numerically against mons[].mlet (the
       S_* index, `.mcls` here), and `!mlet` must be TRUE on the first pass —
       so 0, not the string '\0', which is truthy in JS. */
    let mlet = 0;

    init_mongen_order();
    for (i = 0; i < SPECIAL_PM; i++) {
        if (i !== mongen_order[i]) {
            debugpline_mongen(`changed:${MONS[i].name}=>${MONS[mongen_order[i]].name}`);
        }

        if (mlet === MONS[mongen_order[i]].mcls) {
            if (MONS[mongen_order[i]].difficulty < diff) {
                debugpline_mongen(`${MONS[mongen_order[i]].name}`);
                complaints++;
            }
            diff = MONS[mongen_order[i]].difficulty;
        }
        if (!mlet || mlet !== MONS[mongen_order[i]].mcls) {
            mlet = MONS[mongen_order[i]].mcls;
            diff = 0;
        }
    }
    return complaints;
}

// C ref: makemon.c:1834 — the --dumpmongen developer switch: print the sorted
// mongen_order[] as a C initialiser.  C ends with freedynamicdata() because the
// switch exits the process; that teardown has no place here.  `def_monsyms[
// mons[].mlet].sym` is C's class symbol, which in this port is `ptr.mlet`
// directly (makemon.js:621).  C uses monsdump[].nm for the PM_ spelling; this
// port has no such table, so the mons[] name is emitted instead.
export function dump_mongen() {
    let mlet, prev_mlet = 0;
    let i;
    const nmwidth = 27;
    const out = [];

    init_mongen_order();
    const MONSi = (k) => mongen_order[k];
    out.push('int mongen_order[] = {');
    for (i = 0; i < SPECIAL_PM; ++i) {
        const special = (MONS[MONSi(i)].geno & (G_NOGEN | G_UNIQ));
        mlet = MONS[MONSi(i)].mlet;
        if (prev_mlet && prev_mlet !== mlet)
            out.push('');
        const nmbuf = `PM_${MONS[MONSi(i)].name}${(i === SPECIAL_PM - 1) ? '' : ','}`;
        out.push(`    ${nmbuf.padEnd(nmwidth)} /* ${(i === MONSi(i)) ? ' ' : '.'} `
                 + `seq=${String(i).padStart(3)}, idx=${String(MONSi(i)).padStart(3)}, `
                 + `sym='${mlet}', diff=${String(MONS[MONSi(i)].difficulty).padStart(2)}, `
                 + `freq=${String(MONS[MONSi(i)].geno & G_FREQ).padStart(2)}`
                 + `[${mclass_maxf[MONS[MONSi(i)].mcls]}] `
                 + ((special === (G_NOGEN | G_UNIQ)) ? '(G_NOGEN | G_UNIQ)'
                    : (special === G_NOGEN) ? '(G_NOGEN)'
                    : (special === G_UNIQ) ? '(G_UNIQ)'
                    : '')
                 + ' */');
        prev_mlet = mlet;
    }
    out.push('};');
    out.push('');
    return out;
}

// C ref: makemon.c:836 clone_mon(mon, x, y) — x==0 means "near mon".  Note: for
// long worms always call cutworm(), which calls this (js/worm.js:482 already
// takes it as the `clone_monfn` argument and awaits it).
//
// RNG: enexto() when the target square is taken, then at most two rn2() —
// `rn2(max(2 + u.uluck, 2))` for the tame case OR the peaceful case, never
// both, and only when !context.mon_moving && mon->mpeaceful.  tamedog() draws
// its own.  Everything else is state copying.
//
// Cross-file helpers arrive by `await import()`, the convention this port uses
// for edges that would close an import cycle (js/dungeon.js:1639-1643).
export async function clone_mon(mon, x, y) {
    const mm = { x: 0, y: 0 };

    /* may be too weak or have been extinguished for population control */
    if (mon.mhp <= 1
        || (mvflags(mon.data.pmidx) & G_EXTINCT) !== 0)
        return null;

    if (x === 0) {
        mm.x = mon.mx;
        mm.y = mon.my;
    } else {
        mm.x = x;
        mm.y = y;
    }
    if (!(mm.x >= 1 && mm.x < COLNO && mm.y >= 0 && mm.y < ROWNO)) { /* !isok, paranoia */
        return null;
    }
    if (mm_mon_at(mm.x, mm.y)) { /* (always True for the x==0 case) */
        const cc = enexto_spawn(mm.x, mm.y, mon.data);
        if (!cc) return null;
        mm.x = cc.x; mm.y = cc.y;
        if (mm_mon_at(mm.x, mm.y)) return null;
    }

    /* newmonst(); *m2 = *mon — a shallow copy of every field */
    let m2 = { ...mon };
    m2.mextra = null;
    /* C: m2->nmon = fmon; fmon = m2 — the link happens here, before
       place_monster(); placeOnLevel() (makemon.js) does both for this port. */
    m2.m_id = next_ident();
    m2.mx = mm.x;
    m2.my = mm.y;

    m2.mundetected = 0;
    m2.mtrapped = 0;
    m2.mcloned = 1;
    m2.minvent = null; /* objects don't clone */
    m2.mleashed = 0;
    /* Max HP the same, but current HP halved for both.  When current HP is odd
       the original keeps the extra point; the original has > 1 HP, so both end
       up with at least 1. */
    m2.mhpmax = mon.mhpmax;
    m2.mhp = Math.trunc(mon.mhp / 2);
    mon.mhp -= m2.mhp;

    /* clone has no mextra so it mustn't retain special monster flags */
    m2.isshk = 0;
    m2.isgd = 0;
    m2.ispriest = 0;
    /* m2->isminion handled below */

    /* clone shouldn't be reluctant to move on spots 'parent' just moved on */
    m2.mtrack = [];                                 /* mon_track_clear(m2) */

    placeOnLevel(m2, m2.mx, m2.my);                 /* place_monster() + fmon link */
    {
        const { emits_light, new_light_source } = await import('./light.js');
        const range = emits_light(m2.data);
        if (range)
            new_light_source(m2.mx, m2.my, range, 2 /* LS_MONSTER */, m2);
    }
    /* if 'parent' is named, give the clone the same name */
    if (mon.mgivenname || mon.mextra?.mgivenname) {
        const { christen_monst } = await import('./do_name.js');
        m2 = christen_monst(m2, mon.mgivenname || mon.mextra.mgivenname) || m2;
    } else if (mon.isshk) {
        const { christen_monst } = await import('./do_name.js');
        const { shkname } = await import('./shkroom.js');
        m2 = christen_monst(m2, shkname(mon)) || m2;
    }

    /* not all clones caused by player are tame or peaceful */
    if (!game.context?.mon_moving && mon.mpeaceful) {
        const uluck = game.u?.uluck | 0;
        if (mon.mtame)
            m2.mtame = rn2(Math.max(2 + uluck, 2)) ? mon.mtame : 0;
        else if (mon.mpeaceful)
            m2.mpeaceful = rn2(Math.max(2 + uluck, 2)) ? 1 : 0;
    }
    /* if a guardian angel could be cloned, m2 could be both isminion and
       mtame; isminion takes precedence */
    if (m2.isminion) {
        /* newemin(m2); *EMIN(m2) = *EMIN(mon) */
        if (!m2.mextra) m2.mextra = newmextra();
        m2.mextra.emin = { ...(mon.mextra?.emin || mon.emin || {}) };
        m2.emin = m2.mextra.emin;
        /* renegade when same alignment as hero but not peaceful, or when
           peaceful while being a different alignment from the hero */
        const atyp = m2.mextra.emin.min_align;
        m2.mextra.emin.renegade =
            ((atyp !== (game.u?.ualign?.type ?? 0)) ? 1 : 0) ^ (!m2.mpeaceful ? 1 : 0);
    } else if (m2.mtame) {
        /* m2 is a copy of mon so it is tame but not init'ed; tamedog() will
           not re-tame a tame dog, so clear the flag first. */
        m2.mtame = 0;
        const { tamedog } = await import('./dothrow.js');
        if (await tamedog(m2, null, false)) {
            if (!m2.mextra) m2.mextra = newmextra();
            m2.mextra.edog = { ...(mon.mextra?.edog || mon.edog || {}) };
            m2.edog = m2.mextra.edog;
        }
    }
    set_malign(m2);
    {
        const { newsym } = await import('./display.js');
        newsym(m2.mx, m2.my);                       /* display the new monster */
    }

    return m2;
}

/* decl.c c_common_strings — include/decl.h:31-32 maps these two names. */
const nothing_happens = 'Nothing happens.';
const nothing_seems_to_happen = 'Nothing seems to happen.';
const BAG_OF_TRICKS_OTYP = 220; /* objclass.h ordering; js/extcmd-handlers.js:1480 */

// C ref: makemon.c:2553 — release monsters from a bag of tricks; returns the
// number created and adds the number the hero perceived to *seencount.  RNG:
// consume_obj_charge() draws nothing, then `rn2(23)` ALWAYS (it is the left
// operand) and `rnd(7)` only when that comes up 0, then one makemon() per
// creature.  The do/while runs at least once even for creatcnt 1.
//
// `seencount` is C's `int *`; JS gets an object with a `.count` field so the
// secondary output still works.
export async function bagotricks(bag, tipping, seencount) {
    let moncount = 0;

    if (!bag || bag.otyp !== BAG_OF_TRICKS_OTYP) {
        /* impossible("bad bag o' tricks") */
    } else if (bag.spe < 1) {
        /* if tipping a known-empty bag, give the normal empty-container line */
        await bagotricks_pline((tipping && bag.cknown) ? "It's empty." : nothing_happens);
        /* now known to be empty if sufficiently discovered */
        if (bag.dknown && objects[bag.otyp]?.oc_name_known) {
            bag.cknown = 1;
            const { update_inventory } = await import('./invent.js');
            update_inventory(); /* for perm_invent */
        }
    } else {
        let creatcnt = 1, seecount = 0;

        const { consume_obj_charge } = await import('./invent.js');
        consume_obj_charge(bag, !tipping);

        if (!rn2(23))
            creatcnt += rnd(7);
        do {
            const mtmp = makemon(null, game.u.ux, game.u.uy, 0 /* NO_MM_FLAGS */);
            if (mtmp) {
                ++moncount;
                if ((await bagotricks_canseemon(mtmp)
                     && (M_AP_TYPE_local(mtmp) === 0 /* M_AP_NOTHING */
                         || M_AP_TYPE_local(mtmp) === 3 /* M_AP_MONSTER */))
                    || await bagotricks_sensemon(mtmp))
                    ++seecount;
            }
        } while (--creatcnt > 0);
        if (seecount) {
            if (seencount)
                seencount.count = (seencount.count | 0) + seecount;
            if (bag.dknown) {
                const { makeknown, update_inventory } = await import('./invent.js');
                makeknown(BAG_OF_TRICKS_OTYP);
                update_inventory(); /* for perm_invent */
            }
        } else if (!tipping) {
            await bagotricks_pline(!moncount ? nothing_happens
                                            : nothing_seems_to_happen);
        }
    }
    return moncount;
}

/* pline1(s) — pline("%s", s).  js/display.js:2631 owns pline(). */
async function bagotricks_pline(s) {
    const { pline } = await import('./display.js');
    await pline(s);
}
/* monst.h M_AP_TYPE(mon); js/const.js:2895 has the same one-liner. */
function M_AP_TYPE_local(mon) { return mon?.m_ap_type ?? 0; }
/* mondata.h canseemon / sensemon — private copies live in four modules
   (dungeon.js:1724, muse.js:252, dogmove.js:2025, shk.js:1475); mon.js:715
   exports sensemon(). */
async function bagotricks_canseemon(mtmp) {
    const { canspotmon } = await import('./uhitm.js');
    return !!canspotmon(mtmp);
}
async function bagotricks_sensemon(mtmp) {
    const { sensemon } = await import('./mon.js');
    return !!sensemon(mtmp);
}

// C ref: makemon.c:2604 — create some or all remaining erinyes around the hero.
// `limit` 0 means "until extinct".  mk_gen_ok(PM_ERINYS, G_GONE, 0) fails once
// mvitals[PM_ERINYS] picks up G_EXTINCT (propagate() sets it at mbirth_limit),
// so the unbounded form terminates.  MM_ADJACENTOK lets each one displace to a
// neighbouring square instead of failing on the hero's own.
export function summon_furies(limit) {
    const PM_ERINYS_IDX = name_to_pmidx('erinys');
    if (PM_ERINYS_IDX < 0) return;
    let i = 0;
    while (mk_gen_ok(PM_ERINYS_IDX, G_GONE, 0) && (i < limit || !limit)) {
        makemon(MONS[PM_ERINYS_IDX], game.u.ux, game.u.uy,
                MM_ADJACENTOK | MM_NOWAIT);
        i++;
    }
}

// ── C names for ports that already exist under a local name ────────────────
// These three are FULLY ported above; only the C spelling was missing.  They
// are re-exported rather than re-implemented — a second body is the
// duplicate-reimplementation trap, and renaming the originals would touch
// live call sites.
//   m_initweap   -> m_initweap_full   (makemon.js:1698)
//   m_initinv    -> m_initinv_full    (makemon.js:2180)
//   peace_minded -> peace_minded_bigrm(makemon.js:2687)
export function m_initweap(mtmp) { return m_initweap_full(mtmp); }
export function m_initinv(mtmp) { return m_initinv_full(mtmp); }
export function peace_minded(ptr) { return peace_minded_bigrm(ptr); }
