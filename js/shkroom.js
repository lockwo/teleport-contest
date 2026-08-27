// shkroom.js — room-entry bookkeeping and the shop greeting.
// C ref: hack.c in_rooms()/move_update()/check_special_room(), shk.c
// u_entered_shop()/u_left_shop().
//
// u.ushops feeds shk_move()'s `avoid` decision (monmove.js), so this is RNG
// state, not just display: without it a shopkeeper picks a different square.

import { game } from './gstate.js';
import { pline, update_topl } from './display.js';
import { shtypes } from './shtypes.js';
import { Hello } from './role.js';
import { rn2, rnd } from './rng.js';
import { objects, base_oc_cost } from './mkobj.js';
import { acurr_eff } from './attrib.js';
import { makemon, monster_by_pmidx, enexto_spawn } from './makemon.js';
import { builds_up, room_discovered } from './dungeon.js';
import { record_price_quote } from './o_init.js';
import { depth as depth_of_level } from './hacklib.js';
import {
    ROOMOFFSET, NO_ROOM, SHARED, SHARED_PLUS, SHOPBASE, COLNO, ROWNO,
    A_CHA, HUNGRY, TEMPLE, MAXNROFROOMS, G_GONE,
} from './const.js';

const PICK_AXE = 259, DWARVISH_MATTOCK = 71;

const IS_SHOP = (rt) => rt >= SHOPBASE;

// C ref: decl.c `struct mkroom svr.rooms[(MAXNROFROOMS + 1) * 2]` with
// `gs.subrooms = &svr.rooms[MAXNROFROOMS + 1]` — rooms and SUBrooms share one
// array, so C's `svr.rooms[rno - ROOMOFFSET]` resolves a subroom's roomno too.
// This port keeps them in two arrays; without the second lookup every roomno
// belonging to a subroom (Mine Town's temple, its shops) resolved to nothing,
// so in_rooms(x, y, TEMPLE) answered "no temple here" and the priest never
// took pri_move()'s mill-around-the-altar branch (seed0014 step 669).
function roomAt(rno) {
    const idx = rno - ROOMOFFSET;
    if (idx < 0) return null;
    if (idx > MAXNROFROOMS)
        return (game.level?.subrooms || [])[idx - (MAXNROFROOMS + 1)] || null;
    return game.level?.rooms?.[idx] || null;
}
function rtypeOf(rno) { return roomAt(rno)?.rtype ?? 0; }

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
    return shkp;
}

// C ref: shk.c inhishop(shkp).
function inhishop(shkp) {
    const loc = game.level?.at(shkp.mx, shkp.my);
    const rmno = loc?.roomno ?? 0;
    return rmno !== 0 && rmno === shkp.eshk?.shoproom;
}

// C ref: shk.c inside_shop(x, y) — strictly inside, i.e. not on the boundary.
function inside_shop(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return false;
    const rno = loc.roomno ?? NO_ROOM;
    if (rno < ROOMOFFSET || loc.edge) return false;
    return IS_SHOP(rtypeOf(rno));
}

