// minion.js — minion.c: emin bookkeeping, monster summoning, demon bribery and
// the Astral guardian angel.
// C ref: src/minion.c.
//
// NOTHING IMPORTS THIS FILE.  Every export below is a straight transcription of
// its minion.c original and nothing in js/ calls it yet: the C call sites
// (mhitu.c mattacku -> msummon/demon_talk, pray.c angrygods -> summon_minion,
// do.c goto_level -> gain_guardian_angel, allmain.c -> lose_guardian_angel) are
// either unported or reach their own local copies.
//
// THREE minion.c functions are NOT redefined here because a faithful copy
// already exists elsewhere in js/ (see the note above each stub site):
//   dlord()          -> js/pray.js:1324 (private, faithful)
//   ndemon()         -> js/sp_lev.js:1397 (private; returns a permonst POINTER
//                       where C returns a pmidx, and its is_ndemon() test is
//                       `mcls == S_DEMON && !(geno & G_UNIQ)` instead of C's
//                       `is_demon(ptr) && !(mflags2 & (M2_LORD|M2_PRINCE))`, so
//                       it accepts the djinni and the mail daemon)
//   monster_census() -> js/wizard.js:111, js/mcastu.js:953, js/read.js:2103
//                       (all private, all missing C's isgd/spotted clauses)
// None of the three is exported, so the summoning code below cannot reach them;
// each is re-derived here under a `minion_`-prefixed name that CANNOT shadow the
// real port, and the header comment says which original to export instead.

import { game } from './gstate.js';
import { rn2, rnd, rn1, d } from './rng.js';
import {
    A_NONE, A_LAWFUL, A_NEUTRAL, A_CHAOTIC, A_CHA, G_GONE, NON_PM,
    MM_EMIN, MM_NOMSG, STRAT_APPEARMSG, W_ARMS, EPRI, EMIN, In_endgame,
} from './const.js';
import { In_hell } from './dungeon.js';
import { mflags2_of, M2_LORD, M2_PRINCE, M2_DEMON, M2_MINION } from './monflags_data.js';
import {
    makemon, mkclass, mkclass_aligned, monster_by_pmidx, name_to_pmidx,
    set_malign, mpickobj, enexto_spawn, mongets_pub,
} from './makemon.js';
import { is_art, ART_DEMONBANE, ART_EXCALIBUR } from './artifact.js';
import { DEADMONSTER } from './mon.js';
import { pline, canseemon_shared, newsym, impossible } from './display.js';
import { canspotmon, x_monnam } from './uhitm.js';
import { Monnam, Amonnam, mon_nam, ARTICLE_A } from './do_name.js';
import { show_transient_light, transient_light_cleanup } from './light.js';
import { align_gname, roles } from './role.js';
import { currency } from './invent.js';
import { money2mon } from './shk.js';
import { bless, mksobj } from './mkobj.js';
import { which_armor, m_dowear } from './worn.js';
import { rloc, tele_restrict, RLOC_MSG } from './teleport.js';
import { livelog_printf, LL_UMONST } from './livelog.js';
import { Hear_again } from './eat.js';
import { nomul, stop_occupation } from './hack.js';
import { hooked_tty_getlin } from './extcmd-handlers.js';

// --- macros minion.c uses ---------------------------------------------------

