// insight.js — the ^X / end-of-game enlightenment display.
//
// C ref: src/insight.c enlightenment() and its section helpers
// (background_enlightenment / basics_enlightenment /
// characteristics_enlightenment / status_enlightenment).  doattributes()
// invokes enlightenment(BASICENLIGHTENMENT, ENL_GAMEINPROGRESS) for normal
// play, so only the BASIC sections (no intrinsics) are shown; wizard/explore
// add MAGICENLIGHTENMENT, which is out of scope for the public sessions.
//
// This produces the exact lines the C build emits, formatted the way the tty
// menu window renders them: enlght_out() lines have no leading space (the menu
// adds one selector column), while enlght_line()/you_are()/you_have() lines
// already carry the leading space that C's `Sprintf(" %s%s%s%s.", …)` prepends.

import { game } from './gstate.js';
import { roles, align_gname } from './role.js';
import {
    A_STR, A_INT, A_WIS, A_DEX, A_CON, A_CHA,
    A_LAWFUL, A_NEUTRAL, A_CHAOTIC,
    ROLE_MALE, ROLE_FEMALE, ROLE_GENDMASK,
    G_GONE, G_GENOD, G_EXTINCT,
    P_NONE, P_ISRESTRICTED, P_UNSKILLED, P_SKILLED, P_TWO_WEAPON_COMBAT,
    P_BARE_HANDED_COMBAT, In_quest, In_endgame, Is_knox_level,
} from './const.js';
import { objects as mkobjObjects } from './mkobj.js';
import { weapon_type } from './weapon.js';
import { p_skill_of } from './enhance.js';
import { update_topl } from './display.js';
import { phase_of_the_moon, friday_13th, night, NEW_MOON, FULL_MOON } from './calendar.js';
import { race_attrmax } from './u_init.js';
import { acurr_eff } from './attrib.js';
import { depth } from './hacklib.js';
import { endgamelevelname } from './dungeon.js';
import { newuexp, has_innate, innate_source, rank_of } from './exper.js';
import { youHaveSearching, youHaveFast, youHaveVeryFast } from './allmain.js';
import { Infravision, Blind } from './vision.js';
import { objects as OBJECTS } from './mkobj.js';
import { MFLAGS2, M2_PNAME } from './monflags_data.js';
const G_UNIQ = 0x1000; // monflag.h
import { magic_negation_hero } from './monmove.js';

// insight.c:1803 mc_types[] — indexed by magic_negation()'s result.
const MC_TYPES = ['', 'warded', 'guarded', 'protected'];
const W_ARMOR_MASK = 0x7f; // monst.h W_ARMOR: the seven armour slots
// C ref: prop.h Antimagic == EAntimagic || HAntimagic.  The extrinsic is worn
// gear with oc_oprop ANTIMAGIC; no session grants the intrinsic.
function Antimagic() {
    for (const o of (game.invent || []))
        if ((o.owornmask || 0) & W_ARMOR_MASK) {
            if (OBJECTS[o.otyp]?.oc_oprop === 12 /* ANTIMAGIC */) return true;
        }
    return !!(game.u?.HAntimagic);
}

// The four owornmask groups from_what()/cause_known() scan.  These are
// js/invent.js's REMAPPED W_* bits, not prop.h's — see that file's header.
const W_GIVES_PROP = W_ARMOR_MASK | 0x00020000 /*W_RINGL*/ | 0x00040000 /*W_RINGR*/
                     | 0x00080000 /*W_AMUL*/ | 0x00100000 /*W_TOOL*/;
// C ref: attrib.c what_gives(&u.uprops[propidx].extrinsic) — the worn item
// whose oc_oprop is `propidx`, or null.
function what_gives(propidx) {
    for (const o of (game.invent || []))
        if (((o.owornmask || 0) & W_GIVES_PROP) && OBJECTS[o.otyp]?.oc_oprop === propidx)
            return o;
    return null;
}
// C ref: prop.h <Prop> == E<Prop> || H<Prop>.  hkey names the u.uprops mirror
// this port stores the intrinsic under (several modules write game.u[hkey]
// directly, so both spellings are read).
function haveProp(propidx, hkey) {
    if (what_gives(propidx)) return true;
    if (hkey && ((game.u?.uprops?.[hkey] || 0) || (game.u?.[hkey] || 0))) return true;
    return !!(hkey && has_innate(hkey));
}
const TIMEOUT_MASK = 0x00ffffff; // prop.h TIMEOUT
// C ref: insight.c cause_known(propindx) — a WORN armour/amulet/ring/tool
// whose oc_oprop is propindx and whose type the hero has identified.
function cause_known(propidx) {
    for (const o of (game.invent || []))
        if (((o.owornmask || 0) & W_GIVES_PROP) && OBJECTS[o.otyp]?.oc_oprop === propidx
            && OBJECTS[o.otyp]?.oc_name_known && o.dknown)
            return true;
    return false;
}
// C ref: attrib.c:904 from_what(propidx) — wizard mode only; picks the most
// significant source.  is_innate() outranks what_gives(), and innately()
// (attrib.c:864) itself ranks the role/race tables above a FROMOUTSIDE
// intrinsic.  The three phrasings are attrib.c:939-944: FROM_ROLE (a role row
// at ulevel 1) and FROM_RACE both read " innately", a FROMOUTSIDE intrinsic
// reads " intrinsically", and a role row at ulevel 2+ reads " because of your
// experience".  This had " intrinsically" on the ulevel-1 arm, so a Barbarian's
// level-1 poison resistance read "intrinsically" instead of "innately"
// (seed0373 step 119), and an elf's level-4 sleep resistance would have read
// "because of your experience".
// NOT ported: attrib.c:949's Very_fast arm, which names the potion/spell or the
// speed boots; what_gives() below finds worn speed boots by oc_oprop anyway.
function from_what(propidx, hkey) {
    if (!_wizard()) return '';
    if (hkey) {
        // C ref: attrib.c:887 is_innate() — "can't become very fast innately",
        // so worn/timed speed suppresses the innate answer for FAST.
        const suppress = (propidx === FAST_PROP && youHaveVeryFast());
        const src = suppress ? null : innate_source(hkey);
        if (src === 'role' || src === 'race') return ' innately';
        if (src === 'exp') return ' because of your experience';
        if (!src && (game.u?.uprops?.[hkey] || game.u?.[hkey])) return ' intrinsically';
    }
    const o = what_gives(propidx);
    return o ? ` because of ${ysimple_name(o)}` : '';
}
// C ref: prop.h FAST = 64.
const FAST_PROP = 64;
import { LL_WISH, LL_ACHIEVE, LL_UMONST, LL_DIVINEGIFT, LL_LIFESAVE,
         LL_ARTIFACT, LL_GENOCIDE, LL_DUMP, LL_SPOILER, LL_MINORAC,
         livelog_printf } from './livelog.js';
import { nhgetch } from './input.js';
import { can_pray_quiet } from './pray.js';
import { inv_weight, ysimple_name } from './invent.js';
const _wizard = () => !!(game.flags && game.flags.debug);
const _discover = () => { const f = game.flags || {}; return !!(f.explore || f.discover || f.playmode === 'explore'); };

// C ref: insight.c:287 attrval().  Three arms only, and the last one covers
// v == STR18(100) == 118: C's own comment there reads 'simplify "18/\**" to be
// "18/100"', and `Sprintf("18/%02d", 118 - 18)` gives "18/100".  "18/**" is
// botl.c's STATUS-LINE spelling, not insight's, so special-casing 118 here made
// every 18/100-strength hero's ^X and disclosure Characteristics line wrong.
function attrval(attrindx, v) {
    if (attrindx !== A_STR || v <= 18) return String(v);
    if (v > 118) return String(v - 100);   // 19..25
    return `18/${String(v - 18).padStart(2, '0')}`;
}

// C ref: hacklib.c an() — indefinite article (sufficient for the role rank,
// dungeon and weapon strings reached here).
function an(s) {
    if (!s) return s;
    return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`;
}

// C ref: attrib.c from_what(ANTIMAGIC) — wizard mode only; the worn item that
// grants it (what_gives -> ysimple_name).
function _fromWhatAntimagic() {
    if (!(game.flags && game.flags.debug)) return '';
    for (const o of (game.invent || []))
        if ((o.owornmask || 0) & W_ARMOR_MASK)
            if (OBJECTS[o.otyp]?.oc_oprop === 12) return ` because of your ${OBJECTS[o.otyp].name}`;
    return '';
}

function alignStr(t) {
    return t === A_LAWFUL ? 'lawful' : t === A_NEUTRAL ? 'neutral' : 'chaotic';
}

const GENDER_ADJ = ['male', 'female'];

// Build the enlightenment text lines.  Returns an array of strings (already
// containing their own leading-space prefixes; section headers have none).
// `final` mirrors C's enlightenment(mode, final): 0 = ENL_GAMEINPROGRESS (the
// live ^X command, present tense, BASIC sections only); ENL_GAMEOVERDEAD (2)
// = the end-of-game disclosure (past tense, plus the MAGICENLIGHTENMENT
// "Final Attributes:" section) -- the only non-zero value the covered
// sessions reach.
export function enlightenment_lines(final = 0) {
    const u = game.u || {};
    const rolemnum = game.urole?.mnum ?? u.umonnum ?? 9;
    const roleDef = roles.find((r) => r.mnum === rolemnum) || roles[rolemnum] || {};
    // align_gname()/godForAlign() index the roles[] ARRAY (not the PM_ mnum,
    // which differs for Rogue/Ranger), so resolve the array index here.
    const roleArrIdx = roles.findIndex((r) => r.mnum === rolemnum);
    const roleIdx = roleArrIdx >= 0 ? roleArrIdx : rolemnum;
    const female = !!game.flags?.female;
    const innategend = female ? 1 : 0;

    const plname = game.flags?.debug ? 'wizard' : (game.plname || 'Player');
    const titleName = capFirst(plname);
    const roleName = (female && roleDef.name?.f) ? roleDef.name.f : roleDef.name?.m || 'Adventurer';
    const rankName = game.urole?.rank?.m || roleDef.rank?.[0]?.m || roleName;
    const raceAdj = game.urace?.adj || game.urace?.noun || 'human';
    const raceNoun = game.urace?.noun || game.urace?.name || 'human';
    const aligntype = u.ualign?.type ?? A_NEUTRAL;
    const ulevel = u.ulevel ?? 1;
    const moves = game.moves ?? 1;

    const lines = [];
    const out = (s) => lines.push(s);          // enlght_out: header / raw line
    // enlght_line: " <start><mid><suffix><ps>." with not-contractions applied
    // (C ref: insight.c enlght_line()'s notwochars[] table -- both present-
    // and past-tense pairs, since `final` selects which verb enlLine() gets).
    const enlLine = (start, mid, suffix, ps) => {
        let buf = ` ${start}${mid}${suffix}${ps}.`;
        buf = buf.replace(' are not ', ' aren\'t ').replace(' were not ', ' weren\'t ')
            .replace(' have not ', ' haven\'t ').replace(' had not ', ' hadn\'t ')
            .replace(' can not ', ' can\'t ').replace(' could not ', ' couldn\'t ');
        out(buf);
    };
    const youAre = (attr, ps = '') => enlLine('You ', final ? 'were ' : 'are ', attr, ps);
    const youHave = (attr, ps = '') => enlLine('You ', final ? 'had ' : 'have ', attr, ps);

    // ── title ──
    // Headers/title are enlght_out() lines (no leading space); the tty menu
    // window supplies the single selector-column space when rendered.
    out(`${titleName} the ${roleName}'s attributes:`);

    // ── Background ──
    out('');
    out('Background:');

    // role + rank
    let gendpfx = '';
    if (!roleDef.name?.f
        && (((roleDef.allow ?? 0) & ROLE_GENDMASK) === (ROLE_MALE | ROLE_FEMALE)))
        gendpfx = `${GENDER_ADJ[innategend]} `;
    let roleBuf;
    if (rankName.toLowerCase() === roleName.toLowerCase())
        roleBuf = `${an(rankName)}, level ${ulevel} ${gendpfx}${raceNoun}`;
    else
        roleBuf = `${an(rankName)}, a level ${ulevel} ${gendpfx}${raceAdj} ${roleName}`;
    youAre(roleBuf);

    // alignment + pantheon (bypasses you_are to omit ending period)
    out(` You ${final ? 'were' : 'are'} ${alignStr(aligntype)}, on a mission for ${align_gname(roleIdx, aligntype)}`);
    let pan = ` who ${final ? 'was' : 'is'} opposed by`;
    if (aligntype !== A_LAWFUL)
        pan += ` ${align_gname(roleIdx, A_LAWFUL)} (${alignStr(A_LAWFUL)}) and`;
    if (aligntype !== A_NEUTRAL)
        pan += ` ${align_gname(roleIdx, A_NEUTRAL)} (${alignStr(A_NEUTRAL)})${aligntype !== A_CHAOTIC ? ' and' : ''}`;
    if (aligntype !== A_CHAOTIC)
        pan += ` ${align_gname(roleIdx, A_CHAOTIC)} (${alignStr(A_CHAOTIC)})`;
    pan += '.';
    out(pan);

    // handedness (URIGHTY defaults TRUE)
    youAre(`${game.u?.uleft_handed ? 'left' : 'right'}-handed`);

    // dungeon level  (C ref: insight.c background_enlightenment)
    // The name comes from dungeons[u.uz.dnum].dname, with a leading "The "
    // downcased to "the "; the level number is depth(&u.uz) — the ledger depth
    // across branches, so e.g. Sokoban level 1 reads "level 2" — except within
    // the Quest, which shows the branch-relative dunlev.  (C's rogue /
    // very-big-room annotations are not exercised by the covered sessions.)
    if (In_endgame(u.uz)) {
        // C ref: insight.c:604-609 — the endgame arm names the plane instead of
        // a level number; endgamelevelname() (dungeon.c:3410) maps
        // observable_depth() (== depth()) -5..-1 to Astral / Water / Fire / Air
        // / Earth, and insight.c prefixes "Elemental " to every "Plane ..." name
        // (so the Astral Plane keeps its bare name).
        const nm = endgamelevelname(depth(u.uz));
        youAre(`in the endgame, on the ${nm.startsWith('Plane') ? 'Elemental ' : ''}${nm}`);
    } else if (Is_knox_level(u.uz)) {
        // C ref: insight.c:610-612 — "this gives away the fact that the knox
        // branch is only 1 level".
        youAre(`on the ${game.dungeons?.[u.uz?.dnum ?? 0]?.dname || ''} level`);
    } else {
        const dnum = u.uz?.dnum ?? 0;
        let dgnName = game.dungeons?.[dnum]?.dname || 'The Dungeons of Doom';
        if (/^the /i.test(dgnName))
            dgnName = dgnName.charAt(0).toLowerCase() + dgnName.slice(1);
        const dgnLevel = In_quest(u.uz) ? (u.uz?.dlevel ?? 1) : depth(u.uz);
        youAre(`in ${dgnName}, on level ${dgnLevel}`);
    }

    // turns
    if (moves === 1) youHave('just started your adventure');
    else enlLine('You ', 'entered ', `the dungeon ${moves} turn${moves === 1 ? '' : 's'} ago`, '');

    // ── other environmental factors ──  C ref: insight.c
    // background_enlightenment().  C tests midnight()/night() first (the
    // "midnight hour"/"nighttime" line); midnight() has no JS helper, so only
    // the nighttime line is modeled (a no-op for daytime sessions).  Then the
    // moon phase and Friday-the-13th status are reported, in that order, BEFORE
    // the experience-point line.
    if (night())
        enlLine('It ', final ? 'was ' : 'is ', 'nighttime', '');
    const moonphase = phase_of_the_moon();
    if (moonphase === FULL_MOON || moonphase === NEW_MOON) {
        // C: Sprintf(buf, "a %s moon in effect%s", ..., "") -> enl_msg("There ",
        // "is ", "was ", buf, "").  "in effect" (not "tonight") because the phase
        // is the start-of-session value, not necessarily the current real time.
        const which = (moonphase === FULL_MOON) ? 'full' : 'new';
        // insight.c:668 — the game-over pass appends " when your adventure ended".
        const when = final ? ' when your adventure ended' : '';
        enlLine('There ', final ? 'was ' : 'is ', `a ${which} moon in effect${when}`, '');
    }
    if (friday_13th()) {
        // insight.c:678 — a raw enlght_out() line (own leading space, no
        // trailing you-are period).  ENL_GAMEOVERALIVE == 1, DEAD == 2.
        const did = !final ? 'can happen'
            : (final === 1) ? 'could have happened' : 'happened';
        out(` Bad things ${did} on Friday the 13th.`);
    }

    // experience (not polymorphed).  C ref: insight.c background_enlightenment —
    // for a sub-30 experience level, wizard mode OR the game-over 'final' pass
    // appends how much more experience is needed to reach the next level.
    // doattributes() runs with final==0, so only the wizard branch applies there.
    const uexp = u.uexp ?? 0;
    const xlvl = u.ulevel ?? 1;
    let expbuf = `${uexp} experience point${uexp === 1 ? '' : 's'}`;
    if (xlvl < 30 && (final || !!game.flags?.debug)) {
        const delta = newuexp(xlvl) - uexp;
        const wasWere = !final ? '' : (delta === 1 ? 'was ' : 'were ');
        expbuf += `, ${delta} ${uexp > 0 ? 'more ' : ''}${wasWere}`
            + `needed ${xlvl < 18 ? 'to attain' : 'for'} level ${xlvl + 1}`;
    }
    youHave(expbuf);

    // ── Basics ──
    out('');
    out('Basics:');
    const hp = Math.max(0, u.uhp ?? 0), hpmax = u.uhpmax ?? 0;
    if (hp === hpmax && hpmax > 1) youHave(`all ${hpmax} hit points`);
    else youHave(`${hp} out of ${hpmax} hit point${hpmax === 1 ? '' : 's'}`);

    const pw = u.uen ?? 0, pwmax = u.uenmax ?? 0;
    const Power = 'energy points (spell power)';
    if (pwmax === 0 || (pw === pwmax && pwmax === 2))
        youHave(`${!pwmax ? 'no' : 'both'} ${Power}`);
    else if (pw === pwmax && pwmax > 2) youHave(`all ${pwmax} ${Power}`);
    else youHave(`${pw} out of ${pwmax} ${Power}`);

    // armor class (enl_msg: "Your armor class " + "is " + value)
    enlLine('Your armor class ', final ? 'was ' : 'is ', `${u.uac ?? 0}`, '');

    // wallet (bypasses you_have; leading space already supplied)
    const umoney = game._goldCount ?? u.umoney ?? 0;
    out(umoney ? ` Your wallet contain${final ? 'ed' : 's'} ${umoney} ${currency(umoney)}.`
               : ` Your wallet ${final ? 'was' : 'is'} empty.`);

    // autopickup.  C ref: insight.c basics_enlightenment() — when on, names
    // the pickup_types restriction (oc_to_str(flags.pickup_types, ocl), or
    // "all types" when unset) and appends "plus thrown" when pickup_thrown
    // applies to a non-empty restriction.  costly_spot (shop suppression) and
    // the apelist exceptions clause are both omitted -> always the "else"/
    // unset case (shops aren't modeled here; exceptions are always empty,
    // see doset.js "autopickup exceptions   [(0 currently set)]").
    let apbuf;
    if (game.flags?.pickup) {
        const ocl = game.flags.pickup_types || '';
        apbuf = `on for ${ocl ? `'${ocl}'` : 'all types'}`;
        if ((game.flags.pickup_thrown ?? true) && ocl) apbuf += ' plus thrown';
    } else {
        apbuf = 'off';
    }
    enlLine('Autopickup ', final ? 'was ' : 'is ', apbuf, '');

    // ── Characteristics ──
    // C ref: insight.c one_characteristic() — the value plus, when the innate
    // value is worth showing (not polymorphed / no relevant cursed item, all out
    // of scope for BASIC play here), a parenthetical noting base/peak (when the
    // effective value differs from the stored base or the peak) and the race
    // limit (when it differs from the human default: 18, or STR18(100) for STR).
    // acurrent = ACURR (effective), abase = ABASE (u.acurr.a), apeak = AMAX
    // (u.amax.a), alimit = ATTRMAX = race attrmax.
    out('');
    out(final ? 'Final Characteristics:' : 'Characteristics:');
    const abaseArr = u.acurr?.a || [];
    const apeakArr = u.amax?.a || [];
    const limitArr = race_attrmax();
    const characteristic = (idx, name) => {
        const acurrent = acurr_eff(idx);
        const abase = abaseArr[idx] ?? acurrent;
        const apeak = apeakArr[idx] ?? abase;
        const alimit = limitArr[idx] ?? 18;
        // C ref: one_characteristic() — interesting_alimit is TRUE unconditionally
        // in final disclosure (it was originally `abase != alimit`); only the
        // in-progress path restricts it to a non-default race limit.
        const interesting = final
            ? true
            : alimit !== (idx !== A_STR ? 18 : 118 /* STR18(100) */);
        let valubuf = attrval(idx, acurrent);
        let paren = final ? ' (' : ' (current; ';
        if (acurrent !== abase) {
            valubuf += `${paren}base:${attrval(idx, abase)}`;
            paren = ', ';
        }
        if (abase !== apeak) {
            valubuf += `${paren}peak:${attrval(idx, apeak)}`;
            paren = ', ';
        }
        if (interesting)
            valubuf += `${paren}${acurrent > alimit ? 'innate ' : ''}limit:${attrval(idx, alimit)}`;
        if (acurrent !== abase || abase !== apeak || interesting)
            valubuf += ')';
        enlLine(`Your ${name} `, final ? 'was ' : 'is ', valubuf, '');
    };
    characteristic(A_STR, 'strength');
    characteristic(A_DEX, 'dexterity');
    characteristic(A_CON, 'constitution');
    characteristic(A_INT, 'intelligence');
    characteristic(A_WIS, 'wisdom');
    characteristic(A_CHA, 'charisma');

    // ── Status ──
    out('');
    out(final ? 'Final Status:' : 'Status:');
    // C ref: insight.c:1073 — `if (Deaf) you_are("deaf", from_what(DEAF));`,
    // emitted BEFORE the hunger line.
    if (((u.uprops?.HDeaf || 0) > 0) || u.Deaf) youAre('deaf');
    // C ref: insight.c:1181 — Sleepy (worn/eaten amulet of restful sleep),
    // emitted immediately before the hunger line.  cause_known() is bypassed
    // whenever MAGICENLIGHTENMENT is on, which end-of-game disclosure always is.
    if (haveProp(27 /*SLEEPY*/, 'HSleepy')
        && (final || _wizard() || _discover() || cause_known(27))) {
        let sb = from_what(27, 'HSleepy');
        if (_wizard()) sb += ` (${(u.HSleepy || 0) & TIMEOUT_MASK})`;
        enlLine('You ', final ? 'fell' : 'fall', ' asleep uncontrollably', sb);
    }
    // hunger: hu_stat[u.uhs]; NOT_HUNGRY (1) -> "not hungry" at game start.
    // C ref: insight.c:1146 — wizard mode appends the raw u.uhunger.
    {
        let hb = hungerWord(u.uhs ?? 1);
        if (_wizard()) hb += ` <${u.uhunger ?? 900}>`;
        youAre(hb);
    }
    // C ref: insight.c:1212 — only the UNENCUMBERED else-arm says
    // "unencumbered"; anything heavier is "<enc>; movement is <adj> slowed".
    {
        const cap = game._curcap | 0;
        if (cap > 0) {
            const encWords = ['', 'Burdened', 'Stressed', 'Strained', 'Overtaxed', 'Overloaded'];
            const adjs = ['', 'slightly', 'moderately', 'very', 'extremely', 'not possible'];
            const w = encWords[cap].charAt(0).toLowerCase() + encWords[cap].slice(1);
            youAre(`${w}; movement ${final ? 'was' : 'is'} ${adjs[cap]}${cap < 5 ? ' slowed' : ''}`);
        } else {
            // wizard mode appends the carried weight (insight.c:1218).
            youAre(_wizard() ? `unencumbered <${inv_weight()}>` : 'unencumbered');
        }
    }
    // current weapon + skill
    weaponInsight(youAre, youHave, enlLine);
    // C ref: status_enlightenment() tail — "report 'nudity'": no armor worn at
    // all (the covered heroes never have uroleplay.nudist set).
    if (!game.uarm && !game.uarmu && !game.uarmc && !game.uarms
        && !game.uarmg && !game.uarmf && !game.uarmh)
        youAre('not wearing any armor');

    // ── Attributes (MAGICENLIGHTENMENT) ──  C ref: attributes_enlightenment().
    // Only reached at end-of-game disclosure (final) for the covered sessions;
    // limited to what the covered heroes can actually have: alignment piety,
    // role-granted Searching, racial Infravision, and the mortality line.
    // C ref: insight.c doattributes() — wizard AND explore mode also pass
    // MAGICENLIGHTENMENT for the LIVE ^X, so the section is not final-only; its
    // header is then "Attributes:" and it omits the mortality line.
    const _magic = final ? true : (_wizard() || _discover());
    if (_magic) {
        out('');
        out(final ? 'Final Attributes:' : 'Attributes:');
        const pio = piousness(u.ualign?.record ?? 0);
        if ((u.ualign?.record ?? 0) >= 0) youAre(pio);
        else youHave(pio);
        if (_wizard()) enlLine('Your alignment ', final ? 'was' : 'is', ` ${u.ualign?.record ?? 0}`, '');
        // /*** Resistances to troubles ***/  insight.c:1520.  The ORDER of this
        // block through /*** Transportation ***/ is load-bearing: a line in the
        // wrong place shifts every later line and the text window's page break.
        // insight.c:1523 — Antimagic is worn gear whose oc_oprop is ANTIMAGIC
        // (gray DSM/scales, cloak of magic resistance) plus the intrinsic.
        // from_what() adds a suffix only in wizard mode.
        if (Antimagic()) youAre('magic-protected', _fromWhatAntimagic());
        for (const [propidx, hkey, phrase] of [
            [1, 'HFire_resistance', 'fire resistant'],
            [2, 'HCold_resistance', 'cold resistant'],
            [3, 'HSleep_resistance', 'sleep resistant'],
            [4, 'HDisint_resistance', 'disintegration resistant'],
            [5, 'HShock_resistance', 'shock resistant'],
            [6, 'HPoison_resistance', 'poison resistant'],
            [7, 'HAcid_resistance', 'acid resistant'],
            [9, 'HDrain_resistance', 'level-drain resistant'],
            [10, 'HSick_resistance', 'immune to sickness'],
            [8, 'HStone_resistance', 'petrification resistant'],
        ]) if (haveProp(propidx, hkey)) youAre(phrase, from_what(propidx, hkey));
        // /*** Vision and senses ***/  insight.c:1565
        if (haveProp(29, 'HSee_invisible')) {
            // C's third arm (PermaBlind) has no source in this port.
            if (!Blind()) enlLine('You ', final ? 'saw' : 'see', ' invisible', from_what(29, 'HSee_invisible'));
            else enlLine('You ', final ? 'would have seen' : 'will see', ' invisible when not blind', '');
        }
        if (haveProp(31, 'HWarning')) youAre('warned', from_what(31, 'HWarning'));
        if (youHaveSearching() || haveProp(34, 'HSearching'))
            youHave('automatic searching', from_what(34, 'HSearching'));
        if (Infravision() || haveProp(36, 'HInfravision')) youHave('infravision');
        // /*** Appearance and behavior ***/  insight.c:1643
        if (haveProp(42, 'HStealth')) youAre('stealthy', from_what(42, 'HStealth'));
        if (haveProp(43, 'HAggravate_monster'))
            enlLine('You aggravate', final ? 'd' : '', ' monsters', from_what(43, 'HAggravate_monster'));
        // /*** Transportation ***/  insight.c:1677
        if (haveProp(47, 'HTeleport_control'))
            youHave('teleport control', from_what(47, 'HTeleport_control'));
        // insight.c:1800 — the worn-armour magic-cancellation level.
        const armpro = magic_negation_hero();
        if (armpro > 0) youAre(MC_TYPES[Math.min(armpro, MC_TYPES.length - 1)]);
        // C ref: insight.c:1896-1898 "movement and non-armor-based protection"
        // — `if (Fast) you_are(Very_fast ? "very fast" : "fast",
        // from_what(FAST));`, between the magic-cancellation line and Miscellany.
        // Omitting it shifted every later line of the ^X page (seed0373 step 119).
        if (youHaveFast() || youHaveVeryFast())
            youAre(youHaveVeryFast() ? 'very fast' : 'fast', from_what(FAST_PROP, 'HFast'));

        // C ref: insight.c:1908 /*** Miscellany ***/ — the Luck block, which
        // was omitted entirely.  Luck = u.uluck + u.moreluck, and it is non-zero
        // for any full-moon / Friday-13th game (allmain.c:59 change_luck(1)).
        const luckTot = (u.uluck || 0) + (u.moreluck || 0);
        if (luckTot) {
            const lt = Math.abs(luckTot);
            youAre(`${lt >= 10 ? 'extremely ' : lt >= 5 ? 'very ' : ''}${luckTot < 0 ? 'un' : ''}lucky`);
        }
        if ((u.moreluck || 0) > 0) youHave('extra luck');
        else if ((u.moreluck || 0) < 0) youHave('reduced luck');
        // insight.c:1917 — wizard mode states a zero Luck explicitly.
        if (_wizard() && !(u.uluck || 0)) enlLine('Your luck ', final ? 'was' : 'is', ' zero', '');
        // insight.c:1934 — the live ^X reports whether prayer is safe.
        if (!final) {
            let pb = `${can_pray_quiet() ? '' : 'not '}safely pray`;
            if (_wizard()) pb += ` (${u.ublesscnt ?? 0})`;
            enlLine('You ', 'can ', pb, '');
        }
        // C ref: enlightenment() tail — "have been killed .../are dead" via
        // u.umortality; the covered death path always has umortality === 1.
        if (final) out(' You are dead.');
    }

    // ── Miscellaneous ──
    out('');
    out('Miscellaneous:');
    // C ref: enlightenment() — bones-level reminder, shown for BASIC mode in
    // wizard/explore/final; flags.bones defaults on and no session has visited
    // a bones level yet, so this is always the "didn't encounter any" form.
    if (_wizard() || _discover() || final) {
        if (_wizard() || _discover())
            youAre(`running in ${_wizard() ? 'debug' : 'explore'} mode`);
        if (game.flags?.bones === false)
            youHave('disabled loading and storing of bones levels');
        else if (!u.numbones)
            enlLine('You ', final ? 'didn\'t encounter' : 'haven\'t encountered', ' any bones levels', '');
        else
            youHave(`encountered ${u.numbones} bones level${u.numbones === 1 ? '' : 's'}`);
    }
    // elapsed playing time (none at game start; matches fmt_elapsed_time)
    enlLine('Total elapsed playing time ', final ? 'was ' : 'is ', elapsedTime(), '');

    return lines;
}

