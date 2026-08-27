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
import { races } from './roles.js';

// ── role / race advancement data (C: role.c roles[]/races[]) ──
// RoleAdvance = {infix, inrnd, lofix, lornd, hifix, hirnd}; xlev is the
// experience-level cutoff between the "lower" and "higher" advance brackets.
// PM_ indices match u_init.js / roles[].mnum (Archeologist=0 .. Wizard=12).
const PM_ARCHEOLOGIST = 0, PM_BARBARIAN = 1, PM_CAVE_DWELLER = 2,
      PM_HEALER = 3, PM_KNIGHT = 4, PM_MONK = 5, PM_CLERIC = 6,
      PM_RANGER = 7, PM_ROGUE = 8, PM_SAMURAI = 9, PM_TOURIST = 10,
      PM_VALKYRIE = 11, PM_WIZARD = 12;

// hpadv/enadv per role (the full 6-field advance struct {infix,inrnd,lofix,
// lornd,hifix,hirnd}), plus xlev.  Transcribed directly from NetHack 5.0
// src/role.c roles[]; the "Energy" comment in role.c labels the xlev line.
const ROLE_ADVANCE = new Map([
    // Archeologist hp {11,0,0,8,1,0}  en {1,0,0,1,0,1}  xlev 14
    [PM_ARCHEOLOGIST, { hpadv: { infix: 11, inrnd: 0, lofix: 0, lornd: 8, hifix: 1, hirnd: 0 },
                        enadv: { infix: 1, inrnd: 0, lofix: 0, lornd: 1, hifix: 0, hirnd: 1 }, xlev: 14 }],
    // Barbarian hp {14,0,0,10,2,0}  en {1,0,0,1,0,1}  xlev 10
    [PM_BARBARIAN, { hpadv: { infix: 14, inrnd: 0, lofix: 0, lornd: 10, hifix: 2, hirnd: 0 },
                     enadv: { infix: 1, inrnd: 0, lofix: 0, lornd: 1, hifix: 0, hirnd: 1 }, xlev: 10 }],
    // Caveman  hp {14,0,0,8,2,0}  en {1,0,0,1,0,1}  xlev 10
    [PM_CAVE_DWELLER, { hpadv: { infix: 14, inrnd: 0, lofix: 0, lornd: 8, hifix: 2, hirnd: 0 },
                        enadv: { infix: 1, inrnd: 0, lofix: 0, lornd: 1, hifix: 0, hirnd: 1 }, xlev: 10 }],
    // Healer  hp {11,0,0,8,1,0}  en {1,4,0,1,0,2}  xlev 20
    [PM_HEALER, { hpadv: { infix: 11, inrnd: 0, lofix: 0, lornd: 8, hifix: 1, hirnd: 0 },
                  enadv: { infix: 1, inrnd: 4, lofix: 0, lornd: 1, hifix: 0, hirnd: 2 }, xlev: 20 }],
    // Knight  hp {14,0,0,8,2,0}  en {1,4,0,1,0,2}  xlev 10
    [PM_KNIGHT, { hpadv: { infix: 14, inrnd: 0, lofix: 0, lornd: 8, hifix: 2, hirnd: 0 },
                  enadv: { infix: 1, inrnd: 4, lofix: 0, lornd: 1, hifix: 0, hirnd: 2 }, xlev: 10 }],
    // Monk  hp {12,0,0,8,1,0}  en {2,2,0,2,0,2}  xlev 10
    [PM_MONK, { hpadv: { infix: 12, inrnd: 0, lofix: 0, lornd: 8, hifix: 1, hirnd: 0 },
                enadv: { infix: 2, inrnd: 2, lofix: 0, lornd: 2, hifix: 0, hirnd: 2 }, xlev: 10 }],
    // Priest  hp {12,0,0,8,1,0}  en {4,3,0,2,0,2}  xlev 10
    [PM_CLERIC, { hpadv: { infix: 12, inrnd: 0, lofix: 0, lornd: 8, hifix: 1, hirnd: 0 },
                  enadv: { infix: 4, inrnd: 3, lofix: 0, lornd: 2, hifix: 0, hirnd: 2 }, xlev: 10 }],
    // Ranger  hp {13,0,0,6,1,0}  en {1,0,0,1,0,1}  xlev 12
    [PM_RANGER, { hpadv: { infix: 13, inrnd: 0, lofix: 0, lornd: 6, hifix: 1, hirnd: 0 },
                  enadv: { infix: 1, inrnd: 0, lofix: 0, lornd: 1, hifix: 0, hirnd: 1 }, xlev: 12 }],
    // Rogue  hp {10,0,0,8,1,0}  en {1,0,0,1,0,1}  xlev 11
    [PM_ROGUE, { hpadv: { infix: 10, inrnd: 0, lofix: 0, lornd: 8, hifix: 1, hirnd: 0 },
                 enadv: { infix: 1, inrnd: 0, lofix: 0, lornd: 1, hifix: 0, hirnd: 1 }, xlev: 11 }],
    // Samurai  hp {13,0,0,8,1,0}  en {1,0,0,1,0,1}  xlev 11
    [PM_SAMURAI, { hpadv: { infix: 13, inrnd: 0, lofix: 0, lornd: 8, hifix: 1, hirnd: 0 },
                   enadv: { infix: 1, inrnd: 0, lofix: 0, lornd: 1, hifix: 0, hirnd: 1 }, xlev: 11 }],
    // Tourist  hp {8,0,0,8,0,0}  en {1,0,0,1,0,1}  xlev 14
    [PM_TOURIST, { hpadv: { infix: 8, inrnd: 0, lofix: 0, lornd: 8, hifix: 0, hirnd: 0 },
                   enadv: { infix: 1, inrnd: 0, lofix: 0, lornd: 1, hifix: 0, hirnd: 1 }, xlev: 14 }],
    // Valkyrie hp {14,0,0,8,2,0}  en {1,0,0,1,0,1}  xlev 10
    [PM_VALKYRIE, { hpadv: { infix: 14, inrnd: 0, lofix: 0, lornd: 8, hifix: 2, hirnd: 0 },
                    enadv: { infix: 1, inrnd: 0, lofix: 0, lornd: 1, hifix: 0, hirnd: 1 }, xlev: 10 }],
    // Wizard  hp {10,0,0,8,1,0}  en {4,3,0,2,0,3}  xlev 12
    [PM_WIZARD, { hpadv: { infix: 10, inrnd: 0, lofix: 0, lornd: 8, hifix: 1, hirnd: 0 },
                  enadv: { infix: 4, inrnd: 3, lofix: 0, lornd: 2, hifix: 0, hirnd: 3 }, xlev: 12 }],
]);

