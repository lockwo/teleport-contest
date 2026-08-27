// mplayer.js — the "player monsters" (Astral Plane fake adventurers).
//
// C ref: nethack-c/upstream/src/mplayer.c (NetHack 5.0), translated in full.
//
// Two callers exist in C: sp_lev.c's `montype` handler for a level script that
// names a role monster (js/sp_lev.js:4811 already routes there, through the
// EXT.mk_mplayer stub) and the Astral Plane / Elemental Planes scripts via
// create_mplayers().  Neither is reached by any session in the corpora, so this
// module is INERT: nothing imports it and nothing here is called from
// elsewhere.  Wiring it up means binding sp_lev.c's EXT table
// (bind_sp_lev_externs({ mk_mplayer })) — that is a separate change.
//
// mk_mplayer() is an unbroken run of ~40 RNG draws whose ORDER is the whole
// point of a faithful port, so every rn2/rnd/rn1/d below sits exactly where C
// has it, including the ones whose results the code then ignores.

import { game } from './gstate.js';
import { rn2, rnd, rn1, d } from './rng.js';
import { objects, mksobj, mkobj, rnd_class, curse, bless, weight,
         RANDOM_CLASS, STRANGE_OBJECT } from './mkobj.js';
import { makemon, monster_by_pmidx, set_malign,
         name_to_pmidx } from './makemon.js';
import { mpickobj } from './steal.js';
import { m_dowear } from './worn.js';
import { christen_monst } from './do_name.js';
import { mk_artifact, is_art, ART_MAGICBANE } from './artifact.js';
import { rnd_offensive_item, rnd_defensive_item, rnd_misc_item } from './muse.js';
import { goodpos } from './teleport.js';
import { rank_of } from './exper.js';
import { monmightthrowwep, is_spear } from './weapon.js';
import { mflags2_of, M2_FEMALE } from './monflags_data.js';
import { A_NONE, COLNO, ROWNO, MM_NOMSG } from './const.js';

// ── constants ──────────────────────────────────────────────────────────────

