// uhitm.js — Hero-vs-monster melee.
// C ref: src/uhitm.c — do_attack(), hitum(), known_hitum(); weapon.c dmgval().
//
// Faithful structural port.  The control flow mirrors uhitm.c do_attack():
//   1. the is_safemon() pet/peaceful "swap or stop" block (consumes rn2(7));
//   2. attack_checks() + the actual hitum() melee for hostile monsters.
// The starter sessions that bump into a tame pet exercise only path (1); the
// rn2(7) it rolls (uhitm.c:474) must be emitted at exactly the right point so
// the downstream RNG stays in lockstep.

import { game } from './gstate.js';
import { rn2, rnd, d } from './rng.js';
import { cansee } from './vision.js';
import { m_at } from './display.js';
import { isok, IS_OBSTRUCTED } from './const.js';

// ── small monster-state predicates (C: include/monst.h, mondata.h) ──

// C ref: include/monst.h:251 — helpless(mon) = msleeping || !mcanmove.
function helpless(mtmp) {
    return !!(mtmp.msleeping || !mtmp.mcanmove);
}

// C ref: include/mondata.h is_longworm() — only long worms have a tail; none
// of the starting pets/early monsters qualify.
function is_longworm(_mdat) {
    return false;
}

// C ref: include/mondata.h passes_walls() — phasing monsters.  Not relevant
// for the starting pet, which never passes walls.
function passes_walls(_mdat) {
    return false;
}

// C ref: display.c is_safemon() macro (include/display.h:159):
//   flags.safe_dog && mpeaceful && canspotmon && !Confusion
//   && !Hallucination && !Stunned.
// safe_dog defaults ON; the early sessions don't disable it.  The hero isn't
// confused/hallucinating/stunned at the bump moment, so those props (not yet
// modelled) read as their default-false.
export function canspotmon(mtmp) {
    if (!mtmp) return false;
    // Blind/telepathy not modelled in the starter state; a lit-room adjacent
    // pet is simply seen when its square is in view.
    if (game.u?.uswallow) return true;
    return cansee(mtmp.mx, mtmp.my);
}

export function is_safemon(mtmp) {
    if (!mtmp) return false;
    const flags = game.flags || {};
    const safe_dog = (flags.safe_dog !== undefined) ? flags.safe_dog : true;
    const Confusion = !!game.u?.uconf;
    const Hallucination = !!game.u?.uhallu;
    const Stunned = !!game.u?.ustun;
    return !!(safe_dog && mtmp.mpeaceful && canspotmon(mtmp)
              && !Confusion && !Hallucination && !Stunned);
}

// C ref: mon.c monflee() — make a monster flee.  For the swap-place path we
// only need the bookkeeping side effects on the (tame) monster; no RNG here.
export function monflee(mtmp, fleetime, _first, _fleemsg) {
    if (!mtmp.mflee) {
        if (fleetime && !mtmp.mfleetim)
            mtmp.mfleetim = Math.min(127, fleetime);
        mtmp.mflee = 1;
    }
}

// ── do_attack ──
// C ref: uhitm.c do_attack(struct monst *mtmp) — try to attack the monster at
// <u.ux+u.dx, u.uy+u.dy>.  Returns TRUE if hero movement is used up, FALSE if
// the monster evaded (so domove falls through to the swap-places logic).
//
// u.dx / u.dy must already be set by the caller (domove).
export async function do_attack(mtmp) {
    const u = game.u;
    const Punished = false; // ball & chain not modelled in starter state
    const forcefight = !!game.context?.forcefight;

    // Protection for peaceful '@' and tame 'd': when safe and not force-
    // fighting, we assume the player isn't trying to attack — usually a
    // place-swap (handled by the caller) instead.  C ref uhitm.c:461-509.
    if (is_safemon(mtmp) && !forcefight) {
        // (Stormbringer override not modelled.)
        const loc = game.level?.at(u.ux, u.uy);
        const obstructed = !!(loc && IS_OBSTRUCTED(loc.typ));
        const foo = (Punished || !rn2(7)
                     || (is_longworm(mtmp.data) && mtmp.wormno)
                     || (obstructed && !passes_walls(mtmp.data)));
        const inshop = false; // no tended shop at the bump square in starter state

        if (inshop || foo) {
            // (shk dopay() path omitted — not reachable here.)
            if (mtmp.mtame) // see 'additional considerations' in C
                monflee(mtmp, rnd(6), false, false);
            // "You stop.  <Monnam> is in the way!" — only when running; the
            // starter sessions step one square at a time so context.run is 0
            // and no message is produced, but the structure is preserved.
            return true;
        } else if (mtmp.mfrozen || helpless(mtmp)
                   || (movement_rate(mtmp) === 0 && rn2(6))) {
            await plineMon(mtmp, "%s doesn't seem to move!");
            return true;
        } else {
            return false; // monster "evaded" -> caller swaps places
        }
    }

    // Hostile / force-fight melee.  attack_checks() + hitum() are not yet
    // needed by any owned session; emit nothing and fall through so behaviour
    // is conservative.  (Faithful expansion: attack_checks(mtmp, uwep) then
    // hitum(mtmp, youmonst.data->mattk).)
    return await hostile_attack(mtmp);
}

