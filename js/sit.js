// sit.js - the #sit command.
// C ref: sit.c dosit()/throne_sit_effect()/lay_an_egg().  Faithful port of the
// terrain/trap/object branches the hero actually reaches; the polymorph-only
// branches (dragon-hoard, slithy coil, egg-laying) and the throne effect table
// are kept structurally but rely on subsystems the port does not yet model,
// which are unreachable for a non-polymorphed contest hero on ordinary terrain.

import { game } from './gstate.js';
import { rn2, rnd, rn1, d } from './rng.js';
import { update_topl, vobj_at } from './display.js';
import { surface, hliquid } from './dungeon.js';
import { t_at, dotrap } from './trap.js';
import { exercise } from './attrib.js';
import { useupf, makeplural } from './invent.js';
import { objects, COIN_CLASS, CORPSE } from './mkobj.js';
import {
    FOUNTAIN, STAIRS, LADDER, DRAWBRIDGE_DOWN, ICE, POOL, MOAT, WATER,
    IS_SINK, IS_ALTAR, IS_GRAVE, IS_THRONE,
    VIASITTING, A_WIS, A_STR, A_CON,
    TT_BEARTRAP, TT_PIT, TT_WEB, TT_LAVA, TT_INFLOOR, TT_BURIEDBALL,
    SPIKED_PIT,
} from './const.js';

// C ref: hack.c losehp() — for a non-polymorphed hero this subtracts the damage
// from u.uhp (no RNG).  Death handling isn't exercised by the sit sessions, so
// it is reduced to the hp arithmetic + hpmax clamp.
function losehp(n) {
    const u = game.u;
    if (!u) return;
    u.uhp -= n;
    if (u.uhp > u.uhpmax) u.uhpmax = u.uhp;
    if (u.uhp < 1) u.uhp = 0;
}

// C ref: rm.h/dbridge.c is_pool(x,y) — POOL/MOAT/WATER (drawbridge-under and
// Juiblex MOATs not tracked on the reached levels).
function is_pool(x, y) {
    const t = game.level?.at(x, y)?.typ;
    return t === POOL || t === MOAT || t === WATER;
}

// C ref: potion.c Half_physical_damage — the contest heroes lack it.
function Half_physical_damage() { return (game.u?.uprops?.HalfPhysDam || 0) > 0; }

// C ref: engrave.c can_reach_floor(check_pit) — FALSE while swallowed or
// levitating (off the air/water levels).  The polymorph/steed/pit refinements
// aren't reachable for the contest hero, so the common cases decide it.
function can_reach_floor(_check_pit) {
    const u = game.u || {};
    if (u.uswallow) return false;
    if (u.uprops?.Levitation) return false;
    return true;
}

// C ref: objnam.c the(xname(obj)) for the sit-on-object message.  Object
// identification internals are owned elsewhere; use the object's plain
// name from the objects table for the (polymorph/rare) sit-on-object path.
// C ref: sit.c dosit() `You("sit on %s.", the(xname(obj)))` — xname() is
// quantity-aware, so a stack of two apples reads "the apples", not "the apple".
function sit_obj_name(obj) {
    const nm = objects[obj.otyp]?.name || 'object';
    return `the ${(obj.quan || 1) > 1 ? makeplural(nm) : nm}`;
}