// C ref: hack.h sgn(x).
function sgn(x) { return (x < 0) ? -1 : (x > 0) ? 1 : 0; }
// C ref: mondata.h:110/136-142 — the M2 flag tests.
function is_demon(ptr) { return (mflags2_of(ptr) & M2_DEMON) !== 0; }
function is_lord(ptr) { return (mflags2_of(ptr) & M2_LORD) !== 0; }
function is_prince(ptr) { return (mflags2_of(ptr) & M2_PRINCE) !== 0; }
function is_minion(ptr) { return (mflags2_of(ptr) & M2_MINION) !== 0; }
function is_ndemon(ptr) {
    return is_demon(ptr) && (mflags2_of(ptr) & (M2_LORD | M2_PRINCE)) === 0;
}
function is_dlord(ptr) { return is_demon(ptr) && is_lord(ptr); }
function is_dprince(ptr) { return is_demon(ptr) && is_prince(ptr); }
// C ref: priest.c:280 mon_aligntyp(mon) — the shrine/minion alignment when the
// monster carries one, else its species alignment, collapsed to the three
// aligntyp values.  js/artifact.js:534 and js/apply.js:237 both hold same-named
// private copies; artifact.js's is a DIFFERENT function (it answers the hero's
// alignment for any tame or peaceful monster) and apply.js's drops the
// priest/minion arms, so neither can serve is_lminion().
function mon_aligntyp(mon) {
    const algn = mon.ispriest ? EPRI(mon)?.shralign
               : mon.isminion ? EMIN(mon)?.min_align
                              : mon.data?.maligntyp;
    if (algn === A_NONE)
        return A_NONE; /* negative but differs from chaotic */
    return (algn > 0) ? A_LAWFUL : (algn < 0) ? A_CHAOTIC : A_NEUTRAL;
}
// C ref: monst.h:281 is_lminion(mon).
function is_lminion(mon) {
    return is_minion(mon.data) && mon_aligntyp(mon) === A_LAWFUL;
}
// C ref: obj.h:441 u_wield_art(art) = is_art(uwep, art).
function u_wield_art(art) { return is_art(game.uwep, art); }
// C ref: permonst.h G_UNIQ.
const G_UNIQ = 0x1000;
// C ref: monsym.h S_ANGEL / S_DEMON.
const S_ANGEL = 27, S_DEMON = 56;
// C ref: youprop.h Blind / Deaf / Conflict.  Same readings as js/engrave.js
// isBlind() and js/eat.js's Deaf: potion.js writes blindness to u.blinded.
function Blind() {
    const u = game.u;
    return !!u && ((u.blinded || 0) > 0 || !!game.ublindf);
}
function Deaf() { const u = game.u; return !!(u?.uprops?.Deaf || u?.Deaf); }
function Conflict() {
    const u = game.u;
    return !!(u?.uprops?.Conflict || u?.HConflict || u?.EConflict);
}
// C ref: eat.h is_fainted() — uhs == FAINTED.
const FAINTED = 5;
function is_fainted() { return (game.u?.uhs ?? 0) === FAINTED; }
// C ref: invent.c money_cnt(invent) — the hero's gold.
function money_cnt(list) {
    let total = 0;
    for (const o of (list || []))
        if (o.oclass === 19 /* COIN_CLASS */ || o.otyp === 601 /* GOLD_PIECE */)
            total += (o.quan | 0);
    return total;
}
// C ref: attrib.h ACURR(x) = acurr(x).
function ACURR(i) { return game.u?.acurr?.a?.[i] ?? 0; }
// C ref: sounds.c SetVoice(mon, tag, volume, flags) — tty has no synthesised
// voice, so this only records who speaks; a no-op here as in js/timeout.js:1101.
function SetVoice(_mon, _tag, _vol, _flags) { /* tty: nothing to do */ }
// C ref: pline.c verbalize(); shk.js:814 / vault.js:91 use the same one-liner.
async function verbalize(line) { await pline(`"${line}"`); }
function monsterList() { return game.level?.monsters || []; }

// --- species indices -------------------------------------------------------
// Resolved BY NAME so a mons[] reshuffle cannot silently re-point them; the two
// rn1() WINDOWS below are numeric in C and are asserted against the names.
let _pm = null;
function PM() {
    if (!_pm) {
        _pm = {
            AIR_ELEMENTAL: name_to_pmidx('air elemental'),
            FIRE_ELEMENTAL: name_to_pmidx('fire elemental'),
            EARTH_ELEMENTAL: name_to_pmidx('earth elemental'),
            WATER_ELEMENTAL: name_to_pmidx('water elemental'),
            WIZARD_OF_YENDOR: name_to_pmidx('Wizard of Yendor'),
            BONE_DEVIL: name_to_pmidx('bone devil'),
            SKELETON: name_to_pmidx('skeleton'),
            ANGEL: name_to_pmidx('Angel'),
            ARCHON: name_to_pmidx('Archon'),
            JUIBLEX: name_to_pmidx('Juiblex'),
            YEENOGHU: name_to_pmidx('Yeenoghu'),
            ORCUS: name_to_pmidx('Orcus'),
            DEMOGORGON: name_to_pmidx('Demogorgon'),
            SHOPKEEPER: name_to_pmidx('shopkeeper'),
            GUARD: name_to_pmidx('guard'),
            ALIGNED_CLERIC: name_to_pmidx('aligned cleric'),
            HIGH_CLERIC: name_to_pmidx('high cleric'),
        };
    }
    return _pm;
}
// C ref: objects.h SILVER_SABER / AMULET_OF_REFLECTION / SHIELD_OF_REFLECTION.
const SILVER_SABER = 51, SHIELD_OF_REFLECTION = 158, AMULET_OF_REFLECTION = 208;

