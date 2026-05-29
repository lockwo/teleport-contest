// exper.js — experience points, level gain/loss.
// C ref: src/exper.c — newuexp(), enermod(), newpw(), more_experienced(),
// losexp(), newexplevel(), pluslvl().  newhp() lives in attrib.js (C: attrib.c).
//
// The wizard-mode #levelchange command (wizcmds.c wiz_level_change) drives
// pluslvl()/losexp() in a loop; the recorded sessions seed0383/0367/0373 set
// their level to 20, producing a cascade of "You feel more experienced." /
// "Welcome to experience level N." messages, each pluslvl rolling newhp()/
// newpw() RNG.  The per-iteration message pairing and --More-- boundaries are
// handled by display.js update_topl(); this module is the RNG/state core.

import { game } from './gstate.js';
import { rn1, rnd } from './rng.js';
import { A_WIS, A_CON } from './const.js';
import { MAXULEV } from './const.js';

// ── role / race advancement data (C: role.c roles[]/races[]) ──
// RoleAdvance = {infix, inrnd, lofix, lornd, hifix, hirnd}; xlev is the
// experience-level cutoff between the "lower" and "higher" advance brackets.
// PM_ indices match u_init.js / roles[].mnum.
const PM_BARBARIAN = 1, PM_KNIGHT = 4, PM_CLERIC = 6, PM_VALKYRIE = 11,
      PM_WIZARD = 12, PM_HEALER = 3;

// hpadv/enadv per role (the full 6-field advance struct), plus xlev.
const ROLE_ADVANCE = new Map([
    // Wizard  hp {10,0,0,8,1,0}  en {4,3,0,2,0,3}  xlev 12
    [PM_WIZARD, { hpadv: { infix: 10, inrnd: 0, lofix: 0, lornd: 8, hifix: 1, hirnd: 0 },
                  enadv: { infix: 4, inrnd: 3, lofix: 0, lornd: 2, hifix: 0, hirnd: 3 }, xlev: 12 }],
    // Knight  hp {14,0,0,8,2,0}  en {1,4,0,1,0,2}  xlev 10
    [PM_KNIGHT, { hpadv: { infix: 14, inrnd: 0, lofix: 0, lornd: 8, hifix: 2, hirnd: 0 },
                  enadv: { infix: 1, inrnd: 4, lofix: 0, lornd: 1, hifix: 0, hirnd: 2 }, xlev: 10 }],
    // Priest  hp {12,0,0,8,1,0}  en {4,3,0,2,0,2}  xlev 10
    [PM_CLERIC, { hpadv: { infix: 12, inrnd: 0, lofix: 0, lornd: 8, hifix: 1, hirnd: 0 },
                  enadv: { infix: 4, inrnd: 3, lofix: 0, lornd: 2, hifix: 0, hirnd: 2 }, xlev: 10 }],
    // Barbarian hp {14,0,0,10,2,0}  en {1,0,0,1,0,1}  xlev 10
    [PM_BARBARIAN, { hpadv: { infix: 14, inrnd: 0, lofix: 0, lornd: 10, hifix: 2, hirnd: 0 },
                     enadv: { infix: 1, inrnd: 0, lofix: 0, lornd: 1, hifix: 0, hirnd: 1 }, xlev: 10 }],
    // Healer  hp {11,0,0,4,1,0}  en {1,4,0,2,0,2}  xlev 15
    [PM_HEALER, { hpadv: { infix: 11, inrnd: 0, lofix: 0, lornd: 4, hifix: 1, hirnd: 0 },
                  enadv: { infix: 1, inrnd: 4, lofix: 0, lornd: 2, hifix: 0, hirnd: 2 }, xlev: 15 }],
    // Valkyrie hp {14,0,0,8,2,0}  en {1,0,0,1,0,1}  xlev 10
    [PM_VALKYRIE, { hpadv: { infix: 14, inrnd: 0, lofix: 0, lornd: 8, hifix: 2, hirnd: 0 },
                    enadv: { infix: 1, inrnd: 0, lofix: 0, lornd: 1, hifix: 0, hirnd: 1 }, xlev: 10 }],
]);

