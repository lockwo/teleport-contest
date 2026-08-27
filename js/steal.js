// steal.js — C ref: src/steal.c.
//
// A monster taking things off the hero.  The entry point is steal(), reached
// from uhitm.c mhitm_ad_sedu() when a nymph / succubus / monkey lands its
// AD_SITM or AD_SEDU attack (js/monmove.js mhitm_ad_sedu).  The two other
// steal.c routines that this port already had — relobj() (death drops) and
// mdrop_obj() — live in js/uhitm.js and js/dogmove.js next to their callers.
//
// RNG shape of the covered path (a nymph stealing a worn ring):
//   steal(): rn2(weighted inventory total)      [which item]
//   -> worn_item_removal() -> remove_worn_item()   [no RNG]
//   -> "<Mon> stole <item>."                       [no RNG]
// and then, back in mhitm_ad_sedu(), rloc(mtmp, RLOC_MSG) picks the escape
// square with its own rnd(COLNO-1)/rn2(ROWNO) pairs (js/teleport.js).

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { dist2 } from './hacklib.js';
import { objects, BOULDER, CORPSE, COIN_CLASS, ARMOR_CLASS, RING_CLASS,
    AMULET_CLASS, TOOL_CLASS, FOOD_CLASS } from './mkobj.js';
import { PLNMSG_MON_TAKES_OFF_ITEM } from './const.js';
import { update_topl } from './display.js';
import { Blind } from './vision.js';
import { canspotmon, Monnam } from './uhitm.js';
import { is_animal, humanoid, throws_rocks_flag } from './monflags_data.js';
import {
    inv_cnt, freeinv, encumber_msg, doname_invent, remove_worn_item,
    worn_item_removal, oc_delay, W_ARMOR_WORN, W_ACCESSORY_WORN,
} from './invent.js';

// C ref: defsym.h MONSYM(14, 'n', NYMPH, S_NYMPH, "nymph") — the class whose
// "<Mon> takes off ..." preface makes the follow-up theft message use "She"
// instead of repeating the name.  (This was 12, which is S_LEPRECHAUN's
// neighbourhood, not S_NYMPH: the test silently never fired.)
const S_NYMPH_MCLS = 14;
// C ref: obj.h how_lost values.
const LOST_NONE = 0, LOST_STOLEN = 2;

// C ref: mon.c monnear(mon, x, y) — is the monster close enough to attack?
// (The NODIAG grid-bug refinement doesn't matter for a thief.)
function monnear(mon, x, y) { return dist2(mon.mx, mon.my, x, y) < 3; }

// C ref: do_name.c some_mon_nam()/Some_Monnam() — like Monnam(), but an unseen
// thief is "Someone" (humanoid) or "Something" rather than "It".
export function Some_Monnam(mtmp) {
    if (!canspotmon(mtmp)) return humanoid(mtmp?.data) ? 'Someone' : 'Something';
    return Monnam(mtmp);
}

// C ref: steal.c somegold(lmoney) — the proportional slice of the hero's purse
// a leprechaun grabs.
export function somegold(lmoney) {
    const LARGEST_INT = 32767;
    let igold = (lmoney >= LARGEST_INT) ? LARGEST_INT : (lmoney | 0);
    if (igold < 50) { /* all gold */ }
    else if (igold < 100) igold = rn1(igold - 25 + 1, 25);
    else if (igold < 500) igold = rn1(igold - 50 + 1, 50);
    else if (igold < 1000) igold = rn1(igold - 100 + 1, 100);
    else if (igold < 5000) igold = rn1(igold - 500 + 1, 500);
    else if (igold < 10000) igold = rn1(igold - 1000 + 1, 1000);
    else igold = rn1(igold - 5000 + 1, 5000);
    return igold;
}
// C ref: rnd.c rn1(x, y) = rn2(x) + y.
function rn1(x, y) { return rn2(x) + y; }

// C ref: steal.c findgold(chain) — first gold object in an object chain.
export function findgold(chain) {
    for (const o of (chain || [])) if (o.oclass === COIN_CLASS) return o;
    return null;
}

// C ref: steal.c unresponsive() — can the hero be charmed into disrobing?  A
// helpless (unconscious / fainted / frozen / paralyzed) hero cannot.
function unresponsive() {
    if ((game.multi ?? 0) >= 0) return false;
    const why = game.multi_reason || '';
    return why.startsWith('frozen') || why.startsWith('paralyzed');
}

// C ref: do_wear.c doffing(obj) / stop_donning(obj) — is a multi-turn dressing
// maneuver in progress on this very object, and if so cancel it and report the
// delay that was still outstanding.  This port drives delayed donning through
// invent.js start_occupation() rather than C's afternmv hook and no covered
// session is mid-maneuver when a thief strikes, so both report "not donning".
function doffing(_obj) { return false; }
function stop_donning(_obj) { return 0; }

