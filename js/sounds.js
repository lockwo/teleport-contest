// sounds.js — Ambient level sounds emitted once per turn.
// C ref: sounds.c dosounds().
//
// Only the RNG side-effects matter for parity.  Each gated probe is driven
// by the current level's flags (data-driven, no per-seed special casing),
// matching the C order exactly; the first probe that "fires" returns.

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { phase_of_the_moon, night, FULL_MOON } from './calendar.js';
import { VAULT, ROOMOFFSET } from './const.js';
import { GOLD_PIECE, objects, WEAPON_CLASS } from './mkobj.js';
import { DEADMONSTER } from './mon.js';
import { update_topl } from './display.js';
import {
    msound_of, mflags2_of, M2_MAGIC, is_elf_flag, is_dwarf_flag, is_gnome_flag,
    is_orc_flag, is_human_flag, is_giant_flag,
} from './monflags_data.js';
import { monster_by_pmidx } from './makemon.js';
import { races } from './roles.js';
// ── extra imports for the rest of sounds.c (ported at the end of this file) ──
import { rn1 } from './rng.js';
import { STATUE } from './mkobj.js';
import {
    COURT, BEEHIVE, MORGUE, ZOO, HAIR, NECK, HEAD, IRONBARS, BOLT_LIM,
    W_ARMH, A_NONE, STRAT_WAITMASK, nothing_happens, ACCESSIBLE, isok,
    M_AP_FURNITURE, M_AP_OBJECT, M_AP_MONSTER,
} from './const.js';
import {
    mflags1_of, M1_FLY, M1_NOEYES, M1_CARNIVORE, M1_HERBIVORE, M1_SEE_INVIS,
    M2_LORD, M2_PRINCE, M2_UNDEAD, is_animal, humanoid,
} from './monflags_data.js';
// display.js is already a static dependency (update_topl above), so these can
// be bound at module level and responsive_mon_at() can keep C's synchronous
// signature.
import { m_at, vobj_at, map_invisible as map_invis_snd,
         canseemon_shared } from './display.js';

// C ref: sounds.c dosounds().  Deaf/acoustics/swallow/underwater short-circuit
// before any roll.  Each `level.flags.*` clause rolls rn2(N) when the feature
// is present and returns after producing a (suppressed) message.
// C ref: pline.c You_hear() — non-deaf/non-underwater/non-unaware prefix is
// "You hear ".  You_hear1(cstr) == You_hear("%s", cstr).  The starter sessions
// are never Deaf/Underwater/Unaware here, so we emit the plain prefix.  Routed
// through the real update_topl() (not a hand-rolled append) so a message that
// doesn't fit on the same line as an already-pending one pauses with
// "--More--" first, instead of silently overwriting it.
async function You_hear1(cstr) {
    await update_topl('You hear ' + cstr);
}
// C ref: pline.c You() — prefix "You ".  You1(cstr) == You("%s", cstr).
async function You1(cstr) {
    await update_topl('You ' + cstr);
}

// Fountain ambient (sounds.c:214-217): fountain_msg[rn2(3) + hallu].
const FOUNTAIN_MSG = [
    'bubbling water.', 'water falling on coins.',
    'the splashing of a naiad.', 'a soda fountain!',
];
// Sink ambient (sounds.c:221-223): sink_msg[rn2(2) + hallu].
const SINK_MSG = [
    'a slow drip.', 'a gurgling noise.', 'dishes being washed!',
];
// Swamp ambient (sounds.c:231-234): swamp_msg[rn2(2) + hallu], via You1().
const SWAMP_MSG = [
    'hear mosquitoes!', 'smell marsh gas!', 'hear Donald Duck!',
];
// Barracks ambient (sounds.c:287-290): barracks_msg[rn2(3) + hallu].
const BARRACKS_MSG = [
    'blades being honed.', 'loud snoring.', 'dice being thrown.',
    'General MacArthur!',
];
// Shop ambient (sounds.c:321-324): shop_msg[rn2(2) + hallu].
const SHOP_MSG = [
    'someone cursing shoplifters.',
    'the chime of a cash register.', 'Neiman and Marcus arguing!',
];

// C ref: youprop.h Deaf — HDeaf (an intrinsic timeout) or EDeaf (worn).  Only
// the timed intrinsic is reachable here (rotten food, and the "deafness going
// away" roll in Hear_again).
function Deaf_hero() {
    const u = game.u;
    return ((u?.uprops?.HDeaf ?? 0) > 0) || !!u?.Deaf;
}

export async function dosounds() {
    const g = game;
    // C ref: sounds.c:208 — `if (Deaf || !flags.acoustics || u.uswallow ||
    // Underwater) return;`.  The Deaf test was missing, so a hero deafened by
    // rotten food (eat.c rottenfood -> incr_itimeout(&HDeaf, duration)) kept
    // rolling the ambient-sound draws C skips: seed4500's unconscious turns draw
    // no rn2(200) at all.
    if (Deaf_hero() || g.flags?.acoustics === false || g.u?.uswallow || g.u?.uunderwater)
        return;

    const lf = g.level?.flags || {};
    const hallu = 0; // Hallucination not modeled in the move loop

    // C ref: sounds.c:213-219 — fountain ambient.  rn2(3) selects the message.
    // NOTE: C does NOT return here — nsinks/has_court/etc. below are still
    // rolled this same turn (multiple ambient sounds can stack on one line
    // via update_topl).  A `return` here silently drops every rn2() roll
    // for the rest of the function whenever the 1/400 fountain chance hits.
    if (lf.nfountains && !rn2(400)) { await You_hear1(FOUNTAIN_MSG[rn2(3) + hallu]); }
    // C ref: sounds.c:220-225 — sink ambient ("You hear a slow drip.").  Also
    // falls through (no return) in C — see note above.
    if (lf.nsinks && !rn2(300)) { await You_hear1(SINK_MSG[rn2(2) + hallu]); }
    if (lf.has_court && !rn2(200)) { return; }
    // C ref: sounds.c:230-237 — swamp ambient, via You1() not You_hear1().
    if (lf.has_swamp && !rn2(200)) { await You1(SWAMP_MSG[rn2(2) + hallu]); return; }
    // C ref: sounds.c:238-273 — vault ambient.  gd_sound() gates the rn2(2)
    // message roll: a hero standing IN the vault (or a guard already on the
    // level) silences the ambient entirely, so the rn2(2) is NOT drawn —
    // seed0012 step 266 call 96.
    if (lf.has_vault && !rn2(200)) {
        const sroom = game.level?.rooms?.find((r) => r.rtype === VAULT);
        if (!sroom) { lf.has_vault = 0; return; }
        if (gd_sound()) {
            switch (rn2(2) + hallu) {
            case 1: {
                let gold_in_vault = false;
                for (let vx = sroom.lx; vx <= sroom.hx && !gold_in_vault; vx++)
                    for (let vy = sroom.ly; vy <= sroom.hy; vy++)
                        if (gold_at(vx, vy)) { gold_in_vault = true; break; }
                if (vault_occupied() !== (game.level.rooms.indexOf(sroom) + ROOMOFFSET)) {
                    await You_hear1(gold_in_vault ? 'someone counting gold coins.'
                                            : 'someone searching.');
                    break;
                }
                // FALLTHROUGH — the hero is standing in the vault.
            }
            /* falls through */
            case 0:
                await You_hear1('the footsteps of a guard on patrol.');
                break;
            case 2:
                await You_hear1('Ebenezer Scrooge!');
                break;
            }
        }
        return;
    }
    if (lf.has_beehive && !rn2(200)) { return; }
    if (lf.has_morgue && !rn2(200)) { return; }
    // C ref: sounds.c:286-307 — barracks ambient.  The rn2(3) message roll only
    // fires inside the mercenary loop; since the message-bearing path is what
    // consumes the rn2(3), keep the roll and emit the corresponding text.
    if (lf.has_barracks && !rn2(200)) { await You_hear1(BARRACKS_MSG[rn2(3) + hallu]); return; }
    if (lf.has_zoo && !rn2(200)) { return; }
    // C ref: sounds.c:313-328 — shop ambient.
    if (lf.has_shop && !rn2(200)) { await You_hear1(SHOP_MSG[rn2(2) + hallu]); return; }
    if (lf.has_temple && !rn2(200)) { return; }
    // C ref: sounds.c:335 — `if (Is_oracle_level(&u.uz) && !rn2(400)) { ... }`.
    // The Oracle level (placed at dnum 0, base 5 range 5) is reached by these
    // descend sessions; its dosounds() makes a trailing rn2(400) chant probe
    // every turn.  get_iter_mons(oracle_sound) (the body) is RNG-inert, so only
    // the probe itself matters for parity.
    if (Is_oracle_level(g.u?.uz) && !rn2(400)) { return; }
}

// C ref: vault.c gd_sound() = !(vault_occupied(u.urooms) || findgd()).
function gd_sound() { return !(vault_occupied() || findgd()); }
// C ref: vault.c vault_occupied(u.urooms) — the room number of the vault the
// hero is standing in, else 0.  js/shkroom.js move_update() keeps u.urooms.
function vault_occupied() {
    for (const rno of (game.u?.urooms || []))
        if (game.level?.rooms?.[rno - ROOMOFFSET]?.rtype === VAULT) return rno;
    return 0;
}
// C ref: vault.c findgd() — is a vault guard monster on this level (placed or
// migrating in)?
function findgd() {
    for (const m of game.level?.monsters || [])
        if (!DEADMONSTER(m) && m.isgd) return true;
    return false;
}
// C ref: mkobj.c sobj_at(GOLD_PIECE, x, y) — is there floor gold at (x,y)?
function gold_at(x, y) {
    const objs = game.level?.objects;
    if (!objs) return false;
    for (const o of objs)
        if (o.where === 'floor' && o.ox === x && o.oy === y && o.otyp === GOLD_PIECE)
            return true;
    return false;
}

// C ref: dungeon.h Is_oracle_level(x) = Lcheck(x, &oracle_level) — true when the
// current level position matches the placed oracle_level (same dnum + dlevel).
function Is_oracle_level(uz) {
    const ol = game.oracle_level;
    if (!uz || !ol) return false;
    return uz.dnum === ol.dnum && uz.dlevel === ol.dlevel;
}

// ── ECMD_* return codes (cmd.h) ──
const ECMD_OK = 0;
const ECMD_TIME = 1;

// C ref: include/monflag.h enum ms_sounds — mons[].msound.  Driven off the
// generated MSOUND table (monflags_data.js), never off the monster's name or
// class letter: a name/letter test silently answers "silent" for every species
// it doesn't list.
const MS_SILENT = 0, MS_BARK = 1, MS_MEW = 2, MS_ROAR = 3, MS_BELLOW = 4,
    MS_GROWL = 5, MS_SQEEK = 6, MS_SQAWK = 7, MS_CHIRP = 8, MS_HISS = 9,
    MS_BUZZ = 10, MS_GRUNT = 11, MS_NEIGH = 12, MS_MOO = 13, MS_WAIL = 14,
    MS_GURGLE = 15, MS_BURBLE = 16, MS_TRUMPET = 17, MS_ANIMAL = 17,
    MS_SHRIEK = 18, MS_BONES = 19, MS_LAUGH = 20, MS_MUMBLE = 21,
    MS_IMITATE = 22, MS_WERE = 23, MS_ORC = 24, MS_HUMANOID = 25,
    MS_ARREST = 26, MS_SOLDIER = 27, MS_GUARD = 28, MS_DJINNI = 29,
    MS_NURSE = 30, MS_SEDUCE = 31, MS_VAMPIRE = 32, MS_BRIBE = 33,
    MS_CUSS = 34, MS_RIDER = 35, MS_LEADER = 36, MS_NEMESIS = 37,
    MS_GUARDIAN = 38, MS_SELL = 39, MS_ORACLE = 40, MS_PRIEST = 41,
    MS_SPELL = 42, MS_BOAST = 43, MS_GROAN = 44;

