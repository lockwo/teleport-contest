// mthrowu.js — the parts of C src/mthrowu.c that had no home in js/monmove.js.
//
// monmove.js owns m_throw/thrwmu/ohitmon and their flight loop; this file holds
// the pieces those call out to which were previously missing or stubbed:
// hits_bars()/hit_bars() (the iron-bars clause of MT_FLIGHTCHECK, explicitly
// omitted there), rnd_hallublast()/breathwep_name() (a CORE rn2 draw whenever a
// hallucinating hero is breathed at), and m_useupall().
import { game } from './gstate.js';
import { rn2, rnd } from './rng.js';
import { objects, WEAPON_CLASS, ARMOR_CLASS, TOOL_CLASS, ROCK_CLASS,
         FOOD_CLASS, SPBOOK_CLASS, WAND_CLASS, BALL_CLASS, CHAIN_CLASS,
         CORPSE, BOULDER, STATUE, HEAVY_IRON_BALL } from './mkobj.js';
import { OBJ_ARMCAT } from './objarmor_data.js';
import { monster_by_pmidx } from './makemon.js';

// C ref: mthrowu.c:24 breathwep[] — indexed by BZ_OFS_AD(typ), i.e. adtyp - 1.
const BREATHWEP = [
    'fragments', 'fire', 'frost', 'sleep gas', 'a disintegration blast',
    'lightning', 'poison gas', 'acid', 'strange breath #8',
    'strange breath #9',
];
// C ref: mthrowu.c:31 hallublasts[] — 97 entries.  rnd_hallublast() is
// ROLL_FROM(), i.e. a CORE rn2(SIZE) draw, NOT a display-rng one; the size of
// this table is therefore the modulus and must stay complete.
const HALLUBLASTS = [
    'asteroids', 'beads', 'bubbles', 'butterflies', 'champagne', 'chaos',
    'coins', 'cotton candy', 'crumbs', 'dark matter', 'darkness', 'data',
    'dust specks', 'emoticons', 'emotions', 'entropy', 'flowers', 'foam',
    'fog', 'gamma rays', 'gelatin', 'gemstones', 'ghosts', 'glass shards',
    'glitter', 'good vibes', 'gravel', 'gravity', 'gravy', 'grawlixes',
    'holy light', 'hornets', 'hot air', 'hyphens', 'hypnosis', 'infrared',
    'insects', 'jargon', 'laser beams', 'leaves', 'lightening', 'logic gates',
    'magma', 'marbles', 'mathematics', 'megabytes', 'metal shavings',
    'metapatterns', 'meteors', 'mist', 'mud', 'music', 'nanites', 'needles',
    'noise', 'nostalgia', 'oil', 'paint', 'photons', 'pixels', 'plasma',
    'polarity', 'powder', 'powerups', 'prismatic light', 'pure logic',
    'purple', 'radio waves', 'rainbows', 'rock music', 'rocket fuel', 'rope',
    'sadness', 'salt', 'sand', 'scrolls', 'sludge', 'smileys', 'snowflakes',
    'sparkles', 'specularity', 'spores', 'stars', 'steam', 'tetrahedrons',
    'text', 'the past', 'tornadoes', 'toxic waste', 'ultraviolet light',
    'viruses', 'water', 'waveforms', 'wind', 'X-rays', 'zorkmids',
];

// C ref: mthrowu.c:52 rnd_hallublast() — ROLL_FROM(hallublasts).
export function rnd_hallublast() {
    return HALLUBLASTS[rn2(HALLUBLASTS.length)];
}

// C ref: mthrowu.c:1083 breathwep_name(typ) — a hallucinating hero hears a
// nonsense blast name, and that substitution DRAWS rn2(97) on the core stream.
export function breathwep_name(typ) {
    if (game.u?.uhallu) return rnd_hallublast();
    return BREATHWEP[(typ | 0) - 1] ?? 'strange breath';
}

// C ref: mthrowu.c:1154 m_useupall(mon, obj) — pull the whole stack out of the
// monster's inventory and free it.
export function m_useupall(mon, obj) {
    if (!mon || !obj) return;
    const inv = mon.minvent;
    if (Array.isArray(inv)) {
        const i = inv.indexOf(obj);
        if (i >= 0) inv.splice(i, 1);
    }
    obj.where = 'free';
    obj.ocarry = null;
}

// C ref: objclass.h:37 enum obj_armor_types.
const ARM_GLOVES = 3;
// C ref: include/skills.h — the negated launcher skills used by is_ammo().
const P_BOW = 20, P_CROSSBOW = 22, P_DART = 23, P_SHURIKEN = 24,
      P_SPEAR = 17, P_KNIFE = 2;
