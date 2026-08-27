// restore.js — restore a saved game from persistent storage.
// C ref: src/restore.c — dorecover() / restgamestate() / getlev();
//        sys/unix/unixmain.c — restore_saved_game() at startup.
//
// unixmain decides at launch: if the player already has a save file it calls
// dorecover() instead of newgame().  We mirror that in jsmain.start(): if the
// shared storage handle holds a save for this player name, restore it.
// dorecover() reads the whole game back, recomputes the (unsaved) vision, draws
// the map (docrt), greets with welcome(FALSE) ("... welcome back to NetHack!"),
// then moveloop_preamble(resuming=TRUE) re-evaluates the moon phase / Friday
// the 13th for the RESTORING process's date and reports it — which is why a
// Friday-the-13th save reloaded under a full moon prints "You are lucky!  Full
// moon tonight." here.
//
// The save blob is the reference-preserving serialization written by
// save.js:serializeGameState.  Decoding rebuilds the object graph (restoring
// shared identity, permonst templates, typed arrays, the GameMap prototype),
// then we splice the restored state into the live `game` object — keeping the
// restoring segment's own runtime environment (display handle, capture hook,
// wall-clock datetime) untouched.

import { game } from './gstate.js';
import { GameMap } from './game.js';
import { monster_by_pmidx, propagate, set_malign, adj_erinys,
         peace_minded_bigrm } from './makemon.js';
import { docrt, bot, cls, flush_screen, pline, topl_more, y_n, see_monsters,
         impossible, stairway_at, display_nhwindow_message } from './display.js';
import { init_vision_globals, vision_reset, vision_recalc } from './vision.js';
import { phase_of_the_moon, friday_13th, FULL_MOON, NEW_MOON } from './calendar.js';
import { Hello } from './role.js';
import { saveFileKey, savelev } from './save.js';
import { l_nhcore_init } from './mklev.js';
import { rn2 } from './rng.js';
import { quest_nemgend_or_null } from './questpgr.js';
import { check_special_room } from './shkroom.js';
import { read_engr_at, encumber_msg, xname, useup } from './invent.js';
import { run_object_timers, place_object, next_ident, newoextra, newomonst,
         newomid, new_omailcmd, OMID, has_omid, has_omonst, free_omid,
         SLIME_MOLD, ICE_BOX, POT_OIL, TALLOW_CANDLE, WAX_CANDLE,
         BRASS_LANTERN, OIL_LAMP, CANDELABRUM_OF_INVOCATION } from './mkobj.js';
import {
    COLNO, ROWNO, OBJ_FREE, W_BALL, W_CHAIN, W_WEP, FREEING, WRITING, READING,
    RANGE_GLOBAL, RANGE_LEVEL, REST_GSTATE, REST_LEVELS, REST_CURRENT_LEVEL,
    NHF_SAVEFILE, NHF_BONESFILE, DEFUNCT_MONSTER, NON_PM, TRICKED,
    MAGIC_PORTAL, BR_STAIR, BR_NO_END1, BR_NO_END2, BR_PORTAL, PL_NSIZ_PLUS,
    ROGUESET, Is_rogue_level, Upolyd, Has_contents, OMONST,
    EGD, EPRI, ESHK, EMIN, EDOG, EBONES,
} from './const.js';

// Reference-preserving deserializer — the inverse of save.js:serializeGameState.
// Two passes: build empty shells for every node so references can be wired even
// through cycles, then fill each shell.  Value slots are primitives, {$r:id}
// back-references, or {$m:pmidx} permonst rebindings.
export function deserializeGameState(str) {
    const { root, nodes } = JSON.parse(str);
    const built = new Array(nodes.length);

    // Pass 1: allocate shells.
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.$a) built[i] = [];
        else if (n.$s) built[i] = new Set();
        else if (n.$ta) built[i] = null; // typed array built in pass 2 (has data)
        else if (n.$c) built[i] = Object.create(GameMap.prototype);
        else built[i] = {};
    }

    const resolve = (e) => {
        if (e === null || typeof e !== 'object') return e;
        if ('$r' in e) return built[e.$r];
        if ('$m' in e) return monster_by_pmidx(e.$m);
        return e;
    };

    // Pass 2: fill shells.
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.$ta) {
            const Ctor = TYPED_ARRAY_CTORS[n.$ta] || Array;
            built[i] = Ctor.from ? Ctor.from(n.d) : n.d.slice();
        } else if (n.$a) {
            const arr = built[i];
            for (const e of n.$a) arr.push(resolve(e));
        } else if (n.$s) {
            const set = built[i];
            for (const e of n.$s) set.add(resolve(e));
        } else {
            const obj = built[i];
            const src = n.$o || {};
            for (const k of Object.keys(src)) obj[k] = resolve(src[k]);
        }
    }

    return resolve(root);
}

const TYPED_ARRAY_CTORS = {
    Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
    Int32Array, Uint32Array, Float32Array, Float64Array,
};

// Does a save exist for the current player?  C ref: restore_saved_game().
export function have_saved_game() {
    const key = saveFileKey();
    const storage = game.storage;
    return !!(key && storage && typeof storage.getItem === 'function'
              && storage.getItem(key) != null);
}

// C ref: allmain.c welcome(FALSE) — "... the<race> <role>, welcome back to
// NetHack!".  Alignment/gender words are shown only when they differ from the
// original (they don't for a straightforward save/restore), so buf is just the
// race adjective and role name.
function welcome_back_message() {
    const urole = game.urole || {};
    const urace = game.urace || {};
    const female = !!game.flags?.female;
    const roleNm = (female && urole.name?.f) ? urole.name.f : urole.name?.m;
    const buf = ` ${urace.adj || 'human'} ${roleNm || 'Adventurer'}`;
    return `${Hello(urole.mnum)} ${game.plname || 'Hero'}, the${buf}, welcome back to NetHack!`;
}

// C ref: role.c role_init(), which restore.c restgamestate() calls to "Reset the
// initial role, race, gender, and alignment".  Only two of its steps can reach
// the PRNG, and on a restore exactly one of them can fire:
//   * "Fix up the quest nemesis" — quest_status.nemgend is read off the species'
//     M2_NEUTER/M2_FEMALE/M2_MALE flag and only ROLLED (rn2(100)) for a nemesis
//     that carries none of the three.  Recorded restores bear this out: the
//     Wizard's (whose nemesis is the Dark One) draws rn2(100) here, the
//     Valkyrie/Monk/Knight/Priest ones draw nothing.
//   * the god-names fixup, whose randrole() loop is gated on
//     `flags.pantheon == -1` /* new game */ — a restored flags comes out of the
//     save file with the pantheon already chosen, which is why the recorded
//     Priest restore draws no randrole() even though a fresh Priest game does.
// Only the roll is mirrored here: assigning the table's fixed gender would make
// a restored game disagree with the newgame path (fastforward.js's role_init
// leaves quest_nemgend unset for the non-rolling roles), and the save blob
// already carries whatever the saving segment computed.
function role_init_nemgend() {
    if (quest_nemgend_or_null() == null)
        game.quest_nemgend = (rn2(100) < 50) ? 1 : 0;
}

// C: `wizard` is flags.debug and `discover` is flags.explore; our options parser
// records the play mode as flags.playmode (bones.js does the same widening).
function is_wizard() { return !!game.flags?.debug; }
function is_discover() {
    const f = game.flags || {};
    return !!(f.explore || f.discover || f.playmode === 'explore');
}

// C ref: restore.c dorecover() — `if (!wizard && !discover) delete_savefile();`
// A normal restore CONSUMES its save file, so a later segment that starts under
// the same character name begins a new game instead of restoring the same state
// twice.  In wizard/discover mode unixmain.c asks instead (below).
function delete_savefile() {
    const key = saveFileKey();
    const storage = game.storage;
    if (key && storage && typeof storage.removeItem === 'function') storage.removeItem(key);
}

// C ref: sys/unix/unixmain.c main() — after a successful dorecover(), wizard and
// discover mode get asked whether to keep the save file (wd_message() prints
// nothing for a plain wizard-mode restore: its three arms all need an error flag
// or `discover`).  The question is a topline write, so it forces the welcome
// line's --More-- first; answering 'n' (which every quitchar does, the prompt's
// default) deletes the file, 'y' keeps it.
async function ask_about_keeping_savefile() {
    if (!is_wizard() && !is_discover()) return;
    await topl_more();
    const ans = await y_n('Do you want to keep the save file?', 'yn', 'n');
    if (ans === 'n') delete_savefile();
}

// C ref: allmain.c moveloop_preamble(resuming=TRUE) tail — the steps the
// `if (resuming)` / unconditional arms run after the moon-phase report.
// fix_shop_damage() has no port yet (it only matters for a hero who damaged shop
// walls before saving), so it is the one omission here.
async function resume_preamble_tail() {
    const u = game.u || (game.u = {});
    game.disp = game.disp || {};
    game.disp.botlx = true;
    await read_engr_at(u.ux, u.uy); /* subset of pickup() */
    await encumber_msg();
    // gd.defer_see_monsters is set by restgamestate so the restore itself does
    // not paint monsters too early; moveloop_preamble releases it.
    see_monsters();
    u.uz0 = u.uz0 || {};
    u.uz0.dlevel = u.uz?.dlevel;
    game.context = game.context || {};
    game.context.move = 0;
}

// C ref: allmain.c moveloop_preamble(resuming=TRUE) — the moon-phase / Friday
// the 13th messages for the restoring process's date.  Each message forces the
// previous top-line message's --More-- (topl_more) first; the welcome line's
// --More-- naturally spans two captured frames because the xwaitforspace loop
// ignores the non-dismiss keys queued before the space that dismisses it.
async function restore_preamble_messages() {
    const u = game.u || (game.u = {});
    const moonphase = phase_of_the_moon();
    const msgs = [];
    if (moonphase === FULL_MOON) {
        msgs.push('You are lucky!  Full moon tonight.');
        u.uluck = (u.uluck || 0) + 1; // change_luck(1)
    } else if (moonphase === NEW_MOON) {
        msgs.push('Be careful!  New moon tonight.');
    }
    if (friday_13th()) {
        msgs.push('Watch out!  Bad things can happen on Friday the 13th.');
        u.uluck = (u.uluck || 0) - 1; // change_luck(-1)
    }
    for (const m of msgs) {
        await topl_more();
        await pline(m);
    }
}

