// muse.js — monster item use.  C ref: src/muse.c.
//
// Full-file port: the defensive half (find_defensive/use_defensive), the
// offensive half (find_offensive/use_offensive), the miscellaneous half
// (find_misc/use_misc), the three rnd_*_item generators, searches_for_item(),
// mon_reflects(), munstone()/munslime() and every shared helper (precheck,
// mzapwand, mplayhorn, mreadmsg, mquaffmsg, m_useup, mbhit, mloot_container...).
//
// Why any of it matters: a monster that spends its turn USING an item does not
// MOVE.  Omitting the muse pass made every item-carrying monster take a step
// C's stood still for, and any message it prints lands at an input boundary and
// reorders the rest of movemon.  On seed0399 a human werewolf carrying a potion
// of speed quaffs it mid-turn; C's remaining twelve monsters then move only
// after the player dismisses the --More--.
//
// Why the gap was invisible in the RNG stream: MUSE_POT_SPEED draws NOTHING
// (mquaffmsg + mon_adjust_speed + m_useup are all deterministic), and the
// per-monster rolls around it — distfleeck's rn2(5) and mcalcmove's
// rn2(NORMAL_SPEED) — do not mention the monster, so a different SET of
// monsters acting produces a byte-identical call sequence.  Only the C
// recorder's monster dump (swarm/bin/mondiff.mjs / movepair.mjs) showed it.
//
// ── Selection vs. effect ─────────────────────────────────────────────────
// The find_*() selectors are ported in FULL, including every discarded RNG
// draw, because selection is what decides whether a monster moves at all and
// how the PRNG advances.  The use_*() effects are ported as far as the rest of
// the port reaches: where an effect bottoms out in a subsystem this port does
// not have (zap.c buzz() rays, newcham() monster polymorph, explode()), the
// case returns 0 — which is exactly C's "nothing happened" control flow, and
// leaves behaviour identical to not having selected the item.  Every such gap
// is called out at its case rather than papered over with a partial effect that
// would burn a charge and print a message for a ray that never travels.

import { game } from './gstate.js';
import { rn2, rnd, rn1, d } from './rng.js';
import { isok } from './hacklib.js';
import { is_animal, mindless, nohands, mflags1_of, mflags2_of, msound_of,
    M1_NEEDPICK, M1_BREATHLESS, M1_NOHEAD, M1_ACID, M1_WALLWALK, M1_AMORPHOUS,
    M1_UNSOLID, M1_NOEYES, M1_NOLIMBS, M1_NOHANDS, M1_NOTAKE,
    strongmonst_flag as strongmonst,
    M2_JEWELS, M2_UNDEAD, M2_MERC, M2_WERE } from './monflags_data.js';
import { attacktype, dmgtype, AT_GAZE, AT_EXPL, AT_BREA, AT_ENGL, AD_FIRE,
    AD_HEAL, AD_MAGM, AD_RBRE } from './monattk_data.js';
import { POT_SPEED, LARGE_BOX, BAG_OF_TRICKS, BOULDER, STRANGE_OBJECT,
    objects as OBJECTS, place_object } from './mkobj.js';
import { monster_by_pmidx, makemon } from './makemon.js';
import { find_mac as worn_find_mac } from './worn.js';
// onscary() is an `export function` declaration in monmove.js, so the
// monmove -> muse -> monmove import cycle resolves through a hoisted binding
// (unlike a `const` arrow, which would be in its temporal dead zone here).
import { onscary, m_next2u, m_lined_up, m_carrying, mon_would_take_item,
    objectsAt, mon_knows_traps, mon_learns_traps, mon_mintrap,
    Trap_Killed_Mon } from './monmove.js';
// base_mmove() is likewise a hoisted `export function`, so the cycle is safe.
import { base_mmove, healmon, DEADMONSTER, monsterList, mon_hates_silver }
    from './mon.js';
// C ref: pline() -> vpline() -> update_topl(): a new topline message shows
// --More-- for the UNACKNOWLEDGED previous one first (or appends to it when both
// fit).  js/display.js pline() only overwrites the pending text, so monster
// messages that land mid-turn must go through update_topl() to get C's boundary.
import { update_topl, newsym, map_invisible, see_with_infrared } from './display.js';
import { Monnam, mon_nam, monflee } from './uhitm.js';
import { cansee, couldsee } from './vision.js';
import { obj_doname, xname, makeknown, trycall, hands_obj,
    W_ARMOR_WORN, W_ACCESSORY_WORN }
    from './invent.js';
import { observe_object } from './o_init.js';
import { t_at, maketrap, seetrap, Can_fall_thru } from './trap.js';
import { rloc, RLOC_MSG, tele_restrict, noteleport_level } from './teleport.js';
import { ICE, POOL, MOAT, WATER, LAVAPOOL, LAVAWALL,
    STAIRS, LADDER, SCORR, CORR, PIT, HOLE, TRAPDOOR, TELEP_TRAP, WEB,
    BEAR_TRAP, FIRE_TRAP, POLY_TRAP, W_NONDIGGABLE, D_LOCKED, D_CLOSED,
    IS_FURNITURE, IS_DRAWBRIDGE, IS_DOOR, IS_OBSTRUCTED, IS_AIR, ACCESSIBLE,
    ZAP_POS, is_hole, is_pit, In_endgame, Is_botlevel, Is_knox_level,
    M_SEEN_MAGR, M_SEEN_FIRE, M_SEEN_COLD, M_SEEN_SLEEP, M_SEEN_ELEC,
    M_SEEN_ACID, M_SEEN_REFL } from './const.js';
import { surface } from './dungeon.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';

/* ------------------------------------------------------------------------ *
 * Object types.
 *
 * Every otyp below is resolved at run time from the C constant NAME recorded
 * in each js/mkobj.js OBJECTS row's `sym` field.  This is deliberate: four of
 * the five constants this file originally carried as hand-written integers
 * were WRONG (BULLWHIP is 82 not 208, POT_GAIN_LEVEL 309 not 297,
 * WAN_MAKE_INVISIBLE 418 not 349), which is this project's highest-yield bug
 * class.  A name lookup cannot silently rot the way a pasted number can.
 *
 * Resolved on first use, not at module-evaluation time: muse.js sits inside an
 * import cycle, so OBJECTS may still be uninitialized while this module's body
 * runs.
 * ------------------------------------------------------------------------ */
const OT_NAMES = [
    /* wands */
    'WAN_DIGGING', 'WAN_POLYMORPH', 'WAN_STRIKING', 'WAN_UNDEAD_TURNING',
    'WAN_TELEPORTATION', 'WAN_CREATE_MONSTER', 'WAN_MAKE_INVISIBLE',
    'WAN_SPEED_MONSTER', 'WAN_DEATH', 'WAN_SLEEP', 'WAN_FIRE', 'WAN_COLD',
    'WAN_LIGHTNING', 'WAN_MAGIC_MISSILE', 'WAN_CANCELLATION', 'WAN_OPENING',
    'WAN_LOCKING',
    /* potions */
    'POT_HEALING', 'POT_EXTRA_HEALING', 'POT_FULL_HEALING', 'POT_POLYMORPH',
    'POT_GAIN_LEVEL', 'POT_PARALYSIS', 'POT_SLEEPING', 'POT_ACID',
    'POT_CONFUSION', 'POT_BLINDNESS', 'POT_INVISIBILITY', 'POT_SICKNESS',
    'POT_OIL',
    /* scrolls */
    'SCR_TELEPORTATION', 'SCR_CREATE_MONSTER', 'SCR_EARTH', 'SCR_FIRE',
    /* amulets */
    'AMULET_OF_LIFE_SAVING', 'AMULET_OF_REFLECTION', 'AMULET_OF_GUARDING',
    /* tools */
    'PICK_AXE', 'UNICORN_HORN', 'FROST_HORN', 'FIRE_HORN', 'EXPENSIVE_CAMERA',
    'TIN_OPENER', 'BAG_OF_HOLDING', 'BAG_OF_TRICKS', 'BUGLE', 'ICE_BOX',
    /* food */
    'CORPSE', 'TIN', 'EGG', 'GLOB_OF_GREEN_SLIME',
    /* misc */
    'BULLWHIP', 'HEAVY_IRON_BALL', 'SHIELD_OF_REFLECTION',
    'SILVER_DRAGON_SCALES', 'SILVER_DRAGON_SCALE_MAIL',
];
let OT_CACHE = null;
function OT() {
    if (!OT_CACHE) {
        const out = {};
        for (const n of OT_NAMES) out[n] = OBJECTS.findIndex((o) => o && o.sym === n);
        OT_CACHE = Object.freeze(out);
    }
    return OT_CACHE;
}

// C ref: objclass.h oc_dir values.
const RAY = 3;
// C ref: objclass.h oc_class values / weapon.h skill ids.
const WEAPON_CLASS = 2, AMULET_CLASS = 5, TOOL_CLASS = 6, FOOD_CLASS = 7,
    POTION_CLASS = 8, SCROLL_CLASS = 9, WAND_CLASS = 11, COIN_CLASS = 12,
    GEM_CLASS = 13, ROCK_CLASS = 14;
// C ref: weight.h MAX_CARR_CAP / WT_HUMAN, monflag.h MZ_HUMAN (== MZ_MEDIUM).
const MAX_CARR_CAP = 1000, WT_HUMAN = 1450, MZ_HUMAN = 2;
const P_DAGGER = 1, P_KNIFE = 2;
// C ref: objclass.h material enum — SILVER is 14 (10 is DRAGON_HIDE).
const MAT_SILVER = 14;
// C ref: defsym.h MONSYM() indices (permonst.mcls).
const S_EYE = 5, S_GHOST = 54, S_KOP = 37, S_NYMPH_MCLS = 14, S_UNICORN = 21,
    S_LIGHT = 25, S_VORTEX = 22, S_EEL = 57, S_GOLEM = 55, S_DRAGON = 30;
// C ref: monflag.h MS_SILENT / MS_BUZZ.
const MS_SILENT = 0, MS_BUZZ = 10;
// C ref: monflag.h MZ_SMALL, monst.h W_ARMG / W_ARM / W_ARMS / W_ARMH / W_AMUL.
const MZ_SMALL = 1;
// which_armor(mon, ...) reads a MONSTER's misc_worn_check, which js/worn.js
// stamps from js/const.js's prop.h bits — W_AMUL is 0x00010000 there, not the
// 0x100 this block used to carry (that is prop.h W_WEP).
const W_ARM = 0x01, W_ARMC = 0x02, W_ARMH = 0x04, W_ARMS = 0x08,
    W_ARMG = 0x10, W_ARMF = 0x20, W_ARMU = 0x40, W_AMUL = 0x00010000;
const W_WEP_BIT = 0x1;
// C ref: monst.h MR_STONE.
const MR_STONE_BIT = 0x80;
// C ref: monst.h mspeed values.
const MSLOW = 1, MFAST = 2;
// C ref: hack.h BOLT_LIM, NORMAL_SPEED.
const BOLT_LIM = 8, NORMAL_SPEED = 12;
// C ref: hack.h POTION_OCCUPANT_CHANCE(n) / WAND_BACKFIRE_CHANCE.
const POTION_OCCUPANT_CHANCE = (n) => 13 + 2 * n;
const WAND_BACKFIRE_CHANCE = 100;
// C ref: rm.h NON_PM.
const NON_PM = -1;

/* ------------------------------------------------------------------------ *
 * gm.m / gt.trap<x,y> — C's module-global "what did find_* pick" scratch.
 * Keeping the same shape means use_*() reads exactly what find_*() decided.
 * ------------------------------------------------------------------------ */
const m = {
    defensive: null, has_defense: 0,
    offensive: null, has_offense: 0,
    misc: null, has_misc: 0,
};
const gt = { trapx: 0, trapy: 0 };
// C ref: gm.m_using / gz.zap_oseen — set around mbhit() so the zap machinery
// knows the beam came from a monster and whether the hero watched it fire.
let m_using = false, zap_oseen = false;
// C ref: gb.buzzer (muse.c:1883/1885) — the monster currently firing a beam.
// mbhitm's WAN_STRIKING miss test reads it: a monster whose wand the hero has
// never seen work (`!mwandexp`) cannot land its first shot.
let buzzer = null;

/* ------------------------------------------------------------------------ *
 * muse.c's #defines.  Note the deliberate collision: MUSE_WAN_TELEPORTATION
 * and MUSE_WAN_UNDEAD_TURNING share a value between the defensive and
 * offensive tables (C's own comment says the nonconsecutive value is ok).
 * ------------------------------------------------------------------------ */
/* defensive (muse.c:308-327) */
const MUSE_SCR_TELEPORTATION = 1, MUSE_WAN_TELEPORTATION_SELF = 2,
    MUSE_POT_HEALING = 3, MUSE_POT_EXTRA_HEALING = 4, MUSE_WAN_DIGGING = 5,
    MUSE_TRAPDOOR = 6, MUSE_TELEPORT_TRAP = 7, MUSE_UPSTAIRS = 8,
    MUSE_DOWNSTAIRS = 9, MUSE_WAN_CREATE_MONSTER = 10,
    MUSE_SCR_CREATE_MONSTER = 11, MUSE_UP_LADDER = 12, MUSE_DN_LADDER = 13,
    MUSE_SSTAIRS = 14, MUSE_WAN_TELEPORTATION = 15, MUSE_BUGLE = 16,
    MUSE_UNICORN_HORN = 17, MUSE_POT_FULL_HEALING = 18,
    MUSE_LIZARD_CORPSE = 19, MUSE_WAN_UNDEAD_TURNING = 20;
/* offensive (muse.c:1272-1291) */
const MUSE_WAN_DEATH = 1, MUSE_WAN_SLEEP = 2, MUSE_WAN_FIRE = 3,
    MUSE_WAN_COLD = 4, MUSE_WAN_LIGHTNING = 5, MUSE_WAN_MAGIC_MISSILE = 6,
    MUSE_WAN_STRIKING = 7, MUSE_SCR_FIRE = 8, MUSE_POT_PARALYSIS = 9,
    MUSE_POT_BLINDNESS = 10, MUSE_POT_CONFUSION = 11, MUSE_FROST_HORN = 12,
    MUSE_FIRE_HORN = 13, MUSE_POT_ACID = 14, MUSE_POT_SLEEPING = 16,
    MUSE_SCR_EARTH = 17, MUSE_CAMERA = 18;
/* miscellaneous (muse.c:2083-2092) */
export const MUSE_POT_GAIN_LEVEL = 1;
export const MUSE_WAN_MAKE_INVISIBLE = 2;
export const MUSE_POT_INVISIBILITY = 3;
export const MUSE_POLY_TRAP = 4;
export const MUSE_WAN_POLYMORPH = 5;
export const MUSE_POT_SPEED = 6;
export const MUSE_WAN_SPEED_MONSTER = 7;
export const MUSE_BULLWHIP = 8;
export const MUSE_POT_POLYMORPH = 9;
export const MUSE_BAG = 10;

/* ------------------------------------------------------------------------ *
 * Local copies of trivial C macros / predicates.
 *
 * Deliberately NOT imported from monmove.js where a local copy is one line:
 * that module imports this one, and an import cycle through a `const` arrow
 * function is a temporal-dead-zone crash waiting to happen.
 * ------------------------------------------------------------------------ */
const dist2 = (x0, y0, x1, y1) => (x0 - x1) * (x0 - x1) + (y0 - y1) * (y0 - y1);
const distmin = (x0, y0, x1, y1) => Math.max(Math.abs(x0 - x1), Math.abs(y0 - y1));
const sgn = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
// C ref: include/hack.h:1477/1490 — BZ_OFS_WAN(otyp) and the monster-wand ray
// type window (-39..-30), which is what makes dobuzz() take its type<0 arms.
const BZ_OFS_WAN_MUSE = (otyp) => Math.abs(otyp - 429 /*WAN_MAGIC_MISSILE*/) % 10;
const BZ_M_WAND = (bztyp) => (-30 - bztyp);
// C ref: hack.h mdistu(mon) == dist2(mon->mx, mon->my, u.ux, u.uy).
const mdistu = (mon) => dist2(mon.mx, mon.my, game.u?.ux ?? 0, game.u?.uy ?? 0);
const u_at = (x, y) => game.u?.ux === x && game.u?.uy === y;
const levl_at = (x, y) => game.level?.at(x, y) ?? null;
const levl_typ = (x, y) => levl_at(x, y)?.typ;

// C ref: mkobj.c sobj_at(otyp, x, y).  NOT js/invent.js's sobj_at: that one
// indexes game.level.objects as a 2-D `[x][y]` grid, but place_object() keeps
// it as a FLAT push-ordered array, so it returned null for every square and
// silently disabled all four boulder guards plus the undead-turning corpse
// test below.  All uses here are boolean, so pile order doesn't matter.
function sobj_at(otyp, x, y) {
    for (const o of objectsAt(x, y)) if (o.otyp === otyp) return o;
    return null;
}

// C ref: mon.c m_at(x, y).
function m_at(x, y) {
    for (const mon of monsterList())
        if (!DEADMONSTER(mon) && mon.mx === x && mon.my === y) return mon;
    return null;
}
// C ref: display.c canseemon(mon).
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
// C ref: display.c canspotmon(mon) == canseemon(mon) || sensemon(mon).
// sensemon() needs telepathy / warning / extended monster detection, none of
// which the hero has in the recorded sessions, so it reduces to canseemon().
function canspotmon(mtmp) { return canseemon(mtmp); }
// C ref: display.c sensemon(mon) — see canspotmon().
function sensemon(_mtmp) { return false; }
// C ref: hack.h Deaf / Blind / Hallucination.
function Deaf() { return !!game.u?.Deaf; }
function Blind() { return !!game.u?.Blinded || !!game.u?.ublindf; }
function Hallucination() { return !!game.u?.Hallucination; }
// C ref: You_hear() — suppressed entirely when the hero is deaf.
async function You_hear(msg) { if (!Deaf()) await update_topl(`You hear ${msg}`); }

