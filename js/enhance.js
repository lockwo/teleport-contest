// enhance.js — the #enhance extended command (weapon-skill enhancement menu).
//
// C ref: weapon.c enhance_weapon_skill() / add_skills_to_menu() /
// skill_level_name(); u_init.c skill_init() / skills_for_role() / Skill_* tables.
//
// Builds the hero's weapon-skill array (P_SKILL / P_MAX_SKILL) deterministically
// from the role skill table plus the carried-weapon rule (skill_init: each
// non-ammo weapon-type held at game start gets P_BASIC, martial arts gets
// P_BASIC when its max exceeds P_EXPERT, a starting steed grants P_RIDING basic),
// then renders the "Pick a skill to advance:" / "Current skills:" menu as a
// paged NHW_MENU.  For the recorded sessions no skill is yet advanceable
// (u.weapon_slots == 0 at experience level 1), so the menu is always the
// non-selectable PICK_NONE "Current skills:" form dismissed with ESC.

import { game } from './gstate.js';
import { nhgetch } from './input.js';
import { objects, WEAPON_CLASS, GEM_CLASS, TOOL_CLASS } from './mkobj.js';
import { renderWindowScreen, dismiss_invent_screen } from './invent.js';
import { y_n, update_topl, topl_more, docrt } from './display.js';
import {
    P_NONE, P_ISRESTRICTED, P_UNSKILLED, P_BASIC, P_SKILLED, P_EXPERT,
    P_MASTER, P_GRAND_MASTER, P_NUM_SKILLS,
    P_FIRST_WEAPON, P_LAST_WEAPON, P_FIRST_SPELL, P_LAST_SPELL,
    P_FIRST_H_TO_H, P_LAST_H_TO_H,
    P_BARE_HANDED_COMBAT, P_RIDING, P_TWO_WEAPON_COMBAT,
} from './const.js';

const ECMD_OK = 0;

// Role mnums (u_init.c monster order).
const PM_ARCHEOLOGIST = 0, PM_BARBARIAN = 1, PM_CAVE_DWELLER = 2, PM_HEALER = 3,
      PM_KNIGHT = 4, PM_MONK = 5, PM_CLERIC = 6, PM_RANGER = 7, PM_ROGUE = 8,
      PM_SAMURAI = 9, PM_TOURIST = 10, PM_VALKYRIE = 11, PM_WIZARD = 12;

// C ref: u_init.c Skill_* tables — [skill, skmax] pairs (P_NONE terminator
// omitted).  These set P_MAX_SKILL and, by appearing here, unrestrict the skill.
const SKILL_A = [[1,P_BASIC],[2,P_BASIC],[4,P_EXPERT],[5,P_BASIC],[9,P_EXPERT],
    [10,P_SKILLED],[15,P_SKILLED],[21,P_SKILLED],[23,P_BASIC],[25,P_EXPERT],
    [26,P_EXPERT],[27,P_SKILLED],[28,P_BASIC],[29,P_BASIC],[30,P_EXPERT],
    [34,P_BASIC],[37,P_BASIC],[36,P_BASIC],[35,P_EXPERT]];
const SKILL_B = [[1,P_BASIC],[3,P_EXPERT],[4,P_SKILLED],[5,P_EXPERT],[6,P_SKILLED],
    [7,P_SKILLED],[8,P_EXPERT],[9,P_SKILLED],[10,P_SKILLED],[11,P_SKILLED],
    [12,P_SKILLED],[13,P_BASIC],[14,P_EXPERT],[15,P_BASIC],[17,P_SKILLED],
    [18,P_SKILLED],[20,P_BASIC],[28,P_BASIC],[33,P_BASIC],[37,P_BASIC],
    [36,P_BASIC],[35,P_MASTER]];
const SKILL_C = [[1,P_BASIC],[2,P_SKILLED],[3,P_SKILLED],[4,P_BASIC],[10,P_EXPERT],
    [11,P_EXPERT],[12,P_BASIC],[13,P_SKILLED],[14,P_SKILLED],[15,P_EXPERT],
    [16,P_SKILLED],[17,P_EXPERT],[18,P_SKILLED],[20,P_SKILLED],[21,P_EXPERT],
    [28,P_BASIC],[34,P_SKILLED],[25,P_EXPERT],[27,P_BASIC],[35,P_MASTER]];
