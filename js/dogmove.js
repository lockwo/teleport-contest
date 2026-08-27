// dogmove.js — Pet (tame monster) movement for the per-turn loop.
// C ref: dogmove.c — dog_move(), dog_goal(), dog_invent(); dog.c dogfood().
//
// GENERAL (data-driven) port of the common pet-follows-hero behaviour over the
// real monster/object records on game.level.  Faithful to the C control flow
// so the per-move RNG (obj_resists rn2(100), dog_goal rn2(8)/rn2(4),
// dog_move move-choice rn2(++chcnt)/rn2(3)/rn2(12), backtrack rn2(MTSZ*(k-j)))
// is emitted call-for-call.  Pet carrying/eating/attacking, hunger/starvation,
// leashed pets and ridden steeds are all ported now; what is STILL missing is
// listed here so the next pass does not have to re-derive it:
//   - Conflict (resist_conflict / lose_guardian_angel / DISMOUNT_THROWN and the
//     `&& !Conflict` clauses of the ALLOW_M balk test) is not modelled anywhere
//     in this port, so every Conflict-gated branch here is unreachable;
//   - an edog-less tame minion (guardian Angel: isminion + ispriest instead of
//     edog) returns MMOVE_NOTHING at the top of dog_move instead of running the
//     guardian variant of the candidate loop;
//   - pet_ranged_attk() does not call mattackm() (see the note there);
//   - the ALLOW_U (attack-the-hero) / m_in_out_region / m_digweapon_check arms
//     of newdogpos, none of which a pet can currently reach.

import { game } from './gstate.js';
import { rn2, rnd } from './rng.js';
import { MTSZ, COLNO, ROWNO, IS_ROOM, MAGIC_PORTAL, isok,
    IS_OBSTRUCTED, IS_DOOR, D_CLOSED, D_LOCKED,
    POOL, MOAT, WATER, LAVAPOOL, LAVAWALL } from './const.js';
import { obj_resists } from './zap.js';
import { newsym, vobj_at, object_glyph, see_with_infrared } from './display.js';
import { couldsee as visCouldsee, clear_path, cansee, view_from } from './vision.js';
import { Monnam, x_monnam, canspotmon } from './uhitm.js';
import { floor_object_name, doname_invent, sobj_at, stackobj } from './invent.js';
import { dist2, mfndpos, mon_mintrap, Trap_Killed_Mon, m_avoid_kicked_loc,
    mon_allowflags, set_apparxy, onscary, mon_wield_item,
    Conflict, resist_conflict, mattacku } from './monmove.js';
import { goodpos } from './teleport.js';
import { ALLOW_TRAPS as ALLOW_TRAPS_F, ALLOW_U, I_SPECIAL } from './const.js';
import { t_at } from './trap.js';
import { mattackm } from './mhitm.js';
import { M_ATTK_HIT, M_ATTK_DEF_DIED, M_ATTK_AGR_DIED, M_ATTK_MISS } from './const.js';
import {
    FOOD_CLASS, BALL_CLASS, CHAIN_CLASS, ROCK_CLASS, CORPSE, TIN, next_ident,
    GOLD_PIECE, COIN_CLASS, BOULDER, objects as OBJECTS, is_rider_pm, weight,
    place_object,
} from './mkobj.js';
import { may_dig } from './dig.js';
import { mflags1_of, msound_of, perceives_flag, M1_NOEYES,
    M1_ACID, M1_POIS, M1_CARNIVORE, M1_HERBIVORE, M1_METALLIVORE,
    humanoid, is_human_flag, is_elf_flag, is_dwarf_flag, is_gnome_flag,
    is_orc_flag, is_giant_flag, is_undead_flag,
    is_animal, mindless, nohands, M1_TUNNEL, M1_NEEDPICK,
    passes_walls_flag, throws_rocks_flag, is_swimmer_flag,
    regenerates_flag as regenerates, is_flyer_flag } from './monflags_data.js';
import { healmon, mon_hates_silver } from './mon.js';
import { max_passive_dmg } from './mondata.js';
import { attacktype, dmgtype, AT_NONE, AT_ANY, AT_ENGL, AT_WEAP, AD_POLY } from './monattk_data.js';
import { gettrack } from './track.js';
import { monster_by_pmidx, mon_msize, mon_cwt, mon_cnutrit, pm_to_cham } from './makemon.js';

// dogfood quality enum (mextra.h): lower == more desirable.
const DOGFOOD = 0, CADAVER = 1, ACCFOOD = 2, MANFOOD = 3,
      APPORT = 4, POISON = 5, UNDEF = 6, TABU = 7;

const MMOVE_NOTHING = 0, MMOVE_MOVED = 2, MMOVE_DIED = 3, MMOVE_DONE = 5;

// C ref: dogmove.c:10-12 — the pet hunger thresholds (moves past hungrytime).
// DOG_HUNGRY used to be spelled 500 here with a comment naming DOG_HUNGRY; 500
// is DOG_WEAK.  The value gates pet_ranged_attk's rn2(5).
const DOG_HUNGRY = 300, DOG_WEAK = 500, DOG_STARVE = 750;

const PM_LITTLE_DOG = 16, PM_KITTEN = 32, PM_PONY = 100;

// Food object types referenced by dogfood() (mkobj.js OBJECT_DATA otyp order).
const TRIPE_RATION = 264, EGG = 266, MEATBALL = 267, MEAT_STICK = 268,
      ENORMOUS_MEATBALL = 269, MEAT_RING = 270, GLOB_OF_GREEN_SLIME = 273,
      APPLE = 277, BANANA = 281,
      CARROT = 282, CLOVE_OF_GARLIC = 284, SLIME_MOLD = 285,
      LUMP_OF_ROYAL_JELLY = 286;
// C ref: objects.h — the two non-food otyps dogfood() rates TABU outright.
const RIN_SLOW_DIGESTION = 193, AMULET_OF_STRANGULATION = 203;

// C ref: include/objects.h FOOD() `delay` field — objects[otyp].oc_delay, the
// number of turns a creature spends digesting each non-corpse comestible.
// dog_nutrition() copies this into mtmp->meating; m_move() (monmove.c:1745)
// then returns MMOVE_DONE without moving while meating>0, so the value decides
// how many turns the pet stays put after eating.  Ported verbatim from the
// FOOD block (tripe ration is otyp 264, in the same order as mkobj.js
// OBJECT_DATA).  Foods with delay 1 are the default and omitted.
const FOOD_OC_DELAY = {
    264: 2,   // tripe ration
    269: 20,  // enormous meatball
    271: 2,   // glob of gray ooze
    272: 2,   // glob of brown pudding
    273: 2,   // glob of green slime
    274: 2,   // glob of black pudding
    290: 2,   // pancake
    291: 2,   // lembas wafer
    292: 3,   // cram ration
    293: 5,   // food ration
    296: 0,   // tin
};

// C ref: include/objects.h FOOD() `nutrition` field — objects[otyp].oc_nutrition,
// used by dog_nutrition() as the base hungrytime bump for a non-corpse food.
// The whole FOOD block (otyp 264..296) verbatim, not a subset: the old code used
// a flat 50 for everything, so a pet that ate a food ration (800 * msize
// multiplier) was recorded as ~16x less fed than C and fell back into the
// "hungry" ACCFOOD gate (`edog->hungrytime <= svm.moves`) hundreds of turns early.
const FOOD_OC_NUTRITION = {
    264: 200,  // tripe ration
    265: 0,    // corpse (uses mons[].cnutrit instead)
    266: 80,   // egg
    267: 5,    // meatball
    268: 5,    // meat stick
    269: 2000, // enormous meatball
    270: 5,    // meat ring
    271: 20, 272: 20, 273: 20, 274: 20, // globs
    275: 30,   // kelp frond
    276: 1,    // eucalyptus leaf
    277: 50,   // apple
    278: 80,   // orange
    279: 50,   // pear
    280: 100,  // melon
    281: 80,   // banana
    282: 50,   // carrot
    283: 40,   // sprig of wolfsbane
    284: 40,   // clove of garlic
    285: 250,  // slime mold
    286: 200,  // lump of royal jelly
    287: 100,  // cream pie
    288: 100,  // candy bar
    289: 40,   // fortune cookie
    290: 200,  // pancake
    291: 800,  // lembas wafer
    292: 600,  // cram ration
    293: 800,  // food ration
    294: 400,  // K-ration
    295: 300,  // C-ration
    296: 0,    // tin
};

// C ref: mondata.h metallivorous/carnivorous/herbivorous/acidic/poisonous —
// straight mflags1 bit tests.  These were species-NAME sets (and, for the diet
// pair, makemon.js's hand-written MFOOD table which disagrees with the
// machine-generated flag table for 16 species — every renamed leader/ruler:
// dwarf leader, kobold leader, gnome leader/ruler, ogre leader/tyrant, ...).
// The name sets also missed "kobold leader" and "amorous demon" for M1_POIS.
function metallivorous(ptr) { return (mflags1_of(ptr) & M1_METALLIVORE) !== 0; }
function carnivorous(ptr) { return (mflags1_of(ptr) & M1_CARNIVORE) !== 0; }
function herbivorous(ptr) { return (mflags1_of(ptr) & M1_HERBIVORE) !== 0; }
function acidic(ptr) { return (mflags1_of(ptr) & M1_ACID) !== 0; }
function poisonous(ptr) { return (mflags1_of(ptr) & M1_POIS) !== 0; }

// C ref: mondata.h haseyes(ptr) == !(mflags1 & M1_NOEYES).  Reads the generated
// flag table (identical to the old constant TRUE for every pet, but correct for
// the arbitrary monsters dog_attack_mon() now inspects).
function haseyes(mdat) { return (mflags1_of(mdat) & M1_NOEYES) === 0; }

// C ref: monflag.h MS_LEADER / MS_GUARDIAN — the quest leader and its guards,
// which a pet refuses to attack while the pet is peaceful toward them.
const MS_LEADER = 36, MS_GUARDIAN = 38;
// C ref: mondata.h touch_petrifies(ptr) / monst.h resists_ston(mon).
// monflag.h MR_POISON 0x20 / MR_ACID 0x40 / MR_STONE 0x80.
const MR_POISON = 0x20, MR_ACID = 0x40, MR_STONE = 0x80;
function touch_petrifies_data(ptr) {
    return ptr?.name === 'cockatrice' || ptr?.name === 'chickatrice';
}
// C ref: mondata.h flesh_petrifies(pm) = touch_petrifies(pm) || pm == Medusa.
function flesh_petrifies_data(ptr) {
    return touch_petrifies_data(ptr) || ptr?.name === 'Medusa';
}
function resists_ston_mon(mon) {
    return ((mon?.data?.mresists ?? 0) & MR_STONE) !== 0;
}
// C ref: monst.h resists_poison(mon) / resists_acid(mon) — Resists_Elem bits.
function resists_poison_mon(mon) {
    return ((mon?.data?.mresists ?? 0) & MR_POISON) !== 0;
}
function resists_acid_mon(mon) {
    return ((mon?.data?.mresists ?? 0) & MR_ACID) !== 0;
}

// C ref: mondata.h vegan(ptr) — keyed on the monster's class (mlet/mcls): blobs,
// jellies, fungi/molds, vortices, lights, non-stalker elementals, non-flesh/
// leather golems, plus noncorporeal monsters.  A vegan corpse fed to a non-
// herbivore pet returns MANFOOD (>= MANFOOD -> APPORT rn2(8)); to a herbivore
// pet it returns CADAVER.  S_* numeric class indices (include/defsym.h).
// (verified against include/defsym.h MONSYM(idx,...) — mon.data.mcls carries
//  that numeric index, not the display character.)
const S_BLOB = 2, S_JELLY = 10, S_KOBOLD = 11, S_MIMIC = 13,
      S_NYMPH = 14, S_ORC = 15, S_VORTEX = 22, S_LIGHT = 25, S_DRAGON = 30,
      S_ELEMENTAL = 31, S_FUNGUS = 32, S_OGRE = 41, S_VAMPIRE = 48,
      S_YETI = 51, S_GHOST = 54, S_GOLEM = 55;
const PM_STALKER_NAME = "stalker";
const FLESH_LEATHER_GOLEM = new Set(["flesh golem", "leather golem"]);
function corpse_is_vegan(fdat) {
    const c = fdat.mcls;
    if (c === S_BLOB || c === S_JELLY || c === S_FUNGUS || c === S_VORTEX
        || c === S_LIGHT) return true;
    if (c === S_ELEMENTAL && fdat.name !== PM_STALKER_NAME) return true;
    if (c === S_GOLEM && !FLESH_LEATHER_GOLEM.has(fdat.name)) return true;
    // C ref: mondata.h:31 noncorporeal(ptr) == (mlet == S_GHOST) — ghost and
    // shade.  Their (bones-file) corpses ARE reachable as pet goals; dropping
    // this made a ghoul/pony treat one as CADAVER/MANFOOD instead of vegan.
    return c === S_GHOST;
}

// C ref: mondata.c same_race(pm1, pm2) — dogfood()'s cannibalism test.  Player
// races first (each has its own M2 predicate), then the coarser body classes.
function is_golem_data(ptr) { return ptr?.mcls === S_GOLEM; }
function same_race(pm1, pm2) {
    if (!pm1 || !pm2) return false;
    if (pm1 === pm2 || pm1.pmidx === pm2.pmidx) return true;
    if (is_human_flag(pm1)) return is_human_flag(pm2);
    if (is_elf_flag(pm1)) return is_elf_flag(pm2);
    if (is_dwarf_flag(pm1)) return is_dwarf_flag(pm2);
    if (is_gnome_flag(pm1)) return is_gnome_flag(pm2);
    if (is_orc_flag(pm1)) return is_orc_flag(pm2);
    if (is_giant_flag(pm1)) return is_giant_flag(pm2);
    if (is_golem_data(pm1)) return is_golem_data(pm2);
    return pm1.mcls === pm2.mcls;
}

// C ref: obj.h polyfood(obj) — an ofood() (corpse/egg/tin) whose corpsenm is a
// shapeshifter (pm_to_cham) or carries an AD_POLY damage type.  This used to be
// hardcoded to `fx === 326 /* chameleon */`, which answered FALSE for every
// other shapeshifter corpse (doppelganger, sandestin, chickatrice/vampire
// shifters) and for the AD_POLY monsters, so a tame pet ate them instead of
// classifying MANFOOD.
function polyfood_corpsenm(fx) {
    if (fx == null || fx < 0) return false;
    if (pm_to_cham(fx) >= 0) return true;
    return dmgtype(monster_by_pmidx(fx), AD_POLY);
}

// Kept in lock-step with allmain.js MULTIPASS_MOVEMON.  When the C multi-pass
// movemon() loop is enabled, the pet's repeat object scan needs real
// line-of-sight (clear_path) and the hero's COULD_SEE bit (couldsee) to match
// C's obj_resists/rn2(8) stream in dog_goal's APPORT branch.  This is ON: the
// trailing "stays OFF in lock-step with the multi-pass gate" sentence was left
// over from when the constant was false and contradicted the value below.
export const PET_REAL_VISION = true;

// C ref: mon.c max_mon_load(mtmp).  MAX_CARR_CAP=1000, WT_HUMAN=1450.
// kitten(34)/little dog(16): cwt=150, MZ_SMALL, not strong ->
//   (1000*150)/1450 = 103, then /2 (not strong) = 51.
// pony(102): cwt=1300, MZ_MEDIUM, M2_STRONG, cwt<=WT_HUMAN -> MAX_CARR_CAP=1000,
//   no halving (strong) = 1000.
// All three starting pets are M1_NOHANDS and are not dragons / engulfers.
const PET_MAXLOAD = { [PM_LITTLE_DOG]: 51, [PM_KITTEN]: 51, [PM_PONY]: 1000 };

// C ref: mon.c MON_AT — a (live) monster other than the hero at <x,y>.
function MON_AT(x, y) {
    for (const m of game.level?.monsters || [])
        if (m.mx === x && m.my === y && !(m.mhp != null && m.mhp <= 0)) return m;
    return false;
}

// C ref: rm.h levl[x][y].typ + the object chain at a square.
function terrainTyp(x, y) { return game.level?.at(x, y)?.typ; }

