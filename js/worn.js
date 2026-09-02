// C ref: src/worn.c — the monster half (find_mac, which_armor, m_dowear,
// m_dowear_type, update_mon_extrinsics) plus recalc_telepat_range().  The rest
// of the hero half of worn.c (setworn/setnotworn) lives in invent.js/do_wear.js
// and is not duplicated here.
//
// Everything in this file is RNG-free; it exists because the state it writes
// (owornmask, misc_worn_check, mspeed) is the INPUT to moduli drawn elsewhere:
// find_mac() is a term of every to-hit roll, and which_armor() gates muse.c's
// item choices.
import { game } from './gstate.js';
import { objects } from './mkobj.js';
import {
    mflags1_of, humanoid,
    M1_NOHANDS, M1_MINDLESS, M1_ANIMAL, M1_SLITHY,
} from './monflags_data.js';
import {
    W_ARM, W_ARMC, W_ARMH, W_ARMS, W_ARMG, W_ARMF, W_ARMU, W_AMUL, W_ART,
    W_ARMOR, W_ARTI, W_RINGL, W_RINGR, W_WEP, W_SWAPWEP, W_QUIVER, W_TOOL,
    W_SADDLE, W_BALL, W_CHAIN, I_SPECIAL,
} from './const.js';
// Cycle with makemon.js (which imports m_dowear from here) is safe: both sides
// only touch the other's bindings from inside function bodies.
import { name_to_pmidx, monster_by_pmidx } from './makemon.js';
import { mon_nam, Monnam as Monnam_u } from './do_name.js';

const ARMOR_CLASS = 3, AMULET_CLASS = 5, WEAPON_CLASS = 2, TOOL_CLASS = 6;

const TELEPAT = 30;  // prop.h
const BOLT_LIM = 8;  // hack.h

// C ref: worn.c recalc_telepat_range() — BOLT_LIM*BOLT_LIM per worn TELEPAT
// source, -1 with none.  C caches it in u.unblind_telepat_range from
// setworn()/setnotworn()/set_artifact_intrinsic(); the hero's worn slots have no
// single choke point in this port, so it is derived on demand instead (same
// value — it is a pure function of what is worn).
export function recalc_telepat_range() {
    const u = game.u;
    if (!u) return -1;
    // C ref: worn.c worn[] — every hero worn/wielded slot, in C's order.
    const slots = [game.uarm, game.uarmc, game.uarmh, game.uarms, game.uarmg,
        game.uarmf, game.uarmu, game.uleft, game.uright, game.uwep,
        game.uswapwep, game.uquiver, game.uamul, game.ublindf, u.uball, u.uchain];
    let nobjs = 0;
    for (const o of slots)
        if (o && objects[o.otyp]?.oc_oprop === TELEPAT) nobjs++;
    // C: `if (ETelepat & W_ART) nobjs++` — all SPFX_ESP artifacts count as one.
    if ((u.uprops_extrinsic?.[TELEPAT] || 0) & W_ART) nobjs++;
    u.unblind_telepat_range = nobjs ? (BOLT_LIM * BOLT_LIM) * nobjs : -1;
    return u.unblind_telepat_range;
}

// C ref: youprop.h Unblind_telepat == ETelepat — extrinsic telepathy only, which
// is exactly "a worn/carried TELEPAT source exists".
export function Unblind_telepat() { return recalc_telepat_range() > 0; }

// C ref: objclass.h enum obj_armor_types (oc_armcat, stored in oc_subtyp).
export const ARM_SUIT = 0, ARM_SHIELD = 1, ARM_HELM = 2, ARM_GLOVES = 3,
    ARM_BOOTS = 4, ARM_CLOAK = 5, ARM_SHIRT = 6;

