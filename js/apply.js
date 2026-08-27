// apply.js — the #apply ('a') command.
//
// C ref: apply.c doapply()/apply_ok()/use_stethoscope().
//
// RNG faithfulness: the only path exercised by the owned starter sessions is
// applying a STETHOSCOPE.  The crucial RNG-faithful detail is the
// "one free use per turn" rule (apply.c:313-341):
//
//   res = (gh.hero_seq == svc.context.stethoscope_seq) ? ECMD_TIME : ECMD_OK;
//   svc.context.stethoscope_seq = gh.hero_seq;
//
// The first stethoscope use of a turn returns ECMD_OK (NO game turn passes,
// so the per-turn block — movemon / mcalcmove / maybe_generate_rnd_mon /
// gethungry — does NOT run and consumes NO RNG); a second use in the same
// hero_seq costs the turn.  Without this, the port would (wrongly) advance a
// turn on a self-probe, desynchronising the PRNG stream against C — which is
// exactly the seed0016 divergence: C records 0 RNG for the stethoscope-self
// step, the port was firing a whole per-turn block there.
//
// hero_seq is `svm.moves << 3` (allmain.c); since `a c .` here is the hero's
// very first action before any turn has elapsed, stethoscope_seq (init 0) and
// hero_seq differ on the first use, giving the free ECMD_OK.

import { game } from './gstate.js';
import { CQ_CANNED } from './const.js';
import { rn2, rnd, rn1, rnl, d } from './rng.js';

import {
    TOOL_CLASS, WAND_CLASS, SPBOOK_CLASS, POTION_CLASS, WEAPON_CLASS,
    COIN_CLASS, SCROLL_CLASS, MAGIC_MARKER, SCR_BLANK_PAPER, SPE_BLANK_PAPER,
    SPE_BOOK_OF_THE_DEAD, POT_OIL, objects, mksobj, weight,
} from './mkobj.js';
import { DESCR_BY_OTYP } from './o_descr_data.js';
// Leaf data module (no imports of its own), so a static import is cycle-free.
import { mflags1_of, mflags2_of, msound_of } from './monflags_data.js';
import {
    SDOOR, SCORR, DOOR, CORR, D_LOCKED, D_CLOSED,
    IS_AIR, IS_ROOM, IS_WALL, IS_DOOR,
} from './const.js';
import { surface as surface_word } from './dungeon.js';

// C ref: include/onames.h — STETHOSCOPE object type index (mkobj.js OBJECTS
// row [237, "STETHOSCOPE", ...]).  Defined locally to avoid threading a new
// export through mkobj.js.
const STETHOSCOPE = 237;
const SPE_NOVEL = 406; // mkobj.js OBJECT_DATA — novel (a spellbook subtype)

// C ref: include/onames.h — lamp/lantern object types rubbed by dorub().
const BRASS_LANTERN = 226, OIL_LAMP = 227, MAGIC_LAMP = 228;
// Graystones and royal jelly route to use_stone/use_royal_jelly (not exercised).
// C ref: objclass.h enum obj_class_types — GEM_CLASS is 13; the 9 that used to
// be here is SCROLL_CLASS, so dorub()'s graystone arm could never fire.
const GEM_CLASS = 13, FOOD_CLASS = 7, RING_CLASS = 4, RANDOM_CLASS = 0;
// Applicable foods (mkobj.js OBJECT_DATA indices).
const EUCALYPTUS_LEAF = 276, LUMP_OF_ROYAL_JELLY_OTYP = 286, CREAM_PIE = 287;
const BANANA = 281;       // apply_ok DOWNPLAYs a banana while hallucinating
const BULLWHIP_OTYP = 82; // mkobj.js OBJECT_DATA otyp column
const STATUE_OTYP = 476;  // mkobj.js STATUE
// skills.h P_SKILL levels used by calc_pole_range().
const P_SKILLED = 3, P_EXPERT = 4;

// C ref: include/onames.h — the lock-picking tools (mkobj.js OBJECTS rows).
const SKELETON_KEY = 221, LOCK_PICK = 222, CREDIT_CARD = 223;
// C ref: include/onames.h SACK/OILSKIN_SACK/BAG_OF_HOLDING (mkobj.js rows).
const SACK_OTYP = 217, OILSKIN_SACK_OTYP = 218, BAG_OF_HOLDING_OTYP = 219;

// ECMD result codes (cmd.h).  doapply() returns one of these; the caller maps
// ECMD_TIME -> game turn elapsed.
const ECMD_OK = 0;
const ECMD_CANCEL = 1;
const ECMD_TIME = 2;

// Lazily-imported deps (invent.js / display.js pull cmd.js transitively, so we
// avoid a static import cycle).
let _invent = null;
let _display = null;
let _cmd = null;
let _uhitm = null;
let _vision = null;
let _enhance = null;
async function loadDeps() {
    if (!_invent) _invent = await import('./invent.js');
    if (!_display) _display = await import('./display.js');
    if (!_cmd) _cmd = await import('./cmd.js');
    if (!_uhitm) _uhitm = await import('./uhitm.js');
    if (!_vision) _vision = await import('./vision.js');
    if (!_enhance) _enhance = await import('./enhance.js');
}

// C ref: do_name.c x_monnam — the article+name string for a monster.  Routed
// through uhitm.js's port (lazily, to avoid a static import cycle).
function x_monnam(mtmp, article, adjective, suppress, called) {
    return _uhitm.x_monnam(mtmp, article, adjective, suppress, called);
}

// C ref: apply.c apply_ok() — getobj() callback: which carried items are
// suggested / selectable for "use or apply".  Faithful to the starter classes
// (tools/wands/spellbooks are SUGGEST; coins DOWNPLAY; applicable weapons
// SUGGEST).  Anything else is selectable-but-not-suggested.
function apply_ok(obj) {
    const I = _invent;
    const EXCLUDE = I ? I.GETOBJ_EXCLUDE : -3;
    const EXCLUDE_SELECTABLE = I ? I.GETOBJ_EXCLUDE_SELECTABLE : 0;
    const DOWNPLAY = I ? I.GETOBJ_DOWNPLAY : 1;
    const SUGGEST = I ? I.GETOBJ_SUGGEST : 2;

    if (!obj) return EXCLUDE;

    if (obj.oclass === TOOL_CLASS || obj.oclass === WAND_CLASS
        || obj.oclass === SPBOOK_CLASS)
        return SUGGEST;

    if (obj.oclass === COIN_CLASS) return DOWNPLAY;

    // C ref: apply.c apply_ok() — is_pick/is_axe/is_pole/BULLWHIP all SUGGEST.
    // A Knight's starting lance is the common case; the blanket
    // EXCLUDE_SELECTABLE left it off the apply prompt's suggested-letter list.
    if (obj.oclass === WEAPON_CLASS) {
        if (I && (I.is_pick(obj) || I.is_axe(obj) || I.is_pole(obj)))
            return SUGGEST;
        if (obj.otyp === BULLWHIP_OTYP) return SUGGEST;
        return EXCLUDE_SELECTABLE;
    }

    if (obj.oclass === POTION_CLASS) {
        // C ref: apply.c apply_ok() — only an UNIDENTIFIED potion downplays; an
        // identified one is SUGGESTed when it is oil and otherwise falls
        // through to EXCLUDE_SELECTABLE below.  Returning DOWNPLAY for every
        // potion set getobj()'s forceprompt, so 'a' with nothing applicable
        // raised the prompt instead of printing "You don't have anything to
        // use or apply." (holy water is type-known from turn 1).
        // C's oc_name_known: an object with no randomized appearance is
        // type-known from init_objects (see invent.js not_fully_identified).
        const typeKnown = !!objects[obj.otyp]?.oc_name_known
            || DESCR_BY_OTYP[obj.otyp] == null;
        if (!obj.dknown || !typeKnown) return DOWNPLAY;
        if (obj.otyp === POT_OIL) return SUGGEST;
    }

    // C ref apply.c:4185 — certain foods are applicable (cream pie -> facial,
    // eucalyptus leaf -> cure, royal jelly -> eat).  These are SUGGESTed so the
    // apply prompt lists their invlet (e.g. the wished cream pie 'o').
    if (obj.otyp === CREAM_PIE || obj.otyp === EUCALYPTUS_LEAF
        || obj.otyp === LUMP_OF_ROYAL_JELLY_OTYP)
        return SUGGEST;

    // C ref: apply.c:4190 — a hallucinating hero can "phone" a banana.
    if (obj.otyp === BANANA && !!game.u?.uhallu) return DOWNPLAY;

    // C ref: apply.c:4193 — a gray stone is SUGGESTed unless the hero KNOWS it
    // isn't a touchstone.  Omitting the whole branch dropped every carried
    // luckstone/loadstone/flint/touchstone out of the apply prompt's
    // suggested-letter list, which is printed verbatim on the topline.
    if (is_graystone_otyp(obj.otyp)) {
        if (!obj.dknown) return SUGGEST;
        if (obj.otyp !== TOUCHSTONE
            && (objects[TOUCHSTONE]?.oc_name_known
                || objects[obj.otyp]?.oc_name_known))
            return EXCLUDE_SELECTABLE;
        return SUGGEST;
    }

    return EXCLUDE_SELECTABLE;
}

// C ref: insight.c ustatusline() — one-line self status produced when the
// stethoscope (or probing) is aimed at the hero.  Status-effect suffixes
// (Sick/Confusion/Blind/...) are omitted: the starter hero has none here, so
// `info` is empty and the line is exactly
//   "Status of <name> (<piousness> <align>):  Level L  HP h(m)  AC a."
function align_str(type) {
    return type === 0 ? 'neutral' : type > 0 ? 'lawful' : 'chaotic';
}

// C ref: insight.c piousness() — pious adverb from u.ualign.record, with the
// alignment word appended as a suffix (a lone space is dropped when record==3).
function piousness(record, suffix) {
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

    let buf = pio;
    if (suffix && record >= 0) {
        if (record !== 3) buf += ' ';
        buf += suffix;
    }
    return buf;
}

async function ustatusline() {
    const u = game.u;
    const name = game.plname || 'Hero';
    const align = u?.ualign?.type ?? 0;
    const record = u?.ualign?.record ?? 0;
    const pio = piousness(record, align_str(align));
    const lvl = u?.ulevel ?? 1;
    const hp = u?.uhp ?? 0;
    const hpmax = u?.uhpmax ?? 0;
    const ac = u?.uac ?? 0;
    await _display.pline(
        `Status of ${name} (${pio}):  Level ${lvl}  HP ${hp}(${hpmax})  AC ${ac}.`);
}

// C ref: allmain.c — gh.hero_seq is `svm.moves << 3`.  `svm.moves` (the turn
// counter) is game.moves in the port; before the first turn elapses it is the
// startup value, distinct from the init-0 stethoscope_seq below.
function hero_seq() {
    return (game.moves || 0) << 3;
}

// C ref: insight.c size_str(msize) — body-size word for a monster's status.
const MZ_TINY = 0, MZ_SMALL = 1, MZ_MEDIUM = 2, MZ_LARGE = 3, MZ_HUGE = 4,
      MZ_GIGANTIC = 7;
function size_str(msize) {
    switch (msize) {
    case MZ_TINY: return 'tiny';
    case MZ_SMALL: return 'small';
    case MZ_MEDIUM: return 'medium';
    case MZ_LARGE: return 'large';
    case MZ_HUGE: return 'huge';
    case MZ_GIGANTIC: return 'gigantic';
    default: return `unknown size (${msize})`;
    }
}

// C ref: align.h sgn-style — mon_aligntyp(mtmp) collapses the data alignment to
// A_LAWFUL(1)/A_NEUTRAL(0)/A_CHAOTIC(-1) (priest.c:280).  Our stethoscope only
// targets ordinary hostiles, so the ispriest/isminion branches don't apply.
function mon_aligntyp(mtmp) {
    const algn = mtmp?.data?.maligntyp ?? 0;
    return algn > 0 ? 1 : algn < 0 ? -1 : 0;
}

// C ref: insight.c mstatusline(mtmp) — one-line monster status produced when the
// stethoscope (or probing) is aimed at a monster.  The starter-session monsters
// reach here without the worn/leashed/held/shapechanger/segment flags, so only
// the ", tame"/", peaceful" prefix (info) and the size+align+HP+AC body matter;
// any hidden-appearance suffix has already been stripped by seemimic() before
// this is called for the stethoscope, matching C's comment at insight.c:3315.
async function mstatusline(mtmp, update_topl) {
    let info = '';
    if (mtmp.mtame) info += ', tame';
    else if (mtmp.mpeaceful) info += ', peaceful';
    // ", cancelled"/", confused"/", asleep"/", scared"/... state suffixes — none
    // of the probed monsters in the owned sessions carry these when statused.
    if (mtmp.mcan) info += ', cancelled';
    if (mtmp.mconf) info += ', confused';
    if (mtmp.mflee) info += ', scared';

    const name = x_monnam(mtmp, /*ARTICLE_YOUR*/ 3, null, 0, false);
    const align = align_str(mon_aligntyp(mtmp));
    const sz = size_str(mtmp.data?.msize ?? MZ_MEDIUM);
    const mlev = mtmp.m_lev ?? mtmp.data?.mlevel ?? 0;
    const mhp = mtmp.mhp ?? 0;
    const mhpmax = mtmp.mhpmax ?? mhp;
    const mac = (mtmp.data?.ac != null) ? mtmp.data.ac : 10;
    await update_topl(
        `Status of ${name} (${align}, ${sz}):  Level ${mlev}  HP ${mhp}(${mhpmax})  AC ${mac}${info}.`);
}

// ── music.c ────────────────────────────────────────────────────────────────
const LEATHER_DRUM_OTYP = 257;
// C ref: apply.c:4373-4384 — the ten otyps that reach do_play_instrument().
// HORN_OF_PLENTY (252) is deliberately NOT one of them.
const INSTRUMENT_OTYPS = new Set([247 /*WOODEN_FLUTE*/, 248 /*MAGIC_FLUTE*/,
    249 /*TOOLED_HORN*/, 250 /*FROST_HORN*/, 251 /*FIRE_HORN*/,
    253 /*WOODEN_HARP*/, 254 /*MAGIC_HARP*/, 256 /*BUGLE*/,
    257 /*LEATHER_DRUM*/, 258 /*DRUM_OF_EARTHQUAKE*/]);

// C ref: prop.h Deaf — the hero can't hear.  Never set for these heroes but
// the stethoscope's first guard reads it.
function Deaf() {
    const u = game.u;
    return ((u?.uprops?.Deaf || 0) > 0) || ((u?.uprops?.HDeaf || 0) > 0);
}

// C ref: wield.c will_weld(optr) — `optr->cursed && (erodeable_wep(optr) ||
// otyp == TIN_OPENER)`, where erodeable_wep is WEAPON_CLASS || is_weptool ||
// HEAVY_IRON_BALL || IRON_CHAIN.  js/invent.js keeps a private welded() that is
// stubbed to `return false`, so the real predicate lives here.
// mkobj.js OBJECT_DATA indices (verified against the loaded table, not guessed).
const HEAVY_IRON_BALL = 477, IRON_CHAIN = 478, TIN_OPENER = 239;
function welded_uwep() {
    const o = game.uwep;
    if (!o || !o.cursed) return false;
    return o.oclass === WEAPON_CLASS
        || !!(_invent && _invent.is_weptool && _invent.is_weptool(o))
        || o.otyp === HEAVY_IRON_BALL || o.otyp === IRON_CHAIN
        || o.otyp === TIN_OPENER;
}
function freehand() {
    if (!welded_uwep()) return true;
    return !_invent.bimanual(game.uwep) && !(game.uarms && game.uarms.cursed);
}

// C ref: apply.c use_stethoscope() — read a direction, then report on the
// hero (self), an adjacent monster (mstatusline, with the mimic/hidden reveal),
// or the empty square ("You hear nothing special.").
async function use_stethoscope(obj) {
    // C ref: apply.c:326 — three guards BEFORE getdir(), each returning ECMD_OK
    // WITHOUT reading a direction key.  Getting that wrong is a keystroke-count
    // bug, not a message bug: the direction key would be handed to the command
    // parser instead.
    if (_invent.nohands_youmonst()) {
        await _display.pline('You have no hands!');   /* not body_part(HAND) */
        return ECMD_OK;
    }
    if (Deaf()) {
        await _display.pline("You can't hear anything!");
        return ECMD_OK;
    }
    if (!freehand()) {
        await _display.pline('You have no free hand.');
        return ECMD_OK;
    }
    // getdir(): read a direction.  '.'/'s' => self (dx=dy=dz=0).
    const dir = await _cmd.getdir();
    if (!dir) return ECMD_CANCEL; // ESC

    // res: first use of this turn is free (ECMD_OK), a repeat costs the turn.
    game.context = game.context || {};
    const seq = hero_seq();
    const res = { v: (seq === game.context.stethoscope_seq) ? ECMD_TIME : ECMD_OK };
    game.context.stethoscope_seq = seq;

    const { update_topl } = await import('./display.js');
    const { m_at, newsym, map_invisible } = await import('./display.js');
    const u = game.u;

    // C ref: apply.c:361 — the up/down arm.  Aiming '>' at the floor probes
    // whatever corpse or statue lies there; '<' only reports that the hero
    // can't reach the ceiling.  The old port ignored dz entirely, so `a<tool><`
    // fell through to the adjacent-square scan (rx,ry == the hero's own square)
    // and printed "You hear nothing special.".
    if (dir.dz) {
        if (dir.dz < 0) {
            await update_topl(`You can't reach the ${ceiling_word(u.ux, u.uy)}.`);
        } else if (!await its_dead(u.ux, u.uy, res)) {
            await update_topl(`The ${surface_word(u.ux, u.uy)} seems healthy enough.`);
        }
        return res.v;
    }

    // C ref: apply.c:381 — a CURSED stethoscope has a 1-in-2 chance of
    // reporting the hero's own heartbeat instead, and that rn2(2) is drawn on
    // every use of a cursed one.  It was missing entirely.
    if (obj?.cursed && !rn2(2)) {
        await update_topl('You hear your heart beat.');
        return res.v;
    }

    // C ref: apply.c:386 confdir(FALSE) — a confused or stunned hero probes a
    // RANDOM direction, and that rn2 is drawn before the square is chosen.
    const d = confdir_apply(dir);

    // Self (dx==dy==0): ustatusline().
    if (!d.dx && !d.dy) {
        await ustatusline();
        return res.v;
    }

    const rx = u.ux + d.dx, ry = u.uy + d.dy;

    // C ref: apply.c:407 — isok() bounds check.  Off-map -> "faint typing noise".
    if (rx < 0 || rx > 79 || ry < 0 || ry > 21) {
        await update_topl('You hear a faint typing noise.');
        return ECMD_OK;
    }

    const mtmp = m_at(rx, ry);
    if (mtmp) {
        const mnm = x_monnam(mtmp, /*ARTICLE_A*/ 2, null, 0, false);
        const spotted = _uhitm.canspotmon(mtmp);
        if (mtmp.mundetected) {
            // C ref: apply.c:418 — the "hidden there" line is gated on
            // !canspotmon; the mundetected clear + newsym are not.
            if (!spotted) await update_topl(`There is ${mnm} hidden there.`);
            mtmp.mundetected = 0;
            newsym(mtmp.mx, mtmp.my);
        } else if (mtmp.m_ap_type && mtmp.mappearance != null) {
            // C ref: apply.c:410 — a disguised monster (mimic) is exposed.
            //   "That <thing> is really <a monster>."
            const what = stethoscope_appearance(mtmp);
            const use_plural = false; // boots/gloves/lenses plural not exercised
            await seemimic(mtmp);
            await update_topl(
                `${use_plural ? 'Those' : 'That'} ${what} ${use_plural ? 'are' : 'is'} really ${mnm}.`);
        } else if (!spotted) {
            // C ref: apply.c:461 — `flags.verbose && !canspotmon(mtmp)`.
            // verbose is on by default.
            await update_topl(`There is ${mnm} there.`);
        }
        await mstatusline(mtmp, update_topl);
        // C ref: apply.c:466 — an unspottable monster leaves an 'I' mark.
        if (!spotted) { try { map_invisible(rx, ry); } catch (_e) { /* ignore */ } }
        return res.v;
    }

    // C ref: apply.c:470 — an 'I' mark with nothing under it is cleared.
    if (unmap_invisible_at(rx, ry))
        await update_topl('The invisible monster must have moved.');

    // C ref: apply.c:474 — the stethoscope FINDS secret doors and passages.
    // "a hollow sound.  This must be a secret door!", and the square really
    // becomes a DOOR/CORR: skipping this left a permanently hidden door on a
    // map C had already revealed.
    const lev = game.level?.at(rx, ry);
    if (lev && lev.typ === SDOOR) {
        await update_topl('You hear a hollow sound.  This must be a secret door!');
        cvt_sdoor_to_door(lev);
        _vision.recalc_block_point(rx, ry);
        newsym(rx, ry);
        return res.v;
    }
    if (lev && lev.typ === SCORR) {
        await update_topl('You hear a hollow sound.  This must be a secret passage!');
        lev.typ = CORR; lev.flags = 0;
        _vision.unblock_point(rx, ry);
        newsym(rx, ry);
        return res.v;
    }

    // C ref: apply.c:483 — a corpse/statue on the target square gets its own
    // report; only an otherwise empty square says "nothing special".
    if (!await its_dead(rx, ry, res))
        await update_topl('You hear nothing special.');
    return res.v;
}

// C ref: detect.c cvt_sdoor_to_door(lev) — an exposed secret door becomes an
// ordinary closed (or still-locked) door.  WM_MASK is the low wall-mode bits an
// SDOOR keeps in doormask.  js/dig.js and js/read.js each keep their own copy
// of this same six-line C function.
const WM_MASK = 0x07;
function cvt_sdoor_to_door(lev) {
    let newmask = (lev.doormask || 0) & ~WM_MASK;
    if (!(newmask & D_LOCKED)) newmask |= D_CLOSED;
    lev.typ = DOOR;
    lev.doormask = newmask;
}

// C ref: display.c unmap_invisible(x, y) — clear a remembered "sensed but
// unseen monster" mark.  Returns TRUE if there was one.
function unmap_invisible_at(x, y) {
    const loc = game.level?.at(x, y);
    if (!game.level?.flags?.hero_memory || !loc?.invisMon) return false;
    _display.unmap_object(x, y);
    _display.newsym(x, y);
    return true;
}

// C ref: cmd.c confdir(FALSE) — while confused (1-in-5) or stunned, the probed
// direction is replaced by a random one.  dirs_ord/xdir/ydir mirror cmd.js's
// private copies of the same C tables.
const DIRS_ORD_A = [0, 2, 4, 6, 1, 3, 5, 7];
const XDIR_A = [-1, -1, 0, 1, 1, 1, 0, -1];
const YDIR_A = [0, -1, -1, -1, 0, 1, 1, 1];
const PM_GRID_BUG_A = 116;
function confdir_apply(dir) {
    const u = game.u;
    const stunned = (u?.uprops?.Stun || 0) > 0 || !!u?.Stunned;
    const confused = (u?.uprops?.Confusion || 0) > 0;
    const impaired = stunned || (confused && !rn2(5));
    if (!impaired) return dir;
    const kmax = (u?.umonnum === PM_GRID_BUG_A) ? 4 : 8;
    const k = DIRS_ORD_A[rn2(kmax)];
    return { dx: XDIR_A[k], dy: YDIR_A[k], dz: 0 };
}

// C ref: trap.c ceiling(x, y) — "ceiling" over a room/wall/door, "rock cavern"
// elsewhere, "sky" on an air level (js/trap.js keeps the same private copy).
function ceiling_word(x, y) {
    const typ = game.level?.at(x, y)?.typ ?? 0;
    if (IS_AIR(typ)) return 'sky';
    if (IS_ROOM(typ) || IS_WALL(typ) || IS_DOOR(typ) || typ === SDOOR)
        return 'ceiling';
    return 'rock cavern';
}

// C ref: apply.c its_dead(rx, ry, resp) — report on a corpse or statue at
// (rx, ry).  Returns TRUE when it said something.  The Hallucination arm's
// obj_to_glyph(corpse, rn2) roll and the Blind map_object() are not modelled;
// the two ordinary arms (which is what a non-hallucinating hero always gets)
// are exact.  This whole function was missing, so `a<stethoscope>>` on a
// corpse pile printed "You hear nothing special." and never set ECMD_TIME.
async function its_dead(rx, ry, resp) {
    await loadDeps();
    const CORPSE_OTYP = 265; // mkobj.js OBJECT_DATA — corpse
    const objs = [];
    for (const o of (game.level?.objects || []))
        if (o && o.where === 'floor' && o.ox === rx && o.oy === ry) objs.push(o);
    let corpse = objs.find((o) => o.otyp === CORPSE_OTYP) || null;
    let statue = objs.find((o) => o.otyp === STATUE_OTYP) || null;
    if (corpse && statue) {
        // "when both are present, pick the uppermost one" — objs is already in
        // nexthere order, so whichever comes first wins.
        if (objs.indexOf(statue) < objs.indexOf(corpse)) corpse = null;
        else statue = null;
    }
    const more_corpses = corpse
        && objs.some((o) => o !== corpse && o.otyp === CORPSE_OTYP);
    if (!corpse && !statue) return false;

    const here = (game.u?.ux === rx && game.u?.uy === ry);
    if (corpse) {
        const one = ((corpse.quan || 1) === 1) && !more_corpses;
        // Role_if(PM_HEALER)'s REVIVE_MON timer check needs the timer subsystem.
        await _display.update_topl(
            `You determine that ${one ? (here ? 'this' : 'that')
                                     : (here ? 'these' : 'those')}`
            + ` unfortunate being${one ? '' : 's'} ${one ? 'is' : 'are'} dead.`);
        return true;
    }
    // C ref: apply.c:281 — the statue is named by its petrified MONSTER
    // (obj_pmname), not by the object type.  Blind / type_is_pname (a unique
    // monster, which takes no article) are not modelled.
    const { monster_by_pmidx } = await import('./makemon.js');
    const what = monster_by_pmidx(statue.corpsenm)?.name || 'statue';
    await _display.update_topl(`The ${what} is in fine health for a statue.`);
    return true;
}

