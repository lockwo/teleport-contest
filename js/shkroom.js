// shkroom.js — room-entry bookkeeping and the shop greeting.
// C ref: hack.c in_rooms()/move_update()/check_special_room(), shk.c
// u_entered_shop()/u_left_shop().
//
// u.ushops feeds shk_move()'s `avoid` decision (monmove.js), so this is RNG
// state, not just display: without it a shopkeeper picks a different square.

import { game } from './gstate.js';
import { roomAt } from './roomat.js';
import { s_suffix } from './hacklib.js';
import { pline, update_topl, Hallucination_u } from './display.js';
import { SHKNAME_POOL } from './shknam.js';
import { shtypes } from './shtypes.js';
import { Hello } from './role.js';
import { rn2, rnd } from './rng.js';
import { newomid } from './mkobj.js';
import { get_cost, get_pricing_units, contained_cost, contained_gold,
         bill_box_content, costly_gold, picked_container, is_unpaid, inhishop,
         inside_shop, rile_shk, rouse_shk, hot_pursuit, rob_shop, call_kops,
         pacify_shk, muteshk, Deaf, verbalize } from './shk.js';
import { makemon, monster_by_pmidx, enexto_spawn, name_to_pmidx } from './makemon.js';
import { builds_up, room_discovered } from './dungeon.js';
import { record_price_quote } from './o_init.js';
import { depth as depth_of_level, isok } from './hacklib.js';
import {
    ROOMOFFSET, NO_ROOM, SHARED, SHARED_PLUS, SHOPBASE, COLNO, ROWNO,
    TEMPLE, MORGUE, OROOM, MAXNROFROOMS, G_GONE,
    THRONE, ZOO, SWAMP, COURT, LEPREHALL, BEEHIVE, COCKNEST, ANTHOLE,
    BARRACKS, DELPHI, STEALTH, OBJ_FLOOR } from './const.js';
import { midnight } from './calendar.js';
import { Blind } from './vision.js';
import { has_innate } from './exper.js';
import { worn_extrinsic, worn_blocked } from './invent.js';

const PICK_AXE = 259, DWARVISH_MATTOCK = 71;
// C ref: youprop.h Stealth; polyself.c steed_vs_stealth().
export function Stealth() {
    const u = game.u;
    if (!u) return false;
    const p = u.uprops || {};
    const H = u.HStealth || u.uStealth || p.HStealth || p.Stealth
        || has_innate('HStealth');
    const E = u.EStealth || p.EStealth || worn_extrinsic(STEALTH);
    const B = u.BStealth || p.BStealth || worn_blocked(STEALTH)
        || (u.usteed && !p.Flying && !p.Levitation);
    return !!(H || E) && !B;
}

const IS_SHOP = (rt) => rt >= SHOPBASE;

function rtypeOf(rno) { return roomAt(rno)?.rtype ?? 0; }

// C ref: hack.c check_special_room():3737-3764 — the one-time special-room
// types are converted back to ordinary rooms as soon as their entry event
// fires, and when that was the level's LAST room of the type (C's
// search_special(rt)) the matching level flag is cleared too.  sounds.c reads
// those flags every turn to decide whether to roll the room's ambient noise,
// so a flag left set keeps drawing an rn2(200) C no longer draws: seed4500
// entered the Dlvl 7 throne room at step 914 and every later turn there cost
// us one extra rn2(200) (sounds.c:226).  Only MORGUE was listed here.
function retireSpecialRoom(rno, type) {
    const room = roomAt(rno);
    if (!room || room.rtype !== type) return;
    room.rtype = OROOM;
    const flagByType = {
        [COURT]: 'has_court', [SWAMP]: 'has_swamp', [MORGUE]: 'has_morgue',
        [ZOO]: 'has_zoo', [BARRACKS]: 'has_barracks', [BEEHIVE]: 'has_beehive',
        // C's clearing switch also lists TEMPLE, but its case falls through to
        // `default:` first and that sets rt = 0, so the TEMPLE arm is dead code
        // in C too ("temples should remain TEMPLEs") — omitted rather than
        // copied, since copying it would retire temples this port does enter.
    };
    const flag = flagByType[type];
    if (!flag || !game.level?.flags) return;
    const allRooms = [...(game.level.rooms || []), ...(game.level.subrooms || [])];
    if (!allRooms.some((candidate) => candidate?.rtype === type))
        game.level.flags[flag] = false;
}

