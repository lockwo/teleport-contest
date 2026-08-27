// weapondmg_data.js — GENERATED, do not hand-edit.
//
// oc_wsdam / oc_wldam / oc_hitbon per otyp, indexed by OUR otyp.
//
// REGENERATED 2026-08-14 by dumping the recorder's own objects.o rather than
// parsing objects.h macros by field position.  The old parser only understood
// WEAPON/PROJECTILE/BOW, so it silently omitted 44 otyps that carry damage in
// C: every WEPTOOL (pick-axe 6/3, grappling hook 2/6, unicorn horn 12/12) and
// every GEM/ROCK (all gems 3/3).  Three independent session analyses hit that
// same hole from different directions — dmgval() returning 0 on seed0361, the
// gem/rock oc_wsdam on seed4500, and the BOULDER dice on seed0014.
//
//   cc -g -I include -DNOTPARMDECL -DNO_TIMED_DELAY -o dumpdmg dumpdmg.c src/objects.o
//
// from nethack-c/recorder, calling objects_globals_init() and printing
// objects[i].oc_wsdam / oc_wldam / oc_oc1.  Exact by construction and class-
// agnostic.  The recorder's CFLAGS are REQUIRED — without them struct objclass
// has a different layout and every field reads as garbage.
//
// Verified index-aligned against js/mkobj.js objects[] (both 481 entries).
export const WEP_SDAM = {
    18: 6,   // arrow
    19: 7,   // elven arrow
    20: 5,   // orcish arrow
    21: 6,   // silver arrow
    22: 7,   // ya
    23: 4,   // crossbow bolt
    24: 3,   // dart
    25: 8,   // shuriken
    26: 9,   // boomerang
    27: 6,   // spear
    28: 7,   // elven spear
    29: 5,   // orcish spear
    30: 8,   // dwarvish spear
    31: 6,   // silver spear
    32: 6,   // javelin
    33: 6,   // trident
    34: 4,   // dagger
    35: 5,   // elven dagger
    36: 3,   // orcish dagger
    37: 4,   // silver dagger
    38: 4,   // athame
    39: 3,   // scalpel
    40: 3,   // knife
    41: 3,   // stiletto
    42: 2,   // worm tooth
    43: 10,   // crysknife
    44: 6,   // axe
    45: 8,   // battle-axe
    46: 6,   // short sword
    47: 8,   // elven short sword
    48: 5,   // orcish short sword
    49: 7,   // dwarvish short sword
    50: 8,   // scimitar
    51: 8,   // silver saber
    52: 4,   // broadsword
    53: 6,   // elven broadsword
    54: 8,   // long sword
    55: 12,   // two-handed sword
    56: 10,   // katana
    57: 16,   // tsurugi
    58: 4,   // runesword
    59: 6,   // partisan
    60: 4,   // ranseur
    61: 6,   // spetum
    62: 6,   // glaive
    63: 10,   // halberd
    64: 4,   // bardiche
    65: 4,   // voulge
    66: 6,   // fauchard
    67: 4,   // guisarme
    68: 4,   // bill-guisarme
    69: 4,   // lucern hammer
    70: 8,   // bec de corbin
    71: 12,   // dwarvish mattock
    72: 6,   // lance
    73: 6,   // mace
    74: 6,   // silver mace
    75: 4,   // morning star
    76: 4,   // war hammer
    77: 6,   // club
    78: 4,   // rubber hose
    79: 6,   // quarterstaff
    80: 6,   // aklys
    81: 6,   // flail
    82: 2,   // bullwhip
    83: 2,   // bow
    84: 2,   // elven bow
    85: 2,   // orcish bow
    86: 2,   // yumi
    87: 2,   // sling
    88: 2,   // crossbow
    259: 6,   // pick-axe
    260: 2,   // grappling hook
    261: 12,   // unicorn horn
    439: 3,   // dilithium crystal
    440: 3,   // diamond
    441: 3,   // ruby
    442: 3,   // jacinth
    443: 3,   // sapphire
    444: 3,   // black opal
    445: 3,   // emerald
    446: 3,   // turquoise
    447: 3,   // citrine
    448: 3,   // aquamarine
    449: 3,   // amber
    450: 3,   // topaz
    451: 3,   // jet
    452: 3,   // opal
    453: 3,   // chrysoberyl
    454: 3,   // garnet
    455: 3,   // amethyst
    456: 3,   // jasper
    457: 3,   // fluorite
    458: 3,   // obsidian
    459: 3,   // agate
    460: 3,   // jade
    461: 3,   // worthless piece of white glass
    462: 3,   // worthless piece of blue glass
    463: 3,   // worthless piece of red glass
    464: 3,   // worthless piece of yellowish brown glass
    465: 3,   // worthless piece of orange glass
    466: 3,   // worthless piece of yellow glass
    467: 3,   // worthless piece of black glass
    468: 3,   // worthless piece of green glass
    469: 3,   // worthless piece of violet glass
    470: 3,   // luckstone
    471: 3,   // loadstone
    472: 3,   // touchstone
    473: 6,   // flint
    474: 3,   // rock
    475: 20,   // boulder
    476: 20,   // statue
    477: 25,   // heavy iron ball
    478: 4,   // iron chain
    480: 6,   // splash of acid venom
};

