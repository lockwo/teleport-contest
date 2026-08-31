// polyself.js — polymorph-self subsystem.
// C ref: src/polyself.c — set_uasmon, uasmon_maxStr, polymon, newman, dropp,
// break_armor, drop_weapon, dobreathe.  domonability (src/cmd.c) lives here
// too since it is tightly coupled to can_breathe/dobreathe and this module
// has no reverse dependency on cmd.js.
//
// The interactive "Become what kind of monster? [type the name]" getlin loop
// (the front half of polyself.c polyself()) lives in extcmd-handlers.js next
// to wiz_polyself, matching that file's existing wiz_genesis/create_particular
// split (getlin shell there, pure logic in the C-file-matching module here).

import { game } from './gstate.js';
import { rn1, rn2, rnd, d } from './rng.js';
import { update_topl, urgent_topl, newsym, see_monsters } from './display.js';
// C ref: win/tty/topl.c pline()/update_topl() — this module always uses
// update_topl() (never the simpler pline()) because every message here can be
// immediately followed by another one from the same command (polymon()'s
// "You turn into a gnome!" + break_armor()'s "You shrink out of your cloak!"
// + encumber_msg()'s load message + the "Use the command #monster..." tips);
// update_topl() is the function that appends-or-flushes-with-"--More--"
// (pline() just clobbers the pending line, dropping earlier messages).
const pline = update_topl;
import { exercise, acurr_eff } from './attrib.js';
import { find_ac, race_attrmax, race_attrmin, race_attrmax_of } from './u_init.js';
import { encumber_msg, freeinv, xname, makeplural, near_capacity,
    youmonst_data_pub, makeknown } from './invent.js';
import { base_mmove } from './mon.js';
import { P_NAME, weapon_type } from './enhance.js';
import { objects as OBJECTS, maybe_adjust_light } from './mkobj.js';
import { place_object, WEAPON_CLASS, TOOL_CLASS, ARMOR_CLASS, FOOD_CLASS,
    POTION_CLASS, SCROLL_CLASS, SPBOOK_CLASS, WAND_CLASS, COIN_CLASS,
    GEM_CLASS, ROCK_CLASS, BALL_CLASS, CHAIN_CLASS, VENOM_CLASS,
    RING_CLASS, AMULET_CLASS, ILLOBJ_CLASS } from './mkobj.js';
import { makesingular } from './objnam.js';
import { newuexp, newhp, newpw, adjabil, update_rank, rank_of } from './exper.js';
import { newuhs } from './eat.js';
import { monster_by_pmidx, name_to_pmidx, golemhp_js as golemhp,
    is_home_elemental, MGEND_MALE, MGEND_FEMALE, MGEND_NEUTRAL } from './makemon.js';
import { livelog_printf, LL_CONDUCT, LL_MINORAC } from './livelog.js';
import { A_STR, A_INT, A_WIS, A_CON, A_DEX, A_MAX, TT_PIT, TT_BURIEDBALL,
    IS_FOUNTAIN, IS_POOL, IS_LAVA, IS_AIR, In_endgame,
    POLY_CONTROLLED, POLY_MONSTER, POLY_REVERT, POLY_LOW_CTRL } from './const.js';
// C ref: hack.h bodypart NECK; prop.h I_SPECIAL / FROMOUTSIDE / FROMRACE — the
// float_vs_flight() / steed_vs_stealth() / polysense() ports below need them.
import { NECK, I_SPECIAL, FROMOUTSIDE, FROMRACE } from './const.js';
import { Unaware } from './const.js';
// C ref: hack.h enum bodypart_types — mbodypart()/body_part() selectors.
import { ARM, EYE, FINGER, FINGERTIP, FOOT, HAND, HANDED, HEAD, LEG, TOE,
    HAIR, NOSE, STOMACH } from './const.js';
import {
    is_hider_flag, hides_under_flag, is_were_flag, likes_gems_flag,
    strongmonst_flag, is_male_flag, is_flyer_flag, mflags1_of, M1_CLING,
    M1_SLITHY, M1_NOEYES, M1_NOHEAD, M1_BREATHLESS,
    lays_eggs_flag, mindless, msound_of, is_swimmer_flag,
    is_female_flag, is_neuter_flag, is_orc_flag, is_elf_flag, is_dwarf_flag,
    is_gnome_flag, is_giant_flag, is_undead_flag, nohands, humanoid,
    polyok_flag, mflags2_of, M2_HUMAN, M2_ELF, M2_DWARF, M2_GNOME, M2_ORC,
    M2_PNAME,
} from './monflags_data.js';
import { attacktype, mattk_of, AT_BREA, AT_SPIT, AT_GAZE, AT_CLAW,
    AD_MAGM, AD_CONF, AD_FIRE } from './monattk_data.js';
import { monsterList, DEADMONSTER, set_ustuck } from './mon.js';
import { races, roles, genders } from './role.js';
import { Blind } from './vision.js';
import { surface, In_hell } from './dungeon.js';
import { emits_light, new_light_source, del_light_source, LS_MONSTER,
    HERO, arti_light_radius, artifact_light } from './light.js';

// ── real (not session-specific) monster-index constants (mons[] order) ──
const PM_HUMAN = 260;
const PM_ORC = 72;
const PM_GIANT = 169;
const PM_ELF = 264;
const PM_GRAY_DRAGON = name_to_pmidx('gray dragon');
let _uruk = -2, _orccap = -2;
function PM_URUK_HAI() { if (_uruk === -2) _uruk = name_to_pmidx('Uruk-hai'); return _uruk; }
function PM_ORC_CAPTAIN() { if (_orccap === -2) _orccap = name_to_pmidx('orc-captain'); return _orccap; }
const PM_CAVE_SPIDER = name_to_pmidx('cave spider');
const PM_GIANT_SPIDER = name_to_pmidx('giant spider');
const PM_MIND_FLAYER = name_to_pmidx('mind flayer');
const PM_MASTER_MIND_FLAYER = name_to_pmidx('master mind flayer');
const PM_AIR_ELEMENTAL = name_to_pmidx('air elemental');
const PM_MARILITH = name_to_pmidx('marilith');
const PM_WINGED_GARGOYLE = name_to_pmidx('winged gargoyle');
const PM_FLOATING_EYE = name_to_pmidx('floating eye');
const PM_GREMLIN = name_to_pmidx('gremlin');
const PM_GIANT_EEL = name_to_pmidx('giant eel');
const PM_ELECTRIC_EEL = name_to_pmidx('electric eel');
// C ref: monflag.h MS_SHRIEK (the MS_* enum is not carried symbolically by
// monflags_data.js, which only exports the handful peace_minded() needs).
const MS_SHRIEK = 18;
// role-local race enum used by u_init.js's RACE_ATTRMAX/RACE_ATTRMIN tables
// (0..4 == human/elf/dwarf/gnome/orc), NOT a mons[] pmidx.
const RACE_LOCAL = { HUMAN: 0, ELF: 1, DWARF: 2, GNOME: 3, ORC: 4 };

// C ref: include/monflag.h MZ_* body-size enum.
const MZ_SMALL = 1, MZ_LARGE = 3;

// C ref: mondata.h:122 `#define can_breathe(ptr) attacktype(ptr, AT_BREA)`;
// polyself.c:1039/1043 use attacktype(uptr, AT_SPIT) / (uptr, AT_GAZE)
// directly.  These were name-keyed Sets, which answered FALSE for every
// species not listed: the AT_BREA set was missing 5 of 19 (red naga, Nazgul,
// iron golem, Chromatic Dragon, Ixoth), AT_SPIT 3 of 4 (black/guardian naga,
// Juiblex), and the AT_GAZE set named floating eye, which has no AT_GAZE at
// all (its mattk is a passive AT_NONE/AD_PLYS) while missing all 5 real
// gazers.  monattk_data.js is the generated mattk[] from the recorder's
// monsters.h, so go through attacktype() instead.
export function can_breathe(mdat) { return attacktype(mdat, AT_BREA); }
function has_spit(mdat) { return attacktype(mdat, AT_SPIT); }
function has_gaze(mdat) { return attacktype(mdat, AT_GAZE); }
function is_whirly(mdat) { return !!mdat && (mdat.mlet === 'v' || mdat.pmidx === PM_AIR_ELEMENTAL); }
function is_floater(mdat) { return !!mdat && (mdat.mlet === 'e' || mdat.mlet === 'y'); }
function noncorporeal(mdat) { return !!mdat && mdat.mlet === ' '; }
function is_golem(mdat) { return !!mdat && mdat.mlet === '\''; }
function is_unicorn_pm(mdat) { return !!mdat && mdat.mlet === 'u' && likes_gems_flag(mdat); }
function is_mind_flayer_pm(mdat) {
    return !!mdat && (mdat.pmidx === PM_MIND_FLAYER || mdat.pmidx === PM_MASTER_MIND_FLAYER);
}
function is_vampire_pm(mdat) { return !!mdat && mdat.mlet === 'V'; }
function webmaker(mdat) { return !!mdat && (mdat.pmidx === PM_CAVE_SPIDER || mdat.pmidx === PM_GIANT_SPIDER); }
// C ref: mondata.h is_clinger(ptr) — M1_CLING.
function is_clinger(mdat) { return !!mdat && (mflags1_of(mdat) & M1_CLING) !== 0; }
// C ref: mondata.h eggs_in_water(ptr).
function eggs_in_water(mdat) {
    return lays_eggs_flag(mdat) && mdat?.mlet === ';' && is_swimmer_flag(mdat);
}
// C ref: trap.c set_utrap(tim, typ).  Duplicated from trap.js (which does not
// export it) rather than importing, to keep polyself.js off trap.js's cycle.
function set_utrap(tim, typ) {
    const u = game.u;
    if (!u) return;
    u.utrap = tim;
    u.utraptype = tim ? typ : 0 /* TT_NONE */;
}
// C ref: mondata.h telepathic(ptr) — the three telepathy-granting forms.
function telepathic(mdat) {
    return !!mdat && (mdat.pmidx === PM_FLOATING_EYE
        || mdat.pmidx === PM_MIND_FLAYER || mdat.pmidx === PM_MASTER_MIND_FLAYER);
}
// C ref: mondata.h haseyes(ptr) — !(mflags1 & M1_NOEYES).
function haseyes(mdat) { return !!mdat && (mflags1_of(mdat) & M1_NOEYES) === 0; }
function bigmonst(mdat) { return !!mdat && (mdat.msize ?? 0) >= MZ_LARGE; }
function cantwield(mdat) { return nohands(mdat) || !!mdat?.verysmall; }
function is_placeholder_pm(pmidx) {
    return pmidx === PM_ORC || pmidx === PM_GIANT || pmidx === PM_ELF || pmidx === PM_HUMAN;
}
// C ref: mondata.c sliparm/breakarm.
function sliparm(mdat) { return is_whirly(mdat) || (mdat?.msize ?? 0) <= MZ_SMALL || noncorporeal(mdat); }
function breakarm(mdat) {
    if (sliparm(mdat)) return false;
    return bigmonst(mdat) || ((mdat?.msize ?? 0) > MZ_SMALL && !humanoid(mdat))
        || mdat?.pmidx === PM_MARILITH || mdat?.pmidx === PM_WINGED_GARGOYLE;
}

