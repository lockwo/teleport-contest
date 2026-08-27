// dothrow.js — C ref: src/dothrow.c (the 't' throw / 'f' fire family).
//
// Most of dothrow.c's flight path was ported inline into js/invent.js (dothrow,
// dofire, throw_obj, throwit, thitmonst, toss_up, hitfloor, tmiss, omon_adj,
// throwing_weapon, should_mulch_missile, find_launcher).  This module holds the
// functions that had no home there: the break trio (breaktest/breakmsg/
// breakobj) with its two public wrappers, throw_gold, gem_accept, autoquiver,
// ok_to_throw, endmultishot and check_shop_obj.
//
// use_whip() belongs to apply.c but is reached ONLY from dofire()'s empty-quiver
// arm in this port, and js/apply.js is a separate write-lease, so it lives here
// beside its caller.
import { game } from './gstate.js';
import { rn2, rnd, rnl } from './rng.js';
import { m_at, newsym, update_topl, glyph_at, map_invisible } from './display.js';
import { cansee } from './vision.js';
import { isok, IS_FURNITURE, IS_SINK, LAVAWALL, WATER, POOL, MOAT,
         LAVAPOOL, TT_PIT, P_DAGGER, A_DEX, A_CHA, NEED_HTH_WEAPON,
         MM_NOMSG, EYE } from './const.js';
// C ref: trap.h:57 enum trap_types — used by the hurtle_step() port below.
import { PIT, SPIKED_PIT, HOLE, TRAPDOOR, MAGIC_PORTAL, FIRE_TRAP,
         VIBRATING_SQUARE } from './const.js';
import { mflags1_of, mflags2_of, mflags3_of, msound_of, M1_BREATHLESS,
         M1_NOEYES, M1_WALLWALK, M2_DOMESTIC, M3_WANTSARTI, MS_LEADER,
         is_human_flag, is_demon_flag } from './monflags_data.js';
import { attacktype, dmgtype, AT_WEAP, AT_ENGL, AT_HUGS,
         AD_STCK, AD_WRAP } from './monattk_data.js';
import { objects, BOULDER, CORPSE, POTION_CLASS, GEM_CLASS, WEAPON_CLASS,
         ARMOR_CLASS, EGG, STATUE, FOOD_CLASS, SCROLL_CLASS, SPBOOK_CLASS,
         place_object } from './mkobj.js';
import { surface } from './dungeon.js';
import { acurr_eff } from './attrib.js';
import { night, phase_of_the_moon, FULL_MOON } from './calendar.js';
import { name_to_pmidx, monster_by_pmidx, makemon, set_malign,
         is_covetous } from './makemon.js';
import * as I from './invent.js';

// C ref: hack.h ECMD_* result codes.
const ECMD_OK = 0, ECMD_CANCEL = 1, ECMD_TIME = 3;

// onames.h otyps (mkobj.js OBJECT_DATA numbering).
export const BULLWHIP = 82;
// Four of these were off: ROCK named touchstone(472), MIRROR named oil
// lamp(227), POT_OIL named gain ability(297) and POT_WATER named blindness(300).
// POT_WATER was self-cancelling — breakmsg()/breakobj() switch on
// `oclass == POTION_CLASS ? POT_WATER : otyp`, so the same wrong number sat on
// both sides — until breakobj()'s `otyp != POT_WATER` vapor gate read it
// directly and made holy water smell of vapors.
const AKLYS = 80, FLINT = 473, ROCK = 474,
    MIRROR = 230, EXPENSIVE_CAMERA = 229, CRYSTAL_BALL = 231, LENSES = 232,
    MELON = 280, CREAM_PIE = 287, POT_OIL = 321, POT_WATER = 322,
    BLINDING_VENOM = 479, ACID_VENOM = 480, BANANA = 281;

// C ref: objclass.h obj_material_types.
const VEGGY = 3, GLASS = 19, GEMSTONE = 20;
// C ref: body_part() indices as js/invent.js's HUMANOID_PARTS numbers them.
const FOOT = 5, HAND = 6, HEAD = 8;

// ── terrain / state predicates ───────────────────────────────────────────────

// C ref: rm.h IS_WATERWALL(typ).
function IS_WATERWALL(typ) { return typ === WATER; }
function typ_at(x, y) { return game.level?.at?.(x, y)?.typ ?? 0; }
function is_lava_at(x, y) { const t = typ_at(x, y); return t === LAVAPOOL || t === LAVAWALL; }
function is_pool_at(x, y) { const t = typ_at(x, y); return t === POOL || t === MOAT || t === WATER; }
function is_pool_or_lava_at(x, y) { return is_pool_at(x, y) || is_lava_at(x, y); }
function Blind() { return !!(game.u?.uprops?.Blinded || game.u?.Blinded); }
// C ref: mondata.h breathless(ptr) == (mflags1 & M1_BREATHLESS),
// haseyes(ptr) == !(mflags1 & M1_NOEYES).
function breathless(ptr) { return (mflags1_of(ptr) & M1_BREATHLESS) !== 0; }
function haseyes(ptr) { return (mflags1_of(ptr) & M1_NOEYES) === 0; }
// C ref: objnam.c vtense(subj, verb) — `verb` arrives in the plural (no
// trailing s) and is returned unchanged when `subj` reads as plural.  The
// special_subjs[] false-match table and the " of "/" from "/" called " head-noun
// scan are omitted: this port's only caller passes a body_part() noun, which
// contains neither.
function vtense(subj, verb) {
    if (subj) {
        const s = String(subj);
        if (!/^an? /i.test(s)) {
            const last = s.charAt(s.length - 1).toLowerCase();
            const prev = s.length > 1 ? s.charAt(s.length - 2).toLowerCase() : '';
            if ((last === 's' && s.length > 1 && prev !== 'u' && prev !== 's')
                || /eeth$|feet$|ia$|ae$/i.test(s))
                return verb;
            if (/^(they|you)$/i.test(s)) return verb;
        }
    }
    const v = String(verb), lc = v.toLowerCase(), end = lc.charAt(v.length - 1);
    if (lc === 'are') return 'is';
    if (lc === 'have') return `${v.slice(0, -2)}s`;
    if ('zxs'.includes(end)
        || (v.length >= 2 && end === 'h' && 'cs'.includes(lc.charAt(v.length - 2)))
        || (v.length === 2 && end === 'o'))
        return `${v}es`;
    if (end === 'y' && !'aeiou'.includes(lc.charAt(v.length - 2)))
        return `${v.slice(0, -1)}ies`;
    return `${v}s`;
}
// C ref: hack.h next2u(x,y).
function next2u(x, y) {
    const u = game.u;
    return Math.abs(x - u.ux) <= 1 && Math.abs(y - u.uy) <= 1;
}

// C ref: dungeon.c ceiling(x,y) — js/invent.js owns the one copy (ceiling_of).
const ceiling = (x, y) => I.ceiling_of(x, y);

