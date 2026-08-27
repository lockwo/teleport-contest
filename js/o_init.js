// o_init.js — Object initialization.
// C ref: o_init.c — init_objects(), randomize_gem_colors(), shuffle(),
// shuffle_all().  Assigns per-appearance object descriptions, colors,
// toughness and material via the real Fisher-Yates-style shuffle.
//
// This is a faithful port of the RNG call sequence emitted by the C
// init_objects() path that runs during new-game startup, immediately before
// dungeon init.  The exact left-to-right rn2()/rnd() order must match C so
// that everything downstream stays in sync.  Verified against the previously
// hardcoded fastforward_pre_mklev() replay for seed8000 (and every other
// public session whose first divergence is downstream of o_init).
//
// The shuffle results (oc_descr_idx / oc_color / oc_tough / oc_material) are
// written back onto the shared objects[] array so a renderer can later read
// the per-appearance description / color.  Rendering itself lives in
// display.js / invent.js and is out of scope for this file.

import { rn2 } from './rng.js';
import {
    objects, GemStone, MAXOCLASSES, WEAPON_CLASS, ARMOR_CLASS, COIN_CLASS, GEM_CLASS,
    AMULET_CLASS, POTION_CLASS, RING_CLASS, SCROLL_CLASS,
    SPBOOK_CLASS, WAND_CLASS, VENOM_CLASS,
} from './mkobj.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
import { game } from './gstate.js';
import { exercise } from './attrib.js';
import { A_WIS } from './const.js';

// ── Color constants (C ref: include/color.h) ──
const CLR_BLACK = 0, CLR_RED = 1, CLR_GREEN = 2, CLR_BROWN = 3, CLR_BLUE = 4;
const CLR_MAGENTA = 5, CLR_CYAN = 6, CLR_GRAY = 7;
const CLR_ORANGE = 9, CLR_BRIGHT_GREEN = 10, CLR_YELLOW = 11;
const CLR_BRIGHT_BLUE = 12, CLR_BRIGHT_MAGENTA = 13, CLR_BRIGHT_CYAN = 14;
const CLR_WHITE = 15;
// HI_* aliases (color.h)
const HI_METAL = CLR_CYAN, HI_COPPER = CLR_YELLOW, HI_SILVER = CLR_GRAY;
const HI_GOLD = CLR_YELLOW, HI_LEATHER = CLR_BROWN, HI_CLOTH = CLR_BROWN;
const HI_ORGANIC = CLR_BROWN, HI_WOOD = CLR_BROWN, HI_PAPER = CLR_WHITE;
const HI_GLASS = CLR_BRIGHT_CYAN, HI_MINERAL = CLR_GRAY;

// ── object type indices used by obj_shuffle_range (C ref: onames.h) ──
const POT_WATER = 322;
const HELMET = 97, HELM_OF_TELEPATHY = 100;
const LEATHER_GLOVES = 159, GAUNTLETS_OF_DEXTERITY = 162;
const CLOAK_OF_PROTECTION = 146, CLOAK_OF_DISPLACEMENT = 149;
const SPEED_BOOTS = 166, LEVITATION_BOOTS = 172;
const WAN_NOTHING = 416;
// objclass.h: NODIR=1, IMMEDIATE=2, RAY=3.  These were 0/1, which wrote oc_dir
// values that zap.js (which uses the correct 1/2) then misread.
const NODIR = 1, IMMEDIATE = 2;

// Keep the immutable object-table colors so init_objects() can restore them
// before each new game.  The shared objects[] entries are mutated by shuffling.
// Snapshotted lazily on the first seedAppearance() (i.e. before any shuffle
// has run): display.js now imports this module, which puts o_init.js inside the
// mkobj.js import cycle, so touching objects[] at module-eval time is a TDZ
// ReferenceError.
let DECLARED_COLOR = null;
let DECLARED_TOUGH = null;

// Per-object appearance data (oc_color / oc_tough / oc_material) for the
// objects that participate in shuffling.  Only the shuffle ranges need this:
// objects outside a range keep their declared values and are never swapped.
// C ref: include/objects.h (POTION/SCROLL/SPELL/WAND/RING/AMULET/HELM/CLOAK/
// GLOVES/BOOTS macro expansions).
//
// Keyed by otyp.  color = oc_color, tough = oc_tough (HARDGEM for rings),
// material = oc_material.  oc_descr_idx starts equal to the otyp.

// Potions 297..321 (POT_GAIN_ABILITY..POT_OIL), all GLASS, tough 0.
const POTION_COLOR = [
    CLR_RED, CLR_BRIGHT_MAGENTA, CLR_ORANGE, CLR_YELLOW, CLR_BRIGHT_GREEN,
    CLR_GREEN, CLR_CYAN, CLR_CYAN, CLR_BRIGHT_BLUE, CLR_MAGENTA,
    CLR_MAGENTA, CLR_RED, CLR_WHITE, CLR_BROWN, CLR_WHITE,
    CLR_GRAY, CLR_WHITE, CLR_GRAY, CLR_BLACK, CLR_YELLOW,
    CLR_BROWN, CLR_CYAN, CLR_BLACK, CLR_WHITE, CLR_BROWN,
];
// Rings 173..200, color + Mohs hardness (HARDGEM = mohs >= 8 -> oc_tough).
const RING_DATA = [
    [HI_WOOD, 2], [HI_MINERAL, 7], [HI_MINERAL, 7], [CLR_RED, 4],
    [CLR_ORANGE, 4], [CLR_BLACK, 7], [HI_MINERAL, 6], [CLR_BROWN, 6],
    [CLR_GREEN, 6], [HI_COPPER, 4], [CLR_RED, 7], [CLR_CYAN, 8],
    [CLR_BLUE, 9], [CLR_RED, 9], [CLR_WHITE, 10], [CLR_WHITE, 4],
    [HI_METAL, 5], [HI_COPPER, 4], [HI_COPPER, 3], [HI_METAL, 6],
    [HI_METAL, 8], [HI_SILVER, 3], [HI_GOLD, 3], [CLR_WHITE, 4],
    [CLR_BRIGHT_GREEN, 8], [HI_METAL, 5], [HI_METAL, 5], [CLR_BRIGHT_CYAN, 5],
];
// Scrolls 323..363 (real + extra labels), all PAPER -> HI_PAPER, tough 0.
// Spellbooks 366..406, colors below; all LEATHER/PAPER, tough 0.
const SPBOOK_COLOR = [
    HI_LEATHER, HI_LEATHER, HI_PAPER, HI_PAPER, HI_PAPER, HI_PAPER, HI_CLOTH,
    HI_LEATHER, CLR_WHITE, CLR_BRIGHT_MAGENTA, CLR_RED, CLR_ORANGE, CLR_YELLOW,
    CLR_MAGENTA, CLR_BRIGHT_GREEN, CLR_GREEN, CLR_BRIGHT_CYAN, CLR_CYAN,
    CLR_BRIGHT_BLUE, CLR_BLUE, CLR_BLUE, CLR_MAGENTA, CLR_MAGENTA, CLR_MAGENTA,
    CLR_BROWN, CLR_GREEN, CLR_BROWN, CLR_BROWN, CLR_GRAY, HI_PAPER, HI_PAPER,
    HI_COPPER, HI_COPPER, HI_SILVER, HI_GOLD, CLR_WHITE, CLR_WHITE, HI_PAPER,
    HI_PAPER, HI_PAPER, CLR_GRAY,
];
// Wands 410..437 (full class), colors below; tough 0.
const WAND_COLOR = [
    HI_GLASS, HI_WOOD, HI_GLASS, HI_WOOD, HI_WOOD, CLR_RED, HI_WOOD, HI_WOOD,
    HI_MINERAL, HI_METAL, HI_COPPER, HI_COPPER, HI_SILVER, CLR_WHITE,
    CLR_BRIGHT_CYAN, HI_METAL, HI_METAL, HI_METAL, HI_METAL, HI_METAL,
    HI_METAL, HI_METAL, HI_METAL, HI_METAL, HI_METAL, HI_WOOD, HI_METAL,
    HI_MINERAL,
];
// Helmet sub-range 97..100: helmet, helm of caution, helm of opposite
// alignment, helm of telepathy (all IRON).
const HELMET_COLOR = [HI_METAL, CLR_GREEN, HI_METAL, HI_METAL];
// Gloves sub-range 159..162: leather gloves, gauntlets of fumbling/power/
// dexterity (CLR_BROWN throughout per objects.h note).
const GLOVES_COLOR = [HI_LEATHER, HI_LEATHER, CLR_BROWN, HI_LEATHER];
// Cloak sub-range 146..149: cloak of protection/invisibility/magic
// resistance/displacement (all CLOTH).
const CLOAK_COLOR = [HI_CLOTH, CLR_BRIGHT_MAGENTA, CLR_WHITE, HI_CLOTH];
// Boots sub-range 166..172: speed/water walking/jumping/elven/kicking/fumble/
// levitation boots.
const BOOTS_COLOR = [
    HI_LEATHER, HI_LEATHER, HI_LEATHER, HI_LEATHER, CLR_BROWN, HI_LEATHER,
    HI_LEATHER,
];
// Venom 479..480: blinding / acid venom, HI_ORGANIC.
const VENOM_COLOR = [HI_ORGANIC, HI_ORGANIC];

