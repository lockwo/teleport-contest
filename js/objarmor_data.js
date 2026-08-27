// GENERATED — safe to regenerate; see the note below.
//
// C ref: objclass.h:102 `#define a_ac oc_oc1  /* armor class, used in ARM_BONUS */`
// and objclass.h:86 `#define oc_armcat oc_subtyp  /* enum obj_armor_types */`.
//
// OBJECT_DATA carries NEITHER for armour: all 85 armour otyps have oc_subtyp 0
// where C has a non-zero oc_armcat for 49 of them, and there is no a_ac column
// at all (C has a non-zero a_ac for 76). The consequence is that every one of
// the five find_mac() copies in js/ degenerates to `return mons[].ac` — an
// elf-lord wearing elven mithril-coat + cloak + helm + shield + boots reads as
// its species base 10 where C computes 0. That silently changes to-hit outcomes
// for every armoured monster in the game.
//
// HOW GENERATED (same recipe as js/objcost_data.js):
//   cc -g -I include -DNOTPARMDECL -DNO_TIMED_DELAY -o dumpac dumpac.c src/objects.o
// from nethack-c/recorder, calling objects_globals_init() and printing
// objects[i].a_ac and objects[i].oc_armcat. Linking the recorder's own objects.o
// is exact by construction; the recorder's CFLAGS are REQUIRED or struct
// objclass has a different layout and every field reads as garbage.
//
// Verified index-aligned against js/mkobj.js objects[] (both 481 entries).
// a_ac is only meaningful for ARMOR_CLASS — it aliases oc_oc1, which holds
// something else for weapons, so callers must gate on oclass exactly as C does.
export const OBJ_A_AC = Object.freeze([
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
      0,  // 18 arrow
      0,  // 19 elven arrow
      0,  // 20 orcish arrow
      0,  // 21 silver arrow
      1,  // 22 ya
      0,  // 23 crossbow bolt
      0,  // 24 dart
      2,  // 25 shuriken
      0,  // 26 boomerang
      0,  // 27 spear
      0,  // 28 elven spear
      0,  // 29 orcish spear
      0,  // 30 dwarvish spear
      0,  // 31 silver spear
      0,  // 32 javelin
      0,  // 33 trident
      2,  // 34 dagger
      2,  // 35 elven dagger
      2,  // 36 orcish dagger
      2,  // 37 silver dagger
      2,  // 38 athame
      2,  // 39 scalpel
      0,  // 40 knife
      0,  // 41 stiletto
      0,  // 42 worm tooth
      3,  // 43 crysknife
      0,  // 44 axe
      0,  // 45 battle-axe
      0,  // 46 short sword
      0,  // 47 elven short sword
      0,  // 48 orcish short sword
      0,  // 49 dwarvish short sword
      0,  // 50 scimitar
      0,  // 51 silver saber
      0,  // 52 broadsword
      0,  // 53 elven broadsword
      0,  // 54 long sword
      0,  // 55 two-handed sword
      1,  // 56 katana
      2,  // 57 tsurugi
      0,  // 58 runesword
      0,  // 59 partisan
      0,  // 60 ranseur
      0,  // 61 spetum
      0,  // 62 glaive
      0,  // 63 halberd
      0,  // 64 bardiche
      0,  // 65 voulge
      0,  // 66 fauchard
      0,  // 67 guisarme
      0,  // 68 bill-guisarme
      0,  // 69 lucern hammer
      0,  // 70 bec de corbin
     -1,  // 71 dwarvish mattock
      0,  // 72 lance
      0,  // 73 mace
      0,  // 74 silver mace
      0,  // 75 morning star
      0,  // 76 war hammer
      0,  // 77 club
      0,  // 78 rubber hose
      0,  // 79 quarterstaff
      0,  // 80 aklys
      0,  // 81 flail
      0,  // 82 bullwhip
      0,  // 83 bow
      0,  // 84 elven bow
      0,  // 85 orcish bow
      0,  // 86 yumi
      0,  // 87 sling
      0,  // 88 crossbow
      1,  // 89 elven leather helm
      1,  // 90 orcish helm
      2,  // 91 dwarvish iron helm
      0,  // 92 fedora
      0,  // 93 cornuthaum
      0,  // 94 dunce cap
      1,  // 95 dented pot
      1,  // 96 helm of brilliance
      1,  // 97 helmet
      1,  // 98 helm of caution
      1,  // 99 helm of opposite alignment
      1,  // 100 helm of telepathy
      9,  // 101 gray dragon scale mail
      9,  // 102 gold dragon scale mail
      9,  // 103 silver dragon scale mail
      9,  // 104 red dragon scale mail
      9,  // 105 white dragon scale mail
      9,  // 106 orange dragon scale mail
      9,  // 107 black dragon scale mail
      9,  // 108 blue dragon scale mail
      9,  // 109 green dragon scale mail
      9,  // 110 yellow dragon scale mail
      3,  // 111 gray dragon scales
      3,  // 112 gold dragon scales
      3,  // 113 silver dragon scales
      3,  // 114 red dragon scales
      3,  // 115 white dragon scales
      3,  // 116 orange dragon scales
      3,  // 117 black dragon scales
      3,  // 118 blue dragon scales
      3,  // 119 green dragon scales
      3,  // 120 yellow dragon scales
      7,  // 121 plate mail
      7,  // 122 crystal plate mail
      6,  // 123 bronze plate mail
      6,  // 124 splint mail
      6,  // 125 banded mail
      6,  // 126 dwarvish mithril-coat
      5,  // 127 elven mithril-coat
      5,  // 128 chain mail
      4,  // 129 orcish chain mail
      4,  // 130 scale mail
      3,  // 131 studded leather armor
      3,  // 132 ring mail
      2,  // 133 orcish ring mail
      2,  // 134 leather armor
      1,  // 135 leather jacket
      0,  // 136 Hawaiian shirt
      0,  // 137 T-shirt
      0,  // 138 mummy wrapping
      1,  // 139 elven cloak
      0,  // 140 orcish cloak
      0,  // 141 dwarvish cloak
      1,  // 142 oilskin cloak
      2,  // 143 robe
      1,  // 144 alchemy smock
      1,  // 145 leather cloak
      3,  // 146 cloak of protection
      1,  // 147 cloak of invisibility
      1,  // 148 cloak of magic resistance
      1,  // 149 cloak of displacement
      1,  // 150 small shield
      1,  // 151 shield of drain resistance
      1,  // 152 shield of shock resistance
      2,  // 153 elven shield
      1,  // 154 Uruk-hai shield
      1,  // 155 orcish shield
      2,  // 156 large shield
      2,  // 157 dwarvish roundshield
      2,  // 158 shield of reflection
      1,  // 159 leather gloves
      1,  // 160 gauntlets of fumbling
      1,  // 161 gauntlets of power
      1,  // 162 gauntlets of dexterity
      1,  // 163 low boots
      2,  // 164 iron shoes
      2,  // 165 high boots
      1,  // 166 speed boots
      1,  // 167 water walking boots
      1,  // 168 jumping boots
      1,  // 169 elven boots
      1,  // 170 kicking boots
      1,  // 171 fumble boots
      1,  // 172 levitation boots
      0,  // 173 adornment
      0,  // 174 gain strength
      0,  // 175 gain constitution
      0,  // 176 increase accuracy
      0,  // 177 increase damage
      0,  // 178 protection
      0,  // 179 regeneration
      0,  // 180 searching
      0,  // 181 stealth
      0,  // 182 sustain ability
      0,  // 183 levitation
      0,  // 184 hunger
      0,  // 185 aggravate monster
      0,  // 186 conflict
      0,  // 187 warning
      0,  // 188 poison resistance
      0,  // 189 fire resistance
      0,  // 190 cold resistance
      0,  // 191 shock resistance
      0,  // 192 free action
      0,  // 193 slow digestion
      0,  // 194 teleportation
      0,  // 195 teleport control
      0,  // 196 polymorph
      0,  // 197 polymorph control
      0,  // 198 invisibility
      0,  // 199 see invisible
      0,  // 200 protection from shape changers
      0,  // 201 amulet of ESP
      0,  // 202 amulet of life saving
      0,  // 203 amulet of strangulation
      0,  // 204 amulet of restful sleep
      0,  // 205 amulet versus poison
      0,  // 206 amulet of change
      0,  // 207 amulet of unchanging
      0,  // 208 amulet of reflection
      0,  // 209 amulet of magical breathing
      0,  // 210 amulet of guarding
      0,  // 211 amulet of flying
      0,  // 212 cheap plastic imitation of the Amulet of Yendor
      0,  // 213 Amulet of Yendor
      0,  // 214 large box
      0,  // 215 chest
      0,  // 216 ice box
      0,  // 217 sack
      0,  // 218 oilskin sack
      0,  // 219 bag of holding
      0,  // 220 bag of tricks
      0,  // 221 skeleton key
      0,  // 222 lock pick
      0,  // 223 credit card
      0,  // 224 tallow candle
      0,  // 225 wax candle
      0,  // 226 brass lantern
      0,  // 227 oil lamp
      0,  // 228 magic lamp
      0,  // 229 expensive camera
      0,  // 230 mirror
      0,  // 231 crystal ball
      0,  // 232 lenses
      0,  // 233 blindfold
      0,  // 234 towel
      0,  // 235 saddle
      0,  // 236 leash
      0,  // 237 stethoscope
      0,  // 238 tinning kit
      0,  // 239 tin opener
      0,  // 240 can of grease
      0,  // 241 figurine
      0,  // 242 magic marker
      0,  // 243 land mine
      0,  // 244 beartrap
      0,  // 245 tin whistle
      0,  // 246 magic whistle
      0,  // 247 wooden flute
      0,  // 248 magic flute
      0,  // 249 tooled horn
      0,  // 250 frost horn
      0,  // 251 fire horn
      0,  // 252 horn of plenty
      0,  // 253 wooden harp
      0,  // 254 magic harp
      0,  // 255 bell
      0,  // 256 bugle
      0,  // 257 leather drum
      0,  // 258 drum of earthquake
      4,  // 259 pick-axe
      4,  // 260 grappling hook
      1,  // 261 unicorn horn
      0,  // 262 Candelabrum of Invocation
      0,  // 263 Bell of Opening
      0,  // 264 tripe ration
      0,  // 265 corpse
      0,  // 266 egg
      0,  // 267 meatball
      0,  // 268 meat stick
      0,  // 269 enormous meatball
      0,  // 270 meat ring
      0,  // 271 glob of gray ooze
      0,  // 272 glob of brown pudding
      0,  // 273 glob of green slime
      0,  // 274 glob of black pudding
      0,  // 275 kelp frond
      0,  // 276 eucalyptus leaf
      0,  // 277 apple
      0,  // 278 orange
      0,  // 279 pear
      0,  // 280 melon
      0,  // 281 banana
      0,  // 282 carrot
      0,  // 283 sprig of wolfsbane
      0,  // 284 clove of garlic
      0,  // 285 slime mold
      0,  // 286 lump of royal jelly
      0,  // 287 cream pie
      0,  // 288 candy bar
      0,  // 289 fortune cookie
      0,  // 290 pancake
      0,  // 291 lembas wafer
      0,  // 292 cram ration
      0,  // 293 food ration
      0,  // 294 K-ration
      0,  // 295 C-ration
      0,  // 296 tin
      0,  // 297 gain ability
      0,  // 298 restore ability
      0,  // 299 confusion
      0,  // 300 blindness
      0,  // 301 paralysis
      0,  // 302 speed
      0,  // 303 levitation
      0,  // 304 hallucination
      0,  // 305 invisibility
      0,  // 306 see invisible
      0,  // 307 healing
      0,  // 308 extra healing
      0,  // 309 gain level
      0,  // 310 enlightenment
      0,  // 311 monster detection
      0,  // 312 object detection
      0,  // 313 gain energy
      0,  // 314 sleeping
      0,  // 315 full healing
      0,  // 316 polymorph
      0,  // 317 booze
      0,  // 318 sickness
      0,  // 319 fruit juice
      0,  // 320 acid
      0,  // 321 oil
      0,  // 322 water
      0,  // 323 enchant armor
      0,  // 324 destroy armor
      0,  // 325 confuse monster
      0,  // 326 scare monster
      0,  // 327 remove curse
      0,  // 328 enchant weapon
      0,  // 329 create monster
      0,  // 330 taming
      0,  // 331 genocide
      0,  // 332 light
      0,  // 333 teleportation
      0,  // 334 gold detection
      0,  // 335 food detection
      0,  // 336 identify
      0,  // 337 magic mapping
      0,  // 338 amnesia
      0,  // 339 fire
      0,  // 340 earth
      0,  // 341 punishment
      0,  // 342 charging
      0,  // 343 stinking cloud
      0,  // 344 
      0,  // 345 
      0,  // 346 
      0,  // 347 
      0,  // 348 
      0,  // 349 
      0,  // 350 
      0,  // 351 
      0,  // 352 
      0,  // 353 
      0,  // 354 
      0,  // 355 
      0,  // 356 
      0,  // 357 
      0,  // 358 
      0,  // 359 
      0,  // 360 
      0,  // 361 
      0,  // 362 
      0,  // 363 
      0,  // 364 mail
      0,  // 365 blank paper
      0,  // 366 dig
      0,  // 367 magic missile
      0,  // 368 fireball
      0,  // 369 cone of cold
      0,  // 370 sleep
      0,  // 371 finger of death
      0,  // 372 light
      0,  // 373 detect monsters
      0,  // 374 healing
      0,  // 375 knock
      0,  // 376 force bolt
      0,  // 377 confuse monster
      0,  // 378 cure blindness
      0,  // 379 drain life
      0,  // 380 slow monster
      0,  // 381 wizard lock
      0,  // 382 create monster
      0,  // 383 detect food
      0,  // 384 cause fear
      0,  // 385 clairvoyance
      0,  // 386 cure sickness
      0,  // 387 charm monster
      0,  // 388 haste self
      0,  // 389 detect unseen
      0,  // 390 levitation
      0,  // 391 extra healing
      0,  // 392 restore ability
      0,  // 393 invisibility
      0,  // 394 detect treasure
      0,  // 395 remove curse
      0,  // 396 magic mapping
      0,  // 397 identify
      0,  // 398 turn undead
      0,  // 399 polymorph
      0,  // 400 teleport away
      0,  // 401 create familiar
      0,  // 402 cancellation
      0,  // 403 protection
      0,  // 404 jumping
      0,  // 405 stone to flesh
      0,  // 406 chain lightning
      0,  // 407 blank paper
      0,  // 408 novel
      0,  // 409 Book of the Dead
      0,  // 410 light
      0,  // 411 secret door detection
      0,  // 412 enlightenment
      0,  // 413 create monster
      0,  // 414 wishing
      0,  // 415 stasis
      0,  // 416 nothing
      0,  // 417 striking
      0,  // 418 make invisible
      0,  // 419 slow monster
      0,  // 420 speed monster
      0,  // 421 undead turning
      0,  // 422 polymorph
      0,  // 423 cancellation
      0,  // 424 teleportation
      0,  // 425 opening
      0,  // 426 locking
      0,  // 427 probing
      0,  // 428 digging
      0,  // 429 magic missile
      0,  // 430 fire
      0,  // 431 cold
      0,  // 432 sleep
      0,  // 433 death
      0,  // 434 lightning
      0,  // 435 
      0,  // 436 
      0,  // 437 
      0,  // 438 gold piece
      0,  // 439 dilithium crystal
      0,  // 440 diamond
      0,  // 441 ruby
      0,  // 442 jacinth
      0,  // 443 sapphire
      0,  // 444 black opal
      0,  // 445 emerald
      0,  // 446 turquoise
      0,  // 447 citrine
      0,  // 448 aquamarine
      0,  // 449 amber
      0,  // 450 topaz
      0,  // 451 jet
      0,  // 452 opal
      0,  // 453 chrysoberyl
      0,  // 454 garnet
      0,  // 455 amethyst
      0,  // 456 jasper
      0,  // 457 fluorite
      0,  // 458 obsidian
      0,  // 459 agate
      0,  // 460 jade
      0,  // 461 worthless piece of white glass
      0,  // 462 worthless piece of blue glass
      0,  // 463 worthless piece of red glass
      0,  // 464 worthless piece of yellowish brown glass
      0,  // 465 worthless piece of orange glass
      0,  // 466 worthless piece of yellow glass
      0,  // 467 worthless piece of black glass
      0,  // 468 worthless piece of green glass
      0,  // 469 worthless piece of violet glass
      0,  // 470 luckstone
      0,  // 471 loadstone
      0,  // 472 touchstone
      0,  // 473 flint
      0,  // 474 rock
      0,  // 475 boulder
      0,  // 476 statue
      0,  // 477 heavy iron ball
      0,  // 478 iron chain
      0,  // 479 splash of blinding venom
      0,  // 480 splash of acid venom
]);