// C ref: minion.c:11 elementals[] — "used to pick among the four basic
// elementals without worrying whether they've been reordered (difficulty
// reassessment?) or any new ones have been introduced".  ROLL_FROM() is an
// rn2(4) draw, so the table has to be present even where the result is unused.
function elementals() {
    const p = PM();
    return [p.AIR_ELEMENTAL, p.FIRE_ELEMENTAL, p.EARTH_ELEMENTAL, p.WATER_ELEMENTAL];
}
function ROLL_FROM(arr) { return arr[rn2(arr.length)]; }

// C ref: minion.c:17 newemin(mtmp).  The parentmid is the monster's OWN m_id
// (minions summoned by another minion are re-parented by the caller).
export function newemin(mtmp) {
    if (!mtmp.mextra)
        mtmp.mextra = {};                 /* newmextra() */
    if (!EMIN(mtmp)) {
        mtmp.mextra.emin = { min_align: 0, renegade: 0, parentmid: 0 };
        EMIN(mtmp).parentmid = mtmp.m_id;
    }
}

// C ref: minion.c:29 free_emin(mtmp).
export function free_emin(mtmp) {
    if (mtmp.mextra && EMIN(mtmp)) {
        mtmp.mextra.emin = null;
    }
    mtmp.isminion = 0;
}

// C ref: minion.c:40 monster_census(spotted) — "count the number of monsters on
// the level"; `spotted` selects seen|sensed vs all.  A vault guard waiting
// outside the map (mx == 0) is not on the level.  See the header note: the
// existing js/ copies drop both the isgd and the spotted clause.
export function minion_monster_census(spotted) {
    let count = 0;

    for (const mtmp of monsterList()) {
        if (DEADMONSTER(mtmp))
            continue;
        if (mtmp.isgd && mtmp.mx === 0)
            continue;
        if (spotted && !canspotmon(mtmp))
            continue;
        ++count;
    }
    return count;
}

// C ref: minion.c:392 dprince(atyp) — a demon prince of the given alignment.
// In_endgame() makes tryct 0, i.e. straight to dlord(): no draws at all.  Each
// try draws rn1(6, PM_ORCUS) whether or not it succeeds, so the LOOP is the
// load-bearing part, not the monster it lands on.
export function dprince(atyp) {
    const p = PM();
    for (let tryct = !In_endgame() ? 20 : 0; tryct > 0; --tryct) {
        const pm = rn1(p.DEMOGORGON + 1 - p.ORCUS, p.ORCUS);
        const ptr = monster_by_pmidx(pm);
        if (!((game.mvitals?.[pm]?.mvflags | 0) & G_GONE)
            && (atyp === A_NONE || sgn(ptr?.maligntyp | 0) === sgn(atyp)))
            return pm;
    }
    return minion_dlord(atyp); /* approximate */
}

// C ref: minion.c:405 dlord(atyp).  See the header note: js/pray.js:1324 holds
// the faithful private copy; export THAT rather than keeping two.
function minion_dlord(atyp) {
    const p = PM();
    for (let tryct = !In_endgame() ? 20 : 0; tryct > 0; --tryct) {
        const pm = rn1(p.YEENOGHU + 1 - p.JUIBLEX, p.JUIBLEX);
        const ptr = monster_by_pmidx(pm);
        if (!((game.mvitals?.[pm]?.mvflags | 0) & G_GONE)
            && (atyp === A_NONE || sgn(ptr?.maligntyp | 0) === sgn(atyp)))
            return pm;
    }
    return minion_ndemon(atyp); /* approximate */
}

// C ref: minion.c:420 llord() — "create lawful (good) lord".  No RNG unless the
// Archon is extinct/genocided, when lminion() takes over.
export function llord() {
    const p = PM();
    if (!((game.mvitals?.[p.ARCHON]?.mvflags | 0) & G_GONE))
        return p.ARCHON;

    return lminion(); /* approximate */
}

// C ref: minion.c:429 lminion() — up to 20 mkclass(S_ANGEL, 0) draws until one
// lands on a non-lord 'A'.  Every rejected try still consumed its mkclass draw.
export function lminion() {
    for (let tryct = 0; tryct < 20; tryct++) {
        const ptr = mkclass(S_ANGEL, 0);
        if (ptr && !is_lord(ptr))
            return monsndx(ptr);
    }

    return NON_PM;
}

// C ref: minion.c:444 ndemon(atyp) — "A_NONE is used for 'any alignment'".
// 3.6.2 made this a single mkclass_aligned() call (it used to retry 20 times),
// so exactly one draw sequence happens here.  See the header note about
// js/sp_lev.js:1397.
function minion_ndemon(atyp) {
    const ptr = mkclass_aligned(S_DEMON, 0, atyp);
    return (ptr && is_ndemon(ptr)) ? monsndx(ptr) : NON_PM;
}