// Build per-object initial appearance attributes onto objects[].
// C ref: init_objects() pre-shuffle state (oc_descr_idx = oc_name_idx = i;
// oc_color / oc_tough / oc_material come from the OBJECT() macro init).
function seedAppearance() {
    if (!DECLARED_COLOR) {
        DECLARED_COLOR = objects.map((o) => o?.oc_color ?? CLR_GRAY);
        DECLARED_TOUGH = objects.map((o) => o?.oc_tough ?? 0);
    }
    for (let i = 0; i < objects.length; i++) {
        const o = objects[i];
        if (!o) continue;
        o.oc_descr_idx = o.oc_name_idx = i;
        o.oc_color = DECLARED_COLOR[i];
        o.oc_tough = DECLARED_TOUGH[i];
        o.oc_material = o.material ?? 0;
        // C's object table pre-marks types without alternate descriptions and
        // leaves description-bearing types unidentified.
        o.oc_name_known = DESCR_BY_OTYP[i] == null ? 1 : 0;
        o.oc_encountered = 0;
        o.oc_uname = null;
        // C ref: objects.h OBJECT() initialiser — the price-quote memory starts
        // at { minseen: (0UL-1UL), maxseen: 0 }, i.e. min > max meaning "never
        // quoted"; append_price_quote() returns early on exactly that test.
        o.oc_buy_minseen = Infinity; o.oc_buy_maxseen = 0;
        o.oc_sell_minseen = Infinity; o.oc_sell_maxseen = 0;
    }
    // Apply the per-appearance color/tough overrides for shuffle ranges.
    const apply = (base, table) => {
        for (let k = 0; k < table.length; k++) {
            const o = objects[base + k];
            if (!o) continue;
            const cell = table[k];
            if (Array.isArray(cell)) {
                o.oc_color = cell[0];
                o.oc_tough = cell[1] >= 8 ? 1 : 0;
            } else {
                o.oc_color = cell;
            }
        }
    };
    apply(297, POTION_COLOR);
    apply(173, RING_DATA);
    for (let i = 323; i <= 363; i++)
        if (objects[i]) objects[i].oc_color = HI_PAPER;
    apply(366, SPBOOK_COLOR);
    apply(410, WAND_COLOR);
    apply(HELMET, HELMET_COLOR);
    apply(LEATHER_GLOVES, GLOVES_COLOR);
    apply(CLOAK_OF_PROTECTION, CLOAK_COLOR);
    apply(SPEED_BOOTS, BOOTS_COLOR);
    apply(479, VENOM_COLOR);

    // oc_magic / oc_unique flags needed by obj_shuffle_range() to find the
    // hi boundary for AMULET / SCROLL / SPBOOK classes.  The loop walks from
    // bases[class] and stops at the first object that is unique or non-magic.
    // C ref: include/objects.h BITS() mgc / uniq fields.
    //
    //  Amulets 201..211 are magic; FAKE_AMULET_OF_YENDOR (212) is non-magic
    //  (deliberately placed before the real, unique Amulet at 213 so the
    //  shuffle stops there) -> amulet shuffle range = 201..211 (11).
    //  Scrolls 323..363 (real + extra labels) are magic; mail (364) and blank
    //  paper (365)
    //  is non-magic -> scroll shuffle range = 323..363 (41).  (mail, 364, is
    //  non-magic too and likewise sits outside the shuffled run.)
    //  Spellbooks 366..406 are magic; blank paper (407) is non-magic ->
    //  spellbook shuffle range = 366..406 (41).  novel (408) is non-magic
    //  and Book of the Dead (409) is unique+magic, both after the boundary.
    const setMagic = (loInclusive, hiInclusive) => {
        for (let i = loInclusive; i <= hiInclusive; i++)
            if (objects[i]) objects[i].oc_magic = 1;
    };
    setMagic(201, 211);   // magic amulets (FAKE_YENDOR 212 stays non-magic)
    if (objects[213]) objects[213].oc_unique = 1; // Amulet of Yendor
    setMagic(323, 363);   // magic scrolls + extra labels
    setMagic(366, 406);   // magic spellbooks
    if (objects[409]) { objects[409].oc_magic = 1; objects[409].oc_unique = 1; } // Book of the Dead
}

// Class bases: bases[oclass] = otyp of first object of that class.
// C ref: init_objects() bases[] computation.
function computeBases() {
    const bases = new Array(MAXOCLASSES + 2).fill(0);
    let first = MAXOCLASSES;
    while (first < objects.length) {
        const oclass = objects[first]?.oclass;
        let last = first + 1;
        while (last < objects.length && objects[last]?.oclass === oclass) last++;
        if (oclass != null) bases[oclass] = first;
        first = last;
    }
    bases[MAXOCLASSES] = bases[MAXOCLASSES + 1] = objects.length;
    for (let last = MAXOCLASSES - 1; last >= 0; --last)
        if (!bases[last]) bases[last] = bases[last + 1];
    return bases;
}

// some gems can have different colors.  C ref: o_init.c randomize_gem_colors().
// Emits rn2(2), rn2(2), rn2(4) in that order and copies both description and
// color from the selected source gem.
function randomize_gem_colors() {
    const TURQUOISE = 446, AQUAMARINE = 448, FLUORITE = 457;
    const SAPPHIRE = 443, DIAMOND = 440, EMERALD = 445;
    const copyDescr = (dst, src) => {
        objects[dst].oc_descr_idx = objects[src].oc_descr_idx;
        objects[dst].oc_color = objects[src].oc_color;
    };
    if (rn2(2)) copyDescr(TURQUOISE, SAPPHIRE);
    if (rn2(2)) copyDescr(AQUAMARINE, SAPPHIRE);
    switch (rn2(4)) {
    case 1: copyDescr(FLUORITE, SAPPHIRE); break;
    case 2: copyDescr(FLUORITE, DIAMOND); break;
    case 3: copyDescr(FLUORITE, EMERALD); break;
    default: break;
    }
}

// shuffle descriptions on objects o_low..o_high.  C ref: o_init.c shuffle().
function shuffle(bases, o_low, o_high, domaterial) {
    let num_to_shuffle = 0;
    for (let j = o_low; j <= o_high; j++)
        if (!objects[j].oc_name_known) num_to_shuffle++;
    if (num_to_shuffle < 2) return;

    for (let j = o_low; j <= o_high; j++) {
        if (objects[j].oc_name_known) continue;
        let i;
        do {
            i = j + rn2(o_high - j + 1);
        } while (objects[i].oc_name_known);
        let sw = objects[j].oc_descr_idx;
        objects[j].oc_descr_idx = objects[i].oc_descr_idx;
        objects[i].oc_descr_idx = sw;
        sw = objects[j].oc_tough;
        objects[j].oc_tough = objects[i].oc_tough;
        objects[i].oc_tough = sw;
        const color = objects[j].oc_color;
        objects[j].oc_color = objects[i].oc_color;
        objects[i].oc_color = color;
        if (domaterial) {
            sw = objects[j].oc_material;
            objects[j].oc_material = objects[i].oc_material;
            objects[i].oc_material = sw;
        }
    }
}

// retrieve the range of objects that otyp shares descriptions with.
// C ref: o_init.c obj_shuffle_range().
function obj_shuffle_range(bases, otyp) {
    const ocls = objects[otyp].oclass;
    let lo = otyp, hi = otyp;

    switch (ocls) {
    case ARMOR_CLASS:
        if (otyp >= HELMET && otyp <= HELM_OF_TELEPATHY) { lo = HELMET; hi = HELM_OF_TELEPATHY; }
        else if (otyp >= LEATHER_GLOVES && otyp <= GAUNTLETS_OF_DEXTERITY) { lo = LEATHER_GLOVES; hi = GAUNTLETS_OF_DEXTERITY; }
        else if (otyp >= CLOAK_OF_PROTECTION && otyp <= CLOAK_OF_DISPLACEMENT) { lo = CLOAK_OF_PROTECTION; hi = CLOAK_OF_DISPLACEMENT; }
        else if (otyp >= SPEED_BOOTS && otyp <= LEVITATION_BOOTS) { lo = SPEED_BOOTS; hi = LEVITATION_BOOTS; }
        break;
    case POTION_CLASS:
        /* potion of water has the only fixed description */
        lo = bases[POTION_CLASS];
        hi = POT_WATER - 1;
        break;
    case AMULET_CLASS:
    case SCROLL_CLASS:
    case SPBOOK_CLASS: {
        /* exclude non-magic types and also unique ones */
        lo = bases[ocls];
        let i = lo;
        for (; objects[i] && objects[i].oclass === ocls; i++)
            if (objects[i].oc_unique || !objects[i].oc_magic) break;
        hi = i - 1;
        break;
    }
    case RING_CLASS:
    case WAND_CLASS:
    case VENOM_CLASS:
        /* entire class */
        lo = bases[ocls];
        hi = bases[ocls + 1] - 1;
        break;
    }
    if (otyp < lo || otyp > hi) { lo = hi = otyp; }
    return [lo, hi];
}

// randomize object descriptions.  C ref: o_init.c shuffle_all().
function shuffle_all(bases) {
    const shuffle_classes = [
        AMULET_CLASS, POTION_CLASS, RING_CLASS, SCROLL_CLASS,
        SPBOOK_CLASS, WAND_CLASS, VENOM_CLASS,
    ];
    const shuffle_types = [
        HELMET, LEATHER_GLOVES, CLOAK_OF_PROTECTION, SPEED_BOOTS,
    ];
    for (let idx = 0; idx < shuffle_classes.length; idx++) {
        const [first, last] = obj_shuffle_range(bases, bases[shuffle_classes[idx]]);
        shuffle(bases, first, last, true);
    }
    for (let idx = 0; idx < shuffle_types.length; idx++) {
        const [first, last] = obj_shuffle_range(bases, shuffle_types[idx]);
        shuffle(bases, first, last, false);
    }
}

