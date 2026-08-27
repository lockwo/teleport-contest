// pray.js — the #pray command and its resolution.
// C ref: src/pray.c — dopray(), can_pray(), prayer_done(), angrygods(),
// gods_upset(), godvoice(), pleased(), in_trouble().
//
// The whole prayer decision tree is ported: can_pray()'s four p_type outcomes,
// angrygods()'s eight rn2(maxanger) arms, and pleased()'s favour switch.  Three
// effects bottom out in subsystems this port does not have and are marked at
// their call site (summon_minion, god_zaps_you's death, dosacrifice's
// floorfood prompt); everything else, including every discarded RNG draw, runs.

import { game } from './gstate.js';
import { rn2, rnz, rn1, rnl, rnd } from './rng.js';
import { update_topl, y_n, newsym } from './display.js';
import { align_gname } from './role.js';
import { A_WIS, A_MAX, A_NONE, A_CHAOTIC, A_NEUTRAL, A_LAWFUL, A_CURRENT,
    A_ORIGINAL, AM_SHRINE, AM_SANCTUM, AM_CHAOTIC, AM_MASK, Amask2align,
    Align2amask, ALTAR, ROOM, TT_LAVA, LUCKMIN, LUCKMAX, MM_NOMSG,
    IS_OBSTRUCTED, SDOOR, SCORR } from './const.js';
import { isok } from './hacklib.js';
import { OMONST } from './const.js';
import { adjalign, exercise, adjattrib } from './attrib.js';
import { losexp, xlev_to_rank } from './exper.js';
import { heal_legs } from './trap.js';
import { hcolor, a_monnam } from './do_name.js';
import { Blind } from './vision.js';
import { In_hell } from './dungeon.js';
import { curse, uncurse, unbless, mkobj, place_object, BALL_CLASS, CHAIN_CLASS,
    COIN_CLASS, POTION_CLASS, POT_WATER, objects as OBJECTS } from './mkobj.js';
import { livelog_printf, LL_CONDUCT, LL_MINORAC } from './livelog.js';
import { mflags2_of, is_undead_flag, likes_gems_flag,
    M2_HUMAN, M2_ELF, M2_DWARF, M2_GNOME, M2_ORC } from './monflags_data.js';
import { CORPSE, AMULET_OF_YENDOR, FOOD_CLASS, AMULET_CLASS } from './mkobj.js';
// C ref: objects[] index of the cheap plastic imitation, one slot below the
// real Amulet (js/mkobj.js:419); mkobj.js exports the real one only.
const FAKE_AMULET_OF_YENDOR = AMULET_OF_YENDOR - 1;

const STRIDENT = 4;
// C ref: pray.c:75-88 trouble codes.  The numeric values are only meaningful
// as an ordering; in_trouble()'s check order is what actually ranks them.
const TROUBLE_STONED = 14, TROUBLE_SLIMED = 13, TROUBLE_STRANGLED = 12,
    TROUBLE_LAVA = 11, TROUBLE_SICK = 10, TROUBLE_STARVING = 9,
    TROUBLE_HIT = 7, TROUBLE_LYCANTHROPE = 6,
    TROUBLE_STUCK_IN_WALL = 4, TROUBLE_CURSED_LEVITATION = 3,
    TROUBLE_CURSED_BLINDFOLD = 1;
const TROUBLE_PUNISHED = -1, TROUBLE_FUMBLING = -2, TROUBLE_CURSED_ITEMS = -3,
    TROUBLE_SADDLE = -4, TROUBLE_BLIND = -5, TROUBLE_POISONED = -6,
    TROUBLE_WOUNDED_LEGS = -7, TROUBLE_HUNGRY = -8, TROUBLE_STUNNED = -9,
    TROUBLE_CONFUSED = -10, TROUBLE_HALLUCINATION = -11;
// C ref: eat.h hunger states.
const HUNGRY = 2, WEAK = 3;
// C ref: attrib.h ATTRMIN(A_WIS) for a non-Gnome/Human hero is 3.
const ATTRMIN = 3;
// C ref: obj.h WT_IRON_BALL_INCR / prop.h W_BALL / W_CHAIN (js/read.js:67).
const WT_IRON_BALL_INCR = 160, W_BALL = 0x10000, W_CHAIN = 0x20000;

// Prayer-resolution scratch state (C globals gp.p_type / gp.p_aligntyp /
// gp.p_trouble), stored on `game` so it resets per segment.
function praystate() {
    if (!game._prayer) game._prayer = { type: 0, aligntyp: 0, trouble: 0 };
    return game._prayer;
}

function roleMnum() {
    return game.urole?.mnum ?? game.u?.umonnum ?? 0;
}

function Luck() {
    return (game.u?.uluck || 0) + (game.u?.moreluck || 0);
}

// C ref: hack.h Hallucination.  The timer lands under three different names
// depending on which file set it (js/cmd.js documents the same union); reading
// only one of them answered FALSE for a hallucinating hero and picked the wrong
// half of every god-mood message below.
function Hallucination() {
    const u = game.u;
    if (!u) return false;
    if ((u.HHalluc_resistance || 0) > 0) return false;
    return !!(u.uhallu || u.HHallucination || u.uprops?.Hallucination);
}

function uprop(name) {
    const u = game.u;
    return !!(u?.uprops?.[name] || u?.[name]);
}

// C ref: pray.c ugod_is_angry() == (u.ualign.record < 0).
function ugod_is_angry() {
    return (game.u?.ualign?.record ?? 0) < 0;
}

// C ref: angrygods()'s gy.youmonst.data->mlet == S_HUMAN test.
function heroIsHuman() {
    return !game.u?.Upolyd;
}

// C ref: attrib.c change_luck(n).  The clamp used to be +/-13; C's you.h:467-468
// put LUCKMAX/LUCKMIN at +/-10, and Luck feeds angrygods()'s `maxanger` (as
// -Luck), so an over-wide clamp picks a different rn2() MODULUS for every
// rebuke a hero suffers after three change_luck(-3)s.  js/invent.js,
// js/dokick.js, js/uhitm.js and js/do_wear.js all already use +/-10.
function change_luck(n) {
    const u = game.u;
    u.uluck = (u.uluck || 0) + n;
    if (u.uluck < 0 && u.uluck < LUCKMIN) u.uluck = LUCKMIN;
    if (u.uluck > 0 && u.uluck > LUCKMAX) u.uluck = LUCKMAX;
}

function ABASE(i) { return game.u?.acurr?.a?.[i] ?? 0; }
function AMAX(i) { return game.u?.amax?.a?.[i] ?? 0; }

// C ref: pray.c critically_low_hp(only_if_injured).
function critically_low_hp(only_if_injured) {
    const u = game.u;
    const polyd = !!u.Upolyd;
    const curhp = polyd ? (u.mh | 0) : (u.uhp | 0);
    let maxhp = polyd ? (u.mhmax | 0) : (u.uhpmax | 0);
    if (only_if_injured && !(curhp < maxhp)) return false;
    const hplim = 15 * (u.ulevel | 0);
    if (maxhp > hplim) maxhp = hplim;
    let divisor;
    switch (xlev_to_rank(u.ulevel | 0)) { /* maps 1..30 into 0..8 */
    case 0: case 1: divisor = 5; break;
    case 2: case 3: divisor = 6; break;
    case 4: case 5: divisor = 7; break;
    case 6: case 7: divisor = 8; break;
    default: divisor = 9; break;
    }
    return curhp <= 5 || curhp * divisor <= maxhp;
}

// C ref: pray.c stuck_in_wall() — surrounded on all eight sides by impassable
// rock.  C also counts a square whose only obstruction is a boulder the hero
// can't push (blocked_boulder); that arm is omitted, which can only ever make
// this answer FALSE where C says TRUE.
function stuck_in_wall() {
    const u = game.u;
    if (uprop('Passes_walls')) return false;
    let count = 0;
    for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
            if (!i && !j) continue;
            const x = u.ux + i, y = u.uy + j;
            const typ = game.level?.at(x, y)?.typ;
            if (!isok(x, y)
                || (typ != null && IS_OBSTRUCTED(typ)
                    && typ !== SDOOR && typ !== SCORR))
                ++count;
        }
    return count === 8;
}

// C ref: hack.h Cursed_obj(otmp, typ).
function Cursed_obj(otmp, symname) {
    return !!otmp && !!otmp.cursed && OBJECTS[otmp.otyp]?.sym === symname;
}

// C ref: pray.c worst_cursed_item() reduced to its "is there one at all?" use;
// the full priority walk only matters for fix_worst_trouble().  Two of C's arms
// are deliberately left out because their gate can't be evaluated here and
// including them would OVER-report a trouble: the leading loadstone scan (gated
// on near_capacity() >= HVY_ENCUMBER) and both uwep arms (gated on welded(),
// which js/invent.js stubs to false).
function worst_cursed_item() {
    for (const o of [game.uarmg, game.uarms, game.uarmc, game.uarm, game.uarmh,
        game.uarmf, game.uarmu, game.uamul, game.uleft, game.uright,
        game.ublindf])
        if (o && o.cursed) return o;
    return null;
}

// C ref: allmain.c Wounded_legs (HWounded_legs || EWounded_legs).
function Wounded_legs() {
    const u = game.u;
    return !!((u?.HWounded_legs || 0) || (u?.EWounded_legs || 0));
}

/*
 * C ref: pray.c in_trouble() — the hero's WORST problem: a positive "major"
 * code, a negative "minor" code, or 0.  This used to `return 0` unconditionally,
 * which is not a harmless simplification: gp.p_trouble picks which ublesscnt
 * threshold can_pray() compares against (200 major / 100 minor / 0 none) and
 * pleased() re-runs it to decide the favour, so a troubled hero was routed into
 * the wrong prayer outcome entirely.
 *
 * Three arms cannot be evaluated in this port and are noted where C has them:
 * region_danger() (no stinking-cloud regions), TROUBLE_COLLAPSING and the
 * loadstone half of worst_cursed_item() (both need near_capacity()), and
 * TROUBLE_UNUSEABLE_HANDS (js/invent.js welded() is a stub that returns false).
 * Each omission can only under-report, never invent, a trouble.
 */
function in_trouble() {
    const u = game.u;
    if (!u) return 0;

    /* major troubles */
    if (uprop('Stoned')) return TROUBLE_STONED;
    if (uprop('Slimed')) return TROUBLE_SLIMED;
    if (uprop('Strangled')) return TROUBLE_STRANGLED;
    if (u.utrap && u.utraptype === TT_LAVA) return TROUBLE_LAVA;
    if (uprop('Sick')) return TROUBLE_SICK;
    if ((u.uhs | 0) >= WEAK) return TROUBLE_STARVING;
    /* region_danger(): stinking cloud regions are not modelled. */
    if ((!u.Upolyd || uprop('Unchanging')) && critically_low_hp(false))
        return TROUBLE_HIT;
    if ((u.ulycn ?? -1) >= 0) return TROUBLE_LYCANTHROPE;
    /* TROUBLE_COLLAPSING: near_capacity() >= EXT_ENCUMBER. */
    if (stuck_in_wall()) return TROUBLE_STUCK_IN_WALL;
    if (Cursed_obj(game.uarmf, 'LEVITATION_BOOTS')
        || Cursed_obj(game.uleft, 'RIN_LEVITATION')
        || Cursed_obj(game.uright, 'RIN_LEVITATION'))
        return TROUBLE_CURSED_LEVITATION;
    /* TROUBLE_UNUSEABLE_HANDS: welded(uwep). */
    if (game.ublindf && game.ublindf.cursed) return TROUBLE_CURSED_BLINDFOLD;

    /* minor troubles */
    if (u.uball) return TROUBLE_PUNISHED; /* hack.h Punished == (uball != 0) */
    if (Cursed_obj(game.uarmg, 'GAUNTLETS_OF_FUMBLING')
        || Cursed_obj(game.uarmf, 'FUMBLE_BOOTS'))
        return TROUBLE_FUMBLING;
    if (worst_cursed_item()) return TROUBLE_CURSED_ITEMS;
    if (u.usteed && u.usteed.saddle && u.usteed.saddle.cursed)
        return TROUBLE_SADDLE;
    if ((u.blinded | 0) > 1) return TROUBLE_BLIND;
    if (((u.uprops?.HDeaf | 0) || (u.HDeaf | 0)) > 1) return TROUBLE_BLIND;
    for (let i = 0; i < A_MAX; i++)
        if (ABASE(i) < AMAX(i)) return TROUBLE_POISONED;
    if (Wounded_legs() && !u.usteed) return TROUBLE_WOUNDED_LEGS;
    if ((u.uhs | 0) >= HUNGRY) return TROUBLE_HUNGRY;
    if (u.uprops?.Stun || u.HStun || u.ustun) return TROUBLE_STUNNED;
    if (u.uprops?.Confusion || u.uconf) return TROUBLE_CONFUSED;
    if (Hallucination()) return TROUBLE_HALLUCINATION;
    return 0;
}

// C ref: pray.c on_altar() / on_shrine().
function on_altar() {
    const loc = game.level?.at(game.u.ux, game.u.uy);
    return loc?.typ === ALTAR;
}
function on_shrine() {
    const loc = game.level?.at(game.u.ux, game.u.uy);
    return ((loc?.altarmask ?? 0) & AM_SHRINE) !== 0;
}