// All floor objects on the level (C's `fobj` chain).  C inserts each newly
// placed object at the HEAD of fobj (otmp->nobj = fobj; fobj = otmp), so the
// chain iterates newest-first.  Our level.objects array is append-ordered
// (oldest-first), so reverse it to reproduce C's traversal order — in dog_goal
// the traversal order determines which object's APPORT rn2(8) fires first and
// how gg.gtyp evolves, so the obj_resists/rn2(8) stream must match C's fobj.
function fobj() {
    const arr = game.level?.objects;
    if (!arr) return [];
    const out = [];
    for (let i = arr.length - 1; i >= 0; i--) out.push(arr[i]);
    return out;
}

// Objects at a specific square, in level.objects append order (deepest first).
function objectsAt(x, y) {
    return (game.level?.objects || []).filter((o) => o.ox === x && o.oy === y);
}

// C ref: mkobj.c place_object() pushes onto svl.level.objects[x][y]
// (`otmp->nexthere = svl.level.objects[x][y]`), so a tile's nexthere chain runs
// TOPMOST-FIRST while our flat level.objects array is in placement order.
// Every C `for (obj = svl.level.objects[x][y]; obj; obj = obj->nexthere)` walk
// must therefore read the pile reversed: the order decides which object the
// walk stops on, and a walk that stops early makes fewer dogfood()
// obj_resists rn2(100) draws than one that runs to the end.
function objectsAtNexthere(x, y) {
    const pile = objectsAt(x, y);
    pile.reverse();
    return pile;
}

// C ref: hack.h distu(x,y) — squared distance from hero.
function distu(x, y) { return dist2(x, y, game.u?.ux ?? 0, game.u?.uy ?? 0); }
// C ref: hack.h distmin(x0,y0,x1,y1) — Chebyshev (king-move) distance.
function distmin(x0, y0, x1, y1) {
    return Math.max(Math.abs(x0 - x1), Math.abs(y0 - y1));
}

// C ref: dog.c dogfood(mon, obj) — the food/desirability classification.
// We only need (a) the rn2(100) obj_resists side-effect, emitted for every
// non-poisoned object, and (b) a faithful-enough quality so goal selection
// (and thus the downstream rn2 ordering) matches for the common objects the
// starting level places.
export function dogfood(mon, obj) {
    const mdat = mon.data || {};
    const carni = carnivorous(mdat);
    const herbi = herbivorous(mdat);

    // C ref: dog.c:1011 — `obj->opoisoned && !resists_poison(mon)`.  The
    // resists_poison() half used to be dropped ("pets don't, at start"), which
    // made a tamed poison-resistant monster refuse a poisoned item C lets it
    // consider (POISON >= MANFOOD, so it also suppresses the APPORT rn2(8)).
    if (obj.opoisoned && !resists_poison_mon(mon)) return POISON;
    // is_quest_artifact() is false for ordinary objects; obj_resists rolls
    // rn2(100) (always FALSE for non-artifacts with ochance 0).
    if (obj_resists(obj, 0, 95))
        return obj.cursed ? TABU : APPORT;

    switch (obj.oclass) {
    case FOOD_CLASS: {
        // C ref: dog.c dogfood() FOOD_CLASS.  fx/fdat = the monster a CORPSE/
        // TIN/EGG came from (corpsenm), used by the corpse/egg branches; NON_PM
        // for ordinary food.  The rider/petrify checks run BEFORE the diet
        // gate, exactly as in C.
        const fx = (obj.otyp === CORPSE || obj.otyp === TIN || obj.otyp === EGG)
            ? obj.corpsenm : -1;
        const fdat = (fx != null && fx >= 0) ? monster_by_pmidx(fx) : null;

        // C ref: dog.c:1024-1030 — these two guards used to be described as
        // "name-rare; skip the lookups".  They are not optional: they run BEFORE
        // the `!carni && !herbi` diet gate, and both return a quality >= MANFOOD
        // for a corpse a carnivore pet would otherwise rate CADAVER — i.e. they
        // decide whether the pet walks onto the square and eats (and whether the
        // APPORT rn2(8) fires).  A pet eating a cockatrice corpse also dies.
        if (obj.otyp === CORPSE && is_rider_pm(fx))
            return TABU;
        if ((obj.otyp === CORPSE || obj.otyp === EGG)
            && flesh_petrifies_data(fdat) && !resists_ston_mon(mon))
            return POISON;
        // C ref: dog.c:1031-1038 — a killer bee rates royal jelly DOGFOOD only
        // while the level has no queen bee (otherwise TABU: it would grow into a
        // rival queen).  Reachable via a tamed killer bee.
        if (obj.otyp === LUMP_OF_ROYAL_JELLY && mdat.name === 'killer bee')
            return find_pmmonst('queen bee') ? TABU : DOGFOOD;

        // C ref: dog.c — the per-otyp diet switch is gated by `!carni && !herbi`
        // (omnivore/carnivore/herbivore pets only).  A non-eater pet treats food
        // as APPORT (or UNDEF if cursed).
        if (!carni && !herbi)
            return obj.cursed ? UNDEF : APPORT;
        // a starving pet (mhpmax_penalty) will eat almost anything.  dog_hunger()
        // sets mhpmax_penalty once the pet passes DOG_WEAK moves past hungrytime.
        const starving = !!(mon.mtame && !mon.isminion && mon.edog
                            && mon.edog.mhpmax_penalty);
        // even carnivores eat carrots while temporarily blind (mblind)
        const mblind = !mon.mcansee && haseyes(mdat);
        const moves = game.moves || 1;
        // C ref: mkobj.c peek_at_iced_corpse_age() — the corpse's age, unshifted
        // for an off-ice corpse (we have no ice-box aging).
        const corpse_age = obj.age ?? moves;
        const isLizardLichen = (fx === 158 /*lichen*/ || fx === 325 /*lizard*/);

        // C ref: dog.c:1041-1055 — the ghoul diet, which inverts the freshness
        // test (ghouls want ROTTEN corpses and stale eggs) and rates everything
        // else TABU.  Reachable via a tamed ghoul.
        if (mdat.name === 'ghoul') {
            if (obj.otyp === CORPSE)
                return (corpse_age + 50 <= moves && !isLizardLichen) ? DOGFOOD
                    : (starving && !(fdat && corpse_is_vegan(fdat))) ? ACCFOOD
                        : POISON;
            if (obj.otyp === EGG)
                return stale_egg(obj) ? CADAVER : starving ? ACCFOOD : POISON;
            return TABU;
        }

        switch (obj.otyp) {
        case TRIPE_RATION:
        case MEATBALL:
        case MEAT_RING:
        case MEAT_STICK:
        case ENORMOUS_MEATBALL:
            return carni ? DOGFOOD : MANFOOD;
        case EGG:
            // C ref: dog.c:1063 — a pyrolisk egg is POISON to a non-fire-liker.
            if (fdat?.name === 'pyrolisk' && !likes_fire(mdat)) return POISON;
            return carni ? CADAVER : MANFOOD;
        case CORPSE: {
            // C ref: dog.c:1066-1088.  A corpse that has rotted (age+50 <= moves)
            // and isn't a lizard/lichen — and whose EATER is not a fungus — or
            // whose monster is acidic/poisonous (eater doesn't resist), is POISON.
            // Otherwise: polyfood -> MANFOOD; vegan -> herbi?CADAVER:MANFOOD;
            // cannibalism -> TABU/ACCFOOD; else carni?CADAVER:MANFOOD.
            //
            // NOTE the fungus test reads `mptr->mlet` — the EATING monster's
            // class, not the corpse's.  It was ported as the corpse's class,
            // which let every pet eat arbitrarily rotten mold/fungus corpses
            // (and made a fungus pet refuse rotten meat it should accept).
            const eater_is_fungus = mdat.mcls === S_FUNGUS;
            if ((corpse_age + 50 <= moves && !isLizardLichen && !eater_is_fungus)
                || (acidic(fdat) && !resists_acid_mon(mon))
                || (poisonous(fdat) && !resists_poison_mon(mon)))
                return POISON;
            if (polyfood_corpsenm(fx) && (mon.mtame > 1) && !starving)
                return MANFOOD;
            if (fdat && corpse_is_vegan(fdat))
                return herbi ? CADAVER : MANFOOD;
            // C ref: dog.c:1080-1085 — most humanoids avoid cannibalism unless
            // starving; elves never eat elves.  Kobold/orc/ogre corpses and
            // undead eaters are exempt.  Ported as a flat `return false` before,
            // so a tamed gnome/dwarf/human happily ate its own kind.
            if (humanoid(mdat) && same_race(mdat, fdat)
                && !is_undead_flag(mdat) && fdat?.mcls !== S_KOBOLD
                && fdat?.mcls !== S_ORC && fdat?.mcls !== S_OGRE)
                return (starving && carni && !is_elf_flag(mdat)) ? ACCFOOD : TABU;
            return carni ? CADAVER : MANFOOD;
        }
        case GLOB_OF_GREEN_SLIME:
            // C ref: dog.c:1089 — turning into slime beats starving.
            return (starving || slimeproof(mdat)) ? ACCFOOD : POISON;
        case CLOVE_OF_GARLIC:
            // C ref: dog.c:1093 — undead/vampshifters refuse garlic outright.
            return (is_undead_flag(mdat) || is_vampshifter_mon(mon)) ? TABU
                : (herbi || starving) ? ACCFOOD : MANFOOD;
        case TIN:
            // C ref: dog.c dogfood() — metallivorous(mptr) ? ACCFOOD : MANFOOD.
            // A pet won't pry a tin open to eat it (MANFOOD) unless it eats metal.
            return metallivorous(mdat) ? ACCFOOD : MANFOOD;
        case APPLE:
            return herbi ? DOGFOOD : starving ? ACCFOOD : MANFOOD;
        case CARROT:
            return (herbi || mblind) ? DOGFOOD : starving ? ACCFOOD : MANFOOD;
        case BANANA:
            // C ref: dog.c:1104 — herbivorous yetis/sasquatches prefer bananas.
            return (mdat.mcls === S_YETI && herbi) ? DOGFOOD
                : (herbi || starving) ? ACCFOOD : MANFOOD;
        default:
            if (starving) return ACCFOOD;
            // C: otyp > SLIME_MOLD ? (carni?ACCFOOD:MANFOOD)
            //                      : (herbi?ACCFOOD:MANFOOD)
            return (obj.otyp > SLIME_MOLD)
                ? (carni ? ACCFOOD : MANFOOD)
                : (herbi ? ACCFOOD : MANFOOD);
        }
    }
    case ROCK_CLASS:
        return UNDEF;
    default:
        // C ref: dog.c:1116-1128 — the non-food default arm.  A pet will not
        // fetch an amulet of strangulation or a ring of slow digestion (it would
        // put it on / choke), and silver-hating pets refuse silver.  These three
        // TABU cases were dropped, so a pet apported items C rates TABU (TABU is
        // > MANFOOD and also fails the APPORT gate, so it changes both the
        // dog_goal rn2(8) stream and where the pet walks).
        if (obj.otyp === AMULET_OF_STRANGULATION
            || obj.otyp === RIN_SLOW_DIGESTION)
            return TABU;
        if (mon_hates_silver(mon) && obj_material(obj) === SILVER)
            return TABU;
        if (mdat.name === 'gelatinous cube' && is_organic_obj(obj))
            return ACCFOOD;
        if (metallivorous(mdat) && is_metallic_obj(obj)
            && (is_rustprone_obj(obj) || mdat.name !== 'rust monster')) {
            // Non-rustproofed ferrous-based metals are preferred.
            return (is_rustprone_obj(obj) && !obj.oerodeproof) ? DOGFOOD : ACCFOOD;
        }
        if (!obj.cursed && obj.oclass !== BALL_CLASS
            && obj.oclass !== CHAIN_CLASS)
            return APPORT;
        return UNDEF;
    }
}

// C ref: mon.c find_pmmonst(pm) — the first live monster of a species on the
// level (dogfood()'s royal-jelly branch).
function find_pmmonst(name) {
    for (const m of game.level?.monsters || [])
        if (m.data?.name === name && !(m.mhp != null && m.mhp <= 0)) return m;
    return null;
}
// C ref: obj.h stale_egg(egg) — (moves - age) > 2*MAX_EGG_HATCH_TIME (200).
function stale_egg(obj) {
    return ((game.moves || 1) - (obj.age ?? 0)) > 400;
}
// C ref: mondata.h likes_fire(ptr) — fire-immune species (mresists MR_FIRE)
// plus the fire-liking demons; the MR_FIRE bit is the part dogfood() needs.
const MR_FIRE = 0x01;
function likes_fire(ptr) { return ((ptr?.mresists ?? 0) & MR_FIRE) !== 0; }
// C ref: mondata.h slimeproof(ptr) — green slime itself, flaming, noncorporeal.
function slimeproof(ptr) {
    return ptr?.name === 'green slime' || likes_fire(ptr) || ptr?.mcls === S_GHOST;
}
// C ref: mondata.h is_vampshifter(mon) — a monster whose cham (true) form is
// one of the three vampire species.
const PM_VAMPIRE = 226, PM_VAMPIRE_LEADER = 227, PM_VLAD_THE_IMPALER = 228;
function is_vampshifter_mon(mon) {
    const c = mon?.cham;
    return c === PM_VAMPIRE || c === PM_VAMPIRE_LEADER
        || c === PM_VLAD_THE_IMPALER;
}

// C ref: objclass.h obj_material enum — WOOD 8, IRON 11, SILVER 14, MITHRIL 17.
const MAT_WOOD = 8, MAT_IRON = 11, MAT_SILVER = 14, MAT_MITHRIL = 17;
const SILVER = MAT_SILVER;
function obj_material(obj) {
    return OBJECTS[obj?.otyp]?.material ?? -1;
}
// C ref: objclass.h is_metallic(obj) — IRON <= material <= MITHRIL;
// is_organic(obj) — material <= WOOD; is_rustprone(obj) — material == IRON.
function is_metallic_obj(obj) {
    const m = obj_material(obj);
    return m >= MAT_IRON && m <= MAT_MITHRIL;
}
function is_organic_obj(obj) {
    const m = obj_material(obj);
    return m > 0 && m <= MAT_WOOD;
}
function is_rustprone_obj(obj) { return obj_material(obj) === MAT_IRON; }

// C ref: stairs.c On_stairs(x,y) — stairway_at(x,y) != NULL.  Stairs live on
// the game.stairs linked list (mklev.js) with .sx/.sy coordinates.
function On_stairs(x, y) {
    for (let s = game.stairs; s; s = s.next)
        if (s.sx === x && s.sy === y) return true;
    return false;
}

// C ref: dogmove.c dog_goal — `for (obj = gi.invent; obj; obj = obj->nobj)`.
// The hero's pack, in inventory order.  game.invent is the materialized array.
function heroInvent() {
    return game.invent || game.gi?.invent || [];
}

// C ref: dogmove.c dog_goal — `for (t = gf.ftrap; ...) if (t->ttyp==MAGIC_PORTAL)`
// Consumes no RNG; just decides whether the pet should follow closely because
// the hero is on/next to a magic portal.
function nearMagicPortal() {
    const u = game.u;
    for (const t of (game.level?.traps || [])) {
        if (t.ttyp === MAGIC_PORTAL) {
            // distu(t.tx,t.ty) <= 2 (the first magic portal found ends the scan).
            return dist2(t.tx, t.ty, u.ux, u.uy) <= 2;
        }
    }
    return false;
}

// C ref: dog.c initedog() — apport = ACURR(A_CHA), captured at makedog() time.
// CRITICAL ORDERING: in newgame() (allmain.c:814) makedog() runs BEFORE
// u_init_inventory_attrs() (allmain.c:816) which sets the hero's attributes.
// At makedog time u_init_misc() has just memset(&u,0,...), so acurr.a[A_CHA]==0
// and abon/atemp are 0 too.  acurr(A_CHA) (attrib.c:1200) floors its result at
// 3 (`tmp <= 3 ? 3`), so the starting pet's apport is ALWAYS 3 regardless of
// role/race.  (The final, higher CHA is irrelevant — it isn't rolled yet.)
function edogApport(edog) {
    if (edog.apport == null) edog.apport = 3;
    return edog.apport;
}

// C ref: objects.h — the tool otyps droppables() reasons about.
const DWARVISH_MATTOCK = 78, PICK_AXE = 66, UNICORN_HORN = 246,
      SKELETON_KEY = 235, LOCK_PICK = 236, CREDIT_CARD = 237;

