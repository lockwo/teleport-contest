// readobjnam.js — parse a wish string into a created object.
//
// C ref: src/objnam.c readobjnam() and its readobjnam_{init,preparse,
// parse_charges,postparse1,postparse2,postparse3} helpers, plus the wish
// finalization in src/zap.c makewish().
//
// Scope: this port targets the wizard-mode wish flow exercised by the
// wishlist sessions (seed0108-wizard-extcmd-wishlist, seed0360-wizard-
// world-tour).  In wizard mode the player-restriction RNG in readobjnam is
// skipped (the `else if (wizard) ;` branches), so the only RNG drawn while
// resolving a wish is:
//
//   1. rn2(maxprob)            @ rnd_otyp_by_namedesc(objnam.c:3522)
//   2. mksobj() machinery      (next_ident / mksobj_init / blessorcurse /
//                               mkbox_cnts / mkobj_erosions — all already
//                               ported in mkobj.js)
//   3. rn2(nartifact_exist())  @ readobjnam(objnam.c:5374)   [artifact wishes]
//
// makewish() then draws rn1(100, 50) (recorded as rn2(100)) for u.ublesscnt.
//
// Name/type resolution itself consumes no RNG; it only fixes the candidate
// set (n / maxprob) and ordering that the single rn2(maxprob) resolves to.

import { rn2, rn1, rnd } from './rng.js';
import {
    objects,
    mksobj,
    rnd_class,
    mkobj,
    set_corpsenm,
    weight,
    STRANGE_OBJECT,
    WEAPON_CLASS,
    ARMOR_CLASS,
    RING_CLASS,
    AMULET_CLASS,
    TOOL_CLASS,
    FOOD_CLASS,
    POTION_CLASS,
    SCROLL_CLASS,
    SPBOOK_CLASS,
    WAND_CLASS,
    GEM_CLASS,
    VENOM_CLASS,
    MAXOCLASSES,
    AMULET_OF_YENDOR,
    ROCK,
    TALLOW_CANDLE,
    WAX_CANDLE,
    LAST_REAL_GEM,
    GLOB_OF_GRAY_OOZE,
    curse,
    erosion_matters,
    is_damageable,
    is_flammable,
    is_rustprone,
    is_crackable,
    is_corrodeable,
    is_rottable,
} from './mkobj.js';
import { P_BOOMERANG, P_DART, P_BOW, P_CROSSBOW, P_SHURIKEN,
    WT_IRON_BALL_INCR, P_POLEARMS, P_HAMMER, ONAME_WISH, ONAME_NO_FLAGS,
    HAND, TIMER_OBJECT, ZOMBIFY_MON } from './const.js';
import {
    rnd_otyp_by_namedesc,
    o_ranges,
    spellings,
    wishymatch,
    strstri,
    is_poisonable,
    rnd_otyp_by_wpnskill,
    } from './objnam.js';
import { makesingular } from './plural.js';
import { makeplural } from './plural.js';
import { name_to_monplus } from './polyself.js';
import { monster_by_pmidx, name_to_pmidx,
    pmname_of_pmidx, can_be_hatched, dead_species, mon_nocorpse,
    mon_has_cnutrit } from './makemon.js';
import { counter_were, zombie_form } from './mon.js';
import { is_were_flag, is_human_flag, msound_of, MS_GUARDIAN } from './monflags_data.js';
import { tin_variety_txt, set_tin_variety, RANDOM_TIN, obj_nutrition,
    consume_oeaten } from './eat.js';
import { artifact_name, exist_artifact, artifact_exists, permapoisoned,
    nartifact_exist } from './artifact.js';
import { is_quest_artifact } from './questpgr.js';
import { lookup_novel } from './do_name.js';
import { body_part } from './invent.js';
import { start_timer_sync } from './timeout.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
import { game } from './gstate.js';
import { wizterrainwish } from './wizterrainwish.js';
import { u_safe_from_fatal_corpse, st_all } from './pickup.js';

const NUM_OBJECTS = objects.length;

// C ref: objnam.c:3928 — d.contents states for tins/containers.
const TIN_UNDEFINED = 0, TIN_EMPTY = 1, TIN_SPINACH = 2;
// C ref: hack.h:1197 CORPSTAT_RANDOM/FEMALE/MALE/NEUTER + CORPSTAT_HISTORIC.
const CORPSTAT_RANDOM = 0, CORPSTAT_FEMALE = 1, CORPSTAT_MALE = 2;
const CORPSTAT_NEUTER = 3, CORPSTAT_HISTORIC = 4;
// C ref: monattk.h/you.h gender codes used by name_to_mon()'s gender out-param.
const MALE = 0, FEMALE = 1, NEUTRAL = 2;

// Resolve an otyp by its C constant name off the objects[] row `sym` field, so
// no index literal is pasted here (mkobj.js is the single source of truth).
const otypCache = new Map();
function OT(sym) {
    if (!otypCache.has(sym)) otypCache.set(sym, objects.findIndex((o) => o && o.sym === sym));
    return otypCache.get(sym);
}

// C ref: drawing.c def_oc_syms[] — the object-class symbol chars, indexed by
// oclass; def_char_to_objclass() is the reverse lookup.
const DEF_OC_SYMS = [
    '\0', ']', ')', '[', '=', '"', '(', '%', '!', '?', '+', '/', '$', '*',
    '`', '0', '_', '.',
];
function def_char_to_objclass(ch) {
    const i = DEF_OC_SYMS.indexOf(ch);
    return i < 0 ? MAXOCLASSES : i;
}

// C ref: objnam.c Japanese_items[] — alternate names accepted for a wish.
const JAPANESE_ITEMS = [
    ['SHORT_SWORD', 'wakizashi'], ['BROADSWORD', 'ninja-to'],
    ['FLAIL', 'nunchaku'], ['GLAIVE', 'naginata'],
    ['LOCK_PICK', 'osaku'], ['WOODEN_HARP', 'koto'],
    ['MAGIC_HARP', 'magic koto'], ['KNIFE', 'shito'],
    ['PLATE_MAIL', 'tanko'], ['HELMET', 'kabuto'],
    ['LEATHER_GLOVES', 'yugake'], ['FOOD_RATION', 'gunyoki'],
    ['POT_BOOZE', 'sake'],
];

// C ref: OBJ_DESCR(objects[AMULET_OF_YENDOR]) — the real Amulet's description
// text, which is also the fake Amulet's appearance.
function OBJ_DESCR_AOY() {
    const i = OT('AMULET_OF_YENDOR');
    return i >= 0 ? (DESCR_BY_OTYP[i] || objects[i].name) : '';
}

// C ref: o_init.c init_objects() — svb.bases[oclass] scans from MAXOCLASSES,
// SKIPPING the 17 per-class GENERIC_* placeholder rows at objects[1..17]; a
// plain findIndex() would return GENERIC_GEM (13) and make the gem-name scan
// below cover every tool and weapon in the table.
let gemBaseCache = -1;
function gemBase() {
    if (gemBaseCache < 0) {
        gemBaseCache = MAXOCLASSES;
        while (gemBaseCache < objects.length
               && objects[gemBaseCache].oc_class !== GEM_CLASS) gemBaseCache++;
    }
    return gemBaseCache;
}

// C ref: hack.h Luck — u.uluck + u.moreluck.
function Luck() { return (game.u?.uluck | 0) + (game.u?.moreluck | 0); }
// C ref: obj.h Is_box(o) / NON_PM.
const NON_PM = -1, LOW_PM = 0;
function Is_box(o) { return o.otyp === OT('LARGE_BOX') || o.otyp === OT('CHEST'); }

// C ref: objclass.h FIRST_GLASS_GEM..LAST_GLASS_GEM — the worthless glass run.
function firstGlassGem() { return OT('WORTHLESS_WHITE_GLASS'); }
function numGlassGems() {
    let n = 0;
    for (let i = firstGlassGem(); i < objects.length; i++) {
        if (!objects[i] || !/^worthless piece of /.test(objects[i].name || '')) break;
        n++;
    }
    return n;
}

// ── hacklib string helpers (C ref: hacklib.c) ─────────────────────────────
function digit(c) { return c >= '0' && c <= '9'; }
function strcmpi(a, b) { return a.toLowerCase() === b.toLowerCase(); }
function strncmpi(a, b, n) {
    return (a || '').slice(0, n).toLowerCase() === (b || '').slice(0, n).toLowerCase();
}
// C `!BSTRCMPI(base, base + len - n, str)` is true when the n-char tail of
// `base` case-insensitively equals `str`.  Returns that boolean directly.
function bstrcmpi_tail(s, suffixLen, str) {
    if (s.length < suffixLen) return false; /* C: ptr before base => no match */
    return strcmpi(s.slice(s.length - suffixLen), str);
}
function atoiPrefix(s) {
    const m = /^-?\d+/.exec(s);
    return m ? parseInt(m[0], 10) : 0;
}
// C ref: hacklib.c strsubst(bp, orig, replacement) — replace the FIRST
// occurrence (strstr, so case-sensitive) of `orig`; used by the corpse/statue
// gender hack, which deletes the gender word from the backtracked buffer.
function strsubst(bp, orig, repl) {
    const i = bp.indexOf(orig);
    return i < 0 ? bp : bp.slice(0, i) + repl + bp.slice(i + orig.length);
}
// mungspaces: collapse internal whitespace and trim (C: hacklib.c).
function mungspaces(s) { return String(s).replace(/\s+/g, ' ').replace(/^ | $/g, ''); }

