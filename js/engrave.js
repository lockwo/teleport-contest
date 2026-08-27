// engrave.js - engraving text selection and degradation.
// C refs: engrave.c random_engraving(), wipeout_text(), wipe_engr_at();
//         rumors.c init_rumors(), getrumor(), get_rnd_line(), get_rnd_text();
//         hacklib.c xcrypt().

import { game } from './gstate.js';
import { rn2, rnd, rn1 } from './rng.js';
import { BUFSZ, BURN, DUST, ENGR_BLOOD, ENGRAVE, HEADSTONE, ICE, MARK,
         FINGERTIP, GETOBJ_SUGGEST, GETOBJ_DOWNPLAY, GETOBJ_PROMPT,
         GRAVE, ROOM, TT_PIT, is_pit, is_hole, COLNO, ROWNO, IS_GRAVE,
         IS_ALTAR, IS_WALL, IS_DOOR, SDOOR, STONE, IS_FOUNTAIN, IS_AIR,
         ACCESSIBLE, CLOUD, DRAWBRIDGE_DOWN, DRAWBRIDGE_UP, isok,
         Is_airlevel, Is_waterlevel, ECMD_OK } from './const.js';
import { RUMORS_B64, ENGRAVE_B64 } from './rumors_data.js';
import { EPITAPH_B64 } from './epitaph_data.js';
import { WEAPON_CLASS, WAND_CLASS, GEM_CLASS, RING_CLASS,
         TOOL_CLASS, RANDOM_CLASS, ILLOBJ_CLASS, ARMOR_CLASS, AMULET_CLASS,
         FOOD_CLASS, POTION_CLASS, SCROLL_CLASS, SPBOOK_CLASS, COIN_CLASS,
         ROCK_CLASS, BALL_CLASS, CHAIN_CLASS, VENOM_CLASS,
         objects } from './mkobj.js';
import { mflags1_of, M1_ANIMAL } from './monflags_data.js';
import { exercise } from './attrib.js';
import { livelog_printf, LL_CONDUCT } from './livelog.js';
import { A_WIS } from './const.js';

// Heavy UI/inventory modules (display.js, invent.js, extcmd-handlers.js) are
// loaded lazily inside doengrave() to avoid a module-init cycle: display.js
// statically imports this file, so a static import back into it would create a
// temporal-dead-zone error (e.g. "Cannot access 'MAXOCLASSES' ...").

const MD_PAD_RUMORS = 60;

// ---------------------------------------------------------------------------
// Embedded dlb data files (makedefs-built, xcrypt'd + underscore-padded).
// We reproduce the C side's byte-offset line selection (rumors.c get_rnd_line)
// against the *exact* bytes the recorder read, so rumor/engrave lengths and
// contents — and therefore the rn2() call sequence in wipeout_text — match C.
// ---------------------------------------------------------------------------
const RUMORS_DATA = decodeBase64(RUMORS_B64);
const ENGRAVE_DATA = decodeBase64(ENGRAVE_B64);
const EPITAPH_DATA = decodeBase64(EPITAPH_B64);