// C ref: insight.c piousness(showneg, suffix) — alignment-piety adjective
// ("aligned" suffix), used by attributes_enlightenment().  showneg is TRUE
// there, but the covered heroes' record is always non-negative.
function piousness(record) {
    let pio;
    if (record >= 20) pio = 'piously';
    else if (record > 13) pio = 'devoutly';
    else if (record > 8) pio = 'fervently';
    else if (record > 3) pio = 'stridently';
    else if (record === 3) pio = '';
    else if (record > 0) pio = 'haltingly';
    else if (record === 0) pio = 'nominally';
    else if (record >= -3) pio = 'strayed';
    else if (record >= -8) pio = 'sinned';
    else pio = 'transgressed';
    if (record >= 0) return record === 3 ? 'aligned' : `${pio} aligned`;
    return pio;
}

// C ref: wield.c empty_handed() — how a weaponless hero is described: gloves
// imply hands so "empty handed"; a gloveless humanoid is "bare handed";
// otherwise (paws / no hands from an exotic polyform, never reached here) "not
// wielding anything".
function empty_handed() {
    if (game.uarmg) return 'empty handed';
    // The starter heroes are humanoid (only an exotic polyself would not be).
    return 'bare handed';
}

// C ref: weapon.c is a Monk-only discipline — martial arts is the only role
// that trains P_MARTIAL_ARTS, so the bare-handed skill reads "martial arts" for
// a Monk and "bare handed combat" for everyone else.
function isMartialArtsRole() {
    const rn = (game.urole?.name?.m || '').toLowerCase();
    return rn === 'monk';
}

// C ref: weapon.c skill_level_name() lower-cased — proficiency-level word.
const SKILL_LVL_NAME = {
    1: 'unskilled', 2: 'basic', 3: 'skilled', 4: 'expert',
    5: 'master', 6: 'grand master',
};
function skillLevelNameLc(lvl) { return SKILL_LVL_NAME[lvl] || 'unknown'; }

// C ref: insight.c weapon_insight() — wielding line + weapon skill level.
function weaponInsight(youAre, youHave, enlLine) {
    const uwep = game.uwep;
    if (!uwep) {
        // C: you_are(empty_handed(), "").
        youAre(empty_handed());
        // C: weapon_type(0) == P_BARE_HANDED_COMBAT, always reported.
        // skill_init() gives Monks P_BASIC bare-handed skill at game start
        // (their P_MAX_SKILL for it exceeds P_EXPERT); everyone else starts
        // P_UNSKILLED.  The "and can enhance that" clause needs skill-practice
        // tracking (can advance is false for a fresh hero), so it's omitted.
        const skName = isMartialArtsRole() ? 'martial arts' : 'bare handed combat';
        const lvl = skillLevelNameLc(p_skill_of(P_BARE_HANDED_COMBAT));
        const hav = lvl !== 'unskilled' && lvl !== 'skilled';
        if (hav) youHave(`${lvl} skill with ${skName}`);
        else youAre(`${lvl} in ${skName}`);
        return;
    }

    // C ref: insight.c weapon_insight() — while dual-wielding, a single
    // "wielding two weapons at once" line replaces the "wielding a <weapon>".
    if (game.u?.twoweap) {
        youAre('wielding two weapons at once');
    } else {
        const descr = weaponDescr(uwep);
        youAre(`wielding ${uwep.quan === 1 || uwep.quan == null ? an(descr) : makeplural(descr)}`);
    }

    const skName = weaponSkillName(uwep);
    if (!skName) return;

    if (!game.u?.twoweap) {
        // C ref: insight.c:1315 — sklvl = P_SKILL(wtype); P_ISRESTRICTED prints
        // "no" (and still counts as hav, so it reads "have no skill with").
        const sklvl = p_skill_of(weapon_type(uwep));
        const hav = (sklvl !== P_UNSKILLED && sklvl !== P_SKILLED);
        const lvl = (sklvl === P_ISRESTRICTED) ? 'no' : skillLevelNameLc(sklvl);
        const buf = `${lvl} ${hav ? 'skill with' : 'in'} ${skName}`;
        if (hav) youHave(buf); else youAre(buf);
        return;
    }

    // C ref: insight.c weapon_insight() two-weapon block — compare the primary
    // and secondary weapon skills against the two-weapon-combat skill; whichever
    // is weaker limits the pair.  (The "and can enhance ..." advice needs skill-
    // slot tracking, which is 0 for the fresh-hero state we model, so the
    // can_advance() lines are omitted, consistent with the non-twoweap path.)
    const wtype = weapon_type(uwep);
    const uswapwep = game.uswapwep;
    const wtype2 = uswapwep ? weapon_type(uswapwep) : P_NONE;
    const sklvl = p_skill_of(wtype);
    const sklvl2 = uswapwep ? p_skill_of(wtype2) : P_ISRESTRICTED;
    let twoskl = p_skill_of(P_TWO_WEAPON_COMBAT);
    let twobuf;
    if (twoskl === P_ISRESTRICTED) { twoskl = P_UNSKILLED; twobuf = 'restricted'; }
    else twobuf = skillLevelNameLc(twoskl);
    const hav = (sklvl !== P_UNSKILLED && sklvl !== P_SKILLED);
    const hav2 = (sklvl2 !== P_UNSKILLED && sklvl2 !== P_SKILLED);
    const sklvlbuf = (sklvl === P_ISRESTRICTED) ? 'no' : skillLevelNameLc(sklvl);

    let buf = `${sklvlbuf} ${hav ? 'skill with' : 'in'} ${skName}`;
    let pfx = '', sfx = '', also = '', also2 = '', also3 = false;
    if (twoskl < sklvl) {
        pfx = `Your skill in ${skName} `;
        sfx = ` limited by being ${twobuf} with two weapons`;
        also = 'also ';
    } else if (twoskl > sklvl) {
        pfx = 'Your two weapon skill ';
        sfx = ' limited by ';
        sfx += (sklvl > P_ISRESTRICTED) ? `being ${sklvlbuf}` : 'having no skill';
        sfx += ` with ${skName}`;
        also2 = 'also ';
    } else {
        buf += ' and two weapons';
        also3 = true;
    }
    if (pfx) enlLine(pfx, 'is', sfx, '');
    else if (hav) youHave(buf);
    else youAre(buf);

    // Skip the secondary comparison when it is identical to the primary one.
    if (wtype2 !== wtype) {
        const skName2 = weaponSkillName(uswapwep) || 'no skill';
        const sklvlbuf2 = skillLevelNameLc(sklvl2);
        let verb = 'is';
        pfx = ''; sfx = ''; buf = '';
        if (twoskl < sklvl2) {
            pfx = `Your skill in ${skName2} `;
            sfx = ` ${also}limited by being ${twobuf} with two weapons`;
        } else if (twoskl > sklvl2) {
            pfx = 'Your two weapon skill ';
            sfx = ` ${also2}limited by `;
            sfx += (sklvl2 > P_ISRESTRICTED) ? `being ${sklvlbuf2}` : 'having no skill';
            sfx += ` with ${skName2}`;
        } else {
            buf = `${sklvlbuf2} ${hav2 ? 'skill with' : 'in'} ${skName2} and two weapons`;
            if (also3) {
                pfx = 'You also ';
                sfx = ` ${buf}`; buf = '';
                verb = hav2 ? 'have' : 'are';
            }
        }
        if (pfx) enlLine(pfx, verb, sfx, '');
        else if (hav2) youHave(buf);
        else youAre(buf);
    }
}

// C ref: weapon.c skill_name(weapon_type(obj)) — describe a weapon by its skill
// class name (a katana reads "long sword", a dagger "dagger").  weapon_type is
// |oc_skill| (ammo's skill is the negated launcher skill).  P_NAME() uses the
// representative object's name except for a few PN_* overrides (saber, hammer,
// polearms, whip).  C ref: weapon.c skill_names_indices/odd_skill_names.
const SKILL_NAME_BY_NUM = {
    1: 'dagger', 2: 'knife', 3: 'axe', 4: 'pick-axe', 5: 'short sword',
    6: 'broadsword', 7: 'long sword', 8: 'two-handed sword', 9: 'saber',
    10: 'club', 11: 'mace', 12: 'morning star', 13: 'flail', 14: 'hammer',
    15: 'quarterstaff', 16: 'polearms', 17: 'spear', 18: 'trident', 19: 'lance',
    20: 'bow', 21: 'sling', 22: 'crossbow', 23: 'dart', 24: 'shuriken',
    25: 'boomerang', 26: 'whip', 27: 'unicorn horn',
};
// weapon_type() comes from js/weapon.js (weapon.c:1517).
function weaponDescr(obj) {
    return SKILL_NAME_BY_NUM[weapon_type(obj)] || obj.name || mkobjObjects?.[obj.otyp]?.name || 'weapon';
}
function weaponSkillName(obj) {
    return SKILL_NAME_BY_NUM[weapon_type(obj)] || null;
}

function makeplural(s) {
    if (/(s|x|z|ch|sh)$/.test(s)) return `${s}es`;
    if (/[^aeiou]y$/.test(s)) return `${s.slice(0, -1)}ies`;
    return `${s}s`;
}

// C ref: eat.c hu_stat[] (lower-cased; "" -> "not hungry").
const HU_STAT = ['Satiated', '', 'Hungry', 'Weak', 'Fainting', 'Fainted', 'Starved'];
function hungerWord(uhs) {
    let buf = HU_STAT[uhs] || '';
    if (!buf) buf = 'not hungry';
    buf = buf.charAt(0).toLowerCase() + buf.slice(1);
    if (buf === 'weak') buf += ' from severe hunger';
    else if (buf.startsWith('faint')) buf += ' due to starvation';
    return buf;
}

// C ref: hacklib.c — currency() pluralisation.
function currency(n) { return n === 1 ? 'zorkmid' : 'zorkmids'; }

// C ref: insight.c fmt_elapsed_time — "none" before any real_time accrues.
function elapsedTime() { return 'none'; }

function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// C ref: insight.c list_genocided(defquery, ask) — the #genocided command.
// For a game with no genocided or extinct species, C's non-final branch just
// prints "No creatures have been genocided." (the #genocided form passes
// genoing == FALSE so there is no " yet" suffix).  The full genocided/extinct
// species menu is only reachable after a genocide, which the covered sessions
// never perform.
export function anyGenocidedOrExtinct() {
    const mv = game.mvitals;
    if (!mv) return false;
    for (let i = 0; i < mv.length; i++) {
        if (mv[i] && (mv[i].mvflags & G_GONE)) return true;
    }
    return false;
}

// C ref: insight.c:2814 list_vanquished() — ntypes is the number of DISTINCT
// species with svm.mvitals[].died != 0 (any death, not just the hero's kills;
// mon.js mvitals_died() tallies it).  ntypes decides the prompt's allowed
// answers: ynaqchars when > 1, ynqchars otherwise (insight.c:2834), which is
// visible as "[ynaq]" vs "[ynq]" in the prompt.
export function vanquished_ntypes() {
    const mv = game.mvitals;
    if (!mv) return 0;
    let n = 0;
    for (let i = 0; i < mv.length; i++) if (mv[i]?.died) n++;
    return n;
}
export function anyVanquished() { return vanquished_ntypes() > 0; }

