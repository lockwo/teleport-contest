// mcastu.js — monster spellcasting.
// C ref: src/mcastu.c (choose_monster_spell/castmu/cursetxt) + include/mcastu.h.
//
// dochug() calls castmu(mtmp, a, FALSE, FALSE) for every AT_MAGC AD_SPEL/AD_CLRC
// attack of a monster that is taking its movement branch and is within dist2 49
// of the hero (monmove.c:875).  That path draws choose_monster_spell's
// rn2(m_lev) EVERY such turn, so leaving it out desyncs the stream for any level
// carrying a spellcaster (seed0360 step 205: a gnomish wizard 7 squares away).

import { game } from './gstate.js';
import { rn2, d } from './rng.js';
import { couldsee } from './vision.js';
import {
    M_ATTK_MISS, M_ATTK_HIT, MFAST, STRAT_WAITFORU,
    M_SEEN_NOTHING, M_SEEN_MAGR, M_SEEN_FIRE, M_SEEN_COLD, M_SEEN_SLEEP,
    M_SEEN_DISINT, M_SEEN_ELEC, M_SEEN_POISON, M_SEEN_ACID,
} from './const.js';
import {
    AD_SPEL, AD_CLRC, AD_MAGM, AD_FIRE, AD_COLD, AD_SLEE, AD_DISN, AD_ELEC,
    AD_DRST, AD_ACID,
} from './monattk_data.js';
import { healmon } from './mon.js';

// ---------------------------------------------------------------------------
// include/mcastu.h — MONSPELL(def, lvl, flags) in enum order.  The enum VALUE
// is the array index, which is also what mon_wizard_spells/mon_cleric_spells
// hold, so the table order below is load-bearing.
export const MCF_NONE = 0x0000;
export const MCF_INDIRECT = 0x0001; /* untargeted/indirect spell */
export const MCF_SIGHT = 0x0002;    /* monster needs to see hero */
export const MCF_HOSTILE = 0x0004;  /* cast by hostile monsters only */

export const MCAST_PSI_BOLT = 0, MCAST_OPEN_WOUNDS = 1, MCAST_CURE_SELF = 2,
    MCAST_HASTE_SELF = 3, MCAST_CONFUSE_YOU = 4, MCAST_STUN_YOU = 5,
    MCAST_DISAPPEAR = 6, MCAST_PARALYZE = 7, MCAST_BLIND_YOU = 8,
    MCAST_WEAKEN_YOU = 9, MCAST_DESTRY_ARMR = 10, MCAST_INSECTS = 11,
    MCAST_CURSE_ITEMS = 12, MCAST_LIGHTNING = 13, MCAST_FIRE_PILLAR = 14,
    MCAST_GEYSER = 15, MCAST_AGGRAVATION = 16, MCAST_SUMMON_MONS = 17,
    MCAST_CLONE_WIZ = 18, MCAST_DEATH_TOUCH = 19;

const mcast_data = [
    /* PSI_BOLT     */ { level: 0, flags: MCF_HOSTILE | MCF_SIGHT },
    /* OPEN_WOUNDS  */ { level: 0, flags: MCF_HOSTILE | MCF_SIGHT },
    /* CURE_SELF    */ { level: 1, flags: MCF_INDIRECT },
    /* HASTE_SELF   */ { level: 2, flags: MCF_INDIRECT },
    /* CONFUSE_YOU  */ { level: 2, flags: MCF_HOSTILE | MCF_SIGHT },
    /* STUN_YOU     */ { level: 3, flags: MCF_HOSTILE | MCF_SIGHT },
    /* DISAPPEAR    */ { level: 4, flags: MCF_INDIRECT },
    /* PARALYZE     */ { level: 4, flags: MCF_HOSTILE | MCF_SIGHT },
    /* BLIND_YOU    */ { level: 6, flags: MCF_HOSTILE | MCF_SIGHT },
    /* WEAKEN_YOU   */ { level: 6, flags: MCF_HOSTILE | MCF_SIGHT },
    /* DESTRY_ARMR  */ { level: 8, flags: MCF_HOSTILE | MCF_SIGHT },
    /* INSECTS      */ { level: 8, flags: MCF_HOSTILE | MCF_INDIRECT | MCF_SIGHT },
    /* CURSE_ITEMS  */ { level: 10, flags: MCF_HOSTILE | MCF_SIGHT },
    /* LIGHTNING    */ { level: 11, flags: MCF_HOSTILE | MCF_SIGHT },
    /* FIRE_PILLAR  */ { level: 12, flags: MCF_HOSTILE | MCF_SIGHT },
    /* GEYSER       */ { level: 13, flags: MCF_HOSTILE | MCF_SIGHT },
    /* AGGRAVATION  */ { level: 13, flags: MCF_INDIRECT | MCF_HOSTILE | MCF_SIGHT },
    /* SUMMON_MONS  */ { level: 15, flags: MCF_HOSTILE | MCF_INDIRECT | MCF_SIGHT },
    /* CLONE_WIZ    */ { level: 18, flags: MCF_HOSTILE | MCF_INDIRECT | MCF_SIGHT },
    /* DEATH_TOUCH  */ { level: 20, flags: MCF_HOSTILE | MCF_SIGHT },
];

// mcastu.c:27 — "the spells in the list should be in ascending level order".
const mon_cleric_spells = [
    MCAST_OPEN_WOUNDS, MCAST_CURE_SELF, MCAST_CONFUSE_YOU, MCAST_PARALYZE,
    MCAST_BLIND_YOU, MCAST_INSECTS, MCAST_CURSE_ITEMS, MCAST_LIGHTNING,
    MCAST_FIRE_PILLAR, MCAST_GEYSER,
];
const mon_wizard_spells = [
    MCAST_PSI_BOLT, MCAST_CURE_SELF, MCAST_HASTE_SELF, MCAST_STUN_YOU,
    MCAST_DISAPPEAR, MCAST_WEAKEN_YOU, MCAST_DESTRY_ARMR, MCAST_CURSE_ITEMS,
    MCAST_AGGRAVATION, MCAST_SUMMON_MONS, MCAST_CLONE_WIZ, MCAST_DEATH_TOUCH,
];

// C ref: mcastu.c:899 is_undirected_spell().
export function is_undirected_spell(spellnum) {
    return (mcast_data[spellnum].flags & MCF_INDIRECT) !== 0;
}