// C ref: objnam.c Doname2(obj) — doname() with a capital first letter.
function Doname2(obj) {
    const d = I.doname_invent(obj);
    return d.charAt(0).toUpperCase() + d.slice(1);
}
// C ref: objnam.c an(s) / the(s) / s_suffix(s).
function an(s) { return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`; }
function the_str(s) { return /^[A-Z]/.test(s) ? s : `the ${s}`; }
// C ref: objnam.c Tobjnam(obj, verb) — "The food ration stops".
function Tobjnam(obj, verb) {
    const nm = the_str(I.xname(obj));
    return `${nm.charAt(0).toUpperCase()}${nm.slice(1)} ${I.otense(obj, verb)}`;
}
// C ref: objnam.c helm_simple_name(helmet) — "helm" for a hard hat, else "hat".
function helm_simple_name(o) {
    const mat = objects[o?.otyp]?.material | 0;
    const hard = (mat >= 11 /* IRON */ && mat <= 17 /* MITHRIL */) || mat === GLASS;
    return hard ? 'helm' : 'hat';
}
// C ref: mondata.h bigmonst(ptr) — msize >= MZ_LARGE (3).
function bigmonst(ptr) { return (ptr?.msize ?? 2 /* MZ_MEDIUM */) >= 3; }
// C ref: rm.h ZAP_POS(typ) — typ >= POOL; a thrown object cannot pass solid
// terrain.
function zap_pos(typ) { return typ >= 16 /* POOL */; }
// C ref: monmove.c closed_door(x,y) — a door that is shut or locked.
// rm.h D_CLOSED 0x04, D_LOCKED 0x08 (D_ISOPEN is 0x02 and does NOT block).
function closed_door(x, y) {
    const loc = game.level?.at?.(x, y);
    return loc?.typ === 23 /* DOOR */ && ((loc.doormask || 0) & (0x04 | 0x08)) !== 0;
}
// C ref: youprop.h Fumbling / Glib.
function Fumbling() { return !!(game.u?.HFumbling || game.u?.EFumbling); }
function Glib() { return ((game.u?.Glib || 0) > 0) || ((game.u?.uprops?.Glib || 0) > 0); }
// C ref: role.c Role_if(PM_ARCHEOLOGIST) — role 0 in u_init.c's ordering.
const PM_ARCHEOLOGIST = 0;
// C ref: svl.level.objects[x][y] — the top of the floor pile at (x,y).
function top_floor_obj(x, y) { return I.objects_at(x, y)[0] || null; }
// C ref: apply.c use_whip()'s dead-horse test — a horse, warhorse or pony corpse.
const HORSE_CORPSE_NAMES = new Set(['pony', 'horse', 'warhorse']);
function corpse_is_horse(otmp) {
    const nm = monster_by_pmidx(otmp?.corpsenm)?.name;
    return nm != null && HORSE_CORPSE_NAMES.has(nm);
}
// C ref: apply.c use_whip() — mbodypart(mtmp, HAND), pluralized for a two-
// handed weapon.
async function mon_hand_noun(mtmp, otmp) {
    const { mbodypart } = await import('./monmove.js');
    const hand = mbodypart(mtmp, HAND);
    return I.bimanual(otmp) ? I.makeplural(hand) : hand;
}
// C ref: pickup.c pickup_object(obj, count, telekinesis) reduced to the single
// floor-object case the whip snare uses.  Returns 1 when the object was picked
// up, 0 when it was not.
async function pickup_one_object(otmp) {
    if (!otmp) return 0;
    I.obj_extract_self(otmp);
    await I.hold_another_object(otmp, 'You drop %s!', I.doname_invent(otmp), null);
    return 1;
}
// C ref: trap.c reset_utrap(msg) — clear the trapped state.
function reset_utrap(_msg) {
    const u = game.u;
    u.utrap = 0;
    u.utraptype = 0;
}

// ── ok_to_throw (C ref: dothrow.c:296) ───────────────────────────────────────
//
// Common to dothrow() and dofire(): the count prefix becomes the volley limit,
// the pending multi-turn count is consumed, and a form that cannot hold things
// or a hero at OVERLOADED is refused before any prompt is drawn.
// Returns the shot limit, or -1 when the command is refused.
export async function ok_to_throw() {
    const shotlimit = Math.max(0, game.command_count | 0);
    game.multi = 0; /* reset; it's been used up */

    if (I.notake_youmonst()) {
        await update_topl('You are physically incapable of throwing or shooting anything.');
        return -1;
    }
    if (I.nohands_youmonst()) {
        await update_topl("You can't throw or shoot without hands.");
        return -1;
    }
    if (await I.check_capacity_throw()) return -1;
    return shotlimit;
}

// ── endmultishot (C ref: dothrow.c:589) ──────────────────────────────────────
//
// Truncate an in-flight volley: an interruption (the hero knocked back, the
// target dying) makes the current shot the last one.
export async function endmultishot(verbose) {
    const ms = game.m_shot;
    if (!ms) return;
    if (ms.i < ms.n) {
        if (verbose && !game.context?.mon_moving) {
            await update_topl(`You stop ${ms.s ? 'firing' : 'throwing'} after the ${
                ms.i}${ordin(ms.i)} ${ms.s ? 'shot' : 'toss'}.`);
        }
        ms.n = ms.i; /* make current shot be the last */
    }
}
// C ref: hacklib.c ordin(n) — "1st", "2nd", "3rd", "4th"; 11/12/13 take "th".
function ordin(n) {
    const dd = n % 10;
    return (dd === 0 || dd > 3 || Math.trunc((n % 100) / 10) === 1) ? 'th'
        : (dd === 1) ? 'st' : (dd === 2) ? 'nd' : 'rd';
}

// ── autoquiver (C ref: dothrow.c:380) ────────────────────────────────────────
//
// Fill an empty quiver with the best missile in the pack.  Reached only with the
// (non-default) autoquiver option On; RNG-free, but it decides what a later 'f'
// fires, which is not.
export function autoquiver() {
    if (game.uquiver) return;
    let oammo = null, omissile = null, omisc = null, altammo = null;

    for (const otmp of I.inventoryArray()) {
        if (otmp.owornmask || otmp.oartifact || !otmp.dknown) {
            /* skip it */
        } else if (otmp.otyp === ROCK
                   || (otmp.otyp === FLINT && objects[otmp.otyp]?.oc_name_known)
                   || (otmp.oclass === GEM_CLASS
                       && objects[otmp.otyp]?.material === GLASS
                       && objects[otmp.otyp]?.oc_name_known)) {
            if (I.uslinging()) oammo = otmp;
            else if (I.ammo_and_launcher(otmp, game.uswapwep)) altammo = otmp;
            else if (!omisc) omisc = otmp;
        } else if (otmp.oclass === GEM_CLASS) {
            /* skip non-rock gems -- ammo, but the player must pick them */
        } else if (I.is_ammo(otmp)) {
            if (I.ammo_and_launcher(otmp, game.uwep)) oammo = otmp;
            else if (I.ammo_and_launcher(otmp, game.uswapwep)) altammo = otmp;
            else omisc = otmp;
        } else if (I.is_missile(otmp)) {
            omissile = otmp;
        } else if (otmp.oclass === WEAPON_CLASS && I.throwing_weapon(otmp)) {
            if ((objects[otmp.otyp]?.oc_skill ?? 0) === P_DAGGER && !omissile)
                omissile = otmp;
            else if (otmp.otyp === AKLYS)
                continue;
            else
                omisc = otmp;
        }
    }

    if (oammo) I.setuqwep(oammo);
    else if (omissile) I.setuqwep(omissile);
    else if (altammo) I.setuqwep(altammo);
    else if (omisc) I.setuqwep(omisc);
}

// ── the break trio (C ref: dothrow.c:2416-2653) ──────────────────────────────

// C ref: obj.h is_crackable(o) — glass armor cracks rather than shattering.
function is_crackable(obj) {
    return obj?.oclass === ARMOR_CLASS && objects[obj.otyp]?.material === GLASS;
}

// C ref: dothrow.c breaktest(obj) — will this shatter when it hits something
// hard?  Crystal plate mail and the helm of brilliance answer TRUE here but
// survive breakobj() (erode_obj cracks them instead).
export function breaktest(obj) {
    let nonbreakchance = 1;
    if (obj.oclass === ARMOR_CLASS && objects[obj.otyp]?.material === GLASS)
        nonbreakchance = 90;
    // C ref: mkobj.c obj_resists() — the invocation items and Rider corpses
    // resist WITHOUT rolling; a bare rn2(100) here burned a draw on them.
    if (I.obj_resists(obj, nonbreakchance, 99)) return false;
    if (objects[obj.otyp]?.material === GLASS && !obj.oartifact
        && obj.oclass !== GEM_CLASS)
        return true;
    switch (obj.oclass === POTION_CLASS ? POT_WATER : obj.otyp) {
    case EXPENSIVE_CAMERA:
    case POT_WATER: /* really, all potions */
    case EGG:
    case CREAM_PIE:
    case MELON:
    case ACID_VENOM:
    case BLINDING_VENOM:
        return true;
    default:
        return false;
    }
}

// C ref: dothrow.c breakmsg(obj, in_view) — the per-class breakage message.  A
// blanket "X shatters!" (what the port printed for everything) is wrong for
// eggs/melons ("Splat!"), cream pies ("What a mess!") and venom ("Splash!"),
// and omits the " into a thousand pieces" tail mirrors/lenses/cameras take.
export async function breakmsg(obj, in_view) {
    if (is_crackable(obj)) return; /* breakobj() -> erode_obj() speaks */

    const key = obj.oclass === POTION_CLASS ? POT_WATER : obj.otyp;
    let to_pieces = '';
    switch (key) {
    case LENSES:
    case MIRROR:
    case CRYSTAL_BALL:
    case EXPENSIVE_CAMERA:
        to_pieces = ' into a thousand pieces';
        await shatter_msg(obj, in_view, to_pieces);
        break;
    case POT_WATER: /* really, all potions */
        await shatter_msg(obj, in_view, '');
        break;
    case EGG:
    case MELON:
        await update_topl('Splat!');
        break;
    case CREAM_PIE:
        if (in_view) await update_topl('What a mess!');
        break;
    case ACID_VENOM:
    case BLINDING_VENOM:
        await update_topl('Splash!');
        break;
    default:
        // C's default arm is the glass/crystal WAND, which shares the mirror
        // group's text; anything else here is an impossible() in C.
        await shatter_msg(obj, in_view, ' into a thousand pieces');
        break;
    }
}
async function shatter_msg(obj, in_view, to_pieces) {
    if (!in_view) {
        await update_topl('You hear something shatter!');
    } else {
        await update_topl(`${Doname2(obj)} shatter${
            (obj.quan || 1) === 1 ? 's' : ''}${to_pieces}!`);
    }
}

// C ref: dothrow.c release_camera_demon(obj, x, y) — a broken expensive camera
// sometimes lets its picture-painting demon out.  Two rn2(3) draws, then
// makemon()'s own stream.
export async function release_camera_demon(obj, x, y) {
    if (!rn2(3)) {
        // C ref: monst.h PM_HOMUNCULUS / PM_IMP — resolved from the generated
        // mons[] table BY NAME; hand-written pmidx lists in this port have gone
        // stale three separate times.
        const idx = name_to_pmidx(rn2(3) ? 'homunculus' : 'imp');
        const mtmp = (idx >= 0) ? makemon(monster_by_pmidx(idx), x, y, MM_NOMSG) : null;
        if (mtmp) {
            const U = await import('./uhitm.js');
            if (U.canspotmon(mtmp))
                await update_topl('The picture-painting demon is released!');
            mtmp.mpeaceful = obj.cursed ? 0 : 1;
        }
    }
}

// C ref: dothrow.c breakobj(obj, x, y, hero_caused, from_invent) — destroy the
// object and run its side effects.  Returns 1 when obj is gone.
export async function breakobj(obj, x, y, hero_caused, from_invent) {
    let fracture = false;

    if (is_crackable(obj)) {
        // C: erode_obj(obj, ..., ERODE_CRACK, EF_DESTROY|EF_VERBOSE) — glass
        // armor takes four cracks before it is destroyed.  js/mkobj.js carries
        // greatest_erosion() but no erode_obj(), so the crack step is recorded
        // on the object and the item survives, which is erode_obj()'s answer
        // for the first three cracks.
        obj.oeroded2 = Math.min(3, (obj.oeroded2 | 0) + 1);
        return 0;
    }

    switch (obj.oclass === POTION_CLASS ? POT_WATER : obj.otyp) {
    case MIRROR:
        if (hero_caused) I.change_luck(-2);
        break;
    case POT_WATER: /* really, all potions */
        obj.in_use = 1; /* in case it's fatal */
        if (obj.otyp === POT_OIL && obj.lamplit) {
            const { explode_oil } = await import('./explode.js');
            await explode_oil(obj, x, y);
        } else if (next2u(x, y)) {
            const ptr = I.youmonst_data_pub();
            if (!breathless(ptr) || haseyes(ptr)) {
                const P = await import('./potion.js');
                /* wet towel protects both eyes and breathing */
                if (obj.otyp !== POT_WATER && !P.Half_gas_damage()) {
                    if (!breathless(ptr)) {
                        // [what about "familiar odor" when known?]
                        await update_topl('You smell a peculiar odor...');
                    } else {
                        const PS = await import('./polyself.js');
                        let eyes = PS.body_part(EYE);
                        if (PS.eyecount(ptr) !== 1) eyes = I.makeplural(eyes);
                        await update_topl(`Your ${eyes} ${vtense(eyes, 'water')}.`);
                    }
                }
                await P.potionbreathe_hero(obj);
            }
        }
        break;
    case EXPENSIVE_CAMERA:
        await release_camera_demon(obj, x, y);
        break;
    case EGG:
        /* breaking your own eggs is bad luck */
        if (hero_caused && obj.spe && (obj.corpsenm | 0) >= 0)
            I.change_luck(-Math.min(obj.quan || 1, 5));
        break;
    case BOULDER:
    case STATUE:
        /* caller handles disposition; we only do the shop-theft handling */
        fracture = true;
        break;
    default:
        break;
    }

    if (hero_caused && (from_invent || obj.unpaid))
        await check_shop_obj(obj, x, y, true);

    if (!fracture) I.delobj(obj);
    return 1;
}

// C ref: dothrow.c hero_breaks(obj, x, y, breakflags) — breaktest + breakmsg +
// breakobj for something the hero did.
export const BRK_FROM_INV = 0x01;
export async function hero_breaks(obj, x, y, breakflags) {
    const from_invent = (breakflags & BRK_FROM_INV) !== 0;
    const in_view = Blind() ? false : (from_invent || cansee(x, y));
    if (!breaktest(obj)) return 0;
    await breakmsg(obj, in_view);
    return await breakobj(obj, x, y, true, from_invent);
}

// C ref: dothrow.c breaks(obj, x, y) — the same, for a non-hero cause.
export async function breaks(obj, x, y) {
    const in_view = Blind() ? false : cansee(x, y);
    if (!breaktest(obj)) return 0;
    await breakmsg(obj, in_view);
    return await breakobj(obj, x, y, false, false);
}

// ── check_shop_obj (C ref: dothrow.c:1180) ───────────────────────────────────
//
// Billing for an object that left the hero's hands inside a shop.  js/shkroom.js
// carries costly_spot()/addtobill() but no stolen_value()/subfrombill()/
// sellobj(), so only the no_charge marking that the rest of the port reads runs.
export async function check_shop_obj(obj, x, y, broken) {
    const { costly_spot } = await import('./shkroom.js');
    const costly_xy = costly_spot(x, y);
    if (broken || !costly_xy) {
        if (broken) obj.no_charge = 1;
    }
}

// ── gem_accept (C ref: dothrow.c:2308) ───────────────────────────────────────
//
// A unicorn catches a thrown gem.  The Luck change is the point of the routine
// and is RNG-bearing for a cross-aligned unicorn.
export async function gem_accept(mon, obj) {
    const U = await import('./uhitm.js');
    const nogood = ' is not interested in your junk.',
        acceptgift = ' accepts your gift.',
        maybeluck = ' hesitatingly',
        noluck = ' graciously',
        addluck = ' gratefully';
    const sgn = (n) => ((n > 0) ? 1 : (n < 0) ? -1 : 0);
    const is_buddy = sgn(mon?.data?.maligntyp | 0) === sgn(game.u?.ualign?.type | 0);
    const is_gem = objects[obj.otyp]?.material === GEMSTONE;
    let buf = U.Monnam(mon);
    let ret = 0, nopick = false;

    mon.mpeaceful = 1;
    mon.mavenge = 0;

    if (obj.dknown && objects[obj.otyp]?.oc_name_known) {
        /* object properly identified */
        if (is_gem) {
            if (is_buddy) { buf += addluck; I.change_luck(5); }
            else { buf += maybeluck; I.change_luck(rn2(7) - 3); }
        } else { buf += nogood; nopick = true; }
    } else if (obj.oname || objects[obj.otyp]?.oc_uname) {
        /* making guesses */
        if (is_gem) {
            if (is_buddy) { buf += addluck; I.change_luck(2); }
            else { buf += maybeluck; I.change_luck(rn2(3) - 1); }
        } else { buf += nogood; nopick = true; }
    } else {
        /* value completely unknown to the hero */
        if (is_gem) {
            if (is_buddy) { buf += addluck; I.change_luck(1); }
            else { buf += maybeluck; I.change_luck(rn2(3) - 1); }
        } else { buf += noluck; }
    }
    if (!nopick) {
        buf += acceptgift;
        if (obj.unpaid) await check_shop_obj(obj, mon.mx, mon.my, true);
        const { mpickobj } = await import('./steal.js');
        mpickobj(mon, obj);
        ret = 1;
    }
    if (!Blind()) await update_topl(buf);
    // C: `if (!tele_restrict(mon)) rloc(mon, RLOC_MSG)`.
    const T = await import('./teleport.js');
    if (T.rloc) await T.rloc(mon, true);
    return ret;
}

// ── tamedog (C ref: dog.c:1143) ──────────────────────────────────────────────
//
// thitmonst()'s pet-food arm (dothrow.c:2267) sits between the potion arm and
// the engulfer arm and was missing entirely, so every throw at a pet fell
// through to `tmiss(obj, mon, TRUE)`.  That cost the arm's dogfood()
// obj_resists() rn2(100) AND emitted tmiss's `maybe_wakeup && !rn2(3)` wakeup
// roll that C's `tmiss(obj, mon, FALSE)` short-circuits away: two wrong draws
// where C makes one.  tamedog() lives here beside its caller for the same
// reason use_whip() does — js/dog.js is a separate write-lease.

// C ref: mextra.h dogfood enum — lower is more desirable.
const DOGFOOD = 0, ACCFOOD = 2, MANFOOD = 3;
// C ref: monsym.h S_DOG / S_UNICORN (mons[].mlet, this port's data.mcls).
const S_DOG = 4, S_UNICORN = 21;

// C ref: mons[].mlet.  js/dog.js builds a STARTING pet's `data` by hand and
// leaves mcls off it, so read the flag off the mons[] row when the synthetic
// row has none — otherwise a starting pony answers "not S_UNICORN".
function mcls_of(ptr) {
    return ptr?.mcls ?? monster_by_pmidx(ptr?.pmidx)?.mcls;
}
// C ref: mondata.h is_domestic(ptr) == (mflags2 & M2_DOMESTIC).
function is_domestic(ptr) { return (mflags2_of(ptr) & M2_DOMESTIC) !== 0; }
// C ref: mondata.c sticks(ptr) — whether the hero's own form holds a victim.
function sticks(ptr) {
    return dmgtype(ptr, AD_STCK)
        || (dmgtype(ptr, AD_WRAP) && !attacktype(ptr, AT_ENGL))
        || attacktype(ptr, AT_HUGS);
}
function Upolyd() { return !!game.u?.Upolyd; }
function Hallucination() {
    return ((game.u?.uprops?.Hallucination || 0) > 0) || !!game.u?.HHallucination;
}

// C ref: mondata.h befriend_with_obj(ptr, obj) — thrown food that a monster
// will accept: bananas for monkeys and apes; any food for a domestic animal,
// except that horses (the non-unicorn half of S_UNICORN) take only always-veggy
// food or a lichen corpse.
export function befriend_with_obj(ptr, obj) {
    const pm = ptr?.pmidx;
    if (pm != null && (pm === name_to_pmidx('monkey') || pm === name_to_pmidx('ape')))
        return obj.otyp === BANANA;
    return is_domestic(ptr) && obj.oclass === FOOD_CLASS
        && (mcls_of(ptr) !== S_UNICORN
            || objects[obj.otyp]?.material === VEGGY
            || (obj.otyp === CORPSE && obj.corpsenm === name_to_pmidx('lichen')));
}

// C ref: dog.c initedog(mtmp, everything) — consumes no RNG.  u.uconduct.pets++
// and the livelog line are the only side effects outside the edog struct.
function initedog(mtmp, everything) {
    const edogp = mtmp.edog;
    const minhungry = (game.moves || 0) + 1000;
    const minimumtame = is_domestic(mtmp.data) ? 10 : 5;

    mtmp.mtame = Math.max(minimumtame, mtmp.mtame | 0);
    mtmp.mpeaceful = 1;
    mtmp.mavenge = 0;
    set_malign(mtmp);                   /* recalc alignment now that it's tamed */
    if (everything) {
        mtmp.mleashed = 0;
        mtmp.meating = 0;
        edogp.droptime = 0;
        edogp.dropdist = 10000;
        edogp.apport = acurr_eff(A_CHA);
        edogp.whistletime = 0;
        edogp.ogoal = { x: -1, y: -1 };  /* force error if used before set */
        edogp.abuse = 0;
        edogp.revivals = 0;
        edogp.mhpmax_penalty = 0;
        edogp.killed_by_u = 0;
    } else if (!(edogp.apport > 0)) {
        edogp.apport = 1;
    }
    if (!((edogp.hungrytime | 0) >= minhungry)) edogp.hungrytime = minhungry;
    const u = game.u;
    if (u) { u.uconduct = u.uconduct || {}; u.uconduct.pets = (u.uconduct.pets | 0) + 1; }
}

// C ref: dog.c tamedog(mtmp, obj, givemsg) — TRUE means the monster became tame
// (or ate the thrown food), which tells thitmonst() the object is gone.
export async function tamedog(mtmp, obj, givemsg) {
    const u = game.u;
    const DM = await import('./dogmove.js');
    const U = await import('./uhitm.js');
    let blessed_scroll = false;

    if (obj && (obj.oclass === SCROLL_CLASS || obj.oclass === SPBOOK_CLASS)) {
        blessed_scroll = !!obj.blessed;
        obj = null;                     /* the rest assumes 'obj' is food */
    }
    /* reduce timed sleep or paralysis, leaving mcanmove as-is */
    if (mtmp.mfrozen) mtmp.mfrozen = Math.floor((mtmp.mfrozen + 1) / 2);
    /* end indefinite sleep; distance==1 limits the waking to mtmp */
    if (mtmp.msleeping) {
        const { wake_nearto } = await import('./cmd.js');
        await wake_nearto(mtmp.mx, mtmp.my, 1);
    }
    /* the Wiz, Medusa and the quest nemeses aren't even made peaceful */
    if (mtmp.iswiz || mtmp.data?.pmidx === name_to_pmidx('Medusa')
        || (mflags3_of(mtmp.data) & M3_WANTSARTI))
        return false;

    if (givemsg && !mtmp.mpeaceful && U.canspotmon(mtmp)) {
        await update_topl(`${U.Monnam(mtmp)} seems ${
            Hallucination() ? 'really chill' : 'more amiable'}.`);
        givemsg = false;                /* don't give another message below */
    }
    mtmp.mpeaceful = 1;
    set_malign(mtmp);
    // C reads flags.moonphase, which newgame() latches once (allmain.c:57);
    // nothing in this port stores it yet, so recompute when it is absent.
    const moonphase = game.flags?.moonphase ?? phase_of_the_moon();
    if (moonphase === FULL_MOON && night() && rn2(6) && obj
        && mcls_of(mtmp.data) === S_DOG)
        return false;

    /* if we cannot tame it, at least it's no longer afraid */
    mtmp.mflee = 0;
    mtmp.mfleetim = 0;

    /* make a grabber let go now, whether it becomes tame or not */
    if (mtmp === u.ustuck) {
        if (u.uswallow) {
            const MH = await import('./mhitu.js');
            await MH.expels(mtmp, mtmp.data, true);
        } else if (!(Upolyd() && sticks(I.youmonst_data_pub()))) {
            /* C ref: mon.c unstuck(mtmp) */
            u.ustuck = null;
            u.uswallow = 0;
            U.unstuck_mspec_used(mtmp);
        }
    }

    /* feeding it treats makes it tamer */
    if (mtmp.mtame && obj) {
        // C reads EDOG(mtmp)->hungrytime unconditionally; this port can hold a
        // tame monster with no edog (read.js's MM_EDOG lights), so treat a
        // missing hunger clock as "not hungry" (C's initedog always leaves it
        // above svm.moves) rather than dereferencing it.  The guard sits AFTER
        // dogfood() so the obj_resists rn2(100) still fires where C fires it.
        let tasty;
        if (mtmp.mcanmove && !mtmp.mconf && !mtmp.meating
            && ((tasty = DM.dogfood(mtmp, obj)) === DOGFOOD
                || (tasty <= ACCFOOD
                    && (mtmp.edog?.hungrytime ?? Infinity) <= (game.moves || 0)))
            && mtmp.edog) {
            /* pet will "catch" and eat this thrown food */
            if (U.canseemon(mtmp)) {
                const csz = monster_by_pmidx(obj.corpsenm)?.msize;
                const big_corpse = obj.otyp === CORPSE && csz != null
                    && csz > (monster_by_pmidx(mtmp.data?.pmidx)?.msize ?? 0);
                await update_topl(`${U.Monnam(mtmp)} catches ${the_str(I.xname(obj))}${
                    !big_corpse ? '.' : ', or vice versa!'}`);
            } else if (cansee(mtmp.mx, mtmp.my)) {
                await update_topl(`${Tobjnam(obj, 'stop')}.`);
            }
            place_object(obj, mtmp.mx, mtmp.my); /* dog_eat expects a floor object */
            await DM.dog_eat(mtmp, mtmp.edog, obj, mtmp.mx, mtmp.my);
            /* a non-null result suppresses tmiss()'s "miss" message and
               implies the object has been deleted */
            return true;
        }
        return false;
    }

    /* maximum tameness is 20, only reachable via eating; taming magic may raise
       an already-tame monster below 10 */
    if (mtmp.mtame && mtmp.mtame < 10) {
        if (mtmp.mtame < rnd(10)) mtmp.mtame++;
        if (blessed_scroll) {
            mtmp.mtame += 2;
            if (mtmp.mtame > 10) mtmp.mtame = 10;
        }
        return false;                   /* didn't just get tamed */
    }
    /* pacify an angry shopkeeper but don't tame them */
    if (mtmp.isshk) {
        const S = await import('./shk.js');
        await S.make_happy_shk(mtmp, false);
        return false;
    }

    if (!mtmp.mcanmove
        || mtmp.isshk || mtmp.isgd || mtmp.ispriest || mtmp.isminion
        || is_covetous(mtmp.data) || is_human_flag(mtmp.data)
        || (is_demon_flag(mtmp.data) && !is_demon_flag(I.youmonst_data_pub()))
        || (obj && DM.dogfood(mtmp, obj) >= MANFOOD))
        return false;

    // C: `mtmp->m_id == svq.quest_status.leader_m_id`.  This port carries no
    // leader_m_id; monsters.h marks every quest-leader species MS_LEADER, which
    // js/questpgr.js already uses as the leader identity (no RNG either way).
    if (msound_of(mtmp.data) === MS_LEADER)
        return false;

    /* add the pet extension */
    if (!mtmp.edog) {
        mtmp.edog = {};                 /* newedog(mtmp) */
        initedog(mtmp, true);
    } else {
        initedog(mtmp, false);
    }

    if (obj) {                          /* thrown food */
        /* defer eating until the edog extension has been set up */
        place_object(obj, mtmp.mx, mtmp.my);
        // C passes devour=TRUE here (it halves dog_nutrition()'s hungrytime
        // bump); js/dogmove.js's dog_eat has no devour parameter yet.
        if (await DM.dog_eat(mtmp, mtmp.edog, obj, mtmp.mx, mtmp.my) === 2)
            return true;                /* oops, it died... */
    }

    if (givemsg && U.canspotmon(mtmp))
        await update_topl(`${U.Monnam(mtmp)} seems quite ${
            Hallucination() ? 'approachable' : 'friendly'}.`);

    newsym(mtmp.mx, mtmp.my);
    // C's redraw_worm(mtmp) follows for a long worm; no tamable-by-food species
    // has a wormno.
    if (attacktype(mtmp.data, AT_WEAP)) {
        mtmp.weapon_check = NEED_HTH_WEAPON;
        const M = await import('./monmove.js');
        await M.mon_wield_item(mtmp);
    }
    return true;
}

// ── throw_gold (C ref: dothrow.c:2655) ───────────────────────────────────────
//
// Throwing a stack of coins.  C routes here from throw_obj() BEFORE the
// canletgo/welded/multishot machinery, so gold never rolls a volley and never
// splits: the whole stack flies.
export async function throw_gold(obj) {
    const u = game.u;
    if (!u.dx && !u.dy && !u.dz) {
        await update_topl('You cannot throw gold at yourself.');
        return ECMD_CANCEL;
    }
    I.freeinv(obj);

    let bx = u.ux, by = u.uy;
    if (u.dz) {
        if (u.dz < 0) {
            await update_topl(`The gold hits the ${ceiling(u.ux, u.uy)}, then falls back on top of your ${
                I.body_part(HEAD)}.`);
            if (game.uarmh)
                await update_topl(`Fortunately, you are wearing ${an(helm_simple_name(game.uarmh))}!`);
        }
    } else {
        /* consistent with range for normal objects */
        const range = Math.trunc(I.acurrstr() / 2) - Math.trunc((obj.owt || 0) / 40);
        const odx = u.ux + u.dx, ody = u.uy + u.dy;
        // C: `!ZAP_POS(levl[odx][ody].typ) || closed_door(odx, ody)` — with no
        // room to move, the coins land at the hero's feet.
        if (!isok(odx, ody) || !zap_pos(typ_at(odx, ody)) || closed_door(odx, ody)) {
            /* bhitpos stays on the hero */
        } else {
            const land = I.bhit_thrown_landing(u.dx, u.dy, range);
            bx = land.x; by = land.y;
            if (land.mon && (await ghitm(land.mon, obj))) return ECMD_TIME;
        }
    }

    if (u.dz > 0) await update_topl(`The gold hits the ${surface(bx, by)}.`);
    place_object(obj, bx, by);
    obj.where = 3 /* OBJ_FLOOR */;
    I.stackobj(obj);
    newsym(bx, by);
    return ECMD_TIME;
}

// C ref: steal.c ghitm(mtmp, gold) — a monster reacts to gold thrown at it.
// Returns TRUE when the monster keeps it.  The bribe/leprechaun/soldier arms
// need the gold-lover and bribe subsystems, which this port does not have; the
// wake-and-pick-up behaviour common to every arm is what runs.
async function ghitm(mtmp, gold) {
    const U = await import('./uhitm.js');
    mtmp.msleeping = 0;
    if (!mtmp.mcanmove) return false;
    await U.wakeupAttack(mtmp, false);
    const { mpickobj } = await import('./steal.js');
    mpickobj(mtmp, gold);
    return true;
}

// ── use_whip (C ref: apply.c:2955) ───────────────────────────────────────────
//
// Reached from dofire() when the quiver is empty, autoquiver is off and the
// wielded weapon is a bullwhip — the Archeologist's starting state, so 'f' on
// turn one lands here.  Without it dofire() printed "You have no ammunition
// readied." and opened the fire prompt, so every following keystroke was read
// by the wrong reader.
export async function use_whip(obj, getDir) {
    const U = await import('./uhitm.js');
    const u = game.u;
    const msg_slipsfree = 'The bullwhip slips free.';
    const msg_snap = 'Snap!';
    const res = ECMD_OK;

    if (obj !== game.uwep) {
        // C wields it and re-queues doapply; the wield is what costs the turn.
        if (await I.wield_tool(obj, 'lash')) return ECMD_TIME;
        return ECMD_OK;
    }
    const dir = await getDir();
    if (!dir) return res | ECMD_CANCEL;
    u.dx = dir.dx; u.dy = dir.dy; u.dz = dir.dz || 0;

    let mtmp, rx, ry;
    if (u.uswallow) {
        mtmp = u.ustuck;
        rx = mtmp.mx; ry = mtmp.my;
    } else {
        const { confdir } = await import('./cmd.js');
        if (confdir) confdir(false);
        rx = u.ux + u.dx; ry = u.uy + u.dy;
        if (!isok(rx, ry)) {
            await update_topl('You miss.');
            return res;
        }
        mtmp = m_at(rx, ry);
    }

    /* fake some proficiency checks */
    let proficient = 0;
    if (I.Role_if(PM_ARCHEOLOGIST)) ++proficient;
    const dex = acurr_eff(A_DEX);
    if (dex < 6) proficient--;
    else if (dex >= 14) proficient += (dex - 14);
    if (Fumbling()) --proficient;
    if (proficient > 3) proficient = 3;
    if (proficient < 0) proficient = 0;

    const rtyp = typ_at(rx, ry);
    const Levitation = !!(u?.uprops?.Levitation);
    const Flying = !!(u?.uprops?.Flying);
    const Underwater = !!u.uinwater;

    if (u.uswallow) {
        await update_topl('There is not enough room to flick your bullwhip.');

    } else if (Underwater) {
        await update_topl('There is too much resistance to flick your bullwhip.');

    } else if (u.dz < 0) {
        await update_topl(`You flick a bug off of the ${ceiling(u.ux, u.uy)}.`);

    } else if (!u.dz && (IS_WATERWALL(rtyp) || rtyp === LAVAWALL)) {
        await update_topl('You cause a small splash.');
        return ECMD_TIME;

    } else if ((!u.dx && !u.dy) || (u.dz > 0)) {
        /* Sometimes you hit your steed by mistake */
        if (u.usteed && !rn2(proficient + 2)) {
            await update_topl(`You whip ${U.mon_nam(u.usteed)}!`);
            return ECMD_TIME;
        }
        if (is_pool_or_lava_at(u.ux, u.uy) || IS_WATERWALL(rtyp)
            || rtyp === LAVAWALL) {
            await update_topl('You cause a small splash.');
            return ECMD_TIME;
        }
        if (Levitation || u.usteed || Flying) {
            /* have a shot at snaring something on the floor */
            const otmp = top_floor_obj(u.ux, u.uy);
            if (otmp && otmp.otyp === CORPSE && corpse_is_horse(otmp)) {
                await update_topl('Why beat a dead horse?');
                return ECMD_TIME;
            }
            if (otmp && proficient) {
                await update_topl(`You wrap your bullwhip around ${
                    an(I.singular_name(otmp))} on the ${surface(u.ux, u.uy)}.`);
                if (rnl(6) || (await pickup_one_object(otmp)) < 1)
                    await update_topl(msg_slipsfree);
                return ECMD_TIME;
            }
        }
        let dam = rnd(2) + I.dbon() + (obj.spe | 0);
        if (dam <= 0) dam = 1;
        await update_topl(`You hit your ${I.body_part(FOOT)} with your bullwhip.`);
        I.losehp_throw(dam);
        return ECMD_TIME;

    } else if ((Fumbling() || Glib()) && !rn2(5)) {
        await update_topl(`The bullwhip slips out of your ${I.body_part(HAND)}.`);
        I.dropx(obj);

    } else if (u.utrap && u.utraptype === TT_PIT) {
        /* trying to whip your way out of a pit */
        let wrapped_what = I.sobj_at(BOULDER, rx, ry) ? 'a boulder'
            : IS_FURNITURE(rtyp) ? 'something' : null;
        let whipattack_it = false;

        if (mtmp) {
            if (bigmonst(mtmp.data) && U.canspotmon(mtmp))
                wrapped_what = U.mon_nam(mtmp);
            if (!wrapped_what) whipattack_it = true;
        }
        if (whipattack_it)
            return await whipattack(mtmp, rx, ry, proficient, msg_slipsfree, msg_snap);
        if (wrapped_what) {
            await update_topl(`You wrap your bullwhip around ${wrapped_what}.`);
            if (proficient && rn2(proficient + 2)) {
                await update_topl('You yank yourself out of the pit!');
                await reset_utrap(true);
            } else {
                await update_topl(msg_slipsfree);
            }
            if (mtmp) await U.wakeupAttack(mtmp, true);
        } else {
            await update_topl(msg_snap);
        }

    } else if (mtmp) {
        return await whipattack(mtmp, rx, ry, proficient, msg_slipsfree, msg_snap);

    } else {
        await update_topl(msg_snap);
    }
    return ECMD_TIME;
}

// C ref: apply.c use_whip() `whipattack:` — reveal a hidden target, else try to
// disarm it, else attack it.
async function whipattack(mtmp, rx, ry, proficient, msg_slipsfree, msg_snap) {
    const U = await import('./uhitm.js');
    let otmp = null;

    if (!U.canspotmon(mtmp)) {
        mtmp.mundetected = 0; /* bring a non-mimic hider out of hiding */
        const spotitnow = U.canspotmon(mtmp);
        await update_topl(`${!spotitnow ? 'A monster' : U.Monnam(mtmp)} is there that you ${
            !Blind() ? "couldn't see" : "hadn't noticed"}.`);
        if (spotitnow) newsym(rx, ry);
    } else {
        /* known target: try to disarm rather than attack */
        otmp = mtmp.mw || null;
    }

    if (otmp) {
        const gotit = proficient && (!Fumbling() || !rn2(10));
        await update_topl(`You wrap your bullwhip around ${I.yname(otmp)}.`);
        if (gotit) {
            I.obj_extract_self(otmp);
            mtmp.mw = null;
            mtmp.weapon_check = 1 /* NEED_WEAPON */;
            switch (rn2(proficient + 1)) {
            case 2: /* to floor near you */
                await update_topl(`You yank ${I.yname(otmp)} to the ${
                    surface(game.u.ux, game.u.uy)}!`);
                place_object(otmp, game.u.ux, game.u.uy);
                otmp.where = 3 /* OBJ_FLOOR */;
                I.stackobj(otmp);
                break;
            case 3: /* right into your inventory */
                await update_topl(`You snatch ${I.yname(otmp)}!`);
                await I.hold_another_object(otmp, 'You drop %s!', I.doname_invent(otmp), null);
                break;
            default: /* to floor beneath mon */
                await update_topl(`You yank ${the_str(I.cxname_singular(otmp))} from ${
                    I.s_suffix(U.mon_nam(mtmp))} ${await mon_hand_noun(mtmp, otmp)}!`);
                place_object(otmp, mtmp.mx, mtmp.my);
                otmp.where = 3 /* OBJ_FLOOR */;
                I.stackobj(otmp);
                break;
            }
        } else {
            await update_topl(msg_slipsfree);
        }
    } else { /* mtmp isn't wielding a weapon; attack it */
        await update_topl(`You flick your bullwhip towards ${U.mon_nam(mtmp)}.`);
        if (proficient && (await force_attack(mtmp))) return ECMD_TIME;
        await update_topl(msg_snap);
    }
    /* regardless of mtmp's weapon or hero's proficiency */
    await U.wakeupAttack(mtmp, true);
    return ECMD_TIME;
}

// ── boomhit (C ref: zap.c:4146) ──────────────────────────────────────────────
//
// A thrown boomerang follows a curving 10-step path rather than a straight
// line, so throwit() must NOT run it through bhit().  Treating a boomerang as
// an ordinary missile walked a straight line, hit the wrong squares and never
// rolled the rn2(20)-vs-DEX catch at the end of the curve.
//
// Returns { caught: true } when the hero caught it, { mon } when a monster is
// to be hit by the caller, or { gone: true } when the boomerang was used up.
//
// C ref: decl.c xdir[]/ydir[] — direction 0 is W, then counterclockwise... no:
// the table runs W, NW, N, NE, E, SE, S, SW.
const XDIR = [-1, -1, 0, 1, 1, 1, 0, -1];
const YDIR = [0, -1, -1, -1, 0, 1, 1, 1];
const N_DIRS = 8;
function xytodir(x, y) {
    for (let dd = 0; dd < N_DIRS; dd++)
        if (x === XDIR[dd] && y === YDIR[dd]) return dd;
    return -1; /* DIR_ERR */
}
export async function boomhit(obj, dx, dy, skillsnap) {
    const u = game.u;
    // C ref: you.h URIGHTY — a right-handed hero's boomerang curves
    // counterclockwise.  u_init.c sets uhandedness with rn2(10) at chargen.
    const counterclockwise = (u.uhandedness | 0) === 0 /* RIGHT_HANDED */;
    let nhits = Math.max(1, (obj.spe | 0) + 1);
    let bx = u.ux, by = u.uy;
    let i = xytodir(dx, dy);
    if (i < 0) return { mon: null };

    for (let ct = 0; ct < 10; ct++) {
        i = ((i % N_DIRS) + N_DIRS) % N_DIRS;
        dx = XDIR[i]; dy = YDIR[i];
        bx += dx; by += dy;
        if (!isok(bx, by)) { bx -= dx; by -= dy; break; }
        const mtmp = m_at(bx, by);
        if (mtmp) {
            // C ref: zap.c:4187 m_respond(mtmp) — a shrieker's shriek (and an
            // erinys' aggravate) fires here; js/monmove.js keeps m_respond
            // module-private so it cannot be called from outside that file.
            if (nhits-- < 0) return { mon: mtmp };
            if (await I.thitmonst(mtmp, obj, skillsnap)) return { gone: true };
            break;
        }
        if (!zap_pos(typ_at(bx, by)) || closed_door(bx, by)) {
            bx -= dx; by -= dy; break;
        }
        if (bx === u.ux && by === u.uy) { /* ct == 9 */
            if (Fumbling() || rn2(20) >= acurr_eff(A_DEX)) {
                const U = await import('./uhitm.js');
                const dam = U.dmgval(obj, { data: I.youmonst_data_pub() });
                await thitu(10 + (obj.spe | 0), dam, obj, 'boomerang');
                await endmultishot(true);
                break;
            }
            /* we catch it */
            await update_topl('You skillfully catch the boomerang.');
            return { caught: true };
        }
        if (IS_SINK(typ_at(bx, by))) {
            await update_topl('Klonk!');
            break; /* boomerang falls on sink */
        }
        /* ct==0 initial position and ct==5 opposite position repeat the delta */
        if (ct % 5 !== 0) i = counterclockwise ? (i + 7) : (i + 1);
    }
    return { mon: null, x: bx, y: by };
}

// C ref: mthrowu.c thitu(tlev, dam, objp, name) — a missile hits (or misses)
// the hero.  The rnd(20) fires whether or not it connects.
export async function thitu(tlev, dam, obj, name) {
    const u = game.u;
    const dieroll = rnd(20);
    const onm = an(name);
    if ((u.uac | 0) + tlev <= dieroll) {
        if (Blind() || game.flags?.verbose === false) {
            await update_topl('It misses.');
        } else if ((u.uac | 0) + tlev <= dieroll - 2) {
            const s = onm.charAt(0).toUpperCase() + onm.slice(1);
            await update_topl(`${s} misses you.`);
        } else {
            await update_topl(`You are almost hit by ${onm}.`);
        }
        return 0;
    }
    const excl = dam < 0 ? '?' : (dam <= 4 ? '.' : '!');
    if (Blind() || game.flags?.verbose === false)
        await update_topl(`You are hit${excl}`);
    else
        await update_topl(`You are hit by ${onm}${excl}`);
    I.losehp_throw(dam);
    const { exercise } = await import('./attrib.js');
    exercise(0 /* A_STR */, false);
    return 1;
}

// C ref: uhitm.c force_attack(mtmp, pacifist) — do_attack() with forcefight set.
async function force_attack(mtmp) {
    const U = await import('./uhitm.js');
    const ctx = game.context || (game.context = {});
    const save = ctx.forcefight;
    ctx.forcefight = true;
    try {
        return await U.do_attack(mtmp);
    } finally {
        ctx.forcefight = save;
    }
}

// ════════════════════════════════════════════════════════════════════════════
// dothrow.c hurtle / mhurtle family + throwit()'s four static helpers.
//
// INERT: nothing in js/ calls anything below.  js/apply.js:1694 keeps an empty
// ap_hurtle(), js/wizcmds.js:1584-1586 keep nyi_mhurtle()/nyi_hurtle(), and
// js/uhitm.js:3407 comments out the mhurtle() call — wiring any of those up to
// these is a separate, scored change.
//
// Cross-module callees are reached with `await import()` (the pattern this file
// already uses at :1085/:1092) instead of new static import edges: a new
// top-level edge into this file's import cycle can flip ESM evaluation order
// and break the whole program load.
// ════════════════════════════════════════════════════════════════════════════

// C ref: monflag.h:181 MZ_HUGE.
const MZ_HUGE = 4;
// C ref: prop.h I_SPECIAL — hurtle_jump() overloads it on EWwalking to mean
// "this step is a jump".
const I_SPECIAL_PROP = 0x20000000;
// C ref: rm.h IRONBARS / DOOR / TREE / POOL and D_ISOPEN.
const IRONBARS_TYP = 21, DOOR_TYP = 23, TREE_TYP = 20, POOL_TYP = 16;
const D_ISOPEN_MASK = 0x02;
// C ref: hack.h u.utraptype values TT_WEB / TT_LAVA / TT_INFLOOR / TT_BURIEDBALL.
const TT_WEB_TYPE = 3, TT_LAVA_TYPE = 4, TT_INFLOOR_TYPE = 5,
      TT_BURIEDBALL_TYPE = 6;
// C ref: trap.h:57 enum trap_types — the values hurtle_step()'s trap switch
// tests.  js/const.js:2271-2284 already exports these under their C names.
const PIT_TRAP = PIT, SPIKED_PIT_TRAP = SPIKED_PIT, HOLE_TRAP = HOLE,
      TRAPDOOR_TRAP = TRAPDOOR, MAGIC_PORTAL_TRAP = MAGIC_PORTAL,
      FIRE_TRAP_TRAP = FIRE_TRAP, VIBRATING_SQUARE_TRAP = VIBRATING_SQUARE;
// C ref: trap.h enum trap_results (trap.h:98-102) — mintrap()'s return codes.
const Trap_Effect_Finished = 0, Trap_Caught_Mon = 1, Trap_Killed_Mon = 2,
      Trap_Moved_Mon = 3;
// C ref: trap.h mintrap flags: NO_TRAP_FLAGS 0, FORCEBUNGLE 1, HURTLING 4.
const NO_TRAP_FLAGS_ = 0, FORCEBUNGLE_FLAG = 1, HURTLING_FLAG = 4;
// C ref: prop.h W_ARM / W_ARMC / W_ARMU, as js/invent.js remaps them
// ([[worn-mask-remap-collision]] — do NOT "correct" these to prop.h's values).
const W_ARM_MASK = 0x00000001, W_ARMC_MASK = 0x00000002,
      W_ARMU_MASK = 0x00000020;
// C ref: display.h DISP_FLASH / DISP_END (tmp_at modes).
const DISP_FLASH_MODE = -4, DISP_END_MODE = -1;
// C ref: do_name.h ARTICLE_A / ARTICLE_YOUR and the x_monnam() suppress bits.
const ARTICLE_A_ = 2, ARTICLE_YOUR_ = 4;
const SUPPRESS_SADDLE_ = 0x02, AUGMENT_IT_ = 0x20,
      EXACT_NAME_ = 0x0F, SUPPRESS_NAME_ = 0x08;
// C ref: hack.h KILLED_BY.
const KILLED_BY_ = 1;
// C ref: mkobj.h MM_IGNOREWATER / MM_IGNORELAVA (goodpos gpflags).
const MM_IGNOREWATER_ = 0x00002000, MM_IGNORELAVA_ = 0x00004000;
// C ref: hack.h WT_TOOMUCH_DIAGONAL.
const WT_TOOMUCH_DIAGONAL_ = 600;

// C ref: youprop.h Levitation / Flying / Wwalking / Passes_walls.  The port
// keeps intrinsics/extrinsics as named uprops fields (js/dbridge.js:948
// HProp()); it has NO B<prop> blocked-masks, so the "Levitation overrides
// Flying" arm of C's macros cannot be expressed — see float_vs_flight() in
// js/polyself.js for the same gap on the writing side.
function uprop_any(...keys) {
    const u = game.u;
    for (const k of keys) {
        const v = u?.uprops?.[k] ?? u?.[k];
        if (v) return typeof v === 'number' ? v : 1;
    }
    return 0;
}
const Levitation_hurtle = () => uprop_any('Levitation', 'HLevitation', 'ELevitation') > 0;
const Flying_hurtle = () => uprop_any('Flying', 'HFlying', 'EFlying') > 0;
const Wwalking_hurtle = () => uprop_any('Wwalking', 'HWwalking', 'EWwalking') > 0;
const Passes_walls_hurtle = () => uprop_any('Passes_walls', 'HPasses_walls', 'EPasses_walls') > 0;
// C ref: youprop.h Punished — the hero is chained to the heavy iron ball.
const uball_of = () => (game.u?.uball ?? game.uball ?? null);
const Punished_hurtle = () => !!uball_of();
// C ref: youprop.h Sokoban.
const Sokoban_hurtle = () => game.u?.uz?.dnum === game.sokoban_dnum;

// C ref: hack.c:939 may_passwall(x, y).  js/monmove.js:289 holds the faithful
// copy but does not export it; the fix is to export that one.  rm.h:
// IS_STWALL(typ) == (typ <= SDOOR), W_NONPASSWALL == 0x08.
function may_passwall_hurtle(x, y) {
    const loc = game.level?.at?.(x, y);
    if (!loc) return false;
    return !((loc.typ | 0) <= 12 /* SDOOR */ && ((loc.wall_info | 0) & 0x08));
}

// C ref: hack.c:937 bad_rock(mdat, x, y).  js/hack.js:621 holds a hero-only
// copy (unexported); this one keeps C's mdat parameter, which mhurtle's callers
// need.  tunnels(mdat) && may_dig() only relaxes it for a rock-eater.
function bad_rock_hurtle(mdat, x, y) {
    const typ = typ_at(x, y);
    if (Sokoban_hurtle() && I.sobj_at(BOULDER, x, y)) return true;
    /* rm.h IS_OBSTRUCTED(typ) == (typ < POOL); phasing is M1_WALLWALK */
    return typ < POOL_TYP && (mflags1_of(mdat) & M1_WALLWALK) === 0;
}

// C ref: mondata.h touch_petrifies(ptr).  js/invent.js:409 takes a corpsenm;
// this one takes a permonst row, as C does.
function touch_petrifies_ptr(ptr) {
    const nm = ptr?.name;
    return nm === 'cockatrice' || nm === 'chickatrice';
}

// C ref: worn.c which_armor(mon, slotmask) — js/worn.js exports it, but this
// file avoids new static edges, so the minvent scan is inlined.
function which_armor_mask(mon, slotmask) {
    for (const o of mon?.minvent || [])
        if (o && ((o.owornmask | 0) & slotmask)) return o;
    return null;
}

// C ref: dothrow.c:655 walk_path(src_cc, dest_cc, check_proc, arg) — Bresenham
// from src to dest, calling check_proc(arg, x, y) on each step and stopping at
// the first FALSE; on failure dest_cc is rewound to the last good square.
// js/hack.js:1604 holds a REDUCED synchronous copy (no `arg`, no dest_cc
// writeback) used only by the jump validity test; this is the full one.
export async function walk_path(src_cc, dest_cc, check_proc, arg) {
    let dx = dest_cc.x - src_cc.x, dy = dest_cc.y - src_cc.y;
    let x = src_cc.x, y = src_cc.y;
    let prev_x = x, prev_y = y;
    let x_change, y_change, keep_going = true;

    if (dx < 0) { x_change = -1; dx = -dx; } else { x_change = 1; }
    if (dy < 0) { y_change = -1; dy = -dy; } else { y_change = 1; }
    let i = 0, err = 0;
    if (dx < dy) {
        while (i++ < dy) {
            prev_x = x; prev_y = y;
            y += y_change;
            err += dx << 1;
            if (err > dy) { x += x_change; err -= dy << 1; }
            /* check for early exit condition */
            if (!(keep_going = await check_proc(arg, x, y))) break;
        }
    } else {
        while (i++ < dx) {
            prev_x = x; prev_y = y;
            x += x_change;
            err += dy << 1;
            if (err > dx) { y += y_change; err -= dx << 1; }
            if (!(keep_going = await check_proc(arg, x, y))) break;
        }
    }

    if (keep_going) return true; /* successful */

    dest_cc.x = prev_x;
    dest_cc.y = prev_y;
    return false;
}

// C ref: dothrow.c:742 hurtle_jump(arg, x, y) — C's own comment calls this a
// "hack for hurtle_step()": EWwalking|I_SPECIAL marks the step as a JUMP, which
// makes hurtle_step() land ON the destination instead of flying over it (and
// keeps a jump over water from dropping the hero into that water).
export async function hurtle_jump(arg, x, y) {
    const props = (game.u.uprops = game.u.uprops || {});
    const save_EWwalking = props.EWwalking | 0;

    /* prevent jumping over water from being placed in that water */
    props.EWwalking = save_EWwalking | I_SPECIAL_PROP;
    const res = await hurtle_step(arg, x, y);
    props.EWwalking = save_EWwalking;
    return res;
}

// C ref: dothrow.c:773 hurtle_step(arg, x, y) — a single step of the hero
// flying through the air (throw/kick recoil, jump).  C's `arg` is `int *range`;
// here it is a one-field box `{ range }` so the decrement is visible to the
// walk_path() caller.
//
// RNG: exactly one rnd(2 + *range) (dothrow.c:835), on the "bumped into
// something" arm only.
export async function hurtle_step(arg, x, y) {
    const u = game.u;
    const { in_out_region } = await import('./region.js');

    if (!isok(x, y)) {
        await update_topl('You feel the spirits holding you back.');
        return false;
    } else if (!in_out_region(x, y)) {
        return false;
    } else if (arg.range === 0) {
        return false; /* previous step wants to stop now */
    }
    const via_jumping = ((u.uprops?.EWwalking | 0) & I_SPECIAL_PROP) !== 0;
    const stopping_short = (via_jumping && arg.range < 2);
    const lev = game.level?.at?.(x, y);
    const ltyp = lev ? (lev.typ | 0) : 0;
    const ydat = I.youmonst_data_pub();

    let may_pass = true;
    if (!Passes_walls_hurtle() || !(may_pass = may_passwall_hurtle(x, y))) {
        let why = null;
        const diagonal = (u.ux - x) !== 0 && (u.uy - y) !== 0;
        const open_door = ltyp === DOOR_TYP
            && ((lev?.doormask | 0) & D_ISOPEN_MASK) !== 0;
        const odoor_diag = open_door && diagonal;
        const obstructed = ltyp < POOL_TYP;   /* rm.h IS_OBSTRUCTED */
        let obj;

        if (obstructed || closed_door(x, y) || odoor_diag) {
            why = ltyp === TREE_TYP ? 'bumping into a tree'
                : obstructed ? 'bumping into a wall'
                : odoor_diag ? 'bumping into a door frame'
                : 'bumping into a closed door';
            if (odoor_diag) await update_topl('You hit the door frame!');
            await update_topl('Ouch!');
        } else if (ltyp === IRONBARS_TYP) {
            why = 'crashing into iron bars';
            await update_topl('You crash into some iron bars.  Ouch!');
        } else if ((obj = I.sobj_at(BOULDER, x, y)) != null) {
            why = 'bumping into a boulder';
            await update_topl(`You bump into a ${I.xname(obj)}.  Ouch!`);
        } else if (!may_pass) {
            /* did we hit a no-dig non-wall position? */
            why = 'touching the edge of the universe';
            await update_topl('You smack into something!');
        } else if (diagonal
                   && bad_rock_hurtle(ydat, u.ux, y)
                   && bad_rock_hurtle(ydat, x, u.uy)) {
            const too_much = (I.inventoryArray().length > 0
                && (I.inv_weight() + I.weight_cap() > WT_TOOMUCH_DIAGONAL_));

            if (bigmonst(ydat) || too_much) {
                why = 'wedging into a narrow crevice';
                await update_topl(`You ${too_much ? 'and all your belongings '
                    : ''}get forcefully wedged into a crevice.`);
            }
        }
        if (why) {
            const dmg = rnd(2 + arg.range);                 /* dothrow.c:835 */
            I.losehp_throw(Maybe_Half_Phys_hurtle(dmg), why, KILLED_BY_);
            wake_nearto_hurtle(x, y, 10);
            return false;
        }
    }

    const mon = m_at(x, y);
    if (mon) {
        /* C's two extra exceptions (hides_under, S_EEL) sit inside `#if 0` and
           are not compiled: any monster here stops the flight. */
        const glyph = glyph_at(x, y);
        const U = await import('./uhitm.js');

        mon.mundetected = 0; /* wakeup() will handle mimic */
        /* after unhiding; combination of a_monnam() and some_mon_nam() —
           yields "someone"/"something" instead of "it" for an unseen mon */
        const mnam = U.x_monnam(mon, ARTICLE_A_, null,
            ((mon.mgivenname || mon.mextra?.mgivenname) ? SUPPRESS_SADDLE_ : 0)
            | AUGMENT_IT_, false);
        if (!glyph_is_monster_hurtle(glyph) && !U.glyph_is_invisible(x, y))
            await update_topl(`You find ${mnam} by bumping into ${
                noit_mhim_hurtle(mon)}.`);
        else
            await update_topl(`You bump into ${mnam}.`);
        await wakeup_hurtle(mon, false);
        if (!U.canspotmon(mon)) map_invisible(mon.mx, mon.my);
        await U.setmangry(mon, false);
        if (touch_petrifies_ptr(mon.data)
            /* this is a bodily collision, so check for body armor */
            && !game.uarmu && !game.uarm && !game.uarmc) {
            game._killer_name = `bumping into ${an(mon.data?.name || 'it')}`;
            await instapetrify_hurtle(game._killer_name);
        }
        if (touch_petrifies_ptr(ydat)
            && !which_armor_mask(mon, W_ARMU_MASK | W_ARM_MASK | W_ARMC_MASK))
            await minstapetrify_hurtle(mon, true);
        wake_nearto_hurtle(x, y, 10);
        return false;
    }

    if ((u.ux - x) && (u.uy - y)
        && bad_rock_hurtle(ydat, u.ux, y)
        && bad_rock_hurtle(ydat, x, u.uy)) {
        /* Move at a diagonal. */
        if (Sokoban_hurtle()) {
            await update_topl('You come to an abrupt halt!');
            return false;
        }
    }

    /* caller has already determined that dragging the ball is allowed; if the
       ball is carried we might still need to drag the chain */
    if (Punished_hurtle()) {
        const B = await import('./ball.js');
        const bc = await B.drag_ball(x, y, true);
        if (bc)
            B.move_bc(0, bc.bc_control, bc.ballx, bc.bally, bc.chainx, bc.chainy);
    }

    const ox = u.ux, oy = u.uy;
    const { u_on_newpos } = await import('./do.js');
    u_on_newpos(x, y); /* set u.<ux,uy>, u.usteed-><mx,my>; cliparound() */
    newsym(ox, oy);    /* update old position */
    const { vision_recalc } = await import('./vision.js');
    vision_recalc(1);  /* update for new position */
    await flush_screen_hurtle(1);
    /* if terrain type changes, levitation or flying might become blocked or
       unblocked; do this AFTER map+vision has been updated for the new spot */
    if (ltyp !== (game.level?.at?.(ox, oy)?.typ | 0))
        switch_terrain_hurtle();

    /* might be entering a special room (treasure zoo, throne room, &c) with a
       first-time entry message, or leaving a shop with unpaid goods */
    const { check_special_room } = await import('./shkroom.js');
    await check_special_room(false);

    if (is_pool_at(x, y) && !u.uinwater) {
        const { Is_waterlevel } = await import('./const.js');
        if (IS_WATERWALL(typ_at(x, y))
            || !(Levitation_hurtle() || Flying_hurtle() || Wwalking_hurtle())) {
            /* couldn't move while hurtling; allow movement now so that drown()
               gives a chance to crawl out of the pool and survive */
            game.multi = 0;
            await drown_hurtle();
            return false;
        } else if (!Is_waterlevel(u.uz) && !stopping_short) {
            /* Norep(): the port has no repeat suppression here */
            await update_topl(`You move over ${
                an(typ_at(x, y) === MOAT ? 'moat' : 'pool')}.`);
        }
    } else if (is_lava_at(x, y) && !stopping_short) {
        await update_topl('You move over some lava.');
    }

    /* C's FIXME: each trap should really trigger on the recoil if it would
       trigger during normal movement; only the tested ones do. */
    const T = await import('./trap.js');
    const ttmp = T.t_at(x, y);
    if (ttmp) {
        const tt = ttmp.ttyp | 0;
        const is_pit = (tt === PIT_TRAP || tt === SPIKED_PIT_TRAP);
        const is_hole = (tt === HOLE_TRAP || tt === TRAPDOOR_TRAP);
        if (stopping_short) {
            /* see the comment above hurtle_jump() */
        } else if (tt === MAGIC_PORTAL_TRAP) {
            await T.dotrap(ttmp, NO_TRAP_FLAGS_);
            return false;
        } else if (tt === VIBRATING_SQUARE_TRAP) {
            await update_topl('The ground vibrates as you pass it.');
            await T.dotrap(ttmp, NO_TRAP_FLAGS_); /* doesn't print messages */
        } else if (tt === FIRE_TRAP_TRAP) {
            await T.dotrap(ttmp, NO_TRAP_FLAGS_);
        } else if ((is_pit || is_hole) && Sokoban_hurtle()) {
            /* air currents overcome the recoil in Sokoban; when jumping, the
               caller performs the last step and enters the trap */
            if (!via_jumping) await T.dotrap(ttmp, NO_TRAP_FLAGS_);
            arg.range = 0;
            return true;
        } else {
            if (ttmp.tseen)
                await update_topl(`You pass right over ${
                    an(trapname_hurtle(tt))}.`);
        }
    }
    if (--arg.range < 0) /* make sure our range never goes negative */
        arg.range = 0;
    if (arg.range !== 0)
        await nh_delay_output_hurtle();
    return true;
}