function an(s) { return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`; }
function rounddiv(x, y) {
    let divsgn = 1;
    if (y < 0) { divsgn = -divsgn; y = -y; }
    if (x < 0) { divsgn = -divsgn; x = -x; }
    let r = Math.trunc(x / y);
    const m = x % y;
    if (2 * m >= y) r++;
    return divsgn * r;
}

// C ref: objnam.c cloak_simple_name(cloak).  otyp 143 == ROBE (u_init.js's
// ROBE constant); MUMMY_WRAPPING/ALCHEMY_SMOCK aren't reachable as a covered
// session's cloak-slot item so only the ROBE special case is modeled.
const ROBE_OTYP = 143;
function cloak_simple_name(obj) {
    if (obj && obj.otyp === ROBE_OTYP) return 'robe';
    return 'cloak';
}

// C ref: def_oc_syms[].name (objclass.h) — used by weapon_descr()'s P_NONE
// fallback.  Only the "class name" path is modeled (the CORPSE/TIN/EGG/STATUE/
// BOULDER/TOWEL/TIN_OPENER and weapon-skill-name special cases in C's
// weapon_descr() aren't reached by any polyself drop_weapon in the covered
// sessions, since the only involuntary drop is a plain TOOL_CLASS item).
const OC_CLASS_NAME = {
    [ILLOBJ_CLASS]: 'illegal objects', [WEAPON_CLASS]: 'weapons',
    [ARMOR_CLASS]: 'armor', [RING_CLASS]: 'rings', [AMULET_CLASS]: 'amulets',
    [TOOL_CLASS]: 'tools', [FOOD_CLASS]: 'food', [POTION_CLASS]: 'potions',
    [SCROLL_CLASS]: 'scrolls', [SPBOOK_CLASS]: 'spellbooks',
    [WAND_CLASS]: 'wands', [COIN_CLASS]: 'coins', [GEM_CLASS]: 'rocks',
    [ROCK_CLASS]: 'large stones', [BALL_CLASS]: 'iron balls',
    [CHAIN_CLASS]: 'chains', [VENOM_CLASS]: 'venoms',
};
// C ref: weapon.c weapon_descr(obj) — shortened "you must drop your X" name.
// This used to answer a flat "weapon" for every WEAPON_CLASS/weptool item; C
// answers the SKILL name ("long sword", "dagger", "quarterstaff", ...), which
// is what the message actually prints for any hero who polymorphs into a
// nohands/verysmall form while wielding a weapon.
//
// Still unported (all inside the P_NONE arm): the CORPSE/TIN/EGG/STATUE/
// BOULDER/TOWEL/TIN_OPENER overrides that use OBJ_NAME instead of the class
// name, and the P_SLING/P_BOW/P_CROSSBOW/P_FLAIL/P_PICK_AXE ammo+special
// renames ("stone"/"gem"/"arrow"/"bolt"/"hook"/"mattock").
function weapon_descr(obj) {
    const skill = weapon_type(obj);
    if (skill === P_NONE) {
        if (obj.globby) return 'glob';
        return makesingular(OC_CLASS_NAME[obj.oclass] || 'thing');
    }
    // P_NAME's rolemnum arg only matters for P_BARE_HANDED_COMBAT, which
    // weapon_type() returns only for a NULL obj — unreachable from here.
    return makesingular(P_NAME(skill, null));
}
// C ref: obj.h is_sword(otmp) — a WEAPON_CLASS item whose oc_skill lies in
// P_SHORT_SWORD(5)..P_SABER(9).  (Note the C macro's low bound is
// P_SHORT_SWORD, NOT P_DAGGER as the older comment block above it suggests.)
const P_NONE = 0, P_SHORT_SWORD = 5, P_SABER = 9;
function is_sword(obj) {
    if (!obj || obj.oclass !== WEAPON_CLASS) return false;
    const sk = OBJECTS[obj.otyp]?.oc_skill ?? P_NONE;
    return sk >= P_SHORT_SWORD && sk <= P_SABER;
}

// C ref: polyself.c dropp(obj) — the dropx() jacket used by break_armor()/
// drop_weapon() to put a worn/wielded item the new form can't keep onto the
// floor under the hero.  C chains dropp -> dropx -> dropy -> dropz, and
// do.c dropz() ends with encumber_msg(): shedding armor mid-polymorph is
// exactly when the new form's much smaller weight_cap() first gets compared
// against the load, so the "Your movements are slowed slightly because of
// your load." line belongs HERE (inside break_armor, before polymon's own
// find_ac()) rather than at polymon's trailing encumber_msg().  That ordering
// is observable: the status line bot() last wrote is the one from the
// "You shrink out of your cloak!" pline, i.e. with the cloak's AC still
// counted, and the encumbrance message's own --More-- freezes it there.
async function dropp(obj) {
    if (!obj) return;
    const u = game.u;
    freeinv(obj);
    place_object(obj, u.ux, u.uy);
    newsym(u.ux, u.uy);
    await encumber_msg();
}

// C ref: polyself.c break_armor() — shed worn armor that no longer fits the
// new form.  Every arm is C's, including the two gates that used to be folded
// into `nohands || verysmall`: the helmet has a SEPARATE has_horns() arm
// (horns pierce a flimsy hat instead of knocking it off) and the boots arm
// also fires for slithy forms and centaurs.
const MAT_LEATHER = 7;                 // objclass.h LEATHER
const RUBBER_HOSE_NAME = 'rubber hose';
function is_flimsy(otmp) {
    const mat = OBJECTS[otmp?.otyp]?.material;
    return (mat !== undefined && mat <= MAT_LEATHER)
        || OBJECTS[otmp?.otyp]?.name === RUBBER_HOSE_NAME;
}
// C ref: do_wear.c hard_helmet(obj) / objnam.c helm_simple_name(helmet).
const MAT_IRON = 11, MAT_MITHRIL = 17, MAT_GLASS = 19;
function hard_helmet(otmp) {
    const mat = OBJECTS[otmp?.otyp]?.material;
    if (mat === undefined) return false;
    return (mat >= MAT_IRON && mat <= MAT_MITHRIL) || mat === MAT_GLASS;
}
function helm_simple_name(helmet) { return hard_helmet(helmet) ? 'helm' : 'hat'; }
// C ref: mondata.c num_horns(ptr) — four two-horned and four one-horned forms.
// Resolved by name off mons[] so a table reshuffle cannot re-point them.
let _hornPmidx = null;
function num_horns(ptr) {
    if (!_hornPmidx) {
        _hornPmidx = new Map();
        for (const n of ['horned devil', 'minotaur', 'Asmodeus', 'Balrog'])
            _hornPmidx.set(name_to_pmidx(n), 2);
        for (const n of ['white unicorn', 'gray unicorn', 'black unicorn', 'ki-rin'])
            _hornPmidx.set(name_to_pmidx(n), 1);
        _hornPmidx.delete(-1);
    }
    return _hornPmidx.get(ptr?.pmidx) || 0;
}
function has_horns(ptr) { return num_horns(ptr) > 0; }
// C ref: mondata.h slithy(ptr) — M1_SLITHY.
function slithy(ptr) { return !!ptr && (mflags1_of(ptr) & M1_SLITHY) !== 0; }
const S_CENTAUR_CLS = 29;

// ── mbodypart(): the per-form anatomy tables ─────────────────────────────────
// C ref: polyself.c mbodypart(mon, part) / body_part(part), indexed by
// hack.h enum bodypart_types (js/const.js ARM..STOMACH).  js/invent.js carries
// a humanoid-only body_part() whose comment says "the contest hero is never
// polymorphed"; that answer is wrong for every polymorphed form and for every
// monster mbodypart() is asked about, so the real dispatch lives here beside
// the rest of polyself.c.
//
// mons[].mcls is C's mptr->mlet (the monsym.h S_* class index, NOT the display
// char, which a symset can remap).
const S_BLOB_CLS = 2, S_COCKATRICE_CLS = 3, S_DOG_CLS = 4, S_EYE_CLS = 5,
      S_FELINE_CLS = 6, S_JELLY_CLS = 10, S_LEPRECHAUN_CLS = 12,
      S_NYMPH_CLS = 14, S_ORC_CLS = 15, S_RODENT_CLS = 18, S_SPIDER_CLS = 19,
      S_UNICORN_CLS = 21, S_VORTEX_CLS = 22, S_WORM_CLS_BP = 23,
      S_LIGHT_CLS = 25, S_ANGEL_CLS = 27, S_DRAGON_CLS_BP = 30,
      S_ELEMENTAL_CLS = 31, S_FUNGUS_CLS = 32, S_GIANT_CLS = 34,
      S_MUMMY_CLS = 39, S_PUDDING_CLS = 42, S_QUANTMECH_CLS = 43,
      S_VAMPIRE_CLS = 48, S_YETI_CLS = 51, S_ZOMBIE_CLS = 52,
      S_HUMAN_CLS = 53, S_EEL_CLS_BP = 57;

const HUMANOID_PARTS = ['arm', 'eye', 'face', 'finger',
    'fingertip', 'foot', 'hand', 'handed',
    'head', 'leg', 'light headed', 'neck',
    'spine', 'toe', 'hair', 'blood',
    'lung', 'nose', 'stomach'];
const JELLY_PARTS = ['pseudopod', 'dark spot', 'front',
    'pseudopod extension', 'pseudopod extremity', 'pseudopod root', 'grasp',
    'grasped', 'cerebral area', 'lower pseudopod', 'viscous', 'middle',
    'surface', 'pseudopod extremity', 'ripples', 'juices', 'surface',
    'sensor', 'stomach'];
const ANIMAL_PARTS = ['forelimb', 'eye', 'face',
    'foreclaw', 'claw tip', 'rear claw',
    'foreclaw', 'clawed', 'head',
    'rear limb', 'light headed', 'neck',
    'spine', 'rear claw tip', 'fur',
    'blood', 'lung', 'nose',
    'stomach'];
const BIRD_PARTS = ['wing', 'eye', 'face', 'wing',
    'wing tip', 'foot', 'wing', 'winged',
    'head', 'leg', 'light headed', 'neck',
    'spine', 'toe', 'feathers', 'blood',
    'lung', 'bill', 'stomach'];
const HORSE_PARTS = ['foreleg', 'eye', 'face',
    'forehoof', 'hoof tip', 'rear hoof',
    'forehoof', 'hooved', 'head',
    'rear leg', 'light headed', 'neck',
    'backbone', 'rear hoof tip', 'mane',
    'blood', 'lung', 'nose',
    'stomach'];
const SPHERE_PARTS = ['appendage', 'optic nerve', 'body', 'tentacle',
    'tentacle tip', 'lower appendage', 'tentacle', 'tentacled', 'body',
    'lower tentacle', 'rotational', 'equator', 'body', 'lower tentacle tip',
    'cilia', 'life force', 'retina', 'olfactory nerve', 'interior'];
const FUNGUS_PARTS = ['mycelium', 'visual area', 'front',
    'hypha', 'hypha', 'root',
    'strand', 'stranded', 'cap area',
    'rhizome', 'sporulated', 'stalk',
    'root', 'rhizome tip', 'spores',
    'juices', 'gill', 'gill',
    'interior'];
const VORTEX_PARTS = ['region', 'eye', 'front',
    'minor current', 'minor current', 'lower current',
    'swirl', 'swirled', 'central core',
    'lower current', 'addled', 'center',
    'currents', 'edge', 'currents',
    'life force', 'center', 'leading edge',
    'interior'];
const SNAKE_PARTS = ['vestigial limb', 'eye', 'face', 'large scale',
    'large scale tip', 'rear region', 'scale gap', 'scale gapped', 'head',
    'rear region', 'light headed', 'neck', 'length', 'rear scale', 'scales',
    'blood', 'lung', 'forked tongue', 'stomach'];
const WORM_PARTS = ['anterior segment', 'light sensitive cell',
    'clitellum', 'setae', 'setae', 'posterior segment',
    'segment', 'segmented', 'anterior segment',
    'posterior', 'over stretched', 'clitellum',
    'length', 'posterior setae', 'setae', 'blood',
    'skin', 'prostomium', 'stomach'];
const SPIDER_PARTS = ['pedipalp', 'eye', 'face', 'pedipalp', 'tarsus',
    'claw', 'pedipalp', 'palped', 'cephalothorax',
    'leg', 'spun out', 'cephalothorax', 'abdomen',
    'claw', 'hair', 'hemolymph', 'book lung',
    'labrum', 'digestive tract'];
const FISH_PARTS = ['fin', 'eye', 'premaxillary', 'pelvic axillary',
    'pelvic fin', 'anal fin', 'pectoral fin', 'finned',
    'head', 'peduncle', 'played out', 'gills',
    'dorsal fin', 'caudal fin', 'scales', 'blood',
    'gill', 'nostril', 'stomach'];
// C ref: polyself.c not_claws[] — claw attacks are overloaded in mons[], so
// these humanoid classes still say "hand".
const NOT_CLAWS_CLS = [S_HUMAN_CLS, S_MUMMY_CLS, S_ZOMBIE_CLS, S_ANGEL_CLS,
    S_NYMPH_CLS, S_LEPRECHAUN_CLS, S_QUANTMECH_CLS, S_VAMPIRE_CLS, S_ORC_CLS,
    S_GIANT_CLS];

const PM_OWLBEAR = name_to_pmidx('owlbear');
const PM_MUMAK = name_to_pmidx('mumak');
const PM_MASTODON = name_to_pmidx('mastodon');
const PM_SHARK = name_to_pmidx('shark');
const PM_JELLYFISH = name_to_pmidx('jellyfish');
const PM_KRAKEN = name_to_pmidx('kraken');
const PM_RAVEN = name_to_pmidx('raven');
const PM_KI_RIN = name_to_pmidx('ki-rin');
const PM_ROTHE = name_to_pmidx('rothe');
const PM_STALKER = name_to_pmidx('stalker');
const PM_STONE_GOLEM = name_to_pmidx('stone golem');
// 3.7 merged incubus/succubus into one row; both names resolve to it.
const PM_AMOROUS_DEMON = name_to_pmidx('amorous demon');

export function mbodypart(mon, part) {
    const mptr = mon?.data || null;
    // C impossible("mbodypart: bad part %d") for part <= NO_PART; the upper
    // bound is C's implicit array extent.
    if (!mptr || !(part >= ARM && part <= STOMACH)) return 'mystery part';
    const mcls = mptr.mcls | 0, mndx = mptr.pmidx;

    /* some special cases */
    if (mcls === S_DOG_CLS || mcls === S_FELINE_CLS || mcls === S_RODENT_CLS
        || mndx === PM_OWLBEAR) {
        switch (part) {
        case HAND: return 'paw';
        case HANDED: return 'pawed';
        case FOOT: return 'rear paw';
        case ARM: case LEG: return HORSE_PARTS[part]; /* "foreleg", "rear leg" */
        default: break; /* other parts fall through to animal_parts[] */
        }
    } else if (mcls === S_YETI_CLS) {
        /* opposable thumbs: yeti/sasquatch, monkey/ape */
        return HUMANOID_PARTS[part];
    }
    if ((part === HAND || part === HANDED)
        && humanoid(mptr) && attacktype(mptr, AT_CLAW)
        && !NOT_CLAWS_CLS.includes(mcls)
        && mndx !== PM_STONE_GOLEM && mndx !== PM_AMOROUS_DEMON)
        return (part === HAND) ? 'claw' : 'clawed';
    if ((mndx === PM_MUMAK || mndx === PM_MASTODON) && part === NOSE)
        return 'trunk';
    if (mndx === PM_SHARK && part === HAIR)
        return 'skin'; /* sharks don't have scales */
    if ((mndx === PM_JELLYFISH || mndx === PM_KRAKEN)
        && (part === ARM || part === FINGER || part === HAND || part === FOOT
            || part === TOE))
        return 'tentacle';
    if (mndx === PM_FLOATING_EYE && part === EYE)
        return 'cornea';
    if (humanoid(mptr) && (part === ARM || part === FINGER || part === FINGERTIP
                           || part === HAND || part === HANDED))
        return HUMANOID_PARTS[part];
    if (mcls === S_COCKATRICE_CLS)
        return (part === HAIR) ? SNAKE_PARTS[part] : BIRD_PARTS[part];
    if (mndx === PM_RAVEN) return BIRD_PARTS[part];
    if (mcls === S_CENTAUR_CLS || mcls === S_UNICORN_CLS || mndx === PM_KI_RIN
        || (mndx === PM_ROTHE && part !== HAIR))
        return HORSE_PARTS[part];
    if (mcls === S_LIGHT_CLS) {
        if (part === HANDED) return 'rayed';
        if (part === ARM || part === FINGER || part === FINGERTIP
            || part === HAND) return 'ray';
        return 'beam';
    }
    if (mndx === PM_STALKER && part === HEAD) return 'head';
    if (mcls === S_EEL_CLS_BP && mndx !== PM_JELLYFISH) return FISH_PARTS[part];
    if (mcls === S_WORM_CLS_BP) return WORM_PARTS[part];
    if (mcls === S_SPIDER_CLS) return SPIDER_PARTS[part];
    if (slithy(mptr) || (mcls === S_DRAGON_CLS_BP && part === HAIR))
        return SNAKE_PARTS[part];
    if (mcls === S_EYE_CLS) return SPHERE_PARTS[part];
    if (mcls === S_JELLY_CLS || mcls === S_PUDDING_CLS || mcls === S_BLOB_CLS
        || mndx === PM_JELLYFISH)
        return JELLY_PARTS[part];
    if (mcls === S_VORTEX_CLS || mcls === S_ELEMENTAL_CLS)
        return VORTEX_PARTS[part];
    if (mcls === S_FUNGUS_CLS) return FUNGUS_PARTS[part];
    if (humanoid(mptr)) return HUMANOID_PARTS[part];
    return ANIMAL_PARTS[part];
}

// C ref: polyself.c body_part(part) == mbodypart(&gy.youmonst, part).
export function body_part(part) {
    return mbodypart({ data: youmonst_data_pub() }, part);
}

// C ref: mondata.c eyecount(ptr) — 0 for an eyeless form, 1 for the two
// one-eyed ones, 2 otherwise.
const PM_CYCLOPS = name_to_pmidx('Cyclops');
export function eyecount(ptr) {
    return !haseyes(ptr) ? 0
        : (ptr?.pmidx === PM_CYCLOPS || ptr?.pmidx === PM_FLOATING_EYE) ? 1 : 2;
}
// C ref: invent.c useup(obj) — the item is DESTROYED, not dropped.
function useup_worn(otmp) {
    otmp.owornmask = 0;
    freeinv(otmp);
}
async function break_armor() {
    const mdat = game.u.data;
    if (breakarm(mdat)) {
        if (game.uarm) {
            const otmp = game.uarm;
            await pline('You break out of your armor!');
            exercise(A_STR, false);
            game.uarm = null;
            useup_worn(otmp);           /* C: useup(), NOT dropp() */
        }
        if (game.uarmc) {
            const otmp = game.uarmc;
            game.uarmc = null;
            // MUMMY_WRAPPING has no clasp and is used up; ALCHEMY_SMOCK has a
            // knot; every other cloak's clasp breaks open and it DROPS.
            const nm = cloak_simple_name(otmp);
            if (nm === 'mummy wrapping') {
                await pline(`Your ${nm} tears apart!`);
                useup_worn(otmp);
            } else if (nm === 'apron') {
                await pline(`The knot on your ${nm} is pulled apart!`);
                otmp.owornmask = 0;
                await dropp(otmp);
            } else {
                await pline(`The clasp on your ${nm} breaks open!`);
                otmp.owornmask = 0;
                await dropp(otmp);
            }
        }
        if (game.uarmu) {
            const otmp = game.uarmu;
            await pline('Your shirt rips to shreds!');
            game.uarmu = null;
            useup_worn(otmp);
        }
    } else if (sliparm(mdat)) {
        if (game.uarm) {
            const otmp = game.uarm;
            await pline('Your armor falls around you!');
            game.uarm = null;
            otmp.owornmask = 0;
            await dropp(otmp);
        }
        if (game.uarmc) {
            const otmp = game.uarmc;
            if (is_whirly(mdat)) await pline(`Your ${cloak_simple_name(otmp)} falls, unsupported!`);
            else await pline(`You shrink out of your ${cloak_simple_name(otmp)}!`);
            game.uarmc = null;
            otmp.owornmask = 0;
            await dropp(otmp);
        }
        if (game.uarmu) {
            const otmp = game.uarmu;
            if (is_whirly(mdat)) await pline('You seep right through your shirt!');
            else await pline('You become much too small for your shirt!');
            game.uarmu = null;
            otmp.owornmask = 0;
            await dropp(otmp);
        }
    }
    // C ref: polyself.c:1229 — the helmet's FIRST gate is has_horns(), which is
    // a different set from nohands||verysmall: a minotaur or unicorn keeps its
    // hands but still cannot wear a hat.
    if (has_horns(mdat) && game.uarmh) {
        const otmp = game.uarmh;
        if (is_flimsy(otmp)) {
            const hornbuf = `horn${num_horns(mdat) === 1 ? '' : 's'}`;
            await pline(`Your ${hornbuf} ${num_horns(mdat) === 1 ? 'pierces' : 'pierce'} your ${xname(otmp)}.`);
        } else {
            await pline(`Your ${helm_simple_name(otmp)} falls to the ${surface(game.u.ux, game.u.uy)}!`);
            game.uarmh = null;
            otmp.owornmask = 0;
            await dropp(otmp);
        }
    }
    if (nohands(mdat) || mdat?.verysmall) {
        if (game.uarmg) {
            const otmp = game.uarmg;
            await pline(`You drop your gloves${game.uwep ? ' and weapon' : ''}!`);
            await drop_weapon(0);
            game.uarmg = null;
            otmp.owornmask = 0;
            await dropp(otmp);
        }
        if (game.uarms) {
            const otmp = game.uarms;
            await pline('You can no longer hold your shield!');
            game.uarms = null;
            otmp.owornmask = 0;
            await dropp(otmp);
        }
        if (game.uarmh) {
            const otmp = game.uarmh;
            await pline(`Your ${helm_simple_name(otmp)} falls to the ${surface(game.u.ux, game.u.uy)}!`);
            game.uarmh = null;
            otmp.owornmask = 0;
            await dropp(otmp);
        }
    }
    // C ref: polyself.c:1272 — slithy forms and centaurs shed boots too.
    if (nohands(mdat) || mdat?.verysmall || slithy(mdat) || mdat?.mlet === 'C') {
        if (game.uarmf) {
            const otmp = game.uarmf;
            if (is_whirly(mdat)) await pline('Your boots fall away!');
            else await pline(`Your boots ${mdat?.verysmall ? 'slide' : 'are pushed'} off your feet!`);
            game.uarmf = null;
            otmp.owornmask = 0;
            await dropp(otmp);
        }
    }
    // C ref: polyself.c:1291-1300 — the ublindf arm ("Your blindfold falls
    // off!", gated on !has_head).  This port has no ublindf slot to shed.
}

// C ref: polyself.c drop_weapon(alone) — shed a wielded weapon the new form
// can't use.  canletgo()'s cursed/welded-weapon branch isn't modeled (matches
// the existing invent.js welded() stub, which always returns false), so C's
// what[] is always "drop" and never "release".  Two-weaponing (u.twoweap /
// uswapwep) is not modeled anywhere in this port.
async function drop_weapon(alone) {
    const u = game.u;
    if (!game.uwep) return;
    if (!alone || cantwield(u.data)) {
        let which = is_sword(game.uwep) ? 'sword' : weapon_descr(game.uwep);
        if (alone) {
            // C ref: polyself.c:1327 — a stacked wielded weapon pluralizes:
            // "You find you must drop your daggers!".
            if ((game.uwep.quan || 1) !== 1) which = makeplural(which);
            // C ref: the_your[!!strncmp(which, "corpse", 6)]: "the" for a
            // corpse, else "your".
            const theYour = which.startsWith('corpse') ? 'the' : 'your';
            await pline(`You find you must drop ${theYour} ${which}!`);
        }
        const otmp = game.uwep;
        game.uwep = null;
        otmp.owornmask = 0;
        await dropp(otmp);
    }
}

// C ref: polyself.c set_uasmon() — update youmonst.data + the form-derived
// intrinsics.  Only FLYING and LEVITATION are wired.
//
// DEFERRED, and this is a real gap, not a cosmetic one: C's PROPSET() sets or
// CLEARS a FROMFORM bit on ~25 properties, and several of them steer RNG.
// BLINDED(!haseyes) alone gates every canseemon/couldsee predicate in the
// game; SEE_INVIS, TELEPAT, INFRAVISION, PASSES_WALLS, SWIMMING and the eight
// resistances all feed damage and to-hit branches.  Porting them needs a
// per-source intrinsic bit (FROMFORM) that this port's u.uprops (a flat 0/1
// per property) cannot express — setting them here would clobber the same
// property's other sources (a cream-pie BLINDED, an intrinsic TELEPAT) on the
// next set_uasmon() call.  That representation change is the prerequisite.
//
// Also deferred from this function: vampshifter cham tracking, float_vs_flight()
// (BFlying|I_SPECIAL, and its disp.botl), steed_vs_stealth() and polysense().
export function set_uasmon() {
    const u = game.u;
    const mdat = monster_by_pmidx(u.umonnum);
    // C ref: mondata.c:13 set_mon_data() — leftover movement points are prorated
    // when the new form is SLOWER.  Human->gnome takes u.umovement 12 -> 6, which
    // changes how many turns every later hero command costs.
    // (u.data is unset before the first polymorph in this port; every
    // player-monster form has mmove == NORMAL_SPEED, hence the 12 default.)
    if (u.umovement) {
        const old_speed = u.data ? base_mmove({ data: u.data }) : 12;
        const new_speed = base_mmove({ data: mdat });
        if (new_speed < old_speed && old_speed > 0)
            u.umovement = Math.trunc((u.umovement * new_speed) / old_speed);
    }
    u.data = mdat;
    u.Upolyd = u.umonnum !== u.umonster;

    u.uprops = u.uprops || {};
    // C ref: polyself.c:99-100 PROPSET(FLYING, (is_flyer(mdat) && !is_floater(mdat))).
    // is_flyer() is the M1_FLY bit; this used to be a hand-curated pmidx set of
    // the ten dragons, which answered FALSE for every other winged form (bat,
    // raven, stalker, air elemental, every 'A'/'B'/'y'...).  u.uprops.Flying
    // gates trap.c immune_to_trap()/pooleffects(), timeout.c's u.umoved
    // branch and invent.c's wounded-legs term, so a wrong answer here is not
    // cosmetic: a poly'd flyer falls into pits it should soar over.
    u.uprops.Flying = (is_flyer_flag(mdat) && !is_floater(mdat)) ? 1 : 0;
    u.uprops.Levitation = is_floater(mdat) ? 1 : 0;
    // C ref: polyself.c:96 PROPSET(BLINDED, !haseyes(mdat)) — an eyeless form
    // (vortex, black pudding, ...) is blind for as long as it lasts.  Kept in
    // its OWN field rather than u.blinded: u.blinded is a TIMEOUT that
    // timeout.js counts down, and C carries this on a separate FROMFORM bit.
    // Only ever non-zero while polymorphed, so an unpolymorphed hero (whose
    // player monster always haseyes) is unaffected.
    u.uprops.BlindedFromForm = (u.Upolyd && !haseyes(mdat)) ? 1 : 0;
    // C ref: polyself.c:153 — set_uasmon() ends with disp.botl = TRUE, so the
    // status is ALREADY dirty by the time polymon's break_armor() -> dropp() ->
    // encumber_msg() runs, and the FIRST pline after the form change publishes
    // the new HD/HP *and* the new (much smaller) weight_cap's "Burdened".
    game.botl = true;
}

// C ref: polyself.c uasmon_maxStr().
export function uasmon_maxStr() {
    const mndx = game.u.umonnum;
    const mdat = monster_by_pmidx(mndx);
    let raceLocal = null;
    // C ref: polyself.c:1085-1088 — orc captains and Uruk-hai are the two orcs
    // that KEEP mndx (and so get no player-race cap), because they retain
    // 18/100 where a hero orc is limited to 18/50.
    if (is_orc_flag(mdat)) {
        if (mndx !== PM_URUK_HAI() && mndx !== PM_ORC_CAPTAIN())
            raceLocal = RACE_LOCAL.ORC;
    } else if (is_elf_flag(mdat)) raceLocal = RACE_LOCAL.ELF;
    else if (is_dwarf_flag(mdat)) raceLocal = RACE_LOCAL.DWARF;
    else if (is_gnome_flag(mdat)) raceLocal = RACE_LOCAL.GNOME;
    // C's is_human() arm is #if 0'd out ("use the mons[] value for humans"),
    // but character_race(PM_HUMAN) still answers the human race, so the
    // placeholder keeps human bounds.
    else if (mndx === PM_HUMAN) raceLocal = RACE_LOCAL.HUMAN;

    if (raceLocal != null) {
        const amax = race_attrmax_of(raceLocal);
        return amax[A_STR];
    }
    if (strongmonst_flag(mdat)) {
        const liveH = is_giant_flag(mdat) && !is_undead_flag(mdat);
        // attrib.h:36-37 STR18(x) == 18+x, STR19(x) == 100+x.  This used to
        // return a bare 19 for STR19(19); 19 is the ENCODING for 18/01, so
        // every live giant form showed St:18/01 instead of St:19.
        return liveH ? 119 : 118;
    }
    return 18;
}

// C ref: role.c races[].individual / .noun as consumed by polyself.c newman().
// role.js's races[] carries noun/adj but not the RoleName `individual`, which
// in C is {"man","woman"} for human and {0,0} for every other player race.
function urace_newform(female) {
    const idx = Number.isInteger(game.initrace)
        ? game.initrace
        : races.findIndex((r) => r.name?.toLowerCase() === String(game.initrace || '').toLowerCase());
    const race = races[idx >= 0 ? idx : 0] || races[0];
    if (race?.name === 'human') return female ? 'woman' : 'man';
    return race?.noun || 'human';
}

// C ref: attrib.c redist_attr() — reroll AMAX for every attribute but Int/Wis
// after a level change (newman()).  ATTRMAX/ATTRMIN read the hero's fixed
// race bounds (gu.urace), unaffected by the current polymorphed form.
function redist_attr() {
    const u = game.u;
    const attrmax = race_attrmax();
    const attrmin = race_attrmin();
    for (let i = 0; i < A_MAX; i++) {
        if (i === A_INT || i === A_WIS) continue;
        const tmp = u.amax.a[i];
        u.amax.a[i] += (rn2(5) - 2);
        if (u.amax.a[i] > attrmax[i]) u.amax.a[i] = attrmax[i];
        if (u.amax.a[i] < attrmin[i]) u.amax.a[i] = attrmin[i];
        u.acurr.a[i] = Math.trunc((u.acurr.a[i] * u.amax.a[i]) / tmp);
        if (u.acurr.a[i] < attrmin[i]) u.acurr.a[i] = attrmin[i];
    }
}

// C ref: do_name.c pmname(pm, mgender) — a NAMS() species carries distinct
// male/female names ("gnome lord"/"gnome lady", "priest"/"priestess"), and
// every polyself message prints the one matching flags.female.  Using
// mons[].pmnames[NEUTRAL] instead makes a female hero "turn into a gnome
// lord".  Lazily imported: uhitm.js owns the gendered-name map and pulling it
// in statically would put polyself.js on uhitm's import chain.
let _mon_pmname = null;
async function pmname_of(mdat, female) {
    if (!_mon_pmname) ({ mon_pmname: _mon_pmname } = await import('./uhitm.js'));
    return _mon_pmname({ data: mdat, female: !!female });
}

// C ref: polyself.c polymon(mntmp) — (try to) make a mntmp monster out of the
// player.  gs.sex_change_ok's gate around the gender-flip roll is modeled as
// always-active: ground truth (seed0108's recorded RNG trace) shows the
// rn2(10) roll firing for a #polyself-driven polymon()/newman() even though a
// static reading of polyself.c suggests gs.sex_change_ok should be 0 (it's
// only incremented around the OTHER, non-controlled call site at
// polyself.c:711-718) for this call path — flagged for future investigation,
// but the recorded trace is the actual scoring target so it wins here.
export async function polymon(mntmp) {
    const u = game.u;
    const mdatNew = monster_by_pmidx(mntmp);
    if (!mdatNew) return 0;

    if ((game.mvitals?.[mntmp]?.mvflags ?? 0) & 0x02 /* G_GENOD */) {
        await pline(`You feel rather ${await pmname_of(mdatNew, game.flags.female)}-ish.`);
        exercise(A_WIS, true);
        return 0;
    }

    u.uconduct = u.uconduct || {};
    // `undefined++` is NaN, and NaN is falsy forever: the counter never left 0
    // so #conduct always said "You have never changed form."
    u.uconduct.polyselfs = u.uconduct.polyselfs | 0;
    if (!u.uconduct.polyselfs++) {
        livelog_printf(LL_CONDUCT,
            `changed form for the first time, becoming ${an(await pmname_of(mdatNew, game.flags.female))}`);
    }

    exercise(A_CON, false);
    exercise(A_WIS, true);

    if (!u.Upolyd) {
        u.macurr = { a: (u.acurr.a || []).slice() };
        u.mamax = { a: (u.amax.a || []).slice() };
        u.mfemale = !!game.flags.female;
    } else {
        u.acurr = { a: (u.macurr.a || []).slice() };
        u.amax = { a: (u.mamax.a || []).slice() };
        game.flags.female = !!u.mfemale;
    }

    let dochange = false;
    if (is_male_flag(mdatNew)) {
        if (game.flags.female) dochange = true;
    } else if (is_female_flag(mdatNew)) {
        if (!game.flags.female) dochange = true;
    } else if (!is_neuter_flag(mdatNew) && mntmp !== u.ulycn) {
        if (!rn2(10)) dochange = true;
    }

    const turnedInto = u.umonnum !== mntmp;
    let buf = turnedInto ? '' : 'new ';
    if (dochange) {
        game.flags.female = !game.flags.female;
        buf += (is_male_flag(mdatNew) || is_female_flag(mdatNew)) ? '' : (game.flags.female ? 'female ' : 'male ');
    }
    buf += await pmname_of(mdatNew, game.flags.female);
    await pline(`You ${turnedInto ? 'turn into' : 'feel like'} ${an(buf)}!`);

    u.mtimedone = rn1(500, 500);
    u.umonnum = mntmp;
    set_uasmon();

    const newMaxStr = uasmon_maxStr();
    if (strongmonst_flag(mdatNew)) {
        u.acurr.a[A_STR] = newMaxStr;
        u.amax.a[A_STR] = newMaxStr;
    } else {
        u.amax.a[A_STR] = newMaxStr;
        if (u.acurr.a[A_STR] > u.amax.a[A_STR]) u.acurr.a[A_STR] = u.amax.a[A_STR];
    }

    const mlvl = mdatNew.mlevel | 0;
    if (mdatNew.mlet === 'D' && mntmp >= PM_GRAY_DRAGON) {
        // C ref: polyself.c:858 In_endgame ? 8*mlvl : 4*mlvl + d(mlvl,4).
        u.mhmax = In_endgame(u.uz) ? (8 * mlvl) : (4 * mlvl + d(mlvl, 4));
    } else if (is_golem(mdatNew)) {
        // C ref: golems.c golemhp(type) — a fixed per-species table, NOT
        // mlvl*10 (straw/paper are 20 at mlevel 3/3, clay is 70 at 11...).
        u.mhmax = golemhp(mntmp);
    } else {
        u.mhmax = !mlvl ? rnd(4) : d(mlvl, 8);
        // C ref: polyself.c:869 — an elemental on its own home plane is 3x.
        if (is_home_elemental(mdatNew)) u.mhmax *= 3;
    }
    u.mh = u.mhmax;

    if ((u.ulevel || 1) < mlvl) {
        u.mtimedone = Math.floor(u.mtimedone * (u.ulevel || 1) / mlvl);
    }

    // C ref: polyself.c polymon() — the new form's u.mh/u.mhmax leave disp.botl
    // dirty, so the NEXT pline()'s flush_screen(1) runs bot(), and bot()
    // recomputes BL_CAP from a live near_capacity().  That pline is
    // break_armor()'s "You shrink out of your <cloak>!", which is why seed0108
    // step 78 shows "Burdened" on its --More-- while AC is still the
    // pre-find_ac() value.  This port's status row is live except for the
    // capacity field, which encumber_msg() publishes, so publish it here.
    game._curcap = near_capacity();
    await break_armor();
    await drop_weapon(1);
    find_ac();

    // C ref: polyself.c:891-893 — DRAWS rn1(6,2).  Changing form while in a
    // pit resets the escape countdown.  (hideunder() for a was_hiding_under
    // hero, which C runs just above this, is still unported.)
    if (u.utrap && u.utraptype === TT_PIT) set_utrap(rn1(6, 2), TT_PIT);

    newsym(u.ux, u.uy);

    find_ac();
    game.botl = true;
    // C ref: polyself.c:1016-1018 — vision_full_recalc + see_monsters().  A
    // blind hero keeps a stale monster glyph on screen until something
    // newsym()s that square; without this pass the pre-poly 'e' never cleared.
    game.vision_full_recalc = 1;
    see_monsters();
    await encumber_msg();

    if (game.flags.verbose) {
        const mightHide = is_hider_flag(mdatNew) || hides_under_flag(mdatNew);
        if (can_breathe(mdatNew)) await pline('Use the command #monster to use your breath weapon.');
        if (has_spit(mdatNew)) await pline('Use the command #monster to spit venom.');
        if (mdatNew.mlet === 'n') await pline('Use the command #monster to remove an iron ball.');
        if (has_gaze(mdatNew)) await pline('Use the command #monster to gaze at monsters.');
        if (mightHide && webmaker(mdatNew)) await pline('Use the command #monster to hide or to spin a web.');
        else if (mightHide) await pline('Use the command #monster to hide.');
        else if (webmaker(mdatNew)) await pline('Use the command #monster to spin a web.');
        if (is_were_flag(mdatNew)) await pline('Use the command #monster to summon help.');
        if (u.umonnum === PM_GREMLIN) await pline('Use the command #monster to multiply in a fountain.');
        if (is_unicorn_pm(mdatNew)) await pline('Use the command #monster to use your horn.');
        if (is_mind_flayer_pm(mdatNew)) await pline('Use the command #monster to emit a mental blast.');
        if (msound_of(mdatNew) === MS_SHRIEK) await pline('Use the command #monster to shriek.');
        if (is_vampire_pm(mdatNew)) await pline('Use the command #monster to change shape.');
        // C ref: polyself.c:1069-1073 — the giant/electric eel exclusion is on
        // the FORM, and eggs_in_water() picks the verb.
        if (lays_eggs_flag(mdatNew) && game.flags.female
            && !(mdatNew.pmidx === PM_GIANT_EEL || mdatNew.pmidx === PM_ELECTRIC_EEL)) {
            await pline(`Use the command #sit to ${eggs_in_water(mdatNew) ? 'spawn in the water' : 'lay an egg'}.`);
        }
    }
    return 1;
}

