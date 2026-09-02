// spell.js — spell memory + casting.
// C ref: spell.c.  Ports initialspell (memorize a starting spellbook),
// num_spells, the cast command entry (docast / getspell + dospellmenu) and
// spelleffects for the healing-on-self case exercised by the gameplay sessions.

import { game } from './gstate.js';
import { rn2, rnd, rn1, rnl, d } from './rng.js';
import { pline, update_topl, m_at, map_invisible, canseemon_shared } from './display.js';
import { exercise } from './attrib.js';
import { objects, mksobj, weight, set_bknown, SPE_BLANK_PAPER, SPE_NOVEL } from './mkobj.js';
import { SPELL_META } from './u_init.js';
import { A_WIS, A_INT, A_STR, P_UNSKILLED, P_EXPERT, P_SKILLED, P_BASIC,
         STRAT_WAITFORU, STRAT_APPEARMSG, EXT_ENCUMBER,
         isok, u_at, IS_STWALL, IS_DOOR, IS_TREE, ZAP_POS, SPACE_POS,
         D_ISOPEN, D_CLOSED, D_LOCKED, POOL, MOAT, DRAWBRIDGE_UP, LAVAPOOL,
         CLOUD, N_DIRS, xdir, ydir, SPINE, NO_MINVENT, ACH_INVK,
         Is_waterlevel } from './const.js';
import { p_skill_of, use_skill } from './enhance.js';
import { monster_by_pmidx, makemon, set_malign, name_to_pmidx } from './makemon.js';
import { msound_of, mflags1_of, mflags2_of, M1_NOHEAD, M2_UNDEAD,
         is_animal } from './monflags_data.js';
import { discover_object, observe_object } from './o_init.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
import { distmin, dist2 } from './hacklib.js';
import { cansee, Blind } from './vision.js';
import { hcolor, hliquid } from './do_name.js';
import { find_ac } from './u_init.js';
import { DEADMONSTER } from './mon.js';
import { resists_elec } from './mondata.js';

// C ref: objclass.h obj_material_types — is_metallic() = material in [IRON,MITHRIL].
const MAT_IRON = 11, MAT_MITHRIL = 17;
// C ref: include/objects.h — otyp constants used by percent_success / weight.
const OTYP_ROBE = 143, OTYP_QUARTERSTAFF = 79;
// C ref: include/objects.h — objects[SMALL_SHIELD].oc_weight.
const SMALL_SHIELD_OC_WEIGHT = 30;
// C ref: spell.c — metal armor casting penalties.
const UARMHBON = 4, UARMGBON = 6, UARMFBON = 2;

function ACURR(i) { return game.u?.acurr?.a?.[i] ?? 0; }
function is_metallic_obj(o) {
    const m = objects[o?.otyp]?.material;
    return m != null && m >= MAT_IRON && m <= MAT_MITHRIL;
}

// C ref: spell.c spelltypemnemonic — skill discipline -> menu category name.
const SKILL_CATEGORY = {
    28: 'attack', 29: 'healing', 30: 'divination', 31: 'enchantment',
    32: 'clerical', 33: 'escape', 34: 'matter',
};
export function spell_skilltype(otyp) { return SPELL_META.get(otyp)?.skill ?? 0; }
export function spell_level_of(otyp) { return SPELL_META.get(otyp)?.level ?? 1; }
export function spelltypemnemonic(otyp) {
    return SKILL_CATEGORY[spell_skilltype(otyp)] || 'attack';
}

// C ref: objclass.h:184 `MAXSPELL = (LAST_SPELL - FIRST_SPELL + 1)`, i.e.
// SPE_BLANK_PAPER - SPE_DIG + 1.  Both markers resolve against this tree's own
// objects[] as otyp 407 and 366, so MAXSPELL is 42, not 25.  It sizes
// spl_book[] and gates learn()'s "Too many spells memorized!" arm.
export const MAXSPELL = 42;
export const NO_SPELL = 0;
export const KEEN = 20000; // C ref: spell.c — full spell retention.
// C ref: include/monsters.h MS_* — the msound values can_chant() rejects.
const MS_SILENT = 0, MS_BUZZ = 10, MS_BURBLE = 16;

const ECMD_OK = 0;
const ECMD_FAIL = 0;
const ECMD_TIME = 1;

// C ref: include/objects.h — the healing spellbook otyps.  These must match the
// real objects[] indices (see mkobj.js SPE_* table); a wrong value both mis-keys
// the applySpell() switch and drops/misapplies the "healing spell" caster bonus
// in percent_success().
const SPE_HEALING = 374;
const SPE_DETECT_FOOD = 383;
const SPE_CURE_BLINDNESS = 378;
const SPE_CURE_SICKNESS = 386;
const SPE_EXTRA_HEALING = 391;
const SPE_RESTORE_ABILITY = 392;
const SPE_REMOVE_CURSE = 395;

// spl_book lives on the game object: an array of { sp_id, sp_lev, sp_know }.
function spl_book() {
    if (!Array.isArray(game.spl_book)) {
        game.spl_book = Array.from({ length: MAXSPELL }, () => ({
            sp_id: NO_SPELL, sp_lev: 0, sp_know: 0,
        }));
    }
    return game.spl_book;
}

function spellid(i) { return spl_book()[i]?.sp_id ?? NO_SPELL; }
function spellev(i) { return spl_book()[i]?.sp_lev ?? 0; }
function spellknow(i) { return spl_book()[i]?.sp_know ?? 0; }

// Index-based accessors for the dovspell view menu (invent.js).
export function spellid_at(i) { return spellid(i); }
export function spellknow_at(i) { return spellknow(i); }
export function percent_success_at(i) { return percent_success(i); }
export function spellretention_at(i) { return spellretention(i); }

// C ref: spell.c age_spells() — every move-loop pass decrements each known
// spell's retention by one (decrnknow).  Consumes no RNG.
export function age_spells() {
    const book = spl_book();
    for (let i = 0; i < MAXSPELL && book[i].sp_id !== NO_SPELL; i++)
        if (book[i].sp_know) book[i].sp_know--;
}

// C ref: spell.c num_spells — count of known spells (until first NO_SPELL).
export function num_spells() {
    let i = 0;
    for (; i < MAXSPELL; i++)
        if (spellid(i) === NO_SPELL) break;
    return i;
}

// C ref: spell.c initialspell — memorize a starting-inventory spellbook,
// filling the next free spl_book slot with full retention (no RNG).
export function initialspell(obj) {
    const otyp = obj.otyp;
    const book = spl_book();
    let i = 0;
    for (; i < MAXSPELL; i++)
        if (spellid(i) === NO_SPELL || spellid(i) === otyp) break;
    if (i === MAXSPELL || spellid(i) !== NO_SPELL) return;
    book[i].sp_id = otyp;
    book[i].sp_lev = spell_level_of(otyp); // C: objects[otyp].oc_level
    book[i].sp_know = KEEN;
}

// C ref: spell.c skill_based_spellbook_id() — Wizards recognize spellbook
// appearances according to their current skill in each spell school.
export function skill_based_spellbook_id() {
    const rolemnum = game.urole?.mnum ?? game.u?.umonnum;
    if (rolemnum !== 12) return;
    for (const [otyp, meta] of SPELL_META) {
        if (!meta.skill) continue;
        const skill = p_skill_of(meta.skill);
        const maxLevel = skill === P_BASIC ? 3
            : skill === P_SKILLED ? 5
                : skill >= P_EXPERT ? 7
                    : game.u?.uroleplay?.pauper ? 0 : 1;
        if (meta.level <= maxLevel)
            discover_object(otyp, true, false, false);
    }
}

// C ref: spell.c docast — the 'Z' command.
export async function docast() {
    const spellNo = await getspell();
    if (spellNo >= 0)
        return await spelleffects(spellid(spellNo), false, false);
    return ECMD_FAIL;
}

// C ref: mon.c can_chant(&youmonst) — a Strangled hero, or one polymorphed into
// a voiceless/headless form, can't chant an incantation.
function can_chant_hero() {
    const u = game.u;
    if (u?.uprops?.Strangled) return false;
    // u.umonnum holds the ROLE number, not a permonst index, unless the hero is
    // polymorphed (polyself.js sets Upolyd when umonnum != umonster) — reading
    // the mons[] tables with a role number names an unrelated monster.  Every
    // role's player monster is voiced and has a head, so an unpolymorphed hero
    // can always chant.
    if (!u?.Upolyd) return true;
    const ptr = monster_by_pmidx(u.umonnum);
    if (!ptr) return true;
    const ms = msound_of(ptr);
    if (ms === MS_SILENT || ms === MS_BUZZ || ms === MS_BURBLE) return false;
    if ((mflags1_of(ptr) & M1_NOHEAD) !== 0) return false;   /* !has_head */
    return true;
}

// C ref: spell.c rejectcasting() — the pre-selection rejections, checked BEFORE
// the spell menu opens.  Was missing entirely: a stunned hero pressing 'Z' got
// our spell menu (C prints one line and takes no turn), so every keystroke the
// player spent picking a spell fell through to rhack() as a phantom command.
async function rejectcasting() {
    const u = game.u;
    // C ref: youprop.h Stunned = HStun || EStun.
    if ((u?.uprops?.Stun || 0) > 0 || !!u?.Stunned) {
        await pline('You are too impaired to cast a spell.');
        return true;
    }
    if (!can_chant_hero()) {
        await pline('You are unable to chant the incantation.');
        return true;
    }
    // C's third arm is `!freehand() && !(uwep && uwep->otyp == QUARTERSTAFF)`
    // -> "Your arms are not free to cast!".  freehand() is
    // (!uwep || !welded(uwep) || ...) and invent.js welded() is a constant
    // FALSE in this port, so the arm cannot fire; restore it with welded().
    return false;
}

// C ref: spell.c getspell — choose a spell to cast via the popup menu.
async function getspell() {
    const nspells = num_spells();
    if (!nspells) {
        await pline("You don't know any spells right now.");
        return -1;
    }
    if (await rejectcasting()) return -1;
    const { spell_menu } = await import('./invent.js');
    const meta = {
        name: (otyp) => objects[otyp]?.name || '',
        category: (otyp) => spelltypemnemonic(otyp),
        fail: (i) => 100 - percent_success(i),  // displayed Fail%
        retention: (i) => spellretention(i),
        // wizard-mode "turns" column: C prints spellknow(i) raw (note it uses
        // the LOOP index i here while the other fields use the sort-order index;
        // with no custom sort the two coincide).
        turns: (i) => spellknow(i),
    };
    return await spell_menu('Choose which spell to cast', nspells, spl_book(), meta);
}

// C ref: spell.c spellretention(idx, outbuf) — retention as a percentage range
// whose precision depends on the hero's skill in the spell's discipline:
//   expert 2% / skilled 5% / basic 10% / unskilled 25% intervals.
// "100%" when freshly learned (sp_know >= KEEN), "(gone)" when expired.
function spellretention(i) {
    let skill = p_skill_of(spell_skilltype(spellid(i)));
    skill = Math.max(skill, P_UNSKILLED); // restricted same as unskilled
    const turnsleft = spellknow(i);
    if (turnsleft < 1) return '(gone)';
    if (turnsleft >= KEEN) return '100%';
    // percent = (turnsleft - 1) / (KEEN/100) + 1
    let percent = Math.trunc((turnsleft - 1) / Math.trunc(KEEN / 100)) + 1;
    const accuracy = skill === P_EXPERT ? 2
        : skill === P_SKILLED ? 5
            : skill === P_BASIC ? 10 : 25;
    // round up to the high end of this range
    percent = accuracy * (Math.trunc((percent - 1) / accuracy) + 1);
    return `${percent - accuracy + 1}%-${percent}%`;
}

// C ref: spell.c SPELL_LEV_PW — energy cost = 5 * spell level.
function SPELL_LEV_PW(lev) { return 5 * lev; }

// C ref: spell.c isqrt — integer square root (used by percent_success).
function isqrt(val) {
    let r = Math.floor(Math.sqrt(val));
    while ((r + 1) * (r + 1) <= val) r++;
    while (r * r > val) r--;
    return r;
}


