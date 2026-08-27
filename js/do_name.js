// do_name.js — port of C src/do_name.c: monster/object naming, the hallucinatory
// name and colour generators, and the whole x_monnam() wrapper family.
//
// The wrappers matter more than they look: each one passes a DIFFERENT
// suppress-mask to x_monnam(), and several of the generators DRAW RNG —
// rndmonnam()/bogusmon()/hcolor()/hliquid() off the DISPLAY stream, rndorcname()
// and noveltitle() off the core stream.  Stubbing hcolor()/hliquid() to "return
// the preference unchanged" (which js/dungeon.js, js/do_wear.js and
// js/dbridge.js each did separately) silently skips those display-stream draws,
// so every later hallucination pick reads the wrong offset.
import { game } from './gstate.js';
import { rn2, rn1 } from './rng.js';
import { rn2_on_display_rng } from './disprng.js';
import { get_rnd_text, decode_dlb, MD_PAD_BOGONS } from './engrave.js';
import { BOGUSMON_B64 } from './bogusmon_data.js';
import { monster_by_pmidx, name_to_pmidx } from './makemon.js';
import { mflags2_of, M2_PNAME } from './monflags_data.js';
import { objects } from './mkobj.js';

// x_monnam()/mon_pmname() still live in js/uhitm.js.  They are reached through a
// registration hook rather than a static import because do_name.js sits BELOW
// uhitm.js in the graph (dungeon.js/do_wear.js/dbridge.js pull in hcolor and
// hliquid during their own module evaluation, and dragging uhitm.js in that
// early hits a temporal-dead-zone on mkobj.js's class constants).
let _hooks = { x_monnam: null, mon_pmname: null };
export function register_monnam_hooks(h) { _hooks = { ..._hooks, ...h }; }
function x_monnam(mtmp, article, adjective, suppress, called) {
    return _hooks.x_monnam
        ? _hooks.x_monnam(mtmp, article, adjective, suppress, called)
        : (mtmp?.data?.name || 'monster');
}
function mon_pmname(mtmp) {
    return _hooks.mon_pmname ? _hooks.mon_pmname(mtmp)
        : (mtmp?.data?.name || 'monster');
}

// C ref: do_name.c x_monnam() suppress flags (do_name.h / hack.h).
export const ARTICLE_NONE = 0, ARTICLE_THE = 1, ARTICLE_A = 2, ARTICLE_YOUR = 3;
export const SUPPRESS_IT = 0x01, SUPPRESS_INVISIBLE = 0x02,
             SUPPRESS_HALLUCINATION = 0x04, SUPPRESS_SADDLE = 0x08,
             EXACT_NAME = 0x0f, SUPPRESS_NAME = 0x10,
             SUPPRESS_MAPPEARANCE = 0x20, AUGMENT_IT = 0x40;

const BOGUSMON_DATA = decode_dlb(BOGUSMON_B64);

// C ref: permonst.h — LOW_PM is mons[0]; SPECIAL_PM is PM_LONG_WORM_TAIL, the
// first entry rndmonnam() must not pick as an ordinary monster.
const LOW_PM = 0;
let _SPECIAL_PM = -1;
function SPECIAL_PM() {
    if (_SPECIAL_PM < 0) _SPECIAL_PM = name_to_pmidx('long worm tail') ?? 330;
    return _SPECIAL_PM;
}
// C ref: monflag.h:197 G_NOGEN.
const G_NOGEN = 0x0200;
// C ref: mondata.h type_is_pname(ptr) — mflags2 & M2_PNAME.
function type_is_pname(ptr) { return (mflags2_of(ptr) & M2_PNAME) !== 0; }

// C ref: do_name.c:1365 — the leading characters bogusmon lines may carry.
const BOGON_CODES = '-_+|=';

// C ref: do_name.c:19 nextmbuf() — C rotates through a ring of static buffers so
// several monster names can be alive in one printf.  JS strings are values, so
// there is nothing to rotate; kept as a named seam for the ports of C code that
// writes into the returned buffer (monverbself, mon_nam_too, minimal_monnam).
export function nextmbuf() { return ''; }

// C ref: do_name.c:1368 bogusmon(buf, code) — a line from the makedefs-built
// 'bogusmon' data file, drawn off the DISPLAY rng.  Returns { name, code }.
export function bogusmon() {
    let mnam = get_rnd_text(BOGUSMON_DATA, MD_PAD_BOGONS, rn2_on_display_rng);
    let code = '';
    if (!mnam) return { name: 'bogon', code: '' };
    if (BOGON_CODES.includes(mnam[0])) { code = mnam[0]; mnam = mnam.slice(1); }
    return { name: mnam, code };
}