// C ref: hack.c in_rooms(x, y, typewanted) — the room numbers covering (x,y),
// filtered by room type.  Returns C's buffer as an array of roomno values in
// C's order (each hit is PREPENDED, so it reads back-to-front of the scan).
export function in_rooms(x, y, typewanted) {
    const out = [];
    const loc = game.level?.at(x, y);
    if (!loc) return out;
    const goodtype = (rno) => {
        if (!typewanted) return true;
        const typefound = rtypeOf(rno);
        return typefound === typewanted
            || (typewanted === SHOPBASE && typefound > SHOPBASE);
    };
    let rno = loc.roomno ?? NO_ROOM;
    let step;
    if (rno === NO_ROOM) return out;
    if (rno === SHARED) step = 2;
    else if (rno === SHARED_PLUS) step = 1;
    else {
        if (goodtype(rno)) out.unshift(rno);
        return out;
    }

    let min_x = x - 1;
    let max_x = x + 1;
    if (x < 1) min_x += step;
    else if (x >= COLNO) max_x -= step;

    let min_y = y - 1, max_y_offset = 2;
    if (min_y < 0) { min_y += step; max_y_offset -= step; }
    else if ((min_y + max_y_offset) >= ROWNO) max_y_offset -= step;

    for (let sx = min_x; sx <= max_x; sx += step) {
        for (let dy = 0; dy <= max_y_offset; dy += step) {
            const l = game.level?.at(sx, min_y + dy);
            rno = l ? (l.roomno ?? NO_ROOM) : NO_ROOM;
            if (rno >= ROOMOFFSET && !out.includes(rno) && goodtype(rno))
                out.unshift(rno);
        }
    }
    return out;
}

// C ref: shk.c shop_keeper(rmno) — the resident shopkeeper of a room number.
export function shop_keeper(rno) {
    if (!(rno >= ROOMOFFSET)) return null;
    const shkp = roomAt(rno)?.resident || null;
    if (!shkp || (shkp.mhp != null && shkp.mhp <= 0)) return null;
    // C ref: shk.c shop_keeper() — an angry shopkeeper not yet surcharged is
    // riled the first time anything looks them up.
    if (shkp.eshk && !shkp.mpeaceful && !shkp.eshk.surcharge) rile_shk(shkp);
    return shkp;
}



// C ref: shknam.c shkname() — the personal name with its prefix character
// stripped ('+'/'-'/'|'/'_' encode gender in the shknms[] tables).
export function shkname(shkp) {
    let nm = shkp.eshk?.shknam;
    if (!nm) return shkp.data?.name || 'shopkeeper';
    if (Hallucination_u() && !game.program_state?.gameover) {
        /* count the number of non-unique shop types; pick one randomly,
           ignoring shop generation probabilities; pick a name at random
           from that shop type's list */
        let num;
        for (num = 0; num < shtypes.length; num++)
            if (shtypes[num].prob === 0) break;
        if (num > 0) {
            const nlp = SHKNAME_POOL[shtypes[rn2(num)].shknms] || [];
            if (nlp.length > 0) nm = nlp[rn2(nlp.length)];
        }
    }
    return /[A-Za-z]/.test(nm[0]) ? nm : nm.slice(1);
}


// C ref: hack.c move_update(newlev) — recompute u.urooms/u.ushops and the
// entered/left deltas for the hero's current square.
function move_update(newlev) {
    const u = game.u;
    u.urooms0 = u.urooms || [];
    u.ushops0 = u.ushops || [];
    if (newlev) {
        u.urooms = []; u.uentered = []; u.ushops = []; u.ushops_entered = [];
        u.ushops_left = u.ushops0.slice();
        return;
    }
    u.urooms = in_rooms(u.ux, u.uy, 0);
    u.uentered = []; u.ushops = []; u.ushops_entered = [];
    for (const c of u.urooms) {
        if (!u.urooms0.includes(c)) u.uentered.push(c);
        if (IS_SHOP(rtypeOf(c))) {
            u.ushops.push(c);
            if (!u.ushops0.includes(c)) u.ushops_entered.push(c);
        }
    }
    u.ushops_left = u.ushops0.filter((c) => !u.ushops.includes(c));
}