// C ref: spell.c percent_success(spell) — combine intrinsic ability
// (splcaster, from role spell stats + worn armor) with learned ability
// (chance, from magic stat, hero level and skill) into a 0..100 cast chance.
// `spell` is a spl_book[] index.
function percent_success(spell) {
    const u = game.u || {};
    const role = game.urole || {};
    const sp = role.spel || { base: 0, heal: 0, shld: 0, armr: 0, stat: A_WIS, spec: 0, sbon: 0 };
    const otyp = spellid(spell);
    const skilltype = spell_skilltype(otyp);
    // Knights don't get the metal-armor penalty for clerical spells.
    const Role_if_KNIGHT = role.mnum === 4;
    const paladin_bonus = Role_if_KNIGHT && skilltype === 32 /*P_CLERIC_SPELL*/;

    let splcaster = sp.base;
    const special = sp.heal;
    const statused = ACURR(sp.stat);

    const uarm = game.uarm, uarmc = game.uarmc, uarms = game.uarms,
        uarmh = game.uarmh, uarmg = game.uarmg, uarmf = game.uarmf,
        uwep = game.uwep;

    if (uarm && is_metallic_obj(uarm) && !paladin_bonus)
        splcaster += (uarmc && uarmc.otyp === OTYP_ROBE)
            ? Math.trunc(sp.armr / 2) : sp.armr;
    else if (uarmc && uarmc.otyp === OTYP_ROBE)
        splcaster -= sp.armr;
    if (uarms)
        splcaster += sp.shld;
    if (uwep && uwep.otyp === OTYP_QUARTERSTAFF)
        splcaster -= 3;
    if (!paladin_bonus) {
        if (uarmh && is_metallic_obj(uarmh)) splcaster += UARMHBON;
        if (uarmg && is_metallic_obj(uarmg)) splcaster += UARMGBON;
        if (uarmf && is_metallic_obj(uarmf)) splcaster += UARMFBON;
    }
    if (otyp === sp.spec) splcaster += sp.sbon;
    // C ref: spell.c percent_success — the "healing spell" caster bonus applies
    // to the healing family (healing, extra healing, cure blindness, cure
    // sickness, restore ability, remove curse) but NOT to stone to flesh.
    if (otyp === SPE_HEALING || otyp === SPE_EXTRA_HEALING
        || otyp === SPE_CURE_BLINDNESS || otyp === SPE_CURE_SICKNESS
        || otyp === SPE_RESTORE_ABILITY || otyp === SPE_REMOVE_CURSE)
        splcaster += special;
    if (splcaster > 20) splcaster = 20;

    let chance = Math.trunc(11 * statused / 2);
    let skill = p_skill_of(skilltype);
    skill = Math.max(skill, P_UNSKILLED) - 1; // unskilled => 0
    const difficulty = (spellev(spell) - 1) * 4
        - (skill * 6 + Math.trunc((u.ulevel || 1) / 3) + 1);
    if (difficulty > 0) {
        chance -= isqrt(900 * difficulty + 2000);
    } else {
        const learning = Math.trunc(15 * -difficulty / spellev(spell));
        chance += learning > 20 ? 20 : learning;
    }
    if (chance < 0) chance = 0;
    if (chance > 120) chance = 120;

    // C: weight(uarms) > objects[SMALL_SHIELD].oc_weight (30).  This used to
    // consult a 9-entry otyp->weight table whose `?? OTYP_SMALL_SHIELD` default
    // returned the OTYP 150 as a weight, so any shield outside the table was
    // silently treated as heavy; mkobj.js carries the real per-otyp oc_weight.
    if (uarms && weight(uarms) > SMALL_SHIELD_OC_WEIGHT) {
        if (otyp === sp.spec) chance = Math.trunc(chance / 2);
        else chance = Math.trunc(chance / 4);
    }

    chance = Math.trunc(chance * (20 - splcaster) / 15) - splcaster;
    if (chance > 100) chance = 100;
    if (chance < 0) chance = 0;
    return chance;
}

// C ref: spell.c spell_backfire(spell) — what casting a forgotten spell does.
// One rn2(10) and no other draw; the confusion/stun timers it sets steer later
// moves (confdir()'s rn2(8) redirect), so this is not cosmetic.
function spell_backfire(spell) {
    const u = game.u;
    if (!u.uprops) u.uprops = {};
    const duration = (spellev(spell) + 1) * 3;           /* 6..24 */
    const old_stun = u.uprops.Stun || 0, old_conf = u.uprops.Confusion || 0;
    const set_conf = (t) => { u.uprops.Confusion = t; u.uconf = t > 0; };
    const set_stun = (t) => { u.uprops.Stun = t; };
    switch (rn2(10)) {
    case 0: case 1: case 2: case 3:
        set_conf(old_conf + duration);                                   /* 40% */
        break;
    case 4: case 5: case 6:
        set_conf(old_conf + Math.trunc(2 * duration / 3));               /* 30% */
        set_stun(old_stun + Math.trunc(duration / 3));
        break;
    case 7: case 8:
        set_stun(old_stun + Math.trunc(2 * duration / 3));               /* 20% */
        set_conf(old_conf + Math.trunc(duration / 3));
        break;
    default:
        set_stun(old_stun + duration);                                   /* 10% */
        break;
    }
    game.botl = true;
}

// C ref: hack.c check_capacity(str) — near_capacity() >= EXT_ENCUMBER.
async function check_capacity_spell(str) {
    const { near_capacity } = await import('./invent.js');
    if (near_capacity() >= EXT_ENCUMBER) {
        await pline(str);
        return true;
    }
    return false;
}

// C ref: eat.c morehungry(num) — u.uhunger -= num; newuhs(TRUE).  newuhs can
// draw (the FAINTING rn2(20 - uhunger/10)), so skipping the hunger cost of
// casting shifts the whole later stream, not just the botl hunger word.
async function morehungry_spell(num) {
    const u = game.u;
    u.uhunger = (u.uhunger ?? 900) - num;
    const { newuhs } = await import('./eat.js');
    await newuhs(true);
}

// C ref: spell.c spelleffects_check — pre-cast validation.  Returns
// { fail:true, code } if the cast should not proceed.  Every branch below used
// to be summarised away as "doesn't trip on the covered starts"; the
// insufficient-energy one in particular fires for any level-1 caster whose
// spell costs more Pw than they have, where C draws NO rnd(100) at all.
async function spelleffects_check(spell) {
    const u = game.u;
    const confused = !!(u?.uconf || (u?.uprops?.Confusion || 0) > 0);
    if (spell < 0 || await rejectcasting())
        return { fail: true, code: ECMD_OK, energy: 0 };

    const energy = SPELL_LEV_PW(spellev(spell));

    if (spellknow(spell) <= 0) {
        await pline('Your knowledge of this spell is twisted.');
        await pline('It invokes nightmarish images in your mind...');
        spell_backfire(spell);
        u.uen -= rnd(energy);
        if (u.uen < 0) u.uen = 0;
        game.botl = true;
        return { fail: true, code: ECMD_TIME, energy };
    } else if (spellknow(spell) <= KEEN / 200) {
        await pline('You strain to recall the spell.');
    } else if (spellknow(spell) <= KEEN / 40) {
        await pline('You have difficulty remembering the spell.');
    } else if (spellknow(spell) <= KEEN / 20) {
        await pline('Your knowledge of this spell is growing faint.');
    } else if (spellknow(spell) <= KEEN / 10) {
        await pline('Your recall of this spell is gradually fading.');
    }

    if ((u.uhunger ?? 900) <= 10 && spellid(spell) !== SPE_DETECT_FOOD) {
        await pline('You are too hungry to cast that spell.');
        return { fail: true, code: ECMD_OK, energy };
    } else if (ACURR(A_STR) < 4 && spellid(spell) !== SPE_RESTORE_ABILITY) {
        await pline('You lack the strength to cast spells.');
        return { fail: true, code: ECMD_OK, energy };
    } else if (await check_capacity_spell(
                   'Your concentration falters while carrying so much stuff.')) {
        return { fail: true, code: ECMD_TIME, energy };
    }

    let res = ECMD_OK;
    // Carrying the Amulet drains energy on every cast attempt (rnd(2*energy)),
    // and the attempt costs a turn even when the drain leaves too little Pw.
    if (u.uhave?.amulet && u.uen >= energy) {
        await pline('You feel the amulet draining your energy away.');
        u.uen -= rnd(2 * energy);
        if (u.uen < 0) u.uen = 0;
        game.botl = true;
        res = ECMD_TIME;
    }

    if (energy > u.uen) {
        // C leaves *res alone here: ECMD_OK unless the amulet already charged
        // a turn.  Crucially it returns BEFORE the rnd(100) cast roll.
        const suffix = (u.uen < u.uenmax) ? ''
            : (energy > (u.uenpeak ?? u.uenmax)) ? ' yet' : ' anymore';
        await pline(`You don't have enough energy to cast that spell${suffix}.`);
        return { fail: true, code: res, energy };
    }
    if (spellid(spell) !== SPE_DETECT_FOOD) {
        let hungr = energy * 2;
        // Wizards with high Int think their way through a spell more cheaply.
        const intell = (game.urole?.mnum === PM_WIZARD) ? ACURR(A_INT) : 10;
        if (intell >= 17) hungr = 0;
        else if (intell === 16) hungr = Math.trunc(hungr / 4);
        else if (intell === 15) hungr = Math.trunc(hungr / 2);
        // don't put the player (quite) into fainting from casting
        if (hungr > (u.uhunger ?? 900) - 3) hungr = (u.uhunger ?? 900) - 3;
        await morehungry_spell(hungr);
    }

    const chance = percent_success(spell);
    if (confused || (rnd(100) > chance)) {
        return { fail: true, code: ECMD_TIME, energy, failedcast: true };
    }
    return { fail: false, code: ECMD_OK, energy };
}

// C ref: spell.c spelleffects — apply a cast spell.  Exported so cmd.js's
// #turn fallback (a non-Priest/Knight who has the turn-undead spell in the
// spellbook casts it) can reach it; extcmd-handlers.js already probed for
// `spelleffects_ext` but nothing ever exported it, so that arm was dead.
export async function spelleffects_ext(spell_otyp) {
    return await spelleffects(spell_otyp, false, false);
}
async function spelleffects(spell_otyp, atme, force) {
    const spell = force ? spell_otyp : spell_idx(spell_otyp);
    let energy = 0;
    if (!force) {
        const chk = await spelleffects_check(spell);
        if (chk.fail) {
            if (chk.failedcast) {
                // update_topl(), not pline(): the monsters that move during this
                // same turn write their own messages onto the SAME topline, and
                // C's You() appends ("You fail to cast the spell correctly.  The
                // newt misses!").  pline() replaces the line, so only the
                // monster's half survived.
                await update_topl('You fail to cast the spell correctly.');
                game.u.uen -= Math.trunc(chk.energy / 2);
                game.botl = true;
            }
            return chk.code;
        }
        energy = chk.energy;
    }

    game.u.uen -= energy;
    game.botl = true;
    exercise(A_WIS, true);

    // C: pseudo = mksobj(spellid, FALSE, FALSE) — init=FALSE skips the class
    // init switch but still assigns o_id via next_ident (one rnd(2)).
    const pseudo = mksobj(force ? spell_otyp : spellid(spell), false, false);
    pseudo.blessed = 0;
    pseudo.cursed = 0;
    pseudo.quan = 20;
    const role_skill = p_skill_of(spell_skilltype(pseudo.otyp));
    const rc = await applySpell(pseudo.otyp, atme, pseudo, role_skill, spell);
    // C ref: spell.c spelleffects tail — "gain skill for successful cast".
    // use_skill() bumps P_ADVANCE and can print "You feel more confident in
    // your <school> skills." (and changes what #enhance offers); omitting it
    // left every caster's spell skills frozen at their chargen value.
    if (!force) use_skill(spell_skilltype(pseudo.otyp), spellev(spell));
    return rc;
}

function spell_idx(otyp) {
    for (let i = 0; i < MAXSPELL; i++)
        if (spellid(i) === otyp) return i;
    return -1;
}

// C ref: include/objects.h — the spellbook otyps spelleffects() dispatches on.
const SPE_DIG = 366, SPE_MAGIC_MISSILE = 367, SPE_FIREBALL = 368,
    SPE_CONE_OF_COLD = 369, SPE_SLEEP = 370, SPE_FINGER_OF_DEATH = 371,
    SPE_FORCE_BOLT = 376,
    SPE_LIGHT = 372, SPE_DETECT_MONSTERS = 373, SPE_KNOCK = 375,
    SPE_CONFUSE_MONSTER = 377, SPE_DRAIN_LIFE = 379, SPE_SLOW_MONSTER = 380,
    SPE_WIZARD_LOCK = 381, SPE_CREATE_MONSTER = 382, SPE_CAUSE_FEAR = 384,
    SPE_CLAIRVOYANCE = 385, SPE_CHARM_MONSTER = 387, SPE_HASTE_SELF = 388,
    SPE_DETECT_UNSEEN = 389, SPE_LEVITATION = 390, SPE_INVISIBILITY = 393,
    SPE_DETECT_TREASURE = 394, SPE_MAGIC_MAPPING = 396, SPE_IDENTIFY = 397,
    SPE_TURN_UNDEAD = 398, SPE_POLYMORPH = 399, SPE_TELEPORT_AWAY = 400,
    SPE_CREATE_FAMILIAR = 401, SPE_CANCELLATION = 402, SPE_PROTECTION = 403,
    SPE_JUMPING = 404, SPE_STONE_TO_FLESH = 405, SPE_CHAIN_LIGHTNING = 406;

// C ref: objclass.h oc_dir — NODIR/IMMEDIATE/RAY, as carried by objects[].dir.
const NODIR = 1;