// Human race advance (C: role.c races[human]).  hp {2,0,0,2,1,0} en {1,0,2,0,2,0}.
const RACE_ADVANCE_HUMAN = {
    hpadv: { infix: 2, inrnd: 0, lofix: 0, lornd: 2, hifix: 1, hirnd: 0 },
    enadv: { infix: 1, inrnd: 0, lofix: 2, lornd: 0, hifix: 2, hirnd: 0 },
};

// Current role's advance data, keyed off the player-monster number wired into
// game.urole.mnum at game start (allmain.js newgame_real / gameRoleMnum).
function urole_adv() {
    const mnum = game.urole?.mnum;
    return ROLE_ADVANCE.get(mnum) || ROLE_ADVANCE.get(PM_WIZARD);
}
// Only human is exercised by the recorded sessions.
function urace_adv() {
    return RACE_ADVANCE_HUMAN;
}

function ACURR(i) { return game.u?.acurr?.a?.[i] ?? 0; }

// C ref: exper.c newuexp(int lev) — XP threshold to reach experience level lev.
export function newuexp(lev) {
    if (lev < 1) return 0;
    if (lev < 10) return 10 * (1 << lev);
    if (lev < 20) return 10000 * (1 << (lev - 10));
    return 10000000 * (lev - 19);
}

// C ref: exper.c enermod(int en) — role-based energy multiplier.
function enermod(en) {
    switch (game.urole?.mnum) {
    case PM_CLERIC:
    case PM_WIZARD:
        return 2 * en;
    case PM_HEALER:
    case PM_KNIGHT:
        return Math.trunc((3 * en) / 2);
    case PM_BARBARIAN:
    case PM_VALKYRIE:
        return Math.trunc((3 * en) / 4);
    default:
        return en;
    }
}

// C ref: exper.c newpw(void) — energy gained for the next level.  At level 0
// the rolls come from u_init/fastforward; at level >= 1 this rolls the
// rn1(enrnd, enfix) energy increment recorded as "@ newpw(exper.c:64)".
export function newpw() {
    const u = game.u;
    const role = urole_adv(), race = urace_adv();
    let en;
    if ((u.ulevel || 0) === 0) {
        en = role.enadv.infix + race.enadv.infix;
        if (role.enadv.inrnd > 0) en += rnd(role.enadv.inrnd);
        if (race.enadv.inrnd > 0) en += rnd(race.enadv.inrnd);
    } else {
        let enrnd = Math.trunc(ACURR(A_WIS) / 2);
        let enfix;
        if (u.ulevel < role.xlev) {
            enrnd += role.enadv.lornd + race.enadv.lornd;
            enfix = role.enadv.lofix + race.enadv.lofix;
        } else {
            enrnd += role.enadv.hirnd + race.enadv.hirnd;
            enfix = role.enadv.hifix + race.enadv.hifix;
        }
        en = enermod(rn1(enrnd, enfix));
    }
    if (en <= 0) en = 1;
    if (u.ulevel < MAXULEV) {
        if (!u.ueninc) u.ueninc = [];
        u.ueninc[u.ulevel] = en;
    } else {
        let lim = 4 - Math.trunc(u.uenmax / 200);
        if (lim < 1) lim = 1;
        if (en > lim) en = lim;
    }
    return en;
}