// C ref: mcastu.c:909 spell_would_be_useless().  THREE of its arms draw
// (DEATH_TOUCH rn2(2), GEYSER rn2(5), AGGRAVATION rn2(100)) and it is called
// once per candidate spell inside choose_monster_spell's descending scan, so
// the arm order matters as much as the answers.
function spell_would_be_useless(mtmp, spellnum) {
    if ((mcast_data[spellnum].flags & MCF_HOSTILE) !== 0) {
        if (mtmp.mpeaceful) return true;
    }
    if ((mcast_data[spellnum].flags & MCF_SIGHT) !== 0) {
        if (!couldsee(mtmp.mx, mtmp.my)) return true;
    }

    switch (spellnum) {
    case MCAST_DEATH_TOUCH:
        // Antimagic/Hallucination are hero properties; neither is carried by a
        // hero this reaches, so C's `(Antimagic || Hallucination) && !rn2(2)`
        // short-circuits before the roll.
        if ((Antimagic() || Hallucination()) && !rn2(2)) return true;
        break;
    case MCAST_GEYSER:
        if (!rn2(5)) return true;
        break;
    case MCAST_CLONE_WIZ:
        /* only the Wizard is allowed to clone himself */
        if (!mtmp.iswiz || (game.context?.no_of_wizards | 0) > 1) return true;
        break;
    case MCAST_AGGRAVATION:
        if (!has_aggravatables(mtmp)) return rn2(100) ? true : false;
        break;
    case MCAST_HASTE_SELF:
        if (mtmp.permspeed === MFAST) return true;
        break;
    case MCAST_DISAPPEAR:
        if (mtmp.minvis || mtmp.invis_blkd) return true;
        if (mtmp.mpeaceful && !See_invisible()) return true;
        break;
    case MCAST_CURE_SELF:
        if (mtmp.mhp === mtmp.mhpmax) return true;
        break;
    case MCAST_BLIND_YOU:
        if (Blinded()) return true;
        break;
    default:
        break;
    }
    return false;
}

// C ref: mcastu.c:87 choose_monster_spell(mtmp, adtyp).
function choose_monster_spell(mtmp, adtyp) {
    let list = null, len = 0;

    if (adtyp === AD_SPEL) { list = mon_wizard_spells; len = mon_wizard_spells.length; }
    else if (adtyp === AD_CLRC) { list = mon_cleric_spells; len = mon_cleric_spells.length; }

    if (!list || len < 1) return MCAST_PSI_BOLT;

    const maxlev = mcast_data[list[len - 1]].level;

    // mcastu.c:111 — the divergence this port was written for.
    let spellval = rn2(mtmp.m_lev);
    if (spellval > maxlev && rn2(maxlev)) spellval = rn2(maxlev);

    for (let i = len - 1; i >= 0; i--) {
        if (mcast_data[list[i]].level <= spellval
            && !spell_would_be_useless(mtmp, list[i]))
            return list[i];
    }
    return list[0];
}

// C ref: mcastu.c:61 cursetxt() — feedback when a frustrated monster couldn't
// cast.  The rn2(4) fires ONLY when the monster is out of sight AND the move
// count is not a multiple of 4 (C's `!(svm.moves % 4) || !rn2(4)`).
async function cursetxt(mtmp, undirected) {
    const { canseemon_shared } = await import('./display.js');
    const { Monnam } = await import('./uhitm.js');
    if (canseemon_shared(mtmp) && couldsee(mtmp.mx, mtmp.my)) {
        let point_msg;
        if (undirected) point_msg = 'all around, then curses';
        else if ((Invis() && !perceives(mtmp.data)
                  && (mtmp.mux !== game.u?.ux || mtmp.muy !== game.u?.uy))
                 || game.u?.uundetected) point_msg = 'and curses in your general direction';
        else if (Displaced() && (mtmp.mux !== game.u?.ux || mtmp.muy !== game.u?.uy))
            point_msg = 'and curses at your displaced image';
        else point_msg = 'at you, then curses';
        const { update_topl } = await import('./display.js');
        await update_topl(`${Monnam(mtmp)} points ${point_msg}.`);
    } else if (!((game.moves | 0) % 4) || !rn2(4)) {
        // Norep("You hear a mumbled curse.") — Deaf hero hears nothing.
        if (!Deaf()) {
            const { update_topl } = await import('./display.js');
            await update_topl('You hear a mumbled curse.');
        }
    }
}

// C ref: mcastu.c:130 castmu(mtmp, mattk, thinks_it_foundyou, foundyou).
// Returns M_ATTK_MISS / M_ATTK_HIT.
export async function castmu(mtmp, mattk, thinks_it_foundyou, foundyou) {
    const ml = mtmp.m_lev | 0;
    let spellnum = 0;

    if ((mattk.adtyp === AD_SPEL || mattk.adtyp === AD_CLRC) && ml) {
        let cnt = 40;
        do {
            spellnum = choose_monster_spell(mtmp, mattk.adtyp);
            /* not trying to attack?  don't allow directed spells */
            if (!thinks_it_foundyou) {
                if (!is_undirected_spell(spellnum)
                    || spell_would_be_useless(mtmp, spellnum))
                    return M_ATTK_MISS;
                break;
            }
        } while (--cnt > 0 && spell_would_be_useless(mtmp, spellnum));
        if (cnt === 0) return M_ATTK_MISS;
    }

    /* monster unable to cast spells? */
    if (mtmp.mcan || mtmp.mspec_used || !ml
        || m_seenres(mtmp, cvt_adtyp_to_mseenres(mattk.adtyp))) {
        await cursetxt(mtmp, is_undirected_spell(spellnum));
        return M_ATTK_MISS;
    }

    if (mattk.adtyp === AD_SPEL || mattk.adtyp === AD_CLRC)
        mtmp.mspec_used = (ml < 8) ? (10 - ml) : 2;

    if (!foundyou && thinks_it_foundyou && !is_undirected_spell(spellnum)) {
        // "%s casts a spell at %s!" — reachable only from mattacku's AT_MAGC
        // case, which this port does not wire up yet.
        return M_ATTK_MISS;
    }

    const { nomul } = await import('./hack.js');
    nomul(0);
    if (rn2(ml * 10) < (mtmp.mconf ? 100 : 20)) { /* fumbled attack */
        const { canseemon_shared } = await import('./display.js');
        if (canseemon_shared(mtmp) && !Deaf()) {
            const { update_topl } = await import('./display.js');
            const { mon_nam } = await import('./uhitm.js');
            await update_topl(`The air crackles around ${mon_nam(mtmp)}.`);
        }
        return M_ATTK_MISS;
    }

    {
        const { canspotmon } = await import('./uhitm.js');
        if (canspotmon(mtmp) || !is_undirected_spell(spellnum)) {
            const { update_topl } = await import('./display.js');
            const { Monnam } = await import('./uhitm.js');
            const who = canspotmon(mtmp) ? Monnam(mtmp) : 'Something';
            const at = is_undirected_spell(spellnum) ? ''
                : ((Invis() && !perceives(mtmp.data)
                    && !(mtmp.mux === game.u?.ux && mtmp.muy === game.u?.uy))
                   ? ' at a spot near you'
                   : (Displaced()
                      && !(mtmp.mux === game.u?.ux && mtmp.muy === game.u?.uy))
                     ? ' at your displaced image'
                     : ' at you');
            await update_topl(`${who} casts a spell${at}!`);
        }
    }

    // mcastu.c:232 — with !foundyou the damage roll is skipped entirely (dmg=0),
    // which is the only case the dochug caller can reach.
    let dmg = 0;
    if (foundyou) dmg = mattk.damd ? d(((ml / 2) | 0) + mattk.damn, mattk.damd)
                                   : d(((ml / 2) | 0) + 1, 6);

    if (mattk.adtyp === AD_SPEL || mattk.adtyp === AD_CLRC)
        await mcast_spell(mtmp, dmg, spellnum);
    // AD_FIRE/AD_COLD/AD_MAGM variants of AT_MAGC belong to buzzmu's callers.

    return M_ATTK_HIT;
}