// C ref: shk.c u_left_shop(leavestring, newlev).
export async function u_left_shop(leavestring, _newlev) {
    const u = game.u;
    const loc = game.level?.at(u.ux, u.uy);
    const loc0 = game.level?.at(u.ux0 ?? u.ux, u.uy0 ?? u.uy);
    if (!leavestring.length && (!loc?.edge || loc0?.edge)) return;
    const shkp = shop_keeper(leavestring.length ? leavestring[0] : u.ushops0[0]);
    if (!shkp || !inhishop(shkp)) return;
    const eshk = shkp.eshk;
    if (!eshk.billct && !eshk.debit) return; /* bill is settled */
    if (!leavestring.length) {
        await pline(`"${game.plname}!  ${eshk.surcharge
            ? "Don't you leave without paying!" : 'Please pay before leaving.'}"`);
        return;
    }
    // C ref: shk.c u_left_shop() tail — walking out with an unsettled bill is a
    // robbery; nearshop is false whenever the hero left by changing level.
    const loc0b = game.level?.at(u.ux0 ?? u.ux, u.uy0 ?? u.uy);
    if (await rob_shop(shkp))
        await call_kops(shkp, !_newlev && !!loc0b?.edge);
}


// C wizard.c choose_stairs: covetous retreat and guardian deployment prefer
// the requested direction, then a ladder, branch stairs, or the opposite direction.
export function choose_stairs(dir) {
    const up = builds_up(game.u?.uz) ? dir : !dir;
    const findTypeDir = (isladder, wantUp) => {
        for (let st = game.stairs; st; st = st.next)
            if (!!st.isladder === !!isladder && !!st.up === !!wantUp) return st;
        return null;
    };
    let stway = findTypeDir(false, up);
    if (!stway) {
        stway = findTypeDir(true, up);
        if (!stway) {
            for (let st = game.stairs; st; st = st.next)
                if (st.tolev?.dnum !== game.u?.uz?.dnum) { stway = st; break; }
            if (!stway) {
                stway = findTypeDir(false, !up) || findTypeDir(true, !up);
            }
        }
    }
    return stway ? { x: stway.sx, y: stway.sy } : null;
}