// C ref: objnam.c singular(otmp, doname) — name the stack as if quan were 1.
function singular_doname(obj) {
    const saved = obj.quan;
    obj.quan = 1;
    try { return obj_doname(obj); } finally { obj.quan = saved; }
}
// C ref: objnam.c an().
function an(s) { return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`; }
// C ref: objnam.c the().
function the_(s) { return /^[A-Z]/.test(s) ? s : `the ${s}`; }
// C ref: hacklib.c s_suffix() / upstart().
function s_suffix(s) { return /s$/.test(s) ? `${s}'` : `${s}'s`; }
function upstart(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
// C ref: mon.c mhe()/mhim() — the port models no monster gender, and every
// caller here is a fallback for an unseen monster, so use C's neuter forms.
function mhe(mtmp) { return mtmp?.female ? 'she' : 'he'; }
function mhim(mtmp) { return mtmp?.female ? 'her' : 'him'; }
// C ref: mondata.h locomotion(ptr, def) — the "jump"/"move" verb for a species
// that cannot walk.  Ported in monmove.js for its own messages; the shapes that
// reach the muse messages below all walk, so the default verb is correct.
function locomotion(ptr, def) {
    if (!ptr) return def;
    if ((mflags1_of(ptr) & M1_NOLIMBS) !== 0) return 'slither';
    return def;
}
// C ref: hacklib.c vtense(subj, verb) with fakename[0] ("player") as the
// subject: always the third-person singular form.
function vtense_s(verb) {
    if (/[sxz]$/.test(verb) || /(ch|sh)$/.test(verb)) return `${verb}es`;
    if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ies`;
    return `${verb}s`;
}
// C ref: trap.c trapname(ttyp, generic).
const TRAPNAMES = {
    [PIT]: 'pit', [HOLE]: 'hole', [TRAPDOOR]: 'trap door',
    [TELEP_TRAP]: 'teleportation trap', [POLY_TRAP]: 'polymorph trap',
    [FIRE_TRAP]: 'fire trap', [WEB]: 'web', [BEAR_TRAP]: 'bear trap',
};
function trapname(ttyp) { return TRAPNAMES[ttyp] ?? 'trap'; }

// C ref: mondata.h is_floater(ptr) — eyes/spheres and lights hover, so a wand
// of digging is useless to them.
function is_floater(ptr) { return ptr?.mcls === S_EYE || ptr?.mcls === S_LIGHT; }
// C ref: mondata.h is_flyer(ptr) — only used to pick "dives"/"falls" below.
function is_flyer(ptr) { return ptr?.mcls === S_EYE || ptr?.mcls === S_LIGHT; }
// C ref: mondata.h needspick(ptr) == (mflags1 & M1_NEEDPICK).
function needspick(ptr) { return (mflags1_of(ptr) & M1_NEEDPICK) !== 0; }
// C ref: mondata.h passes_walls / amorphous / unsolid / noncorporeal / haseyes
// / verysmall / throws_rocks.
function passes_walls(ptr) { return (mflags1_of(ptr) & M1_WALLWALK) !== 0; }
function amorphous(ptr) { return (mflags1_of(ptr) & M1_AMORPHOUS) !== 0; }
function unsolid(ptr) { return (mflags1_of(ptr) & M1_UNSOLID) !== 0; }
function noncorporeal(ptr) { return ptr?.mcls === S_GHOST; }
function haseyes(ptr) { return (mflags1_of(ptr) & M1_NOEYES) === 0; }
function verysmall(ptr) { return (ptr?.msize | 0) < MZ_SMALL; }
function throws_rocks(ptr) { return !!ptr?.throws_rocks; }
// C ref: mondata.h is_unicorn(ptr) == (mlet == S_UNICORN && likes_gems(ptr)).
function is_unicorn(ptr) {
    return ptr?.mcls === S_UNICORN && (mflags2_of(ptr) & M2_JEWELS) !== 0;
}
// C ref: mondata.h is_mercenary(ptr) == (mflags2 & M2_MERC).
function is_mercenary(ptr) { return (mflags2_of(ptr) & M2_MERC) !== 0; }
// C ref: mondata.h is_undead(ptr) == (mflags2 & M2_UNDEAD).
function is_undead(ptr) { return (mflags2_of(ptr) & M2_UNDEAD) !== 0; }
// C ref: mondata.h nonliving(ptr) = is_undead || PM_MANES || weirdnonliving
// [is_golem || mlet == S_VORTEX].
function nonliving(ptr) {
    if (!ptr) return false;
    if (is_undead(ptr)) return true;
    if (ptr.name === 'manes') return true;
    return ptr.mcls === S_GOLEM || ptr.mcls === S_VORTEX;
}
// C ref: monst.h is_vampshifter(mon).
function is_vampshifter(mon) {
    const nm = monster_by_pmidx(mon?.cham ?? NON_PM)?.name;
    return nm === 'vampire' || nm === 'vampire leader'
        || nm === 'Vlad the Impaler';
}
// C ref: monst.h resists_ston(mon) — species bit only (see js/mon.js for why
// the acquired sources are not modeled).
function resists_ston(mon) {
    return ((mon?.data?.mresists ?? 0) & MR_STONE_BIT) !== 0;
}
// C ref: mondata.h poly_when_stoned(ptr) — a stoning victim that turns into a
// stone golem instead of dying.  Only the flesh golem / clay+etc. golems do.
function poly_when_stoned(ptr) {
    return ptr?.mcls === S_GOLEM && ptr?.name !== 'stone golem';
}
// C ref: mondata.h touch_petrifies(ptr) / acidic(ptr) / is_lizard.
function touch_petrifies_pm(corpsenm) {
    const nm = monster_by_pmidx(corpsenm)?.name;
    return nm === 'cockatrice' || nm === 'chickatrice';
}
function acidic_pm(corpsenm) {
    return (mflags1_of(monster_by_pmidx(corpsenm)) & M1_ACID) !== 0;
}
function is_lizard_pm(corpsenm) {
    return monster_by_pmidx(corpsenm)?.name === 'lizard';
}
// C ref: mondata.h slimeproof(ptr) = flaming(ptr) || noncorporeal(ptr)
// || ptr == &mons[PM_GREEN_SLIME].
function slimeproof(ptr) {
    if (!ptr) return false;
    if (ptr.name === 'green slime') return true;
    if (ptr.name === 'ghost' || ptr.name === 'shade') return true;
    return ptr.name === 'fire elemental' || ptr.name === 'fire vortex'
        || ptr.name === 'flaming sphere' || ptr.name === 'salamander';
}
// C ref: mon.c can_blow(mtmp) — can it blow a horn?
function can_blow(mtmp) {
    const ptr = mtmp.data;
    const silent = (msound_of(ptr) === MS_SILENT) || (msound_of(ptr) === MS_BUZZ);
    const breathless = (mflags1_of(ptr) & M1_BREATHLESS) !== 0;
    const headless = (mflags1_of(ptr) & M1_NOHEAD) !== 0;
    if (silent && (breathless || verysmall(ptr) || headless || ptr?.mcls === S_EEL))
        return false;
    return true;
}
// C ref: mon.c mwelded(otmp).
function mwelded_obj(o) {
    return !!o && ((o.owornmask || 0) & W_WEP_BIT) !== 0 && !!o.cursed;
}
// C ref: monst.h MON_WEP(mon).
function MON_WEP(mon) { return mon?.mw || null; }
// C ref: worn.c which_armor(mon, slot).
function which_armor(mon, slot) {
    for (const o of (mon?.minvent || []))
        if (((o.owornmask || 0) & slot) !== 0) return o;
    return null;
}
// C ref: monst.h m_seenres(mon, bit) — has this monster watched the hero
// shrug off that damage type?
function m_seenres(mon, bit) { return ((mon?.seen_resistance | 0) & bit) !== 0; }
// C ref: objclass.h Is_container(o) == (otyp >= LARGE_BOX && otyp <= BAG_OF_TRICKS).
// mkobj.js has a private copy of this; mirror it off the same two exports so the
// bound can never drift from the table it indexes.
function is_container_otyp(otyp) {
    return otyp >= LARGE_BOX && otyp <= BAG_OF_TRICKS;
}
// C ref: objclass.h Is_mbag(o) / Has_contents(o) / SchroedingersBox(o).
function is_mbag(obj) {
    return obj.otyp === OT().BAG_OF_HOLDING || obj.otyp === OT().BAG_OF_TRICKS;
}
function has_contents(obj) { return !!(obj?.cobj && obj.cobj.length); }
function SchroedingersBox(obj) {
    // C: (o)->otyp == LARGE_BOX && (o)->spe == 1 — the bones-file cat box.  No
    // level this port generates makes one, but the test costs nothing.
    return obj?.otyp === LARGE_BOX && (obj?.spe | 0) === 1;
}
// C ref: obj.h hard_helmet(o) — a metal/hard helm that blocks falling rock.
function hard_helmet(obj) {
    if (!obj) return false;
    const nm = OBJECTS[obj.otyp]?.name || '';
    return /helmet|helm$|dwarvish iron helm|orcish helm|dented pot/.test(nm);
}
// C ref: hack.h Sokoban.
function Sokoban() {
    return game.sokoban_dnum != null && game.u?.uz?.dnum === game.sokoban_dnum;
}
// C ref: dungeon.h Can_dig_down(lev) — !level.flags.hardfloor.
function Can_dig_down(_uz) { return !game.level?.flags?.hardfloor; }
// C ref: monst.h is_Vlad(mon) / dungeon.h In_V_tower(lev).
function is_Vlad(mon) { return mon?.data?.name === 'Vlad the Impaler'; }
function In_V_tower(_uz) { return false; }
// C ref: dungeon.c On_W_tower_level() — the Wizard's tower; never reached by a
// scored session, and the port has no wizard-tower level flag to read.
function On_W_tower_level(_uz) { return false; }
// C ref: mon.c mon_has_amulet(mon) — the real Amulet of Yendor in minvent.
function mon_has_amulet(mon) {
    const AMULET_OF_YENDOR = OBJECTS.findIndex((o) => o && o.sym === 'AMULET_OF_YENDOR');
    return (mon?.minvent || []).some((o) => o.otyp === AMULET_OF_YENDOR);
}
// C ref: mon.c mon_has_special(mon) — Amulet, invocation tool or a quest
// artifact.  mon_has_amulet() covers the only one this port creates.
function mon_has_special(mon) { return mon_has_amulet(mon); }
// C ref: mon.c helpless(mon).
function helpless(mon) {
    return !!(mon.msleeping || !mon.mcanmove || (mon.mfrozen | 0) > 0);
}
// C ref: shk.c inhishop(shkp) — modelled in monmove.js for shk_move; the muse
// callers only need "is a shopkeeper standing in its own shop", and every
// shopkeeper in the corpus is inside its shop when it acts.
function inhishop(shkp) { return !!shkp.isshk; }
// C ref: hack.h noteleport_level(mon).  This local copy read ONLY the level
// flag, so it answered FALSE inside Gehennom's demon court, where C's version
// returns TRUE for anyone who is not a demon lord/prince.  rnd_defensive_item()
// (muse.c:1235) restarts its whole switch on that answer, so getting it wrong
// costs an rn2 and picks a different item (seed0360 step 307).
// C ref: teleport.c random_teleport_level() — see js/do.c's copy for the hero.
// A monster reading a cursed teleport scroll needs the same depth roll.
function random_teleport_level() {
    const cur_depth = game.u?.uz?.dlevel ?? 1;
    const max_depth = cur_depth + (In_endgame(game.u?.uz) ? 5 : 3);
    const min_depth = In_endgame(game.u?.uz) ? cur_depth : 1;
    const nlev = rn2(max_depth - min_depth + 1) + min_depth;
    return nlev;
}
// C ref: do.c Can_rise_up(x, y, lev) — is there a level above to rise to?
function Can_rise_up(_x, _y, uz) { return (uz?.dlevel ?? 1) > 1; }
// C ref: hack.h Is_rogue_level / Is_earthlevel — neither is reachable in the
// scored dungeon slice and the port has no level flag for either.
function Is_rogue_level(_uz) { return false; }
function Is_earthlevel(_uz) { return false; }
// C ref: mkobj.c weight(obj) — only needed to refresh a container's owt after
// a failed take-out, which no screen renders; keep the field consistent.
function container_weight(container) {
    let w = OBJECTS[container.otyp]?.oc_weight ?? 0;
    for (const o of (container.cobj || []))
        w += (OBJECTS[o.otyp]?.oc_weight ?? 0) * (o.quan || 1);
    return w;
}

/* ------------------------------------------------------------------------ *
 * muse.c:2938 / obj bookkeeping
 * ------------------------------------------------------------------------ */

// C ref: mon.c m_useup(mon, obj) — consume one of the stack.
export function m_useup(mtmp, obj) {
    if ((obj.quan ?? 1) > 1) { obj.quan -= 1; return; }
    extract_from_minvent(mtmp, obj);
}
// C ref: mon.c extract_from_minvent() — unlink without destroying.
function extract_from_minvent(mtmp, obj) {
    const inv = mtmp.minvent || [];
    const i = inv.indexOf(obj);
    if (i >= 0) inv.splice(i, 1);
    if (obj === mtmp.mw) mtmp.mw = null;
    obj.owornmask = 0;
}
// C ref: invent.c splitobj(obj, num) — peel `num` off a stack.
function m_splitobj(obj, num) {
    const copy = { ...obj, quan: num };
    obj.quan = (obj.quan || 1) - num;
    return copy;
}
// C ref: do.c canletgo(obj, word) — the muse callers pass "" so no message is
// ever printed; only the yes/no answer matters.
function canletgo(obj) {
    if (!obj) return false;
    const worn = obj.owornmask || 0;
    // C: `obj->owornmask & (W_ARMOR | W_ACCESSORY)`.  These must be the bits
    // js/invent.js actually stamps on a HERO object, not the prop.h values:
    // the local W_AMUL literal here was 0x100, which is invent.js's W_WEP, so
    // canletgo() answered FALSE for every wielded weapon and the bullwhip
    // disarm (find_misc MUSE_BULLWHIP) could never fire.
    if ((worn & (W_ARMOR_WORN | W_ACCESSORY_WORN)) !== 0)
        return false;
    if (obj === game.uwep && welded_hero(obj)) return false;
    if (obj === game.u?.uball || obj === game.u?.uchain) return false;
    return true;
}
// C ref: wield.c welded(obj) — hero's cursed wielded weapon.  uwep is on
// `game`, not `game.u`; the old read made every weapon un-welded, so a bullwhip
// yanked a cursed weapon C leaves stuck ("The whip slips free.").
function welded_hero(obj) {
    return !!obj && obj === game.uwep && !!obj.cursed
        && OBJECTS[obj.otyp]?.oclass === WEAPON_CLASS;
}
// C ref: obj.h bimanual(obj).
function bimanual(obj) { return !!OBJECTS[obj?.otyp]?.bimanual; }
// C ref: objnam.c is_plural(obj).
function obj_is_plural(obj) { return (obj?.quan || 1) > 1; }
// C ref: objclass.h bcsign(obj).
function bcsign(obj) { return (obj?.blessed ? 1 : 0) - (obj?.cursed ? 1 : 0); }
// C ref: potion.c unbless(obj).
function unbless(obj) { obj.blessed = 0; obj.bknown = 0; }
// C ref: objnam.c exclam(force).
function exclam(force) { return force > 5 ? '!' : '.'; }

/* ------------------------------------------------------------------------ *
 * muse.c:58 precheck()
 *
 * Preliminary checks which may stop the monster from using the item at all.
 * Returns 0 nothing happened, 1 monster died, 2 monster can't act further.
 * ------------------------------------------------------------------------ */
async function precheck(mon, obj) {
    if (!obj) return 0;
    const vis = !!cansee(mon.mx, mon.my);

    if (obj.oclass === POTION_CLASS) {
        // C: a "milky" potion may hold a ghost and a "smoky" one a djinni.
        // The rn2(POTION_OCCUPANT_CHANCE(born)) rolls only fire when the
        // shuffled appearance matches AND the species isn't extinct, so a
        // monster quaffing any other potion draws nothing here.
        if (objdescr_is(obj, 'milky') && !mvitals_gone('ghost')
            && !rn2(POTION_OCCUPANT_CHANCE(mvitals_born('ghost')))) {
            // C then calls enexto()/makemon()/paralyze_monst(); makemon() for a
            // named species is not something this port can place mid-turn
            // without the level's monster-arrival path, so stop here rather
            // than half-create a ghost.  The two rolls above have happened,
            // which is what the PRNG cares about.
            return 0;
        }
        if (objdescr_is(obj, 'smoky') && !mvitals_gone('djinni')
            && !rn2(POTION_OCCUPANT_CHANCE(mvitals_born('djinni')))) {
            return 0; /* see the milky comment above */
        }
    }
    if (obj.oclass === WAND_CLASS && obj.cursed && !rn2(WAND_BACKFIRE_CHANCE)) {
        const dam = d((obj.spe | 0) + 2, 6);

        if (vis) {
            await update_topl(
                `${Monnam(mon)} zaps ${an(xname(obj))}, which suddenly explodes!`);
        } else {
            /* same near/far threshold as mzapwand() */
            const range = couldsee(mon.mx, mon.my) ? (BOLT_LIM + 1) : (BOLT_LIM - 3);
            await You_hear(`a zap and an explosion ${
                (mdistu(mon) <= range * range) ? 'nearby' : 'in the distance'}.`);
        }
        m_useup(mon, obj);
        mon.mhp -= dam;
        if (DEADMONSTER(mon)) {
            await monkilled(mon);
            return 1;
        }
        m.has_defense = m.has_offense = m.has_misc = 0;
    }
    return 0;
}

// C ref: objnam.c objdescr_is(obj, descr) — compare the SHUFFLED appearance.
function objdescr_is(obj, descr) {
    const idx = OBJECTS[obj?.otyp]?.oc_descr_idx;
    if (idx == null) return false;
    return DESCR_FOR(idx) === descr;
}
let DESCR_TABLE = null;
function DESCR_FOR(idx) {
    if (!DESCR_TABLE) DESCR_TABLE = descr_table_sync();
    return DESCR_TABLE?.[idx] ?? null;
}
// globalThis.__NH_DESCR_BY_OTYP was never assigned anywhere, so objdescr_is()
// answered FALSE for every appearance and precheck()'s milky/smoky rn2 rolls
// never fired.  o_descr_data.js is pure data with no cycle back to muse.
function descr_table_sync() {
    return DESCR_BY_OTYP;
}
// C ref: mon.c mvitals[].mvflags & G_GONE / mvitals[].born.
function mvitals_gone(name) {
    const idx = pm_index_by_name(name);
    const G_GONE = 0x03; /* G_GENOD | G_EXTINCT (monflag.h) */
    return idx < 0 || (((game.mvitals?.[idx]?.mvflags) | 0) & G_GONE) !== 0;
}
function mvitals_born(name) {
    const idx = pm_index_by_name(name);
    return idx < 0 ? 0 : ((game.mvitals?.[idx]?.born) | 0);
}
let PM_BY_NAME = null;
function pm_index_by_name(name) {
    if (!PM_BY_NAME) {
        PM_BY_NAME = new Map();
        for (let i = 0; ; i++) {
            const p = monster_by_pmidx(i);
            if (!p) break;
            if (!PM_BY_NAME.has(p.name)) PM_BY_NAME.set(p.name, i);
        }
    }
    return PM_BY_NAME.get(name) ?? -1;
}