// C ref: restore.c dorecover() + unixmain.c restore_saved_game(), followed by
// allmain.c moveloop_preamble(resuming=TRUE).  Returns true when a game was
// restored (so start() skips newgame()).
export async function dorestore() {
    const key = saveFileKey();
    const storage = game.storage;
    const blob = storage.getItem(key);
    if (blob == null) return false;

    const saved = deserializeGameState(blob);

    // Splice the restored state into the live game object, but preserve the
    // restoring segment's runtime environment (these were set up by
    // jsmain.start() and are intentionally NOT in the save blob).
    const keepDisplay = game.nhDisplay;
    const keepHook = game._preNhgetchHook;
    const keepDatetime = game.datetime;
    const keepStorage = game.storage;
    const keepMock = game.mockStorage;
    const keepCoreCtx = game.coreCtx;
    Object.assign(game, saved);
    game.nhDisplay = keepDisplay;
    game._preNhgetchHook = keepHook;
    game.datetime = keepDatetime;
    game.storage = keepStorage;
    game.mockStorage = keepMock;
    game.coreCtx = keepCoreCtx;

    // C ref: restore.c restgamestate() — role_init() runs partway through the
    // state reload, BEFORE restore_luadata()'s Lua-state creation below, so its
    // nemesis-gender roll comes first in the stream.
    role_init_nemgend();

    // C ref: restore.c restgamestate() tail -> nhlua.c restore_luadata(), whose
    // `if (!gl.luacore) l_nhcore_init();` fires because a freshly launched
    // process has no Lua state yet.  nhl_init() loads dat/nhlib.lua, whose
    // top-level `shuffle(align)` over a 3-element list is the ONLY PRNG
    // consumption on the whole restore path — rn2(3) then rn2(2), which is
    // exactly what the recorded restore segments draw before their first input
    // boundary.  It must run AFTER the state splice above, since the blob
    // carries the SAVING segment's splev_align and this re-rolls it.
    l_nhcore_init();

    // C ref: restore.c dorecover() — `if (!wizard && !discover) delete_savefile()`.
    if (!is_wizard() && !is_discover()) delete_savefile();

    // C ref: restore.c — "recompute vision (not saved)"; then docrt() repaints.
    init_vision_globals();
    vision_reset();
    game.vision_full_recalc = 0;
    vision_recalc(0);

    // C ref: restore.c dorecover() — run_timers(), "expire all timers that have
    // gone off while away", between vision_reset() and docrt().  The blob
    // restores svm.moves unchanged, so nothing is normally due; it still matters
    // for a floor corpse whose rot timer came due on a turn the port's own
    // nh_timeout did not reap.
    run_object_timers();

    // clear_nhwindow(WIN_MESSAGE) + docrt() (dorecover tail).
    game._pending_message = '';
    game._toplin = 0;
    game._toplines = '';
    await cls();
    await docrt();
    await flush_screen(1);
    await bot();

    // C ref: dorecover() tail -> welcome(FALSE), check_special_room(FALSE); then
    // unixmain's wizard/discover save-file question; then moveloop_preamble(TRUE).
    await pline(welcome_back_message());
    await check_special_room(false);
    await ask_about_keeping_savefile();
    await restore_preamble_messages();
    await resume_preamble_tail();

    return true;
}

/* ==========================================================================
 * src/restore.c, translated.
 *
 * INERT: nothing above this line calls into this section, and this section
 * calls nothing above it except the four helpers it shares with dorestore()
 * (welcome_back_message / is_wizard / is_discover / delete_savefile).
 * dorestore() is still the live restore path; the note at the very bottom of
 * this file says how the two differ.
 *
 * C's restore path is a byte stream: every `Sfi_<type>(nhfp, &field, "label")`
 * consumes exactly the bytes save.c's matching `Sfo_<type>(nhfp, &field,
 * "label")` wrote, so FIELD ORDER is the entire contract of this file — none of
 * the reads below may be reordered or tidied.  js/save.js already translated
 * the writer half, and it emits one plain JS object per C record keyed by those
 * same labels (`{ obj, oname_length, oname, omonst, ... }`), so the faithful
 * inverse is a reader over those records rather than over bytes.
 * js/storage.js is frozen, hence the local reader below.
 * ========================================================================== */

/* -- NHFILE stand-in (sfstruct.c / sfbase.c; coverage marks both N/A) ------ */

// An `nhfp` here is { recs, ftype, mode, eof }: `recs` is the record currently
// being read.  C streams ONE file so every function below is handed the same
// nhfp; save.js nests one record per C record, so a caller descends with
// nhfp_sub() first.  The order of the reads AND of the descents is C's byte
// order, which is what this translation preserves.
function nhfile_reader(recs, ftype = NHF_SAVEFILE) {
    return { recs: recs || {}, ftype, mode: READING, eof: false };
}

function nhfp_sub(nhfp, label) {
    return nhfile_reader(Sfi(nhfp, label, null), nhfp?.ftype);
}

// save.c passes labels like "obj-oname_length"; save.js keys the record on the
// tail ("oname_length"), except where it joined the whole label with an
// underscore ("plname-size" -> "plname_size").  Try all three spellings.
function sfi_key(rec, label) {
    if (rec == null || typeof rec !== 'object') return null;
    const has = (k) => Object.prototype.hasOwnProperty.call(rec, k);
    if (has(label)) return label;
    const dash = label.indexOf('-');
    if (dash >= 0) {
        const tail = label.slice(dash + 1);
        if (has(tail)) return tail;
        const under = label.replace(/-/g, '_');
        if (has(under)) return under;
    }
    return null;
}

/* the generic Sfi_<type>(nhfp, &field, "label") — returns the named field */
function Sfi(nhfp, label, dflt) {
    const rec = nhfp?.recs;
    const k = sfi_key(rec, label);
    return k === null ? dflt : rec[k];
}

/* one element of a field C reads in a counted loop (mvitals, spl_book, ...) */
function Sfi_at(nhfp, label, i, dflt) {
    const v = Sfi(nhfp, label, null);
    return (Array.isArray(v) && v[i] !== undefined && v[i] !== null) ? v[i] : dflt;
}

/* Sfi_<struct>(nhfp, ptr, "tag") — read into the caller's ALREADY-ALLOCATED
   struct, which is why the allocate-then-read order below is load-bearing. */
function Sfi_into(dest, src) {
    if (!dest || !src || dest === src || typeof src !== 'object') return dest;
    Object.assign(dest, src);
    return dest;
}

// Sfi_int(nhfp, &buflen, "...-<x>_length").  save.js's writer omits the length
// field for some slots it does write (saveobj() emits `omonst` but never
// `omonst_length`), so fall back to the presence of the data the length is FOR.
function Sfi_len(nhfp, lenlabel, datalabel) {
    const n = Sfi(nhfp, lenlabel, undefined);
    if (n !== undefined && n !== null) return n | 0;
    const d = Sfi(nhfp, datalabel, undefined);
    return (d === undefined || d === null) ? 0 : 1;
}

// A chain C reads as "one length prefix per entry, then a terminator" was
// written by save.js as an array plus the single terminator value; hand the
// loops below exactly what C reads off the stream.
function len_chain(nhfp, listkey, termlabel) {
    const rec = nhfp?.recs || {};
    const list = Array.isArray(rec[listkey]) ? rec[listkey] : [];
    let i = 0;
    return {
        len: () => (i < list.length) ? 1 : (Sfi(nhfp, termlabel, -1) | 0),
        next: () => list[i++],
    };
}

// A chain C closes with an all-zero struct rather than a -1 (traps, fruit):
// past the end the reader hands back that zero struct.
function struct_chain(nhfp, listkey, zero) {
    const rec = nhfp?.recs || {};
    const list = Array.isArray(rec[listkey]) ? rec[listkey] : [];
    let i = 0;
    return { next: () => (i < list.length ? list[i++] : zero) };
}

// dorecover()'s trailing `Sfi_xint8(&ltmp); if (nhfp->eof) break;` loop over
// the other levels.  Running off the end is what sets eof.
function level_seq(nhfp) {
    const list = Array.isArray(nhfp?.recs?.otherlevels) ? nhfp.recs.otherlevels : [];
    let i = 0;
    return {
        next_number: () => {
            if (i >= list.length) { if (nhfp) nhfp.eof = true; return 0; }
            return (list[i].level_number ?? list[i].dlvl ?? 0) | 0;
        },
        level_reader: () => nhfile_reader(list[i++]?.level, nhfp?.ftype),
    };
}

/* -- local stand-ins for helpers this port keeps elsewhere or not at all ---- */

/* C ref: restore.c:65 #define Is_IceBox(o) */
function Is_IceBox(o) { return o?.otyp === ICE_BOX; }

// C ref: obj.h:388 age_is_relative(otmp).  NOT the same list as js/zap.js's and
// js/pickup.js's private copies: both of those include MAGIC_LAMP (which the
// macro's comment says it deliberately excludes) and drop POT_OIL.  Transcribed
// from the header, because restobjchn()'s bones age shift keys on it.
function age_is_relative(otmp) {
    return otmp.otyp === BRASS_LANTERN || otmp.otyp === OIL_LAMP
        || otmp.otyp === CANDELABRUM_OF_INVOCATION
        || otmp.otyp === TALLOW_CANDLE || otmp.otyp === WAX_CANDLE
        || otmp.otyp === POT_OIL;
}

// C ref: worn.c setworn(obj, mask).  worn.c's setworn() is UNPORTED; the two
// module-private reductions this port has (js/invent.js:821, js/u_init.js:602)
// only stamp owornmask, and js/save.js keeps its own setworn_bc() for exactly
// the W_BALL/W_CHAIN pair the save/restore path needs.  Same split here rather
// than a third copy pretending to be the general function.
function setworn_rst(obj, mask) {
    if (obj) obj.owornmask = mask;
    if (mask & W_BALL) game.uball = obj;
    if (mask & W_CHAIN) game.uchain = obj;
}

// C ref: mon.c newmextra()/newepri()/neweshk()/newemin()/newedog()/newebones().
// This port has no mextra allocators except js/vault.js:463 newegd(); an mextra
// component is a plain object, so "allocate" is "create the slot".
function mextra_slot(mtmp, key) {
    if (!mtmp.mextra) mtmp.mextra = {};
    if (!mtmp.mextra[key]) mtmp.mextra[key] = {};
    return mtmp.mextra[key];
}

/* C ref: mon.c monsndx(ptr) — js/mon.js:xxx and js/eat.js keep the same
   one-liner module-private; the index rides on the permonst as pmidx. */
function monsndx_rst(ptr) { return ptr?.pmidx ?? NON_PM; }

/* C ref: monst.h ismnum(mnum) — (mnum) >= LOW_PM && (mnum) < NUMMONS */
function ismnum_rst(mnum) { return mnum >= 0 && mnum < NUMMONS_RST; }