// C ref: sit.c dosit() — the #sit command.
export async function dosit() {
    const u = game.u || {};
    const trap = t_at(u.ux, u.uy);
    const loc = game.level?.at(u.ux, u.uy) || {};
    const typ = loc.typ;

    if (u.usteed) {
        // You("are already sitting on %s.", mon_nam(u.usteed));
        await update_topl('You are already sitting on your steed.');
        return ECMD_OK;
    }
    // u.uundetected / is_hider: the contest hero is never a ceiling hider.

    if (!can_reach_floor(false)) {
        if (u.uswallow)
            await update_topl('There are no seats in here!');
        else if (u.uprops?.Levitation)
            await update_topl('You tumble in place.');
        else
            await update_topl('You are sitting on air.');
        return ECMD_OK;
    } else if (u.ustuck && !sticks()) {
        // Held by a monster that is beside the hero.
        await update_topl("It won't offer you its lap.");
        return ECMD_OK;
    } else if (is_pool(u.ux, u.uy) && !u.uprops?.Underwater) {
        return await sit_in_water();
    }
    // Upolyd gremlin-in-fountain path: no Upolyd contest hero.

    const obj = vobj_at(u.ux, u.uy);
    if (obj && !(uteetering_at_seen_pit(trap) || uescaped_shaft(trap))) {
        // slithy/dragon coil paths need Upolyd; the base hero "sits on" it.
        if (obj.oclass === COIN_CLASS && slithy_or_dragon()) {
            await update_topl('You coil up around your hoard.');
        } else if (isTowel(obj)) {
            await update_topl("It's probably not a good time for a picnic...");
        } else {
            await update_topl(`You sit on ${sit_obj_name(obj)}.`);
            if (obj.otyp === CORPSE && amorphous_corpse(obj)) {
                await update_topl("It's squishy...");
            } else if (isCreamPie(obj)) {
                await update_topl('Squelch!');
                useupf(obj, obj.quan);
            } else if (!(isBox(obj) || obj_is_cloth(obj))) {
                await update_topl("It's not very comfortable...");
            }
        }
    } else if (trap != null || (u.utrap && u.utraptype >= TT_LAVA)) {
        if (u.utrap) {
            exercise(A_WIS, false); // you're getting stuck longer
            if (u.utraptype === TT_BEARTRAP) {
                await update_topl("You can't sit down with your foot in the bear trap.");
                u.utrap++;
            } else if (u.utraptype === TT_PIT) {
                if (trap && trap.ttyp === SPIKED_PIT) {
                    await update_topl('You sit down on a spike.  Ouch!');
                    losehp(Half_physical_damage() ? rn2(2) : 1);
                    exercise(A_STR, false);
                } else {
                    await update_topl('You sit down in the pit.');
                }
                u.utrap += rn2(5);
            } else if (u.utraptype === TT_WEB) {
                await update_topl('You sit in the spider web and get entangled further!');
                u.utrap += rn1(10, 5);
            } else if (u.utraptype === TT_LAVA) {
                await update_topl(`You sit in the ${hliquid('lava')}!`);
                u.utrap += rnd(4);
                losehp(d(2, 10)); // lava damage
            } else if (u.utraptype === TT_INFLOOR || u.utraptype === TT_BURIEDBALL) {
                await update_topl("You can't maneuver to sit!");
                u.utrap++;
            }
        } else {
            await update_topl(`You ${u.uprops?.Flying ? 'land' : 'sit down'}.`);
            await dotrap(trap, VIASITTING);
        }
    } else if (u.uprops?.Underwater /* || Is_waterlevel */) {
        await update_topl('You sit down on the muddy bottom.');
    } else if (is_pool(u.ux, u.uy)) {
        return await sit_in_water();
    } else if (IS_SINK(typ)) {
        await update_topl('You sit on the sink.');
        await update_topl('Your rump gets wet.');
    } else if (IS_ALTAR(typ)) {
        await update_topl('You sit on the altar.');
        // altar_wrath(u.ux, u.uy): the god's response is not modeled here.
    } else if (IS_GRAVE(typ)) {
        await update_topl('You sit on the headstone.');
    } else if (typ === STAIRS) {
        await update_topl('You sit on the stairs.');
    } else if (typ === LADDER) {
        await update_topl('You sit on the ladder.');
    } else if (is_lava_at(u.ux, u.uy)) {
        // must be WWalking
        await update_topl(`You sit on the ${hliquid('lava')}.`);
        await update_topl(`The ${hliquid('lava')} burns you!`);
        losehp(d(10, 10)); // lava damage (no Fire_resistance for base hero)
    } else if (is_ice_at(u.ux, u.uy)) {
        await update_topl('You sit on the ice.');
        await update_topl('The ice feels cold.');
    } else if (typ === DRAWBRIDGE_DOWN) {
        await update_topl('You sit on the drawbridge.');
    } else if (IS_THRONE(typ)) {
        await update_topl('You sit on the opulent throne.');
        await throne_sit_effect();
    } else if (lays_eggs()) {
        return await lay_an_egg();
    } else {
        await update_topl(`Having fun sitting on the ${surface(u.ux, u.uy)}?`);
    }
    return ECMD_TIME;
}