// C ref: mon.c monkilled(mon, fltxt, how) — the muse callers pass an empty
// message, so this is just "remove the corpse-less monster from the level".
async function monkilled(mon) {
    if (canseemon(mon)) await update_topl(`${Monnam(mon)} is killed!`);
    await mondead(mon);
}
// C ref: mon.c mondead(mon) — take it off the map.  Corpse-leaving and the
// experience/alignment bookkeeping belong to mon.c's own port; muse only needs
// the monster gone so the map and the movemon loop agree.
async function mondead(mon) {
    mon.mhp = 0;
    relmon(mon);
    newsym(mon.mx, mon.my);
}
// C ref: mon.c relmon() + mon_leaving_level() — unlink from the level's
// monster chain.  migrate_to_level() below is the same operation as far as
// this level's screen is concerned (the monster reappears on another level,
// which no scored screen of this level can show).
function relmon(mon) {
    const list = game.level?.monsters;
    if (!list) return;
    const i = list.indexOf(mon);
    if (i >= 0) list.splice(i, 1);
    if (game.u?.ustuck === mon) game.u.ustuck = null;
    mon.mtrapped = 0;
}
// C ref: dog.c migrate_to_level(mtmp, tolev, xyloc, cc).  Draws no RNG.
function migrate_to_level(mtmp) {
    const mx = mtmp.mx, my = mtmp.my;
    relmon(mtmp);
    mtmp.mlstmv = game.moves;
    newsym(mx, my);
}
// C ref: mon.c mongone(mtmp) — monster leaves without dying (no corpse).
function mongone(mtmp) {
    const mx = mtmp.mx, my = mtmp.my;
    relmon(mtmp);
    newsym(mx, my);
}

/* ------------------------------------------------------------------------ *
 * muse.c:164 mzapwand / :194 mplayhorn / :237 mreadmsg / :292 mquaffmsg
 * ------------------------------------------------------------------------ */

async function mzapwand(mtmp, otmp, self) {
    if ((otmp.spe | 0) < 1) return; /* C: impossible() */
    if (!canseemon(mtmp)) {
        const range = couldsee(mtmp.mx, mtmp.my) ? (BOLT_LIM + 1) : (BOLT_LIM - 3);
        await You_hear(`a ${(mdistu(mtmp) <= range * range) ? 'nearby' : 'distant'} zap.`);
        // C: unknow_object(otmp) — the hero loses the charge count of an unseen
        // wand.  The port does not track remembered charge counts.
    } else if (self) {
        // C: monverbself(mtmp, Monnam, "zap", 0) => "<Mon> zaps himself".
        await update_topl(`${Monnam(mtmp)} zaps ${mhim(mtmp)}self with ${obj_doname(otmp)}!`);
    } else {
        await update_topl(`${Monnam(mtmp)} zaps ${an(xname(otmp))}!`);
        stop_occupation();
    }
    otmp.spe -= 1;
}

async function mplayhorn(mtmp, otmp, self) {
    if (!canseemon(mtmp)) {
        const range = couldsee(mtmp.mx, mtmp.my) ? (BOLT_LIM + 1) : (BOLT_LIM - 3);
        await You_hear(`a horn being played ${
            (mdistu(mtmp) <= range * range) ? 'nearby' : 'in the distance'}.`);
    } else if (self) {
        observe_object(otmp);
        await update_topl(
            `${Monnam(mtmp)} plays a ${xname(otmp)} directed at ${mhim(mtmp)}self!`);
        makeknown(otmp.otyp);
    } else {
        observe_object(otmp);
        await update_topl(
            `${Monnam(mtmp)} plays ${an(xname(otmp))} directed at you!`);
        makeknown(otmp.otyp);
        stop_occupation();
    }
    otmp.spe -= 1;
}

// C ref: muse.c:237 mreadmsg().  When the scroll isn't seen but is heard, C
// builds the "You hear <mon> reading <scroll>" line via x_monnam(); the port's
// x_monnam lives in uhitm.js and is imported by name below via Monnam/mon_nam,
// so the unseen branch uses mon_nam()'s article-less form.
async function mreadmsg(mtmp, otmp) {
    const vismon = canseemon(mtmp);
    if (!vismon && Deaf()) return; /* no feedback */

    observe_object(otmp); /* seeing/hearing a scroll read reveals its label */
    const onambuf = vismon ? singular_doname(otmp) : an(xname(otmp));

    if (vismon) {
        await update_topl(`${Monnam(mtmp)} reads ${onambuf}!`);
    } else {
        if (!sensemon(mtmp) && couldsee(mtmp.mx, mtmp.my)
            && mdistu(mtmp) <= 10 * 10)
            map_invisible(mtmp.mx, mtmp.my);
        let blindbuf = `reading ${onambuf}`;
        blindbuf = blindbuf.replace('reading a scroll labeled',
            mtmp.mconf ? 'attempting to incant' : 'incant');
        await You_hear(`${mon_nam(mtmp)} ${blindbuf}.`);
    }
    if (mtmp.mconf)
        await update_topl(`Being confused, ${
            vismon ? mon_nam(mtmp) : mhe(mtmp)} mispronounces the magic words...`);
}

async function mquaffmsg(mtmp, otmp) {
    if (canseemon(mtmp)) {
        observe_object(otmp);
        await update_topl(`${Monnam(mtmp)} drinks ${singular_doname(otmp)}!`);
    } else if (!Deaf()) {
        await update_topl('You hear a chugging sound.');
    }
}

// C ref: allmain.c stop_occupation() — cancels a multi-turn hero activity.
// go.occupation is owned by allmain.js; muse only needs the flag cleared.
function stop_occupation() {
    if (game.occupation) game.occupation = null;
    if (game.multi > 0) game.multi = 0;
}

/* ------------------------------------------------------------------------ *
 * muse.c:336 m_use_healing / :360 m_sees_sleepy_soldier / :383 m_tele
 * / :419 m_next2m
 * ------------------------------------------------------------------------ */

function m_use_healing(mtmp) {
    let obj;
    if ((obj = m_carrying(mtmp, OT().POT_FULL_HEALING)) != null) {
        m.defensive = obj; m.has_defense = MUSE_POT_FULL_HEALING; return true;
    }
    if ((obj = m_carrying(mtmp, OT().POT_EXTRA_HEALING)) != null) {
        m.defensive = obj; m.has_defense = MUSE_POT_EXTRA_HEALING; return true;
    }
    if ((obj = m_carrying(mtmp, OT().POT_HEALING)) != null) {
        m.defensive = obj; m.has_defense = MUSE_POT_HEALING; return true;
    }
    return false;
}

function m_sees_sleepy_soldier(mtmp) {
    const x = mtmp.mx, y = mtmp.my;
    for (let xx = x - 3; xx <= x + 3; xx++)
        for (let yy = y - 3; yy <= y + 3; yy++) {
            if (!isok(xx, yy) || (xx === x && yy === y)) continue;
            const mon = m_at(xx, yy);
            if (mon && is_mercenary(mon.data) && mon.data?.name !== 'watchman'
                && mon.data?.name !== 'guard' && helpless(mon))
                return true;
        }
    return false;
}

async function m_tele(mtmp, vismon, oseen, how) {
    if (await tele_restrict(mtmp)) { /* mysterious force... */
        if (vismon && how) makeknown(how);
        if (noteleport_level(mtmp)) mon_learns_traps(mtmp, TELEP_TRAP);
    } else if ((mon_has_amulet(mtmp) || On_W_tower_level(game.u?.uz)) && !rn2(3)) {
        if (vismon)
            await update_topl(`${Monnam(mtmp)} seems disoriented for a moment.`);
    } else if (how) {
        /* teleportation has been triggered by an object */
        if (oseen) makeknown(how);
        await rloc(mtmp, RLOC_MSG);
    } else {
        /* monster is voluntarily entering a teleportation trap */
        mtmp.mx = gt.trapx; mtmp.my = gt.trapy;
        await mon_mintrap(mtmp);
    }
}

function m_next2m(mtmp) {
    if (DEADMONSTER(mtmp)) return false;
    for (let x = mtmp.mx - 1; x <= mtmp.mx + 1; x++)
        for (let y = mtmp.my - 1; y <= mtmp.my + 1; y++) {
            if (!isok(x, y)) continue;
            const m2 = m_at(x, y);
            if (m2 && m2 !== mtmp) return true;
        }
    return false;
}

// C ref: mkobj.c:2648 add_to_minv() — a monster's minvent CHAIN is newest-first
// (each pickup is prepended).  Our minvent array is append-ordered, so every
// muse.c scan that walks `mtmp->minvent` and keeps the FIRST/LAST match has to
// read it backwards; walking it forwards makes a shopkeeper quaff its oldest
// healing potion where C quaffs the newest (w3-human-knight-debug step 135).
// Same inversion as monmove.js objPileAt()/invent.js objects_at() apply to the
// floor `nexthere` chain.
function m_chain(mtmp) {
    const inv = mtmp?.minvent;
    if (!inv || inv.length < 2) return inv || [];
    const out = new Array(inv.length);
    for (let i = 0, n = inv.length; i < n; i++) out[i] = inv[n - 1 - i];
    return out;
}

/* ------------------------------------------------------------------------ *
 * muse.c:440 find_defensive(mtmp, tryescape)
 *
 * The only RNG in here is `if (gm.m.has_defense && !rn2(3)) break;` at the top
 * of the inventory loop, plus the `rn2(3)` guarding a confused monster's lizard
 * TIN.  Both sit behind gates that an undamaged, unconfused monster fails, so
 * the overwhelming majority of monsters leave this function without drawing.
 * ------------------------------------------------------------------------ */
export function find_defensive(mtmp, tryescape) {
    const x = mtmp.mx, y = mtmp.my;
    const stuck = (mtmp === game.u?.ustuck);
    const immobile = !base_mmove(mtmp);
    let obj, t;

    m.defensive = null;
    m.has_defense = 0;

    if (is_animal(mtmp.data) || mindless(mtmp.data)) return false;
    if (!tryescape && dist2(x, y, mtmp.mux ?? 0, mtmp.muy ?? 0) > 25) return false;
    if (tryescape && Is_knox_level(game.u?.uz) && !m_next2u(mtmp) && m_next2m(mtmp))
        return false;
    if (game.u?.uswallow && stuck) return false;

    /*
     * Since unicorn horns don't get used up, the monster would look silly
     * trying to use the same cursed horn round after round, so skip cursed
     * unicorn horns.  Unicorns use their own horns; they're excluded from
     * inventory scanning by nohands().  Ki-rin gets to use its horn too.
     */
    if (mtmp.mconf || mtmp.mstun || !mtmp.mcansee) {
        obj = null;
        if (!nohands(mtmp.data)) {
            for (const o of m_chain(mtmp))
                if (o.otyp === OT().UNICORN_HORN && !o.cursed) { obj = o; break; }
        }
        if (obj || is_unicorn(mtmp.data) || mtmp.data?.name === 'ki-rin') {
            m.defensive = obj;
            m.has_defense = MUSE_UNICORN_HORN;
            return true;
        }
    }

    if (mtmp.mconf || mtmp.mstun) {
        let liztin = null;
        for (const o of m_chain(mtmp)) {
            if (o.otyp === OT().CORPSE && is_lizard_pm(o.corpsenm)) {
                m.defensive = o; m.has_defense = MUSE_LIZARD_CORPSE;
                return true;
            } else if (o.otyp === OT().TIN && is_lizard_pm(o.corpsenm)) {
                liztin = o;
            }
        }
        /* confused or stunned monster might not be able to open tin */
        if (liztin && mcould_eat_tin(mtmp) && rn2(3)) {
            m.defensive = liztin;
            /* tin and corpse ultimately end up being handled the same */
            m.has_defense = MUSE_LIZARD_CORPSE;
            return true;
        }
    }

    /* blind monster: healing cures blindness.  Pestilence won't use healing. */
    if (!mtmp.mcansee && !nohands(mtmp.data)
        && mtmp.data?.name !== 'Pestilence') {
        if (m_use_healing(mtmp)) return true;
    }

    /* monsters aren't given wands of undead turning but if they happen to
       have picked one up, use it against a corpse-wielding hero */
    const uwep = game.uwep; /* worn/wielded slots live on `game` */
    if (!mtmp.mpeaceful && !nohands(mtmp.data)
        && uwep && uwep.otyp === OT().CORPSE
        && touch_petrifies_pm(uwep.corpsenm)
        && !poly_when_stoned(mtmp.data) && !resists_ston(mtmp)
        && m_lined_up(mtmp)) {
        for (const o of m_chain(mtmp))
            if (o.otyp === OT().WAN_UNDEAD_TURNING && (o.spe | 0) > 0) {
                m.defensive = o; m.has_defense = MUSE_WAN_UNDEAD_TURNING;
                return true;
            }
    }

    if (!tryescape) {
        /* do we try to heal? */
        const ulevel = game.u?.ulevel ?? 1;
        const fraction = ulevel < 10 ? 5 : ulevel < 14 ? 4 : 3;
        if (mtmp.mhp >= mtmp.mhpmax
            || (mtmp.mhp >= 10 && mtmp.mhp * fraction >= mtmp.mhpmax))
            return false;

        if (mtmp.mpeaceful) {
            if (!nohands(mtmp.data)) {
                if (m_use_healing(mtmp)) return true;
            }
            return false;
        }
    }

    if (stuck || immobile || mtmp.mtrapped) {
        /* fleeing by stairs or traps is not possible */
    } else if (levl_typ(x, y) === STAIRS) {
        const stway = stairway_here(x, y);
        if (stway && !stway.up && stway.dnum === game.u?.uz?.dnum) {
            if (!is_floater(mtmp.data)) m.has_defense = MUSE_DOWNSTAIRS;
        } else if (stway && stway.up && stway.dnum === game.u?.uz?.dnum) {
            m.has_defense = MUSE_UPSTAIRS;
        } else if (stway && stway.dnum !== game.u?.uz?.dnum) {
            if (stway.up || !is_floater(mtmp.data)) m.has_defense = MUSE_SSTAIRS;
        }
    } else if (levl_typ(x, y) === LADDER) {
        const stway = stairway_here(x, y);
        if (stway && stway.up && stway.dnum === game.u?.uz?.dnum) {
            m.has_defense = MUSE_UP_LADDER;
        } else if (stway && !stway.up && stway.dnum === game.u?.uz?.dnum) {
            if (!is_floater(mtmp.data)) m.has_defense = MUSE_DN_LADDER;
        } else if (stway && stway.dnum !== game.u?.uz?.dnum) {
            if (stway.up || !is_floater(mtmp.data)) m.has_defense = MUSE_SSTAIRS;
        }
    } else {
        /* Note: trap doors take precedence over teleport traps. */
        const ignore_boulders = (verysmall(mtmp.data) || throws_rocks(mtmp.data)
                                 || passes_walls(mtmp.data));
        const diag_ok = !NODIAG(mtmp.data);
        const locs = [[x, y]];
        for (let xx = x - 1; xx <= x + 1; xx++)
            for (let yy = y - 1; yy <= y + 1; yy++)
                if (isok(xx, yy) && (xx !== x || yy !== y)) locs.push([xx, yy]);
        for (const [xx, yy] of locs) {
            /* skip the hero's location, an unreachable diagonal, or a spot
               already occupied by another monster */
            if (u_at(xx, yy)
                || (xx !== x && yy !== y && !diag_ok)
                || (m_at(xx, yy) && !(xx === x && yy === y)))
                continue;
            if ((t = t_at(xx, yy)) == null
                || (!ignore_boulders && sobj_at(BOULDER, xx, yy))
                || onscary(xx, yy, mtmp))
                continue;
            if (is_hole(t.ttyp)
                && !is_floater(mtmp.data)
                && !mtmp.isshk && !mtmp.isgd && !mtmp.ispriest
                && Can_fall_thru(game.u?.uz)) {
                gt.trapx = xx; gt.trapy = yy;
                m.has_defense = MUSE_TRAPDOOR;
                break; /* no need to look at any other spots */
            } else if (t.ttyp === TELEP_TRAP) {
                gt.trapx = xx; gt.trapy = yy;
                m.has_defense = MUSE_TELEPORT_TRAP;
            }
        }
    }

    if (nohands(mtmp.data)) /* can't use objects */
        return !!m.has_defense;

    if (is_mercenary(mtmp.data) && (obj = m_carrying(mtmp, OT().BUGLE)) != null
        && m_sees_sleepy_soldier(mtmp)) {
        m.defensive = obj;
        m.has_defense = MUSE_BUGLE;
    }

    /* use immediate physical escape prior to attempting magic */
    if (m.has_defense) /* stairs, trap door or tele-trap, bugle alert */
        return true;

    /* kludge to cut down on trap destruction (particularly portals) */
    t = t_at(x, y);
    if (t && (is_pit(t.ttyp) || t.ttyp === WEB || t.ttyp === BEAR_TRAP))
        t = null; /* ok for monster to dig here */

    for (const o of m_chain(mtmp)) {
        /* don't always use the same selection pattern */
        if (m.has_defense && !rn2(3)) break;

        /* C: `nomore(MUSE_WAN_DIGGING)` is spelled as a `break` here */
        if (m.has_defense === MUSE_WAN_DIGGING) break;
        if (o.otyp === OT().WAN_DIGGING && (o.spe | 0) > 0 && !stuck && !t
            && !mtmp.isshk && !mtmp.isgd && !mtmp.ispriest
            && !is_floater(mtmp.data)
            && !Sokoban()
            && !((levl_at(x, y)?.wall_info | 0) & W_NONDIGGABLE)
            && !(Is_botlevel(game.u?.uz) || In_endgame(game.u?.uz))
            && !(is_ice(x, y) || is_pool(x, y) || is_lava(x, y))
            && !(is_Vlad(mtmp) && In_V_tower(game.u?.uz))) {
            m.defensive = o; m.has_defense = MUSE_WAN_DIGGING;
        }
        if (m.has_defense === MUSE_WAN_TELEPORTATION_SELF) continue;
        if (m.has_defense === MUSE_WAN_TELEPORTATION) continue;
        if (o.otyp === OT().WAN_TELEPORTATION && (o.spe | 0) > 0) {
            /* the TELEP_TRAP bit records whether the monster has learned that
               teleporting is useless on this level */
            if (!noteleport_level(mtmp) || !mon_knows_traps(mtmp, TELEP_TRAP)) {
                m.defensive = o;
                m.has_defense = mon_has_amulet(mtmp) ? MUSE_WAN_TELEPORTATION
                                                     : MUSE_WAN_TELEPORTATION_SELF;
            }
        }
        if (m.has_defense === MUSE_SCR_TELEPORTATION) continue;
        if (o.otyp === OT().SCR_TELEPORTATION && mtmp.mcansee
            && haseyes(mtmp.data)
            && (!o.cursed || (!(mtmp.isshk && inhishop(mtmp))
                              && !mtmp.isgd && !mtmp.ispriest))) {
            if (!noteleport_level(mtmp) || !mon_knows_traps(mtmp, TELEP_TRAP)) {
                m.defensive = o; m.has_defense = MUSE_SCR_TELEPORTATION;
            }
        }

        if (mtmp.data?.name !== 'Pestilence') {
            if (m.has_defense === MUSE_POT_FULL_HEALING) continue;
            if (o.otyp === OT().POT_FULL_HEALING) {
                m.defensive = o; m.has_defense = MUSE_POT_FULL_HEALING;
            }
            if (m.has_defense === MUSE_POT_EXTRA_HEALING) continue;
            if (o.otyp === OT().POT_EXTRA_HEALING) {
                m.defensive = o; m.has_defense = MUSE_POT_EXTRA_HEALING;
            }
            if (m.has_defense === MUSE_WAN_CREATE_MONSTER) continue;
            if (o.otyp === OT().WAN_CREATE_MONSTER && (o.spe | 0) > 0) {
                m.defensive = o; m.has_defense = MUSE_WAN_CREATE_MONSTER;
            }
            if (m.has_defense === MUSE_POT_HEALING) continue;
            if (o.otyp === OT().POT_HEALING) {
                m.defensive = o; m.has_defense = MUSE_POT_HEALING;
            }
        } else { /* Pestilence */
            if (m.has_defense === MUSE_POT_FULL_HEALING) continue;
            if (o.otyp === OT().POT_SICKNESS) {
                m.defensive = o; m.has_defense = MUSE_POT_FULL_HEALING;
            }
            if (m.has_defense === MUSE_WAN_CREATE_MONSTER) continue;
            if (o.otyp === OT().WAN_CREATE_MONSTER && (o.spe | 0) > 0) {
                m.defensive = o; m.has_defense = MUSE_WAN_CREATE_MONSTER;
            }
        }
        if (m.has_defense === MUSE_SCR_CREATE_MONSTER) continue;
        if (o.otyp === OT().SCR_CREATE_MONSTER) {
            m.defensive = o; m.has_defense = MUSE_SCR_CREATE_MONSTER;
        }
    }
    return !!m.has_defense;
}