// C ref: polyself.c polyman(fmt, arg) + newman() — fail-to-poly / werecritter
// path: revert to human form, with a level/attribute/HP/PW reroll.
export async function newman() {
    const u = game.u;
    const oldlvl = u.ulevel || 1;
    let newlvl = oldlvl + rn1(5, -2);
    if (newlvl > 127 || newlvl < 1) {
        // C ref: polyself.c:344 `goto dead` — urgent_pline("Your new form
        // doesn't seem healthy enough to survive.") + done(DIED).  NOT a
        // clamp: C SKIPS the whole rest of newman() (adjabil, rndexp,
        // redist_attr, per-level newhp()/newpw(), rn1(500,500)), so every RNG
        // draw below is wrong on this arm as well as the outcome.
        //
        // DEFERRED, and it is REACHABLE: rn1(5,-2) is {-2..+2}, so any hero at
        // experience level 1 or 2 hits it.  Porting it needs done(DIED) from
        // end.js, which this module cannot call without dragging the whole
        // death/bones path in; the same gap blocks the u.uhp<=0 arm below.
        newlvl = 1;
    }
    const MAXULEV = 30;
    if (newlvl > MAXULEV) newlvl = MAXULEV;
    if (newlvl < oldlvl) u.ulevelmax = (u.ulevelmax || oldlvl) - (oldlvl - newlvl);
    if ((u.ulevelmax || 0) < newlvl) u.ulevelmax = newlvl;
    u.ulevel = newlvl;

    // gs.sex_change_ok gate: see the polymon() comment above re: ground truth.
    if (!rn2(10)) {
        // C ref: polyself.c change_sex() — flips flags.female (and u.mfemale
        // while Upolyd), reloads svp.pl_character from urole.name.f/.m and
        // re-runs max_rank_sz().  DEFERRED: the visible half is the status
        // line's rank string, which this port builds from game.flags.female
        // in exper.js update_rank(); flipping it here without the matching
        // pl_character reload would desync the two.  RNG-free either way.
    }

    await adjabil(oldlvl, u.ulevel, (msg) => pline(msg));

    // rndexp(FALSE): random XP within the OLD level's threshold band (u.ulevel
    // at this point is the NEW level; rndexp reads u.ulevel internally in C,
    // but that call happens before oldlvl's HP/PW rerolls touch u.ulevel
    // again, so it uses the just-set newlvl there — mirror that: min/max
    // bracket the NEW level, not the old one).
    {
        const minexp = (u.ulevel === 1) ? 0 : newuexp(u.ulevel - 1);
        const maxexp = newuexp(u.ulevel);
        const diff = maxexp - minexp;
        u.uexp = minexp + rn2(diff);
    }

    redist_attr();

    let hpmax = u.uhpmax || 0;
    for (let i = 0; i < oldlvl; i++) hpmax -= (u.uhpinc?.[i] || 0);
    hpmax = rounddiv(hpmax * rn1(4, 8), 10);
    for (let i = 0; (u.ulevel = i) < newlvl; i++) hpmax += newhp();
    if (hpmax < u.ulevel) hpmax = u.ulevel;
    u.uhp = rounddiv((u.uhp || 0) * hpmax, u.uhpmax || 1);
    u.uhpmax = hpmax;
    if (u.uhp > u.uhpmax) u.uhp = u.uhpmax;

    let enmax = u.uenmax || 0;
    for (let i = 0; i < oldlvl; i++) enmax -= (u.ueninc?.[i] || 0);
    enmax = rounddiv(enmax * rn1(4, 8), 10);
    for (let i = 0; (u.ulevel = i) < newlvl; i++) enmax += newpw();
    if (enmax < u.ulevel) enmax = u.ulevel;
    u.uen = rounddiv((u.uen || 0) * enmax, (u.uenmax || 1) < 1 ? 1 : (u.uenmax || 1));
    u.uenmax = enmax;

    u.uhunger = rn1(500, 500);

    newuhs(false);
    update_rank();

    // C ref: polyself.c:446-450 — newform = races[].individual.f/.m, else
    // races[].noun.  Only human has an individual noun ("man"/"woman"); an
    // elf/dwarf/gnome/orc hero gets "You feel like a new elf!" etc.  The
    // gender read is the SAVED one (u.mfemale while Upolyd), not the current
    // form's, because polyman() below is about to restore it.
    const newform = urace_newform(u.Upolyd ? !!u.mfemale : !!game.flags.female);
    await polyman('You feel like a new %s!', newform);

    game.botl = true;
    await encumber_msg();
}