// C ref: dogmove.c droppables(mon) — return the first droppable object in the
// pet's minvent.  Consumes no RNG, but the ANSWER drives dog_invent's drop path
// and dog_goal's `dog_has_minvent` (which gates the rn2(edog->apport) roll), so
// keeping the wrong item is an RNG divergence.
//
// The old body was just the trailing `!owornmask && obj != wep` filter, valid
// only for the animal/mindless pets (for which C forces pickaxe/unihorn/key to
// the &dummy sentinel and so falls straight through the switch).  A tamed
// gnome/dwarf/soldier carrying a pick-axe, unicorn horn or unlocking tool KEEPS
// it in C and drops the next thing instead.
function droppables(mtmp) {
    const inv = mtmp.minvent;
    if (!inv || !inv.length) return null;
    const wep = mtmp.mw || null;
    // C ref: dogmove.c:41-60 — `dummy` stands in for "already have one of
    // these", so any real one becomes an ordinary drop candidate.  It is
    // otyp GOLD_PIECE with oartifact set (so a real artifact can't beat it).
    const dummy = { otyp: GOLD_PIECE, oartifact: 1, _dummy: true };
    let pickaxe = null, unihorn = null, key = null;
    if (is_animal(mtmp.data) || mindless(mtmp.data)) {
        pickaxe = unihorn = key = dummy;
    } else {
        if (!tunnels(mtmp.data) || !needspick(mtmp.data)) pickaxe = dummy;
        if (nohands(mtmp.data) || verysmall(mtmp.data)) key = dummy;
    }
    if (wep) {
        if (wep.otyp === PICK_AXE || wep.otyp === DWARVISH_MATTOCK)
            pickaxe = wep;
        if (wep.otyp === UNICORN_HORN) unihorn = wep;
    }

    for (const obj of inv) {
        switch (obj.otyp) {
        case DWARVISH_MATTOCK:
            // reject mattock if it couldn't be wielded (shield in the way)
            if (which_armor_arms(mtmp)) break;
            if (pickaxe && pickaxe.otyp === PICK_AXE && pickaxe !== wep
                && (!pickaxe.oartifact || obj.oartifact))
                return pickaxe; // drop the one we earlier decided to keep
            /* FALLTHRU */
        case PICK_AXE:
            if (!pickaxe || (obj.oartifact && !pickaxe.oartifact)) {
                if (pickaxe) return pickaxe;
                pickaxe = obj;
                continue;
            }
            break;
        case UNICORN_HORN:
            if (obj.cursed) break;
            if (!unihorn || (obj.oartifact && !unihorn.oartifact)) {
                if (unihorn) return unihorn;
                unihorn = obj;
                continue;
            }
            break;
        case SKELETON_KEY:
            if (key && key.otyp === LOCK_PICK
                && (!key.oartifact || obj.oartifact))
                return key;
            /* FALLTHRU */
        case LOCK_PICK:
            if (key && key.otyp === CREDIT_CARD
                && (!key.oartifact || obj.oartifact))
                return key;
            /* FALLTHRU */
        case CREDIT_CARD:
            if (!key || (obj.oartifact && !key.oartifact)) {
                if (key) return key;
                key = obj;
                continue;
            }
            break;
        default:
            break;
        }
        if (!obj.owornmask && obj !== wep) return obj;
    }
    return null;
}
// C ref: worn.c which_armor(mon, W_ARMS) — the monster's worn shield.
const W_ARMS_BIT = 0x08;
function which_armor_arms(mtmp) {
    for (const o of mtmp.minvent || [])
        if (o.owornmask & W_ARMS_BIT) return o;
    return null;
}
// C ref: mondata.h tunnels/needspick/verysmall — the three flag tests
// droppables() consults for a non-animal pet.
function tunnels(ptr) { return cri_tunnels(ptr); }
function needspick(ptr) {
    // C ref: mondata.h:33 needspick(ptr) == (mflags1 & M1_NEEDPICK).  Was a
    // two-name exemption set ('rock mole', 'umber hulk') that answered TRUE for
    // every other species — including the WOODCHUCK, the third M1_TUNNEL
    // species C lets dig without a tool.
    return (mflags1_of(ptr) & M1_NEEDPICK) !== 0;
}
// C ref: mondata.h verysmall(ptr) = (msize < MZ_SMALL).
function verysmall(ptr) {
    const sz = ptr?.msize ?? mon_msize(ptr?.pmidx) ?? 2;
    return sz < 1;
}

// C ref: dogmove.c dog_hunger(mtmp, edog) — the per-move hunger effects, run at
// the TOP of dog_move() before anything else.  Draws no RNG itself, but writes
// three pieces of state that a later modulus reads:
//   - edog->mhpmax_penalty ("starving"), which dogfood() consults for EVERY
//     object it classifies and which gates dog_invent's ACCFOOD eat and
//     dog_goal's `mhpmax_penalty && otyp < MANFOOD` cursed-square override;
//   - mtmp->mconf, which forces dog_goal's appr to 0 (changing the jv sign of
//     every candidate square, hence which rn2(3)/rn2(12) branch is taken) and
//     adds score_targ's two rn2(3) rolls;
//   - mtmp->mhpmax/mhp, which feed dog_move's `balk` and the max_passive_dmg
//     comparison in the ALLOW_M branch.
// It can also kill the pet (mondied) and print "<pet> is confused from hunger."
// Returns TRUE on starvation.
async function dog_hunger(mtmp, edog) {
    const moves = game.moves || 1;
    if (moves > (edog.hungrytime || 0) + DOG_WEAK) {
        if (!carnivorous(mtmp.data) && !herbivorous(mtmp.data)) {
            edog.hungrytime = moves + DOG_WEAK;
        } else if (!edog.mhpmax_penalty) {
            const newmhpmax = Math.trunc((mtmp.mhpmax || 0) / 3);
            mtmp.mconf = 1;
            edog.mhpmax_penalty = (mtmp.mhpmax || 0) - newmhpmax;
            mtmp.mhpmax = newmhpmax;
            if ((mtmp.mhp ?? 0) > mtmp.mhpmax) mtmp.mhp = mtmp.mhpmax;
            if ((mtmp.mhp ?? 1) <= 0) {
                await dog_starve(mtmp);
                return true;
            }
            if (cansee(mtmp.mx, mtmp.my))
                await emit_pet_msg(`${Monnam(mtmp)} is confused from hunger.`);
            // C ref: sounds.c beg(mtmp) / You_feel("worried about ...") — the
            // out-of-sight variants; both are toplines with no RNG.
            else if (couldsee(mtmp.mx, mtmp.my))
                await emit_pet_msg(`${Monnam(mtmp)} whines sadly.`);
            else
                await emit_pet_msg(`You feel worried about ${y_monnam(mtmp)}.`);
            stop_pet_occupation();
        } else if (moves > (edog.hungrytime || 0) + DOG_STARVE
                   || (mtmp.mhp ?? 1) <= 0) {
            await dog_starve(mtmp);
            return true;
        }
    }
    return false;
}

// C ref: dogmove.c dog_starve(mtmp) — the pet dies of hunger.  PARTIAL: C calls
// mondied(), whose corpse_chance() rn2 tail this port keeps per-caller (mhitm.js
// / muse.js each own a copy) and which is not shared; we take the pet off the
// map so the map and the movemon loop agree, and leave the corpse roll to the
// completeness pass.  Only reachable ~DOG_STARVE moves past hungrytime.
async function dog_starve(mtmp) {
    if (mtmp.mleashed && mtmp !== game.u?.usteed)
        await emit_pet_msg('Your leash goes slack.');
    else if (cansee(mtmp.mx, mtmp.my))
        await emit_pet_msg(`${Monnam(mtmp)} starves.`);
    else
        await emit_pet_msg(`You feel ${game.u?.uhallu ? 'bummed' : 'sad'} for a moment.`);
    const mx = mtmp.mx, my = mtmp.my;
    mtmp.mhp = 0;
    const list = game.level?.monsters;
    if (list) {
        const i = list.indexOf(mtmp);
        if (i >= 0) list.splice(i, 1);
    }
    if (game.u?.ustuck === mtmp) game.u.ustuck = null;
    mtmp.mtrapped = 0;
    newsym(mx, my);
}

// C ref: allmain.c stop_occupation() — cancels a running multi-turn occupation
// (the pet's "confused from hunger" message interrupts it).  This port models
// occupations with per-command flags (allmain.js `_force_box` and friends)
// rather than a go.occupation function pointer, so only the generic slot is
// cleared here; the "You stop <occtxt>." topline and the gm.multi/nomul(0)
// arm are deliberately NOT reproduced — nomul(0) must leave the occupation
// armed in this port, and a wrong release point is worth -117 (see the
// botl-is-a-snapshot note).
function stop_pet_occupation() {
    if (game.go?.occupation) game.go.occupation = null;
}
// C ref: do_name.c y_monnam(mtmp) — "your kitten" (lower case).
function y_monnam(mtmp) { return x_monnam(mtmp, /*ARTICLE_YOUR*/ 3, null, 0, false); }

// C ref: teleport.c goodpos(x, y, mtmp, 0) — the leash-kludge placement test.
function leash_goodpos(mtmp, x, y) {
    return isok(x, y) && goodpos(x, y, mtmp, 0);
}

// C ref: monst.h helpless(mon) — asleep or unable to move.  (monmove.js keeps
// its own copy; a missing mcanmove defaults to C's TRUE, not 0.)
function mon_is_helpless(mtmp) {
    const canmove = (mtmp.mcanmove == null) ? 1 : mtmp.mcanmove;
    return !!mtmp.msleeping || !canmove;
}
// C ref: objects.h SCR_MAIL — excluded from a pet's underfoot pickup.
const SCR_MAIL = 364;
// C ref: obj.h is_mines_prize/is_soko_prize — the luckstone/bag reserved as the
// branch-end prize.  invent.js and monmove.js both carry the same stub; the
// real test needs the per-branch prize o_id bookkeeping (u.uachieve fields),
// which this port does not track yet.
function is_mines_prize(_obj) { return false; }
function is_soko_prize(_obj) { return false; }

// C ref: objnam.c doname(obj) for the items a starter pet carries (gold and
// ordinary floor objects), used in the pet pickup/drop toplines.  For a single
// gold piece doname() prefixes the article: "a gold piece"; a multi stack reads
// "<n> gold pieces".  Other objects use the full doname (doname_invent) so a
// known weapon/armor shows its enchantment ("a blessed +1 quarterstaff"); a
// floor object has no worn mask, so doname_invent's worn-status suffix is empty.
function pet_doname(obj) {
    if (obj && (obj.oclass === COIN_CLASS || obj.otyp === GOLD_PIECE)) {
        const q = obj.quan || 0;
        return q === 1 ? 'a gold piece' : `${q} gold pieces`;
    }
    return doname_invent(obj);
}

// C ref: dogmove.c dog_invent(mtmp, edog, udist).  The pet either drops a
// carried object (relobj, no RNG beyond the drop rolls), eats an underfoot
// item (counts as its move), or picks one up (splitobj -> next_ident when the
// stack is split).  Picking up sets minvent so later turns take the drop path
// and dog_goal's `dog_has_minvent` rolls fire.  Returns 1 if the pet ate, 2 if
// it died doing so.
async function dog_invent(mtmp, edog, udist) {
    // C ref: dogmove.c:406 — a helpless (asleep/paralysed) or still-digesting
    // pet does nothing here.  m_move()'s own meating gate normally catches the
    // second case first, but dog_move() is also reachable from the steed path
    // (which m_move reaches with meating already decremented) and this guard is
    // what stops a second dogfood()/rn2(100) in that turn.
    if (mon_is_helpless(mtmp) || mtmp.meating) return 0;
    const omx = mtmp.mx, omy = mtmp.my;
    const apport = edogApport(edog);

    // C ref: dogmove.c:416 — if carrying something, maybe drop it near @.
    if (droppables(mtmp)) {
        // assert(apport > 0)
        // C: if (!rn2(udist+1) || !rn2(apport)) if (rn2(10) < apport)
        if (rn2(udist + 1) === 0 || rn2(apport) === 0) {
            if (rn2(10) < apport) {
                // relobj(mtmp, ..., TRUE): drop everything onto the floor.  No
                // RNG.  Place each carried object back on the pet's tile.
                await relobj(mtmp, omx, omy);
                if (edog.apport > 1) edog.apport--;
                edog.dropdist = udist;
                edog.droptime = game.moves || 1;
            }
        }
        return 0;
    }

    // No minvent: maybe eat or pick up an underfoot object.
    const here = objectsAt(omx, omy);
    if (here.length) {
        // C ref: dogmove.c dog_invent — obj = svl.level.objects[omx][omy], the
        // HEAD of the tile's nexthere chain, i.e. the most-recently-placed (top)
        // object.  place_object() appends to this port's flat level.objects array
        // (vobj_at returns the LAST match as the drawn top glyph), so the head is
        // the LAST element here, not here[0].  Picking the true top makes the pet
        // apport the same object C does — e.g. a freshly-fired trap dart lying on
        // top of a trap-victim's corpse — so the tile reverts to the corpse glyph
        // once the dart is taken, matching C.
        const obj = here[here.length - 1];
        // C ref: dogmove.c dog_invent — nofetch[] = {BALL_CLASS, CHAIN_CLASS,
        // ROCK_CLASS} gates the whole underfoot branch BEFORE dogfood() is
        // called: a boulder or statue underfoot is never scanned at all (no
        // obj_resists rn2(100)), unlike dog_goal's fobj scan a few lines down
        // which has no such guard and dogfood()s every in-range object
        // (statues included, always UNDEF).  Without this gate the statue
        // gets dogfood()'d TWICE per turn it sits under the pet — once here,
        // once in dog_goal's scan — burning an extra rn2(100) that shifts
        // every subsequent roll (seed0007 step212: the pet's candidate-square
        // acceptance rn2(3)/rn2(12) rolls land one slot early, so it moves
        // when C's rolls, read from the correct slot, all reject and it
        // stays put).
        // C ref: dogmove.c:429-434 — SCR_MAIL and the Mines/Sokoban prize are
        // gated out alongside nofetch[], BEFORE dogfood() is called, so they
        // burn no obj_resists rn2(100) either.
        const nofetch = obj.oclass === BALL_CLASS || obj.oclass === CHAIN_CLASS
            || obj.oclass === ROCK_CLASS || obj.otyp === SCR_MAIL
            || is_mines_prize(obj) || is_soko_prize(obj);
        if (!nofetch) {
            const edible = dogfood(mtmp, obj);
            // C ref: dogmove.c:437-441 — `&& could_reach_item(mtmp, ox, oy)`.
            // Dropping it let a pet eat/pick up an object it cannot physically
            // reach (under a boulder on its own square, or in water/lava when it
            // is neither swimmer nor lava-liker), which both mis-times the eat
            // and adds a can_carry/rn2(20) roll C never makes.
            const reachable = could_reach_item(mtmp, obj.ox, obj.oy);
            if ((edible <= CADAVER
                 || (edog.mhpmax_penalty && edible === ACCFOOD))
                && reachable) {
                // C ref: dogmove.c:441 — `return dog_eat(mtmp, obj, omx, omy,
                // FALSE)`.  This used to `return 1` without eating, so the
                // corpse stayed on the floor forever and C's two rn2(100)s (the
                // reward-check dogfood() and delobj's obj_resists) never fired.
                return await dog_eat(mtmp, edog, obj, omx, omy);
            }
            // can_carry / pickup path: rn2(20) < apport+3, then rn2(udist)/rn2(apport)
            const carryamt = can_carry(mtmp, obj);
            if (carryamt > 0 && !obj.cursed && reachable) {
                if (rn2(20) < apport + 3) {
                    if (rn2(udist) || rn2(apport) === 0) {
                        // C ref: dogmove.c:448-465 — split a partial stack (which
                        // assigns a fresh o_id via next_ident -> rnd(2)) then move
                        // the object into the pet's minvent (mpickobj, no RNG).
                        let otmp = obj;
                        if (carryamt !== (obj.quan || 1))
                            otmp = pet_splitobj(obj, carryamt);
                        // C ref: dogmove.c:451-462 — if the hero can see the pet's
                        // tile, announce the pickup (verbose default) via pline_xy
                        // -> vpline -> update_topl.  doname() is evaluated before the
                        // object is removed from the floor.  No RNG (cansee is
                        // deterministic; gold/ordinary doname is too).  Routing through
                        // update_topl (not a raw _pending_message assignment) is what
                        // lets the pickup APPEND after an unacknowledged prior message
                        // (e.g. a preceding "The <mon> is killed!") on the same top
                        // line, exactly as C's topl buffer does.
                        if (cansee(omx, omy) && game.flags?.verbose !== false)
                            await emit_pet_msg(`${Monnam(mtmp)} picks up ${pet_doname(otmp)}.`);
                        // C ref: dogmove.c:463-464 — obj_extract_self(otmp) then
                        // newsym(omx, omy).  The pet is on the object's tile (omx,omy);
                        // the newsym refreshes the remembered background so the picked-up
                        // glyph doesn't linger once the tile leaves the hero's sight.
                        pet_extract_floor(otmp);
                        newsym(omx, omy);
                        mpickobj(mtmp, otmp);
                        // C ref: dogmove.c:466-471 — a pet that attacks with
                        // AT_WEAP and still needs a melee weapon WIELDS what it
                        // just picked up, then flags a gear re-check.  Omitted
                        // before, so a tamed soldier/gnome that apported a
                        // weapon never armed itself: mon_wield_item() emits the
                        // "wields" topline and, more importantly, sets mon.mw,
                        // which changes every later hitval/damage roll and the
                        // droppables() "keep the wielded item" filter.
                        if (attacktype(mtmp.data, AT_WEAP)
                            && mtmp.weapon_check === NEED_WEAPON_PET) {
                            mtmp.weapon_check = NEED_HTH_WEAPON_PET;
                            await mon_wield_item(mtmp);
                        }
                        // check_gear_next_turn(mtmp) sets misc_worn_check
                        // |I_SPECIAL so the monster re-evaluates armour next
                        // turn; m_dowear is not ported (monmove.js says the same
                        // at its own mpickobj site), so the bit would be inert.
                    }
                }
            }
        }
    }
    return 0;
}