// C ref: cmd.c stop_occupation() — "you're going to notice the theft".  This
// port has no single go.occupation slot (each multi-turn activity carries its
// own flag in allmain.js); nothing is occupying the hero on the turns a thief
// reaches steal() in the covered sessions, so there is nothing to interrupt.
function stop_occupation() { /* no occupation to stop */ }

// C ref: hack.c nomul(nval) — make the hero busy for |nval| turns.
function nomul(nval) {
    if ((game.multi ?? 0) < nval) return;
    game.multi = nval;
}

// C ref: steal.c mpickobj(mtmp, otmp) — put a just-taken object into the
// monster's inventory.  Returns 1 if otmp was freed by a merge.  No RNG.
export function mpickobj(mtmp, otmp) {
    if (!otmp) return 1;
    // uball/uchain, gt.thrownobj/gk.kickedobj and the shop-bill and
    // light-source cases are all inert for the thefts these sessions see.
    otmp.no_charge = 0;
    if (!mtmp.mtame) {
        // unknow_object() when the thief can't be seen: the covered thefts are
        // all in plain sight, so the hero's knowledge of the item survives.
        if (otmp.how_lost === LOST_THROWN) otmp.how_lost = LOST_STOLEN;
        else if (otmp.how_lost === LOST_DROPPED) otmp.how_lost = LOST_NONE;
    }
    // add_to_minv(): merge with an identical stack already carried, else append.
    mtmp.minvent = mtmp.minvent || [];
    for (const o of mtmp.minvent) {
        if (mergable(o, otmp)) {
            o.quan = (o.quan || 1) + (otmp.quan || 1);
            return 1;                                  /* otmp was freed */
        }
    }
    otmp.where = 'minvent';
    otmp.ocarry = mtmp;
    mtmp.minvent.push(otmp);
    return 0;
}
// C ref: obj.h how_lost values used by mpickobj's autopickup bookkeeping.
// obj.h:481-484 — LOST_NONE 0, LOST_THROWN 1, LOST_DROPPED 2, LOST_STOLEN 3.
// LOST_DROPPED was 3, which is LOST_STOLEN: dropped objects were bookkept as stolen.
const LOST_THROWN = 1, LOST_DROPPED = 2;

// C ref: mkobj.c mergable(otmp, obj) — reduced to the identity tests that
// matter for a stolen item: same type/enchantment/BUC, and only for the classes
// that actually stack (a corpse never merges; armor/rings/amulets/tools are
// one-per-object).  A wrong "yes" here would silently destroy the theft, so the
// test is deliberately conservative.
function mergable(o, otmp) {
    if (o.otyp !== otmp.otyp || o.oclass !== otmp.oclass) return false;
    if (o.oclass === ARMOR_CLASS || o.oclass === RING_CLASS
        || o.oclass === AMULET_CLASS || o.oclass === TOOL_CLASS
        || o.otyp === CORPSE) return false;
    return (o.spe | 0) === (otmp.spe | 0)
        && !!o.cursed === !!otmp.cursed && !!o.blessed === !!otmp.blessed;
}

