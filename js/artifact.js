// C ref: src/artifact.c + include/artilist.h + include/artifact.h.
//
// Before this file the port had no artilist[] at all: mkobj.js carried a
// 19-row [m, otyp, gift_value, role] subset for mk_artifact()'s random path,
// invent.js carried a 34-row touch-property subset, and shk.js could not price
// an artifact because the cost column existed nowhere.  Everything here is the
// full C table plus the functions that read it.
//
// TWO CONVENTION NOTES that bite anyone editing the table:
//   * artilist[] has NO Palantir of Westernesse.  Its A() row in artilist.h is
//     inside `#if 0`, so the ART_xx enum skips it and NROFARTIFACTS is 33, not
//     34.  js/invent.js's ARTI_TOUCH_PROPS *does* include it at index 24, which
//     shifts Staff of Aesculapius..Eye of the Aethiopica up by one there.
//   * artilist[].role/.race hold mons[] indices (PM_KNIGHT == 335), not the
//     0..12 role index this port usually calls `mnum`.  Role_if()/Race_if()
//     below do the conversion; do not "simplify" the table to 0..12.
import { game } from './gstate.js';
import { rn2, rnd, d, rnz } from './rng.js';
import { objects, mksobj, weight, base_oc_cost } from './mkobj.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
import { fuzzymatch } from './objnam.js';
import { monster_by_pmidx } from './makemon.js';
import { mon_mr } from './monmr_data.js';
import { exercise } from './attrib.js';
import { isok } from './hacklib.js';
import { cansee } from './vision.js';
import { mon_nam, monflee } from './uhitm.js';
import { resist } from './zap.js';
import { healmon } from './mon.js';
import { nomul } from './hack.js';
import {
    mflags1_of, mflags2_of, mflags3_of, msound_of,
    M1_AMORPHOUS, M1_NOHEAD,
    M2_UNDEAD, M2_WERE, M2_ELF, M2_ORC, M2_DEMON, M2_GIANT, M2_LORD, M2_PRINCE,
    M2_HUMAN, M2_DWARF, M2_GNOME,
} from './monflags_data.js';
import {
    MATTK,
    AT_ENGL, AT_HUGS, AT_MAGC,
    AD_PHYS, AD_MAGM, AD_FIRE, AD_COLD, AD_SLEE, AD_DISN, AD_ELEC, AD_DRST,
    AD_ACID, AD_BLND, AD_STUN, AD_SLOW, AD_PLYS, AD_DRLI, AD_STON, AD_STCK,
    AD_WRAP, AD_WERE, AD_DISE, AD_HALU,
} from './monattk_data.js';
// prop.h W_* bits.  NOTE: js/invent.js deliberately REMAPS these (QW_WEP
// 0x100, QW_SWAPWEP 0x400) — const.js carries the real prop.h values and is
// the right source here.
import {
    W_ART, W_ARTI, W_WEP, W_SWAPWEP, W_QUIVER, W_BALL, W_SADDLE,
    W_ARM, W_ARMC, W_ARMH, W_ARMS, W_ARMG, W_ARMF, W_ARMU,
    W_AMUL, W_RINGL, W_RINGR, W_TOOL,
    ONAME_VIA_NAMING, ONAME_WISH, ONAME_GIFT, ONAME_VIA_DIP, ONAME_LEVEL_DEF,
    ONAME_BONES, ONAME_RANDOM, ONAME_KNOW_ARTI,
    D_TRAPPED, IS_DOOR, A_CON, A_WIS,
} from './const.js';

// ─────────────────────────────────────────────────────────────────────────
// artifact.h SPFX_* — special-effect bits
// ─────────────────────────────────────────────────────────────────────────
export const SPFX_NONE    = 0x00000000;
export const SPFX_NOGEN   = 0x00000001;
export const SPFX_RESTR   = 0x00000002;
export const SPFX_INTEL   = 0x00000004;
export const SPFX_SPEAK   = 0x00000008;
export const SPFX_SEEK    = 0x00000010;
export const SPFX_WARN    = 0x00000020;
export const SPFX_ATTK    = 0x00000040;
export const SPFX_DEFN    = 0x00000080;
export const SPFX_DRLI    = 0x00000100;
export const SPFX_SEARCH  = 0x00000200;
export const SPFX_BEHEAD  = 0x00000400;
export const SPFX_HALRES  = 0x00000800;
export const SPFX_ESP     = 0x00001000;
export const SPFX_STLTH   = 0x00002000;
export const SPFX_REGEN   = 0x00004000;
export const SPFX_EREGEN  = 0x00008000;
export const SPFX_HSPDAM  = 0x00010000;
export const SPFX_HPHDAM  = 0x00020000;
export const SPFX_TCTRL   = 0x00040000;
export const SPFX_LUCK    = 0x00080000;
export const SPFX_DMONS   = 0x00100000;
export const SPFX_DCLAS   = 0x00200000;
export const SPFX_DFLAG1  = 0x00400000;
export const SPFX_DFLAG2  = 0x00800000;
export const SPFX_DALIGN  = 0x01000000;
export const SPFX_DBONUS  = 0x01F00000; // DMONS|DCLAS|DFLAG1|DFLAG2|DALIGN
export const SPFX_XRAY    = 0x02000000;
export const SPFX_REFLECT = 0x04000000;
export const SPFX_PROTECT = 0x08000000;

// prop.h enum prop_types values artilist[] refers to, then artifact.h's
// invoke_prop_types which continue from LAST_PROP (== LIFESAVED == 68).
export const PROTECTION = 59;
const CONFLICT = 44, LEVITATION = 48, INVIS = 40;
export const LAST_PROP = 68;
export const TAMING = 69, HEALING = 70, ENERGY_BOOST = 71, UNTRAP = 72,
    CHARGE_OBJ = 73, LEV_TELE = 74, CREATE_PORTAL = 75, ENLIGHTENING = 76,
    CREATE_AMMO = 77, BANISH = 78, FLING_POISON = 79, FIRESTORM = 80,
    SNOWSTORM = 81, BLINDING_RAY = 82;

// align.h
const A_NONE = -128, A_CHAOTIC = -1, A_NEUTRAL = 0, A_LAWFUL = 1;
// permonst.h NON_PM
const NON_PM = -1;

// mons[] indices for the role monsters: js/makemon.js:2382 pins
// PM_ARCHEOLOGIST == 331 and PM_WIZARD == 343.  PM_CLERIC (the *role* priest,
// 337) is a different monster from the "aligned cleric" temple priest.
const PM_ARCHEOLOGIST = 331, PM_BARBARIAN = 332, PM_CAVE_DWELLER = 333,
    PM_HEALER = 334, PM_KNIGHT = 335, PM_MONK = 336, PM_CLERIC = 337,
    PM_RANGER = 338, PM_ROGUE = 339, PM_SAMURAI = 340, PM_TOURIST = 341,
    PM_VALKYRIE = 342, PM_WIZARD = 343;
const ROLE_PM_FIRST = PM_ARCHEOLOGIST;
// mons[] indices for the player races (js/role.js races[].basepm).
const PM_HUMAN = 260, PM_ELF = 264, PM_DWARF = 44, PM_GNOME = 165, PM_ORC = 72;
const RACE_PM = [PM_HUMAN, PM_ELF, PM_DWARF, PM_GNOME, PM_ORC];
// you.h struct Race.hatemask, from src/role.c races[]; MH_xxx == M2_xxx.
const RACE_HATEMASK = [
    /* human */ M2_GNOME | M2_ORC,
    /* elf   */ M2_ORC,
    /* dwarf */ M2_ORC,
    /* gnome */ M2_HUMAN,
    /* orc   */ M2_HUMAN | M2_ELF | M2_DWARF,
];

// defsym.h MONSYM indices: artilist[].mtype for SPFX_DCLAS, plus the few
// mlet tests the predicates below need.
const S_IMP = 9, S_VORTEX = 22, S_GHOST = 26, S_DRAGON = 30, S_OGRE = 41,
    S_TROLL = 46, S_VAMPIRE = 48, S_GOLEM = 55;
// color.h
const NO_COLOR = 8, CLR_RED = 1, CLR_BRIGHT_BLUE = 12;
// mondata.h M3_COVETOUS
const M3_COVETOUS = 0x04;
// objclass.h oc_material SILVER (verified at js/invent.js:875)
const SILVER = 14;
// objclass.h object classes
const WEAPON_CLASS = 2, ARMOR_CLASS = 3, RING_CLASS = 4, AMULET_CLASS = 5,
    TOOL_CLASS = 6, POTION_CLASS = 8, SCROLL_CLASS = 9, SPBOOK_CLASS = 10,
    WAND_CLASS = 11, GEM_CLASS = 13;
// objclass.h F_UNIQUE (mkobj.js:160)
const F_UNIQUE = 64;
// obj.h where values
const OBJ_FREE = 0, OBJ_FLOOR = 3, OBJ_CONTAINED = 4, OBJ_MINVENT = 5;
// prop.h TIMEOUT
const TIMEOUT = 0x00ffffff;
// cmd.h ECMD_ result codes
const ECMD_OK = 0, ECMD_CANCEL = 1, ECMD_TIME = 4;
// decl.c c_common_strings — pline1(nothing_happens) / nothing_seems_to_happen.
const NOTHING_HAPPENS = "Nothing happens.";
// getobj.h
const GETOBJ_EXCLUDE = -3, GETOBJ_SUGGEST = 1;

// objects.h otyps of the artifacts' base items and of everything else this
// file names, resolved against js/mkobj.js objects[] by name.
function otyp_by_name(nm) {
    const i = objects.findIndex((o) => o.name === nm);
    return i;
}
const STRANGE_OBJECT = 0;
const ARROW = otyp_by_name('arrow');
const ELVEN_DAGGER = otyp_by_name('elven dagger');
const ORCISH_DAGGER = otyp_by_name('orcish dagger');
const ATHAME = otyp_by_name('athame');
const BATTLE_AXE = otyp_by_name('battle-axe');
const SILVER_SABER = otyp_by_name('silver saber');
const BROADSWORD = otyp_by_name('broadsword');
const ELVEN_BROADSWORD = otyp_by_name('elven broadsword');
const LONG_SWORD = otyp_by_name('long sword');
const KATANA = otyp_by_name('katana');
const TSURUGI = otyp_by_name('tsurugi');
const RUNESWORD = otyp_by_name('runesword');
const MACE = otyp_by_name('mace');
const SILVER_MACE = otyp_by_name('silver mace');
const MORNING_STAR = otyp_by_name('morning star');
const WAR_HAMMER = otyp_by_name('war hammer');
const QUARTERSTAFF = otyp_by_name('quarterstaff');
const BOW = otyp_by_name('bow');
const HELM_OF_BRILLIANCE = otyp_by_name('helm of brilliance');
const GRAY_DRAGON_SCALE_MAIL = otyp_by_name('gray dragon scale mail');
const GOLD_DRAGON_SCALE_MAIL = otyp_by_name('gold dragon scale mail');
const YELLOW_DRAGON_SCALE_MAIL = otyp_by_name('yellow dragon scale mail');
const GRAY_DRAGON_SCALES = otyp_by_name('gray dragon scales');
const GOLD_DRAGON_SCALES = otyp_by_name('gold dragon scales');
const RED_DRAGON_SCALES = otyp_by_name('red dragon scales');
const WHITE_DRAGON_SCALES = otyp_by_name('white dragon scales');
const ORANGE_DRAGON_SCALES = otyp_by_name('orange dragon scales');
const BLACK_DRAGON_SCALES = otyp_by_name('black dragon scales');
const BLUE_DRAGON_SCALES = otyp_by_name('blue dragon scales');
const GREEN_DRAGON_SCALES = otyp_by_name('green dragon scales');
const YELLOW_DRAGON_SCALES = otyp_by_name('yellow dragon scales');
const CLOAK_OF_PROTECTION = otyp_by_name('cloak of protection');
const RIN_PROTECTION = otyp_by_name('protection');
const RIN_INCREASE_DAMAGE = otyp_by_name('increase damage');
const AMULET_OF_ESP = otyp_by_name('amulet of ESP');
const AMULET_OF_GUARDING = otyp_by_name('amulet of guarding');
const SKELETON_KEY = otyp_by_name('skeleton key');
const CREDIT_CARD = otyp_by_name('credit card');
const MIRROR = otyp_by_name('mirror');
const CRYSTAL_BALL = otyp_by_name('crystal ball');
const LENSES = otyp_by_name('lenses');
const LUCKSTONE = otyp_by_name('luckstone');
const BELL_OF_OPENING = otyp_by_name('bell of opening');
const LEASH = otyp_by_name('leash');
const LARGE_BOX = otyp_by_name('large box');
const BAG_OF_TRICKS = otyp_by_name('bag of tricks');
const FAKE_AMULET_OF_YENDOR =
    otyp_by_name('cheap plastic imitation of the Amulet of Yendor');

// mons[] indices resolved by name, so a mons[] shift can never silently
// mis-index them (the mail-daemon splice moved every index once already).
function pmidx_by_name(nm) {
    for (let i = 0; i < 400; i++)
        if (monster_by_pmidx(i)?.name === nm) return i;
    return NON_PM;
}
const PM_CLAY_GOLEM = pmidx_by_name('clay golem');
const PM_GRAY_DRAGON = pmidx_by_name('gray dragon');
const PM_YELLOW_DRAGON = pmidx_by_name('yellow dragon');
const PM_WATER_ELEMENTAL = pmidx_by_name('water elemental');
const PM_JABBERWOCK = pmidx_by_name('jabberwock');
const PM_MANES = pmidx_by_name('manes');
const PM_DEATH = pmidx_by_name('Death');

// ─────────────────────────────────────────────────────────────────────────
// hack.h enum artifacts_nums — the ART_xx indices.  1-based and contiguous;
// the Palantir is NOT in the list (see the header note).
// ─────────────────────────────────────────────────────────────────────────
export const ART_NONARTIFACT = 0, ART_EXCALIBUR = 1, ART_STORMBRINGER = 2,
    ART_MJOLLNIR = 3, ART_CLEAVER = 4, ART_GRIMTOOTH = 5, ART_ORCRIST = 6,
    ART_STING = 7, ART_MAGICBANE = 8, ART_FROST_BRAND = 9,
    ART_FIRE_BRAND = 10, ART_DRAGONBANE = 11, ART_DEMONBANE = 12,
    ART_WEREBANE = 13, ART_GRAYSWANDIR = 14, ART_GIANTSLAYER = 15,
    ART_OGRESMASHER = 16, ART_TROLLSBANE = 17, ART_VORPAL_BLADE = 18,
    ART_SNICKERSNEE = 19, ART_SUNSWORD = 20, ART_ORB_OF_DETECTION = 21,
    ART_HEART_OF_AHRIMAN = 22, ART_SCEPTRE_OF_MIGHT = 23,
    ART_STAFF_OF_AESCULAPIUS = 24, ART_MAGIC_MIRROR_OF_MERLIN = 25,
    ART_EYES_OF_THE_OVERWORLD = 26, ART_MITRE_OF_HOLINESS = 27,
    ART_LONGBOW_OF_DIANA = 28, ART_MASTER_KEY_OF_THIEVERY = 29,
    ART_TSURUGI_OF_MURAMASA = 30, ART_YENDORIAN_EXPRESS_CARD = 31,
    ART_ORB_OF_FATE = 32, ART_EYE_OF_THE_AETHIOPICA = 33,
    AFTER_LAST_ARTIFACT = 34;
export const NROFARTIFACTS = AFTER_LAST_ARTIFACT - 1;

// artilist.h attack macros expand to {aatyp, adtyp, damn, damd}; aatyp is 0
// for every artifact row, so only [adtyp, damn, damd] is stored.
const NO_ATTK = { adtyp: 0, damn: 0, damd: 0 };
const DFNS = (c) => ({ adtyp: c, damn: 0, damd: 0 });
const CARY = (c) => ({ adtyp: c, damn: 0, damd: 0 });
const PHYS = (a, b) => ({ adtyp: AD_PHYS, damn: a, damd: b });
const DRLI = (a, b) => ({ adtyp: AD_DRLI, damn: a, damd: b });
const COLD = (a, b) => ({ adtyp: AD_COLD, damn: a, damd: b });
const FIRE = (a, b) => ({ adtyp: AD_FIRE, damn: a, damd: b });
const ELEC = (a, b) => ({ adtyp: AD_ELEC, damn: a, damd: b });
const STUN = (a, b) => ({ adtyp: AD_STUN, damn: a, damd: b });
const POIS = (a, b) => ({ adtyp: AD_DRST, damn: a, damd: b });

const A = (name, otyp, s1, s2, mt, atk, dfn, cry, inv, al, cl, rac,
           gs, gv, cost, clr) => ({
    otyp, name, spfx: s1, cspfx: s2, mtype: mt,
    attk: atk, defn: dfn, cary: cry, inv_prop: inv,
    alignment: al, role: cl, race: rac,
    gen_spe: gs, gift_value: gv, cost, acolor: clr,
});