function decodeBase64(b64) {
    if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// C ref: hacklib.c xcrypt() — symmetric bit-rotation cipher used for data files.
function xcrypt(str) {
    let out = '';
    let bitmask = 1;
    for (let i = 0; i < str.length; i++) {
        let q = str.charCodeAt(i);
        if (q & (32 | 64)) q ^= bitmask;
        out += String.fromCharCode(q);
        bitmask <<= 1;
        if (bitmask >= 32) bitmask = 1;
    }
    return out;
}

// C ref: rumors.c unpadline() — strip trailing newline then '_' padding.
function unpadline(line) {
    let p = line.length;
    if (p > 0 && line[p - 1] === '\n') --p;
    while (p > 0 && line[p - 1] === '_') --p;
    return line.slice(0, p);
}

// Mimic dlb_fgets: read bytes (as a 1:1 char string) from `pos`, stopping after
// the first '\n' (inclusive) or after BUFSZ-1 chars, or at EOF.
function dlb_fgets(data, pos) {
    let s = '';
    let i = pos;
    while (i < data.length && s.length < BUFSZ - 1) {
        const c = String.fromCharCode(data[i]);
        s += c;
        i++;
        if (c === '\n') break;
    }
    return { line: s, next: i };
}

// C ref: rumors.c get_rnd_line(). Position randomly inside [startpos,endpos),
// land mid-line, read the rest of that line, then use the *next* line (wrapping
// to startpos at EOF/endpos). Lines are xcrypt'd and underscore-padded.
function get_rnd_line(data, startpos, endpos, padlength, rng = rn2) {
    if (!endpos) endpos = data.length;
    const filechunksize = endpos - startpos;
    if (filechunksize < 1) return '';

    let bufstr = '';
    let next = startpos;
    for (let trylimit = 10; trylimit > 0; --trylimit) {
        const chunkoffset = rng(filechunksize);
        ({ line: bufstr, next } = dlb_fgets(data, startpos + chunkoffset));
        if (!padlength || bufstr.length <= padlength + 1) break;
    }

    // use next line; reaching endpos is treated as end-of-file
    if (next >= endpos) {
        ({ line: bufstr, next } = dlb_fgets(data, startpos));
    } else {
        const r = dlb_fgets(data, next);
        if (r.line.length === 0) {
            ({ line: bufstr, next } = dlb_fgets(data, startpos));
        } else {
            ({ line: bufstr, next } = r);
        }
    }

    const nl = bufstr.indexOf('\n');
    if (nl >= 0) bufstr = bufstr.slice(0, nl);
    bufstr = xcrypt(bufstr);
    if (padlength) bufstr = unpadline(bufstr);
    return bufstr;
}

// C ref: rumors.c init_rumors() — parse the header line for the true/false
// rumor file regions. Memoized; mirrors gt.true_rumor_* / gf.false_rumor_*.
let _rumorMeta = null;
function init_rumors() {
    if (_rumorMeta) return _rumorMeta;
    // line 1: "don't edit" comment; line 2: header
    const { next: p1 } = dlb_fgets(RUMORS_DATA, 0);
    const { line: header } = dlb_fgets(RUMORS_DATA, p1);
    // "%d,%ld,%lx;%d,%ld,%lx;0,0,%lx" — true_count,true_size,true_start; ...
    const m = header.match(
        /^(\d+),(\d+),([0-9a-fA-F]+);(\d+),(\d+),([0-9a-fA-F]+);0,0,([0-9a-fA-F]+)/,
    );
    const true_size = parseInt(m[2], 10);
    const true_start = parseInt(m[3], 16);
    const false_size = parseInt(m[5], 10);
    const false_start = parseInt(m[6], 16);
    _rumorMeta = {
        true_rumor_size: true_size,
        true_rumor_start: true_start,
        true_rumor_end: true_start + true_size,
        false_rumor_size: false_size,
        false_rumor_start: false_start,
        false_rumor_end: false_start + false_size,
    };
    return _rumorMeta;
}

const rubouts = [
    ['A', '^'],
    ['B', 'Pb['],
    ['C', '('],
    ['D', '|)['],
    ['E', '|FL[_'],
    ['F', '|-'],
    ['G', 'C('],
    ['H', '|-'],
    ['I', '|'],
    ['K', '|<'],
    ['L', '|_'],
    ['M', '|'],
    ['N', '|\\'],
    ['O', 'C('],
    ['P', 'F'],
    ['Q', 'C('],
    ['R', 'PF'],
    ['T', '|'],
    ['U', 'J'],
    ['V', '/\\'],
    ['W', 'V/\\'],
    ['Z', '/'],
    ['b', '|'],
    ['d', 'c|'],
    ['e', 'c'],
    ['g', 'c'],
    ['h', 'n'],
    ['j', 'i'],
    ['k', '|'],
    ['l', '|'],
    ['m', 'nr'],
    ['n', 'r'],
    ['o', 'c'],
    ['q', 'c'],
    ['w', 'v'],
    ['y', 'v'],
    [':', '.'],
    [';', ',:'],
    [',', '.'],
    ['=', '-'],
    ['+', '-|'],
    ['*', '+'],
    ['@', '0'],
    ['0', 'C('],
    ['1', '|'],
    ['6', 'o'],
    ['7', '/'],
    ['8', '3o'],
];

// C ref: rumors.c get_rnd_text() — pick a random line from a whole data file
// (no true/false split). Skips the leading "don't edit" comment line.
// The `rng` argument is C's `int (*rng)(int)` parameter: bogusmon() passes
// rn2_on_display_rng, everything else passes the core rn2.
export function get_rnd_text(data, padlength, rng = rn2) {
    const { next: starttxt } = dlb_fgets(data, 0); // skip comment line
    return get_rnd_line(data, starttxt, 0, padlength, rng);
}
// C ref: global.h:42 MD_PAD_BOGONS.
export const MD_PAD_BOGONS = 20;
export function decode_dlb(b64) { return decodeBase64(b64); }

// C ref: engrave.c make_grave() -> get_rnd_text(EPITAPHFILE, buf, rn2, MD_PAD_RUMORS).
// Emits the same rn2() draw the C side does against the makedefs-built 'epitaph' file
// (rn2(24075) over the text region, then the MD_PAD_RUMORS line scan). The epitaph text
// is not displayed at game start, so only the draw sequence is load-bearing.
export function get_rnd_epitaph() {
    return get_rnd_text(EPITAPH_DATA, MD_PAD_RUMORS);
}

// C ref: engrave.c make_grave().  The only RNG side-effect is the epitaph pick
// when no text is supplied: get_rnd_text(EPITAPHFILE, ...) -> rn2(24075) plus the
// MD_PAD_RUMORS line scan.  Dropping that draw desyncs every subsequent rn2() on
// levels that contain a grave.  The headstone text itself is not shown at game
// start, so only the draw sequence is load-bearing.
export function make_grave(x, y, text) {
    const loc = game.level?.at(x, y);
    if (!loc) return;
    // C: `if ((levl[x][y].typ != ROOM && levl[x][y].typ != GRAVE) || t_at(x,y))
    //      return;` — a trap on the square blocks the grave.
    if (loc.typ !== ROOM && loc.typ !== GRAVE) return;
    if ((game.level?.traps || []).some((t) => t.tx === x && t.ty === y)) return;
    loc.typ = GRAVE;
    // del_engr_at: drop any existing engraving at this spot (consumes no RNG)
    if (game.level?.engravings) {
        game.level.engravings = game.level.engravings.filter(
            (ep) => ep.engr_x !== x || ep.engr_y !== y,
        );
    }
    let str = text;
    if (str == null) str = get_rnd_epitaph();
    make_engr_at(x, y, str, null, 0, HEADSTONE);
}

// C ref: rumors.c getrumor(). truth: 1=true, -1=false, 0=either.
function getrumor(truth, exclude_cookie) {
    const cookie_marker = '[cookie] ';
    const marklen = cookie_marker.length;
    const meta = init_rumors();

    let rumor = '';
    let count = 0;
    let adjtruth = 0;
    do {
        rumor = '';
        // input: 1 0 -1 ; rn2+1 => 2/1=T, 1/0=T/F, 0/-1=F/F
        adjtruth = truth + rn2(2);
        let beginning;
        let ending;
        if (adjtruth >= 1) {
            beginning = meta.true_rumor_start;
            ending = meta.true_rumor_end;
        } else {
            beginning = meta.false_rumor_start;
            ending = meta.false_rumor_end;
        }
        rumor = get_rnd_line(RUMORS_DATA, beginning, ending, MD_PAD_RUMORS);
    } while (count++ < 50 && exclude_cookie
             && rumor.slice(0, marklen) === cookie_marker);

    // C ref: rumors.c getrumor() — `else if (!gi.in_mklev) exercise(A_WIS,
    // (adjtruth > 0))` (avoid exercising wisdom for graffiti placed at level
    // creation).  This rn2(19)/rn2(2) draw is part of getrumor()'s RNG.
    if (!game.in_mklev)
        exercise(A_WIS, adjtruth > 0);

    if (!exclude_cookie && rumor.slice(0, marklen) === cookie_marker)
        rumor = rumor.slice(marklen);
    return rumor;
}

// C ref: rumors.c outrumor(truth, mechanism).  mechanism BY_COOKIE/BY_PAPER
// means the hero is reading (fortune cookie or scroll of fortune); BY_ORACLE
// is the oracle path.  We model the reading path (the only one the owned
// sessions reach): blindness/faint guards short-circuit before getrumor (and
// thus before any RNG), otherwise getrumor() is consulted with exclude_cookie
// FALSE.  Returns the rumor text for the caller to pline().
export const BY_COOKIE = 0;
export const BY_PAPER = 1;
export const BY_ORACLE = 2;

export function outrumor(truth, mechanism) {
    const reading = (mechanism === BY_COOKIE || mechanism === BY_PAPER);
    if (reading) {
        // is_fainted() && BY_COOKIE: too weak to read; no RNG, no message.
        if (mechanism === BY_COOKIE && (game.u?.uhs ?? 0) >= 5 /*FAINTED*/)
            return '';
        // Blind: can't read it; no getrumor RNG.
        if (game.u?.Blind)
            return '';
    }
    // get a rumor; exclude_cookie is FALSE when reading (cookie rumors allowed).
    let line = getrumor(truth, reading ? false : true);
    if (!line)
        line = 'NetHack rumors file closed for renovation.';
    return line;
}

export function random_engraving() {
    // a random engraving may come from the "rumors" file, or the "engrave" file
    let pristine = '';
    if (!rn2(4) || !(pristine = getrumor(0, true)) || !pristine)
        pristine = get_rnd_text(ENGRAVE_DATA, MD_PAD_RUMORS);

    const text = wipeout_text(pristine, Math.trunc(pristine.length / 4), 0);
    return { text, pristine };
}

export function wipeout_text(engr, cnt, seed = 0) {
    const chars = Array.from(engr);
    let lth = chars.length;

    if (lth && cnt > 0) {
        while (cnt--) {
            let nxt, use_rubout;
            if (!seed) {
                nxt = rn2(lth);
                use_rubout = rn2(4);
            } else {
                nxt = seed % lth;
                seed *= 31;
                seed %= (BUFSZ - 1);
                use_rubout = seed & 3;
            }

            const ch = chars[nxt];
            if (ch === ' ') continue;
            if ("?. ,'`-|_".includes(ch) && ch !== ' ') {
                chars[nxt] = ' ';
                continue;
            }

            let found = false;
            if (use_rubout) {
                for (const [wipefrom, wipeto] of rubouts) {
                    if (ch === wipefrom) {
                        let j;
                        if (!seed) {
                            j = rn2(wipeto.length);
                        } else {
                            seed *= 31;
                            seed %= (BUFSZ - 1);
                            j = seed % wipeto.length;
                        }
                        chars[nxt] = wipeto[j];
                        found = true;
                        break;
                    }
                }
            }

            if (!found)
                chars[nxt] = '?';
        }
    }

    while (lth && chars[lth - 1] === ' ') {
        chars.pop();
        --lth;
    }
    return chars.join('');
}

// C ref: engrave.c del_engr(ep) — unlink one engraving from the level list.
export function del_engr(ep) {
    if (!ep || !game.level?.engravings) return;
    game.level.engravings = game.level.engravings.filter((e) => e !== ep);
}
// C ref: engrave.c del_engr_at(x, y).
export function del_engr_at(x, y) {
    del_engr(engr_at(x, y));
}

// C ref: engrave.c rloc_engr(ep) — randomly relocate an engraving.  The
// rn1(COLNO-3, 2)/rn2(ROWNO) pair is drawn once per rejected square, so the
// goodpos()/engr_at() rejection test drives the RNG stream, not just the result.
export async function rloc_engr(ep) {
    const { goodpos } = await import('./teleport.js');
    const { newsym } = await import('./display.js');
    let tryct = 200, tx, ty;
    do {
        if (--tryct < 0) return;
        tx = rn1(COLNO - 3, 2);
        ty = rn2(ROWNO);
    } while (engr_at(tx, ty) || !goodpos(tx, ty, null, 0));

    ep.engr_x = tx;
    ep.engr_y = ty;
    newsym(tx, ty); /* caller took care of the old location */
}

// C ref: engrave.c cant_reach_floor(x, y, up, check_pit, wand_engraving).
async function cant_reach_floor(x, y, up, check_pit, wand_engraving) {
    const { pline } = await import('./display.js');
    const { surface } = await import('./dungeon.js');
    const who = wand_engraving
        ? 'The wand does nothing more, and the tip of the wand' : 'You';
    const where = up ? ceiling(x, y)
        : (check_pit && can_reach_floor(false)) ? 'bottom of the pit' : surface(x, y);
    await pline(`${who} can't reach the ${where}.`);
}

// C ref: engrave.c can_reach_floor(check_pit) — the engulfed / airborne /
// teetering-over-a-pit gate.  The AT_HUGS-grabber, riding-skill and
// ceiling-hider clauses need mon/skill state this file cannot see, so only the
// swallow, Levitation, Flying and pit clauses are modelled.
// C ref: trap.c uteetering_at_seen_pit()/uescaped_shaft() for the last one.
export function can_reach_floor(check_pit) {
    const u = game.u;
    if (!u) return true;
    if (u.uswallow) return false;
    if (u.uprops?.Levitation) return false;
    if (u.uprops?.Flying) return true;
    if (check_pit) {
        const t = (game.level?.traps || []).find((tr) => tr.tx === u.ux && tr.ty === u.uy);
        if (t && t.tseen) {
            if (is_pit(t.ttyp) && !(u.utrap && u.utraptype === TT_PIT)) return false;
            if (is_hole(t.ttyp)) return false;
        }
    }
    return true;
}

export function engr_at(x, y) {
    const engravings = game.level?.engravings ?? [];
    return engravings.find((ep) => ep.engr_x === x && ep.engr_y === y) ?? null;
}

// C ref: engrave.c read_engr_at(x, y) — sense the engraving at (x,y) and read
// it out.  Both lines are plain pline()/You() in C, i.e. vpline() ->
// update_topl(), so "does this fit on the current topline or does the pending
// line page with --More-- first" is update_topl()'s decision.  The copy this
// replaced printed the intro with pline() and re-derived that rule locally, so
// it missed the case where a message from earlier in the same command was still
// unacknowledged (wave9 lp-wizard-elf 185: C pages the pet-swap line first).
// It also hardcoded "floor" where C uses surface(x,y) and printed the DUST /
// MARK / blood lines for a BLIND hero, whom C tells nothing at all.
export async function read_engr_at(x, y) {
    const ep = engr_at(x, y);
    if (!ep || !(ep.actualText || '')) return;
    const { update_topl, impossible } = await import('./display.js');
    const { surface } = await import('./dungeon.js');
    const eloc = surface(x, y);
    const on_ice = game.level?.at(x, y)?.typ === ICE;
    const Blind = isBlind();
    let sensed = 0;

    // C ref: decl.c:46 — Something is the literal "Something".
    switch (ep.engr_type) {
    case DUST:
        if (!Blind) {
            sensed = 1;
            await update_topl(`Something is written here in the ${on_ice ? 'frost' : 'dust'}.`);
        }
        break;
    case ENGRAVE:
    case HEADSTONE:
        if (!Blind || can_reach_floor(true)) {
            sensed = 1;
            await update_topl(`Something is engraved here on the ${eloc}.`);
        }
        break;
    case BURN:
        if (!Blind || can_reach_floor(true)) {
            sensed = 1;
            await update_topl(`Some text has been ${on_ice ? 'melted' : 'burned'} into the ${eloc} here.`);
        }
        break;
    case MARK:
        if (!Blind) {
            sensed = 1;
            await update_topl(`There's some graffiti on the ${eloc} here.`);
        }
        break;
    case ENGR_BLOOD:
        if (!Blind) {
            sensed = 1;
            // C: You_see() -> "You see " + line (pline.c:466).
            await update_topl('You see a message scrawled in blood here.');
        }
        break;
    default:
        await impossible('Something is written in a very strange way.');
        sensed = 1;
        break;
    }
    if (!sensed) return;

    // C: maxelen = sizeof buf - sizeof "You feel the words: \"\"." — sizeof
    // counts the terminating NUL that strlen does not.
    const maxelen = BUFSZ - 'You feel the words: "".'.length - 1;
    let et = ep.actualText;
    let elen = et.length;
    if (elen > maxelen) { et = et.slice(0, maxelen); elen = maxelen; }
    // C ref: engrave.c:389 — the trailing '.' is skipped only when the last
    // character is punctuation AND is ORIGINAL; a '.' that wipeout_text()
    // degraded into place (rubouts maps ':' and ',' onto '.') still gets one.
    const pristine = ep.pristineText || '';
    const off = ep.engr_off || 0;
    const endpunct = (elen >= 2
                      && pristine[off + elen - 1] === et[elen - 1]
                      && '.!?'.includes(et[elen - 1])) ? '' : '.';
    await update_topl(`You ${Blind ? 'feel the words' : 'read'}: "${et}"${endpunct}`);
    // C ref: engrave.c:398 Strcpy(engr_txt[remembered_text], engr_txt[actual_text]).
    ep.rememberedText = ep.actualText;
    ep.eread = 1;
    ep.erevealed = 1;
    // C ref: engrave.c:401 `if (svc.context.run > 0) nomul(0);`
    if ((game.context?.run || 0) > 0) {
        const { nomul } = await import('./hack.js');
        nomul(0);
    }
}

export function make_engr_at(x, y, text, pristine, epoch, engr_type) {
    if (!game.level) return null;
    if (!game.level.engravings) game.level.engravings = [];
    game.level.engravings = game.level.engravings.filter(
        (ep) => ep.engr_x !== x || ep.engr_y !== y,
    );
    const ep = {
        engr_x: x,
        engr_y: y,
        engr_type,
        engr_time: epoch,
        nowipeout: false,
        actualText: text,
        rememberedText: text,
        pristineText: pristine ?? text,
        engr_off: 0,
    };
    // C ref: engrave.c make_engr_at() — engraving exactly "Elbereth" by the
    // player (not during level creation) exercises wisdom (rn2(19) inside
    // exercise()).  During mklev it instead sets the old-style guard flag.
    if (text === 'Elbereth' && !game.in_mklev) {
        exercise(A_WIS, true);
    }
    game.level.engravings.unshift(ep);
    return ep;
}

// C ref: hacklib.c mungspaces() — collapse runs of whitespace to one and trim.
function mungspaces(s) {
    return s.replace(/\s+/g, ' ').replace(/^ | $/g, '');
}

// C ref: engrave.c stylus_ok(obj) — getobj classifier for "write with".
// Fingers (obj==null) and weapons/wands/gems/rings are SUGGEST; markers and
// towels are SUGGEST tools; everything else is DOWNPLAY.
function stylus_ok(obj) {
    if (!obj) return GETOBJ_SUGGEST;
    if (obj.oclass === WEAPON_CLASS || obj.oclass === WAND_CLASS
        || obj.oclass === GEM_CLASS || obj.oclass === RING_CLASS)
        return GETOBJ_SUGGEST;
    if (obj.oclass === TOOL_CLASS
        && (obj.otyp === 234 /*TOWEL*/ || obj.otyp === 242 /*MAGIC_MARKER*/))
        return GETOBJ_SUGGEST;
    return GETOBJ_DOWNPLAY;
}

// C ref: objnam.c yname()/Yname2() — "your <cxname>"; cxname pluralises for a
// stack but (unlike doname) carries no count and no BUC word, so a stack of
// nine apples is "your apples", not "your 9 uncursed apples".
async function Yname2(obj) {
    const { cxname_singular, makeplural } = await import('./invent.js');
    const base = cxname_singular(obj);
    const s = ((obj?.quan ?? 1) > 1) ? makeplural(base) : base;
    return `Your ${s}`;
}
// C ref: objnam.c yname(obj) — shk_your() + cxname(); the lowercase sibling of
// Yname2() above.
async function yname_of(obj) {
    const { cxname_singular, makeplural } = await import('./invent.js');
    const base = cxname_singular(obj);
    const nm = ((obj?.quan ?? 1) > 1) ? makeplural(base) : base;
    return `your ${nm}`;
}
// C ref: objnam.c Yobjnam2(obj, verb) — Yname2 plus the verb agreeing with the
// object's quantity ("Your dagger is" / "Your daggers are").
async function Yobjnam2(obj, verb) {
    const plural = (obj?.quan ?? 1) > 1;
    let v = verb;
    if (verb === 'are') v = plural ? 'are' : 'is';
    else if (!plural) v = `${verb}s`;
    return `${await Yname2(obj)} ${v}`;
}

// C ref: obj.h is_blade() — WEAPON_CLASS with oc_skill in P_DAGGER..P_SABER
// (skills.h ids 1..9, so axes and pick-axes count as blades here).
const P_DAGGER = 1, P_SABER = 9;
function is_blade(obj) {
    const sk = objects[obj.otyp]?.oc_skill ?? 0;
    return obj.oclass === WEAPON_CLASS && sk >= P_DAGGER && sk <= P_SABER;
}
// C ref: obj.h is_boots() — oc_armcat == ARM_BOOTS; the JS objects table has no
// armcat, and the boots occupy otyp LOW_BOOTS..LEVITATION_BOOTS.
const LOW_BOOTS = 163, LEVITATION_BOOTS = 172;
function is_boots(obj) {
    return obj.oclass === ARMOR_CLASS
        && obj.otyp >= LOW_BOOTS && obj.otyp <= LEVITATION_BOOTS;
}

const MAGIC_MARKER = 242, TOWEL = 234;
const ART_FIRE_BRAND = 22; // artilist.h index; no covered stylus is an artifact
const WAND_BACKFIRE_CHANCE = 100; // C ref: zap.h

// C ref: engrave.c blind_writing[]/blengr() — ROLL_FROM() is an rn2(9) draw, so
// the table must be present even though the text itself is rarely seen.
const BLIND_WRITING = [
    [0x44, 0x66, 0x6d, 0x69, 0x62, 0x65, 0x22, 0x45, 0x7b, 0x71, 0x65, 0x6d, 0x72],
    [0x51, 0x67, 0x60, 0x7a, 0x7f, 0x21, 0x40, 0x71, 0x6b, 0x71, 0x6f, 0x67, 0x63],
    [0x49, 0x6d, 0x73, 0x69, 0x62, 0x65, 0x22, 0x4c, 0x61, 0x7c, 0x6d, 0x67, 0x24,
     0x42, 0x7f, 0x69, 0x6c, 0x77, 0x67, 0x7e],
    [0x4b, 0x6d, 0x6c, 0x66, 0x30, 0x4c, 0x6b, 0x68, 0x7c, 0x7f, 0x6f],
    [0x51, 0x67, 0x70, 0x7a, 0x7f, 0x6f, 0x67, 0x68, 0x64, 0x71, 0x21, 0x4f, 0x6b,
     0x6d, 0x7e, 0x72],
    [0x4c, 0x63, 0x76, 0x61, 0x71, 0x21, 0x48, 0x6b, 0x7b, 0x75, 0x67, 0x63, 0x24,
     0x45, 0x65, 0x6b, 0x6b, 0x65],
    [0x4c, 0x67, 0x68, 0x6b, 0x78, 0x68, 0x6d, 0x76, 0x7a, 0x75, 0x21, 0x4f, 0x71,
     0x7a, 0x75, 0x6f, 0x77],
    [0x44, 0x66, 0x6d, 0x7c, 0x78, 0x21, 0x50, 0x65, 0x66, 0x65, 0x6c],
    [0x44, 0x66, 0x73, 0x69, 0x62, 0x65, 0x22, 0x56, 0x7d, 0x63, 0x69, 0x76, 0x6b, 0x66],
];
function blengr() {
    return String.fromCharCode(...BLIND_WRITING[rn2(BLIND_WRITING.length)]);
}

// C ref: engrave.c doengrave_sfx_item_WAN() — the per-wand-type engraving
// effects.  Everything here is message/type bookkeeping except zapnodir(),
// which has real side effects (and RNG) for the six NODIR wands.
async function doengrave_sfx_item_WAN(de) {
    const { Blind, surface_of_hero } = await engraveEnv();
    const zap = await import('./zap.js');
    switch (de.otmp.otyp) {
    default: /* DUST wands */
        break;
    /* NODIR wands */
    case 410: /*WAN_LIGHT*/ case 411: /*WAN_SECRET_DOOR_DETECTION*/
    case 415: /*WAN_STASIS*/ case 413: /*WAN_CREATE_MONSTER*/
    case 414: /*WAN_WISHING*/ case 412: /*WAN_ENLIGHTENMENT*/
        await zap.zapnodir(de.otmp);
        break;
    /* IMMEDIATE wands */
    case 417: /*WAN_STRIKING*/
        de.post_engr_text = 'The wand unsuccessfully fights your attempt to write!';
        break;
    case 419: /*WAN_SLOW_MONSTER*/
        if (!Blind) de.post_engr_text = `The bugs on the ${surface_of_hero()} slow down!`;
        break;
    case 420: /*WAN_SPEED_MONSTER*/
        if (!Blind) de.post_engr_text = `The bugs on the ${surface_of_hero()} speed up!`;
        break;
    case 422: /*WAN_POLYMORPH*/
        if (de.oep) {
            if (!Blind) {
                de.type = 0; /* random */
                const re = random_engraving();
                de.buf = re?.text || '';
                de.ebuf = re?.pristine || '';
            } else {
                if (de.oetype) de.type = de.oetype;
                de.buf = xcrypt(blengr());
            }
            de.dengr = true;
        }
        break;
    case 416: /*WAN_NOTHING*/ case 421: /*WAN_UNDEAD_TURNING*/
    case 425: /*WAN_OPENING*/ case 426: /*WAN_LOCKING*/ case 427: /*WAN_PROBING*/
        break;
    /* RAY wands */
    case 429: /*WAN_MAGIC_MISSILE*/
        de.ptext = true;
        if (!Blind) de.post_engr_text = `The ${surface_of_hero()} is riddled by bullet holes!`;
        break;
    case 432: /*WAN_SLEEP*/ case 433: /*WAN_DEATH*/
        if (!Blind) de.post_engr_text = `The bugs on the ${surface_of_hero()} stop moving!`;
        break;
    case 431: /*WAN_COLD*/
        if (!Blind) de.post_engr_text = 'A few ice cubes drop from the wand.';
        if (!de.oep || de.oep.engr_type !== BURN) break;
        /* FALLTHROUGH */
    case 423: /*WAN_CANCELLATION*/ case 418: /*WAN_MAKE_INVISIBLE*/
        if (de.oep && de.oep.engr_type !== HEADSTONE) {
            if (!Blind) await engravePline(`The engraving on the ${surface_of_hero()} vanishes!`);
            de.dengr = true;
        }
        break;
    case 424: /*WAN_TELEPORTATION*/
        if (de.oep && de.oep.engr_type !== HEADSTONE) {
            if (!Blind) await engravePline(`The engraving on the ${surface_of_hero()} vanishes!`);
            de.teleengr = true;
        }
        break;
    case 428: /*WAN_DIGGING*/
        de.ptext = true;
        de.type = ENGRAVE;
        if (!objects[de.otmp.otyp]?.oc_name_known) {
            await engravePline(`This ${await xname_of(de.otmp)} is a wand of digging!`);
            de.doknown = true;
        }
        de.post_engr_text = (Blind && !isDeaf()) ? 'You hear drilling!'
            : Blind ? 'You feel tremors.'
            : IS_GRAVE(game.level?.at(game.u.ux, game.u.uy)?.typ)
                ? 'Chips fly out from the headstone.'
            : de.frosted ? 'Ice chips fly up from the ice surface!'
            : (game.level?.at(game.u.ux, game.u.uy)?.typ === DRAWBRIDGE_DOWN)
                ? 'Splinters fly up from the bridge.'
            : 'Gravel flies up from the floor.';
        break;
    case 430: /*WAN_FIRE*/
        de.ptext = true;
        de.type = BURN;
        if (!objects[de.otmp.otyp]?.oc_name_known) {
            await engravePline(`This ${await xname_of(de.otmp)} is a wand of fire!`);
            de.doknown = true;
        }
        de.post_engr_text = Blind ? 'You feel the wand heat up.' : 'Flames fly from the wand.';
        break;
    case 434: /*WAN_LIGHTNING*/
        de.ptext = true;
        de.type = BURN;
        if (!objects[de.otmp.otyp]?.oc_name_known) {
            await engravePline(`This ${await xname_of(de.otmp)} is a wand of lightning!`);
            de.doknown = true;
        }
        if (!Blind) {
            de.post_engr_text = 'Lightning arcs from the wand.';
            de.doblind = true;
        } else {
            de.post_engr_text = !isDeaf() ? 'You hear crackling!'
                                          : 'Your hair stands up!';
        }
        break;
    }
}

// C ref: engrave.c doengrave_sfx_item() — per-object-class engraving effects.
// Returns false when doengrave() must bail out immediately (de.ret is set).
async function doengrave_sfx_item(de) {
    const { Blind, surface_of_hero } = await engraveEnv();
    if (!de.otmp) return true; // &hands_obj -> RANDOM_CLASS, no effect
    switch (de.otmp.oclass) {
    default:
    case AMULET_CLASS:
    case CHAIN_CLASS:
    case POTION_CLASS:
    case COIN_CLASS:
        break;
    case RING_CLASS:
    case GEM_CLASS:
        // "diamond" rings and other hard gems should work.
        if (objects[de.otmp.otyp]?.oc_tough) de.type = ENGRAVE;
        break;
    case ARMOR_CLASS:
        if (is_boots(de.otmp)) { de.type = DUST; break; }
        /* FALLTHROUGH */
    case BALL_CLASS:
    case ROCK_CLASS:
        await engravePline("You can't engrave with such a large object!");
        de.ptext = false;
        break;
    case FOOD_CLASS:
    case SCROLL_CLASS:
    case SPBOOK_CLASS:
        await engravePline(`${await Yname2(de.otmp)} would get ${de.frosted ? 'all frosty' : 'too dirty'}.`);
        de.ptext = false;
        break;
    case RANDOM_CLASS: /* fingers */
        break;
    case WAND_CLASS: {
        const zap = await import('./zap.js');
        if (zap.zappable(de.otmp)) {
            if (de.otmp.cursed && !rn2(WAND_BACKFIRE_CHANCE)) {
                await zap.wand_explode(de.otmp, 0);
                de.ret = 1; // ECMD_TIME
                return false;
            }
            de.zapwand = true;
            await doengrave_sfx_item_WAN(de);
        } else {
            // Failing to wrest one last charge takes time.
            de.ptext = false;
            if (de.otmp.spe < 0) de.zapwand = true;
            else await engravePline('The wand is too worn out to engrave.');
        }
        break;
    }
    case WEAPON_CLASS:
        if (de.otmp.oartifact === ART_FIRE_BRAND) {
            de.type = BURN; /* doesn't dull weapon */
        } else if (is_blade(de.otmp)) {
            if (de.otmp === game.uwep && de.otmp.cursed)
                await engravePline(`${await Yname2(de.otmp)} can only scratch the ${surface_of_hero()}.`);
            else if ((de.otmp.spe | 0) <= -3)
                await engravePline(`${await Yobjnam2(de.otmp, 'are')} too dull for engraving.`);
            else de.type = ENGRAVE;
        }
        break;
    case TOOL_CLASS:
        if (de.otmp === game.ublindf) {
            await engravePline('That is a bit difficult to engrave with, don\'t you think?');
            de.ret = 0; // ECMD_FAIL
            return false;
        }
        switch (de.otmp.otyp) {
        case MAGIC_MARKER:
            if ((de.otmp.spe | 0) <= 0) await engravePline('Your marker has dried out.');
            else de.type = MARK;
            break;
        case TOWEL:
            de.ptext = false;
            if (de.oep) {
                if (de.oep.engr_type === DUST || de.oep.engr_type === ENGR_BLOOD
                    || de.oep.engr_type === MARK) {
                    if (!Blind) await engravePline('You wipe out the message here.');
                    else await engravePline(`${await Yobjnam2(de.otmp, 'get')} ${de.frosted ? 'frosty' : 'dusty'}.`);
                    de.dengr = true;
                } else {
                    await engravePline(`${await Yname2(de.otmp)} can't wipe out this engraving.`);
                }
            } else {
                await engravePline(`${await Yobjnam2(de.otmp, 'get')} ${de.frosted ? 'frosty' : 'dusty'}.`);
            }
            break;
        default:
            break;
        }
        break;
    case VENOM_CLASS:
        await engravePline('Writing a poison pen letter?');
        break;
    case ILLOBJ_CLASS:
        break;
    }
    return true;
}

// C ref: pline.c vpline() -> update_topl(); see doengrave()'s import note for
// why this is not js/display.js pline().
async function engravePline(msg) {
    const { update_topl } = await import('./display.js');
    await update_topl(msg);
}
async function xname_of(obj) {
    const { xname } = await import('./invent.js');
    return xname(obj);
}
// The two bits of hero state doengrave_sfx_item() reads, gathered once so the
// switch reads like the C.
async function engraveEnv() {
    const { surface } = await import('./dungeon.js');
    return {
        Blind: isBlind(),
        surface_of_hero: () => surface(game.u.ux, game.u.uy),
    };
}

// C ref: mondata.h is_animal(ptr) — M1_ANIMAL, from the generated flag table.
function is_animal(ptr) { return !!ptr && (mflags1_of(ptr) & M1_ANIMAL) !== 0; }
// C ref: mondata.h is_whirly(ptr) — S_VORTEX ('v') or mons[PM_AIR_ELEMENTAL].
let _pm_air_elemental = -1;
async function is_whirly(ptr) {
    if (!ptr) return false;
    if (ptr.mlet === 'v') return true;
    if (_pm_air_elemental < 0) {
        const { name_to_pmidx } = await import('./makemon.js');
        _pm_air_elemental = name_to_pmidx('air elemental');
    }
    return ptr.pmidx === _pm_air_elemental;
}

// C ref: engrave.c freehand() — does the hero have a hand free to write with?
async function freehand() {
    const { welded, bimanual } = await import('./invent.js');
    const uwep = game.uwep;
    return (!uwep || !welded(uwep)
            || (!bimanual(uwep) && (!game.uarms || !game.uarms.cursed)));
}

// C ref: engrave.c u_can_engrave() — can the hero engrave at their location?
// The terrain clauses are ported verbatim; the uswallow branch (which needs
// is_animal()/is_whirly() on the engulfer) and the cantwield()/check_capacity()
// clauses are treated as "can engrave", as they were before.
async function u_can_engrave() {
    const { pline } = await import('./display.js');
    const { is_pool, is_lava } = await import('./dbridge.js');
    const { surface } = await import('./dungeon.js');
    const u = game.u;
    // SURFACE_AT(x, y): a raised drawbridge reports what lies under it.
    const levtyp = game.level?.at(u.ux, u.uy)?.typ ?? STONE;

    if (u.uswallow) {
        const ptr = u.ustuck?.data;
        if (is_animal(ptr)) {
            await pline('What would you write?  "Jonah was here"?');
            return false;
        } else if (await is_whirly(ptr)) {
            await cant_reach_floor(u.ux, u.uy, false, false, false);
            return false;
        }
        /* amorphous engulfers fall through to doengrave()'s 'jello' result */
    } else if (is_lava(u.ux, u.uy)) {
        await pline(`You can't write on the ${surface(u.ux, u.uy)}!`);
        return false;
    } else if (is_pool(u.ux, u.uy) || IS_FOUNTAIN(levtyp)) {
        await pline(`You can't write on the ${surface(u.ux, u.uy)}!`);
        return false;
    } else if (IS_AIR(levtyp)) {
        /* airlevel or inside bubble on waterlevel */
        await pline(`You can't write in ${levtyp === CLOUD ? 'cloud vapor' : 'thin air'}!`);
        return false;
    } else if (!ACCESSIBLE(levtyp)) {
        /* stone, tree, wall, secret corridor, pool, lava, bars */
        await pline("You can't write here.");
        return false;
    }
    return true;
}

// C ref: engrave.c doengrave() — the 'E' (#engrave) command.  Prompt for a
// writing implement, classify it, print the "You write in the dust ..." line,
// read the engraving text with getlin(), garble it when the surface/state of
// mind is unsound (rn2(25) per char for DUST/blood; Blind/Confused/Stunned/
// Hallucinating add their own rolls), record the engraving, and run the
// engraving as a one-action occupation (returns ECMD_TIME so a turn passes).
//
// Only the DUST/finger (and structurally weapon/wand/marker) paths the
// recorded sessions take are reproduced; the altar/grave/swallow/teleengr
// special effects are stubs that fall through to the ordinary write path.
export async function doengrave() {
    const u = game.u;

    if (!await u_can_engrave()) return 0; // ECMD_FAIL

    // Lazy imports (see note at top of file) to avoid the display.js<->engrave.js
    // static-import cycle.
    // C ref: pline.c vpline():266 — every C pline()/You() reaches update_topl(),
    // which chains an already-pending line ("This pine wand is a wand of
    // digging!") into the next message's --More-- boundary.  js/display.js
    // pline() only assigns _pending_message, so it silently DROPS the first of
    // doengrave()'s two messages and loses that boundary.
    const { update_topl: pline } = await import('./display.js');
    const { getobj, hands_obj, body_part }
        = await import('./invent.js');
    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    const { surface } = await import('./dungeon.js');

    // doengrave_ctx_init(): defaults.
    const de = {
        type: DUST,
        oetype: 0,
        ptext: true,
        dengr: false,
        teleengr: false,
        zapwand: false,
        eow: false,
        adding: false,
        doblind: false,
        doknown: false,
        disprefresh: false,
        post_engr_text: '',
        jello: false,     // swallowed by an amorphous engulfer
        buf: '',          // engraving text from special effects (e.g. cancel)
        ebuf: '',         // text the player types
        writer: '',
        everb: '',
        eloc: '',
        ret: 0,           // ECMD_OK
    };
    const oep = engr_at(u.ux, u.uy);
    if (oep) de.oetype = oep.engr_type;
    // (ENGR_BLOOD-when-bleeding and jello/frost branches not exercised.)
    const frosted = (game.level?.at(u.ux, u.uy)?.typ === ICE);

    // getobj("write with", stylus_ok, GETOBJ_PROMPT): otmp == hands_obj for '-'.
    const otmp = await getobj('write with', stylus_ok, GETOBJ_PROMPT);
    if (!otmp) return 0; // ECMD_CANCEL ("Never mind." already shown)

    if (otmp === hands_obj) {
        de.writer = `your ${body_part(FINGERTIP)}`;
    } else {
        de.writer = await yname_of(otmp);
    }

    de.otmp = (otmp === hands_obj) ? null : otmp;
    de.frosted = frosted;
    de.oep = oep;
    // C ref: engrave.c doengrave_ctx_init() — an amorphous engulfer (u_can_engrave
    // already refused the animal and whirly ones) gets tickled instead.
    de.jello = !!(u.uswallow && !(is_animal(u.ustuck?.data)
                                  || await is_whirly(u.ustuck?.data)));

    // C ref: engrave.c doengrave():995 — "There's no reason you should be able
    // to write with a wand while both your hands are tied up."
    if (!await freehand() && otmp !== game.uwep && !otmp.owornmask) {
        const { HAND } = await import('./const.js');
        await pline(`You have no free ${body_part(HAND)} to write with!`);
        await maybe_newsym(de);
        return de.ret;
    }
    if (de.jello) {
        const { mon_nam } = await import('./do_name.js');
        await pline(`You tickle ${mon_nam(u.ustuck)} with ${de.writer}.`);
        await pline('Your message dissolves...');
        await maybe_newsym(de);
        return de.ret;
    }
    let initial_msg_given = false;
    if (!can_reach_floor(true)) {
        if (otmp.oclass !== WAND_CLASS) {
            await cant_reach_floor(u.ux, u.uy, false, true, false);
            await maybe_newsym(de);
            return de.ret;
        }
        await pline(`You gesture, with your wand, towards the ${surface(u.ux, u.uy)} below you.`);
        initial_msg_given = true;
    }
    const here = game.level?.at(u.ux, u.uy);
    if (IS_ALTAR(here?.typ)) {
        if (!initial_msg_given)
            await pline(`You make a motion towards the altar with ${de.writer}.`);
        const { altar_wrath } = await import('./dokick.js');
        await altar_wrath(u.ux, u.uy);
        await maybe_newsym(de);
        return de.ret;
    }
    if (IS_GRAVE(here?.typ)) {
        if (otmp === hands_obj) { /* using only finger */
            await pline(`You would only make a small smudge on the ${surface(u.ux, u.uy)}.`);
            await maybe_newsym(de);
            return de.ret;
        } else if (!here.disturbed) {
            // disturb the grave: summon a ghoul, same as sometimes happens when
            // kicking; sets disturbed so it'll only happen once.
            const { disturb_grave } = await import('./dokick.js');
            await disturb_grave(u.ux, u.uy);
            await maybe_newsym(de);
            return de.ret;
        }
    }

    // SPFX for items.  Skipping this made every non-finger stylus behave like a
    // finger: food/scrolls/books wrote in the dust instead of being refused,
    // which desynchronised the whole keystroke stream from there on.
    if (!await doengrave_sfx_item(de)) { await maybe_newsym(de); return de.ret; }

    // C ref: engrave.c doengrave():1032 — IS_GRAVE re-types the engraving after
    // the item effects: a carving stylus cuts an epitaph, anything else is
    // forced to DUST so the "cannot wipe out" case below fires.
    if (IS_GRAVE(game.level?.at(u.ux, u.uy)?.typ)) {
        if (de.type === ENGRAVE || de.type === 0) {
            de.type = HEADSTONE;
        } else {
            de.type = DUST;
            de.dengr = false;
            de.teleengr = false;
            de.buf = '';
        }
    }

    /* Identify stylus */
    if (de.doknown) {
        const { learnwand } = await import('./zap.js');
        learnwand(de.otmp);
        if (objects[de.otmp.otyp]?.oc_name_known) {
            const { more_experienced } = await import('./exper.js');
            more_experienced(0, 10);
        }
    }
    if (de.teleengr) {
        await rloc_engr(de.oep);
        de.oep.eread = 0;
        de.oep.erevealed = 0;
        de.disprefresh = true;
        de.oep = null;
    }
    if (de.dengr) {
        del_engr(de.oep);
        de.oep = null;
        de.disprefresh = true;
    }
    /* Something has changed the engraving here */
    if (de.buf) {
        make_engr_at(u.ux, u.uy, de.buf, de.ebuf, game.moves ?? 1, de.type);
        const tmp_ep = engr_at(u.ux, u.uy);
        if (!isBlind() && tmp_ep) {
            await pline(`The engraving now reads: "${de.buf}".`);
            tmp_ep.eread = 1;
            tmp_ep.erevealed = 1;
            de.disprefresh = true;
        }
        de.ptext = false;
    }
    if (de.zapwand && (de.otmp.spe | 0) < 0) {
        const { useup } = await import('./invent.js');
        await pline(`${await The_of(de.otmp)} ${isBlind() ? '' : 'glows violently, then '}turns to dust.`);
        if (!IS_GRAVE(game.level?.at(u.ux, u.uy)?.typ))
            await pline(`You are not going to get anywhere trying to write in the ${de.frosted ? 'frost' : 'dust'} with your dust.`);
        useup(de.otmp);
        de.otmp = null; /* wand is now gone */
        de.ptext = false;
    }
    /* Early exit for some implements. */
    if (!de.ptext) {
        if (de.otmp && de.otmp.oclass === WAND_CLASS && !can_reach_floor(true))
            await cant_reach_floor(u.ux, u.uy, false, true, true);
        de.ret = 1; // ECMD_TIME
        await maybe_newsym(de);
        return de.ret;
    }

    // C ref: engrave.c doengrave():1105 — special effects should have deleted
    // the current engraving (if possible) by now; whatever survives is either
    // appended to or wiped out.
    if (de.oep) {
        const { yn_function } = await import('./extcmd-handlers.js');
        const blind = isBlind();
        let c = 'n';

        if (de.type === HEADSTONE) {
            c = 'y'; /* no choice, only append */
        } else if (de.type === de.oep.engr_type
                   && (!blind || de.oep.engr_type === BURN
                       || de.oep.engr_type === ENGRAVE)) {
            c = await yn_function('Do you want to add to the current engraving?',
                                  'ynq', 'y');
            if (c === 'q') { await pline('Never mind.'); await maybe_newsym(de); return de.ret; }
        }

        if (c === 'n' || blind) {
            if (de.oep.engr_type === DUST || de.oep.engr_type === ENGR_BLOOD
                || de.oep.engr_type === MARK) {
                if (!blind) {
                    const was = (de.oep.engr_type === DUST)
                        ? (frosted ? 'written in the frost' : 'written in the dust')
                        : (de.oep.engr_type === ENGR_BLOOD) ? 'scrawled in blood'
                        : 'written';
                    await pline(`You wipe out the message that was ${was} here.`);
                    del_engr(de.oep);
                    de.oep = null;
                    de.disprefresh = true;
                } else {
                    /* defer deletion until after we *know* we're engraving */
                    de.eow = true;
                }
            } else if (de.type === DUST || de.type === MARK
                       || de.type === ENGR_BLOOD) {
                const into = (de.oep.engr_type === BURN)
                    ? (frosted ? 'melted into' : 'burned into') : 'engraved in';
                await pline(`You cannot wipe out the message that is ${into} the ${surface(u.ux, u.uy)} here.`);
                de.ret = 1; // ECMD_TIME
                await maybe_newsym(de);
                return de.ret;
            } else if (de.type !== de.oep.engr_type || c === 'n') {
                if (!blind || can_reach_floor(true))
                    await pline('You will overwrite the current message.');
                de.eow = true;
            }
        } else if (de.oep && (de.oep.actualText || '').length >= BUFSZ - 1) {
            await pline('There is no room to add anything else here.');
            de.ret = 1; // ECMD_TIME
            await maybe_newsym(de);
            return de.ret;
        }
    }

    // C ref: engrave.c doengrave():1170 `de->eloc = surface(u.ux, u.uy);` —
    // the default location noun, which doengrave_ctx_verb() only overrides for
    // DUST ("dust"/"frost").  It was never assigned, so every non-dust stylus
    // said "You engrave in the  with ..." and prompted "...in the  here?".
    de.eloc = surface(u.ux, u.uy);
    de.adding = !!(de.oep && !de.eow);
    doengrave_ctx_verb(de, frosted);

    // "Tell adventurer what is going on."
    if (otmp !== hands_obj) {
        // C ref: engrave.c doengrave():1176 — "since doname() yields 'N items'
        // when quantity is more than one, match that by using '1 of' rather than
        // 'one of'" for the blade engrave() will split off the stack.
        const pfx = (de.type === ENGRAVE && (otmp.quan || 1) > 1) ? '1 of ' : '';
        // C names the stylus with doname() here, not with de->writer's yname().
        const { obj_doname } = await import('./invent.js');
        await pline(`You ${de.everb} the ${de.eloc} with ${pfx}${obj_doname(otmp)}.`);
    } else {
        await pline(`You ${de.everb} the ${de.eloc} with your ${body_part(FINGERTIP)}.`);
    }
    // C ref: win/tty/getline.c hooked_tty_getlin():53 pages the pending line
    // itself; an explicit topl_more() here doubled the --More-- boundary once
    // this function started leaving toplin == NEED_MORE.

    // "Prompt for engraving!"  getlin(qbuf, ebuf); mungspaces(ebuf).
    const qbuf = `What do you want to ${de.everb} the ${de.eloc} here?`;
    let ebuf = await hooked_tty_getlin(qbuf, null);
    if (ebuf === '\x1b') ebuf = '';
    ebuf = mungspaces(ebuf);

    // Count engraved chars (excluding spaces).
    let len = ebuf.length;
    for (const c of ebuf) if (c === ' ') len -= 1;

    if (len === 0 || ebuf.includes('\x1b')) {
        if (de.zapwand) {
            if (!isBlind())
                await pline(`${await Tobjnam_of(de.otmp, 'glow')}, then ${await otense_of(de.otmp, 'fade')}.`);
            de.ret = 1; // ECMD_TIME
            await maybe_newsym(de);
            return de.ret;
        }
        await pline('Never mind.');
        await maybe_newsym(de);
        return 0;
    }

    // C ref: engrave.c doengrave():1212 — "A single `x' is the traditional
    // signature of an illiterate person", so a lone x/X does not break the
    // illiterate conduct.  The chronicle entry logs the text BEFORE the garble
    // loop below rewrites it.
    if (len !== 1 || (!ebuf.includes('x') && !ebuf.includes('X'))) {
        game.u.uconduct = game.u.uconduct || {};
        if (!(game.u.uconduct.literate || 0))
            livelog_printf(LL_CONDUCT, `became literate by engraving "${ebuf}"`);
        game.u.uconduct.literate = (game.u.uconduct.literate || 0) + 1;
    }

    // getlin drew its prompt over the top line; the engrave occupation prints
    // no message on its first (and, for short words, only) action, so the
    // captured frame after Enter has a blank message line.  Clear the stale
    // "You write in the dust ..." pline that --More-- already acknowledged.
    game._pending_message = '';
    game._toplin = 0;

    // Mix up engraving if surface or state of mind is unsound.  This does not
    // add or remove spaces.  C ref: engrave.c:1219-1227.
    // Conditions tracked: DUST/ENGR_BLOOD -> rn2(25); Blind -> rn2(11);
    // Confusion -> rn2(7); Stunned -> rn2(4); Hallucination -> rn2(2).
    const blind = isBlind();
    const confused = isConfused();
    const stunned = isStunned();
    const hallu = isHallu();
    const chars = Array.from(ebuf);
    for (let i = 0; i < chars.length; i++) {
        if (chars[i] === ' ') continue;
        const garble =
            (((de.type === DUST || de.type === ENGR_BLOOD) && !rn2(25))
             || (blind && !rn2(11)) || (confused && !rn2(7))
             || (stunned && !rn2(4)) || (hallu && !rn2(2)));
        if (garble) {
            // ' ' + rnd(96 - 2): ASCII '!' (33) thru '~' (126).
            chars[i] = String.fromCharCode(32 + rnd(94));
        }
    }
    ebuf = chars.join('');

    // Previous engraving is overwritten.
    if (de.eow) { del_engr(de.oep); de.oep = null; de.disprefresh = true; }

    // C ref: engrave.c doengrave():1237 — stash the text/stylus/type/pos in
    // svc.context.engraving and set_occupation(engrave, "engraving", 0), then
    // return ECMD_OK: "Engraving will always take at least one action via being
    // run as an occupation, so do not count this setup as taking time."  A DUST
    // engraving of <= rate(10) characters still finishes in that single action
    // with no message (what the previous inline model produced); the occupation
    // is what makes the slow ENGRAVE case (rate 1 per action, blade dulling)
    // take one turn per character.
    game.context = game.context || {};
    game.context.engraving = {
        text: ebuf, nextc: 0, stylus: otmp, type: de.type,
        pos: { x: u.ux, y: u.uy }, actionct: 0,
    };
    game._engrave_occupation = true;

    if (de.post_engr_text) await pline(de.post_engr_text);
    if (de.doblind && !resists_blnd()) {
        const { make_blinded_hero } = await import('./potion.js');
        await pline('You are blinded by the flash!');
        await make_blinded_hero(rnd(50), false);
        if (!isBlind()) await pline('Your vision clears.');
    }
    await maybe_newsym(de);
    return 0;
}

// C ref: engrave.c engrave():1267 — the "engraving" occupation callback.  One
// action per turn; returns true while text remains.
export async function engrave_step() {
    const g = game;
    const u = g.u;
    const ctx = g.context?.engraving;
    const { pline, newsym, update_topl } = await import('./display.js');
    const { prinv_fmt, xname, hands_obj } = await import('./invent.js');
    if (!ctx || !u) { g.context.engraving = null; return false; }
    if (ctx.pos.x !== u.ux || ctx.pos.y !== u.uy) { /* teleported? */
        await update_topl('You are unable to continue engraving.');
        g.context.engraving = null;
        return false;
    }
    // C: `if (context.engraving.stylus == &hands_obj) stylus = 0;` else the
    // object must still be in invent (it may have been destroyed).
    let stylus = (ctx.stylus === hands_obj || ctx.stylus?._hands) ? null : ctx.stylus;
    if (stylus && Array.isArray(g.invent) && !g.invent.includes(stylus)) {
        await update_topl('You are unable to continue engraving.');
        g.context.engraving = null;
        return false;
    }
    const firsttime = ctx.actionct === 0;
    const neweng = ctx.actionct === 0;
    const carving = (ctx.type === ENGRAVE || ctx.type === HEADSTONE);
    // C: `(stylus->otyp != ATHAME || stylus->cursed)` — an uncursed athame
    // (objects.h ATHAME == otyp 38) never dulls.
    const dulling_wep = !!(carving && stylus && stylus.oclass === WEAPON_CLASS
                           && (stylus.otyp !== 38 || stylus.cursed));
    const marker = !!(stylus && stylus.otyp === MAGIC_MARKER && ctx.type === MARK);
    ctx.actionct++;

    /* Step 1: rate. */
    let rate = 10;
    if (carving && stylus
        && (dulling_wep || stylus.oclass === RING_CLASS || stylus.oclass === GEM_CLASS))
        rate = 1;
    else if (marker)
        rate = Math.min(rate, (stylus.spe | 0) * 2);

    /* Step 2: last character engraved this action (spaces are free). */
    let i = rate, endc = ctx.nextc;
    for (; endc < ctx.text.length && i > 0; endc++)
        if (ctx.text[endc] !== ' ') i--;

    /* Step 3: the stylus wears out. */
    let truncate = false;
    if (dulling_wep) {
        let dulled = false;
        // The quan>1 splitobj() branch is not reached by any recorded session
        // (a stack of blades), but its message belongs to the first action.
        if (firsttime)
            await update_topl((stylus.quan || 1) > 1
                        ? `One of your ${xname(stylus)} gets dull.`
                        : `Your ${xname(stylus)} gets dull.`);
        // -1 enchantment per 2 characters, rounding down: deduct on the 1st,
        // 3rd, ... action unless this is the last character (but always on the
        // 1st, to prevent zero-cost engravings).  Truncation is checked BEFORE
        // the deduction.
        if (ctx.actionct % 2 === 1) {
            if ((stylus.spe | 0) <= -3) {
                truncate = true;
            } else if (endc < ctx.text.length || ctx.actionct === 1) {
                stylus.spe = (stylus.spe | 0) - 1;
                dulled = true;
            }
        }
        if (dulled && stylus.known) {
            // prinv() -> pline(): the refreshed "b - a -1 dagger" line pages the
            // "gets dull" line above it with --More--.
            await update_topl(prinv_fmt(null, stylus, 1));
        }
    } else if (marker) {
        const ink_cost = Math.max(Math.floor(rate / 2), 1);
        stylus.spe = (stylus.spe | 0) - ink_cost;
        if ((stylus.spe | 0) === 0) {
            await update_topl('Your marker dries out.');
            truncate = true;
        }
    }

    // C: `if (endc - nextc > space_left) { You("run out of room to write."); }`
    // BUFSZ leaves 255 characters, which getlin can never exceed here.
    if (truncate && endc < ctx.text.length) {
        ctx.text = ctx.text.slice(0, endc);
        await update_topl(`You are only able to write "${ctx.text}".`);
    } else {
        truncate = false;
    }

    const oep = engr_at(u.ux, u.uy);
    const buf = (oep ? (oep.actualText || '') : '') + ctx.text.slice(ctx.nextc, endc);
    make_engr_at(u.ux, u.uy, buf, null, (g.moves ?? 1) - (g.multi ?? 0), ctx.type);
    const ep = engr_at(u.ux, u.uy);
    if (ep) { ep.eread = 1; ep.erevealed = 1; }

    if (endc < ctx.text.length) {
        ctx.nextc = endc;
        if (neweng) newsym(ctx.pos.x, ctx.pos.y);
        return true; /* not yet finished */
    }
    if (truncate) await update_topl('You cannot write any more.');
    else if (!firsttime) await update_topl(`You finish ${engrave_finishverb(ctx.type)}.`);
    g.context.engraving = null;
    if (neweng) newsym(ctx.pos.x, ctx.pos.y);
    return false;
}

// C ref: engrave.c engrave():1411 finishverb switch.
function engrave_finishverb(type) {
    const icy = (game.level?.at(game.u?.ux, game.u?.uy)?.typ === ICE);
    switch (type) {
    case DUST: return icy ? 'writing in the frost' : 'writing in the dust';
    case HEADSTONE:
    case ENGRAVE: return 'engraving';
    case BURN: return icy ? 'melting your message into the ice'
                          : 'burning your message into the floor';
    case MARK: return 'defacing the dungeon';
    case ENGR_BLOOD: return 'scrawling';
    default: return 'your weird engraving';
    }
}

// C ref: engrave.c doengrave_ctx_verb() — pick the verb/location phrasing.
function doengrave_ctx_verb(de, frosted) {
    switch (de.type) {
    case DUST:
        de.everb = de.adding ? 'add to the writing in' : 'write in';
        de.eloc = frosted ? 'frost' : 'dust';
        break;
    case HEADSTONE:
        de.everb = de.adding ? 'add to the epitaph on' : 'engrave on';
        break;
    case ENGRAVE:
        de.everb = de.adding ? 'add to the engraving in' : 'engrave in';
        break;
    case BURN:
        de.everb = de.adding
            ? (frosted ? 'add to the text melted into' : 'add to the text burned into')
            : (frosted ? 'melt into' : 'burn into');
        break;
    case MARK:
        de.everb = de.adding ? 'add to the graffiti on' : 'scribble on';
        break;
    case ENGR_BLOOD:
        de.everb = de.adding ? 'add to the scrawl on' : 'scrawl on';
        break;
    default:
        de.everb = de.adding ? 'add to the weird writing on' : 'write strangely on';
        break;
    }
}

async function maybe_newsym(de) {
    if (!de.disprefresh || !game.u) return;
    const { newsym } = await import('./display.js');
    newsym(game.u.ux, game.u.uy);
}

// C ref: trap.c ceiling(x, y).  Same reduction as js/dig.js ceiling(): no
// air/water/quest/earth level reaches this file.
function ceiling(x, y) {
    const typ = game.level?.at(x, y)?.typ ?? STONE;
    if (typ === ROOM || IS_WALL(typ) || IS_DOOR(typ) || typ === SDOOR)
        return 'ceiling';
    return 'rock cavern';
}

// C ref: mondata.c resists_blnd(&youmonst) — for the hero this is
// (Blind || Unaware) plus a polyform AD_BLND explosion/gaze attack and a
// Sunsword-style artifact; those two need mondata/artifact state this file
// cannot reach, so only the (Blind || Unaware) clause is modelled.
function resists_blnd() {
    const u = game.u;
    return !!(isBlind() || u?.uprops?.Unaware || u?.usleep);
}

// C ref: objnam.c The(str) — "the " prefixed and capitalised; a name that
// already starts capitalised (proper noun) is left alone.
function the_prefix(s) { return /^[A-Z]/.test(s) ? s : `The ${s}`; }
async function The_of(obj) { return the_prefix(await xname_of(obj)); }
// C ref: objnam.c Tobjnam(obj, verb) — The(xname(obj)) + otense(obj, verb).
async function Tobjnam_of(obj, verb) {
    return `${await The_of(obj)} ${await otense_of(obj, verb)}`;
}
async function otense_of(obj, verb) {
    const { otense } = await import('./invent.js');
    return otense(obj, verb);
}

// Status helpers.  Each reads the spelling the setter actually writes:
// C ref: youprop.h Blind — the HBlinded timer plus worn eyewear.  potion.c
// make_blinded() lands on game.u.blinded (js/potion.js set_blinded), NOT on
// uprops.Blinded, so the old reading answered FALSE for a genuinely blind hero
// and doengrave() printed "Your vision clears." right after blinding itself.
// Same predicate as js/vision.js Blind().
function isBlind() {
    const u = game.u;
    return !!u && ((u.blinded || 0) > 0 || !!game.ublindf);
}
function isConfused() { const u = game.u; return !!(u?.uprops?.Confusion || u?.uconf); }
function isStunned() { const u = game.u; return !!(u?.uprops?.Stun || u?.ustun); }
function isHallu() { const u = game.u; return !!(u?.uprops?.Hallucination || u?.uhallu); }
// C ref: youprop.h Deaf (HDeaf || EDeaf).
function isDeaf() { const u = game.u; return !!(u?.uprops?.Deaf || u?.Deaf); }

// ===========================================================================
// engrave.c functions with no caller in js/ yet.  Nothing above this line
// calls into this block: it is additive only.
//
// C walks the level's engravings as the `head_engr` linked list, newest first
// (make_engr_at pushes onto the head).  In this port that list is the
// game.level.engravings array, which make_engr_at() unshift()s onto, so a plain
// forward iteration over it is C's `for (ep = head_engr; ep; ep = ep->nxt_engr)`
// in the same order.  The three C text slots engr_txt[actual_text] /
// [remembered_text] / [pristine_text] are this port's ep.actualText /
// ep.rememberedText / ep.pristineText.
// ===========================================================================

// C ref: engrave.h:19 head_engr.
function head_engr() {
    return game.level?.engravings ?? [];
}

// C ref: hacklib.c strstri(str, sub) — case-insensitive substring search; only
// the truthiness of the returned pointer is used at the one call site below.
function strstri_engr(str, sub) {
    return str.toLowerCase().includes(sub.toLowerCase());
}

// C ref: engrave.c:251 sengr_at(s, x, y, strict).  "Decide whether a particular
// string is engraved at a specified location; a case-insensitive substring match
// is used.  Ignore headstones, in case the player names herself 'Elbereth'.  If
// strict checking is requested, the word is only considered to be present if it
// is intact and is the entire content of the engraving."
// The engr_time test is what makes a half-finished engraving inert: the
// engraving occupation stamps engr_time with the moment it will be FINISHED.
export function sengr_at(s, x, y, strict) {
    const ep = engr_at(x, y);

    if (ep && ep.engr_type !== HEADSTONE && (ep.engr_time | 0) <= (game.moves | 0)) {
        const txt = ep.actualText || '';
        if (strict ? txt.toLowerCase() === String(s).toLowerCase()
                   : strstri_engr(txt, String(s)))
            return ep;
    }
    return null;
}

// C ref: engrave.c:297 engr_can_be_felt(ep) — non-zero if it can be felt.
export function engr_can_be_felt(ep) {
    let canfeel = false;

    switch (ep.engr_type) {
    case ENGRAVE:
    case HEADSTONE:
    case BURN:
        canfeel = true;
        break;
    case DUST:
    case MARK:
    case ENGR_BLOOD:
    default:
        canfeel = false;
        break;
    }
    return canfeel;
}

// C ref: engrave.c:1724 see_engraving(ep).  display.js is imported lazily for
// the module-cycle reason documented at the top of this file.
export async function see_engraving(ep) {
    const { newsym } = await import('./display.js');
    newsym(ep.engr_x, ep.engr_y);
}

// C ref: engrave.c:1732 feel_engraving(ep) — "like see_engravings() but
// overrides vision, but only for some types of engravings that can be felt
// [this isn't actually used anywhere?]".
export async function feel_engraving(ep) {
    if (engr_can_be_felt(ep)) {
        ep.eread = 1;
        ep.erevealed = 1;
        // UNPORTED: map_engraving(ep, 1) (display.c:313) has no js/ counterpart;
        // its two statements are `if (level.flags.hero_memory) levl[x][y].glyph
        // = engraving_to_glyph(ep)` then `show_glyph(x, y, glyph)`.  Spelled out
        // here with display.js's exported pieces rather than stubbed; when
        // display.js gains map_engraving() this should call it instead.
        const { newsym, engraving_glyph, show_glyph_cell }
            = await import('./display.js');
        const loc = game.level?.at(ep.engr_x, ep.engr_y);
        if (loc) {
            const g = engraving_glyph(loc);
            if (game.level?.flags?.hero_memory)
                loc.remembered_glyph = { ch: g.ch, color: g.color,
                                         decgfx: g.dec, pile: false };
            show_glyph_cell(ep.engr_x, ep.engr_y, g.ch, g.color, g.dec);
        }
        /* in case it's beneath something, redisplay the something */
        newsym(ep.engr_x, ep.engr_y);
    }
}

// C ref: bones.c:198 sanitize_name(namebuf) — "while loading bones, strip out
// text possibly supplied by old player that might accidentally or maliciously
// disrupt new player's display".  js/options.js:1619 has a same-named private
// copy, but it is a DIFFERENT reduction (it deletes offending characters rather
// than substituting '.'/'_', so it shortens the string); reusing it here would
// silently change engraving lengths, which wipeout_text() counts.  Kept private
// under a distinct name so it cannot shadow the real bones.c port.
// strip_8th_bit = (WINDOWPORT(tty) && !iflags.wc_eight_bit_input): this build is
// tty, and the 'eight_bit_tty' option (default off) lives in this port's wincap
// BITMASK rather than in an iflags field (js/options.js:4210), so the C field
// name reads undefined here and the flag is TRUE — which is the default-off
// answer either way.
function sanitize_engr_text(s) {
    const strip_8th_bit = !(game.iflags?.wc_eight_bit_input);
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const raw = s.charCodeAt(i);
        const c = raw & 0o177;
        if (c < 0x20 /* ' ' */ || c === 0o177) {
            /* non-printable or undesirable */
            out += '.';
        } else if (c !== raw) {
            /* expected to be printable if user wants such things */
            out += strip_8th_bit ? '_' : String.fromCharCode(raw);
        } else {
            out += String.fromCharCode(raw);
        }
    }
    return out;
}

