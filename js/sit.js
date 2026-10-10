// sit.js - the #sit command.
// C ref: sit.c dosit()/throne_sit_effect()/special_throne_effect()/take_gold()/
// lay_an_egg().  Full port including the 13-entry throne effect table.

import { game, hooks } from './gstate.js';
import { rn2, rnd, rn1, d } from './rng.js';
import { update_topl, vobj_at, Hallucination_u, You_feel, map_background, newsym, y_n } from './display.js';
import { cansee, Blind } from './vision.js';
import { adjattrib } from './attrib.js';
import { mflags2_of, M2_PRINCE } from './monflags_data.js';
import { SPBOOK_CLASS, EGG, mksobj, weight, set_corpsenm } from './mkobj.js';
import { dropy, stackobj } from './invent.js';
import { surface, hliquid } from './dungeon.js';
import { t_at, dotrap, water_damage } from './trap.js';
import { exercise } from './attrib.js';
import { useupf, youmonst_data_pub } from './invent.js';
import { In_V_tower, Is_waterlevel, ROOM, A_MAX, INTRINSIC, FROMOUTSIDE, SICK_ALL, NO_MM_FLAGS, UTOTYPE_NONE, KILLED_BY_AN, EYE, HEAD } from './const.js';
import { mflags1_of, M1_SLITHY, M1_OVIPAROUS, M1_SWIM, M1_FLY, M1_AMPHIBIOUS, M1_BREATHLESS } from './monflags_data.js';
import { objects, COIN_CLASS, CORPSE, WATER_WALKING_BOOTS } from './mkobj.js';
import { xname_flags } from './objnam.js';
import { name_to_pmidx } from './makemon.js';
import {
    FOUNTAIN, STAIRS, LADDER, DRAWBRIDGE_DOWN, ICE, POOL, MOAT, WATER,
    IS_SINK, IS_ALTAR, IS_GRAVE, IS_THRONE, CXN_NORMAL,
    VIASITTING, A_WIS, A_STR, A_CON,
    TT_BEARTRAP, TT_PIT, TT_WEB, TT_LAVA, TT_INFLOOR, TT_BURIEDBALL,
    SPIKED_PIT,
} from './const.js';

// C ref: hack.c losehp(n, knam, k_format) — do.js owns the complete port
// (death path, killer text, polymorph arm).
async function losehp(n, knam, k_format) {
    const { losehp: losehp_zap } = await import('./zap.js');
    await losehp_zap(n, knam, k_format);
}

function change_luck_sit(n) {
    const u = game.u;
    if (u) u.uluck = (u.uluck | 0) + n;
}
function make_confused_sit(xtime) {
    const u = game.u;
    if (!u) return;
    (u.uprops ||= {}).Confusion = xtime;
    u.uconf = xtime > 0;
}

// C ref: rm.h/dbridge.c is_pool(x,y) — POOL/MOAT/WATER (drawbridge-under and
// Juiblex MOATs not tracked on the reached levels).
function is_pool(x, y) {
    const t = game.level?.at(x, y)?.typ;
    return t === POOL || t === MOAT || t === WATER;
}

// C ref: potion.c Half_physical_damage — the contest heroes lack it.
function Half_physical_damage() { return (game.u?.uprops?.HalfPhysDam || 0) > 0; }

// C ref: objnam.c:1290 the(str) — an already-capitalised name is a proper noun
// and takes no article.
function the(s) { return /^[A-Z]/.test(String(s)) ? String(s) : `the ${s}`; }