// C ref: mon.c monsndx(ptr).
function monsndx(ptr) { return ptr?.pmidx ?? NON_PM; }

// C ref: minion.c:59 msummon(mon) — "mon summons a monster"; mon == Null means
// the Wizard of Yendor's summons.  Returns how many monsters actually appeared
// (a census delta, because some candidates arrive as a group).
//
// RNG ORDER, which is the whole point of this function: the dtype if-chain
// draws its rn2()s in C's short-circuit order (`!rn2(20) ? dprince : !rn2(4) ?
// dlord : ndemon`, so the rn2(4) is only drawn when the rn2(20) missed), then
// the `cnt` expression draws its own rn2(4) ONLY when dtype != NON_PM, then
// each loop iteration runs one makemon().
export async function msummon(mon) {
    let ptr;
    let dtype = NON_PM, cnt = 0, result = 0, census;
    let xlight;
    let atyp;
    let mtmp;
    const p = PM();

    if (mon) {
        ptr = mon.data;

        if (u_wield_art(ART_DEMONBANE) && is_demon(ptr)) {
            if (canseemon_shared(mon))
                await pline(`${Monnam(mon)} looks puzzled for a moment.`);
            return 0;
        }

        atyp = mon.ispriest ? EPRI(mon).shralign
             : mon.isminion ? EMIN(mon).min_align
             : (ptr.maligntyp === A_NONE) ? A_NONE
             : sgn(ptr.maligntyp);
    } else {
        ptr = monster_by_pmidx(p.WIZARD_OF_YENDOR);
        atyp = (ptr.maligntyp === A_NONE) ? A_NONE : sgn(ptr.maligntyp);
    }

    if (is_dprince(ptr) || (monsndx(ptr) === p.WIZARD_OF_YENDOR)) {
        dtype = (!rn2(20)) ? dprince(atyp) : (!rn2(4)) ? minion_dlord(atyp)
                                                      : minion_ndemon(atyp);
        cnt = ((dtype !== NON_PM)
               && !rn2(4) && is_ndemon(monster_by_pmidx(dtype))) ? 2 : 1;
    } else if (is_dlord(ptr)) {
        dtype = (!rn2(50)) ? dprince(atyp) : (!rn2(20)) ? minion_dlord(atyp)
                                                        : minion_ndemon(atyp);
        cnt = ((dtype !== NON_PM)
               && !rn2(4) && is_ndemon(monster_by_pmidx(dtype))) ? 2 : 1;
    } else if (monsndx(ptr) === p.BONE_DEVIL) {
        dtype = p.SKELETON;
        cnt = 1;
    } else if (is_ndemon(ptr)) {
        dtype = (!rn2(20)) ? minion_dlord(atyp) : (!rn2(6)) ? minion_ndemon(atyp)
                                                           : monsndx(ptr);
        cnt = 1;
    } else if (mon && is_lminion(mon)) {
        dtype = (is_lord(ptr) && !rn2(20))
                    ? llord()
                    : (is_lord(ptr) || !rn2(6)) ? lminion() : monsndx(ptr);
        cnt = ((dtype !== NON_PM)
               && !rn2(4) && !is_lord(monster_by_pmidx(dtype))) ? 2 : 1;
    } else if (monsndx(ptr) === p.ANGEL) {
        /* non-lawful angels can also summon */
        if (!rn2(6)) {
            switch (atyp) { /* see summon_minion */
            case A_NEUTRAL:
                dtype = ROLL_FROM(elementals());
                break;
            case A_CHAOTIC:
            case A_NONE:
                dtype = minion_ndemon(atyp);
                break;
            }
        } else {
            dtype = p.ANGEL;
        }
        cnt = ((dtype !== NON_PM)
               && !rn2(4) && !is_lord(monster_by_pmidx(dtype))) ? 2 : 1;
    }

    if (dtype === NON_PM)
        return 0;

    /* sanity checks */
    if (cnt > 1 && ((monster_by_pmidx(dtype).geno | 0) & G_UNIQ) !== 0)
        cnt = 1;
    /*
     * If this daemon is unique and being re-summoned (the only way we
     * could get this far with an extinct dtype), try another.
     */
    if (((game.mvitals?.[dtype]?.mvflags | 0) & G_GONE) !== 0) {
        dtype = minion_ndemon(atyp);
        if (dtype === NON_PM)
            return 0;
    }

    /* some candidates can generate a group of monsters, so simple
       count of non-null makemon() result is not sufficient */
    census = minion_monster_census(false);
    xlight = false;

    while (cnt > 0) {
        mtmp = makemon(monster_by_pmidx(dtype), game.u.ux, game.u.uy,
                       MM_EMIN | MM_NOMSG);
        if (mtmp) {
            result++;
            /* an angel's alignment should match the summoner */
            if (dtype === p.ANGEL) {
                mtmp.isminion = 1;
                // makemon(MM_EMIN) calls newemin(); guard in case this port's
                // makemon has not allocated it.
                if (!EMIN(mtmp)) newemin(mtmp);
                EMIN(mtmp).min_align = atyp;
                /* renegade if same alignment but not peaceful
                   or peaceful but different alignment */
                EMIN(mtmp).renegade =
                    ((atyp !== game.u.ualign.type) ? 1 : 0) ^ (!mtmp.mpeaceful ? 1 : 0);
            }

            // C ref: minion.c:162 `mtmp->data->mlet == S_ANGEL` — C's mlet is
            // the numeric class index, which in this port is .mcls
            // (makemon.js:621 puts the display CHARACTER in .mlet).
            if (mtmp.data.mcls === S_ANGEL && !Blind()) {
                /* for any 'A', 'cloud of smoke' will be 'flash of light';
                   if more than one monster is being created, that message
                   might be skipped for this monster but show 'mtmp' anyway */
                await show_transient_light(null, mtmp.mx, mtmp.my);
                xlight = true;
                /* we don't do this for 'burst of flame' (fire elemental)
                   because those monsters become their own light source */
            }

            if (cnt === 1 && canseemon_shared(mtmp)) {
                // C's `const char *cloud` out-param; the mondata.c port sets
                // .v.  Imported lazily because msummon_environ() is a very
                // recent addition to js/mondata.js and a static import would
                // stop this whole file from loading against an older tree.
                const { msummon_environ } = await import('./mondata.js');
                const cloud = { v: '' };
                const what = msummon_environ(mtmp.data, cloud);

                await pline(`${Amonnam(mtmp)} appears in a ${cloud.v} of ${what}!`);
            }
        }
        cnt--;
    }

    if (xlight) {
        /* Note: if we forced --More-- here, the 'A's would be visible for
           long enough to be seen, but like with clairvoyance, some players
           would be annoyed at the disruption of having to acknowledge it */
        await transient_light_cleanup();
    }

    /* how many monsters exist now compared to before? */
    if (result)
        result = minion_monster_census(false) - census;

    return result;
}