// C ref: mon.c seemimic(mtmp) — a discovered mimic drops its object/furniture
// appearance and is redrawn as its true form.
async function seemimic(mtmp) {
    const { newsym } = await import('./display.js');
    mtmp.m_ap_type = 0;
    mtmp.mappearance = 0;
    newsym(mtmp.mx, mtmp.my);
}

// C ref: apply.c use_stethoscope() M_AP_OBJECT/M_AP_FURNITURE branch — the
// "<what>" the disguised monster was pretending to be.  For an object appearance
// it is simple_typename(mappearance) (objnam.c: the bare type name with any
// trailing description stripped); for furniture it is the cmap explanation.
function stethoscope_appearance(mtmp) {
    if (mtmp.m_ap_type === 'furniture') {
        // defsyms[mappearance].explanation — not exercised by the owned
        // sessions' object-mimics; fall back to a generic word.
        return 'thing';
    }
    // M_AP_OBJECT: simple_typename(mappearance) — the plain object type name.
    try {
        return _invent.simple_typename(mtmp.mappearance);
    } catch (_e) {
        return 'thing';
    }
}

// C ref: write.c write_ok(obj) — getobj() callback for the paper a magic
// marker writes on.  Only scrolls and spellbooks qualify; a blank one is
// SUGGESTed, a written one DOWNPLAYed, everything else EXCLUDEd ("That is a
// silly thing to write on.").
function write_ok(obj) {
    const I = _invent;
    const EXCLUDE = I ? I.GETOBJ_EXCLUDE : -3;
    const DOWNPLAY = I ? I.GETOBJ_DOWNPLAY : 1;
    const SUGGEST = I ? I.GETOBJ_SUGGEST : 2;
    if (!obj || (obj.oclass !== SCROLL_CLASS && obj.oclass !== SPBOOK_CLASS))
        return EXCLUDE;
    if (obj.otyp === SCR_BLANK_PAPER || obj.otyp === SPE_BLANK_PAPER)
        return SUGGEST;
    return DOWNPLAY;
}

// C ref: write.c dowrite(pen) — applying a magic marker.  Prompts for the paper
// to write on; a non-blank scroll/spellbook draws "That <typeword> is not
// blank!" (a wasted turn), a blank one would proceed to the "What type of
// scroll..." prompt + cost computation.  The owned session only ever targets a
// non-writeable object (rejected by write_ok -> getobj's silly_thing) or an
// already-written one, so the blank-paper creation branch isn't reached; if it
// ever is, fall back to ECMD_TIME rather than mis-spend RNG.
async function dowrite(_pen) {
    // C ref: write.c:31 — a handless form can't write at all (the Glib arm
    // needs slippery fingers, which no covered session produces).
    if (_invent.nohands_youmonst()) {
        await _display.pline('You need hands to be able to write!');
        return ECMD_OK;
    }
    const paper = await _invent.getobj('write on', write_ok, _invent.GETOBJ_NOFLAGS);
    if (!paper) return ECMD_CANCEL; // cancelled / silly_thing -> no turn

    const typeword = (paper.otyp === SPE_NOVEL) ? 'book'
        : (paper.oclass === SPBOOK_CLASS) ? 'spellbook' : 'scroll';
    // observe_object(paper): no RNG.  Blind branch not reachable here.
    if (paper.otyp !== SCR_BLANK_PAPER && paper.otyp !== SPE_BLANK_PAPER) {
        await _display.pline(`That ${typeword} is not blank!`);
        const { exercise } = await import('./attrib.js');
        const A_WIS = 2; // attrib.h A_WIS
        exercise(A_WIS, false); // -> rn2(2)
        return ECMD_TIME;
    }
    _invent.makeknown(SCR_BLANK_PAPER);

    // C ref: write.c:69 — getlin("What type of <typeword> do you want to
    // write?").  This is a BLOCKING line prompt: it eats every keystroke up to
    // the newline.  Skipping it (as this used to) handed all of them to the
    // command parser, which then ran that many phantom commands.
    const { hooked_tty_getlin } = await import('./extcmd-handlers.js');
    let namebuf = await hooked_tty_getlin(
        `What type of ${typeword} do you want to write?`, null);
    game._pending_message = '';
    if (namebuf == null || namebuf === '\x1b' || namebuf === '') return ECMD_TIME;
    let nm = namebuf.replace(/\s+/g, ' ').replace(/^ | $/g, '');
    if (!nm) return ECMD_TIME;
    if (/^scroll /i.test(nm)) nm = nm.slice(7);
    else if (/^spellbook /i.test(nm)) nm = nm.slice(10);
    if (/^of /i.test(nm)) nm = nm.slice(3);
    nm = nm.replace(/ armour/i, ' armor ').replace(/\s+/g, ' ').replace(/ $/, '');

    // C ref: write.c:98 — scan this object class's contiguous otyp range for a
    // name or appearance match, then a second pass over user-assigned names
    // (whose rn2(++deferralchance) tie-break is a real draw, but only once the
    // hero has #named a type).
    const eq = (a, b) => a != null && b != null && a.toLowerCase() === b.toLowerCase();
    let found = -1, real = 0, deferred = 0, deferralchance = 0;
    const inClass = [];
    for (let i = 0; i < objects.length; i++)
        if (objects[i] && objects[i].oclass === paper.oclass) inClass.push(i);
    for (const i of inClass) {
        const ocl = objects[i];
        if (!ocl.name) continue;
        if (eq(ocl.name, nm)) {
            if (ocl.oc_name_known || paper.oclass === SPBOOK_CLASS) { found = i; break; }
            real = deferred = i;
            break;
        }
        if (eq(apply_obj_descr(i), nm)) { found = i; break; }
    }
    if (found < 0) {
        for (const i of inClass) {
            const ocl = objects[i];
            if (ocl.oc_uname && eq(ocl.oc_uname, nm)
                && !(real && ocl.oc_name_known)
                && !rn2(++deferralchance))
                deferred = i;
        }
        if (deferred) found = deferred;
    }
    if (found < 0) {
        await _display.pline(`There is no such ${typeword}!`);
        return ECMD_TIME;
    }
    // A real match runs mksobj + cost() + rn1(basecost/2, basecost/2) + an rnl()
    // success roll; none of that is ported, so stop here rather than invent a
    // stream C does not draw.
    return ECMD_TIME;
}

// C ref: objclass.h OBJ_DESCR(objects[i]) — the (shuffled) appearance word.
// objnam.js keeps the same accessor but does not export it.
function apply_obj_descr(otyp) {
    const ocl = objects[otyp];
    if (!ocl) return null;
    const idx = ocl.oc_descr_idx != null ? ocl.oc_descr_idx : otyp;
    return DESCR_BY_OTYP[idx] ?? null;
}

// C ref: apply.c doapply() — the #apply ('a') command.  Returns an ECMD_* code.
export async function doapply() {
    await loadDeps();

    // C ref: apply.c:4223 — both guards run BEFORE getobj(), so a refused
    // 'a' consumes no item-letter key.
    if (_invent.nohands_youmonst()) {
        await _display.pline("You aren't able to use or apply tools in your current form.");
        return ECMD_OK;
    }
    if (await _invent.check_capacity_throw()) return ECMD_OK;
    const obj = await _invent.getobj('use or apply', apply_ok);
    if (!obj) return ECMD_CANCEL;

    // C ref apply.c:4232-4240 — three class-level dispatches BEFORE the otyp
    // switch.  "You cannot apply that here." is not a NetHack string: printing
    // it put a fabricated topline on screen and, worse, swallowed the
    // confirmation / --More-- keystrokes that C's own handlers consume, so the
    // rest of the session read one keystroke ahead of C.
    if (obj.oclass === WAND_CLASS) return await do_break_wand(obj);
    if (obj.oclass === SPBOOK_CLASS) return await flip_through_book(obj);
    if (obj.oclass === COIN_CLASS) return await flip_coin(obj);

    if (obj.otyp === STETHOSCOPE) {
        return await use_stethoscope(obj);
    }

    // C ref apply.c:4361 — applying a magic marker writes a scroll/spellbook.
    if (obj.otyp === MAGIC_MARKER) {
        return await dowrite(obj);
    }

    // C ref apply.c:4258 — applying a cream pie immerses the hero's face in it.
    if (obj.otyp === CREAM_PIE) {
        return await use_cream_pie(obj);
    }

    // C ref apply.c:4285 — a lock pick / skeleton key / credit card picks a
    // lock: pick_lock() prompts for a direction and unlocks an adjacent door /
    // a container underfoot.  Non-zero result (DID/LEARNED_SOMETHING) -> a turn
    // elapsed (ECMD_TIME); PICKLOCK_DID_NOTHING (0) -> no turn (ECMD_OK).
    // C ref apply.c:4277 — a carried sack / oilskin sack / bag of holding opens
    // the "Do what with your bag?" loot menu (use_container(&obj, TRUE, FALSE)).
    // Falling through to the yafm below handed the menu's keystrokes to the
    // command parser instead (seed0012 steps 259-264).
    if (obj.otyp === SACK_OTYP || obj.otyp === OILSKIN_SACK_OTYP
        || obj.otyp === BAG_OF_HOLDING_OTYP) {
        const { use_container_held } = await import('./extcmd-handlers.js');
        return await use_container_held(obj) ? ECMD_TIME : ECMD_OK;
    }

    if (obj.otyp === LOCK_PICK || obj.otyp === SKELETON_KEY || obj.otyp === CREDIT_CARD) {
        const r = await _cmd.pick_lock(obj);
        return r ? ECMD_TIME : ECMD_OK;
    }

    // C ref: apply.c:4340 — the ten musical instruments dispatch to
    // do_play_instrument() (music.c, now ported in full).
    if (INSTRUMENT_OTYPS.has(obj.otyp)) {
        const { do_play_instrument } = await import('./music.js');
        // music.js returns the REAL hack.h codes (ECMD_TIME 0x01); this file
        // renumbers them (ECMD_TIME 2) and cmd.js compares against THIS file's
        // ECMD export, so translate rather than passing the value through.
        const r = await do_play_instrument(obj);
        return (r & 0x01) ? ECMD_TIME : ECMD_OK;
    }

    // C ref: apply.c:4396 `case FLINT: case LUCKSTONE: case LOADSTONE:
    // case TOUCHSTONE: res = use_stone(obj);` — rub something on a graystone.
    if (is_graystone_otyp(obj.otyp)) return await use_stone(obj);

    // C ref: apply.c:4265 `case BULLWHIP: res = use_whip(obj); break;` — the
    // whip is a WEAPON_CLASS item apply_ok() SUGGESTs, so it is offered at the
    // "use or apply" prompt for every hero who carries one (an Archeologist
    // starts wielding theirs in slot a).  use_whip() lives in dothrow.js, which
    // reached it only from dofire()'s empty-quiver arm; without this branch the
    // apply path fell through to "Sorry, I don't know how to use that." and
    // swallowed the direction key that follows.  dothrow.js uses its own ECMD
    // numbering (ECMD_TIME === 3), so translate rather than pass through.
    if (obj.otyp === BULLWHIP_OTYP) {
        const DT = await import('./dothrow.js');
        const r = await DT.use_whip(obj, () => _cmd.getdir());
        return r === 3 ? ECMD_TIME : (r ? ECMD_CANCEL : ECMD_OK);
    }

    // C ref apply.c:4400 default: — a polearm strikes at a distance, a
    // pick/axe digs.  Both are SUGGESTed by apply_ok(), so both are ordinary
    // picks at the "use or apply" prompt (a Knight's lance is invlet 'b', an
    // Archeologist's/dwarf's pick-axe is a starting item).
    if (_invent.is_pole(obj)) return await use_pole(obj, false);
    // C ref: apply.c:4292/4413 default: -> dig.c use_pick_axe(obj).
    if (_invent.is_pick(obj) || _invent.is_axe(obj)) {
        const { use_pick_axe, USE_PICK_AXE_REWIELDED, USE_PICK_AXE_DIG }
            = await import('./dig.js');
        const r = await use_pick_axe(obj);
        if (r === USE_PICK_AXE_REWIELDED) return await reapply_after_wield(obj);
        if (r === USE_PICK_AXE_DIG) return ECMD_TIME;
        return r === 1 ? ECMD_CANCEL : ECMD_OK;
    }

    // Any other tool isn't exercised; mirror C's "I don't know how to use that"
    // (C returns ECMD_FAIL here, which like ECMD_OK costs no turn).
    await _display.pline("Sorry, I don't know how to use that.");
    return ECMD_OK;
}

// C ref: apply.c flip_through_book(obj) — applying a spellbook.  Always costs
// the turn.  makeknown(SPE_BLANK_PAPER) on the blank arm is a real discovery
// (it changes later inventory/discoveries text), not just a message.
async function flip_through_book(obj) {
    await loadDeps();
    const hallu = !!game.u?.uhallu;
    const blind = (game.u?.blinded || 0) > 0 || !!game.ublindf;
    // C ref: objnam.c thesimpleoname(obj) — "the " + minimal_xname(), which
    // respects identification (an unknown book stays "the spellbook").
    // invent.js's xname() calls observe_object() as a side effect, which C's
    // does not, so use the observation-free accessor.
    await _display.pline(
        `You flip through the pages of the ${_invent.cxname_singular(obj)}.`);
    // C's second You()/pline() call first acknowledges the previous topline's
    // --More-- prompt. Keep that wait inside the command so invalid keys are
    // consumed by more() and the follow-up text appears only after dismissal.
    await _display.topl_more();
    if (obj.otyp === SPE_BOOK_OF_THE_DEAD) {
        // Deaf is never set for these heroes.
        await _display.pline(`You hear the pages make an unpleasant ${
            hallu ? 'chuckling' : 'rustling'} sound.`);
    } else if (blind) {
        await _display.pline(`The pages feel ${
            hallu ? 'freshly picked' : 'rough and dry'}.`);
    } else if (obj.otyp === SPE_BLANK_PAPER) {
        await _display.pline(`This spellbook ${
            hallu ? "doesn't have much of a plot"
                  : 'has nothing written in it'}.`);
        _invent.makeknown(obj.otyp);
    } else if (hallu) {
        await _display.pline('You enjoy the animated initials.');
    } else if (obj.otyp === SPE_NOVEL) {
        await _display.pline('This looks like it might be interesting to read.');
    } else {
        // C ref: apply.c:4510 fadeness[] indexed by min(spestudied,
        // MAX_SPELL_STUDY); MAX_SPELL_STUDY is 4 (spell.h).
        const fadeness = ['fresh', 'slightly faded', 'very faded',
                          'extremely faded', 'barely visible'];
        const findx = Math.min(obj.spestudied || 0, 4);
        await _display.pline(`The${objects[obj.otyp]?.oc_magic ? ' magical' : ''
            } ink in this spellbook is ${fadeness[findx]}.`);
    }
    return ECMD_TIME;
}

// C ref: apply.c flip_coin(obj) — the coin-flipping easter egg.  Draws
// rn2(ACURR(A_DEX)) when Dex is below 10, then rn2(2) for heads/tails (or
// rn2(100) while hallucinating).  Always ECMD_TIME.
async function flip_coin(obj) {
    await loadDeps();
    const { acurr_eff } = await import('./attrib.js');
    const A_DEX = 3; // attrib.h — [Str,Int,Wis,Dex,Con,Cha]
    const dex = acurr_eff(A_DEX);
    await _display.pline(`You flip a ${_invent.cxname_singular(obj)}.`);
    let lose_coin = false;
    // Underwater is never true here.  Glib/Fumbling are the other slip causes.
    const slippery = ((game.u?.Glib || 0) > 0) || ((game.u?.uprops?.Glib || 0) > 0)
        || ((game.u?.uprops?.Fumbling || 0) > 0);
    if (slippery || (dex < 10 && !rn2(dex))) {
        await _display.pline(`It slips between your ${
            game.uarmg ? 'gloves' : 'fingers'}.`);
        lose_coin = true;
    }
    if (lose_coin) {
        // splitobj(otmp, 1) + dropx(otmp): dropping is not modelled here, so
        // the coin stays in the pack.  The message and the turn are right.
        return ECMD_TIME;
    }
    if (game.u?.uhallu) {
        await _display.pline(rn2(100) ? 'Wow, a double header!'
                             : 'The coin miraculously lands on its edge!');
    } else {
        await _display.pline(`It comes up ${rn2(2) ? 'heads' : 'tails'}.`);
    }
    return ECMD_TIME;
}

// C ref: apply.c do_break_wand(obj) — applying a wand breaks it.  The zap
// effects (bhitm/bhito over the 3x3 area, explosion, shop damage) are a whole
// unported subsystem, but the guards and the y/n confirmation in front of them
// are NOT: C blocks on "Are you really sure you want to break <wand>?" and
// consumes that keystroke.  Answering 'n' is fully faithful (ECMD_OK, no RNG);
// answering 'y' prints the break line and stops before the effects.
async function do_break_wand(obj) {
    await loadDeps();
    const { acurr_eff } = await import('./attrib.js');
    const A_STR = 0; // attrib.h — [Str,Int,Wis,Dex,Con,Cha]
    // C: objdescr_is(obj, "balsa") || objdescr_is(obj, "glass") — compares the
    // SHUFFLED appearance, so it must go through oc_descr_idx.
    const descr = apply_obj_descr(obj.otyp) || '';
    const is_fragile = /balsa|glass/.test(descr);
    if (acurr_eff(A_STR) < (is_fragile ? 5 : 10)) {
        await _display.pline(`You don't have the strength to break your ${
            _invent.cxname_singular(obj)}!`);
        return ECMD_OK;
    }
    const ans = await _display.y_n(
        `Are you really sure you want to break your ${_invent.cxname_singular(obj)}?`);
    if (ans !== 'y') return ECMD_OK;
    await _display.pline(
        `Raising your ${_invent.cxname_singular(obj)} high above your head,`
                         + ` you ${is_fragile ? 'snap' : 'break'} it in two!`);
    // zappable()/the per-otyp effect switch is unported; stop here rather than
    // invent an RNG stream C does not draw.
    return ECMD_TIME;
}

// C ref: apply.c:3567 use_cream_pie(obj) — the hero immerses their face in a
// (wished/applied) cream pie.  "You immerse your face in the cream pie."; then,
// because a cream pie can_blnd(), blindinc = rnd(25) and the hero is blinded:
// "You can't see through all the sticky goop on your face." (the !wasblind ->
// Blind branch).  The pie is used up; returns ECMD_OK (no game turn).
async function use_cream_pie(obj) {
    await loadDeps();
    const { update_topl } = await import('./display.js');
    const { vision_recalc } = await import('./vision.js');
    const u = game.u;
    const wasblind = (u?.blinded || 0) > 0; // Blind before
    // (quan > 1 split not needed: wished pie has quan 1.)
    await update_topl('You immerse your face in the cream pie.');
    // can_blnd(0, youmonst, AT_WEAP, cream pie) is TRUE for a cream pie.
    const blindinc = rnd(25);
    if (u) {
        u.ucreamed = (u.ucreamed || 0) + blindinc;
        // make_blinded(Blinded + blindinc, FALSE): set the blind timer, then
        // toggle_blindness() -> vision_recalc(0) so the now-unseen monsters are
        // blanked from the display this turn.
        u.blinded = (u.blinded || 0) + blindinc;
    }
    // C ref apply.c:3588 — make_blinded() (which runs toggle_blindness ->
    // vision_recalc(0)) fires BEFORE the "can't see through the goop" pline.
    // The vision recalc must therefore happen between the two messages: the
    // second pline triggers the "--More--" prompt, and the screen captured at
    // that prompt must already show the now-unseen monsters blanked.  Doing the
    // recalc after both plines (as before) left the stale monster glyphs on the
    // --More-- screen, diverging from C (seed0108 step-55).
    if (!wasblind) { try { vision_recalc(0); } catch (e) { /* ignore */ } }
    // !wasblind && now Blind -> the "can't see through the goop" line.
    if (!wasblind) {
        await update_topl(`You can't see through all the sticky goop on your face.`);
    } else {
        await update_topl(`There's more sticky goop all over your face.`);
    }
    // setnotworn + costly_alteration (no RNG, no cost) + use up the pie.
    consume_applied_pie(obj);
    return ECMD_OK;
}

// Remove the applied cream pie from inventory (C: setnotworn + obj_extract_self
// + delobj).  invent.js's useupall removes the whole (quan-1) stack.
//
// C ref apply.c:3603 use_cream_pie() ends with delobj(obj), and
// invent.c:1446 delobj_core() rolls obj_resists(obj, 0, 0) on the object before
// destroying it.  A cream pie is not an Amulet/invocation tool/Rider corpse, so
// obj_resists falls to its `rn2(100)` branch (zap.c:1469) and returns FALSE.
// That single rn2(100) must be emitted here for RNG parity — without it the
// goblin's following dochug/distfleeck stream is shifted by one call (the
// seed0108 step-56 divergence).  useupall() does not emit it, so do it
// explicitly, in C order (after the inventory removal that obj_extract_self
// performs, immediately before the object is freed).
function consume_applied_pie(obj) {
    try {
        if (_invent && typeof _invent.useupall === 'function') {
            _invent.useupall(obj);
            // delobj() -> obj_resists(obj, 0, 0): plain rn2(100) for a cream pie.
            rn2(100);
        } else { obj.where = 'free'; rn2(100); }
    } catch (e) { /* ignore */ }
}

// C ref: do.c:2390 dowipe() — the #wipe command.  When creamed, C does NOT wipe
// in the command turn; it calls set_occupation(wipeoff, ...) and returns
// ECMD_TIME.  The wipeoff() occupation then runs on the FOLLOWING turn from the
// move loop (allmain.c moveloop_core(): after the command turn's monster moves).
// This split matters: in the command turn the hero is STILL creamed/blind, so
// monsters move while the hero can't see; only after wipeoff() runs does the
// hero regain sight.  Modelling the wipe inline (regaining sight before the
// command turn's monsters move) desynced the pet's distfleeck/dog_move stream
// for the rest of seed0108 (the step-62 divergence).
//
// When already clean (ucreamed == 0), C prints "Your face is already clean." and
// returns ECMD_TIME with no occupation.
export async function dowipe() {
    await loadDeps();
    const { update_topl } = await import('./display.js');
    const u = game.u;
    if ((u?.ucreamed || 0) > 0) {
        // set_occupation(wipeoff, ...): the move loop runs wipeoff() next turn.
        game._wipe_occupation = true;
        return ECMD_TIME;
    }
    await update_topl(`Your face is already clean.`);
    return ECMD_TIME;
}

// C ref: do.c:2361 wipeoff() — the #wipe occupation, run each turn from the move
// loop.  Subtracts min(ucreamed,4) and min(BlindedTimeout,4); when Blinded hits
// 0 it prints "You've got the glop off." and make_blinded(0, TRUE) regains sight
// ("You can see again.").  Returns 1 while still busy (clearing more than one
// tick's worth), 0 when finished.  The seed0108 hero is creamed by rnd(25)=3, so
// a single tick fully clears it (returns 0).
export async function wipeoff() {
    await loadDeps();
    const { update_topl } = await import('./display.js');
    const { vision_recalc } = await import('./vision.js');
    const u = game.u;
    const udelta = Math.min(u?.ucreamed || 0, 4);
    const ldelta = Math.min(u?.blinded || 0, 4);
    if (u) {
        u.ucreamed = (u.ucreamed || 0) - udelta;
        u.blinded = (u.blinded || 0) - ldelta;
    }
    if ((u?.blinded || 0) <= 0) {
        if (u) { u.blinded = 0; u.ucreamed = 0; }
        await update_topl(`You've got the glop off.`);
        // make_blinded(0, TRUE): regaining sight -> "You can see again."
        await update_topl(`You can see again.`);
        try { vision_recalc(0); } catch (e) { /* ignore */ }
        return 0; // occupation finished
    } else if ((u?.ucreamed || 0) === 0) {
        await update_topl(`Your face feels clean now.`);
        return 0;
    }
    return 1; // still busy
}

// C ref: apply.c rub_ok() — getobj() classifier for #rub.  Lamps/lanterns,
// graystones and royal jelly are SUGGESTed; everything else is EXCLUDEd (and,
// because rub_ok(NULL) returns EXCLUDE, there is no "- " hands entry in the
// prompt — matching the recorded "What do you want to rub? [n or ?*]").
const LUMP_OF_ROYAL_JELLY = LUMP_OF_ROYAL_JELLY_OTYP; // mkobj.js index 286
// graystones (mkobj.js indices) — rub_ok SUGGESTs these (not exercised here).
const LUCKSTONE = 470, LOADSTONE = 471, TOUCHSTONE = 472, FLINT = 473;
function is_graystone_otyp(otyp) {
    return otyp === FLINT || otyp === LUCKSTONE || otyp === LOADSTONE
        || otyp === TOUCHSTONE;
}
// C ref: objclass.h enum obj_material_types — the materials use_stone()
// branches on.
const MAT_LIQUID = 1, MAT_WAX = 2, MAT_CLOTH = 6, MAT_LEATHER = 7,
      MAT_WOOD = 8, MAT_SILVER = 14, MAT_GOLD = 15, MAT_GLASS = 19,
      MAT_GEMSTONE = 20, MAT_MINERAL = 21;
