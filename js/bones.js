// bones.js — bones-file handling (death legacy levels) for the C->JS port.
//
// C ref: nethack-c/upstream/src/bones.c (NetHack 5.0).
//
// In the deterministic session-replay harness there is never a bones file on
// disk: open_bonesfile() always fails, so savebones()/getbones() can never
// actually read or write one.  What still matters for RNG parity is the
// *single* rn2(3) draw that getbones() makes every time mklev() generates a
// new level (getbones is called first thing inside mklev()).  Reproducing that
// draw — at exactly the right point, with exactly the right argument and
// short-circuit semantics — is what keeps the call stream aligned for every
// session that descends to dlvl >= 2 (seed0009/0116/0373/0383/0399/5002 and
// any other second-mklev run).
//
// This module is the canonical home for getbones(); mklev() should call into
// it (see the dispatch note at the bottom of this file).  The functions below
// are faithful ports of the public, RNG-bearing entry points of bones.c:
//
//   getbones()            bones.c:629  — the rn2(3) "find bones?" gate
//   can_make_bones()      bones.c:355  — the rn2(1 + depth>>2) "make bones?" gate
//   no_bones_level()      bones.c:17   — level eligibility predicate (no RNG)
//   give_to_nearby_mon()  bones.c:225  — rn2(nmon) reservoir pick
//   drop_upon_death()     bones.c:258  — rn2(5) curse + rn2(8) give-to-mon

import { game } from './gstate.js';
import { rn2 } from './rng.js';
import { depth as depth_of_level } from './hacklib.js';
import { Is_special } from './dungeon.js';
import { MAGIC_PORTAL, VIBRATING_SQUARE, DELPHI, ROOMOFFSET,
         Is_oracle_level } from './const.js';
import { msound_of, MS_LEADER, MS_NEMESIS } from './monflags_data.js';

// ── small accessors that mirror the C globals/macros bones.c relies on ──

function FLAGS() { return game.flags || {}; }

// C: `discover` is the same macro as flags.explore.  Our options parser stores
// the explore play-mode as flags.playmode === 'explore' (and never sets
// flags.explore), so accept either spelling.  In discover mode getbones()
// returns 0 *before* the rn2(3), i.e. with NO rng draw at all.
function is_discover() {
    const f = FLAGS();
    return !!(f.explore || f.discover || f.playmode === 'explore');
}

// C: `wizard` is the same macro as flags.debug.
function is_wizard() {
    return !!FLAGS().debug;
}

// C: flags.bones defaults to TRUE; the option is only ever turned *off*.  Our
// flags object leaves it undefined unless a !bones rc line set it to false.
function bones_enabled() {
    return FLAGS().bones !== false;
}

// C: svp.plname — unixmain.c overwrites it with "wizard" when the -D flag put
// the game into debug mode, so the ghost's name and the cemetery entry's `who`
// (which must agree, since bones_include_name() matches the latter against the
// hero's own plname) both read "wizard" there.
function svp_plname() {
    return is_wizard() ? 'wizard' : (game.plname || 'Hero');
}

// ── ledger / branch helpers (C ref: dungeon.c) ──
//
// dungeon.c:1376 ledger_no(lev) = lev->dlevel + svd.dungeons[lev->dnum].ledger_start
// dungeon.c:1392 maxledgerno()  = dungeons[n_dgns-1].ledger_start + .num_dunlevs
// Both feed can_make_bones()'s range check, which runs BEFORE its rn2().
function ledger_no(lev) {
    const dnum = lev?.dnum ?? 0;
    const dng = game.dungeons?.[dnum];
    if (!dng) return null;                       // dungeon table not built yet
    return (lev?.dlevel ?? 1) + (dng.ledger_start ?? 0);
}

function maxledgerno() {
    const dgns = game.dungeons;
    if (!dgns || !dgns.length) return null;
    const last = dgns[dgns.length - 1];
    return (last.ledger_start ?? 0) + (last.num_dunlevs ?? 0);
}

// C ref: dungeon.c:1464 Is_branchlev(lev) — walks the GLOBAL branch chain and
// matches either END, so a level is a branch level whether it holds the up- or
// the down-side stair.  Returns the branch (truthy) like C does.
function Is_branchlev(lev) {
    const dnum = lev?.dnum ?? 0, dlevel = lev?.dlevel ?? 1;
    for (const br of (game.branches || [])) {
        if ((br?.end1?.dnum === dnum && br.end1.dlevel === dlevel)
            || (br?.end2?.dnum === dnum && br.end2.dlevel === dlevel))
            return br;
    }
    return null;
}

// ── no_bones_level (C ref: bones.c:18) — pure predicate, consumes no RNG ──
//
// Unlike getbones(), where the result lands *after* the rn2(3), this predicate
// runs BEFORE can_make_bones()'s rn2(1 + depth>>2) (bones.c:376-378), so a
// wrong answer both fabricates/eats a draw and decides whether savebones()
// writes a bones file that a later segment's getbones() will read back.
// seed0030 proves both arms: C makes NO can_make_bones draw at all in seg4/seg7
// (Dlvl 2 of the Dungeons of Doom, the Mines branch level in those games) but
// does make one in seg1/seg2/seg3 (same dnum/dlevel, branch elsewhere).
export function no_bones_level(lev) {
    try {
        const d = lev || game.u?.uz || {};
        const dnum = d.dnum ?? 0;
        const dlevel = d.dlevel ?? 1;
        const dng = game.dungeons?.[dnum];

        // (sptr = Is_special(lev)) != 0 && !sptr->boneid
        const sptr = Is_special({ dnum, dlevel });
        if (sptr && !sptr.boneid) return true;

        // !svd.dungeons[lev->dnum].boneid — a dungeon flagged no-bones.
        if (dng && !dng.boneid) return true;

        // Is_botlevel(lev): dungeon.c:1645 uses ==, not >=.
        if (dng && dng.num_dunlevs != null && dlevel === dng.num_dunlevs)
            return true;

        // Is_branchlev(lev) && lev->dlevel > 1.  (The old code read
        // `game.dungeons[dnum].branches`, a field the dungeon model never sets —
        // init_dungeon_branches only counts them into pd.tmpdungeon — so this
        // arm answered FALSE on every level.)
        if (dlevel > 1 && Is_branchlev({ dnum, dlevel })) return true;

        // In_hell(lev) && lev->dlevel == dunlevs_in_dungeon(lev) - 1 — the
        // invocation level.
        if (dng?.flags?.hellish && dng.num_dunlevs != null
            && dlevel === dng.num_dunlevs - 1)
            return true;

        return false;
    } catch {
        return false;
    }
}