// C ref: polyself.c polyman(fmt, arg) — the shared "return to human form"
// tail used by both newman() and (eventually) rehumanize().
async function polyman(fmt, arg) {
    const u = game.u;
    const was_blind = Blind();
    if (u.Upolyd) {
        u.acurr = { a: (u.macurr.a || []).slice() };
        u.amax = { a: (u.mamax.a || []).slice() };
        u.umonnum = u.umonster;
        game.flags.female = !!u.mfemale;
    }
    set_uasmon();

    u.mh = u.mhmax = 0;
    u.mtimedone = 0;
    find_ac();

    // C ref: polyself.c:254-256 — DRAWS rn1(6,2).  Reverting to human while in
    // a pit resets the escape countdown, exactly as polymon() does.
    if (u.utrap && u.utraptype === TT_PIT) set_utrap(rn1(6, 2), TT_PIT);

    newsym(u.ux, u.uy);

    // C's rehumanize() uses urgent_pline here.  It must override WIN_STOP when
    // the fatal form damage was acknowledged with ESC, otherwise the return
    // form (and the following sight-restoration message) disappears.
    await urgent_topl(fmt.replace('%s', arg));
    if (was_blind && !Blind()) await update_topl('You can see again.');
}


// ── polyself.c polyself() and its name-resolution helpers ────────────────────

// C ref: include/defsym.h MONSYM(idx, ch, basename, sym, desc) — the monster
// CLASS table.  name_to_monclass() matches a typed word against `desc`, so a
// controlled polymorph accepts "dragon", "major demon" or "ant or other
// insect" as readily as the class letter.  Transcribed whole: a subset
// covering only the classes one corpus happens to name answers 0 (== "I've
// never heard of such monsters") for every other class.
const DEF_MONSYMS = [
    [1, 'a', 'ant or other insect'], [2, 'b', 'blob'], [3, 'c', 'cockatrice'],
    [4, 'd', 'dog or other canine'], [5, 'e', 'eye or sphere'],
    [6, 'f', 'cat or other feline'], [7, 'g', 'gremlin'], [8, 'h', 'humanoid'],
    [9, 'i', 'imp or minor demon'], [10, 'j', 'jelly'], [11, 'k', 'kobold'],
    [12, 'l', 'leprechaun'], [13, 'm', 'mimic'], [14, 'n', 'nymph'],
    [15, 'o', 'orc'], [16, 'p', 'piercer'], [17, 'q', 'quadruped'],
    [18, 'r', 'rodent'], [19, 's', 'arachnid or centipede'],
    [20, 't', 'trapper or lurker above'], [21, 'u', 'unicorn or horse'],
    [22, 'v', 'vortex'], [23, 'w', 'worm'],
    [24, 'x', 'xan or other mythical/fantastic insect'], [25, 'y', 'light'],
    [26, 'z', 'zruty'], [27, 'A', 'angelic being'], [28, 'B', 'bat or bird'],
    [29, 'C', 'centaur'], [30, 'D', 'dragon'], [31, 'E', 'elemental'],
    [32, 'F', 'fungus or mold'], [33, 'G', 'gnome'], [34, 'H', 'giant humanoid'],
    [35, 'I', 'invisible monster'], [36, 'J', 'jabberwock'],
    [37, 'K', 'Keystone Kop'], [38, 'L', 'lich'], [39, 'M', 'mummy'],
    [40, 'N', 'naga'], [41, 'O', 'ogre'], [42, 'P', 'pudding or ooze'],
    [43, 'Q', 'quantum mechanic'], [44, 'R', 'rust monster or disenchanter'],
    [45, 'S', 'snake'], [46, 'T', 'troll'], [47, 'U', 'umber hulk'],
    [48, 'V', 'vampire'], [49, 'W', 'wraith'], [50, 'X', 'xorn'],
    [51, 'Y', 'apelike creature'], [52, 'Z', 'zombie'], [53, '@', 'human or elf'],
    [54, ' ', 'ghost'], [55, "'", 'golem'], [56, '&', 'major demon'],
    [57, ';', 'sea monster'], [58, ':', 'lizard'], [59, '~', 'long worm tail'],
    [60, ']', 'mimic'],
];
const MAXMCLASSES = 61;
const S_MIMIC_CLS = 13, S_MIMIC_DEF_CLS = 60, S_WORM_CLS = 23,
      S_WORM_TAIL_CLS = 59, S_INVISIBLE_CLS = 35, S_LICH_CLS = 38,
      S_DRAGON_CLS = 30, S_DEMON_CLS = 56, S_XAN_CLS = 24, S_EEL_CLS = 57;