// objects.h otyps, resolved against js/mkobj.js objects[] by the C enum name
// the table carries in its `sym` column.  Resolving by name rather than pasting
// integers is what keeps this immune to the wrong-constant family of bugs, and
// it matters twice over here: seven of the picks below are rnd_class(first,
// last) RANGE draws whose modulus is `last - first + 1`.
function otyp_by_sym(nm) {
    const i = objects.findIndex((o) => o.sym === nm);
    if (i < 0) throw new Error(`mplayer.js: no objects[] row named ${nm}`);
    return i;
}
const LONG_SWORD = otyp_by_sym('LONG_SWORD'),
      SPEAR = otyp_by_sym('SPEAR'),
      BULLWHIP = otyp_by_sym('BULLWHIP'),
      GRAY_DRAGON_SCALE_MAIL = otyp_by_sym('GRAY_DRAGON_SCALE_MAIL'),
      YELLOW_DRAGON_SCALE_MAIL = otyp_by_sym('YELLOW_DRAGON_SCALE_MAIL'),
      OILSKIN_CLOAK = otyp_by_sym('OILSKIN_CLOAK'),
      CLOAK_OF_DISPLACEMENT = otyp_by_sym('CLOAK_OF_DISPLACEMENT'),
      ELVEN_LEATHER_HELM = otyp_by_sym('ELVEN_LEATHER_HELM'),
      HELM_OF_TELEPATHY = otyp_by_sym('HELM_OF_TELEPATHY'),
      ELVEN_SHIELD = otyp_by_sym('ELVEN_SHIELD'),
      SHIELD_OF_REFLECTION = otyp_by_sym('SHIELD_OF_REFLECTION'),
      TWO_HANDED_SWORD = otyp_by_sym('TWO_HANDED_SWORD'),
      BATTLE_AXE = otyp_by_sym('BATTLE_AXE'),
      PLATE_MAIL = otyp_by_sym('PLATE_MAIL'),
      CHAIN_MAIL = otyp_by_sym('CHAIN_MAIL'),
      HELM_OF_BRILLIANCE = otyp_by_sym('HELM_OF_BRILLIANCE'),
      MACE = otyp_by_sym('MACE'),
      CLUB = otyp_by_sym('CLUB'),
      QUARTERSTAFF = otyp_by_sym('QUARTERSTAFF'),
      UNICORN_HORN = otyp_by_sym('UNICORN_HORN'),
      SCALPEL = otyp_by_sym('SCALPEL'),
      SHURIKEN = otyp_by_sym('SHURIKEN'),
      ROBE = otyp_by_sym('ROBE'),
      ELVEN_DAGGER = otyp_by_sym('ELVEN_DAGGER'),
      SHORT_SWORD = otyp_by_sym('SHORT_SWORD'),
      ORCISH_DAGGER = otyp_by_sym('ORCISH_DAGGER'),
      KATANA = otyp_by_sym('KATANA'),
      WAR_HAMMER = otyp_by_sym('WAR_HAMMER'),
      ATHAME = otyp_by_sym('ATHAME'),
      BLACK_DRAGON_SCALE_MAIL = otyp_by_sym('BLACK_DRAGON_SCALE_MAIL'),
      SILVER_DRAGON_SCALE_MAIL = otyp_by_sym('SILVER_DRAGON_SCALE_MAIL'),
      CLOAK_OF_MAGIC_RESISTANCE = otyp_by_sym('CLOAK_OF_MAGIC_RESISTANCE'),
      LUCKSTONE = otyp_by_sym('LUCKSTONE'),
      LOADSTONE = otyp_by_sym('LOADSTONE'),
      GAUNTLETS_OF_POWER = otyp_by_sym('GAUNTLETS_OF_POWER'),
      LEATHER_GLOVES = otyp_by_sym('LEATHER_GLOVES'),
      GAUNTLETS_OF_DEXTERITY = otyp_by_sym('GAUNTLETS_OF_DEXTERITY'),
      LOW_BOOTS = otyp_by_sym('LOW_BOOTS'),
      LEVITATION_BOOTS = otyp_by_sym('LEVITATION_BOOTS'),
      DILITHIUM_CRYSTAL = otyp_by_sym('DILITHIUM_CRYSTAL'),
      JADE = otyp_by_sym('JADE'),
      FAKE_AMULET_OF_YENDOR = otyp_by_sym('FAKE_AMULET_OF_YENDOR');

// C ref: monsters.h — the thirteen player-monster rows, PM_ARCHEOLOGIST ..
// PM_WIZARD.  is_mplayer(ptr) is that mons[] RANGE, not a flag, and
// create_mplayers() rolls rn1(PM_WIZARD - PM_ARCHEOLOGIST + 1, ...) over it.
const PM_ARCHEOLOGIST = name_to_pmidx('archeologist'),
      PM_BARBARIAN = name_to_pmidx('barbarian'),
      PM_CAVE_DWELLER = name_to_pmidx('cave dweller'),
      PM_HEALER = name_to_pmidx('healer'),
      PM_KNIGHT = name_to_pmidx('knight'),
      PM_MONK = name_to_pmidx('monk'),
      PM_CLERIC = name_to_pmidx('cleric'),
      PM_RANGER = name_to_pmidx('ranger'),
      PM_ROGUE = name_to_pmidx('rogue'),
      PM_SAMURAI = name_to_pmidx('samurai'),
      PM_TOURIST = name_to_pmidx('tourist'),
      PM_VALKYRIE = name_to_pmidx('valkyrie'),
      PM_WIZARD = name_to_pmidx('wizard');

// C ref: objclass.h Bitfield(oc_merge), which js/mkobj.js packs as bit 5 of the
// row's `flags` word (the same resolution js/sp_lev.js:4060 uses).
const F_MERGE = 32;
const oc_merge = (otyp) => !!(objects[otyp]?.flags & F_MERGE);