// C ref: insight.c:2784 list_vanquished(defquery, ask) — the "Vanquished
// creatures:" menu.  Only the DEFAULT sort (VANQ_MLVL_MNDX: mlevel high to low,
// tiebreak mndx low to high) is implemented; that is the only mode reachable
// without the 'a' answer's set_vanq_order() menu, and with it class_header and
// uniq_header are both false so there are no class/uniq separator lines.
export async function list_vanquished_screen() {
    const { monster_by_pmidx } = await import('./makemon.js');
    const { makeplural } = await import('./invent.js');
    const mv = game.mvitals || [];
    const idx = [];
    let total = 0;
    for (let i = 0; i < mv.length; i++)
        if (mv[i]?.died) { idx.push(i); total += mv[i].died; }
    if (!idx.length) return;
    idx.sort((a, b) => {
        const ma = monster_by_pmidx(a), mb = monster_by_pmidx(b);
        const r = (mb?.mlevel ?? 0) - (ma?.mlevel ?? 0);   // mlevel high to low
        return r !== 0 ? r : a - b;                        // tiebreak: mndx
    });
    const lines = ['Vanquished creatures:', ''];
    for (const i of idx) {
        const m = monster_by_pmidx(i);
        const name = m?.name || '';
        const n = mv[i].died;
        let buf;
        if ((m?.geno ?? 0) & G_UNIQ) {
            // type_is_pname() (M2_PNAME) suppresses the article.
            buf = `${is_pname(m) ? '' : 'the '}${name}`;
            if (n > 1) buf += ` (${N_times(n)})`;
        } else if (n === 1) {
            buf = an_word(name);
        } else {
            buf = `${String(n).padStart(3, ' ')} ${makeplural(name)}`;
        }
        // insight.c:2910 — leading spaces so the article lines up with a 3-digit
        // count column.
        const pfx = /^the /i.test(buf) ? 0 : /^an /i.test(buf) ? 1
            : /^a /i.test(buf) ? 2 : !/[0-9]/.test(buf[2] ?? '') ? 4 : 0;
        lines.push(' '.repeat(pfx) + buf);
    }
    if (idx.length > 1) {
        lines.push('');
        lines.push(`${total} creatures vanquished.`);
    }
    // C ref: insight.c:2862 list_vanquished() builds an NHW_MENU with putstr()
    // ONLY (no menu items), and tty_display_nhwindow() routes such a window
    // through process_text_window() — i.e. --More--, not "(end)".
    await render_menu_window(lines);
    for (;;) {
        const key = await nhgetch();
        if (key === 27 || key === 13 || key === 10 || key === 32) break;
    }
    const { flush_screen } = await import('./display.js');
    await flush_screen(1);
}
function an_word(s) { return /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`; }
// C ref: mondata.h type_is_pname(ptr) == (mflags2 & M2_PNAME).
function is_pname(m) { return ((MFLAGS2[m?.pmidx] ?? 0) & M2_PNAME) !== 0; }

// C ref: insight.c:2769 dovanquished() — the #vanquished command.
export async function dovanquished() {
    if (!vanquished_ntypes()) {
        game._pending_message = 'No creatures have been vanquished.';
        return 0;
    }
    await list_vanquished_screen();
    return 0;
}

// C ref: insight.c dogenocided() — the M-g / #genocided command.
export async function dogenocided() {
    if (!anyGenocidedOrExtinct()) {
        await update_topl('No creatures have been genocided.');
        return 0; // ECMD_OK
    }
    // The genocided/extinct species menu is unreached by the covered sessions.
    await update_topl('No creatures have been genocided.');
    return 0;
}

// C ref: insight.c LL_majors / majorevent()/spoilerevent() — the #chronicle
// filters.  LL_majors is the bitwise-or of the "always worth a dumplog entry"
// flags; spoilerevent is any message tagged LL_SPOILER.
const LL_majors = LL_WISH | LL_ACHIEVE | LL_UMONST | LL_DIVINEGIFT
    | LL_LIFESAVE | LL_ARTIFACT | LL_GENOCIDE | LL_DUMP;
function majorevent(msg) { return (msg.flags & LL_majors) !== 0; }
function spoilerevent(msg) { return (msg.flags & LL_SPOILER) !== 0; }

// C ref: insight.c show_gamelog(final) — the #chronicle details window.  Builds
// "Logged events:" / "Major events:" (unused here; 'final' end-of-game dumplog
// path isn't reached by the covered sessions) followed by a " Turn" header and
// one "%5ld: %s" line per surviving gg.gamelog entry, in a full-screen NHW_TEXT
// window paged with "--More--".
async function show_gamelog(final) {
    const lines = [`${final ? 'Major' : 'Logged'} events:`];
    const wizard = !!game.flags?.debug;
    let eventcnt = 0;
    for (const msg of (game.gamelog || [])) {
        if (final && !majorevent(msg)) continue;
        if (!final && !wizard && spoilerevent(msg)) continue;
        if (!eventcnt++) lines.push(' Turn');
        lines.push(`${String(msg.turn).padStart(5)}: ${msg.text}`);
    }
    if (!eventcnt) lines.push(' none');
    const { display_text_window } = await import('./pager.js');
    await display_text_window(lines);
}

// C ref: insight.c do_gamelog() — the #chronicle command.
export async function do_gamelog() {
    if (game.gamelog && game.gamelog.length) {
        await show_gamelog(false);
    } else {
        await update_topl('No chronicled events.');
    }
    return 0; // ECMD_OK
}

// C ref: insight.c num_genocides() — count of svm.mvitals[] entries flagged
// G_GENOD (actual genocides; excludes species merely hunted to extinction).
function num_genocides() {
    const mv = game.mvitals;
    if (!mv) return 0;
    let n = 0;
    for (let i = 0; i < mv.length; i++)
        if (mv[i] && (mv[i].mvflags & G_GENOD)) n++;
    return n;
}

function plur(n) { return n === 1 ? '' : 's'; }

// C ref: insight.c N_times() — "once" / "twice" / "thrice" / "N times".
// The `case 3: "thrice"` arm was missing; it is reachable from #conduct via
// numrerolls and sokocheat.
function N_times(n) {
    return n === 1 ? 'once' : n === 2 ? 'twice'
         : n === 3 ? 'thrice' : `${n} times`;
}

// C ref: insight.c achieve_msg[] — one {llflag, msg} per you.h ACH_* index.
// The eight rank entries (23..30) build their text from the role's rank title
// at record time and ACH_MINE_PRIZE/ACH_SOKO_PRIZE append an identified item
// name; neither form is reachable from this port, so both are omitted.
const ACHIEVE_MSG = {
    1: [LL_ACHIEVE, 'acquired the Bell of Opening'],
    2: [LL_ACHIEVE, 'entered Gehennom'],
    3: [LL_ACHIEVE, 'acquired the Candelabrum of Invocation'],
    4: [LL_ACHIEVE, 'acquired the Book of the Dead'],
    5: [LL_ACHIEVE, 'performed the invocation'],
    6: [LL_ACHIEVE, 'acquired The Amulet of Yendor'],
    7: [LL_ACHIEVE, 'entered the Elemental Planes'],
    8: [LL_ACHIEVE, 'entered the Astral Plane'],
    9: [LL_ACHIEVE, 'ascended'],
    12: [LL_ACHIEVE | LL_UMONST, 'killed Medusa'],
    13: [0, 'hero was always blond, no, blind'],
    14: [0, 'hero never wore armor'],
    15: [LL_MINORAC | LL_DUMP, 'entered the Gnomish Mines'],
    16: [LL_ACHIEVE, 'reached Mine Town'],
    17: [LL_MINORAC, 'entered a shop'],
    18: [LL_MINORAC, 'entered a temple'],
    19: [LL_ACHIEVE, 'consulted the Oracle'],
    20: [LL_MINORAC | LL_DUMP, 'read a Discworld novel'],
    21: [LL_ACHIEVE, 'entered Sokoban'],
    22: [LL_ACHIEVE, 'entered the Bigroom'],
    31: [LL_MINORAC, "learned castle drawbridge's tune"],
};

// C ref: insight.c record_achievement(achidx) — append to u.uachieved (ignoring
// duplicates) and chronicle it.  This was a `{}` stub in invent.js, so no
// achievement ever reached the #chronicle window.  Ranks are stored as the
// complement to remember the hero's gender, hence the abs() compare.
export function record_achievement(achidx) {
    const u = game.u;
    if (!u) return;
    if (!Array.isArray(u.uachieved)) u.uachieved = [];
    const absidx = Math.abs(achidx);
    if (u.uachieved.some((a) => Math.abs(a) === absidx)) return;
    u.uachieved.push(achidx);
    if (game.program_state_gameover) return;
    const entry = ACHIEVE_MSG[absidx];
    if (!entry || !entry[1]) return;
    livelog_printf(entry[0], entry[1]);
}

// C ref: insight.c:2504 achieve_rank(rank) — the rank index encoded as an
// achievement number, negated when the hero is female so the rank title can be
// reported with the right gender later.
export function achieve_rank(rank) {
    const achidx = (rank - 1) + 23 /* ACH_RNK1 */;
    return game.flags?.female ? -achidx : achidx;
}

// C ref: insight.c show_conduct(final)'s "only report Sokoban conduct if the
// Sokoban branch has been entered" gate.  you.h:97 makes ACH_SOKO 21; the old
// literal 6 is ACH_AMUL, so the Sokoban-rules line appeared when the hero
// picked up the Amulet and never on entering Sokoban.
function sokoban_in_play() {
    const ach = game.u?.uachieved;
    return Array.isArray(ach) && ach.includes(21 /* ACH_SOKO, you.h:97 */);
}

// C ref: insight.c show_conduct(final) — the #conduct details window.  Builds
// the "Voluntary challenges:" lines from the live u.uconduct/u.uroleplay
// counters.  Only final==0 (in-game, non-wizard) is modeled: show_achievements
// is a no-op in that mode (it requires final or wizard), and the wizard-only
// "N times"/"N item(s)" elaborations for a nonzero counter are skipped (the
// non-wizard branches of those ifs emit nothing, matching C).
function conduct_lines(final = 0) {
    const u = game.u || {};
    const uc = u.uconduct || {};
    const rp = u.uroleplay || {};
    const wizard = !!game.flags?.debug;
    const lines = [];
    const out = (s) => lines.push(s);
    // C ref: insight.c enlght_line() — " <start><mid><end><ps>." with the
    // not-contraction table applied.
    const enlLine = (start, mid, end, ps = '') => {
        let buf = ` ${start}${mid}${end}${ps}.`;
        buf = buf.replace(' are not ', ' aren\'t ').replace(' were not ', ' weren\'t ')
            .replace(' have not ', ' haven\'t ').replace(' had not ', ' hadn\'t ')
            .replace(' can not ', ' can\'t ').replace(' could not ', ' couldn\'t ');
        out(buf);
    };
    const you_have_been = (good) => enlLine('You ', final ? 'were ' : 'have been ', good);
    const you_have_never = (bad) => enlLine('You ', final ? 'never ' : 'have never ', bad);
    const you_have_X = (thing) => enlLine('You ', final ? '' : 'have ', thing);

    out('Voluntary challenges:');

    if (!rp.reroll)
        out(' Character rerolling was not enabled.');
    else if (!rp.numrerolls)
        out(' Your character was not rerolled.');
    else
        out(` Your character was rerolled ${N_times(rp.numrerolls)}.`);

    if (rp.blind) you_have_been('blind from birth');
    if (rp.deaf) you_have_been('deaf from birth');
    if (rp.pauper)
        enlLine('You ', (game.invent && game.invent.length) ? 'started' : 'are',
                ' without possessions');
    if (rp.nudist) you_have_been('faithfully nudist');

    if (!uc.food) enlLine('You ', final ? 'went' : 'have gone', ' without food');
    else if (!uc.unvegan) you_have_X('followed a strict vegan diet');
    else if (!uc.unvegetarian) you_have_been('vegetarian');

    if (!uc.gnostic) you_have_been('an atheist');

    if (!uc.weaphit) you_have_never('hit with a wielded weapon');
    else if (wizard)
        you_have_X(`hit with a wielded weapon ${uc.weaphit} time${plur(uc.weaphit)}`);

    if (!uc.killer) you_have_been('a pacifist');

    if (!uc.literate) you_have_been('illiterate');
    else if (wizard)
        you_have_X(`read items or engraved ${uc.literate} time${plur(uc.literate)}`);

    if (!uc.pets) you_have_never('had a pet');

    const ngenocided = num_genocides();
    if (ngenocided === 0)
        you_have_never('genocided any monsters');
    else
        you_have_X(`genocided ${ngenocided} type${plur(ngenocided)} of monster${plur(ngenocided)}`);

    if (!uc.polypiles) you_have_never('polymorphed an object');
    else if (wizard)
        you_have_X(`polymorphed ${uc.polypiles} item${plur(uc.polypiles)}`);

    if (!uc.polyselfs) you_have_never('changed form');
    else if (wizard)
        you_have_X(`changed form ${uc.polyselfs} time${plur(uc.polyselfs)}`);

    if (!uc.wishes) {
        you_have_X('used no wishes');
    } else {
        let buf = `used ${uc.wishes} wish${uc.wishes > 1 ? 'es' : ''}`;
        if (uc.wisharti) {
            if (uc.wisharti === uc.wishes)
                buf += ` (${uc.wisharti > 2 ? 'all ' : uc.wisharti === 2 ? 'both ' : ''}`;
            else
                buf += ` (${uc.wisharti} `;
            buf += `for ${uc.wisharti === 1 ? 'an artifact' : 'artifacts'})`;
        }
        you_have_X(buf);
        if (!uc.wisharti) enlLine('You ', 'have not wished', ' for any artifacts');
    }

    if (sokoban_in_play()) {
        if (!uc.sokocheat)
            enlLine('You ', 'have not violated', ' any of the special Sokoban rules');
        else
            enlLine('You ', 'have violated', ` the special Sokoban rules ${N_times(uc.sokocheat)}`);
    }

    // C ref: insight.c:2230 show_achievements(final) — appended to the SAME
    // window, so a blank line separates it from the conduct list.
    for (const l of show_achievement_lines(final)) out(l);
    return lines;
}

// C ref: insight.c:2243 show_achievements(final).  Gated on `final || wizard`,
// which is why a wizard-mode #conduct shows the block and an ordinary one does
// not (the achievements would give away the Mine's End luckstone).  Emits in
// u.uachieved order — the order they were earned.
function show_achievement_lines(final) {
    const u = game.u || {};
    const wizard = !!game.flags?.debug;
    if (!final && !wizard) return [];
    const ach = Array.isArray(u.uachieved) ? u.uachieved : [];
    const acnt = ach.length;
    if (!acnt) return [];

    const out = [];
    const enlLine = (start, mid, end, ps = '') => {
        let buf = ` ${start}${mid}${end}${ps}.`;
        buf = buf.replace(' are not ', " aren't ").replace(' were not ', " weren't ")
            .replace(' have not ', " haven't ").replace(' had not ', " hadn't ")
            .replace(' can not ', " can't ").replace(' could not ', " couldn't ");
        out.push(buf);
    };
    const you_have_X = (thing) => enlLine('You ', final ? '' : 'have ', thing);

    out.push('');                                     // insight.c:2265 putstr("")
    out.push(`Achievement${acnt === 1 ? '' : 's'}:`);

    // The ascension reshuffle (ACH_UWIN/ACH_AMUL moved to the end) only applies
    // to a winning game's disclosure.
    for (const achidx of ach) {
        const absidx = Math.abs(achidx);
        switch (absidx) {
        case 13 /* ACH_BLND */:
            enlLine('You ', final ? 'explored' : 'are exploring',
                    ' without being able to see');
            break;
        case 14 /* ACH_NUDE */:
            enlLine('You ', final ? 'went' : 'have gone', ' without any armor');
            break;
        case 15 /* ACH_MINE */: you_have_X('entered the Gnomish Mines'); break;
        case 16 /* ACH_TOWN */: you_have_X('entered Minetown'); break;
        case 17 /* ACH_SHOP */: you_have_X('entered a shop'); break;
        case 18 /* ACH_TMPL */: you_have_X('entered a temple'); break;
        case 19 /* ACH_ORCL */: you_have_X('consulted the Oracle of Delphi'); break;
        case 20 /* ACH_NOVL */: you_have_X('read from a Discworld novel'); break;
        case 21 /* ACH_SOKO */: you_have_X('entered Sokoban'); break;
        case 11 /* ACH_SOKO_PRIZE */: you_have_X('completed Sokoban'); break;
        case 10 /* ACH_MINE_PRIZE */: you_have_X('completed the Gnomish Mines'); break;
        case 22 /* ACH_BGRM */: you_have_X('entered the Big Room'); break;
        case 12 /* ACH_MEDU */: you_have_X('defeated Medusa'); break;
        case 31 /* ACH_TUNE */:
            you_have_X("learned the tune to open and close the Castle's drawbridge");
            break;
        case 1 /* ACH_BELL */:
            enlLine('You ', u.uhave?.bell ? (final ? 'had ' : 'have ')
                    : (final ? 'handled' : 'have handled'), ' the Bell of Opening');
            break;
        case 2 /* ACH_HELL */:
            enlLine('You ', final ? '' : 'have ', 'entered Gehennom');
            break;
        case 3 /* ACH_CNDL */:
            enlLine('You ', u.uhave?.menorah ? (final ? 'had ' : 'have ')
                    : (final ? 'handled' : 'have handled'),
                    ' the Candelabrum of Invocation');
            break;
        case 4 /* ACH_BOOK */:
            enlLine('You ', u.uhave?.book ? (final ? 'had ' : 'have ')
                    : (final ? 'handled' : 'have handled'), ' the Book of the Dead');
            break;
        case 5 /* ACH_INVK */: you_have_X("gained access to Moloch's Sanctum"); break;
        case 6 /* ACH_AMUL */:
            enlLine('You ', u.uhave?.amulet ? (final ? 'had ' : 'have ')
                    : (final ? 'had obtained' : 'have obtained'),
                    ' the Amulet of Yendor');
            break;
        case 7 /* ACH_ENDG */: you_have_X('reached the Elemental Planes'); break;
        case 8 /* ACH_ASTR */: you_have_X('reached the Astral Plane'); break;
        case 9 /* ACH_UWIN */: out.push(' You ascended!'); break;
        case 23: case 24: case 25: case 26:
        case 27: case 28: case 29: case 30: /* ACH_RNK1..8 */
            you_have_X(`attained the rank of ${
                rank_of(rank_to_xlev(absidx - 22 /* ACH_RNK1 - 1 */),
                        game.urole?.mnum, achidx < 0)}`);
            break;
        default:
            out.push(` [Unexpected achievement #${achidx}.]`);
            break;
        }
    }
    return out;
}

// C ref: botl.c:314 rank_to_xlev(rank) — the LOW end of the rank's xlev range.
function rank_to_xlev(rank) {
    return (rank < 1) ? 1 : (rank < 2) ? 3 : (rank < 8) ? (rank * 4 - 2) : 30;
}

// C ref: win/tty/wintty.c process_text_window()'s corner-menu placement
// (docorner/H2344_BROKEN offx calc) — show_conduct()'s window is a NHW_MENU
// populated via putstr() (not add_menu()), so tty_display_nhwindow() routes it
// through process_text_window(), not the selectable-menu path: it lands at a
// right-of-center corner offset and pages with "--More--" (parked right after
// the last content line, not row 23) rather than the "(end)" a real
// select_menu()-driven menu (e.g. #overview) uses.
async function render_menu_window(lines, footer) {
    return await render_conduct_menu(lines, footer);
}

async function render_conduct_menu(lines, footer = '--More--') {
    const { NO_COLOR } = await import('./terminal.js');
    const disp = game.nhDisplay;
    if (!disp?.setCell) return;
    const cols = disp.cols || 80;
    // C ref: wintty.c putstr() — cw->maxcol tracks max(strlen(line) + 1) over
    // every line added (the morestr is appended later, after offx is fixed, so
    // it never contributes).
    let maxcol = 0;
    for (const l of lines) maxcol = Math.max(maxcol, l.length + 1);
    let offx = Math.min(Math.min(82, Math.floor(cols / 2)), cols - maxcol - 1);
    if (offx < 0) offx = 0;
    const textCol = offx + 1;
    for (let c = 0; c < cols; c++) disp.setCell(c, 0, ' ', NO_COLOR, 0);
    const moreRow = lines.length;
    for (let r = 0; r <= moreRow; r++) {
        for (let c = offx; c < cols; c++) disp.setCell(c, r, ' ', NO_COLOR, 0);
    }
    for (let r = 0; r < lines.length; r++)
        disp.putstr(textCol, r, lines[r], NO_COLOR, 0);
    disp.putstr(textCol, moreRow, footer, NO_COLOR, 0);
    disp.setCursor(textCol + footer.length, moreRow);
}

// C ref: insight.c show_conduct(final) -> display_nhwindow()+destroy_nhwindow()
// — shared by doconduct() (final=ENL_GAMEINPROGRESS/0) and end.c disclose()'s
// 'c' query (final=ENL_GAMEOVERALIVE/1 or ENL_GAMEOVERDEAD/2, both of which
// conduct_lines()'s truthy `final` check treats identically: past tense).
export async function show_conduct_disclosure(final) {
    const lines = conduct_lines(final);
    await render_conduct_menu(lines);
    for (;;) {
        const key = await nhgetch();
        if (key === 27 || key === 13 || key === 10 || key === 32) break;
    }
    const { flush_screen } = await import('./display.js');
    await flush_screen(1);
}

// C ref: insight.c doconduct() — the #conduct command.
export async function doconduct() {
    await show_conduct_disclosure(0);
    return 0; // ECMD_OK
}

// C ref: insight.c enlightenment(mode, final) end-of-game path — ge.en_via_menu
// is `!final`, so for any final!=0 (only reached from end.c disclose()'s 'a'
// query, which always uses ENL_GAMEOVERALIVE/1 or ENL_GAMEOVERDEAD/2) the tty
// renders the text through process_text_window() rather than the paged
// selectable menu doattributes() uses: 23 content lines per page with
// "--More--" parked at row 23 (the mid-loop break — reached because the
// combined BASIC+MAGIC disclosure content always exceeds one page, which
// forces offx to 0, i.e. full screen, no corner box), then one further
// trailing "--More--" right after the last line of the final page (an
// NHW_MENU window parks its trailing morestr at the current row, not pinned
// to 23 the way NHW_TEXT's is).
export async function show_attributes_disclosure(final) {
    const lines = enlightenment_lines(final);
    const { renderWindowScreen, dismiss_invent_screen } = await import('./invent.js');
    const disp = game.nhDisplay;
    const rows = disp?.rows ?? 24;
    const perPage = rows - 1; // 23 content lines; footer parked right after them
    let i = 0;
    while (i < lines.length) {
        const take = Math.min(perPage, lines.length - i);
        const chunk = lines.slice(i, i + take);
        i += take;
        renderWindowScreen(chunk, {
            menu: false,
            footer: '--More--',
            footerRow: take,
            // C ref: wintty.c dmore() — offset = (NHW_TEXT) ? 1 : 2; this is an
            // NHW_MENU window, so the morestr lands one column further right
            // than content lines (which start at column 0 here, offx==0).
            footerCol: 1,
            modal: 'enlightenment',
        });
        for (;;) {
            const key = await nhgetch();
            if (key === 27) { i = lines.length; break; } // ESC cancels the rest
            if (key === 32 || key === 13 || key === 10) break; // advance
            // any other key: ignored (bell), same page stays up
        }
    }
    await dismiss_invent_screen();
}

// ═════════════════════════════════════════════════════════════════════════════
// FAITHFUL PORT of the remainder of src/insight.c.
//
// INERT BY DESIGN.  Nothing above this line calls anything below it and no
// other module imports any of it yet.  The reduced live copies above —
// enlightenment_lines(), conduct_lines(), show_achievement_lines(),
// list_vanquished_screen(), weaponInsight(), elapsedTime(), render_*_menu() —
// remain the code the ^X screen and the end-of-game disclosure actually run.
// A wiring pass must REPLACE one of them at a time under measurement, never
// add a second caller ([[duplicate-reimplementation-shadows-faithful-port]]).
//
// C's window layer (create_nhwindow/putstr/add_menu_str/display_nhwindow) has
// no counterpart in this port — frozen/terminal.js owns the grid and each
// screen is hand-drawn.  The shim below therefore does what js/topten.js:337
// does: it accumulates {text, attr} rows so the translated bodies keep C's
// exact putstr() order, and a wiring pass reads them back.
// ═════════════════════════════════════════════════════════════════════════════

import {
    A_CURRENT, A_ORIGINAL, A_NONE, AC_MAX, LOW_PM,
    TT_LAVA, TT_INFLOOR, TT_BURIEDBALL,
    HANDED, LEG, I_SPECIAL, FROMFORM, FROMOUTSIDE,
    SICK_VOMITABLE, SICK_NONVOMITABLE, LEFT_SIDE, BOTH_SIDES, M_AP_NOTHING,
    UNENCUMBERED, SLT_ENCUMBER, MOD_ENCUMBER, HVY_ENCUMBER, EXT_ENCUMBER,
    OVERLOADED, BASICENLIGHTENMENT, MAGICENLIGHTENMENT, ENL_GAMEOVERALIVE,
    ENL_GAMEOVERDEAD,
    VANQ_MLVL_MNDX, VANQ_MSTR_MNDX, VANQ_ALPHA_SEP, VANQ_ALPHA_MIX,
    VANQ_MCLS_HTOL, VANQ_MCLS_LTOH, VANQ_COUNT_H_L, VANQ_COUNT_L_H,
    ACH_UWIN, ACH_AMUL, ACH_BELL, ACH_HELL, ACH_CNDL, ACH_BOOK, ACH_INVK,
    ACH_ENDG, ACH_ASTR, ACH_MINE_PRIZE, ACH_SOKO_PRIZE, ACH_MEDU, ACH_BLND,
    ACH_NUDE, ACH_MINE, ACH_TOWN, ACH_SHOP, ACH_TMPL, ACH_ORCL, ACH_NOVL,
    ACH_SOKO, ACH_BGRM, ACH_RNK1, ACH_RNK2, ACH_RNK3, ACH_RNK4, ACH_RNK5,
    ACH_RNK6, ACH_RNK7, ACH_RNK8, ACH_TUNE,
    ismnum, Is_rogue_level, MGIVENNAME, has_mgivenname, xdir, ydir,
} from './const.js';
import { genders } from './role.js';
import { monster_by_pmidx, name_to_pmidx } from './makemon.js';
import { is_rider_pm, WEAPON_CLASS, GEM_CLASS } from './mkobj.js';
import { mbodypart } from './monmove.js';
import { mflags1_of, mflags2_of, M1_NOEYES, M1_CLING, M1_OVIPAROUS,
         M1_BREATHLESS, M1_AMPHIBIOUS, M2_ORC, M2_ELF, M2_HUMAN, M2_DEMON,
         M2_WERE, M2_MALE, M2_FEMALE, M2_NEUTER } from './monflags_data.js';
import { MALE, FEMALE } from './do_name.js';
import { NUMMONS } from './disprng.js';
import { def_monsyms } from './symbols.js';
import { enc_stat, botl_score } from './botl.js';
import { is_pool, is_lava, is_pool_or_lava } from './dbridge.js';
import { AD_FIRE, AD_COLD, AD_DISN, AD_ELEC, AD_ACID, AD_DGST,
         dmgtype } from './monattk_data.js';
import { surface, Is_bigroom } from './dungeon.js';
import { trap_explanation } from './trap.js';
import { t_at } from './mkroom.js';
import { fingers_or_gloves, suit_simple_name, shield_simple_name,
         stuck_ring } from './do_wear.js';
import { which_armor } from './worn.js';
import { weapon_descr, is_wet_towel } from './weapon.js';
import { can_advance_pub, P_NAME } from './enhance.js';
import { temp_resist } from './eat.js';
import { spellid } from './spell.js';
import { hliquid } from './do_name.js';
import { find_ac } from './u_init.js';
import { money_cnt_invent, hidden_gold } from './shk.js';
import { costly_spot } from './shkroom.js';
// C ref: objnam.c makeplural().  insight.js's local makeplural() (above) is a
// crude reduced copy that predates it; the fix is to delete the local one and
// use this everywhere, not to add a third.
import { makeplural as objnam_makeplural, ansimpleoname,
         carrying, near_capacity, body_part } from './invent.js';
import { y_monnam, a_monnam } from './do_name.js';

// ── window shim (wintty.h / C's ge.en_win) ──────────────────────────────────
const NHW_MENU = 4, NHW_TEXT = 5;   // wintype.h window types
const WIN_ERR = -1;
const ATR_NONE = 0;
const PICK_NONE = 0, PICK_ONE = 1;
// wintty.h MENU_BEHAVE_STANDARD; only recorded, never acted on.
const MENU_BEHAVE_STANDARD = 0;
const MENU_ITEMFLAGS_NONE = 0, MENU_ITEMFLAGS_SELECTED = 1;

// Every window this port has "displayed", oldest first:
//   { type, blocking, prompt, lines: [{ text, attr }], items: [...] }
export const insight_windows = [];
// putstr(0, ...) — C's dumplog sink (window id 0 is the dump file).
export const insight_dumplog = [];
const _wins = new Map();
let _nextwin = 1;

function create_nhwindow(type) {
    const id = _nextwin++;
    _wins.set(id, { id, type, lines: [], items: [], prompt: null, behave: null });
    return id;
}
function putstr(win, attr, s) {
    if (!win) { insight_dumplog.push({ text: s, attr }); return; }
    const w = _wins.get(win);
    if (w) w.lines.push({ text: s, attr });
}
function start_menu(win, behave) { const w = _wins.get(win); if (w) w.behave = behave; }
function add_menu_str(win, s) { putstr(win, ATR_NONE, s); }
function add_menu(win, _gi, any, ch, gch, attr, clr, str, itemflags) {
    const w = _wins.get(win);
    if (!w) return;
    w.items.push({ any: { ...any }, ch, gch, attr, clr, str, itemflags });
    w.lines.push({ text: str, attr, ch });
}
function end_menu(win, prompt) { const w = _wins.get(win); if (w) w.prompt = prompt; }
// C's select_menu() renders the menu before collecting picks, so record the
// window here too.  PICK_NONE menus return 0 selections; PICK_ONE ones have no
// key source in an inert port, so they report "cancelled" (C's -1) and leave
// flags.vanq_sortmode untouched.
function select_menu(win, how, _res) {
    display_nhwindow(win, true);
    return (how === PICK_NONE) ? 0 : -1;
}
function display_nhwindow(win, blocking) {
    const w = _wins.get(win);
    if (!w) return;
    insight_windows.push({ type: w.type, blocking: !!blocking, prompt: w.prompt,
                           lines: w.lines.slice(), items: w.items.slice() });
}
function destroy_nhwindow(win) { _wins.delete(win); }

// C ref: decl.h `struct enlghtmt ge` — the enlightenment window and whether it
// is being built as a selectable menu (live ^X) or a text window (disclosure).
const ge = { en_win: WIN_ERR, en_via_menu: false };

// ── insight.c:44 the shared verb fragments ─────────────────────────────────
const You_ = 'You ', are = 'are ', were = 'were ', have = 'have ', had = 'had ',
      can = 'can ', could = 'could ';
const have_been = 'have been ', have_never = 'have never ', never = 'never ';

// insight.c:105 the enl_msg()/you_are()/... macro family.  C hides `final` in
// the enclosing scope; here it is an explicit trailing argument.
function enl_msg(prefix, present, past, suffix, ps, final) {
    enlght_line(prefix, final ? past : present, suffix, ps);
}
function you_are(attr, ps, final) { enl_msg(You_, are, were, attr, ps, final); }
function you_have(attr, ps, final) { enl_msg(You_, have, had, attr, ps, final); }
function you_can(attr, ps, final) { enl_msg(You_, can, could, attr, ps, final); }
function you_have_been(goodthing, final) {
    enl_msg(You_, have_been, were, goodthing, '', final);
}
function you_have_never(badthing, final) {
    enl_msg(You_, have_never, never, badthing, '', final);
}
function you_have_X(something, final) {
    enl_msg(You_, have, '', something, '', final);
}

