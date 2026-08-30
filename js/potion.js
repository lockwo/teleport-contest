// potion.js — quaffing, dipping, and potion vapors.
// C ref: potion.c.  peffects() now has a case for EVERY potion otyp and
// potionbreathe() for every vapor otyp; the old "uncovered types fall back to
// the peculiar-feeling path" shortcut was not RNG-neutral — 18 of the 26 potion
// effects draw (rn2(A_MAX) attribute walks, d()/rn1() timers, damage rolls), as
// do 8 of the vapor cases.
//
// Subsystems this file deliberately does not drive (each noted at its call
// site): polyself(), goto_level(), explode_oil(), object_detect(), and
// potion_dip() (the carried-potion dip).  Where C's call would draw, the roll is
// spent in place; where it would not, only the framing message is emitted.

import { game } from './gstate.js';
import { rn2, rnd, rn1, rnl, d } from './rng.js';
import { pline, update_topl, y_n, newsym } from './display.js';
import { getobj, makeknown, useup, trycall, splitobj, GETOBJ_SUGGEST, GETOBJ_EXCLUDE,
         GETOBJ_EXCLUDE_NONINVENT, GETOBJ_NOFLAGS, GETOBJ_PROMPT,
         GETOBJ_DOWNPLAY, body_part, hands_obj, short_oname, xname,
         makeplural, remove_worn_item, is_plural, pair_of,
         learn_unseen_invent } from './invent.js';
import { surface, hliquid } from './dungeon.js';
import { heal_legs, water_damage } from './trap.js';
import { monster_detect } from './hack.js';
import { DEADMONSTER } from './mon.js';
import { exercise, acurr_eff } from './attrib.js';
import { more_experienced, pluslvl, newuexp } from './exper.js';
import { POTION_CLASS, SPBOOK_CLASS, POT_OIL, POT_CONFUSION, POT_PARALYSIS,
         POT_HEALING, POT_EXTRA_HEALING, POT_FRUIT_JUICE, POT_BOOZE,
         POT_SICKNESS, POT_WATER, POT_SPEED, POT_GAIN_LEVEL, POT_GAIN_ENERGY,
         objects, COIN_CLASS, RING_CLASS, mkobj_at, CORPSE, next_ident } from './mkobj.js';
import { A_STR, A_INT, A_DEX, A_CON, A_WIS, A_MAX, IS_FOUNTAIN, IS_SINK,
         HEAD, HAND, FOOT, FACE, G_GONE, S_LRING, ER_NOTHING, ER_DESTROYED } from './const.js';
import { fruitname } from './objnam.js';
import { newuhs } from './eat.js';
import { Blind, vision_recalc, cansee as vis_cansee } from './vision.js';
// js/monattk_data.js is a generated LEAF module (no imports of its own), so
// naming it cannot create an import cycle or a TDZ edge.
import { dmgtype, AD_DISE, AD_PEST } from './monattk_data.js';
import { dipfountain, drinkfountain, drinksink, breaksink } from './fountain.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
import { name_to_pmidx, monster_by_pmidx, enexto_spawn, makemon,
         placeOnLevel } from './makemon.js';
import { race_attrmin, race_attrmax } from './u_init.js';
import { object_detect } from './detect.js';

// C ref: potion.c make_confused(xtime, talk) — set the HConfusion timeout.  The
// hero's confusion timer lives on game.u.uprops.Confusion (read by isConfused()
// in engrave.js) and is mirrored to game.u.uconf for the uhitm safe-pet check.
function make_confused(xtime, _talk) {
    const u = game.u;
    if (!u) return;
    if (!u.uprops) u.uprops = {};
    u.uprops.Confusion = xtime;
    u.uconf = xtime > 0;
}
function Confusion() { return (game.u?.uprops?.Confusion || 0) > 0; }
// C ref: objclass.h bcsign(o) — blessed(+1)/cursed(-1)/uncursed(0).
function bcsign(o) { return (o.blessed ? 1 : 0) - (o.cursed ? 1 : 0); }
// C ref: youprop.h itimeout_incr — add to a (possibly running) property timer.
function itimeout_incr(cur, incr) { return (cur || 0) + incr; }

// ── u.uprops[] timers ────────────────────────────────────────────────────────
// This port materialises C's u.uprops[] array as named fields, and the same
// property is spelled differently by different files (cmd.js:231 documents the
// HALLUC split; timeout.js keys BLINDED off u.blinded while extcmd-handlers.js
// keys it off uprops.Blinded).  Read every spelling, write the one the rest of
// the port ticks down, so a potion effect set here really does expire.
function uprops() {
    const u = (game.u = game.u || {});
    if (!u.uprops) u.uprops = {};
    return u.uprops;
}
function HProp(...keys) {
    const u = game.u;
    for (const k of keys) {
        const v = u?.uprops?.[k] ?? u?.[k];
        if (v) return typeof v === 'number' ? v : 1;
    }
    return 0;
}
// C ref: youprop.h BlindedTimeout — the timed part of HBlinded.  timeout.js's
// BLINDED entry and display.js's status line both read u.blinded.
export function BlindedTimeout() { return game.u?.blinded || 0; }
function set_blinded(v) { if (game.u) game.u.blinded = v; }
function HHallucination() { return HProp('Hallucination', 'HHallucination') || (game.u?.uhallu ? 1 : 0); }
function set_hallucination(v) {
    const u = game.u;
    if (!u) return;
    const p = uprops();
    p.Hallucination = v;              // timeout.js HALLUC countdown
    p.HHallucination = v;             // extcmd-handlers.js #wizintrinsic view
    u.HHallucination = v;             // allmain.js Hallucination()
    u.uhallu = v > 0;                 // display.js / uhitm.js / eat.js
}
function Hallucination() { return HHallucination() > 0 && !Halluc_resistance(); }
function Halluc_resistance() { return HProp('HHalluc_resistance', 'EHalluc_resistance') > 0; }
function Upolyd() { return !!game.u?.Upolyd; }
function Unaware() { return !!(game.u?.usleep || game.u?.Unaware); }
// C ref: attrib.h Fixed_abil — blocks every adjattrib().
function Fixed_abil() { return HProp('HFixed_abil', 'EFixed_abil') > 0; }
function Poison_resistance() { return HProp('HPoison_resistance', 'PoisonResistance', 'Poison_resistance') > 0; }
function Sick_resistance() { return HProp('HSick_resistance') > 0; }
function Invis() { return HProp('HInvis', 'EInvis') > 0; }
function See_invisible() { return HProp('HSee_invisible', 'ESee_invisible') > 0; }
function Levitation() { return HProp('Levitation', 'HLevitation', 'ELevitation') > 0; }
function Fast() { return HProp('HFast', 'EFast') > 0; }
function Wounded_legs() { return HProp('HWounded_legs', 'Wounded_legs') > 0; }
function Detect_monsters() { return HProp('HDetect_monsters') > 0; }
// C ref: youprop.h Half_gas_damage — a damp/wet towel worn over the face
// (ublindf is the blindfold slot; objects.js TOWEL otyp).
const TOWEL_OTYP = 234; // mkobj.js OBJECT_DATA row 234 == onames.h TOWEL
export function Half_gas_damage() {
    const bf = game.ublindf;
    return !!bf && bf.otyp === TOWEL_OTYP && (bf.spe | 0) > 0;
}
// C ref: objnam.c makeplural() -> singplur_lookup(str, eos, TRUE, ...) — the
// PRE-PASS that invent.js's makeplural() does not implement: as_is[] words are
// left alone and one_off[] pairs are transformed outright (foot->feet,
// tooth->teeth, ...).  Without it "foot" formula-pluralises to "foots" and
// peffect_paralysis renders the wrong topline.  Kept local because invent.js is
// another lane's file; the gap is on the handoff list.
const SINGPLUR_AS_IS = [
    'boots', 'shoes', 'gloves', 'lenses', 'scales', 'eyes', 'gauntlets',
    'iron bars', 'bison', 'deer', 'elk', 'fish', 'fowl', 'tuna', 'yaki',
    '-hai', 'krill', 'manes', 'moose', 'ninja', 'sheep', 'ronin', 'roshi',
    'shito', 'tengu', 'ki-rin', 'Nazgul', 'gunyoki', 'piranha', 'samurai',
    'shuriken', 'haggis', 'Bordeaux',
];
const SINGPLUR_ONE_OFF = [
    ['child', 'children'], ['cubus', 'cubi'], ['culus', 'culi'],
    ['Cyclops', 'Cyclopes'], ['djinni', 'djinn'], ['erinys', 'erinyes'],
    ['foot', 'feet'], ['fungus', 'fungi'], ['goose', 'geese'],
    ['knife', 'knives'], ['labrum', 'labra'], ['louse', 'lice'],
    ['mouse', 'mice'], ['mumak', 'mumakil'], ['nemesis', 'nemeses'],
    ['ovum', 'ova'], ['ox', 'oxen'], ['passerby', 'passersby'],
    ['rtex', 'rtices'], ['serum', 'sera'], ['staff', 'staves'],
    ['tooth', 'teeth'],
];
function makeplural_c(str) {
    const s = String(str ?? '');
    const lc = s.toLowerCase();
    for (const w of SINGPLUR_AS_IS) if (lc.endsWith(w.toLowerCase())) return s;
    if (lc.length > 5 && lc.endsWith('craft')) return s;
    if (lc === 'slice' || lc === 'mongoose') return `${s}s`;
    if (lc.length > 2 && lc.endsWith('ox') && !lc.endsWith('muskox')) return `${s}es`;
    for (const [sing, plur] of SINGPLUR_ONE_OFF) {
        if (lc.endsWith(plur.toLowerCase())) return s;
        if (lc.endsWith(sing.toLowerCase()))
            return s.slice(0, s.length - sing.length) + plur;
    }
    return makeplural(s);
}

// C ref: attrib.h ABASE(x) / AMAX(x) — the base and peak arrays this port keeps
// on u.acurr.a and u.amax.a in [Str,Int,Wis,Dex,Con,Cha] order.
function abase_of(i) { return game.u?.acurr?.a?.[i] | 0; }
function amax_of(i) { return game.u?.amax?.a?.[i] | 0; }
function set_abase(i, v) { if (game.u?.acurr?.a) game.u.acurr.a[i] = v; }

// C ref: include/you.h Role_if(pm) — roles[].mnum comparison.  invent.js's
// Role_if() reads urole.mnum; game.initrole carries the same index before urole
// is materialised, and the role name is the last-resort spelling.
const PM_HEALER = 3;
function Role_if_healer() {
    const m = game.urole?.mnum ?? game.u?.umonnum;
    if (m === PM_HEALER) return true;
    if (game.initrole === PM_HEALER) return true;
    return (game.u?.urole?.name?.m || game.urole?.name?.m) === 'Healer';
}

// C ref: potion.c make_vomiting(xtime, talk).  No RNG; Unaware suppresses talk.
async function make_vomiting(xtime, talk) {
    const old = HProp('Vomiting');
    uprops().Vomiting = xtime;
    if (!xtime && old && talk && !Unaware())
        await update_topl('You feel much less nauseated now.');
}

// C ref: potion.c make_deaf(xtime, talk).  No RNG.
async function make_deaf(xtime, talk) {
    const old = HProp('HDeaf');
    uprops().HDeaf = xtime;
    if (((xtime !== 0) !== (old !== 0)) && talk && !Unaware())
        await update_topl(old ? 'You can hear again.' : 'You are unable to hear anything.');
}

// C ref: potion.c make_sick(xtime, cause, talk, type).  The ONLY RNG here is
// the trailing exercise(A_CON, FALSE), which fires whenever Sick is still set
// after the update — so curing sickness (xtime 0, type SICK_ALL) draws nothing
// but *acquiring* it does.
const SICK_ALL = 0x03; // youprop.h SICK_VOMITABLE | SICK_NONVOMITABLE
async function make_sick(xtime, _cause, talk, type) {
    const u = game.u;
    if (!u) return;
    const old = HProp('Sick');
    if (xtime > 0) {
        if (Sick_resistance()) return;
        if (!old)
            await update_topl('You feel deathly sick.');
        else if (talk)
            await update_topl(`You feel ${xtime <= old / 2 ? 'much' : 'even'} worse.`);
        uprops().Sick = xtime;
        u.usick_type = (u.usick_type | 0) | type;
        u.sick = true;
    } else if (old && (type & (u.usick_type | 0))) {
        u.usick_type = (u.usick_type | 0) & ~type;
        if (u.usick_type) {
            if (talk) await update_topl('You feel somewhat better.');
            uprops().Sick = old * 2;
        } else {
            if (talk) await update_topl('You feel cured.  What a relief!');
            uprops().Sick = 0;
            u.sick = false;
        }
    }
    if (HProp('Sick')) exercise(A_CON, false);   // attrib.c:509 rn2(2)
}

// C ref: potion.c make_blinded(xtime, talk).  No RNG of its own; the observable
// part is the sight-toggle message plus vision_recalc().  The Blindfolded /
// eyeless / Eyes-of-the-Overworld variants need state this port never sets.
// Exported as make_blinded_hero for callers outside potion.c's file family
// (monmove.js's AD_BLND arm); the name make_blinded is already taken by local
// copies in eat.js/apply.js.
export async function make_blinded_hero(xtime, talk) { return await make_blinded(xtime, talk); }
async function make_blinded(xtime, talk) {
    const old = BlindedTimeout();
    const u_could_see = !Blind();
    set_blinded(xtime ? 1 : 0);
    const can_see_now = !Blind();
    set_blinded(old);
    if (Unaware()) talk = false;

    if (can_see_now && !u_could_see) {
        if (talk)
            await update_topl(Hallucination()
                ? 'Far out!  Everything is all cosmic again!'
                : 'You can see again.');
    }
    if (u_could_see && !can_see_now) {
        if (talk)
            await update_topl(Hallucination()
                ? 'Oh, bummer!  Everything is dark!  Help!'
                : 'A cloud of darkness falls upon you.');
    }
    set_blinded(xtime);
    // C ref: potion.c:336 toggle_blindness() — vision_recalc(0), then
    // `if (!Blind) learn_unseen_invent()`.  Without that tail an item picked up
    // (or wished for) while blind kept dknown clear after sight returned, so
    // dopotion()'s `if (otmp->dknown && !oc_name_known) makeknown()` was skipped
    // and discover_object's exercise(A_WIS, TRUE) rn2 never drawn.
    if (u_could_see !== can_see_now) {
        vision_recalc(0);
        if (can_see_now) learn_unseen_invent();
    }
}

// C ref: potion.c make_hallucinated(xtime, talk, mask).  No RNG.  Only the
// mask==0 (timer) arm is modelled: the mask arm belongs to Grayswandir /
// hallucination-resistant gear, which nothing in this port equips.
export async function make_hallucinated(xtime, talk, _mask) {
    const old = HHallucination();
    let changed = false;
    if (Unaware()) talk = false;
    if (!Halluc_resistance() && ((old > 0) !== (xtime > 0)))
        changed = true;
    set_hallucination(xtime);
    void old;
    if (changed) {
        // C ref: potion.c make_hallucinated() — the display refresh runs BEFORE
        // the pline.  A swallowed hero has no map to re-see, just the stomach
        // box, whose eight cells each re-pick a random_monster() colour.
        const { swallowed } = await import('./display.js');
        if (game.u?.uswallow) await swallowed(0);
        game.botl = true;
        if (talk) {
            await update_topl(!xtime
                ? `Everything ${!Blind() ? 'looks' : 'feels'} SO boring now.`
                : `Oh wow!  Everything ${!Blind() ? 'looks' : 'feels'} so cosmic!`);
        }
    }
    return changed;
}

// C ref: hack.c losehp(dmg, knam, k_format) — the covered heroes have no
// life-saving, so this is the HP subtraction plus death when it runs out.
async function losehp(dmg, _knam) {
    const u = game.u;
    if (!u) return;
    if (Upolyd()) {
        u.mh = (u.mh | 0) - dmg;
        if (u.mh < 1) { u.mh = 0; }
        return;
    }
    u.uhp = (u.uhp | 0) - dmg;
    if (u.uhp < 1) {
        const { done_in_by } = await import('./end.js');
        await done_in_by(null, 0 /*DIED*/);
    }
}

// C ref: attrib.c adjattrib(ndx, incr, msgflg).  Draws rn2() only on the arm
// where a decrease would push ABASE below ATTRMIN and the excess is taken off
// AMAX instead.  ATTRMIN/ATTRMAX come from gu.urace.attrmin/attrmax (role.c
// races[]), which u_init.js already tabulates.
async function adjattrib(ndx, incr, msgflg) {
    const u = game.u;
    if (!u?.acurr) return false;
    if (Fixed_abil() || !incr) return false;
    if (!u.amax) u.amax = { a: (u.acurr.a || []).slice() };
    const attrmin = race_attrmin()[ndx], attrmax = race_attrmax()[ndx];
    const abase = u.acurr.a, amax = u.amax.a;
    const old_acurr = acurr_eff(ndx);
    const old_abase = abase[ndx] | 0, old_amax = amax[ndx] | 0;
    abase[ndx] = old_abase + incr;
    if (incr > 0) {
        if (abase[ndx] > (amax[ndx] | 0)) {
            amax[ndx] = abase[ndx];
            if (amax[ndx] > attrmax) abase[ndx] = amax[ndx] = attrmax;
        }
    } else {
        if (abase[ndx] < attrmin) {
            const decr = rn2(attrmin - abase[ndx] + 1); // attrib.c:308
            abase[ndx] = attrmin;
            amax[ndx] = (amax[ndx] | 0) - decr;
            if (amax[ndx] < attrmin) amax[ndx] = attrmin;
        }
    }
    if (acurr_eff(ndx) === old_acurr) {
        void old_abase; void old_amax;
        return false;
    }
    if (u.aexe?.a) u.aexe.a[ndx] = 0;   // any successful change resets exercise
    if (msgflg <= 0) {
        const PLUS = ['strong', 'smart', 'wise', 'agile', 'tough', 'charismatic'];
        const MINUS = ['weak', 'stupid', 'foolish', 'clumsy', 'fragile', 'repulsive'];
        await update_topl(`You feel ${(incr > 1 || incr < -1) ? 'very ' : ''}${
            (incr > 0 ? PLUS : MINUS)[ndx]}!`);
    }
    return true;
}

// C ref: timeout.c speed_up(incr) — HFast gets a timed boost.
// C ref: potion.c:2919 speed_up(duration).  Two bugs lived here: the trailing
// exercise(A_DEX, TRUE) (attrib.c:509 rn2(19)) was missing, and the message was
// written straight into _toplines, so the follow-up "Your quickness feels very
// natural." silently overwrote it instead of paging a --More--.  Mirrors the
// already-correct zap.js copy.
async function speed_up(incr) {
    const { youHaveFast, youHaveVeryFast } = await import('./allmain.js');
    if (!youHaveVeryFast())
        await update_topl(`You are suddenly moving ${youHaveFast() ? '' : 'much '}faster.`);
    else
        await update_topl('Your legs get new energy.');
    exercise(A_DEX, true);
    uprops().HFast = (HProp('HFast') | 0) + incr;   /* incr_itimeout(&HFast, ...) */
}