// C ref: minion.c:198 summon_minion(alignment, talk) — the god's enforcer.  The
// alignment switch is the only RNG (lminion's mkclass loop, the elementals
// rn2(4), or ndemon's mkclass_aligned); makemon() follows once.
export async function summon_minion(alignment, talk) {
    let mon;
    let mnum;
    const p = PM();

    switch (alignment | 0) {
    case A_LAWFUL:
        mnum = lminion();
        break;
    case A_NEUTRAL:
        mnum = ROLL_FROM(elementals());
        break;
    case A_CHAOTIC:
    case A_NONE:
        mnum = minion_ndemon(alignment);
        break;
    default:
        await impossible('unaligned player?');
        mnum = minion_ndemon(A_NONE);
        break;
    }
    if (mnum === NON_PM) {
        mon = null;
    } else if (mnum === p.ANGEL) {
        mon = makemon(monster_by_pmidx(mnum), game.u.ux, game.u.uy,
                      MM_EMIN | MM_NOMSG);
        if (mon) {
            mon.isminion = 1;
            if (!EMIN(mon)) newemin(mon);
            EMIN(mon).min_align = alignment;
            EMIN(mon).renegade = false;
        }
    } else if (mnum !== p.SHOPKEEPER && mnum !== p.GUARD
               && mnum !== p.ALIGNED_CLERIC && mnum !== p.HIGH_CLERIC) {
        /* This was mons[mnum].pxlth == 0 but is this restriction
           appropriate or necessary now that the structures are separate? */
        mon = makemon(monster_by_pmidx(mnum), game.u.ux, game.u.uy,
                      MM_EMIN | MM_NOMSG);
        if (mon) {
            mon.isminion = 1;
            if (!EMIN(mon)) newemin(mon);
            EMIN(mon).min_align = alignment;
            EMIN(mon).renegade = false;
        }
    } else {
        mon = makemon(monster_by_pmidx(mnum), game.u.ux, game.u.uy, MM_NOMSG);
    }
    if (mon) {
        if (talk) {
            if (!Deaf())
                await pline(`The voice of ${align_gname_of(alignment)} booms:`);
            else
                await pline(`You feel ${s_suffix(align_gname_of(alignment))} booming voice:`);
            SetVoice(mon, 0, 80, 0);
            await verbalize('Thou shalt pay for thine indiscretion!');
            if (canspotmon(mon))
                await pline(`${Amonnam(mon)} appears before you.`);
            mon.mstrategy &= ~STRAT_APPEARMSG;
        }
        mon.mpeaceful = false;
        /* don't call set_malign(); player was naughty */
    }
}