// C ref: do_name.c:1388 rndmonnam(code) — a random monster name for a
// hallucinating hero.  BOGUSMONSIZE is 100 ("arbitrary" in C): the draw spans
// the real mons[] plus 100 phantom slots that redirect into bogusmon().
const BOGUSMONSIZE = 100;
export function rndmonnam() {
    let name;
    do {
        name = rn2_on_display_rng(SPECIAL_PM() + BOGUSMONSIZE - LOW_PM) + LOW_PM;
    } while (name < SPECIAL_PM()
             && (type_is_pname(monster_by_pmidx(name))
                 || ((monster_by_pmidx(name)?.geno ?? 0) & G_NOGEN) !== 0));

    if (name >= SPECIAL_PM()) return bogusmon();
    // C: pmname(&mons[name], rn2_on_display_rng(2)) — the gender pick is a
    // SECOND display draw and happens even for species with only one name.
    const g = rn2_on_display_rng(2);
    return { name: pmname_by_idx(name, g), code: '' };
}

// C ref: do_name.c:1415 bogon_is_pname(code) — "-", "+" and "=" mark a bogus
// name that is already a proper noun, so no article is prepended.
export function bogon_is_pname(code) {
    return !!code && '-+='.includes(code);
}

// C ref: do_name.c:1302 pmname(pm, mgender) — a NAMS() species carries male /
// female / neutral names; MALE is 0, FEMALE is 1.
export const MALE = 0, FEMALE = 1, NEUTRAL = 2;
function pmname_by_idx(idx, mgender) {
    const pm = monster_by_pmidx(idx);
    if (!pm) return 'monster';
    return mon_pmname({ data: pm, female: mgender === FEMALE }) || pm.name;
}
// C ref: do_name.c:1289 Mgender(mtmp).
export function Mgender(mtmp) {
    if (mtmp === game.youmonst || mtmp === game.u)
        return (game.u?.Upolyd ? game.u?.mfemale : game.flags?.female)
            ? FEMALE : MALE;
    return mtmp?.female ? FEMALE : MALE;
}
// C ref: do_name.c:1320 obj_pmname(obj) — the species name behind a corpse,
// statue, figurine, egg or tin.
const CORPSE = 265, EGG = 266, TIN = 296, STATUE = 476, FIGURINE = 260;
export function obj_pmname(obj) {
    if (!obj) return 'thing';
    if ((obj.otyp === CORPSE || obj.otyp === EGG || obj.otyp === TIN
         || obj.otyp === STATUE || obj.otyp === FIGURINE)
        && obj.corpsenm != null && obj.corpsenm >= LOW_PM) {
        const gnd = obj.spe ? (obj.spe === 2 ? FEMALE : MALE) : NEUTRAL;
        return pmname_by_idx(obj.corpsenm, gnd === FEMALE ? FEMALE : MALE);
    }
    return objects[obj.otyp]?.name || 'thing';
}