// C ref: steal.c steal(mtmp, objnambuf) — a monster steals one item from the
// hero.  Returns 1 when something was taken (or at least when the thief should
// flee now), 0 when nothing happened, -1 if the thief died in the attempt.
// `objnambuf` is an out-parameter object ({ value: '' }) mirroring C's char
// buffer; only the monkey-flees message reads it.
export async function steal(mtmp, objnambuf) {
    const u = game.u;
    const invent = game.invent || [];
    let otmp = null;
    let named = 0, retrycnt = 0;
    const monkey_business = is_animal(mtmp.data);
    const seen = canspotmon(mtmp);
    // Punished (ball & chain) never applies to the covered heroes.
    const was_punished = false;

    if (objnambuf) objnambuf.value = '';
    /* true if successful on first of two attacks */
    if (!monnear(mtmp, u.ux, u.uy)) return 0;

    let Monnambuf = Some_Monnam(mtmp);

    // go.occupation -> maybe_finished_meal(FALSE): removes a just-finished
    // meal from inventory so it can't be stolen.  Nothing is being eaten on
    // the turns a thief strikes in the covered sessions.

    const nothing_to_steal = async () => {
        // The Punished / buried-ball branches need a ball & chain, which the
        // covered heroes never carry.
        if (Blind()) {
            await update_topl('Somebody tries to rob you, but finds nothing to steal.');
        } else if (inv_cnt(true) > inv_cnt(false)) {
            await update_topl(`${Monnambuf} tries to rob you, but isn't interested in gold.`);
        } else {
            await update_topl(`${Monnambuf} tries to rob you, but there is nothing to steal!`);
        }
        return 1; /* let her flee */
    };

    const icnt = inv_cnt(false); /* don't include gold */
    if (!icnt) return await nothing_to_steal();

    // "Skip ring special cases" for an animal or a gloved hero; otherwise a
    // worn ring of adornment is grabbed first, with no random selection.
    let gotobj = false;
    if (monkey_business || game.uarmg) {
        /* skip ring special cases */
    } else if (game.uleft && game.uleft.otyp === RIN_ADORNMENT) {
        otmp = game.uleft; gotobj = true;
    } else if (game.uright && game.uright.otyp === RIN_ADORNMENT) {
        otmp = game.uright; gotobj = true;
    }

    // C's `goto retry` (a boulder that can't be taken) re-runs the weighted
    // pick once; `goto cant_take` is the animal give-up message.
    const cant_take = async () => {
        const how = ['steal', 'snatch', 'grab', 'take'];
        const verb = how[rn2(how.length)];   /* ROLL_FROM(how) */
        const worn = (otmp.owornmask || 0) & W_ARMOR_WORN;
        await update_topl(`${Monnambuf} tries to ${verb} `
            + `${worn ? 'your ' : ''}${worn ? armor_simple_name(otmp) : yname(otmp)}`
            + ' but gives up.');
        /* the fewer items you have, the less likely the thief sticks around */
        return rn2(Math.floor(inv_cnt(false) / 5) + 2) ? 0 : 1;
    };

    while (!gotobj) {
        let tmp = 0;
        for (const o of invent)
            if ((!game.uarm || o !== game.uarmc) && o.oclass !== COIN_CLASS)
                tmp += ((o.owornmask || 0) & (W_ARMOR_WORN | W_ACCESSORY_WORN)) ? 5 : 1;
        if (!tmp) return await nothing_to_steal();
        tmp = rn2(tmp);
        otmp = null;
        for (const o of invent) {
            if ((!game.uarm || o !== game.uarmc) && o.oclass !== COIN_CLASS) {
                tmp -= ((o.owornmask || 0) & (W_ARMOR_WORN | W_ACCESSORY_WORN)) ? 5 : 1;
                if (tmp < 0) { otmp = o; break; }
            }
        }
        if (!otmp) return 0;                     /* impossible("Steal fails!") */

        /* can't steal ring(s) while wearing gloves */
        if ((otmp === game.uleft || otmp === game.uright) && game.uarmg)
            otmp = game.uarmg;
        /* can't steal gloves while wielding - so steal the wielded item */
        if (otmp === game.uarmg && game.uwep) otmp = game.uwep;
        /* can't steal armor while wearing cloak - so steal the cloak */
        else if (otmp === game.uarm && game.uarmc) otmp = game.uarmc;
        /* can't steal shirt while wearing cloak or suit */
        else if (otmp === game.uarmu && game.uarmc) otmp = game.uarmc;
        else if (otmp === game.uarmu && game.uarm) otmp = game.uarm;

        if (otmp.otyp === BOULDER && !throws_rocks_flag(mtmp.data)) {
            if (!retrycnt++) continue;           /* goto retry */
            return await cant_take();
        }
        break;
    }

    if (otmp.o_id === game.stealoid) return 0;

    /* animals can't overcome curse stickiness nor unlock chains */
    if (monkey_business) {
        const ostuck = ((otmp.cursed && otmp.owornmask)
            || (otmp === game.uright && welded(game.uwep))
            || (otmp === game.uleft && welded(game.uwep) && bimanual(game.uwep)));
        if (ostuck || !can_carry(mtmp, otmp)) return await cant_take();
    }

    // A leashed leash is unleashed first; no leash is ever in use here.

    const was_doffing = doffing(otmp);
    /* stop donning/doffing now so that afternmv won't be clobbered below */
    const olddelay = stop_donning(otmp);
    /* you're going to notice the theft... */
    stop_occupation();

    if ((otmp.owornmask || 0) & (W_ARMOR_WORN | W_ACCESSORY_WORN)) {
        switch (otmp.oclass) {
        case TOOL_CLASS:
        case AMULET_CLASS:
        case RING_CLASS:
        case FOOD_CLASS: /* meat ring */
            await worn_item_removal(mtmp, otmp);
            break;
        case ARMOR_CLASS: {
            let armordelay = oc_delay(otmp.otyp);
            if (olddelay > 0 && olddelay < armordelay) armordelay = olddelay;
            if (monkey_business || unresponsive()) {
                /* animals usually lack the patience for a slow removal, and a
                   helpless hero can't be charmed into disrobing */
                if (armordelay >= 1 && !olddelay && rn2(10)) return await cant_take();
                await worn_item_removal(mtmp, otmp);
                break;
            } else {
                const curssv = otmp.cursed;
                otmp.cursed = 0;
                const slowly = (armordelay >= 1 || (game.multi ?? 0) < 0);
                if (game.flags?.female) {
                    await update_topl(`${!seen ? 'She' : Monnambuf} charms you.  You gladly `
                        + `${curssv ? 'let her take'
                            : !slowly ? 'hand over'
                                : was_doffing ? 'continue removing' : 'start removing'} `
                        + `your ${armor_simple_name(otmp)}.`);
                } else {
                    await update_topl(`${!seen ? 'She' : Adjmonnam(mtmp, 'beautiful')} seduces you and `
                        + `${curssv ? 'helps you to take'
                            : !slowly ? 'you take'
                                : was_doffing ? 'you continue taking' : 'you start taking'} `
                        + `off your ${armor_simple_name(otmp)}.`);
                }
                named++;
                /* set multi for later on */
                nomul(-armordelay);
                game.multi_reason = 'taking off clothes';
                await remove_worn_item(otmp, true);
                otmp.cursed = curssv;
                if ((game.multi ?? 0) < 0) {
                    // The hero keeps taking the piece off over the next turns;
                    // stealarm() finishes the theft via the afternmv hook, which
                    // this port doesn't carry.  Record the pending theft so the
                    // item can't be stolen twice and stop here, exactly as C's
                    // `return 0` does for this turn.
                    game.stealoid = otmp.o_id;
                    game.stealmid = mtmp.m_id;
                    return 0;
                }
            }
            break;
        }
        default:
            break; /* impossible("Tried to steal a strange worn thing.") */
        }
        /* the blindfold might have just been stolen; refresh the cached name */
        if (!seen && canspotmon(mtmp)) Monnambuf = Monnam(mtmp);
    } else if (otmp.owornmask) { /* weapon (ball & chain never applies here) */
        await worn_item_removal(mtmp, otmp);
    }

    /* do this before removing it from inventory */
    if (objnambuf) objnambuf.value = yname(otmp);
    /* set mavenge so knights don't suffer an alignment penalty in retaliation */
    if (!was_punished) mtmp.mavenge = 1;    /* !Conflict: never in these sessions */

    freeinv(otmp);

    /* if we just gave a "<mon> takes off ..." message with nothing in between,
       shorten the '<mon> stole <item>' message to "She stole ..." */
    if (game.last_msg === PLNMSG_MON_TAKES_OFF_ITEM
        && mtmp.data?.mcls === S_NYMPH_MCLS)
        ++named;
    await update_topl(`${named ? 'She' : Monnambuf} stole ${doname_invent(otmp)}.`);
    await encumber_msg();
    // could_petrify (a cockatrice corpse) needs a corpse in inventory.
    otmp.how_lost = LOST_STOLEN;
    mpickobj(mtmp, otmp);
    return ((game.multi ?? 0) < 0) ? 0 : 1;
}