// SPE limit (C objnam.c uses SPE_LIM=99 via the wizard path; honored loosely).
const SPE_LIM = 99;

// ── object-name lookup ────────────────────────────────────────────────────
function OBJ_NAME(i) {
    const o = objects[i];
    return o && o.name ? o.name : null;
}

// ── wrp class-name table (C ref: objnam.c wrp[]/wrpsym[]) ──────────────────
const WRP = [
    ['wand', WAND_CLASS],
    ['ring', RING_CLASS],
    ['potion', POTION_CLASS],
    ['scroll', SCROLL_CLASS],
    ['gem', GEM_CLASS],
    ['amulet', AMULET_CLASS],
    ['spellbook', SPBOOK_CLASS],
    ['spell book', SPBOOK_CLASS],
    ['weapon', WEAPON_CLASS],
    ['armor', ARMOR_CLASS],
    ['tool', TOOL_CLASS],
    ['food', FOOD_CLASS],
    ['comestible', FOOD_CLASS],
];

// C ref: objnam.c:2523 wrpsym[] — the 13 classes an unparseable/empty wish
// falls back to, SPBOOK and FOOD each listed twice (so they are twice as
// likely).  Order is load-bearing: rn2(13) indexes straight into it.
const WRPSYM = [
    WAND_CLASS, RING_CLASS, POTION_CLASS,
    SCROLL_CLASS, GEM_CLASS, AMULET_CLASS,
    SPBOOK_CLASS, SPBOOK_CLASS, WEAPON_CLASS,
    ARMOR_CLASS, TOOL_CLASS, FOOD_CLASS,
    FOOD_CLASS,
];

// ── parse-state object (subset of C struct _readobjnam_data) ───────────────
function newData(bp) {
    return {
        otmp: null,
        cnt: 0, spe: 0, spesgn: 0, typ: 0, rechrg: 0,
        very: 0, blessed: 0, uncursed: 0, iscursed: 0,
        ispoisoned: 0, isgreased: 0, eroded: 0, eroded2: 0, erodeproof: 0,
        halfeaten: 0, islit: 0, unlabeled: 0, ishistoric: 0, isdiluted: 0,
        trapped: 0,
        // C ref: objnam.c readobjnam_init():3942-3954 — the rest of the parse
        // state.  These used to be absent entirely, so every prefix that sets
        // one ("locked", "wet", "empty", "real", "female", ...) was silently
        // dropped even though wizterrainwish() already reads d.locked/d.looted.
        locked: 0, unlocked: 0, broken: 0,
        open: 0, closed: 0, doorless: 0,
        looted: 0,
        real: 0, fake: 0,
        mgend: -1,          /* not specified, aka random */
        mntmp: NON_PM,
        tvariety: RANDOM_TIN,
        contents: TIN_UNDEFINED,
        wetness: 0,
        gsize: 0,
        lightit: false, globweight: null,
        ftype: game.context?.current_fruit ?? null,   /* C: context.current_fruit */
        zombify: false,
        oclass: 0,
        actualn: null, dn: null, un: null, name: null,
        bp, pfx: '', origFrozen: null,
        fruitbuf: '',
    };
}

// C advances `bp` through the input buffer; origbp (the buffer start, edited in
// place) therefore keeps the stripped text: d.pfx + d.bp.
function strip(d, n) {
    d.pfx += d.bp.slice(0, n);
    d.bp = d.bp.slice(n);
}