// C ref: monsym.h def_char_to_monclass(ch).
function def_char_to_monclass(ch) {
    for (const [idx, sym] of DEF_MONSYMS) if (sym === ch) return idx;
    return MAXMCLASSES;
}

// mons[] bounds, resolved off the table rather than transcribed (permonst.h
// SPECIAL_PM == PM_LONG_WORM_TAIL; mons[SPECIAL_PM..NUMMONS-1] are never
// generated randomly and cannot be polymorphed into).
const LOW_PM_IDX = 0, NON_PM = -1;
let _NUMMONS = -1, _SPECIAL_PM = -1;
function NUMMONS() {
    if (_NUMMONS < 0) { let i = 0; while (monster_by_pmidx(i)) i++; _NUMMONS = i; }
    return _NUMMONS;
}
function SPECIAL_PM() {
    if (_SPECIAL_PM < 0) _SPECIAL_PM = name_to_pmidx('long worm tail');
    return _SPECIAL_PM;
}
// Two mons[] rows share a name for each werecreature (animal form first, then
// the '@' human form), so the alt-spelling table has to address them by
// occurrence rather than by name_to_pmidx()'s first-hit answer.
function nth_pmidx_by_name(name, nth) {
    let seen = 0;
    for (let i = 0; i < NUMMONS(); i++)
        if (monster_by_pmidx(i)?.name === name && seen++ === nth) return i;
    return NON_PM;
}

// C ref: mondata.c name_to_monplus()'s alt_spl names[] — alternate spellings,
// outdated names and irregular plurals, matched as a whole leading WORD before
// the mons[] scan.  Table order is C's; first match wins.  Entries whose
// target species this port's mons[] slice lacks resolve to NON_PM and fall
// through to the general scan rather than being dropped from the table.
const ALT_SPELLINGS = [
    ['grey dragon', 'gray dragon', 2], ['baby grey dragon', 'baby gray dragon', 2],
    ['grey unicorn', 'gray unicorn', 2], ['grey ooze', 'gray ooze', 2],
    ['gray-elf', 'Grey-elf', 2], ['mindflayer', 'mind flayer', 2],
    ['master mindflayer', 'master mind flayer', 2],
    ['aligned priest', 'aligned cleric', 0], ['aligned priestess', 'aligned cleric', 1],
    ['high priest', 'high cleric', 0], ['high priestess', 'high cleric', 1],
    ['master of thief', 'master of thieves', 2], ['master thief', 'master of thieves', 2],
    ['master of assassin', 'master assassin', 2],
    ['master-lich', 'master lich', 2], ['masterlich', 'master lich', 2],
    ['invisible stalker', 'stalker', 2], ['high-elf', 'elven monarch', 2],
    ['wood-elf', 'Woodland-elf', 2], ['wood elf', 'Woodland-elf', 2],
    ['woodland nymph', 'wood nymph', 2], ['halfling', 'hobbit', 2],
    ['genie', 'djinni', 2],
    ['human wererat', ['wererat', 1], 2], ['human werejackal', ['werejackal', 1], 2],
    ['human werewolf', ['werewolf', 1], 2],
    ['rat wererat', ['wererat', 0], 2], ['jackal werejackal', ['werejackal', 0], 2],
    ['wolf werewolf', ['werewolf', 0], 2],
    ['ki rin', 'ki-rin', 2], ['kirin', 'ki-rin', 2], ['uruk hai', 'Uruk-hai', 2],
    ['orc captain', 'orc-captain', 2], ['woodland elf', 'Woodland-elf', 2],
    ['green elf', 'Green-elf', 2], ['grey elf', 'Grey-elf', 2],
    ['gray elf', 'Grey-elf', 2],
    ['elf lady', 'elf-noble', 1], ['elf lord', 'elf-noble', 0],
    ['elf noble', 'elf-noble', 2], ['olog hai', 'Olog-hai', 2],
    ['arch lich', 'arch-lich', 2], ['archlich', 'arch-lich', 2],
    ['incubi', 'amorous demon', 0], ['succubi', 'amorous demon', 1],
    ['violet fungi', 'violet fungus', 2], ['homunculi', 'homunculus', 2],
    ['baluchitheria', 'baluchitherium', 2], ['lurkers above', 'lurker above', 2],
    ['cavemen', 'cave dweller', 0], ['cavewomen', 'cave dweller', 1],
    ['watchmen', 'watchman', 2], ['djinn', 'djinni', 2], ['mumakil', 'mumak', 2],
    ['erinyes', 'erinys', 2],
];

// Every pmnames[] slot of every mons[] row: [name, pmidx, mgender].  C's
// name_to_monplus() walks mons[] rows in index order and, within a row, MALE
// then FEMALE then NEUTRAL, keeping the LONGEST match — so build the rows in
// that same order.
let _PMNAME_ROWS = null;
async function pmnameRows() {
    if (_PMNAME_ROWS) return _PMNAME_ROWS;
    const rows = [];
    for (let i = 0; i < NUMMONS(); i++) {
        const mdat = monster_by_pmidx(i);
        if (!mdat) continue;
        const male = await pmname_of(mdat, false), female = await pmname_of(mdat, true);
        if (male) rows.push([male, i, MGEND_MALE]);
        if (female && female !== male) rows.push([female, i, MGEND_FEMALE]);
        if (mdat.name && mdat.name !== male && mdat.name !== female)
            rows.push([mdat.name, i, MGEND_NEUTRAL]);
    }
    _PMNAME_ROWS = rows;
    return rows;
}

// C ref: mondata.c name_to_monplus(in_str, remainder_p, gender_name_var).
// DEFERRED: title_to_mon()'s rank-title fallback (what makes "lord" resolve to
// a player monster) — role.js has the rank titles but not the role ->
// player-monster map it needs.
async function name_to_mon(in_str) {
    let str = String(in_str || '');
    let gvariant = MGEND_NEUTRAL, matchgend = -1;

    if (str.startsWith('a ')) str = str.slice(2);
    else if (str.startsWith('an ')) str = str.slice(3);
    else if (str.startsWith('the ')) str = str.slice(4);

    const vi = str.toLowerCase().indexOf('vortices');
    if (vi >= 0) str = str.slice(0, vi + 4) + 'ex';
    else if (str.length > 3 && /ies$/i.test(str)
             && (str.length < 7 || !/zombies$/i.test(str)))
        str = str.slice(0, -3) + 'y';
    else if (str.length > 3 && /ves$/i.test(str)) str = str.slice(0, -3) + 'f';

    const lower = str.toLowerCase();
    for (const [alt, real, gh] of ALT_SPELLINGS) {
        if (!lower.startsWith(alt)) continue;
        const c = lower[alt.length];
        if (c !== undefined && c !== ' ' && c !== "'") continue;
        const pm = Array.isArray(real) ? nth_pmidx_by_name(real[0], real[1])
                                       : name_to_pmidx(real);
        if (pm >= LOW_PM_IDX) return { mntmp: pm, gvariant: gh };
    }

    let mntmp = NON_PM, len = 0;
    for (const [nm, idx, mgend] of await pmnameRows()) {
        const nl = nm.length;
        if (nl <= len || !lower.startsWith(nm.toLowerCase())) continue;
        const rest = lower.slice(nl);
        if (rest === '') { mntmp = idx; len = nl; matchgend = mgend; break; }
        if (rest[0] === ' ' || rest === 's' || rest.startsWith('s ')
            || rest === "'" || rest.startsWith("' ") || rest === "'s"
            || rest.startsWith("'s ") || rest === 'es' || rest.startsWith('es ')) {
            mntmp = idx; len = nl; matchgend = mgend;
        }
    }
    if (matchgend !== -1) gvariant = matchgend;
    return { mntmp, gvariant };
}

// C ref: mondata.c name_to_monclass(in_str, mndx_p).  klass is 0 for no match.
const CLASS_FALSEMATCH = ['an', 'the', 'or', 'other', 'or other'];
const CLASS_TRUEMATCH = [
    ['long worm', 'long worm', 0], ['demon', null, S_DEMON_CLS],
    ['devil', null, S_DEMON_CLS], ['bug', null, S_XAN_CLS],
    ['fish', null, S_EEL_CLS],
];
async function name_to_monclass(in_str) {
    let mndx = NON_PM;
    const s = String(in_str || '');
    if (!s) return { klass: 0, mndx };
    if (s.length === 1) {
        let i = def_char_to_monclass(s);
        if (i === S_MIMIC_DEF_CLS) i = S_MIMIC_CLS;
        else if (i === S_WORM_TAIL_CLS) { i = S_WORM_CLS; mndx = name_to_pmidx('long worm'); }
        else if (i === MAXMCLASSES) i = (s === 'I') ? S_INVISIBLE_CLS : 0;
        return { klass: i, mndx };
    }
    if (s.toLowerCase() === 'long') return { klass: 0, mndx };
    const sing = String(makesingular(s));
    const lower = sing.toLowerCase();
    if (CLASS_FALSEMATCH.includes(lower)) return { klass: 0, mndx };
    for (const [nm, monName, klass] of CLASS_TRUEMATCH) {
        if (lower !== nm) continue;
        if (monName) {
            const pm = name_to_pmidx(monName);
            if (pm >= LOW_PM_IDX)
                return { klass: monster_by_pmidx(pm)?.mcls ?? 0, mndx: pm };
        }
        return { klass, mndx };
    }
    for (const [idx, , explain] of DEF_MONSYMS) {
        const x = explain.toLowerCase();
        const p = x.indexOf(lower);
        if (p < 0) continue;
        if (p !== 0 && x[p - 1] !== ' ') continue;
        const after = x[p + lower.length];
        if (after === undefined || after === ' ') return { klass: idx, mndx };
    }
    const found = await name_to_mon(sing);
    if (found.mntmp !== NON_PM)
        return { klass: monster_by_pmidx(found.mntmp)?.mcls ?? 0, mndx: found.mntmp };
    return { klass: 0, mndx };
}

// C ref: makemon.c mk_gen_ok(mndx, mvflagsmask, genomask).
const G_UNIQ_F = 0x1000, G_NOHELL_F = 0x0800, G_HELL_F = 0x0400,
      G_NOGEN_F = 0x0200, G_FREQ_F = 0x0007, G_GENOD_F = 0x02;
function mvflags_of(mndx) { return game.mvitals?.[mndx]?.mvflags ?? 0; }
function geno_of(mndx) { return monster_by_pmidx(mndx)?.geno ?? 0; }
function mk_gen_ok(mndx, mvflagsmask, genomask) {
    if (mvflags_of(mndx) & mvflagsmask) return false;
    if (geno_of(mndx) & genomask) return false;
    return !is_placeholder_pm(mndx);
}

// C ref: makemon.c mkclass_poly(class) — a G_FREQ-weighted random member of a
// monster class, for a controlled polymorph that named a CLASS.  Genocided
// types are skipped, extinct ones are acceptable, and polyok() is deliberately
// NOT checked here (polyself() re-rolls).
function mkclass_poly(klass) {
    let first, num = 0;
    for (first = LOW_PM_IDX; first < SPECIAL_PM(); first++)
        if (monster_by_pmidx(first)?.mcls === klass) break;
    if (first === SPECIAL_PM()) return NON_PM;

    let gmask = (G_NOGEN_F | G_UNIQ_F);
    if (rn2(9) || klass === S_LICH_CLS)
        gmask |= (In_hell(game.u?.uz) ? G_NOHELL_F : G_HELL_F);

    for (let last = first; last < SPECIAL_PM()
         && monster_by_pmidx(last)?.mcls === klass; last++)
        if (mk_gen_ok(last, G_GENOD_F, gmask)) num += geno_of(last) & G_FREQ_F;
    if (!num) return NON_PM;

    for (num = rnd(num); num > 0; first++)
        if (mk_gen_ok(first, G_GENOD_F, gmask)) num -= geno_of(first) & G_FREQ_F;
    first--; /* correct an off-by-one error */
    return first;
}

// C ref: obj.h Is_dragon_scales/Is_dragon_mail + polyself.c armor_to_dragon().
// objects[] runs GRAY..YELLOW scale mail then GRAY..YELLOW scales in the same
// colour order mons[] runs the adult dragons — the identity artifact.js:625
// already relies on for the inverse map.
let _dragonOtyps = null;
function dragonOtyps() {
    if (!_dragonOtyps) {
        const find = (nm) => OBJECTS.findIndex((o) => o && o.name === nm);
        _dragonOtyps = {
            mail0: find('gray dragon scale mail'), mail1: find('yellow dragon scale mail'),
            scal0: find('gray dragon scales'), scal1: find('yellow dragon scales'),
        };
    }
    return _dragonOtyps;
}
function Is_dragon_mail(obj) {
    const t = dragonOtyps();
    return !!obj && t.mail0 >= 0 && obj.otyp >= t.mail0 && obj.otyp <= t.mail1;
}
function Is_dragon_scales(obj) {
    const t = dragonOtyps();
    return !!obj && t.scal0 >= 0 && obj.otyp >= t.scal0 && obj.otyp <= t.scal1;
}
function Is_dragon_armor(obj) { return Is_dragon_mail(obj) || Is_dragon_scales(obj); }
function armor_to_dragon(atyp) {
    const t = dragonOtyps();
    if (t.mail0 >= 0 && atyp >= t.mail0 && atyp <= t.mail1)
        return PM_GRAY_DRAGON + (atyp - t.mail0);
    if (t.scal0 >= 0 && atyp >= t.scal0 && atyp <= t.scal1)
        return PM_GRAY_DRAGON + (atyp - t.scal0);
    return NON_PM;
}