// C ref: hack.c losehp(n, knam, k_format) — the local copy every file that
// damages the hero keeps (potion.js, dig.js, ...).
async function losehp_spell(dmg) {
    const u = game.u;
    if (!u) return;
    if (u.Upolyd) {
        u.mh = (u.mh | 0) - dmg;
        if (u.mh < 1) u.mh = 0;
        game.botl = true;
        return;
    }
    u.uhp = (u.uhp | 0) - dmg;
    game.botl = true;
    if (u.uhp < 1) {
        const { done_in_by } = await import('./end.js');
        await done_in_by(null, 0 /*DIED*/);
    }
}

// C ref: youprop.h Maybe_Half_Phys(dmg).
function Maybe_Half_Phys(dmg) {
    return (game.u?.uprops?.Half_physical_damage) ? Math.trunc((dmg + 1) / 2) : dmg;
}

// C ref: spell.c spelleffects() switch — the per-otyp effect, split out so the
// energy/exercise/mksobj preamble above reads like C's.  `otyp` is pseudo->otyp,
// `role_skill` is P_SKILL(spell_skilltype(otyp)) and `spell` the spl_book index.
//
// The wand-duplicate arm (the first case group) used to be missing entirely:
// only SPE_HEALING/SPE_EXTRA_HEALING had a case and every other directional
// spell fell through a silent `default:`.  That skipped getdir(), so casting
// force bolt or magic missile consumed the turn WITHOUT prompting "In what
// direction?" and the direction key the player typed next fell through to
// rhack() as a phantom movement command.
async function applySpell(otyp, atme, pseudo, role_skill, spell) {
    const u = game.u;
    let physical_damage = false;

    switch (otyp) {
    /*
     * At first spells act as expected.  As the hero increases in skill
     * with the appropriate spell type, some spells increase in their
     * effects, e.g. more damage, further distance, and so on, without
     * additional cost to the spellcaster.
     */
    case SPE_FIREBALL:
    case SPE_CONE_OF_COLD:
        if (role_skill >= P_SKILLED) {
            // DEFERRED: C's Skilled+ arm runs throwspell() (a getpos() spot
            // pick with a highlighted 10-square radius, then walk_path) and
            // explode()s rnd(8)+1 times around it.  Neither throwspell's
            // getpos_sethilite overlay nor explode() is ported; falling through
            // to the beam arm below would draw the WRONG RNG, so leave the
            // whole cast a no-op until both exist.
            break;
        }
        /* FALLTHRU */

    /* these spells are all duplicates of wand effects */
    case SPE_FORCE_BOLT:
        physical_damage = true;
        /* FALLTHRU */
    case SPE_SLEEP:
    case SPE_MAGIC_MISSILE:
    case SPE_KNOCK:
    case SPE_SLOW_MONSTER:
    case SPE_WIZARD_LOCK:
    case SPE_DIG:
    case SPE_TURN_UNDEAD:
    case SPE_POLYMORPH:
    case SPE_TELEPORT_AWAY:
    case SPE_CANCELLATION:
    case SPE_FINGER_OF_DEATH:
    case SPE_LIGHT:
    case SPE_DETECT_UNSEEN:
    case SPE_HEALING:
    case SPE_EXTRA_HEALING:
    case SPE_DRAIN_LIFE:
    case SPE_STONE_TO_FLESH: {
        const { weffects, zapyourself } = await import('./zap.js');
        if (objects[otyp]?.dir !== NODIR) {
            if (otyp === SPE_HEALING || otyp === SPE_EXTRA_HEALING) {
                /* healing and extra healing are actually potion effects,
                   but they've been extended to take a direction like wands */
                if (role_skill >= P_SKILLED) pseudo.blessed = 1;
            }
            if (atme) {
                u.dx = u.dy = u.dz = 0;
            } else {
                const { getdir } = await import('./cmd.js');
                const dir = await getdir(null);
                if (dir) {
                    // C's getdir() reports through u.dx/u.dy/u.dz (movecmd()
                    // writes all three, and the '.'-at-self arm zeroes them).
                    // cmd.js's getdir_confdir() only writes u.dx/u.dy, and skips
                    // even those when dz != 0, so a '<'/'>' cast would read the
                    // previous direction; publish the whole triple here.
                    u.dx = dir.dx; u.dy = dir.dy; u.dz = dir.dz;
                } else {
                    // C ref: spell.c spelleffects — a cancelled getdir does NOT
                    // abort; C announces the release and falls through with the
                    // PREVIOUS u.dx/u.dy still in place (commonly the last
                    // movement direction).  cmd.c movecmd() zeroes only u.dz on
                    // the reject path, so mirror that and leave dx/dy alone.
                    u.dz = 0;
                    await pline('The magical energy is released!');
                }
            }
            if (!u.dx && !u.dy && !u.dz) {
                let damage = await zapyourself(pseudo, true);
                if (damage) {
                    if (physical_damage) damage = Maybe_Half_Phys(damage);
                    await losehp_spell(damage);
                }
            } else {
                await weffects(pseudo);
            }
        } else {
            await weffects(pseudo);
        }
        /* C: update_inventory() — invent.js's is a no-op without perm_invent. */
        break;
    }

    /* these are all duplicates of scroll effects */
    case SPE_REMOVE_CURSE:
    case SPE_CONFUSE_MONSTER:
    case SPE_DETECT_FOOD:
    case SPE_CAUSE_FEAR:
    case SPE_IDENTIFY:
    case SPE_CHARM_MONSTER:
        /* high skill yields effect equivalent to blessed scroll */
        if (role_skill >= P_SKILLED) pseudo.blessed = 1;
        /* FALLTHRU */
    case SPE_MAGIC_MAPPING:
    case SPE_CREATE_MONSTER: {
        const { seffects } = await import('./read.js');
        await seffects(pseudo);
        break;
    }

    /* these are all duplicates of potion effects */
    case SPE_HASTE_SELF:
    case SPE_DETECT_TREASURE:
    case SPE_DETECT_MONSTERS:
    case SPE_LEVITATION:
    case SPE_RESTORE_ABILITY:
        /* high skill yields effect equivalent to blessed potion */
        if (role_skill >= P_SKILLED) pseudo.blessed = 1;
        /* FALLTHRU */
    case SPE_INVISIBILITY: {
        const { peffects } = await import('./potion.js');
        await peffects(pseudo);
        break;
    }
    /* end of potion-like spells */

    case SPE_CURE_BLINDNESS:
        await healup(0, 0, false, true);
        break;
    case SPE_CURE_SICKNESS: {
        const was_sick = !!(u?.uprops?.Sick), was_slimed = !!(u?.uprops?.Slimed);

        /* cure conditions (which updates status) before feedback */
        await healup(0, 0, true, false);
        if (was_sick || !was_slimed)
            await pline(`You are ${was_sick ? 'no longer' : 'not'} ill.`);
        if (was_slimed) {
            // C: make_slimed(0L, "The slime disappears!").  potion.c's timer
            // helper has no port; artifact.js clears u.uprops.Slimed the same
            // way.  Neither draws RNG.
            u.uprops.Slimed = 0;
            await pline('The slime disappears!');
        }
        break;
    }
    case SPE_CLAIRVOYANCE:
    case SPE_CREATE_FAMILIAR:
    case SPE_PROTECTION:
    case SPE_JUMPING:
    case SPE_CHAIN_LIGHTNING:
        // DEFERRED: do_vicinity_map(), make_familiar(), cast_protection(),
        // jump() and cast_chain_lightning() have no port yet.  cast_protection
        // in particular can't land alone: nothing decrements u.usptime in the
        // move loop, so its AC bonus would never expire.
        break;
    default:
        // C: impossible("Unknown spell %d attempted.", spell) then ECMD_OK.
        break;
    }
    return ECMD_TIME;
}

// C ref: potion.c healup(nhp, nxtra, curesick, cureblind).
async function healup(nhp, nxtra, curesick, cureblind) {
    const u = game.u;
    if (nhp) {
        u.uhp += nhp;
        if (u.uhp > u.uhpmax) {
            u.uhpmax += nxtra;
            u.uhp = u.uhpmax;
            if (u.uhpmax > (u.uhppeak || 0)) u.uhppeak = u.uhpmax;
        }
    }
    if (!u.uprops) u.uprops = {};
    if (cureblind) {
        // C: make_blinded(0L, TRUE) + make_deaf(0L, TRUE); u.ucreamed = 0 is
        // done inside make_blinded.
        const { make_blinded_hero } = await import('./potion.js');
        await make_blinded_hero(0, true);
        u.uprops.HDeaf = 0;
    }
    if (curesick) {
        u.uprops.Sick = 0;
        u.usick_type = 0;
        game.botl = true;
    }
}

// C ref: include/objects.h SPELL(...,delay,...) — objects[otyp].oc_delay, the
// per-spellbook study delay (parallel to SPELL_META's oc_level).  The JS objects
// table doesn't carry oc_delay, so it lives here keyed by otyp (SPE_*).
const SPELL_DELAY = new Map([
    [366, 6], [367, 2], [368, 4], [369, 7], [370, 1], [371, 10], [372, 1],
    [373, 1], [374, 2], [375, 1], [376, 2], [377, 2], [378, 2], [379, 2],
    [380, 2], [381, 3], [382, 3], [383, 3], [384, 3], [385, 3], [386, 3],
    [387, 3], [388, 4], [389, 4], [390, 4], [391, 5], [392, 5], [393, 5],
    [394, 5], [395, 5], [396, 7], [397, 6], [398, 8], [399, 8], [400, 6],
    [401, 7], [402, 8], [403, 3], [404, 3], [405, 1], [406, 4],
]);
function oc_delay_of(otyp) { return SPELL_DELAY.get(otyp) ?? 0; }

const PM_WIZARD = 12; // C ref: include/monsters.h; role check for the difficulty prompt.
const LENSES = 232; // C ref: include/objects.h otyp; +2 read_ability when worn.
const SPE_BOOK_OF_THE_DEAD = 409; // C ref: include/objects.h otyp.
const MAX_SPELL_STUDY = 3;  // C ref: include/spell.h:12

// C ref: hack.c nomul(nval) — make the hero helpless/busy for |nval| turns.
// `if (multi < nval) return; multi = nval;` plus clearing travel state.  Set
// directly (like potion.c peffect_paralysis in potion.js): the move loop's
// multi<0 countdown runs the busy turns and announces nomovemsg when it hits 0.
function nomul(nval) {
    if ((game.multi ?? 0) < nval) return;
    game.multi = nval;
    game.context = game.context || {};
    game.context.travel = game.context.travel1 = game.context.mv = 0;
}

// C ref: wizard.c aggravate() — wake every monster on the level and clear its
// "wait for you" / "appear message" strategy; a frozen monster gets a 1-in-5
// chance to become able to move again.  In_W_tower is irrelevant off the Wizard
// tower (both hero and monsters test FALSE), so no monster is skipped.
function aggravate() {
    const mons = game.fmon || game.level?.monsters || [];
    for (const mtmp of mons) {
        if (!mtmp) continue;
        if (mtmp.mhp != null && mtmp.mhp < 1) // DEADMONSTER(mtmp)
            continue;
        mtmp.mstrategy = (mtmp.mstrategy | 0) & ~(STRAT_WAITFORU | STRAT_APPEARMSG);
        mtmp.msleeping = 0;
        if (!mtmp.mcanmove && !rn2(5)) {
            mtmp.mfrozen = 0;
            mtmp.mcanmove = 1;
        }
    }
}

// C ref: spell.c cursed_book() — malign effects when reading a book that's too
// hard (or cursed).  Selector is rn2(oc_level); with oc_level <= 7 the switch
// never reaches the `default` (rndcurse) arm.  Returns TRUE if the book is
// destroyed (only the exploding-rune arm, reachable for level-7 books).
async function cursed_book(bp) {
    const lev = spell_level_of(bp.otyp); // objects[bp->otyp].oc_level
    let dmg = 0;
    switch (rn2(lev)) {
    case 0:
        await update_topl('You feel a wrenching sensation.');
        // tele() (teleport self) not ported; effect omitted.
        break;
    case 1:
        await update_topl('You feel threatened.');
        aggravate();
        break;
    case 2:
        // make_blinded(BlindedTimeout + rn1(100, 250), TRUE)
        rn1(100, 250);
        break;
    case 3:
        // take_gold(): remove all carried coins (no RNG); effect omitted here.
        break;
    case 4:
        await update_topl('These runes were just too much to comprehend.');
        // make_confused(HConfusion + rn1(7, 16), FALSE)
        rn1(7, 16);
        break;
    case 5: {
        await update_topl('The book was coated with contact poison!');
        // uarmg erode path (no hero gloves in the covered flow); else poison.
        const Poison_resistance = !!game.u?.Poison_resistance;
        rn1(Poison_resistance ? 2 : 4, Poison_resistance ? 1 : 3);
        rnd(Poison_resistance ? 6 : 10);
        break;
    }
    case 6:
        if (game.u?.Antimagic) {
            await update_topl('The book explodes, but you are unharmed!');
        } else {
            await update_topl('As you read the book, it explodes in your face!');
            dmg = 2 * rnd(10) + 5;
            void dmg; // losehp() not ported for this arm
        }
        return true;
    default:
        // rndcurse(): unreachable for spellbooks (oc_level <= 7).
        break;
    }
    return false;
}