// C ref: include/objects.h — the ARMOR()/HELM()/CLOAK()/SHIELD()/GLOVES()/
// BOOTS()/DRGN_ARMR() macro rows, whose OBJECT() expansion stores
// `a_ac = 10 - <macro ac arg>` and `oc_armcat = <sub>`.
// mkobj.js's OBJECT_DATA carries neither column (its oc_subtyp is 0 for every
// armour otyp, so C's is_helmet()/is_cloak()/... would all answer "suit"), so
// all three are tabulated here over the whole armour range 89..172.  Order is
// [otyp, a_ac, oc_armcat, oc_delay]; the a_ac column agrees with all 15
// hand-derived entries in makemon.js's MERC_A_AC and the delay column with
// invent.js's ARMOR_OC_DELAY.
const ARMOR_TABLE = [
    // helmets (ARM_HELM)
    [89, 1, 2, 1], [90, 1, 2, 1], [91, 2, 2, 1], [92, 0, 2, 0],
    [93, 0, 2, 1], [94, 0, 2, 1], [95, 1, 2, 0], [96, 1, 2, 1],
    [97, 1, 2, 1], [98, 1, 2, 1], [99, 1, 2, 1], [100, 1, 2, 1],
    // dragon scale mail / dragon scales (ARM_SUIT) — DRGN_ARMR ac 1 / ac 7
    [101, 9, 0, 5], [102, 9, 0, 5], [103, 9, 0, 5], [104, 9, 0, 5],
    [105, 9, 0, 5], [106, 9, 0, 5], [107, 9, 0, 5], [108, 9, 0, 5],
    [109, 9, 0, 5], [110, 9, 0, 5],
    [111, 3, 0, 5], [112, 3, 0, 5], [113, 3, 0, 5], [114, 3, 0, 5],
    [115, 3, 0, 5], [116, 3, 0, 5], [117, 3, 0, 5], [118, 3, 0, 5],
    [119, 3, 0, 5], [120, 3, 0, 5],
    // other suits (ARM_SUIT) — note the two mithril-coats take 1 turn, not 5
    [121, 7, 0, 5], [122, 7, 0, 5], [123, 6, 0, 5], [124, 6, 0, 5],
    [125, 6, 0, 5], [126, 6, 0, 1], [127, 5, 0, 1], [128, 5, 0, 5],
    [129, 4, 0, 5], [130, 4, 0, 5], [131, 3, 0, 3], [132, 3, 0, 5],
    [133, 2, 0, 5], [134, 2, 0, 3], [135, 1, 0, 0],
    // shirts (ARM_SHIRT)
    [136, 0, 6, 0], [137, 0, 6, 0],
    // cloaks (ARM_CLOAK)
    [138, 0, 5, 0], [139, 1, 5, 0], [140, 0, 5, 0], [141, 0, 5, 0],
    [142, 1, 5, 0], [143, 2, 5, 0], [144, 1, 5, 0], [145, 1, 5, 0],
    [146, 3, 5, 0], [147, 1, 5, 0], [148, 1, 5, 0], [149, 1, 5, 0],
    // shields (ARM_SHIELD)
    [150, 1, 1, 0], [151, 1, 1, 0], [152, 1, 1, 0], [153, 2, 1, 0],
    [154, 1, 1, 0], [155, 1, 1, 0], [156, 2, 1, 0], [157, 2, 1, 0],
    [158, 2, 1, 0],
    // gloves (ARM_GLOVES)
    [159, 1, 3, 1], [160, 1, 3, 1], [161, 1, 3, 1], [162, 1, 3, 1],
    // boots (ARM_BOOTS)
    [163, 1, 4, 2], [164, 2, 4, 2], [165, 2, 4, 2], [166, 1, 4, 2],
    [167, 1, 4, 2], [168, 1, 4, 2], [169, 1, 4, 2], [170, 1, 4, 2],
    [171, 1, 4, 2], [172, 1, 4, 2],
];
const A_AC = new Map(), ARMCAT = new Map(), ARM_DELAY = new Map();
for (const [otyp, aac, cat, dly] of ARMOR_TABLE) {
    A_AC.set(otyp, aac); ARMCAT.set(otyp, cat); ARM_DELAY.set(otyp, dly);
}

// C ref: objects[otyp].a_ac.  0 for anything that is not armour.
export function a_ac(otyp) { return A_AC.get(otyp) ?? 0; }
// C ref: objects[otyp].oc_armcat.  -1 (no category) for anything not armour.
export function oc_armcat(otyp) { return ARMCAT.has(otyp) ? ARMCAT.get(otyp) : -1; }
// C ref: objects[otyp].oc_delay for ARMOR_CLASS — the donning/doffing turns
// m_dowear_type charges a monster outside creation.
export function armor_delay(otyp) { return ARM_DELAY.get(otyp) ?? 0; }

function is_armor(obj) {
    return !!obj && (obj.oclass ?? objects[obj.otyp]?.oclass) === ARMOR_CLASS;
}
function armcat_is(obj, cat) { return is_armor(obj) && oc_armcat(obj.otyp) === cat; }
// C ref: obj.h is_shield/is_helmet/is_boots/is_gloves/is_cloak/is_shirt/is_suit.
export const is_shield = (o) => armcat_is(o, ARM_SHIELD);
export const is_helmet = (o) => armcat_is(o, ARM_HELM);
export const is_boots = (o) => armcat_is(o, ARM_BOOTS);
export const is_gloves = (o) => armcat_is(o, ARM_GLOVES);
export const is_cloak = (o) => armcat_is(o, ARM_CLOAK);
export const is_shirt = (o) => armcat_is(o, ARM_SHIRT);
export const is_suit = (o) => armcat_is(o, ARM_SUIT);

// C ref: obj.h:126 greatest_erosion(otmp) = max(oeroded, oeroded2).  There is
// deliberately NO oerodeproof term: an erodeproof item simply never accrues
// oeroded, so testing the flag here would be a second, wrong, guard.
function greatest_erosion(o) {
    return Math.max(o?.oeroded || 0, o?.oeroded2 || 0);
}
// C ref: hack.h ARM_BONUS(obj) = a_ac + spe - min(greatest_erosion(obj), a_ac).
export function ARM_BONUS(obj) {
    const aac = a_ac(obj?.otyp);
    return aac + (obj?.spe || 0) - Math.min(greatest_erosion(obj), aac);
}

// C ref: you.h:472 AC_MAX — abs(u.uac) <= 99, "likewise for monster AC".
const AC_MAX = 99;
const AMULET_OF_GUARDING = 210;

// C ref: mon->data.  dog.js builds its pets with a hand-rolled permonst that
// carries a NON-makemon pmidx (kitten: C PM_KITTEN 34 == our jaguar) and none
// of the LVL()/SIZ() columns, so reading .ac or any pmidx-keyed flag off it
// answers for the wrong species — the trap mhitm.js's permonst() documents.
// Re-resolve those, and ONLY those, through the species name: a makemon record
// must be used as-is, because mons[] lists a werecreature's @ form and animal
// form under the SAME name and name_to_pmidx() always returns the animal one
// (measured: resolving unconditionally sends every @-form werecreature down
// m_dowear's is_animal() early-out and costs the whole w3-elf-wiz gain).
const _pm_cache = new Map();
function species(mon) {
    const dat = mon?.data;
    if (!dat) return null;
    if (dat.ac != null) return dat;      /* a full makemon() permonst */
    const nm = dat.name;
    if (!nm) return dat;
    let rec = _pm_cache.get(nm);
    if (rec === undefined) {
        const p = name_to_pmidx(nm);
        rec = (p >= 0) ? monster_by_pmidx(p) : null;
        _pm_cache.set(nm, rec);
    }
    return rec || dat;
}