// C ref: engrave.c:1498 sanitize_engravings() — "while loading bones, clean up
// text which might accidentally or maliciously disrupt player's terminal when
// displayed".  Only engr_txt[actual_text] is sanitized (C sanitizes in place
// through the same pointer, so the remembered/pristine copies keep the raw
// bytes).
export function sanitize_engravings() {
    for (const ep of head_engr()) {
        ep.actualText = sanitize_engr_text(ep.actualText || '');
    }
}

// C ref: engrave.c:1509 forget_engravings() — "mark all engravings as
// not-discovered/not-read when saving bones".  C's note: the three text slots
// deliberately retain their original text.
export function forget_engravings() {
    for (const ep of head_engr()) {
        ep.erevealed = ep.eread = 0;
    }
}

// C ref: engrave.c:1524 engraving_sanity_check() — the '#sanity' wizard check.
export async function engraving_sanity_check() {
    const { impossible } = await import('./display.js');
    const { is_pool_or_lava, db_under_typ } = await import('./dbridge.js');
    const { surface } = await import('./dungeon.js');
    const engravings = head_engr();

    if (engravings.length && (Is_airlevel(game.u?.uz) || Is_waterlevel(game.u?.uz))) {
        await impossible('engraving sanity: on plane of air/water');
        return;
    }

    for (const ep of engravings) {
        const x = ep.engr_x, y = ep.engr_y;

        if (!isok(x, y)) {
            await impossible(`engraving sanity: !isok <${x},${y}>`);
            continue;
        }
        // C ref: rm.h:146 SURFACE_AT(x, y).
        const loc = game.level?.at(x, y);
        const levtyp = (loc?.typ === DRAWBRIDGE_UP)
            ? db_under_typ(loc.drawbridgemask) : (loc?.typ ?? STONE);
        if (is_pool_or_lava(x, y) || IS_AIR(levtyp) || !ACCESSIBLE(levtyp)) {
            await impossible(`engraving sanity: illegal surface (${levtyp}: "${surface(x, y)}")`);
            continue;
        }
    }
}