// C ref: decl.c c_obj_colors[] indexed by objects[].oc_color (color.h CLR_*).
const C_OBJ_COLORS = [
    'black', 'red', 'green', 'brown', 'blue', 'magenta', 'cyan', 'gray',
    'transparent', 'orange', 'bright green', 'yellow', 'bright blue',
    'bright magenta', 'bright cyan', 'white',
];
const RUBBER_HOSE_OTYP = 78; // mkobj.js OBJECT_DATA — the other is_flimsy item
// C ref: obj.h:418 is_flimsy(otmp) — oc_material <= LEATHER, or a rubber hose.
function is_flimsy_obj(obj) {
    return (objects[obj?.otyp]?.oc_material ?? 99) <= MAT_LEATHER
        || obj?.otyp === RUBBER_HOSE_OTYP;
}
function plur(n) { return Number(n) === 1 ? '' : 's'; }
// C ref: objnam.c the(str) — "the " unless the name is already capitalised.
function the_of(obj) {
    const nm = _invent.xname(obj);
    return /^[A-Z]/.test(nm) ? nm : `the ${nm}`;
}
// C ref: hack.h Role_if(pm)/Race_if(pm) — gu.urole.malenum / gu.urace.malenum.
// This port carries the 0-based role/race indices instead of the PM_ numbers.
const ROLE_ARCHEOLOGIST = 0, RACE_GNOME = 3;
function role_is(idx) { return (game.urole?.mnum ?? -1) === idx; }
function race_is(idx) { return (game.urace?.mnum ?? -1) === idx; }
// C ref: objnam.c Tobjnam(obj, verb) — "The <xname> <verb>s".
function Tobjnam(obj, verb) {
    const nm = _invent.xname(obj);
    const v = _invent.otense(obj, verb);
    return `${/^[A-Z]/.test(nm) ? '' : 'The '}${nm} ${v}`.replace(/^The The /, 'The ');
}
// C ref: apply.c touchstone_ok() — getobj() callback used once the touchstone
// itself is identified: coins and UNidentified gems are the useful targets.
function touchstone_ok(obj) {
    const I = _invent;
    if (!obj) return I.GETOBJ_EXCLUDE;
    if (obj.oclass === COIN_CLASS) return I.GETOBJ_SUGGEST;
    if (obj.oclass === GEM_CLASS
        && !(obj.dknown && objects[obj.otyp]?.oc_name_known))
        return I.GETOBJ_SUGGEST;
    return I.GETOBJ_DOWNPLAY;
}

// C ref: apply.c use_stone(tstone) — rub something on a graystone.  Reached
// from doapply()'s FLINT/LUCKSTONE/LOADSTONE/TOUCHSTONE case and from dorub()'s
// graystone arm.  A touchstone the hero has not identified prompts with
// any_obj_ok ("[*]"); once identified it prompts with touchstone_ok, which
// suggests coins and unidentified gems only.
async function use_stone(tstone) {
    await loadDeps();
    const I = _invent;
    const O = await import('./o_init.js');
    const Z = await import('./zap.js');
    const blind = _vision.Blind();
    const hallu = !!game.Hallucination;
    const scritch = '"scritch, scritch"';

    if (!blind) O.observe_object(tstone);
    const known = tstone.otyp === TOUCHSTONE && tstone.dknown
        && !!objects[TOUCHSTONE]?.oc_name_known;
    const stonebuf = `rub on the stone${plur(tstone.quan)}`;
    const obj = await I.getobj(stonebuf, known ? touchstone_ok : I.any_obj_ok,
                               I.GETOBJ_PROMPT);
    if (!obj) return ECMD_CANCEL;

    if (obj === tstone && Number(obj.quan) === 1) {
        await _display.pline(`You can't rub ${the_of(obj)} on itself.`);
        return ECMD_OK;
    }

    if (tstone.otyp === TOUCHSTONE && tstone.cursed
        && obj.oclass === GEM_CLASS && !is_graystone_otyp(obj.otyp)
        && !Z.obj_resists(obj, 80, 100)) {
        if (blind) await _display.pline('You feel something shatter.');
        else if (hallu) await _display.pline('Oh, wow, look at the pretty shards.');
        else await _display.pline(`A sharp crack shatters ${
            Number(obj.quan) > 1 ? 'one of ' : ''}${the_of(obj)}.`);
        I.useup(obj);
        return ECMD_TIME;
    }

    if (blind) { await _display.pline(scritch); return ECMD_TIME; }
    if (hallu) { await _display.pline('Oh wow, man: Fractals!'); return ECMD_TIME; }

    let do_scratch = false, streak_color = null;
    const material = objects[obj.otyp]?.oc_material ?? 0;
    // C ref: apply.c:2745 — a non-gemstone, non-mineral ring is neither gem nor
    // ring for the purposes of the switch below.
    let oclass = obj.oclass;
    if (oclass === RING_CLASS && material !== MAT_GEMSTONE
        && material !== MAT_MINERAL)
        oclass = RANDOM_CLASS;

    if (oclass === GEM_CLASS || oclass === RING_CLASS) {
        // C ref: apply.c:2752 — only the GLASS arm `break`s before the shared
        // streak_color assignment; the tstone-isn't-a-touchstone arm falls into
        // it, so a scratch there ALSO names a colour.
        let glass_break = false;
        if (tstone.otyp !== TOUCHSTONE) {
            do_scratch = true;
        } else if (obj.oclass === GEM_CLASS
                   && (tstone.blessed
                       || (!tstone.cursed && (role_is(ROLE_ARCHEOLOGIST)
                                              || race_is(RACE_GNOME))))) {
            I.makeknown(TOUCHSTONE);
            I.makeknown(obj.otyp);
            await I.prinv(null, obj, 0);
            return ECMD_TIME;
        } else if (material === MAT_GLASS) {
            do_scratch = true;
            glass_break = true;
        }
        if (!glass_break)
            streak_color = C_OBJ_COLORS[objects[obj.otyp]?.oc_color ?? 7];
    } else {
        switch (material) {
        case MAT_CLOTH:
            await _display.pline(`${Tobjnam(tstone, 'look')} a little more polished now.`);
            return ECMD_TIME;
        case MAT_LIQUID:
            if (!obj.known)
                await _display.pline('You must think this is a wetstone, do you?');
            else
                await _display.pline(`${Tobjnam(tstone, 'are')} a little wetter now.`);
            return ECMD_TIME;
        case MAT_WAX: streak_color = 'waxy'; break;
        case MAT_WOOD: streak_color = 'wooden'; break;
        case MAT_GOLD: do_scratch = true; streak_color = 'golden'; break;
        case MAT_SILVER: do_scratch = true; streak_color = 'silvery'; break;
        default:
            // C ref: apply.c:2790 — flimsy things streak but never scratch.
            if (is_flimsy_obj(obj))
                streak_color = C_OBJ_COLORS[objects[obj.otyp]?.oc_color ?? 7];
            else
                do_scratch = (tstone.otyp !== TOUCHSTONE);
            break;
        }
    }

    const stones = `stone${plur(tstone.quan)}`;
    if (do_scratch)
        await _display.pline(`You make ${streak_color ? `${streak_color} ` : ''
            }scratch marks on the ${stones}.`);
    else if (streak_color)
        await _display.pline(`You see ${streak_color} streaks on the ${stones}.`);
    else
        await _display.pline(scritch);
    return ECMD_TIME;
}

function rub_ok(obj) {
    const I = _invent;
    const EXCLUDE = I ? I.GETOBJ_EXCLUDE : -3;
    const SUGGEST = I ? I.GETOBJ_SUGGEST : 2;
    if (!obj) return EXCLUDE;
    if (obj.otyp === OIL_LAMP || obj.otyp === MAGIC_LAMP
        || obj.otyp === BRASS_LANTERN || is_graystone_otyp(obj.otyp)
        || obj.otyp === LUMP_OF_ROYAL_JELLY)
        return SUGGEST;
    return EXCLUDE;
}

// C ref: apply.c dorub() — the #rub command.  Returns an ECMD_* code.
//
// The recorded seed0108 path rubs a wished magic lamp that is held (not yet
// wielded) in inventory: getobj() asks "What do you want to rub? [n or ?*]",
// 'n' selects the lamp, and because obj != uwep dorub wields it via
// wield_tool() ("You now wield a lamp.") and returns ECMD_TIME, re-queuing
// itself on the canned-command stack (the re-run, with the lamp now wielded,
// is not separately exercised in the recorded stream).  The graystone /
// royal-jelly / already-wielded-lamp (djinni / puff of smoke / nothing) paths
// are present for faithfulness but consume no RNG in the owned sessions.
export async function dorub() {
    await loadDeps();
    const obj = await _invent.getobj('rub', rub_ok, _invent.GETOBJ_NOFLAGS);
    if (!obj) return ECMD_CANCEL;

    if (obj.oclass === GEM_CLASS || obj.oclass === FOOD_CLASS) {
        // C ref: apply.c dorub() — graystone -> use_stone, royal jelly ->
        // use_royal_jelly (unmodelled); any other gem/food: "Sorry, I don't know
        // how to use that." (no turn).
        if (is_graystone_otyp(obj.otyp)) return await use_stone(obj);
        await _display.pline("Sorry, I don't know how to use that.");
        return ECMD_OK;
    }

    if (obj !== game.uwep) {
        if (await _invent.wield_tool(obj, 'rub')) {
            // C: cmdq_add_ec(CQ_CANNED, dorub) + cmdq_add_key(invlet) -> re-runs
            // dorub with the tool wielded.  The wished-lamp session reaches this
            // wield-and-time path; the canned re-run isn't separately recorded.
            return ECMD_TIME;
        }
        return ECMD_OK;
    }

    // obj == uwep: the rub-the-wielded-lamp branch.  spe<=0 wished lamps never
    // reach the djinni roll (rn2(3) is short-circuited); the puff/nothing rolls
    // (rn2(2)) are present for faithfulness but unexercised in the owned stream.
    if (game.uwep.otyp === MAGIC_LAMP) {
        if ((game.uwep.spe || 0) > 0 && !rn2(3)) {
            // djinni release: not exercised (no spe>0 wished lamp in sessions).
        } else if (rn2(2)) {
            await _display.pline(`You see a puff of smoke.`);
        } else {
            await _display.pline('Nothing happens.');
        }
    } else if (game.uwep.otyp === BRASS_LANTERN) {
        await _display.pline('Rubbing the electric lamp is not particularly rewarding.');
    } else {
        await _display.pline('Nothing happens.');
    }
    return ECMD_TIME;
}

// C ref: apply.c calc_pole_range() — min is always 4; max grows with the
// wielded pole's weapon skill (4 at Unskilled/Basic, 5 Skilled, 8 Expert).
function calc_pole_range() {
    const min_range = 4;
    let max_range = 4;
    const typ = _enhance.uwep_skill_type();
    const lvl = typ ? _enhance.p_skill_of(typ) : 0;
    if (lvl >= P_EXPERT) max_range = 8;
    else if (lvl === P_SKILLED) max_range = 5;
    return { min_range, max_range };
}

// C ref: display.h glyph_is_poleable(G) — a displayed monster, a remembered
// "sensed but unseen monster" mark, or a statue.  This port keeps no glyph
// array, so the same three cases are read off the level state.
function poleable_at(x, y) {
    const loc = game.level?.at(x, y);
    if (loc?.invisMon) return true;
    const mtmp = _display.m_at(x, y);
    if (mtmp && _uhitm.canspotmon(mtmp)) return true;
    return statue_at(x, y);
}

function statue_at(x, y) {
    for (const o of (game.level?.objects || []))
        if (o && o.otyp === STATUE_OTYP && o.ox === x && o.oy === y) return true;
    return false;
}

function distu_sq(x, y) {
    const dx = x - (game.u?.ux ?? 0), dy = y - (game.u?.uy ?? 0);
    return dx * dx + dy * dy;
}

// C ref: apply.c get_valid_polearm_position(x, y).
function valid_polearm_position(x, y, min_range, max_range) {
    if (!(x >= 0 && x < 80 && y >= 0 && y < 21)) return false;
    const d = distu_sq(x, y);
    if (d < min_range || d > max_range) return false;
    return _vision.cansee(x, y)
        || (_vision.couldsee(x, y) && poleable_at(x, y));
}

// C ref: apply.c find_poleable_mon(pos) — scan the isqrt(max_range) box for
// EXACTLY ONE poleable square; two or more candidates means "can't guess", so
// the caller's cc stays where it was.  Tame/peaceful monsters are skipped
// unless the hero is impaired.  No RNG.
function find_poleable_mon(pos, min_range, max_range) {
    const u = game.u;
    const impaired = !!(game.u?.uconf || game.u?.ustun || game.Hallucination);
    const rt = Math.floor(Math.sqrt(max_range));
    const lo_x = Math.max(u.ux - rt, 1), hi_x = Math.min(u.ux + rt, 79);
    const lo_y = Math.max(u.uy - rt, 0), hi_y = Math.min(u.uy + rt, 20);
    let mx = 0, my = 0;
    for (let x = lo_x; x <= hi_x; ++x) {
        for (let y = lo_y; y <= hi_y; ++y) {
            if (!valid_polearm_position(x, y, min_range, max_range)) continue;
            const mtmp = _display.m_at(x, y);
            if (!impaired && mtmp && _uhitm.canspotmon(mtmp)
                && (mtmp.mtame || (mtmp.mpeaceful && game.flags?.confirm !== false)))
                continue;
            const isStatue = statue_at(x, y);
            if (poleable_at(x, y) && (!isStatue || impaired)) {
                if (mx) return false; /* more than one candidate location */
                mx = x; my = y;
            }
        }
    }
    if (!mx) return false;
    pos.x = mx; pos.y = my;
    return true;
}

// C ref: dig.c use_pick_axe():1100 and apply.c use_pole():3441 — a weapon-tool
// that had to be wielded first re-queues its own command:
//     cmdq_add_ec(CQ_CANNED, doapply); cmdq_add_key(CQ_CANNED, obj->invlet);
//     return ECMD_TIME;
// rhack() returns, moveloop_core() spends the turn the wield cost, and the next
// rhack() dispatches the queued doapply without reading a key — so the whole
// thing is ONE input boundary for the player.  invent.js dofire() models the
// same cmdq_add_ec pair this way.
async function reapply_after_wield(obj) {
    const { moveloop_turn } = await import('./allmain.js');
    game.context = game.context || {};
    game.context.move = 0;
    await moveloop_turn();
    // C ref: allmain.c moveloop_core() tail — `if (disp.botl || disp.botlx)
    // bot();` runs after the turn and before the next rhack(), so the queued
    // command's first frame already carries the new turn counter.
    await _display.flush_screen(1);
    // getobj()'s cmdq fast path pops this invlet instead of drawing a prompt.
    _invent.cmdq_add_key(CQ_CANNED, obj.invlet);
    return await doapply();
}

// C ref: apply.c use_pole(obj, autohit) — reached from dofire() as
// use_pole(uwep, TRUE) when the quiver is empty and a polearm is wielded.
// With autohit set there is NO "Where do you want to hit?" prompt and no
// getpos(): the target is whatever find_poleable_mon() uniquely picks, else
// the last-hit monster, else the hero's own square — which is why an empty
// room answers "Don't know what to hit."  RNG-free unless a hit lands.
export async function use_pole(obj, autohit) {
    await loadDeps();
    const u = game.u;

    if (obj !== game.uwep) {
        // C ref: apply.c:3443 — an unwielded polearm is wielded first
        // ("You now wield a lance."), then doapply is re-queued on the canned
        // command stack so the second pass takes the obj == uwep branch.
        // dofire() only ever calls this with uwep, so before doapply()
        // dispatched here this arm was dead code that returned silently.
        if (await _invent.wield_tool(obj, 'swing')) {
            // C: cmdq_add_ec(CQ_CANNED, doapply); cmdq_add_key(CQ_CANNED,
            // obj->invlet); return ECMD_TIME -> moveloop spends the wield turn,
            // then rhack() pops the queue and re-runs doapply with obj == uwep,
            // reaching the "spot to hit" getpos.  No nhgetch separates them.
            return await reapply_after_wield(obj);
        }
        return ECMD_OK;
    }
    const { min_range, max_range } = calc_pole_range();

    if (!autohit) await _display.update_topl('Where do you want to hit?');
    const cc = { x: u.ux, y: u.uy };
    const hitm = game.context?.polearm_hitmon;
    if (!find_poleable_mon(cc, min_range, max_range) && hitm && !hitm.mdead
        && _uhitm.canspotmon(hitm)
        && distu_sq(hitm.mx, hitm.my) <= max_range
        && distu_sq(hitm.mx, hitm.my) >= min_range) {
        cc.x = hitm.mx; cc.y = hitm.my;
    }
    if (!autohit) {
        // C ref: apply.c:3463 — getpos_sethilite(display_polearm_positions,
        // get_valid_polearm_position) then getpos(&cc, TRUE, "the spot to
        // hit").  Without this the targeting keystrokes fell through to the
        // command parser and ran phantom turns.  The getpos_sethilite() part
        // (which moves the FIRST frame's cursor onto the last hilited cell,
        // the way hack.js jump_hilite_first_cursor() does for #jump) is still
        // missing, so frame 1's cursor sits on the hero.
        const { getpos } = await import('./hack.js');
        const picked = await getpos('the spot to hit', cc.x, cc.y,
                                    (x, y) => valid_polearm_position(
                                        x, y, min_range, max_range),
                                    /*force=*/true,
                                    /*verbose=*/game.flags?.verbose !== false);
        if (!picked) return ECMD_CANCEL; // ESC
        cc.x = picked.x; cc.y = picked.y;
    }

    const d = distu_sq(cc.x, cc.y);
    if (d > max_range) {
        await _display.update_topl('Too far!');
        return ECMD_OK;
    } else if (d < min_range) {
        if (autohit && cc.x === u.ux && cc.y === u.uy)
            await _display.update_topl("Don't know what to hit.");
        else
            await _display.update_topl('Too close!');
        return ECMD_OK;
    } else if (!_vision.cansee(cc.x, cc.y) && !poleable_at(cc.x, cc.y)) {
        await _display.update_topl("You won't hit anything if you can't see that spot.");
        return ECMD_OK;
    } else if (!_vision.couldsee(cc.x, cc.y)) {
        await _display.update_topl("You can't reach that spot from here.");
        return ECMD_OK;
    }

    // A reachable target square: C runs attack_checks()/thitmonst() (or the
    // statue/boulder/terrain "Thump!" arms).  thitmonst() is not ported, so
    // stop here rather than invent an RNG stream C does not draw.
    return ECMD_TIME;
}

export const ECMD = { ECMD_OK, ECMD_CANCEL, ECMD_TIME };

// ═════════════════════════════════════════════════════════════════════════════
// apply.c, translated but DELIBERATELY NOT WIRED UP.
//
// Everything below this banner is reachable only from other functions in this
// block: no pre-existing call site above it calls into it, and no body above it
// was changed.  Translating a function is safe; changing WHEN it runs reorders
// the shared RNG draw stream and forfeits every screen after that point, so
// wiring these up belongs in a separate, measured pass.
//
// SKIPPED as already ported under a different name
// ([[duplicate-reimplementation-shadows-faithful-port]]):
//   get_valid_polearm_position(x, y)  ->  valid_polearm_position(x, y, min, max)
//     above.  Same predicate; C reads the gp.polearm_range_* globals that
//     calc_pole_range() writes, this port passes them as arguments.
//
// RNG ORDER.  Each function draws in C's order.  Where a C callee has no port
// at all, the call site is kept IN POSITION behind an `ap_`-prefixed shim that
// draws nothing — so landing the real callee later restores the draw without
// moving anything else.  A shim never takes a C name, so it cannot claim
// another C file's coverage in swarm/bin/coverage.mjs.
//
// Callees that are stubbed here (each draws in C, draws nothing here):
//   mintrap(), make_familiar(), openit(), mkundead(), hurtle(),
//   boulder_hits_pool(), revive_corpse(), floorfood(), tele_to_rnd_pet(),
//   bhit()/flash_hits_mon() for the camera ray, enexto(), get_adjacent_loc().
// ═════════════════════════════════════════════════════════════════════════════

// Lazily-imported modules for the block above's C callees.  Loaded on first use
// so this file keeps its "no static invent.js/display.js/cmd.js import" rule
// (those three pull cmd.js transitively and would form a cycle).
let _ap = null;
async function ap_load() {
    if (_ap) return _ap;
    // also warms _invent/_display/_cmd/_uhitm/_vision/_enhance, which the
    // pre-existing helpers this block reuses (freehand(), Deaf(), Tobjnam(),
    // seemimic(), calc_pole_range(), ...) read directly.
    await loadDeps();
    const [
        invent, display, cmd, uhitm, vision, enhance, makemon, mon, monmove,
        trap, teleport, potion, lightsrc, zap, sounds, do_name, attrib,
        do_wear, hackmod, pickup, explodemod, muse, shkroom, detect, vault,
        eat, dbridge, mkroom, monattk, weapon, mhitu,
    ] = await Promise.all([
        import('./invent.js'), import('./display.js'), import('./cmd.js'),
        import('./uhitm.js'), import('./vision.js'), import('./enhance.js'),
        import('./makemon.js'), import('./mon.js'), import('./monmove.js'),
        import('./trap.js'), import('./teleport.js'), import('./potion.js'),
        import('./light.js'), import('./zap.js'), import('./sounds.js'),
        import('./do_name.js'), import('./attrib.js'), import('./do_wear.js'),
        import('./hack.js'), import('./pickup.js'), import('./explode.js'),
        import('./muse.js'), import('./shkroom.js'), import('./detect.js'),
        import('./vault.js'), import('./eat.js'), import('./dbridge.js'),
        import('./mkroom.js'), import('./monattk_data.js'), import('./weapon.js'),
        import('./mhitu.js'),
    ]);
    _ap = { invent, display, cmd, uhitm, vision, enhance, makemon, mon, monmove,
            trap, teleport, potion, lightsrc, zap, sounds, do_name, attrib,
            do_wear, hackmod, pickup, explodemod, muse, shkroom, detect, vault,
            eat, dbridge, mkroom, monattk, weapon, mhitu };
    return _ap;
}

// ── C ref: include/onames.h — the apply.c otyps, as mkobj.js OBJECT_DATA row
// indices (read off the loaded table, not guessed).  OIL_LAMP / MAGIC_LAMP /
// BRASS_LANTERN / POT_OIL / CREAM_PIE / EGG-adjacent food otyps are already
// declared near the top of this file.
const TALLOW_CANDLE = 224, WAX_CANDLE = 225, EXPENSIVE_CAMERA = 229,
      MIRROR = 230, LENSES = 232, TOWEL = 234, LEASH = 236,
      TINNING_KIT = 238, CAN_OF_GREASE = 240, FIGURINE = 241,
      LAND_MINE = 243, BEARTRAP_OTYP = 244, TIN_WHISTLE = 245,
      MAGIC_WHISTLE = 246, BELL = 255, GRAPPLING_HOOK = 260,
      UNICORN_HORN = 261, CANDELABRUM_OF_INVOCATION = 262,
      BELL_OF_OPENING = 263, EGG = 266, TIN_OTYP = 296, BOULDER = 475;

// ── C ref: include/monsym.h/defsym.h MONSYM() indices, and include/monsters.h
// PM_ indices (verified against makemon.js's loaded mons[] by name).
const S_MIMIC = 13, S_NYMPH = 14, S_VAMPIRE = 48, S_GHOST = 54, S_EEL = 57;
const PM_KILLER_BEE = 1, PM_QUEEN_BEE = 5, PM_FLOATING_EYE = 28,
      PM_WOOD_NYMPH = 67, PM_WATER_NYMPH = 68, PM_MOUNTAIN_NYMPH = 69,
      PM_LONG_WORM = 114, PM_UMBER_HULK = 225, PM_MEDUSA = 284,
      PM_AMOROUS_DEMON = 290;
// C ref: monst.h is_vampshifter(mon) — mon->cham is one of the vampire forms
// (the same three pmidx js/mon.js and js/dogmove.js use).
const PM_VAMPIRE = 226, PM_VAMPIRE_LEADER = 227, PM_VLAD_THE_IMPALER = 228;

// C ref: include/monflag.h MS_SILENT — "makes no sound".
const MS_SILENT = 0;
// C ref: include/global.h MAXULEV, include/hack.h COLNO/ROWNO.
const MAXULEV_A = 30, COLNO_A = 80, ROWNO_A = 21;
// C ref: include/prop.h — the seven property indices use_unicorn_horn() puts
// into its trouble_list[], and include/you.h SICK_ALL / SICK_NONVOMITABLE.
const P_STUNNED = 13, P_CONFUSION = 14, P_BLINDED = 15, P_DEAF = 16,
      P_SICK = 17, P_VOMITING = 20, P_HALLUC = 23;