// C ref: dothrow.c:977 will_hurtle(mon, x, y) — used by mhurtle_step() for the
// actual hurtling and also by mhitm_knockback() to vary the message when the
// target will/won't change location.  No RNG.
export function will_hurtle(mon, x, y) {
    if (!isok(x, y)) return false;
    /* redundant when called by mhurtle() but needed for mhitm_knockback() */
    if ((mon?.data?.msize ?? 0) >= MZ_HUGE || mon === game.u?.ustuck
        || mon?.mtrapped)
        return false;
    /*
     * C's TODO: treat walls, doors, iron bars, etc. specially rather than just
     * stopping before.
     */
    return goodpos_hurtle(x, y, mon, MM_IGNOREWATER_ | MM_IGNORELAVA_);
}

// C ref: teleport.c goodpos(x, y, mtmp, gpflags) — js/teleport.js:105 exports
// it, but will_hurtle() is synchronous in C and this file resolves cross-module
// callees asynchronously, so mhurtle() primes this handle before walking the
// path.  A caller that reaches will_hurtle() without going through mhurtle()
// gets the reduced answer below (empty, accessible square).
let _goodpos_impl = null;
function goodpos_hurtle(x, y, mtmp, gpflags) {
    if (_goodpos_impl) return _goodpos_impl(x, y, mtmp, gpflags);
    return !m_at(x, y) && !(x === game.u?.ux && y === game.u?.uy)
        && typ_at(x, y) >= POOL_TYP;
}