// C ref: include/artilist.h artilist[].  Row order IS the ART_xx numbering.
export const artilist = [
    /* dummy element #0, so that all interesting indices are non-zero */
    A("", STRANGE_OBJECT, 0, 0, 0, NO_ATTK, NO_ATTK, NO_ATTK, 0, A_NONE,
      NON_PM, NON_PM, 0, 0, 0, NO_COLOR),

    A("Excalibur", LONG_SWORD, (SPFX_NOGEN | SPFX_RESTR | SPFX_SEEK
                                | SPFX_DEFN | SPFX_INTEL | SPFX_SEARCH),
      0, 0, PHYS(5, 10), DRLI(0, 0), NO_ATTK, 0, A_LAWFUL, PM_KNIGHT, NON_PM,
      0, 10, 4000, NO_COLOR),

    /* Stormbringer only has a 2 because it can drain a level, giving 8 more */
    A("Stormbringer", RUNESWORD,
      (SPFX_RESTR | SPFX_ATTK | SPFX_DEFN | SPFX_INTEL | SPFX_DRLI), 0, 0,
      DRLI(5, 2), DRLI(0, 0), NO_ATTK, 0, A_CHAOTIC, NON_PM, NON_PM,
      0, 9, 8000, NO_COLOR),

    A("Mjollnir", WAR_HAMMER,
      (SPFX_RESTR | SPFX_ATTK), 0, 0, ELEC(5, 24), NO_ATTK, NO_ATTK, 0,
      A_NEUTRAL, PM_VALKYRIE, NON_PM,
      0, 8, 4000, NO_COLOR),

    A("Cleaver", BATTLE_AXE, SPFX_RESTR, 0, 0, PHYS(3, 6), NO_ATTK, NO_ATTK,
      0, A_NEUTRAL, PM_BARBARIAN, NON_PM,
      0, 8, 1500, NO_COLOR),

    /* Grimtooth warns against elves but its damage bonus applies to every
       target; spec_dbon() special-cases that */
    A("Grimtooth", ORCISH_DAGGER, (SPFX_RESTR | SPFX_WARN | SPFX_DFLAG2),
      0, M2_ELF, PHYS(2, 6), POIS(0, 0),
      NO_ATTK, FLING_POISON, A_CHAOTIC, NON_PM, PM_ORC,
      0, 5, 1200, CLR_RED),

    /* SPFX_WARN+SPFX_DFLAG2+M2_ORC makes these two warn of orcs */
    A("Orcrist", ELVEN_BROADSWORD, (SPFX_WARN | SPFX_DFLAG2), 0, M2_ORC,
      PHYS(5, 0), NO_ATTK, NO_ATTK, 0, A_CHAOTIC, NON_PM, PM_ELF,
      3, 4, 2000, CLR_BRIGHT_BLUE), /* actually light blue */

    A("Sting", ELVEN_DAGGER, (SPFX_WARN | SPFX_DFLAG2), 0, M2_ORC,
      PHYS(5, 0), NO_ATTK, NO_ATTK, 0, A_CHAOTIC, NON_PM, PM_ELF,
      3, 1, 800, CLR_BRIGHT_BLUE),

    A("Magicbane", ATHAME, (SPFX_RESTR | SPFX_ATTK | SPFX_DEFN), 0, 0,
      STUN(3, 4), DFNS(AD_MAGM), NO_ATTK, 0, A_NEUTRAL, PM_WIZARD, NON_PM,
      0, 7, 3500, NO_COLOR),

    A("Frost Brand", LONG_SWORD, (SPFX_RESTR | SPFX_ATTK | SPFX_DEFN), 0, 0,
      COLD(5, 0), COLD(0, 0), NO_ATTK, SNOWSTORM, A_NONE, NON_PM, NON_PM,
      0, 9, 3000, NO_COLOR),

    A("Fire Brand", LONG_SWORD, (SPFX_RESTR | SPFX_ATTK | SPFX_DEFN), 0, 0,
      FIRE(5, 0), FIRE(0, 0), NO_ATTK, FIRESTORM, A_NONE, NON_PM, NON_PM,
      0, 5, 3000, NO_COLOR),

    A("Dragonbane", BROADSWORD,
      (SPFX_RESTR | SPFX_DCLAS | SPFX_REFLECT), 0, S_DRAGON,
      PHYS(5, 0), NO_ATTK, NO_ATTK, 0, A_NONE, NON_PM, NON_PM,
      2, 5, 500, NO_COLOR),

    A("Demonbane", SILVER_MACE, (SPFX_RESTR | SPFX_DFLAG2), 0, M2_DEMON,
      PHYS(5, 0), NO_ATTK, NO_ATTK, BANISH, A_LAWFUL, PM_CLERIC, NON_PM,
      1, 3, 2500, NO_COLOR),

    A("Werebane", SILVER_SABER, (SPFX_RESTR | SPFX_DFLAG2), 0, M2_WERE,
      PHYS(5, 0), DFNS(AD_WERE), NO_ATTK, 0, A_NONE, NON_PM, NON_PM,
      1, 4, 1500, NO_COLOR),

    A("Grayswandir", SILVER_SABER, (SPFX_RESTR | SPFX_HALRES), 0, 0,
      PHYS(5, 0), NO_ATTK, NO_ATTK, 0, A_LAWFUL, NON_PM, NON_PM,
      0, 10, 8000, NO_COLOR),

    A("Giantslayer", LONG_SWORD, (SPFX_RESTR | SPFX_DFLAG2), 0, M2_GIANT,
      PHYS(5, 0), NO_ATTK, NO_ATTK, 0, A_NEUTRAL, NON_PM, NON_PM,
      2, 4, 200, NO_COLOR),

    A("Ogresmasher", WAR_HAMMER, (SPFX_RESTR | SPFX_DCLAS), 0, S_OGRE,
      PHYS(5, 0), NO_ATTK, NO_ATTK, 0, A_NONE, NON_PM, NON_PM,
      2, 1, 200, NO_COLOR),

    A("Trollsbane", MORNING_STAR, (SPFX_RESTR | SPFX_DCLAS | SPFX_REGEN), 0,
      S_TROLL, PHYS(5, 0), NO_ATTK, NO_ATTK, 0, A_NONE, NON_PM, NON_PM,
      2, 1, 200, NO_COLOR),

    A("Vorpal Blade", LONG_SWORD, (SPFX_RESTR | SPFX_BEHEAD), 0, 0,
      PHYS(5, 1), NO_ATTK, NO_ATTK, 0, A_NEUTRAL, NON_PM, NON_PM,
      1, 5, 4000, NO_COLOR),

    A("Snickersnee", KATANA, SPFX_RESTR, 0, 0, PHYS(0, 8), NO_ATTK, NO_ATTK,
      0, A_LAWFUL, PM_SAMURAI, NON_PM,
      0, 8, 1200, NO_COLOR),

    /* Sunsword emits light when wielded (handled in the core rather than via
       artifact fields), but that light has no particular color */
    A("Sunsword", LONG_SWORD, (SPFX_RESTR | SPFX_DFLAG2), 0, M2_UNDEAD,
      PHYS(5, 0), DFNS(AD_BLND), NO_ATTK, BLINDING_RAY, A_LAWFUL, NON_PM,
      NON_PM,
      0, 6, 1500, NO_COLOR),

    /* the quest artifacts, all self-willed; gen_spe 0, gift_value 12 */

    A("The Orb of Detection", CRYSTAL_BALL,
      (SPFX_NOGEN | SPFX_RESTR | SPFX_INTEL), (SPFX_ESP | SPFX_HSPDAM), 0,
      NO_ATTK, NO_ATTK, CARY(AD_MAGM), INVIS, A_LAWFUL, PM_ARCHEOLOGIST,
      NON_PM,
      0, 12, 2500, NO_COLOR),

    /* this stone does double damage as a projectile weapon */
    A("The Heart of Ahriman", LUCKSTONE,
      (SPFX_NOGEN | SPFX_RESTR | SPFX_INTEL), SPFX_STLTH, 0,
      PHYS(5, 0), NO_ATTK, NO_ATTK, LEVITATION, A_NEUTRAL, PM_BARBARIAN,
      NON_PM,
      0, 12, 2500, NO_COLOR),

    A("The Sceptre of Might", MACE,
      (SPFX_NOGEN | SPFX_RESTR | SPFX_INTEL | SPFX_DALIGN), 0, 0, PHYS(5, 0),
      DFNS(AD_MAGM), NO_ATTK, CONFLICT, A_LAWFUL, PM_CAVE_DWELLER, NON_PM,
      0, 12, 2500, NO_COLOR),

    A("The Staff of Aesculapius", QUARTERSTAFF,
      (SPFX_NOGEN | SPFX_RESTR | SPFX_ATTK | SPFX_INTEL | SPFX_DRLI
       | SPFX_REGEN),
      0, 0, DRLI(0, 0), DRLI(0, 0), NO_ATTK, HEALING, A_NEUTRAL, PM_HEALER,
      NON_PM,
      0, 12, 5000, NO_COLOR),

    A("The Magic Mirror of Merlin", MIRROR,
      (SPFX_NOGEN | SPFX_RESTR | SPFX_INTEL | SPFX_SPEAK), SPFX_ESP, 0,
      NO_ATTK, NO_ATTK, CARY(AD_MAGM), 0, A_LAWFUL, PM_KNIGHT, NON_PM,
      0, 12, 1500, NO_COLOR),

    A("The Eyes of the Overworld", LENSES,
      (SPFX_NOGEN | SPFX_RESTR | SPFX_INTEL | SPFX_XRAY), 0, 0, NO_ATTK,
      DFNS(AD_MAGM), NO_ATTK, ENLIGHTENING, A_NEUTRAL, PM_MONK, NON_PM,
      0, 12, 2500, NO_COLOR),

    A("The Mitre of Holiness", HELM_OF_BRILLIANCE,
      (SPFX_NOGEN | SPFX_RESTR | SPFX_DFLAG2 | SPFX_INTEL | SPFX_PROTECT), 0,
      M2_UNDEAD, NO_ATTK, NO_ATTK, CARY(AD_FIRE), ENERGY_BOOST, A_LAWFUL,
      PM_CLERIC, NON_PM,
      0, 12, 2000, NO_COLOR),

    A("The Longbow of Diana", BOW,
      (SPFX_NOGEN | SPFX_RESTR | SPFX_INTEL | SPFX_REFLECT), SPFX_ESP, 0,
      PHYS(5, 0), NO_ATTK, NO_ATTK, CREATE_AMMO, A_CHAOTIC, PM_RANGER, NON_PM,
      0, 12, 4000, NO_COLOR),

    /* MKoT has an extra carry property when not cursed (rogues) or blessed
       (non-rogues): #untrap always finds and disarms traps */
    A("The Master Key of Thievery", SKELETON_KEY,
      (SPFX_NOGEN | SPFX_RESTR | SPFX_INTEL | SPFX_SPEAK),
      (SPFX_WARN | SPFX_TCTRL | SPFX_HPHDAM), 0, NO_ATTK, NO_ATTK, NO_ATTK,
      UNTRAP, A_CHAOTIC, PM_ROGUE, NON_PM,
      0, 12, 3500, NO_COLOR),

    A("The Tsurugi of Muramasa", TSURUGI,
      (SPFX_NOGEN | SPFX_RESTR | SPFX_INTEL | SPFX_BEHEAD | SPFX_LUCK
       | SPFX_PROTECT),
      0, 0, PHYS(0, 8), NO_ATTK, NO_ATTK, 0, A_LAWFUL, PM_SAMURAI, NON_PM,
      0, 12, 4500, NO_COLOR),

    A("The Platinum Yendorian Express Card", CREDIT_CARD,
      (SPFX_NOGEN | SPFX_RESTR | SPFX_INTEL | SPFX_DEFN),
      (SPFX_ESP | SPFX_HSPDAM), 0, NO_ATTK, NO_ATTK, CARY(AD_MAGM),
      CHARGE_OBJ, A_NEUTRAL, PM_TOURIST, NON_PM,
      0, 12, 7000, NO_COLOR),

    A("The Orb of Fate", CRYSTAL_BALL,
      (SPFX_NOGEN | SPFX_RESTR | SPFX_INTEL | SPFX_LUCK),
      (SPFX_WARN | SPFX_HSPDAM | SPFX_HPHDAM), 0, NO_ATTK, NO_ATTK, NO_ATTK,
      LEV_TELE, A_NEUTRAL, PM_VALKYRIE, NON_PM,
      0, 12, 3500, NO_COLOR),

    A("The Eye of the Aethiopica", AMULET_OF_ESP,
      (SPFX_NOGEN | SPFX_RESTR | SPFX_INTEL), (SPFX_EREGEN | SPFX_HSPDAM), 0,
      NO_ATTK, DFNS(AD_MAGM), NO_ATTK, CREATE_PORTAL, A_NEUTRAL, PM_WIZARD,
      NON_PM,
      0, 12, 4000, NO_COLOR),

    /* terminator; otyp must be zero */
    A(null, 0, 0, 0, 0, NO_ATTK, NO_ATTK, NO_ATTK, 0, A_NONE, NON_PM, NON_PM,
      0, 0, 0, NO_COLOR),
];

// ─────────────────────────────────────────────────────────────────────────
// External bindings.
//
// These five C functions ARE implemented in this port but their JS modules do
// not export them, so nothing here can call the real ones.  destroy_items()
// and cancel_monst() DRAW RNG, so the fallbacks are not behavioural choices —
// they are missing bindings.  A wiring pass adds `export` in the owning module
// and calls setArtifactHooks() once; until then any call is recorded on
// game._artifact_unbound so it cannot be lost silently.
//   destroy_items   js/zap.js:2111 (async, draws a per-item rn2 chain)
//   ignite_items    js/zap.js
//   probe_monster   src/detect.c — not ported
//   make_stunned    src/potion.c — not ported under that name
//   make_confused   src/potion.c — not ported under that name
// ─────────────────────────────────────────────────────────────────────────
function unbound(which, fallback) {
    game._artifact_unbound = game._artifact_unbound || new Set();
    game._artifact_unbound.add(which);
    return fallback;
}
export const artifact_hooks = {
    destroy_items: null,   // zap.c    — DRAWS RNG
    ignite_items: null,    // zap.c
    probe_monster: null,   // detect.c
    make_stunned: null,    // potion.c
    make_confused: null,   // potion.c
    // the #invoke powers' bodies (each is one call into another C file)
    getobj: null,          // invent.c getobj(word, filter, flags)
    charge_ok: null,       // read.c   charge_ok() — needs oc_charged
    getdir: null,          // cmd.c    getdir(NULL)     — sets u.dx/u.dy/u.dz
    getrumor: null,        // rumors.c getrumor(truth, buf, exclude_cookie)
    seffects: null,        // read.c   seffects(pseudo) — SCR_TAMING
    untrap: null,          // trap.c   untrap(force,x,y,container)
    recharge: null,        // read.c   recharge(obj, curse_bless)
    spelleffects: null,    // spell.c  spelleffects(spell, atme, force)
    throwit: null,         // dothrow.c throwit(obj, wep_mask, twoweap, oldslot)
    goto_level: null,      // do.c     goto_level(newlev, ...)
    enlightenment: null,   // insight.c enlightenment(mode, final)
    level_tele: null,      // teleport.c level_tele()
    litroom: null,         // light.c  litroom(on, obj)
    do_blinding_ray: null, // zap.c    do_blinding_ray(obj)
    flashburn: null,       // zap.c    flashburn(duration, via_lightning)
    lightdamage: null,     // zap.c    lightdamage(obj, ordinary, amt)
    use_crystal_ball: null,// apply.c  use_crystal_ball(&obj)
};
export function setArtifactHooks(h) { Object.assign(artifact_hooks, h); }
function hook(name, fallback, ...args) {
    const fn = artifact_hooks[name];
    if (fn) return fn(...args);
    return unbound(name, fallback);
}

// ─────────────────────────────────────────────────────────────────────────
// hero / monster state accessors.  This port has no `struct you`, so each C
// macro is spelled out once here.
// ─────────────────────────────────────────────────────────────────────────
function youmonst() { return game.youmonst || game.u; }
function is_you(mon) { return !!mon && (mon === game.youmonst || mon === game.u); }
// C ref: youprop.h Upolyd.
function Upolyd() { return !!game.u?.Upolyd; }
// C ref: monst.h gy.youmonst.data; js/hack.js:588 — u.umonnum holds the
// 0-based ROLE index when not polymorphed, so PM_ARCHEOLOGIST must be added.
function youmonst_data() {
    const u = game.u;
    if (u?.Upolyd) return monster_by_pmidx(u.umonnum) || u?.data || null;
    return monster_by_pmidx(ROLE_PM_FIRST + (u?.umonnum ?? 0)) || u?.data || null;
}
function mon_data(mon) { return is_you(mon) ? youmonst_data() : (mon?.data || null); }
// C ref: hack.h Role_if(pm) == (gu.urole.malenum == pm).
function Role_if(pm) {
    const mnum = game.urole?.mnum;
    return mnum != null && (ROLE_PM_FIRST + mnum) === pm;
}
// C ref: hack.h Race_if(pm) == (gu.urace.malenum == pm).
function Race_if(pm) {
    const mnum = game.urace?.mnum;
    return mnum != null && RACE_PM[mnum] === pm;
}
// C ref: mondata.h race_hostile(ptr) == ((ptr)->mflags2 & gu.urace.hatemask).
function race_hostile(ptr) {
    const mnum = game.urace?.mnum ?? 0;
    return (mflags2_of(ptr) & (RACE_HATEMASK[mnum] || 0)) !== 0;
}
function ualign_type() { return game.u?.ualign?.type ?? A_NEUTRAL; }
function ualign_record() { return game.u?.ualign?.record ?? 0; }
// C ref: mondata.h mon_aligntyp(mon) — a tame or peaceful monster counts as
// the hero's alignment.
function mon_aligntyp(mon) {
    if (is_you(mon)) return ualign_type();
    if (mon?.mtame || mon?.mpeaceful) return ualign_type();
    return mon_data(mon)?.maligntyp ?? 0;
}
function uprop(name) { return game.u?.uprops?.[name] || 0; }
function Blind() { return !!(uprop('Blinded') || game.u?.Blinded); }
function Hallucination() { return !!(uprop('Hallucination') || game.u?.Hallucination); }
function Antimagic() {
    const u = game.u;
    return !!(u?.uprops?.Antimagic || u?.Antimagic || u?.HAntimagic || u?.EAntimagic);
}
function Fire_resistance() { return !!(uprop('Fire_resistance') || game.u?.Fire_resistance); }
function Cold_resistance() { return !!(uprop('Cold_resistance') || game.u?.Cold_resistance); }
function Shock_resistance() { return !!(uprop('Shock_resistance') || game.u?.Shock_resistance); }
function Poison_resistance() { return !!(uprop('Poison_resistance') || game.u?.Poison_resistance); }
function Drain_resistance() { return !!(uprop('Drain_resistance') || game.u?.Drain_resistance); }
function Stone_resistance() { return !!(uprop('Stone_resistance') || game.u?.Stone_resistance); }
// C ref: youprop.h Hate_silver == (u.ulycn >= LOW_PM || hates_silver(youmonst)).
function Hate_silver() {
    if ((game.u?.ulycn ?? NON_PM) >= 0) return true;
    const ptr = youmonst_data();
    if (!ptr) return false;
    if ((mflags2_of(ptr) & M2_WERE) !== 0) return true;
    if (ptr.mcls === S_VAMPIRE) return true;
    if ((mflags2_of(ptr) & M2_DEMON) !== 0) return true;
    if (ptr.name === 'shade') return true;
    if (ptr.mcls === S_IMP && ptr.name !== 'tengu') return true;
    return false;
}
// C ref: hack.h Maybe_Half_Phys(dmg) — halve, rounding up, under HALF_PHDAM.
function Maybe_Half_Phys(dmg) {
    return (game.u?.HHalf_physical_damage || game.u?.EHalf_physical_damage)
        ? Math.trunc((dmg + 1) / 2) : dmg;
}
function invent_list() {
    return Array.isArray(game.invent) ? game.invent : (game.gi?.invent || []);
}
function floor_objects_at(x, y) {
    return (game.level?.objects || []).filter((o) => o.ox === x && o.oy === y);
}