export const WEP_LDAM = {
    18: 6,   // arrow
    19: 6,   // elven arrow
    20: 6,   // orcish arrow
    21: 6,   // silver arrow
    22: 7,   // ya
    23: 6,   // crossbow bolt
    24: 2,   // dart
    25: 6,   // shuriken
    26: 9,   // boomerang
    27: 8,   // spear
    28: 8,   // elven spear
    29: 8,   // orcish spear
    30: 8,   // dwarvish spear
    31: 8,   // silver spear
    32: 6,   // javelin
    33: 4,   // trident
    34: 3,   // dagger
    35: 3,   // elven dagger
    36: 3,   // orcish dagger
    37: 3,   // silver dagger
    38: 3,   // athame
    39: 3,   // scalpel
    40: 2,   // knife
    41: 2,   // stiletto
    42: 2,   // worm tooth
    43: 10,   // crysknife
    44: 4,   // axe
    45: 6,   // battle-axe
    46: 8,   // short sword
    47: 8,   // elven short sword
    48: 8,   // orcish short sword
    49: 8,   // dwarvish short sword
    50: 8,   // scimitar
    51: 8,   // silver saber
    52: 6,   // broadsword
    53: 6,   // elven broadsword
    54: 12,   // long sword
    55: 6,   // two-handed sword
    56: 12,   // katana
    57: 8,   // tsurugi
    58: 6,   // runesword
    59: 6,   // partisan
    60: 4,   // ranseur
    61: 6,   // spetum
    62: 10,   // glaive
    63: 6,   // halberd
    64: 4,   // bardiche
    65: 4,   // voulge
    66: 8,   // fauchard
    67: 8,   // guisarme
    68: 10,   // bill-guisarme
    69: 6,   // lucern hammer
    70: 6,   // bec de corbin
    71: 8,   // dwarvish mattock
    72: 8,   // lance
    73: 6,   // mace
    74: 6,   // silver mace
    75: 6,   // morning star
    76: 4,   // war hammer
    77: 3,   // club
    78: 3,   // rubber hose
    79: 6,   // quarterstaff
    80: 3,   // aklys
    81: 4,   // flail
    82: 1,   // bullwhip
    83: 2,   // bow
    84: 2,   // elven bow
    85: 2,   // orcish bow
    86: 2,   // yumi
    87: 2,   // sling
    88: 2,   // crossbow
    259: 3,   // pick-axe
    260: 6,   // grappling hook
    261: 12,   // unicorn horn
    439: 3,   // dilithium crystal
    440: 3,   // diamond
    441: 3,   // ruby
    442: 3,   // jacinth
    443: 3,   // sapphire
    444: 3,   // black opal
    445: 3,   // emerald
    446: 3,   // turquoise
    447: 3,   // citrine
    448: 3,   // aquamarine
    449: 3,   // amber
    450: 3,   // topaz
    451: 3,   // jet
    452: 3,   // opal
    453: 3,   // chrysoberyl
    454: 3,   // garnet
    455: 3,   // amethyst
    456: 3,   // jasper
    457: 3,   // fluorite
    458: 3,   // obsidian
    459: 3,   // agate
    460: 3,   // jade
    461: 3,   // worthless piece of white glass
    462: 3,   // worthless piece of blue glass
    463: 3,   // worthless piece of red glass
    464: 3,   // worthless piece of yellowish brown glass
    465: 3,   // worthless piece of orange glass
    466: 3,   // worthless piece of yellow glass
    467: 3,   // worthless piece of black glass
    468: 3,   // worthless piece of green glass
    469: 3,   // worthless piece of violet glass
    470: 3,   // luckstone
    471: 3,   // loadstone
    472: 3,   // touchstone
    473: 6,   // flint
    474: 3,   // rock
    475: 20,   // boulder
    476: 20,   // statue
    477: 25,   // heavy iron ball
    478: 4,   // iron chain
    480: 6,   // splash of acid venom
};

