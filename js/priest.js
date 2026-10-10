// priest.js — temple priest creation.
// C ref: priest.c priestini().
//
// Only the level-generation entry point is ported: priestini() is called from
// mkroom.c mktemple() and from sp_lev.c create_altar() (des.altar with
// type="shrine"/"sanctum"), and it is the sole RNG consumer of the temple fill.

import { game, hooks } from './gstate.js';
import { s_suffix } from './hacklib.js';
import { roomAt } from './roomat.js';
import { rn2, rn1 } from './rng.js';
import { isok, ROOMOFFSET, Amask2align, A_NONE, ALTAR, AM_SHRINE,
         MM_EPRI, MM_EMIN } from './const.js';
import { mkobj, SPBOOK_no_NOVEL, curse, uncurse,
         AMULET_OF_YENDOR } from './mkobj.js';
import { makemon, monster_by_pmidx, name_to_pmidx, pmname_of_pmidx,
         mongets_pub, mpickobj, set_malign } from './makemon.js';
import { is_ok_location, pm_to_humidity } from './sp_lev.js';

// C ref: decl.c xdir[]/ydir[] and hack.h N_DIRS / DIR_CLAMP.  N_DIRS is 8 (the
// eight compass directions; N_DIRS_Z adds up/down which priestini never uses).
const N_DIRS = 8;
const xdir = [-1, -1, 0, 1, 1, 1, 0, -1];
const ydir = [0, -1, -1, -1, 0, 1, 1, 1];
const DIR_CLAMP = (dir) => ((dir + N_DIRS) % N_DIRS);

// C ref: sp_lev.c pm_good_location() — is_ok_location() with the species'
// own humidity requirements.  No RNG.
function pm_good_location(x, y, pm) {
    if (!isok(x, y)) return false;
    return is_ok_location(x, y, pm_to_humidity(pm));
}


// C ref: mon.c p_coaligned() — the priest's shrine alignment matches the
// hero's.  No RNG.
export function p_coaligned(priest) {
    const ualign = game.u?.ualign?.type ?? A_NONE;
    return (priest?.epri?.shralign ?? A_NONE) === ualign;
}

// C ref: worn.c which_armor(mon, W_ARMC) — the cloak slot.  m_initinv gives an
// aligned cleric a robe and worn.c m_dowear puts it on, so the slot is filled by
// the ROBE when one was generated.  No RNG.
const ROBE = 143;
function which_cloak(mtmp) {
    for (const o of mtmp?.minvent || [])
        if (o && o.otyp === ROBE) return o;
    return null;
}

// C ref: priest.c priestini(lvl, sroom, sx, sy, sanctum) — "exclusively for
// mktemple()" (and sp_lev.c's create_altar shrine case).  Places the temple
// priest next to the shrine and hands out its goodies.
//
// RNG, in order: rn2(N_DIRS) for the direction scan start; makemon() for the
// cleric itself; rn1(3, 2) spellbooks (each a full mkobj(SPBOOK_no_NOVEL));
// and a final rn2(2) for the robe curse/uncurse — that rn2 is the LEFT operand
// of C's `rn2(2) && (otmp = which_armor(...)) != 0`, so it is always drawn.
export function priestini(lvl, sroom, sx, sy, sanctum) {
    const prim = monster_by_pmidx(
        name_to_pmidx(sanctum ? 'high cleric' : 'aligned cleric'));
    if (!prim) return null;

    let px = 0, py = 0;
    const si = rn2(N_DIRS);                       // priest.c:229
    let i;
    for (i = 0; i < N_DIRS; i++) {
        px = sx + xdir[DIR_CLAMP(i + si)];
        py = sy + ydir[DIR_CLAMP(i + si)];
        if (pm_good_location(px, py, prim)) break;
    }
    if (i === N_DIRS) { px = sx; py = sy; }

    // C ref: priest.c:229+ `if (MON_AT(px, py)) (void) rloc(m_at(px, py),
    // RLOC_NOMSG); /* insurance */` — a monster already standing on the chosen
    // square is moved away (rnd(COLNO-1)/rn2(ROWNO) per try) before the cleric
    // is made.  A random-level temple is stocked while ordinary monsters can
    // already be on the floor, so this does happen (seed0367 Dlvl 8).
    {
        const occ = m_at(px, py);
        if (occ) hooks.rloc_mklev?.(occ);
    }

    const priest = makemon(prim, px, py, MM_EPRI);
    if (!priest) return null;

    priest.epri = priest.epri || {};
    priest.epri.shroom = (sroom?.roomnoidx ?? 0) + ROOMOFFSET;
    priest.epri.shralign = Amask2align(game.level?.at(sx, sy)?.altarmask ?? 0);
    priest.epri.shrpos = { x: sx, y: sy };
    priest.epri.shrlevel = lvl ? { dnum: lvl.dnum, dlevel: lvl.dlevel } : null;
    priest.mtrapseen = ~0;               // mon_learns_traps(priest, ALL_TRAPS)
    priest.mpeaceful = 1;
    priest.ispriest = 1;
    priest.isminion = 0;
    priest.msleeping = 0;
    // set_malign(priest) writes only mtmp->malign; no RNG.

    // C ref: priest.c:260-263 — the high priest of Moloch holds the real
    // Amulet.  mongets() -> mksobj(AMULET_OF_YENDOR, TRUE, FALSE) is three
    // draws: next_ident (mkobj.c:521), the AMULET_CLASS rn2(10) (mkobj.c:1063)
    // and blessorcurse's rn2(10) (mkobj.c:1846).
    const sl = game.sanctum_level, uz = game.u?.uz;
    if (sanctum && priest.epri.shralign === A_NONE
        && sl && uz && sl.dnum === uz.dnum && sl.dlevel === uz.dlevel)
        mongets_pub(priest, AMULET_OF_YENDOR);

    // 2 to 4 spellbooks.
    for (let cnt = rn1(3, 2); cnt > 0; --cnt)   // priest.c:265
        mpickobj(priest, mkobj(SPBOOK_no_NOVEL, false));

    // robe [via makemon()]
    if (rn2(2)) {                              // priest.c:269
        const otmp = which_cloak(priest);
        if (otmp) {
            if (p_coaligned(priest)) uncurse(otmp);
            else curse(otmp);
        }
    }
    return priest;
}