// C ref: youprop.h Unchanging / Polymorph_control — intrinsic OR the extrinsic
// a worn item confers.  This port has no u.uprops[].extrinsic word, so the worn
// half is read off objects[].oc_oprop the way insight.c what_gives() does.
const PROP_POLYMORPH_CONTROL = 62, PROP_UNCHANGING = 63;
function worn_gives_prop(propidx) {
    for (const o of (game.invent || []))
        if ((o.owornmask || 0) && OBJECTS[o.otyp]?.oc_oprop === propidx) return true;
    return false;
}
function Unchanging() {
    return ((game.u?.uprops?.HUnchanging | 0) > 0) || worn_gives_prop(PROP_UNCHANGING);
}
// timeout.c's polymorph countdown needs the same predicate (its Unchanging arm
// re-arms u.mtimedone instead of reverting).
export { Unchanging as Unchanging_poly };
function Polymorph_control() {
    return ((game.u?.uprops?.HPolymorph_control | 0) > 0)
        || worn_gives_prop(PROP_POLYMORPH_CONTROL);
}
function Stunned() {
    const u = game.u;
    return ((u?.uprops?.Stun | 0) > 0) || ((u?.uprops?.HStun | 0) > 0) || !!u?.Stunned;
}
// C ref: hack.c losehp(dmg, ...) — the same reduction every other file-local
// losehp() in this port makes (the done(DIED) half needs end.js).
function losehp_poly(dmg) {
    const u = game.u;
    if (!u || dmg <= 0) return;
    u.uhp = (u.uhp ?? 0) - dmg;
    if (u.uhp < 0) u.uhp = 0;
    game.botl = true;
}
// C ref: mondata.h your_race(ptr) == (mflags2 & gu.urace.selfmask).
const RACE_SELFMASK = { human: M2_HUMAN, elven: M2_ELF, dwarven: M2_DWARF,
    gnomish: M2_GNOME, orcish: M2_ORC };
function your_race_pm(mdat) {
    const mask = RACE_SELFMASK[game.urace?.adj] || 0;
    return !!mdat && (mflags2_of(mdat) & mask) !== 0;
}
function ismnum(x) { return Number.isInteger(x) && x >= LOW_PM_IDX && x < NUMMONS(); }
function the_unique_pm(mdat) { return !!mdat && ((mdat.geno | 0) & G_UNIQ_F) !== 0; }
function type_is_pname(mdat) { return !!mdat && (mflags2_of(mdat) & M2_PNAME) !== 0; }
// C ref: hacklib.c mungspaces().
function mungspaces_poly(s) {
    return String(s ?? '').replace(/\s+/g, ' ').replace(/^ | $/g, '');
}

// C ref: polyself.c rehumanize() — leave monster form.  Reached from the
// u.mtimedone countdown (timeout.c), from losing the form's last hit point
// (mhitu.c losehp), and from wizard-mode #polyself onto your own role.
// mhitu.js already dynamic-imports this name; until now polyself.js exported
// no such function, so that call silently did nothing and a poly'd hero could
// be beaten past 0 monster HP and stay in the form.
export async function rehumanize() {
    const u = game.u;
    if (Unchanging()) {
        /* C's u.mh < 1 arm is done(DIED); deferred with the rest of the death
           path.  The amulet arm is the observable one. */
        const uamul = game.uamul;
        if (uamul && OBJECTS[uamul.otyp]?.oc_oprop === PROP_UNCHANGING)
            await pline(`Your ${xname(uamul)} fails!`);
        return;
    }
    if (emits_light(u.data)) del_light_source(LS_MONSTER, HERO);
    await polyman('You return to %s form!', game.urace?.adj || 'human');
    /* nomul(0) */
    game.multi = 0;
    game.botl = true;
    game.vision_full_recalc = 1;
    await encumber_msg();
}

// C ref: polyself.c:729-741, the `made_change:` label every arm converges on.
async function polyself_made_change(old_light) {
    const u = game.u;
    let new_light = emits_light(u.data);
    if (old_light !== new_light) {
        if (old_light) del_light_source(LS_MONSTER, HERO);
        if (new_light === 1) ++new_light; /* otherwise it's undetectable */
        if (new_light) new_light_source(u.ux, u.uy, new_light, LS_MONSTER, HERO);
    }
}

// C ref: polyself.c:627-661 `do_merge:` — dragon scale MAIL reverts to scales
// and the armor merges into uskin.  This port has no uskin slot, so the item
// is only unworn; the messages and the otyp conversion are C's.
async function do_merge_dragon_armor(mntmp) {
    const uarm = game.uarm;
    if (!uarm) return;
    if (mvflags_of(mntmp) & G_GENOD_F) return;
    const t = dragonOtyps();
    if (Is_dragon_scales(uarm)) {
        await pline('You merge with your scaly armor.');
    } else {
        const nm = String(xname(uarm)).replace(' dragon ', ' ');
        await pline(`Your ${nm} reverts to scales as you merge with them.`);
        uarm.otyp += t.scal0 - t.mail0;
        game.botl = true;
    }
    uarm.owornmask = 0;
    game.uarm = null;
}

// C ref: polyself.c polyself(psflags) — THE self-polymorph entry point, shared
// by the wand/spell/potion of polymorph, a polymorph trap, a fountain quaff, a
// magic throne, eating a chameleon/genetic-engineer corpse and #polyself.
// Every RNG draw below is C's, in C's order (verified against a recorded C
// trace):
//   rn2(20)  polyself.c:490  system shock, when there is no control source
//   rn2(3)   polyself.c:558  orc/elf/giant placeholder substitution
//   rn2(9)+rnd(n)            mkclass_poly(), when a CLASS was named
//   rn2(330) polyself.c:702  rn1(SPECIAL_PM - LOW_PM, LOW_PM) random form
//   rn2(5)   polyself.c:712  the "newman() instead" roll, skipped for
//                            forcecontrol (wizard #polyself) but NOT for a
//                            ring of polymorph control
// DEFERRED (no supporting state in this port): the vampire-shifter and
// lycanthrope arms (u.ulycn / youmonst.cham are never set), retouch_equipment,
// selftouch and polysense.
export async function polyself(psflags) {
    const u = game.u;
    if (!u) return;
    let mntmp = NON_PM, tryct;
    let forcecontrol = (psflags & POLY_CONTROLLED) !== 0;
    const low_control = (psflags & POLY_LOW_CTRL) !== 0;
    let monsterpoly = (psflags & POLY_MONSTER) !== 0;
    const formrevert = (psflags & POLY_REVERT) !== 0;
    const draconian = !!game.uarm && Is_dragon_armor(game.uarm);
    const iswere = ismnum(u.ulycn);
    const isvamp = is_vampire_pm(u.data);
    let controllable_poly = Polymorph_control() && !(Stunned() || Unaware());

    if (Unchanging()) {
        await pline('You fail to transform!');
        return;
    }
    /* being Stunned|Unaware doesn't negate this aspect of Poly_control */
    if (!Polymorph_control() && !forcecontrol && !draconian && !iswere && !isvamp) {
        if (rn2(20) > acurr_eff(A_CON)) {
            await pline('You shudder for a moment.');
            losehp_poly(rnd(30));
            exercise(A_CON, false);
            return;
        }
    }
    const old_light = emits_light(u.data);

    if (formrevert) {
        mntmp = ismnum(u.ucham) ? u.ucham : NON_PM;
        monsterpoly = true;
        controllable_poly = false;
    }
    if (forcecontrol && low_control && (draconian || monsterpoly || isvamp || iswere))
        forcecontrol = false;

    if (controllable_poly || forcecontrol) {
        tryct = 5;
        let accepted = false;
        do {
            mntmp = NON_PM;
            const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
            const raw = await hooked_tty_getlin('Become what kind of monster? [type the name]', null);
            let buf = mungspaces_poly(raw);
            if (buf === '\x1b' || (buf.length && buf[0] === '\x1b')) {
                if (forcecontrol) {            /* wizard mode #polyself */
                    await pline('Never mind.');
                    return;
                }
                buf = '*';                      /* resort to random */
            }
            if (buf === '*' || buf === 'random') {
                tryct = 0;   /* skips the thats_enough_tries message */
                continue;
            }
            let klass = 0;
            ({ mntmp } = await name_to_mon(buf));
            let by_class = (mntmp < LOW_PM_IDX);
            if (!by_class && is_placeholder_pm(mntmp)
                && !your_race_pm(monster_by_pmidx(mntmp)) && mntmp !== PM_HUMAN) {
                /* far less general than mkclass() */
                if (mntmp === PM_ORC)
                    mntmp = rn2(3) ? name_to_pmidx('hill orc') : name_to_pmidx('Mordor orc');
                else if (mntmp === PM_ELF)
                    mntmp = rn2(3) ? name_to_pmidx('Green-elf') : name_to_pmidx('Grey-elf');
                else if (mntmp === PM_GIANT)
                    mntmp = rn2(3) ? name_to_pmidx('stone giant') : name_to_pmidx('hill giant');
            }
            for (;;) {
                if (by_class) {
                    by_class = false;
                    ({ klass, mndx: mntmp } = await name_to_monclass(buf));
                    if (klass && mntmp === NON_PM)
                        mntmp = (draconian && klass === S_DRAGON_CLS)
                            ? armor_to_dragon(game.uarm.otyp) : mkclass_poly(klass);
                }
                const mdat = mntmp >= LOW_PM_IDX ? monster_by_pmidx(mntmp) : null;
                if (mntmp < LOW_PM_IDX) {
                    await pline(klass ? "You can't polymorph into any of those."
                                      : "I've never heard of such monsters.");
                } else if (game.flags?.debug && u.Upolyd && mntmp === u.umonster) {
                    /* wizard mode: picking your own role while poly'd reverts
                       without newman()'s level/sex-change chance */
                    await rehumanize();
                    return;   /* rehumanize() extinguishes u-as-mon light */
                } else if (!polyok_flag(mdat)
                           && !(mntmp === PM_HUMAN
                                || (your_race_pm(mdat) && !the_unique_pm(mdat))
                                || mntmp === u.umonster)) {
                    /* mkclass_poly() can pick a !polyok() candidate; if so,
                       usually try again */
                    if (klass) {
                        if (rn2(3) || --tryct > 0) { by_class = true; continue; }
                        ++tryct;
                    }
                    let pm_name = await pmname_of(mdat, game.flags?.female);
                    if (the_unique_pm(mdat)) pm_name = `the ${pm_name}`;
                    else if (!type_is_pname(mdat)) pm_name = an(pm_name);
                    await pline(`You can't polymorph into ${pm_name}.`);
                } else {
                    accepted = true;
                }
                break;
            }
            if (accepted) break;
        } while (--tryct > 0);

        if (!tryct) await pline("That's enough tries!");
        if (draconian && (tryct <= 0 || mntmp === armor_to_dragon(game.uarm.otyp))) {
            const dragon = armor_to_dragon(game.uarm.otyp);
            await do_merge_dragon_armor(dragon);
            if (dragon === PM_HUMAN) await newman();
            else if (dragon >= LOW_PM_IDX) await polymon(dragon);
            await polyself_made_change(old_light);
            return;
        }
    } else if (draconian) {
        /* special change that doesn't require polyok() */
        const dragon = armor_to_dragon(game.uarm.otyp);
        await do_merge_dragon_armor(dragon);
        if (dragon === PM_HUMAN) await newman();
        else if (dragon >= LOW_PM_IDX) await polymon(dragon);
        await polyself_made_change(old_light);
        return;
    }

    if (mntmp < LOW_PM_IDX) {
        tryct = 200;
        do {
            /* randomly pick an "ordinary" monster */
            mntmp = rn1(SPECIAL_PM() - LOW_PM_IDX, LOW_PM_IDX);
            if (polyok_flag(monster_by_pmidx(mntmp)) && !is_placeholder_pm(mntmp)) break;
        } while (--tryct > 0);
    }

    /* polyok() fails either if everything is genocided, or if we deliberately
       chose something illegal to force newman(). */
    const mdatFinal = monster_by_pmidx(mntmp);
    if (!polyok_flag(mdatFinal) || (!forcecontrol && !rn2(5)) || your_race_pm(mdatFinal))
        await newman();
    else
        await polymon(mntmp);

    await polyself_made_change(old_light);
}

// C ref: include/hack.h ECMD_OK(0)/ECMD_TIME(1)/ECMD_CANCEL(2).
const ECMD_OK = 0, ECMD_TIME = 1, ECMD_CANCEL = 2;

// C ref: cmd.c getdir(), reached via zap.c's zap_getdir() idiom (dynamic import
// keeps polyself.js off cmd.js's static import cycle).  Sets u.dx/u.dy/u.dz the
// way C's getdir() does and reports cancel as C's `!getdir()`.
//
// This matters far beyond the direction itself: getdir() CONSUMES A KEYSTROKE.
// A #monster ability that skips its prompt leaves the answering key in the
// input stream, where the command parser executes it as a command.
async function u_getdir() {
    const { getdir } = await import('./cmd.js');
    const dir = await getdir();
    const u = game.u;
    if (!dir) { u.dx = 0; u.dy = 0; u.dz = 0; return false; }
    u.dx = dir.dx | 0; u.dy = dir.dy | 0; u.dz = dir.dz | 0;
    return true;
}

// C ref: polyself.c dobreathe() — #monster's breath-weapon action.
export async function dobreathe() {
    const u = game.u;
    if (u.Strangled) {
        await pline("You can't breathe.  Sorry.");
        return ECMD_OK;
    }
    if ((u.uen || 0) < 15) {
        await pline("You don't have enough energy to breathe!");
        return ECMD_OK;
    }
    u.uen -= 15;
    game.botl = true;

    if (!(await u_getdir()))
        return ECMD_CANCEL;

    // C ref: attacktype_fordmg(youmonst.data, AT_BREA, AD_ANY) — the FIRST
    // AT_BREA slot; C's macro walks mattk[] in order and returns that slot.
    const mattk = mattk_of(u.data).find((a) => a.aatyp === AT_BREA);
    if (!mattk) {
        /* C: impossible("bad breath attack?") */
    } else if (!u.dx && !u.dy && !u.dz) {
        // ubreatheu(mattk): breathing at yourself.  Deferred — it needs the
        // per-adtyp self-damage dispatch (zap.c:3017) this port has no caller
        // for yet.  C consumes no RNG before entering it, so the desync starts
        // inside, not here.
    } else {
        // C ref: hack.h BZ_U_BREATH(BZ_OFS_AD(adtyp)) == 20 + |adtyp-AD_MAGM|%10.
        await (await import('./zap.js')).ubuzz(
            20 + (Math.abs(mattk.adtyp - AD_MAGM) % 10), mattk.damn);
    }
    return ECMD_TIME;
}