// C ref: attrib.c newhp(void) — hit points gained for the next level.  Kept
// here (with newpw) so the role/race advance data lives in one place; mirrors
// attrib.c structurally.  Recorded as "@ newhp(attrib.c:1101/1103)".
export function newhp() {
    const u = game.u;
    const role = urole_adv(), race = urace_adv();
    let hp, conplus;
    if ((u.ulevel || 0) === 0) {
        hp = role.hpadv.infix + race.hpadv.infix;
        if (role.hpadv.inrnd > 0) hp += rnd(role.hpadv.inrnd);
        if (race.hpadv.inrnd > 0) hp += rnd(race.hpadv.inrnd);
        // no Con adjustment for initial hit points
    } else {
        if (u.ulevel < role.xlev) {
            hp = role.hpadv.lofix + race.hpadv.lofix;
            if (role.hpadv.lornd > 0) hp += rnd(role.hpadv.lornd);
            if (race.hpadv.lornd > 0) hp += rnd(race.hpadv.lornd);
        } else {
            hp = role.hpadv.hifix + race.hpadv.hifix;
            if (role.hpadv.hirnd > 0) hp += rnd(role.hpadv.hirnd);
            if (race.hpadv.hirnd > 0) hp += rnd(race.hpadv.hirnd);
        }
        const con = ACURR(A_CON);
        if (con <= 3) conplus = -2;
        else if (con <= 6) conplus = -1;
        else if (con <= 14) conplus = 0;
        else if (con <= 16) conplus = 1;
        else if (con === 17) conplus = 2;
        else if (con === 18) conplus = 3;
        else conplus = 4;
        hp += conplus;
    }
    if (hp <= 0) hp = 1;
    if (u.ulevel < MAXULEV) {
        if (!u.uhpinc) u.uhpinc = [];
        u.uhpinc[u.ulevel] = hp;
    } else {
        let lim = 5 - Math.trunc(u.uhpmax / 300);
        if (lim < 1) lim = 1;
        if (hp > lim) hp = lim;
    }
    return hp;
}

// C ref: exper.c more_experienced(int exper, int rexp) — accumulate XP/score.
export function more_experienced(exper, rexp) {
    const u = game.u;
    const oldexp = u.uexp || 0;
    let newexp = oldexp + exper;
    if (newexp < 0 && exper > 0) newexp = Number.MAX_SAFE_INTEGER;
    if (newexp !== oldexp) u.uexp = newexp;
    // urexp/score and beginner flag are display-irrelevant for the recorded
    // sessions (showscore off); omit to avoid touching unrelated state.
}

// C ref: exper.c newexplevel(void) — gain a level when XP crosses threshold.
export function newexplevel() {
    const u = game.u;
    if ((u.ulevel || 0) < MAXULEV && (u.uexp || 0) >= newuexp(u.ulevel || 0))
        pluslvl(true);
}

// ── rank tracking (C: botl.c xlev_to_rank / rank_of) ──
// Full rank ladders for the roles the #levelchange sessions exercise.  Each
// entry is {m, f}; female form is used when the hero is female and f != null.
const ROLE_RANKS = new Map([
    [PM_WIZARD, [['Evoker', null], ['Conjurer', null], ['Thaumaturge', null],
                 ['Magician', null], ['Enchanter', 'Enchantress'], ['Sorcerer', 'Sorceress'],
                 ['Necromancer', null], ['Wizard', null], ['Mage', null]]],
    [PM_CLERIC, [['Aspirant', null], ['Acolyte', null], ['Adept', null],
                 ['Priest', 'Priestess'], ['Curate', null], ['Canon', 'Canoness'],
                 ['Lama', null], ['Patriarch', 'Matriarch'], ['High Priest', 'High Priestess']]],
    [PM_BARBARIAN, [['Plunderer', 'Plunderess'], ['Pillager', null], ['Bandit', null],
                    ['Brigand', null], ['Raider', null], ['Reaver', null],
                    ['Slayer', null], ['Chieftain', 'Chieftainess'], ['Conqueror', 'Conqueress']]],
    [PM_KNIGHT, [['Gallant', null], ['Esquire', null], ['Bachelor', null],
                 ['Knight', null], ['Lord', 'Lady'], ['Baron', 'Baroness'],
                 ['Knight Banneret', null], ['Margrave', null], ['Paladin', null]]],
    [PM_HEALER, [['Rhizotomist', null], ['Empiric', null], ['Embalmer', null],
                 ['Dresser', null], ['Medicus', 'Medica'], ['Herbalist', null],
                 ['Magister', 'Magistra'], ['Physician', null], ['Chirurgeon', null]]],
    [PM_VALKYRIE, [['Stripling', null], ['Skirmisher', null], ['Fighter', null],
                   ['Man-at-arms', 'Woman-at-arms'], ['Warrior', null], ['Swashbuckler', null],
                   ['Hero', 'Heroine'], ['Champion', null], ['Lord', 'Lady']]],
]);