// init_objects().  C ref: o_init.c init_objects().
//
// RNG order (left-to-right):
//   - during the class loop, when GEM_CLASS is reached:
//       setgemprobs(0)  [no RNG]
//       randomize_gem_colors()  -> rn2(2); rn2(2); rn2(4)
//   - after the loop: shuffle_all()  -> the 11 shuffle() runs
//   - finally: objects[WAN_NOTHING].oc_dir = rn2(2) ? NODIR : IMMEDIATE
export function init_objects() {
    seedAppearance();
    const bases = computeBases();
    discoBases = bases;
    discoveryOrder.clear();

    // The class loop: only the GEM_CLASS branch consumes RNG (via
    // randomize_gem_colors), and it runs exactly once at the gem class.
    // setgemprobs() consumes no RNG.  C ref: init_objects() while-loop.
    randomize_gem_colors();

    // shuffle descriptions
    shuffle_all(bases);

    // WAN_NOTHING direction roll.  C ref: init_objects() last line.
    if (objects[WAN_NOTHING])
        objects[WAN_NOTHING].oc_dir = rn2(2) ? NODIR : IMMEDIATE;
    else
        rn2(2);
}

// ─────────────────────────────────────────────────────────────────────────
// Object-discovery state and the '\' (discoveries) list.
//
// C ref: o_init.c discover_object()/interesting_to_discover()/dodiscovered()
// and src/objnam.c obj_typename()/disco_typename().  The discovery state lives
// on objects[i].oc_name_known (type identified) and objects[i].oc_encountered
// (appearance seen).  None of this consumes RNG.
// ─────────────────────────────────────────────────────────────────────────

let discoBases = null;
const discoveryOrder = new Map();
function getBases() {
    if (!discoBases) discoBases = computeBases();
    return discoBases;
}

// generic objects sit below this index.  A function, not a const: this module
// is now inside the mkobj.js import cycle, so mkobj's bindings are in TDZ at
// module-eval time.
const FIRST_OBJECT = () => MAXOCLASSES;

// OBJ_DESCR(obj): the unidentified appearance string for this object's current
// appearance.  C: obj_descr[objects[i].oc_descr_idx].oc_descr.  After shuffling
// oc_descr_idx points at the appearance now bound to this slot.
function OBJ_DESCR(otyp) {
    const o = objects[otyp];
    if (!o) return null;
    const idx = o.oc_descr_idx != null ? o.oc_descr_idx : otyp;
    const d = DESCR_BY_OTYP[idx];
    return d != null ? d : null;
}

// C ref: objnam.c Japanese_items[] — keyed by the canonical otyp.
const JAPANESE_ITEMS = new Map([
    [46, 'wakizashi'],    // SHORT_SWORD
    [52, 'ninja-to'],     // BROADSWORD
    [81, 'nunchaku'],     // FLAIL
    [62, 'naginata'],     // GLAIVE
    [222, 'osaku'],       // LOCK_PICK
    [253, 'koto'],        // WOODEN_HARP
    [254, 'magic koto'],  // MAGIC_HARP
    [40, 'shito'],        // KNIFE
    [121, 'tanko'],       // PLATE_MAIL
    [97, 'kabuto'],       // HELMET
    [159, 'yugake'],      // LEATHER_GLOVES
    [293, 'gunyoki'],     // FOOD_RATION
    [317, 'sake'],        // POT_BOOZE
]);
function disco_is_samurai() {
    return game.u?.umonnum === 9 || game.urole?.mnum === 9
        || (game.urole?.name?.m === 'Samurai');
}
function disco_japanese_name(otyp) {
    return (disco_is_samurai() && JAPANESE_ITEMS.has(otyp))
        ? JAPANESE_ITEMS.get(otyp) : null;
}

// C ref: o_init.c discover_object(oindx, mark_as_known, mark_as_encountered,
// credit_hero).  When a type first becomes name-known and credit_hero is set
// (the makeknown() macro passes TRUE), the hero is credited with a Wisdom
// exercise — exercise(A_WIS, TRUE) rolls rn2(19).  knows_object/observe_object
// (initial inventory, autodiscovery) pass credit_hero FALSE, so they roll no
// RNG, matching C.
export function discover_object(oindx, markKnown, markEncountered, creditHero) {
    if (oindx < FIRST_OBJECT()) return;
    const o = objects[oindx];
    if (!o) return;
    if ((!o.oc_name_known && markKnown)
        || (!o.oc_encountered && markEncountered)
        || disco_japanese_name(oindx)) {
        const order = discoveryOrder.get(o.oclass) || [];
        if (!order.includes(oindx)) {
            order.push(oindx);
            discoveryOrder.set(o.oclass, order);
        }
        if (markEncountered) o.oc_encountered = 1;
        if (!o.oc_name_known && markKnown) {
            o.oc_name_known = 1;
            if (creditHero) exercise(A_WIS, true);
        }
    }
}

// C ref: o_init.c observe_object() — mark the type as encountered (seen).
export function observe_object(obj) {
    if (!obj) return;
    const oindx = obj.otyp;
    // C ref: o_init.c observe_object() — seeing an object also learns its
    // APPEARANCE (obj->dknown = 1), which is what tells doname_vague_quan()
    // that the exact quantity of a stack is known.  (C's !Hallucination guard
    // covers both statements and is not modelled here either.)
    if (oindx >= FIRST_OBJECT()) { obj.dknown = 1; discover_object(oindx, false, true); }
}

// C ref: u_init.c knows_object() — mark a type known (not encountered).
export function knows_object(otyp) {
    discover_object(otyp, true, false);
}

// C ref: u_init.c knows_class() — pre-discover every ordinary (non-magic)
// object of a class.  Consumes no RNG.
export function knows_class(oclass) {
    const bases = getBases();
    const samurai = disco_is_samurai();
    const roleMnum = game.urole?.mnum ?? game.u?.umonnum;
    const isKnight = roleMnum === 4;
    const isRanger = roleMnum === 7;
    const isRogue = roleMnum === 8;
    // C ref: include/obj.h is_launcher/is_ammo (skill in [P_BOW,P_CROSSBOW] /
    // [-P_CROSSBOW,-P_BOW]) and is_spear (skill == P_SPEAR == 17).
    const sk = (ct) => objects[ct]?.oc_skill ?? 0;
    // is_pole(): oc_skill P_POLEARMS or P_LANCE. Dwarvish mattock uses
    // P_PICK_AXE (not pole) despite sitting right before lance on the table.
    const P_POLEARMS = 16, P_LANCE = 19;
    const isPole = (ct) => sk(ct) === P_POLEARMS || sk(ct) === P_LANCE;
    const isLauncher = (ct) => objects[ct]?.oc_class === WEAPON_CLASS && sk(ct) >= 20 && sk(ct) <= 22;
    const isAmmo = (ct) => objects[ct]?.oc_class === WEAPON_CLASS && sk(ct) >= -22 && sk(ct) <= -20;
    const isSpear = (ct) => objects[ct]?.oc_class === WEAPON_CLASS && sk(ct) === 17;
    const CORNUTHAUM = 93, DUNCE_CAP = 94, SMALL_SHIELD = 150;
    const P_DAGGER = 1;
    for (let ct = bases[oclass]; ct < bases[oclass + 1]; ct++) {
        const o = objects[ct];
        if (!o) continue;
        if (ct === CORNUTHAUM || ct === DUNCE_CAP || ct === SMALL_SHIELD) continue;
        if (oclass === WEAPON_CLASS) {
            // arbitrary: only knights and samurai recognize polearms
            if (!isKnight && !samurai && isPole(ct)) continue;
            // rangers know all launchers, ammo, and spears regardless of race,
            // but not other weapons.
            if (isRanger && !isLauncher(ct) && !isAmmo(ct) && !isSpear(ct)) continue;
            // rogues know daggers, regardless of racial variations.
            if (isRogue && sk(ct) !== P_DAGGER) continue;
        }
        if (o.oc_class === oclass && !o.oc_magic)
            knows_object(ct);
    }
}

// C ref: o_init.c interesting_to_discover().
function interesting_to_discover(i) {
    if (disco_japanese_name(i)) return true;
    const o = objects[i];
    if (!o) return false;
    return !!(o.oc_uname != null
              || ((o.oc_name_known || o.oc_encountered) && OBJ_DESCR(i) != null));
}

// C ref: objnam.c obj_typename().
function disco_obj_typename(otyp) {
    const o = objects[otyp];
    let actualn = disco_japanese_name(otyp) || o.name;
    let dn = OBJ_DESCR(otyp);
    if (disco_is_samurai() && (otyp === 253 || otyp === 254)) dn = 'koto';
    const nn = o.oc_name_known;
    const un = o.oc_uname != null ? o.oc_uname : null;
    let buf = '';

    switch (o.oclass) {
    case COIN_CLASS:
        return actualn;
    case POTION_CLASS:
        buf = 'potion';
        break;
    case SCROLL_CLASS:
        buf = 'scroll';
        break;
    case WAND_CLASS:
        buf = 'wand';
        break;
    case SPBOOK_CLASS:
        if (otyp === 408) {
            buf = nn ? 'novel' : 'book';
            if (un) buf += ` called ${un}`;
            if (dn) buf += ` (${dn})`;
            return buf;
        }
        buf = 'spellbook';
        break;
    case RING_CLASS:
        buf = 'ring';
        break;
    case AMULET_CLASS:
        buf = nn ? actualn : 'amulet';
        if (un) buf += ` called ${un}`;
        if (dn) buf += ` (${dn})`;
        return buf;
    case ARMOR_CLASS:
        if ((otyp >= LEATHER_GLOVES && otyp <= GAUNTLETS_OF_DEXTERITY)
            || (otyp >= 163 && otyp <= LEVITATION_BOOTS))
            buf = 'pair of ';
        else if (otyp >= 111 && otyp <= 120)
            buf = 'set of ';
        // fall through to the ordinary known/unknown formatting
        break;
    default:
        break;
    }

    if ([POTION_CLASS, SCROLL_CLASS, WAND_CLASS, SPBOOK_CLASS, RING_CLASS]
        .includes(o.oclass)) {
        if (nn) buf = o.oc_unique ? actualn : `${buf} of ${actualn}`;
        if (un) buf += ` called ${un}`;
        if (dn) buf += ` (${dn})`;
        return buf;
    }

    buf += nn ? actualn : (dn || actualn);
    /* C ref: objnam.c:262-266 — the nn half appends " stone" for GemStone(). */
    if (nn && GemStone(otyp)) buf += ' stone';
    if (nn && un) buf += ` called ${un}`;
    if (nn && dn) buf += ` (${dn})`;
    if (!nn && o.oclass === GEM_CLASS)
        buf += o.material === 21 ? ' stone' : ' gem';   /* OBJECT_DATA col is `material` */
    if (!nn && un) buf += ` called ${un}`;
    return buf;
}