// ── small C library / macro equivalents ────────────────────────────────────
// C ref: hacklib.c strsubst() — replaces the FIRST occurrence only.
function strsubst(bp, orig, replacement) {
    const i = bp.indexOf(orig);
    return (i < 0) ? bp : bp.slice(0, i) + replacement + bp.slice(i + orig.length);
}
function highc(c) { return c ? c.toUpperCase() : c; }
function lowc(c) { return c ? c.toLowerCase() : c; }
// C ref: hacklib.c upstart() — capitalise the first character in place.
function upstart(s) { return s ? highc(s.charAt(0)) + s.slice(1) : s; }
// C ref: hacklib.c mungspaces() — collapse runs of spaces and strip trailing.
function mungspaces(s) { return String(s).replace(/ +/g, ' ').replace(/ +$/, ''); }
function digit(c) { return c >= '0' && c <= '9'; }
function strcmpi(a, b) {
    const x = String(a).toLowerCase(), y = String(b).toLowerCase();
    return (x < y) ? -1 : (x > y) ? 1 : 0;
}
// C ref: hacklib.c ordin() — "st"/"nd"/"rd"/"th".
function ordin(n) {
    const dd = n % 10;
    return (dd === 0 || dd > 3 || (n % 100) / 10 === 1) ? 'th'
        : (dd === 1) ? 'st' : (dd === 2) ? 'nd' : 'rd';
}
// C ref: hacklib.c the() / objnam.c the() — "the <foo>" unless already proper.
function the_str(s) { return /^[A-Z]/.test(String(s)) ? String(s) : `the ${s}`; }
// C ref: hacklib.c s_suffix() — possessive.  Five other modules keep a local
// copy of this (js/invent.js:1369, js/eat.js:1915, ...); same convention here.
function s_suffix(s) { return /s$/.test(s) ? `${s}'` : `${s}'s`; }
// C ref: objnam.c simpleonames(obj) — the unadorned object-type name.
// js/invent.js:516 owns the real one but keeps it module-private; the fix is to
// export that, not to grow this.
function simpleonames(obj) {
    return OBJECTS[obj?.otyp]?.name || '';
}
// C ref: hacklib.c just_an(outbuf, str) — the bare article plus a space.
function just_an(str) {
    const s = String(str || '');
    if (!s) return '';
    if (s.length === 1) return 'a ';
    return /^[aeiou]/i.test(s) ? 'an ' : 'a ';
}
// C ref: calendar.c midnight() — getlt()->tm_hour == 0.  calendar.js keeps
// getlt() module-private (js/calendar.js:10); the fix is to export it.
function midnight() {
    const dt = String(game.datetime || '');
    if (!/^\d{14}$/.test(dt)) return false;
    return Number(dt.slice(8, 10)) === 0;
}
// C ref: you.h Role_switch == gu.urole.mnum.
function Role_switch() { return game.urole?.mnum; }
// role.c align_gname() takes only the alignment in C; this port's version
// (js/role.js:734) needs the roles[] ARRAY index first — which is NOT the PM_
// mnum (they differ for Rogue/Ranger), so resolve it the way the reduced
// enlightenment_lines() above does.
function role_arr_idx() {
    const mnum = Role_switch() ?? game.u?.umonnum ?? 9;
    const i = roles.findIndex((r) => r.mnum === mnum);
    return (i >= 0) ? i : mnum;
}
function align_gname_c(alignment) { return align_gname(role_arr_idx(), alignment); }
// C ref: pray.c u_gname() == align_gname(u.ualign.type).
function u_gname() { return align_gname_c(game.u?.ualign?.type ?? A_NONE); }
// C ref: insight.c:3187 align_str(alignment).
export function align_str(alignment) {
    switch (alignment | 0) {
    case A_CHAOTIC: return 'chaotic';
    case A_NEUTRAL: return 'neutral';
    case A_LAWFUL: return 'lawful';
    case A_NONE: return 'unaligned';
    }
    return 'unknown';
}
// C ref: you.h URIGHTY == (u.uhandedness == RIGHT_HANDED), and RIGHT_HANDED
// is 0 (js/invent.js:4555 documents the same encoding).
function URIGHTY() { return (game.u?.uhandedness | 0) === 0; }
// C ref: dungeon.c observable_depth(lev).  js/topten.js:358 has the same
// one-line body (the elemental-plane remap sits inside `#if 0` upstream).
function observable_depth(lev) { return depth(lev); }
// C ref: mondata.h is_male/is_female/is_neuter — mflags2 gender bits.
function is_male(ptr) { return (mflags2_of(ptr) & M2_MALE) !== 0; }
function is_female(ptr) { return (mflags2_of(ptr) & M2_FEMALE) !== 0; }
function is_neuter(ptr) { return (mflags2_of(ptr) & M2_NEUTER) !== 0; }
// C ref: mon.c pmname(ptr, gender) — the gendered player-monster name.  This
// port's mons[] rows carry a single `name` (makemon.js MONS_NAMES), so the
// male/female split collapses to that name.
function pmname(ptr, _gender) { return ptr?.name || ''; }
// C ref: mon.c vampshifted(mon) — a vampire currently in bat/fog/wolf shape.
// No covered path sets youmonst.cham, so this is always FALSE here.
function vampshifted(mon) {
    return !!(mon && ismnum(mon.cham) && mon.cham !== mon.data?.pmidx);
}
// C ref: you.h ugenocided() / udeadinside() — a polymorphed hero whose current
// form has been genocided is "dead inside".
function ugenocided() {
    const u = game.u || {};
    if (!u.Upolyd) return false;
    const mv = game.mvitals?.[u.umonnum];
    return !!(mv && (mv.mvflags & G_GENOD));
}
function udeadinside() {
    const u = game.u || {};
    return (u.Upolyd && (u.mh ?? 0) < 1) ? 'dead' : 'dying';
}
// C ref: getpos.c:557 dxdy_to_dist_descr(dx, dy, fulldir).
const _DIST_DIRNAMES = [['n', 'north'], ['s', 'south'], ['w', 'west'], ['e', 'east']];
// C ref: cmd.c:3847 xytodir(x, y) — the index into decl.c's xdir[]/ydir[],
// or DIR_ERR (-1) when the offset is not one step.
const N_DIRS = 8, N_DIRS_Z = 10, DIR_ERR = -1;
function xytodir(x, y) {
    for (let dd = 0; dd < N_DIRS; dd++)
        if (x === xdir[dd] && y === ydir[dd])
            return dd;
    return DIR_ERR;
}
// C ref: cmd.c:4313 directionname(dir).
const dirnames = ['west', 'northwest', 'north', 'northeast', 'east',
                  'southeast', 'south', 'southwest', 'down', 'up'];
function directionname(dir) {
    if (dir < 0 || dir >= N_DIRS_Z)
        return 'invalid';
    return dirnames[dir];
}
function dxdy_to_dist_descr(dx, dy, fulldir) {
    let buf = '', dst;
    if (!dx && !dy) return 'here';
    if ((dst = xytodir(dx, dy)) !== -1)
        return directionname(dst); /* explicit direction; 'one step' implicit */
    if (dy) {
        if (Math.abs(dy) > 9999) dy = Math.sign(dy) * 9999;
        buf += `${Math.abs(dy)}${_DIST_DIRNAMES[(dy > 0) ? 1 : 0][fulldir ? 1 : 0]}${dx ? ',' : ''}`;
    }
    if (dx) {
        if (Math.abs(dx) > 9999) dx = Math.sign(dx) * 9999;
        buf += `${Math.abs(dx)}${_DIST_DIRNAMES[2 + ((dx > 0) ? 1 : 0)][fulldir ? 1 : 0]}`;
    }
    return buf;
}

// ── prop.h property access ─────────────────────────────────────────────────
// C ref: prop.h enum prop_types.  This port has no u.uprops[] triple: the
// intrinsic lives under a NAME key in game.u.uprops (js/eat.js:1986 documents
// the same mapping for the slice eat.c touches) and the extrinsic is implicit
// in the oc_oprop of worn gear (what_gives() above).  There is no `blocked`
// column at all, so every B<Prop> test below reads FALSE — faithful to the
// port's state model, not to C's.
const FIRE_RES = 1, COLD_RES = 2, SLEEP_RES = 3, DISINT_RES = 4,
      SHOCK_RES = 5, POISON_RES = 6, ACID_RES = 7, STONE_RES = 8,
      DRAIN_RES = 9, SICK_RES = 10, INVULNERABLE = 11, ANTIMAGIC = 12,
      STUNNED = 13, CONFUSION = 14, BLINDED = 15, DEAF = 16, SICK = 17,
      STONED = 18, STRANGLED = 19, VOMITING = 20, GLIB = 21, SLIMED = 22,
      HALLUC = 23, HALLUC_RES = 24, FUMBLING = 25, WOUNDED_LEGS = 26,
      SLEEPY = 27, HUNGER = 28, SEE_INVIS = 29, TELEPAT = 30, WARNING = 31,
      WARN_OF_MON = 32, WARN_UNDEAD = 33, SEARCHING = 34, CLAIRVOYANT = 35,
      INFRAVISION = 36, DETECT_MONSTERS = 37, BLND_RES = 38, ADORNED = 39,
      INVIS = 40, DISPLACED = 41, STEALTH = 42, AGGRAVATE_MONSTER = 43,
      CONFLICT = 44, JUMPING = 45, TELEPORT = 46, TELEPORT_CONTROL = 47,
      LEVITATION = 48, FLYING = 49, WWALKING = 50, SWIMMING = 51,
      MAGICAL_BREATHING = 52, PASSES_WALLS = 53, SLOW_DIGESTION = 54,
      HALF_SPDAM = 55, HALF_PHDAM = 56, REGENERATION = 57,
      ENERGY_REGENERATION = 58, PROTECTION = 59,
      PROT_FROM_SHAPE_CHANGERS = 60, POLYMORPH = 61, POLYMORPH_CONTROL = 62,
      UNCHANGING = 63, FAST = 64, REFLECTING = 65, FREE_ACTION = 66,
      FIXED_ABIL = 67, LIFESAVED = 68;

// prop index -> the youprop.h H<Prop> macro name, which is also the key this
// port stores the intrinsic under.  Several properties are written under the
// bare name instead (js/eat.js uses 'Levitation'), so the reader tries both.
const PROPKEY = {
    [FIRE_RES]: 'HFire_resistance', [COLD_RES]: 'HCold_resistance',
    [SLEEP_RES]: 'HSleep_resistance', [DISINT_RES]: 'HDisint_resistance',
    [SHOCK_RES]: 'HShock_resistance', [POISON_RES]: 'HPoison_resistance',
    [ACID_RES]: 'HAcid_resistance', [STONE_RES]: 'HStone_resistance',
    [DRAIN_RES]: 'HDrain_resistance', [SICK_RES]: 'HSick_resistance',
    [INVULNERABLE]: 'Invulnerable', [ANTIMAGIC]: 'HAntimagic',
    [STUNNED]: 'HStun', [CONFUSION]: 'HConfusion', [BLINDED]: 'HBlinded',
    [DEAF]: 'HDeaf', [SICK]: 'Sick', [STONED]: 'Stoned',
    [STRANGLED]: 'Strangled', [VOMITING]: 'Vomiting', [GLIB]: 'Glib',
    [SLIMED]: 'Slimed', [HALLUC]: 'HHallucination',
    [HALLUC_RES]: 'HHalluc_resistance', [FUMBLING]: 'HFumbling',
    [WOUNDED_LEGS]: 'HWounded_legs', [SLEEPY]: 'HSleepy',
    [HUNGER]: 'HHunger', [SEE_INVIS]: 'HSee_invisible', [TELEPAT]: 'HTelepat',
    [WARNING]: 'HWarning', [WARN_OF_MON]: 'HWarn_of_mon',
    [WARN_UNDEAD]: 'HUndead_warning', [SEARCHING]: 'HSearching',
    [CLAIRVOYANT]: 'HClairvoyant', [INFRAVISION]: 'HInfravision',
    [DETECT_MONSTERS]: 'HDetect_monsters', [BLND_RES]: 'HBlnd_resist',
    [ADORNED]: 'Adornment', [INVIS]: 'HInvis', [DISPLACED]: 'HDisplaced',
    [STEALTH]: 'HStealth', [AGGRAVATE_MONSTER]: 'HAggravate_monster',
    [CONFLICT]: 'HConflict', [JUMPING]: 'HJumping',
    [TELEPORT]: 'HTeleportation', [TELEPORT_CONTROL]: 'HTeleport_control',
    [LEVITATION]: 'Levitation', [FLYING]: 'HFlying', [WWALKING]: 'HWwalking',
    [SWIMMING]: 'HSwimming', [MAGICAL_BREATHING]: 'HMagical_breathing',
    [PASSES_WALLS]: 'HPasses_walls', [SLOW_DIGESTION]: 'HSlow_digestion',
    [HALF_SPDAM]: 'HHalf_spell_damage', [HALF_PHDAM]: 'HHalf_physical_damage',
    [REGENERATION]: 'HRegeneration',
    [ENERGY_REGENERATION]: 'HEnergy_regeneration',
    [PROTECTION]: 'HProtection',
    [PROT_FROM_SHAPE_CHANGERS]: 'HProtection_from_shape_changers',
    [POLYMORPH]: 'HPolymorph', [POLYMORPH_CONTROL]: 'HPolymorph_control',
    [UNCHANGING]: 'HUnchanging', [FAST]: 'HFast', [REFLECTING]: 'HReflecting',
    [FREE_ACTION]: 'Free_action', [FIXED_ABIL]: 'Fixed_abil',
    [LIFESAVED]: 'Lifesaved',
};
// The bare-name spelling several modules write instead of the H<Prop> one.
function _propAltKey(key) { return key.startsWith('H') ? key.slice(1) : `H${key}`; }
// C ref: youprop.h H<Prop> — the intrinsic half only.
function H_prop(propidx) {
    const key = PROPKEY[propidx];
    if (!key) return 0;
    const p = game.u?.uprops || {};
    return (p[key] | 0) || (game.u?.[key] | 0)
        || (p[_propAltKey(key)] | 0) || (game.u?.[_propAltKey(key)] | 0)
        || (has_innate(key) ? 1 : 0);
}
// C ref: youprop.h E<Prop> — worn/wielded gear whose oc_oprop is `propidx`.
function E_prop(propidx) { return what_gives(propidx) ? 1 : 0; }
// C ref: youprop.h B<Prop> — the `blocked` column, which this port does not
// model (see the block comment above): always 0.
function B_prop(_propidx) { return 0; }
// C ref: youprop.h <Prop> == E<Prop> || H<Prop>, minus B<Prop>.
function Prop(propidx) { return !B_prop(propidx) && (E_prop(propidx) || H_prop(propidx)); }
// C ref: attrib.c from_what(propidx); the port's from_what() (above) wants the
// u.uprops key as its second argument.
function from_what_p(propidx) { return from_what(propidx, PROPKEY[propidx] || ''); }

// ── insight.c:117 enlght_out() ─────────────────────────────────────────────
export function enlght_out(buf) {
    if (ge.en_via_menu) {
        add_menu_str(ge.en_win, buf);
    } else {
        putstr(ge.en_win, 0, buf);
    }
}

// ── insight.c:126 enlght_line() ────────────────────────────────────────────
// insight.c:136 contra[] — applied only when " not " appears, first hit each.
const contra = [
    [' are not ', " aren't "],
    [' were not ', " weren't "],
    [' have not ', " haven't "],
    [' had not ', " hadn't "],
    [' can not ', " can't "],
    [' could not ', " couldn't "],
];
export function enlght_line(start, middle, end, ps) {
    let buf = ` ${start}${middle}${end}${ps}.`;
    if (buf.includes(' not ')) {
        for (let i = 0; i < contra.length; ++i)
            buf = strsubst(buf, contra[i][0], contra[i][1]);
    }
    enlght_out(buf);
}

// ── insight.c:159 enlght_combatinc() ───────────────────────────────────────
// Returns the formatted string (C fills the caller's outbuf and returns it).
export function enlght_combatinc(inctyp, incamt, final, _outbuf) {
    let modif, bonus, invrt, absamt;

    absamt = Math.abs(incamt);
    /* Protection amount is typically larger than damage or to-hit;
       reduce magnitude by a third in order to stretch modifier ranges
       (small:1..5, moderate:6..10, large:11..19, huge:20+) */
    if (inctyp === 'defense')
        absamt = Math.trunc((absamt * 2) / 3);

    if (absamt <= 3) modif = 'small';
    else if (absamt <= 6) modif = 'moderate';
    else if (absamt <= 12) modif = 'large';
    else modif = 'huge';

    modif = !incamt ? 'no' : an(modif); /* ("no" case shouldn't happen) */
    bonus = (incamt >= 0) ? 'bonus' : 'penalty';
    /* "bonus <foo>" (to hit) vs "<bar> bonus" (damage, defense) */
    invrt = (inctyp !== 'to hit');

    let outbuf = `${modif} ${invrt ? inctyp : bonus} ${invrt ? bonus : inctyp}`;
    if (final || _wizard())
        outbuf += ` (${(incamt > 0) ? '+' : ''}${incamt})`;
    return outbuf;
}

// ── insight.c:200 enlght_halfdmg() ─────────────────────────────────────────
export function enlght_halfdmg(category, final) {
    let category_name;

    switch (category) {
    case HALF_PHDAM: category_name = 'physical'; break;
    case HALF_SPDAM: category_name = 'spell'; break;
    default: category_name = 'unknown'; break;
    }
    const buf = ` ${(final || _wizard()) ? 'half' : 'reduced'} ${category_name} damage`;
    enl_msg(You_, 'take', 'took', buf, from_what_p(category), final);
}

// ── insight.c:223 walking_on_water() ───────────────────────────────────────
export function walking_on_water() {
    const u = game.u || {};
    if (u.uinwater || Prop(LEVITATION) || Prop(FLYING))
        return false;
    return !!(Prop(WWALKING) && is_pool_or_lava(u.ux, u.uy));
}

// ── insight.c:232 trap_predicament() ───────────────────────────────────────
// Returns the string (C fills outbuf and returns it).  Caller has verified
// u.utrap.
export function trap_predicament(_outbuf, final, wizxtra) {
    const u = game.u || {};
    let t, outbuf = '';

    switch (u.utraptype) {
    case TT_BURIEDBALL:
        outbuf = 'tethered to something buried';
        break;
    case TT_LAVA:
        outbuf = `sinking into ${final ? 'lava' : hliquid('lava')}`;
        break;
    case TT_INFLOOR:
        outbuf = `stuck in ${the_str(surface(u.ux, u.uy))}`;
        break;
    default: /* TT_BEARTRAP, TT_PIT, or TT_WEB */
        outbuf = 'trapped';
        if ((t = t_at(u.ux, u.uy)) !== 0 && t)  /* should never be null */
            outbuf += ` in ${an(trap_explanation(t.ttyp))}`;
        break;
    }
    if (wizxtra) { /* give extra information for wizard mode enlightenment */
        /* curly braces: u.utrap is an escape attempt counter rather than a
           turn timer so use different ornamentation than usual parentheses */
        outbuf += ` {${u.utrap | 0}}`;
    }
    return outbuf;
}

// ── insight.c:313 fmt_elapsed_time() ───────────────────────────────────────
// Returns the string (C fills outbuf and returns it).
export function fmt_elapsed_time(_outbuf, final) {
    let fieldcnt, edays, ehours, eminutes, eseconds;
    /* for a game that's over, reallydone() has updated urealtime.realtime to
       its final value before calling us during end of game disclosure */
    let etim = game.urealtime?.realtime | 0;

    if (!final)
        etim += timet_delta(getnow(), game.urealtime?.start_timing);
    eseconds = etim % 60; etim = Math.trunc(etim / 60);
    eminutes = etim % 60; etim = Math.trunc(etim / 60);
    ehours = etim % 24;
    edays = Math.trunc(etim / 24);
    fieldcnt = (edays ? 1 : 0) + (ehours ? 1 : 0) + (eminutes ? 1 : 0)
               + (eseconds ? 1 : 0);

    let outbuf = fieldcnt ? '' : ' none'; /* 'none' should never happen */
    if (edays) {
        outbuf += ` ${edays} day${plur(edays)}`;
        if (fieldcnt > 1) /* hours and/or minutes and/or seconds to follow */
            outbuf += (fieldcnt === 2) ? ' and' : ',';
        --fieldcnt;
    }
    if (ehours) {
        outbuf += ` ${ehours} hour${plur(ehours)}`;
        if (fieldcnt > 1) /* minutes and/or seconds to follow */
            outbuf += (fieldcnt === 2) ? ' and' : ',';
        --fieldcnt;
    }
    if (eminutes) {
        outbuf += ` ${eminutes} minute${plur(eminutes)}`;
        if (fieldcnt > 1) /* seconds to follow */
            outbuf += ' and';
    }
    if (eseconds)
        outbuf += ` ${eseconds} second${plur(eseconds)}`;
    return outbuf;
}
// C ref: hacklib.c getnow()/timet_delta() — wall-clock accounting, which this
// port does not keep (js/save.js:803 notes urealtime is not modelled), so the
// live-session delta is 0 and fmt_elapsed_time() reports " none".
function getnow() { return 0; }
function timet_delta(now, then) { return (then == null) ? 0 : (now - then); }

// ── insight.c:382 enlightenment() ──────────────────────────────────────────
// (js/artifact.js:484 has an `enlightenment: null` object key, which makes the
// coverage tool believe this was already ported; it was not.)
export function enlightenment(mode, final) {
    let buf, tmpbuf;

    ge.en_win = create_nhwindow(NHW_MENU);
    ge.en_via_menu = !final;
    if (ge.en_via_menu)
        start_menu(ge.en_win, MENU_BEHAVE_STANDARD);

    tmpbuf = String(game.plname ?? '');
    tmpbuf = highc(tmpbuf.charAt(0)) + tmpbuf.slice(1); /* same as bottom line */
    /* as in background_enlightenment, when poly'd we need to use the saved
       gender in u.mfemale rather than the current you-as-monster gender */
    buf = `${tmpbuf} the ${
        ((game.u?.Upolyd ? game.u?.mfemale : game.flags?.female)
         && game.urole?.name?.f) ? game.urole.name.f : game.urole?.name?.m
    }'s attributes:`;

    /* title */
    enlght_out(buf); /* "Conan the Archeologist's attributes:" */
    /* background and characteristics; ^X or end-of-game disclosure */
    if (mode & BASICENLIGHTENMENT) {
        /* role, race, alignment, deities, dungeon level, time, experience */
        background_enlightenment(mode, final);
        /* hit points, energy points, armor class, gold */
        basics_enlightenment(mode, final);
        /* strength, dexterity, &c */
        characteristics_enlightenment(mode, final);
    }
    /* expanded status line information */
    status_enlightenment(mode, final);
    /* remaining attributes */
    if (mode & MAGICENLIGHTENMENT) {
        attributes_enlightenment(mode, final);
    }

    enlght_out(''); /* separator */
    enlght_out('Miscellaneous:');
    /* reminder to player and/or information for dumplog */
    if ((mode & BASICENLIGHTENMENT) !== 0 && (_wizard() || _discover() || final)) {
        if (_wizard() || _discover()) {
            buf = `running in ${_wizard() ? 'debug' : 'explore'} mode`;
            you_are(buf, '', final);
        }

        if (!game.flags?.bones) {
            /* mention not saving bones iff hero just died */
            buf = `disabled loading${
                (final === ENL_GAMEOVERDEAD) ? ' and storing' : ''} of bones levels`;
            you_have_X(buf, final);
        } else if (!game.u?.uroleplay?.numbones) {
            enl_msg(You_, "haven't encountered", "didn't encounter",
                    ' any bones levels', '', final);
        } else {
            const nb = game.u.uroleplay.numbones;
            buf = `encountered ${nb} bones level${plur(nb)}`;
            you_have_X(buf, final);
        }
    }
    buf = fmt_elapsed_time(null, final);
    enl_msg('Total elapsed playing time ', 'is', 'was', buf, '', final);

    if (!ge.en_via_menu) {
        display_nhwindow(ge.en_win, true);
    } else {
        end_menu(ge.en_win, null);
        select_menu(ge.en_win, PICK_NONE, null);
        ge.en_via_menu = false;
    }
    destroy_nhwindow(ge.en_win);
    ge.en_win = WIN_ERR;
}