// C ref: shk.c u_entered_shop(enterstring).
async function u_entered_shop(enterstring) {
    if (!enterstring.length) return;
    const u = game.u;
    const shkp = shop_keeper(enterstring[0]);
    if (!shkp || !inhishop(shkp)) {
        // deserted_shop(): the "This shop is untended." flavour needs a shop
        // whose keeper has left it, which no recorded level produces.
        u.ushops = [];
        return;
    }
    // C ref: shk.c:783 record_achievement(ACH_SHOP), right after the inhishop()
    // guard and before any dialog — this is the "entered a shop" #chronicle line.
    {
        const { record_achievement } = await import('./insight.js');
        record_achievement(17 /* you.h ACH_SHOP */);
    }
    const eshk = shkp.eshk;
    if ((!eshk.visitct || eshk.customer)
        && String(eshk.customer || '').toLowerCase()
           !== String(game.plname || '').toLowerCase()) {
        eshk.visitct = 0;
        eshk.following = 0;
        eshk.customer = game.plname;
        // C ref: shk.c:794 pacify_shk(shkp, TRUE), including bill surcharge.
        pacify_shk(shkp, true);
    }
    if (eshk.following) return; /* no dialog */

    const rt = rtypeOf(enterstring[0]);
    const shopname = shtypes[rt - SHOPBASE]?.name || 'store';
    if (!shkp.mpeaceful) {
        if (!Deaf() && !muteshk(shkp)) {
            await verbalize(`So, ${game.plname}, you dare return to ${
                s_suffix(shkname(shkp))} ${shopname}?!`);
        } else {
            const angrytexts = ['quite upset', 'ticked off', 'furious'];
            const state = angrytexts[rn2(angrytexts.length)];
            await update_topl(`${shkname(shkp)} seems ${state} over your return to ${
                s_suffix(shkname(shkp))} ${shopname}!`);
        }
    } else if (eshk.surcharge) {
        if (!Deaf() && !muteshk(shkp))
            await verbalize(`Back again, ${game.plname}?  I've got my eye on you.`);
        else
            await update_topl(`The atmosphere at ${s_suffix(shkname(shkp))} ${
                shopname} seems unwelcoming.`);
    } else if (eshk.robbed) {
        await update_topl(`${shkname(shkp)} mutters imprecations against shoplifters.`);
    } else if (!Deaf() && !muteshk(shkp)) {
        await verbalize(`${Hello(game.urole?.mnum, shkp)}, ${game.plname}!  Welcome${
            eshk.visitct++ ? ' again' : ''} to ${s_suffix(shkname(shkp))} ${shopname}!`);
    } else {
        await update_topl(`You enter ${s_suffix(shkname(shkp))} ${shopname}${
            eshk.visitct++ ? ' again' : ''}!`);
    }

    // C ref: shk.c — a hero who stopped in the doorway carrying a digging tool
    // (or riding) is asked to leave it outside and the shk gets an extra move.
    if (inside_shop(u.ux, u.uy)) return;
    const not_upset = !eshk.surcharge;
    const inv = game.invent || [];
    const pick = inv.find((o) => o.otyp === PICK_AXE) || null;
    const mattock = inv.find((o) => o.otyp === DWARVISH_MATTOCK) || null;
    let should_block;
    if (pick || mattock) {
        let cnt = 1, tool;
        if (pick && mattock) { tool = 'digging tool'; cnt = 2; }
        else if (pick) { tool = 'pick-axe'; cnt = inv.filter((o) => o.otyp === PICK_AXE).length; }
        else { tool = 'mattock'; cnt = inv.filter((o) => o.otyp === DWARVISH_MATTOCK).length; }
        const plur = cnt === 1 ? '' : 's';
        await pline(not_upset ? `"Will you please leave your ${tool}${plur} outside?"`
            : `"Leave the ${tool}${plur} outside."`);
        should_block = true;
    } else {
        const here = (game.level?.objects || []).filter(
            (o) => o.where === OBJ_FLOOR && o.ox === u.ux && o.oy === u.uy);
        should_block = !!(u.Fast
            && here.some((o) => o.otyp === PICK_AXE || o.otyp === DWARVISH_MATTOCK));
    }
    if (should_block) {
        const { dochug } = await import('./monmove.js');
        await dochug(shkp); /* shk gets extra move */
    }
}