export const OBJ_ARMCAT = Object.freeze([
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
    -20,  // 18 arrow
    -20,  // 19 elven arrow
    -20,  // 20 orcish arrow
    -20,  // 21 silver arrow
    -20,  // 22 ya
    -22,  // 23 crossbow bolt
    -23,  // 24 dart
    -24,  // 25 shuriken
    -25,  // 26 boomerang
     17,  // 27 spear
     17,  // 28 elven spear
     17,  // 29 orcish spear
     17,  // 30 dwarvish spear
     17,  // 31 silver spear
     17,  // 32 javelin
     18,  // 33 trident
      1,  // 34 dagger
      1,  // 35 elven dagger
      1,  // 36 orcish dagger
      1,  // 37 silver dagger
      1,  // 38 athame
      2,  // 39 scalpel
      2,  // 40 knife
      2,  // 41 stiletto
      2,  // 42 worm tooth
      2,  // 43 crysknife
      3,  // 44 axe
      3,  // 45 battle-axe
      5,  // 46 short sword
      5,  // 47 elven short sword
      5,  // 48 orcish short sword
      5,  // 49 dwarvish short sword
      9,  // 50 scimitar
      9,  // 51 silver saber
      6,  // 52 broadsword
      6,  // 53 elven broadsword
      7,  // 54 long sword
      8,  // 55 two-handed sword
      7,  // 56 katana
      8,  // 57 tsurugi
      6,  // 58 runesword
     16,  // 59 partisan
     16,  // 60 ranseur
     16,  // 61 spetum
     16,  // 62 glaive
     16,  // 63 halberd
     16,  // 64 bardiche
     16,  // 65 voulge
     16,  // 66 fauchard
     16,  // 67 guisarme
     16,  // 68 bill-guisarme
     16,  // 69 lucern hammer
     16,  // 70 bec de corbin
      4,  // 71 dwarvish mattock
     19,  // 72 lance
     11,  // 73 mace
     11,  // 74 silver mace
     12,  // 75 morning star
     14,  // 76 war hammer
     10,  // 77 club
     26,  // 78 rubber hose
     15,  // 79 quarterstaff
     10,  // 80 aklys
     13,  // 81 flail
     26,  // 82 bullwhip
     20,  // 83 bow
     20,  // 84 elven bow
     20,  // 85 orcish bow
     20,  // 86 yumi
     21,  // 87 sling
     22,  // 88 crossbow
      2,  // 89 elven leather helm
      2,  // 90 orcish helm
      2,  // 91 dwarvish iron helm
      2,  // 92 fedora
      2,  // 93 cornuthaum
      2,  // 94 dunce cap
      2,  // 95 dented pot
      2,  // 96 helm of brilliance
      2,  // 97 helmet
      2,  // 98 helm of caution
      2,  // 99 helm of opposite alignment
      2,  // 100 helm of telepathy
      0,  // 101 gray dragon scale mail
      0,  // 102 gold dragon scale mail
      0,  // 103 silver dragon scale mail
      0,  // 104 red dragon scale mail
      0,  // 105 white dragon scale mail
      0,  // 106 orange dragon scale mail
      0,  // 107 black dragon scale mail
      0,  // 108 blue dragon scale mail
      0,  // 109 green dragon scale mail
      0,  // 110 yellow dragon scale mail
      0,  // 111 gray dragon scales
      0,  // 112 gold dragon scales
      0,  // 113 silver dragon scales
      0,  // 114 red dragon scales
      0,  // 115 white dragon scales
      0,  // 116 orange dragon scales
      0,  // 117 black dragon scales
      0,  // 118 blue dragon scales
      0,  // 119 green dragon scales
      0,  // 120 yellow dragon scales
      0,  // 121 plate mail
      0,  // 122 crystal plate mail
      0,  // 123 bronze plate mail
      0,  // 124 splint mail
      0,  // 125 banded mail
      0,  // 126 dwarvish mithril-coat
      0,  // 127 elven mithril-coat
      0,  // 128 chain mail
      0,  // 129 orcish chain mail
      0,  // 130 scale mail
      0,  // 131 studded leather armor
      0,  // 132 ring mail
      0,  // 133 orcish ring mail
      0,  // 134 leather armor
      0,  // 135 leather jacket
      6,  // 136 Hawaiian shirt
      6,  // 137 T-shirt
      5,  // 138 mummy wrapping
      5,  // 139 elven cloak
      5,  // 140 orcish cloak
      5,  // 141 dwarvish cloak
      5,  // 142 oilskin cloak
      5,  // 143 robe
      5,  // 144 alchemy smock
      5,  // 145 leather cloak
      5,  // 146 cloak of protection
      5,  // 147 cloak of invisibility
      5,  // 148 cloak of magic resistance
      5,  // 149 cloak of displacement
      1,  // 150 small shield
      1,  // 151 shield of drain resistance
      1,  // 152 shield of shock resistance
      1,  // 153 elven shield
      1,  // 154 Uruk-hai shield
      1,  // 155 orcish shield
      1,  // 156 large shield
      1,  // 157 dwarvish roundshield
      1,  // 158 shield of reflection
      3,  // 159 leather gloves
      3,  // 160 gauntlets of fumbling
      3,  // 161 gauntlets of power
      3,  // 162 gauntlets of dexterity
      4,  // 163 low boots
      4,  // 164 iron shoes
      4,  // 165 high boots
      4,  // 166 speed boots
      4,  // 167 water walking boots
      4,  // 168 jumping boots
      4,  // 169 elven boots
      4,  // 170 kicking boots
      4,  // 171 fumble boots
      4,  // 172 levitation boots
      0,  // 173 adornment
      0,  // 174 gain strength
      0,  // 175 gain constitution
      0,  // 176 increase accuracy
      0,  // 177 increase damage
      0,  // 178 protection
      0,  // 179 regeneration
      0,  // 180 searching
      0,  // 181 stealth
      0,  // 182 sustain ability
      0,  // 183 levitation
      0,  // 184 hunger
      0,  // 185 aggravate monster
      0,  // 186 conflict
      0,  // 187 warning
      0,  // 188 poison resistance
      0,  // 189 fire resistance
      0,  // 190 cold resistance
      0,  // 191 shock resistance
      0,  // 192 free action
      0,  // 193 slow digestion
      0,  // 194 teleportation
      0,  // 195 teleport control
      0,  // 196 polymorph
      0,  // 197 polymorph control
      0,  // 198 invisibility
      0,  // 199 see invisible
      0,  // 200 protection from shape changers
      0,  // 201 amulet of ESP
      0,  // 202 amulet of life saving
      0,  // 203 amulet of strangulation
      0,  // 204 amulet of restful sleep
      0,  // 205 amulet versus poison
      0,  // 206 amulet of change
      0,  // 207 amulet of unchanging
      0,  // 208 amulet of reflection
      0,  // 209 amulet of magical breathing
      0,  // 210 amulet of guarding
      0,  // 211 amulet of flying
      0,  // 212 cheap plastic imitation of the Amulet of Yendor
      0,  // 213 Amulet of Yendor
      0,  // 214 large box
      0,  // 215 chest
      0,  // 216 ice box
      0,  // 217 sack
      0,  // 218 oilskin sack
      0,  // 219 bag of holding
      0,  // 220 bag of tricks
      0,  // 221 skeleton key
      0,  // 222 lock pick
      0,  // 223 credit card
      0,  // 224 tallow candle
      0,  // 225 wax candle
      0,  // 226 brass lantern
      0,  // 227 oil lamp
      0,  // 228 magic lamp
      0,  // 229 expensive camera
      0,  // 230 mirror
      0,  // 231 crystal ball
      0,  // 232 lenses
      0,  // 233 blindfold
      0,  // 234 towel
      0,  // 235 saddle
      0,  // 236 leash
      0,  // 237 stethoscope
      0,  // 238 tinning kit
      0,  // 239 tin opener
      0,  // 240 can of grease
      0,  // 241 figurine
      0,  // 242 magic marker
      0,  // 243 land mine
      0,  // 244 beartrap
      0,  // 245 tin whistle
      0,  // 246 magic whistle
      0,  // 247 wooden flute
      0,  // 248 magic flute
      0,  // 249 tooled horn
      0,  // 250 frost horn
      0,  // 251 fire horn
      0,  // 252 horn of plenty
      0,  // 253 wooden harp
      0,  // 254 magic harp
      0,  // 255 bell
      0,  // 256 bugle
      0,  // 257 leather drum
      0,  // 258 drum of earthquake
      4,  // 259 pick-axe
     13,  // 260 grappling hook
     27,  // 261 unicorn horn
      0,  // 262 Candelabrum of Invocation
      0,  // 263 Bell of Opening
      0,  // 264 tripe ration
      0,  // 265 corpse
      0,  // 266 egg
      0,  // 267 meatball
      0,  // 268 meat stick
      0,  // 269 enormous meatball
      0,  // 270 meat ring
      0,  // 271 glob of gray ooze
      0,  // 272 glob of brown pudding
      0,  // 273 glob of green slime
      0,  // 274 glob of black pudding
      0,  // 275 kelp frond
      0,  // 276 eucalyptus leaf
      0,  // 277 apple
      0,  // 278 orange
      0,  // 279 pear
      0,  // 280 melon
      0,  // 281 banana
      0,  // 282 carrot
      0,  // 283 sprig of wolfsbane
      0,  // 284 clove of garlic
      0,  // 285 slime mold
      0,  // 286 lump of royal jelly
      0,  // 287 cream pie
      0,  // 288 candy bar
      0,  // 289 fortune cookie
      0,  // 290 pancake
      0,  // 291 lembas wafer
      0,  // 292 cram ration
      0,  // 293 food ration
      0,  // 294 K-ration
      0,  // 295 C-ration
      0,  // 296 tin
      0,  // 297 gain ability
      0,  // 298 restore ability
      0,  // 299 confusion
      0,  // 300 blindness
      0,  // 301 paralysis
      0,  // 302 speed
      0,  // 303 levitation
      0,  // 304 hallucination
      0,  // 305 invisibility
      0,  // 306 see invisible
      0,  // 307 healing
      0,  // 308 extra healing
      0,  // 309 gain level
      0,  // 310 enlightenment
      0,  // 311 monster detection
      0,  // 312 object detection
      0,  // 313 gain energy
      0,  // 314 sleeping
      0,  // 315 full healing
      0,  // 316 polymorph
      0,  // 317 booze
      0,  // 318 sickness
      0,  // 319 fruit juice
      0,  // 320 acid
      0,  // 321 oil
      0,  // 322 water
      0,  // 323 enchant armor
      0,  // 324 destroy armor
      0,  // 325 confuse monster
      0,  // 326 scare monster
      0,  // 327 remove curse
      0,  // 328 enchant weapon
      0,  // 329 create monster
      0,  // 330 taming
      0,  // 331 genocide
      0,  // 332 light
      0,  // 333 teleportation
      0,  // 334 gold detection
      0,  // 335 food detection
      0,  // 336 identify
      0,  // 337 magic mapping
      0,  // 338 amnesia
      0,  // 339 fire
      0,  // 340 earth
      0,  // 341 punishment
      0,  // 342 charging
      0,  // 343 stinking cloud
      0,  // 344 
      0,  // 345 
      0,  // 346 
      0,  // 347 
      0,  // 348 
      0,  // 349 
      0,  // 350 
      0,  // 351 
      0,  // 352 
      0,  // 353 
      0,  // 354 
      0,  // 355 
      0,  // 356 
      0,  // 357 
      0,  // 358 
      0,  // 359 
      0,  // 360 
      0,  // 361 
      0,  // 362 
      0,  // 363 
      0,  // 364 mail
      0,  // 365 blank paper
     34,  // 366 dig
     28,  // 367 magic missile
     28,  // 368 fireball
     28,  // 369 cone of cold
     31,  // 370 sleep
     28,  // 371 finger of death
     30,  // 372 light
     30,  // 373 detect monsters
     29,  // 374 healing
     34,  // 375 knock
     28,  // 376 force bolt
     31,  // 377 confuse monster
     29,  // 378 cure blindness
     28,  // 379 drain life
     31,  // 380 slow monster
     34,  // 381 wizard lock
     32,  // 382 create monster
     30,  // 383 detect food
     31,  // 384 cause fear
     30,  // 385 clairvoyance
     29,  // 386 cure sickness
     31,  // 387 charm monster
     33,  // 388 haste self
     30,  // 389 detect unseen
     33,  // 390 levitation
     29,  // 391 extra healing
     29,  // 392 restore ability
     33,  // 393 invisibility
     30,  // 394 detect treasure
     32,  // 395 remove curse
     30,  // 396 magic mapping
     30,  // 397 identify
     32,  // 398 turn undead
     34,  // 399 polymorph
     33,  // 400 teleport away
     32,  // 401 create familiar
     34,  // 402 cancellation
     32,  // 403 protection
     33,  // 404 jumping
     29,  // 405 stone to flesh
     28,  // 406 chain lightning
      0,  // 407 blank paper
      0,  // 408 novel
      0,  // 409 Book of the Dead
      0,  // 410 light
      0,  // 411 secret door detection
      0,  // 412 enlightenment
      0,  // 413 create monster
      0,  // 414 wishing
      0,  // 415 stasis
      0,  // 416 nothing
      0,  // 417 striking
      0,  // 418 make invisible
      0,  // 419 slow monster
      0,  // 420 speed monster
      0,  // 421 undead turning
      0,  // 422 polymorph
      0,  // 423 cancellation
      0,  // 424 teleportation
      0,  // 425 opening
      0,  // 426 locking
      0,  // 427 probing
      0,  // 428 digging
      0,  // 429 magic missile
      0,  // 430 fire
      0,  // 431 cold
      0,  // 432 sleep
      0,  // 433 death
      0,  // 434 lightning
      0,  // 435 
      0,  // 436 
      0,  // 437 
      0,  // 438 gold piece
    -21,  // 439 dilithium crystal
    -21,  // 440 diamond
    -21,  // 441 ruby
    -21,  // 442 jacinth
    -21,  // 443 sapphire
    -21,  // 444 black opal
    -21,  // 445 emerald
    -21,  // 446 turquoise
    -21,  // 447 citrine
    -21,  // 448 aquamarine
    -21,  // 449 amber
    -21,  // 450 topaz
    -21,  // 451 jet
    -21,  // 452 opal
    -21,  // 453 chrysoberyl
    -21,  // 454 garnet
    -21,  // 455 amethyst
    -21,  // 456 jasper
    -21,  // 457 fluorite
    -21,  // 458 obsidian
    -21,  // 459 agate
    -21,  // 460 jade
    -21,  // 461 worthless piece of white glass
    -21,  // 462 worthless piece of blue glass
    -21,  // 463 worthless piece of red glass
    -21,  // 464 worthless piece of yellowish brown glass
    -21,  // 465 worthless piece of orange glass
    -21,  // 466 worthless piece of yellow glass
    -21,  // 467 worthless piece of black glass
    -21,  // 468 worthless piece of green glass
    -21,  // 469 worthless piece of violet glass
    -21,  // 470 luckstone
    -21,  // 471 loadstone
    -21,  // 472 touchstone
    -21,  // 473 flint
    -21,  // 474 rock
      0,  // 475 boulder
      0,  // 476 statue
      0,  // 477 heavy iron ball
      0,  // 478 iron chain
      0,  // 479 splash of blinding venom
      0,  // 480 splash of acid venom
]);

// C ref: ARM_BONUS(obj) — objects[otyp].a_ac. Gate on ARMOR_CLASS before use.
export function base_a_ac(otyp) { return (otyp >= 0 && otyp < OBJ_A_AC.length) ? OBJ_A_AC[otyp] : 0; }
// C ref: objects[otyp].oc_armcat — ARM_SUIT 0, ARM_SHIELD 1, ARM_HELM 2,
// ARM_GLOVES 3, ARM_BOOTS 4, ARM_CLOAK 5, ARM_SHIRT 6 (enum obj_armor_types).
export function base_armcat(otyp) { return (otyp >= 0 && otyp < OBJ_ARMCAT.length) ? OBJ_ARMCAT[otyp] : 0; }