// ── insight.c:467 background_enlightenment() ───────────────────────────────
export function background_enlightenment(_unused_mode, final) {
    const u = game.u || {};
    let role_titl, rank_titl;
    let innategend, difgend, difalgn;
    let buf, tmpbuf;

    /* note that if poly'd, we need to use u.mfemale instead of flags.female */
    innategend = (u.Upolyd ? u.mfemale : game.flags?.female) ? 1 : 0;
    role_titl = (innategend && game.urole?.name?.f) ? game.urole.name.f
                                                    : game.urole?.name?.m;
    rank_titl = rank_of(u.ulevel, Role_switch(), !!innategend);

    enlght_out(''); /* separator after title */
    enlght_out('Background:');

    /* if polymorphed, report current shape before underlying role */
    if (u.Upolyd) {
        const uasmon = game.youmonst?.data;
        const altphrasing = vampshifted(game.youmonst);

        tmpbuf = '';
        /* here we always use current gender, not saved role gender */
        if (!is_male(uasmon) && !is_female(uasmon) && !is_neuter(uasmon))
            tmpbuf = `${genders[game.flags?.female ? 1 : 0].adj} `;
        if (altphrasing)
            tmpbuf += `${pmname(monster_by_pmidx(game.youmonst?.cham),
                                game.flags?.female ? FEMALE : MALE)} in `;
        buf = `${!final ? 'currently ' : ''}${
            altphrasing ? just_an(tmpbuf) : 'in '}${tmpbuf}${
            pmname(uasmon, game.flags?.female ? FEMALE : MALE)} form`;
        you_are(buf, '', final);
    }

    /* report role; omit gender if it's redundant (eg, "female priestess") */
    tmpbuf = '';
    if (!game.urole?.name?.f
        && (((game.urole?.allow | 0) & ROLE_GENDMASK) === (ROLE_MALE | ROLE_FEMALE)
            || innategend !== (game.flags?.initgend | 0)))
        tmpbuf = `${genders[innategend].adj} `;
    buf = '';
    if (u.Upolyd)
        buf = 'actually '; /* "You are actually a ..." */
    if (strcmpi(rank_titl, role_titl) === 0) {
        /* omit role when rank title matches it */
        buf += `${an(rank_titl)}, level ${u.ulevel} ${tmpbuf}${game.urace?.noun}`;
    } else {
        buf += `${an(rank_titl)}, a level ${u.ulevel} ${tmpbuf}${game.urace?.adj} ${role_titl}`;
    }
    you_are(buf, '', final);

    /* report alignment (bypass you_are() in order to omit ending period) */
    buf = ` ${You_}${!final ? are : were}${align_str(u.ualign?.type)}, ${
        /* helm of opposite alignment (might hide conversion) */
        (u.ualign?.type !== u.ualignbase?.[A_CURRENT])
            ? (!final ? 'currently ' : 'temporarily ')
            /* permanent conversion */
            : (u.ualign?.type !== u.ualignbase?.[A_ORIGINAL])
                ? (!final ? 'now ' : 'belatedly ')
                /* atheist (ignored in very early game) */
                : (!u.uconduct?.gnostic && (game.moves | 0) > 1000)
                    ? 'nominally '
                    /* lastly, normal case */
                    : ''
    }on a mission for ${u_gname()}`;
    enlght_out(buf);
    /* show the rest of this game's pantheon (finishes previous sentence) */
    buf = ` who ${!final ? 'is' : 'was'} opposed by`;
    if (u.ualign?.type !== A_LAWFUL)
        buf += ` ${align_gname_c(A_LAWFUL)} (${align_str(A_LAWFUL)}) and`;
    if (u.ualign?.type !== A_NEUTRAL)
        buf += ` ${align_gname_c(A_NEUTRAL)} (${align_str(A_NEUTRAL)})${
            (u.ualign?.type !== A_CHAOTIC) ? ' and' : ''}`;
    if (u.ualign?.type !== A_CHAOTIC)
        buf += ` ${align_gname_c(A_CHAOTIC)} (${align_str(A_CHAOTIC)})`;
    buf += '.'; /* terminate sentence */
    enlght_out(buf);

    /* show original alignment,gender,race,role if any have been changed */
    difgend = (innategend !== (game.flags?.initgend | 0)) ? 1 : 0;
    difalgn = ((u.ualign?.type !== u.ualignbase?.[A_CURRENT]) ? 1 : 0)
              + ((u.ualignbase?.[A_CURRENT] !== u.ualignbase?.[A_ORIGINAL]) ? 2 : 0);
    if (difalgn & 1) { /* have temporary alignment so report permanent one */
        buf = `actually ${align_str(u.ualignbase?.[A_CURRENT])}`;
        you_are(buf, '', final);
        difalgn &= ~1; /* suppress helm from "started out <foo>" message */
    }
    if (difgend || difalgn) { /* sex change or perm align change or both */
        buf = ` You started out ${
            difgend ? genders[game.flags?.initgend | 0].adj : ''}${
            (difgend && difalgn) ? ' and ' : ''}${
            difalgn ? align_str(u.ualignbase?.[A_ORIGINAL]) : ''}.`;
        enlght_out(buf);
    }

    /* "You are left-handed." won't work well if polymorphed into something
       without hands; use "You are normally left-handed." then */
    buf = `${(body_part(HANDED) === 'handed') ? '' : 'normally '}${
        URIGHTY() ? 'right' : 'left'}-handed`;
    you_are(buf, '', final);

    /* dungeon level */
    buf = ''; tmpbuf = '';
    if (In_endgame(u.uz)) {
        const egdepth = observable_depth(u.uz);

        tmpbuf = endgamelevelname(egdepth);
        buf = `in the endgame, on the ${
            tmpbuf.startsWith('Plane') ? 'Elemental ' : ''}${tmpbuf}`;
    } else if (Is_knox_level(u.uz)) {
        /* this gives away the fact that the knox branch is only 1 level */
        buf = `on the ${game.dungeons?.[u.uz?.dnum ?? 0]?.dname} level`;
    } else {
        let dgnbuf = String(game.dungeons?.[u.uz?.dnum ?? 0]?.dname ?? '');
        if (/^the /i.test(dgnbuf))
            dgnbuf = lowc(dgnbuf.charAt(0)) + dgnbuf.slice(1);
        tmpbuf = `level ${In_quest(u.uz) ? (u.uz?.dlevel | 0) : depth(u.uz)}`;
        if (Is_rogue_level(u.uz))
            tmpbuf += ', a primitive area';
        else if (Is_bigroom(u.uz) && !Blind())
            tmpbuf += ', a very big room';
        buf = `in ${dgnbuf}, on ${tmpbuf}`;
    }
    you_are(buf, '', final);

    /* this is shown even if the 'time' option is off */
    if ((game.moves | 0) === 1) {
        you_have('just started your adventure', '', final);
    } else {
        /* 'turns' grates on the nerves in this context... */
        buf = `the dungeon ${game.moves} turn${plur(game.moves)} ago`;
        /* same phrasing for current and final: "entered" is unconditional */
        enlght_line(You_, 'entered ', buf, '');
    }

    /* for gameover, these have been obtained in really_done() */
    if (final ? game.iflags?.at_midnight : midnight()) {
        enl_msg('It ', 'is ', 'was ', 'the midnight hour', '', final);
    } else if (final ? game.iflags?.at_night : night()) {
        enl_msg('It ', 'is ', 'was ', 'nighttime', '', final);
    }
    /* other environmental factors.  C latches flags.moonphase/flags.friday13
       in newgame(); this port computes them live from game.datetime. */
    const moonphase = game.flags?.moonphase ?? phase_of_the_moon();
    if (moonphase === FULL_MOON || moonphase === NEW_MOON) {
        buf = `a ${
            (moonphase === FULL_MOON) ? 'full'
            : (moonphase === NEW_MOON) ? 'new'
            : (moonphase < FULL_MOON) ? 'first quarter' : 'last quarter'
        } moon in effect${final ? ' when your adventure ended' : ''}`;
        enl_msg('There ', 'is ', 'was ', buf, '', final);
    }
    if (game.flags?.friday13 ?? friday_13th()) {
        /* let player know that friday13 penalty is/was in effect */
        buf = ` Bad things ${
            !final ? 'can happen'
            : (final === ENL_GAMEOVERALIVE) ? 'could have happened'
            : 'happened'} on Friday the 13th.`;
        enlght_out(buf);
    }

    if (!u.Upolyd) {
        const ulvl = u.ulevel | 0;

        /* experience level is already shown above */
        buf = `${u.uexp | 0} experience point${plur(u.uexp | 0)}`;
        if (ulvl < 30 && (final || _wizard())) {
            const nxtlvl = newuexp(ulvl), delta = nxtlvl - (u.uexp | 0);

            buf += `, ${delta} ${((u.uexp | 0) > 0) ? 'more ' : ''}${
                /* present tense=="needed", past tense=="were needed" */
                !final ? '' : (delta === 1) ? 'was ' : 'were '
            }needed ${(ulvl < 18) ? 'to attain' : 'for'} level ${ulvl + 1}`;
        }
        you_have(buf, '', final);
    }
    /* SCORE_ON_BOTL */
    if (game.flags?.showscore) {
        buf = `${botl_score()}${!final ? '' : ' before end-of-game adjustments'}`;
        enl_msg('Your score ', 'is ', 'was ', buf, '', final);
    }
}

// ── insight.c:727 basics_enlightenment() ───────────────────────────────────
const Power = 'energy points (spell power)';
export function basics_enlightenment(_mode, final) {
    const u = game.u || {};
    let buf;
    const pw = u.uen | 0, pwmax = u.uenmax | 0,
          hpmax = (u.Upolyd ? u.mhmax : u.uhpmax) | 0;
    let hp = (u.Upolyd ? u.mh : u.uhp) | 0;

    enlght_out(''); /* separator after background */
    enlght_out('Basics:');

    if (hp < 0)
        hp = 0;
    /* "1 out of 1" rather than "all" if max is only 1; should never happen */
    if (hp === hpmax && hpmax > 1)
        buf = `all ${hpmax} hit points`;
    else
        buf = `${hp} out of ${hpmax} hit point${plur(hpmax)}`;
    you_have(buf, '', final);

    /* low max energy is feasible, so handle couple of extra special cases */
    if (pwmax === 0 || (pw === pwmax && pwmax === 2)) /* both: not "all 2" */
        buf = `${!pwmax ? 'no' : 'both'} ${Power}`;
    else if (pw === pwmax && pwmax > 2)
        buf = `all ${pwmax} ${Power}`;
    else
        buf = `${pw} out of ${pwmax} ${Power}`;
    you_have(buf, '', final);

    if (u.Upolyd) {
        switch (monster_by_pmidx(u.umonnum)?.mlevel | 0) {
        case 0:
            /* status line currently being explained shows "HD:0" */
            buf = '0 hit dice (actually 1/2)';
            break;
        case 1:
            buf = '1 hit die';
            break;
        default:
            buf = `${monster_by_pmidx(u.umonnum)?.mlevel | 0} hit dice`;
            break;
        }
        you_have(buf, '', final);
    }

    find_ac(); /* enforces AC_MAX cap */
    buf = `${u.uac | 0}`;
    if (Math.abs(u.uac | 0) === AC_MAX)
        buf += `, the ${((u.uac | 0) < 0) ? 'best' : 'worst'} possible`;
    enl_msg('Your armor class ', 'is ', 'was ', buf, '', final);

    /* gold; includes container contents, unlike status line but like doprgold */
    {
        const umoney = money_cnt_invent(), hmoney = hidden_gold(final);

        if (!umoney) {
            buf = ` Your wallet ${!final ? 'is' : 'was'} empty`;
        } else {
            buf = ` Your wallet contain${!final ? 's' : 'ed'} ${umoney} ${currency(umoney)}`;
        }
        /* terminate the wallet line if appropriate, otherwise add an
           introduction to subsequent continuation; output now either way */
        buf += !hmoney ? '.' : !umoney ? ', but' : ', and';
        enlght_out(buf);

        /* put contained gold on its own line to avoid excessive width */
        if (hmoney) {
            buf = `${hmoney} ${umoney ? 'more' : currency(hmoney)} stashed away in your pack`;
            enl_msg('you ', 'have ', 'had ', buf, '', final);
        }
    }

    if (game.flags?.pickup) {
        buf = 'on';
        if (costly_spot(u.ux, u.uy)) {
            /* being in a shop inhibits autopickup, even 'pickup_thrown' */
            buf += ', but temporarily disabled while inside the shop';
        } else {
            /* C: oc_to_str(flags.pickup_types, ocl).  This port's options
               storage keeps pickup_types as the SYMBOL STRING already
               ([[options-storage-contract]]), so the conversion is identity. */
            const ocl = game.flags.pickup_types || '';
            buf += ` for ${ocl ? "'" : ''}${ocl ? ocl : 'all types'}${ocl ? "'" : ''}`;
            if (game.flags.pickup_thrown && ocl)
                buf += ' plus thrown'; /* show when not 'all types' */
            if (game.apelist && game.apelist.length)
                buf += ', with exceptions';
        }
    } else {
        buf = 'off';
    }
    enl_msg('Autopickup ', 'is ', 'was ', buf, '', final);
}

// ── insight.c:826 characteristics_enlightenment() ──────────────────────────
export function characteristics_enlightenment(mode, final) {
    enlght_out('');
    enlght_out(`${!final ? '' : 'Final '}Characteristics:`);

    /* bottom line order */
    one_characteristic(mode, final, A_STR); /* strength */
    one_characteristic(mode, final, A_DEX); /* dexterity */
    one_characteristic(mode, final, A_CON); /* constitution */
    one_characteristic(mode, final, A_INT); /* intelligence */
    one_characteristic(mode, final, A_WIS); /* wisdom */
    one_characteristic(mode, final, A_CHA); /* charisma */
}

// ── insight.c:845 one_characteristic() ─────────────────────────────────────
// attrib.c:20 attrname[], indexed by A_STR..A_CHA.
const attrname = ['strength', 'intelligence', 'wisdom',
                  'dexterity', 'constitution', 'charisma'];
// js/mkobj.js objects[] indices (cross-checked against js/do_wear.js:32/58
// and js/do.js:2417, which name them).
const GAUNTLETS_OF_POWER = 161, DUNCE_CAP = 94, RIN_SUSTAIN_ABILITY = 182;
export function one_characteristic(mode, final, attrindx) {
    const u = game.u || {};
    let hide_innate_value = false, interesting_alimit;
    let acurrent, abase, apeak, alimit;
    let paren_pfx;
    let subjbuf, valubuf;

    /* being polymorphed or wearing certain cursed items prevents hero from
       reliably tracking changes to characteristics */
    if (u.Upolyd) {
        hide_innate_value = true;
    } else if (Prop(FIXED_ABIL)) {
        if (stuck_ring(game.uleft, RIN_SUSTAIN_ABILITY)
            || stuck_ring(game.uright, RIN_SUSTAIN_ABILITY))
            hide_innate_value = true;
    }
    switch (attrindx) {
    case A_STR:
        if (game.uarmg && game.uarmg.otyp === GAUNTLETS_OF_POWER
            && game.uarmg.cursed)
            hide_innate_value = true;
        break;
    case A_DEX:
        break;
    case A_CON:
        if (u_wield_art(ART_OGRESMASHER) && game.uwep?.cursed)
            hide_innate_value = true;
        break;
    case A_INT:
        if (game.uarmh && game.uarmh.otyp === DUNCE_CAP && game.uarmh.cursed)
            hide_innate_value = true;
        break;
    case A_WIS:
        if (game.uarmh && game.uarmh.otyp === DUNCE_CAP && game.uarmh.cursed)
            hide_innate_value = true;
        break;
    case A_CHA:
        break;
    default:
        return; /* impossible */
    }
    /* note: final disclosure includes MAGICENLIGHTENTMENT */
    if ((mode & MAGICENLIGHTENMENT) && !u.Upolyd)
        hide_innate_value = false;

    acurrent = acurr_eff(attrindx);      /* ACURR(attrindx) */
    valubuf = attrval(attrindx, acurrent);
    subjbuf = `Your ${attrname[attrindx]} `;

    if (!hide_innate_value) {
        abase = u.acurr?.a?.[attrindx] ?? acurrent;         /* ABASE */
        apeak = u.amax?.a?.[attrindx] ?? abase;             /* AMAX */
        alimit = race_attrmax()[attrindx] ?? 18;            /* ATTRMAX */
        /* criterium for whether the limit is interesting varies */
        interesting_alimit =
            final ? true /* was originally `(abase != alimit)' */
                  : (alimit !== ((attrindx !== A_STR) ? 18 : STR18(100)));
        paren_pfx = final ? ' (' : ' (current; ';
        if (acurrent !== abase) {
            valubuf += `${paren_pfx}base:${attrval(attrindx, abase)}`;
            paren_pfx = ', ';
        }
        if (abase !== apeak) {
            valubuf += `${paren_pfx}peak:${attrval(attrindx, apeak)}`;
            paren_pfx = ', ';
        }
        if (interesting_alimit) {
            valubuf += `${paren_pfx}${
                /* more verbose if exceeding 'limit' due to magic bonus */
                (acurrent > alimit) ? 'innate ' : ''}limit:${
                attrval(attrindx, alimit)}`;
        }
        if (acurrent !== abase || abase !== apeak || interesting_alimit)
            valubuf += ')';
    }
    enl_msg(subjbuf, 'is ', 'was ', valubuf, '', final);
}
// C ref: attrib.h STR18(x) == 18 + x — the 18/01..18/100 encoding.
function STR18(x) { return 18 + x; }
// C ref: artifact.c u_wield_art(art) — no artifact is wielded on any covered
// path and js/artifact.js keeps its equivalent private, so this reads FALSE.
const ART_OGRESMASHER = 0;
function u_wield_art(_art) { return false; }

// ── insight.c:939 status_enlightenment() ───────────────────────────────────
export function status_enlightenment(mode, final) {
    const u = game.u || {};
    const magic = (mode & MAGICENLIGHTENMENT) ? true : false;
    let cap;
    let buf, youtoo, heldmon;
    const Riding = !!(u.usteed
                      /* if hero dies while dismounting, u.usteed will still be
                         set; we want to ignore steed in that situation */
                      && !(final === ENL_GAMEOVERDEAD
                           && game.killer?.name === 'riding accident'));
    /* C: x_monnam(u.usteed, mtame ? ARTICLE_YOUR : ARTICLE_THE, NULL,
       SUPPRESS_SADDLE | SUPPRESS_HALLUCINATION, FALSE).  do_name.js keeps
       x_monnam() module-private (js/do_name.js:27) and its y_monnam() is the
       same call minus SUPPRESS_HALLUCINATION; the fix is to export x_monnam. */
    const steedname = (!Riding ? null : y_monnam(u.usteed));

    /*\
     * Status (many are abbreviated on bottom line; others are or
     *     should be discernible to the hero hence to the player)
    \*/
    enlght_out(''); /* separator after title or characteristics */
    enlght_out(final ? 'Final Status:' : 'Status:');

    youtoo = You_;
    /* not a traditional status but inherently obvious to player */
    if (u.Upolyd) {
        buf = 'transformed';
        if (ugenocided())
            buf += ` and ${final ? 'felt' : 'feel'} ${udeadinside()} inside`;
        you_are(buf, '', final);
    }
    /* display riding status before maybe reporting steed as trapped */
    if (Riding) {
        buf = `riding ${steedname}`;
        you_are(buf, '', final);
        youtoo += `and ${steedname} `;
    }
    /* other movement situations that hero should always know */
    if (Prop(LEVITATION)) {
        if (Lev_at_will() && magic)
            you_are('levitating, at will', '', final);
        else
            enl_msg(youtoo, are, were, 'levitating', from_what_p(LEVITATION), final);
    } else if (Prop(FLYING)) { /* can only fly when not levitating */
        enl_msg(youtoo, are, were, 'flying', from_what_p(FLYING), final);
    }
    if (Underwater()) {
        you_are('underwater', '', final);
    } else if (u.uinwater) {
        you_are(Prop(SWIMMING) ? 'swimming' : 'in water',
                from_what_p(SWIMMING), final);
    } else if (walking_on_water()) {
        /* show active Wwalking here, potential Wwalking elsewhere */
        buf = `walking on ${
            is_pool(u.ux, u.uy) ? 'water'
            : is_lava(u.ux, u.uy) ? 'lava'
              : surface(u.ux, u.uy)}`; /* catchall; shouldn't happen */
        you_are(buf, from_what_p(WWALKING), final);
    }
    if (u.Upolyd && (u.uundetected || U_AP_TYPE() !== M_AP_NOTHING))
        youhiding(true, final);

    /* internal troubles, mostly in the order that prayer ranks them */
    if (H_prop(STONED)) {
        if (final && (H_prop(STONED) & I_SPECIAL))
            enlght_out(' You turned into stone.');
        else
            you_are('turning to stone', '', final);
    }
    if (H_prop(SLIMED)) {
        if (final && (H_prop(SLIMED) & I_SPECIAL))
            enlght_out(' You turned into slime.');
        else
            you_are('turning into slime', '', final);
    }
    if (H_prop(STRANGLED)) {
        if (u.uburied) {
            you_are('buried', '', final);
        } else {
            if (final && (H_prop(STRANGLED) & I_SPECIAL)) {
                enlght_out(' You died from strangulation.');
            } else {
                buf = 'being strangled';
                if (_wizard())
                    buf += ` (${H_prop(STRANGLED) & TIMEOUT_MASK})`;
                you_are(buf, from_what_p(STRANGLED), final);
            }
        }
    }
    if (H_prop(SICK)) {
        /* the two types of sickness are lumped together */
        if (final && (H_prop(SICK) & I_SPECIAL)) {
            buf = ` ${You_}died from ${
                (u.usick_type & SICK_NONVOMITABLE)
                ? 'terminal illness' : 'food poisoning'}.`;
            enlght_out(buf);
        } else {
            /* report the two cases separately: one can be cured alone */
            if (u.usick_type & SICK_NONVOMITABLE)
                you_are('terminally sick from illness', '', final);
            if (u.usick_type & SICK_VOMITABLE)
                you_are('terminally sick from food poisoning', '', final);
        }
    }
    if (H_prop(VOMITING))
        you_are('nauseated', '', final);
    if (Prop(STUNNED))
        you_are('stunned', '', final);
    if (Prop(CONFUSION))
        you_are('confused', '', final);
    if (Prop(HALLUC))
        you_are('hallucinating', '', final);
    if (Blind()) {
        /* check the reasons in same order as from_what() */
        buf = `${
            (H_prop(BLINDED) & FROMOUTSIDE) !== 0 ? 'permanently'
            : (H_prop(BLINDED) & FROMFORM) ? 'innately'
              : Blindfolded_only() ? 'deliberately'
                /* timed, possibly combined with blindfold */
                : 'temporarily'} blind`;
        if (_wizard() && (H_prop(BLINDED) === BlindedTimeout() && !Blindfolded()))
            buf += ` (${BlindedTimeout()})`;
        /* !haseyes: avoid "you are innately blind innately" */
        you_are(buf, !haseyes(game.youmonst?.data) ? '' : from_what_p(BLINDED),
                final);
    }
    if (Prop(DEAF))
        you_are('deaf', from_what_p(DEAF), final);

    /* external troubles, more or less */
    if (Punished()) {
        if (game.uball) {
            buf = `chained to ${ansimpleoname(game.uball)}`;
        } else {
            /* impossible("Punished without uball?") */
            buf = 'punished';
        }
        you_are(buf, '', final);
    }
    if (u.utrap) {
        const anchored = (u.utraptype === TT_BURIEDBALL);
        const predicament = trap_predicament(null, final, _wizard());

        if (u.usteed) { /* not `Riding' here */
            buf = `${anchored ? 'you and ' : ''}${steedname} `;
            buf = highc(buf.charAt(0)) + buf.slice(1);
            enl_msg(buf, (anchored ? 'are ' : 'is '),
                    (anchored ? 'were ' : 'was '), predicament, '', final);
        } else {
            you_are(predicament, '', final);
        }
    } /* (u.utrap) */
    heldmon = ''; /* lint suppression */
    if (u.ustuck) { /* includes u.uswallow */
        heldmon = a_monnam(u.ustuck);
        if (heldmon === 'it'
            && (!has_mgivenname(u.ustuck) || MGIVENNAME(u.ustuck) !== 'it'))
            heldmon = 'an unseen creature';
    }
    if (u.uswallow) {
        buf = `${digests(u.ustuck?.data) ? 'swallowed' : 'engulfed'} by ${heldmon}`;
        if (dmgtype(u.ustuck?.data, AD_DGST)) {
            /* if final, death via digestion can be deduced by u.uswallow
               still being True and u.uswldtim having been decremented to 0 */
            if (final && !u.uswldtim)
                buf += ' and got totally digested';
            else
                buf += ` and ${final ? 'were' : 'are'} being digested`;
        }
        if (_wizard())
            buf += ` (${u.uswldtim | 0})`;
        you_are(buf, '', final);
    } else if (u.ustuck) {
        const ustick = !!(u.Upolyd && sticks(game.youmonst?.data));
        const dx = u.ustuck.mx - u.ux, dy = u.ustuck.my - u.uy;

        buf = `${ustick ? 'holding' : 'held by'} ${heldmon} (${
            dxdy_to_dist_descr(dx, dy, true)})`;
        you_are(buf, '', final);
    }
    if (Riding) {
        const saddle = which_armor(u.usteed, W_SADDLE);

        if (saddle && saddle.cursed) {
            buf = `stuck to ${s_suffix(steedname)} ${simpleonames(saddle)}`;
            you_are(buf, '', final);
        }
    }
    if (Prop(WOUNDED_LEGS)) {
        /* EWounded_legs tracks left/right/both; HWounded_legs is the timeout;
           both apply to steed instead of hero when mounted */
        const whichleg = EWounded_legs() & BOTH_SIDES;
        let bp = u.usteed ? mbodypart(u.usteed, LEG) : body_part(LEG),
            article = 'a ', /* precedes "wounded", so never "an " */
            leftright = '';

        if (whichleg === BOTH_SIDES) {
            bp = objnam_makeplural(bp); article = '';
        } else {
            leftright = (whichleg === LEFT_SIDE) ? 'left ' : 'right ';
        }
        buf = `${article}wounded ${leftright}${bp}`;

        /* when mounted, Wounded_legs applies to steed rather than to hero;
           we only report steed's wounded legs in wizard mode */
        if (u.usteed) { /* not `Riding' here */
            if (_wizard() && steedname) {
                let steednambuf = steedname;
                steednambuf = highc(steednambuf.charAt(0)) + steednambuf.slice(1);
                enl_msg(steednambuf, ' has ', ' had ', buf, '', final);
            }
        } else {
            you_have(buf, '', final);
        }
    }
    if (H_prop(GLIB)) {
        buf = `slippery ${fingers_or_gloves(true)}`;
        if (_wizard())
            buf += ` (${H_prop(GLIB) & TIMEOUT_MASK})`;
        you_have(buf, '', final);
    }
    if (Prop(FUMBLING)) {
        if (magic || cause_known(FUMBLING))
            enl_msg(You_, 'fumble', 'fumbled', '', from_what_p(FUMBLING), final);
    }
    if (Prop(SLEEPY)) {
        if (magic || cause_known(SLEEPY)) {
            buf = from_what_p(SLEEPY);
            if (_wizard())
                buf += ` (${H_prop(SLEEPY) & TIMEOUT_MASK})`;
            enl_msg('You ', 'fall', 'fell', ' asleep uncontrollably', buf, final);
        }
    }
    /* hunger/nutrition */
    if (Prop(HUNGER)) {
        if (magic || cause_known(HUNGER))
            enl_msg(You_, 'hunger', 'hungered', ' rapidly',
                    from_what_p(HUNGER), final);
    }
    buf = HU_STAT[u.uhs | 0] || ''; /* hunger status; omitted if "normal" */
    buf = mungspaces(buf);          /* strip trailing spaces */
    /* status line doesn't show hunger when state is "not hungry", we do */
    if (!buf)
        buf = 'not hungry';
    if (buf) { /* (since "not hungry" was added, this is always True) */
        buf = lowc(buf.charAt(0)) + buf.slice(1); /* override capitalization */
        if (buf === 'weak')
            buf += ' from severe hunger';
        else if (buf.startsWith('faint')) /* fainting, fainted */
            buf += ' due to starvation';
        if (_wizard())
            buf += ` <${u.uhunger | 0}>`;
        you_are(buf, '', final);
    }
    /* encumbrance */
    if ((cap = near_capacity()) > UNENCUMBERED) {
        let adj = '?_?'; /* (should always get overridden) */

        buf = enc_stat[cap];
        buf = lowc(buf.charAt(0)) + buf.slice(1);
        switch (cap) {
        case SLT_ENCUMBER: adj = 'slightly'; break;   /* burdened */
        case MOD_ENCUMBER: adj = 'moderately'; break; /* stressed */
        case HVY_ENCUMBER: adj = 'very'; break;       /* strained */
        case EXT_ENCUMBER: adj = 'extremely'; break;  /* overtaxed */
        case OVERLOADED: adj = 'not possible'; break;
        }
        if (_wizard())
            buf += ` <${inv_weight()}>`;
        buf += `; movement ${!final ? 'is' : 'was'} ${adj}${
            (cap < OVERLOADED) ? ' slowed' : ''}`;
        you_are(buf, '', final);
    } else {
        /* last resort entry, guarantees Status section is non-empty */
        buf = 'unencumbered';
        if (_wizard())
            buf += ` <${inv_weight()}>`;
        you_are(buf, '', final);
    }
    /* current weapon(s) and corresponding skill level(s) */
    weapon_insight(final);
    /* the monk's suit penalty is too blatant to be restricted to magic */
    if (game.iflags?.tux_penalty && !u.Upolyd) {
        buf = enlght_combatinc('to hit', -(game.urole?.spelarmr | 0), final, null);
        buf += ` due to your ${suit_simple_name(game.uarm)}`;
        you_have(buf, '', final);
    }
    /* report 'nudity' */
    if (!game.uarm && !game.uarmu && !game.uarmc && !game.uarms && !game.uarmg
        && !game.uarmf && !game.uarmh) {
        if (u.uroleplay?.nudist)
            enl_msg(You_, 'do', 'did', ' not wear any armor', '', final);
        else
            you_are('not wearing any armor', '', final);
    }
}
// ── youprop.h helpers status_enlightenment() needs ────────────────────────
// C ref: youprop.h Lev_at_will == ((HLevitation & I_SPECIAL) != 0L).
function Lev_at_will() { return (H_prop(LEVITATION) & I_SPECIAL) !== 0; }
// C ref: youprop.h Underwater == (u.uinwater && !Swimming) is not quite it;
// hack.h Underwater == (u.uinwater && (!Swimming || !Breathless)).  The port
// tracks only u.uinwater, so mirror C's shape against that.
function Underwater() {
    return !!(game.u?.uinwater && (!Prop(SWIMMING) || !Prop(MAGICAL_BREATHING)));
}
// C ref: youprop.h Punished == (uball != 0).
function Punished() { return !!game.uball; }
// C ref: prop.h W_SADDLE.
const W_SADDLE = 0x00100000;
// C ref: youprop.h Blindfolded == (ublindf && ublindf->otyp != LENSES).
const LENSES = 232; // js/invent.js:160
function Blindfolded() {
    return !!(game.ublindf && game.ublindf.otyp !== LENSES);
}
// C ref: youprop.h Blindfolded_only == (!(HBlinded || EBlinded) && Blindfolded).
function Blindfolded_only() {
    return !H_prop(BLINDED) && !E_prop(BLINDED) && Blindfolded();
}
// C ref: youprop.h BlindedTimeout == (HBlinded & TIMEOUT).
function BlindedTimeout() { return H_prop(BLINDED) & TIMEOUT_MASK; }
// C ref: mondata.h haseyes(ptr) == !(mflags1 & M1_NOEYES).  A null data row
// (an unpolymorphed hero: u.umonnum is a ROLE index here, so youmonst.data is
// not a valid mons[] row — [[umonnum-is-a-role-index]]) reads as having eyes.
function haseyes(ptr) { return !ptr || ((mflags1_of(ptr) & M1_NOEYES) === 0); }
// C ref: mondata.h U_AP_TYPE == gy.youmonst.m_ap_type.
function U_AP_TYPE() { return game.youmonst?.m_ap_type | 0; }
// C ref: mondata.h digests(ptr) == attacktype_fordmg(ptr, AT_ENGL, AD_DGST).
function digests(ptr) { return dmgtype(ptr, AD_DGST); }
// C ref: mondata.h sticks(ptr) — a form that grabs rather than being grabbed.
function sticks(ptr) { return !!ptr?.sticky; }
// C ref: youprop.h EWounded_legs — the left/right/both bitmask.
function EWounded_legs() {
    return (game.u?.uprops?.EWounded_legs | 0) || (game.u?.EWounded_legs | 0);
}
// C ref: sounds.c youhiding(via_enlghtmt, msgflag).  js/polyself.js:1720 has
// the (async, msgflag-only) reduced copy; the fix is to widen and export that.
function youhiding(_via_enlghtmt, _final) { /* no covered path is Upolyd */ }

