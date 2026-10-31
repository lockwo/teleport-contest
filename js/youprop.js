// youprop.js — hero property readers shared by modules that cannot import each
// other without a cycle.  C ref: youprop.h.
//
// This port spreads one C property over several spellings (u.uprops.X, u.uprops.HX,
// u.HX, u.uprops_extrinsic[X] for the worn half, the has_innate() derivation for
// role/race grants, u.formprops for the polymorph form).  Every reader that
// answers only some of them is a drift bug (attrib.js poisoned() ignored a worn
// ring of poison resistance), so there is exactly one reader per property here.
import { game } from './gstate.js';
import { mflags1_of, M1_FLY } from './monflags_data.js';
import { POISON_RES, TELEPAT, Is_waterlevel } from './const.js';
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

// C ref: youprop.h Levitation == ((HLevitation || ELevitation) && !BLevitation).
// uprops.Levitation is the intrinsic/timed word, worn boots and rings live in the
// extrinsic store (uprops_extrinsic), blockers in uprops.BLevitation/uprops_blocked.
export function Levitation_hero() {
    const u = game.u;
    const word = (u?.uprops?.Levitation | 0) || ((u?.uprops_extrinsic || {})[48 /* LEVITATION */] | 0);
    const blocked = (u?.uprops?.BLevitation | 0) || ((u?.uprops_blocked || {})[48] | 0);
    return !!word && !blocked;
}
// C ref: youprop.h Flying, incl. a flying steed.
export function Flying_hero() {
    const u = game.u;
    const word = (u?.uprops?.Flying | 0) || ((u?.uprops_extrinsic || {})[49 /* FLYING */] | 0)
        || (u?.usteed && (mflags1_of(u.usteed.data) & M1_FLY));
    const blocked = (u?.uprops?.BFlying | 0) || ((u?.uprops_blocked || {})[49] | 0);
    return !!word && !blocked;
}

// C ref: youprop.h Invis == ((HInvis || EInvis) && !BInvis); EInvis is the worn-item word.
export function Invis_hero() {
    const u = game.u;
    const word = (u?.uprops?.HInvis | 0) || (u?.uprops?.EInvis | 0) || u?.uinvis
        || ((u?.uprops_extrinsic || {})[40 /* INVIS */] | 0);
    const blocked = (u?.uprops?.BInvis | 0) || ((u?.uprops_blocked || {})[40] | 0);
    return !!word && !blocked;
}
// C ref: youprop.h Half_gas_damage — a wet towel worn over the face.
export function Half_gas_damage_hero() {
    const bf = game.ublindf;
    return !!bf && bf.otyp === 234 /* TOWEL */ && (bf.spe | 0) > 0;
}

const ext = (prop) => ((game.u?.uprops_extrinsic || {})[prop] | 0) !== 0;
// C ref: youprop.h Wwalking == ((HWwalking || EWwalking) && !Is_waterlevel(&u.uz)).
// EWwalking in u.uprops is hurtle_jump()'s I_SPECIAL overlay; worn water walking
// boots live in the extrinsic store.
export function Wwalking_hero() {
    const p = game.u?.uprops || {};
    return !!(p.Wwalking || p.HWwalking || p.EWwalking || game.u?.HWwalking
              || game.u?.Wwalking || ext(50 /* WWALKING */))
        && !Is_waterlevel(game.u?.uz);
}
// C ref: youprop.h Passes_walls == (HPasses_walls || EPasses_walls); xorn form via formprops.
export function Passes_walls_hero() {
    const u = game.u;
    const p = u?.uprops || {};
    return !!(u?.formprops?.Passes_walls || p.Passes_walls || p.HPasses_walls
              || p.EPasses_walls || u?.HPasses_walls || ext(53 /* PASSES_WALLS */));
}
// C ref: youprop.h Unchanging == (HUnchanging || EUnchanging).
export function Unchanging_hero() {
    const p = game.u?.uprops || {};
    return !!(p.Unchanging || p.HUnchanging || p.EUnchanging || game.u?.HUnchanging
              || ext(63 /* UNCHANGING */));
}
// C ref: youprop.h Polymorph_control == (HPolymorph_control || EPolymorph_control).
export function Polymorph_control_hero() {
    const p = game.u?.uprops || {};
    return !!(p.Polymorph_control || p.HPolymorph_control || p.EPolymorph_control
              || game.u?.HPolymorph_control || ext(62 /* POLYMORPH_CONTROL */));
}

// C ref: youprop.h Fumbling == (HFumbling || EFumbling).  H is the timed word
// (u.uprops.Fumbling / HFumbling), E the worn-item word (fumbling boots and
// gauntlets live in the extrinsic store).
export function Fumbling_hero() {
    const u = game.u;
    const p = u?.uprops || {};
    return !!(p.Fumbling || p.HFumbling || p.EFumbling || u?.HFumbling || u?.EFumbling
              || ext(25 /* FUMBLING */));
}