// C ref: spell.c confused_book(spellbook) — a confused reader tears the book up
// (1 in 3) or just rereads a line.  Was CALLED by learn_step() but never
// defined in this file, so becoming confused mid-study threw a ReferenceError.
async function confused_book(spellbook) {
    const { useup, trycall } = await import('./invent.js');
    if (!rn2(3) && spellbook.otyp !== SPE_BOOK_OF_THE_DEAD) {
        spellbook.in_use = true;             /* in case called from learn() */
        await pline('Being confused you have difficulties in controlling your actions.');
        await pline('You accidentally tear the spellbook to pieces.');
        trycall(spellbook);
        useup(spellbook);
        return true;
    }
    await pline(`You find yourself reading the ${spellbook === game.context?.spbook?.book ? 'next' : 'first'} line over and over again.`);
    return false;
}

// C ref: youprop.h Sleep_resistance (HSleep_resistance || ESleep_resistance).
function Sleep_resistance_hero() {
    const u = game.u;
    return ((u?.uprops?.HSleep_resistance ?? u?.uprops?.Sleep_resistance ?? 0) > 0);
}
// C ref: objnam.c objdescr_is(obj, descr) — compare the SHUFFLED appearance.
function objdescr_is_spell(obj, descr) {
    const idx = objects[obj?.otyp]?.oc_descr_idx;
    if (idx == null) return false;
    return DESCR_BY_OTYP[idx] === descr;
}

// C ref: spell.c study_book — read a spellbook to memorize its spell.  Ports the
// "already know it quite well" refresh branch and the uncursed/cursed "too hard
// to comprehend" branch (rnd(20) difficulty roll -> cursed_book -> crumble
// check).  The dull-sleep rnd(25) fires only for "dull"-appearance books and the
// success-path memorization occupation (learn) are not yet ported.  Returns 1
// if a game turn was used, 0 otherwise.
export async function study_book(spellbook) {
    if (process?.env?.NHDBG_SB) console.error('[study_book] otyp=%s delay_ctx=%s book=%s moves=%s', spellbook.otyp, game.context?.spbook?.delay, game.context?.spbook?.book?.otyp, game.moves);
    const { makeknown, useup, trycall } = await import('./invent.js');
    const { y_n } = await import('./display.js');
    const u = game.u;
    const booktype = spellbook.otyp;
    const confused = !!(u?.uconf || u?.HConfusion || (u?.uprops?.Confusion || 0) > 0);
    let too_hard = false;

    // C ref: spell.c study_book():474 — "attempting to read a dull book may make
    // the hero fall asleep".  This runs BEFORE everything else and always draws
    // rnd(25) for a book whose (shuffled) appearance is "dull", so omitting it
    // desynchronises the stream for every read of that appearance, asleep or not.
    if (!confused && !Sleep_resistance_hero() && objdescr_is_spell(spellbook, 'dull')) {
        const oc_level = spell_level_of(booktype);
        let dullbook = rnd(25) - ACURR(A_WIS);
        const sb0 = game.context?.spbook;
        if (sb0?.delay && spellbook === sb0.book)
            dullbook -= rnd(oc_level);
        if (dullbook > 0) {
            // eyecount(youmonst) is 2 for every playable form -> plural.
            await pline("This book is so dull that you can't keep your eyes open.");
            dullbook += rnd(2 * oc_level);
            // fall_asleep(-dullbook, TRUE): stop_occupation + nomul.
            game._study_occupation = false;
            nomul(-dullbook);
            game.multi_reason = 'sleeping';
            game.nomovemsg = 'You wake up.';
            return 1;
        }
    }

    // C ref: spell.c study_book():495 — resuming an interrupted study skips the
    // whole difficulty/too-hard block (and its rnd(20)); it just re-arms the
    // occupation with the delay already accumulated.
    const sb_prev = game.context?.spbook;
    if (sb_prev?.delay && !confused && spellbook === sb_prev.book
        && booktype !== SPE_BLANK_PAPER) {
        await pline(`You continue your efforts to ${booktype === SPE_NOVEL ? 'read the novel' : 'memorize the spell'}.`);
        sb_prev.book = spellbook;
        sb_prev.o_id = spellbook.o_id;
        game._study_occupation = true;
        game.occupation_txt = 'studying';
        return 1;
    }

    if (booktype === SPE_BLANK_PAPER) {
        await pline('This spellbook is all blank.');
        makeknown(booktype);
        return 1;
    }
    if (booktype === SPE_NOVEL) {
        // Novel reading not exercised.
        return 1;
    }

    const oc_level = spell_level_of(booktype);
    const oc_delay = oc_delay_of(booktype);
    // C ref: spell.c study_book — study delay by spell level (svc.context.spbook.delay).
    let delay;
    switch (oc_level) {
    case 1: case 2: delay = -oc_delay; break;
    case 3: case 4: delay = -(oc_level - 1) * oc_delay; break;
    case 5: case 6: delay = -oc_level * oc_delay; break;
    case 7:         delay = -8 * oc_delay; break;
    default:        return 0;
    }

    // Already know it well?  spellknow > KEEN/10 for a freshly-learned spell.
    let i = 0;
    for (; i < MAXSPELL; i++)
        if (spellid(i) === booktype || spellid(i) === NO_SPELL) break;
    if (spellid(i) === booktype && spellknow(i) > KEEN / 10) {
        await pline(`You know "${objects[booktype]?.name}" quite well already.`);
        makeknown(booktype);
        game._yn_need_more = true; // ack the message with --More-- before [yn]
        const ans = await y_n('Refresh your memory anyway?');
        if (ans === 'n')
            return 0;
    }

    // "Books are often wiser than their readers" — chance to fail (too hard).
    spellbook.in_use = true;
    if (!spellbook.blessed && booktype !== SPE_BOOK_OF_THE_DEAD) {
        if (spellbook.cursed) {
            too_hard = true;
        } else {
            // uncursed - chance to fail
            const lenses = (u?.ublindf && u.ublindf.otyp === LENSES) ? 2 : 0;
            const read_ability = ACURR(A_INT) + 4 + Math.floor((u?.ulevel || 0) / 2)
                                 - 2 * oc_level + lenses;
            // only wizards know if a spell is too difficult
            if ((game.urole?.mnum === PM_WIZARD) && read_ability < 20 && !confused) {
                const qbuf = `This spellbook is ${read_ability < 12 ? 'very ' : ''}`
                           + 'difficult to comprehend.  Continue?';
                if (await y_n(qbuf) !== 'y') {
                    spellbook.in_use = false;
                    return 1;
                }
            }
            // its up to random luck now
            if (rnd(20) > read_ability)
                too_hard = true;
        }
    }

    if (too_hard) {
        const gone = await cursed_book(spellbook);
        nomul(delay); // study time; hero is busy for |delay| turns
        game.multi_reason = 'reading a book';
        // C sets gn.nomovemsg = 0 and unmul() defaults it to "You can move again."
        game.nomovemsg = 'You can move again.';
        if (gone || !rn2(3)) {
            if (!gone)
                await pline('The spellbook crumbles to dust!');
            trycall(spellbook);
            useup(spellbook);
        } else {
            spellbook.in_use = false;
        }
        return 1;
    }
    // C ref: spell.c study_book():619 — a CONFUSED reader never memorizes: the
    // book either gets torn to pieces (rn2(3)) or the hero rereads one line, and
    // the study delay elapses either way.  This arm was missing entirely, so a
    // confused hero learned the spell for free.
    if (confused) {
        if (!(await confused_book(spellbook)))
            spellbook.in_use = false;
        nomul(delay);
        game.multi_reason = 'reading a book';
        game.nomovemsg = 'You can move again.';
        if (game.context?.spbook) game.context.spbook.delay = 0;
        return 1;
    }
    // C ref: spell.c study_book tail — the SUCCESS path.  Used to be a stub that
    // just consumed the turn, so a successful read drew the rnd(20) difficulty
    // roll and then nothing: no "begin to memorize" message, no multi-turn study
    // (so no monster turns elapsed), and no spell added.  On seed4500 step 474 C
    // drew 37 calls where we drew 1, and every later `Z` cast of the book's spell
    // diverged too because the spell was never in the repertoire.
    spellbook.in_use = false;
    // update_topl(), not pline(): the study's completion message arrives on the
    // SAME topline, and C emits a --More-- (its own captured frame) when the two
    // together overflow 80 columns.  pline() replaces the line instead of
    // appending, so that boundary was missing.
    await update_topl(`You begin to ${booktype === SPE_BOOK_OF_THE_DEAD ? 'recite' : 'memorize'} the runes.`);

    game.context = game.context || {};
    game.context.spbook = game.context.spbook || {};
    game.context.spbook.delay = delay;
    game.context.spbook.book = spellbook;
    game.context.spbook.o_id = spellbook.o_id;
    // C ref: cmd.c set_occupation(learn, "studying", 0) — an untimed occupation:
    // the move loop calls learn() each turn instead of reading a command, so the
    // whole study produces ONE captured screen at the next command boundary.
    game._study_occupation = true;
    game.occupation_txt = 'studying';
    return 1;
}

// C ref: spell.c learn() — the studying occupation.  Returns 1 while still busy,
// 0 when the study is over (the move loop then clears go.occupation).
export async function learn_step() {
    const { makeknown, useup, trycall, check_unpaid } = await import('./invent.js');
    const g = game;
    const sb = g.context?.spbook;
    const book = sb?.book;
    if (!book) return 0;
    const u = g.u;

    // "JDS: lenses give 50% faster reading; 33% smaller read time" — the rn2(2)
    // is drawn only while delay is still nonzero AND lenses are worn.
    if (sb.delay && u?.ublindf && u.ublindf.otyp === LENSES && rn2(2))
        sb.delay++;
    if (u?.uconf || u?.HConfusion) {          /* became confused while learning */
        await confused_book(book);
        sb.book = 0; sb.o_id = 0;
        nomul(sb.delay);                      /* remaining delay is uninterrupted */
        g.multi_reason = 'reading a book';
        g.nomovemsg = 'You can move again.';
        sb.delay = 0;
        return 0;
    }
    if (sb.delay) {
        // "not if (delay++), so at end delay == 0" — delay is negative and
        // counts UP toward zero, one turn per occupation call.
        sb.delay++;
        return 1;                             /* still busy */
    }
    exercise(A_WIS, true);                    /* you're studying */
    let booktype = book.otyp;
    if (booktype === SPE_BOOK_OF_THE_DEAD) {
        // deadbook() is the Book of the Dead ritual; not reachable here.
        sb.book = 0; sb.o_id = 0;
        return 0;
    }

    const known = !!objects[booktype]?.oc_name_known;
    const splname = known ? `"${objects[booktype]?.name}"`
                          : `the "${objects[booktype]?.name}" spell`;
    let i = 0;
    for (; i < MAXSPELL; i++)
        if (spellid(i) === booktype || spellid(i) === NO_SPELL) break;

    let faded_to_blank = false;
    const book_arr = spl_book();
    if (i === MAXSPELL) {
        /* C: impossible("Too many spells memorized!") */
    } else if (spellid(i) === booktype) {
        // A normal book can be read and re-read a total of MAX_SPELL_STUDY times.
        if ((book.spestudied | 0) > MAX_SPELL_STUDY) {
            await pline('This spellbook is too faint to be read any more.');
            book.otyp = booktype = SPE_BLANK_PAPER;
            faded_to_blank = true;
            book.spestudied = rn2(book.spestudied);
        } else {
            await update_topl(`Your knowledge of ${splname} is ${spellknow(i) ? 'keener' : 'restored'}.`);
            book_arr[i].sp_know = KEEN + 1;   /* incrnknow(i, 1) */
            book.spestudied = (book.spestudied | 0) + 1;
            exercise(A_WIS, true);            /* extra study */
        }
    } else {                                  /* spellid(i) === NO_SPELL */
        if ((book.spestudied | 0) >= MAX_SPELL_STUDY) {
            await pline('This spellbook is too faint to read even once.');
            book.otyp = booktype = SPE_BLANK_PAPER;
            faded_to_blank = true;
            book.spestudied = rn2(book.spestudied);
        } else {
            book_arr[i].sp_id = booktype;
            book_arr[i].sp_lev = spell_level_of(booktype);
            book_arr[i].sp_know = KEEN + 1;   /* incrnknow(i, 1) */
            book.spestudied = (book.spestudied | 0) + 1;
            if (!i)
                /* first is always 'a', so no need to mention the letter */
                await update_topl(`You learn ${splname}.`);
            else
                await update_topl(`You add ${splname} to your repertoire, as '${spellet(i)}'.`);
        }
    }
    if (i < MAXSPELL) makeknown(booktype);
    void faded_to_blank;                      /* update_inventory: no perm_invent */

    if (book.cursed) {                        /* maybe a demon cursed it */
        if (await cursed_book(book)) {
            useup(book);
            sb.book = 0; sb.o_id = 0;
            return 0;
        }
    }
    if (check_unpaid) check_unpaid(book);
    sb.book = 0; sb.o_id = 0;
    return 0;
}