// C ref: include/monsym.h S_CENTAUR — the mons[].mlet the "discusses hunting."
// line keys off.  C ref: role.c roles[] PM_HEALER index.
const S_CENTAUR_MCLS = 29, PM_HEALER = 3;

// C ref: hack.c money_cnt(gi.invent) — the hero's carried gold, used only as a
// boolean by MS_GUARD.  Containers hold no gold in the covered sessions.
function hero_money_cnt() {
    let sum = 0;
    for (const o of (game.invent || []))
        if (o.otyp === GOLD_PIECE) sum += (o.quan || 0);
    return sum;
}

// C ref: polyself.c poly_gender() — 2 when the current form is neuter or not
// humanoid, else flags.female.  Un-poly'd the hero is always humanoid.
function poly_gender() {
    return game.flags?.female ? 1 : 0;
}

// C ref: include/mondata.h likes_magic(ptr) = (mflags2 & M2_MAGIC).
const likes_magic = (ptr) => (mflags2_of(ptr) & M2_MAGIC) !== 0;

// C ref: mondata.c same_race(pm1, pm2) — the player-race predicates first, then
// the looser genus tests.  Only the arms that can pair with a chattable monster
// and a hero form are needed (golem / mind flayer / were / vampire genus tests
// would need their own flag lookups and cannot both be a #chat target and the
// hero's un-poly'd form here).
function same_race(pm1, pm2) {
    if (!pm1 || !pm2) return false;
    if (pm1 === pm2 || pm1.pmidx === pm2.pmidx) return true;
    if (is_human_flag(pm1)) return is_human_flag(pm2);
    if (is_elf_flag(pm1)) return is_elf_flag(pm2);
    if (is_dwarf_flag(pm1)) return is_dwarf_flag(pm2);
    if (is_gnome_flag(pm1)) return is_gnome_flag(pm2);
    if (is_orc_flag(pm1)) return is_orc_flag(pm2);
    if (is_giant_flag(pm1)) return is_giant_flag(pm2);
    return pm1.mlet === pm2.mlet;
}

// C ref: gy.youmonst.data == &mons[u.umonnum], and &mons[Race_switch] (the
// un-poly'd race's base monster) which domonnoise tests alongside it.
function hero_permonst() {
    return (game.u?.umonnum != null) ? monster_by_pmidx(game.u.umonnum) : null;
}
function hero_race_permonst() {
    const r = races[game.initrace];
    return (r?.basepm != null) ? monster_by_pmidx(r.basepm) : null;
}

// C compares against one specific mons[] entry (e.g. `ptr == &mons[PM_DINGO]`).
// These three names are unique in monsters.h, so matching the generated
// pmidx->name is exact — unlike the werecreatures, whose animal and human forms
// share a name and therefore need the PM_ index itself.
const is_pm_named = (ptr, nm) => ptr?.name === nm;

// C ref: sounds.c domonnoise(mtmp) — the speech/sound a monster makes when the
// hero #chats with it (also the pet's `beg()` and #tip).  Ported off msound so
// every species answers, not just the starter pet.
//
// C ref: sounds.c h_sounds[] — the hallucinatory verb table growl()/yelp()/
// whimper() index with rn2(SIZE(h_sounds)).
// sounds.c:341 — 35 entries; this table used to stop at 30 with six invented
// tail verbs, so ROLL_FROM() drew rn2(30) instead of rn2(35) on every
// hallucinated growl/yelp/whimper (seed0383 step 178).
const H_SOUNDS = [
    'beep', 'boing', 'sing', 'belche', 'creak', 'cough',
    'rattle', 'ululate', 'pop', 'jingle', 'sniffle', 'tinkle',
    'eep', 'clatter', 'hum', 'sizzle', 'twitter', 'wheeze',
    'rustle', 'honk', 'lisp', 'yodel', 'coo', 'burp',
    'moo', 'boom', 'murmur', 'oink', 'quack', 'rumble',
    'twang', 'toot', 'gargle', 'hoot', 'warble',
];

// C ref: objnam.c vtense((char *) 0, verb) — 3rd-person singular.
function vtense_sing_snd(verb) {
    const last = verb[verb.length - 1];
    const prev = verb.length >= 2 ? verb[verb.length - 2] : '';
    if (last === 'z' || last === 'x' || last === 's'
        || (last === 'h' && (prev === 'c' || prev === 's'))
        || (verb.length === 2 && last === 'o'))
        return verb + 'es';
    if (last === 'y' && !'aeiou'.includes(prev)) return verb.slice(0, -1) + 'ies';
    return verb + 's';
}

// C ref: sounds.c:401 growl(mtmp) — the noise a monster makes when the hero
// wakes it by hitting it (mon.c:4353 `if (was_sleeping) growl(mtmp)`).
// RNG-free unless hallucinating, but the wake_nearto(mlevel * 18) tail clears
// msleeping on every monster in that radius, and a sleeper C woke here SKIPS
// disturb()'s rn2(50)/rn2(7) on its next turn — so dropping it desyncs.
export async function growl(mtmp) {
    const { update_topl } = await import('./display.js');
    const { Monnam } = await import('./uhitm.js');
    const ptr = mtmp?.data;
    // C: `if (helpless(mtmp) || is_silent(mtmp->data)) return;` — msleeping is
    // already cleared by wakeup() before growl() runs, so only mcanmove/mfrozen
    // can be helpless here.
    const canmove = (mtmp.mcanmove == null) ? 1 : mtmp.mcanmove;
    if (mtmp.msleeping || !canmove) return;
    const ms = msound_of(ptr) ?? MS_SILENT;
    if (ms === MS_SILENT) return;
    let verb;
    if (game.u?.uhallu) {
        verb = H_SOUNDS[rn2(H_SOUNDS.length)];
    } else {
        switch (ms) {
        case MS_MEW: case MS_HISS: verb = 'hiss'; break;
        case MS_BARK: case MS_GROWL: verb = 'growl'; break;
        case MS_ROAR: verb = 'roar'; break;
        case MS_BUZZ: verb = 'buzz'; break;
        case MS_SQEEK: verb = 'squeal'; break;
        case MS_SQAWK: verb = 'screech'; break;
        case MS_NEIGH: verb = 'neigh'; break;
        case MS_WAIL: verb = 'wail'; break;
        case MS_GROAN: verb = 'groan'; break;
        case MS_MOO: verb = 'low'; break;
        case MS_SILENT: break;
        default: verb = 'scream'; break;
        }
    }
    if (!verb) return;
    await update_topl(`${Monnam(mtmp)} ${vtense_sing_snd(verb)}!`);
    const { wake_nearto } = await import('./cmd.js');
    await wake_nearto(mtmp.mx, mtmp.my, (ptr?.mlevel ?? 0) * 18);
}

// C ref: sounds.c:426 yelp(mtmp) — the noise a mistreated pet makes
// (dog.c abuse_dog).  Under Hallucination the verb is ROLL_FROM(h_sounds),
// i.e. a REAL rn2(35) draw on the core stream, so this cannot be skipped.
export async function yelp(mtmp) {
    const { update_topl } = await import('./display.js');
    const { Monnam } = await import('./uhitm.js');
    const ptr = mtmp?.data;
    const canmove = (mtmp.mcanmove == null) ? 1 : mtmp.mcanmove;
    if (mtmp.msleeping || !canmove) return;
    const ms = msound_of(ptr) ?? MS_SILENT;
    if (!ms) return;                                  // C: `!mtmp->data->msound`
    let verb = null;
    if (game.u?.uhallu) {
        verb = H_SOUNDS[rn2(H_SOUNDS.length)];
    } else {
        const deaf = false;                           // Deaf is never set here
        switch (ms) {
        case MS_MEW: verb = deaf ? 'arch' : 'yowl'; break;
        case MS_BARK: case MS_GROWL: verb = deaf ? 'recoil' : 'yelp'; break;
        case MS_ROAR: verb = deaf ? 'bluff' : 'snarl'; break;
        case MS_SQEEK: verb = deaf ? 'quiver' : 'squeal'; break;
        case MS_SQAWK: verb = deaf ? 'thrash' : 'screak'; break;
        case MS_WAIL: verb = deaf ? 'cringe' : 'wail'; break;
        default: verb = null; break;
        }
    }
    if (!verb) return;
    await update_topl(`${Monnam(mtmp)} ${vtense_sing_snd(verb)}!`);
    const { wake_nearto } = await import('./cmd.js');
    await wake_nearto(mtmp.mx, mtmp.my, (ptr?.mlevel ?? 0) * 12);
}