// C ref: onames.h RIN_ADORNMENT — the ring a thief grabs before rolling.
const RIN_ADORNMENT = 173;

// C ref: do_wear.c armor_simple_name(obj) — "suit"/"cloak"/"helmet"/"shield"/
// "gloves"/"boots"/"shirt" for the take-off messages.
function armor_simple_name(obj) {
    const name = objects[obj.otyp]?.name || 'armor';
    if (/shield/.test(name)) return 'shield';
    if (/helm|hat|cap|pot/.test(name)) return 'helmet';
    if (/gloves|gauntlets/.test(name)) return 'gloves';
    if (/boots|shoes/.test(name)) return 'boots';
    if (/cloak|robe/.test(name)) return 'cloak';
    if (/shirt/.test(name)) return 'shirt';
    return 'suit';
}

// C ref: do_name.c yname(obj) — "your <obj>" for a carried item.
function yname(obj) { return `your ${objects[obj.otyp]?.name || 'thing'}`; }

// C ref: do_name.c Adjmonnam(mtmp, adj) — "The beautiful nymph".  Only the
// male-hero seduction message uses it; the covered hero is female.
function Adjmonnam(mtmp, adj) {
    const s = Monnam(mtmp);
    return s.replace(/^The /, `The ${adj} `);
}

// C ref: wield.c welded(obj) / objects[].oc_bimanual — a cursed wielded weapon
// welds to the hand.  Only consulted on the animal-thief path.
function welded(obj) { return !!obj && obj === game.uwep && !!obj.cursed; }
// C ref: objclass.h bimanual(otmp) — objects[].oc_bimanual.  Only reached on
// the animal-thief path, which no covered session exercises.
function bimanual(_obj) { return false; }

// C ref: mon.c can_carry(mtmp, otmp) — weight/loadstone/Amulet limits.  The
// monkey path is the only caller; the covered sessions have no monkeys.
function can_carry(_mtmp, _otmp) { return 1; }

// ===========================================================================
// steal.c: the remaining top-level functions, translated.  APPEND-ONLY —
// nothing above this line calls anything below it.
//
// Several C callees exist in js/ only as module-private copies; each local
// adapter below names the file:line of the faithful original, because the fix
// is to EXPORT that one rather than let a second copy drift:
//   add_to_minv       js/vault.js:184        money_cnt   js/invent.js:1155
//   setnotworn        js/invent.js:829       s_suffix    js/zap.js:1712
//   is_quest_artifact js/invent.js:370       mdrop_obj   js/dogmove.js:940
// ===========================================================================