// C ref: steal.c relobj(mtmp, show, is_pet=TRUE) — drop the pet's DROPPABLE
// carried objects onto its tile.  is_pet=TRUE means "pet should keep
// wielded/worn items": the C loop is `while ((otmp = droppables(mtmp)))
// mdrop_obj(...)`, i.e. it repeatedly asks droppables() (dogmove.c:27-136,
// now ported in full above) for the next candidate and stops once nothing
// droppable remains — a worn item
// such as a pony's saddle (owornmask=W_SADDLE) is NEVER returned by
// droppables() and so is never dropped here, matching a live steed's own
// relobj() call on dismount.  Placement of what IS dropped is deterministic
// (no RNG); we just move it from minvent back into level.objects at (x,y).
async function relobj(mtmp, x, y) {
    // C ref: steal.c relobj(is_pet=TRUE) -> mdrop_obj(mon,obj,is_pet&&verbose).
    const verbose = game.flags?.verbose !== false;
    let obj;
    while ((obj = droppables(mtmp))) await mdrop_obj(mtmp, obj, verbose);
    // C ref: steal.c:896 — `if (show && cansee(omx,omy)) newsym(omx,omy)`, and
    // dog_invent's call site passes show = mtmp->minvis, so a VISIBLE pet gets
    // no refresh here (its own glyph already covers the square).
    if (mtmp.minvis && cansee(x, y)) newsym(x, y);
}

// C ref: steal.c mdrop_obj(mon, obj, verbosely) — drop ONE item out of a
// monster's inventory onto the square the monster stands on.
async function mdrop_obj(mtmp, obj, verbosely) {
    const omx = mtmp.mx, omy = mtmp.my;
    // C ref: steal.c:823 — distant_name(obj, doname) is called for its possible
    // side-effects even when the message won't be printed, and BEFORE the
    // extract (doname() -> xname() -> find_artifact() wants obj still held).
    const obj_name = pet_doname(obj);
    // C ref: steal.c:825 extract_from_minvent(mon, obj, FALSE, TRUE).
    const ix = mtmp.minvent ? mtmp.minvent.indexOf(obj) : -1;
    if (ix >= 0) mtmp.minvent.splice(ix, 1);
    const unwornmask = obj.owornmask | 0;
    obj.owornmask = 0;
    if (unwornmask) {
        mtmp.misc_worn_check = ((mtmp.misc_worn_check | 0) & ~unwornmask) | I_SPECIAL;
        if (obj === mtmp.mw) mtmp.mw = null;
    }
    // C ref: steal.c:835 — the pline fires AFTER the extract and BEFORE the
    // floor placement, so a --More-- here shows the square without the glyph.
    // Routing through update_topl (not a raw _pending_message assignment) lets
    // each drop APPEND after an unacknowledged prior message on the same top
    // line, exactly as C's topl buffer does.
    if (verbosely && cansee(omx, omy))
        await emit_pet_msg(`${Monnam(mtmp)} drops ${obj_name}.`);
    // C ref: steal.c:837-840 — `if (!flooreffects(obj, omx, omy, "fall")) {
    // place_object(obj, omx, omy); stackobj(obj); }`.  The stackobj() was
    // missing: a dropped item that duplicates a stack already on the tile MERGES
    // in C, so the tile (and fobj) hold ONE object, not two.  Without it every
    // later fobj scan that reaches the tile — dog_goal's SQSRCHRADIUS walk above
    // — made one extra dogfood() obj_resists rn2(100), shifting every roll from
    // there on.  (flooreffects() — water/lava/hole destruction — is not ported
    // anywhere in this port, so the object always survives the drop.)
    place_object(obj, omx, omy);
    stackobj(obj);
}

// C ref: monmove.c weapon_check states (mon.h NEED_WEAPON / NEED_HTH_WEAPON).
const NEED_WEAPON_PET = 1, NEED_HTH_WEAPON_PET = 3;

// C ref: mkobj.c splitobj(obj,num) — split `num` off a stack into a new obj
// whose o_id comes from next_ident() (rnd(2)).  Both halves are re-weighed:
// leaving the remainder at the FULL stack weight made curr_mon_load() and
// can_carry() (and the hero's own burden maths, once the pet drops it) read a
// weight C no longer assigns.
function pet_splitobj(obj, num) {
    const split = { ...obj, quan: num, o_id: next_ident() };
    obj.quan = (obj.quan || 1) - num;
    obj.owt = weight(obj);
    split.owt = weight(split);
    return split;
}

// Remove an object (or split fragment) from the floor pile.
function pet_extract_floor(obj) {
    const arr = game.level?.objects;
    if (!arr) return;
    const ix = arr.indexOf(obj);
    if (ix >= 0) arr.splice(ix, 1);
}

// C ref: mon.c mpickobj(mtmp,otmp) — add an object to the monster's minvent.
// No RNG for ordinary items.
function mpickobj(mtmp, obj) {
    mtmp.minvent = mtmp.minvent || [];
    obj.where = 3; // OBJ_MINVENT
    mtmp.minvent.push(obj);
}

// C ref: dogmove.c dog_goal(...).  Returns the approach desire (-1/0/1) or -2
// to abort.  Sets the goal coordinates on `g` (gx/gy) used by the move loop.
function dog_goal(mtmp, edog, after, udist, whappr, g) {
    const omx = mtmp.mx, omy = mtmp.my;
    const u = game.u;

    // C ref: dogmove.c:494-496 — "Steeds don't move on their own will": a
    // ridden steed returns -2 immediately, BEFORE the fobj/invent scans, so it
    // consumes no obj_resists/rn2(8) RNG.  dog_move then maps appr==-2 to
    // MMOVE_NOTHING.  (Reached because the steed stays in fmon and is driven by
    // movemon/dochug/m_move each turn now that mount_steed keeps it on the list.)
    if (mtmp === u?.usteed) return -2;

    let gtyp = UNDEF;
    g.gx = 0; g.gy = 0;

    // C ref: dogmove.c:501-502 — both are computed before the leashed branch.
    const in_masters_sight = couldsee(omx, omy);
    // C ref: dog_has_minvent = (droppables(mtmp) != 0).  True once the pet has
    // picked something up in dog_invent (it stays in minvent until dropped).
    const dog_has_minvent = !!droppables(mtmp);

    if (mtmp.mleashed) {
        // C ref: dogmove.c:504-507 — a LEASHED pet (or an edog-less guardian
        // angel) "isn't going anywhere": gtyp is forced to APPORT, the goal is
        // the hero, and the whole fobj scan is SKIPPED — every dogfood()
        // obj_resists rn2(100) and the APPORT rn2(8) with it.  Not ported at
        // all before, so a leashed pet still burned an rn2(100) per nearby
        // object AND took the follow-the-hero arm below (whose rn2(4) /
        // rn2(apport) rolls C never makes for gtyp == APPORT).
        gtyp = APPORT;
        g.gx = u.ux; g.gy = u.uy;
    } else {
    const SQ = 5;
    const min_x = Math.max(omx - SQ, 1);
    const max_x = Math.min(omx + SQ, COLNO - 1);
    const min_y = Math.max(omy - SQ, 0);
    const max_y = Math.min(omy + SQ, ROWNO - 1);

    // nearby food/objects (C iterates fobj newest-first; that traversal order
    // determines which object's APPORT rn2(8) fires first, so it must match
    // C's fobj chain — see fobj() above and moverock()'s movobj fix in cmd.js).
    for (const obj of fobj()) {
        const nx = obj.ox, ny = obj.oy;
        if (nx >= min_x && nx <= max_x && ny >= min_y && ny <= max_y) {
            const otyp = dogfood(mtmp, obj); // -> obj_resists rn2(100)
            if (otyp > gtyp || otyp === UNDEF) continue;
            if (cursed_object_at(nx, ny)
                && !(edog.mhpmax_penalty && otyp < MANFOOD)) continue;
            // C ref: dogmove.c:539-542 — "skip completely unreachable goals".
            // This guard runs for EVERY in-range object (after dogfood's
            // obj_resists rn2(100) has already fired), BEFORE the MANFOOD split,
            // so it gates the apport rn2(8) roll below.  Without it a pet that
            // can SEE but cannot physically REACH an object (e.g. an item
            // embedded in stone that a fresh zap_dig just opened line-of-sight
            // to) would spuriously fire rn2(8), desyncing the whole RNG stream.
            if (!could_reach_item(mtmp, nx, ny)
                || !can_reach_location(mtmp, mtmp.mx, mtmp.my, nx, ny)) continue;
            if (otyp < MANFOOD) {
                if (otyp < gtyp || DDIST(nx, ny, omx, omy) < DDIST(g.gx, g.gy, omx, omy)) {
                    g.gx = nx; g.gy = ny; gtyp = otyp;
                }
            } else if (gtyp === UNDEF && in_masters_sight && !dog_has_minvent
                && (!isLit(omx, omy) || isLit(u.ux, u.uy))
                && (otyp === MANFOOD || m_cansee(mtmp, nx, ny))
                && edogApport(edog) > rn2(8)
                && can_carry(mtmp, obj) > 0) {
                g.gx = nx; g.gy = ny; gtyp = APPORT;
            }
        }
    }
    }

    let appr;
    if (gtyp === UNDEF
        || (gtyp !== DOGFOOD && gtyp !== APPORT && (game.moves || 1) < edog.hungrytime)) {
        g.gx = u.ux; g.gy = u.uy;
        if (after && udist <= 4 && u.ux === g.gx && u.uy === g.gy)
            return -2;
        appr = (udist >= 9) ? 1 : (mtmp.mflee ? -1 : 0);
        if (udist > 1) {
            if (!IS_ROOM(terrainTyp(u.ux, u.uy)) || !rn2(4) || whappr
                || (dog_has_minvent && rn2(edogApport(edog))))
                appr = 1;
        }
        // C ref: dogmove.c:582 — "if you have dog food it'll follow you more
        // closely; if you are on stairs (or ladder) or on/next to a magic
        // portal, it behaves as if you have dog food."  When appr==0, C checks
        // On_stairs (no RNG), then scans the hero's pack calling dogfood() on
        // each item (each emits obj_resists rn2(100)), stopping at the first
        // DOGFOOD; then a magic-portal scan (no RNG).  This invent scan is the
        // RNG the 2nd movemon pass needs (the pet is adjacent => appr==0).
        if (appr === 0) {
            if (On_stairs(u.ux, u.uy)) {
                appr = 1;
            } else {
                for (const obj of heroInvent()) {
                    if (dogfood(mtmp, obj) === DOGFOOD) { // -> obj_resists rn2(100)
                        appr = 1;
                        break;
                    }
                }
                if (appr === 0 && nearMagicPortal())
                    appr = 1;
            }
        }
    } else {
        appr = 1;
    }
    if (mtmp.mconf) appr = 0;

    // C ref: dogmove.c:610-644 — when the goal is the hero's square but the pet
    // is OUT of the master's sight, the pet can't see the hero, so it follows
    // the hero's footprint track (gettrack) instead of beelining to the (now
    // unknown) hero position.  Falls back to the pet's remembered previous goal
    // (edog.ogoal) or, failing that, the nearest square it can see toward the
    // hero (do_clear_area + wantdoor).  This consumes NO RNG but changes the
    // goal, which is what feeds the pet's mfndpos/jv candidate selection.
    const FARAWAY = COLNO + 2;
    if (g.gx === u.ux && g.gy === u.uy && !in_masters_sight) {
        const cp = gettrack(omx, omy);
        if (cp) {
            g.gx = cp.x; g.gy = cp.y;
            edog.ogoal = { x: 0, y: 0 };
        } else if (edog.ogoal && edog.ogoal.x
                   && (edog.ogoal.x !== omx || edog.ogoal.y !== omy)) {
            g.gx = edog.ogoal.x; g.gy = edog.ogoal.y;
            edog.ogoal = { x: 0, y: 0 };
        } else {
            let fardist = FARAWAY * FARAWAY;
            g.gx = g.gy = FARAWAY;
            const best = { x: FARAWAY, y: FARAWAY, d: fardist };
            do_clear_area_wantdoor(omx, omy, 9, best);
            g.gx = best.x; g.gy = best.y;
            if (g.gx === FARAWAY || (g.gx === omx && g.gy === omy)) {
                g.gx = u.ux; g.gy = u.uy;
            } else {
                edog.ogoal = { x: g.gx, y: g.gy };
            }
        }
    } else {
        edog.ogoal = { x: 0, y: 0 };
    }
    return appr;
}

// C ref: vision.c do_clear_area(scol, srow, range, wantdoor, &fardist).  When
// the center is NOT the hero (always true for the pet), C forwards to
// view_from(srow, scol, (seenV**)0, 0, 0, range, func, arg), which runs the
// full shadow-casting field-of-view sweep from the pet's square and calls the
// wantdoor client on every square the pet could see (in the sweep's discovery
// order).  wantdoor keeps the visited square closest to the hero (min distu),
// breaking ties toward the first-visited square (strict `>`).  We now drive the
// real view_from (routing mark_visible_range through the func) instead of the
// old per-square clear_path approximation, so the goal matches C exactly.
function do_clear_area_wantdoor(scol, srow, range, best) {
    const u = game.u;
    // C ref: dogmove.c wantdoor() — *dist_ptr > distu(x,y) ? keep (x,y).
    view_from(srow, scol, null, null, null, range, (x, y) => {
        const ndist = dist2(x, y, u.ux, u.uy);
        if (best.d > ndist) { best.d = ndist; best.x = x; best.y = y; }
    }, best);
}

function DDIST(x, y, ox, oy) { return dist2(x, y, ox, oy); }

// C ref: dogmove.c cursed_object_at(x,y).
function cursed_object_at(x, y) {
    return objectsAt(x, y).some((o) => o.cursed);
}