// C ref: o_init.c disco_typename() — augment with the Japanese [actual name].
function disco_typename(otyp) {
    let result = disco_obj_typename(otyp);
    if (disco_is_samurai() && disco_japanese_name(otyp)) {
        const actualn = (otyp !== 254 && otyp !== 253) || objects[otyp].oc_name_known
            ? objects[otyp].name : 'harp';
        if (result.includes(' called'))
            result = result.replace(' called', ` [${actualn}] called`);
        else if (result.includes(' ('))
            result = result.replace(' (', ` [${actualn}] (`);
        else
            result = `${result} [${actualn}]`;
    }
    return result;
}

// C ref: shk.c record_price_quote(otyp, price, buyprice) — remember the extreme
// prices a shopkeeper has quoted for a type.  buyprice = what the hero would
// PAY, !buyprice = what a shk offers to pay the hero.
export function record_price_quote(otyp, price, buyprice) {
    const oc = objects[otyp];
    if (!oc || !(price >= 0)) return;
    if (buyprice) {
        if (price > (oc.oc_buy_maxseen ?? 0)) oc.oc_buy_maxseen = price;
        if (price < (oc.oc_buy_minseen ?? Infinity)) oc.oc_buy_minseen = price;
    } else {
        if (price > (oc.oc_sell_maxseen ?? 0)) oc.oc_sell_maxseen = price;
        if (price < (oc.oc_sell_minseen ?? Infinity)) oc.oc_sell_minseen = price;
    }
}

// C ref: shk.c append_price_quote() — " {buy N[-M]}", " {sell N[-M]}" or both.
// Returns '' when neither range has ever been recorded.
export function append_price_quote(otyp) {
    const oc = objects[otyp];
    if (!oc) return '';
    const bmin = oc.oc_buy_minseen ?? Infinity, bmax = oc.oc_buy_maxseen ?? 0;
    const smin = oc.oc_sell_minseen ?? Infinity, smax = oc.oc_sell_maxseen ?? 0;
    if (smin > smax && bmin > bmax) return '';
    let out = ' {', sep = '';
    if (bmin < bmax) { out += `buy ${bmin}-${bmax}`; sep = ' '; }
    else if (bmin === bmax) { out += `buy ${bmin}`; sep = ' '; }
    if (smin < smax) out += `${sep}sell ${smin}-${smax}`;
    else if (smin === smax) out += `${sep}sell ${smin}`;
    return `${out}}`;
}

// Default inv_order (options.c def_inv_order); VENOM_CLASS is appended so any
// pre-discovered venom shows.  C ref: o_init.c dodiscovered() class loop.
// A function, not a const array: mkobj.js's bindings are in TDZ while this
// module is evaluated (display.js imports it from inside mkobj's cycle).
const DISCO_INV_ORDER = () => [
    COIN_CLASS, AMULET_CLASS, WEAPON_CLASS, ARMOR_CLASS, 7 /*FOOD*/,
    SCROLL_CLASS, SPBOOK_CLASS, POTION_CLASS, RING_CLASS, WAND_CLASS,
    6 /*TOOL*/, GEM_CLASS, 14 /*ROCK*/, 15 /*BALL*/, 16 /*CHAIN*/, VENOM_CLASS,
];

// Build the discoveries text rows (default 'o' sort: by order of discovery
// within each class — which for a fresh game equals object order).  Returns
// null when nothing is discovered (caller prints the "haven't discovered…"
// message).  C ref: o_init.c dodiscovered().
export function build_discoveries_rows() {
    getBases();
    const rows = [];
    let ct = 0;
    for (const oclass of DISCO_INV_ORDER()) {
        let printedHeader = false;
        for (const i of discoveryOrder.get(oclass) || []) {
            if (!interesting_to_discover(i)) continue;
            ct++;
            if (!printedHeader) {
                rows.push({ text: className(oclass), header: true });
                printedHeader = true;
            }
            const prefix = objects[i].oc_encountered ? '  ' : '* ';
            // C ref: o_init.c disco_append_typename() — append_price_quote() is
            // NOT gated on iflags.pricequotes here (only objnam.c's doname is),
            // so the discoveries list always shows any shop price the hero has
            // been quoted for this type.
            rows.push({ text: prefix + disco_typename(i) + append_price_quote(i) });
        }
    }
    return ct ? rows : null;
}

const DISCO_CLASS_NAMES = [
    null, 'Illegal objects', 'Weapons', 'Armor', 'Rings', 'Amulets', 'Tools',
    'Comestibles', 'Potions', 'Scrolls', 'Spellbooks', 'Wands', 'Coins',
    'Gems/Stones', 'Boulders/Statues', 'Iron balls', 'Chains', 'Venoms',
];
function className(oclass) {
    return DISCO_CLASS_NAMES[oclass] || DISCO_CLASS_NAMES[1];
}

// ═════════════════════════════════════════════════════════════════════════
// src/o_init.c — the rest of the file.
//
// INERT: nothing above this line calls anything below it, and nothing below
// consumes RNG.  init_objects()/shuffle_all() above own the description
// shuffle; do not wire anything here into that path.
//
// Conventions used here (the port has no C out-parameters):
//   * `char *buf` fill-and-return functions take the buffer argument for
//     signature fidelity, ignore it, and RETURN the string.
//   * `int *` out-parameters are objects with a `.value` field.
//   * The window layer (create_nhwindow/start_menu/select_menu/putstr) is a
//     local record-collecting shim, exactly as js/options.js does it; install
//     DISCO_MENU_DRIVER to drive the interactive functions for real.
//   * Collaborators in other modules are reached by dynamic import() so that
//     o_init.js stays outside the mkobj.js import cycle (see the TDZ notes at
//     the top of this file).
// ═════════════════════════════════════════════════════════════════════════

/* include/objclass.h object classes not already imported above */
const ILLOBJ_CLASS = 1, TOOL_CLASS = 6, FOOD_CLASS = 7, ROCK_CLASS = 14,
      BALL_CLASS = 15, CHAIN_CLASS = 16;
/* include/onames.h otyps */
const STRANGE_OBJECT = 0, SLIME_MOLD = 285, LAST_REAL_GEM = 460;
const CANDELABRUM_OF_INVOCATION = 262, BELL_OF_OPENING = 263,
      AMULET_OF_YENDOR = 213, SPE_BOOK_OF_THE_DEAD = 409;
/* include/hack.h ECMD_OK; include/monsym.h NON_PM */
const ECMD_OK = 0, NON_PM = -1;
/* include/global.h BUFSZ */
const BUFSZ = 256;
/* include/wintype.h */
const NHW_MENU = 4, NHW_TEXT = 5, WIN_ERR = -1;
const PICK_ONE = 1, MENU_BEHAVE_STANDARD = 0;
const MENU_ITEMFLAGS_NONE = 0x0, MENU_ITEMFLAGS_SELECTED = 0x1;
/* include/color.h NO_COLOR; include/hack.h ATR_NONE */
const NO_COLOR = 0, ATR_NONE = 0;
/* include/flag.h menu_style values */
const MENU_TRADITIONAL = 0, MENU_COMBINATION = 1, MENU_FULL = 2,
      MENU_PARTIAL = 3;
/* include/hack.h:964-972 NHFILE mode bits */
const COUNTING = 1, WRITING = 2, FREEING = 8;

// C ref: include/objclass.h def_oc_syms[] (symbols.c).  js/symbols.js:485
// exports the same table but importing it statically would put o_init.js in
// another cycle; only the .sym column is needed here.
const DISCO_OC_SYMS = [
    '\0', ']', ')', '[', '=', '"', '(', '%', '!', '?',
    '+', '/', '$', '*', '`', '0', '_', '.',
];

// C ref: o_init.c:239 init_oclass_probs() writes go.oclass_prob_totals[].
// Exported so a future wiring reads the same array C does.  js/mkobj.js
// computes class totals LAZILY instead (class_probability_total()), so this is
// a second representation of the same numbers, not a second source of truth.
// Left empty at module-eval time: MAXOCLASSES is in TDZ while this module is
// evaluated (o_init.js sits inside the mkobj.js import cycle — see the notes at
// the top of the file), so it is sized on first use instead.
export const oclass_prob_totals = [];