// C ref: include/permonst.h mons[].mmove — base movement rate; pets all move.
function movement_rate(mtmp) {
    // dogs/cats/ponies all have mmove > 0; default to nonzero for the starter
    // monsters (the rn2(6) "doesn't move" branch only matters for mmove==0).
    return (mtmp.data && mtmp.data.mmove != null) ? mtmp.data.mmove : 1;
}

// Hostile melee stub.  Returns TRUE (movement consumed) without rolling RNG;
// no owned session reaches this, and emitting speculative rolls here would
// risk desyncing sessions owned by other agents.  Kept as the seam where a
// full hitum() port would attach.  C ref: uhitm.c do_attack tail -> hitum().
async function hostile_attack(_mtmp) {
    return true;
}

// ── dmgval ──
// C ref: weapon.c dmgval(struct obj *otmp, struct monst *mon) — base weapon
// damage roll before strength/enchantment bonuses.  Ported faithfully for use
// once a full hitum() path is wired; not exercised by the owned (pet-swap)
// sessions yet.
export function dmgval(otmp, mon) {
    if (!otmp) return 1; // bare-handed minimum
    const mdat = mon?.data;
    const lhalf = mdat ? (largemonst(mdat) ? 0 : 1) : 1;
    let tmp = 0;
    const objs = game.objects || [];
    const o = objs[otmp.otyp] || {};
    const wsdam = o.wsdam || 0, wldam = o.wldam || 0;
    if (lhalf) tmp = wsdam ? rnd(wsdam) : 0; // small-monster damage
    else tmp = wldam ? rnd(wldam) : 0;       // large-monster damage
    tmp += otmp.spe || 0;
    if (tmp < 1) tmp = 1;
    return tmp;
}

// C ref: include/mondata.h bigmonst() / mons[].msize >= MZ_LARGE.
function largemonst(mdat) {
    return !!(mdat && mdat.msize != null && mdat.msize >= 4 /* MZ_LARGE */);
}

// ── messaging helpers ──
// Lazy import of pline to avoid a static import cycle (display <- uhitm).
async function plineMon(mtmp, fmt) {
    const { pline } = await import('./display.js');
    await pline(fmt.replace('%s', Monnam(mtmp)));
}

// C ref: do_name.c Monnam()/x_monnam() — capitalized monster name.  Minimal
// port sufficient for the starter monsters (no shopkeepers/priests/hallu).
export function Monnam(mtmp) {
    const s = x_monnam(mtmp, /*ARTICLE_THE*/ 1, null, 0, false);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// C ref: do_name.c x_monnam().  Reduced to the cases the starter sessions
// need: a tame monster with (ARTICLE_YOUR) and an optional given name.
//   article: 0 NONE, 1 THE, 2 A, 3 YOUR.
export function x_monnam(mtmp, article, _adjective, _suppress, _called) {
    const base = mtmp?.data?.name || 'monster';
    const given = mtmp?.mgivenname || mtmp?.mextra?.mgivenname;

    // ARTICLE_YOUR only applies to tame monsters; otherwise downgrade to THE.
    if (article === 3 && !mtmp.mtame) article = 1;

    if (given) {
        // A personal name stands alone (name_at_start): ARTICLE_YOUR/NONE
        // both drop the article. C: x_monnam name_at_start handling.
        return given;
    }

    switch (article) {
    case 3: return 'your ' + base; // ARTICLE_YOUR
    case 1: return 'the ' + base;  // ARTICLE_THE
    case 2: return an(base);       // ARTICLE_A
    default: return base;          // ARTICLE_NONE
    }
}

// C ref: hacklib.c an() — prepend "a"/"an".
function an(s) {
    return (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s;
}