// --- monster capability predicates used by could_reach_item/can_reach_location.
// C ref: mondata.h flag macros.  These were HARDCODED pmidx SETS written when
// makemon's records were believed to carry no mflags; monflags_data.js now
// exposes the machine-generated tables, so read the real bits.  The index lists
// were also wrong in the usual way: CRI_TUNNELS_PMIDX had 9 entries where
// M1_TUNNEL covers 20+ species, and CRI_ROCKTHROW_PMIDX listed 10 where
// M2_ROCKTHROW covers every giant plus the titans/minotaur/Cyclops.
function cri_passes_walls(d) { return passes_walls_flag(d); }
function cri_tunnels(d) { return (mflags1_of(d) & M1_TUNNEL) !== 0; }
function cri_throws_rocks(d) { return throws_rocks_flag(d); }
// C ref: mondata.h is_swimmer(ptr) = (mflags1 & M1_SWIM).  A constant FALSE
// here made could_reach_item() refuse every water square for an eel/kraken pet
// (and, via can_reach_location, refuse to path through one).
function cri_is_swimmer(d) { return is_swimmer_flag(d); }
// C ref: mondata.h likes_lava(ptr) — the fire elemental and the salamander are
// the only two species (mondata.h names them explicitly, it is not a flag).
function cri_likes_lava(d) {
    return d?.name === 'fire elemental' || d?.name === 'salamander';
}
function cri_is_pool(x, y) {
    const t = game.level?.at(x, y)?.typ;
    return t === POOL || t === MOAT || t === WATER;
}
function cri_is_lava(x, y) {
    const t = game.level?.at(x, y)?.typ;
    return t === LAVAPOOL || t === LAVAWALL;
}
function cri_Is_rogue_level() {
    const uz = game.u?.uz, rl = game.rogue_level;
    return !!uz && !!rl && uz.dnum === rl.dnum && uz.dlevel === rl.dlevel;
}

// C ref: dogmove.c could_reach_item(mon, nx, ny) — can a monster pick up an
// object at (nx,ny)?  FALSE on water (unless swimmer), lava (unless lava-liker),
// or under a boulder (unless rock-thrower).
export function could_reach_item(mon, nx, ny) {
    const d = mon.data;
    return (!cri_is_pool(nx, ny) || cri_is_swimmer(d))
        && (!cri_is_lava(nx, ny) || cri_likes_lava(d))
        && (!sobj_at(BOULDER, nx, ny) || cri_throws_rocks(d));
}

// C ref: dogmove.c can_reach_location(mon, mx, my, fx, fy) — recursive check
// that a monotonically-closer path of reachable, non-obstructed squares connects
// the monster at (mx,my) to the item at (fx,fy).  Max item distance is 5, so the
// recursion is at most 5 deep.
function can_reach_location(mon, mx, my, fx, fy) {
    if (mx === fx && my === fy) return true;
    if (!isok(mx, my)) return false;
    const dist = dist2(mx, my, fx, fy);
    const d = mon.data;
    for (let i = mx - 1; i <= mx + 1; i++) {
        for (let j = my - 1; j <= my + 1; j++) {
            if (!isok(i, j)) continue;
            if (dist2(i, j, fx, fy) >= dist) continue;
            const typ = game.level?.at(i, j)?.typ;
            if (IS_OBSTRUCTED(typ) && !cri_passes_walls(d)
                && (!may_dig(i, j) || !cri_tunnels(d) || cri_Is_rogue_level()))
                continue;
            if (IS_DOOR(typ)) {
                const dm = game.level?.at(i, j)?.doormask || 0;
                if (dm & (D_CLOSED | D_LOCKED)) continue;
            }
            if (!could_reach_item(mon, i, j)) continue;
            if (can_reach_location(mon, i, j, fx, fy)) return true;
        }
    }
    return false;
}

// C ref: include/vision.h — m_cansee(mtmp,x,y) == clear_path(mx,my,x,y) and
// couldsee(x,y) is the hero's COULD_SEE viz bit.  These gate the pet's APPORT
// object-fetch branch in dog_goal; using the real vision results (instead of a
// blanket "always sees") keeps the obj_resists/rn2(8) stream matching C when an
// object is in the pet's search box but not on a clear line of sight.
//
// Gated behind PET_REAL_VISION, which is TRUE — so both read the real vision
// state; the `: true` arms are dead unless the constant is flipped back.
function couldsee(x, y) { return PET_REAL_VISION ? visCouldsee(x, y) : true; }
export function m_cansee(mtmp, x, y) {
    return PET_REAL_VISION ? clear_path(mtmp.mx, mtmp.my, x, y) : true;
}
function isLit(x, y) { return !!game.level?.at(x, y)?.lit; }

// C ref: mon.c can_carry(mtmp, otmp) uses otmp->owt directly.  mkobj.js
// weight() now computes a C-exact owt for every object (containers = base +
// contents, the heavy single items keep their real oc_weight), so the
// can_carry load check reads obj.owt straight.  A defensive Math.max(1, ...)
// keeps a never-weighed object (owt unset) from reading as 0.
function objWeight(obj) {
    return Math.max(1, obj.owt ?? 1);
}

// C ref: mon.c curr_mon_load(mtmp) — sum of minvent weights, excluding a
// BOULDER unless the monster throws_rocks (none of the starting pets do).
function curr_mon_load(mtmp) {
    let load = 0;
    for (const obj of mtmp.minvent || []) {
        if (obj.otyp !== BOULDER || cri_throws_rocks(mtmp.data)) load += objWeight(obj);
    }
    return load;
}

// C ref: mon.c can_carry(mtmp, otmp).  Returns 0 (cannot) or a positive
// quantity.  The dog_goal APPORT branch only cares whether the result is > 0.
//
// NOTE on PET_MAXLOAD: it is a three-entry subset table with a `?? 51` default,
// i.e. exactly the shape this sweep hunts.  It is NOT a defect to dedupe blind:
// js/mon.js owns a full max_mon_load()/can_carry(), and replacing this local
// copy with it measured -2296 screens (see the pet-pmidx-convention note) —
// dog.js pets carry no cwt/msize and a non-makemon pmidx, so the shared
// predicate answers wrongly for them.  Leave the table; fix the pet records.
export function can_carry(mtmp, obj) {
    const pmidx = mtmp.data?.pmidx;
    const maxload = PET_MAXLOAD[pmidx] ?? 51;
    const iquan = obj.quan || 1;
    // C ref: mon.c:2007 — notake(mdat) == (mflags1 & M1_NOTAKE).
    if ((mflags1_of(mtmp.data) & M1_NOTAKE) !== 0) return 0;
    // C ref: mon.c:2010 can_touch_safely() — a monster without gloves won't
    // pick up a cockatrice corpse it isn't stoning-proof against, nor (for a
    // silver-hater) a silver item.  These two are the reachable cases.
    if (obj.otyp === CORPSE && flesh_petrifies_data(monster_by_pmidx(obj.corpsenm))
        && !resists_ston_mon(mtmp)) return 0;
    // C ref: mon.c:2020-2038 — a NOHANDS non-glomper takes exactly 1 of a stack,
    // BEFORE the steed/shk/load checks.
    if (iquan > 1) {
        const glomper = mtmp.data?.mcls === S_DRAGON
            ? (obj.oclass === COIN_CLASS || obj.oclass === GEM_CLASS)
            : attacktype(mtmp.data, AT_ENGL);
        if (nohands(mtmp.data) && !glomper) return 1;
    }
    // C ref: mon.c:2039-2040 — "steeds don't pick up stuff (to avoid shop
    // abuse)".  Missing here (js/mon.js's copy has it), which mattered the
    // moment dog_move stopped bailing out early for a ridden steed: the steed
    // would apport items off the hero's own square every turn of riding.
    if (mtmp === game.u?.usteed) return 0;
    if (mtmp.isshk) return iquan; // no limit
    if (mtmp.mpeaceful && !mtmp.mtame) return 0;
    // C ref: mon.c:2050 — boulder throwers carry unlimited boulders.
    if (cri_throws_rocks(mtmp.data) && obj.otyp === BOULDER) return iquan;
    // C ref: mon.c:2054 — nymphs take anything but rocks/statues.
    if (mtmp.data?.mcls === S_NYMPH)
        return (obj.oclass === ROCK_CLASS) ? 0 : iquan;
    // single object: load capacity check against what the pet already carries.
    if (curr_mon_load(mtmp) + objWeight(obj) > maxload) return 0;
    return iquan;
}
// C ref: monflag.h M1_NOTAKE; defsym.h S_DRAGON / S_NYMPH; monattk.h AT_ENGL.
const M1_NOTAKE = 0x00000800, GEM_CLASS = 9;

// C ref: dogmove.c find_targ(mtmp, dx, dy, maxdist) — walk a straight line from
// the pet, returning the first visible monster (or the hero, sentinel
// HERO_TARG) within maxdist; stops at the first square the pet can't see
// (clear_path).  Returns the target monster, the HERO_TARG sentinel, or null.
const HERO_TARG = Symbol('youmonst');
function find_targ(mtmp, dx, dy, maxdist) {
    let curx = mtmp.mx, cury = mtmp.my;
    for (let dist = 0; dist < maxdist; dist++) {
        curx += dx; cury += dy;
        if (!isok(curx, cury)) break;
        if (!m_cansee(mtmp, curx, cury)) break;
        // pet thinks the hero is at mux,muy.
        if (curx === mtmp.mux && cury === mtmp.muy) return HERO_TARG;
        const targ = MON_AT(curx, cury);
        if (targ) {
            // C ref: dogmove.c:682-684 — `(!targ->minvis || perceives(mtmp->data))
            // && !targ->mundetected && targ->mx == curx && targ->my == cury`.
            // The perceives() half was dropped, so a see-invisible pet ignored
            // every invisible target (and skipped its score_targ rnd(5)); the
            // head-vs-tail test was dropped too, so a long worm's TAIL square
            // was accepted as the target.
            if ((!targ.minvis || perceives_flag(mtmp.data)) && !targ.mundetected
                && targ.mx === curx && targ.my === cury)
                return targ;
            // can't see it -> assume not there, keep walking.
        }
    }
    return null;
}

// C ref: dogmove.c find_friends(mtmp, mtarg, maxdist) — is the hero or a pet in
// line beyond mtarg (so the pet would shoot through a friend)?  Returns true if
// so.  For the contest pets this gates the score_targ early-return (no rnd(5)).
function find_friends(mtmp, mtarg, maxdist) {
    const tx = mtarg.mx, ty = mtarg.my;
    const dx = Math.sign(tx - mtmp.mx), dy = Math.sign(ty - mtmp.my);
    let curx = tx, cury = ty;
    let dist = distmin(tx, ty, mtmp.mx, mtmp.my);
    for (; dist <= maxdist; dist++) {
        curx += dx; cury += dy;
        if (!isok(curx, cury)) return false;
        if (!m_cansee(mtmp, curx, cury)) return false;
        if (mtmp.mux === curx && mtmp.muy === cury) return true; // hero behind
        const pal = MON_AT(curx, cury);
        if (pal) {
            if (pal.mtame) {
                // C ref: dogmove.c:724 — `!pal->minvis || perceives(mtmp->data)`.
                if (!pal.minvis || perceives_flag(mtmp.data)) return true;
            } else {
                // C ref: dogmove.c:728 — `pal->data->msound == MS_LEADER ||
                // MS_GUARDIAN`.  This was ported as a comparison of
                // `pal.data.msound` against the STRINGS 'leader'/'guardian';
                // makemon's records carry no `msound` field at all (it lives in
                // monflags_data's MSOUND table, keyed by pmidx), so the test was
                // dead — every quest leader/guardian standing behind a target
                // read as "not a friend" and the pet happily shot through it.
                const ms = msound_of(pal.data);
                if (ms === MS_LEADER || ms === MS_GUARDIAN) return true;
            }
        }
    }
    return false;
}

// C ref: dogmove.c score_targ(mtmp, mtarg) — desirability of a ranged target.
// Two RNG side-effects, not one: the `score += rnd(5)` fuzz roll at
// dogmove.c:830 (which only executes when the target survives the early
// returns), and the pair of confused-pet rn2(3) rolls at :748 and :832.  The
// numeric score decides which target best_target() picks, which in turn decides
// whether dog_move's floating-eye/cube branch calls best_target at all.
function score_targ(mtmp, mtarg) {
    let score = 0;
    // C ref: dogmove.c:748 — `if (!mtmp->mconf || !rn2(3) || Is_qstart(&u.uz))`.
    // The `!rn2(3)` half was dropped as "starting pets aren't confused", but a
    // pet CAN be confused (dog_hunger sets mconf, so does a potion/trap), and
    // then C draws rn2(3) here for every lined-up target before anything else.
    const qstart = false; // Is_qstart(&u.uz): the quest home level, not modelled
    if (!mtmp.mconf || !rn2(3) || qstart) {
        // quest friendlies: never targeted (no rnd(5)).  Read the real MSOUND
        // table, not a nonexistent `data.msound` string field.
        const tms = (mtarg !== HERO_TARG) ? msound_of(mtarg.data) : undefined;
        if (tms === MS_LEADER || tms === MS_GUARDIAN) return -5000;
        // C ref: dogmove.c:771 — a coaligned peaceful priest/minion is spared.
        // (isminion/ispriest alignment is not tracked on our monsters, so the
        //  branch reduces to false; it draws no RNG either way.)
        // adjacent monster -> melee range, not a ranged target (no rnd(5)).
        if (mtarg !== HERO_TARG
            && distmin(mtmp.mx, mtmp.my, mtarg.mx, mtarg.my) <= 1)
            return -3000;
        // tame monster or the hero -> never targeted (no rnd(5)).
        if (mtarg === HERO_TARG || mtarg.mtame) return -3000;
        // friend (hero / pet) behind the target -> don't shoot through (no rnd).
        if (find_friends(mtmp, mtarg, 15)) return -3000;
        // Target hostile monsters in preference to peaceful ones.
        if (!mtarg.mpeaceful) score += 10;
        // C ref: dogmove.c:795 — a wholly passive target isn't worth the breath.
        if (mattk0_is_none(mtarg.data)) score -= 1000;
        const m_lev = mtarg.m_lev ?? mtarg.data?.mlevel ?? 0;
        const my_lev = mtmp.m_lev ?? mtmp.data?.mlevel ?? 0;
        const ulevel = game.u?.ulevel ?? 1;
        // C ref: dogmove.c:799-802 — don't waste breath on lichens.
        if ((m_lev < 2 && my_lev > 5)
            || (my_lev > 12 && m_lev < my_lev - 9
                && ulevel > 8 && m_lev < ulevel - 7))
            score -= 25;
        // C ref: dogmove.c:808-818 — a vampshifter in weak form fights as if it
        // were in vampire form, which costs an rn2(mtmp_lev/2 + 1).  cham is the
        // shifter's true species index; our monsters carry it when shapeshifted.
        let mtmp_lev = my_lev;
        if (is_vampshifter_mon(mtmp) && mtmp.data?.mcls !== S_VAMPIRE) {
            mtmp_lev = monster_by_pmidx(mtmp.cham)?.mlevel ?? my_lev;
            mtmp_lev += rn2(Math.trunc(mtmp_lev / 2) + 1);
            if (my_lev > mtmp_lev) mtmp_lev = my_lev;
        }
        // C ref: dogmove.c:821 — hesitate to attack vastly stronger foes.
        if (m_lev > mtmp_lev + 4) score -= (m_lev - mtmp_lev) * 20;
        // All things equal, go for the beefiest monster.
        score += m_lev * 2 + Math.trunc((mtarg.mhp ?? 0) / 3);
    }
    // Fuzz factor (dogmove.c:830) — the roll the post-dismount stream needs.
    score += rnd(5);
    // C ref: dogmove.c:832 — a confused pet may decide not to shoot after all.
    // A SECOND rn2(3) that the old port never drew.
    if (mtmp.mconf && !rn2(3)) score -= 1000;
    return score;
}
// C ref: dogmove.c:795 — `mtarg->data->mattk[0].aatyp == AT_NONE`, i.e. the
// target is purely passive (a mold/jelly whose only "attack" is retaliation).
// AT_NONE only ever occupies slot 0 in mons[], so an any-slot AT_NONE search is
// equivalent; a monster with no attack table at all also has mattk[0] zeroed.
function mattk0_is_none(ptr) {
    return attacktype(ptr, AT_NONE) || !attacktype(ptr, AT_ANY);
}