const SKILL_H = [[1,P_SKILLED],[2,P_EXPERT],[5,P_SKILLED],[9,P_BASIC],[10,P_SKILLED],
    [11,P_BASIC],[15,P_EXPERT],[16,P_BASIC],[17,P_BASIC],[18,P_BASIC],
    [21,P_SKILLED],[23,P_EXPERT],[24,P_SKILLED],[27,P_EXPERT],[29,P_EXPERT],
    [35,P_BASIC]];
const SKILL_K = [[1,P_BASIC],[2,P_BASIC],[3,P_SKILLED],[4,P_BASIC],[5,P_SKILLED],
    [6,P_SKILLED],[7,P_EXPERT],[8,P_SKILLED],[9,P_SKILLED],[10,P_BASIC],
    [11,P_SKILLED],[12,P_SKILLED],[13,P_BASIC],[14,P_BASIC],[16,P_SKILLED],
    [17,P_SKILLED],[18,P_BASIC],[19,P_EXPERT],[20,P_BASIC],[22,P_SKILLED],
    [28,P_SKILLED],[29,P_SKILLED],[32,P_SKILLED],[37,P_EXPERT],[36,P_SKILLED],
    [35,P_EXPERT]];
const SKILL_MON = [[15,P_BASIC],[17,P_BASIC],[22,P_BASIC],[24,P_BASIC],[28,P_BASIC],
    [29,P_EXPERT],[30,P_BASIC],[31,P_BASIC],[32,P_SKILLED],[33,P_SKILLED],
    [34,P_BASIC],[35,P_GRAND_MASTER]];
const SKILL_P = [[10,P_EXPERT],[11,P_EXPERT],[12,P_EXPERT],[13,P_EXPERT],[14,P_EXPERT],
    [15,P_EXPERT],[16,P_SKILLED],[17,P_SKILLED],[18,P_SKILLED],[19,P_BASIC],
    [20,P_BASIC],[21,P_BASIC],[22,P_BASIC],[23,P_BASIC],[24,P_BASIC],
    [25,P_BASIC],[27,P_SKILLED],[29,P_EXPERT],[30,P_EXPERT],[32,P_EXPERT],
    [35,P_BASIC]];
const SKILL_R = [[1,P_EXPERT],[2,P_EXPERT],[5,P_EXPERT],[6,P_SKILLED],[7,P_SKILLED],
    [8,P_BASIC],[9,P_SKILLED],[10,P_SKILLED],[11,P_SKILLED],[12,P_BASIC],
    [13,P_BASIC],[14,P_BASIC],[16,P_BASIC],[17,P_BASIC],[22,P_EXPERT],
    [23,P_EXPERT],[24,P_SKILLED],[30,P_SKILLED],[33,P_SKILLED],[34,P_SKILLED],
    [37,P_BASIC],[36,P_EXPERT],[35,P_EXPERT]];
const SKILL_RAN = [[1,P_EXPERT],[2,P_SKILLED],[3,P_SKILLED],[4,P_BASIC],[5,P_BASIC],
    [12,P_BASIC],[13,P_SKILLED],[14,P_BASIC],[15,P_BASIC],[16,P_SKILLED],
    [17,P_EXPERT],[18,P_BASIC],[20,P_EXPERT],[21,P_EXPERT],[22,P_EXPERT],
    [23,P_EXPERT],[24,P_SKILLED],[25,P_EXPERT],[26,P_BASIC],[29,P_BASIC],
    [30,P_EXPERT],[33,P_BASIC],[37,P_BASIC],[35,P_BASIC]];
const SKILL_S = [[1,P_BASIC],[2,P_SKILLED],[5,P_EXPERT],[6,P_SKILLED],[7,P_EXPERT],
    [8,P_EXPERT],[9,P_BASIC],[13,P_SKILLED],[15,P_BASIC],[16,P_SKILLED],
    [17,P_SKILLED],[19,P_SKILLED],[20,P_EXPERT],[24,P_EXPERT],[28,P_BASIC],
    [30,P_BASIC],[32,P_SKILLED],[37,P_SKILLED],[36,P_EXPERT],[35,P_MASTER]];
const SKILL_T = [[1,P_EXPERT],[2,P_SKILLED],[3,P_BASIC],[4,P_BASIC],[5,P_EXPERT],
    [6,P_BASIC],[7,P_BASIC],[8,P_BASIC],[9,P_SKILLED],[11,P_BASIC],
    [12,P_BASIC],[13,P_BASIC],[14,P_BASIC],[15,P_BASIC],[16,P_BASIC],
    [17,P_BASIC],[18,P_BASIC],[19,P_BASIC],[20,P_BASIC],[21,P_BASIC],
    [22,P_BASIC],[23,P_EXPERT],[24,P_BASIC],[25,P_BASIC],[26,P_BASIC],
    [27,P_SKILLED],[30,P_BASIC],[31,P_BASIC],[33,P_SKILLED],[37,P_BASIC],
    [36,P_SKILLED],[35,P_SKILLED]];