// SCOPE: the arms that hand off to an unported subsystem — MS_PRIEST
// (priest_talk), MS_LEADER/MS_NEMESIS/MS_GUARDIAN
// (quest_chat, ported), MS_SELL (shk_chat), MS_VAMPIRE and MS_RIDER (both need the
// 3.6-tribute / urace-noun machinery) — fall through to the silent ECMD_TIME
// tail, as does the In_endgame mplayer_talk() arm of MS_HUMANOID.  Their RNG is
// therefore not emitted; nothing in the covered dungeon range reaches them.
// wake_nearto()/aggravate()/nomul() side effects of MS_TRUMPET, MS_WERE,
// MS_SHRIEK and MS_BONES are likewise not replicated (all RNG-free in C, but
// they do clear msleeping, so a deep-level shrieker would still diverge).
export async function domonnoise(mtmp) {
    const { update_topl, map_invisible } = await import('./display.js');
    const { Monnam, canspotmon } = await import('./uhitm.js');
    if (Deaf_hero()) return ECMD_OK;

    const ptr = mtmp?.data;
    let msound = msound_of(ptr) ?? MS_SILENT;
    // C: `if (is_silent(ptr) && !mtmp->isshk) return ECMD_OK;`
    if (msound === MS_SILENT && !mtmp?.isshk) return ECMD_OK;

    // msound remaps.  The quest-leader (leader_m_id) and MS_GUARDIAN genus
    // remaps need quest_status / genus(); neither is reachable here.
    if (mtmp.isshk) msound = MS_SELL;
    else if (msound === MS_ORC
             && (same_race(ptr, hero_permonst())
                 || same_race(ptr, hero_race_permonst()) || !!game.u?.uhallu))
        msound = MS_HUMANOID;
    else if (msound === MS_MOO && !mtmp.mtame) msound = MS_BELLOW;

    // C: do this BEFORE talking — the monster might teleport away, so the
    // 'I' marker has to go on its pre-teleport square.
    if (!canspotmon(mtmp)) map_invisible(mtmp.mx, mtmp.my);

    const moves = game.moves || 1;
    const hungrytime = mtmp.edog ? (mtmp.edog.hungrytime ?? 0) : 0;
    const fullmoon = phase_of_the_moon() === FULL_MOON;
    let pline_msg = null, verbl_msg = null, verbl_msg_mcan = null;

    switch (msound) {
    case MS_LEADER:
    case MS_NEMESIS:
    case MS_GUARDIAN: {
        const { quest_talk } = await import('./questpgr.js');
        await quest_talk(mtmp);
        return ECMD_TIME;
    }
    case MS_ORACLE: {
        // C ref: sounds.c:724 — the Oracle's whole consultation transaction
        // (rumors.c doconsult), including outrumor()'s BY_ORACLE adverb draws
        // and outoracle()'s rnd(oracle_cnt - 1).
        const { doconsult } = await import('./rumors.js');
        return await doconsult(mtmp);
    }
    case MS_WERE:
        // C: `night() ^ !rn2(13)` — the roll happens either way on a full moon.
        // XOR, so at night the howl needs rn2(13) NON-zero and by day zero.
        if (fullmoon && (!!night() !== !rn2(13))) {
            // C picks "shriek" for &mons[PM_HUMAN_WERERAT]; the human and animal
            // were-forms share a name, so that one needs the PM_ index rather
            // than a name compare and is left as the "howl" default.
            await update_topl(`${Monnam(mtmp)} throws back ${mtmp.female ? 'her' : 'his'}`
                + ' head and lets out a blood curdling howl!');
        } else {
            pline_msg = 'whispers inaudibly.  All you can make out is "moon".';
        }
        break;
    case MS_BARK:
        if (fullmoon && night()) {
            pline_msg = 'howls.';
        } else if (mtmp.mpeaceful) {
            if (mtmp.mtame
                && (mtmp.mconf || mtmp.mflee || mtmp.mtrapped
                    || moves > hungrytime || mtmp.mtame < 5))
                pline_msg = 'whines.';
            else if (mtmp.mtame && hungrytime > moves + 1000)
                pline_msg = 'yips.';
            else if (!is_pm_named(ptr, 'dingo')) /* dingos do not actually bark */
                pline_msg = 'barks.';
        } else {
            pline_msg = 'growls.';
        }
        break;
    case MS_MEW:
        if (mtmp.mtame) {
            if (mtmp.mconf || mtmp.mflee || mtmp.mtrapped || mtmp.mtame < 5)
                pline_msg = 'yowls.';
            else if (moves > hungrytime) pline_msg = 'meows.';
            else if (hungrytime > moves + 1000) pline_msg = 'purrs.';
            else pline_msg = 'mews.';
            break;
        }
        /* FALLTHRU */
    case MS_GROWL:
        pline_msg = mtmp.mpeaceful ? 'snarls.' : 'growls!';
        break;
    case MS_ROAR:
        pline_msg = mtmp.mpeaceful ? 'snarls.' : 'roars!';
        break;
    case MS_SQEEK:
        pline_msg = 'squeaks.';
        break;
    case MS_SQAWK:
        if (is_pm_named(ptr, 'raven') && !mtmp.mpeaceful) verbl_msg = 'Nevermore!';
        else pline_msg = 'squawks.';
        break;
    case MS_HISS:
        if (!mtmp.mpeaceful) pline_msg = 'hisses!';
        else return ECMD_OK; /* no sound */
        break;
    case MS_BUZZ:
        pline_msg = mtmp.mpeaceful ? 'drones.' : 'buzzes angrily.';
        break;
    case MS_GRUNT:
        pline_msg = 'grunts.';
        break;
    case MS_NEIGH:
        if ((mtmp.mtame | 0) < 5) pline_msg = 'neighs.';
        else if (moves > hungrytime) pline_msg = 'whinnies.';
        else pline_msg = 'whickers.';
        break;
    case MS_MOO:
        pline_msg = 'moos.';
        break;
    case MS_BELLOW:
        pline_msg = 'bellows!';
        break;
    case MS_CHIRP:
        pline_msg = 'chirps.';
        break;
    case MS_WAIL:
        pline_msg = 'wails mournfully.';
        break;
    case MS_GROAN:
        if (!rn2(3)) pline_msg = 'groans.';
        break;
    case MS_GURGLE:
        pline_msg = 'gurgles.';
        break;
    case MS_BURBLE:
        pline_msg = 'burbles.';
        break;
    case MS_TRUMPET:
        pline_msg = 'trumpets!';
        break;
    case MS_SHRIEK:
        pline_msg = 'shrieks.';
        break;
    case MS_IMITATE:
        pline_msg = 'imitates you.';
        break;
    case MS_BONES:
        await update_topl(`${Monnam(mtmp)} rattles noisily.`);
        await update_topl('You freeze for a moment.');
        break;
    case MS_LAUGH:
        pline_msg = ['giggles.', 'chuckles.', 'snickers.', 'laughs.'][rn2(4)];
        break;
    case MS_MUMBLE:
        pline_msg = 'mumbles incomprehensibly.';
        break;
    case MS_ORC:
        pline_msg = 'grunts.';
        break;
    case MS_DJINNI:
        if (mtmp.mtame) {
            verbl_msg = "Sorry, I'm all out of wishes.";
        } else if (mtmp.mpeaceful) {
            if (is_pm_named(ptr, 'water demon')) pline_msg = 'gurgles.';
            else verbl_msg = "I'm free!";
        } else {
            // C's PM_PRISONER arm ("Get me out of here.") needs the PM_ index.
            verbl_msg = 'This will teach you not to disturb me!';
        }
        break;
    case MS_BOAST:
        if (!mtmp.mpeaceful) {
            switch (rn2(4)) {
            case 0:
                await update_topl(`${Monnam(mtmp)} boasts about`
                    + ` ${mtmp.female ? 'her' : 'his'} gem collection.`);
                break;
            case 1:
                pline_msg = 'complains about a diet of mutton.';
                break;
            default:
                pline_msg = 'shouts "Fee Fie Foe Foo!" and guffaws.';
                break;
            }
            break;
        }
        /* FALLTHRU */
    case MS_HUMANOID:
        if (!mtmp.mpeaceful) {
            pline_msg = 'threatens you.'; /* (In_endgame mplayer: out of scope) */
            break;
        }
        if (mtmp.mflee) pline_msg = 'wants nothing to do with you.';
        else if (mtmp.mhp < Math.floor(mtmp.mhpmax / 4)) pline_msg = 'moans.';
        else if (mtmp.mconf || mtmp.mstun)
            verbl_msg = !rn2(3) ? 'Huh?' : rn2(2) ? 'What?' : 'Eh?';
        else if (!mtmp.mcansee) verbl_msg = "I can't see!";
        else if (mtmp.mtrapped) verbl_msg = "I'm trapped!";
        else if (mtmp.mhp < Math.floor(mtmp.mhpmax / 2))
            pline_msg = 'asks for a potion of healing.';
        else if (mtmp.mtame && !mtmp.isminion && moves > hungrytime)
            verbl_msg = "I'm hungry.";
        else if (is_elf_flag(ptr)) pline_msg = 'curses orcs.';
        else if (is_dwarf_flag(ptr)) pline_msg = 'talks about mining.';
        else if (likes_magic(ptr)) pline_msg = 'talks about spellcraft.';
        else if (ptr?.mcls === S_CENTAUR_MCLS) pline_msg = 'discusses hunting.';
        else if (is_gnome_flag(ptr)) {
            // C: the South Park gag rolls rn2(4) only while hallucinating, and
            // only odd results speak; the roll must still be drawn.
            const gnomeplan = game.u?.uhallu ? rn2(4) : 0;
            if (game.u?.uhallu && (gnomeplan % 2))
                verbl_msg = (gnomeplan === 1) ? 'Phase one, collect underpants.'
                    : 'Phase three, profit!';
            else
                verbl_msg = 'Many enter the dungeon,'
                    + ' and few return to the sunlit lands.';
        } else if (is_pm_named(ptr, 'hobbit')) {
            pline_msg = (mtmp.mhp < mtmp.mhpmax
                         && (mtmp.mhpmax <= 10 || mtmp.mhp <= mtmp.mhpmax - 10))
                ? 'complains about unpleasant dungeon conditions.'
                : 'asks you about the One Ring.';
        } else if (is_pm_named(ptr, 'archeologist')) {
            pline_msg = 'describes a recent article in "Spelunker Today" magazine.';
        } else if (is_pm_named(ptr, 'tourist')) {
            verbl_msg = 'Aloha.';
        } else {
            pline_msg = 'discusses dungeon exploration.';
        }
        break;
    case MS_SEDUCE: {
        // C: with SYSOPT_SEDUCE (the compiled-in default) a NON-nymph that
        // could_seduce() runs doseduce(); nymphs always fall through to the
        // swval roll.  poly_gender() == mtmp->female skips the rn2(3)
        // entirely, which is the usual case (female hero, female nymph).
        const swval = (poly_gender() !== (mtmp.female | 0)) ? rn2(3) : 0;
        if (swval === 2) verbl_msg = 'Hello, sailor.';
        else if (swval === 1) pline_msg = 'comes on to you.';
        else pline_msg = 'cajoles you.';
        break;
    }
    case MS_ARREST:
        if (mtmp.mpeaceful)
            verbl_msg = `Just the facts, ${game.flags?.female ? "Ma'am" : 'Sir'}.`;
        else
            verbl_msg = ['Anything you say can be used against you.',
                "You're under arrest!", 'Stop in the name of the Law!'][rn2(3)];
        break;
    case MS_BRIBE:
        // C: a peaceful non-tame demon runs demon_talk() (bribe negotiation,
        // not ported); otherwise FALLTHRU into MS_CUSS.
        if (mtmp.mpeaceful && !mtmp.mtame) break;
        /* FALLTHRU */
    case MS_CUSS:
        if (!mtmp.mpeaceful) {
            const { cuss } = await import('./monmove.js');
            await cuss(mtmp); /* rolls its own branch selector */
        } else {
            verbl_msg = "We're all doomed."; /* (is_lminion: out of scope) */
        }
        break;
    case MS_SPELL:
        pline_msg = 'seems to mutter a cantrip.';
        break;
    case MS_NURSE: {
        const { is_weptool } = await import('./invent.js');
        const uwep = game.uwep;
        verbl_msg_mcan = 'I hate this job!';
        if (uwep && (objects[uwep.otyp]?.oc_class === WEAPON_CLASS
                     || is_weptool(uwep)))
            verbl_msg = 'Put that weapon away before you hurt someone!';
        else if (game.uarmc || game.uarm || game.uarmh || game.uarms
                 || game.uarmg || game.uarmf)
            // C picks the Healer-specific line via Role_if(PM_HEALER).
            verbl_msg = ((game.urole?.mnum ?? game.u?.umonnum) === PM_HEALER)
                ? "Doc, I can't help you unless you cooperate."
                : 'Please undress so I can examine you.';
        else if (game.uarmu) verbl_msg = 'Take off your shirt, please.';
        else verbl_msg = "Relax, this won't hurt a bit.";
        break;
    }
    case MS_GUARD:
        verbl_msg = hero_money_cnt()
            ? 'Please drop that gold and follow me.' : 'Please follow me.';
        break;
    case MS_SOLDIER:
        verbl_msg = mtmp.mpeaceful
            ? ["What lousy pay we're getting here!",
                "The food's not fit for Orcs!",
                "My feet hurt, I've been on them all day!"][rn2(3)]
            : ['Resistance is useless!', "You're dog meat!", 'Surrender!'][rn2(3)];
        break;
    default:
        break;
    }

    // C: pline("%s %s", Monnam(mtmp), pline_msg) / verbalize1(verbl_msg).  Both
    // are real plines, so a following monster message appends behind a
    // --More-- instead of overwriting this one.
    if (pline_msg) await update_topl(`${Monnam(mtmp)} ${pline_msg}`);
    else if (mtmp.mcan && verbl_msg_mcan) await update_topl(`"${verbl_msg_mcan}"`);
    else if (verbl_msg) await update_topl(`"${verbl_msg}"`);
    return ECMD_TIME;
}