// C ref: mondata.h / mondata.c — flag tests derived from the generated tables
// (monflags_data.js, monattk_data.js), never from a species-name list.
function bigmonst(ptr) { return (ptr?.msize ?? 0) >= 3 /* MZ_LARGE */; }
function has_head(ptr) { return (mflags1_of(ptr) & M1_NOHEAD) === 0; }
function amorphous(ptr) { return (mflags1_of(ptr) & M1_AMORPHOUS) !== 0; }
function noncorporeal(ptr) { return ptr?.mcls === S_GHOST; }
function is_undead(ptr) { return (mflags2_of(ptr) & M2_UNDEAD) !== 0; }
function is_were(ptr) { return (mflags2_of(ptr) & M2_WERE) !== 0; }
function is_demon(ptr) { return (mflags2_of(ptr) & M2_DEMON) !== 0; }
function is_golem(ptr) { return ptr?.mcls === S_GOLEM; }
function is_dlord(ptr) { return is_demon(ptr) && (mflags2_of(ptr) & M2_LORD) !== 0; }
function is_dprince(ptr) { return is_demon(ptr) && (mflags2_of(ptr) & M2_PRINCE) !== 0; }
function is_covetous(ptr) { return !!ptr && (mflags3_of(ptr) & M3_COVETOUS) !== 0; }
function is_mplayer(ptr) {
    return !!ptr && ptr.pmidx >= PM_ARCHEOLOGIST && ptr.pmidx <= PM_WIZARD;
}
// C ref: mondata.h weirdnonliving/nonliving.
function nonliving(ptr) {
    return is_undead(ptr) || ptr?.pmidx === PM_MANES
        || is_golem(ptr) || ptr?.mcls === S_VORTEX;
}
function mattk_rows(ptr) { return ptr?.pmidx != null ? (MATTK[ptr.pmidx] || []) : []; }
// C ref: mondata.c attacktype()/dmgtype() — [aatyp, adtyp, damn, damd].
function attacktype(ptr, atyp) { return mattk_rows(ptr).some((a) => a[0] === atyp); }
function dmgtype(ptr, dtyp) { return mattk_rows(ptr).some((a) => a[1] === dtyp); }
// C ref: mondata.c sticks().
function sticks(ptr) {
    return dmgtype(ptr, AD_STCK)
        || (dmgtype(ptr, AD_WRAP) && !attacktype(ptr, AT_ENGL))
        || attacktype(ptr, AT_HUGS);
}
const MR_FIRE = 0x01, MR_COLD = 0x02, MR_ELEC = 0x10, MR_POISON = 0x20,
      MR_STONE = 0x80;
function mresists_of(mon) { return mon_data(mon)?.mresists || 0; }
function resists_fire(mon) { return (mresists_of(mon) & MR_FIRE) !== 0; }
function resists_cold(mon) { return (mresists_of(mon) & MR_COLD) !== 0; }
function resists_elec(mon) { return (mresists_of(mon) & MR_ELEC) !== 0; }
function resists_poison(mon) { return (mresists_of(mon) & MR_POISON) !== 0; }
function resists_ston(mon) { return (mresists_of(mon) & MR_STONE) !== 0; }
// C ref: mondata.c defended(mon, adtyp) — wielded artifact, or dragon scales
// (an adult dragon counts as wearing its own).
function defended(mon, adtyp) {
    const you = is_you(mon);
    let o = you ? game.uwep : (mon?.mw || null);
    if (o && o.oartifact && defends(adtyp, o)) return true;

    const mndx = mon_data(mon)?.pmidx;
    if (mndx >= PM_GRAY_DRAGON && mndx <= PM_YELLOW_DRAGON) {
        o = { oclass: ARMOR_CLASS,
              otyp: GRAY_DRAGON_SCALES + (mndx - PM_GRAY_DRAGON) };
    } else {
        o = you ? game.uarm
                : (mon?.minvent || []).find((it) => (it.owornmask & W_ARM) !== 0);
    }
    return !!o && Is_dragon_armor(o) && defends(adtyp, o);
}
// C ref: monst.h is_vampshifter(mon) — cham is one of the three vampire forms
// (NOT any chameleon; a generic `mon.cham` test would over-resist).
const VAMPSHIFT_CHAM = new Set([pmidx_by_name('vampire'),
    pmidx_by_name('vampire leader'), pmidx_by_name('Vlad the Impaler')]);
function is_vampshifter(mon) { return VAMPSHIFT_CHAM.has(mon?.cham); }
// C ref: mondata.c resists_drli().  is_were() misses the hero in human form,
// which is why u.ulycn is tested separately.
function resists_drli(mon) {
    const ptr = mon_data(mon);
    if (is_undead(ptr) || is_demon(ptr) || is_were(ptr)
        || (is_you(mon) && (game.u?.ulycn ?? NON_PM) >= 0)
        || ptr?.pmidx === PM_DEATH || is_vampshifter(mon))
        return true;
    return defended(mon, AD_DRLI);
}

// ─────────────────────────────────────────────────────────────────────────
// artiexist[] / artidisco[]
//
// C keeps both as file-static arrays.  Here `exists` lives in the Set that
// js/mkobj.js:972 already writes (game.artiexist), so the two views can never
// disagree; the remaining eight arti_info bits live alongside it.
// ─────────────────────────────────────────────────────────────────────────
const zero_artiexist = () => ({
    exists: 0, found: 0, gift: 0, wish: 0, named: 0,
    viadip: 0, lvldef: 0, bones: 0, rndm: 0,
});
function existSet() {
    if (!(game.artiexist instanceof Set)) game.artiexist = new Set();
    return game.artiexist;
}
function artiinfo() {
    if (!Array.isArray(game.artiinfo) || game.artiinfo.length !== AFTER_LAST_ARTIFACT) {
        game.artiinfo = [];
        for (let i = 0; i < AFTER_LAST_ARTIFACT; i++) game.artiinfo.push(zero_artiexist());
    }
    return game.artiinfo;
}
function artidisco() {
    if (!Array.isArray(game.artidisco) || game.artidisco.length !== NROFARTIFACTS)
        game.artidisco = new Array(NROFARTIFACTS).fill(0);
    return game.artidisco;
}
/* artiexist[m].exists */
export function arti_exists(m) { return existSet().has(m); }
function set_arti_exists(m, on) {
    if (on) existSet().add(m); else existSet().delete(m);
    artiinfo()[m].exists = on ? 1 : 0;
}

// C ref: artifact.c hack_artifacts() — must run after u_init().  Mutates
// artilist[] in place exactly as C does.
export function hack_artifacts() {
    const alignmnt = ualign_type();

    /* fix up the alignments of "gift" artifacts */
    for (let m = 1; artilist[m] && artilist[m].otyp; m++) {
        const art = artilist[m];
        if (Role_if(art.role) && art.alignment !== A_NONE) art.alignment = alignmnt;
    }
    /* Excalibur can be used by any lawful character, not just knights */
    if (!Role_if(PM_KNIGHT)) artilist[ART_EXCALIBUR].role = NON_PM;

    const questarti = game.urole?.questarti;
    if (questarti) {
        artilist[questarti].alignment = alignmnt;
        artilist[questarti].role = ROLE_PM_FIRST + (game.urole?.mnum ?? 0);
    }
}

// C ref: artifact.c init_artifacts().
export function init_artifacts() {
    game.artiexist = new Set();
    game.artiinfo = null;
    game.artidisco = null;
    artiinfo();
    artidisco();
    hack_artifacts();
}

// C ref: artifact.c save_artifacts()/restore_artifacts().  There is no NHFILE
// here, so the pair round-trips through a plain object instead of a byte
// stream; the CONTENT (34 arti_info + 33 xint16, and the hack_artifacts() redo
// on the way back in) is what C writes and reads.
export function save_artifacts() {
    return {
        artiexist: artiinfo().map((a) => ({ ...a })),
        artidisco: artidisco().slice(),
    };
}
export function restore_artifacts(blob) {
    game.artiinfo = null;
    game.artidisco = null;
    const info = artiinfo(), disco = artidisco();
    const set = existSet();
    set.clear();
    for (let i = 0; i < AFTER_LAST_ARTIFACT; i++) {
        Object.assign(info[i], zero_artiexist(), blob?.artiexist?.[i] || {});
        if (info[i].exists) set.add(i);
    }
    for (let i = 0; i < NROFARTIFACTS; i++) disco[i] = blob?.artidisco?.[i] || 0;
    hack_artifacts(); /* redo non-saved special cases */
}

// C ref: artifact.c artiname().
export function artiname(artinum) {
    if (artinum <= 0 || artinum > NROFARTIFACTS) return "";
    return artilist[artinum].name;
}

// C ref: artifact.c get_artifact() — returns artilist[ART_NONARTIFACT] rather
// than null, which is why every caller compares against that row.
export function get_artifact(obj) {
    if (obj) {
        const artidx = obj.oartifact | 0;
        if (artidx > 0 && artidx < AFTER_LAST_ARTIFACT) return artilist[artidx];
    }
    return artilist[ART_NONARTIFACT];
}
const NONART = () => artilist[ART_NONARTIFACT];

// C ref: artifact.c is_art().
export function is_art(obj, art) { return !!obj && obj.oartifact === art; }

// C ref: artifact.c permapoisoned() — currently only Grimtooth.
export function permapoisoned(obj) { return !!obj && is_art(obj, ART_GRIMTOOTH); }

// C ref: skills.h P_MAX_SKILL(skill) — the role's cap for a weapon skill.
const P_ISRESTRICTED = 0, P_BASIC = 2, P_SKILLED = 3;
function P_MAX_SKILL(skill) {
    const caps = game.urole?.skills || game.u?.weapon_skills || null;
    if (!caps) return P_SKILLED; /* no role skill table loaded */
    const e = Array.isArray(caps) ? caps.find((s) => s.skill === skill) : caps[skill];
    if (e == null) return P_ISRESTRICTED;
    return typeof e === 'number' ? e : (e.max ?? P_ISRESTRICTED);
}

// C ref: artifact.c dispose_of_orig_obj().  obj_extract_self()/obfree() are
// not exported by mkobj.js/invent.js, so the removal is done directly against
// the two chains an unwanted mk_artifact() argument can be on.
export function dispose_of_orig_obj(obj) {
    if (!obj) return;
    const floor = game.level?.objects;
    if (Array.isArray(floor)) {
        const i = floor.indexOf(obj);
        if (i >= 0) floor.splice(i, 1);
    }
    const inv = invent_list();
    const j = inv.indexOf(obj);
    if (j >= 0) inv.splice(j, 1);
    obj.where = OBJ_FREE;
}

// C ref: artifact.c mk_artifact().  Two cases: `alignment != A_NONE` makes an
// aligned gift from scratch, A_NONE converts otmp in place.
//
// RNG: the by_align scan draws rn2(3) / rn2(4) / rn2(2) per candidate under
// exactly C's short-circuit ordering, then one rn2(n) picks the winner.  The
// A_NONE path draws only that final rn2(n) — and only when n > 0, which is why
// an ordinary long sword consumes nothing.
export function mk_artifact(otmp, alignment = A_NONE, max_giftvalue = 99,
                            adjust_spe = false) {
    const by_align = (alignment !== A_NONE);
    const o_typ = (by_align || !otmp) ? 0 : otmp.otyp;
    const unique = !by_align && !!otmp && !!(objects[o_typ]?.flags & F_UNIQUE);
    const eligible = [];
    let n = 0, altn = 0;

    /* gather eligible artifacts */
    for (let m = 1; artilist[m] && artilist[m].otyp; m++) {
        const a = artilist[m];
        if (arti_exists(m)) continue;
        if ((a.spfx & SPFX_NOGEN) || unique) continue;
        if (a.gift_value > max_giftvalue && !Role_if(a.role)) continue;

        if (!by_align) {
            /* a particular item type; not a divine gift, so the role's first
               choice does not matter */
            if (a.otyp === o_typ) eligible[n++] = m;
            continue;
        }

        if ((a.alignment === alignment || a.alignment === A_NONE)
            /* avoid enemies' equipment */
            && (a.race === NON_PM || !race_hostile(monster_by_pmidx(a.race)))) {
            if (Role_if(a.role)) {
                eligible[0] = m;   /* the only possibility */
                n = 1;
                break;
            }

            let skill_compatibility = P_SKILLED;
            if (objects[a.otyp]?.oc_class === WEAPON_CLASS) {
                const skill = objects[a.otyp].oc_skill;
                skill_compatibility = P_MAX_SKILL(skill < 0 ? -skill : skill);
            }

            if ((a.alignment !== A_NONE || (game.u?.ugifts || 0) > 0 || !rn2(3))
                && (!rn2(4) || skill_compatibility >= P_SKILLED
                    || (skill_compatibility >= P_BASIC && rn2(2)))) {
                eligible[n++] = m;
            } else if (!n) {
                /* fallback in case every aligned candidate is used up */
                eligible[altn++] = m;
            }
        }
    }

    if (!n) n = altn;   /* resort to the fallback list */

    if (n) {
        const m = eligible[rn2(n)];  /* [0..n-1] */
        const a = artilist[m];

        if (by_align) {
            const artiobj = mksobj(a.otyp, true, false);
            if (otmp) dispose_of_orig_obj(otmp);  /* avoid orphaning */
            otmp = artiobj;
        }
        otmp.oeroded = 0;                /* prevent erosion from generating */
        otmp.oeroded2 = 0;
        otmp.oname = a.name;             /* oname(otmp, a->name, NO_FLAGS) */
        otmp.oartifact = m;
        artifact_origin(otmp, ONAME_RANDOM);
        if (adjust_spe) {
            /* clamp into the normal range so no +12 artifact can generate */
            const new_spe = (otmp.spe | 0) + a.gen_spe;
            if (new_spe >= -10 && new_spe < 10) otmp.spe = new_spe;
        }
    } else if (by_align && otmp) {
        dispose_of_orig_obj(otmp);
        otmp = null;
    }
    if (otmp && permapoisoned(otmp)) otmp.opoisoned = 1;
    return otmp;
}

// C ref: artifact.c artifact_name().  Returns { name, otyp } or null; C's
// secondary `short *otyp_p` output becomes the second field.
export function artifact_name(name, fuzzy = false) {
    if (/^the /i.test(name)) name = name.slice(4);

    for (let m = 1; artilist[m] && artilist[m].otyp; m++) {
        const a = artilist[m];
        let aname = a.name;
        if (/^the /i.test(aname)) aname = aname.slice(4);
        const hit = !fuzzy ? (name.toLowerCase() === aname.toLowerCase())
                           : fuzzymatch(name, aname, " -", true);
        if (hit) return { name: a.name, otyp: a.otyp };
    }
    return null;
}

// C ref: artifact.c exist_artifact().
export function exist_artifact(otyp, name) {
    if (otyp && name)
        for (let m = 1; artilist[m] && artilist[m].otyp; m++)
            if (artilist[m].otyp === otyp && artilist[m].name === name)
                return arti_exists(m);
    return false;
}

// C ref: artifact.c artifact_exists() — created (mod) or "un-created".
export function artifact_exists(otmp, name, mod, flgs = 0) {
    if (otmp && name)
        for (let m = 1; artilist[m] && artilist[m].otyp; m++) {
            const a = artilist[m];
            if (a.otyp === otmp.otyp && a.name === name) {
                otmp.oartifact = mod ? m : 0;
                otmp.age = 0;
                if (otmp.otyp === RIN_INCREASE_DAMAGE) otmp.spe = 0;
                if (mod) {
                    /* one--and only one--of these should always be set */
                    if ((flgs & (ONAME_VIA_NAMING | ONAME_WISH | ONAME_GIFT
                                 | ONAME_VIA_DIP | ONAME_LEVEL_DEF
                                 | ONAME_BONES | ONAME_RANDOM)) === 0)
                        flgs |= ONAME_RANDOM;    /* the default origin */
                    artifact_origin(otmp, flgs);
                } else {
                    Object.assign(artiinfo()[m], zero_artiexist());
                    set_arti_exists(m, false);
                }
                break;
            }
        }
}