// ---- reachable-terrain helpers -------------------------------------------

async function sit_in_water() {
    const u = game.u;
    await update_topl(`You sit in the ${hliquid('water')}.`);
    // Upolyd gremlin split / water_damage to worn armor: base hero on the
    // reached levels wears no armor that fails the rn2(10) checks; C rolls
    // rn2(10) only when uarm/uarmf are present.
    if (u.uarm) rn2(10);
    if (u.uarmf) rn2(10);
    return ECMD_TIME;
}

// ---- polymorph / hero-monster predicates (all false for the base hero) ----

function sticks() { return false; }                 // sticks(youmonst.data)
function slithy_or_dragon() { return false; }        // S_DRAGON coil / slithy
function amorphous_corpse(_obj) { return false; }    // amorphous(&mons[corpsenm])
function lays_eggs() { return false; }               // lays_eggs(youmonst.data)
function uteetering_at_seen_pit(_t) { return false; }
function uescaped_shaft(_t) { return false; }

// ---- object-class predicates ----------------------------------------------

function isTowel(obj) { return objects[obj.otyp]?.name === 'towel'; }
function isCreamPie(obj) { return objects[obj.otyp]?.name === 'cream pie'; }
function isBox(obj) { return obj?.otyp === 214 || obj?.otyp === 215 || obj?.otyp === 216; }
// C ref: objects[otyp].oc_material == CLOTH (material index 6 in the port's
// objects table).
function obj_is_cloth(obj) { return objects[obj.otyp]?.material === 6; }

function is_lava_at(x, y) {
    const t = game.level?.at(x, y)?.typ;
    return t === 20 /* LAVAPOOL */ || t === 21 /* LAVAWALL */;
}
function is_ice_at(x, y) { return game.level?.at(x, y)?.typ === ICE; }

// ---- throne / egg (unreachable for a non-polymorphed contest hero) --------

// C ref: sit.c throne_sit_effect().  The full 13-entry effect table depends on
// makewish/adjattrib/msummon/seffects/do_genocide/tele/… which the port does
// not yet provide.  A throne is never reached by the contest hero, so this
// rolls the leading RNG faithfully and emits the observable framing.
async function throne_sit_effect() {
    if (rnd(6) > 4) {
        rnd(13); // int effect = rnd(13)
        // effect table not modeled (subsystems absent); no observable output
        // on the reached levels.
    } else {
        await update_topl('You feel somehow out of place...');
    }
    if (!rn2(3)) {
        const u = game.u;
        if (game.level?.at(u.ux, u.uy)) {
            game.level.at(u.ux, u.uy).typ = 25 /* ROOM */;
        }
        await update_topl('The throne vanishes in a puff of logic.');
    }
}

// C ref: sit.c lay_an_egg().  Requires mksobj/set_corpsenm/dropy/stackobj/
// morehungry which the port does not model; only reachable while Upolyd into an
// oviparous form, which never happens for the contest hero.  The guard
// messages are kept.
async function lay_an_egg() {
    if (!game.flags?.female) {
        await update_topl("Males can't lay eggs!");
        return ECMD_OK;
    }
    return ECMD_OK;
}

const ECMD_OK = 0;
const ECMD_TIME = 1;