export const WEP_HITBON = {
    22: 1,   // ya
    25: 2,   // shuriken
    34: 2,   // dagger
    35: 2,   // elven dagger
    36: 2,   // orcish dagger
    37: 2,   // silver dagger
    38: 2,   // athame
    39: 2,   // scalpel
    43: 3,   // crysknife
    56: 1,   // katana
    57: 2,   // tsurugi
    71: -1,   // dwarvish mattock
    89: 1,   // elven leather helm
    90: 1,   // orcish helm
    91: 2,   // dwarvish iron helm
    95: 1,   // dented pot
    96: 1,   // helm of brilliance
    97: 1,   // helmet
    98: 1,   // helm of caution
    99: 1,   // helm of opposite alignment
    100: 1,   // helm of telepathy
    101: 9,   // gray dragon scale mail
    102: 9,   // gold dragon scale mail
    103: 9,   // silver dragon scale mail
    104: 9,   // red dragon scale mail
    105: 9,   // white dragon scale mail
    106: 9,   // orange dragon scale mail
    107: 9,   // black dragon scale mail
    108: 9,   // blue dragon scale mail
    109: 9,   // green dragon scale mail
    110: 9,   // yellow dragon scale mail
    111: 3,   // gray dragon scales
    112: 3,   // gold dragon scales
    113: 3,   // silver dragon scales
    114: 3,   // red dragon scales
    115: 3,   // white dragon scales
    116: 3,   // orange dragon scales
    117: 3,   // black dragon scales
    118: 3,   // blue dragon scales
    119: 3,   // green dragon scales
    120: 3,   // yellow dragon scales
    121: 7,   // plate mail
    122: 7,   // crystal plate mail
    123: 6,   // bronze plate mail
    124: 6,   // splint mail
    125: 6,   // banded mail
    126: 6,   // dwarvish mithril-coat
    127: 5,   // elven mithril-coat
    128: 5,   // chain mail
    129: 4,   // orcish chain mail
    130: 4,   // scale mail
    131: 3,   // studded leather armor
    132: 3,   // ring mail
    133: 2,   // orcish ring mail
    134: 2,   // leather armor
    135: 1,   // leather jacket
    139: 1,   // elven cloak
    142: 1,   // oilskin cloak
    143: 2,   // robe
    144: 1,   // alchemy smock
    145: 1,   // leather cloak
    146: 3,   // cloak of protection
    147: 1,   // cloak of invisibility
    148: 1,   // cloak of magic resistance
    149: 1,   // cloak of displacement
    150: 1,   // small shield
    151: 1,   // shield of drain resistance
    152: 1,   // shield of shock resistance
    153: 2,   // elven shield
    154: 1,   // Uruk-hai shield
    155: 1,   // orcish shield
    156: 2,   // large shield
    157: 2,   // dwarvish roundshield
    158: 2,   // shield of reflection
    159: 1,   // leather gloves
    160: 1,   // gauntlets of fumbling
    161: 1,   // gauntlets of power
    162: 1,   // gauntlets of dexterity
    163: 1,   // low boots
    164: 2,   // iron shoes
    165: 2,   // high boots
    166: 1,   // speed boots
    167: 1,   // water walking boots
    168: 1,   // jumping boots
    169: 1,   // elven boots
    170: 1,   // kicking boots
    171: 1,   // fumble boots
    172: 1,   // levitation boots
    259: 4,   // pick-axe
    260: 4,   // grappling hook
    261: 1,   // unicorn horn
};
