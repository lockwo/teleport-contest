// makemon.js - Monster creation.
// C ref: makemon.c - rndmonst_adj, rndmonst, mkclass, mkclass_aligned,
//        makemon, newmonhp, m_initweap.

import { game } from './gstate.js';
import { rn2, rnd, d } from './rng.js';
import { depth as depth_of_level } from './hacklib.js';
import { DART, mksobj } from './mkobj.js';

// Object type indices (mkobj.js OBJECT_DATA), needed by m_initweap.
const ORCISH_DAGGER = 36;
// SCIMITAR (50) is the alternative in C's ORCISH_DAGGER/SCIMITAR ternary, but
// PM_GOBLIN always short-circuits to ORCISH_DAGGER, so it is never reached here.
const ORCISH_HELM = 90;
import {
    A_NONE, A_CHAOTIC, A_NEUTRAL, A_LAWFUL,
    AM_NONE, AM_CHAOTIC, AM_NEUTRAL, AM_LAWFUL,
    DUNGEON_ALIGN_BY_DNUM,
    GEHENNOM,
    In_endgame, Is_astralevel, Is_rogue_level,
} from './const.js';

const G_UNIQ = 0x1000;
const G_NOHELL = 0x0800;
const G_HELL = 0x0400;
const G_NOGEN = 0x0200;
const G_GENO = 0x0020;
const G_NOCORPSE = 0x0010;
const G_FREQ = 0x0007;
const G_IGNORE = 0x8000;
const G_GONE = 0x03; // mvflags G_GENOD | G_EXTINCT
const G_GENOD = 0x02;

const MR_FIRE = 0x01;
const MR_COLD = 0x02;

const NON_PM = -1;
const ALIGNWEIGHT = 5;

// S_* monster-class symbol indices (include/defsym.h MONSYM order).
const S_LICH = 38;
const S_HUMAN = 53;
const MAXMCLASSES = 61;

// is_placeholder() monsters (include/mondata.h): PM indices excluded by
// mkclass()'s mk_gen_ok.  These are abstract class placeholders.
const PM_ORC = 72;
const PM_GIANT = 169;
const PM_HUMAN = 260;
const PM_ELF = 264;

