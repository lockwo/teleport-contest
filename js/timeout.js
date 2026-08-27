// timeout.js — per-turn timed-property countdown.
// C ref: timeout.c nh_timeout() — decrements the hero's timed intrinsics each
// turn and fires their expiry effect when the timeout reaches 0.  C keeps every
// timer in the u.uprops[] array and walks it with
//
//     for (upp = u.uprops; upp < u.uprops + SIZE(u.uprops); upp++)
//         if ((upp->intrinsic & TIMEOUT) && !(--upp->intrinsic & TIMEOUT)) {
//             switch (upp - u.uprops) { ... }
//         }
//
// i.e. every RUNNING timer ticks down by one and the property's expiry case
// runs on the turn it reaches zero.  This port keeps the same timers as plain
// integers (game.u.uprops.Confusion, game.u.blinded, ...), so the loop below is
// a table over those fields; C's array order only matters when two expire on
// the same turn and both talk.
//
// Consumes NO RNG: none of the modelled expiry cases (CONFUSION / STUNNED /
// BLINDED / WOUNDED_LEGS / HALLUC) draws.  The cases that DO draw — SICK's
// rn2(100) recovery check, SLEEPY's rnd(20) fall_asleep, STONED/SLIMED's
// done_timeout() death — need properties nothing in this port ever sets, so
// they are deliberately absent rather than guessed at.

import { game } from './gstate.js';
import { rn2, rnd, d } from './rng.js';
import { heal_legs } from './trap.js';
import { exercise } from './attrib.js';
import { A_CON } from './const.js';
import { nomul, stop_occupation } from './hack.js';
import { run_object_timers } from './mkobj.js';
import { update_topl } from './display.js';
import { Unaware } from './const.js';
import { youHaveFast, youHaveVeryFast } from './allmain.js';

// Imports used only by the timeout.c routines below the "rest of the file"
// banner.  const.js arrives as a NAMESPACE import on purpose: several names
// this file needs (G_UNIQ, S_DRAGON, NH_BLUE, the object otyps) are not in
// js/const.js at all, and a named import of a missing export is a link-time
// error that would take the whole game down at startup.
import * as C from './const.js';
import { objects } from './mkobj.js';
import { pline, impossible } from './display.js';
import { rn1 } from './rng.js';

const {
    TIMEOUT, I_SPECIAL, COLNO, ROWNO, CLOUD, ACCESSIBLE,
    TIMER_NONE, TIMER_LEVEL, TIMER_GLOBAL, TIMER_OBJECT, TIMER_MONSTER,
    NUM_TIMER_KINDS, RANGE_GLOBAL,
    ROT_ORGANIC, ROT_CORPSE, REVIVE_MON, ZOMBIFY_MON, BURN_OBJECT, HATCH_EGG,
    FIG_TRANSFORM, SHRINK_GLOB,
    MAX_EGG_HATCH_TIME, NON_PM, G_GENOD, G_EXTINCT, MV_KNOWS_EGG, M_AP_MONSTER,
    NECK, A_DEX, A_STR, NO_KILLER_PREFIX, KILLED_BY, KILLED_BY_AN,
    GENOCIDED, TURNED_SLIME, SICK_NONVOMITABLE, NHW_MENU, WIN_ERR, ECMD_OK,
    DRAWBRIDGE_DOWN, DB_UNDER, DB_ICE, STONED, SLIMED,
} = C;

// C ref: timeout.h enum timeout_types — MELT_ICE_AWAY follows SHRINK_GLOB and
// NUM_TIME_FUNCS is one past it.  NOT taken from js/const.js: that file exports
// MELT_ICE_AWAY as the STRING 'MELT_ICE_AWAY' (const.js:1998, aliasing
// TIMER_FUNC.MELT_ICE_AWAY), which also makes its NUM_TIME_FUNCS the string
// "MELT_ICE_AWAY1".  Real bug in const.js; fixing it belongs to that file's
// owner (js/nhlua.js:118 already defines the right values locally too).
const MELT_ICE_AWAY = SHRINK_GLOB + 1;
const NUM_TIME_FUNCS = MELT_ICE_AWAY + 1;

// C ref: monflag.h:194 G_UNIQ — js/const.js has no G_UNIQ (js/sp_lev.js:4769
// spells the literal inline too).
const G_UNIQ = 0x1000;
// C ref: monsym.h S_DRAGON.  This port stores permonst.mlet as the DISPLAY
// CHARACTER, not the monsym.h index, so the dragon class is 'D'.
const S_DRAGON_LET = 'D';

// C ref: youprop.h Hallucination — the expiry messages swap in hallucinating
// variants.
function Hallucination() {
    return ((game.u?.uprops?.Hallucination || 0) > 0);
}

// C ref: potion.c make_confused(0L, TRUE) —
// You_feel("less %s now.", Hallucination ? "trippy" : "confused").
async function expire_confusion() {
    const u = game.u;
    u.uprops.Confusion = 0;
    u.uconf = false;
    await update_topl(`You feel less ${Hallucination() ? 'trippy' : 'confused'} now.`);
    // C ref: timeout.c:734 `if (!Confusion) stop_occupation();` — clearing the
    // timer also breaks off a run/rush/occupation.  Without it a confused rush
    // kept going past the turn the confusion ran out.
    if (!(u.uprops.Confusion || 0)) await stop_occupation();
}

// C ref: potion.c make_stunned(0L, TRUE) —
// You_feel("%s now.", Hallucination ? "less wobbly" : "a bit steadier").
async function expire_stun() {
    const u = game.u;
    u.uprops.Stun = 0;
    u.Stunned = false;
    await update_topl(`You feel ${Hallucination() ? 'less wobbly' : 'a bit steadier'} now.`);
    // C ref: timeout.c:741 `if (!Stunned) stop_occupation();`.
    if (!(u.uprops.Stun || 0)) await stop_occupation();
}

// C ref: potion.c make_blinded(0L, TRUE) — regaining sight prints
// Your1(vision_clears) ("Your vision clears.") for an ordinary eyed hero whose
// blindness simply ran out.  The Blindfolded and eyeless variants need a worn
// blindfold / a polymorph form this port's blindness sources never combine
// with.
async function expire_blinded() {
    const u = game.u;
    u.blinded = 0;
    await update_topl('Your vision clears.');
    // C ref: timeout.c:747 `if (was_blind && !Blind) stop_occupation();` —
    // was_blind is necessarily true here (the timer just ran out), so the test
    // is whether some OTHER blindness source (blindfold, cream, eyeless form)
    // still applies.
    const { Blind } = await import('./vision.js');
    if (!Blind()) await stop_occupation();
}

// C ref: potion.c make_hallucinated(0L, TRUE, 0L) — the display refresh and
// its "Everything looks SO boring now." line need hallucination to have been
// drawing something; no covered session sets the timer, so only the counter is
// modelled.
async function expire_hallucination() {
    game.u.uprops.Hallucination = 0;
    // C ref: timeout.c:779 `if (!Hallucination) stop_occupation();`.
    if (!Hallucination()) await stop_occupation();
}

// C ref: timeout.c:1222 slip_or_trip() — the fumble feedback.  Only the on-foot,
// non-ice arms are reachable for the covered heroes (no steed, no ice level, no
// FROMOUTSIDE fumbling source).
//
// SCOPE: the object-on-my-square arm ("You trip over <obj>.") needs
// iflags.last_msg == PLNMSG_ONE_ITEM_HERE to choose between the pronoun and the
// full doname(); we use doname() unconditionally, and skip the corpse
// petrification check (no covered hero walks barefoot over a cockatrice).
async function slip_or_trip() {
    const u = game.u;
    const { vobj_at } = await import('./display.js');
    const otmp = vobj_at(u.ux, u.uy);
    if (otmp) {
        const { doname_invent } = await import('./invent.js');
        await update_topl(`You trip over ${doname_invent(otmp)}.`);
        return;
    }
    switch (rn2(4)) {
    case 1:
        await update_topl(`You trip over your own ${Hallucination() ? 'elbow' : 'feet'}.`);
        break;
    case 2:
        await update_topl(`You slip ${Hallucination() ? 'on a banana peel' : 'and nearly fall'}.`);
        break;
    case 3:
        await update_topl('You flounder.');
        break;
    default:
        await update_topl('You stumble.');
        break;
    }
}

// C ref: timeout.c:902 case FUMBLING — fires slip_or_trip() when the countdown
// reaches 0 and then RE-ARMS with another rnd(20) for as long as the hero is
// still Fumbling (worn fumble boots / gauntlets).  Unlike every other timer here
// it is a repeating one, so the rnd(20) has to be re-drawn every cycle.
async function expire_fumbling() {
    const u = game.u;
    // C: `if (u.umoved && !(Levitation || Flying))` — an airborne hero skips
    // slip_or_trip() and so skips its rn2(4).
    if (u.umoved && !(u.uprops?.Levitation || u.uprops?.Flying)) {
        await slip_or_trip();
        // C: nomul(-2); gm.multi_reason = "fumbling"; gn.nomovemsg = "";
        game.multi = -2;
        game.multi_reason = 'fumbling';
        game.nomovemsg = '';
        // SCOPE: the inv_weight() > -WT_NOISY_INV "You make a lot of noise!" +
        // wake_nearby() branch needs the noisy-inventory threshold; the covered
        // hero's pack stays well under it.
    }
    // HFumbling &= ~FROMOUTSIDE (ice); then re-arm while still Fumbling.
    u.HFumblingOutside = 0;
    if (u.HFumbling || u.EFumbling) u.HFumbling = (u.HFumbling || 0) + rnd(20);
}

// C ref: timeout.c vomiting_dialogue() — the Vomiting countdown's staged
// messages.  Runs BEFORE the uprops[] decrement loop, so it reads (Vomiting-1).
const VOMITING_TEXTS = [
    'are feeling mildly nauseated.',
    'feel slightly confused.',
    "can't seem to think straight.",
    'feel incredibly sick.',
    'are about to vomit.',
];
function _conf() { return (game.u?.uprops?.Confusion || 0); }
function _stun() { return (game.u?.uprops?.Stun || 0); }
function _make_confused(x) { const u = game.u; u.uprops.Confusion = x; u.uconf = x > 0; }
function _make_stunned(x) { const u = game.u; u.uprops.Stun = x; u.Stunned = x > 0; }

async function vomiting_dialogue() {
    const u = game.u;
    const v = (u.uprops.Vomiting || 0);
    let txt = null;
    switch (v - 1) {
    case 14:
        txt = VOMITING_TEXTS[0];
        break;
    case 11:
        txt = VOMITING_TEXTS[1];
        if (_conf() > 0) txt = 'feel slightly more confused.';
        break;
    case 6:
        _make_stunned(_stun() + d(2, 4));
        await stop_occupation();
        /* FALLTHROUGH */
    case 9:
        _make_confused(_conf() + d(2, 4));
        if ((game.multi || 0) > 0) nomul(0);
        break;
    case 8:
        txt = VOMITING_TEXTS[2];
        if (_stun() > 0) txt = "can't think straight.";
        break;
    case 5:
        txt = VOMITING_TEXTS[3];
        break;
    case 2:
        txt = VOMITING_TEXTS[4];
        break;
    case 0:
        await stop_occupation();
        u.uhunger = (u.uhunger || 0) - 20;
        await update_topl('You vomit!');
        u.uprops.Vomiting = 0;
        nomul(-2);
        game.multi_reason = 'vomiting';
        game.nomovemsg = 'You can move again.';
        break;
    default:
        break;
    }
    if (txt) await update_topl('You ' + txt);
    exercise(A_CON, false);
}