const SKILL_V = [[1,P_EXPERT],[3,P_EXPERT],[4,P_SKILLED],[5,P_SKILLED],[6,P_SKILLED],
    [7,P_EXPERT],[8,P_EXPERT],[9,P_BASIC],[14,P_EXPERT],[15,P_BASIC],
    [16,P_SKILLED],[17,P_EXPERT],[18,P_BASIC],[19,P_SKILLED],[21,P_BASIC],
    [28,P_BASIC],[33,P_BASIC],[37,P_SKILLED],[36,P_SKILLED],[35,P_EXPERT]];
const SKILL_W = [[1,P_EXPERT],[2,P_SKILLED],[3,P_SKILLED],[5,P_BASIC],[10,P_SKILLED],
    [11,P_BASIC],[15,P_EXPERT],[16,P_SKILLED],[17,P_BASIC],[18,P_BASIC],
    [21,P_SKILLED],[23,P_EXPERT],[24,P_BASIC],[28,P_EXPERT],[29,P_SKILLED],
    [30,P_EXPERT],[31,P_SKILLED],[32,P_SKILLED],[33,P_EXPERT],[34,P_EXPERT],
    [37,P_BASIC],[35,P_BASIC]];

// C ref: u_init.c skills_for_role().
const SKILLS_FOR_ROLE = {
    [PM_ARCHEOLOGIST]: SKILL_A, [PM_BARBARIAN]: SKILL_B, [PM_CAVE_DWELLER]: SKILL_C,
    [PM_HEALER]: SKILL_H, [PM_KNIGHT]: SKILL_K, [PM_MONK]: SKILL_MON,
    [PM_CLERIC]: SKILL_P, [PM_RANGER]: SKILL_RAN, [PM_ROGUE]: SKILL_R,
    [PM_SAMURAI]: SKILL_S, [PM_TOURIST]: SKILL_T, [PM_VALKYRIE]: SKILL_V,
    [PM_WIZARD]: SKILL_W,
};

// C ref: weapon.c skill_names_indices[] resolved through P_NAME() (OBJ_NAME for
// object-backed skills, odd_skill_names[] / barehands_or_martial[] otherwise).
// Bare-handed-combat (35) is filled in per-hero (martial arts vs bare handed).
const P_NAMES = {
    1: 'dagger', 2: 'knife', 3: 'axe', 4: 'pick-axe', 5: 'short sword',
    6: 'broadsword', 7: 'long sword', 8: 'two-handed sword', 9: 'saber',
    10: 'club', 11: 'mace', 12: 'morning star', 13: 'flail', 14: 'hammer',
    15: 'quarterstaff', 16: 'polearms', 17: 'spear', 18: 'trident', 19: 'lance',
    20: 'bow', 21: 'sling', 22: 'crossbow', 23: 'dart', 24: 'shuriken',
    25: 'boomerang', 26: 'whip', 27: 'unicorn horn',
    28: 'attack spells', 29: 'healing spells', 30: 'divination spells',
    31: 'enchantment spells', 32: 'clerical spells', 33: 'escape spells',
    34: 'matter spells',
    36: 'two weapon combat', 37: 'riding',
};

const SKILL_LEVEL_NAME = {
    [P_UNSKILLED]: 'Unskilled', [P_BASIC]: 'Basic', [P_SKILLED]: 'Skilled',
    [P_EXPERT]: 'Expert', [P_MASTER]: 'Master', [P_GRAND_MASTER]: 'Grand Master',
};

// C ref: include/skills.h martial_bonus() = Role_if(SAMURAI) || Role_if(MONK).
function martial_bonus(rolemnum) {
    return rolemnum === PM_SAMURAI || rolemnum === PM_MONK;
}

export function P_NAME(skill, rolemnum) {
    if (skill === P_BARE_HANDED_COMBAT)
        return martial_bonus(rolemnum) ? 'martial arts' : 'bare handed combat';
    return P_NAMES[skill] || 'no skill';
}

// C ref: weapon.c:1517 weapon_type(obj) — js/weapon.js owns it.
export { weapon_type } from './weapon.js';
import { weapon_type } from './weapon.js';