// C ref: shknam.c shkname() — the personal name with its prefix character
// stripped ('+'/'-'/'|'/'_' encode gender in the shknms[] tables).
export function shkname(shkp) {
    const nm = shkp.eshk?.shknam;
    if (!nm) return shkp.data?.name || 'shopkeeper';
    return /[A-Za-z]/.test(nm[0]) ? nm : nm.slice(1);
}
const s_suffix = (s) => (/s$/.test(s) ? `${s}'` : `${s}'s`);

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
async function u_left_shop(leavestring, _newlev) {
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

// C ref: shk.c addupbill(shkp) — sum of price * bquan over the bill.
function addupbill(shkp) {
    let total = 0;
    const eshk = shkp.eshk;
    for (let ct = 0; ct < (eshk.billct || 0); ct++)
        total += (eshk.bill[ct].price || 0) * (eshk.bill[ct].bquan || 0);
    return total;
}

// C ref: shk.c setpaid(shkp) — clear every unpaid flag this shk owns and reset
// the bill.  The billobjs chain (used-up items) is not modelled.
function setpaid(shkp) {
    for (const obj of (game.invent || [])) if (obj) obj.unpaid = 0;
    for (const obj of (game.level?.objects || [])) if (obj) { obj.unpaid = 0; obj.no_charge = 0; }
    for (const mon of (game.level?.monsters || []))
        for (const obj of (mon?.minvent || [])) if (obj) obj.unpaid = 0;
    if (shkp) {
        shkp.eshk.billct = 0;
        shkp.eshk.bill = [];
        shkp.eshk.credit = 0;
        shkp.eshk.debit = 0;
        shkp.eshk.loan = 0;
    }
}

// C ref: shk.c:2485 paybill(croaked, silently) -> shk.c:2577 inherits().  Ported
// only as far as the message the death screen needs: the hero dies inside a shop
// with exactly one shopkeeper on the level, so numsk == 1 (no rn2(2) head-shake)
// and money2mon() is skipped when the hero carries no gold.  Zero RNG.
// C's shopkeeper-priority scan, the multi-shk branch, the partial-payment arm
// and set_repo_loc()/paygd() are not modelled; they need state this port does
// not track and none of them can fire for a single-shk in-shop death.
export async function paybill(croaked) {
    if (croaked < 0) return false;   /* escaped the dungeon: shks can't reach */
    const shks = (game.level?.monsters || []).filter((m) => m?.isshk && m.eshk);
    if (shks.length !== 1) return false;
    const shkp = shks[0];
    const eshk = shkp.eshk;
    const uinshop = (game.u?.ushops || []).includes(eshk.shoproom);
    const invent = game.invent || [];

    // The peaceful "gratefully inherits" case.
    if (uinshop && inhishop(shkp) && !eshk.billct && !eshk.robbed && !eshk.debit
        && shkp.mpeaceful && !eshk.following) {
        const taken = invent.length > 0;
        if (taken) await update_topl(`${Shknam(shkp)} gratefully inherits all your possessions.`);
        setpaid(shkp);
        return taken;
    }

    let loss = 0, take = false;
    if (eshk.billct || eshk.debit || eshk.robbed) {
        if (uinshop && inhishop(shkp)) loss = addupbill(shkp) + (eshk.debit || 0);
        if (loss < (eshk.robbed || 0)) loss = eshk.robbed || 0;
        take = true;
    }
    let taken = false;
    if (eshk.following || !shkp.mpeaceful || take) {
        if (!invent.length) { setpaid(shkp); return false; }
        const umoney = money_cnt_inv(invent);
        let takes = '';
        if (shkp.msleeping || shkp.mfrozen || !shkp.mcanmove) takes += 'wakes up and ';
        if (!m_next2u_shk(shkp)) takes += 'comes and ';
        takes += 'takes';
        if (loss > umoney || !loss || uinshop) {
            eshk.robbed = Math.max(0, (eshk.robbed || 0) - umoney);
            await update_topl(`${Shknam(shkp)} ${takes} all your possessions.`);
            taken = true;
        }
        rouse_shk(shkp, false);
    }
    setpaid(shkp);
    return taken;
}
function money_cnt_inv(invent) {
    let n = 0;
    for (const o of invent) if (o?.oclass === 12 /* COIN_CLASS */) n += (o.quan || 0);
    return n;
}
// C ref: mon.c m_next2u(mtmp) — distmin(mx,my,ux,uy) <= 1.
function m_next2u_shk(mtmp) {
    const u = game.u;
    return Math.max(Math.abs(mtmp.mx - u.ux), Math.abs(mtmp.my - u.uy)) <= 1;
}

// C ref: shk.c rouse_shk(shkp, verbosely) — greed-induced recovery.  No RNG.
function rouse_shk(shkp, _verbosely) {
    if (shkp.msleeping || shkp.mfrozen || !shkp.mcanmove) {
        shkp.msleeping = 0;
        shkp.mfrozen = 0;
        shkp.mcanmove = 1;
    }
}

// C ref: shk.c rile_shk(shkp) — anger the shk and apply the 4/3 surcharge to
// every entry already on the bill (matching get_cost()'s separate surcharge).
function rile_shk(shkp) {
    shkp.mpeaceful = 0;
    const eshk = shkp.eshk;
    if (!eshk.surcharge) {
        eshk.surcharge = 1;
        for (let ct = 0; ct < (eshk.billct || 0); ct++)
            eshk.bill[ct].price += Math.trunc((eshk.bill[ct].price + 2) / 3);
    }
}

// C ref: shk.c hot_pursuit(shkp) — the shk now follows the hero between levels
// and nothing on this level is "no charge" any more.
function hot_pursuit(shkp) {
    if (!shkp.isshk) return;
    rile_shk(shkp);
    shkp.eshk.customer = game.plname;
    shkp.eshk.following = 1;
    for (const obj of (game.level?.objects || [])) if (obj) obj.no_charge = 0;
}

// C ref: shk.c rob_shop(shkp) — settle-or-steal when the hero leaves.  Returns
// TRUE when an actual robbery happened (which is what summons the Kops).  No RNG.
async function rob_shop(shkp) {
    const eshk = shkp.eshk;
    rouse_shk(shkp, true);
    let total = addupbill(shkp) + (eshk.debit || 0);
    const { currency } = await import('./invent.js');
    if ((eshk.credit || 0) >= total) {
        await update_topl(`Your credit of ${eshk.credit} ${
            currency(eshk.credit)} is used to cover your shopping bill.`);
        total = 0;
    } else {
        await update_topl('You escaped the shop without paying!');
        total -= (eshk.credit || 0);
    }
    setpaid(shkp);
    if (!total) return false;

    eshk.robbed = (eshk.robbed || 0) + total;
    await update_topl(`You stole ${total} ${currency(total)} worth of merchandise.`);
    const { livelog_printf, LL_ACHIEVE } = await import('./livelog.js');
    livelog_printf(LL_ACHIEVE, `stole ${total} ${currency(total)} worth of merchandise from ${
        s_suffix(shkname(shkp))} ${shtypes[eshk.shoptype - SHOPBASE]?.name || 'store'}`);

    // C: stealing is unlawful for everyone but a Rogue.
    if (game.urole?.mnum !== PM_ROGUE) {
        const { adjalign } = await import('./attrib.js');
        adjalign(-Math.sign(game.u?.ualign?.type || 0));
    }
    hot_pursuit(shkp);
    return true;
}

// C ref: mon.c angry_guards(silent) — wake and anger every peaceful watchman.
// No RNG.  is_watch(ptr) is M2_WATCH; no covered level has a watch, so the ct
// branch (and its messages) never fires, but the peaceful-flag clearing must
// still happen because it feeds later monster moves.
function angry_guards(silent) {
    let ct = 0, nct = 0, sct = 0, slct = 0;
    for (const mtmp of (game.level?.monsters || [])) {
        if (!mtmp || mtmp.mhp <= 0) continue;
        if (!is_watch_mon(mtmp) || !mtmp.mpeaceful) continue;
        ct++;
        if (mtmp.msleeping || mtmp.mfrozen) {
            slct++;
            mtmp.msleeping = 0; mtmp.mfrozen = 0;
        }
        mtmp.mpeaceful = 0;
    }
    void nct; void sct; void silent;
    return ct > 0;
}

// C ref: mondata.h is_watch(ptr) — M2_WATCH.
function is_watch_mon(mtmp) {
    const nm = mtmp?.data?.name || '';
    return nm === 'watchman' || nm === 'watch captain';
}

// C ref: wizard.c choose_stairs(&sx, &sy, dir) — the staircase the Kops should
// swarm around: forward (down, in a builds-down dungeon), else a ladder, else a
// branch stair, else the opposite direction.  No RNG.
function choose_stairs(dir) {
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

// C ref: shk.c makekops(mm) — the Kop swarm.  k_cnt[0] = depth + rnd(5) (the
// ONLY RNG this function draws directly); the other three ranks are derived.
// enexto() WRITES BACK into mm, so each placement walks the swarm's origin
// forward — dropping that makes every Kop spawn from the same square and the
// enexto stream diverge immediately.
function makekops(mm) {
    const k_mndx = [KEYSTONE_KOP, KOP_SERGEANT, KOP_LIEUTENANT, KOP_KAPTAIN];
    let cnt = Math.abs(depth_of_level(game.u?.uz)) + rnd(5);
    const k_cnt = [cnt, Math.trunc(cnt / 3) + 1, Math.trunc(cnt / 6),
                   Math.trunc(cnt / 9)];

    for (let k = 0; k < 4; k++) {
        cnt = k_cnt[k];
        if (cnt === 0) break;
        const ptr = monster_by_pmidx(k_mndx[k]);
        if (!ptr) continue;
        if (mvitals_gone(k_mndx[k])) continue;
        while (cnt--) {
            const spot = enexto_spawn(mm.x, mm.y, ptr);
            if (spot) {
                mm.x = spot.x; mm.y = spot.y;
                makemon(ptr, mm.x, mm.y, MM_NOMSG);
            }
        }
    }
}

// C ref: monflag.h:211 G_GONE == G_GENOD | G_EXTINCT == 0x02 | 0x01.  Nothing in
// the covered sessions genocides a Kop, but the check gates the whole rank in C.
// The old mask was 0x30, and mvflags only ever holds 0x01/0x02/0x08
// (MV_KNOWS_EGG), so this predicate was unconditionally false.
function mvitals_gone(mndx) {
    const mv = game.mvitals?.[mndx];
    return !!(mv && (mv.mvflags & G_GONE));
}

// C ref: shk.c call_kops(shkp, nearshop) — the alarm and the two swarms.  The
// only RNG is inside makekops().
async function call_kops(shkp, nearshop) {
    if (!shkp) return;
    const u = game.u;
    if (!u?.Deaf) await update_topl('An alarm sounds!');

    const nokops = mvitals_gone(KEYSTONE_KOP) && mvitals_gone(KOP_SERGEANT)
        && mvitals_gone(KOP_LIEUTENANT) && mvitals_gone(KOP_KAPTAIN);
    if (!angry_guards(!!u?.Deaf) && nokops) {
        if (game.flags?.verbose !== false && !u?.Deaf)
            await update_topl('But no one seems to respond to it.');
        return;
    }
    if (nokops) return;

    const st = choose_stairs(true);
    if (nearshop) {
        // "Stepped out" of the doorway: one swarm around the hero.
        if (game.flags?.verbose !== false)
            await update_topl('The Keystone Kops appear!');
        makekops({ x: u.ux, y: u.uy });
        return;
    }
    if (game.flags?.verbose !== false)
        await update_topl('The Keystone Kops are after you!');
    // Swarm near the down staircase (hinders return to level), then near the
    // shopkeeper (hinders return to the shop).
    if (st) makekops({ x: st.x, y: st.y });
    makekops({ x: shkp.mx, y: shkp.my });
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
        // pacify_shk(): clears anger/surcharge; no RNG.
        shkp.mpeaceful = 1;
        eshk.surcharge = 0;
    }
    if (eshk.following) return; /* no dialog */

    const rt = rtypeOf(enterstring[0]);
    const shopname = shtypes[rt - SHOPBASE]?.name || 'store';
    if (!shkp.mpeaceful) {
        await update_topl(`"So, ${game.plname}, you dare return to ${
            s_suffix(shkname(shkp))} ${shopname}?!"`);
    } else if (eshk.surcharge) {
        await update_topl(`"Back again, ${game.plname}?  I've got my eye on you."`);
    } else if (eshk.robbed) {
        await update_topl(`${shkname(shkp)} mutters imprecations against shoplifters.`);
    } else {
        await update_topl(`"${Hello(game.urole?.mnum, shkp)}, ${game.plname}!  Welcome${
            eshk.visitct++ ? ' again' : ''} to ${s_suffix(shkname(shkp))} ${shopname}!"`);
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
            (o) => o.where === 'floor' && o.ox === u.ux && o.oy === u.uy);
        should_block = !!(u.Fast
            && here.some((o) => o.otyp === PICK_AXE || o.otyp === DWARVISH_MATTOCK));
    }
    if (should_block) {
        const { dochug } = await import('./monmove.js');
        await dochug(shkp); /* shk gets extra move */
    }
}