// C ref: monsters.h NODIAG(mndx) — grid bugs only.
function NODIAG(ptr) { return ptr?.name === 'grid bug'; }
// C ref: dbridge.c is_ice / is_pool / is_lava.  Every literal here was one off
// the port's own rm.h numbering (const.js): ICE is 33 not 21 (21 is LAVAWALL),
// and POOL/MOAT/WATER are 16/17/18 not 17/18/19 — so is_ice never fired, is_pool
// answered "water" for a drawbridge, and a monster judged whether it could dig
// down through the wrong terrain.  The DB_UNDER (drawbridge-up) arms are the
// same omission dungeon.js documents.
function is_ice(x, y) { return levl_typ(x, y) === ICE; }
function is_pool(x, y) {
    const typ = levl_typ(x, y);
    return typ === POOL || typ === MOAT || typ === WATER;
}
function is_lava(x, y) {
    const typ = levl_typ(x, y);
    return typ === LAVAPOOL || typ === LAVAWALL;
}
// C ref: dungeon.c stairway_at(x, y) — js/display.js has a private copy; this
// one returns the fields find_defensive needs (up flag + destination dnum).
function stairway_here(x, y) {
    for (const s of (game.level?.stairs || [])) {
        if (s.sx === x && s.sy === y)
            return { up: !!s.up, dnum: s.tolev?.dnum ?? game.u?.uz?.dnum,
                     dlevel: s.tolev?.dlevel };
    }
    const up = game.level?.upstair, dn = game.level?.dnstair;
    if (up && up.sx === x && up.sy === y)
        return { up: true, dnum: game.u?.uz?.dnum, dlevel: (game.u?.uz?.dlevel ?? 1) - 1 };
    if (dn && dn.sx === x && dn.sy === y)
        return { up: false, dnum: game.u?.uz?.dnum, dlevel: (game.u?.uz?.dlevel ?? 1) + 1 };
    return null;
}

/* ------------------------------------------------------------------------ *
 * muse.c:756 reveal_trap / :779 mon_escape / :795 use_defensive
 * ------------------------------------------------------------------------ */

function reveal_trap(t, seeit) {
    const lev = levl_at(t.tx, t.ty);
    if (lev && lev.typ === SCORR) { lev.typ = CORR; lev.flags = 0; }
    if (seeit) seetrap(t);
}

async function mon_escape(mtmp, vismon) {
    if (mon_has_special(mtmp) || (mtmp.iswiz && (game.no_of_wizards | 0) < 2))
        return 0;
    if (vismon) await update_topl(`${Monnam(mtmp)} escapes the dungeon!`);
    mongone(mtmp);
    return 2;
}

export async function use_defensive(mtmp) {
    const otmp = m.defensive;
    let i, t;

    if ((i = await precheck(mtmp, otmp)) !== 0) return i;
    const vis = !!cansee(mtmp.mx, mtmp.my);
    const vismon = canseemon(mtmp);
    const oseen = !!otmp && vismon;

    /* when using a defensive choice to run away, we want the monster to avoid
       rushing right straight back; don't override if already scared */
    const fleetim = !mtmp.mflee
        ? (33 - Math.trunc(30 * mtmp.mhp / mtmp.mhpmax)) : 0;
    const m_flee = (mon) => {
        if (fleetim && !mon.iswiz) monflee(mon, fleetim, false, false);
    };

    switch (m.has_defense) {
    case MUSE_UNICORN_HORN:
        /* unlike most defensive cases, the unicorn horn object is optional */
        if (vismon) {
            if (otmp)
                await update_topl(`${Monnam(mtmp)} uses a unicorn horn!`);
            else
                await update_topl(`The tip of ${s_suffix(mon_nam(mtmp))} horn glows!`);
        }
        if (!mtmp.mcansee) {
            await mcureblindness(mtmp, vismon);
        } else if (mtmp.mconf || mtmp.mstun) {
            mtmp.mconf = 0; mtmp.mstun = 0;
            if (vismon) await update_topl(`${Monnam(mtmp)} seems steadier now.`);
        }
        return 2;
    case MUSE_BUGLE:
        if (!otmp) return 0;
        if (vismon) {
            await update_topl(`${Monnam(mtmp)} plays ${obj_doname(otmp)}!`);
        } else if (!Deaf()) {
            await update_topl('You hear a bugle playing reveille!');
        }
        await awaken_soldiers(mtmp);
        return 2;
    case MUSE_WAN_TELEPORTATION_SELF:
        if (!otmp) return 0;
        if ((mtmp.isshk && inhishop(mtmp)) || mtmp.isgd || mtmp.ispriest)
            return 2;
        m_flee(mtmp);
        await mzapwand(mtmp, otmp, true);
        await m_tele(mtmp, vismon, oseen, OT().WAN_TELEPORTATION);
        return 2;
    case MUSE_WAN_TELEPORTATION:
        if (!otmp) return 0;
        zap_oseen = oseen;
        await mzapwand(mtmp, otmp, false);
        m_using = true;
        await mbhit(mtmp, rn1(8, 6), otmp);
        if (noteleport_level(mtmp)) mon_learns_traps(mtmp, TELEP_TRAP);
        m_using = false;
        return 2;
    case MUSE_SCR_TELEPORTATION: {
        if (!otmp) return 0;
        const obj_is_cursed = !!otmp.cursed;
        if (mtmp.isshk || mtmp.isgd || mtmp.ispriest) return 2;
        m_flee(mtmp);
        /* take the scroll out of minvent in advance so it survives the tele */
        let scroll = otmp;
        if ((scroll.quan || 1) > 1) scroll = m_splitobj(scroll, 1);
        else extract_from_minvent(mtmp, scroll);
        await mreadmsg(mtmp, scroll);
        if (obj_is_cursed || mtmp.mconf) {
            const nlev = random_teleport_level();
            if (mon_has_amulet(mtmp) || In_endgame(game.u?.uz)) {
                if (vismon)
                    await update_topl(
                        `${Monnam(mtmp)} seems very disoriented for a moment.`);
            } else if (nlev === (game.u?.uz?.dlevel ?? 1)) {
                if (vismon)
                    await update_topl(`${Monnam(mtmp)} shudders for a moment.`);
            } else {
                migrate_to_level(mtmp);
            }
        } else {
            await m_tele(mtmp, vismon, oseen, OT().SCR_TELEPORTATION);
        }
        if (scroll.dknown) await trycall(scroll);
        return 2;
    }
    case MUSE_WAN_DIGGING:
        if (!otmp) return 0;
        m_flee(mtmp);
        await mzapwand(mtmp, otmp, false);
        if (oseen) makeknown(OT().WAN_DIGGING);
        if (IS_FURNITURE(levl_typ(mtmp.mx, mtmp.my))
            || IS_DRAWBRIDGE(levl_typ(mtmp.mx, mtmp.my))
            || stairway_here(mtmp.mx, mtmp.my)) {
            await update_topl('The digging ray is ineffective.');
            return 2;
        }
        if (!Can_dig_down(game.u?.uz) && !levl_at(mtmp.mx, mtmp.my)?.candig) {
            if (t_at(mtmp.mx, mtmp.my)
                || !(t = await maketrap(mtmp.mx, mtmp.my, PIT))) {
                if (vismon)
                    await update_topl(
                        `The ${surface(mtmp.mx, mtmp.my)} here is too hard to dig in.`);
                return 2;
            }
            if (vis) {
                seetrap(t);
                await update_topl(`${Monnam(mtmp)} has made a pit in the ${
                    surface(mtmp.mx, mtmp.my)}.`);
            }
            return (await mon_mintrap(mtmp)) === Trap_Killed_Mon ? 1 : 2;
        }
        t = await maketrap(mtmp.mx, mtmp.my, HOLE);
        if (!t) return 2;
        seetrap(t);
        if (vis) {
            await update_topl(`${Monnam(mtmp)} has made a hole in the ${
                surface(mtmp.mx, mtmp.my)}.`);
            await update_topl(`${Monnam(mtmp)} ${
                is_flyer(mtmp.data) ? 'dives' : 'falls'} through...`);
        } else if (!Deaf()) {
            await update_topl(`You hear something crash through the ${
                surface(mtmp.mx, mtmp.my)}.`);
        }
        migrate_to_level(mtmp);
        return 2;
    case MUSE_WAN_UNDEAD_TURNING:
        if (!otmp) return 0;
        zap_oseen = oseen;
        await mzapwand(mtmp, otmp, false);
        m_using = true;
        await mbhit(mtmp, rn1(8, 6), otmp);
        m_using = false;
        return 2;
    case MUSE_WAN_CREATE_MONSTER: {
        if (!otmp) return 0;
        const cc = enexto_near(mtmp.mx, mtmp.my);
        if (!cc) return 0;
        await mzapwand(mtmp, otmp, false);
        const mon = makemon(null, cc.x, cc.y, 0);
        if (mon && canspotmon(mon) && oseen) makeknown(OT().WAN_CREATE_MONSTER);
        return 2;
    }
    case MUSE_SCR_CREATE_MONSTER: {
        if (!otmp) return 0;
        let cnt = 1;
        let known = false;
        if (!rn2(73)) cnt += rnd(4);
        if (mtmp.mconf || otmp.cursed) cnt += 12;
        /* C also biases the creation toward an acid blob (confused) or a
           water creature (in a pool); makemon(0,...) picks randomly, which is
           the branch every reachable case takes. */
        await mreadmsg(mtmp, otmp);
        while (cnt--) {
            const cc = enexto_near(mtmp.mx, mtmp.my);
            if (!cc) break;
            const mon = makemon(null, cc.x, cc.y, 0);
            if (mon && canspotmon(mon)) known = true;
        }
        if (known) makeknown(OT().SCR_CREATE_MONSTER);
        else await trycall(otmp);
        m_useup(mtmp, otmp);
        return 2;
    }
    case MUSE_TRAPDOOR:
        /* trap doors on "bottom" levels of dungeons are rock-drop trap doors,
           not holes in the floor */
        if (Is_botlevel(game.u?.uz)) return 0;
        m_flee(mtmp);
        t = t_at(gt.trapx, gt.trapy);
        if (vis && t) {
            await update_topl(`${Monnam(mtmp)} ${
                vtense_s(locomotion(mtmp.data, 'jump'))} into a ${
                trapname(t.ttyp)}!`);
        }
        if (t) reveal_trap(t, vis);
        newsym(mtmp.mx, mtmp.my);
        mtmp.mx = gt.trapx; mtmp.my = gt.trapy;
        newsym(gt.trapx, gt.trapy);
        migrate_to_level(mtmp);
        return 2;
    case MUSE_UPSTAIRS: {
        m_flee(mtmp);
        const stway = stairway_here(mtmp.mx, mtmp.my);
        if (!stway) return 0;
        if ((game.u?.uz?.dlevel ?? 1) === 1 && (game.u?.uz?.dnum ?? 0) === 0)
            return await mon_escape(mtmp, vismon);
        if (vismon) await update_topl(`${Monnam(mtmp)} escapes upstairs!`);
        migrate_to_level(mtmp);
        return 2;
    }
    case MUSE_DOWNSTAIRS: {
        m_flee(mtmp);
        const stway = stairway_here(mtmp.mx, mtmp.my);
        if (!stway) return 0;
        if (vismon) await update_topl(`${Monnam(mtmp)} escapes downstairs!`);
        migrate_to_level(mtmp);
        return 2;
    }
    case MUSE_UP_LADDER: {
        m_flee(mtmp);
        const stway = stairway_here(mtmp.mx, mtmp.my);
        if (!stway) return 0;
        if (vismon) await update_topl(`${Monnam(mtmp)} escapes up the ladder!`);
        migrate_to_level(mtmp);
        return 2;
    }
    case MUSE_DN_LADDER: {
        m_flee(mtmp);
        const stway = stairway_here(mtmp.mx, mtmp.my);
        if (!stway) return 0;
        if (vismon) await update_topl(`${Monnam(mtmp)} escapes down the ladder!`);
        migrate_to_level(mtmp);
        return 2;
    }
    case MUSE_SSTAIRS: {
        m_flee(mtmp);
        const stway = stairway_here(mtmp.mx, mtmp.my);
        if (!stway) return 0;
        if ((game.u?.uz?.dlevel ?? 1) === 1 && (game.u?.uz?.dnum ?? 0) === 0)
            return await mon_escape(mtmp, vismon);
        if (vismon)
            await update_topl(`${Monnam(mtmp)} escapes ${
                stway.up ? 'up' : 'down'}stairs!`);
        migrate_to_level(mtmp);
        return 2;
    }
    case MUSE_TELEPORT_TRAP:
        m_flee(mtmp);
        t = t_at(gt.trapx, gt.trapy);
        if (vis && t) {
            await update_topl(`${Monnam(mtmp)} ${
                vtense_s(locomotion(mtmp.data, 'jump'))} onto a ${
                trapname(t.ttyp)}!`);
        }
        if (t) reveal_trap(t, vis);
        newsym(mtmp.mx, mtmp.my);
        mtmp.mx = gt.trapx; mtmp.my = gt.trapy;
        newsym(gt.trapx, gt.trapy);
        /* 0: 'no object' rather than STRANGE_OBJECT; false: obj not seen */
        await m_tele(mtmp, vismon, false, 0);
        return 2;
    case MUSE_POT_HEALING:
        if (!otmp) return 0;
        await mquaffmsg(mtmp, otmp);
        i = d(6 + 2 * bcsign(otmp), 4);
        healmon(mtmp, i, 1);
        if (!otmp.cursed && !mtmp.mcansee) await mcureblindness(mtmp, vismon);
        if (vismon) await update_topl(`${Monnam(mtmp)} looks better.`);
        if (oseen) makeknown(OT().POT_HEALING);
        m_useup(mtmp, otmp);
        return 2;
    case MUSE_POT_EXTRA_HEALING:
        if (!otmp) return 0;
        await mquaffmsg(mtmp, otmp);
        i = d(6 + 2 * bcsign(otmp), 8);
        healmon(mtmp, i, otmp.blessed ? 5 : 2);
        if (!mtmp.mcansee) await mcureblindness(mtmp, vismon);
        if (vismon) await update_topl(`${Monnam(mtmp)} looks much better.`);
        if (oseen) makeknown(OT().POT_EXTRA_HEALING);
        m_useup(mtmp, otmp);
        return 2;
    case MUSE_POT_FULL_HEALING:
        if (!otmp) return 0;
        await mquaffmsg(mtmp, otmp);
        if (otmp.otyp === OT().POT_SICKNESS) unbless(otmp); /* Pestilence */
        healmon(mtmp, mtmp.mhpmax, otmp.blessed ? 8 : 4);
        if (!mtmp.mcansee && otmp.otyp !== OT().POT_SICKNESS)
            await mcureblindness(mtmp, vismon);
        if (vismon) await update_topl(`${Monnam(mtmp)} looks completely healed.`);
        if (oseen) makeknown(otmp.otyp);
        m_useup(mtmp, otmp);
        return 2;
    case MUSE_LIZARD_CORPSE:
        if (!otmp) return 0;
        /* not actually called for its unstoning effect */
        await mon_consume_unstone(mtmp, otmp, false, false);
        return 2;
    case 0:
        return 0; /* i.e. an exploded wand */
    default:
        return 0;
    }
}

// C ref: music.c awaken_soldiers(bugler).  Draws no RNG for the mercenary
// branch; awaken_scare() for nearby non-soldiers is monmove.c's wake-up path
// and is likewise RNG-free for a sleeping monster.
async function awaken_soldiers(bugler) {
    const distance = ((bugler.data?.mlevel | 0)) * 30;
    for (const mon of monsterList()) {
        if (DEADMONSTER(mon)) continue;
        if (is_mercenary(mon.data) && mon.data?.name !== 'guard') {
            if (!mon.mtame) mon.mpeaceful = 0;
            mon.msleeping = 0; mon.mfrozen = 0; mon.mcanmove = 1;
            if (canseemon(mon))
                await update_topl(`${Monnam(mon)} is now ready for battle!`);
            else if (!Deaf())
                await update_topl('You hear the rattle of battle gear being readied.');
        } else if (dist2(bugler.mx, bugler.my, mon.mx, mon.my) < distance) {
            mon.msleeping = 0;
        }
    }
}