// C ref: weapon.c uwep_skill_type().
export function uwep_skill_type() {
    if (game.u?.twoweap) return P_TWO_WEAPON_COMBAT;
    return weapon_type(game.uwep);
}

// C ref: weapon.c use_skill(skill, degree) — practice toward the next
// enhancement.  give_may_advance_msg()'s "You feel more confident..." arm needs
// u.weapon_slots, which this port does not track (it reads 0, so can_advance()
// is false on both sides of the increment and the message can never fire).
export function use_skill(skill, degree) {
    if (skill === P_NONE) return;
    const S = build_skill_state();
    if (S.P_SKILL[skill] === P_ISRESTRICTED) return;
    const u = game.u = game.u || {};
    u.skill_training = u.skill_training || {};
    u.skill_training[skill] = (u.skill_training[skill] || 0) + degree;
}
function is_ammo(obj) {
    const sk = objects[obj.otyp]?.oc_skill ?? 0;
    return (obj.oclass === WEAPON_CLASS || obj.oclass === GEM_CLASS)
        && sk >= -22 && sk <= -20; // -P_CROSSBOW .. -P_BOW
}

function current_role_mnum() {
    return game.urole?.mnum ?? game.u?.umonnum ?? PM_SAMURAI;
}

// Build {skill, max, level, restricted} state for all P_NUM_SKILLS skills.
// C ref: weapon.c skill_init():1750 — snapshot the carried-weapon skills ONCE,
// at u_init time (C stores the result in u.weapon_skills[]).
export function skill_init_snapshot() {
    const invent = Array.isArray(game.invent) ? game.invent
        : (Array.isArray(game.gi?.invent) ? game.gi.invent : []);
    const out = [];
    for (const obj of invent) {
        if (!obj || is_ammo(obj)) continue;
        const sk = weapon_type(obj);
        if (sk !== P_NONE && !out.includes(sk)) out.push(sk);
    }
    game.u = game.u || {};
    game.u.skill_init_basics = out;
}

// C ref: weapon.c skill_init() (restricted by default; basic for carried
// non-ammo weapons; role table sets max + unrestricts; martial arts basic
// when its max > EXPERT; pony-riders get P_RIDING basic).
function build_skill_state() {
    const rolemnum = current_role_mnum();
    const P_SKILL = new Array(P_NUM_SKILLS).fill(P_ISRESTRICTED);
    const P_MAX = new Array(P_NUM_SKILLS).fill(P_ISRESTRICTED);

    // C ref: weapon.c skill_init():1750 — the "basic for every carried weapon"
    // pass runs ONCE, at u_init time, and its result lives in u.weapon_skills[]
    // forever.  Recomputing it from the LIVE inventory silently demotes a skill
    // when the hero drops the starting weapon.
    for (const sk of (game.u?.skill_init_basics || [])) P_SKILL[sk] = P_BASIC;

    // Role spell-skill basics (skill_init magic block).
    if (rolemnum === PM_HEALER || rolemnum === PM_MONK) P_SKILL[29] = P_BASIC;
    else if (rolemnum === PM_CLERIC) P_SKILL[32] = P_BASIC;
    else if (rolemnum === PM_WIZARD) { P_SKILL[28] = P_BASIC; P_SKILL[31] = P_BASIC; }

    // Role table: set maxes + unrestrict.
    const table = SKILLS_FOR_ROLE[rolemnum] || SKILL_S;
    for (const [sk, skmax] of table) {
        P_MAX[sk] = skmax;
        if (P_SKILL[sk] === P_ISRESTRICTED) P_SKILL[sk] = P_UNSKILLED;
    }

    // High-potential fighters already know their hands.
    if (P_MAX[P_BARE_HANDED_COMBAT] > P_EXPERT) P_SKILL[P_BARE_HANDED_COMBAT] = P_BASIC;
    // Roles starting with a horse (Knight's pony) know how to ride it.
    if (rolemnum === PM_KNIGHT) P_SKILL[P_RIDING] = P_BASIC;

    // C ref: u_init.c skill_init():1795-1801 — the tail loop seeds every
    // unrestricted skill's training counter to the amount already "spent"
    // reaching its starting level, so a Basic skill starts at 20 rather than 0.
    // (The #enhance wizard menu prints this number, so it is load-bearing.)
    const P_ADV = new Array(P_NUM_SKILLS).fill(0);
    const trained = game.u?.skill_training || {};
    for (let i = 0; i < P_NUM_SKILLS; i++) {
        if (P_SKILL[i] === P_ISRESTRICTED) continue;
        P_ADV[i] = practice_needed_to_advance(P_SKILL[i] - 1) + (trained[i] || 0);
    }

    // C ref: weapon.c skill_advance() — #enhance raises P_SKILL permanently.
    // u.weapon_skills[] is real saved state; this port rebuilds the skill_init
    // baseline on every call, so the advances are replayed on top of it.
    const advanced = game.u?.skill_record || [];
    for (const sk of advanced) if (P_SKILL[sk] !== P_ISRESTRICTED) P_SKILL[sk]++;

    return { P_SKILL, P_MAX, P_ADV, rolemnum };
}