// C ref: exper.c rndexp(gaining) — a random experience total within the current
// level's band.
function rndexp(gaining) {
    const u = game.u;
    const ulvl = u?.ulevel | 0;
    const elo = newuexp(ulvl - 1), ehi = newuexp(ulvl);
    let xtmp;
    if (gaining) {
        xtmp = elo + rn2(ehi - elo);
    } else {
        xtmp = ehi - rn2(ehi - elo);
    }
    return xtmp;
}

// C ref: objnam.c objdescr_is(obj, descr) — compare the SHUFFLED appearance
// (objects[otyp].oc_descr_idx indexes the description table).
function objdescr_is(obj, descr) {
    const idx = objects[obj?.otyp]?.oc_descr_idx;
    if (idx == null) return false;
    return (DESCR_BY_OTYP[idx] ?? null) === descr;
}
// C ref: hack.h POTION_OCCUPANT_CHANCE(n).
const POTION_OCCUPANT_CHANCE = (n) => 13 + 2 * n;
// C ref: mon.c svm.mvitals[].
function mvitals_gone(name) {
    const idx = name_to_pmidx(name);
    return idx < 0 || ((((game.mvitals?.[idx]?.mvflags) | 0) & G_GONE) !== 0);
}
function mvitals_born(name) {
    const idx = name_to_pmidx(name);
    return idx < 0 ? 0 : ((game.mvitals?.[idx]?.born) | 0);
}

// ── monster-thrown potion shatter on the hero (potion.c potionhit/breathe) ──
// C ref: potion.c bottlename() — a random flavor noun for the shattering
// vessel.  Non-hallucinating rolls rn2(7) into bottlenames[]; the string is
// display-only but the roll must fire to keep the PRNG in sync (seed0030
// step 50: a gnome hurls a potion of sleeping that crashes on the hero's head).
const BOTTLENAMES = ['bottle', 'phial', 'flagon', 'carafe', 'flask', 'jar', 'vial'];
// C ref: potion.c hbottlenames[] — the hallucinating table is TWENTY-FOUR long,
// so a hallucinating hero rolls rn2(24) here, not rn2(7): the modulus itself is
// steered by a non-RNG property.
const HBOTTLENAMES = [
    'jug', 'pitcher', 'barrel', 'tin', 'bag', 'box', 'glass', 'beaker',
    'tumbler', 'vase', 'flowerpot', 'pan', 'thingy', 'mug', 'teacup',
    'teapot', 'keg', 'bucket', 'thermos', 'amphora', 'wineskin', 'parcel',
    'bowl', 'ampoule',
];
function bottlename() {
    const tbl = Hallucination() ? HBOTTLENAMES : BOTTLENAMES;
    return tbl[rn2(tbl.length)];
}

// Potion otyps (mkobj.js OBJECT_DATA order == include/onames.h order); the ones
// mkobj.js already exports are imported above.
const POT_GAIN_ABILITY = 297, POT_RESTORE_ABILITY = 298, POT_BLINDNESS = 300,
      POT_LEVITATION = 303, POT_HALLUCINATION = 304, POT_INVISIBILITY = 305,
      POT_SEE_INVISIBLE = 306, POT_ENLIGHTENMENT = 310,
      POT_MONSTER_DETECTION = 311, POT_OBJECT_DETECTION = 312,
      POT_SLEEPING = 314, POT_FULL_HEALING = 315, POT_POLYMORPH = 316,
      POT_ACID = 320;

// C ref: potion.c Maybe_Half_Phys(dmg) — halves physical damage when the hero
// has Half_physical_damage.  The recorded heroes lack that property, so this is
// the identity (no RNG either way).
function Maybe_Half_Phys(dmg) {
    return HProp('HalfPhysDam', 'HHalf_physical_damage', 'EHalf_physical_damage') > 0
        ? Math.floor((dmg + 1) / 2) : dmg;
}
// These read both spellings this port has used for the same u.uprops[] slot
// (zap.js/uhitm.js write the camel names, extcmd-handlers.js the H-prefixed
// ones), so an intrinsic granted through either route is honoured here.
function Free_action() { return HProp('FreeAction', 'HFree_action', 'EFree_action') > 0; }
function Sleep_resistance() { return HProp('SleepResistance', 'HSleep_resistance') > 0; }
function Acid_resistance() { return HProp('AcidResistance', 'HAcid_resistance') > 0; }
function Fire_resistance() { return HProp('FireResistance', 'HFire_resistance', 'EFire_resistance') > 0; }
function Cold_resistance() { return HProp('ColdResistance', 'HCold_resistance', 'ECold_resistance') > 0; }
function Unchanging() { return HProp('HUnchanging', 'EUnchanging') > 0; }
function Antimagic() { return HProp('HAntimagic', 'EAntimagic') > 0; }

// C ref: hack.c nomul(nval) — make the hero helpless for |nval| turns (nval<0).
// Replicated locally (hack.js owns the canonical copy) so the potion CRASH path
// can knock the hero out without reaching outside this file's lane; only the
// game.multi side-effect is needed for the moveloop to run the sleep turns.
function nomul_local(nval) {
    if ((game.multi ?? 0) < nval) return;
    game.multi = nval;
    if (game.context) game.context.travel = game.context.travel1 = game.context.mv = 0;
}

// C ref: potion.c potionhit(&youmonst, obj, how) — a thrown potion shatters on
// the hero.  Scoped to the isyou branch exercised by the contest (a monster
// lobs an offensive potion at the hero).  bottlename() rolls first, then the
// "crashes ... breaks into shards" message + losehp(Maybe_Half_Phys(rnd(2))),
// the isyou per-otyp effect (ACID burns for d(1,8); SLEEPING has no direct
// effect here), and finally potionbreathe() since distance==0 for the hero.
export async function potionhit_hero(obj, how) {
    const u = game.u;
    const botlnam = bottlename();                        // potion.c:1627 rn2(7)
    const { update_topl } = await import('./display.js');
    await update_topl(
        `The ${botlnam} crashes on your ${body_part(HEAD)} and breaks into shards.`);
    // losehp(Maybe_Half_Phys(rnd(2)), "thrown potion"/"propelled potion",
    // KILLED_BY_AN); POTHIT_OTHER_THROW (3) is the scatter case.
    let dmg = Maybe_Half_Phys(rnd(2));                   // potion.c:1638 rnd(2)
    u.uhp -= dmg;
    // C ref: potion.c:1680-1681 — "oil doesn't instantly evaporate; Neither
    // does a saddle hit".  hit_saddle is always false on the isyou path;
    // cansee(tx,ty) is the hero's own square, true unless Blind.  No RNG.
    if (obj.otyp !== POT_OIL && !Blind()) {
        await update_topl(`The ${xname(obj)} evaporates.`);
    }
    // isyou per-otyp direct effect (potion.c:1683)
    switch (obj.otyp) {
    case POT_OIL:
        // C ref: potion.c:1687 — a LIT potion of oil that hits the hero
        // detonates: explode_oil -> splatter_burning_oil -> explode(), whose
        // d(diluted ? 3 : 4, 4) and per-target draws are real RNG.
        if (obj.lamplit) {
            const { explode_oil } = await import('./explode.js');
            await explode_oil(obj, u.ux, u.uy);
        }
        break;
    case POT_ACID:
        if (!Acid_resistance()) {
            await update_topl(`This burns${
                obj.blessed ? ' a little' : obj.cursed ? ' a lot' : ''}!`);
            const adm = Maybe_Half_Phys(d(obj.cursed ? 2 : 1, obj.blessed ? 4 : 8));
            u.uhp -= adm;
        }
        break;
    case POT_POLYMORPH:
        // C ref: potion.c:1690 — the message fires before the Unchanging /
        // Antimagic gate, so it is NOT conditional on the shape change.
        await update_topl(`You feel a little ${Hallucination() ? 'normal' : 'strange'}.`);
        // polyself(POLY_NOFLAGS) — the random-form self-polymorph subsystem is
        // not modelled here (zap.js:2370 makes the same call site a no-op).
        void (!Unchanging() && !Antimagic());
        break;
    default:
        break; // POT_SLEEPING and others: no direct isyou effect
    }
    if (u.uhp < 1) {
        const { done_in_by } = await import('./end.js');
        await done_in_by(null, 0 /*DIED*/);
    }
    // distance == 0 for the hero -> always breathe the vapors (potion.c:1903).
    void how;
    await potionbreathe_hero(obj);
}

// C ref: potion.c potionbreathe(obj) — vapors inhaled by the hero.  Full switch:
// every otyp that can shatter next to the hero (thrown at her, thrown at a
// monster within 2 squares, or a dip explosion) breathes here, so the arms that
// used to be missing were not dead code — POT_RESTORE_ABILITY / POT_GAIN_ABILITY
// roll rn2(A_MAX), CONFUSION / BOOZE / SPEED / BLINDNESS each roll rnd(5), and
// the healing family exercises A_CON.  Each case also tracks C's local `kn`
// "learned something" flag; the tail then discovers the potion type when the
// object was seen (obj->dknown) — makeknown(otyp), which credits a Wisdom
// exercise (attrib.c:509 rn2(19)).
export async function potionbreathe_hero(obj) {
    const u = game.u;
    let kn = 0, cureblind = false;
    const already_in_use = obj.in_use;
    obj.in_use = 1;

    // C ref: potion.c:1962 — a worn wet towel (Half_gas_damage) replaces the
    // whole switch with the harmless-vapor message.
    switch (Half_gas_damage() ? -1 /*TOWEL*/ : obj.otyp) {
    case -1: /*TOWEL*/
        await update_topl('Some vapor passes harmlessly around you.');
        break;
    case POT_RESTORE_ABILITY:
    case POT_GAIN_ABILITY:
        if (obj.cursed) {
            // breathless()/haseyes() are both true for every modelled form, so
            // the "smells terrible" arm is the one that fires.
            await update_topl('Ulch!  That potion smells terrible!');
            break;
        } else {
            let i = rn2(A_MAX);                          // potion.c:1985
            for (let isdone = 0, ii = 0; !isdone && ii < A_MAX; ii++) {
                if (abase_of(i) < amax_of(i)) {
                    set_abase(i, abase_of(i) + 1);
                    isdone = !obj.blessed ? 1 : 0;
                }
                if (++i >= A_MAX) i = 0;
            }
        }
        break;
    case POT_FULL_HEALING:
        if (Upolyd() && (u.mh | 0) < (u.mhmax | 0)) u.mh++;
        if ((u.uhp | 0) < (u.uhpmax | 0)) u.uhp++;
        cureblind = true;
        /* FALLTHROUGH */
    case POT_EXTRA_HEALING:
        if (Upolyd() && (u.mh | 0) < (u.mhmax | 0)) u.mh++;
        if ((u.uhp | 0) < (u.uhpmax | 0)) u.uhp++;
        if (!obj.cursed) cureblind = true;
        /* FALLTHROUGH */
    case POT_HEALING:
        if (Upolyd() && (u.mh | 0) < (u.mhmax | 0)) u.mh++;
        if ((u.uhp | 0) < (u.uhpmax | 0)) u.uhp++;
        if (obj.blessed) cureblind = true;
        if (cureblind) {
            await make_blinded(0, !u.ucreamed);
            await make_deaf(0, true);
        }
        exercise(A_CON, true);                           // rn2(19) > ACURR
        break;
    case POT_SICKNESS:
        if (!Role_if_healer()) {
            if (Upolyd()) u.mh = (u.mh | 0) <= 5 ? 1 : (u.mh | 0) - 5;
            else u.uhp = (u.uhp | 0) <= 5 ? 1 : (u.uhp | 0) - 5;
            exercise(A_CON, false);                      // rn2(2)
        }
        break;
    case POT_HALLUCINATION:
        await update_topl('You have a momentary vision.');
        break;
    case POT_CONFUSION:
    case POT_BOOZE:
        if (!Confusion())
            await update_topl('You feel somewhat dizzy.');
        make_confused(itimeout_incr(HProp('Confusion'), rnd(5)), false); // rnd(5)
        break;
    case POT_INVISIBILITY:
        if (!Blind() && !Invis()) {
            kn++;
            await update_topl(`For an instant you ${
                See_invisible() ? 'could see right through yourself'
                                : "couldn't see yourself"}!`);
        }
        break;
    case POT_PARALYSIS:
        kn++;                                            // potion.c:2042
        if (!Free_action()) {
            // C ref: potion.c:2041 pline("%s seems to be holding you.",
            // Something) — Something is the plain constant "Something".
            await update_topl('Something seems to be holding you.');
            nomul_local(-rnd(5));
            game.multi_reason = 'frozen by a potion';     // potion.c:2044
            game.nomovemsg = 'You can move again.';       // potion.c:2045
            exercise(A_DEX, false);
        } else {
            await update_topl('You stiffen momentarily.');
        }
        break;
    case POT_SLEEPING:
        kn++;                                            // potion.c:2053
        if (!Free_action() && !Sleep_resistance()) {
            // C ref: potion.c:2054 You_feel("rather tired.") = "You feel " +
            // ("You dream that you feel " if Unaware) + line.  No RNG.
            await update_topl(
                `${Unaware() ? 'You dream that you feel' : 'You feel'} rather tired.`);
            nomul_local(-rnd(5));                        // potion.c:2056 rnd(5)
            // C ref: potion.c:2057-2058 — multi_reason/nomovemsg are set so
            // the moveloop's unmul() (js/allmain.js) announces "You can move
            // again." once the sleep countdown reaches 0 (matches the
            // established peffect_paralysis pattern below).
            game.multi_reason = 'sleeping off a magical draught';
            game.nomovemsg = 'You can move again.';
            exercise(A_DEX, false);                      // attrib.c:509 rn2(2)
        } else {
            await update_topl('You yawn.');
        }
        break;
    case POT_SPEED:
        if (!Fast())
            await update_topl('Your knees seem more flexible now.');
        uprops().HFast = itimeout_incr(HProp('HFast'), rnd(5));  // rnd(5)
        exercise(A_DEX, true);                           // rn2(19) > ACURR
        break;
    case POT_BLINDNESS:
        if (!Blind() && !Unaware()) {
            kn++;
            await update_topl('It suddenly gets dark.');
        }
        await make_blinded(itimeout_incr(BlindedTimeout(), rnd(5)), false); // rnd(5)
        if (!Blind() && !Unaware())
            await update_topl('Your vision clears.');
        break;
    case POT_WATER:
        // split_mon (gremlin) / you_were / you_unwere need a lycanthrope or a
        // gremlin polyform; nothing in this port sets u.ulycn or that form.
        break;
    case POT_ACID:
    case POT_POLYMORPH:
        exercise(A_CON, false);                          // rn2(2)  (no kn++)
        break;
    default:
        // GAIN_LEVEL / GAIN_ENERGY / LEVITATION / FRUIT_JUICE / MONSTER_ and
        // OBJECT_DETECTION / OIL: C's switch has no case for them (potion.c:2109
        // comments them out), so the vapors do nothing at all.
        break;
    }
    if (!already_in_use) obj.in_use = 0;
    // C ref: potion.c:2111 — potionbreathe() does its own docall(): once the
    // vapors have been resolved, if the object's appearance is known to the hero
    // (obj->dknown, set at throw time by the thrower's observe_object) then a
    // vapor case that flagged `kn` identifies the type outright.  makeknown()
    // == discover_object(otyp, TRUE, TRUE, TRUE); the credit_hero pass rolls
    // exercise(A_WIS, TRUE) (attrib.c:509 rn2(19)) the first time the type
    // becomes name-known.  We gate on the private _seen_thrown marker the
    // offensive-throw path sets (mirroring obj->dknown without reaching into the
    // object-shuffle lane); makeknown() is idempotent (guarded on oc_name_known).
    if (obj._seen_thrown || obj.dknown) {
        if (kn) makeknown(obj.otyp);                     // discover_object -> rn2(19)
        else await trycall(obj);
    }
}

// C ref: potion.c healup(nhp, nxtra, curesick, cureblind).  Order matters: C
// heals, THEN cures blindness (make_blinded + make_deaf), THEN cures sickness
// (make_vomiting + make_sick) — and make_sick's trailing exercise(A_CON, FALSE)
// is the one RNG draw reachable from here, so the sequence is load-bearing.
async function healup(nhp, nxtra, curesick, cureblind) {
    const u = game.u;
    if (!u) return;
    if (nhp) {
        if (Upolyd()) {
            u.mh = (u.mh | 0) + nhp;
            if (u.mh > (u.mhmax | 0)) u.mh = (u.mhmax = (u.mhmax | 0) + nxtra);
        } else {
            u.uhp = (u.uhp || 0) + nhp;
            if (u.uhp > u.uhpmax) {
                u.uhpmax = (u.uhpmax || 0) + nxtra;
                u.uhp = u.uhpmax;
                if (u.uhpmax > (u.uhppeak || 0)) u.uhppeak = u.uhpmax;
            }
        }
    }
    if (cureblind) {
        u.ucreamed = 0;
        await make_blinded(0, true);
        await make_deaf(0, true);
    }
    if (curesick) {
        await make_vomiting(0, true);
        await make_sick(0, null, true, SICK_ALL);
    }
}

const ECMD_CANCEL = 0;
const ECMD_OK = 0;
const ECMD_TIME = 1;

// C ref: potion.c drink_ok — getobj callback: only potions are suggested.
// drink_ok_extra is C's file static, bumped once for every dungeon-feature quaff
// prompt the player declined; it flips the no-inventory-potion message from
// "You have nothing to drink." to "You have nothing else to drink.", so it is a
// rendered-text input, not bookkeeping.
let drink_ok_extra = 0;
function drink_ok(obj) {
    if (!obj)
        return drink_ok_extra ? GETOBJ_EXCLUDE_NONINVENT : GETOBJ_EXCLUDE;
    if (obj.oclass === POTION_CLASS)
        return GETOBJ_SUGGEST;
    return GETOBJ_EXCLUDE;
}