// C ref: polyself.c dospit() — #monster for a venom spitter.  The getdir() is
// the load-bearing half (it eats the direction key); the venom object itself
// needs throwit(), which this port does not have, so the projectile is
// deferred rather than faked.
async function dospit() {
    if (!(await u_getdir()))
        return ECMD_CANCEL;
    // mksobj(BLINDING_VENOM|ACID_VENOM, TRUE, FALSE) + throwit(): deferred.
    return ECMD_TIME;
}

// C ref: polyself.c doremove() — #monster for a nymph: shed the ball & chain.
async function doremove() {
    const u = game.u;
    if (!u.uball) { /* C: !Punished */
        if (u.utrap && u.utraptype === TT_BURIEDBALL) {
            await pline(`The ball and chain are buried firmly in the ${surface(u.ux, u.uy)}.`);
            return ECMD_OK;
        }
        await pline('You are not chained to anything!');
        return ECMD_OK;
    }
    // unpunish(): invent.js's stub is a no-op and is not exported; a Punished
    // hero never reaches here in any covered session.  Deferred.
    return ECMD_TIME;
}

// C ref: polyself.c dogaze() — #monster for a gazer.  The three refusal gates
// and the energy cost are ported; the per-monster gaze loop is deferred (it
// needs destroy_items/ignite_items for AD_FIRE and a y_n confirm per peaceful
// target).  C draws no RNG before the loop, so the gates are exact.
async function dogaze() {
    const u = game.u;
    const adtyp = (mattk_of(u.data).find((a) => a.aatyp === AT_GAZE) || {}).adtyp ?? 0;
    if (adtyp !== AD_CONF && adtyp !== AD_FIRE)
        return ECMD_OK; // C: impossible("gaze attack %d?")
    if (Blind()) {
        await pline("You can't see anything to gaze at.");
        return ECMD_OK;
    } else if (u.uhallu) {
        await pline("You can't gaze at anything you can see.");
        return ECMD_OK;
    }
    if ((u.uen || 0) < 15) {
        await pline('You lack the energy to use your special gaze!');
        return ECMD_OK;
    }
    u.uen -= 15;
    game.botl = true;
    // per-monster gaze loop + "You gaze at no place in particular.": deferred.
    return ECMD_TIME;
}

// C ref: polyself.c dosummon() — #monster for a lycanthrope.
async function dosummon() {
    const u = game.u;
    if ((u.uen || 0) < 10) {
        await pline('You lack the energy to send forth a call for help!');
        return ECMD_OK;
    }
    u.uen -= 10;
    game.botl = true;
    await pline('You call upon your brethren for help!');
    exercise(A_WIS, true);
    // were_summon(): DRAWS rnd(5) + per-helper rn2()s + makemon() + tamedog().
    // Deferred because tamedog() does not exist in this port and were_summon's
    // `yours` arm calls it for every helper; a summon without it would leave
    // hostile lycanthropes and still desync.  Bug, not a no-op.
    return ECMD_TIME;
}

// C ref: polyself.c dohide() — #monster for a hider.  The refusal gates and the
// u.uundetected/newsym state changes are ported; the hides_under 'trice-corpse
// instapetrify branch is deferred (invent.js's instapetrify is a no-op stub).
async function dohide() {
    const u = game.u;
    const mdat = u.data;
    const ismimic = mdat?.mlet === 'm';
    const on_ceiling = is_clinger(mdat) || !!u.uprops?.Flying;

    if (u.ustuck || (u.utrap && (u.utraptype !== TT_PIT || on_ceiling))) {
        await pline(`You can't hide while you're ${!u.ustuck ? 'trapped' : 'being held'}.`);
        if (u.uundetected || (ismimic && u.m_ap_type)) {
            u.uundetected = 0;
            u.m_ap_type = 0;
            newsym(u.ux, u.uy);
        }
        return ECMD_OK;
    }
    if (mdat?.mlet === ';' && !is_pool(u.ux, u.uy)) {
        if (IS_FOUNTAIN(game.level?.at?.(u.ux, u.uy)?.typ))
            await pline('The fountain is not deep enough to hide in.');
        else
            await pline('There is no water to hide in here.');
        u.uundetected = 0;
        return ECMD_OK;
    }
    if (hides_under_flag(mdat)) {
        const otop = obj_at_hero();
        if (!otop) {
            await pline('There is nothing to hide under here.');
            u.uundetected = 0;
            return ECMD_OK;
        }
        // all-cockatrice-corpse pile -> instapetrify(): deferred.
    }
    if (u.uundetected || (ismimic && u.m_ap_type)) {
        await youhiding(1); /* "You are already hiding ..." */
        return ECMD_OK;
    }
    if (ismimic) {
        u.m_ap_type = 2 /* M_AP_OBJECT */;
        u.mappearance = 0 /* STRANGE_OBJECT */;
    } else {
        u.uundetected = 1;
    }
    newsym(u.ux, u.uy);
    await youhiding(0); /* "You are now hiding ..." */
    return ECMD_TIME;
}

// C ref: sounds.c youhiding(via_enlghtmt=FALSE, msgflag) — the '#monster'
// phrasing only.  The mimic ("mimicking a <object>") and eel ("in the water")
// suffixes are deferred with their branches above.
async function youhiding(msgflag) {
    const u = game.u;
    const mdat = u.data;
    let buf = 'hiding';
    if (u.uundetected) {
        if (hides_under_flag(mdat)) {
            // C: ansimpleoname(o) — article + simple object name.
            const o = obj_at_hero();
            if (o) buf += ` underneath ${an(xname(o))}`;
        } else if (is_clinger(mdat) || u.uprops?.Flying) {
            buf += ' on the ceiling';
        } else if (u.utrap && u.utraptype === TT_PIT) {
            buf += ' in a pit';
        } else {
            buf += ` on the ${surface(u.ux, u.uy)}`;
        }
    }
    await pline(`You are ${msgflag ? 'already' : 'now'} ${buf}.`);
}

// C ref: polyself.c domindblast() — #monster for a mind flayer.  The loop
// DRAWS: rn2(2) for a telepath, rn2(10) for everyone else, then rnd(15) for
// each monster it locks onto — so skipping it desynchronizes the stream even
// though the blast itself is "just" damage.
async function domindblast() {
    const u = game.u;
    if ((u.uen || 0) < 10) {
        await pline('You concentrate but lack the energy to maintain doing so.');
        return ECMD_OK;
    }
    u.uen -= 10;
    game.botl = true;

    await pline('You concentrate.');
    await pline('A wave of psychic energy pours out.');
    const { wakeupAttack, killed, mon_nam } = await import('./uhitm.js');
    const BOLT_LIM = 8;
    // C ref: `for (mtmp = fmon; mtmp; mtmp = nmon)` — newest-first, and the
    // next link is cached before the body can kill mtmp.
    for (const mtmp of fmonOrder()) {
        if (DEADMONSTER(mtmp)) continue;
        if (mdistu(mtmp) > BOLT_LIM * BOLT_LIM) continue;
        if (mtmp.mpeaceful) continue;
        if (mindless(mtmp.data)) continue;
        const u_sen = telepathic(mtmp.data) && !mtmp.mcansee;
        if (u_sen || (telepathic(mtmp.data) && rn2(2)) || !rn2(10)) {
            const dmg = rnd(15);
            // C: wake it first, but don't anger a peaceful it won't survive.
            await wakeupAttack(mtmp, dmg > mtmp.mhp);
            await pline(`You lock in on ${s_suffix(mon_nam(mtmp))} ${
                u_sen ? 'telepathy'
                : telepathic(mtmp.data) ? 'latent telepathy' : 'mind'}.`);
            mtmp.mhp -= dmg;
            if (DEADMONSTER(mtmp)) await killed(mtmp);
        }
    }
    return ECMD_TIME;
}

// C ref: the `fmon` chain — makemon prepends, so C visits newest-first.
function fmonOrder() {
    const list = monsterList();
    const out = new Array(list.length);
    for (let i = 0; i < list.length; i++) out[i] = list[list.length - 1 - i];
    return out;
}
// C ref: hack.h mdistu(mon) == distu(mon->mx, mon->my).
function mdistu(mtmp) {
    const u = game.u;
    const dx = mtmp.mx - (u?.ux ?? 0), dy = mtmp.my - (u?.uy ?? 0);
    return dx * dx + dy * dy;
}
// C ref: hacklib.c s_suffix().
function s_suffix(s) {
    if (/s$/.test(s)) return `${s}'`;
    return `${s}'s`;
}

// C ref: polyself.c dospinweb() — #monster for a spider.  The three refusal
// gates (which return ECMD_OK, i.e. NO turn elapses) are ported exactly; the
// existing-trap switch and the maketrap(WEB) tail are deferred — they need
// bury_objs()/add_damage()/feeltrap() for the hero's own square.
async function dospinweb() {
    const u = game.u;
    const x = u.ux, y = u.uy;
    const typ = game.level?.at?.(x, y)?.typ;
    const reject_terrain = is_pool_or_lava(x, y) || IS_AIR(typ);
    if (u.uprops?.Levitation || reject_terrain) {
        await pline(`You must be on ${reject_terrain ? 'solid' : 'the'} ground to spin a web.`);
        return ECMD_OK;
    }
    if (u.uswallow) {
        // "You release web fluid inside <mon>." + the engulfer dispatch:
        // deferred (needs expels()).  C returns ECMD_OK on every arm.
        return ECMD_OK;
    }
    if (u.utrap) {
        await pline('You cannot spin webs while stuck in a trap.');
        return ECMD_OK;
    }
    exercise(A_DEX, true);
    // existing-trap switch / On_stairs / maketrap(x, y, WEB): deferred.
    return ECMD_TIME;
}

// C ref: rm.h is_pool(x, y) / is_pool_or_lava(x, y).  hack.js keeps a private
// unexported copy of the latter; these go through const.js's IS_POOL/IS_LAVA
// rather than repeating the terrain ordinals.
function is_pool(x, y) {
    const t = game.level?.at?.(x, y)?.typ;
    return t != null && IS_POOL(t);
}
function is_pool_or_lava(x, y) {
    const t = game.level?.at?.(x, y)?.typ;
    return t != null && (IS_POOL(t) || IS_LAVA(t));
}
// C ref: svl.level.objects[u.ux][u.uy] — HEAD of the floor pile under the
// hero.  place_object() prepends, so our flat array's LAST match is C's head.
function obj_at_hero() {
    const u = game.u;
    const list = game.level?.objects || [];
    for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        if (o.where === 'floor' && o.ox === u.ux && o.oy === u.uy) return o;
    }
    return null;
}

// C ref: cmd.c domonability() — #monster: use the current polymorphed form's
// special ability.  The chain below is C's exact if/else-if ORDER, which the
// previous version had wrong twice: C tries dosummon() BEFORE dohide()/
// dospinweb(), and domindblast() BEFORE the gremlin/unicorn/shriek branches.
export async function domonability() {
    const u = game.u;
    const mdat = u.data;
    const might_hide = !!mdat && (is_hider_flag(mdat) || hides_under_flag(mdat));
    let c = '\0';

    // C ref: cmd.c:897-901 — decl.c hidespinchars[] == "hsq", default 'q'.
    // This prompt READS A KEY.  Skipping it (as this used to) does not make it
    // free: the 'h'/'s'/'q' the player typed is still in the input stream and
    // the command parser executes it as a command.
    if (might_hide && webmaker(mdat)) {
        const { yn_function } = await import('./extcmd-handlers.js');
        c = await yn_function('Hide [h] or spin a web [s]?', 'hsq', 'q');
        if (c === 'q' || c === '\x1b')
            return ECMD_OK;
    }
    if (mdat && can_breathe(mdat)) {
        return await dobreathe();
    } else if (mdat && has_spit(mdat)) {
        return await dospit();
    } else if (mdat && mdat.mlet === 'n') {
        return await doremove();
    } else if (mdat && has_gaze(mdat)) {
        return await dogaze();
    } else if (mdat && is_were_flag(mdat)) {
        return await dosummon();
    } else if (c !== '\0' ? c === 'h' : might_hide) {
        return await dohide();
    } else if (c !== '\0' ? c === 's' : webmaker(mdat)) {
        return await dospinweb();
    } else if (mdat && is_mind_flayer_pm(mdat)) {
        return await domindblast();
    } else if (u.umonnum === PM_GREMLIN) {
        if (IS_FOUNTAIN(game.level?.at?.(u.ux, u.uy)?.typ)) {
            // split_mon()/dryup(): deferred (split_mon does not exist here).
        } else if (is_pool(u.ux, u.uy)) {
            // split_mon(): deferred.
        } else {
            await pline('There is no fountain here.');
        }
    } else if (mdat && is_unicorn_pm(mdat)) {
        // use_unicorn_horn(NULL): deferred (apply.c's version is not ported).
        return ECMD_TIME;
    } else if (msound_of(mdat) === MS_SHRIEK) {
        await pline('You shriek.');
        // u.uburied / aggravate(): aggravate() wakes every monster on the
        // level; deferred, but the shriek message itself is a real --More--
        // boundary that used to be dropped entirely.
    } else if (mdat && is_vampire_pm(mdat)) {
        // dopoly() -> polyself(POLY_MONSTER): deferred; the interactive
        // polyself shell lives in extcmd-handlers.js.
        return ECMD_TIME;
    } else if (u.Upolyd) {
        await pline('Any special ability you may have is purely reflexive.');
    } else {
        await pline("You don't have a special ability in your normal form!");
    }
    return ECMD_OK;
}

export { is_placeholder_pm, PM_HUMAN, PM_ORC, PM_GIANT, PM_ELF };

// ════════════════════════════════════════════════════════════════════════════
// polyself.c: the ten functions that had no counterpart here.
//
// INERT: nothing in js/ calls anything below.  The existing deferral comments
// that name these (polyself.js:620-621 for float_vs_flight/steed_vs_stealth/
// polysense, :1395 for polysense, :1901 for dopoly, js/do_wear.js:330 and
// js/invent.js:1033/3650/3833 and js/read.js:1074 and js/cmd.js:3680 for
// float_vs_flight) still describe the LIVE behaviour; wiring them up is a
// separate, scored change.
//
// The blocking-property gap this exposes, once: C keeps three "blocked" masks
// (BFlying / BLevitation / BStealth) alongside the H<prop>/E<prop> pair, and
// Levitation/Flying/Stealth are all defined as "(H|E) && !B".  This port has
// only the H/E halves (js/dbridge.js:948 HProp(), js/do_wear.js:204 BStealth()
// recomputes the riding rule inline), so the writes below land in fields that
// NO reader consults.  Reported rather than papered over.
// ════════════════════════════════════════════════════════════════════════════