// ════════════════════════════════════════════════════════════════════════════
// The remainder of sounds.c.  INERT: nothing below is referenced by existing
// code — dosounds()/growl()/yelp()/domonnoise() above keep their own inlined
// copies of the parts they need.  Wiring these in reorders the shared RNG
// stream, so it has to be a separately measured pass.
// ════════════════════════════════════════════════════════════════════════════

// ── local copies of the non-sounds.c helpers these functions need ──
// Each is a private copy on purpose: the one existing port of it is file-static
// in another module, and rule "one file per lane" forbids exporting it there.

// C ref: youprop.h Hallucination.
const Hallucination = () => !!game.u?.uhallu;
// C ref: monst.h:251 helpless(mon) = msleeping || !mcanmove.  mcanmove is
// undefined on some of this port's monster records, where C's default is 1.
function helpless(mon) {
    return !!mon?.msleeping || !(mon?.mcanmove == null ? 1 : mon.mcanmove);
}
// C ref: mondata.h — the plain flag-bit predicates monflags_data.js does not
// already export.
const is_lord = (ptr) => (mflags2_of(ptr) & M2_LORD) !== 0;
const is_prince = (ptr) => (mflags2_of(ptr) & M2_PRINCE) !== 0;
const is_flyer = (ptr) => (mflags1_of(ptr) & M1_FLY) !== 0;
const is_undead = (ptr) => (mflags2_of(ptr) & M2_UNDEAD) !== 0;
const carnivorous = (ptr) => (mflags1_of(ptr) & M1_CARNIVORE) !== 0;
const herbivorous = (ptr) => (mflags1_of(ptr) & M1_HERBIVORE) !== 0;
const haseyes = (ptr) => (mflags1_of(ptr) & M1_NOEYES) === 0;
const perceives = (ptr) => (mflags1_of(ptr) & M1_SEE_INVIS) !== 0;
// C ref: mondata.h:62 is_silent(ptr) = msound == MS_SILENT.
const is_silent = (ptr) => (msound_of(ptr) ?? MS_SILENT) === MS_SILENT;
// C ref: monst.h:217 is_vampshifter(mon) — cham is one of the three vampire
// forms.  Compared by name because there is no PM_ table in this port.
function is_vampshifter(mon) {
    const nm = monster_by_pmidx(mon?.cham ?? -1)?.name;
    return nm === 'vampire' || nm === 'vampire leader'
        || nm === 'Vlad the Impaler';
}
// C ref: you.h:316 uhis() = genders[flags.female].his.
const uhis = () => (game.flags?.female ? 'her' : 'his');
// C ref: monst.h mhis(mon).
const mhis = (mon) => (mon?.female ? 'her' : 'his');
// C ref: hack.h:1493 ROLL_FROM(array) = array[rn2(SIZE(array))].
const ROLL_FROM = (arr) => arr[rn2(arr.length)];
// C ref: hack.h letter(c) — an ASCII letter; temple_priest_sound() uses it to
// step past the leading '*'/'#' control flags in temple_msg[].
const letter = (c) => /[A-Za-z]/.test(c || '');
// C ref: hack.h:558 next2u(x,y) = distu(x,y) <= 2.
function next2u(x, y) {
    const u = game.u;
    return ((x - (u?.ux ?? 0)) ** 2 + (y - (u?.uy ?? 0)) ** 2) <= 2;
}
// C ref: rm.h accessible(x,y) = ACCESSIBLE(levl[x][y].typ) && !closed_door(x,y).
function accessible(x, y) {
    const loc = game.level?.at?.(x, y);
    if (!loc) return false;
    return ACCESSIBLE(loc.typ) && !closed_door(x, y);
}
// C ref: rm.h closed_door(x,y) = IS_DOOR(typ) && (doormask & (D_LOCKED|D_CLOSED)).
const D_CLOSED_SND = 0x04, D_LOCKED_SND = 0x08, DOOR_TYP_SND = 23;
function closed_door(x, y) {
    const loc = game.level?.at?.(x, y);
    return !!loc && loc.typ === DOOR_TYP_SND
        && (loc.doormask & (D_LOCKED_SND | D_CLOSED_SND)) !== 0;
}
// C ref: objnam.c vtense(subj, verb) — `verb` arrives in the plural.  Same
// reduced port as js/dothrow.js's copy: the only subjects passed here are
// body_part() nouns, which trip none of the special_subjs[] false matches.
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
    return vtense_sing_snd(verb);
}
// C ref: monsym.h S_ANT / S_EEL — mons[].mlet values.  makemon.js keeps the
// numeric class index in `mcls` (`mlet` there is the display CHARACTER), so
// every C `ptr->mlet == S_FOO` test reads `ptr.mcls` here.
const S_ANT_MCLS = 1, S_EEL_MCLS = 57;
// C ref: priest.c inhistemple(priest) — the priest is standing in its own
// temple and that temple still holds a correctly aligned shrine.  The shrine
// re-read is delegated to priest.js via a dynamic import at the call site.
function histemple_at(priest, x, y) {
    const rmno = game.level?.at?.(x, y)?.roomno ?? 0;
    const sl = priest?.epri?.shrlevel, uz = game.u?.uz;
    const samelevel = !sl || !uz
        || (sl.dnum === uz.dnum && sl.dlevel === uz.dlevel);
    return rmno !== 0 && rmno === priest?.epri?.shroom && samelevel;
}
// C ref: priest.c has_shrine(priest) — the altar square still carries AM_SHRINE
// and its alignment still matches the priest's.
const AM_SHRINE_SND = 0x08, AM_MASK_SND = 0x07, ALTAR_TYP_SND = 21;
function has_shrine(priest) {
    const sp = priest?.epri?.shrpos;
    const loc = sp ? game.level?.at?.(sp.x, sp.y) : null;
    if (!loc || loc.typ !== ALTAR_TYP_SND) return false;
    if (!(loc.altarmask & AM_SHRINE_SND)) return false;
    // C ref: align.h Amask2align(mask) — A_NONE for the unaligned mask.
    const m = loc.altarmask & AM_MASK_SND;
    const al = (m === 0) ? A_NONE : ((m & 4) ? 1 : (m & 2) ? 0 : -1);
    return al === priest.epri.shralign;
}
function inhistemple(priest) {
    if (!priest || !priest.ispriest) return false;
    if (!histemple_at(priest, priest.mx, priest.my)) return false;
    return has_shrine(priest);
}
// C ref: pray.c halu_gname(alignment) — a random god while hallucinating,
// otherwise align_gname().  GAP: the hallucinating branch draws randrole(TRUE)
// plus rn2_on_display_rng(9) (and possibly a second display draw); this port
// does not model the DISPLAY rng, so the sober name is used either way.  No
// core-stream draw is skipped by that.
async function halu_gname(alignment) {
    const { align_gname } = await import('./role.js');
    return align_gname(game.urole?.mnum ?? game.u?.umonnum ?? 0, alignment);
}

// C ref: sounds.c:20 mon_in_room(mon, rmtyp) — is the monster standing in a
// room of the given rtype?
export function mon_in_room(mon, rmtyp) {
    const rno = game.level?.at?.(mon?.mx, mon?.my)?.roomno ?? 0;
    if (rno >= ROOMOFFSET)
        return game.level?.rooms?.[rno - ROOMOFFSET]?.rtype === rmtyp;
    return false;
}

// C ref: sounds.c:35 throne_msg[4].  Entry 2 is a pline() with uhis(), not a
// You_hear(), and is only reachable while hallucinating (rn2(3) + hallu == 2
// needs hallu, or rn2(3)==2 with hallu==0 -> index 2 as well).
const THRONE_MSG = [
    'the tones of courtly conversation.',
    'a sceptre pounded in judgment.',
    'Someone shouts "Off with %s head!"',
    "Queen Beruthiel's cats!",
];

// C ref: sounds.c:30 throne_mon_sound(mtmp) — get_iter_mons() predicate for
// level.flags.has_court.  Draws rn2(3) only for a qualifying monster.
export async function throne_mon_sound(mtmp) {
    const ptr = mtmp?.data;
    if ((mtmp.msleeping || is_lord(ptr) || is_prince(ptr)) && !is_animal(ptr)
        && mon_in_room(mtmp, COURT)) {
        const which = rn2(3) + (Hallucination() ? 1 : 0);
        if (which !== 2) {
            await You_hear1(THRONE_MSG[which]);
        } else {
            await update_topl(THRONE_MSG[2].replace('%s', uhis()));
        }
        return true;
    }
    return false;
}

// C ref: sounds.c:62 beehive_mon_sound(mtmp) — level.flags.has_beehive.
export async function beehive_mon_sound(mtmp) {
    const ptr = mtmp?.data;
    if ((ptr?.mcls === S_ANT_MCLS && is_flyer(ptr))
        && mon_in_room(mtmp, BEEHIVE)) {
        const hallu = Hallucination() ? 1 : 0;
        switch (rn2(2) + hallu) {
        case 0:
            await You_hear1('a low buzzing.');
            break;
        case 1:
            await You_hear1('an angry drone.');
            break;
        case 2:
            await You_hear1(`bees in your ${game.uarmh ? '' : '(nonexistent) '}bonnet!`);
            break;
        }
        return true;
    }
    return false;
}

// C ref: sounds.c:88 morgue_mon_sound(mtmp) — level.flags.has_morgue.  Note
// body_part(HAIR) is evaluated BEFORE the rn2(2), but it draws nothing.
export async function morgue_mon_sound(mtmp) {
    const ptr = mtmp?.data;
    if ((is_undead(ptr) || is_vampshifter(mtmp))
        && mon_in_room(mtmp, MORGUE)) {
        const { body_part } = await import('./polyself.js');
        const hallu = Hallucination() ? 1 : 0;
        const hair = body_part(HAIR); /* hair/fur/scales */
        switch (rn2(2) + hallu) {
        case 0:
            await You1('suddenly realize it is unnaturally quiet.');
            break;
        case 1:
            await update_topl(`The ${hair} on the back of your ${body_part(NECK)}`
                + ` ${vtense(hair, 'stand')} up.`);
            break;
        case 2:
            await update_topl(`The ${hair} on your ${body_part(HEAD)}`
                + ` ${vtense(hair, 'seem')} to stand up.`);
            break;
        }
        return true;
    }
    return false;
}

// C ref: sounds.c:120 zoo_msg[3].
const ZOO_MSG = [
    'a sound reminiscent of an elephant stepping on a peanut.',
    'a sound reminiscent of a seal barking.', 'Doctor Dolittle!',
];

// C ref: sounds.c:114 zoo_mon_sound(mtmp) — level.flags.has_zoo.
export async function zoo_mon_sound(mtmp) {
    const ptr = mtmp?.data;
    if ((mtmp.msleeping || is_animal(ptr)) && mon_in_room(mtmp, ZOO)) {
        const hallu = Hallucination() ? 1 : 0, selection = rn2(2) + hallu;
        await You_hear1(ZOO_MSG[selection]);
        return true;
    }
    return false;
}

// C ref: sounds.c:146 temple_msg[4] — '*' means the priest must be able to
// speak, '#' means the priest and altar must not be directly visible.
const TEMPLE_MSG = [
    '*someone praising %s.', '*someone beseeching %s.',
    '#an animal carcass being offered in sacrifice.',
    '*a strident plea for donations.',
];