// mkobj.js otyps (verified against OBJECT_DATA).
const SKELETON_KEY = 221, LOCK_PICK = 222, CREDIT_CARD = 223,
      TALLOW_CANDLE = 224, WAX_CANDLE = 225, LENSES = 232,
      TIN_WHISTLE = 245, MAGIC_WHISTLE = 246,
      MEAT_STICK = 268, ENORMOUS_MEATBALL = 269;
const MZ_TINY = 0;

// C ref: mthrowu.c:1499 hits_bars(&obj, x, y, barsx, barsy, always_hit,
// whodidit) — does a thrown/kicked/rolled object stop at iron bars?  A dart, an
// arrow, a spear, a knife or a pair of gloves slips between them; almost
// everything else does not.  `whodidit === -1` asks the question WITHOUT
// running the breakage side effect, which is the only form monmove.js's
// MT_FLIGHTCHECK needs (C passes 0 there, but the breakage half needs
// dothrow.c's breaks()/hero_breaks(), which live in another module).
export function hits_bars(otmp, always_hit) {
    if (!otmp) return false;
    const obj_type = otmp.otyp;
    let hits = !!always_hit;

    if (!hits) {
        switch (otmp.oclass) {
        case WEAPON_CLASS: {
            const oskill = objects[obj_type]?.oc_skill ?? 0;
            hits = (oskill !== -P_BOW && oskill !== -P_CROSSBOW
                    && oskill !== -P_DART && oskill !== -P_SHURIKEN
                    && oskill !== P_SPEAR
                    && oskill !== P_KNIFE); /* but not dagger */
            break;
        }
        case ARMOR_CLASS:
            hits = (OBJ_ARMCAT[obj_type] !== ARM_GLOVES);
            break;
        case TOOL_CLASS:
            hits = (obj_type !== SKELETON_KEY && obj_type !== LOCK_PICK
                    && obj_type !== CREDIT_CARD && obj_type !== TALLOW_CANDLE
                    && obj_type !== WAX_CANDLE && obj_type !== LENSES
                    && obj_type !== TIN_WHISTLE && obj_type !== MAGIC_WHISTLE);
            break;
        case ROCK_CLASS: /* includes boulder */
            if (obj_type !== STATUE || mon_msize_of(otmp.corpsenm) > MZ_TINY)
                hits = true;
            break;
        case FOOD_CLASS:
            if (obj_type === CORPSE && mon_msize_of(otmp.corpsenm) > MZ_TINY)
                hits = true;
            else
                hits = (obj_type === MEAT_STICK
                        || obj_type === ENORMOUS_MEATBALL);
            break;
        case SPBOOK_CLASS:
        case WAND_CLASS:
        case BALL_CLASS:
        case CHAIN_CLASS:
            hits = true;
            break;
        default:
            break;
        }
    }
    return hits;
}
function mon_msize_of(corpsenm) {
    return monster_by_pmidx(corpsenm | 0)?.msize ?? 2 /* MZ_MEDIUM */;
}

// C ref: mthrowu.c:1417 hit_bars(objp, objx, objy, barsx, barsy, breakflags) —
// the noise + hero-breaks-the-bars half.  Only the WAR_HAMMER / HEAVY_IRON_BALL
// arm draws RNG, and only when the HERO is at fault:
//   chance = (melee ? 40 : 60) - acurrstr() - spe;  !rn2(max(2, chance))
// The breakage test that precedes it (breaks()/hero_breaks()) lives in
// js/dothrow.js, so this entry point takes the already-computed `broke` flag.
const WT_IRON_BALL_INCR = 160, WAR_HAMMER = 76;
export function hit_bars_break_check(otmp, your_fault, melee_attk) {
    if (!otmp || !your_fault) return false;
    if (otmp.otyp !== WAR_HAMMER && otmp.otyp !== HEAVY_IRON_BALL) return false;
    const spe = (otmp.otyp === HEAVY_IRON_BALL)
        ? Math.trunc((otmp.owt | 0) / WT_IRON_BALL_INCR)
        : (otmp.spe | 0);
    const chance = (melee_attk ? 40 : 60) - acurrstr() - spe;
    return !rn2(Math.max(2, chance));
}
// C ref: attrib.c:1245 acurrstr() — ACURR(A_STR) folded back into 3..25.
function acurrstr() {
    const str = game.u?.acurr?.a?.[0] ?? 0;
    if (str <= 18) return Math.max(str, 3);
    if (str <= 121) return 19 + Math.trunc(str / 50);
    return Math.min(str, 125) - 100;
}