// C ref: mondata.h is_mplayer(ptr) / is_female(ptr).
function is_mplayer(ptr) {
    return !!ptr && ptr.pmidx >= PM_ARCHEOLOGIST && ptr.pmidx <= PM_WIZARD;
}
function is_female(ptr) { return (mflags2_of(ptr) & M2_FEMALE) !== 0; }
// C ref: mondata.c monsndx(ptr).
function monsndx(ptr) { return ptr?.pmidx ?? -1; }
// C ref: monst.h has_mgivenname(mon)/MGIVENNAME(mon); this port keeps the name
// on mon.mname (js/do_name.js christen_monst) as well as in mextra.
function MGIVENNAME(mtmp) {
    return mtmp?.mextra?.mgivenname || mtmp?.mname || '';
}

// ── developers[] (C ref: mplayer.c:17) ─────────────────────────────────────
//
// "These are the names of those who contributed to the development of NetHack
// 3.2/3.3/3.4/3.6.  Keep in alphabetical order within teams.  Same first name
// is entered once within each team."
//
// SIZE(developers) is dev_name()'s rn2() MODULUS, so the duplicates ACROSS
// teams (Eric, Ken, Kevin, Michael, Mike, Paul, Steve, Timo, Pat, Alex, Andy,
// Dean, Warwick) are load-bearing and so is the empty string that ends it —
// see the note in dev_name().  58 entries.
const developers = [
    /* devteam */
    'Alex',    'Dave',   'Dean',    'Derek',   'Eric',    'Izchak',
    'Janet',   'Jessie', 'Ken',     'Kevin',   'Michael', 'Mike',
    'Pasi',    'Pat',    'Patric',  'Paul',    'Sean',    'Steve',
    'Timo',    'Warwick',
    /* PC team */
    'Bill',    'Eric',   'Keizo',   'Ken',    'Kevin',    'Michael',
    'Mike',    'Paul',   'Stephen', 'Steve',  'Timo',     'Yitzhak',
    /* Amiga team */
    'Andy',    'Gregg',  'Janne',   'Keni',   'Mike',     'Olaf',
    'Richard',
    /* Mac team */
    'Andy',    'Chris',  'Dean',    'Jon',    'Jonathan', 'Kevin',
    'Wang',
    /* Atari team */
    'Eric',    'Marvin', 'Warwick',
    /* NT team */
    'Alex',    'Dion',   'Michael',
    /* OS/2 team */
    'Helge',   'Ron',    'Timo',
    /* VMS team */
    'Joshua',  'Pat',    '',
];

// C ref: mplayer.c:43 dev_name() — "return a randomly chosen developer name",
// rerolling while the name is already a prefix of some mplayer's given name.
//
// Two faithfulness details:
//  * the rn2(SIZE(developers)) fires once per do-while pass and the loop runs
//    up to 100 times ("m for insurance"), so a level already full of mplayers
//    burns up to 100 draws here;
//  * the last entry is "", and strncmp(x, y, 0) == 0, so index 57 matches ANY
//    existing mplayer, given name or not.  That is C's behaviour, not a bug in
//    this transcription.
export function dev_name() {
    let i = 0, m = 0;
    const n = developers.length;
    let match;

    do {
        match = false;
        i = rn2(n);
        for (const mtmp of fmon()) {
            if (!is_mplayer(mtmp.data))
                continue;
            /* C: !strncmp(developers[i], MGIVENNAME(mtmp), strlen(developers[i])) */
            if (MGIVENNAME(mtmp).startsWith(developers[i])) {
                match = true;
                break;
            }
        }
        m++;
    } while (match && m < 100);  /* m for insurance */

    if (match)
        return null;
    return developers[i];
}
// C ref: mon.h fmon — the level's monster chain, an array in this port.
function fmon() { return game.level?.monsters || []; }