// C ref: hack.c:3625 check_special_room(newlev) — the one-time room-entry
// messages.  Only the TEMPLE and MORGUE arms were ported; every other special
// room entered silently AND kept its rtype, so hack.c:3737's
// `svr.rooms[roomno].rtype = OROOM` plus the level-flag reset never happened
// and sounds.c kept rolling that room's ambient noise forever.
export async function check_special_room(newlev) {
    const u = game.u;
    if (!u || !game.level) return;
    move_update(newlev);

    if (u.ushops0.length) await u_left_shop(u.ushops_left, newlev);

    // C ref: hack.c:3648 — the Mine Town achievement is checked BEFORE the
    // "no entrance messages necessary" early return, because two minetn
    // variants cover the whole level and so are entered without entering any
    // room.  achieveo.minetn_reached makes it fire once.
    {
        const { in_town } = await import('./dig.js');
        const { In_mines } = await import('./const.js');
        game.context = game.context || {};
        game.context.achieveo = game.context.achieveo || {};
        if (!game.context.achieveo.minetn_reached
            && In_mines(u.uz) && in_town(u.ux, u.uy)) {
            const { record_achievement } = await import('./insight.js');
            record_achievement(16 /* you.h ACH_TOWN */);
            game.context.achieveo.minetn_reached = true;
        }
    }

    if (!u.uentered.length && !u.ushops_entered.length) return;

    if (u.ushops_entered.length) await u_entered_shop(u.ushops_entered);

    for (const c of u.uentered) {
        const roomno = c - ROOMOFFSET;
        // C ref: hack.c:3662 — `rt` is re-assigned to 0 by the `default:` arm,
        // which is what exempts VAULTs, TEMPLEs and shops from the retirement
        // below; the switch's own arms leave it alone.
        let rt = rtypeOf(c);
        let msg_given = true;

        switch (rt) {
        case ZOO:
            await update_topl("Welcome to David's treasure zoo!");
            break;
        case SWAMP:
            await update_topl(`It ${Blind() ? 'feels' : 'looks'} rather ${
                Blind() ? 'humid' : 'muddy'} down here.`);
            break;
        case COURT: {
            // C: the Sam quest home level's throne room has no throne, so the
            // adjective is conditional on the furniture actually being there.
            const { furniture_present } = await import('./hack.js');
            await update_topl(`You enter an opulent${
                furniture_present(THRONE, roomno) ? ' throne' : ''} room!`);
            break;
        }
        case LEPREHALL:
            await update_topl('You enter a leprechaun hall!');
            break;
        case MORGUE:
            // C ref: hack.c:3685 — this is a normal room-entry event, not a
            // quest message.  It can therefore page a prior arrival/quest
            // topline before leaving its own line pending.
            await update_topl(midnight() ? 'Run away!  Run away!'
                : 'You have an uncanny feeling...');
            break;
        case BEEHIVE:
            await update_topl('You enter a giant beehive!');
            break;
        case COCKNEST:
            await update_topl('You enter a disgusting nest!');
            break;
        case ANTHOLE:
            await update_topl('You enter an anthole!');
            break;
        case BARRACKS: {
            const { monstinroom } = await import('./hack.js');
            const manned = ['soldier', 'sergeant', 'lieutenant', 'captain']
                .some((nm) => !!monstinroom(monster_by_pmidx(name_to_pmidx(nm)),
                                            roomno));
            await update_topl(manned ? 'You enter a military barracks!'
                : 'You enter an abandoned barracks.');
            break;
        }
        case DELPHI: {
            const { monstinroom } = await import('./hack.js');
            const oracle = monstinroom(monster_by_pmidx(name_to_pmidx('Oracle')),
                                       roomno);
            if (oracle) {
                // C: verbalize() — the quoted form, like js/dig.js's copy.
                await update_topl(!oracle.mpeaceful
                    ? `"You're in Delphi, ${game.plname}."`
                    : `"${Hello(game.urole?.mnum, null)}, ${
                        game.plname}, welcome to Delphi!"`);
            } else {
                msg_given = false;
            }
            break;
        }
        case TEMPLE: {
            // C ref: hack.c:3725 — TEMPLE prints nothing itself; intemple()
            // owns the message, then it FALLS THROUGH to `default:`.
            const { intemple } = await import('./priest.js');
            await intemple(c);
        }
        /* falls through */
        default:
            // C ref: hack.c:3730 — `msg_given = (rt == TEMPLE || rt >= SHOPBASE)`,
            // then room_discovered(roomno).  That is what makes #overview name
            // the shop; without it the level's mapseen never learned the room.
            msg_given = (rt === TEMPLE || rt >= SHOPBASE);
            rt = 0;
            break;
        }

        if (msg_given) await room_discovered(roomno);

        if (rt !== 0) {
            retireSpecialRoom(c, rt);
            // C ref: hack.c:3765 — entering a COURT/SWAMP/MORGUE/ZOO gives each
            // of its residents a 1-in-3 chance of waking, unless the hero is
            // stealthy.  C compares its ZERO-based `roomno` against
            // levl[][].roomno, which mklev.c topologize() stores ROOMOFFSET-
            // based, so the test only ever matches monsters in the room
            // ROOMOFFSET slots earlier in svr.rooms[] — an upstream off-by-
            // ROOMOFFSET bug that makes the roll almost never fire (zero
            // occurrences across the 142 recorded sessions).  Reproduced
            // literally: "fixing" it here would invent rn2(3) draws C does not
            // make.
            if (rt === COURT || rt === SWAMP || rt === MORGUE || rt === ZOO) {
                const { DEADMONSTER } = await import('./mon.js');
                for (const mtmp of [...(game.level?.monsters || [])]) {
                    if (DEADMONSTER(mtmp)) continue;
                    if (!isok(mtmp.mx, mtmp.my)
                        || roomno !== (game.level.at(mtmp.mx, mtmp.my)?.roomno | 0))
                        continue;
                    if (!Stealth() && !rn2(3)) {
                        const { wake_msg_core } = await import('./mon.js');
                        await wake_msg_core(mtmp, false);
                        mtmp.msleeping = 0;
                    }
                }
            }
        }
    }
}