// C ref: mthrowu.c:506 ucatchgem(gem, mon) — a hero polymorphed into a unicorn
// catches a gem a monster threw at them.  DRAWS NO RNG itself, but returning
// TRUE swallows the missile so the thitu()/dmgval() rolls behind it never
// happen; getting it wrong therefore shifts the whole stream.
// LAST_GLASS_GEM / FIRST_GLASS_GEM bracket the worthless glass in objects.h;
// mkobj.js otyps.
const FIRST_GLASS_GEM = 461 /*WORTHLESS_WHITE_GLASS*/,
      LAST_GLASS_GEM = 469 /*WORTHLESS_VIOLET_GLASS*/;
export function ucatchgem(gem, _mon) {
    // C: `gem->otyp <= LAST_GLASS_GEM && is_unicorn(youmonst.data)`.
    if (!gem || gem.otyp > LAST_GLASS_GEM) return false;
    if (!is_unicorn_you()) return false;
    // The two arms differ only in messaging and whether the gem is dropped
    // immediately (worthless glass is caught then dropped, a real gem is
    // accepted); both consume the missile.
    void FIRST_GLASS_GEM;
    return true;
}
// C ref: mondata.h is_unicorn(ptr) — mlet S_UNICORN and mons[].maligntyp != 0.
const S_UNICORN = 21;
function is_unicorn_you() {
    const u = game.u;
    if (!u?.Upolyd) return false;
    const ptr = monster_by_pmidx(u.umonnum ?? -1);
    return ptr?.mcls === S_UNICORN && (ptr.maligntyp | 0) !== 0;
}

// C ref: mthrowu.c:850 return_from_mtoss(magr, otmp, tethered_weapon) — an
// aklys (or other throw-and-return weapon) flies back to the monster that threw
// it.  RNG, in C's order:
//   rn2(100)                       made_it_back  (0 == "loud snap", lost)
//   rn2(100)                       caught cleanly (only if !impaired)
//   rn2(2) [+ rnd(3) when nonzero] the fumble damage when it isn't caught
// Returns { made_it_back, caught, dmg, hits_thrower } so the caller keeps its
// own messaging/placement (place_object/stackobj live in mkobj.js).
export function return_from_mtoss(magr, otmp, _tethered_weapon) {
    const impaired = !!(magr?.mconf || magr?.mstun || magr?.mblinded);
    let notcaught = false, hits_thrower = false, dmg = 0;
    const made_it_back = rn2(100);

    if (otmp && made_it_back) {
        if (!impaired && rn2(100)) {
            /* caught: goes back into the monster's inventory */
        } else {
            dmg = rn2(2);
            if (dmg) { dmg += rnd(3); hits_thrower = true; }
            notcaught = true;
        }
    } else {
        notcaught = true;   /* "You hear a loud snap!" */
    }
    return { made_it_back: !!made_it_back, caught: !notcaught, dmg, hits_thrower };
}

// ═══════════════════════════════════════════════════════════════════════════
// The mthrowu.c flight path itself: drop_throw(), m_throw(), monshoot(),
// thrwmm(), lined_up()/m_lined_up() and hit_bars().  ADDITIVE ONLY — nothing
// above this line and nothing in js/monmove.js calls any of it.
//
// js/monmove.js imports THIS file, so a static `import ... from './monmove.js'`
// here would close a cycle.  Its exported callees (thitu, ohitmon, MON_WEP,
// m_carrying, m_lined_up) therefore arrive by dynamic import inside the async
// bodies, which adds no edge to the module graph; its module-PRIVATE ones
// (linedup, blocking_terrain, monmulti, u_catch_thrown_obj, mshot_xname,
// canseemon) arrive through a trailing `deps` argument.  Each of those is
// already a faithful port where it sits — the fix is to export the original,
// not to write a second copy:
//
//   linedup             js/monmove.js:6736
//   blocking_terrain    js/monmove.js:6765
//   monmulti            js/monmove.js:6822
//   multishot_class_bonus js/monmove.js:6795
//   u_catch_thrown_obj  js/monmove.js:5979
//   mshot_xname         js/monmove.js:6041
//   canseemon           js/monmove.js:6935 (canseemon_mm)
//   should_mulch_missile js/monmove.js:6518
//
// C's control flow, its order of operations and its RNG call order are
// unchanged; the deps are pure plumbing.
// ═══════════════════════════════════════════════════════════════════════════

import { isok, IS_OBSTRUCTED, IS_SINK, IRONBARS, BOLT_LIM,
         W_NONDIGGABLE, BRK_BY_HERO, BRK_MELEE, PET_MISSILE_RANGE2,
         M_ATTK_MISS, M_ATTK_HIT, NEED_WEAPON, NEED_RANGED_WEAPON } from './const.js';
import { distmin, dist2 } from './hacklib.js';
import { COIN_CLASS, VENOM_CLASS, POTION_CLASS, GEM_CLASS, EGG,
         clear_dknown } from './mkobj.js';

