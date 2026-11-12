// youprop.js — hero property readers shared by modules that cannot import each
// other without a cycle.  C ref: youprop.h.
//
// This port spreads one C property over several spellings (u.uprops.X, u.uprops.HX,
// u.HX, u.uprops_extrinsic[X] for the worn half, the has_innate() derivation for
// role/race grants, u.formprops for the polymorph form).  Every reader that
// answers only some of them is a drift bug (attrib.js poisoned() ignored a worn
// ring of poison resistance), so there is exactly one reader per property here.
import { game } from './gstate.js';
import { mflags1_of, M1_FLY, M1_SWIM } from './monflags_data.js';
import { POISON_RES, TELEPAT, ACID_RES, SICK_RES, Is_waterlevel, I_SPECIAL, TIMEOUT, W_ARTI,
         TT_PIT, is_pit, is_hole } from './const.js';
import { has_innate } from './exper.js';
import { defended } from './artifact.js';
import { AD_DISE } from './monattk_data.js';

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

// C ref: youprop.h Invis == ((HInvis || EInvis) && !BInvis); EInvis is the worn-item
// word, HInvis the timed/intrinsic one (mirrored by u.uinvis) or FROMFORM for a
// stalker or black light polyform (u.formprops, polyself.js set_uasmon()), and
// BInvis the blocked word (mummy wrapping).
export function Invis_hero() {
    const u = game.u;
    const word = (u?.uprops?.HInvis | 0) || (u?.HInvis | 0) || u?.uinvis
        || (u?.uprops?.EInvis | 0) || (u?.EInvis | 0) || u?.formprops?.Invis
        || ((u?.uprops_extrinsic || {})[40 /* INVIS */] | 0);
    const blocked = (u?.uprops?.BInvis | 0) || (u?.BInvis | 0) || ((u?.uprops_blocked || {})[40] | 0);
    return !!word && !blocked;
}
// C ref: youprop.h See_invisible == (HSee_invisible || ESee_invisible).  Sources:
// the timed/potion word (u.uprops.HSee_invisible), a fountain grant (u.See_invisible),
// the worn-item extrinsic word (SEE_INVIS == 29), the polymorph form (FROMFORM,
// polyself.js set_uasmon()) and the role/race innate table (Monk XL1).  jsmain.js
// serves this reader as the u.see_invis accessor.
export function See_invisible_hero() {
    const u = game.u;
    if (u?.formprops?.See_invisible) return true;
    const p = u?.uprops || {};
    return !!(p.HSee_invisible || p.ESee_invisible || p.See_invisible
              || u?.HSee_invisible || u?.ESee_invisible || u?.See_invisible)
        || ((u?.uprops_extrinsic || {})[29 /* SEE_INVIS */] | 0) !== 0
        || has_innate('HSee_invisible');
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

// ── shared H/E readers ──────────────────────────────────────────────────────
// C ref: youprop.h `X (HX || EX)`.  H<Name> is the intrinsic/timed word kept
// as u.uprops.H<Name> (timeout.js timed_uprop, extcmd-handlers wizintrinsic) or
// the older flat u.H<Name>; E<Name> is the worn-item word in uprops_extrinsic.
const hword = (name) => {
    const u = game.u;
    return (u?.uprops?.['H' + name] | 0) || (u?.['H' + name] | 0);
};
const eword = (prop) => ((game.u?.uprops_extrinsic || {})[prop] | 0);
const HALF_SPDAM_P = 55, HALF_PHDAM_P = 56, HUNGER_P = 28, DETECT_MONSTERS_P = 37;
const WOUNDED_LEGS_P = 26, SEE_INVIS_P = 29, LEVITATION_P = 48;

// C ref: youprop.h Half_physical_damage == (HHalf_physical_damage ||
// EHalf_physical_damage): the timed/intrinsic word and the worn extrinsic.
export function Half_physical_damage_hero() {
    return !!(hword('Half_physical_damage') || eword(HALF_PHDAM_P)
              || (game.u?.uprops?.EHalf_physical_damage | 0));
}
// C ref: youprop.h Half_spell_damage == (HHalf_spell_damage || EHalf_spell_damage).
export function Half_spell_damage_hero() {
    return !!(hword('Half_spell_damage') || eword(HALF_SPDAM_P)
              || (game.u?.uprops?.EHalf_spell_damage | 0));
}
// C ref: youprop.h Hunger == (HHunger || EHunger): a worn ring of hunger lives in
// the extrinsic word, the intrinsic half comes from a cursed amulet/eating.
export function Hunger_hero() {
    return !!(hword('Hunger') || eword(HUNGER_P) || (game.u?.uprops?.EHunger | 0));
}
// C ref: youprop.h Detect_monsters == (HDetect_monsters || EDetect_monsters).
export function Detect_monsters_hero() {
    return !!(hword('Detect_monsters') || eword(DETECT_MONSTERS_P)
              || (game.u?.uprops?.EDetect_monsters | 0));
}
// C ref: youprop.h Wounded_legs == (HWounded_legs || EWounded_legs).  The leg
// timer and side mask are the flat u.H/EWounded_legs (trap.js set_wounded_legs).
export function Wounded_legs_hero() {
    const u = game.u;
    return !!((u?.HWounded_legs | 0) || (u?.EWounded_legs | 0)
              || (u?.uprops?.HWounded_legs | 0) || (u?.uprops?.EWounded_legs | 0)
              || eword(WOUNDED_LEGS_P));
}
// C ref: youprop.h Lev_at_will == (((HLevitation & I_SPECIAL) != 0L ||
// (ELevitation & W_ARTI) != 0L) && (HLevitation & ~(I_SPECIAL | TIMEOUT)) == 0L
// && (ELevitation & ~W_ARTI) == 0L).
export function Lev_at_will_hero() {
    const H = game.u?.uprops?.Levitation | 0, E = eword(LEVITATION_P);
    return (((H & I_SPECIAL) !== 0 || (E & W_ARTI) !== 0)
            && (H & ~(I_SPECIAL | TIMEOUT)) === 0 && (E & ~W_ARTI) === 0);
}

// C ref: youprop.h Deaf == (HDeaf || EDeaf || u.uroleplay.deaf).  HDeaf is the
// timed word (u.uprops.HDeaf, the legacy u.uprops.Deaf / u.Deaf spellings),
// EDeaf the worn word, and the `deaf` conduct option lives in u.uroleplay.
const DEAF_P = 16;
export function Deaf_hero() {
    const u = game.u;
    const p = u?.uprops;
    return !!((p?.HDeaf | 0) || (p?.Deaf | 0) || (u?.HDeaf | 0) || !!u?.Deaf
              || (p?.EDeaf | 0) || eword(DEAF_P) || u?.uroleplay?.deaf);
}

// C ref: youprop.h Stunned == HStun: the timed word (u.uprops.Stun mirrored by the
// u.Stunned / u.ustun flags) or FROMFORM for a stalker or bat polyform
// (u.formprops, polyself.js set_uasmon()).
export function Stunned_hero() {
    const u = game.u;
    return !!(u?.formprops?.Stunned || (u?.uprops?.Stun | 0) > 0
              || (u?.uprops?.HStun | 0) > 0 || u?.Stunned || (u?.ustun | 0) > 0);
}

// C ref: youprop.h Acid_resistance == (HAcid_resistance || EAcid_resistance): the
// timed/eaten word (u.uprops.HAcid_resistance), the worn half (yellow dragon
// armor, in the extrinsic store) and the polymorph form's FROMFORM bit.
export function Acid_resistance_hero() {
    const u = game.u;
    if (u?.formprops?.Acid_resistance) return true;
    const p = u?.uprops || {};
    return !!(p.HAcid_resistance || p.EAcid_resistance || p.Acid_resistance
              || p.AcidResistance || u?.HAcid_resistance)
        || ((u?.uprops_extrinsic || {})[ACID_RES] | 0) !== 0;
}
// C ref: youprop.h Sick_resistance == (HSick_resistance || ESick_resistance
// || defended(&gy.youmonst, AD_DISE)); fungus and ghoul forms carry it through
// u.formprops, and defended() covers a hero polymorphed into a green dragon
// (its own scales) or wielding a defending artifact.
export function Sick_resistance_hero() {
    const u = game.u;
    if (u?.formprops?.Sick_resistance) return true;
    const p = u?.uprops || {};
    return !!(p.HSick_resistance || p.ESick_resistance || p.Sick_resistance
              || u?.HSick_resistance)
        || ((u?.uprops_extrinsic || {})[SICK_RES] | 0) !== 0
        || defended(u, AD_DISE);
}
// C ref: youprop.h Stone_resistance / Drain_resistance == (H<X> || E<X> || FROMFORM ||
// FROMRACE/FROMEXPER); the worn word includes dragon_armor_handling()'s extra grants
// (yellow scales: EStone_resistance, black: EDrain_resistance).
const STONE_RES_P = 8, DRAIN_RES_P = 9;
export function Stone_resistance_hero() {
    const u = game.u;
    const p = u?.uprops || {};
    return !!(u?.formprops?.Stone_resistance
              || (p.HStone_resistance | 0) || (p.Stone_resistance | 0) || (p.StoneResistance | 0)
              || (p.EStone_resistance | 0) || u?.Stone_resistance || u?.HStone_resistance
              || eword(STONE_RES_P) || has_innate('HStone_resistance'));
}
export function Drain_resistance_hero() {
    const u = game.u;
    const p = u?.uprops || {};
    return !!(u?.formprops?.Drain_resistance
              || (p.HDrain_resistance | 0) || (p.Drain_resistance | 0)
              || (p.EDrain_resistance | 0) || u?.Drain_resistance || u?.HDrain_resistance
              || eword(DRAIN_RES_P) || has_innate('HDrain_resistance'));
}

// C ref: youprop.h Antimagic == (HAntimagic || EAntimagic || (Upolyd &&
// resists_magm(&youmonst))): the polymorph form's bit is u.formprops, the worn
// half (cloak of magic resistance, gray dragon armor, a wielded Magicbane or a
// carried Platinum Yendorian Express Card) the extrinsic store.
const ANTIMAGIC_P = 12;
export function Antimagic_hero() {
    const u = game.u;
    const p = u?.uprops || {};
    return !!(u?.formprops?.Antimagic
              || (p.HAntimagic | 0) || (p.Antimagic | 0) || (p.EAntimagic | 0)
              || u?.HAntimagic || u?.Antimagic || u?.EAntimagic
              || eword(ANTIMAGIC_P));
}
// C ref: youprop.h Swimming == (HSwimming || ESwimming || (u.usteed &&
// is_swimmer(u.usteed->data))), plus the polymorph form's FROMFORM bit.
const SWIMMING_P = 51;
export function Swimming_hero() {
    const u = game.u;
    const p = u?.uprops || {};
    return !!(u?.formprops?.Swimming || (p.HSwimming | 0) || (p.Swimming | 0) || (p.ESwimming | 0)
              || eword(SWIMMING_P)
              || (u?.usteed && (mflags1_of(u.usteed.data) & M1_SWIM)));
}

// C ref: trap.c:6648 uteetering_at_seen_pit(trap) — the hero escaped a seen pit
// and stands on its brink.
export function uteetering_at_seen_pit(trap) {
    const u = game.u;
    return !!trap && is_pit(trap.ttyp) && !!trap.tseen
        && trap.tx === u.ux && trap.ty === u.uy
        && !(u.utrap && u.utraptype === TT_PIT);
}

// C ref: trap.c:6660 uescaped_shaft(trap) — the hero stands on a seen hole or
// trap door without having fallen through it.
export function uescaped_shaft(trap) {
    const u = game.u;
    return !!trap && is_hole(trap.ttyp) && !!trap.tseen
        && trap.tx === u.ux && trap.ty === u.uy;
}

// C ref: potion.c itimeout(val) — clamp a timeout value to 0..TIMEOUT.
export function itimeout(val) {
    if (val >= TIMEOUT) val = TIMEOUT;
    else if (val < 1) val = 0;
    return val;
}
// C ref: potion.c itimeout_incr(old, incr) — old's TIMEOUT field plus incr, clamped.
export function itimeout_incr(old, incr) {
    return itimeout(((old | 0) & TIMEOUT) + incr);
}
// C ref: potion.c set_itimeout(&prop, val) — replace the TIMEOUT field of
// u.uprops[key], keeping the FROMOUTSIDE/FROMEXPER/... flag bits.
export function set_itimeout(key, val) {
    const u = game.u;
    if (!u) return;
    const p = (u.uprops = u.uprops || {});
    p[key] = (((p[key] | 0) & ~TIMEOUT) | itimeout(val));
}
// C ref: potion.c incr_itimeout(&prop, incr).
export function incr_itimeout(key, incr) {
    set_itimeout(key, itimeout_incr(game.u?.uprops?.[key], incr));
}
