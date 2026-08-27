// attrib.js — attribute exercise / abuse.
// C ref: attrib.c.  Only the RNG-bearing routine exercised by the quaff /
// zap / cast gameplay sessions is ported here.

import { game } from './gstate.js';
import { rn2, rn1, rnd, d } from './rng.js';
import { A_STR, A_INT, A_WIS, A_CON, A_CHA, A_MAX, POISONING } from './const.js';
import { adj_erinys } from './makemon.js';

const AVAL = 50; // C ref: attrib.c — tune value for exercise gains.

// C ref: attrib.h ATTRMIN(A_STR) = gu.urace.attrmin[A_STR] — 3 for every
// currently-modeled race (role.c races[].attrmin is uniformly {3,3,3,3,3,3}).
const ATTRMIN_STR = 3;

// C ref: attrib.h ACURR(x) — current attribute value.  acurr.a is in
// [Str,Int,Wis,Dex,Con,Cha] order.
function ACURR(i) {
    return game.u?.acurr?.a?.[i] ?? 0;
}

// C ref: attrib.c acurr(chridx) — the effective attribute = abon+atemp+acurr,
// clamped to [3,25] for the non-STR characteristics.  Wounded legs lower
// atemp[A_DEX] by 1, so the effective Dex (used by e.g. the allmain.c:360
// u_wipe_engr roll) drops accordingly.  STR's encoded value is not adjusted
// here (its hunger/loss path is modelled elsewhere); callers that need STR use
// acurrstr().  abon/atemp default to 0 so this is a no-op for unaffected heroes.
// C ref: attrib.c acurr() `if (x == A_STR) { if (uarmg && uarmg->otyp ==
// GAUNTLETS_OF_POWER && !Upolyd) return 125; ... }` — worn gauntlets of power
// PIN the encoded strength at 125 (displayed "St:25"), overriding abase/abon
// entirely.  Missing here, the status line kept showing the hero's own Str and
// every ACURR(A_STR) predicate read the wrong number.
const GAUNTLETS_OF_POWER_OTYP = 161;
export function acurr_str_encoded() {
    const u = game.u;
    if (game.uarmg?.otyp === GAUNTLETS_OF_POWER_OTYP && !u?.Upolyd) return 125;
    return u?.acurr?.a?.[A_STR] ?? 0;
}
export function acurr_eff(i) {
    const u = game.u;
    const base = u?.acurr?.a?.[i] ?? 0;
    if (i === A_STR) return acurr_str_encoded();
    const v = base + (u?.atemp?.a?.[i] || 0) + (u?.abon?.a?.[i] || 0);
    return v > 25 ? 25 : v < 3 ? 3 : v;
}

// C ref: attrib.h AEXE(x) — exercise accumulator; lazily allocated to zeros.
function ensureAexe() {
    game.u = game.u || {};
    if (!game.u.aexe) game.u.aexe = { a: Array(A_MAX).fill(0) };
    return game.u.aexe.a;
}

// C ref: attrib.c exercise(i, inc_or_dec).  A_INT/A_CHA can't be exercised
// (early return, no RNG).  Polymorph blocks all but A_WIS (no Upolyd at game
// start).  When |AEXE(i)| < AVAL the accumulator is nudged: a gain rolls
// rn2(19) > ACURR(i) (harder at higher attributes), a loss is -rn2(2).
// encumber_msg() (A_STR/A_CON when moves>0) consumes no RNG.
export function exercise(i, inc_or_dec) {
    if (i === A_INT || i === A_CHA)
        return;
    if (game.u?.Upolyd && i !== A_WIS)
        return;
    const aexe = ensureAexe();
    if (Math.abs(aexe[i] ?? 0) < AVAL) {
        aexe[i] = (aexe[i] ?? 0)
            + (inc_or_dec ? (rn2(19) > ACURR(i) ? 1 : 0) : -rn2(2));
    }
    // encumber_msg() for A_STR/A_CON is display-only; no RNG, omitted.
}