// C ref: objects.h otyps this block names, resolved by the enum name the
// objects[] rows carry in `sym` — the same resolution js/artifact.js:154 uses.
const _otyp = (nm) => objects.findIndex((o) => o.sym === nm);
const BLINDING_VENOM = _otyp('BLINDING_VENOM'),
      ACID_VENOM = _otyp('ACID_VENOM'),
      ELVEN_ARROW = _otyp('ELVEN_ARROW'),
      ELVEN_BOW = _otyp('ELVEN_BOW'),
      CREAM_PIE = _otyp('CREAM_PIE'),
      POT_ACID = _otyp('POT_ACID');
// C ref: hack.h sgn().
const sgn = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
// C ref: objclass.h oc_material GOLD / SILVER.
const MAT_GOLD = 15, MAT_SILVER = 14;
// C ref: skills.h P_BOW, negated in oc_skill for a launcher.
const P_BOW_SKILL = 20;

// C ref: rm.h levl[x][y]; this port reaches the map through game.level.at().
function levl_at(x, y) { return game.level?.at?.(x, y) || null; }
function terrain_typ(x, y) { return levl_at(x, y)?.typ ?? 0; }

// ── drop_throw (C ref: mthrowu.c:161) ──────────────────────────────────────
//
// "Be sure this corresponds with what happens to player-thrown objects in
// dothrow.c (for consistency). --KAA.  Returns FALSE if object still exists
// (not destroyed)."
//
// RNG: should_mulch_missile() only — and only when the missile HIT.  A cream
// pie, any venom, and a hit egg break unconditionally and skip that roll
// entirely; delobj() behind the break rolls obj_resists() [rn2(100)].
//
// js/monmove.js:6482 drop_thrown_missile() is the hero-path subset of this
// (no down_gate/ship_object, no flooreffects, no passive_obj); it is what
// monmove.js's flight loop still calls.
export async function drop_throw(obj, ohit, x, y, deps = {}) {
    let broken;

    if (obj.otyp === CREAM_PIE || obj.oclass === VENOM_CLASS
        || (ohit && obj.otyp === EGG)) {
        broken = true;
    } else {
        broken = !!(ohit && deps.should_mulch_missile?.(obj));
    }

    if (broken) {
        await deps.delobj?.(obj);
    } else {
        const { down_gate } = await import('./dokick.js');
        if (down_gate(x, y) !== -1)
            broken = !!(await deps.ship_object?.(obj, x, y, false));
        if (!broken) {
            let mtmp = deps.m_at?.(x, y) || null;
            broken = !!(await deps.flooreffects?.(obj, x, y, 'fall'));
            if (!broken) {
                const { place_object, stackobj } = await import('./mkobj.js');
                place_object(obj, x, y);
                if (!mtmp && u_at(x, y))
                    mtmp = game.youmonst;
                if (mtmp && ohit)
                    await deps.passive_obj?.(mtmp, obj, null);
                stackobj(obj);
            }
        }
    }
    game.thrownobj = null;          /* C: gt.thrownobj = 0 */
    return broken;
}
// C ref: hack.h u_at(x,y).
function u_at(x, y) { return game.u?.ux === x && game.u?.uy === y; }