// ── the x_monnam() wrapper family (do_name.c:1034-1288) ──
// Each differs ONLY in article + suppress mask, and every one of those masks is
// load-bearing: SUPPRESS_SADDLE hides "saddled" for a named steed, SUPPRESS_IT
// forces a real name for a monster the hero cannot see, AUGMENT_IT turns "it"
// into "someone"/"something", EXACT_NAME defeats hallucination.
function has_mgivenname(mtmp) {
    return !!(mtmp?.mgivenname || mtmp?.mextra?.mgivenname);
}
const highc = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function l_monnam(mtmp) {
    return x_monnam(mtmp, ARTICLE_NONE, null,
                    has_mgivenname(mtmp) ? SUPPRESS_SADDLE : 0, true);
}
export function mon_nam(mtmp) {
    return x_monnam(mtmp, ARTICLE_THE, null,
                    has_mgivenname(mtmp) ? SUPPRESS_SADDLE : 0, false);
}
export function noit_mon_nam(mtmp) {
    return x_monnam(mtmp, ARTICLE_YOUR, null,
                    has_mgivenname(mtmp) ? (SUPPRESS_SADDLE | SUPPRESS_IT)
                                         : SUPPRESS_IT, false);
}
export function some_mon_nam(mtmp) {
    return x_monnam(mtmp, ARTICLE_THE, null,
                    has_mgivenname(mtmp) ? (SUPPRESS_SADDLE | AUGMENT_IT)
                                         : AUGMENT_IT, false);
}
export function Monnam(mtmp) { return highc(mon_nam(mtmp)); }
export function noit_Monnam(mtmp) { return highc(noit_mon_nam(mtmp)); }
export function Some_Monnam(mtmp) { return highc(some_mon_nam(mtmp)); }
// "a dog" rather than "Fido", honoring hallucination and visibility
export function noname_monnam(mtmp, article) {
    return x_monnam(mtmp, article, null, SUPPRESS_NAME, false);
}
// monster's own name -- overrides hallucination and [in]visibility
export function m_monnam(mtmp) {
    return x_monnam(mtmp, ARTICLE_NONE, null, EXACT_NAME, false);
}
export function y_monnam(mtmp) {
    const prefix = mtmp?.mtame ? ARTICLE_YOUR : ARTICLE_THE;
    const sup = (has_mgivenname(mtmp) || mtmp === game.u?.usteed)
        ? SUPPRESS_SADDLE : 0;
    return x_monnam(mtmp, prefix, null, sup, false);
}
export function YMonnam(mtmp) { return highc(y_monnam(mtmp)); }
export function Adjmonnam(mtmp, adj) {
    return highc(x_monnam(mtmp, ARTICLE_THE, adj,
                          has_mgivenname(mtmp) ? SUPPRESS_SADDLE : 0, false));
}
export function a_monnam(mtmp) {
    return x_monnam(mtmp, ARTICLE_A, null,
                    has_mgivenname(mtmp) ? SUPPRESS_SADDLE : 0, false);
}
export function Amonnam(mtmp) { return highc(a_monnam(mtmp)); }

// C ref: do_name.c:1170 distant_monnam(mon, article, outbuf) — used by '/', ';'
// and 'C' so the Astral high priest cannot be identified from across the level.
let _PM_HIGH_CLERIC = -1;
export function distant_monnam(mon, article) {
    if (_PM_HIGH_CLERIC < 0)
        _PM_HIGH_CLERIC = name_to_pmidx('high cleric') ?? -2;
    if (mon?.data?.pmidx === _PM_HIGH_CLERIC && !Hallucination()
        && Is_astralevel() && !m_next2u(mon))
        return (article === ARTICLE_THE ? 'the ' : '')
            + (mon.female ? 'high priestess' : 'high priest');
    return x_monnam(mon, article, null, 0, true);
}
// C ref: dungeon.h Is_astralevel(&u.uz) — dungeon 'The Planes', bottom level.
function Is_astralevel() {
    return game.u?.uz?.dnum === (game.astral_dnum ?? -1);
}
// C ref: mon.c m_next2u(mon) — adjacent to the hero.
function m_next2u(mon) {
    const u = game.u;
    if (!u || !mon) return false;
    return Math.abs((mon.mx | 0) - (u.ux | 0)) <= 1
        && Math.abs((mon.my | 0) - (u.uy | 0)) <= 1;
}

// C ref: do_name.c:1191 mon_nam_too(mon, other_mon) — "himself"/"herself"/
// "itself" when the two are the same monster.
export function mon_nam_too(mon, other_mon) {
    if (mon !== other_mon) return mon_nam(mon);
    const g = pronoun_gender(mon);
    return g === 0 ? 'himself' : g === 1 ? 'herself'
        : g === 3 ? 'themselves' : 'itself';
}
// C ref: mon.c pronoun_gender(mon, PRONOUN_HALLU) — 0 he, 1 she, 2 it, 3 they.
function pronoun_gender(mon) {
    if (!mon) return 2;
    if (Hallucination() && !rn2(2)) return 3;
    const ptr = mon.data;
    if ((ptr?.gcode ?? 0) === 3 /* neuter */) return 2;
    return mon.female ? 1 : 0;
}
function Hallucination() { return !!(game.u?.uhallu || game.u?.Hallucination); }

// C ref: do_name.c:1254 minimal_monnam(mon, ckloc) — debug-only naming that
// ignores what the hero can see.
export function minimal_monnam(mon, _ckloc) {
    if (!mon) return '[Null monster]';
    const ptr = mon.data;
    if (!ptr) return '[Null mon->data]';
    return `${mon.mtame ? 'tame ' : mon.mpeaceful ? 'peaceful ' : ''}${
        mon_pmname(mon)} <${mon.mx},${mon.my}>`;
}