// C ref: role.c align_gname(alignment) — the deity name for an aligntyp.  C
// reads gu.urole itself; js/role.js:734 wants the roles[] ARRAY index first,
// which is NOT the PM_ mnum (they differ for Rogue/Ranger) — same resolution as
// js/insight.js:1462 role_arr_idx().
function align_gname_of(alignment) {
    const mnum = game.urole?.mnum ?? game.u?.umonnum ?? 9;
    const i = roles.findIndex((r) => r.mnum === mnum);
    return align_gname((i >= 0) ? i : mnum, alignment);
}
// C ref: objnam.c s_suffix(str).
function s_suffix(s) {
    if (s.endsWith('s')) return `${s}'`;
    return `${s}'s`;
}

// C ref: minion.c:259 `#define Athome (Inhell && (mtmp->cham == NON_PM))`.
function Athome(mtmp) {
    return (In_hell(game.u?.uz) && mtmp.cham === NON_PM) ? 1 : 0;
}

// C ref: minion.c:263 demon_talk(mtmp) — "returns 1 if it won't attack."
//
// RNG ORDER: rnd(80) for the demand, then (only when the demon has the Amulet or
// the hero is Deaf) rn1(1000, 125), then bribe()'s getlin, then rnd(5*ACURR
// (A_CHA)) for the "scowls at you menacingly" escape.
export async function demon_talk(mtmp) {
    let cash, demand, offer;

    if (u_wield_art(ART_EXCALIBUR) || u_wield_art(ART_DEMONBANE)) {
        if (canspotmon(mtmp))
            await pline(`${Amonnam(mtmp)} looks very angry.`);
        else
            await pline('You feel tension building.');
        mtmp.mpeaceful = mtmp.mtame = 0;
        set_malign(mtmp);
        newsym(mtmp.mx, mtmp.my);
        return 0;
    }

    if (is_fainted()) {
        await reset_faint(); /* if fainted - wake up */
    } else {
        await stop_occupation();
        if ((game.multi | 0) > 0) {
            nomul(0);
            await unmul(null);
        }
    }

    /* Slight advantage given. */
    if (is_dprince(mtmp.data) && mtmp.minvis) {
        const wasunseen = !canspotmon(mtmp);

        mtmp.minvis = mtmp.perminvis = 0;
        if (wasunseen && canspotmon(mtmp)) {
            await pline(`${Amonnam(mtmp)} appears before you.`);
            mtmp.mstrategy &= ~STRAT_APPEARMSG;
        }
        newsym(mtmp.mx, mtmp.my);
    }
    // C ref: minion.c:299 `gy.youmonst.data->mlet == S_DEMON` — numeric class,
    // i.e. this port's .mcls.
    if (game.youmonst?.data?.mcls === S_DEMON) { /* Won't blackmail their own. */
        if (!Deaf())
            await pline(`${Amonnam(mtmp)} says, "Good hunting, ${game.flags?.female ? 'Sister' : 'Brother'}."`);
        else if (canseemon_shared(mtmp))
            await pline(`${Amonnam(mtmp)} says something.`);
        if (!await tele_restrict(mtmp))
            await rloc(mtmp, RLOC_MSG);
        return 1;
    }
    cash = money_cnt(game.invent);
    demand = Math.trunc((cash * (rnd(80) + 20 * Athome(mtmp)))
             / (100 * (1 + ((sgn(game.u.ualign.type) === sgn(mtmp.data.maligntyp)) ? 1 : 0))));

    if (!demand || (game.multi | 0) < 0) { /* you have no gold or can't move */
        mtmp.mpeaceful = 0;
        set_malign(mtmp);
        return 0;
    } else {
        /* make sure that the demand is unmeetable if the monster
           has the Amulet, preventing monster from being satisfied
           and removed from the game (along with said Amulet...) */
        /* [actually the Amulet is safe; it would be dropped when
           mongone() gets rid of the monster; force combat anyway;
           also make it unmeetable if the player is Deaf, to simplify
           handling that case as player-won't-pay] */
        if (mon_has_amulet(mtmp) || Deaf())
            /* 125: 5*25 in case hero has maximum possible charisma */
            demand = cash + rn1(1000, 125);

        if (!Deaf())
            await pline(`${Amonnam(mtmp)} demands ${demand} ${currency(demand)} for safe passage.`);
        else if (canseemon_shared(mtmp))
            await pline(`${Amonnam(mtmp)} seems to be demanding something.`);
        offer = 0;
        if (!Deaf()
            && ((offer = await bribe(mtmp, 'How much will you offer?')) >= demand)) {
            await pline(`${Amonnam(mtmp)} vanishes, laughing about cowardly mortals.`);
        } else if (offer > 0
                   && rnd(5 * ACURR(A_CHA)) > (demand - offer)) {
            await pline(`${Amonnam(mtmp)} scowls at you menacingly, then vanishes.`);
        } else {
            await pline(`${Amonnam(mtmp)} gets angry...`);
            mtmp.mpeaceful = 0;
            set_malign(mtmp);
            return 0;
        }
    }
    /* if 'mtmp' is unrecognizable due to hero's hallucination,
       #chronicle will reveal its true identity -- just live with that;
       also, avoid random hallucinatory currency() units */
    livelog_printf(LL_UMONST,
                   `bribed ${x_monnam(mtmp, ARTICLE_A, null, EXACT_NAME, false)}`
                   + ` with ${offer} ${(offer === 1) ? 'zorkmid' : 'zorkmids'}`
                   + ' for safe passage');
    // UNPORTED: mongone(mtmp) (mon.c:3116).  js/muse.js:672 and js/vault.js:228
    // hold private copies; js/read.js:2943 works around the same gap.  NOT
    // stubbed: silently leaving the demon on the level after it "vanishes" is
    // exactly the kind of no-op that looks correct when this gets wired up.
    await mongone_unported(mtmp);
    return 1;
}
// C ref: do_name.h EXACT_NAME (SUPPRESS_HALLUCINATION|SUPPRESS_INVISIBLE|
// SUPPRESS_IT|SUPPRESS_SADDLE|SUPPRESS_NAME).
const EXACT_NAME = 0x0f | 0x10;
// C ref: wizard.c mon_has_amulet(mtmp) — js/wizard.js:31 exports it, but
// importing wizard.js here would pull the whole Wizard-harassment module into a
// leaf file; the two-line walk is reproduced with its C ref instead.
function mon_has_amulet(mtmp) {
    for (const otmp of (mtmp.minvent || []))
        if (otmp.otyp === 218 /* AMULET_OF_YENDOR */) return true;
    return false;
}
// The three mon.c/vault.c callees demon_talk() and the guardian-angel pair need
// and js/ does not export.  Each throws rather than pretending to work.
async function mongone_unported(_mtmp) {
    throw new Error('UNPORTED: mongone() (mon.c) — no exported js/ port; see js/muse.js:672');
}
async function reset_faint() {
    throw new Error('UNPORTED: reset_faint() (eat.c) — no exported js/ port; see js/vault.js:416');
}
async function unmul(_msg) {
    throw new Error('UNPORTED: unmul() (hack.c) — no exported js/ port; see js/vault.js:422');
}
async function mk_roamer_unported(_ptr, _alignment, _x, _y, _peaceful) {
    throw new Error('UNPORTED: mk_roamer() (makemon.c) — not ported anywhere in js/');
}
function select_hwep_unported(_mtmp) {
    throw new Error('UNPORTED: select_hwep() (muse.c) — no exported js/ port; see js/monmove.js:5820');
}