// C ref: hack.c losehp(dmg,...) — subtract dmg from u.uhp.  Death handling
// (k_format/knam) isn't reached by the covered sessions, so this is just the
// HP subtraction (clamped at 0, matching every other file-local losehp()).
function losehp(dmg) {
    const u = game.u;
    if (!u || dmg <= 0) return;
    u.uhp = (u.uhp ?? 0) - dmg;
    if (u.uhp < 0) u.uhp = 0;
}

// C ref: attrib.c losestr(num,...) — Strength loss (poison, certain monster
// hits).  ABASE(A_STR) drops by num; if that would take it below
// ATTRMIN(A_STR), C's while loop (attrib.c:232-237) walks the excess up to
// the floor one point at a time, each point rolling rn1(4,3) extra HP damage
// (via losehp) before the (now-clamped) adjattrib(A_STR,-num,1) call, which is
// silent (msgflg>0 suppresses "You feel weaker!").
export function losestr(num) {
    const u = game.u;
    if (!u?.acurr || num <= 0) return;
    const abase = u.acurr.a;
    let ustr = (abase[A_STR] ?? 0) - num;
    let dmg = 0;
    while (ustr < ATTRMIN_STR) {
        ustr++;
        num--;
        dmg += rn1(4, 3); // eat.c:1932-via-attrib.c:235 amt = rn1(4,3) => 3..6
    }
    if (dmg) losehp(dmg);
    if (num > 0) abase[A_STR] = Math.max(ATTRMIN_STR, (abase[A_STR] ?? 0) - num);
}

// C ref: attrib.c poison_strdmg(strloss, dmg,...) — combined Strength loss +
// HP damage from poison (eat.c eatcorpse poisonous-corpse branch, fountain.c
// contamination, spell.c miscast, etc.).
export function poison_strdmg(strloss, dmg) {
    losestr(strloss);
    losehp(dmg);
}

// ═══ attrib.c:114 adjattrib(ndx, incr, msgflg) ══════════════════════════════
// msgflg: positive => silent, zero => always message, negative => message only
// when the value actually moved.  Returns TRUE when ACURR changed.
// RNG: the only draw is the underflow arm (base pushed below ATTRMIN takes a
// slice off AMAX instead) — rn2(ATTRMIN - ABASE + 1).
const PLUSATTR = ['strong', 'smart', 'wise', 'agile', 'tough', 'charismatic'];
const MINUSATTR = ['weak', 'stupid', 'foolish', 'clumsy', 'fragile', 'repulsive'];
export async function adjattrib(ndx, incr, msgflg) {
    const u = game.u;
    if (!u?.acurr) return false;
    if (Fixed_abil() || !incr) return false;
    // uarmh == DUNCE_CAP blocks A_INT/A_WIS changes (no dunce cap in reach).
    const abase = u.acurr.a;
    u.amax = u.amax || { a: abase.slice() };
    const amax = u.amax.a;
    const { race_attrmin, race_attrmax } = await import('./u_init.js');
    const ATTRMIN = race_attrmin(), ATTRMAX = race_attrmax();
    const old_acurr = acurr_eff(ndx), old_abase = abase[ndx] | 0,
        old_amax = amax[ndx] | 0;
    let attrstr, abonflg;
    abase[ndx] = (abase[ndx] | 0) + incr;
    if (incr > 0) {
        if (abase[ndx] > amax[ndx]) {
            amax[ndx] = abase[ndx];
            if (amax[ndx] > ATTRMAX[ndx]) abase[ndx] = amax[ndx] = ATTRMAX[ndx];
        }
        attrstr = PLUSATTR[ndx];
        abonflg = (u.abon?.a?.[ndx] | 0) < 0;
    } else {
        if (abase[ndx] < ATTRMIN[ndx]) {
            const decr = rn2(ATTRMIN[ndx] - abase[ndx] + 1);   // attrib.c:166
            abase[ndx] = ATTRMIN[ndx];
            amax[ndx] -= decr;
            if (amax[ndx] < ATTRMIN[ndx]) amax[ndx] = ATTRMIN[ndx];
        }
        attrstr = MINUSATTR[ndx];
        abonflg = (u.abon?.a?.[ndx] | 0) > 0;
    }
    const { update_topl } = await import('./display.js');
    if (acurr_eff(ndx) === old_acurr) {
        if (msgflg === 0) {
            if (abase[ndx] === old_abase && amax[ndx] === old_amax)
                await update_topl(`You're ${abonflg ? 'currently' : 'already'} as ${attrstr} as you can get.`);
            else
                await update_topl(`Your innate ${ATTRNAME[ndx]} has ${incr > 0 ? 'improved' : 'declined'}.`);
        }
        return false;
    }
    ensureAexe()[ndx] = 0;
    game.disp_botl = true;
    game.botl = true;
    if (msgflg <= 0)
        await update_topl(`You feel ${(incr > 1 || incr < -1) ? 'very ' : ''}${attrstr}!`);
    if ((ndx === A_STR || ndx === A_CON)) {
        const { encumber_msg } = await import('./invent.js');
        await encumber_msg();
    }
    return true;
}
const ATTRNAME = ['strength', 'intelligence', 'wisdom', 'dexterity',
    'constitution', 'charisma'];