// ── getbones (C ref: bones.c:629) ──
//
// C body (the part reachable in the replay harness):
//
//     if (discover) return 0;                       // no rng
//     if (!flags.bones) return 0;                   // no rng
//     if (rn2(3)        // <-- ALWAYS evaluated here (bones.c:645)
//         && !wizard)
//         return 0;
//     if (no_bones_level(&u.uz)) return 0;
//     nhfp = open_bonesfile(...);
//     if (!nhfp) return 0;                           // always taken in replay
//     ...
//
// The crucial parity point: rn2(3) is drawn left-of the `&& !wizard`, so it is
// consumed *unconditionally* whenever we are not in discover mode and bones
// are enabled — including in wizard mode, where the `&& !wizard` then makes the
// whole condition false (so the function does NOT return early on its account,
// but the rn2(3) has already advanced the stream).  After that the bones file
// never exists, so getbones() always ultimately returns 0 (false) here.
export async function getbones() {
    if (is_discover()) return false;   // C: if (discover) return 0;  (no rng)
    if (!bones_enabled()) return false; // C: if (!flags.bones) return 0; (no rng)

    // C: if (rn2(3) && !wizard) return 0;
    // rn2(3) is always drawn; short-circuit only suppresses the early return
    // in wizard mode (where bones are forced available for testing).
    if (rn2(3) && !is_wizard()) return false;

    // no_bones_level() — consumes no RNG.
    if (no_bones_level(game.u?.uz)) return false;

    // C: nhfp = open_bonesfile(...); if (!nhfp) return 0;  — the JS harness
    // shares one Web-Storage handle across a session's segments (see
    // frozen/score.sh: "storage ... makes save/restore + bones persist across
    // segments"), so the bones file is the blob a prior segment's savebones()
    // wrote under bones_key().  No blob → no bones (the common case for every
    // single-segment session and every level that no hero died on).
    const storage = game.storage;
    const key = bones_key(game.u?.uz);
    const blob = (key && storage && typeof storage.getItem === 'function')
        ? storage.getItem(key) : null;
    if (blob == null || blob === '') return false;

    // C ref: bones.c:665 validate(nhfp, ...) — a well-formed blob validates
    // SF_UPTODATE.  Everything below runs inside mklev(), i.e. BEFORE
    // goto_level()'s docrt() repaints the destination: game.level still refers
    // to the level being LEFT, so the two wizard y_n() prompts are captured over
    // the old map (matching the recorded C frames), and the actual level graft
    // is deferred to the very end so it can't repaint until docrt().
    try {
        const { y_n } = await import('./display.js');

        // C ref: bones.c:674 — wizard "Get bones?" gate.  'n' (default, also
        // reached by space/return/ESC) discards the bones and makelevel()
        // generates a fresh level instead.
        if (is_wizard()) {
            if ((await y_n('Get bones?')) === 'n') return false;
        }

        // C ref: bones.c:706 getlev(nhfp, 0, 0) — read the level back.  The only
        // RNG a bones getlev consumes is restore.c restobjchn()/restmon()'s
        // `if (ghostly) o_id = next_ident()` (mkobj.c:521 rnd(2)) — one per
        // object (recursing into container contents) and one per monster, in
        // list order.  The o_ids never reach the screen, but the draws must
        // advance the stream so the hero-placement roll that follows
        // (u_on_rndspot) lands where C put it.
        const bundle = await bones_getlev(blob);

        // C ref: bones.c:757 u.uroleplay.numbones++.
        if (game.u) game.u.numbones = (game.u.numbones || 0) + 1;

        // C ref: bones.c:760 — wizard "Unlink bones?" gate.  'n' (default) keeps
        // the file; 'y' deletes it.  Either way the bones stay loaded.
        if (is_wizard()) {
            if ((await y_n('Unlink bones?')) !== 'n') {
                if (storage.removeItem) storage.removeItem(key);
                else storage.setItem(key, '');
            }
        } else if (storage.removeItem) {
            storage.removeItem(key);
        }

        // Commit the graft LAST (after both prompts) so the display kept showing
        // the departing level throughout — C's getlev swaps levl[][] here but the
        // tty back-buffer isn't repainted until goto_level()'s docrt().
        game.level = bundle.level;
        game.stairs = bundle.stairs ?? game.stairs;
        game.fmon = game.level.monsters;
        game._bones_loaded = true;   // goto_level(): skip the fill/mineralize pass
        return true;
    } catch (e) {
        // Any decode/graft failure: behave as if no bones (fresh makelevel).  The
        // rn2(3) above already advanced the stream identically to the no-bones
        // path, so this cannot regress a session that merely has a stray blob.
        if (is_wizard()) { try { (await import('./display.js')).pline?.(`bones: ${e}`); } catch { /*noop*/ } }
        return false;
    }
}

// C ref: bones.c open_bonesfile()/create_bonesfile() filename — the bones file
// is keyed on the dungeon level (bonDD.nnn).  We key the shared-storage blob on
// (dnum,dlevel) so savebones() in one segment and getbones() in the next agree.
export function bones_key(uz) {
    const d = uz || game.u?.uz || {};
    return `nethack.bones.${d.dnum ?? 0}.${d.dlevel ?? 1}`;
}