// C ref: hack.c check_special_room(newlev).  Of the u.uentered switch only the
// TEMPLE arm is ported; the zoo/court/morgue/... entry messages — and the
// per-resident `!Stealth && !rn2(3)` wake-up roll that follows COURT/SWAMP/
// MORGUE/ZOO, plus their rtype->OROOM + level.flags reset — are still missing.
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

    // C: `intemple(roomno + ROOMOFFSET)` — the offset room number, which is
    // what u.uentered already holds.
    for (const c of u.uentered) {
        const rt = rtypeOf(c);
        if (rt === TEMPLE) {
            const { intemple } = await import('./priest.js');
            await intemple(c);
        }
        // C ref: hack.c:3734 — `msg_given = (rt == TEMPLE || rt >= SHOPBASE)`,
        // then room_discovered(roomno).  That is what makes #overview name the
        // shop; without it the level's mapseen never learned the room.
        if (rt === TEMPLE || rt >= SHOPBASE) room_discovered(c - ROOMOFFSET);
    }
}


// ── shop pricing + billing (C ref: shk.c) ────────────────────────────────────
//
// Picking an item up inside a shop puts it on the shk's bill: that is where the
// "For you, <honorific>; only N zorkmids for this <item>." quote — and its
// rn2(4) honorific draw, the only RNG in the whole path — comes from, and it is
// what makes doname() append "(unpaid, N zorkmids)".  addtobill() was a `{}`
// stub in invent.js, so a whole shop visit drew no RNG and printed none of it.