// C ref: muse.c:2871 mcureblindness(mon, verbos).
export async function mcureblindness(mon, verbos) {
    if (!mon.mcansee) {
        mon.mcansee = 1;
        mon.mblinded = 0;
        if (verbos && haseyes(mon.data))
            await update_topl(`${Monnam(mon)} can see again.`);
    }
}

// C ref: teleport.c enexto(cc, xx, yy, mdat) with a random-order ring scan.
// The random ordering inside each distance ring is where the RNG goes; the
// port's shared implementation lives in js/dog.js, which muse cannot import
// without a cycle through makemon, so re-derive the same ring walk here.
function enexto_near(xx, yy) {
    for (let range = 1; range <= 3; range++) {
        const ring = [];
        for (let x = xx - range; x <= xx + range; x++)
            for (let y = yy - range; y <= yy + range; y++) {
                if (distmin(x, y, xx, yy) !== range) continue;
                if (!isok(x, y)) continue;
                ring.push({ x, y });
            }
        /* C ref: collect_coords() shuffles each equal-distance subset */
        for (let i = ring.length - 1; i > 0; i--) {
            const j = rn2(i + 1);
            const tmp = ring[i]; ring[i] = ring[j]; ring[j] = tmp;
        }
        for (const c of ring)
            if (goodpos_simple(c.x, c.y)) return c;
    }
    return null;
}
// C ref: teleport.c goodpos() for a generic land monster.
function goodpos_simple(x, y) {
    if (!isok(x, y)) return false;
    if (u_at(x, y)) return false;
    if (m_at(x, y)) return false;
    const typ = levl_typ(x, y);
    if (typ == null || !ACCESSIBLE(typ)) return false;
    if (sobj_at(BOULDER, x, y)) return false;
    return true;
}

/* ------------------------------------------------------------------------ *
 * muse.c:1221 rnd_defensive_item(mtmp)
 * ------------------------------------------------------------------------ */
export function rnd_defensive_item(mtmp) {
    const pm = mtmp?.data;
    if (!pm) return 0;
    const difficulty = pm.difficulty | 0;
    let trycnt = 0;

    if (is_animal(pm) || attacktype(pm, AT_EXPL) || mindless(pm)
        || pm.mcls === S_GHOST || pm.mcls === S_KOP)
        return 0;
    for (;;) { /* try_again: */
        switch (rn2(8 + (difficulty > 3 ? 1 : 0) + (difficulty > 6 ? 1 : 0)
                    + (difficulty > 8 ? 1 : 0))) {
        case 6: case 9:
            if (noteleport_level(mtmp) && ++trycnt < 2) continue;
            if (!rn2(3)) return OT().WAN_TELEPORTATION;
            /* FALLTHRU */
            return OT().SCR_TELEPORTATION;
        case 0: case 1:
            return OT().SCR_TELEPORTATION;
        case 8: case 10:
            if (!rn2(3)) return OT().WAN_CREATE_MONSTER;
            /* FALLTHRU */
            return OT().SCR_CREATE_MONSTER;
        case 2:
            return OT().SCR_CREATE_MONSTER;
        case 3: return OT().POT_HEALING;
        case 4: return OT().POT_EXTRA_HEALING;
        case 5:
            return pm.name !== 'Pestilence' ? OT().POT_FULL_HEALING
                                            : OT().POT_SICKNESS;
        case 7: /* wand of digging */
            if (Sokoban() && rn2(4)) continue;
            if (is_floater(pm) || mtmp.isshk || mtmp.isgd || mtmp.ispriest)
                return 0;
            return OT().WAN_DIGGING;
        default:
            return 0;
        }
    }
}

/* ------------------------------------------------------------------------ *
 * muse.c:1293 linedup_chk_corpse / :1299 m_use_undead_turning
 * / :1343 hero_behind_chokepoint / :1370 mon_has_friends
 * / :1394 mon_likes_objpile_at / :1420 find_offensive
 * ------------------------------------------------------------------------ */

function linedup_chk_corpse(x, y) { return sobj_at(OT().CORPSE, x, y) != null; }

// C ref: mthrowu.c linedup_callback(ax, ay, bx, by, check) — walk the straight
// line from <bx,by> toward <ax,ay> testing each square.  Draws no RNG.
function linedup_callback(ax, ay, bx, by, check) {
    const tbx = ax - bx, tby = ay - by;
    if (tbx === 0 && tby === 0) return false;
    if (!((tbx === 0 || tby === 0 || Math.abs(tbx) === Math.abs(tby))
          && distmin(tbx, tby, 0, 0) < BOLT_LIM))
        return false;
    const dx = sgn(tbx), dy = sgn(tby);
    let cx = bx, cy = by;
    do {
        cx += dx; cy += dy;
        if (!isok(cx, cy)) return false;
        if (check(cx, cy)) return true;
    } while (cx !== ax || cy !== ay);
    return false;
}

function m_use_undead_turning(mtmp, obj) {
    const u = game.u;
    const ax = (u?.ux ?? 0) + sgn((mtmp.mux ?? 0) - mtmp.mx) * 3;
    const ay = (u?.uy ?? 0) + sgn((mtmp.muy ?? 0) - mtmp.my) * 3;
    const bx = mtmp.mx, by = mtmp.my;

    if (!(obj.otyp === OT().WAN_UNDEAD_TURNING && (obj.spe | 0) > 0)) return;

    if (hero_carrying(OT().CORPSE)
        || linedup_callback(ax, ay, bx, by, linedup_chk_corpse)) {
        m.offensive = obj;
        m.has_offense = MUSE_WAN_UNDEAD_TURNING;
    }
}
// C ref: invent.c carrying(otyp).
function hero_carrying(otyp) {
    return (game.invent || []).some((o) => o.otyp === otyp);
}

function hero_behind_chokepoint(mtmp) {
    const dx = sgn(mtmp.mx - (mtmp.mux ?? 0));
    const dy = sgn(mtmp.my - (mtmp.muy ?? 0));
    const x = (mtmp.mux ?? 0) + dx, y = (mtmp.muy ?? 0) + dy;

    // C rotates the incoming direction two steps left and two steps right
    // (DIR_LEFT2 / DIR_RIGHT2 of xytodir(dx,dy)) — i.e. the two squares
    // perpendicular to the approach.  With <dx,dy> a unit vector that is
    // <-dy,dx> and <dy,-dx>.
    const c1 = { x: x + -dy, y: y + dx };
    const c2 = { x: x + dy, y: y + -dx };

    if ((!isok(c1.x, c1.y) || !ACCESSIBLE(levl_typ(c1.x, c1.y)))
        && (!isok(c2.x, c2.y) || !ACCESSIBLE(levl_typ(c2.x, c2.y))))
        return true;
    return false;
}

function mon_has_friends(mtmp) {
    if (mtmp.mtame || mtmp.mpeaceful) return false;
    for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
            const x = mtmp.mx + dx, y = mtmp.my + dy;
            if (!isok(x, y)) continue;
            const mon2 = m_at(x, y);
            if (mon2 && mon2 !== mtmp && !mon2.mtame && !mon2.mpeaceful)
                return true;
        }
    return false;
}

function mon_likes_objpile_at(mtmp, x, y) {
    if (!isok(x, y)) return false;
    const pile = objectsAt(x, y);
    if (!pile.length) return false;

    /* monster likes any of the top 3 items in the pile? */
    let i = 0;
    for (; i < pile.length && i < 3; i++)
        if (mon_would_take_item(mtmp, pile[i])) return true;

    /* pile is larger than 3 stacks? */
    return i >= 3;
}

export function find_offensive(mtmp) {
    m.offensive = null;
    m.has_offense = 0;
    if (mtmp.mpeaceful || is_animal(mtmp.data) || mindless(mtmp.data)
        || nohands(mtmp.data))
        return false;
    if (game.u?.uswallow) return false;
    if (in_your_sanctuary(mtmp)) return false;
    if (dmgtype(mtmp.data, AD_HEAL) && hero_is_naked()) return false;
    /* all offensive items require orthogonal or diagonal targeting */
    if (!m_lined_up(mtmp)) return false;

    const reflection_skip = (m_seenres(mtmp, M_SEEN_REFL)
                             || monnear(mtmp, mtmp.mux ?? 0, mtmp.muy ?? 0));
    const mtmp_helmet = which_armor(mtmp, W_ARMH);
    /* this picks the last viable item rather than prioritizing choices */
    for (const obj of m_chain(mtmp)) {
        if (!reflection_skip) {
            if (m.has_offense === MUSE_WAN_DEATH) continue;
            if (obj.otyp === OT().WAN_DEATH && (obj.spe | 0) > 0
                && !m_seenres(mtmp, M_SEEN_MAGR)) {
                m.offensive = obj; m.has_offense = MUSE_WAN_DEATH;
            }
            if (m.has_offense === MUSE_WAN_SLEEP) continue;
            if (obj.otyp === OT().WAN_SLEEP && (obj.spe | 0) > 0
                && (game.multi | 0) >= 0 && !m_seenres(mtmp, M_SEEN_SLEEP)) {
                m.offensive = obj; m.has_offense = MUSE_WAN_SLEEP;
            }
            if (m.has_offense === MUSE_WAN_FIRE) continue;
            if (obj.otyp === OT().WAN_FIRE && (obj.spe | 0) > 0
                && !m_seenres(mtmp, M_SEEN_FIRE)) {
                m.offensive = obj; m.has_offense = MUSE_WAN_FIRE;
            }
            if (m.has_offense === MUSE_FIRE_HORN) continue;
            if (obj.otyp === OT().FIRE_HORN && (obj.spe | 0) > 0 && can_blow(mtmp)
                && !m_seenres(mtmp, M_SEEN_FIRE)) {
                m.offensive = obj; m.has_offense = MUSE_FIRE_HORN;
            }
            if (m.has_offense === MUSE_WAN_COLD) continue;
            if (obj.otyp === OT().WAN_COLD && (obj.spe | 0) > 0
                && !m_seenres(mtmp, M_SEEN_COLD)) {
                m.offensive = obj; m.has_offense = MUSE_WAN_COLD;
            }
            if (m.has_offense === MUSE_FROST_HORN) continue;
            if (obj.otyp === OT().FROST_HORN && (obj.spe | 0) > 0 && can_blow(mtmp)
                && !m_seenres(mtmp, M_SEEN_COLD)) {
                m.offensive = obj; m.has_offense = MUSE_FROST_HORN;
            }
            if (m.has_offense === MUSE_WAN_LIGHTNING) continue;
            if (obj.otyp === OT().WAN_LIGHTNING && (obj.spe | 0) > 0
                && !m_seenres(mtmp, M_SEEN_ELEC)) {
                m.offensive = obj; m.has_offense = MUSE_WAN_LIGHTNING;
            }
            if (m.has_offense === MUSE_WAN_MAGIC_MISSILE) continue;
            if (obj.otyp === OT().WAN_MAGIC_MISSILE && (obj.spe | 0) > 0
                && !m_seenres(mtmp, M_SEEN_MAGR)) {
                m.offensive = obj; m.has_offense = MUSE_WAN_MAGIC_MISSILE;
            }
        }
        if (m.has_offense === MUSE_WAN_UNDEAD_TURNING) continue;
        m_use_undead_turning(mtmp, obj);
        if (m.has_offense === MUSE_WAN_STRIKING) continue;
        if (obj.otyp === OT().WAN_STRIKING && (obj.spe | 0) > 0
            && !m_seenres(mtmp, M_SEEN_MAGR)) {
            m.offensive = obj; m.has_offense = MUSE_WAN_STRIKING;
        }
        if (m.has_offense === MUSE_WAN_TELEPORTATION) continue;
        if (obj.otyp === OT().WAN_TELEPORTATION && (obj.spe | 0) > 0
            && !Teleport_control()
            && (!noteleport_level(mtmp) || !mon_knows_traps(mtmp, TELEP_TRAP))
            && (onscary(game.u?.ux, game.u?.uy, mtmp)
                || (hero_behind_chokepoint(mtmp) && mon_has_friends(mtmp))
                || mon_likes_objpile_at(mtmp, game.u?.ux, game.u?.uy)
                || stairway_here(game.u?.ux, game.u?.uy))) {
            m.offensive = obj; m.has_offense = MUSE_WAN_TELEPORTATION;
        }
        if (m.has_offense === MUSE_POT_PARALYSIS) continue;
        if (obj.otyp === OT().POT_PARALYSIS && (game.multi | 0) >= 0) {
            m.offensive = obj; m.has_offense = MUSE_POT_PARALYSIS;
        }
        if (m.has_offense === MUSE_POT_BLINDNESS) continue;
        if (obj.otyp === OT().POT_BLINDNESS && !attacktype(mtmp.data, AT_GAZE)) {
            m.offensive = obj; m.has_offense = MUSE_POT_BLINDNESS;
        }
        if (m.has_offense === MUSE_POT_CONFUSION) continue;
        if (obj.otyp === OT().POT_CONFUSION) {
            m.offensive = obj; m.has_offense = MUSE_POT_CONFUSION;
        }
        if (m.has_offense === MUSE_POT_SLEEPING) continue;
        if (obj.otyp === OT().POT_SLEEPING && !m_seenres(mtmp, M_SEEN_SLEEP)) {
            m.offensive = obj; m.has_offense = MUSE_POT_SLEEPING;
        }
        if (m.has_offense === MUSE_POT_ACID) continue;
        if (obj.otyp === OT().POT_ACID && !m_seenres(mtmp, M_SEEN_ACID)) {
            m.offensive = obj; m.has_offense = MUSE_POT_ACID;
        }
        /* the squares within a 1-square radius are a subset of the squares
           within wand/throwing range, so SCR_EARTH is always lined_up() */
        if (m.has_offense === MUSE_SCR_EARTH) continue;
        if (obj.otyp === OT().SCR_EARTH
            && (hard_helmet(mtmp_helmet) || mtmp.mconf
                || amorphous(mtmp.data) || passes_walls(mtmp.data)
                || noncorporeal(mtmp.data) || unsolid(mtmp.data)
                || !rn2(10))
            && dist2(mtmp.mx, mtmp.my, mtmp.mux ?? 0, mtmp.muy ?? 0) <= 2
            && mtmp.mcansee && haseyes(mtmp.data)
            && !Is_rogue_level(game.u?.uz)
            && (!In_endgame(game.u?.uz) || Is_earthlevel(game.u?.uz))) {
            m.offensive = obj; m.has_offense = MUSE_SCR_EARTH;
        }
        if (m.has_offense === MUSE_CAMERA) continue;
        if (obj.otyp === OT().EXPENSIVE_CAMERA
            && ((!Blind() && !hero_resists_blnd()) || hero_hates_light())
            && dist2(mtmp.mx, mtmp.my, mtmp.mux ?? 0, mtmp.muy ?? 0) <= 2
            && (obj.spe | 0) > 0 && !rn2(6)) {
            m.offensive = obj; m.has_offense = MUSE_CAMERA;
        }
        /* MUSE_SCR_FIRE is #if 0'd out in C; omitted here for the same reason */
    }
    return !!m.has_offense;
}

// C ref: mon.c monnear(mon, x, y) — within one (king) step.
function monnear(mon, x, y) {
    const distance = dist2(mon.mx, mon.my, x, y);
    if (distance === 2 && NODIAG(mon.data)) return false;
    return distance < 3;
}
// C ref: priest.c in_your_sanctuary(mon, x, y) — a co-aligned temple protects
// the hero.  The scored dungeon slice never puts the hero on a temple square
// while a hostile is lined up, and the port has no temple-alignment state.
function in_your_sanctuary(_mtmp) { return false; }
// C ref: muse.c:1436 — a nurse only refrains when the hero wears nothing at all.
// The worn/wielded slots live on `game`, not on `game.u` (js/invent.js
// setworn_slot / js/u_init.js setworn); reading u.uwep answered "naked" for
// every hero, so a nurse gave up its whole offensive scan while fully clothed.
function hero_is_naked() {
    return !game.uwep && !game.uarmu && !game.uarm && !game.uarmh
        && !game.uarms && !game.uarmg && !game.uarmc && !game.uarmf;
}
// C ref: hack.h Teleport_control — the hero has no control source in the
// recorded sessions (no ring/intrinsic teleport control).
function Teleport_control() { return !!game.u?.utelecontrol; }
// C ref: mondata.h resists_blnd(&youmonst) / hates_light(youmonst.data).
function hero_resists_blnd() { return !!game.u?.ublindresist; }
function hero_hates_light() { return false; }

/* ------------------------------------------------------------------------ *
 * muse.c:1596 mbhitm / :1706 fhito_loc / :1733 mbhit
 * ------------------------------------------------------------------------ */

// C ref: prop.h Antimagic == HAntimagic || EAntimagic.  The port has no
// oc_oprop column, so read every uprops mirror the granting code uses (the
// Wizard's starting cloak of magic resistance sets one of them).
function Antimagic_muse() {
    const W_ARMOR_MASK = 0x7f;  // monst.h W_ARMOR: the seven armour slots
    for (const o of (game.invent || []))
        if (((o.owornmask || 0) & W_ARMOR_MASK)
            && OBJECTS[o.otyp]?.oc_oprop === 12 /* prop.h ANTIMAGIC */)
            return true;
    const u = game.u;
    return !!(u?.uprops?.Antimagic || u?.Antimagic || u?.HAntimagic || u?.EAntimagic);
}
function Half_spell_damage_muse() {
    return (game.u?.uprops?.HHalf_spell_damage || 0) > 0;
}
// C ref: mondata.c resists_magm(mon).  The artifact-weapon and worn-item arms
// need an oc_oprop column the JS objects[] table lacks; no monster in the
// covered corpora wears magic-resistant gear.
function resists_magm_muse(mon) {
    const ptr = mon?.data;
    if (!ptr) return false;
    return !!(dmgtype(ptr, AD_MAGM) || dmgtype(ptr, AD_RBRE)
              || ptr.name === 'baby gray dragon');
}
// C ref: mondata.c:1557/1572 monstseesu()/monstunseesu() — every monster with
// line of sight to the hero remembers (or forgets) that the hero resisted.
// RNG-free itself, but find_offensive()'s m_seenres() gates read the bit, so it
// changes which wand a monster picks on a later turn.
function monstseesu_muse(seenres, clear) {
    if (!seenres || game.u?.uswallow) return;
    for (const mon of monsterList()) {
        if (DEADMONSTER(mon)) continue;
        if (!couldsee(mon.mx, mon.my)) continue;   /* m_canseeu(): hero visible, on land */
        mon.seen_resistance = clear ? ((mon.seen_resistance | 0) & ~seenres)
                                    : ((mon.seen_resistance | 0) | seenres);
    }
}