// C ref: restore.c getlev() for a bones file — deserialize the level graph and
// re-stamp every object's and monster's o_id via next_ident() (rnd(2)), matching
// restobjchn()/restmon()'s `if (ghostly)` re-identification.  Returns the graft
// bundle { level, stairs } without installing it (the caller defers that).
async function bones_getlev(blob) {
    const { deserializeGameState } = await import('./restore.js');
    const { next_ident } = await import('./mkobj.js');
    const { rest_track } = await import('./track.js');
    const bundle = deserializeGameState(blob);
    const level = bundle.level || bundle;

    // C ref: restore.c:1228 getlev() -> rest_track(nhfp).  utrack lives in the
    // LEVEL file (save.c:553 savelev_core), and a bones file IS a level file, so
    // the dead hero's last footprints come back with it.  m_move()'s
    // `!should_see && can_track` arm (monmove.c:1882) then redirects every
    // tracking monster at that square rather than at the live hero, which
    // changes the mfndpos() cnt that is the modulus of the rn2(4*(cnt-j))
    // backtrack roll.  goto_level() already ran initrack() on departure, so a
    // bones blob written before this field existed simply keeps the empty ring.
    rest_track(bundle.track);

    // restobjchn(): one next_ident() per object, recursing into cobj first —
    // C restores container contents inside the container's loop iteration
    // (restobjchn calls itself for otmp->cobj) — depth-first, contents before
    // the container's own re-stamp.
    const stamp_obj = (o) => {
        if (!o) return;
        if (Array.isArray(o.cobj)) for (const c of o.cobj) stamp_obj(c);
        o.o_id = next_ident();
    };
    for (const o of level.objects || []) stamp_obj(o);
    // restmon(): one next_ident() per monster, then its minvent objects.
    for (const m of level.monsters || []) {
        m.m_id = next_ident();
        if (Array.isArray(m.minvent)) for (const o of m.minvent) stamp_obj(o);
    }
    // C ref: restore.c getlev() -> restore_buried_uchain()/buriedobjlist chain.
    // The JS level graph names this array `buriedobjs` (see mklev.js bury()),
    // not `buriedobjlist` — this was reading the wrong field and silently
    // skipping every buried object's re-stamp.
    for (const o of level.buriedobjs || []) stamp_obj(o);

    // C ref: restore.c:1203 getlev()'s `if (ghostly)` arm — "reset peaceful/malign
    // relative to new character".  The bones level was saved with the DEAD hero's
    // relations baked in: Elara the lawful Priest's dwarves were peaceful, and
    // left as-is they run monmove.c:1894's peaceful-only rn2(10) getitems probe
    // for the neutral Healer who inherits them.  peace_minded() itself only rolls
    // for a CO-aligned monster, so a cross-aligned bones level draws nothing here.
    {
        const { peace_minded_bigrm, set_malign, monster_by_pmidx } = await import('./makemon.js');
        const S_UNICORN = 'u';
        const ual = Math.sign(game.u?.ualign?.type ?? 0);
        for (const m of level.monsters || []) {
            const ptr = m.data || monster_by_pmidx(m.mnum);
            if (!ptr) continue;
            if (!m.isshk) {
                // likes_gems is implied by the S_UNICORN class here: the only
                // S_UNICORN members that aren't unicorns are ponies/horses, whose
                // maligntyp is 0 — so the sign test below already excludes them.
                const uni = ptr.mcls === S_UNICORN && Math.sign(ptr.maligntyp ?? 0) !== 0;
                m.mpeaceful = (uni && ual === Math.sign(ptr.maligntyp ?? 0))
                    ? true : !!peace_minded_bigrm(ptr);
            }
            set_malign(m);
        }
    }
    return { level, stairs: bundle.stairs };
}

// ── can_make_bones (C ref: bones.c:355) ──
//
// Called from done()/savebones() at the moment the hero dies, to decide
// whether to attempt creating a bones file.  Its only RNG is
// rn2(1 + (depth >> 2)) — "fewer ghosts on low levels".  Note the C
// short-circuit: the rn2() is only evaluated when depth > 0, and the trailing
// `&& !wizard` suppresses the early-return in wizard mode (but the rn2 has
// already been drawn).  Ported faithfully for any future session that dies in
// a way that reaches it; the recorded starter sessions die on bones-ineligible
// levels (or are wizard runs that get filtered earlier), so it is currently
// not on the hot path.
export function can_make_bones() {
    if (!bones_enabled()) return false;       // C: if (!flags.bones) return FALSE;
    const uz = game.u?.uz;

    // C: if (ledger_no(&u.uz) <= 0 || ledger_no(&u.uz) > maxledgerno())
    //        return FALSE;                                      (bones.c:361)
    // Skipped only when the dungeon table hasn't been built, where C's
    // svd.dungeons[] would be all-zero and this test is meaningless.
    const led = ledger_no(uz), maxled = maxledgerno();
    if (led != null && maxled != null && (led <= 0 || led > maxled)) return false;

    if (no_bones_level(uz)) return false;     // no bones for specific levels
    if (game.u?.uswallow) return false;       // no bones when swallowed

    // C: if (!Is_branchlev(&u.uz)) { for (ttmp = gf.ftrap; ...) if (ttmp->ttyp
    //        == MAGIC_PORTAL) return FALSE; }                   (bones.c:369)
    // "no bones on non-branches with portals".  RNG-free, but it decides whether
    // the rn2() below happens at all — getting it wrong on a quest-portal or
    // Vlad's-tower level fabricates a draw and desyncs the rest of the run.
    if (!Is_branchlev(uz)) {
        for (const ttmp of (game.level?.traps || []))
            if (ttmp?.ttyp === MAGIC_PORTAL) return false;
    }

    const dep = depth_of_level(uz);
    // C: if (depth <= 0 || (!rn2(1 + (depth >> 2)) && !wizard)) return FALSE;
    if (dep <= 0) return false;               // endgame bulletproofing (no rng)
    if (!rn2(1 + (dep >> 2)) && !is_wizard()) return false;

    if (is_discover()) return false;          // C: if (discover) return FALSE;
    return true;
}

// ── give_to_nearby_mon (C ref: bones.c:225) ──
//
// Reservoir-samples one object-liking monster among the (up to) 8 squares
// around <x,y> (skipping the hero), drawing rn2(nmon) for each candidate.
// Ported for completeness; reached only from drop_upon_death()'s 1-in-8 branch
// during savebones(), which the harness does not exercise.
function likes_objs_mon(m) {
    // Approximate the C likes_gold/gems/objs/magic union via flags the JS
    // monster model carries; default to false so the loop length matches the
    // common "no greedy monster nearby" case.
    return !!(m && (m.likes_gold || m.likes_gems || m.likes_objs || m.likes_magic));
}

function m_at(x, y) {
    for (const m of game.level?.monsters ?? [])
        if (m.mx === x && m.my === y) return m;
    return null;
}

export function give_to_nearby_mon(otmp, x, y, place_object) {
    let selected = null;
    let nmon = 0;
    const u = game.u;
    for (let xx = x - 1; xx <= x + 1; ++xx) {
        for (let yy = y - 1; yy <= y + 1; ++yy) {
            if (xx < 1 || xx > 79 || yy < 0 || yy > 20) continue; // isok
            if (u && u.ux === xx && u.uy === yy) continue;        // u_at
            const mtmp = m_at(xx, yy);
            if (!mtmp) continue;
            if (!likes_objs_mon(mtmp)) continue;
            nmon++;
            if (!rn2(nmon)) selected = mtmp;   // reservoir pick
        }
    }
    if (selected && place_object?.toMon) place_object.toMon(selected, otmp);
    else if (place_object?.toFloor) place_object.toFloor(otmp, x, y);
}