// C ref: dothrow.c:992 mhurtle_step(arg, x, y) — a single step of a MONSTER
// flying through the air; `arg` is the monster.  Draws no RNG itself (the
// mintrap() it ends on can).
export async function mhurtle_step(arg, x, y) {
    const mon = arg;
    const u = game.u;
    const { m_in_out_region } = await import('./region.js');

    if (!isok(x, y)) return false;

    if (will_hurtle(mon, x, y) && m_in_out_region(mon, x, y)) {
        if (mon !== u.usteed) {
            remove_monster_hurtle(mon.mx, mon.my);
            newsym(mon.mx, mon.my);
            place_monster_hurtle(mon, x, y);
            newsym(mon.mx, mon.my);
        } else {
            /* steed is hurtling, move hero which will also move steed */
            u.ux0 = u.ux; u.uy0 = u.uy;
            const { u_on_newpos } = await import('./do.js');
            u_on_newpos(x, y);
            newsym(u.ux0, u.uy0); /* update old position */
            const { vision_recalc } = await import('./vision.js');
            vision_recalc(0); /* new location => different lines of sight */
        }
        await flush_screen_hurtle(1);
        await nh_delay_output_hurtle();
        const { set_apparxy } = await import('./monmove.js');
        set_apparxy(mon);
        if (IS_WATERWALL(typ_at(x, y)))
            return false;
        const res = await mintrap_hurtle(mon, HURTLING_FLAG);
        if (res === Trap_Killed_Mon
            || res === Trap_Caught_Mon
            || res === Trap_Moved_Mon)
            return false;
        return true;
    }
    const mtmp = m_at(x, y);
    const mon_moving = !!game.context?.mon_moving;
    if (mtmp && mtmp !== mon) {
        const U = await import('./uhitm.js');
        const N = await import('./do_name.js');
        if (U.canspotmon(mon) || U.canspotmon(mtmp))
            await update_topl(`${N.Monnam(mon)} bumps into ${N.a_monnam(mtmp)}.`);
        await wakeup_hurtle(mtmp, !mon_moving);
        /* check whether 'mon' is turned to stone by touching 'mtmp' */
        if (touch_petrifies_ptr(mtmp.data)
            && !which_armor_mask(mon, W_ARMU_MASK | W_ARM_MASK | W_ARMC_MASK)) {
            await minstapetrify_hurtle(mon, !mon_moving);
            newsym(mon.mx, mon.my);
        }
        /* and whether 'mtmp' is turned to stone by being touched by 'mon' */
        if (touch_petrifies_ptr(mon.data)
            && !which_armor_mask(mtmp, W_ARMU_MASK | W_ARM_MASK | W_ARMC_MASK)) {
            await minstapetrify_hurtle(mtmp, !mon_moving);
            newsym(mtmp.mx, mtmp.my);
        }
    } else if (x === u.ux && y === u.uy) {
        /* a monster has caused 'mon' to hurtle against the hero */
        const N = await import('./do_name.js');
        await update_topl(`${N.Some_Monnam(mon)} bumps into you.`);
        const { stop_occupation } = await import('./hack.js');
        await stop_occupation();
        /* check whether 'mon' is turned to stone by touching a poly'd hero */
        if (Upolyd() && touch_petrifies_ptr(I.youmonst_data_pub())
            && !which_armor_mask(mon, W_ARMU_MASK | W_ARM_MASK | W_ARMC_MASK)) {
            /* give the poly'd hero credit/blame despite a monster causing it */
            await minstapetrify_hurtle(mon, true);
            newsym(mon.mx, mon.my);
        }
        /* and whether the hero is turned to stone by being touched by 'mon' */
        if (touch_petrifies_ptr(mon.data)
            && !(game.uarmu || game.uarm || game.uarmc)) {
            const U = await import('./uhitm.js');
            /* combine m_monnam() and noname_monnam(): "{your,a} hurtling
               cockatrice" without any assigned name */
            game._killer_name = `being hit by ${U.x_monnam(mon,
                mon.mtame ? ARTICLE_YOUR_ : ARTICLE_A_, 'hurtling',
                EXACT_NAME_ | SUPPRESS_NAME_, false)}`;
            await instapetrify_hurtle(game._killer_name);
            newsym(u.ux, u.uy);
        }
    }

    return false;
}