// C ref: artifact.c found_artifact() — mark an artifact 'found'.
export function found_artifact(a) {
    if (a < 1 || a > NROFARTIFACTS) return;   /* C: impossible() */
    if (!arti_exists(a)) return;              /* C: impossible() */
    artiinfo()[a].found = 1;
}

// C ref: artifact.c find_artifact().  `where` reproduces C's four cases; the
// livelog line is queued for js/livelog.js.
export function find_artifact(otmp) {
    const a = otmp?.oartifact | 0;
    if (a && !artiinfo()[a].found) {
        found_artifact(a);
        let where;
        if (otmp.where === OBJ_FLOOR)
            where = inside_shop(otmp.ox, otmp.oy) ? " in a shop" : " on the floor";
        else if (otmp.where === OBJ_CONTAINED) where = " in a container";
        else if (otmp.where === OBJ_MINVENT) where = " carried by a monster";
        else where = "";
        game.livelog_pending = game.livelog_pending || [];
        game.livelog_pending.push(`found ${bare_artifactname(otmp)}${where}`);
    }
}
// C ref: shk.c inside_shop() — unlike costly_spot() this INCLUDES the free
// spot in front of the door and ignores whether a shopkeeper is present.
function inside_shop(x, y) {
    for (const r of game.level?.rooms || []) {
        if (!r || !r.rtype || r.rtype < 8 /* SHOPBASE */) continue;
        if (x >= r.lx - 1 && x <= r.hx + 1 && y >= r.ly - 1 && y <= r.hy + 1)
            return true;
    }
    return false;
}
// C ref: do_name.c bare_artifactname() — the name with no article.
export function bare_artifactname(obj) {
    return obj?.oartifact ? artilist[obj.oartifact].name : (obj?.oname || "");
}

// C ref: artifact.c nartifact_exist().
export function nartifact_exist() {
    let a = 0;
    for (let i = 1; i <= NROFARTIFACTS; ++i) if (arti_exists(i)) ++a;
    return a;
}

// C ref: artifact.c artifact_origin() — exactly one origin bit must end up set.
export function artifact_origin(arti, aflags) {
    const a = arti?.oartifact | 0;
    if (!a) return;
    const info = artiinfo();
    Object.assign(info[a], zero_artiexist());
    set_arti_exists(a, true);
    if ((aflags & ONAME_KNOW_ARTI) !== 0) info[a].found = 1;
    let ct = 0;
    if ((aflags & ONAME_WISH) !== 0) { info[a].wish = 1; ++ct; }
    if ((aflags & ONAME_GIFT) !== 0) { info[a].gift = 1; ++ct; }
    if ((aflags & ONAME_VIA_DIP) !== 0) { info[a].viadip = 1; ++ct; }
    if ((aflags & ONAME_VIA_NAMING) !== 0) { info[a].named = 1; ++ct; }
    if ((aflags & ONAME_LEVEL_DEF) !== 0) { info[a].lvldef = 1; ++ct; }
    if ((aflags & ONAME_BONES) !== 0) { info[a].bones = 1; ++ct; }
    if ((aflags & ONAME_RANDOM) !== 0) { info[a].rndm = 1; ++ct; }
    void ct;   /* C impossible()s when ct != 1 */
}

// C ref: artifact.c spec_ability().
export function spec_ability(otmp, abil) {
    const arti = get_artifact(otmp);
    return arti !== NONART() && (arti.spfx & abil) !== 0;
}

// C ref: artifact.c confers_luck().
export function confers_luck(obj) {
    if (obj?.otyp === LUCKSTONE) return true;
    return !!obj?.oartifact && spec_ability(obj, SPFX_LUCK);
}

// C ref: artifact.c arti_reflects().
export function arti_reflects(obj) {
    const arti = get_artifact(obj);
    if (arti !== NONART()) {
        if ((obj.owornmask & ~W_ART) && (arti.spfx & SPFX_REFLECT)) return true;
        if (arti.cspfx & SPFX_REFLECT) return true;   /* just being carried */
    }
    return false;
}

// C ref: artifact.c shade_glare() — does obj hurt shades?  (The blessed-vs-
// undead bonus is the caller's business.)
export function shade_glare(obj) {
    if (objects[obj.otyp]?.material === SILVER) return true;
    const arti = get_artifact(obj);
    return arti !== NONART() && !!(arti.spfx & SPFX_DFLAG2)
        && arti.mtype === M2_UNDEAD;
}

// C ref: o_init.c obj_shuffle_range().  js/o_init.js has this function but
// does not export it; restrict_name() is the only caller here.  DELETE THIS
// COPY once o_init.js exports its own.
function obj_shuffle_range(otyp) {
    const ocls = objects[otyp].oc_class;
    let lo = otyp, hi = otyp;
    const clsBase = (c) => objects.findIndex((o) => o.oc_class === c);
    switch (ocls) {
    case ARMOR_CLASS: {
        const HELMET = otyp_by_name('helmet');
        const HELM_OF_TELEPATHY = otyp_by_name('helm of telepathy');
        const LEATHER_GLOVES = otyp_by_name('leather gloves');
        const GAUNTLETS_OF_DEXTERITY = otyp_by_name('gauntlets of dexterity');
        const CLOAK_OF_DISPLACEMENT = otyp_by_name('cloak of displacement');
        const SPEED_BOOTS = otyp_by_name('speed boots');
        const LEVITATION_BOOTS = otyp_by_name('levitation boots');
        if (otyp >= HELMET && otyp <= HELM_OF_TELEPATHY) { lo = HELMET; hi = HELM_OF_TELEPATHY; }
        else if (otyp >= LEATHER_GLOVES && otyp <= GAUNTLETS_OF_DEXTERITY) { lo = LEATHER_GLOVES; hi = GAUNTLETS_OF_DEXTERITY; }
        else if (otyp >= CLOAK_OF_PROTECTION && otyp <= CLOAK_OF_DISPLACEMENT) { lo = CLOAK_OF_PROTECTION; hi = CLOAK_OF_DISPLACEMENT; }
        else if (otyp >= SPEED_BOOTS && otyp <= LEVITATION_BOOTS) { lo = SPEED_BOOTS; hi = LEVITATION_BOOTS; }
        break;
    }
    case POTION_CLASS:
        /* potion of water has the only fixed description */
        lo = clsBase(POTION_CLASS);
        hi = otyp_by_name('water') - 1;
        break;
    case AMULET_CLASS:
    case SCROLL_CLASS:
    case SPBOOK_CLASS: {
        /* exclude non-magic types and also unique ones */
        lo = clsBase(ocls);
        let i = lo;
        for (; objects[i] && objects[i].oc_class === ocls; i++)
            if (!objects[i].oc_magic || (objects[i].flags & F_UNIQUE)) break;
        hi = i - 1;
        break;
    }
    case RING_CLASS:
    case WAND_CLASS:
    case GEM_CLASS:
        lo = clsBase(ocls);
        hi = lo;
        while (objects[hi + 1] && objects[hi + 1].oc_class === ocls) hi++;
        break;
    default:
        break;
    }
    return [lo, hi];
}

// C ref: artifact.c restrict_name() — TRUE if `name` is reserved for otmp's
// type, so naming an ordinary item that must fail.
export function restrict_name(otmp, name) {
    const otyp = otmp.otyp, ocls = objects[otyp].oc_class;
    if (!name) return false;
    if (/^the /i.test(name)) name = name.slice(4);

    /* if the type has been discovered only itself matches; otherwise every
       other undiscovered type of the same class with the same description or
       sharing its pool of shuffled descriptions matches too */
    const sametype = new Array(objects.length).fill(false);
    sametype[otyp] = true;
    const odesc = DESCR_BY_OTYP[objects[otyp].oc_descr_idx ?? otyp] ?? null;
    if (!objects[otyp].oc_name_known && odesc != null) {
        const [lo, hi] = obj_shuffle_range(otyp);
        const base = objects.findIndex((o) => o.oc_class === ocls);
        for (let i = base; i < objects.length; i++) {
            if (objects[i].oc_class !== ocls) break;
            const other = DESCR_BY_OTYP[objects[i].oc_descr_idx ?? i] ?? null;
            if (!objects[i].oc_name_known && other != null
                && (odesc === other || (i >= lo && i <= hi)))
                sametype[i] = true;
        }
    }

    /* the string compare comes first because almost every artifact is
       SPFX_RESTR anyway; the quan test stops multiple elven daggers all
       being named "Sting" */
    for (let m = 1; artilist[m] && artilist[m].otyp; m++) {
        const a = artilist[m];
        if (!sametype[a.otyp]) continue;
        let aname = a.name;
        if (/^the /i.test(aname)) aname = aname.slice(4);
        if (aname === name)
            return (a.spfx & (SPFX_NOGEN | SPFX_RESTR)) !== 0 || (otmp.quan || 1) > 1;
    }
    return false;
}

// C ref: artifact.c attacks().
export function attacks(adtyp, otmp) {
    const weap = get_artifact(otmp);
    return weap !== NONART() && weap.attk.adtyp === adtyp;
}

// C ref: obj.h Is_dragon_scales/Is_dragon_mail/Is_dragon_armor.
function Is_dragon_scales(obj) {
    return obj.otyp >= GRAY_DRAGON_SCALES && obj.otyp <= YELLOW_DRAGON_SCALES;
}
function Is_dragon_mail(obj) {
    return obj.otyp >= GRAY_DRAGON_SCALE_MAIL && obj.otyp <= YELLOW_DRAGON_SCALE_MAIL;
}
function Is_dragon_armor(obj) { return Is_dragon_scales(obj) || Is_dragon_mail(obj); }

// C ref: artifact.c defends().
export function defends(adtyp, otmp) {
    if (!otmp) return false;
    const weap = get_artifact(otmp);
    if (weap !== NONART()) return weap.defn.adtyp === adtyp;
    if (Is_dragon_armor(otmp)) {
        let otyp = otmp.otyp;
        /* convert mail to scales to simplify testing */
        if (Is_dragon_mail(otmp)) otyp += GRAY_DRAGON_SCALES - GRAY_DRAGON_SCALE_MAIL;

        switch (adtyp) {
        case AD_MAGM: return otyp === GRAY_DRAGON_SCALES;   /* general magic res */
        case AD_HALU: return otyp === GOLD_DRAGON_SCALES;
        case AD_FIRE: return otyp === RED_DRAGON_SCALES;    /* red but not gold */
        case AD_COLD: return otyp === WHITE_DRAGON_SCALES;  /* white not silver */
        case AD_DRST:                                       /* drain str => poison */
        case AD_DISE: return otyp === GREEN_DRAGON_SCALES;
        case AD_SLEE:
        case AD_PLYS: return otyp === ORANGE_DRAGON_SCALES; /* free action */
        case AD_DISN:
        case AD_DRLI: return otyp === BLACK_DRAGON_SCALES;
        case AD_ELEC:
        case AD_SLOW: return otyp === BLUE_DRAGON_SCALES;   /* speed can't be lost */
        case AD_ACID:
        case AD_STON: return otyp === YELLOW_DRAGON_SCALES;
        default:
            /* SILVER_DRAGON_SCALES don't resist any particular attack type */
            break;
        }
    }
    return false;
}

// C ref: artifact.c defends_when_carried() — used for monsters.
export function defends_when_carried(adtyp, otmp) {
    const weap = get_artifact(otmp);
    return weap !== NONART() && weap.cary.adtyp === adtyp;
}

// objclass.h oc_oprop: this port's objects[] omits that column entirely, so
// the PROTECTION rows are listed from include/objects.h (the only ones
// protects() reads): ring of protection, cloak of protection, amulet of
// guarding.
const OPROP_PROTECTION = new Set([RIN_PROTECTION, CLOAK_OF_PROTECTION,
    AMULET_OF_GUARDING]);

// C ref: artifact.c protects().
export function protects(otmp, being_worn) {
    if (being_worn && OPROP_PROTECTION.has(otmp.otyp)) return true;
    const arti = get_artifact(otmp);
    if (arti === NONART()) return false;
    return (arti.cspfx & SPFX_PROTECT) !== 0
        || (being_worn && (arti.spfx & SPFX_PROTECT) !== 0);
}

// prop.h enum prop_types — the properties set_artifact_intrinsic() touches.
const FIRE_RES = 1, COLD_RES = 2, DISINT_RES = 4, SHOCK_RES = 5,
    POISON_RES = 6, DRAIN_RES = 9, ANTIMAGIC = 12, HALLUC_RES = 24,
    TELEPAT = 30, WARNING = 31, WARN_OF_MON = 32, SEARCHING = 34,
    BLND_RES = 38, STEALTH = 42, TELEPORT_CONTROL = 47, HALF_SPDAM = 55,
    HALF_PHDAM = 56, REGENERATION = 57, ENERGY_REGENERATION = 58,
    REFLECTING = 65;
// C ref: artifact.c set_artifact_intrinsic()'s adtyp -> E<prop> chain.
const ADTYP_TO_PROP = {
    [AD_FIRE]: FIRE_RES, [AD_COLD]: COLD_RES, [AD_ELEC]: SHOCK_RES,
    [AD_MAGM]: ANTIMAGIC, [AD_DISN]: DISINT_RES, [AD_DRST]: POISON_RES,
    [AD_DRLI]: DRAIN_RES,
};
// C ref: the same function's spfx chain, in C's order.  SPFX_HALRES goes
// through make_hallucinated() rather than a plain mask, and SPFX_XRAY writes
// u.xray_range instead of a property.
const SPFX_TO_PROP = [
    [SPFX_SEARCH, SEARCHING], [SPFX_ESP, TELEPAT], [SPFX_STLTH, STEALTH],
    [SPFX_REGEN, REGENERATION], [SPFX_TCTRL, TELEPORT_CONTROL],
    [SPFX_EREGEN, ENERGY_REGENERATION], [SPFX_HSPDAM, HALF_SPDAM],
    [SPFX_HPHDAM, HALF_PHDAM], [SPFX_PROTECT, PROTECTION],
];
function toggle_extrinsic(prop, on, wp_mask) {
    const cur = extrinsic_of(prop);
    set_extrinsic(prop, on ? (cur | wp_mask) : (cur & ~wp_mask));
}

// C ref: artifact.c set_artifact_intrinsic() — a potential artifact has just
// been worn/wielded/picked-up or the reverse.  Pickup/drop only set/reset the
// W_ART bit.  RNG-free, but it writes the state that later moduli read.
export function set_artifact_intrinsic(otmp, on, wp_mask) {
    const oart = get_artifact(otmp);
    if (oart === NONART()) return;

    /* effects from the defn field (worn/wielded) or cary (merely carried) */
    const dtyp = (wp_mask !== W_ART) ? oart.defn.adtyp : oart.cary.adtyp;
    let prop = ADTYP_TO_PROP[dtyp] || 0;

    if (prop && wp_mask === W_ART && !on) {
        /* if some other carried artifact also confers this, leave it alone */
        for (const obj of invent_list()) {
            if (obj !== otmp && obj.oartifact) {
                const art = get_artifact(obj);
                if (art !== NONART() && art.cary.adtyp === dtyp) { prop = 0; break; }
            }
        }
    }
    if (prop) toggle_extrinsic(prop, on, wp_mask);

    /* intrinsics from the spfx field; there could be more than one */
    let spfx = (wp_mask !== W_ART) ? oart.spfx : oart.cspfx;
    if (spfx && wp_mask === W_ART && !on) {
        /* don't change any spfx also conferred by another artifact */
        for (const obj of invent_list())
            if (obj !== otmp && obj.oartifact) {
                const art = get_artifact(obj);
                if (art !== NONART()) spfx &= ~art.cspfx;
            }
    }

    for (const [bit, p] of SPFX_TO_PROP)
        if (spfx & bit) toggle_extrinsic(p, on, wp_mask);
    if (spfx & SPFX_HALRES) {
        /* make_hallucinated() must (re)set the mask itself to get the display
           right, so C calls it rather than touching EHalluc_resistance */
        toggle_extrinsic(HALLUC_RES, on, wp_mask);
    }
    if (spfx & SPFX_WARN) {
        if (spec_m2(otmp)) {
            toggle_extrinsic(WARN_OF_MON, on, wp_mask);
            game.warntype_obj = on ? ((game.warntype_obj || 0) | spec_m2(otmp))
                                   : ((game.warntype_obj || 0) & ~spec_m2(otmp));
        } else {
            toggle_extrinsic(WARNING, on, wp_mask);
        }
    }
    if (spfx & SPFX_XRAY) {
        /* this assumes no one else is using xray_range */
        if (game.u) game.u.xray_range = on ? 3 : -1;
        game.vision_full_recalc = 1;
    }
    if ((spfx & SPFX_REFLECT) && (wp_mask & W_WEP))
        toggle_extrinsic(REFLECTING, on, wp_mask);

    if (wp_mask === W_ART && !on && oart.inv_prop) {
        /* might have to turn off the invoked power too */
        if (oart.inv_prop <= LAST_PROP
            && (extrinsic_of(oart.inv_prop) & W_ARTI))
            arti_invoke(otmp);
    }

    if (wp_mask === W_WEP && is_art(otmp, ART_SUNSWORD))
        toggle_extrinsic(BLND_RES, on, wp_mask);
}