// C ref: mplayer.c:71 get_mplname(mtmp, nam) — pick the fake player's name and
// set its gender from it.  RNG: dev_name()'s rerolls, then one rn2(2) for a
// female form whose developer name isn't "Janet".
export function get_mplname(mtmp) {
    const fmlkind = is_female(mtmp.data);
    let nam;

    const devnam = dev_name();
    if (!devnam)
        nam = fmlkind ? 'Eve' : 'Adam';
    else if (fmlkind && devnam !== 'Janet')
        nam = rn2(2) ? 'Maud' : 'Eve';
    else
        nam = devnam;

    if (fmlkind || nam === 'Janet')
        mtmp.female = 1;
    else
        mtmp.female = 0;
    nam += ' the ';
    // C: rank_of((int) mtmp->m_lev, monsndx(mtmp->data), mtmp->female).  C's
    // botl.c rank_of() takes a mons[] index and scans roles[] for the row whose
    // ->mnum matches; BOTH JS ports (js/exper.js:300 and js/role.js:688) instead
    // key on the 0-BASED ROLE index despite their `C ref: botl.c rank_of`
    // comments, so handing them monsndx() answers "Player" for every role.
    // Converted here rather than in exper.js (not my file to change); the real
    // fix is to make rank_of() accept the mnum C passes it.
    nam += rank_of(mtmp.m_lev | 0, monsndx(mtmp.data) - PM_ARCHEOLOGIST,
                   !!mtmp.female);
    return nam;
}

// C ref: mplayer.c:94 mk_mplayer_armor(mon, typ).
// RNG, in order: rn2(3) erodeproof, rn2(3) curse, rn2(3) bless, then the
// enchantment `rn2(10) ? (rn2(3) ? rn2(5) : rn1(4,4)) : -rnd(3)`.  The
// STRANGE_OBJECT early return draws NOTHING, which is why the four
// `!rn2(8) ? STRANGE_OBJECT : rnd_class(...)` picks in mk_mplayer() below
// change the stream length and not just its values.
export function mk_mplayer_armor(mon, typ) {
    if (typ === STRANGE_OBJECT)
        return;
    const obj = mksobj(typ, false, false);
    obj.oeroded = obj.oeroded2 = 0;
    if (!rn2(3))
        obj.oerodeproof = 1;
    if (!rn2(3))
        curse(obj);
    if (!rn2(3))
        bless(obj);
    /* Most players who get to the endgame who have cursed equipment have it
     * because the wizard or other monsters cursed it, so its chances of having
     * plusses is the same as usual....
     */
    obj.spe = rn2(10) ? (rn2(3) ? rn2(5) : rn1(4, 4)) : -rnd(3);
    mpickobj(mon, obj);
}