// C ref: dogmove.c best_target(mtmp, forced) — scan the 8 directions (dy outer,
// dx inner) for the first lined-up target and pick the highest score_targ.  The
// rnd(5) inside score_targ fires once per qualifying lined-up target.
function best_target(mtmp, forced) {
    if (!mtmp) return null;
    if (!mtmp.mcansee) return null; // blind pet sees no target (no rnd(5))
    let bestscore = -40000, best = null;
    for (let dy = -1; dy < 2; dy++) {
        for (let dx = -1; dx < 2; dx++) {
            if (!dx && !dy) continue;
            const temp = find_targ(mtmp, dx, dy, 7);
            if (!temp) continue;
            const currscore = score_targ(mtmp, temp);
            if (currscore > bestscore) { bestscore = currscore; best = temp; }
        }
    }
    // C ref: dogmove.c:881 — `if (!forced && bestscore < 0L) best_targ = 0;`.
    if (!forced && bestscore < 0) best = null;
    return best;
}

// C ref: dogmove.c pet_ranged_attk(mtmp, forced) — the pet's ranged-attack
// consideration run at the end of dog_move.  best_target() rolls the score_targ
// rnd(5) fuzz (and, for a confused pet, two rn2(3)s) per lined-up target.
// The `hungry` test used DOG_HUNGRY spelled 500; dogmove.c:10 defines it as
// 300 (500 is DOG_WEAK), so the rn2(5) "hungry pets rarely breathe" roll was
// suppressed for the 200-move window between the two thresholds.
async function pet_ranged_attk(mtmp, forced) {
    const edog = mtmp.edog;
    const hungry = (!mtmp.isminion && edog)
        ? ((game.moves || 1) > ((edog.hungrytime || 0) + DOG_HUNGRY)) : false;
    const mtarg = best_target(mtmp, forced);
    if (mtarg && (!hungry || !rn2(5))) {
        // DEFERRED (measured -1500 public when wired up): C calls
        // mattackm(mtmp, mtarg) here.  For a melee-only pet at range that makes
        // no attack and returns M_ATTK_MISS, but it is not a no-op — it sets
        // magr->mlstmv = moves and clears a confused/helpless defender's
        // msleeping.  js/mhitm.js's mattackm does not reproduce C's range
        // short-circuit (it draws to-hit rolls the C never makes at distmin > 1),
        // so calling it here desyncs; fixing mhitm.js's distance gate is a
        // prerequisite and belongs to that file's pass.
        const mstatus = M_ATTK_MISS;
        // C ref: dogmove.c:962 — only a pet that actually attacked loses its move.
        if (mstatus !== M_ATTK_MISS) return MMOVE_DONE;
    }
    // C ref: dogmove.c:964 — `else if (forced) domonnoise(mtmp);` (forced is
    // FALSE at dog_move's only call site).
    return MMOVE_NOTHING;
}

// C ref: dogmove.c dog_move(mtmp, after).  Drives one pet move.
export async function dog_move(mtmp, after) {
    const edog = mtmp.edog;
    // C ref: dogmove.c:1004 — only `!edog && !mtmp->isminion` is an error; a
    // tame Angel (isminion, ispriest structure, no edog) runs the whole of
    // dog_move with edog == 0, taking the guardian arms of dog_goal and the
    // candidate loop.  Bailing out here makes a tame minion motionless.
    if (!edog) return MMOVE_NOTHING;

    const omx = mtmp.mx, omy = mtmp.my;
    // C ref: dogmove.c:1011 — `if (edog && dog_hunger(mtmp, edog)) return
    // MMOVE_DIED;`.  This ran nowhere before, so a pet never went from hungry to
    // weak to starved: edog->mhpmax_penalty stayed 0 (dogfood()'s `starving`
    // arm was dead code), mtmp->mconf was never set from hunger, and mhpmax was
    // never cut, so the pet's `balk` / max_passive_dmg comparisons in the
    // ALLOW_M branch read a health it should no longer have.
    if (await dog_hunger(mtmp, edog)) return MMOVE_DIED; // starved

    let udist = distu(omx, omy);
    // C ref: dogmove.c:1015-1025 — a RIDDEN steed does not get the `!udist`
    // bail-out: distu() is 0 (it is standing under the hero), and C instead
    // forces udist = 1 and runs the rest of dog_move for it.  Returning
    // MMOVE_NOTHING here skipped dog_invent() entirely for the steed, so every
    // turn of riding dropped the steed's underfoot dogfood()/rn2(100), its
    // drop rolls (rn2(2)/rn2(apport)/rn2(10)) and its pickup rolls.  dog_goal()
    // still returns -2 for the steed a few lines further down, which is what
    // stops it choosing its own destination.
    if (mtmp === game.u?.usteed) {
        // (Conflict is not modelled, so the dismount_steed(DISMOUNT_THROWN)
        //  branch above it cannot fire.)
        udist = 1;
    } else if (!udist) {
        return MMOVE_NOTHING; // swallowed-and-tamed case
    }

    let nix = omx, niy = omy;

    // dog_invent: object underfoot / carrying.  May consume the move (eat).
    // C ref: dogmove.c:1032-1036 — j==2 (died eating) -> MMOVE_DIED/MMOVE_DONE,
    // j==1 (ate) -> `goto newdogpos`, which with nix==omx/niy==omy falls out of
    // the bottom as MMOVE_MOVED (NOT MMOVE_DONE): m_move's postmov() therefore
    // still runs newsym + mintrap on the pet's square, and a pet that ate while
    // standing on a known trap owes trap.c its rn2(4).
    const j0 = await dog_invent(mtmp, edog, udist);
    if (j0 === 2) return (mtmp.mhp != null && mtmp.mhp <= 0) ? MMOVE_DIED : MMOVE_DONE;
    if (j0 === 1) {
        newsym(omx, omy);
        const tr = await mon_mintrap(mtmp);
        if (tr === Trap_Killed_Mon) { newsym(mtmp.mx, mtmp.my); return MMOVE_DIED; }
        newsym(mtmp.mx, mtmp.my);
        return MMOVE_MOVED; // ate something
    }

    const whappr = ((game.moves || 1) - edog.whistletime) < 5;

    const g = {};
    const appr = dog_goal(mtmp, edog, after, udist, whappr, g);
    if (appr === -2) return MMOVE_NOTHING;

    // C ref: dogmove.c:1046
    if (Conflict() && !resist_conflict(mtmp)) {
        // (guardian-angel arm needs !edog; every pet here has an edog)
    }

    // C ref: dogmove.c:1062-1063 — `allowflags = mon_allowflags(mtmp); cnt =
    // mfndpos(mtmp, &mfp, allowflags);`.  A tame monster's bitmask (monmove.js
    // mon_allowflags()) is ALLOW_M|ALLOW_TRAPS|ALLOW_SANCT|ALLOW_SSM plus any
    // species-specific bits (wall-walk/dig/unicorn/undead/...) — ALLOW_M keeps
    // monster-occupied adjacent squares in the candidate list so the pet can
    // melee a hostile monster, and ALLOW_TRAPS keeps harmful-trap squares
    // (flagged in poss[i].info) so the pet can roll the "step onto it anyway"
    // chance below.
    const poss = mfndpos(mtmp, mon_allowflags(mtmp));
    const cnt = poss.length;

    // Count uncursed-item squares (for the cursed-item avoidance roll).  C ref
    // dogmove.c:1070-1077 — a monster-occupied square without ALLOW_M/ALLOW_MDISP
    // is skipped.  mon_allowflags() gives every tame monster ALLOW_M, so the
    // skip cannot fire here and the loop reduces to the cursed-object test.
    // C ref: dogmove.c:1080 — `better_with_displacing = should_displace(...)`
    // and the ALLOW_MDISP arm of the candidate loop are omitted: mfndpos only
    // sets ALLOW_MDISP for is_displacer(ptr) (the displacer beast), and with no
    // displacing candidate should_displace() is FALSE for every other monster.
    // Neither draws RNG, so this is inert until a displacer beast is tamed.
    let uncursedcnt = 0;
    for (let i = 0; i < cnt; i++) {
        const { x: nx, y: ny } = poss[i];
        if (cursed_object_at(nx, ny)) continue;
        uncursedcnt++;
    }

    let chcnt = 0, chi = -1;
    let nidist = GDIST(nix, niy, g);
    const k = uncursedcnt; // edog ? uncursedcnt : cnt
    const mtrack = mtmp.mtrack || [];
    // C ref: dogmove.c:1175 do_eat / `obj` — when the candidate scan finds food,
    // C records the object and jumps to newdogpos, where (after moving) it calls
    // dog_eat(mtmp, obj, ...).  We must do the same: the eat consumes the corpse
    // and rolls its own RNG (dogfood reward-check + delobj obj_resists).
    let do_eat = false, eat_obj = null;
    // C ref: dogmove.c:1090 — cursemsg[i] tracks whether candidate square i holds
    // a cursed object; consulted at newdogpos to emit the "<pet> steps reluctantly
    // onto <object>" topline for the square the pet actually moves onto (chi).
    const cursemsg = new Array(cnt).fill(false);

    for (let i = 0; i < cnt; i++) {
        const nx = poss[i].x, ny = poss[i].y;

        // C ref: dogmove.c:1093 — a leashed pet is dragged along: any candidate
        // square more than distu 4 from the hero is dropped outright.  Omitted
        // before as "never applies to the starting pets"; the hero can apply a
        // leash to any pet, and dropping a candidate changes the rn2(++chcnt)
        // sequence for every square after it.
        if (mtmp.mleashed && distu(nx, ny) > 4) continue;
        // C ref: dogmove.c:1097 — the guardian-angel (edog-less) proximity skip.
        // dog_move returns early without an edog in this port, so it cannot fire.

        // C ref: dogmove.c:1102 — ALLOW_M: the pet melees an adjacent monster.
        // A monster square either triggers an attack (return) or the pet balks
        // and the square is skipped entirely (C `continue`); either way it never
        // reaches the cursed-object / backtrack / distance logic below.
        const mtmp2 = MON_AT(nx, ny);
        if (mtmp2) {
            const r = await dog_attack_mon(mtmp, mtmp2, omx, omy, after);
            if (r !== null) return r; // attacked -> done with this move
            continue;                 // balked -> next candidate square
        }

        // C ref: dogmove.c:1183 — the pet avoids the square the hero just
        // kicked (gk.kickedloc, set for the kick turn, cleared next action).
        // The skipped square never reaches the rn2(++chcnt) tie-break, so the
        // pet's candidate count matches C (seed0060: kitten cnt 4 -> 3).
        // m_avoid_soko_push_loc (dogmove.c:1185) is Sokoban-only and never
        // triggers on the contest's non-Sokoban levels.
        if (m_avoid_kicked_loc(mtmp, nx, ny)) continue;

        // C ref: dogmove.c:1188 — the dog avoids a harmful trap it can see, but
        // might have to cross one to follow the hero: a *seen* trap gives a 39/40
        // chance to skip the square (rn2(40)); 1/40 it steps on anyway.  Only
        // squares mfndpos flagged ALLOW_TRAPS (harmful) reach here.
        // C ref: dogmove.c:1198-1209 — a LEASHED pet whimpers (a topline, via
        // sounds.c whimper -> "You hear a <whine>") and does NOT skip the
        // square: it is dragged over the trap.  The old `&& !mtmp.mleashed`
        // guard collapsed both arms into "no skip, no message".
        if ((poss[i].info & ALLOW_TRAPS_F)) {
            const trap = t_at(nx, ny);
            if (trap) {
                if (mtmp.mleashed) {
                    if (!game.u?.udeaf)
                        await emit_pet_msg(`${noit_Monnam(mtmp)} whimpers.`);
                } else if (trap.tseen && rn2(40)) {
                    continue;
                }
            }
        }

        // dog eschews cursed objects, likes dog food: scan objects at <nx,ny>.
        // C ref: dogmove.c:1215 — `can_reach_food` is computed ONCE per
        // candidate square and short-circuits the dogfood() call itself
        // (`can_reach_food && (otyp = dogfood(...)) < MANFOOD`).  Without it a
        // square the pet cannot physically reach — a pool/lava square it can't
        // swim in, or one holding a boulder it can't throw — still burned one
        // obj_resists rn2(100) per object lying there, so every roll from that
        // candidate onward (the rn2(++chcnt) tie-break included) read one slot
        // late.
        const can_reach_food = could_reach_item(mtmp, nx, ny);
        let ate = false;
        for (const obj of objectsAtNexthere(nx, ny)) {
            if (obj.cursed) { cursemsg[i] = true; continue; }
            if (!can_reach_food) continue;
            const otyp = dogfood(mtmp, obj); // -> obj_resists rn2(100)
            if (otyp < MANFOOD
                && (otyp < ACCFOOD || edog.hungrytime <= (game.moves || 1))) {
                nix = nx; niy = ny; chi = i; ate = true;
                do_eat = true; eat_obj = obj;
                cursemsg[i] = false; // C ref: dogmove.c:1230 — not reluctant
                break;
            }
        }
        if (ate) break; // goto newdogpos (eating)

        // saw a cursed item and not forced onto it -> usually keep looking.
        // C ref: dogmove.c:1237 — `&& !mtmp->mleashed`: a leashed pet has no
        // choice and skips the rn2(13*uncursedcnt) roll entirely.
        if (cursemsg[i] && !mtmp.mleashed && uncursedcnt > 0
            && rn2(13 * uncursedcnt))
            continue;

        // backtrack avoidance (only when far from the hero, and not leashed —
        // C ref: dogmove.c:1246 `!mtmp->mleashed &&`).
        if (!mtmp.mleashed && distmin(omx, omy, game.u.ux, game.u.uy) > 5) {
            let skip = false;
            for (let jj = 0; jj < MTSZ && jj < k - 1; jj++) {
                const t = mtrack[jj];
                if (t && nx === t.x && ny === t.y) {
                    if (rn2(MTSZ * (k - jj))) { skip = true; break; }
                }
            }
            if (skip) continue;
        }

        const ndist = GDIST(nx, ny, g);
        const jv = (ndist - nidist) * appr;
        if ((jv === 0 && !rn2(++chcnt)) || jv < 0
            || (jv > 0 && !whappr
                && ((omx === nix && omy === niy && !rn2(3)) || !rn2(12)))) {
            nix = nx; niy = ny; nidist = ndist;
            if (jv < 0) chcnt = 0;
            chi = i;
        }
    }

    // C ref: dogmove.c:1273 — pet_ranged_attk(mtmp, FALSE) runs after the
    // candidate loop.  best_target()'s score_targ rolls rnd(5) for each
    // non-adjacent, non-tame, hostile target lined up within 7 visible squares,
    // which is RNG the move stream depends on even though the contest pets never
    // actually fire a ranged attack.  A non-NOTHING result short-circuits.
    // NOTE: when the candidate scan found food it `goto newdogpos` in C, jumping
    // PAST pet_ranged_attk, so we only run it when the pet isn't eating.
    if (!do_eat) {
        const r = await pet_ranged_attk(mtmp, false);
        if (r !== MMOVE_NOTHING) return r;
    }

    // newdogpos:
    if (nix !== omx || niy !== omy) {
        // C ref: dogmove.c:1280-1288 — `if (mfp.info[chi] & ALLOW_U)` the pet
        // attacks the HERO (mattacku) instead of moving, breaking its leash
        // first.  Unreachable in this port: monmove.js mon_allowflags() only
        // sets ALLOW_U for a non-tame, non-peaceful monster (C also sets it via
        // `Conflict && !resist_conflict`, and Conflict is not modelled), so a
        // pet's info[] can never carry the bit.  Wiring it needs mattacku().
        // C ref: dogmove.c:1289-1292 — m_in_out_region() (a level-region
        // crossing, e.g. a gas cloud boundary) can abort the move with
        // MMOVE_MOVED, and m_digweapon_check() can make the pet stop to wield a
        // digging tool (MMOVE_NOTHING).  Both are hostile-monster machinery this
        // port does not run for pets; see the deferred list.

        // C ref: dogmove.c:1280-1288 — pet attacks the HERO (Conflict ALLOW_U).
        if (chi >= 0 && (poss[chi].info & ALLOW_U)) {
            await mattacku(mtmp, mtmp.data);
            return MMOVE_DONE;
        }

        // C ref: dogmove.c:1295 — wasseen captured before the move (old square),
        // then re-checked at the new square, for the reluctant-step topline.
        const wasseen = canseemon(mtmp);
        mtmp.mtrack = [{ x: omx, y: omy }, ...mtrack].slice(0, MTSZ);
        mtmp.mx = nix; mtmp.my = niy;
        // C ref: dogmove.c:1298 — "<pet> steps reluctantly onto <object>." when
        // the pet moves onto a square whose (topmost) object is cursed and it is
        // (or was) in view.  In C the pline fires inside dog_move (before the tty
        // redraw); it sets the topline NEED_MORE but does not block on its own.
        // Skipped when the pet ate the food underfoot.
        if (chi >= 0 && cursemsg[chi] && (wasseen || canseemon(mtmp))) {
            const verb = vtense(locomotion(mtmp.data, 'step')); // "steps"
            const over = is_flyer(mtmp.data) || is_floater(mtmp.data);
            const what = reluctant_what(nix, niy);
            await emit_pet_msg(`${noit_Monnam(mtmp)} ${verb} reluctantly ${over ? 'over' : 'onto'} ${what}.`);
        }
        // C ref: monmove.c postmov():1508 — the tty redraw is deferred here (m_move
        // returns postmov(..., dog_move(...), ...)).  Clear the vacated square,
        // then run mintrap on the new square: a trap message (e.g. "<pet> is caught
        // in a bear trap!") pages the still-pending reluctant line with --More--,
        // and the trap's own RNG only fires once the prompt is dismissed.  The new
        // square is redrawn (pet painted over the object) only afterwards.
        newsym(omx, omy);
        const trapret = await mon_mintrap(mtmp);
        if (trapret === Trap_Killed_Mon) { newsym(nix, niy); return MMOVE_DIED; }
        newsym(nix, niy);
        // C ref: dogmove.c:1318 — after moving onto the food, the pet eats it.
        if (do_eat && eat_obj) {
            const r = await dog_eat(mtmp, edog, eat_obj, omx, omy);
            if (r === 2) return MMOVE_DIED;
        }
        return MMOVE_MOVED;
    }
    // C ref: dogmove.c:1354 — dog_move() falls through to `return MMOVE_MOVED`
    // even when the pet stays put (nix==omx && niy==omy).  m_move() routes that
    // through postmov() (monmove.c:1471,1508-1509), which ALWAYS runs
    // newsym(old-square) + mintrap() on the pet's CURRENT square when
    // mmoved==MMOVE_MOVED.  So a pet that (e.g.) escaped its bear trap this turn
    // (m_move mtrapped-escape) but then chose not to move is still standing on
    // that trap, and mintrap re-checks it: a trap the pet now knows -> rn2(4)
    // @ trap.c:3812 (walks over).  On a non-trap square mintrap is a no-op (no
    // RNG).  Returning MMOVE_MOVED also matches C's dochug switch, which for a
    // ranged-less pet returns 0 without reaching the attack step (phase_four).
    // The previous `return MMOVE_NOTHING` skipped this mintrap, dropping an
    // rn2(4) that C consumes and desyncing every later monster move that turn.
    //
    // C ref: dogmove.c:1322-1355 — the "incredible kludge": a LEASHED pet that
    // ended up more than distu 4 away (because it spent the turn eating, or was
    // stuck in a trap) is TELEPORTED to a good position next to the hero, trying
    // the straight-back square first and then the neighbouring directions.  It
    // draws no RNG (goodpos is deterministic) but it MOVES the pet, so the
    // rendered map and every later distance/mfndpos decision differ.
    if (mtmp.mleashed && distu(omx, omy) > 4) {
        const u = game.u;
        const sx = Math.sign(omx - u.ux), sy = Math.sign(omy - u.uy);
        let cx = u.ux + sx, cy = u.uy + sy;
        if (!leash_goodpos(mtmp, cx, cy)) {
            // C ref: xytodir/DIR_LEFT..DIR_RIGHT2 — the 8 compass directions in
            // mkroom.h order, scanned outward from the straight-back direction.
            const DIRS = [[0, -1], [1, -1], [1, 0], [1, 1],
                          [0, 1], [-1, 1], [-1, 0], [-1, -1]];
            const base = DIRS.findIndex(([dx, dy]) => dx === sx && dy === sy);
            let found = false;
            for (let off = -1; off <= 1 && !found; off++) {
                if (off === 0) continue;
                const d = DIRS[((base + off) % 8 + 8) % 8];
                const tx = u.ux + d[0], ty = u.uy + d[1];
                if (leash_goodpos(mtmp, tx, ty)) { cx = tx; cy = ty; found = true; }
            }
            for (let off = -2; off <= 2 && !found; off += 4) {
                const d = DIRS[((base + off) % 8 + 8) % 8];
                const tx = u.ux + d[0], ty = u.uy + d[1];
                if (leash_goodpos(mtmp, tx, ty)) { cx = tx; cy = ty; found = true; }
            }
            if (!found) { cx = mtmp.mx; cy = mtmp.my; }
        }
        const px = mtmp.mx, py = mtmp.my;
        mtmp.mx = cx; mtmp.my = cy;
        newsym(px, py);
        newsym(cx, cy);
        set_apparxy(mtmp);
        return MMOVE_MOVED;
    }
    newsym(omx, omy);
    const trapret = await mon_mintrap(mtmp);
    if (trapret === Trap_Killed_Mon) { newsym(mtmp.mx, mtmp.my); return MMOVE_DIED; }
    newsym(mtmp.mx, mtmp.my);
    return MMOVE_MOVED;
}