/* C ref: dungeon.c:1376 ledger_no().  js/save.js (ledger_no_sv) and
   js/bones.js keep the same private copy; all three sit below dungeon.js. */
function ledger_no_rst(lev) {
    const dng = game.dungeons?.[lev?.dnum ?? 0];
    if (!dng) return null;
    return (lev?.dlevel ?? 1) + (dng.ledger_start ?? 0);
}

/* C ref: dungeon.c assign_level()/on_level() — js/vault.js:113-114 keeps the
   same pair module-private. */
function assign_level_rst(dst, src) {
    if (!dst) return;
    dst.dnum = src?.dnum ?? 0;
    dst.dlevel = src?.dlevel ?? 0;
}
function on_level_rst(a, b) {
    return !!a && !!b && a.dnum === b.dnum && a.dlevel === b.dlevel;
}

/* C ref: dungeon.c Is_branchlev(lev) — js/bones.js:xxx keeps a private copy.
   Returns the branch whose end1/end2 is this level, else null. */
function Is_branchlev_rst(lev) {
    for (const br of (game.branches || []))
        if (on_level_rst(lev, br.end1) || on_level_rst(lev, br.end2)) return br;
    return null;
}

/* C ref: monst.h NUMMONS / spell.h MAXSPELL.  Read through the same private
   copies js/save.js uses: neither js/disprng.js nor js/spell.js is in this
   file's static import closure and adding one would reorder ESM evaluation. */
const NUMMONS_RST = 383;   /* js/disprng.js NUMMONS */
const MAXSPELL_RST = 25;   /* js/spell.js MAXSPELL */
const N_PER_BUCKET = 64;   /* restore.c:44 */
const BUFSZ_RST = 256;     /* config.h BUFSZ */

/* C ref: objects[] PICK_AXE (js/mkobj.js:475) / GRAPPLING_HOOK (:476).
   js/mkobj.js exports neither otyp; every consumer keeps a private literal
   (js/shkroom.js:24, js/eat.js:1895), so this file does too. */
const PICK_AXE_RST = 259;
const GRAPPLING_HOOK_RST = 260;

/* C ref: restore.c:516/518 — SYSCF builds read sysopt.check_save_uid, the rest
   hardcode TRUE.  getuid() has no analogue in the sandbox and js/save.js writes
   the uid out as 0, so the check passes on a save this port wrote. */
const SYSOPT_CHECK_SAVE_UID = true;
function getuid_rst() { return (game.sysopt?.uid ?? game.uid ?? 0) | 0; }

/* C ref: hacklib.c time_from_yyyymmddhhmmss() / getnow() (coverage N/A). */
function time_from_yyyymmddhhmmss_rst(buf) {
    const s = String(buf ?? '');
    if (s.length < 14) return 0;
    const n = (a, b) => Number(s.slice(a, b));
    return Date.UTC(n(0, 4), n(4, 6) - 1, n(6, 8), n(8, 10), n(10, 12), n(12, 14)) / 1000;
}
function getnow_rst() {
    return Math.floor((game.datetime?.getTime?.() ?? Date.now()) / 1000);
}

/* C ref: files.c create_levelfile() (coverage N/A).  This port has NO level
   files at all — js/save.js's create_levelfile_sv() is the same stub — so this
   names the seam rather than pretending to open one. */
function create_levelfile_rst(_lev, _whynot) { return null; }

/* C ref: invent.c setuwep(obj) — js/invent.js:439 exports setuwep_slot(), the
   slot half only; the "unweapon reminder" recomputation restgamestate() wants
   from it is the line that follows the call there. */
function setuwep_rst(obj) { game.uwep = obj || null; }

/* levl[c][r] */
function levl_rst(c, r) {
    const lev = game.level || (game.level = new GameMap());
    return lev.locations?.[c]?.[r] ?? null;
}

/* ======================= restore.c:70 find_lev_obj ======================== */

/* Recalculate svl.level.objects[x][y], since this info was not saved. */
export function find_lev_obj() {
    let fobjtmp = [];
    let otmp;

    /* C zeroes svl.level.objects[x][y] for the whole map here.  This port has
       no per-square object heads — the floor pile IS game.level.objects and
       place_object() (js/mkobj.js:1847) finds a tile's pile by scanning it — so
       C's clearing loop is the emptying of that one array below. */

    /*
     * Reverse the entire fobj chain, which is necessary so that we can
     * place the objects in the proper order.  Make all obj in chain
     * OBJ_FREE so place_object will work correctly.
     *
     * game.level.objects is ordered deepest-first (place_object appends), i.e.
     * C's fobj chain REVERSED, so index 0 is C's tail: popping from the end
     * walks C's chain head-first and the unshift below is C's reversal.
     */
    const fobj = game.level?.objects;
    while (Array.isArray(fobj) && fobj.length) {
        otmp = fobj.pop();          /* otmp = fobj; fobj = otmp->nobj */
        otmp.nobj = fobjtmp[0] ?? null;
        /* js/mkobj.js place_object() stamps obj.where as the STRING 'floor',
           not objclass.h's numeric enum; js/save.js's saveobjchn() writes the
           numeric OBJ_FREE here too, so the mismatch is pre-existing. */
        otmp.where = OBJ_FREE;
        fobjtmp.unshift(otmp);      /* fobjtmp = otmp */
    }
    /* fobj should now be empty */

    /* Set svl.level.objects (as well as reversing the chain back again) */
    while (fobjtmp.length) {
        otmp = fobjtmp.shift();     /* fobjtmp = otmp->nobj */
        place_object(otmp, otmp.ox, otmp.oy);

        /* fixup(s) performed when restoring the level that the hero
           is on, rather than just an arbitrary one */
        if (game.u?.uz?.dlevel) { /* 0 during full restore until current level */
            /* handle uchain and uball when they're on the floor */
            if (otmp.owornmask & (W_BALL | W_CHAIN))
                setworn_rst(otmp, otmp.owornmask);
        }
    }
}

/* ======================= restore.c:112 inven_inuse ======================== */

/* Things that were marked "in_use" when the game was saved (ex. via the
 * infamous "HUP" cheat) get used up here.
 */
export async function inven_inuse(quietly) {
    let otmp;

    /* C's `otmp2 = otmp->nobj` reads the successor before useup() can free the
       node; gi.invent is an array here, so the snapshot is the same protection
       and there is no separate successor to carry. */
    const chain = [...(game.invent || [])];
    for (otmp of chain) {
        if (otmp.in_use) {
            if (!quietly)
                await pline(`Finishing off ${xname(otmp)}...`);
            useup(otmp);
        }
    }
}

/* ======================= restore.c:129 restlevchn ======================== */

export function restlevchn(nhfp) {
    let cnt = 0;
    let tmplev, x;

    game.sp_levchn = null;                          /* svs.sp_levchn */
    cnt = Sfi(nhfp, 'levchn-lev_count', 0) | 0;
    for (let i = 0; cnt > 0; cnt--, i++) {
        tmplev = {};                                /* alloc(sizeof(s_level)) */
        Sfi_into(tmplev, Sfi_at(nhfp, 'levchn-s_level', i, null));

        if (!game.sp_levchn)
            game.sp_levchn = tmplev;
        else {
            for (x = game.sp_levchn; x.next; x = x.next)
                ;
            x.next = tmplev;
        }
        tmplev.next = null;
    }
}

/* ======================= restore.c:152 restdamage ======================== */

export function restdamage(nhfp) {
    let dmgcount = 0;
    let counter;
    let tmp_dam;
    const ghostly = (nhfp?.ftype === NHF_BONESFILE);

    dmgcount = Sfi(nhfp, 'damage-damage_count', 0) >>> 0;
    counter = dmgcount | 0;

    if (!counter)
        return;
    let i = 0;
    do {
        tmp_dam = {};                               /* alloc(sizeof *tmp_dam) */

        Sfi_into(tmp_dam, Sfi_at(nhfp, 'damage', i++, null));
        if (ghostly)
            tmp_dam.when = (tmp_dam.when | 0) + ((game.moves | 0) - (game.omoves | 0));

        tmp_dam.next = game.level?.damagelist ?? null;
        if (game.level) game.level.damagelist = tmp_dam;
    } while (--counter > 0);
}

/* ========================= restore.c:182 restobj ========================= */

/* restore one object */
export function restobj(nhfp, otmp) {
    let buflen = 0;
    let omid = 0;

    Sfi_into(otmp, Sfi(nhfp, 'obj', null));
    otmp.lua_ref_cnt = 0;
    /* next object pointers are invalid; otmp->cobj needs to be left
       as is--being non-null is key to restoring container contents */
    otmp.nobj = otmp.nexthere = null;
    /* non-null oextra needs to be reconstructed */
    if (otmp.oextra) {
        otmp.oextra = newoextra();

        /* oname - object's name */
        buflen = Sfi_len(nhfp, 'obj-oname_length', 'obj-oname');
        if (buflen > 0) { /* includes terminating '\0' */
            /* new_oname(otmp, buflen) (js/do_name.js:269) only ensures oextra
               exists, which newoextra() above already did. */
            otmp.oextra.oname = Sfi(nhfp, 'obj-oname', '');
        }

        /* omonst - corpse or statue might retain full monster details */
        buflen = Sfi_len(nhfp, 'obj-omonst_length', 'obj-omonst');
        if (buflen > 0) {
            newomonst(otmp);
            /* this is actually a monst struct, so we
               can just defer to restmon() here */
            restmon(nhfp_sub(nhfp, 'obj-omonst'), OMONST(otmp));
        }

        /* omailcmd - feedback mechanism for scroll of mail */
        buflen = Sfi_len(nhfp, 'obj-omailcmd_length', 'obj-omailcmd');
        if (buflen > 0) {
            const omailcmd = Sfi(nhfp, 'obj-omailcmd', '');  /* alloc(buflen) */

            new_omailcmd(otmp, omailcmd);
            /* free(omailcmd) */
        }

        /* omid - monster id number, connecting corpse to ghost */
        newomid(otmp); /* superfluous; we're already allocated otmp->oextra */
        omid = Sfi(nhfp, 'obj-omid', 0) >>> 0;
        otmp.oextra.omid = omid;                    /* OMID(otmp) = omid */
    }
}

/* ======================== restore.c:231 restobjchn ======================== */