// C ref: mcastu.c:801 mcast_spell().  castmu reaches this for both the
// undirected dochug path and AT_MAGC attacks handled by mattacku.  Keep the
// damage application beside each implemented directed spell until every arm
// has C's explicit dmg=0 handling.
async function mcast_spell(mtmp, dmg, spellnum) {
    switch (spellnum) {
    case MCAST_PSI_BOLT: {
        dmg = await mcast_psi_bolt(dmg);
        if (dmg) {
            const { mdamageu } = await import('./mhitu.js');
            await mdamageu(mtmp, dmg);
        }
        break;
    }
    case MCAST_CURE_SELF:
        // mcastu.c:441 m_cure_self: heal 3d6 when hurt.
        if (mtmp.mhp < mtmp.mhpmax) {
            const { canseemon_shared } = await import('./display.js');
            const heal = d(3, 6);
            if (canseemon_shared(mtmp)) {
                const { update_topl } = await import('./display.js');
                const { Monnam } = await import('./uhitm.js');
                await update_topl(`${Monnam(mtmp)} looks better.`);
            }
            healmon(mtmp, heal, 0);
        }
        break;
    case MCAST_HASTE_SELF: {
        const { mon_adjust_speed } = await import('./muse.js');
        await mon_adjust_speed(mtmp, 1, null);
        break;
    }
    case MCAST_SUMMON_MONS: {
        // C ref: mcastu.c:421 mcast_summon_mons(mtmp) — nasty(mtmp) is the
        // whole effect and it is far from RNG-free (rnd(u.ulevel/3) outer
        // iterations, an rn2(44) pick_nasty per slot, makemon, rnd(4)).
        const { nasty } = await import('./wizard.js');
        const count = await nasty(mtmp);
        if (count) {
            const { update_topl } = await import('./display.js');
            if (mtmp.iswiz) {
                await update_topl(`"Destroy the thief, my pet${count === 1 ? '' : 's'}!"`);
            } else {
                const mappear = (count === 1) ? 'A monster appears' : 'Monsters appear';
                await update_topl(`${mappear} from nowhere!`);
            }
        }
        break;
    }
    case MCAST_CLONE_WIZ: {
        // C ref: mcastu.c:411 mcast_clone_wiz(mtmp).
        if (mtmp.iswiz && (game.context?.no_of_wizards | 0) === 1) {
            const { update_topl } = await import('./display.js');
            await update_topl('Double Trouble...');
            const { clonewiz } = await import('./wizard.js');
            await clonewiz();
        }
        break;
    }
    default:
        // The remaining undirected spells (DISAPPEAR, INSECTS, AGGRAVATION)
        // need mon_set_minvis / the insect-swarm makemon loop that this port
        // does not carry; their spell_would_be_useless() draws have already
        // fired, so the stream stays aligned up to the effect.
        break;
    }
}

// ---------------------------------------------------------------------------
// Small property shims.  Each names the C predicate it stands in for; all are
// RNG-free and constant for the heroes these sessions drive.
function Antimagic() { return !!game.u?.Antimagic; }
function Hallucination() { return !!(game.u?.Hallucination); }
function Blinded() { return !!(game.u?.Blinded); }
function See_invisible() { return !!game.u?.See_invisible; }
function Invis() { return !!game.u?.uinvis; }
function Displaced() { return !!game.u?.Displaced; }
function Deaf() { return !!game.u?.Deaf; }
function perceives(mdat) { return !!(mdat && mdat.perceives); }

// C ref: monst.h m_seenres(mon, bit).
function m_seenres(mon, bit) { return bit !== 0 && ((mon?.seen_resistance | 0) & bit) !== 0; }
// C ref: mondata.c:1522 cvt_adtyp_to_mseenres().  AD_SPEL/AD_CLRC fall through
// to M_SEEN_NOTHING, so castmu's m_seenres() term is FALSE for a spellcaster.
function cvt_adtyp_to_mseenres(adtyp) {
    switch (adtyp) {
    case AD_MAGM: return M_SEEN_MAGR;
    case AD_FIRE: return M_SEEN_FIRE;
    case AD_COLD: return M_SEEN_COLD;
    case AD_SLEE: return M_SEEN_SLEEP;
    case AD_DISN: return M_SEEN_DISINT;
    case AD_ELEC: return M_SEEN_ELEC;
    case AD_DRST: return M_SEEN_POISON;
    case AD_ACID: return M_SEEN_ACID;
    default: return M_SEEN_NOTHING;
    }
}

// C ref: wizard.c:474 has_aggravatables(mon) — any live monster on the same
// side of the Wizard's tower barrier that is still waiting for the hero or is
// helpless.  In_W_tower is FALSE everywhere outside the tower, so the two
// barrier tests collapse; keep them written out for when the tower lands.
function has_aggravatables(mon) {
    const in_w_tower = In_W_tower(mon.mx, mon.my);
    if (in_w_tower !== In_W_tower(game.u?.ux, game.u?.uy)) return false;
    for (const mtmp of (game.level?.monsters || [])) {
        if (!mtmp || (mtmp.mhp | 0) < 1) continue;
        if (in_w_tower !== In_W_tower(mtmp.mx, mtmp.my)) continue;
        if (((mtmp.mstrategy | 0) & STRAT_WAITFORU) !== 0 || helpless(mtmp))
            return true;
    }
    return false;
}
function In_W_tower(_x, _y) { return false; }
// C ref: mon.c helpless(mon).
function helpless(mon) {
    return !!(mon.msleeping || !mon.mcanmove || (mon.mfrozen | 0) > 0);
}

// ===========================================================================
// The rest of src/mcastu.c.  INERT: nothing above this line calls anything
// below it, and mcast_spell() above keeps its own reduced arm set on purpose.
// Wiring these up means routing mcast_spell()/castmu() through them AND first
// replacing the shims at the bottom of this section — several of those stand in
// for RNG-BEARING C functions, so swapping one changes the draw stream.
//
// Every function keeps its C name, argument order and return type.  The
// per-function draw order is the load-bearing part: e.g. mcast_lightning()
// calls ureflects() BEFORE its d(8,6), and mcast_insects() calls mkclass(S_ANT)
// BEFORE its census, so a caller that reorders them desyncs.
// ===========================================================================