// SPECIAL_PM = PM_LONG_WORM_TAIL; mons[] iteration for generation stops here.
const SPECIAL_PM = 329;

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
    [33,6,4,0,33,0,0,5,15], [34,6,4,0,34,0,0,6,3], [35,6,5,0,33,0,0,7,6], [36,6,5,0,33,0,0,7,0],
    [37,6,6,0,33,0,0,7,15], [38,6,6,0,34,0,0,8,11], [39,6,12,-3,33,0,0,14,4],
    [40,7,5,-9,34,32,0,8,2], [41,7,6,-9,34,128,0,8,3], [42,7,9,-12,33,128,0,11,5],
    [43,8,1,6,34,0,0,2,2], [44,8,2,4,35,0,0,4,1], [45,8,3,-6,33,0,0,5,3], [46,8,4,5,34,0,0,6,4],
    [47,8,6,6,33,0,0,8,5], [48,8,9,-8,33,0,0,13,13], [49,8,13,-8,33,0,0,19,13],
    [50,9,1,-7,113,36,0,3,1], [51,9,2,-7,34,36,0,3,2], [52,9,3,-7,33,0,0,4,1],
    [53,9,3,-7,1137,36,3,5,3], [54,9,3,-7,34,32,0,7,4], [55,9,6,7,35,32,0,7,6],
    [56,10,4,0,34,34,3,5,4], [57,10,5,0,33,192,3,6,2], [58,10,6,0,34,192,3,8,3],
    [59,11,0,-2,33,32,0,1,3], [60,11,1,-3,33,32,0,2,1], [61,11,2,-4,33,32,0,3,5],
    [62,11,2,-4,33,32,0,4,12], [63,12,5,0,36,0,0,4,2], [64,13,7,0,34,64,0,8,3],
    [65,13,8,0,33,64,0,9,1], [66,13,9,0,33,64,0,11,5], [67,14,3,0,34,0,2,5,2],
    [68,14,3,0,34,0,2,5,4], [69,14,3,0,34,0,2,5,3], [70,15,0,-3,34,0,0,1,7],
    [71,15,1,-4,34,0,0,3,3], [72,15,1,-3,608,32,0,3,1], [73,15,2,-4,98,32,0,4,11],
    [74,15,3,-5,97,32,0,5,4], [75,15,3,-4,97,32,0,5,0], [76,15,3,-5,33,32,0,5,12],
    [77,15,5,-5,33,32,0,7,5], [78,16,3,0,36,0,0,4,7], [79,16,5,0,34,0,0,6,6],
    [80,16,7,0,33,64,0,9,15], [81,17,2,0,164,0,0,4,3], [82,17,5,-2,33,0,0,7,7],
    [83,17,6,0,34,0,0,8,1], [84,17,8,0,33,0,0,9,6], [85,17,12,0,34,0,0,13,7],
    [86,17,14,0,34,0,0,15,7], [87,17,20,0,33,0,0,22,0], [88,18,0,0,161,0,0,1,3],
    [89,18,1,0,162,0,0,2,3], [90,18,2,0,33,32,0,4,3], [91,18,2,-7,528,32,0,4,3],
    [92,18,3,0,34,0,0,4,7], [93,18,3,0,544,0,0,4,3], [94,19,1,0,162,32,0,3,7],
    [95,19,2,0,33,32,0,4,11], [96,19,5,0,33,32,0,7,5], [97,19,5,0,34,32,0,8,1],
    [98,20,10,0,34,0,0,12,7], [99,20,12,0,34,0,0,14,2], [100,21,3,0,34,0,0,4,3],
    [101,21,4,7,34,32,0,6,15], [102,21,4,0,33,32,0,6,7], [103,21,4,-7,33,32,0,6,0],
    [104,21,5,0,34,0,0,7,3], [105,21,7,0,34,0,0,9,3], [106,22,3,0,50,164,3,4,7],
    [107,22,4,0,50,164,3,6,3], [108,22,5,0,2097,166,3,7,6], [109,22,6,0,49,188,3,9,12],
    [110,22,7,0,1074,165,3,9,4], [111,22,8,0,1073,165,3,10,11], [112,23,5,0,32,0,0,6,3],
    [113,23,8,0,32,0,0,9,5], [114,23,9,0,34,0,0,10,3], [115,23,15,0,34,0,0,17,5],
    [116,24,0,0,179,48,0,1,5], [117,24,7,0,35,32,0,9,1], [118,25,3,0,52,255,3,5,11],
    [119,25,5,0,50,255,3,7,0], [120,26,9,0,34,0,0,11,3], [121,27,8,7,2193,32,0,11,2],
    [122,27,10,7,2065,54,0,12,11], [123,27,14,12,2065,54,0,19,15],
    [124,27,16,15,2065,32,0,21,11], [125,27,19,15,2065,55,0,26,5], [126,28,0,0,161,0,0,2,3],
    [127,28,2,0,34,0,0,3,1], [128,28,4,0,34,0,0,6,0], [129,28,5,0,34,36,0,7,0],
    [130,29,4,0,33,0,0,6,3], [131,29,5,-1,33,0,0,8,2], [132,29,6,-3,33,0,0,9,6],
    [133,30,12,0,32,0,0,13,7], [134,30,12,0,32,0,0,13,11], [135,30,12,0,32,0,0,13,14],
    [136,30,12,0,32,1,0,13,1], [137,30,12,0,32,2,0,13,15], [138,30,12,0,32,4,0,13,9],
    [139,30,12,0,32,8,0,13,0], [140,30,12,0,32,16,0,13,4], [141,30,12,0,32,32,0,13,2],
    [142,30,12,0,32,192,0,13,11], [143,30,15,4,33,0,0,20,7], [144,30,15,4,33,1,0,20,11],
    [145,30,15,4,33,2,0,20,14], [146,30,15,-4,33,1,0,20,1], [147,30,15,-5,33,2,0,20,15],
    [148,30,15,5,33,4,0,20,9], [149,30,15,-6,33,8,0,20,0], [150,30,15,-7,33,16,0,20,4],
    [151,30,15,6,33,32,0,20,2], [152,30,15,7,33,192,0,20,11], [153,31,8,0,35,0,0,9,15],
    [154,31,8,0,17,160,3,10,6], [155,31,8,0,17,161,3,10,11], [156,31,8,0,17,163,3,10,3],
    [157,31,8,0,17,160,3,10,4], [158,32,0,0,36,0,3,1,10], [159,32,1,0,33,34,3,2,3],
    [160,32,1,0,34,32,3,2,11], [161,32,1,0,33,192,3,2,2], [162,32,1,0,33,33,3,2,1],
    [163,32,3,0,33,32,3,2,5], [164,32,3,0,34,32,3,5,5], [165,33,1,0,161,0,0,3,3],
    [166,33,3,0,34,0,0,4,4], [167,33,3,0,33,0,0,5,12], [168,33,5,0,33,0,0,6,5],
    [169,34,6,2,545,0,0,8,1], [170,34,6,2,161,0,0,8,7], [171,34,8,-2,161,0,0,10,6],
    [172,34,9,2,161,1,0,11,11], [173,34,10,-3,2209,2,0,13,15], [174,34,10,0,33,0,0,13,3],
    [175,34,16,-3,161,16,0,19,4], [176,34,16,9,1,0,0,20,5], [177,34,15,0,544,0,0,17,3],
    [178,36,15,0,33,0,0,18,9], [179,37,1,9,608,0,1,3,4], [180,37,2,10,672,0,1,4,4],
    [181,37,3,11,544,0,1,5,6], [182,37,4,12,544,0,1,6,5], [183,38,11,-9,49,38,0,14,3],
    [184,38,14,-12,49,38,0,18,1], [185,38,17,-15,1073,39,0,21,5],
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
    [285,53,30,-128,4608,33,1,34,13], [286,53,20,15,4608,0,1,22,5],
    [287,54,10,-5,528,174,0,12,7], [288,54,12,0,528,174,0,14,0], [289,56,8,-7,528,33,0,11,4],
    [290,56,6,-9,17,33,0,8,7], [291,56,6,11,1042,33,0,9,3], [292,56,7,10,1170,33,2,10,1],
    [293,56,8,8,1170,33,0,11,1], [294,56,7,-12,1041,33,2,11,1], [295,56,8,-9,1170,33,0,11,2],
    [296,56,9,-10,1170,33,0,12,2], [297,56,9,-9,1170,33,0,13,7],
    [298,56,11,-12,1042,35,0,15,15], [299,56,11,-11,1041,33,0,15,1],
    [300,56,13,-13,1042,33,0,16,1], [301,56,13,-5,1041,128,0,15,7],
    [302,56,16,-14,1041,33,0,20,1], [303,56,50,-15,5648,225,1,26,10],
    [304,56,56,-15,5648,33,1,31,5], [305,56,66,-20,5648,33,1,36,5],
    [306,56,72,15,5648,33,1,36,5], [307,56,78,15,5648,33,1,40,5], [308,56,89,20,5648,33,1,45,5],
    [309,56,105,20,5648,35,1,53,5], [310,56,106,-20,5648,33,1,57,5],
    [311,56,30,0,4608,183,0,34,13], [312,56,30,0,4608,183,0,34,13],
    [313,56,30,0,4608,183,0,34,13], [314,56,7,0,528,160,0,8,11], [315,57,3,0,544,32,0,5,4],
    [316,57,5,0,672,0,0,7,1], [317,57,7,0,544,0,0,9,7], [318,57,5,0,544,0,0,7,6],
    [319,57,7,0,544,16,0,10,12], [320,57,20,-3,544,0,0,22,1], [321,58,0,0,37,0,0,1,11],
    [322,58,1,0,37,0,0,2,2], [323,58,2,0,37,0,0,3,3], [324,58,3,0,32,0,0,4,3],
    [325,58,5,0,37,128,0,6,2], [326,58,6,0,34,0,0,7,3], [327,58,6,0,33,0,0,7,3],
    [328,58,8,-9,1025,5,0,12,9], [329,59,0,0,4624,0,0,1,3], [330,53,10,3,512,0,0,12,15],
    [331,53,10,0,512,32,0,12,15], [332,53,10,1,512,0,0,12,15], [333,53,10,0,512,32,0,12,15],
    [334,53,10,3,512,0,0,12,15], [335,53,10,0,512,0,0,11,15], [336,53,10,0,512,0,0,12,15],
    [337,53,10,-3,512,0,0,12,15], [338,53,10,-3,512,0,0,12,15], [339,53,10,3,512,0,0,12,15],
    [340,53,10,0,512,0,0,12,15], [341,53,10,1,512,2,2,12,15], [342,53,10,0,512,0,0,12,15],
    [343,53,20,20,4608,0,1,24,5], [344,53,20,0,4608,32,1,24,5], [345,53,20,20,4608,0,1,24,5],
    [346,53,20,0,4608,32,1,26,5], [347,53,20,20,4608,0,1,24,5], [348,53,25,0,4608,53,1,30,0],
    [349,53,25,0,4608,53,1,30,15], [350,53,20,0,4608,0,1,24,5], [351,53,20,-20,4608,128,1,24,5],
    [352,53,20,20,4608,0,1,24,5], [353,53,20,0,4608,0,1,22,15], [354,53,20,0,4608,2,2,24,5],
    [355,53,20,0,4608,0,2,25,2], [356,56,16,-14,4624,161,0,23,9],
    [357,53,16,-14,4624,160,1,22,5], [358,30,16,-14,4608,255,2,23,5],
    [359,34,18,-15,4608,128,1,23,7], [360,30,15,-14,4608,129,1,22,1],
    [361,53,25,-20,4608,160,1,31,5], [362,56,16,-127,4624,161,1,23,9],
    [363,19,15,-15,4608,160,1,17,5], [364,53,15,18,4608,128,1,20,5],
    [365,53,15,-13,4624,128,1,19,5], [366,34,15,12,4608,129,1,19,5],
    [367,53,15,-10,4624,128,0,20,0], [368,53,5,3,512,0,0,7,15], [369,53,5,0,512,32,0,7,15],
    [370,53,5,1,512,0,0,7,15], [371,53,5,0,512,32,0,7,15], [372,53,5,3,512,0,0,7,15],
    [373,53,5,0,512,0,0,8,15], [374,53,5,0,512,0,0,8,15], [375,53,5,-7,512,0,0,7,15],
    [376,53,5,-3,512,0,0,7,15], [377,53,5,3,512,0,0,7,15], [378,53,5,3,512,0,0,7,15],
    [379,53,5,0,512,0,0,8,15], [380,53,5,1,512,0,2,7,15], [381,53,5,0,512,0,0,8,15],
];