// C ref: attrib.h Fixed_abil — the amulet/artifact that pins the stats.  No
// covered hero carries one.
function Fixed_abil() { return !!(game.u?.uprops?.Fixed_abil); }

// C ref: attrib.c:433 poisontell(typ, exclaim).
const POISEFF = [['You feel ', 'weaker'], ['Your ', 'brain is on fire'],
    ['Your ', 'judgement is impaired'], ['Your ', "muscles won't obey you"],
    ['You feel ', 'very sick'], ['You ', 'break out in hives']];
export async function poisontell(typ, exclaim) {
    let [lead, txt] = POISEFF[typ];
    if (typ === A_STR && acurr_eff(A_STR) === 125) txt = 'innately weaker';
    else if (typ === A_CON && acurr_eff(A_CON) === 25) txt = 'sick inside';
    const { update_topl } = await import('./display.js');
    await update_topl(`${lead}${txt}${exclaim ? '!' : '.'}`);
}

// ═══ attrib.c:316 poisoned(reason, typ, pkiller, fatal, thrown_weapon) ══════
// Called when an attack or trap has poisoned the hero.  RNG, in order:
//   rn2(fatal + (thrown_weapon ? 20 : 0))            [attrib.c:362]
//   i == 0 && typ != A_CHA : d(4,6)                  [instant-kill arm]
//   i > 5                  : rnd(6) / rn1(10,6)      [HP damage arm]
//   else                   : d(2,2)                  [attrib.c:395 stat loss]
// The leading pline() is skipped when `reason` already says "poison" — the
// caller's own message covered it.
export async function poisoned(reason, typ, pkiller, fatal, thrown_weapon) {
    const u = game.u || {};
    const { update_topl } = await import('./display.js');
    const blast = reason === 'blast';
    if (!blast && !/poison/i.test(reason)) {
        const plural = reason[reason.length - 1] === 's';
        await update_topl(`${/^[A-Z]/.test(reason) ? '' : 'The '}${reason} ${plural ? 'were' : 'was'} poisoned!`);
    }
    if (Poison_resistance()) {
        await update_topl("The poison doesn't seem to affect you.");
        return;
    }
    let loss;
    const i = !fatal ? 1 : rn2(fatal + (thrown_weapon ? 20 : 0));   // attrib.c:362
    if (i === 0 && typ !== A_CHA) {
        loss = 6 + d(4, 6);                                          // attrib.c:366
        if ((u.uhp | 0) <= loss) {
            u.uhp = -1;
            game.disp_botl = true; game.botl = true;
            await update_topl('The poison was deadly...');
        } else {
            const olduhp = u.uhp | 0;
            u.uhpmax = Math.max((u.uhpmax | 0) - ((loss / 2) | 0), 3);
            if (loss >= olduhp) loss = olduhp - 1;   // adjuhploss: never fatal here
            u.uhp = olduhp - loss;
            game.disp_botl = true; game.botl = true;
            if (await adjattrib(A_CON, (typ !== A_CON) ? -1 : -3, 1))
                await poisontell(A_CON, true);
            if (typ !== A_CON && await adjattrib(typ, -3, 1))
                await poisontell(typ, true);
        }
    } else if (i > 5) {
        loss = thrown_weapon ? rnd(6) : rn1(10, 6);                  // attrib.c:388
        u.uhp = (u.uhp | 0) - loss;
        game.disp_botl = true; game.botl = true;
    } else {
        loss = (thrown_weapon || !fatal) ? 1 : d(2, 2);              // attrib.c:395
        if (await adjattrib(typ, -loss, 1))
            await poisontell(typ, true);
    }
    if ((u.uhp | 0) < 1) {
        // C ref: attrib.c:405 — done(strstri(pkiller,"poison") ? DIED : POISONING).
        const { done, DIED } = await import('./end.js');
        game._killer_name = pkiller;
        await done(/poison/i.test(pkiller || '') ? DIED : POISONING);
    }
    const { encumber_msg } = await import('./invent.js');
    await encumber_msg();
}
function Poison_resistance() {
    const u = game.u || {};
    return !!(u.uprops?.Poison_resistance || u.HPoison_resistance
        || u.EPoison_resistance || u.Poison_resistance);
}

