// youprop.js — hero property readers shared by modules that cannot import each
// other without a cycle.  C ref: youprop.h.
//
// This port spreads one C property over several spellings (u.uprops.X, u.uprops.HX,
// u.HX, u.uprops_extrinsic[X] for the worn half, the has_innate() derivation for
// role/race grants, u.formprops for the polymorph form).  Every reader that
// answers only some of them is a drift bug (attrib.js poisoned() ignored a worn
// ring of poison resistance), so there is exactly one reader per property here.
import { game } from './gstate.js';
import { POISON_RES, TELEPAT } from './const.js';
import { has_innate } from './exper.js';

// C ref: youprop.h Poison_resistance == (HPoison_resistance || EPoison_resistance
// || FROMFORM/FROMEXPER/FROMRACE): the worn half is the extrinsic word, role and
// race grants (Healer, every orc) are never stored as flags so they come from
// has_innate(), and the polymorph form is u.formprops (polyself.js set_uasmon()).
export function Poison_resistance() {
    const u = game.u;
    if (u?.formprops?.Poison_resistance) return true;
    const p = u?.uprops || {};
    return !!(p.HPoison_resistance || p.EPoison_resistance
              || p.PoisonResistance || p.Poison_resistance
              || u?.HPoison_resistance || u?.EPoison_resistance
              || u?.Poison_resistance)
        || has_innate('HPoison_resistance')
        || ((u?.uprops_extrinsic || {})[POISON_RES] | 0) !== 0;
}

// C ref: youprop.h Blind_telepat == (HTelepat || ETelepat): timed or eaten
// intrinsic telepathy (u.uprops.Telepat / HTelepat), a worn source (the
// extrinsic word) and the polymorph form's FROMFORM bit (u.formprops.Telepat,
// polyself.js set_uasmon(): a mind flayer or master mind flayer hero is
// telepathic).
export function Blind_telepat() {
    const u = game.u;
    if (u?.formprops?.Telepat) return true;
    const p = u?.uprops || {};
    return !!(p.Telepat || p.HTelepat || p.TELEPAT || u?.HTelepat)
        || ((u?.uprops_extrinsic || {})[TELEPAT] | 0) !== 0;
}