// ── m_throw (C ref: mthrowu.c:571) ─────────────────────────────────────────
//
// One missile of a (possibly multishot) volley, from launch to landing.
//
// RNG in C's order:
//   rn2(7)                    cursed/greased slip, only when (dx||dy)
//   rn2(3), rn2(3)            the slipped direction, only when the slip fired
//   [MT_FLIGHTCHECK pre]      hits_bars() with always_hit 0
//   per step:  ohitmon() / thitu() / potionhit() / ucatchgem() rolls
//              rnd(25)        blinding increment, only on a hit that can blind
//              rn2(5)         forcehit, EVERY surviving step
//              [MT_FLIGHTCHECK post] hits_bars() with that forcehit
//   return_from_mtoss()       rn2(100), rn2(100), rn2(2)[+rnd(3)]
//
// The two structural traps: `range--` is evaluated in the while condition (so
// the last step sees range == 0 and takes the "end of path" arm), and the
// forcehit rn2(5) is drawn BEFORE the `!range ||` short circuit is tested, so
// it fires on the final step too.
export async function m_throw(mon, x, y, dx, dy, range, obj, deps = {}) {
    let mtmp;
    let singleobj;
    let forcehit;
    const sym = obj.oclass;
    let hitu = 0, oldumort, blindinc = 0;
    const { autoreturn_weapon } = await import('./weapon.js');
    const MM = await import('./monmove.js');
    const arw = autoreturn_weapon(obj);
    const tethered_weapon = (obj === MM.MON_WEP(mon) && arw && arw.tethered !== 0);
    let return_flightpath = false;

    const bhitpos = { x, y };
    game.bhitpos = bhitpos;
    game.notonhead = false;             /* reset potentially stale value */

    if (obj.quan === 1) {
        /*
         * Remove object from minvent.  This cannot be done later on; what if
         * the player dies before then, leaving the monster with 0 daggers?
         * (This caused the infamous 2^32-1 orcish dagger bug.)
         *
         * VENOM is not in minvent -- it should already be OBJ_FREE.  The
         * extract below does nothing.
         */
        const { setmnotwielded } = await import('./weapon.js');
        const { obj_extract_self } = await import('./invent.js');
        /* not possibly_unwield(), which checks the object's location, not its
           existence */
        if (MM.MON_WEP(mon) === obj)
            setmnotwielded(mon, obj);
        obj_extract_self(obj);
        singleobj = obj;
        obj = null;
    } else {
        const { splitobj, obj_extract_self } = await import('./invent.js');
        singleobj = splitobj(obj, 1);
        obj_extract_self(singleobj);
    }
    /* global pointer for the missile object in OBJ_FREE state */
    game.thrownobj = singleobj;

    singleobj.owornmask = 0;    /* threw one of multiple weapons in hand? */
    if (!deps.canseemon?.(mon))
        clear_dknown(singleobj);            /* singleobj->dknown = 0 */

    if ((singleobj.cursed || singleobj.greased) && (dx || dy) && !rn2(7)) {
        if (deps.canseemon?.(mon) && game.flags?.verbose)
            await deps.pline_slip?.(mon, singleobj);
        dx = rn2(3) - 1;
        dy = rn2(3) - 1;
        /* check validity of new direction */
        if (!dx && !dy) {
            await drop_throw(singleobj, 0, bhitpos.x, bhitpos.y, deps);
            return;
        }
    }

    // C ref: mthrowu.c:546 MT_FLIGHTCHECK(pre, forcehit) — expanded verbatim.
    // `hits_bars` is the only clause with a side effect (it can destroy the
    // missile) and the only one that can roll.
    const MT_FLIGHTCHECK = (pre, fh) => {
        const nx = bhitpos.x + dx, ny = bhitpos.y + dy;
        /* missile hits edge of screen */
        if (!isok(nx, ny)) return true;
        /* missile hits the wall */
        if (IS_OBSTRUCTED(terrain_typ(nx, ny))) return true;
        /* missile hit closed door */
        if (deps.closed_door?.(nx, ny)) return true;
        /* missile might hit iron bars.  The random chance for small objects
           hitting bars is skipped when reaching them at point blank range. */
        if (terrain_typ(nx, ny) === IRONBARS
            && hits_bars(singleobj, pre ? 0 : fh))
            return true;
        /* Thrown objects "sink" */
        if (!pre && IS_SINK(terrain_typ(bhitpos.x, bhitpos.y))) return true;
        return false;
    };

    if (MT_FLIGHTCHECK(true, 0)) {
        await drop_throw(singleobj, 0, bhitpos.x, bhitpos.y, deps);
        return;
    }
    game.mesg_given = 0;  /* a 'missile misses' message has not yet been shown */

    /* Note: drop_throw may destroy singleobj.  Since obj must be destroyed
     * early to avoid the dagger bug, anyone who modifies this code should be
     * careful not to use either one after it's been freed. */
    if (sym) {
        /* C: tmp_at(DISP_FLASH / DISP_TETHER, obj_to_glyph(singleobj,
           rn2_on_display_rng)) — a DISPLAY-rng draw, not a core one. */
        await deps.tmp_at_flash?.(singleobj, tethered_weapon);
    }
    while (range-- > 0) {   /* Actually the loop is always exited by break */
        singleobj.ox = (bhitpos.x += dx);
        singleobj.oy = (bhitpos.y += dy);
        if (deps.cansee?.(bhitpos.x, bhitpos.y))
            deps.observe_object?.(singleobj);

        mtmp = deps.m_at?.(bhitpos.x, bhitpos.y) || null;
        if (mtmp && await deps.shade_miss?.(mon, mtmp, singleobj, true, true)) {
            /* if mtmp is a shade and the missile passes harmlessly through it,
               give a message and skip it in order to keep going */
            mtmp = null;
        } else if (mtmp) {
            if (await MM.ohitmon(mtmp, singleobj, range, true,
                                 bhitpos.x, bhitpos.y, mon))
                break;
        } else if (u_at(bhitpos.x, bhitpos.y)) {
            if (game.multi)
                deps.nomul?.(0);

            /* hero might be poly'd into a unicorn */
            if (singleobj.oclass === GEM_CLASS && ucatchgem(singleobj, mon))
                break;

            if (!tethered_weapon && deps.u_catch_thrown_obj?.(singleobj))
                break;

            if (singleobj.oclass === POTION_CLASS) {
                await deps.potionhit?.(game.youmonst, singleobj,
                                       deps.POTHIT_MONST_THROW ?? 2);
                break;
            }
            oldumort = game.u?.umortality | 0;

            switch (singleobj.otyp) {
            case EGG:
                if (!deps.touch_petrifies?.(singleobj.corpsenm)) {
                    await deps.impossible?.(
                        `monster throwing egg type ${singleobj.corpsenm}`);
                    hitu = 0;
                    break;
                }
                /* FALLTHRU */
            case CREAM_PIE:
            case BLINDING_VENOM:
                hitu = await MM.thitu(8, 0, singleobj);
                break;
            default: {
                const { dmgval } = await import('./weapon.js');
                let dam = dmgval(singleobj, game.youmonst);
                let hitv = 3 - distmin(game.u.ux, game.u.uy, mon.mx, mon.my);
                if (hitv < -4)
                    hitv = -4;
                /* [elves get a shooting bonus, orcs don't...] */
                if (deps.is_elf?.(mon.data)
                    && objects[singleobj.otyp]?.oc_skill === -P_BOW_SKILL) {
                    hitv++;
                    if (MM.MON_WEP(mon) && MM.MON_WEP(mon).otyp === ELVEN_BOW)
                        hitv++;
                    if (singleobj.otyp === ELVEN_ARROW)
                        dam++;
                }
                if (deps.bigmonst?.(deps.youmonst_data?.()))
                    hitv++;
                hitv += 8 + (singleobj.spe | 0);
                if (dam < 1)
                    dam = 1;
                if (singleobj.otyp !== ACID_VENOM)
                    dam = deps.Maybe_Half_Phys ? deps.Maybe_Half_Phys(dam) : dam;
                hitu = await MM.thitu(hitv, dam, singleobj);
                break;
            }
            }
            if (hitu && singleobj.opoisoned && deps.is_poisonable?.(singleobj)) {
                await deps.poisoned?.(singleobj, /* A_STR */ 0,
                                      /* if damage triggered life-saving,
                                         poison is limited to attrib loss */
                                      ((game.u?.umortality | 0) > oldumort)
                                          ? 0 : 10, true);
            }
            if (hitu && deps.can_blnd?.(null, game.youmonst,
                                        singleobj.otyp === BLINDING_VENOM
                                            ? (deps.AT_SPIT ?? 0)
                                            : (deps.AT_WEAP ?? 0),
                                        singleobj)) {
                blindinc = rnd(25);
                await deps.blind_msg?.(singleobj);
            }
            if (hitu && singleobj.otyp === EGG) {
                if (!game.u?.Stoned && !deps.Stone_resistance?.()
                    && !(deps.poly_when_stoned?.(deps.youmonst_data?.())
                         && await deps.polymon?.(deps.PM_STONE_GOLEM)))
                    await deps.make_stoned?.(5, null, deps.KILLED_BY ?? 0, '');
            }
            await deps.stop_occupation?.();
            if (hitu) {
                if (!tethered_weapon) {
                    await drop_throw(singleobj, hitu, game.u.ux, game.u.uy, deps);
                } else {
                    return_flightpath = true;   /* ready for return journey */
                }
                break;
            }
        }

        forcehit = !rn2(5);
        if (!range || MT_FLIGHTCHECK(false, forcehit)) {
            /* end of path or blocked */
            if (singleobj) {    /* hits_bars might have destroyed it */
                await deps.miss_msg?.(singleobj, bhitpos, range);
                if (!tethered_weapon) {
                    await drop_throw(singleobj, 0, bhitpos.x, bhitpos.y, deps);
                } else {
                    return_flightpath = true;   /* ready for return journey */
                }
            }
            break;
        }
        await deps.tmp_at_step?.(bhitpos.x, bhitpos.y);
    }
    await deps.tmp_at_step?.(bhitpos.x, bhitpos.y);
    if (arw && return_flightpath)
        return_from_mtoss(mon, singleobj, tethered_weapon);
        /* mon could be DEADMONSTER now */
    else
        await deps.tmp_at_end?.();
    game.mesg_given = 0;        /* reset */

    if (blindinc) {
        game.u.ucreamed = (game.u.ucreamed | 0) + blindinc;
        await deps.make_blinded?.((deps.BlindedTimeout?.() | 0) + blindinc, false);
        if (!game.u?.Blinded)
            await deps.vision_clears?.();
    }
    /* note: all early returns follow drop_throw(), which clears thrownobj */
    game.thrownobj = null;
}