// C returns the head of an `nobj` chain; every consumer in this port holds an
// ARRAY instead (place_object() requires game.level.objects to be one, and
// bones.js walks mon.minvent / obj.cobj as arrays), so the array is what comes
// back.  C's `first`/`otmp2` linking is kept because the tail check at the end
// is part of the control flow.
export async function restobjchn(nhfp, frozen) {
    let otmp, otmp2 = null;
    let first = null;
    let buflen = 0;
    const ghostly = (nhfp?.ftype === NHF_BONESFILE);
    const cur = len_chain(nhfp, 'objs', 'obj-obj_length');
    const chain = [];

    while (1) {
        buflen = cur.len();
        if (buflen === -1)
            break;

        otmp = {};                  /* newobj() — mkobj.c has no JS allocator;
                                       objects in this port are plain records */
        restobj(nhfile_reader(cur.next(), nhfp?.ftype), otmp);
        chain.push(otmp);
        if (!first)
            first = otmp;
        else
            otmp2.nobj = otmp;

        if (ghostly) {
            const nid = next_ident();

            add_id_mapping(otmp.o_id, nid);
            otmp.o_id = nid;
        }
        if (ghostly && otmp.otyp === SLIME_MOLD)
            await ghostfruit(otmp);
        /* Ghost levels get object age shifted from old player's clock
         * to new player's clock.  Assumption: new player arrived
         * immediately after old player died.
         */
        if (ghostly && !frozen && !age_is_relative(otmp))
            otmp.age = (game.moves | 0) - (game.omoves | 0) + (otmp.age | 0);

        /* get contents of a container or statue */
        if (Has_contents(otmp)) {
            let otmp3;

            /* save.js writes the contents as the NEXT element of the same
               list, `{ cobj: <chain record> }`, exactly where C recurses. */
            otmp.cobj = await restobjchn(
                nhfile_reader(cur.next()?.cobj, nhfp?.ftype), Is_IceBox(otmp));
            /* restore container back pointers */
            for (otmp3 of (otmp.cobj || []))
                otmp3.ocontainer = otmp;
        }

        if (otmp.bypass)
            otmp.bypass = 0;
        if (!ghostly) {
            /* fix the pointers */
            const ctx = game.context || {};
            if (otmp.o_id === ctx.victual?.o_id)
                ctx.victual.piece = otmp;
            if (otmp.o_id === ctx.tin?.o_id)
                ctx.tin.tin = otmp;
            if (otmp.o_id === ctx.spbook?.o_id)
                ctx.spbook.book = otmp;
        }
        otmp2 = otmp;
    }
    if (first && otmp2.nobj) {
        await impossible('Restobjchn: error reading objchn.');
        otmp2.nobj = null;
    }
    return chain;
}

/* ========================= restore.c:307 restmon ========================= */

/* restore one monster */
export function restmon(nhfp, mtmp) {
    let buflen = 0, mc = 0;

    Sfi_into(mtmp, Sfi(nhfp, 'monst', null));

    /* next monster pointer is invalid */
    mtmp.nmon = null;
    /* non-null mextra needs to be reconstructed */
    if (mtmp.mextra) {
        mtmp.mextra = {};                           /* newmextra() */

        /* mgivenname - monster's name */
        buflen = Sfi_len(nhfp, 'monst-mgivenname_length', 'monst-mgivenname');
        if (buflen > 0) { /* includes terminating '\0' */
            /* new_mgivenname(mtmp, buflen) (js/do_name.js:262) only ensures
               mextra exists, which the assignment above already did. */
            mtmp.mextra.mgivenname = Sfi(nhfp, 'monst-mgivenname', '');
        }
        /* egd - vault guard */
        buflen = Sfi_len(nhfp, 'monst-egd_length', 'monst-egd');
        if (buflen > 0) {
            mextra_slot(mtmp, 'egd');               /* newegd(mtmp) */
            Sfi_into(EGD(mtmp), Sfi(nhfp, 'monst-egd', null));
        }
        /* epri - temple priest */
        buflen = Sfi_len(nhfp, 'monst-epri_length', 'monst-epri');
        if (buflen > 0) {
            mextra_slot(mtmp, 'epri');              /* newepri(mtmp) */
            Sfi_into(EPRI(mtmp), Sfi(nhfp, 'monst-epri', null));
        }
        /* eshk - shopkeeper */
        buflen = Sfi_len(nhfp, 'monst-eshk_length', 'monst-eshk');
        if (buflen > 0) {
            mextra_slot(mtmp, 'eshk');              /* neweshk(mtmp) */
            Sfi_into(ESHK(mtmp), Sfi(nhfp, 'monst-eshk', null));
        }
        /* emin - minion */
        buflen = Sfi_len(nhfp, 'monst-emin_length', 'monst-emin');
        if (buflen > 0) {
            mextra_slot(mtmp, 'emin');              /* newemin(mtmp) */
            Sfi_into(EMIN(mtmp), Sfi(nhfp, 'monst-emin', null));
        }
        /* edog - pet */
        buflen = Sfi_len(nhfp, 'monst-edog_length', 'monst-edog');
        if (buflen > 0) {
            mextra_slot(mtmp, 'edog');              /* newedog(mtmp) */
            Sfi_into(EDOG(mtmp), Sfi(nhfp, 'monst-edog', null));
            /* save or bones held a relative time */
            relative_time_to_moves(EDOG(mtmp), 'droptime');
            relative_time_to_moves(EDOG(mtmp), 'hungrytime');
            /* sanity check to prevent rn2(0) */
            if (EDOG(mtmp).apport <= 0) {
                EDOG(mtmp).apport = 1;
            }
        }
        /* ebones */
        buflen = Sfi_len(nhfp, 'monst-ebones_length', 'monst-ebones');
        if (buflen > 0) {
            mextra_slot(mtmp, 'ebones');            /* newebones(mtmp) */
            Sfi_into(EBONES(mtmp), Sfi(nhfp, 'monst-ebones', null));
        }
        /* mcorpsenm - obj->corpsenm for mimic posing as corpse or
           statue (inline int rather than pointer to something) */
        mc = Sfi(nhfp, 'monst-mcorpsenm', -1) | 0;
        /* MCORPSENM(mtmp) = mc — const.js's MCORPSENM()/MGIVENNAME() are
           getters, so C's lvalue-macro writes are slot assignments here. */
        mtmp.mextra.mcorpsenm = mc;
    } /* mextra */
}

/* ======================== restore.c:376 restmonchn ======================== */

/* As restobjchn(): C's chain head becomes this port's array. */
export async function restmonchn(nhfp) {
    let mtmp, mtmp2 = null;
    let first = null;
    let buflen = 0;
    let offset;
    const ghostly = (nhfp?.ftype === NHF_BONESFILE);
    const cur = len_chain(nhfp, 'mons', 'monst-monst_length');
    const chain = [];

    while (1) {
        buflen = cur.len();
        if (buflen === -1)
            break;

        mtmp = {};                  /* newmonst() — mon.c has no JS allocator */
        restmon(nhfile_reader(cur.next(), nhfp?.ftype), mtmp);
        chain.push(mtmp);
        if (!first)
            first = mtmp;
        else
            mtmp2.nmon = mtmp;

        if (ghostly) {
            const nid = next_ident();

            add_id_mapping(mtmp.m_id, nid);
            mtmp.m_id = nid;
        }
        offset = mtmp.mnum;
        mtmp.data = monster_by_pmidx(offset);       /* &mons[offset] */
        if (ghostly) {
            const mndx = (mtmp.cham === NON_PM) ? monsndx_rst(mtmp.data)
                                                : mtmp.cham;

            if (propagate(mndx, true, ghostly) === 0) {
                /* cookie to trigger purge in getbones() */
                mtmp.mhpmax = DEFUNCT_MONSTER;
            }
        }

        if (mtmp.minvent) {
            let obj;
            mtmp.minvent = await restobjchn(
                nhfile_reader(cur.next()?.minvent, nhfp?.ftype), false);
            /* restore monster back pointer */
            for (obj of mtmp.minvent)
                obj.ocarry = mtmp;
        }

        if (mtmp.mw) {
            let obj = null;

            for (const o of (mtmp.minvent || []))
                if (o.owornmask & W_WEP) { obj = o; break; }
            if (obj)
                mtmp.mw = obj;
            else {
                mtmp.mw = null;                     /* MON_NOWEP(mtmp) */
                await impossible('bad monster weapon restore');
            }
        }

        if (mtmp.isshk) {
            const { restshk } = await import('./shk.js');
            restshk(mtmp, ghostly);
        }
        if (mtmp.ispriest) {
            /* UNPORTED: restpriest() (priest.c) */
        }

        if (!ghostly) {
            if (mtmp.m_id === game.context?.polearm?.m_id)
                game.context.polearm.hitmon = mtmp;
        }
        mtmp2 = mtmp;
    }
    if (first && mtmp2.nmon) {
        await impossible('Restmonchn: error reading monchn.');
        mtmp2.nmon = null;
    }
    return chain;
}

/* ======================= restore.c:468 loadfruitchn ====================== */

/* the fruit chain really is a linked list in this port (js/save.js's
   savefruitchn walks game.ffruit by `nextf`), so this returns C's head. */
export function loadfruitchn(nhfp) {
    let flist, fnext;
    const cur = struct_chain(nhfp, 'fruits', { fid: 0 });

    flist = null;
    for (;;) {
        fnext = {};                                 /* newfruit() */
        Sfi_into(fnext, cur.next());                /* Sfi_fruit(..., "fruit") */
        if (fnext.fid !== 0) {
            fnext.nextf = flist;
            flist = fnext;
        } else
            break;
    }
    /* dealloc_fruit(fnext) — mkobj.c; JS is garbage-collected */
    return flist;
}

/* ======================= restore.c:487 freefruitchn ====================== */

export function freefruitchn(flist) {
    let fnext;

    while (flist) {
        fnext = flist.nextf;
        /* dealloc_fruit(flist) — mkobj.c; dropping the reference is the whole
           of it here, so the walk is all that is left of C's loop. */
        flist = fnext;
    }
}

/* ======================== restore.c:500 ghostfruit ======================= */

export async function ghostfruit(otmp) {
    let oldf;

    for (oldf = game.oldfruit; oldf; oldf = oldf.nextf)
        if (oldf.fid === otmp.spe)
            break;

    if (!oldf)
        await impossible('no old fruit?');
    else {
        const { fruitadd } = await import('./options.js');
        otmp.spe = fruitadd(oldf.fname, null);
    }
}

/* ======================= restore.c:525 restgamestate ===================== */