// C ref: sit.c:453 dosit() `You("sit on %s.", the(xname(obj)))`.  Reading
// objects[otyp].name here instead leaked the true type of an unidentified
// object ("the tin whistle" for what C calls "the whistle"); xname() applies
// the identification rules and pluralizes a stack on its own.
function sit_obj_name(obj) {
    return the(xname_flags(obj, CXN_NORMAL));
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

    if (!(await import('./engrave.js')).can_reach_floor(false)) {
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
    } else if ((is_pool(u.ux, u.uy) && !u.uprops?.Underwater)
               || (u.Upolyd && u.umonnum === name_to_pmidx('gremlin')
                   && (typ === FOUNTAIN || is_pool(u.ux, u.uy)))) {
        return await sit_in_water();
    }

    const obj = vobj_at(u.ux, u.uy);
    if (obj && !(uteetering_at_seen_pit(trap) || uescaped_shaft(trap))) {
        if (obj.oclass === COIN_CLASS && is_dragon_form()) {
            // C: obj->quan + money_cnt(invent) < u.ulevel * 1000 -> "meager "
            let gold = 0;
            for (const o of (game.invent || [])) if (o?.oclass === COIN_CLASS) gold += o.quan || 0;
            await update_topl(`You coil up around your ${
                ((obj.quan || 1) + gold < (u.ulevel || 1) * 1000) ? 'meager ' : ''}hoard.`);
        } else if (isTowel(obj)) {
            await update_topl("It's probably not a good time for a picnic...");
        } else {
            await update_topl(`You ${is_slithy_form() ? 'coil up around' : 'sit on'} ${sit_obj_name(obj)}.`);
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
                    await losehp(Half_physical_damage() ? rn2(2) : 1,
                                 'sitting on an iron spike', 1 /* KILLED_BY */);
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
                await losehp(d(2, 10), 'sitting in lava', 1 /* KILLED_BY */); // lava damage
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
        await (await import('./dokick.js')).altar_wrath(u.ux, u.uy);
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
        {
            const { Fire_resistance } = await import('./zap.js');
            await losehp(d(Fire_resistance() ? 2 : 10, 10), 'sitting on lava',
                         1 /* KILLED_BY */); // lava damage
        }
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
    if (u.Upolyd && u.umonnum === name_to_pmidx('gremlin')) {
        if (await (await import('./potion.js')).split_mon(game.youmonst || u, null)) {
            if (game.level?.at(u.ux, u.uy)?.typ === FOUNTAIN)
                await (await import('./fountain.js')).dryup(u.ux, u.uy, true);
        }
    } else {
        if (!rn2(10) && game.uarm) await water_damage(game.uarm, 'armor', true);
        // C sit.c intentionally damages the suit again in its boots branch.
        if (!rn2(10) && game.uarmf && game.uarmf.otyp !== WATER_WALKING_BOOTS)
            await water_damage(game.uarm, 'armor', true);
    }
    return ECMD_TIME;
}

// ---- polymorph / hero-monster predicates (all false for the base hero) ----

function sticks() { return false; }                 // sticks(youmonst.data)
function is_dragon_form() { return youmonst_data_pub()?.mlet === 'D'; }   // S_DRAGON
function is_slithy_form() { return (mflags1_of(youmonst_data_pub()) & M1_SLITHY) !== 0; }
function amorphous_corpse(_obj) { return false; }    // amorphous(&mons[corpsenm])
function lays_eggs() { return (mflags1_of(youmonst_data_pub()) & M1_OVIPAROUS) !== 0; }
function is_vampire_form() { return youmonst_data_pub()?.mlet === 'V'; }   // is_vampire(youmonst.data)
// C ref: mondata.h eggs_in_water(ptr).
function eggs_in_water(ptr) {
    const f = mflags1_of(ptr);
    return (f & M1_OVIPAROUS) !== 0 && (f & M1_SWIM) !== 0 && (f & M1_FLY) === 0
        && ptr?.mlet !== 'e' && (f & M1_AMPHIBIOUS) === 0 && (f & M1_BREATHLESS) === 0;
}
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

// ---- throne / egg ----------------------------------------------------------

// C ref: sit.c take_gold() — take away the hero's money.
export async function take_gold() {
    let lost_money = false;
    for (const otmp of [...(game.invent || [])]) {
        if (otmp?.oclass === COIN_CLASS) {
            lost_money = true;
            const { remove_worn_item, delobj } = await import('./invent.js');
            await remove_worn_item(otmp, false);
            delobj(otmp);
        }
    }
    if (!lost_money) {
        await You_feel('a strange sensation.');
    } else {
        await update_topl('You notice you have no gold!');
        game.botl = true;
    }
}

function Luck_sit() { return (game.u?.uluck | 0) + (game.u?.moreluck | 0); }

// C ref: sit.c special_throne_effect(effect) — the Vlad's Tower throne.
async function special_throne_effect(effect) {
    const u = game.u;
    const tx = u.ux, ty = u.uy;
    switch (effect) {
    case 1: case 2: case 3: case 4: {
        /* 4 chances of a wish, but then the throne disappears. */
        const { makewish } = await import('./extcmd-handlers.js');
        await makewish();
        const loc = game.level?.at(tx, ty);
        if (loc) { loc.typ = ROOM; loc.flags = 0; }
        map_background(tx, ty, false);
        newsym(tx, ty);
        await update_topl('The throne disintegrates, having spent its power.');
        break;
    }
    case 5: {
        /* permanent level drain */
        await update_topl('Sitting on the throne was a terrible experience.');
        const { Drain_resistance } = await import('./zap.js');
        if (!Drain_resistance()) {
            const { losexp } = await import('./exper.js');
            await losexp('a bad experience sitting on a throne');
            if ((u.ulevelmax || 0) > u.ulevel) u.ulevelmax -= 1;
        }
        break;
    }
    case 6: {
        /* grease hands and inventory (grease_ok in apply.c) */
        await update_topl('A greasy liquid sprays all over you!');
        for (const otmp of (game.invent || []))
            if (otmp.oclass !== COIN_CLASS) otmp.greased = 1;
        const { make_glib } = await import('./potion.js');
        await make_glib(rn1(101, 100));
        const { update_inventory } = await import('./invent.js');
        update_inventory();
        break;
    }
    case 7: {
        /* lose an intrinsic */
        const { attrcurse } = await import('./pray.js');
        await attrcurse();
        await update_topl('The throne somehow seems to be amused.');
        break;
    }
    case 8: {
        /* level teleport to Vibrating Square level */
        const { find_hell } = await import('./dungeon.js');
        const vs_level = find_hell();
        const nl = game.dungeons?.[vs_level.dnum]?.num_dunlevs;
        vs_level.dlevel = nl - 1;
        if (u.uhave?.amulet) {
            await You_feel('extremely disoriented for a moment.');
        } else {
            const { schedule_goto } = await import('./do.js');
            schedule_goto(vs_level, UTOTYPE_NONE, null, 'You feel extremely out of place.');
        }
        break;
    }
    case 9: {
        /* summon demons as though by the Wizard of Yendor */
        await update_topl('The throne seeems to be calling for help!');
        const { msummon } = await import('./minion.js');
        await msummon(null);
        await msummon(null);
        await msummon(null);
        break;
    }
    case 10: {
        /* confused blessed remove curse effect */
        const fake_spellbook = { otyp: SPE_REMOVE_CURSE, oclass: SPBOOK_CLASS, blessed: 1,
                                 cursed: 0, quan: 1, spe: 0 };
        const save_confusion = u.uprops?.Confusion || 0;
        (u.uprops ||= {}).Confusion = 1;
        const { seffects } = await import('./read.js');
        await seffects(fake_spellbook);
        u.uprops.Confusion = save_confusion;
        break;
    }
    case 11: {
        /* polymorph effect (not blocked by magic resistance) */
        if (is_vampire_form()) {
            await You_feel('unworthy.');
        } else {
            await update_topl('This throne was not meant for those such as you!');
            await You_feel('a change coming over you.');
            const { polyself } = await import('./polyself.js');
            await polyself(0 /* POLY_NOFLAGS */);
        }
        break;
    }
    case 12: {
        /* acid damage */
        await update_topl('The throne is covered in acid!');
        const { Acid_resistance } = await import('./explode.js');
        await losehp(Acid_resistance() ? rnd(16) : rnd(80), 'acidic chair', KILLED_BY_AN);
        exercise(A_CON, false);
        break;
    }
    case 13: {
        /* ability shuffle */
        await update_topl('As you sit on the throne, your body and mind start to warp.');
        for (let ability = 0; ability < A_MAX; ++ability)
            await adjattrib(ability, rn2(5) - 2, -1);
        break;
    }
    default: break;
    }
}

// C ref: sit.c throne_sit_effect() — maybe do something when hero sits on a throne.
async function throne_sit_effect() {
    const u = game.u;
    const tx = u.ux, ty = u.uy;
    const special_throne = !!In_V_tower(u.uz);

    if (rnd(6) > 4) { /* [same as '!rn2(3)'] */
        let effect = rnd(13);

        if (game.flags?.debug && !game.iflags?.debug_fuzzer) {
            const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
            const raw = await hooked_tty_getlin('Throne sit effect (1..13) [0=random]', null);
            const buf = String(raw ?? '\x1b');
            if (buf[0] === '\x1b') {
                await update_topl('Never mind.');
                return; /* caller will still cause a move to elapse */
            }
            const which = parseInt(buf, 10) || 0;
            if (which >= 1 && which <= 13) effect = which;
        }

        if (special_throne) {
            await special_throne_effect(effect);
            return;
        }

        switch (effect) {
        case 1:
            await adjattrib(rn2(A_MAX), -rn1(4, 3), 0);
            await losehp(rnd(10), 'cursed throne', KILLED_BY_AN);
            break;
        case 2:
            await adjattrib(rn2(A_MAX), 1, 0);
            break;
        case 3: {
            const { Shock_resistance } = await import('./explode.js');
            const sr = Shock_resistance();
            await update_topl(`A${sr ? 'n' : ' massive'} electric shock shoots through your body!`);
            await losehp(sr ? rnd(6) : rnd(30), 'electric chair', KILLED_BY_AN);
            exercise(A_CON, false);
            break;
        }
        case 4: {
            await You_feel('much, much better!');
            if (u.Upolyd || u.mtimedone) {
                if (u.mh >= (u.mhmax - 5)) u.mhmax += 4;
                u.mh = u.mhmax;
            }
            if (u.uhp >= (u.uhpmax - 5)) {
                u.uhpmax += 4;
                if (u.uhpmax > u.uhppeak) u.uhppeak = u.uhpmax;
            }
            u.uhp = u.uhpmax;
            u.ucreamed = 0;
            const { make_blinded_hero, make_sick } = await import('./potion.js');
            await make_blinded_hero(0, true);
            await make_sick(0, null, false, SICK_ALL);
            const { heal_legs } = await import('./trap.js');
            await heal_legs(0);
            game.botl = true;
            break;
        }
        case 5:
            await take_gold();
            break;
        case 6:
            if (Luck_sit() + rn2(5) < 0) {
                await You_feel('your luck is changing.');
                change_luck_sit(1);
            } else {
                const { makewish } = await import('./extcmd-handlers.js');
                await makewish();
            }
            break;
        case 7: {
            const cnt0 = rnd(10);
            let cnt = cnt0;
            /* Magical voice not affected by deafness */
            await update_topl('A voice echoes:');
            await update_topl(`"Thine audience hath been summoned, ${game.flags?.female ? 'Dame' : 'Sire'}!"`);
            const { courtmon } = await import('./sp_lev.js');
            const { makemon } = await import('./makemon.js');
            while (cnt--)
                await makemon(courtmon(), tx, ty, NO_MM_FLAGS);
            break;
        }
        case 8:
            await update_topl('A voice echoes:');
            await update_topl(`"By thine Imperious order, ${game.flags?.female ? 'Dame' : 'Sire'}..."`);
            {
                const { do_genocide } = await import('./read.js');
                await do_genocide(5); /* REALLY|ONTHRONE */
            }
            break;
        case 9:
            await update_topl('A voice echoes:');
            await update_topl('"A curse upon thee for sitting upon this most holy throne!"');
            if (Luck_sit() > 0) {
                const { make_blinded_hero, BlindedTimeout } = await import('./potion.js');
                await make_blinded_hero(BlindedTimeout() + rn1(100, 250), true);
                change_luck_sit((Luck_sit() > 1) ? -rnd(2) : -1);
            } else {
                const { rndcurse } = await import('./pray.js');
                await rndcurse();
            }
            break;
        case 10: {
            const intr = (u.uprops?.HSee_invisible | 0) & INTRINSIC;
            if (Luck_sit() < 0 || intr) {
                if (game.level?.flags?.nommap) {
                    await update_topl('A terrible drone fills your head!');
                    make_confused_sit((u.uprops?.Confusion || 0) + rnd(30));
                } else {
                    await update_topl('An image forms in your mind.');
                    const { do_mapping } = await import('./detect.js');
                    await do_mapping();
                }
            } else {
                /* avoid "vision clears" if hero can't see */
                if (!Blind()) {
                    await update_topl('Your vision becomes clear.');
                } else {
                    const { eyecount, body_part } = await import('./polyself.js');
                    const { makeplural } = await import('./plural.js');
                    const num_of_eyes = eyecount(youmonst_data_pub());
                    let eye = body_part(EYE);
                    if (num_of_eyes >= 2) {
                        eye = makeplural(eye);
                        await update_topl(`Your ${eye} tingle...`);
                    } else if (num_of_eyes === 1) {
                        await update_topl(`Your ${eye} tingles...`);
                    } else {
                        await update_topl(`You have a very strange feeling in your ${body_part(HEAD)}.`);
                    }
                }
                (u.uprops ||= {}).HSee_invisible = ((u.uprops.HSee_invisible | 0) | FROMOUTSIDE);
                newsym(u.ux, u.uy);
            }
            break;
        }
        case 11:
            if (Luck_sit() < 0) {
                await You_feel('threatened.');
                const { aggravate } = await import('./monmove.js');
                aggravate();
            } else {
                await You_feel('a wrenching sensation.');
                const { tele } = await import('./zap.js');
                await tele(); /* teleport him */
            }
            break;
        case 12:
            await update_topl('You are granted an insight!');
            if ((game.invent || []).length) {
                /* rn2(5) agrees w/seffects() */
                const { identify_pack } = await import('./invent.js');
                await identify_pack(rn2(5), false);
            }
            break;
        case 13:
            await update_topl('Your mind turns into a pretzel!');
            make_confused_sit((u.uprops?.Confusion || 0) + rn1(7, 16));
            break;
        default:
            break;
        }
    } else {
        if ((youmonst_data_pub() && (mflags2_of(youmonst_data_pub()) & M2_PRINCE))
            || u.uevent?.uhand_of_elbereth)
            await You_feel('very comfortable here.');
        else
            await You_feel('somehow out of place...');
    }

    /* 5.0: when the random chance for removal is hit, ask for confirmation
       if in wizard mode, and remove the throne even if hero was teleported
       away from it. */
    if (!special_throne && !rn2(3)
        && (!game.flags?.debug || await y_n('Analyze throne?') === 'y')) {
        const loc = game.level?.at(tx, ty);
        if (loc) { loc.typ = ROOM; loc.flags = 0; }
        map_background(tx, ty, false);
        newsym(tx, ty);
        await update_topl(`The throne ${cansee(tx, ty) ? 'vanishes' : 'has vanished'} in a puff of logic.`);
    }
}

// C ref: sit.c lay_an_egg() — hero lays an egg.
async function lay_an_egg() {
    const u = game.u;
    if (!game.flags?.female) {
        await update_topl(`${Hallucination_u()
            ? 'You may think you are a platypus, but a male still'
            : 'Males'} can't lay eggs!`);
        return ECMD_OK;
    } else if ((u.uhunger ?? 900) < EGG_NUTRITION) {
        await update_topl("You don't have enough energy to lay an egg.");
        return ECMD_OK;
    } else if (eggs_in_water(youmonst_data_pub())) {
        if (!(u.uinwater || Is_waterlevel(u.uz))) {
            await update_topl('A splash tetra you are not.');
            return ECMD_OK;
        }
        if (u.Upolyd && (u.umonnum === name_to_pmidx('giant eel')
                         || u.umonnum === name_to_pmidx('electric eel'))) {
            await update_topl('You yearn for the Sargasso Sea.');
            return ECMD_OK;
        }
    }
    const uegg = mksobj(EGG, false, false);
    uegg.spe = 1;
    uegg.quan = 1;
    uegg.owt = weight(uegg);
    /* this sets hatch timers if appropriate */
    const { egg_type_from_parent } = await import('./mon.js');
    set_corpsenm(uegg, egg_type_from_parent(u.umonnum, false));
    uegg.known = 1;
    const { observe_object } = await import('./o_init.js');
    observe_object(uegg);
    await update_topl(`You ${eggs_in_water(youmonst_data_pub()) ? 'spawn' : 'lay'} an egg.`);
    await dropy(uegg);
    stackobj(uegg);
    const { morehungry } = await import('./eat.js');
    await morehungry(EGG_NUTRITION);
    return ECMD_TIME;
}

// objects.h FOOD("egg", ... 80 ...) oc_nutrition.
const EGG_NUTRITION = 80;
const SPE_REMOVE_CURSE = 395;
const ECMD_OK = 0;
const ECMD_TIME = 1;