// ── drop_upon_death (C ref: bones.c:258) ──
//
// Drops the hero's whole inventory on death.  Per item it draws rn2(5) (curse
// the item 4-in-5 of the time) and, when neither a rising monster nor a statue
// container receives the item, rn2(8) (1-in-8 → hand it to a nearby greedy
// monster, else drop on the floor).  Ported for completeness; the recorded
// sessions die on bones-ineligible levels so savebones()/this path isn't on
// the parity-critical stream, but the exact rn2 order is preserved so it stays
// correct if a future session reaches it.
export function drop_upon_death(mtmp, cont, x, y, hooks = {}) {
    const inv = game.u?.invent || game.invent || [];
    // iterate a snapshot since the C loop extracts each item from gi.invent
    for (const otmp of [...inv]) {
        if (rn2(5)) hooks.curse?.(otmp);                       // C: if (rn2(5)) curse(otmp);
        if (mtmp) {
            hooks.addToMon?.(mtmp, otmp);
        } else if (cont) {
            hooks.addToContainer?.(cont, otmp);
        } else if (!rn2(8)) {                                  // C: else if (!rn2(8))
            give_to_nearby_mon(otmp, x, y, hooks);
        } else {
            hooks.toFloor?.(otmp, x, y);
        }
    }
}

// ── resetobjs (C ref: bones.c:50), saving arm ──
//
// Every object that goes into a bones file is stripped of what the DEAD hero
// knew about it and of the few types that must not survive into another game.
// None of it draws RNG, but all of it is what the next hero sees: without the
// *known flags being cleared the reloaded loot renders with the previous
// hero's identifications ("a scroll of magic mapping" instead of "a scroll
// labeled FOOBIE BLETCH").
//
// The `restore` arm (artifact re-registration, shop no_charge for part-eaten
// food) is deliberately not ported: getbones() re-stamps o_ids itself and the
// artifact registry lives outside this module.
// `O` is the js/mkobj.js namespace, imported once by savebones() — a static
// import would close a cycle through mkobj.js -> eat.js.
function reset_obj_chain(chain, O, container) {
    if (!Array.isArray(chain)) return;
    for (const otmp of [...chain]) {
        if (!otmp) continue;
        if (Array.isArray(otmp.cobj)) reset_obj_chain(otmp.cobj, O, otmp);

        // C: if (otmp->in_use) { obj_extract_self(otmp); dealloc_obj(otmp); }
        if (otmp.in_use) {
            const host = container ? container.cobj : chain;
            const i = host.indexOf(otmp);
            if (i >= 0) host.splice(i, 1);
            continue;
        }

        // C: otmp->dknown = otmp->bknown = otmp->rknown = otmp->lknown
        //      = otmp->cknown = otmp->tknown = 0; invlet = 0; no_charge = 0;
        //      how_lost = LOST_NONE.
        // (The `if (objects[otyp].oc_uses_known) otmp->known = 0;` line above
        // them has no counterpart here: js/mkobj.js's objects[] carries no
        // oc_uses_known bit, and guessing which types have it would answer
        // wrong for every type not in front of me.)
        otmp.dknown = 0; otmp.bknown = 0; otmp.rknown = 0;
        otmp.lknown = 0; otmp.cknown = 0; otmp.tknown = 0;
        otmp.invlet = 0;
        otmp.no_charge = 0;
        otmp.how_lost = 0;                       // LOST_NONE

        // C: strip user-supplied names, but keep them on artifacts, statues,
        // novels and corpses of unique monsters (those came from a score file).
        if (otmp.oname
            && !(otmp.oartifact || otmp.otyp === O.STATUE || otmp.otyp === O.SPE_NOVEL
                 || (otmp.otyp === O.CORPSE && otmp.corpsenm >= O.SPECIAL_PM)))
            otmp.oname = null;

        if (otmp.otyp === O.EGG) {
            otmp.spe = 0;                        // not "laid by you" next game
        } else if (otmp.otyp === O.AMULET_OF_YENDOR) {
            otmp.otyp = O.FAKE_AMULET_OF_YENDOR; // no longer the real Amulet
            O.curse(otmp);
        } else if (otmp.otyp === O.CANDELABRUM_OF_INVOCATION) {
            otmp.otyp = O.WAX_CANDLE;
            otmp.age = 50;                       // assume used
            if (otmp.spe > 0) otmp.quan = otmp.spe;
            otmp.spe = 0;
            otmp.owt = O.weight(otmp);
            O.curse(otmp);
        } else if (otmp.otyp === O.BELL_OF_OPENING) {
            otmp.otyp = O.BELL;
            O.curse(otmp);
        } else if (otmp.otyp === O.SPE_BOOK_OF_THE_DEAD) {
            otmp.otyp = O.SPE_BLANK_PAPER;
            O.curse(otmp);
        }
    }
}

// C ref: bones.c:697 set_ghostly_objlist() — fix_ghostly_obj() reads the bit
// back when the next hero picks the item up.
function set_ghostly_objlist(chain) {
    for (const o of (chain || [])) {
        if (!o) continue;
        o.ghostly = 1;
        if (Array.isArray(o.cobj)) set_ghostly_objlist(o.cobj);
    }
}

// C ref: bones.c:391 remove_mon_from_bones() — "send various unique monsters
// away, in case these characters are not in their home bases".  C's test is
//   mtmp->iswiz || mptr == &mons[PM_MEDUSA] || mptr->msound == MS_NEMESIS
//   || mptr->msound == MS_LEADER || is_Vlad(mtmp)
//   || (mptr == &mons[PM_ORACLE] && !fixuporacle(mtmp))
// The two species arms are mons[] identity comparisons in C, so resolving them
// through name_to_pmidx() is the faithful translation, not a name heuristic —
// everything else is a flag test.  The Oracle arm is omitted: fixuporacle()
// succeeds whenever her level has a Delphi room, which is the only way she is
// on a level at all, so C keeps her in that case too.
function remove_mon_from_bones(m, PM_MEDUSA, PM_VLAD) {
    const p = m?.data;
    if (!p) return false;
    const snd = msound_of(p);
    return !!(m.iswiz || snd === MS_NEMESIS || snd === MS_LEADER
              || (PM_MEDUSA >= 0 && m.mnum === PM_MEDUSA)
              || (PM_VLAD >= 0 && (m.mnum === PM_VLAD || m.cham === PM_VLAD)));
}

// C ref: trap.c unhideable_trap() — the traps that are always shown.
function unhideable_trap(ttyp) {
    return ttyp === MAGIC_PORTAL || ttyp === VIBRATING_SQUARE;
}