// C ref: artifact.c arti_immune() — is the artifact itself immune to an
// erosion damage type, regardless of its bearer?
export function arti_immune(obj, dtyp) {
    const weap = get_artifact(obj);
    if (weap === NONART()) return false;
    if (dtyp === AD_PHYS) return false;   /* nothing is immune to phys dmg */
    return weap.attk.adtyp === dtyp || weap.defn.adtyp === dtyp
        || weap.cary.adtyp === dtyp;
}

// C ref: artifact.c bane_applies() — spec_applies() with every spfx bit but
// the damage-bonus mask cleared.
export function bane_applies(oart, mon) {
    if (oart !== NONART() && (oart.spfx & SPFX_DBONUS) !== 0) {
        const atmp = { ...oart, spfx: oart.spfx & SPFX_DBONUS };
        if (spec_applies(atmp, mon)) return true;
    }
    return false;
}

// C ref: artifact.c spec_applies().  RNG: the AD_MAGM/AD_STUN arm draws
// rn2(100) against the defender's mr — for a monster only; the hero uses
// Antimagic instead and draws nothing.
export function spec_applies(weap, mtmp) {
    if (!(weap.spfx & (SPFX_DBONUS | SPFX_ATTK)))
        return weap.attk.adtyp === AD_PHYS;

    const yours = is_you(mtmp);
    const ptr = mon_data(mtmp);

    if (weap.spfx & SPFX_DMONS) {
        return ptr?.pmidx === weap.mtype;
    } else if (weap.spfx & SPFX_DCLAS) {
        return weap.mtype === ptr?.mcls;
    } else if (weap.spfx & SPFX_DFLAG1) {
        return (mflags1_of(ptr) & weap.mtype) !== 0;
    } else if (weap.spfx & SPFX_DFLAG2) {
        return !!((mflags2_of(ptr) & weap.mtype)
                  || (yours
                      && ((!Upolyd() && ((game.urace?.selfmask || 0) & weap.mtype))
                          || ((weap.mtype & M2_WERE) && (game.u?.ulycn ?? NON_PM) >= 0))));
    } else if (weap.spfx & SPFX_DALIGN) {
        return yours ? (ualign_type() !== weap.alignment)
                     : ((ptr?.maligntyp ?? 0) === A_NONE
                        || Math.sign(ptr?.maligntyp ?? 0) !== weap.alignment);
    } else if (weap.spfx & SPFX_ATTK) {
        if (defended(mtmp, weap.attk.adtyp)) return false;

        switch (weap.attk.adtyp) {
        case AD_FIRE: return !(yours ? Fire_resistance() : resists_fire(mtmp));
        case AD_COLD: return !(yours ? Cold_resistance() : resists_cold(mtmp));
        case AD_ELEC: return !(yours ? Shock_resistance() : resists_elec(mtmp));
        case AD_MAGM:
        case AD_STUN: return !(yours ? Antimagic() : (rn2(100) < mon_mr(ptr)));
        case AD_DRST: return !(yours ? Poison_resistance() : resists_poison(mtmp));
        case AD_DRLI: return !(yours ? Drain_resistance() : resists_drli(mtmp));
        case AD_STON: return !(yours ? Stone_resistance() : resists_ston(mtmp));
        default:
            break;   /* C: impossible("Weird weapon special attack.") */
        }
    }
    return false;
}

// C ref: artifact.c spec_m2() — the M2 flags an artifact warns/bonuses against.
export function spec_m2(otmp) {
    const artifact = get_artifact(otmp);
    return artifact !== NONART() ? artifact.mtype : 0;
}

// C ref: artifact.c spec_abon() — special to-hit bonus, rnd(attk.damn).
// (No extra NO_ATTK check is needed: damn is 0 for any such artifact.)
export function spec_abon(otmp, mon) {
    const weap = get_artifact(otmp);
    if (weap !== NONART() && weap.attk.damn && spec_applies(weap, mon))
        return rnd(weap.attk.damn);
    return 0;
}

// C ref: artifact.c spec_dbon() — special damage bonus.  Writes C's
// gs.spec_dbon_applies, which artifact_hit()/Mb_hit() read afterwards, so the
// flag lives on `game` rather than being a local.
export function spec_dbon(otmp, mon, tmp) {
    const weap = get_artifact(otmp);

    if (weap === NONART()
        || (weap.attk.adtyp === AD_PHYS   /* check for `NO_ATTK' */
            && weap.attk.damn === 0 && weap.attk.damd === 0))
        game.spec_dbon_applies = false;
    else if (is_art(otmp, ART_GRIMTOOTH))
        /* Grimtooth's SPFX warns against elves but its damage bonus applies to
           every target, so spec_applies() is bypassed */
        game.spec_dbon_applies = true;
    else
        game.spec_dbon_applies = spec_applies(weap, mon);

    if (game.spec_dbon_applies)
        return weap.attk.damd ? rnd(weap.attk.damd) : Math.max(tmp, 1);
    return 0;
}

// C ref: artifact.c discover_artifact() — add to the discoveries list.
export function discover_artifact(m) {
    const disco = artidisco();
    for (let i = 0; i < NROFARTIFACTS; i++)
        if (disco[i] === 0 || disco[i] === m) { disco[i] = m; return; }
    /* C: impossible("couldn't discover artifact (%d)", m) */
}

// C ref: artifact.c undiscovered_artifact().
export function undiscovered_artifact(m) {
    const disco = artidisco();
    for (let i = 0; i < NROFARTIFACTS; i++) {
        if (disco[i] === m) return false;
        else if (disco[i] === 0) break;
    }
    return true;
}

// C ref: artifact.c disp_artifact_discoveries().  C returns the count and
// writes the window as it goes; `rows` is that same text.
export function disp_artifact_discoveries() {
    const disco = artidisco();
    const rows = [];
    let i = 0;
    for (; i < NROFARTIFACTS; i++) {
        if (disco[i] === 0) break;   /* empty slot implies end of list */
        if (i === 0) rows.push("Artifacts");
        const m = disco[i];
        let algnstr = align_str(artilist[m].alignment);
        if (algnstr === "unaligned") algnstr = "non-aligned";
        rows.push(`  ${artiname(m)} [${algnstr} ${simple_typename(artilist[m].otyp)}]`);
    }
    return { count: i, rows };
}
// C ref: align.c align_str().
function align_str(alignment) {
    switch (alignment) {
    case A_LAWFUL: return "lawful";
    case A_NEUTRAL: return "neutral";
    case A_CHAOTIC: return "chaotic";
    case A_NONE: return "unaligned";
    default: return "unknown";
    }
}
// C ref: objnam.c simple_typename() — the actual name with any "<class> of "
// prefix dropped, or the description when unidentified.
function simple_typename(otyp) {
    const o = objects[otyp];
    if (!o) return "";
    const nm = o.name || DESCR_BY_OTYP[otyp] || "";
    const cut = nm.indexOf(" of ");
    return cut >= 0 ? nm.slice(cut + 4) : nm;
}

// C ref: artifact.c dump_artifact_info() — wizard-mode listing of the nine
// tracking bits per artifact.
export function dump_artifact_info() {
    const info = artiinfo();
    const rows = ["Artifacts"];
    for (let m = 1; m <= NROFARTIFACTS; ++m) {
        const f = info[m];
        const buf2 = "[" + (arti_exists(m) ? "exists;" : "")
            + (f.found ? " hero knows;" : "")
            + (f.gift ? " gift" : "") + (f.wish ? " wish" : "")
            + (f.named ? " named" : "") + (f.viadip ? " viadip" : "")
            + (f.lvldef ? " lvldef" : "") + (f.bones ? " bones" : "")
            + (f.rndm ? " random" : "") + "]";
        /* "The Platinum Yendorian Express Card" is 35 characters */
        rows.push("  " + artiname(m).padEnd(36).slice(0, 36) + buf2);
    }
    return rows;
}

// ─────────────────────────────────────────────────────────────────────────
// touch_artifact
// ─────────────────────────────────────────────────────────────────────────
// C ref: artifact.c `static boolean touch_blasted` — read by retouch_object().
function touch_blasted(v) {
    if (v === undefined) return !!game._touch_blasted;
    game._touch_blasted = v;
    return v;
}

