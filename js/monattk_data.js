// monattk_data.js — GENERATED, do not hand-edit.
// Source: nethack-c/recorder/include/{monsters.h,monattk.h} (the C build that
// produced the recorded sessions), via swarm/bin/gen-monattk.mjs.
//
// MATTK[pmidx] is the monster's mattk[] table as an array of
// [aatyp, adtyp, damn, damd] tuples, in monsters.h slot order, with the
// trailing NO_ATTK slots dropped (they can never match an attacktype() /
// dmgtype() query).  Indexed by the SAME pmidx js/makemon.js uses; the
// generator refuses to emit unless all 383 indices match that table by name.
//
// Prefer this over a name-keyed attack table: attacktype()-derived predicates
// (is_armed -> likes_objs -> mon_would_take_item, AT_GAZE, AT_ENGL,
// ranged_attk_available) are silently wrong for every unlisted monster when the
// fallback invents a generic bite.

export const AT_ANY = -1;
export const AT_NONE = 0;
export const AT_CLAW = 1;
export const AT_BITE = 2;
export const AT_KICK = 3;
export const AT_BUTT = 4;
export const AT_TUCH = 5;
export const AT_STNG = 6;
export const AT_HUGS = 7;
export const AT_SPIT = 10;
export const AT_ENGL = 11;
export const AT_BREA = 12;
export const AT_EXPL = 13;
export const AT_BOOM = 14;
export const AT_GAZE = 15;
export const AT_TENT = 16;
export const AT_WEAP = 254;
export const AT_MAGC = 255;

export const AD_ANY = -1;
export const AD_PHYS = 0;
export const AD_MAGM = 1;
export const AD_FIRE = 2;
export const AD_COLD = 3;
export const AD_SLEE = 4;
export const AD_DISN = 5;
export const AD_ELEC = 6;
export const AD_DRST = 7;
export const AD_ACID = 8;
export const AD_SPC1 = 9;
export const AD_SPC2 = 10;
export const AD_BLND = 11;
export const AD_STUN = 12;
export const AD_SLOW = 13;
export const AD_PLYS = 14;
export const AD_DRLI = 15;
export const AD_DREN = 16;
export const AD_LEGS = 17;
export const AD_STON = 18;
export const AD_STCK = 19;
export const AD_SGLD = 20;
export const AD_SITM = 21;
export const AD_SEDU = 22;
export const AD_TLPT = 23;
export const AD_RUST = 24;
export const AD_CONF = 25;
export const AD_DGST = 26;
export const AD_HEAL = 27;
export const AD_WRAP = 28;
export const AD_WERE = 29;
export const AD_DRDX = 30;
export const AD_DRCO = 31;
export const AD_DRIN = 32;
export const AD_DISE = 33;
export const AD_DCAY = 34;
export const AD_SSEX = 35;
export const AD_HALU = 36;
export const AD_DETH = 37;
export const AD_PEST = 38;
export const AD_FAMN = 39;
export const AD_SLIM = 40;
export const AD_ENCH = 41;
export const AD_CORR = 42;
export const AD_POLY = 43;
export const AD_CLRC = 240;
export const AD_SPEL = 241;
export const AD_RBRE = 242;
export const AD_SAMU = 252;
export const AD_CURS = 253;

export const NATTK = 6;