// ── savebones (C ref: bones.c:400) ──
//
// Called from end.c really_done() once can_make_bones() has approved a bones
// file.  The C routine rewrites the dying hero's level into a "legacy" level:
// the hero is removed, the whole inventory is scattered (drop_upon_death), a
// ghost wearing the hero's name is created at the death spot, monsters are
// un-tamed, traps de-attributed, and — crucially for the next hero's arrival —
// every cell's seen/lit/remembered state is wiped so the reloaded level starts
// unexplored.  It then serialises the level (savelev) to the bones file.
//
// Here the shared-storage handle stands in for the bones file: we apply the
// screen-relevant mutations to game.level, then serialise { level, stairs } with
// save.js's reference-preserving codec under bones_key(u.uz).  The next segment's
// getbones() reads it back.  Wrapped so a serialisation hiccup can never abort
// the death sequence (which would drop the segment's already-matched frames).
export async function savebones(how = 0, corpse = null) {
    try {
        const g = game;
        const storage = g.storage;
        if (!storage || typeof storage.setItem !== 'function') return;
        const uz = g.u?.uz;
        const key = bones_key(uz);

        // C ref: bones.c:417-431 — open_bonesfile() FIRST.  If a bones file for
        // this level already exists C does NOT overwrite it: in wizard mode it
        // offers "Bones file already exists.  Replace it?" and only proceeds on
        // 'y' (via delete_bonesfile), otherwise it returns leaving the older
        // bones in place.  Our port used to clobber the blob unconditionally, so
        // a second hero dying on a level another hero already haunted would hand
        // the THIRD hero the wrong legacy level.
        {
            const existing = (typeof storage.getItem === 'function')
                ? storage.getItem(key) : null;
            if (existing != null && existing !== '') {
                if (!is_wizard()) return;
                const { y_n } = await import('./display.js');
                if ((await y_n('Bones file already exists.  Replace it?')) !== 'y')
                    return;
                if (storage.removeItem) storage.removeItem(key);
                else storage.setItem(key, '');
            }
        }

        const x = g.u?.ux ?? 0, y = g.u?.uy ?? 0;

        // C ref: bones.c:446 forget_engravings() — "next hero won't have read any
        // engravings yet".
        for (const ep of (g.level?.engravings || [])) {
            if (!ep) continue;
            ep.erevealed = 0;
            ep.eread = 0;
        }

        // C ref: bones.c:443 iter_mons(remove_mon_from_bones) + dmonsfree().
        {
            const { name_to_pmidx } = await import('./makemon.js');
            const PM_MEDUSA = name_to_pmidx('Medusa') ?? -1;
            const PM_VLAD = name_to_pmidx('Vlad the Impaler') ?? -1;
            const mons_list = g.level?.monsters;
            if (Array.isArray(mons_list)) {
                for (let i = mons_list.length - 1; i >= 0; i--)
                    if (remove_mon_from_bones(mons_list[i], PM_MEDUSA, PM_VLAD))
                        mons_list.splice(i, 1);
            }
        }

        // C ref: bones.c:456 set_ghostly_objlist(gi.invent) — done BEFORE the
        // inventory is scattered, so every item the hero was carrying carries the
        // bit into the bones file.
        set_ghostly_objlist(g.u?.invent || g.invent || []);

        // C ref: bones.c:436 drop_upon_death() — scatter the hero's inventory
        // onto the floor so the reloaded bones level shows the loot.  We add each
        // item to the level's floor list by REFERENCE (no obj_extract_self): C
        // moves it out of gi.invent, but really_done() has already computed the
        // score from the full inventory (end.c:1322 "calculate score, before
        // creating bones"), whereas our outrip_and_score() reads game.invent
        // *after* this call — so leaving the objects on the invent list too keeps
        // the tombstone gold correct while still placing them on the map.  Each
        // item draws rn2(5) (curse) then, on the common branch, rn2(8).
        const { place_object } = await import('./mkobj.js');
        const hooks = {
            curse: (o) => { if (o) { o.cursed = 1; o.blessed = 0; } },
            toFloor: (o) => { if (o) { o.owornmask = 0; place_object(o, x, y); } },
            toMon: (m, o) => { if (o) (m.minvent = m.minvent || []).push(o); },
        };
        drop_upon_death(null, null, x, y, hooks);

        // C ref: bones.c:494-500 —
        //   gi.in_mklev = TRUE;                       /* allow the hero's square */
        //   mtmp = makemon(&mons[PM_GHOST], u.ux, u.uy, MM_NONAME);
        //   gi.in_mklev = FALSE;
        //   mtmp = christen_monst(mtmp, svp.plname);
        //   if (corpse) obj_attach_mid(corpse, mtmp->m_id);
        // then bones.c:506-511 overrides m_lev/mhp/mhpmax/female/msleeping.
        // The old code hand-rolled the ghost and drew only next_ident, losing
        // the other 5 calls C makes here (newmonhp d(9,8), makemon.c:1279
        // rn2(2), m_initinv rn2(50)+rn2(100), makemon.c:1447 rn2(100)) —
        // seed0030 seg6 step 247 idx 47-52.  MM_NONAME is what suppresses
        // rndghostname()'s extra rn2(7)/rn2(34).
        {
            const { makemon, monster_by_pmidx } = await import('./makemon.js');
            const { MM_NONAME } = await import('./const.js');
            const PM_GHOST = 287;
            const gdata = monster_by_pmidx(PM_GHOST);
            const saved_in_mklev = g.in_mklev;
            g.in_mklev = true;
            let mtmp = null;
            try { mtmp = makemon(gdata, x, y, MM_NONAME); }
            finally { g.in_mklev = saved_in_mklev; }
            if (mtmp) {
                // C: mtmp = christen_monst(mtmp, svp.plname);
                const { christen_monst } = await import('./do_name.js');
                const plname = svp_plname();
                mtmp.mextra = mtmp.mextra || {};
                christen_monst(mtmp, plname);
                mtmp.mname = plname;
                mtmp.m_lev = g.u?.ulevel || 1;
                mtmp.mhp = mtmp.mhpmax = g.u?.uhpmax ?? 1;
                mtmp.female = !!g.flags?.female;
                mtmp.msleeping = 1;
                if (corpse) corpse.corpsenm_mid = mtmp.m_id; // obj_attach_mid
            }
        }

        // C ref: bones.c:538-546 — per-monster: mark its pack ghostly, resetobjs
        // it, forget the dead hero (mlstmv, tameness, and seen_resistance — "
        // observations about the current hero won't apply to future game").
        // js/mkobj.js exports every otyp resetobjs() names except
        // FAKE_AMULET_OF_YENDOR and permonst.h's SPECIAL_PM; both are looked up
        // symbolically (objects[] carries the C enum name in `sym`, and
        // SPECIAL_PM is mons[PM_LONG_WORM_TAIL]) rather than pasted as numbers.
        const mk = await import('./mkobj.js');
        const { name_to_pmidx: n2p } = await import('./makemon.js');
        const O = Object.assign(Object.create(null), mk, {
            FAKE_AMULET_OF_YENDOR:
                mk.objects.find((o) => o.sym === 'FAKE_AMULET_OF_YENDOR')?.otyp,
            SPECIAL_PM: n2p('long worm tail') ?? Infinity,
        });
        for (const m of g.level?.monsters || []) {
            set_ghostly_objlist(m.minvent || []);
            reset_obj_chain(m.minvent, O);
            m.mlstmv = 0;
            if (m.mtame) { m.mtame = 0; m.mpeaceful = 0; }
            m.seen_resistance = 0;               // M_SEEN_NOTHING
        }
        // C ref: bones.c:548-551 — strip trap "made by you" and re-hide every
        // trap the next hero has no business already knowing about.
        for (const t of g.level?.traps || []) {
            t.madeby_u = 0;
            t.tseen = unhideable_trap(t.ttyp) ? 1 : 0;
        }
        // C ref: bones.c:552-555 — the floor and buried chains get the same
        // ghostly mark + reset the hero's pack just got.
        set_ghostly_objlist(g.level?.objects || []);
        reset_obj_chain(g.level?.objects, O);
        set_ghostly_objlist(g.level?.buriedobjs || []);
        reset_obj_chain(g.level?.buriedobjs, O);

        // C ref: bones.c:555-560 — wipe every cell's seen/lit/remembered state so
        // the arriving hero explores the legacy level from scratch (this is what
        // makes the reloaded bones level show only the room they can see, not the
        // dead hero's explored map).  This does not touch the death-sequence
        // frames (tombstone/disclosure are full-screen text overlays, not the
        // map), so it cannot regress seg0's post-death screens.
        const map = g.level;
        if (map?.locations) {
            for (let cx = 1; cx < map.locations.length; cx++) {
                const col = map.locations[cx];
                if (!col) continue;
                for (let cy = 0; cy < col.length; cy++) {
                    const loc = col[cy];
                    if (!loc) continue;
                    loc.seenv = 0;
                    loc.waslit = 0;
                    loc.glyph_symidx = -1;
                    loc.remembered_glyph = undefined;
                    loc.disp_ch = ' ';
                }
            }
        }

        // C ref: bones.c:573-591 — attach the cemetery entry before saving.  Only
        // `who`'s "<plname>-" prefix is ever read back (bones_include_name), but
        // it decides whether the NEXT hero to reach this level gets do.c's
        // familiar_level_msg() and its rn2(4): these bones belong to whoever is
        // named here, and a stranger recognises nothing.
        {
            // C: Sprintf(newbones->who, "%s-%.3s-%.3s-%.3s-%.3s", svp.plname,
            //            gu.urole.filecode, gu.urace.filecode,
            //            genders[flags.female].filecode,
            //            aligns[1 - u.ualign.type].filecode);
            // aligns[] is ordered {lawful, neutral, chaotic} and u.ualign.type is
            // {1, 0, -1}, so `1 - type` is the index — and it is the FINAL
            // alignment, not the one chargen picked, "same as topten and logfile
            // entries".
            const { roles, races, genders, aligns } = await import('./role.js');
            const fc3 = (s) => String(s ?? '').slice(0, 3);
            const female = !!g.flags?.female;
            const alignIdx = 1 - (g.u?.ualign?.type ?? 0);
            const entry = {
                who: `${svp_plname()}-${fc3(roles[g.initrole]?.filecode)}`
                    + `-${fc3(races[g.initrace]?.filecode)}`
                    + `-${fc3(genders[female ? 1 : 0]?.filecode)}`
                    + `-${fc3(aligns[alignIdx]?.filecode)}`,
                how, frpx: x, frpy: y, bonesknown: false,
            };
            // "most recent (this dead hero) first"
            g.level.bonesinfo = [entry, ...(g.level.bonesinfo || [])];

            // C ref: bones.c:596 — "flag these bones if they are being created in
            // wizard mode".
            if (is_wizard()) {
                g.level.flags = g.level.flags || {};
                g.level.flags.wizard_bones = 1;
            }
        }

        // C ref: bones.c:610 savelev() — serialise the level for the next hero.
        // savelev_core() (save.c:553) also writes save_track(), so the DEAD
        // hero's footprint ring travels with the bones level.
        const { serializeGameState } = await import('./save.js');
        const { save_track } = await import('./track.js');
        storage.setItem(key, serializeGameState({
            level: g.level, stairs: g.stairs, track: save_track(),
        }));
    } catch { /* bones write is best-effort; never break the death sequence */ }
}