// C ref: dothrow.c:1078 hurtle(dx, dy, range, verbose) — the hero moves through
// the air for a few squares as a result of throwing or kicking something.  dx
// and dy are the direction of the HURTLE, not of the original kick or throw.
export async function hurtle(dx, dy, range, verbose) {
    const u = game.u;

    /*
     * The chain is stretched vertically, so you shouldn't be able to move very
     * far diagonally.  Rather than bother with the slack calculation, assume
     * there is no slack, give the player a message and return.
     */
    if (Punished_hurtle() && !I.carried(uball_of())) {
        await update_topl('You feel a tug from the iron ball.');
        nomul_hurtle(0);
        return;
    } else if (u.utrap) {
        const { hliquid } = await import('./do_name.js');
        await update_topl(`You are anchored by the ${
            (u.utraptype === TT_WEB_TYPE) ? 'web'
            : (u.utraptype === TT_LAVA_TYPE) ? hliquid('lava')
            : (u.utraptype === TT_INFLOOR_TYPE) ? surface(u.ux, u.uy)
            : (u.utraptype === TT_BURIEDBALL_TYPE) ? 'buried ball'
            : 'trap'}.`);
        nomul_hurtle(0);
        return;
    }

    /* make sure dx and dy are [-1,0,1] */
    dx = sgn_hurtle(dx);
    dy = sgn_hurtle(dy);

    if (!range || (!dx && !dy) || u.ustuck)
        return; /* paranoia */

    nomul_hurtle(-range);
    game.multi_reason = 'moving through the air';
    game.nomovemsg = ''; /* it just happens */
    if (verbose)
        await update_topl(`You ${(range > 1) ? 'hurtle' : 'float'
            } in the opposite direction.`);
    /* if we're in the midst of shooting multiple projectiles, stop */
    await endmultishot(true);
    const uc = { x: u.ux, y: u.uy };
    /* this setting of cc is only correct if dx and dy are [-1,0,1] only */
    const cc = { x: u.ux + (dx * range), y: u.uy + (dy * range) };
    await walk_path(uc, cc, hurtle_step, { range });
}