// C ref: sounds.c:130 temple_priest_sound(mtmp) — level.flags.has_temple.
// The DRAW COUNT here is variable: the do/while retries rn2(SIZE-1+hallu)
// until it lands on an acceptable message, up to 50 times, and the 50th draw
// is used even if unacceptable.  A speechless priest (msound <= MS_ANIMAL) or
// a visible altar therefore costs extra rn2(3) draws.
export async function temple_priest_sound(mtmp) {
    const { temple_occupied } = await import('./priest.js');
    const { canseemon_shared: canseemon } = await import('./display.js');
    const { cansee } = await import('./vision.js');
    const epri = mtmp?.epri;
    if (mtmp?.ispriest && inhistemple(mtmp)
        /* priest must be active */
        && !helpless(mtmp)
        /* hero must be outside this temple */
        && temple_occupied(game.u?.urooms || []) !== epri?.shroom) {
        const hallu = Hallucination() ? 1 : 0;
        let trycount = 0;
        const ax = epri.shrpos?.x, ay = epri.shrpos?.y;
        const speechless = (msound_of(mtmp.data) ?? MS_SILENT) <= MS_ANIMAL;
        const in_sight = canseemon(mtmp) || cansee(ax, ay);
        let msg;
        do {
            msg = TEMPLE_MSG[rn2(TEMPLE_MSG.length - 1 + hallu)];
            if (msg.includes('*') && speechless) continue;
            if (msg.includes('#') && in_sight) continue;
            break; /* msg is acceptable */
        } while (++trycount < 50);
        let i = 0;
        while (!letter(msg[i])) ++i; /* skip control flags */
        msg = msg.slice(i);
        if (msg.includes('%'))
            await You_hear1(msg.replace('%s', await halu_gname(epri.shralign)));
        else
            await You_hear1(msg);
        return true;
    }
    return false;
}

// C ref: sounds.c:189 ora_msg[5] — indexed rn2(3) + hallu*2, so a sober hero
// only ever hears the first three and a hallucinating one entries 2..4.
const ORA_MSG = [
    'a strange wind.',     /* Jupiter at Dodona */
    'convulsive ravings.', /* Apollo at Delphi */
    'snoring snakes.',     /* AEsculapius at Epidaurus */
    'someone say "No more woodchucks!"',
    'a loud ZOT!',         /* both rec.humor.oracle */
];

// C ref: sounds.c:180 oracle_sound(mtmp) — returns TRUE (ending dosounds'
// get_iter_mons walk) for the Oracle even when she is plainly visible and no
// message is produced, so the rn2(3) is conditional but the walk stops anyway.
export async function oracle_sound(mtmp) {
    if (!is_pm_named(mtmp?.data, 'Oracle')) return false;
    const { canseemon_shared: canseemon } = await import('./display.js');
    /* and don't produce silly effects when she's clearly visible */
    if (Hallucination() || !canseemon(mtmp)) {
        const hallu = Hallucination() ? 1 : 0;
        await You_hear1(ORA_MSG[rn2(3) + hallu * 2]);
    }
    return true;
}

// C ref: sounds.c:350 growl_sound(mtmp) — RNG-free.  NOTE the two arms the
// inlined switch in growl() above is missing: MS_BELLOW -> "bellow" (a
// crocodile "screams" there instead) and MS_SILENT -> "commotion".
export function growl_sound(mtmp) {
    let ret;
    switch (msound_of(mtmp?.data) ?? MS_SILENT) {
    case MS_MEW:
    case MS_HISS:
        ret = 'hiss';
        break;
    case MS_BARK:
    case MS_GROWL:
        ret = 'growl';
        break;
    case MS_ROAR:
        ret = 'roar';
        break;
    case MS_BELLOW:
        ret = 'bellow';
        break;
    case MS_BUZZ:
        ret = 'buzz';
        break;
    case MS_SQEEK:
        ret = 'squeal';
        break;
    case MS_SQAWK:
        ret = 'screech';
        break;
    case MS_NEIGH:
        ret = 'neigh';
        break;
    case MS_WAIL:
        ret = 'wail';
        break;
    case MS_GROAN:
        ret = 'groan';
        break;
    case MS_MOO:
        ret = 'low';
        break;
    case MS_SILENT:
        ret = 'commotion';
        break;
    default:
        ret = 'scream';
    }
    return ret;
}

// C ref: sounds.c:478 whimper(mtmp) — the sounds of distressed pets
// (dogmove.c:1201 leashed-pet drag, apply.c:985 whip/leash abuse).  Under
// Hallucination the verb is a REAL rn2(35) draw on the core stream.  The
// message ends in '.', not '!' (growl()/yelp() use '!').
export async function whimper(mtmp) {
    const { Monnam } = await import('./uhitm.js');
    const ptr = mtmp?.data;
    let whimper_verb = 0;
    if (helpless(mtmp) || !(msound_of(ptr) ?? MS_SILENT)) return;

    /* presumably nearness and soundok checks have already been made */
    if (Hallucination()) {
        whimper_verb = ROLL_FROM(H_SOUNDS);
    } else {
        switch (msound_of(ptr)) {
        case MS_MEW:
        case MS_GROWL:
            whimper_verb = 'whimper';
            break;
        case MS_BARK:
            whimper_verb = 'whine';
            break;
        case MS_SQEEK:
            whimper_verb = 'squeal';
            break;
        }
    }
    if (whimper_verb) {
        await update_topl(`${Monnam(mtmp)} ${vtense_sing_snd(whimper_verb)}.`);
        const { nomul } = await import('./hack.js');
        if (game.context?.run) nomul(0);
        const { wake_nearto } = await import('./cmd.js');
        await wake_nearto(mtmp.mx, mtmp.my, (ptr?.mlevel ?? 0) * 6);
    }
}

// C ref: sounds.c:518 beg(mtmp) — a hungry pet's "I'm hungry" noises
// (dogmove.c:383).  RNG-free itself, but the domonnoise() hand-off is not.
export async function beg(mtmp) {
    const { Monnam, canspotmon } = await import('./uhitm.js');
    const { map_invisible } = await import('./display.js');
    const ptr = mtmp?.data;
    if (helpless(mtmp) || !(carnivorous(ptr) || herbivorous(ptr)))
        return;

    /* presumably nearness and soundok checks have already been made */
    if (!is_silent(ptr) && (msound_of(ptr) ?? MS_SILENT) <= MS_ANIMAL) {
        await domonnoise(mtmp);
    } else if ((msound_of(ptr) ?? MS_SILENT) >= MS_HUMANOID) {
        if (!canspotmon(mtmp)) map_invisible(mtmp.mx, mtmp.my);
        set_voice(mtmp, 0, 80, 0);
        await update_topl('"I\'m hungry."'); /* verbalize() */
    } else {
        /* covers the MS_* block between animal and humanoid, plus MS_SILENT */
        if (canspotmon(mtmp))
            await update_topl(`${Monnam(mtmp)} seems famished.`);
    }
}

// C ref: sounds.c:548 Exclam[5] — ROLL_FROM(), i.e. rn2(5).
const EXCLAM = ['Gasp!', 'Uh-oh.', 'Oh my!', 'What?', 'Why?'];

// C ref: sounds.c:545 maybe_gasp(mon) — mon.c:4188, a bystander's reaction to
// the hero attacking a peaceful.  Draws rn2(5) ONLY when the switch sets
// dogasp, so which MS_* arm the bystander lands in decides whether the core
// stream advances at all.
export function maybe_gasp(mon) {
    const mptr = mon?.data;
    let msound = msound_of(mptr) ?? MS_SILENT;
    let dogasp = false;

    /* other roles' guardians and cross-aligned priests don't gasp */
    if ((msound === MS_GUARDIAN && mptr?.pmidx !== game.urole?.guardnum)
        || (msound === MS_PRIEST && !p_coaligned_snd(mon)))
        msound = MS_SILENT;
    /* co-aligned angels do gasp */
    else if (msound === MS_CUSS && !!mon?.emin
             && (p_coaligned_snd(mon) ? !mon.emin.renegade : !!mon.emin.renegade))
        msound = MS_HUMANOID;

    /* Only called for humanoids so animal noise handling is ignored. */
    switch (msound) {
    case MS_HUMANOID:
    case MS_ARREST:   /* Kops */
    case MS_SOLDIER:  /* soldier, watchman */
    case MS_GUARD:    /* vault guard */
    case MS_NURSE:
    case MS_SEDUCE:   /* nymph, succubus/incubus */
    case MS_LEADER:   /* quest leader */
    case MS_GUARDIAN: /* leader's guards */
    case MS_SELL:     /* shopkeeper */
    case MS_ORACLE:
    case MS_PRIEST:   /* temple priest, roaming aligned priest */
    case MS_BOAST:    /* giants */
    case MS_IMITATE:  /* doppelganger, leocrotta, Aleax */
        dogasp = true;
        break;
    /* issue comprehensible word(s) if hero is similar type of creature */
    case MS_ORC:      /* used to be synonym for MS_GRUNT */
    case MS_GRUNT:    /* ogres, trolls, gargoyles, one or two others */
    case MS_LAUGH:    /* leprechaun, gremlin */
    case MS_ROAR:     /* dragon, xorn, owlbear */
    case MS_BELLOW:   /* crocodile */
    /* capable of speech but only do so if hero is similar type */
    case MS_DJINNI:
    case MS_VAMPIRE:  /* vampire in its own form */
    case MS_WERE:     /* lycanthrope in human form */
    case MS_SPELL:    /* titan, barrow wight, Nazgul, nalfeshnee */
        dogasp = (mptr?.mcls === youmonst_data_snd()?.mcls);
        break;
    /* capable of speech but don't care if you attack peacefuls */
    case MS_BRIBE:
    case MS_CUSS:
    case MS_RIDER:
    case MS_NEMESIS:
    /* can't speak */
    case MS_SILENT:
    default:
        break;
    }
    if (dogasp)
        return ROLL_FROM(EXCLAM); /* [mon->m_id % SIZE(Exclam)]; */
    return null;
}

// C ref: gy.youmonst.data == &mons[u.umonnum].  Mirrors js/invent.js
// youmonst_data(): u.umonnum holds the 0-based ROLE index in this port, so an
// un-poly'd hero needs the PM_ARCHEOLOGIST (331) offset.  hero_permonst()
// above skips that offset — it reads mons[role index], which is a jackal for a
// Wizard — so maybe_gasp() does not reuse it.
function youmonst_data_snd() {
    const u = game.u;
    if (u?.Upolyd) return monster_by_pmidx(u.umonnum) || u?.data || null;
    return monster_by_pmidx(331 + (u?.umonnum ?? 0)) || u?.data || null;
}

// C ref: priest.c p_coaligned(priest) — EPRI(priest)->shralign matches
// u.ualign.type.  Duplicated here (not imported) so maybe_gasp() can stay
// synchronous the way C's is.
function p_coaligned_snd(priest) {
    return (priest?.epri?.shralign ?? A_NONE) === (game.u?.ualign?.type ?? 0);
}

// C ref: sounds.c:616 cry_sound(mtmp) — for egg hatching (timeout.c:1121);
// the caller applies the "ing" suffix.  RNG-free.
export function cry_sound(mtmp) {
    let ret = 0;
    const ptr = mtmp?.data;

    switch (msound_of(ptr) ?? MS_SILENT) {
    default:
    case MS_SILENT: /* insects, arthropods, worms, sea creatures */
        /* "chitter": have silent critters make some noise or the
           mommy/daddy gag when hatching doesn't work */
        ret = (ptr?.mcls === S_EEL_MCLS) ? 'gurgle' : 'chitter';
        break;
    case MS_HISS:   /* chickatrice, pyrolisk, snakes */
        ret = 'hiss';
        break;
    case MS_ROAR:   /* baby dragons; have them growl instead of roar */
    case MS_GROWL:  /* (none) */
        ret = 'growl';
        break;
    case MS_CHIRP:  /* adult crocodiles bellow, babies chirp */
        ret = 'chirp';
        break;
    case MS_BUZZ:   /* killer bees */
        ret = 'buzz';
        break;
    case MS_SQAWK:  /* ravens */
        ret = 'screech';
        break;
    case MS_GRUNT:  /* gargoyles */
        ret = 'grunt';
        break;
    case MS_MUMBLE: /* naga hatchlings */
        ret = 'mumble';
        break;
    }
    return ret;
}