// ── monshoot (C ref: mthrowu.c:261) ────────────────────────────────────────
//
// "mtmp throws otmp, or shoots otmp with mwep, at hero or at monster mtarg."
// The caller must have called linedup() to set up <gt.tbx, gt.tby>.
//
// RNG: monmulti() (its rnd(multishot)) FIRST, then nothing until m_throw().
// The volley size is rolled before the "N arrows" announcement, so a message
// suppressed by !canseemon does not change the stream — but a wrong multishot
// modulus does.
export async function monshoot(mtmp, otmp, mwep, deps = {}) {
    const mtarg = game.mtarget || null;
    const dm = distmin(mtmp.mx, mtmp.my,
                       mtarg ? mtarg.mx : mtmp.mux,
                       mtarg ? mtarg.my : mtmp.muy);
    const multishot = deps.monmulti ? deps.monmulti(mtmp, otmp, mwep) : 1;
    const m_shot = (game.m_shot = game.m_shot || {});

    if (deps.canseemon?.(mtmp)) {
        await deps.shoot_msg?.(mtmp, otmp, mwep, multishot, mtarg);
        m_shot.s = !!deps.ammo_and_launcher?.(otmp, mwep);
        m_shot.o = otmp.otyp;
    } else {
        m_shot.o = 0;       /* STRANGE_OBJECT: don't give multishot feedback */
    }
    m_shot.n = multishot;
    for (m_shot.i = 1; m_shot.i <= m_shot.n; m_shot.i++) {
        await m_throw(mtmp, mtmp.mx, mtmp.my, sgn(game.tbx), sgn(game.tby),
                      dm, otmp, deps);
        /* conceptually all N missiles are in flight at once, but if mtmp gets
           killed (shot kills adjacent gas spore and triggers explosion,
           perhaps), inventory will be dropped and otmp might go away via
           merging into another stack */
        if (deps.DEADMONSTER?.(mtmp) && m_shot.i < m_shot.n)
            /* cancel pending shots */
            break;      /* endmultishot(FALSE); */
    }
    /* reset 'gm.m_shot' */
    m_shot.n = m_shot.i = 0;
    m_shot.o = 0;               /* STRANGE_OBJECT */
    m_shot.s = false;
}