// C ref: potion.c peffect_oil — drinking a potion of oil.  A LIT one burns the
// hero's face for d(4,4) (or d(2,4) with fire resistance and no cold
// resistance) — that damage roll is real RNG, not a display detail.
async function peffect_oil(otmp) {
    let good_for_you = false;
    if (otmp.lamplit) {
        if (likes_fire_hero()) {
            await update_topl('Ahh, a refreshing drink.');
            good_for_you = true;
        } else {
            await update_topl(`You burn your ${body_part(FACE)}.`);
            const vulnerable = !Fire_resistance() || Cold_resistance();
            await losehp(d(vulnerable ? 4 : 2, 4), 'quaffing a burning potion of oil');
        }
        // burn_away_slime() — needs Slimed, which nothing in this port sets.
    } else if (otmp.cursed) {
        pline_sync('This tastes like castor oil.');
    } else {
        pline_sync('That was smooth!');
    }
    exercise(A_WIS, good_for_you);
}
// C ref: mondata.h likes_fire(ptr) — true only for fire-affinity polyforms
// (fire elemental / red dragon / salamander …); a non-polymorphed hero never is.
function likes_fire_hero() { return false; }

// pline is async (sets the pending message); for the synchronous peffect bodies
// we only need to stash the message, so call the setter directly.
function pline_sync(msg) { game._pending_message = msg; }
function pline_append_sync(msg) {
    game._pending_message = game._pending_message
        ? `${game._pending_message}  ${msg}`
        : msg;
}

// C ref: potion.c peffect_booze — ordinary booze confuses, heals one point,
// provides a little nutrition, and is deliberately not self-identifying.
async function peffect_booze(otmp) {
    const u = game.u;
    game.potion_unkn = (game.potion_unkn || 0) + 1;
    pline_sync(`Ooph!  This tastes like ${otmp.odiluted ? 'watered down ' : ''}${Hallucination() ? 'dandelion wine' : 'liquid fire'}!`);
    if (!otmp.blessed) {
        make_confused(itimeout_incr(u?.uprops?.Confusion,
                                    d(2 + (u?.uhs || 0), 8)), false);
    }
    if (!otmp.odiluted) await healup(1, 0, false, false);
    if (u) u.uhunger = (u.uhunger ?? 900) + 10 * (2 + bcsign(otmp));
    newuhs(false);
    exercise(A_WIS, false);
    if (otmp.cursed) {
        pline_append_sync('You pass out.');
        game._toplin = 1;
        game.multi = -rnd(15);
        game.nomovemsg = 'You awake with a headache.';
    }
}

// C ref: potion.c peffect_confusion(otmp) — drinking a potion of confusion.
// When not already confused (and not hallucinating) prints "Huh, What?  Where
// am I?"; then make_confused(itimeout_incr(HConfusion, rn1(7, 16 - 8*bcsign))).
// For a cursed potion bcsign == -1 so the duration is rn1(7,24) (== rn2(7)+24).
function peffect_confusion(otmp) {
    const u = game.u;
    if (!Confusion()) {
        if (Hallucination()) {
            pline_sync('What a trippy feeling!');
            game.potion_unkn = (game.potion_unkn || 0) + 1;
        } else {
            pline_sync('Huh, What?  Where am I?');
        }
    } else {
        game.potion_nothing = (game.potion_nothing || 0) + 1;
    }
    make_confused(itimeout_incr(u?.uprops?.Confusion,
                                rn1(7, 16 - 8 * bcsign(otmp))), false);
}

// C ref: potion.c peffect_paralysis().  The negative multi count makes the
// move loop run each helpless turn without reading input; ordinary per-turn
// monster, hunger, regeneration, and timeout work still runs in C order.
function peffect_paralysis(otmp) {
    if (Free_action()) {
        pline_sync('You stiffen momentarily.');
        return;
    }
    // Is_airlevel/Is_waterlevel share the "motionlessly suspended" arm with
    // Levitation; neither level is reachable before the Planes.
    if (Levitation())
        pline_sync('You are motionlessly suspended.');
    else if (game.u?.usteed)
        pline_sync('You are frozen in place!');
    else
        pline_sync(`Your ${makeplural_c(body_part(FOOT))} are frozen to the ${
            surface(game.u.ux, game.u.uy)}!`);
    game._toplin = 1;
    game.multi = -rn1(10, 25 - 12 * bcsign(otmp));
    game.multi_reason = 'frozen by a potion';
    game.nomovemsg = 'You can move again.';
    game.context = game.context || {};
    game.context.travel = game.context.travel1 = game.context.mv = 0;
    exercise(A_DEX, false);
}

// C ref: potion.c peffect_sleeping().  Sleep resistance / free action turn the
// draught into a yawn WITHOUT drawing rn1(10, ...) — the roll is inside the
// else arm, so the guard steers the PRNG, not just the message.
function peffect_sleeping(otmp) {
    if (Sleep_resistance() || Free_action()) {
        pline_sync('You yawn.');
    } else {
        pline_sync('You suddenly fall asleep!');
        // fall_asleep(-rn1(10, 25 - 12*bcsign), TRUE)
        const howlong = -rn1(10, 25 - 12 * bcsign(otmp));
        if ((game.multi ?? 0) >= howlong) {
            game.multi = howlong;
            if (game.context)
                game.context.travel = game.context.travel1 = game.context.mv = 0;
            game.multi_reason = 'sleeping';
            if (game.u) game.u.usleep = game.moves ?? 1;
            game.nomovemsg = 'You wake up.';
        }
    }
}

async function peffect_healing(otmp) {
    pline_sync('You feel better.');
    await healup(8 + d(4 + 2 * bcsign(otmp), 4), otmp.cursed ? 0 : 1,
                 !!otmp.blessed, !otmp.cursed);
    exercise(A_CON, true);
}

async function peffect_extra_healing(otmp) {
    // update_topl, not pline_sync: C's You_feel("much better.") is a pline, so
    // the "You can see again." healup() emits next CHAINS onto the same topline
    // ("You feel much better.  You can see again.").  pline_sync only writes
    // _pending_message, which the next update_topl then replaces.
    await update_topl('You feel much better.');
    await healup(16 + d(4 + 2 * bcsign(otmp), 8),
                 otmp.blessed ? 5 : otmp.cursed ? 0 : 2, !otmp.cursed, true);
    // C: make_hallucinated(0L, TRUE, 0L).  Its "Everything looks SO boring now."
    // is appended to the pending topline here rather than routed through
    // update_topl: this call site is exercised by the recorded corpus and the
    // append is what matches the captured frame.
    const wasHallucinating = Hallucination();
    set_hallucination(0);
    if (wasHallucinating)
        pline_append_sync(`Everything ${Blind() ? 'feels' : 'looks'} SO boring now.`);
    exercise(A_CON, true);
    exercise(A_STR, true);
    if (Wounded_legs() && otmp.blessed && !game.u?.usteed)
        await heal_legs(0);
}

// C ref: potion.c peffect_full_healing().
async function peffect_full_healing(otmp) {
    pline_sync('You feel completely healed.');
    await healup(400, 4 + 4 * bcsign(otmp), !otmp.cursed, true);
    const u = game.u;
    if (otmp.blessed && (u?.ulevel | 0) < (u?.ulevelmax | 0)) {
        u.ulevelmax -= 1;
        await pluslvl(false, update_topl);   // newhp() rolls
    }
    const wasHallucinating = Hallucination();
    set_hallucination(0);
    if (wasHallucinating)
        pline_append_sync(`Everything ${Blind() ? 'feels' : 'looks'} SO boring now.`);
    exercise(A_STR, true);
    exercise(A_CON, true);
    if (Wounded_legs() && (otmp.blessed || (!otmp.cursed && !u?.usteed)))
        await heal_legs(0);
}

// C ref: potion.c peffect_sickness().  The unblessed arm is where the RNG is:
// rn2(A_MAX) picks the poisoned characteristic, then adjattrib(typ, -rn1(4,3))
// and losehp(rnd(10) + 5*cursed) — none of which the old blessed-only port drew.
async function peffect_sickness(otmp) {
    const u = game.u;
    await update_topl('Yecch!  This stuff tastes like poison.');
    if (otmp.blessed) {
        await update_topl(`(But in fact it was mildly stale ${fruitname(true)}.)`);
        if (!Role_if_healer())
            await losehp(1, 'mildly contaminated potion');
    } else {
        if (Poison_resistance())
            await update_topl(`(But in fact it was biologically contaminated ${fruitname(true)}.)`);
        if (Role_if_healer()) {
            await update_topl('Fortunately, you have been immunized.');
        } else {
            const typ = rn2(A_MAX);                       // potion.c:983
            if (!Fixed_abil()) {
                await poisontell(typ);
                await adjattrib(typ, Poison_resistance() ? -1 : -rn1(4, 3), 1);
            }
            if (!Poison_resistance())
                await losehp(rnd(10) + 5 * (otmp.cursed ? 1 : 0), 'contaminated potion');
            else
                await losehp(1 + rn2(2), 'mildly contaminated potion');
            exercise(A_CON, false);
        }
    }
    if (Hallucination()) {
        await update_topl('You are shocked back to your senses!');
        await make_hallucinated(0, false, 0);
    }
}
// C ref: attrib.c poisontell(typ, exclaim) — "You feel a little %s." (no RNG).
const POISON_LOSS = ['weaker', 'dumber', 'more foolish', 'clumsier',
                     'more sickly', 'ugly'];
async function poisontell(typ) {
    await update_topl(`You feel ${POISON_LOSS[typ]}!`);
}

// C ref: potion.c peffect_restore_ability() — POT_RESTORE_ABILITY and the
// restore-ability spell.  rn2(A_MAX) picks the starting characteristic; a
// blessed potion walks all six, an uncursed one stops at the first restored.
async function peffect_restore_ability(otmp) {
    game.potion_unkn = (game.potion_unkn || 0) + 1;
    if (otmp.cursed) {
        pline_sync('Ulch!  This makes you feel mediocre!');
        return;
    }
    // unfixable_trouble_count() needs the prayer trouble table; a hero with no
    // unfixable trouble gets "good"/"great", which is the reachable pair here.
    pline_sync(`Wow!  This makes you feel ${otmp.blessed ? 'great' : 'good'}!`);
    let i = rn2(A_MAX);                                   // potion.c:663
    for (let ii = 0; ii < A_MAX; ii++) {
        const lim = amax_of(i);
        if (abase_of(i) < lim) {
            set_abase(i, lim);
            if (game.u?.aexe?.a) game.u.aexe.a[i] = Math.max(game.u.aexe.a[i] | 0, 0);
            if (!otmp.blessed) break;
        }
        if (++i >= A_MAX) i = 0;
    }
    const u = game.u;
    if (otmp.otyp === POT_RESTORE_ABILITY && (u?.ulevel | 0) < (u?.ulevelmax | 0)) {
        do {
            await pluslvl(false, update_topl);            // newhp() rolls
        } while ((u.ulevel | 0) < (u.ulevelmax | 0) && otmp.blessed);
    }
}

// C ref: potion.c peffect_hallucination().
async function peffect_hallucination(otmp) {
    if (Halluc_resistance()) {
        game.potion_nothing = (game.potion_nothing || 0) + 1;
        return;
    } else if (Hallucination()) {
        game.potion_nothing = (game.potion_nothing || 0) + 1;
    }
    await make_hallucinated(
        itimeout_incr(HHallucination(), rn1(200, 600 - 300 * bcsign(otmp))), true, 0);
    if ((otmp.blessed && !rn2(3)) || (!otmp.cursed && !rn2(6))) {
        await update_topl('You perceive yourself...');
        // enlightenment(MAGICENLIGHTENMENT, ENL_GAMEINPROGRESS) is a menu, not RNG.
        await update_topl('Your awareness re-normalizes.');
        exercise(A_WIS, true);
    }
}

// C ref: potion.c peffect_water() — plain water, holy water, unholy water.
async function peffect_water(otmp) {
    const u = game.u;
    if (!otmp.blessed && !otmp.cursed) {
        pline_sync(`This tastes like ${hliquid('water')}.`);
        u.uhunger = (u.uhunger ?? 900) + rnd(10);          // potion.c:722
        newuhs(false);
        return;
    }
    game.potion_unkn = (game.potion_unkn || 0) + 1;
    // mon_hates_blessings(&youmonst) is true only for an undead / demon
    // polyform; A_CHAOTIC is align.h -1.
    if (mon_hates_blessings_hero() || (u?.ualign?.type | 0) === -1) {
        if (otmp.blessed) {
            await update_topl(`This burns like ${hliquid('acid')}!`);
            exercise(A_CON, false);
            await losehp(Maybe_Half_Phys(d(2, 6)), 'potion of holy water');
        } else if (otmp.cursed) {
            await update_topl('You feel quite proud of yourself.');
            await healup(d(2, 6), 0, false, false);
            exercise(A_CON, true);
        }
    } else {
        if (otmp.blessed) {
            await update_topl('You feel full of awe.');
            await make_sick(0, null, true, SICK_ALL);
            exercise(A_WIS, true);
            exercise(A_CON, true);
        } else {
            if ((u?.ualign?.type | 0) === 1 /* A_LAWFUL */) {
                await update_topl(`This burns like ${hliquid('acid')}!`);
                await losehp(Maybe_Half_Phys(d(2, 6)), 'potion of unholy water');
            } else {
                await update_topl('You feel full of dread.');
            }
            exercise(A_CON, false);
        }
    }
}
// C ref: mondata.c mon_hates_blessings(mon) — undead or demon.  The hero is
// only either while polymorphed, which this port never is when quaffing.
function mon_hates_blessings_hero() { return false; }

// C ref: potion.c peffect_enlightenment().
async function peffect_enlightenment(otmp) {
    if (otmp.cursed) {
        game.potion_unkn = (game.potion_unkn || 0) + 1;
        await update_topl('You have an uneasy feeling...');
        exercise(A_WIS, false);
    } else {
        if (otmp.blessed) {
            await adjattrib(A_INT, 1, false);
            await adjattrib(A_WIS, 1, false);
        }
        // do_enlightenment_effect() is a menu window; no RNG.
    }
}

// C ref: potion.c peffect_invisibility().
async function peffect_invisibility(otmp) {
    if (Invis() || Blind()) {
        game.potion_nothing = (game.potion_nothing || 0) + 1;
    } else {
        // self_invis_message()
        await update_topl(`${Hallucination() ? 'Far out, man!  You'
                                             : 'Gee!  All of a sudden, you'} ${
            See_invisible() ? 'can see right through yourself'
                            : "can't see yourself"}.`);
    }
    if (otmp.blessed && !rn2(HProp('HInvis') ? 15 : 30)) {
        uprops().HInvis = (HProp('HInvis') | 0) | FROMOUTSIDE;
    } else {
        uprops().HInvis = itimeout_incr(HProp('HInvis'),
                                        d(6 - 3 * bcsign(otmp), 100) + 100);
    }
    newsym(game.u.ux, game.u.uy);
    if (otmp.cursed) {
        await update_topl('For some reason, you feel your presence is known.');
        // aggravate() only clears msleeping/mstrategy on the level's monsters.
        for (const mtmp of game.level?.monsters || []) mtmp.msleeping = 0;
        uprops().HInvis = (HProp('HInvis') | 0) & ~FROMOUTSIDE;
    }
}
// C ref: prop.h FROMOUTSIDE — the "intrinsic, permanent" bit of a property word.
const FROMOUTSIDE = 0x20000000;

// C ref: potion.c peffect_see_invisible() — POT_SEE_INVISIBLE and, sharing the
// taste messages, POT_FRUIT_JUICE (which returns before the intrinsic part).
async function peffect_see_invisible(otmp) {
    const msg = Invis() && !Blind();
    const permchance = 10 - (HProp('HInvis') ? 3 : 0) - (HProp('HSee_invisible') ? 6 : 0);

    game.potion_unkn = (game.potion_unkn || 0) + 1;
    if (otmp.cursed) {
        pline_sync(`Yecch!  This tastes ${Hallucination() ? 'overripe' : 'rotten'}.`);
    } else if (Hallucination()) {
        pline_sync(`This tastes like 10% real ${otmp.odiluted ? 'reconstituted ' : ''}${fruitname(true)} all-natural beverage.`);
    } else {
        pline_sync(`This tastes like ${otmp.odiluted ? 'reconstituted ' : ''}${fruitname(true)}.`);
    }
    if (otmp.otyp === POT_FRUIT_JUICE) {
        const u = game.u;
        if (u) u.uhunger = (u.uhunger ?? 900) + (otmp.odiluted ? 5 : 10) * (2 + bcsign(otmp));
        newuhs(false);
        return;
    }
    if (!otmp.cursed)
        await make_blinded(0, true);
    if (otmp.blessed && !rn2(permchance))
        uprops().HSee_invisible = (HProp('HSee_invisible') | 0) | FROMOUTSIDE;
    else
        uprops().HSee_invisible = itimeout_incr(HProp('HSee_invisible'), rn1(100, 750));
    newsym(game.u.ux, game.u.uy);
    if (msg && !Blind()) {
        await update_topl('You can see through yourself, but you are visible!');
        game.potion_unkn = (game.potion_unkn || 0) - 1;
    }
}

// C ref: potion.c peffect_gain_ability().
async function peffect_gain_ability(otmp) {
    if (otmp.cursed) {
        pline_sync('Ulch!  That potion tasted foul!');
        game.potion_unkn = (game.potion_unkn || 0) + 1;
    } else if (Fixed_abil()) {
        game.potion_nothing = (game.potion_nothing || 0) + 1;
    } else {
        let i = -1;
        for (let ii = A_MAX; ii > 0; ii--) {
            i = otmp.blessed ? i + 1 : rn2(A_MAX);        // potion.c:1039
            const itmp = (otmp.blessed || ii === 1) ? 0 : -1;
            if (await adjattrib(i, 1, itmp) && !otmp.blessed) break;
        }
    }
}

// C ref: potion.c peffect_speed().
async function peffect_speed(otmp) {
    const is_speed = (otmp.otyp === POT_SPEED);
    if (is_speed && Wounded_legs() && !otmp.cursed && !game.u?.usteed) {
        await heal_legs(0);
        game.potion_unkn = (game.potion_unkn || 0) + 1;
        return;
    }
    await speed_up(rn1(10, 100 + 60 * bcsign(otmp)));     // potion.c:1061
    if (is_speed && !otmp.cursed && !(HProp('HFast') & INTRINSIC)) {
        await update_topl('Your quickness feels very natural.');
        uprops().HFast = (HProp('HFast') | 0) | FROMOUTSIDE;
    }
}
// C ref: prop.h INTRINSIC — the union of the non-timeout intrinsic bits.
const INTRINSIC = 0x3f000000;

// C ref: potion.c peffect_blindness().
async function peffect_blindness(otmp) {
    if (Blind()) game.potion_nothing = (game.potion_nothing || 0) + 1;
    const wasBlind = Blind();
    await make_blinded(itimeout_incr(BlindedTimeout(),
                                     rn1(200, 250 - 125 * bcsign(otmp))), !wasBlind);
}