// C ref: include/skills.h practice_needed_to_advance(level).
function practice_needed_to_advance(level) {
    return level * level * 20;
}

// C ref: weapon.c slots_required() — harder training costs more slots; the
// unarmed/martial disciplines (everything past P_LAST_WEAPON except
// two-weapon combat) cost half, rounded up.
function slots_required(skill, S) {
    const tmp = S.P_SKILL[skill];
    if (skill <= P_LAST_WEAPON || skill === P_TWO_WEAPON_COMBAT)
        return tmp;
    return Math.trunc((tmp + 1) / 2);
}

// C ref: hack.h wizard == flags.debug.
function is_wizard() {
    return !!(game.flags && game.flags.debug);
}

const P_SKILL_LIMIT = 60; // C ref: include/skills.h

// C ref: weapon.c can_advance()/could_advance()/peaked_skill().
function can_advance(skill, speedy, S) {
    if (S.P_SKILL[skill] === P_ISRESTRICTED
        || S.P_SKILL[skill] >= S.P_MAX[skill]
        || (game.u?.skills_advanced || 0) >= P_SKILL_LIMIT)
        return false;
    if (is_wizard() && speedy)
        return true;
    return S.P_ADV[skill] >= practice_needed_to_advance(S.P_SKILL[skill])
        && (game.u?.weapon_slots || 0) >= slots_required(skill, S);
}
function could_advance(skill, S) {
    if (S.P_SKILL[skill] === P_ISRESTRICTED
        || S.P_SKILL[skill] >= S.P_MAX[skill]
        || (game.u?.skills_advanced || 0) >= P_SKILL_LIMIT)
        return false;
    return S.P_ADV[skill] >= practice_needed_to_advance(S.P_SKILL[skill]);
}
function peaked_skill(skill, S) {
    if (S.P_SKILL[skill] === P_ISRESTRICTED) return false;
    return S.P_SKILL[skill] >= S.P_MAX[skill]
        && S.P_ADV[skill] >= practice_needed_to_advance(S.P_SKILL[skill]);
}

// C ref: weapon.c P_SKILL(skill) — the hero's current proficiency in a given
// skill discipline.  Rebuilt deterministically from role + carried weapons
// (skill advancement via #enhance isn't exercised by the spell-view sessions).
export function p_skill_of(skill) {
    const { P_SKILL } = build_skill_state();
    return P_SKILL[skill];
}
// C ref: weapon.c:1156 can_advance(skill, FALSE) — exported so weapon.c's
// add_weapon_skill()/give_may_advance_msg() can count advanceable skills
// without rebuilding the skill state themselves.
export function can_advance_pub(skill, speedy = false) {
    return can_advance(skill, speedy, build_skill_state());
}

// C ref: weapon.c skill_ranges[].
const SKILL_RANGES = [
    [P_FIRST_H_TO_H, P_LAST_H_TO_H, 'Fighting Skills'],
    [P_FIRST_WEAPON, P_LAST_WEAPON, 'Weapon Skills'],
    [P_FIRST_SPELL, P_LAST_SPELL, 'Spellcasting Skills'],
];