// C ref: do_name.c:1221 monverbself(mon, monnamtext, verb, othertext) —
// "<mon> <verb> [<other>] {him,her,it}self".
export function monverbself(mon, monnamtext, verb, othertext) {
    const selfbuf = mon_nam_too(mon, mon);
    const plural = (selfbuf === 'themselves');
    let subj = monnamtext;
    let verbs = verb;
    if (!plural) verbs = vtense_s(verb);
    else if (/^it$/i.test(subj)) subj = 'they';
    return `${subj} ${verbs}${othertext ? ' ' + othertext : ''} ${selfbuf}`;
}
// C ref: objnam.c vtense() — the singular form of a plural verb.
function vtense_s(verb) {
    if (verb === 'are') return 'is';
    if (verb === 'have') return 'has';
    return /(s|x|z|ch|sh)$/.test(verb) ? verb + 'es' : verb + 's';
}

// ── mextra name slots (do_name.c:94-160) ──
// C allocates/frees an ONAME/MGIVENNAME buffer inside the obj/monst extras; in
// JS the slot is just a property, but the four entry points exist so callers
// read the same way C does.
export function new_mgivenname(mtmp, _lth) {
    if (mtmp && !mtmp.mextra) mtmp.mextra = {};
    return mtmp?.mextra;
}
export function free_mgivenname(mtmp) {
    if (mtmp) { mtmp.mgivenname = null; if (mtmp.mextra) mtmp.mextra.mgivenname = null; }
}
export function new_oname(obj, _lth) {
    if (obj && !obj.oextra) obj.oextra = {};
    return obj?.oextra;
}
export function free_oname(obj) {
    if (obj) { obj.oname = null; if (obj.oextra) obj.oextra.oname = null; }
}

// C ref: do_name.c:157 alreadynamed(mtmp, monnambuf, usrbuf) — "<mon> is
// already called <name>." when the new name matches the old one.
export function alreadynamed(mtmp, monnambuf, usrbuf) {
    const cur = mtmp?.mgivenname || mtmp?.mextra?.mgivenname || '';
    if (cur && cur === usrbuf) return `${monnambuf} is already called ${usrbuf}.`;
    return null;
}

// C ref: do_name.c:104 name_from_player(outbuf, prompt, defname) — getlin()
// with a default, trimming leading blanks and rejecting an escape.
export async function name_from_player(prompt, defname) {
    const { getlin } = await import('./input.js');
    const s = await getlin(`${prompt} `, defname);
    if (s == null || s === '\x1b') return null;
    const t = s.replace(/^\s+/, '');
    return t.length ? t : null;
}

// C ref: do_name.c christen_monst(mtmp, name).
export function christen_monst(mtmp, name) {
    if (!mtmp) return mtmp;
    if (!name || !name.length) { free_mgivenname(mtmp); return mtmp; }
    new_mgivenname(mtmp, name.length + 1);
    mtmp.mgivenname = name;
    mtmp.mextra.mgivenname = name;
    return mtmp;
}