// C ref: spell.c spellet(spell) — the inventory-style letter for spell slot i.
function spellet(i) {
    return i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(65 + i - 26);
}

export { spellid, spellev, spellknow };

// ═══════════════════════════════════════════════════════════════════════════
// The rest of spell.c.  INERT BY DESIGN: nothing above this line, and nothing
// anywhere else in js/, calls any of it.  Each function is a translation of
// its C counterpart so a wiring pass can land one call site at a time under
// measurement.  Three notes for that pass:
//
//  * js/invent.js dovspell() (js/invent.js:2465) is a LIVE, REDUCED copy of
//    dospellmenu()'s SPELLMENU_VIEW case: it renders the tty geometry inline
//    and ignores gs.spl_orderindx and the [sort spells] submenu entirely.
//    Wiring dospellmenu() must REPLACE that renderer, never add a second
//    caller (the duplicate-shadow trap).
//  * js/read.js forget() (js/read.js:625) already probes `spell.losespells`
//    and calls it the moment it exists, so the scroll-of-amnesia path becomes
//    live with this commit.  That is the one non-inert edge here, and it moves
//    TOWARD C: C's forget() calls losespells() before the rnd() that sizes
//    drain_weapon_skill().
//  * learn() is NOT re-translated: js/spell.js learn_step() above IS the
//    faithful learn() port (renamed because allmain.js drives it as the
//    studying occupation rather than through a go.occupation function pointer).
// ═══════════════════════════════════════════════════════════════════════════

// ── C ref: windows.c create_nhwindow(NHW_MENU) / start_menu / add_menu /
// add_menu_heading / add_menu_str / end_menu / select_menu / destroy_nhwindow.
// This port has no generic menu-window layer (invent.js and
// extcmd-handlers.js each keep a private tty renderer instead), so — as
// js/topten.js does with putstr() — the primitives below record into a plain
// object and select_menu() reports "nothing picked" until a wiring pass
// installs a driver.  Every add_menu() string handed to them is C's verbatim,
// so a driver only has to render `win.items` and answer with the picked
// `item` values.
const ATR_NONE = 0, ATR_INVERSE = 7; // C ref: include/color.h ATR_*
const NO_COLOR = 8;                  // C ref: include/color.h
const PICK_NONE = 0, PICK_ONE = 1;   // C ref: include/wintype.h
const MENU_ITEMFLAGS_NONE = 0x0, MENU_ITEMFLAGS_SELECTED = 0x1;
let sm_driver = null;
/* Install the select_menu() driver: (win, how) -> [{ item }, ...]. */
export function set_spellmenu_driver(fn) { sm_driver = fn || null; }
function create_nhwindow_menu() { return { items: [], prompt: '' }; }
function start_menu(win) { win.items.length = 0; }
function add_menu(win, a_int, ch, gch, attr, clr, str, itemflags) {
    win.items.push({ a_int, ch, gch, attr, clr, str, itemflags });
}
function add_menu_heading(win, str) {
    win.items.push({ a_int: 0, ch: 0, attr: ATR_INVERSE, clr: NO_COLOR,
                     str, itemflags: MENU_ITEMFLAGS_NONE, heading: true });
}
function add_menu_str(win, str) {
    win.items.push({ a_int: 0, ch: 0, attr: ATR_NONE, clr: NO_COLOR,
                     str, itemflags: MENU_ITEMFLAGS_NONE, plain: true });
}
function end_menu(win, prompt) { win.prompt = prompt ?? ''; }
async function select_menu(win, how) {
    return sm_driver ? (await sm_driver(win, how)) || [] : [];
}
function destroy_nhwindow(_win) {}

// ── C ref: display.c tmp_at() / display.h cmap_to_glyph() / zapdir_to_glyph()
// and windows.c nh_delay_output().  The temporary-glyph animation layer has no
// port (frozen/terminal.js owns the grid); all four are RNG-free.  Prefixed
// sp_ so they cannot claim display.c coverage they do not deliver — the same
// convention js/apply.js:1636 uses for its jump-hilite loop.
const DISP_BEAM = -1, DISP_CHANGE = -6, DISP_END = -7; // include/display.h
const S_goodpos = 0;                                   // include/defsym.h cmap
function sp_tmp_at(_x, _y) {}
function sp_cmap_to_glyph(_cmap) { return 0; }
function sp_zapdir_to_glyph(_dx, _dy, _beam_type) { return 0; }
function sp_nh_delay_output() {}