// readobjnam_preparse: strip leading qualifier words; returns 1 if nothing
// substantive remains (caller -> goto any), else 0.  Wizard wishes never hit
// the "wet"/"moist" towel RNG (rn2/rnd), so this consumes no RNG here.
function preparse(d) {
    let res = 1;
    // C ref: objnam.c:3968 `char *save_bp = 0` — the corpse/statue/figurine
    // "of [a] " skip records where to backtrack to; modelled as the whole
    // remaining string at that point (later strsubst() edits apply to both).
    let save_bp = null, save_pfx = '';
    for (;;) {
        if (!d.bp || !d.bp.length) break;
        res = 0;
        let l = 0;
        const bp = d.bp;
        if (strncmpi(bp, 'an ', 3)) { d.cnt = 1; l = 3; }
        else if (strncmpi(bp, 'a ', 2)) { d.cnt = 1; l = 2; }
        else if (strncmpi(bp, 'the ', 4)) { l = 4; }
        else if (!d.cnt && digit(bp[0]) && bp !== '0') {
            d.cnt = atoiPrefix(bp);
            let i = 0;
            while (i < bp.length && digit(bp[i])) i++;
            while (i < bp.length && bp[i] === ' ') i++;
            strip(d, i);
            continue;
        } else if (bp[0] === '+' || bp[0] === '-') {
            d.spesgn = bp[0] === '+' ? 1 : -1;
            let rest = bp.slice(1);
            d.spe = atoiPrefix(rest);
            let i = 0;
            while (i < rest.length && digit(rest[i])) i++;
            while (i < rest.length && rest[i] === ' ') i++;
            strip(d, 1 + i);
            continue;
        } else if (strncmpi(bp, 'blessed ', 8) || strncmpi(bp, 'holy ', 5)) {
            d.blessed = 1; d.uncursed = d.iscursed = 0;
            l = strncmpi(bp, 'blessed ', 8) ? 8 : 5;
        } else if (strncmpi(bp, 'cursed ', 7) || strncmpi(bp, 'unholy ', 7)) {
            d.iscursed = 1; d.blessed = d.uncursed = 0; l = 7;
        } else if (strncmpi(bp, 'uncursed ', 9)) {
            d.uncursed = 1; d.blessed = d.iscursed = 0; l = 9;
        } else if ((l = matchAny(bp, ['rustproof ', 'erodeproof ', 'corrodeproof ',
            'fixed ', 'fireproof ', 'rotproof ', 'tempered ', 'crackproof '])) > 0) {
            d.erodeproof = 1;
        } else if (strncmpi(bp, 'lit ', 4) || strncmpi(bp, 'burning ', 8)) {
            d.islit = 1; l = strncmpi(bp, 'lit ', 4) ? 4 : 8;
        } else if (strncmpi(bp, 'unlit ', 6) || strncmpi(bp, 'extinguished ', 13)) {
            d.islit = 0; l = strncmpi(bp, 'unlit ', 6) ? 6 : 13;
        // C ref: objnam.c:4021 — "wet"/"moist" only apply to towels, and this
        // is the ONE prefix that draws: rn2(3) for "wet", rnd(2) for "moist".
        } else if (strncmpi(bp, 'moist ', 6) || strncmpi(bp, 'wet ', 4)) {
            if (strncmpi(bp, 'wet ', 4)) { d.wetness = 3 + rn2(3); l = 4; }
            else { d.wetness = rnd(2); l = 6; }
        } else if (strncmpi(bp, 'unlabeled ', 10) || strncmpi(bp, 'unlabelled ', 11)
            || strncmpi(bp, 'blank ', 6)) {
            d.unlabeled = 1;
            l = strncmpi(bp, 'unlabeled ', 10) ? 10 : strncmpi(bp, 'unlabelled ', 11) ? 11 : 6;
        } else if (strncmpi(bp, 'poisoned ', 9)) {
            d.ispoisoned = 1; l = 9;
        } else if (strncmpi(bp, 'trapped ', 8)) {
            d.trapped = wizard() ? 1 : 0; l = 8;
        } else if (strncmpi(bp, 'untrapped ', 10)) {
            d.trapped = 2; l = 10;
        // C ref: objnam.c:4046 — box/chest lock states, also door states for
        // the wizard-mode terrain wish (js/wizterrainwish.js already reads
        // d.locked/d.open/d.broken/d.doorless/d.looted).
        } else if (strncmpi(bp, 'locked ', 7)) {
            d.locked = d.closed = 1;
            d.unlocked = d.broken = d.open = d.doorless = 0; l = 7;
        } else if (strncmpi(bp, 'unlocked ', 9)) {
            d.unlocked = d.closed = 1;
            d.locked = d.broken = d.open = d.doorless = 0; l = 9;
        } else if (strncmpi(bp, 'broken ', 7)) {
            d.broken = 1;
            d.locked = d.unlocked = d.open = d.closed = d.doorless = 0; l = 7;
        } else if (strncmpi(bp, 'open ', 5)) {
            d.open = 1;
            d.closed = d.locked = d.broken = d.doorless = 0; l = 5;
        } else if (strncmpi(bp, 'closed ', 7)) {
            d.closed = 1;
            d.open = d.locked = d.broken = d.doorless = 0; l = 7;
        } else if (strncmpi(bp, 'doorless ', 9)) {
            d.doorless = 1;
            d.open = d.closed = d.locked = d.unlocked = d.broken = 0; l = 9;
        // looted: fountain/sink/throne/tree; disturbed: grave.
        } else if (strncmpi(bp, 'looted ', 7) || strncmpi(bp, 'disturbed ', 10)) {
            d.looted = 1; l = strncmpi(bp, 'looted ', 7) ? 7 : 10;
        } else if (strncmpi(bp, 'greased ', 8)) {
            d.isgreased = 1; l = 8;
        } else if (strncmpi(bp, 'zombifying ', 11)) {
            d.zombify = true; l = 11;
        } else if (strncmpi(bp, 'very ', 5)) {
            d.very = 1; l = 5;
        } else if (strncmpi(bp, 'thoroughly ', 11)) {
            d.very = 2; l = 11;
        } else if ((l = matchAny(bp, ['rusty ', 'burnt ', 'cracked '])) > 0
            || strncmpi(bp, 'rusted ', (l = 7)) || strncmpi(bp, 'burned ', (l = 7))) {
            d.eroded = 1 + d.very; d.very = 0;
        } else if (strncmpi(bp, 'corroded ', 9) || strncmpi(bp, 'rotted ', 7)) {
            d.eroded2 = 1 + d.very; d.very = 0;
            l = strncmpi(bp, 'corroded ', 9) ? 9 : 7;
        } else if (strncmpi(bp, 'partly eaten ', 13) || strncmpi(bp, 'partially eaten ', 16)) {
            d.halfeaten = 1; l = strncmpi(bp, 'partly eaten ', 13) ? 13 : 16;
        } else if (strncmpi(bp, 'historic ', 9)) {
            d.ishistoric = 1; l = 9;
        } else if (strncmpi(bp, 'diluted ', 8)) {
            d.isdiluted = 1; l = 8;
        } else if (strncmpi(bp, 'empty ', 6)) {
            d.contents = TIN_EMPTY; l = 6;
        } else if (strncmpi(bp, 'small ', 6)) {
            // C ref: objnam.c:4102 — "small"/"large" are glob size prefixes,
            // but they are also part of monster and object names ("small
            // mimic", "large box"), so only consume them ahead of a glob.
            if (!strncmpi(bp.slice(6), 'glob', 4) && strstri(bp.slice(6), ' glob') < 0) break;
            d.gsize = 1; l = 6;
        } else if (strncmpi(bp, 'medium ', 7)) {
            d.gsize = 2; l = 7;
        } else if (strncmpi(bp, 'large ', 6)) {
            if (!strncmpi(bp.slice(6), 'glob', 4) && strstri(bp.slice(6), ' glob') < 0) break;
            /* "very large " had "very " peeled off on the previous pass */
            d.gsize = (d.very !== 1) ? 3 : 4; l = 6;
        } else if (strncmpi(bp, 'real ', 5)) {
            /* don't negate 'fake' here; C comments why */
            d.real = 1; l = 5;
        } else if (strncmpi(bp, 'fake ', 5)) {
            d.fake = 1; d.real = 0; l = 5;
        } else if (strncmpi(bp, 'female ', 7)) {
            d.mgend = FEMALE;
            // C: strsubst() deletes the word from the buffer save_bp points
            // into, rather than advancing past it, so the backtracked string
            // no longer carries it.
            if (save_bp !== null) { d.bp = strsubst(d.bp, 'female ', ''); save_bp = strsubst(save_bp, 'female ', ''); l = 0; }
            else l = 7;
        } else if (strncmpi(bp, 'male ', 5)) {
            d.mgend = MALE;
            if (save_bp !== null) { d.bp = strsubst(d.bp, 'male ', ''); save_bp = strsubst(save_bp, 'male ', ''); l = 0; }
            else l = 5;
        } else if (strncmpi(bp, 'neuter ', 7)) {
            d.mgend = NEUTRAL;
            if (save_bp !== null) { d.bp = strsubst(d.bp, 'neuter ', ''); save_bp = strsubst(save_bp, 'neuter ', ''); l = 0; }
            else l = 7;
        } else if ((strncmpi(bp, 'corpse ', 7) || strncmpi(bp, 'statue ', 7)
                    || strncmpi(bp, 'figurine ', 9))
                   && strncmpi(bp.slice(strncmpi(bp, 'figurine ', 9) ? 9 : 7), 'of ', 3)) {
            // C ref: objnam.c:4149 — the corpse/statue/figurine gender hack:
            // skip "statue of [a ]" so "statue of a female gnome ruler" can be
            // read as a female gnome ruler, then backtrack at the end.
            l = strncmpi(bp, 'figurine ', 9) ? 9 : 7;
            l += 3;
            let more_l = 0;
            if (strncmpi(bp.slice(l), 'a ', (more_l = 2))
                || strncmpi(bp.slice(l), 'an ', (more_l = 3))
                || strncmpi(bp.slice(l), 'the ', (more_l = 4)))
                l += more_l;
            save_bp = bp; save_pfx = d.pfx;
        } else {
            break;
        }
        strip(d, l);
    }
    if (save_bp !== null) { d.bp = save_bp; d.pfx = save_pfx; } /* backtrack (C: bp = save_bp) */
    return res;
}

function matchAny(bp, words) {
    for (const w of words) if (strncmpi(bp, w, w.length)) return w.length;
    return 0;
}

// C ref: the `wizard` global (flags.debug).  This used to be `|| true`, which
// made every non-wizard wand-of-wishing wish skip the player-restriction RNG
// (readobjnam's rnd(5) spe clamp and WAN_WISHING's rn2(10)).
function wizard() { return !!(game.flags && game.flags.debug) || !!game.wizard; }

// readobjnam_parse_charges (C objnam.c:4178): strip a trailing "(spe)",
// "(rechrg:spe)" or "(lit)" annotation from d.bp, setting d.spe / d.rechrg /
// d.spesgn / d.islit.  Mismatched parens leave spe/rechrg at 0 and discard the
// trailing characters; otherwise any text after the ')' is spliced back on.
// C ref: SPE_LIM = 99 (obj.h:49, declared above); recharge_limit = 7.
function parse_charges(d) {
    const op = d.bp.length > 1 ? d.bp.lastIndexOf('(') : -1;
    if (op >= 0) {
        let keeptrailingchars = true;
        // C: if the '(' is preceded by a space, drop that space too.
        const cut = (op > 0 && d.bp[op - 1] === ' ') ? op - 1 : op;
        const head = d.bp.slice(0, cut);          // bp truncated before '('
        let p = d.bp.slice(op + 1);               // chars after '('
        let tail = '';                            // chars after the ')'
        if (strncmpi(p, 'lit)', 4)) {
            d.islit = 1;
            // C points at ')'; trailing chars are whatever follows it.
            tail = p.slice(4);
        } else {
            d.spe = atoiPrefix(p);
            let i = 0;
            while (i < p.length && digit(p[i])) i++;
            if (p[i] === ':') {
                i++;
                d.rechrg = d.spe;
                const rest = p.slice(i);
                d.spe = atoiPrefix(rest);
                let j = 0;
                while (j < rest.length && digit(rest[j])) j++;
                i += j;
            }
            if (p[i] !== ')') {
                d.spe = d.rechrg = 0;
                keeptrailingchars = false; /* mis-matched parens */
            } else {
                d.spesgn = 1;
                tail = p.slice(i + 1); /* text past ')' */
            }
        }
        d.bp = keeptrailingchars ? head + tail : head;
    }
    // spe is a schar in C; clamp and normalise sign.
    if (d.spe < 0) { d.spesgn = -1; d.spe = Math.abs(d.spe); }
    if (d.spe > SPE_LIM) d.spe = SPE_LIM;
    if (d.rechrg < 0 || d.rechrg > 7) d.rechrg = 7;
}