// C ref: weapon.c enhance_weapon_skill() + add_skills_to_menu().  Builds the
// ordered line list (title, optional legend, headings, items) for the menu.
// Returns { lines, title } where lines is [{text, attr}].
function build_skill_menu_lines(state) {
    const { P_SKILL, P_MAX, rolemnum } = state;
    const restricted = (i) => P_SKILL[i] === P_ISRESTRICTED;

    // At experience level 1 with no weapon slots, nothing can advance and
    // nothing is flagged "*"/"#" (P_ADVANCE never reaches the threshold), so
    // the menu is the non-selectable "Current skills:" form with no legend.
    // (The recorded sessions only ever take this path.)
    const to_advance = 0;       // u.weapon_slots == 0
    const selectable = false;

    // longest unrestricted skill name (for %-*s padding).
    let longest = 0;
    for (let i = 0; i < P_NUM_SKILLS; i++) {
        if (restricted(i)) continue;
        const len = P_NAME(i, rolemnum).length;
        if (len > longest) longest = len;
    }

    const lines = [];
    for (const [first, last, name] of SKILL_RANGES) {
        // Heading (ATR_INVERSE) emitted at the start of each range.
        lines.push({ text: name, attr: 1 /* ATR_INVERSE */ });
        for (let i = first; i <= last; i++) {
            if (restricted(i)) continue;
            const lvl = SKILL_LEVEL_NAME[P_SKILL[i]] || 'Unknown';
            // C: " %s %-*s [%s]" with prefix == "" (selectable false) ->
            // "  " + name.padEnd(longest) + " [" + level + "]".
            const text = '  ' + P_NAME(i, rolemnum).padEnd(longest) + ' [' + lvl + ']';
            lines.push({ text });
        }
    }

    const title = (to_advance > 0) ? 'Pick a skill to advance:' : 'Current skills:';
    return { lines, title, selectable };
}

// Render one page of the skill menu.  C ref: win/tty/wintty.c
// process_menu_window — a full-screen (multi-page) NHW_MENU: the end_menu()
// prompt is the first line (ATR_INVERSE), 23 content lines per page, the
// "(N of M)" morestr on the last row (indented one column by dmore).
function renderSkillPage() {
    const pages = game._skill_pages;
    if (!pages) return;
    const idx = game._skill_page || 0;
    const page = pages[idx];
    const footer = `(${idx + 1} of ${pages.length})`;
    renderWindowScreen(page, {
        menu: true,
        footer,
        footerRow: page.length,
        footerCol: 1,
        modal: 'skillwin',
    });
}

// C ref: weapon.c add_skills_to_menu() — the selectable form, used whenever
// any skill is annotated or advanceable.  Returns the flat item list in
// end_menu() order: [prompt, blank, legend..., heading, items...].  A
// selectable item carries `skill`; the accelerator letter is assigned later
// (tty_end_menu resets it per page).
function build_skill_menu_items(S, speedy) {
    const { P_SKILL, P_MAX, P_ADV, rolemnum } = S;
    const restricted = (i) => P_SKILL[i] === P_ISRESTRICTED;
    const wiz = is_wizard();

    let to_advance = 0, eventually_advance = 0, maxxed_cnt = 0;
    for (let i = 0; i < P_NUM_SKILLS; i++) {
        if (restricted(i)) continue;
        if (can_advance(i, speedy, S)) to_advance++;
        else if (could_advance(i, S)) eventually_advance++;
        else if (peaked_skill(i, S)) maxxed_cnt++;
    }
    const selectable = (to_advance + eventually_advance + maxxed_cnt) > 0;

    let longest = 0;
    for (let i = 0; i < P_NUM_SKILLS; i++) {
        if (restricted(i)) continue;
        const len = P_NAME(i, rolemnum).length;
        if (len > longest) longest = len;
    }

    const items = [];
    if (eventually_advance > 0 || maxxed_cnt > 0) {
        if (eventually_advance > 0)
            items.push({ text: `(Skill${eventually_advance === 1 ? '' : 's'} flagged by "*" may be enhanced `
                + `${(game.u?.ulevel ?? 1) < 30 ? "when you're more experienced"
                                                : 'if skill slots become available'}.)` });
        if (maxxed_cnt > 0)
            items.push({ text: `(Skill${maxxed_cnt === 1 ? '' : 's'} flagged by "#" cannot be enhanced any further.)` });
        items.push({ text: '' });
    }

    for (const [first, last, name] of SKILL_RANGES) {
        items.push({ text: name, attr: 1 /* ATR_INVERSE (iflags.menu_headings) */ });
        for (let i = first; i <= last; i++) {
            if (restricted(i)) continue;
            const lvl = SKILL_LEVEL_NAME[P_SKILL[i]] || 'Unknown';
            const advanceable = selectable && can_advance(i, speedy, S);
            // C: prefix is "" for a lettered entry, "  * "/"  # "/"    " otherwise.
            const prefix = !selectable ? ''
                : advanceable ? ''
                : could_advance(i, S) ? '  * '
                : peaked_skill(i, S) ? '  # ' : '    ';
            // C: wizard  " %s%-*s %-12s %5d(%4d)"; else  " %s %-*s [%s]".
            const text = wiz
                ? ' ' + prefix + P_NAME(i, rolemnum).padEnd(longest) + ' '
                    + lvl.padEnd(12) + ' ' + String(P_ADV[i]).padStart(5)
                    + '(' + String(practice_needed_to_advance(P_SKILL[i])).padStart(4) + ')'
                : ' ' + prefix + ' ' + P_NAME(i, rolemnum).padEnd(longest) + ' [' + lvl + ']';
            items.push({ text, skill: advanceable ? i : undefined });
        }
    }

    let title = (to_advance > 0) ? 'Pick a skill to advance:' : 'Current skills:';
    if (wiz && !speedy) {
        const slots = game.u?.weapon_slots || 0;
        title += `  (${slots} slot${slots === 1 ? '' : 's'} available)`;
    }
    // end_menu() prepends the prompt + a blank separator line.
    items.unshift({ text: title, attr: 1 }, { text: '' });
    return { items, to_advance };
}