export async function restgamestate(nhfp) {
    let i;
    let newgameflags;                   /* struct flag */
    let newgamecontext;                 /* struct context_info */
    let bc_obj;
    let timebuf;
    let uid = 0;
    let defer_perm_invent, restoring_special;
    let otmp;

    uid = Sfi(nhfp, 'gamestate-uid', 0);
    game.nhuuid = Sfi(nhfp, 'nhuuid', game.nhuuid ?? null);
    game.moves = Sfi(nhfp, 'gamestate-moves', 0) | 0;
    if (SYSOPT_CHECK_SAVE_UID
        && uid !== getuid_rst()) { /* strange ... */
        if (!game.converted_savefile_loaded)
            /* for wizard mode, issue a reminder; for others, treat it
             * as an attempt to cheat and refuse to restore this file */
            await pline('Saved game was not yours.');
        if (is_wizard() || game.converted_savefile_loaded) {
            if (game.converted_savefile_loaded)
                game.converted_savefile_loaded = false;
        } else {
            return false;
        }
    }
    /* C's `newgamecontext = svc.context` is a struct COPY; a shallow clone is
       the analogue, and the aborted-restore path below assigns it straight
       back. */
    newgamecontext = { ...(game.context || {}) };
    Sfi_into(game.context, Sfi(nhfp, 'gamestate-context', null));
    relative_time_to_moves(game.context, 'seer_turn');
    relative_time_to_moves(game.context?.digging, 'lastdigtime');
    if (game.context?.warntype) {
        game.context.warntype.species =
            ismnum_rst(game.context.warntype.speciesidx)
            ? monster_by_pmidx(game.context.warntype.speciesidx)
            : null;
    }
    /* context.victual.piece, .tin.tin, .spellbook.book, and .polearm.hitmon
       are pointers which get set to Null during save and will be recovered
       via corresponding o_id or m_id while objs or mons are being restored */

    /* we want to be able to revert to command line/environment/config
       file option values instead of keeping old save file option values
       if partial restore fails and we resort to starting a new game */
    newgameflags = { ...(game.flags || {}) };
    Sfi_into(game.flags, Sfi(nhfp, 'gamestate-flags', null));

    /* avoid keeping permanent inventory window up to date during restore
       (setworn() calls update_inventory); attempting to include the cost
       of unpaid items before shopkeeper's bill is available is a no-no;
       named fruit names aren't accessible yet either */
    if (!game.iflags) game.iflags = {};
    defer_perm_invent = game.iflags.perm_invent;
    game.iflags.perm_invent = false;
    /* wizard and discover are actually flags.debug and flags.explore;
       player might be overriding the save file values for them;
       in the discover case, we don't want to set that for a normal
       game until after the save file has been removed */
    game.iflags.deferred_X = (newgameflags.explore && !is_discover());
    restoring_special = (is_wizard() || is_discover());
    if (newgameflags.debug) {
        /* authorized by startup code; wizard mode exists and is allowed */
        game.flags.debug = true;
        game.flags.explore = false;
        game.iflags.deferred_X = false;
    } else if (restoring_special) {
        /* specified by save file; check authorization now. */
        const { set_playmode } = await import('./options.js');
        set_playmode(game.flags?.playmode, {});
    }
    /* role_init() — role.c is UNPORTED as a whole; role_init_nemgend() above is
       this file's copy of the only PRNG-visible part of it, and dorestore()
       calls it at exactly this point in the stream. */
    role_init_nemgend();

    game.wreserve = Sfi(nhfp, 'wreserve', 0);
    game.wtreserved = Sfi(nhfp, 'wtreserved', 0);
    Sfi_into(game.u, Sfi(nhfp, 'gamestate-you', null));
    if (game.youmonst) game.youmonst.cham = game.u?.mcham;

    if (restoring_special && game.iflags.explore_error_flag) {
        /* savefile has wizard or explore mode, but player is no longer
           authorized to access either; can't downgrade mode any further, so
           fail restoration. */
        game.u.uhp = 0;
    }

    timebuf = Sfi(nhfp, 'gamestate-ubirthday', '');
    game.ubirthday = time_from_yyyymmddhhmmss_rst(timebuf);
    if (!game.urealtime) game.urealtime = {};
    game.urealtime.realtime = Sfi(nhfp, 'gamestate-realtime', 0);
    timebuf = Sfi(nhfp, 'gamestate-start_timing', '');
    game.urealtime.start_timing = time_from_yyyymmddhhmmss_rst(timebuf);

    /* current time is the time to use for next urealtime.realtime update */
    game.urealtime.start_timing = getnow_rst();

    {
        const { set_uasmon } = await import('./polyself.js');
        set_uasmon();
    }
    /* cliparound(u.ux, u.uy) — #ifdef CLIPPING */
    if (game.u.uhp <= 0 && (!Upolyd(game.u) || game.u.mh <= 0)) {
        game.u.ux = game.u.uy = 0; /* affects pline() [hence You()] */
        await pline('You were not healthy enough to survive restoration.');
        /* wiz1_level.dlevel is used by mklev.c to see if lots of stuff is
         * uninitialized, so we only have to set it and not the other stuff.
         */
        if (game.wiz1_level) game.wiz1_level.dlevel = 0;
        game.u.uz.dnum = 0;
        game.u.uz.dlevel = 1;
        /* revert to pre-restore option settings */
        game.iflags.deferred_X = false;
        game.iflags.perm_invent = defer_perm_invent;
        game.flags = newgameflags;
        game.context = newgamecontext;
        game.youmonst = {};                         /* cg.zeromonst */
        return false;
    }
    /* in case hangup save occurred in midst of level change */
    if (!game.u.uz0) game.u.uz0 = {};
    assign_level_rst(game.u.uz0, game.u.uz);

    /* this stuff comes after potential aborted restore attempts */
    {
        const { restore_killers } = await import('./end.js');
        /* js/end.js:1949 keys its reader on nhfp.records (its own Sfi_kinfo
           shifts that array), not on the .recs this file uses. */
        restore_killers({ records: Sfi(nhfp, 'killers', null)?.records ?? [] });
    }
    {
        const { restore_timers } = await import('./timeout.js');
        restore_timers(nhfp_sub(nhfp, 'timers_global').recs, RANGE_GLOBAL, 0);
    }
    {
        const { restore_light_sources } = await import('./light.js');
        restore_light_sources(Sfi(nhfp, 'light_sources_global', null));
    }

    game.invent = await restobjchn(nhfp_sub(nhfp, 'invent'), false);

    /* restore dangling (not on floor or in inventory) ball and/or chain */
    bc_obj = await restobjchn(nhfp_sub(nhfp, 'bc'), false);
    for (let k = 0; k < bc_obj.length; k++) {
        const o = bc_obj[k];

        o.nobj = null;
        if (o.owornmask)
            setworn_rst(o, o.owornmask);
    }
    game.migrating_objs = await restobjchn(nhfp_sub(nhfp, 'migrating_objs'), false);
    game.migrating_mons = await restmonchn(nhfp_sub(nhfp, 'migrating_mons'));

    if (!game.mvitals) game.mvitals = [];
    for (i = 0; i < NUMMONS_RST; ++i) {
        if (!game.mvitals[i]) game.mvitals[i] = {};
        Sfi_into(game.mvitals[i], Sfi_at(nhfp, 'gamestate-mvitals', i, null));
    }

    /*
     * There are some things after this that can have unintended display
     * side-effects too early in the game.
     * Disable see_monsters() here, re-enable it at the top of moveloop()
     */
    game.defer_see_monsters = true;

    /* this comes after inventory has been loaded */
    for (otmp of (game.invent || []))
        if (otmp.owornmask)
            setworn_rst(otmp, otmp.owornmask);

    /* reset weapon so that player will get a reminder about "bashing"
       during next fight when bare-handed or wielding an unconventional
       item; for pick-axe, we aren't able to distinguish between having
       applied or wielded it, so be conservative and assume the former */
    otmp = game.uwep;   /* `uwep' usually init'd by setworn() in loop above */
    game.uwep = null;   /* clear it and have setuwep() reinit */
    setuwep_rst(otmp);  /* (don't need any null check here) */
    if (!game.uwep || game.uwep.otyp === PICK_AXE_RST
        || game.uwep.otyp === GRAPPLING_HOOK_RST)
        game.unweapon = true;

    /* UNPORTED: restore_dungeon() (dungeon.c) */
    restlevchn(nhfp_sub(nhfp, 'levchn'));
    /* hero_seq isn't saved and restored because it can be recalculated */
    game.hero_seq = (game.moves | 0) << 3; /* normally handled in moveloop() */
    if (!game.quest_status) game.quest_status = {};
    Sfi_into(game.quest_status, Sfi(nhfp, 'gamestate-quest_status', null));

    if (!game.spl_book) game.spl_book = [];
    for (i = 0; i < (MAXSPELL_RST + 1); ++i) {
        if (!game.spl_book[i]) game.spl_book[i] = {};
        Sfi_into(game.spl_book[i], Sfi_at(nhfp, 'gamestate-spl_book', i, null));
    }
    {
        const { restore_artifacts } = await import('./artifact.js');
        restore_artifacts(Sfi(nhfp, 'artifacts', null));
    }
    /* UNPORTED: restore_oracles() (oracles.c) */
    game.pl_character = Sfi(nhfp, 'gamestate-pl_character', game.pl_character);
    if (game.flags)
        game.flags.pl_fruit = Sfi(nhfp, 'gamestate-pl_fruit', game.flags.pl_fruit);
    freefruitchn(game.ffruit); /* clean up fruit(s) made by initoptions() */
    game.ffruit = loadfruitchn(nhfp_sub(nhfp, 'fruitchn'));

    /* UNPORTED: restnames() (o_init.c) */
    restore_msghistory(nhfp_sub(nhfp, 'msghistory'));
    restore_gamelog(nhfp_sub(nhfp, 'gamelog'));
    {
        const { restore_luadata } = await import('./nhlua.js');
        restore_luadata(nhfp_sub(nhfp, 'luadata').recs);
    }
    /* must come after all mons & objs are restored */
    {
        const { relink_timers } = await import('./timeout.js');
        await relink_timers(false);
    }
    {
        const { relink_light_sources } = await import('./light.js');
        relink_light_sources(false);
    }
    adj_erinys(game.u?.ualign?.abuse);
    /* inventory display is now viable */
    game.iflags.perm_invent = defer_perm_invent;
    return true;
}

/* ====================== restore.c:742 restlevelstate ===================== */

/* update game state pointers to those valid for the current level (so we
   don't dereference a wild u.ustuck when saving game state, for instance) */
export function restlevelstate() {
    /*
     * Note: restoring steed and engulfer/holder/holdee is now handled
     * in getlev() and there's nothing left for restlevelstate() to do.
     */
    return;
}

/* ====================== restore.c:755 restlevelfile ====================== */