import { rnd } from './rng.js';
import { AD_SPC2 } from './monattk_data.js';
import { A_DEX, KILLED_BY, DIED, M_SEEN_REFL, HEAD, EYE } from './const.js';

// C ref: monsym.h — mons[].mlet values mcast_insects() picks its class from.
const S_ANT_MCLS = 1, S_SNAKE_MCLS = 45;

// C ref: mcastu.c:307 m_cure_self(mtmp, dmg) — heal 3d6 when hurt; returns the
// (possibly zeroed) pending damage.  d(3,6) fires only when mhp < mhpmax.
export async function m_cure_self(mtmp, dmg) {
    if (mtmp.mhp < mtmp.mhpmax) {
        const { canseemon_shared } = await import('./display.js');
        if (canseemon_shared(mtmp)) {
            const { update_topl } = await import('./display.js');
            const { Monnam } = await import('./uhitm.js');
            await update_topl(`${Monnam(mtmp)} looks better.`);
        }
        const { healmon: heal } = await import('./mon.js');
        heal(mtmp, d(3, 6), 0);
        dmg = 0;
    }
    return dmg;
}

// C ref: mcastu.c:322 touch_of_death(mtmp).  d(8, 6) is drawn FIRST, as part of
// `dmg = 50 + d(8,6)`, before any message or hp bookkeeping.
export async function touch_of_death(mtmp) {
    let dmg = 50 + d(8, 6);
    const drain = Math.trunc(dmg / 2);
    const u = game.u;
    const { update_topl } = await import('./display.js');

    /* if we get here, we know that hero isn't magic resistant and isn't
       poly'd into an undead or demon */
    await update_topl('You feel drained...');
    const kbuf = death_inflicted_by('', 'the touch of death', mtmp);

    if (Upolyd()) {
        u.mh = 0;
        const { rehumanize } = await import('./polyself.js');
        await rehumanize();            /* fatal iff Unchanging */
    } else if (drain >= (u.uhpmax | 0)) {
        game.killer = game.killer || {};
        game.killer.format = KILLED_BY;
        game.killer.name = kbuf;
        await done_(DIED);
    } else {
        /* HP manipulation similar to poisoned(attrib.c) */
        const olduhp = u.uhp | 0;
        const { minuhpmax, setuhpmax } = await import('./exper.js');
        const uhpmin = minuhpmax(3), newuhpmax = (u.uhpmax | 0) - drain;

        setuhpmax(Math.max(newuhpmax, uhpmin), false);
        dmg = adjuhploss(dmg, olduhp);
        await losehp_(dmg, kbuf, KILLED_BY);
    }
    if (game.killer) game.killer.name = '';  /* not killed if we get here... */
}

// C ref: mcastu.c:357 death_inflicted_by(outbuf, deathreason, mtmp).  No RNG.
// C writes into the caller's buffer and returns it; here the buffer argument is
// ignored and the assembled string is the return value.
export function death_inflicted_by(_outbuf, deathreason, mtmp) {
    let outbuf = String(deathreason);
    if (mtmp) {
        const mptr = mtmp.data;
        const champtr = ismnum_(mtmp.cham) ? mons_(mtmp.cham) : mptr;
        let realnm = pmname(champtr, Mgender_(mtmp));
        const fakenm = pmname(mptr, Mgender_(mtmp));

        /* greatly simplified extract from done_in_by() */
        if (!type_is_pname_(champtr) && !the_unique_pm_(mptr)) realnm = an_(realnm);
        outbuf += ` inflicted by ${the_unique_pm_(mptr) ? 'the ' : ''}${realnm}`;
        if (champtr !== mptr) outbuf += ` imitating ${an_(fakenm)}`;
    }
    return outbuf;
}

// C ref: mcastu.c:388 mcast_death_touch(mtmp).  `!Antimagic && rn2(m_lev) > 12`
// short-circuits, so an Antimagic hero draws NOTHING here.
export async function mcast_death_touch(mtmp) {
    const { update_topl } = await import('./display.js');
    await update_topl(`Oh no, ${mhe_(mtmp)}'s using the touch of death!`);
    if (nonliving_(youmonst_data()) || is_demon_(youmonst_data())) {
        await update_topl('You seem no deader than before.');
    } else if (!Antimagic() && rn2(mtmp.m_lev | 0) > 12) {
        if (Hallucination()) {
            await update_topl('You have an out of body experience.');
        } else {
            await touch_of_death(mtmp);
        }
        monstunseesu(M_SEEN_MAGR);
    } else {
        if (Antimagic()) {
            shieldeff(game.u?.ux, game.u?.uy);
            monstseesu(M_SEEN_MAGR);
        }
        await update_topl("Lucky for you, it didn't work!");
    }
}

// C ref: mcastu.c:410 mcast_clone_wiz(mtmp).  clonewiz() carries the RNG.
export async function mcast_clone_wiz(mtmp) {
    const { update_topl, impossible } = await import('./display.js');
    if (mtmp.iswiz && (game.context?.no_of_wizards | 0) === 1) {
        await update_topl('Double Trouble...');
        const { clonewiz } = await import('./wizard.js');
        await clonewiz();
    } else {
        await impossible('bad wizard cloning?');
    }
}

// C ref: mcastu.c:420 mcast_summon_mons(mtmp).  nasty(mtmp) is the whole draw
// set (rnd(u.ulevel/3) iterations, an rn2(44) pick_nasty per slot, makemon,
// rnd(4)); it runs BEFORE any of the message tests below.
export async function mcast_summon_mons(mtmp) {
    const { nasty } = await import('./wizard.js');
    const count = await nasty(mtmp);
    const { update_topl } = await import('./display.js');

    if (!count) {
        /* nothing was created? */
    } else if (mtmp.iswiz) {
        await update_topl(`"Destroy the thief, my pet${plur_(count)}!"`);
    } else {
        const one = (count === 1);
        const mappear = one ? 'A monster appears' : 'Monsters appear';

        if (Invis() && !perceives(mtmp.data)
            && (mtmp.mux !== game.u?.ux || mtmp.muy !== game.u?.uy))
            await update_topl(`${mappear} ${one ? 'at' : 'around'} a spot near you!`);
        else if (Displaced() && (mtmp.mux !== game.u?.ux || mtmp.muy !== game.u?.uy))
            await update_topl(`${mappear} ${one ? 'by' : 'around'} your displaced image!`);
        else
            await update_topl(`${mappear} from nowhere!`);
    }
}