// objects.h object classes and the otyps getprice() special-cases.
const WEAPON_CLASS = 2, ARMOR_CLASS = 3, FOOD_CLASS = 7, POTION_CLASS = 8,
      TOOL_CLASS = 6, GEM_CLASS = 13, COIN_CLASS = 12, WAND_CLASS = 10;
const POT_WATER = 322, TALLOW_CANDLE = 224, WAX_CANDLE = 225, DUNCE_CAP = 94;
const TIN = 296, EGG = 266, CORPSE = 265;
const GLASS = 19;                 // objects.h MAT_GLASS
const WORTHLESS_WHITE_GLASS = 461;
const BILLSZ = 200;               // shk.h
const PM_TOURIST = 10, MAXULEV = 30, PM_ELF_RACE = 1, PM_ROGUE = 8;
// makemon.js pmidx for the four Kop ranks (C's k_mndx[]).
const KEYSTONE_KOP = 179, KOP_SERGEANT = 180, KOP_LIEUTENANT = 181,
      KOP_KAPTAIN = 182;
const MM_NOMSG = 0x00020000; // hack.h — no 'suddenly appears' message

// C ref: shk.c get_cost() — each worthless glass gem is priced as one of two
// real gems, chosen by a per-game pseudorandom bit.  Indexed from
// WORTHLESS_WHITE_GLASS; [pseudorand ? a : b].
const GLASS_GEM_PRICED_AS = [
    [440, 452],  // white:  diamond / opal
    [443, 448],  // blue:   sapphire / aquamarine
    [441, 456],  // red:    ruby / jasper
    [449, 450],  // yellowish brown: amber / topaz
    [442, 459],  // orange: jacinth / agate
    [447, 453],  // yellow: citrine / chrysoberyl
    [444, 451],  // black:  black opal / jet
    [445, 460],  // green:  emerald / jade
    [455, 457],  // violet: amethyst / fluorite
];