// Neutral monster names, indexed by pmidx (src/monst.c MON() name fields).
// Consumed by external callers (eat.js corpse names, display); not parity.
const MONS_NAMES = [
    "giant ant", "killer bee", "soldier ant", "fire ant", "giant beetle", "queen bee",
    "acid blob", "quivering blob", "gelatinous cube", "chickatrice", "cockatrice", "pyrolisk",
    "jackal", "fox", "coyote", "werejackal", "little dog", "dingo", "dog", "large dog", "wolf",
    "werewolf", "winter wolf cub", "warg", "winter wolf", "hell hound pup", "hell hound",
    "gas spore", "floating eye", "freezing sphere", "flaming sphere", "shocking sphere",
    "kitten", "housecat", "jaguar", "lynx", "panther", "large cat", "tiger", "displacer beast",
    "gremlin", "gargoyle", "winged gargoyle", "hobbit", "dwarf", "bugbear", "dwarf leader",
    "dwarf ruler", "mind flayer", "master mind flayer", "manes", "homunculus", "imp", "lemure",
    "quasit", "tengu", "blue jelly", "spotted jelly", "ochre jelly", "kobold", "large kobold",
    "kobold leader", "kobold shaman", "leprechaun", "small mimic", "large mimic", "giant mimic",
    "wood nymph", "water nymph", "mountain nymph", "goblin", "hobgoblin", "orc", "hill orc",
    "Mordor orc", "Uruk-hai", "orc shaman", "orc-captain", "rock piercer", "iron piercer",
    "glass piercer", "rothe", "mumak", "leocrotta", "wumpus", "titanothere", "baluchitherium",
    "mastodon", "sewer rat", "giant rat", "rabid rat", "wererat", "rock mole", "woodchuck",
    "cave spider", "centipede", "giant spider", "scorpion", "lurker above", "trapper", "pony",
    "white unicorn", "gray unicorn", "black unicorn", "horse", "warhorse", "fog cloud",
    "dust vortex", "ice vortex", "energy vortex", "steam vortex", "fire vortex",
    "baby long worm", "baby purple worm", "long worm", "purple worm", "grid bug", "xan",
    "yellow light", "black light", "zruty", "couatl", "Aleax", "Angel", "ki-rin", "Archon",
    "bat", "giant bat", "raven", "vampire bat", "plains centaur", "forest centaur",
    "mountain centaur", "baby gray dragon", "baby gold dragon", "baby silver dragon",
    "baby red dragon", "baby white dragon", "baby orange dragon", "baby black dragon",
    "baby blue dragon", "baby green dragon", "baby yellow dragon", "gray dragon", "gold dragon",
    "silver dragon", "red dragon", "white dragon", "orange dragon", "black dragon",
    "blue dragon", "green dragon", "yellow dragon", "stalker", "air elemental",
    "fire elemental", "earth elemental", "water elemental", "lichen", "brown mold",
    "yellow mold", "green mold", "red mold", "shrieker", "violet fungus", "gnome",
    "gnome leader", "gnomish wizard", "gnome ruler", "giant", "stone giant", "hill giant",
    "fire giant", "frost giant", "ettin", "storm giant", "titan", "minotaur", "jabberwock",
    "Keystone Kop", "Kop Sergeant", "Kop Lieutenant", "Kop Kaptain", "lich", "demilich",
    "master lich", "arch-lich", "kobold mummy", "gnome mummy", "orc mummy", "dwarf mummy",
    "elf mummy", "human mummy", "ettin mummy", "giant mummy", "red naga hatchling",
    "black naga hatchling", "golden naga hatchling", "guardian naga hatchling", "red naga",
    "black naga", "golden naga", "guardian naga", "ogre", "ogre leader", "ogre tyrant",
    "gray ooze", "brown pudding", "green slime", "black pudding", "quantum mechanic",
    "genetic engineer", "rust monster", "disenchanter", "garter snake", "snake",
    "water moccasin", "python", "pit viper", "cobra", "troll", "ice troll", "rock troll",
    "water troll", "Olog-hai", "umber hulk", "vampire", "vampire leader", "Vlad the Impaler",
    "barrow wight", "wraith", "Nazgul", "xorn", "monkey", "ape", "owlbear", "yeti",
    "carnivorous ape", "sasquatch", "kobold zombie", "gnome zombie", "orc zombie",
    "dwarf zombie", "elf zombie", "human zombie", "ettin zombie", "ghoul", "giant zombie",
    "skeleton", "straw golem", "paper golem", "rope golem", "gold golem", "leather golem",
    "wood golem", "flesh golem", "clay golem", "stone golem", "glass golem", "iron golem",
    "human", "wererat", "werejackal", "werewolf", "elf", "Woodland-elf", "Green-elf",
    "Grey-elf", "elf-noble", "elven monarch", "doppelganger", "shopkeeper", "guard", "prisoner",
    "Oracle", "aligned cleric", "high cleric", "soldier", "sergeant", "nurse", "lieutenant",
    "captain", "watchman", "watch captain", "Medusa", "Wizard of Yendor", "Croesus", "ghost",
    "shade", "water demon", "amorous demon", "horned devil", "erinys", "barbed devil",
    "marilith", "vrock", "hezrou", "bone devil", "ice devil", "nalfeshnee", "pit fiend",
    "sandestin", "balrog", "Juiblex", "Yeenoghu", "Orcus", "Geryon", "Dispater", "Baalzebub",
    "Asmodeus", "Demogorgon", "Death", "Pestilence", "Famine", "djinni", "jellyfish", "piranha",
    "shark", "giant eel", "electric eel", "kraken", "newt", "gecko", "iguana", "baby crocodile",
    "lizard", "chameleon", "crocodile", "salamander", "long worm tail", "archeologist",
    "barbarian", "cave dweller", "healer", "knight", "monk", "cleric", "ranger", "rogue",
    "samurai", "tourist", "valkyrie", "wizard", "Lord Carnarvon", "Pelias", "Shaman Karnov",
    "Hippocrates", "King Arthur", "Grand Master", "Arch Priest", "Orion", "Master of Thieves",
    "Lord Sato", "Twoflower", "Norn", "Neferet the Green", "Minion of Huhetotl", "Thoth Amon",
    "Chromatic Dragon", "Cyclops", "Ixoth", "Master Kaen", "Nalzok", "Scorpius",
    "Master Assassin", "Ashikaga Takauji", "Lord Surtur", "Dark One", "student", "chieftain",
    "neanderthal", "attendant", "page", "abbot", "acolyte", "hunter", "thug", "ninja", "roshi",
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
    0, 1, 2, 3, 5, 6, 9, 51, 52, 63, 88, 89, 90, 91, 94, 95, 116, 117, 126,
    214, 321, 322, 323, 325, 326,
]);

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
    verysmall: VERYSMALL.has(t[0]), // MZ_TINY -> true (used by mkobj.js)
}));