// C ref: dogmove.c dog_eat(mtmp, obj, x, y, devour=FALSE) — the pet eats a floor
// object it has just moved onto (or is standing on, from dog_invent).
//   - dog_nutrition(): no RNG; updates edog->hungrytime + mtmp->meating.
//   - splitobj() of a quan>1 food stack -> next_ident() -> rnd(2).
//   - the "<pet> eats <obj>." / "It eats <obj>." topline.
//   - the reward-apport dogfood() check (dogmove.c:315) -> obj_resists rn2(100).
//   - m_consume_obj() -> delobj() -> obj_resists(obj,0,0) rn2(100), then the
//     object is removed from the floor.
// STILL MISSING (all species/shop-specific, none reachable for a dog/cat/pony):
// the `devour` halving, bee_eat_jelly() for a killer bee eating royal jelly,
// the rust monster's oerodeproof "spits it out in disgust" branch, and the
// unpaid-item shop billing (suppress_price / unpaid_cost / costly_alteration).
// Returns 2 if the pet died, else 1.
export async function dog_eat(mtmp, edog, obj, x, y) {
    const moves = game.moves || 1;
    if (edog.hungrytime < moves) edog.hungrytime = moves;
    // dog_nutrition(): nutrit drives hungrytime; corpses use the species cnutrit
    // table, but only hungrytime (a non-RNG counter) depends on it, so a faithful
    // bump keeps later `hungrytime <= moves` food gates aligned.  We approximate
    // the nutrition with the corpse's species nutrition when available.
    edog.hungrytime += dog_nutrition(mtmp, obj);
    mtmp.mconf = 0;
    // C ref: dogmove.c:242-246 — eating ends starvation: the mhpmax penalty is
    // handed back.  Dropping it left mhpmax_penalty set forever once dog_hunger
    // had fired, so dogfood() kept answering `starving` (ACCFOOD for everything)
    // and dog_goal kept overriding the cursed-square skip.
    if (edog.mhpmax_penalty) {
        mtmp.mhpmax = (mtmp.mhpmax || 0) + edog.mhpmax_penalty;
        edog.mhpmax_penalty = 0;
    }
    if (mtmp.mflee && mtmp.mfleetim > 1) mtmp.mfleetim = Math.trunc(mtmp.mfleetim / 2);
    if ((mtmp.mtame || 0) < 20) mtmp.mtame = (mtmp.mtame || 0) + 1;
    // moved & ate on same turn: redraw the start and current squares.
    if (x !== mtmp.mx || y !== mtmp.my) { newsym(x, y); newsym(mtmp.mx, mtmp.my); }

    // C ref: dogmove.c:262-263 — food items are eaten ONE AT A TIME: a stack of
    // n>1 comestibles is split, which assigns the split piece a fresh o_id via
    // next_ident() -> rnd(2).  The old code ate (and deleted) the whole stack
    // and skipped that rnd(2), so a pet eating one of 3 tripe rations both
    // vanished the other two and shifted every later roll by one draw.
    if ((obj.quan || 1) > 1 && obj.oclass === FOOD_CLASS)
        obj = pet_splitobj(obj, 1);

    // C ref: dogmove.c:266-295.  A pet eating while in a pool prints nothing.
    // Otherwise the message depends on WHO is seen: the pet in view (or the food
    // in view and the pet spottable) names the pet; food-only in view is "It
    // eats <obj>." — that second form was missing entirely.
    if (!cri_is_pool(mtmp.mx, mtmp.my)) {
        const seeobj = cansee(mtmp.mx, mtmp.my);
        const sawpet = cansee(x, y) && canseemon(mtmp);
        const what = pet_doname(obj);
        if (sawpet || (seeobj && canspotmon(mtmp))) {
            // C ref: dogmove.c:286 — a tunneller "digs in" instead of eating.
            if (tunnels(mtmp.data))
                await emit_pet_msg(`${noit_Monnam(mtmp)} digs in.`);
            else
                await emit_pet_msg(`${noit_Monnam(mtmp)} eats ${what}.`);
        } else if (seeobj) {
            await emit_pet_msg(`It eats ${what}.`);
        }
    }

    // C ref: dogmove.c:315-331 — the reward-apport bump.  dogfood() is called
    // unconditionally (obj_resists rn2(100) fires either way), but when the food
    // is DOGFOOD *and the hero had held it* (obj->invlet set) the pet's apport
    // climbs by 200/(dropdist + moves - droptime).  apport is the modulus of
    // three later rolls (rn2(apport), rn2(10)<apport, rn2(20)<apport+3) and the
    // rn2(8) comparand in dog_goal, so never bumping it pinned a well-fed pet's
    // apport at its initial 3 forever.
    if (dogfood(mtmp, obj) === DOGFOOD && obj.invlet) {
        const denom = (edog.dropdist || 0) + moves - (edog.droptime || 0);
        edog.apport = edogApport(edog)
            + (denom !== 0 ? Math.trunc(200 / denom) : 200);
        if (edog.apport <= 0) edog.apport = 1; // C: impossible() + clamp
    }

    // C ref: m_consume_obj -> delobj(obj) -> delobj_core: obj_resists(obj,0,0)
    // rn2(100) guard, obj_extract_self() removes it from the floor, then (because
    // it was a floor object) `newsym(obj->ox, obj->oy)` repaints the vacated tile.
    // The final newsym is load-bearing: the pet is standing on the object's tile,
    // so newsym re-runs _map_location(x,y,FALSE) to refresh the tile's REMEMBERED
    // background glyph to the now-object-free terrain *under* the monster.  Without
    // it the tile keeps its stale corpse memory and redraws the eaten '%' once the
    // pet steps away and the square falls out of the hero's sight.
    obj_resists(obj, 0, 0); // rn2(100)
    const ox = obj.ox, oy = obj.oy;
    pet_extract_floor(obj);
    newsym(ox, oy);

    // C ref: dogmove.c:344 — return (DEADMONSTER(mtmp)) ? 2 : 1.
    return (mtmp.mhp != null && mtmp.mhp <= 0) ? 2 : 1;
}

// C ref: dogmove.c dog_nutrition(mtmp, obj) — no RNG, but BOTH outputs are
// load-bearing.  meating gates the pet's movement for that many m_move() calls
// (monmove.c:1745), and hungrytime decides when dog_hunger() confuses/starves
// the pet and when the `hungrytime <= moves` ACCFOOD gate in dog_move's
// candidate scan opens.  The old body returned a flat 50 for everything
// ("the precise value isn't observable"), which is off by 16x on a food ration
// and 40x on an 8 hp newt corpse — the two thresholds above are absolute, not
// relative, so the approximation moved them by hundreds of turns.
function dog_nutrition(mtmp, obj) {
    // C ref: dog_nutrition sets mtmp->meating (the digesting-occupation counter)
    // AND returns nutrit (the hungrytime bump).  meating gates the pet's movement
    // for the next few m_move() calls (monmove.c:1745), so it MUST be exact:
    //   corpse:    meating = 3 + (mons[corpsenm].cwt >> 6)
    //   other food: meating = objects[otyp].oc_delay
    // For a corpse, cwt < 64 (newt cwt 10) -> meating = 3.
    let nutrit;
    if (obj.oclass === FOOD_CLASS) {
        if (obj.otyp === CORPSE) {
            const cwt = mon_cwt(obj.corpsenm) ?? 0;
            mtmp.meating = 3 + (cwt >> 6);
            // C ref: nutrit = mons[corpsenm].cnutrit.  makemon.js exports the
            // real per-species table (mon_cnutrit); this used to be a flat 50.
            nutrit = mon_cnutrit(obj.corpsenm) ?? 0;
        } else {
            // C ref: dog_nutrition — a non-corpse food's digesting time is
            // objects[otyp].oc_delay, NOT a flat 1.  meating gates the pet's
            // movement for the next oc_delay m_move() calls (monmove.c:1745
            // returns MMOVE_DONE while meating>0), so it MUST match C exactly.
            mtmp.meating = FOOD_OC_DELAY[obj.otyp] ?? 1;
            nutrit = FOOD_OC_NUTRITION[obj.otyp] ?? 0;
        }
        const msize = (mtmp.data?.msize != null)
            ? mtmp.data.msize
            : (mon_msize(mtmp.data?.pmidx) ?? 2 /* MZ_MEDIUM */);
        switch (msize) {
        case 0: nutrit *= 8; break;  // MZ_TINY
        case 1: nutrit *= 6; break;  // MZ_SMALL
        case 3: nutrit *= 4; break;  // MZ_LARGE
        case 4: nutrit *= 3; break;  // MZ_HUGE
        case 5: nutrit *= 2; break;  // MZ_GIGANTIC
        default: nutrit *= 5; break; // MZ_MEDIUM
        }
        // C ref: dog_nutrition — a partly-eaten food scales BOTH meating and
        // nutrit by the remaining fraction (eat.c eaten_stat), min 1.  The old
        // code clamped meating to exactly 1 and left nutrit untouched, so a pet
        // finishing a half-eaten food ration banked the full 800*msize.
        if (obj.oeaten) {
            mtmp.meating = eaten_stat(mtmp.meating, obj);
            nutrit = eaten_stat(nutrit, obj);
        }
    } else if (obj.oclass === COIN_CLASS) {
        // C ref: dogmove.c:197-203 — a gold-eating pet (gelatinous cube, and a
        // steed/pet handed coins) digests quan/2000+1 turns for quan/20 food.
        mtmp.meating = Math.trunc((obj.quan || 0) / 2000) + 1;
        if (mtmp.meating < 0) mtmp.meating = 1;
        nutrit = Math.trunc((obj.quan || 0) / 20);
        if (nutrit < 0) nutrit = 0;
    } else {
        // C ref: dogmove.c:204-212 — "unusual pet such as gelatinous cube eating
        // odd stuff": meating scales with the object's weight, nutrit is 5x the
        // object's oc_nutrition (0 for non-foods).
        mtmp.meating = Math.trunc(objWeight(obj) / 20) + 1;
        nutrit = 5 * (FOOD_OC_NUTRITION[obj.otyp] ?? 0);
    }
    return nutrit;
}

// C ref: eat.c eaten_stat(base, obj) — scale `base` by the fraction of the
// object's nutrition that is left (obj->oeaten / oc_nutrition), min 1.
function eaten_stat(base, obj) {
    const full = FOOD_OC_NUTRITION[obj.otyp] ?? 0;
    let uneaten = obj.oeaten || 0;
    if (uneaten > full) uneaten = full;
    const v = full ? Math.trunc((base * uneaten) / full) : 0;
    return v < 1 ? 1 : v;
}