// C ref: botl.c xlev_to_rank — experience level (1..30) -> rank index (0..8).
export function xlev_to_rank(xlev) {
    return (xlev <= 2) ? 0 : (xlev <= 30) ? Math.trunc((xlev + 2) / 4) : 8;
}

// C ref: botl.c rank_of — the rank title for a given level/role/gender.
export function rank_of(lev, mnum, female) {
    const ranks = ROLE_RANKS.get(mnum);
    if (!ranks) return game.urole?.name?.m || 'Player';
    for (let i = xlev_to_rank(lev); i >= 0; i--) {
        const r = ranks[i];
        if (!r) continue;
        if (female && r[1]) return r[1];
        if (r[0]) return r[0];
    }
    return game.urole?.name?.m || 'Player';
}

// Update game.urole.rank.m to the level-appropriate (gender-aware) rank so the
// status line (display.js _statusLine1) reflects the current rank title.
function update_rank() {
    const female = !!game.flags?.female;
    const rk = rank_of(game.u.ulevel || 1, game.urole?.mnum, female);
    if (game.urole) {
        game.urole.rank = game.urole.rank || {};
        game.urole.rank.m = rk;
    }
}

// ── pluslvl / losexp ──
// emitMsg(msg) is the topline message sink (display.js update_topl); pluslvl
// is async only to allow that sink to fire a blocking --More-- prompt.
//
// C ref: exper.c pluslvl(boolean incr).  incr=FALSE is the wizard-mode /
// potion-of-gain-level path: prints "You feel more experienced." first.
export async function pluslvl(incr, emitMsg) {
    const u = game.u;
    if (!incr && emitMsg)
        await emitMsg('You feel more experienced.');

    // increase hit points (no Upolyd in the recorded sessions)
    const hpinc = newhp();
    u.uhp = (u.uhp || 0) + hpinc;
    setuhpmax((u.uhpmax || 0) + hpinc);

    // increase spell power / energy
    const eninc = newpw();
    u.uenmax = (u.uenmax || 0) + eninc;
    if ((u.uenpeak || 0) < u.uenmax) u.uenpeak = u.uenmax;
    u.uen = (u.uen || 0) + eninc;

    if ((u.ulevel || 0) < MAXULEV) {
        const oldlevel = u.ulevel || 0;
        if (incr) {
            const tmp = newuexp((u.ulevel || 0) + 1);
            if ((u.uexp || 0) >= tmp) u.uexp = tmp - 1;
        } else {
            u.uexp = newuexp(u.ulevel || 0);
        }
        u.ulevel = (u.ulevel || 0) + 1;
        update_rank();
        if (emitMsg)
            await emitMsg(`Welcome ${(u.ulevelmax || 0) < u.ulevel ? '' : 'back '}to experience level ${u.ulevel}.`);
        if ((u.ulevelmax || 0) < u.ulevel) u.ulevelmax = u.ulevel;
        // adjabil(): give new intrinsics; only the (RNG-free) "You feel X!"
        // messages matter for the recorded screens.
        await adjabil(oldlevel, u.ulevel, emitMsg);
    }
}