// C ref: mcastu.c:449 mcast_destroy_armor(void).  destroy_arm() is RNG-BEARING
// and is skipped entirely for an Antimagic hero.
export async function mcast_destroy_armor() {
    const { update_topl } = await import('./display.js');
    if (Antimagic()) {
        shieldeff(game.u?.ux, game.u?.uy);
        monstseesu(M_SEEN_MAGR);
        await update_topl('A field of force surrounds you!');
    } else if (!await destroy_arm_()) {
        await update_topl('Your skin itches.');
    } else {
        /* monsters only realize you aren't magic-protected if armor is
           actually destroyed */
        monstunseesu(M_SEEN_MAGR);
    }
}

// C ref: mcastu.c:465 mcast_weaken_you(mtmp, dmg).  The rnd(dmg) inside
// losestr() is the only draw, and the incoming dmg is DISCARDED first
// (dmg = m_lev - 6), so the caller's damage roll does not feed it.
export async function mcast_weaken_you(mtmp, dmg) {
    const { update_topl } = await import('./display.js');
    if (Antimagic()) {
        shieldeff(game.u?.ux, game.u?.uy);
        monstseesu(M_SEEN_MAGR);
        await update_topl('You feel momentarily weakened.');
    } else {
        await update_topl('You suddenly feel weaker!');
        dmg = (mtmp.m_lev | 0) - 6;
        if (dmg < 1) dmg = 1;   /* paranoia since only chosen when m_lev is high */
        if (Half_spell_damage()) dmg = Math.trunc((dmg + 1) / 2);
        const kbuf = death_inflicted_by('', 'strength loss', mtmp);
        const { losestr } = await import('./attrib.js');
        losestr(rnd(dmg), kbuf, KILLED_BY);
        if (game.killer) game.killer.name = ''; /* not killed if we get here... */
        monstunseesu(M_SEEN_MAGR);
    }
}

// C ref: mcastu.c:489 mcast_disappear(mtmp).  No RNG.
export async function mcast_disappear(mtmp) {
    const { update_topl, impossible } = await import('./display.js');
    if (!mtmp.minvis && !mtmp.invis_blkd) {
        const { canseemon_shared } = await import('./display.js');
        if (canseemon_shared(mtmp)) {
            const { Monnam } = await import('./uhitm.js');
            await update_topl(`${Monnam(mtmp)} suddenly `
                + `${!See_invisible() ? 'disappears' : 'becomes transparent'}!`);
        }
        mon_set_minvis(mtmp, false);
        const { canspotmon } = await import('./uhitm.js');
        const { cansee } = await import('./vision.js');
        if (cansee(mtmp.mx, mtmp.my) && !canspotmon(mtmp)) {
            const { map_invisible } = await import('./display.js');
            map_invisible(mtmp.mx, mtmp.my);
        }
    } else {
        await impossible('no reason for monster to cast disappear spell?');
    }
}

// C ref: mcastu.c:503 mcast_stun_you(dmg).  Antimagic/Free_action takes the
// no-draw arm; otherwise d(ACURR(A_DEX) < 12 ? 6 : 4, 4).
export async function mcast_stun_you(dmg) {
    const { update_topl } = await import('./display.js');
    if (Antimagic() || Free_action()) {
        shieldeff(game.u?.ux, game.u?.uy);
        monstseesu(M_SEEN_MAGR);
        if (!Stunned_()) await update_topl('You feel momentarily disoriented.');
        await make_stunned_(1, false);
    } else {
        await update_topl(Stunned_() ? 'You struggle to keep your balance.'
                                     : 'You reel...');
        dmg = d(ACURR_(A_DEX) < 12 ? 6 : 4, 4);
        if (Half_spell_damage()) dmg = Math.trunc((dmg + 1) / 2);
        await make_stunned_(HStun_() + dmg, false);
        monstunseesu(M_SEEN_MAGR);
    }
}

// C ref: mcastu.c:522 mcast_geyser(dmg) — physical (force, not heat) damage.
// The incoming dmg is discarded: `dmg = d(8, 6)`.
export async function mcast_geyser(dmg) {
    const { update_topl } = await import('./display.js');
    await update_topl('A sudden geyser slams into you from nowhere!');
    dmg = d(8, 6);
    if (Half_physical_damage()) dmg = Math.trunc((dmg + 1) / 2);
    /* C's water_damage_chain() of the floor pile is #if 0'd out */
    return dmg;
}

// C ref: mcastu.c:539 mcast_fire_pillar(mtmp, dmg).  Draw order:
// d(8,6) -> burnarmor() -> destroy_items(AD_FIRE, orig_dmg) -> ignite_items()
// -> mon_spell_hits_spot().  Note orig_dmg (the UNHALVED roll) is what
// destroy_items sees, even for a fire-resistant hero whose dmg is 0.
export async function mcast_fire_pillar(mtmp, dmg) {
    const { update_topl } = await import('./display.js');
    let orig_dmg;

    await update_topl('A pillar of fire strikes all around you!');
    orig_dmg = dmg = d(8, 6);
    if (Fire_resistance_()) {
        shieldeff(game.u?.ux, game.u?.uy);
        monstseesu(M_SEEN_FIRE);
        dmg = 0;
    } else {
        monstunseesu(M_SEEN_FIRE);
    }
    if (Half_spell_damage()) dmg = Math.trunc((dmg + 1) / 2);
    const { burn_away_slime } = await import('./timeout.js');
    await burn_away_slime();
    const { burnarmor, destroy_items, ignite_items } = await import('./zap.js');
    await burnarmor(game.u);
    /* item destruction dmg */
    await destroy_items(game.u, AD_FIRE, orig_dmg);
    await ignite_items(invent_());
    /* burn up flammable items on the floor, melt ice terrain */
    await mon_spell_hits_spot(mtmp, AD_FIRE, game.u?.ux, game.u?.uy);
    return dmg;
}

// C ref: mcastu.c:565 mcast_lightning(mtmp, dmg).  ureflects() runs BEFORE the
// d(8,6); a reflecting hero returns early and never reaches destroy_items,
// mon_spell_hits_spot or flashburn's rnd(100).
export async function mcast_lightning(mtmp, dmg) {
    const { update_topl } = await import('./display.js');
    let orig_dmg;

    await update_topl('A bolt of lightning strikes down at you from above!');
    const reflects = await ureflects_('It bounces off your %s%s.', '');
    orig_dmg = dmg = d(8, 6);
    if (reflects || Shock_resistance_()) {
        shieldeff(game.u?.ux, game.u?.uy);
        dmg = 0;
        if (reflects) {
            monstseesu(M_SEEN_REFL);
            return dmg;
        }
        monstunseesu(M_SEEN_REFL);
        monstseesu(M_SEEN_ELEC);
    } else {
        monstunseesu(M_SEEN_ELEC | M_SEEN_REFL);
    }
    if (Half_spell_damage()) dmg = Math.trunc((dmg + 1) / 2);
    const { destroy_items } = await import('./zap.js');
    await destroy_items(game.u, AD_ELEC, orig_dmg);
    /* lightning might destroy iron bars if hero is on such a spot; do this
       before maybe blinding the hero via flashburn() */
    await mon_spell_hits_spot(mtmp, AD_ELEC, game.u?.ux, game.u?.uy);
    /* blind hero; no effect if already blind */
    await flashburn_(rnd(100), true);
    return dmg;
}