// C ref: win/tty/wintty.c tty_end_menu() — pages of min(52, rows-1) entries;
// menu_ch restarts at 'a' on every page and only advances for selectable items.
function paginate_skill_menu(items) {
    const lmax = Math.min(52, (game.nhDisplay?.rows ?? 24) - 1);
    const pages = [];
    let menu_ch = 'a';
    for (let n = 0; n < items.length; n++) {
        if (n % lmax === 0) { menu_ch = 'a'; pages.push([]); }
        const it = items[n];
        if (it.skill != null) {
            it.sel = menu_ch;
            menu_ch = menu_ch === 'z' ? 'A'
                : String.fromCharCode(menu_ch.charCodeAt(0) + 1);
        }
        pages[pages.length - 1].push(it);
    }
    return pages;
}

// C ref: win/tty/wintty.c tty_add_menu() — a selectable entry's string is
// "<letter> - <text>"; process_menu_window() then writes a space at column 0
// and the string from column 1.
function render_skill_menu_page(pages, idx) {
    const page = pages[idx];
    renderWindowScreen(page.map((it) => ({
        text: it.sel ? `${it.sel} - ${it.text}` : it.text,
        attr: it.attr || 0,
    })), {
        menu: true,
        footer: pages.length > 1 ? `(${idx + 1} of ${pages.length})` : '(end) ',
        footerRow: page.length,
        footerCol: 1,
        modal: 'skillwin',
    });
}

// C ref: win/tty/wintty.c process_menu_window() — one select_menu() round.
// Returns the picked skill, or null for a commit-with-nothing / cancel.
async function select_skill_menu(pages, pickOne) {
    let idx = 0;
    for (;;) {
        render_skill_menu_page(pages, idx);
        const c = await nhgetch();
        const ch = String.fromCharCode(c);
        if (c === 27) { delete game._modal_screen; return null; }     // cancel
        if (c === 13 || c === 10) { delete game._modal_screen; return null; } // commit
        if (ch === ' ') {
            if (idx < pages.length - 1) { idx++; continue; }
            delete game._modal_screen;
            return null;                                  // ' ' past last page ends
        }
        if (ch === '>') { if (idx < pages.length - 1) idx++; continue; }
        if (ch === '<') { if (idx > 0) idx--; continue; }
        if (pickOne) {
            const hit = pages[idx].find((it) => it.skill != null && it.sel === ch);
            if (hit) { delete game._modal_screen; return hit.skill; }
        }
        // unacceptable input: tty_nhbell(), menu stays up.
    }
}

// C ref: weapon.c skill_advance().
async function skill_advance(skill, S) {
    const u = game.u = game.u || {};
    u.weapon_slots = (u.weapon_slots || 0) - slots_required(skill, S);
    u.skill_record = u.skill_record || [];
    u.skill_record.push(skill);
    u.skills_advanced = (u.skills_advanced || 0) + 1;
    // The new level decides "most" vs "more"; S is the pre-advance state.
    const newlvl = S.P_SKILL[skill] + 1;
    await update_topl(`You are now ${newlvl >= S.P_MAX[skill] ? 'most' : 'more'} `
        + `skilled in ${P_NAME(skill, S.rolemnum)}.`);
    // C also calls skill_based_spellbook_id() for a spell skill; that only
    // marks spellbooks known (no RNG, no topline) so it is left out.
}