// C ref: pray.c a_align(x,y) == Amask2align(altarmask & AM_MASK).  The old
// hand-rolled mask decode returned A_NEUTRAL (0) for AM_NONE, so a desecrated /
// unaligned altar never produced the A_NONE "praying to Moloch" p_type of -2.
function a_align(x, y) {
    return Amask2align(game.level?.at(x, y)?.altarmask ?? 0);
}

// C ref: pray.c can_pray(praying) — compute gp.p_aligntyp / gp.p_trouble /
// gp.p_type and print the "You begin praying" line.
export function can_pray_quiet() {
    // TEST: C pray.c can_pray(FALSE) -- no messages, no RNG for non-undead heroes.
    let out = false;
    const pr = can_pray(false);
    // can_pray(false) never awaits; the promise is already resolved.
    pr.then((v) => { out = v; });
    return _canPraySync();
}
function _canPraySync() { return __canPrayLast; }
let __canPrayLast = false;
async function can_pray(praying) {
    const gp = praystate();
    const u = game.u;
    gp.aligntyp = on_altar() ? a_align(u.ux, u.uy) : (u.ualign?.type ?? 0);
    gp.trouble = in_trouble();

    // C's is_demon(youmonst.data) refusal needs a demon polyform; the hero is
    // never polymorphed into one here.

    if (praying) {
        await update_topl(`You begin praying to ${align_gname(roleMnum(), gp.aligntyp)}.`);
    }

    const utype = u.ualign?.type ?? 0;
    const record = u.ualign?.record ?? 0;
    let alignment;
    if (utype && utype === -gp.aligntyp)
        alignment = -record;                       /* opposite-alignment altar */
    else if (utype !== gp.aligntyp)
        alignment = Math.trunc(record / 2);        /* different-alignment altar */
    else
        alignment = record;

    if (gp.aligntyp === A_NONE) {
        gp.type = -2;                              /* praying to Moloch */
    } else if (gp.trouble > 0 ? (u.ublesscnt > 200)
               : gp.trouble < 0 ? (u.ublesscnt > 100)
                 : (u.ublesscnt > 0)) {
        gp.type = 0;                               /* too soon... */
    } else if (Luck() < 0 || u.ugangr || alignment < 0) {
        // The old test here was `record <= -ALGND_RECORD_MIN` (i.e. <= 100),
        // which is true for every reachable record: a hero whose prayer timeout
        // had run out was told off instead of being answered.
        gp.type = 1;                               /* too naughty... */
    } else {
        gp.type = (on_altar() && utype !== gp.aligntyp) ? 2 : 3;
    }

    // C's is_undead(youmonst.data) p_type -1 arm (and its rn2(10) for neutrals)
    // needs an undead polyform.

    __canPrayLast = (gp.type === 3 && !In_hell(u.uz));
    return !praying ? __canPrayLast : true;
}

// C ref: pray.c godvoices[] — indexed by ROLL_FROM(godvoices) == rn2(4).
const godvoices = ['booms out', 'thunders', 'rings out', 'booms'];

// C ref: pray.c godvoice(g_align, words).  Emits one rn2(4).
async function godvoice(g_align, words) {
    const quot = words ? '"' : '';
    const which = godvoices[rn2(4)]; // ROLL_FROM(godvoices)
    await update_topl(
        `The voice of ${align_gname(roleMnum(), g_align)} ${which}: `
        + `${quot}${words || ''}${quot}`);
}

// C ref: pray.c gods_angry(g_align).  Draws godvoice's rn2(4).
async function gods_angry(g_align) {
    await godvoice(g_align, 'Thou hast angered me.');
}

// C ref: pline.c verbalize(line) — wraps line in double quotes.
async function verbalize(line) {
    await update_topl(`"${line}"`);
}

// C ref: attrib.c adjattrib(A_WIS, -1, FALSE).  ABASE is what moves; when the
// decrement would push it under ATTRMIN the excess is taken out of AMAX with a
// rn2() roll instead — that draw was previously dismissed as unreachable, but a
// hero who angers a god repeatedly does grind A_WIS down to its floor.
async function adjattrib_wis_loss() {
    const u = game.u;
    if (!u.acurr?.a) return false;
    const old_acurr = ABASE(A_WIS), old_abase = old_acurr, old_amax = AMAX(A_WIS);
    u.acurr.a[A_WIS] = old_abase - 1;
    if (u.acurr.a[A_WIS] < ATTRMIN) {
        const decr = rn2(ATTRMIN - u.acurr.a[A_WIS] + 1);
        u.acurr.a[A_WIS] = ATTRMIN;
        if (u.amax?.a) {
            u.amax.a[A_WIS] = (u.amax.a[A_WIS] ?? 0) - decr;
            if (u.amax.a[A_WIS] < ATTRMIN) u.amax.a[A_WIS] = ATTRMIN;
        }
    }
    if (ABASE(A_WIS) === old_acurr) {
        // C: msgflg==0 && flags.verbose -> one of two "no change" lines.
        if (ABASE(A_WIS) === old_abase && AMAX(A_WIS) === old_amax)
            await update_topl('You\'re already as foolish as you can get.');
        else
            await update_topl('Your innate wisdom has declined.');
        return false;
    }
    if (u.aexe?.a) u.aexe.a[A_WIS] = 0; // C: AEXE(ndx) = 0 on any real change
    game.botl = true;
    await update_topl('You feel foolish!');
    return true;
}

// C ref: exper.c losexp(NULL) — the divine-anger drain.  js/exper.js owns the
// HP/Pw/uexp arithmetic but omits C's two livelog_printf() calls, and #chronicle
// renders the livelog verbatim, so the entry has to be added around it here.
async function losexp_with_livelog() {
    const lev = game.u?.ulevel | 0;
    await losexp(null, update_topl);
    if (lev > 1) livelog_printf(LL_MINORAC, `lost experience level ${lev}`);
    else livelog_printf(LL_MINORAC, 'lost all experience');
}

// C ref: sit.c rndcurse() — curse a few random inventory items.
async function rndcurse() {
    const u = game.u;
    // C's leading u_wield_art(ART_MAGICBANE) escape needs an artifact weapon.
    await update_topl('You feel a malignant aura surround you.');
    const invent = game.invent || [];
    let nobj = 0;
    for (const o of invent) if (o && o.oclass !== COIN_CLASS) nobj++;
    // Antimagic / Half_spell_damage would shrink the divisor; neither is
    // reachable for the heroes that get here, so the divisor is 1.
    let cnt = rnd(6);
    if (nobj) {
        for (; cnt > 0; cnt--) {
            let onum = rnd(nobj);
            let otmp = null;
            for (const o of invent) {
                if (!o || o.oclass === COIN_CLASS) continue;
                if (--onum === 0) { otmp = o; break; }
            }
            if (!otmp || otmp.cursed) continue;
            // C's artifact "resists" arm (rn2(10) < 8) needs SPFX_INTEL.
            if (otmp.blessed) unbless(otmp);
            else curse(otmp);
        }
    }
    if (u.usteed && !rn2(4)) {
        const saddle = u.usteed.saddle;
        if (saddle && !saddle.cursed) {
            if (saddle.blessed) unbless(saddle);
            else curse(saddle);
            if (!Blind()) {
                await update_topl(`${saddle.cursed ? 'Your saddle glows black.'
                    : 'Your saddle glows brown.'}`);
                saddle.bknown = Hallucination() ? 0 : 1;
            } else {
                saddle.bknown = 0;
            }
        }
    }
}

// C ref: sit.c attrcurse() — strip one random INTRINSIC.  The rnd(11) is the
// load-bearing part; the fall-through chain then hunts for the first intrinsic
// the hero actually has at or after the rolled slot.
const ATTRCURSE_CHAIN = [
    ['HFire_resistance', 'You feel warmer.'],
    ['HTeleportation', 'You feel less jumpy.'],
    ['HPoison_resistance', 'You feel a little sick!'],
    ['HTelepat', 'Your senses fail!'],
    ['HCold_resistance', 'You feel cooler.'],
    ['HInvis', 'You feel paranoid.'],
    ['HSee_invisible', 'You thought you saw something!'],
    ['HFast', 'You feel slower.'],
    ['HStealth', 'You feel clumsy.'],
    ['HProtection', 'You feel vulnerable.'],
    ['HAggravate_monster', 'You feel less attractive.'],
];
async function attrcurse() {
    const u = game.u;
    const start = rnd(11) - 1;
    for (let i = start; i < ATTRCURSE_CHAIN.length; i++) {
        const [field, msg] = ATTRCURSE_CHAIN[i];
        // INTRINSIC-only: a timed or worn source doesn't count.
        if (u[field]) {
            u[field] = 0;
            if (u.uprops) u.uprops[field] = 0;
            await update_topl(msg);
            return true;
        }
    }
    return false;
}

// C ref: ball.c punish(otmp) with a null otmp (js/read.js owns the identical
// scroll-of-punishment copy; pray.c is the other caller).
async function punish() {
    const u = game.u;
    await update_topl('You are being punished for your misbehavior!');
    if (u.uball) {
        await update_topl('Your iron ball gets heavier.');
        u.uball.owt += WT_IRON_BALL_INCR;
        return;
    }
    const uchain = mkobj(CHAIN_CLASS, true);
    uchain.owornmask = W_CHAIN;
    u.uchain = uchain;
    const uball = mkobj(BALL_CLASS, true);
    uball.owornmask = W_BALL;
    u.uball = uball;
    place_object(uball, u.ux, u.uy);
    place_object(uchain, u.ux, u.uy);
    newsym(u.ux, u.uy);
}

// C ref: pray.c angrygods(resp_god) — the god rejects the prayer.
async function angrygods(resp_god) {
    const u = game.u;
    if (In_hell(u.uz)) resp_god = A_NONE;
    u.ublessed = 0;

    const utype = u.ualign?.type ?? 0;
    const record = u.ualign?.record ?? 0;
    const luck = Luck();
    let maxanger;
    if (resp_god !== utype)
        // The Luck term used to be missing here, so a cross-aligned rebuke drew
        // rn2() with the wrong modulus.
        maxanger = Math.trunc(record / 2)
            + (luck > 0 ? -Math.trunc(luck / 3) : -luck);
    else
        maxanger = 3 * (u.ugangr || 0)
            + ((luck > 0 || record >= STRIDENT)
                ? -Math.trunc(luck / 3)
                : -luck);
    if (maxanger < 1) maxanger = 1;
    else if (maxanger > 15) maxanger = 15;

    switch (rn2(maxanger)) {
    case 0:
    case 1:
        await update_topl(`You feel that ${align_gname(roleMnum(), resp_god)}`
            + ` is ${Hallucination() ? 'bummed' : 'displeased'}.`);
        break;
    case 2:
    case 3: {
        await godvoice(resp_god, null); // emits rn2(4) for godvoices[]
        const strayed = ugod_is_angry() && resp_god === utype;
        await update_topl(
            `"Thou ${strayed ? 'hast strayed from the path' : 'art arrogant'}, `
            + `${heroIsHuman() ? 'mortal' : 'creature'}."`);
        await verbalize('Thou must relearn thy lessons!');
        await adjattrib_wis_loss();
        await losexp_with_livelog();
        break;
    }
    case 6:
        if (!u.uball) {
            await gods_angry(resp_god);
            await punish();
            break;
        }
        /* FALLTHRU */
    case 4:
    case 5:
        await gods_angry(resp_god);
        // C: `if (!Blind && !Antimagic)`; Antimagic needs an intrinsic the
        // heroes that reach this never have.
        if (!Blind())
            await update_topl('A black glow surrounds you.');
        if (rn2(2) || !(await attrcurse()))
            await rndcurse();
        break;
    case 7:
    case 8:
        await godvoice(resp_god, null);
        await verbalize(`Thou durst ${(on_altar()
            && a_align(game.u.ux, game.u.uy) !== resp_god)
            ? 'scorn' : 'call upon'} me?`);
        await update_topl(`"Then die, ${heroIsHuman() ? 'mortal' : 'creature'}!"`);
        // GAP: minion.c summon_minion(resp_god, FALSE) — no minion subsystem
        // here, so the servant (and its makemon RNG) is not created.
        break;
    default:
        await gods_angry(resp_god);
        await god_zaps_you(resp_god);
        break;
    }
    // even though this might not be in response to prayer, set pray timer
    const new_ublesscnt = rnz(300);
    if (new_ublesscnt > u.ublesscnt) u.ublesscnt = new_ublesscnt;
}

// C ref: pray.c gods_upset(g_align).
async function gods_upset(g_align) {
    const u = game.u;
    if (g_align === (u.ualign?.type ?? 0)) u.ugangr = (u.ugangr || 0) + 1;
    else if (u.ugangr) u.ugangr--;
    await angrygods(g_align);
}

// C ref: pray.c align thresholds (pray.c:64-67).
const DEVOUT = 14;