// ── local stand-ins ──
// C ref: hack.h impossible().
function disco_impossible(msg) { game._impossible = msg; }
// C ref: hacklib.c strncmpi()/global.h:113 strcmpi(a,b) == strncmpi(a,b,-1).
// Returns C's -1/0/1, which is what a qsort comparison needs.
function strncmpi(s1, s2, n) {
    let i = 0;
    while (n-- !== 0) {
        if (i >= s2.length) return (i < s1.length) ? 1 : 0; /* s1 >= s2 */
        if (i >= s1.length) return -1;                      /* s1  < s2 */
        const t1 = s1[i].toLowerCase(), t2 = s2[i].toLowerCase();
        ++i;
        if (t1 !== t2) return (t1 > t2) ? 1 : -1;
    }
    return 0; /* s1 == s2 */
}
function strcmpi(a, b) { return strncmpi(a, b, -1); }
// C ref: hacklib.c lowc()/upstart().
function upstart(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
// C ref: dungeon.c ledger_no(dlev)/maxledgerno().  The LEDGER number, not
// depth(): every Gnomish Mines level sits ~25 ledger entries below its depth
// (see js/mkobj.js gem_lev(), which is the verified copy of this arithmetic).
function ledger_no(dlev) {
    const dgns = game.dungeons;
    if (!dgns || !dlev) return 0;
    return (dgns[dlev.dnum ?? 0]?.ledger_start ?? 0) + (dlev.dlevel ?? 1);
}
function maxledgerno() {
    const dgns = game.dungeons;
    if (!dgns) return 0;
    const n = game.n_dgns ?? dgns.length;
    return n ? (dgns[n - 1]?.ledger_start ?? 0) + (dgns[n - 1]?.num_dunlevs ?? 0)
             : 0;
}
// hack.h:971-972 update_file(nhfp)/release_data(nhfp) (js/save.js's `mode`).
function update_file(nhfp) { return ((nhfp?.mode | 0) & (COUNTING | WRITING)); }
function release_data(nhfp) { return ((nhfp?.mode | 0) & FREEING); }

// C ref: o_init.c:35 shuffle_tiles() — after the description shuffle, move each
// object's tile to follow its new appearance, so a red potion is not drawn with
// a blue tile.  Compiled only under TILES_IN_GLYPHMAP, which the recorder's tty
// build does not define, so this is not part of that binary.
//
// C reads the file-scope `glyphmap` plus GLYPH_OBJ_OFF/GLYPH_OBJ_PILETOP_OFF.
// In this port the map lives in js/glyphs.js glyphmap() and the two offsets are
// module-private in js/display.js:3111/3138 — the fix is to export those, not
// to recompute them here, so they are parameters.
export function shuffle_tiles(glyphmap, glyph_obj_off, glyph_obj_piletop_off) {
    let i;
    const tmp_tilemap = [new Array(objects.length), new Array(objects.length)];

    if (!glyphmap) return;      /* TILES_IN_GLYPHMAP not defined */
    for (i = 0; i < objects.length; i++) {
        tmp_tilemap[0][i] = glyphmap[objects[i].oc_descr_idx
                                     + glyph_obj_off].tileidx;
        tmp_tilemap[1][i] = glyphmap[objects[i].oc_descr_idx
                                     + glyph_obj_piletop_off].tileidx;
    }
    for (i = 0; i < objects.length; i++) {
        glyphmap[i + glyph_obj_off].tileidx = tmp_tilemap[0][i];
        glyphmap[i + glyph_obj_piletop_off].tileidx = tmp_tilemap[1][i];
    }
}

// C ref: o_init.c:54 setgemprobs(dlev) — zero out the gems that are too good
// for this depth and re-spread 171 probability points over what is left, then
// recompute the GEM_CLASS total.  Consumes no RNG.  `dlev` null == C's
// (d_level *) 0, which init_objects() passes (lev = 0, hardest gems all off).
//
// js/mkobj.js gem_probability()/gem_lev() compute the same numbers lazily per
// draw instead of mutating oc_prob; that is the copy the live path uses.
export function setgemprobs(dlev) {
    let j, first, lev, sum = 0;
    const bases = getBases();

    if (dlev)
        lev = (ledger_no(dlev) > maxledgerno()) ? maxledgerno()
                                                : ledger_no(dlev);
    else
        lev = 0;
    first = bases[GEM_CLASS];

    for (j = 0; j < 9 - Math.trunc(lev / 3); j++)
        objects[first + j].oc_prob = 0;
    first += j;
    if (first > LAST_REAL_GEM || objects[first].oclass !== GEM_CLASS
        || objects[first].name == null) {
        disco_impossible(`Not enough gems? - first=${first} j=${j}`
                         + ` LAST_GEM=${LAST_REAL_GEM}`);
    }
    for (j = first; j <= LAST_REAL_GEM; j++)
        objects[j].oc_prob =
            Math.trunc((171 + j - first) / (LAST_REAL_GEM + 1 - first));

    /* recompute GEM_CLASS total oc_prob - including rocks/stones */
    for (j = bases[GEM_CLASS]; j < bases[GEM_CLASS + 1]; j++)
        sum += objects[j].oc_prob;
    while (oclass_prob_totals.length < MAXOCLASSES) oclass_prob_totals.push(0);
    oclass_prob_totals[GEM_CLASS] = sum;
}

// C ref: o_init.c:240 init_oclass_probs() — sum oc_prob per class.  Assumes
// bases[] is already set.  ILLOBJ_CLASS is exempt from the zero-total check
// because bases[ILLOBJ_CLASS+1]-1 is not its last item (the generic objects sit
// between it and WEAPON_CLASS, and all of them have probability 0).
export function init_oclass_probs() {
    let i;
    let sum;
    let oclass;
    const bases = getBases();
    while (oclass_prob_totals.length < MAXOCLASSES) oclass_prob_totals.push(0);
    for (oclass = 0; oclass < MAXOCLASSES; ++oclass) {
        sum = 0;
        for (i = bases[oclass]; i < bases[oclass + 1]; ++i) {
            sum += (objects[i]?.oc_prob | 0);
        }
        if (sum <= 0 && oclass !== ILLOBJ_CLASS
            && bases[oclass] !== bases[oclass + 1]) {
            disco_impossible(`${!sum ? 'zero' : 'negative'} (${sum})`
                             + ` probability total for oclass ${oclass}`);
            /* gracefully fail by setting all members of this class to 1 */
            for (i = bases[oclass]; i < bases[oclass + 1]; ++i) {
                if (objects[i]) objects[i].oc_prob = 1;
                sum++;
            }
        }
        oclass_prob_totals[oclass] = sum;
    }
}

// C ref: o_init.c:352 objdescr_is(obj, descr) — does `descr` name this object's
// CURRENT unidentified appearance?  The comparison must go through the shuffled
// oc_descr_idx, which is what OBJ_DESCR() above does.  js/muse.js:599,
// js/potion.js:372, js/spell.js:855 and js/eat.js:3210 each hold a private copy
// of this; eat.js's indexes the description table by obj.otyp instead of by
// oc_descr_idx, so it only agrees when the shuffle was the identity.
export function objdescr_is(obj, descr) {
    if (!obj) {
        disco_impossible('objdescr_is: null obj');
        return false;
    }
    const objdescr = OBJ_DESCR(obj.otyp);
    if (!objdescr)
        return false; /* no obj description, no match */
    return objdescr === descr;
}

// ── C ref: o_init.c svd.disco[NUM_OBJECTS] ──
// For each object class, the run of slots starting at bases[oclass] holds that
// class's discovered otyps in discovery order, terminated by a 0.  The live
// port keeps the same information in the `discoveryOrder` Map above, so the two
// helpers below materialise the C-shaped array on demand rather than keeping a
// second copy in sync.  Neither is a C function.
function disco_view() {
    const bases = getBases();
    const disco = new Array(objects.length).fill(0);
    for (const [oclass, order] of discoveryOrder) {
        let d = bases[oclass];
        for (const otyp of order)
            if (d < disco.length) disco[d++] = otyp;
    }
    return disco;
}
function disco_commit(disco) {
    const bases = getBases();
    for (const oclass of [...discoveryOrder.keys()]) {
        const order = [];
        for (let d = bases[oclass];
             d < objects.length && disco[d] !== 0
                 && objects[d]?.oclass === oclass;
             d++)
            order.push(disco[d]);
        discoveryOrder.set(oclass, order);
    }
}

// C ref: o_init.c:375 savenames(nhfp) — bases[], disco[], every objclass
// record, then the player-applied call-names.  js/storage.js is frozen and owns
// the save format, so (as in js/timeout.js save_timers) the record list is
// RETURNED rather than streamed; js/save.js:848 currently writes
// `{ unported: 'savenames' }` there.
export function savenames(nhfp) {
    let i;
    let len;
    const out = { bases: [], disco: [], objclass: [], uname: {} };
    const bases = getBases();
    const disco = disco_view();

    if (update_file(nhfp)) {
        for (i = 0; i < (MAXOCLASSES + 2); ++i) {
            out.bases.push(bases[i] | 0);                   /* Sfo_int */
        }
        for (i = 0; i < objects.length; ++i) {
            out.disco.push(disco[i] | 0);                   /* Sfo_short */
        }
        for (i = 0; i < objects.length; ++i) {
            out.objclass.push(save_objclass(objects[i]));   /* Sfo_objclass */
        }
    }
    /* as long as we use only one version of Hack we
       need not save oc_name and oc_descr, but we must save
       oc_uname for all objects */
    for (i = 0; i < objects.length; i++)
        if (objects[i]?.oc_uname) {
            if (update_file(nhfp)) {
                len = objects[i].oc_uname.length + 1;
                out.uname[i] = { len, str: objects[i].oc_uname };
            }
            if (release_data(nhfp)) {
                objects[i].oc_uname = 0;
            }
        }
    return out;
}

// C ref: o_init.c:411 restnames(nhfp) — the exact inverse of savenames(); the
// oc_uname loop reads a length then that many bytes for every slot whose
// objclass record said it had a call-name.
export function restnames(nhfp) {
    let i;
    const bases = getBases();
    const inp = nhfp?.names ?? nhfp ?? {};
    const disco = new Array(objects.length).fill(0);

    for (i = 0; i < (MAXOCLASSES + 2); ++i) {
        bases[i] = inp.bases?.[i] | 0;                      /* Sfi_int */
    }
    for (i = 0; i < objects.length; ++i) {
        disco[i] = inp.disco?.[i] | 0;                      /* Sfi_short */
    }
    for (i = 0; i < objects.length; ++i) {
        rest_objclass(objects[i], inp.objclass?.[i]);        /* Sfi_objclass */
    }
    for (i = 0; i < objects.length; i++) {
        if (objects[i]?.oc_uname) {
            objects[i].oc_uname = inp.uname?.[i]?.str ?? null;
        }
    }
    disco_commit(disco);
    /* shuffle_tiles() -- TILES_IN_GLYPHMAP is not defined for this build */
}

// sfbase.c Sfo_objclass()/Sfi_objclass(): the mutable half of an objclass row.
// The immutable columns (name, oclass, oc_prob, ...) come from the object table
// and are never written; C saves the whole struct only because it is one blob.
function save_objclass(o) {
    if (!o) return null;
    return { oc_name_known: o.oc_name_known | 0, oc_encountered: o.oc_encountered | 0,
             oc_descr_idx: o.oc_descr_idx | 0, oc_name_idx: o.oc_name_idx | 0,
             oc_color: o.oc_color | 0, oc_tough: o.oc_tough | 0,
             oc_material: o.oc_material | 0, oc_prob: o.oc_prob | 0,
             oc_dir: o.oc_dir | 0, oc_uname: o.oc_uname ? 1 : 0 };
}
function rest_objclass(o, rec) {
    if (!o || !rec) return;
    o.oc_name_known = rec.oc_name_known;
    o.oc_encountered = rec.oc_encountered;
    o.oc_descr_idx = rec.oc_descr_idx;
    o.oc_name_idx = rec.oc_name_idx;
    o.oc_color = rec.oc_color;
    o.oc_tough = rec.oc_tough;
    o.oc_material = rec.oc_material;
    o.oc_prob = rec.oc_prob;
    o.oc_dir = rec.oc_dir;
    o.oc_uname = rec.oc_uname ? (o.oc_uname || '') : null;
}

// C ref: o_init.c:498 undiscover_object(oindx) — un-calling a type can leave it
// with nothing worth listing, so pull it out of disco[] and shift the rest of
// its class forward one slot.  Only fires when the type is neither name-known
// nor encountered.  gem_learned() re-prices any unpaid gems of that type.
export async function undiscover_object(oindx) {
    const o = objects[oindx];
    if (!o) return;
    if (!o.oc_name_known && !o.oc_encountered) {
        let dindx;
        const acls = o.oclass;
        let found = false;
        const bases = getBases();
        const disco = disco_view();

        /* find the object; shift those behind it forward one slot */
        for (dindx = bases[acls];
             dindx < objects.length && disco[dindx] !== 0
                 && objects[dindx]?.oclass === acls;
             dindx++)
            if (found)
                disco[dindx - 1] = disco[dindx];
            else if (disco[dindx] === oindx)
                found = true;

        /* clear last slot */
        if (found)
            disco[dindx - 1] = 0;
        else
            disco_impossible('named object not in disco');
        disco_commit(disco);

        if (o.oclass === GEM_CLASS) {
            const { gem_learned } = await import('./shk.js');
            gem_learned(oindx); /* ok, it's actually been unlearned */
        }
    }
}

// C ref: o_init.c:543 uniq_objs[] — "unique items or relics", shown as their own
// pseudo-class as well as inside their real class.
const uniq_objs = [
    AMULET_OF_YENDOR,
    /* same order as major oracularity; alphabetical when fully IDed */
    BELL_OF_OPENING,
    SPE_BOOK_OF_THE_DEAD,
    CANDELABRUM_OF_INVOCATION,
];

// C ref: o_init.c:553 discovered_cmp(v1, v2) — the discoveries qsort callback.
// Each line starts with "* " or "  " and those two columns are not part of the
// sort key.  (nethack-c/patches/002-deterministic-qsort.patch pins C's qsort,
// so lines that compare equal keep a fixed order there; Array.sort is stable in
// modern V8, which is the closest equivalent.)
export function discovered_cmp(v1, v2) {
    const s1 = v1, s2 = v2;
    /* each element starts with "* " or "  " but we don't sort by those */
    const res = strcmpi(s1.slice(2), s2.slice(2));

    if (res === 0) {
        ; /* no tie-breaker needed */
    }
    return res;
}

// C ref: o_init.c:567 sortloot_descr(otyp, outbuf) — the six-character
// "%02d%02d%1d " sort key that 'sortdiscoveries:s' prefixes each line with, so
// a plain alphabetical qsort produces sortloot order.  disco_output_sorted()
// strips it back off.  Builds a throwaway obj because loot_classify() wants one.
export async function sortloot_descr(otyp, outbuf) {
    void outbuf;
    const { loot_classify } = await import('./invent.js');
    const sl_cookie = { orderclass: 0, subclass: 0, disco: 0, inuse: 0,
                        obj: null, str: null };
    const o = {};   /* o = cg.zeroobj */

    o.otyp = otyp;
    o.oclass = objects[otyp].oclass;
    o.dknown = 1; /* not observe_object, this isn't a real object */
    o.known = (objects[otyp].oc_name_known || !objects[otyp].oc_uses_known)
              ? 1 : 0;
    o.corpsenm = NON_PM; /* suppress statue and figurine details */
    /* but suppressing fruit details leads to "bad fruit #0" */
    if (otyp === SLIME_MOLD)
        o.spe = game.context?.current_fruit;

    loot_classify(sl_cookie, o);
    return `${String(sl_cookie.orderclass).padStart(2, '0')}`
        + `${String(sl_cookie.subclass).padStart(2, '0')}`
        + `${String(sl_cookie.disco).slice(-1)} `;
}

// C ref: o_init.c:594-606 the 'sortdiscoveries' order codes and their menu text.
const DISCO_BYCLASS = 0;      /* by discovery order within each class */
const DISCO_SORTLOOT = 1;     /* by discovery order within each subclass */
const DISCO_ALPHABYCLASS = 2; /* alphabetized within each class */
const DISCO_ALPHABETIZED = 3; /* alphabetized across all classes */
/* also used in options.c (optfn_sortdiscoveries) */
const disco_order_let = 'osca';
const disco_orders_descr = [
    'by order of discovery within each class',
    "sortloot order (by class with some sub-class groupings)",
    'alphabetical within each class',
    'alphabetical across all classes',
];

// C ref: o_init.c:611 choose_disco_sort(mode) — the 'm' prefix menu that picks
// flags.discosort.  mode: 0 => 'O' command, 1 => full discoveries, 2 => class
// discoveries.  Returns select_menu()'s count (-1 when ESC'd).
export async function choose_disco_sort(mode) {
    let tmpwin;
    const selected = [];
    let any;
    let i, n, choice;
    const clr = NO_COLOR;
    const flags = (game.flags = game.flags || {});

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    any = { a_int: 0 }; /* zero out all bits */
    for (i = 0; i < disco_orders_descr.length; ++i) {
        any = { a_int: disco_order_let.charCodeAt(i) };
        add_menu(tmpwin, null, any, String.fromCharCode(any.a_int),
                 0, ATR_NONE, clr,
                 disco_orders_descr[i],
                 (disco_order_let[i] === flags.discosort)
                    ? MENU_ITEMFLAGS_SELECTED
                    : MENU_ITEMFLAGS_NONE);
    }
    if (mode === 2) {
        /* called via 'm `' where full alphabetize doesn't make sense
           (only showing one class so can't span all classes) but the
           chosen sort will stick and also apply to '\' usage */
        add_menu_str(tmpwin, '');
        add_menu_str(tmpwin,
                     'Note: full alphabetical and alphabetical within class');
        add_menu_str(tmpwin,
                     '      are equivalent for single class discovery, but');
        add_menu_str(tmpwin,
                    '      will matter for future use of total discoveries.');
    }
    end_menu(tmpwin, 'Ordering of discoveries');

    n = await select_menu(tmpwin, PICK_ONE, selected);
    destroy_nhwindow(tmpwin);
    if (n > 0) {
        choice = selected[0].a_int;
        /* skip preselected entry if we have more than one item chosen */
        if (n > 1 && choice === flags.discosort?.charCodeAt?.(0))
            choice = selected[1].a_int;
        flags.discosort = String.fromCharCode(choice);
    }
    return n;
}

// C ref: o_init.c:694 disco_append_typename(buf, dis) — append disco_typename()
// to buf, truncating the user-applied part rather than the " (actual type)"
// tail when the whole thing will not fit in BUFSZ, then append any remembered
// shop price.  Returns the resulting string.
export function disco_append_typename(buf, dis) {
    const len = buf.length;
    const typnm = disco_typename(dis);
    const typnm_len = typnm.length;
    let out;

    if (len + typnm_len < BUFSZ) {
        /* ordinary */
        out = buf + typnm;
    } else {
        const pi = typnm.lastIndexOf('(');
        if (pi > 0 && typnm[pi - 1] === ' ' && typnm.indexOf(')', pi) >= 0) {
            /* typename() returned "really long user-applied name (actual type)"
               and we want to truncate from "really long user-applied name" while
               keeping " (actual type)" intact */
            const p = typnm.slice(pi - 1); /* back up to space before paren */
            const room = BUFSZ - 1 - (len + p.length);
            out = buf + typnm.slice(0, Math.max(0, room)) + p;
        } else {
            /* unexpected; just truncate from end of typename */
            out = buf + typnm.slice(0, Math.max(0, BUFSZ - 1 - len));
        }
    }

    return out + append_price_quote(dis);
}

// C ref: o_init.c:725 disco_fmt_uniq(uidx, outbuf) — the unique/relics section
// wants "papyrus spellbook", not the "spellbook (papyrus)" the spellbooks
// section shows for the same undiscovered Book of the Dead.
export function disco_fmt_uniq(uidx, outbuf) {
    void outbuf;
    let out = `  ${objects[uidx].oc_name_known ? objects[uidx].name
                                               : OBJ_DESCR(uidx)}`;
    if (!objects[uidx].oc_name_known
        && objects[uidx].oclass === SPBOOK_CLASS)
        out += ' spellbook';
    return out;
}

// C ref: o_init.c:741 disco_output_sorted() — sort the collected lines and write
// them out, dropping the six-character sortloot key (but keeping its leading
// '*'/' ' flag) when that is what they were sorted by.
export function disco_output_sorted(tmpwin, sorted_lines, sorted_ct, lootsort) {
    let p;
    let j;

    sorted_lines.length = sorted_ct;
    sorted_lines.sort(discovered_cmp);
    for (j = 0; j < sorted_ct; ++j) {
        p = sorted_lines[j];
        if (lootsort) {
            p = p[0] + p.slice(7);   /* p[6] = p[0]; p += 6 */
        }
        putstr(tmpwin, 0, p);
        sorted_lines[j] = 0;
    }
}

// C ref: o_init.c:877 oclass_to_name(oclass, buf) — let_to_name() lower-cased,
// which is not the same text as def_oc_syms[].name.  className() above is this
// port's copy of invent.c's names[] (== let_to_name(oclass, FALSE, FALSE)).
export function oclass_to_name(oclass, buf) {
    void buf;
    return className(oclass).toLowerCase();
}

// C ref: o_init.c:891 doclassdisco() — the '#knownclass' command.  Prompts for
// one object class (or the pseudo-classes 'u'/'r' for unique items and 'a' for
// artifacts), then lists that class's discoveries in flags.discosort order.
export async function doclassdisco() {
    const prompt = 'View discoveries for which sort of objects?',
          havent_discovered_any = "haven't discovered any %s yet.",
          unique_items = 'unique items or relics',
          artifact_items = 'artifacts';
    let tmpwin = WIN_ERR;
    let pick_list = [];
    let any;
    let c, oclass, menulet, discosyms = '', buf = '';
    const sorted_lines = [];
    let i, ct, dis, xtras, sorted_ct, uidx;
    let traditional, alphabetized, lootsort;
    const clr = NO_COLOR;
    const flags = (game.flags = game.flags || {});
    const arti = await import('./artifact.js');
    const disco = disco_view();

    if (!flags.discosort || disco_order_let.indexOf(flags.discosort) < 0)
        flags.discosort = 'o';

    if (game.iflags?.menu_requested) {
        if (await choose_disco_sort(2) < 0)
            return ECMD_OK;
    }
    alphabetized = (flags.discosort === 'a' || flags.discosort === 'c');
    lootsort = (flags.discosort === 's');

    const ms = await disco_menu_style();
    traditional = (ms === MENU_TRADITIONAL || ms === MENU_COMBINATION);
    if (!traditional) {
        tmpwin = create_nhwindow(NHW_MENU);
        start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    }
    any = { a_int: 0 };
    menulet = 'a';

    /* check whether we've discovered any unique objects */
    for (i = 0; i < uniq_objs.length; i++) {
        uidx = uniq_objs[i];
        if (objects[uidx].oc_name_known
            || (objects[uidx].oc_encountered && uidx !== AMULET_OF_YENDOR)) {
            discosyms += 'u';
            if (!traditional) {
                any = { a_int: 'u'.charCodeAt(0) };
                add_menu(tmpwin, null, any, menulet, 'r',
                         ATR_NONE, clr, unique_items, MENU_ITEMFLAGS_NONE);
                menulet = String.fromCharCode(menulet.charCodeAt(0) + 1);
            }
            break;
        }
    }

    /* check whether we've discovered any artifacts */
    if (arti.disp_artifact_discoveries().count > 0) {
        discosyms += 'a';
        if (!traditional) {
            any = { a_int: 'a'.charCodeAt(0) };
            add_menu(tmpwin, null, any, menulet, 0,
                     ATR_NONE, clr, artifact_items, MENU_ITEMFLAGS_NONE);
            menulet = String.fromCharCode(menulet.charCodeAt(0) + 1);
        }
    }

    /* collect classes with discoveries, in packorder ordering; several
       classes are omitted from packorder and one is of interest here */
    const allclasses = (flags.inv_order || DISCO_INV_ORDER()).slice();
    if (!allclasses.includes(VENOM_CLASS))
        allclasses.push(VENOM_CLASS); /* append char to string */
    /* construct discosyms[] */
    const bases = getBases();
    for (const s of allclasses) {
        oclass = s;
        c = DISCO_OC_SYMS[oclass];
        for (i = bases[oclass];
             i < objects.length && objects[i]?.oclass === oclass; ++i)
            if ((dis = disco[i]) !== 0 && interesting_to_discover(dis)) {
                if (discosyms.indexOf(c) < 0) {
                    discosyms += c;
                    if (!traditional) {
                        any = { a_int: c.charCodeAt(0) };
                        add_menu(tmpwin, null, any,
                                 menulet, c, ATR_NONE, clr,
                                 oclass_to_name(oclass, buf),
                                 MENU_ITEMFLAGS_NONE);
                        menulet = String.fromCharCode(menulet.charCodeAt(0) + 1);
                    }
                }
            }
    }

    /* there might not be anything for us to do... */
    if (!discosyms[0]) {
        await disco_You(havent_discovered_any, 'items');
        if (tmpwin !== WIN_ERR) destroy_nhwindow(tmpwin);
        return ECMD_OK;
    }

    /* have player choose a class */
    c = '\0'; /* class not chosen yet */
    if (traditional) {
        /* we'll prompt even if there's only one viable class; we add all
           nonviable classes as unseen acceptable choices so player can ask
           for discoveries of any class whether it has discoveries or not */
        const allclasses_plustwo = [...allclasses, 'a', 'u', 'r'];
        xtras = 0;
        for (const s of allclasses_plustwo) {
            c = ('aur'.indexOf(s) >= 0) ? s : DISCO_OC_SYMS[s];
            if (discosyms.indexOf(c) < 0) {
                if (!xtras++) discosyms += '\x1b';
                discosyms += c;
            }
        }
        /* get the class (via its symbol character) */
        c = await disco_yn_function(prompt, discosyms, '\0', true);
        if (!c || c === '\0') { /* clear_nhwindow(WIN_MESSAGE) */ }
    } else {
        /* menustyle:full or menustyle:partial */
        if (!discosyms[1] && ms === MENU_PARTIAL) {
            /* only one class; menustyle:partial normally jumps past class
               filtering straight to final menu so skip class filter here */
            c = discosyms[0];
        } else {
            /* more than one choice, or menustyle:full which normally has
               an intermediate class selection menu before the final menu */
            end_menu(tmpwin, prompt);
            i = await select_menu(tmpwin, PICK_ONE, pick_list);
            if (i > 0) {
                c = String.fromCharCode(pick_list[0].a_int);
            } /* else c stays 0 */
        }
        destroy_nhwindow(tmpwin);
    }
    if (!c || c === '\0')
        return ECMD_OK; /* player declined to make a selection */

    /*
     * show discoveries for object class c
     */
    tmpwin = create_nhwindow(NHW_TEXT);
    ct = 0;
    switch (c) {
    case 'u':
    case 'r':
        putstr(tmpwin, disco_menu_heading_attr(), upstart(unique_items));
        for (i = 0; i < uniq_objs.length; i++) {
            uidx = uniq_objs[i];
            if (objects[uidx].oc_name_known
                || (objects[uidx].oc_encountered
                    && uidx !== AMULET_OF_YENDOR)) {
                ++ct;
                buf = disco_fmt_uniq(uidx, buf);
                putstr(tmpwin, 0, buf);
            }
        }
        if (!ct)
            await disco_You(havent_discovered_any, unique_items);
        break;
    case 'a':
        /* note: this will work all the time for menustyle traditional
           but requires at least one artifact discovery for other styles */
        if (game.wizard
            && await disco_y_n('Dump information about all artifacts?') === 'y') {
            for (const row of arti.dump_artifact_info()) putstr(tmpwin, 0, row);
            ct = uniq_objs.length; /* NROFARTIFACTS: non-zero is what matters */
            break;
        }
        /* disp_artifact_discoveries() includes a header */
        {
            const ad = arti.disp_artifact_discoveries();
            for (const row of ad.rows) putstr(tmpwin, 0, row);
            ct = ad.count;
        }
        if (!ct)
            await disco_You(havent_discovered_any, artifact_items);
        break;
    default:
        oclass = def_char_to_objclass(c);
        /* this should never happen but has been observed via the fuzzer */
        if (oclass === MAXOCLASSES)
            disco_impossible(`doclassdisco: invalid object class '${c}'`);
        buf = `Discovered ${className(oclass)} in `
            + `${(flags.discosort === 'o') ? 'order of discovery'
               : (flags.discosort === 's') ? "'sortloot' order"
               : 'alphabetical order'}`;
        putstr(tmpwin, 0, buf); /* skip iflags.menu_headings */
        sorted_ct = 0;
        for (i = bases[oclass]; i <= bases[oclass + 1] - 1; ++i) {
            if ((dis = disco[i]) !== 0 && interesting_to_discover(dis)) {
                ++ct;
                buf = objects[dis].oc_encountered ? '  ' : '* ';
                if (lootsort)
                    buf += await sortloot_descr(dis, buf);
                buf = disco_append_typename(buf, dis);

                if (!alphabetized && !lootsort)
                    putstr(tmpwin, 0, buf);
                else
                    sorted_lines[sorted_ct++] = buf;
            }
        }
        if (!ct) {
            await disco_You(havent_discovered_any, oclass_to_name(oclass, buf));
        } else if (sorted_ct) {
            sorted_lines.length = sorted_ct;
            sorted_lines.sort(discovered_cmp);
            for (i = 0; i < sorted_ct; ++i) {
                let sl = sorted_lines[i];
                if (lootsort) {
                    sl = sl[0] + sl.slice(7);   /* sl[6] = sl[0]; sl += 6 */
                }
                putstr(tmpwin, 0, sl);
                sorted_lines[i] = 0;
            }
        }
        break;
    }
    if (ct)
        await display_nhwindow(tmpwin, true);
    destroy_nhwindow(tmpwin);
    return ECMD_OK;
}

// C ref: o_init.c:1131 rename_disco() — the nameable subset of the discoveries
// list as a PICK_ONE menu, feeding the chosen type into docall().  Unique items,
// artifacts and venom are deliberately skipped.
export async function rename_disco() {
    let i, dis;
    let ct = 0, mn = 0, sl;
    let oclass, prev_class;
    let tmpwin;
    let any;
    const selected = [];
    const clr = NO_COLOR;
    let buf;
    const inv = await import('./invent.js');
    const flags = (game.flags = game.flags || {});
    const bases = getBases();
    const disco = disco_view();
    /* C ref: do_name.c objtyp_is_callable().  js/invent.js:709 holds the
       faithful port but does not export it; prefer that copy the moment it is
       exported rather than letting the fallback below drift. */
    const objtyp_is_callable = inv.objtyp_is_callable || disco_objtyp_is_callable;

    any = { a_int: 0 };
    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);

    /*
     * Skip the "unique objects" section (each will appear within its
     * regular class if it is nameable) and the artifacts section.
     * We assume that classes omitted from packorder aren't nameable
     * so we skip venom too.
     */

    /* for each class, show discoveries in that class */
    for (const s of (flags.inv_order || DISCO_INV_ORDER())) {
        oclass = s;
        prev_class = oclass + 1; /* forced different from oclass */
        for (i = bases[oclass];
             i < objects.length && objects[i]?.oclass === oclass; i++) {
            dis = disco[i];
            if (!dis || !interesting_to_discover(dis))
                continue;
            ct++;
            if (!objtyp_is_callable(dis))
                continue;
            mn++;

            if (oclass !== prev_class) {
                any = { a_int: 0 };
                add_menu_heading(tmpwin, className(oclass));
                prev_class = oclass;
            }
            any = { a_int: dis };
            buf = '';
            buf = disco_append_typename(buf, dis);
            add_menu(tmpwin, null, any, 0, 0,
                     ATR_NONE, clr, buf, MENU_ITEMFLAGS_NONE);
        }
    }
    if (ct === 0) {
        await disco_You("haven't discovered anything yet...");
    } else if (mn === 0) {
        await disco_pline('None of your discoveries can be assigned names...');
    } else {
        end_menu(tmpwin, 'Pick an object type to name');
        dis = STRANGE_OBJECT;
        sl = await select_menu(tmpwin, PICK_ONE, selected);
        if (sl > 0) {
            dis = selected[0].a_int;
        }
        if (dis !== STRANGE_OBJECT) {
            const odummy = {};      /* odummy = cg.zeroobj */

            odummy.otyp = dis;
            odummy.oclass = objects[dis].oclass;
            odummy.quan = 1;
            odummy.known = objects[dis].oc_uses_known ? 0 : 1;
            odummy.dknown = 1; /* not observe_object: it isn't real */
            await inv.docall(odummy);
        }
    }
    destroy_nhwindow(tmpwin);
    return;
}