export const MATTK = [
    /*   0 giant ant */ [[2,0,1,4]],
    /*   1 killer bee */ [[6,7,1,3]],
    /*   2 soldier ant */ [[2,0,2,4],[6,7,3,4]],
    /*   3 fire ant */ [[2,0,2,4],[2,2,2,4]],
    /*   4 giant beetle */ [[2,0,3,6]],
    /*   5 queen bee */ [[6,7,1,8]],
    /*   6 acid blob */ [[0,8,1,8]],
    /*   7 quivering blob */ [[5,0,1,8]],
    /*   8 gelatinous cube */ [[5,14,2,4],[0,14,1,4]],
    /*   9 chickatrice */ [[2,0,1,2],[5,18,0,0],[0,18,0,0]],
    /*  10 cockatrice */ [[2,0,1,3],[5,18,0,0],[0,18,0,0]],
    /*  11 pyrolisk */ [[15,2,2,6],[2,0,1,6]],
    /*  12 jackal */ [[2,0,1,2]],
    /*  13 fox */ [[2,0,1,3]],
    /*  14 coyote */ [[2,0,1,4]],
    /*  15 werejackal */ [[2,29,1,4]],
    /*  16 little dog */ [[2,0,1,6]],
    /*  17 dingo */ [[2,0,1,6]],
    /*  18 dog */ [[2,0,1,6]],
    /*  19 large dog */ [[2,0,2,4]],
    /*  20 wolf */ [[2,0,2,4]],
    /*  21 werewolf */ [[2,29,2,6]],
    /*  22 winter wolf cub */ [[2,0,1,8],[12,3,1,6]],
    /*  23 warg */ [[2,0,2,6]],
    /*  24 winter wolf */ [[2,0,2,6],[12,3,2,6]],
    /*  25 hell hound pup */ [[2,0,2,6],[12,2,2,6]],
    /*  26 hell hound */ [[2,0,3,6],[12,2,3,6]],
    /*  27 gas spore */ [[14,0,4,6]],
    /*  28 floating eye */ [[0,14,0,70]],
    /*  29 freezing sphere */ [[13,3,4,6]],
    /*  30 flaming sphere */ [[13,2,4,6]],
    /*  31 shocking sphere */ [[13,6,4,6]],
    /*  32 kitten */ [[2,0,1,6]],
    /*  33 housecat */ [[2,0,1,6]],
    /*  34 jaguar */ [[1,0,1,4],[1,0,1,4],[2,0,1,8]],
    /*  35 lynx */ [[1,0,1,4],[1,0,1,4],[2,0,1,10]],
    /*  36 panther */ [[1,0,1,6],[1,0,1,6],[2,0,1,10]],
    /*  37 large cat */ [[2,0,2,4]],
    /*  38 tiger */ [[1,0,2,4],[1,0,2,4],[2,0,1,10]],
    /*  39 displacer beast */ [[1,0,4,4],[1,0,4,4],[2,0,2,10]],
    /*  40 gremlin */ [[1,0,1,6],[1,0,1,6],[2,0,1,4],[1,253,0,0]],
    /*  41 gargoyle */ [[1,0,2,6],[1,0,2,6],[2,0,2,4]],
    /*  42 winged gargoyle */ [[1,0,3,6],[1,0,3,6],[2,0,3,4]],
    /*  43 hobbit */ [[254,0,1,6]],
    /*  44 dwarf */ [[254,0,1,8]],
    /*  45 bugbear */ [[254,0,2,4]],
    /*  46 dwarf lord */ [[254,0,2,4],[254,0,2,4]],
    /*  47 dwarf king */ [[254,0,2,6],[254,0,2,6]],
    /*  48 mind flayer */ [[254,0,1,4],[16,32,2,1],[16,32,2,1],[16,32,2,1]],
    /*  49 master mind flayer */ [[254,0,1,8],[16,32,2,1],[16,32,2,1],[16,32,2,1],[16,32,2,1],[16,32,2,1]],
    /*  50 manes */ [[1,0,1,3],[1,0,1,3],[2,0,1,4]],
    /*  51 homunculus */ [[2,4,1,3]],
    /*  52 imp */ [[1,0,1,4]],
    /*  53 lemure */ [[1,0,1,3]],
    /*  54 quasit */ [[1,30,1,2],[1,30,1,2],[2,0,1,4]],
    /*  55 tengu */ [[2,0,1,7]],
    /*  56 blue jelly */ [[0,3,0,6]],
    /*  57 spotted jelly */ [[0,8,0,6]],
    /*  58 ochre jelly */ [[11,8,3,6],[0,8,3,6]],
    /*  59 kobold */ [[254,0,1,4]],
    /*  60 large kobold */ [[254,0,1,6]],
    /*  61 kobold lord */ [[254,0,2,4]],
    /*  62 kobold shaman */ [[255,241,0,0]],
    /*  63 leprechaun */ [[1,20,1,2]],
    /*  64 small mimic */ [[1,0,3,4]],
    /*  65 large mimic */ [[1,19,3,4]],
    /*  66 giant mimic */ [[1,19,3,6],[1,19,3,6]],
    /*  67 wood nymph */ [[1,21,0,0],[1,22,0,0]],
    /*  68 water nymph */ [[1,21,0,0],[1,22,0,0]],
    /*  69 mountain nymph */ [[1,21,0,0],[1,22,0,0]],
    /*  70 goblin */ [[254,0,1,4]],
    /*  71 hobgoblin */ [[254,0,1,6]],
    /*  72 orc */ [[254,0,1,8]],
    /*  73 hill orc */ [[254,0,1,6]],
    /*  74 Mordor orc */ [[254,0,1,6]],
    /*  75 Uruk-hai */ [[254,0,1,8]],
    /*  76 orc shaman */ [[255,241,0,0]],
    /*  77 orc-captain */ [[254,0,2,4],[254,0,2,4]],
    /*  78 rock piercer */ [[2,0,2,6]],
    /*  79 iron piercer */ [[2,0,3,6]],
    /*  80 glass piercer */ [[2,0,4,6]],
    /*  81 rothe */ [[1,0,1,3],[2,0,1,3],[2,0,1,8]],
    /*  82 mumak */ [[4,0,4,12],[2,0,2,6]],
    /*  83 leocrotta */ [[1,0,2,6],[2,0,2,6],[1,0,2,6]],
    /*  84 wumpus */ [[2,0,3,6]],
    /*  85 titanothere */ [[1,0,2,8]],
    /*  86 baluchitherium */ [[1,0,5,4],[1,0,5,4]],
    /*  87 mastodon */ [[4,0,4,8],[4,0,4,8]],
    /*  88 sewer rat */ [[2,0,1,3]],
    /*  89 giant rat */ [[2,0,1,3]],
    /*  90 rabid rat */ [[2,31,2,4]],
    /*  91 wererat */ [[2,29,1,4]],
    /*  92 rock mole */ [[2,0,1,6]],
    /*  93 woodchuck */ [[2,0,1,6]],
    /*  94 cave spider */ [[2,0,1,2]],
    /*  95 centipede */ [[2,7,1,3]],
    /*  96 giant spider */ [[2,7,2,4]],
    /*  97 scorpion */ [[1,0,1,2],[1,0,1,2],[6,7,1,4]],
    /*  98 lurker above */ [[11,28,1,6],[11,0,2,6]],
    /*  99 trapper */ [[11,28,1,8],[11,0,2,8]],
    /* 100 pony */ [[3,0,1,6],[2,0,1,2]],
    /* 101 white unicorn */ [[4,0,1,12],[3,0,1,6]],
    /* 102 gray unicorn */ [[4,0,1,12],[3,0,1,6]],
    /* 103 black unicorn */ [[4,0,1,12],[3,0,1,6]],
    /* 104 horse */ [[3,0,1,8],[2,0,1,3]],
    /* 105 warhorse */ [[3,0,1,10],[2,0,1,4]],
    /* 106 fog cloud */ [[11,0,1,6]],
    /* 107 dust vortex */ [[11,11,2,8]],
    /* 108 ice vortex */ [[11,3,1,6]],
    /* 109 energy vortex */ [[11,6,1,6],[11,16,2,6],[0,6,0,4]],
    /* 110 steam vortex */ [[11,2,1,8]],
    /* 111 fire vortex */ [[11,2,1,10],[0,2,0,4]],
    /* 112 baby long worm */ [[2,0,1,4]],
    /* 113 baby purple worm */ [[2,0,1,6]],
    /* 114 long worm */ [[2,0,2,4]],
    /* 115 purple worm */ [[2,0,2,8],[11,26,1,10]],
    /* 116 grid bug */ [[2,6,1,1]],
    /* 117 xan */ [[6,17,1,4]],
    /* 118 yellow light */ [[13,11,10,20]],
    /* 119 black light */ [[13,36,10,12]],
    /* 120 zruty */ [[1,0,3,4],[1,0,3,4],[2,0,3,6]],
    /* 121 couatl */ [[2,7,2,4],[2,0,1,3],[7,28,2,4]],
    /* 122 Aleax */ [[254,0,1,6],[254,0,1,6],[3,0,1,4]],
    /* 123 Angel */ [[254,0,1,6],[254,0,1,6],[1,0,1,4],[255,1,2,6]],
    /* 124 ki-rin */ [[3,0,2,4],[3,0,2,4],[4,0,3,6],[255,241,2,6]],
    /* 125 Archon */ [[254,0,2,4],[254,0,2,4],[15,11,2,6],[1,0,1,8],[255,241,4,6]],
    /* 126 bat */ [[2,0,1,4]],
    /* 127 giant bat */ [[2,0,1,6]],
    /* 128 raven */ [[2,0,1,6],[1,11,1,6]],
    /* 129 vampire bat */ [[2,0,1,6],[2,7,0,0]],
    /* 130 plains centaur */ [[254,0,1,6],[3,0,1,6]],
    /* 131 forest centaur */ [[254,0,1,8],[3,0,1,6]],
    /* 132 mountain centaur */ [[254,0,1,10],[3,0,1,6],[3,0,1,6]],
    /* 133 baby gray dragon */ [[2,0,2,6]],
    /* 134 baby gold dragon */ [[2,0,2,6]],
    /* 135 baby silver dragon */ [[2,0,2,6]],
    /* 136 baby red dragon */ [[2,0,2,6]],
    /* 137 baby white dragon */ [[2,0,2,6]],
    /* 138 baby orange dragon */ [[2,0,2,6]],
    /* 139 baby black dragon */ [[2,0,2,6]],
    /* 140 baby blue dragon */ [[2,0,2,6]],
    /* 141 baby green dragon */ [[2,0,2,6]],
    /* 142 baby yellow dragon */ [[2,0,2,6]],
    /* 143 gray dragon */ [[12,1,4,6],[2,0,3,8],[1,0,1,4],[1,0,1,4]],
    /* 144 gold dragon */ [[12,2,4,6],[2,0,3,8],[1,0,1,4],[1,0,1,4]],
    /* 145 silver dragon */ [[12,3,4,6],[2,0,3,8],[1,0,1,4],[1,0,1,4]],
    /* 146 red dragon */ [[12,2,6,6],[2,0,3,8],[1,0,1,4],[1,0,1,4]],
    /* 147 white dragon */ [[12,3,4,6],[2,0,3,8],[1,0,1,4],[1,0,1,4]],
    /* 148 orange dragon */ [[12,4,4,25],[2,0,3,8],[1,0,1,4],[1,0,1,4]],
    /* 149 black dragon */ [[12,5,1,255],[2,0,3,8],[1,0,1,4],[1,0,1,4]],
    /* 150 blue dragon */ [[12,6,4,6],[2,0,3,8],[1,0,1,4],[1,0,1,4]],
    /* 151 green dragon */ [[12,7,4,6],[2,0,3,8],[1,0,1,4],[1,0,1,4]],
    /* 152 yellow dragon */ [[12,8,4,6],[2,0,3,8],[1,0,1,4],[1,0,1,4]],
    /* 153 stalker */ [[1,0,4,4]],
    /* 154 air elemental */ [[11,0,1,10]],
    /* 155 fire elemental */ [[1,2,3,6],[0,2,0,4]],
    /* 156 earth elemental */ [[1,0,4,6]],
    /* 157 water elemental */ [[1,0,5,6]],
    /* 158 lichen */ [[5,19,0,0]],
    /* 159 brown mold */ [[0,3,0,6]],
    /* 160 yellow mold */ [[0,12,0,4]],
    /* 161 green mold */ [[0,8,0,4]],
    /* 162 red mold */ [[0,2,0,4]],
    /* 163 shrieker */ [],
    /* 164 violet fungus */ [[5,0,1,4],[5,19,0,0]],
    /* 165 gnome */ [[254,0,1,6]],
    /* 166 gnome lord */ [[254,0,1,8]],
    /* 167 gnomish wizard */ [[255,241,0,0]],
    /* 168 gnome king */ [[254,0,2,6]],
    /* 169 giant */ [[254,0,2,10]],
    /* 170 stone giant */ [[254,0,2,10]],
    /* 171 hill giant */ [[254,0,2,8]],
    /* 172 fire giant */ [[254,0,2,10]],
    /* 173 frost giant */ [[254,0,2,12]],
    /* 174 ettin */ [[254,0,2,8],[254,0,3,6]],
    /* 175 storm giant */ [[254,0,2,12]],
    /* 176 titan */ [[254,0,2,8],[255,241,0,0]],
    /* 177 minotaur */ [[1,0,3,10],[1,0,3,10],[4,0,2,8]],
    /* 178 jabberwock */ [[2,0,2,10],[2,0,2,10],[1,0,2,10],[1,0,2,10]],
    /* 179 Keystone Kop */ [[254,0,1,4]],
    /* 180 Kop Sergeant */ [[254,0,1,6]],
    /* 181 Kop Lieutenant */ [[254,0,1,8]],
    /* 182 Kop Kaptain */ [[254,0,2,6]],
    /* 183 lich */ [[5,3,1,10],[255,241,0,0]],
    /* 184 demilich */ [[5,3,3,4],[255,241,0,0]],
    /* 185 master lich */ [[5,3,3,6],[255,241,0,0]],
    /* 186 arch-lich */ [[5,3,5,6],[255,241,0,0]],
    /* 187 kobold mummy */ [[1,0,1,4]],
    /* 188 gnome mummy */ [[1,0,1,6]],
    /* 189 orc mummy */ [[1,0,1,6]],
    /* 190 dwarf mummy */ [[1,0,1,6]],
    /* 191 elf mummy */ [[1,0,2,4]],
    /* 192 human mummy */ [[1,0,2,4],[1,0,2,4]],
    /* 193 ettin mummy */ [[1,0,2,6],[1,0,2,6]],
    /* 194 giant mummy */ [[1,0,3,4],[1,0,3,4]],
    /* 195 red naga hatchling */ [[2,0,1,4]],
    /* 196 black naga hatchling */ [[2,0,1,4]],
    /* 197 golden naga hatchling */ [[2,0,1,4]],
    /* 198 guardian naga hatchling */ [[2,0,1,4]],
    /* 199 red naga */ [[2,0,2,4],[12,2,2,6]],
    /* 200 black naga */ [[2,0,2,6],[10,8,0,0]],
    /* 201 golden naga */ [[2,0,2,6],[255,241,4,6]],
    /* 202 guardian naga */ [[10,7,1,6],[2,14,1,6],[5,0,0,0],[7,28,2,4]],
    /* 203 ogre */ [[254,0,2,5]],
    /* 204 ogre lord */ [[254,0,2,6]],
    /* 205 ogre king */ [[254,0,3,5]],
    /* 206 gray ooze */ [[2,24,2,8]],
    /* 207 brown pudding */ [[2,34,0,0]],
    /* 208 green slime */ [[5,40,1,4],[0,40,0,0]],
    /* 209 black pudding */ [[2,42,3,8],[0,42,0,0]],
    /* 210 quantum mechanic */ [[1,23,1,4]],
    /* 211 genetic engineer */ [[1,43,1,4]],
    /* 212 rust monster */ [[5,24,0,0],[5,24,0,0],[0,24,0,0]],
    /* 213 disenchanter */ [[1,41,4,4],[0,41,0,0]],
    /* 214 garter snake */ [[2,0,1,2]],
    /* 215 snake */ [[2,7,1,6]],
    /* 216 water moccasin */ [[2,7,1,6]],
    /* 217 python */ [[2,0,1,4],[5,0,0,0],[7,28,1,4],[7,0,2,4]],
    /* 218 pit viper */ [[2,7,1,4],[2,7,1,4]],
    /* 219 cobra */ [[2,7,2,4],[10,11,0,0]],
    /* 220 troll */ [[254,0,4,2],[1,0,4,2],[2,0,2,6]],
    /* 221 ice troll */ [[254,0,2,6],[1,3,2,6],[2,0,2,6]],
    /* 222 rock troll */ [[254,0,3,6],[1,0,2,8],[2,0,2,6]],
    /* 223 water troll */ [[254,0,2,8],[1,0,2,8],[2,0,2,6]],
    /* 224 Olog-hai */ [[254,0,3,6],[1,0,2,8],[2,0,2,6]],
    /* 225 umber hulk */ [[1,0,3,4],[1,0,3,4],[2,0,2,5],[15,25,0,0]],
    /* 226 vampire */ [[1,0,1,6],[2,15,1,6]],
    /* 227 vampire lord */ [[1,0,1,8],[2,15,1,8]],
    /* 228 Vlad the Impaler */ [[254,0,2,10],[2,15,1,12]],
    /* 229 barrow wight */ [[254,15,0,0],[255,241,0,0],[1,0,1,4],[5,3,1,4]],
    /* 230 wraith */ [[5,15,1,6]],
    /* 231 Nazgul */ [[254,15,1,4],[12,4,2,25]],
    /* 232 xorn */ [[1,0,1,3],[1,0,1,3],[1,0,1,3],[2,0,4,6]],
    /* 233 monkey */ [[1,21,0,0],[2,0,1,3]],
    /* 234 ape */ [[1,0,1,3],[1,0,1,3],[2,0,1,6]],
    /* 235 owlbear */ [[1,0,1,6],[1,0,1,6],[7,0,2,8]],
    /* 236 yeti */ [[1,0,1,6],[1,0,1,6],[2,0,1,4]],
    /* 237 carnivorous ape */ [[1,0,1,4],[1,0,1,4],[7,0,1,8]],
    /* 238 sasquatch */ [[1,0,1,6],[1,0,1,6],[3,0,1,8]],
    /* 239 kobold zombie */ [[1,0,1,4]],
    /* 240 gnome zombie */ [[1,0,1,5]],
    /* 241 orc zombie */ [[1,0,1,6]],
    /* 242 dwarf zombie */ [[1,0,1,6]],
    /* 243 elf zombie */ [[1,0,1,7]],
    /* 244 human zombie */ [[1,0,1,8]],
    /* 245 ettin zombie */ [[1,0,1,10],[1,0,1,10]],
    /* 246 ghoul */ [[1,14,1,2],[1,0,1,3]],
    /* 247 giant zombie */ [[1,0,2,8],[1,0,2,8]],
    /* 248 skeleton */ [[254,0,2,6],[5,13,1,6]],
    /* 249 straw golem */ [[1,0,1,2],[1,0,1,2]],
    /* 250 paper golem */ [[1,0,1,3]],
    /* 251 rope golem */ [[1,0,1,4],[1,0,1,4],[7,0,6,1]],
    /* 252 gold golem */ [[1,0,2,3],[1,0,2,3]],
    /* 253 leather golem */ [[1,0,1,6],[1,0,1,6]],
    /* 254 wood golem */ [[1,0,3,4]],
    /* 255 flesh golem */ [[1,0,2,8],[1,0,2,8]],
    /* 256 clay golem */ [[1,0,3,10]],
    /* 257 stone golem */ [[1,0,3,8]],
    /* 258 glass golem */ [[1,0,2,8],[1,0,2,8]],
    /* 259 iron golem */ [[254,0,4,10],[12,7,4,6]],
    /* 260 human */ [[254,0,1,6]],
    /* 261 wererat */ [[254,0,2,4]],
    /* 262 werejackal */ [[254,0,2,4]],
    /* 263 werewolf */ [[254,0,2,4]],
    /* 264 elf */ [[254,0,1,8]],
    /* 265 Woodland-elf */ [[254,0,2,4]],
    /* 266 Green-elf */ [[254,0,2,4]],
    /* 267 Grey-elf */ [[254,0,2,4]],
    /* 268 elf-lord */ [[254,0,2,4],[254,0,2,4]],
    /* 269 Elvenking */ [[254,0,2,4],[254,0,2,4]],
    /* 270 doppelganger */ [[254,0,1,12]],
    /* 271 shopkeeper */ [[254,0,4,4],[254,0,4,4]],
    /* 272 guard */ [[254,0,4,10]],
    /* 273 prisoner */ [[254,0,1,6]],
    /* 274 Oracle */ [[0,1,0,4]],
    /* 275 priest */ [[254,0,4,10],[3,0,1,4],[255,240,0,0]],
    /* 276 high priest */ [[254,0,4,10],[3,0,2,8],[255,240,2,8],[255,240,2,8]],
    /* 277 soldier */ [[254,0,1,8]],
    /* 278 sergeant */ [[254,0,2,6]],
    /* 279 nurse */ [[1,27,2,6]],
    /* 280 lieutenant */ [[254,0,3,4],[254,0,3,4]],
    /* 281 captain */ [[254,0,4,4],[254,0,4,4]],
    /* 282 watchman */ [[254,0,1,8]],
    /* 283 watch captain */ [[254,0,3,4],[254,0,3,4]],
    /* 284 Medusa */ [[254,0,2,4],[1,0,1,8],[15,18,0,0],[2,7,1,6]],
    /* 285 Wizard of Yendor */ [[1,252,2,12],[255,241,0,0]],
    /* 286 Croesus */ [[254,0,4,10]],
    /* 287 ghost */ [[5,0,1,1]],
    /* 288 shade */ [[5,14,2,6],[5,13,1,6]],
    /* 289 water demon */ [[254,0,1,3],[1,0,1,3],[2,0,1,3]],
    /* 290 incubus */ [[2,35,0,0],[1,0,1,3],[1,0,1,3]],
    /* 291 horned devil */ [[254,0,1,4],[1,0,1,4],[2,0,2,3],[6,0,1,3]],
    /* 292 erinys */ [[254,7,2,4]],
    /* 293 barbed devil */ [[1,0,2,4],[1,19,2,4],[6,0,3,4]],
    /* 294 marilith */ [[254,0,2,4],[254,0,2,4],[1,0,2,4],[1,0,2,4],[1,0,2,4],[1,0,2,4]],
    /* 295 vrock */ [[1,0,1,4],[1,0,1,4],[1,0,1,8],[1,0,1,8],[2,0,1,6]],
    /* 296 hezrou */ [[1,0,1,3],[1,0,1,3],[2,0,4,4]],
    /* 297 bone devil */ [[254,0,3,4],[6,7,2,4]],
    /* 298 ice devil */ [[1,0,1,4],[1,0,1,4],[2,0,2,4],[6,3,3,4],[5,13,1,1]],
    /* 299 nalfeshnee */ [[1,0,1,4],[1,0,1,4],[2,0,2,4],[255,241,0,0]],
    /* 300 pit fiend */ [[254,0,4,2],[254,0,4,2],[7,0,2,4]],
    /* 301 sandestin */ [[254,0,2,6],[254,0,2,6]],
    /* 302 balrog */ [[254,0,8,4],[254,0,4,6]],
    /* 303 Juiblex */ [[11,33,4,10],[10,8,3,6]],
    /* 304 Yeenoghu */ [[254,0,3,6],[254,25,2,8],[1,14,1,6],[255,1,2,6]],
    /* 305 Orcus */ [[254,0,3,6],[1,0,3,4],[1,0,3,4],[255,241,8,6],[6,7,2,4]],
    /* 306 Geryon */ [[1,0,3,6],[1,0,3,6],[6,7,2,4]],
    /* 307 Dispater */ [[254,0,4,6],[255,241,6,6]],
    /* 308 Baalzebub */ [[2,7,2,6],[15,12,2,6]],
    /* 309 Asmodeus */ [[1,0,4,4],[255,3,6,6]],
    /* 310 Demogorgon */ [[255,241,8,6],[6,15,1,4],[1,33,1,6],[1,33,1,6]],
    /* 311 Death */ [[5,37,8,8],[5,37,8,8]],
    /* 312 Pestilence */ [[5,38,8,8],[5,38,8,8]],
    /* 313 Famine */ [[5,39,8,8],[5,39,8,8]],
    /* 314 mail daemon */ [],
    /* 315 djinni */ [[254,0,2,8]],
    /* 316 jellyfish */ [[6,7,3,3]],
    /* 317 piranha */ [[2,0,2,6],[2,0,2,6]],
    /* 318 shark */ [[2,0,5,6]],
    /* 319 giant eel */ [[2,0,3,6],[5,28,0,0]],
    /* 320 electric eel */ [[2,6,4,6],[5,28,0,0]],
    /* 321 kraken */ [[1,0,2,4],[1,0,2,4],[7,28,2,6],[2,0,5,4]],
    /* 322 newt */ [[2,0,1,2]],
    /* 323 gecko */ [[2,0,1,3]],
    /* 324 iguana */ [[2,0,1,4]],
    /* 325 baby crocodile */ [[2,0,1,4]],
    /* 326 lizard */ [[2,0,1,6]],
    /* 327 chameleon */ [[2,0,4,2]],
    /* 328 crocodile */ [[2,0,4,2],[1,0,1,12]],
    /* 329 salamander */ [[254,0,2,8],[5,2,1,6],[7,0,2,6],[7,2,3,6]],
    /* 330 long worm tail */ [],
    /* 331 archeologist */ [[254,0,1,6],[254,0,1,6]],
    /* 332 barbarian */ [[254,0,1,6],[254,0,1,6]],
    /* 333 caveman */ [[254,0,2,4]],
    /* 334 healer */ [[254,0,1,6]],
    /* 335 knight */ [[254,0,1,6],[254,0,1,6]],
    /* 336 monk */ [[1,0,1,8],[3,0,1,8]],
    /* 337 priest */ [[254,0,1,6],[255,240,0,0]],
    /* 338 ranger */ [[254,0,1,4]],
    /* 339 rogue */ [[254,0,1,6],[254,0,1,6]],
    /* 340 samurai */ [[254,0,1,8],[254,0,1,8]],
    /* 341 tourist */ [[254,0,1,6],[254,0,1,6]],
    /* 342 valkyrie */ [[254,0,1,8],[254,0,1,8]],
    /* 343 wizard */ [[254,0,1,6],[255,241,0,0]],
    /* 344 Lord Carnarvon */ [[254,0,4,10],[255,241,4,8]],
    /* 345 Pelias */ [[254,0,4,10],[254,0,4,10]],
    /* 346 Shaman Karnov */ [[254,0,4,10],[255,240,2,8]],
    /* 347 Hippocrates */ [[254,0,1,6],[255,240,3,8],[255,240,3,8]],
    /* 348 King Arthur */ [[254,0,4,10],[254,0,4,10]],
    /* 349 Grand Master */ [[1,0,4,10],[3,0,2,8],[255,240,2,8],[255,240,2,8]],
    /* 350 Arch Priest */ [[254,0,4,10],[3,0,2,8],[255,240,2,8],[255,240,2,8]],
    /* 351 Orion */ [[254,0,4,10],[255,241,4,8]],
    /* 352 Master of Thieves */ [[254,0,4,10],[254,0,2,6],[1,252,2,4]],
    /* 353 Lord Sato */ [[254,0,4,10],[254,0,4,10]],
    /* 354 Twoflower */ [[254,0,4,10]],
    /* 355 Norn */ [[254,0,4,10],[254,0,4,10]],
    /* 356 Neferet the Green */ [[254,0,4,10],[255,241,2,8],[255,241,2,8]],
    /* 357 Minion of Huhetotl */ [[254,0,8,4],[254,0,4,6],[255,241,0,0],[1,252,2,6]],
    /* 358 Thoth Amon */ [[254,0,1,6],[255,241,0,0],[255,241,0,0],[1,252,1,4]],
    /* 359 Chromatic Dragon */ [[12,242,6,6],[255,241,0,0],[1,252,2,8],[2,0,4,8],[2,0,4,8],[6,0,1,6]],
    /* 360 Cyclops */ [[254,0,4,8],[254,0,4,8],[1,252,2,6]],
    /* 361 Ixoth */ [[12,2,8,6],[2,0,4,8],[255,241,0,0],[1,0,2,4],[1,252,2,4]],
    /* 362 Master Kaen */ [[1,0,16,2],[1,0,16,2],[255,240,0,0],[1,252,1,4]],
    /* 363 Nalzok */ [[254,0,8,4],[254,0,4,6],[255,241,0,0],[1,252,2,6]],
    /* 364 Scorpius */ [[1,0,2,6],[1,252,2,6],[6,33,1,4]],
    /* 365 Master Assassin */ [[254,7,2,6],[254,0,2,8],[1,252,2,6]],
    /* 366 Ashikaga Takauji */ [[254,0,2,6],[254,0,2,6],[1,252,2,6]],
    /* 367 Lord Surtur */ [[254,0,2,10],[254,0,2,10],[1,252,2,6]],
    /* 368 Dark One */ [[254,0,1,6],[254,0,1,6],[1,252,1,4],[255,241,0,0]],
    /* 369 student */ [[254,0,1,6]],
    /* 370 chieftain */ [[254,0,1,6]],
    /* 371 neanderthal */ [[254,0,2,4]],
    /* 372 attendant */ [[254,0,1,6]],
    /* 373 page */ [[254,0,1,6],[254,0,1,6]],
    /* 374 abbot */ [[1,0,8,2],[3,12,3,2],[255,240,0,0]],
    /* 375 acolyte */ [[254,0,1,6],[255,240,0,0]],
    /* 376 hunter */ [[254,0,1,4]],
    /* 377 thug */ [[254,0,1,6],[254,0,1,6]],
    /* 378 ninja */ [[254,0,1,8],[254,0,1,8]],
    /* 379 roshi */ [[254,0,1,8],[254,0,1,8]],
    /* 380 guide */ [[254,0,1,6],[255,241,0,0]],
    /* 381 warrior */ [[254,0,1,8],[254,0,1,8]],
    /* 382 apprentice */ [[254,0,1,6],[255,241,0,0]],
];