// ── hallucination generators ──
// C ref: do_name.c:1441 hcolors[] — 71 entries; SIZE() is the modulus of the
// display-rng draw, so the table must be COMPLETE or every hcolor() picks from
// the wrong range.
const HCOLORS = [
    'ultraviolet', 'infrared', 'bluish-orange', 'reddish-green', 'dark white',
    'light black', 'sky blue-pink', 'pinkish-cyan', 'indigo-chartreuse',
    'salty', 'sweet', 'sour', 'bitter', 'umami',
    'striped', 'spiral', 'swirly', 'plaid', 'checkered', 'argyle', 'paisley',
    'blotchy', 'guernsey-spotted', 'polka-dotted', 'square', 'round',
    'triangular', 'cabernet', 'sangria', 'fuchsia', 'wisteria', 'lemon-lime',
    'strawberry-banana', 'peppermint', 'romantic', 'incandescent',
    'octarine',
    'excitingly dull', 'mauve', 'electric',
    'neon', 'fluorescent', 'phosphorescent', 'translucent', 'opaque',
    'psychedelic', 'iridescent', 'rainbow-colored', 'polychromatic',
    'colorless', 'colorless green',
    'dancing', 'singing', 'loving', 'loudy', 'noisy', 'clattery', 'silent',
    'apocyan', 'infra-pink', 'opalescent', 'violant', 'tuneless',
    'viridian', 'aureolin', 'cinnabar', 'purpurin', 'gamboge', 'madder',
    'bistre', 'ecru', 'fulvous', 'tekhelet', 'selective yellow',
];
// C ref: do_name.c:1460 hcolor(colorpref) — NOTE the `|| !colorpref`: a NULL
// preference DRAWS even when the hero is not hallucinating.
export function hcolor(colorpref) {
    return (Hallucination() || !colorpref)
        ? HCOLORS[rn2_on_display_rng(HCOLORS.length)]
        : colorpref;
}
// C ref: decl.c c_obj_colors[] (color.h CLR_MAX 16, NO_COLOR 8).
const C_OBJ_COLORS = [
    'black', 'red', 'green', 'brown', 'blue', 'magenta', 'cyan', 'gray',
    'transparent', 'orange', 'bright green', 'yellow', 'bright blue',
    'bright magenta', 'bright cyan', 'white',
];
const CLR_MAX = 16, NO_COLOR = 8;
// C ref: do_name.c:1469 rndcolor() — the rn2(CLR_MAX) is a CORE draw and
// happens whether or not the hero is hallucinating.
export function rndcolor() {
    const k = rn2(CLR_MAX);
    return Hallucination() ? hcolor(null)
        : (k === NO_COLOR) ? 'colorless' : C_OBJ_COLORS[k];
}
// C ref: do_name.c:1479 hliquids[] — 40 entries.
const HLIQUIDS = [
    'yoghurt', 'oobleck', 'clotted blood', 'diluted water', 'purified water',
    'instant coffee', 'tea', 'herbal infusion', 'liquid rainbow',
    'creamy foam', 'mulled wine', 'bouillon', 'nectar', 'grog', 'flubber',
    'ketchup', 'slow light', 'oil', 'vinaigrette', 'liquid crystal', 'honey',
    'caramel sauce', 'ink', 'aqueous humour', 'milk substitute',
    'fruit juice', 'glowing lava', 'gastric acid', 'mineral water',
    'cough syrup', 'quicksilver', 'sweet vitriol', 'grey goo', 'pink slime',
    'cosmic latte', 'bone oil', 'custard', 'lard', 'vinegar', 'creosote',
];
// C ref: do_name.c:1492 hliquid(liquidpref) — when a real default exists it is
// added as one extra slot in the modulus, so the draw can select "keep it".
export function hliquid(liquidpref) {
    const hallucinate = Hallucination() && !game.program_state_gameover;
    if (hallucinate || !liquidpref) {
        let count = HLIQUIDS.length;
        if (liquidpref) ++count;
        const indx = rn2_on_display_rng(count);
        if (indx >= 0 && indx < HLIQUIDS.length) return HLIQUIDS[indx];
    }
    return liquidpref;
}

// C ref: do_name.c:1514 coynames[] — Wile E. Coyote's mock-Latin aliases; the
// last entry is reserved for a cancelled coyote.
const COYNAMES = [
    'Carnivorous Vulgaris', 'Road-Runnerus Digestus', 'Eatibus Anythingus',
    'Famishus-Famishus', 'Eatibus Almost Anythingus', 'Eatius Birdius',
    'Famishius Fantasticus', 'Eternalii Famishiis', 'Famishus Vulgarus',
    'Famishius Vulgaris Ingeniusi', 'Eatius-Slobbius', 'Hardheadipus Oedipus',
    'Carnivorous Slobbius', 'Hard-Headipus Ravenus', 'Evereadii Eatibus',
    'Apetitius Giganticus', 'Hungrii Flea-Bagius', 'Overconfidentii Vulgaris',
    'Caninus Nervous Rex', 'Grotesques Appetitus', 'Nemesis Ridiculii',
    'Canis latrans',
];
// C ref: do_name.c:1525 coyotename(mtmp, buf) — keyed on m_id, not RNG.
export function coyotename(mtmp) {
    if (!mtmp) return '';
    const base = x_monnam(mtmp, ARTICLE_NONE, null, 0, true);
    const alias = mtmp.mcan ? COYNAMES[COYNAMES.length - 1]
        : COYNAMES[(mtmp.m_id | 0) % (COYNAMES.length - 1)];
    return `${base} - ${alias}`;
}

// C ref: do_name.c:1537 rndorcname(s) — DRAWS CORE RNG: rn1(2,3) syllable
// count, rn2(2) start class, then rn2(30) per joint for a hyphen.
const ORC_V = ['a', 'ai', 'og', 'u'];
const ORC_SND = ['gor', 'gris', 'un', 'bane', 'ruk', 'oth', 'ul', 'z',
                 'thos', 'akh', 'hai'];