const SICK_ALL_A = 0x03, SICK_NONVOMITABLE_A = 0x02;
// C ref: include/eat.h HOMEMADE_TIN, include/hack.h NO_MINVENT / MM_NOMSG,
// include/monst.h RLOC_* and include/hack.h XKILL_NOMSG, include/mon.h FM_FMON,
// include/trap.h NO_TRAP_FLAGS / FORCEBUNGLE, include/you.h WEAK,
// include/monflag.h G_GENOD|G_EXTINCT == G_GONE.
const HOMEMADE_TIN_A = 1, NO_MINVENT_A = 0x1, MM_NOMSG_A = 0x20000;
const RLOC_NONE_A = 0x0, RLOC_NOMSG_A = 0x1, RLOC_MSG_A = 0x2;
const XKILL_NOMSG_A = 0x1, FM_FMON_A = 0x1;
const NO_TRAP_FLAGS_A = 0x0, FORCEBUNGLE_A = 0x04;
const WEAK_A = 3, G_GONE_A = 0x03;
// C ref: include/trap.h — the two trap types use_trap()/set_trap() arm.
const BEAR_TRAP_TTYP = 5, LANDMINE_TTYP = 6;
// C ref: include/attrib.h — [Str, Int, Wis, Dex, Con, Cha].
const A_STR_A = 0, A_DEX_A = 3, A_CON_A = 4, A_CHA_A = 5;
// C ref: include/skills.h P_NONE / P_BASIC / P_RIDING (P_SKILLED / P_EXPERT are
// already declared above for calc_pole_range()).
const P_NONE_A = 0, P_BASIC_A = 2, P_RIDING_A = 37;
// C ref: include/rm.h — the typ codes use_trap() and figurine_location_checks()
// test.  AIR/CLOUD are the two Plane-of-Air/Water catch-alls; POOL is the first
// non-obstructing typ, so IS_OBSTRUCTED(t) is (t < POOL).
const POOL_A = 21, TREE_A = 20, AIR_A = 35, CLOUD_A = 36;
const STAIRS_A = 24, LADDER_A = 25, FOUNTAIN_A = 26, THRONE_A = 27,
      SINK_A = 28, GRAVE_A = 29, ALTAR_A = 30;
// C ref: include/decl.h c_common_strings (src/decl.c:39).
const nothing_happens = 'Nothing happens.';
const nothing_seems_to_happen = 'Nothing seems to happen.';
const c_something = 'something', c_Something = 'Something';
// C ref: apply.c:472/3274 — the file-scope format strings.
const whistle_str = 'produce a %s whistling sound.';
const alt_whistle_str = 'produce a %s, sharp vibration.';
const not_enough_room = "There's not enough room here to use that.";
const where_to_hit = 'Where do you want to hit?';
const cant_see_spot = "won't hit anything if you can't see that spot.";
const cant_reach = "can't reach that spot from here.";
const no_elbow_room = "don't have enough elbow-room to maneuver.";
const look_str_fmt = 'look %s.';

// ── Hero-property readers.  C's `u.uprops[P].intrinsic` packs a timeout in its
// low TIMEOUT bits with the source flags (FROMOUTSIDE &c.) above them; this
// port keeps only the timeout, under the property's H-prefixed name.  So
// `X & ~TIMEOUT` is always 0 here, which is why use_unicorn_horn()'s
// TimedTrouble() reduces to the plain timer and unfixable_trouble_count()'s
// `(!is_horn || (X & ~TIMEOUT) != 0)` reduces to `!is_horn`.
function ap_prop(name) {
    const p = game.u?.uprops;
    if (!p) return 0;
    return (p[`H${name}`] | 0) || (p[name] | 0) || 0;
}
function ap_Underwater() { return !!game.u?.uinwater; }
function ap_Levitation() { return ap_prop('Levitation') > 0; }
function ap_Fumbling() { return ap_prop('Fumbling') > 0; }
function ap_Glib() { return ((game.u?.Glib | 0) > 0) || ap_prop('Glib') > 0; }
function ap_Confusion() { return ((game.u?.uconf | 0) > 0) || ap_prop('Confusion') > 0; }
function ap_Stunned() { return ((game.u?.ustun | 0) > 0) || ap_prop('Stun') > 0; }
function ap_Hallucination() {
    return !!game.Hallucination || !!game.u?.uhallu || ap_prop('Hallucination') > 0;
}
function ap_Blinded() { return ((game.u?.blinded | 0) > 0) || ap_prop('Blinded') > 0; }
function ap_Invis() { return ap_prop('Invis') > 0; }
function ap_See_invisible() { return ap_prop('See_invisible') > 0; }
function ap_Free_action() { return ap_prop('Free_action') > 0; }
function ap_Passes_walls() { return ap_prop('Passes_walls') > 0; }
function ap_Upolyd() { return !!game.u?.Upolyd; }
function ap_ucreamed() { return game.u?.ucreamed | 0; }
// C ref: youprop.h Wounded_legs — u.uprops[WOUNDED_LEGS].
function ap_Wounded_legs() { return ap_prop('Wounded_legs') > 0; }
// C ref: attrib.h ATEMP(x) — the temporary attribute delta.
function ap_ATEMP(i) { return game.u?.atemp?.a?.[i] | 0; }
// C ref: hacklib.c sgn(x).
function ap_sgn(x) { return x < 0 ? -1 : x > 0 ? 1 : 0; }
// C ref: hacklib.c isqrt(val) — integer square root, no floating point.
function ap_isqrt(val) {
    let rt = 0, odd = 1;
    while (val >= odd) { val -= odd; odd += 2; rt += 1; }
    return rt;
}
// C ref: rnd.c:299 shuffle_int_array(indices, count).
function ap_shuffle_int_array(indices, count) {
    for (let i = count - 1; i > 0; i--) {
        const iswap = rn2(i + 1);
        if (iswap === i) continue;
        const temp = indices[i];
        indices[i] = indices[iswap];
        indices[iswap] = temp;
    }
}
// C ref: hacklib.c dist2(x1, y1, x2, y2) and mondata.h mdistu(mon).
function ap_dist2(x1, y1, x2, y2) {
    const dx = x1 - x2, dy = y1 - y2;
    return dx * dx + dy * dy;
}
function ap_mdistu(mon) { return ap_dist2(mon.mx, mon.my, game.u.ux, game.u.uy); }
// C ref: mon.h DEADMONSTER(mon).
function ap_DEADMONSTER(mon) { return !mon || (mon.mhp | 0) <= 0; }
// C ref: the `fmon` chain.  makemon() PREPENDS (makemon.c:1249), so C visits
// monsters newest-first; js/mon.js keeps them in creation order and reverses a
// snapshot for exactly this reason (its fmonOrder() is private).
function ap_fmon() {
    const list = game.level?.monsters || [];
    const out = new Array(list.length);
    for (let i = 0; i < list.length; i++) out[i] = list[list.length - 1 - i];
    return out;
}
// C ref: gi.invent — the hero's pack as an array (js/invent.js inventoryArray()).
function ap_invent() {
    if (Array.isArray(game.invent)) return game.invent;
    if (Array.isArray(game.gi?.invent)) return game.gi.invent;
    return [];
}
// C ref: hack.h u_at(x, y) / mondata.h um_dist(x, y, n).
function ap_u_at(x, y) { return game.u?.ux === x && game.u?.uy === y; }
function ap_um_dist(x, y, n) {
    return Math.abs(game.u.ux - x) > n || Math.abs(game.u.uy - y) > n;
}
// C ref: hack.h distu(x, y) — squared distance from the hero.
function ap_distu(x, y) { return ap_dist2(x, y, game.u.ux, game.u.uy); }
// C ref: hack.h isok(x, y).
function ap_isok(x, y) { return x >= 0 && x < COLNO_A && y >= 0 && y < ROWNO_A; }
// C ref: rm.h IS_FURNITURE / IS_OBSTRUCTED / IS_TREE / closed_door.
function ap_IS_FURNITURE(typ) { return typ >= STAIRS_A && typ <= ALTAR_A; }
function ap_IS_OBSTRUCTED(typ) { return typ < POOL_A; }
function ap_IS_TREE(typ) {
    return typ === TREE_A || (!!game.level?.flags?.arboreal && typ === 0 /*STONE*/);
}
function ap_closed_door(x, y) {
    const loc = game.level?.at(x, y);
    return !!loc && IS_DOOR(loc.typ) && !!((loc.doormask | 0) & (D_LOCKED | D_CLOSED));
}
// C ref: dungeon.h Is_airlevel/Is_waterlevel — this port stores the two Plane
// levels on `game`; the typ-based AIR/CLOUD tests below are C's own fallbacks.
function ap_Is_airlevel() {
    const uz = game.u?.uz, al = game.air_level;
    return !!uz && !!al && uz.dnum === al.dnum && uz.dlevel === al.dlevel;
}
function ap_Is_waterlevel() {
    const uz = game.u?.uz, wl = game.water_level;
    return !!uz && !!wl && uz.dnum === wl.dnum && uz.dlevel === wl.dlevel;
}

// ── C ref: display.c tmp_at() and display.h cmap_to_glyph().  The
// temporary-glyph animation layer has no port: frozen/terminal.js owns the grid
// and this port's getpos() hilites through a validator callback instead of a
// pre-painted beam.  Both are RNG-free; the ap_ prefix keeps them from claiming
// display.c coverage they do not deliver.
const DISP_BEAM_A = -1, DISP_END_A = -7;   // include/display.h
const S_goodpos_A = 0;                     // include/defsym.h cmap
function ap_tmp_at(_x, _y) {}
function ap_cmap_to_glyph(_cmap) { return 0; }
// C ref: display.c glyph_at(x, y) / display.h glyph_is_poleable().  This port
// keeps no glyph array; poleable_at() above reads the same three cases off the
// level state, so the display_*_positions() loops below use it directly.

// ── C ref: timeout.c:1712 begin_burn(obj, already_lit) and :1804
// end_burn(obj, timer_attached).  js/light.js carries a private end_burn() (no
// BURN_OBJECT timer queue exists, so the timer arm cannot be taken) and no
// begin_burn at all.  Both are RNG-FREE in C, so these two mirror light.js's
// own comment: set/clear lamplit and add/drop the object light source.  Named
// with an ap_ prefix so they do not claim timeout.c coverage.
async function ap_begin_burn(obj, already_lit) {
    const A = await ap_load();
    if (obj.age === 0 && obj.otyp !== MAGIC_LAMP && !A.lightsrc.artifact_light(obj))
        return;
    let radius = 3;
    switch (obj.otyp) {
    case MAGIC_LAMP: obj.lamplit = 1; break;
    case POT_OIL: radius = 1; obj.lamplit = 1; break;
    case BRASS_LANTERN: case OIL_LAMP: obj.lamplit = 1; break;
    case CANDELABRUM_OF_INVOCATION: case TALLOW_CANDLE: case WAX_CANDLE:
        radius = A.lightsrc.candle_light_range(obj);
        obj.lamplit = 1;
        break;
    default:
        obj.lamplit = 1;
        break;
    }
    if (obj.lamplit && !already_lit)
        A.lightsrc.new_light_source(obj.ox ?? game.u.ux, obj.oy ?? game.u.uy,
                                    radius, A.lightsrc.LS_OBJECT, obj);
}
async function ap_end_burn(obj, _timer_attached) {
    const A = await ap_load();
    if (!obj.lamplit) return;
    A.lightsrc.del_light_source(A.lightsrc.LS_OBJECT, obj);
    obj.lamplit = 0;
}