/* after getlev(), put current level into a level/lock file;
   essential when splitting a save file into individual level files */
export async function restlevelfile(ltmp) {
    const whynot = { s: '' };                       /* char whynot[BUFSZ] */
    let nhfp = null;

    nhfp = create_levelfile_rst(ltmp, whynot);
    if (!nhfp) {
        /* failed to create a new file; don't attempt to make a panic save */
        if (game.program_state) game.program_state.something_worth_saving = 0;
        /* C: panic("restlevelfile: %s", whynot).  There is no panic() in this
           port and no level files either, so the two-phase level rewrite is a
           no-op rather than a fatal error — see the note at the bottom. */
        return 2;
    }
    /* bufon(nhfp->fd) */
    nhfp.mode = WRITING | FREEING;
    await savelev(ltmp, nhfp.mode);   /* js/save.js:960 savelev(lev, mode) —
                                         C's savelev(nhfp, ltmp) carries the
                                         mode on the handle instead */
    /* close_nhfile(nhfp) */
    return 2;
}

/* ========================= restore.c:789 dorecover ======================= */

/*
 * restore_saved_game() prior to this left us at this position in
 * the savefile for dorecover():
 *
 *     format indicator                (1 byte)
 *     n = count of critical size list (1 byte)
 *     n bytes of critical sizes       (n bytes)
 *     version info
 * --> plnametmp = player name size (int, 2 bytes)
 *     player name (PL_NSIZ_PLUS)
 *     current level (including pets)
 *     (non-level-based) game state
 *     other levels
 *
 * The four record keys read below ('plname', 'currentlevel', 'gamestate',
 * 'otherlevels') are named after that comment: js/save.js's dosave0() does NOT
 * emit this container yet (it writes the whole `game` graph as JSON instead),
 * so this is the layout a wired-up savegamestate()/savelev() pair would fill.
 */
export async function dorecover(nhfp) {
    let ltmp = 0;
    let rtmp;
    const plname = { s: '' };                       /* svp.plname */

    /* suppress map display if some part of the code tries to update that */
    if (game.program_state) game.program_state.restoring = REST_GSTATE;

    get_plname_from_file(nhfp, plname, true);

    await getlev(nhfp_sub(nhfp, 'currentlevel'), 0, 0);
    if (!(await restgamestate(nhfp_sub(nhfp, 'gamestate')))) {
        /* NHFILE *tnhfp = get_freeing_nhfile() (files.c) */

        await display_nhwindow_message();
        await savelev(0, FREEING); /* discard current level */
        /* close_nhfile(tnhfp); close_nhfile(nhfp) */
        delete_savefile();
        if (game.u) game.u.usteed_mid = game.u.ustuck_mid = 0;
        if (game.program_state) game.program_state.restoring = 0;
        return 0;
    }
    /* after restgamestate() -> restnames() so that 'bases[]' is populated */
    /* UNPORTED: init_oclass_probs() (o_init.c) — recompute
       go.oclass_prob_totals[] */

    restlevelstate();
    /* savestateinlock() — #ifdef INSURANCE */
    rtmp = await restlevelfile(ledger_no_rst(game.u?.uz));
    if (rtmp < 2)
        return rtmp; /* dorecover called recursively */

    if (game.program_state) game.program_state.restoring = REST_LEVELS;

    /* these pointers won't be valid while we're processing the
     * other levels, but they'll be reset again by restlevelstate()
     * afterwards, and in the meantime at least u.usteed may mislead
     * place_monster() on other levels
     */
    if (game.u) {
        game.u.ustuck = null;
        game.u.usteed = null;
    }

    /* #ifdef MICRO: "You return to level %d in %s%s." plus the dot-per-level
       progress row.  Not a MICRO build. */

    if (!game.restoreinfo) game.restoreinfo = {};
    game.restoreinfo.mread_flags = 1; /* return despite error */
    const levels = level_seq(nhfp);
    while (1) {
        ltmp = levels.next_number();
        if (nhfp.eof)
            break;
        await getlev(levels.level_reader(), 0, ltmp);
        rtmp = await restlevelfile(ltmp);
        if (rtmp < 2)
            return rtmp; /* dorecover called recursively */
    }
    game.restoreinfo.mread_flags = 0;

    /* rewind_nhfile(nhfp) + validate(nhfp, 0, FALSE) (files.c) — one flat
       record set here, so there is nothing to rewind. */
    nhfp.eof = false;
    get_plname_from_file(nhfp, plname, true);

    /* not 0 nor REST_GSTATE nor REST_LEVELS */
    if (game.program_state) game.program_state.restoring = REST_CURRENT_LEVEL;

    await getlev(nhfp_sub(nhfp, 'currentlevel'), 0, 0);
    /* close_nhfile(nhfp) */
    restlevelstate();
    if (game.program_state)
        game.program_state.something_worth_saving = 1; /* useful data now exists */

    if (!is_wizard() && !is_discover())
        delete_savefile();
    if (Is_rogue_level(game.u?.uz)) {
        const { assign_graphics } = await import('./symbols.js');
        assign_graphics(ROGUESET);
    }
    /* reset_glyphmap(gm_levelchange) — js/display.js folds reset_glyphmap into
       its per-glyph mapping, so there is no whole-table pass to redo. */
    {
        const { max_rank_sz } = await import('./botl.js');
        max_rank_sz(); /* to recompute gm.mrank_sz (botl.c) */
    }

    if ((game.uball && !game.uchain) || (game.uchain && !game.uball)) {
        await impossible('restgamestate: lost ball & chain');
        /* poor man's unpunish() */
        setworn_rst(null, W_CHAIN);
        setworn_rst(null, W_BALL);
    }

    /* in_use processing must be after:
     *    + The inventory has been read so that freeinv() works.
     *    + The current level has been restored so billing information
     *      is available.
     */
    await inven_inuse(false);

    /* Set up the vision internals, after levl[] data is loaded
       but before docrt(). */
    /* UNPORTED: reglyph_darkroom() (display.c) */
    vision_reset();
    game.vision_full_recalc = 1; /* recompute vision (not saved) */

    run_object_timers(); /* run_timers(): expire timers that went off while away */
    if (game.program_state)
        game.program_state.restoring = 0; /* affects bot(), so clear before docrt() */

    if (game.early_raw_messages && !game.program_state?.beyond_savefile_load) {
        /*
         * We're about to obliterate some potentially important
         * startup messages, so give the player a chance to see them.
         */
        game.early_raw_messages = 0;
        /* wait_synch() */
    }
    if (game.u) game.u.usteed_mid = game.u.ustuck_mid = 0;
    if (game.program_state) game.program_state.beyond_savefile_load = 1;

    await docrt();
    /* clear_nhwindow(WIN_MESSAGE) */
    game._pending_message = '';
    game._toplin = 0;
    game._toplines = '';

    /* Success! */
    /* welcome(FALSE) — allmain.c; welcome_back_message() above is this port's
       copy of its restore branch. */
    await pline(welcome_back_message());
    await check_special_room(false);
    return 1;
}

/* ======================== restore.c:955 rest_stairs ====================== */

export function rest_stairs(nhfp) {
    let buflen = 0;
    let stway = {};                     /* stairway stway = UNDEFINED_VALUES */
    let newst;
    const cur = len_chain(nhfp, 'stairs', 'stairs-staircount');

    game.stairs = null;                 /* stairway_free_all() (stairs.c) */
    while (1) {
        buflen = cur.len();
        if (buflen === -1)
            break;

        const rec = cur.next();
        stway = {};
        Sfi_into(stway, rec?.stairway);                 /* Sfi_stairway() */
        stway.tolev = { ...(rec?.tolev ?? rec?.stairway?.tolev ?? {}) };
        if (game.program_state?.restoring !== REST_GSTATE
            && stway.tolev.dnum === game.u?.uz?.dnum) {
            /* stairway dlevel is relative, make it absolute */
            stway.tolev.dlevel = (stway.tolev.dlevel | 0) + (game.u.uz.dlevel | 0);
        }
        /* stairway_add() is js/mklev.js:149 and module-private; the fix is to
           export that one rather than keep a second copy, so this builds the
           node it builds, field for field. */
        game.stairs = {
            sx: stway.sx, sy: stway.sy, up: stway.up, isladder: stway.isladder,
            tolev: { ...stway.tolev }, next: game.stairs,
        };
        newst = stairway_at(stway.sx, stway.sy);
        if (newst)
            newst.u_traversed = stway.u_traversed;
    }
}

/* ======================== restore.c:988 restcemetery ===================== */

/* C's out-param is `struct cemetery **cemeteryaddr`; the (holder, key) pair is
   this port's analogue, the same one js/save.js's savecemetery() takes. */
export function restcemetery(nhfp, holder, key) {
    let bonesinfo, bonesowner, boneskey;
    let cflag = 0;

    cflag = Sfi(nhfp, 'cemetery-cemetery_flag', -1) | 0;
    if (cflag === 0) {
        bonesowner = holder;                        /* bonesaddr = cemeteryaddr */
        boneskey = key;
        let i = 0;
        do {
            bonesinfo = {};                         /* alloc(sizeof *bonesinfo) */
            const rec = Sfi_at(nhfp, 'cemetery-bonesinfo', i++, null);
            Sfi_into(bonesinfo, rec);
            /* the saved `next` is a stale pointer: non-null only means "another
               entry follows", which is what drives the loop condition */
            bonesinfo.next = rec?.next ? {} : null;
            bonesowner[boneskey] = bonesinfo;
            bonesowner = bonesinfo;                 /* &(*bonesaddr)->next */
            boneskey = 'next';
        } while (bonesowner[boneskey]);
    } else {
        holder[key] = null;
    }
    /* nhfp->mode CONVERTING / UNCONVERTING: free the list again.  The sfctool
       conversion modes have no analogue in this port. */
}

/* ========================= restore.c:1021 rest_levl ====================== */

export function rest_levl(nhfp) {
    let c, r;

    for (c = 0; c < COLNO; ++c) {
        for (r = 0; r < ROWNO; ++r) {
            /* js/save.js savelevl() writes the grid flat, x outer / y inner */
            Sfi_into(levl_rst(c, r), Sfi_at(nhfp, 'location-rm', c * ROWNO + r, null));
        }
    }
}

/* ========================= restore.c:1035 trickery ======================= */

export async function trickery(reason) {
    await pline('Strange, this map is not as I remember it.');
    await pline('Somebody is trying some trickery here...');
    await pline('This game is void.');
    if (!game.killer) game.killer = { name: '', format: 0 };
    game.killer.name = reason ? reason : '';
    const { done } = await import('./end.js');
    await done(TRICKED);
}