// C ref: worn.c find_mac(mon) — species base AC improved by every worn item.
// Note the loop tests `obj->owornmask & mwflags`: an object whose slot bit is
// not also set in the monster's misc_worn_check does NOT count.
export function find_mac(mon) {
    let base = species(mon)?.ac;
    if (base == null) base = 10;
    const mwflags = (mon?.misc_worn_check | 0);
    const inv = Array.isArray(mon?.minvent) ? mon.minvent : [];
    for (const obj of inv) {
        if (!((obj.owornmask | 0) & mwflags)) continue;
        if (obj.otyp === AMULET_OF_GUARDING) base -= 2; // fixed, erosion-proof
        else base -= ARM_BONUS(obj);
    }
    if (Math.abs(base) > AC_MAX) base = Math.sign(base) * AC_MAX;
    return base;
}

// C ref: worn.c which_armor(mon, flag) — monster branch only (the hero branch
// reads the uarm* globals and has its own implementation in invent.js).
export function which_armor(mon, flag) {
    const inv = Array.isArray(mon?.minvent) ? mon.minvent : [];
    for (const obj of inv) if ((obj.owornmask | 0) & flag) return obj;
    return null;
}

// C ref: mondata.h verysmall/nohands/is_animal/mindless/slithy + MZ_* sizes.
const MZ_SMALL = 1, MZ_HUMAN = 2, MZ_HUGE = 4;
// C ref: include/defsym.h MONSYM() indices.
const S_GHOST = 54, S_MUMMY = 39, S_CENTAUR = 29, S_VORTEX = 22;
const verysmall = (p) => (p?.msize ?? MZ_HUMAN) < MZ_SMALL;
const nohands = (p) => (mflags1_of(p) & M1_NOHANDS) !== 0;
const is_animal = (p) => (mflags1_of(p) & M1_ANIMAL) !== 0;
const mindless = (p) => (mflags1_of(p) & M1_MINDLESS) !== 0;
const slithy = (p) => (mflags1_of(p) & M1_SLITHY) !== 0;
const noncorporeal = (p) => p?.mcls === S_GHOST;
// C ref: mondata.h bigmonst(ptr) = msize >= MZ_LARGE.
const bigmonst = (p) => (p?.msize ?? MZ_HUMAN) >= 3;
// C ref: mondata.c is_whirly(ptr) = mlet == S_VORTEX || ptr == &mons[PM_AIR_ELEMENTAL].
const is_whirly = (p) => p?.mcls === S_VORTEX || p?.name === 'air elemental';
// C ref: mondata.c sliparm/breakarm; cantweararm = breakarm || sliparm.
function sliparm(p) {
    return is_whirly(p) || (p?.msize ?? MZ_HUMAN) <= MZ_SMALL || noncorporeal(p);
}
function breakarm(p) {
    if (sliparm(p)) return false;
    return bigmonst(p)
        || ((p?.msize ?? MZ_HUMAN) > MZ_SMALL && !humanoid(p))
        || p?.name === 'marilith' || p?.name === 'winged gargoyle';
}
const cantweararm = (p) => breakarm(p) || sliparm(p);
// C ref: obj.h WrappingAllowed(mptr).
function WrappingAllowed(p) {
    const sz = p?.msize ?? MZ_HUMAN;
    return humanoid(p) && sz >= MZ_SMALL && sz <= MZ_HUGE && !noncorporeal(p)
        && p?.mcls !== S_CENTAUR
        && p?.name !== 'winged gargoyle' && p?.name !== 'marilith';
}
// C ref: mondata.c num_horns(ptr) > 0.
const HORNED = new Set(['horned devil', 'minotaur', 'Asmodeus', 'balrog',
    'white unicorn', 'gray unicorn', 'black unicorn', 'ki-rin']);
const has_horns = (p) => HORNED.has(p?.name);
// C ref: obj.h is_flimsy(otmp) = oc_material <= LEATHER || otyp == RUBBER_HOSE.
const LEATHER_MATERIAL = 7, RUBBER_HOSE = 250;
function is_flimsy(o) {
    return (objects[o?.otyp]?.material ?? 99) <= LEATHER_MATERIAL
        || o?.otyp === RUBBER_HOSE;
}
// C ref: obj.h is_elven_armor(otmp).
const ELVEN_ARMOR = new Set([89 /*helm*/, 127 /*mithril-coat*/, 139 /*cloak*/,
    153 /*shield*/, 169 /*boots*/]);