// C ref: o_init.c:1210 get_sortdisco(opts, cnf) — the 'sortdiscoveries' value
// as the options display and the config-file writer want it: the bare letter
// for a config line, the full description for the 'O' menu.  Returns the string
// (js/doset.js's frozen row "sortdiscoveries  [by order of discovery within
// each class]" is this function's cnf=FALSE answer).
export function get_sortdisco(opts, cnf) {
    void opts;
    const flags = (game.flags = game.flags || {});
    let p = disco_order_let.indexOf(flags.discosort);

    if (p < 0) { flags.discosort = 'o'; p = 0; }
    if (cnf)
        return `${flags.discosort}`;
    return disco_orders_descr[p];
}

// ── window-layer shim (js/options.js uses the identical set) ──
// Install `select` (win, how) -> array of picked `any` values (or -1 for ESC),
// `yn` (query, resp, def) -> character, and `text` (lines) -> void to drive the
// interactive functions above for real.
export const DISCO_MENU_DRIVER = { select: null, yn: null, text: null };

function create_nhwindow(type) { return { type, items: [], query: '', lines: [] }; }
function destroy_nhwindow(_win) { }
function start_menu(win, behave) { win.items.length = 0; win.behave = behave; }
function add_menu(win, _glyphinfo, any, accel, gacc, attr, clr, str, itemflags) {
    win.items.push({ any, accel, gacc, attr, clr, str, itemflags,
                     selectable: any !== null && any !== undefined });
}
function add_menu_str(win, str) { win.items.push({ any: null, str, selectable: false }); }
function add_menu_heading(win, str) {
    win.items.push({ any: null, str, heading: true, selectable: false });
}
function end_menu(win, query) { win.query = query; }
function putstr(win, _attr, str) { win.lines.push(str); }
// Returns C's select_menu() count: >0 picked, 0 confirmed nothing, -1 ESC.
// `picks` is the menu_item** out-param.
async function select_menu(win, how, picks) {
    if (!DISCO_MENU_DRIVER.select) return -1;
    const got = await DISCO_MENU_DRIVER.select(win, how);
    if (!got || got === -1) return -1;
    for (const g of got) picks.push(g);
    return picks.length;
}
async function display_nhwindow(win, _blocking) {
    if (DISCO_MENU_DRIVER.text) await DISCO_MENU_DRIVER.text(win.lines);
}
// C ref: hack.h You()/pline() — the port routes a one-shot message through
// game._pending_message when no display is attached.
async function disco_You(fmt, arg) {
    await disco_pline('You ' + String(fmt).replace('%s', arg ?? ''));
}
async function disco_pline(msg) {
    const disp = await import('./display.js');
    if (disp.pline) await disp.pline(msg);
    else game._pending_message = msg;
}
async function disco_y_n(query) {
    if (DISCO_MENU_DRIVER.yn) return await DISCO_MENU_DRIVER.yn(query, 'yn', 'n');
    return 'n';
}
async function disco_yn_function(query, resp, def, _allow_esc) {
    if (DISCO_MENU_DRIVER.yn) return await DISCO_MENU_DRIVER.yn(query, resp, def);
    return '\0';
}
// C ref: options.c flags.menu_style — js/pickup.js:896 menu_style() converts
// the letter the port stores into the flag.h enum.
async function disco_menu_style() {
    const { menu_style } = await import('./pickup.js');
    return menu_style();
}
// C ref: flag.h iflags.menu_headings.attr — ATR_INVERSE by default.
function disco_menu_heading_attr() { return game.iflags?.menu_headings?.attr ?? 0; }
// C ref: objclass.h def_char_to_objclass(sym) — scan def_oc_syms for the symbol,
// returning MAXOCLASSES when it names no class.  js/invent.js:1281,
// js/options.js:1570 and js/readobjnam.js:87 each keep a private copy.
function def_char_to_objclass(sym) {
    for (let i = 1; i < MAXOCLASSES; i++)
        if (DISCO_OC_SYMS[i] === sym) return i;
    return MAXOCLASSES;
}
// C ref: do_name.c objtyp_is_callable() — fallback for the module-private copy
// in js/invent.js:709 (see rename_disco()).
function disco_objtyp_is_callable(otyp) {
    const ocl = objects[otyp];
    if (!ocl) return false;
    if (ocl.oc_uname) return true;
    if (otyp === AMULET_OF_YENDOR || otyp === AMULET_OF_YENDOR - 1)
        return false;
    return [AMULET_CLASS, SCROLL_CLASS, POTION_CLASS, WAND_CLASS, RING_CLASS,
            GEM_CLASS, SPBOOK_CLASS, ARMOR_CLASS, TOOL_CLASS, VENOM_CLASS]
        .includes(ocl.oclass) && DESCR_BY_OTYP[otyp] != null;
}
/* referenced by name in the comments above; keep the constants live */
void DISCO_BYCLASS; void DISCO_SORTLOOT; void DISCO_ALPHABYCLASS;
void DISCO_ALPHABETIZED; void FOOD_CLASS; void ROCK_CLASS; void BALL_CLASS;
void CHAIN_CLASS; void NHW_TEXT; void MENU_FULL;