// C ref: role.c races[].hpadv / .enadv — the full {infix,inrnd,lofix,lornd,
// hifix,hirnd} advance struct for all five player races.  newhp()/newpw() draw
// rnd(lornd) on every level-up, so a race whose lornd differs from human's
// (dwarf 3 vs 2 for HP, elf 1, gnome 1, orc 1) shifts the RNG stream — this
// table used to be human-only with every other race silently answering "human".
// Race keys are races[].mnum (0..4), a DIFFERENT numbering from the role PM_
// constants above — hence the separate RC_ names.
const RC_HUMAN = 0, RC_ELF = 1, RC_DWARF = 2, RC_GNOME = 3, RC_ORC = 4;
const RACE_ADVANCE = new Map([
    [RC_HUMAN, { hpadv: { infix: 2, inrnd: 0, lofix: 0, lornd: 2, hifix: 1, hirnd: 0 },
                 enadv: { infix: 1, inrnd: 0, lofix: 2, lornd: 0, hifix: 2, hirnd: 0 } }],
    [RC_ELF, { hpadv: { infix: 1, inrnd: 0, lofix: 0, lornd: 1, hifix: 1, hirnd: 0 },
               enadv: { infix: 2, inrnd: 0, lofix: 3, lornd: 0, hifix: 3, hirnd: 0 } }],
    [RC_DWARF, { hpadv: { infix: 4, inrnd: 0, lofix: 0, lornd: 3, hifix: 2, hirnd: 0 },
                 enadv: { infix: 0, inrnd: 0, lofix: 0, lornd: 0, hifix: 0, hirnd: 0 } }],
    [RC_GNOME, { hpadv: { infix: 1, inrnd: 0, lofix: 0, lornd: 1, hifix: 0, hirnd: 0 },
                 enadv: { infix: 2, inrnd: 0, lofix: 2, lornd: 0, hifix: 2, hirnd: 0 } }],
    [RC_ORC, { hpadv: { infix: 1, inrnd: 0, lofix: 0, lornd: 1, hifix: 0, hirnd: 0 },
               enadv: { infix: 1, inrnd: 0, lofix: 1, lornd: 0, hifix: 1, hirnd: 0 } }],
]);