// C ref: worn.c find_mac(mon).
function find_mac_muse(mon) { return worn_find_mac(mon); }

// C ref: muse.c mbhitm(mtmp, otmp) — what the monster's beam does to whatever
// it strikes.  WAN_UNDEAD_TURNING's unturn_dead() still needs zap.c machinery
// this port does not have, so it draws nothing rather than half-resolving.
async function mbhitm(mtmp, otmp, hits_you) {
    if (!hits_you && otmp.otyp !== OT().WAN_UNDEAD_TURNING) {
        mtmp.msleeping = 0;
    }
    let learnit = false;
    switch (otmp.otyp) {
    case OT().WAN_STRIKING:
        // C ref: muse.c:1609-1651.  An angered shopkeeper zaps this before it
        // melees; skipping it lost the whole rest of the boundary's stream.
        if (hits_you) {
            if (Antimagic_muse()) {
                monstseesu_muse(M_SEEN_MAGR, false);
                await update_topl('Boing!');
                learnit = true;
            } else if (rnd(20) < 10 + (game.u?.uac | 0)
                       && !(buzzer && !buzzer.mwandexp)) {
                // rnd(20) is drawn FIRST (short-circuit order), so it fires even
                // on a monster's very first wand shot when the buzzer test then
                // fails.
                monstseesu_muse(M_SEEN_MAGR, true);
                await update_topl('The wand hits you!');
                let tmp = d(2, 12);
                if (Half_spell_damage_muse()) tmp = Math.trunc((tmp + 1) / 2);
                const u = game.u;
                u.uhp -= tmp;
                learnit = true;
                if (u.uhp < 1) {
                    const endm = await import('./end.js');
                    await update_topl('You die...');
                    game._killer_name = 'killed by a wand';
                    await endm.done(0 /*DIED*/);
                }
            } else {
                await update_topl('The wand misses you.');
            }
            const { stop_occupation } = await import('./hack.js');
            await stop_occupation();
        } else if (resists_magm_muse(mtmp)) {
            await update_topl('Boing!');
            learnit = true;
        } else if (rnd(20) < 10 + find_mac_muse(mtmp)) {
            const tmp = d(2, 12);
            if (canseemon(mtmp))
                await update_topl(`The wand hits ${mon_nam(mtmp)}${tmp > 5 ? '!' : '.'}`);
            // C ref: muse.c:1640 resist() — it rolls rn2(100+alev-dlev) AND
            // applies the (possibly halved) damage.  Dynamic import: zap.js ->
            // monmove.js -> muse.js is a static cycle.
            const { resist } = await import('./zap.js');
            resist(mtmp, otmp.oclass, tmp, true);
            learnit = true;
        } else if (canseemon(mtmp)) {
            await update_topl(`The wand misses ${mon_nam(mtmp)}.`);
        }
        // C: need to have seen the wand zapped AND the spot where it lands.
        if (learnit && zap_oseen
            && (hits_you || cansee(mtmp.mx, mtmp.my)))
            makeknown(OT().WAN_STRIKING);
        break;
    case OT().WAN_TELEPORTATION:
        if (hits_you) {
            /* C: tele() — the hero-teleport path lives in js/teleport.js and
               is only reachable from hero commands today. */
            break;
        }
        if (!await tele_restrict(mtmp)) await rloc(mtmp, RLOC_MSG);
        break;
    default:
        break;
    }
    return 0;
}

// C ref: muse.c mbhit(mon, range, fhitm, fhito, obj) — a monster's bolt.  The
// walk itself draws no RNG; the callee does.
async function mbhit(mon, range, obj) {
    const otyp = obj.otyp;
    let bx = mon.mx, by = mon.my;
    const ddx = sgn((mon.mux ?? 0) - mon.mx);
    const ddy = sgn((mon.muy ?? 0) - mon.my);

    while (range-- > 0) {
        bx += ddx; by += ddy;
        if (!isok(bx, by)) { bx -= ddx; by -= ddy; break; }
        if (u_at(bx, by)) {
            await mbhitm(null, obj, true);
            range -= 3;
        } else {
            const mtmp = m_at(bx, by);
            if (mtmp) {
                if (cansee(bx, by) && !canspotmon(mtmp)) map_invisible(bx, by);
                await mbhitm(mtmp, obj, false);
                range -= 3;
            }
        }
        const ltyp = levl_typ(bx, by);
        /* C also breaks drawbridges and blows doors open with WAN_STRIKING;
           doorlock()/destroy_drawbridge() are unported, and the monsters that
           reach here never carry an opening/locking wand. */
        if (!ZAP_POS(ltyp)
            || (IS_DOOR(ltyp)
                && ((levl_at(bx, by)?.doormask | 0) & (D_LOCKED | D_CLOSED)))) {
            bx -= ddx; by -= ddy;
            break;
        }
        if (otyp === OT().WAN_STRIKING) { /* placeholder: see comment above */ }
    }
}

/* ------------------------------------------------------------------------ *
 * muse.c:1823 use_offensive(mtmp)
 * ------------------------------------------------------------------------ */
export async function use_offensive(mtmp, throw_potion) {
    const otmp = m.offensive;
    let i;

    if (!otmp) return 0;
    /* offensive potions are not drunk, they're thrown */
    if (otmp.oclass !== POTION_CLASS && (i = await precheck(mtmp, otmp)) !== 0)
        return i;
    const oseen = canseemon(mtmp);

    switch (m.has_offense) {
    case MUSE_WAN_DEATH:
    case MUSE_WAN_SLEEP:
    case MUSE_WAN_FIRE:
    case MUSE_WAN_COLD:
    case MUSE_WAN_LIGHTNING:
    case MUSE_WAN_MAGIC_MISSILE: {
        /* C ref: muse.c:1847-1861 — mzapwand(), makeknown() (whose
           exercise(A_WIS, TRUE) rn2(19) is a REAL draw), then buzz() with a
           NEGATIVE ray type so dobuzz() takes its monster-source path.  This
           was a documented GAP ("this port does not have dobuzz"), but zap.js
           has had dobuzz with the type<0 monster arm since breath attacks
           landed — leaving the arm empty simply dropped the whole ray
           (w3-human-knight-debug step 162: the robbed shopkeeper's wand). */
        await mzapwand(mtmp, otmp, false);
        if (oseen) makeknown(otmp.otyp);
        m_using = true;
        game.buzzer = mtmp;
        game.current_wand = otmp;
        const mux = mtmp.mux ?? game.u.ux, muy = mtmp.muy ?? game.u.uy;
        const { dobuzz } = await import('./zap.js');
        // C ref: muse.c:1833 `buzzfn = mtmp->mwandexp ? buzz : buzz_force_miss`
        // — a monster's FIRST attack-wand shot always misses, and
        // buzz_force_miss() passes forcemiss=TRUE, which short-circuits every
        // zap_hit() rn2(20) in the beam.  Without it the shopkeeper's opening
        // shot rolled to-hit and killed a Kop C only "misses".
        await dobuzz(BZ_M_WAND(BZ_OFS_WAN_MUSE(otmp.otyp)),
                     (otmp.otyp === OT().WAN_MAGIC_MISSILE) ? 2 : 6,
                     mtmp.mx, mtmp.my, sgn(mux - mtmp.mx), sgn(muy - mtmp.my),
                     true, false, !mtmp.mwandexp);
        game.buzzer = null;
        game.current_wand = null;
        m_using = false;
        mtmp.mwandexp = true;
        return DEADMONSTER(mtmp) ? 1 : 2;
    }
    case MUSE_FIRE_HORN:
    case MUSE_FROST_HORN:
        /* GAP: mplayhorn()'s ray still needs the horn message machinery. */
        return 0;
    case MUSE_WAN_TELEPORTATION:
    case MUSE_WAN_UNDEAD_TURNING:
    case MUSE_WAN_STRIKING:
        zap_oseen = oseen;
        await mzapwand(mtmp, otmp, false);
        m_using = true;
        buzzer = mtmp;                      // C ref: muse.c:1883 gb.buzzer
        await mbhit(mtmp, rn1(8, 6), otmp);
        buzzer = null;                      // C ref: muse.c:1885
        m_using = false;
        if (m.has_offense === MUSE_WAN_STRIKING) mtmp.mwandexp = true;
        return 2;
    case MUSE_SCR_EARTH:
        /* GAP: drop_boulder_on_monster()/drop_boulder_on_player() are trap.c
           machinery this port does not have. */
        return 0;
    case MUSE_CAMERA:
        /* GAP: lightdamage() and make_blinded() for a monster-sourced flash
           are unported. */
        return 0;
    case MUSE_POT_PARALYSIS:
    case MUSE_POT_BLINDNESS:
    case MUSE_POT_CONFUSION:
    case MUSE_POT_SLEEPING:
    case MUSE_POT_ACID: {
        /* Note: this setting of dknown doesn't suffice.  A monster which is
         * out of sight might throw and it hits something _in_ sight. */
        if (cansee(mtmp.mx, mtmp.my)) {
            observe_object(otmp);
            otmp._seen_thrown = true;
            if (canspotmon(mtmp))
                await update_topl(`${Monnam(mtmp)} hurls ${singular_doname(otmp)}!`);
        }
        const mux = mtmp.mux ?? game.u.ux, muy = mtmp.muy ?? game.u.uy;
        /* m_throw() lives in monmove.js (the mthrowu.c port); the caller
           supplies it so muse doesn't re-import a module that imports it. */
        if (throw_potion)
            await throw_potion(mtmp, mtmp.mx, mtmp.my, sgn(mux - mtmp.mx),
                               sgn(muy - mtmp.my),
                               distmin(mtmp.mx, mtmp.my, mux, muy), otmp);
        return 2;
    }
    case 0:
        return 0; /* i.e. an exploded wand */
    default:
        return 0;
    }
}

/* ------------------------------------------------------------------------ *
 * muse.c:2034 rnd_offensive_item(mtmp)
 * ------------------------------------------------------------------------ */
export function rnd_offensive_item(mtmp) {
    const pm = mtmp?.data;
    if (!pm) return 0;
    const difficulty = pm.difficulty | 0;

    if (is_animal(pm) || attacktype(pm, AT_EXPL) || mindless(pm)
        || pm.mcls === S_GHOST || pm.mcls === S_KOP)
        return 0;
    if (difficulty > 7 && !rn2(35)) return OT().WAN_DEATH;
    switch (rn2(9 - (difficulty < 4 ? 1 : 0) + 4 * (difficulty > 6 ? 1 : 0))) {
    case 0: {
        const mtmp_helmet = which_armor(mtmp, W_ARMH);
        if (hard_helmet(mtmp_helmet) || amorphous(pm) || passes_walls(pm)
            || noncorporeal(pm) || unsolid(pm))
            return OT().SCR_EARTH;
        return OT().WAN_STRIKING; /* FALLTHRU to case 1 */
    }
    case 1: return OT().WAN_STRIKING;
    case 2: return OT().POT_ACID;
    case 3: return OT().POT_CONFUSION;
    case 4: return OT().POT_BLINDNESS;
    case 5: return OT().POT_SLEEPING;
    case 6: return OT().POT_PARALYSIS;
    case 7: case 8: return OT().WAN_MAGIC_MISSILE;
    case 9: return OT().WAN_SLEEP;
    case 10: return OT().WAN_FIRE;
    case 11: return OT().WAN_COLD;
    case 12: return OT().WAN_LIGHTNING;
    default: return 0;
    }
}

/* ------------------------------------------------------------------------ *
 * muse.c:2094 find_misc(mtmp)
 *
 * The scan is LAST-MATCH-WINS on purpose (C's own comment calls the lack of
 * prioritisation a bug): each matching clause overwrites m.misc, and
 * `nomore(x)` only skips a clause when the immediately-preceding pick was that
 * same type.  Two clauses draw RNG and both are gated behind an item test
 * first, so a monster carrying neither a bullwhip nor a container draws
 * nothing here:
 *   * MUSE_BULLWHIP  rn2(5)  (wielded bullwhip, hero adjacent and armed)
 *   * MUSE_BAG       rn2(5)  (any container that isn't a bag of tricks)
 * ------------------------------------------------------------------------ */
export function find_misc(mtmp) {
    const mdat = mtmp.data;
    const x = mtmp.mx, y = mtmp.my;
    const stuck = (mtmp === game.u?.ustuck);
    const immobile = !base_mmove(mtmp);

    m.misc = null;
    m.has_misc = 0;
    if (is_animal(mdat) || mindless(mdat)) return false;
    if (game.u?.uswallow && stuck) return false;

    /* C ref: muse.c:2117 — "arbitrarily limit to times when a player is
       nearby".  mux/muy is the monster's BELIEF about the hero's square. */
    const mux = mtmp.mux ?? 0, muy = mtmp.muy ?? 0;
    if (dist2(x, y, mux, muy) > 36) return false;

    /* step onto an adjacent polymorph trap.  Draws no RNG. */
    if (!stuck && !immobile && !mtmp.mtrapped && (mtmp.cham ?? NON_PM) === NON_PM
        && (mdat?.difficulty | 0) < 6) {
        const ignore_boulders = (verysmall(mdat) || throws_rocks(mdat)
                                 || passes_walls(mdat));
        const diag_ok = !NODIAG(mdat);
        for (let xx = x - 1; xx <= x + 1; xx++)
            for (let yy = y - 1; yy <= y + 1; yy++) {
                if (!isok(xx, yy) || u_at(xx, yy)) continue;
                if (!(diag_ok || xx === x || yy === y)) continue;
                if (!((xx === x && yy === y) || !m_at(xx, yy))) continue;
                const t = t_at(xx, yy);
                if (t && (ignore_boulders || !sobj_at(BOULDER, xx, yy))
                    && !onscary(xx, yy, mtmp)) {
                    if (t.ttyp === POLY_TRAP && !wearing_iron_shoes(mtmp)) {
                        gt.trapx = xx; gt.trapy = yy;
                        m.has_misc = MUSE_POLY_TRAP;
                        return true;
                    }
                }
            }
    }

    if (nohands(mdat)) return false;

    // uwep is on `game` (js/invent.js setuwep), not on `game.u`.  Reading the
    // wrong one left this undefined for every hero, which short-circuited the
    // MUSE_BULLWHIP clause BEFORE its rn2(5) — C draws that roll for any armed
    // hero next to a whip-wielding monster, so the draw went missing entirely.
    const uwep = game.uwep;
    for (const obj of m_chain(mtmp)) {
        /* Monsters shouldn't recognize cursed items; this kludge is
           necessary to prevent serious problems though... */
        if (obj.otyp === OT().POT_GAIN_LEVEL
            && (!obj.cursed || (!mtmp.isgd && !mtmp.isshk && !mtmp.ispriest))) {
            m.misc = obj; m.has_misc = MUSE_POT_GAIN_LEVEL;
        }
        if (m.has_misc === MUSE_BULLWHIP) continue;
        /* the random test prevents a whip-wielding monster from attempting a
           disarm every turn; order matters — otyp, !mpeaceful and a wielded
           hero weapon are all tested BEFORE the roll */
        if (obj.otyp === OT().BULLWHIP && !mtmp.mpeaceful
            && uwep && !rn2(5) && obj === MON_WEP(mtmp)
            && u_at(mux, muy)
            && m_next2u(mtmp)
            && !game.u?.uswallow
            && (canletgo(uwep)
                || (game.u?.twoweap && canletgo(game.uswapwep)))) {
            m.misc = obj; m.has_misc = MUSE_BULLWHIP;
        }
        /* Note: peaceful/tame monsters won't make themselves invisible unless
           you can see them.  Not really right, but... */
        if (m.has_misc === MUSE_WAN_MAKE_INVISIBLE) continue;
        if (obj.otyp === OT().WAN_MAKE_INVISIBLE && (obj.spe | 0) > 0
            && !mtmp.minvis && !mtmp.invis_blkd
            && (!mtmp.mpeaceful || See_invisible())
            && (!attacktype(mtmp.data, AT_GAZE) || mtmp.mcan)) {
            m.misc = obj; m.has_misc = MUSE_WAN_MAKE_INVISIBLE;
        }
        if (m.has_misc === MUSE_POT_INVISIBILITY) continue;
        if (obj.otyp === OT().POT_INVISIBILITY && !mtmp.minvis
            && !mtmp.invis_blkd && (!mtmp.mpeaceful || See_invisible())
            && (!attacktype(mtmp.data, AT_GAZE) || mtmp.mcan)) {
            m.misc = obj; m.has_misc = MUSE_POT_INVISIBILITY;
        }
        if (m.has_misc === MUSE_WAN_SPEED_MONSTER) continue;
        if (obj.otyp === OT().WAN_SPEED_MONSTER && (obj.spe | 0) > 0
            && mtmp.mspeed !== MFAST && !mtmp.isgd) {
            m.misc = obj; m.has_misc = MUSE_WAN_SPEED_MONSTER;
        }
        if (m.has_misc === MUSE_POT_SPEED) continue;
        if (obj.otyp === POT_SPEED && mtmp.mspeed !== MFAST && !mtmp.isgd) {
            m.misc = obj; m.has_misc = MUSE_POT_SPEED;
        }
        if (m.has_misc === MUSE_WAN_POLYMORPH) continue;
        if (obj.otyp === OT().WAN_POLYMORPH && (obj.spe | 0) > 0
            && (mtmp.cham ?? NON_PM) === NON_PM && (mdat?.difficulty | 0) < 6) {
            m.misc = obj; m.has_misc = MUSE_WAN_POLYMORPH;
        }
        if (m.has_misc === MUSE_POT_POLYMORPH) continue;
        if (obj.otyp === OT().POT_POLYMORPH && (mtmp.cham ?? NON_PM) === NON_PM
            && (mdat?.difficulty | 0) < 6) {
            m.misc = obj; m.has_misc = MUSE_POT_POLYMORPH;
        }
        if (m.has_misc === MUSE_BAG) continue;
        if (is_container_otyp(obj.otyp) && obj.otyp !== BAG_OF_TRICKS && !rn2(5)
            && !SchroedingersBox(obj)
            && !m.has_misc && has_contents(obj)
            && !obj.olocked && !obj.otrapped) {
            m.misc = obj; m.has_misc = MUSE_BAG;
        }
    }
    return !!m.has_misc;
}