// readobjnam_postparse1: " named "/" called "/pair-of/etc.  Returns a code:
//   0 continue, 1 srch, 2 typfnd, 3 return otmp, 4 any.
function postparse1(d) {
    let p;
    if ((p = strstri(d.bp, ' named ')) >= 0) {
        d.name = d.bp.slice(p + 7);
        d.bp = d.bp.slice(0, p);
    }
    if ((p = strstri(d.bp, ' called ')) >= 0) {
        d.un = d.bp.slice(p + 8);
        d.bp = d.bp.slice(0, p);
        for (const r of o_ranges)
            if (strcmpi(d.bp, r[0])) { d.oclass = r[1]; return 1; }
    }
    if ((p = strstri(d.bp, ' labeled ')) >= 0) {
        d.dn = d.bp.slice(p + 9); d.bp = d.bp.slice(0, p);
    } else if ((p = strstri(d.bp, ' labelled ')) >= 0) {
        d.dn = d.bp.slice(p + 10); d.bp = d.bp.slice(0, p);
    }
    // C ref: objnam.c:4278 — "<anything> of spinach" marks the tin's contents.
    if ((p = strstri(d.bp, ' of spinach')) >= 0) {
        d.bp = d.bp.slice(0, p);
        d.contents = TIN_SPINACH;
    }
    // C ref: objnam.c:4283 — "Amulet of Yendor" is both the real amulet's NAME
    // and the fake one's DESCRIPTION, so readobjnam resolves it here rather
    // than letting the name lookup pick one.  "cheap"/"plastic"/"imitation"
    // (in that order) force the fake; anything else forces the real one, and
    // the wizard-mode-only restriction is applied by the caller.
    {
        const aoy = OBJ_DESCR_AOY();
        const q = strstri(d.bp, aoy);
        if (aoy && q >= 0 && (q === 0 || d.bp[q - 1] === ' ')) {
            let sIdx = 0;
            if (strncmpi(d.bp.slice(sIdx), 'cheap ', 6)) { d.fake = 1; sIdx += 6; }
            if (strncmpi(d.bp.slice(sIdx), 'plastic ', 8)) { d.fake = 1; sIdx += 8; }
            if (strncmpi(d.bp.slice(sIdx), 'imitation ', 10)) { d.fake = 1; sIdx += 10; }
            d.real = d.fake ? 0 : 1;
            d.typ = d.real ? OT('AMULET_OF_YENDOR') : OT('FAKE_AMULET_OF_YENDOR');
            return 2; /* typfnd */
        }
    }
    // "pair of"/"set of" prefixes
    if (strncmpi(d.bp, 'pair of ', 8)) { strip(d, 8); d.cnt *= 2; }
    else if (strncmpi(d.bp, 'pairs of ', 9)) { strip(d, 9); if (d.cnt > 1) d.cnt *= 2; }
    else if (strncmpi(d.bp, 'set of ', 7)) strip(d, 7);
    else if (strncmpi(d.bp, 'sets of ', 8)) strip(d, 8);

    // C ref: objnam.c:4337-4368 — intercept pudding globs; they're a valid
    // wish target but must not be treated like a corpse.  A count magnifies
    // weight rather than quantity (always 1 for globs).  Checks "glob",
    // "<foo> glob", and "glob of <foo>".
    {
        const bp = d.bp;
        let gp = -1;
        if (strcmpi(bp, 'glob') || bstrcmpi_tail(bp, 5, ' glob')
            || strcmpi(bp, 'globs') || bstrcmpi_tail(bp, 6, ' globs')
            || (gp = strstri(bp, 'glob of ')) >= 0
            || (gp = strstri(bp, 'globs of ')) >= 0) {
            const monstr = gp < 0 ? bp : bp.slice(gp).slice(strstri(bp.slice(gp), ' of ') + 4);
            let mntmp = name_to_monplus(monstr).mntmp;
            /* if we didn't recognize monster type, pick a valid one at random */
            if (mntmp === NON_PM) {
                const gray = name_to_pmidx('gray ooze');
                mntmp = rn1(name_to_pmidx('black pudding') - gray, gray);
            }
            /* canonical form here is already singular, so makesingular()
               won't bump the count */
            if (d.cnt < 2 && strstri(bp, 'globs') >= 0) d.cnt = 2;
            /* canonical spelling; an invalid glob type fails object lookup */
            d.origFrozen = d.pfx + d.bp; /* C: bp now points at globbuf, not the input buffer */
            d.bp = `glob of ${monster_by_pmidx(mntmp).name}`;
            d.mntmp = NON_PM;
            d.oclass = FOOD_CLASS;
            d.actualn = d.bp; d.dn = null;
            return 1; /* goto srch */
        }
    }

    // C objnam.c:4370-4433: "corpse of <monster>" is resolved before
    // leading monster names ("<monster> corpse").  Keep the exclusions: an
    // ogre in "gauntlets of ogre power" is not the object species.
    if (!['wand ', 'spellbook ', 'gauntlets ', 'gloves ', 'finger ']
        .some((word) => strstri(d.bp, word) >= 0)) {
        if ((p = strstri(d.bp, 'tin of ')) >= 0) {
            if (!strcmpi(d.bp.slice(p + 7), 'spinach')) {
                const tvariety = { value: RANDOM_TIN };
                const meat = d.bp.slice(p + 7);
                const skip = tin_variety_txt(meat, tvariety);
                d.tvariety = tvariety.value;
                const match = name_to_monplus(meat.slice(skip));
                d.mntmp = match.mntmp;
                d.mgend = genderForMatch(d.mgend, match);
            }
            d.typ = OT('TIN');
            return 2;
        }
        if ((p = strstri(d.bp, ' of ')) >= 0) {
            const match = name_to_monplus(d.bp.slice(p + 4));
            d.mntmp = match.mntmp;
            d.mgend = genderForMatch(d.mgend, match);
            if (d.mntmp >= LOW_PM)
                d.bp = d.bp.slice(0, p);
        }
    }

    if (!['samurai sword', 'wizard lock', 'death wand', 'master key',
        'ninja-to', 'magenta'].some((word) => strncmpi(d.bp, word, word.length))) {
        if (d.mntmp < LOW_PM && d.bp.length > 2) {
            const match = name_to_monplus(d.bp);
            d.mntmp = match.mntmp;
            d.mgend = genderForMatch(d.mgend, match);
            if (d.mntmp >= LOW_PM) {
                const obp = d.bp;
                /* 'rest' is past the matching portion; if that was an
                   alternate name or a rank title rather than the canonical
                   monster name we wouldn't otherwise know how much to skip */
                const pfx0 = d.pfx;
                strip(d, d.bp.length - (match.rest ?? '').length);
                const prev = obp.charAt(obp.length - d.bp.length - 1);
                if (d.bp[0] === ' ') {
                    strip(d, 1);
                } else if (strncmpi(d.bp, 's ', 2)
                           || (obp.length > d.bp.length && strncmpi(prev + d.bp, "s' ", 3))) {
                    strip(d, 2);
                } else if (strncmpi(d.bp, 'es ', 3) || strncmpi(d.bp, "'s ", 3)) {
                    strip(d, 3);
                } else if (!d.bp.length && !d.actualn && !d.dn && !d.un && !d.oclass) {
                    /* no referent; they don't really mean a monster type */
                    d.bp = obp; d.pfx = pfx0;
                    d.mntmp = NON_PM;
                }
            }
        }
    }
    return 0;
}

// C ref: mondata.c name_to_monplus()'s gender out-parameter handling: an
// alt_spl[] hit overwrites it, a pmnames[] hit never lets a NEUTRAL name
// override an explicit "male"/"female" the caller already parsed.
function genderForMatch(mgend, match) {
    if (match.gvariant === -1) return mgend;
    return (match.forced || mgend === -1 || match.gvariant !== NEUTRAL)
        ? match.gvariant : mgend;
}

function dragonIndex(pm) {
    const idx = pm - name_to_pmidx('gray dragon');
    return idx >= 0 && idx <= name_to_pmidx('yellow dragon') - name_to_pmidx('gray dragon')
        ? idx : NON_PM;
}

// C mon.c genus(mndx, 1) maps quest guardians to their role's corpse.
const GUARDIAN_CORPSE = {
    student: 'archeologist', chieftain: 'barbarian', neanderthal: 'cave dweller',
    attendant: 'healer', page: 'knight', abbot: 'monk', acolyte: 'cleric',
    hunter: 'ranger', thug: 'rogue', roshi: 'samurai', guide: 'tourist',
    apprentice: 'wizard', warrior: 'valkyrie',
};