import { rnd } from './rng.js';
import { newsym } from './display.js';
import { cansee } from './vision.js';
import { GOLD_PIECE, ROCK_CLASS, AMULET_OF_YENDOR,
         base_oc_cost, place_object } from './mkobj.js';
import { mflags1_of, M1_SLITHY, can_teleport_flag } from './monflags_data.js';
import { W_SADDLE } from './const.js';

// C ref: onames.h — the four "special interest" targets of an AD_SAMU theft,
// resolved by NAME so an objects[] shift can't silently re-point them.
function otyp_by_name_st(nm) {
    for (let i = 0; i < objects.length; i++)
        if (objects[i] && objects[i].name === nm) return i;
    return 0;
}
const FAKE_AMULET_OF_YENDOR =
    otyp_by_name_st('cheap plastic imitation of the Amulet of Yendor');
const BELL_OF_OPENING = otyp_by_name_st('bell of opening');
const BELL_ST = otyp_by_name_st('bell');
const SPE_BOOK_OF_THE_DEAD = otyp_by_name_st('Book of the Dead');
const CANDELABRUM_OF_INVOCATION = otyp_by_name_st('Candelabrum of Invocation');
// C ref: monattk.h:91 AD_SITM (251) / AD_SAMU (252) — steal-item / steal-Amulet.
const AD_SITM_ST = 251;