// C ref: hack.h See_invisible.
function See_invisible() { return !!game.u?.see_invis; }
// C ref: worn.c wearing_iron_shoes(mon).
function wearing_iron_shoes(mon) {
    const boots = which_armor(mon, W_ARMF);
    return !!boots && OBJECTS[boots.otyp]?.name === 'iron shoes';
}

/* ------------------------------------------------------------------------ *
 * muse.c:2249 muse_newcham_mon / :2263 mloot_container / :2382 use_misc
 * ------------------------------------------------------------------------ */

// C ref: muse.c mloot_container(mon, container, vismon).
async function mloot_container(mon, container, vismon) {
    let res = 0;
    if (!container || !has_contents(container) || container.olocked) return res;
    if (is_mbag(container) && container.cursed) return res;
    if (SchroedingersBox(container)) return res;

    let takeout_count;
    switch (rn2(10)) {
    default: takeout_count = 1; break;          /* case 0, 1, 2, 3 */
    case 4: case 5: case 6: takeout_count = 2; break;
    case 7: case 8: takeout_count = 3; break;
    case 9: takeout_count = 4; break;
    }
    const howfar = mdistu(mon);
    const nearby = (howfar <= 7 * 7);
    let contnr_nam = '';
    const mpronounbuf = vismon ? mhe(mon) : '';

    for (let takeout_indx = 0; takeout_indx < takeout_count; ++takeout_indx) {
        if (!has_contents(container)) break;

        let nitems = container.cobj.length;
        /* throttle item removal as the container becomes less filled */
        if (!rn2(nitems + 1)) break;
        nitems = rn2(nitems);
        const xobj = container.cobj[nitems];
        if (!xobj) break;

        container.cknown = 0;
        if (!contnr_nam)
            contnr_nam = an(nearby ? xname(container) : xname(container));

        /* take xobj out, check whether it can be carried, and put it back if
           it can't be (so its weight isn't counted twice) */
        container.cobj.splice(nitems, 1);
        if (mon_can_carry(mon, xobj)) {
            if (vismon) {
                if (howfar > 2)
                    await update_topl(`${Monnam(mon)} rummages through ${contnr_nam}.`);
                else if (takeout_indx === 0)
                    await update_topl(
                        `${Monnam(mon)} removes ${obj_doname(xobj)} from ${contnr_nam}.`);
                else
                    await update_topl(
                        `${upstart(mpronounbuf)} removes ${obj_doname(xobj)}.`);
            }
            (mon.minvent || (mon.minvent = [])).push(xobj);
            xobj.where = 'minvent';
            res = 2;
        } else {
            const just_xobj = !has_contents(container);
            container.cobj.push(xobj);
            container.owt = container_weight(container);
            if (just_xobj) break;
        }
    }
    return res;
}
// C ref: mon.c can_carry(mon, obj) — js/mon.js owns the real one; import it
// lazily through the shared export so the cycle stays safe.
function mon_can_carry(mon, obj) {
    const mdat = mon?.data;
    if (!mdat) return false;
    if ((mflags1_of(mdat) & M1_NOTAKE) !== 0) return false;
    // C's can_touch_safely() (gloves vs a petrifying corpse) is not modelled.
    const iquan = obj.quan || 1;
    // A handless monster can still take ONE item; C returns early with 1 here,
    // bypassing the weight check entirely.
    if (iquan > 1 && (mflags1_of(mdat) & M1_NOHANDS) !== 0
        && !attacktype(mdat, AT_ENGL)
        && !(mdat.mcls === S_DRAGON
             && (obj.oclass === COIN_CLASS || obj.oclass === GEM_CLASS)))
        return true;
    if (mon === game.u?.usteed) return false;
    if (mon.isshk) return true;                 /* no limit */
    if (mon.mpeaceful && !mon.mtame) return false;
    if (throws_rocks(mdat) && obj.otyp === BOULDER) return true;
    if (mdat.mcls === S_NYMPH_MCLS) return obj.oclass !== ROCK_CLASS;
    return curr_mon_load(mon) + obj_weight(obj) <= max_load(mon);
}
function obj_weight(o) {
    return (o?.owt != null) ? (o.owt | 0)
        : (OBJECTS[o?.otyp]?.oc_weight ?? 0) * (o?.quan || 1);
}
// C ref: mon.c curr_mon_load(mtmp).
function curr_mon_load(mon) {
    let load = 0;
    for (const o of (mon.minvent || []))
        if (o.otyp !== BOULDER || !throws_rocks(mon.data)) load += obj_weight(o);
    return load;
}
// C ref: mon.c max_mon_load(mtmp).  The old `(msize + 1) * 200` was a guess
// with no C counterpart: C scales MAX_CARR_CAP by the monster's corpse weight
// (or by msize when it has none) and halves the result for a non-strong
// monster, so e.g. a human's cap is 500, not 600.
function max_load(mon) {
    const mdat = mon?.data;
    const strong = strongmonst(mdat);
    const cwt = mdat?.cwt | 0;
    let maxload;
    if (!cwt) maxload = Math.trunc((MAX_CARR_CAP * (mdat?.msize | 0)) / MZ_HUMAN);
    else if (!strong || cwt > WT_HUMAN)
        maxload = Math.trunc((MAX_CARR_CAP * cwt) / WT_HUMAN);
    else maxload = MAX_CARR_CAP;
    if (!strong) maxload = Math.trunc(maxload / 2);
    return maxload < 1 ? 1 : maxload;
}

export async function use_misc(mtmp) {
    const otmp = m.misc;
    let i, t;

    if ((i = await precheck(mtmp, otmp)) !== 0) return i;
    const vis = !!cansee(mtmp.mx, mtmp.my);
    const vismon = canseemon(mtmp);
    const oseen = !!otmp && vismon;

    switch (m.has_misc) {
    case MUSE_POT_GAIN_LEVEL:
        if (!otmp) return 0;
        await mquaffmsg(mtmp, otmp);
        if (otmp.cursed) {
            if (Can_rise_up(mtmp.mx, mtmp.my, game.u?.uz)) {
                if (vismon) {
                    await update_topl(`${Monnam(mtmp)} rises up, through the ${
                        ceiling(mtmp.mx, mtmp.my)}!`);
                    await trycall(otmp);
                }
                m_useup(mtmp, otmp);
                migrate_to_level(mtmp);
                return 2;
            }
            if (vismon) {
                await update_topl(`${Monnam(mtmp)} looks uneasy.`);
                await trycall(otmp);
            }
            m_useup(mtmp, otmp);
            return 2;
        }
        if (vismon) await update_topl(`${Monnam(mtmp)} seems more experienced.`);
        if (oseen) makeknown(OT().POT_GAIN_LEVEL);
        m_useup(mtmp, otmp);
        if (!grow_up_potion(mtmp)) return 1;
        return 2; /* grew into a genocided monster */
    case MUSE_WAN_MAKE_INVISIBLE:
    case MUSE_POT_INVISIBILITY: {
        if (!otmp) return 0;
        if (otmp.otyp === OT().WAN_MAKE_INVISIBLE) await mzapwand(mtmp, otmp, true);
        else await mquaffmsg(mtmp, otmp);
        /* format the monster's name before altering its visibility */
        const nambuf = mon_nam(mtmp);
        mtmp.minvis = otmp.cursed ? 0 : 1;
        if (vismon && mtmp.minvis) { /* was seen, now invisible */
            if (canspotmon(mtmp)) {
                await update_topl(`${upstart(s_suffix(nambuf))} body takes on a ${
                    Hallucination() ? 'normal' : 'strange'} transparency.`);
            } else {
                await update_topl(`Suddenly you cannot see ${nambuf}.`);
                if (vis) map_invisible(mtmp.mx, mtmp.my);
            }
            if (oseen) makeknown(otmp.otyp);
        } else if (vismon && !mtmp.minvis) {
            await update_topl(`${Monnam(mtmp)} briefly seems to be transparent.`);
        } else if (!vismon && canseemon(mtmp)) {
            await update_topl(`${Monnam(mtmp)} suddenly appears!`);
        }
        if (otmp.otyp === OT().POT_INVISIBILITY) {
            if (otmp.cursed) await you_aggravate(mtmp);
            m_useup(mtmp, otmp);
        }
        newsym(mtmp.mx, mtmp.my);
        return 2;
    }
    case MUSE_WAN_SPEED_MONSTER:
        if (!otmp) return 0;
        await mzapwand(mtmp, otmp, true);
        await mon_adjust_speed(mtmp, 1, otmp);
        return 2;
    case MUSE_POT_SPEED:
        if (!otmp) return 0;
        await mquaffmsg(mtmp, otmp);
        /* note the difference in potion effect: the player's character becomes
           "very fast" temporarily; a monster becomes "one stage faster"
           permanently */
        await mon_adjust_speed(mtmp, 1, otmp);
        m_useup(mtmp, otmp);
        return 2;
    case MUSE_WAN_POLYMORPH:
    case MUSE_POT_POLYMORPH:
    case MUSE_POLY_TRAP:
        /* GAP: all three bottom out in newcham(), the monster-polymorph
           machinery (mon.c), which this port does not have.  Returning 0 is
           C's "nothing happened" and costs no RNG — muse_newcham_mon()'s
           rndmonst() draw only happens inside newcham's caller in C, i.e. only
           once the effect is actually carried out. */
        return 0;
    case MUSE_BAG:
        if (!otmp) return 0;
        return await mloot_container(mtmp, otmp, vismon);
    case MUSE_BULLWHIP: {
        /* attempt to disarm the hero */
        const The_whip = vismon ? 'The bullwhip' : 'A whip';
        let where_to = rn2(4);
        // uwep/uswapwep live on `game` (js/invent.js setuwep), not on `game.u`;
        // reading them off `u` made obj undefined, so the whole disarm bailed
        // out through the `if (!obj) break` after already rolling its rn2(4).
        let obj = game.uwep;

        if (!obj || !canletgo(obj)
            || (game.u?.twoweap && canletgo(game.uswapwep) && rn2(2)))
            obj = game.uswapwep;
        if (!obj) break; /* shouldn't happen after find_misc() */

        const the_weapon = the_(xname(obj));
        let hand = 'hand';
        if (bimanual(obj)) hand = 'hands';

        if (vismon)
            await update_topl(
                `${Monnam(mtmp)} flicks a bullwhip towards your ${hand}!`);
        if (obj.otyp === OT().HEAVY_IRON_BALL) {
            await update_topl(`${The_whip} fails to wrap around ${the_weapon}.`);
            return 1;
        }
        await update_topl(`${The_whip} wraps around ${the_weapon} you're wielding!`);
        if (welded_hero(obj)) {
            await update_topl(`${obj_is_plural(obj) ? 'They are' : 'It is'} welded to your ${
                hand}${!obj.bknown ? '!' : '.'}`);
            where_to = 0;
        }
        if (!where_to) {
            await update_topl('The whip slips free.'); /* not `The_whip` */
            return 1;
        } else if (where_to === 3 && mon_hates_silver(mtmp)
                   && OBJECTS[obj.otyp]?.material === MAT_SILVER) {
            /* this monster won't want to catch a silver weapon; drop it at the
               hero's feet instead */
            where_to = 2;
        }
        hero_unwield(obj);
        switch (where_to) {
        case 1: /* onto floor beneath mon */
            await update_topl(`${Monnam(mtmp)} yanks ${the_weapon} from your ${hand}!`);
            place_object(obj, mtmp.mx, mtmp.my);
            break;
        case 2: /* onto floor beneath you */
            await update_topl(`${Monnam(mtmp)} yanks ${the_weapon} to the ${
                surface(game.u.ux, game.u.uy)}!`);
            place_object(obj, game.u.ux, game.u.uy);
            break;
        case 3: /* into mon's inventory */
            await update_topl(`${Monnam(mtmp)} snatches ${the_weapon}!`);
            (mtmp.minvent || (mtmp.minvent = [])).push(obj);
            obj.where = 'minvent';
            break;
        default:
            break;
        }
        newsym(mtmp.mx, mtmp.my);
        newsym(game.u.ux, game.u.uy);
        return 1;
    }
    case 0:
        return 0; /* i.e. an exploded wand */
    default:
        return 0;
    }
    return 0;
}

// C ref: dungeon.c ceiling(x, y).
function ceiling(_x, _y) { return 'ceiling'; }
// mon.js owns mon_hates_silver(); muse already imports from mon.js, so the old
// local re-derivation bought nothing and got four things wrong against
// mondata.c hates_silver(): is_undead in place of `mlet == S_VAMPIRE || PM_SHADE`
// (every zombie/mummy/lich answered yes), the literal 24 commented "S_DEMON"
// (24 is S_XAN; S_DEMON is 56, and C tests the M2_DEMON flag anyway), the name
// "imp" in place of `mlet == S_IMP && != PM_TENGU`, and no is_vampshifter arm.
// C ref: invent.c remove_worn_item() + freeinv() for the hero's wielded weapon.
function hero_unwield(obj) {
    // same slot-location fix as welded_hero(): clearing u.uwep left game.uwep
    // still pointing at an object that had just been removed from invent.
    // C ref: worn.c remove_worn_item() -> wield.c uwepgone(), which also sets
    // gu.unweapon so the next melee swing prints "You begin bashing monsters
    // with your bare hands." (uhitm.c:539).
    if (game.uwep === obj) { game.uwep = null; game.unweapon = true; }
    if (game.uswapwep === obj) game.uswapwep = null;
    obj.owornmask = 0;
    const inv = game.invent || [];
    const i = inv.indexOf(obj);
    if (i >= 0) inv.splice(i, 1);
}
// C ref: makemon.c grow_up(mtmp, (struct monst *) 0) — the potion-of-gain-level
// branch: always go up a level, rnd(8) extra max HP.  Returns false when the
// monster grew into a genocided form (which kills it).
function grow_up_potion(mtmp) {
    if (DEADMONSTER(mtmp)) return false;
    const max_increase = rnd(8);
    mtmp.mhpmax = (mtmp.mhpmax | 0) + max_increase;
    mtmp.mhp = (mtmp.mhp | 0) + max_increase;
    /* C recalculates lev_limit and may switch to the "big" form; little_to_big
       and the genocide check need makemon.c tables the port doesn't expose
       here, and neither draws RNG, so only the level bump is applied. */
    if ((mtmp.m_lev | 0) < 49) mtmp.m_lev = (mtmp.m_lev | 0) + 1;
    return true;
}

/* ------------------------------------------------------------------------ *
 * muse.c:2630 you_aggravate(mtmp)
 * ------------------------------------------------------------------------ */
async function you_aggravate(mtmp) {
    await update_topl(
        `For some reason, ${s_suffix(mon_nam(mtmp))} presence is known to you.`);
    /* C then does cls()/show_glyph()/display_nhwindow()/docrt(); the net effect
       on a captured screen is the map redrawn with the monster shown, which
       newsym() below achieves without tearing down the window. */
    newsym(mtmp.mx, mtmp.my);
    await update_topl(`You feel aggravated at ${mon_nam(mtmp)}.`);
    if (!canspotmon(mtmp)) map_invisible(mtmp.mx, mtmp.my);
}

/* ------------------------------------------------------------------------ *
 * muse.c:2653 rnd_misc_item(mtmp)
 * ------------------------------------------------------------------------ */
export function rnd_misc_item(mtmp) {
    const pm = mtmp?.data;
    if (!pm) return 0;
    const difficulty = pm.difficulty | 0;

    if (is_animal(pm) || attacktype(pm, AT_EXPL) || mindless(pm)
        || pm.mcls === S_GHOST || pm.mcls === S_KOP)
        return 0;
    /* Unlike other rnd_item functions, we only allow _weak_ monsters to have
       this item; the item will be used to strengthen the monster. */
    if (difficulty < 6 && !rn2(30))
        return rn2(6) ? OT().POT_POLYMORPH : OT().WAN_POLYMORPH;

    if (!rn2(40) && !nonliving(pm) && !is_vampshifter(mtmp))
        return OT().AMULET_OF_LIFE_SAVING;

    switch (rn2(3)) {
    case 0:
        if (mtmp.isgd) return 0;
        return rn2(6) ? POT_SPEED : OT().WAN_SPEED_MONSTER;
    case 1:
        if (mtmp.mpeaceful && !See_invisible()) return 0;
        return rn2(6) ? OT().POT_INVISIBILITY : OT().WAN_MAKE_INVISIBLE;
    case 2:
        return OT().POT_GAIN_LEVEL;
    default:
        return 0;
    }
}

/* ------------------------------------------------------------------------ *
 * muse.c:2705 searches_for_item(mon, obj)
 *
 * "Would this monster walk over and pick this thing up because it could USE
 * it?"  Nothing here draws RNG, but it is the widest branch of monmove.c's
 * mon_would_take_item(): every non-mindless, non-animal monster consults it for
 * every object within five squares, and a TRUE answer re-points that monster's
 * movement goal at the object.
 * ------------------------------------------------------------------------ */