// ── small C macros/library calls with no shared port in js/.
// C ref: hacklib.c sgn(x).
function sp_sgn(x) { return (x < 0) ? -1 : (x > 0) ? 1 : 0; }
// C ref: hack.h mdistu(mon) == distu(mon->mx, mon->my) == dist2 to the hero.
function sp_mdistu(mon) {
    return dist2(mon.mx, mon.my, game.u?.ux ?? 0, game.u?.uy ?? 0);
}
// C ref: mondata.h is_undead(ptr) / monst.h is_vampshifter(mon).  The three
// vampire pmidx are the same ones js/mon.js:1489 and js/monmove.js carry.
const PM_VAMPIRE = 226, PM_VAMPIRE_LEADER = 227, PM_VLAD_THE_IMPALER = 228;
function sp_is_undead(ptr) { return (mflags2_of(ptr) & M2_UNDEAD) !== 0; }
function sp_is_vampshifter(mon) {
    return mon.cham === PM_VAMPIRE || mon.cham === PM_VAMPIRE_LEADER
        || mon.cham === PM_VLAD_THE_IMPALER;
}
// C ref: mondata.h is_whirly(ptr) / enfolds(ptr).  is_whirly is a class test
// (S_VORTEX) plus the air elemental; enfolds is dmgtype_fromattack(AD_WRAP,
// AT_ENGL), i.e. the trapper/lurker-above family.
const S_VORTEX = 22;                    // C ref: include/defsym.h monsyms ('v')
function sp_is_whirly(ptr) {
    return ptr?.mcls === S_VORTEX
        || ptr?.pmidx === sp_pm('air elemental');
}
function sp_enfolds(ptr) {
    return ptr?.pmidx === sp_pm('trapper') || ptr?.pmidx === sp_pm('lurker above');
}
// C ref: objnam.c an(str).
function sp_an(s) { return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`; }
// C ref: hacklib.c strcmpi(s1, s2) — case-insensitive strcmp; returns the
// difference of the first differing (lowercased) characters.
function sp_strcmpi(s1, s2) {
    const a = String(s1).toLowerCase(), b = String(s2).toLowerCase();
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        const dc = a.charCodeAt(i) - b.charCodeAt(i);
        if (dc) return dc;
    }
    return a.length - b.length;
}
// C ref: Sprintf's %-Ns / %Ns field padding, used by dospellmenu's fmt strings.
function sp_padr(s, n) {
    s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function sp_padl(s, n) {
    s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}
// Lazy memoized PM_* lookup — it must stay lazy for the same reason
// js/mon.js:1706 keeps one: a top-level name_to_pmidx() would run during this
// module's own evaluation, when makemon.js's MONS table is only guaranteed
// built in the absence of an import cycle.
let _sp_pmcache = null;
function sp_pm(name) {
    if (!_sp_pmcache) _sp_pmcache = new Map();
    if (!_sp_pmcache.has(name)) _sp_pmcache.set(name, name_to_pmidx(name));
    return _sp_pmcache.get(name);
}
// C ref: dungeon.c invocation_pos(x, y) / stairs.c On_stairs(x, y).  js/apply.js
// and js/artifact.js each keep the same two-line pair; kept local for the same
// reason (neither is exported anywhere).
function sp_invocation_pos(x, y) {
    const inv = game.level?.invocation_pos;
    return !!inv && inv.x === x && inv.y === y;
}
function sp_On_stairs(x, y) {
    const st = game.level?.stairs || [];
    return st.some((s) => s && s.sx === x && s.sy === y);
}
// C ref: youprop.h Confusion.
function sp_Confusion() {
    const u = game.u;
    return !!(u?.uconf || u?.HConfusion || (u?.uprops?.Confusion || 0) > 0);
}

// ───────────────────────────────────────────────────────────────────────────
// C ref: spell.c:114 spell_let_to_idx(ilet) — convert a letter into a number
// in the range 0..51, or -1 if not a letter.
export function spell_let_to_idx(ilet) {
    const c = (typeof ilet === 'number') ? ilet : String(ilet).charCodeAt(0);
    let indx = c - 97;                                  /* 'a' */
    if (indx >= 0 && indx < 26)
        return indx;
    indx = c - 65;                                      /* 'A' */
    if (indx >= 0 && indx < 26)
        return indx + 26;
    return -1;
}

// C ref: spell.c:210 deadbook_pacify_undead(mtmp) — pacify or tame an undead
// monster (iter_mons callback for a blessed Book of the Dead).  Note C's
// dangling `else`: the inner if/mtame-else/tamedog pair is complete, so the
// trailing `else monflee(...)` binds to the OUTER alignment+distance test.
export async function deadbook_pacify_undead(mtmp) {
    if ((sp_is_undead(mtmp.data) || sp_is_vampshifter(mtmp))
        && cansee(mtmp.mx, mtmp.my)) {
        mtmp.mpeaceful = 1;
        if (sp_sgn(mtmp.data?.maligntyp ?? 0) === sp_sgn(game.u?.ualign?.type ?? 0)
            && sp_mdistu(mtmp) < 4) {
            if (mtmp.mtame) {
                if (mtmp.mtame < 20)
                    mtmp.mtame++;
            } else {
                const { tamedog } = await import('./dothrow.js');
                await tamedog(mtmp, null, true);
            }
        } else {
            const { monflee } = await import('./monmove.js');
            await monflee(mtmp, 0, false, true);
        }
    }
}

// C ref: spell.c:230 deadbook(book2) — special effects for the Book of the
// Dead; reading it while blind is allowed so that is taken into account too.
// RNG: the invocation-success arm draws d(2,6); the raise-dead arm draws rn2(3)
// then (only when that is 0) up to two makemon() calls, then mkundead(); the
// plain-uncursed arm draws one rn2(3) for its flavour message.
export async function deadbook(book2) {
    const u = game.u;
    const { makeknown } = await import('./invent.js');
    const { body_part } = await import('./polyself.js');

    // C ref: spell.c:307 `raise_dead:` — the label is reached both by falling
    // through (a cursed book outside the invocation position) and by the
    // `goto raise_dead` from the not-all-relics-primed arm.
    const raise_dead = async () => {
        let mtmp = null;
        await pline('You raised the dead!');
        /* first maybe place a dangerous adversary */
        if (!rn2(3)
            && ((mtmp = makemon(monster_by_pmidx(sp_pm('master lich')),
                                u.ux, u.uy, NO_MINVENT)) != null
                || (mtmp = makemon(monster_by_pmidx(sp_pm('nalfeshnee')),
                                   u.ux, u.uy, NO_MINVENT)) != null)) {
            mtmp.mpeaceful = 0;
            set_malign(mtmp);
        }
        /* next handle the affect on things you're carrying */
        // DEFERRED: mon.c unturn_dead(&youmonst) has no port; it is RNG-free
        // for a hero carrying no corpses/figurines and otherwise draws
        // revive()'s makemon.
        /* last place some monsters around you */
        const mm = { x: u.ux, y: u.uy };
        // DEFERRED: makemon.c mkundead(&mm, TRUE, NO_MINVENT) has no port
        // (js/apply.js:1692 keeps the same stub); it draws rn2/makemon.
        void mm;
    };

    await pline('You turn the pages of the Book of the Dead...');
    makeknown(SPE_BOOK_OF_THE_DEAD);
    observe_object(book2); /* in case blind now and hasn't been seen yet */
    /* KMH -- Need ->known to avoid "_a_ Book of the Dead" */
    book2.known = 1;
    if (sp_invocation_pos(u.ux, u.uy) && !sp_On_stairs(u.ux, u.uy)) {
        let arti1_primed = false, arti2_primed = false, arti_cursed = false;

        if (book2.cursed) {
            await pline(`The ${Blind()
                ? 'Book seems to be ignoring you'
                : "runes appear scrambled.  You can't read them"}!`);
            return;
        }

        if (!u.uhave?.bell || !u.uhave?.menorah) {
            await pline(`A chill runs down your ${body_part(SPINE)}.`);
            if (!u.uhave?.bell) {
                // C: Soundeffect(se_faint_chime, 30); You_hear("a faint
                // chime...") — You_hear is suppressed while Deaf.
                await pline('You hear a faint chime...');
            }
            if (!u.uhave?.menorah)
                await pline("Vlad's doppelganger is amused.");
            return;
        }

        const { inventoryArray } = await import('./invent.js');
        for (const otmp of inventoryArray()) {
            if (otmp.otyp === CANDELABRUM_OF_INVOCATION && otmp.spe === 7
                && otmp.lamplit) {
                if (!otmp.cursed)
                    arti1_primed = true;
                else
                    arti_cursed = true;
            }
            if (otmp.otyp === BELL_OF_OPENING
                && ((game.moves | 0) - (otmp.age | 0)) < 5) { /* rang it recently */
                if (!otmp.cursed)
                    arti2_primed = true;
                else
                    arti_cursed = true;
            }
        }

        if (arti_cursed) {
            await pline('The invocation fails!');
            /* this used to say "your artifacts" but the invocation tools
               are not artifacts */
            await pline('At least one of your relics is cursed...');
        } else if (arti1_primed && arti2_primed) {
            const soon = d(2, 6); /* time til next intervene() */

            /* successful invocation */
            // DEFERRED: mkmaze.c mkinvokearea() has no port; it is RNG-free
            // (it rewrites the sanctum terrain and prints the four messages).
            u.uevent = u.uevent || {};
            u.uevent.invoked = 1;
            const { record_achievement } = await import('./insight.js');
            record_achievement(ACH_INVK);
            /* in case you haven't killed the Wizard yet, behave as if
               you just did */
            u.uevent.udemigod = 1; /* wizdeadorgone() */
            if (!u.udg_cnt || u.udg_cnt > soon)
                u.udg_cnt = soon;
        } else { /* at least one relic not prepared properly */
            await pline('You have a feeling that something is amiss...');
            await raise_dead();
            return;
        }
        return;
    }

    /* when not an invocation situation */
    if (book2.cursed) {
        await raise_dead();
    } else if (book2.blessed) {
        const { iter_mons } = await import('./mon.js');
        await iter_mons(deadbook_pacify_undead);
    } else {
        switch (rn2(3)) {
        case 0:
            await pline('Your ancestors are annoyed with you!');
            break;
        case 1:
            await pline('The headstones in the cemetery begin to move!');
            break;
        default:
            await pline('Oh my!  Your name appears in the book!');
            break;
        }
    }
}
// C ref: include/objects.h otyps read by deadbook().
const CANDELABRUM_OF_INVOCATION = 262, BELL_OF_OPENING = 263;

// C ref: spell.c:342 book_cursed(book) — 'book' has just become cursed; if
// we're reading it, interrupt.  C tests `go.occupation == learn`; this port
// drives the studying occupation off game._study_occupation (study_book() sets
// it and allmain.js:1742 calls learn_step() while it is set), so that flag is
// the same predicate.  js/mkobj.js:1098 already notes the missing call site.
export async function book_cursed(book) {
    if (book.cursed && (game.multi ?? 0) >= 0
        && game._study_occupation && game.context?.spbook?.book === book) {
        const _invent = await import('./invent.js');
        const nm = _invent.xname(book);
        /* C: pline("%s shut!", Tobjnam(book, "slam")) */
        await pline(`${/^[A-Z]/.test(nm) ? '' : 'The '}${nm} `
                    + `${_invent.otense(book, 'slam')} shut!`);
        set_bknown(book, 1);
        const { stop_occupation } = await import('./hack.js');
        await stop_occupation();
    }
}

// C ref: spell.c:645 book_disappears(obj) — a spellbook has been destroyed or
// the character has changed levels; the stored address for the current book is
// no longer valid.
export function book_disappears(obj) {
    const sb = game.context?.spbook;
    if (sb && obj === sb.book) {
        sb.book = 0;
        sb.o_id = 0;
    }
}

// C ref: spell.c:657 book_substitution(old_obj, new_obj) — renaming an object
// usually results in it having a different address, so start reading / get
// interrupted / name the book / resume would read the "new" book from scratch.
export function book_substitution(old_obj, new_obj) {
    const sb = game.context?.spbook;
    if (sb && old_obj === sb.book) {
        sb.book = new_obj;
        if (sb.book)
            sb.o_id = sb.book.o_id;
    }
}

// C ref: spell.c:786 dowizcast() — #wizcast, cast any spell even without
// knowing it.  The menu lists MAXSPELL entries starting at SPE_DIG, stopping
// at SPE_BLANK_PAPER; the pick is passed to spelleffects(otyp, FALSE, TRUE),
// whose force=TRUE arm skips spelleffects_check() entirely.
export async function dowizcast() {
    let i, n;

    const win = create_nhwindow_menu();
    start_menu(win);

    for (i = 0; i < MAXSPELL; i++) {
        n = (SPE_DIG + i);
        if (n >= SPE_BLANK_PAPER)
            break;
        add_menu(win, n, 0, 0, ATR_NONE, NO_COLOR,
                 objects[n]?.name || '', MENU_ITEMFLAGS_NONE);
    }
    end_menu(win, 'Cast which spell?');
    const selected = await select_menu(win, PICK_ONE);
    destroy_nhwindow(win);
    if (selected.length > 0) {
        i = selected[0].item;
        return await spelleffects(i, false, true);
    }
    return ECMD_OK;
}

// C ref: spell.c:1103 cast_protection() — SPE_PROTECTION.  RNG: the hcolor()
// call draws one rn2_on_display_rng(HCOLORS) while hallucinating (and only
// then), inside the !Blind arm and BEFORE either message.
export async function cast_protection() {
    const u = game.u;
    let l = u.ulevel | 0, loglev = 0;
    let natac = (u.uac | 0) + (u.uspellprot | 0);
    /* note: u.uspellprot is subtracted when find_ac() factors it into u.uac,
       so adding here factors it back out */

    /* loglev=log2(u.ulevel)+1 (1..5) */
    while (l) {
        loglev++;
        l = Math.trunc(l / 2);
    }

    natac = Math.trunc((10 - natac) / 10); /* convert to positive, scale down */
    const gain = loglev - Math.trunc((u.uspellprot | 0) / (4 - Math.min(3, natac)));

    if (gain > 0) {
        if (!Blind()) {
            const hgolden = hcolor(NH_GOLDEN);

            if (u.uspellprot) {
                await pline(`The ${hgolden} haze around you becomes more dense.`);
            } else {
                const pm = u.ustuck ? u.ustuck.data : null;
                const rmtyp = game.level?.at(u.ux, u.uy)?.typ;
                const atmosphere = (pm && u.uswallow)
                    ? ((pm.pmidx === sp_pm('fog cloud')) ? 'mist'
                       : sp_is_whirly(pm) ? 'maelstrom'
                         : sp_enfolds(pm) ? 'folds'
                           : is_animal(pm) ? 'maw'
                             : 'ooze')
                    : (u.uinwater ? hliquid('water')
                       : (rmtyp === CLOUD) ? 'cloud'
                         : IS_TREE(rmtyp) ? 'vegetation'
                           : IS_STWALL(rmtyp) ? 'stone'
                             : 'air');
                await pline(`The ${atmosphere} around you begins to shimmer `
                            + `with ${sp_an(hgolden)} haze.`);
            }
        }
        u.uspellprot = (u.uspellprot | 0) + gain;
        u.uspmtime = (p_skill_of(spell_skilltype(SPE_PROTECTION)) === P_EXPERT)
                       ? 20 : 10;
        if (!u.usptime)
            u.usptime = u.uspmtime;
        find_ac();
    } else {
        await pline('Your skin feels warm for a moment.');
    }
}
// C ref: decl.h NH_GOLDEN == c_color_names.c_golden.
const NH_GOLDEN = 'golden';

// ── chain lightning.  C ref: spell.c:909-1100.
// Limit the total area chain lightning can cover.
const CHAIN_LIGHTNING_LIMIT = 100;
// Unlike most zaps, chain lightning can't hit solid terrain, it only covers
// open space.  C ref: spell.c:919 CHAIN_LIGHTNING_TYP / :922 _POS.
function CHAIN_LIGHTNING_TYP(typ) {
    return SPACE_POS(typ) || typ === POOL || typ === MOAT /* not WATER */
        || typ === DRAWBRIDGE_UP || typ === LAVAPOOL;     /* not LAVAWALL */
}
function CHAIN_LIGHTNING_POS(x, y) {
    if (!isok(x, y)) return false;
    const lev = game.level?.at(x, y);
    if (!lev) return false;
    return CHAIN_LIGHTNING_TYP(lev.typ)
        || (IS_DOOR(lev.typ) && !(lev.doormask & (D_CLOSED | D_LOCKED)));
}

// C ref: spell.c:951 propagate_chain_lightning(clq, zap) — move a potential
// zap one square forward, then queue it unless it would hit an invalid square
// or is out of power.  `zap` is passed BY VALUE in C, so the move-forward must
// not be visible to the caller: copy it here.
export function propagate_chain_lightning(clq, zap_in) {
    const zap = { dir: zap_in.dir, x: zap_in.x, y: zap_in.y,
                  strength: zap_in.strength };

    zap.x += xdir[zap.dir];
    zap.y += ydir[zap.dir];

    if (clq.tail >= CHAIN_LIGHTNING_LIMIT)
        return;    /* zap has covered too many squares */
    if (!CHAIN_LIGHTNING_POS(zap.x, zap.y))
        return;    /* zap can't go to this square */

    const mon = m_at(zap.x, zap.y);
    if (mon && mon.mpeaceful)
        return;    /* chain lightning avoids peaceful and tame monsters */

    // When hitting a monster that isn't electricity-resistant, a particular
    // zap regains all its power; upon hitting a shock-resistant monster it
    // can't continue, but we let it hit the monster to show the shield effect.
    if (mon && !resists_elec(mon) && !sp_defended_elec(mon))
        zap.strength = 3;
    else if (mon)
        zap.strength = 0;

    /* Unless it hits a monster, the last square of a zap isn't drawn on
       screen and can't propagate further, so discard it now */
    if (!mon && !zap.strength)
        return;

    /* The same square can't be chained to twice. */
    for (let i = 0; i < clq.tail; i++) {
        if (clq.q[i].x === zap.x && clq.q[i].y === zap.y)
            return;
    }

    clq.q[clq.tail++] = zap;

    /* Draw it. */
    sp_tmp_at(DISP_CHANGE, sp_zapdir_to_glyph(xdir[zap.dir], ydir[zap.dir],
                                              clq.displayed_beam));
    sp_tmp_at(zap.x, zap.y);
}

// C ref: spell.c:1002 cast_chain_lightning() — SPE_CHAIN_LIGHTNING.  The whole
// RNG cost is zhitm()'s (per monster struck) plus, while hallucinating, one
// rn2_on_display_rng(6) for the beam colour; the propagation itself is
// deterministic.
export async function cast_chain_lightning() {
    const u = game.u;
    const { Hallucination_u } = await import('./display.js');
    const { rn2_on_display_rng } = await import('./disprng.js');
    const clq = {
        q: new Array(CHAIN_LIGHTNING_LIMIT), head: 0, tail: 0,
        displayed_beam: Hallucination_u() ? rn2_on_display_rng(6)
                                          : (AD_ELEC - 1),
    };

    if (u.uswallow) {
        // C: "TODO: damage the engulfer"
        return;
    }

    /* set the type of beam we're using; the direction here is arbitrary */
    sp_tmp_at(DISP_BEAM, sp_zapdir_to_glyph(0, 1, clq.displayed_beam));

    /* start by propagating in all directions from the caster */
    for (let dir = 0; dir < N_DIRS; dir++) {
        propagate_chain_lightning(clq, { dir, x: u.ux, y: u.uy, strength: 2 });
    }
    sp_nh_delay_output();

    while (clq.head < clq.tail) {
        const delay_tail = clq.tail;

        while (clq.head < delay_tail) {
            const zap = clq.q[clq.head++];
            /* damage any monster that was hit */
            const mon = m_at(zap.x, zap.y);

            if (mon) {
                game.notonhead = (mon.mx !== (game.bhitpos?.x ?? mon.mx)
                                  || mon.my !== (game.bhitpos?.y ?? mon.my));
                const dmg = await sp_zhitm(mon, BZ_U_SPELL(AD_ELEC - 1), 2);

                if (dmg) {
                    // mon has been damaged, but the messages and kill credit
                    // aren't given yet; assume the hero can sense their spell
                    // hitting monsters, because they can steer it away from
                    // peacefuls.
                    if (DEADMONSTER(mon)) {
                        const { killed } = await import('./uhitm.js');
                        await killed(mon, { givemsg: true }); /* XKILL_GIVEMSG */
                    } else {
                        await pline(`You shock ${await sp_mon_nam(mon)}`
                                    + `${sp_exclam(dmg)}`);
                        /* if a long worm, only map 'I' for its head */
                        if (!canseemon_shared(mon) && !game.notonhead)
                            map_invisible(zap.x, zap.y);
                    }
                } else if (canseemon_shared(mon)) {
                    await pline(`${await sp_Monnam(mon)} resists.`);
                }
                if (!DEADMONSTER(mon)) {
                    // wakeup is via attack, but since mon is already hostile we
                    // pass via_attack==False rather than True, otherwise other
                    // monsters witnessing this would treat it as seeing hero
                    // attack a peaceful.
                    game.context = game.context || {};
                    game.context.forcefight = (game.context.forcefight | 0) + 1;
                    await sp_wakeup(mon, false);
                    game.context.forcefight = (game.context.forcefight | 0) - 1;
                }
            }

            // Each zap propagates forwards with 1 less strength, and diagonally
            // with 0 strength; exception: if the zap just hit a monster, the
            // diagonals have as much strength as the forwards zap.
            if (!zap.strength)
                continue; /* upon hitting a shock-resistant monster */
            zap.strength--;

            propagate_chain_lightning(clq, zap);

            if (zap.strength < 2)
                zap.strength = 0;
            else if (u.uen > 0)
                u.uen--; /* propagating past mons increases Pw cost a bit */
            zap.dir = DIR_LEFT(zap.dir);
            propagate_chain_lightning(clq, zap);

            zap.dir = DIR_RIGHT2(zap.dir);
            propagate_chain_lightning(clq, zap);
        }
        sp_nh_delay_output();
    }
    sp_nh_delay_output();
    sp_nh_delay_output();

    sp_tmp_at(DISP_END, 0);
}
// C ref: hack.h:658 DIR_LEFT / :661 DIR_RIGHT2.
function DIR_LEFT(dir) { return (dir + 7) % N_DIRS; }
function DIR_RIGHT2(dir) { return (dir + 2) % N_DIRS; }
// C ref: monattk.h AD_ELEC and zap.h BZ_U_SPELL(zt) == 10 + (zt).
const AD_ELEC = 6;
function BZ_U_SPELL(zt) { return 10 + zt; }
// C ref: zap.c zhitm(mon, type, nd, &ootmp) / zap.c wakeup(mon, via_attack) /
// mondata.c defended(mon, adtyp) / zap.c exclam(force) / do_name.c mon_nam().
// zhitm and wakeup are module-PRIVATE in js/zap.js (js/zap.js:2006 and :1807)
// and defended is module-private in js/artifact.js:617 — the fix is to EXPORT
// the originals, not to duplicate them here, so these probe for the export and
// otherwise report "no damage"/no-op.
async function sp_zhitm(mon, type, nd) {
    const Z = await import('./zap.js');
    if (typeof Z.zhitm === 'function') {
        const r = await Z.zhitm(mon, type, nd);
        return (r && typeof r === 'object') ? (r.tmp | 0) : (r | 0);
    }
    return 0;
}
async function sp_wakeup(mon, via_attack) {
    const Z = await import('./zap.js');
    if (typeof Z.wakeup === 'function') await Z.wakeup(mon, via_attack);
}
function sp_defended_elec(_mon) {
    // js/artifact.js:617, js/mhitm_ad.js:142 and js/zap.js each keep a private
    // defended(); propagate_chain_lightning() is sync in C so it cannot await a
    // dynamic import.  FALSE is right for every monster without a shock-
    // resisting artifact or dragon-scale armor; the fix is to EXPORT one of the
    // three originals and call it here, not to write a fourth copy.
    return false;
}
function sp_exclam(force) { return force < 0 ? '?' : (force <= 4 ? '.' : '!'); }
async function sp_mon_nam(mon) {
    const { mon_nam } = await import('./do_name.js');
    return mon_nam(mon);
}
async function sp_Monnam(mon) {
    const { Monnam } = await import('./do_name.js');
    return Monnam(mon);
}

// C ref: spell.c:1606 spell_aim_step(arg, x, y) — walk_path() callback used by
// throwspell() to stop the aim at the first square a spell can't cross.
export function spell_aim_step(_arg, x, y) {
    if (!isok(x, y))
        return false;
    const lev = game.level?.at(x, y);
    if (!lev) return false;
    if (!ZAP_POS(lev.typ)
        && !(IS_DOOR(lev.typ) && (lev.doormask & D_ISOPEN)))
        return false;
    return true;
}

// C ref: spell.c:1618 can_center_spell_location(x, y) — "not quite the same as
// throwspell limits, but close enough"; the getpos() validator.
export function can_center_spell_location(x, y) {
    if (distmin(game.u?.ux ?? 0, game.u?.uy ?? 0, x, y) > 10)
        return false;
    return isok(x, y) && cansee(x, y)
        && !IS_STWALL(game.level?.at(x, y)?.typ);
}

// C ref: spell.c:1626 display_spell_target_positions(on_off) — hilite every
// square a spell can be centred on.  Display-only (see sp_tmp_at); RNG-free.
export function display_spell_target_positions(on_off) {
    let x, y, dx, dy;
    const dist = 10;

    if (on_off) {
        /* on */
        sp_tmp_at(DISP_BEAM, sp_cmap_to_glyph(S_goodpos));
        for (dx = -dist; dx <= dist; dx++)
            for (dy = -dist; dy <= dist; dy++) {
                x = (game.u?.ux ?? 0) + dx;
                y = (game.u?.uy ?? 0) + dy;
                // hero's location is allowed but highlighting the hero's spot
                // makes the map harder to read
                if (u_at(x, y))
                    continue;
                if (can_center_spell_location(x, y))
                    sp_tmp_at(x, y);
            }
    } else {
        /* off */
        sp_tmp_at(DISP_END, 0);
    }
}

// C ref: spell.c:1654 throwspell() — choose the location where a Skilled+
// fireball/cone of cold takes effect.  Returns 1 with u.dx/u.dy holding the
// TARGET COORDINATES (not a direction), 0 on any refusal.  RNG-free.
export async function throwspell() {
    const u = game.u;
    let mtmp;

    if (u.uinwater) {
        await pline("You're joking!  In this weather?");
        return 0;
    } else if (Is_waterlevel(u.uz)) {
        await pline('You had better wait for the sun to come out.');
        return 0;
    }

    await pline('Where do you want to cast the spell?');
    const cc = { x: u.ux, y: u.uy };
    // C: getpos_sethilite(display_spell_target_positions,
    //                     can_center_spell_location) — js/hack.js's getpos()
    // takes the validator as an argument instead of through the two globals,
    // and paints no beam overlay (see sp_tmp_at).
    const { getpos } = await import('./hack.js');
    const pos = await getpos('the desired position', cc.x, cc.y,
                             (x, y) => can_center_spell_location(x, y),
                             /*force=*/true);
    if (!pos)
        return 0; /* user pressed ESC */
    cc.x = pos.x;
    cc.y = pos.y;
    game._pending_message = ''; /* clear_nhwindow(WIN_MESSAGE) */

    /* The number of moves from hero to where the spell drops. */
    if (distmin(u.ux, u.uy, cc.x, cc.y) > 10) {
        await pline('The spell dissipates over the distance!');
        return 0;
    } else if (u.uswallow) {
        await pline('The spell is cut short!');
        exercise(A_WIS, false); /* What were you THINKING! */
        u.dx = 0;
        u.dy = 0;
        return 1;
    } else if (((cc.x !== u.ux || cc.y !== u.uy) && !cansee(cc.x, cc.y)
                && (!(mtmp = m_at(cc.x, cc.y)) || !canseemon_shared(mtmp)))
               || IS_STWALL(game.level?.at(cc.x, cc.y)?.typ)) {
        await pline('Your mind fails to lock onto that location!');
        return 0;
    }

    // DEFERRED: hack.c walk_path(&uc, &cc, spell_aim_step, 0) has no port; it
    // is RNG-free (it only truncates the aim at the first blocked square).
    u.dx = cc.x;
    u.dy = cc.y;
    return 1;
}

// C ref: teleport.c / spell.c:1715 — the dotelecmd() menu-repair opcodes.
export const NOOP_SPELL = 0, HIDE_SPELL = 1, ADD_SPELL = 2,
             UNHIDESPELL = 3, REMOVESPELL = 4;
// C ref: spell.c:1709 `static struct tport_hideaway save_tport`.
const save_tport = { savespell: { sp_id: NO_SPELL, sp_lev: 0, sp_know: 0 },
                     tport_indx: 0 };

// C ref: spell.c:1706 tport_spell(what) — add/hide/remove/unhide teleport-away
// on behalf of dotelecmd() so wizard-mode ^T can honour a menu choice.
// Returns the opcode needed to REVERSE the operation.  RNG-free.
export function tport_spell(what) {
    const book = spl_book();
    let i;

    for (i = 0; i < MAXSPELL; i++)
        if (spellid(i) === SPE_TELEPORT_AWAY || spellid(i) === NO_SPELL)
            break;
    if (i === MAXSPELL) {
        /* C: impossible("tport_spell: spellbook full") */
    } else if (spellid(i) === NO_SPELL) {
        if (what === HIDE_SPELL || what === REMOVESPELL) {
            save_tport.tport_indx = MAXSPELL;
        } else if (what === UNHIDESPELL) {
            const s = save_tport.savespell;
            book[save_tport.tport_indx].sp_id = s.sp_id;
            book[save_tport.tport_indx].sp_lev = s.sp_lev;
            book[save_tport.tport_indx].sp_know = s.sp_know;
            save_tport.tport_indx = MAXSPELL; /* burn bridge... */
        } else if (what === ADD_SPELL) {
            save_tport.savespell = { sp_id: book[i].sp_id,
                                     sp_lev: book[i].sp_lev,
                                     sp_know: book[i].sp_know };
            save_tport.tport_indx = i;
            book[i].sp_id = SPE_TELEPORT_AWAY;
            book[i].sp_lev = spell_level_of(SPE_TELEPORT_AWAY);
            book[i].sp_know = KEEN;
            return REMOVESPELL; /* operation needed to reverse */
        }
    } else { /* spellid(i) == SPE_TELEPORT_AWAY */
        if (what === ADD_SPELL || what === UNHIDESPELL) {
            save_tport.tport_indx = MAXSPELL;
        } else if (what === REMOVESPELL) {
            const s = save_tport.savespell;
            book[i].sp_id = s.sp_id;
            book[i].sp_lev = s.sp_lev;
            book[i].sp_know = s.sp_know;
            save_tport.tport_indx = MAXSPELL;
        } else if (what === HIDE_SPELL) {
            save_tport.savespell = { sp_id: book[i].sp_id,
                                     sp_lev: book[i].sp_lev,
                                     sp_know: book[i].sp_know };
            save_tport.tport_indx = i;
            book[i].sp_id = NO_SPELL;
            return UNHIDESPELL; /* operation needed to reverse */
        }
    }
    return NOOP_SPELL;
}

// C ref: spell.c:1762 losespells() — forget a random selection of known spells
// due to amnesia; retention is zeroed rather than the entry removed.
// RNG, in order: rn2(n+1); a second rn2(n+1) while Confused; rnl(7) then
// rnd(nzap) when nzap > 1; then one rn2(n-i) per candidate examined.  Note that
// with no spells known (n == 0) C STILL draws rn2(1), which consumes a value.
export function losespells() {
    let n, nzap, i;

    /* in case reading has been interrupted earlier, discard context */
    const sb = game.context?.spbook;
    if (sb) {
        sb.book = 0;
        sb.o_id = 0;
    }
    /* count the number of known spells */
    for (n = 0; n < MAXSPELL; ++n)
        if (spellid(n) === NO_SPELL)
            break;

    /* lose anywhere from zero to all known spells;
       if confused, use the worse of two die rolls */
    nzap = rn2(n + 1);
    if (sp_Confusion()) {
        i = rn2(n + 1);
        if (i > nzap)
            nzap = i;
    }
    /* good Luck might ameliorate spell loss */
    if (nzap > 1 && !rnl(7))
        nzap = rnd(nzap);

    const book = spl_book();
    for (i = 0; nzap > 0; ++i) {
        // when nzap is small relative to the number of spells left, the chance
        // to lose spell [i] is small; overall, exactly nzap entries are hit
        if (rn2(n - i) < nzap) {
            book[i].sp_know = 0;        /* lose access to spell [i] */
            exercise(A_WIS, false);     /* and abuse wisdom */
            --nzap;                     /* one less spell slated to be lost */
        }
    }
}

// ── the "view known spells" sort machinery.  C ref: spell.c:1841-2017.
// C ref: spell.c:1841 enum spl_sort_types.
export const SORTBY_LETTER = 0, SORTBY_ALPHA = 1, SORTBY_LVL_LO = 2,
             SORTBY_LVL_HI = 3, SORTBY_SKL_AL = 4, SORTBY_SKL_LO = 5,
             SORTBY_SKL_HI = 6, SORTBY_CURRENT = 7, SORTRETAINORDER = 8,
             NUM_SPELL_SORTBY = 9;
// C ref: spell.c:1855 spl_sortchoices[] — verbatim; these are menu lines.
const spl_sortchoices = [
    'by casting letter',
    'alphabetically',
    'by level, low to high',
    'by level, high to low',
    'by skill group, alphabetized within each group',
    'by skill group, low to high level within group',
    'by skill group, high to low level within group',
    'maintain current ordering',
    /* a menu choice rather than a sort choice */
    'reassign casting letters to retain current order',
];
// C's gs.spl_sortmode / gs.spl_orderindx live on `game` here.
function spl_sortmode() { return game.spl_sortmode | 0; }

// C ref: spell.c:1869 spell_cmp(vptr1, vptr2) — the qsort callback.  C is
// handed pointers into gs.spl_orderindx[]; this port is handed the element
// VALUES (the svs.spl_book[] indices), which is all the body reads apart from
// the SORTBY_CURRENT arm.  C's `(vptr1 < vptr2) ? -1 : (vptr1 > vptr2)` there
// compares the two ADDRESSES, i.e. "keep the current order"; returning 0 under
// V8's stable Array.prototype.sort is the same result, and the arm is only
// reachable via `default:` anyway (sortspells() returns early for
// SORTBY_CURRENT).
export function spell_cmp(vptr1, vptr2) {
    const indx1 = vptr1 | 0, indx2 = vptr2 | 0,
        otyp1 = spellid(indx1), otyp2 = spellid(indx2),
        levl1 = spell_level_of(otyp1), levl2 = spell_level_of(otyp2),
        skil1 = spell_skilltype(otyp1), skil2 = spell_skilltype(otyp2);

    switch (spl_sortmode()) {
    case SORTBY_LETTER:
        return indx1 - indx2;
    case SORTBY_ALPHA:
        break;
    case SORTBY_LVL_LO:
        if (levl1 !== levl2)
            return levl1 - levl2;
        break;
    case SORTBY_LVL_HI:
        if (levl1 !== levl2)
            return levl2 - levl1;
        break;
    case SORTBY_SKL_AL:
        if (skil1 !== skil2)
            return skil1 - skil2;
        break;
    case SORTBY_SKL_LO:
        if (skil1 !== skil2)
            return skil1 - skil2;
        if (levl1 !== levl2)
            return levl1 - levl2;
        break;
    case SORTBY_SKL_HI:
        if (skil1 !== skil2)
            return skil1 - skil2;
        if (levl1 !== levl2)
            return levl2 - levl1;
        break;
    case SORTBY_CURRENT:
    default:
        return 0; /* keep current order */
    }
    /* tie-breaker for most sorts--alphabetical by spell name */
    return sp_strcmpi(objects[otyp1]?.name || '', objects[otyp2]?.name || '');
}

// C ref: spell.c:1926 sortspells() — sort the index used for the display order
// of the "view known spells" list, or (SORTRETAINORDER) sort svs.spl_book[]
// itself so the current display order sticks.  RNG-free.
export function sortspells() {
    let i, n;

    if (spl_sortmode() === SORTBY_CURRENT)
        return;
    for (n = 0; n < MAXSPELL && spellid(n) !== NO_SPELL; ++n)
        continue;
    if (n < 2)
        return; /* not enough entries to need sorting */

    if (!game.spl_orderindx) {
        /* we haven't done any sorting yet; list is in casting order */
        if (spl_sortmode() === SORTBY_LETTER /* default */
            || spl_sortmode() === SORTRETAINORDER)
            return;
        /* allocate enough for full spellbook rather than just N spells */
        game.spl_orderindx = new Array(MAXSPELL);
        for (i = 0; i < MAXSPELL; i++)
            game.spl_orderindx[i] = i;
    }

    if (spl_sortmode() === SORTRETAINORDER) {
        const book = spl_book();
        // C copies struct spell BY VALUE through tmp_book[]; snapshot the
        // fields so the permutation cannot alias.
        const tmp_book = new Array(MAXSPELL);
        for (i = 0; i < MAXSPELL; i++) {
            const s = book[game.spl_orderindx[i]];
            tmp_book[i] = { sp_id: s.sp_id, sp_lev: s.sp_lev, sp_know: s.sp_know };
        }
        for (i = 0; i < MAXSPELL; i++) {
            book[i].sp_id = tmp_book[i].sp_id;
            book[i].sp_lev = tmp_book[i].sp_lev;
            book[i].sp_know = tmp_book[i].sp_know;
            game.spl_orderindx[i] = i;
        }
        game.spl_sortmode = SORTBY_LETTER; /* reset */
        return;
    }

    /* usual case, sort the index rather than the spells themselves.
       C: qsort(spl_orderindx, n, ...) — only the first n entries move. */
    const head = game.spl_orderindx.slice(0, n).sort(spell_cmp);
    for (i = 0; i < n; i++)
        game.spl_orderindx[i] = head[i];
}

// C ref: spell.c:1975 spellsortmenu() — the [sort spells] entry's own menu.
// Returns TRUE when a new sort mode was chosen.  RNG-free.
export async function spellsortmenu() {
    let let_, i, n, choice;
    const clr = NO_COLOR;

    const tmpwin = create_nhwindow_menu();
    start_menu(tmpwin);

    for (i = 0; i < spl_sortchoices.length; i++) {
        if (i === SORTRETAINORDER) {
            let_ = 'z'; /* assumes fewer than 26 sort choices... */
            /* separate final choice from others with a blank line */
            add_menu_str(tmpwin, '');
        } else {
            let_ = String.fromCharCode(97 + i);
        }
        add_menu(tmpwin, i + 1, let_, 0, ATR_NONE, clr, spl_sortchoices[i],
                 (i === spl_sortmode()) ? MENU_ITEMFLAGS_SELECTED
                                        : MENU_ITEMFLAGS_NONE);
    }
    end_menu(tmpwin, 'View known spells list sorted');

    const selected = await select_menu(tmpwin, PICK_ONE);
    destroy_nhwindow(tmpwin);
    n = selected.length;
    if (n > 0) {
        choice = selected[0].item - 1;
        /* skip preselected entry if we have more than one item chosen */
        if (n > 1 && choice === spl_sortmode())
            choice = selected[1].item - 1;
        game.spl_sortmode = choice;
        return true;
    }
    return false;
}

// C ref: spell.c:8-11 — the dospellmenu() `splaction` sentinels.  SPELLMENU_SORT
// is MAXSPELL, so it rides the same numbering as a real spl_book[] index.
export const SPELLMENU_DUMP = -3, SPELLMENU_CAST = -2, SPELLMENU_VIEW = -1;
export const SPELLMENU_SORT = MAXSPELL;

// C ref: spell.c:2074 dospellmenu(prompt, splaction, spell_no) — show the menu
// of known spells, with options to sort them.  Returns FALSE on cancel, TRUE
// otherwise; the chosen svs.spl_book[] index is reported through `spell_no`,
// which is C's `int *` out-parameter modelled here as `{ value }`.
//
// The header and per-row format strings are transcribed literally; the '+'
// (#showspells) window is a scored surface and these are what it prints.
//   heading, !menu_tab_sep: "%s%-20s Level %-12s Fail Retention"
//   row,     !menu_tab_sep: "%-20s  %2d   %-12s %3d%% %9s"
//   heading,  menu_tab_sep: "Name\tLevel\tCategory\tFail\tRetention"
//   row,      menu_tab_sep: "%s\t%-d\t%s\t%-d%%\t%s"
//   wizard-mode suffix:     heading "%c%6s" ("turns"), row "%c%6d" (sp_know)
export async function dospellmenu(prompt, splaction, spell_no) {
    let buf, tabbed, sep, i, n, how, splnum;
    const clr = NO_COLOR;
    const wizard = !!game.flags?.debug;

    const tmpwin = create_nhwindow_menu();
    start_menu(tmpwin);

    /*
     * The correct spacing of the columns when not using tab separation
     * depends on (1) a monospaced font and (2) selection letters prepended
     * to the given string in the form "a - ".  For SPELLMENU_DUMP, (2) is
     * untrue, so four spaces need to be subtracted.
     */
    if (!game.iflags?.menu_tab_sep) {
        buf = `${splaction === SPELLMENU_DUMP ? '' : '    '}`
            + `${sp_padr('Name', 20)} Level ${sp_padr('Category', 12)}`
            + ' Fail Retention';
        tabbed = false;
        sep = ' ';
    } else {
        buf = 'Name\tLevel\tCategory\tFail\tRetention';
        tabbed = true;
        sep = '\t';
    }
    if (wizard)
        buf += `${sep}${sp_padl('turns', 6)}`;

    add_menu_heading(tmpwin, buf);
    for (i = 0; i < MAXSPELL && spellid(i) !== NO_SPELL; i++) {
        splnum = !game.spl_orderindx ? i : game.spl_orderindx[i];
        const nm = objects[spellid(splnum)]?.name || '';   /* spellname() */
        const lev = spellev(splnum);
        // C: spelltypemnemonic(spell_skilltype(spellid(splnum))).  This port's
        // spelltypemnemonic() takes the OTYP and does the spell_skilltype()
        // lookup itself (see its definition at the top of this file).
        const cat = spelltypemnemonic(spellid(splnum));
        const fail = 100 - percent_success(splnum);
        const ret = spellretention(splnum);
        buf = tabbed
            ? `${nm}\t${lev}\t${cat}\t${fail}%\t${ret}`
            : `${sp_padr(nm, 20)}  ${sp_padl(lev, 2)}   ${sp_padr(cat, 12)} `
              + `${sp_padl(fail, 3)}% ${sp_padl(ret, 9)}`;
        if (wizard)
            /* NOTE C's index: the "turns" column uses the LOOP index i while
               every other column uses the sort-order index splnum. */
            buf += `${sep}${sp_padl(spellknow(i), 6)}`;

        add_menu(tmpwin, splnum + 1 /* must be non-zero */, spellet(splnum), 0,
                 ATR_NONE, clr, buf,
                 (splnum === splaction) ? MENU_ITEMFLAGS_SELECTED
                                        : MENU_ITEMFLAGS_NONE);
    }
    how = PICK_ONE;
    if (splaction === SPELLMENU_VIEW) {
        if (spellid(1) === NO_SPELL) {
            /* only one spell => nothing to swap with */
            how = PICK_NONE;
        } else {
            /* more than 1 spell, add an extra menu entry */
            add_menu(tmpwin, SPELLMENU_SORT + 1, '+', 0, ATR_NONE, clr,
                     '[sort spells]', MENU_ITEMFLAGS_NONE);
        }
    }
    end_menu(tmpwin, prompt);

    const selected = await select_menu(tmpwin, how);
    destroy_nhwindow(tmpwin);
    n = selected.length;
    if (n > 0) {
        spell_no.value = selected[0].item - 1;
        /* menu selection for `PICK_ONE' does not de-select a preselection */
        if (n > 1 && spell_no.value === splaction)
            spell_no.value = selected[1].item - 1;
        /* default selection of the preselected spell means that the user
           chose not to swap it with anything */
        if (spell_no.value === splaction)
            return false;
        return true;
    } else if (splaction >= 0) {
        /* explicit de-selection of the preselected spell means the user is
           still swapping but not for the current spell */
        spell_no.value = splaction;
        return true;
    }
    return false;
}