// C ref: mcastu.c:600 mcast_psi_bolt(dmg).  No RNG; the message tier is read
// off the (possibly halved) damage.
export async function mcast_psi_bolt(dmg) {
    const { update_topl } = await import('./display.js');
    if (Antimagic()) {
        shieldeff(game.u?.ux, game.u?.uy);
        monstseesu(M_SEEN_MAGR);
        dmg = Math.trunc((dmg + 1) / 2);
    } else {
        monstunseesu(M_SEEN_MAGR);
    }
    const { body_part } = await import('./polyself.js');
    if (dmg <= 5) await update_topl(`You get a slight ${body_part(HEAD)}ache.`);
    else if (dmg <= 10) await update_topl('Your brain is on fire!');
    else if (dmg <= 20) await update_topl(`Your ${body_part(HEAD)} suddenly aches painfully!`);
    else await update_topl(`Your ${body_part(HEAD)} suddenly aches very painfully!`);
    return dmg;
}

// C ref: mcastu.c:623 mcast_open_wounds(dmg).  No RNG.
export async function mcast_open_wounds(dmg) {
    const { update_topl } = await import('./display.js');
    if (Antimagic()) {
        shieldeff(game.u?.ux, game.u?.uy);
        monstseesu(M_SEEN_MAGR);
        dmg = Math.trunc((dmg + 1) / 2);
    } else {
        monstunseesu(M_SEEN_MAGR);
    }
    if (dmg <= 5) await update_topl('Your skin itches badly for a moment.');
    else if (dmg <= 10) await update_topl('Wounds appear on your body!');
    else if (dmg <= 20) await update_topl('Severe wounds appear on your body!');
    else await update_topl('Your body is covered with painful wounds!');
    return dmg;
}

// C ref: mcastu.c:644 mcast_insects(mtmp).  Draw order, all load-bearing:
//   mkclass(S_ANT, 0)                       -- decides ants vs snakes
//   monster_census(TRUE)                    -- no RNG
//   rnd(m_lev / 2)                          -- only when m_lev >= 2
//   quan+1 iterations of  enexto() then mkclass(let, 0) then makemon()
//   monster_census(TRUE)
//   bogusmon() when Hallucination           -- RNG
// The loop is `for (i = 0; i <= quan; i++)`, i.e. quan+1 attempts, and a failed
// enexto() RETURNS from the whole function (skipping both the second census and
// every message).
export async function mcast_insects(mtmp) {
    const M = await import('./makemon.js');
    /* Try for insects, and if there are none left, go for (sticks to) snakes. */
    let pm = M.mkclass(S_ANT_MCLS, 0);
    let mtmp2 = null;
    const let_ = pm ? S_ANT_MCLS : S_SNAKE_MCLS;
    let success = false;
    let i, quan, oldseen, newseen;

    oldseen = monster_census_(true);
    quan = ((mtmp.m_lev | 0) < 2) ? 1 : rnd(Math.trunc((mtmp.m_lev | 0) / 2));
    if (quan < 3) quan = 3;
    for (i = 0; i <= quan; i++) {
        const bypos = enexto_(mtmp.mux, mtmp.muy, mtmp.data);
        if (!bypos) return;
        if ((pm = M.mkclass(let_, 0)) != null
            && (mtmp2 = await M.makemon(pm, bypos.x, bypos.y, MM_ANGRY | MM_NOMSG)) != null) {
            success = true;
            mtmp2.msleeping = 0; mtmp2.mpeaceful = 0; mtmp2.mtame = 0;
            M.set_malign(mtmp2);
        }
    }
    newseen = monster_census_(true);

    /* not canspotmon() which includes unseen things sensed via warning */
    const { canseemon_shared, tp_sensemon, update_topl } = await import('./display.js');
    const seecaster = canseemon_shared(mtmp) || tp_sensemon(mtmp) || Detect_monsters_();
    let what = (let_ === S_SNAKE_MCLS) ? 'snakes' : 'insects';
    let hallu = false;
    if (Hallucination()) {
        const { bogusmon } = await import('./do_name.js');
        const { makeplural } = await import('./invent.js');
        what = makeplural(bogusmon());
        hallu = true;
    }

    let fmt = 0;
    if (!seecaster) {
        if (newseen <= oldseen || Unaware_()) {
            /* unseen caster fails or summons unseen critters, or unconscious
               hero ("You dream that you hear...") */
            await update_topl(`You hear someone summoning ${what}.`);
        } else {
            /* unseen caster summoned seen critter(s) */
            const { makesingular } = await import('./objnam.js');
            const arg = (newseen === oldseen + 1) ? an_(makesingular(what)) : what;
            if (!Deaf()) {
                await update_topl(`You hear someone summoning something, and `
                    + `${arg} ${vtense_(arg, 'appear')}.`);
            } else {
                await update_topl(`${upstart_(arg)} ${vtense_(arg, 'appear')}.`);
            }
        }
    } else if (!success) {
        fmt = '%s casts at a clump of sticks, but nothing happens.%s';
        what = '';
    } else if (let_ === S_SNAKE_MCLS) {
        fmt = '%s transforms a clump of sticks into %s!';
    } else if (Invis() && !perceives(mtmp.data)
               && (mtmp.mux !== game.u?.ux || mtmp.muy !== game.u?.uy)) {
        fmt = '%s summons %s around a spot near you!';
    } else if (Displaced() && (mtmp.mux !== game.u?.ux || mtmp.muy !== game.u?.uy)) {
        fmt = '%s summons %s around your displaced image!';
    } else {
        fmt = '%s summons %s!';
    }
    if (fmt) {
        const { Monnam } = await import('./uhitm.js');
        await update_topl(String(fmt).replace('%s', Monnam(mtmp)).replace('%s', what));
    }
    void hallu;
}

// C ref: mcastu.c:728 mcast_blind_you(void).  No RNG (make_blinded's duration is
// a fixed 100/200).
export async function mcast_blind_you() {
    const { update_topl, impossible } = await import('./display.js');
    /* note: resists_blnd() doesn't apply here */
    if (!Blinded()) {
        const { eyecount, body_part } = await import('./polyself.js');
        const num_eyes = eyecount(youmonst_data());
        const { makeplural } = await import('./invent.js');

        await update_topl(`Scales cover your `
            + `${(num_eyes === 1) ? body_part(EYE) : makeplural(body_part(EYE))}!`);
        await make_blinded_(Half_spell_damage() ? 100 : 200, false);
        if (!Blind_()) await update_topl('Your vision quickly clears.');
    } else {
        await impossible('no reason for monster to cast blindness spell?');
    }
}