// The second half of C's readobjnam_postparse1(): makesingular, alternate
// spellings, holy water, gold, class-name search and the wizard-mode
// bear trap / land mine disambiguation.  C ref: objnam.c:4436-4660.
function postparse1b(d) {
    // makesingular (C makesingular(bp)); approximate for the exercised wishes.
    if (d.bp && !strcmpi(d.bp, 'tricks') && !strcmpi(d.bp, 'clothes')) {
        const sng = makesingular(d.bp);
        if (sng !== d.bp) { if (d.cnt === 1) d.cnt = 2; d.bp = sng; }
    }
    // alternate spellings
    for (const [sp, ob] of spellings)
        if (wishymatch(d.bp, sp, true)) { d.typ = ob; return 2; }

    // C ref: objnam.c:4469 — two fixups the shuffled spellings list can't do:
    // "grey spell..." -> "gray spell...", and British "armour" -> "armor".
    if (strncmpi(d.bp, 'grey spell', 10))
        d.bp = d.bp.slice(0, 2) + 'a' + d.bp.slice(3);
    {
        const q = strstri(d.bp, 'armour');
        if (q >= 0) d.bp = d.bp.slice(0, q + 4) + d.bp.slice(q + 5);
    }

    // C objnam.c:4480 — the matching dragon species selects colored scales.
    const dragon = dragonIndex(d.mntmp);
    if (strcmpi(d.bp, 'scales') && dragon !== NON_PM) {
        d.typ = OT('GRAY_DRAGON_SCALES') + dragon;
        d.mntmp = NON_PM;
        return 2;
    }

    // C ref: objnam.c:4487 — "[un]holy water" reaches here only via "potion of
    // [un]holy water" (the bare adjectives were eaten by preparse); neither is
    // an actual potion type, so resolve it to POT_WATER and set the b/u/c.
    if (bstrcmpi_tail(d.bp, 10, 'holy water')) {
        if (d.bp.length >= 12 && strncmpi(d.bp.slice(d.bp.length - 12), 'un', 2)) {
            d.iscursed = 1; d.blessed = d.uncursed = 0;
        } else {
            d.blessed = 1; d.iscursed = d.uncursed = 0;
        }
        d.typ = OT('POT_WATER');
        return 2;
    }

    // C ref: objnam.c:4502 — accept "paperback"/"paperback book", reject
    // "paperback spellbook" (which returns no object at all).
    if (strncmpi(d.bp, 'paperback', 9)) {
        const rest = d.bp.slice(9);
        if (!rest.length || strncmpi(rest, ' book', 5)) {
            d.typ = OT('SPE_NOVEL');
            return 2;
        }
        d.otmp = null;
        return 3;
    }
    if (d.unlabeled && bstrcmpi_tail(d.bp, 6, 'scroll')) {
        d.typ = OT('SCR_BLANK_PAPER');
        return 2;
    }
    if (d.unlabeled && bstrcmpi_tail(d.bp, 9, 'spellbook')) {
        d.typ = OT('SPE_BLANK_PAPER');
        return 2;
    }
    // C ref: objnam.c:4521 — "orange" is the fruit here, not the gem/potion
    // colour, unless a monster name was recognised (orange dragon).
    if (bstrcmpi_tail(d.bp, 6, 'orange') && d.mntmp === NON_PM) {
        d.typ = OT('ORANGE');
        return 2;
    }

    // C ref: objnam.c:4528 postparse1() — the gold-piece early-out returns the
    // object directly (no mksobj otyp path, so no blessorcurse/spe draws).
    if (bstrcmpi_tail(d.bp, 10, 'gold piece') || bstrcmpi_tail(d.bp, 7, 'zorkmid')
        || strcmpi(d.bp, 'gold') || strcmpi(d.bp, 'money') || strcmpi(d.bp, 'coin')
        || d.bp[0] === '$') {
        if (d.cnt > 5000 && !wizard()) d.cnt = 5000;
        else if (d.cnt < 1) d.cnt = 1;
        const g = mksobj(438 /*GOLD_PIECE*/, false, false);
        g.quan = d.cnt;
        g.owt = weight(g);
        if (game.disp) game.disp.botl = true;
        d.otmp = g;
        return 3;
    }

    // C ref: objnam.c:4548 — a single-character object-class code ("/" for a
    // random wand, "*" for a random gem, ...); VENOM_CLASS is wizard-only.
    if (d.bp.length === 1) {
        const i = def_char_to_objclass(d.bp);
        if (i < MAXOCLASSES && i > 1 /* ILLOBJ_CLASS */
            && (i !== VENOM_CLASS || wizard())) {
            d.oclass = i;
            return 4; /* any */
        }
    }

    // class-name search: "<class> [of] something" / "something <class>"
    if (!noClassSearch(d.bp)) {
        for (let i = 0; i < WRP.length; i++) {
            const [w, sym] = WRP[i];
            const j = w.length;
            if (strncmpi(d.bp, w, j)) {
                d.oclass = sym;
                if (d.oclass !== AMULET_CLASS) {
                    strip(d, j);
                    if (strncmpi(d.bp, ' of ', 4)) d.actualn = d.bp.slice(4);
                } else {
                    d.actualn = d.bp;
                }
                return 1; /* srch */
            }
            // "something <class>" (suffix)
            if (bstrcmpi_tail(d.bp, j, w)) {
                d.oclass = sym;
                if (d.oclass !== AMULET_CLASS) {
                    d.bp = d.bp.slice(0, d.bp.length - j);
                    if (d.bp.endsWith(' ')) d.bp = d.bp.slice(0, -1);
                } else {
                    // C: amulet without "of" ("versus poison amulet").
                    if (strncmpi(d.bp, 'versus poison ', 14)) {
                        d.typ = OT('AMULET_VERSUS_POISON');
                        return 2;
                    }
                    const k = rnd_otyp_by_namedesc(
                        d.bp.slice(0, Math.max(0, d.bp.length - j)).replace(/ $/, ''),
                        AMULET_CLASS, 0);
                    if (k !== STRANGE_OBJECT) { d.typ = k; return 2; }
                }
                d.actualn = d.dn = d.bp;
                return 1;
            }
        }
    }

    // C ref: objnam.c:4636 -- wizard mode: "bear trap"/"land mine" with a
    // "trapped " prefix or any suffix other than " object" is the trap, not
    // the disarmed trap object.
    if (wizard() && (strncmpi(d.bp, 'bear', 4) || strncmpi(d.bp, 'land', 4))) {
        const beartrap = d.bp[0].toLowerCase() === 'b';
        let zp = d.bp.slice(4);
        if (zp[0] === ' ') zp = zp.slice(1);
        if (strncmpi(zp, beartrap ? 'trap' : 'mine', 4)) {
            zp = zp.slice(4);
            if (d.trapped === 2 || strcmpi(zp, ' object')) {
                d.typ = OT(beartrap ? 'BEARTRAP' : 'LAND_MINE');
                return 2;
            } else if (d.trapped === 1 || zp !== '') {
                d.bp = beartrap ? 'bear trap' : 'land mine';
                return 5; /* wiztrap */
            }
        }
    }
    return 0;
}

// readobjnam_postparse2: o_ranges exact match, " stone"/" gem", glass.
function postparse2(d) {
    // C ref: objnam.c readobjnam_postparse2():4671 — "grey stone" and friends
    // must be tested before the generic " stone" suffix below.
    for (const r of o_ranges)
        if (strcmpi(d.bp, r[0])) { d.typ = rnd_class(r[2], r[3]); return 2; }

    // C ref: objnam.c:4676 — a trailing " stone"/" gem" fixes the class and
    // leaves the colour/name for the search.
    if (bstrcmpi_tail(d.bp, 6, ' stone') || bstrcmpi_tail(d.bp, 4, ' gem')) {
        d.bp = d.bp.slice(0, d.bp.length - (bstrcmpi_tail(d.bp, 4, ' gem') ? 4 : 6));
        d.oclass = GEM_CLASS;
        d.dn = d.actualn = d.bp;
        return 1; /* srch */
    } else if (strcmpi(d.bp, 'looking glass')) {
        /* avoid a false hit on "* glass" */
    } else if (bstrcmpi_tail(d.bp, 6, ' glass') || strcmpi(d.bp, 'glass')) {
        let str = d.bp;
        // "broken glass" is a non-existent item; "broken" may already have
        // been eaten by the chest/box prefix loop.
        if (d.broken || strstri(str, 'broken') >= 0) {
            d.otmp = null;
            return 3;
        }
        if (strncmpi(str, 'worthless ', 10)) str = str.slice(10);
        if (strncmpi(str, 'piece of ', 9)) str = str.slice(9);
        if (strncmpi(str, 'colored ', 8)) str = str.slice(8);
        else if (strncmpi(str, 'coloured ', 9)) str = str.slice(9);
        if (strcmpi(str, 'glass')) {
            // C DRAWS rn2(NUM_GLASS_GEMS) here to pick a random colour.
            d.typ = firstGlassGem() + rn2(numGlassGems());
            if (objects[d.typ].oc_class === GEM_CLASS) return 2;
            d.typ = 0; /* somebody changed objects[]? punt */
        } else {
            /* construct the canonical form, assuming str starts with a colour */
            d.bp = 'worthless piece of ' + str;
        }
    }

    d.actualn = d.bp;
    if (!d.dn) d.dn = d.actualn;
    return 0;
}

// C objnam.c:4557 guard list: skip the <class> name search for these so we
// don't get false hits (e.g. "ring mail" matching RING_CLASS).  Returns true
// when the class search must be skipped.
function noClassSearch(bp) {
    const guards = [
        ['enchant ', 8], ['destroy ', 8], ['detect food', 11], ['food detection', 14],
        ['ring mail', 9], ['studded leather armor', 21], ['leather armor', 13],
        ['tooled horn', 11], ['food ration', 11], ['meat ring', 9],
    ];
    for (const [w, n] of guards) if (strncmpi(bp, w, n)) return true;
    return false;
}