// The u.uprops[] timers this port materialises.  `get`/`set` read and write
// whichever field the rest of the port already uses for that property.
// NOTE: this list is NOT in prop.h numeric order (CONFUSION 14 before STUNNED
// 13, WOUNDED_LEGS 26 before HALLUC 23 / DEAF 16) — the order is only
// observable when two timers expire on the same turn and both print, so the
// pre-existing entries are left where they are.  FUMBLING (prop.h 25) is placed
// after DEAF and before FAST (64), which is the position with the fewest
// remaining inversions.
const TIMED_PROPS = [
    // prop.h INVULNERABLE = 11, ahead of every other entry here.  Only
    // #wizintrinsic gives it a timeout, and timeout.c has no case for it, so it
    // expires silently.
    { name: 'INVULNERABLE',
      get: (u) => u.uprops?.Invulnerable || 0,
      set: (u, v) => { u.uprops.Invulnerable = v; },
      expire: async () => {} },
    { name: 'CONFUSION',
      get: (u) => u.uprops?.Confusion || 0,
      set: (u, v) => { u.uprops.Confusion = v; u.uconf = v > 0; },
      expire: expire_confusion },
    { name: 'STUNNED',
      get: (u) => u.uprops?.Stun || 0,
      set: (u, v) => { u.uprops.Stun = v; },
      expire: expire_stun },
    { name: 'BLINDED',
      get: (u) => u.blinded || 0,
      set: (u, v) => { u.blinded = v; },
      expire: expire_blinded },
    { name: 'WOUNDED_LEGS',
      get: (u) => u.HWounded_legs || 0,
      set: (u, v) => { u.HWounded_legs = v; },
      // C ref: timeout.c:774 case WOUNDED_LEGS — heal_legs(0) then an
      // UNCONDITIONAL stop_occupation().
      expire: async () => { await heal_legs(0); await stop_occupation(); } },
    { name: 'VOMITING',
      get: (u) => u.uprops?.Vomiting || 0,
      set: (u, v) => { u.uprops.Vomiting = v; },
      expire: async () => {} },
    { name: 'HALLUC',
      get: (u) => u.uprops?.Hallucination || 0,
      set: (u, v) => { u.uprops.Hallucination = v; },
      expire: expire_hallucination },
    // C ref: timeout.c:752 case DEAF — set_itimeout(&HDeaf, 1) then make_deaf(0,
    // TRUE), which prints "You can hear again." and stops any occupation.  A
    // timed deafness comes from eat.c rottenfood(); while it runs, sounds.c
    // dosounds() returns before ANY of its ambient rolls, so the countdown is
    // load-bearing for the PRNG stream, not just for the message.
    { name: 'DEAF',
      get: (u) => u.uprops?.HDeaf || 0,
      set: (u, v) => { u.uprops.HDeaf = v; },
      // C: set_itimeout(&HDeaf, 1L); make_deaf(0L, TRUE).  potion.c make_deaf()
      // suppresses its message while Unaware — which the rotten-food case always
      // is — so the deafness clears silently and creates no --More-- boundary.
      expire: async () => {
          const u = game.u;
          const old = u?.uprops?.HDeaf || 0;
          if (u?.uprops) u.uprops.HDeaf = 0;
          if (!Unaware() && old) await update_topl('You can hear again.');
          // C ref: timeout.c:756 `if (!Deaf) stop_occupation();` — outside
          // make_deaf(), so it runs even on the Unaware (silent) path.
          if (!(u?.uprops?.HDeaf || 0)) await stop_occupation();
      } },
    // prop.h FUMBLING = 25.  The only expiry case here that draws RNG (rn2(4)
    // in slip_or_trip, then the rnd(20) re-arm).
    { name: 'FUMBLING',
      get: (u) => u.HFumbling || 0,
      set: (u, v) => { u.HFumbling = v; },
      expire: expire_fumbling },
    // prop.h FAST = 64, after every other entry here.  A timed HFast is what
    // makes Very_fast true (hack.h Very_fast == ((HFast & ~INTRINSIC) || EFast)),
    // so this countdown is load-bearing: u_calc_moveamt draws a different roll
    // while it runs.  C ref: timeout.c case FAST —
    // `if (!Very_fast) You_feel("yourself slow down%s.", Fast ? " a bit" : "")`.
    { name: 'FAST',
      get: (u) => u.uprops?.HFast || 0,
      set: (u, v) => { u.uprops.HFast = v; },
      expire: async () => {
          if (youHaveVeryFast()) return;
          await update_topl(`You feel yourself slow down${youHaveFast() ? ' a bit' : ''}.`);
      } },
];

// C ref: wizcmds.c wiz_intrinsic() reads/writes `u.uprops[p].intrinsic &
// TIMEOUT` — the SAME storage nh_timeout() counts down.  This port keeps a few
// of those timers outside u.uprops (BLINDED -> u.blinded, WOUNDED_LEGS ->
// u.HWounded_legs, FUMBLING -> u.HFumbling), so a caller that goes through
// u.uprops[key] silently reads 0 for them.  Route through the table instead.
export function timed_prop(name) {
    return TIMED_PROPS.find((p) => p.name === name) || null;
}

export async function nh_timeout() {
    const u = game.u;
    if (!u) return;
    if (!u.uprops) u.uprops = {};

    // C ref: allmain.c moveloop_core():513 `u.umoved = FALSE;` — it runs once
    // per moveloop_core() iteration, i.e. once per elapsed turn, and only a
    // domove() sets it back TRUE.  While gm.multi < 0 no command is dispatched
    // at all, so a HELPLESS turn's nh_timeout() always reads umoved FALSE; that
    // is what makes C skip slip_or_trip() (and its rn2(4)) on the paralysis
    // turns FUMBLING's own nomul(-2) creates.  This port takes a run's turns
    // inline inside ONE moveloop_core iteration (hack.js run_movement ->
    // moveloop_turn), so that reset is skipped and umoved stays stale-TRUE.
    // Re-derive it, but only when the PREVIOUS turn already ended helpless: a
    // nomul(-N) that the hero's own move set up (paralysis trap) must keep
    // umoved TRUE for the next turn, exactly as C does.
    if ((game.multi ?? 0) < 0 && game._helpless_at_timeout) u.umoved = false;

    // C ref: timeout.c:1052 `if (u.uinvulnerable) return;` — "things past this
    // point could kill you".  EVERYTHING below (the dialogues, u.ucreamed, and
    // the whole timed-property countdown) is skipped while the hero is
    // invulnerable, i.e. for the three helpless turns of a #pray.  Without it a
    // prayer left every timer three turns short (seed4500's blindness read 116
    // where C shows 119).
    if (u.uinvulnerable) return;

    // C ref: timeout.c — `if (u.ucreamed) u.ucreamed--;`, just above the
    // uprops[] loop.  Cream on the face wears off a point a turn independently
    // of the blindness it caused.
    if ((u.uprops.Vomiting || 0) > 0) await vomiting_dialogue();

    // C ref: timeout.c:641-648 — the polymorph countdown, immediately above
    // u.ucreamed.  Without it a self-polymorph never wore off: u.mtimedone was
    // set by polymon() and then never decremented, so the hero stayed in the
    // form (and kept its HD/AC status row) for the rest of the session.
    // is_were()'s you_unwere() arm is deferred with the rest of lycanthropy.
    if (u.mtimedone && !--u.mtimedone) {
        const { rehumanize, Unchanging_poly } = await import('./polyself.js');
        if (Unchanging_poly && Unchanging_poly()) {
            // C DRAWS rnd(100 * mlevel + 1) here: an Unchanging hero's form is
            // re-armed rather than reverted.
            u.mtimedone = rnd(100 * ((u.data?.mlevel | 0)) + 1);
        } else if (rehumanize) {
            await rehumanize();
        }
    }

    if ((u.ucreamed || 0) > 0) u.ucreamed -= 1;

    for (const p of TIMED_PROPS) {
        const cur = p.get(u);
        if (cur <= 0) continue;      // C: !(intrinsic & TIMEOUT) -> not running
        const next = cur - 1;
        p.set(u, next);
        if (next === 0) await p.expire();
    }

    // Sampled AFTER the expiry cases, so a nomul(-N) fired by one of them (the
    // FUMBLING slip) counts: allmain.c:377 `if (gm.multi < 0) ++gm.multi` sits
    // later in the same once-per-turn block, and no domove() can follow it.
    game._helpless_at_timeout = ((game.multi ?? 0) < 0);

    // C ref: timeout.c nh_timeout() ends with run_timers() — expire any object
    // timer (here: ROT_CORPSE) whose scheduled turn has arrived.
    run_object_timers();
}

// ═══════════════════════════════════════════════════════════════════════════
// timeout.c — the rest of the file.
//
// INERT BY CONSTRUCTION.  Nothing above this banner calls anything below it,
// and the module's only importers are allmain.js (nh_timeout) and
// extcmd-handlers.js (timed_prop).  The live per-turn path is still
// nh_timeout()'s TIMED_PROPS table plus mkobj.js run_object_timers(); hooking
// the queue below into it would reorder every later turn's draws, so that is a
// separate change.
// ═══════════════════════════════════════════════════════════════════════════

// ── C helpers js/ defines but does not export ──────────────────────────────
// Leading underscore, never the C name: a second definition under the C name
// would shadow the real one the day it lands (the js/save.js:270 convention).

function _panic(msg) { throw new Error(`panic: ${msg}`); }   /* panic.c */

// C ref: prop.h set_itimeout()/incr_itimeout().  This port stores each hero
// timer as a bare integer in u.uprops[<key>] with no TIMEOUT/INTRINSIC bit
// packing, so both macros reduce to arithmetic on that integer and `& TIMEOUT`
// is the identity for every value the game can reach.
function _prop(key) { return (game.u?.uprops?.[key] | 0) & TIMEOUT; }
function _set_itimeout(key, val) {
    const u = game.u;
    if (!u) return;
    if (!u.uprops) u.uprops = {};
    u.uprops[key] = (val | 0) & TIMEOUT;
}
function _incr_itimeout(key, incr) { _set_itimeout(key, _prop(key) + (incr | 0)); }

// C ref: pline.c urgent_pline() — vpline() with PLINE_URGENT.  The tty window
// port renders that identically to pline(); the flag only matters to interfaces
// with a separate urgent-message channel.
const _urgent_pline = (msg) => pline(msg);