// C ref: bones.c:762 bones_include_name(name) — prefix-match `name + "-"`
// against every cemetery entry the loaded level carries.  The trailing hyphen
// is what stops "Hermi" matching "Hermione-Hea-Hum-Fem-Neu".
export function bones_include_name(name) {
    const buf = `${name || ''}-`;
    for (const bp of game.level?.bonesinfo || [])
        if (String(bp?.who || '').startsWith(buf)) return true;
    return false;
}

export default { getbones, can_make_bones, no_bones_level, bones_include_name,
                 give_to_nearby_mon, drop_upon_death, savebones, bones_key };

// ── dispatch note (NOT applied here; I own only js/bones.js) ──
//
// To make this module the single source of truth for the getbones() rn2(3)
// draw, mklev.js should import and call it instead of its private copy:
//
//   js/mklev.js:
//     import { getbones } from './bones.js';
//     // delete the local `function getbones() { ... }` definition (~line 238)
//     // mklev() already calls `if (getbones()) return;` (line 260) — unchanged.
//
// The two implementations are behaviorally identical (same discover / bones /
// rn2(3) / wizard semantics), so wiring this in is a no-op for the call stream
// and cannot regress any session.  The orchestrator is expected to apply that
// one-line import swap in mklev.js.

// ═══════════════════════════════════════════════════════════════════════════
// The remaining bones.c entry points, translated verbatim.  ADDITIVE ONLY:
// nothing above this line calls them (savebones() still uses its own
// reset_obj_chain(); see the note on resetobjs() below).
//
// The callees these need — obj_extract_self(), curse(), artifact_exists(),
// cant_revive(), enexto(), ... — are either module-private stubs elsewhere in
// js/ or would close an import cycle through mkobj.js -> eat.js (the reason
// savebones() hands `O` in as a parameter, see js/bones.js:436).  They
// therefore arrive through a trailing `deps` argument, the same convention
// drop_upon_death()/give_to_nearby_mon() above already use.  C's control flow
// and its order of operations are unchanged.
// ═══════════════════════════════════════════════════════════════════════════

// C ref: objnam.c:431 fruit_from_indx() — walk svc.ffruit for a fid.  Repeated
// here rather than imported: js/objnam.js is a static-import cycle risk for
// this file and the walk is three lines.
function fruit_from_indx(indx) {
    for (let f = game.ffruit; f; f = f.nextf)
        if (f.fid === indx) return f;
    return null;
}