// C ref: artifact.c touch_artifact().  RNG: rn2(4) for a hero touching a
// badly-aligned artifact, then d(Antimagic ? 2 : 4, self_willed ? 10 : 4) and
// a silver rnd(10) for the blast.  Returns C's 0/1.
export function touch_artifact(obj, mon) {
    const oart = get_artifact(obj);

    touch_blasted(false);
    if (oart === NONART()) return 1;

    const yours = is_you(mon);
    /* every quest artifact is self-willed; if that ever changes, badclass
       has to name them explicitly */
    const self_willed = (oart.spfx & SPFX_INTEL) !== 0;
    let badclass, badalign;
    if (yours) {
        badclass = self_willed
                   && ((oart.role !== NON_PM && !Role_if(oart.role))
                       || (oart.race !== NON_PM && !Race_if(oart.race)));
        badalign = (oart.spfx & SPFX_RESTR) !== 0
                   && oart.alignment !== A_NONE
                   && (oart.alignment !== ualign_type() || ualign_record() < 0);
    } else if (!is_covetous(mon_data(mon)) && !is_mplayer(mon_data(mon))) {
        badclass = self_willed && oart.role !== NON_PM
                   && oart !== artilist[ART_EXCALIBUR];
        badalign = !!(oart.spfx & SPFX_RESTR) && oart.alignment !== A_NONE
                   && (oart.alignment !== mon_aligntyp(mon));
    } else {
        /* an M3_WANTSxxx monster or a fake player can touch anything that
           isn't a `spec_applies' artifact */
        badclass = badalign = false;
    }
    /* weapons that attack specific categories of monster are bad for them
       even when the alignments happen to match */
    if (!badalign) badalign = bane_applies(oart, mon);

    if (((badclass || badalign) && self_willed)
        || (badalign && (!yours || !rn2(4)))) {
        if (!yours) return 0;
        game._pending_message = `You are blasted by the ${xname(obj)}'s power!`;
        touch_blasted(true);
        let dmg = d(Antimagic() ? 2 : 4, self_willed ? 10 : 4);
        /* add half (maybe quarter) of the usual silver damage bonus */
        if (objects[obj.otyp]?.material === SILVER && Hate_silver())
            dmg += Maybe_Half_Phys(rnd(10));
        losehp(dmg);        /* magic damage, not physical */
        exercise(A_WIS, false);
    }

    /* can pick it up unless you're totally non-synch'd with the artifact */
    if (badclass && badalign && self_willed) return 0;
    return 1;
}
// C ref: hack.c losehp() reduced to the hp arithmetic; the death path lives in
// each caller's own copy elsewhere in this port.
function losehp(n) {
    const u = game.u;
    if (!u) return;
    if (Upolyd()) { u.mh -= n; if (u.mh < 1) u.mh = 0; }
    else { u.uhp -= n; if (u.uhp > u.uhpmax) u.uhpmax = u.uhp; if (u.uhp < 1) u.uhp = 0; }
    game.botl = true;
}
// C ref: objnam.c xname() reduced to what the artifact messages need.
function xname(obj) {
    if (obj?.oartifact) return artilist[obj.oartifact].name;
    return obj?.oname || objects[obj?.otyp]?.name || "object";
}
function upstart(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function carried(obj) { return invent_list().includes(obj); }

// ─────────────────────────────────────────────────────────────────────────
// Magicbane
//
// Magicbane's intrinsic magic is incompatible with normal enchantment magic,
// so its effects have a NEGATIVE dependence on spe.  Against low-mr victims it
// typically does "double athame" damage, 2d4.
// ─────────────────────────────────────────────────────────────────────────
const MB_INDEX_PROBE = 0, MB_INDEX_STUN = 1, MB_INDEX_SCARE = 2,
      MB_INDEX_CANCEL = 3;
const MB_MAX_DIEROLL = 8;   /* rolls above this aren't magical */
const mb_verb = [
    ["probe", "stun", "scare", "cancel"],
    ["prod", "amaze", "tickle", "purge"],
];

// C ref: artifact.c Mb_hit().  RNG, in order: rn2(spec_dbon ? 11 : 7) for the
// stun check, then rnd(4) once per severity step (1..4 of them), then the
// per-effect draws (CANCEL: resist(); SCARE: rn2(2) then resist(); PROBE:
// rn2(3*|spe|)), then rn2(12) for the confusion.  Every one of those is
// unconditional in C at the point shown, so the order must not be rearranged.
//
// `mdmg` stands in for C's `int *dmgptr`: pass { d: <damage> } and read the
// updated .d back out.  Returns C's boolean (a message was given).
export function Mb_hit(magr, mdef, mb, mdmg, dieroll, vis, hittee) {
    const youattack = is_you(magr), youdefend = is_you(mdef);
    let resisted = false, do_stun, do_confuse, result = false;
    let scare_dieroll = Math.trunc(MB_MAX_DIEROLL / 2);

    /* the most severe effects are less likely at higher enchantment */
    if (mb.spe >= 3)
        scare_dieroll = Math.trunc(scare_dieroll / (1 << Math.trunc(mb.spe / 3)));
    /* a target that resisted the damage bonus is less likely to be affected */
    if (!game.spec_dbon_applies) dieroll += 1;

    /* might stun even while attempting a more severe effect, but then only if
       the other effect fails; the extra damage applies regardless */
    do_stun = (Math.max(mb.spe, 0) < rn2(game.spec_dbon_applies ? 11 : 7));

    let attack_indx = MB_INDEX_PROBE;
    mdmg.d += rnd(4);                       /* (2..3)d4 */
    if (do_stun) {
        attack_indx = MB_INDEX_STUN;
        mdmg.d += rnd(4);                   /* (3..4)d4 */
    }
    if (dieroll <= scare_dieroll) {
        attack_indx = MB_INDEX_SCARE;
        mdmg.d += rnd(4);                   /* (3..5)d4 */
    }
    if (dieroll <= Math.trunc(scare_dieroll / 2)) {
        attack_indx = MB_INDEX_CANCEL;
        mdmg.d += rnd(4);                   /* (4..6)d4 */
    }

    /* give the hit message before inflicting the effects */
    const verb = mb_verb[Hallucination() ? 1 : 0][attack_indx];
    if (youattack || youdefend || vis) {
        result = true;
        game._pending_message = `The magic-absorbing blade ${verb}s ${hittee}!`;
    }

    switch (attack_indx) {
    case MB_INDEX_CANCEL: {
        const old_mdat = youdefend ? youmonst_data() : mdef.data;
        /* no mdef->mcan check: even a cancelled monster can be polymorphed
           into a golem, and "cancel" acts as if some magical energy remains */
        if (!cancel_monst(mdef, mb, youattack, false, false)) {
            resisted = true;
        } else {
            do_stun = false;
            if (youdefend) {
                if (youmonst_data() !== old_mdat) mdmg.d = 0;  /* rehumanized */
                if (game.u.uenmax > 0) {
                    game.u.uenmax--;
                    if (game.u.uen > 0) game.u.uen--;
                    game.botl = true;
                    game._pending_message = "You lose magical energy!";
                }
            } else {
                if (mdef.data === monster_by_pmidx(PM_CLAY_GOLEM))
                    mdef.mhp = 1;   /* cancelled clay golems will die */
                if (youattack && attacktype(mdef.data, AT_MAGC)) {
                    game.u.uenmax++;
                    if (game.u.uenmax > (game.u.uenpeak || 0))
                        game.u.uenpeak = game.u.uenmax;
                    game.u.uen++;
                    game.botl = true;
                    game._pending_message = "You absorb magical energy!";
                }
            }
        }
        break;
    }
    case MB_INDEX_SCARE:
        if (youdefend) {
            if (Antimagic()) {
                resisted = true;
            } else {
                nomul(-3);
                game.multi_reason = "being scared stiff";
                game.nomovemsg = "";
                if (magr && magr === game.u?.ustuck && sticks(youmonst_data())) {
                    game.u.ustuck = null;
                    game._pending_message = `You release ${mon_nam(magr)}!`;
                }
            }
        } else {
            if (rn2(2) && resist(mdef, WEAPON_CLASS, 0, false)) resisted = true;
            else monflee(mdef, 3, false, (mdef.mhp > mdmg.d));
        }
        if (!resisted) do_stun = false;
        break;

    case MB_INDEX_STUN:
        do_stun = true;   /* (this is redundant...) */
        break;

    case MB_INDEX_PROBE:
        if (youattack && (mb.spe === 0 || !rn2(3 * Math.abs(mb.spe)))) {
            game._pending_message = `The ${verb} is insightful.`;
            probe_monster(mdef);   /* pre-damage status */
        }
        break;
    }
    /* stun if that was selected and a worse effect didn't occur */
    if (do_stun) {
        if (youdefend) make_stunned((HStun() & TIMEOUT) + 3, false);
        else mdef.mstun = 1;
        /* avoid the extra stun message below if mb_verb["stun"] was used */
        if (attack_indx === MB_INDEX_STUN) do_stun = false;
    }
    /* lastly, all this magic can be confusing... */
    do_confuse = !rn2(12);
    if (do_confuse) {
        if (youdefend) make_confused((HConfusion() & TIMEOUT) + 4, false);
        else mdef.mconf = 1;
    }

    if (youattack || youdefend || vis) {
        if (resisted) game._pending_message = `${upstart(hittee)} resists!`;
        if (do_stun || do_confuse) {
            let buf = "";
            if (do_stun) buf += "stunned";
            if (do_stun && do_confuse) buf += " and ";
            if (do_confuse) buf += "confused";
            game._pending_message = `${upstart(hittee)} ${youdefend ? "are" : "is"} ${buf}${(do_stun && do_confuse) ? '!' : '.'}`;
        }
    }

    return result;
}
function HStun() { return uprop('Stun') | 0; }
function HConfusion() { return uprop('Confusion') | 0; }

// C ref: zap.c cancel_monst() restricted to Mb_hit's call
// (self_cancel = FALSE, allow_cancel_kill = FALSE).  RNG: resist().
// normal_shape() (forcing a shapeshifter back to its base form) is zap.c's and
// is not reproduced here.
function cancel_monst(mdef, obj, youattack, _allow_cancel_kill, _self_cancel) {
    const youdefend = is_you(mdef);
    if (youdefend ? (!youattack && Antimagic())
                  : resist(mdef, obj.oclass, 0, false))
        return false;   /* resisted cancellation */
    if (!youdefend) mdef.mcan = 1;
    return true;
}
// detect.c probe_monster(); potion.c make_stunned()/make_confused().
function probe_monster(mtmp) {
    const fn = artifact_hooks.probe_monster;
    if (fn) return fn(mtmp);
    return unbound('probe_monster', undefined);
}
function make_stunned(xtime, talk) {
    const fn = artifact_hooks.make_stunned;
    if (fn) return fn(xtime, talk);
    if (game.u) (game.u.uprops ||= {}).Stun = xtime;
    return unbound('make_stunned', undefined);
}
function make_confused(xtime, talk) {
    const fn = artifact_hooks.make_confused;
    if (fn) return fn(xtime, talk);
    if (game.u) (game.u.uprops ||= {}).Confusion = xtime;
    return unbound('make_confused', undefined);
}

// ─────────────────────────────────────────────────────────────────────────
// artifact_hit
// ─────────────────────────────────────────────────────────────────────────
// The amount added to the victim's total hit points to insure the victim will
// be killed even after damage bonus/penalty adjustments.  Half physical damage
// is why the fatal damage is computed from 2x hp rather than 1x.
const FATAL_DAMAGE_MODIFIER = 200;

// C ref: makemon.c monhp_per_lvl() — the level-drain HP amount.  js/zap.js:1013
// has an `rnd(8)`-only copy missing the golem / mlevel>49 / adult-dragon /
// level-0 arms; this is the whole function.
function monhp_per_lvl(mon) {
    const ptr = mon_data(mon);
    let hp = rnd(8);   /* default is d8 */
    if (is_golem(ptr)) {
        hp = Math.trunc(golemhp(ptr) / (ptr.mlevel || 1));
    } else if ((ptr?.mlevel || 0) > 49) {
        hp = 4 + rnd(4);   /* 5..8 */
    } else if (ptr?.mcls === S_DRAGON && ptr.pmidx >= PM_GRAY_DRAGON) {
        hp = 4 + rn2(5);   /* 4..8 */
    } else if (!mon.m_lev) {
        hp = rnd(4);       /* level 0 monsters use 1d4 */
    }
    return hp;
}
// C ref: mkobj.c golemhp() — fixed HP per golem type.
const GOLEM_HP = {
    'straw golem': 20, 'paper golem': 20, 'rope golem': 30, 'gold golem': 40,
    'leather golem': 40, 'wood golem': 50, 'flesh golem': 40, 'clay golem': 50,
    'stone golem': 60, 'glass golem': 60, 'iron golem': 80,
};
function golemhp(ptr) { return GOLEM_HP[ptr?.name] || 20; }

// C ref: artifact.c artifact_hit().  Adds only the artifact's own damage and
// returns TRUE when it did something special (the caller then suppresses the
// ordinary hit message).  dmgval() no longer accounts for artifact bonuses.
//
// RNG, in the order C draws it: spec_dbon() first (rnd(damd) when it applies),
// then the elemental arms' rn2(4)/rn2(4)/rn2(5) item-destruction checks, then
// Magicbane's whole Mb_hit() sequence, then the DRLI arm's monhp_per_lvl().
//
// `mdmg` stands in for C's `int *dmgptr`: pass { d: <damage> }, read .d back.
export async function artifact_hit(magr, mdef, otmp, mdmg, dieroll) {
    const youattack = is_you(magr);
    const youdefend = is_you(mdef);
    const vis = (!youattack && magr && cansee(magr.mx, magr.my))
             || (!youdefend && cansee(mdef.mx, mdef.my))
             || (youattack && engulfing_u(mdef) && !Blind());
    let wepdesc;
    const hittee = youdefend ? "you" : mon_nam(mdef);

    /* this takes care of most of the damage; level draining is special-cased
       further down.  Messages are done here either way. */
    mdmg.d += spec_dbon(otmp, mdef, mdmg.d);

    if (youattack && youdefend) return false;   /* C: impossible() */

    const realizes_damage = (youdefend || vis
                             /* feel the effect even if not seen */
                             || (youattack && mdef === game.u?.ustuck));

    /* the four basic attacks: fire, cold, shock and missiles */
    if (attacks(AD_FIRE, otmp)) {
        if (realizes_damage)
            game._pending_message = `The fiery blade ${
                !game.spec_dbon_applies ? "hits"
                : (mdef.data === monster_by_pmidx(PM_WATER_ELEMENTAL))
                    ? "vaporizes part of" : "burns"} ${hittee}${
                !game.spec_dbon_applies ? '.' : '!'}`;
        if (!rn2(4)) {
            const itemdmg = await destroy_items(mdef, AD_FIRE, mdmg.d);
            if (!youdefend) mdmg.d += itemdmg;   /* item destruction dmg */
            ignite_items(mdef.minvent);
        }
        return realizes_damage;
    }
    if (attacks(AD_COLD, otmp)) {
        if (realizes_damage)
            game._pending_message = `The ice-cold blade ${
                !game.spec_dbon_applies ? "hits" : "freezes"} ${hittee}${
                !game.spec_dbon_applies ? '.' : '!'}`;
        if (!rn2(4)) {
            const itemdmg = await destroy_items(mdef, AD_COLD, mdmg.d);
            if (!youdefend) mdmg.d += itemdmg;
        }
        return realizes_damage;
    }
    if (attacks(AD_ELEC, otmp)) {
        if (realizes_damage)
            game._pending_message = `The massive hammer hits${
                !game.spec_dbon_applies ? "" : "!  Lightning strikes"} ${hittee}${
                !game.spec_dbon_applies ? '.' : '!'}`;
        if (game.spec_dbon_applies) await wake_nearto(mdef.mx, mdef.my, 4 * 4);
        if (!rn2(5)) {
            const itemdmg = await destroy_items(mdef, AD_ELEC, mdmg.d);
            if (!youdefend) mdmg.d += itemdmg;
        }
        return realizes_damage;
    }
    if (attacks(AD_MAGM, otmp)) {
        if (realizes_damage)
            game._pending_message = `The imaginary widget hits${
                !game.spec_dbon_applies ? "" : "!  A hail of magic missiles strikes"} ${hittee}${
                !game.spec_dbon_applies ? '.' : '!'}`;
        return realizes_damage;
    }

    if (attacks(AD_STUN, otmp) && dieroll <= MB_MAX_DIEROLL)
        /* Magicbane's special attacks (possibly modifies hittee) */
        return Mb_hit(magr, mdef, otmp, mdmg, dieroll, vis, hittee);

    if (!game.spec_dbon_applies) {
        /* the damage bonus didn't apply, so nothing more to do; no further
           attack has side-effects on inventory */
        return false;
    }

    /* we really want "on a natural 20", but NetHack counts the d20 in reverse */
    if (spec_ability(otmp, SPFX_BEHEAD)) {
        if (is_art(otmp, ART_TSURUGI_OF_MURAMASA) && dieroll === 1) {
            wepdesc = "The razor-sharp blade";
            /* not really beheading, but so close, why add another SPFX */
            if (youattack && engulfing_u(mdef)) {
                game._pending_message = `You slice ${mon_nam(mdef)} wide open!`;
                mdmg.d = 2 * mdef.mhp + FATAL_DAMAGE_MODIFIER;
                return true;
            }
            if (!youdefend) {
                /* allow the normal cutworm() call to add the extra damage */
                if (game.notonhead) return false;
                if (bigmonst(mdef.data)) {
                    if (youattack)
                        game._pending_message = `You slice deeply into ${mon_nam(mdef)}!`;
                    else if (vis)
                        game._pending_message = `${upstart(mon_nam(magr))} cuts deeply into ${hittee}!`;
                    mdmg.d *= 2;
                    return true;
                }
                mdmg.d = 2 * mdef.mhp + FATAL_DAMAGE_MODIFIER;
                game._pending_message = `${wepdesc} cuts ${mon_nam(mdef)} in half!`;
                return true;
            } else {
                if (bigmonst(youmonst_data())) {
                    game._pending_message = `${magr ? upstart(mon_nam(magr)) : wepdesc} cuts deeply into you!`;
                    mdmg.d *= 2;
                    return true;
                }
                /* a negative-AC hero takes less damage rather than not being
                   hit, so add enough that the reduction can't prevent death */
                mdmg.d = 2 * (Upolyd() ? game.u.mh : game.u.uhp) + FATAL_DAMAGE_MODIFIER;
                game._pending_message = `${wepdesc} cuts you in half!`;
                return true;
            }
        } else if (is_art(otmp, ART_VORPAL_BLADE)
                   && (dieroll === 1 || mdef.data === monster_by_pmidx(PM_JABBERWOCK))) {
            const behead_msg = ["beheads", "decapitates"];
            if (youattack && engulfing_u(mdef)) return false;
            wepdesc = artilist[ART_VORPAL_BLADE].name;
            if (!youdefend) {
                if (!has_head(mdef.data) || game.notonhead || game.u?.uswallow) {
                    if (youattack)
                        game._pending_message = `Somehow, you miss ${mon_nam(mdef)} wildly.`;
                    else if (vis)
                        game._pending_message = `Somehow, ${mon_nam(magr)} misses wildly.`;
                    mdmg.d = 0;
                    return !!(youattack || vis);
                }
                if (noncorporeal(mdef.data) || amorphous(mdef.data)) {
                    game._pending_message =
                        `${wepdesc} slices through ${mon_nam(mdef)}'s neck.`;
                    return true;
                }
                mdmg.d = 2 * mdef.mhp + FATAL_DAMAGE_MODIFIER;
                game._pending_message =
                    `${wepdesc} ${behead_msg[rn2(2)]} ${mon_nam(mdef)}!`;
                return true;
            } else {
                if (!has_head(youmonst_data())) {
                    game._pending_message =
                        `Somehow, ${magr ? mon_nam(magr) : wepdesc} misses you wildly.`;
                    mdmg.d = 0;
                    return true;
                }
                if (noncorporeal(youmonst_data()) || amorphous(youmonst_data())) {
                    game._pending_message = `${wepdesc} slices through your neck.`;
                    return true;
                }
                mdmg.d = 2 * (Upolyd() ? game.u.mh : game.u.uhp) + FATAL_DAMAGE_MODIFIER;
                game._pending_message = `${wepdesc} ${behead_msg[rn2(2)]} you!`;
                return true;
            }
        }
    }
    if (spec_ability(otmp, SPFX_DRLI)) {
        /* golems and vortices are non-living but still drainable */
        const life = nonliving(mdef.data) ? "animating force" : "life";

        if (!youdefend) {
            const m_lev = mdef.m_lev | 0, mhpmax = mdef.mhpmax | 0;
            let drain = monhp_per_lvl(mdef);   /* usually 1d8 */

            /* stop draining HP if it drops too low (the level still drains,
               and the caller still inflicts regular weapon damage) */
            if (mhpmax - drain <= m_lev)
                drain = (mhpmax > m_lev) ? (mhpmax - (m_lev + 1)) : 0;

            if (vis) {
                game._pending_message = is_art(otmp, ART_STORMBRINGER)
                    ? `The black blade draws the ${life} from ${mon_nam(mdef)}!`
                    : `The ${xname(otmp)} draws the ${life} from ${mon_nam(mdef)}!`;
            }
            if (mdef.m_lev === 0) {
                /* losing a level when at 0 is fatal */
                mdmg.d = 2 * mdef.mhp + FATAL_DAMAGE_MODIFIER;
            } else {
                mdmg.d += drain;
                mdef.mhpmax -= drain;
                mdef.m_lev--;
            }

            if (drain > 0) {
                drain = Math.trunc((drain + 1) / 2);   /* heal attacker by half */
                if (youattack) healup(drain);
                else healmon(magr, drain, 0);
            }
            return vis;
        } else {
            const oldhpmax = game.u.uhpmax;
            game._pending_message = Blind()
                ? `You feel an ${is_art(otmp, ART_STORMBRINGER) ? "unholy blade" : "object"} drain your ${life}!`
                : (is_art(otmp, ART_STORMBRINGER)
                    ? `The black blade drains your ${life}!`
                    : `The ${xname(otmp)} drains your ${life}!`);
            await losexp("life drainage");
            if (magr && magr.mhp < magr.mhpmax)
                healmon(magr, Math.trunc((Math.abs(oldhpmax - game.u.uhpmax) + 1) / 2), 0);
            return true;
        }
    }
    return false;
}

// C ref: artifact.c invoke_ok() — the getobj() filter for #invoke.
export function invoke_ok(obj) {
    if (!obj) return GETOBJ_EXCLUDE;

    /* artifacts and other special items */
    if (obj.oartifact || (objects[obj.otyp]?.flags & F_UNIQUE)
        || (obj.otyp === FAKE_AMULET_OF_YENDOR && !obj.known))
        return GETOBJ_SUGGEST;

    /* synonym for apply */
    if (obj.otyp === CRYSTAL_BALL) return GETOBJ_SUGGEST;

    return GETOBJ_EXCLUDE;
}

// C ref: artifact.c nothing_special().
export function nothing_special(obj) {
    if (carried(obj))
        game._pending_message = "You feel a surge of power, but nothing seems to happen.";
}

// C ref: artifact.c doinvoke() — the #invoke command.  getobj()'s prompt and
// selection belong to invent.c; everything after it is here.
export async function doinvoke() {
    const obj = hook('getobj', null, "invoke", invoke_ok, /*GETOBJ_PROMPT*/ 1);
    if (!obj) return ECMD_CANCEL;
    const ref = { obj };
    if (!(await retouch_object(ref, false))) return ECMD_TIME;
    return arti_invoke(ref.obj);
}

// C ref: artifact.c invoke_taming() — reads as a blessed-neutral scroll of
// taming through seffects(), which is where its RNG lives.
export function invoke_taming(_obj) {
    const pseudo = { otyp: SCR_TAMING, blessed: 0, cursed: 0, spe: 0, quan: 1 };
    hook('seffects', undefined, pseudo);
    return ECMD_TIME;
}
const SCR_TAMING = otyp_by_name('taming');

// C ref: artifact.c invoke_healing().  RNG-free.
export function invoke_healing(obj) {
    const u = game.u;
    let healamt = Math.trunc((u.uhpmax + 1 - u.uhp) / 2);
    const creamed = u.ucreamed | 0;

    if (Upolyd()) healamt = Math.trunc((u.mhmax + 1 - u.mh) / 2);
    if (healamt || uprop('Sick') || uprop('Slimed') || (uprop('Blinded') > creamed)) {
        /* when healing temporary blindness the hero might still be blind from
           PermaBlind or an eyeless form, so vary the message */
        game._pending_message = `You feel ${
            (!healamt && !uprop('Sick') && !uprop('Slimed')
             && (uprop('Blinded') & ~TIMEOUT) !== 0) ? "slightly " : ""}better.`;
    } else {
        nothing_special(obj);
        return ECMD_TIME;
    }
    if (healamt > 0) {
        if (Upolyd()) u.mh += healamt; else u.uhp += healamt;
    }
    if (uprop('Sick')) u.uprops.Sick = 0;
    if (uprop('Slimed')) u.uprops.Slimed = 0;
    if (uprop('Blinded') > creamed) u.uprops.Blinded = creamed;
    game.botl = true;
    return ECMD_TIME;
}

// C ref: artifact.c invoke_energy_boost().  RNG-free.
export function invoke_energy_boost(obj) {
    const u = game.u;
    let epboost = Math.trunc((u.uenmax + 1 - u.uen) / 2);

    if (epboost > 120) epboost = 120;              /* arbitrary */
    else if (epboost < 12) epboost = u.uenmax - u.uen;
    if (epboost) {
        u.uen += epboost;
        game.botl = true;
        game._pending_message = "You feel re-energized.";
    } else {
        nothing_special(obj);
        return ECMD_TIME;
    }
    return ECMD_TIME;
}

// C ref: artifact.c invoke_create_ammo().  RNG: rnd(10) blessed / rnd(5) plain.
// The created stack is left on game._pending_hold_object for the caller's
// hold_another_object("Suddenly %s out.", aobjnam(otmp, "fall")).
export function invoke_create_ammo(obj) {
    const otmp = mksobj(ARROW, true, false);

    if (!otmp) { nothing_special(obj); return ECMD_TIME; }
    otmp.blessed = obj.blessed;
    otmp.cursed = obj.cursed;
    otmp.bknown = obj.bknown;
    otmp.oeroded = 0;
    otmp.oeroded2 = 0;
    if (obj.blessed) {
        if (otmp.spe < 0) otmp.spe = 0;
        otmp.quan += rnd(10);
    } else if (obj.cursed) {
        if (otmp.spe > 0) otmp.spe = 0;
    } else {
        otmp.quan += rnd(5);
    }
    otmp.owt = weight(otmp);
    game._pending_hold_object = otmp;
    return ECMD_TIME;
}

// C ref: artifact.c invoke_untrap().  The RNG is untrap()'s; the age reset on
// a cancel ("don't charge for changing their mind") is this function's.
export function invoke_untrap(obj) {
    if (!hook('untrap', 0, true, 0, 0, null)) {
        obj.age = 0;
        return ECMD_CANCEL;
    }
    return ECMD_TIME;
}

// C ref: artifact.c invoke_charge_obj().  The RNG is recharge()'s; the
// blessed-vs-role decision is this function's.
export function invoke_charge_obj(obj) {
    const oart = get_artifact(obj);
    const otmp = hook('getobj', null, "charge", artifact_hooks.charge_ok,
                      /*GETOBJ_PROMPT|GETOBJ_ALLOWCNT*/ 3);

    if (!otmp) {
        obj.age = 0;
        return ECMD_CANCEL;
    }
    const b_effect = (obj.blessed && (Role_if(oart.role) || oart.role === NON_PM));
    hook('recharge', undefined, otmp, b_effect ? 1 : obj.cursed ? -1 : 0);
    return ECMD_TIME;
}
/* charge_ok() is read.c's getobj() filter (it needs objects[].oc_charged,
   a column this port's objects[] does not carry) — supplied via the hook
   registry rather than reimplemented as a subset here. */

// C ref: artifact.c invoke_create_portal().  The dungeon menu and goto_level()
// are do.c/dungeon.c; the level arithmetic is this function's.
export function invoke_create_portal(obj, chosen_dnum) {
    const dgns = game.dungeons || [];
    let num_ok_dungeons = 0, last_ok_dungeon = 0;
    for (let i = 0; i < dgns.length; i++) {
        if (!dgns[i]?.dunlev_ureached) continue;
        if (i === game.tutorial_dnum) continue;   /* can't portal into tutorial */
        num_ok_dungeons++;
        last_ok_dungeon = i;
    }
    let i;
    if (num_ok_dungeons > 1) {
        if (chosen_dnum == null) { nothing_special(obj); return ECMD_TIME; }
        i = chosen_dnum;
    } else {
        i = last_ok_dungeon;   /* also the first & only OK dungeon */
    }

    /* the closest level in that dungeon is either its entry or the deepest
       level the hero has reached there */
    const newlev = { dnum: i, dlevel: 0 };
    const uzdepth = game.u?.uz?.dlevel ?? 1;
    newlev.dlevel = (dgns[i]?.depth_start >= uzdepth) ? dgns[i].entry_lev
                                                      : dgns[i]?.dunlev_ureached;

    if (game.u?.uhave?.amulet || newlev.dnum === game.u?.uz?.dnum) {
        game._pending_message = "You feel very disoriented for a moment.";
    } else {
        game._pending_message = !Blind()
            ? "You are surrounded by a shimmering sphere!"
            : "You feel weightless for a moment.";
        hook('goto_level', undefined, newlev, false, false, false);
    }
    return ECMD_TIME;
}

// C ref: artifact.c invoke_fling_poison().  RNG: rn2(2) picks the venom, then
// mksobj() and throwit()'s own draws.
export function invoke_fling_poison(obj) {
    if (hook('getdir', 0, null)) {
        const venom = rn2(2) ? BLINDING_VENOM : ACID_VENOM;
        const otmp = mksobj(venom, true, false);

        otmp.spe = 1;   /* the poison is yours */
        hook('throwit', undefined, otmp, 0, false, null);
    } else {
        /* no direction picked */
        game._pending_message = "Never mind.";
        obj.age = game.moves | 0;
        return ECMD_CANCEL;
    }
    return ECMD_TIME;
}
const BLINDING_VENOM = otyp_by_name('splash of blinding venom');
const ACID_VENOM = otyp_by_name('splash of acid venom');

// C ref: artifact.c invoke_storm_spell() — casts the storm at P_EXPERT and
// restores the hero's real skill level afterwards.  All the RNG is
// spelleffects()'.
export function invoke_storm_spell(obj) {
    const oart = get_artifact(obj);
    const storm = oart.inv_prop === SNOWSTORM ? SPE_CONE_OF_COLD : SPE_FIREBALL;
    const skill = spell_skilltype(storm);
    const skills = game.u?.weapon_skills;
    const expertise = skills ? skills[skill] : undefined;

    if (skills) skills[skill] = P_EXPERT;
    hook('spelleffects', undefined, storm, false, true);
    if (skills) skills[skill] = expertise;
    return ECMD_TIME;
}
const SPE_CONE_OF_COLD = otyp_by_name('cone of cold');
const SPE_FIREBALL = otyp_by_name('fireball');
const P_EXPERT = 4;
// C ref: spell.c spell_skilltype(booktype) == objects[booktype].oc_skill.
function spell_skilltype(booktype) { return objects[booktype]?.oc_skill ?? 0; }

// C ref: artifact.c invoke_blinding_ray().  RNG: rnd(damg) for the
// self-zap flash; do_blinding_ray()/litroom()/flashburn() carry the rest.
export function invoke_blinding_ray(obj) {
    if (hook('getdir', 0, null)) {
        const u = game.u;
        if (u.dx || u.dy) {
            hook('do_blinding_ray', undefined, obj);
        } else if (u.dz) {
            /* up or down => light this spot; litroom() uses radius 0 for
               Sunsword, except on the Rogue level */
            hook('litroom', undefined, true, obj);
            const loc = game.level?.at?.(u.ux, u.uy);
            game._pending_message = (!Blind() && loc?.lit && !loc?.waslit)
                ? "It is lit here now." : NOTHING_SEEMS_TO_HAPPEN;
        } else {   /* zapyourself() */
            const vulnerable = (u.umonnum === PM_GREMLIN);
            const damg = obj.blessed ? 15 : !obj.cursed ? 10 : 5;

            if (vulnerable)   /* could be fatal if Unchanging */
                hook('lightdamage', undefined, obj, true, 2 * damg);

            if (!hook('flashburn', false, damg + rnd(damg), false) && !vulnerable)
                game._pending_message = NOTHING_SEEMS_TO_HAPPEN;
        }
    } else {
        game._pending_message = "Never mind.";
        obj.age = game.moves | 0;
        return ECMD_CANCEL;
    }
    return ECMD_TIME;
}
const PM_GREMLIN = pmidx_by_name('gremlin');
const NOTHING_SEEMS_TO_HAPPEN = "Nothing seems to happen.";

// C ref: artifact.c invoke_banish().  RNG: rn2(chance) per demon, then
// rn2(dunlevs_in_dungeon(&dest)) for each one that vanishes.
export function invoke_banish(_obj) {
    let nvanished = 0, nstayed = 0;
    const dest = find_hell();

    for (const mtmp of (game.level?.monsters || []).slice()) {
        let chance = 1;

        if (!mtmp || (mtmp.mhp != null && mtmp.mhp <= 0)) continue;
        if (!isok(mtmp.mx, mtmp.my)) continue;
        if (!is_demon(mtmp.data) && mtmp.data?.mcls !== S_IMP) continue;
        if (!couldsee(mtmp.mx, mtmp.my)) continue;
        if (msound_is_nemesis(mtmp.data)) continue;

        if (In_quest() && !game.quest_status?.killed_nemesis) chance += 10;
        if (is_dprince(mtmp.data)) chance += 2;
        if (is_dlord(mtmp.data)) chance++;

        mtmp.msleeping = 0;
        mtmp.mtame = 0;
        mtmp.mpeaceful = 0;
        if (chance <= 1 || !rn2(chance)) {
            if (!Inhell()) {
                nvanished++;
                /* banish to a random level in Gehennom */
                dest.dlevel = rn2(dunlevs_in_dungeon(dest));
                migrate_mon(mtmp, dest);
            } else {
                u_teleport_mon(mtmp);
            }
        } else {
            nstayed++;
        }
    }

    if (nvanished) {
        const subject = nvanished === 1 ? "demon" : "demons";
        game._pending_message = `${nstayed ? ((nvanished > nstayed) ? "Most of the" : "Some of the") : "The"} ${subject} ${nvanished === 1 ? "disappears" : "disappear"} in a cloud of brimstone!`;
    }
    return ECMD_TIME;
}

// C ref: artifact.c arti_invoke_cost_pw().  SPELL_LEV_PW(5) == 5 * 5.
const SPELL_LEV_PW = (lev) => 5 * lev;
export function arti_invoke_cost_pw(obj) {
    const oart = get_artifact(obj);
    if (oart.inv_prop === FLING_POISON || oart.inv_prop === BLINDING_RAY)
        return SPELL_LEV_PW(5);   /* pretend it's a level 5 spell */
    return -1;
}

// C ref: artifact.c arti_invoke_cost().  RNG: d(3, 10) when the artifact is
// still tired, rnz(100) when the timer is (re)armed.
export function arti_invoke_cost(obj) {
    const moves = game.moves | 0;
    if (obj.age > moves) {
        const pw_cost = arti_invoke_cost_pw(obj);

        if (pw_cost < 0 || game.u.uen < pw_cost) {
            /* the artifact is tired :-) */
            game._pending_message = `You feel that the ${xname(obj)} is ignoring you.`;
            obj.age += d(3, 10);   /* and just got more so */
            return false;
        } else {
            /* you pay the invoke cost with your own magic */
            game._pending_message = "You feel drained...";
            game.u.uen -= pw_cost;
            game.botl = true;
        }
    } else {
        obj.age = moves + rnz(100);
    }
    return true;
}

// C ref: artifact.c arti_invoke().  The special-power half dispatches to the
// invoke_* helpers; the powers whose subsystems this port lacks are listed in
// the handoff's deferred set rather than being silently no-op'd here, and
// reaching one records itself on game._artifact_unbound.
export function arti_invoke(obj) {
    if (!obj) return ECMD_OK;                    /* C: impossible() */
    const oart = get_artifact(obj);
    if (oart === NONART() || !oart.inv_prop) {
        /* a plain crystal ball goes to apply.c use_crystal_ball() */
        if (obj.otyp !== CRYSTAL_BALL)
            game._pending_message = NOTHING_HAPPENS;
        else unbound('use_crystal_ball', undefined);
        return ECMD_TIME;
    }

    /* it's a special power, not "just" a property */
    if (oart.inv_prop > LAST_PROP) {
        if (!arti_invoke_cost(obj)) return ECMD_TIME;

        switch (oart.inv_prop) {
        case TAMING: return invoke_taming(obj);
        case HEALING: return invoke_healing(obj);
        case ENERGY_BOOST: return invoke_energy_boost(obj);
        case UNTRAP: return invoke_untrap(obj);
        case CHARGE_OBJ: return invoke_charge_obj(obj);
        case LEV_TELE: hook('level_tele', undefined); return ECMD_TIME;
        case CREATE_PORTAL: return invoke_create_portal(obj);
        case ENLIGHTENING:
            hook('enlightenment', undefined, /*MAGICENLIGHTENMENT*/ 1,
                 /*ENL_GAMEINPROGRESS*/ 0);
            return ECMD_TIME;
        case CREATE_AMMO: return invoke_create_ammo(obj);
        case BANISH: return invoke_banish(obj);
        case FLING_POISON: return invoke_fling_poison(obj);
        case SNOWSTORM:
            /*FALLTHRU*/
        case FIRESTORM: return invoke_storm_spell(obj);
        case BLINDING_RAY: return invoke_blinding_ray(obj);
        default:
            /* C: impossible("Unknown invoke power %d.", oart->inv_prop) */
            return unbound(`invoke_prop_${oart.inv_prop}`, ECMD_TIME);
        }
    }

    const before = extrinsic_of(oart.inv_prop);
    const eprop = before ^ W_ARTI;
    set_extrinsic(oart.inv_prop, eprop);
    const iprop = intrinsic_of(oart.inv_prop);
    const on = (eprop & W_ARTI) !== 0;   /* true if the prop was just set */

    if (on && obj.age > (game.moves | 0)) {
        /* the artifact is tired :-) */
        set_extrinsic(oart.inv_prop, eprop ^ W_ARTI);
        game._pending_message = `You feel that the ${xname(obj)} is ignoring you.`;
        obj.age += d(3, 10);   /* can't just keep repeatedly trying */
        return ECMD_TIME;
    } else if (!on) {
        /* when turning the property off, determine the downtime */
        obj.age = (game.moves | 0) + rnz(100);
    }

    if ((eprop & ~W_ARTI) || iprop) {
        /* you had the property from some other source too */
        nothing_special(obj);
        return ECMD_TIME;
    }
    switch (oart.inv_prop) {
    case CONFLICT:
        game._pending_message = on ? "You feel like a rabble-rouser."
                                   : "You feel the tension decrease around you.";
        break;
    case LEVITATION:
        /* float_up()/float_down() are do.c's */
        unbound('float_up_down', undefined);
        break;
    case INVIS:
        /* C: `if (BInvis || Blind)`.  BInvis (invisibility BLOCKED by an
           object) has no counterpart in this port's flat uprops map, so only
           the Blind half is testable. */
        if (Blind()) { nothing_special(obj); return ECMD_TIME; }
        game._pending_message = on
            ? `Your body takes on a ${Hallucination() ? "normal" : "strange"} transparency...`
            : "Your body seems to unfade...";
        break;
    default:
        break;
    }
    return ECMD_TIME;
}

// C ref: artifact.c finesse_ahriman() — will freeing this object from
// inventory end levitation?  C saves u.uprops[LEVITATION], clears the
// I_SPECIAL|TIMEOUT intrinsic bits and the W_ARTI extrinsic bit, re-evaluates
// Levitation, then restores; the same probe over this port's split
// intrinsic/extrinsic stores.
const I_SPECIAL = 0x10000000;   /* prop.h */
export function finesse_ahriman(obj) {
    const oart = get_artifact(obj);
    if (!Levitation() || oart === NONART() || oart.inv_prop !== LEVITATION
        || !(extrinsic_of(LEVITATION) & W_ARTI))
        return false;

    const saveH = intrinsic_of(LEVITATION), saveE = extrinsic_of(LEVITATION);
    set_intrinsic(LEVITATION, saveH & ~(I_SPECIAL | TIMEOUT));
    set_extrinsic(LEVITATION, saveE & ~W_ARTI);
    const result = !Levitation();
    set_intrinsic(LEVITATION, saveH);
    set_extrinsic(LEVITATION, saveE);
    return result;
}
function Levitation() {
    return !!(intrinsic_of(LEVITATION) || extrinsic_of(LEVITATION)
              || uprop('Levitation'));
}

// C ref: artifact.c arti_speak() — talking artifacts whisper a rumor.  The RNG
// is getrumor()'s (it picks a line from the rumor file).
export function arti_speak(obj) {
    const oart = get_artifact(obj);

    if (oart === NONART() || !(oart.spfx & SPFX_SPEAK))
        return ECMD_OK;   /* nothing happened */

    let line = hook('getrumor', "", bcsign(obj), true);
    if (!line) line = "NetHack rumors file closed for renovation.";
    game._pending_message = `${upstart(xname(obj))} whispers:`;
    game._pending_message2 = `"${line}"`;   /* verbalize1() */
    return ECMD_TIME;
}
// C ref: obj.h bcsign(obj).
function bcsign(otmp) { return (otmp?.blessed ? 1 : 0) - (otmp?.cursed ? 1 : 0); }

// C ref: artifact.c what_gives() — the first inventory item conveying a given
// intrinsic.  C passes `long *abil` (the address of the E<prop> mask) and
// dereferences it once; the JS translation takes the mask's NAME plus its
// current value, since there is no address to pass.
export function what_gives(abilName, abilValue) {
    let wornmask = (W_ARM | W_ARMC | W_ARMH | W_ARMS
                    | W_ARMG | W_ARMF | W_ARMU
                    | W_AMUL | W_RINGL | W_RINGR | W_TOOL
                    | W_ART | W_ARTI);

    if (game.u?.twoweap) wornmask |= W_SWAPWEP;
    const dtyp = abil_to_adtyp(abilName);
    const spfx = abil_to_spfx(abilName);
    const wornbits = (wornmask & (abilValue | 0));

    for (const obj of invent_list()) {
        if (obj.oartifact
            && (abilName !== 'EWarn_of_mon' || game.warntype_obj)) {
            const art = get_artifact(obj);

            if (art !== NONART()) {
                if (dtyp) {
                    if (art.cary.adtyp === dtyp                 /* carried */
                        || (art.defn.adtyp === dtyp             /* worn */
                            && (obj.owornmask & ~(W_ART | W_ARTI))))
                        return obj;
                }
                if (spfx) {
                    if ((art.cspfx & spfx) === spfx) return obj;
                    if ((art.spfx & spfx) === spfx && obj.owornmask) return obj;
                }
                if (obj === game.uwep && abilName === 'EBlnd_resist'
                    && ((abilValue | 0) & W_WEP) !== 0)
                    return obj;   /* Sunsword */
            }
        } else {
            if (wornbits && wornbits === (wornmask & obj.owornmask)) return obj;
        }
    }
    return null;
}

// C ref: artifact.c artifact_has_invprop().
export function artifact_has_invprop(otmp, inv_prop) {
    const arti = get_artifact(otmp);
    return arti !== NONART() && arti.inv_prop === inv_prop;
}

// C ref: artifact.c arti_cost() — the price sold to the hero.  The artilist
// cost column above is exactly what js/shk.js:217 arti_cost() could not read;
// that copy always falls through to the 100x default.
export function arti_cost(otmp) {
    if (!otmp.oartifact) return base_oc_cost(otmp.otyp);
    else if (artilist[otmp.oartifact].cost) return artilist[otmp.oartifact].cost;
    else return 100 * base_oc_cost(otmp.otyp);
}

// C ref: artifact.c abil_to_adtyp()/abil_to_spfx().  C keys these on the
// ADDRESS of the E<prop> mask; the JS equivalent keys on its name.
const ABIL2ADTYP = {
    EFire_resistance: AD_FIRE,
    ECold_resistance: AD_COLD,
    EShock_resistance: AD_ELEC,
    EAntimagic: AD_MAGM,
    EDisint_resistance: AD_DISN,
    EPoison_resistance: AD_DRST,
    EDrain_resistance: AD_DRLI,
};
const ABIL2SPFX = {
    ESearching: SPFX_SEARCH,
    EHalluc_resistance: SPFX_HALRES,
    ETelepat: SPFX_ESP,
    EStealth: SPFX_STLTH,
    ERegeneration: SPFX_REGEN,
    ETeleport_control: SPFX_TCTRL,
    EWarn_of_mon: SPFX_WARN,
    EWarning: SPFX_WARN,
    EEnergy_regeneration: SPFX_EREGEN,
    EHalf_spell_damage: SPFX_HSPDAM,
    EHalf_physical_damage: SPFX_HPHDAM,
    EReflecting: SPFX_REFLECT,
};
export function abil_to_adtyp(abil) { return ABIL2ADTYP[abil] || 0; }
export function abil_to_spfx(abil) { return ABIL2SPFX[abil] || 0; }

// C ref: artifact.c glow_color() — hcolor(clr2colorname(artilist[].acolor)).
const CLR2NAME = ["black", "red", "green", "brown", "blue", "magenta", "cyan",
    "gray", "", "orange", "bright green", "yellow", "bright blue",
    "bright magenta", "bright cyan", "white"];
export function glow_color(arti_indx) {
    return CLR2NAME[artilist[arti_indx].acolor] ?? "";
}

// C ref: artifact.c glow_strength()/glow_verb(); [0] is the blind value.
const glow_verbs = ["quiver", "flicker", "glimmer", "gleam"];
export function glow_strength(count) {
    /* strength should also scale with proximity and difficulty, but we don't
       have that information */
    return (count > 12) ? 3 : (count > 4) ? 2 : (count > 0 ? 1 : 0);
}
export function glow_verb(count, ingsfx) {
    /* ing_suffix() would double the final consonant for all of these and none
       of them should have that, so it is bypassed */
    return glow_verbs[glow_strength(count)] + (ingsfx ? "ing" : "");
}

// C ref: artifact.c Sting_effects() — the warning glow for Sting, Orcrist and
// Grimtooth.  RNG-free; it only decides which message (if any) is given.
export function Sting_effects(orc_count) {
    const uwep = game.uwep;
    if (!(is_art(uwep, ART_STING) || is_art(uwep, ART_ORCRIST)
          || is_art(uwep, ART_GRIMTOOTH)))
        return;
    const warn_obj_cnt = game.warn_obj_cnt | 0;
    const oldstr = glow_strength(warn_obj_cnt), newstr = glow_strength(orc_count);

    if (orc_count === -1 && warn_obj_cnt > 0) {
        /* -1 means blindness has just been toggled: give a 'continue' message
           that the eventual 'stop' message will match */
        game._pending_message = `${bare_artifactname(uwep)} is ${glow_verb(Blind() ? 0 : warn_obj_cnt, true)}.`;
    } else if (newstr > 0 && newstr !== oldstr) {
        if (!Blind())
            game._pending_message = `${bare_artifactname(uwep)} ${glow_verb(orc_count, false)}s ${glow_color(uwep.oartifact)}${(newstr > oldstr) ? '!' : '.'}`;
        else if (oldstr === 0) /* quivers */
            game._pending_message = `${bare_artifactname(uwep)} ${glow_verb(0, false)}s slightly.`;
    } else if (orc_count === 0 && warn_obj_cnt > 0) {
        game._pending_message = `${bare_artifactname(uwep)} stops ${glow_verb(Blind() ? 0 : warn_obj_cnt, true)}.`;
    }
}

// C ref: artifact.c artifact_light() — always-lit items.  Gold dragon scales
// aren't artifacts but emit light without burning.
export function artifact_light(obj) {
    if (obj && (obj.otyp === GOLD_DRAGON_SCALE_MAIL || obj.otyp === GOLD_DRAGON_SCALES)
        && (obj.owornmask & W_ARM) !== 0)
        return true;
    return get_artifact(obj) !== NONART() && is_art(obj, ART_SUNSWORD);
}

// C ref: artifact.c is_magic_key() — the Master Key behaves as magic when not
// cursed (rogues) or when blessed (everyone else).
export function is_magic_key(mon, obj) {
    if (is_art(obj, ART_MASTER_KEY_OF_THIEVERY)) {
        const isRogue = is_you(mon)
            ? Role_if(PM_ROGUE)
            : (!!mon && mon.data === monster_by_pmidx(PM_ROGUE));
        if (isRogue) return !obj.cursed;   /* non-cursed suffices for a rogue */
        return !!obj.blessed;              /* otherwise it must be blessed */
    }
    return false;
}

// C ref: artifact.c has_magic_key() — is 'mon' (default: the hero) carrying it?
export function has_magic_key(mon) {
    const key = artilist[ART_MASTER_KEY_OF_THIEVERY].otyp;
    const you = !mon || is_you(mon);
    const list = you ? invent_list() : (mon.minvent || []);
    for (const o of list) {
        if (o.otyp !== key) continue;
        if (is_magic_key(you ? youmonst() : mon, o)) return o;
    }
    return null;
}

// C ref: artifact.c count_surround_traps().  This port has no numeric glyph
// layer, so C's `glyph_is_trap(glyph_at(dx,dy))` ("a trap is SHOWN here, so
// the hero expects it") is evaluated as "a seen trap with nothing drawn over
// it"; a trap covered by an object or monster still counts, which is the case
// C's comment singles out.
export function count_surround_traps(x, y) {
    let ret = 0;
    for (let dx = x - 1; dx < x + 2; ++dx)
        for (let dy = y - 1; dy < y + 2; ++dy) {
            if (!isok(dx, dy)) continue;
            const t = trap_at(dx, dy);
            if (t) {
                const covered = floor_objects_at(dx, dy).length > 0
                    || mon_at(dx, dy) != null;
                if (t.tseen && !covered) continue;
                ++ret;
                continue;
            }
            const levp = game.level?.at?.(dx, dy);
            if (levp && IS_DOOR(levp.typ) && (levp.doormask & D_TRAPPED) !== 0) {
                ++ret;
                continue;
            }
            for (const o of floor_objects_at(dx, dy))
                if (is_container(o) && o.otrapped) {
                    ++ret;   /* count locations, so only the first of a pile */
                    break;
                }
        }
    return ret;
}
function trap_at(x, y) {
    for (const t of game.level?.traps || []) if (t.tx === x && t.ty === y) return t;
    return null;
}
function mon_at(x, y) {
    for (const m of game.level?.monsters || [])
        if (m.mx === x && m.my === y && (m.mhp === undefined || m.mhp > 0)) return m;
    return null;
}
// C ref: obj.h Is_container(o) — otyp between LARGE_BOX and BAG_OF_TRICKS.
function is_container(o) { return o.otyp >= LARGE_BOX && o.otyp <= BAG_OF_TRICKS; }

// C ref: artifact.c mkot_trap_warn() — sense adjacent traps while wielding the
// Master Key bare-handed.
const MKOT_HEAT = ["cool", "slightly warm", "warm", "very warm",
    "hot", "very hot", "like fire"];
export function mkot_trap_warn() {
    if (!game.uarmg && is_art(game.uwep, ART_MASTER_KEY_OF_THIEVERY)) {
        const ntraps = count_surround_traps(game.u.ux, game.u.uy);
        if (ntraps !== game.mkot_trap_warn_count) {
            const idx = Math.min(ntraps, MKOT_HEAT.length - 1);
            game._pending_message = `The Key feels ${MKOT_HEAT[idx]}${(ntraps > 3) ? '!' : '.'}`;
        }
        game.mkot_trap_warn_count = ntraps;
    } else {
        game.mkot_trap_warn_count = 0;
    }
}

// C ref: artifact.c retouch_object().  RNG: touch_artifact()'s draws, then
// rnd(10) for silver and rnd(10) for a bane weapon.  Returns C's int (1 = the
// hero can handle it) and reports the item back through `ref.obj`, because JS
// has no `struct obj **`.
export async function retouch_object(ref, loseit) {
    let obj = ref.obj;

    /* allow a silver-hating form to still perform the invocation ritual */
    if (obj.otyp === BELL_OF_OPENING && invocation_pos(game.u.ux, game.u.uy)
        && !On_stairs(game.u.ux, game.u.uy))
        return 1;

    if (touch_artifact(obj, youmonst())) {
        let dmg = 0;
        const ag = (objects[obj.otyp]?.material === SILVER && Hate_silver());
        const bane = bane_applies(get_artifact(obj), youmonst());

        /* nothing else to do if the hero can handle this object */
        if (!ag && !bane) return 1;

        /* the hero can't, but didn't get touch_artifact()'s "evades your
           grasp|control" message, so give an alternate one */
        game._pending_message = `You can't handle ${xname(obj)}${obj.owornmask ? " anymore" : ""}!`;
        if (!touch_blasted()) {
            /* half the usual 1d20 physical for silver, 1d10 magical for a
               <foo>bane, potentially both */
            if (ag) dmg += Maybe_Half_Phys(rnd(10));
            if (bane) dmg += rnd(10);
            losehp(dmg);
            exercise(A_CON, false);
        }
    }

    /* removing a worn item can end levitation, dropping the hero into water,
       lava or a polymorph trap and possibly destroying the item */
    if (obj.owornmask) {
        await remove_worn_item(obj, false);
        if (!invent_list().includes(obj)) { ref.obj = obj = null; }
    }

    /* if we still have it and the caller wants us to drop it, do so now */
    if (loseit && obj) {
        dropx(obj);
        ref.obj = obj = null;
    }
    return 0;
}

// C ref: artifact.c untouchable() — a worn/carried/invoked item gets a touch
// test after the hero changes form or alignment.
export async function untouchable(obj, drop_untouchable) {
    const wearmask = ~(W_QUIVER | (game.u?.twoweap ? 0 : W_SWAPWEP) | W_BALL);

    const beingworn = !!obj
        && (((obj.owornmask || 0) & wearmask) !== 0
            /* some items in use have no wornmask setting */
            || (obj.oclass === TOOL_CLASS
                && (obj.lamplit
                    || (obj.otyp === LEASH && obj.leashmon)
                    || (is_container(obj) && (obj.cobj || []).length > 0))));

    const art = get_artifact(obj);
    let carryeffect = false, invoked = false;
    if (art !== NONART()) {
        carryeffect = !!(art.cary.adtyp || art.cspfx);
        invoked = art.inv_prop > 0 && art.inv_prop <= LAST_PROP
            && (extrinsic_of(art.inv_prop) & W_ARTI) !== 0;
    }

    if (beingworn || carryeffect || invoked) {
        const ref = { obj };
        if (!(await retouch_object(ref, drop_untouchable))) {
            /* the item is now unworn/unwielded and possibly dropped; if it is
               still carried, turn the invocation property off here */
            if (invoked && ref.obj) arti_invoke(ref.obj);   /* reverse #invoke */
            return true;
        }
    }
    return false;
}

// C ref: artifact.c retouch_equipment() — touch-test everything in use.
// 0 == don't drop, 1 == drop all, 2 == drop weapon.
export async function retouch_equipment(dropflag) {
    let dropit = (dropflag > 0);
    const done = new Set();   /* C uses the bypass bits for this */

    /* check the secondary weapon first, before possibly unwielding the primary */
    if (game.u?.twoweap && game.uswapwep) {
        done.add(game.uswapwep);
        await untouchable(game.uswapwep, dropit);
    }
    /* check the primary next so they're handled together */
    if (game.uwep) {
        done.add(game.uwep);
        await untouchable(game.uwep, dropit);
    }

    /* in case someone is daft enough to add an artifact or silver saddle */
    if (game.u?.usteed) {
        const saddle = (game.u.usteed.minvent || [])
            .find((o) => (o.owornmask & W_SADDLE) !== 0);
        if (saddle && await untouchable(saddle, false)) dismount_steed();
    }

    dropit = (dropflag === 1);   /* all untouchable items */
    /* losing levitation can drop inventory items, so rescan gi.invent each
       time we move on to another object */
    for (;;) {
        const obj = invent_list().find((o) => !done.has(o));
        if (!obj) break;
        done.add(obj);
        await untouchable(obj, dropit);
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Remaining cross-file helpers.
// ─────────────────────────────────────────────────────────────────────────
// zap.c destroy_items(mon, dmgtyp, dmg) — DRAWS RNG.  js/zap.js:2111 has the
// real implementation but no `export`.
async function destroy_items(mon, dmgtyp, dmg) {
    const fn = artifact_hooks.destroy_items;
    if (fn) return await fn(mon, dmgtyp, dmg);
    return unbound('destroy_items', 0);
}
function ignite_items(minvent) {
    const fn = artifact_hooks.ignite_items;
    if (fn) return fn(minvent);
    return unbound('ignite_items', undefined);
}
// cmd.c wake_nearto() — async in this port, so artifact_hit() awaits it to
// keep C's statement order.  Loaded with a dynamic import so that a future
// `import ... from './artifact.js'` inside cmd.js/exper.js/invent.js cannot
// turn into a module-evaluation cycle.
async function wake_nearto(x, y, dist) {
    const { wake_nearto: fn } = await import('./cmd.js');
    return fn(x, y, dist);
}
// exper.c losexp(drainer)
async function losexp(drainer) {
    const { losexp: fn } = await import('./exper.js');
    return fn(drainer, true);
}
// cmd.c healup(nhp, nxtra, curesick, cureblind) — the nhp half.
function healup(nhp) {
    const u = game.u;
    if (!u) return;
    u.uhp = Math.min((u.uhp | 0) + nhp, u.uhpmax | 0);
    game.botl = true;
}
// invent.js remove_worn_item() is async here.
async function remove_worn_item(obj, unchain_ball) {
    const { remove_worn_item: fn } = await import('./invent.js');
    return fn(obj, unchain_ball);
}
// do.c dropx(obj) — the inventory-to-floor move.  dropx()'s altar message and
// hitfloor() path belong to do.c.
function dropx(obj) {
    const inv = invent_list();
    const i = inv.indexOf(obj);
    if (i >= 0) inv.splice(i, 1);
    obj.ox = game.u?.ux;
    obj.oy = game.u?.uy;
    obj.where = OBJ_FLOOR;
    if (Array.isArray(game.level?.objects)) game.level.objects.push(obj);
}
// steed.c dismount_steed(reason)
function dismount_steed() { if (game.u) game.u.usteed = null; }
// dungeon.c invocation_pos(x,y) / On_stairs(x,y)
function invocation_pos(x, y) {
    const inv = game.level?.invocation_pos;
    return !!inv && inv.x === x && inv.y === y;
}
function On_stairs(x, y) {
    return (game.level?.stairs || []).some((s) => s.sx === x && s.sy === y);
}
// const.js engulfing_u(mon)
function engulfing_u(mon) { return !!game.u?.uswallow && game.u?.ustuck === mon; }
// vision.c couldsee(x,y) — cansee() without the light requirement; the port's
// cansee() is the closest available predicate.
function couldsee(x, y) { return cansee(x, y); }
// dungeon.c find_hell()/dunlevs_in_dungeon(); you.h In_quest()/Inhell.
function find_hell() {
    const d = game.dungeons?.find((dd) => /Gehennom/i.test(dd.dname || ''));
    return { dnum: d ? d.dnum : 0, dlevel: d ? d.entry_lev : 1 };
}
function dunlevs_in_dungeon(dl) {
    const d = (game.dungeons || [])[dl.dnum];
    return d ? d.num_dunlevs : 1;
}
function In_quest() { return /quest/i.test(game.dungeons?.[game.u?.uz?.dnum]?.dname || ''); }
function Inhell() { return /Gehennom/i.test(game.dungeons?.[game.u?.uz?.dnum]?.dname || ''); }
function migrate_mon(mtmp, dest) {
    mtmp.migrating = true;
    mtmp.mdest = { ...dest };
    const mons = game.level?.monsters;
    if (Array.isArray(mons)) {
        const i = mons.indexOf(mtmp);
        if (i >= 0) mons.splice(i, 1);
    }
}
function u_teleport_mon(mtmp) { void mtmp; return unbound('u_teleport_mon', undefined); }
// sounds.h MS_NEMESIS == 23; msound_of() reads the generated table so the
// index can't drift (that table already had 18 off-by-one entries once).
const MS_NEMESIS = 23;
function msound_is_nemesis(ptr) { return msound_of(ptr) === MS_NEMESIS; }

// prop.h u.uprops[prop].extrinsic / .intrinsic — this port has no struct prop,
// only a flat name->timeout map, so the extrinsic word gets its own store.
// set_artifact_intrinsic()/what_gives()/finesse_ahriman() need the full struct
// and are in the handoff's deferred set.
function extrinsic_of(prop) { return (game.u?.uprops_extrinsic || {})[prop] || 0; }
function intrinsic_of(prop) { return (game.u?.uprops_intrinsic || {})[prop] || 0; }
function set_extrinsic(prop, val) {
    if (!game.u) return;
    game.u.uprops_extrinsic = game.u.uprops_extrinsic || {};
    game.u.uprops_extrinsic[prop] = val;
}
function set_intrinsic(prop, val) {
    if (!game.u) return;
    game.u.uprops_intrinsic = game.u.uprops_intrinsic || {};
    game.u.uprops_intrinsic[prop] = val;
}