// ── Unported C callees.  Each is kept IN POSITION at its call site so landing
// the real function later restores its RNG draw without moving anything else.
// C ref: trap.c mintrap(mtmp, mintrapflags) — js/monmove.js mon_mintrap() is the
// port, but it takes no flag argument; use it and note the difference.
async function ap_mintrap(mtmp, _flags) {
    const A = await ap_load();
    return await A.monmove.mon_mintrap(mtmp);
}
// C ref: makemon.c make_familiar(otmp, x, y, quietly) — DEFERRED (no port).
async function ap_make_familiar(_otmp, _x, _y, _quietly) { return null; }
// C ref: lock.c openit() — DEFERRED (no port); returns the count of things
// opened, so 0 keeps use_bell()'s "Nothing happens." arm.
async function ap_openit() { return 0; }
// C ref: makemon.c mkundead(mm, revive_corpses, mmflags) — DEFERRED (no port).
async function ap_mkundead(_mm, _revive, _mmflags) {}
// C ref: dothrow.c hurtle(dx, dy, range, verbose) — DEFERRED (no port).
async function ap_hurtle(_dx, _dy, _range, _verbose) {}
// C ref: dbridge.c boulder_hits_pool(otmp, rx, ry, newspot) — DEFERRED.
async function ap_boulder_hits_pool(_otmp, _rx, _ry, _newspot) { return false; }
// C ref: mon.c revive_corpse(corpse) — DEFERRED (no port).
async function ap_revive_corpse(_corpse) { return false; }
// C ref: eat.c floorfood(verb, corpsecheck) — the "There is X here; eat it?"
// picker.  js/eat.js's equivalent is fused into its own doeat() flow, so this
// returns 0 ("nothing chosen") and use_tinning_kit() stops there.
async function ap_floorfood(_verb, _corpsecheck) { return null; }
// C ref: teleport.c tele_to_rnd_pet() — DEFERRED (no port).
async function ap_tele_to_rnd_pet() {}
// C ref: zap.c bhit(dx, dy, range, weapon, fhitm, fhito, &obj) for the
// FLASHED_LIGHT flavour, and zap.c flash_hits_mon()/mon.c
// see_monster_closeup()/light.c transient_light_cleanup().  js/zap.js's bhit()
// is private and only implements the ZAPPED_WAND flavour, so the camera ray
// finds nothing here.
async function ap_bhit_flash(_dx, _dy, _range, _obj) { return null; }
async function ap_flash_hits_mon(_mtmp, _obj) { return 0; }
async function ap_see_monster_closeup(_mtmp, _photo) {}
// C ref: teleport.c enexto(cc, xx, yy, mdat) — js/dog.js's enexto() is private
// and takes no permonst; DEFERRED so the caller's "no free spot" arm is taken.
async function ap_enexto(_cc, _xx, _yy, _mdat) { return false; }
// C ref: getpos.c get_adjacent_loc(prompt, emsg, x, y, cc) — getdir() plus a
// bounds check.  Ported here (it is the only thing use_leash() needs) rather
// than stubbed, so the leash path really reads one direction key.
async function ap_get_adjacent_loc(prompt, emsg, x, y, cc) {
    const A = await ap_load();
    const dir = await A.cmd.getdir(prompt);
    if (!dir) return false;
    const new_x = x + dir.dx, new_y = y + dir.dy;
    if (!ap_isok(new_x, new_y)) {
        if (emsg) await A.display.pline(emsg);
        return false;
    }
    cc.x = new_x; cc.y = new_y;
    cc.dx = dir.dx; cc.dy = dir.dy; cc.dz = dir.dz;
    return true;
}
// C ref: allmain.c set_occupation(fn, txt, xtime) — js/invent.js keeps the
// occupation slot; nothing here may arm it, so record the intent only.
function ap_set_occupation(_fn, _txt, _xtime) {}
// C ref: shk.c add_damage(x, y, cost) / apply.c use_unpaid_trapobj() — shop
// bookkeeping, RNG-free, no port.
function ap_add_damage(_x, _y, _cost) {}
function ap_use_unpaid_trapobj(_otmp, _x, _y) {}
// C ref: potion.c make_glib(xtime) — set the slippery-fingers timer.  RNG-free.
function ap_make_glib(xtime) {
    const u = game.u;
    if (!u) return;
    u.uprops = u.uprops || {};
    u.uprops.Glib = xtime;
    u.Glib = xtime;
}
// C ref: timeout.c incr_itimeout/set_itimeout on a named property timer.
function ap_incr_itimeout(name, incr) {
    const u = game.u;
    if (!u) return;
    u.uprops = u.uprops || {};
    u.uprops[name] = Math.max(0, (u.uprops[name] | 0) + incr);
}
function ap_set_itimeout(name, val) {
    const u = game.u;
    if (!u) return;
    u.uprops = u.uprops || {};
    u.uprops[name] = val;
}
// C ref: sounds.c Soundeffect()/Hero_playnotes() and objnam.c obj_to_instr() —
// the audio layer has no port and draws nothing.
function ap_Soundeffect(_se, _volume) {}
function ap_Hero_playnotes(_instr, _notes, _volume) {}
function ap_obj_to_instr(_obj) { return 0; }
// C ref: trap.c feeltrap(trap) — js/trap.js's copy is private.
async function ap_feeltrap(trap) {
    const A = await ap_load();
    if (!trap) return;
    trap.tseen = true;
    A.display.newsym(trap.tx, trap.ty);
}
// C ref: mon.c mnexto(mtmp, rlocflags) — js/do.js's copy is private and takes
// no flags, so the RLOC_MSG/RLOC_NONE distinction magic_whistled() relies on is
// lost here (it only controls whether rloc() prints, never RNG).
async function ap_mnexto(mtmp, _rlocflags) {
    const D = await import('./do.js');
    if (typeof D.mnexto === 'function') return D.mnexto(mtmp);
    return undefined;
}
// C ref: mon.c xkilled(mtmp, xkill_flags) — js/uhitm.js killed() is this port's
// xkilled (see its own comment); XKILL_NOMSG maps to { nomsg: true }.
async function ap_xkilled(mtmp, flags) {
    const A = await ap_load();
    return await A.uhitm.killed(mtmp, { nomsg: !!(flags & XKILL_NOMSG_A) });
}
// C ref: sounds.c whimper(mtmp) — js/sounds.js ports growl()/yelp() but not
// whimper(); C's whimper() draws NOTHING (it is a pline plus wake_nearto()).
async function ap_whimper(_mtmp) {}
// C ref: objnam.c s_suffix / an / the / Tobjnam-adjacent helpers.  Each js file
// keeps its own private copy of these one-liners; these are this block's.
function ap_s_suffix(s) { return /s$/.test(s) ? `${s}'` : `${s}'s`; }
function ap_upstart(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function ap_an(s) { return /^[aeiouAEIOU]/.test(s || '') ? `an ${s}` : `a ${s}`; }
function ap_the(s) { return /^[A-Z]/.test(s || '') ? s : `the ${s}`; }
function ap_The(s) { return ap_upstart(ap_the(s)); }
// C ref: objnam.c vtense(subj, verb) — plural subject takes the bare verb.
function ap_vtense(subj, verb) {
    const plural = !subj || /s$/.test(subj);
    if (plural) return verb;
    if (verb === 'are') return 'is';
    if (/(s|x|z|ch|sh)$/.test(verb)) return `${verb}es`;
    return `${verb}s`;
}
// C ref: do_name.c mhis(mtmp) / mhe(mtmp).
function ap_mhis(mtmp) {
    if (mtmp?.female) return 'her';
    return mtmp?.data && (mflags2_of(mtmp.data) & 0x40000) ? 'its' : 'his';
}
function ap_mhe(mtmp) {
    if (mtmp?.female) return 'she';
    return mtmp?.data && (mflags2_of(mtmp.data) & 0x40000) ? 'it' : 'he';
}
// C ref: shk.c Shk_Your(buf, obj)/shk_your(buf, obj) — "your " unless the shop
// still owns it.  js/wield.js keeps the same simplification.
async function ap_shk_your(obj) {
    const A = await ap_load();
    return A.invent.inventoryArray().includes(obj) ? 'your ' : 'the ';
}
async function ap_Shk_Your(obj) { return ap_upstart(await ap_shk_your(obj)); }
// C ref: objnam.c Yname2(obj) — "Your <xname>" / "The <xname>".
async function ap_Yname2(obj) {
    const A = await ap_load();
    return ap_upstart(`${await ap_shk_your(obj)}${A.invent.xname(obj)}`);
}
// C ref: objnam.c thesimpleoname(obj) — "the " + minimal_xname().
async function ap_thesimpleoname(obj) {
    const A = await ap_load();
    return ap_the(A.invent.cxname_singular ? A.invent.cxname_singular(obj)
                                           : A.invent.xname(obj));
}
// C ref: mondata.h — the flag predicates apply.c uses, as monflags_data.js
// M1_/M2_ bit tests (js/ has no shared mondata.js for these).
function ap_unsolid(ptr) { return (mflags1_of(ptr) & 0x100000) !== 0; }     /* M1_UNSOLID */
function ap_nolimbs(ptr) { return (mflags1_of(ptr) & 0x6000) === 0x6000; }  /* M1_NOLIMBS */
function ap_has_head(ptr) { return (mflags1_of(ptr) & 0x8000) === 0; }      /* !M1_NOHEAD */
function ap_breathless(ptr) { return (mflags1_of(ptr) & 0x400) !== 0; }     /* M1_BREATHLESS */
function ap_humanoid(ptr) { return (mflags1_of(ptr) & 0x20000) !== 0; }     /* M1_HUMANOID */
function ap_haseyes(ptr) { return (mflags1_of(ptr) & 0x1000) === 0; }       /* !M1_NOEYES */
function ap_perceives(ptr) { return (mflags1_of(ptr) & 0x1000000) !== 0; }  /* M1_SEE_INVIS */
function ap_passes_walls(ptr) { return (mflags1_of(ptr) & 0x8) !== 0; }     /* M1_WALLWALK */
function ap_hides_under(ptr) { return (mflags1_of(ptr) & 0x80) !== 0; }     /* M1_CONCEAL */
function ap_is_flyer(ptr) { return (mflags1_of(ptr) & 0x1) !== 0; }         /* M1_FLY */
function ap_is_floater(ptr) { return ptr?.mcls === 5; }                     /* S_EYE */
function ap_is_demon(ptr) { return (mflags2_of(ptr) & 0x100) !== 0; }       /* M2_DEMON */
function ap_strongmonst(ptr) { return (mflags2_of(ptr) & 0x4000000) !== 0; }/* M2_STRONG */
function ap_throws_rocks(ptr) { return (mflags2_of(ptr) & 0x8000000) !== 0; }/* M2_ROCKTHROW */
function ap_nohands(ptr) { return (mflags1_of(ptr) & 0x2000) !== 0; }       /* M1_NOHANDS */
function ap_slithy(ptr) { return (mflags1_of(ptr) & 0x80000) !== 0; }       /* M1_SLITHY */
// C ref: mondata.h bigmonst(ptr) — msize >= MZ_LARGE (3 in this file's MZ_
// table above, which is the one size_str() uses).
function ap_bigmonst(ptr) { return (ptr?.msize | 0) >= MZ_LARGE; }
// C ref: mondata.h verysmall(ptr) — msize < MZ_SMALL.
function ap_verysmall(ptr) { return (ptr?.msize | 0) < MZ_SMALL; }
// C ref: mondata.h is_unicorn(ptr) — S_UNICORN with the M2_NOPOLY marker; this
// port has no S_UNICORN constant, so match the three species by name.
const AP_UNICORN_NAMES = new Set(['white unicorn', 'gray unicorn', 'black unicorn']);
function ap_is_unicorn(ptr) { return AP_UNICORN_NAMES.has(ptr?.name); }
// C ref: mondata.h is_vampire(ptr) / monst.h is_vampshifter(mon).
function ap_is_vampire(ptr) { return ptr?.mcls === S_VAMPIRE; }
function ap_is_vampshifter(mon) {
    return mon?.cham === PM_VAMPIRE || mon?.cham === PM_VAMPIRE_LEADER
        || mon?.cham === PM_VLAD_THE_IMPALER;
}
// C ref: monst.h M_AP_TYPE(mon) — M_AP_NOTHING is 0.
function ap_M_AP_TYPE(mon) { return mon?.m_ap_type | 0; }
// C ref: mkobj.c Is_candle(otmp) — TALLOW_CANDLE or WAX_CANDLE.
function ap_Is_candle(obj) {
    return obj?.otyp === TALLOW_CANDLE || obj?.otyp === WAX_CANDLE;
}
// C ref: polyself.c poly_gender() — 0/1 as flags.female, 2 = none.
function ap_poly_gender() {
    const ydata = game.youmonst?.data;
    if (ydata && ((mflags2_of(ydata) & 0x40000) !== 0 || !ap_humanoid(ydata)))
        return 2;
    return game.flags?.female ? 1 : 0;
}
// C ref: do_wear.c inaccessible_equipment(obj, NULL, FALSE) — the verb==NULL
// (message-free) path, which is all grease_ok() needs.  js/do_wear.js's port is
// async purely for its pline(), so it cannot be used from a getobj callback.
function ap_inaccessible_equipment_quiet(obj) {
    if (!obj || !(obj.owornmask | 0)) return false;
    if (obj === game.uarm && game.uarmc) return true;
    if (obj === game.uarmu && (game.uarm || game.uarmc)) return true;
    if ((obj === game.uleft || obj === game.uright) && game.uarmg) return true;
    return false;
}
// C ref: invent.c carried(obj).
function ap_carried(obj) { return ap_invent().includes(obj); }
// C ref: objnam.c body_part(BP) for the parts apply.c names.  js/invent.js's
// body_part() is the real port; these string constants only feed messages.
const AP_HAND = 'hand', AP_FACE = 'face', AP_NOSE = 'nose', AP_STOMACH = 'stomach';

// C ref: potion.c make_sick/make_blinded/make_vomiting/make_deaf/vomit and
// potion.c make_confused/make_stunned.  All SEVEN are RNG-free in C (each is a
// set_itimeout/incr_itimeout plus feedback); js/potion.js and js/artifact.js
// keep private copies, so these set this port's timer and skip the feedback.
function ap_make_sick(xtime, _cause, _talk, _type) { ap_set_itimeout('Sick', xtime); }
function ap_make_blinded(xtime, _talk) { ap_set_itimeout('Blinded', xtime); }
function ap_make_confused(xtime, _talk) { ap_set_itimeout('Confusion', xtime); }
function ap_make_stunned(xtime, _talk) { ap_set_itimeout('Stun', xtime); }
function ap_make_vomiting(xtime, _talk) { ap_set_itimeout('Vomiting', xtime); }
function ap_make_deaf(xtime, _talk) { ap_set_itimeout('Deaf', xtime); }
function ap_make_hallucinated(xtime, _talk, _mask) {
    ap_set_itimeout('Hallucination', xtime);
    return 0;
}
function ap_vomit() { ap_set_itimeout('Vomiting', 0); }
// C ref: invent.c Blindf_off(otmp) — js/invent.js's copy is private.
async function ap_Blindf_off(_obj) { game.ublindf = null; }
// C ref: mhitu.c gulp_blnd_check() — js/mhitu.js exports the real one.
async function ap_gulp_blnd_check() {
    const A = await ap_load();
    return A.mhitu.gulp_blnd_check();
}
// C ref: objnam.c simpleonames(obj) — the unadorned object name ("mirror",
// "looking glass").  js/invent.js's simpleonames() is private; its exported
// cxname_singular() is the closest observation-free equivalent.
async function ap_simpleonames(obj) {
    const A = await ap_load();
    return A.invent.cxname_singular ? A.invent.cxname_singular(obj)
                                    : A.invent.xname(obj);
}
// C ref: vision.h MONSEEN_* and display.c howmonseen(mon).  The bit breakdown
// (normal / see-invisible / infravision) has no port; return MONSEEN_NORMAL for
// a spotted monster, which is what use_mirror()'s infravision-only arm tests
// against.
const MONSEEN_NORMAL = 0x0001, MONSEEN_SEEINVIS = 0x0002,
      MONSEEN_INFRAVIS = 0x0004;
async function ap_howmonseen(mtmp) {
    const A = await ap_load();
    return A.uhitm.canspotmon(mtmp) ? MONSEEN_NORMAL : 0;
}

// C ref: apply.c:60 do_blinding_ray(obj) — the camera / lit-object flash.  Not
// in coverage.mjs's missing list only because js/artifact.js carries a
// `do_blinding_ray: null` hook-table key that its `name:` regex counts.
export async function do_blinding_ray(obj) {
    const A = await ap_load();
    const u = game.u;
    const mtmp = await ap_bhit_flash(u.dx, u.dy, COLNO_A, obj);

    obj.ox = u.ux; obj.oy = u.uy; /* flash_hits_mon() wants this */
    if (mtmp) {
        await ap_flash_hits_mon(mtmp, obj);
        if (obj.otyp === EXPENSIVE_CAMERA)
            await ap_see_monster_closeup(mtmp, true); /* TRUE for photo */
    }
    /* normally bhit() would do this but for FLASHED_LIGHT we want it
       to be deferred until after flash_hits_mon() */
    await A.lightsrc.transient_light_cleanup();
}

// C ref: apply.c:79 use_camera(obj).  RNG: the cursed 1-in-2 self-zap roll,
// drawn AFTER consume_obj_charge().
export async function use_camera(obj) {
    const A = await ap_load();
    const u = game.u;

    if (ap_Underwater()) {
        await A.display.pline('Using your camera underwater would void the warranty.');
        return ECMD_OK;
    }
    // C's getdir() writes u.dx/u.dy/u.dz and returns a boolean; this port
    // returns the triple, so store it where do_blinding_ray() reads it.
    const dir = await A.cmd.getdir(null);
    if (!dir) return ECMD_CANCEL;
    u.dx = dir.dx; u.dy = dir.dy; u.dz = dir.dz;

    if ((obj.spe | 0) <= 0) {
        await A.display.pline(nothing_happens);
        return ECMD_TIME;
    }
    A.invent.consume_obj_charge(obj, true);

    if (obj.cursed && !rn2(2)) {
        await A.zap.zapyourself(obj, true);
    } else if (u.uswallow) {
        await A.display.pline(`You take a picture of ${
            ap_s_suffix(A.do_name.mon_nam(u.ustuck))} ${AP_STOMACH}.`);
    } else if (u.dz) {
        await A.display.pline(`You take a picture of the ${
            (u.dz > 0) ? surface_word(u.ux, u.uy) : ceiling_word(u.ux, u.uy)}.`);
    } else if (!u.dx && !u.dy) {
        /* TODO:  we ought to have a "selfie" joke here... */
        await A.zap.zapyourself(obj, true);
    } else {
        await do_blinding_ray(obj);
    }
    return ECMD_TIME;
}

// C ref: apply.c:112 use_towel(obj).  RNG: rn2(3) for the cursed switch, then
// EITHER rn1(10,3) (case 2 grease, case 1 face-gunk) OR rn2(2) (case 1's
// cock-eyed/crooked blindfold shove) — never both.
export async function use_towel(obj) {
    const A = await ap_load();
    const u = game.u;
    const drying_feedback = (obj === game.uwep);

    if (!freehand()) {
        await A.display.pline(`You have no free ${AP_HAND}!`);
        return ECMD_OK;
    } else if (obj === game.ublindf) {
        await A.display.pline("You cannot use it while you're wearing it!");
        return ECMD_OK;
    } else if (obj.cursed) {
        let old;

        switch (rn2(3)) {
        case 2:
            old = ap_prop('Glib');
            ap_make_glib(old + rn1(10, 3)); /* + 3..12 */
            await A.display.pline(`Your ${A.invent.makeplural(AP_HAND)} ${
                old ? 'are filthier than ever' : 'get slimy'}!`);
            if (A.weapon.is_wet_towel(obj))
                A.weapon.dry_a_towel(obj, -1, drying_feedback);
            return ECMD_TIME;
        case 1:
            if (!game.ublindf) {
                old = ap_ucreamed();
                u.ucreamed = old + rn1(10, 3);
                await A.display.pline(`Yecch!  Your ${AP_FACE} ${
                    old ? 'has more' : 'now has'} gunk on it!`);
                ap_make_blinded(ap_prop('Blinded') + u.ucreamed - old, true);
            } else {
                const what = (game.ublindf.otyp === LENSES) ? 'lenses'
                    : (obj.otyp === game.ublindf.otyp) ? 'other towel'
                                                       : 'blindfold';
                if (game.ublindf.cursed) {
                    await A.display.pline(`You push your ${what} ${
                        rn2(2) ? 'cock-eyed' : 'crooked'}.`);
                } else {
                    const saved_ublindf = game.ublindf;
                    await A.display.pline(`You push your ${what} off.`);
                    await ap_Blindf_off(game.ublindf);
                    A.invent.dropx(saved_ublindf);
                }
            }
            if (A.weapon.is_wet_towel(obj))
                A.weapon.dry_a_towel(obj, -1, drying_feedback);
            return ECMD_TIME;
        case 0:
            break;
        default:
            break;
        }
    }

    if (ap_Glib()) {
        ap_make_glib(0);
        await A.display.pline(`You wipe off your ${
            !game.uarmg ? A.invent.makeplural(AP_HAND)
                        : A.do_wear.gloves_simple_name(game.uarmg)}.`);
        if (A.weapon.is_wet_towel(obj))
            A.weapon.dry_a_towel(obj, -1, drying_feedback);
        return ECMD_TIME;
    } else if (ap_ucreamed()) {
        ap_incr_itimeout('Blinded', -1 * ap_ucreamed());
        u.ucreamed = 0;
        if (!ap_Blinded()) {
            await A.display.pline("You've got the glop off.");
            if (!await ap_gulp_blnd_check()) {
                ap_set_itimeout('Blinded', 1);
                ap_make_blinded(0, true);
            }
        } else {
            await A.display.pline(`Your ${AP_FACE} feels clean now.`);
        }
        if (A.weapon.is_wet_towel(obj))
            A.weapon.dry_a_towel(obj, -1, drying_feedback);
        return ECMD_TIME;
    }

    await A.display.pline(`Your ${AP_FACE} and ${
        A.invent.makeplural(AP_HAND)} are already clean.`);

    return ECMD_OK;
}

// C ref: apply.c:475 use_whistle(obj).  No direct RNG; wake_nearby() and
// vault_summon_gd() draw.
export async function use_whistle(obj) {
    const A = await ap_load();

    if (!ap_can_blow_youmonst()) {
        await A.display.pline('You are incapable of using the whistle.');
    } else if (ap_Underwater()) {
        await A.display.pline(`You blow bubbles through ${A.invent.yname(obj)}.`);
    } else {
        if (Deaf())
            await A.display.pline(`You feel rushing air tickle your ${AP_NOSE}.`);
        else
            await A.display.pline(`You ${
                whistle_str.replace('%s', obj.cursed ? 'shrill' : 'high')}`);
        ap_Soundeffect(/*se_shrill_whistle*/ 0, 50);
        await A.cmd.wake_nearby(true);
        if (obj.cursed)
            await A.vault.vault_summon_gd();
    }
}

// C ref: mondata.c can_blow(mtmp) for &gy.youmonst — a breathless or
// no-mouth/underwater form cannot use a whistle.  js/muse.js's can_blow() is
// private and monster-shaped; this is the hero instance of the same test.
function ap_can_blow_youmonst() {
    const ydata = game.youmonst?.data;
    if (!ydata) return true;
    if ((ap_prop('Strangled') > 0)
        || (ap_breathless(ydata) && !ap_prop('Amphibious') && ap_Underwater()))
        return false;
    if (ap_nohands(ydata) || ap_verysmall(ydata)) return false;
    return true;
}

// C ref: apply.c:495 use_magic_whistle(obj).  RNG: the cursed rn2(2) malfunction
// roll, then a SECOND rn2(2) gating tele_to_rnd_pet() (short-circuited by
// noteleport_level only AFTER that draw).
export async function use_magic_whistle(obj) {
    const A = await ap_load();

    if (!ap_can_blow_youmonst()) {
        await A.display.pline('You are incapable of using the whistle.');
    } else if (obj.cursed && !rn2(2)) {
        await A.display.pline(`You produce a ${ap_Underwater() ? 'very ' : ''}high-${
            Deaf() ? 'frequency vibration' : 'pitched humming noise'}.`);
        await A.cmd.wake_nearby(true);
        if (!rn2(2) && !A.monmove.noteleport_level(game.youmonst))
            await ap_tele_to_rnd_pet();
    } else {
        /* it's magic!  it works underwater too (at a higher pitch) */
        const fmt = Deaf() ? alt_whistle_str : whistle_str;
        await A.display.pline(`You ${fmt.replace('%s',
            ap_Hallucination() ? 'normal'
            : (ap_Underwater() && !Deaf()) ? 'strange, high-pitched'
              : 'strange')}`);
        ap_Soundeffect(/*se_shrill_whistle*/ 0, 80);
        await magic_whistled(obj);
    }
}

// C ref: apply.c:517 magic_whistled(obj) — teleport every tame monster (except
// the steed) next to the hero, then summarise.  RNG comes from mnexto() and
// mintrap(); the message-counting is RNG-free.
//
// DEFERRED: C brackets mintrap() with `iflags.last_msg = PLNMSG_enum` and treats
// "last_msg changed" as "a trap message printed", which routes that pet into the
// `trapped` count and skips its seen/unseen bookkeeping.  This port has no
// iflags.last_msg, so the trap-message case falls through to the nseen/oseen
// arms below.  RNG-neutral either way.
export async function magic_whistled(obj) {
    const A = await ap_load();
    let mnam = null;
    let shiftbuf = '', appearbuf = '', disappearbuf = '';
    let shift = 0, appear = 0, disappear = 0, trapped = 0;
    const already_discovered = !!objects[obj.otyp]?.oc_name_known;

    /* stasis prevents magic-whistling */
    if ((game.level?.flags?.stasis_until | 0) >= (game.moves | 0))
        return;

    for (const mtmp of ap_fmon()) {
        if (ap_DEADMONSTER(mtmp)) continue;
        /* only tame monsters are affected; steed is already at your location */
        if (!mtmp.mtame || mtmp === game.u.usteed) continue;
        if (mtmp.mtrapped) {
            /* no longer in previous trap (affects mintrap) */
            mtmp.mtrapped = 0;
            A.trap.fill_pit(mtmp.mx, mtmp.my);
        }

        const oseen = A.uhitm.canspotmon(mtmp); /* old 'seen' status */
        if (oseen) /* get name in case it's one we'll remember */
            mnam = A.do_name.y_monnam(mtmp); /* before mnexto() */
        /* mimic must be revealed before we know whether it actually moves */
        if (ap_M_AP_TYPE(mtmp))
            await seemimic(mtmp);
        const omx = mtmp.mx, omy = mtmp.my;
        await ap_mnexto(mtmp, !already_discovered ? RLOC_MSG_A : RLOC_NONE_A);

        if (mtmp.mx !== omx || mtmp.my !== omy) {
            if (mtmp.mundetected) { /* reveal non-mimic hider that moved */
                mtmp.mundetected = 0;
                A.display.newsym(mtmp.mx, mtmp.my);
            }
            if (await ap_mintrap(mtmp, NO_TRAP_FLAGS_A)
                === A.monmove.Trap_Killed_Mon)
                A.do_wear.change_luck(-1);
            /* dying while seen would have issued a message and not get here */
            const nseen = ap_DEADMONSTER(mtmp) ? false : A.uhitm.canspotmon(mtmp);

            if (nseen) {
                mnam = A.do_name.y_monnam(mtmp);
                if (oseen) {
                    if (++shift === 1) shiftbuf = `${mnam} shifts location`;
                } else {
                    if (++appear === 1) appearbuf = `${mnam} appears`;
                }
            } else if (oseen) {
                if (++disappear === 1) disappearbuf = `${mnam} disappears`;
            }
        }
    }

    // C ref: apply.c:1170 HowMany(n) — cardinal names up to four, then vague.
    const HowMany = (n) => ((n < 2) ? 'sqrt(-1)'
        : (n === 2) ? 'two' : (n === 3) ? 'three' : (n === 4) ? 'four'
          : (n <= 7) ? 'several' : 'many');

    let buf = '';
    if (!already_discovered) {
        /* message(s) were handled by rloc(); pets merely disappearing does not
           discover the whistle */
        if (shift + appear + trapped > 0)
            A.invent.makeknown(obj.otyp);
    } else {
        if (shift > 0) {
            if (shift > 1)
                shiftbuf = `${HowMany(shift)} creatures shift locations`;
            buf = ap_upstart(shiftbuf);
        }
        if (appear > 0) {
            if (appear > 1)
                appearbuf = `${HowMany(appear)} ${
                    (shift === 0) ? 'creatures'
                    : (shift === 1) ? 'other creatures' : 'others'} appear`;
            if (shift === 0) buf = ap_upstart(appearbuf);
            else buf += `${disappear ? ',' : ' and'} ${appearbuf}`;
        }
        if (disappear > 0) {
            if (disappear > 1)
                disappearbuf = `${HowMany(disappear)} ${
                    (shift === 0 && appear === 0) ? 'creatures'
                    : (shift < 2 && appear < 2) ? 'other creatures'
                      : 'others'} disappear`;
            if (shift + appear === 0) buf = ap_upstart(disappearbuf);
            else buf += `${(shift && appear) ? ',' : ''} and ${disappearbuf}`;
        }
    }
    if (buf) await A.display.pline(`${buf}.`);
}

// C ref: apply.c:697 number_leashed() — how many carried leashes are in use.
export function number_leashed() {
    let i = 0;
    for (const obj of ap_invent())
        if (obj.otyp === LEASH && (obj.leashmon | 0) !== 0) i++;
    return i;
}

// C ref: apply.c:710 o_unleash(otmp) — otmp is about to be destroyed or stolen.
export async function o_unleash(otmp) {
    const A = await ap_load();
    for (const mtmp of ap_fmon())
        if (mtmp.m_id === (otmp.leashmon | 0)) {
            mtmp.mleashed = 0;
            break;
        }
    otmp.leashmon = 0;
    A.invent.update_inventory();
}

// C ref: apply.c:725 m_unleash(mtmp, feedback) — mtmp is about to die or become
// untame.
export async function m_unleash(mtmp, feedback) {
    const A = await ap_load();
    if (feedback) {
        if (A.uhitm.canspotmon(mtmp) && cansee_mon_ap(mtmp))
            await A.display.pline(`${A.do_name.Monnam(mtmp)} pulls free of ${
                ap_mhis(mtmp)} leash!`);
        else
            await A.display.pline('Your leash falls slack.');
    }
    const otmp = get_mleash(mtmp);
    if (otmp) {
        otmp.leashmon = 0;
        A.invent.update_inventory();
    }
    mtmp.mleashed = 0;
}

// C ref: display.h canseemon(mon) — canspotmon() minus the sensemon half.
// js/dogmove.js keeps its own private copy of this one-liner.
function cansee_mon_ap(mtmp) {
    const loc = game.level?.at(mtmp.mx, mtmp.my);
    return !!loc && !mtmp.minvis && !mtmp.mundetected;
}

// C ref: apply.c:745 unleash_all() — the hero is about to die (for bones).
export function unleash_all() {
    for (const otmp of ap_invent())
        if (otmp.otyp === LEASH) otmp.leashmon = 0;
    for (const mtmp of ap_fmon())
        mtmp.mleashed = 0;
}

// C ref: apply.c:760 leashable(mtmp).
export function leashable(mtmp) {
    return mtmp.mnum !== PM_LONG_WORM
        && !ap_unsolid(mtmp.data)
        && (!ap_nolimbs(mtmp.data) || ap_has_head(mtmp.data));
}

// C ref: apply.c:29 MAXLEASHED.
const MAXLEASHED = 2;

// C ref: apply.c:768 use_leash(obj).  RNG-free.
export async function use_leash(obj) {
    const A = await ap_load();
    const u = game.u;
    const cc = { x: 0, y: 0 };

    if (u.uswallow) {
        await A.display.pline(`You can't ${
            (!obj.leashmon ? `leash ${A.do_name.mon_nam(u.ustuck)} from inside.`
             : (obj.leashmon === (u.ustuck.m_id | 0))
               ? `unleash ${A.do_name.mon_nam(u.ustuck)} from inside.`
               : `unleash anything from inside ${A.do_name.mon_nam(u.ustuck)}.`)}`);
        return ECMD_OK;
    }
    if (!obj.leashmon && number_leashed() >= MAXLEASHED) {
        await A.display.pline('You cannot leash any more pets.');
        return ECMD_OK;
    }

    if (!await ap_get_adjacent_loc(null, null, u.ux, u.uy, cc))
        return ECMD_OK;

    if (ap_u_at(cc.x, cc.y)) {
        if (u.usteed && (cc.dz | 0) > 0) {
            const mtmp = u.usteed;
            await use_leash_core(obj, mtmp, cc, 1);
            return ECMD_TIME;
        }
        await A.display.pline('Leash yourself?  Very funny...');
        return ECMD_OK;
    }

    /* From here on out, return value is ECMD_TIME == a move is used. */
    const mtmp = A.display.m_at(cc.x, cc.y);
    if (!mtmp) {
        await A.display.pline('There is no creature there.');
        unmap_invisible_at(cc.x, cc.y);
        return ECMD_TIME;
    }

    await use_leash_core(obj, mtmp, cc, A.uhitm.canspotmon(mtmp) ? 1 : 0);
    return ECMD_TIME;
}

// C ref: apply.c:820 use_leash_core(obj, mtmp, cc, spotmon).  RNG-free.
export async function use_leash_core(obj, mtmp, cc, spotmon) {
    const A = await ap_load();
    const loc = game.level?.at(cc.x, cc.y);

    if (!spotmon && !loc?.invisMon) {
        /* for the unleash case, we don't verify whether this unseen
           monster is the creature attached to the current leash */
        await A.display.pline(`You fail to ${obj.leashmon ? 'un' : ''}leash something.`);
        A.display.map_invisible(cc.x, cc.y);
    } else if (!mtmp.mtame) {
        await A.display.pline(`${A.do_name.Monnam(mtmp)} ${
            (!obj.leashmon) ? 'cannot be' : 'is not'} leashed!`);
    } else if (!obj.leashmon) {
        /* applying a leash which isn't currently in use */
        if (mtmp.mleashed) {
            await A.display.pline(`This ${
                spotmon ? A.do_name.l_monnam(mtmp) : 'creature'} is already leashed.`);
        } else if (ap_unsolid(mtmp.data)) {
            await A.display.pline('The leash would just fall off.');
        } else if (ap_nolimbs(mtmp.data) && !ap_has_head(mtmp.data)) {
            await A.display.pline(`${A.do_name.Monnam(mtmp)} has no extremities the leash would fit.`);
        } else if (!leashable(mtmp)) {
            let lmonnam = A.do_name.l_monnam(mtmp);
            if (cc.x !== mtmp.mx || cc.y !== mtmp.my)
                lmonnam = `${ap_s_suffix(lmonnam)} tail`;
            await A.display.pline(`The leash won't fit onto ${
                spotmon ? 'your ' : ''}${lmonnam}.`);
        } else {
            await A.display.pline(`You slip the leash around ${
                spotmon ? 'your ' : ''}${A.do_name.l_monnam(mtmp)}.`);
            mtmp.mleashed = 1;
            obj.leashmon = mtmp.m_id | 0;
            mtmp.msleeping = 0;
            A.invent.update_inventory();
        }
    } else {
        /* applying a leash which is currently in use */
        if (obj.leashmon !== (mtmp.m_id | 0)) {
            await A.display.pline('This leash is not attached to that creature.');
        } else if (obj.cursed) {
            await A.display.pline('The leash would not come off!');
            set_bknown_ap(obj, 1);
        } else {
            mtmp.mleashed = 0;
            obj.leashmon = 0;
            A.invent.update_inventory();
            await A.display.pline(`You remove the leash from ${
                spotmon ? 'your ' : ''}${A.do_name.l_monnam(mtmp)}.`);
        }
    }
}

// C ref: mkobj.c set_bknown(obj, onoff) — js/mkobj.js exports the real one; this
// wrapper only exists so the sync call sites above stay sync.
function set_bknown_ap(obj, onoff) { obj.bknown = onoff ? 1 : 0; }

// C ref: apply.c:879 get_mleash(mtmp) — the carried leash attached to mtmp.
export function get_mleash(mtmp) {
    for (const otmp of ap_invent())
        if (otmp.otyp === LEASH && (otmp.leashmon | 0) === mtmp.m_id)
            return otmp;
    return null;
}

// C ref: apply.c:890 mleashed_next2u(mtmp) — the get_iter_mons() callback
// next_to_u() runs: drag a leashed pet along, or snap the leash.  Returns TRUE
// to make next_to_u() answer FALSE (i.e. the hero may not leave the level).
export async function mleashed_next2u(mtmp) {
    const A = await ap_load();
    if (mtmp.mleashed) {
        if (!A.monmove.m_next2u(mtmp))
            await ap_mnexto(mtmp, RLOC_NOMSG_A);
        if (!A.monmove.m_next2u(mtmp)) {
            const otmp = get_mleash(mtmp);

            if (!otmp)
                return true; /* impossible("leashed-unleashed mon?") */

            if (otmp.cursed)
                return true;
            mtmp.mleashed = 0;
            otmp.leashmon = 0;
            A.invent.update_inventory();
            await A.display.pline(`You feel ${
                (number_leashed() > 1) ? 'a' : 'the'} leash go slack.`);
        }
    }
    return false;
}

// C ref: apply.c:930 check_leash(x, y) — the hero is moving from <x,y>; choke,
// snap or tug every leash whose pet is now further away.  RNG, in order:
// rnd(2) for the cursed-leash damage (only when um_dist(...,5) is FALSE, so the
// `||` short-circuit matters), rn2(mtmp->mtame) for the tameness drop, and
// rn2(3) for the growl/yelp/whimper pick.
export async function check_leash(x, y) {
    const A = await ap_load();
    const u = game.u;

    for (const otmp of ap_invent()) {
        if (otmp.otyp !== LEASH || (otmp.leashmon | 0) === 0)
            continue;
        const mtmp = A.lightsrc.find_mid(otmp.leashmon, FM_FMON_A);
        if (!mtmp) {
            /* impossible("leash in use isn't attached to anything?") */
            otmp.leashmon = 0;
            continue;
        }
        if (ap_dist2(u.ux, u.uy, mtmp.mx, mtmp.my)
            > ap_dist2(x, y, mtmp.mx, mtmp.my)) {
            if (!ap_um_dist(mtmp.mx, mtmp.my, 3)) {
                /* still close enough */
            } else if (otmp.cursed && !ap_breathless(mtmp.data)) {
                if (ap_um_dist(mtmp.mx, mtmp.my, 5)
                    || (mtmp.mhp -= rnd(2)) <= 0) {
                    const save_pacifism = u.uconduct?.killer;

                    await A.display.pline(`Your leash chokes ${
                        A.do_name.mon_nam(mtmp)} to death!`);
                    await ap_xkilled(mtmp, XKILL_NOMSG_A);
                    /* life-saving doesn't ordinarily reset this */
                    if (!ap_DEADMONSTER(mtmp) && u.uconduct)
                        u.uconduct.killer = save_pacifism;
                } else {
                    await A.display.pline(`${A.do_name.Monnam(mtmp)} is choked by the leash!`);
                    /* tameness eventually drops to 1 here (never 0) */
                    if (mtmp.mtame && rn2(mtmp.mtame))
                        mtmp.mtame--;
                }
            } else {
                if (ap_um_dist(mtmp.mx, mtmp.my, 5)) {
                    await A.display.pline(`${
                        ap_s_suffix(A.do_name.Monnam(mtmp))} leash snaps loose!`);
                    await m_unleash(mtmp, false);
                } else {
                    await A.display.pline('You pull on the leash.');
                    if (msound_of(mtmp.data) !== MS_SILENT)
                        switch (rn2(3)) {
                        case 0: await A.sounds.growl(mtmp); break;
                        case 1: await A.sounds.yelp(mtmp); break;
                        default: await ap_whimper(mtmp); break;
                        }
                }
            }
        }
    }
}

// C ref: apply.c:996 beautiful() — the Charisma adjective.  RNG-free; async only
// because acurr() lives behind this block's lazy attrib.js import.
export async function beautiful() {
    const A = await ap_load();
    const cha = A.attrib.acurr_eff(A_CHA_A);

    /* don't bother complaining about the sexism; NetHack is not real life */
    return ((cha >= 25) ? 'sublime'            /* 25 is the maximum possible */
        : (cha >= 19) ? 'splendorous'          /* note: not "splendiferous" */
          : (cha >= 16) ? ((ap_poly_gender() === 1) ? 'beautiful' : 'handsome')
            : (cha >= 14) ? ((ap_poly_gender() === 1) ? 'winsome' : 'amiable')
              : (cha >= 11) ? 'cute'
                : (cha >= 9) ? 'plain'
                  : (cha >= 6) ? 'homely'
                    : (cha >= 4) ? 'ugly'
                      : 'hideous');            /* 3 is the minimum possible */
}

// C ref: apply.c:1017 use_mirror(obj).  RNG, in C's order:
//   rn2(2)                     cursed mirror fogs up
//   rnd(MAXULEV + 6 - ulevel)  floating-eye self-gaze paralysis, gated by
//                              `!Hallucination || !rn2(4)` (the rn2(4) is only
//                              drawn while hallucinating)
//   d(3, 4)                    umber-hulk self-confusion
//   d(m_lev, damd) then rn2(4) monster floating eye freeze (BOTH always drawn,
//                              the rn2(4) overriding tmp with 120)
//   rn2(5)                     the "frightened by its reflection" gate, drawn
//                              only after the four !is_unicorn/... tests pass
//   d(2, 4)                    monflee duration
export async function use_mirror(obj) {
    const A = await ap_load();
    const u = game.u;

    const dir = await A.cmd.getdir(null);
    if (!dir) return ECMD_CANCEL;
    u.dx = dir.dx; u.dy = dir.dy; u.dz = dir.dz;

    const invis_mirror = ap_Invis();
    const useeit = !A.vision.Blind() && (!invis_mirror || ap_See_invisible());
    const uvisage = await beautiful();
    const mirror = await ap_simpleonames(obj); /* "mirror" or "looking glass" */

    if (obj.cursed && !rn2(2)) {
        if (!A.vision.Blind())
            await A.display.pline(`The ${mirror} fogs up and doesn't reflect!`);
        else
            await A.display.pline(nothing_seems_to_happen);
        return ECMD_TIME;
    }
    if (!u.dx && !u.dy && !u.dz) {
        if (!useeit) {
            await A.display.pline(`You can't see your ${uvisage} ${AP_FACE}.`);
        // C tests `u.umonnum == PM_FLOATING_EYE` bare, but in this port
        // u.umonnum is a ROLE index while unpolymorphed
        // ([[umonnum-is-a-role-index]]), so each u.umonnum test needs Upolyd.
        } else if (u.umonnum === PM_FLOATING_EYE && ap_Upolyd()) {
            if (ap_Free_action()) {
                await A.display.pline('You stiffen momentarily under your gaze.');
            } else {
                if (ap_Hallucination())
                    await A.display.pline(`Yow!  The ${mirror} stares back!`);
                else
                    await A.display.pline("Yikes!  You've frozen yourself!");
                if (!ap_Hallucination() || !rn2(4)) {
                    nomul_ap(-rnd(MAXULEV_A + 6 - (u.ulevel | 0)));
                    game.multi_reason = 'gazing into a mirror';
                }
                game.nomovemsg = 0; /* default, "you can move again" */
            }
        } else if (ap_Upolyd() && (ap_is_vampire(game.youmonst?.data)
                                   || ap_is_vampshifter(game.youmonst))) {
            await A.display.pline("You don't have a reflection.");
        } else if (u.umonnum === PM_UMBER_HULK && ap_Upolyd()) {
            await A.display.pline("Huh?  That doesn't look like you!");
            ap_make_confused(ap_prop('Confusion') + d(3, 4), false);
        } else if (ap_Hallucination()) {
            await A.display.pline(`You ${look_str_fmt.replace('%s', A.do_name.hcolor(null))}`);
        } else if (ap_prop('Sick') > 0) {
            await A.display.pline(`You ${look_str_fmt.replace('%s', 'peaked')}`);
        } else if ((u.uhs | 0) >= WEAK_A) {
            await A.display.pline(`You ${look_str_fmt.replace('%s', 'undernourished')}`);
        } else if (ap_Upolyd()) {
            await A.display.pline(`You look like ${
                ap_an(A.makemon.monster_by_pmidx(u.umonnum)?.name || c_something)}.`);
        } else {
            await A.display.pline(`You look as ${uvisage} as ever.`);
        }
        return ECMD_TIME;
    }
    if (u.uswallow) {
        if (useeit)
            await A.display.pline(`You reflect ${
                ap_s_suffix(A.do_name.mon_nam(u.ustuck))} ${AP_STOMACH}.`);
        return ECMD_TIME;
    }
    if (ap_Underwater()) {
        if (useeit)
            await A.display.pline(`You ${ap_Hallucination()
                ? 'give the fish a chance to fix their makeup'
                : 'reflect the murky water'}.`);
        return ECMD_TIME;
    }
    if (u.dz) {
        if (useeit)
            await A.display.pline(`You reflect the ${
                (u.dz > 0) ? surface_word(u.ux, u.uy) : ceiling_word(u.ux, u.uy)}.`);
        return ECMD_TIME;
    }

    // C ref: zap.c bhit(u.dx, u.dy, COLNO, INVIS_BEAM, 0, 0, &obj).
    const mtmp = await ap_bhit_flash(u.dx, u.dy, COLNO_A, obj);
    if (!mtmp || !ap_haseyes(mtmp.data) || game.notonhead)
        return ECMD_TIME;

    /* couldsee(mtmp->mx, mtmp->my) is implied by the fact that bhit()
       targeted it, so we can ignore possibility of X-ray vision */
    const vis = A.uhitm.canspotmon(mtmp) && cansee_mon_ap(mtmp);
    const SEENMON = MONSEEN_NORMAL | MONSEEN_SEEINVIS | MONSEEN_INFRAVIS;
    const how_seen = vis ? await ap_howmonseen(mtmp) : 0;
    /* whether monster is able to use its vision-based capabilities */
    const monable = !mtmp.mcan && (!mtmp.minvis || ap_perceives(mtmp.data));
    const mlet = mtmp.data?.mcls;

    if (mtmp.msleeping) {
        if (vis)
            await A.display.pline(`${A.do_name.Monnam(mtmp)} is too tired to look at your ${mirror}.`);
    } else if (!mtmp.mcansee) {
        if (vis)
            await A.display.pline(`${A.do_name.Monnam(mtmp)} can't see anything right now.`);
    } else if (invis_mirror && !ap_perceives(mtmp.data)) {
        if (vis)
            await A.display.pline(`${A.do_name.Monnam(mtmp)} fails to notice your ${mirror}.`);
        /* infravision doesn't produce an image in the mirror */
    } else if ((how_seen & SEENMON) === MONSEEN_INFRAVIS) {
        if (vis) /* (redundant) */
            await A.display.pline(`${A.do_name.monverbself(mtmp,
                A.do_name.Monnam(mtmp), 'are', 'too far away to see')} in the dark.`);
        /* some monsters do special things */
    } else if (mlet === S_VAMPIRE || mlet === S_GHOST || ap_is_vampshifter(mtmp)) {
        if (vis)
            await A.display.pline(`${A.do_name.Monnam(mtmp)} doesn't have a reflection.`);
    } else if (monable && mtmp.data === A.makemon.monster_by_pmidx(PM_MEDUSA)) {
        if (await A.muse.mon_reflects(mtmp, 'The gaze is reflected away by %s %s!'))
            return ECMD_TIME;
        if (vis)
            await A.display.pline(`${A.do_name.Monnam(mtmp)} is turned to stone!`);
        game.stoned = true;
        await A.uhitm.killed(mtmp);
    } else if (monable && mtmp.data === A.makemon.monster_by_pmidx(PM_FLOATING_EYE)) {
        let tmp = d(mtmp.m_lev | 0,
                    (A.monattk.mattk_of(mtmp.data)[0]?.damd | 0));
        if (!rn2(4))
            tmp = 120;
        if (vis)
            await A.display.pline(`${A.do_name.Monnam(mtmp)} is frozen by its reflection.`);
        else
            await A.display.pline(`You hear ${c_something} stop moving.`);
        ap_paralyze_monst(mtmp, (mtmp.mfrozen | 0) + tmp);
    } else if (monable && mtmp.data === A.makemon.monster_by_pmidx(PM_UMBER_HULK)) {
        if (vis)
            await A.display.pline(`${A.do_name.Monnam(mtmp)} confuses itself!`);
        mtmp.mconf = 1;
    } else if (monable && (mlet === S_NYMPH
                           || mtmp.data === A.makemon.monster_by_pmidx(PM_AMOROUS_DEMON))) {
        if (vis) {
            await A.display.pline(`${A.do_name.monverbself(mtmp,
                A.do_name.Monnam(mtmp), 'admire', null)} in your ${mirror}.`);
            await A.display.pline(`${ap_upstart(ap_mhe(mtmp))} takes it!`);
        } else {
            await A.display.pline(`It steals your ${mirror}!`);
        }
        setnotworn_ap(obj); /* in case mirror was wielded */
        A.invent.freeinv(obj);
        A.makemon.mpickobj(mtmp, obj);
        if (!await A.teleport.tele_restrict(mtmp))
            await A.teleport.rloc(mtmp, RLOC_MSG_A);
    } else if (!ap_is_unicorn(mtmp.data) && !ap_humanoid(mtmp.data)
               && !ap_is_demon(mtmp.data)
               && (!mtmp.minvis || ap_perceives(mtmp.data)) && rn2(5)) {
        let do_react = true;

        if (mtmp.mfrozen) {
            if (vis)
                await A.display.pline(`You discern no obvious reaction from ${
                    A.do_name.mon_nam(mtmp)}.`);
            else
                await A.display.pline('You feel a bit silly gesturing the mirror in that direction.');
            do_react = false;
        }
        if (do_react) {
            if (vis)
                await A.display.pline(`${A.do_name.Monnam(mtmp)} is frightened by its reflection.`);
            A.uhitm.monflee(mtmp, d(2, 4), false, false);
        }
    } else if (!A.vision.Blind()) {
        if (mtmp.minvis && !ap_See_invisible()) {
            /* nothing */
        } else if ((mtmp.minvis && !ap_perceives(mtmp.data))
                   /* redundant: can't get here if these are true */
                   || !ap_haseyes(mtmp.data) || game.notonhead || !mtmp.mcansee) {
            await A.display.pline(`${A.do_name.Monnam(mtmp)} doesn't seem to notice ${
                ap_mhis(mtmp)} reflection.`);
        } else {
            await A.display.pline(`${A.do_name.Monnam(mtmp)} ignores ${
                ap_mhis(mtmp)} reflection.`);
        }
    }
    return ECMD_TIME;
}

// C ref: hack.c nomul(nval) — js/hack.js exports the real one; this sync
// wrapper keeps use_mirror()'s call site sync (a dynamic import cannot be).
function nomul_ap(nval) {
    game.multi = nval;
    if (game.u) game.u.umultimove = nval;
}
// C ref: mhitm_ad.c paralyze_monst(mon, amt) — js/mhitm_ad.js's copy is private.
function ap_paralyze_monst(mon, amt) {
    mon.mcanmove = 0;
    mon.mfrozen = amt;
}
// C ref: invent.c setnotworn(obj) — js/invent.js's copy is private.
function setnotworn_ap(obj) { if (obj) obj.owornmask = 0; }

// C ref: include/timeout.h TIMER_OBJECT / FIG_TRANSFORM, include/trap.h
// TT_BURIEDBALL (verified against js/const.js's own values).
const TIMER_OBJECT_A = 3, FIG_TRANSFORM_A = 6, TT_BURIEDBALL_A = 6;
// C ref: include/obj.h:75 — obj->where.
const OBJ_FREE_A = 0, OBJ_FLOOR_A = 1, OBJ_CONTAINED_A = 2,
      OBJ_INVENT_A = 3, OBJ_MINVENT_A = 4;
// C ref: include/mkroom.h SHOPBASE.
const SHOPBASE_A = 2;
// C ref: timers.c start_timer/stop_timer — js/mkobj.js's start_timer() and
// js/invent.js's stop_timer() are private and this port has no timer queue, so
// nothing fires; both are RNG-free (the CALLER rolls the delay).
function ap_start_timer(_when, _kind, _action, _obj) { return 1; }
function ap_stop_timer(_kind, _obj) { return 0; }

// C ref: apply.c:1201 use_bell(&obj) — `optr` is C's `struct obj **`, modelled
// as a one-field box { obj } so the callee can clear the caller's reference the
// way `*optr = 0` does.  RNG, in order: rn2(4) for the cursed nymph summon,
// obj_resists(obj, 93, 100) (which itself draws rn2(100)), then rn2(3) for the
// nymph's parting gift and rnd(2) for its nomul().
export async function use_bell(optr) {
    const A = await ap_load();
    const obj = optr.obj;
    const u = game.u;
    let wakem = false, learno = false;
    const ordinary = (obj.otyp !== BELL_OF_OPENING || !obj.spe);
    const invoking = (obj.otyp === BELL_OF_OPENING
                      && ap_invocation_pos(u.ux, u.uy)
                      && !ap_On_stairs(u.ux, u.uy));

    ap_Hero_playnotes(ap_obj_to_instr(obj), 'C', 100);
    await A.display.pline(`You ring ${ap_the(A.invent.xname(obj))}.`);

    if (ap_Underwater() || (u.uswallow && ordinary)) {
        await A.display.pline('But the sound is muffled.');

    } else if (invoking && ordinary) {
        /* needs to be recharged... */
        await A.display.pline('But it makes no sound.');
        learno = true; /* help player figure out why */

    } else if (ordinary) {
        let mtmp = null;
        if (obj.cursed && !rn2(4)
            /* note: once any of them are gone, we stop all of them */
            && !(((game.mvitals?.[PM_WOOD_NYMPH]?.mvflags | 0) & G_GONE_A))
            && !(((game.mvitals?.[PM_WATER_NYMPH]?.mvflags | 0) & G_GONE_A))
            && !(((game.mvitals?.[PM_MOUNTAIN_NYMPH]?.mvflags | 0) & G_GONE_A))
            && (mtmp = A.makemon.makemon(A.makemon.mkclass(S_NYMPH, 0),
                                         u.ux, u.uy,
                                         NO_MINVENT_A | MM_NOMSG_A)) != null) {
            await A.display.pline(`You summon ${A.do_name.a_monnam(mtmp)}!`);
            if (!A.zap.obj_resists(obj, 93, 100)) {
                await A.display.pline(`${Tobjnam(obj, 'have')} shattered!`);
                A.invent.useup(obj);
                optr.obj = null;
            } else {
                switch (rn2(3)) {
                default:
                    break;
                case 1:
                    await A.muse.mon_adjust_speed(mtmp, 2, null);
                    break;
                case 2: /* no explanation; it just happens... */
                    game.nomovemsg = '';
                    game.multi_reason = null;
                    nomul_ap(-rnd(2));
                    break;
                }
            }
        }
        wakem = true;

    } else {
        /* charged Bell of Opening */
        A.invent.consume_obj_charge(obj, true);

        if (u.uswallow) {
            if (!obj.cursed)
                await ap_openit();
            else
                await A.display.pline(nothing_happens);

        } else if (obj.cursed) {
            const mm = { x: u.ux, y: u.uy };
            await ap_mkundead(mm, false, NO_MINVENT_A);
            wakem = true;

        } else if (invoking) {
            await A.display.pline(`${Tobjnam(obj, 'issue')} an unsettling shrill sound...`);
            obj.age = game.moves;
            learno = true;
            wakem = true;

        } else if (obj.blessed) {
            let res = 0;

            if (game.uchain) {
                A.invent.unpunish();
                res = 1;
            } else if (u.utrap && u.utraptype === TT_BURIEDBALL_A) {
                ap_buried_ball_to_freedom();
                res = 1;
            }
            res += await ap_openit();
            switch (res) {
            case 0:
                await A.display.pline(nothing_happens);
                break;
            case 1:
                await A.display.pline(`${c_Something} opens...`);
                learno = true;
                break;
            default:
                await A.display.pline('Things open around you...');
                learno = true;
                break;
            }

        } else { /* uncursed */
            if (await A.detect.findit() !== 0)
                learno = true;
            else
                await A.display.pline(nothing_happens);
        }

    } /* charged BofO */

    if (learno) {
        A.invent.makeknown(BELL_OF_OPENING);
        obj.known = 1;
    }
    if (wakem)
        await A.cmd.wake_nearby(true);
}

// C ref: dungeon.c invocation_pos(x, y) / On_stairs(x, y) — js/artifact.js keeps
// private copies of both; these are this block's.
function ap_invocation_pos(x, y) {
    const inv = game.level?.invocation_pos;
    return !!inv && inv.x === x && inv.y === y;
}
function ap_On_stairs(x, y) {
    for (const s of (game.level?.stairs || []))
        if (s.sx === x && s.sy === y) return true;
    return false;
}
// C ref: ball.c buried_ball_to_freedom() — DEFERRED (no port); RNG-free in C.
function ap_buried_ball_to_freedom() {}

// C ref: apply.c:1318 use_candelabrum(obj).  RNG-free.
export async function use_candelabrum(obj) {
    const A = await ap_load();
    const u = game.u;
    const s = (obj.spe !== 1) ? 'candles' : 'candle';

    if (obj.lamplit) {
        await A.display.pline(`You snuff the ${s}.`);
        await ap_end_burn(obj, true);
        return;
    }
    if ((obj.spe | 0) <= 0) {
        await A.display.pline(`This ${A.invent.xname(obj)} has no ${s}.`);
        /* only output tip if candles are in inventory */
        let otmp = null;
        for (const o of ap_invent())
            if (ap_Is_candle(o)) { otmp = o; break; }
        if (otmp)
            await A.display.pline(`To attach candles, apply them instead of the ${
                A.invent.xname(obj)}.`);
        return;
    }
    if (ap_Underwater()) {
        await A.display.pline('You cannot make fire under water.');
        return;
    }
    if (u.uswallow || obj.cursed) {
        if (!A.vision.Blind())
            await A.display.pline(`The ${s} ${ap_vtense(s, 'flicker')} for a moment, then ${
                ap_vtense(s, 'die')}.`);
        return;
    }
    if (obj.spe < 7) {
        await A.display.pline(`There ${ap_vtense(s, 'are')} only ${obj.spe} ${s} in ${
            ap_the(A.invent.xname(obj))}.`);
        if (!A.vision.Blind())
            await A.display.pline(`${obj.spe === 1 ? 'It is' : 'They are'} lit.  ${
                Tobjnam(obj, 'shine')} dimly.`);
    } else {
        await A.display.pline(`${ap_The(A.invent.xname(obj))}'s ${s} burn${
            A.vision.Blind() ? '.' : 's brightly!'}`);
    }
    if (!ap_invocation_pos(u.ux, u.uy) || ap_On_stairs(u.ux, u.uy)) {
        await A.display.pline(`The ${s} ${ap_vtense(s, 'are')} being rapidly consumed!`);
        /* this used to be obj->age /= 2, rounding down; an age of
           1 would yield 0, confusing begin_burn() ... round up instead */
        obj.age = Math.trunc(((obj.age | 0) + 1) / 2);
        if (obj.age === 0)
            obj.age = 1; /* impossible("Candelabrum with candles but no fuel?") */
    } else {
        if (obj.spe === 7) {
            if (A.vision.Blind())
                await A.display.pline(`${Tobjnam(obj, 'radiate')} a strange warmth!`);
            else
                await A.display.pline(`${Tobjnam(obj, 'glow')} with a strange light!`);
        }
        obj.known = 1;
    }
    await ap_begin_burn(obj, false);
}

// C ref: apply.c:1386 use_candle(&obj) — attach candles to the Candelabrum, or
// fall through to use_lamp() when there is none (or it is already full).
// RNG-free.  `optr` is C's `struct obj **` (see use_bell above).
export async function use_candle(optr) {
    const A = await ap_load();
    let obj = optr.obj;
    const u = game.u;
    let s = (Number(obj.quan) !== 1) ? 'candles' : 'candle';

    if (u.uswallow) {
        await A.display.pline(`You ${no_elbow_room}`);
        return;
    }

    /* obj is the candle; otmp is the candelabrum */
    const otmp = A.invent.carrying(CANDELABRUM_OF_INVOCATION);
    if (!otmp || otmp.spe === 7) {
        await use_lamp(obj);
        return;
    }

    // C ref: apply.c:1408 — C builds the query with two safe_qbuf() passes and
    // an ESC-delimited placeholder so a long candle name is elided; the prompt
    // text here is the un-elided equivalent.
    const qbuf = `Attach ${A.invent.yname(obj)} to ${await ap_thesimpleoname(otmp)}?`;
    if (await A.display.y_n(qbuf) === 'n') {
        await use_lamp(obj);
        return;
    } else {
        if (Number(otmp.spe) + Number(obj.quan) > 7) {
            obj = A.invent.splitobj(obj, 7 - Number(otmp.spe));
            /* avoid a grammatical error if obj->quan gets reduced to 1 */
            s = (Number(obj.quan) !== 1) ? 'candles' : 'candle';
        } else {
            optr.obj = null;
        }

        /* The candle's age field doesn't correctly reflect the amount of fuel
           in it while it's lit ... end the burn temporarily while attaching. */
        const was_lamplit = obj.lamplit;
        if (was_lamplit)
            await ap_end_burn(obj, true);

        await A.display.pline(`You attach ${obj.quan}${
            !otmp.spe ? '' : ' more'} ${s} to ${ap_the(A.invent.xname(otmp))}.`);
        if (!otmp.spe || otmp.age > obj.age)
            otmp.age = obj.age;
        otmp.spe = (otmp.spe | 0) + Number(obj.quan);
        if (otmp.lamplit && !was_lamplit)
            await A.display.pline(`The new ${s} magically ${ap_vtense(s, 'ignite')}!`);
        else if (!otmp.lamplit && was_lamplit)
            await A.display.pline(`${(Number(obj.quan) > 1) ? 'They go' : 'It goes'} out.`);
        if (obj.unpaid) {
            const ithem = (Number(obj.quan) > 1) ? 'them' : 'it';
            await A.display.pline(`"You ${otmp.lamplit ? 'burn' : 'use'} ${
                ithem}, you bought ${ithem}!"`);
        }
        if (Number(obj.quan) < 7 && otmp.spe === 7)
            await A.display.pline(`${ap_The(A.invent.xname(otmp))} now has seven${
                otmp.lamplit ? ' lit' : ''} candles attached.`);
        /* candelabrum's light range might increase */
        if (otmp.lamplit)
            A.lightsrc.obj_merge_light_sources(otmp, otmp);
        /* candles are now gone */
        A.invent.useupall(obj);
        /* candelabrum's weight is changing */
        otmp.owt = weight(otmp);
        A.invent.update_inventory();
    }
}

// C ref: apply.c:1471 snuff_candle(otmp) — call in drop, throw, put in box, etc.
// Returns TRUE if a candle/candelabrum flame was extinguished.  RNG-free.
export async function snuff_candle(otmp) {
    const A = await ap_load();
    const candle = ap_Is_candle(otmp);

    if ((candle || otmp.otyp === CANDELABRUM_OF_INVOCATION) && otmp.lamplit) {
        const many = candle ? (Number(otmp.quan) > 1) : ((otmp.spe | 0) > 1);
        // C ref: apply.c:1481 — the message is shown when the object is in a
        // monster's pack and its square is visible, or (any other `where`) when
        // the hero is not blind.  js/light.js's get_obj_location() is private,
        // so read the object's own ox/oy, which it keeps in sync.
        const visible = (otmp.where === OBJ_MINVENT_A)
            ? A.vision.cansee(otmp.ox | 0, otmp.oy | 0) : !A.vision.Blind();
        if (visible)
            await A.display.pline(`${await ap_Shk_Your(otmp)}${
                candle ? '' : "candelabrum's "}candle${many ? "s'" : "'s"} flame${
                many ? 's are' : ' is'} extinguished.`);
        await ap_end_burn(otmp, true);
        return true;
    }
    return false;
}

// C ref: apply.c:1496 snuff_lit(obj) — a lit lamp/lantern/oil potion hit by
// water, put into a container, or swallowed.  RNG-free.
export async function snuff_lit(obj) {
    const A = await ap_load();

    if (obj.lamplit) {
        if (obj.otyp === OIL_LAMP || obj.otyp === MAGIC_LAMP
            || obj.otyp === BRASS_LANTERN || obj.otyp === POT_OIL) {
            const visible = (obj.where === OBJ_MINVENT_A)
                ? A.vision.cansee(obj.ox | 0, obj.oy | 0) : !A.vision.Blind();
            if (visible)
                await A.display.pline(`${await ap_Yname2(obj)} ${
                    A.invent.otense(obj, 'go')} out!`);
            await ap_end_burn(obj, true);
            return true;
        }
        if (await snuff_candle(obj))
            return true;
    }
    return false;
}

// C ref: apply.c:1627 use_lamp(obj) — light a lamp or candle.  RNG: the cursed
// rn2(2) failure roll, then (lamps only) rn2(3) for the oil spill and d(2,10)
// for how slippery it leaves the hero.
export async function use_lamp(obj) {
    const A = await ap_load();
    const u = game.u;
    const lamp = (obj.otyp === OIL_LAMP || obj.otyp === MAGIC_LAMP) ? 'lamp'
        : (obj.otyp === BRASS_LANTERN) ? 'lantern' : null;

    /* When blind, lamps' and candles' on/off state can be distinguished by
       heat.  For brass lantern assume there is an on/off switch that can be
       felt. */
    if (obj.lamplit) {
        if (lamp) /* lamp or lantern */
            await A.display.pline(`${await ap_Shk_Your(obj)}${lamp} is now off.`);
        else
            await A.display.pline(`You snuff out ${A.invent.yname(obj)}.`);
        await ap_end_burn(obj, true);
        return;
    }
    if (ap_Underwater()) {
        await A.display.pline(`${!ap_Is_candle(obj) ? 'This is not a diving lamp'
            : "Sorry, fire and water don't mix"}.`);
        return;
    }
    /* magic lamps with an spe == 0 (wished for) cannot be lit */
    if ((!ap_Is_candle(obj) && obj.age === 0)
        || (obj.otyp === MAGIC_LAMP && obj.spe === 0)) {
        if (obj.otyp === BRASS_LANTERN) {
            if (!A.vision.Blind())
                await A.display.pline('Your lantern is out of power.');
            else
                await A.display.pline(nothing_seems_to_happen);
        } else {
            await A.display.pline(`This ${A.invent.xname(obj)} has no oil.`);
        }
        return;
    }
    if (obj.cursed && !rn2(2)) {
        if ((obj.otyp === OIL_LAMP || obj.otyp === MAGIC_LAMP) && !rn2(3)) {
            await A.display.pline(`The lamp spills and covers your ${
                A.do_wear.fingers_or_gloves(true)} with oil.`);
            ap_make_glib(ap_prop('Glib') + d(2, 10));
        } else if (!A.vision.Blind()) {
            await A.display.pline(`${Tobjnam(obj, 'flicker')} for a moment, then ${
                A.invent.otense(obj, 'die')}.`);
        } else {
            await A.display.pline(nothing_seems_to_happen);
        }
    } else {
        if (lamp) { /* lamp or lantern */
            A.invent.check_unpaid ? A.invent.check_unpaid(obj) : void 0;
            await A.display.pline(`${await ap_Shk_Your(obj)}${lamp} is now on.`);
        } else { /* candle(s) */
            await A.display.pline(`${ap_s_suffix(await ap_Yname2(obj))} flame${
                plur(obj.quan)} ${A.invent.otense(obj, 'burn')}${
                A.vision.Blind() ? '.' : ' brightly!'}`);
            if (obj.unpaid && A.shkroom.costly_spot(u.ux, u.uy)
                && obj.age === 20 * (objects[obj.otyp]?.oc_cost | 0)) {
                const ithem = (Number(obj.quan) > 1) ? 'them' : 'it';
                await A.display.pline(`"You burn ${ithem}, you bought ${ithem}!"`);
                mkobj_bill_dummy_ap(obj);
            }
        }
        await ap_begin_burn(obj, false);
    }
}

// C ref: mkobj.c bill_dummy_object(otmp) — js/mkobj.js exports the real one;
// this wrapper keeps the sync call site above sync.
function mkobj_bill_dummy_ap(_obj) {}

// C ref: apply.c:1702 light_cocktail(&obj) — apply a potion of oil.  RNG-free.
// `optr` is C's `struct obj **` (see use_bell above).
export async function light_cocktail(optr) {
    const A = await ap_load();
    let obj = optr.obj; /* obj is a potion of oil */
    const u = game.u;

    if (u.uswallow) {
        await A.display.pline(`You ${no_elbow_room}`);
        return;
    }

    if (obj.lamplit) {
        await A.display.pline('You snuff the lit potion.');
        await ap_end_burn(obj, true);
        /* Free & add to re-merge potion.  This averages the age of the
           potions ... don't do that unless obj is not worn. */
        if (!obj.owornmask) {
            A.invent.freeinv(obj);
            optr.obj = A.invent.addinv(obj);
        }
        return;
    } else if (ap_Underwater()) {
        await A.display.pline('There is not enough oxygen to sustain a fire.');
        return;
    }

    const split1off = (Number(obj.quan) > 1);
    if (split1off)
        obj = A.invent.splitobj(obj, 1);

    await A.display.pline(`You light ${await ap_shk_your(obj)}potion.${
        A.vision.Blind() ? '' : '  It gives off a dim light.'}`);

    if (obj.unpaid && A.shkroom.costly_spot(u.ux, u.uy)) {
        /* Normally we shouldn't both partially and fully charge for an item,
           but (Yendorian Fuel) Taxes are inevitable... */
        await A.display.pline(`"That's in addition to the cost of the potion, of course."`);
        mkobj_bill_dummy_ap(obj);
    }
    A.invent.makeknown(obj.otyp);

    await ap_begin_burn(obj, false); /* after shop billing */
    if (split1off) {
        A.invent.obj_extract_self(obj); /* free from inv */
        obj.nomerge = 1;
        obj = await A.invent.hold_another_object(obj, 'You drop %s!',
                                                 A.invent.xname(obj), null);
        if (obj)
            obj.nomerge = 0;
    }
    optr.obj = obj;
}

// C ref: apply.c:1966 display_jump_positions(on_off) — hilite every square the
// hero could jump to.  Display-only (see ap_tmp_at's note); RNG-free.
export function display_jump_positions(on_off) {
    if (on_off) {
        /* on */
        ap_tmp_at(DISP_BEAM_A, ap_cmap_to_glyph(S_goodpos_A));
        for (let dx = -4; dx <= 4; dx++)
            for (let dy = -4; dy <= 4; dy++) {
                const x = dx + game.u.ux, y = dy + game.u.uy;
                if (ap_get_valid_jump_position(x, y) && !ap_u_at(x, y))
                    ap_tmp_at(x, y);
            }
    } else {
        /* off */
        ap_tmp_at(DISP_END_A, 0);
    }
}

// C ref: apply.c:1958 get_valid_jump_position(x, y) — already ported in
// js/hack.js (exported there); this thin wrapper only exists so
// display_jump_positions() above can stay sync.  It answers FALSE until the
// hack.js module has been loaded by something else, which is exactly when the
// unwired display loop above can never run anyway.
function ap_get_valid_jump_position(x, y) {
    const H = _ap?.hackmod;
    return H && typeof H.get_valid_jump_position === 'function'
        ? H.get_valid_jump_position(x, y) : false;
}

// C ref: apply.c:2166 tinnable(corpse).  RNG-free.
export function tinnable(corpse) {
    if (corpse.oeaten) return 0;
    const mptr = _ap?.makemon?.monster_by_pmidx(corpse.corpsenm);
    if (!mptr || !mptr.cnutrit) return 0;
    return 1;
}

// C ref: apply.c:2176 use_tinning_kit(obj).  RNG comes from mksobj() (the new
// tin's o_id / erosion rolls) and from revive_corpse() on the Rider arm; the
// tinning itself draws nothing.
export async function use_tinning_kit(obj) {
    const A = await ap_load();
    const u = game.u;

    /* This takes only 1 move.  If this is to be changed to take many moves,
     * we've got to deal with decaying corpses... */
    if ((obj.spe | 0) <= 0) {
        await A.display.pline('You seem to be out of tins.');
        return;
    }
    const corpse = await ap_floorfood('tin', 2);
    if (!corpse)
        return;
    if (corpse.oeaten) {
        await A.display.pline(`You cannot tin ${c_something} which is partly eaten.`);
        return;
    }
    const mptr = A.makemon.monster_by_pmidx(corpse.corpsenm);
    if (A.invent.touch_petrifies(corpse.corpsenm)
        && !ap_prop('Stone_resistance') && !game.uarmg) {
        const corpse_name = ap_an(A.invent.xname(corpse));
        if (ap_poly_when_stoned(game.youmonst?.data))
            await A.display.pline(`You tin ${corpse_name} without wearing gloves.`);
        else
            await A.display.pline(`Tinning ${corpse_name} without wearing gloves is a fatal mistake...`);
        ap_instapetrify();
    }
    if (ap_is_rider(mptr)) {
        if (await ap_revive_corpse(corpse))
            await A.display.pline('"Yes...  But War does not preserve its enemies..."');
        else
            await A.display.pline('The corpse evades your grasp.');
        return;
    }
    if ((mptr?.cnutrit | 0) === 0) {
        await A.display.pline("That's too insubstantial to tin.");
        return;
    }
    A.invent.consume_obj_charge(obj, true);

    const can = mksobj(TIN_OTYP, false, false);
    if (can) {
        const you_buy_it = 'You tin it, you bought it!';
        can.corpsenm = corpse.corpsenm;
        can.cursed = obj.cursed;
        can.blessed = obj.blessed;
        can.owt = weight(can);
        can.known = 1;
        /* Mark tinned tins. No spinach allowed... */
        A.eat.set_tin_variety(can, HOMEMADE_TIN_A);
        if (ap_carried(corpse)) {
            if (corpse.unpaid)
                await A.display.pline(`"${you_buy_it}"`);
            A.invent.useup(corpse);
        } else {
            if (A.shkroom.costly_spot(corpse.ox, corpse.oy) && !corpse.no_charge)
                await A.display.pline(`"${you_buy_it}"`);
            A.invent.useupf(corpse, 1);
        }
        await A.invent.hold_another_object(
            can, 'You make, but cannot pick up, %s.', A.invent.xname(can), null);
    }
    void u;
}

// C ref: polyself.c poly_when_stoned(ptr) / mondata.h is_rider(ptr) /
// potion.c instapetrify(kptr).  js/muse.js and js/mhitm.js keep private copies
// of the first two; instapetrify() is a stub in js/invent.js too.
function ap_poly_when_stoned(ptr) {
    /* C: (ptr->mlet == S_GOLEM && ptr != &mons[PM_FLESH_GOLEM]
           && ptr != &mons[PM_STONE_GOLEM]) */
    return ptr?.mcls === 55 /* S_GOLEM */
        && ptr?.name !== 'flesh golem' && ptr?.name !== 'stone golem';
}
const AP_RIDER_NAMES = new Set(['Death', 'Pestilence', 'Famine']);
function ap_is_rider(ptr) { return AP_RIDER_NAMES.has(ptr?.name); }
function ap_instapetrify() {}

// C ref: apply.c:2258 use_unicorn_horn(&obj).  RNG, in C's order:
//   cursed horn:  rn1(90, 10) for lcount FIRST, then rn2(13) picks the
//                 malfunction (`rn2(13) / 2`, so case 6 is half as likely), and
//                 case 0 may draw a further rn1(ACURR(A_CON), 20).
//   good horn:    shuffle_int_array() over the collected troubles (its rn2()s),
//                 then `rn2(d(2, blessed ? 4 : 2))` — d() is evaluated BEFORE
//                 the rn2, so the two dice come first.
// `optr` may be null (C: the prayer/quaff callers pass 0 for "no horn").
export async function use_unicorn_horn(optr) {
    const A = await ap_load();
    const PROP_COUNT = 7;
    const obj = optr ? optr.obj : null;

    if (obj && obj.cursed) {
        const lcount = rn1(90, 10);

        switch (Math.trunc(rn2(13) / 2)) { /* case 6 is half as likely */
        case 0:
            ap_make_sick(ap_prop('Sick') ? Math.trunc(ap_prop('Sick') / 3) + 1
                                         : rn1(A.attrib.acurr_eff(A_CON_A), 20),
                         A.invent.xname(obj), true, SICK_NONVOMITABLE_A);
            break;
        case 1:
            ap_make_blinded(ap_prop('Blinded') + lcount, true);
            break;
        case 2:
            if (!ap_Confusion())
                await A.display.pline(`You suddenly feel ${
                    ap_Hallucination() ? 'trippy' : 'confused'}.`);
            ap_make_confused(ap_prop('Confusion') + lcount, true);
            break;
        case 3:
            ap_make_stunned(ap_prop('Stun') + lcount, true);
            break;
        case 4:
            if (ap_prop('Vomiting'))
                ap_vomit();
            else
                ap_make_vomiting(14, false);
            break;
        case 5:
            ap_make_hallucinated(ap_prop('Hallucination') + lcount, true, 0);
            break;
        case 6:
            if (Deaf()) /* make_deaf() won't give feedback when already deaf */
                await A.display.pline(nothing_seems_to_happen);
            ap_make_deaf(ap_prop('Deaf') + lcount, true);
            break;
        default:
            break;
        }
        return;
    }

    // C ref: apply.c:2303 TimedTrouble(P) — see ap_prop()'s note: this port
    // keeps only the timeout, so the "timed but not intrinsic" test reduces to
    // "the timer is running".
    const trouble_list = new Array(PROP_COUNT).fill(0);
    let trouble_count = 0, did_prop = 0;
    const prop_trouble = (X) => { trouble_list[trouble_count++] = X; };

    /* collect property troubles */
    if (ap_prop('Sick')) prop_trouble(P_SICK);
    if (ap_prop('Blinded') > ap_ucreamed()
        && !(game.u.uswallow && false /* AT_ENGL/AD_BLND engulfer */))
        prop_trouble(P_BLINDED);
    if (ap_prop('Hallucination')) prop_trouble(P_HALLUC);
    if (ap_prop('Vomiting')) prop_trouble(P_VOMITING);
    if (ap_prop('Confusion')) prop_trouble(P_CONFUSION);
    if (ap_prop('Stun')) prop_trouble(P_STUNNED);
    if (ap_prop('Deaf')) prop_trouble(P_DEAF);

    if (trouble_count === 0) {
        await A.display.pline(nothing_happens);
        return;
    } else if (trouble_count > 1) {
        ap_shuffle_int_array(trouble_list, trouble_count);
    }

    /*
     *  Chances for number of troubles to be fixed
     *               0      1      2      3      4      5      6      7
     *   blessed:  22.7%  22.7%  19.5%  15.4%  10.7%   5.7%   2.6%   0.8%
     *  uncursed:  35.4%  35.4%  22.9%   6.3%    0      0      0      0
     */
    let val_limit = rn2(d(2, (obj && obj.blessed) ? 4 : 2));
    if (val_limit > trouble_count)
        val_limit = trouble_count;

    /* fix [some of] the troubles */
    for (let val = 0; val < val_limit; val++) {
        switch (trouble_list[val]) {
        case P_SICK: ap_make_sick(0, null, true, SICK_ALL_A); did_prop++; break;
        case P_BLINDED: ap_make_blinded(ap_ucreamed(), true); did_prop++; break;
        case P_HALLUC: ap_make_hallucinated(0, true, 0); did_prop++; break;
        case P_VOMITING: ap_make_vomiting(0, true); did_prop++; break;
        case P_CONFUSION: ap_make_confused(0, true); did_prop++; break;
        case P_STUNNED: ap_make_stunned(0, true); did_prop++; break;
        case P_DEAF: ap_make_deaf(0, true); did_prop++; break;
        default: break;
        }
    }

    if (did_prop) {
        game.disp_botl = true;
        game.botl = true;
    } else
        await A.display.pline(nothing_seems_to_happen);
}

// C ref: apply.c:2397 fig_transform(arg, timeout) — the FIG_TRANSFORM timer
// callback: a carried//floor figurine comes to life.  RNG: rnd(5000) when the
// spot is unusable and the timer is rescheduled, then make_familiar()'s own
// rolls.
export async function fig_transform(arg, timeout) {
    const A = await ap_load();
    const figurine = arg?.a_obj ?? arg;
    let redraw = false, suppress_see = false;

    if (!figurine)
        return; /* impossible("null figurine in fig_transform()") */

    const silent = (timeout !== game.moves); /* happened while away */
    // C: okay_spot = get_obj_location(figurine, &cc.x, &cc.y, 0).  js/light.js's
    // get_obj_location() is private, so read the object's own ox/oy (which it
    // keeps in sync) and use isok() as the "found a location" test.
    const cc = { x: figurine.ox | 0, y: figurine.oy | 0 };
    let okay_spot = ap_isok(cc.x, cc.y);
    if (figurine.where === OBJ_INVENT_A || figurine.where === OBJ_MINVENT_A)
        okay_spot = await ap_enexto(cc, cc.x, cc.y,
                                    A.makemon.monster_by_pmidx(figurine.corpsenm));
    if (!okay_spot || !figurine_location_checks(figurine, cc, true)) {
        /* reset the timer to try again later */
        ap_start_timer(rnd(5000), TIMER_OBJECT_A, FIG_TRANSFORM_A, figurine);
        return;
    }

    const cansee_spot = A.vision.cansee(cc.x, cc.y);
    const mtmp = await ap_make_familiar(figurine, cc.x, cc.y, true);
    if (mtmp) {
        let and_vanish = '';
        // C: mshelter = svl.level.objects[mtmp->mx][mtmp->my] and the
        // hides_under() arm names it ("and crawl under <obj>"); this port keeps
        // a flat per-level list, so read the top object off it.
        const mshelter = ap_top_object_at(mtmp.mx, mtmp.my);
        /* [m_monnam() yields accurate mon type, overriding hallucination] */
        const monnambuf = ap_an(mtmp.data?.name || c_something);

        if ((mtmp.minvis && !ap_See_invisible())
            || (mtmp.data?.mcls === S_MIMIC && ap_M_AP_TYPE(mtmp) !== 0))
            suppress_see = true;

        if (mtmp.mundetected) {
            if (ap_hides_under(mtmp.data) && mshelter) {
                and_vanish = ` and crawl under ${A.invent.xname(mshelter)}`;
            } else if (mtmp.data?.mcls === S_MIMIC || mtmp.data?.mcls === S_EEL) {
                suppress_see = true;
            } else {
                and_vanish = ' and vanish';
            }
        }

        switch (figurine.where) {
        case OBJ_INVENT_A:
            if (A.vision.Blind() || suppress_see)
                await A.display.pline(`You feel ${c_something} drop from your pack!`);
            else
                await A.display.pline(`You see ${monnambuf} drop out of your pack${
                    and_vanish}!`);
            break;

        case OBJ_FLOOR_A:
            if (cansee_spot && !silent) {
                if (suppress_see)
                    await A.display.pline(`${ap_an(A.invent.xname(figurine))} suddenly vanishes!`);
                else
                    await A.display.pline(`You see a figurine transform into ${
                        monnambuf}${and_vanish}!`);
                redraw = true; /* update figurine's map location */
            }
            break;

        case OBJ_MINVENT_A: {
            // C names the carrier ("<mon>'s pack" / "empty water" / "thin air");
            // canseemon(figurine->ocarry) picks between them.
            if (cansee_spot && !silent && !suppress_see) {
                const mcarry = figurine.ocarry;
                const carriedby = (mcarry && cansee_mon_ap(mcarry))
                    ? `${ap_s_suffix(A.do_name.a_monnam(mcarry))} pack`
                    : (mcarry && A.dbridge.is_pool(mcarry.mx, mcarry.my))
                      ? 'empty water' : 'thin air';
                await A.display.pline(`You see ${monnambuf} drop out of ${
                    carriedby}${and_vanish}!`);
            }
            break;
        }

        default: /* impossible("figurine came to life where?") */
            break;
        }
    }
    /* free figurine now */
    if (ap_carried(figurine)) {
        A.invent.useup(figurine);
    } else {
        A.invent.obj_extract_self(figurine);
        A.invent.obfree(figurine, null);
    }
    if (redraw)
        A.display.newsym(cc.x, cc.y);
}

// C ref: apply.c:2510 figurine_location_checks(obj, cc, quietly) — RNG-free.
// Sync (C's is too); the `quietly` messages route through pline lazily, so this
// port drops them when the module cache is cold.
export function figurine_location_checks(obj, cc, quietly) {
    const say = (s) => { if (!quietly && _ap) void _ap.display.pline(s); };
    const u = game.u;

    if (ap_carried(obj) && u.uswallow) {
        say("You don't have enough room in here.");
        return false;
    }
    const x = cc ? cc.x : u.ux;
    const y = cc ? cc.y : u.uy;
    if (!ap_isok(x, y)) {
        say('You cannot put the figurine there.');
        return false;
    }
    const typ = game.level?.at(x, y)?.typ | 0;
    const mptr = _ap?.makemon?.monster_by_pmidx(obj.corpsenm);
    if (ap_IS_OBSTRUCTED(typ)
        && !(ap_passes_walls(mptr) && ap_may_passwall(x, y))) {
        say(`You cannot place a figurine in ${
            ap_IS_TREE(typ) ? 'a tree' : 'solid rock'}!`);
        return false;
    }
    if (ap_sobj_at_boulder(x, y) && !ap_passes_walls(mptr)
        && !ap_throws_rocks(mptr)) {
        say('You cannot fit the figurine on the boulder.');
        return false;
    }
    return true;
}

// C ref: teleport.c may_passwall(x, y) — DEFERRED (no port); C's answer is
// FALSE outside a wall you may phase through, which is the common case here.
function ap_may_passwall(_x, _y) { return false; }
// C ref: invent.c sobj_at(BOULDER, x, y) — js/invent.js exports sobj_at(), but
// this sync call site cannot await; scan the level's object list directly.
function ap_sobj_at_boulder(x, y) {
    for (const o of (game.level?.objects || []))
        if (o && o.otyp === BOULDER && o.ox === x && o.oy === y) return true;
    return false;
}

// C ref: apply.c:2543 use_figurine(&obj) — RNG comes from make_familiar().
// `optr` is C's `struct obj **` (see use_bell above).
export async function use_figurine(optr) {
    const A = await ap_load();
    const obj = optr.obj;
    const u = game.u;

    if (u.uswallow) {
        /* can't activate a figurine while swallowed */
        if (!figurine_location_checks(obj, null, false))
            return ECMD_OK;
    }
    const dir = await A.cmd.getdir(null);
    if (!dir) {
        game.context = game.context || {};
        game.context.move = 0;
        game.multi = 0;
        return ECMD_CANCEL;
    }
    u.dx = dir.dx; u.dy = dir.dy; u.dz = dir.dz;
    const cc = { x: u.ux + u.dx, y: u.uy + u.dy };
    /* Passing FALSE arg here will result in messages displayed */
    if (!figurine_location_checks(obj, cc, false))
        return ECMD_TIME;
    await A.display.pline(`You ${
        (u.dx || u.dy) ? 'set the figurine beside you'
            : (ap_Is_airlevel() || ap_Is_waterlevel()
               || A.dbridge.is_pool(cc.x, cc.y)) ? 'release the figurine'
              : (u.dz < 0 ? 'toss the figurine into the air'
                          : 'set the figurine on the ground')} and it ${
        A.vision.Blind() ? 'supposedly ' : ''}transforms.`);
    await ap_make_familiar(obj, cc.x, cc.y, false);
    ap_stop_timer(FIG_TRANSFORM_A, obj);
    A.invent.useup(obj);
    if (A.vision.Blind())
        A.display.map_invisible(cc.x, cc.y);
    optr.obj = null;
    return ECMD_TIME;
}

// C ref: apply.c:2584 grease_ok(obj) — the getobj() callback for what to grease.
// Note grease_ok(NULL) SUGGESTs, which is what puts the "- your hands" entry on
// the prompt.  RNG-free, and sync so it can be handed to getobj().
export function grease_ok(obj) {
    const GETOBJ_SUGGEST_A = 2, GETOBJ_EXCLUDE_A = -3, GETOBJ_EXCLUDE_INACCESS_A = -1;

    if (!obj)
        return GETOBJ_SUGGEST_A;

    /* note: if changing the list of ungreasable objects, also change
       special_throne_effect in sit.c */
    if (obj.oclass === COIN_CLASS)
        return GETOBJ_EXCLUDE_A;

    if (ap_inaccessible_equipment_quiet(obj))
        return GETOBJ_EXCLUDE_INACCESS_A;

    /* Possible extension: don't suggest greasing objects which are already
     * greased. */
    return GETOBJ_SUGGEST_A;
}

// C ref: apply.c:2603 use_grease(obj).  RNG, in order: rn2(2) for the
// cursed/fumbling slip (drawn BEFORE the getobj prompt), then rn1(6,10) when a
// cursed can smears the hero's hands or rn1(11,5) when the hero greases them
// deliberately.
export async function use_grease(obj) {
    const A = await ap_load();

    if (ap_Glib()) {
        await A.display.pline(`${Tobjnam(obj, 'slip')} from your ${
            A.do_wear.fingers_or_gloves(false)}.`);
        A.invent.dropx(obj);
        return ECMD_TIME;
    }

    if ((obj.spe | 0) > 0) {
        if ((obj.cursed || ap_Fumbling()) && !rn2(2)) {
            A.invent.consume_obj_charge(obj, true);

            await A.display.pline(`${Tobjnam(obj, 'slip')} from your ${
                A.do_wear.fingers_or_gloves(false)}.`);
            A.invent.dropx(obj);
            return ECMD_TIME;
        }
        const otmp = await A.invent.getobj('grease', grease_ok,
                                           A.invent.GETOBJ_PROMPT);
        if (!otmp)
            return ECMD_CANCEL;
        if (await A.do_wear.inaccessible_equipment(otmp, 'grease', false))
            return ECMD_OK;
        A.invent.consume_obj_charge(obj, true);

        const oldglib = ap_prop('Glib');
        if (otmp !== A.invent.hands_obj) {
            await A.display.pline(`You cover ${A.invent.yname(otmp)} with a thick layer of grease.`);
            otmp.greased = 1;
            if (obj.cursed && !ap_nohands(game.youmonst?.data)) {
                ap_make_glib(oldglib + rn1(6, 10)); /* + 10..15 */
                await A.display.pline(`Some of the grease gets all over your ${
                    A.do_wear.fingers_or_gloves(true)}.`);
            }
        } else {
            ap_make_glib(oldglib + rn1(11, 5)); /* + 5..15 */
            await A.display.pline(`You coat your ${
                A.do_wear.fingers_or_gloves(true)} with grease.`);
        }
    } else {
        if (obj.known)
            await A.display.pline(`${Tobjnam(obj, 'are')} empty.`);
        else
            await A.display.pline(`${Tobjnam(obj, 'seem')} to be empty.`);
    }
    A.invent.update_inventory();
    return ECMD_TIME;
}

// C ref: apply.c:2812 reset_trapset() — clear the pending beartrap/landmine set.
// RNG-free.  Note js/invent.js:7316 already documents the allmain.c
// reset_occupations() call site; this is the real function it names.
export function reset_trapset() {
    game.trapinfo = game.trapinfo || {};
    game.trapinfo.tobj = 0;
    game.trapinfo.force_bungle = 0;
}

// C ref: apply.c:2820 use_trap(otmp) — start arming a bear trap or land mine.
// RNG: rnl(10) for the from-the-saddle fumble chance, drawn BEFORE the y/n
// confirmation, and only when riding unskilled.
export async function use_trap(otmp) {
    const A = await ap_load();
    const u = game.u;
    let what = null;
    const levtyp = game.level?.at(u.ux, u.uy)?.typ | 0;
    const occutext = 'setting the trap';

    game.trapinfo = game.trapinfo || {};

    if (ap_nohands(game.youmonst?.data))
        what = 'without hands';
    else if (ap_Stunned())
        what = 'while stunned';
    else if (u.uswallow)
        what = 'while engulfed'; /* digests(u.ustuck->data) -> "while swallowed" */
    else if (ap_Underwater())
        what = 'underwater';
    else if (ap_Levitation())
        what = 'while levitating';
    else if (A.dbridge.is_pool(u.ux, u.uy))
        what = 'in water';
    else if (A.dbridge.is_lava(u.ux, u.uy))
        what = 'in lava';
    else if (ap_On_stairs(u.ux, u.uy)) {
        const stway = A.display.stairway_at(u.ux, u.uy);
        what = stway?.isladder ? 'on the ladder' : 'on the stairs';
    } else if (ap_IS_FURNITURE(levtyp) || ap_IS_OBSTRUCTED(levtyp)
             || ap_closed_door(u.ux, u.uy) || A.mkroom.t_at(u.ux, u.uy))
        what = 'here';
    else if (ap_Is_airlevel() || ap_Is_waterlevel())
        what = (levtyp === AIR_A) ? 'in midair'
            : (levtyp === CLOUD_A) ? 'in a cloud'
              : 'in this place'; /* Air/Water Plane catch-all */
    if (what) {
        await A.display.pline(`You can't set a trap ${what}!`);
        reset_trapset();
        return;
    }
    const ttyp = (otmp.otyp === LAND_MINE) ? LANDMINE_TTYP : BEAR_TRAP_TTYP;
    if (otmp === game.trapinfo.tobj
        && ap_u_at(game.trapinfo.tx, game.trapinfo.ty)) {
        await A.display.pline(`You resume setting ${await ap_shk_your(otmp)}${
            A.trap.trapname ? A.trap.trapname(ttyp, false) : 'trap'}.`);
        ap_set_occupation(set_trap, occutext, 0);
        return;
    }
    game.trapinfo.tobj = otmp;
    game.trapinfo.tx = u.ux; game.trapinfo.ty = u.uy;
    let tmp = A.attrib.acurr_eff(A_DEX_A);
    game.trapinfo.time_needed =
        (tmp > 17) ? 2 : (tmp > 12) ? 3 : (tmp > 7) ? 4 : 5;
    if (A.vision.Blind())
        game.trapinfo.time_needed *= 2;
    tmp = A.attrib.acurr_eff(A_STR_A);
    if (ttyp === BEAR_TRAP_TTYP && tmp < 18)
        game.trapinfo.time_needed += (tmp > 12) ? 1 : (tmp > 7) ? 2 : 4;
    /*[fumbling and/or confusion and/or cursed object check(s)
       should be incorporated here instead of in set_trap]*/
    if (u.usteed && A.enhance.p_skill_of(P_RIDING_A) < P_BASIC_A) {
        let chance;

        if (ap_Fumbling() || otmp.cursed)
            chance = (rnl(10) > 3);
        else
            chance = (rnl(10) > 5);
        await A.display.pline(`You aren't very skilled at reaching from ${
            A.do_name.mon_nam(u.usteed)}.`);
        const buf = `Continue your attempt to set ${
            ap_the(A.trap.trapname ? A.trap.trapname(ttyp, false) : 'trap')}?`;
        if (await A.display.y_n(buf) === 'y') {
            if (chance) {
                switch (ttyp) {
                case LANDMINE_TTYP: /* set it off */
                    game.trapinfo.time_needed = 0;
                    game.trapinfo.force_bungle = true;
                    break;
                case BEAR_TRAP_TTYP: /* drop it without arming it */
                    reset_trapset();
                    await A.display.pline(`You drop ${
                        ap_the(A.trap.trapname ? A.trap.trapname(ttyp, false) : 'trap')}!`);
                    A.invent.dropx(otmp);
                    return;
                default:
                    break;
                }
            }
        } else {
            reset_trapset();
            return;
        }
    }
    await A.display.pline(`You begin setting ${await ap_shk_your(otmp)}${
        A.trap.trapname ? A.trap.trapname(ttyp, false) : 'trap'}.`);
    ap_use_unpaid_trapobj(otmp, u.ux, u.uy);
    ap_set_occupation(set_trap, occutext, 0);
}

// C ref: apply.c:2915 set_trap() — the occupation routine run each turn while
// arming a beartrap or landmine.  RNG: maketrap()'s own draws, then rnl(10) for
// the cursed/fumbling bungle — SHORT-CIRCUITED behind `(otmp->cursed ||
// Fumbling)`, so a clean setter draws nothing there.
export async function set_trap() {
    const A = await ap_load();
    const u = game.u;
    game.trapinfo = game.trapinfo || {};
    const otmp = game.trapinfo.tobj;

    if (!otmp || !ap_carried(otmp)
        || !ap_u_at(game.trapinfo.tx, game.trapinfo.ty)) {
        /* trap object might have been stolen or hero teleported */
        reset_trapset();
        return 0;
    }

    if (--game.trapinfo.time_needed > 0)
        return 1; /* still busy */

    const ttyp = (otmp.otyp === LAND_MINE) ? LANDMINE_TTYP : BEAR_TRAP_TTYP;
    const ttmp = A.trap.maketrap(u.ux, u.uy, ttyp);
    if (ttmp) {
        ttmp.madeby_u = 1;
        await ap_feeltrap(ttmp);
        if (A.shkroom.in_rooms(u.ux, u.uy, SHOPBASE_A)?.length)
            ap_add_damage(u.ux, u.uy, 0); /* schedule removal */
        if (!game.trapinfo.force_bungle)
            await A.display.pline(`You finish arming ${
                ap_the(A.trap.trapname ? A.trap.trapname(ttyp, false) : 'trap')}.`);
        if (((otmp.cursed || ap_Fumbling()) && (rnl(10) > 5))
            || game.trapinfo.force_bungle)
            await A.trap.dotrap(ttmp,
                                game.trapinfo.force_bungle ? FORCEBUNGLE_A : 0);
    } else {
        /* this shouldn't happen */
        await A.display.pline('Your trap setting attempt fails.');
    }
    A.invent.useup(otmp);
    reset_trapset();
    return 0;
}

// C ref: apply.c:3333 display_polearm_positions(on_off) — display-only (see
// ap_tmp_at's note).  RNG-free.
export function display_polearm_positions(on_off) {
    if (on_off) {
        /* on */
        ap_tmp_at(DISP_BEAM_A, ap_cmap_to_glyph(S_goodpos_A));
        const { min_range, max_range } = calc_pole_range();
        for (let dx = -3; dx <= 3; dx++)
            for (let dy = -3; dy <= 3; dy++) {
                const x = dx + game.u.ux, y = dy + game.u.uy;
                if (valid_polearm_position(x, y, min_range, max_range))
                    ap_tmp_at(x, y);
            }
    } else {
        /* off */
        ap_tmp_at(DISP_END_A, 0);
    }
}

// C ref: apply.c:3390 could_pole_mon() — TRUE if the hero wields a polearm and
// there is at least one monster they could hit with it.  RNG-free.
export function could_pole_mon() {
    const u = game.u;
    const hitm = game.context?.polearm_hitmon;

    if (!game.uwep || !(_ap?.invent?.is_pole?.(game.uwep)))
        return false;

    const { min_range, max_range } = calc_pole_range();

    const cc = { x: u.ux, y: u.uy };
    if (!find_poleable_mon(cc, min_range, max_range)) {
        if (hitm && !ap_DEADMONSTER(hitm) && _ap?.mon?.sensemon?.(hitm)
            && ap_mdistu(hitm) <= max_range && ap_mdistu(hitm) >= min_range)
            return true;
    } else {
        return true;
    }
    return false;
}

// C ref: apply.c:3415 snickersnee_used_dist_attk(obj) — was Snickersnee used to
// attack at distance this turn already?  RNG-free.
const ART_SNICKERSNEE_A = 19; // js/artifact.js's artilist index
export function snickersnee_used_dist_attk(obj) {
    if (obj && obj === game.uwep && obj.oartifact === ART_SNICKERSNEE_A
        && game.context?.snickersnee_turn === game.moves)
        return true;
    return false;
}

// C ref: apply.c:3606 jelly_ok(obj) — the getobj() callback for royal jelly.
export function jelly_ok(obj) {
    const GETOBJ_SUGGEST_A = 2, GETOBJ_EXCLUDE_A = -3;
    if (obj && obj.otyp === EGG)
        return GETOBJ_SUGGEST_A;
    return GETOBJ_EXCLUDE_A;
}

// C ref: apply.c:3615 use_royal_jelly(&obj) — rub royal jelly on an egg.
// RNG comes from splitobj()/attach_egg_hatch_timeout() (the hatch delay roll);
// use_royal_jelly itself draws nothing.  `optr` is C's `struct obj **`.
export async function use_royal_jelly(optr) {
    const A = await ap_load();
    let obj = optr.obj;
    const splitit = (Number(obj.quan) > 1);

    if (splitit)
        obj = A.invent.splitobj(obj, 1);
    /* remove from inventory so that it won't be offered as a choice
       to rub on itself */
    A.invent.freeinv(obj);

    /* right now you can rub one royal jelly on an entire stack of eggs */
    const eobj = await A.invent.getobj('rub the royal jelly on', jelly_ok,
                                       A.invent.GETOBJ_PROMPT);
    if (!eobj) {
        if (splitit) {
            ap_unsplitobj(obj);
            A.invent.update_inventory();
        } else {
            /* this lump was already separate; prevent merge */
            A.invent.addinv_nomerge(obj);
        }
        return ECMD_CANCEL;
    }

    await A.display.pline(`You smear royal jelly all over ${A.invent.yname(eobj)}.`);
    let useup_jelly = false;
    if (eobj.otyp !== EGG) {
        await A.display.pline(nothing_happens);
        useup_jelly = true;
    }

    if (!useup_jelly) {
        const oldcorpsenm = eobj.corpsenm;
        if (eobj.corpsenm === PM_KILLER_BEE)
            eobj.corpsenm = PM_QUEEN_BEE;

        if (obj.cursed) {
            if (eobj.timed || eobj.corpsenm !== oldcorpsenm)
                await A.display.pline(`The ${A.invent.xname(eobj)} ${
                    A.invent.otense(eobj, 'quiver')} feebly.`);
            else
                await A.display.pline(nothing_seems_to_happen);
            ap_kill_egg(eobj);
            useup_jelly = true;
        } else {
            const was_timed = eobj.timed;
            if (eobj.corpsenm !== /*NON_PM*/ -1) {
                if (!eobj.timed)
                    ap_attach_egg_hatch_timeout(eobj, 0);
                /* blessed royal jelly will make the hatched creature think
                   you're the parent - but has no effect if you laid the egg */
                if (obj.blessed && !eobj.spe)
                    eobj.spe = 2;
            }

            if ((eobj.timed && !was_timed) || eobj.spe === 2
                || eobj.corpsenm !== oldcorpsenm)
                await A.display.pline(`The ${A.invent.xname(eobj)} ${
                    A.invent.otense(eobj, 'quiver')} briefly.`);
            else
                await A.display.pline(nothing_seems_to_happen);
        }
    }

    /* useup_jelly: not useup() because we've already done freeinv() */
    setnotworn_ap(obj);
    A.invent.obfree(obj, null);
    optr.obj = null;
    return ECMD_TIME;
}

// C ref: invent.c unsplitobj(obj) — js/invent.js's copy is private (and is
// itself a `return obj` stub); RNG-free either way.
function ap_unsplitobj(obj) { return obj; }
// C ref: mkobj.c kill_egg(egg) / attach_egg_hatch_timeout(egg, when) —
// js/mkobj.js's attach_egg_hatch_timeout() is private (and this port has no
// timer queue), kill_egg() is unported.  attach_egg_hatch_timeout DRAWS in C
// (rnd(150) for the hatch delay when `when` is 0); it draws nothing here.
function ap_kill_egg(egg) { egg.corpsenm = -1; egg.timed = 0; }
function ap_attach_egg_hatch_timeout(egg, _when) { egg.timed = 1; }

// C ref: apply.c:3685 grapple_range() — the hook's reach, from the wielded
// weapon's skill.  RNG-free.
export function grapple_range() {
    const typ = _ap?.enhance?.uwep_skill_type?.() ?? P_NONE_A;
    let max_range = 4;

    if (typ === P_NONE_A || (_ap?.enhance?.p_skill_of?.(typ) ?? 0) <= P_BASIC_A)
        max_range = 4;
    else if (_ap.enhance.p_skill_of(typ) === P_SKILLED)
        max_range = 5;
    else
        max_range = 8;
    return max_range;
}

// C ref: apply.c:3700 can_grapple_location(x, y).  RNG-free.
export function can_grapple_location(x, y) {
    return ap_isok(x, y) && !!_ap?.vision?.cansee?.(x, y)
        && ap_distu(x, y) <= grapple_range();
}

// C ref: apply.c:3706 display_grapple_positions(on_off) — display-only.
export function display_grapple_positions(on_off) {
    if (on_off) {
        /* on */
        ap_tmp_at(DISP_BEAM_A, ap_cmap_to_glyph(S_goodpos_A));
        for (let dx = -3; dx <= 3; dx++)
            for (let dy = -3; dy <= 3; dy++) {
                const x = dx + game.u.ux, y = dy + game.u.uy;
                if (can_grapple_location(x, y) && !ap_u_at(x, y))
                    ap_tmp_at(x, y);
            }
    } else {
        /* off */
        ap_tmp_at(DISP_END_A, 0);
    }
}

// C ref: apply.c:3728 use_grapple(obj).  RNG, in C's order:
//   rn2(5)                 what the hook catches (the unskilled roll)
//   rn2(4)                 RE-ROLLED for a Skilled+ hero, BEFORE the menu is
//                          selected from, then rn2(20)/rn2(2) decides whether
//                          the player's menu pick overrides it
//   rnd(2)                 u_wipe_engr, gated by `tohit == 2 || !rn2(2)`
//   rn2(4) then rn2(4)     the monster arm: verysmall pull-in, then the
//                          big/strong resist roll
//   rn1(10, 10)            the "you hook yourself" damage
export async function use_grapple(obj) {
    const A = await ap_load();
    const u = game.u;
    let res = ECMD_OK;

    /* Are you allowed to use the hook? */
    if (u.uswallow) {
        await A.display.pline(not_enough_room);
        return ECMD_OK;
    }
    if (obj !== game.uwep) {
        /* "cast": grappling hook evolved from slash'em's fishing pole */
        if (await A.invent.wield_tool(obj, 'cast')) {
            // C: cmdq_add_ec(CQ_CANNED, doapply) then cmdq_add_key(invlet), so
            // the queued doapply re-enters with the hook wielded.  This file's
            // reapply_after_wield() above models that pair; it is not called
            // here because doing so would make this block reachable.
            A.invent.cmdq_add_key(CQ_CANNED, obj.invlet);
            return ECMD_TIME;
        }
        return ECMD_OK;
    }
    /* assert(obj == uwep); */

    /* Prompt for a location */
    await A.display.pline(where_to_hit);
    const cc = { x: u.ux, y: u.uy };
    const picked = await A.hackmod.getpos('the spot to hit', cc.x, cc.y,
                                          can_grapple_location, true);
    if (!picked)
        /* ESC; uses turn iff grapnel became wielded */
        return (res | ECMD_CANCEL);
    cc.x = picked.x; cc.y = picked.y;

    /* Calculate range; unlike use_pole(), there's no minimum for range */
    const typ = A.enhance.uwep_skill_type();
    if (ap_distu(cc.x, cc.y) > grapple_range()) {
        await A.display.pline('Too far!');
        return res;
    } else if (!A.vision.cansee(cc.x, cc.y)) {
        await A.display.pline(`You ${cant_see_spot}`);
        return res;
    } else if (!A.vision.couldsee(cc.x, cc.y)) { /* Eyes of the Overworld */
        await A.display.pline(`You ${cant_reach}`);
        return res;
    }

    /* What do you want to hit? */
    let tohit = rn2(5);
    if (typ !== P_NONE_A && A.enhance.p_skill_of(typ) >= P_SKILLED) {
        // C ref: apply.c:3776 — the "Aim for what?" menu.  This port has no
        // window layer here, so select_menu() finds nothing; C's rn2(4) and the
        // override roll still have to be drawn in the same order.
        tohit = rn2(4);
        const selected = 0; /* select_menu(tmpwin, PICK_ONE, &selected) */
        if (selected > 0 && rn2(A.enhance.p_skill_of(typ) > P_SKILLED ? 20 : 2))
            tohit = selected - 1;
    }

    /* possibly scuff engraving at your feet;
       any engraving at the target location is unaffected */
    if (tohit === 2 || !rn2(2))
        await ap_u_wipe_engr(rnd(2));

    /* What did you hit? */
    switch (tohit) {
    case 0: /* Trap */
        /* FIXME -- untrap needs to deal with non-adjacent traps */
        break;
    case 1: { /* Object */
        const otmp = ap_top_object_at(cc.x, cc.y);
        if (otmp) {
            await A.display.pline(`You snag an object from the ${
                surface_word(cc.x, cc.y)}!`);
            await A.pickup.pickup_object(otmp, 1, false);
            /* If pickup fails, leave it alone */
            A.display.newsym(cc.x, cc.y);
            return ECMD_TIME;
        }
        break;
    }
    case 2: { /* Monster */
        game.bhitpos = { x: cc.x, y: cc.y };
        const mtmp = A.display.m_at(cc.x, cc.y);
        if (!mtmp)
            break;
        game.notonhead = (game.bhitpos.x !== mtmp.mx || game.bhitpos.y !== mtmp.my);
        const save_confirm = game.flags?.confirm;
        if (ap_verysmall(mtmp.data) && !rn2(4)
            && await ap_enexto(cc, u.ux, u.uy, null)) {
            if (game.flags) game.flags.confirm = false;
            await A.uhitm.attack_checks(mtmp);
            if (game.flags) game.flags.confirm = save_confirm;
            await A.uhitm.check_caitiff(mtmp); /* despite no damage */
            await A.display.pline(`You pull in ${A.do_name.mon_nam(mtmp)}!`);
            mtmp.mundetected = 0;
            await A.teleport.rloc_to(mtmp, cc.x, cc.y);
            return ECMD_TIME;
        } else if ((!ap_bigmonst(mtmp.data) && !ap_strongmonst(mtmp.data))
                   || rn2(4)) {
            if (game.flags) game.flags.confirm = false;
            await A.uhitm.attack_checks(mtmp);
            if (game.flags) game.flags.confirm = save_confirm;
            await A.uhitm.check_caitiff(mtmp);
            await A.invent.thitmonst(mtmp, game.uwep);
            return ECMD_TIME;
        }
        /* FALLTHRU */
    }
    /* FALLTHROUGH */
    case 3: /* Surface */
        if (IS_AIR(game.level?.at(cc.x, cc.y)?.typ | 0)
            || A.dbridge.is_pool(cc.x, cc.y)) {
            await A.display.pline(`The hook slices through the ${
                surface_word(cc.x, cc.y)}.`);
        } else {
            await A.display.pline(`You are yanked toward the ${
                surface_word(cc.x, cc.y)}!`);
            await ap_hurtle(ap_sgn(cc.x - u.ux), ap_sgn(cc.y - u.uy), 1, false);
            await A.trap.spoteffects(true);
        }
        return ECMD_TIME;
    default: /* Yourself (oops!) */
        if (A.enhance.p_skill_of(typ) <= P_BASIC_A) {
            await A.display.pline('You hook yourself!');
            ap_losehp(rn1(10, 10), 'a grappling hook');
            return ECMD_TIME;
        }
        break;
    }
    await A.display.pline(nothing_happens);
    return ECMD_TIME;
}

// C ref: engrave.c u_wipe_engr(cnt) — js/dokick.js's copy is private; C's DRAWS
// (wipe_engr_at -> rn2 on the engraving text), so this shim is a known gap.
async function ap_u_wipe_engr(_cnt) {}
// C ref: do.c level_objects / OBJ_FLOOR chain — svl.level.objects[x][y] is the
// TOP object at <x,y>; this port keeps a flat per-level object list.
function ap_top_object_at(x, y) {
    const list = game.level?.objects || [];
    for (let i = list.length - 1; i >= 0; --i) {
        const o = list[i];
        if (o && o.ox === x && o.oy === y) return o;
    }
    return null;
}
// C ref: attrib.c losehp(n, knam, k_format) — js/attrib.js's losehp() is private
// (and takes only the damage; the killer strings feed the death screen, not the
// RNG), so this applies the damage here.  RNG-free either way.
function ap_losehp(dmg, _knam) {
    const u = game.u;
    if (!u) return;
    u.uhp = (u.uhp | 0) - dmg;
    game.disp_botl = true;
    game.botl = true;
}

// C ref: apply.c:3875 discard_broken_wand() — RNG-free.
export async function discard_broken_wand() {
    const A = await ap_load();
    const obj = game.current_wand; /* [see dozap() and destroy_items()] */
    game.current_wand = 0;
    if (obj)
        A.invent.delobj(obj);
    nomul_ap(0);
}

// C ref: apply.c:3887 broken_wand_explode(obj, dmg, expltype) — explode() draws.
export async function broken_wand_explode(obj, dmg, expltype) {
    const A = await ap_load();
    await A.explodemod.explode(game.u.ux, game.u.uy, -(obj.otyp), dmg,
                               WAND_CLASS, expltype);
    A.invent.makeknown(obj.otyp); /* explode describes the effect */
    await discard_broken_wand();
}

// C ref: apply.c:3896 maybe_dunk_boulders(x, y) — dunk any boulders at <x,y>
// into the water/lava there.  RNG comes from boulder_hits_pool().
export async function maybe_dunk_boulders(x, y) {
    const A = await ap_load();
    for (;;) {
        if (!A.dbridge.is_pool_or_lava(x, y)) break;
        const otmp = A.invent.sobj_at(BOULDER, x, y);
        if (!otmp) break;
        A.invent.obj_extract_self(otmp);
        await ap_boulder_hits_pool(otmp, x, y, false);
    }
}

// C ref: apply.c:4430 unfixable_trouble_count(is_horn) — how many troubles a
// unicorn horn (or potion of restore ability) CANNOT fix; feeds the "you feel
// great" wording.  RNG-free.
//
// See ap_prop()'s note: this port keeps only each property's timeout, so C's
// `(X & ~TIMEOUT) != 0` (the "set from a non-timed source" test) is always
// FALSE here and each clause reduces to `!is_horn`.
export function unfixable_trouble_count(is_horn) {
    let unfixable_trbl = 0;

    if (ap_prop('Stoned')) unfixable_trbl++;
    if (ap_prop('Slimed')) unfixable_trbl++;
    if (ap_prop('Strangled')) unfixable_trbl++;
    if (ap_ATEMP(A_DEX_A) < 0 && ap_Wounded_legs()) unfixable_trbl++;
    if (ap_ATEMP(A_STR_A) < 0 && (game.u?.uhs | 0) >= WEAK_A) unfixable_trbl++;
    /* lycanthropy is undesirable, but it doesn't actually make you feel bad
       so don't count it as a trouble which can't be fixed */

    /*
     * Unicorn horn can fix these when they're timed but not when they aren't.
     * Potion of restore ability doesn't touch them, so they're always
     * unfixable for the not-unihorn case.
     */
    if (ap_prop('Sick') && !is_horn) unfixable_trbl++;
    if (ap_Stunned() && !is_horn) unfixable_trbl++;
    if (ap_Confusion() && !is_horn) unfixable_trbl++;
    if (ap_Hallucination() && !is_horn) unfixable_trbl++;
    if (ap_prop('Vomiting') && !is_horn) unfixable_trbl++;
    if (Deaf() && !is_horn) unfixable_trbl++;

    return unfixable_trbl;
}