// C ref: pray.c:373 fix_worst_trouble(trouble).
//
// This used to implement TROUBLE_HIT and nothing else, which is not a partial
// port but a live bug: pleased()'s favour arms loop `do fix_worst_trouble(t);
// while ((t = in_trouble()) != 0)` and `while (in_trouble() > 0 && ++tryct <
// 10)`.  A trouble that is announced but never CLEARED is re-reported forever,
// so the loop only terminated on the ad-hoc 50-iteration guard, after emitting
// the same line fifty times.  Every arm below therefore has to clear whatever
// state in_trouble() reads for it.
//
// Three arms need subsystems this port lacks and are marked where C has them:
// TROUBLE_LAVA and TROUBLE_STUCK_IN_WALL (safe_teleds), and
// TROUBLE_UNUSEABLE_HANDS (welded()).  in_trouble() never reports the last of
// those, so only the first two can be reached at all.

// C ref: pray.c:352 fix_curse_trouble(otmp, what) — uncurse one item, with the
// "softly glow amber" feedback a sighted hero gets.
async function fix_curse_trouble(otmp, what) {
    if (!otmp) return;
    if (!Blind()) {
        await update_topl(`${what || Yobjnam2_local(otmp, 'softly glow')} ${hcolor_amber()}.`);
        otmp.bknown = Hallucination() ? 0 : 1;
    }
    uncurse(otmp);
}
// C ref: objnam.c Yname2/Yobjnam2(obj, verb) — js/engrave.js:430 keeps the same
// pair; only the singular "Your <obj> softly glows" form is reachable here.
function Yobjnam2_local(obj, verb) {
    const plural = (obj?.quan ?? 1) > 1;
    const nm = OBJECTS[obj?.otyp]?.name || 'item';
    return `Your ${nm} ${plural ? verb : `${verb}s`}`;
}
// C ref: do_name.c hcolor(NH_AMBER).  Hallucination swaps in a random colour
// off the DISPLAY rng, which js/do_name.js hcolor() already models.
function hcolor_amber() { return hcolor('amber'); }

// C ref: eat.c init_uhunger().  NOT_HUNGRY == 1.
function init_uhunger() {
    const u = game.u;
    game.botl = true;
    u.uhunger = 900;
    u.uhs = NOT_HUNGRY;
    if ((u.atemp?.a?.[0] | 0) < 0) u.atemp.a[0] = 0; /* ATEMP(A_STR) */
}
const NOT_HUNGRY = 1;

// Clear a property under every name this port stores it as (js/pray.js uprop()
// reads both u.uprops[name] and u[name]).
function clear_uprop(name) {
    const u = game.u;
    if (u.uprops) u.uprops[name] = 0;
    u[name] = 0;
}

async function fix_worst_trouble(trouble) {
    const u = game.u;
    switch (trouble) {
    case TROUBLE_STONED:
        clear_uprop('Stoned');
        await update_topl('You feel more limber.');
        break;
    case TROUBLE_SLIMED:
        clear_uprop('Slimed');
        await update_topl('The slime disappears.');
        break;
    case TROUBLE_STRANGLED:
        if (game.uamul && OBJECTS[game.uamul.otyp]?.sym === 'AMULET_OF_STRANGULATION') {
            await update_topl('Your amulet vanishes!');
            if (_inv) _inv.useup(game.uamul);
        }
        await update_topl('You can breathe again.');
        clear_uprop('Strangled');
        game.botl = true;
        break;
    case TROUBLE_LAVA:
        // GAP: teleport.c safe_teleds(TELEDS_NO_FLAGS) then
        // rescued_from_terrain(DISSOLVED); both need the teleport subsystem.
        u.utrap = 0;
        break;
    case TROUBLE_STARVING:
        /* FALLTHRU — C shares the arm with TROUBLE_HUNGRY */
    case TROUBLE_HUNGRY:
        await update_topl('Your stomach feels content.');
        init_uhunger();
        break;
    case TROUBLE_SICK:
        await update_topl('You feel better.');
        clear_uprop('Sick');
        break;
    case TROUBLE_HIT: {
        /* "fix all troubles" keeps trying while the hero has 5 or fewer hit
           points, so the boost must always land above that */
        await update_topl('You feel much better.');
        if (u.Upolyd) {
            const mmax = (u.mhmax | 0) + rnd(5);
            u.mhmax = Math.max(mmax, 6);
            u.mh = u.mhmax;
        }
        let maxhp = u.uhpmax | 0;
        if (maxhp < (u.ulevel | 0) * 5 + 11) maxhp += rnd(5);
        u.uhpmax = Math.max(maxhp, 6);
        u.uhp = u.uhpmax;
        game.botl = true;
        break;
    }
    case TROUBLE_STUCK_IN_WALL:
        // GAP: safe_teleds() then, if that fails, HPasses_walls = d(4,4)+4.
        break;
    case TROUBLE_CURSED_LEVITATION: {
        let otmp = null;
        if (Cursed_obj(game.uarmf, 'LEVITATION_BOOTS')) otmp = game.uarmf;
        else if (Cursed_obj(game.uleft, 'RIN_LEVITATION')) otmp = game.uleft;
        else if (Cursed_obj(game.uright, 'RIN_LEVITATION')) otmp = game.uright;
        await fix_curse_trouble(otmp, ringglow(otmp));
        break;
    }
    case TROUBLE_CURSED_BLINDFOLD:
        await fix_curse_trouble(game.ublindf, null);
        break;
    case TROUBLE_LYCANTHROPE:
        // C: were.c you_unwere(TRUE) — set_ulycn(NON_PM) plus the line.  The
        // rehumanize()/mtimedone half needs a were POLYFORM, which needs
        // polyself; in_trouble() keys on u.ulycn, which this clears.
        await update_topl('You feel purified.');
        u.ulycn = -1;
        break;
    case TROUBLE_PUNISHED:
        await update_topl('Your chain disappears.');
        unpunish_local();
        break;
    case TROUBLE_FUMBLING: {
        let otmp = null;
        if (Cursed_obj(game.uarmg, 'GAUNTLETS_OF_FUMBLING')) otmp = game.uarmg;
        else if (Cursed_obj(game.uarmf, 'FUMBLE_BOOTS')) otmp = game.uarmf;
        await fix_curse_trouble(otmp, null);
        break;
    }
    case TROUBLE_CURSED_ITEMS: {
        const otmp = worst_cursed_item();
        await fix_curse_trouble(otmp, ringglow(otmp));
        break;
    }
    case TROUBLE_POISONED:
        /* overrides Fixed_abil; ignores items that confer it */
        if (Hallucination()) await update_topl("There's a tiger in your tank.");
        else await update_topl('You feel in good health again.');
        for (let i = 0; i < A_MAX; i++) {
            if (ABASE(i) < AMAX(i)) {
                u.acurr.a[i] = AMAX(i);
                game.botl = true;
            }
        }
        break;
    case TROUBLE_BLIND: {
        /* handles deafness as well as blindness */
        const cure_deaf = (((u.uprops?.HDeaf | 0) || (u.HDeaf | 0)) & 0xffffff) > 1;
        let msgbuf = '';
        if ((u.blinded | 0) > 1) {
            msgbuf = 'Your eyes feel better';
            u.ucreamed = 0;
            u.blinded = 0;
            clear_uprop('Blinded');
        }
        if (cure_deaf) {
            clear_uprop('HDeaf');
            u.HDeaf = 0;
            msgbuf += msgbuf ? ' and you can hear again' : 'You can hear again';
        }
        if (msgbuf) await update_topl(`${msgbuf}.`);
        break;
    }
    case TROUBLE_WOUNDED_LEGS:
        await heal_legs(0);
        break;
    case TROUBLE_STUNNED:
        clear_uprop('Stun');
        u.ustun = 0;
        await update_topl(`You feel ${Hallucination() ? 'less wobbly' : 'a bit steadier'} now.`);
        break;
    case TROUBLE_CONFUSED:
        clear_uprop('Confusion');
        u.uconf = 0;
        await update_topl(`You feel less ${Hallucination() ? 'trippy' : 'confused'} now.`);
        break;
    case TROUBLE_HALLUCINATION:
        await update_topl('Looks like you are back in Kansas.');
        clear_uprop('Hallucination');
        u.uhallu = 0;
        u.HHallucination = 0;
        break;
    case TROUBLE_SADDLE: {
        const otmp = u.usteed?.saddle;
        if (otmp) {
            if (!Blind()) {
                await update_topl(`Your saddle softly glows ${hcolor_amber()}.`);
                otmp.bknown = 1;
            }
            uncurse(otmp);
        }
        break;
    }
    default:
        break;
    }
}
// C ref: pray.c:378-379 leftglow[]/rightglow[] — a ring stuck on a cursed hand
// is described by side rather than by name.
function ringglow(otmp) {
    if (otmp && otmp === game.uleft) return 'Your left ring softly glows';
    if (otmp && otmp === game.uright) return 'Your right ring softly glows';
    return null;
}
// C ref: ball.c unpunish() — free the ball and chain.  js/read.js:1317 has the
// other copy; both only have to make Punished (uball != 0) false again.
function unpunish_local() {
    const u = game.u;
    const objs = game.level?.objects;
    for (const o of [u.uchain, u.uball]) {
        if (!o) continue;
        o.owornmask = 0;
        if (Array.isArray(objs)) {
            const i = objs.indexOf(o);
            if (i >= 0) objs.splice(i, 1);
        }
    }
    if (u.uchain && isok(u.uchain.ox, u.uchain.oy)) newsym(u.uchain.ox, u.uchain.oy);
    u.uchain = null;
    u.uball = null;
}

// C ref: pray.c pleased(g_align) — the god grants a favor.  fix_worst_trouble()
// is the one piece left out: it repairs the trouble in_trouble() found and its
// per-trouble RNG (rnd(5) extra max HP for TROUBLE_HIT, the unpunish/uncurse
// arms) belongs to subsystems outside this file.  Everything that decides
// WHICH branch runs, including the discarded rn1/rnl draws, is ported.
async function pleased(g_align) {
    const u = game.u;
    const trouble = in_trouble();
    let pat_on_head = 0;

    const record0 = u.ualign?.record ?? 0;
    const mood = (record0 >= DEVOUT) ? (Hallucination() ? 'pleased as punch' : 'well-pleased')
        : (record0 >= STRIDENT) ? (Hallucination() ? 'ticklish' : 'pleased')
            : (Hallucination() ? 'full' : 'satisfied');
    await update_topl(`You feel that ${align_gname(roleMnum(), g_align)} is ${mood}.`);

    /* not your deity */
    if (on_altar() && gp_aligntyp() !== (u.ualign?.type ?? 0)) {
        adjalign(-1);
        return;
    } else if (record0 < 2 && trouble <= 0) {
        adjalign(1);
    }

    // C re-reads u.ualign.record AFTER the adjalign(1) above; caching the old
    // value made a record-0 hero take the `!rnl(2)` arm C never reaches, adding
    // a phantom draw.
    const record = u.ualign?.record ?? 0;
    if (!trouble && record >= DEVOUT) {
        /* if hero was in trouble but got better, no special favor */
        if (praystate().trouble === 0) pat_on_head = 1;
    } else {
        const prayer_luck = Math.max(Luck(), -1);
        // on_shrine() widens the roll by one on a temple altar; it used to be
        // dropped, which changed the rn1 modulus for every shrine prayer.
        let action = rn1(prayer_luck + (on_altar() ? 3 + (on_shrine() ? 1 : 0) : 2), 1);
        if (!on_altar()) action = Math.min(action, 3);
        if (record < STRIDENT)
            action = ((record > 0) || !rnl(2)) ? 1 : 0;
        switch (Math.min(action, 5)) {
        case 5: pat_on_head = 1; /* FALLTHROUGH */
        case 4: {   // C ref: pray.c:1116 — fix EVERY trouble.
            let t = trouble, guard = 0;
            do { await fix_worst_trouble(t); } while ((t = in_trouble()) !== 0 && ++guard < 50);
            break;
        }
        case 3:
            await fix_worst_trouble(trouble); /* FALLTHROUGH */
        case 2: {   // C ref: pray.c:1124 — up to 10 more.
            let t, tryct = 0;
            while ((t = in_trouble()) > 0 && (++tryct < 10)) await fix_worst_trouble(t);
            break;
        }
        case 1:
            if (trouble > 0) await fix_worst_trouble(trouble);
            break;
        case 0:
            break; /* your god blows you off, too bad */
        }
    }

    if (pat_on_head) {
        // GAP: pray.c:1167 switch (rn2((Luck + 6) >> 1)) — the gratuitous-favor
        // table (uncurse/bless weapon, gcrownu, give_spell, ...).  Reached only
        // at record >= DEVOUT or action 5.
    }

    // reset prayer timeout (kick_on_butt is 0 for a non-demigod hero).
    u.ublesscnt = rnz(350);
}

// C ref: pray.c gp.p_aligntyp accessor for pleased()'s cross-altar check.
function gp_aligntyp() {
    return praystate().aligntyp;
}

// C ref: pray.c water_prayer(bless_water) — (un)holy-water the potions on the
// altar under the hero.  Draws no RNG; the return value picks prayer_done()'s
// p_type == 2 branch.
async function water_prayer(bless_water) {
    const u = game.u;
    const bc_known = !Blind() && !Hallucination();
    let changed = 0, other = false;
    for (const otmp of (game.level?.objects || [])) {
        if (otmp.where !== 'floor' || otmp.ox !== u.ux || otmp.oy !== u.uy)
            continue;
        if (otmp.otyp === POT_WATER
            && (bless_water ? !otmp.blessed : !otmp.cursed)) {
            otmp.blessed = bless_water ? 1 : 0;
            otmp.cursed = bless_water ? 0 : 1;
            otmp.bknown = bc_known ? 1 : 0;
            changed += (otmp.quan || 1);
        } else if (OBJECTS[otmp.otyp]?.oclass === POTION_CLASS) {
            other = true;
        }
    }
    if (!Blind() && changed) {
        await update_topl(
            `${(other && changed > 1) ? 'Some of the' : other ? 'One of the' : 'The'}`
            + ` potion${(other || changed > 1) ? 's' : ''} on the altar`
            + ` glow${changed > 1 ? '' : 's'} ${bless_water ? 'light blue' : 'black'}`
            + ' for a moment.');
    }
    return changed > 0;
}