// C ref: shk.c inside_shop(x, y) — the shop's room number, 0 if not inside one.
// (The boolean inside_shop() above is this !== 0.)
function inside_shop_rno(x, y) {
    const loc = game.level?.at(x, y);
    if (!loc) return 0;
    const rno = loc.roomno ?? NO_ROOM;
    if (rno < ROOMOFFSET || loc.edge) return 0;
    return IS_SHOP(rtypeOf(rno)) ? rno : 0;
}

// C ref: shk.c costly_spot(x, y) — is (x,y) shop floor whose keeper is home?
// The shk's own square (eshk->shk) is free: goods there aren't charged for.
export function costly_spot(x, y) {
    if (!game.level?.flags?.has_shop) return false;
    const shkp = shop_keeper(in_rooms(x, y, SHOPBASE)[0]);
    if (!shkp || !inhishop(shkp)) return false;
    const eshk = shkp.eshk;
    return !!inside_shop_rno(x, y)
        && !(x === eshk.shk?.x && y === eshk.shk?.y);
}

// C ref: shk.c onbill(obj, shkp, silent) — obj's entry on shkp's bill, if any.
function onbill(obj, shkp) {
    const eshk = shkp?.eshk;
    if (!eshk?.bill) return null;
    for (let ct = 0; ct < (eshk.billct || 0); ct++)
        if (eshk.bill[ct]?.bo_id === obj.o_id) return eshk.bill[ct];
    return null;
}