// C ref: engrave.c:1551 save_engravings(nhfp).  House convention for a ported
// save function (js/save.js:200) is to RETURN the blob C would have written;
// `mode` is C's nhfp->mode bitmask, read through save.js's update_file() /
// release_data().  save.js is reached by a lazy import because it statically
// imports display.js, which statically imports THIS file.
//
// engr_szeach / engr_alloc are set by C's make_engr_at() from the text lengths
// at creation time and never re-derived, so a wiped-down engraving still writes
// its original allocation; this port's make_engr_at() does not record them, so
// they are re-derived from the C formula when absent (see the note there).
export async function save_engravings(mode) {
    const { update_file, release_data } = await import('./save.js');
    const engravings = head_engr();
    const out = { engravings: [] };

    for (const ep of engravings.slice()) {   /* C caches ep2 = ep->nxt_engr */
        const szeach = engr_szeach(ep);
        const engr_alloc = (ep.engr_alloc | 0) || szeach * 3;
        if (engr_alloc && (ep.actualText || '')[0] && update_file(mode)) {
            out.engravings.push({
                engr_alloc,                            /* Sfo_unsigned */
                engr: {                                /* Sfo_engr */
                    engr_x: ep.engr_x, engr_y: ep.engr_y,
                    engr_szeach: szeach, engr_alloc,
                    engr_time: ep.engr_time, engr_type: ep.engr_type,
                    guardobjects: ep.guardobjects ? 1 : 0,
                    nowipeout: ep.nowipeout ? 1 : 0,
                    eread: ep.eread ? 1 : 0,
                    erevealed: ep.erevealed ? 1 : 0,
                },
                actual_text: ep.actualText || '',      /* Sfo_char x3 */
                remembered_text: ep.rememberedText || '',
                pristine_text: ep.pristineText || '',
            });
        }
        /* release_data(): C dealloc_engr(ep)s every entry, written or not; JS
           is garbage-collected, so dropping the list below is the whole job. */
    }
    if (update_file(mode))
        out.no_more_engr = 0;    /* the 0 length that ends the chain */
    if (release_data(mode) && game.level)
        game.level.engravings = [];
    return out;
}