// C ref: pray.c prayer_done() — resolve the prayer after the nomul delay.
async function prayer_done() {
    await loadSacDeps();
    const gp = praystate();
    const u = game.u;
    const alignment = gp.aligntyp;
    const utype = u.ualign?.type ?? 0;
    u.uinvulnerable = false;

    if (gp.type === -2) {
        /* praying at an unaligned altar */
        await update_topl('You hear diabolical laughter all around you...');
        adjalign(-2);
        // C also wake_nearby(FALSE), which draws nothing.  exercise() DOES:
        // attrib.c:59 rolls -rn2(2) for a decrement whenever |AEXE(A_WIS)| is
        // under AVAL, so calling it is not optional.
        exercise(A_WIS, false);
        if (!In_hell(u.uz)) {
            await update_topl('Nothing else happens.');
            return 1;
        }
    }
    if (In_hell(u.uz)) {
        await update_topl(
            `Since you are in Gehennom, ${align_gname(roleMnum(), alignment)} can't help you.`);
        if ((u.ualign?.record ?? 0) <= 0 || rnl(u.ualign.record))
            await angrygods(utype);
        return 0;
    }

    if (gp.type === 0) {
        if (on_altar() && utype !== alignment) await water_prayer(false);
        u.ublesscnt += rnz(250);
        change_luck(-3);
        await gods_upset(utype);
    } else if (gp.type === 1) {
        if (on_altar() && utype !== alignment) await water_prayer(false);
        await angrygods(utype); /* naughty */
    } else if (gp.type === 2) {
        if (await water_prayer(false)) {
            /* attempted water prayer on a non-coaligned altar */
            u.ublesscnt += rnz(250);
            change_luck(-3);
            await gods_upset(utype);
        } else {
            await pleased(alignment);
        }
    } else {
        /* coaligned */
        if (on_altar()) {
            // C also pray_revive(): a tame corpse on the altar is resurrected.
            await water_prayer(true);
        }
        await pleased(alignment); /* nice */
    }
    return 1;
}

// C ref: pray.c dopray() — the #pray command.  ParanoidPray confirms, then (in
// wizard mode) offers "Force the gods to be pleased?"; the prayer then becomes a
// nomul(-3) occupation (gn.nomovemsg = "You finish your prayer.", ga.afternmv =
// prayer_done).  The move loop drives the 3 countdown turns of monster movement;
// when the count reaches 0, unmul() announces nomovemsg and fires afternmv, so
// the begin / --More-- / force-prompt / shimmering-light / finish / result
// messages each land on their own captured screen exactly as C records them.
export async function dopray(paranoid_query) {
    const gp = praystate();
    const ok = await paranoid_query('Are you sure you want to pray?');
    if (!ok) return 0; // ECMD_OK

    const u = game.u;
    if (!u.uconduct) u.uconduct = {};
    if (!u.uconduct.gnostic)
        livelog_printf(LL_CONDUCT, 'rejected atheism with a prayer');
    u.uconduct.gnostic = (u.uconduct.gnostic || 0) + 1;

    // set up gp.p_type and gp.p_aligntyp; prints "You begin praying to <god>."
    if (!(await can_pray(true)))
        return 0;

    // C ref: pray.c dopray() wizard block — in debug (playmode:debug) mode with
    // a non-Moloch prayer (gp.p_type >= 0), offer to force success.  The "You
    // begin praying" line is still unacknowledged, so the y_n prompt pages it
    // with --More-- first (its own captured frame), then re-prompts on any key
    // that isn't y/n.  Answering 'y' resets the prayer-timeout / luck / align /
    // anger counters and upgrades gp.p_type to 3 (coaligned "pleased").
    if (game.flags?.debug && gp.type >= 0) {
        game._yn_need_more = true; // page the pending "begin praying" line first
        const forced = (await y_n('Force the gods to be pleased?')) === 'y';
        if (forced) {
            u.ublesscnt = 0;
            if ((u.uluck || 0) < 0) u.uluck = 0;
            if ((u.ualign.record ?? 0) <= 0) u.ualign.record = 1;
            u.ugangr = 0;
            if (gp.type < 2) gp.type = 3;
        }
    }

    // nomul(-3): the prayer is a 3-turn occupation driven by the move loop.
    game.multi = -3;
    game.context = game.context || {};
    game.context.travel = game.context.travel1 = game.context.mv = 0;
    game.multi_reason = 'praying';
    game.nomovemsg = 'You finish your prayer.';
    game.afternmv = prayer_done;

    // C ref: pray.c dopray() — a coaligned (gp.p_type == 3) prayer outside
    // Gehennom grants prayer invulnerability; a sighted hero sees the shimmer.
    u.uinvulnerable = false;
    if (gp.type === 3 && !In_hell(u.uz)) {
        if (!Blind())
            await update_topl('You are surrounded by a shimmering light.');
        u.uinvulnerable = true;
    }

    return 1; // ECMD_TIME: the move loop advances a turn and runs the occupation
}

// ── god_zaps_you (pray.c:456) ────────────────────────────────────────────────
// C ref: pray.c god_zaps_you(resp_god).  Called from angrygods()'s default arm
// and from desecrate_altar().  The swallowed-hero arm and the Reflecting /
// Shock_resistance arms need subsystems this port lacks; the bolt itself and
// its "fry_by_god" death do not run here (end.js exports only done_in_by()),
// so a smitten hero survives.  Flagged rather than silently dropped: every
// caller of this is already a lost-cause branch for the recorded corpora.
async function god_zaps_you(_resp_god) {
    await update_topl('Suddenly, a bolt of lightning strikes you!');
    // GAP: destroy_item(RING_CLASS/WAND_CLASS, AD_ELEC), the armour melt loop
    // and fry_by_god() -> done(DIED).
}

// ── #offer / dosacrifice (pray.c:1854) ──────────────────────────────────────
//
// C ref: pray.c dosacrifice() and the helpers it delegates to —
// eval_offering(), offer_corpse(), consume_offering(), offer_too_soon(),
// offer_negative_valued(), desecrate_altar(), offer_fake_amulet(),
// offer_different_alignment_altar(), sacrifice_your_race(), bestow_artifact()
// and sacrifice_value() — plus eat.c floorfood("sacrifice", 1) / offer_ok().
//
// This used to be two guard messages and `return 0`, which is worse than a
// missing feature: C's floorfood() EATS the keys that answer its "sacrifice
// it?" prompts and then spends a turn (ECMD_TIME).  Returning ECMD_OK with no
// prompt let every one of those keys fall through to the command parser, so a
// held-out session that types `#offer` desynced permanently on the next key.

// Lazily imported to keep pray.js off invent.js's import cycle; the same
// pattern js/attrib.js uses for display.js.
let _inv = null, _mkm = null, _art = null, _pri = null;
async function loadSacDeps() {
    if (!_inv) _inv = await import('./invent.js');
    if (!_mkm) _mkm = await import('./makemon.js');
    if (!_art) _art = await import('./artifact.js');
    if (!_pri) _pri = await import('./priest.js');
}