// C ref: obj.h bimanual(otmp) = oc_bimanual, which mkobj.js's table does not
// carry.  Extracted from the `bi` argument of objects.h's WEAPON()/WEPTOOL()
// rows — note the lance is NOT bimanual and the quarterstaff and unicorn horn
// ARE.
const BIMANUAL = new Set([
    45 /*battle-axe*/, 55 /*two-handed sword*/, 57 /*tsurugi*/,
    59 /*partisan*/, 60 /*ranseur*/, 61 /*spetum*/, 62 /*glaive*/,
    63 /*halberd*/, 64 /*bardiche*/, 65 /*voulge*/, 66 /*fauchard*/,
    67 /*guisarme*/, 68 /*bill-guisarme*/, 69 /*lucern hammer*/,
    70 /*bec de corbin*/, 71 /*dwarvish mattock*/, 79 /*quarterstaff*/,
    261 /*unicorn horn*/,
]);
function bimanual(o) {
    const cls = o?.oclass ?? objects[o?.otyp]?.oclass;
    return (cls === WEAPON_CLASS || cls === TOOL_CLASS) && BIMANUAL.has(o?.otyp);
}

const MUMMY_WRAPPING = 138, SPEED_BOOTS = 166, HELM_OF_OPPOSITE_ALIGNMENT = 99,
    DUNCE_CAP = 94, AMULET_OF_LIFE_SAVING = 202, AMULET_OF_REFLECTION = 208;
const MFAST = 2;

// C ref: worn.c w_blocks(o, m) — only the mummy-wrapping/INVIS arm can apply to
// a monster (CORNUTHAUM's CLAIRVOYANT and the artifact lenses' BLINDED are both
// hero-only in effect; the m_dowear caller passes a blanket ~0 mask).
function blocks_invis(obj) { return obj?.otyp === MUMMY_WRAPPING; }

// C ref: worn.c update_mon_extrinsics(mon, obj, on, silently).  This port does
// not model mon->mextrinsics (mondata.js reads species mresists only), so the
// `default:` arm that ORs res_to_mr(which) in is a no-op here; what DOES have an
// effect is the FAST arm (worn speed boots override permspeed) and the
// w_blocks() invisibility arm.
function update_mon_extrinsics(mon, obj, on) {
    // FAST: C calls mon_adjust_speed(mon, 0, obj), which only re-derives mspeed
    // from "is a FAST item worn"; with silently/in_mklev set it prints nothing.
    // SPEED_BOOTS is the only ARMOR_CLASS otyp with oc_oprop == FAST.
    let fastWorn = false;
    for (const o of (mon.minvent || [])) {
        if ((o.owornmask | 0) && o.otyp === SPEED_BOOTS) { fastWorn = true; break; }
    }
    if (fastWorn) mon.mspeed = MFAST;
    else mon.mspeed = mon.permspeed | 0;

    if (blocks_invis(obj)) {
        mon.invis_blkd = on ? 1 : 0;
        mon.minvis = on ? 0 : (mon.perminvis ? 1 : 0);
    }
}

// C ref: worn.c racial_exception(mon, obj) — hobbits may wear elven armor.
function racial_exception(mon, obj) {
    return (mon?.data?.name === 'hobbit' && ELVEN_ARMOR.has(obj?.otyp)) ? 1 : 0;
}

// C ref: worn.c extra_pref(mon, obj) — speed boots only.
function extra_pref(mon, obj) {
    return (obj?.otyp === SPEED_BOOTS && mon?.permspeed !== MFAST) ? 20 : 0;
}
// C ref: worn.c MON_WEP(mon) — the wielded weapon (monmove.js stores it on .mw).
function MON_WEP(mon) { return mon?.mw || null; }

// C ref: youprop.h See_invisible.  Spelled three ways across this port (see
// hack.js mon_visible), so read all of them.
function see_invisible_u() {
    const u = game.u;
    return !!(u?.see_invis || u?.See_invisible || u?.uprops?.See_invisible);
}