// C ref: engrave.c:426/451 make_engr_at() — smem is the longest of the actual
// and pristine texts plus its NUL, and engr_alloc is smem * 3.
function engr_szeach(ep) {
    if (ep.engr_szeach | 0) return ep.engr_szeach | 0;
    let smem = (ep.actualText || '').length + 1;
    const prmem = (ep.pristineText || '').length + 1;
    if (prmem > smem) smem = prmem;
    return smem;
}

// C ref: engrave.c:1584 rest_engravings(nhfp) — read the chain back until the
// 0-length terminator.  The `saved` blob is what save_engravings() returned.
// Two details are load-bearing and easy to lose:
//   * the leading-blank skip on the actual and remembered text (C advances the
//     pointer, which is this port's engr_off — see wipe_engr_at());
//   * engr_time = svm.moves, "mark as finished for bones levels".
export function rest_engravings(saved) {
    if (!game.level) return;
    game.level.engravings = [];   /* head_engr = 0 */
    const list = saved?.engravings || [];

    for (const rec of list) {
        const lth = rec.engr_alloc | 0;
        if (lth === 0) return;    /* C's `if (lth == 0) return` terminator */
        const src = rec.engr || {};
        const ep = {
            engr_x: src.engr_x, engr_y: src.engr_y,
            engr_szeach: src.engr_szeach | 0,
            engr_alloc: lth,
            engr_type: src.engr_type,
            engr_time: src.engr_time,
            guardobjects: !!src.guardobjects,
            nowipeout: !!src.nowipeout,
            eread: src.eread ? 1 : 0,
            erevealed: src.erevealed ? 1 : 0,
            actualText: rec.actual_text || '',
            rememberedText: rec.remembered_text || '',
            pristineText: rec.pristine_text || '',
            engr_off: 0,
        };
        /* ep->nxt_engr = head_engr; head_engr = ep; */
        game.level.engravings.unshift(ep);

        const trimmed = ep.actualText.replace(/^ +/, '');
        ep.engr_off = ep.actualText.length - trimmed.length;
        ep.actualText = trimmed;
        ep.rememberedText = ep.rememberedText.replace(/^ +/, '');
        /* mark as finished for bones levels -- no problem for normal levels as
           the player must have finished engraving to be able to move again */
        ep.engr_time = game.moves | 0;
    }
}