// C ref: mcastu.c:745 mcast_paralyze(mtmp).  No RNG; returns the nomul() length
// (1 for the resisted case, so the hero still loses one move).
export async function mcast_paralyze(mtmp) {
    const { update_topl } = await import('./display.js');
    let dmg = 0;

    if (Antimagic() || Free_action()) {
        shieldeff(game.u?.ux, game.u?.uy);
        monstseesu(M_SEEN_MAGR);
        if ((game.multi | 0) >= 0) await update_topl('You stiffen briefly.');
        dmg = 1; /* to produce nomul(-1), not actual damage */
    } else {
        if ((game.multi | 0) >= 0) await update_topl('You are frozen in place!');
        dmg = 4 + (mtmp.m_lev | 0);
        if (Half_spell_damage()) dmg = Math.trunc((dmg + 1) / 2);
        monstunseesu(M_SEEN_MAGR);
    }
    const { nomul } = await import('./hack.js');
    nomul(-dmg);
    game.multi_reason = 'paralyzed by a monster';
    game.nomovemsg = 0;
    return dmg;
}

// C ref: mcastu.c:770 mcast_confuse_you(mtmp).  No RNG.
export async function mcast_confuse_you(mtmp) {
    const { update_topl } = await import('./display.js');
    if (Antimagic()) {
        shieldeff(game.u?.ux, game.u?.uy);
        monstseesu(M_SEEN_MAGR);
        await update_topl('You feel momentarily dizzy.');
    } else {
        const oldprop = !!Confusion_();
        let dmg = mtmp.m_lev | 0;

        if (Half_spell_damage()) dmg = Math.trunc((dmg + 1) / 2);
        await make_confused_(HConfusion_() + dmg, true);
        if (Hallucination())
            await update_topl(`You feel ${oldprop ? 'trippier' : 'trippy'}!`);
        else
            await update_topl(`You feel ${oldprop ? 'more ' : ''}confused!`);
        monstunseesu(M_SEEN_MAGR);
    }
}

// C ref: mcastu.c:988 buzzmu(mtmp, mattk) — the ranged (AT_MAGC at distance)
// monster spell.  lined_up() is RNG-BEARING for a polymorphed hero (m_lined_up's
// rn2(25)) and is evaluated BEFORE the rn2(3), so both draws happen in that
// order and the rn2(3) is skipped when the monster isn't lined up.
export async function buzzmu(mtmp, mattk) {
    /* don't print constant stream of curse messages for 'normal'
       spellcasting monsters at range */
    if (!BZ_VALID_ADTYP(mattk.adtyp)) return M_ATTK_MISS;

    if (mtmp.mcan || m_seenres(mtmp, cvt_adtyp_to_mseenres(mattk.adtyp))) {
        await cursetxt_(mtmp, false);
        return M_ATTK_MISS;
    }
    const { m_lined_up } = await import('./monmove.js');
    if (m_lined_up(mtmp) && rn2(3)) {
        const { nomul } = await import('./hack.js');
        nomul(0);
        const { canseemon_shared, update_topl } = await import('./display.js');
        if (canseemon_shared(mtmp)) {
            const { Monnam } = await import('./uhitm.js');
            await update_topl(`${Monnam(mtmp)} zaps you with a `
                + `${flash_str_(BZ_OFS_AD(mattk.adtyp))}!`);
        }
        game.buzzer = mtmp;
        const { dobuzz } = await import('./zap.js');
        // C reads gt.tbx/gt.tby, which linedup() set as a SIDE EFFECT of the
        // m_lined_up() call above (gt.tbx = ax - bx = mux - mx).  This port's
        // linedup (js/monmove.js:6738) computes them locally and discards them,
        // so recompute the same expression; js/monmove.js:6899 does likewise for
        // m_throw_at_hero.  Wiring gt.tbx/gt.tby into linedup() is the real fix.
        const tbx = (mtmp.mux ?? game.u?.ux) - mtmp.mx,
              tby = (mtmp.muy ?? game.u?.uy) - mtmp.my;
        await dobuzz(BZ_M_SPELL(BZ_OFS_AD(mattk.adtyp)), mattk.damn | 0,
                     mtmp.mx, mtmp.my, sgn_(tbx), sgn_(tby));
        game.buzzer = 0;
        return M_ATTK_HIT;
    }
    return M_ATTK_MISS;
}

// ---------------------------------------------------------------------------
// Shims for the section above.  Each names the C function it stands in for and
// where the real port lives; the ones marked RNG-BEARING must be replaced
// before any of the functions above is called for score, because a missing draw
// desyncs the shared stream from that point on.
// ---------------------------------------------------------------------------

// C ref: hack.h:1474 — the buzz() adtyp encoding.  monattk.h:43/52 give
// AD_MAGM == 1 and AD_SPC2 == 10, so the valid band is 1..10 and BZ_OFS_AD
// folds it to 0..9.
function BZ_VALID_ADTYP(adtyp) { return adtyp >= AD_MAGM && adtyp <= AD_SPC2; }
function BZ_OFS_AD(adtyp) { return Math.abs(adtyp - AD_MAGM) % 10; }
function BZ_M_SPELL(bztyp) { return -10 - bztyp; }

function sgn_(n) { return (n | 0) > 0 ? 1 : (n | 0) < 0 ? -1 : 0; }

// C ref: mcastu.c:62 cursetxt().  The live port above is module-private under
// the same name; this indirection exists only so buzzmu() reads like C.
async function cursetxt_(mtmp, undirected) { return cursetxt(mtmp, undirected); }

// C ref: mondata.c:1557/1572 monstseesu()/monstunseesu() — every monster with
// line of sight to the hero remembers (or forgets) that the hero resisted.  No
// RNG, but m_seenres() gates read the bit, so the state matters on later turns.
// js/muse.js:1794 has a private copy (monstseesu_muse); when a mondata.js port
// exports the real pair, delete these two.
function monstseesu(seenres) { monstseesu_core(seenres, false); }
function monstunseesu(seenres) { monstseesu_core(seenres, true); }
function monstseesu_core(seenres, clear) {
    if (!seenres || game.u?.uswallow) return;
    for (const mon of (game.level?.monsters || [])) {
        if (!mon || (mon.mhp | 0) < 1) continue;
        if (!couldsee(mon.mx, mon.my)) continue;   /* m_canseeu() */
        mon.seen_resistance = clear ? ((mon.seen_resistance | 0) & ~seenres)
                                   : ((mon.seen_resistance | 0) | seenres);
    }
}

// C ref: display.c shieldeff(x, y) — the reflection/resistance flash.  Purely
// display, no RNG; js/zap.js already treats it as a no-op at its call sites.
function shieldeff(_x, _y) { /* display-only */ }