/* C ref: mondata.c attacktype_fordmg(ptr, atyp, adtyp) — does 'ptr' have an
   attack of type atyp (AT_ANY = any) dealing adtyp (AD_ANY = any)? */
export function attacktype_fordmg(ptr, atyp, adtyp) {
    const tbl = ptr?.pmidx != null ? MATTK[ptr.pmidx] : null;
    if (!tbl) return false;
    for (const a of tbl)
        if ((atyp === AT_ANY || a[0] === atyp) && (adtyp === AD_ANY || a[1] === adtyp))
            return true;
    return false;
}

/* C ref: mondata.h attacktype(ptr, atyp) */
export function attacktype(ptr, atyp) {
    return attacktype_fordmg(ptr, atyp, AD_ANY);
}

/* C ref: mondata.h dmgtype(ptr, dtyp) */
export function dmgtype(ptr, dtyp) {
    return attacktype_fordmg(ptr, AT_ANY, dtyp);
}

/* C ref: mondata.c noattacks(ptr) — `for (i..NATTK) if (mattk[i].aatyp)
   return FALSE; return TRUE`.  NOT !attacktype(ptr, AT_ANY): C's
   attacktype_fordmg() matches AT_ANY/AD_ANY against mattk[0] unconditionally,
   so that spelling is always FALSE.  The difference is exactly the
   PASSIVE-only monsters (aatyp AT_NONE==0, e.g. yellow mold, blue jelly),
   which C treats as having no attacks: they must not make monster_nearby()
   block a #wait, and dochug() must not run mattacku() for them. */
export function noattacks(ptr) {
    for (const a of mattk_of(ptr)) if (a.aatyp) return false;
    return true;
}

/* C ref: mondata.h is_armed(ptr) — uses a weapon. */
export function is_armed(ptr) {
    return attacktype(ptr, AT_WEAP);
}

/* The mattk[] slots of 'ptr' as {aatyp, adtyp, damn, damd} records, in C order. */
export function mattk_of(ptr) {
    const tbl = ptr?.pmidx != null ? MATTK[ptr.pmidx] : null;
    if (!tbl) return [];
    return tbl.map(a => ({ aatyp: a[0], adtyp: a[1], damn: a[2], damd: a[3] }));
}