// C ref: sounds.c:658 mon_is_gecko(mon) — domonnoise()'s hallucinatory
// "everything is a shopkeeper" gag.  RNG-free.
// GAP: C's third test reads the map GLYPH, which is a gecko only through
// hallucination (a display-rng monster name) or a gecko-shaped mimic.  This
// port has no glyph layer, so only the mimic half is modelled.
export function mon_is_gecko(mon) {
    /* return True if it is actually a gecko */
    if (is_pm_named(mon?.data, 'gecko')) return true;
    /* return False if it is a long worm; we might be chatting to its tail
       (not strictly needed; long worms are MS_SILENT so won't get here) */
    if (is_pm_named(mon?.data, 'long worm')) return false;
    /* result depends upon whether map spot shows a gecko, which will
       be due to hallucination or to mimickery since mon isn't one */
    if (m_ap_type_of(mon) === M_AP_MONSTER)
        return is_pm_named(monster_by_pmidx(mon.mappearance), 'gecko');
    return false;
}

// C ref: monst.h M_AP_TYPE(mon).  js/makemon.js stores the mimic appearance
// type as the STRINGS 'obj'/'furniture' while js/dogmove.js quickmimic() stores
// the numeric M_AP_* — accept both rather than answer FALSE for half the tree.
function m_ap_type_of(mon) {
    const t = mon?.m_ap_type;
    if (t === 'obj') return M_AP_OBJECT;
    if (t === 'furniture') return M_AP_FURNITURE;
    if (t === 'mon' || t === 'monster') return M_AP_MONSTER;
    return t | 0;
}

// C ref: sounds.c:1247 dotalk() — the #chat command; a bare wrapper around
// dochat(), whose single port lives in js/extcmd-handlers.js (reached here
// through its exported name dispatcher rather than duplicated).
export async function dotalk() {
    const { run_extcmd_by_name } = await import('./extcmd-handlers.js');
    const result = await run_extcmd_by_name('chat'); /* == dochat() */
    return result;
}

// C ref: sounds.c:1412 responsive_mon_at(x, y) — a monster that can see the
// hero and react.  RNG-free.
export function responsive_mon_at(x, y) {
    let mtmp = isok(x, y) ? m_at(x, y) : null;

    if (mtmp && (helpless(mtmp) /* immobilized monst */
                 || !mtmp.mcansee || !haseyes(mtmp.data) /* blind monst */
                 || (Invis_hero() && !perceives(mtmp.data)) /* unseen hero */
                 || (x !== mtmp.mx || y !== mtmp.my))) /* worm tail */
        mtmp = null;
    return mtmp;
}
// C ref: youprop.h Invisible — HInvis || EInvis.  responsive_mon_at only cares
// whether the MONSTER can see through it, so See_invisible is not consulted.
const Invis_hero = () => !!(game.u?.uprops?.HInvis || game.u?.uprops?.EInvis
                            || game.u?.uinvis);

// C ref: sounds.c:1518 reaction[3] — tiphat()'s hostile-humanoid gestures.
const TIPHAT_REACTION = ['curses', 'gestures rudely', 'gestures offensively'];

// C ref: sounds.c:1426 tiphat() — the hero doffs uarmh at a monster
// (pickup.c:3671 #tip with the worn helmet chosen).  RNG: rn2(3) for the
// gesture (rn1(2,1) when Deaf, which never picks "curses"), then rn2(3) for
// whether a SECOND gesture follows and rn1(2,1) to pick it.  The
// `Deaf || which > 0 || rn2(3)` short-circuit means that second rn2(3) is
// drawn ONLY when the hero is not Deaf and the first gesture was "curses".
export async function tiphat() {
    const { Monnam } = await import('./uhitm.js');
    const { helm_simple_name } = await import('./do_wear.js');
    const { which_armor } = await import('./worn.js');
    const { Conflict } = await import('./monmove.js');
    const { getdir } = await import('./cmd.js');
    const { couldsee } = await import('./vision.js');
    const u = game.u;
    const uarmh = game.uarmh;
    let mtmp, otmp, x, y, range, vismon, unseen, statue, res;

    if (!uarmh) /* can't get here from there */
        return 0;

    res = uarmh.bknown ? 0 : 1;
    if (await cursed_worn(uarmh)) /* "You can't.  It is cursed." */
        return res; /* if learned of curse, use a move */

    /* might choose a position, but dealing with direct lines is simpler */
    const dir = await getdir('At whom? (in what direction)');
    if (!dir) /* bail on ESC */
        return res; /* iffy; now know it's not cursed for sure (since we got
                     * past prior test) but might have already known that */
    u.dx = dir.dx; u.dy = dir.dy; u.dz = dir.dz || 0;
    res = 1; /* physical action is going to take place */

    /* most helmets have a short wear/take-off delay and we could set
       'multi' to account for that, but we'll pretend that no extra time
       beyond the current move is necessary */
    await You1(`briefly doff your ${helm_simple_name(uarmh)}.`);

    if (!u.dx && !u.dy) {
        if (u.usteed && u.dz > 0) {
            if (helpless(u.usteed))
                await update_topl(`${Monnam(u.usteed)} doesn't notice.`);
            else
                await domonnoise(u.usteed);
        } else if (u.dz) {
            await update_topl(`There's no one ${(u.dz < 0) ? 'up' : 'down'} there.`);
        } else {
            await update_topl("The lout here doesn't acknowledge you...");
        }
        return res;
    }

    mtmp = null;
    vismon = unseen = statue = 0;
    x = u.ux; y = u.uy;
    for (range = 1; range <= BOLT_LIM + 1; ++range) {
        x += u.dx; y += u.dy;
        if (!isok(x, y) || (range > 1 && !couldsee(x, y))) {
            /* switch back to coordinates for previous iteration's 'mtmp' */
            x -= u.dx; y -= u.dy;
            break;
        }
        mtmp = m_at(x, y);
        vismon = (mtmp && canseemon_shared(mtmp)) ? 1 : 0;
        // C: glyph = glyph_at(x, y); unseen = glyph_is_invisible(glyph);
        unseen = game.level?.at?.(x, y)?.invisMon ? 1 : 0;
        // C: statue = glyph_is_statue(glyph) (a mimic or hallucinatory statue)
        // || (!vismon && !unseen && vobj_at(x,y) is a STATUE).  GAP: without a
        // glyph layer only the real-statue half is available.
        statue = (!vismon && !unseen && (otmp = vobj_at(x, y)) != null
                  && otmp.otyp === STATUE) ? 1 : 0;
        if (vismon && (m_ap_type_of(mtmp) === M_AP_FURNITURE
                       || m_ap_type_of(mtmp) === M_AP_OBJECT)) {
            vismon = 0; mtmp = null;
        }
        if (vismon || unseen || (statue && Hallucination())
            /* unseen adjacent monster will respond if able */
            || (range === 1 && mtmp && responsive_mon_at(x, y)
                && !is_silent(mtmp.data))
            /* we check accessible() after m_at() in case there's a
               visible monster phazing through a wall here */
            || !(accessible(x, y)
                 || game.level?.at?.(x, y)?.typ === IRONBARS))
            break;
    }

    let nada = false;
    if (unseen || (statue && Hallucination())) {
        await update_topl(`That ${unseen ? 'unseen ' : ''}creature is ignoring you!`);
    } else if (!mtmp || !responsive_mon_at(x, y)) {
        if (vismon) /* 'vismon' is only True when 'mtmp' is non-Null */
            await update_topl(`${Monnam(mtmp)} seems not to notice you.`);
        else
            nada = true;
    } else { /* 'mtmp' is guaranteed to be non-Null if we get here */
        /* if this monster is waiting for something, prod it into action */
        mtmp.mstrategy = (mtmp.mstrategy ?? 0) & ~STRAT_WAITMASK;

        if (vismon && humanoid(mtmp.data) && mtmp.mpeaceful && !Conflict()) {
            if ((otmp = which_armor(mtmp, W_ARMH)) == null) {
                await update_topl(`${Monnam(mtmp)} waves.`);
            } else if (otmp.cursed) {
                await update_topl(`${Monnam(mtmp)} grasps ${mhis(mtmp)}`
                    + ` ${helm_simple_name(otmp)} but can't remove it.`);
                otmp.bknown = 1;
            } else {
                await update_topl(`${Monnam(mtmp)} tips ${mhis(mtmp)}`
                    + ` ${helm_simple_name(otmp)} in response.`);
            }
        } else if (vismon && humanoid(mtmp.data)) {
            const deaf = Deaf_hero();
            const which = !deaf ? rn2(3) : rn1(2, 1);
            const twice = (deaf || which > 0 || rn2(3)) ? 0 : rn1(2, 1);

            await update_topl(`${Monnam(mtmp)} ${TIPHAT_REACTION[which]}`
                + `${twice ? ' and ' : ''}${twice ? TIPHAT_REACTION[twice] : ''}`
                + ' at you...');
        } else if (next2u(x, y) && !Deaf_hero() && await domonnoise(mtmp)) {
            if (!vismon) map_invis_snd(x, y);
        } else if (vismon) {
            await update_topl(`${Monnam(mtmp)} doesn't respond.`);
        } else {
            nada = true;
        }
    }
    if (nada)
        await update_topl(nothing_happens);
    return res;
}

// C ref: do_wear.c:1893 cursed(otmp) — "Check if something worn is cursed _and_
// unremovable"; prints the refusal and learns the curse.  Local copy: the
// do_wear.js port has no equivalent, and tiphat() needs the return value.
// The Glib ("slippery fingers") arm is kept for order but Glib is never set in
// the modelled state.
const LENSES_SND = 232; // C ref: include/objects.h otyp for lenses.
async function cursed_worn(otmp) {
    if (!otmp) return 0;
    /* Curses, like chickens, come home to roost.  (uwep takes welded(), which
       only differs for a cursed-and-wielded weapon; uarmh is never uwep.) */
    if (!!otmp.cursed) {
        const { is_boots, is_gloves } = await import('./do_wear.js');
        const use_plural = (is_boots(otmp) || is_gloves(otmp)
                            || otmp.otyp === LENSES_SND || otmp.quan > 1);
        await You1(`can't.  ${use_plural ? 'They are' : 'It is'} cursed.`);
        otmp.bknown = 1;
        return 1;
    }
    return 0;
}

// ── USER_SOUNDS: message -> sound-file mappings from the config file ─────────
// C ref: sounds.c:1541 audio_mapping / soundmap.  RNG-free and output-free;
// the recorder build plays no sound, so these only ever affect whether a
// SOUND config line is accepted (add_sound_mapping's return value).

let soundmap = null;      /* C: static audio_mapping *soundmap */
export let sounddir = null; /* C: char *sounddir, set in files.c */