// ── insight.c:1269 weapon_insight() ────────────────────────────────────────
const SHIELD_OF_REFLECTION = 158; // js/do_wear.js:56
export function weapon_insight(final) {
    const uwep = game.uwep, uswapwep = game.uswapwep;
    let buf, wtype;

    /* report being weaponless; distinguish whether gloves are worn */
    if (!uwep) {
        you_are(empty_handed(), '', final);

    /* two-weaponing implies hands and a weapon in each hand */
    } else if (game.u?.twoweap) {
        you_are('wielding two weapons at once', '', final);

    /* report most weapons by their skill class */
    } else {
        let what = weapon_descr(uwep);

        if (uwep.otyp === SHIELD_OF_REFLECTION)
            what = shield_simple_name(uwep); /* silver|smooth shield */
        else if (is_wet_towel(uwep))
            what = 'wet towel';

        if (strcmpi(what, 'armor') === 0 || strcmpi(what, 'food') === 0
            || strcmpi(what, 'venom') === 0)
            buf = `wielding some ${what}`;
        else
            buf = `wielding ${(uwep.quan === 1) ? an(what) : objnam_makeplural(what)}`;
        you_are(buf, '', final);
    }

    /*
     * Skill with current weapon.
     */
    if ((wtype = weapon_type(uwep)) !== P_NONE && (!uwep || !is_ammo(uwep))) {
        let sklvlbuf;
        const sklvl = p_skill_of(wtype);
        const hav = (sklvl !== P_UNSKILLED && sklvl !== P_SKILLED);

        if (sklvl === P_ISRESTRICTED)
            sklvlbuf = 'no';
        else
            sklvlbuf = skillLevelNameLc(sklvl);   /* lcase(skill_level_name()) */
        /* "you have no/basic/expert/master/grand-master skill with <skill>"
           or "you are unskilled/skilled in <skill>" */
        buf = `${sklvlbuf} ${hav ? 'skill with' : 'in'} ${skill_name(wtype)}`;

        if (!game.u?.twoweap) {
            if (can_advance_pub(wtype, false))
                buf += ` and ${!final ? 'can enhance' : 'could have enhanced'} that`;
            if (hav)
                you_have(buf, '', final);
            else
                you_are(buf, '', final);

        } else { /* two-weapon */
            const also_ = 'also ';
            let pfx, sfx, sknambuf2, sklvlbuf2, twobuf;
            let also = '', also2 = '', also3 = null, verb_present, verb_past;
            const wtype2 = weapon_type(uswapwep),
                  sklvl2 = p_skill_of(wtype2);
            let twoskl = p_skill_of(P_TWO_WEAPON_COMBAT);
            let a1, a2, ab;
            const hav2 = (sklvl2 !== P_UNSKILLED && sklvl2 !== P_SKILLED);

            /* normally hero must have access to two-weapon skill to initiate
               u.twoweap, but not if polymorphed into a multi-attack form */
            if (twoskl === P_ISRESTRICTED) {
                twoskl = P_UNSKILLED;
                twobuf = 'restricted';
            } else {
                twobuf = skillLevelNameLc(twoskl);
            }

            /* keep buf from above in case skill levels match */
            pfx = ''; sfx = '';
            if (twoskl < sklvl) {
                /* twoskl won't be restricted so sklvl is at least basic */
                pfx = `Your skill in ${skill_name(wtype)} `;
                sfx = ` limited by being ${twobuf} with two weapons`;
                also = also_;
            } else if (twoskl > sklvl) {
                /* sklvl might be restricted */
                pfx = 'Your two weapon skill ';
                sfx = ' limited by ';
                if (sklvl > P_ISRESTRICTED)
                    sfx += `being ${sklvlbuf}`;
                else
                    sfx += 'having no skill';
                sfx += ` with ${skill_name(wtype)}`;
                also2 = also_;
            } else {
                buf += ' and two weapons';
                also3 = also_;
            }
            if (pfx)
                enl_msg(pfx, 'is', 'was', sfx, '', final);
            else if (hav)
                you_have(buf, '', final);
            else
                you_are(buf, '', final);

            /* skip comparison between secondary and two-weapons if it is
               identical to the comparison between primary and twoweap */
            if (wtype2 !== wtype) {
                sknambuf2 = skill_name(wtype2);
                sklvlbuf2 = skillLevelNameLc(sklvl2);
                verb_present = 'is'; verb_past = 'was';
                pfx = ''; sfx = ''; buf = '';
                if (twoskl < sklvl2) {
                    pfx = `Your skill in ${sknambuf2} `;
                    sfx = ` ${also}limited by being ${twobuf} with two weapons`;
                } else if (twoskl > sklvl2) {
                    pfx = 'Your two weapon skill ';
                    sfx = ` ${also2}limited by `;
                    if (sklvl2 > P_ISRESTRICTED)
                        sfx += `being ${sklvlbuf2}`;
                    else
                        sfx += 'having no skill';
                    sfx += ` with ${sknambuf2}`;
                } else {
                    /* equal */
                    buf = `${sklvlbuf2} ${hav2 ? 'skill with' : 'in'} ${sknambuf2}`;
                    buf += ' and two weapons';
                    if (also3) {
                        pfx = 'You also ';
                        sfx = ` ${buf}`; buf = '';
                        verb_present = hav2 ? 'have' : 'are';
                        verb_past = hav2 ? 'had' : 'were';
                    }
                }
                if (pfx)
                    enl_msg(pfx, verb_present, verb_past, sfx, '', final);
                else if (hav2)
                    you_have(buf, '', final);
                else
                    you_are(buf, '', final);
            } /* wtype2 != wtype */

            /* if training and available skill credits already allow #enhance
               for any of primary, secondary, or two-weapon, say so */
            a1 = can_advance_pub(wtype, false);
            a2 = (wtype2 !== wtype) ? can_advance_pub(wtype2, false) : false;
            ab = can_advance_pub(P_TWO_WEAPON_COMBAT, false);
            if (a1 || a2 || ab) {
                const also_wik_ = ' and also with ';

                sfx = ` skill${
                    (((a1 ? 1 : 0) + (a2 ? 1 : 0) + (ab ? 1 : 0)) > 1) ? 's' : ''
                } with ${a1 ? skill_name(wtype) : ''}${
                    (a1 && a2 && ab) ? ', ' : (a1 && (a2 || ab)) ? also_wik_ : ''
                }${a2 ? skill_name(wtype2) : ''}${
                    (a1 && a2 && ab) ? ', and ' : (a2 && ab) ? also_wik_ : ''
                }${ab ? 'two weapons' : ''}`;
                enl_msg(You_, 'can enhance', 'could have enhanced', sfx, '', final);
            }
        } /* two-weapon */
    } /* skill applies */
}
// C ref: weapon.c skill_name(skill) == P_NAME(skill).  js/weapon.js:784 wraps
// this in an async import; P_NAME is the synchronous form.
function skill_name(skill) { return P_NAME(skill, Role_switch()); }
// C ref: obj.h:238 is_ammo(o) — a WEAPON_CLASS/GEM_CLASS object whose oc_skill
// is a negated launcher skill.
function is_ammo(obj) {
    const sk = OBJECTS[obj?.otyp]?.oc_skill ?? 0;
    return (obj?.oclass === WEAPON_CLASS || obj?.oclass === GEM_CLASS)
        && sk >= -P_CROSSBOW && sk <= -P_BOW;
}
const P_BOW = 20, P_CROSSBOW = 22;   // skills.h

// ── insight.c:1467 item_resistance_message() ───────────────────────────────
export function item_resistance_message(adtyp, prot_message, final) {
    const protection = u_adtyp_resistance_obj(adtyp);

    if (protection) {
        const somewhat = protection < 99;

        enl_msg('Your items ',
                somewhat ? 'are somewhat' : 'are',
                somewhat ? 'were somewhat' : 'were',
                prot_message, item_what(adtyp), final);
    }
}
// C ref: zap.c:5654 adtyp_to_prop(dmgtyp).  These three belong in js/zap.js,
// which has no port of them yet (js/mhitm_ad.js:325 only cites them); they are
// local here so item_resistance_message() can be faithful.
function adtyp_to_prop(dmgtyp) {
    switch (dmgtyp) {
    case AD_COLD: return COLD_RES;
    case AD_FIRE: return FIRE_RES;
    case AD_ELEC: return SHOCK_RES;
    case AD_ACID: return ACID_RES;
    case AD_DISN: return DISINT_RES;
    default: break;
    }
    return 0; /* prop_types start at 1 */
}
const DWARVISH_CLOAK = 141; // js/do_wear.js:49
// C ref: zap.c:5676 u_adtyp_resistance_obj(dmgtyp).
function u_adtyp_resistance_obj(dmgtyp) {
    const prop = adtyp_to_prop(dmgtyp);

    if (!prop)
        return 0;
    /* items that give an extrinsic resistance when worn or wielded or
       carried give 99% protection to your items */
    if (E_prop(prop))
        return 99;
    /* worn dwarvish cloaks give 90% protection against heat and cold to
       carried items */
    if (game.uarmc && game.uarmc.otyp === DWARVISH_CLOAK
        && (dmgtyp === AD_COLD || dmgtyp === AD_FIRE))
        return 90;
    return 0;
}
// C ref: zap.c:5722 item_what(dmgtyp) — wizard mode only; names the worn item
// that protects inventory.  The non-wizard answer (the only one any covered
// session can see) is the empty string.
function item_what(dmgtyp) {
    if (!_wizard())
        return '';
    const prop = adtyp_to_prop(dmgtyp);
    const o = prop ? what_gives(prop) : null;
    return o ? ` (from your ${simpleonames(o)})` : '';
}

// ── insight.c:1486 attributes_enlightenment() ──────────────────────────────
const if_surroundings_permitted = ' if surroundings permitted';
// js/mkobj.js objects[] indices (js/do.js:2414, js/invent.js:172,
// js/mhitu.js:116, js/apply.js:1001, js/invent.js:158 name them).
const RIN_ADORNMENT = 173, RIN_PROTECTION = 178, AMULET_OF_GUARDING = 210,
      LUCKSTONE = 470, ROBE = 143;