// C ref: engrave.c:1626 engr_stats(hdrfmt, hdrbuf, count, size) — the '#stats'
// wizard-mode command.  C's three out-parameters become `{ s }` / `{ v }`
// boxes, the same shape js/timeout.js:2500 timer_stats() uses.
// sizeof(struct engr) is the recorded binary's 64 (js/wizcmds.js:188).
const SIZEOF_ENGR = 64;

export function engr_stats(hdrfmt, hdrbuf, count, size) {
    if (hdrbuf) hdrbuf.s = String(hdrfmt).replace('%ld', String(SIZEOF_ENGR));
    if (count) count.v = 0;
    if (size) size.v = 0;
    for (const ep of head_engr()) {
        if (count) count.v += 1;
        if (size) size.v += SIZEOF_ENGR + ((ep.engr_alloc | 0) || engr_szeach(ep) * 3);
    }
}

// C ref: engrave.c:545 doengrave_ctx_init(de) — "initialize the doengrave data".
// doengrave() above open-codes an equivalent block; this is the faithful
// transcription, and it carries two things that copy does not: the
// demon/vampire ENGR_BLOOD default, and de.oep being read BEFORE the stylus
// prompt.  Nothing calls it yet (see this block's header).
export async function doengrave_ctx_init(de) {
    const { is_demon_flag } = await import('./monflags_data.js');
    const u = game.u;

    de.dengr = false;
    de.doblind = false;
    de.doknown = false;
    de.eow = false;
    de.ptext = true;
    de.teleengr = false;
    de.zapwand = false;
    de.disprefresh = false;
    de.adding = false;

    de.ret = ECMD_OK;
    de.type = DUST;
    de.oetype = 0;

    de.otmp = null;
    de.oep = engr_at(u.ux, u.uy);

    de.buf = '';
    de.ebuf = '';
    de.fbuf = '';
    de.qbuf = '';
    de.post_engr_text = '';
    de.writer = null;

    if (de.oep)
        de.oetype = de.oep.engr_type;
    // C ref: mondata.h is_demon(ptr) (M2_DEMON) / is_vampire(ptr) — C's
    // `ptr->mlet == S_VAMPIRE` is the numeric class index, which in this port is
    // .mcls (makemon.js:621 puts the display CHARACTER in .mlet).
    const ydata = game.youmonst?.data;
    if (ydata && (is_demon_flag(ydata) || ydata.mcls === S_VAMPIRE_CLS))
        de.type = ENGR_BLOOD;

    de.jello = !!(u.uswallow && !(is_animal(u.ustuck?.data)
                                  || await is_whirly(u.ustuck?.data)));
    de.frosted = (game.level?.at(u.ux, u.uy)?.typ === ICE);
}
// C ref: monsym.h S_VAMPIRE.
const S_VAMPIRE_CLS = 48;