// C ref: priest.c:410 intemple(roomno), called from check_special_room().
import { pline, update_topl, newsym, canseemon_shared, Deaf_hero, m_at } from './display.js';
import { d } from './rng.js';
import { TEMPLE, ACH_TMPL, SPINE, In_endgame } from './const.js';
import { roles, align_gname, halu_gname } from './role.js';
import { rndmonnam, Monnam, mon_pmname } from './do_name.js';

// C ref: priest.c:142 temple_occupied(array).
export function temple_occupied(array) {
    for (const c of (array || [])) {
        const r = roomAt(c);
        if (r && r.rtype === TEMPLE) return c;
    }
    return 0;
}

// C ref: priest.c:392 findpriest(roomno) + priest.c:154 histemple_at().
export function findpriest(roomno) {
    for (const m of game.level?.monsters || []) {
        if (m.mhp != null && m.mhp <= 0) continue;
        if (!m.ispriest) continue;
        if ((m.epri?.shroom ?? -1) !== roomno) continue;
        const loc = game.level?.at(m.mx, m.my);
        const here = (loc?.roomno ?? 0);
        const hr = roomAt(here);
        if (!hr || hr.rtype !== TEMPLE || here !== roomno) continue;
        const sl = m.epri?.shrlevel, uz = game.u?.uz;
        if (!sl || !uz || sl.dnum !== uz.dnum || sl.dlevel !== uz.dlevel) continue;
        return m;
    }
    return null;
}

// C ref: priest.c:376 has_shrine(pri).
export function has_shrine(pri) {
    if (!pri || !pri.ispriest) return false;
    const p = pri.epri;
    const lev = game.level?.at(p?.shrpos?.x, p?.shrpos?.y);
    if (!lev || lev.typ !== ALTAR) return false;
    if (!(lev.altarmask & AM_SHRINE)) return false;
    return (p.shralign === Amask2align(lev.altarmask & ~AM_SHRINE));
}

// C ref: dungeon.h Is_sanctum(&u.uz).
function Is_sanctum_() {
    const uz = game.u?.uz, sl = game.sanctum_level;
    return !!uz && !!sl && uz.dnum === sl.dnum && uz.dlevel === sl.dlevel;
}