// C ref: mon.c add_to_minv(mon, obj) — js/vault.js:184 holds the private
// original; the steal.c callers below need the same "merge or append".
function add_to_minv_st(mon, obj) {
    mon.minvent = mon.minvent || [];
    obj.where = 'minvent';
    obj.ocarry = mon;
    mon.minvent.push(obj);
}
// C ref: invent.c money_cnt(list) — js/invent.js:1155 (private).
function money_cnt_st(list) {
    let sum = 0;
    for (const obj of (list || []))
        if (obj.oclass === COIN_CLASS) sum += (obj.quan | 0);
    return sum;
}
// C ref: worn.c setnotworn(obj) — js/invent.js:829 (private).  Clears the worn
// mask; the slot-pointer half needs invent.js's uarm/uwep bookkeeping.
function setnotworn_st(obj) { if (obj) obj.owornmask = 0; }
// C ref: hacklib.c s_suffix(s) — js/zap.js:1712 (private).
function s_suffix_st(s) { return /s$/.test(s || '') ? `${s}'` : `${s}'s`; }
// C ref: artifact.c is_quest_artifact(obj) — js/invent.js:370 answers FALSE
// unconditionally (no quest artifact reaches this port's play), and
// any_quest_artifact() has no port at all.
function is_quest_artifact_st(_obj) { return false; }
function any_quest_artifact_st(_obj) { return false; }
// C ref: hack.h distu(x, y) == dist2(x, y, u.ux, u.uy).
function distu_st(x, y) { return dist2(x, y, game.u.ux, game.u.uy); }
// C ref: you.h Levitation / Flying.
function Levitation_st() { return !!game.u?.uprops?.Levitation; }
function Flying_st() { return !!game.u?.uprops?.Flying; }
// C ref: hacklib.c upstart(s) — capitalize the first letter in place.
function upstart_st(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
// C ref: body.h FOOT / HAND — body_part() part indices (js/invent.js:1376
// body_part() takes the same enum).
const FOOT_ST = 8, HAND_ST = 5;

// C ref: steal.c:58 stealgold(mtmp) — a leprechaun grabs the gold under (or in)
// the hero.  Floor gold outweighing carried gold is taken first (and always on
// a 1-in-5), otherwise a somegold() slice of the purse.
export async function stealgold(mtmp) {
    const u = game.u;
    const inv = inventoryArray_st();
    const { g_at } = await import('./invent.js');
    let fgold = g_at(u.ux, u.uy);
    let who, whose, what;

    /* skip lesser coins on the floor */
    while (fgold && fgold.otyp !== GOLD_PIECE) fgold = fgold.nexthere;

    /* Do you have real gold? */
    let ygold = findgold(inv);

    if (fgold && (!ygold || fgold.quan > ygold.quan || !rn2(5))) {
        const { obj_extract_self } = await import('./invent.js');
        obj_extract_self(fgold);
        add_to_minv_st(mtmp, fgold);
        newsym(u.ux, u.uy);
        const { y_monnam } = await import('./do_name.js');
        const { makeplural, body_part } = await import('./invent.js');
        const { mbodypart } = await import('./monmove.js');
        if (u.usteed) {
            who = u.usteed;
            whose = s_suffix_st(y_monnam(who));
            what = makeplural(mbodypart(who, FOOT_ST));
        } else {
            who = game.youmonst;
            whose = 'your';
            what = makeplural(body_part(FOOT_ST));
        }
        /* [ avoid "between your rear regions" :-] */
        if (slithy_st(who))
            what = 'coils';
        /* reduce "rear hooves/claws" to "hooves/claws" */
        if (what.startsWith('rear ')) what = what.slice(5);
        await update_topl(`${Monnam(mtmp)} quickly snatches some gold from ${
            (Levitation_st() || Flying_st()) ? 'beneath' : 'between'} ${
            whose} ${what}!`);
        if (!ygold || !rn2(5)) {
            const { tele_restrict, rloc } = await import('./teleport.js');
            const { monflee } = await import('./monmove.js');
            if (!tele_restrict(mtmp))
                await rloc(mtmp, /*RLOC_MSG*/ 1);
            await monflee(mtmp, 0, false, false);
        }
    } else if (ygold) {
        const gold_price = base_oc_cost(GOLD_PIECE) || 1;
        const { splitobj } = await import('./invent.js');
        const { tele_restrict, rloc } = await import('./teleport.js');
        const { monflee } = await import('./monmove.js');

        let tmp = Math.trunc((somegold(money_cnt_st(inv)) + gold_price - 1)
                             / gold_price);
        tmp = Math.min(tmp, ygold.quan | 0);
        if (tmp < (ygold.quan | 0))
            ygold = splitobj(ygold, tmp);
        else
            setnotworn_st(ygold);
        freeinv(ygold);
        add_to_minv_st(mtmp, ygold);
        await update_topl('Your purse feels lighter.');
        if (!tele_restrict(mtmp))
            await rloc(mtmp, /*RLOC_MSG*/ 1);
        await monflee(mtmp, 0, false, false);
        game.disp = game.disp || {};
        game.disp.botl = true;
    }
}

// C ref: mondata.h:67 slithy(ptr) — M1_SLITHY.
function slithy_st(mon) { return (mflags1_of(mon?.data) & M1_SLITHY) !== 0; }

// C ref: invent.c gi.invent — this port keeps the hero's pack as an array.
function inventoryArray_st() { return game.invent || []; }

// C ref: steal.c:120 thiefdead() — the thief that was mid-theft has died, so
// the hero's multi-turn disrobing must finish WITHOUT the theft.
//
// C swaps the ga.afternmv callback (stealarm -> unstolenarm).  This port has no
// single afternmv slot (see the allmain.js note on go.occupation); the pending
// theft is recorded as game.stealoid/game.stealmid by steal() above, so the
// equivalent is to clear the thief id and re-point the finish callback.
export function thiefdead() {
    /* hero is busy taking off an item of armor which takes multiple turns */
    game.stealmid = 0;
    if (game.afternmv === stealarm) {
        game.afternmv = unstolenarm;
        game.nomovemsg = null;
    }
}

// C ref: steal.c:147 unstolenarm() — the afternmv that runs when the thief died
// while the hero was still taking the targeted armor off.
export async function unstolenarm() {
    let obj = null;

    /* find the object before clearing stealoid; it has already become
       not-worn and is still in hero's inventory */
    for (const o of inventoryArray_st())
        if (o.o_id === game.stealoid) { obj = o; break; }
    game.stealoid = 0;
    if (obj) {
        await update_topl(`You finish taking off your ${
            armor_simple_name(obj)}.`);
    }
    return 0;
}

// C ref: steal.c:165 stealarm() — the afternmv that completes a slow theft:
// the thief must still be alive, still have a steal attack and still be
// adjacent, or the hero simply finishes undressing.
export async function stealarm() {
    const inv = inventoryArray_st().slice();   /* C walks with a nextobj cursor */
    let done = false;

    if (!game.stealoid || !game.stealmid) {
        game.stealoid = game.stealmid = 0;
        return 0;
    }

    for (const otmp of inv) {
        if (otmp.o_id !== game.stealoid) continue;
        for (const mtmp of (game.level?.monsters || [])) {
            if (mtmp.m_id !== game.stealmid) continue;
            if (DEADMONSTER(mtmp)) {
                /* impossible("stealarm(): dead monster stealing") */
                done = true;
                break;
            }
            /* maybe the thief polymorphed into something without a steal
               attack, or took away items that dropped the hero into water
               and then teleported to safety */
            if (!await dmgtype_st(mtmp.data, AD_SITM_ST)
                || distu_st(mtmp.mx, mtmp.my) > 2) {
                done = true;
                break;
            }
            if (otmp.unpaid) await subfrombill_st(otmp);
            freeinv(otmp);
            await update_topl(`${Monnam(mtmp)} steals ${doname_invent(otmp)}!`);
            mpickobj(mtmp, otmp);          /* may free otmp */
            /* Implies seduction, "you gladly hand over ..." so we don't set
               the mavenge bit here. */
            {
                const { monflee } = await import('./monmove.js');
                const { tele_restrict, rloc } = await import('./teleport.js');
                await monflee(mtmp, 0, false, false);
                if (!tele_restrict(mtmp))
                    await rloc(mtmp, /*RLOC_MSG*/ 1);
            }
            break;
        }
        break;
    }
    void done;
    game.stealoid = game.stealmid = 0; /* in case only one has been reset */
    return 0;
}

// C ref: mondata.h dmgtype(ptr, dtyp) — js/monattk_data.js:491 owns it, but it
// keys off ptr.pmidx and a pet's data carries a non-makemon index
// ([[pet-pmidx-convention-mismatch]]), so route through the species NAME the
// way js/mhitm.js permonst() does.
async function dmgtype_st(ptr, dtyp) {
    const nm = ptr?.name;
    if (!nm) return false;
    const { name_to_pmidx, monster_by_pmidx } = await import('./makemon.js');
    const { dmgtype } = await import('./monattk_data.js');
    const idx = name_to_pmidx(nm);
    return idx >= 0 ? dmgtype(monster_by_pmidx(idx), dtyp) : false;
}
// C ref: shk.c subfrombill(obj, shkp) — needs the shop bill; loaded lazily
// because js/shk.js is heavy and steal.js is on the monster-move path.
async function subfrombill_st(obj) {
    const { subfrombill } = await import('./shk.js');
    const { shop_keeper } = await import('./shkroom.js');
    subfrombill(obj, shop_keeper((game.u?.ushops || '')[0]));
}

// C ref: steal.c:689 stealamulet(mtmp) — the AD_SAMU theft (the Wizard and the
// quest nemeses).  Quest artifacts first (randomly among several), then the
// Amulet / Bell / Book / Candelabrum, taking off whatever covers the target.
export async function stealamulet(mtmp) {
    const u = game.u;
    const inv = inventoryArray_st();
    let otmp = null, obj = null, real = 0, fake = 0, n = 0;

    /* target every quest artifact, not just current role's; if hero has more
       than one, choose randomly so that player can't use inventory ordering
       to influence the theft */
    for (obj of inv)
        if (any_quest_artifact_st(obj)) { ++n; otmp = obj; }
    if (n > 1) {
        n = rnd(n);
        for (const o of inv)
            if (any_quest_artifact_st(o) && !--n) { otmp = o; break; }
    }

    if (!otmp) {
        /* if we didn't find any quest artifact, find another valuable item */
        if (u.uhave?.amulet) {
            real = AMULET_OF_YENDOR;
            fake = FAKE_AMULET_OF_YENDOR;
        } else if (u.uhave?.bell) {
            real = BELL_OF_OPENING;
            fake = BELL_ST;
        } else if (u.uhave?.book) {
            real = SPE_BOOK_OF_THE_DEAD;
        } else if (u.uhave?.menorah) {
            real = CANDELABRUM_OF_INVOCATION;
        } else {
            return; /* you have nothing of special interest */
        }

        /* If we get here, real and fake have been set up. */
        n = 0;
        for (obj of inv)
            if (obj.otyp === real || (obj.otyp === fake && !mtmp.iswiz)) {
                ++n; otmp = obj;
            }
        if (n > 1) {
            n = rnd(n);
            for (const o of inv)
                if ((o.otyp === real || (o.otyp === fake && !mtmp.iswiz))
                    && !--n) { otmp = o; break; }
        }
    }

    if (otmp) { /* we have something to snatch */
        /* take off outer gear if we're targeting [hypothetical] quest
           artifact suit, shirt, gloves, or rings */
        if ((otmp === game.uarm || otmp === game.uarmu) && game.uarmc)
            await worn_item_removal(mtmp, game.uarmc);
        if (otmp === game.uarmu && game.uarm)
            await worn_item_removal(mtmp, game.uarm);
        if ((otmp === game.uarmg
             || ((otmp === game.uright || otmp === game.uleft) && game.uarmg))
            && game.uwep) {
            /* gloves are about to be unworn; unwield weapon(s) first */
            if (game.u?.twoweap)  /* remove_worn_item(uswapwep) indirectly */
                await worn_item_removal(mtmp, game.uswapwep);
            await worn_item_removal(mtmp, game.uwep);
        }
        if ((otmp === game.uright || otmp === game.uleft) && game.uarmg)
            /* calls Gloves_off() to handle wielded cockatrice corpse */
            await worn_item_removal(mtmp, game.uarmg);

        /* finally, steal the target item */
        if (otmp.owornmask)
            await worn_item_removal(mtmp, otmp);
        if (otmp.unpaid) await subfrombill_st(otmp);
        freeinv(otmp);
        const buf = doname_invent(otmp);
        mpickobj(mtmp, otmp);  /* could merge and free otmp but won't */
        await update_topl(`${Some_Monnam(mtmp)} steals ${buf}!`);
        {
            const { tele_restrict, rloc } = await import('./teleport.js');
            if (can_teleport_flag(mtmp.data) && !tele_restrict(mtmp))
                await rloc(mtmp, /*RLOC_MSG*/ 1);
        }
        await encumber_msg();
    }
}

// C ref: steal.c:772 maybe_absorb_item(mon, obj, ochance, achance) — a poked
// mimic may take the thing that poked it.  ochance/achance are PERCENT chances
// for an ordinary item / an artifact, inverted for obj_resists().
export async function maybe_absorb_item(mon, obj, ochance, achance) {
    const { obj_resists } = await import('./zap.js');
    const { touch_artifact } = await import('./artifact.js');

    if (obj === game.uball || obj === game.uchain || obj.oclass === ROCK_CLASS
        || obj_resists(obj, 100 - ochance, 100 - achance)
        || !touch_artifact(obj, mon))
        return;

    if (carried_st(obj)) {
        if (obj.owornmask)
            await remove_worn_item(obj, true);
        if (obj.unpaid) await subfrombill_st(obj);
        if (cansee(mon.mx, mon.my)) {
            /* Some_Monnam() avoids "It pulls ... and absorbs it!" if the hero
               can see the location but not the monster */
            await update_topl(`${Some_Monnam(mon)} pulls ${yname_st(obj)} away`
                + ` from you and absorbs ${(obj.quan | 0) > 1 ? 'them' : 'it'}!`);
        } else {
            const { body_part, makeplural, otense } = await import('./invent.js');
            let hand_s = body_part(HAND_ST);
            if (bimanual_st(obj)) hand_s = makeplural(hand_s);
            await update_topl(`${upstart_st(yname_st(obj))} ${
                otense(obj, 'are')} pulled from your ${hand_s}!`);
        }
        freeinv(obj);
        await encumber_msg();
    } else {
        /* not carried; presumably thrown or kicked */
        if (canspotmon(mon))
            await update_topl(`${Monnam(mon)} absorbs ${yname_st(obj)}!`);
    }
    /* add to mon's inventory */
    mpickobj(mon, obj);
}

// C ref: obj.h carried(obj) — obj->where == OBJ_INVENT.
function carried_st(obj) {
    return obj?.where === 'invent' || inventoryArray_st().includes(obj);
}
// C ref: objclass.h bimanual(otmp) — objects[].oc_bimanual.  The file already
// carries a FALSE stub for the animal-thief path; this reads the real flag when
// the port's objects[] row exposes it.
function bimanual_st(obj) { return !!objects[obj?.otyp]?.bimanual; }
// C ref: do_name.c yname(obj) — "your <obj>".  The file's private yname() is
// the same reduced form; reuse rather than adding a third.
function yname_st(obj) { return `your ${objects[obj?.otyp]?.name || 'thing'}`; }

// C ref: steal.c:852 mdrop_special_objs(mon) — a monster about to bypass the
// normal level-change rules must leave the Amulet, the invocation items and the
// current role's quest artifact behind.
export async function mdrop_special_objs(mon) {
    const { obj_resists } = await import('./zap.js');
    const { rloco } = await import('./teleport.js');

    for (const obj of (mon.minvent || []).slice()) {  /* C: otmp = obj->nobj */
        /* the Amulet, invocation tools, and Rider corpses resist even when
           artifacts and ordinary objects are given 0% resistance chance;
           current role's quest artifact is rescued too--quest artifacts
           for the other roles are not */
        if (obj_resists(obj, 0, 0) || is_quest_artifact_st(obj)) {
            if (mon.mx) {
                await mdrop_obj_st(mon, obj, false);
            } else { /* migrating monster not on map */
                extract_from_minvent_st(mon, obj, true, true);
                await rloco(obj);
            }
        }
    }
}

// C ref: steal.c:814 mdrop_obj(mon, obj, verbosely) — the faithful port is
// PRIVATE at js/dogmove.js:940 (a pet dropping loot).  This adapter is the
// no-message subset mdrop_special_objs() needs; the fix is to export the
// original, not to grow this one.
async function mdrop_obj_st(mon, obj, verbosely) {
    const omx = mon.mx, omy = mon.my;
    const unwornmask = obj.owornmask | 0;

    extract_from_minvent_st(mon, obj, false, true);
    /* don't charge for an owned saddle on a dead steed */
    if (unwornmask && mon.mtame && (unwornmask & W_SADDLE) !== 0 && !obj.unpaid)
        obj.no_charge = 1;
    if (verbosely && cansee(omx, omy))
        await update_topl(`${Monnam(mon)} drops ${doname_invent(obj)}.`);
    const { flooreffects } = await import('./do.js');
    if (!await flooreffects(obj, omx, omy, 'fall')) {
        const { stackobj } = await import('./invent.js');
        place_object(obj, omx, omy);
        stackobj(obj);
    }
    /* C also calls update_mon_extrinsics(mon, obj, FALSE, TRUE) here, after the
       object is on the floor (removing a steed's saddle throws the rider); that
       function has no port. */
}

// C ref: mon.c extract_from_minvent(mon, obj, do_intrinsics, silently) — no
// port; the list-unlink half is all mdrop_special_objs() needs.
function extract_from_minvent_st(mon, obj, _do_intrinsics, _silently) {
    const inv = mon.minvent || [];
    const i = inv.indexOf(obj);
    if (i >= 0) inv.splice(i, 1);
    obj.owornmask = 0;
    obj.where = 'free';
    obj.ocarry = null;
}