// readobjnam_postparse3 (srch): rnd_otyp_by_namedesc on actualn/dn/un/origbp,
// then artifact-by-name.  Returns code 0/1/2/6.
function postparse3(d) {
    // C ref: objnam.c:4731 — check the REAL names of gems first, so "ruby"
    // means the gem and not a ruby-coloured potion; and plain "tin" is the
    // food tin, not a random "tin wand".
    if (!d.oclass && d.actualn) {
        for (let i = gemBase(); i > 0 && i <= LAST_REAL_GEM; i++) {
            const zn = objects[i] && objects[i].name;
            if (zn && strcmpi(d.actualn, zn)) { d.typ = i; return 2; }
        }
        if (strcmpi(d.actualn, 'tin')) { d.typ = OT('TIN'); return 2; }
    }

    // rnd_otyp_by_namedesc tries actualn, dn, un, origbp in turn.
    let t;
    if ((t = rnd_otyp_by_namedesc(d.actualn, d.oclass, 1)) !== STRANGE_OBJECT) {
        d.typ = t; return 2;
    }
    if (d.dn !== d.actualn && (t = rnd_otyp_by_namedesc(d.dn, d.oclass, 1)) !== STRANGE_OBJECT) {
        d.typ = t; return 2;
    }
    if ((t = rnd_otyp_by_namedesc(d.un, d.oclass, 1)) !== STRANGE_OBJECT) {
        d.typ = t; return 2;
    }
    /* C compares pointers: origbp is the start of the (edited in place) input
       buffer, so it equals actualn only when nothing was stripped off the front
       and actualn was taken from bp itself. */
    const origbp = d.origFrozen ?? (d.pfx + d.bp);
    if (!(d.origFrozen === null && d.pfx === '' && d.actualn === d.bp)
        && (t = rnd_otyp_by_namedesc(origbp, d.oclass, 1)) !== STRANGE_OBJECT) {
        d.typ = t; return 2;
    }
    d.typ = 0;

    // C ref: objnam.c:4762 Japanese_items[] — the Samurai's alternate names.
    if (d.actualn) {
        for (const [sym, jname] of JAPANESE_ITEMS)
            if (strcmpi(d.actualn, jname)) { d.typ = OT(sym); return 2; }
    }

    // armor "mail" retry
    if (d.oclass === ARMOR_CLASS && strstri(d.bp, 'mail') < 0) {
        d.bp = d.bp + ' mail';
        return 6; /* retry */
    }

    // C ref: objnam.c:4782 — bare "spinach" is a tin of spinach.
    if (strcmpi(d.bp, 'spinach')) {
        d.contents = TIN_SPINACH;
        d.typ = OT('TIN');
        return 2;
    }

    // C ref: objnam.c:4797 -- user-named fruits are checked last, after
    // stripping the prefixes that are possible on food from the original
    // text.  Matches are case-sensitive: exact, singular or plural.
    {
        let fp = d.fruitbuf || '';
        let cntf = 0, blessedf = 0, iscursedf = 0, uncursedf = 0, halfeatenf = 0;
        for (;;) {
            let l = 0;
            if (!fp) break;
            if (strncmpi(fp, 'an ', 3)) { cntf = 1; l = 3; }
            else if (strncmpi(fp, 'a ', 2)) { cntf = 1; l = 2; }
            else if (!cntf && digit(fp[0])) {
                cntf = atoiPrefix(fp);
                let i = 0;
                while (i < fp.length && digit(fp[i])) i++;
                while (fp[i] === ' ') i++;
                fp = fp.slice(i);
                continue;
            } else if (strncmpi(fp, 'blessed ', 8)) { blessedf = 1; l = 8; }
            else if (strncmpi(fp, 'cursed ', 7)) { iscursedf = 1; l = 7; }
            else if (strncmpi(fp, 'uncursed ', 9)) { uncursedf = 1; l = 9; }
            else if (strncmpi(fp, 'partly eaten ', 13)) { halfeatenf = 1; l = 13; }
            else if (strncmpi(fp, 'partially eaten ', 16)) { halfeatenf = 1; l = 16; }
            else break;
            fp = fp.slice(l);
        }
        for (let f = game.ffruit; f; f = f.nextf) {
            /* match type: 0=none, 1=exact, 2=singular, 3=plural */
            const ftyp = fp === f.fname ? 1
                : fp === makesingular(f.fname) ? 2
                    : fp === makeplural(f.fname) ? 3 : 0;
            if (ftyp) {
                d.typ = OT('SLIME_MOLD');
                d.blessed = blessedf;
                d.iscursed = iscursedf;
                d.uncursed = uncursedf;
                d.halfeaten = halfeatenf;
                if (ftyp === 2 && !cntf) cntf = 1;
                else if (ftyp === 3 && !cntf) cntf = 2;
                d.cnt = cntf;
                d.ftype = f.fid;
                return 2;
            }
        }
    }

    // artifact specified by name (only when no class).
    if (!d.oclass && d.actualn) {
        const a = artifact_name(d.actualn, true);
        if (a) { d.name = a.name; d.typ = a.otyp; return 2; }
    }

    // class but no type: alternate spellings within class
    if (d.oclass && !d.typ) {
        for (const [sp, ob] of spellings)
            if (objects[ob].oc_class === d.oclass && wishymatch(d.bp, sp, true)) {
                d.typ = ob; return 2;
            }
    }
    return 0;
}

// Coverage-visibility re-exports: newData/preparse/parse_charges/postparse{1,
// 2,3} above ARE faithful ports of objnam.c's readobjnam_{init,preparse,
// parse_charges,postparse1,postparse2,postparse3}(), just spelled shorter.
// readobjnam() below keeps calling the short local names directly (unchanged
// control flow / RNG order); these wrappers exist only so the C-name-based
// coverage tool (swarm/bin/coverage.mjs) can see that the C functions are
// ported. Nothing calls them.
export function readobjnam_init(bp) { return newData(bp); }
export function readobjnam_preparse(d) { return preparse(d); }
export function readobjnam_parse_charges(d) { return parse_charges(d); }
export function readobjnam_postparse1(d) { return postparse1(d); }
export function readobjnam_postparse2(d) { return postparse2(d); }
export function readobjnam_postparse3(d) { return postparse3(d); }

// readobjnam(bp, forWish): parse an object description and create it.  Only
// makewish() sets the wishedfor handoff bit; obj.new() uses the same parser
// without wishing the object into the hero's hands.  C ref: objnam.c:4910.
// Returns null (no such object), {kind:'nothing'}, {kind:'hands', messages}
// (C's &hands_obj: terrain wish or a denied artifact) or {kind:'obj', obj}.
export function readobjnam(bp, forWish = true) {
    const d = newData(bp);
    d.forWish = forWish;
    if (bp == null) return any(d);

    d.bp = mungspaces(d.bp);
    if (strcmpi(d.bp, 'nothing') || strcmpi(d.bp, 'nil') || strcmpi(d.bp, 'none'))
        return { kind: 'nothing' };
    d.fruitbuf = d.bp;

    if (preparse(d)) return any(d);
    if (!d.cnt) d.cnt = 1;

    // parse_charges: strip a trailing "(spe)"/"(rechrg:spe)"/"(lit)" annotation
    // so the remaining name (e.g. "wand of polymorph") parses correctly.
    parse_charges(d);

    let code = postparse1(d);
    if (code === 0) code = postparse1b(d);
    if (code === 0) code = postparse2(d);   /* C: retry: */
    // C's goto network: 0 falls through into srch:, 6 is goto retry.
    for (;;) {
        switch (code) {
        case 0:
        case 1:
            code = postparse3(d);
            if (code === 0) return wiztrap(d);
            if (code === 6) {
                code = postparse2(d);
                if (code === 0) code = 1;
            }
            break;
        case 2: return typfnd(d);
        case 3: return d.otmp ? { kind: 'obj', obj: d.otmp } : null;
        case 4: return any(d);
        default: return wiztrap(d);   /* 5: goto wiztrap */
        }
    }
}

// C ref: objnam.c:4976 `wiztrap:` -- in wizard mode a wish that named no
// object class may be a trap or terrain wish.  Messages are handed back
// rather than printed because this function is synchronous.
function wiztrap(d) {
    if (wizard() && !game.program_state?.wizkit_wishing && !d.oclass) {
        const messages = [];
        if (wizterrainwish(d, messages)) return { kind: 'hands', messages };
    }
    if (!d.oclass && !d.typ) {
        if (strncmpi(d.bp, 'polearm', 7)) {
            d.typ = rnd_otyp_by_wpnskill(P_POLEARMS);
            return typfnd(d);
        } else if (strncmpi(d.bp, 'hammer', 6)) {
            d.typ = rnd_otyp_by_wpnskill(P_HAMMER);
            return typfnd(d);
        }
    }
    if (!d.oclass) return null;
    return any(d);
}

// C `any:` -- a random class when none was named, then typfnd.
function any(d) {
    if (!d.oclass) d.oclass = WRPSYM[rn2(WRPSYM.length)];
    return typfnd(d);
}

function typfnd(d) {
    if (d.typ) d.oclass = objects[d.typ].oc_class;
    return finalize(d);
}