// C ref: dothrow.c:1130 mhurtle(mon, dx, dy, range) — move a monster through
// the air for a few squares.  Draws no RNG itself.
export async function mhurtle(mon, dx, dy, range) {
    const u = game.u;

    /* prime the goodpos() handle the synchronous will_hurtle() needs */
    if (!_goodpos_impl) {
        const { goodpos } = await import('./teleport.js');
        _goodpos_impl = goodpos;
    }

    await wakeup_hurtle(mon, !game.context?.mon_moving);
    /* At the very least, debilitate the monster */
    mon.movement = 0;
    mon.mstun = 1;

    /* Is the monster stuck or too heavy to push?  (very large monsters have
     * too much inertia, even floaters and flyers) */
    if ((mon.data?.msize ?? 0) >= MZ_HUGE || mon === u.ustuck || mon.mtrapped) {
        const U = await import('./uhitm.js');
        if (U.canspotmon(mon)) {
            const { Monnam } = await import('./do_name.js');
            await update_topl(`${Monnam(mon)} doesn't budge!`);
        }
        return;
    }

    /* Make sure dx and dy are [-1,0,1] */
    dx = sgn_hurtle(dx);
    dy = sgn_hurtle(dy);
    if (!range || (!dx && !dy))
        return; /* paranoia */
    /* don't let grid bugs be hurtled diagonally */
    if (dx && dy && NODIAG_hurtle(mon.data))
        return;

    /* undetected monster can be moved by your strike */
    if (mon.mundetected) {
        mon.mundetected = 0;
        newsym(mon.mx, mon.my);
    }
    if (mon.m_ap_type) await seemimic_hurtle(mon);

    /* Send the monster along the path */
    const mc = { x: mon.mx, y: mon.my };
    const cc = { x: mon.mx + (dx * range), y: mon.my + (dy * range) };
    await walk_path(mc, cc, mhurtle_step, mon);
    const { DEADMONSTER } = await import('./mon.js');
    if (!DEADMONSTER(mon)) {
        const { t_at } = await import('./trap.js');
        if (t_at(mon.mx, mon.my))
            await mintrap_hurtle(mon, FORCEBUNGLE_FLAG);
        else
            await minliquid_hurtle(mon);
    }
}

