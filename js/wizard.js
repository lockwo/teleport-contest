// wizard.js — C ref: src/wizard.c.
//
// aggravate() (monmove.js/spell.js), cuss() (monmove.js), has_aggravatables()
// (mcastu.js), choose_stairs() (shkroom.js) and pick_nasty()/nasties[]
// (makemon.js) were already ported into the files that call them.  What was
// missing is the Wizard's own bookkeeping and, more importantly, nasty() —
// mcastu.c's "summon nasties" spell reached a `default:` that drew nothing.

import { game } from './gstate.js';
import { rn2, rnd, rn1 } from './rng.js';
import { update_topl } from './display.js';
import { AT_MAGC, attacktype } from './monattk_data.js';

const AMULET_OF_YENDOR = 213;           // js/mkobj.js OBJECT_DATA index
const MAGIC_PORTAL = 24;                // trap.h ttyp
const STRAT_WAITMASK = 0x03000000;
const MAXNASTIES = 10;
const S_ANGEL = 27, S_DEMON = 56;       // defsym.h MONSYM indices
const MM_NOMSG = 0x40;                  // makemon.h

function DEADMONSTER(m) { return !m || (m.mhp | 0) <= 0; }
function mdata(m) { return m?.data || m?.mdat || null; }
function monsterList() { return (game.level?.monsters || []); }
function sgn(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
function distu(x, y) {
    const u = game.u;
    return (x - u.ux) * (x - u.ux) + (y - u.uy) * (y - u.uy);
}

// C ref: wizard.c:106 mon_has_amulet(mtmp).
export function mon_has_amulet(mtmp) {
    for (const otmp of (mtmp?.minvent || []))
        if (otmp.otyp === AMULET_OF_YENDOR) return true;
    return false;
}

// C ref: wizard.c:117 mon_has_special(mtmp) — the Amulet, the Book, a quest
// artifact or a piece of the invocation kit.
const CANDELABRUM_OF_INVOCATION = 262, BELL_OF_OPENING = 263,
      SPE_BOOK_OF_THE_DEAD = 409;
export function mon_has_special(mtmp) {
    for (const otmp of (mtmp?.minvent || [])) {
        if (otmp.otyp === AMULET_OF_YENDOR
            || otmp.otyp === CANDELABRUM_OF_INVOCATION
            || otmp.otyp === BELL_OF_OPENING
            || otmp.otyp === SPE_BOOK_OF_THE_DEAD
            || otmp.oartifact)
            return true;
    }
    return false;
}

// C ref: wizard.c:61 amulet() — runs EVERY turn once the hero carries the
// Amulet.  Two live draws: rn2(15) for the portal-warmth hint (only when the
// Amulet is worn or wielded) and rn2(40) per sleeping Wizard.
export async function amulet() {
    const u = game.u;
    let amu = null;
    if (u?.uamul && u.uamul.otyp === AMULET_OF_YENDOR) amu = u.uamul;
    else if (u?.uwep && u.uwep.otyp === AMULET_OF_YENDOR) amu = u.uwep;
    if (amu && !rn2(15)) {
        for (const ttmp of (game.level?.traps || [])) {
            if (ttmp.ttyp === MAGIC_PORTAL) {
                const du = distu(ttmp.tx, ttmp.ty);
                if (du <= 9) await update_topl('Your amulet feels hot!');
                else if (du <= 64) await update_topl('Your amulet feels very warm.');
                else if (du <= 144) await update_topl('Your amulet feels warm.');
                break;
            }
        }
    }
    if (!(game.context?.no_of_wizards | 0)) return;
    for (const mtmp of monsterList()) {
        if (DEADMONSTER(mtmp)) continue;
        if (mtmp.iswiz && mtmp.msleeping && !rn2(40)) {
            mtmp.msleeping = 0;
            if (!m_next2u(mtmp))
                await update_topl('You get the creepy feeling that somebody '
                                  + 'noticed your taking the Amulet.');
            return;
        }
    }
}

// C ref: mon.c m_next2u(mtmp) — adjacent to the hero.
function m_next2u(mtmp) {
    const u = game.u;
    return Math.abs(mtmp.mx - u.ux) <= 1 && Math.abs(mtmp.my - u.uy) <= 1;
}

// C ref: wizard.c:517 clonewiz() — the Wizard's double.  The clone carries no
// Amulet (a fake one instead) and cannot itself clone.
export async function clonewiz() {
    const { makemon, monster_by_pmidx, name_to_pmidx } = await import('./makemon.js');
    const pmidx = name_to_pmidx('Wizard of Yendor');
    const mtmp2 = makemon(monster_by_pmidx(pmidx), game.u.ux, game.u.uy, MM_NOMSG);
    if (mtmp2) {
        mtmp2.msleeping = 0;
        mtmp2.mtame = 0;
        mtmp2.mpeaceful = 0;
        // C: "won't be able to make more clones"; the fake Amulet keeps his
        // strategy code targeting the hero.
        mtmp2.iswiz = 1;
        game.context = game.context || {};
        game.context.no_of_wizards = (game.context.no_of_wizards | 0) + 1;
    }
    return mtmp2;
}

// C ref: mon.c monster_census(spotted) — how many monsters are on the level.
function monster_census() {
    let count = 0;
    for (const mtmp of monsterList()) if (!DEADMONSTER(mtmp)) count++;
    return count;
}

// C ref: wizard.c:591 nasty(summoner) — the "summon nasties" spell and the
// post-Wizard harassment.  Returns how many monsters were actually created.
//
// RNG order per outer iteration: rnd(tmp) picks the iteration count, then for
// each inner slot up to 10 pick_nasty(difcap) rolls (each an rn2(44), doubled
// on the rogue level), one enexto(), one makemon() and rnd(4) for mspec_used.
export async function nasty(summoner) {
    const M = await import('./makemon.js');
    const u = game.u;
    const mmflags = summoner ? MM_NOMSG : 0;
    const census = monster_census();
    let count = 0;

    // C: `if (!rn2(10) && Inhell) count = msummon(NULL)` — msummon (minion.c)
    // is unported, so the rn2(10) is still drawn but the Gehennom demon-summon
    // arm falls through to the ordinary loop rather than being guessed at.
    const hell_summon = (!rn2(10) && In_hell());
    if (hell_summon) return 0;

    const s_cls = summoner ? (mdata(summoner)?.mcls | 0) : 0;
    let difcap = summoner ? (mdata(summoner)?.difficulty | 0) : 0;
    const castalign = summoner ? sgn(mdata(summoner)?.maligntyp | 0) : 0;
    let tmp = ((u.ulevel | 0) > 3) ? Math.trunc((u.ulevel | 0) / 3) : 1;
    const bypos = { x: u.ux, y: u.uy };

    for (let i = rnd(tmp); i > 0 && count < MAXNASTIES; --i) {
        for (let j = 0; j < 20; j++) {
            let makeindex, m_cls, trylimit = 10 + 1, gave_up = false;
            for (;;) {
                if (!--trylimit) { gave_up = true; break; }
                makeindex = M.pick_nasty(difcap);
                const mp = M.monster_by_pmidx(makeindex);
                m_cls = mp?.mcls | 0;
                if (!((difcap > 0 && (mp?.difficulty | 0) >= difcap
                       && attacktype(mp, AT_MAGC))
                      || (s_cls === S_DEMON && m_cls === S_ANGEL)
                      || (s_cls === S_ANGEL && m_cls === S_DEMON)))
                    break;
            }
            if (gave_up) continue;                     /* C: goto nextj */

            const mp = M.monster_by_pmidx(makeindex);
            if (summoner) {
                const spot = M.enexto_spawn(summoner.mux ?? summoner.mx,
                                            summoner.muy ?? summoner.my, mp);
                if (!spot) continue;
                bypos.x = spot.x; bypos.y = spot.y;
            }
            let mtmp = M.makemon(mp, bypos.x, bypos.y, mmflags);
            if (mtmp) {
                mtmp.msleeping = 0; mtmp.mpeaceful = 0; mtmp.mtame = 0;
                M.set_malign(mtmp);
            } else {
                // Random substitute for a genocided selection.
                mtmp = M.makemon(null, bypos.x, bypos.y, mmflags);
                if (mtmp) {
                    m_cls = mdata(mtmp)?.mcls | 0;
                    if ((difcap > 0 && (mdata(mtmp)?.difficulty | 0) >= difcap
                         && rn2(In_endgame() ? 3 : 7)
                         && attacktype(mdata(mtmp), AT_MAGC))
                        || (s_cls === S_DEMON && m_cls === S_ANGEL)
                        || (s_cls === S_ANGEL && m_cls === S_DEMON)) {
                        unmakemon(mtmp);
                        mtmp = null;
                    }
                }
            }

            if (mtmp) {
                const nm = mdata(mtmp)?.name;
                if (nm === 'arch-lich' || nm === 'Archon') {
                    // C: min(Archon difficulty 26, arch-lich difficulty 31).
                    const cap = 26;
                    if (!difcap || difcap > cap) difcap = cap;
                }
                mtmp.mspec_used = rnd(4);              /* delay first spell */
                if (++count >= MAXNASTIES
                    || (mdata(mtmp)?.maligntyp | 0) === 0
                    || sgn(mdata(mtmp)?.maligntyp | 0) === castalign)
                    break;
            }
        }
    }

    if (count) count = monster_census() - census;
    return count;
}

// C ref: makemon.c unmakemon(mon, flags) — undo a just-made monster.
function unmakemon(mtmp) {
    const list = game.level?.monsters;
    if (list) {
        const i = list.indexOf(mtmp);
        if (i >= 0) list.splice(i, 1);
    }
}

// C ref: wizard.c:815 wizdeadorgone() — the Wizard leaves play for good.
export function wizdeadorgone() {
    game.context = game.context || {};
    game.context.no_of_wizards = (game.context.no_of_wizards | 0) - 1;
    const u = game.u;
    if (!u) return;
    u.uevent = u.uevent || {};
    if (!u.uevent.udemigod) {
        u.uevent.udemigod = true;
        u.udg_cnt = rn1(250, 50);
    }
}

// C ref: wizard.c:785 intervene() — divine harassment after the Wizard dies.
// rnd(4) on the Astral plane (cases 1-4 only), otherwise rn2(6).
export async function intervene() {
    const which = Is_astralevel() ? rnd(4) : rn2(6);
    switch (which) {
    case 0:
    case 1:
        await update_topl('You feel vaguely nervous.');
        break;
    case 2: {
        if (!Blind()) await update_topl('You notice a black glow surrounding you.');
        const { rndcurse } = await import('./zap.js').catch(() => ({ rndcurse: null }));
        if (rndcurse) await rndcurse();
        break;
    }
    case 3:
        // C ref: wizard.c:494 aggravate() — one rn2(5) per immobilised monster.
        // js/monmove.js and js/spell.js each keep a private copy; inlined here
        // rather than exporting a third caller into either of them.
        for (const mtmp of monsterList()) {
            if (DEADMONSTER(mtmp)) continue;
            mtmp.mstrategy = (mtmp.mstrategy | 0) & ~STRAT_WAITMASK;
            mtmp.msleeping = 0;
            if (!mtmp.mcanmove && !rn2(5)) { mtmp.mfrozen = 0; mtmp.mcanmove = 1; }
        }
        break;
    case 4:
        await nasty(null);
        break;
    case 5:
        // resurrect(): brings the Wizard back.  The makemon half is faithful;
        // the migrating_mons half needs mon_catchup_elapsed_time/mon_arrive,
        // neither of which this port carries.
        await resurrect();
        break;
    }
}

// C ref: wizard.c:715 resurrect() — only the "make a new Wizard" arm; the
// migrating-Wizard arm draws rn2(elapsed + 1) which needs migrating_mons.
export async function resurrect() {
    if ((game.context?.no_of_wizards | 0)) return;
    const { makemon, monster_by_pmidx, name_to_pmidx, set_malign }
        = await import('./makemon.js');
    const MM_NOWAIT = 0x08;
    const mtmp = makemon(monster_by_pmidx(name_to_pmidx('Wizard of Yendor')),
                         game.u.ux, game.u.uy, MM_NOWAIT);
    if (!mtmp) return;
    mtmp.mrevived = 1;
    mtmp.mstrategy = (mtmp.mstrategy | 0) & ~STRAT_WAITMASK;
    mtmp.mtame = 0; mtmp.mpeaceful = 0;
    set_malign(mtmp);
    if (!Deaf()) {
        await update_topl('A voice booms out...');
        await update_topl('"So thou thought thou couldst kill me, fool."');
    }
}

function uprop(...names) {
    const p = game.u?.uprops || {};
    for (const n of names) if ((p[n] | 0) > 0 || p[n] === true) return true;
    return false;
}
function Deaf() { return uprop('Deaf', 'HDeaf', 'EDeaf'); }
function Blind() { return uprop('Blinded') || !!game.u?.Blinded; }
function In_hell() { return !!game.level?.flags?.hellish || !!game.u?.uz?.inhell; }
function Is_astralevel() { return !!game.level?.flags?.is_astral; }
// C ref: dungeon.c In_endgame(&u.uz) — the Planes (dnum == the endgame dnum).
function In_endgame() { return !!game.level?.flags?.is_astral || !!game.u?.uz?.in_endgame; }

// ═══════════════════════════════════════════════════════════════════════════
// wizard.c completion — the covetous-monster strategy/tactics machinery, the
// eight routines coverage.mjs --file=wizard.c listed as missing.  Nothing above
// this line calls into the block.
//
// strategy() decides WHAT a covetous monster attempts and tactics() implements
// it.  tactics() is the RNG-bearing half: rn2(3 + mhp/10) for the W-tower
// rloc, rnd(8) for the self-heal, rn2(mflee ? 33 : 5) for the harass mnexto,
// and rn2(5) for the "a monster is standing on my target" nudge.
// ═══════════════════════════════════════════════════════════════════════════

// C ref: monst.h mflags3 M3_WANTS* (js/monflags_data.js:82-87).
const M3_WANTSAMUL = 0x1, M3_WANTSBELL = 0x2, M3_WANTSBOOK = 0x4,
    M3_WANTSCAND = 0x8, M3_WANTSARTI = 0x10;
// C ref: monst.h STRAT_* (js/const.js:1321-1332).
const STRAT_APPEARMSG = 0x80000000, STRAT_HEAL = 0x08000000,
    STRAT_GROUND = 0x04000000, STRAT_MONSTR = 0x02000000,
    STRAT_PLAYER = 0x01000000, STRAT_NONE = 0x00000000,
    STRAT_STRATMASK = 0x0f000000, STRAT_GOAL = 0x000000ff;
// C ref: obj.h:271 any_quest_artifact(o) == (o->oartifact >=
// ART_ORB_OF_DETECTION).  js/invent.js:370 keeps a stub that always answers
// FALSE; this is the real test.  (js/artifact.js:233 fixes the ordinal at 21.)
const ART_ORB_OF_DETECTION = 21;
function any_quest_artifact(o) { return (o?.oartifact | 0) >= ART_ORB_OF_DETECTION; }
// C ref: hack.h BOLT_LIM.
const BOLT_LIM_WIZ = 8;
// C ref: teleport.h RLOC_MSG.
const RLOC_MSG = 0x02;
// C ref: wizard.c:139 M_Wants(mask) == (mtmp->data->mflags3 & (mask)).
function M_Wants(mtmp, mask) { return ((mdata(mtmp)?.mflags3 | 0) & mask) !== 0; }
// C ref: mkobj.c fobj — every object lying on the level's floor, in chain
// order.  This port keeps one array per level and tags each entry's location.
function floorObjects() {
    return (game.level?.objects || []).filter((o) => o.where === 'floor');
}
// C ref: display.h u_at(x, y).
function u_at(x, y) { return game.u?.ux === x && game.u?.uy === y; }
// C ref: display.h MON_AT(x, y).
function MON_AT(x, y) {
    for (const m of monsterList())
        if (!DEADMONSTER(m) && m.mx === x && m.my === y) return true;
    return false;
}
// C ref: hacklib.c isok(x, y).
function isok_wiz(x, y) { return x >= 1 && x < 80 && y >= 0 && y < 21; }

// ─── wizard.c:142 which_arti(mask) ─────────────────────────────────────────
// The otyp the given M3_WANTS* bit is after; 0 means "the quest artifact",
// which is not an object type.
export function which_arti(mask) {
    switch (mask) {
    case M3_WANTSAMUL: return AMULET_OF_YENDOR;
    case M3_WANTSBELL: return BELL_OF_OPENING;
    case M3_WANTSCAND: return CANDELABRUM_OF_INVOCATION;
    case M3_WANTSBOOK: return SPE_BOOK_OF_THE_DEAD;
    default: break;   /* 0 signifies quest artifact */
    }
    return 0;
}

// ─── wizard.c:165 mon_has_arti(mtmp, otyp) ─────────────────────────────────
// "If 'otyp' is zero, it triggers a check for the quest_artifact, since bell,
// book, candle, and amulet are all objects, not really artifacts right now."
export function mon_has_arti(mtmp, otyp) {
    for (const otmp of (mtmp?.minvent || [])) {
        if (otyp) {
            if (otmp.otyp === otyp) return true;
        } else if (any_quest_artifact(otmp)) {
            return true;
        }
    }
    return false;
}

// ─── wizard.c:184 other_mon_has_arti(mtmp, otyp) ───────────────────────────
// Some monster OTHER than mtmp that has it, or null.  Note there is no
// DEADMONSTER() filter here: C's comment is "no need ... since they have no
// inventory".
export function other_mon_has_arti(mtmp, otyp) {
    for (const mtmp2 of monsterList())
        if (mtmp2 !== mtmp)
            if (mon_has_arti(mtmp2, otyp))
                return mtmp2;
    return null;
}

// ─── wizard.c:202 on_ground(otyp) ──────────────────────────────────────────
// The first object of that type lying on the floor anywhere on the level.
export function on_ground(otyp) {
    for (const otmp of floorObjects()) {
        if (otyp) {
            if (otmp.otyp === otyp) return otmp;
        } else if (any_quest_artifact(otmp)) {
            return otmp;
        }
    }
    return null;
}

// ─── wizard.c:216 you_have(mask) ───────────────────────────────────────────
export function you_have(mask) {
    const uhave = game.u?.uhave || {};
    switch (mask) {
    case M3_WANTSAMUL: return !!uhave.amulet;
    case M3_WANTSBELL: return !!uhave.bell;
    case M3_WANTSCAND: return !!uhave.menorah;
    case M3_WANTSBOOK: return !!uhave.book;
    case M3_WANTSARTI: return !!uhave.questart;
    default: break;
    }
    return false;
}

// ─── wizard.c:236 target_on(mask, mtmp) ────────────────────────────────────
// Does mtmp want the thing `mask` names, and if so where is it?  Writes
// mtmp->mgoal and returns STRAT_PLAYER / STRAT_GROUND / STRAT_MONSTR ORed with
// the mask, or STRAT_NONE (which also zeroes mgoal).
export async function target_on(mask, mtmp) {
    if (!M_Wants(mtmp, mask))
        return STRAT_NONE;

    const otyp = which_arti(mask);
    if (!mon_has_arti(mtmp, otyp)) {
        let otmp, mtmp2;
        if (you_have(mask)) {
            mtmp.mgoal = { x: game.u.ux, y: game.u.uy };
            return (STRAT_PLAYER | mask);
        } else if ((otmp = on_ground(otyp))) {
            mtmp.mgoal = { x: otmp.ox, y: otmp.oy };
            return (STRAT_GROUND | mask);
        } else if ((mtmp2 = other_mon_has_arti(mtmp, otyp))
                 /* when seeking the Amulet, avoid targeting the Wizard or
                    temple priests (to protect Moloch's high priest) */
                 && (otyp !== AMULET_OF_YENDOR
                     || (!mtmp2.iswiz && !await inhistemple_wiz(mtmp2)))) {
            mtmp.mgoal = { x: mtmp2.mx, y: mtmp2.my };
            return (STRAT_MONSTR | mask);
        }
    }
    mtmp.mgoal = { x: 0, y: 0 };
    return STRAT_NONE;
}
// C ref: priest.c inhistemple(priest).  js/dungeon.js:1876 holds the port but
// keeps it module-private and async; resolved lazily here rather than making
// dungeon.js export a third copy.
async function inhistemple_wiz(mon) {
    if (!mon?.ispriest) return false;
    const dgn = await import('./dungeon.js');
    if (typeof dgn.inhistemple === 'function') return !!await dgn.inhistemple(mon);
    // Reduced: a temple priest is "in his temple" when he is standing in the
    // room his temple occupies (C also checks the temple's alignment record).
    return !!mon.inhistemple;
}
// C ref: shk.c inhishop(shkp).  js/shk.js:399 exports the port.
async function inhishop_wiz(mon) {
    if (!mon?.isshk) return false;
    const shk = await import('./shk.js');
    return typeof shk.inhishop === 'function' ? !!shk.inhishop(mon) : false;
}

// ─── wizard.c:270 strategy(mtmp) ───────────────────────────────────────────
// WHAT a covetous monster is going to attempt.  RNG-free.
export async function strategy(mtmp) {
    const M = await import('./makemon.js');
    let strat, dstrat;

    if (!M.is_covetous(mdata(mtmp))
        /* perhaps a shopkeeper has been polymorphed into a master lich; we
           don't want it teleporting to the stairs to heal because that will
           leave its shop untended */
        || (mtmp.isshk && await inhishop_wiz(mtmp))
        /* likewise for temple priests */
        || (mtmp.ispriest && await inhistemple_wiz(mtmp)))
        return STRAT_NONE;

    switch (Math.trunc(((mtmp.mhp | 0) * 3) / (mtmp.mhpmax | 0))) { /* 0-3 */
    default:
    case 0: /* panic time - mtmp is almost snuffed */
        return STRAT_HEAL;
    case 1: /* the wiz is less cautious */
        if (mdata(mtmp)?.name !== 'Wizard of Yendor')
            return STRAT_HEAL;
        /* FALLTHRU */
    case 2:
        dstrat = STRAT_HEAL;
        break;
    case 3:
        dstrat = STRAT_NONE;
        break;
    }

    if (game.context?.made_amulet)
        if ((strat = await target_on(M3_WANTSAMUL, mtmp)) !== STRAT_NONE)
            return strat;

    if (game.u?.uevent?.invoked) { /* priorities change once gate opened */
        if ((strat = await target_on(M3_WANTSARTI, mtmp)) !== STRAT_NONE) return strat;
        if ((strat = await target_on(M3_WANTSBOOK, mtmp)) !== STRAT_NONE) return strat;
        if ((strat = await target_on(M3_WANTSBELL, mtmp)) !== STRAT_NONE) return strat;
        if ((strat = await target_on(M3_WANTSCAND, mtmp)) !== STRAT_NONE) return strat;
    } else {
        if ((strat = await target_on(M3_WANTSBOOK, mtmp)) !== STRAT_NONE) return strat;
        if ((strat = await target_on(M3_WANTSBELL, mtmp)) !== STRAT_NONE) return strat;
        if ((strat = await target_on(M3_WANTSCAND, mtmp)) !== STRAT_NONE) return strat;
        if ((strat = await target_on(M3_WANTSARTI, mtmp)) !== STRAT_NONE) return strat;
    }
    return dstrat;
}

// ─── wizard.c:369 tactics(mtmp) ────────────────────────────────────────────
// Carry out what strategy() decided.  Returns 1 when the monster used its turn
// (healed itself or picked the target up), else 0.
export async function tactics(mtmp) {
    const [tel, mon, mhu, shkr, dsp, inv, dnm, vis, dgm] = await Promise.all([
        import('./teleport.js'), import('./mon.js'), import('./mhitu.js'),
        import('./shkroom.js'), import('./display.js'), import('./invent.js'),
        import('./do_name.js'), import('./vision.js'), import('./dogmove.js'),
    ]);
    const mm = await import('./monmove.js');
    const u = game.u;
    const strat = await strategy(mtmp);
    let sx = 0, sy = 0, mx, my;

    mtmp.mstrategy = ((mtmp.mstrategy | 0) & (STRAT_WAITMASK | STRAT_APPEARMSG))
        | strat;

    switch (strat) {
    case STRAT_HEAL: /* hide and recover */
        mx = mtmp.mx; my = mtmp.my;

        if (u.uswallow && u.ustuck === mtmp)
            await mhu.expels(mtmp, mdata(mtmp), true);

        /* if wounded, hole up on or near the stairs (to block them) */
        {
            // C: choose_stairs(&sx, &sy, (mtmp->m_id % 2)).  js/shkroom.js:343
            // holds the port but keeps it module-private and returns the spot
            // instead of filling two out-params; when it is unavailable the
            // out-params stay 0, which is C's "no spot found" case.
            const st = (typeof shkr.choose_stairs === 'function')
                ? shkr.choose_stairs((mtmp.m_id | 0) % 2) : null;
            if (st) { sx = st.x | 0; sy = st.y | 0; }
        }
        mtmp.mavenge = 1; /* covetous monsters attack while fleeing */
        if (In_W_tower_wiz(mx, my)
            || (mtmp.iswiz && !sx && !mon_has_amulet(mtmp))) {
            if (!mm.noteleport_level(mtmp) && !rn2(3 + Math.trunc((mtmp.mhp | 0) / 10)))
                await tel.rloc(mtmp, RLOC_MSG);
        } else if (sx && (mx !== sx || my !== sy)) {
            if (!mm.noteleport_level(mtmp)
                && !await mon.mnearto(mtmp, sx, sy, true, RLOC_MSG)) {
                /* couldn't move to the target spot for some reason, so stay
                   where we are (don't actually need rloc_to() because mtmp is
                   still on the map at <mx,my>... */
                await tel.rloc_to(mtmp, mx, my);
                return 0;
            }
            mx = mtmp.mx; my = mtmp.my; /* update cached location */
        }
        /* if you're not around, cast healing spells */
        if (distu(mx, my) > (BOLT_LIM_WIZ * BOLT_LIM_WIZ))
            if ((mtmp.mhp | 0) <= (mtmp.mhpmax | 0) - 8) {
                mon.healmon(mtmp, rnd(8), 0);
                return 1;
            }
        /* FALLTHRU */
    case STRAT_NONE: /* harass */
        if (!mm.noteleport_level(mtmp) && !rn2(!mtmp.mflee ? 5 : 33))
            await mnexto_wiz(mtmp);
        return 0;

    default: { /* kill, maim, pillage! */
        const where = (strat & STRAT_STRATMASK);
        const tx = mtmp.mgoal?.x | 0, ty = mtmp.mgoal?.y | 0;
        const targ = (strat & STRAT_GOAL);
        let otmp;

        if (!targ || !isok_wiz(tx, ty)) { /* simply wants you to close */
            return 0;
        }
        if (mm.noteleport_level(mtmp) && !dgm.monnear(mtmp, tx, ty))
            return 0;
        if (u_at(tx, ty) || where === STRAT_PLAYER) {
            /* player is standing on it (or has it) */
            mx = mtmp.mx; my = mtmp.my;
            if (mm.noteleport_level(mtmp)
                || !await mon.mnearto(mtmp, tx, ty, false, RLOC_MSG))
                await tel.rloc_to(mtmp, mx, my); /* no room? stay put */
            return 0;
        }
        if (where === STRAT_GROUND) {
            if (!MON_AT(tx, ty) || (mtmp.mx === tx && mtmp.my === ty)) {
                /* teleport to it and pick it up */
                await tel.rloc_to(mtmp, tx, ty); /* clean old pos */

                if ((otmp = on_ground(which_arti(targ)))) {
                    if (vis.cansee(mtmp.mx, mtmp.my))
                        await dsp.pline(`${dnm.Monnam(mtmp)} picks up `
                            + `${inv.distant_doname(otmp,
                                inv.distant_far(otmp, mtmp.mx, mtmp.my))}.`);
                    inv.obj_extract_self(otmp);
                    (await import('./steal.js')).mpickobj(mtmp, otmp);
                    return 1;
                } else {
                    return 0;
                }
            } else {
                /* a monster is standing on it - cause some trouble */
                if (!rn2(5) && !mm.noteleport_level(mtmp))
                    await mnexto_wiz(mtmp);
                return 0;
            }
        } else { /* a monster has it - 'port beside it. */
            mx = mtmp.mx; my = mtmp.my;
            if (!mm.noteleport_level(mtmp)
                && !await mon.mnearto(mtmp, tx, ty, false, RLOC_MSG))
                await tel.rloc_to(mtmp, mx, my); /* no room? stay put */
            return 0;
        }
    } /* default case */
    } /* switch */
}
// C ref: dungeon.c In_W_tower(x, y, &u.uz) — inside the Wizard's tower on the
// current level.  This port has no wizard-tower region test; the level flag is
// the closest thing it carries.
function In_W_tower_wiz(_x, _y) {
    return !!game.level?.flags?.is_wiztower;
}
// C ref: teleport.c mnexto(mtmp, rlocflags) — js/do.js:467 and js/vault.js:442
// each keep a private copy; js/do.js exports mnexto_rloc(), which is the same
// call with the flags threaded through.
async function mnexto_wiz(mtmp) {
    const d = await import('./do.js');
    if (typeof d.mnexto_rloc === 'function') await d.mnexto_rloc(mtmp, RLOC_MSG);
}
// C ref: mon.c monnear(mon, x, y) == dist2 < 3 with the NODIAG exception;
// js/dogmove.js:2167 exports the port, and vision.c cansee() comes from
// js/vision.js.  Both are resolved in tactics()'s Promise.all above rather than
// via a static import, so wizard.js gains no module-eval edge to either.