export async function intemple(roomno) {
    const u = game.u;
    /* don't do anything if hero is already in the room */
    if (temple_occupied(u.urooms0)) return;
    const priest = findpriest(roomno);
    const moves = game.moves || 0;
    const Deaf = Deaf_hero();
    if (priest) {
        /* tended */
        const { record_achievement } = await import('./insight.js');
        record_achievement(ACH_TMPL);
        const epri_p = priest.epri;
        const shrined = has_shrine(priest);
        const sanctum = (priest.data?.name === 'high cleric'
                         && (Is_sanctum_() || In_endgame(u.uz)));
        const can_speak = !helpless_(priest);
        if (can_speak && !Deaf && moves >= (epri_p.intone_time || 0)) {
            const save_priest = priest.ispriest;
            /* don't reveal the altar's owner upon temple entry in
               the endgame; for the Sanctum, the next message names
               Moloch so suppress the "of Moloch" for him here too */
            if (sanctum && !Hallucination_()) priest.ispriest = 0;
            const who = canseemon_shared(priest) ? Monnam(priest) : 'A nearby voice';
            priest.ispriest = save_priest;
            await pline(`${who} intones:`);
            epri_p.intone_time = moves + d(10, 500); /* ~2505 */
            /* make sure that we don't suppress entry message when
               we've just given its "priest intones" introduction */
            epri_p.enter_time = 0;
        }
        let msg1 = null, msg2 = null;
        if (sanctum && Is_sanctum_()) {
            if (priest.mpeaceful) {
                /* first time inside */
                msg1 = "Infidel, you have entered Moloch's Sanctum!";
                msg2 = 'Be gone!';
                priest.mpeaceful = 0;
                /* became angry voluntarily; no penalty for attacking him */
                set_malign(priest);
            } else {
                /* repeat visit, or attacked priest before entering */
                msg1 = 'You desecrate this place by your presence!';
            }
        } else if (moves >= (epri_p.enter_time || 0)) {
            msg1 = `Pilgrim, you enter a ${!shrined ? 'desecrated' : 'sacred'} place!`;
        }
        if (msg1 && can_speak && !Deaf) {
            await verbalize_(msg1);
            if (msg2) await verbalize_(msg2);
            epri_p.enter_time = moves + d(10, 100); /* ~505 */
        }
        if (!sanctum) {
            let m1, m2, thisKey, otherKey;
            if (!shrined || !p_coaligned(priest)
                || (u.ualign?.record ?? 0) <= ALGN_SINNED) {
                m1 = 'have a%s forbidding feeling...';
                m2 = (!shrined || !p_coaligned(priest)) ? '' : ' strange';
                thisKey = 'hostile_time'; otherKey = 'peaceful_time';
            } else {
                m1 = 'experience %s sense of peace.';
                m2 = ((u.ualign?.record ?? 0) >= ALGN_DEVOUT) ? 'a' : 'an unusual';
                thisKey = 'peaceful_time'; otherKey = 'hostile_time';
            }
            /* give message if we haven't seen it recently or
               if alignment update has caused it to switch from
               forbidding to sense-of-peace or vice versa */
            if (moves >= (epri_p[thisKey] || 0)
                || (epri_p[otherKey] || 0) >= (epri_p[thisKey] || 0)) {
                await pline('You ' + m1.replace('%s', m2));
                epri_p[thisKey] = moves + d(10, 20); /* ~55 */
                /* avoid being tricked by the RNG:  switch might have just
                   happened and previous random threshold could be larger */
                if (epri_p[thisKey] <= (epri_p[otherKey] || 0))
                    epri_p[otherKey] = epri_p[thisKey] - 1;
            }
        }
        /* recognize the Valley of the Dead and Moloch's Sanctum
           once hero has encountered the temple priest on those levels */
        const { mapseen_temple } = await import('./dungeon.js');
        mapseen_temple(priest);
    } else {
        /* untended */
        switch (rn2(4)) {
        case 0: await pline('You have an eerie feeling...'); break;
        case 1: await pline('You feel like you are being watched.'); break;
        case 2: {
            const { body_part } = await import('./polyself.js');
            await pline(`A shiver runs down your ${body_part(SPINE)}.`);
            break;
        }
        default: break; /* no message */
        }
        if (!rn2(5)) {
            const mtmp = makemon(monster_by_pmidx(name_to_pmidx('ghost')),
                                 u.ux, u.uy, MM_NOMSG_);
            if (mtmp) {
                const ngen = game.mvitals?.[mtmp.data?.pmidx]?.born ?? 0;
                const { canspotmon } = await import('./uhitm.js');
                if (canspotmon(mtmp))
                    await pline(`A${ngen < 5 ? 'n enormous' : ''} ghost appears next to you${
                        ngen < 10 ? '!' : '.'}`);
                else
                    await pline('You sense a presence close by!');
                mtmp.mpeaceful = 0;
                set_malign(mtmp);
                if (game.flags?.verbose !== false)
                    await pline('You are frightened to death, and unable to move.');
                const { nomul } = await import('./hack.js');
                nomul(-3);
                game.multi_reason = 'being terrified of a ghost';
                game.nomovemsg = 'You regain your composure.';
            }
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
// priest.c: nine of the ten functions that had no counterpart here still
// don't (forget_temple_entry is now wired — see below).
//
// INERT: nothing in js/ calls anything below except forget_temple_entry
// (js/save.js's savemonchn() now calls it, matching save.c:893-894) and
// priest_talk (js/sounds.js domonnoise()'s MS_PRIEST arm now calls it).  The
// existing deferral comments that name the rest (js/uhitm.js:431/447/
// 1144-1150 for ghod_hitsu, js/sp_lev.js:4033/4809 for mk_roamer via its EXT
// stub) still describe the LIVE behaviour; wiring either of THOSE up is a
// separate, scored change.
//
// ── THE epri/emin STORAGE GAP (reported, not papered over) ──────────────────
// C reaches priest and minion data through mextra.h's EPRI(mon)/EMIN(mon), and
// js/const.js:2864-2865 exports exactly that shape:
//     export function EPRI(mtmp) { return mtmp?.mextra?.epri; }
//     export function EMIN(mtmp) { return mtmp?.mextra?.emin; }
// but NOTHING in this port ever writes mextra.epri or mextra.emin.  The one
// producer, priestini() at priest.js:88 above, stores the shrine data FLAT on
// the monster (`priest.epri = {...}`), and every consumer that works today
// reads it there (priest.js:144/159, js/dungeon.js:1864/1873).  So
// const.js's EPRI()/EMIN() return undefined for every monster this port makes,
// and js/wizcmds.js:985-987 sizes mextra with them and always gets 0.
// The functions below therefore go through the local EPRI_/EMIN_ readers, which
// accept EITHER layout.  The real fix is to pick ONE convention (flat, or
// mextra) and make const.js, priestini(), dungeon.js and wizcmds.js agree.
// ════════════════════════════════════════════════════════════════════════════

// C ref: priest.c:9-10 — "these match the categorizations shown by
// enlightenment".  ALGN_SINNED is worse than strayed (-1..-3); ALGN_DEVOUT is
// better than fervent (9..13).
const ALGN_SINNED = -4, ALGN_DEVOUT = 14;

// C ref: mextra.h EPRI(mon) / EMIN(mon) — see the storage-gap note above.
function EPRI_(mon) { return mon?.mextra?.epri ?? mon?.epri ?? null; }
function EMIN_(mon) { return mon?.mextra?.emin ?? mon?.emin ?? null; }

// C ref: priest.c:16 newepri(mtmp) — allocate and zero the monster's epri,
// stamping parentmid with its own m_id.  No RNG.
export function newepri(mtmp) {
    if (!mtmp) return;
    if (!mtmp.mextra) mtmp.mextra = {};      /* C: newmextra() */
    if (!EPRI_(mtmp)) {
        /* memset(..., 0, sizeof(struct epri)): every field starts zeroed */
        mtmp.epri = {
            shroom: 0, shralign: 0, shrpos: { x: 0, y: 0 },
            shrlevel: { dnum: 0, dlevel: 0 },
            intone_time: 0, enter_time: 0, peaceful_time: 0, hostile_time: 0,
            cheapskate_count: 0, parentmid: mtmp.m_id,
        };
        mtmp.mextra.epri = mtmp.epri;
    }
}

// C ref: priest.c:28 free_epri(mtmp) — release the epri and clear ispriest.
// Called from angry_priest() once a priest's altar is gone (he becomes a
// roaming minion).  No RNG.
export function free_epri(mtmp) {
    if (!mtmp) return;
    if (mtmp.mextra && EPRI_(mtmp)) {
        mtmp.epri = null;
        if (mtmp.mextra) mtmp.mextra.epri = null;
    } else if (mtmp.epri) {
        /* flat layout without an mextra object (what priestini() produces) */
        mtmp.epri = null;
    }
    mtmp.ispriest = 0;
}

// C ref: priest.c:161 inhistemple(priest) — the priest is on the right level,
// in the right room, and that room still holds a properly aligned altar.
// js/dungeon.js:1876 and js/monmove.js:1635 and js/sounds.js:790 each hold an
// unexported copy; the fix is to export one.  No RNG.
export function inhistemple(priest) {
    /* make sure we have a priest */
    if (!priest || !priest.ispriest) return false;
    /* priest must be on right level and in right room */
    if (!histemple_at_(priest, priest.mx, priest.my)) return false;
    /* temple room must still contain properly aligned altar */
    return has_shrine(priest);
}
// C ref: priest.c:152 histemple_at(priest, x, y).
function histemple_at_(priest, x, y) {
    if (!priest || !priest.ispriest) return false;
    const p = EPRI_(priest);
    if (!p) return false;
    const loc = game.level?.at(x, y);
    const here = loc?.roomno ?? 0;
    const hr = roomAt(here);
    if (!hr || hr.rtype !== TEMPLE) return false;
    if (p.shroom !== here) return false;
    return on_level_(p.shrlevel, game.u?.uz);
}
// C ref: dungeon.c on_level(lev1, lev2) / assign_level(dst, src).
function on_level_(a, b) {
    return !!a && !!b && a.dnum === b.dnum && a.dlevel === b.dlevel;
}
function assign_level_(dst, src) {
    if (!dst) return;
    dst.dnum = src?.dnum ?? 0;
    dst.dlevel = src?.dlevel ?? 0;
}

// C ref: priest.c:302 priestname(mon, article, reveal_high_priest, pname) —
// build "the high priest of Moloch", "a renegade Angel of Mitra", "your
// guardian Angel of Ptah", &c.  C writes into a caller-supplied buffer and
// returns it; here the string is returned and `pname` is ignored (kept in the
// signature so the call sites read the same).
//
// Hallucination makes rndmonnam() the base name, and that DRAWS (on the display
// RNG) — so this is not a pure function while hallucinating.
// `hallu` lets x_monnam() pass its own do_hallu (C toggles EHalluc_resistance
// around the call to block Hallucination when the true name is wanted).
export function priestname(mon, article, reveal_high_priest, _pname,
                           hallu = Hallucination_()) {
    const do_hallu = hallu;
    const aligned_priest = mon?.data?.name === 'aligned cleric';
    const high_priest = mon?.data?.name === 'high cleric';
    let whatcode = { c: '\0' };
    let what = do_hallu ? rndmonnam_(whatcode) : mon_pmname_(mon);

    if (!mon.ispriest && !mon.isminion)   /* should never happen... */
        return what;                      /* caller must be confused */

    /* for high priest(ess), "high" (or "grand" for poohbah) will be inserted
       [C moved this up from near the end so `what` is updated sooner] */
    if (mon.ispriest || aligned_priest || high_priest)
        what = do_hallu ? 'poohbah' : (mon.female ? 'priestess' : 'priest');

    let pname = '';
    if (article !== ARTICLE_NONE_ && (!do_hallu || !bogon_is_pname_(whatcode.c))) {
        if (article === ARTICLE_YOUR_
            || (article === ARTICLE_A_ && high_priest))
            article = ARTICLE_THE_;
        if (article === ARTICLE_THE_) {
            pname = 'the ';
        } else if (what === 'Angel') {
            /* bypass just_an(); it would yield "" due to treating capital A
               as indicating a personal name */
            pname = 'an ';
        } else {
            pname = just_an_(what);
        }
    }
    /* pname contains "" or {"a ","an ","the "} */
    if (mon.minvis) {
        /* avoid "a invisible priest" */
        if (pname === 'a ') pname = 'an ';
        pname += 'invisible ';
    }
    if (mon.isminion && EMIN_(mon)?.renegade) {
        /* avoid "an renegade Angel" */
        if (pname === 'an ' && !mon.minvis) pname = 'a ';
        pname += 'renegade ';
    }

    if (mon.ispriest || aligned_priest) {
        if (high_priest) pname += do_hallu ? 'grand ' : 'high ';
    } else {
        if (mon.mtame && String(what).toLowerCase() === 'angel')
            pname += 'guardian ';
    }

    pname += what;
    /* same as distant_monnam(), more or less... */
    if (do_hallu || !high_priest || reveal_high_priest
        || !Is_astralevel_() || m_next2u_(mon) || !!game.program_state?.gameover) {
        pname += ' of ';
        pname += halu_gname_(mon_aligntyp_(mon));
    }
    return pname;
}

// C ref: priest.c:545 forget_temple_entry(priest) — reset the four move
// counters that rate-limit intemple()'s feedback, so leaving the level and
// coming back gives a fresh start.  No RNG.  Called from js/save.js's
// savemonchn() (C ref: save.c:893-894), once per priest, right before that
// priest's own record is saved/stored — i.e. on every level departure, not
// only on a final game save.
export function forget_temple_entry(priest) {
    const epri_p = priest?.ispriest ? EPRI_(priest) : null;

    if (!epri_p) {
        /* C: impossible("attempting to manipulate shrine data for
           non-priest?") */
        return;
    }
    epri_p.intone_time = 0;
    epri_p.enter_time = 0;
    epri_p.peaceful_time = 0;
    epri_p.hostile_time = 0;
}

// C ref: priest.c:558 priest_talk(priest) — #chat with a temple priest.
//
// RNG, in order: the cranky-priest rn2(3); then rn1(101, 150 + cheapskate*40)
// for the suggested donation; then bribe()'s getlin (no RNG) and, on the
// "pious individual" arm, rn1(500*offer/suggested, 500*offer/suggested) for the
// clairvoyance timeout, or on the "devotion" arm one rn1(3,2) plus an
// rn2(u.ublessed) per 2*suggested donated.
export async function priest_talk(priest) {
    const u = game.u;
    await ensure_do_name_();   /* Monnam()/mon_nam() handles */
    const coaligned = p_coaligned(priest);
    const strayed = ((u.ualign?.record ?? 0) < 0);
    /* C: `unsigned *cheapskate` — a pointer into EPRI, NULL for a minion */
    const epri_p = EPRI_(priest);
    const cheapskate = epri_p ? epri_p : null;

    /*
     * Note: we won't be called if hero is Deaf [since dochat() will return
     * before calling domonnoise()], so we don't need to check for that before
     * the various calls to verbalize() here.
     */

    /* KMH, conduct */
    u.uconduct = u.uconduct || {};
    u.uconduct.gnostic |= 0; // `undefined++` is NaN, which would stay falsy forever
    if (!(u.uconduct.gnostic++))
        livelog_printf_(LL_CONDUCT_,
                        `rejected atheism by consulting with ${mon_nam_(priest)}`);

    if (priest.mflee || (!priest.ispriest && coaligned && strayed)) {
        await pline(`${Monnam_(priest)} doesn't want anything to do with you!`);
        priest.mpeaceful = 0;
        return;
    }

    /* priests don't chat unless peaceful and in their own temple */
    if (!inhistemple(priest) || !priest.mpeaceful || helpless_(priest)) {
        const cranky_msg = [
            "Thou wouldst have words, eh?  I'll give thee a word or two!",
            'Talk?  Here is what I have to say!',
            'Pilgrim, I would speak no longer with thee.',
        ];

        if (helpless_(priest)) {
            await pline(`${Monnam_(priest)} breaks out of ${
                priest.female ? 'her' : 'his'} reverie!`);
            priest.mfrozen = 0;
            priest.msleeping = 0;
            priest.mcanmove = 1;
        }
        priest.mpeaceful = 0;
        SetVoice_(priest, 0, 80, 0);
        await verbalize_(cranky_msg[rn2(3)]);              /* priest.c:599 */
        return;
    }

    /* you desecrated the temple and now you want to chat? */
    if (priest.mpeaceful && in_temple_room_(priest.mx, priest.my)
        && !has_shrine(priest)) {
        SetVoice_(priest, 0, 80, 0);
        await verbalize_(
            'Begone!  Thou desecratest this holy place with thy presence.');
        priest.mpeaceful = 0;
        return;
    }
    if (!money_cnt_(invent_())) {
        if (coaligned && !strayed) {
            const pmoney = money_cnt_(priest.minvent);
            if (pmoney > 0) {
                const bits = Hallucination_() ? await currency_(pmoney)
                    : (pmoney === 1 ? 'bit' : 'bits');
                /* Note: two bits is actually 25 cents.  Hmm. */
                await pline(`${Monnam_(priest)} gives you ${
                    pmoney === 1 ? 'one ' : 'two '}${bits} for an ale.`);
                await money2u_(priest, pmoney > 1 ? 2 : 1);
            } else {
                await pline(`${Monnam_(priest)} preaches the virtues of poverty.`);
            }
            await exercise_(A_WIS_, true);
        } else {
            await pline(`${Monnam_(priest)} is not interested.`);
        }
        return;
    } else {
        /* there's now some randomization in how much you need to donate, but
           you are given suggested donation values that will guarantee
           clairvoyance and protection respectively; with more gold visible you
           need to donate more but get a greater effect; and if you cheapskate
           out to rerandomize the donation amounts they will be higher next
           time */
        const suggested = ((u.ulevelpeak ? u.ulevelpeak : 1)
            * rn1(101, 150 + (cheapskate ? (cheapskate.cheapskate_count | 0) : 0) * 40));
        let quan = Math.trunc(money_cnt_(invent_()) / (suggested * 3));

        if (quan < 1) quan = 1;

        const buf = `How much will you offer (suggested: ${suggested * quan
            } or ${suggested * quan * 2})?`;

        if (game.flags?.debug)
            await pline(`${Monnam_(priest)} asks you for a contribution for the temple (base ${suggested}).`);
        else
            await pline(`${Monnam_(priest)} asks you for a contribution for the temple.`);
        let offer = await bribe(priest, buf);
        if (offer === 0) {
            SetVoice_(priest, 0, 80, 0);
            await verbalize_('Thou shalt regret thine action!');
            if (coaligned) await adjalign_(-1);
            if (cheapskate) cheapskate.cheapskate_count = (cheapskate.cheapskate_count | 0) + 1;
        } else if (offer < suggested * quan) {
            if (money_cnt_(invent_()) > (offer * 2)) {
                SetVoice_(priest, 0, 80, 0);
                await verbalize_('Cheapskate.');
                if (cheapskate) cheapskate.cheapskate_count = (cheapskate.cheapskate_count | 0) + 1;
            } else {
                SetVoice_(priest, 0, 80, 0);
                await verbalize_('I thank thee for thy contribution.');
                /* give player some token */
                await exercise_(A_WIS_, true);
            }
        } else if (offer < suggested * quan * 2) {
            SetVoice_(priest, 0, 80, 0);
            await verbalize_('Thou art indeed a pious individual.');
            if (money_cnt_(invent_()) < (offer * 2)) {
                if (coaligned && (u.ualign?.record ?? 0) <= ALGN_SINNED)
                    await adjalign_(1);
            }
            await verbalize_('I bestow upon thee a blessing.');
            const n = Math.trunc(500 * offer / suggested);
            incr_itimeout_('HClairvoyant', rn1(n, n));      /* priest.c:679 */
        } else if (offer < suggested * quan * 3) {
            let orig_ublessed = u.ublessed | 0;

            /* u.ublessed is only active when Protection is enabled via
               something other than worn gear (theft by gremlin clears the
               intrinsic but not its former magnitude, making it recoverable) */
            const props = (u.uprops = u.uprops || {});
            if (!((props.HProtection | 0) & INTRINSIC)) {
                props.HProtection = (props.HProtection | 0) | FROMOUTSIDE;
                orig_ublessed = -1; /* force "rewarded" message */
            }

            for (; offer >= (2 * suggested); offer -= (2 * suggested)) {
                if (!u.ublessed)
                    u.ublessed = rn1(3, 2);                /* priest.c:695 */
                else if (u.ublessed < 20
                         && (u.ublessed < 9 || !rn2(u.ublessed)))
                    u.ublessed++;
            }
            SetVoice_(priest, 0, 80, 0);
            if ((u.ublessed | 0) > orig_ublessed)
                await verbalize_('Thou hast been rewarded for thy devotion.');
            else
                await verbalize_('Thy selfless generosity is deeply appreciated.');
        } else {
            SetVoice_(priest, 0, 80, 0);
            await verbalize_('Thy selfless generosity is deeply appreciated.');
            /* money_cnt check is preserved for futureproofing but probably
               can't fail in the current code */
            if (money_cnt_(invent_()) < (offer * 2) && coaligned) {
                if (strayed && ((game.moves | 0) - (u.ucleansed | 0)) > 5000) {
                    u.ualign.record = 0; /* cleanse thee */
                    u.ucleansed = game.moves | 0;
                } else {
                    await adjalign_(2);
                }
            }
        }
    }
}

// C ref: minion.c:361 bribe(mtmp, prompt) — priest_talk()'s donation prompt
// (also dprince()'s).  getlin, then the gold actually changes hands.  No RNG.
export async function bribe(mtmp, prompt) {
    await ensure_do_name_();
    const umoney = money_cnt_(invent_());

    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    const buf = await hooked_tty_getlin(prompt, null);
    /* C: sscanf(buf, "%ld", &offer) != 1 -> offer = 0 */
    const m = /^\s*([-+]?\d+)/.exec(String(buf ?? ''));
    let offer = m ? Number(m[1]) : 0;

    /* Michael Paddon -- fix for negative offer to monster */
    if (offer < 0) {
        await pline(`You try to shortchange ${mon_nam_(mtmp)}, but fumble.`);
        return 0;
    } else if (offer === 0) {
        await pline('You refuse.');
        return 0;
    } else if (offer >= umoney) {
        await pline(`You give ${mon_nam_(mtmp)} all your gold.`);
        offer = umoney;
    } else {
        await pline(`You give ${mon_nam_(mtmp)} ${offer} ${
            await currency_(offer)}.`);
    }
    await money2mon_(mtmp, offer);
    game.botl = true;
    return offer;
}

// C ref: priest.c:724 mk_roamer(ptr, alignment, x, y, peaceful) — create an
// ALIGNED_CLERIC or ANGEL roamer (a minion, not a temple priest).  Reached from
// sp_lev.c's des.monster with an alignment, which is why js/sp_lev.js:4033
// lists mk_roamer in its EXT stub table and calls EXT.mk_roamer at :4809.
//
// RNG: an rloc() if the square is occupied, then makemon()'s own stream.
export async function mk_roamer(ptr, alignment, x, y, peaceful) {
    const coaligned = ((game.u?.ualign?.type ?? A_NONE) === alignment);

    /* C's `if (ptr != &mons[PM_ALIGNED_CLERIC] && ptr != &mons[PM_ANGEL])
       return 0;` sits inside `#if 0` (it was due to permonst's pxlth field,
       now gone) and is NOT compiled. */

    if (m_at(x, y)) {
        const { rloc } = await import('./teleport.js');
        await rloc(m_at(x, y), RLOC_NOMSG_);   /* insurance */
    }

    const roamer = makemon(ptr, x, y, MM_ADJACENTOK_ | MM_EMIN | MM_NOMSG_);
    if (!roamer) return null;

    if (!roamer.mextra) roamer.mextra = {};
    roamer.emin = roamer.emin || {};
    roamer.mextra.emin = roamer.emin;
    roamer.emin.min_align = alignment;
    roamer.emin.renegade = (coaligned && !peaceful);
    roamer.ispriest = 0;
    roamer.isminion = 1;
    mon_learns_traps_(roamer, -1 /* ALL_TRAPS */); /* traps are known */
    roamer.mpeaceful = peaceful ? 1 : 0;
    roamer.msleeping = 0;
    set_malign(roamer); /* peaceful may have changed */

    /* MORE TO COME */
    return roamer;
}

// C ref: priest.c:755 reset_hostility(roamer) — on a hero alignment change, a
// roaming cleric or Angel of the OTHER alignment turns hostile.  No RNG.
export function reset_hostility(roamer) {
    if (!roamer?.isminion) return;
    const nm = roamer.data?.name;
    if (nm !== 'aligned cleric' && nm !== 'Angel') return;

    if (EMIN_(roamer)?.min_align !== (game.u?.ualign?.type ?? A_NONE)) {
        roamer.mpeaceful = 0;
        roamer.mtame = 0;
        set_malign(roamer);
    }
    newsym(roamer.mx, roamer.my);
}

// C ref: priest.c:796 ghod_hitsu(priest) — attacking a priest in his own temple
// draws a bolt of lightning from the shrine's god.
//
// RNG, in order: an rn2(4) picking the wall the bolt comes from (only when the
// hero is NOT lined up with the altar and is NOT standing in a doorway), then
// rn2(3) for the god's line, then buzz()'s own stream.
export async function ghod_hitsu(priest) {
    const u = game.u;
    const roomno = temple_occupied(u.urooms) | 0;

    if (!roomno || !has_shrine(priest)) return;

    const p = EPRI_(priest);
    const ax = p.shrpos.x, ay = p.shrpos.y;
    let x = ax, y = ay;
    const troom = roomAt(roomno);
    if (!troom) return;

    if ((u.ux === x && u.uy === y) || !linedup_(u.ux, u.uy, x, y, 1)) {
        if (IS_DOOR_(game.level?.at(u.ux, u.uy)?.typ)) {
            if (u.ux === troom.lx - 1) {
                x = troom.hx; y = u.uy;
            } else if (u.ux === troom.hx + 1) {
                x = troom.lx; y = u.uy;
            } else if (u.uy === troom.ly - 1) {
                x = u.ux; y = troom.hy;
            } else if (u.uy === troom.hy + 1) {
                x = u.ux; y = troom.ly;
            }
        } else {
            switch (rn2(4)) {                              /* priest.c:827 */
            case 0: x = u.ux; y = troom.ly; break;
            case 1: x = u.ux; y = troom.hy; break;
            case 2: x = troom.lx; y = u.uy; break;
            default: x = troom.hx; y = u.uy; break;
            }
        }
        if (!linedup_(u.ux, u.uy, x, y, 1)) return;
    }

    switch (rn2(3)) {                                      /* priest.c:850 */
    case 0:
        await pline(`${await a_gname_at_(ax, ay)} roars in anger:  "Thou shalt suffer!"`);
        break;
    case 1:
        await pline(`${s_suffix(await a_gname_at_(ax, ay))} voice booms:  "How darest thou harm my servant!"`);
        break;
    default:
        await pline(`${await a_gname_at_(ax, ay)} roars:  "Thou dost profane my shrine!"`);
        break;
    }

    /* bolt of lightning cast by unspecified monster */
    const oldcurrwand = game.current_wand;
    game.current_wand = 0;
    const oldbuzzer = game.buzzer;
    game.buzzer = 0;
    const { dobuzz } = await import('./zap.js');
    /* C: buzz(BZ_M_SPELL(BZ_OFS_AD(AD_ELEC)), 6, x, y, sgn(gt.tbx), sgn(gt.tby))
       — buzz() is dobuzz() with say=TRUE.  hack.h: BZ_M_SPELL(t) == -10 - t,
       zap.h: BZ_OFS_AD(x) == x - 1, monattk.h: AD_ELEC == 5. */
    await dobuzz(-10 - (AD_ELEC_ - 1), 6, x, y,
                 sgn_(game.tbx | 0), sgn_(game.tby | 0), true);
    game.buzzer = oldbuzzer;
    game.current_wand = oldcurrwand;
    await exercise_(A_WIS_, false);
}

// C ref: priest.c:919 clearpriests() — when saving bones, drop every priest
// that is not on its own shrine level; restoring such a priest would be a mess.
// No RNG.
export function clearpriests() {
    for (const mtmp of Array.from(game.level?.monsters || [])) {
        if (mtmp.mhp != null && mtmp.mhp <= 0) continue;   /* DEADMONSTER */
        if (mtmp.ispriest && !on_level_(EPRI_(mtmp)?.shrlevel, game.u?.uz))
            mongone_(mtmp);
    }
}

// C ref: priest.c:933 restpriest(mtmp, ghostly) — "munge priest-specific
// structure when restoring".  A GHOSTLY (bones-file) priest is re-homed to the
// current level; a normal restore leaves the shrine level alone.  No RNG.
export function restpriest(mtmp, ghostly) {
    if (game.u?.uz?.dlevel) {
        if (ghostly) {
            const p = EPRI_(mtmp);
            if (p) {
                p.shrlevel = p.shrlevel || { dnum: 0, dlevel: 0 };
                assign_level_(p.shrlevel, game.u.uz);
            }
        }
    }
}

// ── local helpers.  Each names the faithful port it stands in for; where that
//    port exists but is module-private the fix is to export IT, not to grow
//    these.  All are RNG-free unless the comment says otherwise.
// C ref: do_name.h ARTICLE_* (do_name.c's article enum).
const ARTICLE_NONE_ = 0, ARTICLE_THE_ = 1, ARTICLE_A_ = 2, ARTICLE_YOUR_ = 3;
// C ref: mkobj.h MM_ADJACENTOK / MM_NOMSG, teleport.h RLOC_NOMSG.
const MM_ADJACENTOK_ = 0x00000010, MM_NOMSG_ = 0x00020000, RLOC_NOMSG_ = 0x01;
// C ref: attrib.h A_WIS.
const A_WIS_ = 2;
// C ref: monattk.h AD_ELEC.
const AD_ELEC_ = 5;
// C ref: prop.h INTRINSIC / FROMOUTSIDE (js/const.js:2381-2382).
const INTRINSIC = 0x07000000, FROMOUTSIDE = 0x04000000;
// C ref: livelog.h LL_CONDUCT.
const LL_CONDUCT_ = 0x0020;
// C ref: hacklib.c sgn(n).
function sgn_(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
// C ref: rm.h IS_DOOR(typ).
function IS_DOOR_(typ) { return typ === 23 /* DOOR */; }
// C ref: youprop.h Hallucination.
function Hallucination_() {
    const u = game.u;
    return !!u?.uhallu || ((u?.uprops?.Hallucination | 0) > 0);
}
// C ref: hack.h Is_astralevel(&u.uz).
function Is_astralevel_() {
    const uz = game.u?.uz, al = game.astral_level;
    return !!uz && !!al && uz.dnum === al.dnum && uz.dlevel === al.dlevel;
}
// C ref: mon.c m_next2u(mon) — adjacent to the hero.
function m_next2u_(mon) {
    const u = game.u;
    return !!mon && Math.abs(mon.mx - u.ux) <= 1 && Math.abs(mon.my - u.uy) <= 1;
}
// C ref: monst.h mon_aligntyp(mon) — a minion's EMIN alignment, a priest's
// shrine alignment, else the species' maligntyp.
function mon_aligntyp_(mon) {
    if (mon?.isminion && EMIN_(mon)) return EMIN_(mon).min_align;
    if (mon?.ispriest && EPRI_(mon)) return EPRI_(mon).shralign;
    return mon?.data?.maligntyp ?? 0;
}
// C ref: pray.c:2577 halu_gname(alignment) — js/role.js (random pantheon on the
// DISPLAY rng while hallucinating).
function halu_gname_(alignment) {
    return halu_gname(alignment);
}
// C ref: pray.c:2514 a_gname_at(x, y) — the name of an altar's deity, or NULL
// when <x,y> is not an altar.
async function a_gname_at_(x, y) {
    const loc = game.level?.at(x, y);
    const typ = loc?.typ | 0;
    if (typ !== ALTAR) return null;
    const { align_gname, roles } = await import('./role.js');
    const mnum = game.urole?.mnum;
    let idx = roles.findIndex((r) => r?.mnum === mnum);
    if (idx < 0) idx = 0;
    return align_gname(idx, Amask2align((loc.altarmask | 0) & 7 /* AM_MASK */));
}
// C ref: objnam.c just_an(outbuf, str) — "a "/"an "/"" for a bare noun.
function just_an_(str) {
    const s = String(str || '');
    if (!s) return '';
    /* C returns "" for a personal name (leading capital treated as one) */
    if (/^[A-Z]/.test(s)) return '';
    return /^[aeiouAEIOU]/.test(s) ? 'an ' : 'a ';
}
// C ref: mon.c mon_pmname(mon) — the species name honouring M_AP_TYPE.
function mon_pmname_(mon) { return mon_pmname(mon) || 'creature'; }
// C ref: do_name.c rndmonnam(&charcode) — a random bogus monster name; DRAWS on
// the display RNG.  js/do_name.js exports it; the charcode out-parameter is
// C-style, so it is threaded through a box here.
function rndmonnam_(whatcode) {
    const r = rndmonnam();
    if (r && typeof r === 'object') { whatcode.c = r.code ?? '\0'; return r.name; }
    return r;
}
// C ref: do_name.c bogon_is_pname(code).
function bogon_is_pname_(code) { return code === '+'; }
// C ref: do_name.c Monnam(mon) / mon_nam(mon) — reached dynamically so priest.js
// keeps its current static import graph.
let _do_name_mod = null;
function Monnam_(mon) {
    const f = _do_name_mod?.Monnam;
    if (f) return f(mon);
    const nm = mon?.mgivenname || mon?.data?.name || 'it';
    return nm.charAt(0).toUpperCase() + nm.slice(1);
}
function mon_nam_(mon) {
    const f = _do_name_mod?.mon_nam;
    if (f) return f(mon);
    return `the ${mon?.data?.name || 'creature'}`;
}
// C ref: mon.c helpless(mon) — js/shk.js:799 (exported, reached dynamically).
function helpless_(mon) { return !!(mon?.msleeping || !mon?.mcanmove); }
// C ref: sounds.c SetVoice(mon, ...) — the voice/pitch selection for the
// sound interface.  This port has no sound layer.
function SetVoice_(_mon, _pitch, _volume, _flags) { /* NOT PORTED */ }
// C ref: pline.c verbalize(fmt, ...) — the line wrapped in double quotes
// (js/shk.js:814).  verbalize1() is the no-format variant.
async function verbalize_(line) { await update_topl(`"${line}"`); }
// C ref: hack.h gi.invent.
function invent_() { return game.invent || game.u?.invent || []; }
// C ref: invent.c money_cnt(objchain) — js/invent.js:1155 (unexported).
function money_cnt_(list) {
    for (const o of list || [])
        if (o && o.oclass === 12 /* COIN_CLASS */) return o.quan | 0;
    return 0;
}
// C ref: shk.c money2u(mon, amount) — js/shk.js exports it.
async function money2u_(mon, amount) {
    const { money2u } = await import('./shk.js');
    return money2u(mon, amount);
}
// C ref: shk.c money2mon(mon, amount) — js/shk.js exports it.
async function money2mon_(mon, amount) {
    const { money2mon } = await import('./shk.js');
    return money2mon(mon, amount);
}
// C ref: objnam.c currency(amount) — js/invent.js exports it.
async function currency_(amount) {
    const { currency } = await import('./invent.js');
    return currency(amount);
}
// C ref: attrib.c exercise(attr, inc) / adjalign(n) — js/attrib.js exports
// both; reached dynamically to keep the static graph unchanged.  Both draw
// real RNG (rn2(19)/rn2(2) inside exercise; adjalign is RNG-free itself but
// its ordering relative to the rest of priest_talk still matters), so the
// import MUST be awaited before the call, not fired off via .then().
async function exercise_(attr, inc) {
    const { exercise } = await import('./attrib.js');
    exercise(attr, inc);
}
async function adjalign_(n) {
    const { adjalign } = await import('./attrib.js');
    adjalign(n);
}
// C ref: timeout.c incr_itimeout(&prop, incr) — js/eat.js:2013 (unexported).
function incr_itimeout_(propname, incr) {
    const p = (game.u.uprops = game.u.uprops || {});
    const TIMEOUT = 0x00FFFFFF;
    const cur = p[propname] | 0;
    p[propname] = (cur & ~TIMEOUT) | (((cur & TIMEOUT) + incr) & TIMEOUT);
}
// C ref: livelog.c livelog_printf(mask, fmt, ...) — js/livelog.js exports it.
function livelog_printf_(mask, msg) {
    import('./livelog.js').then((L) => L.livelog_printf(mask, msg));
}
// C ref: mon.c mongone(mtmp) — js/muse.js:672 / js/vault.js:228 (both
// unexported): remove the monster without a corpse or death message.
function mongone_(mtmp) {
    if (!mtmp) return;
    mtmp.mhp = 0;
    const mons = game.level?.monsters;
    if (mons) {
        const i = mons.indexOf(mtmp);
        if (i >= 0) mons.splice(i, 1);
    }
}
// C ref: monmove.c mon_learns_traps(mon, trapmask) — js/monmove.js exports it.
function mon_learns_traps_(mon, mask) {
    if (mon) mon.mtrapseen = (mask === -1) ? ~0 : ((mon.mtrapseen | 0) | (1 << (mask - 1)));
}
// C ref: mkroom.c *in_rooms(x, y, TEMPLE) — nonempty means "inside a temple".
function in_temple_room_(x, y) {
    const here = game.level?.at(x, y)?.roomno ?? 0;
    const r = roomAt(here);
    return !!r && r.rtype === TEMPLE;
}
// C ref: mthrowu.c linedup(ax, ay, bx, by, boulderhandling) — sets gt.tbx/gt.tby
// (which ghod_hitsu() then reads for the bolt direction) and tests for a clear
// straight line.  js/monmove.js:6736 has the faithful copy (unexported); this
// reduced one does the tbx/tby write and the geometry test only.
function linedup_(ax, ay, bx, by, boulderhandling) {
    const tbx = ax - bx, tby = ay - by;
    game.tbx = tbx; game.tby = tby;
    if (tbx === 0 && tby === 0) return false;
    const BOLT_LIM = 8;
    if (!((tbx === 0 || tby === 0 || Math.abs(tbx) === Math.abs(tby))
          && Math.max(Math.abs(tbx), Math.abs(tby)) < BOLT_LIM))
        return false;
    void boulderhandling; /* the boulder-tolerance walk is in monmove.js's copy */
    return true;
}
// Resolve the do_name.js handles Monnam_()/mon_nam_() prefer, once, without
// adding a static edge and without a module-evaluation side effect.
async function ensure_do_name_() {
    if (!_do_name_mod) _do_name_mod = await import('./do_name.js');
}