export function attributes_enlightenment(_unused_mode, final) {
    const u = game.u || {};
    let ltmp, armpro, warnspecies;
    let buf;

    /*\
     *  Attributes
    \*/
    enlght_out('');
    enlght_out(final ? 'Final Attributes:' : 'Attributes:');

    if (u.uevent?.uhand_of_elbereth) {
        const hofe_titles = ['the Hand of Elbereth', 'the Envoy of Balance',
                             'the Glory of Arioch'];
        you_are(hofe_titles[u.uevent.uhand_of_elbereth - 1], '', final);
    }

    buf = piousness(u.ualign?.record | 0);   /* piousness(TRUE, "aligned") */
    if ((u.ualign?.record | 0) >= 0)
        you_are(buf, '', final);
    else
        you_have(buf, '', final);

    if (_wizard()) {
        buf = ` ${u.ualign?.record | 0}`;
        enl_msg('Your alignment ', 'is', 'was', buf, '', final);
    }

    /*** Resistances to troubles ***/
    if (Prop(INVULNERABLE))
        you_are('invulnerable', from_what_p(INVULNERABLE), final);
    if (Antimagic())
        you_are('magic-protected', from_what_p(ANTIMAGIC), final);
    if (Prop(FIRE_RES))
        you_are('fire resistant', from_what_p(FIRE_RES), final);
    item_resistance_message(AD_FIRE, ' protected from fire', final);
    if (Prop(COLD_RES))
        you_are('cold resistant', from_what_p(COLD_RES), final);
    item_resistance_message(AD_COLD, ' protected from cold', final);
    if (Prop(SLEEP_RES))
        you_are('sleep resistant', from_what_p(SLEEP_RES), final);
    if (Prop(DISINT_RES))
        you_are('disintegration resistant', from_what_p(DISINT_RES), final);
    item_resistance_message(AD_DISN, ' protected from disintegration', final);
    if (Prop(SHOCK_RES))
        you_are('shock resistant', from_what_p(SHOCK_RES), final);
    item_resistance_message(AD_ELEC, ' protected from electric shocks', final);
    if (Prop(POISON_RES))
        you_are('poison resistant', from_what_p(POISON_RES), final);
    if (Prop(ACID_RES)) {
        buf = `${temp_resist(ACID_RES) ? 'temporarily ' : ''}acid resistant`;
        you_are(buf, from_what_p(ACID_RES), final);
    }
    item_resistance_message(AD_ACID, ' protected from acid', final);
    if (Prop(DRAIN_RES))
        you_are('level-drain resistant', from_what_p(DRAIN_RES), final);
    if (Prop(SICK_RES))
        you_are('immune to sickness', from_what_p(SICK_RES), final);
    if (Prop(STONE_RES)) {
        buf = `${temp_resist(STONE_RES) ? 'temporarily ' : ''}petrification resistant`;
        you_are(buf, from_what_p(STONE_RES), final);
    }
    if (Prop(HALLUC_RES))
        enl_msg(You_, 'resist', 'resisted', ' hallucinations',
                from_what_p(HALLUC_RES), final);
    if (u.uedibility)
        you_can('recognize detrimental food', '', final);

    /*** Vision and senses ***/
    if ((H_prop(BLINDED) || E_prop(BLINDED)) && B_prop(BLINDED)) /* blocked */
        you_can('see', from_what_p(-BLINDED), final); /* Eyes of the Overworld */
    if (Prop(BLND_RES) && !Blind()) /* skip if no eyes or blindfolded */
        you_are('not subject to light-induced blindness',
                from_what_p(BLND_RES), final);
    if (Prop(SEE_INVIS)) {
        if (!Blind())
            enl_msg(You_, 'see', 'saw', ' invisible', from_what_p(SEE_INVIS), final);
        else if (!PermaBlind())
            enl_msg(You_, 'will see', 'would have seen',
                    ' invisible when not blind', '', final);
        else
            enl_msg(You_, 'would see', 'would have seen',
                    ' invisible if not blind', '', final);
    }
    if (Prop(TELEPAT))
        you_are('telepathic', from_what_p(TELEPAT), final);
    if (Prop(WARNING))
        you_are('warned', from_what_p(WARNING), final);
    if (Prop(WARN_OF_MON) && game.context?.warntype?.obj) {
        const w = game.context.warntype.obj;
        buf = `aware of the presence of ${
            (w & M2_ORC) ? 'orcs'
            : (w & M2_ELF) ? 'elves'
              : (w & M2_DEMON) ? 'demons' : something}`;
        you_are(buf, from_what_p(WARN_OF_MON), final);
    }
    if (Prop(WARN_OF_MON) && game.context?.warntype?.polyd) {
        const w = game.context.warntype.polyd;
        buf = `aware of the presence of ${
            ((w & (M2_HUMAN | M2_ELF)) === (M2_HUMAN | M2_ELF)) ? 'humans and elves'
            : (w & M2_HUMAN) ? 'humans'
              : (w & M2_ELF) ? 'elves'
                : (w & M2_ORC) ? 'orcs'
                  : (w & M2_DEMON) ? 'demons' : 'certain monsters'}`;
        you_are(buf, '', final);
    }
    warnspecies = game.context?.warntype?.speciesidx;
    if (Prop(WARN_OF_MON) && ismnum(warnspecies)) {
        buf = `aware of the presence of ${
            objnam_makeplural(monster_by_pmidx(warnspecies)?.name || '')}`;
        you_are(buf, from_what_p(WARN_OF_MON), final);
    }
    if (Prop(WARN_UNDEAD))
        you_are('warned of undead', from_what_p(WARN_UNDEAD), final);
    if (Prop(SEARCHING))
        you_have('automatic searching', from_what_p(SEARCHING), final);
    if (Prop(CLAIRVOYANT)) {
        you_are('clairvoyant', from_what_p(CLAIRVOYANT), final);
    } else if ((H_prop(CLAIRVOYANT) || E_prop(CLAIRVOYANT)) && B_prop(CLAIRVOYANT)) {
        buf = from_what_p(-CLAIRVOYANT);
        buf = strsubst(buf, ' because of ', ' if not for ');
        enl_msg(You_, 'could be', 'could have been', ' clairvoyant', buf, final);
    }
    if (Prop(INFRAVISION))
        you_have('infravision', from_what_p(INFRAVISION), final);
    if (Prop(DETECT_MONSTERS)) {
        buf = 'sensing the presence of monsters';
        if (_wizard()) {
            const detectmon_timeout = H_prop(DETECT_MONSTERS) & TIMEOUT_MASK;

            if (detectmon_timeout)
                buf += ` (${detectmon_timeout})`;
        }
        you_are(buf, '', final);
    }
    if (u.umconf) { /* 'u.umconf' is a counter rather than a timeout */
        buf = ' monsters when hitting them';
        if (_wizard() && !final) {
            if (u.umconf === 1)
                buf += ' (next hit only)';
            else /* u.umconf > 1 */
                buf += ` (next ${u.umconf} hits)`;
        }
        enl_msg(You_, 'will confuse', 'would have confused', buf, '', final);
    }

    /*** Appearance and behavior ***/
    if (E_prop(ADORNED)) {
        let adorn = 0;

        if (game.uleft && game.uleft.otyp === RIN_ADORNMENT)
            adorn += game.uleft.spe | 0;
        if (game.uright && game.uright.otyp === RIN_ADORNMENT)
            adorn += game.uright.spe | 0;
        /* the sum might be 0 (+0 ring or two which negate each other) */
        buf = `${(adorn > 0) ? 'more ' : (adorn < 0) ? 'less ' : ''}charismatic`;
        you_are(buf, from_what_p(ADORNED), final);
    }
    if (Invisible())
        you_are('invisible', from_what_p(INVIS), final);
    else if (Prop(INVIS))
        you_are('invisible to others', from_what_p(INVIS), final);
    /* ordinarily "visible" is redundant; special case for when invisibility
       would be an expected attribute */
    else if ((H_prop(INVIS) || E_prop(INVIS)) && B_prop(INVIS))
        you_are('visible', from_what_p(-INVIS), final);
    if (Prop(DISPLACED))
        you_are('displaced', from_what_p(DISPLACED), final);
    if (Prop(STEALTH)) {
        you_are('stealthy', from_what_p(STEALTH), final);
    } else if (B_prop(STEALTH) && (H_prop(STEALTH) || E_prop(STEALTH))) {
        buf = ` stealthy${(B_prop(STEALTH) === FROMOUTSIDE) ? ' if not mounted' : ''}`;
        enl_msg(You_, 'would be', 'would have been', buf, '', final);
    }
    if (Prop(AGGRAVATE_MONSTER))
        enl_msg('You aggravate', '', 'd', ' monsters',
                from_what_p(AGGRAVATE_MONSTER), final);
    if (Prop(CONFLICT))
        enl_msg('You cause', '', 'd', ' conflict', from_what_p(CONFLICT), final);

    /*** Transportation ***/
    if (Prop(JUMPING))
        you_can('jump', from_what_p(JUMPING), final);
    if (Prop(TELEPORT))
        you_can('teleport', from_what_p(TELEPORT), final);
    if (Prop(TELEPORT_CONTROL))
        you_have('teleport control', from_what_p(TELEPORT_CONTROL), final);
    /* actively levitating handled earlier as a status condition.  C zeroes
       BLevitation, re-tests Levitation, then restores it; this port has no
       `blocked` column (B_prop() is always 0) so the block never fires. */
    if (B_prop(LEVITATION)) {
        const save_BLev = B_prop(LEVITATION);

        if (Prop(LEVITATION)) {
            const trapped = (save_BLev & I_SPECIAL) !== 0,
                  terrain = (save_BLev & FROMOUTSIDE) !== 0;

            buf = `${trapped ? ' if not trapped' : ''}${
                (trapped && terrain) ? ' and' : ''}${
                terrain ? if_surroundings_permitted : ''}`;
            enl_msg(You_, 'would levitate', 'would have levitated', buf, '', final);
        }
    }
    /* actively flying handled earlier as a status condition */
    if (B_prop(FLYING)) {
        const save_BFly = B_prop(FLYING);

        if (Prop(FLYING)) {
            enl_msg(You_, 'would fly', 'would have flown',
                    Prop(LEVITATION)
                       ? " if you weren't levitating"
                       : (save_BFly === I_SPECIAL)
                          ? " if you weren't trapped"
                          : (save_BFly === FROMOUTSIDE)
                             ? if_surroundings_permitted
                             : ' if circumstances permitted',
                    '', final);
        }
    }
    /* ceiling clinging */
    if (is_clinger(game.youmonst?.data)) {
        const has_lid = has_ceiling(u.uz);

        if (has_lid && !u.uinwater) {
            you_can('cling to the ceiling', '', final);
        } else {
            buf = ` to the ceiling if ${!has_lid ? 'there was one' : ''}${
                (!has_lid && u.uinwater) ? ' and ' : ''}${
                u.uinwater ? (Underwater() ? "you weren't underwater"
                                           : "you weren't in the water") : ''}`;
            /* past tense is applicable for death while Unchanging */
            enl_msg(You_, 'could cling', 'could have clung', buf, '', final);
        }
    }
    /* actively walking on water handled earlier as a status condition */
    if (Prop(WWALKING) && !walking_on_water())
        you_can('walk on water', from_what_p(WWALKING), final);
    /* actively swimming (in water but not under it) handled earlier */
    if (Prop(SWIMMING) && (Underwater() || !u.uinwater))
        you_can('swim', from_what_p(SWIMMING), final);
    if (Breathless())
        you_can('survive without air', from_what_p(MAGICAL_BREATHING), final);
    else if (Amphibious())
        you_can('breathe water', from_what_p(MAGICAL_BREATHING), final);
    if (Prop(PASSES_WALLS))
        you_can('walk through walls', from_what_p(PASSES_WALLS), final);

    /*** Physical attributes ***/
    if (Prop(REGENERATION))
        enl_msg('You regenerate', '', 'd', '', from_what_p(REGENERATION), final);
    if (Prop(SLOW_DIGESTION))
        you_have('slower digestion', from_what_p(SLOW_DIGESTION), final);
    if (u.uhitinc) {
        buf = enlght_combatinc('to hit', u.uhitinc, final, null);
        if (game.iflags?.tux_penalty && !u.Upolyd) {
            const sa = game.urole?.spelarmr | 0;
            buf += ` ${
                (u.uhitinc < 0) ? 'increasing'
                : (u.uhitinc < 4 * sa / 5) ? 'partly offsetting'
                  : (u.uhitinc < sa) ? 'nearly offsetting' : 'overcoming'
            } your suit's penalty`;
        }
        you_have(buf, '', final);
    }
    if (u.udaminc)
        you_have(enlght_combatinc('damage', u.udaminc, final, null), '', final);
    if (u.uspellprot || Prop(PROTECTION)) {
        let prot = 0;

        if (game.uleft && game.uleft.otyp === RIN_PROTECTION)
            prot += game.uleft.spe | 0;
        if (game.uright && game.uright.otyp === RIN_PROTECTION)
            prot += game.uright.spe | 0;
        if (game.uamul && game.uamul.otyp === AMULET_OF_GUARDING)
            prot += 2;
        if (H_prop(PROTECTION) & INTRINSIC)
            prot += u.ublessed | 0;
        prot += u.uspellprot | 0;
        if (prot)
            you_have(enlght_combatinc('defense', prot, final, null), '', final);
    }
    if ((armpro = magic_negation_hero()) > 0) {
        /* magic cancellation factor, conferred by worn armor */
        const mc_types = ['' /*ordinary*/, 'warded', 'guarded', 'protected'];
        /* sanity check */
        if (armpro >= mc_types.length)
            armpro = mc_types.length - 1;
        you_are(mc_types[armpro], '', final);
    }
    if (Prop(HALF_PHDAM))
        enlght_halfdmg(HALF_PHDAM, final);
    if (Prop(HALF_SPDAM))
        enlght_halfdmg(HALF_SPDAM, final);
    if (Half_gas_damage())
        enl_msg(You_, 'take', 'took', ' reduced poison gas damage', '', final);
    if (spellid(0) > NO_SPELL) { /* skip if no spells are known yet */
        /* greatly simplified edition of percent_success(spell.c) */
        let cast_adj = '';
        const suit = !!(game.uarm && is_metallic(game.uarm)),
              robe = !!(game.uarmc && game.uarmc.otyp === ROBE);

        if (suit) /* omit "wearing" to shorten the text */
            cast_adj = ` impaired by metallic armor${
                robe ? ', mitigated by your robe' : ''}`;
        else if (robe)
            cast_adj = ' enhanced by wearing a robe';

        if (cast_adj)
            enl_msg('Your spell casting ', 'is', 'was', cast_adj, '', final);
    }
    /* polymorph and other shape change */
    if (Prop(PROT_FROM_SHAPE_CHANGERS))
        you_are('protected from shape changers',
                from_what_p(PROT_FROM_SHAPE_CHANGERS), final);
    if (Prop(UNCHANGING)) {
        let what = 0;

        if (!u.Upolyd) /* Upolyd handled below after current form */
            you_can('not change from your current form',
                    from_what_p(UNCHANGING), final);
        /* blocked shape changes */
        if (Prop(POLYMORPH))
            what = !final ? 'polymorph' : 'have polymorphed';
        else if (ismnum(u.ulycn))
            what = !final ? 'change shape' : 'have changed shape';
        if (what) {
            buf = `would ${what} periodically`;
            /* omit from_what(UNCHANGING); too verbose */
            enl_msg(You_, buf, buf, ' if not locked into your current form',
                    '', final);
        }
    } else if (Prop(POLYMORPH)) {
        you_are('polymorphing periodically', from_what_p(POLYMORPH), final);
    }
    if (Prop(POLYMORPH_CONTROL))
        you_have('polymorph control', from_what_p(POLYMORPH_CONTROL), final);
    if (u.Upolyd && u.umonnum !== u.ulycn
        /* if we've died from turning into slime, we're polymorphed right now
           but don't want to list it as a temporary attribute */
        && !(final === ENL_GAMEOVERDEAD
             && u.umonnum === PM_GREEN_SLIME() && !Prop(UNCHANGING))) {
        /* foreign shape (except were-form which is handled below) */
        if (!vampshifted(game.youmonst))
            buf = `polymorphed into ${an(pmname(game.youmonst?.data,
                       game.flags?.female ? FEMALE : MALE))}`;
        else
            buf = `polymorphed into ${an(pmname(monster_by_pmidx(game.youmonst?.cham),
                       game.flags?.female ? FEMALE : MALE))} in ${
                   pmname(game.youmonst?.data, game.flags?.female ? FEMALE : MALE)} form`;
        if (_wizard())
            buf += ` (${u.mtimedone | 0})`;
        you_are(buf, '', final);
    }
    if (lays_eggs(game.youmonst?.data) && game.flags?.female) /* Upolyd */
        you_can('lay eggs', '', final);
    if (ismnum(u.ulycn)) {
        /* "you are a werecreature [in beast form]" */
        buf = an(pmname(monster_by_pmidx(u.ulycn),
                        game.flags?.female ? FEMALE : MALE));
        if (u.umonnum === u.ulycn) {
            buf += ' in beast form';
            if (_wizard())
                buf += ` (${u.mtimedone | 0})`;
        }
        you_are(buf, '', final);
    }
    if (Prop(UNCHANGING) && u.Upolyd) /* !Upolyd handled above */
        you_can('not change from your current form',
                from_what_p(UNCHANGING), final);
    if (Hate_silver())
        you_are('harmed by silver', '', final);
    /* movement and non-armor-based protection */
    if (Fast())
        you_are(Very_fast() ? 'very fast' : 'fast', from_what_p(FAST), final);
    if (Prop(REFLECTING))
        you_have('reflection', from_what_p(REFLECTING), final);
    if (E_prop(FREE_ACTION))
        you_have('free action', from_what_p(FREE_ACTION), final);
    if (Prop(FIXED_ABIL))
        you_have('fixed abilities', from_what_p(FIXED_ABIL), final);
    if (E_prop(LIFESAVED))
        enl_msg('Your life ', 'will be', 'would have been', ' saved', '', final);

    /*** Miscellany ***/
    if (Luck()) {
        ltmp = Math.abs(Luck());
        buf = `${ltmp >= 10 ? 'extremely ' : ltmp >= 5 ? 'very ' : ''}${
            (Luck() < 0) ? 'un' : ''}lucky`;
        if (_wizard())
            buf += ` (${Luck()})`;
        you_are(buf, '', final);
    } else if (_wizard()) {
        enl_msg('Your luck ', 'is', 'was', ' zero', '', final);
    }
    if ((u.moreluck | 0) > 0)
        you_have('extra luck', '', final);
    else if ((u.moreluck | 0) < 0)
        you_have('reduced luck', '', final);
    if (carrying(LUCKSTONE) || stone_luck(true)) {
        ltmp = stone_luck(false);
        if (ltmp <= 0)
            enl_msg('Bad luck ', 'does', 'did', ' not time out for you', '', final);
        if (ltmp >= 0)
            enl_msg('Good luck ', 'does', 'did', ' not time out for you', '', final);
    }

    if (u.ugangr) {
        buf = ` ${u.ugangr > 6 ? 'extremely ' : u.ugangr > 3 ? 'very ' : ''}angry with you`;
        if (_wizard())
            buf += ` (${u.ugangr})`;
        enl_msg(u_gname(), ' is', ' was', buf, '', final);
    } else {
        /*
         * We need to suppress this when the game is over, because death can
         * change the value calculated by can_pray().
         */
        if (!final) {
            buf = `${can_pray_quiet() ? '' : 'not '}safely pray`;
            if (_wizard())
                buf += ` (${u.ublesscnt | 0})`;
            you_can(buf, '', final);
        }
    }

    {
        let p;

        buf = '';
        if (final < 2) { /* still in progress, or quit/escaped/ascended */
            p = 'survived after being killed ';
            if (!u.umortality)
                p = !final ? null : 'survived';
            else
                buf = N_times(u.umortality);
        } else { /* game ended in character's death */
            p = 'are dead';
            switch (u.umortality | 0) {
            case 0:
                /* impossible("dead without dying?"); FALLTHRU */
            case 1:
                break; /* just "are dead" */
            default:
                buf = ` (${u.umortality}${ordin(u.umortality)} time!)`;
                break;
            }
        }
        if (p)
            enl_msg(You_, 'have been killed ', p, buf, '', final);
    }
}
// ── attributes_enlightenment() helpers ────────────────────────────────────
// C ref: prop.h INTRINSIC == FROMOUTSIDE|FROMRACE|FROMEXPER.
const FROMEXPER = 0x01000000, FROMRACE = 0x02000000;
const INTRINSIC = FROMOUTSIDE | FROMRACE | FROMEXPER;
const NO_SPELL = 0;                     // spell.h
// C ref: hack.h `something` — the vague noun used when nothing better fits.
const something = 'something';
// C ref: youprop.h Invisible == (Invis && !See_invisible) — visible to self?
function Invisible() { return !!(Prop(INVIS) && !Prop(SEE_INVIS)); }
// C ref: youprop.h PermaBlind == (Blinded && !BlindedTimeout).
function PermaBlind() { return !!(Blind() && !BlindedTimeout()); }
// C ref: youprop.h Breathless / Amphibious — MAGICAL_BREATHING plus the form's
// M1_BREATHLESS / M1_AMPHIBIOUS bits.
function Breathless() {
    return !!(Prop(MAGICAL_BREATHING)
              || (mflags1_of(game.youmonst?.data) & M1_BREATHLESS));
}
function Amphibious() {
    return !!(Prop(MAGICAL_BREATHING)
              || (mflags1_of(game.youmonst?.data) & M1_AMPHIBIOUS));
}
// C ref: youprop.h Half_gas_damage — worn/intrinsic poison-gas mitigation; no
// covered path grants it and this port keeps no u.uprops slot for it.
function Half_gas_damage() { return false; }
// C ref: mondata.c hates_silver(ptr) / youprop.h Hate_silver ==
// (ismnum(u.ulycn) || hates_silver(youmonst.data)).
function hates_silver(ptr) {
    if (!ptr) return false;
    return !!((mflags2_of(ptr) & M2_WERE) || ptr.mcls === S_VAMPIRE_CLS
              || (mflags2_of(ptr) & M2_DEMON) || ptr.name === 'shade'
              || (ptr.mcls === S_IMP_CLS && ptr.name !== 'tengu'));
}
function Hate_silver() {
    return !!(ismnum(game.u?.ulycn) || hates_silver(game.youmonst?.data));
}
// C ref: youprop.h Fast/Very_fast.  js/allmain.js owns the port's readers.
function Fast() { return !!(youHaveFast() || youHaveVeryFast()); }
function Very_fast() { return !!youHaveVeryFast(); }
// C ref: youprop.h Luck == (u.uluck + u.moreluck).
function Luck() { return (game.u?.uluck | 0) + (game.u?.moreluck | 0); }
// C ref: attrib.c stone_luck(parameter) — the net luck from carried luckstones
// (and other gray stones).  js/mkobj.js:1005 only cites it; no port exists, so
// this reports "no luck-bearing stone", which is what every covered hero has.
function stone_luck(_parameter) { return 0; }
// C ref: mondata.h is_clinger / dungeon.c has_ceiling.
function is_clinger(ptr) { return (mflags1_of(ptr) & M1_CLING) !== 0; }
function has_ceiling(_lev) { return true; } /* only air/water levels lack one */
// C ref: mondata.h lays_eggs(ptr) == (mflags1 & M1_OVIPAROUS).
function lays_eggs(ptr) { return (mflags1_of(ptr) & M1_OVIPAROUS) !== 0; }
// C ref: monsters.h PM_GREEN_SLIME.
let _PM_GREEN_SLIME = null;
function PM_GREEN_SLIME() {
    if (_PM_GREEN_SLIME == null) _PM_GREEN_SLIME = name_to_pmidx('green slime') ?? -1;
    return _PM_GREEN_SLIME;
}
// C ref: obj.h is_metallic(o) — objects[].oc_material in IRON..MITHRIL.  The
// OBJECT_DATA column is `material`, not `oc_material` (js/mkobj.js:1743), but
// it carries objclass.h's numbering (js/mkobj.js reads GEMSTONE as 20).
const IRON = 11, MITHRIL = 17;   // objclass.h
function is_metallic(obj) {
    const m = OBJECTS[obj?.otyp]?.material | 0;
    return m >= IRON && m <= MITHRIL;
}

// ── insight.c:2088 show_conduct() ──────────────────────────────────────────
export function show_conduct(final) {
    const u = game.u || {};
    let buf;
    let ngenocided;

    /* Create the conduct window */
    ge.en_win = create_nhwindow(NHW_MENU);
    putstr(ge.en_win, 0, 'Voluntary challenges:');

    /* rerolling; always use past tense */
    if (!u.uroleplay?.reroll)
        buf = ' Character rerolling was not enabled.';
    else if (!u.uroleplay?.numrerolls)
        buf = ' Your character was not rerolled.';
    else
        buf = ` Your character was rerolled ${N_times(u.uroleplay.numrerolls)}.`;
    enlght_out(buf);

    if (u.uroleplay?.blind)
        you_have_been('blind from birth', final);
    if (u.uroleplay?.deaf)
        you_have_been('deaf from birth', final);
    /* we don't report "you are without possessions" unless the game started
       with the pauper option set */
    if (u.uroleplay?.pauper)
        enl_msg(You_, (game.invent && game.invent.length) ? 'started' : 'are',
                'started out', ' without possessions', '', final);
    if (u.uroleplay?.nudist)
        you_have_been('faithfully nudist', final);

    const uc = u.uconduct || {};
    if (!uc.food)
        enl_msg(You_, 'have gone', 'went', ' without food', '', final);
        /* but beverages are okay */
    else if (!uc.unvegan)
        you_have_X('followed a strict vegan diet', final);
    else if (!uc.unvegetarian)
        you_have_been('vegetarian', final);

    if (!uc.gnostic)
        you_have_been('an atheist', final);

    if (!uc.weaphit) {
        you_have_never('hit with a wielded weapon', final);
    } else if (_wizard()) {
        buf = `hit with a wielded weapon ${uc.weaphit} time${plur(uc.weaphit)}`;
        you_have_X(buf, final);
    }
    if (!uc.killer)
        you_have_been('a pacifist', final);

    if (!uc.literate) {
        you_have_been('illiterate', final);
    } else if (_wizard()) {
        buf = `read items or engraved ${uc.literate} time${plur(uc.literate)}`;
        you_have_X(buf, final);
    }

    if (!uc.pets)
        you_have_never('had a pet', final);

    ngenocided = num_genocides();
    if (ngenocided === 0) {
        you_have_never('genocided any monsters', final);
    } else {
        buf = `genocided ${ngenocided} type${plur(ngenocided)} of monster${plur(ngenocided)}`;
        you_have_X(buf, final);
    }

    if (!uc.polypiles) {
        you_have_never('polymorphed an object', final);
    } else if (_wizard()) {
        buf = `polymorphed ${uc.polypiles} item${plur(uc.polypiles)}`;
        you_have_X(buf, final);
    }

    if (!uc.polyselfs) {
        you_have_never('changed form', final);
    } else if (_wizard()) {
        buf = `changed form ${uc.polyselfs} time${plur(uc.polyselfs)}`;
        you_have_X(buf, final);
    }

    if (!uc.wishes) {
        you_have_X('used no wishes', final);
    } else {
        buf = `used ${uc.wishes} wish${(uc.wishes > 1) ? 'es' : ''}`;
        if (uc.wisharti) {
            if (uc.wisharti === uc.wishes)
                buf += ` (${(uc.wisharti > 2) ? 'all '
                            : (uc.wisharti === 2) ? 'both ' : ''}`;
            else
                buf += ` (${uc.wisharti} `;
            buf += `for ${(uc.wisharti === 1) ? 'an artifact' : 'artifacts'})`;
        }
        you_have_X(buf, final);

        if (!uc.wisharti)
            enl_msg(You_, 'have not wished', 'did not wish',
                    ' for any artifacts', '', final);
    }

    /* only report Sokoban conduct if the Sokoban branch has been entered.
       NOTE: sokoban_in_play() above tests u.uachieved for 6, but ACH_SOKO is
       21 (6 is ACH_AMUL) — a live wrong-constant bug in that function. */
    if (sokoban_in_play()) {
        let presentverb = 'have violated', pastverb = 'violated';

        if (!uc.sokocheat) {
            presentverb = 'have not violated';
            pastverb = 'did not violate';
            buf = ' any of the special Sokoban rules';
        } else {
            buf = ' the special Sokoban rules ';
            buf += N_times(uc.sokocheat);
        }
        enl_msg(You_, presentverb, pastverb, buf, '', final);
    }

    show_achievements(final);

    /* Pop up the window and wait for a key */
    display_nhwindow(ge.en_win, true);
    destroy_nhwindow(ge.en_win);
    ge.en_win = WIN_ERR;
}

// ── insight.c:2242 show_achievements() ─────────────────────────────────────
export function show_achievements(final) {
    const u = game.u || {};
    let i, achidx, absidx, acnt;
    let title, buf;
    let awin = WIN_ERR;

    /* can't show the achievements while the game is in progress: it would
       give away the ID of luckstone and of the real Amulet of Yendor */
    if (!final && !_wizard())
        return;

    /* first, figure whether any achievements have been accomplished */
    if ((acnt = count_achievements()) === 0)
        return;

    if (ge.en_win !== WIN_ERR) {
        awin = ge.en_win; /* end of game disclosure window */
        putstr(awin, 0, '');
    } else {
        awin = create_nhwindow(NHW_MENU);
    }
    title = `Achievement${plur(acnt)}:`;
    putstr(awin, 0, title);

    /* display achievements in the order in which they were recorded; lone
       exception is to defer the Amulet if we just ascended */
    if (remove_achievement(ACH_UWIN)) { /* UWIN == Ascended! */
        if (remove_achievement(ACH_AMUL)) /* should always be True here */
            record_achievement(ACH_AMUL);
        record_achievement(ACH_UWIN);
    }
    for (i = 0; i < acnt; ++i) {
        achidx = u.uachieved[i];
        absidx = Math.abs(achidx);

        switch (absidx) {
        case ACH_BLND:
            enl_msg(You_, 'are exploring', 'explored',
                    ' without being able to see', '', final);
            break;
        case ACH_NUDE:
            enl_msg(You_, 'have gone', 'went', ' without any armor', '', final);
            break;
        case ACH_MINE:
            you_have_X('entered the Gnomish Mines', final);
            break;
        case ACH_TOWN:
            you_have_X('entered Minetown', final);
            break;
        case ACH_SHOP:
            you_have_X('entered a shop', final);
            break;
        case ACH_TMPL:
            you_have_X('entered a temple', final);
            break;
        case ACH_ORCL:
            you_have_X('consulted the Oracle of Delphi', final);
            break;
        case ACH_NOVL:
            you_have_X('read from a Discworld novel', final);
            break;
        case ACH_SOKO:
            you_have_X('entered Sokoban', final);
            break;
        case ACH_SOKO_PRIZE: /* hard to reach guaranteed bag or amulet */
            you_have_X('completed Sokoban', final);
            break;
        case ACH_MINE_PRIZE: /* hidden guaranteed luckstone */
            you_have_X('completed the Gnomish Mines', final);
            break;
        case ACH_BGRM:
            you_have_X('entered the Big Room', final);
            break;
        case ACH_MEDU:
            you_have_X('defeated Medusa', final);
            break;
        case ACH_TUNE:
            you_have_X(
                "learned the tune to open and close the Castle's drawbridge",
                final);
            break;
        case ACH_BELL:
            /* alternate phrasing for present vs past and also for possessing
               the item vs once held it */
            enl_msg(You_,
                    u.uhave?.bell ? 'have' : 'have handled',
                    u.uhave?.bell ? 'had' : 'handled',
                    ' the Bell of Opening', '', final);
            break;
        case ACH_HELL:
            enl_msg(You_, 'have ', '', 'entered Gehennom', '', final);
            break;
        case ACH_CNDL:
            enl_msg(You_,
                    u.uhave?.menorah ? 'have' : 'have handled',
                    u.uhave?.menorah ? 'had' : 'handled',
                    ' the Candelabrum of Invocation', '', final);
            break;
        case ACH_BOOK:
            enl_msg(You_,
                    u.uhave?.book ? 'have' : 'have handled',
                    u.uhave?.book ? 'had' : 'handled',
                    ' the Book of the Dead', '', final);
            break;
        case ACH_INVK:
            you_have_X("gained access to Moloch's Sanctum", final);
            break;
        case ACH_AMUL:
            /* alternate wording for ascended (always past tense) */
            enl_msg(You_,
                    u.uhave?.amulet ? 'have' : 'have obtained',
                    u.uevent?.ascended ? 'delivered'
                     : u.uhave?.amulet ? 'had' : 'had obtained',
                    ' the Amulet of Yendor', '', final);
            break;

        case ACH_ENDG:
            you_have_X('reached the Elemental Planes', final);
            break;
        case ACH_ASTR:
            you_have_X('reached the Astral Plane', final);
            break;
        case ACH_UWIN:
            /* the ultimate achievement... */
            enlght_out(' You ascended!');
            break;

        /* rank 0 is the starting condition, not an achievement; 8 is Xp 30 */
        case ACH_RNK1: case ACH_RNK2: case ACH_RNK3: case ACH_RNK4:
        case ACH_RNK5: case ACH_RNK6: case ACH_RNK7: case ACH_RNK8:
            buf = `attained the rank of ${
                rank_of(rank_to_xlev(absidx - (ACH_RNK1 - 1)),
                        Role_switch(), (achidx < 0))}`;
            you_have_X(buf, final);
            break;

        default:
            buf = ` [Unexpected achievement #${achidx}.]`;
            enlght_out(buf);
            break;
        } /* switch */
    } /* for */

    if (awin !== ge.en_win) {
        display_nhwindow(awin, true);
        destroy_nhwindow(awin);
    }
}