// C ref: mplayer.c:117 mk_mplayer(ptr, x, y, special).
//
// `special` is only honoured in the endgame; elsewhere it is forced FALSE,
// which cuts out the name, the fake Amulet, the whole armour suite, the gems,
// the gold and the random-object handful — i.e. most of the RNG.  The three
// rnd(3) `rnd_*_item` loops at the end run either way.
//
// deps: mongets (js/makemon.js:1343, module-private), mkmonmoney
// (js/makemon.js:4026, exported only on an uncommitted branch at the time of
// writing) and rloc (js/teleport.js exports it, but it is async and this
// function is not, so the MON_AT insurance rloc is a dep too).  For each of
// those the fix is to export the existing faithful port, not to write a second.
export function mk_mplayer(ptr, x, y, special, deps = {}) {
    const mongets = deps.mongets || (() => null);

    if (!is_mplayer(ptr))
        return null;

    if (MON_AT(x, y))
        deps.rloc?.(MON_AT(x, y), 0);        /* insurance; RLOC_ERR|RLOC_NOMSG */

    if (!In_endgame(game.u?.uz))
        special = false;

    let mtmp = makemon(ptr, x, y, special ? MM_NOMSG : 0 /* NO_MM_FLAGS */);
    if (mtmp) {
        let weapon, armor, cloak, helm, shield;
        let quan;
        let otmp;

        mtmp.m_lev = (special ? rn1(16, 15) : rnd(16));
        mtmp.mhp = mtmp.mhpmax = d(mtmp.m_lev | 0, 10)
                                 + (special ? (30 + rnd(30)) : 30);
        if (special) {
            const nam = get_mplname(mtmp);
            mtmp = christen_monst(mtmp, nam);
            /* that's why they are "stuck" in the endgame :-) */
            mongets(mtmp, FAKE_AMULET_OF_YENDOR);
        }
        mtmp.mpeaceful = 0;
        set_malign(mtmp);       /* peaceful may have changed again */

        /* default equipment; much of it will be overridden below */
        weapon = !rn2(2) ? LONG_SWORD : rnd_class(SPEAR, BULLWHIP);
        armor  = rnd_class(GRAY_DRAGON_SCALE_MAIL, YELLOW_DRAGON_SCALE_MAIL);
        cloak  = !rn2(8) ? STRANGE_OBJECT
                         : rnd_class(OILSKIN_CLOAK, CLOAK_OF_DISPLACEMENT);
        helm   = !rn2(8) ? STRANGE_OBJECT
                         : rnd_class(ELVEN_LEATHER_HELM, HELM_OF_TELEPATHY);
        shield = !rn2(8) ? STRANGE_OBJECT
                         : rnd_class(ELVEN_SHIELD, SHIELD_OF_REFLECTION);

        switch (monsndx(ptr)) {
        case PM_ARCHEOLOGIST:
            if (rn2(2))
                weapon = BULLWHIP;
            break;
        case PM_BARBARIAN:
            if (rn2(2)) {
                weapon = rn2(2) ? TWO_HANDED_SWORD : BATTLE_AXE;
                shield = STRANGE_OBJECT;
            }
            if (rn2(2))
                armor = rnd_class(PLATE_MAIL, CHAIN_MAIL);
            if (helm === HELM_OF_BRILLIANCE)
                helm = STRANGE_OBJECT;
            break;
        case PM_CAVE_DWELLER:
            if (rn2(4))
                weapon = MACE;
            else if (rn2(2))
                weapon = CLUB;
            if (helm === HELM_OF_BRILLIANCE)
                helm = STRANGE_OBJECT;
            break;
        case PM_HEALER:
            if (rn2(4))
                weapon = QUARTERSTAFF;
            else if (rn2(2))
                weapon = rn2(2) ? UNICORN_HORN : SCALPEL;
            if (rn2(4))
                helm = rn2(2) ? HELM_OF_BRILLIANCE : HELM_OF_TELEPATHY;
            if (rn2(2))
                shield = STRANGE_OBJECT;
            break;
        case PM_KNIGHT:
            if (rn2(4))
                weapon = LONG_SWORD;
            if (rn2(2))
                armor = rnd_class(PLATE_MAIL, CHAIN_MAIL);
            break;
        case PM_MONK:
            weapon = !rn2(3) ? SHURIKEN : STRANGE_OBJECT;
            armor = STRANGE_OBJECT;
            cloak = ROBE;
            if (rn2(2))
                shield = STRANGE_OBJECT;
            break;
        case PM_CLERIC:
            if (rn2(2))
                weapon = MACE;
            if (rn2(2))
                armor = rnd_class(PLATE_MAIL, CHAIN_MAIL);
            if (rn2(4))
                cloak = ROBE;
            if (rn2(4))
                helm = rn2(2) ? HELM_OF_BRILLIANCE : HELM_OF_TELEPATHY;
            if (rn2(2))
                shield = STRANGE_OBJECT;
            break;
        case PM_RANGER:
            if (rn2(2))
                weapon = ELVEN_DAGGER;
            break;
        case PM_ROGUE:
            if (rn2(2))
                weapon = rn2(2) ? SHORT_SWORD : ORCISH_DAGGER;
            break;
        case PM_SAMURAI:
            if (rn2(2))
                weapon = KATANA;
            break;
        case PM_TOURIST:
            /* Defaults are just fine */
            break;
        case PM_VALKYRIE:
            if (rn2(2))
                weapon = WAR_HAMMER;
            if (rn2(2))
                armor = rnd_class(PLATE_MAIL, CHAIN_MAIL);
            break;
        case PM_WIZARD:
            if (rn2(4))
                weapon = rn2(2) ? QUARTERSTAFF : ATHAME;
            if (rn2(2)) {
                armor = rn2(2) ? BLACK_DRAGON_SCALE_MAIL
                               : SILVER_DRAGON_SCALE_MAIL;
                cloak = CLOAK_OF_MAGIC_RESISTANCE;
            }
            if (rn2(4))
                helm = HELM_OF_BRILLIANCE;
            shield = STRANGE_OBJECT;
            break;
        default:
            deps.impossible?.('bad mplayer monster');
            weapon = 0;
            break;
        }

        if (weapon !== STRANGE_OBJECT) {
            otmp = mksobj(weapon, true, false);
            otmp.oeroded = otmp.oeroded2 = 0;
            otmp.spe = (special ? rn1(5, 4) : rn2(4));
            if (!rn2(3))
                otmp.oerodeproof = 1;
            else if (!rn2(2))
                otmp.greased = 1;
            /* mk_artifact() with otmp and A_NONE will never return NULL */
            if (special && rn2(2))
                otmp = mk_artifact(otmp, A_NONE, 99, false) || otmp;
            /* usually increase stack size if stackable weapon */
            if (oc_merge(otmp.otyp) && !otmp.oartifact
                && monmightthrowwep(otmp))
                otmp.quan += rn2(is_spear(otmp) ? 4 : 8);
            otmp.owt = weight(otmp);
            /* mplayers knew better than to overenchant Magicbane */
            if (is_art(otmp, ART_MAGICBANE))
                otmp.spe = rnd(4);
            mpickobj(mtmp, otmp);
        }

        if (special) {
            if (!rn2(10))
                mongets(mtmp, rn2(3) ? LUCKSTONE : LOADSTONE);
            mk_mplayer_armor(mtmp, armor);
            mk_mplayer_armor(mtmp, cloak);
            mk_mplayer_armor(mtmp, helm);
            mk_mplayer_armor(mtmp, shield);
            if (weapon === WAR_HAMMER)  /* valkyrie: wimpy weapon or Mjollnir */
                mk_mplayer_armor(mtmp, GAUNTLETS_OF_POWER);
            else if (rn2(8))
                mk_mplayer_armor(mtmp, rnd_class(LEATHER_GLOVES,
                                                 GAUNTLETS_OF_DEXTERITY));
            if (rn2(8))
                mk_mplayer_armor(mtmp, rnd_class(LOW_BOOTS,
                                                 LEVITATION_BOOTS));
            m_dowear(mtmp, true);

            quan = rn2(3) ? rn2(3) : rn2(16);
            while (quan-- > 0)
                mongets(mtmp, rnd_class(DILITHIUM_CRYSTAL, JADE));
            /* To get the gold "right" would mean a player can double his gold
               supply by killing one mplayer.  Not good. */
            // The rn2(1000) is bound to a local FIRST on purpose: with
            // `deps.mkmonmoney?.(mtmp, rn2(1000))` JS short-circuits the whole
            // call when the dep is absent and the draw would silently vanish.
            const money = rn2(1000);
            deps.mkmonmoney?.(mtmp, money);
            quan = rn2(10);
            while (quan-- > 0)
                mpickobj(mtmp, mkobj(RANDOM_CLASS, false));
        }
        quan = rnd(3);
        while (quan-- > 0)
            mongets(mtmp, rnd_offensive_item(mtmp));
        quan = rnd(3);
        while (quan-- > 0)
            mongets(mtmp, rnd_defensive_item(mtmp));
        quan = rnd(3);
        while (quan-- > 0)
            mongets(mtmp, rnd_misc_item(mtmp));
    }

    return mtmp;
}