// C ref: minion.c:361 bribe(mtmp, prompt) — read a number from the player and
// hand that much gold over.  No RNG.
export async function bribe(mtmp, prompt) {
    let offer;
    const umoney = money_cnt(game.invent);

    const buf = await hooked_tty_getlin(prompt, null);
    // C: `if (sscanf(buf, "%ld", &offer) != 1) offer = 0L` — sscanf stops at the
    // first non-digit and fails only when it matched nothing at all.
    const m = /^\s*[-+]?\d+/.exec(buf || '');
    offer = m ? parseInt(m[0], 10) : 0;

    /*Michael Paddon -- fix for negative offer to monster*/
    /*JAR880815 - */
    if (offer < 0) {
        await pline(`You try to shortchange ${mon_nam(mtmp)}, but fumble.`);
        return 0;
    } else if (offer === 0) {
        await pline('You refuse.');
        return 0;
    } else if (offer >= umoney) {
        await pline(`You give ${mon_nam(mtmp)} all your gold.`);
        offer = umoney;
    } else {
        await pline(`You give ${mon_nam(mtmp)} ${offer} ${currency(offer)}.`);
    }
    await money2mon(mtmp, offer);
    game.botl = true;
    return offer;
}

// C ref: minion.c:468 lose_guardian_angel(mon) — "guardian angel has been
// affected by conflict so is abandoning hero"; mon Null means the angel hasn't
// been created yet.  rn1(3, 2) is drawn ONCE (2..4 replacements), then each
// iteration draws its enexto().
export async function lose_guardian_angel(mon) {
    const mm = { x: 0, y: 0 };
    let i;
    const p = PM();

    if (mon) {
        if (canspotmon(mon)) {
            if (!Deaf()) {
                await pline(`${Monnam(mon)} rebukes you, saying:`);
                SetVoice(mon, 0, 80, 0);
                await verbalize('Since you desire conflict, have some more!');
            } else {
                await pline(`${Monnam(mon)} vanishes!`);
            }
        }
        await mongone_unported(mon);
    }
    /* create 2 to 4 hostile angels to replace the lost guardian */
    for (i = rn1(3, 2); i > 0; --i) {
        mm.x = game.u.ux;
        mm.y = game.u.uy;
        const spot = enexto_spawn(mm.x, mm.y, monster_by_pmidx(p.ANGEL));
        if (spot) {
            mm.x = spot.x; mm.y = spot.y;
            await mk_roamer_unported(monster_by_pmidx(p.ANGEL),
                                     game.u.ualign.type, mm.x, mm.y, false);
        }
    }
}