// C ref: onames.h AMULET_OF_STRANGULATION (js/eat.js:1902, js/dogmove.js:78).
const AMULET_OF_STRANGULATION_OTYP = 203;
// C ref: monflag.h M2_HUMAN|M2_ELF — polysense()'s vampire warntype mask.
// C ref: mons[] rows polysense() switches on.
const PM_PURPLE_WORM = name_to_pmidx('purple worm');
const PM_BABY_PURPLE_WORM = name_to_pmidx('baby purple worm');
const PM_SHRIEKER = name_to_pmidx('shrieker');
const PM_VAMPIRE = name_to_pmidx('vampire');
const PM_VAMPIRE_LEADER = name_to_pmidx('vampire leader');
const PM_MANES = name_to_pmidx('manes');

// C ref: youprop.h — the uprops fields the three blocked-mask writers touch.
function uprops_of() { const u = game.u; return (u.uprops = u.uprops || {}); }
// C ref: youprop.h HLevitation/ELevitation, HFlying/EFlying.  These read the
// H/E halves ONLY (see the header note): C's Levitation macro also demands
// !BLevitation.
function HELevitation() {
    const p = game.u?.uprops || {};
    return (p.HLevitation | 0) || (p.ELevitation | 0) || (p.Levitation | 0);
}
function HEFlying() {
    const p = game.u?.uprops || {};
    return (p.HFlying | 0) || (p.EFlying | 0) || (p.Flying | 0);
}

// C ref: polyself.c:131 float_vs_flight() — "Levitation overrides Flying; set
// or clear BFlying|I_SPECIAL".  Called from every place that changes
// levitation, flight or floor-trapping.  No RNG.
export function float_vs_flight() {
    const u = game.u;
    const p = uprops_of();
    const stuck_in_floor = !!(u.utrap && u.utraptype !== TT_PIT);

    /* floating overrides flight; so does being trapped in the floor */
    if (HELevitation() || (HEFlying() && stuck_in_floor))
        p.BFlying = (p.BFlying | 0) | I_SPECIAL;
    else
        p.BFlying = (p.BFlying | 0) & ~I_SPECIAL;
    /* being trapped on the ground (bear trap, web, molten lava survived with
       fire resistance, former lava solidified via cold, tethered to a buried
       iron ball) overrides floating -- the floor is reachable */
    if (HELevitation() && stuck_in_floor)
        p.BLevitation = (p.BLevitation | 0) | I_SPECIAL;
    else
        p.BLevitation = (p.BLevitation | 0) & ~I_SPECIAL;

    /* riding blocks stealth unless hero+steed fly, so a change in flying
       might cause a change in stealth */
    steed_vs_stealth();

    game.botl = true;
}

// C ref: polyself.c:158 steed_vs_stealth() — riding blocks stealth unless
// hero+steed fly.  No RNG.  (js/do_wear.js:204 BStealth() recomputes exactly
// this rule inline instead of reading the mask written here.)
export function steed_vs_stealth() {
    const u = game.u;
    const p = uprops_of();
    if (u.usteed && !HEFlying() && !HELevitation())
        p.BStealth = (p.BStealth | 0) | FROMOUTSIDE;
    else
        p.BStealth = (p.BStealth | 0) & ~FROMOUTSIDE;
}

// C ref: mondata.h has_head(ptr) — !(mflags1 & M1_NOHEAD).
function has_head_poly(ptr) { return (mflags1_of(ptr) & M1_NOHEAD) === 0; }
// C ref: mondata.c:591 can_be_strangled(&gy.youmonst) — headless forms are
// immune (no neck), as are mindless forms that do not breathe.  The hero can
// never be mindless while unpolymorphed, but a mindless polyform confers the
// protection.  js/uhitm.js:2405 has the monster-side copy (unexported).
function can_be_strangled_u() {
    const ptr = youmonst_data_pub();
    if (!has_head_poly(ptr)) return false;
    const nobrainer = mindless(ptr);
    /* Breathless: intrinsic (form) or extrinsic (amulet of magical breathing) */
    const p = game.u?.uprops || {};
    const nonbreathing = ((mflags1_of(ptr) & M1_BREATHLESS) !== 0)
        || !!(p.Breathless || p.HBreathless || p.EBreathless);
    return !nobrainer || !nonbreathing;
}
// C ref: objnam.c simpleonames(obj) — xname() without the enchantment/BUC
// prefixes.  For the amulet of strangulation the two agree.
function simpleonames_poly(obj) { return xname(obj); }

// C ref: polyself.c:168 check_strangling(on) — for changing into (on=FALSE) or
// out of (on=TRUE) a form that is immune to strangulation.  Called by polymon()
// / polyman() / rehumanize() around the form change.  No RNG.
export async function check_strangling(on) {
    const u = game.u;
    /* on -- maybe resume strangling */
    if (on) {
        const was_strangled = ((u.Strangled | 0) !== 0);

        /* when Strangled is already set, polymorphing from one vulnerable form
           into another causes the counter to be reset */
        if (game.uamul && game.uamul.otyp === AMULET_OF_STRANGULATION_OTYP
            && can_be_strangled_u()) {
            u.Strangled = 6;
            game.botl = true;
            await pline(`Your ${simpleonames_poly(game.uamul)} ${
                was_strangled ? 'still constricts' : 'begins constricting'
            } your ${body_part(NECK)}!`); /* "throat" */
            makeknown(AMULET_OF_STRANGULATION_OTYP);
        }

    /* off -- maybe block strangling */
    } else {
        if (u.Strangled && !can_be_strangled_u()) {
            u.Strangled = 0;
            game.botl = true;
            await pline('You are no longer being strangled.');
        }
    }
}

// C ref: polyself.c:307 livelog_newform(viapoly, oldgend, newgend) — log a
// message if a NON-poly'd hero's gender has changed (newman()/change_sex()).
// No RNG.  C's own TODO notes the rest of newman()'s logging ought to move here.
export function livelog_newform(viapoly, oldgend, newgend) {
    const u = game.u;

    if (!u.Upolyd) {
        if (newgend !== oldgend) {
            /* C ref: you.h Role_switch == gu.urole.mnum; this port's
               roles[].mnum is the 0-based ROLE index (js/role.js:25), which is
               also what exper.js rank_of() wants */
            const urole = game.urole || roles[0];
            const oldrole = (oldgend && urole.name.f) ? urole.name.f : urole.name.m;
            const newrole = (newgend && urole.name.f) ? urole.name.f : urole.name.m;
            const oldrank = rank_of(u.ulevel, urole.mnum, !!oldgend);
            const newrank = rank_of(u.ulevel, urole.mnum, !!newgend);
            /* C: Sprintf(buf, "%.10s %.30s", genders[flags.female].adj, newrank) */
            const buf = `${String(genders[game.flags?.female ? 1 : 0]?.adj || '')
                .slice(0, 10)} ${String(newrank).slice(0, 30)}`;
            livelog_printf(LL_MINORAC, `${viapoly ? 'polymorphed' : 'transformed'
                } into ${an(newrole !== oldrole ? newrole
                    : newrank !== oldrank ? newrank : buf)}`);
        }
    }
}

// C ref: mondata.h is_vampire(ptr) — the 'V' class minus the vampire bat.
// polyself.js:116 is_vampire_pm() already answers this from mlet.
// C ref: mondata.h is_vampshifter(mon) — a shapeshifter whose base form is a
// vampire (mon->cham names it).  js/monmove.js:1490 and js/artifact.js:636 hold
// unexported copies; for the hero, u.ucham is the equivalent field.
function is_vampshifter_u() {
    const cham = game.u?.ucham;
    if (cham == null || cham < 0) return false;
    const nm = monster_by_pmidx(cham)?.name;
    return nm === 'vampire' || nm === 'vampire leader'
        || nm === 'Vlad the Impaler';
}

// C ref: polyself.c:1877 dopoly() — #monster for a vampire (or vampshifter)
// hero: shift form.  polyself(POLY_MONSTER) is where any RNG happens.
export async function dopoly() {
    const u = game.u;
    const savedat = youmonst_data_pub();

    if (is_vampire_pm(savedat) || is_vampshifter_u()) {
        await polyself(POLY_MONSTER);
        if (savedat !== youmonst_data_pub()) {
            await pline(`You transform into ${
                an(await pmname_of(youmonst_data_pub(), !!Ugender_poly()))}.`);
            newsym(u.ux, u.uy);
        }
    }
    return ECMD_TIME;
}
// C ref: you.h:555 Ugender == ((Upolyd ? u.mfemale : flags.female) ? 1 : 0).
function Ugender_poly() {
    const u = game.u;
    return (u?.Upolyd ? u.mfemale : game.flags?.female) ? 1 : 0;
}

// C ref: polyself.c:1941 uunstick() — the hero's grip on u.ustuck is broken
// (losing a sticky form, or the victim escaping).  set_ustuck() must run BEFORE
// the pline(), because Monnam() of a freed monster is what C prints.  No RNG.
export async function uunstick() {
    const u = game.u;
    const mtmp = u.ustuck;

    if (!mtmp) {
        /* C: impossible("uunstick: no ustuck?") */
        return;
    }
    set_ustuck(null); /* before pline() */
    const { Monnam } = await import('./do_name.js');
    await pline(`${Monnam(mtmp)} is no longer in your clutches.`);
}

// C ref: polyself.c:1954 skinback(silently) — a dragon-scale-mail hero reverts:
// the merged scales come back out of the uskin slot into uarm.  The
// `owornmask &= ~I_SPECIAL` undoes the save/restore hack that keeps uskin out
// of the normal worn-slot bookkeeping.  No RNG.
export async function skinback(silently) {
    if (game.uskin) {
        const old_light = arti_light_radius(game.uskin);

        if (!silently) await pline('Your skin returns to its original form.');
        game.uarm = game.uskin;
        game.uskin = null;
        /* undo save/restore hack */
        game.uarm.owornmask = (game.uarm.owornmask | 0) & ~I_SPECIAL;

        if (artifact_light(game.uarm))
            maybe_adjust_light(game.uarm, old_light);
    }
}

// C ref: polyself.c:2236 polysense() — "some species have awareness of other
// species".  Sets svc.context.warntype (a species index + permonst pointer, or
// a monster-flag mask for the vampire case) and the FROMRACE bit of
// HWarn_of_mon.  No RNG.
export function polysense() {
    const u = game.u;
    const ctx = (game.context = game.context || {});
    const p = uprops_of();
    let warnidx = NON_PM;

    ctx.warntype = ctx.warntype || {};
    ctx.warntype.speciesidx = NON_PM;
    ctx.warntype.species = 0;
    ctx.warntype.polyd = 0;
    p.HWarn_of_mon = (p.HWarn_of_mon | 0) & ~FROMRACE;

    /* C switches on u.umonnum, which is a mons[] index there.  In THIS port
       u.umonnum is a ROLE index while unpolymorphed ([[umonnum-is-a-role-
       index]]), so the switch has to run off youmonst.data's pmidx and only
       when Upolyd — exactly the guard C's own callers rely on. */
    const mndx = u.Upolyd ? (youmonst_data_pub()?.pmidx ?? NON_PM) : NON_PM;

    switch (mndx) {
    case PM_PURPLE_WORM:
    case PM_BABY_PURPLE_WORM:
        warnidx = PM_SHRIEKER;
        break;
    case PM_VAMPIRE:
    case PM_VAMPIRE_LEADER:
        ctx.warntype.polyd = M2_HUMAN | M2_ELF;
        p.HWarn_of_mon = (p.HWarn_of_mon | 0) | FROMRACE;
        return;
    default:
        break;
    }
    if (ismnum(warnidx)) {
        ctx.warntype.speciesidx = warnidx;
        ctx.warntype.species = monster_by_pmidx(warnidx);
        p.HWarn_of_mon = (p.HWarn_of_mon | 0) | FROMRACE;
    }
}

// C ref: polyself.c:2265 ugenocided() — TRUE iff the hero's role or race has
// been genocided.  No RNG.
//
// C indexes svm.mvitals[] with gu.urole.mnum / gu.urace.mnum, which ARE mons[]
// rows there.  In this port roles[].mnum / races[].mnum are 0-based role/race
// indices (js/role.js:25 / :162), so both have to be mapped to the mons[] row
// first — the same trap as [[umonnum-is-a-role-index]].
const PM_ARCHEOLOGIST_ROW = 331;   /* js/monmove.js:6018 */
let _race_rows = null;
function race_mons_row(raceidx) {
    if (!_race_rows) {
        _race_rows = [PM_HUMAN, PM_ELF, name_to_pmidx('dwarf'),
                      name_to_pmidx('gnome'), PM_ORC];
    }
    return _race_rows[raceidx] ?? NON_PM;
}
export function ugenocided() {
    const roleRow = PM_ARCHEOLOGIST_ROW + (game.urole?.mnum ?? 0);
    const raceRow = race_mons_row(game.urace?.mnum ?? 0);
    return !!((mvflags_of(roleRow) & G_GENOD_F)
              || (mvflags_of(raceRow) & G_GENOD_F));
}

// C ref: mondata.h:218 weirdnonliving(ptr) == is_golem(ptr) || mlet == S_VORTEX.
function weirdnonliving_poly(ptr) {
    return is_golem(ptr) || (!!ptr && ptr.mlet === 'v');
}
// C ref: mondata.h:219 nonliving(ptr) == is_undead(ptr) || ptr == &mons[PM_MANES]
// || weirdnonliving(ptr).
function nonliving_poly(ptr) {
    return is_undead_flag(ptr) || (!!ptr && ptr.pmidx === PM_MANES)
        || weirdnonliving_poly(ptr);
}

// C ref: polyself.c:2273 udeadinside() — how the hero feels "inside" after
// self-genocide of role or race.  Living (including demons) reads "dead",
// undead plus manes read "condemned", golems plus vortices read "empty".
// No RNG.
export function udeadinside() {
    const ptr = youmonst_data_pub();
    return !nonliving_poly(ptr)
        ? 'dead'                                /* living, including demons */
        : !weirdnonliving_poly(ptr)
            ? 'condemned'                       /* undead plus manes */
            : 'empty';                          /* golems plus vortices */
}