// C ref: hacklib.c an()/upstart(), objnam.c s_suffix(), hacklib.c vtense().
function _an(s) {
    if (!s) return 'an []';
    if (/^the /i.test(s) || /^(molten lava|iron bars|ice)$/i.test(s)) return s;
    // C's vowel test with its named exceptions.
    if ('aeiouAEIOU'.includes(s[0]) && !/^one-/.test(s)
        && !/^useful/i.test(s) && !/^unicorn/i.test(s) && !/^uranium/i.test(s)
        && !/^eucalyptus/.test(s))
        return `an ${s}`;
    return `a ${s}`;
}
function _upstart(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function _s_suffix(s) { return /s$/.test(s) ? `${s}'` : `${s}'s`; }
// C: vtense(subj, verb) — a plural subject leaves the verb alone, a singular
// one gets the third-person form.  Only the pronoun subjects reach this file.
function _vtense(subj, verb) {
    if (/^(you|they|we|these|those)$/i.test(String(subj || ''))) return verb;
    if (verb === 'are') return 'is';
    return /s$/.test(verb) ? verb : `${verb}s`;
}

// C ref: you.h:322 mhe(mtmp) == genders[pronoun_gender(mtmp, PRONOUN_HALLU)].he
// and mondata.c:1191 pronoun_gender() — DRAWS rn2(4) whenever the hero is
// hallucinating, before any of the visibility tests, and role.c genders[] adds
// a fourth "group"/"they" row for exactly that case.
const _GENDER_HE = ['he', 'she', 'it', 'they'];
function _mhe(mtmp) {
    if (Hallucination()) return _GENDER_HE[rn2(4)];
    /* the non-hallucinating arms need canspotmon()/is_neuter(); every caller in
       this file is the hallucinating one. */
    return _GENDER_HE[mtmp?.female ? 1 : 2];
}

// C ref: gy.youmonst.data.  u.data is a BOGUS mons[] row while the hero is
// unpolymorphed (this port keeps a ROLE index in u.umonnum), so it is only
// trusted under Upolyd.
function _youmonst_data() { return game.u?.Upolyd ? game.u.data : null; }
// C ref: hacklib.c strsubst(bp, orig, replacement) — replaces the FIRST match
// only and returns the buffer.
function _strsubst(buf, orig, repl) { return String(buf).replace(orig, repl); }

// C ref: youprop.h Breathless / Deaf / Sleepy / Levitation / Passes_walls.
// Extrinsic halves live in the same u.uprops keys in this port (there is no
// separate .extrinsic field), so the E* terms of each macro are folded in.
function _Breathless() {
    // (HMagical_breathing || EMagical_breathing || breathless(youmonst.data))
    return _prop('HMagical_breathing') > 0 || !!game.u?.EMagical_breathing;
}
function _Deaf() {
    return _prop('HDeaf') > 0 || !!game.u?.EDeaf || !!game.u?.uroleplay?.deaf;
}

// C ref: eat.c:3920 Popeye(threat) — TRUE while the hero is part-way through
// opening a tin that might cure `threat`, which is why the countdown declines to
// break the occupation.  eat.js has no Popeye() and go.occupation is never
// opentin in this port, so C's leading `if (go.occupation != opentin) return
// FALSE` is the only reachable arm.
function _Popeye(_threat) { return false; }

// C ref: region.c:1341 region_danger() — hero standing in a gas cloud that can
// actually hurt him.  js/region.js keeps the regions on game.regions with
// .heroInside / .insideF === 'gas' (its INSIDE_GAS_CLOUD tag).
function _region_danger() {
    for (const r of (game.regions || [])) {
        if (!r.heroInside) continue;
        if (r.insideF !== 'gas') continue;
        if (_Breathless()) continue;
        if (game.u?.uprops?.HPoison_resistance || game.u?.EPoison_resistance)
            continue;
        return true;
    }
    return false;
}

// C ref: shk.c Shk_Your(buf, obj) — "Your " / "Fred's " / "The goblin's ",
// falling back to "The " for an unowned object; and objnam.c Yname2(obj) ==
// shk_your() followed by cxname().
async function _Shk_Your(obj) {
    if (!obj) return 'The ';
    if (_where(obj) === 'invent') return 'Your ';
    if (_where(obj) === 'minvent' && obj.ocarry) {
        const { Monnam } = await import('./do_name.js');
        return `${_s_suffix(Monnam(obj.ocarry))} `;
    }
    return 'The ';
}
async function _Yname2(obj) {
    const { xname } = await import('./invent.js');
    return (await _Shk_Your(obj)) + xname(obj);
}

// otyps by their objects.h macro name, never by a literal index; resolved
// LAZILY for the reason js/light.js:47 gives (touching `objects` at module
// evaluation time forces mkobj.js to finish initialising and can trip a TDZ
// error through the import cycle).
let _OTYP = null;
function _otyp(sym) {
    if (!_OTYP) _OTYP = new Map(objects.map((o) => [o.sym, o.otyp]));
    return _OTYP.get(sym);
}
const _MAGIC_LAMP = () => _otyp('MAGIC_LAMP');
const _POT_OIL = () => _otyp('POT_OIL');
const _BRASS_LANTERN = () => _otyp('BRASS_LANTERN');
const _OIL_LAMP = () => _otyp('OIL_LAMP');
const _CANDELABRUM = () => _otyp('CANDELABRUM_OF_INVOCATION');
const _TALLOW_CANDLE = () => _otyp('TALLOW_CANDLE');
const _WAX_CANDLE = () => _otyp('WAX_CANDLE');
// C ref: obj.h Is_candle(otmp).
const _Is_candle = (o) => o?.otyp === _TALLOW_CANDLE() || o?.otyp === _WAX_CANDLE();

// C ref: hack.h levl[x][y].
const _levl = (x, y) => game.level?.at?.(x, y) || null;

// C ref: mkobj.c obj_to_any()/monst_to_any() and the `anything` union in
// hack.h.  A JS reference IS that union: a_void is the identity member every
// queue comparison uses, exactly like C's `curr->arg.a_void == arg->a_void`.
function _obj_to_any(obj) { return { a_void: obj, a_obj: obj }; }
function _monst_to_any(mon) { return { a_void: mon, a_monst: mon }; }
function _long_to_any(v) { return { a_void: v, a_long: v }; }
function _uint_to_any(v) { return { a_void: v, a_uint: v }; }

// C ref: disp.botl — js/botl.js mirrors the flag onto game.botl and, when the
// display object exists, game.disp.botl.
function _set_botl() {
    game.botl = true;
    if (game.disp) game.disp.botl = true;
}

// ── propertynames[] / property_by_index ────────────────────────────────────
// C ref: timeout.c:27-114 — the wizard-mode #timeout and #wizintrinsic list,
// "ordered by interest".  js/extcmd-handlers.js:3090 carries the same order
// keyed by prop NAME for its menu; this is the numeric prop.h table C's
// property_by_index() indexes, terminated by C's { 0, 0 } sentinel.
const propertynames = [
    { prop_num: C.INVULNERABLE, prop_name: 'invulnerable' },
    { prop_num: C.STONED, prop_name: 'petrifying' },
    { prop_num: C.SLIMED, prop_name: 'becoming slime' },
    { prop_num: C.STRANGLED, prop_name: 'strangling' },
    { prop_num: C.SICK, prop_name: 'fatally sick' },
    { prop_num: C.STUNNED, prop_name: 'stunned' },
    { prop_num: C.CONFUSION, prop_name: 'confused' },
    { prop_num: C.HALLUC, prop_name: 'hallucinating' },
    { prop_num: C.BLINDED, prop_name: 'blinded' },
    { prop_num: C.DEAF, prop_name: 'deafness' },
    { prop_num: C.VOMITING, prop_name: 'vomiting' },
    { prop_num: C.GLIB, prop_name: 'slippery fingers' },
    { prop_num: C.WOUNDED_LEGS, prop_name: 'wounded legs' },
    { prop_num: C.SLEEPY, prop_name: 'sleepy' },
    { prop_num: C.TELEPORT, prop_name: 'teleporting' },
    { prop_num: C.POLYMORPH, prop_name: 'polymorphing' },
    { prop_num: C.LEVITATION, prop_name: 'levitating' },
    { prop_num: C.FAST, prop_name: 'very fast' },   /* timed FAST is very fast */
    { prop_num: C.CLAIRVOYANT, prop_name: 'clairvoyant' },
    { prop_num: C.DETECT_MONSTERS, prop_name: 'monster detection' },
    { prop_num: C.SEE_INVIS, prop_name: 'see invisible' },
    { prop_num: C.INVIS, prop_name: 'invisible' },
    { prop_num: C.ACID_RES, prop_name: 'acid resistance' },
    { prop_num: C.STONE_RES, prop_name: 'stoning resistance' },
    { prop_num: C.DISPLACED, prop_name: 'displaced' },
    { prop_num: C.PASSES_WALLS, prop_name: 'pass thru walls' },
    { prop_num: C.MAGICAL_BREATHING, prop_name: 'magical breathing' },
    { prop_num: C.WWALKING, prop_name: 'water walking' },
    { prop_num: C.FIRE_RES, prop_name: 'fire resistance' },
    /* beyond here: timed only via #wizintrinsic */
    { prop_num: C.COLD_RES, prop_name: 'cold resistance' },
    { prop_num: C.SLEEP_RES, prop_name: 'sleep resistance' },
    { prop_num: C.DISINT_RES, prop_name: 'disintegration resistance' },
    { prop_num: C.SHOCK_RES, prop_name: 'shock resistance' },
    { prop_num: C.POISON_RES, prop_name: 'poison resistance' },
    { prop_num: C.DRAIN_RES, prop_name: 'drain resistance' },
    { prop_num: C.SICK_RES, prop_name: 'sickness resistance' },
    { prop_num: C.ANTIMAGIC, prop_name: 'magic resistance' },
    { prop_num: C.HALLUC_RES, prop_name: 'hallucination resistance' },
    { prop_num: C.BLND_RES, prop_name: 'light-induced blindness resistance' },
    { prop_num: C.FUMBLING, prop_name: 'fumbling' },
    { prop_num: C.HUNGER, prop_name: 'voracious hunger' },
    { prop_num: C.TELEPAT, prop_name: 'telepathic' },
    { prop_num: C.WARNING, prop_name: 'warning' },
    { prop_num: C.WARN_OF_MON, prop_name: 'warn: monster type or class' },
    { prop_num: C.WARN_UNDEAD, prop_name: 'warn: undead' },
    { prop_num: C.SEARCHING, prop_name: 'searching' },
    { prop_num: C.INFRAVISION, prop_name: 'infravision' },
    { prop_num: C.ADORNED, prop_name: 'adorned (+/- Cha)' },
    { prop_num: C.STEALTH, prop_name: 'stealthy' },
    { prop_num: C.AGGRAVATE_MONSTER, prop_name: 'monster aggravation' },
    { prop_num: C.CONFLICT, prop_name: 'conflict' },
    { prop_num: C.JUMPING, prop_name: 'jumping' },
    { prop_num: C.TELEPORT_CONTROL, prop_name: 'teleport control' },
    { prop_num: C.FLYING, prop_name: 'flying' },
    { prop_num: C.SWIMMING, prop_name: 'swimming' },
    { prop_num: C.SLOW_DIGESTION, prop_name: 'slow digestion' },
    { prop_num: C.HALF_SPDAM, prop_name: 'half spell damage' },
    { prop_num: C.HALF_PHDAM, prop_name: 'half physical damage' },
    { prop_num: C.REGENERATION, prop_name: 'HP regeneration' },
    { prop_num: C.ENERGY_REGENERATION, prop_name: 'energy regeneration' },
    { prop_num: C.PROTECTION, prop_name: 'extra protection' },
    { prop_num: C.PROT_FROM_SHAPE_CHANGERS,
      prop_name: 'protection from shape changers' },
    { prop_num: C.POLYMORPH_CONTROL, prop_name: 'polymorph control' },
    { prop_num: C.UNCHANGING, prop_name: 'unchanging' },
    { prop_num: C.REFLECTING, prop_name: 'reflecting' },
    { prop_num: C.FREE_ACTION, prop_name: 'free action' },
    { prop_num: C.FIXED_ABIL, prop_name: 'fixed abilities' },
    { prop_num: C.LIFESAVED, prop_name: 'life will be saved' },
    { prop_num: 0, prop_name: null },   /* C's { 0, 0 } terminator */
];

// C ref: timeout.c:117 property_by_index(idx, propertynum).  C's out-parameter
// becomes an optional `{ v }` box (the js/sp_lev.js:4887 convention); the
// function still returns the name.
export function property_by_index(idx, propertynum) {
    /* C: IndexOkT(idx, propertynames) — out of range clamps to the terminator */
    if (!(idx >= 0 && idx < propertynames.length))
        idx = propertynames.length - 1;

    if (propertynum)
        propertynum.v = propertynames[idx].prop_num;
    return propertynames[idx].prop_name;
}

// ── the status countdowns ──────────────────────────────────────────────────

// C ref: timeout.c:128 stoned_texts[] — indexed from the tail, so entry
// SIZE-i corresponds to a remaining timeout of i.
const stoned_texts = [
    'You are slowing down.',            /* 5 */
    'Your limbs are stiffening.',       /* 4 */
    'Your limbs have turned to stone.', /* 3 */
    'You have turned to stone.',        /* 2 */
    'You are a statue.',                /* 1 */
];

// C ref: timeout.c:136 stoned_dialogue().
export async function stoned_dialogue() {
    const u = game.u;
    const i = _prop('Stoned');

    if (i > 0 && i <= stoned_texts.length) {
        let buf = stoned_texts[stoned_texts.length - i];
        const { nolimbs } = await import('./monflags_data.js');
        if (nolimbs(_youmonst_data()) && buf.includes('limbs'))
            buf = _strsubst(buf, 'limbs', 'extremities');
        await _urgent_pline(buf);
    }
    switch (i) {
    case 5: /* slowing down */
        _set_itimeout('HFast', 0);
        if ((game.multi || 0) > 0) nomul(0);
        break;
    case 4: /* limbs stiffening */
        /* one move left to save oneself, so stop fiddling around -- but don't
           interrupt opening a tin, which might be lizard or acidic */
        if (!_Popeye(STONED)) await stop_occupation();
        if ((game.multi || 0) > 0) nomul(0);
        break;
    case 3: /* limbs turned to stone */
        await stop_occupation();
        nomul(-3); /* can't move anymore */
        game.multi_reason = 'getting stoned';
        game.nomovemsg = 'You can move again.';
        /* "limbs have turned to stone" so terminate wounded legs */
        if ((timed_prop('WOUNDED_LEGS')?.get(u) | 0) > 0 && !u?.usteed)
            await heal_legs(2);
        break;
    case 2: /* turned to stone */
        if (_prop('HDeaf') > 0 && _prop('HDeaf') < 5)
            _set_itimeout('HDeaf', 5); /* avoid Hear_again at the tail end */
        /* if also vomiting or turning into slime, stop those (no messages) */
        if (_prop('Vomiting') > 0) _make_vomiting(0, false);
        if (_prop('Slimed') > 0) await _make_slimed(0, null);
        break;
    default:
        break;
    }
    exercise(A_DEX, false);
}

// C ref: timeout.c:267 sleep_dialogue().
export async function sleep_dialogue() {
    if (_prop('Sleepy') === 4) await pline('You yawn.');
}

// C ref: timeout.c:278 choke_texts[] / choke_texts2[].
const choke_texts = [
    'You find it hard to breathe.',
    "You're gasping for air.",
    'You can no longer breathe.',
    "You're turning %s.",
    'You suffocate.',
];
const choke_texts2 = [
    'Your %s is becoming constricted.',
    'Your blood is having trouble reaching your brain.',
    'The pressure on your %s increases.',
    'Your consciousness is fading.',
    'You suffocate.',
];

// C ref: timeout.c:294 choke_dialogue().  The rn2(50) is drawn only when the
// hero can breathe, exactly as C's `Breathless || !rn2(50)` short-circuits.
export async function choke_dialogue() {
    const i = _prop('Strangled');

    if (i > 0 && i <= choke_texts.length) {
        if (_Breathless() || !rn2(50)) {
            const { body_part } = await import('./polyself.js');
            await _urgent_pline(choke_texts2[choke_texts2.length - i]
                                .replace('%s', body_part(NECK)));
        } else {
            const str = choke_texts[choke_texts.length - i];
            if (str.includes('%')) {
                const { hcolor } = await import('./do_name.js');
                await _urgent_pline(str.replace('%s', hcolor('blue')));
            } else {
                await _urgent_pline(str);
            }
            await stop_occupation();
        }
    }
    exercise(A_STR, false);
}

// C ref: timeout.c:316 sickness_texts[].
const sickness_texts = [
    'Your illness feels worse.',
    'Your illness is severe.',
    "You are at Death's door.",
];

// C ref: timeout.c:322 sickness_dialogue() — a message only on ODD timeouts,
// which is what halves the effective countdown length.
export async function sickness_dialogue() {
    const u = game.u;
    const j = _prop('Sick'), i = Math.floor(j / 2);

    if (i > 0 && i <= sickness_texts.length && (j % 2) !== 0) {
        let buf = sickness_texts[sickness_texts.length - i];
        /* change the message slightly for food poisoning */
        if (((u?.usick_type | 0) & SICK_NONVOMITABLE) === 0)
            buf = _strsubst(buf, 'illness', 'sickness');
        if (Hallucination() && buf.includes("Death's door")) {
            /* youmonst: with Hallucination, mhe()'s mon argument is unused --
               but the rn2(4) inside pronoun_gender() is still drawn. */
            const pronoun = _mhe(u);
            buf += `  ${_upstart(pronoun)} ${_vtense(pronoun, 'are')} inviting you in.`;
        }
        await _urgent_pline(buf);
    }
    exercise(A_CON, false);
}

// C ref: timeout.c:347 levi_texts[].
const levi_texts = [
    'You float slightly lower.',
    'You wobble unsteadily %s the %s.',
];

// C ref: timeout.c:352 levitation_dialogue().  The -1 is because the last
// message comes from float_down().
export async function levitation_dialogue() {
    const u = game.u;
    const i = Math.floor((_prop('Levitation') - 1) / 2);

    if (u?.ELevitation) return;

    const { is_pool_or_lava } = await import('./dbridge.js');
    const loc = _levl(u.ux, u.uy);
    if (!ACCESSIBLE(loc?.typ) && !is_pool_or_lava(u.ux, u.uy)) return;

    if ((_prop('Levitation') % 2) && i > 0 && i <= levi_texts.length) {
        const s = levi_texts[levi_texts.length - i];
        if (s.includes('%')) {
            const { surface } = await import('./dungeon.js');
            const danger = is_pool_or_lava(u.ux, u.uy) && !C.Is_waterlevel(u.uz);
            await _urgent_pline(s.replace('%s', danger ? 'over' : 'in')
                                 .replace('%s', danger ? surface(u.ux, u.uy)
                                                       : 'air'));
        } else {
            await pline(s);
        }
        await stop_occupation();
    }
}

// C ref: timeout.c:380 slime_texts[].
const slime_texts = [
    'You are turning a little %s.',   /* 5 */
    'Your limbs are getting oozy.',   /* 4 */
    'Your skin begins to peel away.', /* 3 */
    'You are turning into %s.',       /* 2 */
    'You have become %s.',            /* 1 */
];

// C ref: timeout.c:388 slime_dialogue().  Note the index: this one runs off
// (t/2) with `slime_texts[SIZE - i - 1]`, NOT the tail indexing the other
// dialogues use.
export async function slime_dialogue() {
    const u = game.u;
    const t = _prop('Slimed'), i = Math.floor(t / 2);
    const { newsym } = await import('./display.js');

    if (t === 1) {
        /* display as green slime during "You have become green slime."; if
           already mimicking something else, implicitly be revealed */
        const { name_to_pmidx } = await import('./makemon.js');
        u.m_ap_type = M_AP_MONSTER;
        u.mappearance = name_to_pmidx('green slime');
        /* no message when t is odd, so force the self update */
        await newsym(u.ux, u.uy);
    }

    if ((t % 2) !== 0 && i >= 0 && i < slime_texts.length) {
        let buf = slime_texts[slime_texts.length - i - 1];
        const { nolimbs } = await import('./monflags_data.js');
        if (nolimbs(_youmonst_data()) && buf.includes('limbs'))
            buf = _strsubst(buf, 'limbs', 'extremities');

        if (buf.includes('%')) {
            const { hcolor, rndmonnam } = await import('./do_name.js');
            const { Blind } = await import('./vision.js');
            if (i === 4) {      /* "you are turning green" */
                if (!Blind()) await _urgent_pline(buf.replace('%s', hcolor('green')));
            } else {
                await _urgent_pline(buf.replace('%s',
                    _an(Hallucination() ? rndmonnam() : 'green slime')));
            }
        } else {
            await _urgent_pline(buf);
        }
    }

    switch (i) {
    case 3:  /* limbs becoming oozy */
        _set_itimeout('HFast', 0);      /* lose intrinsic speed */
        if (!_Popeye(SLIMED)) await stop_occupation();
        if ((game.multi || 0) > 0) nomul(0);
        break;
    case 2: /* skin begins to peel */
        if (_prop('HDeaf') > 0 && _prop('HDeaf') < 5)
            _set_itimeout('HDeaf', 5); /* avoid Hear_again at the tail end */
        break;
    case 1: /* turning into slime */
        /* if also turning to stone, stop doing that (no message) */
        if (_prop('Stoned') > 0)
            await _make_stoned(0, null, KILLED_BY_AN, null);
        break;
    default:
        break;
    }
    exercise(A_DEX, false);
}

// C ref: potion.c make_slimed()/make_stoned()/make_vomiting() — none of the
// three is ported in js/ and all three are potion.c symbols, so these are local
// stand-ins doing what timeout.c depends on: set the countdown, undo the
// mimic-green-slime hack, refresh the status line, print the optional message.
// The real versions also manage the delayed killer.
async function _make_slimed(otmp, msg) {
    _set_itimeout('Slimed', otmp | 0);
    const u = game.u;
    if (u && !(otmp | 0)) { u.m_ap_type = 0; u.mappearance = 0; }
    _set_botl();
    if (msg) await pline(msg);
}
async function _make_stoned(otmp, msg, _killedby, _killername) {
    _set_itimeout('Stoned', otmp | 0);
    _set_botl();
    if (msg) await pline(msg);
}
function _make_vomiting(otmp, _talk) {
    _set_itimeout('Vomiting', otmp | 0);
    _set_botl();
}

// C ref: timeout.c:447 burn_away_slime() — fire cures sliming.
export async function burn_away_slime() {
    if (_prop('Slimed') > 0)
        await _make_slimed(0, 'The slime that covers you is burned away!');
}

// C ref: timeout.c:528 phaze_texts[] and :533 phaze_dialogue().  The joke
// message hints that a temporary intrinsic Passes_walls lets you slip between
// closely packed things.
const phaze_texts = [
    'You start to feel bloated.',
    'You are feeling rather flabby.',
];

export async function phaze_dialogue() {
    const i = Math.floor(_prop('HPasses_walls') / 2);

    /* C: EPasses_walls || (HPasses_walls & ~TIMEOUT) — an extrinsic or a
       permanent intrinsic means there is nothing timing out to talk about. */
    if (game.u?.EPasses_walls) return;

    if ((_prop('HPasses_walls') % 2) && i > 0 && i <= phaze_texts.length)
        await pline(phaze_texts[phaze_texts.length - i]);
}

// C ref: timeout.c:548 region_texts[] and :553 region_dialogue().
const region_texts = [
    'You seem to have some trouble breathing.',
    'The air here seems foul.',
];

export async function region_dialogue() {
    const r = _prop('HMagical_breathing'), i = Math.floor(r / 2);

    /* C temporarily clears the timeout so Breathless/region_danger() answer for
       a hero WITHOUT it -- might have poly'd into a non-breather or stepped out
       of the cloud. */
    _set_itimeout('HMagical_breathing', 0);
    const no_need_to_breathe = _Breathless();
    const in_poison_gas_cloud = _region_danger();
    _set_itimeout('HMagical_breathing', r);
    if (no_need_to_breathe || !in_poison_gas_cloud) return;

    if ((r % 2) && i > 0 && i <= region_texts.length)
        await pline(region_texts[region_texts.length - i]);
}

// C ref: timeout.c:574 done_timeout(how, which) — keep the fatal status shown
// on the bottom line through the end-of-game rundown and dumplog.  The
// I_SPECIAL bit C ORs into u.uprops[which].intrinsic cannot live in this port's
// storage (a plain integer countdown; setting a high bit would corrupt it), so
// it is tracked in a module-local set.  Its only C reader is the final
// disclosure, which is unported.
const _i_special_props = new Set();

export async function done_timeout(how, which) {
    _i_special_props.add(which);        /* affects final disclosure */
    const { done } = await import('./end.js');
    await done(how);

    /* life-saved */
    _i_special_props.delete(which);
    _set_botl();
}

// C ref: timeout.c:456 slimed_to_death(kptr) — the sliming countdown ran out.
export async function slimed_to_death(kptr) {
    const u = game.u;
    const { name_to_pmidx } = await import('./makemon.js');
    const { dealloc_killer } = await import('./end.js');
    const PM_GREEN_SLIME = name_to_pmidx('green slime');

    /* redundant: polymon() cures sliming when polying into green slime */
    if (u?.Upolyd && u?.umonnum === PM_GREEN_SLIME) {
        dealloc_killer(kptr);
        return;
    }
    /* make sure the killer reason is set up */
    const killer = (game.killer = game.killer || {});
    if (kptr && kptr.name && kptr.name[0]) {
        killer.format = kptr.format;
        killer.name = kptr.name;
    } else {
        killer.format = NO_KILLER_PREFIX;
        killer.name = 'turned into green slime';
    }
    dealloc_killer(kptr);

    /*
     * Polymorph into a green slime, which might destroy some worn armor and
     * dismount from a steed.  Can't be Unchanging -- wouldn't have turned into
     * slime if we were.  polymon() undoes the countdown's mimick-green-slime
     * hack but does not do polyself()'s light source bookkeeping.  Temporarily
     * ungenocide if necessary.
     */
    const { emits_light, del_light_source, LS_MONSTER } = await import('./light.js');
    if (emits_light(u?.data)) del_light_source(LS_MONSTER, _monst_to_any(u).a_void);
    const mv = (game.mvitals = game.mvitals || []);
    mv[PM_GREEN_SLIME] = mv[PM_GREEN_SLIME] || { mvflags: 0 };
    const save_mvflags = mv[PM_GREEN_SLIME].mvflags | 0;
    mv[PM_GREEN_SLIME].mvflags = save_mvflags & ~G_GENOD;
    /* become a green slime; also resets m_ap_type + mappearance */
    const { polymon } = await import('./polyself.js');
    await polymon(PM_GREEN_SLIME);
    mv[PM_GREEN_SLIME].mvflags = save_mvflags;
    await done_timeout(TURNED_SLIME, SLIMED);

    /* life-saved; even so, the hero has still turned into green slime, and the
       player may have genocided green slimes after being infected */
    if ((mv[PM_GREEN_SLIME].mvflags & G_GENOD) !== 0) {
        killer.format = KILLED_BY;
        killer.name = 'slimicide';
        const slimebuf = 'green slime has been genocided...';
        /* vary the message: life-save by amulet, vs declining to die */
        if (game.iflags?.last_msg === 'PLNMSG_OK_DONT_DIE')
            await _urgent_pline(`Yes, you do.  ${_upstart(slimebuf)}`);
        else
            await _urgent_pline(`Unfortunately, ${slimebuf}`);
        /* die again; no possibility of an amulet this time */
        const { done } = await import('./end.js');
        await done(GENOCIDED);
    }
}

// ── eggs ───────────────────────────────────────────────────────────────────

// C ref: obj.h enum obj_where.  js/ is INCONSISTENT about this field: js/const.js
// (and js/mkobj.js's import list) use the numeric enum, but js/mkobj.js:1879
// place_object() writes the STRING 'floor' and js/light.js / js/eat.js /
// js/invent.js:270 test the strings.  Normalise so these routines read either
// spelling; the field itself belongs to mkobj.c's owner.
const _WHERE_NAME = {
    [C.OBJ_FREE]: 'free', [C.OBJ_FLOOR]: 'floor',
    [C.OBJ_CONTAINED]: 'contained', [C.OBJ_INVENT]: 'invent',
    [C.OBJ_MINVENT]: 'minvent', [C.OBJ_MIGRATING]: 'migrating',
    [C.OBJ_BURIED]: 'buried', [C.OBJ_ONBILL]: 'onbill',
};
function _where(obj) {
    const w = obj?.where;
    return (typeof w === 'number') ? (_WHERE_NAME[w] ?? String(w))
                                   : String(w ?? '');
}
function _carried(obj) { return _where(obj) === 'invent'; }

// C ref: mkobj.c get_obj_location(obj, xp, yp, locflags) — the full switch, as
// {x,y} or null (js/light.js:170 keeps the same private copy; js/invent.js:1192
// has a broken one that returns obj.ox/oy for every `where`).
function _get_obj_location(obj, locflags) {
    if (!obj) return null;
    switch (_where(obj)) {
    case 'invent':
        return { x: game.u?.ux, y: game.u?.uy };
    case 'floor':
        return { x: obj.ox, y: obj.oy };
    case 'minvent':
        if (obj.ocarry?.mx) return { x: obj.ocarry.mx, y: obj.ocarry.my };
        break;      /* !mx => migrating monster */
    case 'buried':
        if (locflags & C.BURIED_TOO) return { x: obj.ox, y: obj.oy };
        break;
    case 'contained':
        if (locflags & C.CONTAINED_TOO)
            return _get_obj_location(obj.ocontainer, locflags);
        break;
    default:
        break;
    }
    return null;
}

// C ref: mon.c maybe_unhide_at(x, y) — a hider whose cover just vanished stops
// hiding.  mon.c's symbol; js/monmove.js and js/invent.js keep private copies.
async function _maybe_unhide_at(x, y) {
    const { m_at } = await import('./display.js');
    const { hideunder } = await import('./monmove.js');
    let mtmp = m_at(x, y);
    if (!mtmp && C.u_at(x, y)) mtmp = game.u;
    if (mtmp && (mtmp.mundetected || mtmp.m_ap_type === C.M_AP_OBJECT))
        await hideunder(mtmp);
}

// C ref: mondata.h is_silent(ptr) — msound == MS_SILENT, and monsym.h numbers
// MS_SILENT 0.
function _is_silent(ptr) { return (ptr?.msound | 0) === 0; }

// C ref: pline.c verbalize() — the monster's speech, suppressed entirely while
// Deaf; and sounds.c SetVoice(), which only picks the synthesised voice for
// interfaces that speak (a no-op for the tty).
async function _verbalize(msg) { if (!_Deaf()) await pline(msg); }
function _SetVoice(_mon, _tag, _vol, _flags) { /* tty: nothing to do */ }

// C ref: timeout.c:1008 kill_egg(egg) — prevent an egg from ever hatching.
export async function kill_egg(egg) {
    /* stop previous timer, if any */
    await stop_timer(HATCH_EGG, _obj_to_any(egg));
}

// C ref: timeout.c:1192 learn_egg_type(mnum) — learn to recognise eggs of the
// given type.  js/invent.js:347 has a PRIVATE no-op stub of the same name that
// shadows this at its own call site; this is the real body.
export async function learn_egg_type(mnum) {
    /* baby monsters hatch from grown-up eggs */
    const { little_to_big } = await import('./makemon.js').catch(() => ({}));
    const idx = little_to_big ? little_to_big(mnum) : mnum;
    const mv = (game.mvitals = game.mvitals || []);
    mv[idx] = mv[idx] || { mvflags: 0 };
    mv[idx].mvflags |= MV_KNOWS_EGG;
    /* we might have just learned about other eggs being carried */
    const { update_inventory } = await import('./invent.js');
    await update_inventory();
}

// C ref: teleport.c enexto(cc, xx, yy, mdat).  GAP: teleport.c's symbol and no
// js/ module exports it (js/dog.js:124 and js/do.js:316 each keep a private
// copy, js/apply.js:1715 stubs it the same way).  enexto_core()'s goodpos ring
// scan DRAWS, so the real one has to be in place before hatch_egg() below is
// wired into the timer queue -- both the hatch position AND the draw count
// depend on it.
async function _enexto(_cc, _xx, _yy, _mdat) { return false; }

// C ref: timeout.c:1016 hatch_egg(arg, timeout) — the HATCH_EGG timer callback.
export async function hatch_egg(arg, timeout) {
    const egg = arg?.a_obj;
    /* sterilized while waiting */
    if (!egg || egg.corpsenm === NON_PM) return;

    const { big_to_little, monster_by_pmidx } = await import('./makemon.js');
    const { makemon } = await import('./makemon.js');
    const { tamedog } = await import('./dothrow.js');
    const { m_monnam, a_monnam } = await import('./do_name.js');
    const { makeplural, useup, obj_extract_self, obfree } = await import('./invent.js');
    const { cansee } = await import('./vision.js');
    const { newsym, m_at, canseemon_shared } = await import('./display.js');
    const { cry_sound } = await import('./sounds.js');
    const { container_weight } = await import('./mkobj.js');
    const { is_pool } = await import('./dbridge.js');
    const { hideunder } = await import('./monmove.js');

    let mon = null, mon2 = null;
    let knows_egg = false, cansee_hatchspot = false;
    let i = 0, hatchcount = 0;
    const mnum = big_to_little(egg.corpsenm);
    /* The identity of one's father is learned, not innate.  C short-circuits,
       so the rn2(2) is only drawn for a carried egg with spe == 0 and a male
       hero. */
    const yours = !!(egg.spe
                     || (!game.flags?.female && _carried(egg) && !rn2(2)));
    const silent = (timeout !== (game.moves | 0));   /* hatched while away */

    /* only can hatch when in INVENT, FLOOR, MINVENT; get_obj_location() fails
       for MIGRATING, and for CONTAINED/BURIED without their locflags */
    const loc = _get_obj_location(egg, 0);
    let x = 0, y = 0;
    if (loc) {
        x = loc.x; y = loc.y;
        hatchcount = rnd(egg.quan | 0);
        cansee_hatchspot = cansee(x, y) && !silent;
        const mv = (game.mvitals = game.mvitals || []);
        const ptr = monster_by_pmidx(mnum);
        if (!((ptr?.geno | 0) & G_UNIQ)
            && !((mv[mnum]?.mvflags | 0) & (G_GENOD | G_EXTINCT))) {
            const cc = { x: 0, y: 0 };
            for (i = hatchcount; i > 0; i--) {
                if (!await _enexto(cc, x, y, ptr)
                    || !(mon = makemon(ptr, cc.x, cc.y,
                                       C.NO_MINVENT | C.MM_NOMSG)))
                    break;
                /* tame if your own egg hatches while you're on the same
                   dungeon level, or any dragon egg which hatches while it's in
                   your inventory */
                if ((yours && !silent)
                    || (_carried(egg) && mon.data?.mlet === S_DRAGON_LET)) {
                    if (await tamedog(mon, null, false)) {
                        if (_carried(egg) && mon.data?.mlet !== S_DRAGON_LET)
                            mon.mtame = 20;
                    }
                }
                if ((mv[mnum]?.mvflags | 0) & G_EXTINCT)
                    break;      /* just made the last one */
                mon2 = mon;     /* in case makemon() fails on the 2nd egg */
            }
            if (!mon) mon = mon2;
            hatchcount -= i;
            egg.quan -= hatchcount;
        }
    }

    if (mon) {
        let monnambuf = '', carriedby = '';
        const siblings = (hatchcount > 1);
        let redraw = false;

        if (cansee_hatchspot) {
            /* [bug? m_monnam() yields the accurate monster type regardless of
               hallucination] */
            monnambuf = `${siblings ? 'some ' : ''}${siblings ? makeplural(m_monnam(mon)) : _an(m_monnam(mon))}`;
            /* we don't learn the egg type here: that needs either seeing the
               egg hatch or already being familiar with it, plus being able to
               see the resulting monster (checked below) */
        }
        switch (_where(egg)) {
        case 'invent':
            knows_egg = true;   /* true even if you are blind */
            if (!cansee_hatchspot)
                await pline(`You feel something ${await _locomotion(mon.data, 'drop')} from your pack!`);
            else
                await pline(`You see ${monnambuf} ${await _locomotion(mon.data, 'drop')} out of your pack!`);
            if (yours) {
                await pline(`${siblings ? 'Their' : 'Its'} ${_ing_suffix(cry_sound(mon))} ${(_is_silent(mon.data) || _Deaf()) ? 'seems' : 'sounds'} like "${game.flags?.female ? 'mommy' : 'daddy'}${egg.spe ? '.' : '?'}"`);
            } else if (mon.data?.mlet === S_DRAGON_LET && !_Deaf()) {
                _SetVoice(mon, 0, 80, 0);
                await _verbalize('Gleep!');     /* Mything eggs :-) */
            }
            break;

        case 'floor':
            if (cansee_hatchspot) {
                knows_egg = true;
                await pline(`You see ${monnambuf} hatch.`);
                redraw = true;  /* update the egg's map location */
            }
            break;

        case 'minvent':
            if (cansee_hatchspot) {
                /* the egg-carrying monster might be invisible */
                mon2 = egg.ocarry;
                if (canseemon_shared(mon2)
                    && (!mon2.wormno || cansee(mon2.mx, mon2.my))) {
                    carriedby = `${_s_suffix(a_monnam(mon2))} pack`;
                    knows_egg = true;
                } else if (is_pool(mon.mx, mon.my)) {
                    carriedby = 'empty water';
                } else {
                    carriedby = 'thin air';
                }
                await pline(`You see ${monnambuf} ${await _locomotion(mon.data, 'drop')} out of ${carriedby}!`);
            }
            break;

        default:
            await impossible(`egg hatched where? (${_where(egg)})`);
            break;
        }

        if (cansee_hatchspot && knows_egg) await learn_egg_type(mnum);

        if ((egg.quan | 0) > 0) {
            /* still some eggs left; the stack wasn't split, just decremented,
               so the weight needs updating; add a new, short hatch timer */
            await _attach_egg_hatch_timeout(egg, rnd(12));
            container_weight(egg);
        } else if (_carried(egg)) {
            useup(egg);
        } else {
            /* free the egg here because we use it above */
            obj_extract_self(egg);
            obfree(egg, null);
            if ((mon = m_at(x, y)) && !hideunder(mon) && cansee(x, y))
                redraw = true;
        }
        if (redraw) await newsym(x, y);
    }
}

// C ref: mondata.c:1380 locomotion(ptr, def) and its locoverbs tables at :1367.
// locoindx is 0 for a lowercase `def` and 1 for a capitalised one; the flys/flyl
// split only differs in the stagger() columns (2/3), so locomotion() itself
// never needs msize.  is_floater() is mondata.h's mlet test (S_EYE / S_LIGHT),
// which this port spells as the display characters 'e' and 'y'.
const _LOCO_LEVITATE = ['float', 'Float'];
const _LOCO_FLY = ['fly', 'Fly'];
const _LOCO_SLITHER = ['slither', 'Slither'];
const _LOCO_OOZE = ['ooze', 'Ooze'];
const _LOCO_IMMOBILE = ['wiggle', 'Wiggle'];
const _LOCO_CRAWL = ['crawl', 'Crawl'];

async function _locomotion(ptr, def) {
    const { mflags1_of, M1_FLY, M1_SLITHY, M1_AMORPHOUS, M1_NOLIMBS }
        = await import('./monflags_data.js');
    const i = (def[0] !== def[0].toUpperCase()) ? 0 : 1;
    const f = mflags1_of(ptr);

    if (ptr?.mlet === 'e' || ptr?.mlet === 'y') return _LOCO_LEVITATE[i];
    if (f & M1_FLY) return _LOCO_FLY[i];
    if (f & M1_SLITHY) return _LOCO_SLITHER[i];
    if (f & M1_AMORPHOUS) return _LOCO_OOZE[i];
    if (!(ptr?.mmove | 0)) return _LOCO_IMMOBILE[i];
    if ((f & M1_NOLIMBS) === M1_NOLIMBS) return _LOCO_CRAWL[i];
    return def;
}

// C ref: objnam.c ing_suffix() — objnam.c's symbol, private at js/invent.js:1369.
function _ing_suffix(s) { return `${String(s).replace(/e$/, '')}ing`; }

// C ref: timeout.c:980 attach_egg_hatch_timeout(egg, when).  js/mkobj.js:1473
// has the same function against ITS timer model (a {when,kind,action} record
// hung on the object); this copy targets the queue at the bottom of this file,
// which is what hatch_egg() above re-arms.  The rnd(i) loop is C's, verbatim:
// the old hatch_it() tried once a turn from age 151 to 200 and hatched on a roll
// above 150, which is > 99.9993% likely.
async function _attach_egg_hatch_timeout(egg, when) {
    /* stop previous timer, if any */
    await stop_timer(HATCH_EGG, _obj_to_any(egg));

    if (!when) {
        for (let i = (MAX_EGG_HATCH_TIME - 50) + 1; i <= MAX_EGG_HATCH_TIME; i++)
            if (rnd(i) > 150) {
                when = i;       /* egg will hatch */
                break;
            }
    }
    if (when)
        await start_timer(when, TIMER_OBJECT, HATCH_EGG, _obj_to_any(egg));
}

// ── burning objects ────────────────────────────────────────────────────────

// C ref: timeout.c:1344 see_lamp_flicker(obj, tailer) — only called if seen.
export async function see_lamp_flicker(obj, tailer) {
    const { xname } = await import('./invent.js');
    switch (_where(obj)) {
    case 'invent':
    case 'minvent':
        await pline(`${await _Yname2(obj)} flickers${tailer}.`);
        break;
    case 'floor':
        await pline(`You see ${_an(xname(obj))} flicker${tailer}.`);
        break;
    default:
        break;
    }
}

// C ref: timeout.c:1359 lantern_message(obj) — the dimming message for brass
// lanterns.  Only called if seen.  ("from adventure")
export async function lantern_message(obj) {
    switch (_where(obj)) {
    case 'invent':
        await pline('Your lantern is getting dim.');
        if (Hallucination())
            await pline('Batteries have not been invented yet.');
        break;
    case 'floor':
        await pline('You see a lantern getting dim.');
        break;
    case 'minvent': {
        const { Monnam } = await import('./do_name.js');
        await pline(`${_s_suffix(Monnam(obj.ocarry))} lantern is getting dim.`);
        break;
    }
    default:
        break;
    }
}

// C ref: timeout.c:1382 burn_object(arg, timeout) — the BURN_OBJECT timer
// callback for lamps, candles and burning potions of oil.  See begin_burn()
// for the meanings of obj->age and obj->spe.
export async function burn_object(arg, timeout) {
    let obj = arg?.a_obj;
    if (!obj) return;
    const { xname, useupall, obj_extract_self, obfree, update_inventory }
        = await import('./invent.js');
    const L = await import('./light.js');
    const { newsym, m_at } = await import('./display.js');
    const { cansee, Blind } = await import('./vision.js');
    const { weight } = await import('./mkobj.js');
    /* C ref: timeout.c:1804 end_burn(obj, timer_attached) — js/light.js:752
       keeps its copy PRIVATE, so fall back to the local body below. */
    const _end_burn = L.end_burn || _end_burn_local;

    const menorah = obj.otyp === _CANDELABRUM();
    const many = menorah ? (obj.spe | 0) > 1 : (obj.quan | 0) > 1;

    /* timeout while away */
    if (timeout !== (game.moves | 0)) {
        const how_long = (game.moves | 0) - timeout;

        if (how_long >= (obj.age | 0)) {
            obj.age = 0;
            await _end_burn(obj, false);

            if (menorah) {
                obj.spe = 0;    /* no more candles */
                obj.owt = weight(obj);
            } else if (_Is_candle(obj) || obj.otyp === _POT_OIL()) {
                let mtmp = null;
                if (_where(obj) === 'floor') mtmp = m_at(obj.ox, obj.oy);
                /* get rid of candles and burning oil potions; we know this
                   object isn't carried by the hero, nor is it migrating */
                obj_extract_self(obj);
                obfree(obj, null);
                obj = null;
                if (mtmp) await _maybe_unhide_at(mtmp.mx, mtmp.my);
            }
        } else {
            obj.age -= how_long;
            await begin_burn(obj, true);
        }
        return;
    }

    /* only interested in INVENT, FLOOR, and MINVENT */
    let canseeit, whose = '', x = 0, y = 0;
    const loc = _get_obj_location(obj, 0);
    if (loc) {
        x = loc.x; y = loc.y;
        canseeit = !Blind() && cansee(x, y);
        /* set `whose' to "Your " or "Fred's " or "The goblin's " */
        whose = await _Shk_Your(obj);
    } else {
        canseeit = false;
    }
    /* when carrying the light source you can feel the heat from a lit lamp or
       candle, so you're notified when it burns out even if blind at the time;
       a brass lantern doesn't radiate enough heat for that */
    const bytouch = (_where(obj) === 'invent' && obj.otyp !== _BRASS_LANTERN());
    let need_newsym = false, need_invupdate = false;

    /* obj->age is the age REMAINING at this point */
    switch (obj.otyp) {
    case _POT_OIL():
        /* this should only be called when we run out */
        if (canseeit) {
            switch (_where(obj)) {
            case 'invent':
                need_invupdate = true;
                /* FALLTHROUGH */
            case 'minvent':
                await pline(`${whose}potion of oil has burnt away.`);
                break;
            case 'floor':
                await pline('You see a burning potion of oil go out.');
                need_newsym = true;
                break;
            default:
                break;
            }
        }
        await _end_burn(obj, false);    /* turn off light source */
        if (_carried(obj)) {
            useupall(obj);
        } else {
            /* clear a migrating obj's destination code before obfree so it
               doesn't complain about deleting a worn item */
            if (_where(obj) === 'migrating') obj.owornmask = 0;
            obj_extract_self(obj);
            obfree(obj, null);
        }
        obj = null;
        break;

    case _BRASS_LANTERN():
    case _OIL_LAMP():
        switch (obj.age | 0) {
        case 150:
        case 100:
        case 50:
            if (canseeit) {
                if (obj.otyp === _BRASS_LANTERN())
                    await lantern_message(obj);
                else
                    await see_lamp_flicker(obj,
                        (obj.age | 0) === 50 ? ' considerably' : '');
            }
            break;

        case 25:
            if (canseeit) {
                if (obj.otyp === _BRASS_LANTERN()) {
                    await lantern_message(obj);
                } else {
                    switch (_where(obj)) {
                    case 'invent':
                    case 'minvent':
                        await pline(`${await _Yname2(obj)} seems about to go out.`);
                        break;
                    case 'floor':
                        await pline(`You see ${_an(xname(obj))} about to go out.`);
                        break;
                    default:
                        break;
                    }
                }
            }
            break;

        case 0:
            /* even if blind you'll know if you're holding it */
            if (canseeit || bytouch) {
                switch (_where(obj)) {
                case 'invent':
                    need_invupdate = true;
                    /* FALLTHROUGH */
                case 'minvent':
                    if (obj.otyp === _BRASS_LANTERN())
                        await pline(`${whose}lantern has run out of power.`);
                    else
                        await pline(`${await _Yname2(obj)} has gone out.`);
                    break;
                case 'floor':
                    if (obj.otyp === _BRASS_LANTERN())
                        await pline('You see a lantern run out of power.');
                    else
                        await pline(`You see ${_an(xname(obj))} go out.`);
                    break;
                default:
                    break;
                }
            }
            await _end_burn(obj, false);
            break;

        default:
            /* someone added fuel to the lamp while it was lit -- fall through
               and let begin_burn() handle the new age */
            break;
        }

        if (obj.age) await begin_burn(obj, true);
        break;

    case _CANDELABRUM():
    case _TALLOW_CANDLE():
    case _WAX_CANDLE():
        switch (obj.age | 0) {
        case 75:
            if (canseeit) {
                switch (_where(obj)) {
                case 'invent':
                case 'minvent':
                    await pline(`${whose}${menorah ? "candelabrum's " : ''}candle${many ? 's are' : ' is'} getting short.`);
                    break;
                case 'floor':
                    await pline(`You see ${menorah ? "a candelabrum's " : many ? 'some ' : 'a '}candle${many ? 's' : ''} getting short.`);
                    break;
                default:
                    break;
                }
            }
            break;

        case 15:
            if (canseeit) {
                switch (_where(obj)) {
                case 'invent':
                case 'minvent':
                    await pline(`${whose}${menorah ? "candelabrum's " : ''}candle${many ? "s'" : "'s"} flame${many ? 's' : ''} flicker${many ? '' : 's'} low!`);
                    break;
                case 'floor':
                    await pline(`You see ${menorah ? "a candelabrum's " : many ? 'some ' : 'a '}candle${many ? "s'" : "'s"} flame${many ? 's' : ''} flicker low!`);
                    break;
                default:
                    break;
                }
            }
            break;

        case 0:
            /* we know even if blind and in our inventory */
            if (canseeit || bytouch) {
                if (menorah) {
                    switch (_where(obj)) {
                    case 'invent':
                        need_invupdate = true;
                        /* FALLTHROUGH */
                    case 'minvent':
                        await pline(`${whose}candelabrum's flame${many ? 's die' : ' dies'}.`);
                        break;
                    case 'floor':
                        await pline(`You see a candelabrum's flame${many ? 's' : ''} die.`);
                        break;
                    default:
                        break;
                    }
                } else {
                    switch (_where(obj)) {
                    case 'invent':
                        /* no need_invupdate: useupall() -> freeinv() does it */
                        /* FALLTHROUGH */
                    case 'minvent':
                        await pline(`${await _Yname2(obj)} ${many ? 'are' : 'is'} consumed!`);
                        break;
                    case 'floor':
                        await pline(`You see ${many ? 'some ' : ''}${many ? xname(obj) : _an(xname(obj))} consumed!`);
                        need_newsym = true;
                        break;
                    default:
                        break;
                    }

                    /* post message.  C passes "" for a blind hero and
                       pline.c vpline() returns immediately on an empty line. */
                    const post = Hallucination()
                                 ? (many ? 'They shriek!' : 'It shrieks!')
                                 : Blind() ? '' : (many ? 'Their flames die.'
                                                        : 'Its flame dies.');
                    if (post) await pline(post);
                }
            }
            await _end_burn(obj, false);

            if (menorah) {
                obj.spe = 0;    /* no candles */
                obj.owt = weight(obj);
                if (_carried(obj)) need_invupdate = true;
            } else {
                if (_carried(obj)) {
                    useupall(obj);
                } else {
                    const onfloor = (_where(obj) === 'floor');
                    /* clear a migrating obj's destination code so obfree won't
                       think this item is worn */
                    if (_where(obj) === 'migrating') obj.owornmask = 0;
                    obj_extract_self(obj);
                    if (onfloor) await _maybe_unhide_at(x, y);
                    obfree(obj, null);
                }
                obj = null;
            }
            break;      /* case [age ==] 0 */

        default:
            /* someone added candles to the menorah while it was lit -- fall
               through and let begin_burn() handle the new age */
            break;
        }

        if (obj && obj.age) await begin_burn(obj, true);
        break;  /* case [otyp ==] candelabrum|tallow_candle|wax_candle */

    default:
        await impossible(`burn_object: unexpected obj ${xname(obj)}`);
        break;
    }
    if (need_newsym) await newsym(x, y);
    if (need_invupdate) await update_inventory();
}

// C ref: timeout.c:1804 end_burn(obj, timer_attached).  js/light.js:752 keeps
// its copy module-private, so this is the fallback the callers above use; it is
// the same body.
async function _end_burn_local(obj, timer_attached) {
    const { xname, update_inventory } = await import('./invent.js');
    const { del_light_source, artifact_light, LS_OBJECT } = await import('./light.js');

    if (!obj.lamplit) {
        await impossible(`end_burn: obj ${xname(obj)} not lit`);
        return;
    }
    if (obj.otyp === _MAGIC_LAMP() || artifact_light(obj)) timer_attached = false;

    if (!timer_attached) {
        /* [DS] clean up explicitly, since timer cleanup won't happen */
        del_light_source(LS_OBJECT, obj);
        obj.lamplit = 0;
        if (_where(obj) === 'invent') await update_inventory();
    } else if (!await stop_timer(BURN_OBJECT, _obj_to_any(obj))) {
        await impossible(`end_burn: obj ${xname(obj)} not timed!`);
    }
}

// C ref: timeout.c:1711 begin_burn(obj, already_lit) — start a burn timeout,
// and unless already lit create the vision system's light source.  Silent: it
// must not print anything.  Burn rules (from the C comment):
//   potions of oil, lamps & candles: age = turns of fuel left, spe unused
//   magic lamps:                     age unused, spe = 0 dead / 1 lightable
//   candelabrum:                     age = turns of fuel left, spe = #candles
// Once the burn begins, age is the fuel remaining AFTER the burn finishes; an
// early end_burn() adds the unused time back.
export async function begin_burn(obj, already_lit) {
    const { artifact_light, arti_light_radius, candle_light_range,
            new_light_source, LS_OBJECT } = await import('./light.js');
    const { xname, update_inventory } = await import('./invent.js');
    let radius = 3;
    let turns = 0;
    let do_timer = true;

    if ((obj.age | 0) === 0 && obj.otyp !== _MAGIC_LAMP()
        && !artifact_light(obj))
        return;

    switch (obj.otyp) {
    case _MAGIC_LAMP():
        obj.lamplit = 1;
        do_timer = false;
        break;

    case _POT_OIL():
        turns = obj.age | 0;
        if (obj.odiluted) turns = Math.floor((3 * turns + 2) / 4);
        radius = 1;     /* very dim light */
        break;

    case _BRASS_LANTERN():
    case _OIL_LAMP():
        /* magic times are 150, 100, 50, 25, and 0 */
        if ((obj.age | 0) > 150) turns = (obj.age | 0) - 150;
        else if ((obj.age | 0) > 100) turns = (obj.age | 0) - 100;
        else if ((obj.age | 0) > 50) turns = (obj.age | 0) - 50;
        else if ((obj.age | 0) > 25) turns = (obj.age | 0) - 25;
        else turns = obj.age | 0;
        break;

    case _CANDELABRUM():
    case _TALLOW_CANDLE():
    case _WAX_CANDLE():
        /* magic times are 75, 15, and 0 */
        if ((obj.age | 0) > 75) turns = (obj.age | 0) - 75;
        else if ((obj.age | 0) > 15) turns = (obj.age | 0) - 15;
        else turns = obj.age | 0;
        radius = candle_light_range(obj);
        break;

    default:
        /* [ALI] support artifact light sources */
        if (artifact_light(obj)) {
            obj.lamplit = 1;
            do_timer = false;
            radius = arti_light_radius(obj);
        } else {
            await impossible(`begin burn: unexpected ${xname(obj)}`);
            turns = obj.age | 0;
        }
        break;
    }

    if (do_timer) {
        if (await start_timer(turns, TIMER_OBJECT, BURN_OBJECT,
                              _obj_to_any(obj))) {
            obj.lamplit = 1;
            obj.age -= turns;
            if (_carried(obj) && !already_lit) await update_inventory();
        } else {
            obj.lamplit = 0;
        }
    } else {
        if (_carried(obj) && !already_lit) await update_inventory();
    }

    if (obj.lamplit && !already_lit) {
        const loc = _get_obj_location(obj, C.CONTAINED_TOO | C.BURIED_TOO);
        if (loc)
            new_light_source(loc.x, loc.y, radius, LS_OBJECT, obj);
        else
            await impossible("begin_burn: can't get obj position");
    }
}

// C ref: timeout.c:1827 cleanup_burn(arg, expire_time) — the BURN_OBJECT
// timer's cleanup hook, run when the timer is STOPPED rather than fired, so the
// unused fuel goes back onto obj->age.  Named without the C prefix collision
// note because cleanup_burn is timeout.c's own staticfn: js/light.js only
// mentions it in a comment.
async function cleanup_burn(arg, expire_time) {
    const obj = arg?.a_obj;
    const { xname, update_inventory } = await import('./invent.js');
    const { del_light_source, LS_OBJECT } = await import('./light.js');

    if (!obj?.lamplit) {
        await impossible(`cleanup_burn: obj ${xname(obj)} not lit`);
        return;
    }
    del_light_source(LS_OBJECT, obj);
    /* restore unused time */
    obj.age = (obj.age | 0) + expire_time - (game.moves | 0);
    obj.lamplit = 0;

    if (_where(obj) === 'invent') await update_inventory();
}

// ── storms ─────────────────────────────────────────────────────────────────

// C ref: monattk.h AD_ELEC and hack.h:1486 BZ_M_SPELL(bztyp) == -10 - bztyp
// (a monster spell buzz, i.e. an unspecified attacker).
const AD_ELEC = 6;
const _BZ_M_SPELL = (bztyp) => -10 - bztyp;

// C ref: timeout.c:1846 do_storms() — the Plane of Air's lightning.  Called
// once per turn from allmain.c, immediately after dosounds().
export async function do_storms() {
    const u = game.u;

    /* no lightning if not a stormy level, or too often even then */
    if (!game.level?.flags?.stormy || rn2(8)) return;

    const { dobuzz } = await import('./zap.js');

    /* the number of strikes is 8-log2(nstrike) */
    for (let nstrike = rnd(64); nstrike <= 64; nstrike *= 2) {
        let count = 0, x = 0, y = 0;
        do {
            x = rnd(COLNO - 1);
            y = rn2(ROWNO);
        } while (++count < 100 && _levl(x, y)?.typ !== CLOUD);

        if (count < 100) {
            const dirx = rn2(3) - 1;
            const diry = rn2(3) - 1;
            if (dirx !== 0 || diry !== 0) {
                game.buzzer = 0;        /* unspecified attacker */
                await dobuzz(_BZ_M_SPELL(C.BZ_OFS_AD(AD_ELEC)), 8,
                             x, y, dirx, diry, true);
            }
        }
    }

    if (_levl(u.ux, u.uy)?.typ === CLOUD) {
        /* inside a cloud during a thunderstorm is deafening -- and even an
           already deaf hero senses the thunder's vibrations */
        await pline('Kaboom!!!  Boom!!  Boom!!');
        _incr_itimeout('HDeaf', rn1(20, 30));
        _set_botl();
        if (!u.uinvulnerable) {
            await stop_occupation();
            nomul(-3);
            game.multi_reason = 'hiding from thunderstorm';
            game.nomovemsg = null;
        }
    } else {
        await pline('You hear a rumbling noise.');
    }
}

// ═══ Generic Timeout Functions ══════════════════════════════════════════════
//
// C ref: timeout.c:1894-1951, and the interface contract in that comment block:
//   start_timer(when, kind, func_index, arg)  -> boolean, queue ordered
//                                               "sooner" to "later"
//   stop_timer(func_index, arg)               -> turns remaining, 0 if none
//   peek_timer(func_index, arg)               -> absolute expiry, 0 if none
//   run_timers()                              -> fire everything due
//   save/restore/relink, obj_move/split/stop, obj_has_timer.
//
// THE QUEUE ITSELF IS NEW AND LOCAL TO THIS FILE.  js/ has no timer_element
// list: js/mkobj.js:1349 hangs a single {when, kind, action} record on the
// object and its run_object_timers() only ever fires ROT_CORPSE and
// SHRINK_GLOB from it.  Rather than add fields to that record or introduce a
// parallel global, the list below keeps C's timer_element shape exactly
// (next / timeout / tid / kind / needs_fixup / func_index / arg) in a
// module-local head pointer, the way C's gt.timer_base does.
let timer_base = null;      /* C: gt.timer_base */
let timer_id = 1;           /* C: svt.timer_id */

// C ref: win/tty/wintty.c create_nhwindow/putstr/display_nhwindow/
// destroy_nhwindow.  frozen/terminal.js owns the real grid, so these collect
// the lines exactly as js/end.js:1375 does with its own private copies; the
// wiring pass renders win.lines.
function _create_nhwindow(type) { return { type, lines: [] }; }
function _putstr(win, _attr, str) { if (win) win.lines.push(String(str ?? '')); }
function _display_nhwindow(_win, _blocking) { /* rendered by the wiring pass */ }
function _destroy_nhwindow(_win) { }

// C ref: region.c visible_region_summary(win) — region.c's symbol, unported.
function _visible_region_summary(_win) { }

// C ref: decl.c fmt_ptr(ptr) — prints the argument's ADDRESS, which nothing can
// reproduce; the object/monster id is the stable stand-in.
function _fmt_ptr(v) {
    if (v && typeof v === 'object')
        return `#${v.o_id ?? v.m_id ?? '?'}`;
    return String(v);
}

// C ref: timeout.c:1978 timeout_funcs[] — the dispatch table, in
// timeout.h enum timeout_types order, each with its optional cleanup hook.
// Handlers are resolved LAZILY from the module that owns them: four are not
// ported anywhere (rot_organic/rot_corpse are dig.c, revive_mon/zombify_mon are
// zap.c, melt_ice_away is do.c), and a static import of a missing export is a
// link-time error.
function _nyi(name, where) {
    return async () => impossible(`timeout_funcs: ${name}() (${where}) is not ported`);
}
// js/'s ports of these two take the OBJECT rather than C's `anything` union
// (js/mkobj.js:3062 shrink_glob(obj, expire_time)); apply.js's fig_transform
// accepts either.  Unwrap at the edge so the queue itself stays C-shaped.
function _obj_handler(mod, fname) {
    return async (arg, timeout) => {
        const fn = (await import(mod))[fname];
        if (typeof fn !== 'function')
            return impossible(`timeout_funcs: ${fname}() is not exported by ${mod}`);
        return fn(arg?.a_obj ?? arg, timeout);
    };
}

const timeout_funcs = [];
/* object timers */
timeout_funcs[ROT_ORGANIC] = { f: _nyi('rot_organic', 'dig.c'), cleanup: null,
                               name: 'rot_organic' };
timeout_funcs[ROT_CORPSE] = { f: _nyi('rot_corpse', 'dig.c'), cleanup: null,
                              name: 'rot_corpse' };
timeout_funcs[REVIVE_MON] = { f: _nyi('revive_mon', 'zap.c'), cleanup: null,
                              name: 'revive_mon' };
timeout_funcs[ZOMBIFY_MON] = { f: _nyi('zombify_mon', 'zap.c'), cleanup: null,
                               name: 'zombify_mon' };
timeout_funcs[BURN_OBJECT] = { f: burn_object, cleanup: cleanup_burn,
                               name: 'burn_object' };
timeout_funcs[HATCH_EGG] = { f: hatch_egg, cleanup: null, name: 'hatch_egg' };
timeout_funcs[FIG_TRANSFORM] = { f: _obj_handler('./apply.js', 'fig_transform'),
                                 cleanup: null, name: 'fig_transform' };
timeout_funcs[SHRINK_GLOB] = { f: _obj_handler('./mkobj.js', 'shrink_glob'),
                               cleanup: null, name: 'shrink_glob' };
/* level timers */
timeout_funcs[MELT_ICE_AWAY] = { f: _nyi('melt_ice_away', 'do.c'), cleanup: null,
                                 name: 'melt_ice_away' };
/* currently no monster or global timers */

// C ref: timeout.c:1994 kind_name(kind).
export async function kind_name(kind) {
    switch (kind) {
    case TIMER_NONE:
        await impossible('no timer type');
        return 'none';
    case TIMER_LEVEL:
        return 'level';
    case TIMER_GLOBAL:
        return 'global';
    case TIMER_OBJECT:
        return 'object';
    case TIMER_MONSTER:
        return 'monster';
    default:
        break;
    }
    return 'unknown';
}

// C ref: timeout.c:2013 print_queue(win, base).  VERBOSE_TIMER is #defined in
// timeout.c, so the handler NAME is printed rather than its index.
export async function print_queue(win, base) {
    if (!base) {
        _putstr(win, 0, ' <empty>');
    } else {
        _putstr(win, 0, 'timeout  id   kind   call');
        for (let curr = base; curr; curr = curr.next) {
            const buf = ` ${String(curr.timeout).padStart(4)}   `
                      + `${String(curr.tid).padStart(4)}  `
                      + `${(await kind_name(curr.kind)).padEnd(6)} `
                      + `${timeout_funcs[curr.func_index]?.name}`
                      + `(${_fmt_ptr(curr.arg?.a_void)})`;
            _putstr(win, 0, buf);
        }
    }
}

// C ref: timeout.c:2040 wiz_timeout_queue() — the wizard-mode #timeout command.
export async function wiz_timeout_queue() {
    const u = game.u || {};
    const win = _create_nhwindow(NHW_MENU);     /* corner text window */
    if (win === WIN_ERR) return ECMD_OK;

    _putstr(win, 0, `Current time = ${game.moves | 0}.`);
    _putstr(win, 0, '');
    _putstr(win, 0, 'Active timeout queue:');
    _putstr(win, 0, '');
    await print_queue(win, timer_base);

    /* Timed properties: check every one; most can't obtain a temporary timeout
       in normal play, but #wizintrinsic can force them. */
    let count = 0, longestlen = 0, specindx = 0;
    for (let i = 0; propertynames[i].prop_name; ++i) {
        const propname = propertynames[i].prop_name;
        const p = propertynames[i].prop_num;
        if (_prop_timeout(p)) {
            ++count;
            if (propname.length > longestlen) longestlen = propname.length;
        }
        if (specindx === 0 && p === C.COLD_RES) /* was FIRE_RES, has changed */
            specindx = i;
    }
    _putstr(win, 0, '');
    if (!count) {
        _putstr(win, 0, 'No timed properties.');
    } else {
        _putstr(win, 0, 'Timed properties:');
        _putstr(win, 0, '');
        for (let i = 0; propertynames[i].prop_name; ++i) {
            const propname = propertynames[i].prop_name;
            const p = propertynames[i].prop_num;
            const t = _prop_timeout(p);
            if (t) {
                if (specindx > 0 && i >= specindx) {
                    _putstr(win, 0, ' -- settable via #wizintrinsic only --');
                    specindx = 0;
                }
                /* the timeout can be up to 16777215 but a width of 4 lines the
                   values up almost all of the time */
                _putstr(win, 0, ` ${propname.padEnd(longestlen)} `
                                + `${String(t).padStart(4)}`);
            }
        }
    }
    if (u.uswldtim) {
        _putstr(win, 0, '');
        /* decremented when the engulfer moves, so it can last longer than the
           number of turns reported if the engulfer is slow */
        _putstr(win, 0, `Swallow countdown is ${u.uswldtim}.`);
    }
    if (u.uinvault) {
        _putstr(win, 0, '');
        _putstr(win, 0, `Vault counter is ${u.uinvault}.`);
    }
    const { any_visible_region } = await import('./region.js');
    if (any_visible_region()) _visible_region_summary(win);

    const stasis = game.level?.flags?.stasis_until;
    if (stasis != null && stasis >= (game.moves | 0)) {
        _putstr(win, 0, '');
        _putstr(win, 0, `Level is no-teleport for ${stasis - (game.moves | 0) + 1} `
                        + `${(stasis - (game.moves | 0) > 0) ? 'turns' : 'more turn'}.`);
    }
    _display_nhwindow(win, false);
    _destroy_nhwindow(win);

    return ECMD_OK;
}

// C: u.uprops[p].intrinsic & TIMEOUT for a NUMERIC prop index.  This port keeps
// three of the timers outside u.uprops (BLINDED -> u.blinded, WOUNDED_LEGS ->
// u.HWounded_legs, FUMBLING -> u.HFumbling), so route through the TIMED_PROPS
// table for those and fall back to the u.uprops key otherwise.
const _PROP_TIMED_NAME = {
    [C.INVULNERABLE]: 'INVULNERABLE', [C.CONFUSION]: 'CONFUSION',
    [C.STUNNED]: 'STUNNED', [C.BLINDED]: 'BLINDED',
    [C.WOUNDED_LEGS]: 'WOUNDED_LEGS', [C.VOMITING]: 'VOMITING',
    [C.HALLUC]: 'HALLUC', [C.DEAF]: 'DEAF', [C.FUMBLING]: 'FUMBLING',
    [C.FAST]: 'FAST',
};
const _PROP_UPROP_KEY = {
    [C.STONED]: 'Stoned', [C.SLIMED]: 'Slimed', [C.STRANGLED]: 'Strangled',
    [C.SICK]: 'Sick', [C.GLIB]: 'Glib', [C.SLEEPY]: 'Sleepy',
    [C.LEVITATION]: 'Levitation', [C.PASSES_WALLS]: 'HPasses_walls',
    [C.MAGICAL_BREATHING]: 'HMagical_breathing',
};
function _prop_timeout(p) {
    const tp = _PROP_TIMED_NAME[p] && timed_prop(_PROP_TIMED_NAME[p]);
    if (tp) return tp.get(game.u || {}) | 0;
    const key = _PROP_UPROP_KEY[p];
    return key ? _prop(key) : 0;
}

// C ref: timeout.c:2129 timer_sanity_check() — every impossible() here is a
// diagnostic; none of them changes state.
export async function timer_sanity_check() {
    for (let curr = timer_base; curr; curr = curr.next) {
        const t_id = curr.tid;
        switch (curr.kind) {
        case TIMER_OBJECT: {
            const obj = curr.arg?.a_obj;
            const obj_adr = _fmt_ptr(obj);
            let owhere = _where(obj);

            if (!obj.timed)
                await impossible(`timer sanity: untimed obj ${obj_adr}, timer ${t_id}`);
            /* if obj is in a (possibly nested) container, find the outermost */
            let top = obj;
            for (; top; top = top.ocontainer)
                if ((owhere = _where(top)) !== 'contained') break;
            if (owhere === 'migrating'
                || (owhere === 'minvent' && !mon_is_local(top.ocarry))) {
                /* migrating directly, or carried by a migrating monster: not
                   able to validate the location, so skip the checks */
                break;
            }
            const loc = _get_obj_location(obj, C.CONTAINED_TOO | C.BURIED_TOO);
            if (!loc) {
                /* free? or on a shop's used-up bill? */
                await impossible(`timer sanity: can't locate obj ${obj_adr}`
                                 + ` [where=${_where(obj)}], timer ${t_id}`);
            } else if (!C.isok(loc.x, loc.y)) {
                await impossible(`timer sanity: obj ${obj_adr} [where=${_where(obj)}]`
                                 + ` located at <${loc.x},${loc.y}>, timer ${t_id}`);
            }
            break;
        }
        case TIMER_MONSTER:
            await impossible(`timer sanity: unexpected monster timer ${t_id}`);
            break;
        case TIMER_LEVEL: {
            const lwhere = curr.arg?.a_long | 0;
            const x = (lwhere >> 16) & 0xFFFF;
            const y = lwhere & 0xFFFF;
            if (C.isok(x, y)) {
                const loc = _levl(x, y);
                const { is_ice } = await import('./dbridge.js');
                /* the terrain under an OPEN drawbridge can be frozen moat;
                   is_ice() only sees that while the bridge is closed */
                if (curr.func_index === MELT_ICE_AWAY && !is_ice(x, y)
                    && !(loc?.typ === DRAWBRIDGE_DOWN
                         && (loc.drawbridgemask & DB_UNDER) === DB_ICE))
                    await impossible(`timer sanity: melt timer ${t_id} on non-ice`
                                     + ` ${loc?.typ} <${x},${y}>`);
            } else {
                await impossible(`timer sanity: spot timer ${t_id} at <${x},${y}>`);
            }
            break;
        }
        case TIMER_GLOBAL:
            await impossible(`timer sanity: unexpected global timer ${t_id}`);
            break;
        default:
            await impossible(`timer sanity: unknown timer ${t_id}, type: ${curr.kind}`);
            break;
        }
    }
}

// C ref: timeout.c:2221 run_timers() — always use the FIRST element; the list
// is ordered, so we are done once the head is in the future.  Elements may be
// added or deleted by the handlers at any time, which is why the head is re-read
// every iteration.
export async function run_timers() {
    while (timer_base && timer_base.timeout <= (game.moves | 0)) {
        const curr = timer_base;
        timer_base = curr.next;

        if (curr.kind === TIMER_OBJECT) curr.arg.a_obj.timed--;
        await timeout_funcs[curr.func_index].f(curr.arg, curr.timeout);
        /* C memsets and frees the element here */
        curr.next = null;
    }
}

// C ref: timeout.c:2246 start_timer(when, kind, func_index, arg) — the timer
// fires at svm.moves + when.
export async function start_timer(when, kind, func_index, arg) {
    if (kind <= TIMER_NONE || kind >= NUM_TIMER_KINDS
        || func_index < 0 || func_index >= NUM_TIME_FUNCS)
        _panic(`start_timer (${await kind_name(kind)}: ${func_index})`);

    /* fail if <arg> already has a <func_index> timer running */
    let dup = timer_base;
    for (; dup; dup = dup.next)
        if (dup.kind === kind && dup.func_index === func_index
            && dup.arg.a_void === arg.a_void)
            break;
    if (dup) {
        await impossible('Attempted to start duplicate '
                         + `${timeout_funcs[func_index]?.name} timer, aborted.`);
        return false;
    }

    const gnu = {
        next: null,
        tid: timer_id++,
        timeout: (game.moves | 0) + when,
        kind,
        needs_fixup: 0,
        func_index,
        arg,
    };
    insert_timer(gnu);

    if (kind === TIMER_OBJECT)  /* increment the object's timed count */
        arg.a_obj.timed = (arg.a_obj.timed | 0) + 1;

    return true;
}

// C ref: timeout.c:2298 stop_timer(func_index, arg) — returns the turns
// remaining until it would have gone off, 0 if there was no such timer.
export async function stop_timer(func_index, arg) {
    const ref = { base: timer_base };
    const doomed = remove_timer(ref, func_index, arg);
    timer_base = ref.base;

    if (doomed) {
        const timeout = doomed.timeout;
        if (doomed.kind === TIMER_OBJECT)
            arg.a_obj.timed = (arg.a_obj.timed | 0) - 1;
        const cleanup_func = timeout_funcs[doomed.func_index]?.cleanup;
        if (cleanup_func) await cleanup_func(arg, timeout);
        return timeout - (game.moves | 0);
    }
    return 0;
}

// C ref: timeout.c:2323 peek_timer(type, arg) — the ABSOLUTE expiry turn.  Note
// that C does not check `kind` here, only func_index and the arg identity.
export function peek_timer(type, arg) {
    for (let curr = timer_base; curr; curr = curr.next)
        if (curr.func_index === type && curr.arg.a_void === arg.a_void)
            return curr.timeout;
    return 0;
}

// C ref: timeout.c:2338 obj_move_timers(src, dest) — reassign every timer from
// src to dest, leaving src untimed.
export function obj_move_timers(src, dest) {
    let count = 0;
    for (let curr = timer_base; curr; curr = curr.next)
        if (curr.kind === TIMER_OBJECT && curr.arg.a_obj === src) {
            curr.arg.a_obj = dest;
            curr.arg.a_void = dest;
            dest.timed = (dest.timed | 0) + 1;
            count++;
        }
    if (count !== (src.timed | 0)) _panic('obj_move_timers');
    src.timed = 0;
}

// C ref: timeout.c:2358 obj_split_timers(src, dest) — duplicate src's timers
// onto dest.  `next_timer` is captured first because start_timer() inserts.
export async function obj_split_timers(src, dest) {
    let next_timer = null;
    for (let curr = timer_base; curr; curr = next_timer) {
        next_timer = curr.next;
        if (curr.kind === TIMER_OBJECT && curr.arg.a_obj === src)
            await start_timer(curr.timeout - (game.moves | 0), TIMER_OBJECT,
                              curr.func_index, _obj_to_any(dest));
    }
}

// C ref: timeout.c:2376 obj_stop_timers(obj) — stop every timer attached to
// obj.  This works because all object pointers are unique.  js/invent.js:480 and
// js/mkobj.js:1360 keep one-line private stubs of the C name.
export async function obj_stop_timers(obj) {
    let prev = null, next_timer = null;
    for (let curr = timer_base; curr; curr = next_timer) {
        next_timer = curr.next;
        if (curr.kind === TIMER_OBJECT && curr.arg.a_obj === obj) {
            if (prev) prev.next = curr.next;
            else timer_base = curr.next;
            const cleanup_func = timeout_funcs[curr.func_index]?.cleanup;
            if (cleanup_func) await cleanup_func(curr.arg, curr.timeout);
        } else {
            prev = curr;
        }
    }
    obj.timed = 0;
}

// C ref: timeout.c:2403 obj_has_timer(object, timer_type).
export function obj_has_timer(object, timer_type) {
    const timeout = peek_timer(timer_type, _obj_to_any(object));
    return timeout !== 0;
}

// C ref: timeout.c:2415 spot_stop_timers(x, y, func_index) — a TIMER_LEVEL
// timer's arg is the packed coordinate, not a pointer.
export async function spot_stop_timers(x, y, func_index) {
    const where = (x << 16) | y;
    let prev = null, next_timer = null;
    for (let curr = timer_base; curr; curr = next_timer) {
        next_timer = curr.next;
        if (curr.kind === TIMER_LEVEL && curr.func_index === func_index
            && curr.arg.a_long === where) {
            if (prev) prev.next = curr.next;
            else timer_base = curr.next;
            const cleanup_func = timeout_funcs[curr.func_index]?.cleanup;
            if (cleanup_func) await cleanup_func(curr.arg, curr.timeout);
        } else {
            prev = curr;
        }
    }
}

// C ref: timeout.c:2444 spot_time_expires(x, y, func_index).
export function spot_time_expires(x, y, func_index) {
    const where = (x << 16) | y;
    for (let curr = timer_base; curr; curr = curr.next)
        if (curr.kind === TIMER_LEVEL && curr.func_index === func_index
            && curr.arg.a_long === where)
            return curr.timeout;
    return 0;
}

// C ref: timeout.c:2458 spot_time_left(x, y, func_index).
export function spot_time_left(x, y, func_index) {
    const expires = spot_time_expires(x, y, func_index);
    return (expires > 0) ? expires - (game.moves | 0) : 0;
}

// C ref: timeout.c:2466 insert_timer(gnu) — insert into the global queue,
// keeping it ordered "sooner" to "later"; a tie inserts BEFORE the existing
// entry (the loop breaks on `>=`).
export function insert_timer(gnu) {
    let prev = null, curr = timer_base;
    for (; curr; prev = curr, curr = curr.next)
        if (curr.timeout >= gnu.timeout) break;

    gnu.next = curr;
    if (prev) prev.next = gnu;
    else timer_base = gnu;
}

// C ref: timeout.c:2482 remove_timer(base, func_index, arg) — unlink and return
// the matching element, or null.  C's `timer_element **base` becomes a `{ base }`
// box so the caller sees a new head.
export function remove_timer(baseref, func_index, arg) {
    let prev = null, curr = baseref.base;
    for (; curr; prev = curr, curr = curr.next)
        if (curr.func_index === func_index && curr.arg.a_void === arg.a_void)
            break;

    if (curr) {
        if (prev) prev.next = curr.next;
        else baseref.base = curr.next;
    }
    return curr || null;
}

// C ref: timeout.c:2504 write_timer(nhfp, timer) — an object or monster timer
// is written with the o_id/m_id in place of the pointer, and needs_fixup set so
// relink_timers() knows to resolve it.  js/storage.js is frozen and the port's
// save format is plain objects, so this returns the record instead of streaming
// it; the pointer->id substitution is the load-bearing part and is verbatim.
export function write_timer(nhfp, timer) {
    const rec = {
        timeout: timer.timeout, tid: timer.tid, kind: timer.kind,
        func_index: timer.func_index, needs_fixup: timer.needs_fixup, arg: null,
    };
    switch (timer.kind) {
    case TIMER_GLOBAL:
    case TIMER_LEVEL:
        /* assume no pointers in arg */
        rec.arg = { a_long: timer.arg.a_long };
        break;

    case TIMER_OBJECT:
        if (timer.needs_fixup) {
            rec.arg = { a_uint: timer.arg.a_uint };
        } else {
            /* replace the object pointer with its id */
            rec.arg = { a_uint: timer.arg.a_obj.o_id };
            rec.needs_fixup = 1;
        }
        break;

    case TIMER_MONSTER:
        if (timer.needs_fixup) {
            rec.arg = { a_uint: timer.arg.a_uint };
        } else {
            /* replace the monster pointer with its id */
            rec.arg = { a_uint: timer.arg.a_monst.m_id };
            rec.needs_fixup = 1;
        }
        break;

    default:
        _panic('write_timer');
        break;
    }
    if (nhfp && Array.isArray(nhfp.timers)) nhfp.timers.push(rec);
    return rec;
}

// C ref: timeout.c:2559 obj_is_local(obj) — TRUE if the object stays with the
// level when the level is saved.  js/light.js:914 keeps a private copy.
export function obj_is_local(obj) {
    switch (_where(obj)) {
    case 'invent':
    case 'migrating':
        return false;
    case 'floor':
    case 'buried':
        return true;
    case 'contained':
        return obj_is_local(obj.ocontainer);
    case 'minvent':
        return mon_is_local(obj.ocarry);
    default:
        break;
    }
    _panic('obj_is_local');
    return false;
}

// C ref: timeout.c:2583 mon_is_local(mon) — FALSE for a monster on the
// migrating or mydogs chains.  js/light.js:487 keeps a private copy that
// approximates it with `mon.mx > 0`.
export function mon_is_local(mon) {
    for (let curr = game.migrating_mons; curr; curr = curr.nmon)
        if (curr === mon) return false;
    /* gm.mydogs is used during level changes; never saved and restored */
    for (let curr = game.mydogs; curr; curr = curr.nmon)
        if (curr === mon) return false;
    return true;
}

// C ref: timeout.c:2602 timer_is_local(timer).
export function timer_is_local(timer) {
    switch (timer.kind) {
    case TIMER_LEVEL:
        return true;
    case TIMER_GLOBAL:
        return false;
    case TIMER_OBJECT:
        return obj_is_local(timer.arg.a_obj);
    case TIMER_MONSTER:
        return mon_is_local(timer.arg.a_monst);
    default:
        break;
    }
    _panic('timer_is_local');
    return false;
}

// C ref: timeout.c:2626 maybe_write_timer(nhfp, range, write_it) — count the
// timers that would be written, and write them when asked.
export function maybe_write_timer(nhfp, range, write_it) {
    let count = 0;
    for (let curr = timer_base; curr; curr = curr.next) {
        if (range === RANGE_GLOBAL) {
            /* global timers */
            if (!timer_is_local(curr)) {
                count++;
                if (write_it) write_timer(nhfp, curr);
            }
        } else {
            /* local timers */
            if (timer_is_local(curr)) {
                count++;
                if (write_it) write_timer(nhfp, curr);
            }
        }
    }
    return count;
}

// C ref: timeout.c:2667 save_timers(nhfp, range) — RANGE_GLOBAL follows the
// hero (plus anything migrating), RANGE_LEVEL stays with the level.  `nhfp` is
// js/save.js's `mode` bitmask, so update_file()/release_data() are the same
// predicates that file uses, and the record list is returned rather than
// streamed (js/storage.js is frozen).
export async function save_timers(nhfp, range) {
    const { update_file, release_data } = await import('./save.js');
    const out = { timers: [], timer_count: 0 };

    if (update_file(nhfp)) {
        if (range === RANGE_GLOBAL) out.timer_id = timer_id;
        out.timer_count = maybe_write_timer(out, range, false);
        maybe_write_timer(out, range, true);
    }

    if (release_data(nhfp)) {
        let prev = null, next_timer = null;
        for (let curr = timer_base; curr; curr = next_timer) {
            next_timer = curr.next;      /* in case curr is removed */

            /* C: !(!!(range == RANGE_LEVEL) ^ !!timer_is_local(curr)) --
               free exactly the ones this range just wrote out. */
            if (!((range === C.RANGE_LEVEL) !== !!timer_is_local(curr))) {
                if (prev) prev.next = curr.next;
                else timer_base = curr.next;
                /* prev stays the same */
            } else {
                prev = curr;
            }
        }
    }
    return out;
}

// C ref: timeout.c:2706 restore_timers(nhfp, range, adjust) — pull the records
// back in without recalculating the object/monster pointers; a bones pile's
// timers are shifted by `adjust`.
export function restore_timers(nhfp, range, adjust) {
    const src = nhfp || {};
    const ghostly = !!src.bonesfile;    /* C: nhfp->ftype == NHF_BONESFILE */

    if (range === RANGE_GLOBAL && src.timer_id != null) timer_id = src.timer_id;

    /* restore elements */
    let count = src.timer_count | 0;
    const recs = Array.isArray(src.timers) ? src.timers : [];
    let i = 0;
    while (count-- > 0) {
        const rec = recs[i++];
        if (!rec) break;
        const curr = {
            next: null, timeout: rec.timeout, tid: rec.tid, kind: rec.kind,
            needs_fixup: rec.needs_fixup, func_index: rec.func_index,
            arg: rec.arg?.a_uint != null ? _uint_to_any(rec.arg.a_uint)
                                         : _long_to_any(rec.arg?.a_long | 0),
        };
        if (ghostly) curr.timeout += adjust;
        insert_timer(curr);
    }
}

// C ref: timeout.c:2734 timer_stats(hdrfmt, hdrbuf, count, size) — the
// '#stats' wizard-mode command.  C's three out-parameters become `{ s }` /
// `{ v }` boxes; sizeof(timer_element) has no meaning here, so the per-element
// size is reported as C's field count.
const _SIZEOF_TIMER_ELEMENT = 7;

export function timer_stats(hdrfmt, hdrbuf, count, size) {
    if (hdrbuf) hdrbuf.s = String(hdrfmt).replace('%ld', String(_SIZEOF_TIMER_ELEMENT));
    if (count) count.v = 0;
    if (size) size.v = 0;
    for (let te = timer_base; te; te = te.next) {
        if (count) count.v += 1;
        if (size) size.v += _SIZEOF_TIMER_ELEMENT;
    }
}

// C ref: timeout.c:2750 relink_timers(ghostly) — turn the saved o_id back into
// the object.  A bones pile's ids were remapped, so they go through
// lookup_id_mapping() first.
export async function relink_timers(ghostly) {
    const { find_oid, lookup_id_mapping } = await import('./light.js');

    for (let curr = timer_base; curr; curr = curr.next) {
        if (curr.needs_fixup) {
            if (curr.kind === TIMER_OBJECT) {
                let nid;
                if (ghostly) {
                    const box = {};
                    if (!lookup_id_mapping(curr.arg.a_uint, box))
                        _panic('relink_timers 1');
                    nid = box.v ?? box.nid;
                } else {
                    nid = curr.arg.a_uint;
                }
                const obj = find_oid(nid);
                curr.arg = _obj_to_any(obj);
                if (!obj) _panic(`can't find o_id ${nid}`);
                curr.needs_fixup = 0;
            } else if (curr.kind === TIMER_MONSTER) {
                _panic('relink_timers: no monster timer implemented');
            } else {
                _panic('relink_timers 2');
            }
        }
    }
}