/* ========================== restore.c:1046 getlev ======================== */

export async function getlev(nhfp, pid, lev) {
    let trap;
    let mtmp;
    let br;
    let x, y;
    let elapsed = 0;
    let hpid = 0;
    let dlvl = 0;
    let i, c, r;
    const ghostly = (nhfp?.ftype === NHF_BONESFILE);
    let tmpc = 0;

    if (game.program_state) game.program_state.in_getlev = true;

    if (ghostly)
        clear_id_mapping();

    /* Load the old fruit info.  We have to do it first, so the
     * information is available when restoring the objects.
     */
    if (ghostly)
        game.oldfruit = loadfruitchn(nhfp_sub(nhfp, 'oldfruit'));

    /* First some sanity checks */
    hpid = Sfi(nhfp, 'gamestate-hackpid', 0) | 0;
    /* CHECK:  This may prevent restoration */
    dlvl = Sfi(nhfp, 'gamestate-dlvl', 0) | 0;
    if ((pid && pid !== hpid) || (lev && dlvl !== lev)) {
        let trickbuf;

        if (pid && pid !== hpid)
            trickbuf = `PID (${hpid}) doesn't match saved PID (${pid})!`;
        else
            trickbuf = `This is level ${dlvl}, not ${lev}!`;
        if (is_wizard())
            await pline(trickbuf);                  /* pline1(trickbuf) */
        await trickery(trickbuf);
    }
    const level = game.level || (game.level = new GameMap());
    restcemetery(nhfp_sub(nhfp, 'bonesinfo'), level, 'bonesinfo');
    rest_levl(nhfp_sub(nhfp, 'levl'));

    if (!game.lastseentyp) game.lastseentyp = [];
    for (c = 0; c < COLNO; ++c) {
        if (!game.lastseentyp[c]) game.lastseentyp[c] = [];
        for (r = 0; r < ROWNO; ++r) {
            game.lastseentyp[c][r] = Sfi_at(nhfp, 'lastseentyp', c * ROWNO + r, 0) | 0;
        }
    }
    game.omoves = Sfi(nhfp, 'lev-timestmp', 0) | 0;   /* svo.omoves */
    elapsed = (game.moves | 0) - (game.omoves | 0);

    rest_stairs(nhfp_sub(nhfp, 'stairs'));
    game.updest = Sfi(nhfp, 'lev-updest', game.updest ?? null);
    game.dndest = Sfi(nhfp, 'lev-dndest', game.dndest ?? null);
    Sfi_into(level.flags, Sfi(nhfp, 'lev-level_flags', null));
    rest_adjust_levelflags();
    if (level.doors) {
        level.doors = null;                         /* free(svd.doors) */
    }

    game.doors_alloc = Sfi(nhfp, 'lev-doors_alloc', 0) | 0;
    if (game.doors_alloc) { /* avoid pointless alloc(0) */
        level.doors = new Array(game.doors_alloc);
        tmpc = 0;                                   /* tmpc = svd.doors */
        for (i = 0; i < game.doors_alloc; ++i) {
            level.doors[tmpc] = { ...(Sfi_at(nhfp, 'lev-doors', i, null) ?? { x: 0, y: 0 }) };
            tmpc++;
        }
    }
    /* UNPORTED: rest_rooms() (mkroom.c).  No joke :-) */
    if (level.nroom) {
        const lastr = level.rooms?.[level.nroom - 1];
        level.doorindex = ((lastr?.fdoor | 0) + (lastr?.doorct | 0));
    } else {
        level.doorindex = 0;
    }

    {
        const { restore_timers } = await import('./timeout.js');
        restore_timers(nhfp_sub(nhfp, 'timers_level').recs, RANGE_LEVEL, elapsed);
    }
    {
        const { restore_light_sources } = await import('./light.js');
        restore_light_sources(Sfi(nhfp, 'light_sources_level', null));
    }
    level.monsters = await restmonchn(nhfp_sub(nhfp, 'fmon'));   /* fmon = ... */
    game.fmon = level.monsters;
    {
        const { rest_worm } = await import('./worm.js');
        rest_worm(Sfi(nhfp, 'worm', null));         /* restore worm information */
    }

    level.traps = [];                               /* gf.ftrap = 0 */
    {
        const tfp = nhfp_sub(nhfp, 'ftrap');
        const tcur = struct_chain(tfp, 'traps', { tx: 0 });
        for (;;) {
            trap = {};                              /* newtrap() */
            const rec = tcur.next();
            Sfi_into(trap, rec?.trap ?? rec);       /* Sfi_trap(..., "trap") */
            if (rec?.dst) trap.dst = { ...rec.dst };
            if (trap.tx !== 0) {
                if (game.program_state?.restoring !== REST_GSTATE
                    && trap.dst?.dnum === game.u?.uz?.dnum) {
                    /* convert relative destination to absolute */
                    trap.dst.dlevel = (trap.dst.dlevel | 0) + (game.u.uz.dlevel | 0);
                }
                trap.ntrap = level.traps[0] ?? null;
                level.traps.unshift(trap);          /* gf.ftrap = trap */
            } else
                break;
        }
        /* dealloc_trap(trap) */
    }

    level.objects = await restobjchn(nhfp_sub(nhfp, 'fobj'), false);  /* fobj */
    find_lev_obj();
    /* restobjchn()'s `frozen' argument probably ought to be a callback
       routine so that we can check for objects being buried under ice */
    level.buriedobjlist = await restobjchn(nhfp_sub(nhfp, 'buriedobjlist'), false);
    game.billobjs = await restobjchn(nhfp_sub(nhfp, 'billobjs'), false);
    /* UNPORTED: rest_engravings() (engrave.c) */

    /* reset level.monsters for new level.  C zeroes svl.level.monsters[x][y];
       this port keeps no per-square monster grid (m_at() scans the array), so
       the loop has no analogue — place_monster() below is a coordinate write
       plus list membership (js/vault.js:207). */
    {
        const { set_residency } = await import('./shk.js');
        const { set_ustuck, restore_cham, hide_monst } = await import('./mon.js');
        const { hides_under_pm, hideunder } = await import('./monmove.js');
        const { place_wsegs } = await import('./worm.js');
        const { mon_catchup_elapsed_time } = await import('./dogmove.js');
        const { rnd } = await import('./rng.js');

        /* snapshot: place_monster()'s port equivalent is a push onto this very
           array, so C's `for (mtmp = fmon; ...)` needs a stable list here */
        for (mtmp of [...level.monsters]) {
            if (mtmp.isshk)
                set_residency(mtmp, false);
            if (mtmp.m_id === game.u?.usteed_mid) {
                /* steed is kept on fmon list but off the map */
                game.u.usteed = mtmp;
                game.u.usteed_mid = 0;
            } else {
                if (mtmp.m_id === game.u?.ustuck_mid) {
                    set_ustuck(mtmp);
                    game.u.ustuck_mid = 0;
                }
                /* place_monster(mtmp, mtmp.mx, mtmp.my) */
                if (!level.monsters.includes(mtmp)) level.monsters.push(mtmp);
                if (mtmp.wormno)
                    place_wsegs(mtmp, null);
                if (hides_under_pm(mtmp.data) && mtmp.mundetected)
                    await hideunder(mtmp);
            }

            /* regenerate monsters while on another level */
            if (!game.u?.uz?.dlevel
                || game.program_state?.restoring === REST_LEVELS)
                continue;
            if (ghostly) {
                /* reset peaceful/malign relative to new character;
                   shopkeepers will reset based on name */
                if (!mtmp.isshk) {
                    /* is_unicorn(ptr) is `ptr->mlet == S_UNICORN &&
                       likes_gems(ptr)`; js/bones.js:xxx makes the same
                       substitution — the only S_UNICORN members that are not
                       unicorns are ponies/horses, whose maligntyp is 0, so the
                       sign test excludes them. */
                    const ptr = mtmp.data;
                    const uni = ptr?.mcls === 'u' && Math.sign(ptr.maligntyp ?? 0) !== 0;
                    mtmp.mpeaceful = (uni
                        && Math.sign(game.u?.ualign?.type ?? 0)
                           === Math.sign(ptr.maligntyp ?? 0)) ? 1
                        : (peace_minded_bigrm(ptr) ? 1 : 0);
                }
                set_malign(mtmp);
            } else if (elapsed > 0) {
                mon_catchup_elapsed_time(mtmp, elapsed);
            }
            /* update shape-changers in case protection against
               them is different now than when the level was saved */
            await restore_cham(mtmp);
            /* give hiders a chance to hide before their next move */
            if (ghostly || (elapsed > 0 && elapsed > rnd(10)))
                await hide_monst(mtmp);
        }
    }

    restdamage(nhfp_sub(nhfp, 'damage'));
    /* UNPORTED: rest_regions() (region.c) */
    rest_bubbles(nhfp_sub(nhfp, 'bubbles')); /* water and air; empty marker elsewhere */
    /* UNPORTED: load_exclusions() (nhlua.c) */
    {
        const { rest_track } = await import('./track.js');
        rest_track(Sfi(nhfp, 'track', null));
    }

    if (ghostly) {
        let stway = game.stairs;
        while (stway) {
            if (!stway.isladder && !stway.up
                && stway.tolev?.dnum === game.u?.uz?.dnum)
                break;
            stway = stway.next;
        }

        /* Now get rid of all the temp fruits... */
        freefruitchn(game.oldfruit); game.oldfruit = null;

        if (lev > ledger_no_rst(game.medusa_level)
            && lev < ledger_no_rst(game.stronghold_level) && !stway) {
            /* UNPORTED: mazexy() (mkmaze.c) — without it there is no coordinate
               to place the rescue downstair on, so this whole arm (a bones file
               from a mazy level with no down staircase) is left as the seam. */
        }

        br = Is_branchlev_rst(game.u?.uz);
        if (br && game.u?.uz?.dlevel === 1) {
            const ltmp2 = {};                       /* d_level ltmp */

            if (on_level_rst(game.u.uz, br.end1))
                assign_level_rst(ltmp2, br.end2);
            else
                assign_level_rst(ltmp2, br.end1);

            switch (br.type) {
            case BR_STAIR:
            case BR_NO_END1:
            case BR_NO_END2:
                stway = game.stairs;
                while (stway) {
                    if (stway.tolev?.dnum !== game.u.uz.dnum)
                        break;
                    stway = stway.next;
                }
                if (stway)
                    assign_level_rst(stway.tolev, ltmp2);
                break;
            case BR_PORTAL: /* max of 1 portal per level */
                trap = null;
                for (const t of level.traps)
                    if (t.ttyp === MAGIC_PORTAL) { trap = t; break; }
                if (!trap)
                    await impossible('getlev: need portal but none found');
                else
                    assign_level_rst(trap.dst, ltmp2);
                break;
            default:
                break;
            }
        } else if (!br) {
            const { deltrap } = await import('./trap.js');

            /* Remove any dangling portals. */
            for (const t of [...level.traps])
                if (t.ttyp === MAGIC_PORTAL)
                    deltrap(t);
        }
    }
    /* must come after all mons & objs are restored */
    {
        const { relink_timers } = await import('./timeout.js');
        await relink_timers(ghostly);
    }
    {
        const { relink_light_sources } = await import('./light.js');
        relink_light_sources(ghostly);
    }
    reset_oattached_mids(ghostly);

    if (ghostly)
        clear_id_mapping();
    if (game.program_state) game.program_state.in_getlev = false;
}