export function rndorcname() {
    const iend = rn1(2, 3);
    let vstart = rn2(2);
    let s = '';
    for (let i = 0; i < iend; ++i) {
        vstart = 1 - vstart;
        const joint = (i > 0 && !rn2(30)) ? '-' : '';
        s += joint + (vstart ? ORC_V[rn2(ORC_V.length)]
                             : ORC_SND[rn2(ORC_SND.length)]);
    }
    return s;
}
// C ref: hacklib.c upstart(s) — capitalize in place.
const upstart = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// C ref: do_name.c:1557 christen_orc(mtmp, gang, other).
export function christen_orc(mtmp, gang, other) {
    const orcname = rndorcname();
    let buf = null;
    if (gang) buf = `${upstart(orcname)} of ${upstart(gang)}`;
    else if (other != null) buf = `${upstart(orcname)}${other}`;
    if (buf) mtmp = christen_monst(mtmp, buf);
    return mtmp;
}

// C ref: do_name.c:1424 roguename() — the Rogue level's shopkeeper.  ROGUEOPTS
// is not set in the recorded environment, so the rn2 branch always runs.
export function roguename() {
    return rn2(3) ? (rn2(2) ? 'Michael Toy' : 'Kenneth Arnold')
                  : 'Glenn Wichman';
}

// C ref: do_name.c:1591 sir_Terry_novels[] — publication order; the index
// macros below depend on it, so the list must stay complete and ordered.
const SIR_TERRY_NOVELS = [
    'The Colour of Magic', 'The Light Fantastic', 'Equal Rites', 'Mort',
    'Sourcery', 'Wyrd Sisters', 'Pyramids', 'Guards! Guards!', 'Eric',
    'Moving Pictures', 'Reaper Man', 'Witches Abroad', 'Small Gods',
    'Lords and Ladies', 'Men at Arms', 'Soul Music', 'Interesting Times',
    'Maskerade', 'Feet of Clay', 'Hogfather', 'Jingo', 'The Last Continent',
    'Carpe Jugulum', 'The Fifth Elephant', 'The Truth', 'Thief of Time',
    'The Last Hero', 'The Amazing Maurice and His Educated Rodents',
    'Night Watch', 'The Wee Free Men', 'Monstrous Regiment',
    'A Hat Full of Sky', 'Going Postal', 'Thud!', 'Wintersmith',
    'Making Money', 'Unseen Academicals', 'I Shall Wear Midnight', 'Snuff',
    'Raising Steam', "The Shepherd's Crown",
];
const NVL_COLOUR_OF_MAGIC = 0, NVL_SOURCERY = 4, NVL_MASKERADE = 17,
      NVL_AMAZING_MAURICE = 27, NVL_THUD = 33;
// C ref: do_name.c:1610 noveltitle(novidx) — DRAWS rn2(SIZE) even when novidx
// already names a title, so the draw happens on every novel that is generated.
export function noveltitle(novidx) {
    const k = SIR_TERRY_NOVELS.length;
    let j = rn2(k);
    if (novidx && novidx.idx === -1) novidx.idx = j;
    else if (novidx && novidx.idx >= 0 && novidx.idx < k) j = novidx.idx;
    return SIR_TERRY_NOVELS[j];
}
// C ref: do_name.c:1626 lookup_novel(lookname, idx) — canonicalise a
// player-typed title, accepting the documented variant spellings.
export function lookup_novel(lookname, idx) {
    if (!lookname) return null;
    const lc = lookname.toLowerCase();
    const the = lc.startsWith('the ') ? lc : 'the ' + lc;
    if (the === 'the color of magic') lookname = SIR_TERRY_NOVELS[NVL_COLOUR_OF_MAGIC];
    else if (lc === 'sorcery') lookname = SIR_TERRY_NOVELS[NVL_SOURCERY];
    else if (lc === 'masquerade') lookname = SIR_TERRY_NOVELS[NVL_MASKERADE];
    else if (the === 'the amazing maurice') lookname = SIR_TERRY_NOVELS[NVL_AMAZING_MAURICE];
    else if (lc === 'thud') lookname = SIR_TERRY_NOVELS[NVL_THUD];
    for (let k = 0; k < SIR_TERRY_NOVELS.length; k++) {
        if (SIR_TERRY_NOVELS[k].toLowerCase() === String(lookname).toLowerCase()) {
            if (idx) idx.idx = k;
            return SIR_TERRY_NOVELS[k];
        }
    }
    return null;
}
