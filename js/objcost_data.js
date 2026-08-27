// GENERATED — do not hand-edit; see the regeneration note below.
//
// C ref: objclass.h:95 `short oc_cost;  /* base cost in shops */`.
// The JS object table (OBJECT_DATA) omits the cost column entirely, so every
// shop price string was impossible: shk.c's "(for sale, N zorkmids)",
// "(unpaid, N zorkmids)", the #pay bill and pay_for_damage all read it.
// A wave-3 session (w3-human-knight-debug) matched 95% of C's RNG stream but
// only 30% of its screens, stalled from step 85 on exactly this.
//
// HOW THIS WAS GENERATED (safe to regenerate — no hand edits):
//   cc -g -I include -DNOTPARMDECL -DNO_TIMED_DELAY -o dumpcost dumpcost.c src/objects.o
// from nethack-c/recorder, where dumpcost.c calls objects_globals_init() and
// prints objects[i].oc_cost for i in 0..480.  Linking the recorder's own
// objects.o is exact by construction: the OBJECT() macro family puts the cost
// at a DIFFERENT argument position per class (FOOD has no cost argument at all;
// GEM/ROCK call it gval), so text-parsing objects.c misaligns silently.
// The recorder's exact CFLAGS matter — compiling without them changes the
// struct objclass layout and every field reads as garbage.
//
// VERIFIED index-aligned against js/mkobj.js objects[] (both 481 entries) and
// spot-checked against known C prices: long sword 15, dagger 4, elven dagger 4,
// crysknife 100, food ration 45, towel 50, luckstone 60 — 7/7 exact.
export const OBJ_COST = Object.freeze([
       0,  // 0 strange object
       0,  // 1 generic strange
       0,  // 2 generic weapon
       0,  // 3 generic armor
       0,  // 4 generic ring
       0,  // 5 generic amulet
       0,  // 6 generic tool
       0,  // 7 generic food
       0,  // 8 generic potion
       0,  // 9 generic scroll
       0,  // 10 generic spellbook
       0,  // 11 generic wand
       0,  // 12 generic coin
       0,  // 13 generic gem
       0,  // 14 generic large rock
       0,  // 15 generic iron ball
       0,  // 16 generic iron chain
       0,  // 17 generic venom
       2,  // 18 arrow
       2,  // 19 elven arrow
       2,  // 20 orcish arrow
       5,  // 21 silver arrow
       4,  // 22 ya
       2,  // 23 crossbow bolt
       2,  // 24 dart
       5,  // 25 shuriken
      20,  // 26 boomerang
       3,  // 27 spear
       3,  // 28 elven spear
       3,  // 29 orcish spear
       3,  // 30 dwarvish spear
      40,  // 31 silver spear
       3,  // 32 javelin
       5,  // 33 trident
       4,  // 34 dagger
       4,  // 35 elven dagger
       4,  // 36 orcish dagger
      40,  // 37 silver dagger
       4,  // 38 athame
       6,  // 39 scalpel
       4,  // 40 knife
       4,  // 41 stiletto
       2,  // 42 worm tooth
     100,  // 43 crysknife
       8,  // 44 axe
      40,  // 45 battle-axe
      10,  // 46 short sword
      10,  // 47 elven short sword
      10,  // 48 orcish short sword
      10,  // 49 dwarvish short sword
      15,  // 50 scimitar
      75,  // 51 silver saber
      10,  // 52 broadsword
      10,  // 53 elven broadsword
      15,  // 54 long sword
      50,  // 55 two-handed sword
      80,  // 56 katana
     500,  // 57 tsurugi
     300,  // 58 runesword
      10,  // 59 partisan
       6,  // 60 ranseur
       5,  // 61 spetum
       6,  // 62 glaive
      10,  // 63 halberd
       7,  // 64 bardiche
       5,  // 65 voulge
       5,  // 66 fauchard
       5,  // 67 guisarme
       7,  // 68 bill-guisarme
       7,  // 69 lucern hammer
       8,  // 70 bec de corbin
      50,  // 71 dwarvish mattock
      10,  // 72 lance
       5,  // 73 mace
      60,  // 74 silver mace
      10,  // 75 morning star
       5,  // 76 war hammer
       3,  // 77 club
       3,  // 78 rubber hose
       5,  // 79 quarterstaff
       4,  // 80 aklys
       4,  // 81 flail
       4,  // 82 bullwhip
      60,  // 83 bow
      60,  // 84 elven bow
      60,  // 85 orcish bow
      60,  // 86 yumi
      20,  // 87 sling
      40,  // 88 crossbow
       8,  // 89 elven leather helm
      10,  // 90 orcish helm
      20,  // 91 dwarvish iron helm
       1,  // 92 fedora
      80,  // 93 cornuthaum
       1,  // 94 dunce cap
       8,  // 95 dented pot
      50,  // 96 helm of brilliance
      10,  // 97 helmet
      50,  // 98 helm of caution
      50,  // 99 helm of opposite alignment
      50,  // 100 helm of telepathy
    1200,  // 101 gray dragon scale mail
     900,  // 102 gold dragon scale mail
    1200,  // 103 silver dragon scale mail
     900,  // 104 red dragon scale mail
     900,  // 105 white dragon scale mail
     900,  // 106 orange dragon scale mail
    1200,  // 107 black dragon scale mail
     900,  // 108 blue dragon scale mail
     900,  // 109 green dragon scale mail
     900,  // 110 yellow dragon scale mail
     700,  // 111 gray dragon scales
     500,  // 112 gold dragon scales
     700,  // 113 silver dragon scales
     500,  // 114 red dragon scales
     500,  // 115 white dragon scales
     500,  // 116 orange dragon scales
     700,  // 117 black dragon scales
     500,  // 118 blue dragon scales
     500,  // 119 green dragon scales
     500,  // 120 yellow dragon scales
     600,  // 121 plate mail
     820,  // 122 crystal plate mail
     400,  // 123 bronze plate mail
      80,  // 124 splint mail
      90,  // 125 banded mail
     240,  // 126 dwarvish mithril-coat
     240,  // 127 elven mithril-coat
      75,  // 128 chain mail
      75,  // 129 orcish chain mail
      45,  // 130 scale mail
      15,  // 131 studded leather armor
     100,  // 132 ring mail
      80,  // 133 orcish ring mail
       5,  // 134 leather armor
      10,  // 135 leather jacket
       3,  // 136 Hawaiian shirt
       2,  // 137 T-shirt
       2,  // 138 mummy wrapping
      60,  // 139 elven cloak
      40,  // 140 orcish cloak
      50,  // 141 dwarvish cloak
      50,  // 142 oilskin cloak
      50,  // 143 robe
      50,  // 144 alchemy smock
      40,  // 145 leather cloak
      50,  // 146 cloak of protection
      60,  // 147 cloak of invisibility
      60,  // 148 cloak of magic resistance
      50,  // 149 cloak of displacement
       3,  // 150 small shield
      50,  // 151 shield of drain resistance
      50,  // 152 shield of shock resistance
       7,  // 153 elven shield
       7,  // 154 Uruk-hai shield
       7,  // 155 orcish shield
      10,  // 156 large shield
      10,  // 157 dwarvish roundshield
      50,  // 158 shield of reflection
       8,  // 159 leather gloves
      50,  // 160 gauntlets of fumbling
      50,  // 161 gauntlets of power
      50,  // 162 gauntlets of dexterity
       8,  // 163 low boots
      16,  // 164 iron shoes
      12,  // 165 high boots
      50,  // 166 speed boots
      50,  // 167 water walking boots
      50,  // 168 jumping boots
       8,  // 169 elven boots
       8,  // 170 kicking boots
      30,  // 171 fumble boots
      30,  // 172 levitation boots
     100,  // 173 adornment
     150,  // 174 gain strength
     150,  // 175 gain constitution
     150,  // 176 increase accuracy
     150,  // 177 increase damage
     100,  // 178 protection
     200,  // 179 regeneration
     200,  // 180 searching
     100,  // 181 stealth
     100,  // 182 sustain ability
     200,  // 183 levitation
     100,  // 184 hunger
     150,  // 185 aggravate monster
     300,  // 186 conflict
     100,  // 187 warning
     150,  // 188 poison resistance
     200,  // 189 fire resistance
     150,  // 190 cold resistance
     150,  // 191 shock resistance
     200,  // 192 free action
     200,  // 193 slow digestion
     200,  // 194 teleportation
     300,  // 195 teleport control
     300,  // 196 polymorph
     300,  // 197 polymorph control
     150,  // 198 invisibility
     150,  // 199 see invisible
     100,  // 200 protection from shape changers
     150,  // 201 amulet of ESP
     150,  // 202 amulet of life saving
     150,  // 203 amulet of strangulation
     150,  // 204 amulet of restful sleep
     150,  // 205 amulet versus poison
     150,  // 206 amulet of change
     150,  // 207 amulet of unchanging
     150,  // 208 amulet of reflection
     150,  // 209 amulet of magical breathing
     150,  // 210 amulet of guarding
     150,  // 211 amulet of flying
       0,  // 212 cheap plastic imitation of the Amulet of Yendor
    30000,  // 213 Amulet of Yendor
       8,  // 214 large box
      16,  // 215 chest
      42,  // 216 ice box
       2,  // 217 sack
     100,  // 218 oilskin sack
     100,  // 219 bag of holding
     100,  // 220 bag of tricks
      10,  // 221 skeleton key
      20,  // 222 lock pick
      10,  // 223 credit card
      10,  // 224 tallow candle
      20,  // 225 wax candle
      12,  // 226 brass lantern
      10,  // 227 oil lamp
      50,  // 228 magic lamp
     200,  // 229 expensive camera
      10,  // 230 mirror
      60,  // 231 crystal ball
      80,  // 232 lenses
      20,  // 233 blindfold
      50,  // 234 towel
     150,  // 235 saddle
      20,  // 236 leash
      75,  // 237 stethoscope
      30,  // 238 tinning kit
      30,  // 239 tin opener
      20,  // 240 can of grease
      80,  // 241 figurine
      50,  // 242 magic marker
     180,  // 243 land mine
      60,  // 244 beartrap
      10,  // 245 tin whistle
      10,  // 246 magic whistle
      12,  // 247 wooden flute
      36,  // 248 magic flute
      15,  // 249 tooled horn
      50,  // 250 frost horn
      50,  // 251 fire horn
      50,  // 252 horn of plenty
      50,  // 253 wooden harp
      50,  // 254 magic harp
      50,  // 255 bell
      15,  // 256 bugle
      25,  // 257 leather drum
      25,  // 258 drum of earthquake
      50,  // 259 pick-axe
      50,  // 260 grappling hook
     100,  // 261 unicorn horn
    5000,  // 262 Candelabrum of Invocation
    5000,  // 263 Bell of Opening
      15,  // 264 tripe ration
       5,  // 265 corpse
       9,  // 266 egg
       5,  // 267 meatball
       5,  // 268 meat stick
     105,  // 269 enormous meatball
       1,  // 270 meat ring
       6,  // 271 glob of gray ooze
       6,  // 272 glob of brown pudding
       6,  // 273 glob of green slime
       6,  // 274 glob of black pudding
       6,  // 275 kelp frond
       5,  // 276 eucalyptus leaf
       7,  // 277 apple
       9,  // 278 orange
       7,  // 279 pear
      10,  // 280 melon
       9,  // 281 banana
       7,  // 282 carrot
       7,  // 283 sprig of wolfsbane
       7,  // 284 clove of garlic
      17,  // 285 slime mold
      15,  // 286 lump of royal jelly
      10,  // 287 cream pie
      10,  // 288 candy bar
       7,  // 289 fortune cookie
      15,  // 290 pancake
      45,  // 291 lembas wafer
      35,  // 292 cram ration
      45,  // 293 food ration
      25,  // 294 K-ration
      20,  // 295 C-ration
       5,  // 296 tin
     300,  // 297 gain ability
     100,  // 298 restore ability
     100,  // 299 confusion
     150,  // 300 blindness
     300,  // 301 paralysis
     200,  // 302 speed
     200,  // 303 levitation
     100,  // 304 hallucination
     150,  // 305 invisibility
      50,  // 306 see invisible
      20,  // 307 healing
     100,  // 308 extra healing
     300,  // 309 gain level
     200,  // 310 enlightenment
     150,  // 311 monster detection
     150,  // 312 object detection
     150,  // 313 gain energy
     100,  // 314 sleeping
     200,  // 315 full healing
     200,  // 316 polymorph
      50,  // 317 booze
      50,  // 318 sickness
      50,  // 319 fruit juice
     250,  // 320 acid
     250,  // 321 oil
     100,  // 322 water
      80,  // 323 enchant armor
     100,  // 324 destroy armor
     100,  // 325 confuse monster
     100,  // 326 scare monster
      80,  // 327 remove curse
      60,  // 328 enchant weapon
     200,  // 329 create monster
     200,  // 330 taming
     300,  // 331 genocide
      50,  // 332 light
     100,  // 333 teleportation
     100,  // 334 gold detection
     100,  // 335 food detection
      20,  // 336 identify
     100,  // 337 magic mapping
     200,  // 338 amnesia
     100,  // 339 fire
     200,  // 340 earth
     300,  // 341 punishment
     300,  // 342 charging
     300,  // 343 stinking cloud
     100,  // 344 
     100,  // 345 
     100,  // 346 
     100,  // 347 
     100,  // 348 
     100,  // 349 
     100,  // 350 
     100,  // 351 
     100,  // 352 
     100,  // 353 
     100,  // 354 
     100,  // 355 
     100,  // 356 
     100,  // 357 
     100,  // 358 
     100,  // 359 
     100,  // 360 
     100,  // 361 
     100,  // 362 
     100,  // 363 
       0,  // 364 mail
      60,  // 365 blank paper
     500,  // 366 dig
     200,  // 367 magic missile
     400,  // 368 fireball
     400,  // 369 cone of cold
     300,  // 370 sleep
     700,  // 371 finger of death
     100,  // 372 light
     100,  // 373 detect monsters
     100,  // 374 healing
     100,  // 375 knock
     100,  // 376 force bolt
     100,  // 377 confuse monster
     200,  // 378 cure blindness
     200,  // 379 drain life
     200,  // 380 slow monster
     200,  // 381 wizard lock
     200,  // 382 create monster
     200,  // 383 detect food
     300,  // 384 cause fear
     300,  // 385 clairvoyance
     300,  // 386 cure sickness
     500,  // 387 charm monster
     300,  // 388 haste self
     300,  // 389 detect unseen
     400,  // 390 levitation
     300,  // 391 extra healing
     400,  // 392 restore ability
     400,  // 393 invisibility
     400,  // 394 detect treasure
     300,  // 395 remove curse
     500,  // 396 magic mapping
     300,  // 397 identify
     600,  // 398 turn undead
     600,  // 399 polymorph
     600,  // 400 teleport away
     600,  // 401 create familiar
     700,  // 402 cancellation
     100,  // 403 protection
     100,  // 404 jumping
     300,  // 405 stone to flesh
     200,  // 406 chain lightning
       0,  // 407 blank paper
      20,  // 408 novel
    10000,  // 409 Book of the Dead
     100,  // 410 light
     150,  // 411 secret door detection
     150,  // 412 enlightenment
     200,  // 413 create monster
     500,  // 414 wishing
     150,  // 415 stasis
     100,  // 416 nothing
     150,  // 417 striking
     150,  // 418 make invisible
     150,  // 419 slow monster
     150,  // 420 speed monster
     150,  // 421 undead turning
     200,  // 422 polymorph
     200,  // 423 cancellation
     200,  // 424 teleportation
     150,  // 425 opening
     150,  // 426 locking
     150,  // 427 probing
     150,  // 428 digging
     150,  // 429 magic missile
     175,  // 430 fire
     175,  // 431 cold
     175,  // 432 sleep
     500,  // 433 death
     175,  // 434 lightning
     150,  // 435 
     150,  // 436 
     150,  // 437 
       1,  // 438 gold piece
    4500,  // 439 dilithium crystal
    4000,  // 440 diamond
    3500,  // 441 ruby
    3250,  // 442 jacinth
    3000,  // 443 sapphire
    2500,  // 444 black opal
    2500,  // 445 emerald
    2000,  // 446 turquoise
    1500,  // 447 citrine
    1500,  // 448 aquamarine
    1000,  // 449 amber
     900,  // 450 topaz
     850,  // 451 jet
     800,  // 452 opal
     700,  // 453 chrysoberyl
     700,  // 454 garnet
     600,  // 455 amethyst
     500,  // 456 jasper
     400,  // 457 fluorite
     200,  // 458 obsidian
     200,  // 459 agate
     300,  // 460 jade
       0,  // 461 worthless piece of white glass
       0,  // 462 worthless piece of blue glass
       0,  // 463 worthless piece of red glass
       0,  // 464 worthless piece of yellowish brown glass
       0,  // 465 worthless piece of orange glass
       0,  // 466 worthless piece of yellow glass
       0,  // 467 worthless piece of black glass
       0,  // 468 worthless piece of green glass
       0,  // 469 worthless piece of violet glass
      60,  // 470 luckstone
       1,  // 471 loadstone
      45,  // 472 touchstone
       1,  // 473 flint
       0,  // 474 rock
       0,  // 475 boulder
       0,  // 476 statue
      10,  // 477 heavy iron ball
       0,  // 478 iron chain
       0,  // 479 splash of blinding venom
       0,  // 480 splash of acid venom
]);

// C ref: objects[otyp].oc_cost.  Unknown/out-of-range otyp costs nothing rather
// than throwing — C indexes the array directly and every caller guards otyp.
export function base_oc_cost(otyp) {
    return (otyp >= 0 && otyp < OBJ_COST.length) ? OBJ_COST[otyp] : 0;
}