// C ref: spell.c:2058 show_spells() — lists spells for endgame dumplog
// purposes.  js/end.js:1536 marks the call site this replaces.
export async function show_spells() {
    const unused = { value: SPELLMENU_DUMP };

    if (spellid(0) === NO_SPELL) {
        await pline("You didn't know any spells.");
        await pline('');
    } else {
        await pline('Spells:');
        await dospellmenu('', SPELLMENU_DUMP, unused);
    }
}

// C ref: include/spell.h:21 enum spellbook_states.
export const spe_Forgotten = -1, spe_Unknown = 0, spe_Fresh = 1,
             spe_GoingStale = 2;
// C ref: include/spell.h:9 UNKNOWN_SPELL.
export const UNKNOWN_SPELL = -1;

// C ref: spell.c:2362 known_spell(otyp) — one of spe_Unknown / spe_Fresh /
// spe_GoingStale / spe_Forgotten.  js/cmd.js:2084 documents the ^T call site.
export function known_spell(otyp) {
    for (let i = 0; (i < MAXSPELL) && (spellid(i) !== NO_SPELL); i++)
        if (spellid(i) === otyp) {
            const k = spellknow(i);
            return (k > KEEN / 10) ? spe_Fresh
                : (k > 0) ? spe_GoingStale
                    : spe_Forgotten;
        }
    return spe_Unknown;
}

// C ref: spell.c:2390 force_learn_spell(otyp) — learn or refresh spell otyp if
// feasible; returns the casting letter or '\0' (pray.c:1035 compares against
// '\0', NOT truthiness — and '\0' is TRUTHY in JS, so a caller must do the same
// explicit comparison).  RNG-free.
export function force_learn_spell(otyp) {
    let i;

    if (otyp === SPE_BLANK_PAPER || otyp === SPE_BOOK_OF_THE_DEAD
        || known_spell(otyp) === spe_Fresh)
        return '\0';

    for (i = 0; i < MAXSPELL; i++)
        if (spellid(i) === NO_SPELL || spellid(i) === otyp)
            break;
    if (i === MAXSPELL) {
        /* C: impossible("Too many spells memorized") */
        return '\0';
    }
    // for a going-stale or forgotten spell the sp_id and sp_lev assignments are
    // redundant but harmless; for an unknown spell, they're essential
    const book = spl_book();
    book[i].sp_id = otyp;
    book[i].sp_lev = spell_level_of(otyp);
    book[i].sp_know = KEEN;  /* incrnknow(i, 0) — no +1: not read from a book */
    return spellet(i);
}