// C ref: dothrow.c:1442 sho_obj_return_to_u(obj) — animate a thrown weapon's
// flight BACK to the hero (Mjollnir / aklys; boomerangs use boomhit()).
// Display only: obj_to_glyph()'s rng argument is rn2_on_display_rng, never the
// core RNG.
export async function sho_obj_return_to_u(obj) {
    const u = game.u;
    const bh = game.bhitpos || { x: u.ux, y: u.uy };
    /* might already be our location (bounced off a wall) */
    if ((u.dx || u.dy) && (bh.x !== u.ux || bh.y !== u.uy)) {
        let x = bh.x - u.dx, y = bh.y - u.dy;

        await tmp_at_hurtle(DISP_FLASH_MODE, obj_to_glyph_hurtle(obj));
        while (isok(x, y) && (x !== u.ux || y !== u.uy)) {
            await tmp_at_hurtle(x, y);
            await nh_delay_output_hurtle();
            x -= u.dx;
            y -= u.dy;
        }
        await tmp_at_hurtle(DISP_END_MODE, 0);
    }
}

// C ref: dothrow.c:1460 throwit_return(clear_thrownobj) — drop the returning-
// missile handle.  C's comment on throwit(): "No early returns after this point
// or returning_missile will be left with a stale pointer."
export function throwit_return(clear_thrownobj) {
    const iflags = (game.iflags = game.iflags || {});
    iflags.returning_missile = null;
    if (clear_thrownobj)
        game.thrownobj = null;
}