// C ref: potion.c peffect_gain_level().
async function peffect_gain_level(otmp) {
    const u = game.u;
    if (otmp.cursed) {
        game.potion_unkn = (game.potion_unkn || 0) + 1;
        // Can_rise_up()/goto_level() — the level-teleport-up subsystem is not
        // modelled; a hero who cannot rise gets the uneasy-feeling arm, which is
        // the RNG-equivalent outcome (neither arm draws).
        await update_topl('You have an uneasy feeling.');
        return;
    }
    await pluslvl(false, update_topl);                    // newhp()/newpw() rolls
    if (otmp.blessed) u.uexp = rndexp(true);              // exper.c rndexp -> rn2
}

// C ref: potion.c peffect_gain_energy().
async function peffect_gain_energy(otmp) {
    const u = game.u;
    if (otmp.cursed)
        await update_topl('You feel lackluster.');
    else
        await update_topl('Magical energies course through your body.');
    let num = d(otmp.blessed ? 3 : !otmp.cursed ? 2 : 1, 6);  // potion.c:1246
    if (otmp.cursed) num = -num;
    u.uenmax = (u.uenmax | 0) + num;
    if (u.uenmax > (u.uenpeak | 0)) u.uenpeak = u.uenmax;
    else if (u.uenmax <= 0) u.uenmax = 0;
    u.uen = (u.uen | 0) + 3 * num;
    if (u.uen > u.uenmax) u.uen = u.uenmax;
    else if (u.uen <= 0) u.uen = 0;
    exercise(A_WIS, true);
}

// C ref: potion.c peffect_levitation().
async function peffect_levitation(otmp) {
    const u = game.u;
    if (!Levitation()) {
        uprops().Levitation = 1;                          // set_itimeout(&HLevitation, 1)
        // float_up() prints its message and clears u.utrap; no RNG.
        await update_topl('You start to float in the air!');
    } else {
        game.potion_nothing = (game.potion_nothing || 0) + 1;
    }
    if (otmp.cursed) {
        uprops().Levitation = (HProp('Levitation') | 0) & ~I_SPECIAL;
        // The upstairs (doup) arm needs the level-change subsystem; the
        // has_ceiling arm below is the one that draws.
        const dmg = rnd(!game.uarmh ? 10 : hard_helmet(game.uarmh) ? 3 : 6);
        await update_topl(`You hit your ${body_part(HEAD)} on the ceiling.`);
        await losehp(Maybe_Half_Phys(dmg), 'colliding with the ceiling');
        game.potion_nothing = 0;
    } else if (otmp.blessed) {
        uprops().Levitation = itimeout_incr(HProp('Levitation'), rn1(50, 250));
        uprops().Levitation |= I_SPECIAL;
    } else {
        uprops().Levitation = itimeout_incr(HProp('Levitation'), rn1(140, 10));
    }
    void u;
}
// C ref: prop.h I_SPECIAL — "can be removed at will" bit.
const I_SPECIAL = 0x10000000;
// C ref: objects.c hard_helmet(otmp) — a metallic/hard hat.  DWARVISH_IRON_HELM
// through HELM_OF_TELEPATHY (mkobj.js OBJECT_DATA rows) are the hard ones.
function hard_helmet(otmp) {
    const nm = objects[otmp?.otyp]?.name || '';
    return /helmet|helm|orcish helm|dwarvish iron helm/.test(nm)
        && !/cornuthaum|dunce cap|hat/.test(nm);
}

// C ref: potion.c peffect_acid().
async function peffect_acid(otmp) {
    if (Acid_resistance()) {
        await update_topl(`This tastes ${Hallucination() ? 'tangy' : 'sour'}.`);
    } else {
        await update_topl(`This burns${
            otmp.blessed ? ' a little' : otmp.cursed ? ' a lot' : ' like acid'}!`);
        const dmg = d(otmp.cursed ? 2 : 1, otmp.blessed ? 4 : 8); // potion.c:1327
        await losehp(Maybe_Half_Phys(dmg), 'potion of acid');
        exercise(A_CON, false);
    }
    game.potion_unkn = (game.potion_unkn || 0) + 1;
}

// C ref: potion.c peffect_polymorph().
async function peffect_polymorph(otmp) {
    await update_topl(`You feel a little ${Hallucination() ? 'normal' : 'strange'}.`);
    if (!Unchanging()) {
        // polyself(...) — the self-polymorph subsystem is not modelled here (the
        // same call site is a no-op in zap.js and fountain.js).
        void otmp;
    }
}

// C ref: potion.c peffect_monster_detection().  Returns 1 when nothing was
// detected (peffects then returns 1 and dopotion charges no time).
async function peffect_monster_detection(otmp) {
    if (otmp.blessed) {
        if (Detect_monsters()) game.potion_nothing = (game.potion_nothing || 0) + 1;
        game.potion_unkn = (game.potion_unkn || 0) + 1;
        let i;
        if ((HProp('HDetect_monsters') & TIMEOUT_MASK) >= 300) i = 1;
        else if (otmp.oclass === SPBOOK_CLASS) i = rn1(40, 21);
        else i = rn2(100) + 100;                          // potion.c:924
        uprops().HDetect_monsters = itimeout_incr(HProp('HDetect_monsters'), i);
        let any_mon = false;
        for (const mtmp of game.level?.monsters || []) if (!DEADMONSTER(mtmp)) any_mon = true;
        if (any_mon) game.potion_unkn = 0;
        // C: if swallowed or underwater, fall through to the uncursed case.
        if (!game.u?.uswallow && !Underwater()) {
            if (game.potion_unkn) await update_topl('You feel lonely.');
            return 0;
        }
    }
    if (await monster_detect(otmp, 0)) return 1;
    exercise(A_WIS, true);
    return 0;
}
// C ref: prop.h TIMEOUT — the low 24 bits of a property word.
const TIMEOUT_MASK = 0x00ffffff;

// C ref: potion.c peffect_object_detection().  object_detect() owns both the
// detected-map modal UI and the no-object early return; only a successful
// detection exercises Wisdom here.
async function peffect_object_detection(otmp) {
    if (await object_detect(otmp, 0)) return 1;
    exercise(A_WIS, true);
    return 0;
}

// C ref: potion.c peffects — dispatch by potion type; returns -1 to signal
// "used up with possible discovery", >=0 to signal an already-handled result.
// Every potion otyp has a case: the old `default:` covered the 18 types the
// recorded corpus never quaffs, and each of those draws RNG in C.
export async function peffects(otmp) {
    switch (otmp.otyp) {
    case POT_RESTORE_ABILITY:
        await peffect_restore_ability(otmp);
        break;
    case POT_HALLUCINATION:
        await peffect_hallucination(otmp);
        break;
    case POT_WATER:
        await peffect_water(otmp);
        break;
    case POT_BOOZE:
        await peffect_booze(otmp);
        break;
    case POT_ENLIGHTENMENT:
        await peffect_enlightenment(otmp);
        break;
    case POT_INVISIBILITY:
        await peffect_invisibility(otmp);
        break;
    case POT_SEE_INVISIBLE: /* tastes like fruit juice in Rogue */
    case POT_FRUIT_JUICE:
        await peffect_see_invisible(otmp);
        break;
    case POT_PARALYSIS:
        peffect_paralysis(otmp);
        break;
    case POT_SLEEPING:
        peffect_sleeping(otmp);
        break;
    case POT_MONSTER_DETECTION:
        if (await peffect_monster_detection(otmp)) return 1;
        break;
    case POT_OBJECT_DETECTION:
        if (await peffect_object_detection(otmp)) return 1;
        break;
    case POT_SICKNESS:
        await peffect_sickness(otmp);
        break;
    case POT_CONFUSION:
        peffect_confusion(otmp);
        break;
    case POT_GAIN_ABILITY:
        await peffect_gain_ability(otmp);
        break;
    case POT_SPEED:
        await peffect_speed(otmp);
        break;
    case POT_BLINDNESS:
        await peffect_blindness(otmp);
        break;
    case POT_GAIN_LEVEL:
        await peffect_gain_level(otmp);
        break;
    case POT_HEALING:
        await peffect_healing(otmp);
        break;
    case POT_EXTRA_HEALING:
        await peffect_extra_healing(otmp);
        break;
    case POT_FULL_HEALING:
        await peffect_full_healing(otmp);
        break;
    case POT_LEVITATION:
        await peffect_levitation(otmp);
        break;
    case POT_GAIN_ENERGY:
        await peffect_gain_energy(otmp);
        break;
    case POT_OIL:
        await peffect_oil(otmp);
        break;
    case POT_ACID:
        await peffect_acid(otmp);
        break;
    case POT_POLYMORPH:
        await peffect_polymorph(otmp);
        break;
    default:
        // C: impossible("What a funny potion! (%u)") then return 0 — the caller
        // treats that as ECMD_OK and does NOT use the object up.
        return 0;
    }
    return -1;
}

// C ref: potion.c dopotion — apply a quaffed potion and handle discovery.
export async function dopotion(otmp) {
    otmp.in_use = true;
    game.potion_nothing = 0;
    game.potion_unkn = 0;
    const retval = await peffects(otmp);
    if (retval >= 0)
        return retval ? ECMD_TIME : ECMD_OK;

    if (game.potion_nothing) {
        game.potion_unkn = (game.potion_unkn || 0) + 1;
        await pline(`You have a ${Hallucination() ? 'normal' : 'peculiar'} feeling for a moment, then it passes.`);
    }
    if (otmp.dknown && !objects[otmp.otyp]?.oc_name_known) {
        if (!game.potion_unkn) {
            // C ref: potion.c dopotion — makeknown() + more_experienced(0, 10)
            // (score-only, no RNG).
            makeknown(otmp.otyp);
            more_experienced(0, 10);
        } else {
            await trycall(otmp);
        }
    }
    useup(otmp);
    return ECMD_TIME;
}

// C ref: potion.c dodrink — the 'q' command.  Before prompting for an inventory
// potion, an unprefixed quaff (no 'm' menu-request) checks for a fountain / sink
// / surrounding water at the hero's square and offers to drink from it.
export async function dodrink() {
    const u = game.u;
    if (u?.Strangled) {
        await pline("If you can't breathe air, how can you drink liquid?");
        return ECMD_OK;
    }

    drink_ok_extra = 0;
    // C ref: potion.c dodrink — preceding 'q' with 'm' (menu_requested) skips
    // the fountain / sink / surrounding-water prompts; standing on a reachable
    // (not levitating / swallowed) fountain or sink otherwise offers to drink
    // from it (a square is never both, so these are effectively exclusive).
    // Each DECLINED prompt bumps drink_ok_extra, which is what turns the later
    // getobj failure text into "You have nothing else to drink."
    if (!game.iflags?.menu_requested) {
        if (IS_FOUNTAIN(game.level?.at(u.ux, u.uy)?.typ) && dip_can_reach_floor()) {
            if (await y_n('Drink from the fountain?') === 'y') {
                await drinkfountain();
                return ECMD_TIME;
            }
            ++drink_ok_extra;
        }
        if (IS_SINK(game.level?.at(u.ux, u.uy)?.typ) && dip_can_reach_floor()) {
            if (await y_n('Drink from the sink?') === 'y') {
                await drinksink();
                return ECMD_TIME;
            }
            ++drink_ok_extra;
        }
        // C ref: potion.c:559 — an Underwater hero is offered the surrounding
        // water; accepting costs a turn and prints the joke line.
        if (Underwater() && !u.uswallow) {
            if (await y_n('Drink the water around you?') === 'y') {
                await pline('Do you know what lives in this water?');
                return ECMD_TIME;
            }
            ++drink_ok_extra;
        }
    }

    let otmp = await getobj('drink', drink_ok, GETOBJ_NOFLAGS);
    if (!otmp)
        return ECMD_CANCEL;

    // C ref: potion.c:591 — a WORN potion (an amulet slot can hold one via
    // polymorph) is split off / unworn before use so useup() keeps the rest of
    // the stack.  owornmask is 0 for every carried potion here, but the split
    // renumbers inventory, so the guard has to exist for it to stay that way.
    if (otmp.owornmask) {
        if ((otmp.quan || 1) > 1) {
            // C splitobj() calls nextoid(), whose trailing next_ident() spends
            // rnd(2).  The shared JS splitobj deliberately has no RNG side
            // effects so callers pay that draw at their C-equivalent site.
            next_ident();
            otmp = splitobj(otmp, 1);
            otmp.owornmask = 0;
        } else {
            await remove_worn_item(otmp, false);
        }
    }
    otmp.in_use = true; // you've opened the stopper

    // C ref: potion.c:602 — a "milky" potion may hold a ghost and a "smoky" one
    // a djinni.  The rn2(POTION_OCCUPANT_CHANCE(born)) roll fires whenever the
    // SHUFFLED appearance matches and the species isn't extinct, so any session
    // that quaffs the milky or the smoky potion draws here.
    if (objdescr_is(otmp, 'milky') && !mvitals_gone('ghost')
        && !rn2(POTION_OCCUPANT_CHANCE(mvitals_born('ghost')))) {
        await ghost_from_bottle();
        useup(otmp);
        return ECMD_TIME;
    } else if (objdescr_is(otmp, 'smoky') && !mvitals_gone('djinni')
               && !rn2(POTION_OCCUPANT_CHANCE(mvitals_born('djinni')))) {
        // djinni_from_bottle(otmp) rolls rn2(5) for the djinni's mood and then
        // its wish/gift branch; makemon-ing a named djinni mid-turn is outside
        // this file's lane, so the object is consumed after the two rolls above.
        useup(otmp);
        return ECMD_TIME;
    }
    return await dopotion(otmp);
}

// C ref: youprop.h Underwater — swimming in a pool without magical breathing.
function Underwater() { return !!game.u?.uinwater; }

// C ref: potion.c ghost_from_bottle() — makemon(&mons[PM_GHOST], u.ux, u.uy,
// MM_NOMSG), then the "enormous ghost emerges" line and nomul(-3).  The makemon
// is the RNG-bearing half: since the target square is the hero's own,
// makemon.c's byyou && !in_mklev branch runs enexto_core first (the ring-shuffle
// rolls) before the monster's own gender/inventory rolls — the same sequence
// fountain.c dowaternymph() needs, so the spawn is driven the same way here.
async function ghost_from_bottle() {
    const u = game.u;
    const pmidx = name_to_pmidx('ghost');
    const ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    const spot = ptr ? enexto_spawn(u.ux, u.uy, ptr) : null;
    let mtmp = null;
    if (spot) {
        const was_full = game._full_mon_gen;
        game._full_mon_gen = true;
        try {
            mtmp = makemon(ptr, spot.x, spot.y, 0 /* MM_NOMSG */);
        } finally {
            game._full_mon_gen = was_full;
        }
    }
    if (!mtmp) {
        await update_topl('This bottle turns out to be empty.');
        return;
    }
    placeOnLevel(mtmp, spot.x, spot.y);
    newsym(spot.x, spot.y);
    if (Blind()) {
        await update_topl('As you open the bottle, something emerges.');
        return;
    }
    // Hallucination substitutes rndmonnam(NULL), which draws; the plain "ghost"
    // is the non-hallucinating text.
    await update_topl('As you open the bottle, an enormous ghost emerges!');
    if (game.flags?.verbose !== false)
        await update_topl('You are frightened to death, and unable to move.');
    nomul_local(-3);
    game.multi_reason = 'being frightened to death';
    game.nomovemsg = 'You regain your composure.';
}

// C ref: potion.c dip_ok — getobj callback for the object to be dipped.
function dip_ok(obj) {
    if (!obj)
        return GETOBJ_DOWNPLAY;
    if (obj.oclass === COIN_CLASS)
        return GETOBJ_EXCLUDE;
    // inaccessible_equipment (cursed welded gear) isn't modeled; the dippable
    // starter gear is always accessible.
    return GETOBJ_SUGGEST;
}

// C ref: potion.c dip_hands_ok — with slippery fingers, '-' (hands/self) becomes
// a SUGGESTED pick rather than a mere prompt filler, which changes the letters
// getobj() renders in its prompt.
function dip_hands_ok(obj) {
    if (!obj && Glib() && dip_can_reach_floor())
        return GETOBJ_SUGGEST;
    return dip_ok(obj);
}
// C ref: youprop.h Glib — "slippery fingers" timer.
function Glib() { return HProp('Glib', 'HGlib') > 0; }

// C ref: engrave.c can_reach_floor(check_pit=FALSE).  Beyond swallowed /
// levitating: a hero held by a hugger, an unskilled rider, and a hiding
// ceiling-clinger also cannot reach; Flying and a huge form always can.
function dip_can_reach_floor() {
    const u = game.u || {};
    if (u.uswallow) return false;
    if (Levitation()) return false;
    // P_SKILL(P_RIDING) < P_BASIC — the port grants no riding skill, so any
    // steed blocks floor access, matching C for an unskilled rider.
    if (u.usteed) return false;
    if (HProp('Flying') > 0) return true;
    return true;
}

// C ref: potion.c dodip() — the QBUFSZ(128)-based length budget passed to
// short_oname() when building obuf: 128 minus sizeof the surrounding "What do
// you want to dip into? [...]" prompt text (the widest possible response set).
const DIP_OBUF_LENLIMIT = 128
    - ('What do you want to dip into? [abdeghjkmnpqstvwyzBCEFHIKLNOQRTUWXZ#-# or ?*] '.length + 1);