// Monster classes whose members carry their own weapon-generation behavior in
// m_initweap(); only S_KOBOLD/S_ORC are reachable in the low-level slice.
const ARMED_MCLS = new Set([11 /*S_KOBOLD*/, 15 /*S_ORC*/]);

export function monster_by_pmidx(pmidx) {
    return MONS[pmidx] ?? null;
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
const PM_SCORPIUS = 363;

// M1_OVIPAROUS monsters (lays_eggs()), as a Set of pmidx.
const LAYS_EGGS = new Set([
    0, 2, 3, 5, 10, 11, 42, 94, 95, 96, 97, 114, 115, 128, 143, 144, 145, 146,
    147, 148, 149, 150, 151, 152, 199, 200, 201, 202, 214, 215, 216, 217, 218,
    219, 316, 317, 318, 319, 327, 363,
]);

// Monsters with cnutrit == 0 (no nutrition); the complement is "has cnutrit".
// Used by the TIN generation loop's mons[mndx].cnutrit test.
const ZERO_CNUTRIT = new Set([
    106, 107, 108, 109, 110, 111, 118, 119, 154, 155, 156, 157, 229, 230, 231,
    249, 250, 251, 252, 253, 254, 256, 257, 258, 259, 287, 288, 303, 329,
]);

// grownups[] little -> big progression (src/mondata.c), as pmidx pairs.
const GROWNUPS_LITTLE_TO_BIG = new Map([
    [9, 10], [16, 18], [18, 19], [25, 26], [22, 24], [32, 33], [33, 37],
    [100, 104], [104, 105], [59, 60], [60, 61], [165, 166], [166, 168],
    [44, 46], [46, 47], [48, 49], [72, 77], [73, 77], [74, 77], [75, 77],
    [88, 89], [94, 96], [203, 204], [204, 205], [264, 268], [265, 268],
    [266, 268], [267, 268], [268, 269], [183, 184], [184, 185], [185, 186],
    [226, 227], [126, 127], [133, 143], [134, 144], [135, 145], [136, 146],
    [137, 147], [138, 148], [139, 149], [140, 150], [141, 151], [142, 152],
    [195, 199], [196, 200], [197, 201], [198, 202], [64, 65], [65, 66],
    [112, 114], [113, 115], [324, 327], [277, 278], [278, 280], [280, 281],
    [282, 283], [275, 276], [368, 330], [371, 333], [372, 334], [374, 336],
    [381, 342], [50, 53], [179, 180], [180, 181], [181, 182],
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
    return LAYS_EGGS.has(mndx);
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
    return !ZERO_CNUTRIT.has(mndx);
}

// G_NOCORPSE flag for a monster (mons[mndx].geno & G_NOCORPSE).
export function mon_nocorpse(mndx) {
    return (MONS[mndx]?.geno & G_NOCORPSE) !== 0;
}

function level_difficulty() {
    return depth_of_level(game.u?.uz);
}

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

function Inhell() {
    const dnum = game.u?.uz?.dnum ?? 0;
    return dnum === (game.gehennom_dnum ?? GEHENNOM);
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
    const lev = game.special_levels?.find?.(l => l?.dlevel?.dnum === dnum
        && l?.dlevel?.dlevel === (game.u?.uz?.dlevel ?? 1));
    const raw = lev?.flags?.align
        ?? game.dungeons?.[dnum]?.flags?.align
        ?? DUNGEON_ALIGN_BY_DNUM[dnum]
        ?? A_NONE;

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

function wrong_elem_type(_ptr) {
    // Elemental plane filtering is outside the current level-generation slice.
    return false;
}

function isupper_sym(ptr) {
    const c = ptr.mlet;
    return c >= 'A' && c <= 'Z';
}

// C ref: rndmonst_adj() (makemon.c:1658).  Weighted reservoir sampling over
// the full mons[] array (LOW_PM .. SPECIAL_PM).
export function rndmonst_adj(minadj = 0, maxadj = 0) {
    if (game.u?.uz?.dnum === game.quest_dnum) {
        if (rn2(7)) return null; // qt_montype() is not ported yet.
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

function next_ident() {
    return rnd(2);
}

// C ref: mongets() (makemon.c:2181). Creates obj via mksobj and gives it to
// mtmp. We only need the RNG-consuming mksobj() call; the post-creation
// blessing/spe tweaks in C don't consume RNG for the low-level cases here.
function mongets(_mtmp, otyp) {
    if (!otyp) return;
    mksobj(otyp, true, false);
}

function m_initthrow(_mtmp, otyp, oquan) {
    mksobj(otyp, true, false);
    rn2(oquan); // rn1(oquan, 3) — quantity (the +3 base consumes no RNG)
}

// C ref: adj_lev() (makemon.c:2016). Adjusts a monster's level for the
// current depth and player level. The slice has no Wizard of Yendor / special
// (>49) monsters, so only the general path is needed.
function adj_lev(ptr) {
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

// C ref: newmonhp() (makemon.c:1012). Sets mon.m_lev / mhp / mhpmax and
// returns mhp. Only the general (non-golem, non-rider, non-special, non-dragon)
// paths are reachable by the low-level slice.
export function newmonhp(mon) {
    const isMon = mon && mon.data !== undefined;
    const ptr = isMon ? mon.data : mon;
    const out = isMon ? mon : {};
    if (!ptr) return 0;

    out.m_lev = adj_lev(ptr);
    let basehp;
    if (!out.m_lev) {
        basehp = 1;
        out.mhpmax = out.mhp = rnd(4);
    } else {
        basehp = out.m_lev;
        out.mhpmax = out.mhp = d(basehp, 8);
    }

    if (out.mhpmax === basehp) {
        out.mhpmax += 1;
        out.mhp = out.mhpmax;
    }
    return out.mhp;
}

function m_initinv(ptr) {
    rn2(50);
    rn2(100);
}

// C ref: m_initweap() (makemon.c:160). Only the cases reachable by the
// low-level mons[] slice (S_KOBOLD, S_ORC) plus the general default tail are
// ported; the slice contains no giants/mercenaries/elves/etc.
function m_initweap(mtmp) {
    const ptr = mtmp?.data;
    if (!ptr || Is_rogue_level(game.u?.uz)) return;

    switch (ptr.mcls) {
    case 15: { // S_ORC
        if (rn2(2)) // makemon.c:411
            mongets(mtmp, ORCISH_HELM);
        if (rn2(2)) // mm != PM_ORC_SHAMAN && rn2(2)
            mongets(mtmp, ORCISH_DAGGER); // mm == PM_GOBLIN -> ORCISH_DAGGER
        break;
    }
    case 11: // S_KOBOLD (makemon.c:469)
        if (!rn2(4))
            m_initthrow(mtmp, DART, 12);
        break;
    default:
        break;
    }

    if (mtmp.m_lev > rn2(75))
        mongets(mtmp, rnd_offensive_item(mtmp));
}

// C ref: rnd_offensive_item() (muse.c:2035).
function rnd_offensive_item(mtmp) {
    const ptr = mtmp?.data;
    const difficulty = ptr?.difficulty ?? 0;
    if (difficulty > 7 && !rn2(35)) return /*WAN_DEATH*/ 432;
    rn2(9 - (difficulty < 4 ? 1 : 0) + 4 * (difficulty > 6 ? 1 : 0));
    return 0;
}

export function makemon(mdat = null, x = 0, y = 0, mmflags = 0) {
    const ptr = mdat ?? rndmonst();
    if (!ptr) return null;

    const mtmp = { data: ptr, mx: x, my: y, mmflags };
    mtmp.m_id = next_ident();
    newmonhp(mtmp);
    // C makemon.c:1259-1279: femaleok = (!is_male && !is_neuter).  For monsters
    // that aren't fixed-gender (is_male/is_female) and aren't leader/nemesis
    // (none in this slice), the gender draw rn2(2) happens only when femaleok.
    // gcode: 0 femaleok -> rn2(2); 1 male -> female=0; 2 female -> female=1;
    // 3 neuter -> female=0.  No RNG is consumed for fixed-gender/neuter mons.
    if (ptr.gcode === 0)
        mtmp.female = rn2(2);
    else
        mtmp.female = (ptr.gcode === 2) ? 1 : 0;

    if (ARMED_MCLS.has(ptr.mcls))
        m_initweap(mtmp);
    m_initinv(ptr);
    rn2(100); // saddle chance, checked before domestic/can_saddle predicates.
    return mtmp;
}