// ── thrwmm (C ref: mthrowu.c:968) ──────────────────────────────────────────
//
// "Monster throws item at another monster."  js/mhitm.js:1098 notes this as the
// missing ranged arm of the monster-vs-monster attack path.
//
// RNG: mon_wield_item() (none for a thrown dagger), m_lined_up() (its rn2(25)
// only applies to a hero target, so none here), then `rn2(chance)` — drawn ONLY
// when the target is fleeing — and finally monshoot()'s volley.
export async function thrwmm(mtmp, mtarg, deps = {}) {
    const MM = await import('./monmove.js');

    /* Polearms won't be applied by monsters against other monsters */
    if (mtmp.weapon_check === NEED_WEAPON || !MM.MON_WEP(mtmp)) {
        mtmp.weapon_check = NEED_RANGED_WEAPON;
        /* mon_wield_item resets weapon_check as appropriate */
        if (await deps.mon_wield_item?.(mtmp))
            return M_ATTK_MISS;
    }

    /* Pick a weapon */
    const otmp = deps.select_rwep?.(mtmp);
    if (!otmp)
        return M_ATTK_MISS;
    const ispole = !!deps.is_pole?.(otmp);

    const x = mtmp.mx, y = mtmp.my;

    const mwep = MM.MON_WEP(mtmp);      /* wielded weapon */

    if (!ispole && m_lined_up(mtarg, mtmp, deps)) {
        const chance = Math.max(BOLT_LIM - distmin(x, y, mtarg.mx, mtarg.my), 1);

        if (!mtarg.mflee || !rn2(chance)) {
            if (deps.ammo_and_launcher?.(otmp, mwep)
                && dist2(mtmp.mx, mtmp.my, mtarg.mx, mtarg.my)
                   > PET_MISSILE_RANGE2)
                return M_ATTK_MISS;     /* Out of range */
            /* Set target monster */
            game.mtarget = mtarg;
            game.marcher = mtmp;
            await monshoot(mtmp, otmp, mwep, deps);  /* multishot shoot/throw */
            game.marcher = game.mtarget = null;
            deps.nomul?.(0);
            return M_ATTK_HIT;
        }
    }
    return M_ATTK_MISS;
}