// C ref: shk.c corpsenm_price_adj(obj) — the per-species surcharge on a tin,
// egg or corpse.  It needs intrinsic_possible(), which this port does not
// have; every other object class prices exactly.
function corpsenm_price_adj(obj) {
    if (obj.otyp !== TIN && obj.otyp !== EGG && obj.otyp !== CORPSE) return 0;
    return 0;
}

// C ref: shk.c get_pricing_units(obj) — quan, except globs are sold by weight.
function get_pricing_units(obj) {
    let units = obj.quan || 1;
    if (obj.globby) {
        const unit_weight = objects[obj.otyp]?.oc_weight || 0;
        const wt = (obj.owt > 0) ? obj.owt : 0;
        if (unit_weight) units = Math.floor((wt + unit_weight - 1) / unit_weight);
    }
    return units;
}

// C ref: shk.c getprice(obj, shk_buying) — base list price, before the
// charisma / dunce-cap / unidentified multipliers.
function getprice(obj, shk_buying) {
    let tmp = base_oc_cost(obj.otyp);
    // arti_cost(): no covered hero carries an artifact into a shop.
    switch (obj.oclass) {
    case FOOD_CLASS:
        tmp += corpsenm_price_adj(obj);
        // C: a HUNGRY-or-worse hero is charged u.uhs (2..4)x for food.
        if ((game.u?.uhs || 0) >= HUNGRY && !shk_buying) tmp *= game.u.uhs;
        if (obj.oeaten) tmp = 0;
        break;
    case WAND_CLASS:
        if (obj.spe === -1) tmp = 0;
        break;
    case POTION_CLASS:
        if (obj.otyp === POT_WATER && !obj.blessed && !obj.cursed) tmp = 0;
        break;
    case ARMOR_CLASS:
    case WEAPON_CLASS:
        if ((obj.spe || 0) > 0) tmp += 10 * obj.spe;
        break;
    case TOOL_CLASS:
        if ((obj.otyp === WAX_CANDLE || obj.otyp === TALLOW_CANDLE)
            && (obj.age || 0) < 20 * base_oc_cost(obj.otyp))
            tmp = Math.trunc(tmp / 2);
        break;
    default: break;
    }
    return tmp;
}

// C ref: shk.c oid_price_adjustment(obj, oid) — an unidentified non-glass item
// gets a 4/3 surcharge on one o_id in four, so the same item always quotes the
// same price within a game.
function oid_price_adjustment(obj, oid) {
    const o = objects[obj.otyp];
    if (!(obj.dknown && o?.oc_name_known)
        && (obj.oclass !== GEM_CLASS || o?.material !== GLASS))
        return (oid % 4) === 0 ? 1 : 0;
    return 0;
}