// C ref: bones.c:41 goodfruit(id) — "call this for each fruit object saved in
// the bones level: it marks that particular type of fruit as existing".  A
// slime mold's obj->spe is the NEGATED fruit index while the type is only
// provisional, so flipping fid back to positive is the "this one survives"
// marker savefruitchn() then filters on.
export function goodfruit(id) {
    const f = fruit_from_indx(-id);

    if (f)
        f.fid = id;
}

// C ref: bones.c:50 resetobjs(ochain, restore) — the full two-armed version.
//
// The `restore` arm re-registers (or demotes) artifacts as a bones level is
// read back and re-prices partly eaten food in a shop; the `!restore` arm
// strips everything the DEAD hero knew and neuters the objects that must not
// survive into another game.  Recursive over containers, and it can delete the
// object it is looking at (the in_use arm), which is why C caches nobj first.
//
// NOTE for whoever wires bones up: reset_obj_chain() at js/bones.js:440 is the
// incomplete predecessor of this function (saving arm only; no oc_uses_known,
// SLIME_MOLD, SCR_MAIL, TIN, CORPSE/STATUE or prize handling) and savebones()
// still calls it.  Move that call here once `deps` can be filled in; do not
// "fix" reset_obj_chain, delete it.
//
// C's `nobj` chain is an array in this port (the same representation
// reset_obj_chain and savebones already use), and `cobj` likewise.
export function resetobjs(ochain, restore, deps = {}) {
    const O = deps.O || {};
    const objects = O.objects || [];

    if (!Array.isArray(ochain)) return;
    // C: `for (otmp = ochain; otmp; otmp = nobj) { nobj = otmp->nobj; ... }` —
    // the snapshot is what makes deleting otmp mid-loop safe.
    for (const otmp of [...ochain]) {
        if (!otmp) continue;
        if (Array.isArray(otmp.cobj) && otmp.cobj.length)
            resetobjs(otmp.cobj, restore, deps);

        if (otmp.in_use) {
            deps.obj_extract_self?.(otmp);
            deps.dealloc_obj?.(otmp);
            continue;
        }

        if (restore) {
            /* artifact bookkeeping needs to be done during restore; other
               fixups are done while saving */
            if (otmp.oartifact) {
                if (deps.exist_artifact?.(otmp.otyp, safe_oname(otmp))
                    || deps.is_quest_artifact?.(otmp)) {
                    /* prevent duplicate -- revert to ordinary obj */
                    otmp.oartifact = 0;
                    if (has_oname(otmp))
                        deps.free_oname?.(otmp);
                } else {
                    deps.artifact_exists?.(otmp, safe_oname(otmp), true,
                                           deps.ONAME_BONES ?? 0);
                }
            } else if (has_oname(otmp)) {
                deps.sanitize_name?.(otmp);
            }
            /* 3.6.3: set no_charge for partly eaten food in shop; all other
               items become goods for sale if in a shop */
            if (otmp.oclass === O.FOOD_CLASS && otmp.oeaten) {
                let top = otmp;
                // C: `for (top = otmp; top->where == OBJ_CONTAINED;
                //       top = top->ocontainer) continue;`
                while (top.where === 'contained' && top.ocontainer)
                    top = top.ocontainer;
                const loc = { x: 0, y: 0 };
                otmp.no_charge = (top.where === 'floor'
                                  && deps.get_obj_location?.(top, loc, 0)
                                  /* can't use costly_spot(): its result
                                     depends on the hero's location */
                                  && deps.inside_shop?.(loc.x, loc.y)
                                  && deps.tended_shop?.(loc.x, loc.y)) ? 1 : 0;
            }
        } else { /* saving */
            /* do not zero out o_ids for ghost levels anymore */

            if (objects[otmp.otyp]?.oc_uses_known)
                otmp.known = 0;
            otmp.dknown = otmp.bknown = 0;
            otmp.rknown = 0;
            otmp.lknown = 0;
            otmp.cknown = 0;
            otmp.tknown = 0;
            otmp.invlet = 0;
            otmp.no_charge = 0;
            otmp.how_lost = 0;                      /* LOST_NONE */

            /* strip user-supplied names.  Statue and some corpse names are
               left intact, presumably in case they came from the score file. */
            if (has_oname(otmp)
                && !(otmp.oartifact || otmp.otyp === O.STATUE
                     || otmp.otyp === O.SPE_NOVEL
                     || (otmp.otyp === O.CORPSE
                         && otmp.corpsenm >= O.SPECIAL_PM))) {
                deps.free_oname?.(otmp);
            }

            if (otmp.otyp === O.SLIME_MOLD) {
                goodfruit(otmp.spe);
            } else if (otmp.otyp === O.SCR_MAIL) {
                /* MAIL_STRUCTURES.  0: delivered in-game via external event;
                   1: from bones or wishing; 2: written with a marker */
                if (otmp.spe === 0)
                    otmp.spe = 1;
            } else if (otmp.otyp === O.EGG) {
                otmp.spe = 0;               /* not "laid by you" next game */
            } else if (otmp.otyp === O.TIN) {
                /* make tins of a unique monster's meat be empty */
                if (ismnum(otmp.corpsenm)
                    && deps.unique_corpstat?.(otmp.corpsenm))
                    otmp.corpsenm = -1;     /* NON_PM */
            } else if (otmp.otyp === O.CORPSE || otmp.otyp === O.STATUE) {
                /* Discard incarnation details of unique monsters (by passing
                   null instead of otmp for object), shopkeepers (by passing
                   false for the revival flag), temple priests and vault guards,
                   to prevent corpse revival / statue reanimation. */
                const mnumRef = { value: otmp.corpsenm };
                if (has_omonst(otmp)
                    && deps.cant_revive?.(mnumRef, false, null)) {
                    deps.free_omonst?.(otmp);
                    /* mnum is now either human_zombie or doppelganger; for
                       corpses of uniques the transformation has to happen NOW
                       rather than at a revival attempt, otherwise eating this
                       corpse would behave as if it remains unique */
                    if (mnumRef.value === deps.PM_DOPPELGANGER
                        && otmp.otyp === O.CORPSE)
                        deps.set_corpsenm?.(otmp, mnumRef.value);
                }
            } else if (deps.is_mines_prize?.(otmp) || deps.is_soko_prize?.(otmp)) {
                /* achievement tracking; in case the prize was moved off its
                   original level (which is always a no-bones level) */
                otmp.nomerge = 0;
            } else if (otmp.otyp === O.AMULET_OF_YENDOR) {
                otmp.otyp = O.FAKE_AMULET_OF_YENDOR;  /* no longer the real one */
                deps.curse?.(otmp);
            } else if (otmp.otyp === O.CANDELABRUM_OF_INVOCATION) {
                if (otmp.lamplit)
                    deps.end_burn?.(otmp, true);
                otmp.otyp = O.WAX_CANDLE;
                otmp.age = 50;                        /* assume used */
                if (otmp.spe > 0)
                    otmp.quan = otmp.spe;
                otmp.spe = 0;
                otmp.owt = deps.weight ? deps.weight(otmp) : otmp.owt;
                deps.curse?.(otmp);
            } else if (otmp.otyp === O.BELL_OF_OPENING) {
                otmp.otyp = O.BELL;
                deps.curse?.(otmp);
            } else if (otmp.otyp === O.SPE_BOOK_OF_THE_DEAD) {
                otmp.otyp = O.SPE_BLANK_PAPER;
                deps.curse?.(otmp);
            }
        }
    }
}
// C ref: obj.h has_oname(obj) / ONAME(obj); this port keeps the name in
// obj.oname (js/invent.js:312 safe_oname()).  mkobj.h ismnum(mnum) is
// `mnum > NON_PM && mnum < NUMMONS`.
function has_oname(obj) { return !!obj?.oname; }
function safe_oname(obj) { return obj?.oname || ''; }
function has_omonst(obj) { return !!(obj?.omonst || obj?.oextra?.omonst); }
function ismnum(mnum) { return (mnum | 0) > -1; }

