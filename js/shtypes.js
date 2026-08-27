// shtypes.js — shop class table + get_shop_item.
// C ref: shknam.c shtypes[] / get_shop_item().
//
// Leaf module (object-class constants only, no makemon/mkobj imports) so it can
// be imported by both makemon.js (set_mimic_sym shop case) and shknam.js
// (stock_room) without a circular dependency.

import {
    rnd,
} from './rng.js';

// Object-class constants (mkobj.js).  Inlined here (rather than imported) to
// keep shtypes.js a true leaf module: mkobj.js's dependency chain pulls in
// makemon.js, which imports this file, so importing mkobj.js here would form a
// circular import and a temporal-dead-zone error on MAXOCLASSES.
const RANDOM_CLASS = 0, WEAPON_CLASS = 2, ARMOR_CLASS = 3, RING_CLASS = 4,
    AMULET_CLASS = 5, TOOL_CLASS = 6, FOOD_CLASS = 7, POTION_CLASS = 8,
    SCROLL_CLASS = 9, SPBOOK_CLASS = 10, WAND_CLASS = 11, GEM_CLASS = 13,
    MAXOCLASSES = 18;

// C ref: shknam.c — VEGETARIAN_CLASS is the pseudo-class MAXOCLASSES + 1.
export const VEGETARIAN_CLASS = MAXOCLASSES + 1;

// Specific object otyps used by negative iprobs entries.
const POT_FRUIT_JUICE = 319, POT_BOOZE = 317, POT_WATER = 322, ICE_BOX = 216,
    POT_HEALING = 307, POT_FULL_HEALING = 315, SCR_FOOD_DETECTION = 335,
    LUMP_OF_ROYAL_JELLY = 286, WAX_CANDLE = 225, TALLOW_CANDLE = 224,
    BRASS_LANTERN = 226, OIL_LAMP = 227, MAGIC_LAMP = 228, POT_OIL = 321,
    WAN_LIGHT = 410, SCR_LIGHT = 332, SPE_LIGHT = 372,
    LEATHER_GLOVES = 159, ELVEN_CLOAK = 139;

// FODDERSHOP index (health food store) used by set_mimic_sym.
// shtypes order: 0 general, 1 armor, 2 secondhand-book, 3 liquor, 4 weapon,
// 5 deli, 6 jewelers, 7 wand, 8 hardware, 9 rare-books, 10 health-food (FODDER),
// 11 lighting.
export const FODDERSHOP = 10;

// shknms identity tags (the actual name arrays only matter as identity for
// shkinit's TOUCHSTONE / SCR_CHARGING gates).
export const SHKNMS_GENERAL = 'general', SHKNMS_RINGS = 'rings',
    SHKNMS_TOOLS = 'tools', SHKNMS_WANDS = 'wands';