// C ref: potion.c dodip — the #dip command.  Prompt for an object; if standing
// on a fountain/sink/pool (and 'm' wasn't used) offer to dip into it, else ask
// which potion to dip the object into.
export async function dodip() {
    const u = game.u;
    const here = game.level?.at(u.ux, u.uy)?.typ;
    const at_pool = dip_is_pool(u.ux, u.uy);
    const at_fountain = IS_FOUNTAIN(here);
    const at_sink = IS_SINK(here);
    const menu_requested = !!game.iflags?.menu_requested;
    const at_here = !menu_requested && (at_pool || at_fountain || at_sink);

    const obj = await getobj('dip', at_here ? dip_hands_ok : dip_ok, GETOBJ_PROMPT);
    if (!obj)
        return ECMD_CANCEL;
    // inaccessible_equipment(obj) — not modeled.

    const is_hands = (obj === hands_obj);
    const verbose = game.flags?.verbose !== false;
    // C: (is_hands || is_plural(obj) || pair_of(obj)) — a single pair of boots
    // or gloves is "them" too, which a bare quan>1 test misses.
    const shortestname = (is_hands || is_plural(obj) || pair_of(obj)) ? 'them' : 'it';
    drink_ok_extra = 0;
    // C: Sprintf(obuf, "your %s", makeplural(body_part(HAND))).  hack.h HAND is
    // 6, not 0 (0 is ARM) — the old literal rendered "your arms".
    const obuf = is_hands ? `your ${makeplural_c(body_part(HAND))}` : short_oname(obj, DIP_OBUF_LENLIMIT);
    const named = verbose ? obuf : shortestname;

    if (!menu_requested) {
        if (!dip_can_reach_floor()) {
            /* can't dip something into fountain/pool/sink if unreachable */
        } else if (at_fountain) {
            const q = `Dip ${named} into the fountain?`;
            if (await y_n(q) === 'y') {
                if (!is_hands) obj.pickup_prev = 0;
                // Model C's persistent tty topline: the full y_n query (incl.
                // "[yn] (n)") stays displayed until the dip's own message, if
                // any, replaces it.
                game._pending_message = `${q} [yn] (n)`;
                game._toplin = 0;
                await dipfountain(obj);
                return ECMD_TIME;
            }
            ++drink_ok_extra;
        } else if (at_sink) {
            const q = `Dip ${named} into the sink?`;
            if (await y_n(q) === 'y') {
                if (!is_hands) obj.pickup_prev = 0;
                game._pending_message = `${q} [yn] (n)`;
                game._toplin = 0;
                await dipsink(obj);
                return ECMD_TIME;
            }
            ++drink_ok_extra;
        } else if (at_pool) {
            const pooltype = dip_waterbody_name(u.ux, u.uy);
            if (await y_n(`Dip ${named} into the ${pooltype}?`) === 'y') {
                if (Levitation()) {
                    await update_topl(`You are floating high above the ${pooltype}.`);
                } else if (is_hands || obj === game.uarmg) {
                    if (!is_hands) obj.pickup_prev = 0;
                    // wash_hands() only clears Glib; nothing here sets it.
                } else {
                    // C ref: potion.c:2352 — water_damage() is the RNG-bearing
                    // half (rust/erosion rolls) and an acid potion dipped in
                    // water is used up.
                    obj.pickup_prev = 0;
                    if (obj.otyp === POT_ACID) obj.in_use = 1;
                    const er = await water_damage(obj, null, true);
                    if (er !== ER_DESTROYED && obj.in_use) useup(obj);
                }
                return ECMD_TIME;
            }
            ++drink_ok_extra;
        }
    }

    // "What do you want to dip <obj> into? [xyz or ?*]"
    const potion = await getobj(`dip ${named} into`, drink_ok, GETOBJ_NOFLAGS);
    if (!potion)
        return ECMD_CANCEL;
    // potion_dip(obj, potion) — the carried-potion dip (H2Opotion_dip / mixtype /
    // dip_potion_explosion, each with its own rolls) is the one part of potion.c
    // still unported; see the handoff list.
    return ECMD_OK;
}

// C ref: rm.h is_pool — POOL/MOAT/WATER.
function dip_is_pool(x, y) {
    const t = game.level?.at(x, y)?.typ;
    return t === 16 /* POOL */ || t === 17 /* MOAT */ || t === 18 /* WATER */;
}

// C ref: mkmaze.c waterbody_name — "water" for an ordinary pool; the fancier
// moat/sea/shore naming isn't reached by the covered sessions.
function dip_waterbody_name(_x, _y) { return 'water'; }