// ── m_lined_up / lined_up (C ref: mthrowu.c:1375, :1397) ───────────────────
//
// js/monmove.js:6707 exports an m_lined_up(mtmp) that hardcodes the HERO as the
// target (utarget always true); thrwmm() needs the monster-vs-monster form, so
// the general two-argument version is translated here.
//
// The rn2(25) concealment roll fires for a polymorphed hero target BEFORE the
// `u.uundetected || U_AP_TYPE...` term is tested — C's && is left to right, so
// the DRAW happens even when the trailing term then declines to block.  A
// monster target skips it entirely.
export function m_lined_up(mtarg, mtmp, deps = {}) {
    const utarget = (mtarg === game.youmonst);
    const tx = utarget ? mtmp.mux : mtarg.mx;
    const ty = utarget ? mtmp.muy : mtarg.my;
    const ignore_boulders = utarget
        && (!!deps.throws_rocks?.(mtmp.data)
            || !!deps.m_carrying?.(mtmp, deps.WAN_STRIKING));

    /* hero concealment usually trumps monst awareness of being lined up */
    if (utarget && game.u?.Upolyd && rn2(25)
        && (game.u.uundetected
            || (deps.U_AP_TYPE?.() !== (deps.M_AP_NOTHING ?? 0)
                && deps.U_AP_TYPE?.() !== (deps.M_AP_MONSTER ?? 3))))
        return false;

    /* [no callers care about the 1 vs 2 situation any more] */
    return !!deps.linedup?.(tx, ty, mtmp.mx, mtmp.my,
                            utarget ? (ignore_boulders ? 1 : 2) : 0);
}

// C ref: mthrowu.c:1397 lined_up(mtmp) — "is mtmp in position to use a ranged
// attack on hero?"
export function lined_up(mtmp, deps = {}) {
    return m_lined_up(game.youmonst, mtmp, deps) ? true : false;
}

// ── hit_bars (C ref: mthrowu.c:1417) ──────────────────────────────────────
//
// The noise + breakage half of an object meeting iron bars.  `objp` is C's
// `struct obj **`; JS gets a one-field box so the caller sees the NULL-out.
//
// RNG: only the hero-at-fault WAR_HAMMER / HEAVY_IRON_BALL arm draws —
// `!rn2(max(2, chance))` with chance = (melee ? 40 : 60) - acurrstr() - spe.
// hit_bars_break_check() above is that arm on its own, taking an
// already-computed `broke`; this is the whole function.
export async function hit_bars(objp, objx, objy, barsx, barsy, breakflags,
                               deps = {}) {
    const otmp = objp.obj;
    const obj_type = otmp.otyp;
    const nodissolve = ((levl_at(barsx, barsy)?.wall_info | 0) & W_NONDIGGABLE) !== 0,
          your_fault = (breakflags & BRK_BY_HERO) !== 0,
          melee_attk = (breakflags & BRK_MELEE) !== 0;
    let noise = 0;

    const { hero_breaks, breaks } = await import('./dothrow.js');
    if (your_fault
        ? await hero_breaks(otmp, objx, objy, breakflags)
        : await breaks(otmp, objx, objy)) {
        objp.obj = null;        /* object is now gone */
        /* breakage makes its own noises */
        if (obj_type === POT_ACID) {
            await deps.acid_msg?.(barsx, barsy, nodissolve);
            if (!nodissolve)
                deps.dissolve_bars?.(barsx, barsy);
        }
    } else {
        if (!game.u?.Deaf) {
            /* C ref: mthrowu.c:1449 barsounds[] — index 0 is unused ("") and
               SIZE(barsounds) - 1 == 5 is the default. */
            const barsounds = ['', 'Whang', 'Whap', 'Flapp', 'Clink', 'Clonk'];
            const bsindx = (obj_type === BOULDER
                            || obj_type === HEAVY_IRON_BALL)
                           ? 1
                           : deps.harmless_missile?.(otmp) ? 2
                           : deps.is_flimsy?.(otmp) ? 3
                           : (otmp.oclass === COIN_CLASS
                              || objects[obj_type]?.material === MAT_GOLD
                              || objects[obj_type]?.material === MAT_SILVER)
                             ? 4
                             : barsounds.length - 1;

            await deps.pline?.(`${barsounds[bsindx]}!`);
        }
        if (!(deps.harmless_missile?.(otmp) || deps.is_flimsy?.(otmp)))
            noise = 4 * 4;

        if (your_fault && (otmp.otyp === WAR_HAMMER
                           || otmp.otyp === HEAVY_IRON_BALL)) {
            /* iron ball isn't a weapon or wep-tool so doesn't use obj->spe;
               weight is normally 480 but can be increased by increments of 160
               (scrolls of punishment read while already punished) */
            const spe = (otmp.otyp === HEAVY_IRON_BALL) /* 3+ for iron ball */
                        ? Math.trunc((otmp.owt | 0) / WT_IRON_BALL_INCR)
                        : (otmp.spe | 0);
            /* chance: used in a saving throw for the bars; more likely to break
               those when 'chance' is _lower_; acurrstr(): 3..25 */
            const chance = (melee_attk ? 40 : 60) - acurrstr() - spe;

            if (!rn2(Math.max(2, chance))) {
                await deps.pline?.('You break the bars apart!');
                deps.dissolve_bars?.(barsx, barsy);
                noise = noise * 2;
            }
        }

        if (noise)
            await deps.wake_nearto?.(barsx, barsy, noise);
    }
}