// C ref: do_name.c Monnam()/x_monnam(ARTICLE_YOUR) capitalized — "Your kitten".
function noit_Monnam(mtmp) {
    const s = x_monnam(mtmp, /*ARTICLE_YOUR*/ 3, null, 0, false);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// Emit a pet topline message, honoring the --More-- pacing that update_topl
// applies when a previous (e.g. kill) message is still pending acknowledgment.
async function emit_pet_msg(msg) {
    const { update_topl } = await import('./display.js');
    await update_topl(msg);
}

// C ref: display.c canseemon(mon) — the hero can see the monster (its square is
// in view and it isn't invisible unless the hero sees invisible).  Used to gate
// the pet's reluctant-step topline.
function canseemon(mtmp) {
    if (!mtmp) return false;
    if (game.u?.uswallow) return true;
    if (mtmp.minvis && !game.u?.see_invis) return false;
    // C ref: display.h _mon_visible() — `(!minvis || See_invisible) && !mundetected`.
    if (mtmp.mundetected) return false;
    // C ref: display.h _canseemon() — `cansee(mx, my) || see_with_infrared(mon)`.
    // The infravision half is what lets a non-human hero (dwarf/gnome/orc/elf)
    // see a warm-blooded monster on an unlit square that is still in line of
    // sight; omitting it silently suppressed those monsters' messages.
    return !!cansee(mtmp.mx, mtmp.my) || see_with_infrared(mtmp);
}

// C ref: mondata.h is_flyer(ptr) = (mflags1 & M1_FLY).  This was a FOUR-entry
// pmidx set written when makemon was believed to carry no mflags1; M1_FLY
// covers ~60 species (every bat/bird, all the dragons, the angels, the
// demons...), so the set answered FALSE for all but four of them and every
// flying pet got "steps reluctantly onto" instead of "flies reluctantly over".
function is_flyer(ptr) { return is_flyer_flag(ptr); }
// C ref: mondata.h is_floater(ptr) = (ptr->mlet == S_EYE).  defsym.h puts
// S_EYE at 5, not 18 (18 is S_RODENT) — the old literal made every rodent a
// "floater", so a rat stepping onto a cursed object read "floats reluctantly
// OVER" instead of "steps reluctantly ONTO", and locomotion() gave it the verb
// "float".  Both are rendered text.
const S_EYE = 5;
function is_floater(ptr) { return ptr != null && ptr.mcls === S_EYE; }

// C ref: mondata.c locomotion(ptr, def) — the movement verb.  Floaters/flyers/
// slitherers use their own verb; a normal limbed walker (every contest pet) uses
// `def` ("step").  Amorphous/immobile/nolimbs branches aren't reachable for the
// pets that step onto cursed objects, so they fall through to def.
function locomotion(ptr, def) {
    if (is_floater(ptr)) return 'float';
    if (is_flyer(ptr)) return 'fly';
    if (ptr && (ptr.mcls === 45 /* S_SNAKE */ || ptr.mcls === 40 /* S_NAGA */))
        return 'slither';
    return def;
}

// C ref: objnam.c vtense(NULL, verb) — the singular 3rd-person present form of a
// plural-shaped verb ("step" -> "steps", "fly" -> "flies").  Only the null-subject
// (`sing:`) branch is needed here.
function vtense(verb) {
    const b = verb;
    const last = b[b.length - 1]?.toLowerCase();
    const prev = b.length >= 2 ? b[b.length - 2].toLowerCase() : '';
    if (b.toLowerCase() === 'are') return 'is';
    if (b.toLowerCase() === 'have') return b.slice(0, -2) + 's';
    if (last === 'z' || last === 'x' || last === 's'
        || (b.length >= 2 && last === 'h' && (prev === 'c' || prev === 's'))
        || (b.length === 2 && last === 'o'))
        return b + 'es';
    if (last === 'y' && !'aeiou'.includes(prev))
        return b.slice(0, -1) + 'ies';
    return b + 's';
}

// C ref: dogmove.c:1302 — the object the pet is reluctantly stepping onto.  Names
// the top object only when the hero *remembers* an object there (not hallucinating,
// hero_memory on, the map cell's remembered glyph is that object); else "something".
function reluctant_what(x, y) {
    if (!game.u?.uhallu && game.level?.flags?.hero_memory) {
        const o = vobj_at(x, y);
        const loc = game.level?.at(x, y);
        if (o && loc?.remembered_glyph) {
            const og = object_glyph(o);
            if (og && og.ch === loc.remembered_glyph.ch)
                return floor_object_name(o);
        }
    }
    return 'something';
}

function GDIST(x, y, g) { return dist2(x, y, g.gx, g.gy); }

// C ref: dogmove.c:1102-1170 — the ALLOW_M branch of dog_move's choice loop.
// Decides whether the pet (mtmp) attacks an adjacent monster (mtmp2); returns
// an MMOVE_* code when it does (or when `after` short-circuits), or null when
// the pet balks at this foe (caller skips the square).
async function dog_attack_mon(mtmp, mtmp2, omx, omy, after) {
    // balk: highest defender level the pet is willing to engage, scaled by the
    // pet's current HP fraction.  C: m_lev + (5*mhp/mhpmax) - 2.  The starting
    // pets don't track mhp/mhpmax here, so a missing fraction is treated as full
    // health (matching a freshly-made pet) to keep the comparison faithful.
    const petLev = mtmp.m_lev ?? mtmp.data?.mlevel ?? 0;
    const hpFrac = (mtmp.mhp != null && mtmp.mhpmax)
        ? Math.trunc((5 * mtmp.mhp) / mtmp.mhpmax) : 5;
    const balk = petLev + hpFrac - 2;
    const defLev = mtmp2.m_lev ?? mtmp2.data?.mlevel ?? 0;

    // C dogmove.c:1121 — refuse the fight under any of these conditions.
    // max_passive_dmg() is the one that matters most in practice: it is what
    // stops a 2 hp kitten from swatting the adjacent green mold whose AD_ACID
    // passive would kill it outright (seed0399 step 117).
    if (defLev >= balk
        || (mtmp2.mtame && mtmp.mtame /* && !Conflict */)
        || (max_passive_dmg(mtmp2, mtmp) >= (mtmp.mhp | 0))
        || (mtmp2.mpeaceful /* guardian/leader or low-HP peaceful */
            && ((mtmp.mhp != null && mtmp.mhpmax && mtmp.mhp * 4 < mtmp.mhpmax)
                || msound_of(mtmp2.data) === MS_GUARDIAN
                || msound_of(mtmp2.data) === MS_LEADER))) {
        return null;
    }

    // C dogmove.c:1131 — foes a pet only ever engages at range (which, per C's
    // own FIXME, means "not at all": `ranged_only` always falls through to the
    // same `continue`).  The rn2(10) rolls are real and are drawn only after the
    // species test short-circuits, so they must be emitted in the same order.
    if ((mtmp2.data?.name === 'floating eye' && rn2(10)
         && mtmp.mcansee !== 0 && haseyes(mtmp.data) && mtmp2.mcansee !== 0
         && (!mtmp2.minvis || perceives_flag(mtmp.data))
         /* mon_reflects(): no pet in the corpus carries a reflecting item */)
        || (mtmp2.data?.name === 'gelatinous cube' && rn2(10))
        || (touch_petrifies_data(mtmp2.data) && !resists_ston_mon(mtmp))) {
        return null;
    }

    if (after) return MMOVE_NOTHING; // hit only once each move

    let mstatus = await mattackm(mtmp, mtmp2); // dogmove.c:1151

    if (mstatus & M_ATTK_AGR_DIED) return MMOVE_DIED;

    // C dogmove.c:1157 — the struck defender may strike back.
    if ((mstatus & (M_ATTK_HIT | M_ATTK_DEF_DIED)) === M_ATTK_HIT
        && rn2(4)                                 // dogmove.c:1158
        && mtmp2.mlstmv !== game.moves
        // C ref: dogmove.c:1160 — `!onscary(mtmp->mx, mtmp->my, mtmp2)`.  This
        // was asserted false ("no temple/Elbereth here"); a pet standing on an
        // Elbereth engraving, a scare-monster scroll or a co-aligned temple
        // square DOES stop the counter-attack, and the roll order matters
        // because rn2(4) has already been consumed by then.
        && !onscary(mtmp.mx, mtmp.my, mtmp2)
        && monnear(mtmp2, mtmp.mx, mtmp.my)) {
        mstatus = await mattackm(mtmp2, mtmp);    // return attack (dogmove.c:1165)
        if (mstatus & M_ATTK_DEF_DIED) return MMOVE_DIED;
    }
    return MMOVE_DONE;
}

// C ref: mon.c monnear(mon, x, y) — within melee range (dist2 < 3, but grid
// bugs can't reach diagonal range-2 squares).
export function monnear(mon, x, y) {
    const PM_GRID_BUG = 116; // makemon MONS-table index (matches mfndpos nodiag)
    const distance = dist2(mon.mx, mon.my, x, y);
    if (distance === 2 && mon.data?.pmidx === PM_GRID_BUG) return false;
    return distance < 3;
}

// C ref: dog.c mon_catchup_elapsed_time(mtmp, nmv) — heal a monster and decay
// its status timers for the game turns it spent inactive on a level the hero
// had left, applied when restore.c getlev() reloads that level.  RNG is
// consumed only by the conditional recovery rolls: rn2(nmv+1) for a trapped /
// confused / stunned monster, and rn2(wilder) for a tame monster that has been
// separated from the hero long enough to risk going wild.  The HP regeneration
// (healmon) and the pet-starvation check draw no RNG THEMSELVES but both write
// state that later moduli read: mhp feeds dog_move's `balk` and the
// max_passive_dmg comparison in the ALLOW_M branch (so a pet that healed while
// off-level attacks foes the un-healed pet balks at), and the starvation check
// clears mtame/mpeaceful, which flips the monster out of dog_move entirely and
// changes its mfndpos allowflags (ALLOW_M|ALLOW_TRAPS -> ALLOW_U).
export function mon_catchup_elapsed_time(mtmp, nmv) {
    const LARGEST_INT = 0x7fffffff;
    let imv = (nmv >= LARGEST_INT) ? (LARGEST_INT - 1) : (nmv | 0);

    // might stop being afraid, blind or frozen (set to 1; movemon does the
    // final decrement)
    if (mtmp.mblinded)
        mtmp.mblinded = (imv >= mtmp.mblinded) ? 1 : (mtmp.mblinded - imv);
    if (mtmp.mfrozen)
        mtmp.mfrozen = (imv >= mtmp.mfrozen) ? 1 : (mtmp.mfrozen - imv);
    if (mtmp.mfleetim)
        mtmp.mfleetim = (imv >= mtmp.mfleetim) ? 1 : (mtmp.mfleetim - imv);

    // might recover from temporary trouble
    if (mtmp.mtrapped && rn2(imv + 1) > 40 / 2) mtmp.mtrapped = 0;
    if (mtmp.mconf && rn2(imv + 1) > 50 / 2) mtmp.mconf = 0;
    if (mtmp.mstun && rn2(imv + 1) > 10 / 2) mtmp.mstun = 0;

    // might finish eating or be able to use special ability again
    if (mtmp.meating) {
        // C ref: dogmove.c finish_meating(mtmp) — clears meating AND, when the
        // monster was mimicking something because it ate a mimic corpse
        // (quickmimic), resets m_ap_type/mappearance and repaints its square.
        if (imv > mtmp.meating) finish_meating(mtmp);
        else mtmp.meating -= imv;
    }
    if (imv > (mtmp.mspec_used || 0)) mtmp.mspec_used = 0;
    else mtmp.mspec_used -= imv;

    // reduce tameness for every 150 moves you are separated
    if (mtmp.mtame) {
        const wilder = Math.floor((imv + 75) / 150);
        if (mtmp.mtame > wilder)
            mtmp.mtame -= wilder;              // less tame
        else if (mtmp.mtame > rn2(wilder))
            mtmp.mtame = 0;                    // untame
        else
            mtmp.mtame = mtmp.mpeaceful = 0;   // hostile!
    }

    // C ref: dog.c:1257-1265 — a pet that WOULD have starved while the hero was
    // away goes wild instead of dying on the next dog_move().  Never ported, so
    // a pet left behind for 1000+ turns stayed tame forever.  DOG_WEAK 500 /
    // DOG_STARVE 750 are dogmove.c's own thresholds, spelled as literals in
    // dog.c (which is why they were easy to miss).
    if (mtmp.mtame && !mtmp.isminion
        && (carnivorous(mtmp.data) || herbivorous(mtmp.data))) {
        const edog = mtmp.edog;
        const moves = game.moves ?? 0;
        if (edog
            && ((moves > (edog.hungrytime || 0) + DOG_WEAK && (mtmp.mhp ?? 99) < 3)
                || moves > (edog.hungrytime || 0) + DOG_STARVE))
            mtmp.mtame = mtmp.mpeaceful = 0;
    }

    // C ref: dog.c:1274-1277 — recover lost hit points.  A non-regenerating
    // monster heals at 1/20th the elapsed time.  Omitted before as "HP-only
    // bookkeeping": mhp is read by dog_move's balk formula and by the
    // max_passive_dmg(mtmp2, mtmp) >= mtmp->mhp gate, so a pet that returns to
    // an old level un-healed refuses fights C's healed pet takes (and vice
    // versa for a hostile monster's own m_move decisions).
    if (!regenerates(mtmp.data)) imv = Math.trunc(imv / 20);
    healmon(mtmp, imv, 0);

    // set_mon_lastmove(mtmp)
    mtmp.mlstmv = game.moves ?? 0;
}

// C ref: dogmove.c quickmimic(mtmp) — a PET that has just eaten a mimic corpse
// (mon.c:1447, `if (ispet && deadmimic) quickmimic(mtmp)`) starts mimicking
// something for the rest of its meal.  It DRAWS RNG: rn2(SIZE(qm)) up to five
// times in a do/while.  Neither the function nor its call site existed in this
// port; the call site lives in mon.c's meatcorpse (js/mon.js), so this is
// exported for that file's pass to wire up — the RNG must fire before anything
// else that turn or the whole stream shifts.
//
// C ref: dogmove.c:1429-1445 qm[] — the table is ordered and its SIZE (9) is
// the rn2 modulus, so it must be transcribed whole, not filtered.
const M_AP_FURNITURE = 1, M_AP_MONSTER = 2, M_AP_OBJECT = 3;
const S_DOG_CLS = 4, S_SINK_SYM = 30; // defsym.h S_DOG / S_sink
// The qm[] rows are matched by SPECIES NAME rather than by index: dog.js builds
// its pets with a non-makemon pmidx (34 reads as jaguar, 102 as gray unicorn),
// so a pmidx comparison would answer wrongly for exactly the pets this table is
// about.  `app` is a real mons[]/objects[] index (it is only displayed).
const QM_TABLE = [
    { name: 'little dog', mlet: 0, app: 32 /*kitten*/, type: M_AP_MONSTER },
    { name: 'dog', mlet: 0, app: 33 /*housecat*/, type: M_AP_MONSTER },
    { name: 'large dog', mlet: 0, app: 37 /*large cat*/, type: M_AP_MONSTER },
    { name: 'kitten', mlet: 0, app: 16 /*little dog*/, type: M_AP_MONSTER },
    { name: 'housecat', mlet: 0, app: 18 /*dog*/, type: M_AP_MONSTER },
    { name: 'large cat', mlet: 0, app: 19 /*large dog*/, type: M_AP_MONSTER },
    { name: 'housecat', mlet: 0, app: 89 /*giant rat*/, type: M_AP_MONSTER },
    { name: null, mlet: S_DOG_CLS, app: S_SINK_SYM, type: M_AP_FURNITURE },
    { name: null, mlet: 0, app: TRIPE_RATION, type: M_AP_OBJECT }, // keep last
];
export function quickmimic(mtmp) {
    // C ref: dogmove.c:1478 — Protection_from_shape_changers is a hero property
    // this port does not track for monsters; !meating is the reachable guard.
    if (!mtmp.meating) return;
    let idx = 0, trycnt = 5;
    do {
        idx = rn2(QM_TABLE.length);
        if (QM_TABLE[idx].name && mtmp.data?.name === QM_TABLE[idx].name) break;
        if (QM_TABLE[idx].mlet !== 0 && mtmp.data?.mcls === QM_TABLE[idx].mlet)
            break;
        if (!QM_TABLE[idx].name && QM_TABLE[idx].mlet === 0) break;
    } while (--trycnt > 0);
    if (trycnt === 0) idx = QM_TABLE.length - 1;
    mtmp.m_ap_type = QM_TABLE[idx].type;
    mtmp.mappearance = QM_TABLE[idx].app;
    newsym(mtmp.mx, mtmp.my);
}

// C ref: dogmove.c finish_meating(mtmp).
function finish_meating(mtmp) {
    mtmp.meating = 0;
    if ((mtmp.m_ap_type ?? 0) !== 0 && mtmp.data?.mcls !== S_MIMIC) {
        mtmp.m_ap_type = 0;
        mtmp.mappearance = 0;
        newsym(mtmp.mx, mtmp.my);
    }
}