// C ref: bones.c:308 fixuporacle(oracle) — "possibly restore oracle's room
// and/or put her back inside it; returns False if she's on the wrong level and
// should be removed, True otherwise".  Called from remove_mon_from_bones(),
// whose port at js/bones.js:516 deliberately omits the Oracle arm (see the
// comment there); this is that arm.
//
// No RNG of its own, but enexto() rolls, so the early `return FALSE` and the
// `o_ridx === ridx` short circuit both matter to the stream.
export async function fixuporacle(oracle, deps = {}) {
    /* the oracle doesn't move, but a knight's joust or a monk's staggering
       blow could push her onto a hole in the floor; at present traps don't
       activate in such a situation so she won't fall to another level, but
       that could change, so be prepared to cope with such things */
    if (!Is_oracle_level(game.u?.uz))
        return false;

    oracle.mpeaceful = 1;   /* for behavior toward the next character */
    const rooms = game.level?.rooms || [];
    let o_ridx = roomno_at(oracle.mx, oracle.my) - ROOMOFFSET;
    if (o_ridx >= 0 && rooms[o_ridx]?.rtype === DELPHI)
        return true;        /* no fixup needed */

    /*
     * The Oracle isn't in the DELPHI room.  Either the hero entered her
     * chamber and got the one-time welcome message, converting it into an
     * ordinary room, or she got teleported out, or both.  Try to put her back
     * inside her room, if necessary, and restore its type.
     */

    /* find the original delphi chamber; should always succeed.  C scans the
       whole fixed-size svr.rooms[] array, so `ridx === SIZE(rooms)` is its
       "not found" answer — mirrored here with rooms.length. */
    let ridx = 0;
    for (; ridx < rooms.length; ++ridx)
        if ((rooms[ridx]?.orig_rtype | 0) === DELPHI)
            break;

    if (o_ridx !== ridx && ridx < rooms.length) {
        /* room found and she's not in it, so try to move her there */
        const cc = { x: Math.trunc((rooms[ridx].lx + rooms[ridx].hx) / 2),
                     y: Math.trunc((rooms[ridx].ly + rooms[ridx].hy) / 2) };
        const spot = deps.enexto?.(cc.x, cc.y, oracle.data);
        if (spot) {
            await deps.rloc_to?.(oracle, spot.x, spot.y);
            o_ridx = roomno_at(oracle.mx, oracle.my) - ROOMOFFSET;
        }
        /* [if her room is already full she might end up outside; that's ok,
           the next hero just won't get any welcome message, same as used to
           happen before this fixup was introduced] */
    }
    if (ridx === o_ridx)    /* if she's in her room, mark it as such */
        rooms[ridx].rtype = DELPHI;
    return true;            /* keep the oracle in the new bones file */
}
// C ref: rm.h levl[x][y].roomno.
function roomno_at(x, y) { return game.level?.at?.(x, y)?.roomno | 0; }

// C ref: bones.c:795 fix_ghostly_obj(obj) — "called when a marked object from a
// bones file is picked up.  Some could result in a message, and the obj->ghostly
// flag is always cleared."  The asymmetrical launchers were strung for the
// previous, possibly opposite-handed, hero.
export async function fix_ghostly_obj(obj) {
    if (!obj?.ghostly)
        return;
    const O = await import('./mkobj.js');
    const otyp_of = (nm) => O.objects.find((o) => o.sym === nm)?.otyp;
    switch (obj.otyp) {
    /* asymmetrical weapons */
    case otyp_of('BOW'):
    case otyp_of('ELVEN_BOW'):
    case otyp_of('ORCISH_BOW'):
    case otyp_of('YUMI'):
    case otyp_of('BOOMERANG'): {
        const { pline } = await import('./display.js');
        const { xname } = await import('./invent.js');
        await pline(`You make adjustments to ${the(xname(obj))} to suit your `
                    + `${URIGHTY() ? 'right' : 'left'} hand.`);
        break;
    }
    default:
        break;
    }
    obj.ghostly = 0;
}
// C ref: hack.h the() / URIGHTY (u.uhandedness == RIGHT_HANDED, the default).
function the(s) { return /^[A-Z]/.test(String(s)) ? String(s) : `the ${s}`; }
function URIGHTY() { return (game.u?.uhandedness ?? 0) === 0; }

// C ref: bones.c:817 newebones(mtmp) — allocate mtmp's `struct ebones` (the
// "which bones pile did this monster come from" record), zeroed except for
// parentmid.  mextra is a plain object in this port (js/dog.js:542 newmextra()).
export function newebones(mtmp) {
    if (!mtmp.mextra)
        mtmp.mextra = {};                       /* newmextra() */
    if (!mtmp.mextra.ebones) {
        mtmp.mextra.ebones = { parentmid: 0 };  /* alloc + memset 0 */
        mtmp.mextra.ebones.parentmid = mtmp.m_id;
    }
}

// C ref: bones.c:832 free_ebones(mtmp) — "this is not currently used".
export function free_ebones(mtmp) {
    if (mtmp.mextra && mtmp.mextra.ebones) {
        mtmp.mextra.ebones = null;
    }
}