// C ref: sounds.c:1555 add_sound_mapping(mapping) — 0 on failure, 1 on success.
// The four sscanf() forms are tried in order; the first that fully matches
// wins, which is what decides whether the optional msgtype and trailing idx
// are present.  can_read_file() is not available in this port, so a mapping
// without an explicit idx is accepted rather than rejected (it would only
// matter for the raw_print("cannot read ...") config error).
export function add_sound_mapping(mapping) {
    let text = null, filename = null, msgtyp = '', volume = 0, idx = -1;
    let m;
    // MESG "text" "file" vol idx
    if ((m = /^MESG "([^"]{0,255})"[\t ]+"([^"]{0,255})" +(-?\d+) +(-?\d+)/.exec(mapping))) {
        text = m[1]; filename = m[2]; volume = parseInt(m[3], 10);
        idx = parseInt(m[4], 10);
    // MESG msgtyp "text" "file" vol idx
    } else if ((m = /^MESG ([^"]{1,10})"([^"]{0,255})"[\t ]+"([^"]{0,255})" +(-?\d+) +(-?\d+)/.exec(mapping))) {
        msgtyp = m[1].trim(); text = m[2]; filename = m[3];
        volume = parseInt(m[4], 10); idx = parseInt(m[5], 10);
    // MESG msgtyp "text" "file" vol
    } else if ((m = /^MESG ([^"]{1,10})"([^"]{0,255})"[\t ]+"([^"]{0,255})" +(-?\d+)/.exec(mapping))) {
        msgtyp = m[1].trim(); text = m[2]; filename = m[3];
        volume = parseInt(m[4], 10);
    // MESG "text" "file" vol
    } else if ((m = /^MESG "([^"]{0,255})"[\t ]+"([^"]{0,255})" +(-?\d+)/.exec(mapping))) {
        text = m[1]; filename = m[2]; volume = parseInt(m[3], 10);
    } else {
        raw_print_snd('syntax error in SOUND');
        return 0;
    }

    if (!sounddir) sounddir = '.';
    const filespec = `${sounddir}/${filename}`;
    if (filespec.length >= 256) {
        raw_print_snd('sound file name too long');
        return 0;
    }
    const new_map = {
        regex: compile_nhregex(text), filename: filespec, volume, idx,
        next: soundmap,
    };
    if (!new_map.regex) {
        raw_print_snd(`regex error in "${text}"`);
        return 0;
    }
    if (msgtyp) {
        // C: msgtype_parse_add("<msgtyp> \"<text>\"")
        msgtype_parse_add_snd(`${msgtyp} "${text}"`);
    }
    soundmap = new_map;
    return 1;
}

// C ref: sounds.c:1628 sound_matches_message(msg) — first mapping whose regex
// matches, walking the list newest-first.
export function sound_matches_message(msg) {
    let snd = soundmap;
    while (snd) {
        if (snd.regex.test(msg)) return snd;
        snd = snd.next;
    }
    return null;
}

// C ref: sounds.c:1641 play_sound_for_message(msg) — skip the regex search
// entirely when the soundlib has no usersound hook.
export function play_sound_for_message(msg) {
    if (soundprocs.sound_play_usersound) {
        const snd = sound_matches_message(msg);
        if (snd)
            soundprocs.sound_play_usersound(snd.filename, snd.volume, snd.idx);
    }
}

// C ref: sounds.c:1658 maybe_play_sound(msg) — byte-identical to
// play_sound_for_message() in the C source; kept separate to match.
export function maybe_play_sound(msg) {
    if (soundprocs.sound_play_usersound) {
        const snd = sound_matches_message(msg);
        if (snd)
            soundprocs.sound_play_usersound(snd.filename, snd.volume, snd.idx);
    }
}

// C ref: sounds.c:1675 release_sound_mappings() — save.c's shutdown path.
export function release_sound_mappings() {
    while (soundmap) soundmap = soundmap.next;
    if (sounddir) sounddir = null;
}

// C ref: sys/share/nhregex.c regex_compile() — the config-file SOUND patterns
// are POSIX basic REs; JS RegExp is close enough for the accept/reject decision
// and returns null (a compile failure) on a malformed pattern the same way.
function compile_nhregex(text) {
    try { return new RegExp(text); } catch (e) { return null; }
}
// C ref: options.c msgtype_parse_add(str) — the MESG form's optional message
// type prefix is registered as a msgtype rule.  Not ported (msgtype has no
// port); recorded so a later pass can see the hand-off point.
function msgtype_parse_add_snd(_str) { return 0; }
// C ref: pline.c raw_print(str) — a pre-window-init error line.  Config errors
// in this port go through cfgfiles.js; this local stub keeps add_sound_mapping
// output-free while it is inert.
function raw_print_snd(_str) { }

// ── the sound-library plug-in table ─────────────────────────────────────────

// C ref: sndprocs.h enum soundlib_ids — every SND_LIB_* is off in this build,
// so the enum is just { nosound, notused }.
export const soundlib_nosound = 0;
export const soundlib_notused = 1;

// C ref: sounds.c:1726 nosound_procs — SOUNDID(nosound) expands to the name
// string plus soundlib_nosound; every hook is a null pointer, so no
// Soundeffect()/verbalize() call in the game reaches code at all.
const nosound_procs = {
    soundname: 'nosound',
    soundlib_id: soundlib_nosound,
    sound_triggers: 0,
    sound_init_nhsound: null,
    sound_exit_nhsound: null,
    sound_achievement: null,
    sound_soundeffect: null,
    sound_hero_playnotes: null,
    sound_play_usersound: null,
    sound_ambience: null,
    sound_verbal: null,
};

// C ref: sounds.c:1742 soundlib_choices[] — order must match enum soundlib_ids.
const soundlib_choices = [
    { sndprocs: nosound_procs }, /* default, built-in */
];

// C ref: sounds.c:1693 struct sound_procs soundprocs — the live dispatch table.
export let soundprocs = { ...nosound_procs };
// C ref: decl.c ga.active_soundlib / gc.chosen_soundlib.
export const soundlib_state = {
    active_soundlib: soundlib_nosound,
    chosen_soundlib: soundlib_nosound,
};

// C ref: hack.h IndexOk(i, array).
const IndexOk_snd = (i, arr) => (i >= 0 && i < arr.length);

// C ref: sounds.c:1778 activate_chosen_soundlib().
export function activate_chosen_soundlib() {
    const idx = soundlib_state.chosen_soundlib;

    if (!IndexOk_snd(idx, soundlib_choices))
        throw new Error(`activate_chosen_soundlib: invalid soundlib (${idx})`);

    if (soundlib_state.active_soundlib !== soundlib_nosound
        || idx !== soundlib_nosound) {
        if (soundprocs.sound_exit_nhsound)
            soundprocs.sound_exit_nhsound('assigning a new sound library');
    }
    soundprocs = { ...soundlib_choices[idx].sndprocs };
    if (soundprocs.sound_init_nhsound) soundprocs.sound_init_nhsound();
    soundlib_state.active_soundlib = soundprocs.soundlib_id;
    soundlib_state.chosen_soundlib = soundlib_state.active_soundlib;
}

// C ref: sounds.c:1797 assign_soundlib(idx).
export function assign_soundlib(idx) {
    if (!IndexOk_snd(idx, soundlib_choices))
        throw new Error(`assign_soundlib: invalid soundlib (${idx})`);

    soundlib_state.chosen_soundlib = soundlib_choices[idx].sndprocs.soundlib_id;
}

// C ref: sounds.c:1808 choose_soundlib(s) — the whole function is inside a
// `#if 0` upstream, so no build calls it; translated for completeness.  The
// scan starts at index 1, so with only nosound compiled in it always falls
// through to the error path.
export function choose_soundlib(s) {
    let i;
    for (i = 1; i < soundlib_choices.length && soundlib_choices[i]?.sndprocs; i++) {
        if (String(s).toLowerCase()
            === soundlib_choices[i].sndprocs.soundname.toLowerCase()) {
            assign_soundlib(i);
            return;
        }
    }
    assign_soundlib(soundlib_nosound);

    /* 50: arbitrary, no real soundlib names are anywhere near that long */
    const SOUNDLIB_NAME_MAXLEN = 50;
    if (String(s).length >= SOUNDLIB_NAME_MAXLEN)
        s = String(s).slice(0, SOUNDLIB_NAME_MAXLEN - 1);

    if (!soundlib_choices[1]?.sndprocs) {
        config_error_add_snd('Soundlib type %s not recognized.  '
            + 'The only choice is: %s', s,
            soundlib_choices[0].sndprocs.soundname);
    } else {
        let buf = '';
        let first = true;
        for (i = 0; i < soundlib_choices.length && soundlib_choices[i]?.sndprocs; i++) {
            buf += `${first ? '' : ', '}${soundlib_choices[i].sndprocs.soundname}`;
            first = false;
        }
        config_error_add_snd('Soundlib type %s not recognized.  Choices are:  %s',
                            s, buf);
    }
}
// C ref: options.c config_error_add(fmt, ...) — js/options.js owns the one
// port; a static import of it from here would close a cycle
// (options.js -> ... -> sounds.js), so the message is formatted and dropped
// while choose_soundlib() is unreachable (it is `#if 0` in C too).
function config_error_add_snd(fmt, ...args) {
    let i = 0;
    return String(fmt).replace(/%s/g, () => String(args[i++]));
}

// C ref: sounds.c:1863 get_soundlib_name(dest, maxlen) — copies up to
// maxlen-1 chars, treating a comma as an alternate end of string.  Returns the
// string instead of filling a caller buffer.
export function get_soundlib_name(maxlen) {
    const idx = soundlib_state.active_soundlib;
    if (!IndexOk_snd(idx, soundlib_choices))
        throw new Error(`get_soundlib_name: invalid active_soundlib (${idx})`);

    const src = soundlib_choices[idx].sndprocs.soundname;
    let dest = '';
    for (let count = 1; count < maxlen; count++) {
        const c = src[count - 1];
        if (c === ',' || c === undefined) break; /*exit on \0 terminator*/
        dest += c;
    }
    return dest;
}

// C ref: sounds.c:1882 soundlib_id_from_opt(op) — exact (case-sensitive) name
// match over the whole table, else the nosound id.
export function soundlib_id_from_opt(op) {
    const defproc = nosound_procs;
    for (let idx = 0; idx < soundlib_choices.length; ++idx) {
        const sp = soundlib_choices[idx].sndprocs;
        if (sp.soundname === op) return sp.soundlib_id;
    }
    return defproc.soundlib_id;
}

// ── the default (no-op) sound interface: sounds.c:1916-1956 ─────────────────
// All eight are empty function bodies in C (inside a `#if 0`, since the table
// above installs null pointers rather than these).  Ported verbatim so the
// hook signatures are on record.

// C ref: sounds.c:1916 nosound_init_nhsound(void).
export function nosound_init_nhsound() { }
// C ref: sounds.c:1921 nosound_exit_nhsound(reason).
export function nosound_exit_nhsound(_reason) { }
// C ref: sounds.c:1926 nosound_achievement(ach1, ach2, repeat).
export function nosound_achievement(_ach1, _ach2, _repeat) { }
// C ref: sounds.c:1931 nosound_soundeffect(seid, volume).
export function nosound_soundeffect(_seid, _volume) { }
// C ref: sounds.c:1936 nosound_hero_playnotes(instr, notes, vol).
export function nosound_hero_playnotes(_instr, _notes, _vol) { }
// C ref: sounds.c:1941 nosound_play_usersound(filename, volume, idx).
export function nosound_play_usersound(_filename, _volume, _idx) { }
// C ref: sounds.c:1946 nosound_ambience(ambienceid, action, hero_proximity).
export function nosound_ambience(_ambienceid, _ambience_action,
                                 _hero_proximity) { }
// C ref: sounds.c:1952 nosound_verbal(text, gender, tone, vol, moreinfo).
export function nosound_verbal(_text, _gender, _tone, _vol, _moreinfo) { }

// ── SND_SOUNDEFFECTS_AUTOMAP: sound-effect id -> file name ─────────────────

// C ref: sounds.c:1970 se_mappings_init[] == include/seffects.h, expanded with
// SEFFECTS_AUTOMAP so each row is { se_<basename>, "<basename>" }.  The enum
// starts at se_zero_invalid == 0, so entry N here is seid N.
const SE_MAPPINGS_INIT = [
    '', /* se_zero_invalid */
    'air_crackles', 'alarm', 'angry_drone', 'angry_snakes', 'angry_voice',
    'applause', 'avian_screak', 'bang_weapon_side', 'bars_clink',
    'bars_clonk', 'bars_flapp', 'bars_whang', 'bars_whap', 'bees', 'blast',
    'board_squeak', 'board_squeaks_loudly', 'boing', 'bolt_of_lightning',
    'bone_rattle', 'boomerang_klonk', 'boulder_drop', 'bovine_bellow',
    'bovine_moo', 'bubble_rising', 'bugle_playing_reveille', 'buzz',
    'canine_bark', 'canine_growl', 'canine_howl', 'canine_whine',
    'canine_yelp', 'canine_yip', 'canine_yowl', 'chain_shatters',
    'chains_rattling_gears_turning', 'chant', 'chirp', 'clanging_sound',
    'clank', 'clanking_pipe', 'clash', 'cockatrice_hiss', 'cough',
    'courtly_conversation', 'cracking_sound', 'crackling',
    'crackling_of_hellfire', 'crash', 'crash_door', 'crash_something_broke',
    'crash_throne_destroyed', 'crash_through_floor', 'crashed_ceiling',
    'crashing_boulder', 'crashing_rock', 'crashing_sound', 'croc_bellow',
    'crumbling_sound', 'crunching_sound', 'crushing_sound',
    'deafening_roar_atmospheric', 'destroy_web', 'distant_thunder',
    'divine_music', 'door_crash_open', 'door_open', 'door_unlock_and_open',
    'drain_noises', 'dry_throat_rattle', 'egg_cracking', 'egg_splatting',
    'elephant_trumpet', 'equine_neigh', 'equine_whicker', 'equine_whinny',
    'explosion', 'faint_chime', 'faint_sloshing', 'faint_splashing',
    'feline_meow', 'feline_mew', 'feline_purr', 'feline_yelp', 'feline_yip',
    'feline_yowl', 'furious_bubbling', 'gear_turn',
    'gears_turning_chains_rattling', 'glass_crashing', 'glass_shattering',
    'groan', 'groans_and_moans', 'growl', 'grunt', 'guards_footsteps',
    'gurgle', 'gushing_sound', 'heart_beat', 'hiss', 'hollow_sound',
    'horn_being_played', 'iron_ball_dragging_you', 'iron_ball_hits_you',
    'item_tumble_downwards', 'jabberwock_burble', 'kaablamm_of_mine',
    'kaboom', 'kaboom_boom_boom', 'kaboom_door_explodes',
    'kadoom_boulder_falls_in', 'kerplunk_boulder_gone',
    'kick_door_it_crashes_open', 'kick_door_it_shatters', 'klick', 'klunk',
    'klunk_pipe', 'laughter', 'lid_slams_open_falls_shut', 'loud_click',
    'loud_crash', 'loud_pop', 'loud_splash', 'low_buzzing', 'low_hum',
    'maniacal_laughter', 'masticating_sound', 'mon_chugging_potion',
    'monster_behind_boulder', 'mutter_imprecations', 'mutter_incantation',
    'orc_grunt', 'paranoid_confirmation', 'potion_crash_and_break',
    'ring_in_drain', 'ripping_sound', 'snarl', 'roar', 'rumbling',
    'rumbling_of_earth', 'rushing_wind_noise', 'rustling_paper',
    'sad_wailing', 'sceptor_pounding', 'scratching', 'scream', 'screech',
    'sewer_song', 'sharp_crack', 'shriek', 'shrill_whistle',
    'sinister_laughter', 'sizzling', 'slurping_sound',
    'smashing_and_crushing', 'snake_rattle', 'snakes_hissing', 'soft_click',
    'soft_crackling', 'someone_bowling', 'someone_searching',
    'someone_summoning', 'someone_yells', 'splash', 'splat_egg',
    'splat_from_engulf', 'squawk', 'squeak', 'squeal', 'squelch',
    'stone_breaking', 'stone_crumbling', 'swoosh', 'sword_blade_rings',
    'thud', 'thump', 'thunderclap', 'tumbler_click', 'typing_noise', 'wail',
    'wailing_of_the_banshee', 'wall_of_force', 'yelp', 'zap',
    'zap_then_explosion',
];

// C ref: sounds.c:1977 static const char *semap_basenames[] + the lazily set
// basenames_initialized flag.
const semap_basenames = new Array(SE_MAPPINGS_INIT.length).fill(null);
let basenames_initialized = false;

// C ref: sounds.c:1980 initialize_semap_basenames() — index the names by their
// OWN seid rather than by table position, "to avoid things getting out of
// sequence".  Entry 0 (se_zero_invalid) is deliberately skipped.
export function initialize_semap_basenames() {
    for (let i = 1; i < SE_MAPPINGS_INIT.length; ++i) {
        const seid = i; /* SEFFECTS_AUTOMAP row i is { se_<name>, "<name>" } */
        if (seid > 0 && seid < semap_basenames.length)
            semap_basenames[seid] = SE_MAPPINGS_INIT[i];
    }
}

// C ref: sndprocs.h enum sound_file_flags.
export const sff_default = 0, sff_base_only = 1, sff_havedir_append_rest = 2,
    sff_baseknown_add_rest = 3;

// C ref: sounds.c:1994 get_sound_effect_filename(seid, buf, bufsz, approach).
// Returns the built name (C returns `buf`) or null (C's (char *) 0) when the
// length budget doesn't fit.  `buf` is only read for the append approach.
export function get_sound_effect_filename(seidint, buf, bufsz, approach) {
    const prefix = 'se_', suffix = '.wav';
    let consumes = 0, baselen = 0, existinglen = 0;
    const ourdir = sounddir;       /* sounddir would get set in files.c */
    let needslash = true;

    if (buf == null || (!ourdir && approach === sff_default))
        return null;

    if (!basenames_initialized) {
        initialize_semap_basenames();
        basenames_initialized = true;
    }

    if (semap_basenames[seidint]) baselen = semap_basenames[seidint].length;

    consumes = prefix.length + baselen;
    if (approach === sff_default) {
        consumes += suffix.length + ourdir.length + 1; /* 1 for '/' */
    } else if (approach === sff_havedir_append_rest) {
        existinglen = String(buf).length;
        if (existinglen > 0) {
            const last = String(buf)[existinglen - 1];
            if (last === '/' || last === '\\') needslash = false;
        }
        if (needslash) consumes++;  /* for '/' */
        consumes += existinglen;
        consumes += suffix.length;
    }
    consumes += 1; /* for trailing NUL */
    /* existinglen could be >= bufsz if caller didn't initialize buf
     * to properly include a trailing NUL */
    if (baselen <= 0 || consumes > bufsz || existinglen >= bufsz)
        return null;

    if (approach === sff_default)
        return `${ourdir}/${prefix}${semap_basenames[seidint]}${suffix}`;
    if (approach === sff_havedir_append_rest)
        return `${buf}${needslash ? '/' : ''}`
            + `${prefix}${semap_basenames[seidint]}${suffix}`;
    if (approach === sff_base_only)
        return `${prefix}${semap_basenames[seidint]}`;
    return null;
}

// C ref: sounds.c:2083 base_soundname_to_filename(basename, buf, bufsz,
// approach) — same length accounting as above but with no "se_" prefix and no
// sff_default arm (that approach returns NULL here).
export function base_soundname_to_filename(basename, buf, bufsz, approach) {
    const suffix = '.wav';
    let consumes = 0, baselen = 0, existinglen = 0;
    let needslash = true;

    if (buf == null) return null;

    baselen = String(basename ?? '').length;
    consumes = baselen;

    if (approach === sff_havedir_append_rest) {
        existinglen = String(buf).length;
        if (existinglen > 0) {
            const last = String(buf)[existinglen - 1];
            if (last === '/' || last === '\\') needslash = false;
        }
        if (needslash) consumes++;  /* for '/' */
        consumes += existinglen;
        consumes += suffix.length;
    }
    consumes += 1; /* for trailing NUL */
    if (!baselen || consumes > bufsz || existinglen >= bufsz)
        return null;

    if (approach === sff_havedir_append_rest)
        return `${buf}${needslash ? '/' : ''}${basename}${suffix}`;
    if (approach === sff_base_only)
        return `${basename}`;
    return null;
}

// ── SND_SPEECH ──────────────────────────────────────────────────────────────
// Both bodies below are wholly inside `#ifdef SND_SPEECH`, which this build
// does not define, so in the recorder they are empty functions.  Translated
// anyway; the only state they touch (gv.voice, gp.pline_flags PLINE_SPEECH) is
// kept here so a later speech pass has somewhere to read it from.

// C ref: monst.h FEMALE / MALE (the gender indices set_voice() records).
const MALE_SND = 0, FEMALE_SND = 1;
// C ref: sndprocs.h voice_talking_artifact / voice_deity moreinfo bits.
export const voice_talking_artifact = 0x0001, voice_deity = 0x0002;
// C ref: decl.c gv.voice.
export const voice = {
    gender: MALE_SND, serialno: 0, tone: 0, volume: 0, moreinfo: 0,
    nameid: null,
};
// C ref: pline.h PLINE_SPEECH / PLINE_VERBALIZE (gp.pline_flags).
export const PLINE_SPEECH = 0x0001, PLINE_VERBALIZE = 0x0002;
export const pline_flags_snd = { flags: 0 };

// C ref: sounds.c:2160 set_voice(mtmp, tone, volume, moreinfo) — the
// SetVoice() macro's target; records who is about to speak so the next pline()
// can be routed to the speech synthesiser.
export function set_voice(mtmp, tone, volume, moreinfo) {
    const gender = (mtmp && mtmp.female) ? FEMALE_SND : MALE_SND;

    voice.gender = gender;
    voice.serialno = mtmp ? mtmp.m_id
        : (((moreinfo & voice_talking_artifact) !== 0) ? 3
            : (((moreinfo & voice_deity) !== 0) ? 4 : 2));
    voice.tone = tone;
    voice.volume = volume;
    voice.moreinfo = moreinfo;
    voice.nameid = null;
    pline_flags_snd.flags |= PLINE_SPEECH;
}

// C ref: sounds.c:2184 sound_speak(text) — strips the surrounding quotes a
// verbalize() added before handing the text to the soundlib.
export function sound_speak(text) {
    if (!text || text === '') return;
    if (iflags_voices() && soundprocs.sound_verbal
        && (soundprocs.sound_triggers & SOUND_TRIGGER_VERBAL)) {
        let first = 0, last = String(text).length - 1;
        if ((pline_flags_snd.flags & PLINE_VERBALIZE) !== 0) {
            if (text[first] === '"') first++;
            if (text[last] === '"') last--;
        }
        /* C bails out with buf still "" when the span doesn't fit BUFSZ*2 */
        const buf = (last - first) < (2 * 256 - 1)
            ? String(text).slice(first, last + 1) : '';
        soundprocs.sound_verbal(buf, voice.gender, voice.tone, voice.volume,
                                voice.moreinfo);
    }
}
// C ref: sndprocs.h SOUND_TRIGGER_VERBAL.
const SOUND_TRIGGER_VERBAL = 0x0010;
// C ref: flag.h iflags.voices — the runtime "speak verbalized text" toggle.
const iflags_voices = () => !!game.iflags?.voices;