// C ref: worn.c m_dowear_type(mon, flag, creation, racialexception).
// The wear MESSAGES and the mfrozen delay are the !creation half; at creation
// C charges no delay at all, which is why the creation-time call in makemon.c
// and the movemon-driven one must always ship together.
function m_dowear_type(mon, flag, creation, racialexception, pending) {
    if (mon.mfrozen) return; /* probably putting previous item on */
    const ptr = species(mon);

    // C ref: worn.c m_dowear_type():532 `Strcpy(nambuf, See_invisible ?
    // Monnam(mon) : mon_nam(mon))` — "get a copy of monster's name before
    // altering its visibility", built UNCONDITIONALLY on every call (all eight
    // wornmask types, creation included) and read only by the closing "Suddenly
    // you cannot see %s" line.  It looks free, but while hallucinating each name
    // is an x_monnam() -> rndmonnam() pick off the DISPLAY rng, so a monster
    // sorting its armour advances that stream seven or eight times per turn
    // (seed0383 step 199).
    const nambuf = see_invisible_u() ? Monnam_u(mon) : mon_nam(mon);

    let old = which_armor(mon, flag);
    if (old && old.cursed) return;
    if (old && flag === W_AMUL && old.otyp !== AMULET_OF_GUARDING) return;
    let best = old;

    outer:
    for (const obj of (mon.minvent || [])) {
        switch (flag) {
        case W_AMUL: {
            const cls = obj.oclass ?? objects[obj.otyp]?.oclass;
            if (cls !== AMULET_CLASS
                || (obj.otyp !== AMULET_OF_LIFE_SAVING
                    && obj.otyp !== AMULET_OF_REFLECTION
                    && obj.otyp !== AMULET_OF_GUARDING))
                continue;
            if (!best || obj.otyp !== AMULET_OF_GUARDING) {
                best = obj;
                if (best.otyp !== AMULET_OF_GUARDING) break outer;
            }
            continue; /* skip post-switch armor handling */
        }
        case W_ARMU:
            if (!is_shirt(obj)) continue;
            break;
        case W_ARMC:
            if (!is_cloak(obj)) continue;
            // mummy wrapping is the only cloak allowed above human size
            if ((ptr?.msize ?? MZ_HUMAN) > MZ_HUMAN
                && obj.otyp !== MUMMY_WRAPPING) continue;
            // an already-invisible monster won't hide itself behind a wrapping
            if (mon.minvis && blocks_invis(obj) && !creation) continue;
            break;
        case W_ARMH:
            if (!is_helmet(obj)) continue;
            if (obj.otyp === HELM_OF_OPPOSITE_ALIGNMENT
                && (mon.ispriest || mon.isminion)) continue;
            if (has_horns(ptr) && !is_flimsy(obj)) continue;
            break;
        case W_ARMS:
            if (!is_shield(obj)) continue;
            break;
        case W_ARMG:
            if (!is_gloves(obj)) continue;
            break;
        case W_ARMF:
            if (!is_boots(obj)) continue;
            break;
        case W_ARM:
            if (!is_suit(obj)) continue;
            if (racialexception && racial_exception(mon, obj) < 1) continue;
            break;
        default:
            break;
        }
        if (obj.owornmask) continue;
        if (best && (ARM_BONUS(best) + extra_pref(mon, best)
                     >= ARM_BONUS(obj) + extra_pref(mon, obj)))
            continue;
        best = obj;
    }
    if (!best || best === old) return;

    // C: same auto-cursing behaviour as for the hero.
    const autocurse = (best.otyp === HELM_OF_OPPOSITE_ALIGNMENT
                       || best.otyp === DUNCE_CAP) && !best.cursed;
    // C ref: worn.c:906-911 — swapping a suit or shirt under a worn cloak costs
    // the time to take the cloak off and put it back on, and upgrading a slot
    // costs the old piece's oc_delay as well.
    let m_delay = 0;
    if ((flag === W_ARM || flag === W_ARMU)
        && ((mon.misc_worn_check | 0) & W_ARMC)) m_delay += 2;
    if (old) {
        m_delay += armor_delay(old.otyp);
        old.owornmask = 0;   /* C clears it so doname() omits "(being worn)" */
    }
    if (!creation) {
        // The "<Mon> [removes X and ]puts on Y." line needs invent.js's
        // doname(), which is async here; queue a descriptor and let the caller
        // flush it through print_m_dowear() before anything else prints.  Both
        // objects' owornmask are 0 at this point, exactly as C arranges.
        if (pending) pending.push({ mon, old, best, autocurse, nambuf });
        m_delay += armor_delay(best.otyp);
        mon.mfrozen = m_delay;
        if (mon.mfrozen) mon.mcanmove = 0;
    }
    if (old) update_mon_extrinsics(mon, old, false);
    mon.misc_worn_check = (mon.misc_worn_check | 0) | flag;
    best.owornmask = (best.owornmask | 0) | flag;
    if (autocurse) { best.cursed = true; best.blessed = false; }
    update_mon_extrinsics(mon, best, true);
}

// C ref: worn.c m_dowear(mon, creation) — wear the best object of each type.
// Consumes no RNG.  Returns the queue of wear messages the caller must flush
// with print_m_dowear(); it is always empty when `creation` is true.
export function m_dowear(mon, creation) {
    const pending = [];
    const ptr = species(mon);
    if (!ptr) return pending;
    if (verysmall(ptr) || nohands(ptr) || is_animal(ptr)) return pending;
    /* give mummies a chance to wear their wrappings, and let skeletons wear
       their initial armor */
    if (mindless(ptr)
        && (!creation || (ptr.mcls !== S_MUMMY && ptr.name !== 'skeleton')))
        return pending;

    m_dowear_type(mon, W_AMUL, creation, false, pending);
    const can_wear_armor = !cantweararm(ptr);
    /* can't put on a shirt if already wearing a suit */
    if (can_wear_armor && !((mon.misc_worn_check | 0) & W_ARM))
        m_dowear_type(mon, W_ARMU, creation, false, pending);
    if (can_wear_armor || WrappingAllowed(ptr))
        m_dowear_type(mon, W_ARMC, creation, false, pending);
    m_dowear_type(mon, W_ARMH, creation, false, pending);
    if (!MON_WEP(mon) || !bimanual(MON_WEP(mon)))
        m_dowear_type(mon, W_ARMS, creation, false, pending);
    m_dowear_type(mon, W_ARMG, creation, false, pending);
    if (!slithy(ptr) && ptr.mcls !== S_CENTAUR)
        m_dowear_type(mon, W_ARMF, creation, false, pending);
    /* RACE_EXCEPTION is TRUE: a monster too small for suits may still wear
       elven armor if racial_exception() allows it */
    m_dowear_type(mon, W_ARM, creation, !can_wear_armor, pending);
    return pending;
}