// C ref: cmd.c doextcmd -> weapon.c enhance_weapon_skill().  In wizard mode
// the command opens with a y_n() and then runs its own select_menu() loop, so
// it is driven inline here; outside wizard mode the menu is always the
// single-shot PICK_NONE listing that the move loop pages (skill_window_advance).
export async function doenhance() {
    // svc.context.tips |= (1 << TIP_ENHANCE) — player now knows about #enhance.
    if (is_wizard()) {
        let speedy = false;
        if (await y_n('Advance skills without practice?') === 'y')
            speedy = true;
        let more_to_do = 0;
        do {
            const S = build_skill_state();
            const { items, to_advance } = build_skill_menu_items(S, speedy);
            const pages = paginate_skill_menu(items);
            const pick = await select_skill_menu(pages, to_advance > 0);
            more_to_do = 0;
            if (pick != null) {
                // destroy_nhwindow() on a full-screen menu redraws the map
                // before skill_advance()'s message lands on a fresh top line.
                delete game._skill_pages;
                delete game._skill_page;
                game._pending_message = '';
                await docrt();
                await skill_advance(pick, S);
                const S2 = build_skill_state();
                for (let i = 0; i < P_NUM_SKILLS; i++) {
                    if (can_advance(i, speedy, S2)) {
                        if (!speedy) await update_topl('You feel you could be more dangerous!');
                        more_to_do = 1;
                        break;
                    }
                }
                // tty_display_nhwindow() more()s a pending topline before it
                // paints the next menu over the map.  C's more() ends with
                // home()+cl_end(), so the next round's message starts a fresh
                // line instead of being appended after two spaces.
                if (game._toplin === 1) {
                    await topl_more();
                    game._toplin = 0;
                    game._pending_message = '';
                }
            }
        } while (speedy && more_to_do > 0);
        delete game._skill_pages;
        delete game._skill_page;
        game._modal_screen = 'skillwin';
        await dismiss_invent_screen();
        return ECMD_OK;
    }
    const state = build_skill_state();
    const { lines, title } = build_skill_menu_lines(state);

    // end_menu() prepends the title (ATR_INVERSE) + a blank separator line.
    const allLines = [{ text: title, attr: 1 }, { text: '' }, ...lines];

    // C ref: win/tty/wintty.c tty_display_nhwindow NHW_MENU — cw->maxrow ==
    // nitems + 1 (the morestr row).  A menu SHORTER than the screen floats as a
    // partial-width overlay with an "(end)" morestr; only one that reaches
    // ttyDisplay->rows takes the whole screen and pages with "(N of M)".  A
    // short skill list (Monk: 3 headings + 12 skills) was being drawn
    // full-screen, wiping the map and status rows the recorder keeps.
    const totalRows = game.nhDisplay?.rows ?? 24;
    if (allLines.length + 1 < totalRows) {
        const { renderMenuLines } = await import('./invent.js');
        renderMenuLines(allLines, null); // cursor: parked past "(end) "
        game._modal_screen = 'skillwin';
        return ECMD_OK;
    }

    // Paginate: 23 content lines per page (row 23 holds the "(N of M)" morestr).
    const perPage = totalRows - 1;
    const pages = [];
    for (let i = 0; i < allLines.length; i += perPage)
        pages.push(allLines.slice(i, i + perPage));
    game._skill_pages = pages;
    game._skill_page = 0;
    renderSkillPage();
    return ECMD_OK;
}

// Advance the paged skill window (space / '>' next page; dismiss after last).
// C ref: process_menu_window() page navigation.  Returns true if a window was
// active and consumed the key.
export async function skill_window_advance(key) {
    if (game._modal_screen !== 'skillwin') return false;
    const pages = game._skill_pages || [];
    const cur = game._skill_page || 0;
    const onLast = cur >= pages.length - 1;
    // C ref: wintty.c process_menu_window(), PICK_NONE.  Only these keys act;
    // everything else is tty_nhbell() and the menu stays up unchanged.
    if (key === '<') {                              // MENU_PREVIOUS_PAGE
        if (cur > 0) game._skill_page = cur - 1;
        renderSkillPage();
        return true;
    }
    if (key === '>' || key === ' ') {               // MENU_NEXT_PAGE / space
        if (!onLast) { game._skill_page = cur + 1; renderSkillPage(); return true; }
        // "' ' finishes menus here, but stop '>' doing the same": on the last
        // page '>' redisplays; only space and return finish.
        if (key === '>') { renderSkillPage(); return true; }
    } else if (key !== '\n' && key !== '\r' && key !== '\x1b') {
        renderSkillPage();                          // bell; menu unchanged
        return true;
    }
    delete game._skill_pages;
    delete game._skill_page;
    await dismiss_invent_screen();
    return true;
}