// C ref: shk.c get_cost(obj, shkp) — list price with the shopkeeper's
// multipliers.  Charisma dominates: CHA 16-17 pays 3/4, which is how a
// 10-zorkmid cream pie is quoted at 8 to a Knight.  No RNG.
export function get_cost(obj, shkp) {
    let tmp = getprice(obj, false);
    let multiplier = 1, divisor = 1;

    if (!tmp) tmp = 5;
    if (!obj.dknown || !objects[obj.otyp]?.oc_name_known) {
        if (obj.oclass === GEM_CLASS && objects[obj.otyp]?.material === GLASS) {
            const pseudorand =
                ((game.ubirthday || 0) % obj.otyp) >= Math.trunc(obj.otyp / 2);
            const pair = GLASS_GEM_PRICED_AS[obj.otyp - WORTHLESS_WHITE_GLASS];
            if (pair) tmp = base_oc_cost(pseudorand ? pair[0] : pair[1]) || tmp;
        } else if (oid_price_adjustment(obj, obj.o_id) > 0) {
            multiplier *= 4; divisor *= 3;
        }
    }
    if (game.uarmh && game.uarmh.otyp === DUNCE_CAP) {
        multiplier *= 4; divisor *= 3;
    } else if ((game.urole?.mnum === PM_TOURIST
                && (game.u?.ulevel || 1) < Math.trunc(MAXULEV / 2))
               || (game.uarmu && !game.uarm && !game.uarmc)) {
        multiplier *= 4; divisor *= 3;
    }

    const cha = acurr_eff(A_CHA);
    if (cha > 18) divisor *= 2;
    else if (cha === 18) { multiplier *= 2; divisor *= 3; }
    else if (cha >= 16) { multiplier *= 3; divisor *= 4; }
    else if (cha <= 5) multiplier *= 2;
    else if (cha <= 7) { multiplier *= 3; divisor *= 2; }
    else if (cha <= 10) { multiplier *= 4; divisor *= 3; }

    tmp *= multiplier;
    if (divisor > 1) {
        // C: tmp = (((tmp * 10) / divisor) + 5) / 10 — integer round-half-up.
        tmp = Math.trunc((Math.trunc((tmp * 10) / divisor) + 5) / 10);
    }
    if (tmp <= 0) tmp = 1;
    if (obj.oartifact) tmp *= 4;
    // C applies the anger surcharge separately from multiplier/divisor.
    if (shkp?.eshk?.surcharge) tmp += Math.trunc((tmp + 2) / 3);
    return tmp;
}

// C ref: shk.c billable(&shkp, obj, roomno, reset_nocharge) — the shk who owns
// obj, or null when nobody can charge for it.
function billable(shkp, obj, roomno, reset_nocharge) {
    if (!shkp) {
        if (!roomno) return null;
        shkp = shop_keeper(roomno);
        if (!shkp || !inhishop(shkp)) return null;
    }
    // C: something already eaten (or thrown away earlier) isn't billable.
    if (onbill(obj, shkp) || (obj.oclass === FOOD_CLASS && obj.oeaten)) return null;
    if (obj.no_charge) {
        // C keeps a no_charge CONTAINER billable when its contents are not;
        // bill_box_content() is not ported, so a bare no_charge item is free.
        if (reset_nocharge && obj.oclass !== COIN_CLASS) obj.no_charge = 0;
        return null;
    }
    return shkp;
}

// C ref: shk.c add_one_tobill(obj, dummy, shkp) — append the bill entry and
// flag the object unpaid.  No RNG.
function add_one_tobill(obj, dummy, shkp) {
    const eshk = shkp.eshk;
    if (!eshk.bill) { eshk.bill = []; eshk.billct = 0; }
    if (!billable(shkp, obj, game.u.ushops?.[0], true)) return;
    if ((eshk.billct || 0) >= BILLSZ) return;
    eshk.bill[eshk.billct] = {
        bo_id: obj.o_id,
        bquan: obj.quan || 1,
        useup: !!dummy,
        price: get_cost(obj, shkp),
    };
    eshk.billct++;
    obj.unpaid = 1;
    // C ref: shk.c:3362 — the bill price is remembered per object TYPE for the
    // discoveries list's " {buy N}" suffix.
    record_price_quote(obj.otyp, eshk.bill[eshk.billct - 1].price, true);
}