// C ref: mplayer.c:326 create_mplayers(num, special) — "create the indicated
// number (num) of monster-players, randomly chosen, and in randomly chosen
// (free) locations on the level.  If 'special', the size of num should not be
// bigger than the number of _non-repeated_ names in the developers array,
// otherwise a bunch of Adams and Eves will fill up the overflow."
//
// The placement loop rolls rn1(COLNO - 4, 2) and rnd(ROWNO - 2) EVERY pass,
// tryct is only incremented on failure (`tryct++ <= 50` inside the &&), and a
// 51st failure abandons the whole run — the remaining `num` mplayers are never
// created.
export function create_mplayers(num, special, deps = {}) {
    /* C: `struct monst fakemon; fakemon = cg.zeromonst;` then set_mon_data()
       points it at mons[pm] so goodpos() can test that species' terrain
       requirements without a real monster existing yet. */
    const fakemon = {};

    while (num) {
        let tryct = 0;
        let x, y;

        /* roll for character class */
        const pm = rn1(PM_WIZARD - PM_ARCHEOLOGIST + 1, PM_ARCHEOLOGIST);
        set_mon_data(fakemon, monster_by_pmidx(pm));

        /* roll for an available location */
        do {
            x = rn1(COLNO - 4, 2);
            y = rnd(ROWNO - 2);
        } while (!goodpos(x, y, fakemon, 0) && tryct++ <= 50);

        /* if pos not found in 50 tries, don't bother to continue */
        if (tryct > 50)
            return;

        mk_mplayer(monster_by_pmidx(pm), x, y, special, deps);
        num--;
    }
}
// C ref: mon.c set_mon_data(mon, ptr) — point a monst at a permonst row.
// js/makemon.js has a module-private copy behind the same name; the fix is to
// export that one.
function set_mon_data(mon, ptr) {
    mon.data = ptr;
    mon.mnum = ptr ? ptr.pmidx : -1;
}