// C ref: minion.c:498 gain_guardian_angel() — "just entered the Astral Plane;
// receive tame guardian angel if worthy".
//
// RNG ORDER on the worthy path: enexto(), mk_roamer()'s makemon(), then
// rn1(8, 15) for m_lev, then d(m_lev, 10) + rnd(30) for hp, then select_hwep()
// / mksobj(), then (spe < 4) rnd(4).
export async function gain_guardian_angel() {
    let mtmp, otmp;
    const mm = { x: 0, y: 0 };
    const p = PM();

    Hear_again(); /* attempt to cure any deafness now (divine
                     message will be heard even if that fails) */
    if (Conflict()) {
        if (!Deaf())
            await pline('A voice booms:');
        else
            await pline('You feel a booming voice:');
        SetVoice(null, 0, 80, 0 /* voice_deity */);
        await verbalize('Thy desire for conflict shall be fulfilled!');
        /* send in some hostile angels instead */
        await lose_guardian_angel(null);
    } else if (game.u.ualign.record > 8) { /* fervent */
        if (!Deaf())
            await pline('A voice whispers:');
        else
            await pline('You feel a soft voice:');
        SetVoice(null, 0, 80, 0 /* voice_deity */);
        await verbalize('Thou hast been worthy of me!');
        mm.x = game.u.ux;
        mm.y = game.u.uy;
        const spot = enexto_spawn(mm.x, mm.y, monster_by_pmidx(p.ANGEL));
        if (spot) {
            mm.x = spot.x; mm.y = spot.y;
            mtmp = await mk_roamer_unported(monster_by_pmidx(p.ANGEL),
                                            game.u.ualign.type, mm.x, mm.y, true);
        }
        if (spot && mtmp) {
            mtmp.mstrategy &= ~STRAT_APPEARMSG;
            /* guardian angel -- the one case mtame doesn't imply an
             * edog structure, so we don't want to call tamedog().
             * [Note: this predates mon->mextra which allows a monster
             * to have both emin and edog at the same time.]
             */
            /* Too nasty for the game to unexpectedly break petless conduct on
             * the final level of the game. The angel will still appear, but
             * won't be tamed. */
            if (game.u.uconduct.pets) {
                mtmp.mtame = 10;
                game.u.uconduct.pets++;
            }
            /* for 'hilite_pet'; after making tame, before next message */
            newsym(mtmp.mx, mtmp.my);
            if (!Blind())
                await pline('An angel appears near you.');
            else
                await pline('You feel the presence of a friendly angel near you.');
            /* make him strong enough vs. endgame foes */
            mtmp.m_lev = rn1(8, 15);
            mtmp.mhp = mtmp.mhpmax = d(mtmp.m_lev, 10) + 30 + rnd(30);
            if ((otmp = select_hwep_unported(mtmp)) === null) {
                otmp = mksobj(SILVER_SABER, false, false);
                if (mpickobj(mtmp, otmp))
                    throw new Error('merged weapon?');   /* C: panic() */
            }
            bless(otmp);
            if (otmp.spe < 4)
                otmp.spe += rnd(4);
            if ((otmp = which_armor(mtmp, W_ARMS)) === null
                || otmp.otyp !== SHIELD_OF_REFLECTION) {
                mongets_pub(mtmp, AMULET_OF_REFLECTION);
                await m_dowear(mtmp, true);
            }
        }
    }
}

/*minion.js*/