export function searches_for_item(mon, obj) {
    const typ = obj.otyp;

    /* don't let monsters interact with protected items on the floor */
    if (obj.where === 'floor' && obj.ox === mon.mx && obj.oy === mon.my
        && onscary(obj.ox, obj.oy, mon))
        return false;

    if (is_animal(mon.data) || mindless(mon.data)
        || mon.data?.name === 'ghost') /* don't loot bones piles */
        return false;

    if (typ === OT().WAN_MAKE_INVISIBLE || typ === OT().POT_INVISIBILITY)
        return !mon.minvis && !mon.invis_blkd && !attacktype(mon.data, AT_GAZE);
    if (typ === OT().WAN_SPEED_MONSTER || typ === POT_SPEED)
        return (mon.mspeed | 0) !== MFAST;

    switch (obj.oclass) {
    case WAND_CLASS:
        if ((obj.spe | 0) <= 0) return false;
        if (typ === OT().WAN_DIGGING) return !is_floater(mon.data);
        if (typ === OT().WAN_POLYMORPH) return (mon.data?.difficulty | 0) < 6;
        if (OBJECTS[typ]?.dir === RAY || typ === OT().WAN_STRIKING
            || typ === OT().WAN_UNDEAD_TURNING
            || typ === OT().WAN_TELEPORTATION || typ === OT().WAN_CREATE_MONSTER)
            return true;
        break;
    case POTION_CLASS:
        if (typ === OT().POT_HEALING || typ === OT().POT_EXTRA_HEALING
            || typ === OT().POT_FULL_HEALING || typ === OT().POT_POLYMORPH
            || typ === OT().POT_GAIN_LEVEL || typ === OT().POT_PARALYSIS
            || typ === OT().POT_SLEEPING || typ === OT().POT_ACID
            || typ === OT().POT_CONFUSION)
            return true;
        if (typ === OT().POT_BLINDNESS && !attacktype(mon.data, AT_GAZE))
            return true;
        break;
    case SCROLL_CLASS:
        if (typ === OT().SCR_TELEPORTATION || typ === OT().SCR_CREATE_MONSTER
            || typ === OT().SCR_EARTH || typ === OT().SCR_FIRE)
            return true;
        break;
    case AMULET_CLASS:
        if (typ === OT().AMULET_OF_LIFE_SAVING)
            return !(nonliving(mon.data) || is_vampshifter(mon));
        if (typ === OT().AMULET_OF_REFLECTION || typ === OT().AMULET_OF_GUARDING)
            return true;
        break;
    case TOOL_CLASS:
        if (typ === OT().PICK_AXE) return needspick(mon.data);
        if (typ === OT().UNICORN_HORN)
            return !obj.cursed && !is_unicorn(mon.data)
                && mon.data?.name !== 'ki-rin';
        if (typ === OT().FROST_HORN || typ === OT().FIRE_HORN)
            return (obj.spe | 0) > 0 && can_blow(mon);
        if (is_container_otyp(typ) && !(is_mbag(obj) && obj.cursed)
            && !obj.olocked)
            return true;
        if (typ === OT().EXPENSIVE_CAMERA) return (obj.spe | 0) > 0;
        break;
    case FOOD_CLASS:
        if (typ === OT().CORPSE)
            return (((mon.misc_worn_check ?? 0) & W_ARMG) !== 0
                    && obj.corpsenm != null && obj.corpsenm >= 0
                    && touch_petrifies_pm(obj.corpsenm))
                || (!resists_ston(mon) && cures_stoning(mon, obj, false));
        if (typ === OT().TIN)
            return mcould_eat_tin(mon)
                && !resists_ston(mon) && cures_stoning(mon, obj, true);
        if (typ === OT().EGG && obj.corpsenm != null && obj.corpsenm >= 0)
            return touch_petrifies_pm(obj.corpsenm);
        break;
    default:
        break;
    }

    return false;
}

/* ------------------------------------------------------------------------ *
 * muse.c:2796 mon_reflects(mon, str)
 * ------------------------------------------------------------------------ */
export async function mon_reflects(mon, str) {
    let orefl = which_armor(mon, W_ARMS);

    if (orefl && orefl.otyp === OT().SHIELD_OF_REFLECTION) {
        if (str) {
            await update_topl(reflect_msg(str, s_suffix(mon_nam(mon)), 'shield'));
            makeknown(OT().SHIELD_OF_REFLECTION);
        }
        return true;
    }
    /* C also checks arti_reflects(MON_WEP(mon)); the port creates no reflecting
       artifact weapon, so that branch can never fire. */
    if ((orefl = which_armor(mon, W_AMUL))
        && orefl.otyp === OT().AMULET_OF_REFLECTION) {
        if (str) {
            await update_topl(reflect_msg(str, s_suffix(mon_nam(mon)), 'amulet'));
            makeknown(OT().AMULET_OF_REFLECTION);
        }
        return true;
    }
    if ((orefl = which_armor(mon, W_ARM))
        && (orefl.otyp === OT().SILVER_DRAGON_SCALES
            || orefl.otyp === OT().SILVER_DRAGON_SCALE_MAIL)) {
        if (str)
            await update_topl(reflect_msg(str, s_suffix(mon_nam(mon)), 'armor'));
        return true;
    }
    if (mon.data?.name === 'silver dragon' || mon.data?.name === 'Chromatic Dragon') {
        /* Silver dragons only reflect when mature; babies do not */
        if (str)
            await update_topl(reflect_msg(str, s_suffix(mon_nam(mon)), 'scales'));
        return true;
    }
    return false;
}
// C's callers pass a two-%s format string ("The bolt bounces off %s %s!").
function reflect_msg(fmt, who, what) {
    let n = 0;
    return String(fmt).replace(/%s/g, () => (n++ === 0 ? who : what));
}

/* ------------------------------------------------------------------------ *
 * muse.c:2883 munstone / :2905 mon_consume_unstone / :2984 cures_stoning
 * / :3000 mcould_eat_tin
 * ------------------------------------------------------------------------ */

export async function munstone(mon, by_you) {
    if (resists_ston(mon)) return false;
    if (mon.meating || helpless(mon)) return false;

    const tinok = mcould_eat_tin(mon);
    for (const obj of (mon.minvent || [])) {
        if (cures_stoning(mon, obj, tinok)) {
            await mon_consume_unstone(mon, obj, by_you, true);
            return true;
        }
    }
    return false;
}

async function mon_consume_unstone(mon, obj, by_you, stoning) {
    const vis = canseemon(mon);
    const tinned = obj.otyp === OT().TIN;
    const food = obj.otyp === OT().CORPSE || tinned;
    const acid = obj.otyp === OT().POT_ACID || (food && acidic_pm(obj.corpsenm));
    const lizard = food && is_lizard_pm(obj.corpsenm);
    /* C: dog_nutrition() also sets mon->meating; it draws no RNG for a corpse
       or tin, and only the tame branch below reads the value. */
    const nutrit = food ? corpse_nutrition(obj) : 0;

    /* give a "<mon> is slowing down" message and also remove intrinsic speed */
    if (stoning) await mon_adjust_speed(mon, -3, null);

    if (vis) {
        const save_quan = obj.quan;
        obj.quan = 1;
        await update_topl(`${Monnam(mon)} ${
            (obj.oclass === POTION_CLASS) ? 'quaffs'
            : tinned ? 'opens and eats the contents of' : 'eats'} ${obj_doname(obj)}.`);
        obj.quan = save_quan;
    } else if (!Deaf()) {
        await update_topl(`You hear ${
            (obj.oclass === POTION_CLASS) ? 'drinking' : 'chewing'}.`);
    }

    m_useup(mon, obj);
    /* obj is now gone */

    if (acid && !tinned && !resists_acid_mon(mon)) {
        mon.mhp -= rnd(15);
        if (vis)
            await update_topl(`${Monnam(mon)} has a very bad case of stomach acid.`);
        if (DEADMONSTER(mon)) {
            await update_topl(`${Monnam(mon)} dies!`);
            await mondead(mon);
            return;
        }
    }
    if (stoning && vis) {
        if (Hallucination())
            await update_topl(
                `What a pity - ${mon_nam(mon)} just ruined a future piece of art!`);
        else
            await update_topl(`${Monnam(mon)} seems limber!`);
    }
    if (lizard && (mon.mconf || mon.mstun)) {
        mon.mconf = 0;
        mon.mstun = 0;
        if (vis && mon.data?.name !== 'bat' && mon.data?.name !== 'giant bat'
            && mon.data?.name !== 'stalker')
            await update_topl(`${Monnam(mon)} seems steadier now.`);
    }
    if (mon.mtame && !mon.isminion && nutrit > 0 && mon.edog) {
        if (mon.edog.hungrytime < game.moves) mon.edog.hungrytime = game.moves;
        mon.edog.hungrytime += nutrit;
        mon.mconf = 0;
    }
    /* use up monster's next move */
    mon.movement = (mon.movement | 0) - NORMAL_SPEED;
    mon.mlstmv = game.moves;
}
// C ref: dogmove.c dog_nutrition() for a corpse/tin — cnutrit scaled by the
// species' cnutrit; no RNG.
function corpse_nutrition(obj) {
    return (monster_by_pmidx(obj.corpsenm)?.cnutrit) | 0;
}
// C ref: mondata.h resists_acid(mon).  monflag.h MR_ACID is 0x40; 0x20 (the old
// value) is MR_POISON, so this answered with the wrong resistance bit.
function resists_acid_mon(mon) {
    const MR_ACID = 0x40;
    return ((mon?.data?.mresists ?? 0) & MR_ACID) !== 0;
}

// C ref: muse.c cures_stoning(mon, obj, tinok).
function cures_stoning(mon, obj, tinok) {
    if (obj.otyp === OT().POT_ACID) return true;
    if (obj.otyp === OT().GLOB_OF_GREEN_SLIME) return slimeproof(mon.data);
    if (obj.otyp !== OT().CORPSE && (obj.otyp !== OT().TIN || !tinok)) return false;
    if (obj.corpsenm == null || obj.corpsenm < 0) return false; /* NON_PM */
    return is_lizard_pm(obj.corpsenm) || acidic_pm(obj.corpsenm);
}

// C ref: muse.c:3000 mcould_eat_tin(mon).
function mcould_eat_tin(mon) {
    if (is_animal(mon.data)) return false;
    const mwep = MON_WEP(mon);
    const welded_wep = !!mwep && mwelded_obj(mwep);
    for (const obj of (mon.minvent || [])) {
        if (welded_wep && obj !== mwep) continue;
        if (obj.otyp === OT().TIN_OPENER
            || (obj.oclass === WEAPON_CLASS
                && (OBJECTS[obj.otyp]?.oc_skill === P_DAGGER
                    || OBJECTS[obj.otyp]?.oc_skill === P_KNIFE)))
            return true;
    }
    return false;
}

/* ------------------------------------------------------------------------ *
 * muse.c:3030 munslime / :3103 muse_unslime / :3245 cures_sliming
 * / :3268 green_mon
 * ------------------------------------------------------------------------ */

export async function munslime(mon, by_you) {
    const mptr = mon.data;

    if (slimeproof(mptr)) return false;
    if (mon.meating || helpless(mon)) return false;

    /* if the monster can breathe fire, do so upon self */
    if (!mon.mcan && !mon.mspec_used
        && attacktype_fordmg_fire(mptr)) {
        const odummy = { otyp: STRANGE_OBJECT, oclass: 0 };
        return await muse_unslime(mon, odummy, null, by_you);
    }

    /* same MUSE criteria as use_defensive() */
    if (!is_animal(mptr) && !mindless(mptr)) {
        let t;
        for (const obj of (mon.minvent || []))
            if (cures_sliming(mon, obj))
                return await muse_unslime(mon, obj, null, by_you);

        t = t_at(mon.mx, mon.my);
        if ((t == null || t.ttyp !== FIRE_TRAP) && base_mmove(mon) && !mon.mtrapped) {
            const xy = [];
            for (let x = mon.mx - 1; x <= mon.mx + 1; ++x)
                for (let y = mon.my - 1; y <= mon.my + 1; ++y)
                    if (isok(x, y) && ACCESSIBLE(levl_typ(x, y))
                        && !m_at(x, y) && !u_at(x, y))
                        xy.push([x, y]);
            t = null;
            /* C ref: the rn1(nxy - idx, idx) partial shuffle — the RNG order
               here matters even when no fire trap is found. */
            for (let idx = 0; idx < xy.length; ++idx) {
                const ridx = rn1(xy.length - idx, idx);
                if (ridx !== idx) {
                    const tmp = xy[idx]; xy[idx] = xy[ridx]; xy[ridx] = tmp;
                }
                const cand = t_at(xy[idx][0], xy[idx][1]);
                if (cand && cand.ttyp === FIRE_TRAP) { t = cand; break; }
            }
        }
        if (t && t.ttyp === FIRE_TRAP)
            return await muse_unslime(mon, hands_obj, t, by_you);
    }

    return false;
}
// C ref: mondata.h attacktype_fordmg(ptr, AT_BREA, AD_FIRE).
function attacktype_fordmg_fire(ptr) {
    const { attacktype_fordmg } = { attacktype_fordmg: null };
    /* monattk_data exports attacktype_fordmg; call it through the import when
       available so we don't duplicate the attack-table walk. */
    return _attacktype_fordmg(ptr, AT_BREA, AD_FIRE);
}

// C ref: muse.c muse_unslime(mon, obj, trap, by_you).  The zhitm()/explode()
// damage paths are unported, so the fire sources that need them stop after the
// message + speed adjustment; the fire-trap path uses the ported mintrap.
async function muse_unslime(mon, obj, trap, by_you) {
    const otyp = obj.otyp;
    let vis = canseemon(mon);
    const res = true;

    if (vis)
        await update_topl(`${Monnam(mon)} starts turning ${
            green_mon(mon) ? 'into ooze' : 'green'}.`);
    /* -4 => sliming, causes quiet loss of enhanced speed */
    await mon_adjust_speed(mon, -4, null);

    if (trap) {
        const Mnam = vis ? Monnam(mon) : null;
        if (mon.mx === trap.tx && mon.my === trap.ty) {
            if (vis)
                await update_topl(`${Mnam} triggers ${trap.tseen ? 'the' : 'a'} fire trap!`);
        } else {
            newsym(mon.mx, mon.my);
            mon.mx = trap.tx; mon.my = trap.ty;
            newsym(mon.mx, mon.my);
            if (vis)
                await update_topl(`${Mnam} ${vtense_s(locomotion(mon.data, 'move'))} ${
                    is_floater(mon.data) ? 'over' : 'onto'} ${
                    trap.tseen ? 'the' : 'a'} fire trap!`);
        }
        await mon_mintrap(mon);
    } else if (otyp === STRANGE_OBJECT) {
        /* monster is using fire breath on self */
        if (vis)
            await update_topl(`${Monnam(mon)} breathes fire on ${mhim(mon)}self.`);
        if (!rn2(3)) mon.mspec_used = rn1(10, 5);
        /* GAP: zhitm() applies the fire damage; unported. */
    } else if (otyp === OT().SCR_FIRE) {
        await mreadmsg(mon, obj);
        if (mon.mconf) {
            if (cansee(mon.mx, mon.my)) await update_topl('Oh, what a pretty fire!');
            if (vis) await trycall(obj);
            m_useup(mon, obj);
            vis = false;
            return false; /* failed to cure sliming */
        }
        // C ref: muse.c:3161 — dmg is rolled, the scroll is used up BEFORE
        // explode(), and the blast itself applies the damage.  A negative
        // expltype names `mon` as the monster the hero gets kill credit for.
        const dmg = Math.trunc((2 * (rn1(3, 3) + 2 * bcsign(obj)) + 1) / 3);
        m_useup(mon, obj);
        {
            const { explode } = await import('./explode.js');
            const { EXPL_FIERY } = await import('./const.js');
            const { SCROLL_CLASS } = await import('./mkobj.js');
            await explode(mon.mx, mon.my, -11, dmg, SCROLL_CLASS,
                          by_you ? -EXPL_FIERY : EXPL_FIERY);
        }
    } else if (otyp === OT().POT_OIL) {
        let o = obj;
        const was_lit = !!obj.lamplit;
        if ((o.quan || 1) > 1) o = m_splitobj(o, 1);
        if (vis && !was_lit)
            await update_topl(`${Monnam(mon)} ignites ${an(xname(o))}.`);
        o.lamplit = 1;
        vis = vis || canseemon(mon);
        if (vis) {
            observe_object(o);
            await update_topl(`${was_lit ? Monnam(mon) : upstart(mhe(mon))
                } quaffs a burning ${xname(o)}`);
            makeknown(OT().POT_OIL);
        }
        d(3, 4); /* [**TEMP** (different from hero)] */
        m_useup(mon, o);
    } else { /* wand/horn of fire w/ positive charge count */
        if (obj.otyp === OT().FIRE_HORN) await mplayhorn(mon, obj, true);
        else await mzapwand(mon, obj, true);
        /* GAP: zhitm() applies the fire damage; unported. */
    }

    if (vis) {
        if (res && !DEADMONSTER(mon))
            await update_topl(`${s_suffix(Monnam(mon))} slime is burned away!`);
        if (otyp !== STRANGE_OBJECT) makeknown(otyp);
    }
    /* use up monster's next move */
    mon.movement = (mon.movement | 0) - NORMAL_SPEED;
    mon.mlstmv = game.moves;
    return res;
}

// C ref: muse.c cures_sliming(mon, obj).
function cures_sliming(mon, obj) {
    if (obj.otyp === OT().SCR_FIRE)
        return haseyes(mon.data) && mon.mcansee && !nohands(mon.data);
    if (obj.otyp === OT().POT_OIL) return !nohands(mon.data);
    return (obj.otyp === OT().WAN_FIRE
            || (obj.otyp === OT().FIRE_HORN && can_blow(mon)))
        && (obj.spe | 0) > 0;
}

// C ref: muse.c green_mon(mon) — goes by the display colour.
function green_mon(mon) {
    const CLR_GREEN = 2, CLR_BRIGHT_GREEN = 10;
    if (Hallucination()) return false;
    const c = mon.data?.mcolor;
    return c === CLR_GREEN || c === CLR_BRIGHT_GREEN;
}

/* ------------------------------------------------------------------------ *
 * worn.c mon_adjust_speed(mon, adjust, obj) — lives here because muse is its
 * only caller in this port.
 * ------------------------------------------------------------------------ */

// Consumes no RNG.  The message gate is `give_msg = !gi.in_mklev` — NOT
// !mon_moving — so the "suddenly moving faster" line does print during monster
// movement.
export async function mon_adjust_speed(mon, adjust, _obj) {
    const oldspeed = mon.mspeed | 0;
    let give_msg = !game.in_mklev;
    switch (adjust) {
    case 2: mon.permspeed = MFAST; give_msg = false; break;
    case 1: mon.permspeed = (mon.permspeed === MSLOW) ? 0 : MFAST; break;
    case 0: break;
    case -1: mon.permspeed = (mon.permspeed === MFAST) ? 0 : MSLOW; break;
    case -2: mon.permspeed = MSLOW; give_msg = false; break;
    case -3: mon.permspeed = MSLOW; break;  /* petrifying */
    case -4: mon.permspeed = MSLOW; give_msg = false; break; /* sliming */
    default: break;
    }
    // C: worn speed boots override permspeed.  Monster worn-armor properties
    // aren't modelled, so mspeed follows permspeed.
    mon.mspeed = mon.permspeed | 0;

    // C ref: worn.c — `mon->data->mmove` gates the message on the species being
    // mobile at all (a mold's speed change is never announced).  makemon.js's
    // permonst records carry no mmove field, so read it through mon.js's
    // base_mmove(); testing `mon.data.mmove` directly is always undefined and
    // silently swallowed EVERY speed message.
    if (give_msg && mon.mspeed !== oldspeed && base_mmove(mon)
        && !(mon.mfrozen || mon.msleeping) && canseemon(mon)) {
        const howmuch = (mon.mspeed + oldspeed === MFAST + MSLOW) ? 'much ' : '';
        if (adjust > 0 || mon.mspeed === MFAST)
            await update_topl(`${Monnam(mon)} is suddenly moving ${howmuch}faster.`);
        else
            await update_topl(`${Monnam(mon)} seems to be moving ${howmuch}slower.`);
    }
}