// C ref: mplayer.c:355 mplayer_talk(mtmp) — the taunt a hostile fake player
// throws at the hero.  Draws exactly one rn2(3), and only when hostile; a
// peaceful mplayer returns before it and "will drop to humanoid talk"
// (js/sounds.js:379 notes that tail).  Which of the two message tables is used
// depends on whether the mplayer shares the hero's role.
const same_class_msg = [
    "I can't win, and neither will you!",
    "You don't deserve to win!",
    'Mine should be the honor, not yours!',
];
const other_class_msg = [
    'The low-life wants to talk, eh?',
    'Fight, scum!',
    'Here is what I have to say!',
];
export async function mplayer_talk(mtmp) {
    if (mtmp.mpeaceful)
        return;             /* will drop to humanoid talk */

    /* C: SetVoice(mtmp, 0, 80, 0) — the sound-interface hook, no RNG. */
    const same = monsndx(mtmp.data) === (game.urole?.mnum ?? -1);
    const line = same ? same_class_msg[rn2(3)] : other_class_msg[rn2(3)];
    const { pline } = await import('./display.js');
    /* C ref: pline.c:476 verbalize() — the text is quoted and gets
       PLINE_VERBALIZE. */
    await pline(`Talk? -- "${line}"`);
}

// C ref: dungeon.h In_endgame(lev) — the endgame dungeon branch.  Resolved off
// game.dungeons rather than a baked ledger number.
function In_endgame(lev) {
    const dnum = lev?.dnum;
    if (dnum == null) return false;
    return game.dungeons?.[dnum]?.dname === 'End Game'
        || dnum === game.endgame_dnum;
}
// C ref: rm.h MON_AT(x,y) — a monster (not the hero) occupies the square.
function MON_AT(x, y) {
    for (const m of fmon())
        if (m.mx === x && m.my === y && !m.mburied && !m.dead) return m;
    return null;
}