// C ref: worn.c m_dowear_type()'s `if (!creation) { if (sawmon) { ... } }` block.
// Split out because it needs doname()/pline(), both async in this port, while
// m_dowear() itself must stay synchronous for makemon()'s creation-time call.
// Nothing between the state change and this call draws RNG or moves anything,
// so evaluating canseemon() here matches C's `sawmon` — a !creation m_dowear
// can never change the monster's visibility (the mummy-wrapping arm that could
// is gated on `!creation`).
export async function print_m_dowear(pending) {
    if (!pending || !pending.length) return;
    const { pline, canseemon_shared } = await import('./display.js');
    const { distant_doname, distant_far } = await import('./invent.js');
    const { Monnam } = await import('./uhitm.js');
    // C ref: hacklib.c s_suffix() — "Foo" -> "Foo's", "Kops" -> "Kops'".
    const s_suffix = (s) => (/s$/.test(s) ? `${s}'` : `${s}'s`);
    for (const { mon, old, best, autocurse } of pending) {
        if (!canseemon_shared(mon)) continue;
        let buf = '', oldarm = '';
        // C ref: worn.c:931,936 distant_name(obj, doname) — <ox,oy> resolves to
        // the wearer's spot for a minvent item.
        if (old) {
            oldarm = distant_doname(old, distant_far(old, mon.mx, mon.my));
            buf = ` removes ${oldarm} and`;
        }
        let newarm = distant_doname(best, distant_far(best, mon.mx, mon.my));
        // C: identical descriptions become "another <newarm>" so the line reads
        // "removes a +0 helmet and puts on another helmet."
        if (newarm.toLowerCase() === oldarm.toLowerCase()) {
            if (/^a /i.test(newarm)) newarm = newarm.replace(/^a /i, 'another ');
            else if (/^an /i.test(newarm)) newarm = newarm.replace(/^an /i, 'another ');
        }
        await pline(`${Monnam(mon)}${buf} puts on ${newarm}.`);
        if (autocurse)
            await pline(`${s_suffix(Monnam(mon))} ${objects[best.otyp]?.name} glows black for a moment.`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// worn.c completion — the nine routines coverage.mjs --file=worn.c listed as
// missing.  All of them are RNG-free; the block is inert (nothing above calls
// into it) and does not alter the canonical find_mac() above.  The W_* bits
// below come from js/const.js, the same
// spelling this file already used ([[worn-mask-remap-collision]]).
// ═══════════════════════════════════════════════════════════════════════════

// C ref: worn.c:14 worn[] — every hero worn/wielded slot, in C's exact order,
// with the slot mask and the "for failing sanity check's feedback" name.  C
// stores `struct obj **w_obj` (the address of uarm, uarmc, ...); this port
// keeps those slots as named properties, so each row carries a get/set pair.
// recalc_telepat_range() above walks the same list in the same order.
const worn_table = [
    { w_mask: W_ARM,     key: 'uarm',      on: 'game', w_what: 'suit' },
    { w_mask: W_ARMC,    key: 'uarmc',     on: 'game', w_what: 'cloak' },
    { w_mask: W_ARMH,    key: 'uarmh',     on: 'game', w_what: 'helmet' },
    { w_mask: W_ARMS,    key: 'uarms',     on: 'game', w_what: 'shield' },
    { w_mask: W_ARMG,    key: 'uarmg',     on: 'game', w_what: 'gloves' },
    { w_mask: W_ARMF,    key: 'uarmf',     on: 'game', w_what: 'boots' },
    { w_mask: W_ARMU,    key: 'uarmu',     on: 'game', w_what: 'shirt' },
    { w_mask: W_RINGL,   key: 'uleft',     on: 'game', w_what: 'left ring' },
    { w_mask: W_RINGR,   key: 'uright',    on: 'game', w_what: 'right ring' },
    { w_mask: W_WEP,     key: 'uwep',      on: 'game', w_what: 'weapon' },
    { w_mask: W_SWAPWEP, key: 'uswapwep',  on: 'game', w_what: 'alternate weapon' },
    { w_mask: W_QUIVER,  key: 'uquiver',   on: 'game', w_what: 'quiver' },
    { w_mask: W_AMUL,    key: 'uamul',     on: 'game', w_what: 'amulet' },
    /* blindfold|towel|lenses */
    { w_mask: W_TOOL,    key: 'ublindf',   on: 'game', w_what: 'facewear' },
    { w_mask: W_BALL,    key: 'uball',     on: 'u',    w_what: 'chained ball' },
    { w_mask: W_CHAIN,   key: 'uchain',    on: 'u',    w_what: 'attached chain' },
];
function worn_slot_owner(row) { return row.on === 'u' ? game.u : game; }
function worn_slot_read(row) { return worn_slot_owner(row)?.[row.key] ?? null; }
function worn_slot_write(row, val) {
    const owner = worn_slot_owner(row);
    if (owner) owner[row.key] = val;
}

// ─── worn.c:188 allunworn() ────────────────────────────────────────────────
// Called when saving with FREEING set has just discarded inventory: remove the
// stale slot pointers.  The objects are already gone, so their owornmask is
// deliberately NOT updated.  js/save.js:534-536 records this as UNPORTED at
// the one call site; that call site is left alone.
export function allunworn() {
    const u = game.u;
    if (u) u.twoweap = 0;   /* uwep and uswapwep are going away */
    /* note: uball and uchain might not be freed yet but we clear them here
       anyway (savegamestate() and its callers deal with them) */
    for (const wp of worn_table)
        worn_slot_write(wp, null);   /* C: *(wp->w_obj) = (struct obj *) 0 */
}

// ─── worn.c:206 wearmask_to_obj(wornmask) ──────────────────────────────────
// The item worn in the slot indicated by wornmask; needed by poly_obj().
// First match in worn[] order wins, so a mask naming two slots (W_RING) yields
// the left ring.
export function wearmask_to_obj(wornmask) {
    for (const wp of worn_table)
        if (wp.w_mask & wornmask)
            return worn_slot_read(wp);
    return null;
}

// ─── worn.c:218 wornmask_to_armcat(mask) ───────────────────────────────────
// Convert an armor wornmask to its oc_armcat.  Note C's `switch (mask &
// W_ARMOR)`: a mask naming two armour slots matches no case and yields 0,
// which is ARM_SUIT's value — that ambiguity is C's, not a port artifact.
export function wornmask_to_armcat(mask) {
    let cat = 0;
    switch (mask & W_ARMOR) {
    case W_ARM:  cat = ARM_SUIT;   break;
    case W_ARMC: cat = ARM_CLOAK;  break;
    case W_ARMH: cat = ARM_HELM;   break;
    case W_ARMS: cat = ARM_SHIELD; break;
    case W_ARMG: cat = ARM_GLOVES; break;
    case W_ARMF: cat = ARM_BOOTS;  break;
    case W_ARMU: cat = ARM_SHIRT;  break;
    default: break;
    }
    return cat;
}

// ─── worn.c:250 armcat_to_wornmask(cat) ────────────────────────────────────
// The inverse; 0 for anything that is not an armour category.
export function armcat_to_wornmask(cat) {
    let mask = 0;
    switch (cat) {
    case ARM_SUIT:   mask = W_ARM;  break;
    case ARM_CLOAK:  mask = W_ARMC; break;
    case ARM_HELM:   mask = W_ARMH; break;
    case ARM_SHIELD: mask = W_ARMS; break;
    case ARM_GLOVES: mask = W_ARMG; break;
    case ARM_BOOTS:  mask = W_ARMF; break;
    case ARM_SHIRT:  mask = W_ARMU; break;
    default: break;
    }
    return mask;
}

// C ref: mkobj.js OBJECT_DATA indices for the tools/food wearslot() names.
const BLINDFOLD = 233, TOWEL = 234, SADDLE_OTYP = 235, LENSES = 232,
    TIN_OPENER = 239, MEAT_RING = 270;
// C ref: objclass.h oclass values (RING_CLASS/FOOD_CLASS/GEM_CLASS/BALL_CLASS/
// CHAIN_CLASS are not among this file's existing four).
const RING_CLASS = 4, FOOD_CLASS = 7, GEM_CLASS = 13, BALL_CLASS = 14,
    CHAIN_CLASS = 15;

// ─── worn.c:282 wearslot(obj) ──────────────────────────────────────────────
// A bitmask of the equipment slot(s) a given item might be worn in.
// "practically any item can be wielded or quivered; it's up to our caller to
// handle such things--we assume 'normal' usage".
export function wearslot(obj) {
    const otyp = obj?.otyp;
    let res = 0;   /* default: can't be worn anywhere */

    switch (obj?.oclass ?? objects[otyp]?.oclass) {
    case AMULET_CLASS:
        res = W_AMUL;                    /* WORN_AMUL */
        break;
    case RING_CLASS:
        res = W_RINGL | W_RINGR;         /* W_RING, BOTH_SIDES */
        break;
    case ARMOR_CLASS:
        switch (oc_armcat(otyp)) {
        case ARM_SUIT:   res = W_ARM;  break;  /* WORN_ARMOR */
        case ARM_SHIELD: res = W_ARMS; break;  /* WORN_SHIELD */
        case ARM_HELM:   res = W_ARMH; break;  /* WORN_HELMET */
        case ARM_GLOVES: res = W_ARMG; break;  /* WORN_GLOVES */
        case ARM_BOOTS:  res = W_ARMF; break;  /* WORN_BOOTS */
        case ARM_CLOAK:  res = W_ARMC; break;  /* WORN_CLOAK */
        case ARM_SHIRT:  res = W_ARMU; break;  /* WORN_SHIRT */
        default: break;
        }
        break;
    case WEAPON_CLASS:
        res = W_WEP | W_SWAPWEP;
        if (objects[otyp]?.oc_merge) res |= W_QUIVER;
        break;
    case TOOL_CLASS:
        if (otyp === BLINDFOLD || otyp === TOWEL || otyp === LENSES)
            res = W_TOOL;                /* WORN_BLINDF */
        else if (is_weptool_worn(obj) || otyp === TIN_OPENER)
            res = W_WEP | W_SWAPWEP;
        else if (otyp === SADDLE_OTYP)
            res = W_SADDLE;
        break;
    case FOOD_CLASS:
        if (otyp === MEAT_RING)
            res = W_RINGL | W_RINGR;
        break;
    case GEM_CLASS:
        res = W_QUIVER;
        break;
    case BALL_CLASS:
        res = W_BALL;
        break;
    case CHAIN_CLASS:
        res = W_CHAIN;
        break;
    default:
        break;
    }
    return res;
}
// C ref: obj.h is_weptool(o) — a TOOL_CLASS object with a real weapon skill.
// js/invent.js:1387 exports the same predicate; kept local so wearslot() adds
// no module edge from worn.js to invent.js.
function is_weptool_worn(obj) {
    return (obj?.oclass ?? objects[obj?.otyp]?.oclass) === TOOL_CLASS
        && (objects[obj?.otyp]?.oc_skill ?? 0) !== 0;
}

// C ref: hack.h impossible() — this port has no panic/impossible channel, so
// the complaints check_wornmask_slots() would raise are collected here instead.
export const worn_slot_insanity = [];
function impossible_worn(msg) { worn_slot_insanity.push(msg); }
// C ref: objnam.c simpleonames(obj) — enough of it for the one complaint that
// names an object (js/invent.js:507 ansimpleoname() is the articled form).
function simpleonames_worn(obj) { return objects[obj?.otyp]?.name ?? 'object'; }

// ─── worn.c:355 check_wornmask_slots() ─────────────────────────────────────
// The 'sanity_check' option's worn-slot audit, called by you_sanity_check().
// C's two EXTRA_SANITY_CHECKS blocks (embedded dragon scales, two-weaponing)
// are compiled out of the recorded builds and are not ported.
export function check_wornmask_slots() {
    /* we'll skip ball and chain here--they warrant separate sanity check */
    const IGNORE_SLOTS = (W_ART | W_ARTI | W_SADDLE | W_BALL | W_CHAIN);
    const invent = game.invent || [];

    for (const wp of worn_table) {
        const m = wp.w_mask;
        if ((m & IGNORE_SLOTS) !== 0 && (m & ~IGNORE_SLOTS) === 0)
            continue;
        const o = worn_slot_read(wp);
        if (o) {
            let whybuf = '';
            /* slot pointer (uarm, uwep, &c) is populated; check that the
               object is in inventory and has the relevant owornmask bit set */
            const found = invent.includes(o);
            if (!found)
                whybuf = `${wp.w_what} not found in invent`;
            else if (((o.owornmask | 0) & m) === 0)
                whybuf = `${wp.w_what} bit not set in owornmask`
                    + ` [0x${((o.owornmask | 0) >>> 0).toString(16).padStart(8, '0')}]`;
            else if (((o.owornmask | 0) & ~(m | IGNORE_SLOTS)) !== 0)
                whybuf = `${wp.w_what} wrong bit set in owornmask`
                    + ` [0x${((o.owornmask | 0) >>> 0).toString(16).padStart(8, '0')}]`;
            if (whybuf)
                impossible_worn(`Worn-slot insanity: ${whybuf}.`);
        } /* o != NULL */

        /* check whether any item other than the one in the slot pointer claims
           to be worn/wielded in this slot; make this test whether 'o' is Null
           or not */
        for (const otmp of invent) {
            if (otmp !== o && ((otmp.owornmask | 0) & m) !== 0
                /* embedded scales owornmask is W_ARM|I_SPECIAL so would give a
                   false complaint about an item other than uarm having the
                   W_ARM bit set if we didn't screen it out here */
                && (m !== W_ARM || otmp !== game.uskin
                    || ((otmp.owornmask | 0) & I_SPECIAL) === 0)) {
                impossible_worn(`Worn-slot insanity: ${simpleonames_worn(otmp)}`
                    + ` [0x${((otmp.owornmask | 0) >>> 0).toString(16).padStart(8, '0')}]`
                    + ` has ${wp.w_what} mask 0x${(m >>> 0).toString(16).padStart(8, '0')}`
                    + ' bit set.');
            }
        }
    } /* for wp in worn[] */
}

// ─── worn.c:474 mon_set_minvis(mon, cursed_potion) ─────────────────────────
// A monster becomes invisible.  perminvis is the permanent flag and minvis the
// currently-visible-or-not one; a monster whose invisibility is blocked (a worn
// mummy wrapping, invis_blkd) gets perminvis only.  js/mon.js:2250,
// js/zap.js:929 and js/makemon.js:3286 each record this as unported at their
// call site; those call sites are left alone.
export function mon_set_minvis(mon, cursed_potion) {
    if (!mon) return;
    mon.perminvis = !cursed_potion ? 1 : 0;
    if (!mon.invis_blkd) {
        mon.minvis = mon.perminvis;
        newsym_worn(mon.mx, mon.my);   /* make it disappear */
        if (mon.wormno)
            see_wsegs_worn(mon);       /* and any tail too */
    }
}
// C ref: display.c newsym(x, y) / worm.c see_wsegs(mon).  Resolved lazily so
// mon_set_minvis() adds no module edge from worn.js to display.js/worm.js.
function newsym_worn(x, y) {
    import('./display.js').then((d) => d.newsym?.(x, y)).catch(() => {});
}
function see_wsegs_worn(mon) {
    import('./worm.js').then((w) => w.see_wsegs?.(mon)).catch(() => {});
}

// ─── worn.c:1055 clear_bypass(objchn) ──────────────────────────────────────
// Clear the bypass bits for an object chain, plus contents if applicable.
// C walks a `nobj` linked list; this port keeps object chains as arrays and
// container contents on `.cobj` (js/invent.js:375 Has_contents), so the
// recursion is over those.  A single object is accepted as a one-item chain.
export function clear_bypass(objchn) {
    const chain = Array.isArray(objchn) ? objchn : (objchn ? [objchn] : []);
    for (const o of chain) {
        o.bypass = 0;
        if (Has_contents_worn(o))
            clear_bypass(o.cobj);
    }
}
// C ref: obj.h Has_contents(o).
function Has_contents_worn(o) { return !!(o?.cobj && o.cobj.length); }

// ─── worn.c:1119 bypass_obj(obj) ───────────────────────────────────────────
// Mark one object as "already handled this pass" and raise the global flag
// that tells clear_bypasses() there is work to do.
export function bypass_obj(obj) {
    if (!obj) return;
    obj.bypass = 1;
    game.context = game.context || {};
    game.context.bypasses = true;   /* C: svc.context.bypasses = TRUE */
}