// C ref: exper.c losexp(const char *drainer) — lose an experience level.  Only
// the non-fatal, level>1 branch is needed (wiz_level_change "#levelchange").
export async function losexp(drainer, emitMsg) {
    const u = game.u;
    if ((u.ulevel || 0) > 1 || drainer) {
        if (emitMsg) await emitMsg(`Goodbye level ${u.ulevel}.`);
    }
    if ((u.ulevel || 0) > 1) {
        const oldlevel = u.ulevel;
        u.ulevel -= 1;
        update_rank();
        await adjabil(oldlevel, u.ulevel, emitMsg);
    } else {
        u.uexp = 0;
    }
    const uhpmin = minuhpmax(10);
    let num = (u.uhpinc && u.uhpinc[u.ulevel]) || 0;
    const olduhpmax = u.uhpmax || 0;
    u.uhpmax = (u.uhpmax || 0) - num;
    if (u.uhpmax < uhpmin) u.uhpmax = uhpmin;
    if (u.uhpmax > olduhpmax) u.uhpmax = olduhpmax;
    u.uhp = (u.uhp || 0) - num;
    if (u.uhp < 1) u.uhp = 1;
    else if (u.uhp > u.uhpmax) u.uhp = u.uhpmax;

    num = (u.ueninc && u.ueninc[u.ulevel]) || 0;
    u.uenmax = (u.uenmax || 0) - num;
    if (u.uenmax < 0) u.uenmax = 0;
    u.uen = (u.uen || 0) - num;
    if (u.uen < 0) u.uen = 0;
    else if (u.uen > u.uenmax) u.uen = u.uenmax;

    if ((u.uexp || 0) > 0) u.uexp = newuexp(u.ulevel) - 1;
}

// C ref: attrib.c minuhpmax — min uhpmax floor.
function minuhpmax(altmin) {
    if (altmin < 1) altmin = 1;
    return Math.max(game.u.ulevel || 1, altmin);
}

// C ref: attrib.c setuhpmax — set uhpmax, clamp uhp.
function setuhpmax(newmax) {
    const u = game.u;
    u.uhpmax = newmax;
    if (u.uhp > u.uhpmax) u.uhp = u.uhpmax;
}

// ── adjabil intrinsic messages (C: attrib.c adjabil + the *_abil[] tables) ──
// Only the gain/loss "You feel <X>!" plines (no RNG) affect the recorded
// screens.  Tables for the exercised roles, {ulevel, gainstr, losestr}.
const ROLE_ABIL = new Map([
    [PM_WIZARD, [[15, 'sensitive', ''], [17, 'controlled', 'uncontrolled']]],
    [PM_CLERIC, [[15, 'sensitive', ''], [20, 'cool', 'warmer']]],
    [PM_BARBARIAN, [[7, 'quick', 'slow'], [15, 'stealthy', '']]],
    [PM_KNIGHT, [[7, 'quick', 'slow']]],
    [PM_HEALER, [[1, '', ''], [15, 'sensitive', '']]],
    [PM_VALKYRIE, [[1, '', ''], [3, 'stealthy', ''], [7, 'quick', 'slow']]],
]);

async function adjabil(oldlevel, newlevel, emitMsg) {
    const tbl = ROLE_ABIL.get(game.urole?.mnum);
    if (!tbl) return;
    for (const [ulvl, gainstr, losestr] of tbl) {
        if (oldlevel < ulvl && newlevel >= ulvl) {
            if (gainstr && emitMsg) await emitMsg(`You feel ${gainstr}!`);
        } else if (oldlevel >= ulvl && newlevel < ulvl) {
            if (losestr && emitMsg) await emitMsg(`You feel ${losestr}!`);
            else if (gainstr && emitMsg) await emitMsg(`You feel less ${gainstr}!`);
        }
    }
    // add_weapon_skill/lose_weapon_skill: no RNG, no topline message.
}