/* =================== restore.c:1314 rest_adjust_levelflags =============== */

export function rest_adjust_levelflags() {
    /* adjust timestamps */
    relative_time_to_moves(game.level?.flags, 'stasis_until');
}

/* =================== restore.c:1320 moves_to_relative_time =============== */

/* C takes `long *timestamp`; the (holder, key) pair is this port's analogue of
   that pointer, and js/save.js's private rel_ts()/abs_ts() are the same two
   lines in return-a-value form. */
export function moves_to_relative_time(holder, key) {
    if (!holder || typeof holder[key] !== 'number') return;
    const prevts = holder[key];

    holder[key] = prevts - (game.moves | 0);
}

/* =================== restore.c:1328 relative_time_to_moves =============== */

export function relative_time_to_moves(holder, key) {
    if (!holder || typeof holder[key] !== 'number') return;
    const prevts = holder[key];

    holder[key] = (game.moves | 0) + prevts;
}

/* =================== restore.c:1338 get_plname_from_file ================= */

/* "name-role-race-gend-algn" occurs very early in a save file; sometimes we
   want the whole thing, other times just "name" (for svp.plname[]).
   `outbuf` is a { s } box standing in for C's char buffer. */
export function get_plname_from_file(nhfp, outbuf, name_only) {
    let plbuf;                                      /* char[PL_NSIZ_PLUS] */
    let pltmpsiz = 0;

    plbuf = '';

    pltmpsiz = Sfi(nhfp, 'plname-size', 0) | 0;
    /* pltmpsiz should now be PL_NSIZ_PLUS */
    plbuf = String(Sfi(nhfp, 'plname', '') ?? '').slice(0, pltmpsiz);
    /* plbuf[PL_NSIZ_PLUS-2] should be '\0';
       plbuf[PL_NSIZ_PLUS-1] should be '-' or 'X' or 'D' */
    /* "-race-role-gend-algn" is already present except that it has been
       hidden by replacing the initial dash with NUL; if we want that
       information, replace the NUL with a dash */
    if (!name_only) {
        const eos = plbuf.indexOf('\0');            /* *eos(plbuf) = '-' */
        if (eos >= 0)
            plbuf = plbuf.slice(0, eos) + '-' + plbuf.slice(eos + 1);
    }
    /* not simple strcpy(); playmode is in the last slot and could (probably
       will) be preceded by NULs */
    if (outbuf) outbuf.s = plbuf.slice(0, PL_NSIZ_PLUS);
    return;
}

/* ======================= restore.c:1369 rest_bubbles ===================== */

/* restore Plane of Water's air bubbles and Plane of Air's clouds */
export function rest_bubbles(nhfp) {
    let bbubbly;

    /* whether or not the Plane of Water's air bubbles or Plane of Air's
       clouds are present is recorded during save so that we don't have to
       know what level is being restored */
    bbubbly = 0;
    bbubbly = Sfi(nhfp, 'bubbles-bbubbly', 0) | 0;
    if (bbubbly) {
        /* UNPORTED: restore_waterlevel() (mkmaze.c) — js/save.js's
           save_bubbles() marks the writer half the same way. */
    }
}

/* ===================== restore.c:1390 restore_gamelog ==================== */

export function restore_gamelog(nhfp) {
    let slen = 0;
    let msg;                                        /* char[BUFSZ*2] */
    const tmp = {};                                 /* struct gamelog_line */
    const cur = len_chain(nhfp, 'gamelog', 'gamelog-length');

    while (1) {
        slen = cur.len();
        if (slen === -1)
            break;
        const rec = cur.next();
        slen = (rec?.length ?? 0) | 0;
        if (slen > ((BUFSZ_RST * 2) - 1)) {
            /* C: panic("restore_gamelog: msg too big (%d)", slen) */
            break;
        }
        msg = String(rec?.gamelog_text ?? '').slice(0, slen);
        Sfi_into(tmp, rec?.gamelog_line);
        /* gamelog_add(tmp.flags, tmp.turn, msg) — pline.c:495.  There is no
           gamelog_add() in this port; js/livelog.js:31 livelog_printf() is the
           only writer and it appends {turn, flags, text} to the game.gamelog
           ARRAY that js/save.js's save_gamelog() reads, so append there with
           C's tail-append order. */
        if (!game.gamelog) game.gamelog = [];
        game.gamelog.push({ turn: tmp.turn, flags: tmp.flags, text: msg });
    }
}

/* ==================== restore.c:1415 restore_msghistory ================== */

export function restore_msghistory(nhfp) {
    let msgsize = 0;
    let msgcount = 0;
    let msg;                                        /* char[BUFSZ] */
    const cur = len_chain(nhfp, 'msghistory', 'msghistory-length');

    while (1) {
        msgsize = cur.len();
        if (msgsize === -1)
            break;
        const rec = cur.next();
        msgsize = (rec?.length ?? 0) | 0;
        if (msgsize > BUFSZ_RST - 1) {
            /* C: panic("restore_msghistory: msg too big (%d)", msgsize) */
            break;
        }
        msg = String(rec?.msg ?? '').slice(0, msgsize);
        /* putmsghistory(msg, TRUE) — wintty.c; js/invent.js:1252 keeps a
           module-private no-op stub of it, so the ring js/save.js's
           save_msghistory() walks (game._msghistory, C's gt.msgs) is written
           directly here. */
        if (!game._msghistory) game._msghistory = [];
        game._msghistory.push(msg);
        ++msgcount;
    }
    if (msgcount) {
        /* putmsghistory((char *) 0, TRUE) — the "done" marker */
    }
    /* debugpline1("Read %d messages from savefile.", msgcount) */
}

/* ==================== restore.c:1447 clear_id_mapping ==================== */

/* Clear all structures for object and monster ID mapping.
   C keeps a list of 64-entry buckets; this port keeps ONE flat map on
   game.id_map, which is the shape the existing consumer reads
   (js/light.js:959 lookup_id_mapping(), and relink_timers() through it). */
export function clear_id_mapping() {
    game.id_map = null;                             /* free every bucket */
    game.n_ids_mapped = 0;                          /* gn.n_ids_mapped */
}

/* ===================== restore.c:1460 add_id_mapping ===================== */

/* Add a mapping to the ID map. */
export function add_id_mapping(gid, nid) {
    let idx;

    idx = (game.n_ids_mapped | 0) % N_PER_BUCKET;
    /* idx is zero on first time through, as well as when a new bucket is */
    /* needed.  With one flat map (see clear_id_mapping) a "new bucket" is only
       the first allocation, so the modulus is kept for the boundary it marks
       rather than for an allocation decision. */
    if (idx === 0 || !game.id_map) {
        if (!game.id_map)
            game.id_map = new Map();                /* alloc(struct bucket) */
    }

    game.id_map.set(gid, nid);
    game.n_ids_mapped = (game.n_ids_mapped | 0) + 1;
}

/* =================== restore.c:1510 reset_oattached_mids ================= */

export function reset_oattached_mids(ghostly) {
    let otmp;
    let oldid, nid;

    for (otmp of (game.level?.objects || [])) {     /* fobj */
        if (ghostly && has_omonst(otmp)) {
            const mtmp = OMONST(otmp);

            mtmp.m_id = 0;
            mtmp.mpeaceful = mtmp.mtame = 0; /* pet's owner died! */
        }
        if (ghostly && has_omid(otmp)) {
            oldid = OMID(otmp);
            /* lookup_id_mapping(oldid, &nid) is js/light.js:959 and
               module-private (and returns the id or null instead of C's
               boolean + out-param).  The fix is to EXPORT that one, not to add
               a second copy, so read the same map it reads. */
            const map = game.id_map;
            nid = map ? (map.get ? map.get(oldid) : map[oldid]) : undefined;
            if (nid !== undefined && nid !== null)
                otmp.oextra.omid = nid;             /* OMID(otmp) = nid */
            else
                free_omid(otmp);
        }
    }
}

/* /\* restore.c *\/ */

/* --------------------------------------------------------------------------
 * HOW THIS PORT ACTUALLY DOES RESTORE, versus C
 *
 * C: dorecover() streams a byte file: plname, the current LEVEL, the game
 * state, then every other level; each level it reads is immediately written
 * back out as its own level file by restlevelfile(), and the current level is
 * re-read at the end.  Level files, ledger numbers and the two-pass rewrite
 * are the whole architecture.
 *
 * This port: dosave0() (js/save.js:113) writes ONE blob — the live `game`
 * object graph, reference-preserving JSON — under a plname-keyed storage key,
 * and dorestore() (above) reads it back and Object.assign()s it over `game`.
 * There are no level files, no ledger numbers, no per-record byte layout, and
 * the entire "other levels" loop does not exist: every level travels inside the
 * one graph.  That is why the functions above are inert — they read the record
 * shapes js/save.js's savegamestate()/savelev_core() PRODUCE, but nothing calls
 * those two either (dosave0() bypasses them).
 *
 * So the gap worth closing next is on the WRITER side, not here: dosave0()
 * needs to emit the container restore.c:775 documents ({ plname_size, plname,
 * currentlevel, gamestate, otherlevels }) by calling store_plname_in_file(),
 * savelev() and savegamestate(), at which point dorecover() above reads it.
 * Until then five reads have no writer at all — 'killers', 'timers_global',
 * 'timers_level', 'luadata' and 'dungeon' are `{ unported: ... }` placeholders
 * in save.js — and restnames() / restore_dungeon() / restore_oracles() /
 * rest_rooms() / rest_engravings() / rest_regions() / load_exclusions() /
 * restore_waterlevel() / init_oclass_probs() / reglyph_darkroom() / mazexy() /
 * restpriest() have no JS port on either side.
 * -------------------------------------------------------------------------- */