// C ref: dothrow.c:1468 swallowit(obj) — the swallowed hero throws something:
// the engulfer simply eats it, unless it is the punishment ball.
export async function swallowit(obj) {
    if (obj !== uball_of()) {
        const { mpickobj } = await import('./makemon.js');
        mpickobj(game.u.ustuck, obj); /* clears 'gt.thrownobj' */
        throwit_return(false);
    } else {
        throwit_return(true);
    }
}

// C ref: dothrow.c:1482 throwit_mon_hit(obj, mon) — a thrown object reaches a
// monster.  `mon` may be null.  Returns TRUE if a shopkeeper CAUGHT the object
// (so the caller must not process a landing).  May delete obj, clearing
// gt.thrownobj.
export async function throwit_mon_hit(obj, mon) {
    if (mon) {
        const u = game.u;

        if (mon.isshk && obj.where === 'minvent' && obj.ocarry === mon)
            return true;

        await snuff_candle_hurtle(obj);
        const bh = game.bhitpos || { x: mon.mx, y: mon.my };
        game.notonhead = (bh.x !== mon.mx || bh.y !== mon.my);
        const obj_gone = await I.thitmonst(mon, obj);
        /* Monster may have been tamed; this frees old mon [obsolete] */
        mon = m_at(bh.x, bh.y);

        /* [perhaps this should be moved into thitmonst or hmon] */
        const { inside_shop } = await import('./shk.js');
        const { in_rooms } = await import('./shkroom.js');
        if (mon && mon.isshk
            && (!inside_shop(u.ux, u.uy)
                /* C: !strchr(in_rooms(mon->mx, mon->my, SHOPBASE), *u.ushops) */
                || !Array.from(in_rooms(mon.mx, mon.my, 17 /* SHOPBASE */) || [])
                        .includes(String(u.ushops || '')[0])))
            await hot_pursuit_hurtle(mon);

        if (obj_gone)
            game.thrownobj = null;
    }
    return false;
}

// ── shims for dothrow.c callees whose faithful port exists elsewhere but is
//    module-private.  Each names the original; the fix is to export THAT one,
//    not to grow these.  All are RNG-free.
// C ref: mon.c wakeup(mon, via_attack) — js/zap.js:1826 (unexported).
async function wakeup_hurtle(mon, via_attack) {
    if (!mon) return;
    mon.msleeping = 0;
    if (via_attack) {
        const { setmangry } = await import('./uhitm.js');
        await setmangry(mon, true);
    }
}
// C ref: hack.h Maybe_Half_Phys(dmg) — js/zap.js:226 (unexported).
function Maybe_Half_Phys_hurtle(dmg) {
    return uprop_any('Half_physical_damage') ? Math.floor((dmg + 1) / 2) : dmg;
}
// C ref: monmove.c wake_nearto(x, y, distance) — `distance` is a SQUARED
// distance (dist2), and 0 means "everything on the level".  js/monmove.js:4285
// has the faithful copy (unexported); js/cmd.js exports its own.
function wake_nearto_hurtle(x, y, distance) {
    for (const m of game.level?.monsters || []) {
        if (!m || (m.mhp != null && m.mhp <= 0)) continue;
        const d2 = (m.mx - x) * (m.mx - x) + (m.my - y) * (m.my - y);
        if (distance === 0 || d2 < distance) { m.msleeping = 0; m.meating = 0; }
    }
}
// C ref: trap.c instapetrify(str) — js/invent.js:1396 is an empty stub too.
async function instapetrify_hurtle(_why) { /* NOT PORTED (js/invent.js:1396) */ }
// C ref: mon.c minstapetrify(mon, byplayer) — no port anywhere in js/.
async function minstapetrify_hurtle(_mon, _byplayer) { /* NOT PORTED */ }
// C ref: hack.c switch_terrain() — js/dig.js:870 is an empty stub because the
// port has no B<prop> masks (see js/polyself.js float_vs_flight()).
function switch_terrain_hurtle() { /* NOT PORTED (js/dig.js:870) */ }
// C ref: trap.c drown() — js/trap.js:3381 (unexported).
async function drown_hurtle() { return false; /* NOT PORTED */ }
// C ref: trap.c mintrap(mon, mintrapflags) — no port anywhere in js/, so the
// hurtling monster never triggers the trap it lands on.
async function mintrap_hurtle(_mon, _flags) { return Trap_Effect_Finished; }
// C ref: mon.c minliquid(mon) — js/mon.js:591 (unexported).
async function minliquid_hurtle(_mon) { return false; }
// C ref: mon.c seemimic(mon) — js/apply.js:533 (unexported).
async function seemimic_hurtle(mon) {
    if (mon) { mon.m_ap_type = 0; mon.mappearance = 0; }
}
// C ref: shk.c hot_pursuit(shkp) — js/shkroom.js:273 (unexported).
async function hot_pursuit_hurtle(shkp) { if (shkp) shkp.mpeaceful = 0; }
// C ref: apply.c snuff_candle(otmp) — exported, reached dynamically.
async function snuff_candle_hurtle(obj) {
    const { snuff_candle } = await import('./apply.js');
    return snuff_candle(obj);
}
// C ref: display.c flush_screen(cursor_on_u) — exported, reached dynamically.
async function flush_screen_hurtle(mode) {
    const { flush_screen } = await import('./display.js');
    return flush_screen(mode);
}
// C ref: display.c tmp_at(x, y) — exported, reached dynamically.
async function tmp_at_hurtle(x, y) {
    const { tmp_at } = await import('./display.js');
    return tmp_at(x, y);
}
// C ref: display.c obj_to_glyph(obj, rng) — js/invent.js:1397 also returns 0.
function obj_to_glyph_hurtle(_obj) { return 0; }
// C ref: display.h glyph_is_monster(glyph) — the port's glyph_at() returns a
// char/objectless value, so this cannot be decided from the glyph alone.
function glyph_is_monster_hurtle(_glyph) { return false; }
// C ref: do_name.c noit_mhim(mon) — "him"/"her"/"it", with "it" suppressed for
// a named or seen monster.
function noit_mhim_hurtle(mon) { return mon?.female ? 'her' : 'him'; }
// C ref: hack.c nomul(nval) — js/hack.js exports it; only the multi write
// matters for an inert call site.
function nomul_hurtle(nval) { game.multi = nval; }
// C ref: tty nh_delay_output() — js/hack.js:3734 (unexported).
async function nh_delay_output_hurtle() { await Promise.resolve(); }
// C ref: mon.c remove_monster(x, y) — js/worm.js:206 (unexported).
function remove_monster_hurtle(x, y) {
    for (const m of game.level?.monsters || [])
        if (m && m.mx === x && m.my === y) { m.mx = 0; m.my = 0; }
}
// C ref: mon.c place_monster(mon, x, y) — js/vault.js:207 (unexported).
function place_monster_hurtle(mon, x, y) { if (mon) { mon.mx = x; mon.my = y; } }
// C ref: hacklib.c sgn(n).
function sgn_hurtle(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
// C ref: mondata.h NODIAG(mndx) — grid bugs only.
function NODIAG_hurtle(ptr) { return ptr?.name === 'grid bug'; }
// C ref: trap.c trapname(ttyp, override) — the trap.h order, reduced to the
// names hurtle_step()'s "You pass right over a <trap>." line can produce.
const TRAPNAMES_HURTLE = {
    1: 'arrow trap', 2: 'dart trap', 3: 'falling rock trap', 4: 'squeaky board',
    5: 'bear trap', 6: 'land mine', 7: 'rolling boulder trap',
    8: 'sleeping gas trap', 9: 'rust trap', 10: 'fire trap', 11: 'pit',
    12: 'spiked pit', 13: 'hole', 14: 'trap door', 15: 'teleportation trap',
    16: 'level teleporter', 17: 'magic portal', 18: 'web',
    19: 'statue trap', 20: 'magic trap', 21: 'anti-magic field',
    22: 'polymorph trap', 23: 'vibrating square',
};
function trapname_hurtle(ttyp) { return TRAPNAMES_HURTLE[ttyp] || 'trap'; }