// C ref: align.h ALIGNLIM = (10L + (svm.moves / 200L)) — the cap on how good
// the hero's alignment record can get.
export function ALIGNLIM() {
    return 10 + Math.floor((game.moves | 0) / 200);
}

// C ref: attrib.c adjalign(n) — the ONLY writer of u.ualign.record.  A negative
// n also accumulates u.ualign.abuse (which peace_minded()'s erinys arm reads),
// and both directions are one-way: a gain that would not raise the record, or a
// loss that would not lower it, is discarded.
export function adjalign(n) {
    const u = game.u;
    if (!u) return;
    u.ualign = u.ualign || { type: 0, record: 0 };
    const cur = u.ualign.record | 0;
    const newalign = cur + n;
    if (n < 0) {
        const newabuse = (u.ualign.abuse | 0) - n;
        if (newalign < cur) u.ualign.record = newalign;
        // C ref: attrib.c:1309 — raising abuse also runs adj_erinys(), which
        // rewrites mons[PM_ERINYS] in place (mlevel = min(7 + abuse, 50)).  No
        // RNG here, but the new mlevel feeds adj_lev() -> newmonhp()'s d(lvl,8)
        // for every erinys made afterwards.
        if (newabuse > (u.ualign.abuse | 0)) { u.ualign.abuse = newabuse; adj_erinys(newabuse); }
    } else if (newalign > cur) {
        u.ualign.record = Math.min(newalign, ALIGNLIM());
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// attrib.c completion — the eight routines coverage.mjs --file=attrib.c listed
// as missing.  Nothing above this line calls into the block.
//
// OVERLAP NOTE: js/exper.js:456-488 already carries a REDUCED, live copy of
// C's role/race innate tables (ROLE_ABIL / RACE_ABIL / innate_intrinsics() /
// innate_source() / has_innate()), which adjabil() and insight.js's from_what()
// use.  That copy deliberately drops the dwarf and gnome Infravision rows
// ("adjabil() only walks elf_abil/orc_abil") and keys on H-property NAMES.  The
// tables below are C's, complete, so check_innate_abil() answers for dwarves
// and gnomes too; exper.js's live copy is left untouched.
// ═══════════════════════════════════════════════════════════════════════════

// C ref: prop.h property indices (js/const.js:2302-2366).
const P_FIRE_RES = 1, P_COLD_RES = 2, P_SLEEP_RES = 3, P_SHOCK_RES = 5,
    P_POISON_RES = 6, P_DRAIN_RES = 9, P_BLINDED = 15, P_SEE_INVIS = 29,
    P_WARNING = 31, P_SEARCHING = 34, P_INFRAVISION = 36, P_BLND_RES = 38,
    P_STEALTH = 42, P_JUMPING = 45, P_TELEPORT_CONTROL = 47, P_FAST = 64;
// C ref: prop.h intrinsic source bits.
const AT_FROMEXPER = 0x01000000, AT_FROMRACE = 0x02000000,
    AT_FROMOUTSIDE = 0x04000000, AT_FROMFORM = 0x10000000;
// C ref: attrib.c:850-856 the FROM_* reasons for an innate ability.
export const FROM_NONE = 0, FROM_ROLE = 1, FROM_RACE = 2, FROM_INTR = 3,
    FROM_EXP = 4, FROM_FORM = 5, FROM_LYCN = 6;
// C ref: u_init.c roles[]/races[] order — game.urole.mnum / game.urace.mnum are
// those INDICES, not mons[] offsets ([[umonnum-is-a-role-index]]).
const RL_ARCHEOLOGIST = 0, RL_BARBARIAN = 1, RL_CAVE_DWELLER = 2,
    RL_HEALER = 3, RL_KNIGHT = 4, RL_MONK = 5, RL_CLERIC = 6, RL_RANGER = 7,
    RL_ROGUE = 8, RL_SAMURAI = 9, RL_TOURIST = 10, RL_VALKYRIE = 11,
    RL_WIZARD = 12;
const RC_HUMAN = 0, RC_ELF = 1, RC_DWARF = 2, RC_GNOME = 3, RC_ORC = 4;
// C ref: attrib.c:1447 WEAK (eat.h hunger state) and you.h LOW_PM.
const AT_WEAK = 3, AT_LOW_PM = 0;
// C ref: mondata.h ismnum(mndx) — a valid mons[] index.  A hero who is not a
// lycanthrope carries u.ulycn == NON_PM, which this port spells -1
// (js/pray.js's TROUBLE_LYCANTHROPE fix sets exactly that).
function ismnum_at(mndx) {
    return mndx != null && mndx >= AT_LOW_PM;
}

// C ref: attrib.c:23 `static const struct innate { schar ulevel; long *ability;
// const char *gainstr, *losestr; }` — the ability column is the ADDRESS of an
// intrinsic (&HFast, &HStealth, ...).  This port has no pointers into
// u.uprops[], so each row carries the property INDEX instead; that is what
// check_innate_abil()'s `abil->ability == ability` comparison keys on here.
// Rows are transcribed in C's order, terminator omitted.
const arc_abil = [[1, P_SEARCHING, '', ''], [5, P_STEALTH, 'stealthy', ''],
                  [10, P_FAST, 'quick', 'slow']];
const bar_abil = [[1, P_POISON_RES, '', ''], [7, P_FAST, 'quick', 'slow'],
                  [15, P_STEALTH, 'stealthy', '']];
const cav_abil = [[7, P_FAST, 'quick', 'slow'],
                  [15, P_WARNING, 'sensitive', '']];
const hea_abil = [[1, P_POISON_RES, '', ''],
                  [15, P_WARNING, 'sensitive', '']];
const kni_abil = [[7, P_FAST, 'quick', 'slow']];
const mon_abil = [[1, P_FAST, '', ''], [1, P_SLEEP_RES, '', ''],
                  [1, P_SEE_INVIS, '', ''],
                  [3, P_POISON_RES, 'healthy', ''],
                  [5, P_STEALTH, 'stealthy', ''],
                  [7, P_WARNING, 'sensitive', ''],
                  [9, P_SEARCHING, 'perceptive', 'unaware'],
                  [11, P_FIRE_RES, 'cool', 'warmer'],
                  [13, P_COLD_RES, 'warm', 'cooler'],
                  [15, P_SHOCK_RES, 'insulated', 'conductive'],
                  [17, P_TELEPORT_CONTROL, 'controlled', 'uncontrolled']];
const pri_abil = [[15, P_WARNING, 'sensitive', ''],
                  [20, P_FIRE_RES, 'cool', 'warmer']];
const ran_abil = [[1, P_SEARCHING, '', ''], [7, P_STEALTH, 'stealthy', ''],
                  [15, P_SEE_INVIS, '', '']];
const rog_abil = [[1, P_STEALTH, '', ''],
                  [10, P_SEARCHING, 'perceptive', '']];
const sam_abil = [[1, P_FAST, '', ''], [15, P_STEALTH, 'stealthy', '']];
const tou_abil = [[10, P_SEARCHING, 'perceptive', ''],
                  [20, P_POISON_RES, 'hardy', '']];
const val_abil = [[1, P_COLD_RES, '', ''], [3, P_STEALTH, 'stealthy', ''],
                  [7, P_FAST, 'quick', 'slow']];
const wiz_abil = [[15, P_WARNING, 'sensitive', ''],
                  [17, P_TELEPORT_CONTROL, 'controlled', 'uncontrolled']];
/* Intrinsics conferred by race */
const dwa_abil = [[1, P_INFRAVISION, '', '']];
const elf_abil = [[1, P_INFRAVISION, '', ''],
                  [4, P_SLEEP_RES, 'awake', 'tired']];
const gno_abil = [[1, P_INFRAVISION, '', '']];
const orc_abil = [[1, P_INFRAVISION, '', ''], [1, P_POISON_RES, '', '']];
const hum_abil = [];

// ─── attrib.c:423 stone_luck(include_uncursed) ─────────────────────────────
// Are there more blessed luckstones (plus luck-conferring artifacts) than
// cursed ones?  Optionally count uncursed ones with the blessed.  RNG-free;
// js/mkobj.js:1005 documents the set_moreluck() caller that reads it.
export function stone_luck(include_uncursed) {
    let bonchance = 0;
    for (const otmp of (game.invent || []))
        if (confers_luck_at(otmp)) {
            if (otmp.cursed) bonchance -= (otmp.quan || 1);
            else if (otmp.blessed || include_uncursed) bonchance += (otmp.quan || 1);
        }
    return bonchance > 0 ? 1 : bonchance < 0 ? -1 : 0;   /* C: sgn() */
}
// C ref: artifact.c:990 confers_luck(obj) == LUCKSTONE || spec_ability(obj,
// SPFX_LUCK).  js/artifact.js:990 exports the canonical version, but
// artifact.js already imports exercise() from THIS file, so importing it back
// would close a module cycle ([[_mktrap_victim-tdz-is-real]]) — and stone_luck()
// has to stay synchronous for set_moreluck().  The SPFX_LUCK set is exactly two
// artifacts (js/artifact.js:419 Tsurugi of Muramasa, :431 Orb of Fate).
const LUCKSTONE = 470;
const SPFX_LUCK_ARTIFACTS = new Set(['The Tsurugi of Muramasa',
                                     'The Orb of Fate']);
function confers_luck_at(obj) {
    if (!obj) return false;
    if (obj.otyp === LUCKSTONE) return true;
    return !!obj.oartifact && SPFX_LUCK_ARTIFACTS.has(obj.oname);
}

// ─── attrib.c:455 restore_attrib() ─────────────────────────────────────────
// C's own comment: "(not used)".  It used to be called by moveloop() every
// turn, but ATIME() is never set to non-zero anywhere so it never did anything;
// this port has no u.atime at all, which is why it is inert here too.  ATEMP()
// is still live (strength loss from hunger, dexterity loss from wounded legs)
// but both of those have their own timeout paths.
export async function restore_attrib() {
    const u = game.u;
    if (!u) return;
    for (let i = 0; i < A_MAX; i++) { /* all temporary losses/gains */
        const equilibrium = ((i === A_STR && (u.uhs | 0) >= AT_WEAK)
                             || (i === A_DEX_AT && Wounded_legs_at())) ? -1 : 0;
        const atemp = u.atemp?.a?.[i] | 0;
        const atime = u.atime?.a?.[i] | 0;
        if (atemp !== equilibrium && atime !== 0) {
            u.atemp = u.atemp || { a: Array(A_MAX).fill(0) };
            u.atime.a[i] = atime - 1;
            if (!u.atime.a[i]) { /* countdown for change */
                u.atemp.a[i] = atemp + ((atemp > 0) ? -1 : 1);
                game.disp_botl = true;
                game.botl = true;
                if (u.atemp.a[i]) /* reset timer */
                    u.atime.a[i] = Math.trunc(100 / acurr_eff(A_CON));
            }
        }
    }
    if (game.disp_botl) {
        const { encumber_msg } = await import('./invent.js');
        await encumber_msg();
    }
}
// C ref: attrib.h A_DEX (the 'a' array is Str,Int,Wis,Dex,Con,Cha).
const A_DEX_AT = 3;
// C ref: youprop.h Wounded_legs.  js/allmain.js:1406 keeps the same predicate.
function Wounded_legs_at() {
    const u = game.u;
    return !!((u?.HWounded_legs || 0) || (u?.EWounded_legs || 0)
        || (u?.uprops?.Wounded_legs || 0));
}

// ─── attrib.c:780 postadjabil(ability) ─────────────────────────────────────
// Called after adjabil() has changed an intrinsic.  C compares the pointer
// against &HWarning / &HSee_invisible; this port passes the property INDEX.
export async function postadjabil(ability) {
    if (!(game.u?.ulevel | 0)) /* initializing hero; no screen update yet */
        return;
    if (ability === P_WARNING || ability === P_SEE_INVIS) {
        const { see_monsters } = await import('./display.js');
        see_monsters();
    }
}

// ─── attrib.c:789 role_abil(r) ─────────────────────────────────────────────
// The innate table for role `r`, or null.  C's loop walks roleabils[] until it
// finds the role or hits the {0,0} terminator and returns THAT row's (null)
// abil, so an unknown role yields NULL — reproduced by the Map miss below.
const roleabils = new Map([
    [RL_ARCHEOLOGIST, arc_abil], [RL_BARBARIAN, bar_abil],
    [RL_CAVE_DWELLER, cav_abil], [RL_HEALER, hea_abil],
    [RL_KNIGHT, kni_abil], [RL_MONK, mon_abil], [RL_CLERIC, pri_abil],
    [RL_RANGER, ran_abil], [RL_ROGUE, rog_abil], [RL_SAMURAI, sam_abil],
    [RL_TOURIST, tou_abil], [RL_VALKYRIE, val_abil], [RL_WIZARD, wiz_abil],
]);
export function role_abil(r) {
    return roleabils.get(r) ?? null;
}

// ─── attrib.c:818 check_innate_abil(ability, frommask) ─────────────────────
// Does the role table (FROMEXPER) or the race table (FROMRACE) confer
// `ability` at the hero's current level?  Returns the matching row or null.
export function check_innate_abil(ability, frommask) {
    let abil = null;
    if (frommask === AT_FROMEXPER) {
        abil = role_abil(game.urole?.mnum);
    } else if (frommask === AT_FROMRACE) {
        switch (game.urace?.mnum) {
        case RC_DWARF: abil = dwa_abil; break;
        case RC_ELF:   abil = elf_abil; break;
        case RC_GNOME: abil = gno_abil; break;
        case RC_ORC:   abil = orc_abil; break;
        case RC_HUMAN: abil = hum_abil; break;
        default: break;
        }
    }
    const ulevel = game.u?.ulevel | 0;
    for (const row of (abil || []))
        if (row[1] === ability && ulevel >= row[0])
            return { ulevel: row[0], ability: row[1],
                     gainstr: row[2], losestr: row[3] };
    return null;
}

// ─── attrib.c:864 innately(ability) ────────────────────────────────────────
// Which table conferred `ability` — the role/race tables outrank a FROMOUTSIDE
// intrinsic, which outranks FROMFORM.  js/exper.js:478 innate_source() is the
// live, name-keyed equivalent of the first two arms only.
export function innately(ability) {
    let iptr = check_innate_abil(ability, AT_FROMEXPER);
    if (iptr) return (iptr.ulevel === 1) ? FROM_ROLE : FROM_EXP;
    iptr = check_innate_abil(ability, AT_FROMRACE);
    if (iptr) return FROM_RACE;
    const intrinsic = intrinsic_bits_at(ability);
    if ((intrinsic & AT_FROMOUTSIDE) !== 0) return FROM_INTR;
    if ((intrinsic & AT_FROMFORM) !== 0) return FROM_FORM;
    return FROM_NONE;
}
// C ref: u.uprops[propidx].intrinsic.  This port stores intrinsics by NAME
// (u.uprops.HFoo / u.uprops.Foo — js/fountain.js:450 writes both), so the
// pointer C passes around becomes an index that has to be mapped back.
const PROPIDX_HNAME = new Map([
    [P_FIRE_RES, 'Fire_resistance'], [P_COLD_RES, 'Cold_resistance'],
    [P_SLEEP_RES, 'Sleep_resistance'], [P_SHOCK_RES, 'Shock_resistance'],
    [P_POISON_RES, 'Poison_resistance'], [P_DRAIN_RES, 'Drain_resistance'],
    [P_BLINDED, 'Blinded'], [P_SEE_INVIS, 'See_invisible'],
    [P_WARNING, 'Warning'], [P_SEARCHING, 'Searching'],
    [P_INFRAVISION, 'Infravision'], [P_BLND_RES, 'Blnd_resist'],
    [P_STEALTH, 'Stealth'], [P_JUMPING, 'Jumping'],
    [P_TELEPORT_CONTROL, 'Teleport_control'], [P_FAST, 'Fast'],
]);
function intrinsic_bits_at(propidx) {
    const nm = PROPIDX_HNAME.get(propidx);
    if (!nm) return 0;
    const u = game.u;
    return (u?.uprops?.[`H${nm}`] | 0) || (u?.uprops?.[nm] | 0) || (u?.[`H${nm}`] | 0);
}
function extrinsic_bits_at(propidx) {
    const nm = PROPIDX_HNAME.get(propidx);
    if (!nm) return 0;
    const u = game.u;
    return (u?.uprops?.[`E${nm}`] | 0) || (u?.[`E${nm}`] | 0);
}

// ─── attrib.c:880 is_innate(propidx) ───────────────────────────────────────
// The version from_what() calls: like innately() but with four special cases.
export function is_innate(propidx) {
    /* innately() would report FROM_FORM for this; caller wants specificity */
    if (propidx === P_DRAIN_RES && ismnum_at(game.u?.ulycn))
        return FROM_LYCN;
    if (propidx === P_FAST && Very_fast_at())
        return FROM_NONE; /* can't become very fast innately */
    const innateness = innately(propidx);
    if (innateness !== FROM_NONE)
        return innateness;
    if (propidx === P_JUMPING && (game.urole?.mnum === RL_KNIGHT)
        /* knight has intrinsic jumping, but extrinsic is more versatile so
           ignore innateness if equipment is going to claim responsibility */
        && !extrinsic_bits_at(propidx))
        return FROM_ROLE;
    if ((propidx === P_BLINDED && !haseyes_at())
        || (propidx === P_BLND_RES && (intrinsic_bits_at(P_BLND_RES) & AT_FROMFORM) !== 0))
        return FROM_FORM;
    return FROM_NONE;
}
// C ref: youprop.h Very_fast == (HFast & (TIMEOUT|FROMOUTSIDE)) || EFast.
// js/insight.js youHaveVeryFast() is the live copy behind from_what().
const AT_TIMEOUT = 0x00ffffff;
function Very_fast_at() {
    return !!((intrinsic_bits_at(P_FAST) & (AT_TIMEOUT | AT_FROMOUTSIDE))
        || extrinsic_bits_at(P_FAST));
}
// C ref: mondata.h haseyes(ptr) == !(mflags1 & M1_NOEYES).  An unpolymorphed
// hero always has eyes; js/apply.js:1838 keeps the same predicate for monsters.
function haseyes_at() {
    const ptr = game.u?.Upolyd ? game.u?.data : null;
    if (!ptr) return true;
    const M1_NOEYES = 0x1000;
    return ((ptr.mflags1 | 0) & M1_NOEYES) === 0;
}

// ─── attrib.c:1182 adjuhploss(loss, olduhp) ────────────────────────────────
// Called after setuhpmax() when damage is pending: if uhpmax (or mhmax) has
// been reduced, uhp (or mh) may have been reduced with it, so recalculate the
// pending loss to account for that.  js/attrib.js:219 inlines the clamp half of
// this inside poisoned(); that call site is left alone.
export function adjuhploss(loss, olduhp) {
    const u = game.u;
    if (!u?.Upolyd) {
        if ((u?.uhp | 0) < olduhp) loss -= (olduhp - (u?.uhp | 0));
    } else {
        if ((u?.mh | 0) < olduhp) loss -= (olduhp - (u?.mh | 0));
    }
    return Math.max(loss, 1);
}