// Current role's advance data, keyed off the player-monster number wired into
// game.urole.mnum at game start (allmain.js newgame_real / gameRoleMnum).
function urole_adv() {
    const mnum = game.urole?.mnum;
    return ROLE_ADVANCE.get(mnum) || ROLE_ADVANCE.get(PM_WIZARD);
}
// C ref: gu.urace — the selected race's role.c entry.  game.initrace is the
// races[] index (or its name); races[].mnum is the PM_HUMAN..PM_ORC key.
export function urace_mnum() {
    if (Number.isInteger(game.initrace))
        return races[game.initrace]?.mnum ?? game.initrace;
    const nm = String(game.initrace || '').toLowerCase();
    return races.find((r) => r.name?.toLowerCase() === nm)?.mnum ?? RC_HUMAN;
}
function urace_adv() {
    return RACE_ADVANCE.get(urace_mnum()) || RACE_ADVANCE.get(RC_HUMAN);
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
// urexp (score) is the running reward-experience total, incremented by
// rexpincr = 4*exper + rexp.  It is not shown on the status line (showscore
// off in the recorded rc) but IS displayed on the death tombstone / score
// summary (end.c really_done / rip.c), so keep it current.
export function more_experienced(exper, rexp) {
    const u = game.u;
    const oldexp = u.uexp || 0;
    let newexp = oldexp + exper;
    if (newexp < 0 && exper > 0) newexp = Number.MAX_SAFE_INTEGER;
    if (newexp !== oldexp) u.uexp = newexp;

    const oldrexp = u.urexp || 0;
    const rexpincr = 4 * exper + (rexp || 0);
    let newrexp = oldrexp + rexpincr;
    if (newrexp < 0 && rexpincr > 0) newrexp = Number.MAX_SAFE_INTEGER;
    if (newrexp !== oldrexp) u.urexp = newrexp;
}

// C ref: exper.c newexplevel(void) — gain a level when XP crosses threshold.
// C ref: exper.c pluslvl() emits its "Welcome ... to experience level N." with a
// plain pline(), so the sink is NOT optional — leaving it off dropped the whole
// message on every kill-driven level gain (and the --More-- boundary with it).
export async function newexplevel() {
    const u = game.u;
    if ((u.ulevel || 0) < MAXULEV && (u.uexp || 0) >= newuexp(u.ulevel || 0)) {
        const { update_topl } = await import('./display.js');
        await pluslvl(true, update_topl);
    }
}

// ── rank tracking (C: botl.c xlev_to_rank / rank_of) ──
// Full rank ladders for every role, transcribed from NetHack 5.0 src/role.c
// roles[].rank[].  Each entry is {m, f}; the female form is used when the hero
// is female and f != null.
const ROLE_RANKS = new Map([
    [PM_ARCHEOLOGIST, [['Digger', null], ['Field Worker', null], ['Investigator', null],
                       ['Exhumer', null], ['Excavator', null], ['Spelunker', null],
                       ['Speleologist', null], ['Collector', null], ['Curator', null]]],
    [PM_BARBARIAN, [['Plunderer', 'Plunderess'], ['Pillager', null], ['Bandit', null],
                    ['Brigand', null], ['Raider', null], ['Reaver', null],
                    ['Slayer', null], ['Chieftain', 'Chieftainess'], ['Conqueror', 'Conqueress']]],
    [PM_CAVE_DWELLER, [['Troglodyte', null], ['Aborigine', null], ['Wanderer', null],
                       ['Vagrant', null], ['Wayfarer', null], ['Roamer', null],
                       ['Nomad', null], ['Rover', null], ['Pioneer', null]]],
    [PM_HEALER, [['Rhizotomist', null], ['Empiric', null], ['Embalmer', null],
                 ['Dresser', null], ['Medicus ossium', 'Medica ossium'], ['Herbalist', null],
                 ['Magister', 'Magistra'], ['Physician', null], ['Chirurgeon', null]]],
    [PM_KNIGHT, [['Gallant', null], ['Esquire', null], ['Bachelor', null],
                 ['Sergeant', null], ['Knight', null], ['Banneret', null],
                 ['Chevalier', 'Chevaliere'], ['Seignieur', 'Dame'], ['Paladin', null]]],
    [PM_MONK, [['Candidate', null], ['Novice', null], ['Initiate', null],
               ['Student of Stones', null], ['Student of Waters', null], ['Student of Metals', null],
               ['Student of Winds', null], ['Student of Fire', null], ['Master', null]]],
    [PM_CLERIC, [['Aspirant', null], ['Acolyte', null], ['Adept', null],
                 ['Priest', 'Priestess'], ['Curate', null], ['Canon', 'Canoness'],
                 ['Lama', null], ['Patriarch', 'Matriarch'], ['High Priest', 'High Priestess']]],
    [PM_RANGER, [['Tenderfoot', null], ['Lookout', null], ['Trailblazer', null],
                 ['Reconnoiterer', 'Reconnoiteress'], ['Scout', null], ['Arbalester', null],
                 ['Archer', null], ['Sharpshooter', null], ['Marksman', 'Markswoman']]],
    [PM_ROGUE, [['Footpad', null], ['Cutpurse', null], ['Rogue', null],
                ['Pilferer', null], ['Robber', null], ['Burglar', null],
                ['Filcher', null], ['Magsman', 'Magswoman'], ['Thief', null]]],
    [PM_SAMURAI, [['Hatamoto', null], ['Ronin', null], ['Ninja', 'Kunoichi'],
                  ['Joshu', null], ['Ryoshu', null], ['Kokushu', null],
                  ['Daimyo', null], ['Kuge', null], ['Shogun', null]]],
    [PM_TOURIST, [['Rambler', null], ['Sightseer', null], ['Excursionist', null],
                  ['Peregrinator', 'Peregrinatrix'], ['Traveler', null], ['Journeyer', null],
                  ['Voyager', null], ['Explorer', null], ['Adventurer', null]]],
    [PM_VALKYRIE, [['Stripling', null], ['Skirmisher', null], ['Fighter', null],
                   ['Man-at-arms', 'Woman-at-arms'], ['Warrior', null], ['Swashbuckler', null],
                   ['Hero', 'Heroine'], ['Champion', null], ['Lord', 'Lady']]],
    [PM_WIZARD, [['Evoker', null], ['Conjurer', null], ['Thaumaturge', null],
                 ['Magician', null], ['Enchanter', 'Enchantress'], ['Sorcerer', 'Sorceress'],
                 ['Necromancer', null], ['Wizard', null], ['Mage', null]]],
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
export function update_rank() {
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
        // C ref: exper.c:340 — oldrank is snapshotted BEFORE ++u.ulevel.
        const oldrank = xlev_to_rank(oldlevel);
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
        // C ref: exper.c:358 — crossing into a new rank is an achievement, and
        // it is the ORDER of u.uachieved that #conduct prints, so this has to
        // run here rather than be derived from the final level.
        const newrank = xlev_to_rank(u.ulevel);
        if (newrank > oldrank) {
            // Dynamic import: insight.js -> u_init.js -> mkobj.js is a static
            // cycle this file must not join.
            const I = await import('./insight.js');
            I.record_achievement(I.achieve_rank(newrank));
        }
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
export function minuhpmax(altmin) {
    if (altmin < 1) altmin = 1;
    return Math.max(game.u.ulevel || 1, altmin);
}

// C ref: attrib.c setuhpmax — set uhpmax, clamp uhp.
export function setuhpmax(newmax) {
    const u = game.u;
    u.uhpmax = newmax;
    if (u.uhp > u.uhpmax) u.uhp = u.uhpmax;
}

// ── innate intrinsics (C: attrib.c adjabil + the *_abil[] tables) ──
// Rows are {ulevel, gainstr, losestr, prop} transcribed from attrib.c
// *_abil[]; `prop` is the H<Property> long the row toggles.  An empty
// gainstr/losestr suppresses the "You feel <X>!" pline.
const ROLE_ABIL = new Map([
    [PM_ARCHEOLOGIST, [[1, '', '', 'HSearching'], [5, 'stealthy', '', 'HStealth'],
                       [10, 'quick', 'slow', 'HFast']]],
    [PM_BARBARIAN, [[1, '', '', 'HPoison_resistance'], [7, 'quick', 'slow', 'HFast'],
                    [15, 'stealthy', '', 'HStealth']]],
    [PM_CAVE_DWELLER, [[7, 'quick', 'slow', 'HFast'], [15, 'sensitive', '', 'HWarning']]],
    [PM_HEALER, [[1, '', '', 'HPoison_resistance'], [15, 'sensitive', '', 'HWarning']]],
    [PM_KNIGHT, [[7, 'quick', 'slow', 'HFast']]],
    [PM_MONK, [[1, '', '', 'HFast'], [1, '', '', 'HSleep_resistance'],
               [1, '', '', 'HSee_invisible'], [3, 'healthy', '', 'HPoison_resistance'],
               [5, 'stealthy', '', 'HStealth'], [7, 'sensitive', '', 'HWarning'],
               [9, 'perceptive', 'unaware', 'HSearching'],
               [11, 'cool', 'warmer', 'HFire_resistance'],
               [13, 'warm', 'cooler', 'HCold_resistance'],
               [15, 'insulated', 'conductive', 'HShock_resistance'],
               [17, 'controlled', 'uncontrolled', 'HTeleport_control']]],
    [PM_CLERIC, [[15, 'sensitive', '', 'HWarning'], [20, 'cool', 'warmer', 'HFire_resistance']]],
    [PM_RANGER, [[1, '', '', 'HSearching'], [7, 'stealthy', '', 'HStealth'],
                 [15, '', '', 'HSee_invisible']]],
    [PM_ROGUE, [[1, '', '', 'HStealth'], [10, 'perceptive', '', 'HSearching']]],
    [PM_SAMURAI, [[1, '', '', 'HFast'], [15, 'stealthy', '', 'HStealth']]],
    [PM_TOURIST, [[10, 'perceptive', '', 'HSearching'], [20, 'hardy', '', 'HPoison_resistance']]],
    [PM_VALKYRIE, [[1, '', '', 'HCold_resistance'], [3, 'stealthy', '', 'HStealth'],
                   [7, 'quick', 'slow', 'HFast']]],
    [PM_WIZARD, [[15, 'sensitive', '', 'HWarning'],
                 [17, 'controlled', 'uncontrolled', 'HTeleport_control']]],
]);

// C ref: attrib.c dwa_abil[]/elf_abil[]/gno_abil[]/orc_abil[]/hum_abil[].
// adjabil() only walks elf_abil/orc_abil (its switch maps DWARF and GNOME to
// NULL); the dwarf/gnome Infravision row is unreachable there, so it is not
// listed here either — vision.js Infravision() derives that from mflags3.
const RACE_ABIL = new Map([
    [RC_ELF, [[1, '', '', 'HInfravision'], [4, 'awake', 'tired', 'HSleep_resistance']]],
    [RC_ORC, [[1, '', '', 'HInfravision'], [1, '', '', 'HPoison_resistance']]],
]);

// The innate intrinsics the hero holds right now.  C keeps these as
// FROMEXPER/FROMRACE bits in u.uprops[]; here they are a pure function of
// role/race/ulevel, which is equivalent because nothing else sets or clears
// those two bits.
export function innate_intrinsics(ulevel = game.u?.ulevel || 0) {
    const s = new Set();
    for (const tbl of [ROLE_ABIL.get(game.urole?.mnum), RACE_ABIL.get(urace_mnum())])
        for (const [ulvl, , , prop] of tbl || [])
            if (ulevel >= ulvl) s.add(prop);
    return s;
}
export function has_innate(prop, ulevel) { return innate_intrinsics(ulevel).has(prop); }

// C ref: attrib.c:864 innately(ability) — WHICH table conferred an intrinsic,
// which is what from_what() turns into English.  A FROMEXPER (role) row reports
// FROM_ROLE when its ulevel is 1 and FROM_EXP otherwise; a FROMRACE row is
// FROM_RACE whatever its level.  Returns null when neither table grants it.
export function innate_source(prop, ulevel = game.u?.ulevel || 0) {
    for (const [ulvl, , , p] of ROLE_ABIL.get(game.urole?.mnum) || [])
        if (p === prop && ulevel >= ulvl) return (ulvl === 1) ? 'role' : 'exp';
    for (const [ulvl, , , p] of RACE_ABIL.get(urace_mnum()) || [])
        if (p === prop && ulevel >= ulvl) return 'race';
    return null;
}

export async function adjabil(oldlevel, newlevel, emitMsg) {
    const role = ROLE_ABIL.get(game.urole?.mnum) || [];
    const race = RACE_ABIL.get(urace_mnum()) || [];
    // C: `if (!(*ability & INTRINSIC & ~mask))` — a gain/loss message is
    // suppressed when the OTHER table (role vs race) also confers the property.
    const alsoFrom = (other, prop, lvl) =>
        other.some(([ulvl, , , p]) => p === prop && lvl >= ulvl);
    for (const [tbl, other] of [[role, race], [race, role]]) {
        for (const [ulvl, gainstr, losestr, prop] of tbl) {
            if (oldlevel < ulvl && newlevel >= ulvl) {
                if (alsoFrom(other, prop, newlevel)) continue;
                if (gainstr && emitMsg) await emitMsg(`You feel ${gainstr}!`);
            } else if (oldlevel >= ulvl && newlevel < ulvl) {
                if (alsoFrom(other, prop, newlevel)) continue;
                if (losestr && emitMsg) await emitMsg(`You feel ${losestr}!`);
                else if (gainstr && emitMsg) await emitMsg(`You feel less ${gainstr}!`);
            }
        }
    }
    // add_weapon_skill/lose_weapon_skill: no RNG, no topline message.
}