// C ref: mon.c mon_set_minvis(mon, adjust).  UNPORTED; js/zap.js:910 open-codes
// `mtmp.minvis = 1` with a comment naming it.  No RNG.
function mon_set_minvis(mon, _adjust) { if (mon) mon.minvis = 1; }

// C ref: zap.c mon_spell_hits_spot(mon, adtyp, x, y) -> zap_over_floor().
// UNPORTED and RNG-BEARING (zap_over_floor rolls for each susceptible floor
// object and for melting/freezing terrain).
async function mon_spell_hits_spot(_mon, _adtyp, _x, _y) { /* UNPORTED */ }

// C ref: read.c destroy_arm() — RNG-BEARING (picks a worn slot).  The port is
// js/read.js:1455 but module-private; exporting it is the fix.
async function destroy_arm_() { return false; }

// C ref: zap.c ureflects(fmt, str) — no RNG.  Port is js/zap.js:1566, private.
async function ureflects_(_fmt, _str) { return false; }

// C ref: zap.c flashburn(duration, via_lightning) — port is js/zap.js:2845,
// private.  The rnd(100) argument is drawn by our caller, as in C.
async function flashburn_(_duration, _via_lightning) { return false; }

// C ref: mon.c monster_census(spotted) — no RNG.  Port is js/wizard.js:111,
// private (and takes no argument).
function monster_census_(_spotted) {
    let count = 0;
    for (const mtmp of (game.level?.monsters || []))
        if (mtmp && (mtmp.mhp | 0) >= 1) count++;
    return count;
}

// C ref: teleport.c enexto(cc, xx, yy, mdat) — RNG-BEARING (collect_coords
// shuffles each ring with rn2, and goodpos() draws rn2(13) for eels).  Ports
// exist at js/do.js:316 and js/dog.js:124, both module-private; exporting one is
// the fix.  Returns {x,y} or null (C returns a boolean and fills *cc).
function enexto_(_xx, _yy, _mdat) { return null; }

// C ref: attrib.c:1182 adjuhploss(loss, olduhp) — UNPORTED (js/attrib.js:219
// open-codes a comment naming it).  No RNG.
function adjuhploss(loss, olduhp) {
    const u = game.u;
    if (!Upolyd()) {
        if ((u.uhp | 0) < olduhp) loss -= (olduhp - (u.uhp | 0));
    } else {
        if ((u.mh | 0) < olduhp) loss -= (olduhp - (u.mh | 0));
    }
    return Math.max(loss, 1);
}

// C ref: uhitm.c losehp(n, knam, k_format) / end.c done(how).  Ports are
// js/zap.js:2490 and js/end.js:374, both module-private.
async function losehp_(_n, _knam, _kformat) { /* private in js/zap.js */ }
async function done_(_how) { /* private in js/end.js */ }

// C ref: potion.c make_blinded / read.c make_stunned,make_confused — ports are
// js/potion.js:222, js/read.js:1538 and js/read.js:143, all module-private.
async function make_blinded_(_xtime, _talk) { }
async function make_stunned_(_xtime, _talk) { }
async function make_confused_(_xtime, _talk) { }

// C ref: zap.c flash_str(type, force_Tulip) — port is js/zap.js:1881, private.
function flash_str_(_type) { return 'spell'; }

// ---- hero property / naming shims (all RNG-free) ------------------------
function Upolyd() { return !!game.u?.Upolyd; }
function Blind_() { return (game.u?.Blinded | 0) > 0 || !!game.u?.ublindf; }
function Stunned_() { return !!(game.u?.uprops?.Stun || game.u?.Stunned); }
function Confusion_() { return HProp_('HConfusion') > 0 || !!game.u?.Confusion; }
function HConfusion_() { return HProp_('HConfusion'); }
function HStun_() { return HProp_('HStun'); }
function Free_action() { return HProp_('HFree_action') > 0 || HProp_('EFree_action') > 0; }
function Half_spell_damage() { return HProp_('HHalf_spell_damage') > 0; }
function Half_physical_damage() { return HProp_('HHalf_physical_damage') > 0; }
function Fire_resistance_() { return HProp_('HFire_resistance') > 0; }
function Shock_resistance_() { return HProp_('HShock_resistance') > 0; }
function Detect_monsters_() { return HProp_('HDetect_monsters') > 0; }
function Unaware_() { return !!(game.u?.usleep || game.u?.Unaware); }
function HProp_(name) { return (game.u?.uprops?.[name] | 0); }
function ACURR_(i) { return game.u?.acurr?.a?.[i] ?? 0; }
function youmonst_data() { return game.youmonst?.data || game.u?.data; }
function invent_() { return Array.isArray(game.invent) ? game.invent : []; }

// C ref: polyself.c body_part(part).  HEAD and EYE are hack.h body-part
// indices (const.js:378 / :371); js/polyself.js:451 exports the real
// body_part(), which this defers to when a caller can await.

// C ref: mondata.h nonliving(ptr) / is_demon(ptr).  Ports are js/wizcmds.js:85
// and js/monmove.js:4322, both private.
function nonliving_(ptr) { return !!ptr?.nonliving; }
function is_demon_(ptr) { return !!ptr?.demon; }
// C ref: do_name.c mhe(mtmp).  Port is js/muse.js:292, private.
function mhe_(mtmp) { return mtmp?.female ? 'she' : 'he'; }
function plur_(n) { return (n === 1) ? '' : 's'; }
// C ref: objnam.c an(str) — port is js/objnam.js/hack.js:2633, private there.
function an_(s) {
    const str = String(s || '');
    if (!str) return str;
    return (/^[aeiouAEIOU]/.test(str) ? 'an ' : 'a ') + str;
}
// C ref: hacklib.c vtense(subj, verb) / upstart(str).
function vtense_(subj, verb) {
    const s = String(subj || '');
    return /s$/.test(s) ? verb : `${verb}s`;
}
function upstart_(s) {
    const str = String(s || '');
    return str ? str[0].toUpperCase() + str.slice(1) : str;
}
// C ref: mondata.c pmname(ptr, gend) / do_name.c Mgender(mtmp) /
// mondata.h ismnum(x), type_is_pname(ptr), the_unique_pm(ptr).
function pmname(ptr, _gend) { return ptr?.name || 'creature'; }
function Mgender_(mtmp) { return mtmp?.female ? 1 : 0; }
function ismnum_(x) { return Number.isInteger(x) && x >= 0; }
// C ref: mons[idx] — js/makemon.js:642 monster_by_pmidx() is the accessor, but
// death_inflicted_by() is sync so it can't await the import; the cham field is
// NON_PM for every spellcaster these sessions run, so this arm is dead today.
function mons_(_idx) { return null; }
function type_is_pname_(ptr) { return !!ptr?.pname; }
function the_unique_pm_(ptr) { return !!ptr?.unique; }