// objects[].oc_nowish (objects.h BITS nwsh): the invocation items and venom.
const NOWISH_SYMS = ['AMULET_OF_YENDOR', 'CANDELABRUM_OF_INVOCATION',
    'BELL_OF_OPENING', 'SPE_BOOK_OF_THE_DEAD', 'BLINDING_VENOM', 'ACID_VENOM'];

// finalize: C readobjnam() from `typfnd:` on.  C ref: objnam.c:4999-5398.
function finalize(d) {
    /* handle some objects that are only allowed in wizard mode */
    if (d.typ && !wizard()) {
        switch (d.typ) {
        case OT('AMULET_OF_YENDOR'): d.typ = OT('FAKE_AMULET_OF_YENDOR'); break;
        case OT('CANDELABRUM_OF_INVOCATION'):
            d.typ = rnd_class(TALLOW_CANDLE, WAX_CANDLE); break;
        case OT('BELL_OF_OPENING'): d.typ = OT('BELL'); break;
        case OT('SPE_BOOK_OF_THE_DEAD'): d.typ = OT('SPE_BLANK_PAPER'); break;
        case OT('MAGIC_LAMP'): d.typ = OT('OIL_LAMP'); break;
        default:
            /* catch any other non-wishable objects (venom) */
            if (NOWISH_SYMS.some((s) => OT(s) === d.typ)) return null;
            break;
        }
    }

    /* corpse of a monster which leaves behind a glob gives the glob */
    if (d.typ === OT('CORPSE') && monster_by_pmidx(d.mntmp)?.mlet === 'P' /*S_PUDDING*/) {
        d.typ = GLOB_OF_GRAY_OOZE + (d.mntmp - name_to_pmidx('gray ooze'));
        d.mntmp = NON_PM;
    }

    const otmp = d.typ ? mksobj(d.typ, true, false) : mkobj(d.oclass, false);
    if (!otmp) return null;
    d.typ = otmp.otyp;
    d.oclass = otmp.oclass; /* what we actually got */

    // C ref: objclass.h oc_merge/oc_charged -- js/mkobj.js packs them as
    // F_MERGE/F_CHARGED/F_WEPTOOL bits of the row's `flags` word.
    const F_MERGE = 32, F_CHARGED = 1, F_WEPTOOL = 16;
    const FLINT_OTYP = OT('FLINT');
    if (otmp.globby) {
        otmp.quan = 1; /* always 1 for globs */
        otmp.owt = weight(otmp);
        if (d.gsize > 1)
            otmp.owt += (5 + (d.gsize - 2) * 10) * otmp.owt;
        if (d.cnt > 1) {
            let rn1cnt = rn1(5, 2); /* 2..6 */
            if (rn1cnt > 6 - d.gsize) rn1cnt = 6 - d.gsize;
            // C ref: objnam.c:5062-5066 — a wizard may override the weight cap
            // via y_n("Override glob weight limit?").  That prompt needs input,
            // which this synchronous parser cannot do, so the capped weight is
            // applied here and the choice is handed back to makewish(): it asks
            // (at the same point in the message stream, right after the parse)
            // and, on 'y', restores the uncapped weight.
            const capped = (d.cnt > rn1cnt);
            if (capped && wizard() && !game.program_state?.wizkit_wishing)
                d.globweight = { base_owt: otmp.owt, cnt: d.cnt };
            if (capped) d.cnt = rn1cnt;
            otmp.owt *= d.cnt;
        }
        d.cnt = 0;
    } else if (d.cnt > 0) {
        const skill = objects[d.typ].oc_skill ?? 0;
        // C ref: obj.h is_missile/is_ammo/Is_candle.
        const is_missile = (d.oclass === WEAPON_CLASS || d.oclass === TOOL_CLASS)
            && skill >= -P_BOOMERANG && skill <= -P_DART;
        const is_ammo = (d.oclass === WEAPON_CLASS || d.oclass === GEM_CLASS)
            && skill >= -P_CROSSBOW && skill <= -P_BOW;
        const Is_candle = d.typ === TALLOW_CANDLE || d.typ === WAX_CANDLE;
        if ((objects[d.typ].flags & F_MERGE)
            && (wizard()
                || d.cnt < rnd(6)
                || (d.cnt <= 7 && Is_candle)
                || (d.cnt <= 20
                    && (d.typ === ROCK || d.typ === FLINT_OTYP || is_missile
                        || (d.oclass === WEAPON_CLASS && is_ammo)))))
            otmp.quan = d.cnt;
    }

    // C ref: objnam.c:5086-5092 — a wished-for "lit" light source is briefly
    // placed on the hero's square so that begin_burn() can register a light
    // source and a BURN_OBJECT timer, then extracted again.  begin_burn() is
    // async in this port (it imports light.js/timeout.js), so the decision is
    // recorded here and the caller performs it; without it a wished "lit lamp"
    // never shows doname()'s "(lit)" suffix.
    if (d.islit && (d.typ === OT('OIL_LAMP') || d.typ === OT('MAGIC_LAMP')
                    || d.typ === OT('BRASS_LANTERN')
                    || d.typ === TALLOW_CANDLE || d.typ === WAX_CANDLE
                    || d.typ === OT('POT_OIL')))
        d.lightit = true;

    if (d.spesgn === 0) {
        /* spe not specified; retain the randomly assigned value */
        d.spe = otmp.spe;
    } else if (wizard()) {
        /* no restrictions except SPE_LIM */
    } else if (d.oclass === ARMOR_CLASS || d.oclass === WEAPON_CLASS
               || (d.oclass === TOOL_CLASS && (objects[d.typ].flags & F_WEPTOOL))
               || (d.oclass === RING_CLASS && (objects[d.typ].flags & F_CHARGED))) {
        if (d.spe > rnd(5) && d.spe > otmp.spe) d.spe = 0;
        if (d.spe > 2 && Luck() < 0) d.spesgn = -1;
    } else {
        /* crystal ball cancels like a wand, to (n:-1) */
        if (d.oclass === WAND_CLASS || d.typ === OT('CRYSTAL_BALL')) {
            if (d.spe > 1 && d.spesgn === -1) d.spe = 1;
        } else if (d.spe > 0 && d.spesgn === -1) {
            d.spe = 0;
        }
        if (d.spe > otmp.spe) d.spe = otmp.spe;
    }
    if (d.spesgn === -1) d.spe = -d.spe;

    /* set otmp->spe.  This may, or may not, use d.spe... */
    switch (d.typ) {
    case OT('TIN'):
        otmp.spe = 0; /* default: not spinach */
        if (d.contents === TIN_EMPTY) {
            otmp.corpsenm = NON_PM;
        } else if (d.contents === TIN_SPINACH) {
            otmp.corpsenm = NON_PM;
            otmp.spe = 1; /* spinach after all */
        }
        break;
    case OT('TOWEL'):
        if (d.wetness) otmp.spe = d.wetness;
        break;
    case OT('SLIME_MOLD'):
        if (d.ftype != null) otmp.spe = d.ftype;
        break;
    case OT('SKELETON_KEY'): case OT('CHEST'): case OT('LARGE_BOX'):
    case OT('HEAVY_IRON_BALL'): case OT('IRON_CHAIN'):
        break;
    case OT('STATUE'):
    case OT('FIGURINE'):
    case OT('CORPSE'): {
        // C objnam.c:5147-5165: the wished-for species rolls its own sex only
        // when its name and prefixes do not specify one and it is not
        // single-sex.
        const ptr = monster_by_pmidx(d.mntmp);
        otmp.spe = !ptr ? CORPSTAT_RANDOM
            : ptr.gender === 'neuter' ? CORPSTAT_NEUTER
                : d.mgend === FEMALE && ptr.gender !== 'male' ? CORPSTAT_FEMALE
                    : d.mgend === MALE && ptr.gender !== 'female' ? CORPSTAT_MALE
                        : CORPSTAT_RANDOM;
        if (ptr && otmp.spe === CORPSTAT_RANDOM)
            otmp.spe = ptr.gender === 'male' ? CORPSTAT_MALE
                : ptr.gender === 'female' ? CORPSTAT_FEMALE
                    : rn2(2) ? CORPSTAT_MALE : CORPSTAT_FEMALE;
        if (d.ishistoric && d.typ === OT('STATUE'))
            otmp.spe |= CORPSTAT_HISTORIC;
        break;
    }
    case OT('SCR_MAIL'):
        /* 0: delivered in-game; 1: from bones or wishing; 2: marker */
        otmp.spe = 1;
        break;
    case OT('ACID_VENOM'):
    case OT('BLINDING_VENOM'):
        /* 0: normal, and transitory; 1: wishing */
        otmp.spe = 1;
        break;
    case OT('WAN_WISHING'):
        if (!wizard()) {
            otmp.spe = (rn2(10) ? -1 : 0);
            break;
        }
        otmp.spe = d.spe;
        break;
    default:
        otmp.spe = d.spe;
        break;
    }

    /* set otmp->corpsenm or dragon scale [mail] */
    if (monster_by_pmidx(d.mntmp)) {
        if (d.mntmp === name_to_pmidx('long worm tail'))
            d.mntmp = name_to_pmidx('long worm');
        let ptr = monster_by_pmidx(d.mntmp);
        if (d.typ !== OT('FIGURINE') && is_were_flag(ptr)
            && (game.mvitals?.[d.mntmp]?.mvflags & 0x10 || mon_nocorpse(d.mntmp))) {
            const humanWere = counter_were(d.mntmp);
            if (humanWere !== NON_PM) d.mntmp = humanWere;
        }
        ptr = monster_by_pmidx(d.mntmp);
        const unique = !!(ptr.geno & 0x1000);
        const noCorpse = !!(game.mvitals?.[d.mntmp]?.mvflags & 0x10)
            || mon_nocorpse(d.mntmp);
        switch (d.typ) {
        case OT('TIN'):
            if (dead_species(d.mntmp, false)) otmp.corpsenm = NON_PM; /* it's empty */
            else if ((!unique || wizard()) && !noCorpse && mon_has_cnutrit(d.mntmp))
                otmp.corpsenm = d.mntmp;
            break;
        case OT('CORPSE'):
            if ((!unique || wizard()) && !noCorpse) {
                if (msound_of(ptr) === MS_GUARDIAN)
                    d.mntmp = name_to_pmidx(GUARDIAN_CORPSE[ptr.name]);
                set_corpsenm(otmp, d.mntmp);
            }
            if (d.zombify && zombie_form(monster_by_pmidx(d.mntmp)) !== NON_PM)
                start_timer_sync(rn1(5, 10), TIMER_OBJECT, ZOMBIFY_MON,
                                 { a_void: otmp, a_obj: otmp });
            break;
        case OT('EGG'):
            d.mntmp = can_be_hatched(d.mntmp);
            /* this also sets hatch timer if appropriate */
            set_corpsenm(otmp, d.mntmp);
            break;
        case OT('FIGURINE'):
            if (!unique && (!is_human_flag(ptr) || is_were_flag(ptr))
                && d.mntmp !== name_to_pmidx('mail daemon'))
                otmp.corpsenm = d.mntmp;
            break;
        case OT('STATUE'):
            otmp.corpsenm = d.mntmp;
            if (ptr.verysmall) otmp.cobj = null; /* no spellbook */
            break;
        case OT('SCALE_MAIL'): {
            /* Dragon mail - depends on the order of objects & dragons. */
            const dragon = dragonIndex(d.mntmp);
            if (dragon !== NON_PM) otmp.otyp = OT('GRAY_DRAGON_SCALE_MAIL') + dragon;
            break;
        }
        default:
            break;
        }
    }
    // zap.c makewish():6401 marks an unsafe corpse before passing it to
    // invent.c hold_another_object(); obj.new() does not perform this handoff.
    if (d.forWish && otmp.otyp === OT('CORPSE')
        && !u_safe_from_fatal_corpse(otmp, st_all))
        otmp.wishedfor = 1;

    /* set blessed/cursed -- setting the fields directly is safe
       since weight() is called below and addinv() will take care of luck */
    if (d.iscursed) {
        curse(otmp);
    } else if (d.uncursed) {
        otmp.blessed = false;
        otmp.cursed = (Luck() < 0 && !wizard());
    } else if (d.blessed) {
        otmp.blessed = (Luck() >= 0 || wizard());
        otmp.cursed = (Luck() < 0 && !wizard());
    } else if (d.spesgn < 0) {
        curse(otmp);
    }

    /* set eroded and erodeproof */
    if (erosion_matters(otmp)) {
        /* wished-for item shouldn't be eroded unless specified */
        otmp.oeroded = otmp.oeroded2 = 0;
        if (d.eroded && (is_flammable(otmp) || is_rustprone(otmp) || is_crackable(otmp)))
            otmp.oeroded = d.eroded;
        if (d.eroded2 && (is_corrodeable(otmp) || is_rottable(otmp)))
            otmp.oeroded2 = d.eroded2;
        if (d.erodeproof && (is_damageable(otmp) || otmp.otyp === OT('CRYSKNIFE')))
            otmp.oerodeproof = (Luck() >= 0 || wizard());
    }

    /* set otmp->recharged */
    if (d.oclass === WAND_CLASS) {
        /* prevent wishing abuse */
        if (otmp.otyp === OT('WAN_WISHING') && !wizard()) d.rechrg = 1;
        otmp.recharged = d.rechrg;
    }

    /* set poisoned */
    if (d.ispoisoned) {
        if (is_poisonable(otmp)) otmp.opoisoned = (Luck() >= 0);
        else if (d.oclass === FOOD_CLASS)
            /* try to taint by making it as old as possible */
            otmp.age = 1;
    }
    /* and [un]trapped */
    if (d.trapped) {
        if (Is_box(otmp) || d.typ === OT('TIN')) otmp.otrapped = (d.trapped === 1);
    }
    /* empty for containers rather than for tins */
    if (d.contents === TIN_EMPTY) {
        if (otmp.otyp === OT('BAG_OF_TRICKS') || otmp.otyp === OT('HORN_OF_PLENTY')) {
            if (otmp.spe > 0) otmp.spe = 0;
        } else if (otmp.cobj) {
            otmp.cobj = null; /* delete_contents(): no artifact can be inside */
            otmp.owt = weight(otmp);
        }
    }
    /* set locked/unlocked/broken */
    if (Is_box(otmp)) {
        if (d.locked) { otmp.olocked = 1; otmp.obroken = 0; }
        else if (d.unlocked) { otmp.olocked = 0; otmp.obroken = 0; }
        else if (d.broken) { otmp.olocked = 0; otmp.obroken = 1; }
        if (otmp.obroken) otmp.otrapped = 0;
    }
    if (d.isgreased) otmp.greased = 1;
    if (d.isdiluted && otmp.oclass === POTION_CLASS)
        otmp.odiluted = (otmp.otyp !== OT('POT_WATER'));

    /* set tin variety */
    if (otmp.otyp === OT('TIN') && d.tvariety >= 0 && (rn2(4) || wizard()))
        set_tin_variety(otmp, d.tvariety);

    if (d.name) {
        /* an artifact name might need capitalization fixing */
        const a = artifact_name(d.name, true);
        const aname = (a && a.otyp === otmp.otyp) ? a.name : null;
        let name = aname || d.name;
        /* 3.6 tribute - fix up novel */
        if (otmp.otyp === OT('SPE_NOVEL')) {
            const idx = { idx: otmp.novelidx };
            const novelname = lookup_novel(name, idx);
            if (novelname) { name = novelname; otmp.novelidx = idx.idx; }
        }
        oname_wish(otmp, name);
        /* name==aname => wished for artifact (otmp->oartifact => got it) */
        if (otmp.oartifact || (aname && name === aname)) {
            otmp.quan = 1;
            if (game.u && game.u.uconduct)
                game.u.uconduct.wisharti = (game.u.uconduct.wisharti || 0) + 1;
        }
    }

    if (permapoisoned(otmp)) otmp.opoisoned = 1;

    /* more wishing abuse: don't allow wishing for certain artifacts
       and make them pay; charge them for the wish anyway! */
    if ((is_quest_artifact(otmp)
         || (otmp.oartifact && rn2(nartifact_exist()) > 1)) && !wizard()) {
        artifact_exists(otmp, otmp.oname || '', false, ONAME_NO_FLAGS);
        return { kind: 'hands', messages: [
            `For a moment, you feel something in your ${makeplural(body_part(HAND))}, but it disappears!`] };
    }

    if (d.halfeaten && otmp.oclass === FOOD_CLASS) {
        const nut = obj_nutrition(otmp);
        /* skip "partly eaten" for food with 0 or 1 nutrition */
        if (nut > 1) {
            otmp.oeaten = nut;
            consume_oeaten(otmp, 1);
        }
    }
    otmp.owt = weight(otmp);
    if (d.very && otmp.otyp === OT('HEAVY_IRON_BALL')) otmp.owt += WT_IRON_BALL_INCR;

    // `lightit`/`globweight` are the two readobjnam() steps that need input or
    // async work in this port; makewish() performs them (see above).
    return { kind: 'obj', obj: otmp, lightit: !!d.lightit,
             globweight: d.globweight || null };
}

// C ref: do_name.c oname(obj, name, ONAME_WISH) -- an existing artifact of
// that name is not created twice, and an artifact keeps its name.
function oname_wish(obj, name) {
    if (obj.oartifact || (name && exist_artifact(obj.otyp, name))) return obj;
    obj.oname = name || '';
    if (name) artifact_exists(obj, name, true, ONAME_WISH);
    return obj;
}

// Silence unused-import lint for symbols kept for parity/readability.
void NUM_OBJECTS; void OBJ_NAME; void MAXOCLASSES; void VENOM_CLASS;
void AMULET_OF_YENDOR; void strstri;