// C ref: shk.c append_honorific(buf) — rn2(SIZE(honored) - 1) picks among the
// FIRST FOUR entries; u.uevent.udemigod shifts the window to entries 1..4.
function append_honorific() {
    const honored = ['good', 'honored', 'most gracious', 'esteemed',
                     'most renowned and sacred'];
    let buf = honored[rn2(honored.length - 1) + (game.u?.uevent?.udemigod ? 1 : 0)];
    // The vampire polyform arm needs youmonst.data; no covered hero is polymorphed.
    if ((game.urace?.mnum ?? 0) === PM_ELF_RACE)
        buf += game.flags?.female ? ' hiril' : ' hir';
    else buf += game.flags?.female ? ' lady' : ' sir';
    return buf;
}

// C ref: shk.c addtobill(obj, ininv, dummy, silent) — bill obj and quote the
// price.  ininv (the pickup case) gets the "For you, ..." line; the rn2(4)
// inside append_honorific() is the only RNG the function draws.  Containers
// (bill_box_content) and gold (costly_gold) are not ported.
export async function addtobill(obj, ininv, dummy, silent) {
    const u = game.u;
    const shkp = billable(null, obj, u.ushops?.[0], true);
    if (!shkp) return;
    if (obj.oclass === COIN_CLASS) return; /* costly_gold() */
    if ((shkp.eshk.billct || 0) >= BILLSZ) {
        if (!silent) await update_topl('You got that for free!');
        return;
    }
    const ltmp = obj.no_charge ? 0 : get_cost(obj, shkp);
    if (obj.no_charge) { obj.no_charge = 0; return; }

    add_one_tobill(obj, dummy, shkp);
    if (silent) return;

    const { xname, currency } = await import('./invent.js');
    const save_quan = obj.quan;
    if (!ltmp) {
        await update_topl(`${Shknam(shkp)} has no interest in the ${xname(obj)}.`);
        return;
    }
    if (!ininv) {
        await update_topl(`The ${xname(obj)} will cost you ${ltmp} ${
            currency(ltmp)}${save_quan > 1 ? ' each' : ''}.`);
        return;
    }
    let buf = '"For you,';
    if (!shkp.mpeaceful) buf += ' scum;';
    else if (!shkp.eshk.surcharge) buf += ' ' + append_honorific() + '; only';
    obj.quan = 1; /* C fools xname() into the singular */
    const nm = xname(obj);
    obj.quan = save_quan;
    await update_topl(`${buf} ${ltmp} ${currency(ltmp)} ${
        save_quan > 1 ? 'per' : 'for this'} ${nm}."`);
}

// C ref: shk.c Shknam(shkp) — shkname() with the first letter capitalised.
function Shknam(shkp) {
    const s = shkname(shkp);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// C ref: shk.c unpaid_cost(obj, cost_type) — what doname() quotes for an unpaid
// inventory item: the bill price, times quan unless COST_SINGLEOBJ.
export function unpaid_cost(obj, singleobj) {
    for (const rno of (game.u?.ushops || [])) {
        const shkp = shop_keeper(rno);
        if (!shkp) continue;
        const bp = onbill(obj, shkp);
        if (bp) return singleobj ? bp.price : bp.price * (obj.quan || 1);
    }
    return 0;
}

// C ref: shk.c get_cost_of_shop_item(obj, &nochrg) — the "(for sale, N
// zorkmids)" price for an object the hero is looking at on shop floor.
// nochrg: 1 = no charge, 0 = shop owned, -1 = not applicable.
export function get_cost_of_shop_item(obj) {
    const u = game.u;
    const res = { cost: 0, nochrg: -1 };
    if (!u?.ushops?.length || obj.oclass === COIN_CLASS) return res;
    const x = obj.ox, y = obj.oy;
    if (!(x >= 0) || !(y >= 0)) return res;
    if (in_rooms(x, y, SHOPBASE)[0] !== u.ushops[0]) return res;
    const shkp = shop_keeper(inside_shop_rno(x, y));
    if (!shkp || !inhishop(shkp)) return res;
    const eshk = shkp.eshk;
    const onfloor = obj.where === 'floor';
    const freespot = onfloor && x === eshk.shk?.x && y === eshk.shk?.y;
    res.nochrg = (onfloor && (obj.no_charge || freespot)) ? 1 : 0;
    if (onfloor ? !res.nochrg : !!obj.unpaid)
        res.cost = get_pricing_units(obj) * get_cost(obj, shkp);
    return res;
}