// ── insight.c:2475 remove_achievement() ────────────────────────────────────
export function remove_achievement(achidx) {
    const u = game.u;
    if (!u) return false;
    if (!Array.isArray(u.uachieved)) u.uachieved = [];
    let i;

    for (i = 0; u.uachieved[i]; ++i)
        if (Math.abs(u.uachieved[i]) === Math.abs(achidx))
            break; /* stop when found */
    if (!u.uachieved[i]) /* not found */
        return false;
    /* list is 0 terminated so any beyond the removed one move up a slot */
    do {
        u.uachieved[i] = u.uachieved[i + 1];
    } while (u.uachieved[++i]);
    /* C's fixed-size array keeps a 0 terminator at the vacated slot; a plain
       JS array must shed it instead, or record_achievement()'s push() would
       land past the hole. */
    while (u.uachieved.length
           && (u.uachieved[u.uachieved.length - 1] === undefined
               || u.uachieved[u.uachieved.length - 1] === 0))
        u.uachieved.pop();
    return true;
}

// ── insight.c:2493 count_achievements() ────────────────────────────────────
export function count_achievements() {
    const ach = game.u?.uachieved;
    let i, acnt = 0;

    if (!Array.isArray(ach)) return 0;
    for (i = 0; ach[i]; ++i)
        ++acnt;
    return acnt;
}

// ── insight.c:2601 vanqorders[] ────────────────────────────────────────────
// The two uppercase choices are implemented but suppressed from the menu.
export const vanqorders = [
    ['t', 'traditional: by monster level',
          'traditional: by monster level, by internal monster index'],
    ['d', 'by monster difficulty rating',
          'by monster difficulty rating, by internal monster index'],
    ['a', 'alphabetically, unique monsters separate',
          'alphabetically, first unique monsters, then others'],
    ['A', 'alphabetically, unique monsters intermixed',
          'alphabetically, unique monsters and others intermixed'],
    ['C', 'by monster class, high to low level in class',
          'by monster class, high to low level within class'],
    ['c', 'by monster class, low to high level in class',
          'by monster class, low to high level within class'],
    ['n', 'by count, high to low',
          'by count, high to low, by internal index within tied count'],
    ['z', 'by count, low to high',
          'by count, low to high, by internal index within tied count'],
];

// monsym.h class indices vanqsort_cmp() and the punctuation reorder need.
const S_ZOMBIE_CLS = 52, S_HUMAN_CLS = 53, S_GHOST_CLS = 54, S_GOLEM_CLS = 55,
      S_DEMON_CLS = 56, S_EEL_CLS = 57, S_LIZARD_CLS = 58;
const S_VAMPIRE_CLS = 48, S_IMP_CLS = 9;

// C ref: insight.c:2777 UniqCritterIndx(mndx) — high priests aren't unique but
// are flagged as such to simplify something.
let _PM_HIGH_CLERIC = null;
function PM_HIGH_CLERIC() {
    if (_PM_HIGH_CLERIC == null)
        _PM_HIGH_CLERIC = name_to_pmidx('high cleric') ?? -1;
    return _PM_HIGH_CLERIC;
}
function UniqCritterIndx(mndx) {
    return ((monster_by_pmidx(mndx)?.geno | 0) & G_UNIQ) !== 0
           && mndx !== PM_HIGH_CLERIC();
}
// C ref: decl.h program_state.stopprint, incremented by a 'q' answer.
function done_stopprint_inc() {
    game.program_state_stopprint = (game.program_state_stopprint | 0) + 1;
}
function mvitals_of(i) { return game.mvitals?.[i] || { died: 0, born: 0, mvflags: 0 }; }

// ── insight.c:2620 vanqsort_cmp() ──────────────────────────────────────────
// C is a qsort() callback over `short *`; here the two arguments are the mons[]
// indices themselves.  mons[].mlet is the NUMERIC monster class in C, which is
// this port's `mcls` (makemon.js keeps the display CHARACTER in `mlet`).
export function vanqsort_cmp(vptr1, vptr2) {
    const indx1 = vptr1 | 0, indx2 = vptr2 | 0;
    let mlev1, mlev2, mstr1, mstr2, uniq1, uniq2, died1, died2, res;
    let name1, name2, punct;
    let mcls1, mcls2;
    const m1 = monster_by_pmidx(indx1), m2 = monster_by_pmidx(indx2);

    switch (game.flags?.vanq_sortmode | 0) {
    default:
    case VANQ_MLVL_MNDX:
        /* sort by monster level */
        mlev1 = m1?.mlevel | 0;
        mlev2 = m2?.mlevel | 0;
        res = mlev2 - mlev1; /* mlevel high to low */
        break;
    case VANQ_MSTR_MNDX:
        /* sort by monster toughness */
        mstr1 = m1?.difficulty | 0;
        mstr2 = m2?.difficulty | 0;
        res = mstr2 - mstr1; /* monstr high to low */
        break;
    case VANQ_ALPHA_SEP:
        uniq1 = (((m1?.geno | 0) & G_UNIQ) && indx1 !== PM_HIGH_CLERIC()) ? 1 : 0;
        uniq2 = (((m2?.geno | 0) & G_UNIQ) && indx2 !== PM_HIGH_CLERIC()) ? 1 : 0;
        if (uniq1 ^ uniq2) { /* one or other uniq, but not both */
            res = uniq2 - uniq1;
            break;
        } /* else both unique or neither unique */
        /* FALLTHRU */
    case VANQ_ALPHA_MIX:
        name1 = m1?.name || '';
        name2 = m2?.name || '';
        res = strcmpi(name1, name2); /* caseblind alpha, low to high */
        break;
    case VANQ_MCLS_HTOL:
    case VANQ_MCLS_LTOH:
        mcls1 = m1?.mcls | 0;
        mcls2 = m2?.mcls | 0;
        /* S_ANT through S_ZRUTY correspond to lowercase monster classes,
           S_ANGEL through S_ZOMBIE correspond to uppercase, and various
           punctuation characters are used for classes beyond those */
        if (mcls1 > S_ZOMBIE_CLS && mcls2 > S_ZOMBIE_CLS) {
            /* force a specific order to the punctuation classes that's
               different from the internal order */
            const punctclasses = [S_LIZARD_CLS, S_EEL_CLS, S_GOLEM_CLS,
                                  S_GHOST_CLS, S_DEMON_CLS, S_HUMAN_CLS];

            if ((punct = punctclasses.indexOf(mcls1)) >= 0)
                mcls1 = S_ZOMBIE_CLS + 1 + punct;
            if ((punct = punctclasses.indexOf(mcls2)) >= 0)
                mcls2 = S_ZOMBIE_CLS + 1 + punct;
        }
        res = mcls1 - mcls2; /* class */
        if (res === 0) {
            /* Riders are in the same class as major demons; force Riders to
               be sorted before demons */
            res = (is_rider_pm(indx2) ? 1 : 0) - (is_rider_pm(indx1) ? 1 : 0);
            if (res)
                break;
            mlev1 = m1?.mlevel | 0;
            mlev2 = m2?.mlevel | 0;
            res = mlev1 - mlev2; /* mlevel low to high */
            if ((game.flags?.vanq_sortmode | 0) === VANQ_MCLS_HTOL)
                res = -res; /* mlevel high to low */
        }
        break;
    case VANQ_COUNT_H_L:
    case VANQ_COUNT_L_H:
        died1 = mvitals_of(indx1).died | 0;
        died2 = mvitals_of(indx2).died | 0;
        res = died2 - died1; /* dead count high to low */
        if ((game.flags?.vanq_sortmode | 0) === VANQ_COUNT_L_H)
            res = -res; /* dead count low to high */
        break;
    }
    /* tiebreaker: internal mons[] index */
    if (res === 0)
        res = indx1 - indx2; /* mndx low to high */
    return res;
}

// ── insight.c:2717 set_vanq_order() ────────────────────────────────────────
// Returns -1 if cancelled via ESC.  The window shim's select_menu() has no key
// source, so a PICK_ONE menu always reports "cancelled" and flags.vanq_sortmode
// is left alone; a wiring pass has to supply the real menu.
export function set_vanq_order(for_vanq) {
    let tmpwin;
    let selected;
    let any;
    let buf, desc;
    let i, n, choice;
    const clr = 0; /* NO_COLOR */

    tmpwin = create_nhwindow(NHW_MENU);
    start_menu(tmpwin, MENU_BEHAVE_STANDARD);
    any = {}; /* cg.zeroany */
    for (i = 0; i < vanqorders.length; i++) {
        if (i === VANQ_ALPHA_MIX || i === VANQ_MCLS_HTOL) /* skip these */
            continue;
        /* suppress some orderings if this menu is for 'm #genocided' */
        if (!for_vanq && (i === VANQ_COUNT_H_L || i === VANQ_COUNT_L_H))
            continue;
        desc = vanqorders[i][2];
        /* unique monsters can't be genocided */
        if (!for_vanq && i === VANQ_ALPHA_SEP)
            desc = 'alphabetically';
        any.a_int = i + 1;
        add_menu(tmpwin, null, any, vanqorders[i][0], 0, ATR_NONE, clr, desc,
                 (i === (game.flags?.vanq_sortmode | 0)) ? MENU_ITEMFLAGS_SELECTED
                                                         : MENU_ITEMFLAGS_NONE);
    }
    buf = `Sort order for ${
        for_vanq ? 'vanquished monster counts (also genocided types)'
                 : 'genocided monster types (also vanquished counts)'}`;
    end_menu(tmpwin, buf);

    selected = [];
    n = select_menu(tmpwin, PICK_ONE, selected);
    destroy_nhwindow(tmpwin);
    if (n > 0) {
        choice = selected[0].item.a_int - 1;
        /* skip preselected entry if we have more than one item chosen */
        if (n > 1 && choice === (game.flags?.vanq_sortmode | 0))
            choice = selected[1].item.a_int - 1;
        if (game.flags) game.flags.vanq_sortmode = choice;
    }
    return (n < 0) ? -1 : (game.flags?.vanq_sortmode | 0);
}

// ── insight.c:2783 list_vanquished() ───────────────────────────────────────
// Used for #vanquished and end of game disclosure and end of game dumplog.
// Async because the `ask` branch prompts; C is void.
export async function list_vanquished(defquery, ask) {
    let i;
    let pfx, nkilled;
    let ntypes, ni;
    let total_killed = 0;
    let klwin;
    const mindx = [];
    let c, buf, buftoo;
    /* 'A' is only supplied by 'm #vanquished'; 'd' is only supplied by
       dump_everything() when writing dumplog */
    const force_sort = (defquery === 'A'),
          dumping = (defquery === 'd');

    /* normally we don't ask about sort order unless the list has at least two
       entries; with explicit 'm #vanquished', choose order no matter what */
    if (force_sort) { /* iflags.menu_requested via dovanquished() */
        set_vanq_order(true);
    }
    if (dumping || force_sort) {
        defquery = 'y';
        ask = false; /* redundant */
    }

    /* get totals first */
    ntypes = 0;
    for (i = LOW_PM; i < NUMMONS; i++) {
        if ((nkilled = mvitals_of(i).died | 0) === 0)
            continue;
        mindx[ntypes++] = i;
        total_killed += nkilled;
    }

    /* vanquished creatures list; includes all dead monsters */
    if (ntypes !== 0) {
        let mlet, prev_mlet = 0; /* used as small integer, not character */
        let class_header, uniq_header, Rider,
            was_uniq = false, special_hdr = false;

        if (ask) {
            let allow_yn;

            if (ntypes > 1) {
                allow_yn = ynaqchars;
            } else {
                allow_yn = ynqchars; /* don't include 'a', but */
                allow_yn += '\x1ba';  /* allow user to answer 'a' */
                if (defquery === 'a') /* potential default from 'disclose' */
                    defquery = 'y';
            }
            c = await yn_function('Do you want an account of creatures vanquished?',
                                  allow_yn, defquery, true);
        } else {
            c = defquery;
        }

        if (c === 'q')
            done_stopprint_inc();
        if (c === 'y' || c === 'a') {
            if (c === 'a' && ntypes > 1) { /* ask user to choose sort order */
                if (set_vanq_order(true) < 0)
                    return;
            }
            uniq_header = ((game.flags?.vanq_sortmode | 0) === VANQ_ALPHA_SEP);
            class_header = (((game.flags?.vanq_sortmode | 0) === VANQ_MCLS_LTOH
                             || (game.flags?.vanq_sortmode | 0) === VANQ_MCLS_HTOL)
                            && ntypes > 1);

            klwin = create_nhwindow(NHW_MENU);
            putstr(klwin, 0, 'Vanquished creatures:');
            if (!dumping)
                putstr(klwin, 0, '');

            mindx.sort(vanqsort_cmp);
            for (ni = 0; ni < ntypes; ni++) {
                i = mindx[ni];
                const mi = monster_by_pmidx(i);
                nkilled = mvitals_of(i).died | 0;
                Rider = is_rider_pm(i);
                mlet = mi?.mcls | 0;  /* C's mons[].mlet is the class NUMBER */
                if (class_header
                    && (mlet !== prev_mlet || (special_hdr && !Rider))) {
                    if (!Rider) {
                        buf = def_monsyms[mlet]?.explain || '';
                        special_hdr = false;
                    } else {
                        buf = 'Rider';
                        special_hdr = true;
                    }
                    /* 'ask' implies final disclosure, where highlighting of
                       various header lines is suppressed */
                    putstr(klwin, ask ? ATR_NONE : menu_headings_attr(),
                           upstart(buf));
                    prev_mlet = mlet;
                }
                if (UniqCritterIndx(i)) {
                    buf = `${!is_pname(mi) ? 'the ' : ''}${mi?.name || ''}`;
                    if (nkilled > 1)
                        buf += ` (${N_times(nkilled)})`;
                    was_uniq = true;
                } else {
                    if (uniq_header && was_uniq) {
                        putstr(klwin, 0, '');
                        was_uniq = false;
                    }
                    /* trolls or undead might have come back, but we don't
                       keep track of that */
                    if (nkilled === 1)
                        buf = an(mi?.name || '');
                    else
                        buf = `${String(nkilled).padStart(3, ' ')} ${
                            objnam_makeplural(mi?.name || '')}`;
                }
                /* number of leading spaces to match 3 digit prefix */
                pfx = /^the /i.test(buf) ? 0
                      : /^an /i.test(buf) ? 1
                        : /^a /i.test(buf) ? 2
                          : !digit(buf.charAt(2)) ? 4 : 0;
                if (class_header)
                    ++pfx;
                buftoo = ' '.repeat(pfx) + buf;
                putstr(klwin, 0, buftoo);
            }
            if (ntypes > 1) {
                if (!dumping)
                    putstr(klwin, 0, '');
                buf = `${total_killed} creatures vanquished.`;
                putstr(klwin, 0, buf);
            }
            display_nhwindow(klwin, true);
            destroy_nhwindow(klwin);
        }

    /*
     * For end-of-game disclosure, we're only called when some monsters were
     * vanquished and won't reach these 'else-if's.
     */
    } else if (!game.program_state_gameover) {
        /* #vanquished rather than final disclosure, so pline() is ok */
        await pline('No creatures have been vanquished.');
    } else if (dumping) {
        putstr(0, 0, 'No creatures were vanquished.'); /* not pline() */
    }
}
// C ref: decl.c ynqchars/ynaqchars.
const ynqchars = 'ynq', ynaqchars = 'ynaq';
// C ref: wintype.h ATR_INVERSE — iflags.menu_headings.attr's default.  NOTE:
// the port's own renderers pass 1 for inverse (js/enhance.js:403), so a wiring
// pass has to translate; this side keeps C's value.
const ATR_INVERSE = 7;   // wintype.h
function menu_headings_attr() {
    return game.iflags?.menu_headings?.attr ?? ATR_INVERSE;
}
// C ref: pline.c pline().  The live #vanquished path above uses
// game._pending_message instead; update_topl() is the topline writer this port
// pairs with pline() ([[pline-vs-update-topl-trap]] — the two are NOT
// interchangeable, so a wiring pass must re-measure this choice).
async function pline(msg) { await update_topl(msg); }
// C ref: windows.c yn_function(query, resp, def, restorecursor).
// js/extcmd-handlers.js owns the port's copy; imported lazily because that
// module statically imports insight.js (a cycle if taken at the top).
async function yn_function(query, resp, def, _restorecursor) {
    const { yn_function: ynf } = await import('./extcmd-handlers.js');
    return ynf(query, resp, def);
}

// ── insight.c:2969 num_extinct() ───────────────────────────────────────────
export function num_extinct() {
    let i, n = 0;

    for (i = LOW_PM; i < NUMMONS; ++i) {
        if (UniqCritterIndx(i))
            continue;
        if (((mvitals_of(i).mvflags | 0) & G_GONE) === G_EXTINCT)
            ++n;
    }
    return n;
}

// ── insight.c:2984 num_gone() ──────────────────────────────────────────────
// Collect both genocides and extinctions, skipping uniques.  `mindx` is the
// caller's array, filled in place (C memsets NUMMONS entries first).
export function num_gone(mvflags, mindx) {
    const mflg = mvflags & 0xff;
    let i, n = 0;

    if (Array.isArray(mindx)) {
        mindx.length = 0;
        for (i = 0; i < NUMMONS; ++i) mindx[i] = 0;
    }

    for (i = LOW_PM; i < NUMMONS; ++i) {
        /* uniques can't be genocided but can become extinct; however,
           they're never reported as extinct, so skip them */
        if (UniqCritterIndx(i))
            continue;

        if (((mvitals_of(i).mvflags | 0) & mflg) !== 0)
            mindx[n++] = i;
    }
    return n;
}

// ── insight.c:3006 list_genocided() ────────────────────────────────────────
// Show genocided and extinct monster types for final disclosure/dumplog or for
// the #genocided command.  Async because the `ask` branch prompts.
export async function list_genocided(defquery, ask) {
    let i, mndx;
    let ngenocided, nextinct, ngone, mvflags;
    const mindx = [];
    let c;
    let klwin;
    let buf;
    let genoing, dumping;
    let both = !!(game.program_state_gameover || _wizard() || _discover());

    dumping = (defquery === 'd');
    genoing = (defquery === 'g');
    if (dumping || genoing)
        defquery = 'y';
    if (genoing)
        both = false; /* genocides only, not extinctions */

    /* extinctions are only revealed during end of game disclosure or when
       running in wizard or explore mode */
    ngenocided = num_genocides();
    nextinct = both ? num_extinct() : 0;
    mvflags = G_GENOD | (both ? G_EXTINCT : 0);
    ngone = num_gone(mvflags, mindx);

    /* genocided or extinct species list */
    if (ngone > 0) {
        buf = `Do you want a list of ${
            (nextinct && !ngenocided) ? 'extinct ' : ''}species${
            (ngenocided) ? ' genocided' : ''}${
            (nextinct && ngenocided) ? ' and extinct' : ''}?`;
        c = ask ? await yn_function(buf, (ngone > 1) ? 'ynaq' : 'ynq\x1ba',
                                   defquery, true)
                : defquery;
        if (c === 'q')
            done_stopprint_inc();
        if (c === 'y' || c === 'a') {
            let save_sortmode;
            let mlet, prev_mlet = 0;
            let class_header = false;

            if (ngone > 1) {
                if (c === 'a') { /* ask player to choose sort order */
                    /* #genocided shares #vanquished's sort order */
                    if (set_vanq_order(false) < 0)
                        return;
                }
                /* count-high-to-low or count-low-to-high don't make sense for
                   genocides; use alphabetical instead */
                save_sortmode = game.flags?.vanq_sortmode | 0;
                if (save_sortmode === VANQ_COUNT_H_L
                    || save_sortmode === VANQ_COUNT_L_H)
                    game.flags.vanq_sortmode = VANQ_ALPHA_MIX;
                mindx.length = ngone;
                mindx.sort(vanqsort_cmp);
                class_header = ((game.flags?.vanq_sortmode | 0) === VANQ_MCLS_LTOH
                                || (game.flags?.vanq_sortmode | 0) === VANQ_MCLS_HTOL);
                if (game.flags) game.flags.vanq_sortmode = save_sortmode;
            }

            klwin = create_nhwindow(NHW_MENU);
            buf = `${(ngenocided) ? 'Genocided' : 'Extinct'}${
                (nextinct && ngenocided) ? ' or extinct' : ''} species:`;
            putstr(klwin, 0, buf);
            if (!dumping)
                putstr(klwin, 0, '');

            for (i = 0; i < ngone; ++i) {
                mndx = mindx[i];
                const mi = monster_by_pmidx(mndx);
                mlet = mi?.mcls | 0;   /* C's mons[].mlet is the class NUMBER */
                if (class_header && mlet !== prev_mlet) {
                    buf = def_monsyms[mlet]?.explain || '';
                    /* 'ask' implies final disclosure, where highlighting of
                       various header lines is suppressed */
                    putstr(klwin, ask ? ATR_NONE : menu_headings_attr(),
                           upstart(buf));
                    prev_mlet = mlet;
                }
                buf = ` ${objnam_makeplural(mi?.name || '')}`;
                /*
                 * We only append "(extinct)" if the G_GENOD bit is clear.
                 */
                if (((mvitals_of(mndx).mvflags | 0) & G_GONE) === G_EXTINCT)
                    buf += ' (extinct)';
                putstr(klwin, 0, buf);
            }
            if (!dumping)
                putstr(klwin, 0, '');
            if (ngenocided > 0) {
                buf = `${ngenocided} species genocided.`;
                putstr(klwin, 0, buf);
            }
            if (nextinct > 0) {
                buf = `${nextinct} species extinct.`;
                putstr(klwin, 0, buf);
            }

            display_nhwindow(klwin, true);
            destroy_nhwindow(klwin);
        }

    /* See the comment for similar code near the end of list_vanquished(). */
    } else if (!game.program_state_gameover) {
        /* #genocided rather than final disclosure, so pline() is ok and
           extinction has been ignored */
        await pline(`No creatures have been genocided${genoing ? ' yet' : ''}.`);
    } else if (dumping) { /* 'gameover' is True if we make it here */
        putstr(0, 0, 'No species were genocided or became extinct.');
    }
}

// ── insight.c:3144 doborn() ────────────────────────────────────────────────
// #wizborn extended command.
export function doborn() {
    const fmt = (died, born, ch, name) =>
        `${String(died).padStart(4)} ${String(born).padStart(4)} ${ch} ${
            String(name).padEnd(30)}`;
    let i;
    const datawin = create_nhwindow(NHW_TEXT);
    let buf;
    let nborn = 0, ndied = 0;

    putstr(datawin, 0, 'died born');
    for (i = LOW_PM; i < NUMMONS; i++) {
        const mv = mvitals_of(i);
        if (mv.born || mv.died || ((mv.mvflags | 0) & G_GONE) !== 0) {
            buf = fmt(mv.died | 0, mv.born | 0,
                      (((mv.mvflags | 0) & G_GONE) === G_EXTINCT) ? 'E'
                      : (((mv.mvflags | 0) & G_GONE) === G_GENOD) ? 'G'
                        : (((mv.mvflags | 0) & G_GONE) !== 0) ? 'X'
                          : ' ',
                      monster_by_pmidx(i)?.name || '');
            putstr(datawin, 0, buf);
            nborn += mv.born | 0;
            ndied += mv.died | 0;
        }
    }

    putstr(datawin, 0, '');
    /* upstream builds the totals line and then never putstr()s it; keeping the
       dead store documents that the window really does end on a blank line. */
    buf = fmt(ndied, nborn, ' ', '');

    display_nhwindow(datawin, false);
    destroy_nhwindow(datawin);

    return 0; /* ECMD_OK */
}