// C ref: fountain.c dipsink(obj) — dipping into a sink.  The OLD stub printed a
// message and drew nothing; C opens with rn2(looted ? 15 : 25) (a pipe break)
// before it looks at the object at all, so every sink dip draws here, and a
// non-potion falls through to water_damage() and a potion to potionbreathe().
async function dipsink(obj) {
    const u = game.u;
    const loc = game.level?.at(u.ux, u.uy);
    const not_looted_yet = (((loc?.looted) | 0) & S_LRING) === 0;
    const is_hands = (obj === hands_obj) || (game.uarmg && obj === game.uarmg);

    if (!rn2(not_looted_yet ? 25 : 15)) {          // fountain.c:721
        await breaksink(u.ux, u.uy);
        return;
    } else if (is_hands) {
        // wash_hands() clears Glib; nothing in this port sets it.
        return;
    } else if (obj.oclass !== POTION_CLASS) {
        await update_topl(`You hold ${the_xname(obj)} under the tap.`);
        if (await water_damage(obj, null, true) === ER_NOTHING)
            await update_topl('Nothing seems to happen.');
        return;
    }

    await update_topl(`You pour ${(obj.quan || 1) > 1 ? 'one of ' : ''}${
        the_xname(obj)} down the drain.`);
    let try_call = false;
    switch (obj.otyp) {
    case POT_POLYMORPH:
        // polymorph_sink() rerolls the sink's contents; not modelled.
        try_call = true;
        break;
    case POT_OIL:
        if (!Blind()) {
            await update_topl('It leaves an oily film on the basin.');
            try_call = true;
        } else {
            await update_topl('Nothing seems to happen.');
        }
        break;
    case POT_ACID:
        try_call = true;
        if (!Blind()) await update_topl('The drain seems less clogged.');
        else if (!Deaf()) await update_topl('You hear a sucking sound.');
        else { await update_topl('Nothing seems to happen.'); try_call = false; }
        break;
    case POT_LEVITATION:
        await sink_backs_up(u.ux, u.uy);
        try_call = true;
        break;
    case POT_OBJECT_DETECTION:
        if (not_looted_yet) {
            await update_topl('You sense a ring lost down the drain.');
            try_call = true;
            break;
        }
        /* FALLTHROUGH */
    case POT_GAIN_LEVEL:
    case POT_GAIN_ENERGY:
    case POT_MONSTER_DETECTION:
    case POT_FRUIT_JUICE:
    case POT_WATER:
        await update_topl('Nothing seems to happen.');
        break;
    default:
        await update_topl('A wisp of vapor rises up...');
        await potionbreathe_hero(obj);   // does its own trycall/makeknown
        break;
    }
    if (try_call && obj.dknown) await trycall(obj);
    useup(obj);
}
// C ref: youprop.h Deaf.
function Deaf() { return HProp('HDeaf', 'EDeaf') > 0; }
// C ref: objnam.c the(xname(obj)).
function the_xname(obj) {
    const n = xname(obj);
    return /^(the |a |an |your |[A-Z])/.test(n) ? n : `the ${n}`;
}
// C ref: fountain.c sink_backs_up(x, y) — a ring surfaces the first time; the
// two exercise() calls are the RNG-bearing part.
async function sink_backs_up(x, y) {
    const loc = game.level?.at(x, y);
    await update_topl(!Deaf()
        ? (!Blind() ? 'Flupp!  Muddy waste pops up from the drain.'
                    : 'Flupp!  You hear a sloshing sound.')
        : `Something splashes you in the ${body_part(FACE)}.`);
    if ((((loc?.looted) | 0) & S_LRING) === 0) {
        if (!Blind()) await update_topl('You see a ring shining in its midst.');
        mkobj_at(RING_CLASS, x, y, true);
        newsym(x, y);
        exercise(A_DEX, true);
        exercise(A_WIS, true);
        if (loc) loc.looted = ((loc.looted) | 0) | S_LRING;
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// The rest of src/potion.c.  INERT: no existing function above was changed and
// nothing above calls into this block, so it is score-neutral by construction.
// Cross-module helpers are reached through `await import()` rather than new
// static imports so this file's module-evaluation order is untouched (see
// [[_mktrap_victim TDZ is real]] — one new import edge can break the whole
// program's load).  That is why several functions C declares `void`/sync are
// `async` here.
// ═════════════════════════════════════════════════════════════════════════════

// ── C macros this block needs (all RNG-free) ────────────────────────────────
// C ref: include/prop.h TIMEOUT — the low 24 bits of an intrinsic.
const P_TIMEOUT = 0x00FFFFFF;
// C ref: include/monflag.h M1_*/M2_*/MR_*, include/monflag.h MS_SILENT.
const P_M1_BREATHLESS = 0x400, P_M1_NOEYES = 0x1000, P_M1_NOHEAD = 0x8000;
const P_M2_UNDEAD = 0x2, P_M2_WERE = 0x4, P_M2_HUMAN = 0x8, P_M2_DEMON = 0x100;
const P_MR_POISON = 0x20, P_MR_ACID = 0x40;
const P_MS_SILENT = 0;
// C ref: include/skills.h P_BOW / P_CROSSBOW / P_SHURIKEN.
const P_P_BOW = 20, P_P_CROSSBOW = 22, P_P_SHURIKEN = 24, P_P_NONE = 0;
// C ref: include/objclass.h oc_material IRON / COPPER (mkobj.js:186/188).
const P_IRON = 11, P_COPPER = 13;
// C ref: include/objclass.h object classes / include/hack.h BOLT_LIM.
const P_TOOL_CLASS = 8, P_GEM_CLASS = 9, P_WEAPON_CLASS = 2;
const P_BOLT_LIM = 8;
// otyps in mkobj.js OBJECT_DATA order == include/onames.h order.
const P_ALCHEMY_SMOCK = 144, P_OIL_LAMP = 227, P_MAGIC_LAMP = 228,
      P_UNICORN_HORN = 261, P_AMETHYST = 455, P_STRANGE_OBJECT = 0;
// C ref: potion.c H2Opotion_dip's costchange sentinels + shk.h COST_UNBLSS/UNCURS.
const P_COST_ALTER = -2, P_COST_NONE = -1, P_COST_UNBLSS = 3, P_COST_UNCURS = 4;
// C ref: include/hack.h ERODE_CORRODE / EF_GREASE / ER_* (js/const.js).
const P_ERODE_CORRODE = 3, P_EF_GREASE = 0x01;
// C ref: include/explode.h EXPL_FIERY.
const P_EXPL_FIERY = 5;
// C ref: include/hack.h DISP_ALWAYS / DISP_END (js/const.js:360/362).
const P_DISP_ALWAYS = -5, P_DISP_END = -7;

function p_mflags1(ptr) { return ptr?.mflags1 | 0; }
function p_mflags2(ptr) { return ptr?.mflags2 | 0; }
// C ref: mondata.h:26/46/55/62/96/101 breathless/haseyes/has_head/is_silent/
// is_were/is_human.  Each is a plain flag test; the local copies exist because
// no js/ module exports them (js/uhitm.js, js/shk.js, js/mhitm_ad.js each keep
// their own private has_head, and none is reachable from here).
function p_breathless(ptr) { return (p_mflags1(ptr) & P_M1_BREATHLESS) !== 0; }
function p_haseyes(ptr) { return (p_mflags1(ptr) & P_M1_NOEYES) === 0; }
function p_has_head(ptr) { return (p_mflags1(ptr) & P_M1_NOHEAD) === 0; }
function p_is_silent(ptr) { return (ptr?.msound | 0) === P_MS_SILENT; }
function p_is_were(ptr) { return (p_mflags2(ptr) & P_M2_WERE) !== 0; }
function p_is_human(ptr) { return (p_mflags2(ptr) & P_M2_HUMAN) !== 0; }
function p_is_undead(ptr) { return (p_mflags2(ptr) & P_M2_UNDEAD) !== 0; }
function p_is_demon(ptr) { return (p_mflags2(ptr) & P_M2_DEMON) !== 0; }
// C ref: mondata.c:540 hates_blessings(ptr) / :533 mon_hates_blessings(mon).
// js/mondata.js now exports hates_blessings(); importing it here would close the
// cycle potion -> mondata -> mon/monmove/uhitm -> potion, so it is inlined.
function p_hates_blessings(ptr) { return p_is_undead(ptr) || p_is_demon(ptr); }
// C ref: monst.h:217 is_vampshifter(mon) = cham is PM_VAMPIRE,
// PM_VAMPIRE_LEADER or PM_VLAD_THE_IMPALER.  Resolved by name so no pmidx
// literal is baked in; monsters carry `cham` in this port (makemon.js
// pm_to_cham), and it is NON_PM for everything the covered sessions generate.
function p_is_vampshifter(mon) {
    const cham = mon?.cham;
    if (cham == null || cham < 0) return false;
    return cham === name_to_pmidx('vampire')
        || cham === name_to_pmidx('vampire leader')
        || cham === name_to_pmidx('Vlad the Impaler');
}
// C ref: mondata.c:533 mon_hates_blessings(mon).
function p_mon_hates_blessings(mon) {
    return p_is_vampshifter(mon) || p_hates_blessings(mon?.data);
}
// C ref: monst.h:253 mon_perma_blind(mon) = (!mcansee && !mblinded).
function p_mon_perma_blind(mon) { return !mon?.mcansee && !(mon?.mblinded | 0); }
// C ref: monst.h resists_poison/resists_acid — species bits only (the same
// reduction js/mondata.js:42 documents).
function p_mresists(mon) { return mon?.data?.mresists | 0; }
function p_resists_poison(mon) { return (p_mresists(mon) & P_MR_POISON) !== 0; }
function p_resists_acid(mon) { return (p_mresists(mon) & P_MR_ACID) !== 0; }
// C ref: obj.h:200/205 is_rustprone/is_corrodeable, :238 is_ammo,
// :249 is_weptool, :264 is_poisonable.
function p_oc(obj) { return objects?.[obj?.otyp] || {}; }
function p_is_rustprone(obj) { return p_oc(obj).material === P_IRON; }
function p_is_corrodeable(obj) {
    const m = p_oc(obj).material;
    return m === P_COPPER || m === P_IRON;
}
function p_is_ammo(obj) {
    const sk = p_oc(obj).oc_skill | 0;
    return (obj?.oclass === P_WEAPON_CLASS || obj?.oclass === P_GEM_CLASS)
        && sk >= -P_P_CROSSBOW && sk <= -P_P_BOW;
}
function p_is_weptool(obj) {
    return obj?.oclass === P_TOOL_CLASS && (p_oc(obj).oc_skill | 0) !== P_P_NONE;
}
function p_is_poisonable(obj) {
    const sk = p_oc(obj).oc_skill | 0;
    return (obj?.oclass === P_WEAPON_CLASS
            && sk >= -P_P_SHURIKEN && sk <= -P_P_BOW)
        || p_permapoisoned(obj);
}
// C ref: artifact.h permapoisoned(o) — an artifact whose poison can't wash off.
// js/artifact.js exports it, but artifact.js reaches potion.js, so inline: no
// artifact in reach is permanently poisoned.
function p_permapoisoned(_obj) { return false; }
// C ref: obj.h carried(obj) — the object is in the hero's inventory.
function p_carried(obj) {
    if (!obj) return false;
    return obj.where === 1 /* OBJ_INVENT */
        || (Array.isArray(game.invent) && game.invent.includes(obj));
}
// C ref: hack.h distu(x,y) — squared distance from the hero.
function p_distu(x, y) {
    const u = game.u || {};
    return ((x - u.ux) * (x - u.ux)) + ((y - u.uy) * (y - u.uy));
}

// C ref: potion.c:56 itimeout(val) — clamp a value into the valid range for an
// intrinsic timeout field.  potion.c:68 itimeout_incr() (already at line 56 of
// this file) is `itimeout((old & TIMEOUT) + incr)`; the local copy there skips
// the clamp, which only matters for a timer beyond 16.7M turns.
export function itimeout(val) {
    if (val >= P_TIMEOUT)
        val = P_TIMEOUT;
    else if (val < 1)
        val = 0;
    return val;
}

// C ref: potion.c:461 make_glib(xtime) — set or clear "slippery fingers".  The
// disp.botl flip is `!Glib ^ !!xtime`, i.e. only when the ON/OFF state changes;
// worn gloves get an inventory refresh because their "(being worn)" suffix
// becomes "(being worn; slippery)".  RNG-free.  js/apply.js:1739 and
// js/fountain.js:162 each set the timer inline at their own call sites.
export async function make_glib(xtime) {
    const oldGlib = uprops().Glib | 0;
    if (game.u) {
        /* C is literally `disp.botl |= (!Glib ^ !!xtime)` — note the missing
           second `!`, so it also flags a redraw when BOTH are zero.  Kept as
           written rather than "corrected"; the status line is redrawn, nothing
           else reads it. */
        const flip = ((oldGlib ? 0 : 1) ^ (xtime ? 1 : 0)) !== 0;
        game.u.disp_botl = game.u.disp_botl || flip;
        uprops().Glib = itimeout(xtime);   /* set_itimeout(&Glib, xtime) */
        uprops().HGlib = itimeout(xtime);
    }
    /* may change "(being worn)" to "(being worn; slippery)" or vice versa */
    if (game.uarmg) {
        const { update_inventory } = await import('./invent.js');
        await update_inventory();
    }
}

// C ref: potion.c:471 self_invis_message() — the line printed when the hero
// turns invisible.  RNG-free, but the wording is steered by two properties
// (Hallucination picks the message, See_invisible the clause).
export async function self_invis_message() {
    await update_topl(`${Hallucination() ? 'Far out, man!  You'
                                         : 'Gee!  All of a sudden, you'} ${
        See_invisible() ? 'can see right through yourself'
                        : "can't see yourself"}.`);
}

// C ref: potion.c:195 make_slimed(xtime, msg) — start or stop turning to slime.
// The message fires only when the timer's on/off state FLIPS (C's
// `(xtime != 0) ^ (old != 0)`); C deliberately still tells an Unaware player.
// Turning the timer off also clears the fake green-slime appearance that the
// last few turns of the countdown install.
export async function make_slimed(xtime, msg) {
    const u = game.u;
    if (!u) return;
    const old = uprops().Slimed | 0;

    uprops().Slimed = itimeout(xtime);          /* set_itimeout(&Slimed, xtime) */
    if ((xtime !== 0) !== (old !== 0)) {
        u.disp_botl = true;
        if (msg)
            await update_topl(String(msg));
    }
    if (!uprops().Slimed) {
        u.delayed_killer_SLIMED = null;         /* dealloc_killer(find_...) */
        /* fake appearance is set late in the turn-to-slime countdown */
        const ym = game.youmonst;
        if (ym && ym.m_ap_type === 3 /* M_AP_MONSTER */
            && ym.mappearance === name_to_pmidx('green slime')) {
            ym.m_ap_type = 0;                   /* M_AP_NOTHING */
            ym.mappearance = 0;
        }
    }
}

// C ref: potion.c:222 make_stoned(xtime, msg, killedby, killername) — start or
// stop petrification.  Same on/off-flip message rule as make_slimed(); the
// delayed killer is installed only on the transition INTO petrification (C's
// `else if (!old)`), so re-arming an already-running Stoned timer does not
// overwrite whose fault it was.  js/eat.js:2225/2335 set u.uprops.Stoned
// directly at their own call sites and print their own line.
export async function make_stoned(xtime, msg, killedby, killername) {
    const u = game.u;
    if (!u) return;
    const old = uprops().Stoned | 0;

    uprops().Stoned = itimeout(xtime);
    if ((xtime !== 0) !== (old !== 0)) {
        u.disp_botl = true;
        if (msg)
            await update_topl(String(msg));
    }
    if (!uprops().Stoned)
        u.delayed_killer_STONED = null;
    else if (!old)
        u.delayed_killer_STONED = { killedby, killername };
}

// C ref: potion.c:336 toggle_blindness() — called by Blindf_on/Blindf_off and
// make_blinded() once blindness has ALREADY flipped.  The vision_recalc(0) is
// immediate rather than deferred to moveloop() on purpose: C's comment cites a
// force bolt hitting an adjacent potion of blindness and then a secret door,
// where the deferred recalc printed "a door appears in the wall" for a spot the
// now-blind hero could not see.  RNG-free, but see_monsters() and
// vision_recalc() both change what is on the map, and learn_unseen_invent()
// changes inventory letters.
export async function toggle_blindness() {
    const u = game.u;
    /* EWarn_of_mon & W_WEP — a wielded warning artifact (Sting/Orcrist) */
    const Stinging = !!(game.uwep && (u?.uprops?.EWarn_of_mon_wep));

    /* blindness has just been toggled */
    if (u) u.disp_botl = true;      /* status conditions need update */
    game.vision_full_recalc = 1;    /* vision has changed */
    vision_recalc(0);
    if (Blind_telepat() || Infravision() || Stinging) {
        const { see_monsters } = await import('./display.js');
        await see_monsters();       /* also counts EWarn_of_mon monsters */
    }
    /*
     * Avoid either of the sequences
     * "Sting starts glowing", [become blind], "Sting stops quivering" or
     * "Sting starts quivering", [regain sight], "Sting stops glowing"
     * by giving "Sting is quivering" when becoming blind or
     * "Sting is glowing" when regaining sight so that the eventual
     * "stops" message matches the most recent "Sting is ..." one.
     */
    if (Stinging) {
        const { Sting_effects } = await import('./artifact.js');
        await Sting_effects(-1);
    }
    /* update dknown flag for inventory picked up while blind */
    if (!Blind())
        await learn_unseen_invent();
}
// C ref: youprop.h Blind_telepat / Infravision.
function Blind_telepat() { return HProp('Telepat', 'HTelepat') > 0; }
function Infravision() { return HProp('Infravision', 'HInfravision') > 0; }

// C ref: potion.c:2122 mixtype(o1, o2) — the potion type that results from
// dipping o1 into o2, or STRANGE_OBJECT for "no recipe".
// DRAWS: two arms roll rn2(3) — GAIN_LEVEL/GAIN_ENERGY + CONFUSION (booze vs
// enlightenment) and ENLIGHTENMENT + LEVITATION (gain level vs nothing).  Those
// draws happen inside the recipe lookup, i.e. BEFORE potion_dip() prints
// anything, which is why mixtype() cannot be treated as a pure table.
export function mixtype(o1, o2) {
    let o1typ = o1.otyp, o2typ = o2.otyp;

    /* cut down on the number of cases below */
    if (o1.oclass === POTION_CLASS
        && (o2typ === POT_GAIN_LEVEL || o2typ === POT_GAIN_ENERGY
            || o2typ === POT_HEALING || o2typ === POT_EXTRA_HEALING
            || o2typ === POT_FULL_HEALING || o2typ === POT_ENLIGHTENMENT
            || o2typ === POT_FRUIT_JUICE)) {
        /* swap o1 and o2 */
        o1typ = o2.otyp;
        o2typ = o1.otyp;
    }

    switch (o1typ) {
    case POT_HEALING:
        if (o2typ === POT_SPEED)
            return POT_EXTRA_HEALING;
        /* FALLTHRU */
    case POT_EXTRA_HEALING:
    case POT_FULL_HEALING:
        if (o2typ === POT_GAIN_LEVEL || o2typ === POT_GAIN_ENERGY)
            return (o1typ === POT_HEALING) ? POT_EXTRA_HEALING
                : (o1typ === POT_EXTRA_HEALING) ? POT_FULL_HEALING
                    : POT_GAIN_ABILITY;
        /* FALLTHRU */
    case P_UNICORN_HORN:
        switch (o2typ) {
        case POT_SICKNESS:
            return POT_FRUIT_JUICE;
        case POT_HALLUCINATION:
        case POT_BLINDNESS:
        case POT_CONFUSION:
            return POT_WATER;
        }
        break;
    case P_AMETHYST: /* "a-methyst" == "not intoxicated" */
        if (o2typ === POT_BOOZE)
            return POT_FRUIT_JUICE;
        break;
    case POT_GAIN_LEVEL:
    case POT_GAIN_ENERGY:
        switch (o2typ) {
        case POT_CONFUSION:
            return rn2(3) ? POT_BOOZE : POT_ENLIGHTENMENT;
        case POT_HEALING:
            return POT_EXTRA_HEALING;
        case POT_EXTRA_HEALING:
            return POT_FULL_HEALING;
        case POT_FULL_HEALING:
            return POT_GAIN_ABILITY;
        case POT_FRUIT_JUICE:
            return POT_SEE_INVISIBLE;
        case POT_BOOZE:
            return POT_HALLUCINATION;
        }
        break;
    case POT_FRUIT_JUICE:
        switch (o2typ) {
        case POT_SICKNESS:
            return POT_SICKNESS;
        case POT_ENLIGHTENMENT:
        case POT_SPEED:
            return POT_BOOZE;
        case POT_GAIN_LEVEL:
        case POT_GAIN_ENERGY:
            return POT_SEE_INVISIBLE;
        }
        break;
    case POT_ENLIGHTENMENT:
        switch (o2typ) {
        case POT_LEVITATION:
            if (rn2(3))
                return POT_GAIN_LEVEL;
            break;
        case POT_FRUIT_JUICE:
            return POT_BOOZE;
        case POT_BOOZE:
            return POT_CONFUSION;
        }
        break;
    }

    return P_STRANGE_OBJECT;
}

// C ref: potion.c:1497 H2Opotion_dip(potion, targobj, useeit, objphrase) —
// what water does to a dipped item (or to a steed's saddle splashed by a thrown
// potion of water).  Blessed water uncurses or blesses, cursed water unblesses
// or curses, and PLAIN water runs water_damage() (the rust/erosion rolls: the
// only RNG in here).  Returns TRUE if anything happened.
// staticfn in C, so coverage.mjs cannot see it (its regex only matches a
// lowercase first letter); it is added because impact_arti_light() and
// potion_dip() are both built on it.
export async function H2Opotion_dip(potion, targobj, useeit, objphrase) {
    let func = null;
    let glowcolor = null;
    let costchange = P_COST_NONE;
    let altfmt = false, res = false;

    if (!potion || potion.otyp !== POT_WATER)
        return false;

    const M = await import('./mkobj.js');
    if (potion.blessed) {
        if (targobj.cursed) {
            func = M.uncurse;
            glowcolor = 'amber';                 /* NH_AMBER */
            costchange = P_COST_UNCURS;
        } else if (!targobj.blessed) {
            func = M.bless;
            glowcolor = 'light blue';            /* NH_LIGHT_BLUE */
            costchange = P_COST_ALTER;
            altfmt = true;                       /* "with a <color> aura" */
        }
    } else if (potion.cursed) {
        if (targobj.blessed) {
            func = M.unbless;
            glowcolor = 'brown';
            costchange = P_COST_UNBLSS;
        } else if (!targobj.cursed) {
            func = M.curse;
            glowcolor = 'black';                 /* NH_BLACK */
            costchange = P_COST_ALTER;
            altfmt = true;
        }
    } else {
        /* dipping into uncursed water; carried() check skips a steed saddle */
        if (p_carried(targobj)) {
            game.mentioned_water = false;   /* water_damage() might set this */
            if (await water_damage(targobj, null, true) !== ER_NOTHING)
                res = true;
            if (game.mentioned_water)
                await makeknown(POT_WATER);
            game.mentioned_water = false;
        }
    }
    if (func) {
        /* give feedback BEFORE altering the target object; hero has to see the
           glow, and bknown is CLEARED rather than set if perception is
           distorted (Hallucination) */
        if (useeit) {
            const { hcolor } = await import('./do_name.js');
            glowcolor = hcolor(glowcolor);
            if (altfmt)
                await update_topl(`${objphrase} with ${p_an(glowcolor)} aura.`);
            else
                await update_topl(`${objphrase} ${glowcolor}.`);
            game.iflags = game.iflags || {};
            game.iflags.last_msg = 'PLNMSG_OBJ_GLOWS';
            targobj.bknown = !Hallucination();
        } else {
            /* didn't see what happened: forget the BUC state if it was known,
               unless the bless/curse state of the water is known */
            if (!potion.bknown || !potion.dknown)
                targobj.bknown = 0;
        }
        /* potions of water are the only shop goods whose price depends on
           their curse/bless state */
        if (targobj.unpaid && targobj.otyp === POT_WATER) {
            if (costchange === P_COST_ALTER) {
                const { alter_cost } = await import('./shk.js');
                await alter_cost(targobj, 0);
            } else if (costchange !== P_COST_NONE) {
                await p_costly_alteration(targobj, costchange);
            }
        }
        /* finally, change curse/bless state */
        func(targobj);
        res = true;
    }
    return res;
}
// C ref: objnam.c an(str) — the indefinite article.  js/invent.js exports `an`
// under a named export list; imported lazily where it is needed and mirrored
// here for the synchronous format above.
function p_an(str) {
    const s = String(str || '');
    return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`;
}
// C ref: shk.c costly_alteration(obj, alter_type) — bill the hero for
// degrading shop goods.  js/trap.js:829 keeps a private no-op copy; the shop-bill
// subsystem is not reachable from this file, so this is the no-op stand-in and
// the gap is named rather than half-implemented.
async function p_costly_alteration(_obj, _alter_type) { /* shk.c, unported here */ }

// C ref: potion.c:1595 impact_arti_light(obj, worsen, seeit) — a blessed or
// cursed scroll of light hitting an artifact light source (wielded Sunsword,
// worn gold dragon scales/mail): unless it resists, treat it as a dip in holy
// or unholy water.
// DRAWS: obj_resists(obj, 25, 75) rolls, and mksobj(POT_WATER, TRUE, FALSE)
// runs the full object-creation sequence.  js/read.js:1188/1200 documents this
// as unmodelled at the scroll-of-light call site.
export async function impact_arti_light(obj, worsen, seeit) {
    const { obj_resists } = await import('./zap.js');

    /* if already worst/best BUC it can be, or if it resists, do nothing */
    if ((worsen ? obj.cursed : obj.blessed) || obj_resists(obj, 25, 75))
        return;

    const { mksobj, curse, bless, dealloc_obj } = await import('./mkobj.js');
    /* curse() and bless() take care of maybe_adjust_light() */
    const otmp = mksobj(POT_WATER, true, false);
    if (worsen)
        curse(otmp);
    else
        bless(otmp);
    await H2Opotion_dip(otmp, obj, seeit,
                        seeit ? p_Yobjnam2(obj, 'glow') : '');
    dealloc_obj(otmp);
    /* C defers the update_inventory() until the caller has used up the scroll */
}
// C ref: objnam.c Yobjnam2(obj, verb) — "Your <obj> glow[s]" with the verb
// conjugated for the stack size.  js/wield.js and js/engrave.js keep private
// Yname2()s; this is the same shape over invent.js's exported xname()/otense().
function p_Yobjnam2(obj, verb) {
    return `Your ${xname(obj)} ${p_otense(obj, verb)}`;
}
function p_otense(obj, verb) {
    return ((obj?.quan | 0) > 1) ? verb : `${verb}s`;
}

// C ref: potion.c:1625 potionhit(mon, obj, how) — a potion shatters on `mon`
// (which may be the hero).  `obj` is always used up.
// DRAWS, in C's order: bottlename() (rn2(7) or rn2(24) hallucinating), then
// either the hero's rnd(2) crash damage or the monster's saddle rolls
// (rn2(10)/rnl(10)/rn2(3)) plus rn2(5) for the 1 hp chip, then the per-otyp
// effect, and finally the rn2((1+ACURR(A_DEX))/2) vapor-inhalation gate.
// js/potion.js:452 potionhit_hero() is the REDUCED isyou-only copy that the
// covered sessions reach (a monster lobbing a potion at the hero); this is the
// whole function.
// SCOPE, each named at its branch: bhitm() for POT_POLYMORPH on a monster,
// explode_oil() for a lit oil potion, the shop-bill tail, and killed()/
// monkilled() death handling go through the exported helpers where js/ has
// them and are noted where it does not.
export async function potionhit(mon, obj, how) {
    const u = game.u;
    const botlnam = bottlename();                       /* potion.c:1627 */
    const isyou = (mon === game.youmonst || mon === u);
    let tx, ty, distance;
    let saddle = null;
    let hit_saddle = false;
    const your_fault = (how <= 1 /* POTHIT_HERO_THROW */);
    const D = await import('./display.js');
    const UH = await import('./uhitm.js');

    if (isyou) {
        tx = u.ux; ty = u.uy;
        distance = 0;
        await update_topl(`The ${botlnam} crashes on your ${
            body_part(HEAD)} and breaks into shards.`);
        await losehp(Maybe_Half_Phys(rnd(2)),
                     (how === 3 /* POTHIT_OTHER_THROW */) ? 'propelled potion'
                                                          : 'thrown potion');
    } else {
        tx = mon.mx; ty = mon.my;
        /* sometimes it hits the saddle */
        const { which_armor } = await import('./worn.js');
        const W_SADDLE = 0x00080000; /* C ref: prop.h W_SADDLE */
        if (((mon.misc_worn_check | 0) & W_SADDLE)
            && (saddle = which_armor(mon, W_SADDLE))
            && (!rn2(10)
                || (obj.otyp === POT_WATER
                    && ((rnl(10) > 7 && obj.cursed)
                        || (rnl(10) < 4 && obj.blessed) || !rn2(3)))))
            hit_saddle = true;
        distance = p_distu(tx, ty);
        if (!cansee_p(tx, ty)) {
            await update_topl('Crash!');
        } else {
            const mnam = UH.mon_nam(mon);
            let buf;
            if (hit_saddle && saddle)
                buf = `${p_s_suffix(UH.x_monnam(mon, 2 /* ARTICLE_THE */, null,
                                                0x04 | 0x40, false))} saddle`;
            else if (p_has_head(mon.data))
                buf = `${p_s_suffix(mnam)} ${game.notonhead ? 'body' : 'head'}`;
            else
                buf = mnam;
            await update_topl(
                `The ${botlnam} crashes on ${buf} and breaks into shards.`);
        }
        if (rn2(5) && mon.mhp > 1 && !hit_saddle)
            mon.mhp--;
    }

    /* oil doesn't instantly evaporate; neither does a saddle hit */
    if (obj.otyp !== POT_OIL && !hit_saddle && cansee_p(tx, ty))
        await update_topl(`${p_Tobjnam(obj, 'evaporate')}.`);

    if (isyou) {
        switch (obj.otyp) {
        case POT_OIL:
            if (obj.lamplit) {
                const { explode_oil } = await import('./explode.js');
                await explode_oil(obj, u.ux, u.uy);
            }
            break;
        case POT_POLYMORPH:
            await update_topl(`You feel a little ${
                Hallucination() ? 'normal' : 'strange'}.`);
            /* polyself(POLY_NOFLAGS): the random self-polymorph subsystem is
               not driven from here (js/potion.js:1222 peffect_polymorph makes
               the same call site inert) */
            void (!Unchanging() && !Antimagic());
            break;
        case POT_ACID:
            if (!Acid_resistance()) {
                await update_topl(`This burns${
                    obj.blessed ? ' a little' : obj.cursed ? ' a lot' : ''}!`);
                const dmg = d(obj.cursed ? 2 : 1, obj.blessed ? 4 : 8);
                await losehp(Maybe_Half_Phys(dmg), 'potion of acid');
            }
            break;
        }
    } else if (hit_saddle && saddle) {
        let affected = false;
        const useeit = !Blind() && UH.canspotmon(mon) && cansee_p(tx, ty);
        const mnam = UH.x_monnam(mon, 2, null, 0x04 | 0x40, false);
        const buf = p_upstart(p_s_suffix(mnam));

        switch (obj.otyp) {
        case POT_WATER: {
            const saddle_glows = `${buf} ${p_aobjnam(saddle, 'glow')}`;
            affected = await H2Opotion_dip(obj, saddle, useeit, saddle_glows);
            break;
        }
        case POT_POLYMORPH:
            /* Do we allow the saddle to polymorph? */
            break;
        }
        if (useeit && !affected)
            await update_topl(`${buf} ${p_aobjnam(saddle, 'get')} wet.`);
    } else {
        let angermon = your_fault, cureblind = false;
        const Z = await import('./zap.js');
        const MU = await import('./muse.js');
        const MON = await import('./mon.js');
        const PM_PESTILENCE = name_to_pmidx('Pestilence');
        const PM_GREMLIN = name_to_pmidx('gremlin');
        const PM_IRON_GOLEM = name_to_pmidx('iron golem');
        /* C reaches the healing/illness tails through gotos; `phase` reproduces
           the two entry points (do_healing / do_illness) without duplicating
           either body. */
        let phase = 'switch';

        switch (obj.otyp) {
        case POT_FULL_HEALING:
            cureblind = true;
            /* FALLTHRU — JS switch falls through exactly like C's, so the two
               arms below really do run for a full-healing potion too */
        case POT_EXTRA_HEALING:
            if (!obj.cursed)
                cureblind = true;
            /* FALLTHRU */
        case POT_HEALING:
            if (obj.blessed)
                cureblind = true;
            if (mon.data?.pmidx === PM_PESTILENCE) { phase = 'illness'; break; }
            /* FALLTHRU */
        case POT_RESTORE_ABILITY:
        case POT_GAIN_ABILITY:
            if (phase === 'switch') phase = 'healing';
            break;
        case POT_SICKNESS:
            if (mon.data?.pmidx === PM_PESTILENCE) { phase = 'healing'; break; }
            if (dmgtype(mon.data, AD_DISE)
                /* won't happen, see prior goto */
                || dmgtype(mon.data, AD_PEST)
                /* most common case */
                || p_resists_poison(mon)) {
                if (UH.canspotmon(mon))
                    await update_topl(`${UH.Monnam(mon)} looks unharmed.`);
                break;
            }
            phase = 'illness';
            break;
        case POT_CONFUSION:
        case POT_BOOZE:
            if (!Z.resist(mon, POTION_CLASS, 0, 0 /* NOTELL */))
                mon.mconf = true;
            break;
        case POT_INVISIBILITY: {
            const sawit = UH.canspotmon(mon);
            const cursed_potion = !!obj.cursed;

            angermon = mon.minvis && cursed_potion;
            await p_mon_set_minvis(mon, cursed_potion);
            if (sawit && !UH.canspotmon(mon)) {
                if (cansee_p(mon.mx, mon.my))
                    D.map_invisible(mon.mx, mon.my);
            } else if (sawit && cursed_potion) {
                await update_topl(
                    `${UH.Monnam(mon)} briefly seems to be transparent.`);
            } else if (!sawit && UH.canspotmon(mon)) {
                await update_topl(`${UH.Monnam(mon)} appears!`);
            }
            break;
        }
        case POT_SLEEPING:
            /* wakeup() doesn't rouse victims of temporary sleep */
            if (Z.sleep_monst(mon, rnd(12), POTION_CLASS)) {
                await update_topl(`${UH.Monnam(mon)} falls asleep.`);
                await p_slept_monst(mon);
            }
            break;
        case POT_PARALYSIS:
            if (mon.mcanmove) {
                /* really should be rnd(5) for consistency with players
                   breathing potions, but... */
                await p_paralyze_monst(mon, rnd(25));
            }
            break;
        case POT_SPEED:
            angermon = false;
            await MU.mon_adjust_speed(mon, 1, obj);
            break;
        case POT_BLINDNESS:
            if (p_haseyes(mon.data) && !p_mon_perma_blind(mon)) {
                let btmp = 64 + rn2(32)
                    + rn2(32) * (Z.resist(mon, POTION_CLASS, 0, 0) ? 0 : 1);
                btmp += (mon.mblinded | 0);
                mon.mblinded = Math.min(btmp, 127);
                mon.mcansee = 0;
            }
            break;
        case POT_WATER:
            if (p_mon_hates_blessings(mon) /* undead or demon */
                || p_is_were(mon.data) || p_is_vampshifter(mon)) {
                if (obj.blessed) {
                    await update_topl(`${UH.Monnam(mon)} ${
                        p_is_silent(mon.data) ? 'writhes' : 'shrieks'} in pain!`);
                    if (!p_is_silent(mon.data)) {
                        const { wake_nearto } = await import('./cmd.js');
                        await wake_nearto(tx, ty, (mon.data?.mlevel | 0) * 10);
                    }
                    mon.mhp -= d(2, 6);
                    /* should only be by you */
                    if (DEADMONSTER(mon))
                        await UH.killed(mon);
                    else if (p_is_were(mon.data) && !p_is_human(mon.data))
                        await p_new_were(mon); /* revert to human */
                } else if (obj.cursed) {
                    angermon = false;
                    if (UH.canspotmon(mon))
                        await update_topl(`${UH.Monnam(mon)} looks healthier.`);
                    MON.healmon(mon, d(2, 6), 0);
                    if (p_is_were(mon.data) && p_is_human(mon.data)
                        && !Protection_from_shape_changers())
                        await p_new_were(mon); /* transform into beast */
                }
            } else if (mon.data?.pmidx === PM_GREMLIN) {
                angermon = false;
                await split_mon(mon, null);
            } else if (mon.data?.pmidx === PM_IRON_GOLEM) {
                if (UH.canspotmon(mon))
                    await update_topl(`${UH.Monnam(mon)} rusts.`);
                mon.mhp -= d(1, 6);
                /* should only be by you */
                if (DEADMONSTER(mon))
                    await UH.killed(mon);
            }
            break;
        case POT_OIL:
            if (obj.lamplit) {
                const { explode_oil } = await import('./explode.js');
                await explode_oil(obj, tx, ty);
            }
            break;
        case POT_ACID:
            if (!p_resists_acid(mon) && !Z.resist(mon, POTION_CLASS, 0, 0)) {
                await update_topl(`${UH.Monnam(mon)} ${
                    p_is_silent(mon.data) ? 'writhes' : 'shrieks'} in pain!`);
                if (!p_is_silent(mon.data)) {
                    const { wake_nearto } = await import('./cmd.js');
                    await wake_nearto(tx, ty, (mon.data?.mlevel | 0) * 10);
                }
                mon.mhp -= d(obj.cursed ? 2 : 1, obj.blessed ? 4 : 8);
                if (DEADMONSTER(mon)) {
                    if (your_fault)
                        await UH.killed(mon);
                    else
                        await p_monkilled(mon, '', 8 /* AD_ACID */);
                }
            }
            break;
        case POT_POLYMORPH:
            /* C: (void) bhitm(mon, obj) — zap.c's per-monster beam effect.
               js/zap.js has no exported bhitm; the polymorph-a-monster path is
               the same gap js/zap.js:2370 documents. */
            break;
        /* POT_GAIN_LEVEL / POT_LEVITATION / POT_FRUIT_JUICE /
           POT_MONSTER_DETECTION / POT_OBJECT_DETECTION: nothing (C's commented
           -out cases) */
        }

        if (phase === 'healing') {
            angermon = false;
            if (mon.mhp < mon.mhpmax) {
                MON.healmon(mon, mon.mhpmax, 0);
                if (UH.canspotmon(mon))
                    await update_topl(
                        `${UH.Monnam(mon)} looks sound and hale again.`);
            }
            if (cureblind)
                await MU.mcureblindness(mon, UH.canspotmon(mon));
        } else if (phase === 'illness') {
            if (mon.mhp > 2) {
                mon.mhp = Math.trunc(mon.mhp / 2);
                if (UH.canspotmon(mon))
                    await update_topl(`${UH.Monnam(mon)} looks rather ill.`);
            }
        }

        /* target might have been killed */
        if (!DEADMONSTER(mon)) {
            if (angermon)
                await p_wakeup(mon, true);
            else
                mon.msleeping = 0;
        }
    }

    /* Note: potionbreathe() does its own docall() */
    if ((distance === 0
         || (distance < 3 && !rn2(Math.trunc((1 + acurr_eff(A_DEX)) / 2))))
        && (!p_breathless(youmonst_data()) || p_haseyes(youmonst_data()))) {
        await potionbreathe_hero(obj);
    } else if (obj.dknown && cansee_p(tx, ty)) {
        await trycall(obj);
    }

    /* C's shop tail: an unpaid potion thrown inside a tended shop is either
       taken off the bill (monster threw it) or charged as theft (hero threw
       it).  stolen_value()/subfrombill() need the shk bill machinery, which is
       js/shk.js's; named here rather than half-run. */
    void 0;

    const { obfree } = await import('./invent.js');
    await obfree(obj, null);
}
// C ref: vision.h cansee(x, y) — imported from js/vision.js as vis_cansee
// (this file already had `cansee` shadowed by nothing, but the alias keeps the
// existing import line's other names untouched).
function cansee_p(x, y) { return vis_cansee(x, y); }
// C ref: youprop.h Protection_from_shape_changers.
function Protection_from_shape_changers() {
    return HProp('HProtection_from_shape_changers',
                 'EProtection_from_shape_changers') > 0;
}
// C ref: monst.h gy.youmonst.data — bogus while unpolymorphed in this port
// (u.umonnum is a ROLE index), so the caller-visible reads are Upolyd-guarded.
function youmonst_data() { return Upolyd() ? game.u?.data : null; }
// C ref: objnam.c s_suffix / upstart / aobjnam / Tobjnam.  js/invent.js exports
// s_suffix; the other three have only module-private copies elsewhere.
function p_s_suffix(s) {
    const str = String(s || '');
    return /s$/.test(str) ? `${str}'` : `${str}'s`;
}
function p_upstart(s) {
    const str = String(s || '');
    return str ? str[0].toUpperCase() + str.slice(1) : str;
}
function p_aobjnam(obj, verb) {
    return `${xname(obj)}${verb ? ` ${p_otense(obj, verb)}` : ''}`;
}
function p_Tobjnam(obj, verb) {
    return `The ${xname(obj)} ${p_otense(obj, verb)}`;
}
// C ref: mon.c wakeup(mtmp, via_attack) / mon.c monkilled() / were.c new_were()
// / mon.c mon_set_minvis() / mhitm_ad.c paralyze_monst() / zap.c slept_monst().
// None is exported by any js/ module (js/mon.js:331 documents new_were as
// module-private, js/mhitm_ad.js has the only paralyze_monst); each is named
// here so the gap is explicit rather than silently dropped.
async function p_wakeup(mon, _via_attack) { if (mon) mon.msleeping = 0; }
async function p_monkilled(_mon, _fltxt, _how) { /* mon.c, unported here */ }
async function p_new_were(_mon) { /* were.c, module-private in js/mon.js */ }
async function p_mon_set_minvis(mon, invis) { if (mon) mon.minvis = !!invis; }
async function p_paralyze_monst(mon, ntmp) {
    if (!mon) return;
    mon.mcanmove = 0;
    mon.mfrozen = ntmp;
}
async function p_slept_monst(_mon) { /* zap.c slept_monst(), unported */ }

// C ref: potion.c:2243 hold_potion(potobj, drop_fmt, drop_arg, hold_msg) — put a
// transformed potion back into inventory.  Its WEIGHT hasn't changed, but it may
// need a slot that isn't free or may merge into another carried stack, so C
// pins flags.pickup_burden to the CURRENT encumbrance first so the option's
// setting cannot force a drop; near_capacity() is read BEFORE the object leaves
// inventory.  hold_another_object() can draw (a drop lands the object on the
// floor via the normal drop path).
export async function hold_potion(potobj, drop_fmt, drop_arg, hold_msg) {
    const I = await import('./invent.js');
    const cap = I.near_capacity();
    const save_pickup_burden = game.flags?.pickup_burden;

    /* prevent a drop due to the current setting of 'pickup_burden' */
    if (game.flags && game.flags.pickup_burden < cap)
        game.flags.pickup_burden = cap;
    /* remove from inventory AFTER calculating near_capacity() */
    I.obj_extract_self(potobj);
    /* re-insert into inventory, possibly merging with a compatible stack */
    potobj = await I.hold_another_object(potobj, drop_fmt, drop_arg, hold_msg);
    void potobj;
    if (game.flags) game.flags.pickup_burden = save_pickup_burden;
    await I.update_inventory();
}

// C ref: potion.c:2408 poof(potion) — the dipped-into potion is consumed and, if
// the hero had seen it, offered for naming.  trycall() can draw (docall's
// getlin is not RNG, but makeknown's Wisdom exercise is).
export async function poof(potion) {
    if (potion.dknown)
        await trycall(potion);
    await useup(potion);
}

// C ref: potion.c:2417 dip_potion_explosion(obj, dmg) — do the dipped potions
// blow up?  DRAWS rn2(30) when wearing an alchemy smock, rn2(10) otherwise —
// but ONLY when the short-circuit ahead of it fails, i.e. a cursed potion, an
// acid potion or a lit oil potion explodes with NO roll at all.
export async function dip_potion_explosion(obj, dmg) {
    if (obj.cursed || obj.otyp === POT_ACID
        || (obj.otyp === POT_OIL && obj.lamplit)
        || !rn2((game.uarmc && game.uarmc.otyp === P_ALCHEMY_SMOCK) ? 30 : 10)) {
        /* it would be better to use up the whole stack in advance of the
           message, but we can't because we need to keep it around for
           potionbreathe() */
        obj.in_use = 1;
        await update_topl(`${!Deaf() ? 'BOOM!  ' : ''}They explode!`);
        const { wake_nearto } = await import('./cmd.js');
        await wake_nearto(game.u.ux, game.u.uy,
                          (P_BOLT_LIM + 1) * (P_BOLT_LIM + 1));
        exercise(A_STR, false);
        if (!p_breathless(youmonst_data()) || p_haseyes(youmonst_data()))
            await potionbreathe_hero(obj);
        const { useupall } = await import('./invent.js');
        await useupall(obj);
        await losehp(dmg, 'alchemic blast');  /* not physical damage */
        return true;
    }
    return false;
}

// C ref: potion.c:2442 potion_dip(obj, potion) — everything dodip()/dip_into()
// do once both objects are chosen.  This is the biggest RNG site in potion.c:
// mixtype()'s two rn2(3)s, the stack-subset rnd() when dipping several potions
// at once, dip_potion_explosion()'s rn2(10)/rn2(30) plus the rnd(9) it is
// called with, the rnd(8) "no recipe" table (which can mkobj() a whole random
// potion), water_damage()'s erosion rolls via H2Opotion_dip, poly_obj(),
// erode_obj(), fire_damage() and the oil-lamp explode(11, d(6,6)).
// js/potion.js:1633 (inside dodip) is where C calls this; that call site is
// deliberately left as-is by this pass.
export async function potion_dip(obj, potion) {
    const I = await import('./invent.js');
    let mixture;

    if (potion === obj && potion.quan === 1) {
        await update_topl('That is a potion bottle, not a Klein bottle!');
        return ECMD_OK;
    }
    if (obj === hands_obj) {
        await update_topl(
            `You can't fit your ${body_part(HAND)} into the mouth of the bottle!`);
        return ECMD_OK;
    }

    obj.pickup_prev = 0;   /* no longer 'recently picked up' */
    potion.in_use = true;  /* assume it will be used up */
    if (potion.otyp === POT_WATER) {
        const useeit = !Blind() || (obj === game.ublindf && Blindfolded_only());
        const obj_glows = p_Yobjnam2(obj, 'glow');

        if (await H2Opotion_dip(potion, obj, useeit, obj_glows)) {
            await poof(potion);
            return ECMD_TIME;
        }
    } else if (obj.otyp === POT_POLYMORPH || potion.otyp === POT_POLYMORPH) {
        /* some objects can't be polymorphed */
        if (await p_obj_unpolyable(obj.otyp === POT_POLYMORPH ? potion : obj)) {
            await update_topl('Nothing happens.');
        } else {
            const save_otyp = obj.otyp;

            /* KMH, conduct */
            if (game.u) {
                game.u.uconduct = game.u.uconduct || {};
                game.u.uconduct.polypiles = (game.u.uconduct.polypiles | 0) + 1;
            }
            /* C: obj = poly_obj(obj, STRANGE_OBJECT) — zap.c's object
               polymorph.  js/zap.js's poly_obj is module-private (and it can
               DESTROY obj: poly_obj -> set_wear -> Amulet_on -> useup when a
               worn amulet becomes an amulet of change).  The three C branches
               below are kept; the transform itself is the named gap, so obj
               keeps save_otyp and control lands in the third branch. */
            if (!obj) {
                await makeknown(POT_POLYMORPH);
                return ECMD_TIME;
            } else if (obj.otyp !== save_otyp) {
                await makeknown(POT_POLYMORPH);
                await useup(potion);
                await I.prinv(null, obj, 0);
                return ECMD_TIME;
            } else {
                await update_topl('Nothing seems to happen.');
                await poof(potion);
                return ECMD_TIME;
            }
        }
        potion.in_use = false;  /* didn't go poof */
        return ECMD_TIME;
    } else if (obj.oclass === POTION_CLASS && obj.otyp !== potion.otyp) {
        let amt = obj.quan | 0;

        mixture = mixtype(obj, potion);

        const magic = (mixture !== P_STRANGE_OBJECT)
            ? !!objects[mixture]?.oc_magic
            : (!!objects[obj.otyp]?.oc_magic || !!objects[potion.otyp]?.oc_magic);
        let qbuf = 'The';  /* assume full stack */
        if (amt > (obj.odiluted ? 2 : magic ? 3 : 7)) {
            /* trying to dip multiple potions usually affects only a subset:
               3..8 for a magic result, 7..N otherwise; diluted potions cap at
               two, a balance fix against cheap mass healing->full healing */
            if (obj.odiluted)
                amt = 2;
            else if (magic)
                amt = rnd(Math.min(amt, 8) - (3 - 1)) + (3 - 1); /* 1..6 + 2 */
            else
                amt = rnd(amt - (7 - 1)) + (7 - 1);              /* 1..N-6 + 6 */

            if (amt < obj.quan) {
                obj = I.splitobj(obj, amt);
                qbuf = `${obj.quan} of the`;
            }
        }
        /* [N of] the {obj(s)} mix(es) with [one of] {the potion}... */
        await update_topl(`${qbuf} ${p_simpleonames(obj)} ${
            p_otense(obj, 'mix')} with ${
            (potion.quan > 1) ? 'one of ' : ''}${p_thesimpleoname(potion)}...`);
        /* get rid of the 'dippee' before any perm_invent update */
        await useup(potion);  /* now gone */
        /* Mixing potions is dangerous; acid is particularly unstable */
        if (await dip_potion_explosion(obj, amt + rnd(9)))
            return ECMD_TIME;

        obj.blessed = obj.cursed = obj.bknown = 0;
        if (Blind() || Hallucination())
            obj.dknown = 0;

        if (mixture !== P_STRANGE_OBJECT) {
            obj.otyp = mixture;
        } else {
            const M = await import('./mkobj.js');
            switch (obj.odiluted ? 1 : rnd(8)) {
            case 1:
                obj.otyp = POT_WATER;
                break;
            case 2:
            case 3:
                obj.otyp = POT_SICKNESS;
                break;
            case 4: {
                const otmp = M.mkobj(POTION_CLASS, false);
                obj.otyp = otmp.otyp;
                /* oil uses obj->age differently from other potions */
                if (obj.otyp === POT_OIL || otmp.otyp === POT_OIL)
                    M.fixup_oil(obj, otmp);
                await (await import('./invent.js')).obfree(otmp, null);
                break;
            }
            default: {
                const { useupall } = await import('./invent.js');
                await useupall(obj);
                await update_topl(`The mixture ${
                    !Blind() ? 'glows brightly and ' : ''}evaporates.`);
                return ECMD_TIME;
            }
            }
        }
        obj.odiluted = (obj.otyp !== POT_WATER) ? 1 : 0;

        if (obj.otyp === POT_WATER && !Hallucination()) {
            await update_topl(`The mixture bubbles${
                Blind() ? '' : ', then clears'}.`);
        } else if (!Blind()) {
            const { hcolor } = await import('./do_name.js');
            await update_topl(`The mixture looks ${
                hcolor(DESCR_BY_OTYP[obj.otyp])}.`);
        }

        /* required when 'obj' was split off a bigger stack, so that it gets its
           own inventory slot; it also merges into a compatible stack when no
           split was made, so do it either way (a consequence: mixing while
           Fumbling drops the mixture) */
        await I.freeinv(obj);
        await hold_potion(obj, 'You drop %s!', I.doname_invent(obj), null);
        return ECMD_TIME;
    }

    if (potion.otyp === POT_ACID && obj.otyp === CORPSE
        && obj.corpsenm === name_to_pmidx('lichen')) {
        const { hcolor } = await import('./do_name.js');
        await update_topl(`${p_The(p_cxname(obj))} ${p_otense(obj, 'turn')} ${
            Blind() ? 'wrinkled'
                : potion.odiluted ? hcolor('orange') : hcolor('red')
        } around the edges.`);
        potion.in_use = false;  /* didn't go poof */
        if (potion.dknown)
            await trycall(potion);
        return ECMD_TIME;
    }

    if (potion.otyp === POT_WATER && obj.otyp === TOWEL_OTYP) {
        await update_topl('The towel soaks it up!');
        /* wetting the towel already happened via water_damage() in
           H2Opotion_dip */
        await poof(potion);
        return ECMD_TIME;
    }

    if (p_is_poisonable(obj)) {
        if (potion.otyp === POT_SICKNESS && !obj.opoisoned) {
            const buf = (potion.quan > 1) ? `One of ${p_the(xname(potion))}`
                                          : p_The(xname(potion));
            await update_topl(`${buf} forms a coating on ${
                p_the(xname(obj))}.`);
            obj.opoisoned = true;
            await poof(potion);
            return ECMD_TIME;
        } else if (obj.opoisoned && !p_permapoisoned(obj)
                   && (potion.otyp === POT_HEALING
                       || potion.otyp === POT_EXTRA_HEALING
                       || potion.otyp === POT_FULL_HEALING)) {
            await update_topl(`A coating wears off ${p_the(xname(obj))}.`);
            obj.opoisoned = 0;
            await poof(potion);
            return ECMD_TIME;
        }
    }

    if (potion.otyp === POT_ACID) {
        const { erode_obj } = await import('./trap.js');
        if (await erode_obj(obj, 0, P_ERODE_CORRODE, P_EF_GREASE)
            !== ER_NOTHING) {
            await poof(potion);
            return ECMD_TIME;
        }
    }

    let more_dips = false;
    if (potion.otyp === POT_OIL) {
        let wisx = false;

        if (potion.lamplit) { /* burning */
            /* C: fire_damage(obj, TRUE, u.ux, u.uy) — trap.c's symbol, with no
               js/ port; it rolls the object's burn/destroy checks. */
            void 0;
        } else if (potion.cursed) {
            const { fingers_or_gloves } = await import('./do_wear.js');
            await update_topl(`The potion spills and covers your ${
                fingers_or_gloves(true)} with oil.`);
            await make_glib(((uprops().Glib | 0) & P_TIMEOUT) + d(2, 10));
        } else if (obj.oclass !== P_WEAPON_CLASS && !p_is_weptool(obj)) {
            /* the following cases apply only to weapons */
            more_dips = true;
        } else if ((!p_is_rustprone(obj) && !p_is_corrodeable(obj))
                   || p_is_ammo(obj)
                   || (!obj.oeroded && !obj.oeroded2)) {
            /* uses up the potion, doesn't set obj->greased */
            if (!Blind())
                await update_topl(`${p_Yname2(obj)} ${
                    p_otense(obj, 'gleam')} with an oily sheen.`);
            else
                await update_topl(`${p_Yname2(obj)} ${
                    p_otense(obj, 'feel')} oily.`);
        } else {
            await update_topl(`${p_Yname2(obj)} ${
                p_otense(obj, !Blind() ? 'are' : 'feel')} less ${
                (obj.oeroded && obj.oeroded2) ? 'corroded and rusty'
                    : obj.oeroded ? 'rusty' : 'corroded'}.`);
            if (obj.oeroded > 0) obj.oeroded--;
            if (obj.oeroded2 > 0) obj.oeroded2--;
            wisx = true;
        }
        if (!more_dips) {
            exercise(A_WIS, wisx);
            if (potion.dknown)
                await makeknown(potion.otyp);
            await useup(potion);
            return ECMD_TIME;
        }
    }
    /* more_dips: */

    /* Allow filling of MAGIC_LAMPs to prevent identification by the player */
    if ((obj.otyp === P_OIL_LAMP || obj.otyp === P_MAGIC_LAMP)
        && potion.otyp === POT_OIL) {
        /* Turn off engine before fueling, turn off fuel too :-) */
        if (obj.lamplit || potion.lamplit) {
            await useup(potion);
            const { explode } = await import('./explode.js');
            await explode(game.u.ux, game.u.uy, 11, d(6, 6), 0, P_EXPL_FIERY);
            exercise(A_WIS, false);
            return ECMD_TIME;
        }
        /* adding oil to an EMPTY magic lamp renders it into an oil lamp */
        if (obj.otyp === P_MAGIC_LAMP && obj.spe === 0) {
            obj.otyp = P_OIL_LAMP;
            obj.age = 0;
        }
        if (obj.age > 1000) {
            await update_topl(`${p_Yname2(obj)} ${p_otense(obj, 'are')} full.`);
            potion.in_use = false;  /* didn't go poof */
        } else {
            await update_topl(`You fill ${await p_yname(obj)} with oil.`);
            await p_check_unpaid(potion);   /* Yendorian Fuel Tax */
            /* burns more efficiently in a lamp than in a bottle */
            obj.age = (obj.age | 0)
                + Math.trunc(((!potion.odiluted ? 4 : 3) * (potion.age | 0)) / 2);
            if (obj.age > 1500) obj.age = 1500;
            await useup(potion);
            exercise(A_WIS, true);
        }
        if (potion.dknown)
            await makeknown(POT_OIL);
        obj.spe = 1;
        await I.update_inventory();
        return ECMD_TIME;
    }

    potion.in_use = false;  /* didn't go poof */
    if ((obj.otyp === P_UNICORN_HORN || obj.otyp === P_AMETHYST)
        && (mixture = mixtype(obj, potion)) !== P_STRANGE_OBJECT) {
        const { hcolor } = await import('./do_name.js');
        const old_otyp = potion.otyp;
        let old_dknown = false;
        const more_than_one = potion.quan > 1;
        let oldbuf = '';
        let singlepotion;

        if (potion.dknown) {
            old_dknown = true;
            oldbuf = `${hcolor(DESCR_BY_OTYP[potion.otyp])} `;
        }
        /* with multiple merged potions, split off one and just clear it */
        if (potion.quan > 1)
            singlepotion = I.splitobj(potion, 1);
        else
            singlepotion = potion;

        await p_costly_alteration(singlepotion, 1 /* COST_NUTRLZ */);
        singlepotion.otyp = mixture;
        singlepotion.blessed = 0;
        if (mixture === POT_WATER)
            singlepotion.cursed = singlepotion.odiluted = 0;
        else
            singlepotion.cursed = obj.cursed;  /* odiluted left as-is */
        singlepotion.bknown = false;
        singlepotion.dknown = false;          /* provisionally */
        if (!Blind()) {
            if (!Hallucination()) {
                const { observe_object } = await import('./o_init.js');
                await observe_object(singlepotion);
            }
            let newbuf = '';
            if (mixture === POT_WATER && singlepotion.dknown)
                newbuf = 'clears';
            else if (!Blind())
                newbuf = `turns ${hcolor(DESCR_BY_OTYP[mixture])}`;
            if (newbuf)
                await update_topl(`The ${oldbuf}potion${
                    more_than_one ? ' that you dipped into' : ''} ${newbuf}.`);
            else
                await update_topl('Something happens.');

            /* objects[].oc_name_known is live in this port (js/o_init.js:142);
               oc_uname (the player's own name for the type) is not a field on
               these rows, so that term reads as "no user name". */
            if (old_dknown && !objects[old_otyp]?.oc_name_known
                && !objects[old_otyp]?.oc_uname) {
                /* C builds a fake obj so docall() names the OLD type */
                const fakeobj = { dknown: 1, otyp: old_otyp,
                                  oclass: POTION_CLASS, quan: 1 };
                await I.docall(fakeobj);
            }
        }
        /* remove the potion from inventory and re-insert it, possibly stacking
           with compatible ones; override 'pickup_burden' while doing so */
        /* invent.js's doname() is module-private; doname_invent() is the
           exported wrapper over it. */
        await hold_potion(singlepotion, 'You juggle and drop %s!',
                          I.doname_invent(singlepotion), null);
        return ECMD_TIME;
    }

    await update_topl('Interesting...');
    return ECMD_TIME;
}
// C ref: zap.c:1678 obj_unpolyable(obj) = unpolyable(obj) || obj == uball ||
// obj == uskin || obj_resists(obj, 5, 95).  js/zap.js's copy is module-private,
// so this is the same body over its exported obj_resists() (which DRAWS).
// C ref: obj.h:429 unpolyable(o) — the four otyps below (mkobj.js OBJECT_DATA
// order == onames.h order).
const P_WAN_POLYMORPH = 422, P_SPE_POLYMORPH = 399,
      P_AMULET_OF_UNCHANGING = 207;
function p_unpolyable(o) {
    return o?.otyp === P_WAN_POLYMORPH || o?.otyp === P_SPE_POLYMORPH
        || o?.otyp === POT_POLYMORPH || o?.otyp === P_AMULET_OF_UNCHANGING;
}
async function p_obj_unpolyable(obj) {
    const { obj_resists } = await import('./zap.js');
    return p_unpolyable(obj) || obj === game.uball || obj === game.uskin
        || obj_resists(obj, 5, 95);
}

// C ref: youprop.h Blindfolded_only — blind ONLY because of the blindfold.
function Blindfolded_only() { return !!game.ublindf && !BlindedTimeout(); }
// C ref: objnam.c simpleonames/thesimpleoname/cxname/Yname2/yname/The/the.
// js/invent.js exports xname/yname/doname; the rest have only module-private
// copies (js/pickup.js thesimpleoname, js/wield.js cxname/Yname2), so these are
// the local shapes over xname().
function p_simpleonames(obj) { return xname(obj); }
function p_thesimpleoname(obj) { return `the ${xname(obj)}`; }
function p_cxname(obj) { return xname(obj); }
function p_Yname2(obj) { return `Your ${xname(obj)}`; }
async function p_yname(obj) {
    const { yname } = await import('./invent.js');
    return yname(obj);
}
function p_the(s) { return `the ${s}`; }
function p_The(s) { return `The ${s}`; }
// C ref: shk.c check_unpaid(obj) — bill an unpaid item that's being used up.
async function p_check_unpaid(_obj) { /* shk.c, not reachable from here */ }

// C ref: potion.c:2379 dip_into() — the inventory item-action form of #dip: the
// POTION has already been chosen and is sitting in the command queue to answer
// the first getobj() prompt, so the two prompts come in the OPPOSITE order to
// dodip() and any floor water is ignored.  js/cmd.js:4749 already maps the
// 'altdip' inventory action to this name.
export async function dip_into() {
    /* C opens with `if (!cmdq_peek(CQ_CANNED)) { impossible(...); return
       ECMD_FAIL; }` — the potion is expected to be queued already.  This port
       has no CQ_CANNED queue for the inventory item-action path, so the guard
       has nothing to test; the getobj() below is the same first prompt. */
    /* note: the drink_ok() callback for quaffing also validates a potion to
       dip INTO */
    drink_ok_extra_reset();
    const potion = await getobj('dip', drink_ok, GETOBJ_NOFLAGS);
    if (!potion || potion.oclass !== POTION_CLASS)
        return ECMD_CANCEL;

    /* "What do you want to dip into <the potion>? [abc or ?*] " */
    const qbuf = `dip into ${is_plural(potion) ? 'one of ' : ''}${
        p_thesimpleoname(potion)}`;
    const obj = await getobj(qbuf, dip_ok, GETOBJ_PROMPT);
    if (!obj)
        return ECMD_CANCEL;
    /* inaccessible_equipment(obj, "dip", FALSE) — cursed welded gear is not
       modelled (js/potion.js:1511 dip_ok makes the same note) */
    return await potion_dip(obj, potion);
}
// C ref: potion.c:53 drink_ok_extra — "have we already offered a fountain?".
// The module-level flag lives with dodip(); reset it the way C does.
function drink_ok_extra_reset() { game._drink_ok_extra = 0; }

// C ref: potion.c:2796 mongrantswish(monp) — the monster grants a wish and
// leaves the game.  It is removed FIRST so that a wish that proves fatal (a
// blasted artifact) cannot leave it in the bones file, and tmp_at() paints the
// old glyph back over the hole while the wish prompt is up.  C's `struct monst
// **monp` is an in/out parameter; here it is a ref object with `.v`, matching
// js/sp_lev.js's convention for the same C idiom.
// DRAWS: makewish() -> readobjnam() creates the wished object.
export async function mongrantswish(monp) {
    const mon = monp?.v ?? monp;
    const mx = mon.mx, my = mon.my;
    const D = await import('./display.js');
    const glyph = D.glyph_at(mx, my);

    /* remove the monster first in case the wish proves to be fatal (blasted by
       an artifact), to keep it out of the resulting bones file */
    await p_mongone(mon);
    if (monp && 'v' in monp) monp.v = null; /* inform caller it is gone */
    /* hide that removal from the player -- the map is visible during the wish
       prompt */
    await D.tmp_at(P_DISP_ALWAYS, glyph);
    await D.tmp_at(mx, my);
    /* grant the wish */
    const { makewish } = await import('./extcmd-handlers.js');
    await makewish();
    /* clean up */
    await D.tmp_at(P_DISP_END, 0);
}
// C ref: mon.c mongone(mtmp) — the monster leaves the game (no corpse, no
// experience).  js/muse.js:672 and js/vault.js:228 each keep a private copy; neither
// is exported, so this drops it off the level list the way they do.
async function p_mongone(mon) {
    const list = game.level?.monsters;
    if (Array.isArray(list)) {
        const i = list.indexOf(mon);
        if (i >= 0) list.splice(i, 1);
    }
    if (mon) mon.mhp = 0;
}

// C ref: potion.c:2815 djinni_from_bottle(obj) — rubbing/quaffing a smoky
// potion.  DRAWS in this order: makemon(PM_DJINNI) at the hero's spot, then
// rn2(5) for the djinni's mood, and then a SECOND roll only for a blessed
// (rnd(4)) or cursed (rn2(4)) bottle.  The resulting distribution is
// blessed 80/5/5/5/5, uncursed 20/20/20/20/20, cursed 5/5/5/5/80.
// js/potion.js:1457 spends the rn2(5) in place at the peffects() call site.
export async function djinni_from_bottle(obj) {
    const u = game.u;
    const pmidx = name_to_pmidx('djinni');
    const ptr = pmidx >= 0 ? monster_by_pmidx(pmidx) : null;
    /* makemon(ptr, u.ux, u.uy, MM_NOMSG): the hero's own square, so
       makemon.c's byyou && !in_mklev branch runs enexto_core() first (the same
       spawn sequence ghost_from_bottle() above drives) */
    const spot = ptr ? enexto_spawn(u.ux, u.uy, ptr) : null;
    let mtmp = null;
    if (spot) {
        const was_full = game._full_mon_gen;
        game._full_mon_gen = true;
        try {
            mtmp = makemon(ptr, spot.x, spot.y, 0 /* MM_NOMSG */);
        } finally {
            game._full_mon_gen = was_full;
        }
    }
    if (!mtmp) {
        await update_topl('It turns out to be empty.');
        return;
    }
    placeOnLevel(mtmp, spot.x, spot.y);
    newsym(spot.x, spot.y);

    const { a_monnam } = await import('./do_name.js');
    const UH = await import('./uhitm.js');
    if (!Blind()) {
        await update_topl(`In a cloud of smoke, ${a_monnam(mtmp)} emerges!`);
        await update_topl(`${UH.Monnam(mtmp)} speaks.`);
    } else {
        await update_topl('You smell acrid fumes.');
        await update_topl('Something speaks.');
    }

    let chance = rn2(5);
    if (obj.blessed)
        chance = (chance === 4) ? rnd(4) : 0;
    else if (obj.cursed)
        chance = (chance === 0) ? rn2(4) : 4;
    /* 0,1,2,3,4:  b=80%,5,5,5,5; nc=20%,20,20,20,20; c=5%,5,5,5,80 */

    switch (chance) {
    case 0:
        await update_topl('"I am in your debt.  I will grant one wish!"');
        /* give a wish and discard the monster */
        await mongrantswish({ v: mtmp });
        break;
    case 1: {
        await update_topl('"Thank you for freeing me!"');
        const { tamedog } = await import('./dothrow.js');
        await tamedog(mtmp, null, false);
        break;
    }
    case 2: {
        await update_topl('"You freed me!"');
        mtmp.mpeaceful = true;
        const { set_malign } = await import('./makemon.js');
        set_malign(mtmp);
        break;
    }
    case 3:
        await update_topl('"It is about time!"');
        if (UH.canspotmon(mtmp))
            await update_topl(`${UH.Monnam(mtmp)} vanishes.`);
        await p_mongone(mtmp);
        break;
    default: {
        await update_topl('"You disturbed me, fool!"');
        mtmp.mpeaceful = false;
        const { set_malign } = await import('./makemon.js');
        set_malign(mtmp);
        break;
    }
    }
}

// C ref: potion.c:2873 split_mon(mon, mtmp) — clone a gremlin or a mold; a
// non-null second argument means HEAT triggered it ("... from your heat").  Hit
// points are halved with the odd point staying on the original, and the MAX hp
// is halved too (C's comment: neither reduction can make max exceed current).
// DRAWS via clone_mon()/cloneu(): the clone needs a free adjacent square
// (enexto's ring scan) and its own m_id.
// js/mhitm.js:815, js/mhitu.js:1604, js/uhitm.js:1464, js/monmove.js:2717 and
// js/polyself.js:1886 all note this as unmodelled at their own call sites.
export async function split_mon(mon, mtmp) {
    const u = game.u;
    let mtmp2 = null;
    let reason = '';

    if (mtmp) {
        const UH = await import('./uhitm.js');
        reason = ` from ${(mtmp === game.youmonst || mtmp === u) ? 'your'
                          : p_s_suffix(UH.mon_nam(mtmp))} heat`;
    }

    if (mon === game.youmonst || mon === u) {
        if (u.mh > u.mhmax)  /* sanity precaution */
            u.mh = u.mhmax;
        const { cloneu } = await import('./mhitu.js');
        mtmp2 = (u.mh > 1) ? await cloneu() : null;
        if (mtmp2) {
            /* cloneu() created it with mhpmax = u.mhmax, mhp = u.mh / 2 and
               u.mh -= mtmp2->mhp; halving the max cannot exceed current */
            mtmp2.mhpmax = Math.trunc(u.mhmax / 2);
            u.mhmax -= mtmp2.mhpmax;
            u.disp_botl = true;
            await update_topl(`You multiply${reason}!`);
        }
    } else {
        if (mon.mhp > mon.mhpmax)  /* sanity precaution */
            mon.mhp = mon.mhpmax;
        const { clone_mon } = await import('./makemon.js');
        mtmp2 = (mon.mhp > 1) ? clone_mon(mon, 0, 0) : null;
        if (mtmp2) {
            mtmp2.mhpmax = Math.trunc(mon.mhpmax / 2);
            mon.mhpmax -= mtmp2.mhpmax;
            const UH = await import('./uhitm.js');
            if (UH.canspotmon(mon))
                await update_topl(`${UH.Monnam(mon)} multiplies${reason}!`);
        }
    }
    return mtmp2;
}