export function wipe_engr_at(x, y, cnt, magical = false) {
    const ep = engr_at(x, y);
    if (!ep || ep.engr_type === HEADSTONE || ep.nowipeout) return;

    const loc = game.level?.at(x, y);
    const on_ice = loc?.typ === ICE;
    if (ep.engr_type !== BURN || on_ice || (magical && !rn2(2))) {
        if (ep.engr_type !== DUST && ep.engr_type !== ENGR_BLOOD)
            cnt = rn2(1 + Math.trunc(50 / (cnt + 1))) ? 0 : 1;
        const wiped = wipeout_text(ep.actualText, cnt, 0);
        const trimmed = wiped.replace(/^ +/, '');
        // C ref: engrave.c:284 `while (ep->engr_txt[actual_text][0] == ' ')
        // ep->engr_txt[actual_text]++;` — the ACTUAL text pointer walks forward
        // inside the buffer while pristine_text stays put, and read_engr_at()
        // indexes pristine_text by that offset.  Track it, or the "is the
        // trailing punctuation original?" test reads the wrong pristine char.
        ep.engr_off = (ep.engr_off || 0) + (wiped.length - trimmed.length);
        ep.actualText = trimmed;
        if (!ep.actualText && game.level?.engravings) {
            game.level.engravings = game.level.engravings.filter((e) => e !== ep);
        }
    }
}