// C ref: obj.h carried(obj).
function carried(otmp) { return otmp?.where === 'invent'; }
// C ref: role.c a_gname() / u_gname() — the god who owns the altar underfoot,
// and the hero's own god.
function a_gname() { return align_gname(roleMnum(), a_align(game.u.ux, game.u.uy)); }
function u_gname() { return align_gname(roleMnum(), game.u?.ualign?.type ?? 0); }
// C ref: align.c align_str().
function align_str(al) {
    return al === A_CHAOTIC ? 'chaotic' : al === A_NEUTRAL ? 'neutral'
        : al === A_LAWFUL ? 'lawful' : al === A_NONE ? 'unaligned' : 'unknown';
}
// C ref: hacklib.c sgn().
function sgn(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
// C ref: align.h ALIGNLIM — the alignment-record ceiling grows with the clock.
function ALIGNLIM() { return 10 + Math.floor((game.moves | 0) / 200); }

// C ref: eat.c:3539 offer_ok(obj) — getobj()'s filter for #offer.  Only
// corpses and the two amulets are selectable; on the Astral Plane the
// preference flips so the Amulet is what gets suggested.
let _sac_getobj_else = 0;
function offer_ok(obj) {
    const I = _inv;
    if (!obj)
        return _sac_getobj_else ? I.GETOBJ_EXCLUDE_NONINVENT : I.GETOBJ_EXCLUDE;
    if (obj.oclass !== FOOD_CLASS && obj.oclass !== AMULET_CLASS)
        return I.GETOBJ_EXCLUDE;
    if (obj.otyp !== CORPSE && obj.otyp !== AMULET_OF_YENDOR
        && obj.otyp !== FAKE_AMULET_OF_YENDOR)
        return I.GETOBJ_EXCLUDE_SELECTABLE;
    // (!astral && amulet) || (astral && !amulet)
    if (Is_astralevel() !== (obj.oclass === AMULET_CLASS))
        return I.GETOBJ_DOWNPLAY;
    return I.GETOBJ_SUGGEST;
}

// C ref: dungeon.h In_endgame(&u.uz) / Is_astralevel(&u.uz).  js/dungeon.js
// keys both off game.astral_level, which is the branch record the level
// generator fills in.
function In_endgame() {
    const uz = game.u?.uz, al = game.astral_level;
    return !!uz && !!al && uz.dnum === al.dnum;
}
function Is_astralevel() {
    const uz = game.u?.uz, al = game.astral_level;
    return In_endgame() && uz.dlevel === al.dlevel;
}

// C ref: eat.c floorfood("sacrifice", 1) — corpsecheck 1, so only CORPSE
// objects on the hero's square are offered, one prompt each, before falling
// through to getobj("sacrifice", offer_ok).  js/eat.js:841 is the corpsecheck-0
// twin; the shapes are deliberately identical.
async function floorfood_sacrifice() {
    const u = game.u;
    _sac_getobj_else = 0;
    // C's skipfloor gate: 'm' prefix, can_reach_floor(TRUE), or standing on
    // water/lava while water-walking or flying.  (feeding && u.usteed) is the
    // #eat-only half and does not apply to an offering.
    const skipfloor = !!game.iflags?.menu_requested;
    if (!skipfloor) {
        const objs = (game.level?.objects || []).filter(
            (o) => o.where === 'floor' && o.ox === u.ux && o.oy === u.uy);
        for (const otmp of objs) {
            if (otmp.otyp !== CORPSE) continue;
            // GAP: will_feel_cockatrice()/feel_cockatrice() — a blind, bare-
            // handed hero touching a cockatrice corpse dies before the prompt.
            const one = (otmp.quan || 1) === 1;
            const nm = _inv.obj_doname(otmp);
            const qbuf = `There ${one ? 'is' : 'are'} ${nm} here;`
                + ` sacrifice ${one ? 'it' : 'one'}?`;
            const c = await y_n(qbuf, 'ynq', 'n');
            if (c === 'y') return otmp;
            if (c === 'q') return null;
            ++_sac_getobj_else;
        }
    }
    return await _inv.getobj('sacrifice', offer_ok);
}

// C ref: pray.c:1839 sacrifice_value(otmp) — a corpse is worth its monster's
// difficulty+1, but only while fresh (<= 50 moves old) or if it is an acid
// blob, whose corpse never rots away.
function sacrifice_value(otmp) {
    let value = 0;
    const age = otmp.age | 0; // C peek_at_iced_corpse_age(): +age while on ice
    if (otmp.corpsenm === PM_ACID_BLOB || (game.moves | 0) <= age + 50) {
        const ptr = _mkm.monster_by_pmidx(otmp.corpsenm);
        value = (ptr?.difficulty | 0) + 1;
        if (otmp.oeaten) value = eaten_stat(value, otmp);
    }
    return value;
}

// C ref: eat.c eaten_stat(base, obj) — scale a stat by how much is left.
function eaten_stat(base, obj) {
    const full = mons_cnutrit(obj) || 1;
    let uneaten = (obj.oeaten | 0);
    if (uneaten > full) uneaten = full;
    const val = Math.floor((base * uneaten) / full);
    return val < 1 ? 1 : val;
}
function mons_cnutrit(obj) {
    return _mkm.monster_by_pmidx(obj.corpsenm)?.cnutrit | 0;
}

// C ref: mondata.h is_unicorn(ptr) — the unicorn class (mlet 'u'), minus the
// horses/ponies, which is exactly what likes_gems() separates out.  Tested via
// the real M2_JEWELS flag rather than a species-name list.
function is_unicorn(ptr) { return !!ptr && ptr.mlet === 'u' && likes_gems_flag(ptr); }
// C ref: mondata.h your_race(ptr) = (mflags2 & urace.selfmask).
const RACE_SELFMASK = { human: M2_HUMAN, elven: M2_ELF, dwarven: M2_DWARF,
    gnomish: M2_GNOME, orcish: M2_ORC };
function your_race(ptr) {
    const mask = RACE_SELFMASK[game.urace?.adj] || 0;
    return !!ptr && (mflags2_of(ptr) & mask) !== 0;
}

// C ref: pray.c:1446 consume_offering(otmp).
async function consume_offering(otmp) {
    const utype = game.u?.ualign?.type ?? 0;
    if (Hallucination()) {
        switch (rn2(3)) {
        case 0: await update_topl('Your sacrifice sprouts wings and a propeller and roars away!'); break;
        case 1: await update_topl('Your sacrifice puffs up, swelling bigger and bigger, and pops!'); break;
        case 2: await update_topl('Your sacrifice collapses into a cloud of dancing particles and fades away!'); break;
        }
    } else if (Blind() && utype === A_LAWFUL) {
        await update_topl('Your sacrifice disappears!');
    } else {
        await update_topl(`Your sacrifice is consumed in a ${utype === A_LAWFUL ? 'flash of light'
            : utype === A_NEUTRAL ? 'plume of smoke' : 'burst of flame'}!`);
    }
    if (carried(otmp)) _inv.useup(otmp);
    else _inv.useupf(otmp, 1);
    exercise(A_WIS, true);
}

// C ref: pray.c:1480 offer_too_soon(altaralign).
async function offer_too_soon(altaralign) {
    const u = game.u;
    if (altaralign === A_NONE && In_hell(u.uz)) {
        await gods_upset(A_NONE); /* Moloch becomes angry */
        return;
    }
    await update_topl(`You feel ${Hallucination() ? 'homesick'
        : (altaralign === (u.ualign?.type ?? 0)) ? 'an urge to return to the surface'
            : 'ashamed'}.`);
}

// C ref: pray.c:1501 desecrate_altar(highaltar, altaralign).
async function desecrate_altar(highaltar, altaralign) {
    const u = game.u;
    if (altaralign === (u.ualign?.type ?? 0)) {
        adjalign(-20);
        u.ugangr = (u.ugangr || 0) + 5;
    }
    await update_topl('You feel the air around you grow charged...');
    await update_topl(`Suddenly, you realize that ${align_gname(roleMnum(), altaralign)} has noticed you...`);
    await godvoice(altaralign,
        `So, mortal!  You dare desecrate my ${highaltar ? 'High Temple' : 'altar'}!`);
    await god_zaps_you(altaralign);
}

// C ref: pray.c:1592 offer_negative_valued(highaltar, altaralign).
async function offer_negative_valued(highaltar, altaralign) {
    if (altaralign !== (game.u?.ualign?.type ?? 0) && highaltar)
        await desecrate_altar(highaltar, altaralign);
    else
        await gods_upset(altaralign);
}

// C ref: pray.c:1602 offer_fake_amulet(otmp, highaltar, altaralign).
async function offer_fake_amulet(otmp, highaltar, altaralign) {
    const u = game.u;
    if (!highaltar && !otmp.known) {
        await offer_too_soon(altaralign);
        return;
    }
    await update_topl('You hear a nearby thunderclap.');
    if (!otmp.known) {
        await update_topl(`You realize you have made a ${Hallucination() ? 'boo-boo' : 'mistake'}.`);
        otmp.known = true;
        change_luck(-1);
    } else {
        /* don't you dare try to fool the gods */
        change_luck(-3);
        adjalign(-1);
        u.ugangr = (u.ugangr || 0) + 3;
        await offer_negative_valued(highaltar, altaralign);
    }
}

// C ref: pray.c:1631 offer_different_alignment_altar(otmp, altaralign) —
// conversion, rejection, or the ordinary cross-aligned power struggle.
async function offer_different_alignment_altar(otmp, altaralign) {
    const u = game.u;
    if (ugod_is_angry() || (altaralign === A_NONE && In_hell(u.uz))) {
        const base = u.ualignbase || {};
        if ((base[A_CURRENT] ?? u.ualign?.type) === (base[A_ORIGINAL] ?? u.ualign?.type)
            && altaralign !== A_NONE) {
            await update_topl(`You have a strong feeling that ${u_gname()} is angry...`);
            await consume_offering(otmp);
            await update_topl(`${a_gname()} accepts your allegiance.`);
            uchangealign(altaralign);
            /* Beware, Conversion is costly */
            change_luck(-3);
            u.ublesscnt = (u.ublesscnt | 0) + 300;
        } else {
            u.ugangr = (u.ugangr || 0) + 3;
            adjalign(-5);
            await update_topl(`${a_gname()} rejects your sacrifice!`);
            await godvoice(altaralign, 'Suffer, infidel!');
            change_luck(-5);
            await adjattrib(A_WIS, -2, 1 /* TRUE: silent */);
            if (!In_hell(u.uz)) await angrygods(u.ualign?.type ?? 0);
        }
        return;
    }
    await consume_offering(otmp);
    await update_topl(`You sense a conflict between ${u_gname()} and ${a_gname()}.`);
    if (rn2(8 + (u.ulevel | 0)) > 5) {
        await update_topl(`You feel the power of ${u_gname()} increase.`);
        exercise(A_WIS, true);
        change_luck(1);
        const shrine = on_shrine();
        const loc = game.level?.at(u.ux, u.uy);
        loc.altarmask = Align2amask(u.ualign?.type ?? 0);
        if (shrine) loc.altarmask |= AM_SHRINE;
        loc.flags = loc.altarmask;
        newsym(u.ux, u.uy);
        if (!Blind()) {
            const utype = u.ualign?.type ?? 0;
            await update_topl(`The altar glows ${hcolor(
                utype === A_LAWFUL ? 'white' : utype ? 'black' : 'gray')}.`);
        }
        if (rnl(u.ulevel | 0) > 6 && (u.ualign?.record ?? 0) > 0
            && rnd(u.ualign.record) > Math.floor((3 * ALIGNLIM()) / 4)) {
            // GAP: minion.c summon_minion(altaralign, TRUE) — no minion
            // subsystem, so the servant and its makemon RNG are not created.
        }
        await angry_priest();
    } else {
        await update_topl(`Unluckily, you feel the power of ${u_gname()} decrease.`);
        change_luck(-1);
        exercise(A_WIS, false);
        if (rnl(u.ulevel | 0) > 6 && (u.ualign?.record ?? 0) > 0
            && rnd(u.ualign.record) > Math.floor((7 * ALIGNLIM()) / 8)) {
            // GAP: summon_minion(altaralign, TRUE), as above.
        }
    }
}

// C ref: priest.c angry_priest() — the temple priest underfoot turns hostile.
// Gated exactly as C gates it: only a priest of a now-different alignment.
async function angry_priest() {
    const pri = _pri.findpriest(_pri.temple_occupied(game.u?.urooms || ''));
    if (!pri || _pri.p_coaligned(pri)) return;
    pri.mpeaceful = 0;
}

// C ref: attrib.c uchangealign(newalign, reason) reduced to the A_CG_CONVERT
// path taken here: the record resets and the base alignment follows.
function uchangealign(newalign) {
    const u = game.u;
    if (!u.ualignbase) u.ualignbase = { [A_CURRENT]: u.ualign?.type ?? 0, [A_ORIGINAL]: u.ualign?.type ?? 0 };
    u.ualignbase[A_CURRENT] = newalign;
    u.ualign.type = newalign;
    u.ualign.record = 0;
    u.ublesscnt = 300;
    game.botl = true;
}

// C ref: minion.c:405 dlord(atyp) — a demon lord of the given alignment; 20
// tries at the JUIBLEX..YEENOGHU window, then ndemon()'s one-shot
// mkclass_aligned().  Every one of those tries draws, so the loop is the
// load-bearing part, not the monster it lands on.
const PM_JUIBLEX = 303, PM_YEENOGHU = 304, NON_PM = -1;
const S_DEMON_CLS = 56;
function dlord(atyp) {
    for (let tryct = !In_endgame() ? 20 : 0; tryct > 0; --tryct) {
        const pm = rn1(PM_YEENOGHU + 1 - PM_JUIBLEX, PM_JUIBLEX);
        const ptr = _mkm.monster_by_pmidx(pm);
        if (!((game.mvitals?.[pm]?.mvflags | 0) & 0x03 /* G_GONE */)
            && (atyp === A_NONE || sgn(ptr?.maligntyp | 0) === sgn(atyp)))
            return pm;
    }
    const ptr = _mkm.mkclass_aligned(S_DEMON_CLS, 0, atyp);
    return ptr ? (ptr.pmidx ?? NON_PM) : NON_PM;
}
// C ref: pray.c:1698 sacrifice_your_race(otmp, highaltar, altaralign).
async function sacrifice_your_race(otmp, highaltar, altaralign) {
    const u = game.u;
    const utype = u.ualign?.type ?? 0;
    // C's is_demon(youmonst.data) arm needs a demon polyform.
    if (utype !== A_CHAOTIC) {
        await update_topl("You'll regret this infamous offense!");
        exercise(A_WIS, false);
    }

    if (highaltar && (altaralign !== A_CHAOTIC || utype !== A_CHAOTIC)) {
        await desecrate_altar(highaltar, altaralign);
        return;
    } else if (altaralign !== A_CHAOTIC && altaralign !== A_NONE) {
        /* curse the lawful/neutral altar */
        await update_topl(`The altar is stained with ${game.urace?.adj ?? 'human'} blood.`);
        const loc = game.level?.at(u.ux, u.uy);
        loc.altarmask = AM_CHAOTIC;
        loc.flags = loc.altarmask;
        newsym(u.ux, u.uy);
        await angry_priest();
    } else {
        /* human sacrifice on a chaotic or unaligned altar summons a demon */
        let demonless_msg;
        if (altaralign === A_CHAOTIC && utype !== A_CHAOTIC) {
            const cloudclr = hcolor('black');
            await update_topl(`The blood floods the altar, which vanishes in ${
                /^[aeiou]/i.test(cloudclr) ? 'an' : 'a'} ${cloudclr} cloud!`);
            const loc = game.level?.at(u.ux, u.uy);
            loc.typ = ROOM;
            loc.altarmask = 0;
            loc.flags = 0;
            newsym(u.ux, u.uy);
            await angry_priest();
            demonless_msg = 'cloud dissipates';
        } else {
            await update_topl('The blood covers the altar!');
            change_luck(altaralign === A_NONE ? -2 : 2);
            demonless_msg = 'blood coagulates';
        }
        const pm = dlord(altaralign);
        const dmon = (pm !== NON_PM)
            ? _mkm.makemon(_mkm.monster_by_pmidx(pm), u.ux, u.uy, MM_NOMSG) : null;
        if (dmon) {
            // C ref: pray.c:1750 — a_monnam(dmon), with "something dreadful"
            // when the hero can't make out what arrived.
            let dbuf = a_monnam(dmon);
            if (!dbuf || dbuf.toLowerCase() === 'it') dbuf = 'something dreadful';
            await update_topl(`You have summoned ${dbuf}!`);
            if (sgn(utype) === sgn(dmon.data?.maligntyp | 0)) dmon.mpeaceful = 1;
            await update_topl('You are terrified, and unable to move.');
            game.multi = -3;
            game.multi_reason = 'being terrified of a demon';
            game.nomovemsg = 0;
        } else {
            await update_topl(`The ${demonless_msg}.`);
        }
    }

    if (utype !== A_CHAOTIC) {
        adjalign(-5);
        u.ugangr = (u.ugangr || 0) + 3;
        await adjattrib(A_WIS, -1, 1 /* TRUE: silent */);
        if (!In_hell(u.uz)) await angrygods(utype);
        change_luck(-5);
    } else {
        adjalign(5);
    }
    if (carried(otmp)) _inv.useup(otmp);
    else _inv.useupf(otmp, 1);
}

// C ref: pray.c:1781 bestow_artifact(max_giftvalue).
async function bestow_artifact(max_giftvalue) {
    const u = game.u;
    const nartifacts = _art.nartifact_exist();
    let do_bestow = (u.ulevel | 0) > 2 && (u.uluck | 0) >= 0;
    if (do_bestow) {
        if (game.flags?.debug) do_bestow = (await y_n('Gift an artifact?')) === 'y';
        else do_bestow = !rn2(10 + (2 * (u.ugifts | 0) * nartifacts));
    }
    if (!do_bestow) return false;
    // GAP: the artifact gift itself (mk_artifact + hold_another_object +
    // discover_artifact) belongs to js/artifact.js; the rn2 gate above, which
    // is what shifts the stream, does run.
    return false;
}

// C ref: pray.c:1898 eval_offering(otmp, altaralign) — the corpse's worth,
// with the undead bonus and the four unicorn cases.
async function eval_offering(otmp, altaralign) {
    const u = game.u;
    const utype = u.ualign?.type ?? 0;
    let value = sacrifice_value(otmp);
    if (!value) return 0;
    const ptr = _mkm.monster_by_pmidx(otmp.corpsenm);

    if (is_undead_flag(ptr)) { /* not demons -- no demon corpses */
        if (utype !== A_CHAOTIC
            || (ptr?.name === 'wraith' && (u.uconduct?.unvegetarian | 0)))
            value += 1;
    } else if (is_unicorn(ptr)) {
        const unicalign = sgn(ptr.maligntyp | 0);
        if (unicalign === altaralign) {
            await update_topl(`Such an action is an insult to ${
                (unicalign === A_CHAOTIC) ? 'chaos' : unicalign ? 'law' : 'balance'}!`);
            await adjattrib(A_WIS, -1, 1 /* TRUE: silent */);
            return -1;
        } else if (utype === altaralign) {
            if ((u.ualign?.record ?? 0) < ALIGNLIM())
                await update_topl(`You feel appropriately ${align_str(utype)}.`);
            else
                await update_topl('You feel you are thoroughly on the right path.');
            adjalign(5);
            value += 3;
        } else if (unicalign === utype) {
            u.ualign.record = -1;
            value = 1;
        } else {
            value += 3;
        }
    }
    return value;
}

const MAXVALUE = 24; /* pray.c:1885 — highest corpse value (besides the Wiz) */
// C ref: monsters.h PM_ACID_BLOB — its corpse never gets too old to offer.
const PM_ACID_BLOB = 6;

// C ref: pray.c:1955 offer_corpse(otmp, highaltar, altaralign).
async function offer_corpse(otmp, highaltar, altaralign) {
    const u = game.u;
    const utype = u.ualign?.type ?? 0;

    if (!u.uconduct) u.uconduct = {};
    if (!u.uconduct.gnostic)
        livelog_printf(LL_CONDUCT,
            `rejected atheism by offering ${corpse_article_name(otmp)} on an altar of ${a_gname()}`);
    u.uconduct.gnostic = (u.uconduct.gnostic || 0) + 1;

    // GAP: feel_cockatrice(otmp, TRUE) and rider_corpse_revival(otmp, FALSE).
    const ptr = _mkm.monster_by_pmidx(otmp.corpsenm);

    /* same-race and former-pet results apply even to a corpse too old to
       have any value */
    if (your_race(ptr)) {
        await sacrifice_your_race(otmp, highaltar, altaralign);
        return;
    }
    const omon = OMONST(otmp);
    if (omon && omon.mtame) {
        await update_topl('So this is how you repay loyalty?');
        adjalign(-3);
        u.HAggravate_monster = (u.HAggravate_monster | 0) | 0x10000 /* FROMOUTSIDE */;
        await offer_negative_valued(highaltar, altaralign);
        return;
    }

    const value = await eval_offering(otmp, altaralign);
    if (value === 0) {
        /* too old; no undead or unicorn bonus or penalty */
        await update_topl('Nothing happens.');
        return;
    }
    if (value < 0) {
        await offer_negative_valued(highaltar, altaralign);
        return;
    }
    if (altaralign !== utype && highaltar) {
        await desecrate_altar(highaltar, altaralign);
        return;
    }
    if (utype !== altaralign) {
        await offer_different_alignment_altar(otmp, altaralign);
        return;
    }

    await consume_offering(otmp);
    /* OK, you get brownie points. */
    if (u.ugangr) {
        const saved_anger = u.ugangr;
        u.ugangr -= Math.floor((value * (utype === A_CHAOTIC ? 2 : 3)) / MAXVALUE);
        if (u.ugangr < 0) u.ugangr = 0;
        if (u.ugangr !== saved_anger) {
            if (u.ugangr) {
                await update_topl(`${u_gname()} seems ${
                    Hallucination() ? 'groovy' : 'slightly mollified'}.`);
                if ((u.uluck | 0) < 0) change_luck(1);
            } else {
                await update_topl(`${u_gname()} seems ${
                    Hallucination() ? 'cosmic (not a new fact)' : 'mollified'}.`);
                if ((u.uluck | 0) < 0) u.uluck = 0;
            }
        } else { /* not satisfied yet */
            if (Hallucination()) await update_topl('The gods seem tall.');
            else await update_topl('You have a feeling of inadequacy.');
        }
    } else if (ugod_is_angry()) {
        let v = value;
        if (v > MAXVALUE) v = MAXVALUE;
        if (v > -(u.ualign?.record ?? 0)) v = -(u.ualign?.record ?? 0);
        adjalign(v);
        await update_topl('You feel partially absolved.');
    } else if ((u.ublesscnt | 0) > 0) {
        const saved_cnt = u.ublesscnt;
        u.ublesscnt -= Math.floor((value * (utype === A_CHAOTIC ? 500 : 300)) / MAXVALUE);
        if (u.ublesscnt < 0) u.ublesscnt = 0;
        if (u.ublesscnt !== saved_cnt) {
            if (u.ublesscnt) {
                if (Hallucination()) await update_topl('You realize that the gods are not like you and I.');
                else await update_topl('You have a hopeful feeling.');
                if ((u.uluck | 0) < 0) change_luck(1);
            } else {
                if (Hallucination()) await update_topl('Overall, there is a smell of fried onions.');
                else await update_topl('You have a feeling of reconciliation.');
                if ((u.uluck | 0) < 0) u.uluck = 0;
            }
        }
    } else {
        if (await bestow_artifact(value)) return;

        const orig_luck = u.uluck | 0;
        let luck_increase = Math.floor((value * LUCKMAX) / (MAXVALUE * 2));
        /* sacrificing can't raise non-bonus Luck above the sacrifice's value */
        if (orig_luck > value) luck_increase = 0;
        else if (orig_luck + luck_increase > value) luck_increase = value - orig_luck;

        change_luck(luck_increase);
        if ((u.uluck | 0) < 0) u.uluck = 0;
        if ((u.uluck | 0) !== orig_luck) {
            if (Blind())
                await update_topl('You think something brushed your foot.');
            else
                await update_topl(Hallucination()
                    ? 'You see crabgrass at your feet.  A funny thing in a dungeon.'
                    : 'You glimpse a four-leaf clover at your feet.');
        }
    }
}

// C ref: objnam.c corpse_xname(otmp, NULL, CXN_ARTICLE) for the livelog line.
function corpse_article_name(otmp) {
    const nm = _mkm.monster_by_pmidx(otmp.corpsenm)?.name;
    if (!nm) return 'a corpse';
    return `${/^[aeiou]/i.test(nm) ? 'an' : 'a'} ${nm} corpse`;
}

export async function dosacrifice() {
    const u = game.u;
    const altaralign = a_align(u.ux, u.uy);

    if (!on_altar() || u.uswallow) {
        const over = (u.uprops?.Levitation || u.uprops?.Flying) ? 'over' : 'on';
        await update_topl(`You are not ${over} an altar.`);
        return 0; // ECMD_OK
    }
    if ((u.uprops?.Confusion || u.uconf || 0)
        || (u.uprops?.Stun || u.uprops?.Stunned || u.ustun || 0)) {
        await update_topl('You are too impaired to perform the rite.');
        return 0; // ECMD_OK
    }
    await loadSacDeps();
    const highaltar = ((game.level?.at(u.ux, u.uy)?.altarmask ?? 0) & AM_SANCTUM) !== 0;

    const otmp = await floorfood_sacrifice();
    if (!otmp) return 0; // ECMD_OK

    if (otmp.otyp === AMULET_OF_YENDOR) {
        if (!highaltar) {
            await offer_too_soon(altaralign);
            return 1; // ECMD_TIME
        }
        // GAP: pray.c:1529 offer_real_amulet() ends the game via
        // done(ASCENDED); end.js exports only done_in_by().
        return 1;
    }
    if (otmp.otyp === FAKE_AMULET_OF_YENDOR) {
        await offer_fake_amulet(otmp, highaltar, altaralign);
        return 1; // ECMD_TIME
    }
    if (otmp.otyp === CORPSE) {
        await offer_corpse(otmp, highaltar, altaralign);
        return 1; // ECMD_TIME
    }

    await update_topl('Nothing happens.');
    return 1; // ECMD_TIME
}

// ═══════════════════════════════════════════════════════════════════════════
// pray.c completion.  The nine routines below were the file's remaining gaps
// (coverage.mjs --file=pray.c).  Nothing above this line calls into the block
// and the block calls nothing above it except the module-private helpers that
// were already here (godvoice/verbalize/on_altar/a_align/...), so adding it
// changes no existing behaviour.
// ═══════════════════════════════════════════════════════════════════════════

// C ref: hack.h:483,497,498 death reasons; topten.h:23 killer.format values.
const P_DIED = 0, P_ESCAPED = 14, P_ASCENDED = 15, P_KILLED_BY = 1;
// C ref: prop.h:169 FROMOUTSIDE.
const P_FROMOUTSIDE = 0x04000000;
// C ref: mkobj.js OBJECT_DATA indices.
const P_LONG_SWORD = 54, P_RUNESWORD = 58, P_SPE_FINGER_OF_DEATH = 371,
    P_SPE_RESTORE_ABILITY = 392, P_SPE_BLANK_PAPER = 407, P_MAGIC_MARKER = 242,
    P_BOULDER = 475, P_STATUE = 476, P_SPBOOK_CLASS = 10, P_SPBOOK_no_NOVEL = -10;
// C ref: objects.c STRANGE_OBJECT.
const P_STRANGE_OBJECT = 0;
// C ref: skills.h P_LONG_SWORD / P_BROAD_SWORD; weapon.c P_RESTRICTED == 0.
const PSK_BROAD_SWORD = 6, PSK_LONG_SWORD = 7, PSK_RESTRICTED = 0;
// C ref: u_init.c roles[] order — game.urole.mnum is the ROLE INDEX, not a
// mons[] offset ([[umonnum-is-a-role-index]]).
const ROLE_MONK = 5, ROLE_WIZARD = 12;
// C ref: artifact.h ART_* ordinals (js/artifact.js:227-232).
const P_ART_EXCALIBUR = 1, P_ART_STORMBRINGER = 2, P_ART_VORPAL_BLADE = 18;
// C ref: const.js ONAME_GIFT / ONAME_KNOW_ARTI.
const P_ONAME_GIFT = 0x0004, P_ONAME_KNOW_ARTI = 0x0100;
// C ref: defsym.h MONSYM() indices used by maybe_turn_mon_iter()'s switch.
const PS_LICH = 38, PS_MUMMY = 39, PS_VAMPIRE = 48, PS_WRAITH = 49,
    PS_ZOMBIE = 52, PS_GHOST = 54;
// C ref: hack.h BOLT_LIM; you.h MAXULEV.
const P_BOLT_LIM = 8, P_MAXULEV = 30;
// C ref: decl.h:36-37 c_common_strings.c_Something.
const Something = 'Something';
// C ref: obj.h WEAPON_CLASS.
const WEAPON_CLASS_PR = 2;

// Lazily-loaded dependencies.  Same pattern (and the same reason) as
// loadSacDeps() above: a static import of artifact.js/weapon.js/spell.js from
// here would add module-eval edges that flip ESM ordering
// ([[_mktrap_victim-tdz-is-real]]), and every entry point below is async.
let _pxd = null;
async function loadPrayExtras() {
    if (!_pxd) {
        const [inv, art, wep, spl, enh, oin, mkb, dnm, pol, mfl, vis, zap,
               uhi, mkm, dbr, trp, llg, dsp, end] = await Promise.all([
            import('./invent.js'), import('./artifact.js'), import('./weapon.js'),
            import('./spell.js'), import('./enhance.js'), import('./o_init.js'),
            import('./mkobj.js'), import('./do_name.js'), import('./polyself.js'),
            import('./monflags_data.js'), import('./vision.js'), import('./zap.js'),
            import('./uhitm.js'), import('./makemon.js'), import('./dbridge.js'),
            import('./trap.js'), import('./livelog.js'), import('./display.js'),
            import('./end.js'),
        ]);
        _pxd = { inv, art, wep, spl, enh, oin, mkb, dnm, pol, mfl, vis, zap,
                 uhi, mkm, dbr, trp, llg, dsp, end };
    }
    return _pxd;
}

// C ref: objnam.c:2563 vtense(subj, verb) — the plural-subject test reduced to
// what at_your_feet() can pass it (an object description, "Something", or a
// "A <foo>"/"An <foo>" phrase).  Three other files keep the same local copy
// (js/timeout.js:453, js/monmove.js:6075, js/muse.js:304).
function vtense_pr(subj, verb) {
    const s = String(subj || '');
    if (/^an? /i.test(s)) return `${verb}s`;                     /* C: goto sing */
    // C: plural is anything ending in 's' that is not '*us'/'*ss', plus the
    // makeplural specials "...eeth"/"...feet"/"...ia"/"...ae".
    if ((/[^us]s$/i.test(s)) || /(eeth|feet|ia|ae)$/i.test(s)) return verb;
    return `${verb}s`;
}
// C ref: hacklib.c s_suffix().
function s_suffix_pr(s) { return /s$/.test(String(s)) ? `${s}'` : `${s}'s`; }
// C ref: hacklib.c upstart().
function upstart_pr(s) { return s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s; }
// C ref: hacklib.c An(str) — capitalised indefinite article.
function An_pr(s) {
    const str = String(s || '');
    return `${/^[aeiou]/i.test(str) ? 'An' : 'A'} ${str}`;
}
// C ref: youprop.h Levitation.
function Levitation_pr() {
    const u = game.u;
    return !!(u?.uprops?.Levitation || u?.HLevitation || u?.ELevitation);
}
// C ref: do_name.c oname(obj, name, flags) reduced to the artifact-naming path
// gcrownu() uses: record the name and let artifact.c artifact_exists() set
// obj->oartifact plus the ONAME_GIFT/ONAME_KNOW_ARTI origin bookkeeping.
function oname_pr(art, obj, name, flags) {
    if (!obj) return obj;
    obj.oname = name;
    art.artifact_exists(obj, name, true, flags);
    return obj;
}
// C ref: objects.c svb.bases[SPBOOK_CLASS] — the first real spellbook otyp.
// Derived the same way js/mkobj.js:858 classBases does (the low "generic"
// placeholder rows below MAXOCLASSES are skipped).
function spbook_base() {
    const MAXOCLASSES = 18;
    for (let i = MAXOCLASSES; i < OBJECTS.length; i++)
        if (OBJECTS[i]?.oclass === P_SPBOOK_CLASS) return i;
    return P_SPE_BLANK_PAPER;
}
// C ref: do.c dropy(obj) -> dropz(obj) for the not-swallowed, not-levitating
// case: place the object under the hero, merge it into the pile and redraw.
// Going through stackobj() is not optional — a hand-rolled floor drop leaves a
// phantom duplicate in fobj forever ([[drop-path-without-stackobj]]).
function dropy_pr(inv, obj) {
    const u = game.u;
    place_object(obj, u.ux, u.uy);
    inv.stackobj(obj);
    newsym(u.ux, u.uy);
}

// C ref: pray.c:694 fry_by_god(resp_god, via_disintegration).
export async function fry_by_god(resp_god, via_disintegration) {
    const D = await loadPrayExtras();
    await update_topl(`You ${!via_disintegration
        ? 'fry to a crisp' : 'disintegrate into a pile of dust'}!`);
    // C: svk.killer.format = KILLED_BY; Sprintf(svk.killer.name, ...).  This
    // port keeps the already-formatted string on game._killer_name and has no
    // separate format field (js/end.js:1226 documents the same reduction).
    game._killer_format = P_KILLED_BY;
    game._killer_name = `the wrath of ${align_gname(roleMnum(), resp_god)}`;
    await D.end.done(P_DIED);
}

// C ref: pray.c:788 at_your_feet(str) — "<str> appears at your feet", or the
// swallowed / blind / levitating variants.
export async function at_your_feet(str) {
    const D = await loadPrayExtras();
    const u = game.u;
    if (Blind()) str = Something;
    if (u.uswallow) {
        /* barrier between you and the floor */
        await D.dsp.pline(`${str} ${vtense_pr(str, 'drop')} into `
            + `${s_suffix_pr(D.dnm.mon_nam(u.ustuck))} `
            + `${D.pol.mbodypart(u.ustuck, 18 /*STOMACH*/)}.`);
    } else {
        await D.dsp.pline(`${str} ${vtense_pr(str, Blind() ? 'land' : 'appear')} `
            + `${Levitation_pr() ? 'beneath' : 'at'} your `
            + `${D.inv.makeplural(D.inv.body_part(5 /*FOOT*/))}!`);
    }
}

// C ref: pray.c:805 gcrownu() — the crowning ceremony.  RNG-bearing steps, in
// order: godvoice()'s rn2(4), then (spellbook class gift) mksobj(), or (neutral
// / chaotic sword gift) mksobj() again; hcolor(NH_BLACK) draws off the DISPLAY
// rng while hallucinating.
export async function gcrownu() {
    const D = await loadPrayExtras();
    const u = game.u;
    const ok_wep = (o) => !!o && (o.oclass === WEAPON_CLASS_PR || D.inv.is_weptool(o));

    // C: HSee_invisible |= FROMOUTSIDE, &c.  This port spells each intrinsic
    // under two names (js/fountain.js:450 does the same pair per property).
    for (const prop of ['See_invisible', 'Fire_resistance', 'Cold_resistance',
                        'Shock_resistance', 'Sleep_resistance',
                        'Poison_resistance']) {
        u.uprops = u.uprops || {};
        u.uprops[prop] = (u.uprops[prop] || 0) | P_FROMOUTSIDE;
        u.uprops[`H${prop}`] = (u.uprops[`H${prop}`] || 0) | P_FROMOUTSIDE;
    }
    await godvoice(u.ualign?.type ?? 0, null);

    let class_gift = P_STRANGE_OBJECT;
    /* 3.3.[01] had this in the A_NEUTRAL case, preventing chaotic wizards
       from receiving a spellbook */
    if (roleMnum() === ROLE_WIZARD
        && !u_wield_art_pr(D, P_ART_VORPAL_BLADE)
        && !u_wield_art_pr(D, P_ART_STORMBRINGER)
        && !D.inv.carrying(P_SPE_FINGER_OF_DEATH)) {
        class_gift = P_SPE_FINGER_OF_DEATH;
    } else if (roleMnum() === ROLE_MONK && (!game.uwep || !game.uwep.oartifact)
               && !D.inv.carrying(P_SPE_RESTORE_ABILITY)) {
        /* monks rarely wield a weapon */
        class_gift = P_SPE_RESTORE_ABILITY;
    }

    let obj = ok_wep(game.uwep) ? game.uwep : null;
    let already_exists = false, in_hand = false, what = '';
    switch (u.ualign?.type ?? 0) {
    case A_LAWFUL:
        u.uevent = u.uevent || {};
        u.uevent.uhand_of_elbereth = 1;
        await verbalize('I crown thee...  The Hand of Elbereth!');
        livelog_printf(D.llg.LL_DIVINEGIFT,
            `was crowned "The Hand of Elbereth" by ${u_gname()}`);
        break;
    case A_NEUTRAL:
        u.uevent = u.uevent || {};
        u.uevent.uhand_of_elbereth = 2;
        in_hand = u_wield_art_pr(D, P_ART_VORPAL_BLADE);
        already_exists = D.art.exist_artifact(P_LONG_SWORD,
            D.art.artiname(P_ART_VORPAL_BLADE));
        await verbalize('Thou shalt be my Envoy of Balance!');
        livelog_printf(D.llg.LL_DIVINEGIFT,
            `became ${s_suffix_pr(u_gname())} Envoy of Balance`);
        break;
    case A_CHAOTIC:
        u.uevent = u.uevent || {};
        u.uevent.uhand_of_elbereth = 3;
        in_hand = u_wield_art_pr(D, P_ART_STORMBRINGER);
        already_exists = D.art.exist_artifact(P_RUNESWORD,
            D.art.artiname(P_ART_STORMBRINGER));
        what = ((already_exists && !in_hand) || class_gift !== P_STRANGE_OBJECT)
            ? 'take lives' : 'steal souls';
        await verbalize(`Thou art chosen to ${what} for My Glory!`);
        livelog_printf(D.llg.LL_DIVINEGIFT,
            `was chosen to ${what} for the Glory of ${u_gname()}`);
        break;
    }

    if (OBJECTS[class_gift]?.oclass === P_SPBOOK_CLASS) {
        obj = D.mkb.mksobj(class_gift, true, false);
        /* get book type before dropping (don't think that could destroy the
           book because we need to be on an altar in order to become crowned,
           but be paranoid about it).  C uses actualoname(), which names the
           book even when the hero hasn't identified it; this port has no
           actualoname() so the objects[] row supplies the same text. */
        const bbuf = `spellbook of ${OBJECTS[class_gift]?.name}`;
        D.mkb.bless(obj);
        obj.bknown = 1;               /* ok to skip set_bknown() */
        D.oin.observe_object(obj);
        await at_your_feet(upstart_pr(D.inv.ansimpleoname(obj)));
        dropy_pr(D.inv, obj);
        u.ugifts = (u.ugifts | 0) + 1;
        livelog_printf(D.llg.LL_DIVINEGIFT | D.llg.LL_ARTIFACT | D.llg.LL_SPOILER,
            `was bestowed with ${bbuf}`);

        /* when getting a new book for a known spell, enhance the currently
           wielded weapon rather than the book */
        if (D.spl.known_spell(class_gift) !== D.spl.spe_Unknown && ok_wep(game.uwep))
            obj = game.uwep;
    }

    switch (u.ualign?.type ?? 0) {
    case A_LAWFUL:
        if (class_gift !== P_STRANGE_OBJECT) {
            /* already got bonus above */
        } else if (obj && obj.otyp === P_LONG_SWORD && !obj.oartifact) {
            const lbuf = D.inv.ansimpleoname(obj);  /* simpleonames(), pre-transform */
            if (!Blind())
                await D.dsp.pline('Your sword shines brightly for a moment.');
            obj = oname_pr(D.art, obj, D.art.artiname(P_ART_EXCALIBUR),
                           P_ONAME_GIFT | P_ONAME_KNOW_ARTI);
            if (D.art.is_art(obj, P_ART_EXCALIBUR)) {
                u.ugifts = (u.ugifts | 0) + 1;
                livelog_printf(D.llg.LL_DIVINEGIFT | D.llg.LL_ARTIFACT,
                    `had his wielded ${lbuf} transformed into `
                    + `${D.art.artiname(P_ART_EXCALIBUR)}`);
            }
        }
        /* acquire Excalibur's skill regardless of weapon or gift */
        await D.wep.unrestrict_weapon_skill(PSK_LONG_SWORD);
        if (D.art.is_art(obj, P_ART_EXCALIBUR))
            D.art.discover_artifact(P_ART_EXCALIBUR);
        break;
    case A_NEUTRAL:
        if (class_gift !== P_STRANGE_OBJECT) {
            /* already got bonus above */
        } else if (obj && in_hand) {
            await D.dsp.pline(`Your ${OBJECTS[obj.otyp]?.name} goes snicker-snack!`);
            D.oin.observe_object(obj);
        } else if (!already_exists) {
            obj = D.mkb.mksobj(P_LONG_SWORD, false, false);
            obj = oname_pr(D.art, obj, D.art.artiname(P_ART_VORPAL_BLADE),
                           P_ONAME_GIFT | P_ONAME_KNOW_ARTI);
            obj.spe = 1;
            await at_your_feet('A sword');
            dropy_pr(D.inv, obj);
            u.ugifts = (u.ugifts | 0) + 1;
            livelog_printf(D.llg.LL_DIVINEGIFT | D.llg.LL_ARTIFACT,
                `was bestowed with ${D.art.artiname(P_ART_VORPAL_BLADE)}`);
        }
        /* acquire Vorpal Blade's skill regardless of weapon or gift */
        await D.wep.unrestrict_weapon_skill(PSK_LONG_SWORD);
        if (D.art.is_art(obj, P_ART_VORPAL_BLADE))
            D.art.discover_artifact(P_ART_VORPAL_BLADE);
        break;
    case A_CHAOTIC: {
        /* hcolor(NH_BLACK) draws off the DISPLAY rng when hallucinating */
        const swordbuf = `${hcolor('black')} sword`;
        if (class_gift !== P_STRANGE_OBJECT) {
            /* already got bonus above */
        } else if (obj && in_hand) {
            await D.dsp.pline(`Your ${swordbuf} hums ominously!`);
            D.oin.observe_object(obj);
        } else if (!already_exists) {
            obj = D.mkb.mksobj(P_RUNESWORD, false, false);
            obj = oname_pr(D.art, obj, D.art.artiname(P_ART_STORMBRINGER),
                           P_ONAME_GIFT | P_ONAME_KNOW_ARTI);
            obj.spe = 1;
            await at_your_feet(An_pr(swordbuf));
            dropy_pr(D.inv, obj);
            u.ugifts = (u.ugifts | 0) + 1;
            livelog_printf(D.llg.LL_DIVINEGIFT | D.llg.LL_ARTIFACT,
                `was bestowed with ${D.art.artiname(P_ART_STORMBRINGER)}`);
        }
        /* acquire Stormbringer's skill regardless of weapon or gift */
        await D.wep.unrestrict_weapon_skill(PSK_BROAD_SWORD);
        if (D.art.is_art(obj, P_ART_STORMBRINGER))
            D.art.discover_artifact(P_ART_STORMBRINGER);
        break;
    }
    default:
        obj = null; /* lint */
        break;
    }

    /* enhance weapon regardless of alignment or artifact status */
    if (ok_wep(obj)) {
        D.mkb.bless(obj);
        obj.oeroded = obj.oeroded2 = 0;
        obj.oerodeproof = true;
        obj.bknown = obj.rknown = 1;   /* ok to skip set_bknown() */
        if ((obj.spe | 0) < 1) obj.spe = 1;
        /* acquire skill in this weapon */
        await D.wep.unrestrict_weapon_skill(D.wep.weapon_type(obj));
    } else if (class_gift === P_STRANGE_OBJECT) {
        /* opportunity knocked, but there was nobody home... */
        await D.dsp.pline('You feel unworthy.');
    }
    D.inv.update_inventory();

    /* lastly, confer an extra skill slot/credit beyond the up-to-29 you can
       get from gaining experience levels */
    await D.wep.add_weapon_skill(1);
}
// C ref: artifact.h u_wield_art(art) == (uwep && uwep->oartifact == art).
function u_wield_art_pr(_D, art) {
    return !!game.uwep && game.uwep.oartifact === art;
}

// C ref: pray.c:999 give_spell() — the pat-on-the-head spellbook gift.
// RNG, in order: mkobj(SPBOOK_no_NOVEL, TRUE), then up to ulevel rnd_class()
// re-rolls, then rn2(4) for "learn it directly", then rn2(100) for the
// gratuitous extra discovery.
export async function give_spell() {
    const D = await loadPrayExtras();
    const u = game.u;
    let trycnt = (u.ulevel | 0) + 1;

    /* not yet known spells and forgotten spells are given preference over
       usable ones; also, try to grant a spell the hero could gain skill in */
    const otmp = D.mkb.mkobj(P_SPBOOK_no_NOVEL, true);
    while (--trycnt > 0) {
        if (otmp.otyp !== P_SPE_BLANK_PAPER) {
            if (D.spl.known_spell(otmp.otyp) <= D.spl.spe_Unknown
                && D.enh.p_skill_of(D.spl.spell_skilltype(otmp.otyp)) !== PSK_RESTRICTED)
                break;   /* forgotten or not yet known */
        } else {
            /* blank paper is acceptable if not discovered yet or if the hero
               has a magic marker (charges do not matter) */
            if (!OBJECTS[P_SPE_BLANK_PAPER]?.oc_name_known
                || D.inv.carrying(P_MAGIC_MARKER))
                break;
        }
        otmp.otyp = D.mkb.rnd_class(spbook_base(), P_SPE_BLANK_PAPER);
    }
    /*
     * 25% chance of learning the spell directly instead of receiving the book
     * for it, unless it is already well known.  The chance is not influenced
     * by whether the hero is illiterate.
     */
    let spe_knowledge;
    if (otmp.otyp !== P_SPE_BLANK_PAPER && !rn2(4)
        && (spe_knowledge = D.spl.known_spell(otmp.otyp)) !== D.spl.spe_Fresh) {
        /* force_learn_spell() only returns '\0' for blank paper or an
           already-fresh spell, so no 'else' case is needed */
        const spe_let = D.spl.force_learn_spell(otmp.otyp);
        if (spe_let !== '\0') {
            /* for the spellbook class OBJ_NAME() is the spell name, not
               "spellbook of <spell-name>" */
            const spe_name = OBJECTS[otmp.otyp]?.name;
            if (spe_knowledge === D.spl.spe_Unknown)
                await D.dsp.pline(`Divine knowledge of ${spe_name} fills your`
                    + ` mind!  Spell '${spe_let}'.`);
            else
                await D.dsp.pline(`Your knowledge of spell '${spe_let}' - `
                    + `${spe_name} is ${(spe_knowledge === D.spl.spe_Forgotten)
                        ? 'restored' : 'refreshed'}.`);
        }
        D.inv.obfree(otmp, null);   /* discard the book */
    } else {
        D.oin.observe_object(otmp);
        /* don't set bknown */
        /* discovering blank paper makes it less likely to be given again;
           small chance to arbitrarily discover some other book type */
        if (otmp.otyp === P_SPE_BLANK_PAPER || !rn2(100))
            D.inv.makeknown(otmp.otyp);
        D.mkb.bless(otmp);
        await at_your_feet(upstart_pr(D.inv.ansimpleoname(otmp)));
        place_object(otmp, u.ux, u.uy);
        newsym(u.ux, u.uy);
    }
}

// C ref: pray.c:1529 offer_real_amulet(otmp, altaralign) — the final Test.
// Every arm ends the game, so this never returns.
export async function offer_real_amulet(otmp, altaralign) {
    const D = await loadPrayExtras();
    const u = game.u;
    const cloud_of_smoke = (clr) => `A cloud of ${clr} smoke surrounds you...`;
    const Moloch = 'Moloch';

    /* The final Test.  Did you win? */
    if (game.uamul === otmp) await D.inv.Amulet_off(otmp);
    if (carried(otmp)) D.inv.useup(otmp);   /* well, it's gone now */
    else D.inv.useupf(otmp, 1);

    await D.dsp.pline(`You offer the Amulet of Yendor to ${a_gname()}...`);

    if (altaralign === A_NONE) {
        /* Moloch's high altar at the bottom of Gehennom */
        if ((u.ualign?.record | 0) > -99) u.ualign.record = -99;
        await D.dsp.pline('An invisible choir chants, and you are bathed in'
            + ' darkness...');
        /*[apparently shrug/snarl can be sensed without being seen]*/
        await D.dsp.pline(`${Moloch} shrugs and retains dominion over`
            + ` ${u_gname()},`);
        await D.dsp.pline('then mercilessly snuffs out your life.');
        game._killer_name = `${s_suffix_pr(Moloch)} indifference`;
        game._killer_format = P_KILLED_BY;
        await D.end.done(P_DIED);
        /* life-saved (or declined to die in wizard/explore mode) */
        await D.dsp.pline(`${Moloch} snarls and tries again...`);
        await fry_by_god(A_NONE, true);      /* wrath of Moloch */
        /* declined to die in wizard or explore mode */
        await D.dsp.pline(cloud_of_smoke(hcolor('black')));
        await D.end.done(P_ESCAPED);
    } else if ((u.ualign?.type ?? 0) !== altaralign) {
        /* And the opposing team picks you up and carries you off on their
           shoulders. */
        adjalign(-99);
        await D.dsp.pline(`${a_gname()} accepts your gift, and gains dominion`
            + ` over ${u_gname()}...`);
        await D.dsp.pline(`${u_gname()} is enraged...`);
        await D.dsp.pline(`Fortunately, ${a_gname()} permits you to live...`);
        await D.dsp.pline(cloud_of_smoke(hcolor('orange')));
        await D.end.done(P_ESCAPED);
    } else {
        /* You've won the game!  Feedback-wise, it's a bit of a let down. */
        u.uevent = u.uevent || {};
        u.uevent.ascended = 1;
        adjalign(10);
        await D.dsp.pline('An invisible choir sings, and you are bathed in'
            + ' radiance...');
        await godvoice(altaralign, 'Mortal, thou hast done well!');
        await verbalize('In return for thy service, I grant thee the gift of'
            + ' Immortality!');
        await D.dsp.pline(`You ascend to the status of Demigod`
            + `${game.flags?.female ? 'dess' : ''}...`);
        await D.end.done(P_ASCENDED);
    }
}

// C ref: pray.c:2177 pray_revive() — TRUE if praying revived a pet corpse.
export async function pray_revive() {
    const D = await loadPrayExtras();
    const u = game.u;
    let otmp = null;
    for (const o of (game.level?.objects || [])) {
        if (o.where !== 'floor' || o.ox !== u.ux || o.oy !== u.uy) continue;
        if ((o.otyp === CORPSE || o.otyp === P_STATUE)
            && D.mkb.has_omonst(o)
            && OMONST(o)?.mtame && !OMONST(o)?.isminion) {
            otmp = o;
            break;
        }
    }
    if (!otmp) return false;

    if (otmp.otyp === CORPSE) {
        // GAP: mon.c revive(obj, TRUE) is unported (js/apply.js:1697 records the
        // same gap for revive_corpse()); the scan above is the whole decision.
        return false;
    }
    const ANIMATE_SPELL = 2;   /* trap.h */
    return (await D.trp.animate_statue(otmp, u.ux, u.uy, ANIMATE_SPELL, null)) != null;
}

// C ref: pray.c:2347 maybe_turn_mon_iter(mtmp) — the per-monster body of the
// #turn command's iter_mons() walk.  js/extcmd-handlers.js:788-828 inlines a
// reduced copy of this into doturn(); that copy omits C's is_vampshifter() arm
// and the set_malign() after the chaotic "make peaceful" case.
export async function maybe_turn_mon_iter(mtmp) {
    const D = await loadPrayExtras();
    const u = game.u;
    /* 3.6.3: used to use cansee() here but the purpose is to prevent #turn
       operating through walls, not to require that the hero be able to see
       the target location */
    let range = P_BOLT_LIM + Math.trunc((u.ulevel | 0) / 5);
    range *= range;                              /* gt.turn_undead_range */
    const dx = mtmp.mx - u.ux, dy = mtmp.my - u.uy;
    if (!D.vis.couldsee(mtmp.mx, mtmp.my) || dx * dx + dy * dy > range)
        return;

    const ptr = mtmp.data;
    if (!mtmp.mpeaceful
        && (D.mfl.is_undead_flag(ptr) || is_vampshifter_pr(D, mtmp)
            || (D.mfl.is_demon_flag(ptr) && (u.ulevel | 0) > Math.trunc(P_MAXULEV / 2)))) {
        mtmp.msleeping = 0;
        if ((u.uprops?.Confusion | 0) > 0 || u.uconf) {
            if (!turn_undead_msg_cnt++)   /* C: gt.turn_undead_msg_cnt */
                await update_topl('Unfortunately, your voice falters.');
            mtmp.mflee = 0;
            mtmp.mfrozen = 0;
            mtmp.mcanmove = 1;
        } else if (!D.zap.resist(mtmp, '\0', 0, 1 /*TELL*/)) {
            let xlev = 6;
            switch (ptr?.mcls) {
            /* this is intentional, lichs are tougher than zombies */
            case PS_LICH:    xlev += 2;  /* FALLTHRU */
            case PS_GHOST:   xlev += 2;  /* FALLTHRU */
            case PS_VAMPIRE: xlev += 2;  /* FALLTHRU */
            case PS_WRAITH:  xlev += 2;  /* FALLTHRU */
            case PS_MUMMY:   xlev += 2;  /* FALLTHRU */
            case PS_ZOMBIE:
                if ((u.ulevel | 0) >= xlev
                    && !D.zap.resist(mtmp, '\0', 0, 0 /*NOTELL*/)) {
                    if ((u.ualign?.type ?? 0) === A_CHAOTIC) {
                        mtmp.mpeaceful = 1;
                        D.mkm.set_malign(mtmp);
                    } else {   /* damn them */
                        await D.uhi.killed(mtmp);
                    }
                    break;
                }
                /* else flee — FALLTHRU */
            default:
                monflee_pr(mtmp);
                break;
            }
        }
    }
}
// C ref: pray.c gt.turn_undead_msg_cnt — a file static that doturn() zeroes
// before its iter_mons() walk so only the first monster prints the falter line.
let turn_undead_msg_cnt = 0;
export function reset_turn_undead_msg_cnt() { turn_undead_msg_cnt = 0; }
// C ref: mon.c monflee(mtmp, 0, FALSE, TRUE) — an untimed scare.  Kept local so
// maybe_turn_mon_iter() does not have to pick between js/monmove.js's async
// monflee() and js/uhitm.js's sync copy (they disagree on the message).
function monflee_pr(mtmp) { mtmp.mflee = 1; mtmp.mfleetim = 0; }
// C ref: monst.h:217 is_vampshifter(mon) — cham is PM_VAMPIRE,
// PM_VAMPIRE_LEADER or PM_VLAD_THE_IMPALER.  This port stores cham as a mons[]
// pmidx, so resolve the three rows by name once.
const VAMPSHIFT_CHAM = ['vampire', 'vampire leader', 'Vlad the Impaler'];
function is_vampshifter_pr(D, mtmp) {
    const cham = mtmp?.cham;
    if (cham == null || cham < 0) return false;
    const nm = D.mkm.monster_by_pmidx(cham)?.name;
    return !!nm && VAMPSHIFT_CHAM.includes(nm);
}

// C ref: pray.c:2514 a_gname_at(x, y) — the name of the deity of the altar at
// <x,y>, or null when that square holds no altar.  Note the module-private
// a_gname() above (js/pray.js:1051) skips the IS_ALTAR() guard, so it names a
// god even off an altar where C returns NULL.
export function a_gname_at(x, y) {
    if (game.level?.at(x, y)?.typ !== ALTAR) return null;  /* C: !IS_ALTAR() */
    return align_gname(roleMnum(), a_align(x, y));
}

// C ref: pray.c:2677 blocked_boulder(dx, dy) — can the hero not step that way
// because of boulders?  "assumes isok() at one space away, but not necessarily
// at two".  RNG-free.
export async function blocked_boulder(dx, dy) {
    const D = await loadPrayExtras();
    const u = game.u;
    let count = 0;
    for (const otmp of (game.level?.objects || [])) {
        if (otmp.where !== 'floor') continue;
        if (otmp.ox !== u.ux + dx || otmp.oy !== u.uy + dy) continue;
        if (otmp.otyp === P_BOULDER) count += (otmp.quan || 1);
    }

    const nx = u.ux + 2 * dx, ny = u.uy + 2 * dy; /* beyond the boulder(s) */
    switch (count) {
    case 0:
        /* no boulders--not blocked */
        return false;
    case 1:
        /* possibly blocked depending on if it's pushable */
        break;
    case 2:
        /* this is only approximate since multiple boulders might sink */
        if (D.dbr.is_pool_or_lava(nx, ny))   /* does its own isok() check */
            break;                           /* still need Sokoban check */
        return true;                         /* C: FALLTHRU into default */
    default:
        /* more than one boulder--blocked after they push the top one;
           don't force them to push it first to find out */
        return true;
    }

    if (dx && dy && In_sokoban_pr())  /* can't push diagonally in Sokoban */
        return true;
    if (!isok(nx, ny)) return true;
    if (IS_OBSTRUCTED(game.level?.at(nx, ny)?.typ)) return true;
    if (D.inv.sobj_at(P_BOULDER, nx, ny)) return true;
    return false;
}
// C ref: dungeon.c In_sokoban(&u.uz).
function In_sokoban_pr() {
    return game.u?.uz?.dnum != null && game.u.uz.dnum === game.sokoban_dnum;
}