// C ref: shknam.c shtypes[].  Each entry: { name, annotation, symb, prob,
// iprobs[], shknms }.  `annotation` is C's second (shorter) store-type name,
// used only by dungeon.c shop_string() for #overview; C's NULL == absent here.
// Old comment: Each entry: { name, symb, prob, iprobs[],
// shknms }.  iprobs is a list of { iprob, itype } where a negative itype
// means a specific object otyp (mksobj) and a non-negative one a class
// (mkobj / mkclass-style).
export const shtypes = [
    { name: 'general store', symb: RANDOM_CLASS, prob: 42, shknms: SHKNMS_GENERAL,
      iprobs: [ { iprob: 100, itype: RANDOM_CLASS } ] },
    { name: 'used armor dealership', annotation: 'armor shop', symb: ARMOR_CLASS, prob: 14, shknms: 'armors',
      iprobs: [ { iprob: 90, itype: ARMOR_CLASS }, { iprob: 10, itype: WEAPON_CLASS } ] },
    { name: 'second-hand bookstore', annotation: 'scroll shop', symb: SCROLL_CLASS, prob: 10, shknms: 'books',
      iprobs: [ { iprob: 90, itype: SCROLL_CLASS }, { iprob: 10, itype: SPBOOK_CLASS } ] },
    { name: 'liquor emporium', annotation: 'potion shop', symb: POTION_CLASS, prob: 10, shknms: 'liquors',
      iprobs: [ { iprob: 100, itype: POTION_CLASS } ] },
    { name: 'antique weapons outlet', annotation: 'weapon shop', symb: WEAPON_CLASS, prob: 5, shknms: 'weapons',
      iprobs: [ { iprob: 90, itype: WEAPON_CLASS }, { iprob: 10, itype: ARMOR_CLASS } ] },
    { name: 'delicatessen', annotation: 'food shop', symb: FOOD_CLASS, prob: 5, shknms: 'foods',
      iprobs: [ { iprob: 83, itype: FOOD_CLASS }, { iprob: 5, itype: -POT_FRUIT_JUICE },
                { iprob: 4, itype: -POT_BOOZE }, { iprob: 5, itype: -POT_WATER },
                { iprob: 3, itype: -ICE_BOX } ] },
    { name: 'jewelers', annotation: 'ring shop', symb: RING_CLASS, prob: 3, shknms: SHKNMS_RINGS,
      iprobs: [ { iprob: 85, itype: RING_CLASS }, { iprob: 10, itype: GEM_CLASS },
                { iprob: 5, itype: AMULET_CLASS } ] },
    { name: 'quality apparel and accessories', annotation: 'wand shop', symb: WAND_CLASS, prob: 3, shknms: SHKNMS_WANDS,
      iprobs: [ { iprob: 90, itype: WAND_CLASS }, { iprob: 5, itype: -LEATHER_GLOVES },
                { iprob: 5, itype: -ELVEN_CLOAK } ] },
    { name: 'hardware store', annotation: 'tool shop', symb: TOOL_CLASS, prob: 3, shknms: SHKNMS_TOOLS,
      iprobs: [ { iprob: 100, itype: TOOL_CLASS } ] },
    { name: 'rare books', annotation: 'bookstore', symb: SPBOOK_CLASS, prob: 3, shknms: 'books',
      iprobs: [ { iprob: 90, itype: SPBOOK_CLASS }, { iprob: 10, itype: SCROLL_CLASS } ] },
    { name: 'health food store', annotation: 'vegetarian food shop', symb: FOOD_CLASS, prob: 2, shknms: 'healthfoods',
      iprobs: [ { iprob: 70, itype: VEGETARIAN_CLASS }, { iprob: 20, itype: -POT_FRUIT_JUICE },
                { iprob: 4, itype: -POT_HEALING }, { iprob: 3, itype: -POT_FULL_HEALING },
                { iprob: 2, itype: -SCR_FOOD_DETECTION }, { iprob: 1, itype: -LUMP_OF_ROYAL_JELLY } ] },
    { name: 'lighting store', annotation: 'lighting shop', symb: TOOL_CLASS, prob: 0, shknms: 'light',
      iprobs: [ { iprob: 30, itype: -WAX_CANDLE }, { iprob: 44, itype: -TALLOW_CANDLE },
                { iprob: 5, itype: -BRASS_LANTERN }, { iprob: 9, itype: -OIL_LAMP },
                { iprob: 3, itype: -MAGIC_LAMP }, { iprob: 5, itype: -POT_OIL },
                { iprob: 2, itype: -WAN_LIGHT }, { iprob: 1, itype: -SCR_LIGHT },
                { iprob: 1, itype: -SPE_LIGHT } ] },
];

// C ref: shknam.c get_shop_item().  positive value -> class; negative ->
// specific object otyp; can also return the non-existing VEGETARIAN_CLASS.
export function get_shop_item(type) {
    const shp = shtypes[type];
    let j = rnd(100), i = 0;
    while ((j -= shp.iprobs[i].iprob) > 0) i++;
    return shp.iprobs[i].itype;
}
